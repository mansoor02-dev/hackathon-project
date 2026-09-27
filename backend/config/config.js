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
  .filter(Boolean);

export const graph8BaseUrl = process.env.GRAPH8_BASE_URL || "https://be.graph8.com/api/v1";

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
