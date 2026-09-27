import { g8, graph8Configured, intentThreshold } from "../config/config.js";
import { fetchCompanyDetails } from "./company-service.js";
import { generateDynamicLandingPage } from "./landing-page-service.js";
import { classifyTraffic, intentLevel, personalizationVariant } from "./traffic-classifier.js";
import { buildPersonalization } from "./personalization-content.js";
import { recordEvent, hasSeen, markSeen, listEvents } from "./event-store.js";
import { isRecoveryEligible } from "./recovery/qualification.js";
import { upsertOpportunity } from "./recovery/store.js";
import { getGraph8Event } from "../utils/graph8-event.js";

const VISITOR_EVENTS = new Set([
  "visitor.identified",
  "visitor_identified",
  "visitor_identified_event",
  "intent.signal",
  "intent_signal",
]);

function idempotencyKey(payload, data) {
  return (
    payload.id ||
    payload.event_id ||
    data.event_id ||
    (data.contact_id || data.contactId ? `visitor:${data.contact_id || data.contactId}:${data.intent_score ?? data.intentScore ?? "na"}` : null)
  );
}

export function normalizeVisitorData(data = {}) {
  const intentRaw = data.intent_score ?? data.intentScore ?? data.score ?? null;
  const intentScore = intentRaw == null ? null : Number(intentRaw);
  return {
    contactId: data.contact_id || data.contactId || null,
    companyId: data.company_id || data.companyId || null,
    companyDomain:
      data.company_domain || data.companyDomain || data.domain || null,
    companyName: data.company_name || data.companyName || data.company || null,
    industry: data.industry || null,
    intentScore: Number.isFinite(intentScore) ? intentScore : null,
  };
}

export async function processVisitorEvent(payload) {
  const { event, data } = getGraph8Event(payload || {});

  if (!VISITOR_EVENTS.has(event)) {
    return { status: "ignored", event };
  }

  const key = idempotencyKey(payload || {}, data || {});
  if (key && hasSeen(key)) {
    return { status: "duplicate", event };
  }

  const v = normalizeVisitorData(data);

  if (v.intentScore == null || !Number.isFinite(v.intentScore)) {
    return { status: "awaiting_intent" };
  }

  const intentScore = v.intentScore;

  if (intentScore < intentThreshold) {
    recordEvent("visitor_identified", {
      company: v.companyName, domain: v.companyDomain,
      metadata: { intentScore, trafficType: "low_intent", idempotencyKey: key },
    });
    if (key) markSeen(key);
    return { status: "low_intent", intent_score: intentScore, threshold: intentThreshold };
  }

  let contact = null;
  if (v.contactId && graph8Configured) {
    try {
      contact = await g8.contacts.get(Number(v.contactId));
    } catch (error) {
      console.warn(`[VISITOR] Could not retrieve contact ${v.contactId}:`, error.message);
    }
  }

  const companyDomain =
    contact?.company_domain || contact?.company?.domain || v.companyDomain || null;
  const companyNameGuess =
    contact?.company_name || contact?.company?.name || v.companyName || null;

  let company = companyNameGuess
    ? { companyName: companyNameGuess, domain: companyDomain, industry: v.industry || contact?.industry || null }
    : null;

  if (companyDomain) {
    try {
      const result = await fetchCompanyDetails(companyDomain);
      if (result?.data?.companyName || result?.data?.domain) {
        company = result.data;
        recordEvent("company_resolved", {
          company: company.companyName, domain: company.domain,
          metadata: { industry: company.industry, idempotencyKey: key ? `${key}:company` : undefined },
        });
      }
    } catch (error) {
      console.warn("[VISITOR] enrichment error:", error.message);
    }
  }

  const trafficType = classifyTraffic({
    intentScore,
    domain: company?.domain || companyDomain,
    companyName: company?.companyName,
  });

  const copy = buildPersonalization({
    companyName: company?.companyName,
    industry: company?.industry,
    trafficType,
    intentScore,
  });
  const variant = `${personalizationVariant({ trafficType, industry: company?.industry })}:${copy.variant}`;

  // Relevant Graph8 intent signals (read-only, best-effort — never blocks).
  let signals = [];
  if (companyDomain && graph8Configured) {
    try {
      const s = await g8.signals.company(companyDomain);
      const rows = s?.signals || s?.data?.signals || [];
      signals = Array.isArray(rows) ? rows.slice(0, 8) : [];
    } catch {
      // Missing intent:read scope etc. — enrichment above is enough.
    }
  }

  let landingPage = null;
  if (company?.companyName && trafficType !== "low_intent" && trafficType !== "unknown") {
    landingPage = await generateDynamicLandingPage(
      { companyName: company.companyName, domain: company.domain, industry: company.industry, name: company.companyName },
      { variant, supporting: copy.supporting, cta: copy.cta }
    );
    if (landingPage) {
      recordEvent("personalization_generated", {
        company: company.companyName, domain: company.domain,
        metadata: { variant, trafficType, pageId: landingPage.id, url: landingPage.url, cached: landingPage.cached },
      });
    }
  }

  recordEvent("visitor_identified", {
    company: company?.companyName || companyNameGuess,
    domain: company?.domain || companyDomain,
    visitor: v.contactId ? { contactId: v.contactId } : null,
    metadata: {
      intentScore, intentLevel: intentLevel(intentScore), trafficType,
      variant, family: copy.family, reason: copy.reason, signals,
      pageUrl: landingPage?.url || null, idempotencyKey: key,
    },
  });

  if (key) markSeen(key);

  // Inbound -> Outbound Recovery: high-intent + engagement + no meeting
  // creates a recovery opportunity. Sequencer owns timing; we only flag eligibility.
  const domainKey = String(company?.domain || companyDomain || "").toLowerCase();
  let recovery = { eligible: false };
  if (domainKey) {
    const meetingBooked = listEvents(500).some(
      (e) => e.type === "meeting_booked" && String(e.domain || "").toLowerCase() === domainKey
    );
    const decision = isRecoveryEligible({
      intentScore,
      trafficType,
      domain: domainKey,
      companyName: company?.companyName,
      hasEngagement: Boolean(landingPage || company?.companyName),
      meetingBooked,
    });
    recovery = {
      eligible: decision.eligible,
      reason: decision.reason,
      trafficType: decision.trafficType || trafficType,
    };
    if (decision.eligible) {
      upsertOpportunity(domainKey, {
        company: company?.companyName || companyNameGuess,
        companyId: v.companyId,
        intentScore,
        trafficType,
        recoveryEligible: true,
        status: "candidate",
        timelineEvent: "recovery_created",
        timelineDetail: `Intent ${intentScore} (${trafficType})`,
      });
      recordEvent("recovery_created", {
        company: company?.companyName || companyNameGuess,
        domain: domainKey,
        metadata: { intentScore, trafficType },
      });
    }
  }

  return {
    status: "acknowledged",
    intent_score: intentScore,
    intent_level: intentLevel(intentScore),
    traffic_type: trafficType,
    contact_id: v.contactId,
    company_id: v.companyId,
    company: company ? { name: company.companyName, domain: company.domain, industry: company.industry } : null,
    experience: { variant, family: copy.family, reason: copy.reason, signals, headline: copy.headline, supporting: copy.supporting, cta: copy.cta, page_url: landingPage?.url || null },
    landing_page: landingPage,
    recovery: {
      eligible: recovery.eligible,
      reason: recovery.reason || null,
      domain: domainKey || null,
    },
  };
}
