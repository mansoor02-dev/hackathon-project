import { g8, graph8Configured, skillQualificationId, skillContactId, skillOutreachId } from "../../config/config.js";

// Graph8 Skills wrapper — verified SDK:
//   g8.skills.list(), .get(id), .getVariables(id), .validate(id),
//   .execute(skillId, inputPayload)
// Optional: 1-2 skills replace custom LLM code where Graph8 provides it.
// Candidates: account qualification, contact selection, outreach preparation.
// Never invents prospect facts; website activity stays an internal signal.
export function skillsStatus() {
  return {
    configured: graph8Configured,
    qualification: skillQualificationId || null,
    contactSelection: skillContactId || null,
    outreach: skillOutreachId || null,
    mode: !graph8Configured
      ? "NOT_CONFIGURED"
      : skillQualificationId || skillContactId || skillOutreachId
        ? "LIVE"
        : "NOT_CONFIGURED",
  };
}

export async function listSkills(params = {}) {
  if (!graph8Configured) return { mode: "NOT_CONFIGURED", skills: [] };
  try {
    const res = await g8.skills.list(params);
    const rows = res?.data || res?.skills || (Array.isArray(res) ? res : []);
    return { mode: "LIVE", skills: Array.isArray(rows) ? rows : [] };
  } catch (error) {
    return { mode: "ERROR", skills: [], reason: error.message };
  }
}

export async function executeSkill(skillId, input) {
  if (!graph8Configured || !skillId) return { executed: false, mode: "NOT_CONFIGURED" };
  if (process.env.NODE_ENV === "test") {
    return { executed: false, mode: "DRY_RUN", reason: "Refusing live skill execution in tests" };
  }
  try {
    const res = await g8.skills.execute(skillId, input);
    return { executed: true, mode: "LIVE", result: res };
  } catch (error) {
    console.warn("[SKILLS] execute failed:", error.message);
    return { executed: false, mode: "ERROR", reason: error.message };
  }
}

export async function qualifyWithSkill({ company, intentScore, activity } = {}) {
  if (!skillQualificationId) return null;
  return executeSkill(skillQualificationId, { company, intent_score: intentScore, activity });
}
