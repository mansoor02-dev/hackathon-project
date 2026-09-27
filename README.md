# Signal Desk — anonymous B2B traffic → personalized buying experiences → sales opportunities

## Problem

Most B2B website visitors never fill a form. Their company, intent, and
interest are visible to tools like Graph8, but that signal dies on the
dashboard — the website shows everyone the same generic page, and sales never
hears about the accounts that were ready to talk.

## Target audience

B2B revenue teams (founders, SDRs, growth marketers) running on Graph8 who
want inbound traffic to convert higher — and high-intent non-converters to
become outbound pipeline automatically.

## Value proposition

Signal Desk turns anonymous B2B website traffic into an automated revenue
workflow: **identify → understand → personalize → convert → recover**.
Every step is backed by a real Graph8 capability, and every dashboard state
honestly says whether it is live, simulated, or not configured.

Preparing to present or defend the project? See [Interview Prep](INTERVIEW_PREP.md).

```
Visitor
  ↓
Graph8 identification (company + intent + signals)
  ↓
Traffic qualification → Personalized landing experience
  ↓
Meeting?
  ├── YES → conversion flow (meeting workflow + AI sales prep)
  └── NO → recovery opportunity → contact → enrich → verify email
            → Graph8 Sequencer (Day 0 / Day 3 / Day 7, stops on reply)
            → Reply / Meeting
```

## Architecture

```
visitor -> Graph8 signals -> Express backend -> classification
  -> Graph8 landing pages (create + publish + preview link, cached per domain+variant)
  -> personalized experience (default | saas | enterprise + reason)
  -> Graph8 Calendar booking -> webhook -> enrichment -> AI sales prep
  -> recovery pipeline (no meeting): discovery -> enrich -> verify
  -> Graph8 Sequencer draft (owns timing) -> inbox replies
  -> dashboard (React) reads /api/state + /api/events + /api/recovery
```

- `backend/` — Node + Express. Secrets stay server-side. Graph8 calls isolated
  in `services/graph8/`; business logic in `services/recovery/`,
  `services/visitor-workflow.js`, `services/meeting-workflow.js`,
  `services/engagement-workflow.js`.
- `frontend/` — React + Vite operator dashboard (visitor, personalization with
  variant + reason + signals, meeting, AI coach, recovery, sequence & replies,
  activity timeline).
- Graph8 access via `@graph8/sdk` v0.245.0 (typed clients + verified
  `g8.api.call(...)` operation IDs from the installed contract; the Swagger UI
  at `https://be.graph8.com/api/v1/docs` carries no machine-readable content,
  so the SDK contract is the source of truth — nothing invented).

## Deployment status

- `frontend/` is deployed to Vercel. The project root is `frontend/`, and
  `VITE_API_BASE_URL` points the browser app at the backend.
- The backend is a separate Node/Express process. During the demo it can be
  exposed with ngrok; this is a temporary tunnel, not durable production
  hosting. Keep both the backend and tunnel running, and update Graph8's
  webhook URLs whenever the free ngrok URL changes.
- Event and recovery state currently uses local JSON files. A durable
  production deployment needs persistent backend hosting and durable storage;
  a Vercel frontend deployment alone does not host the backend or preserve its
  local files.

## Graph8 features used

| Area | Graph8 capability | How |
|---|---|---|
| Visitor intel | `visitor.identified` / `intent.signal` webhooks, `contacts.get`, `signals.company`, `companies.list`/`get`/`contacts` | Identification + intent, lookup-first enrichment |
| Company | `enrich.company` (1 credit, only when lookup misses fields) | Industry, size, tech context for personalization |
| Landing pages | `create_landing_page…`, `publish_landing_page…`, preview-link GET, cached per template+domain+variant | Personalized page per variant; graceful fallback |
| Meetings | `meeting.booked`/`cancelled`/`rescheduled` webhooks | Booking cancels recovery; cancellation re-opens it |
| Recovery | `enrich.search` (discovery), `enrich.person` (conditional), `enrich.verifyEmail` (gate), `lists`, `tasks` fallback, `inbox.list`/`draft` (review-only) | No silent failures; replies visible, never auto-sent |
| Sequencer | `sequences.create` (draft), `sequences.get`/`preview`/`contacts`, `sequences.add` with idempotency key | Draft provisioned via API; enrollment only when explicitly enabled |
| Voice | `generate_call_script…` | Real prep script when agent id is set |
| Analytics | `intent.stats` | Graph8 metric alongside labelled app metrics |

