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

export async function fetchCompanyDetails(domain) {
  if (!domain) return { found: false, data: null };
  if (!graph8Configured) {
    return { found: false, notConfigured: true, data: null, domain };
  }
  try {
    const result = await g8.enrich.company({ domain });
    return { found: true, data: normalizeCompany(result, domain) };
  } catch (error) {
    const status = error?.status || error?.response?.status;
    console.warn(`[ENRICH] Failed for ${domain}:`, error.message);
    return {
      found: false,
      error: error.message,
      rateLimited: status === 429,
      data: normalizeCompany(null, domain),
    };
  }
}