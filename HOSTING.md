# Hosting the cockpits outside Viktor

Companion to `HANDOFF.md`. That file describes what the apps are; this one describes how
they are hosted now and what was changed to get there. Started 2026-09-09.

## Live deployments (2026-09-09)

| App | Frontend (Vercel) | Convex prod deployment | Convex dev deployment |
|---|---|---|---|
| Media buyer | https://mahara-media-buyer.vercel.app | `adorable-seahorse-418` → https://adorable-seahorse-418.convex.cloud | `wonderful-woodpecker-707` |
| Client success | https://mahara-client-success.vercel.app | `impressive-dinosaur-375` → https://impressive-dinosaur-375.convex.cloud | `successful-gnu-925` |
| Creative director | https://mahara-creative-director.vercel.app | `colorful-wombat-644` → https://colorful-wombat-644.convex.cloud | `diligent-koala-992` |

Convex team `aziz-00129`, projects `mahara-media-buyer`, `mahara-client-success`,
`mahara-creative-director`. Vercel team `aziz-6097s-projects`, same three project names.

Redeploy after a change, from the app folder:

```bash
bunx convex deploy --yes        # backend to prod
bunx vercel deploy --prod --yes # frontend
```

`bunx convex dev` pushes to the dev deployment and is what local `bun run dev` talks to.

## Layout

```
apps/media-buyer-cockpit        Convex deployment + Vercel project, one each
apps/client-success-cockpit     same
apps/creative-director-cockpit  same
viktor-side-scripts/            reference only (Viktor SDK imports), see "Still pending"
context/                        data spine and workflow docs, read before changing behaviour
```

Each app is its own Convex project and its own Vercel project, exactly as on Viktor. They do
not share a database.

## What changed versus the export (and nothing else)

Only the Viktor plumbing named in `HANDOFF.md` section 6. Screens, rules, schema, crons and
every call site are untouched. `git log` shows the import commit followed by the change commit.

| File (same in all three apps) | Change |
|---|---|
| `convex/tools.ts` | `callTool("<tool_name>", args)` no longer proxies to the Viktor gateway. Each tool name is served directly with the deployment's own credentials: ClickUp, Google Sheets (service account JWT), Typeform, Supabase management API, Meta Graph, Slack, Anthropic. `unwrap`, `graph`, `graphPost`, `supabaseQuery`, `allAdAccounts` are as before. |
| `convex/viktorTools.ts` | Dropped its private copy of the gateway `callTool`; imports the one above. |
| `convex/ViktorSpacesEmail.ts` | Verification and reset emails go through Resend instead of the Viktor mail API. |
| `convex/viktorSpaceAuthConfig.ts` | The `verify`/`reset` email steps are only attached when `RESEND_API_KEY` is set. Without it, sign-up completes immediately. |
| `.env.example` | Lists the new variables. |

Added on 2026-09-09 so the media buyer cockpit no longer needs the Viktor-side scripts:

| File (media buyer only) | What it replaces |
|---|---|
| `convex/marketCollect.ts` | `collect_market_plays.py`. Walks every ad account into `marketPlays` (the "What works" page). Weekly cron, Friday 02:00 UTC. Service lines by keyword plus a hand-filled override map; label sheet with Meta-account fallback. |
| `convex/assistWorker.ts` | `assist_worker.py`. Answers the copy / creative / launch requests from the cockpit: Drive → Meta uploads, launch checklist, copy when a model is configured. Woken on enqueue, swept every 10 min. |
| `convex/sync.ts` (runSync) | The bridge's onboarding staging: the sync now reads each open launch task's subtasks and checklist items itself. Task list shows every open task on Marketing / ADs. |
| `convex/builder.ts` | A build no longer fails outright when copy cannot be written. |
| `convex/schema.ts` | Fields the code already wrote but the exported schema lacked (`clients.dwy`, report fields, `checks.block`). |

The Viktor SSO shims (`spaceSessionAuth.ts`, `ViktorAutoSignIn.tsx`, etc.) were left in place.
They are inert without the `VIKTOR_AUTH_*` variables and deleting them is cosmetic.

