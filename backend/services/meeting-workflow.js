import { g8, graph8Configured } from "../config/config.js";
import { fetchCompanyDetails } from "./company-service.js";
import { generateCoachingScript, buildLocalPrep, voiceStatus } from "./voice-coaching-service.js";
import { getGraph8Event } from "../utils/graph8-event.js";
import { recordEvent, hasSeen, markSeen } from "./event-store.js";
import { cancelRecovery, upsertOpportunity } from "./recovery/store.js";

// Verified KNOWN_WEBHOOK_EVENTS: meeting.booked, meeting.cancelled,
// meeting.rescheduled, meeting.no_show. Booking stops recovery for the
// account; cancellation re-opens it.
const BOOKED_EVENTS = new Set(["meeting.booked", "meeting_booked", "appointments.booked"]);
const CANCELLED_EVENTS = new Set(["meeting.cancelled", "meeting_cancelled"]);
const RESCHEDULED_EVENTS = new Set(["meeting.rescheduled", "meeting_rescheduled"]);
const NO_SHOW_EVENTS = new Set(["meeting.no_show", "meeting_no_show"]);

function meetingKey(data) {
  return (
    data.event_id || data.id ||
    (data.meeting_id ? `meeting:${data.meeting_id}` : null) ||
    (data.contact_id && data.scheduled_at ? `meeting:${data.contact_id}:${data.scheduled_at}` : null)
  );
}

export async function processMeetingEvent(payload) {
  const { event, data } = getGraph8Event(payload || {});

  if (CANCELLED_EVENTS.has(event)) {
    const domain = String(data?.company_domain || data?.domain || "").toLowerCase();
    const key = meetingKey(data || {});
    if (key && hasSeen(key)) return { status: "duplicate", event };
    if (key) markSeen(key);
    recordEvent("meeting_cancelled", {
      company: data?.company_name || null,
      domain: domain || null,
      metadata: { meetingId: data?.meeting_id || null, idempotencyKey: key },
    });
    if (domain) {
      upsertOpportunity(domain, {
        status: "candidate",
        recoveryEligible: true,
        enrollmentStatus: "cancelled_meeting",
        timelineEvent: "meeting_cancelled",
        timelineDetail: "account eligible for recovery again",
      });
    }
    return { status: "meeting_cancelled", event };
  }

  if (RESCHEDULED_EVENTS.has(event)) {
    const key = meetingKey(data || {});
    if (key && hasSeen(key)) return { status: "duplicate", event };
    if (key) markSeen(key);
    recordEvent("meeting_rescheduled", {
      company: data?.company_name || null,
      domain: data?.company_domain || null,
      metadata: { meetingId: data?.meeting_id || null, scheduledAt: data?.scheduled_at || null },
    });
    return { status: "meeting_rescheduled", event };
  }

  if (NO_SHOW_EVENTS.has(event)) {
    recordEvent("meeting_no_show", { metadata: { meetingId: data?.meeting_id || null } });
    return { status: "meeting_no_show", event };
  }

  if (!BOOKED_EVENTS.has(event)) {
    return { status: "ignored", event };
  }

  const {
    contact_id: contactId,
    meeting_id: meetingId,
    meeting_title: meetingTitle,
    scheduled_at: scheduledAt,
    duration_minutes: durationMinutes,
    sequence_id: sequenceId,
    campaign_id: campaignId,
    booked_at: bookedAt,
  } = data || {};

  if (!contactId) {
    throw new Error("meeting_booked event does not contain contact_id");
  }

  const key = meetingKey(data || {});
  if (key && hasSeen(key)) {
    return { status: "duplicate", event, meeting_id: meetingId };
  }
  if (key) markSeen(key);

  let contact = null;
  if (graph8Configured) {
    try {
      contact = await g8.contacts.get(Number(contactId));
    } catch (error) {
      console.warn(`[MEETING] contact lookup failed for ${contactId}:`, error.message);
    }
  }
  contact = contact || { id: contactId };

  const companyDomain = contact?.company_domain || contact?.company?.domain || data?.company_domain || null;
  const companyResult = companyDomain ? await fetchCompanyDetails(companyDomain) : null;
  const company = companyResult?.data || null;

  const coachingContext = {
    contact_id: contactId,
    prospect: {
      name: contact?.name || [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || null,
      email: contact?.email || null,
      title: contact?.job_title || contact?.title || null,
      company: company?.companyName || contact?.company_name || companyDomain || null,
      company_domain: companyDomain,
      industry: company?.industry || null,
      tech_stack: company?.technologies || [],
    },
    meeting: {
      id: meetingId, title: meetingTitle, scheduled_at: scheduledAt,
      duration_minutes: durationMinutes, sequence_id: sequenceId,
      campaign_id: campaignId, booked_at: bookedAt,
    },
  };

  const meetingRecord = recordEvent("meeting_booked", {
    company: coachingContext.prospect.company,
    domain: companyDomain,
    visitor: { contactId },
    metadata: { meetingId, title: meetingTitle, scheduledAt, idempotencyKey: key },
  });

  // Conversion wins: stop/disable recovery for this account.
  if (companyDomain) {
    cancelRecovery(String(companyDomain).toLowerCase(), `meeting booked (${meetingId || contactId})`);
  }

  // Acknowledge fast: coaching runs async (no queue infra — setImmediate).
  setImmediate(async () => {
    try {
      const script = await generateCoachingScript(coachingContext);
      const status = voiceStatus();
      if (script) {
        recordEvent("sales_preparation_generated", {
          company: coachingContext.prospect.company, domain: companyDomain,
          metadata: { mode: "real", meetingId, agentId: status.agentId || null },
        });
        console.log("[VOICE] Personalized coaching script generated.");
      } else {
        const prep = buildLocalPrep(coachingContext);
        recordEvent("sales_preparation_generated", {
          company: coachingContext.prospect.company, domain: companyDomain,
          metadata: { mode: "simulated", meetingId, prep, reason: status.reason || "voice not configured" },
        });
        console.log("[VOICE] Simulated coaching prep stored (voice not configured).");
      }
    } catch (error) {
      recordEvent("error", { metadata: { where: "coaching", message: error.message, meetingId } });
      console.warn("[VOICE] async coaching failed:", error.message);
    }
  });

  return {
    status: "meeting_processed",
    meeting_id: meetingId,
    contact_id: contactId,
    meeting_event_id: meetingRecord.id,
    coaching_context: coachingContext,
    coaching: "pending",
  };
}
