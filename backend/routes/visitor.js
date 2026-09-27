import { Router } from "express";
import { resolveVisitor } from "../services/visitor-resolution-service.js";
import { checkGraph8Api, graph8Configured, recoveryStatus } from "../config/config.js";
import { listEvents, getLatestMeeting, getLatestCoaching, getLatestVisitor } from "../services/event-store.js";
import { listOpportunities } from "../services/recovery/store.js";
import { sequenceStatus } from "../services/graph8/sequences-service.js";
import { voiceStatus } from "../services/voice-coaching-service.js";

const router = Router();

router.get("/resolve-visitor", async (req, res) => {
  const visitorIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const domain = req.query.domain || req.query.company_domain || null;
  const company = req.query.company || req.query.company_name || null;

  try {
    const resolved = await resolveVisitor({ ip: visitorIp, domain, company });
    return res.json(resolved);
  } catch (error) {
    console.error("[VISITOR] Resolution error:", error);
    return res.status(500).json({ error: "Failed to resolve visitor" });
  }
});

// Read-only health check — no billable operations, contacts.list(limit:1).
router.get("/graph8/status", async (_req, res) => {
  if (!graph8Configured) {
    return res.json({ connected: false, provider: "graph8", error: "Graph8 API key not configured" });
  }
  try {
    await checkGraph8Api();
    return res.json({ connected: true, provider: "graph8" });
  } catch (error) {
    const status = error?.status || error?.response?.status;
    return res.json({
      connected: false,
      provider: "graph8",
      error: status === 429 ? "Rate limited" : error.message,
    });
  }
});

router.get("/events", (req, res) => {
  const limit = Number(req.query.limit) || 50;
  return res.json({ events: listEvents(limit) });
});

router.get("/state", (_req, res) => {
  const recovery = listOpportunities().slice(0, 20);
  const events = listEvents(500);
  return res.json({
    visitor: getLatestVisitor(),
    meeting: getLatestMeeting(),
    coaching: getLatestCoaching(),
    voice: voiceStatus(),
    graph8: { configured: graph8Configured },
    recovery: {
      opportunities: recovery,
      counts: {
        total: recovery.length,
        enrolled: events.filter((e) => e.type === "recovery_enrolled").length,
        replies: events.filter((e) => e.type === "reply_received").length,
      },
      sequence: sequenceStatus(),
      recoveryConfig: recoveryStatus(),
    },
  });
});

export default router;
