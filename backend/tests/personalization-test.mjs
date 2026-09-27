// Personalization + campaign verification — unit + safe live reads.
// Run while server is up: node tests/personalization-test.mjs
// Live calls used: resolve-visitor?domain= (1 enrichment credit, read-only).
// Mutating Graph8 ops are mocked. Nothing is enrolled, sent, or run.
import "dotenv/config";
import { g8 } from "../config/config.js";
import {
  buildPersonalization,
  personalizationFamily,
} from "../services/personalization-content.js";
import { classifyTraffic } from "../services/traffic-classifier.js";
import { enrollContact, recoverySequenceSteps, ensureRecoverySequence } from "../services/graph8/sequences-service.js";

const BASE = process.env.TEST_BASE || "http://localhost:3000";
let pass = 0, fail = 0;
function record(name, cond, detail = "") {
  if (cond) pass++; else fail++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
}

console.log("=== VARIANT SELECTION (unit) ===");
{
  // 1. Unknown visitor -> default family, generic, honest reason.
  const c = buildPersonalization({ companyName: null, trafficType: "unknown" });
  record("unknown visitor -> default/generic + reason", c.family === "default" && c.variant === "generic" && /default experience/i.test(c.reason), JSON.stringify({ family: c.family, reason: c.reason }));
}
{
  // 2. Known company, medium intent, non-tech -> default family (no over-claim).
  const t = classifyTraffic({ intentScore: 50, domain: "hospital.org", companyName: "Hospital" });
  const c = buildPersonalization({ companyName: "Hospital", industry: "Healthcare", trafficType: t, intentScore: 50 });
  record("medium non-tech -> default family", t === "medium_intent" && c.family === "default", `${t}/${c.family}`);
}
{
  // 3. Medium intent tech company -> saas family.
  const t = classifyTraffic({ intentScore: 50, domain: "acme.com", companyName: "Acme" });
  const c = buildPersonalization({ companyName: "Acme", industry: "SaaS", trafficType: t, intentScore: 50 });
  record("medium tech -> saas family", c.family === "saas" && /saas/i.test(c.reason), `${c.family}: ${c.reason}`);
}
{
  // 4. High-intent visitor -> enterprise family, reason carries the score.
  const t = classifyTraffic({ intentScore: 85, domain: "acme.com", companyName: "Acme" });
  const c = buildPersonalization({ companyName: "Acme", industry: "SaaS", trafficType: t, intentScore: 85 });
  record("high intent -> enterprise + score in reason", c.family === "enterprise" && c.reason.includes("85"), c.reason);
}
{
  // 5. Target account (explicit list match would need env; unit uses the type directly).
  const c = buildPersonalization({ companyName: "Acme", trafficType: "target_account", intentScore: 90 });
  record("target_account -> enterprise", c.family === "enterprise" && /target account/i.test(c.reason), c.reason);
  record("family helper agrees", personalizationFamily({ trafficType: "target_account" }) === "enterprise");
}

console.log("=== SEQUENCE CADENCE (unit) ===");
{
  const steps = recoverySequenceSteps();
  const day = 86400;
  const ok =
    steps.length === 3 &&
    steps.every((s) => s.step_type === "EMAIL") &&
    steps[0].time_interval === 0 &&
    steps[1].time_interval === 3 * day &&
    steps[2].time_interval === 7 * day &&
    steps.every((s) => s.step_data?.subject && s.step_data?.body);
  record("Day 0/3/7 email steps with subjects+bodies", ok, steps.map((s) => s.time_interval).join(","));
}

console.log("=== ENROLL GUARDS (mocked add, env flipped in-process only) ===");
const origAdd = g8.sequences.add;
const origEnv = process.env.GRAPH8_RECOVERY_AUTO_ENROLL;
{
  const calls = [];
  g8.sequences.add = async (body, key) => { calls.push({ body, key }); return { ok: true }; };
  process.env.GRAPH8_RECOVERY_AUTO_ENROLL = "true";
  // 11. Open-data contact without CRM id -> honest refusal, add NEVER called.
  const r = await enrollContact("jane@acme.com", { idempotencyKey: "test:no-crm-id" });
  record("non-CRM contact -> needsCrmContact, add not called", r.needsCrmContact === true && calls.length === 0, r.reason);
  // Numeric CRM id -> add called once with list segmentation + idempotency key.
  const r2 = await enrollContact(123, { idempotencyKey: "test:crm-id" });
  record(
    "CRM contact -> add with listId + idempotency key",
    r2.enrolled === true && calls.length === 1 && calls[0].body.listId === 3 && calls[0].body.contactIds[0] === 123 && calls[0].key === "test:crm-id",
    JSON.stringify(calls[0]?.body)
  );
  process.env.GRAPH8_RECOVERY_AUTO_ENROLL = origEnv;
  g8.sequences.add = origAdd;
}

console.log("=== PROVISIONED SEQUENCE (live read-only) ===");
{
  // Configured id must resolve in Graph8 (proves the draft is real, not faked).
  const r = await ensureRecoverySequence({ provision: false });
  record("configured sequence id resolves live", r.mode === "EXISTS" && Boolean(r.sequenceId), `${r.mode} ${r.sequenceId || r.reason || ""}`);
}

console.log("=== LIVE RESOLVE-VISITOR (1 enrichment credit) ===");
{
  const res = await fetch(`${BASE}/api/resolve-visitor?domain=graph8.com`);
  const json = await res.json();
  const exp = json.experience || {};
  record(
    "resolve graph8.com -> family/reason/signals present",
    res.status === 200 && typeof exp.family === "string" && typeof exp.reason === "string" && Array.isArray(exp.signals),
    `family=${exp.family} signals=${exp.signals?.length}`
  );
}

console.log(`\nDONE: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
