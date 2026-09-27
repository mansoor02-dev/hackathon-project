// Centralized traffic / intent classification. Thresholds live in config.js.
import { intentThresholds, targetAccounts } from "../config/config.js";

export const TRAFFIC_TYPES = ["unknown", "low_intent", "medium_intent", "high_intent", "target_account"];

export function intentLevel(score) {
  if (score == null || !Number.isFinite(Number(score))) return "unknown";
  const s = Number(score);
  if (s >= intentThresholds.high) return "high";
  if (s >= intentThresholds.medium) return "medium";
  return "low";
}

function isTargetAccount(domain, companyName) {
  if (!targetAccounts.length) return false;
  const d = String(domain || "").toLowerCase();
  const n = String(companyName || "").toLowerCase();
  return targetAccounts.some((t) => {
    const needle = String(t).toLowerCase();
    return (d && d.includes(needle)) || (n && n === needle);
  });
}

// Only claim target_account when there is an actual basis (explicit list match).
export function classifyTraffic({ intentScore = null, domain = null, companyName = null } = {}) {
  if (isTargetAccount(domain, companyName)) return "target_account";
  const level = intentLevel(intentScore);
  if (level === "unknown") return "unknown";
  if (level === "high") return "high_intent";
  if (level === "medium") return "medium_intent";
  return "low_intent";
}

export function personalizationVariant({ trafficType, industry = null }) {
  const ind = String(industry || "general").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "general";
  switch (trafficType) {
    case "target_account":
      return `1_1_${ind}`;
    case "high_intent":
      return `enterprise_${ind}`;
    case "medium_intent":
      return `segment_${ind}`;
    case "low_intent":
    case "unknown":
    default:
      return "generic";
  }
}
