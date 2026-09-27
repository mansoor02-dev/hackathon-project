import { g8, graph8Configured } from "../../config/config.js";

// Graph8 Inbox wrapper — verified SDK:
//   g8.inbox.list(params), .get(id), .assign, .tag, .draft(replyId), .send
// Read-only visibility for the dashboard: sequence -> reply -> inbox.
// NEVER auto-sends AI replies; draft/review state only.
export async function listInboxReplies(limit = 10) {
  if (!graph8Configured) return { mode: "NOT_CONFIGURED", replies: [] };
  try {
    const res = await g8.inbox.list({ limit });
    const rows = res?.data || res?.replies || res?.items || (Array.isArray(res) ? res : []);
    return { mode: "LIVE", replies: Array.isArray(rows) ? rows.slice(0, limit) : [] };
  } catch (error) {
    console.warn("[INBOX] list failed:", error.message);
    return { mode: "ERROR", replies: [], reason: error.message };
  }
}

export async function getInboxDraft(replyId, channel = "email") {
  if (!graph8Configured || !replyId) return { mode: "NOT_CONFIGURED", draft: null };
  try {
    const draft = await g8.inbox.draft(replyId, channel);
    return { mode: "LIVE", draft };
  } catch (error) {
    return { mode: "ERROR", draft: null, reason: error.message };
  }
}