## Convex deployment env

Set with `bunx convex env set NAME 'value'` from the app folder, or in the Convex dashboard.
Required for the app to boot:

| Variable | Value |
|---|---|
| `VIKTOR_SPACES_ACCESS_MODE` | `authenticated` |
| `VIKTOR_SPACES_AUTH_PROVIDERS` | `["email_password"]` |
| `SITE_URL` | the app's Vercel URL |
| `JWT_PRIVATE_KEY`, `JWKS` | Convex Auth signing keys (RS256; generate with `bunx @convex-dev/auth` or the jose snippet in git history) |

Integrations (the app boots without them; the sync and writes fail until they are set):

| Variable | Used by |
|---|---|
| `CLICKUP_API_TOKEN` | all ClickUp reads and writes |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Sheets. Share `DATABASE - MAHARA`, `Master Dashboard - Mahara`, the EOD sheet and the per-client report sheets with the service account email |
| `TYPEFORM_TOKEN` | EOD and call-notes forms |
| `SUPABASE_ACCESS_TOKEN` | Creative Triage project `bldgtotkfmhoxmlzowdx`, read-only SQL |
| `SLACK_BOT_TOKEN` | EOD posts to `C0AQ2LD0PL1`, feedback DMs (`chat:write`) |
| `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`) | ad copy variants, quick AI search. Default model `claude-opus-5` |
| `META_SYSTEM_TOKEN` | Meta Marketing API, same token as before |
| `RESEND_API_KEY`, `AUTH_EMAIL_FROM` | sign-up verification and password reset. Optional |

Meetings and messages (both other cockpits, fed by the media buyer backend every 15 min):

