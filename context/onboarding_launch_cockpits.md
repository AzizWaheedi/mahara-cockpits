---
name: client_onboarding_launch
description: Mahara Media's onboarding-to-launch process and the role Cockpits — data spine, ClickUp reality, locked KPI gates and build plan. Use for onboarding, speed to launch, GHL/Meta setup, or the daily role screens.
---

# Onboarding → Launch → the Cockpits (Mahara Media)

Owner: Aziz. Mapped 2026-09-02. Long-form working notes:
`references/session_notes_2026-09-02.md`. Prototype source:
`references/media_buyer_cockpit_prototype.html`.

## The data spine — join on IDs, never on client names

**`DATABASE - MAHARA` `1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0`, tab `Client Data`** is the
canonical join table: one row per client (60) with Status, **Clickup ID, GHL ID, GHL API
(per-client `pit-` token), WA GROUP ID**, Report Doc ID, Drive, Sheet Link, Ad Account
Meta/Snap/TikTok, Country, City, Language, Service, Service Mode. Other tabs: `New Leads`
(lead-level + ad/adset/campaign + UTMs), `Appointments` / `appts_last_30days` (Showed?/Confirmed?/
Closed?), `clients_clean`, `tasks_clean`, `unresolved_tasks`.
Coverage: GHL API 38/60 · Ad Account Meta 31/60 · WA group 57/60 · **Language only 3/60** ·
**only 11 clients marked Active** [sheets, 2026-09-02].

**`Master Dashboard - Mahara` `1pBEyClUxPLc4-RdXR8gZ0MxsLkLLFkWJwkiVqVf2rro`**, tab `data_fb` =
daily ad-level rows (cost, leads, CPL, impressions, clicks, CTR, frequency, ad name, effective
status, account currency) for 18 accounts — more than the Meta API connection can see.
**Defect: `Cost (USD)` is unconverted** — Mofage is QAR, so its CPL reads $44.46 when the true
figure is $12.21. Always check the `Account currency` column. [sheets, 2026-09-02]

Per-client report sheets: `{Client} - Report`, linked from the ClickUp `Sheet Link` field.

## Access status [2026-09-02]

