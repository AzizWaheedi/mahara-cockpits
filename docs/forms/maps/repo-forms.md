# Repo map for the forms program: what the cockpits already have, and one forms backend

Read-only map, 2026-10-25, worktree `forms-1025` (origin/main `d2c9817c`).
Nothing was submitted, run, edited, posted or messaged. Supabase was read with
`sq.py` SELECTs only (read-only mode). Typeform webhooks and ClickUp views were
read with GETs from the VPS env, printing hosts, tags and names only, never a
URL token or key. Business names only; no phone numbers, emails or message
bodies.

Sources are cited inline:
- `path:line` = a file in this worktree.
- `SQL` = a `sq.py` SELECT on `bldgtotkfmhoxmlzowdx`, run on 2026-10-25.
- `TF` = Typeform API (`GET /forms/{id}/webhooks`, or the MCP `get_form` skeleton).
- `CU` = ClickUp REST GET (`/view/{id}`, `/folder/{id}`, `/list/{id}/field`).

The sibling maps cover the live paths in depth: `kickoff-path.md` (Make 12,
Make 06, the #csm-general notice) and `blueprint-path.md` (Make 14, the native
presses). This map covers the code those paths sit on, and recommends the
backend.

---

## 0. The answer in one screen

| Question | Answer |
|---|---|
| Is there a form framework to build on? | **Yes, for Typeform embeds.** `apps/client-success-cockpit/src/forms/` (14 files, 4,102 lines) opens a Typeform in its own window, prefills hidden fields from the client's record, notes the response in `cockpit_csm_form_sends`, and shows a trail of what Make did. It serves one form, the kickoff, and has never been used: 0 rows in `cockpit_csm_form_sends` (SQL). |
| Is there a native-form pattern? | **Yes, the Brand Blueprint.** `cockpit_blueprints` autosaves per field with a revision and conflict check, and each "press" queues one outbox row that an Edge Function runs with read-back. It has 1 row and 0 presses (SQL). |
| Where do form answers land today? | **Almost all in Make.** Of 24 forms checked, 18 send their webhook to Make (the New Client Form also to Cortana and HighLevel), 2 older onboarding forms go to HighLevel, and 3 have no live webhook. Only the Team Onboarding form (`Cef2QGBh`) delivers to the cockpit, through a signed Edge Function (TF, section 4). |
| Which native features already do a form's job? | Four: "Ask a team" tickets (live, 7 delivered), the billing sheet's Extend and Pause edits (2 extensions used), the media buyer's Pause & offboard hold (0 used), and the churn register (0 rows) (SQL, section 5). Each one overlaps a Typeform. |
| Is there one place every seat can reach? | **The portal** (the media buyer app at the root of `cockpit.maharamedia.com`): `/team` and `/performance` take any seat, and every cockpit's sidebar already links to `${portal}/team` (section 6.2). |
| One outbox today? | **No: five.** The ClickUp writeback queue, the creative outbox, the CSM action receipts, the EOD outbox and two VPS ledgers. The ClickUp writeback queue has the strongest delivery rules (dedupe key, claim token, dry run per kind, reference line before retry) (section 7.3). |
| Recommendation | **One registry, one response table, one effects outbox** (`cockpit_forms`, `cockpit_form_responses`, `cockpit_form_effects`). Team forms become native React forms. Client forms stay on Typeform for now, with a signed webhook into the cockpit. A per-form owner switch (`make` / `shadow` / `cockpit`) decides who runs the effects, so Make and the cockpit never both fire (section 8). |

---

## 1. The form framework in the client success cockpit

### 1.1 Files

All under `apps/client-success-cockpit/src/forms/`.

| File | Lines | What it does |
|---|---|---|
| `formConfig.ts` | 200 | The contract, types only. `FormKey = "kickoff" \| "blueprint" \| "checkin"` (`formConfig.ts:16`). `FormConfig` (`:144`) holds the form ID, the `idField`, `hidden()`, `rail()`, `already()`, `makeDoes`, `ending`, an optional `partial`, and `after` (the trail rules). |
| `kickoff.ts` | 80 | The kickoff's config and the registry. `FORM_CONFIGS` holds only `kickoff` (`kickoff.ts:72-74`). Its `after` rules assume Make updates the card (`:44-68`). |
| `prefill.ts` | 347 | Builds the 23 hidden fields from the newest onboarding response (`KICKOFF_HIDDEN`, `prefill.ts:90`), with the onboarding form's refs (`ONB`, `:59`). `formLink()` builds the public link (`:221`). `hiddenSha256()` fingerprints the hidden object. |
| `useLiveForm.ts` | 296 | Reads the client four ways in parallel: onboarding mirror, deck sources, call timeline, sends (`useLiveForm.ts:148-183`). Turns each failure into a plain sentence (`blockedFor`, `:81`). Re-reads on window focus (`:193-229`). |
| `useFormPanel.ts` | 391 | Loads `@typeform/embed` on demand (`:36`), mounts the widget with the frozen hidden values, notes each response once (`noted` set, `:243`), schedules the card checks (`checksAtSec`), and holds the form when one is already on record. Sandbox for admins and the CEO (`:322`). |
| `FormPanel.tsx` | 1,228 | The two-column window: the form and the side rail ("what the cockpit knows"), the after-send trail, the answers sheet. |
| `FormWindow.tsx` | 360 | The route `/clients/:key/forms/:form`, outside the app shell (`AuthenticatedAppRoutes.tsx:126`), with the "Just me / Sharing" switch. |
| `OpenFormButton.tsx` | 115 | Opens one named window per client per form (`:23`), and a `BroadcastChannel("mahara-forms")` so the cockpit tab re-reads after a send (`:88-115`). |
| `formClient.ts` | 111 | Two gated RPCs: `cockpit_csm_form_sent` and `cockpit_csm_form_sends_read`, with a sign-in guard that throws if the account changes mid-call (`:31-48`). |
| `formStatus.ts` | 253 | The four-stop trail (Sent, Typeform has it, Make updated the card, link written back), worked out from reads each time, never stored (`:79-155`). |
| `formRail.ts` | 565 | The kickoff's side panel. |
| `useFormSend.ts`, `formTime.ts`, `FormBoundary.tsx` | 39, 57, 60 | The newest send for the page header; Kuwait time; the error boundary. |

Tests pin it: `scripts/form-contract.test.ts`, `form-panel.test.tsx`,
`form-prefill.test.ts`, `form-rail.test.ts`, `form-status.test.ts`, and
`kickoff-prefill-check.ts` (declared hidden keys against the live form). A
harness runs it on fixtures (`src/dev/formHarness.tsx`,
`src/dev/typeformStandIn.ts`).

### 1.2 How a kickoff send works

1. The CSM presses "Fill the kickoff" in the client page header
   (`CsmPage.tsx:1826-1840`) or on the Onboarding tab
   (`OnboardingKit.tsx:580-593`). A named popup opens.
2. The window reads the client through the seat's own Supabase client, so
   `cockpit_csm_client_gate` decides (section 7.1).
3. The Typeform mounts with hidden values only. Typeform cannot prefill a
   visible answer, so the rail lists the known answers to copy
   (`formConfig.ts:85-130`).
4. On `onSubmit`, the window calls `cockpit_csm_form_sent` once per response
   ID (`useFormPanel.ts:243`).
5. The function re-checks everything on the server
   (`20261023a_csm_form_sends.sql:65-142`): it accepts the kickoff only
   (`:75-77`), takes the form ID from its own constant (`:78`), refuses the
   sandbox, refuses an ID the form did not carry for this card (`:85-87`),
   decides "second" itself (`:113-117`), takes an advisory lock per card and
   form (`:102`), and writes one `csm_form.sent` audit row only when it
   inserted (`:135-140`).
6. The trail then waits for Make 12 to move the card to Brand Blueprint
   Booked (`formStatus.ts:41-53`), with checks at 45 s, 2 min and 5 min.

Live state: the window ships, but `cockpit_csm_form_sends` has 0 rows and the
audit log has no `csm_form.sent` row (SQL). The last kickoff response was on
2026-10-20 (`cockpit_csm_call_forms`, SQL), before the window shipped.

### 1.3 What it can and cannot carry today

| Limit | Where | What a new form needs |
|---|---|---|
| Three form keys, hard-coded in four places | `formConfig.ts:16`, `formClient.ts:19`, SQL `CHECK` at `20261023a…sql:29` and `:149` | A migration and a TS change per form. |
| The SQL notes the kickoff only | `20261023a…sql:75-78` | One line per form, with its own form ID and ID field. |
| The ID field must be `onboarding_client_id` | `20261023a…sql:88-90` | The 1-1 notes form uses `task_id` (`onboardingCore.ts:100-109`). |
| The trail assumes Make writes the card | `kickoff.ts:44-68`, `formStatus.ts:79-155` | A native form's trail should read `cockpit_form_effects` states instead. |
| Typeform only | `useFormPanel.ts:36-42` | A native renderer (the Blueprint has one, section 2). |
| CSM seats only | the gate in section 7.1 | Team forms need `cockpit_client_allowed` or a role gate. |
| Lives in one app | not pinned in `scripts/check-shared.sh` | KICKOFF.md 2.6 planned to copy six core files byte for byte; nothing is pinned yet. |

---

## 2. The Brand Blueprint native form

