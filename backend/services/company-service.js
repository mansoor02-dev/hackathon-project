import { g8, graph8Configured } from "../config/config.js";

// Normalize Graph8 enrichment into a stable internal object.
// Only includes fields actually returned by Graph8.
export function normalizeCompany(raw, fallbackDomain = null) {
  if (!raw || typeof raw !== "object") {
    return {
      companyName: fallbackDomain || null,
      domain: fallbackDomain || null,
      industry: null,
      employeeCount: null,
      location: null,
      technologies: [],
      intentScore: null,
      signals: [],
      found: false,
    };
  }
  const data = raw.data || raw;
  return {
    companyName: data.name || data.company_name || data.companyName || fallbackDomain || null,
    domain: data.domain || data.company_domain || fallbackDomain || null,
    industry: data.industry || null,
    employeeCount: data.employee_count || data.employeeCount || data.size || null,
    location: data.location || data.headquarters || null,
    technologies: data.tech_stack || data.technologies || data.techStack || [],
    intentScore: data.intent_score ?? data.intentScore ?? data.score ?? null,
    signals: data.signals || [],
    found: raw.found !== false && Boolean(data.name || data.domain),
    raw: undefined,
  };
}

// Lookup-first company intelligence:
//   1. lookup via CRM (companies.list filtered by domain) — free, no credits
//   2. only if important fields are missing -> enrich.company (billable, 1 credit)
// Verified SDK: g8.companies.list(params), g8.companies.get(id),
// g8.companies.contacts(id), g8.enrich.company({domain}).
function isImportantMissing(c) {
  if (!c) return true;
  return !c.companyName || !c.industry;
}

export async function lookupCompany(domain) {
  if (!domain || !graph8Configured) return { found: false, data: null };
  try {
    const res = await g8.companies.list({ domain, limit: 1 });
    const rows = res?.data || res?.companies || (Array.isArray(res) ? res : []);
    const hit = Array.isArray(rows) ? rows[0] : null;
    if (!hit) return { found: false, data: null };
    return {
      found: true,
      source: "lookup",
      companyId: hit.id ?? hit.company_id ?? null,
      data: normalizeCompany(hit, domain),
    };
  } catch (error) {
    console.warn(`[COMPANY] lookup failed for ${domain}:`, error.message);
    return { found: false, error: error.message, data: null };
  }
}

export async function fetchCompanyDetails(domain) {
  if (!domain) return { found: false, data: null };
  if (!graph8Configured) {
    return { found: false, notConfigured: true, data: null, domain };
  }
  // Step 1: cheap CRM lookup.
  const lookedUp = await lookupCompany(domain);
  if (lookedUp.found && !isImportantMissing(lookedUp.data)) {
    return { ...lookedUp, source: "lookup" };
  }
  // Step 2: billable enrichment only when something important is missing.
  try {
    const result = await g8.enrich.company({ domain });
    return {
      found: true,
      source: lookedUp.found ? "lookup+enrichment" : "enrichment",
      companyId: lookedUp.companyId || null,
      data: normalizeCompany(result, domain),
    };
  } catch (error) {
    const status = error?.status || error?.response?.status;
    console.warn(`[ENRICH] Failed for ${domain}:`, error.message);
    if (lookedUp.found) return { ...lookedUp, enrichmentError: error.message };
    return {
      found: false,
      error: error.message,
      rateLimited: status === 429,
      data: normalizeCompany(null, domain),
    };
  }
}

export async function fetchCompanyContacts(companyId, limit = 10) {
  if (!companyId || !graph8Configured) return [];
  try {
    const res = await g8.companies.contacts(companyId, limit);
    const rows = res?.data || res?.contacts || (Array.isArray(res) ? res : []);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.warn(`[COMPANY] contacts failed for ${companyId}:`, error.message);
    return [];
  }
}