| System | State |
| --- | --- |
| ClickUp | read + write |
| Both master sheets + client sheets | read |
| Meta Ads | read, 13 of 18 accounts (ARCWANI not shared). `get_insights` needs `fields` as a comma-separated **string** |
| GoHighLevel | agency OAuth 401s on customValues; **per-client `pit-` tokens work (tested → 200)** so the Launch Engine runs for the 38 clients that have one |
| WhatsApp / WHAPI | **token file unreadable (0600, other uid) — access is dead, must be re-added** |
| Fathom, Typeform, Slack (incl. #csm-general) | read |

Write-access stance agreed with Aziz: **no Meta write for the first two weeks.** Run
recommend-then-execute with a decision ledger (recommendation → decision → outcome at 7 days), then
take writes only for rules the ledger proves. One exception requested: raising budget on accounts
below the $30/day floor whose CPL is already under the gate.

## ClickUp reality

Team `90182518398`. **No per-person boards** — 5 department lists under Space `901810248115` >
`All Assignments 🦅`: Operations/Tech `901816723190` · Marketing/ADs `901816723196` ·
Call Center `901816723206` · Client Success `901816723211` · Media/Creative `901818016338`.
Also Clients - Mahara `901816559981`, Ads Managment `901817774521`, Onboarding Templates
`901816891077`, Task Templates `901816723408` (28 single-task templates).
API: `pd_clickup_proxy_get`, JSON in `content`, payload under `body`, paginate `?page=N` (100/page).

**Detecting a new onboarding** — a new parent task matching a name pattern:
`{CLIENT} - New Client Campaign Launch 🚀` on Marketing/ADs (+4 subtasks: New Setup, Facebook Ads
Buildout, Tracking Sheets, QA Checklist) · `{CLIENT} - Technical Onboarding Check 🚀` on Ops/Tech
(+9 subtasks) · `{CLIENT} - Brand DNA 🧬` on Media/Creative.

**Board hygiene truth:** all 29 launch parents are unassigned and undated, and every parent marked
`complete` still has 4/4 subtasks open (back to 7 July). The parent is closed because the work is
done; the checklist is unticked overhead. **Never read subtask status as truth.** This is the case
for API auto-QA (8 of 12 onboarding steps are verifiable without a human) over self-ticked lists.
[clickup, 2026-09-02]

`Clients - Mahara` already has Last POC, Next POC, Comms Level, Client Happiness, Next Payment Date,
Next Contract Renewal, Launch Date, Days to Launch, Brand DNA, Offer Cheat Sheet, CSM, MRR, Client
Status, Sheet Link — mostly unfilled. Write touchpoints into **Last POC / Next POC**, never new
fields. `Creative Onboarding` template `86eyrzwtv` is an empty shell; a 5-subtask version was
drafted for Aziz.
Design rule: every deliverable task template ends with "draft the client message → CSM approval →
Last POC updated". The work log is the proactive-communication engine.

## Forms reality [typeform, 2026-09-02]

**Kickoff `tG7dnxBn` and Brand Blueprint `oYZKtogO`: 0 responses each, ever** (the blueprint is
still titled "SANDBOX"). That is why contracted daily budget, approval mode, capacity risk and the
shot-list deadline are missing everywhere — the capturing form is never used. Recommendation given:
kill both and extract the fields from the Fathom recording, then show a pre-filled screen to correct.
**EOD forms are used religiously:** Creative Director `wzm1gzEz` (26 responses), Video Editors
`WH3cPCVq` (33) — Karim and Sabry file completions, in-progress work and blockers daily. Ingest
these as pipeline history and **replace** the form inside the cockpit; do not start a new habit.
Others: Systems Manager `FSC0XwCg`, Setter `x0FWfEpA`, Sales Rep `BfnrbVWJ`.
Design rule that explains all of it: people fill the surfaces that take under two minutes and where
they are the beneficiary.

**Do not rebuild:** #csm-general already runs a Make.com pipeline posting weekly per-client report
links with approve webhooks (`hook.eu2.make.com/y0hhnijygon7pku6alt2ga6thmoxn0fd?id=report-{ghlLocationId}-{YYYY}-W{nn}`).

## The Cockpits

Build plan doc `1o-8wvOz3J1yBwWfNc6gfmbu0Br6mSyjz9rskfN14GYI`. Clickable prototype (static,
workspace-only): `https://maharamedia.viktor.page/media-buyer-cockpit`.
This is the Cockpit pattern from `skills/csm_daily_workflow`, moved off Sheets into one app: a
private link per person delivered to their Slack DM at 07:00, phone-first, three moments —
start of day (checklist already answered, ClickUp + Slack pre-scanned), midday recommendations,
end of day Plan Tomorrow Today (Arabic or English brain dump → owned, dated ClickUp tasks).

Interaction model agreed with Aziz:
- **Every row ends in its own actions**: recommended action + one alternative + `Leave it` + overflow.
- **Modify = reroute** — department picker, assignee, due date, editable title/body; moves the item
  off the wrong person's screen with the evidence intact.
- **`Leave it` needs a reason and a clock.** "Client hasn't approved the budget" spawns a CSM
  touchpoint task; "Disagree with the call" is logged separately and a rule disagreed with 3 times
  gets changed, not re-shown. Repeated reroutes mean the routing rule is wrong.
- Viktor drafts, a human sends. Nothing reaches a client unapproved.

CSM screen = three lists: **Hot List** (upsells/referrals/reviews only, triggers auto-detected,
first-win and one-per-month rules enforced by the list) · **Promised** (commitments pulled from
WhatsApp and calls, days overdue, big ones become Client Success tasks) · **Loose ends** (1-1 form
not submitted, draft unapproved, weekly report missing, task done with no client notification,
upsell form unfilled, stale Last POC) — cleared by 18:00 or it shows in the EOD.

Gaps named beyond Aziz's brief: a **decision ledger** measuring whether recommendations worked (the
thing that makes it self-correcting); the **call centre as the 5th cockpit** (pickup and show rate
are two of the six gates); payment/renewal dates firing automatically.

