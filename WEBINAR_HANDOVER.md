> Follow-up implementation, 25 September: [metrics and readiness checkpoint](docs/WEBINAR-METRICS-2026-09-25.md). It records tested changes, fresh provider evidence and remaining launch gates. The inventory below is preserved as the original handover.

# Handover: Mahara's webinar funnel metrics

Written 2026-09-25 for the agent taking over. Unless a line says otherwise, everything here was checked read-only between 08:30 and 09:00 UTC on 2026-09-25 against:

- `origin/main` of AzizWaheedi/mahara-cockpits at `ead384a`. The webinar files last changed in `bf17731` on 2026-09-23.
- The two Supabase databases.
- The VPS.
- The live site.
- HighLevel, Zoom and the registration API, through read-only calls.

This document holds counts and field names only. It contains no lead names, emails or phone numbers, and no secret values.

Re-checked by the handing-over session at 09:10 UTC the same day: all six WEBBY workflows are `draft` in HighLevel; `webby-live-training.vercel.app/api/health` answers `ghlTokenSet:false` with a start of 2026-09-24 20:00 Kuwait; `JOURNEY_SQL` picks the round tag with `order by t desc limit 1`; and `sessionAt` reads a `YYYY-MM-DD` value as midnight.

---

## 1. What this is and the goal

The live training is Mahara's second way of getting clients, next to the call funnel. In Arabic copy it is always «التدريب المباشر المجاني»; never use the word ويبينار. The path is:

1. A Meta ad
2. The landing page, webinar.maharamedia.com
3. Registration in HighLevel
4. Reminders: WhatsApp and SMS from HighLevel, email from Kit
5. A 90-minute Zoom session with two pitches
6. A booked intro or demo call
7. A signed deal, and the cash from it

What Aziz asked for, on 2026-09-23:

- **Two funnels that never mix.** His words: "separate the two funnels ... track all of these metrics. These are the sources of truth". The CEO cockpit's Frontend tab now has a Call funnel and a Webinar funnel, at `https://cockpit.maharamedia.com/ceo?tab=frontend&funnel=webinar`. Every call, lead and dollar belongs to exactly one of them. `convex/ceo/webinarSql.ts` is the single rule for what belongs to the webinar.
- **The Live Training tracking brief is the spec.** It is Google Doc `1Iu8py7XKyZdDEcE9FG8CoF4CQYuk4Rh3umw1Gs-UE98`, dated 6 Aug 2026. It is private: it returned 401 without a Google sign-in, so it was not re-read for this handover. The code implements it as follows:
  - Each measurement comes from one named source of truth:

    | Measurement | Source of truth |
    |---|---|
    | Ad-level numbers | Meta. Meta's own lead and conversion counts are never used. |
    | Traffic and on-page conversion | The page's own events |
    | Registrations and appointments | HighLevel |
    | Who showed and for how long | Zoom |
    | The post-event survey | Typeform |
    | Objections | Fathom transcripts, not the closer's notes |
    | Money | The closer form, confirmed by Whop or the bank |
    | Speed to first contact | Maqsam |

  - Raw rows are stored and every rate is computed on read, "because the definitions will change at least twice".
  - People are never matched by name.
- **Qualification.** Aziz: "qualification in the form after also before they book a call". A registrant is qualified if the booking form's `roas-*` tag says so. Without that tag, the gift survey's yearly net profit decides: $100K or more is qualified.
- **One booking link per pitch.** The brief calls this "the single highest-value thing on this list" (quoted in migration `20260923j`).
- **Targets** (brief §6, `WEBINAR_TARGETS` in `convex/ceo/adapters/webinar.ts`), for a $2,000, four-day ad flight:

  | Measure | Target |
  |---|---|
  | Cost per registration | $6–10, plan $8 |
  | Registrations | 200–330, plan 250 |
  | Page conversion | 15–25%; under 10% the page is the problem |
  | Show rate | 30–40% |
  | Retention at pitch 1 | 50% of the peak |
  | Attendee to booked call | 10–15% |
  | Booked to held | 60% |
  | Close rate | 20% |
  | Kill rule | After $500 spent, cost per registration over $15 means swap the creative |

**Where it stands on 2026-09-25.** The measuring side is built, deployed and healthy: the VPS worker has run every hour since 2026-09-23 with no failures, and the cockpit section is computed every 15 minutes.

The funnel itself has never run. Nothing has happened at any stage yet:

- No webinar campaign has ever spent, and Mahara's ad account has spent nothing since 2026-09-09.
- No contact carries a `webby-*` tag, in B2B or in HighLevel.
- The Zoom meeting has never started.
- The survey has 0 responses.
- The site has recorded 0 page events.

**Launch blockers found today:**

- **All six WEBBY workflows in HighLevel are drafts.** Nobody would be tagged as registered, and no reminder would go out.
- **The registration API has no HighLevel token.** This API books the Live Training appointment that starts the reminders, and its health check says `ghlTokenSet:false`.

**Code defects to fix before the first session:**

- **"Webinar Datetime" is a date without a time.** At the first session, Zoom attendance will not attach to its registrants (§6.1).
- **Repeat registrants land in the wrong round.** The round tag is picked alphabetically (§6.2).

---

## 2. How it works today

```
Meta ad (utm_content={{ad.id}}) ─► webinar.maharamedia.com ─ mm-track.js ─► Edge Function webinar-events ─► Triage cockpit_webinar_page_events
   │                                   └ GHL form "Webinar Opt In" ─► HighLevel contact ─► W1 (DRAFT): tags webby-registered + webby-sep-2026,
   │                                                                     │                  POST {Webby API Base}/api/register ─► Webinar Datetime (a date),
   │                                                                     │                  "WEBBY · Live Training" appointment ─► W2 reminders (DRAFT)
   │                                                                     └─► B2B sync ─► B2B leads (tags, raw_contact) ─────────► CEO adapter `webinar`
   ├─ thank-you page ─► Typeform P1xP4r24 ───────────────────────────────► pull.py survey ─► cockpit_webinar_forms
   ├─ reminders' link /live ─► page event join_click ─► Zoom 88628953097 ─► pull.py zoom ─► cockpit_webinar_sessions / _attendance / _engagement
   ├─ pitch links /p1 /p2 ─► page event pitch_click ─► funnel.maharamedia.com/intro-booking?utm_content=pitch1|2 ─► HighLevel attribution URL
   ├─ intro/demo calendars ─► B2B calls;  closer Typeform ─► B2B closed_deals (+ whop_payments, transfers);  Maqsam ─► B2B maqsam_calls
   ├─ HighLevel conversations ─► pull.py reminders ─► cockpit_webinar_messages
   └─ Fathom sales calls ─► pull.py objections (deepseek-flash) ─► cockpit_webinar_objections
All of it ─► Convex prod adorable-seahorse-418, cron "refresh the CEO cockpit" every 15 min
         ─► section `webinar` (Convex ceoSections, mirrored to Triage cockpit_sections) ─► src/pages/ceo/WebinarFunnel.tsx
```

The table below takes each step in turn: what happens, which system holds the data, which code reads it, and what is actually there today.

