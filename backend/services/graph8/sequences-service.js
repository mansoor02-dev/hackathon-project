import { g8, graph8Configured, recoverySequenceId, recoveryAutoEnroll, recoveryAutoProvision, sequenceOwnerEmail, recoveryListId } from "../../config/config.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Graph8 Sequencer wrapper — verified SDK (POST /api/v1/sequences needs
// name + user_email; steps are StepConfig[] with time_interval in seconds):
//   g8.sequences.list(), .get(id), .contacts(id), .preview(id),
//   .create(payload, idempotencyKey),
//   .add({sequenceId, contactIds, listId}, idempotencyKey), .analytics(...)
// Sequencer owns outreach timing; backend only decides eligibility.
// NEVER enrolls when GRAPH8_RECOVERY_SEQUENCE_ID is missing or
// GRAPH8_RECOVERY_AUTO_ENROLL=false, or during automated tests.
// NEVER calls run()/launch() — provisioning creates DRAFT shells only.
export const RECOVERY_SEQUENCE_NAME = "Signal Desk — Inbound Recovery";

export function sequenceStatus() {
  if (!graph8Configured) return { mode: "NOT_CONFIGURED", reason: "Graph8 API key not configured" };
  if (!recoverySequenceId)
    return {
      mode: "NOT_CONFIGURED",
      reason: "GRAPH8_RECOVERY_SEQUENCE_ID is not set",
      missingDependency: recoveryAutoProvision
        ? null
        : "Set GRAPH8_RECOVERY_SEQUENCE_ID, or set GRAPH8_RECOVERY_AUTO_PROVISION=true to let the backend create a draft",
    };
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
    !autoEnrollEnabled()
  );
}

export function autoEnrollEnabled() {
  return String(process.env.GRAPH8_RECOVERY_AUTO_ENROLL || "false").toLowerCase() === "true";
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
  if (isTestEnv() || !autoEnrollEnabled()) {
    return {
      enrolled: false,
      mode: "DRY_RUN",
      sequenceId: recoverySequenceId,
      reason: "GRAPH8_RECOVERY_AUTO_ENROLL=false — showing 'Ready for Sequence' without enrolling",
    };
  }
  // Live path only: open-data contacts have no CRM id and cannot be enrolled
  // directly. Never invent one — report honestly instead of sending a bad id.
  const numericId = Number(contactId);
  if (!Number.isFinite(numericId)) {
    return {
      enrolled: false,
      mode: "LIVE",
      needsCrmContact: true,
      reason: "Contact found in open data but has no Graph8 CRM id — create the CRM contact before enrolling",
    };
  }
  try {
    const key = idempotencyKey || `recovery:${recoverySequenceId}:${contactId}`;
    const body = { sequenceId: recoverySequenceId, contactIds: [numericId] };
    if (recoveryListId) body.listId = Number(recoveryListId);
    const result = await g8.sequences.add(body, key);
    return { enrolled: true, mode: "LIVE", sequenceId: recoverySequenceId, result };
  } catch (error) {
    console.warn("[SEQUENCES] enroll failed:", error.message);
    return { enrolled: false, mode: "LIVE", reason: error.message, error: true };
  }
}

// Draft recovery-sequence provisioning (Day 0 / Day 3 / Day 7 email cadence,
// stops on reply via finish_on_reply). Creates a DRAFT workspace object only:
// no contacts are added, run()/launch() is never called, nothing is sent.
// Safe to attempt live; failures are reported as missing dependencies.
export function recoverySequenceSteps() {
  const day = 86400;
  return [
    {
      step_order: 1,
      step_type: "EMAIL",
      input_type: "MANUAL_TEMPLATE",
      time_interval: 0,
      step_data: {
        subject: "Quick idea for {{company}}",
        body: "Hi {{first_name}},\n\nReaching out because {{company}} looks like a team that could get a lot out of reliable AI infrastructure without added operational overhead.\n\nWorth a brief conversation about what that could look like for your team?\n\nBest regards",
      },
    },
    {
      step_order: 2,
      step_type: "EMAIL",
      input_type: "MANUAL_TEMPLATE",
      time_interval: 3 * day,
      step_data: {
        subject: "Re: Quick idea for {{company}}",
        body: "Hi {{first_name}},\n\nBrief follow-up on my note below — happy to share how similar teams ship AI workloads reliably.\n\nOpen to a short call this week?\n\nBest regards",
      },
    },
    {
      step_order: 3,
      step_type: "EMAIL",
      input_type: "MANUAL_TEMPLATE",
      time_interval: 7 * day,
      step_data: {
        subject: "Closing the loop",
        body: "Hi {{first_name}},\n\nLast note from me — if AI infrastructure becomes a priority for {{company}}, I'm happy to help.\n\nJust reply if you'd like to talk.\n\nBest regards",
      },
    },
  ];
}

