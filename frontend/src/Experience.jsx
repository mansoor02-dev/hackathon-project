import { useEffect, useState } from "react";
import { ArrowUpRight, Building2, CalendarCheck, Sparkles } from "lucide-react";
import { resolveVisitor } from "./api.js";

function domainFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("domain")?.trim() || "";
  } catch {
    return "";
  }
}

// Visitor-facing landing page. Backend is the source of truth:
// all copy/variant/reason comes from GET /api/resolve-visitor.
export default function Experience() {
  const [domainInput, setDomainInput] = useState(() => domainFromUrl());
  const [domain, setDomain] = useState(() => domainFromUrl());
  const [state, setState] = useState({ status: "loading", data: null, error: null });

  useEffect(() => {
    const onPop = () => {
      const d = domainFromUrl();
      setDomainInput(d);
      setDomain(d);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", data: null, error: null });
    resolveVisitor({ domain: domain || null, signal: controller.signal })
      .then((data) => setState({ status: "success", data, error: null }))
      .catch((error) => {
        if (error.name === "AbortError") return;
        setState({ status: "error", data: null, error: error.message });
      });
    return () => controller.abort();
  }, [domain]);

  function applyDomain(next) {
    const clean = (next || "").trim();
    const url = new URL(window.location.href);
    if (clean) url.searchParams.set("domain", clean);
    else url.searchParams.delete("domain");
    window.history.pushState({}, "", url.pathname + url.search);
    setDomain(clean);
  }

  const data = state.data;
  const resolved = state.status === "success" && (data?.resolved ?? Boolean(data?.company?.name || data?.domain));
  const personalized = state.status === "success" && data?.personalized === true;
  const company = data?.company?.name || null;
  const companyDomain = data?.domain || data?.company?.domain || null;
  const industry = data?.company?.industry || null;
  const trafficType = data?.traffic_type || "unknown";
  const intent = data?.intent || null;
  const exp = data?.experience || {};
  const family = exp.family || "default";
  const isDemo = (data?.source || "") === "query" && Boolean(domain);
  const isLive = (data?.source || "") === "webhook_state";

  const headline = exp.headline || "AI infrastructure for modern teams.";
  const supporting = exp.supporting || "Launch reliable AI workflows without adding operational complexity.";
  const cta = exp.cta || "See how it works";

  return (
    <div className={`experience experience-${family}`}>
      <header className="experience-topbar">
        <a className="brand" href="/experience">
          <span className="brand-mark"><Sparkles size={18} strokeWidth={2.2} /></span>
          <span className="brand-name">signal<span>desk</span></span>
        </a>
        <nav className="experience-nav">
          <a href="/experience" className="experience-nav-active">Experience</a>
          <a href="/dashboard">Dashboard</a>
        </nav>
      </header>

      <main className="experience-main">
        <form
          className="experience-demo-bar"
          onSubmit={(e) => {
            e.preventDefault();
            applyDomain(domainInput);
          }}
        >
          <label htmlFor="experience-domain">Demo company domain</label>
          <div className="experience-demo-row">
            <input
              id="experience-domain"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="microsoft.com — try another supported domain"
              inputMode="url"
              autoComplete="off"
            />
            <button type="submit">Load experience</button>
          </div>
          <p>
            {isDemo ? "Demo resolution — data for this preview came from a local demo query, not a live Graph8 webhook." : isLive ? "Live Graph8 signal — this preview reflects the latest webhook resolution." : "Add ?domain=microsoft.com to preview a resolved company without ngrok."}
          </p>
        </form>

        {state.status === "loading" && (
          <div className="experience-hero" role="status">
            <span className="spinner" />
            <p>Resolving visitor…</p>
          </div>
        )}

        {state.status === "error" && (
          <div className="experience-hero" role="alert">
            <h1>Could not load this experience.</h1>
            <p>{state.error}</p>
          </div>
        )}

        {state.status === "success" && (
          <div className="experience-hero">
            <div className="experience-badges">
              <span className={`experience-badge ${personalized ? "badge-personalized" : "badge-default"}`}>
                {personalized ? `Personalized · ${family}` : "Default experience"}
              </span>
              <span className="experience-badge badge-source">
                {isDemo ? "Demo resolution" : isLive ? "Live Graph8 signal" : `Source: ${data?.source || "none"}`}
              </span>
            </div>

            <h1>{headline}</h1>
            <p className="experience-supporting">{supporting}</p>

            <div className="experience-cta-row">
              <a className="experience-cta" href="/dashboard">
                {cta} <ArrowUpRight size={16} />
              </a>
              <a className="experience-secondary" href="/dashboard">
                <CalendarCheck size={15} /> Book a meeting
              </a>
            </div>

            {industry && (
              <p className="experience-context">Built for {industry} teams</p>
            )}

            {isDemo && resolved && company && (
              <p className="experience-demo-note">
                <Building2 size={14} /> Personalized for {company}
                {companyDomain ? ` · ${companyDomain}` : ""}
                {trafficType ? ` · ${trafficType.replace(/_/g, " ")}` : ""}
                {typeof intent?.score === "number" ? ` · intent ${intent.score}` : ""}
              </p>
            )}

            {resolved && !isDemo && company && (
              <p className="experience-demo-note">
                <Building2 size={14} /> Showing experience for {company}
                {companyDomain ? ` · ${companyDomain}` : ""}
              </p>
            )}

            {!resolved && (
              <p className="experience-demo-note">Showing the default experience — no company resolved for this visitor.</p>
            )}
          </div>
        )}
      </main>

      <footer className="experience-footer">
        <span>Signal Desk · visitor experience (backend is the source of truth)</span>
        <a href="/dashboard">Open internal dashboard</a>
      </footer>
    </div>
  );
}
