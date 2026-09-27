import { Router } from "express";
import { listOpportunities, getOpportunity } from "../services/recovery/store.js";
import { processRecovery } from "../services/recovery/enrollment.js";
import { listEvents, getLatestMeeting } from "../services/event-store.js";
import { sequenceStatus, getSequence, previewSequence, ensureRecoverySequence } from "../services/graph8/sequences-service.js";
import { recoveryListStatus } from "../services/graph8/lists-service.js";
import { listInboxReplies } from "../services/graph8/inbox-service.js";
import { workflowStatus } from "../services/graph8/workflows-service.js";
import { skillsStatus } from "../services/graph8/skills-service.js";
import { graph8Configured } from "../config/config.js";
import { g8 } from "../config/config.js";

const router = Router();

function meetingBookedFor(domain) {
  const key = String(domain || "").toLowerCase();
  return listEvents(500).some(
    (e) => e.type === "meeting_booked" && String(e.domain || "").toLowerCase() === key
  );
}

// INBOUND + RECOVERY lifecycle for the dashboard.
router.get("/recovery", (_req, res) => {
  const opportunities = listOpportunities();
  const counts = {
    total: opportunities.length,
    candidates: opportunities.filter((o) => o.status === "candidate").length,
    ready: opportunities.filter((o) => ["ready_for_sequence", "ready_no_sequence"].includes(o.status)).length,
    enrolled: opportunities.filter((o) => o.status === "enrolled").length,
    needsResearch: opportunities.filter((o) => o.status === "needs_research").length,
  };
  return res.json({
    opportunities,
    counts,
    sequence: sequenceStatus(),
    list: recoveryListStatus(),
  });
});

router.get("/recovery/:domain", (req, res) => {
  const opp = getOpportunity(req.params.domain);
  if (!opp) return res.status(404).json({ error: "Recovery opportunity not found" });
  return res.json({ opportunity: opp });
});

// Trigger the recovery pipeline for one account (dry-run safe).
router.post("/recovery/:domain/process", async (req, res) => {
  try {
    const domain = String(req.params.domain || "").toLowerCase();
    const opp = getOpportunity(domain);
    const result = await processRecovery({
      domain,
      companyName: req.body?.company || opp?.company || null,
      companyId: req.body?.companyId || opp?.companyId || null,
      intentScore: req.body?.intentScore ?? opp?.intentScore ?? null,
      meetingBookedFor,
    });
    return res.json(result);
  } catch (error) {
    console.error("[RECOVERY] process error:", error);
    return res.status(500).json({ error: "Failed to process recovery" });
  }
});

// Explicit enrollment endpoint (same safety gates as the pipeline).
router.post("/recovery/:domain/enroll", async (req, res) => {
  try {
    const domain = String(req.params.domain || "").toLowerCase();
    const result = await processRecovery({
      domain,
      companyName: req.body?.company || null,
      meetingBookedFor,
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: "Failed to enroll recovery" });
  }
});

// OUTBOUND: sequencer status (Graph8 metric when configured).
router.get("/sequences/status", async (_req, res) => {
  const status = sequenceStatus();
  if (status.mode === "NOT_CONFIGURED") return res.json({ ...status, source: "app" });
  const [details, preview] = await Promise.all([getSequence(), previewSequence()]);
  return res.json({ ...status, source: "graph8", details, preview });
});

// OUTBOUND: provision the draft recovery sequence (Day 0/3/7, stops on reply).
// Creates a DRAFT workspace object only — no contacts, never run, nothing sent.
// Honors GRAPH8_RECOVERY_AUTO_PROVISION; refuses in test env.
router.post("/sequences/provision", async (_req, res) => {
  try {
    const result = await ensureRecoverySequence();
    return res.json({ ...result, source: result.provisioned ? "graph8" : "app" });
  } catch (error) {
    return res.status(500).json({ provisioned: false, mode: "ERROR", reason: error.message });
  }
});

// OUTBOUND: inbox / reply visibility (Graph8 metric, draft/review only).
router.get("/inbox/status", async (req, res) => {
  const limit = Number(req.query.limit) || 10;
  const out = await listInboxReplies(limit);
  return res.json({ ...out, source: out.mode === "LIVE" ? "graph8" : "app" });
});

// ANALYTICS: Graph8 metrics first, app-derived labelled, never fabricated.
router.get("/analytics", async (_req, res) => {
  const events = listEvents(500);
  const app = {
    source: "app",
    visitorsIdentified: events.filter((e) => e.type === "visitor_identified").length,
    meetingsBooked: events.filter((e) => e.type === "meeting_booked").length,
    recoveryCreated: events.filter((e) => e.type === "recovery_created").length,
    recoveryEnrolled: events.filter((e) => e.type === "recovery_enrolled").length,
    replies: events.filter((e) => e.type === "reply_received").length,
  };
  let graph8 = { source: "graph8", mode: "NOT_CONFIGURED" };
  if (graph8Configured) {
    try {
      const stats = await g8.intent.stats();
      graph8 = { source: "graph8", mode: "LIVE", intent: stats };
    } catch (error) {
      graph8 = { source: "graph8", mode: "ERROR", reason: error.message };
    }
  }
  return res.json({ app, graph8, meeting: getLatestMeeting() });
});

// OPTIONAL integrations visibility (workflows / skills).
router.get("/automation/status", (_req, res) => {
  return res.json({
    workflow: workflowStatus(),
    skills: skillsStatus(),
    sequence: sequenceStatus(),
  });
});

export default router;
