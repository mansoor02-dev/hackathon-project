# Signal Desk — turns anonymous B2B website traffic into an automated revenue workflow

Anonymous visitor → Graph8 identifies visitor/company → company + intent +
activity signals → traffic qualification → personalized landing experience →
form/calendar → meeting booked (meeting workflow) OR no meeting (inbound →
outbound recovery: find contact → enrich → verify email → Graph8 Sequence →
reply/meeting). The dashboard (`frontend`) is an internal operator view; it is
not the visitor-facing experience.

```
Visitor
  ↓
Graph8 identification
  ↓
Company + intent
  ↓
Personalized experience
  ↓
Meeting?
  ├── YES → conversion flow (meeting workflow + AI sales prep)
  └── NO
       ↓
   Recovery opportunity
       ↓
   Contact discovery
       ↓
   Enrichment
       ↓
   Email verification
       ↓
   Graph8 Sequencer
       ↓
   Reply / Meeting
```

## Architecture

```
visitor -> Graph8 signals -> Express backend -> classification
  -> Graph8 landing pages (create + publish, cached per domain+variant)
  -> personalized experience -> Graph8 Calendar booking
  -> webhook (ngrok) -> Express -> enrichment -> AI sales prep
  -> recovery pipeline (no meeting): discovery -> enrich -> verify
  -> Graph8 Sequencer (owns timing) -> inbox replies
  -> dashboard (React) reads /api/state + /api/events + /api/recovery
```

- `backend/` — Node + Express. Never exposes `G8_API_KEY` / webhook secret.
  Graph8 calls isolated in `services/graph8/`; business logic in
  `services/recovery/`, `services/visitor-workflow.js`,
  `services/meeting-workflow.js`, `services/engagement-workflow.js`.
- `frontend/` — React + Vite dashboard (preserved design, extended with
  Recovery + Sequence & replies panels, wired to real data).
- Graph8 access via `@graph8/sdk` v0.245.0 (typed clients + verified
  `g8.api.call(...)` operation IDs, never invented; SDK wins over docs
  on any disagreement).

## Local setup

```bash
cd backend && cp .env.example .env   # fill in keys (see table below)
npm install
node server.js                        # :3000

cd frontend && npm install
cp .env.example .env.local            # default BACKEND_PROXY_TARGET already points at :3000
npm run dev                           # :5173, proxies /health + /api -> backend
```

## Live demo script (judges, ~5 minutes)

Narrative: *"Signal Desk turns anonymous B2B website traffic into an automated
revenue workflow — identify → understand → personalize → convert → recover."*

1. **Connected.** Open the dashboard (`:5173`), point at the top bar:
   Backend Connected + Graph8 Connected (`GET /api/graph8/status`).
2. **Identify.** Send (or await) a `visitor.identified` webhook — or demo-fast:
   open `/api/resolve-visitor?domain=<customer-domain>` (live `enrich.company`).
   Dashboard shows company, traffic type, intent score, variant.
3. **Personalize.** Show the personalized headline/CTA + the reused Graph8
   landing page (`experience.page_url`, `page_mode: reused|generated`).
4. **Convert.** Book via Graph8 Calendar → `meeting.booked` webhook →
   dashboard records the meeting + AI sales prep (real voice script, since
   `GRAPH8_VOICE_AGENT_ID` is set).
5. **Recover (the core story).** High-intent account + engagement + NO meeting →
   recovery opportunity appears (`GET /api/recovery`). Run
   `POST /api/recovery/:domain/process` → contact discovered → enriched →
   email verified → **"Ready for Sequence"** (dry-run: `AUTO_ENROLL=false`,
   nothing is sent — say this to the judges). Booking a meeting cancels
   recovery for the account automatically.
6. **Outbound honesty.** Sequence panel shows `NOT_CONFIGURED` until a real
   sequence id is set — the app displays the gap instead of faking it.

If anything is offline on stage: every panel has an honest empty state, and
`/api/analytics` labels each number `graph8` / `app` / `demo` — nothing is
fabricated, which is itself a talking point.

## API reference (all endpoints)

