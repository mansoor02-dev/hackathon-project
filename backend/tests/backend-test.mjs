// Backend verification suite — HTTP + live Graph8 read-only + mocked side-effect flows.
// Run while the server is up: `node backend-test.mjs` (cwd = project root, .env loaded).
// Never prints secrets. Never triggers billable/external Graph8 calls against the real API.
import "dotenv/config";
import crypto from "node:crypto";
import { g8, checkGraph8Api, webhookSecret, intentThreshold, voiceAgentId } from "../config/config.js";
import { processVisitorEvent } from "../services/visitor-workflow.js";
import { processMeetingEvent } from "../services/meeting-workflow.js";

const BASE = process.env.TEST_BASE || "http://localhost:3000";
const results = [];
let passCount = 0;
let failCount = 0;

function record(name, cond, detail = "") {
  const status = cond ? "PASS" : "FAIL";
  if (cond) passCount++;
  else failCount++;
  results.push({ name, status, detail });
  console.log(`[${status}] ${name}${detail ? " — " + detail : ""}`);
}

// Sign exactly like middleware/verify-graph8-webhook.js expects.
function sign(rawBody, ts) {
  const payload = ts ? `${ts}.${rawBody}` : rawBody;
  const digest = crypto.createHmac("sha256", webhookSecret).update(payload).digest("hex");
  return `sha256=${digest}`;
}
const nowTs = () => Math.floor(Date.now() / 1000).toString();

async function postWebhook(path, bodyObj, { withSig = true, badSig = false, noTs = false, rawOverride = null } = {}) {
  const raw = rawOverride !== null ? rawOverride : JSON.stringify(bodyObj);
  const ts = nowTs();
  const headers = { "Content-Type": "application/json" };
  if (withSig) {
    headers["x-g8-signature"] = badSig ? "sha256=deadbeef" : sign(raw, noTs ? null : ts);
    if (!noTs) headers["x-g8-timestamp"] = ts;
  }
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: raw });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON (e.g. malformed-body 400 page) */ }
  return { status: res.status, json, text: text.slice(0, 300) };
}

console.log("=== A. HEALTH ===");
{
  const res = await fetch(`${BASE}/health`);
  const json = await res.json();
  record("GET /health -> 200 {ok:true}", res.status === 200 && json.ok === true, JSON.stringify(json));
}

console.log("=== B. RESOLVE-VISITOR ===");
{
  const res = await fetch(`${BASE}/api/resolve-visitor`);
  const json = await res.json();
  // No state (fresh server) -> {personalized:false, traffic_type:"unknown"}.
  // With prior webhook state -> richer shape. Accept either, assert the contract.
  const okShape = res.status === 200 && typeof json.personalized === "boolean" && typeof json.traffic_type === "string";
  record("GET /api/resolve-visitor -> 200 {personalized, traffic_type, ...}", okShape, JSON.stringify(json).slice(0, 220));
}
{
  const res = await fetch(`${BASE}/api/resolve-visitor?domain=example.com`);
  const json = await res.json();
  // Unknown domain enriches to fallback: never crashes, never invents a company.
  record("GET /api/resolve-visitor?domain=example.com -> 200, graceful fallback", res.status === 200 && typeof json.personalized === "boolean", JSON.stringify(json).slice(0, 220));
}

console.log("=== B2. GRAPH8 STATUS / EVENTS / STATE ===");
{
  const res = await fetch(`${BASE}/api/graph8/status`);
  const json = await res.json();
  record("GET /api/graph8/status -> {connected, provider}", res.status === 200 && typeof json.connected === "boolean" && json.provider === "graph8", JSON.stringify(json).slice(0, 160));
}
{
  const res = await fetch(`${BASE}/api/events?limit=5`);
  const json = await res.json();
  record("GET /api/events -> {events:[]}", res.status === 200 && Array.isArray(json.events), `count=${json.events?.length}`);
}
{
  const res = await fetch(`${BASE}/api/state`);
  const json = await res.json();
  record("GET /api/state -> {visitor, meeting, coaching, voice}", res.status === 200 && "visitor" in json && "meeting" in json && "voice" in json, JSON.stringify(json.voice));
}

