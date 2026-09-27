import "dotenv/config";
import { g8 } from "@graph8/sdk";

const apiKey = process.env.G8_API_KEY || process.env.GRAPH8_API_KEY || null;

if (apiKey) {
  g8.init({ apiKey });
} else {
  console.warn("[CONFIG] G8_API_KEY/GRAPH8_API_KEY missing — Graph8 calls will use fallback/demo mode.");
}

export const port = Number(process.env.PORT) || 3000;
export const webhookSecret = process.env.GRAPH8_WEBHOOK_SECRET;
export const voiceAgentId =
  process.env.GRAPH8_VOICE_AGENT_ID || process.env.GRAPH8_VOICE_AGENT || null;
export const graph8Configured = Boolean(apiKey);

// Centralized intent thresholds (no magic numbers elsewhere).
export const intentThresholds = {
  medium: 40,
  high: Number(process.env.GRAPH8_INTENT_THRESHOLD) || 60,
};
export const intentThreshold = intentThresholds.high;

export const pageTemplate = process.env.GRAPH8_PAGE_TEMPLATE || process.env.GRAPH8_TEMPLATE_ID || "lead_magnet";

// Explicit target-account list (comma-separated domains/names). Empty = no target accounts claimed.
export const targetAccounts = String(process.env.GRAPH8_TARGET_ACCOUNTS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .map((account) => account.includes("@") ? account.slice(account.lastIndexOf("@") + 1) : account)
  .filter(Boolean);

export const graph8BaseUrl = process.env.GRAPH8_BASE_URL || "https://be.graph8.com/api/v1";

// --- Signal Desk recovery / sequencer configuration (all server-only) ---
export const recoverySequenceId = process.env.GRAPH8_RECOVERY_SEQUENCE_ID || null;
export const recoveryAutoEnroll =
  String(process.env.GRAPH8_RECOVERY_AUTO_ENROLL || "false").toLowerCase() === "true";
export const recoveryListId = process.env.GRAPH8_RECOVERY_LIST_ID || null;
export const recoveryListTitle =
  process.env.GRAPH8_RECOVERY_LIST_TITLE || "Signal Desk \u2014 Recovery";
export const recoveryWorkflowId = process.env.GRAPH8_RECOVERY_WORKFLOW_ID || null;
// When true, the backend may create a DRAFT recovery sequence (no contacts,
// never run) if none is configured. Draft creation sends nothing.
export const recoveryAutoProvision =
  String(process.env.GRAPH8_RECOVERY_AUTO_PROVISION || "false").toLowerCase() === "true";
// Optional override for the sequence owner email (required by POST /sequences).
// When unset, the provisioner uses the first active mailbox email (read-only lookup).
export const sequenceOwnerEmail = process.env.GRAPH8_SEQUENCE_OWNER_EMAIL || null;
export const skillQualificationId =
  process.env.GRAPH8_SKILL_QUALIFICATION_ID || null;
export const skillContactId = process.env.GRAPH8_SKILL_CONTACT_ID || null;
export const skillOutreachId = process.env.GRAPH8_SKILL_OUTREACH_ID || null;

export function recoveryStatus() {
  return {
    sequenceConfigured: Boolean(recoverySequenceId),
    autoEnroll: recoveryAutoEnroll,
    listConfigured: Boolean(recoveryListId),
    listTitle: recoveryListTitle,
    workflowConfigured: Boolean(recoveryWorkflowId),
    mode: !recoverySequenceId
      ? "NOT_CONFIGURED"
      : recoveryAutoEnroll
        ? "LIVE"
        : "DRY_RUN",
  };
}

export async function checkGraph8Api() {
  if (!graph8Configured) {
    const err = new Error("Graph8 API key not configured");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  try {
    const result = await g8.contacts.list({
      limit: 1,
    });

    return {
      ok: true,
      total: result.pagination?.total ?? result.data?.length ?? 0,
      contacts: result.data,
    };
  } catch (error) {
    throw new Error(
      `Graph8 API check failed: ${error.message}`,
      {
        cause: error,
      }
    );
  }
}

export { g8 };