Intentionally NOT used: browser-only `forms`/`calendar`/`visitors` widgets
(server has no equivalent), deals/pipelines, campaigns launch (never launched),
custom fields, voice dialing — investigated, cut to keep the demo reliable.
Workflows/Skills are wired as optional (`GRAPH8_RECOVERY_WORKFLOW_ID`,
`GRAPH8_SKILL_*_ID`; validate-before-execute, never in tests).

## Personalization flow (primary feature)

Small, demo-obvious variant set — families `default` | `saas` | `enterprise`:

- Live webhook traffic: `enterprise` for high intent (score ≥ 60) or a
  configured target account; `saas` for medium intent (score 40–59) at a
  technology company; otherwise `default`.
- Explicit domain previews in `/experience`: Graph8 resolves the company and
  returns its real intent score. If intent is low or unavailable, the page
  shows company-tailored demo copy labeled **Demo personalized** and
  **Preview — no live intent claimed**. This preview does not create a Graph8
  landing page. Medium/high-intent results use the regular personalization
  rules.
- A target account can be configured as a domain or email in
  `GRAPH8_TARGET_ACCOUNTS`; email entries are normalized to their domain.

Every decision carries a human-readable `reason`. The Experience page shows
the source, resolved company, intent score, selected family, and why the copy
was selected. Domain previews do not create Dashboard traffic: the Dashboard
records events received by the backend, primarily through signed Graph8
webhooks.

1. `GET /api/resolve-visitor[?domain=]` — explicit domain (demo override, live
   `enrich.company` + best-effort `signals.company`) or latest webhook state.
2. `classifyTraffic()` → `unknown|low_intent|medium_intent|high_intent|target_account`
   (`target_account` only on explicit `GRAPH8_TARGET_ACCOUNTS` match).
3. `buildPersonalization()` → deterministic copy + `family` + `reason`.
4. Eligible live personalization can create and publish a Graph8 landing page
  through verified operations, cached by template+domain+variant. Failures
  fall back safely; low/unknown-intent domain previews use local demo copy and
  do not create a Graph8 page.

## Recovery flow (secondary feature)

Eligible when: high-intent company + meaningful engagement + NO meeting booked.

```
identified → recovery candidate → contact found → enriched → verified →
ready for outreach → enrolled
```

1. High-intent webhook with no meeting creates the opportunity.
2. `POST /api/recovery/:domain/process`: `companies.contacts` →
   `enrich.search` → conditional `enrich.person` → `enrich.verifyEmail` gate →
   list segmentation (id `3` "Recovery List") → meeting re-check → Sequencer.
3. Draft sequence "Signal Desk — Inbound Recovery" (Day 0 / Day 3 / Day 7
   emails, `finish_on_reply`, same-thread) was created via the API and is the
   outbound execution layer. With `AUTO_ENROLL=false` contacts show
   **"Ready for Sequence"** — nothing is sent.
4. `meeting.booked` cancels recovery; `meeting.cancelled` re-opens it.
5. No contact → Graph8 task fallback; open-data-only contact (no CRM id) →
   honest "create CRM contact first" instead of a fake enrollment. Repeated
   webhooks return `duplicate`; a contact is never enrolled twice.

## Setup

Run these in two terminals from the repository root.

**Terminal 1 — backend**
```bash
cd backend
cp .env.example .env                 # fill in keys (table below)
npm install
node server.js                        # :3000
```

**Terminal 2 — frontend**
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev                           # :5173, proxies /health + /api -> backend
```

Graph8 setup: API key (Settings → MCP & API) → `G8_API_KEY`; signing secret →
`GRAPH8_WEBHOOK_SECRET`; voice agent id → `GRAPH8_VOICE_AGENT_ID`; recovery
list id → `GRAPH8_RECOVERY_LIST_ID`. Verify: `GET /api/graph8/status` →
`{connected:true}` (read-only `contacts.list`, no billable calls).

## Ngrok setup (step by step)

Graph8 sends webhooks over the public internet, so your local `:3000` needs a
public URL. That's what ngrok is for.

**Step 1 — backend running first.**
```bash
cd backend && node server.js      # keep this terminal open (:3000)
```

**Step 2 — install + authenticate ngrok** (once per machine).
```bash
ngrok config add-authtoken PASTE_YOUR_NGROK_TOKEN_HERE   # from https://dashboard.ngrok.com
```

**Step 3 — expose the backend** (second terminal).
```bash
ngrok http 3000
```
Copy the `https://…ngrok-free.app` URL from the ngrok output — call it
`{PUBLIC}` below. Keep this terminal open; killing ngrok kills deliveries.