| Variable | Used by |
|---|---|
| `MAHARA_GHL_TOKEN` | private integration token of Mahara's own GHL sub-account (`MAHARA_GHL_LOCATION`, default `wwG426bwruWWv9W3fazQ`). Its calendars and its WhatsApp conversations since `WHATSAPP_SINCE` (default 2026-09-10, the day Aziz's number was connected) feed the Meetings & messages page of both cockpits; the rows below are then optional |
| `CSM_CALENDAR_IDS`, `CREATIVE_CALENDAR_IDS` | Google Calendar ids (usually the person's email), comma-separated. Each calendar must be shared with the service account, "See all event details" |
| `CSM_WHAPI_TOKEN`, `CREATIVE_WHAPI_TOKEN` | WHAPI channel token for that role's WhatsApp business number (one channel per number, QR-scanned in WHAPI) |
| `WHAPI_BASE_URL` | optional, default `https://gate.whapi.cloud` |
| `GHL_AGENCY_TOKEN` | not used: agency-level tokens cannot read sub-account pipelines or calendars (tested 2026-09-10). Each Client Data row carries its own sub-account token |
| (Hermes, via `ASKAI_TOKEN` and `/askai/*`) | writes the "what this means" paragraph of client report docs as an `aiJobs` row of kind `report_narrative`; if he has not answered in 45 minutes the doc ships with the plain diagnosis |
| (GCP project 195153154932) | Google Docs API must be enabled for report docs; Drive and Sheets already are |
| `FATHOM_API_KEY` | recorded calls on the client cards. Without it, calls loaded into the `fathomCache` table (one-off backfills from the Fathom connector) still show for 90 days |

Only the media buyer cockpit talks to integrations today. The other two receive data through
the bridge (below) and only need the boot variables.

## Vercel (frontend)

One project per app, root directory `apps/<app>`, framework Vite, build `bun run build`,
output `dist`. Build-time env:

| Variable | Value |
|---|---|
| `VITE_CONVEX_URL` | the Convex deployment URL (`https://….convex.cloud`) |
| `VITE_VIKTOR_SPACES_ACCESS_MODE` | `authenticated` |
| `VITE_VIKTOR_SPACES_AUTH_PROVIDERS` | `["email_password"]` |

`vercel.json` already rewrites everything to `index.html`.

## Who can sign in

`convex/roles.ts` is the allowlist. Anyone can create an account, but only these emails get a
cockpit: aziz@ and awaheedi2008@ (both), nada@ (media buyer), abdulelah@ and abdu@ (CSM).
Edit that file to add people.

Sessions last a year and lapse after 90 days without a visit (`convex/auth.ts`).

Forgotten password: "Forgot password" emails a 6-digit code through Resend when
`RESEND_API_KEY` and `AUTH_EMAIL_FROM` (an address on notify.maharamedia.com) are set on
each deployment. Without them, reset it from the CLI and tell the person to change it under
Settings:

```bash
cd apps/media-buyer-cockpit && bunx convex run --prod adminAuth:setPassword '{"email":"nada@maharamedia.com","password":"<temporary>"}'
```

## Local development

```bash
cd apps/media-buyer-cockpit
bun install
bunx convex dev        # first run: pick the Convex project, writes .env.local and convex/_generated
bun run dev            # http://localhost:5173
```

`.env.local` needs `VITE_VIKTOR_SPACES_ACCESS_MODE=authenticated` and
`VITE_VIKTOR_SPACES_AUTH_PROVIDERS='["email_password"]'` next to the `VITE_CONVEX_URL` that
`convex dev` writes.

## Still pending

0. **Ask AI.** No model runs on the deployments. Copy for builds and for the launch
   assistant is queued in `aiJobs` and served through `GET /askai/pending` /
   `POST /askai/result` on the media buyer's `.convex.site` URL (bearer `ASKAI_TOKEN`).
   Client success questions come through its `/bridge` door (`pendingAsks` /
   `answerAsk`, bearer `BRIDGE_TOKEN`, now an env var). Aziz's Hermes agent polls both
   every 5 minutes; its skill and cron are in `hermes/cockpit-ask-ai/`. Setting
   `ANTHROPIC_API_KEY` on the media buyer deployment switches those steps back to
   in-app, instant answers. The Edit panel's "write variants" button still needs the
   key; it is the one synchronous call left.
1. **Bridge scripts: ported.** `apps/media-buyer-cockpit/convex/fanout.ts` now feeds the
   creative director's cockpit (roster, boards, funnels, ad performance, plays, winners
   through its new `/bridge` door) and the client success cockpit (snapshot + Client Data
   overlay through its `/bridge`) every 30 minutes and after the morning sync. Media buyer
   env: `CREATIVE_BRIDGE_URL/TOKEN`, `CSM_BRIDGE_URL/TOKEN`. Not yet ported: GHL calendar
   bookings, churn KPIs and the client profile builder for client success (those screens
   fall back to ClickUp fields), Drive subfolder scan and Brand Blueprint forms for creative,
   and the outbox drains (writes queued in the two apps still need a runner).
1b. **Old note, kept for history: Bridge scripts.** `viktor-side-scripts/` fed the client-success app (`POST /bridge`) and
   the creative app (Convex HTTP API with the deploy key), and drained the media buyer's
   `outbox`. They import the Viktor SDK and cannot run here. Until they are ported (a Convex
   cron or a small scheduled job that reuses `callTool`), those two apps show whatever data
   was last pushed, and queued outbox writes stay queued. `runSync` in the media buyer
   already fetches on its own once the integration variables are set.
2. **`text2im`** (image generation) has no provider outside Viktor and throws if used.
3. The hardcoded GoHighLevel token in `csm_app_bridge.py` was already redacted in the export;
   rotate it on the GHL side.


## Hermes acting on the ad accounts

`POST /askai/meta` on the media buyer deployment (same bearer token as the
other `/askai` routes) runs any Meta Graph call with the cockpit's own
system-user token: `{ method, path, params, jobId?, note?, campaignName? }`.
`GET /askai/accounts` lists the accounts with status. Every call is logged in
`agentActions`, tied to the chat job it came from, and listed under Hermes's
reply as "Actions taken". The chat prompt on the media buyer cockpit carries
the recipes the buttons use (pause, budget, new campaign and ad set with the
flags Meta requires, copy an ad set, new ad). Rules in the prompt: create
paused, +25% budget steps unless a figure is named, say what changed.

