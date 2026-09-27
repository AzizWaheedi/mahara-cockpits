# Cockpit media provider actions

This function is locally implemented and tested. No deployment, secret changes, or live provider writes were performed by this packet.

## Interface

POST with the browser's Supabase bearer token and `{operation,args,apply?,requestId?}`. An omitted `apply` previews only. Options and inspect return their original read contracts. Explicit `apply:true` requires a UUID. The browser adapter retains this UUID across failures and reloads, keyed by verified user and request content; only a confirmed success clears it. Errors throw in the adapter so a caller cannot toast success after a refusal.

The server validates the session using `auth.getUser`, then asks the database for current confirmed membership and a unique campaign mapping. Client/account/task identifiers come from that mapping. Every Meta object is read to verify its account and campaign before a write; Mahara operations require the founder and fixed account `746108264865897`. Membership and mapping are rechecked before each provider write.

Supported operations:

- `control.setStatus`, `ceo.b2bControl.setStatus`
- `edit.setAdSetBudget`, `edit.duplicateAdSet`, `edit.newAdsFromExisting`, `edit.addCreativeToCampaign`
- `board.adStatusOptions`, `board.advertisingCityOptions`, `board.setAdStatus`, `board.setAdvertisingCities`, `board.renameCard`, `board.addToBoard`
- `ceo.b2bManage.inspect`, `.rename`, `.setBudget`, `.setSchedule`, `.setAudience`, `.createAdset`, `.duplicateAdset`, `.createAds`
- `ceo.ltv.apply`, using the authenticated `cockpit_ceo_action('ltv.preview',{})` from migration `20260927h`. The server owns the target amounts; live field values are checked before and after each write, and changes to the preview stop the batch. A missing, empty, changed or ineligible card is never overwritten.

All creations land paused. Ad-copy and asset operations carry the existing destination, page, CTA and lead form through the original pure `metaCreative` helpers. Direct HTTPS image/video URLs upload through Meta; Drive share links require the separate media ingestion worker and its returned asset id.

## Configuration and receipts

Apply `20260927g_cockpit_media_actions.sql` with the cockpit membership/campaign/audit dependencies first. Deploy with JWT verification enabled. Required function secrets are the standard Supabase connection variables plus `META_SYSTEM_TOKEN` and `CLICKUP_API_TOKEN`. Optional `META_GRAPH_VERSION` defaults to `v21.0`, matching the original tools transport. Tokens are never included in a provider receipt.

`cockpit_media_actions` records intent before a write; `cockpit_media_provider_health` appends intent/response/unknown transport receipts, including returned object ids. Provider writes are never retried by the transport. Every created object and change is read back before successful finalization. Multi-step failure stops remaining writes and leaves `reconcile`; even if the browser loses a response, retrying its UUID cannot repeat the write. Inspect health rows and live provider objects before any manual reconciliation. Do not delete a pending receipt to enable retries.

Successful finalization atomically updates supported board cache fields and appends `cockpit_audit_log`. Migration `20260927u` derives durable campaign action messages and the three-day learning window from confirmed receipts. `cockpit_media_live_campaigns()` reads those effects on every refresh; `cockpit_media_campaign_history(p_campaign)` supplies action messages. The React snapshot and chat readers must consume these RPCs. Meta status/budget freshness still depends on the migrated source reader; no optimistic provider success is invented.

## Explicit remaining implementation

- Drive ingestion remains the separate creative worker responsibility.
- Live configuration, authenticated preview, provider read-only checks, one approved live write/read-back, and deployment acceptance.

## Offline verification

`bun test supabase/functions/cockpit-media-api` covers real migration execution in PGlite, membership revocation, client/founder access, private receipts, immutable audit finalization, account/campaign spoof refusal, CBO/lifetime budgets, paused creation, destination preservation, read-back failure, no POST retries, and browser retry IDs.

`deno check --node-modules-dir=none supabase/functions/cockpit-media-api/index.ts` checks the deployed entrypoint without modifying workspace dependency installations.

## Workflow continuation (migration 20260927u)

- `execute.runAction` supports the original executable recommendations: pause, capped budget raise, and cutting the worst spending ad. Raises stay within 25% and above $30; ambiguous budgets, the last live ad, stale values and judgment-only recommendations are refused.
- `cockpit.askForDetail` posts a verified ClickUp comment with an optional list-member assignee and reads the comment back. Campaign task mappings are authoritative; otherwise migration w's verified inbox permits only unrestricted confirmed media seats.
- `edit.askViktorFor` sends to server-configured `ALERT_SLACK_TO` (original default `U09305KE2KS`) using `SLACK_BOT_TOKEN`. Explicit apply is mandatory. Slack read-back requires history permission for the actual DM/channel, in addition to chat:write. An unknown send is never automatically repeated.
- `board.dismissOffBoard` persists audited dismissal. Off-board mappings come only from the verified media source feed, never caller-supplied client claims. The feed reader must filter the stored dismissals.
- `ceo.b2bLaunch.list/build/save/discard/launch` use the existing cockpit_ad_drafts table. Build requests are keyed by durable request UUID, source winners are selected from B2B using the original 90-day demos/leads/spend ranking, and every source Meta object is checked against Mahara's fixed account. Human-approved launches create paused campaign/ad set/ads. Atomic draft claims fence duplicate launches; interrupted launches remain blocked for reconciliation.
- `ceo.b2bManage.copyIdeas` and draft generation share `model.ts` with the creative builder. It preserves `AI_JSON_PROVIDERS` and named provider keys/models from original tools: `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`, `OPENAI_API_KEY`/`OPENAI_MODEL`, `GOOGLE_AI_API_KEY`/`GEMINI_MODEL`, `DEEPSEEK_API_KEY`/`DEEPSEEK_MODEL`. Fixed hosts: api.anthropic.com, api.openai.com, generativelanguage.googleapis.com, api.deepseek.com. No arbitrary model gateway or Convex transport is used.
- B2B ranking reads require `SUPABASE_ACCESS_TOKEN`; requests target only flwboeijllbtrufxkhts with read_only:true. No B2B writes exist.
- `cockpit_media_preferences()` reads [{clientName,language}]; passing p_client and p_language writes ar/en with server scope and audit. These preferences are separate from CSM preferences. Historical clientPrefs must be imported if present in the source archive.

Named secrets and endpoint code are prepared; actual secret presence, Slack permission grants, authenticated deployment and outward acceptance remain live verification work. No credentials or provider systems were accessed during this implementation.
