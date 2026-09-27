import { useEffect, useState } from "react";
import { ArrowUpRight, Building2, CalendarCheck, CalendarDays, Check, Clock3, Sparkles, X } from "lucide-react";
import { resolveVisitor, getMeetingEventTypes, getMeetingSlots, requestMeeting } from "./api.js";

function domainFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get("domain")?.trim() || "";
  } catch {
    return "";
  }
}

function nextDays(count = 14) {
  const days = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    days.push(d);
  }
  return days;
}

function dayBounds(day) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);
  return { start: start.toISOString(), end: end.toISOString() };
}

function formatTime(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function BookingDialog({ company, companyDomain, onClose }) {
  const [types, setTypes] = useState({ status: "loading", data: [], error: null, liveBooking: false });
  const [typeId, setTypeId] = useState(null);
  const [day, setDay] = useState(() => nextDays()[0]);
  const [slots, setSlots] = useState({ status: "idle", data: [], error: null });
  const [slot, setSlot] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [booking, setBooking] = useState({ status: "idle", data: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    getMeetingEventTypes({ signal: controller.signal })
      .then((data) => {
        const list = data.event_types || [];
        setTypes({ status: "success", data: list, error: null, liveBooking: data.liveBooking === true });
        if (list.length > 0) setTypeId(list[0].id);
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setTypes({ status: "error", data: [], error: error.message, liveBooking: false });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (typeId == null || !day) return;
    const controller = new AbortController();
    setSlots({ status: "loading", data: [], error: null });
    setSlot(null);
    const { start, end } = dayBounds(day);
    getMeetingSlots(
      { eventTypeId: typeId, start, end, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      { signal: controller.signal }
    )
      .then((data) => {
        const key = Object.keys(data.slots || {}).find((k) => k.startsWith(day.toISOString().slice(0, 10)));
        const list = (key && data.slots[key]) || Object.values(data.slots || {}).flat();
        setSlots({ status: "success", data: list, error: null });
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        setSlots({ status: "error", data: [], error: error.message });
      });
    return () => controller.abort();
  }, [typeId, day]);

  async function confirm(e) {
    e.preventDefault();
    setBooking({ status: "loading", data: null, error: null });
    try {
      const data = await requestMeeting({
        event_type_id: typeId,
        slot,
        name,
        email,
        company: company || null,
        domain: companyDomain || null,
      });
      setBooking({ status: "success", data, error: null });
    } catch (error) {
      setBooking({ status: "error", data: null, error: error.message });
    }
  }

  const days = nextDays();
  const chosenType = types.data.find((t) => Number(t.id) === Number(typeId)) || null;

  return (
    <div className="booking-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Book a meeting">
      <div className="booking-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="booking-header">
          <div>
            <p className="eyebrow">SCHEDULE</p>
            <h2>Book a meeting</h2>
          </div>
          <button className="booking-close" onClick={onClose} aria-label="Close booking dialog"><X size={17} /></button>
        </div>

        {booking.status === "success" ? (
          <div className="booking-success">
            <span className="booking-success-icon"><Check size={20} /></span>
            <h3>{booking.data.title || "Meeting requested"}</h3>
            <p>{booking.data.scheduledAt ? new Date(booking.data.scheduledAt).toLocaleString() : ""}</p>
            <p className="booking-mode-note">
              {booking.data.mode === "LIVE"
                ? "Live Graph8 booking — calendar invitation sent."
                : "Demo booking — recorded for this demo, no calendar invitation sent."}
            </p>
            <a className="experience-cta" href="/dashboard">View in dashboard <ArrowUpRight size={16} /></a>
          </div>
        ) : (
          <form onSubmit={confirm}>
            <label className="booking-label" htmlFor="booking-type">Meeting type</label>
            {types.status === "loading" && <p className="booking-hint">Loading live meeting types…</p>}
            {types.status === "error" && <p className="booking-error">Could not load meeting types: {types.error}</p>}
            {types.status === "success" && types.data.length === 0 && (
              <p className="booking-hint">No bookable meeting types are configured in Graph8.</p>
            )}
            {types.data.length > 0 && (
              <select id="booking-type" value={typeId ?? ""} onChange={(e) => setTypeId(Number(e.target.value))}>
                {types.data.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}{t.duration ? ` · ${t.duration} min` : ""}</option>
                ))}
              </select>
            )}

            <span className="booking-label"><CalendarDays size={13} /> Day</span>
            <div className="booking-days">
              {days.map((d) => (
                <button
                  type="button"
                  key={d.toISOString()}
                  className={`booking-day ${day && d.toDateString() === day.toDateString() ? "day-active" : ""}`}
                  onClick={() => setDay(d)}
                >
                  <span>{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
                  <strong>{d.getDate()}</strong>
                </button>
              ))}
            </div>

            <span className="booking-label"><Clock3 size={13} /> Live availability</span>
            {slots.status === "loading" && <p className="booking-hint">Checking live availability…</p>}
            {slots.status === "error" && <p className="booking-error">Could not load slots: {slots.error}</p>}
            {slots.status === "success" && slots.data.length === 0 && (
              <p className="booking-hint">No open slots that day — try another day.</p>
            )}
            {slots.data.length > 0 && (
              <div className="booking-slots">
                {slots.data.map((s) => (
                  <button
                    type="button"
                    key={s.slot_uid || s.time}
                    className={`booking-slot ${slot === s.time ? "slot-active" : ""}`}
                    onClick={() => setSlot(s.time)}
                  >
                    {formatTime(s.time)}
                  </button>
                ))}
              </div>
            )}

            <div className="booking-fields">
              <div>
                <label className="booking-label" htmlFor="booking-name">Your name</label>
                <input id="booking-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" autoComplete="name" />
              </div>
              <div>
                <label className="booking-label" htmlFor="booking-email">Work email</label>
                <input id="booking-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ada@company.com" inputMode="email" autoComplete="email" />
              </div>
            </div>

            {booking.status === "error" && <p className="booking-error">{booking.error}</p>}

            <button
              className="experience-cta booking-confirm"
              type="submit"
              disabled={typeId == null || !slot || !name.trim() || !email.trim() || booking.status === "loading"}
            >
              <CalendarCheck size={16} /> {booking.status === "loading" ? "Requesting…" : `Confirm${chosenType ? ` · ${chosenType.title}` : ""}`}
            </button>
            {!types.liveBooking && (
              <p className="booking-mode-note">Demo scheduling — requests are recorded locally so the dashboard flow stays demonstrable. No calendar invitation is sent.</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

// Visitor-facing landing page. Backend is the source of truth:
// all copy/variant/reason comes from GET /api/resolve-visitor.
export default function Experience() {
  const [domainInput, setDomainInput] = useState(() => domainFromUrl());
  const [domain, setDomain] = useState(() => domainFromUrl());
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [bookingOpen, setBookingOpen] = useState(false);

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
              <button className="experience-secondary booking-open" onClick={() => setBookingOpen(true)}>
                <CalendarCheck size={15} /> Book a meeting
              </button>
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

      {bookingOpen && (
        <BookingDialog company={company} companyDomain={companyDomain} onClose={() => setBookingOpen(false)} />
      )}
    </div>
  );
}