Health / visitor / dashboard:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Backend liveness badge. |
| `GET` | `/api/resolve-visitor[?domain=]` | Visitor resolution (live enrichment or webhook state; `?domain=` demo override). |
| `GET` | `/api/graph8/status` | Graph8 credential check (read-only `contacts.list`, no billable calls). |
| `GET` | `/api/events[?limit=]` | Persisted event feed for the timeline. |
| `GET` | `/api/state` | Dashboard snapshot: visitor, meeting, coaching, voice, recovery summary. |

Recovery / outbound:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/recovery` | Opportunities + counts + sequence/list status. |
| `GET` | `/api/recovery/:domain` | Single opportunity with contact, verification, timeline. |
| `POST` | `/api/recovery/:domain/process` | Run discovery → enrich → verify → list → sequence pipeline (dry-run safe). |
| `POST` | `/api/recovery/:domain/enroll` | Explicit enrollment (same safety gates + meeting re-check). |
| `GET` | `/api/sequences/status` | Honest mode: `LIVE` / `DRY_RUN` / `NOT_CONFIGURED`. |
| `GET` | `/api/inbox/status` | Reply visibility (review-only, never auto-sent). |
| `GET` | `/api/analytics` | App metrics + Graph8 `intent.stats`, each labelled by source. |
| `GET` | `/api/automation/status` | Workflow + skills + sequence integration status. |

Webhooks (all HMAC-verified, see below):

| Method | Path | Events |
|---|---|---|
| `POST` | `/webhooks/graph8/signals/visitor` | `visitor.identified`, `intent.signal` |
| `POST` | `/webhooks/graph8/appointments/booked` | `meeting.booked`, `meeting.cancelled`, `meeting.rescheduled` (+ engagement fallback) |
| `POST` | `/webhooks/graph8/engagement` | `engagement.email_replied` et al, `sequence.contact_enrolled`, `form.submitted` |

## Environment variables

Full template with where-to-find-each-value: `backend/.env.example`
(copy it to `backend/.env`, which is gitignored). Summary:

| Variable | Required? | What it does |
|---|---|---|
| `G8_API_KEY` | Yes | Graph8 API key (Settings → MCP & API). Server-only. |
| `GRAPH8_WEBHOOK_SECRET` | Yes for webhooks | Signing secret for `X-G8-Signature` verification. **All webhooks 401 while empty/mismatched.** |
| `GRAPH8_RECOVERY_LIST_ID` | Recommended | Recovery segmentation list (this workspace: `3` = "Recovery List"). Falls back to title lookup. |
| `GRAPH8_VOICE_AGENT_ID` | Recommended | Real AI sales-prep scripts. Unset = labelled simulation. |
| `GRAPH8_TARGET_ACCOUNTS` | Recommended (demo) | Comma-separated demo domains for `target_account` personalization. |
| `GRAPH8_RECOVERY_SEQUENCE_ID` | For live outreach | Sequence id from Graph8 UI. Empty = "Sequence not configured" (still demo-able). |
| `GRAPH8_RECOVERY_AUTO_ENROLL` | Safety | Keep `false` (preview only). `true` + sequence id = real enrollment. |
| `GRAPH8_PAGE_TEMPLATE` / `GRAPH8_INTENT_THRESHOLD` / `GRAPH8_BASE_URL` | Optional | Defaults: `lead_magnet` / `60` / Graph8 API base. |
| `GRAPH8_RECOVERY_WORKFLOW_ID` / `GRAPH8_SKILL_*_ID` | Optional | Advanced integrations; core flow doesn't need them. |

Frontend (`frontend/.env.local`, gitignored): `BACKEND_PROXY_TARGET=http://127.0.0.1:3000`,
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
`{PUBLIC}/webhooks/graph8/signals/visitor`, `meeting.booked`
(+`meeting.cancelled`/`meeting.rescheduled`) to
`{PUBLIC}/webhooks/graph8/appointments/booked`, and reply/sequence/form
events (`engagement.email_replied`, `sequence.contact_enrolled`,
`form.submitted`) to `{PUBLIC}/webhooks/graph8/engagement`. Verification uses
the raw body (`X-G8-Signature`, optional `X-G8-Timestamp`, 300 s tolerance):
missing/invalid/tampered → 401; malformed signed JSON → 400; unknown event → 200 ignored.

