import { intentThreshold } from "../../config/config.js";
import { classifyTraffic } from "../traffic-classifier.js";

// Decides: "This account is eligible for recovery."
// Graph8 Sequencer decides when/how to contact them.
// Eligible when: high-intent company + meaningful engagement + NO meeting.
export function isRecoveryEligible({
  intentScore = null,
  trafficType = null,
  domain = null,
  companyName = null,
  hasEngagement = false,
  meetingBooked = false,
} = {}) {
  const computedTraffic =
    trafficType ||
    classifyTraffic({ intentScore, domain, companyName });
  if (meetingBooked) return { eligible: false, reason: "meeting already booked" };
  if (!domain && !companyName)
    return { eligible: false, reason: "missing company/domain", trafficType: computedTraffic };
  if (intentScore == null || !Number.isFinite(Number(intentScore)))
    return { eligible: false, reason: "missing intent", trafficType: computedTraffic };
  if (computedTraffic !== "high_intent" && computedTraffic !== "target_account")
    return {
      eligible: false,
      reason: `traffic ${computedTraffic} below recovery threshold (>= ${intentThreshold})`,
      trafficType: computedTraffic,
    };
  if (!hasEngagement)
    return { eligible: false, reason: "no meaningful engagement yet", trafficType: computedTraffic };
  return { eligible: true, reason: "high-intent account with engagement and no meeting", trafficType: computedTraffic };
}
