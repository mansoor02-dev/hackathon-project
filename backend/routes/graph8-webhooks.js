import { Router } from "express";
import { verifyGraph8Webhook } from "../middleware/verify-graph8-webhook.js";
import { processVisitorEvent } from "../services/visitor-workflow.js";
import { processMeetingEvent } from "../services/meeting-workflow.js";

const router = Router();

function requireValidSignature(req, res) {
  if (verifyGraph8Webhook(req)) {
    return true;
  }

  res.status(401).json({ error: "Invalid webhook signature" });
  return false;
}

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
    const result = await processMeetingEvent(req.body);
    return res.status(200).json(result);
  } catch (error) {
    console.error("[MEETING] Processing error:", error);
    return res.status(500).json({ error: "Failed to process meeting" });
  }
});

export default router;