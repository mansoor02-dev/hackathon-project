import { g8, graph8Configured, pageTemplate } from "../config/config.js";

// Cache key: source template + company domain + variant. Reuses variants,
// never creates a new page per request for the same key.
const pageCache = new Map();

export function landingCacheKey({ domain, variant }) {
  return `${pageTemplate}::${String(domain || "unknown").toLowerCase()}::${variant}`;
}

export function getCachedPage(key) {
  return pageCache.get(key) || null;
}

export async function generateDynamicLandingPage(company, { variant = "generic", supporting = "", cta = "" } = {}) {
  const domain = company.domain || company.companyName || "unknown";
  const key = landingCacheKey({ domain, variant });
  const cached = pageCache.get(key);
  if (cached) return { ...cached, cached: true };

  if (!graph8Configured) {
    return null;
  }

  try {
    const created = await g8.api.call(
      "create_landing_page_landing_pages_post",
      {
        body: {
          name: `Accelerating Revenue Pipelines for ${company.companyName || company.name || domain}`,
          goal: `Create a personalized landing page for ${company.companyName || company.name || domain}, a ${company.industry || "B2B"} company. Variant: ${variant}. ${supporting} CTA: ${cta}`.slice(0, 2000),
          generate: true,
        },
      }
    );
    const page = created.data ?? created;
    const pageId = page.id || page.page_id;

    if (!pageId) {
      throw new Error("Graph8 did not return an ID for the generated page");
    }

    let url = null;
    try {
      const published = await g8.api.call(
        "publish_landing_page_landing_pages__landing_page_id__publish_post",
        { path: { landing_page_id: String(pageId) } }
      );
      url = published.data?.url || published?.url || null;
    } catch (publishError) {
      // Create succeeded but publish failed: keep the page, report honestly.
      console.warn("[LANDING PAGE] publish failed:", publishError.message);
    }

    const result = { id: pageId, page, url, cached: false, variant, mode: "real" };
    pageCache.set(key, result);
    return result;
  } catch (error) {
    // Graph8 failure must NOT destroy the website — fall back gracefully.
    console.warn("[LANDING PAGE] generation failed:", error.message);
    return null;
  }
}

export function _clearLandingCache() {
  pageCache.clear();
}