## Ngrok setup

```bash
ngrok http 3000
# use the https URL as {PUBLIC} above; keep Express running locally
```

## Pre-demo checklist (night before)

- [ ] `GET /api/graph8/status` → `{connected:true}` (key valid, credits available).
- [ ] Webhook subscriptions exist in Graph8 and point at the current `{PUBLIC}` URL.
- [ ] One test delivery per webhook type → all 200s, dashboard rows appear.
- [ ] `GRAPH8_TARGET_ACCOUNTS` contains 2–3 real demo domains.
- [ ] Voice mode decided: real agent id set (current) or unset for the simulation narrative.
- [ ] Sequence decision: id set (live/dry-run) or empty ("not configured" narrative).
- [ ] `GRAPH8_RECOVERY_AUTO_ENROLL=false` confirmed (never live-send on stage).
- [ ] Full suites green: `node tests/backend-test.mjs` (29) + `node tests/recovery-test.mjs` (25).
- [ ] `backend/data/events.json` + `backend/data/recovery.json` cleared → clean dashboard.

## Pushing to GitHub safely

Secrets live only in `backend/.env` and `frontend/.env.local`, both gitignored
(`backend/.gitignore`, root `.gitignore`). Before pushing:

```bash
git status --short          # .env / .env.local must NOT appear
git check-ignore -v backend/.env frontend/.env.local   # both should match an ignore rule
```

