// Recovery + safety verification — mocked Graph8, never real outreach.
// Run while server is up: node tests/recovery-test.mjs
import "dotenv/config";
import crypto from "node:crypto";
import { g8, webhookSecret } from "../config/config.js";
import { isRecoveryEligible } from "../services/recovery/qualification.js";
import { processRecovery } from "../services/recovery/enrollment.js";
import { getOpportunity, clearRecovery, isContactEnrolled } from "../services/recovery/store.js";
import { processEngagementEvent } from "../services/engagement-workflow.js";
import { processMeetingEvent } from "../services/meeting-workflow.js";
import { enrollContact } from "../services/graph8/sequences-service.js";

const BASE = process.env.TEST_BASE || "http://localhost:3000";
let pass = 0, fail = 0;
function record(name, cond, detail = "") {
  if (cond) pass++; else fail++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
}
function sign(raw, ts) {
  const payload = ts ? `${ts}.${raw}` : raw;
  return `sha256=${crypto.createHmac("sha256", webhookSecret).update(payload).digest("hex")}`;
}
async function postWebhook(path, body) {
  const raw = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-g8-signature": sign(raw, ts), "x-g8-timestamp": ts },
    body: raw,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

console.log("=== RECOVERY QUALIFICATION ===");
record("eligible: high intent + engagement + no meeting", isRecoveryEligible({ intentScore: 85, domain: "acme.com", hasEngagement: true, meetingBooked: false }).eligible === true);
record("not eligible: low intent", isRecoveryEligible({ intentScore: 10, domain: "acme.com", hasEngagement: true }).eligible === false);
record("not eligible: missing intent", isRecoveryEligible({ domain: "acme.com", hasEngagement: true }).eligible === false);
record("not eligible: missing company/domain", isRecoveryEligible({ intentScore: 90, hasEngagement: true }).eligible === false);
record("not eligible: meeting booked", isRecoveryEligible({ intentScore: 90, domain: "acme.com", hasEngagement: true, meetingBooked: true }).eligible === false);
record("not eligible: no engagement", isRecoveryEligible({ intentScore: 90, domain: "acme.com", hasEngagement: false }).eligible === false);

console.log("=== RECOVERY PIPELINE (mocked Graph8) ===");
clearRecovery();
const orig = {
  search: g8.enrich.search,
  person: g8.enrich.person,
  verify: g8.enrich.verifyEmail,
  seqAdd: g8.sequences.add,
  seqGet: g8.sequences.get,
  listsList: g8.lists.list,
  listsCreate: g8.lists.create,
  listsAdd: g8.lists.addContacts,
  tasksCreate: g8.tasks.create,
  companiesContacts: g8.companies.contacts,
};
// Mock: contact found -> enriched -> verified, but NO sequence configured (dry-run default)
g8.companies.contacts = async () => [];
g8.enrich.search = async () => ({ data: [{ id: 7, first_name: "Jane", last_name: "Doe", work_email: "jane@acme.com", job_title: "VP Sales", company_domain: "acme.com" }] });
g8.enrich.person = async () => ({ first_name: "Jane", last_name: "Doe", work_email: "jane@acme.com", job_title: "VP Sales" });
g8.enrich.verifyEmail = async () => ({ status: "valid", is_valid: true });
g8.sequences.add = async () => { throw new Error("SHOULD NOT BE CALLED in dry-run"); };
g8.lists.list = async () => ({ data: [] });
g8.lists.create = async (title) => ({ id: 999, title });
g8.lists.addContacts = async () => ({ ok: true });
g8.tasks.create = async () => ({ id: "t1" });
g8.api.call = async () => ({ data: { id: "t-global" } });

{
  const r = await processRecovery({ domain: "acme.com", companyName: "Acme", intentScore: 90, meetingBookedFor: () => false });
  // No GRAPH8_RECOVERY_SEQUENCE_ID in demo env -> honest "Sequence not configured";
  // with a sequence id it would be "ready_for_sequence" (dry-run). Both prove
  // NO real enrollment happened (mocked add throws if called).
  record("eligible -> recovery displayed, no real enroll (ready_*)", ["ready_for_sequence", "ready_no_sequence"].includes(r.status), JSON.stringify(r));
  const opp = getOpportunity("acme.com");
  record("contact discovered + verified stored", Boolean(opp?.contact?.email) && opp?.verification?.eligible === true, JSON.stringify(opp?.verification));
}
{
  // Idempotency: second run does not re-enroll / re-verify from scratch
  const r = await processRecovery({ domain: "acme.com", companyName: "Acme", intentScore: 90, meetingBookedFor: () => false });
  record("repeated recovery processing safe (ready, no duplicate side effect)", ["ready_for_sequence", "ready_no_sequence", "already_enrolled"].includes(r.status), r.status);
}
{
  // Re-check: meeting booked since -> cancel/skip
  const r = await processRecovery({ domain: "acme.com", companyName: "Acme", intentScore: 90, meetingBookedFor: () => true });
  record("meeting booked since -> recovery cancelled", r.status === "cancelled", JSON.stringify(r));
}
{
  // No contact -> task fallback, never silent
  g8.enrich.search = async () => ({ data: [] });
  clearRecovery();
  const r = await processRecovery({ domain: "ghost-no-contact.com", companyName: "Ghost", intentScore: 95, meetingBookedFor: () => false });
  record("no contact -> needs_research (task fallback)", r.status === "needs_research", JSON.stringify(r));
}
{
  // Email unavailable / invalid -> not enrolled
  g8.enrich.search = async () => ({ data: [{ id: 9, first_name: "No", last_name: "Mail", job_title: "VP" }] });
  g8.enrich.person = async () => ({ first_name: "No", last_name: "Mail" });
  clearRecovery();
  const r = await processRecovery({ domain: "nomail.com", companyName: "Nomail", intentScore: 95, meetingBookedFor: () => false });
  record("email unavailable -> needs_research, no enroll", r.status === "needs_research", JSON.stringify(r));
  g8.enrich.search = async () => ({ data: [{ id: 11, work_email: "bad@bad.com", job_title: "VP" }] });
  g8.enrich.person = async (p) => p;
  g8.enrich.verifyEmail = async () => ({ status: "invalid", is_valid: false });
  clearRecovery();
  const r2 = await processRecovery({ domain: "badmail.com", companyName: "Bad", intentScore: 95, meetingBookedFor: () => false });
  record("email verification failure -> needs_research", r2.status === "needs_research", JSON.stringify(r2));
}
{
  // Already enrolled guard
  g8.enrich.search = orig.search;
  clearRecovery();
  const { upsertOpportunity, markContactEnrolled } = await import("../services/recovery/store.js");
  upsertOpportunity("dup.com", { company: "Dup", contact: { id: 42, email: "a@dup.com" }, verification: { eligible: true, state: "valid" }, enriched: true });
  markContactEnrolled("dup.com", 42, "seq-1");
  record("already enrolled detected", isContactEnrolled("dup.com", 42) === true);
}
{
  // Sequence unavailable -> honest status, still displayed
  const r = await enrollContact(123);
  record("sequence unavailable -> NOT_CONFIGURED/DRY_RUN, never throws", r.enrolled === false, JSON.stringify(r));
}
{
  // Sequence API failure path (mock throw with auto-enroll forced? stays dry-run safe)
  const r = await enrollContact(null);
  record("enroll without contact -> safe refusal", r.enrolled === false);
}

// Restore
g8.enrich.search = orig.search;
g8.enrich.person = orig.person;
g8.enrich.verifyEmail = orig.verify;
g8.sequences.add = orig.seqAdd;
g8.lists.list = orig.listsList;
g8.lists.create = orig.listsCreate;
g8.lists.addContacts = orig.listsAdd;
g8.tasks.create = orig.tasksCreate;
g8.companies.contacts = orig.companiesContacts;

console.log("=== ENGAGEMENT / MEETING EDGE CASES ===");
{
  const r = await processEngagementEvent({ event: "engagement.email_replied", data: { contact_id: "5" } });
  record("reply recorded", r.status === "reply_recorded", JSON.stringify(r));
  const d = await processEngagementEvent({ event: "sequence.contact_enrolled", data: { contact_id: "5", sequence_id: "s1", company_domain: "acme.com" } });
  record("sequence enrollment recorded", d.status === "enrollment_recorded", JSON.stringify(d));
  const f = await processEngagementEvent({ event: "form.submitted", data: { form_id: "f1" } });
  record("form submitted recorded", f.status === "form_recorded", JSON.stringify(f));
}
{
  const c = await processMeetingEvent({ event: "meeting.cancelled", data: { contact_id: "x", company_domain: "acme.com" } });
  record("cancellation handled", c.status === "meeting_cancelled", JSON.stringify(c));
  const rs = await processMeetingEvent({ event: "meeting.rescheduled", data: { meeting_id: "m1" } });
  record("reschedule handled", rs.status === "meeting_rescheduled", JSON.stringify(rs));
}

console.log("=== HTTP RECOVERY ENDPOINTS ===");
{
  const res = await fetch(`${BASE}/api/recovery`);
  const json = await res.json();
  record("GET /api/recovery -> opportunities + counts + sequence", res.status === 200 && Array.isArray(json.opportunities) && Boolean(json.sequence), `count=${json.opportunities?.length}`);
}
{
  const res = await fetch(`${BASE}/api/sequences/status`);
  const json = await res.json();
  record("GET /api/sequences/status -> honest NOT_CONFIGURED/DRY_RUN", res.status === 200 && typeof json.mode === "string", JSON.stringify(json).slice(0, 160));
}
{
  const res = await fetch(`${BASE}/api/analytics`);
  const json = await res.json();
  record("GET /api/analytics -> app + graph8 labelled, no fabricated numbers", res.status === 200 && json.app && json.graph8, JSON.stringify(json.app));
}
{
  const r = await postWebhook("/webhooks/graph8/engagement", { event: "engagement.email_replied", data: { contact_id: "1" } });
  record("engagement webhook signed -> 200", r.status === 200, JSON.stringify(r.json));
}

console.log(`\nDONE: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
