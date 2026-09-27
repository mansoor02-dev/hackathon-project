// Deterministic, safe personalization copy. No invented customer claims,
// no "Trusted by X". Falls back gracefully when company is unknown.
export function buildPersonalization({ companyName = null, industry = null, trafficType = "unknown", intentScore = null } = {}) {
  const name = (companyName || "").trim() || null;
  const segment = (industry || "").trim() || null;
  const scope = segment ? `${segment} teams` : "modern teams";

  if (!name || trafficType === "unknown" || trafficType === "low_intent") {
    return {
      variant: "generic",
      headline: "AI infrastructure for modern teams.",
      supporting: "Launch reliable AI workflows without adding operational complexity.",
      cta: "See how it works",
    };
  }

  if (trafficType === "target_account") {
    return {
      variant: "target_account",
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
      headline: `AI infrastructure built for ${segment ? `${segment} ` : ""}teams at ${name}'s scale.`,
      supporting: "Accelerate AI adoption without adding operational complexity.",
      cta: `See how it works for ${name}`,
    };
  }

  // medium_intent: light personalization
  return {
    variant: "medium_intent",
    headline: `AI infrastructure for ${scope}.`,
    supporting: name
      ? `Explore what this could look like for ${name} (intent ${intentScore ?? "—"}/100).`
      : "Explore a lighter path to production-ready AI.",
    cta: "Explore the platform",
  };
}