**Step 4 — subscribe in Graph8.** Use the same signing secret as
`GRAPH8_WEBHOOK_SECRET`. You can use one subscription for all event types or
the separate event-specific subscriptions:

| Events | URL |
|---|---|
| All supported events (single Graph8 webhook) | `{PUBLIC}/webhooks` |
| `visitor.identified`, `intent.signal` | `{PUBLIC}/webhooks/graph8/signals/visitor` |
| `meeting.booked`, `meeting.cancelled`, `meeting.rescheduled` | `{PUBLIC}/webhooks/graph8/appointments/booked` |
| `engagement.email_replied`, `sequence.contact_enrolled`, `form.submitted` | `{PUBLIC}/webhooks/graph8/engagement` |

The generic `POST {PUBLIC}/webhooks` route verifies the signature and dispatches
visitor, meeting, and engagement events by event type. Event-specific routes
are also supported. **Step 5 — ngrok restarts change the URL.** Free ngrok URLs
change on every restart. After any restart, update the Graph8 subscription URL
to the new `{PUBLIC}`. (A reserved ngrok domain avoids this.)

## Live check (step by step)

Run these in order. Everything must be green before the demo.

**1. Backend is up.**
```bash
curl http://127.0.0.1:3000/health
# → {"ok":true,"service":"graph8-ghost-ops"}
```

**2. Graph8 credentials work.**
```bash
curl http://127.0.0.1:3000/api/graph8/status
# → {"connected":true,"provider":"graph8"}
# NOT connected → G8_API_KEY missing/invalid. Nothing downstream works.
```

**3. Visitor resolution is live (spends ~1 enrichment credit).**
```bash
curl "http://127.0.0.1:3000/api/resolve-visitor?domain=graph8.com"
# → personalized:true, company{...}, intent{...},
#   experience{variant, family, reason, signals[...], page_url,...}
```

**4. Recovery + sequence state is honest.**
```bash
curl http://127.0.0.1:3000/api/recovery
# → {"opportunities":[...],"counts":{...},"sequence":{...},"list":{...}}
curl http://127.0.0.1:3000/api/sequences/status
# → {"mode":"DRY_RUN","sequenceId":"...","details":{...},"preview":{...}}
# mode DRY_RUN = draft configured, nothing will be sent. NOT_CONFIGURED = no id set.
```

**5. Webhooks arrive (send a test delivery from Graph8).**
```bash
curl "http://127.0.0.1:3000/api/events?limit=5"
# → fresh rows: visitor_identified / meeting_booked / reply_received / ...
```
Each valid, signed Graph8 delivery should return HTTP 200 in Graph8's delivery
history and appear as a `POST` in ngrok Inspector (`http://127.0.0.1:4040`).
An unsigned request returns 401; a wrong host/path returns 404. Dashboard
traffic is created by webhook processing, not by typing a domain in the
Experience preview. The dashboard refreshes backend state periodically.

**6. Full pipeline dry-run (no sending, `AUTO_ENROLL=false`).**
```bash
curl -X POST http://127.0.0.1:3000/api/recovery/<domain>/process \
  -H "Content-Type: application/json" -d '{"company":"<Name>","intentScore":85}'
# → {"status":"ready_for_sequence",...}  (or needs_research with the reason)
```

**Troubleshooting.**

| Symptom | Cause → fix |
|---|---|
| Webhooks return 401 | `GRAPH8_WEBHOOK_SECRET` empty or mismatched → must equal Graph8's secret; restart backend after changing `.env`. |
| Webhooks return 400 | Malformed JSON body → check the sender payload. |
| No deliveries reach you | ngrok restarted (URL changed) or tunnel down → update subscription URLs; check ngrok terminal. |
| `{"connected":false}` | Bad API key or no network → fix `G8_API_KEY`, restart. |
| `NOT_CONFIGURED` sequence | No sequence id → run `POST /api/sequences/provision` (needs `AUTO_PROVISION=true`) or paste an id. |
| Dashboard empty after tests | Normal — tests write events; clear `backend/data/events.json` + `recovery.json` and restart for a clean stage. |

