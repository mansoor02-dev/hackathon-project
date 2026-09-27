import { g8, graph8Configured } from "../config/config.js";
import { fetchCompanyDetails } from "./company-service.js";
import { generateCoachingScript, buildLocalPrep, voiceStatus } from "./voice-coaching-service.js";
import { getGraph8Event } from "../utils/graph8-event.js";
import { recordEvent, hasSeen, markSeen } from "./event-store.js";

const BOOKED_EVENTS = new Set(["meeting.booked", "meeting_booked", "appointments.booked"]);

function meetingKey(data) {
  return (
    data.event_id || data.id ||
    (data.meeting_id ? `meeting:${data.meeting_id}` : null) ||
    (data.contact_id && data.scheduled_at ? `meeting:${data.contact_id}:${data.scheduled_at}` : null)
  );
}

export async function processMeetingEvent(payload) {
  const { event, data } = getGraph8Event(payload || {});

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
