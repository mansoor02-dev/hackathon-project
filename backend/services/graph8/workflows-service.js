import { g8, graph8Configured, recoveryWorkflowId } from "../../config/config.js";

// Graph8 Workflows wrapper — verified SDK:
//   g8.workflows.list(), .get(id), .validate(workflow), .execute(id, payload),
//   .getExecution(id), .pauseExecution/.resumeExecution/.stopExecution
// Optional integration: only used when GRAPH8_RECOVERY_WORKFLOW_ID is set.
// Never executes live workflows during automated tests.
export function workflowStatus() {
  if (!graph8Configured) return { mode: "NOT_CONFIGURED", reason: "Graph8 API key not configured" };
  if (!recoveryWorkflowId) return { mode: "NOT_CONFIGURED", reason: "GRAPH8_RECOVERY_WORKFLOW_ID is not set" };
  return { mode: "LIVE", workflowId: recoveryWorkflowId };
}

export async function validateRecoveryWorkflow(workflow) {
  if (!graph8Configured) return { ok: false, mode: "NOT_CONFIGURED" };
  try {
    const res = await g8.workflows.validate(workflow);
    return { ok: true, mode: "LIVE", result: res };
  } catch (error) {
    return { ok: false, mode: "ERROR", reason: error.message };
  }
}

export async function executeRecoveryWorkflow(triggerPayload = {}) {
  const status = workflowStatus();
  if (status.mode !== "LIVE") return { executed: false, ...status };
  if (process.env.NODE_ENV === "test") {
    return { executed: false, mode: "DRY_RUN", reason: "Refusing live workflow execution in tests" };
  }
  try {
    const res = await g8.workflows.execute(recoveryWorkflowId, triggerPayload);
    return { executed: true, mode: "LIVE", result: res };
  } catch (error) {
    console.warn("[WORKFLOWS] execute failed:", error.message);
    return { executed: false, mode: "ERROR", reason: error.message };
  }
}