What judges/cloners get instead: `backend/.env.example` + `frontend/.env.example`
(placeholders only, zero real credentials). NOTE: root `.gitignore` currently
also ignores `ARCHITECTURE.md` — remove that line if you want the architecture
doc visible on GitHub.

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
node tests/backend-test.mjs    # 29 checks: auth, webhooks, real read-only API, mocked flows
node tests/recovery-test.mjs   # 25 checks: qualification, pipeline, idempotency, safety, endpoints
```

Backend suite covers: health, resolve-visitor (+domain fallback), graph8
status, events/state, 401s, tampered body, malformed JSON, unknown events,
missing intent, low/high intent, idempotent redelivery, meeting validation +
cancellation/reschedule, real `contacts.list`, SDK operation existence,
mocked landing-page + coaching flows.

Recovery suite covers: eligible / not eligible (low intent, missing intent,
missing company, meeting booked, no engagement), discovery → enrichment →
verification pipeline, repeated processing (no duplicates), meeting re-check
(cancel/skip), no-contact task fallback, email unavailable/verification
failure, already-enrolled guard, sequence unavailable/API failure, reply +
sequence-enrollment + form webhooks, and the HTTP endpoints below. All
Graph8 calls are mocked; tests never enroll real contacts, send emails/SMS,
or execute live workflows.

## Recovery flow (inbound → outbound)

Eligible when: high-intent (`high_intent`/`target_account`) company +
meaningful engagement (personalization served) + NO meeting booked.

```
identified → recovery candidate → contact found → enriched → verified →
ready for outreach → enrolled
```

1. `POST /webhooks/graph8/signals/visitor` (high intent) creates the
   opportunity (`recovery_created` event).
2. `POST /api/recovery/:domain/process` runs the pipeline:
   `companies.contacts` → `enrich.search`/`search.contacts` (discovery) →
   `enrich.person` only when fields are missing (1 credit saved otherwise) →
   `enrich.verifyEmail` gate → `lists` segmentation (list id wins when
   configured — this workspace: id `3` "Recovery List"; otherwise the title
   is found-or-created once) → re-check meeting → Sequencer.
3. `meeting.booked` cancels recovery for the account; `meeting.cancelled`
   re-opens it.
4. Idempotency: persistent `backend/data/recovery.json` + Graph8
   `idempotencyKey` on `sequences.add` → a contact is never enrolled twice;
   repeated webhooks return `duplicate`.

## Sequencer configuration & dry-run mode

```env
GRAPH8_RECOVERY_SEQUENCE_ID=
GRAPH8_RECOVERY_AUTO_ENROLL=false
```

- Sequence missing → recovery still displayed, status `ready_no_sequence`
  ("Sequence not configured").
- `AUTO_ENROLL=false` (default) → `ready_for_sequence` ("Ready for Sequence",
  would enroll into "Inbound Recovery"). Nothing is sent.
- `AUTO_ENROLL=true` + sequence id → real `g8.sequences.add` with
  idempotency key. Only enable deliberately; never in tests.

Use an existing configured sequence; the backend never assumes Day 0/3/5/7
channels exist in the workspace. `GET /api/sequences/status` shows the honest
mode (`LIVE` / `DRY_RUN` / `NOT_CONFIGURED`).

## Graph8 capabilities used

(All verified against the installed `@graph8/sdk@0.245.0`; no invented APIs.)

- Visitor: `visitor.identified` / `intent.signal` webhooks, `contacts.get`,
  `signals.company`, `enrich.company` (lookup-first: `companies.list` →
  `enrich.company` only when fields missing).
- Company: `companies.list`/`get`/`contacts`, `enrich.company`.
- Personalization: `create_landing_page…` + `publish_landing_page…`
  (cached per template+domain+variant; deterministic app-side copy).
- Meetings: `meeting.booked`/`cancelled`/`rescheduled` webhooks; booking
  stops recovery, cancellation re-opens it.
- Recovery: `enrich.search` / `search.contacts` (discovery),
  `enrich.person` (conditional), `enrich.verifyEmail` (gate),
  `lists` (segmentation), `sequences.get`/`preview`/`add` with idempotency
  (Sequencer owns timing), `tasks` fallback (no silent failures),
  `inbox.list`/`draft` (reply visibility, review-only).
- Voice: `generate_call_script…` when `GRAPH8_VOICE_AGENT_ID` is set.
- Analytics: `intent.stats` (Graph8) alongside labelled app metrics.

## Graph8 capabilities intentionally NOT used

- Forms (`g8.forms` is a write-key browser helper; no server equivalent fits
  the existing UI — not forced in).
- Deals/pipelines, campaigns, custom fields, voice dialing: investigated,
  left out to keep the core flow reliable for the hackathon.
- Workflows & Skills: wired as **optional** integrations
  (`GRAPH8_RECOVERY_WORKFLOW_ID`, `GRAPH8_SKILL_*_ID`; validate-before-execute,
  never executed in tests). The core recovery flow does not depend on them.

## Dashboard lifecycle

```
INBOUND: visitors identified, high-intent accounts, personalized sessions, meetings booked
RECOVERY: opportunities, contacts found, enriched, emails verified, ready for outreach, enrolled
OUTBOUND: sequence status, replies, meetings, tasks
```

Per account: company, domain, intent, last activity, personalization,
meeting status, recovery (eligible? contact? verification? sequence?
enrollment?), timeline.

## Demo procedure

See [Live demo script](#live-demo-script-judges-5-minutes) above — the
condensed judge-facing version. Operator notes:

- Fallback: unknown visitor → generic page, no crash; no contact →
  Graph8 task, never silent.
- After any demo run, clear `backend/data/events.json` +
  `backend/data/recovery.json` to reset the dashboard.

## Which parts are real vs mocked

- `LIVE`: any path backed by a verified `g8.*` call with credentials
  (contacts, enrichment, sequences, lists, tasks, inbox, landing pages, voice).
- `SIMULATED`: voice prep without agent id; clearly labelled in UI/events.
- `MOCKED`: test-only stubs inside `tests/` (never touch the real API).
- `NOT_CONFIGURED`: sequence/workflow/skills/list paths without their env
  ids — displayed honestly, never faked.
- Metrics are labelled `graph8` / `app` / `demo` (`GET /api/analytics`).
  Nothing is fabricated.

## Simulated when credentials are unavailable

- Voice script without `GRAPH8_VOICE_AGENT_ID` → `simulated` prep (labelled in UI).
- Landing-page generation without API key → skipped, generic experience.
- Company signals without `intent:read` scope → enrichment-only, no crash.
