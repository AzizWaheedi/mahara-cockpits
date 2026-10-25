# Forms in the cockpit: the build plan

Plan, 2026-10-25, worktree `forms-1025` (origin/main `d2c9817c`). It is built
from the eight read-only maps in `docs/forms/maps/`, their follow-ups
included, and revised once after review (section 7). The build sessions
follow it as written. Where a map offered options, this plan picks one.

Sources are cited by map and section:

| Tag | Map |
|---|---|
| KP | `maps/kickoff-path.md` |
| BP | `maps/blueprint-path.md` |
| SL | `maps/slack.md` |
| MI | `maps/make-inventory.md` |
| TI | `maps/typeform-inventory.md` |
| CT | `maps/clickup-ticketing.md` |
| RF | `maps/repo-forms.md` |
| FA | `maps/fathom.md` |
| R | a read-only check made for this revision (section 7) |

Scenarios are named by Make ID, never by short number, because short numbers
collide (MI F, RF F). "Make 12" in prose means `8925654` only.

Standing rules for every session: the repo `CLAUDE.md` (Supabase-first, row
security and the grant in the same migration, every action gated on the
server, an audit row per write, every external call through a `tools.ts`
helper into a health ledger, missing is never zero, `scripts/ship.sh <app>`,
verify on production, a session note in mahara-context `shared/sessions/`),
and a design plan before any new or reshaped screen (section 4.7). Staff are
named by role in everything the team sees.

---

## 0. Decisions on one screen

| # | Decision | Why (source) |
|---|---|---|
| D1 | **Stage 1 comes first.** It has two shipped slices (1A today, 1B next) and one supervised proof run on the internal test card. Stage 2 **build** starts once 1A and 1B are shipped and the proof run passed. Stage 2 **cut-over** waits until one real kickoff notice and one real Blueprint notice have also posted. | The CEO's order; neither path has been proven end to end (KP §0, BP §1); kickoffs come about 1.5 a week and the Blueprint has 0 native presses |
| D2 | **The kickoff stays a Typeform embed until Stage 4.** Make `8925654` stays its only ClickUp writer. The cockpit adds the notice and fixes only. | Make `8925654` works on 7 of 7 cards (KP §4); the notice must not refire Make (KP §8.1) |
| D3 | **The Brand Blueprint is native only.** The old Typeform `oYZKtogO` path is retired: links removed in code in slice 1A, its webhooks and Make `9748311` off (A1) once the first native close has settled `done`. | Partials on the old link created launch tasks with no dedupe in September (MI F.2); then the native press refuses (BP §7.1); BP §5 step 4 |
| D4 | **One Slack outbox, `cockpit_slack_notices`.** Database triggers queue it, a sweep backs them up, and one Edge Function `cockpit-notices` sends it as mahara-club-bot. That includes the #media-general "Brand Blueprint completed" post. A post counts on Slack's receipt (1.3). An unknown is matched to a `Ref CN-` marker and never resent. | SL F3d (decided there; the other three outbox ideas are dropped) |
| D5 | **The Blueprint close writes ClickUp only.** `close_route` is fixed at `card_only`; the `slack` and `make` routes are removed from the settings function and the Settings screen. Its Slack posts are notices, so a Slack problem never sends a close to `reconcile`. The exact-text read-back in `cockpit-media-api/execute.ts:20` is still replaced, for the media buyer's request DM (S1). | The `slack` route adds only the #media-general step (`blueprint.ts:129-130`, R); the exact-text read-back fails on every real post (SL F2) |
| D6 | **Mentions by seat, not by card name.** Kickoff: the creative seat. Blueprint closed and a second kickoff: the CSM seat. A late card: the CSM seat and the systems manager. Offer locked: a thread reply, nobody tagged. | 33 of 70 cards name an inactive CSM or nobody; the mirror holds usernames, not emails (SL F4) |
| D7 | **The 1-1 call notes go native in Stage 2, filled from Fathom.** The cockpit picks the call and drafts the notes. The CSM picks DEFCON and priority and approves the client recap. Shadow is done by replaying past responses, so the CSM never fills two forms. | A Typeform cannot be prefilled with a transcript (FA §0.1); a live double path doubles every comment and grade (FA §9.5) |
| D8 | **Client WhatsApp from the cockpit goes through one VPS worker, `hermes/client-messages`,** on the ad-billing guard's WHAPI transport. The group comes from Client Data column F by card id and is refused when the card field differs. Nothing sends without the CSM's approval. The row is claimed before the send. | RF F.5; Make `9523861`'s race and re-arm traps (MI F.4.8) |
| D9 | **One forms backend:** registry `cockpit_forms`, store `cockpit_form_responses`, fan-out ledger `cockpit_form_effects`. The kickoff and the Brand Blueprint are registered and recorded there from Stage 2a. Delivery reuses three outboxes, each with one sender: the ClickUp writeback queue, the Slack notices and the client messages. **One named exception:** `cockpit-creative-api` stays the ClickUp writer for Blueprint presses, because its fenced, previewed plans already exist; its effects are recorded with `delivery = creative_outbox`. | RF §8, SL F3d; `outbox.ts:49-69` |
| D10 | **Client-facing forms become native public pages** at `forms.maharamedia.com/{token}` (`sites/forms` plus `forms-door/public`). Each link is per card, bilingual, Arabic first. | No client form's webhook is signed, and the per-card links stopped on 2026-09-12 (TI F2, F7) |
| D11 | **Lifecycle changes are the CSM's call.** A client page never writes Paused, Stopped or churn fields on submit. The CSM confirms, then the card changes. Ad holds stay the media buyer's. | Make `9805613` pauses on submit although the form promises a call first (RF F.3, TI F4); PAUSE-OFFBOARD.md |
| D12 | **Ticketing moves to the portal at `/requests`.** A Supabase request-type table sets the list, template and owner for each of the 31 types (3.3). ClickUp stays the board. | ClickUp rules leave 11 types unrouted and several lists unassigned (CT F1, F3, F8) |
| D13 | **One owner per effect at any time:** `make`, then `shadow`, then `cockpit`, set per form and effect (`form_key`, `effect_key`), with one cut-over window per effect group. Every native client message also waits on a live API read showing the old sender off (2.7). | RF §8.6; the kickoff is split between Make `8925654` (card, to Stage 4) and the recap (Stage 2) |
| D14 | **The New Client Form stays a Typeform embed.** The Client Card Info form is retired and never moved. | Five systems read the New Client Form (TI §3.7); the Card Info form collects card number and CVV (TI §3.10) |
| D15 | **AI drafts are optional helpers.** DeepSeek does internal extraction. A frontier model does judgment and the client's Arabic. Both go through `cockpit-media-api/model.ts`. With no key, drafts are off with a plain sentence, and every form still works by hand. | FA §9.4; memory deepseek-routing |
| D16 | **The build session carries out the CEO's switches.** On his yes it applies each Make, Typeform and ClickUp-setting change through the API (or the built-in browser where no API exists), reads it back and reports. Only logins, money, DNS and Slack invites go to him (5.2). | memory stop-asking |
| D17 | **Forms and routing are edited in the cockpit, never in code** (CEO, 2026-10-25: "the systems manager, me, or anybody can change who it's assigned to ... as well as editing any of the fields"). Every routing choice is a row an editor changes on a Settings screen: notice on/off, channel, who is tagged (a seat rule or named people), ticket list, template, owner, due date, and later every native form's questions. The editor gate is the CEO, admin seats (the systems manager), or a seat given the `forms_editor` role. Each change is an audit row with old and new value. A form's questions are versioned: a response keeps the version it was filled on, and the last version comes back with one press. A new channel or person must pass the doctor's check (bot is a member, the person resolves) before the change saves. | CEO ask 2026-10-25; section 4.8 |

---

## 1. Stage 1: kickoff and Blueprint submits work completely

### 1.1 Verified state today

**Kickoff `tG7dnxBn`**

| What | State | Evidence |
|---|---|---|
| Make `8925654` card writes | Work. 7 runs in 30 days, 7 ok, 13 operations each, all outcomes on 7 cards: handoff comment, Technical and Creative tasks, Blueprint link, status, map phase 4 | KP §2, §4; MI F.5 |
| Service Advertised `bab9a58b` | **Fails.** It is empty on all 7 cards. The field is a single-select drop-down with six options; the kickoff answer is multi-select, so `switch()` gets a list | KP §2; R: `clickup_get_custom_fields` on `901816559981` |
| Error handling | Make `8925654` has no error handlers. An error in [21] ends the run before [22] [23] [26] [25] | KP §2 |
| Second kickoff | **Runs everything again.** Shades on 10-07 and 10-08 got two comments, two task pairs and two phase 4 WhatsApps | KP §4 |
| Client recap (Make `9209179` index 1, fed by the `postcallsummary` webhook) | **Never reaches a client.** 7 kickoff drafts, 0 sent. The prompt has no kickoff input, so the draft is generic, yet it still posts an APPROVE card in #csm-general | KP §3.1, §3.4; MI F.3, F.4.8 #7 |
| Typeform ending | Promises "the client will receive their summary shortly", which is false | KP §3.1 |
| Slack "kickoff complete" | **Never existed** in any kept version of any scenario | KP F.0, F.2 |
| Cockpit kickoff window | Live, **never used**: 0 rows in `cockpit_csm_form_sends` | KP §6 |
| Card link and prefill | Kickoff Form Link `87d7d889` holds Make's prefilled `tG7dnxBn` link. The window's prefill reads it for fallback values and to undo the mirror's 4,000-character cut | `prefill.ts:176-197`; KICKOFF.md §2.2 rule 3 |
| One-card refresh | Unproven natively: one `trigger='one'` run ever, from 2026-10-05 | KP §6; SL F3a |
| Trail's last link | Opens the retired Blueprint Typeform | KP gap 4; BP §2.5 |
| Window copy | Says "Make is booking the Brand Blueprint". Make books nothing | KP gap 5; MI F.5 |
| Failure alarm | None. The guardian does not watch Make `8925654` | KP gap 3 |
| Status write | Make `8925654` [21] sets Brand Blueprint Booked with no forward-only filter | KP F.1.1 |
| Phase 4 WhatsApp delivery | Make shows only that [25] ran, not that the group got it | KP §9 |
| Security | Make `8922994` [25] holds a GitHub token in plain text, and that scenario has no error handler | KP §3.3 |

**Brand Blueprint**

| What | State | Evidence |
|---|---|---|
| Native presses | **0 ever.** 1 record (Smmim studio, `parts = {}`), 0 outbox rows | BP §1.1, §3.6 |
| Calls with no record | 8 cards have a `kind='blueprint'` call and no part 2. Only 3 are still before launch (map phase 4): Alalia.co (BB Booked), Makers (BB Booked), Smmim studio (Ready For Launch). The other 5 are Active at map phase 6: City Wood, mergestudio.kw, Shades, شركة العلا, Madana | R: SQL over `cockpit_csm_calls`, `cockpit_client_onboarding`, `cockpit_blueprints` |
| Settings | `close_route = card_only`, no `launch_assignee`, no starter packs | BP §3.6 |
| Run after a press | Browser only. A closed tab leaves the row `pending`, with no server sweep | BP §3.3, §7.3 |
| `close_route = slack` | Adds only the #media-general step, whose exact-text read-back fails | `blueprint.ts:129-130`; SL F2 |
| `close_route = make` | Falls back to `card_only` unless `BLUEPRINT_MAKE_CLOSE` is on; Make `9748311` has no route for the cockpit's body | `blueprint.ts:111-112`; BP §3.5; MI §4.6 |
| A failed close | Raises no alarm. The guardian has no `cockpit_creative_outbox` row | R: `hermes/cockpit-guardian/checks/queues.py` |
| #csm-general | No route posts there. The old path's only post there was Make `9209179`'s recap approval | BP §1.6, §1.7 |
| Card snapshot | The VPS creative sync lacks 4 fields, so prefills read empty | BP §3.6 |
| Old path | Live and linked. Partials fired Make `9748311`'s partial route in September (Alola 09-12, ARDON 09-13, Merge studio 09-17). Whether partials still arrive today: **Not verified** (September evidence only; the webhook lists `form_response` only) | KP F.6, F.7; MI §0 |
| Bot | mahara-club-bot `U0C0MJZNS2Y` is in #csm-general `C09RZ0GS0V9` and #media-general `C0AE8G5MT7Y`, and is the Edge secret's identity. It is **not** in #client-call-feedback `C09SVG6FHGU` or #nps-survey-feedback `C09TTGBRQ0G` | SL F1, F5; R: `slack_list_channel_members` (3 and 2 members, no bot) |
| Launch assignee evidence | The 5 main tasks on Marketing / ADs `901816723196` assigned since mid-October all carry media buyer B `113428468`; none carries media buyer A `119413219`. Media buyer seats in `cockpit_members` carry no client list, and the card has no media buyer field | R: `clickup_filter_tasks` (100 latest), SQL, list fields |

### 1.2 The fixes

"Build" means a build session does it. "CEO" means it is in the batch in
section 5.2; the build session carries it out on his yes (D16).

