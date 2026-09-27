import { g8, graph8Configured, recoveryListId, recoveryListTitle } from "../../config/config.js";

// Graph8 Lists wrapper — verified SDK:
//   g8.lists.list(page, limit), .create(title, type),
//   .contacts(listId), .addContacts(listId, contactIds), .removeContacts(...)
// Lifecycle: identified -> recovery candidate -> contact found -> enriched ->
// verified -> ready for outreach -> enrolled. One list, never duplicated.
let cachedListId = recoveryListId || null;

export function recoveryListStatus() {
  return {
    configuredListId: recoveryListId || cachedListId || null,
    title: recoveryListTitle,
    mode: !graph8Configured ? "NOT_CONFIGURED" : "LIVE",
  };
}

export async function ensureRecoveryList() {
  if (!graph8Configured) return { id: cachedListId, mode: "NOT_CONFIGURED" };
  if (recoveryListId) {
    cachedListId = recoveryListId;
    return { id: recoveryListId, mode: "LIVE", source: "env" };
  }
  if (cachedListId) return { id: cachedListId, mode: "LIVE", source: "cache" };
  try {
    const res = await g8.lists.list(1, 50);
    const rows = res?.data || res?.lists || (Array.isArray(res) ? res : []);
    const existing = (Array.isArray(rows) ? rows : []).find(
      (l) => String(l.title || l.name || "").toLowerCase() === recoveryListTitle.toLowerCase()
    );
    if (existing) {
      cachedListId = existing.id;
      return { id: existing.id, mode: "LIVE", source: "existing" };
    }
    const created = await g8.lists.create(recoveryListTitle, "contacts");
    cachedListId = created?.id ?? created?.data?.id ?? null;
    return { id: cachedListId, mode: "LIVE", source: "created" };
  } catch (error) {
    console.warn("[LISTS] ensure recovery list failed:", error.message);
    return { id: null, mode: "ERROR", error: error.message };
  }
}

export async function addToRecoveryList(contactId, listId = null) {
  const target = listId || cachedListId || recoveryListId;
  if (!target || !graph8Configured || !contactId) return { added: false, reason: "List or contact not configured" };
  try {
    await g8.lists.addContacts(target, [Number(contactId) || contactId]);
    return { added: true, listId: target };
  } catch (error) {
    console.warn("[LISTS] add failed:", error.message);
    return { added: false, reason: error.message };
  }
}

export function _resetRecoveryListCache() {
  cachedListId = recoveryListId || null;
}
