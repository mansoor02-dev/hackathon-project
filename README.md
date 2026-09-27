# Signal Desk — B2B Website Personalization on Graph8

Anonymous visitor → Graph8 visitor intelligence → traffic/intent classification →
personalization decision → Graph8 landing-page personalization → personalized
experience → meeting booking (Graph8 Calendar) → webhook → backend → AI sales prep.
The dashboard (`frontend`) is an internal operator view; it is not the
visitor-facing experience.

## Architecture

```
visitor -> Graph8 signals -> Express backend -> classification
  -> Graph8 landing pages (create + publish, cached per domain+variant)
  -> personalized experience -> Graph8 Calendar booking
  -> webhook (ngrok) -> Express -> enrichment -> AI sales prep
  -> dashboard (React) reads /api/state + /api/events
```

- `backend/` — Node + Express. Never exposes `G8_API_KEY` / webhook secret.
- `frontend/` — React + Vite dashboard (preserved design, wired to real data).
- Graph8 access via `@graph8/sdk` v0.245.0 (typed clients + verified
  `g8.api.call(...)` operation IDs, never invented).

## Local setup

```bash
cd backend && cp .env.example .env   # fill in keys below
npm install
node server.js                        # :3000

cd frontend && npm install
# set BACKEND_PROXY_TARGET in .env.local, then:
npm run dev                           # :5173, proxies /health + /api -> backend
```

## Environment variables

Backend (see `backend/.env.example`): `PORT`, `G8_API_KEY` (server-only),
`GRAPH8_BASE_URL`, `GRAPH8_WEBHOOK_SECRET` (server-only),
`GRAPH8_PAGE_TEMPLATE`, `GRAPH8_TARGET_ACCOUNTS` (comma-separated, optional),
`GRAPH8_INTENT_THRESHOLD` (default 60, medium threshold fixed at 40),
`GRAPH8_VOICE_AGENT_ID` (optional; unset = labelled simulation).

Frontend (`frontend/.env.local`): `BACKEND_PROXY_TARGET=http://127.0.0.1:3000`,
`VITE_API_BASE_URL=` (empty = same origin, via dev proxy). No secrets in Vite env.

## Graph8 setup

1. API key: app.graph8.com/settings → MCP & API → API. Put it in `G8_API_KEY`.
2. Webhook secret: same area → signing secret → `GRAPH8_WEBHOOK_SECRET`.
3. Voice agent (optional): agent id → `GRAPH8_VOICE_AGENT_ID`. Without it the
   system stores an honest `simulated` prep instead of calling Graph8 voice.
4. Verify: `GET /api/graph8/status` → `{connected:true, provider:"graph8"}`
   (cheap read-only `contacts.list`, no billable calls).

## Webhook setup

Subscribe (in Graph8) `visitor.identified` (+`intent.signal`) to
`{PUBLIC}/webhooks/graph8/signals/visitor` and `meeting.booked` to
`{PUBLIC}/webhooks/graph8/appointments/booked`. Verification uses the raw body
(`X-G8-Signature`, optional `X-G8-Timestamp`, 300 s tolerance):
missing/invalid/tampered → 401; malformed signed JSON → 400; unknown event → 200 ignored.

## Ngrok setup

```bash
ngrok http 3000
# use the https URL as {PUBLIC} above; keep Express running locally
```

## How personalization works

1. `GET /api/resolve-visitor[?domain=]` — resolves via explicit domain
   (demo override, real `enrich.company` + best-effort `signals.company`) or
   latest webhook state. Never crashes; unknown → generic + `personalized:false`.
2. `classifyTraffic()` (`services/traffic-classifier.js`) →
   `unknown|low_intent|medium_intent|high_intent|target_account`
   (`target_account` only on explicit `GRAPH8_TARGET_ACCOUNTS` match).
3. `buildPersonalization()` — deterministic copy, no invented claims.
4. `generateDynamicLandingPage()` — verified `create_landing_page…` +
   `publish_landing_page…` ops, cached by `template+domain+variant`, reused on
   repeat visits; failure → graceful fallback, site never breaks.

## How to test locally

```bash
cd backend && node server.js &
node tests/backend-test.mjs   # 28 checks: auth, webhooks, real read-only API, mocked flows
```

Covers: health, resolve-visitor (+domain fallback), graph8 status, events/state,
401s, tampered body, malformed JSON, unknown events, missing intent, low/high
intent, idempotent redelivery, meeting validation, real `contacts.list`,
SDK operation existence, mocked landing-page + coaching flows.

## Demo procedure

1. `GET /api/graph8/status` → connected. Dashboard shows Graph8 Connected.
2. Trigger/await `visitor.identified` webhook (or open
   `/api/resolve-visitor?domain=<customer-domain>` for the enrichment path).
3. Dashboard shows company, traffic type, intent, variant.
4. Visitor sees personalized headline/CTA; Graph8 page reused via cache.
5. Book via Graph8 Calendar → webhook → dashboard records meeting + prep.
6. With `GRAPH8_VOICE_AGENT_ID`: real voice script; without: labelled simulation.
7. Fallback: unknown visitor → generic page, no crash.

## Simulated when credentials are unavailable

- Voice script without `GRAPH8_VOICE_AGENT_ID` → `simulated` prep (labelled in UI).
- Landing-page generation without API key → skipped, generic experience.
- Company signals without `intent:read` scope → enrichment-only, no crash.