| # | Slice | Fix | Where | Who |
|---|---|---|---|---|
| S1 | 1B | Replace the exact-text read-back for the media buyer's request DM, the only Slack plan step in production. A post counts when the receipt has `ok`, a `ts` matching `^\d+\.\d+$`, and the channel rule: a requested `C` or `G` id must equal the returned channel; a requested `U` id must return a `D` id. Store the returned channel. Then read that channel's history by `ts` (`latest = ts`, `inclusive`, `limit 1`) and check only that the message exists and was posted by the bot. An unknown stays in `reconcile` for a person, as today; nothing resends. The test fake rewrites URLs, `mailto` and `&amp;` the way Slack does. Add a test for `prepareSlack` (askViktorFor) through the executor. | `cockpit-media-api/execute.ts:20`, `cockpit-media-api/slack.ts:4`, `cockpit-creative-api/blueprint.test.ts:197`, a new `cockpit-media-api/slack.test.ts` | Build |
| S2 | 1A | The #media-general "Brand Blueprint completed" post becomes notice kind `blueprint.media`, at Make `9748311` [5] parity: client, service, `<card url\|card>`, `<launch url\|launch task>`, "Scripts and custom creative can start.", `Ref CN-{id8}`. Escape `&`, `<` and `>`. For a card already Active, the next-step line is "The client is already live; nothing new starts from this close." The text builder moves into `cockpit-notices/text.ts`; `slackCloseText` stays only as the close preview. | `blueprintBrief.ts:677-682`, `cockpit-creative-api/blueprint.ts:129-130` | Build |
| S3 | 1A | Fix `close_route` at `card_only` (D5): remove `slack` and `make` from `cockpit_blueprint_settings_set` (`20261024a_brand_blueprints.sql:1162, 1182`) and from the Settings screen (`creative-director-cockpit/src/lib/blueprint.ts:818`), and drop the Slack and Make steps from the close plan (`blueprint.ts:111-112, 129-132`). The setting row stays at `card_only`. | new migration, `cockpit-creative-api`, CD Settings | Build |
| S4 | 1B | The creative director sets `launch_assignee` in Settings to the media buyer who holds the current Marketing / ADs work: today media buyer B `113428468` (5 of 5 recently assigned main tasks, R), with the label the list shows. The build session re-reads the evidence the day it is set and reports it. Assigned launch tasks then post to #client-ads-general through `task-assignment-alerts`. | CD Settings (a creative seat may set it, `20261024a…sql:1145-1155`) | Creative director (one click, in 5.2) |
| S5 | 1B | A server drain for Blueprint presses (1.3 Drain). | `cockpit-creative-api/index.ts`, `outbox.ts`, new migration | Build |
| S6 | 1B | Ship the VPS creative sync with the 4 fields (Templated Ads Status, Can Self-Record?, Ad Approval Needed?, Offer Creation). | `hermes/cockpit-sync/creativeProducer.ts:70-73`, native release (1.7) | Build |
| S7 | — | **Dropped.** No screen or brief reads "Blueprint done": the only readers are a counter (`onboarding-sync/sync.ts:217`) and a form-id map (`hermes/csm-calls/sources.ts:39`) (R). | — | — |
| S8 | 1B | A Blueprint nudge, only for cards at Brand Blueprint Booked or Ready For Launch with map phase 4 or lower, a `kind='blueprint'` call, and no part 2: "Blueprint call held {date}. No Blueprint record yet. Open the call page." Today that is Alalia.co, Makers and Smmim studio (R). The creative director's page reads it from a new `blueprintCall` field on `cockpit_blueprint_sources(text)` (already gated for creative seats), never from `cockpit_csm_calls` directly. The CSM page reads its own calls table. Also: the close plan skips the Onboarding Map write when the current map URL's phase is 5 or higher, with the line "The Onboarding Map is already at phase {n}, so it is left as it is." | `cockpit_blueprint_sources`, CD `components/BlueprintCard.tsx`, CSM `OnboardingKit.tsx`, `blueprint.ts:119` | Build |
| S9 | 1A | Remove the old Blueprint link. The kickoff trail's last button opens the native Blueprint (`/client-success/clients/{id}/present/blueprint?view=prep`). The trail stop stays, worded as observed state. Drop the "Brand blueprint form" brief line. | `forms/kickoff.ts:61-67`, `FormPanel.tsx:1170-1172`, `creativeSourceModels.ts:1281` | Build |
| S10 | 1A | Tell the truth in the kickoff window. `after.say`: "Kickoff sent. Make is updating the card. Book the Brand Blueprint call below." `after.sub`: "The team hears in #csm-general once the card is updated." Fix the `makeDoes` lines to match. Show the window URL in the cockpit links and the trail; the card's Kickoff Form Link is not touched. | `forms/kickoff.ts:44-46` | Build |
| S11 | 1A (backend), 1B (screens) | The #csm-general and #media-general notices (1.3). Each trail gains a stop: "Posted in #csm-general at 14:03", or "Not posted: {reason}. Tell the tech lead." | 1.3 | Build |
| S12 | 1B | Prove the one-card refresh on one client before the next onboarding call: press Refresh in the CSM cockpit on the CEO's seat in the built-in browser (already signed in; if not, it goes to the CSM as one click) and read the `cockpit_client_onboarding_runs` row. | `docs/csm-forms/KICKOFF.md` §7 check 5 | Build |
| S13 | 1B, after the first native close | Retire the old Blueprint path (A1). | Typeform, Make | **CEO** (A1) |
| S14 | 1A | Make `8925654` [21] (A2), in this order: (1) add an **Ignore** error handler on [21], so a failure there no longer stops [22] [23] [26] [25]; (2) write the cockpit Blueprint URL into `1b7a4a74`; (3) Service Advertised: take the **first** chosen label and `switch()` it to its option id (Design and build `cb4f5a2c…`, Interior design `e9883783…`, Architectural design `2e788bec…`, Fit out and renovation `889744ae…`, Construction only `77bda402…`); for "Other" or no match, leave the field unset; (4) Client Status forward only: write it with an `if()` over the card read in [16], Brand Blueprint Booked `dbd21650…` when the current status is Onboarding Booked, Needs Contacting, SALES TEAM TO CONTACT, DELAY OUT OF OUR CONTROL or empty, else the current option id unchanged. The late notice (1.3) is the check that [21] still completed. | Make | **CEO** (A2) |
| S15 | — | **Dropped.** Kickoff Form Link `87d7d889` keeps Make's prefilled Typeform link, because the window's prefill reads it (`prefill.ts:176-197`). Make `8979157` and `8922994` are not edited. The window URL lives in the cockpit (S10). | — | — |
| S16 | 1B | Rotate the GitHub token in Make `8922994` [25] (A5), in this order: create the new token; put it in a Make connection; confirm one real run of [25] succeeds; then revoke the old token. Never revoke first: the scenario has no error handler, so a failed [25] stops the onboarding run (no Kickoff Form Link, no Client Profile, no phase 3 WhatsApp). | GitHub, Make | **CEO** (A5) |
| S17 | 1A | Take the kickoff's `postcallsummary` webhook off `tG7dnxBn` and change the ending's sentence to "Kickoff saved. The team hears in #csm-general once Make updates the card." Nothing is lost: 0 of 8 recaps were ever sent, and each left a content-free APPROVE card (KP §3.1). Make `9209179` keeps its other sources until Stage 2. | Typeform | **CEO** (A3) |
| S18 | 1A | `fRokTITH`: `autosave_progress` off and `partial_responses_to_all_integrations` off, the same fix the kickoff got on 10-23. One client's half-written notes can otherwise reappear in the next client's form and reach Make `9209179` on the wrong card. | Typeform | **CEO** (A4) |
| S19 | 1B | Phase 4 delivery check, read-only: for the last 7 kickoffs, count the phase 4 text in `wa_messages` for each client's group (count only, no bodies). Report any group with none. | SQL, report | Build |

### 1.3 The notices

**Plumbing** (SL §5, F3d):

