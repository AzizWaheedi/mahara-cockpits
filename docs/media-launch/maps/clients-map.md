# Launch desk client map

The client-specific snapshot is held privately. This public file keeps the generic mechanics observed on 24 October 2026. Recheck current code and live read models before relying on these historical observations. Earlier Git revisions may still contain client records.

## A correction to the brief

The per-client ads cards (one per campaign, joined to the client by tag) are on **Ads Managment** in the Mahara Client Database space, not on Marketing / ADs. **Marketing / ADs** holds the "{card} - New Client Campaign Launch 🚀" tasks, the "Payment Failure" tasks and team tasks.

## The rule that decides who the Ads section shows

1. The native worker publishes a campaign to `cockpit_campaigns` only if it spent **at least $0.50 in the 7-day window**. The rule is `if (a.spend < 0.5) continue;` in `hermes/cockpit-sync/calculator.ts:2614`. The window comes from `sevenDayWindow` at `:157` and ends on the sheet's last spend day, about yesterday. A campaign that drops out is set `source_deleted` on the next publish.
2. The Ads section reads `cockpit_media_live_campaigns()`, which returns `cockpit_campaigns WHERE NOT source_deleted`, filtered by the seat's client access. The live definition matches migration 20260927u. The page reads it through `apps/media-buyer-cockpit/src/lib/mediaSourceClient.ts` `readMediaSnapshot`.
3. The "Running" and "Off the board" tabs, and the account page `/ads?account=`, only split or filter those same rows (`CockpitPage.tsx`: `isParked` at :1543, the tabs at about :3346, `AccountView` at :3875). The board's Ad Status ("Paused", "Dead Campaign") never adds a row. So a client is in Ads only while one of its campaigns has spent in the last 7 days. A paused or unsettled client drops out a week after its last spend, along with its account page.
4. Build and launch for a client go through `cockpit_build_scope(tag)`. It needs **exactly one ad account among that client's current `cockpit_campaigns` rows** (the live definition matches 20260927r). Otherwise it refuses with "The client ad account is missing or ambiguous". So no client outside the Ads list can have a campaign built, and a client with two current accounts cannot either.
5. The "launching" rule: a client is launching only while an **open top-level "New Client Campaign Launch" task** exists. The worker reads Marketing / ADs and Ads Managment with `subtasks=false` (calculator.ts :2388 and :2980). It feeds the "New client launches" panel (`Onboardings.tsx`), which sits on **Today only** (CockpitPage.tsx :3833), never in Ads.
6. The worker reads closed Ads Managment cards too (`include_closed=true`, :2049). A closed card therefore does not hide a spending campaign. Spend is the gate.


## Column definitions from the historical map

Columns:
- **Client card:** the client's card on Clients - Mahara. The list status is "in progress" for every client; the real state is the card's Client Status field, mirrored in `cockpit_client_onboarding`.
- **Ads cards:** open / closed cards on Ads Managment.
- **Account status:** Meta account_status. 1 = active, 2 = disabled, 3 = unsettled (owes Meta), 9 = grace period, 101 = closed.
- **On Meta:** campaign switches from the 12:14 hourly read, or a Meta GET today.
- **Last spend:** the last day with spend in `cockpit_meta_ad_days`.
- **In Ads today:** a current, non-deleted `cockpit_campaigns` row.

## Operational checks

- A missing account-state row means the status is unknown. The launch flow should check current account status, disable reason and currency before acting.
- Treat the client card's stage and registry labels as separate sources; show which source each label comes from.
- Orphaned subtasks under completed launch tasks should not make a client appear to be launching.
- Unsettled accounts can refuse changes, including pausing. Review enabled campaigns as part of a relaunch rehearsal.

See `docs/media-launch/SPEC.md`, `supabase/functions/cockpit-media-api/launchDesk.ts` and its tests for the launch workflow.
