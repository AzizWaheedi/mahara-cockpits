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
| `CSM_CALENDAR_IDS`, `CREATIVE_CALENDAR_IDS` | Google Calendar ids (usually the person's email), comma-separated. Each calendar must be shared with the service account, "See all event details" |
| `CSM_WHAPI_TOKEN`, `CREATIVE_WHAPI_TOKEN` | WHAPI channel token for that role's WhatsApp business number (one channel per number, QR-scanned in WHAPI) |
| `WHAPI_BASE_URL` | optional, default `https://gate.whapi.cloud` |
| `GHL_AGENCY_TOKEN` | agency-level GoHighLevel private integration token (pit-…) with scopes `locations.readonly`, `opportunities.readonly`, `contacts.readonly`, `calendars.readonly`, `calendars/events.readonly`; covers every sub-account whose GHL ID is on Client Data, so per-client tokens become optional |
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