## Environment variables

See `backend/.env.example` (placeholders only — `.env` is gitignored).

| Variable | Required? | Notes |
|---|---|---|
| `G8_API_KEY` | Yes | Server-only. |
| `GRAPH8_WEBHOOK_SECRET` | Yes for webhooks | All webhooks 401 while empty/mismatched. |
| `GRAPH8_RECOVERY_LIST_ID` | Recommended | This workspace: `3`. |
| `GRAPH8_VOICE_AGENT_ID` | Recommended | Unset = labelled simulation. |
| `GRAPH8_TARGET_ACCOUNTS` | Recommended (demo) | Demo domains for `target_account`. |
| `GRAPH8_RECOVERY_SEQUENCE_ID` | Done via API | Draft id; empty = "Sequence not configured". |
| `GRAPH8_RECOVERY_AUTO_ENROLL` | Safety | Keep `false`. `true` + id = real enrollment. |
| `GRAPH8_RECOVERY_AUTO_PROVISION` | Optional | `true` allows draft creation via `POST /api/sequences/provision`. |
| `GRAPH8_SEQUENCE_OWNER_EMAIL` | Optional | Defaults to first active mailbox email. |
| `GRAPH8_PAGE_TEMPLATE` / `GRAPH8_INTENT_THRESHOLD` / `GRAPH8_RECOVERY_WORKFLOW_ID` / `GRAPH8_SKILL_*_ID` | Optional | Defaults work; integrations stay optional. |

## Running locally

```bash
cd backend && node server.js &            # :3000
node tests/backend-test.mjs               # 29 checks
node tests/recovery-test.mjs              # 25 checks
node tests/personalization-test.mjs       # 11 checks
```

## Demo flow

Scenario A — personalization: visitor arrives → Graph8 identifies the company →
Signal Desk classifies intent → variant (+reason) selected → visitor sees
personalized messaging → can book a meeting.

Scenario B — recovery: high-intent visitor doesn't book → opportunity created →
contact found → enriched → verified → "Ready for Sequence" with the draft
Day 0/3/7 sequence shown as the execution layer. (Sending stays off:
`AUTO_ENROLL=false`.)

Scenario C — conversion: another visitor books → `meeting.booked` webhook →
meeting recorded + AI prep → recovery cancelled for that account.

Pre-demo: suites green, then clear `backend/data/events.json` +
`backend/data/recovery.json` for a clean dashboard.

## What is live

Everything backed by a verified `g8.*` call with workspace credentials:
visitor/company identification, intent signals, landing-page create/publish
(0 pages existed before — new pages are created per variant), meeting
lifecycle, recovery discovery/enrichment/verification/list segmentation, the
provisioned draft sequence (id `cf8b65c8-…`, status `drafted`, 3 steps,
`finish_on_reply`, list `3`), inbox visibility, voice scripts, intent stats.

## What is simulated

- Voice prep without an agent id → labelled `simulated` (currently the real
  agent id is set, so this path is dormant).
- Test-only stubs inside `tests/` (never touch the real API).

## What requires Graph8 account configuration

- Sending: mailboxes exist (1 active), but enrollment requires
  `GRAPH8_RECOVERY_AUTO_ENROLL=true` — deliberately off. Flipping it enrolls
  real contacts into the draft sequence (which would then need `run()` —
  never called by this app).
- Contacts found in open data have no CRM id: shown as ready with an honest
  "create CRM contact first" note instead of a fake enrollment.
- Workflows: none exist in the workspace → `NOT_CONFIGURED`. Skills: system
  skills exist but none are wired → `NOT_CONFIGURED`.

## Testing

66 checks: `backend-test.mjs` (29: auth, webhooks, live read-only API, mocked
flows), `recovery-test.mjs` (25: qualification, pipeline, idempotency, safety,
endpoints), `personalization-test.mjs` (12: variant families/reasons, demo
preview copy, Day 0/3/7 cadence, enroll guards, live sequence resolution, live
resolve-visitor).
No test enrolls, sends, runs, or launches anything — the one live-write
(sequence draft) was done once by hand, outside tests.

Pushing safely: secrets live only in `backend/.env` + `frontend/.env.local`
(both gitignored). Check with `git status --short` and
`git check-ignore -v backend/.env frontend/.env.local` before pushing.
