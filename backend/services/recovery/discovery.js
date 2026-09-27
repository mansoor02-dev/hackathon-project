import { g8, graph8Configured } from "../../config/config.js";
import { discoverContact } from "../graph8/contacts-service.js";

// Contact pipeline for a recovery opportunity:
//   company -> contact search -> lookup -> enrichment (only if missing) ->
//   email verification. Billable calls are avoided unless needed.
function needsEnrichment(contact) {
  if (!contact) return false;
  return !contact.title || !contact.email;
}

export async function enrichContact(contact) {
  if (!contact || !graph8Configured) return { contact, mode: "NOT_CONFIGURED" };
  if (!needsEnrichment(contact)) return { contact, mode: "SKIPPED", reason: "all important fields present" };
  try {
    const params = contact.email
      ? { email: contact.email }
      : { name: contact.name, company: contact.company };
    const enriched = await g8.enrich.person(params);
    const data = enriched?.data || enriched;
    const merged = {
      ...contact,
      name: contact.name || data?.name || [data?.first_name, data?.last_name].filter(Boolean).join(" ") || null,
      email: contact.email || data?.work_email || data?.email || null,
      title: contact.title || data?.job_title || data?.title || null,
    };
    return { contact: merged, mode: "LIVE", source: "enrich.person" };
  } catch (error) {
    console.warn("[ENRICH] person failed:", error.message);
    return { contact, mode: "ERROR", reason: error.message };
  }
}

export async function verifyContactEmail(email) {
  if (!email) return { state: "unavailable", eligible: false, reason: "email unavailable" };
  if (!graph8Configured) return { state: "not_configured", eligible: false, email };
  try {
    const res = await g8.enrich.verifyEmail(email);
    const data = res?.data || res;
    const status = String(
      data?.status || data?.result || data?.verification || "unknown"
    ).toLowerCase();
    const eligible =
      ["valid", "deliverable", "accept_all", "accept-all", "risky"].some((s) => status.includes(s)) ||
      data?.is_valid === true ||
      data?.deliverable === true;
    const invalid =
      ["invalid", "undeliverable", "bounced", "failed"].some((s) => status.includes(s)) ||
      data?.is_valid === false;
    return {
      state: invalid ? "invalid" : eligible ? "valid" : "unknown",
      eligible: eligible && !invalid,
      email,
      raw: data,
    };
  } catch (error) {
    return { state: "error", eligible: false, email, reason: error.message };
  }
}

export { discoverContact };
