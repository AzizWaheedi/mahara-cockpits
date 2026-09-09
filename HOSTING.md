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

1. **Bridge scripts.** `viktor-side-scripts/` fed the client-success app (`POST /bridge`) and
   the creative app (Convex HTTP API with the deploy key), and drained the media buyer's
   `outbox`. They import the Viktor SDK and cannot run here. Until they are ported (a Convex
   cron or a small scheduled job that reuses `callTool`), those two apps show whatever data
   was last pushed, and queued outbox writes stay queued. `runSync` in the media buyer
   already fetches on its own once the integration variables are set.
2. **`text2im`** (image generation) has no provider outside Viktor and throws if used.
3. The hardcoded GoHighLevel token in `csm_app_bridge.py` was already redacted in the export;
   rotate it on the GHL side.
