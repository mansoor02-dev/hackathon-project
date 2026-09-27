import { graph8Configured } from "../config/config.js";
import { fetchCompanyDetails } from "./company-service.js";
import { classifyTraffic, intentLevel, personalizationVariant } from "./traffic-classifier.js";
import { buildPersonalization } from "./personalization-content.js";
import { generateDynamicLandingPage, getCachedPage, landingCacheKey } from "./landing-page-service.js";
import { getLatestVisitor, recordEvent } from "./event-store.js";
import { g8 } from "../config/config.js";

// Full visitor resolution for GET /api/resolve-visitor.
// Sources (in order): explicit ?domain= (demo override), ?company=,
// latest webhook visitor state. Falls back to generic, never crashes.
export async function resolveVisitor({ ip = null, domain = null, company = null } = {}) {
  const normalizedDomain = (domain || "").trim() || null;

  let base = null;
  if (normalizedDomain) {
    // Demo path: enrich the requested domain directly (real Graph8 call).
    const result = await fetchCompanyDetails(normalizedDomain);
    const c = result?.data;
    let intentScore = c?.intentScore ?? null;
    let signalRows = c?.signals || [];
    // Optionally enrich with live intent signals (read-only, best-effort).
    if (graph8Configured) {
      try {
        const signals = await g8.signals.company(normalizedDomain);
        const s = signals?.score ?? signals?.data?.score ?? null;
        if (Number.isFinite(Number(s))) intentScore = Number(s);
        const rows = signals?.signals || signals?.data?.signals || [];
        if (Array.isArray(rows) && rows.length) signalRows = rows.slice(0, 8);
      } catch {
        // signals need intent:read scope — ignore, enrichment is enough.
      }
    }
    base = {
      companyName: c?.companyName || company || normalizedDomain,
      domain: c?.domain || normalizedDomain,
      industry: c?.industry || null,
      employeeCount: c?.employeeCount || null,
      intentScore,
      signals: signalRows,
      source: "query",
    };
  } else {
    const latest = getLatestVisitor();
    if (latest) {
      base = {
        companyName: latest.company,
        domain: latest.domain,
        industry: latest.metadata?.industry || null,
        employeeCount: null,
        intentScore: latest.metadata?.intentScore ?? null,
        trafficType: latest.metadata?.trafficType,
        variant: latest.metadata?.variant,
        pageUrl: latest.metadata?.pageUrl || latest.metadata?.url || null,
        signals: latest.metadata?.signals || [],
        source: "webhook_state",
      };
      // Re-attach industry if we can without billable calls: skip.
    }
  }

  if (!base || (!base.companyName && !base.domain)) {
    const fallback = buildPersonalization({ companyName: null, trafficType: "unknown", intentScore: null });
    return {
      resolved: false,
      personalized: false,
      traffic_type: "unknown",
      company: null,
      domain: null,
      intent: { score: null, level: intentLevel(null) },
      experience: {
        variant: "generic",
        family: fallback.family,
        reason: fallback.reason,
        signals: [],
        headline: fallback.headline,
        supporting: fallback.supporting,
        cta: fallback.cta,
        page_url: null,
        page_id: null,
        page_mode: "fallback",
      },
      source: base?.source || "none",
    };
  }

  const trafficType = base.trafficType || classifyTraffic({
    intentScore: base.intentScore,
    domain: base.domain,
    companyName: base.companyName,
  });
  const demoPersonalized = base.source === "query" &&
    (trafficType === "unknown" || trafficType === "low_intent");
  const copyTrafficType = demoPersonalized ? "demo_preview" : trafficType;

  const copy = buildPersonalization({
    companyName: base.companyName,
    industry: base.industry,
    trafficType: copyTrafficType,
    intentScore: base.intentScore,
  });
  const variant = base.variant || `${personalizationVariant({ trafficType: copyTrafficType, industry: base.industry })}:${copy.variant}`;

  // Reuse existing page when possible; generate only when necessary.
  let pageUrl = base.pageUrl || null;
  let pageId = null;
  let pageMode = "reused";
  if (!pageUrl && base.domain && trafficType !== "unknown" && trafficType !== "low_intent") {
    const key = landingCacheKey({ domain: base.domain, variant });
    const cached = getCachedPage(key);
    if (cached?.url) {
      pageUrl = cached.url; pageId = cached.id;
    } else {
      const page = await generateDynamicLandingPage(
        { companyName: base.companyName, domain: base.domain, industry: base.industry, name: base.companyName },
        { variant, supporting: copy.supporting, cta: copy.cta }
      );
      if (page) {
        pageUrl = page.url; pageId = page.id; pageMode = page.cached ? "reused" : "generated";
        recordEvent("personalization_served", {
          company: base.companyName, domain: base.domain,
          metadata: { variant, trafficType, pageId, url: pageUrl },
        });
      }
    }
  }

  // Backwards-compatible flat fields (current frontend) + rich contract (prompt §7).
  // `resolved` = company/domain/signals identified. `personalized` = qualifies
  // for a non-default experience. They are intentionally separate.
  return {
    resolved: true,
    personalized: demoPersonalized || (trafficType !== "unknown" && trafficType !== "low_intent"),
    demo_personalized: demoPersonalized,
    traffic_type: trafficType,
    company: { name: base.companyName, domain: base.domain, industry: base.industry },
    intent: { score: base.intentScore, level: intentLevel(base.intentScore) },
    experience: { variant, family: copy.family, reason: copy.reason, signals: base.signals || [], headline: copy.headline, supporting: copy.supporting, cta: copy.cta, page_url: pageUrl, page_id: pageId, page_mode: pageUrl ? pageMode : demoPersonalized ? "demo_preview" : "fallback" },
    // legacy flat fields:
    domain: base.domain,
    headline: copy.headline,
    cta: copy.cta,
    source: base.source,
  };
}

export async function lookupResolvedVisitorByIp(_ip) {
  const latest = getLatestVisitor();
  if (!latest?.company) return null;
  return { company: { name: latest.company, domain: latest.domain } };
}
