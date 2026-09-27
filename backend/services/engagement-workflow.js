import { getGraph8Event } from "../utils/graph8-event.js";
import { recordEvent, hasSeen, markSeen } from "./event-store.js";
import { markContactEnrolled, upsertOpportunity } from "./recovery/store.js";

// Outbound visibility: sequence enrollment, replies, form submissions.
// Verified KNOWN_WEBHOOK_EVENTS include engagement.email_replied,
// sequence.contact_enrolled, form.submitted, task.created.
const REPLY_EVENTS = new Set([
  "engagement.email_replied",
  "engagement.sms_replied",
  "engagement.linkedin_reply_received",
  "engagement.email_replied_event",
]);
const ENROLLED_EVENTS = new Set(["sequence.contact_enrolled", "sequence_contact_enrolled"]);
const FORM_EVENTS = new Set(["form.submitted", "form_submitted"]);

export async function processEngagementEvent(payload) {
  const { event, data } = getGraph8Event(payload || {});
  if (!event) return { status: "ignored", event };

  if (REPLY_EVENTS.has(event)) {
    const key = data.event_id || data.id || (data.contact_id ? `reply:${data.contact_id}:${event}` : null);
    if (key && hasSeen(key)) return { status: "duplicate", event };
    if (key) markSeen(key);
    recordEvent("reply_received", {
      company: data.company_name || null,
      domain: data.company_domain || null,
      visitor: data.contact_id ? { contactId: data.contact_id } : null,
      metadata: { channel: event, contactId: data.contact_id || null },
    });
    return { status: "reply_recorded", event };
  }

  if (ENROLLED_EVENTS.has(event)) {
    const domain = String(data.company_domain || data.domain || "").toLowerCase();
    const contactId = data.contact_id || data.contactId || null;
    const sequenceId = data.sequence_id || data.sequenceId || null;
    const key = data.event_id || (contactId && sequenceId ? `enrolled:${sequenceId}:${contactId}` : null);
    if (key && hasSeen(key)) return { status: "duplicate", event };
    if (key) markSeen(key);
    if (domain && contactId) markContactEnrolled(domain, contactId, sequenceId);
    else if (domain) upsertOpportunity(domain, { enrollmentStatus: "enrolled", status: "enrolled" });
    recordEvent("sequence_enrolled", {
      domain: domain || null,
      visitor: contactId ? { contactId } : null,
      metadata: { sequenceId },
    });
    return { status: "enrollment_recorded", event };
  }

  if (FORM_EVENTS.has(event)) {
    recordEvent("form_submitted", {
      company: data.company_name || null,
      domain: data.company_domain || data.domain || null,
      metadata: { formId: data.form_id || data.form_key || null },
    });
    return { status: "form_recorded", event };
  }

  return { status: "ignored", event };
}
