import { Router } from "express";
import { verifyGraph8Webhook } from "../middleware/verify-graph8-webhook.js";
import { processVisitorEvent } from "../services/visitor-workflow.js";
import { processMeetingEvent } from "../services/meeting-workflow.js";
import { processEngagementEvent } from "../services/engagement-workflow.js";
import { getGraph8Event } from "../utils/graph8-event.js";

const router = Router();
const visitorEvents = new Set(["visitor.identified", "intent.signal"]);
const meetingEvents = new Set([
  "meeting.booked",
  "meeting.cancelled",
  "meeting.rescheduled",
  "meeting.no_show",
]);

function requireValidSignature(req, res) {
  if (verifyGraph8Webhook(req)) {
    return true;
  }

  res.status(401).json({ error: "Invalid webhook signature" });
  return false;
}

router.post("/", async (req, res) => {
  if (!requireValidSignature(req, res)) return;

  try {
    const { normalizedEvent } = getGraph8Event(req.body || {});
    const result = visitorEvents.has(normalizedEvent)
      ? await processVisitorEvent(req.body)
      : meetingEvents.has(normalizedEvent)
        ? await processMeetingEvent(req.body)
        : await processEngagementEvent(req.body);
    return res.status(200).json(result);
  } catch (error) {
    console.error("[WEBHOOK] Processing error:", error);
    return res.status(500).json({ error: "Failed to process webhook" });
  }
});

router.post("/signals/visitor", async (req, res) => {
  if (!requireValidSignature(req, res)) {
    return;
  }

  try {
    const result = await processVisitorEvent(req.body);
    return res.status(200).json(result);
  } catch (error) {
    console.error("[VISITOR] Processing error:", error);
    return res.status(500).json({ error: "Failed to process visitor event" });
  }
});

router.post("/appointments/booked", async (req, res) => {
  if (!requireValidSignature(req, res)) {
    return;
  }

  try {
    // Handles meeting.booked + meeting.cancelled + meeting.rescheduled.
    const result = await processMeetingEvent(req.body);
    if (result.status !== "ignored") return res.status(200).json(result);
    // Fall through to engagement handler (replies, sequence, forms).
    const engaged = await processEngagementEvent(req.body);
    return res.status(200).json(engaged);
  } catch (error) {
    console.error("[MEETING] Processing error:", error);
    return res.status(500).json({ error: "Failed to process meeting" });
  }
});

router.post("/engagement", async (req, res) => {
  if (!requireValidSignature(req, res)) {
    return;
  }
  try {
    const result = await processEngagementEvent(req.body);
    return res.status(200).json(result);
  } catch (error) {
    console.error("[ENGAGEMENT] Processing error:", error);
    return res.status(500).json({ error: "Failed to process engagement" });
  }
});

export default router;