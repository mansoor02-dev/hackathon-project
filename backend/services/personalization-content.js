// Deterministic, safe personalization copy. No invented customer claims,
// no "Trusted by X". Falls back gracefully when company is unknown.
//
// Small, demo-obvious variant set (families): default | saas | enterprise.
// Every result carries `family` + human-readable `reason` so the dashboard
// can show WHY a variant was selected. `variant` is unchanged (cache keys
// and existing consumers depend on it).
const TECH_HINTS = ["saas", "software", "technology", "tech", "ai", "cloud", "developer", "devops", "data", "cyber", "fintech"];

export function personalizationFamily({ trafficType = "unknown", industry = null } = {}) {
  if (trafficType === "high_intent" || trafficType === "target_account") return "enterprise";
  if (trafficType === "medium_intent") {
    const ind = String(industry || "").toLowerCase();
    if (TECH_HINTS.some((h) => ind.includes(h))) return "saas";
  }
  return "default";
}

export function variantReason({ companyName = null, trafficType = "unknown", intentScore = null, family = "default" } = {}) {
  const name = (companyName || "").trim() || "unknown company";
  switch (trafficType) {
    case "target_account":
      return `Explicit target account (${name}) — strongest personalization.`;
    case "high_intent":
      return `High intent score ${intentScore ?? "—"} (≥60) for ${name} — enterprise experience.`;
    case "medium_intent":
      return family === "saas"
        ? `Medium intent for ${name}, a technology company — SaaS experience.`
        : `Medium intent for ${name} — light personalization.`;
    case "low_intent":
      return `Low intent (${intentScore ?? "—"}) — default experience to avoid over-claiming.`;
    case "unknown":
    default:
      return `Unknown visitor${companyName ? "" : " (no company resolved)"} — default experience.`;
  }
}

// Deterministic, safe personalization copy. No invented customer claims,
// no "Trusted by X". Falls back gracefully when company is unknown.
export function buildPersonalization({ companyName = null, industry = null, trafficType = "unknown", intentScore = null } = {}) {
  const name = (companyName || "").trim() || null;
  const segment = (industry || "").trim() || null;
  const scope = segment ? `${segment} teams` : "modern teams";
  const family = personalizationFamily({ trafficType, industry });
  const reason = variantReason({ companyName, trafficType, intentScore, family });

  if (!name || trafficType === "unknown" || trafficType === "low_intent") {
    return {
      variant: "generic",
      family: "default",
      reason,
      headline: "AI infrastructure for modern teams.",
      supporting: "Launch reliable AI workflows without adding operational complexity.",
      cta: "See how it works",
    };
  }

  if (trafficType === "target_account") {
    return {
      variant: "target_account",
      family,
      reason,
      headline: `Accelerate ${name}'s AI infrastructure.`,
      supporting: segment
        ? `A focused path for ${name} to ship ${segment} AI workloads reliably.`
        : `A focused path for ${name} to ship AI workloads reliably.`,
      cta: `Book a tailored demo for ${name}`,
    };
  }

  if (trafficType === "high_intent") {
    return {
      variant: "high_intent",
      family,
      reason,
      headline: `AI infrastructure built for ${segment ? `${segment} ` : ""}teams at ${name}'s scale.`,
      supporting: "Accelerate AI adoption without adding operational complexity.",
      cta: `See how it works for ${name}`,
    };
  }

  // medium_intent: light personalization
  return {
    variant: "medium_intent",
    family,
    reason,
    headline: `AI infrastructure for ${scope}.`,
    supporting: name
      ? `Explore what this could look like for ${name} (intent ${intentScore ?? "—"}/100).`
      : "Explore a lighter path to production-ready AI.",
    cta: "Explore the platform",
  };
}