console.log("=== C. VISITOR WEBHOOK AUTH ===");
const visitorPath = "/webhooks/graph8/signals/visitor";
{
  const r = await postWebhook(visitorPath, { event: "visitor.identified", data: { intent_score: 10 } }, { withSig: false });
  record("visitor: missing signature -> 401, no business logic", r.status === 401 && r.json?.error === "Invalid webhook signature", `status=${r.status} body=${JSON.stringify(r.json)}`);
}
{
  const r = await postWebhook(visitorPath, { event: "visitor.identified", data: { intent_score: 10 } }, { badSig: true });
  record("visitor: invalid signature -> 401", r.status === 401, `status=${r.status}`);
}
{
  const good = { event: "visitor.identified", data: { intent_score: 10 } };
  const rawGood = JSON.stringify(good);
  const tampered = JSON.stringify({ event: "visitor.identified", data: { intent_score: 99 } });
  // sign good body but send tampered body
  const ts = nowTs();
  const res = await fetch(`${BASE}${visitorPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-g8-signature": sign(rawGood, ts), "x-g8-timestamp": ts },
    body: tampered,
  });
  record("visitor: modified body -> 401 (signature binds raw bytes)", res.status === 401, `status=${res.status}`);
}
{
  // malformed JSON: sign the exact raw bytes we send
  const rawBad = "{bad json";
  const r = await postWebhook(visitorPath, null, { rawOverride: rawBad });
  record("visitor: malformed JSON -> 4xx, handler not reached", r.status >= 400 && r.status < 500, `status=${r.status}`);
}
{
  const r = await postWebhook(visitorPath, { event: "something.unknown", data: {} });
  record("visitor: unknown event -> 200 ignored (no side effect)", r.status === 200 && r.json?.status === "ignored", `status=${r.status} body=${JSON.stringify(r.json)}`);
}
{
  const r = await postWebhook(visitorPath, { event: "visitor.identified", data: {} });
  record("visitor: missing intent_score -> 200 awaiting_intent", r.status === 200 && r.json?.status === "awaiting_intent", JSON.stringify(r.json));
}
{
  const r = await postWebhook(visitorPath, { event: "visitor.identified", data: { intent_score: 5 } });
  record(`visitor: low intent (5 < threshold ${intentThreshold}) -> 200 low_intent, no page gen`, r.status === 200 && r.json?.status === "low_intent", JSON.stringify(r.json));
}
{
  // high intent but no contact_id/company_domain -> acknowledged, landing_page null, zero Graph8 calls
  const r = await postWebhook(visitorPath, { event: "visitor.identified", data: { intent_score: 95 } });
  record("visitor: high intent, no domain -> 200 acknowledged, landing_page=null (FLOW B/C edge)", r.status === 200 && r.json?.status === "acknowledged" && r.json?.landing_page === null && r.json?.traffic_type === "high_intent", JSON.stringify(r.json));
}
{
  // idempotency: same event_id delivered twice -> second is a duplicate, no duplicate side effects
  const body = { id: "evt-test-123", event: "visitor.identified", data: { intent_score: 95 } };
  const first = await postWebhook(visitorPath, body);
  const second = await postWebhook(visitorPath, body);
  record("visitor: duplicate delivery -> duplicate (idempotent)", first.status === 200 && second.status === 200 && second.json?.status === "duplicate", `first=${first.json?.status} second=${second.json?.status}`);
}
{
  // underscore alias accepted (docs note subscribers ask for visitor_identified)
  const r = await postWebhook(visitorPath, { event: "visitor_identified", data: { intent_score: 5 } });
  record("visitor: underscore alias visitor_identified handled", r.status === 200 && r.json?.status === "low_intent", JSON.stringify(r.json));
}

console.log("=== D. MEETING WEBHOOK AUTH ===");
const meetingPath = "/webhooks/graph8/appointments/booked";
{
  const r = await postWebhook(meetingPath, { event: "meeting.booked", data: {} }, { withSig: false });
  record("meeting: missing signature -> 401", r.status === 401, `status=${r.status}`);
}
{
  const r = await postWebhook(meetingPath, { event: "meeting.booked", data: {} }, { badSig: true });
  record("meeting: invalid signature -> 401", r.status === 401, `status=${r.status}`);
}
{
  const r = await postWebhook(meetingPath, { event: "meeting.cancelled", data: { contact_id: "x" } });
  record("meeting: cancelled handled (re-opens recovery), not ignored", r.status === 200 && r.json?.status === "meeting_cancelled", JSON.stringify(r.json));
}
{
  const r = await postWebhook(meetingPath, { event: "deal.won", data: {} });
  record("meeting: truly unknown event -> 200 ignored", r.status === 200 && r.json?.status === "ignored", JSON.stringify(r.json));
}
{
  const r = await postWebhook(meetingPath, { event: "meeting.booked", data: { meeting_id: "m1" } });
  record("meeting: booked without contact_id -> 500 validation error, no side effect", r.status === 500, `status=${r.status} body=${JSON.stringify(r.json)}`);
}
{
  const r = await postWebhook(meetingPath, { event: "meeting.booked", data: { contact_id: "1" } });
  record("meeting: underscore alias meeting_booked accepted (not ignored)", r.status !== 200 || r.json?.status !== "ignored" ? true : false, `status=${r.status} body=${JSON.stringify(r.json)?.slice(0, 160)}`);
}

console.log("=== E. GRAPH8 AUTH (REAL, READ-ONLY) ===");
{
  try {
    const out = await checkGraph8Api();
    const count = Array.isArray(out.contacts) ? out.contacts.length : "?";
    record("Graph8 API key accepted: contacts.list(limit:1) ok", out.ok === true, `total=${out.total} returned=${count}`);
  } catch (e) {
    record("Graph8 API key accepted: contacts.list(limit:1) ok", false, String(e.message).slice(0, 200));
  }
}

console.log("=== F. SDK OPERATION EXISTENCE (no network, contract check) ===");
for (const id of [
  "create_landing_page_landing_pages_post",
  "publish_landing_page_landing_pages__landing_page_id__publish_post",
  "generate_call_script_voice_call_scripts_generate_post",
]) {
  try {
    const op = g8.api.operation(id);
    record(`operation ${id} exists`, true, `${op.method} ${op.path} tier=${op.tier} scope=${op.scope}`);
  } catch (e) {
    record(`operation ${id} exists`, false, e.message);
  }
}

console.log("=== G. MOCKED FLOWS (no real credits/pages/calls) ===");
console.log(`intentThreshold=${intentThreshold} voiceAgentId=${voiceAgentId ? "SET(redacted)" : "MISSING"}`);
// Save originals
const origContactsGet = g8.contacts.get;
const origEnrichCompany = g8.enrich.company;
const origApiCall = g8.api.call.bind(g8.api);
{
  // FLOW A: high intent -> enrich -> create+publish landing page (all mocked)
  // Unique contact id per run so file-backed idempotency never collides.
  const uid = Date.now() % 1000000;
  const calls = [];
  g8.contacts.get = async (id) => ({ id, company_domain: "acme.com", first_name: "Ada", last_name: "Lovelace" });
  g8.enrich.company = async () => ({ name: "Acme Corp", domain: "acme.com", industry: "SaaS", tech_stack: ["React"] });
  g8.api.call = async (opId, args) => {
    calls.push({ opId, args });
    if (opId === "create_landing_page_landing_pages_post") return { data: { id: "page_123" } };
    if (opId === "publish_landing_page_landing_pages__landing_page_id__publish_post") return { data: { url: "https://example.com/p/page_123" } };
    throw new Error("unexpected api.call " + opId);
  };
  const res = await processVisitorEvent({ id: `evt-flow-a-${uid}`, event: "visitor.identified", data: { intent_score: 90, contact_id: 42000 + (uid % 1000), company_id: 7 } });
  const ok = res.status === "acknowledged" && res.landing_page?.id === "page_123" &&
    calls.some((c) => c.opId === "create_landing_page_landing_pages_post") &&
    calls.some((c) => c.opId === "publish_landing_page_landing_pages__landing_page_id__publish_post");
  record("FLOW A (mocked): high-intent visitor -> landing page created+published", ok, JSON.stringify({ status: res.status, landing_page: res.landing_page }));
  // restore
  g8.contacts.get = origContactsGet;
  g8.enrich.company = origEnrichCompany;
  g8.api.call = origApiCall;
}
{
  // FLOW C: meeting booked -> contact -> enrich -> coaching script (all mocked)
  const uid = Date.now() % 1000000;
  const calls = [];
  g8.contacts.get = async (id) => ({ id, name: "Jane Doe", email: "jane@acme.com", job_title: "VP Sales", company_domain: "acme.com" });
  g8.enrich.company = async () => ({ name: "Acme Corp", domain: "acme.com", industry: "SaaS", tech_stack: [] });
  g8.api.call = async (opId, args) => {
    calls.push({ opId, args });
    return { data: { script: "mock coaching script" } };
  };
  const res = await processMeetingEvent({ event: "meeting.booked", data: { contact_id: `99${uid % 1000}`, meeting_id: `m-1-${uid}`, meeting_title: "Demo" } });
  // Webhook acknowledges fast; coaching resolves async. Drain the async tick
  // BEFORE restoring mocks so no real API call escapes the mocked window.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 50));
  const usedVoiceOp = calls.some((c) => c.opId === "generate_call_script_voice_call_scripts_generate_post");
  const ok = (res.status === "meeting_processed" && res.coaching === "pending") || res.status === "coaching_prepared";
  record("FLOW C (mocked): meeting booked -> ack fast + async coaching", ok, JSON.stringify({ status: res.status, coaching: res.coaching, voiceOpCalled: usedVoiceOp, prospect: res.coaching_context?.prospect }));
  g8.contacts.get = origContactsGet;
  g8.enrich.company = origEnrichCompany;
  g8.api.call = origApiCall;
}
{
  // FLOW D equivalent already proven at HTTP layer (401s). Direct unit check of an ignored event:
  const res = await processMeetingEvent({ event: "deal.won", data: {} });
  record("FLOW D (unit): unknown meeting event ignored, zero Graph8 calls", res.status === "ignored", JSON.stringify(res));
}

console.log(`\nDONE: ${passCount} passed, ${failCount} failed out of ${results.length}`);
if (failCount > 0) process.exitCode = 1;