async function discoverOwnerEmail() {
  if (sequenceOwnerEmail) return { email: sequenceOwnerEmail, source: "env" };
  try {
    const res = await g8.mailboxes.list();
    const rows = res?.data || res?.mailboxes || (Array.isArray(res) ? res : []);
    const active = (Array.isArray(rows) ? rows : []).find((m) => !m.is_archived);
    const email = active?.email || null;
    if (email) return { email, source: "active-mailbox" };
    return { email: null, source: null, missingDependency: "No active mailbox in the Graph8 workspace (and GRAPH8_SEQUENCE_OWNER_EMAIL unset)" };
  } catch (error) {
    return { email: null, source: null, missingDependency: `Could not list mailboxes: ${error.message}` };
  }
}

async function findExistingRecoverySequence() {
  try {
    const res = await g8.sequences.list({ limit: 50 });
    const rows = res?.data || (Array.isArray(res) ? res : []);
    return (Array.isArray(rows) ? rows : []).find(
      (s) => String(s.name || "").toLowerCase() === RECOVERY_SEQUENCE_NAME.toLowerCase()
    ) || null;
  } catch {
    return null;
  }
}

function persistSequenceIdToEnv(sequenceId) {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const envFile = path.join(dir, "..", "..", ".env");
    let content = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
    if (/^GRAPH8_RECOVERY_SEQUENCE_ID=/m.test(content)) {
      content = content.replace(/^GRAPH8_RECOVERY_SEQUENCE_ID=.*$/m, `GRAPH8_RECOVERY_SEQUENCE_ID=${sequenceId}`);
    } else {
      content += `${content.endsWith("\n") || !content ? "" : "\n"}GRAPH8_RECOVERY_SEQUENCE_ID=${sequenceId}\n`;
    }
    fs.writeFileSync(envFile, content);
    return true;
  } catch (error) {
    console.warn("[SEQUENCES] could not persist id to .env:", error.message);
    return false;
  }
}

export async function ensureRecoverySequence({ provision = recoveryAutoProvision } = {}) {
  if (!graph8Configured) {
    return { provisioned: false, mode: "NOT_CONFIGURED", reason: "Graph8 API key not configured" };
  }
  if (recoverySequenceId) {
    const existing = await getSequence(recoverySequenceId);
    if (existing) return { provisioned: false, mode: "EXISTS", sequenceId: recoverySequenceId, sequence: existing };
    return {
      provisioned: false,
      mode: "NOT_CONFIGURED",
      reason: `GRAPH8_RECOVERY_SEQUENCE_ID=${recoverySequenceId} does not resolve in Graph8`,
      missingDependency: "Configured sequence id is invalid — fix the id or unset it to provision",
    };
  }
  const already = await findExistingRecoverySequence();
  if (already) {
    const persisted = persistSequenceIdToEnv(already.id);
    return {
      provisioned: false,
      mode: "EXISTS",
      sequenceId: already.id,
      sequence: already,
      persisted,
      note: "Found an existing recovery sequence by name; set it as configured (restart to pick up).",
    };
  }
  if (!provision) {
    return {
      provisioned: false,
      mode: "NOT_CONFIGURED",
      reason: "GRAPH8_RECOVERY_SEQUENCE_ID is not set",
      missingDependency: "Set GRAPH8_RECOVERY_SEQUENCE_ID, or set GRAPH8_RECOVERY_AUTO_PROVISION=true to create a draft",
    };
  }
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    return { provisioned: false, mode: "DRY_RUN", reason: "Refusing live sequence creation in tests" };
  }
  const owner = await discoverOwnerEmail();
  if (!owner.email) {
    return { provisioned: false, mode: "NOT_CONFIGURED", reason: "Cannot provision: owner email unknown", missingDependency: owner.missingDependency };
  }
  const payload = {
    name: RECOVERY_SEQUENCE_NAME,
    description: "Signal Desk inbound recovery: Day 0 / Day 3 / Day 7 follow-up for high-intent accounts that did not book. Stops on reply.",
    user_email: owner.email,
    finish_on_reply: true,
    send_in_same_thread: true,
    wait_for_new_contacts: true,
    associated_list_id: recoveryListId ? Number(recoveryListId) : undefined,
    steps: recoverySequenceSteps(),
  };
  try {
    const created = await g8.sequences.create(payload, "signal-desk-recovery-v1");
    const data = created?.data ?? created;
    const persisted = data?.id ? persistSequenceIdToEnv(data.id) : false;
    return { provisioned: true, mode: "DRAFT", sequenceId: data?.id || null, sequence: data, persisted, ownerEmailSource: owner.source };
  } catch (error) {
    // Step schema rejected? Retry as a draft shell (owner completes steps in UI).
    console.warn("[SEQUENCES] create with steps failed, retrying shell:", error.message);
    try {
      const { steps: _omit, ...shell } = payload;
      const created = await g8.sequences.create(shell, "signal-desk-recovery-v1");
      const data = created?.data ?? created;
      const persisted = data?.id ? persistSequenceIdToEnv(data.id) : false;
      return { provisioned: true, mode: "DRAFT_SHELL", sequenceId: data?.id || null, sequence: data, persisted, ownerEmailSource: owner.source, note: "Steps rejected by Graph8; created shell — add Day 0/3/7 steps in UI." };
    } catch (error2) {
      return { provisioned: false, mode: "ERROR", reason: error2.message, missingDependency: `Graph8 refused sequence creation: ${error2.message}` };
    }
  }
}
