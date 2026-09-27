import { g8, graph8Configured } from "../../config/config.js";
import { fetchCompanyContacts } from "../company-service.js";

// Contact discovery — verified SDK:
//   g8.companies.contacts(companyId, limit)
//   g8.enrich.search(filters, page, limit)  -> POST /api/v1/search/contacts
//   g8.search.contacts({filters, page, limit})
// Finds an appropriate business contact for a recovery opportunity.
// Never invents contacts; returns null when nothing suitable is found.
const SENIORITY_RANK = ["c-level", "vp", "director", "head", "manager", "senior", "lead"];

function rankContact(c) {
  const title = String(c.job_title || c.title || c.role || "").toLowerCase();
  const idx = SENIORITY_RANK.findIndex((s) => title.includes(s));
  const hasEmail = Boolean(c.work_email || c.email);
  return { idx: idx === -1 ? 99 : idx, hasEmail };
}

export function pickBestContact(contacts = []) {
  if (!Array.isArray(contacts) || !contacts.length) return null;
  const withEmail = contacts.filter((c) => c.work_email || c.email);
  const pool = withEmail.length ? withEmail : contacts;
  return [...pool].sort((a, b) => {
    const ra = rankContact(a);
    const rb = rankContact(b);
    if (ra.hasEmail !== rb.hasEmail) return ra.hasEmail ? -1 : 1;
    return ra.idx - rb.idx;
  })[0];
}

export function normalizeContact(raw) {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.contact_id ?? null,
    name: raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(" ") || null,
    email: raw.work_email || raw.email || null,
    title: raw.job_title || raw.title || raw.role || null,
    company: raw.company_name || raw.company || null,
    domain: raw.company_domain || raw.domain || null,
    raw,
  };
}

export async function discoverContact({ domain, companyName = null, companyId = null } = {}) {
  if (!graph8Configured) return { contact: null, mode: "NOT_CONFIGURED", reason: "Graph8 API key not configured" };
  // 1. Associated CRM contacts for a known company.
  if (companyId) {
    const rows = await fetchCompanyContacts(companyId, 10);
    const best = pickBestContact(rows);
    if (best) return { contact: normalizeContact(best), mode: "LIVE", source: "companies.contacts" };
  }
  // 2. Open-data search scoped to the company domain.
  if (domain) {
    const filters = [{ field: "company_domain", operator: "any_of", value: [domain] }];
    try {
      const res = await g8.enrich.search(filters, 1, 10);
      const rows = res?.data || res?.contacts || (Array.isArray(res) ? res : []);
      const best = pickBestContact(Array.isArray(rows) ? rows : []);
      if (best) return { contact: normalizeContact(best), mode: "LIVE", source: "enrich.search" };
    } catch (error) {
      console.warn("[DISCOVERY] enrich.search failed:", error.message);
      try {
        const res2 = await g8.search.contacts({ filters, page: 1, limit: 10 });
        const rows2 = res2?.data || (Array.isArray(res2) ? res2 : []);
        const best2 = pickBestContact(Array.isArray(rows2) ? rows2 : []);
        if (best2) return { contact: normalizeContact(best2), mode: "LIVE", source: "search.contacts" };
      } catch (e2) {
        return { contact: null, mode: "ERROR", reason: e2.message };
      }
      return { contact: null, mode: "NOT_FOUND", reason: `No suitable contact for ${companyName || domain}` };
    }
    return { contact: null, mode: "NOT_FOUND", reason: `No suitable contact for ${companyName || domain}` };
  }
  return { contact: null, mode: "NOT_FOUND", reason: "No domain to search" };
}
