import { g8, graph8Configured } from "../config/config.js";
import { voiceAgentId } from "../config/config.js";

export function voiceStatus() {
  if (!voiceAgentId) return { mode: "not_configured", reason: "GRAPH8_VOICE_AGENT_ID is not set" };
  if (!graph8Configured) return { mode: "not_configured", reason: "Graph8 API key not configured" };
  return { mode: "real", agentId: voiceAgentId };
}

// Never auto-dial. This only generates a prep script. Clearly labelled
// simulated vs real by the caller via `mode`.
export async function generateCoachingScript(context) {
  if (!voiceAgentId || !context.contact_id) {
    return null;
  }
  if (!graph8Configured) return null;

  try {
    const result = await g8.api.call(
      "generate_call_script_voice_call_scripts_generate_post",
      {
        body: {
          agent_id: voiceAgentId,
          contact_id: String(context.contact_id),
          context: JSON.stringify(context.meeting),
          call_objective: "Prepare the sales representative for the booked meeting.",
          call_type: "follow_up",
          company_context: JSON.stringify(context.prospect),
          prospect_info: JSON.stringify(context.prospect),
        },
      }
    );
    return result;
  } catch (error) {
    console.warn("[VOICE] script generation failed:", error.message);
    return null;
  }
}

// Deterministic local prep (simulation) when voice is not configured.
export function buildLocalPrep(context) {
  const p = context.prospect || {};
  const m = context.meeting || {};
  return {
    mode: "simulated",
    title: `Pre-call prep: ${p.company || "unknown company"}`,
    prospect_summary: p.name
      ? `${p.name}${p.title ? ` (${p.title})` : ""} at ${p.company || "unknown company"}`
      : `Prospect at ${p.company || "unknown company"}`,
    talking_points: [
      `Open on their context: ${p.industry ? `${p.industry} team` : "their team"} exploring AI infrastructure.`,
      "Quantify pipeline ROI: time-to-deploy, reliability, operating cost.",
      `Confirm meeting goal: ${m.title || "demo"} ${m.scheduled_at ? `at ${m.scheduled_at}` : ""}.`.trim(),
    ],
    discovery_questions: [
      "What does your current AI workflow look like end to end?",
      "Where does it break first at scale?",
      "Who owns reliability for AI systems today?",
    ],
    objections: [
      { objection: "We already have tooling.", response: "Map overlap honestly; position consolidation, not rip-and-replace." },
      { objection: "Security review will take months.", response: "Offer deployment options and a scoped pilot." },
    ],
  };
}