| Piece | Decision |
|---|---|
| Table | `cockpit_slack_notices`, columns as in SL §5.1, plus `target` (the requested channel or user id), `channel` (the id Slack returned), `variant` and `attempts`. `kind` CHECK: `kickoff`, `kickoff.updated`, `blueprint.close`, `blueprint.updated`, `blueprint.media`, `blueprint.offer`, `rehearsal`, plus later kinds added by migration. Channel CHECK: `kind = 'rehearsal' OR target IN (allow-list)`; the Stage 1 allow-list is `C09RZ0GS0V9` and `C0AE8G5MT7Y`. Row security on, revoke from `PUBLIC`, `anon` and `authenticated`, grant to `service_role` in the same migration. An audit row on every state change, through a trigger. A state-move trigger allows only: `queued → sending`, `sending → queued` (not due yet, or rate limited), `sending → posted \| failed \| unknown`, `queued → skipped \| muted`, `unknown → posted` (reconcile) and `unknown → failed` (runbook, after a person checked). CHECK `state <> 'posted' OR slack_ts IS NOT NULL`. |
| Settings | `cockpit_slack_notice_settings` (kind, on, channel). `off` turns a queued notice into `muted` at claim. Default on. |
| RPCs | `cockpit_slack_notice_claim(p_limit int)`, service-only: takes `pg_try_advisory_xact_lock(hashtextextended('cockpit_slack_notices', 0))`, then claims due rows with `FOR UPDATE SKIP LOCKED`. `cockpit_slack_notice_result(p_id uuid, p_outcome text, p_ts text, p_channel text, p_error text)`, service-only: settles one row (`posted`, `failed`, `unknown`, `requeue`, `ratelimited`). `cockpit_slack_notice_sweep()`, service-only (below). `cockpit_slack_notice_read(p_task_id text)`, granted to `authenticated`: gate first (`cockpit_csm_client_gate` for the client's CSM; `cockpit_has_role('creative') AND cockpit_client_allowed(client_name)`; admins; the CEO); returns per notice kind, state, time, permalink and the plain reason, never the text. |
| Kickoff queue | `AFTER INSERT OR UPDATE` on `cockpit_client_onboarding`. It fires when `NEW.forms->'kickoff'->>'response_id'` is set and is new: an INSERT, or a value different from OLD's, tested in the body. It inserts **one** row, kind `kickoff`, `dedupe_key = 'kickoff:' \|\| response_id`, with `ON CONFLICT DO NOTHING`, and `facts.second = true` when OLD held another ID or `cockpit_csm_form_sends.second` says so. The state is `queued` when `submitted_at` is within 48 hours, else `skipped`. It never raises: the body is wrapped in an exception handler, because it runs inside the cron publish (SL F3a). |
| Kickoff due rule | The claim RPC claims a `kickoff` row only when the card looks done, or 20 minutes have passed since `submitted_at`. "Looks done" is `client_status ~* '^(brand blueprint booked\|launch booked\|ready for launch\|active$)'` and `card_updated_at >= submitted_at`, the same rule as `kickoffCardDone` (`formStatus.ts:41-53`); a test pins the SQL regex to `BLUEPRINT_ON`. The sender then reads the card's comments through the `tools.ts` ClickUp helper and requires a "KICKOFF HANDOFF" comment dated at or after `submitted_at`, on every kickoff. That makes a second kickoff, or a card already at Brand Blueprint Booked, prove that Make ran. If the comment is there, the variant is `complete`. If not and 20 minutes have not passed, the row goes back to `queued` for one minute, with no attempt counted. After 20 minutes the variant is `late`. Waiting is never an attempt; only a rate limit counts, 3 at most. |
| Kickoff follow-up | When a `late` notice has posted and, within 48 hours, the card passes the same test, the sweep inserts a `kickoff.updated` child (`kickoff:{response_id}:updated`): a thread reply, "Card updated at {time}." |
| Blueprint queue | `AFTER UPDATE OF state ON cockpit_creative_outbox WHEN (OLD.state = 'sending' AND NEW.state IN ('done','reconcile') AND NEW.kind = 'blueprintClose')`, first close only. It inserts `blueprint.close` (`blueprint:{task}:close`, to #csm-general, `facts.settled` = `done` or `reconcile`) and `blueprint.media` (`blueprint:{task}:media`, to #media-general). `blueprintOffer` reaching `done` gives `blueprint.offer` (`blueprint:{task}:offer`, `parent_id` = the close notice). `reconcile → done` on a close gives `blueprint.updated` (`blueprint:{task}:updated`), a thread reply "The card update is confirmed." The key is the once-only test, not `payload.previous` (SL F3b). |
| Old Typeform Blueprint | Until A1 is confirmed, the onboarding trigger also queues `blueprint.close` from `forms->'blueprint'->>'response_id'` with the same key `blueprint:{task}:close` and `facts.source = 'typeform'` (SL F3d). A1's release removes this branch. |
| Sweep | Each sender run first calls `cockpit_slack_notice_sweep()`: `sending` older than 10 minutes becomes `unknown`; any notice the triggers missed is inserted (a mirror kickoff within 48 hours, a close in `done` or `reconcile` within 48 hours, an offer `done` within 48 hours, with no row); the follow-ups above are inserted. That is the second source behind the triggers. |
| Seed | The same migration inserts, as `skipped`, every kickoff `response_id` present at apply time whose `submitted_at` is more than 48 hours old (30 of 30 today, R). Newer ones are left to the trigger, so a kickoff in the last two days still posts. |
| Sender | Edge Function `cockpit-notices`: `x-cron-secret` from the vault, pg_cron every minute (`mahara-slack-notices`). Each run sweeps, reconciles up to 10 unknowns by the `CN-` marker (history of the stored returned `channel` from `claimed_at` minus 60 s, paging up to 20 times), claims up to 10 due rows, builds the text and variant from `facts` at that moment, posts and records (SL §5.3). |
| Helper and ledger | A new `slackTools` in `cockpit-csm-api/tools.ts`, written on `eod-radar/slack.ts:41-87`, plus `blocks` and `thread_ts`. Receipts go to `cockpit_csm_provider_health` (provider `slack`, `run_key` = notice id, `action_id` null). The ClickUp comment read uses the existing ClickUp helper in the same file. |
| Confirmation | `posted` means the receipt has `ok`, a `ts` of the right shape, and the channel rule of S1: a requested `C` or `G` id equals the returned channel; a requested `U` id returns a `D` id. The returned channel is stored and used for reconcile and threads. `ratelimited` goes back to `queued` after `retry-after`. A refusal (`not_in_channel`, `channel_not_found`, `missing_scope`, …) is `failed`, with a plain sentence. Anything after the request left is `unknown`, and an unknown is never resent. |
| Doctor | `doctor` refuses to post unless `auth.test` returns `U0C0MJZNS2Y`. For **every** channel on the allow-list it checks `conversations.info` (private where expected) and that the bot is a member, and it checks the scopes `chat:write`, `groups:history` and `users:read.email`. It lists the person each mention rule resolves to and fails when one resolves to nobody. |
| Dry run | `dryRun` takes explicit inputs: `{response_id}`, or `{kind, task_id, facts}`. It builds the text and the variant and writes no row. For a Blueprint it can build from a synthetic close payload (for example Smmim studio, which has no close). |
| Rehearsal | `rehearse` writes one `rehearsal` row whose `target` is `ALERT_SLACK_TO` (a `U` id, default `U09305KE2KS`), posts the built text prefixed "[Rehearsal]", stores the returned `D` id, and runs the same reconcile on that DM. It never posts to a team channel. |
| Health | Two guardian queue rows in `hermes/cockpit-guardian/checks/queues.py`: `cockpit_slack_notices` in `queued`, `sending` or `unknown` over 15 minutes; `cockpit_creative_outbox` Blueprint kinds `pending` over 10 minutes, and any `reconcile`. The `Queue` class reads a `status` column today, so it gains a `status_col` (default `status`) and an optional kind filter. One RUNBOOK row (doctor, dry run, rehearse, how to check an unknown, how to requeue a failed notice). |
| Drain (S5) | A service-only `cockpit_creative_outbox_due()` returns `pending` Blueprint rows older than 2 minutes and younger than 30 minutes with `attempts < 3`, and sets older `pending` Blueprint rows to `failed` with "This press did not finish within 30 minutes. Press again." A service-only `cockpit_creative_outbox_load_for_actor(p_id uuid)` checks `cockpit_blueprint_gate_for_actor(actor_id, task_id, true)` for the presser **now** and returns the same fence fields as the `get` operation (`client_name`, `task_id`, `actor_id`, `payload`, `sourceTask`). `runClientAction` (`outbox.ts:49-69`) is refactored to take a loader: the browser path keeps `client.rpc('cockpit_creative_client_action', get)`, the cron path uses the service loader. `cockpit-creative-api/index.ts` gains a `cron` branch **before** `getUser()` (line 20), checked by `x-cron-secret`; pg_cron `mahara-creative-drain` every 2 minutes. A refusal while the plan is prepared adds 1 to `attempts` and stores the sentence; at 3 the row becomes `failed`, and the Blueprint card shows "This press was refused: {sentence}. Fix it and press again." The audit row carries `source_system = 'cron'`. |

**When each notice posts:**

| Notice | Posts when | Mention |
|---|---|---|
| Kickoff, `complete` | the due rule and the handoff comment both pass | the creative seat (today `U0B2SHGS1JA`) |
| Kickoff, `late` | 20 minutes after `submitted_at` without both. Make `8925654` takes at most 147 s, and the mirror publishes every 10 minutes | the CSM seat (`U0C5JHUCTPG`) and the systems manager (`U0AS90SHMH8`) |
| Second kickoff | a line added to either variant (`facts.second`) | the CSM seat |
| Kickoff updated | thread reply under a `late` notice when the card later passes | nobody |
| Blueprint closed | the first close leaves `sending` (`done` or `reconcile`) | the CSM seat |
| Blueprint completed (#media-general) | the same moment | nobody |
| Blueprint updated | thread reply when a `reconcile` close later becomes `done` | nobody |
| Offer locked | the first `blueprintOffer` reaches `done`: a thread reply under the close notice, or top level if the parent did not post | nobody |

Mentions resolve at send time, never hard-coded. Seats: `cockpit_members`
(active, not admin, the role in `roles`, with the client in `clients` or
`clients` empty), then `cockpit_people`, then `cockpit_eod_radar_slack_ids`
(`ok`), then `users.lookupByEmail`. The systems manager is an admin seat, so
it resolves from `cockpit_people` (the active row whose role is the systems
manager) to `cockpit_eod_radar_slack_ids`. Not verified: the exact role text
in `cockpit_people`; the doctor shows who it resolved to. With no match, the
first name goes in plain text and a health warning is written (SL F4). The
mention format is `<@U…>` only when the id matches `[UW][A-Z0-9]+`. Never
`@channel` or `@here`.

**Text.** House copy rules: plain lines, sentence case, no exclamation marks,
no em dashes, Kuwait time, names escaped (SL §7). Each line states what the
card shows, never what Make is assumed to have done.

```
text: Kickoff complete: {client}. Next is the Brand Blueprint call. Ref CN-{id8}

*Kickoff complete: {client}*
Filled by {first name | "in Typeform"} on {Sun 25 Oct, 14:02}.
The card shows {client status}{", and the Brand Blueprint link" when links ? 'blueprint_form'}.
The Kickoff Handoff comment is on the card ({14:04}).
Next is the Brand Blueprint call. <@{creative seat}>
[Open in the cockpit]  [Open the ClickUp card]
Client success · Ref CN-{id8}
```

- Late variant headline: "*Kickoff in, card not updated: {client}*". Its line: "The card has no Kickoff Handoff comment 20 minutes after the kickoff. Open the card and check it. Do not send the kickoff again."
- Second kickoff line: "This is the second kickoff for this client. The card has a new Kickoff Handoff comment, so check it for a second Technical and Creative task, and do not send it a third time." On the late variant: "This is the second kickoff for this client. Do not send it a third time."
- Blueprint closed, `done`: SL §7.2 as written, with the route line ("send the phase 5 WhatsApp from your comment on the card, then book the launch call" while the CSM pastes) and the launch call line ("Launch call booked for {date}." or "Launch call not booked yet."). Buttons: Open in the cockpit, Read the Blueprint, Open the ClickUp card.
- Blueprint closed, `reconcile`: "*Blueprint closed: {client}*. The card update needs a check. Open the call page." Same buttons.
- Blueprint completed (#media-general): S2.
- Offer locked: "Offer locked by {first name}. Brand DNA is {complete \| still missing}. Ref CN-{id8}".
- Never in a notice: answers, prices, budgets, phone numbers, emails, WhatsApp text, AI summaries (SL §7.4).
- Links:
  - cockpit: `https://cockpit.maharamedia.com/client-success/clients/{taskId}?tab=onboarding`;
  - card: `https://app.clickup.com/t/{taskId}`;
  - Blueprint: `…/clients/{taskId}/present/blueprint?view=prep`.

  `unfurl_links` and `unfurl_media` are false.

**Trail stops (S11, slice 1B).** Both read `cockpit_slack_notice_read`:
the CSM kickoff trail (`client-success-cockpit/src/forms/FormPanel.tsx`,
`formStatus.ts`), the CSM Blueprint close in the present page
(`client-success-cockpit/src/present/blueprintDeck.tsx`; not verified that
this is the file that renders the close result, so the session confirms it
first), and the creative director's `components/BlueprintCard.tsx`.

### 1.4 Blueprint parity: "ClickUp updated the same way it used to"

Before 2026-09-02 the kickoff made the launch task. Make `9748311` took it
over (KP F.1.5). "The same way" means the Make `9748311` rows below.

| # | Old effect (source) | Native (source) | Stage 1 action |
|---|---|---|---|
| 1 | Partial at `bb0018`: "{name} - New Client Campaign Launch 🚀" from `t-86ex8xaf1` on Marketing / ADs `901816723196`, with 6 subtasks and no dedupe (Make `9748311` [3]; KP F.4) | Part 1 "Send to media": the same template and list, deduped by record, tag or name; it refuses two open matches (`blueprint.ts:40-48, 72-107`) | Proven on the test card (1.6), then a real press |
| 2 | "Brand Blueprint - media handoff" comment (Make `9748311` [4]) | `launchBrief` comment (`blueprintBrief.ts:491`) | none |
| 3 | No assignee, nobody pinged | `launch_assignee` unset | S4 |
| 4 | #media-general "Brand Blueprint completed": client, service focus, card link (Make `9748311` [5]) | Notice `blueprint.media` | S2 |
| 5 | Can Self-Record? `39839c9d`, by option id (Make `9748311` [8]) | By label; all labels exist (BP §3.4) | none |
| 6 | Onboarding Map `51f49cb1` phase 5 (Make `9748311` [8]) | First press (`blueprint.ts:119`), now skipped at phase 5 or higher | S8 |
| 7 | Phase 5 WhatsApp after the sheet lookup and a 30–120 s wait (Make `9748311` [6][10][7]) | The CSM pastes it from the card comment (`closeCsmComment`) | **Unmet in Stage 1.** Stage 2b sends it through `hermes/client-messages` after one tap by the CSM (2.7) |
| 8 | Recap approval in #csm-general, then Make `9523861` sends (Make `9209179` index 1) | none | **Unmet in Stage 1.** Stage 2b: a Blueprint recap draft (2.7) |
| 9 | Client Status untouched (no version writes `9368ca9e`) | untouched | unchanged; Make `9744107` sets LAUNCH BOOKED on booking |
| 10 | (none) | Ad Approval Needed? `dd2253f9`, Templated Ads Status `e7d158a8`, Creative Onboarding steps 2–4, Offer Creation `404ba9d5`, close and offer comments | S6, so the cockpit reads them back |
| 11 | (none) | #csm-general notice | S11 |

The kickoff's own ClickUp parity is Make `8925654` as it runs today (KP
"Then vs now"), plus S14.

### 1.5 Verifying without a real client

No synthetic Blueprint row is ever run live. There is no Supabase branch
database; triggers and migrations are tested in PGlite, as the repo's other
tests in `apps/*/scripts` are.

| Check | How | Passes when |
|---|---|---|
| Migration | PGlite apply twice; then on production through Composio: `BEGIN; <file>; <file>; ROLLBACK;` with `SUPABASE_BETA_RUN_SQL_QUERY`, then `SUPABASE_APPLY_A_MIGRATION` once (1.7) | No error; every kickoff older than 48 hours seeded `skipped`; 0 `queued` |
| Trigger logic | PGlite tests on synthetic rows: a new ID queues one `kickoff` row; the same ID re-published does nothing; an old `submitted_at` is skipped; a second ID sets `facts.second`; a broken row does not raise; `sending→done` and `sending→reconcile` on a close each queue `blueprint.close` and `blueprint.media` once; a second close queues none; `reconcile→done` queues `blueprint.updated`; an offer queues a child; the seed skips only rows older than 48 hours | All pass |
| Claim and states | PGlite: a kickoff row is not claimed before it looks done or 20 minutes pass; `requeue` does not add an attempt; illegal moves are refused; a Blueprint close stuck in `pending` over 10 minutes and a `reconcile` show in the guardian query | All pass |
| Text | Unit tests on `noticeText(kind, variant, facts)`: escaping, no budget or answer keys, the mention fallback, Kuwait time, the "already live" line | All pass |
| Channel rule | Unit tests: `C`/`G` must match; `U` must return `D`; anything else is `failed` | All pass |
| Read-back fix (S1) | Unit tests whose fake rewrites URLs, `mailto` and `&amp;`; one for `prepareSlack` | askViktorFor settles `confirmed` |
| Drain (S5) | bun on the outbox harness (`outbox.test.ts` fake provider): due, refused three times then `failed`, gate lost then refused, older than 30 minutes then `failed`; then the cron route with `apply: false` on production | All pass; the production dry run writes nothing |
| Sender doctor | `POST {"job":"doctor"}` | `U0C0MJZNS2Y`; both Stage 1 channels member; scopes present; every mention resolves |
| Dry run | `dryRun {response_id}` for the SMART INTERIOR kickoff (10-20), and `{kind:'blueprint.close', task_id:'86ex70t90', facts}` from a synthetic close payload | Text matches 1.3; nothing written or posted |
| Rehearsal post | `rehearse` to the `ALERT_SLACK_TO` DM, then its reconcile | Receipt `ok`; returned `D` id stored; marker found; one ledger intent and one response row |
| One-card refresh | S12 | A `trigger='one'` run with `ok` |
| Bundles | `scripts/ship.sh client-success` and `scripts/ship.sh creative`; grep the live bundles | The new copy is present; "Open the Brand Blueprint form" and "Make is booking" are gone; Settings shows no close route choice |

### 1.6 The proof run on the internal test card

The card `86eywg1cq` "[INTERNAL TEST] Client lifecycle automation -
2026-09-14" is in `cockpit_client_onboarding` (status Stopped, no kickoff,
R) and was used for the 2026-09-14 lifecycle tests (TI F2, RF F.1). One
supervised run proves Stage 1. It needs slice 1A and 1B shipped, A2, A3 and
S4 done, and the CEO's yes on A6.

**Before (read-only).**
1. Client Data has no row whose column C is `86eywg1cq`. If one exists, stop: Make `8925654` [25] would send the phase 4 WhatsApp to that group.
2. Confirm A3 holds (the `tG7dnxBn` `postcallsummary` webhook is off), so Make `9209179` gets nothing. If an approval card still appears in #csm-general, deny it; never approve it.
3. Record the card's status, Onboarding Map, Brand Blueprint Form Link, Service Advertised, Can Self-Record?, Ad Approval Needed?, Templated Ads Status and Offer Creation.

**Run.**
4. Set the card to Onboarding Booked through the CSM act path (an audit row), so the forward-only rule lets [21] set Brand Blueprint Booked.
5. Kickoff: open the kickoff window on the test card in the built-in browser on the CEO's seat (already signed in; no password is typed) and submit test answers. If that seat cannot open the window, use the card's prefilled Typeform link with `onboarding_client_id=86eywg1cq`.
6. Check: Make `8925654`'s run (13 operations, [25] skipped by its filter, Service Advertised set), the mirror pick-up, the `kickoff` notice (`complete`), the comment check, the trail stop.
7. Blueprint: parts 1 to 3 on the test card in the creative director's view, same seat. Not verified that the CEO seat may press parts; if not, the creative director presses. Check: the launch task with 6 subtasks, tag, due date and assignee; the card fields; map phase 5; `blueprint.close` in #csm-general; `blueprint.media` in #media-general; the offer thread reply.

**Clean-up.**
8. Set the Technical, Creative and launch tasks and their subtasks to cancelled (never delete). Put back every recorded field value and the status Stopped. Comments and notices stay; they carry the test card's name. Report every write with its read-back.

What the run causes, named in A6 so the CEO approves it knowingly: a
Kickoff Handoff comment on the test card; a Technical and a Creative task
(the Media/Creative rule assigns the creative strategist, and
`task-assignment-alerts` posts in #media-general); a launch task assigned to
the launch media buyer (a #client-ads-general alert); two #csm-general
notices that tag the creative seat and the CSM seat; one #media-general post.

### 1.7 How Stage 1 ships

| Piece | How |
|---|---|
| Git | Commit in the worktree; push from a throwaway worktree; never move HEAD in the shared checkout (memory shared-checkout-git) |
| Migrations | Save `pg_get_functiondef` of any function replaced (`cockpit_blueprint_settings_set`, `cockpit_blueprint_sources`). Dry run `BEGIN; file; file; ROLLBACK;` with `SUPABASE_BETA_RUN_SQL_QUERY`, then `SUPABASE_APPLY_A_MIGRATION` (`{ref, name, query}`). Every Composio command runs with `< /dev/null` (memory supabase-via-composio) |
| Edge Functions | Bundle from committed code: `bun build <fn>/index.ts --target=browser --format=esm --external 'npm:*' --external 'jsr:*' --external 'node:*'`, with anything imported from outside the function folder (`cockpit-creative-api` imports `client-success-cockpit/src/present/blueprintBrief.ts`). Dry run with `bundleOnly: true`, then `SUPABASE_DEPLOY_FUNCTION`. Read the live version before and after. 1A: `cockpit-notices` (new) and `cockpit-creative-api` (S3). 1B: `cockpit-media-api` and `cockpit-creative-api` (both use `execute.ts`; creative also gains the cron route) |
| `verify_jwt` | Existing functions keep theirs (Composio keeps it; creative stays on, so its cron call carries a JWT plus `x-cron-secret`). `cockpit-notices` is created with `verify_jwt` off if the deploy can set it. Not verified that it can; if not, pg_cron sends the anon key as `Authorization` plus `x-cron-secret`, and the function checks the secret |
| Secrets and cron | Function secrets `NOTICES_CRON_SECRET` and `CREATIVE_CRON_SECRET` through `SUPABASE_CREATE_BULK_SECRETS`; the same values in the vault as `cockpit_notices_cron_secret` and `cockpit_creative_cron_secret`; pg_cron `mahara-slack-notices` (every minute) and `mahara-creative-drain` (every 2 minutes) read them from the vault, never a literal token |
| Sites | `scripts/ship.sh client-success` and `scripts/ship.sh creative`, then a live bundle check |
| VPS | S6: a native release (memory native-release: package, stage, doctors, dry runs, canary under the lock, atomic link swap; a failing CEO section blocks the canary, so read the CEO doctor first). Guardian rows: push to main, `rsync -a --exclude __pycache__` the folder to the VPS, run its tests there (memory cockpit-guardian) |
| Make and Typeform | On the CEO's yes, through the Make API (`PATCH /scenarios/{id}` with the edited blueprint, then a `GET` read-back) and the Typeform API. Not verified that the Make key may write scenarios; if not, the edit is made in Make's editor in the built-in browser. Never "Run once" on any client scenario |

### 1.8 Stage 1 is done when

**Shipped** (checks pass):
- Slice 1A: S2, S3, S9, S10, S11 backend, S14, S17, S18, and the 1.5 checks for them.
- Slice 1B: S1, S4, S5, S6, S8, S11 screens, S12, S16, S19, the guardian rows.

**Proven:**
- The proof run on the test card passed (1.6). Then A1 goes, and Stage 2 build may start.
- One real kickoff notice and one real Blueprint notice have posted. The first real presses should be Alalia.co and Makers (S8 shows them); the creative director makes them. Stage 2's cut-over waits for these, not its build.

**Reported as unmet** in the Stage 1 report, so it is never called complete:
the phase 5 WhatsApp is pasted by the CSM, and the Blueprint and kickoff
recaps do not exist until Stage 2b.

---

## 2. Stage 2: the 1-1 call notes in the cockpit, filled from Fathom

### 2.1 Data flow

```
Fathom ── 15-min poll (exists) ─┐
       ── pull when the form opens ─┼─> cockpit_fathom_meetings ─> matcher ─> cockpit_csm_calls
       ── signed webhook (2.2) ─┘                                               │
                                                                               ▼
CSM opens "Write 1-1 notes" ─> window /clients/:key/forms/checkin ─ picks the call, drafts (2.5)
       │ submit (cockpit_form_submit, gated)
       ▼
cockpit_form_responses (form_key 'checkin') ─ write-through ─> cockpit_csm_call_forms (brief, cadence)
       │ same transaction
       ▼
cockpit_form_effects ─> ClickUp writeback queue (comment, Happiness, Last POC, Last Check-in Call)
                     ─> cockpit_slack_notices (grade to #client-call-feedback)
                     ─> cockpit_client_messages (recap, only after the CSM approves) ─> hermes/client-messages (WHAPI)
```

### 2.2 Getting the call

| Path | Change | Source |
|---|---|---|
| Poll (`hermes/csm-calls`, every 15 minutes) | Ask for `include_action_items`. Treat `one_or_more_external` from a Customer Success recorder as a candidate client call: keep its summary, action items and transcript privately, and put it in the unmatched queue with the booking-time suggestion. Read transcripts with `/recordings/{id}/transcript` (widen the `lib.ts:70` guard to that path). | FA §5.2, §5.3, §9.2 |
| Pull when the form opens | `cockpit-forms-api` makes one heavy request: `GET /meetings?recorded_by[]={CSM}&created_after={now-12h}&include_summary&include_action_items`, through a new `fathomTools` in `cockpit-csm-api/tools.ts` (ledger `cockpit_csm_provider_health`), cached 60 s. | FA §9.2 |
| Webhook | Edge Function `fathom-webhook`: verify `webhook-signature` (HMAC-SHA256 over `id.timestamp.body`, constant time, ±5 minutes), dedupe on `webhook-id`, upsert, run the same matcher. Register it on the CEO's key for `shared_team_recordings` only, with the transcript, summary and action items; add `my_shared_with_team_recordings` only if a shared CSM call is found missing. Never `my_recordings`: 190 of the CEO's recordings are private (`no_teams`), while all 48 of the CSM's are shared with all teams (FA §4). Webhook bodies are never logged. | FA §4, §6, §9.2 |
| Keys | A VPS script reads `FATHOM_API_KEY` by name and writes it into a service-only key table, the `cockpit_hours_keys` pattern, without printing it. The same script registers the webhook and stores the returned `whsec_` secret the same way. Edge reads both through a service-only RPC. A "Fathom" row on the CEO Connections page shows the state and takes a pasted key for rotation. | FA §9.1 |
| Privacy | Sales, hiring and team meetings keep metadata only, as today. | FA §9.2 |

### 2.3 Matching

Signals in this order (FA §7):

1. The same room: `meeting_url` equals the booking's `join_url`.
2. The CSM's recording within ±60 minutes of this client's booked call (shown as a suggestion).
3. A share link pasted in the form.
4. An invitee email or domain.
5. The name in the title (weak).
6. The CSM's tap. It is written through `cockpit_csm_manual_match`, with an audit row.

The client page shows a Join button from the booking's `join_url`, so more
calls match by room.

### 2.4 The form

Route `/clients/:key/forms/checkin` (`FormKey "checkin"` already exists,
`formConfig.ts:16`). Opened from the client header "Forms → Write 1-1
notes", the Today row "1-1 notes missing", and the Log a call panel.

| Field | Required | Filled by | Notes |
|---|---|---|---|
| This call | yes, or "No recording" | The cockpit picks it (2.3) | Title, time, length, why it matched. "Change" opens the CSM's recordings since yesterday. "Paste a Fathom link". "Fathom hasn't sent this call yet. It usually takes a few minutes after the call ends. Check again." |
| Transcript | no field | Fathom | A pointer to the stored transcript with "View transcript". Never pasted. |
| DEFCON | yes | The CSM | Paused, At Risk, Neutral, Happy, Very Happy (testimonial), Churned. Shows the card's current value and a suggestion with the quote and timestamp behind it. **Never preselected.** |
| Priority | yes | The CSM | 911, High, Medium, Low, with a suggestion |
| We owe / They owe | no | Draft from Fathom's action items and Next Steps | An editable list with owner and timestamp link. It replaces "Additional Notes". |
| Client notes | no | Draft from Key Takeaways | Internal: mood, promises, risk talk (pause, cancel, budget), a testimonial offer |
| Next check-in | no | The existing GHL booking (check-in calendar `SHjlq0UjeR11maltYNyh`) | Shows the booked call, or "Book it" inline |
| Client recap | approval step | Draft (2.5) | A separate "Send to the client's group" button. The preview shows exactly what goes, booking line included. It can also be approved later from the client page (2.7). |

The side rail shows the last 1-1 (DEFCON, promises), the open promises from
the client brief, and the next booked call (FA §9.3). Saving is per field
with a revision, as `cockpit_blueprint_save` does. The browser's request ID
is the response ID.

### 2.5 AI drafts

All drafts go through `cockpit-media-api/model.ts` `structuredJson`, with the
health callback to the ledger. Each draft is stored in `cockpit_form_drafts`
with its model, prompt version, text and the CSM's edits.

| Draft | Provider | Rules |
|---|---|---|
| We owe / They owe | none: Fathom's action items, formatted | No model needed |
| Client notes | `deepseek` | Internal extraction. Read `message.content`. `max_tokens` ≥ 200. |
| DEFCON and priority suggestions | `anthropic` | Each with a quote and timestamp, shown as a suggestion only |
| Call grade | `anthropic`, temperature 0.2 | Make `9209179` [4]'s rubric with "Pinpoint Scaling" replaced by Mahara. One grade per call, stored, never regraded on retry. |
| Client recap (WhatsApp) | `anthropic`, under `aziz-kuwaiti-voice` | Kuwaiti Arabic, warm, human. No leads, CPL or booking-cost numbers. No results guarantee. Changes in the client's words. `SKIP` means no draft. The booking line as in MI F.4.5. |

If the doctor finds no key for a provider, that draft says "AI drafts are
off: no {provider} key. Fill this by hand." The form still submits. A missing
key goes to the CEO batch as a paste (B4).

### 2.6 Where results land (parity with Make `9209179`)

| Effect | Make today (MI F.4) | Native |
|---|---|---|
| To-do comment on the card | [3] → [17], GPT, `notify_all` false | Kept: the edited We owe / They owe, the recording link at the top, `notify_all` false |
| Client Happiness `4e3924e3` | [21], label in, option id out | Kept, by option id |
| Last POC `e183f2ce` | [21], the submit time | Changed: the call's end time when a recording is picked, else the submit time |
| Last Check-in Call `032203ad` | never | **New to the form:** the call date (the cockpit's Log a call already writes it, see below) |
| Grade to #client-call-feedback `C09SVG6FHGU` | [4] → [15] | Kept, through `cockpit_slack_notices` (kind `checkin.grade`). The Stage 2a migration adds `C09SVG6FHGU` to the allow-list; mahara-club-bot is invited in B0; the doctor must show it private and the bot a member before B1 and B2 |
| Recap approval card in #csm-general | [22] → [23] → [24], then Make `9523861` sends | Replaced: approval in the cockpit (2.7). A quiet #csm-general line only when a recap is still unsent 24 hours after the call: "Recap not sent: {client}, call {date}. Open in the cockpit." |
| WhatsApp send | Make `9523861` (race on Send, re-arm on rerun) | `hermes/client-messages`: claim before sending, a 30–120 s jitter, a read-back by message id and body hash, never resent |
| The cockpit's own reads | `cockpit_csm_call_forms` via `hermes/csm-calls` | Write-through row (widen the `form_id` CHECK, `20261011c…sql:52`) with the question titles the brief reads (`clientBrief.ts:1638-1650`) |

**One writer for Last POC and Last Check-in Call.** `cockpit-csm-api` already
writes Last POC and Last Check-in Call on "Log a call" (`core.ts:26-27`).
When the Log a call panel opens the notes form, the act call carries
`notes: true` and writes only the cockpit patch, not the two fields; the
form effect writes them with the call's dates. A call logged without notes
keeps today's path.

### 2.7 The same machinery for the kickoff and Blueprint recaps

- **Kickoff recap.** It is drafted from the kickoff answers (in `cockpit_csm_call_forms`) plus the matched Fathom onboarding call, and sent through `hermes/client-messages`. Make `9209179` no longer takes the kickoff (A3).
- **Blueprint.** The recap is a draft from the close, and the phase 5 WhatsApp becomes a one-tap send. Before sending, the worker reads the group's latest messages for phase 5 text for this client, so it cannot double a Make `9748311` send that slipped through before A1 (RF F.5).
- **Where approval happens, for every form.** The client page's Messages card shows each draft with "Approve and send", and the Today list gets a "Recap waiting" row. The kickoff window's after-panel links there; it is not the only place, because the window has 0 uses (KP §6). The 24-hour #csm-general reminder of 2.6 applies to every recap kind.
- **`hermes/client-messages`**:
  - **Inputs and checks.** It sends only `approved` rows. The group comes from Client Data column F by card id. It refuses when `b1d54dfb` is set and differs, with the sentence "Fix the group on Client Data or on the card" (2 clients today: نهوض نجد, Alkhalil).
  - **Old senders off first.** It refuses a recap kind until a Typeform and Make API read (cached 10 minutes) shows every old sender for that kind off: kickoff recaps need the `tG7dnxBn` `postcallsummary` webhook off (A3); Blueprint recaps and phase 5 need the `oYZKtogO` webhooks and Make `9748311` off (A1); check-in recaps need `WHTP4114295` off (B1) and Make `9209179` and `9523861` off (B2). The refusal sentence names what is still on.
  - **Never twice, no visible code.** No reference line is added to a client message (the guard's transport appends one, `transport.ts:254`; this worker turns it off). It reconciles by the WHAPI message id, and when the send's answer was lost, by a SHA-256 of the body among the group's messages from our number since the claim. The CSM's preview is exactly what is sent.
  - **Keys and discipline.** Keys are read by name. It has a `doctor`, tests, a cron under `flock` and a runbook row.
  - **Gate before the first live send.** Show that the guard's WHAPI number is the number Make's WHAPI posts from: compare the speakers in `wa_messages` for Make's phase 4 posts and the guard's posts. If they differ, item B5 goes to the CEO.

### 2.8 Replacing `fRokTITH` and Make `9209179` without double firing

1. **Shadow by replay.** Run the last 10 real `fRokTITH` responses (from `cockpit_csm_call_forms`) through the native planner in dry run. Compare its comment, Happiness and Last POC with what Make wrote on those cards. Fix the differences. (`fRokTITH` autosave went off in Stage 1, A4.)
2. **Before the cut-over.** B0 is done and the `cockpit-notices` doctor is green for `C09SVG6FHGU`. B1 and B2 wait until it is.
3. **Cut-over day.** The check-in effects get `owner = cockpit`. The same hour:
   - the `fRokTITH` webhook `WHTP4114295` goes off and the form is closed with "Write 1-1 notes in the cockpit" (B1, a team form);
   - Make `9209179` and Make `9523861` go off (B2).

   Make `9209179` then has no source: `tG7dnxBn` went in A3 and `oYZKtogO` in A1. The 20 old pending drafts are not sent.
4. **Links point at the cockpit:**
   - `CsmPage.tsx:635, 2027` (`checkinFormLink`);
   - `csmLinks.ts:76-77`;
   - `csmTemplates.ts:37`, and the media buyer copy `:34`;
   - `viktor-side-scripts/csm/csm_assistant.py:37`;
   - the ClickUp doc "Important Forms".
5. **After the cut-over.** `hermes/csm-calls` keeps reading `fRokTITH`. A response that still arrives is stored as `legacy`, with no effects and a health line.

### 2.9 Stage 2 is done when

- Every CSM 1-1 call in a week has native notes with a matched call.
- The worker keeps impromptu client calls.
- The recaps sent went through `hermes/client-messages` with a read-back.
- No Typeform check-in arrived after the cut-over.
- The kickoff and the Blueprint are registered in `cockpit_forms`, and their responses and effects are in the forms tables (4.1).

---

## 3. Stage 3 and on: every other form, in order

| Rank | Form | Kind | Why this place |
|---|---|---|---|
| 3.1 | Client extension `gqBcyK6g` | Native CSM action | The writer exists (billing Extend); two cards already disagree with ClickUp (RF F.1) |
| 3.2 | Pause request `CTUjv6l3` | CSM action plus a client consent page | Broken promise and missing Resume On (RF F.3) |
| 3.3 | Ticketing | Native, portal `/requests` | Every seat; 11 unrouted types (CT F2) |
| 3.4 | Contract termination `knIe4eF3` | Client page plus CSM churn confirm | 0 real responses against 4 churns; churn register empty (TI F4; RF F.3) |
| 3.5 | NPS `fuPgs85S` and CSAT onboarding `KbcbPA73` | One client survey page | Nothing stored, no client key (TI §3.5) |
| 3.6 | Client onboarding `KFRCXPFx` | Signed webhook now; native page in Stage 4 | Busy and client-facing; Make `8922994` writes the sheet that other scenarios read (MI §4.2) |
| 3.7 | Four Rs as "Log a win" | Native CSM action | Commission evidence; five copies of one form (TI §3.9) |
| 3.8 | New Client Form `BTzMwXiw` | Keep the embed; register it | Five readers (TI §3.7) |
| 3.9 | Reactivate your ads `ecJQ5Z5C` | Client page owned by the ad-billing guard | No reader today (TI §3.11) |
| 4 | Kickoff native, and onboarding native | Port Make `8925654` and Make `8922994` | Needs a group registry and the sheet out of the loop |

Every form below uses the backend in section 4 and the cut-over steps in 4.6.

### 3.1 Client extension `gqBcyK6g`

| | |
|---|---|
| Filler | The CSM |
| Where | The client header "Forms → Give more time"; the Money tab billing card; the billing sheet's Extend tab and the CEO Billing tab run the **same** action (`BillingSheet.tsx:783-850`) |
| Fields | Weeks (1, 2 or 4, required); reason (pick and a line, required); in or out of our control (required); client limitations (multi); "Did the client imply they will not continue if billed on schedule?" (required); the call where it was given (from the call store, Fathom link auto); "What would have prevented this?" The CSM, client and date are known. |
| Effects kept | Next Payment Date `669ae046` moves by the weeks, counted from the later of the card's date and today, the cockpit rule (`20261009a:390-392`; RF F.2). The "CLIENT EXTENSION" card comment (Make `9805665` [3]). The #csm-announcements post "{client} has been given a {n}-week extension" (Make `9000763` [5]), as a notice (the channel joins the allow-list in this stage's migration, after the doctor shows the bot a member). |
| Dropped | The "03.1: Extension Audit" sheet row. It is replaced by `cockpit_billing_events` and the CEO view; the sheet stays as history. |
| New | Current extension (weeks) `8cb9d308`, with one writer. The checkbox `9cfdb353` from the at-risk answer (RF F.4). An audit row. |
| Clear on end | The billing writer gains a daily step that sets `8cb9d308` to 0 when a grant's end date has passed, the rule the CEO pass uses today (`cockpit-ceo-api/extensions.ts:120`), so the field and the CEO extension-weeks metric (`hermes/ceo-refresh/native/metrics.ts:929`) do not stay inflated. |
| Delivery | `cockpit_billing_write` puts a billing item in the ClickUp writeback queue. The switch `CLICKUP_WRITEBACK_APPLY_BILLING=true` turns **every** billing item live (date, payment, resume and pause), so it flips only in the C1 window, after the Resume On fix (`20261009j`, 3.2) has shipped, and in the same hour Make `9805665` goes off, so no Extend moves a date twice (RF F.2). Before requeueing the two dry-run rows (Marble and more `86eymcqdq`, Liwan `86ewvnqj5`: 2 weeks, 2026-11-02), the CSM or the CEO confirms each extension still stands, because the billing log shows a payment chase on both clients every day from 10-20 to 10-25 (RF F.1). Each requeue uses a **fresh** plan, and the dates written are reported. |
| Retire | The `ceo-extensions-sync` cron `mahara-ceo-extensions-auto` (our own; Build), **only after** the clear-on-end step runs. At cut-over: the webhooks `WHTP4022911` and `WHTP4371922`, the form, and Make `9000763`, `9805665`, `8069181` (C1). The links at `csmLinks.ts:226`, `csm_daily.py:37`, `csm_assistant.py:40`. |
| Not verified | Whether the pay plan counts the CSM's $50 per extension (`csmLinks.ts:227`). If not, it goes to the pay-plan owner, not this build. The #csm-announcements channel id (read it when the stage starts). |

### 3.2 Pause request `CTUjv6l3`

| | |
|---|---|
| Fillers | **The CSM** opens the pause (client header "Forms → Pause this client" and the billing Pause tab, one action). **The client** signs the consent page, and only after the call that agreed the pause. A non-payment pause has no client page (TI F4). |
| CSM fields | Kind (client request or non-payment); start; restart (more than 14 days shows "a pause over 14 days ends the engagement"); 3 business days' notice met; the call where it was agreed; note |
| Client page | Reason, details, start, restart, two **required** consent ticks (the 90-day term keeps running and fees do not change; over 14 days ends the engagement), note. Name and company are shown from the card, not typed. Bilingual. |
| Order | CSM opens → (client request) the CSM sends the page, one tap through `hermes/client-messages` → the client signs → the CSM confirms → effects. Non-payment: the CSM confirms at once. |
| Effects kept, on confirm only | Client Status Paused, **by option id** `647c2928…`, not orderindex (CT gap 10); Paused On `930c49eb`; Resume On `d3c46259`; the "PAUSE REQUEST" comment with reason, dates and consents (Make `9805613`). Make `9686154`'s resume reminder then works, because it reads these fields by name. |
| New | Two tickets through the request-type table: "Client Pause ⏸️ (Tech)" on Operations / Tech, owned by the systems manager, and "(Media)" on Marketing / ADs, owned by the media buyer of record (3.3), each carrying the agreed start date. This ends the two-rule race (CT F1.4). **The cockpit never opens an ad hold.** The media buyer's own Pause & offboard opens the hold and pauses campaigns on the start date, because an active hold makes launch, campaign-control and native-worker writes refuse (PAUSE-OFFBOARD.md). The billing pause event, and billing now also writes Resume On (fix `20261009j`). The #csm-announcements post "Pause agreed: {client}, {start} to {restart}". On resume: the relaunch tickets, and status Active. |
| Fix | "Ask a team: Pause this client" sets its Request Type: add pause, relaunch and offboard to the map, looked up by name (`clickup-writeback/rules.ts:59-66`, `queue.ts:180-183`). |
| Retire | Webhook `WHTP4371898`, the form, and Make `9805613` (C2). The links at `csmLinks.ts:221`, `csm_assistant.py:39`, `csm_daily.py:38, 600`. |

### 3.3 Ticketing for everyone

| | |
|---|---|
| Filler | Every seat |
| Where | Portal `/requests` (new route beside `/team`, `AuthenticatedAppRoutes.tsx:120`). "Ask a team" in every cockpit sidebar beside Team meetings. The CSM client page's Ask a team panel and the media buyer reroute and offboarding write the same request, with the client prefilled. |
| Views | My requests, Assigned to me, the department queue, and All (admins and the CEO). Each row: type, client, due, priority, status chip, owner, the ClickUp link. |
| Request types | `cockpit_request_types`, seeded from the table below: fields (from the form rules in CT §2.2, filling the empty ones with client, details, deadline and priority; Privacy Policy uses `5000c43f`), list, template object, owner rule, default due, and the Slack channel through `task-assignment-alerts`. Admins edit the table through a gated, audited function. The seed step reads `GET team/90182518398/taskTemplate` and refuses a type whose template object's name does not match its source (objects are matched by name; their content cannot be read, CT F12). |
| Owner rules | **Systems manager** `113459516`. **CSM**: the card's CSM field, else the active CSM seat. **Creative strategist** `113520400`. **Media buyer of record**: the Blueprint `launch_assignee` setting (S4), because media buyer seats carry no client list and the card has no media buyer field (R). |
| Write | Through the ClickUp writeback queue, kind `request`. Create the task **from the template object on the target list** (`POST list/{id}/taskTemplate/{tid}` with the name, as `blueprint.ts:86` does), or `POST list/{id}/task` when the type has no template. Then set the assignee, tag, due date and priority, and set Request Type last, each read back. Two minutes after create, read the assignee again: where a list rule changed it (Client Success #3, Call Center #1, CT F3), put the owner back and read it once more. Add a link comment on the client card. Store the requester's seat on the row. |
| Folder rules | Before going live, one `[TEST]` ticket on each department list (Ops / Tech "General Tech Request", Marketing / ADs "General Marketing Request", Client Success "General CSM Ticket", Call Center "Low Show Rate", Media/Creative "New Script Request"), each on the internal test card, named "[TEST] Ticket rehearsal - {list} - {date}". These types have no folder-rule comment step known (CT F2, F3). Read assignee, list, name and comments at 2 minutes. Any `task-assignment-alerts` post they cause is named in C3 beforehand. Cancel them after. If setting Request Type moves or renames a task, do not set it on that list; keep the type in Supabase. |
| Mirror | A 10-minute `clickup-writeback` job reads open requests by task id and updates status and owner. It imports the 5 open "Form Submission" tasks in All Tasks (3 offboarding included) as unrouted requests on the right department queue. |
| New | An owner on every ticket, so `task-assignment-alerts` posts it. Offboarding and pause make both a Tech and a Media task. The client is picked from the cards (task id stored, tag added). |
| Fix | The wrong Request Type ids at `clickup-writeback/rules.ts:59-66` and `convex/writeback.ts:136-141`: look options up by name, on the folder field `e9fd8024-…`, never the Marketing / ADs list field of the same name (CT §7, F3). |
| Template drift | Re-save two templates in ClickUp before seeding (no API can): Client Pause (Tech) from `86ex63k45` (tasks get 4 of its 6 steps), and Switch Funnel Intent from `86exj3gab` (folder rule #23 applies an older object, `t-86exj3gfx`). Seed the new object ids (C3). |
| Retire | Two weeks after `/requests` goes live, the links point at the portal (`csmTemplates.ts:46`, `csm_daily.py:38`). The ClickUp form view `2kzmr1ky-1178` stays until the CEO decides to close it and whether to keep the ClickUp plan (C3, money). The sandbox `o0ULXQhD` webhook goes off and `9783436` stays off (C3). Then the create-time list rules that change assignees (Client Success #3, Call Center #1) go off (C3). |

**The 31 request types** (CT F8, F9; "two tasks" means both are created):

| # | Request Type | List | Template object | Owner |
|---|---|---|---|---|
| 0 | Connect a New Lead Form 🆕 | Ops / Tech `901816723190` | `t-86ex09tmh` | systems manager |
| 1 | Create Ad Account | Marketing / ADs `901816723196` | by platform: TikTok `t-86ex6ee7a`, Snapchat `t-86ex6ehwe`, Meta `t-86ex6f3q7` | media buyer of record |
| 2 | Missing Leads ❌ | Ops / Tech | `t-86ex09vmq` | systems manager |
| 3 | New Employee Onboarding 🤵 | Ops / Tech | `t-86ex09ytj` | systems manager |
| 4 | Employee Offboarding 👋 | Ops / Tech | none | systems manager |
| 5 | Create a Privacy Policy Request 📝 | Ops / Tech | none | systems manager |
| 6 | AD Spend Invoice Request🧾 | Client Success `901816723211` | `t-86ex6fpu3` | CSM |
| 7 | Whatsapp Connection Issue 🔁 | Client Success | `t-86ex62m1b` | CSM (systems manager as watcher) |
| 8 | Whatsapp Reactivation Campaign 📬 | two tasks: Media/Creative `901818016338` and Ops / Tech | `t-86exj3h8f` (message) and `t-86exghd6t` (send), matched by name | creative strategist, then systems manager |
| 9 | Add Custom Qualification Questions🙋 | Ops / Tech | `t-86exj3gx1` | systems manager |
| 10 | Client Offboarding Request 🔴 | two tasks: Ops / Tech and Marketing / ADs | `t-86ex629ve` (Tech), `t-86ex629x6` (Media) | systems manager; media buyer of record |
| 11 | Change From DFY to DWY 🔁 | Client Success | none | CSM |
| 12 | Change From DWY to DFY 🔁 | Client Success | none | CSM |
| 13 | Client Pause Request ⏸️ | two tasks: Ops / Tech and Marketing / ADs | `t-86ex63qk5` (Tech, re-saved), `t-86ex63qm7` (Media) | systems manager; media buyer of record |
| 14 | Client Relaunch Request ⏯️ | two tasks: Ops / Tech and Marketing / ADs | `t-86ex63qhr` and `t-86ex63qjj`, Tech and Media matched by name | systems manager; media buyer of record |
| 15 | Change Company Name🔃 | Ops / Tech | `t-86exj3n5t` | systems manager |
| 16 | Change Company Address🔃 | Ops / Tech | `t-86exj3ngz` | systems manager |
| 17 | Switch Funnel Intent🌪️ | Ops / Tech | the object re-saved from `86exj3gab` | systems manager |
| 18 | Create Landing Page📊 | Ops / Tech | `t-86exer2gv` | systems manager |
| 19 | Client Success Management Request 🙋‍♂️ | Client Success | none | CSM |
| 20 | Client Business License is Missing ❗ | Client Success | none | CSM |
| 21 | Client Card Missing for ADs ❗❗ | Client Success | `t-86ex6fdwu` | CSM |
| 22 | New Script Request 📗 | Media/Creative | `t-86ex63j6n` | creative strategist |
| 23 | Marketing/ADs Request 🃏 | Marketing / ADs | none | media buyer of record |
| 24 | Edit Existing Campaign Request 🎱 | Marketing / ADs | none | media buyer of record |
| 25 | Low Show Rate📉 | Call Center `901816723206` | `t-86exj3ddv` | CSM until a call centre lead seat exists |
| 26 | Low Schedule Rate📉 | by issue: Call Center, Marketing / ADs, or both | `t-86exj3cvt` and `t-86exj3d37`, Call Center and Ads matched by name | CSM; media buyer of record |
| 27 | General Tech Request | Ops / Tech | none | systems manager |
| 28 | General Marketing Request | Marketing / ADs | none | media buyer of record |
| 29 | General CSM Ticket | Client Success | none | CSM |
| 30 | Social Media Management Request | Media/Creative | none | creative strategist |

### 3.4 Contract termination `knIe4eF3`

| | |
|---|---|
| Fillers | **The client** fills it after the contractual exit call, never instead of it. It is also their written notice. **The CSM** confirms the churn in the churn tracker. |
| Where | Client page → Money → "Client is leaving". The "Send the exit survey" button appears once an exit call is logged, and composes the SOP text (EN and AR) with the token link. The churn tracker `/money?tab=churn`. |
| Client page | The notice-period line first; reasons (multi, required); three 1–10 ratings (ads, lead quality, communication, required); "How likely are you to recommend us?" 0–10; comments. Name and company come from the card. |
| Effects kept | The card comment and the #csm-announcements post "Contract Termination Survey submitted" go on submit (Make `9805538` [6][5]). Client Status Stopped (by option id), Churn Date, Churn Reason and Churn Type go **on the CSM's confirm**, with the reason and type picked by the CSM. They are not fixed to Cancelled and mid-programme. |
| Restored | The offboarding tasks from the inactive Make `8962418`: types 10 in 3.3, deduped against the media buyer offboarding by tag and type (`clientLifecycle.ts:36-48`). |
| New | A `cockpit_churn_departures` row on confirm. The notice date is stored. The response is stored by card. |
| Retire | Webhooks `WHTP4371873` and `WHTP4007438`, the form, and Make `9805538` (C4). The SOP links: mahara-context `client-comms/csm-templates.md:524-533`, `_RESOURCES.md:44`, the "Client Exit Process" doc, `csmLinks.ts:236`, `csm_assistant.py:42`. |

### 3.5 NPS `fuPgs85S` and CSAT onboarding `KbcbPA73`

| | |
|---|---|
| Filler | The client, on one survey page with two kinds. **Named by card**, because anonymous scores tie to nothing. The page says the answers go to the client's account team. |
| When | CSAT: once, 7 days after the first Launch Date `2e744484`. NPS: 60 days after launch, then every 90 days. Each ask lands in the CSM's Today list. The CSM sends it with one tap through `hermes/client-messages`. |
| Questions | NPS: one true 0–10 "How likely are you to recommend us?", a 1–10 communication rating, one text box. CSAT: 1–10 onboarding, what you liked, what you did not. Nothing typed that the card knows. |
| Effects kept | The #nps-survey-feedback `C09TTGBRQ0G` post (Make `8962328`, `8962387`), as a notice. The bot is not a member today (R), so C5 starts with the invite, and the stage's migration adds the channel to the allow-list; the doctor must be green before C5's switches. |
| New | Scores stored by card. A "Client voice" card on the client page and a line in the brief. A CEO metric: NPS as the share of promoters minus the share of detractors, with n and the date range, and "No scores yet" when there are none. A low score (≤ 6) raises a CSM request and tags the CSM seat in #csm-general. |
| Retire | Webhooks `WHTP4007419` and `WHTP4007430`, both forms, and Make `8962328`, `8962387`, `8068892` (C5). The links at `csmLinks.ts:138, 143` and the media buyer copies. |

### 3.6 Client onboarding `KFRCXPFx`

| | |
|---|---|
| Filler | The client, in the WhatsApp welcome from Make `8979157` [40] |
| Now (3.6) | A signed Typeform webhook into `forms-door/typeform`, the `team-onboarding-intake` code. It stores the response and kicks a one-card onboarding refresh, so the kickoff prefill is fresh at once instead of up to 10 minutes late. Its effects stay `make`: Make `8922994` keeps every effect. Adding the webhook is C6. |
| Stage 4 | A native public page, phone-first, Arabic first, with the onsite logic. It prefills from the New Client Form, so the client is not re-asked name, phone, email, business or website. All Make `8922994` effects are ported: Client Profile `7755485f`, the Kickoff Form Link (written by the cockpit then, and the prefill reads the cockpit's stored answers instead of the link, with its tests changed first), the raw-answers comment, the map at phase 3 plus the phase 3 WhatsApp through `hermes/client-messages`, the Brand DNA task on Media/Creative, and the market-intel job queued on the VPS without the GitHub hop. |
| Stage 4 prerequisite | A Supabase client-group registry (`cockpit_client_groups`) seeded from Client Data column F and reconciled with `b1d54dfb`, and Make `8925654`, `9748311` and `9356423` no longer reading the sheet. Make `8922994` [31] writes the sheet those scenarios read (RF F.5). |

**Stage 4, kickoff native.** It ports Make `8925654`:

- the handoff comment;
- IN PROGRESS;
- the Technical and Creative tasks from `t-86ex8x9xw` and `t-86eyu1w3d`;
- the card fields, Service Advertised included;
- Brand Blueprint Booked, **forward only**;
- map phase 4 and the WhatsApp.

Then Make `8925654` goes off.

### 3.7 The four Rs as "Log a win"

| | |
|---|---|
| Filler | The CSM, from the Money tab |
| Fields | Type (review, video testimonial, referral, website, SMM or backend upsell); proof link; closed yes or no; date; cash collected (upsells and referrals); notes |
| Effects kept | The card comment and the #csm-announcements post |
| Dropped | The "04: Referrals, Upsells, Reviews" sheet row. The pay plan reads the stored wins (`csmMoney.ts:120-185`). |
| Retire | The five forms below, their webhooks and scenarios (C7). The links at `csmLinks.ts:180` and the ClickUp doc. |

| Form | Typeform | Webhook | Make |
|---|---|---|---|
| Client Review | `ETEynRgb` | `WHTP4096883` | `9169735` |
| Referral | `bAmbMKM2` | `WHTP4105426` (and the disabled `phoenix:1778072965455`, no scenario) | `9188441` |
| Backend program upsell | `cKItPZVI` | `WHTP4105956` | `9190294` |
| Website upsell | `VP3zmaj2` | `WHTP4108828` | `9195843` |
| SMM upsell | `IVHO9BMC` | `WHTP4112950` | `9205789` |

(MI §3 table rows 174-178; TI §3.9)

### 3.8 New Client Form `BTzMwXiw`

| | |
|---|---|
| Kind | It **stays the Typeform embed** in the sales cockpit. Nothing may imitate a submission, because Make `8979157`, HighLevel, Cortana and B2B `closed_deals` read it (RF §3). |
| Backend | A registry row (`provider typeform`, every effect owned by `make`). The `cockpit_sales_client_forms` rows are copied into `cockpit_form_responses` (`source embed`). A signed cockpit webhook into `forms-door/typeform` records every response, embedded or not (C6). It runs no effect. |
| Easier | The side sheet shows the Fathom sales recording link and transcript to copy (from `cockpit_sales_recordings`), and the six money numbers worked out from the payment plan pick. |
| Clean-up | Webhook `WHTP4096881` into the inactive Make `9169732`, which holds 5 queued deliveries, goes off (C8). |

### 3.9 Reactivate your ads `ecJQ5Z5C`

| | |
|---|---|
| Kind | A client page owned by `hermes/ad-billing-guard`. It is filled with `client_id`, `payment_id` and `min_spend`, has two legal ticks and a typed signature, and is Arabic and English. The answer is stored, and the media buyer gets a "relaunch" request. |
| Now | Remove the bare link from the Links page (`csmLinks.ts:231`) and `csm_assistant.py:41`, because a submit does nothing (Build). |

### 3.10 Every other form: move, leave or retire

| Form | Id | Owner feature | Decision | Who |
|---|---|---|---|---|
| Client Card Info, Make `9018535`, legacy `7908153` and `8069605` (card number and CVV fields) | `Uju17Z13` | none | Retire. Remove the link now (`csmLinks.ts:146-149`, media buyer `csmLinks.ts`). Then the scenarios go off, the form closes, and the CEO reviews and clears the sheet and DM that hold card data. | Build (link); CEO (C9) |
| Site Design Details (`9282377`) | `PjfTJypg` | none | Retire: request type Create Landing Page | CEO (C9) |
| Lead list (`9122691`) | `uXtImBuZ` | none | Retire: request type Whatsapp Reactivation Campaign | CEO (C9) |
| Old onboarding | `Aa6nUPOs`, `uUEp9YwJ` | none | Retire the links (`media-buyer-cockpit/src/lib/csmTemplates.ts:35`, the ClickUp doc); close the forms | Build (links); CEO (C9) |
| Old kickoff | `BbJy6xg4` | none | Retire the links; close the form | Build (links); CEO (C9) |
| Opt In Form (live webhook into the inactive Make `9165775`) | `gBpJpsLi` | none | Retire: webhook off, form closed | CEO (C9) |
| ClickUp "Client Update Form", Make `8903351` | `2kzmr1ky-2278` | none | Retire: the native 1-1 notes replace it | CEO (C9) |
| ClickUp "Project Intake Form" | `2kzmr1ky-2258` | none | Retire: the native extension replaces it | CEO (C9) |
| ClickUp "Campaign Launch From" | `2kzmr1ky-2298` | none in the repo (R) | Retire if no task came from it in 60 days: Blueprint part 1 and the Ads launch flow replace it | Build (check); CEO (C9) |
| ClickUp "Order Form" | `2kzmr1ky-4338` | none in the repo (R) | Retire if no task came from it in 60 days | Build (check); CEO (C9) |
| ClickUp new client card form "🚀" | `2kzmr1ky-1078` | none in the repo (R); Make `8979157` makes cards from `BTzMwXiw` | Retire if no task came from it in 60 days | Build (check); CEO (C9) |
| ClickUp "Payment Failure" | `2kzmr1ky-1218` | media buyer cockpit (`CockpitPage.tsx:3038`); its list rule #1 alerts the client and team | Leave. A later move belongs to the ad-billing guard, not this plan | — |
| ClickUp "Launch New Campaign" | `2kzmr1ky-3878` | media buyer cockpit (`convex/constants.ts:34`) | Leave | — |
| ClickUp "Report WhatsApp Disconnection" | `2kzmr1ky-6778` | none in the repo; the WhatsApp Reconnection list calls two webhooks whose target is not verified (CT F3) | Leave until that target is known | — |
| ClickUp review inbox form | `2kzmr1ky-7638` | video team, created 2026-10-18; none in the repo | Leave | — |
| ClickUp Video Request Form | `2kzmr1ky-1058` | creative director cockpit (`creativeLinks.ts`) | Leave | — |
| ClickUp portal tasks form | `2kzmr1ky-7138` | CSM portal tasks (`portalTasksCore.ts`) | Leave | — |
| Team Onboarding | `Cef2QGBh` | Supabase `team-onboarding-intake` | Leave | — |
| Free Gift Survey | `P1xP4r24` | `hermes/webinar-pull` | Leave | — |
| Team EOD forms, job applications | — | EOD and recruiting features | Leave | — |
| Anonymous Survey, Make `8232835` | sender unknown (CT F10) | none | Leave until the sender is known | — |

---

## 4. The one forms backend

### 4.1 Tables

All in Creative Triage, prefix `cockpit_`. Each migration does the
following:

- turns row security on;
- revokes from `PUBLIC`, `anon`, `authenticated` and `service_role`, then grants the service role exactly what it needs, in the same file;
- reaches browsers only through `SECURITY DEFINER … SET search_path = ''` functions with the gate first;
- writes an audit row per write;
- ends with `NOTIFY pgrst`;
- applies twice without error (RF §7.2), shown as in 1.7.

| Table | Stage | Holds |
|---|---|---|
| `cockpit_slack_notices`, `cockpit_slack_notice_settings` | 1 | The Slack outbox (1.3) |
| `cockpit_forms` | 2a | The registry: `key`, `title`, `audience` (team or client), `provider` (native, typeform or clickup), `typeform_id`, `version`, `schema` (questions, types, required, choices; `blueprintForm.ts` is the model), `seats`, `client_scoped`, `effects` (a list of `{key, owner}`, owner `make`, `shadow` or `cockpit`). Seeded with `kickoff` (typeform `tG7dnxBn`; card effects `make`, notice `cockpit`, recap `cockpit` behind 2.7's gate) and `blueprint` (native; every effect `cockpit`, delivered by the creative API) |
| `cockpit_form_responses` | 2a | One row per submission. `id` (the browser's request ID, or generated for Typeform), `form_key`, `form_version`, `source` (`cockpit`, `embed`, `typeform_webhook`, `typeform_sync`, `public`, `import`), `external_id` (`UNIQUE (form_key, external_id)`), `task_id`, `client_name`, `answers`, `hidden`, `prefill_from`, `state` (`draft`, `submitted`, `confirmed`, `legacy`, `void`), `revision`, `submitted_by`, `submitted_at`, `confirmed_by`, `confirmed_at`. Kickoffs arrive by the signed webhook (C6) and by the mirror (`typeform_sync`) as the second source. Each Blueprint part press writes one row (`source cockpit`). |
| `cockpit_form_effects` | 2a | The fan-out ledger. `response_id`, `effect_key`, `dedupe_key` UNIQUE (`response_id:effect_key`), `owner` (copied from the registry at plan time, re-checked at claim), `delivery` (`clickup_queue`, `slack_notice`, `client_message`, `creative_outbox` or `sql`), `delivery_ref`, `plan`, `receipt`, `state` (`planned`, `dry_run`, `queued`, `delivered`, `failed`, `unknown`, `skipped`), `error`. A Blueprint press points `delivery_ref` at its `cockpit_creative_outbox` row; the kickoff's Make effects are recorded `skipped` with `owner make`. |
| `cockpit_form_drafts` | 2a | AI drafts: `response_id`, `kind`, `model`, `prompt_version`, `text`, `edited_text`, `state` |
| `cockpit_client_messages` | 2a | The WhatsApp outbox: `task_id`, `kind` (recap, phase 5, survey ask, page link), `body`, `body_sha256`, `group_source`, `state` (`draft`, `approved`, `claimed`, `sent`, `unknown`, `failed`, `refused`), `approved_by`, `provider_id`. A claim is `update … set state='claimed' where state='approved' returning`. |
| `cockpit_form_links` | 3.2 | Public page tokens: the sha256 of 32 random bytes, `task_id`, `form_key`, `expires_at` (14 days), `used_at`, `opened_at` |
| `cockpit_request_types`, `cockpit_requests` | 3.3 | Ticketing: types and routing; a request row tied to its response, with requester seat, ClickUp task id and mirrored status |
| `cockpit_client_groups` | 4 | The WhatsApp group registry |

Compatibility: native 1-1 rows are also written into `cockpit_csm_call_forms`.
`cockpit_csm_form_sends` and `cockpit_sales_client_forms` stay, and their
rows are copied into `cockpit_form_responses` with `source = embed`.

### 4.2 Functions and workers

| Piece | Door | Job |
|---|---|---|
| RPCs `cockpit_form_open`, `_save`, `_submit`, `_confirm`, `_responses_read`, `_link_issue` | `authenticated` | Gate first: `cockpit_csm_client_gate` for client forms, a role gate for team forms, `cockpit_client_allowed` for portal reads. They validate against `cockpit_forms.schema`, write the response, plan each effect **in the same transaction** by its owner (`dry_run` when `shadow`, `skipped` when `make`), and write one audit row. |
| `cockpit-forms-api` | `verify_jwt` on | Prefill reads that need a provider (the Fathom pull, the call store), AI drafts, and a "run my effects now" kick after submit |
| `forms-door` | `verify_jwt` off | Three routes, as `sales-live` does. `typeform`: HMAC per webhook secret, only `form_response` of the expected form, 500 on a store failure so Typeform retries. `public`: token pages, with a host allow-list and a rate limit. `cron`: `x-cron-secret`, every 2 minutes, turns `planned` effects into delivery rows and settles them from the delivery states. **It never calls ClickUp, Slack or WHAPI itself.** |
| `cockpit-notices` | cron (1.7) | The only Slack sender (1.3) |
| `clickup-writeback` (existing) | cron | The ClickUp writer for forms, except Blueprint presses (D9). New kinds `form` and `request`, with a switch `CLICKUP_WRITEBACK_APPLY_FORMS`, a template-create step and the request mirror job. Reference lines and a read-back before any retry, as today. |
| `cockpit-creative-api` (existing) | `verify_jwt` on, plus the cron branch | The named exception: the ClickUp writer for Blueprint presses only, through its fenced plans; it posts nothing to Slack (D5) |
| `hermes/client-messages` (VPS) | cron under `flock` | The only WhatsApp sender (2.7) |
| `fathom-webhook` | `verify_jwt` off, signed | Fathom intake (2.2) |

### 4.3 Effect states, and never firing twice

- A response plans its effects once, keyed `response_id:effect_key`. A repeat submit with the same request ID returns the first result.
- Each delivery outbox has its own unique key, equal to the effect's `dedupe_key`. A delivery settles the effect: `delivered`, `failed` or `unknown`.
- The ClickUp queue reads a write back before retrying. Slack and WhatsApp never resend an unknown.
- The owner is checked per effect when a delivery is **claimed**, not only when it is planned. Switching one effect back to `make` stops its queued work at once (RF §8.6), without touching the form's other effects.
- A Typeform response to a form whose effects are all `cockpit` is stored as `legacy`, with no effects and a health line. For a **client** form (termination, pause, NPS, CSAT, onboarding) it also queues a #csm-general notice for the CSM seat: "{form} came in through the old link for {client}. Open it in the cockpit." A termination survey is the client's written notice, so its date is kept as the notice date.

### 4.4 The public page pattern

- `sites/forms` follows the `sites/call-link` pattern: plain files on Vercel, the Mahara teal-and-white lockup, Arabic first with English beside it, phone-first, no third-party script, CSP and no-index headers.
- Served at `forms.maharamedia.com/{token}`; the CNAME is C10.
- The page asks `forms-door/public/open/{token}` and gets back only the form schema, the client's first name, the company and the language. It posts the answers to `forms-door/public/submit/{token}`.
- Limits as the call link has them: 30 opens a minute from one browser and 120 from one network. States: opening, invalid, expired, already sent, busy, error, each with a line that says what to do next.
- A token is per card and form, single submit, valid 14 days. The CSM sends it from the cockpit, never as a bare Typeform link.

### 4.5 Rules each build checks

| Rule | How it shows |
|---|---|
| Gated on the server | Every RPC's gate first; `forms-door/public` checks the token; the creative drain checks the presser's gate at run time |
| Audit | One `cockpit_audit_log` row per write, through the function or a trigger |
| Ledger | Slack and Fathom calls go through `cockpit-csm-api/tools.ts`, models through `model.ts` with its health callback, ClickUp through `clickup-writeback` (or the creative API's provider ledger for Blueprint presses), WHAPI through the guard's transport with an intent row |
| Missing is never zero | "Not posted: {reason}", "No Fathom call matched yet", "No scores yet (no survey sent)", "AI drafts are off: no key", "The card has no Kickoff Handoff comment", "This press was refused: {sentence}" |
| Workers | Keys read by name, a `doctor`, tests, cron under `flock`, a runbook row, a guardian queue row per outbox (the creative outbox included) |
| Second source | Notices: trigger plus sweep. Kickoff responses: webhook plus mirror. NPS figure: n and dates beside it. Extension: mirror against ClickUp, compared in the billing sync |

### 4.6 Retiring Typeform and Make, form by form

1. **`make`.** The cockpit stores responses and runs only effects whose owner is `cockpit` and that Make never had, such as a notice.
2. **`shadow`.** Replay recent real responses through the planner in dry run, and compare with what Make wrote.
3. **One cut-over window per effect group.**
   - set those effects' owner to `cockpit`;
   - turn the form's webhooks off and close the Typeform (CEO batch). A team form closes with "Use the cockpit". A client form closes with "Please message your account manager on WhatsApp." and "يرجى التواصل مع مدير حسابك على واتساب.";
   - switch the scenarios off;
   - repoint every link in the inventory below.
4. **After 14 days with no `legacy` response,** move the scenarios to Make's 09 Archive folder. Nothing is deleted.

| Link place | Forms |
|---|---|
| `apps/client-success-cockpit/src/lib/csmLinks.ts`, `csmTemplates.ts`, `CsmPage.tsx`, `onboardingCore.ts` | All CSM and client forms |
| `apps/media-buyer-cockpit/src/lib/csmLinks.ts`, `csmTemplates.ts` | The same seven, plus the old kickoff |
| `viktor-side-scripts/csm/csm_assistant.py`, `csm_daily.py` | Pause, extension, reactivate, termination, the ticket form |
| ClickUp card fields Pause, Extension and Termination Form Link (64 cards, no writer; TI F2) | Left as they are: no new writer. The cockpit is the way in. |
| mahara-context `client-comms/csm-templates.md`, `_RESOURCES.md`; Google docs "Client Exit Process"; ClickUp doc "Important Forms" | Termination, call notes, onboarding |

### 4.7 Design, for every form screen

- Before each new or reshaped screen, load `mahara-context/skills/frontend-design/SKILL.md` and Hallmark (memory design-skills-hallmark), and write the design plan: tokens, type, layout, one signature element. Run the slop test on screenshots before shipping.
- **Inside the cockpits:**
  - Geist, with Arabic in IBM Plex Sans Arabic inside `<bdi dir="auto">`;
  - `--mahara-teal` as the one primary, and `--primary-ink` for teal text in light mode (`KICKOFF.md` §6);
  - the CEO kit (`SectionCard`, `StatTile`, `StatusChip`, `EmptyState`, `format.ts`), with no second palette.
- **Signature elements:**
  - kickoff and Blueprint: the after-send trail with its Slack stop;
  - 1-1 notes: the "This call" card, with the match reason and the evidence quote behind the DEFCON suggestion;
  - requests: the queue with status chips;
  - public pages: the call link's look.
- **Copy:** plain and active ("Send" becomes "Sent"). Empty and error states say what to do next.


### 4.8 Editing forms and routing (D17)

| What | Where it lives | Who edits | Screen |
|---|---|---|---|
| Notice kinds: on/off, channel, mention rule | `cockpit_slack_notice_settings` (kind, `on`, `channel`, `mention_rule` = `seat:creative` / `seat:csm` / `seat:systems_manager` / `people` / `none`, `mention_people` Slack ids, `updated_by`, `updated_at`) | editor gate | "Notices and routing" card on CSM Settings, one row per kind, a "Send a test to me" button that runs `rehearse` |
| Channels a notice may use | `cockpit_slack_channels` (id, name, private, `added_by`). Replaces the CHECK allow-list of 1.3 | editor gate; the save calls the doctor and refuses a channel the bot is not in, naming the fix ("Invite @mahara-club-bot to #x, then add it again") | the same card |
| Ticket routing (3.3) | `cockpit_request_types` (list, template, owner rule, named owner, due, priority, fields) | editor gate | portal `/requests/settings` |
| Form questions (native forms, from Stage 2a) | `cockpit_forms.schema` with `cockpit_form_versions` (version, schema, `published_by`, `published_at`) | editor gate | a form editor beside each form: add, reword, reorder, require, choices, show-if; a live preview; Publish makes a new version; "Go back to version n" |
| Typeform forms still in use (kickoff, New Client Form) | Typeform | as today, in Typeform | a link "Edit in Typeform" for editors, and a note that hidden fields must keep their names |

Rules: the gate is checked in the database function, never only in the screen. A change never rewrites a submitted response. Effects map answers by stable field keys, so a reworded question keeps its effect; deleting a field that an effect reads is refused with the effect named. Every routing read happens at send time, so a change applies to the next notice or ticket without a deploy.

---

## 5. Risks, and what waits on the CEO

### 5.1 Risks

| Risk | Guard |
|---|---|
| Two senders of one client message during a cut-over (Make phase 4 or 5, and the cockpit) | One owner per effect (D13), and the worker refuses a kind until an API read shows the old sender off (2.7). Phase 5 also checks the group's history. |
| The bot is not in a channel a notice moves to | The doctor checks every allow-listed channel; B0 and C5 invite it; cut-overs wait on a green doctor |
| A Make edit to a live scenario breaks a later route | The Ignore error handler on [21] goes in first; the late notice is the check; no "Run once" on a client scenario |
| The kickoff prefill loses its fallback values | Kickoff Form Link `87d7d889` is never rewritten before Stage 4 (S15 dropped) |
| A refused Blueprint press runs days later | The drain takes only rows under 30 minutes, re-checks the gate, and fails a row after 3 refusals (1.3) |
| A close for a live client moves its map back | The nudge filter (S8) and the phase-5 skip in the close plan |
| Folder or list rules move, retemplate or reassign cockpit tickets | One `[TEST]` ticket per department list first, and the assignee re-read at 2 minutes (3.3) |
| The mirror trigger breaking the 10-minute publish | A body that never raises, plus the sender's sweep (1.3) |
| The guard's WHAPI number is not Make's | Checked before the first live send (2.7) |
| No model key, or credits run out (Make `9209179` stopped on 30 Sep) | Drafts are optional (D15) |
| Every ClickUp write shows as the CEO's API user | The requester and author live in Supabase; reference lines on every write |
| Private Fathom recordings are invisible to the webhook | A guardian line on `shared_with`: "3 of today's calls are private in Fathom; share them with the team" |
| Group mismatch (2 clients) | Refuse, with a sentence (2.7) |
| Turning the billing writeback on makes every billing item live | It flips only in the C1 window, after the Resume On fix, with both extensions confirmed first (3.1) |
| An ad hold opened too early freezes ad work | The cockpit never opens holds; the media buyer does on the start date (3.2) |
| New clients have no lifecycle links | The cockpit is the way in (4.6) |
| A public page is a new attack surface | Hashed single-use tokens, nothing personal in the URL, rate limits, CSP, no third-party script |
| Client Arabic quality | `aziz-kuwaiti-voice`, the CSM's approval, no numbers |
| Old approval links (Make `9523861` hook, no key) | Make `9523861` goes off in Stage 2 (B2) |
| The churn register is empty (0 rows against 27 Stopped) | Out of scope for forms. The register gets rows from 3.4 on, and the importer for the 5 churn-dated cards belongs to the churn tracker. |

### 5.2 The CEO batch

No item is a message sent in the CEO's name. Each stage's items are sent
together at the end of that stage's build. The cockpit side is already built
and waits on these switches, never the other way round. **Who does it:** on
his yes, the build session applies each Make, Typeform and ClickUp-setting
item through the API (or the built-in browser where no API exists), reads it
back and reports (D16). Only the items marked "his" are his to do: logins,
money, DNS, and Slack invites (no invite tool is connected).

| Id | Stage | Item | Kind |
|---|---|---|---|
| A1 | 1, after the first native close settles `done` (test card or real) | Turn off both `oYZKtogO` webhooks (`blueprint`, `postcallsummary`), close the form, switch off Make `9748311`. The same release removes the Typeform Blueprint branch from the notice trigger | Make and Typeform switch |
| A2 | 1A | Make `8925654` [21], in S14's order: Ignore error handler, cockpit Blueprint URL into `1b7a4a74`, Service Advertised first label to option id, Client Status forward only | Make edit |
| A3 | 1A | `tG7dnxBn`: `postcallsummary` webhook off; the ending's sentence changed (S17) | Typeform switch and edit |
| A4 | 1A | `fRokTITH`: autosave off and partials to integrations off (S18) | Typeform setting |
| A5 | 1B | Rotate the GitHub token in Make `8922994` [25], in S16's order | **His:** login |
| A6 | 1B | The supervised proof run on the internal test card, with what it causes (1.6) | Approval |
| A7 | 1B | The creative director sets the launch media buyer in Settings (S4) | Creative director: one click |
| B0 | 2a | Invite mahara-club-bot to #client-call-feedback `C09SVG6FHGU` (`/invite`) | **His:** Slack invite |
| B1 | 2b, cut-over day, doctor green | `fRokTITH`: webhook `WHTP4114295` off, form closed | Typeform switch |
| B2 | 2b, the same hour | Make `9209179` and `9523861` off | Make switch |
| B3 | 2a | Add the signed cockpit webhook to `tG7dnxBn` (store only; its effects stay `make`) | Typeform change |
| B4 | 2 | Paste any model key the doctor reports missing (Anthropic, DeepSeek) into Connections | **His:** keys and money |
| B5 | 2 | Only if the WHAPI numbers differ: which number the cockpit sends from | **His:** account |
| C1 | 3.1 | Extension: webhooks `WHTP4022911`, `WHTP4371922` off, `gqBcyK6g` closed, Make `9000763`, `9805665`, `8069181` off, and `CLICKUP_WRITEBACK_APPLY_BILLING` on, in one window after the Resume On fix; the two extensions confirmed first | Make and Typeform switch; confirmation |
| C2 | 3.2 | Pause: webhook `WHTP4371898` off, `CTUjv6l3` closed, Make `9805613` off | Make and Typeform switch |
| C3 | 3.3 | The five `[TEST]` tickets and the alerts they cause; re-save the two drifted templates; sandbox `o0ULXQhD` webhook off. Two weeks after `/requests`: Client Success #3 and Call Center #1 list rules off, close the ClickUp ticket form, and decide whether the ClickUp plan is still worth paying for | ClickUp and Typeform; **his:** money |
| C4 | 3.4 | Termination: webhooks `WHTP4371873`, `WHTP4007438` off, `knIe4eF3` closed, Make `9805538` off | Make and Typeform switch |
| C5 | 3.5 | Invite mahara-club-bot to #nps-survey-feedback `C09TTGBRQ0G` (**his**); then webhooks `WHTP4007419`, `WHTP4007430` off, both forms closed, Make `8962328`, `8962387`, `8068892` off | Slack invite; Make and Typeform switch |
| C6 | 3.6, 3.8 | Add the signed cockpit webhook to `KFRCXPFx` and to `BTzMwXiw` | Typeform change |
| C7 | 3.7 | Four Rs: the five webhooks in 3.7 off, five forms closed, Make `9169735`, `9188441`, `9190294`, `9195843`, `9205789` off | Make and Typeform switch |
| C8 | 3.8 | `BTzMwXiw` webhook `WHTP4096881` off (5 deliveries queued to the inactive Make `9169732`) | Typeform switch |
| C9 | 3.10 | Retire the "Retire" rows of 3.10, and review and clear the sheet and DM holding card data | Make, Typeform and ClickUp switches |
| C10 | 3.2 | The DNS CNAME `forms` for `forms.maharamedia.com` | **His:** login |

---

## 6. Build sessions, in order

| # | Session | Scope | Done when |
|---|---|---|---|
| 1 | Stage 1A, ships today | Notices migration (tables, RPCs, kickoff and Blueprint triggers, sweep, seed, state guard), `cockpit-notices` (doctor, dry run, rehearse, reconcile, mention resolution, text), `slackTools`, S2, S3, S9, S10; PGlite and unit tests; deploy `cockpit-notices` and `cockpit-creative-api`; ship client-success and creative; A2–A4 applied on the CEO's yes | 1.5 checks for these pass on production; the notices run on real events from here |
| 2 | Stage 1B | S1, S5 (drain migration, cron branch, loader refactor), S6 (native release), S8, S11 screens, S12, S19, guardian rows, docs (`KICKOFF.md`, `brand-blueprint/SPEC.md`); A5–A7; the proof run (1.6); then A1 | 1.8 "Shipped" and the proof run |
| 3 | Stage 2a: Fathom and backend core | 2.2 worker changes, key copy, `fathomTools`; forms core migration (`cockpit_forms` with `kickoff` and `blueprint`, `_responses`, `_effects`, `_drafts`, `cockpit_client_messages`; `C09SVG6FHGU` on the allow-list); Blueprint presses written into the forms tables; `forms-door` with the Typeform route; `hermes/client-messages` with dry run; B0, B3 | Doctors green, `C09SVG6FHGU` included; WHAPI number checked |
| 4 | Stage 2b: 1-1 notes | 2.4–2.8, the kickoff and Blueprint recaps and phase 5, replay shadow, cut-over (after one real kickoff and one real Blueprint notice) | 2.9; B1, B2, B4, B5 sent |
| 5 | Stage 3.1–3.2 | Resume On fix first; extension with clear-on-end; pause (the public page needs C10) | Card and mirror agree; one confirmed pause or extension end to end |
| 6 | Stage 3.3 | `/requests`, the request table and its 31 rows, the rehearsal tickets | Every rehearsal ticket kept its owner; every new ticket has an owner |
| 7 | Stage 3.4–3.5 | Termination, surveys | First survey stored and shown on a client page |
| 8 | Stage 3.6–3.10 | Onboarding webhook, Log a win, New Client Form registry, Reactivate, the 3.10 decisions | C6 done; wins feed the pay screen |
| 9 | Stage 4 | Group registry; onboarding and kickoff native (prefill and its tests changed before the Kickoff Form Link is rewritten); Make `8922994` and `8925654` off | No Make scenario left on a form the cockpit owns |

Each session ships with `scripts/ship.sh <app>` (`client-success`,
`creative`, `media-buyer`, `sales`, `video-editor`; ship.sh:124-130), deploys
functions and migrations as in 1.7, checks the live bundle, records itself in
mahara-context `shared/sessions/`, and reports its CEO items in one list at
the end.

---

## 7. Checks made for this revision (R)

All read-only, 2026-10-25.

| Check | Result |
|---|---|
| `slack_list_channel_members C09SVG6FHGU` | 3 members, mahara-club-bot not among them |
| `slack_list_channel_members C09TTGBRQ0G` | 2 members, mahara-club-bot not among them |
| `clickup_get_custom_fields` on `901816559981` | `bab9a58b` Service Advertised is `drop_down` with six options; `87d7d889` Kickoff Form Link is a URL; no media buyer field on the card |
| `clickup_filter_tasks` on `901816723196` (100 latest main tasks) | The 5 main tasks assigned since mid-October all carry `113428468` (one also carries the systems manager); no task carries `119413219` |
| SQL `cockpit_members` | Media buyer seats have empty `clients` |
| SQL blueprint calls without part 2 | 8 cards; 5 Active at map phase 6, 3 at phase 4 |
| SQL test card `86eywg1cq` | Present, Stopped, no kickoff, links `clickup` only |
| SQL kickoffs in the mirror | 30, all older than 48 hours |
| Code | `prefill.ts:176-197` (card link use), `outbox.ts:49-69` (reconcile after start), `cockpit-creative-api/index.ts:20` (`getUser` first), `20260927s…sql:54` (`auth.uid()` fence), `20261024a…sql:1145-1155, 1162, 1182, 1260` (settings gates and grants), `blueprint.ts:111-132` (routes), `cockpit-media-api/slack.ts:4` (DM default), `formStatus.ts:41-53`, `scripts/ship.sh:124-130`, `cockpit-ceo-api/extensions.ts:120` (weeks 0 at end), `cockpit-csm-api/core.ts:26-27` (Last POC and Last Check-in Call), `ad-billing-guard/transport.ts:254` (visible reference line), `cockpit-guardian/checks/queues.py` (no creative outbox; reads `status`), `onboarding-sync/sync.ts:217` and `csm-calls/sources.ts:39` (only counters), PAUSE-OFFBOARD.md (hold refuses launch and campaign writes) |

---

## Review 2026-10-25

1. Bot not in #client-call-feedback (B batch vs C5): fixed. Verified (R). The invite is B0 in Stage 2a, `C09SVG6FHGU` joins the allow-list in the Stage 2a migration, the doctor checks every allow-listed channel, and B1/B2 wait on it (2.6, 2.8, 5.2).
2. Service Advertised `map()`/`join()`: fixed. Verified single-select (R). First label to option id, unset for Other; Ignore handler first; forward-only status by `if()` (S14, A2).
3. Window URL into Kickoff Form Link: fixed. S15 dropped; `87d7d889` keeps Make's link; no edit to Make `8979157` or `8922994`; the window URL lives in the cockpit (S10); Stage 4 changes the prefill first (3.6).
4. Drain with no age limit or attempt count: fixed. Under 30 minutes, older rows failed, 3 refusals then failed with the sentence on the card, the presser's gate re-checked (1.3 Drain).
5. Nudge with no stage filter: fixed. Verified 8 cards, 5 live (R). Stage and phase filter; the close plan skips the map write at phase 5 or higher; an "already live" line in the notice (S8, S2).
6. One owner per form: fixed. Owner per effect (D13, 4.1, 4.3, 4.6); the worker refuses a recap kind until an API read shows the old sender off (2.7).
7. Billing switch and requeue: fixed. The switch flips in the C1 window after the Resume On fix; both extensions confirmed first; dates reported (3.1, C1).
8. Pause hold at confirm: fixed. The cockpit raises the (Media) request with the start date and never opens a hold (3.2, D11).
9. Template applied to an existing task: fixed. Create from the template on the list, then the fields, Request Type last; `[TEST]` tickets with alerts named in C3 (3.3).
10. Launch assignee without evidence: fixed. Verified 113428468 holds the work and seats have no client list (R); S4 uses that with evidence re-read, and the request table reuses it as the media buyer of record.
11. Partials claim and notice wording: fixed. "Not verified (September evidence)" (1.1); notice lines state what the card shows; every kickoff needs a handoff comment newer than `submitted_at` (1.3).
12. Fathom webhook on `my_recordings`: fixed. `shared_team_recordings` only; bodies never logged (2.2).
13. `fRokTITH` autosave: fixed. S18, A4 in slice 1A.
14. A1 before any native close; `make` route left selectable: fixed. A1 after the first close settles `done`; `make` and `slack` removed from the route (S3, D5).
15. GitHub token rotation order: fixed. Create, connect, one good run, then revoke (S16, A5).
16. Visible marker in client WhatsApp: fixed. No reference line; reconcile by message id and body hash; preview equals what is sent (2.7).
17. Legacy responses to client forms: fixed. A #csm-general notice for the CSM, the termination date kept, bilingual closing text (4.3, 4.6).
18. Retiring ceo-extensions-sync leaves weeks inflated: fixed. A clear-on-end step in the billing writer; the pass retires only after it runs (3.1).
19. Two writers of Last POC and Last Check-in Call: fixed. The act path skips them when the notes form is used (2.6).
20. No proof without real events: fixed. The supervised proof run on `86eywg1cq`, with its checks and clean-up (1.6); Stage 2 build starts after it (D1).
21. A failed Blueprint close raises nothing: fixed. The close notice queues on `done` or `reconcile` with a check variant; a guardian row on the creative outbox; PGlite cases (1.3, 1.5). The #media-general post also moved out of the close (D5).
22. Kickoff and Blueprint outside the one backend: fixed. Both registered in Stage 2a, kickoff responses by webhook (B3) and mirror, Blueprint presses written with `delivery creative_outbox`; the creative API is the one named exception, for ClickUp only (D9, 4.1, 4.2).
23. Bot membership unchecked for #client-call-feedback: fixed (same as 1).
24. "How it's assigned" half handled: fixed. A 31-row table with list, template and owner; one `[TEST]` ticket per department list; the assignee re-read at 2 minutes; drifted templates re-saved first (3.3).
25. Stage 1 "done" while things trigger less: fixed. `postcallsummary` off and the ending changed in slice 1A (S17, A3); phase 5 and the recaps listed as unmet in the report (1.4, 1.8).
26. Who does the CEO items; A1 timing: fixed. D16 and the 5.2 preamble; only logins, money, DNS and Slack invites are his; A1 after the first close.
27. `fRokTITH` autosave: fixed (same as 13).
28. `bab9a58b` type and several choices: fixed (same as 2): first choice wins.
29. Seed silences recent kickoffs; late notice is final: fixed. Seed only rows older than 48 hours; a `kickoff.updated` thread reply (1.3).
30. Kickoff recap approvable only in an unused window: fixed. Approval on the client page and a Today row for every form, with the 24-hour reminder (2.7).
31. Dropped Typeform Blueprint notice row: fixed. Kept with the same key until A1, then removed (1.3, A1).
32. Forms not decided in 3.7 and 3.10: fixed. The five Four Rs forms with webhooks and scenarios (3.7); one row per remaining form with id, owner and decision (3.10).
33. Phase 4 WhatsApp delivery unchecked: fixed. S19, a count-only check in `wa_messages`.
34. "The same channel" breaks the DM: fixed. `C`/`G` must match, `U` must return `D`, the returned channel is stored and used; rehearsal rows allowed by kind; a test for askViktorFor (S1, 1.3).
35. No reconcile mechanism for executePlan: fixed. The close no longer posts to Slack (D5), so nothing needs history search there; the request DM keeps a person's reconcile; notices have their own reconcile and a `blueprint.updated` reply on `reconcile → done` (S1, 1.3).
36. Drain cannot run without a user JWT: fixed. A cron branch before `getUser()`, a service-only loader on `cockpit_blueprint_gate_for_actor`, the `runClientAction` loader refactor, attempts and `failed` (1.3 Drain).
37. S3, S4, S12 need a signed-in seat: fixed. S3 is now a migration (no setting change); S4 is the creative director's click (A7); S12 and the proof run use the CEO's already signed-in seat in the built-in browser.
38. Kickoff notice lifecycle undefined: fixed. One `kickoff` row with `facts.second`, the due rule in the claim RPC, `requeue` without an attempt, the variant set at build, a follow-up reply (1.3).
39. Trail stop has no read path: fixed. `cockpit_slack_notice_claim`, `_result`, `_sweep` and the gated `_read`, the advisory lock key, and the UI files in both cockpits (1.3).
40. Deploy path missing: fixed. 1.7 lists migrations, every function to redeploy, the bundle command, `verify_jwt`, vault and cron names, sites, the native release and the guardian.
41. Branch database assumed: fixed. PGlite plus a production apply-twice in a rolled-back transaction; the drain tested on the outbox harness and an `apply: false` dry run; no synthetic row run live (1.5).
42. Stage 1 too big for one day: fixed. Slice 1A ships today; 1B next; "shipped" separate from "proven"; Stage 2 build starts after the proof run (D1, 1.8, 6).
43. A #media-general failure silences the CSM notice: fixed. The post is a separate notice, and the close notice queues on `done` or `reconcile` (D5, 1.3).
44. Systems manager cannot be resolved by the seat rule: fixed. Resolved from `cockpit_people` to `cockpit_eod_radar_slack_ids`; the doctor shows who (1.3).
45. `kickoffCardDone` link condition: fixed. The predicate is written out, pinned to `BLUEPRINT_ON` by a test, the link line is observed state only (1.3).
46. Wrong ship app names: fixed. `client-success` and `creative` (1.5, 6). Verified ship.sh:124-130.
47. Dry run on rows that cannot build a notice: fixed. Explicit inputs, and a synthetic close for Smmim studio (1.3, 1.5).
48. S7 names no reader: fixed. Dropped; verified only counters read it (S7).
49. Nudge needs a gated read of a CSM table: fixed. A `blueprintCall` field on `cockpit_blueprint_sources` (S8).
50. Seed fixes a count of 30: fixed (same as 29).
51. Ticketing write backwards: fixed (same as 9).