| Step | What happens | Held in | Read by | State today |
|---|---|---|---|---|
| 1. Ad | Campaigns run on Mahara's account `act_746108264865897`. A campaign counts as the webinar's when its name matches `WEBINAR_CAMPAIGN_NAME` (webinar, webby, live training, training, تدريب, ويبينار, ويبنار), or when B2B `lt_events` names it (`webbyCampaign`). Every ad URL must carry `utm_content={{ad.id}}`. | Meta → B2B `meta_ad_snapshots` (Muhammed's sync) | `SPEND_SQL`. Reach and frequency: `readInsights` (`frequency.ts`, Graph API through `tools.ts`), once per round. `growth.ts` subtracts the same rows from the call funnel. | 0 snapshot rows under a webinar name, ever. Newest snapshot day is 2026-09-13; the last day with any spend is 2026-09-09. The sync itself succeeds. On 2026-09-22 Meta refused every write on the account (#2490592 "ineligible to manage ads", an unsettled balance); not re-checked today. |
| 2. Landing page | webinar.maharamedia.com: Vercel project `mahara-webinar`, source `sites/webinar`, also served at `mahara-webinar.vercel.app`. `mm-track.js` posts page events. It uses no cookies and sends no personal data: a random browser id, a session that ends after 30 idle minutes, and the `utm_*` values (kept 30 days). | Edge Function `webinar-events` → Triage `cockpit_webinar_page_events` | `COLLECTED_SQL` (visitors, joins, pitches) → `pageStats` (`webinarPage.ts`). Only rows with `origin_host = 'webinar.maharamedia.com'` count. | The live files are byte-identical to `origin/main`. 0 page events; the test rows were deleted on 2026-09-23. The countdown and date chips still say Thursday 17 September, 20:00. |
| 3. Registration | The GHL form "Webinar Opt In" `5wC0SkFcgCfFzbpOUBWk` (an iframe) creates or updates the contact in HighLevel sub-account `7NI8yyJtwsh2OOWA5Icr`. W1, triggered by that form, then:<br>• tags the contact `webby-registered` and `webby-sep-2026`;<br>• sets the Webinar Round field;<br>• moves the Webinar pipeline card to Registered;<br>• adds the contact to Kit;<br>• sends SMS 1 and SMS 2;<br>• calls `POST {{custom_values.webby_api_base}}/api/register`, which writes Webinar Datetime (**date only**) and books the contact on the "WEBBY · Live Training" calendar at `WEBINAR_START`. | HighLevel → B2B `leads` (tags; `raw_contact` with customFields and attribution) | `JOURNEY_SQL`, one row per `webby-*` contact. It uses `webbyLead`, `webbyFrom`, `sessionAt` and `fieldValue` from `webinarSql.ts`. | **W1, W2, W4a, W4b, W5 and W6 are all `draft`** (HighLevel `GET /workflows`, last edited 2026-09-08). The Webby API Base is `webby-live-training.vercel.app`, which is not in this repo. Its `/api/health` returns `ghlTokenSet:false`, `webinarStart:"2026-09-24T20:00:00+03:00"`, `round:"sep-2026"`, `typeformSecretSet:false`. 0 contacts carry a `webby-*` tag, in B2B and in HighLevel. |
| 4. Thank-you page and survey | The page offers an Add to calendar link (still set to 17 Sep), a "check your email" step, a WhatsApp group button still pointing at `[WHATSAPP_LINK]`, and the gift survey: a Typeform live embed `01KZ3P3FNVH6MFSS08WSA5SB1Y` for form `P1xP4r24`. The survey is also sent after the session. | Typeform | `pull.py survey` (Typeform through Composio) → `cockpit_webinar_forms`. The adapter ties each response to a registrant by the hidden `user_id` (a HighLevel contact id), then the email, then the last 8 digits of the phone. | 0 responses. The page passes no hidden fields itself; its URL carries only `?name=`. |
| 5. Reminders | W2 is triggered by the Live Training appointment. It sends WhatsApp or SMS at 48 h, 24 h, 60 min, 15 min and 5 min before the start, and at 4 and 9 min after it. Their join link is `webinar.maharamedia.com/live`. Kit sends the emails: sequence K1 and the broadcasts. | HighLevel conversations; Kit | `pull.py reminders` reads the HighLevel conversations API for each registrant and matches each message's text to one of 14 WEBBY steps (the text itself is not stored) → `cockpit_webinar_messages` → `reminderStats` (`webinarFollowUp.ts`). An open of `/live` becomes a `join_click` page event. Kit is not read. | Today no reminder would go out: W2 is a draft, and no appointment can be booked without the token. `/live` does record the click and open Zoom (doctor: "leads to Zoom"). |
| 6. Zoom session | Meeting `88628953097` is a one-time meeting (type 2), scheduled for 2026-09-17 17:00 UTC (20:00 Kuwait), 90 min. It has never started: status `waiting`, 0 past instances. Registration is off (`approval_type` 2), cloud recording is on, the waiting room is off. | Zoom | `pull.py zoom` reads through Composio first. It uses the VPS Zoom server-to-server app for past instances, polls and Q&A, and as a fallback. It writes `cockpit_webinar_sessions`, `_attendance` and `_engagement`, which `roomOf` (`webinarRoom.ts`) turns into numbers. Pitch times can be set on screen (`ceo/webinarPitch.set`). | 0 sessions. After a session, nobody tags `webby-attended` or `webby-noshow` (which fire W4a and W4b) without Aziz's yes. |
| 7. Pitch | The host shares `/p1` at pitch 1 and `/p2` at pitch 2. Each records a `pitch_click` and opens `funnel.maharamedia.com/intro-booking?utm_source=webinar&utm_medium=zoom&utm_content=pitch1` (or `pitch2`). | Page events; HighLevel keeps the booking URL in `lastAttributionSource.url` | `pageStats` pitch clicks; the `pitch_utm` column of `JOURNEY_SQL` → `pitchBookings` | 0 |
| 8. Booking | The four intro and demo calendars in B2B `calendar_call_type_map`. W6 (a draft) would tag `webby-booked`. | HighLevel → B2B `calls` | The calls of `JOURNEY_SQL`: intro or demo, booked after registering. A call counts as shown when it is marked showed, or when it is marked confirmed or invalid and its time has passed. | The Live Training calendar is not synced into B2B (0 rows). |
| 9. Deal and cash | The closer's New Client Form (a Typeform) → B2B `closed_deals`. A deposit counts as confirmed when a Whop payment (`whop_payments`) or a bank transfer (`transfers`) backs it. | B2B | The deals of `JOURNEY_SQL`: matched by contact id, else by lowercased email, and signed after registering. `DEPOSIT_CONFIRMED` comes from `growth.ts`. | Newest deal 2026-09-12 |
| 10. First contact, objections | Maqsam calls by sales reps; Fathom recordings of sales calls | B2B `maqsam_calls` and `sales_reps`; the Fathom API | `first_contact` in `JOURNEY_SQL` (`BY_SALES_REP` and `CALL_IS_WITH_LEAD` from `growth.ts`). `pull.py objections` → `cockpit_webinar_objections` → `objectionStats`. | Newest Maqsam row 2026-09-20. 0 objections, because there are 0 registrants. |
| 11. Screen | The CEO refresh runs every 15 minutes on Convex prod `adorable-seahorse-418`. | Convex `ceoSections`, mirrored to Triage `cockpit_sections` | `WebinarFunnel.tsx` | Section `webinar` computed 2026-09-25 08:35:50 UTC: ok, 0 rounds, one note ("The webinar has not started ... Every number here fills in on its own once it does"; untrue while W1 is a draft, see §6.3). |

**When a registrant's webinar story starts** (`webbyFrom`): the later of the contact's creation and 21 days before their Webinar Datetime. Their intro/demo calls booked, and deals signed, from one hour before that moment belong to the webinar. The call funnel (`growth.ts`) subtracts exactly the same rows, both from `b2b_window_metrics` and from every other read it makes. The subtraction was verified on 2026-09-23 against a stand-in tag (total = webinar part + the rest, for every count).

---

## 3. File map

**CEO cockpit backend** (`apps/media-buyer-cockpit/convex/`)

- `ceo/webinarSql.ts` is the one rule for what belongs to the webinar. It holds:
  - the SQL predicates `webbyLead`, `webbyNewLead`, `webbyCall`, `webbyDeal`, `webbyCampaign`, `webbyFrom`, `sessionAt` and `fieldValue`;
  - the custom field ids `SESSION_FIELD` (Webinar Datetime, `x7aG8iLqmTzQEr6SGCaH`) and `ROUND_FIELD` (Webinar Round, `a2j833icPANKyXtSsGu1`);
  - `WEBINAR_CAMPAIGN_NAME`.
- `ceo/adapters/webinar.ts` builds the `webinar` section. It contains:
  - the queries `JOURNEY_SQL`, `SPEND_SQL` and `LT_SQL` (on B2B) and `COLLECTED_SQL` (on Triage);
  - how spend, page visitors and Zoom sessions are assigned to rounds;
  - every per-round number and the per-ad table;
  - the 20-item `tracking` list, the notes, and `WEBINAR_TARGETS`.
- `ceo/webinarRoom.ts` is pure code: `roomOf`, `onesBurst`, `merge`, `QUALIFIED_PROFIT` (100000) and `phoneKey` (last 8 digits).
- `ceo/webinarPage.ts` is pure code: `pageStats` and `AD_ID`.
- `ceo/webinarFollowUp.ts` is pure code: `reminderStats` (with `REMINDER_STEPS`, the 14 WEBBY steps) and `objectionStats` (with `OBJECTION_NAMES`).
- `ceo/webinarPitch.ts` holds `set`, a CEO-only action. It checks whole minutes from 0 to 300 (pitch 2 after pitch 1), patches `cockpit_webinar_sessions.pitch1_at/pitch2_at`, writes a `ceoAudit` row (`webinar.pitches`), and refreshes the `webinar` section.
- `ceo/adapters/growth.ts` is the call funnel, computed with the webinar left out. `withoutWebinar` recomputes every rate after the subtraction. It also exports `BY_SALES_REP`, `CALL_IS_WITH_LEAD` and `DEPOSIT_CONFIRMED`, which the webinar adapter reuses.
- `ceo/frequency.ts` holds `campaignType` (which has a `webinar` class) and `readInsights`.
- `ceo/payloads.ts` defines `WebinarPayload`, `WebinarRound`, `WebinarCollectorRun` and `FunnelWindow.webinarOut`.
- Refresh:
  - `ceo/registry.ts` registers the adapter.
  - `crons.ts` holds "refresh the CEO cockpit", every 15 min.
  - `ceo/refresh.ts` (`mirrorSection`) writes each section to `cockpit_sections` and per-metric rows.
- Database access:
  - `ceo/sb.ts` runs read-only SQL (SELECT or WITH only) through `tools.ts` (`mcp_supabase_execute_sql`).
  - `ceo/sbWrite.ts` does REST writes with the service key.
- `ceo/windows.ts` holds `gate`, which calls `requireCeo`.
- `ceo/metricRegistry.ts` has **no webinar metrics**.
- `ceo/migrate.ts` holds `applySql`: additive migrations only, anything destructive is refused.
- `ceo/edgeDeploy.ts` deploys Edge Functions through the Supabase management API. It automates only `tap-charges-sync`.
- `ceo/adapters/assets.ts` is not part of this funnel. It produces the Sales tab's "Live Training" note from the counts of the B2B `lt_*` tables.

**CEO cockpit frontend** (`apps/media-buyer-cockpit/src/`)

- `pages/ceo/WebinarFunnel.tsx` is the screen:
  - the headline tiles (with the kill-rule chip);
  - "Stage by stage" (`stages()`);
  - the roll-up across sessions;
  - "Ads, spend to cash";
  - "What still has to be connected", fed by `tracking`;
  - the room curve and the pitch-time setter;
  - the reminder steps, the objections and the profit bands.
- `pages/ceo/FrontendTab.tsx` holds the Call/Webinar switch (`useTabParam(FUNNELS, "call", "funnel")`) and `webinarOutNote`.
- `components/ceo/useCeo.ts`, `pages/ceo/MachineTab.tsx` and `pages/ceo/SalesTab.tsx` wire the section and its labels.
- `pages/ceo/SOURCES.md` has the rows "Frontend tab: the call funnel and the webinar funnel": every definition and what it leaves out.
- `dev/harness.tsx` and `dev/convexStub.ts` are the layout harness (`bun run harness`, fixtures in `tmp/harness/`). **No webinar fixture exists yet.**

**Tests**

- `apps/media-buyer-cockpit/scripts/webinar.test.ts` has 23 tests: the room, the curve, pitches, phones, the landing page, reminders and objections. `ship.sh` runs it. It passes today.
- `hermes/webinar-pull/test_pull.py` has 29 tests. `ship.sh` does not run it. It passes today.

**Worker**

- `hermes/webinar-pull/pull.py` has the commands `pull` (the default), `zoom`, `survey`, `reminders`, `objections` and `doctor`, and the flags `--again`, `--dry-run` and `--quiet`.
- `hermes/webinar-pull/README.md` covers the install, the cron line, the settings and the matching rules.

**Site** (`sites/webinar/`, served by Vercel project `mahara-webinar`)

- `index.html`: the landing page, with the GHL form, `COUNTDOWN_ISO`, the date chips and the Wistia testimonials.
- `thank-you.html`: the calendar link, `[WHATSAPP_LINK]`, and the Typeform live embed.
- `live.html`: records `join_click`, then opens Zoom 88628953097. The join URL, including its passcode, is written into this file in three places.
- `p1.html` and `p2.html`: the pitch booking links.
- `mm-track.js`: the page-event tracker.
- `vercel.json`: rewrites for `/live`, `/thank-you`, `/p1` and `/p2`, plus cache headers.
- `README.md`: deploy steps, the `.vercel/project.json` content (that file is not in git), and the list of events.
- `.vercelignore` and `.gitignore`.

**Supabase**

- `supabase/functions/webinar-events/index.ts`: the public page-event endpoint.
- Migrations, all applied to Triage (the tables and constraints were verified today):
  - `supabase/migrations/20260923g_webinar_collection.sql`: sessions, attendance, engagement, forms, pulls.
  - `20260923h_webinar_page_events.sql`: page events.
  - `20260923i_webinar_reminders_objections.sql`: messages, objections, and the widened `pulls` source check.
  - `20260923j_webinar_pitch_links.sql`: adds page `pitch` and event `pitch_click`.

**Ops and docs**

- `scripts/ship.sh`, `scripts/vercel-deploy-composio.sh`, `scripts/require-github-main.sh`.
- `RUNBOOK.md`, section "Webinar pull".
- `.claude/launch.json`: the entry `webinar-site` serves `sites/webinar` on 127.0.0.1:5188.
- `SALES_COCKPIT_PLAN.md`: §6 notes that the Fathom → B2B copy has been refused since 12 Sep; §7, decision 3 is "No lead data to DeepSeek" (Aziz, 2026-09-24).
- `hermes/sales-desk/desk/fathom.py` and `desk/recordings.py`: the per-rep Fathom reading to copy (`recorded_by[]`).
- `CLAUDE.md`: the standing rules.

**Outside this repo** (you may not have access to all of these)

- In the `AzizWaheedi/mahara-context` repo:
  - `skills/meta/ghl-workflow-builder/reference/mahara-live-ids.md` lists every WEBBY id: pipeline and stages, custom fields, custom values, tags, calendars, workflows, and the Kit tag, sequence and broadcast ids.
  - `scripts/phase-b-build-workflows.js` built W1–W6.
  - `phase-c-edit-trigger-and-step.js` changed W1's trigger to the form and added the webhook step that calls `/api/register`.
  - Session records `shared/sessions/2026-09-23T160000Z-claude-call-and-webinar-funnels.md`, `…T170000Z-claude-webinar-zoom-survey-pull.md` and `…T180000Z-claude-webinar-page-reminders-objections.md`.
- On Aziz's Mac only, in `~/Documents/Claude/Projects/Ad/Funnel Scripting/`:
  - `WEBINAR - BUILD DOC (A-Z).md`: the operator's build doc (build status on 8 Sep, the workflows, the 18 emails, the 14 messages, a per-round runbook).
  - `WEBINAR - Stress Test + Launch Schedule.md`: the 10-step pre-launch test and a proposed schedule for 24 Sep, which never ran.
  - `webby-live-training-vercel.zip`: the source of `/api/register`, `/api/survey` and `/api/health`, dated 8 Sep.
- `~/mahara-webinar` is the old site folder. It is stale and carries a "moved" banner.
- The Vercel project `webby-live-training` (named in the operator doc) serves `webby-live-training.vercel.app`, the Webby API Base. Its source exists only in the zip above.

---

## 4. Tables and jobs

### Creative Triage `bldgtotkfmhoxmlzowdx`

Every `cockpit_webinar_*` table has row security on and gives no access to anon or authenticated users; the service role writes (verified today).

| Table | One row per | Written by | Rows | Newest row |
|---|---|---|---|---|
| `cockpit_webinar_sessions` | Zoom meeting instance (by UUID) | `pull.py pull_zoom`; `webinarPitch.set` (pitch columns only) | 0 | — |
| `cockpit_webinar_attendance` | Zoom join/leave pair | `pull.py` | 0 | — |
| `cockpit_webinar_engagement` | Chat line, poll answer, Q&A question | `pull.py` | 0 | — |
| `cockpit_webinar_forms` | Gift survey response | `pull.py` | 0 | — |
| `cockpit_webinar_messages` | Outbound HighLevel message to a registrant (no text) | `pull.py` | 0 | — |
| `cockpit_webinar_objections` | Registrant's Fathom sales call, tagged | `pull.py` (deepseek-flash) | 0 | — |
| `cockpit_webinar_page_events` | Page event from the site | Edge Function `webinar-events` | 0 | none since the test rows were deleted on 2026-09-23 |
| `cockpit_webinar_pulls` | Worker run, per source | `pull.py` | 144 | 2026-09-25 08:23 UTC |
| `cockpit_sections`, row `webinar` | Section payload | Convex refresh (`mirrorSection`) | 1 | computed 2026-09-25 08:35:50 UTC |

Worker runs since 2026-09-23 13:37 UTC, none failed:

| Source | Runs | How it read | What it found in the latest run |
|---|---|---|---|
| zoom | 48 | Composio and the Zoom app | 0 sessions; registration off; join link ok; polls readable; not live |
| typeform | 46 | Composio | 0 responses |
| objections | 43 | Fathom and deepseek-flash | 0 registrants, 0 matched |
| reminders | 7 (every 6 h) | HighLevel | 0 registrants, 1 HighLevel call |

### B2B `flwboeijllbtrufxkhts` (read-only for us; Muhammed's)

| Table | What we use it for | Rows | Newest | Webinar rows |
|---|---|---|---|---|
| `leads` | Registrants: tags, `raw_contact.customFields`, attribution | 4,939 | 2026-09-24 14:24 UTC | None of these: a `webby-*` tag, Webinar Datetime or Round set, an attribution URL mentioning the webinar or a pitch, or a reference to the opt-in form. The copy holds untagged contacts too (1,616), so a registrant should arrive once W1 tags them. |
| `calls` | Intro and demo bookings | 2,580 (intro 1,542, demo 1,038) | booked 2026-09-22 18:34 UTC | The Live Training calendar is not mapped, so it has no rows |
| `closed_deals` | Signed deals | 50 | 2026-09-12 | — |
| `meta_ad_snapshots` | Spend, impressions, clicks | 7,921 | day 2026-09-13 (last spend 2026-09-09) | 0 under a webinar name |
| `maqsam_calls` | First contact | 2,911 | 2026-09-20 15:54 UTC | — |

`sales_reps` (9 rows), `whop_payments` (183, newest 2026-09-22) and `transfers` (20) serve the sales-rep filter and cash confirmation.

`lt_events`, `lt_registrants`, `lt_attendance`, `lt_engagement`, `lt_outcomes` and `lt_page_events`, and the `v_lt_*` views, are Muhammed's live-training schema. They hold 0 rows each. The adapter only counts them.

`sync_state` this morning: meta, leads, ghl_calls, typeform, maqsam_calls and whop_payments succeeded. `fathom_calls` has been in error since 2026-09-12.

### Jobs

- **VPS cron.** Host `187.77.156.166`, user `hermes`, hostname `srv1490962`, Python 3.12.3.
  ```
  23 * * * *  flock -n $HOME/.webinar-pull.lock bash -c "cd $HOME/mahara-cockpits/hermes/webinar-pull && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; set +a; python3 pull.py --quiet" >> $HOME/.webinar-pull.log 2>&1
  ```
  - The lock is `~/.webinar-pull.lock`.
  - The log `~/.webinar-pull.log` is **0 bytes**, and has been since it was created on 2026-09-23 13:54 UTC. With `--quiet` every progress and failure note is silenced, so only an uncaught crash would ever write there. The run history is in `cockpit_webinar_pulls`.
  - In each run: Zoom is read every hour, the survey every hour, and objections every hour (at most 8 new calls per run). Reminders are read every 6 h, and hourly from 36 h before a session to 6 h after it.
  - The code is at `~/mahara-cockpits/hermes/webinar-pull`. `pull.py`, `test_pull.py` and `README.md` there are byte-identical to `origin/main` (sha1 checked). The folder is **untracked**, in a clone whose HEAD is `7545850` (19 Sep); several other workers' files there are also untracked or modified.
  - Environment variables, names only:
    - `~/.editor-desk/env`: `DESK_SUPABASE_URL`, `DESK_SUPABASE_KEY`.
    - `/opt/data/bibi/api-keys.env`: `COMPOSIO_API_KEY`, `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `GHL_B2B_API_KEY`, `GHL_B2B_SUB_ACCOUNT_ID`, `FATHOM_API_KEY`, `DEEPSEEK_API_KEY`. All are set.
    - None of the optional settings is set, so their defaults apply: `WEBINAR_ZOOM_MEETING_ID` (88628953097), `WEBINAR_TYPEFORM_ID` (P1xP4r24), `WEBINAR_SINCE` (2026-09-01), `WEBINAR_JOIN_LINK` (webinar.maharamedia.com/live), `WEBINAR_OBJECTIONS_MODEL` (deepseek-flash), `WEBINAR_OBJECTIONS_PER_RUN` (8).
  - `python3 pull.py doctor` on the VPS today:
    - keys: set;
    - the tables answer;
    - meeting 88628953097 read via Composio: "starts 2026-09-17T17:00:00Z, status waiting";
    - warning: registration is off;
    - the four Zoom app scopes: ok;
    - survey: 0 responses;
    - HighLevel: 0 contacts tagged `webby-registered`;
    - Fathom: 6 calls in the last week;
    - DeepSeek key: set;
    - join link: leads to Zoom;
    - verdict: "ready, with 1 warning(s)".
- **Convex cron** "refresh the CEO cockpit". It runs every 15 min on media-buyer prod `adorable-seahorse-418` (`convex/crons.ts` → `health.runJob` "ceo refresh"), recomputing the webinar section and every other section.
- **B2B syncs** (Muhammed's, roughly every 15 min): meta, leads, ghl_calls, the closer form, Maqsam, Whop.

### Edge Functions and endpoints

- **`webinar-events`** (Triage): v4, ACTIVE, `verify_jwt=false`, updated 2026-09-23 15:06:57 UTC.
  - It accepts `Origin` from webinar.maharamedia.com, `mahara-webinar(-*).vercel.app` and localhost, and answered the live origin's preflight today with 204. A full POST was not tried, because it would write a row.
  - It writes at most 20 events per request and 120 per minute per IP (per running instance). It drops bot user agents, and caps the body at 32 KB.
  - It was deployed through the management API (`functions/deploy`); no Supabase CLI config exists in the repo.
- **B2B `lt-events-ingest`**: unused. It accepts only training.maharamedia.com, which does not resolve (session record, 2026-09-23).
- **`webby-live-training.vercel.app`**, not in this repo:
  - `/api/register` (POST; W1's webhook) writes Webinar Datetime and Webinar Round and books the Live Training appointment;
  - `/api/survey` (POST, a webhook from Typeform) tags `webby-survey-done`;
  - `/api/health` reported the values in §2, step 3.

---

## 5. Every metric

### 5a. The list that was promised (20 groups)

On 2026-09-23 Aziz asked for "the list of all the metrics we're going to track". The written form of the answer is the `tracking` array in `convex/ceo/adapters/webinar.ts`: 20 groups, reported against in session record `…T180000Z`. The chat answer itself is not saved anywhere I could find. The status column is what production shows now (from `cockpit_sections`): 1 live, 18 waiting, 1 missing.

| # | Stage | Group | Production status |
|---|---|---|---|
| 1 | 1 | Spend, impressions, clicks, link clicks, CTR | waiting |
| 2 | 1 | Reach and frequency | waiting |
| 3 | 1 | Landing page visitors, page conversion, form started and sent | waiting |
| 4 | 1 | Registrations and cost per registration | waiting |
| 5 | 1 | Registration source down to the ad | waiting |
| 6 | 1 | Qualification: yearly profit, years in the market, type of work | waiting |
| 7 | 1 | Days between registering and the session | waiting |
| 8 | 2 | Reminders sent, delivered, opened, clicked | waiting |
| 9 | 2 | Calendar-add clicks | waiting |
| 10 | 2 | Join-link clicks from the reminders | waiting |
| 11 | 2 | Attendees, show rate, on-time rate | waiting |
| 12 | 2 | Attendees tied to a registrant (show rate by lead time and by ad) | **missing** |
| 13 | 3 | Watch time, retention curve, presence at each pitch, drop-offs | waiting |
| 14 | 3 | Chat, polls, Q&A, the pitch-1 "drop a 1" count | waiting |
| 15 | 4 | Pitch link clicks and bookings, per pitch | waiting |
| 16 | 4 | Calls booked, while live and after | waiting |
| 17 | 4 | Post-event survey completions | live (it means the survey is being read; there are 0 responses) |
| 18 | 5 | Call held or no-show, close, contract value, cash | waiting |
| 19 | 5 | Speed to first contact after registering | waiting |
| 20 | 5 | Objection category | waiting |

### 5b. Every number, one line each

Statuses:

- **live**: wired end to end and checked today. It shows n/a until there is a first spend, registrant or session.
- **partial**: wired, but a defect or a missing input will make the number wrong or incomplete.
- **not connected**: nothing can produce the number today.

All HighLevel-based numbers also need W1 published. All reminder numbers also need W2 and the API token (§7).

"`adapter`" below means `webinar.compute` in `convex/ceo/adapters/webinar.ts`.

| # | Metric | Computed in | Status and reason |
|---|---|---|---|
| 1 | Spend per round | `adapter` `SPEND_SQL` → `traffic.spend` | live. No webinar-named campaign has ever spent. |
| 2 | Impressions | same → `traffic.impressions` | live |
| 3 | Clicks and CTR; link clicks and link CTR | same → `traffic.clicks/ctr/linkClicks/linkCtr` | live |
| 4 | Reach and frequency, deduplicated per round | `frequency.ts` `readInsights`, called per round in `adapter` | live. Not cached: one Meta call per round on every 15-minute refresh. |
| 5 | Registrations | `JOURNEY_SQL` (`webbyLead`), grouped by `roundOf` | partial. W1 is a draft, so nobody gets tagged. A repeat registrant goes to the alphabetically last round tag (§6.2). |
| 6 | Cost per registration, plus the kill-rule chip | `adapter` `per(totalSpend, registrations)`; `WebinarFunnel.tsx` `Headline` | live |
| 7 | Registrations tied to an ad | `registration.withAdId` (B2B `leads.ad_id`) | partial. Needs `utm_content={{ad.id}}` on every ad URL (not confirmed). |
| 8 | Repeat registrants (two round tags or more) | `registration.repeat` | live |
| 9 | Days between registering and the session (0–1, 2–3, 4–7, 8+) | `registration.leadDays` | live. Accurate to the day only, since Webinar Datetime has no time. |
| 10 | Landing page visitors, sessions, share on phones, visitors from an ad | `webinarPage.ts` `pageStats` (visitors from `COLLECTED_SQL`) | partial. Visitors are placed in a round by comparing their first visit with a session time of midnight UTC (§6.1). Pitch-page-only visitors create a phantom "Next session" round (§6.4). |
| 11 | Page conversion (HighLevel registrations ÷ page visitors), per round and per ad | `WebinarFunnel.tsx` `stages()`; `adapter` `ads` loop | live, but inherits 10 |
| 12 | Form seen, started and sent; register-button clicks | `pageStats` `formView/formStart/formSubmit/ctaClick` | live |
| 13 | Registered on the page (thank-you views, the second source for HighLevel's count) | `pageStats.thankYou` | partial. Only `origin_host = webinar.maharamedia.com` counts. If the GHL form redirects to `mahara-webinar.vercel.app`, these events are dropped. The redirect target was not verified. |
| 14 | Read to the end or halfway; median time on page; testimonial plays | `pageStats` `scroll50/75/100`, `secondsMedian`, `videoPlays` | live |
| 15 | Qualified registrations; cost per qualified registration | `adapter` `verdictOf`: `roas-*` tag, else survey `profit_min >= QUALIFIED_PROFIT` | live |
| 16 | Booking-form verdict (qualified, unqualified, not ready) | `qualification.booking` | live |
| 17 | Survey profit bands | `qualification.bands` | live |
| 18 | Years in the market, type of work | stored in `cockpit_webinar_forms.years_band/work_type` | not connected. Stored but never read or shown. The survey does not ask role or city. |
| 19 | WhatsApp reminders sent, delivered, read and failed; registrants who read one | `webinarFollowUp.ts` `reminderStats` | partial. The reader works, but W2 is a draft and no appointment can be booked, so nothing would be sent. |
| 20 | SMS and email sent; SMS delivered | `reminderStats` | partial (same reason as 19) |
| 21 | Email opens and clicks | — | not connected. They live in Kit and no reader exists. The Kit key custom value now looks like a real key; its validity was not checked. |
| 22 | Per-reminder table (14 WEBBY steps) | `reminderStats.steps` via `pull.py` `step_of` | partial. Matching depends on each message still containing its Arabic fragment in `STEPS`. Edited copy stops matching. |
| 23 | Calendar-add clicks, over thank-you visitors | `pageStats.calendarAdd` | live. Same origin caveat as 13. The calendar link still says 17 Sep. |
| 24 | WhatsApp group button presses | `pageStats.whatsapp` | not connected. The button still points at `[WHATSAPP_LINK]`. Presses are recorded with the label `placeholder` and raise a warning note. |
| 25 | Welcome video watched to three quarters | `pageStats.thankYouVideoWatched/thankYouVideo` | live |
| 26 | Join-link clicks before and after the start (`/live`) | `pageStats.joinBefore/joinAfter` (window: session − 24 h to + 3 h) | partial. With a midnight-UTC session time, the window ends 06:00 Kuwait on the day, so clicks at the real 20:00 start are missed (§6.1). |
| 27 | Attended: people in the room, our team left out | `webinarRoom.ts` `roomOf.attendees`, matched to the round when the Zoom start is within −2 h to +4 h of `sessionAt` | partial. A 20:00 Kuwait start is 17 h after `sessionAt`, so the session will not attach. It shows as a separate "Zoom session" round with a warning (§6.1). |
| 28 | Show rate (attended ÷ registered) | `showUp.showRate` | partial (as 27) |
| 29 | On time: first join within 3 min of the scheduled start | `roomOf.onTime` (the reference is the round's `sessionAt`) | partial (as 27) |
| 30 | No-shows (the `webby-noshow` tag) | `JOURNEY_SQL` `noshow` | not connected. Nobody tags; tagging fires W4b and needs Aziz's yes. |
| 31 | Attendees tied to a registrant | `showUp.matched` | not connected. Zoom registration is off (`approval_type` 2), so a guest carries only a display name. |
| 32 | Missed it, booked anyway (no-show salvage) | `showUp.salvage` | not connected (needs 31) |
| 33 | Show rate by lead time | `showUp.showRateByLead` | not connected (needs 31) |
| 34 | Average and median watch time, rejoins merged | `roomOf.watchAvgMin/watchMedianMin` | partial (as 27) |
| 35 | Attendance by minute (curve), peak and peak minute | `roomOf.curve/peak/peakMinute`; `RoomCurve` | partial (as 27) |
| 36 | Retention at pitch 1 and pitch 2 (present ÷ peak) | `roomOf.pitches`. Pitch 1 is the densest 3 minutes with ≥3 "1" chat lines, unless set on screen; pitch 2 only when set (`webinarPitch.set`). | partial (as 27) |
| 37 | Three biggest drop-offs (the last 2 minutes are left out) | `roomOf.drops` | partial (as 27) |
| 38 | Stayed to the end (in the room 2 minutes before it ended) | `roomOf.stayToEnd` | partial (as 27) |
| 39 | Chat lines, people who chatted, lines per attendee, "drop a 1" count at pitch 1 | `roomOf.chat` (the cloud recording's chat file; recording is on) | partial (as 27) |
| 40 | Poll answers and Q&A questions | `roomOf.polls/qa` via the Zoom app (scopes confirmed) | partial (as 27) |
| 41 | Pitch link clicks per pitch (`/p1`, `/p2`) | `pageStats.pitch1Clicks/pitch2Clicks` (window: session − 1 h to + 48 h) | live. This window still covers the evening even with a date-only session time. |
| 42 | Bookings by pitch link | `pitchBookings` (`utm_content=pitch1/2` in the contact's first or last attribution URL) | live. A later tracked link overwrites HighLevel's last attribution. |
| 43 | Calls booked (intro, demo) after registering | `conversion.booked/bookedIntro/bookedDemo` | live |
| 44 | Booked while live (from the start to 3 h after) | `conversion.bookedWhileLive` | partial. With a date-only session time the window is 03:00–06:00 Kuwait (§6.1). |
| 45 | Registrant to booked | `conversion.registrantToBooked` | live |
| 46 | Attendee to booked | `conversion.attendeeToBooked` | not connected (needs 31) |
| 47 | Cost per booked call | `conversion.costPerBooked` | live |
| 48 | Survey on the thank-you page: started and sent | `pageStats.surveyStart/surveySubmit` | live (origin caveat as 13) |
| 49 | Survey completions (registrants who answered, by tag or by a tied response) | `conversion.surveys` | live. Typeform is read hourly; 0 responses. The `webby-survey-done` tag route (Typeform → `/api/survey` → W5) is not set up (`typeformSecretSet:false`, W5 a draft); the cockpit does not need it. |
| 50 | Calls held out of calls due; booked to held | `sales.held/due/bookedToHeld` | live |
| 51 | Closes and close rate (closes ÷ held) | `sales.closes/closeRate` | live |
| 52 | Contracted and cash; the share of cash confirmed on Whop or the bank | `sales.contracted/cash/cashConfirmed` | live. Tap is not checked, the same as in the call funnel. |
| 53 | CAC, cash ROAS, contracted ROAS | `sales.cac/roasCash/roasContracted` | live |
| 54 | Attendee to close | `sales.attendeeToClose` | not connected (needs 31) |
| 55 | Speed to first contact after registering (median minutes; never contacted) | `JOURNEY_SQL` `first_contact` → `sales.firstContactMedianMin/neverContacted` | live. Maqsam's newest row is 2026-09-20. |
| 56 | Objection categories (calls tagged, calls with none, per category calls/raised/handled) | `webinarFollowUp.ts` `objectionStats` | partial. Fathom is read with one key (Aziz's recordings plus what is shared), not per rep. Using DeepSeek here needs Aziz's confirmation (§7). |
| 57 | Every-session roll-up: registered, repeat, show rate, missed-and-booked, booked, closed, cash, CAC, ROAS | `WebinarFunnel.tsx` `RollUp` | inherits the rows above |
| 58 | Per ad and round: spend, CTR, visitors, registered, page conversion, cost per registration, came, booked, closed, cash | `adapter` `ads` loop; `WebinarFunnel.tsx` `Ads` | partial. Needs `utm_content={{ad.id}}`. "Came" is not connected (31). |
| 59 | Worker health: last read of Zoom, survey, HighLevel and Fathom; stale after 3 missed runs | `adapter` `runs`/`stale`; `Collector` | live. All four were read OK at 08:23 UTC today. |
| 60 | What the webinar took out of the call funnel, per window | `growth.ts` `windowsSql` `wb_*` + `withoutWebinar` → `FunnelWindow.webinarOut`; `FrontendTab.tsx` `webinarOutNote` | live (all zero) |
| 61 | Targets | `WEBINAR_TARGETS` | constants from the brief |

---

## 6. What is missing, ordered by value

1. **The session start time. This breaks every show-up and room number at the first session.**
   - The cause: `/api/register` writes Webinar Datetime (a GHL DATE field) as `YYYY-MM-DD`: `CFG.webinarStart.slice(0, 10)` in `api/register.js` inside the zip. `sessionAt` in `webinarSql.ts` turns that into 00:00 UTC, which is 03:00 Kuwait; the doctor shows the Zoom meeting's own start as 17:00 UTC (20:00 Kuwait).
   - What breaks:
     - the Zoom session never attaches to its round (`adapter`: `sessionAt − 2 h` to `+ 4 h`);
     - on-time is measured against 03:00 Kuwait;
     - the join-click window (`pageStats`) ends 06:00 Kuwait and misses the start;
     - booked-while-live counts 03:00–06:00 Kuwait;
     - the round turns "held" at 03:00 Kuwait;
     - landing visits made on the session day fall into "Next session";
     - `pull.py` `session_of`/`reminders_due` miss the hourly reminder window.
   - The fix: derive a real start time. Options:
     - (a) the date plus the Zoom meeting's scheduled time of day (the worker already reads `meeting.start_time`; it could store it in the zoom run's `counts`, which is jsonb, so no migration);
     - (b) a single configured start time of day, `20:00 Asia/Kuwait`;
     - (c) match Zoom sessions by the Kuwait calendar day when the value has no time.
   - Files: `convex/ceo/webinarSql.ts`, `convex/ceo/adapters/webinar.ts`, `hermes/webinar-pull/pull.py`, `scripts/webinar.test.ts`, `hermes/webinar-pull/test_pull.py`, `SOURCES.md`.
2. **Repeat registrants are placed in the wrong round.**
   - The cause: `JOURNEY_SQL` picks the round tag with `order by t desc limit 1`, which sorts month names alphabetically. Checked on B2B today: `{sep-2026, oct-2026, nov-2026}` picks `webby-sep-2026`.
   - The fix: order by `to_date(substring(t from 7), 'mon-YYYY') desc`, or pick the tag whose month matches the Webinar Datetime. Add a test.
   - File: `convex/ceo/adapters/webinar.ts`.
3. **Launch blockers are invisible, and the empty state is wrong.**
   - The screen says numbers "fill in on its own", but they cannot while the workflows are drafts and `/api/register` has no token.
   - Next step: extend `pull.py doctor` and the hourly zoom run to record:
     - the WEBBY workflow statuses (`GET /workflows/?locationId=`, names and statuses only);
     - the `webby-live-training` `/api/health` fields;
     - whether the Zoom start, `WEBINAR_START` and the page's `COUNTDOWN_ISO` agree.
   - Keep this in `counts` (no migration). Have the adapter add plain sentences to `notes` and `tracking`, and have `WebinarFunnel.tsx`'s `EmptyState` say what to do next.
   - Files: `pull.py`, `test_pull.py`, `adapters/webinar.ts`, `WebinarFunnel.tsx`, `RUNBOOK.md`.
4. **Pitch-page visitors create a phantom "Next session" round.**
   - The cause: `COLLECTED_SQL` builds visitors from `page <> 'live'`, so `page = 'pitch'` rows count. Someone who only clicks `/p1` during a session gets a first visit after the session start, lands in `NEXT`, and a "Next session" round appears. Rounds without a date sort first, so that phantom becomes the default round on screen.
   - The fix: exclude `'pitch'`, which is counted separately in `pitches`. Extract round assignment into a pure function and test it.
   - File: `convex/ceo/adapters/webinar.ts`.
5. **Tie attendees to registrants.** This unlocks rows 31–33, 46, 54 and "came" in 58.
   - `pull.py` already reads Zoom registrants when registration is on (`approval_type` 0 or 1). It carries each registrant's email, and a custom question whose title contains "contact", onto the attendance rows.
   - What is missing: creating a Zoom registrant per HighLevel contact, and putting that person's own join URL into the reminders. The VPS Zoom app has `meeting:write:registrant:admin`.
   - Blocked on Aziz's decision (§7). Touches `/api/register` (outside this repo) or a new step in `pull.py`, a GHL custom field for the join URL, and the W2 message copy.
6. **Objections cover only one Fathom key.**
   - `Fathom.meetings` in `pull.py` asks without `recorded_by[]`, so it sees only Aziz's recordings plus what the team shares.
   - The sales desk already asks per rep: `hermes/sales-desk/desk/fathom.py` and `recordings.py`, for seats in `cockpit_sales_people` with a `fathom_email` (0 of the 2 seats have one today).
   - Settle the DeepSeek question first (§7).
   - Files: `pull.py`, `test_pull.py`, `README.md`, `RUNBOOK.md`.
7. **Thank-you events from the vercel.app host are dropped.**
   - `mahara-webinar.vercel.app` serves the same pages with the tracker, and the Edge Function accepts it, but `COLLECTED_SQL` counts only webinar.maharamedia.com.
   - Check where the GHL form redirects after submit. The operator doc told the reader to set it to `mahara-webinar.vercel.app/thank-you.html`. Either repoint the form (Aziz, in GHL) or count that host as live.
   - File: `adapters/webinar.ts`.
8. **Email opens and clicks from Kit.**
   - No reader exists. If Aziz confirms the key works, add a Kit reader to `pull.py` (sequences K1/K2/K3 and the broadcast stats) and extend `reminderStats`.
   - A new table needs a migration with row security and grants in the same file.
9. **The webinar is missing from `cockpit_metric_definitions/values`.**
   - `metricRegistry.ts` has no webinar extractor, so none of these numbers land as rows. Only the whole payload does, in `cockpit_sections`.
   - Files: `convex/ceo/metricRegistry.ts`, `SOURCES.md`.
10. **Smaller items.**
    - Years in the market and type of work are stored but never shown (`adapters/webinar.ts`, `WebinarFunnel.tsx`).
    - The worker log is silent by design: log one summary line per run, or change the RUNBOOK advice.
    - Cache `readInsights` per round (`frequency.ts` already keeps windows for 3 h).
    - Tracking row 17 says "live" with 0 responses.
    - The layout harness has no webinar fixture: put a synthetic `webinar` section into `tmp/harness/today.json` to see the stages with numbers.

---

## 7. Waiting on Aziz

Decisions and credentials only he can give. Items marked "new" were found today and are not in the earlier notes.

1. **The next session date.** It drives four changes:
   - Move the Zoom meeting, or make a new one. It is a one-time meeting scheduled for 17 Sep that never started; check Zoom still lets it be rescheduled. A new meeting id means changing `WEBINAR_ZOOM_MEETING_ID` on the VPS, `sites/webinar/live.html` (three places) and the GHL custom value "Live Training Link".
   - Set `WEBINAR_START` on the `webby-live-training` Vercel project.
   - Change the landing and thank-you pages: `COUNTDOWN_ISO`, the date chips and the calendar link. The agent can make this edit once the date is given; any Arabic line is written under the aziz-kuwaiti-voice skill.
   - Schedule the Kit broadcasts, and give the new round its tag (for example `webby-oct-2026`) in W1's first step and in `WEBINAR_ROUND`.
2. **New: publish W1, W2, W4a, W4b, W5 and W6.** They are drafts. Publishing them sends messages to real people, so it is his call, after the stress test in his operator doc.
3. **New: a HighLevel Private Integration token as `GHL_TOKEN`** on the `webby-live-training` Vercel project, which needs contacts, calendars/events and custom-fields scopes. `/api/health` says `ghlTokenSet:false`. Also the Typeform secret and webhook for `/api/survey` (`typeformSecretSet:false`).
4. **Zoom registration with personal join links**, so attendees tie to registrants. This changes the attendee experience and the reminder links.
5. **The WhatsApp group invite link** for the thank-you page (`[WHATSAPP_LINK]`).
6. **Kit.** The "Kit API Key" custom value (`q0hxLwannXj0arDT5bwF`) now has the shape of a real v4 key: `kit_` plus 32 hex characters (only the shape was checked). Confirm it is valid, and whether email opens and clicks should be read.
7. **Meta.**
   - Settle the ad account: writes were refused on 2026-09-22.
   - Put "Webinar" or "Training" in every webinar campaign's name, and avoid "retarget", "remarket" and "hammer them" in the same name (see §8).
   - Put `utm_content={{ad.id}}` on every ad URL.
8. **New: DeepSeek for objection transcripts.**
   - The tagger (built 2026-09-23) sends each matched sales call to `deepseek-flash`. The call is `https://api.deepseek.com/chat/completions`, temperature 0, JSON output, `max_tokens` 12,000 with a retry at 24,000. It carries:
     - the system prompt: fixed instructions and the category list;
     - the user message: "The Mahara rep on this call is {Fathom recorded_by name}." followed by the transcript. The transcript is up to 60,000 characters, one line per turn, in the form `[timestamp] {speaker display name}: {text}`. So it includes the prospect's name as Fathom displays it, and anything said on the call.
   - It does not send the contact's email, phone, HighLevel id, the meeting title or the invitee list.
   - It runs only for calls matched to a registrant by invitee email, recorded after they registered, with a sales title (the `NOT_SALES` filter), and at most 8 a run.
   - With 0 registrants it returns before calling Fathom or DeepSeek. In production it has sent nothing. The README records two real calls sent as a test on 2026-09-23; nothing was stored.
   - On 2026-09-24, for the sales cockpit, Aziz decided "No lead data to DeepSeek" (`SALES_COCKPIT_PLAN.md` §7.3). He needs to say whether the webinar tagger stays on DeepSeek, moves to the VPS OpenAI key like the sales desk, or strips names first. Do not extend DeepSeek use beyond this tagger.
9. **Attendance tags.** Tagging `webby-attended` or `webby-noshow` in HighLevel fires W4a or W4b (once published). Get his explicit yes each time; never do it on your own.
10. **Where the GHL form redirects after submit** (§6.7). This is checked and changed in the HighLevel UI.
11. **Survey fields.** Whether the survey should ask role and city, which the brief names; this is a change to the form.

---

## 8. Rules and traps

### Repo rules that apply (`CLAUDE.md`)

- **Supabase first.** Cockpit tables live in Creative Triage with the `cockpit_` prefix. B2B `flwboeijllbtrufxkhts` is **read-only**: no writes, no functions, nothing.
- **New tables** come with row security and the matching grant in the same migration; the service key is the only door.
- **Every action is gated on the server.** `webinarPitch.set` goes through `requireCeo`. Every write leaves an audit row (`ceoAudit`). Every external call from Convex goes through the helpers in `tools.ts`: `sql()` and `graph()` already do. The Python worker records each run in `cockpit_webinar_pulls` instead.
- **Workers**:
  - keys are read by name;
  - they have a `doctor`, tests, a cron under `flock`, and a RUNBOOK row;
  - the UI says what is missing in a plain sentence;
  - missing is never zero: the webinar screen shows n/a.
- **Numbers** are verified against a second source before they ship, and the note beside each one says where it came from and what it leaves out. Update `SOURCES.md` whenever a definition changes.
- **Shipping**: ship with `scripts/ship.sh <app>`, verify on production, and record the session in mahara-context `shared/sessions/`.
- **Design**:
  - Before a new or reshaped screen, follow `mahara-context/skills/frontend-design/SKILL.md`: a design plan first.
  - Use the CEO kit (`SectionCard`, `StatTile`, `StatusChip`, `EmptyState`, `format.ts`), Geist and `--mahara-teal`. Do not add a second palette.
  - Interface copy is plain and active, and empty states say what to do next.
  - Any Arabic line is written under `mahara-context/skills/aziz-kuwaiti-voice`.

### Aziz's rules for this work

- Never tag `webby-attended` or `webby-noshow` in HighLevel without his explicit yes (it fires W4a/W4b messages).
- No lead personal data goes to DeepSeek beyond the objection tagging already built (§7.8).
- Secrets are read by name and never printed. To list names in an env file: `grep -oE '^[A-Z][A-Z0-9_]*=' file`.
- Never match people by name. A Zoom `name:` person key is only used for counting.

### How to ship

- **CEO cockpit:** `scripts/ship.sh media-buyer`, from a commit that is on GitHub main (`require-github-main.sh` refuses anything else). It runs, in order:
  1. `check-shared.sh`;
  2. the webhook, social, billing and **webinar** tests;
  3. biome lint and the typecheck;
  4. `convex deploy` to `adorable-seahorse-418`;
  5. the Vite build and the Vercel deploy (the CLI, or the Composio fallback when the CLI has no login);
  6. a check that the live bundle changed;
  7. `smoke:check`, which DMs Aziz on Slack if anything is broken. `SHIP_SMOKE_READ_ONLY=1` runs the local check instead.

  Then verify on production:
  - `select ok, computed_at, jsonb_array_length(payload->'rounds'), payload->'notes' from cockpit_sections where key='webinar'` in Triage must show a `computed_at` after the deploy and `ok = true`;
  - only Aziz can sign in to `/ceo`, so for layout use the harness.
- **Site:** `scripts/vercel-deploy-composio.sh sites/webinar`, from a commit on GitHub main.
  - It needs `sites/webinar/.vercel/project.json` (the content is in `sites/webinar/README.md`) and the `composio` CLI.
  - Afterwards, `curl -s https://webinar.maharamedia.com/ | grep mm-track` and compare the live files with `origin/main`.
  - Never deploy `~/mahara-webinar`: it would bring back the old pages.
- **Edge Function `webinar-events`:** there is no Supabase CLI setup. Deploy through the management API: `POST https://api.supabase.com/v1/projects/bldgtotkfmhoxmlzowdx/functions/deploy?slug=webinar-events`, multipart with metadata `{entrypoint_path:"index.ts", name:"webinar-events", verify_jwt:false}` plus the file, the way `convex/ceo/edgeDeploy.ts` does it for `tap-charges-sync`. Keep `verify_jwt` false, then check `GET /v1/projects/{ref}/functions` shows a new ACTIVE version.
- **Migrations:** add a file in `supabase/migrations/`, and apply it to Triage through the management API (for example `ceo/migrate:applySql`, which refuses destructive statements).
- **Worker:**
  - The VPS clone is stale and the folder is untracked. Do **not** `git pull` or reset there: other workers' uncommitted files live in the same clone.
  - Copy the changed files into `~/mahara-cockpits/hermes/webinar-pull/` and compare their sha1 with `origin/main`.
  - Run `python3 -m unittest test_pull` and `python3 pull.py doctor` there, with the env loaded as in the cron line. The next run at minute 23 picks up the new code.
- **Mac checkouts:** `/Users/abdulazizwaheedi/mahara-cockpits` is shared by concurrent sessions. Never reset, rebase or check out there; it may also lag main. Work in a worktree made from `origin/main` and push `HEAD:main`.

### How to run the tests

- `cd apps/media-buyer-cockpit && bun test scripts/webinar.test.ts`: 23 pass. Also `bun run typecheck` and `bunx biome check --line-ending=auto convex src`.
- `cd hermes/webinar-pull && python3 -m unittest -v test_pull`: 29 pass. Python 3.9 or later works; the VPS has 3.12.
- Site preview: the `.claude/launch.json` entry `webinar-site` (port 5188). Events from localhost are accepted by the function but never counted.
- `python3 pull.py --dry-run` writes nothing to Supabase, but it still calls Zoom, Typeform, HighLevel and Fathom, and **still sends transcripts to DeepSeek** when registrants have matched calls.

### Traps found in the code and the records

**The HighLevel side**

- **HighLevel sits behind Cloudflare, which refuses Python's default user agent (error 1010).** Send a browser user agent (`BROWSER_UA` in `pull.py`). The worker sends the same user agent to Fathom.
- HighLevel allows 100 calls per 10 s per sub-account. `pull.py` waits 0.15 s between calls and retries a 429 after 10 s.
- The public HighLevel API cannot create or edit workflows. `GET /workflows/?locationId=` does return each workflow with its status.
- HighLevel keeps only the last attribution URL, so a booking made through another tracked link loses its pitch.

**Zoom**

- Zoom guests carry no email, and their `user_id` is a per-meeting slot, not a person. With registration off, attendance and the curve are exact but nobody can be tied to a registrant. The brief forbids matching by name.
- Composio's Zoom connection answers 4711 (scopes missing) for past instances, polls and Q&A; the VPS Zoom app covers those.
- The chat exists only in the cloud recording's chat file, which comes in two layouts; `parse_chat` handles both. Sessions are found through their recordings and are re-read every hour until marked complete (ended over 30 min ago and chat read; 6 h without a recording; 48 h in any case).
- A session UUID that starts with `/` or contains `//` has to be URL-encoded twice (`uuid_path`).

**Dates and rounds**

- The Webinar Datetime field is a DATE with no time: see §6.1.
- The round tag is picked alphabetically: see §6.2.
- The round comes from the `webby-mmm-yyyy` tag, else from the Webinar Round field. W1 hard-codes `webby-sep-2026`, so a new round needs W1's first step edited. Otherwise the new round's registrants join September's round.

**Campaign names**

- The campaign-name regex contains the plain word "training", so any campaign with "training" in its name moves from the call funnel to the webinar.
- A name containing "webinar" together with "retarget" is classed as retargeting by B2B `b2b_campaign_type`, which the call funnel's retargeting spend does not subtract, while the webinar also counts it: double counting across the two funnels.

**The page events and the room**

- Page events: only origin webinar.maharamedia.com counts (see §6.7). A visitor who blocks site storage counts again on each visit, and ad blockers can stop events altogether.
- The survey's lowest profit band is written in Arabic («أقل من $100,000») and parses to 0. The screen renames it "Under $100K".
- The room: our own team is left out (Zoom's `internal_user` or an @maharamedia.com email). A false start, with only the host in the room, does not stretch the session. Presence is counted at the middle of each minute, capped at 300 minutes.

**Fathom and DeepSeek**

- Fathom: the B2B copy (`fathom_calls`) has been in error since 2026-09-12, so the worker reads Fathom directly. Client-service calls are left out by title (`NOT_SALES`: launch, check-in, onboarding, review, pulse and others).
- DeepSeek models are reasoning models: reasoning tokens count against `max_tokens`, and the answer is in `message.content`. `pull.py` also falls back to `reasoning_content`.

**Logs, cost, dependencies**

- The worker log is empty by design (`--quiet`); read `cockpit_webinar_pulls` instead.
- The Convex usage limits have taken the cockpits down before, on 2026-09-16 and 2026-09-23. Do not add heavy reactive queries. The webinar section's reads run in Supabase, but its payload is stored in Convex.
- B2B `lt_*` tables and `lt-events-ingest` belong to Muhammed. They are empty and not needed; do not write to them.

---

## 9. First three tasks

### Task 1. Make the session time and round assignment correct (§6.1, §6.2, §6.4)

Done when:

- A Webinar Datetime of `YYYY-MM-DD`, and one of epoch milliseconds at midnight, both give the round a real start time. The rule is written in `SOURCES.md`. With that start:
  - a Zoom session starting 20:00 Kuwait that day attaches to the round, not to an orphan "Zoom session" round;
  - on-time, the join-click window, booked-while-live, visitor-to-round placement and `pull.py reminders_due` all use it.
- A repeat registrant tagged `webby-sep-2026` and `webby-nov-2026` sits in November's round.
- A visitor who only opened `/p1` or `/p2` creates no "Next session" round.
- New tests cover each case: pure functions in `scripts/webinar.test.ts`, `reminders_due`/`session_of` in `test_pull.py`. Both suites pass.
- `scripts/ship.sh media-buyer` is green, and the Triage `cockpit_sections` row `webinar` shows `ok` with a `computed_at` after the deploy.
- The worker files are copied to the VPS with sha1 equal to `origin/main`, and `pull.py doctor` says "ready".
- The session is recorded in mahara-context `shared/sessions/`.

### Task 2. Make launch blockers visible, and fix the empty state (§6.3)

Done when:

- `pull.py doctor` and each hourly zoom run record, in `counts` (no migration):
  - each WEBBY workflow's status, by name;
  - the `webby-live-training` `/api/health` fields (`ghlTokenSet`, `webinarStart`, `round`, `typeformSecretSet`);
  - whether the Zoom scheduled start, `WEBINAR_START` and the live page's `COUNTDOWN_ISO` agree and are in the future.
- The adapter turns each blocker into a plain sentence in `notes` and `tracking` (for example "W1 is a draft in HighLevel, so no registration can be counted").
- `WebinarFunnel.tsx`'s `EmptyState` names the next step instead of "fills in on its own".
- Tests exist, it is shipped, and production's `cockpit_sections.payload->'notes'` shows the sentences while the workflows are drafts.
- No write goes to HighLevel, Zoom or Vercel.

### Task 3. Settle and fix the objection tagger (§6.6, §7.8)

Done when:

- Aziz has answered the DeepSeek question and the answer is recorded in `hermes/webinar-pull/README.md`. If it is "no lead data to DeepSeek", switch the model to the VPS OpenAI key the sales desk uses, or strip speaker names, as he chooses.
- `Fathom.meetings` asks once for the key owner and once per seat with a `fathom_email` (`recorded_by[]`), paced and retried like `hermes/sales-desk/desk/fathom.py`.
- Tests cover per-rep collection and the what-is-sent contract (no email, phone or contact id in the prompt).
- The files are copied to the VPS, `doctor` is green, and a manual `python3 pull.py objections` run with 0 registrants logs "no registrant has an email yet" and makes no Fathom or DeepSeek call.
- The RUNBOOK row is updated.

---

## 10. What this could not verify

- **The brief itself.** Tracking brief `1Iu8py7X…` answered HTTP 401. Targets and stages are taken from the code, which cites its sections.
- **The promised list as given in chat.** Aziz's "list of all the metrics" answer on 2026-09-23 is not stored anywhere. The written form is the 20-group `tracking` list (§5a).
- **Page events end to end.** Whether a real browser visit today would reach `cockpit_webinar_page_events`. The function is ACTIVE and answers preflight, but a POST would have written a row. The Supabase logs API query failed: the table names changed.
- **The form's redirect.** Where the GHL form "Webinar Opt In" redirects after submit, and whether its embed passes the UTM values into HighLevel attribution.
- **The survey's hidden fields.** Whether the Typeform live embed (`01KZ3P3F…`) or the post-session survey link fills the hidden `user_id`.
- **The deployed registration API.** Whether the deployed `webby-live-training` code equals the 8 Sep zip. Its health output has the same fields, and the zip is the only source found.
- **The Kit key.** Whether it is valid; only its shape was checked.
- **The Meta ad account today.** Not re-checked; the refusal is from 2026-09-22.
- **Zoom's expiry rule.** Whether one-time meeting 88628953097 can still be rescheduled after its 17 Sep date, given Zoom's expiry rules for one-time meetings.
- **The B2B copy.** Whether it copies every HighLevel contact. It holds untagged contacts, but no webinar registrant has ever existed to prove it.