| Piece | Where |
|---|---|
| Questions, types, parts, required keys, the browser's copy of the server checks | `src/present/blueprintForm.ts` (pinned against the SQL allow-list by `scripts/blueprint-form.test.ts`) |
| Field editors with the suggestion and its source beside each | `src/present/BlueprintFields.tsx` (643 lines) |
| Autosave per field, 600 ms after the last key, one save in flight, `seen` per key for conflicts | `src/present/blueprintSaver.ts:1-40` |
| The brief and Slack text the presses send | `src/present/blueprintBrief.ts` (also bundled server-side by `cockpit-creative-api/blueprint.ts:3`) |
| Tables | `cockpit_blueprints` (answers, answer_meta, parts, revision, launch_task_id) and `cockpit_blueprint_settings` (`20261024a_brand_blueprints.sql:34-64`). RLS on, no browser grants, service role SELECT/INSERT/UPDATE only (`:66-70`). |
| Writes | `cockpit_blueprint_save(task_id, changes, session, base_revision)` (`:900`) and `cockpit_blueprint_part_done(task_id, part, request_id)` (`:999-1093`) |
| A press | Locks the card, reuses an earlier request with the same ID (`:1018-1027`), refuses part 2 before 1 and 3 before 2, refuses missing answers, returns "duplicate" when nothing changed (`:1043-1052`), refuses while an earlier run of the part is still sending (`:1058-1064`), supersedes a pending press (`:1068-1070`), inserts one `cockpit_creative_outbox` row, and writes one `blueprint.part_done` audit row (`:1084-1088`). |
| The run | The browser then calls `cockpit-creative-api` `clientAction` with `apply: true` (`blueprintSources.ts:358-383`). `prepareBlueprint` reads ClickUp with GETs only; `executePlan` writes each step and reads it back; Make is called last, once, never retried (`cockpit-creative-api/outbox.ts:34-43`). |
| The close route | `card_only`, `slack` (#media-general, `blueprintBrief.ts:16`) or `make` (`cockpit-creative-api/blueprint.ts:110-132`). |
| The creative director's page | `apps/creative-director-cockpit/src/pages/BlueprintCallPage.tsx`, route `/blueprint/:taskId`, framing the CSM deck. The message envelope `deckHost.ts` is byte for byte in both apps (`scripts/check-shared.sh:156-162`). |

Live state: 1 row in `cockpit_blueprints`, 0 rows in `cockpit_creative_outbox`,
audit shows `blueprint.insert` 1 and `blueprint.save` 2 (SQL). The old
Typeform `oYZKtogO` still has two live Make webhooks (TF, section 4).

What it teaches the forms backend:
- Per-field autosave with a revision and `seen` values is ready to reuse for
  long native forms (the 1-1 notes, the ticket).
- A request ID from the browser makes a press safe to repeat.
- **There is no server drain.** Nothing in `cron.job` calls
  `cockpit-creative-api` (SQL), so a press whose window closes before its run
  stays `pending`. A public client form has no window to finish its run, so
  the forms outbox needs a cron drain.

---

## 3. The sales cockpit's New Client Form embed

| Piece | Where |
|---|---|
| The form | Typeform `BTzMwXiw`, embedded on the lead page (`apps/sales-cockpit/src/components/ClientFormSheet.tsx:227`, `createWidget`), hidden fields `contact_id`, `closer`, `setter` (`apps/sales-cockpit/src/lib/clientForm.ts:22-55`). |
| The questions beside it | The setting `client_form`, copied from Typeform by the sales desk every ten minutes (`clientForm.ts:16-19`). |
| The note | `sales-api` op `client_form.sent` (`supabase/functions/sales-api/index.ts:8132-8155`, `:8355`), checked by `clientforms.ts`, into `cockpit_sales_client_forms` with a `client_form.sent` audit row. |
| Table | `cockpit_sales_client_forms` (`20261002e_sales_client_forms.sql:23-46`). Unlike the CSM tables, it grants `SELECT` to `authenticated` under an RLS policy `cockpit_sales_seat()`. |
| What Typeform starts | Cortana (signed), two Make webhooks, and HighLevel (TF). The migration names Make "10. Closer Form to Onboarding (MAIN)", HighLevel, Cortana and B2B's typeform-sync for `closed_deals` (`20261002e…sql:8-14`). |

Live state: 3 rows, the last on 2026-10-17; 3 `client_form.sent` audit rows
(SQL). This is the only cockpit embed that has run in production.

Rule it carries: nothing may imitate this submission, because B2B reads
`closed_deals` from what Typeform stored (`clientForm.ts:10-13`). This form
stays a Typeform embed.

---

## 4. Where each Typeform delivers today

`GET /forms/{id}/webhooks` for every known form (TF, 2026-10-25). "Make" means
a `hook.*.make.com` URL; the URLs are not printed.

| Form | ID | Webhooks on (target) | Off |
|---|---|---|---|
| Kickoff | `tG7dnxBn` | 2 (Make: `WHTP3992232`, `postcallsummary`) | |
| Kickoff, old | `BbJy6xg4` | 0 | 2 (Make) |
| Brand Blueprint (old) | `oYZKtogO` | 2 (Make: `postcallsummary`, `blueprint`) | |
| Client 1-1 Call Notes | `fRokTITH` | 1 (Make) | |
| Client Extension | `gqBcyK6g` | 2 (Make) | |
| Pause Request | `CTUjv6l3` | 1 (Make) | |
| Contract Termination Survey | `knIe4eF3` | 2 (Make) | |
| NPS Survey | `fuPgs85S` | 1 (Make) | |
| CSAT Survey - Onboarding | `KbcbPA73` | 1 (Make) | |
| Mahara - Onboarding | `KFRCXPFx` | 1 (Make) | |
| MaharaMedia Onboarding (older) | `Aa6nUPOs`, `uUEp9YwJ` | 1 each (HighLevel `integration_ai`) | |
| New Client Form | `BTzMwXiw` | 4 (Cortana, 2 Make, HighLevel) | |
| [SANDBOX] Mahara Internal Request | `o0ULXQhD` | 1 (Make) | |
| Client Review | `ETEynRgb` | 1 (Make) | |
| Referral Form | `bAmbMKM2` | 1 (Make) | 1 (Make) |
| Client Card Info Form | `Uju17Z13` | 1 (Make) | |
| Reactivate your ads | `ecJQ5Z5C` | none | |
| Upsells | `IVHO9BMC`, `VP3zmaj2`, `cKItPZVI` | 1 each (Make) | |
| Site Design Details | `PjfTJypg` | 1 (Make) | |
| Free Gift Survey | `P1xP4r24` | none (read by the webinar pull into `cockpit_webinar_forms`) | |
| Team Onboarding | `Cef2QGBh` | 1 (`team-onboarding-intake` Edge Function, signed) | |

The cockpit also reads some forms by polling, never by webhook:
- `onboarding-sync` every 10 minutes reads `KFRCXPFx`, `tG7dnxBn`,
  `BbJy6xg4`, `oYZKtogO` into `cockpit_client_onboarding.forms`
  (`onboardingCore.ts:73-78`, cron `mahara-onboarding-sync`).
- `hermes/csm-calls` every 15 minutes on the VPS reads `fRokTITH` and the four
  above into `cockpit_csm_call_forms` (`hermes/csm-calls/RUNBOOK.md:9-23`).
- `ceo-extensions-sync` every hour reads `gqBcyK6g`
  (`20261009k_ceo_extensions_auto_cron.sql:3-9`).

The ClickUp forms the cockpits open (CU `GET /view/{id}`):

| ClickUp form | View | Parent | Opened from |
|---|---|---|---|
| "Submit a New Request!" (the ticketing form) | `2kzmr1ky-1178` | folder `901812879297` "All Assignments", space Team - Maharamedia | link only, `csmTemplates.ts:46` (not rendered anywhere I found) |
| "Payment Failure" | `2kzmr1ky-1218` | list `901816723196` Marketing / ADs | media buyer "card declined" button, `CockpitPage.tsx:3038` |
| Client portal task | `2kzmr1ky-7138` | list `1100530000000279` Client Portal Tasks | CSM portal tasks, `convex/portalTasksCore.ts:17-18` |
| "Launch New Campaign" | `2kzmr1ky-3878` | list `901817774521` (ads board) | media buyer, `convex/constants.ts:34` |

The "All Assignments" folder holds the department lists: Operations / Tech
`901816723190`, Marketing / ADs `901816723196`, Call Center `901816723206`,
Client Success `901816723211`, Media/Creative `901818016338`, plus All Tasks,
Web Development, CEO tasks and others (CU `GET /folder/901812879297`). The
Request Type field `e9fd8024` has 31 options, among them Client Pause Request,
Client Relaunch Request, Client Offboarding Request, General CSM Ticket and
General Tech Request (CU `GET /list/901816723190/field`).

---

## 5. Client lifecycle features the forms touch

| Feature | Tables | Functions | Where in the UI | Live use (SQL) | How a form plugs in |
|---|---|---|---|---|---|
| **Ask a team** (CSM tickets) | `cockpit_decisions` (kind `ticket`), `cockpit_clickup_writeback_queue` | Trigger and sweep `cockpit_clickup_writeback_sweep` (`20261012a_csm_ticket_writeback.sql:29-60`); `clickup-writeback` job `log` every 2 min, live for CSM tickets under `CLICKUP_WRITEBACK_APPLY_CSM_TICKETS` (`clickup-writeback/index.ts:13-17`); steps in `clickup-writeback/queue.ts:191-232` | Client page, "Ask a team" panel (`CsmPage.tsx:2204-2235`), 17 request kinds (`:149-192`) | 8 tickets in 45 days, 7 delivered | This is the team ticketing form in small. The portal form reuses its steps: a task on the department list with Request Type, then a link comment on the client's card. |
| **Pause and offboard** (media buyer) | `cockpit_client_holds` (`20261024172848_media_client_lifecycle.sql:2-12`) | `cockpit_client_lifecycle_scope`, `cockpit_client_stop_begin/finish`, `cockpit_client_lifecycle_action` (revision guard in `20261024175515…`), `cockpit_assert_no_client_hold`; handler `cockpit-media-api/clientLifecycle.ts` | Media buyer → Clients → client → Pause & offboard (`docs/media-launch/PAUSE-OFFBOARD.md:3`) | 0 holds | A Pause Request answered "approved" could open the media buyer's pause review with the reason filled. Offboarding already makes a "Client Offboarding Request 🔴" task on Operations / Tech (`clientLifecycle.ts:5`, `:36-48`). |
| **Billing: Extend and Pause** | `cockpit_billing_accounts`, `cockpit_billing_events` (`20260923a_client_billing.sql:41-96`) | `cockpit_billing_write` (`20261009a_billing_native_sync.sql:269`, extension rules `:382-395`: 1, 2 or 4 weeks, a reason, optional date move); ClickUp writeback of `Extension (weeks)` `8cb9d308` and `Paused On` (`20261009j…sql:34`, `clickup-writeback/billing.ts:34-35`) | Billing sheet, Extend and Pause tabs (`components/billing/BillingSheet.tsx:372`, `:771`, `:783-850`), shared with the CEO cockpit | 2 extension edits by CSMs, last 2026-10-19 | The native Client Extension form **is** this edit. One form, one writer. |
| **CEO extensions sync** | `cockpit_ceo_extension_field_writes`, `cockpit_sync_state` key `ceo-extensions-auto` | `cockpit-ceo-api/extensions.ts` (form `gqBcyK6g`, refs `5145ff0c` client, `278c2f80` duration, `:19-23`), cron hourly at :47 | CEO cockpit, Client Success tab | Last run 2026-10-25 13:47: "No response on the Client Extension Form matches a client card, so there was nothing to write." | Writes a different field, "Current extension (weeks)" found by name (`extensions.ts:25-27`). Two writers, two fields for one fact. Retire one when the form moves. |
| **Churn register** | `cockpit_churn_departures`, `cockpit_churn_months`, `cockpit_churn_log` (`20261001a_churn_tracker.sql:35-90`) | `cockpit_csm_churn_read`, `cockpit_csm_churn_edit` (`20261004a_csm_churn_projections.sql:21-91`); log is immutable (`:11-15`) | Money → Churn (`/money?tab=churn`, `AuthenticatedAppRoutes.tsx:168`) | **0 departures** | A Contract Termination response proposes one departure row (client, left on, reason) for the CSM to confirm. Today nothing connects them, and the register is empty. |
| **Call store and client brief** | `cockpit_csm_calls`, `cockpit_csm_call_forms`, `cockpit_fathom_meetings`, bucket `csm-call-transcripts` (`20261011c_csm_call_store.sql:17-82`) | Worker `hermes/csm-calls` (15 min); read `cockpit_csm_client_timeline`; brief `lib/clientBrief.ts` | Overview tab: "Before the call", calls timeline, "Your 1-1 notes to act on", "Every form" (`CsmPage.tsx:2320-2400`) | 34 check-in forms (last 2026-10-21); 35 Fathom calls with a summary and transcript, 27 matched to a client | The brief reads DEFCON and priority from the newest 1-1 form by question title (`clientBrief.ts:1638-1650`). A native 1-1 form must still land in this shape, or the brief loses DEFCON. `cockpit_csm_call_forms.form_id` only allows five Typeform IDs (`20261011c…sql:52`). |
| **Onboarding mirror** | `cockpit_client_onboarding`, `cockpit_client_onboarding_runs` (`20261005a_client_onboarding.sql:32-80`) | `onboarding-sync` cron; `cockpit_csm_onboarding_read`, `onboarding.refresh` (`cockpit-csm-api/index.ts:58-61`) | Onboarding & files tab (`OnboardingKit.tsx`) | 70 cards | The prefill source for the kickoff and the Blueprint. A signed onboarding webhook would make it immediate instead of 10 minutes late. |
| **Contracts** | `cockpit_sales_contracts…` (`20261001a_sales_contracts.sql` and later) | `sales-api` contracts | Sales lead page | not counted here | The New Client Form and the contract share the lead; out of scope for the forms backend beyond the registry. |
| **Commission earners** | none (rules only) | `lib/csmMoney.ts:119-190` | Money → pay | n/a | The referral, review and upsell Typeforms are the commission evidence ("no form, no commission", `csmLinks.ts:180`). Native versions should write the earner row the pay plan counts. |

---

## 6. Where forms appear in the interface

### 6.1 The CSM client page

`/clients/:key` (`CsmPage.tsx:3856-3859`). Tabs: Overview, Results, Ads,
Onboarding & files, Money (`CsmPage.tsx:1020-1026`).

| Place | What is there now | Form entry today |
|---|---|---|
| Header actions | data link (admins), "Fill the kickoff" while onboarding, Present, Report an issue (`:1810-1846`) | Kickoff window |
| Header facts line | "1-1 notes {date}" (`:1886-1887`) | none |
| Today list row | "1-1 notes missing for the last call" (`:632-640`) | Typeform link `checkinFormLink` |
| Log a call panel | "The call summary form is still the record of the call" (`:2024-2030`) | Typeform link |
| Ask a team panel | 17 request kinds and a note (`:2204-2235`) | native ticket |
| Overview tab | brief, WhatsApp, profile, calls, 1-1 notes fold, team EODs, "Every form" fold (`:2320-2400`) | read only |
| Onboarding & files | `OnboardingKit` with the kickoff step and Blueprint status (`:2420-2437`) | Kickoff window |
| Money tab | Billing card with "Open billing" (`:2438-2470`) | Billing Extend / Pause |
| Key links page | every Typeform by section (`lib/csmLinks.ts:60-245`) | plain links |

Where the moved forms should sit (recommendation):
- **One "Forms" menu in the header**, beside "Fill the kickoff": Write the call
  notes, Give an extension, Request a pause, Ask a team, Send a survey. Each
  opens its own window through the existing `/clients/:key/forms/:form` route.
- **Overview**: "Every form" reads `cockpit_form_responses`, so native and
  Typeform answers show in one list.
- **Onboarding & files**: onboarding, kickoff, Blueprint, CSAT onboarding.
- **Money**: extension, pause, termination, and the four Rs forms.
- **Today list**: the "1-1 notes missing" link opens the native notes window.
- **Key links page**: links become "Open in the cockpit" for moved forms, so
  no stale Typeform link stays one click away.

### 6.2 Team-wide places

| Fact | Source |
|---|---|
| The portal is the media buyer app at the root of `cockpit.maharamedia.com`. `/team`, `/team/:id` and `/performance` sit outside any role route, so every seat with a portal sign-in reaches them. | `apps/media-buyer-cockpit/src/auth/authenticated/AuthenticatedAppRoutes.tsx:116-125` |
| Call centre seats land on `/team`. | `apps/*/src/auth/supabaseAccess.ts:22` |
| Every cockpit's sidebar links to the portal's Team meetings. | `client-success-cockpit/src/components/AppSidebar.tsx:164`, `creative-director-cockpit/src/components/AppSidebar.tsx:173`, `sales-cockpit/src/components/Sidebar.tsx`, `video-editor-cockpit/src/lib/data.ts` |
| Same-origin navigation reuses the Supabase session. | `media-buyer-cockpit/.../AuthenticatedAppRoutes.tsx:61-62` |
| Active seats: editor 6, media buyer 5, creative 4, CSM 4, admin 3, CEO 2, call centre 2, sales 1. | SQL on `cockpit_members` |

Recommendation: put the team ticketing form in the portal at `/requests`
(new), and add "Ask a team" beside "Team meetings" in every sidebar, linking to
`${portal}/requests`. Client-scoped forms stay in the CSM app, where the client
gate and the client context live.

Do not confuse it with "Report an issue" (`components/ReportIssue.tsx`,
`cockpit_issue_reports`): that is the CEO's feedback queue for cockpit bugs,
not a team ticket.

---

## 7. Conventions the forms backend must follow

### 7.1 Gates

| Gate | What it checks | Source |
|---|---|---|
| `cockpit_csm_client_gate(task_id)` | A confirmed, active member with `csm` or `admin`, or a founder address; a complete client roster; exactly one card with that ID; the client on the seat's list. Returns `actorId`, `email`, `taskId`, `clientName`. | `20261006c_csm_onboarding_checkins.sql:2-20` |
| `cockpit_blueprint_gate_for_actor(actor, task, write)` | Creative seats write, CSM seats read, admins and founders both. | `20261024a_brand_blueprints.sql:663` |
| `cockpit_client_allowed(name)` | Any active seat, per client; team-only seats get only their own clients. Used by `/performance`. | `20261017b_team_only_seats.sql:471-490` |
| `cockpit_client_lifecycle_context` | Media buyer or admin, client on the list, unambiguous ad accounts. | `20261024172848…sql:14-29` |
| `cockpit_csm_action_context` + receipts | The CSM API's plan → intent row → execute → finish, `reconcile` on failure. | `cockpit-csm-api/index.ts:63-80` |

The founder addresses are hard-coded in these gates
(`20261006c…sql:7`, `20261024172848…sql:19`); a members row cannot grant CEO.

### 7.2 Migrations

The shape every recent migration follows, which the forms migration copies:
- `BEGIN; … COMMIT;`, idempotent (`CREATE TABLE IF NOT EXISTS`,
  `CREATE OR REPLACE`), "applies twice without error"
  (`20261023a…sql:23-25`).
- `ENABLE ROW LEVEL SECURITY`, then
  `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` and grant the
  service role exactly what it needs, in the same file
  (`20261023a…sql:44-48`, `20261024a…sql:66-70`). Repo rule: `CLAUDE.md:9-11`.
- Browsers reach tables only through `SECURITY DEFINER … SET search_path = ''`
  functions with a gate first (`20261023a…sql:65-68`). Function grants are
  revoked from everyone and granted to `authenticated` or `service_role` one
  by one (`20261024a…sql:1229-1266`).
- One `cockpit_audit_log` row per write
  (columns `action, entity_type, entity_id, actor_email, source_app,
  source_system, before, after, metadata`, SQL). Either the function inserts
  it only when it inserted (`20261023a…sql:135-140`) or a trigger writes it
  (`20261024a…sql:80`).
- `NOTIFY pgrst, 'reload schema';` before `COMMIT`.
- The sales table is the one exception that grants `SELECT` to
  `authenticated` under a policy (`20261002e…sql:40-46`).

### 7.3 Outboxes and external writes

| Outbox | Enqueued by | Drained by | Delivery rules | Source |
|---|---|---|---|---|
| `cockpit_clickup_writeback_queue` | triggers and a sweep | `clickup-writeback` job `log`, pg_cron every 2 min | `dedupe_key` unique; states `queued, sending, retry, unknown, delivered, dry_run, skipped, failed`; `claim_token` set exactly while sending; dry run unless the per-kind secret is `"true"`; every comment and ticket carries a reference line, and a retry reads the task back for it before writing again | `20261009f_clickup_writeback_native.sql:43-65`, `clickup-writeback/index.ts:12-27`, `queue.ts:11-14` |
| `cockpit_creative_outbox` | `cockpit_blueprint_part_done` and creative requests | the browser, `cockpit-creative-api` `clientAction` with `apply: true`; no cron | `executePlan` writes each step and reads it back; Make once, never retried | `cockpit-creative-api/outbox.ts:34-43` |
| `cockpit_csm_actions` | the CSM API before a ClickUp write | inline | intent row before the call; `reconcile` on an unknown result | `cockpit-csm-api/index.ts:66-80` |
| `eod_outbox` | the EOD form | VPS `eod-out` | Slack and sheet | `20260922a_eod_outbox.sql`, memory note `eod-slack-delivery.md` |
| VPS SQLite ledgers | `hermes/task-assignment-alerts`, `hermes/ad-billing-guard` | VPS cron | intent before send, `unknown` never replayed, Slack history search for the reference | `hermes/task-assignment-alerts/README.md` "Delivery safeguards" |

Slack posting from Edge Functions goes through `cockpit-media-api/tools.ts`
with `SLACK_BOT_TOKEN`, and `execute.ts` reads the message back from
`conversations.history` (`cockpit-media-api/execute.ts:20`,
`cockpit-media-api/slack.ts:2-7`). Two VPS workers already post into
#csm-general (`C09RZ0GS0V9`): the ad billing guard
(`hermes/ad-billing-guard/core.ts:7`) and the task assignment alerts, which
announce every new assignment on the Client Success list there
(`hermes/task-assignment-alerts/README.md`, health row `task-assignment-alerts`
ok at 2026-10-25 13:48, SQL).

### 7.4 The health ledger

Every provider call goes through a `tools.ts` helper that writes an `intent`
row before the call and a `response` or `unknown` row after it:

| Helper | Providers | Ledger table |
|---|---|---|
| `cockpit-media-api/tools.ts` | Meta, Slack, ClickUp, GoHighLevel (WhatsApp send and contact read only), Make (only the Blueprint close hook, behind `BLUEPRINT_MAKE_CLOSE=on`) | `cockpit_media_provider_health` |
| `cockpit-csm-api/tools.ts` | ClickUp, GoHighLevel (calendars, contact search, conversation reads), Supabase Storage, Typeform (GET only) | `cockpit_csm_provider_health` |
| `cockpit-ceo-api/tools.ts` | ClickUp, Typeform and others | `cockpit_ceo_provider_health` |

A forms runner should use `cockpit-media-api/tools.ts` (it already has Slack,
ClickUp and a guarded Make door) and widen the Make door per form, by exact
hook URL from the env, never from a payload (`cockpit-media-api/tools.ts:9-13`).

### 7.5 Doors: `verify_jwt` and cron secrets

| Function | `verify_jwt` | Door |
|---|---|---|
| `cockpit-csm-api`, `cockpit-creative-api`, `cockpit-media-api`, `cockpit-ceo-api`, `cockpit-team-api`, `sales-api`, `hiring-api` | on | a signed-in seat, then the gate in every RPC |
| `onboarding-sync`, `ceo-extensions-sync`, `clickup-writeback`, `comment-watch`, `hiring-sync`, `cockpit-hours-*`, `tap-charges-sync` | off | `x-cron-secret` equal to `CRON_SECRET`, sent by pg_cron from the vault (`clickup-writeback/index.ts:50-54`) |
| `team-onboarding-intake` | off | Typeform's HMAC signature over the raw body, refused when unsigned; 500 so Typeform retries; a signed dry-run header for the doctor (`team-onboarding-intake/index.ts:5-17`, `signature.ts`) |
| `webinar-events`, `page-form-events` | off | host allow-list, field whitelist, rate limit (`page-form-events/handler.ts:1-30`) |
| `sales-live` | off | three routes in one public function: `open/{code}`, `go/{code}`, `cron` (`sales-live/door.test.ts:111-113`) |

Recorded values are from `docs/preserve/supabase-manifest.json` (generated
2026-10-07). Functions deployed later are taken from their header comments.

### 7.6 Browser rules

- `connect-src` is `'self'` plus the Supabase project in every app
  (`apps/*/vercel.json`). A form never calls Fathom, ClickUp or Slack from the
  browser; it calls an Edge Function.
- The CSM app's `frame-src` allows `form.typeform.com` and `forms.clickup.com`
  (`apps/client-success-cockpit/vercel.json:37`). The media buyer, creative
  and CSM projects send `frame-ancestors 'self'`; the sales project does not.
- Shared code across apps is copied and pinned by `scripts/check-shared.sh`.
  The forms core is not pinned yet.

---

## 8. Recommendation: one forms backend

### 8.1 Three tables

All in Creative Triage, prefix `cockpit_`, one migration, RLS on, no browser
grants, service role only, every write through a gated `SECURITY DEFINER`
function with `search_path = ''`, one audit row per write.

**`cockpit_forms`**, the registry (seeded by the migration, changed only by an
admin or the CEO through a function, audited):

| Column | Meaning |
|---|---|
| `key` text PK | `kickoff`, `checkin`, `extension`, `pause`, `ticket`, `termination`, `nps`, `csat_onboarding`, `onboarding`, `new_client`, `blueprint`, `review`, `referral`, `upsell_*` |
| `title`, `audience` (`team` / `client`) | |
| `provider` (`native` / `typeform`), `typeform_id`, `version` | |
| `schema` jsonb | Native questions: key, type, required, choices, part. The Blueprint's `blueprintForm.ts` is the model. |
| `seats` text[], `client_scoped` boolean | Who may fill it, and whether it needs a client card. |
| `effects_owner` (`make` / `shadow` / `cockpit`) | Who runs the effects (section 8.6). |
| `effects` jsonb | The effect list: for example `[{"kind":"slack.post","channel":"C09RZ0GS0V9"},{"kind":"clickup.comment","on":"card"}]`. |

**`cockpit_form_responses`**, one row per submission:

| Column | Meaning |
|---|---|
| `id` uuid PK | The browser's request ID for a native form; generated for a Typeform response. |
| `form_key`, `form_version` | |
| `source` | `cockpit` (native), `embed` (Typeform in a cockpit window), `typeform_webhook`, `typeform_sync`, `public`, `import` |
| `external_id` | Typeform's response token. `UNIQUE (form_key, external_id)` where not null. |
| `task_id`, `client_name` | Null for a team form with no client. |
| `answers` jsonb, `hidden` jsonb, `prefill_from` jsonb | Answers by key; where each prefilled value came from (as `Prefill.from` does today, `prefill.ts:33-48`). |
| `state` | `draft`, `submitted`, `legacy` (a Typeform response after the cut-over), `void` |
| `revision`, `submitted_by`, `submitted_by_email`, `submitted_at` | Drafts autosave like `cockpit_blueprint_save`. |

**`cockpit_form_effects`**, the one outbox, the same state machine as
`cockpit_clickup_writeback_queue` (`20261009f…sql:43-65`):

| Column | Meaning |
|---|---|
| `id` uuid, `response_id` FK, `effect_key` | `slack.post`, `clickup.comment`, `clickup.task`, `clickup.field`, `churn.propose`, `billing.extension`, `ghl.*`, `make.hook` |
| `dedupe_key` text UNIQUE | `response_id || ':' || effect_key` |
| `plan` jsonb, `receipt` jsonb, `error` | What it would write; the object IDs it wrote. |
| `state`, `attempts`, `next_attempt_at`, `claim_token`, `claimed_at` | `CHECK ((state = 'sending') = (claim_token IS NOT NULL))` |

For client-facing native forms later, a fourth table `cockpit_form_links`
holds a hashed one-time token per client and form, with an expiry, as the call
links do (`sites/call-link/README.md`).

Compatibility views, so nothing that reads today breaks:
- The timeline and the client brief keep reading `cockpit_csm_call_forms`.
  A native 1-1 response is also written there with a native token and
  `form_kind = 'checkin'`, which needs the `form_id` check widened
  (`20261011c…sql:52`).
- `cockpit_csm_form_sends` and `cockpit_sales_client_forms` stay; their rows
  are copied into `cockpit_form_responses` with `source = 'embed'`.

### 8.2 Functions

| Function | `verify_jwt` | Job |
|---|---|---|
| RPCs `cockpit_form_open`, `cockpit_form_save`, `cockpit_form_submit`, `cockpit_form_responses_read` | n/a (PostgREST, `authenticated`) | Gate first (CSM gate for client forms, a role gate for team forms), validate against `cockpit_forms.schema`, write the response, enqueue the effects **in the same transaction** when `effects_owner = 'cockpit'`, one audit row. |
| Edge Function `cockpit-forms-api` | on | Prefill reads that need a provider or private data (the Fathom summary and transcript from the call store, the card through ClickUp GETs), then a "run my effects now" kick after submit, so the CSM sees the trail move at once. |
| Edge Function `forms-door` | off | Three routes, as `sales-live` does: `typeform` (HMAC per webhook secret, the `team-onboarding-intake` code), `public` (a client-facing native form with its token, later), `cron` (`x-cron-secret`; pg_cron every 2 minutes drains `cockpit_form_effects`). |

The drain uses `cockpit-media-api/tools.ts` for every call (health ledger), the
reference-line steps of `clickup-writeback/queue.ts` for ClickUp (create task,
comment, field, each read back before a retry), and the Slack read-back of
`cockpit-media-api/execute.ts:20`. It is a dry run unless a per-provider secret
is exactly `"true"` (`FORMS_APPLY_SLACK`, `FORMS_APPLY_CLICKUP`, …), the same
switch style as `CLICKUP_WRITEBACK_APPLY_*` (`clickup-writeback/index.ts:12-21`).
Its health goes to `cockpit_sync_state` key `forms-effects`, so the guardian
can watch it.

### 8.3 Native React forms or Typeform embeds, per form

| Form | Fills it | Today (section 4) | Recommendation | Why |
|---|---|---|---|---|
| Kickoff `tG7dnxBn` | CSM, on the call | Make 12 and Make 06 | **Keep the Typeform embed now** (built, section 1). Add the #csm-general notice as a cockpit effect off the mirror row. **Native later**, once Make 12's card writes are ported. | Make 12 still writes the card comment, the two tasks and the Blueprint link. |
| Brand Blueprint | CD and CSM, on the call | native `cockpit_blueprints`; the old Typeform's two Make webhooks still on | **Native** (built). Retire the old Typeform path: Make 12's Blueprint link and the kickoff's "Open the Brand Blueprint form" link-back (`kickoff.ts:61-67`). | A partial on the old link makes a second launch task (`blueprint-path.md` 1.4). |
| Client 1-1 Call Notes `fRokTITH` | CSM, after each call | Make (1 webhook); mirrored by `csm-calls` | **Native**, first of the new ones. Prefill the transcript and notes from the newest Fathom call matched to the client (`cockpit_csm_calls`, 35 with summaries). | Six fields (TF skeleton: Client ID, transcript, two notes, DEFCON, priority). The typed Client ID goes wrong; the record's ID fixes it. |
| Client Extension `gqBcyK6g` | CSM | Make (2) and the CEO sync | **Native**, as the billing sheet's Extend edit with the form's reason. One field written on the card. | Two writers, two card fields today (section 5). |
| Pause Request `CTUjv6l3` | CSM | Make (1) | **Native**, one form that does what "Ask a team: Pause this client", the billing Pause tab and the media buyer's hold now do apart. | Three native paths already exist. |
| Ticketing (ClickUp form `1178`) | everyone | ClickUp folder "All Assignments" | **Native in the portal** (`/requests`), writing through the "Ask a team" steps. ClickUp stays the board. | The CSM version is live and delivered 7 tickets. |
| Contract Termination `knIe4eF3` | the client, after the exit call | Make (2) | **Keep Typeform**, add the signed webhook, propose a churn row. | Client-facing; the churn register is empty. |
| NPS `fuPgs85S`, CSAT onboarding `KbcbPA73` | the client | Make (1 each) | **Keep Typeform**, signed webhook, show on the client page and in the brief. | Client-facing. |
| Onboarding `KFRCXPFx` | the client | Make 13; polled every 10 min | **Keep Typeform**, add the signed webhook so the kickoff prefill is fresh. | The client's first form; Make 13 runs on it. |
| New Client Form `BTzMwXiw` | closer | Cortana, 2 Make, HighLevel, B2B | **Keep the embed** (built). Register it; copy its notes into responses. | B2B reads `closed_deals` from Typeform. |
| Review, Referral, upsells, Reactivate | CSM | Make (Reactivate: none) | **Native later**, each writing the earner the pay plan counts. | Commission evidence. |
| Client Card Info `Uju17Z13` | the client | Make (1) | **Never in the cockpit.** | It asks for card number, expiry and CVV (TF skeleton). These must not reach Supabase. Flag to the CEO. |
| Old onboarding `Aa6nUPOs`, `uUEp9YwJ` | the client | HighLevel | Leave; check if still sent. | Not verified in use. |
| Free Gift Survey, Team Onboarding | leads, new hires | own paths | Out of scope. | Already handled. |

### 8.4 Client-facing forms need a public page

- **Now:** keep Typeform's public page. The cockpit gets each response from a
  signed webhook into `forms-door/typeform`, the proven
  `team-onboarding-intake` pattern (`index.ts:46-90`): signature first, only
  `form_response` of the expected form, 500 on a store failure so Typeform
  retries, a dry-run header for the doctor, nothing personal logged.
- **Later, if the CEO wants branded native pages:** a static site under
  `sites/forms` (the `sites/webinar` and `sites/call-link` pattern, plain
  files on Vercel), posting to `forms-door/public` with a one-time hashed token
  per client and form. The page and its door follow the call link's limits:
  host allow-list, rate limit, Arabic and English, no third-party script.

### 8.5 One response fans out through one outbox

```
native submit ─┐
embed note ────┼─> cockpit_form_responses ──(effects_owner = 'cockpit')──> cockpit_form_effects
Typeform hook ─┘          (one row)                    same transaction            │
                                                                                   ▼
                         forms-door/cron every 2 min, or cockpit-forms-api kick after submit
                                                                                   │
                           tools.ts ──> ClickUp (reference line, read back)        │
                                    ──> Slack (#csm-general, read back)            │
                                    ──> GoHighLevel (only the doors tools.ts has)  │
                                    ──> Make (one exact hook per form, once, no retry)
```

Effects per form come from `cockpit_forms.effects`, so adding the #csm-general
notice to the kickoff and the Blueprint is a registry row, not new code.

### 8.6 Idempotency, and never firing twice with Make

Idempotency:
- **Native:** the browser makes one UUID per form session; it is the response
  ID. A repeat submit with the same ID returns the first result, as
  `cockpit_blueprint_part_done` does with its request ID
  (`20261024a…sql:1018-1027`).
- **Typeform:** `UNIQUE (form_key, external_id)` on the response token. The
  embed's note and the webhook meet on the same row. A Typeform retry changes
  nothing.
- **Effects:** `dedupe_key` is unique. A ClickUp write carries its reference
  line and is read back before any retry (`clickup-writeback/queue.ts:11-14`).
  A Slack post is read back from history. A Make hook is sent once and never
  retried, because nothing reads it back (`cockpit-creative-api/outbox.ts:34-43`).
- **A second response for the same client:** warn and hold, as the kickoff
  window does (`20261023a…sql:111-117`, `useFormPanel.ts:136-138`).

The switch-over, one form at a time, with `cockpit_forms.effects_owner`:
1. **`make`** (today). The cockpit records responses and runs no effect of
   its own, except effects Make never did (the #csm-general notice), each
   keyed by response ID.
2. **`shadow`**. The cockpit plans every effect as `dry_run` and stores the
   plan. Compare it with what Make wrote on the card for a few real
   submissions.
3. **`cockpit`**, in one change window: switch the owner, turn the form's
   Make webhook off in Typeform (or, for a form that goes native, close the
   Typeform to the public), and point every link at the cockpit (the card's
   link fields, `csmLinks.ts`, `csmTemplates.ts`, SOP docs). Any Typeform
   response that still arrives is stored as `legacy` with no effects and
   raises a health line for the tech lead.
4. The runner checks `effects_owner = 'cockpit'` **when it claims** an
   effect, not only when it enqueues, so a switch back to `make` stops
   queued work at once.

### 8.7 Order of work

1. Migration: the three tables, the registry rows, the RPCs, the
   `cockpit_csm_call_forms` check widened. Tests that apply it twice.
2. `forms-door` with the cron drain and the Typeform route; the doctor; the
   runbook row; dry run.
3. Kickoff and Blueprint: the #csm-general notice as a cockpit effect (owner
   stays `make` for everything else).
4. 1-1 call notes, native, with the Fathom prefill.
5. Extension and Pause, native, merged with the billing sheet.
6. Ticketing in the portal.
7. Client forms: signed webhooks for termination, NPS, CSAT and onboarding;
   the churn proposal.
8. The four Rs forms, native, tied to the pay plan.

---

## 9. Gaps and risks found

| Gap | Impact | Fix |
|---|---|---|
| Five outboxes, no shared runner | Every form would invent its own delivery rules. | One `cockpit_form_effects` with the writeback queue's state machine (section 8.1). |
| The creative outbox has no cron drain (no `cron.job` calls `cockpit-creative-api`, SQL) | A Blueprint press whose window closes before its run stays `pending`. A public form would never run. | Drain the forms outbox from pg_cron. |
| The form framework is kickoff-only in TS and SQL | Each new form needs a migration plus code in four places. | The registry replaces the hard-coded lists. |
| Two extension writers on two card fields (`Extension (weeks)` `8cb9d308` from billing; "Current extension (weeks)" from the CEO sync) | Two answers to one question; the CEO sync wrote nothing on its last run. | One native Extension form through `cockpit_billing_write`; retire the other writer. |
| The churn register has 0 rows; the termination survey goes only to Make | Churn numbers rely on someone typing rows. | A termination response proposes a departure row. |
| The Client Card Info form collects card number, expiry and CVV and sends them to Make | Card data passes through Typeform and Make. | Keep it out of the cockpit; CEO decision on replacing it. |
| The old Blueprint Typeform is live and linked from the kickoff trail | A second launch task, then the native press refuses (`blueprint-path.md`). | Retire the link-back and the Make webhooks in the Blueprint cut-over. |
| Native 1-1 answers cannot enter `cockpit_csm_call_forms` (form ID check) | The client brief would lose DEFCON and priority. | Widen the check, or union the new table into the timeline. |
| The forms core is not pinned in `check-shared.sh` | A copy in another cockpit would drift. | Keep client forms in the CSM app and team forms in the portal; pin anything copied. |
| `forms.clickup.com` ticketing link defined but not rendered (`csmTemplates.ts:46`) | The team uses the ClickUp form outside the cockpits. | The portal `/requests` form. |

---

## 10. Not verified

- Which Slack bot holds `SLACK_BOT_TOKEN` in the Edge Functions, and whether it
  is a member of the private #csm-general. The VPS workers post there, but
  they may use another runtime's token.
- How ClickUp assigns a ticket from the "Submit a New Request!" form. The
  assignment rules are likely ClickUp automations, which the API cannot read.
- `verify_jwt` for `team-onboarding-intake` and `page-form-events` is from
  their header comments; the manifest predates them. No live function list was
  read (the management token is dead).
- Whether the Make scenarios behind each webhook still run, and what each one
  does (the sibling maps read Make for the kickoff and the Blueprint only).
- Whether "Current extension (weeks)" exists on the Clients list, and why the
  CEO sync matched no extension response.
- Whether the old onboarding forms `Aa6nUPOs` and `uUEp9YwJ` still get
  responses.
- Fathom's own webhooks (to cut the 15-minute lag of `csm-calls`); nothing in
  the repo uses them.

---

## Follow-up 2026-10-25

Read-only follow-up on extensions, Next Payment Date, pause, churn, the "will
not continue" checkbox and the WhatsApp group path. Read on 2026-10-25,
about 11:00–12:30 UTC. Sources:
- SQL through `sq.py` (SELECT only).
- ClickUp REST through the VPS. Each script printed only the field ids named
  here and never read the GHL API Key field `09984789`.
- Make API GET: all 202 blueprints. The search covered each module's
  `mapper`, `filter` and `parameters` and ignored its field metadata.
- Typeform MCP.
- The Client Data sheet, read with the ad billing guard's read-only service
  account. Only counts and header names were printed.

Nothing was written, sent or submitted. This section names scenarios by ID,
because short numbers collide across the maps.

### F.0 The answer in one screen

- **No cockpit extension has reached ClickUp.** Both billing extensions of
  2026-10-19 are held as dry runs. Billing has no switch of its own, and the
  general switch `CLICKUP_WRITEBACK_APPLY` is off. The cockpit and ClickUp
  disagree on two clients, Marble and more and Liwan, and on no other card.
- **8cb9d308 is one field with two writers.** The field is "Current extension
  (weeks)". The billing writeback and the CEO extension sync both write it.
  Sections 5 and 9 above are wrong to call these two fields.
- **Next Payment Date has four configured writers plus the CSM by hand.** Two
  pairs can move the date twice for one extension.
- **Pause has a broken promise and a missing field.** The Pause Request
  Typeform is filled by the client. It promises a call before anything is
  paused, but Make `9805613` sets Paused on submit. The billing Pause tab
  never writes Resume On, so Make `9686154`'s resume reminder cannot fire for
  a cockpit pause. No client has been paused through any of these paths.
- **Checkbox 9cfdb353 has no writer and no reader anywhere.** It matches the
  extension question `095cacf2` by wording only.
- **WA Group ID `b1d54dfb` is set on 60 of 89 cards, but nothing writes it.**
  Every Make WhatsApp send reads Client Data column F instead. That column
  holds 65 groups, and 58 of the 60 card values agree with it.
- **Recommendation:** send native recaps and phase 5 through WHAPI. Use a VPS
  worker built on `hermes/ad-billing-guard`'s transport. Take the group from
  Client Data by card id, and check it against the card field.

### F.1 Extension truth

**Why both billing writebacks are dry runs**

- Billing has no switch of its own. `gate()` reads `CLICKUP_WRITEBACK_APPLY`
  and `CLICKUP_WRITEBACK_APPLY_CSM_TICKETS` (`clickup-writeback/run.ts:57-75`).
- `runLog` sends an item live only in two cases (`run.ts:312-314`):
  - it is a client success ticket and the ticket switch is on;
  - the general switch is on.

  A billing item is neither, so it is saved as `dry_run` with its plan
  (`run.ts:315-320`).
- Env var names the function reads (`clickup-writeback/index.ts:12-27`, names
  only): `CLICKUP_WRITEBACK_APPLY`, `CLICKUP_WRITEBACK_APPLY_CSM_TICKETS`,
  `CLICKUP_WRITEBACK_APPLY_KPI`, `CLICKUP_WRITEBACK_ONLY_TASKS`,
  `CLICKUP_API_TOKEN`, `META_SYSTEM_TOKEN`, `CRON_SECRET`,
  `META_GRAPH_VERSION`, `CLICKUP_CALLS_PER_MINUTE`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`.
- The general switch is off. Since 2026-10-12, all 45 log runs have mode
  `apply_limited`, and each note starts "Dry run:". Only the `!g.apply`
  branch writes that text (`run.ts:347-353`; SQL on
  `cockpit_clickup_writeback_runs`).
- The two rows (SQL on `cockpit_clickup_writeback_queue`, `kind='billing'`):

  | Row | Card | Client | Created (+03) | State | Planned writes |
  |---|---|---|---|---|---|
  | `1782597f…` | `86eymcqdq` | Marble and more | 2026-10-19 15:49 | `dry_run` | Extension (weeks) null → 2; Next Payment Date 2026-10-19 → 2026-11-02 |
  | `f321bdeb…` | `86ewvnqj5` | Liwan Limited Construction and Finishing Of Buildings | 2026-10-19 15:50 | `dry_run` | Extension (weeks) null → 2; Next Payment Date 2026-10-15 → 2026-11-02 |

- **Turning the switch on will not send them.** The claim takes only
  `queued`, `retry` and `unknown` (`20261009f_clickup_writeback_native.sql:285`).
  The documented re-queue snippet takes only dry runs from the last day
  (`20261009f:26-28`), so it would miss these two rows.
- **Re-queued today, they would move the date but not set the weeks.**
  `billingVerdict` (`clickup-writeback/billing.ts:115-120`) would write Next
  Payment Date, because the card still shows the old value. It would mark the
  weeks write "stale" and skip it. That write carries no old value
  (`20261009j_billing_clickup_writeback.sql:73`), and the card changed after
  the edit (`date_updated` 2026-10-22, later than 2026-10-19).

**Cockpit against ClickUp today**

| Client | Card | Mirror next date | Mirror weeks | ClickUp Next Payment Date `669ae046` | ClickUp `8cb9d308` | Billing event |
|---|---|---|---|---|---|---|
| Marble and more | `86eymcqdq` | 2026-11-02 | 2 | 2026-10-19 | empty | 114: extension, 2 weeks, date moved |
| Liwan | `86ewvnqj5` | 2026-11-02 | 2 | 2026-10-15 | empty | 115: extension, 2 weeks, date moved |

- **They disagree.** The other 66 mirror rows match ClickUp on next date,
  Client Status and weeks. This comes from a full compare of all 68
  `cockpit_billing_accounts` rows against the list read.
- **The mirror keeps the cockpit value indefinitely.** `billing-sync` holds an
  edit while its writeback is `queued`, `sending`, `retry`, `unknown` or
  `dry_run` (`billing-sync/index.ts:176-180`, `billing-sync/billing.ts:283-292`).
  The disagreement lasts until someone re-queues the two rows.
- **A visible symptom: Maher still chases both clients.** He logged a "chase"
  on both every day from 2026-10-20 to 10-25 (`cockpit_billing_events`, ids
  125–214).
  - On 10-24 and 10-25 he chased 8 clients. Six are overdue on the mirror.
  - The other two are Marble and Liwan, whose mirror date is 2026-11-02.
- Not verified: which date Maher reads, and whether a chase messages the
  client. His `billing-agent` skill is not in this repo or under
  `/opt/data/bibi`, and `/home/aziz` was not opened.

**One field, two writers**

- ClickUp field `8cb9d308-5df5-4ea1-b83d-32b5b7eea778` is a number field named
  **"Current extension (weeks)"** (`GET list/901816559981/field`, 2026-10-25).
- **Writer 1, billing:** writes the field by id under the label
  "Extension (weeks)" (`clickup-writeback/billing.ts:35`).
- **Writer 2, the CEO sync:** finds the field by the name "Current extension
  (weeks)" (`cockpit-ceo-api/extensions.ts:24`, `:139-146`).
  - A `CLICKUP_EXTENSION_FIELD` override would skip the lookup
    (`cockpit-ceo-api/endpoints.ts:33-37`).
  - The hourly :47 pass reads `list/901816559981/field` on every run (81
    reads from 2026-10-22 to 10-25 in `cockpit_ceo_provider_health`). It
    makes that read only when no override is set.
  - So both writers resolve to `8cb9d308`.
- **The CEO pass is live.** Function `ceo-extensions-sync` runs on cron
  `mahara-ceo-extensions-auto` (`47 * * * *`).
  - Its last note: "No response on the Client Extension Form matches a client
    card, so there was nothing to write" (`cockpit_sync_state`
    `ceo-extensions-auto`, 2026-10-25 13:47 +03).
  - Only the apply branch writes that note. A dry run returns "Dry run: …"
    first (`extensions.ts:199-209`, `:230-236`).
  - Env names: `CEO_EXTENSIONS_APPLY`, `CLICKUP_EXTENSION_FIELD`,
    `CLICKUP_API_TOKEN`, `TYPEFORM_TOKEN`, `CRON_SECRET`
    (`ceo-extensions-sync/index.ts:5-8`).
- **It has nothing to write.**
  - The extension Typeform `gqBcyK6g` has 2 responses ever: an internal test
    on 2026-09-14 (card `86eywg1cq`) and one named "Test" from April 2026.
  - Internal names are skipped (`extensions.ts:32`, `:111`).
  - `cockpit_ceo_extension_field_writes` is empty.
- **The two writers follow different rules.**
  - The CEO pass writes the live grant's weeks, then 0 once the grant ends
    (`extensions.ts:120`).
  - Billing writes the weeks and never clears them
    (`20261009j:72-74`; mirror `extension_weeks` stays 2).
  - If both ran live, the CEO pass could reset a card to 0 after billing
    wrote 2, for cards the Typeform named.
- No card has `8cb9d308` set today (0 of 89).

### F.2 Next Payment Date writers

| Writer | Field | How | Live or dry run | Source |
|---|---|---|---|---|
| Make `9356423` "16. ClickUp Launch Campaigns to Slack" r2/[12] | `669ae046` | POST = Launch Date + 90 days when Payment Plan is option 0, else + 30. Runs only on a client's first campaign, and only when the card has no Next Payment Date (filter on r2/[11]). | Live: 21 log rows 2026-09-23 → 10-24 (17 ok, 1 error) | blueprint |
| Make `9585358` "02. Confirm Charge" r0/[3] | `669ae046` | POST `{{1.next}}` from the webhook when `confirm = yes`. The link comes from `9585364` "01. Charge Due", whose Slack text shows `addMonths` of the card's date. | **Dormant**: on, but 0 log rows, and its only caller `9585364` is off. Hook 4284519 has no API key, so an old link still works. | blueprint; `/hooks` |
| Make `9805665` [4] | `669ae046` | `editATask` sets the card's current date + 7, 14 or 28 days, from choice `eCv7oxgUBGll`. Needs the card on `901816559981`, a matching id and an existing date. | Live, never ran: 0 log rows; 2 test responses ever | blueprint; hook 4371922 |
| `clickup-writeback` billing items | `669ae046` (also `8cb9d308`, `9368ca9e`, `930c49eb`) | One item per `cockpit_billing_events` row from source `ceo` or `csm`: `date`; `extension` when the date moved; `resume` when a date is given; `payment` when it moved the date | **Dry run**: 2 rows | `20261009j:59-92`, `:116-119`; `billing.ts:28-36` |
| The CSM by hand | `669ae046` | The extension Typeform asks "Is the ClickUp next payment date updated on the client management board?" (ref `84872ef9`, field `5350AKbFtMRe`) | Process, not code | `gqBcyK6g` skeleton |

**These touch the date but do not write it:**
- **`billing-sync`** reads ClickUp only (`GET` at `billing-sync/index.ts:145`)
  and writes the mirror. In `billing-sync/billing.ts`, lines 39 and 53 are
  just field id maps; the task's citation of `:43` points one line below the
  first one.
- **Maher's edits** (source `maher`, through the billing inbox,
  `20261009a_billing_native_sync.sql:240`) stay on the mirror. The trigger
  fires only for `ceo` and `csm` (`20261009j:118`).
- **The Convex-era write path** is `setValue` in `apps/*/src/lib/billingCore.ts`
  (client success copy `:440-457`). The browser sheet imports only `ladderOf`,
  `METHODS` and `PLANS` from that file (`BillingSheet.tsx:29`).
- **Readers only:** `hermes/ceo-refresh/native/billing.js:6`,
  `hermes/cockpit-sync/csmCadence.ts:14`,
  `cockpit-ceo-api/finance/billing.ts:24`, `present/blueprintBrief.ts:37`, and
  ClickBot's "next payment is in 1 week" comments (`clickup-ticketing.md` §9.2).
- A full repo grep for `669ae046` found no other writer.

**Pairs that can move the date twice for one extension**

| Pair | How it doubles | Guard |
|---|---|---|
| Billing Extend (date moved), then the extension Typeform | Billing writes +14, then Make `9805665` adds +14 to the moved date: the client gets +28 | None. The reverse order is safe: billing sees ClickUp change after its edit and keeps ClickUp's value (`billing.ts:115-120`). |
| The CSM moves the date by hand, then submits the Typeform | The form asks the CSM to move it, and Make adds the weeks again | None |
| Billing Extend (date moved), plus a billing "date" edit for the same grant | Two queue items, and each one writes | None; both are human edits |
| Make `9356423` with any extension | Cannot double: it writes only when the date is empty | Filter r2/[11] |
| Make `9585358` with an extension | A different event (a charge), and dormant | n/a |

The two extension writers also count from different days:
- **Make** adds the weeks to the card's date, even when that date has passed.
- **The cockpit** adds them to the later of the card's date and today
  (`20261009a:390-392`).
- Example: Liwan's date was 2026-10-15 when it was extended on 2026-10-19 for
  2 weeks. The cockpit says 2026-11-02; Make would say 2026-10-29.

### F.3 Pause, Stopped and churn

**Pause writers and readers**

| Writer or reader | Field | How | Live or dry run | Source |
|---|---|---|---|---|
| Make `9805613` [4] | Client Status `9368ca9e` = orderindex 1 (Paused); Paused On `930c49eb` from date `1oSW8QjBPKYO`; Resume On `d3c46259` from `BD2jRLcwfSmL` (Asia/Kuwait) | Runs on a complete Typeform response with hidden `onboarding_client_id`. The filter needs the card on `901816559981`, a matching id and both dates. Module [3] comments. | Live, never ran: 0 log rows; 1 response ever (the 2026-09-14 internal test) | blueprint; hook 4371898; option order from the list field read |
| Billing Pause tab, `cockpit_billing_write` edit `pause` | Mirror: Paused, `paused_on`. Queue: Client Status "Paused", then Paused On. **No Resume On anywhere.** | Needs a reason of at least 4 characters | Dry run; 0 pause events ever | `20261009a:397-402`; `20261009j:75-77` |
| Billing `resume` | Client Status "Active"; clears Paused On; sets Next Payment Date if one is given | | Dry run; 0 resume events | `20261009a:403-409`; `20261009j:78-82` |
| Media buyer hold, `cockpit_client_holds` | No card field | Pauses verified Meta campaigns. Offboarding adds a "Client Offboarding Request" task with Request Type on Operations / Tech `901816723190`. | Live code; 0 holds | `cockpit-media-api/clientLifecycle.ts:5`, `:36-48`; `PAUSE-OFFBOARD.md:19-20` ("The CSM continues to own the canonical Client Board status") |
| Ask a team "Pause this client" | No card field | Ticket "<client> - Pause this client" on Operations / Tech, status "to do", Additional Notes, then a link comment on the card | Live (`CLICKUP_WRITEBACK_APPLY_CSM_TICKETS`); no pause ticket so far | `CsmPage.tsx:181`; `queue.ts:196-229` |
| CSM `act` with kind `stage` | Client Status, set to any option ClickUp offers, Paused and Stopped included | Writes the card directly | Live code, never used: `cockpit_csm_actions` has no stage rows, and a grep found no UI caller | `cockpit-csm-api/core.ts:30-32`, `:45` |
| Make `9686154` "10. Client Resume Due" (reads) | Client Status and Resume On, read **by field name**, not id | Posts in #media-general `C0AE8G5MT7Y` while a Paused card's Resume On is within 3 days | Live: 34 runs 2026-09-22 → 10-25, all ok | blueprint [1], [3] |
| Other readers | Paused On, Resume On, Client Status | | | `billing-sync/billing.ts:42`, `:60`; `csmCadence.ts:20`; `hermes/ad-billing-guard/core.ts:4`; `cockpit-csm-api/checkins.ts:16-22` |

- **ClickUp today:** 0 cards are Paused and 0 have Paused On. Three non-paused
  cards still carry an old Resume On (list read, counts).
- **The pause ticket gets no Request Type.**
  - `techFields` sets Request Type only for actions in `TECH_REQUEST_TYPE`
    (`queue.ts:180-183`). That map has no pause, relaunch or offboard entry
    (`rules.ts:59-66`).
  - The mapping "Pause this client" → "Client Pause Request ⏸️" exists only
    in `cockpit-csm-api/core.ts:6-15`, in the `act` path. The page's tickets
    use the log, not that path (`CsmPage.tsx:1609-1617`), and
    `cockpit_csm_actions` has no ticket rows.
  - The one delivered tech ticket shows steps `ticket`, `ticket_notes` and
    `ticket_link`, with no `ticket_type` (SQL on the queue's `steps`).
  - The comment at `CsmPage.tsx:179-180` assumes the type is set.
- **A billing pause sets no Resume On,** so the `9686154` reminder never fires
  for it.
- **The form promises more than Make does.**
  - The form's thank-you says the account manager will call "before anything
    is paused".
  - Its consent says billing dates do not change (`CTUjv6l3` skeleton, refs
    `pa0002`, `pa0018`).
  - Make `9805613` sets Paused at submit anyway.
  - A native pause needs two steps: the client's request, then the CSM's
    confirmation. Only the confirmation should write the card.

**Stopped and churn**

| Writer | Field | How | Live or dry run | Source |
|---|---|---|---|---|
| Make `9805538` [7] | Client Status = 11 (Stopped); Churn Date `42429a6e` = submit time; Churn Reason `796f25e7` = 0 (Cancelled); Churn Type `a121f39a` = 0 (Mid-programme loss) | Module [6] comments; [5] posts in #csm-announcements `C09SNG5BP53` | Live; 0 runs in the log window; 3 responses ever | blueprint; hook 4371873 |
| Make `8962418` (old cancellation route) | No card field | | Off | `make-inventory.md` §4.9 |
| Churn register, `cockpit_csm_churn_edit` and `cockpit_csm_churn_read` | `cockpit_churn_departures` (Supabase only) plus an immutable log | Never writes ClickUp; nothing links it to the survey | Live; **0 rows** | `20261004a_csm_churn_projections.sql:21-91`; `20261001a_churn_tracker.sql:35-90` |
| CSM `act` with kind `stage` | Can set Stopped | | Never used | `core.ts:32` |

- Billing has no Stopped or churn writer.
- **ClickUp today:** 27 cards are Stopped and 5 have a Churn Date. The register
  has 0 rows, so it misses all of them.
- **Readers:** `billing-sync/billing.ts:44`, `:61-63`;
  `cockpit-ceo-api/finance/billing.ts`; `hermes/ceo-refresh/native/billing.js`;
  `extensions.ts:33` (Stopped counts as gone).

### F.4 Field 9cfdb353, "will not continue"

- **What it is:** a checkbox on `901816559981` named "Did the client give
  direct or indirect implications that they WILL NOT continue" (list field
  read).
- **The card twin of extension question `095cacf2` (Typeform field
  `zIshIZ2Ic5f7`), by wording only.** The question goes on: "…if we bill them
  on the scheduled date?"
- **No writer and no reader.**
  - No `mapper`, `filter` or `parameters` in any of the 202 Make blueprints
    names it.
  - Make `8925654` r1/[21] and r3/[26] list it only in the ClickUp module's
    field metadata, with no value.
  - No repo file names it, and nothing under
    `/opt/data/bibi/{scripts,skills,flows,cron}` does.
- **The answer goes elsewhere.** Make `9805665` [3] copies it into the card
  comment ("At risk of not continuing if billed"). `9000763` [4] copies it
  into column 3 of the "03.1: Extension Audit" sheet.
- 0 of 89 cards have it checked.
- Not verified: whether a ClickUp form or automation sets it. The API does not
  show automations.
- **For the native extension form:** set this checkbox from the same answer,
  in the same writeback item, so the card shows the at-risk flag.

### F.5 The WhatsApp group path

**Where the group lives**

- **On the card: WA Group ID `b1d54dfb` (text).**
  - Set on 60 of 89 cards, all shaped like a group id.
  - By status: 17 Active, 23 Stopped, 13 SALES TEAM TO CONTACT, 5 GHOSTED,
    1 Brand Blueprint Booked, 1 Ready For Launch (counts).
- **No writer found** in the repo, in `hermes`, in any Make mapper, filter or
  parameter, or in the VPS shared scripts.
  - The newest clients (Madana, Shades, Makers, SMART INTERIOR) have a sheet
    group but an empty card field.
  - So the card field looks back-filled by hand and not kept up. This is an
    inference, not verified.
- **In the Client Data sheet (`1_0Nv-…`).**
  - Read with the service account the ad billing guard uses
    (`GOOGLE_APPLICATION_CREDENTIALS` in its private config; scope
    `spreadsheets.readonly`, `hermes/ad-billing-guard/transport.ts:191-228`).
  - Headers: C "Clickup ID", F "WA GROUP ID", H "Google Drive Link".
  - 68 rows. 65 have column F, all shaped like a group id.
  - 64 of those 65 ids are cards on the list ("ValQor Designs" is not).
  - 60 match a card with WA Group ID set. Of those, 58 hold the same group and
    **2 differ** (نهوض نجد, Alkhalil).
  - 4 sheet groups have an empty card field. No card group lacks a sheet row,
    and no card id appears twice.
- **Make reads the sheet, never the card field.** Each scenario looks up the
  row by card id in column C unless noted:

  | Scenario | Lookup | What it sends or stores |
  |---|---|---|
  | Make `8925654` (kickoff) | r3/[24] by C | Phase 4 [25] to `` `5` `` = F, with the content folder `` `7` `` = H |
  | Make `9748311` (Brand Blueprint) | r1/[6] by C | Phase 5 [7] to F |
  | Make `9209179` (call summary) | [13] by C | Stores F as the record's `to` in data store 171744 (r1/[23]) |
  | Make `9356423` (launch) | r3/[24] by **B, the client name** | Phase 6 [25] to F |

  Make `9799073` [5] and `8866601` [5] read the sheet too.
- **The cockpit reads the sheet only to flag a missing group**
  (`hermes/cockpit-sync/csmProfileCalculations.ts:552-556`). It stores no group
  id.

**Who can send to a group today**

| Path | How it sends | Group source | Gates | Live use | Source |
|---|---|---|---|---|---|
| Make 07 `9523861` through hook 4258649 "Client Send Approval" | WHAPI [5] to the record's `to`, after a random 30–120 s wait [11]; then marks the record sent [6] | A record in data store 171744 "Pending Client Sends" (38 records). Only Make `9209179` r1/[23] writes these, from Client Data F. | The record must be `pending`. Approval happens on a Make-hosted page. **The hook has no API key and no IP list.** No read-back. | 47 runs 2026-10-01 → 10-21, all ok | blueprint; `/hooks`; `/data-stores` |
| Cockpit GoHighLevel reply (`cockpit-media-api/whatsapp.ts` with `tools.ts` `ghl`) | `conversations/messages`, type `Custom`, through the WhatsApp bridge provider (`whatsapp.ts:39-41`), after a do-not-disturb read | The `wa_threads` row linked to the card (`client_task_id`) | A signed-in person only. Client gate; 20 per person and 5 per chat in any 10 minutes; no lead words (`20261012f_wa_send_rules.sql:1-30`). `tools.ts` allows only that POST and a contact GET (`tools.ts:31-32`). Env `GHL_MAHARA_PIT`, `GHL_MAHARA_LOCATION`. | The CSM desk is the only enabled desk. 64 group threads, 36 linked to 28 cards. **0 reply intents ever.** | SQL on `wa_threads`, `cockpit_wa_connections`, `cockpit_wa_reply_intents` |
| WHAPI from the VPS (`hermes/ad-billing-guard`) | `gate.whapi.cloud/messages/text` (`transport.ts:299-315`) | Client Data, by the headers "Clickup ID" and "WA GROUP ID" (`core.ts:166-188`), checked against the stored binding (`core.ts:203-205`) | Group ids only (`transport.ts:299-300`). An intent row before the send. Reconciles by a reference marker in `messages/list` and never resends on its own (`transport.ts:318-375`). Env `AD_BILLING_WHAPI_TOKEN`, `AD_BILLING_APPLY` (true). | 15 WhatsApp deliveries accepted; 17 bindings with a group | SQL on `cockpit_ad_billing_deliveries`, `cockpit_ad_billing_bindings` |

- **No Edge Function holds a WHAPI secret.** The names `CSM_WHAPI_TOKEN`,
  `CREATIVE_WHAPI_TOKEN` and `WHAPI_BASE_URL` appear only in the paused Convex
  code (`apps/media-buyer-cockpit/convex/comms.ts:24`, `outboxDrains.ts:123`).
- **Outbound messages already appear in GoHighLevel group threads** (303
  delivered, the latest on 2026-10-25), so the bridge sees group traffic.
- Not verified: which tool sent those messages, and whether a cockpit
  `Custom` send lands in a group.

**Recommendation: WHAPI from a VPS worker**

Use WHAPI from a VPS worker that reuses the ad billing guard's transport. It
should carry the native kickoff recap, the native 1-1 recap and the phase 5
message.
- **Same group as Make.** Take the group from Client Data column F by card id.
  The client then gets the message in the group Make already uses.
- **Check the card field.** Refuse to send when both groups are set and
  differ (2 clients today). The cockpit then says "Fix the group on Client
  Data or on the card".
- **The CSM approves in the cockpit.** The approval row is the intent, and the
  worker sends only approved rows.
  - Read back by a marker. Never resend an unknown outcome.
  - Matching a marker instead of the whole text also answers `slack.md`'s
    point that exact-text read-back fails on URLs.
- **Phase 5 has two possible senders** while the old Blueprint link is live
  (Make `9748311` [7]). Send it only after a read of the group's latest
  messages finds no phase 5 text for this client.
- **Never recap a response Make 06 already handled.** Kickoff `tG7dnxBn` and
  1-1 `fRokTITH` still post to hook 4114295.

Why not the other two:
- **Make 07** needs a record in a Make data store that only Make 06 writes. It
  keeps the approval on an open Make page outside the cockpit's audit, and it
  does not read back.
- **GoHighLevel** fits a person replying in a chat.
  - It has never sent a message.
  - It reaches 28 linked cards, against 65 groups in the sheet.
  - Nobody has checked that the `Custom` provider posts into a group.
  - Keep it as the fallback, after one supervised test.

### F.6 Contradictions settled here

- **Extension field:** `8cb9d308` is one field, "Current extension (weeks)",
  with two writers (F.1). The "two fields" wording in sections 5 and 9 is
  wrong.
- **"One form, one writer":** the billing sheet's Extend edit is not live
  (F.1). The rule holds only once billing writes for real and the Typeform
  route `9805665` and the CEO sync are retired.
- **Extension Form Link:** the id is `538b6c6a-4919-41df-ac0b-8da5caea7fcb`
  (list field read, 2026-10-25). Redo any search keyed on `538b6c6a-b6cd-…`.
- **Pause form filler:** the client fills the Pause Request Form (F.3).
  Section 8.3 should plan a client request page plus a CSM confirmation, not a
  CSM-only form.
- **Next Payment Date writers:** `make-inventory.md` §5 lists three. Add the
  billing writeback (dry run) and the CSM by hand, and mark `9585358`
  dormant.
- **Make 06 route numbers:** the recap route is index 1 in the blueprint (r1),
  which is "route 2" when counted from 1. They are the same route.

### F.7 Not verified

- Which date Maher reads, and what a "chase" sends. His skill is not in this
  repo or under `/opt/data/bibi`, and `/home/aziz` was not opened.
- Who fills WA Group ID `b1d54dfb` on the card.
- Whether a ClickUp form or automation sets `9cfdb353`.
- Whether a GoHighLevel `Custom` send lands in a group thread, and who sent the
  303 delivered group messages.
- Whether Make's WHAPI channel and the guard's WHAPI token use the same
  WhatsApp number. If they do not, a client would hear from two numbers.
- The exact `next` expression in `9585364`'s link was masked in the read; its
  Slack text shows `addMonths`.
- `CEO_EXTENSIONS_APPLY = true` is inferred from the pass's note text
  (`extensions.ts:199-236`), not read.
