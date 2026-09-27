import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "recovery.json");

// Persistent recovery-opportunity state (survives restarts).
// Keyed by lowercase domain. Also tracks enrolled contact ids for
// idempotency: a contact is never enrolled twice.
let opportunities = {};

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") opportunities = parsed;
    }
  } catch {
    opportunities = {};
  }
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(opportunities, null, 2));
  } catch (error) {
    console.warn("[RECOVERY] persist failed:", error.message);
  }
}

load();

export function recoveryKey(domain) {
  return String(domain || "").trim().toLowerCase();
}

export function getOpportunity(domain) {
  const key = recoveryKey(domain);
  return (key && opportunities[key]) || null;
}

export function listOpportunities() {
  return Object.values(opportunities).sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
  );
}

export function upsertOpportunity(domain, patch = {}) {
  const key = recoveryKey(domain);
  if (!key) return null;
  const now = new Date().toISOString();
  const prev = opportunities[key] || {
    domain: key,
    status: "candidate",
    timeline: [],
    enrolledContactIds: [],
    createdAt: now,
  };
  const next = {
    ...prev,
    ...patch,
    domain: key,
    updatedAt: now,
    timeline: [
      ...(prev.timeline || []),
      ...(patch.timelineEvent
        ? [{ at: now, event: patch.timelineEvent, detail: patch.timelineDetail || null }]
        : []),
    ].slice(-50),
  };
  delete next.timelineEvent;
  delete next.timelineDetail;
  opportunities[key] = next;
  persist();
  return next;
}

export function isContactEnrolled(domain, contactId) {
  const opp = getOpportunity(domain);
  if (!opp) return false;
  if (!contactId) return Boolean(opp.enrollmentStatus === "enrolled");
  return (opp.enrolledContactIds || []).map(String).includes(String(contactId));
}

export function markContactEnrolled(domain, contactId, sequenceId = null) {
  const opp = getOpportunity(domain) || { domain: recoveryKey(domain), enrolledContactIds: [] };
  const ids = new Set((opp.enrolledContactIds || []).map(String));
  if (contactId) ids.add(String(contactId));
  return upsertOpportunity(domain, {
    enrolledContactIds: [...ids],
    enrollmentStatus: "enrolled",
    sequenceId: sequenceId || opp.sequenceId || null,
    status: "enrolled",
    timelineEvent: "enrolled_in_sequence",
    timelineDetail: contactId ? `Contact ${contactId} enrolled` : "Enrolled",
  });
}

export function cancelRecovery(domain, reason = "meeting booked") {
  return upsertOpportunity(domain, {
    status: "cancelled",
    enrollmentStatus: "cancelled",
    recoveryEligible: false,
    timelineEvent: "recovery_cancelled",
    timelineDetail: reason,
  });
}

export function clearRecovery() {
  opportunities = {};
  persist();
}