## Locked SOP numbers

SOP doc IDs are listed in `references/session_notes_2026-09-02.md` (comms, constraints, upsell menu,
backend, journey, media + tech onboarding, the four call frameworks, onboarding→launch messaging).

- **KPI gates:** CPL < $20 · lead→booking ≥ 25% · cost per booking ≤ $80 · pickup ≥ 35% ·
  show rate ≥ 75% · close rate 20–30% · daily budget floor $30 · creative refresh every 7–14 days.
- **Comms:** WhatsApp sprints 10:00–10:30, ~14:00, 17:30–18:00, Friday off; concerns never wait for
  a sprint (call); reply within 2–4h. Min 3 group touchpoints/week/client, 2 deep/month; media buyer
  1–2/week; never two team messages to one client in a day (CSM's daily wins); CSM messages daily
  for the first 14 days.
- **Upsells:** never before the first win; one conversation per client per month; full price first;
  paid in full (SEO/GEO may split 2,500+2,500); card confirmed on the call; **log the trigger phrase
  every time it is heard even when no pitch happens.** Menu: website $2,000 + $200/mo · SEO/GEO
  $5,000/90d · SMM $1,000/mo · cameraman day $800 · UGC $3,500 · closer placement $4,000 + $750/mo ·
  extra campaign $500/mo · referral payout $1,000.
- **Backend renewal:** $12,000 / 6 months, fires 14 days from the end of the 90-day agreement, once
  per client, notified Monday + task created, biweekly call already booked, **never rename the
  call.** Ladder 12k → 10k (paid in full today) → 6k for another 90 days → 3k + 3k on day 30 →
  month-to-month (say plainly it is the worst option). Refusal at rung 5 → hand to Aziz, never
  invent a cheaper offer. After a yes: charge on the call, then the backend upsell form on the
  client update board in Slack.
- **Meta conventions:** campaign `[BUSINESS NAME] | [Service] | [DATE] | MHM™` · ad set
  `Lead Form | $X daily`, office address + 24km radius, conversion event Lead · ad
  `DATE | IMAGE/VIDEO #` · lead form `SERVICE | DATE | VERSION`, More Volume, 3–5 questions, phone
  required · fixed UTM string. Launch target = 7 days from signup; milestones M1–M8.
  ~70% of onboarding steps are API calls, not judgement.

## Role daily SOPs, one per cockpit [2026-09-08]
Branded Google Docs, v1, written to be iterated: media buyer `1TwV5B2ibdlELsuK0aDuBLni6oIrcuBHhyJqjFB4fLtA` ·
Client Success `1O4Cjc_c51S1GCz3aDd1jm2BSwzCB3et5lGumTzAzxrw` · creative director
`1oQUqtpWt6_Ca-tTKcCS8sJYtWZG7_IVoytVdb-wnCXo`. Each covers the day shape, screen by screen,
the gates, escalation and what is not their job, and points at the cockpit URL. Rebuild or restyle
with `scripts/role_sop_doc.py` (`build_sop_doc(title, segments)`, reuses the branded styling in
`skills/csm_daily_workflow/scripts/csm_report_doc.py`; `pd_google_docs_create_document` returns the
payload as a JSON string under `content`). Keep the doc and the app in sync: when a cockpit rule
changes, change the doc in the same run. Live URLs: cockpit and creative are **preview only**
(`preview-cockpit-…`, `preview-creative-…`), only client-success has a prod URL [verified 2026-09-08].

## Defects flagged to Aziz (open)

- **Live Facebook pixel access token in plaintext in the Tech Onboarding SOP** — rotate.
- QAR conversion in `data_fb`; three competing lead columns; contracted daily budget missing;
  `Client Status` unfilled; ad names carry no date (`ad-1`, `ad-3 en`) so days-live must come from
  first-spend; 196 of 223 appointments have no `Closed` value so close-rate gates cannot fire.
- Medical-template leftovers in the Client Journey SOP; `LINK` placeholders in the upsell docs.

## People

Media buyer **Nada** `U0AJQ8P1ACF` · CSM **Abdu / عبدالإله** `U0BTM5F4U0K` · creative director
**Sabry** `U0B2SHGS1JA` · editor **Karim Abdelrahman** `U0B19NM24AD`. Saleh Attal moved to sales but
still holds 34 Marketing/ADs tasks.

## Ads Managment board = the media buyer's spine [clickup, 2026-09-02]
List `901817774521`, one task per campaign, **task name == the Meta campaign name**
(`ARCWANI-MAHARA-29\8`) — this is the join key between ClickUp, Meta and `data_fb`.
Fields Nada maintains by hand and the cockpit should compute instead: Daily Ad Spend (28/34),
Cost Per Lead status (28/34), Cost Per Booking status (28/34), **Bookings Last 7 Days (0/34 — never
filled)**, Last Updated (34/34 but self-typed), Meta Ad Account URL (17/34). Dropdowns are good
(Above KPI / At KPI / Picking Up / Slowing Down / 911 / Needs Refresh) — just set from memory.
Rule from Aziz: **any campaign with spend and no matching task gets a task created automatically**,
pre-filled, flagged on her morning screen as "new campaign detected" for confirmation.
Off-board spend found 19 Aug–1 Sep: Liwan |MAHARA|20\8 $428 · نهوض نجد- mahara-1 3/8 $377 ·
Pidco Group 5 boosted Instagram posts $698 · Arcturus reach/engagement $51 (~$1,550 client spend
with no task, no owner, no KPI status).
Canonical lead metric decided by Aziz: **`Leads (total)`** (survives Snap/TikTok/Google).
Contracted daily budget: Nada enters the 11 active clients once, inline, writing to the ClickUp
`Daily Budget` field; until then compare each account's spend to its own 30-day median.
Still needed: the link to the ClickUp form she uses to add campaigns, so created tasks match hers.

## Media buyer cockpit — origin + architecture [2026-09-02]
Viktor Space project **`cockpit`** (`/work/viktor-spaces/cockpit-6d490e190930`), preview
`https://preview-cockpit-maharamedia.viktor.space`. Built for Nada; three moments a day —
start of day, midday roster, Plan Tomorrow Today. **Her EOD form is absorbed:** the cockpit
assembles the EOD from the day's real activity, so there is no separate Media Buyer Typeform.
Architecture: Convex actions call Viktor SDK tools through `convex/tools.ts` → `callTool(...)`;
`convex/sync.ts` `runSync` builds the snapshot (30d data_fb rows, FX-converted, aggregated per
campaign, joined to the Ads Managment task, scored into verdicts + checks). `convex/cockpit.ts`
holds snapshot/toggleCheck/decide/addPlanItems.
Rules: convert currency before any comparison; derive days-live from first spend so ad names
need not change. Mahara's own `maharamedia` account is Aziz's B2B and is excluded entirely
(`INTERNAL_ACCOUNTS`). [aziz, 2026-09-02]
**Build gotchas:** run `bunx convex dev --once` with `CONVEX_TMPDIR` inside the project (/tmp is a
different filesystem → EPERM). `node_modules` is a symlink into /tmp and is wiped between sessions
— recreate, `bun install`, re-run `bunx playwright install chromium` before testing.


## Media buyer cockpit — current state
Full detail lives in `references/media-buyer-cockpit.md` — **read it before touching the app.**
It covers: the five sections, the client-tag join rule, ClickUp writeback, bookings via GHL,
KPI gates and `diagnose()`, the learning-period rule, the campaign builder, winners library,
audience recommendations, the Ask Viktor chat box, and the concurrency hazard with the parallel
CSM thread.

**Concurrency hazard, repeated here because it bites:** a parallel agent thread edits this same
Space and this same skill file. Re-read shared files (`src/pages/index.ts`, routes,
`AppSidebar.tsx`, `convex/schema.ts`, this SKILL.md) immediately before editing, and verify after.

## Verify every sheet write by reading it back [2026-09-05]
A `pd_google_sheets_proxy_put` reported success in a prior run and the sheet was in fact EMPTY;
Aziz found it, not me. Always re-GET the range after writing and check row count before telling
anyone it is done. Same rule for any write-then-report step.
Client label sheet `10vGT2Jw43eCsSi5UfGY6O35_6pq-rjaEDi-fN86yZ-A`: 42 clients ranked by 180d spend,
country derived from Meta ad-account timezone, city/service/status from `ghl_clients`. Only 5 of 42
have a city in any system — city is Aziz-supplied and exists nowhere else. Top accounts by 180d
spend: تحديث المباني $21,417 / 1,331 leads · Mofage $11,438 · Joe & Sera $3,703. [meta+supabase, 2026-09-05]

## Client card = the asset spine [clickup, 2026-09-05]
`Clients - Mahara` list holds per-client links the cockpit should auto-load, never ask her to upload:
`🧬 Brand DNA` (Google Doc) · `📈 Offer Cheat Sheet` (Google Doc) · `🧬 Brand Blueprint Form Link` ·
`Drive Link` (creative folder) · `Market Research doc` (ClickUp Doc) · `Sheet Link` (client report) ·
`Daily Budget` · `MRR` · `CSM` · `Kickoff Form Link` · `Sales Meeting Link` (Fathom).
Media/Creative list (`901818016338`) fields: Service, Request Type, Daily Budget, AD Form Name,
Qualification Questions, Edited Video Link, Funnel Intent Level, Break-Even Status.
Rule: if a value exists on the client card, the cockpit pulls it — uploading is the fallback.

## Meta reads bypass the tool gateway [2026-09-05]
`convex/tools.ts` exports `graph(path, params)` and `allAdAccounts()`, calling Graph API v21.0
directly with Convex env var `META_SYSTEM_TOKEN`. `sync.ts` uses these instead of
`mcp_meta_ads_list_ad_accounts` / `list_campaigns`, so Meta data keeps flowing when the Viktor tool
gateway is down. `WRITABLE_ACCOUNTS` in `convex/builder.ts` now lists all 43 client accounts.
Set the token with `bunx convex env set META_SYSTEM_TOKEN <token>` (CONVEX_TMPDIR inside project).

## GCC geo targeting rule [aziz, 2026-09-05]
**Kuwait, Qatar, Bahrain and UAE are targeted whole-country** — city is not a meaningful field there
and businesses do not segment by it. Those rows carry `Nationwide` in the label sheet, not a blank.
Saudi Arabia and UAE-with-a-named-city are the only places city matters.
=> **Winners matching: Saudi matches city-to-city (Riyadh→Riyadh); KW/QA/BH match country-to-country.**
Do not hunt for city-level patterns in the small Gulf states — they were never meant to exist.
Label sheet geo COMPLETE 2026-09-05, 0 blanks: Nationwide 19 · Riyadh 12 · Jeddah 3 · Qatif 3 ·
Dubai 2 · Jeddah/Makkah 1 · Doha 1 · Khobar 1.

**ClickUp research reports are the authoritative source for client country/city** — ClickUp Docs API
`GET /api/v3/workspaces/90182518398/docs?limit=100` (names start "Research Report — {client}"), then
`/docs/{id}/pages`. Read the client's own `Address:` line in section 1; the rest of the report is
competitor analysis and will mislead a keyword count.
**Do NOT derive country from ad-account timezone** — Castello Industries W.L.L is Qatar (Doha) but
runs on Asia/Riyadh, so it was mislabelled Saudi Arabia. An audit of every client with a research
report found Castello was the only such mismatch, but the method is unsafe.

**Defect: `Ahmed Salama USD` (act_290802986, Atlantis) has an America/Los_Angeles timezone** — its
reporting day is offset from every other account, skewing day-boundary numbers. Flagged to Aziz
2026-09-05. Meta cannot change an ad account timezone once it has spend; a new account is the only
true fix. (Client itself is ATLANTIS PREMIUM PROJECTS, Riyadh.)

## Deeper references

- `references/media-buyer-cockpit.md` — the media buyer screen in full.
- `references/cockpits-and-meta.md` — Meta partner access during
  onboarding, GCC geo targeting rule, cockpit UI tones, the sandbox
  bridge + crons, hard-won truths about the ClickUp/Meta data, and the
  creative director cockpit. **Read before touching the Space.**

## Payment structure is in ClickUp, use it for any cash math
`Payment Plan` (drop_down: Monthly / Split Pay (2x payments) / Paid in full (90 days)) plus the
`Billing📝` text field (cash collected, payment structure, total contracted revenue) on Clients -
Mahara `901816559981`. **Never model future cash from MRR × months alone** — PIF clients have $0
future inflow and are pure delivery liability, split-pay owe one ~$3K payment, only monthly clients
carry real ongoing collections. `Billing📝` "Cash collected" is often stale at the $500 deposit, and
`Payment Plan` sometimes disagrees with the Billing note (e.g. Alkhalil), so flag conflicts instead of
picking one. Standard new-cohort contract = $6,000 total over 90 days. [clickup, 2026-09-08]

Cash-tail modelling (wind-down or runway questions) lives in
`scripts/winddown_cash_model.py`. **Billing starts on the Launch Date, not signup**, so the 90-day term
and every instalment are anchored to launch. Anchor live accounts on their actual `Next Payment Date`
(not a computed launch+30 cadence, that misdated two $3K split payments by a month); fall back to
launch+30 only where the field is blank. Split-pay = one remaining ~$3K payment. PIF = $0 inflow.
A charge dated after term end is a renewal, exclude it from tail models. **The launch-day payment is the
deposit plus onboarding cash, already collected at signup, so the first NEW monthly collection is
launch+30** (a September launch first bills in October). Onboarding payments still owed sit in the
`Billing📝` note ("Cash To Be Collected On Onboarding") and are separate money worth chasing. Aziz asked for this
2026-09-08 as a hypothetical wind-down; these numbers are private to him (finances, never team-facing).
Wind-down plan doc (private to Aziz): `1hmpQqdL7h8oVk3AwYJHD_klqwpvOvHHTBMMkOlIhstQ` [2026-09-08]

## Wind-down execution (modelled 2026-09-08, confidential to Aziz)
If a fulfil-and-close is ever run: hard-cut in ONE pass (ads to zero, setter, studio, own-content editors,
3rd call-centre agent, all sales-side software), keep Sabri + media buyer to 30 Nov, web dev to 31 Oct,
CSM to 31 Dec. Trimmed crew + ~$4,000 software floor = ~-$1,600 total vs ~-$21,700 with a gradual taper.
Three rules that carry the money: (1) launch every unlaunched account immediately, billing starts at launch
and a late launch pushes delivery past the last staffed month; (2) never tell clients you are closing while
delivery obligations run, refunds and chargebacks cost more than the remaining balance; (3) offer 10% off
remaining balance for paid-in-full to pull ~$36.7K forward and kill churn risk. Selling the book is the
better option, its value is the renewal stream ($12,000/6mo per client) a shutdown discards.
