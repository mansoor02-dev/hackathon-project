import { g8, graph8Configured } from "../../config/config.js";

// Graph8 Tasks wrapper — verified SDK:
//   g8.tasks.create(contactId, task), .listForContact(contactId),
//   .list(params), plus global tasks via
//   g8.api.call('create_global_task_tasks_post', ...).
// Used as a fallback so high-value signals never disappear silently.
export async function createRecoveryTask({ contactId = null, title, description = null } = {}) {
  if (!graph8Configured) return { created: false, mode: "NOT_CONFIGURED" };
  try {
    if (contactId) {
      const res = await g8.tasks.create(Number(contactId) || contactId, {
        title,
        description,
      });
      return { created: true, mode: "LIVE", task: res };
    }
    const res = await g8.api.call("create_global_task_tasks_post", {
      body: { title, description },
    });
    return { created: true, mode: "LIVE", task: res?.data ?? res };
  } catch (error) {
    console.warn("[TASKS] create failed:", error.message);
    return { created: false, mode: "ERROR", reason: error.message };
  }
}

export async function listRecentTasks(limit = 10) {
  if (!graph8Configured) return { mode: "NOT_CONFIGURED", tasks: [] };
  try {
    const res = await g8.tasks.list({ limit });
    const rows = res?.data || res?.tasks || (Array.isArray(res) ? res : []);
    return { mode: "LIVE", tasks: Array.isArray(rows) ? rows.slice(0, limit) : [] };
  } catch (error) {
    return { mode: "ERROR", tasks: [], reason: error.message };
  }
}
