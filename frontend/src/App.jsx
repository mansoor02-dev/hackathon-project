import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDashed,
  Clock3,
  Globe2,
  HeartPulse,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  Workflow,
} from "lucide-react";
import { getHealth, resolveVisitor, getGraph8Status, getDashboardState, getEvents } from "./api.js";

const initialResource = { status: "loading", data: null, error: null, checkedAt: null };

// Backend may return the legacy flat shape ({company: "Acme", ...}) or the
// rich shape ({company: {name, domain, industry}, intent, experience}).
function visitorCompany(visitor) {
  if (!visitor) return null;
  if (typeof visitor.company === "string") return visitor.company;
  return visitor.company?.name || null;
}

function visitorDomain(visitor) {
  if (!visitor) return null;
  return visitor.domain || visitor.company?.domain || null;
}

function visitorIndustry(visitor) {
  return visitor?.company?.industry || null;
}

function visitorIntent(visitor) {
  if (visitor?.intent && typeof visitor.intent.score === "number") return visitor.intent;
  return null;
}

function visitorExperience(visitor) {
  return visitor?.experience || null;
}

function timeLabel(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function ConnectionStatus({ label, status, detail }) {
  return (
    <div className={`connection connection-${status}`} title={detail}>
      <span className="connection-dot" />
      <span className="connection-label">{label}</span>
      <span className="connection-value">
        {status === "connected" ? "Connected" : status === "checking" ? "Checking" : status === "disconnected" ? "Disconnected" : "Not verified"}
      </span>
    </div>
  );
}

function SectionTitle({ icon: Icon, eyebrow, title, action }) {
  return (
    <div className="section-title">
      <div className="section-heading">
        <span className="section-icon"><Icon size={17} strokeWidth={1.8} /></span>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
      </div>
      {action}
    </div>
  );
}

function StateMessage({ status, error, onRetry, emptyTitle, emptyCopy }) {
  if (status === "loading") {
    return (
      <div className="state-message" role="status">
        <span className="spinner" />
        <span>Checking the backend…</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="state-message state-error" role="alert">
        <AlertCircle size={18} />
        <div className="state-copy">
          <strong>Could not load this information</strong>
          <span>{error}</span>
        </div>
        <button className="text-button" onClick={onRetry}>Retry</button>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <span className="empty-icon"><CircleDashed size={20} strokeWidth={1.7} /></span>
      <div>
        <strong>{emptyTitle}</strong>
        <p>{emptyCopy}</p>
      </div>
    </div>
  );
}

function CompanyDetails({ visitor }) {
  const company = visitorCompany(visitor);
  const domain = visitorDomain(visitor);
  const industry = visitorIndustry(visitor);
  const identified = Boolean(company || domain);

  return (
    <div className="company-details">
      <div className="company-identity">
        <span className="company-mark"><Building2 size={21} strokeWidth={1.7} /></span>
        <div>
          <span className="field-label">COMPANY</span>
          <strong>{company || (identified ? "Company identified" : "No company resolved")}</strong>
        </div>
      </div>
      <div className="detail-cell">
        <span className="field-label">DOMAIN</span>
        <strong>{domain || "Not available"}</strong>
      </div>
      <div className="detail-cell">
        <span className="field-label">INDUSTRY</span>
        <strong>{industry || "Not returned"}</strong>
      </div>
      <div className="detail-cell">
        <span className="field-label">TRAFFIC</span>
        <strong>{visitor?.traffic_type || "Unknown"}</strong>
      </div>
    </div>
  );
}

function VisitorPanel({ resource, onRetry }) {
  const resolved = resource.status === "success" && resource.data?.personalized === true;
  const company = visitorCompany(resource.data);
  const intent = resource.status === "success" ? visitorIntent(resource.data) : null;
  const intentPct = typeof intent?.score === "number" ? Math.max(0, Math.min(100, intent.score)) : 0;

  return (
    <section className="panel visitor-panel">
      <SectionTitle icon={UserRound} eyebrow="LIVE VISITOR LOOKUP" title="Visitor intelligence" />
      {resource.status !== "success" ? (
        <StateMessage
          status={resource.status}
          error={resource.error}
          onRetry={onRetry}
          emptyTitle="No visitor profile yet"
          emptyCopy="The resolver returned no saved visitor profile for this request."
        />
      ) : (
        <>
          <div className="visitor-summary">
            <div className={`visitor-avatar ${resolved ? "avatar-active" : ""}`}>
              {resolved ? <Building2 size={23} /> : <UserRound size={23} />}
            </div>
            <div className="visitor-copy">
              <div className="visitor-name-row">
                <h3>{company || "No visitor profile yet"}</h3>
                <span className={`status-tag ${resolved ? "tag-success" : "tag-neutral"}`}>
                  <span className="tag-dot" />{resolved ? "Resolved" : "Unresolved"}
                </span>
              </div>
              <p>{resolved ? (resource.data.headline || visitorExperience(resource.data)?.headline) : "Current visitor resolution is not persisted by the backend."}</p>
            </div>
            <div className="lookup-stamp">
              <span>LAST CHECK</span>
              <strong>{resource.checkedAt ? timeLabel(resource.checkedAt) : "Just now"}</strong>
            </div>
          </div>
          <CompanyDetails visitor={resolved ? resource.data : null} />
          <div className="intent-block">
            <div className="intent-main">
              <div>
                <span className="field-label">INTENT SCORE</span>
                <div className="intent-score">{intent ? intent.score : "—"}<span>/ 100</span></div>
              </div>
              <div className="intent-status">
                <span className="intent-indicator"><CircleDashed size={16} /></span>
                <div><strong>{intent ? `${intent.level} intent · ${resource.data.traffic_type}` : "Not available"}</strong><span>{intent ? "Reported by the visitor resolver" : "No intent score is returned by this endpoint"}</span></div>
              </div>
            </div>
            <div className="intent-track" aria-label={intent ? `Intent score ${intent.score}` : "Intent score unavailable"}><span style={intent ? { width: `${intentPct}%` } : undefined} /></div>
          </div>
        </>
      )}
    </section>
  );
}

function PersonalizationPanel({ resource }) {
  const resolved = resource.status === "success" && resource.data?.personalized === true;
  const experience = resource.status === "success" ? visitorExperience(resource.data) : null;

  return (
    <section className="panel compact-panel">
      <SectionTitle icon={Sparkles} eyebrow="EXPERIENCE" title="Personalization" />
      {resource.status === "loading" || resource.status === "error" ? (
        <StateMessage
          status={resource.status}
          error={resource.error}
          onRetry={() => window.dispatchEvent(new Event("retry-visitor"))}
          emptyTitle="Personalization status unavailable"
          emptyCopy="Waiting for a visitor resolution response."
        />
      ) : (
        <div className="status-list">
          <div className="status-row">
            <span className={`row-icon ${resolved ? "row-icon-success" : ""}`}>{resolved ? <Check size={15} /> : <CircleDashed size={15} />}</span>
            <div><strong>Personalized response</strong><span>{resolved ? "Available for this request" : "Not triggered for this visitor"}</span></div>
            <span className={`row-status ${resolved ? "text-success" : "text-muted"}`}>{resolved ? "Ready" : "Inactive"}</span>
          </div>
          <div className="status-row">
            <span className="row-icon"><Globe2 size={15} /></span>
            <div><strong>Landing page</strong><span>{experience?.page_url || (resolved ? "No page details in resolver response" : "No page was reported")}</span></div>
            <span className={`row-status ${experience?.page_url ? "text-success" : "text-muted"}`}>{experience?.page_url ? (experience.page_mode === "reused" ? "Reused" : "Generated") : "Not reported"}</span>
          </div>
          {experience?.variant && (
            <div className="status-row">
              <span className="row-icon"><Sparkles size={15} /></span>
              <div><strong>Variant</strong><span>{experience.variant}</span></div>
              <span className="row-status text-muted">{resource.data.traffic_type}</span>
            </div>
          )}
          {resolved && <div className="personalized-copy">{resource.data.cta}</div>}
          {!resolved && resource.status === "success" && <p className="panel-footnote">No personalization for this visitor (traffic: {resource.data.traffic_type || "unknown"}).</p>}
        </div>
      )}
    </section>
  );
}

function MeetingPanel({ meeting }) {
  const hasMeeting = Boolean(meeting);
  const meta = meeting?.metadata || {};
  const contact = meeting?.visitor?.contactId || meta.contactId || null;

  return (
    <section className="panel compact-panel">
      <SectionTitle icon={CalendarDays} eyebrow="APPOINTMENTS" title="Meeting" />
      {!hasMeeting ? (
        <>
          <div className="workflow-unavailable">
            <span className="workflow-icon"><CalendarDays size={20} /></span>
            <div>
              <span className="status-tag tag-pending"><span className="tag-dot" />Awaiting event</span>
              <h3>No meeting record available</h3>
              <p>Booked-meeting events arrive through the signed Graph8 webhook and appear here once received.</p>
            </div>
          </div>
          <div className="meeting-meta">
            <div><span className="field-label">CONTACT</span><strong>Not available</strong></div>
            <div><span className="field-label">SCHEDULED</span><strong>Not available</strong></div>
            <div><span className="field-label">COMPANY</span><strong>Not available</strong></div>
          </div>
        </>
      ) : (
        <>
          <div className="workflow-unavailable">
            <span className="workflow-icon"><CalendarDays size={20} /></span>
            <div>
              <span className="status-tag tag-success"><span className="tag-dot" />Booked</span>
              <h3>{meta.title || "Meeting booked"}</h3>
              <p>{meeting.company ? `${meeting.company}${meeting.domain ? ` · ${meeting.domain}` : ""}` : "Company details pending enrichment."}</p>
            </div>
          </div>
          <div className="meeting-meta">
            <div><span className="field-label">CONTACT</span><strong>{contact ? `ID ${contact}` : "Not available"}</strong></div>
            <div><span className="field-label">SCHEDULED</span><strong>{meta.scheduledAt || meta.bookedAt || new Date(meeting.timestamp).toLocaleString()}</strong></div>
            <div><span className="field-label">COMPANY</span><strong>{meeting.company || "Not available"}</strong></div>
          </div>
        </>
      )}
    </section>
  );
}

function CoachPanel({ coaching, voice }) {
  const hasCoaching = Boolean(coaching);
  const mode = coaching?.metadata?.mode || null;
  const prep = coaching?.metadata?.prep || null;

  return (
    <section className="panel coach-panel">
      <SectionTitle
        icon={HeartPulse}
        eyebrow="MEETING PREPARATION"
        title="AI sales coach"
        action={<span className="coach-badge"><ShieldCheck size={14} /> {mode === "real" ? "Graph8 voice" : mode === "simulated" ? "Simulated prep" : "Graph8 workflow"}</span>}
      />
      {!hasCoaching ? (
        <>
          <div className="coach-empty">
            <div className="coach-orbit"><Sparkles size={21} strokeWidth={1.7} /></div>
            <h3>Coaching appears after a booked meeting</h3>
            <p>The webhook prepares prospect context and a coaching script. {voice?.mode === "not_configured" ? "Voice is not configured, so preparation will be a clearly labelled simulation." : "Preparation uses the configured Graph8 voice agent."}</p>
          </div>
          <div className="coach-topics">
            <span><UsersRound size={14} /> Prospect context</span>
            <span><Workflow size={14} /> Talking points</span>
            <span><Radio size={14} /> Questions & concerns</span>
          </div>
          <div className="coach-status"><span className="status-dot-neutral" />No coaching response reported</div>
        </>
      ) : (
        <>
          <div className="coach-empty">
            <div className="coach-orbit"><Sparkles size={21} strokeWidth={1.7} /></div>
            <h3>{prep?.title || `Prep ready for ${coaching.company || "prospect"}`}</h3>
            <p>{mode === "real" ? "Generated with the Graph8 voice agent." : "Simulated preparation — voice agent not configured."} {prep?.prospect_summary || ""}</p>
          </div>
          <div className="coach-topics">
            {(prep?.talking_points || ["Prospect context", "Talking points", "Questions & concerns"]).slice(0, 3).map((point) => (
              <span key={point}><Check size={12} /> {point.length > 60 ? `${point.slice(0, 60)}…` : point}</span>
            ))}
          </div>
          <div className="coach-status"><span className="status-dot-neutral" />{mode === "real" ? "Real Graph8 voice session" : "Simulated/demo coaching"} · {new Date(coaching.timestamp).toLocaleString()}</div>
        </>
      )}
    </section>
  );
}

function ActivityTimeline({ entries }) {
  const ordered = [...entries].sort((left, right) => right.at - left.at);

  return (
    <section className="panel activity-panel">
      <SectionTitle
        icon={Activity}
        eyebrow="THIS SESSION"
        title="Activity timeline"
        action={<span className="timeline-count">{ordered.length} {ordered.length === 1 ? "check" : "checks"}</span>}
      />
      {ordered.length === 0 ? (
        <div className="activity-empty"><Clock3 size={17} /><span>Dashboard checks will appear here when the connection finishes loading.</span></div>
      ) : (
        <div className="timeline-list">
          {ordered.map((entry, index) => (
            <div className="timeline-item" key={entry.id}>
              <span className={`timeline-marker ${entry.status === "error" ? "marker-error" : ""}`}>
                {entry.status === "error" ? <AlertCircle size={13} /> : <Check size={13} />}
              </span>
              <div className="timeline-content"><strong>{entry.title}</strong><span>{entry.detail}</span></div>
              <time>{timeLabel(entry.at)}</time>
              {index < ordered.length - 1 && <span className="timeline-line" />}
            </div>
          ))}
        </div>
      )}
      <div className="timeline-note"><ShieldCheck size={15} /><span>Backend webhook activity is persisted and merged into this timeline with dashboard checks.</span></div>
    </section>
  );
}

export default function App() {
  const [health, setHealth] = useState(initialResource);
  const [visitor, setVisitor] = useState(initialResource);
  const [graph8, setGraph8] = useState(initialResource);
  const [dashboard, setDashboard] = useState(initialResource);
  const [activity, setActivity] = useState([]);

  function logActivity(title, detail, status) {
    setActivity((current) => [{ id: `${Date.now()}-${Math.random()}`, title, detail, status, at: new Date() }, ...current].slice(0, 8));
  }

  async function checkHealth(signal) {
    setHealth((current) => ({ ...current, status: "loading", error: null }));
    try {
      const data = await getHealth({ signal });
      const checkedAt = new Date();
      setHealth({ status: "success", data, error: null, checkedAt });
      logActivity("Backend health checked", data.ok ? "Express health endpoint responded successfully" : "Health endpoint returned an unhealthy state", data.ok ? "success" : "error");
    } catch (error) {
      if (error.name === "AbortError") return;
      setHealth({ status: "error", data: null, error: error.message, checkedAt: new Date() });
      logActivity("Backend health check failed", error.message, "error");
    }
  }

  async function checkVisitor(signal) {
    setVisitor((current) => ({ ...current, status: "loading", error: null }));
    try {
      const data = await resolveVisitor({ signal });
      const checkedAt = new Date();
      setVisitor({ status: "success", data, error: null, checkedAt });
      logActivity("Visitor resolution checked", data.personalized ? "A personalized visitor response was returned" : "No saved visitor profile was returned", "success");
    } catch (error) {
      if (error.name === "AbortError") return;
      setVisitor({ status: "error", data: null, error: error.message, checkedAt: new Date() });
      logActivity("Visitor resolution failed", error.message, "error");
    }
  }

  async function checkGraph8(signal) {
    setGraph8((current) => ({ ...current, status: "loading", error: null }));
    try {
      const data = await getGraph8Status({ signal });
      setGraph8({ status: "success", data, error: null, checkedAt: new Date() });
      logActivity("Graph8 status checked", data.connected ? "Graph8 API credentials verified" : `Graph8 unavailable: ${data.error || "unknown"}`, data.connected ? "success" : "error");
    } catch (error) {
      if (error.name === "AbortError") return;
      setGraph8({ status: "error", data: null, error: error.message, checkedAt: new Date() });
      logActivity("Graph8 status check failed", error.message, "error");
    }
  }

  async function checkDashboard(signal) {
    setDashboard((current) => ({ ...current, status: "loading", error: null }));
    try {
      const [state, events] = await Promise.all([getDashboardState({ signal }), getEvents(20, { signal })]);
      setDashboard({ status: "success", data: { ...state, events: events.events || [] }, error: null, checkedAt: new Date() });
    } catch (error) {
      if (error.name === "AbortError") return;
      setDashboard({ status: "error", data: null, error: error.message, checkedAt: new Date() });
    }
  }

  function refreshAll(signal) {
    checkHealth(signal);
    checkVisitor(signal);
    checkGraph8(signal);
    checkDashboard(signal);
  }

  useEffect(() => {
    const controller = new AbortController();
    refreshAll(controller.signal);
    const interval = window.setInterval(() => { checkHealth(); checkDashboard(); }, 30000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const retryVisitor = () => checkVisitor();
    window.addEventListener("retry-visitor", retryVisitor);
    return () => window.removeEventListener("retry-visitor", retryVisitor);
  }, []);

  const healthConnected = health.status === "success" && health.data?.ok === true;
  const graph8Connected = graph8.status === "success" && graph8.data?.connected === true;
  const graph8State = graph8.status === "loading" ? "checking" : graph8.status === "success" ? (graph8Connected ? "connected" : "disconnected") : graph8.status === "error" ? "disconnected" : "unverified";
  const visitorBusy = visitor.status === "loading";
  const meeting = dashboard.status === "success" ? dashboard.data?.meeting : null;
  const coaching = dashboard.status === "success" ? dashboard.data?.coaching : null;
  const voice = dashboard.status === "success" ? dashboard.data?.voice : null;
  const backendEvents = dashboard.status === "success" ? dashboard.data?.events || [] : [];
  const timelineEntries = [
    ...activity,
    ...backendEvents.map((event) => ({
      id: `backend-${event.id}`,
      title: event.type.replace(/_/g, " "),
      detail: [event.company, event.domain].filter(Boolean).join(" · ") || "Graph8 event recorded",
      status: event.type === "error" ? "error" : "success",
      at: new Date(event.timestamp),
    })),
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Signal Desk home">
          <span className="brand-mark"><Activity size={19} strokeWidth={2.2} /></span>
          <span className="brand-name">signal<span>desk</span></span>
        </a>
        <div className="topbar-right">
          <span className="topbar-caption">WORKFLOW OVERVIEW</span>
          <div className="connection-group">
            <ConnectionStatus
              label="Backend"
              status={health.status === "loading" ? "checking" : healthConnected ? "connected" : "disconnected"}
              detail={health.error || (healthConnected ? `Connected to ${health.data.service}` : "The health endpoint did not return ok: true")}
            />
            <span className="connection-divider" />
            <ConnectionStatus
              label="Graph8"
              status={graph8State}
              detail={graph8.data ? (graph8Connected ? "Graph8 API credentials verified" : graph8.data.error || "Graph8 unavailable") : (graph8.error || "Checking Graph8 API status")}
            />
          </div>
        </div>
      </header>

      <main id="top" className="dashboard">
        <div className="page-heading">
          <div>
            <div className="overline"><span /> SIGNAL INTELLIGENCE</div>
            <h1>Visitor journey</h1>
            <p>One clear view of the signals behind your next conversation.</p>
          </div>
          <button className="refresh-button" aria-label="Refresh data" title="Refresh data" onClick={() => { refreshAll(); }} disabled={visitorBusy}>
            <RefreshCw size={15} className={visitorBusy ? "spin-icon" : ""} />
            <span>Refresh data</span>
          </button>
        </div>

        <div className="primary-grid">
          <VisitorPanel resource={visitor} onRetry={() => checkVisitor()} />
          <div className="right-stack">
            <PersonalizationPanel resource={visitor} />
            <div className="graph8-notice">
              <span className="notice-icon"><Radio size={16} /></span>
              <p><strong>{graph8Connected ? "Graph8 connection verified" : graph8State === "checking" ? "Checking Graph8 connection" : "Graph8 connection is unverified"}</strong><span>{graph8Connected ? "Backend authenticated against the Graph8 API." : (graph8.data?.error || graph8.error || "The backend could not verify Graph8 API credentials.")}</span></p>
              <ArrowUpRight size={15} className="notice-arrow" />
            </div>
          </div>
        </div>

        <div className="secondary-grid">
          <MeetingPanel meeting={meeting} />
          <CoachPanel coaching={coaching} voice={voice} />
        </div>

        <ActivityTimeline entries={timelineEntries} />

        <footer className="page-footer">
          <span><BadgeCheck size={14} /> Live data from the existing backend</span>
          <span><ChevronRight size={13} /> Webhook outcomes are saved for dashboard reads</span>
        </footer>
      </main>
    </div>
  );
}