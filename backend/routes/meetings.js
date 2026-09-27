import { Router } from "express";
import { listMeetingEventTypes, listAvailableSlots, requestBooking, liveBookingEnabled } from "../services/meeting-service.js";

const router = Router();

// Read-only scheduling metadata (safe, never books anything).
router.get("/meeting/event-types", async (_req, res) => {
  const result = await listMeetingEventTypes();
  return res.json({ ...result, liveBooking: liveBookingEnabled });
});

router.get("/meeting/slots", async (req, res) => {
  try {
    const result = await listAvailableSlots({
      eventTypeId: req.query.event_type_id,
      start: req.query.start,
      end: req.query.end,
      timeZone: req.query.time_zone || req.query.timezone || null,
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// Visitor booking request. Demo-safe by default (records a labelled demo
// booking, cancels recovery). Real Graph8 booking only when explicitly
// enabled via GRAPH8_MEETING_LIVE_BOOKING=true.
router.post("/meetings/request", async (req, res) => {
  try {
    const result = await requestBooking({
      eventTypeId: req.body?.event_type_id ?? req.body?.eventTypeId,
      slot: req.body?.slot ?? req.body?.start_time,
      name: req.body?.name ?? req.body?.attendeeName,
      email: req.body?.email ?? req.body?.attendeeEmail,
      company: req.body?.company ?? req.body?.companyName,
      domain: req.body?.domain ?? req.body?.company_domain,
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

export default router;
