import { g8, graph8Configured, recoverySequenceId, recoveryAutoEnroll } from "../../config/config.js";

// Graph8 Sequencer wrapper — verified SDK:
//   g8.sequences.list(), .get(id), .contacts(id), .preview(id),
//   .add({sequenceId, contactIds, listId}, idempotencyKey), .analytics(...)
// Sequencer owns outreach timing; backend only decides eligibility.
// NEVER enrolls when GRAPH8_RECOVERY_SEQUENCE_ID is missing or
// GRAPH8_RECOVERY_AUTO_ENROLL=false, or during automated tests.
export function sequenceStatus() {
  if (!graph8Configured) return { mode: "NOT_CONFIGURED", reason: "Graph8 API key not configured" };
  if (!recoverySequenceId)
    return { mode: "NOT_CONFIGURED", reason: "GRAPH8_RECOVERY_SEQUENCE_ID is not set" };
  return {
    mode: recoveryAutoEnroll ? "LIVE" : "DRY_RUN",
    sequenceId: recoverySequenceId,
    autoEnroll: recoveryAutoEnroll,
  };
}

export function isTestEnv() {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    String(process.env.GRAPH8_RECOVERY_AUTO_ENROLL || "false").toLowerCase() !== "true"
  );
}

export async function getSequence(sequenceId = recoverySequenceId) {
  if (!sequenceId || !graph8Configured) return null;
  try {
    return await g8.sequences.get(sequenceId);
  } catch (error) {
    console.warn(`[SEQUENCES] get ${sequenceId} failed:`, error.message);
    return null;
  }
}

export async function previewSequence(sequenceId = recoverySequenceId) {
  if (!sequenceId || !graph8Configured) return null;
  try {
    return await g8.sequences.preview(sequenceId);
  } catch {
    return null;
  }
}

export async function sequenceAnalytics(sequenceId = recoverySequenceId) {
  if (!sequenceId || !graph8Configured) return null;
  try {
    if (typeof g8.sequences.analytics === "function") {
      return await g8.sequences.analytics(sequenceId);
    }
    return await g8.sequences.contacts(sequenceId, { limit: 1 });
  } catch (error) {
    console.warn(`[SEQUENCES] analytics failed:`, error.message);
    return null;
  }
}

// Real enrollment with idempotency + safety gates.
// Returns { enrolled:false, reason } for every dry-run / safety path.
export async function enrollContact(contactId, { idempotencyKey = null } = {}) {
  const status = sequenceStatus();
  if (status.mode === "NOT_CONFIGURED") {
    return { enrolled: false, mode: "NOT_CONFIGURED", reason: status.reason || "Sequence not configured" };
  }
  if (!contactId) return { enrolled: false, mode: status.mode, reason: "Missing contact_id" };
  if (isTestEnv() || !recoveryAutoEnroll) {
    return {
      enrolled: false,
      mode: "DRY_RUN",
      sequenceId: recoverySequenceId,
      reason: "GRAPH8_RECOVERY_AUTO_ENROLL=false — showing 'Ready for Sequence' without enrolling",
    };
  }
  try {
    const key = idempotencyKey || `recovery:${recoverySequenceId}:${contactId}`;
    const result = await g8.sequences.add(
      { sequenceId: recoverySequenceId, contactIds: [Number(contactId) || contactId] },
      key
    );
    return { enrolled: true, mode: "LIVE", sequenceId: recoverySequenceId, result };
  } catch (error) {
    console.warn("[SEQUENCES] enroll failed:", error.message);
    return { enrolled: false, mode: "LIVE", reason: error.message, error: true };
  }
}