## Letting Hermes fix things

Every flagged error becomes a job for Hermes as well as a Slack DM: a screen
that throws in the smoke checks, a "Report an issue" from the client success
cockpit, a note from the media buyer's feedback box. The job carries the app,
the screen, the error, the repository address and the deploy commands, and
Hermes's verdict (fixed / needs a human / not a code bug) is sent to Aziz on
Slack. `fixRequests.ts` on the media buyer deployment.

For him to actually change code, three things have to be on his side:

1. The repository: https://github.com/AzizWaheedi/mahara-cockpits (private).
   `REPO_URL` on the media buyer deployment points at it; Hermes needs a token
   with Contents read/write on it.
2. A Convex deploy key per app (Convex dashboard → Settings → Deploy keys):
   `adorable-seahorse-418`, `impressive-dinosaur-375`, `colorful-wombat-644`.
3. A Vercel token for the three projects, or he opens a pull request and the
   push deploys.

Until then he reads the job and answers "needs a human" with what he found.


## Personal Google Calendars (all three cockpits)

Each person can connect their own Google Calendar from the Meetings page
(client success, creative) or the start-of-day view (media buyer): share the
calendar with the service account `claude@studied-handler-508106-m5.iam.gserviceaccount.com`
("See all event details"), then type the Google account email into the
cockpit. The media buyer backend reads it within a minute
(`personalCalendars.checkPending`, from the outbox drain) and every 10 minutes
with the comms feed. Events are tagged `client` (matched a client name),
`team` (only Mahara people, or a team-sounding title) or `other`, and each
person sees only their own calendar plus the shared client calendars.

One-time setup: the Google Calendar API must be enabled on the service
account's Google Cloud project (project 195153154932, APIs & Services,
Google Calendar API, Enable). Until then every link shows a note saying so.

## Recommended replies

Every WhatsApp or SMS thread waiting on us gets a reply drafted by Hermes
from the Client Communication SOP (Google Doc
`10wQorQfSebiX3Lmh0jXkEUkp3I_xMP68p4b1q-oUxcY`, cached 24 h in `docCache`).
The draft lands on the thread in both cockpits (`replyDrafts`), the person
edits it if they want and presses "Send on WhatsApp"; the outbox row is
drained within a minute and sent through the CRM
(`POST /conversations/messages`, type WhatsApp or SMS to match the thread).


## The portal (one sign-in, one domain)

`https://mahara-media-buyer.vercel.app` is the portal. Everyone signs in there
with one email and password; the portal routes them to their cockpit:

- media buyer pages live on the portal itself (`/dashboard`, `/ads`, ...)
- client success is proxied at `/client-success/` (Vercel rewrite to the
  mahara-client-success project, built with vite `base: "/client-success/"`)
- creative director is proxied at `/creative/`
- admins land on `/admin`: team members, seats (admin, media buyer, client
  success, creative), per-member client access, cockpit health, alerts, Hermes

How the door works (no shared secret): `portal.mintToken` signs a two-minute
RS256 pass with the deployment's own auth key; `/go/csm` and `/go/creative`
send the person to `/client-success/dashboard?portal_token=...`; the other
cockpit's `portalAuth.ts` verifies it against
`https://adorable-seahorse-418.convex.site/.well-known/jwks.json`, links the
account by verified email, and stores the roles and client access in its
`portalMembers` table. A sessionless visit to a cockpit bounces to the portal
once a minute at most (`PortalAutoSignIn.tsx`).

Who may open what: the `members` table on the media buyer deployment, edited
in `/admin`. `convex/roles.ts` keeps a static fallback for the first five
people. Client access (empty = all) is applied in the main list queries of
every cockpit (`allowedClients`).

Custom domain: add e.g. `portal.maharamedia.com` to the mahara-media-buyer
Vercel project and set `VITE_PORTAL_URL` on the two child projects (or leave
it: proxied visits use the current origin).

CLI helpers: `portal:seed` (first five members), `portal:mintFor` (a pass for
someone, for tests), `adminAuth:setPassword` (reset a password).
