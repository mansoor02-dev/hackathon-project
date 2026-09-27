import { g8, graph8Configured } from "../config/config.js";
import { recordEvent } from "./event-store.js";
import { cancelRecovery } from "./recovery/store.js";

// Visitor-facing meeting scheduling.
//
// Read path is always live Graph8 (read-only, safe):
//   event types -> availability slots.
// The write path is DEMO-SAFE by default: a booking request is recorded as a
// local `meeting_booked` event (visible in the dashboard, cancels recovery)
// and never touches the calendar API. A real Graph8 booking (billable,
// sends notifications) only happens when GRAPH8_MEETING_LIVE_BOOKING=true.
//
// Verified SDK ops used (nothing invented):
//   list_event_types_event_types_get,
//   get_available_slots_appointments_slots_get,
//   create_booking_appointments_bookings_post.

export const liveBookingEnabled =
  String(process.env.GRAPH8_MEETING_LIVE_BOOKING || "false").toLowerCase() === "true";

export async function listMeetingEventTypes() {
  if (!graph8Configured) return { mode: "NOT_CONFIGURED", event_types: [] };
  try {
    const res = await g8.api.call("list_event_types_event_types_get", { query: {} });
    const rows = res?.data ?? res?.event_types ?? (Array.isArray(res) ? res : []);
    const types = (Array.isArray(rows) ? rows : [])
      .map((t) => ({
        id: t.id,
        title: t.title || t.name || `Meeting type ${t.id}`,
        duration: t.length ?? t.duration ?? t.duration_minutes ?? null,
        hidden: Boolean(t.hidden),
      }))
      .filter((t) => t.id != null && !t.hidden);
    return { mode: "LIVE", event_types: types };
  } catch (error) {
    console.warn("[MEETINGS] event types failed:", error.message);
    return { mode: "ERROR", event_types: [], error: error.message };
  }
}

export async function listAvailableSlots({ eventTypeId, start, end, timeZone = null } = {}) {
  if (!graph8Configured) return { mode: "NOT_CONFIGURED", slots: {} };
  const id = Number(eventTypeId);
  if (!Number.isFinite(id)) throw new Error("event_type_id is required");
  if (!start || !end) throw new Error("start and end (ISO-8601) are required");
  try {
    const query = { event_type_id: id, start, end };
    if (timeZone) query.time_zone = timeZone;
    const res = await g8.api.call("get_available_slots_appointments_slots_get", { query });
    const data = res?.data ?? res;
    const slots = data?.slots && typeof data.slots === "object" ? data.slots : {};
    return { mode: "LIVE", slots };
  } catch (error) {
    console.warn("[MEETINGS] slots failed:", error.message);
    return { mode: "ERROR", slots: {}, error: error.message };
  }
}

function isEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function requestBooking({ eventTypeId = null, slot = null, name = null, email = null, company = null, domain = null } = {}) {
  const id = Number(eventTypeId);
  if (!Number.isFinite(id)) throw new Error("event_type_id is required");
  const startTime = slot ? new Date(slot) : null;
  if (!startTime || Number.isNaN(startTime.getTime())) throw new Error("slot (ISO-8601) is required");
  if (startTime.getTime() < Date.now() - 60 * 1000) throw new Error("slot must be in the future");
  const attendeeName = (name || "").trim();
  if (!attendeeName) throw new Error("name is required");
  if (!isEmail(email)) throw new Error("a valid email is required");
  const cleanDomain = (domain || "").trim().toLowerCase() || null;

  const types = await listMeetingEventTypes();
  const chosen = types.event_types.find((t) => Number(t.id) === id) || null;
  const title = chosen ? chosen.title : "Meeting";

  if (liveBookingEnabled) {
    const created = await g8.api.call("create_booking_appointments_bookings_post", {
      body: {
        event_type_id: id,
        start_time: startTime.toISOString(),
        attendees: [{ email: email.trim(), name: attendeeName }],
      },
    });
    const booking = created?.data ?? created;
    recordEvent("meeting_booked", {
      company: (company || "").trim() || null,
      domain: cleanDomain,
      metadata: {
        mode: "live",
        title,
        contactId: email.trim(),
        attendeeName,
        scheduledAt: startTime.toISOString(),
        bookedAt: new Date().toISOString(),
        bookingId: booking?.id || booking?.uid || booking?.booking_uid || null,
      },
    });
    if (cleanDomain) cancelRecovery(cleanDomain, "meeting booked");
    return { status: "meeting_booked", mode: "LIVE", booking, title, scheduledAt: startTime.toISOString() };
  }

  // Demo-safe default: no calendar API call, no notifications, no credits.
  // Recorded exactly like a webhook booking so the dashboard + recovery
  // behave identically; clearly labelled as demo.
  recordEvent("meeting_booked", {
    company: (company || "").trim() || null,
    domain: cleanDomain,
    metadata: {
      mode: "demo",
      title,
      contactId: email.trim(),
      attendeeName,
      scheduledAt: startTime.toISOString(),
      bookedAt: new Date().toISOString(),
    },
  });
  if (cleanDomain) cancelRecovery(cleanDomain, "meeting booked");
  return {
    status: "meeting_requested",
    mode: "DEMO",
    title,
    scheduledAt: startTime.toISOString(),
    reason: "GRAPH8_MEETING_LIVE_BOOKING=false — recorded as a demo booking, no calendar invitation sent",
  };
}
