# Typeform inventory: every client and team form the ask covers

Read-only map, 2026-10-25, worktree `forms-1025` (origin/main `d2c9817c`).
Nothing was submitted, edited, posted or sent. No secret, phone number, email
or message body is in this file.

Other maps cover the kickoff (`kickoff-path.md`), the Brand Blueprint
(`blueprint-path.md`), Make in depth (`make-inventory.md`), the ClickUp ticket
form (`clickup-ticketing.md`), Fathom (`fathom.md`) and Slack (`slack.md`).
This one lists every other form, what each asks, who fills it, how it reaches
them, how often it is used, what it triggers, and what a native cockpit form
would fix. It ends with a ranking.

## 0. The short version

1. **One CSM form carries real weight: the 1-1 Call Notes form `fRokTITH`.**
   34 responses, 25 in the last 90 days, newest 2026-10-21. It triggers GPT
   to-dos, a call grade, a Client Happiness and Last POC write on the card, and
   a client WhatsApp recap after a #csm-general approval. Everything else the
   CSM is meant to fill is close to unused.
2. **The CSM sends the call notes form a ClickUp card id it cannot use.** The
   cockpit link adds `#task_id=` (`onboardingCore.ts:105-109`). Make 06 looks
   for `hidden.onboarding_client_id`, which this form does not declare, then
   the typed Client ID (Make 9209179 module 16). So the typed ID is still the
   only key Make has. 8 of the 26 runs in Make's log window failed (30 Sep to
   1 Oct).
3. **The lifecycle forms have no real data.** Extension `gqBcyK6g`: 2
   responses ever, both tests. Pause `CTUjv6l3`: 1, the 14 Sep test.
   Termination `knIe4eF3`: 3 ever, 0 real in 90 days. Meanwhile 4 client cards
   got a Churn Date in the last 90 days, 26 cards read Stopped, and no card has
   a Paused On date in 90 days (ClickUp list `901816559981` filters).
4. **The cockpit's own Links page hands out the bare lifecycle links.**
   `csmLinks.ts:221-236` link `CTUjv6l3`, `gqBcyK6g`, `knIe4eF3` with no hidden
   fields. The three "Client Lifecycle" scenarios only act when
   `hidden.onboarding_client_id` is set (filter on module 2 of 9805613, 9805665,
   9805538). A form filled from the Links page changes nothing on the card.
   The per-client links live in card fields Pause/Extension/Termination Form
   Link (64 cards carry one).
5. **The four Rs commission forms are dead since May.** Review, referral and
   three upsell forms: 35 responses in total, none after 2026-05-11. The
   cockpit's Money page still says "no form, no commission"
   (`csmLinks.ts:180`).
6. **NPS and onboarding CSAT have one response each, both on 2026-03-30**, the
   day they were made. No Make scenario sends them; their scenarios only post
   to #nps-survey-feedback and store nothing.
7. **The Client Card Info form `Uju17Z13` asks for a full card number, expiry
   and CVV as plain text.** Make 17 writes it to a Google Sheet and a Slack DM.
   It must not move into the cockpit; it should be retired (one response, 8 Apr).
8. **"Reactivate your ads" `ecJQ5Z5C` has no reader.** No webhook, no Make
   hook, no code reads its answers. It is linked on the Links page with none of
   its four hidden fields filled.
9. **The New Client Form `BTzMwXiw` is the second busiest form** (21 in 90
   days) and already sits inside the sales cockpit as a Typeform embed. It has
   four live webhooks; one Make hook for an inactive scenario holds 5 queued
   submissions.
10. **Best order to move:** call notes, then the lifecycle trio as one
    "Change this client's plan" action, then the client onboarding form, then
    a single "Log a win" form for the four Rs, then NPS/CSAT and termination as
    one client survey page. Retire the card form and the dead forms.

## 1. How I counted

| What | How | Source |
|---|---|---|
| Form list | `GET api.typeform.com/forms?page_size=200`: 43 forms | VPS script, Typeform token read by name |
| Questions, logic, hidden fields, endings | `GET /forms/{id}` | same |
| Responses | `GET /forms/{id}/responses?page_size=1`: `total_items` only, with `response_type=completed` (and `partial`, `started` where it mattered), `since=2026-07-27T00:00:00Z` for 90 days, `sort=submitted_at,desc` for the newest date. No answer content was read. | same |
| Second source | `cockpit_csm_call_forms` (filled by `hermes/csm-calls`) matches Typeform exactly for all five forms it mirrors | SQL below, section 8 |
| Webhooks | `GET /forms/{id}/webhooks`; each URL matched in the same process to Make `GET /hooks?teamId=2108984`. URLs were never printed, only host, tag, enabled and the Make hook. | same |
| Make | `/scenarios`, `/scenarios/{id}`, `/blueprint`, `/logs?pg[limit]=50` | Make API, GET only |
| Make log window | The oldest log returned for any scenario is 2026-09-30 (9209179). "No runs" below means none since about 30 Sep, not none ever. | `/scenarios/9209179/logs` |
| Links in use | repo grep for each id and `typeform.com/to/<id>`; ClickUp search; ClickUp doc "Important Forms" | file:line below |
| Who sends a link | text search of all 77 active Make blueprints for every form id | Make API |

Hidden refs: small forms show full Typeform field refs. The two long forms
(`KFRCXPFx`, `BTzMwXiw`) show the first 8 characters; the full refs are in
`apps/client-success-cockpit/src/forms/prefill.ts` and
`apps/sales-cockpit/src/lib/clientForm.ts`.

## 2. The inventory at a glance

Responses are completed responses: total / last 90 days / newest.

| Form | Id | Filled by | Reaches them by | Responses | Live webhooks → reader | State |
|---|---|---|---|---|---|---|
| Client 1-1 Call Notes | `fRokTITH` | CSM | cockpit client page and Links page, message templates, ClickUp doc "Important Forms" | 34 / 25 / 2026-10-21 | Make 06 `9209179` | **Busy** |
| New Client Form | `BTzMwXiw` | Closer | Sales cockpit lead page (Typeform embed), resource link | 55 / 21 / 2026-10-17 | Make 10 MAIN `8979157`; Cortana; HighLevel; Make 09 `9169732` (inactive, 5 queued) | **Busy** |
| Mahara - Onboarding | `KFRCXPFx` | Client | WhatsApp welcome from Make MAIN with `onboarding_client_id`; cockpit Copy link | 46 / 17 / 2026-10-18 | Make 13 `8922994` | **Busy** |
| Client Extension Form | `gqBcyK6g` | CSM | card field Extension Form Link (64 cards); bare link on Links page | 2 / 1 / 2026-09-14 (both tests) | Make 14 `9000763`; Make Lifecycle `9805665` | Unused |
| Pause Request Form | `CTUjv6l3` | Client | card field Pause Form Link; bare link on Links page | 1 / 1 / 2026-09-14 (test) | Make Lifecycle `9805613` | Unused |
| Contract Termination Survey | `knIe4eF3` | Client | card field Termination Form Link; bare link on Links page | 3 / 1 / 2026-09-14 (test) | Make Lifecycle `9805538`; Make 13 `8962418` (inactive) | Unused |
| NPS Survey | `fuPgs85S` | Client | Links page only; no sender found | 1 / 0 / 2026-03-30 | Make 12 `8962328` (Slack only) | Dead |
| CSAT Survey - Onboarding | `KbcbPA73` | Client | Links page only; no sender found | 1 / 0 / 2026-03-30 | Make 11 `8962387` (Slack only) | Dead |
| Client Review | `ETEynRgb` | CSM | Links and Money pages | 4 / 0 / 2026-05-05 | Make 01 `9169735` | Dead |
| Referral Form | `bAmbMKM2` | CSM | Links and Money pages, ClickUp doc | 8 / 0 / 2026-05-06 | Make 02 `9188441` | Dead |
| Website Upsell | `VP3zmaj2` | CSM | Links page, ClickUp doc | 12 / 0 / 2026-05-11 | Make 04 `9195843` | Dead |
| Social Media Management Upsell | `IVHO9BMC` | CSM | Links and Money pages, ClickUp doc | 3 / 0 / 2026-05-11 | Make 05 `9205789` | Dead |
| Backend program upsell | `cKItPZVI` | CSM | Links page, ClickUp doc | 8 / 0 / 2026-05-11 | Make 03 `9190294` | Dead |
| Client Card Info Form | `Uju17Z13` | Client | Links page ("Card details form") | 1 / 0 / 2026-04-08 | Make 17 `9018535` | Dead, **unsafe** |
| Reactivate your ads | `ecJQ5Z5C` | Client | Links page (bare) | 2 / 2 / 2026-08-27 (5 started) | none | No reader |
| [SANDBOX] Mahara Internal Request | `o0ULXQhD` | Any team member | private form, not linked | 2 / 2 / 2026-09-09 | Make `9783436` (inactive) | Prototype |
| Site Design Details | `PjfTJypg` | Client | no link in repo or ClickUp search | 3 / 0 / 2026-05-24 | Make 18 `9282377` | Dead |
| Lead list form | `uXtImBuZ` | Client | no link in repo | 1 / 0 / 2026-04-25 | Make 15 `9122691` | Dead |
| Free Gift Survey | `P1xP4r24` | Webinar sign-up | webinar thank-you page | 0 / 0 (1 started) | none; polled by `hermes/webinar-pull` | Other feature |
| Team Onboarding | `Cef2QGBh` | New hire | CEO person page | 0 / 0 (3 started) | Supabase `team-onboarding-intake` | Other feature |
| MaharaMedia Onboarding | `Aa6nUPOs` | Client (old) | none | 9 / 0 / 2025-11-15 | HighLevel webhook still on | Dead |
| MaharaMedia Onboarding Form | `uUEp9YwJ` | Client (old, dental template) | none | 3 / 0 / 2025-07-13 | HighLevel webhook still on | Dead |
| Opt In Form | `gBpJpsLi` | Ad lead | old funnel | 1,412 / 0 / 2026-05-31 | Make 01 `9165775` (inactive) | Out of scope, dead |
| My new form ×3 | `QfUYKESO`, `Y9WssKTT`, `lIEzKhcj` | nobody | private | 0 | none | Empty drafts |
| Cross-reference: Kickoff | `tG7dnxBn` | CSM | see `kickoff-path.md` | 8 / 8 / 2026-10-20 | Make 12 `8925654`, Make 06 | Busy |
| Cross-reference: Kickoff (deprecated) | `BbJy6xg4` | CSM | still linked in media buyer `csmTemplates.ts:35`, ClickUp doc | 27 / 6 / 2026-09-01 | both webhooks disabled | Retired |
| Cross-reference: Brand Blueprint | `oYZKtogO` | CSM | see `blueprint-path.md` | 1 / 1 / 2026-09-13 (6 partial) | Make 14 `9748311`, Make 06 | Replaced |

Job applications and team EOD forms are handled by other cockpit features and
are left out.

## 3. Form by form

### 3.1 Client 1-1 Call Notes Form `fRokTITH` (CSM, after every check-in call)

**Purpose:** the record of a 1-1 client call, and the trigger for the client's
WhatsApp recap.

**Reaches the CSM:**
- Client page: "1-1 notes missing for the last call" and "1-1 call summary
  form", both through `checkinFormLink(taskId)` with `#task_id=`
  (`apps/client-success-cockpit/src/pages/CsmPage.tsx:635`, `:2027`;
  `src/lib/onboardingCore.ts:105-109`).
- Links page "1-1 call summary form" (`src/lib/csmLinks.ts:76-77`), message
  templates (`src/lib/csmTemplates.ts:37`, media buyer copy `:34`), the VPS
  assistant (`viktor-side-scripts/csm/csm_assistant.py:37`), ClickUp doc
  "Important Forms" `2kzmr1ky-4598` ("Post Call Form").

**Questions** (one inline group "Client 1-1 Call Notes"):

| Ref | Type | Req | Asks |
|---|---|---|---|
| `c484f390-9695-4ffa-9693-9cc219592713` | short_text | yes | Client ID (the ClickUp card id, typed) |
| `0773087f-beda-4e2c-bf50-acdac0dcbe05` | long_text | yes | Client's call transcript (pasted) |
| `82a6b434-15d9-4a14-8496-c20c94628536` | long_text | no | Additional notes |
| `5d071906-da6a-4413-a729-0c76d0188d91` | long_text | no | Client notes |
| `ff7970f7-9fad-4fa5-b12b-4d719dfb7587` | multiple_choice | yes | Defcon status: Paused, At Risk, Neutral, Happy, Very Happy (testimonial), Churned |
| `c9f99fb1-fec9-47e7-9baa-c5554733723d` | multiple_choice | yes | Task priority: 911, High, Medium, Low |

- Hidden: `task_id` (the cockpit fills it). No logic, no variables.
- Endings: `626aaf39…` "Notes received…" redirects to the HighLevel booking
  widget `SHjlq0UjeR11maltYNyh`, the check-in calendar
  (`docs/releases/2026-10-03-csm-check-in.md:24`). `default_tys` unused.

**Responses:** 34 total, 25 in 90 days, 10 since 30 Sep, newest 2026-10-21.
`cockpit_csm_call_forms` holds the same 34 / 25 / newest 2026-10-21.

**Webhook:** one, tag `WHTP4114295`, enabled, to Make hook 4114295. The kickoff
and Blueprint forms post to the same hook (tag `postcallsummary`).

**What it triggers** (Make 06 `9209179`, active):
1. Get the card: `ifempty(hidden.onboarding_client_id; answer c484f390)`
   (module 16). Look up the Client Data row in sheet `1_0Nv-IF…`, column C
   (module 13).
2. Route 1, only when `form_id = fRokTITH` (module 3 filter): GPT-4.1 to-do
   list → ClickUp comment on the card (17); GPT call grade → Slack
   #client-call-feedback `C09SVG6FHGU` (4, 15); card fields Client Happiness
   `4e3924e3` from Defcon and Last POC `e183f2ce` from submit time (21).
3. Route 2 (all three forms): GPT client WhatsApp summary (22) → Make data
   store (23) → #csm-general `C09RZ0GS0V9` "pending approval" post (24). A
   click on approve runs Make 07 `9523861`, which sends the WhatsApp to the
   client (whapi module 5). Make 07 ran 47 times since 1 Oct, all OK.
4. Separately, `hermes/csm-calls` pulls every response into
   `cockpit_csm_call_forms` keyed on hidden `task_id`, else the typed Client
   ID (`hermes/csm-calls/RUNBOOK.md:23`, `match.ts:300`), and the guardian pages
   when the newest response is stale (`hermes/cockpit-guardian/checks/csm_calls.py:116`).

Make 06 log: 26 runs since 30 Sep, 18 OK, 8 errors, all errors on 30 Sep and
1 Oct. Not verified which form each failed run was for.

**What a native form fixes:**
- The Client ID is typed by hand although the cockpit already knows the card.
  Make never sees the hidden `task_id`. A wrong ID finds no card.
- The transcript is pasted by hand and required. Fathom already records these
  calls (see `fathom.md`); the cockpit can pull the transcript and summary.
- "Client notes" and "Additional notes" overlap.
- Defcon repeats the card's Client Happiness list word for word; the cockpit can
  show the current value and ask only "changed?".
- "Task priority" sets no card field: Make 06 module 21 maps only Defcon and
  Last POC. `csmSync.ts callPriority` reads it (`CEO_COCKPIT_PLAN.md:298`).
  Not verified whether the GPT prompts use it.
- Last Check-in Call `032203ad` is never set by this form, so the cockpit's
  "notes missing" rule cannot fire (`CEO_COCKPIT_PLAN.md:296`).
- The booking redirect is the only "next step". A native form can book the next
  check-in in the same screen (the cockpit already books GHL calls).

### 3.2 Client Extension Form `gqBcyK6g` (CSM, when a client gets more time to pay)

**Purpose:** record an extension of the client's payment date and why.
Each extension costs the CSM $50 (`csmLinks.ts:227`).

**Reaches the CSM:** card field Extension Form Link `538b6c6a-b6cd-4eeb-bf2f-abaf64769a5e`
(prefilled per client; written by an unknown process, see section 7); the bare
link on the Links page (`csmLinks.ts:226`), the VPS daily script
(`viktor-side-scripts/csm/csm_daily.py:37`) and assistant (`csm_assistant.py:40`).

**Questions** (inline group "Giving Clients Extensions"; nothing is required):

| Ref | Type | Asks |
|---|---|---|
| `88d111d8-5385-4fce-9711-9e88d1340c1b` | short_text | CSM giving the extension (typed name) |
| `5145ff0c-009b-4f51-b3a9-4651efc908be` | short_text | Client company name (typed) |
| `095cacf2-2376-4ac7-967d-00515eaf0dcb` | yes_no | Did the client imply they will not continue if billed on schedule? |
| `38661068-f781-4020-9b67-888975912149` | short_text | Call recording where the extension was given |
| `278c2f80-88bd-428e-b330-8c6b3175d63f` | dropdown | Duration: 1 WEEK, 2 WEEKS, 4 WEEKS |
| `03623fb2-4379-4dca-9c32-e4b90b7986eb` | long_text | Reason |
| `6b330404-7a7c-4338-9d34-f4025fc1bff7` | dropdown | In or out of our control |
| `58f7f132-a0b7-4063-bfb1-a68419534b7b` | multiple_choice (multi) | Client limitations: 8 choices incl. "NO LIMITATIONS" |
| `3221695f-ea88-4293-8c9c-057d205515c6` | long_text | What can we improve to prevent this? |
| `84872ef9-c1ee-432f-808c-32153a9b26fe` | yes_no | Is the ClickUp next payment date updated? |

- Hidden: `client_name`, `onboarding_client_id` (from the card's prefilled link).
- One ending, the default. No logic.

**Responses:** 2 total (2026-04-05, 2026-09-14), both tests
(`CEO_SOURCES_OF_TRUTH.md:97`; ClickUp task `86eywfu7g`). No card has
"Current extension (weeks)" `8cb9d308` above 0.

**Webhooks and triggers** (both fire on one submit):
- Make 14 `9000763` (active): row in sheet `1camKnn_…` tab "03.1: Extension
  Audit"; Slack #csm-announcements `C09SNG5BP53`.
- Make "Client Lifecycle - Client Extension Form submitted" `9805665` (active):
  only when `hidden.onboarding_client_id` is set and the card is on list
  `901816559981`; adds 7/14/28 days to Next Payment Date `669ae046` and
  comments on the card. No Slack.
- Readers by API: the CEO cockpit (`supabase/functions/cockpit-ceo-api/extensions.ts:18`,
  matched by typed name) and the CSM sync (`hermes/cockpit-sync/csmProviders.ts:19`).
  `cockpit_ceo_extension_field_writes` has 0 rows.

**What a native form fixes:** the CSM, client, date and recording are known
to the cockpit; free-text names make the CEO match fail
(`CEO_SOURCES_OF_TRUTH.md:97`); the last question is obsolete since Make writes
the date; nothing is required, so an empty submit is possible; the reason
should be a pick plus a line. A cockpit action on the client page ("Give more
time: 1, 2 or 4 weeks, reason, in or out of our control") can write the date,
the extension weeks, the audit row and the Slack line in one go.

### 3.3 Pause Request Form `CTUjv6l3` (client, bilingual)

**Purpose:** the client asks to freeze; they accept that the 90-day term keeps
running and that a pause over 14 days ends the engagement.

**Reaches the client:** card field Pause Form Link `3a04c8a1-d00a-4127-a9fd-5c355fde24bc`
(64 cards carry one, ClickUp filter `IS NOT NULL`); the bare link on the Links
page (`csmLinks.ts:221`) and assistant (`csm_assistant.py:39`). The Links page
note says "Never agree to any of these over WhatsApp, get them on a call
first" (`csmLinks.ts:217`). No Make scenario sends it.

**Questions:**

| Ref | Type | Req | Asks |
|---|---|---|---|
| `pa0003-…-000000000003` | contact_info | | group: first name (req), last name, phone (req), email (req) |
| `pa0008-0000-4000-8000-000000000008` | short_text | yes | Company name |
| `pa0009-0000-4000-8000-000000000009` | multiple_choice | yes | Reason: travel, temporary closure, at capacity, Ramadan or seasonal, other |
| `pa0015-0000-4000-8000-000000000015` | long_text | yes | Tell us more |
| `pa0016-0000-4000-8000-000000000016` | date | yes | Preferred pause start |
| `pa0017-0000-4000-8000-000000000017` | date | yes | Preferred restart |
| `pa0018-0000-4000-8000-000000000018` | yes_no | yes | I understand the 90-day term keeps running and fees do not change |
| `pa0019-0000-4000-8000-000000000019` | yes_no | yes | I understand a pause over 14 days ends the engagement |
| `pa0020-0000-4000-8000-000000000020` | long_text | no | Anything else |

- Hidden: `client_name`, `onboarding_client_id`. Ending `pa0002…`: "your
  account manager will call you to confirm before anything is paused".
- The two consent questions are yes/no: "No" is accepted and submitted.

**Responses:** 1 total, the 2026-09-14 test. No card has a Paused On date
(`930c49eb`) in the last 90 days.

**Triggers:** Make "Client Lifecycle - Pause Request Form submitted" `9805613`
(active): with a hidden card id, sets Paused On `930c49eb`, Client Status
`9368ca9e` = Paused and Resume On `d3c46259`, and comments. It pauses the
status on submit, although the ending promises a call first. No Slack, no
ticket, no ads pause. The media buyer cockpit has its own "Pause & offboard"
that pauses campaigns and raises a typed request (`docs/media-launch/PAUSE-OFFBOARD.md`),
not tied to this form.

**What a native form fixes:** name, phone, email and company are known; the
consents should be required ticks, not yes/no; the CSM should confirm before
the card changes; one pause should also raise the media buyer's pause and the
ClickUp "Client Pause Request" ticket the cockpit can already create
(`supabase/functions/cockpit-csm-api/core.ts:11`).

### 3.4 Contract Termination Survey `knIe4eF3` (client, the cancellation form)

**Purpose:** exit survey after the exit call ("After the exit call only, never
instead of it", `csmLinks.ts:237`).

**Reaches the client:** card field Termination Form Link `24a77b61-af94-46df-b567-d596271421c7`;
the bare link on the Links page (`csmLinks.ts:236`) and assistant (`csm_assistant.py:42`).

**Questions** (nothing is required):

| Ref | Type | Asks |
|---|---|---|
| `34995f1a-83f2-45b1-a798-ffb203ddaadf` | contact_info | first, last, phone, email, company |
| `eafeb9cf-70b5-46c0-9432-4db2998d5bf1` | multiple_choice (multi) | Reason: results, company changes, cheaper provider, in-house, other |
| `62edbc75-ca88-4f1f-875d-5e79939a7edf` | rating 1-10 | Ad performance |
| `8a050499-7d94-47cd-9147-01bc7eaa52f0` | rating 1-10 | Lead quality |
| `20fa36f7-4d93-4277-bd1b-7210272a549e` | rating 1-10 | Communication |
| `9209b2ae-6214-4ffd-b41f-74facda83726` | yes_no | Would you recommend us? |
| `b2d88140-720d-4dfa-bcaf-a953d6b28b5e` | long_text | Final comments |

Hidden: `client_name`, `onboarding_client_id`.

**Responses:** 3 total (oldest 2026-03-30, newest the 2026-09-14 test), 0 real
in 90 days. In the same 90 days 4 real cards got a Churn Date `42429a6e`
(ClickUp filter on list `901816559981`), and 26 real cards read Stopped.

**Triggers:**
- Make "Client Lifecycle - Contract Termination Survey submitted" `9805538`
  (active): sets Churn Date, Churn Reason = Cancelled, Client Status = Stopped,
  Churn Type = mid-programme loss, comments, and posts to #csm-announcements.
  A survey answer therefore churns the client on the card.
- Make 13 "Cancellation Form to Sheet" `8962418`: **inactive**, but its
  Typeform webhook is still enabled. It used to log to tab "03: Cancellation
  Audit", post to Slack and create offboarding tasks from ClickUp templates
  `t-86ex629x6` and `t-86ex629ve`.

**What a native form fixes:** contact details are known; nothing is required;
the churn decision should be the CSM's (the cockpit's churn tracker,
`/client-success/churn`), with the survey stored as the client's voice; the
"recommend" yes/no duplicates an NPS score.

### 3.5 NPS Survey `fuPgs85S` and CSAT Survey - Onboarding `KbcbPA73` (client)

**Purpose:** NPS: how likely to recommend, communication score, what to
add or remove. CSAT: onboarding score 1-10, what they liked, what they did not.

**Reach:** Links page "Send these to the client" (`csmLinks.ts:138`, `:143`).
No Make scenario sends either; no hit in Slack search for the NPS link.
Not verified whether a HighLevel workflow sends them (the API cannot read
workflows).

**Questions:**

| Form | Ref | Type | Asks |
|---|---|---|---|
| NPS | `55fa4f20-8b63-4b03-85e8-057b777f3bc4` | rating 1-10 | How likely to recommend us |
| NPS | `2cce0e77-771a-4184-aaff-c86e8baedf0c` | opinion_scale 0-10 | **no title ("...")** |
| NPS | `987fbb05-8dec-4f2d-b996-cd0055db359f` | rating 1-10 | Our communication |
| NPS | `a8a5ec8f-d37d-4986-a437-90d6af59b6bb` | long_text | What to implement or remove |
| CSAT | `59c96d37-0839-48fe-a3db-3c8059cf74fb` | contact_info | first and last name |
| CSAT | `8cee8acf-62b2-4d17-9ebd-ae1d17b074fe` | rating 1-10 | Onboarding experience |
| CSAT | `68852971-6087-4e21-b828-0a51d6a5dd56` | long_text | What you liked |
| CSAT | `28d68d58-5f1f-4136-a9bd-6c8dd72bb03f` | long_text | What you did not like |

No hidden fields on either, so a response cannot be tied to a client. Nothing
is required.

**Responses:** 1 each, both 2026-03-30 (the day the forms were made).

**Triggers:** Make 12 `8962328` and Make 11 `8962387`: one Slack post each to
#nps-survey-feedback `C09TTGBRQ0G`. Nothing is stored.

**What a native form fixes:** the client is unknown today; a "10-point" NPS is
a 1-10 rating (true NPS is 0-10) with a second untitled 0-10 scale; scores go
nowhere. A cockpit survey page per client, sent on a schedule (end of
onboarding, every 30 days), can store scores and show them on the client page.

### 3.6 Mahara - Onboarding `KFRCXPFx` (client, the main intake)

**Purpose:** the client's business profile for the kickoff and Blueprint calls.

**Reaches the client:** Make MAIN `8979157` sends it in the WhatsApp welcome
(module 40 mentions the form id) with `#onboarding_client_id=<card>`; the
cockpit's Copy link (`OnboardingKit.tsx:443`, `onboardingCore.ts:86-88`); the
ClickUp doc "Important Forms".

**Questions:** 31 answer fields, 26 required, bilingual. Short refs:
- Contact and business: full name `533f14a0`, phone `64f2fb80`, email `7994f0d2`,
  business name `514bfd3f`, address group `4f14f57a` (address, Google Maps
  link), website `454a425f`, Instagram `adecfe45`, Facebook `575d17ed`, front
  desk phone `282dac48`, personal phone `09d2e62a`.
- Business facts: payment options `ee25f923`, years in business `ed1ba2fe`,
  projects to date `0a6b5704`, booking software `7a120dbb`, Meta history
  dropdown `ddf2767d` (5 choices), business hours `b7873d40`.
- Offer: services and price points `d976036f`, #1 service `6271b610`, top five
  FAQs `f2b7bc2b`, ideal project `6c819933`, service areas `fa017616`,
  appointment types multi `b370341c` (online, onsite, office), max travel
  distance `35ea63c3`, landmark `b7c403ea`, appointment length `a20cfc1a`,
  engineers who consult `0a80a0a8`, why they joined `7426c6c5`, free
  consultations `ec89854f`, marketing process `bf8c7c7b`.
- Numbers and goals: last year revenue `7ff5d37a`, top 3 challenges `fcf43e6a`,
  90-day goal `791b99b8`, 12-24 month goal `f4b96a9b`.
- Assets: Drive link `64d23c81`, anything else `41d2d5bb`.
- Logic: the travel-distance question shows only for the onsite choice.
- Hidden: `onboarding_client_id`.

**Responses:** 46 total, 17 in 90 days, 5 since 30 Sep, newest 2026-10-18.
`cockpit_csm_call_forms` matches (46 / 17).

**Triggers:** Make 13 `8922994` (5 runs since 30 Sep, all OK): queues market
intel on the VPS via GitHub, writes Client Profile `7755485f` and the kickoff
link `87d7d889` on the card, a raw-answers comment, the onboarding map link,
a WhatsApp to the client group, and a task on Media/Creative `901818016338`.
Detail in `make-inventory.md` 4.2.

**What a native form fixes:** it re-asks what the closer typed in the New
Client Form (name, phone, email, business, website); phone appears three times;
the 90-day goal title carries a stray "This question is required." The kickoff
and Blueprint forms already prefill from it (`prefill.ts:58`), so moving it
keeps one source. It is client-facing, so it needs a public, per-client token
page, not a staff screen.

### 3.7 New Client Form `BTzMwXiw` (closer, at the close)

**Purpose:** hand a signed deal to onboarding and client success.

**Reaches the closer:** the lead page in the sales cockpit embeds the Typeform
with hidden `contact_id`, `closer`, `setter` (`apps/sales-cockpit/src/lib/clientForm.ts:22-23`;
`hermes/sales-desk/README.md:481`); a resource row (`supabase/migrations/20260924a_sales_cockpit.sql:570`).
The cockpit records each embedded send in `cockpit_sales_client_forms` (3 rows,
newest 2026-10-17) after checking Typeform saved it
(`supabase/functions/sales-api/clientforms.ts:1-8`).

**Questions:** 3 inline groups, 30 fields.
- General information: who closed (dropdown, 4 names), client first and last
  name, phone, a "Raw Phone" copy, email, business name, address, city, state,
  country (6 GCC codes), zip, website, timezone (4 choices).
- Lead and payment: lead source (7), payment structure (5 plans, required),
  payment details (long text, required), agreement to send (5), daily ad spend,
  cash on the call, cash at onboarding, second payment, total contracted
  revenue (all typed numbers, required).
- Client success handoff: Fathom recording link (required), Fathom call
  transcript (required, pasted), CSM to manage (2 names), handoff problems,
  how soon to go live, what was sold (all required).

**Responses:** 55 total, 21 in 90 days, 5 since 30 Sep, newest 2026-10-17.
Make MAIN ran 5 times since 30 Sep (3 OK, 2 warnings): one run per response.

**Webhooks:** Make MAIN `8979157` (active); Cortana `app.usecortana.ai`
(enabled); HighLevel `services.leadconnectorhq.com` workflows-marketplace
(enabled); Make 09 "Closed to RAW LEADS" `9169732` (inactive, hook 4096881
holds 5 queued submissions).

**Triggers:** card creation and billing fields on `901816559981`, a HighLevel
sub-account, portal provisioning, a WhatsApp group and welcome, Slack #new-clients
`C09MNHBAY1Y`, B2B `closed_deals`. Detail in `make-inventory.md` 4.1 and
`docs/csm-forms/KICKOFF.md`; memory note "New client form" says never imitate a
submission.

**What a native form fixes:** "who closed" repeats the hidden `closer`; the
Raw Phone repeats the phone; the transcript and Fathom link can come from
Fathom; the six money numbers can come from the payment plan pick; the CSM
list is two fixed names. Moving it is high value but the highest risk on this
list, because five systems read the Typeform response. Keep the embed and
prefill more, or move it last with a full dry-run path.

### 3.8 [SANDBOX] Mahara Internal Request `o0ULXQhD` (any team member, tickets)

**Purpose:** a Typeform copy of the ClickUp ticket form, built 2026-09-09 and
never switched on. Full detail in `clickup-ticketing.md` section 6.

- One required pick "What do you need help with?" with 30 types, then one
  inline group per type (logic jumps each to the shared ending "Request
  received. The team will review it in ClickUp."). The 30 types: connect a new
  lead form, create ad account, missing leads, new employee onboarding,
  employee offboarding, privacy policy, ad spend invoice, WhatsApp connection,
  WhatsApp reactivation campaign, custom qualification questions, client
  offboarding, DFY to DWY, DWY to DFY, client pause, client relaunch, company
  name, company address, switch funnel intent, landing page, client success
  management request, business licence missing, card missing for ads, new
  script, marketing/ads request, edit campaign, low show rate, low schedule
  rate, general tech, general marketing, general CSM ticket.
- 20 groups repeat the same 55-name client dropdown (one is "test - viktor
  submission (ignore)"). Priority and due date repeat per group.
- Private (`is_public: false`). 2 responses, both 2026-09-09.
- Make `9783436` (inactive) would create a task in "All Tasks" `901816723226`
  with 13 custom fields, including the request type field `e9fd8024`, which the
  cockpit's CSM API already sets for 7 types (`cockpit-csm-api/core.ts:5-14`).

**Lesson for the cockpit:** the client list must come from the card list, not a
pasted dropdown; one client picker and one priority/due block serve every type.

### 3.9 The four Rs forms (CSM, for commission)

| Form | Asks | Responses | Triggers |
|---|---|---|---|
| Client Review `ETEynRgb` | client name "exact as ClickUp", Client ID (ClickUp task id), Google or video review, CSM (2 fixed names) | 4, last 2026-05-05 | Make 01 `9169735`: update row in sheet `1p8CAd5p…` tab "04: Referrals, Upsells, Reviews", comment on the typed task id, Slack #csm-announcements |
| Referral Form `bAmbMKM2` | company, person referred, who referred, incentive (4), closed Y/N, date signed, Client ID (req), revenue (typed text), notes, CSM (2 names) | 8, all 2026-05-06 | Make 02 `9188441`, same pattern; a second webhook to hook 4105357 is disabled and has no scenario |
| Website Upsell `VP3zmaj2` | CSM name (typed, req), client name, Client ID (req), payment plan notes, closed Y/N, cash collected (req), link to update | 12, 2026-05-07 to 05-11 | Make 04 `9195843`, same pattern |
| Social Media Management Upsell `IVHO9BMC` | same as website upsell, without the link | 3, last 2026-05-11 | Make 05 `9205789`, same pattern |
| Backend program upsell `cKItPZVI` | CSM, client, Client ID, what was pitched, payment terms (5), notes, date, closed Y/N, revenue | 8, 2026-05-07 to 05-11 | Make 03 `9190294`, same pattern |

No hidden fields on any of them. No runs since 30 Sep for any of the five
scenarios. They feed the commission rules in `csmMoney.ts:120-185` and the
CEO metrics MON-18 and CS-25 (`CEO_COCKPIT_PLAN.md:132`, `:301`).

**What a native form fixes:** five forms with the same skeleton; typed Client
IDs and CSM names; Y/N dropdowns; revenue as free text on the referral form. One
"Log a win" action on the client page (type: review, video testimonial,
referral, upsell; amount; proof link) would cover all five and feed the
commission screen directly.

### 3.10 Client Card Info Form `Uju17Z13` (client) — do not move

- Asks company, cardholder name, **card number, expiry and CVV** as short text,
  with a statement that the data is used only for ad billing.
- 1 response (2026-04-08). Make 17 `9018535` (active) adds a row to a Google
  Sheet and posts to a Slack DM `D09SHBK5G8H`.
- Linked on the Links page as "Card details form ... when they need to change
  the card the ads bill to" (`csmLinks.ts:146-149`).
- Card data must not sit in a form, a sheet or Slack. Recommend retiring the
  form and the scenario, removing the link, and having the owner review the sheet
  and DM. Card changes belong with the payment provider or Meta's own billing
  page. Not changed here.

### 3.11 Reactivate your ads `ecJQ5Z5C` (client, after a failed card)

- Asks what they did (topped up, enough funds, new card); a statement that the
  bank likely blocked the charge; "I will call my bank today" (legal); new-card
  statement; an acknowledgement (legal); typed full name as signature. Logic
  jumps on the first answer.
- Hidden: `client_id`, `payment_id`, `client_name`, `min_spend`. Nothing in the
  repo or Make fills them; the Links page link is bare (`csmLinks.ts:231`).
- 2 completed (both 2026-08-27, the day it was made), 5 started.
- No webhook, no Make hook, no code reads it. The CSM notes call it "the
  card-declined form, an admin job" (`context/csm_daily_workflow.md:285`).
- A submit does nothing. If the ad-billing guard (`hermes/ad-billing-guard`)
  is to use it, the cockpit should own the page and its reader.

### 3.12 Site Design Details `PjfTJypg` and Lead list form `uXtImBuZ` (client)

- Site Design Details: 19 landing-page discovery questions (company, what
  they do, website, goal, KPIs, ideal customer, colours, deadline, approver).
  3 responses, all 2026-05-24. Make 18 `9282377` creates a task on Web
  Development `901818343027` and comments. No link found in the repo.
- Lead list form: contact details and a lead-list link. 1 response
  (2026-04-25). Make 15 `9122691`: sheet row, Slack #csm-announcements, two
  ClickUp tasks from templates `t-86exghd6t`, `t-86exj3g1a`. No link found.
- Both dead. The lead-list ask overlaps the Internal Request type "WhatsApp
  reactivation campaign" (which asks for the lead list).

### 3.13 Forms already served by other cockpit features

- Team Onboarding `Cef2QGBh`: webhook to Supabase `team-onboarding-intake`
  (tag `cockpit`), 12-question scored quiz with a `score` variable, role kits by
  logic. 0 completed, 3 started; `cockpit_team_onboarding` has 0 rows. Leave as
  is.
- Free Gift Survey `P1xP4r24`: webinar survey with 13 hidden fields (UTMs,
  contact, `webinar_ref`). 0 completed, 1 started; `cockpit_webinar_forms` 0
  rows. **No webhook is registered**, although
  `apps/webinar-registration-api/api/survey.js:1` is written as its webhook
  handler; `hermes/webinar-pull/pull.py:69` polls it instead.

### 3.14 Dead and legacy forms

- `Aa6nUPOs` "MaharaMedia Onboarding" (9 responses, last 2025-11-15) and
  `uUEp9YwJ` "MaharaMedia Onboarding Form" (3, last 2025-07-13; a dental
  template asking about Invisalign and veneers): both still have an enabled
  HighLevel webhook (tag `integration_ai`).
- `gBpJpsLi` "Opt In Form": 1,412 responses, last 2026-05-31; its live
  webhook points at Make `9165775`, inactive. Marketing, out of scope.
- Three empty private "My new form" drafts.
- `BbJy6xg4` kickoff (deprecated): both webhooks disabled, but the media buyer
  cockpit's templates still link it (`apps/media-buyer-cockpit/src/lib/csmTemplates.ts:35`)
  and so does the ClickUp doc "Important Forms".

## 4. Problems shared by many forms

| Problem | Forms | Evidence |
|---|---|---|
| The client is typed (name or ClickUp id) instead of known | `fRokTITH`, `gqBcyK6g`, all five four-Rs forms | refs above; Make 06 module 16 |
| A hidden id is set but the reader looks for another | `fRokTITH` sends `task_id`, Make reads `onboarding_client_id` | `onboardingCore.ts:105-109`; Make 9209179 module 16 |
| Bare links lose the hidden id, so the automation skips | `CTUjv6l3`, `gqBcyK6g`, `knIe4eF3`, `ecJQ5Z5C` | `csmLinks.ts:221-236`; Make 9805613/9805665/9805538 module 2 filters |
| The CSM's name is typed or a fixed two-name list | `gqBcyK6g`, four Rs, `BTzMwXiw` | refs above |
| The client re-types contact details the card holds | `CTUjv6l3`, `knIe4eF3`, `KbcbPA73`, `KFRCXPFx` | refs above |
| A call transcript or recording link is pasted by hand | `fRokTITH`, `BTzMwXiw`, `gqBcyK6g` | refs above; see `fathom.md` |
| Nothing required, so an empty submit counts | `gqBcyK6g`, `knIe4eF3`, `fuPgs85S`, `KbcbPA73`, four Rs | Typeform `validations.required` |
| Consent as yes/no | `CTUjv6l3` | `pa0018`, `pa0019` |
| Answers go only to Slack or a sheet, not the cockpit | `fuPgs85S`, `KbcbPA73`, four Rs, `uXtImBuZ` | Make blueprints |
| Inactive scenario, live webhook | `knIe4eF3` → 8962418; `BTzMwXiw` → 9169732 (5 queued); `gBpJpsLi` → 9165775 | Make `/hooks`, Typeform webhooks |
| No reader at all | `ecJQ5Z5C` | no webhook, no hook, no code |

## 5. Ranking: what moving each form into the cockpit is worth

Usage = real responses in 90 days. Pain = how much a native form removes
(typing, wrong keys, missing triggers). Worth = usage × pain, plus what the
data unlocks.

| Rank | Form | Usage (90 d) | Pain | Why |
|---|---|---|---|---|
| 1 | Client 1-1 Call Notes `fRokTITH` | 25 | High | Busiest CSM form; typed id that Make relies on; pasted transcript Fathom can fill; feeds client WhatsApp recaps and DEFCON; "notes missing" rule is broken |
| 2 | Extension + Pause + Termination, as one "Change this client's plan" action | 0 real | High | The data that drives payment dates, pauses and churn is missing; bare links break the Make writes; the cockpit already has the card, the churn tracker and the media buyer pause |
| 3 | Mahara - Onboarding `KFRCXPFx` | 17 | Medium | Busy, client-facing, long; re-asks the closer's data; already the prefill source for kickoff and Blueprint |
| 4 | Four Rs as one "Log a win" | 0 | High | Commission depends on it ("no form, no commission"); five copies of one form; typed ids |
| 5 | NPS + CSAT (+ the termination ratings) as one client survey page | 0 | Medium | No client key, nothing stored, untitled scale; a sent-on-schedule page gives the CEO a real score |
| 6 | New Client Form `BTzMwXiw` | 21 | Medium | Already embedded; high risk (five readers); prefill from Fathom and the plan pick first, move last |
| 7 | Internal Request (ticketing) | n/a | High | Covered by `clickup-ticketing.md`; the cockpit already raises 7 request types |
| 8 | Reactivate your ads `ecJQ5Z5C` | 2 (tests) | Medium | No reader; belongs with the ad-billing guard if kept |
| — | Client Card Info `Uju17Z13` | 0 | — | Retire; never move (card data) |
| — | Site Design `PjfTJypg`, Lead list `uXtImBuZ` | 0 | Low | Dead since April/May; fold into ticket types if needed |
| — | `Aa6nUPOs`, `uUEp9YwJ`, `gBpJpsLi`, 3 drafts, `BbJy6xg4` | 0 | — | Dead; owner can close them and their webhooks |

Dead (no responses in 90 days and no automated sender): NPS, CSAT, Client
Review, Referral, three upsells, Card Info, Site Design, Lead list, both old
onboarding forms, Opt In, the three drafts. Unused but linked and wired:
Extension, Pause, Termination, Reactivate.

## 6. One backend for all of them (what the inventory implies)

- One key everywhere: the ClickUp card id (`clickup_task_id`), which every
  cockpit table already uses.
- One response store: `cockpit_csm_call_forms` already mirrors five forms;
  `cockpit_csm_form_sends` (`supabase/migrations/20261023a_csm_form_sends.sql`)
  already notes kickoff, blueprint and checkin sends with hidden-field names
  and an audit row. Both are natural homes for native submissions.
- Slack targets in use today: #csm-general `C09RZ0GS0V9` (summary approvals),
  #csm-announcements `C09SNG5BP53` (extensions, termination, four Rs, lead
  list), #client-call-feedback `C09SVG6FHGU` (call grades), #nps-survey-feedback
  `C09TTGBRQ0G`, #new-clients `C09MNHBAY1Y`. See `slack.md`.
- ClickUp targets in use today: card list `901816559981`; All Tasks
  `901816723226`; Operations / Tech `901816723190`; Client Success
  `901816723211`; Media/Creative `901818016338`; Web Development `901818343027`.

## 7. Not verified

- Who wrote the per-client Pause/Extension/Termination Form Link fields on 64
  cards. No repo code and no active Make blueprint contains those field ids or
  writes them; `CEO_SOURCES_OF_TRUTH.md:97` reports the 64. A search of the
  mahara-context repo did not finish in time.
- Whether a HighLevel workflow sends NPS, CSAT, pause or termination links. The
  HighLevel v2 API cannot read workflows, and no Make scenario sends them.
- Which form each of Make 06's 8 failed runs (30 Sep, 1 Oct) belonged to. I did
  not open run details, to keep client data out.
- Make runs before about 30 Sep: the log window starts there, so the 14 Sep
  lifecycle tests do not show in Make; their success is from ClickUp task
  `86eywfu7g`.
- That the 2026-03-30 NPS and CSAT responses and the 2026-03-30 termination
  response are tests. They fall on the forms' creation day; I did not read the
  answers.
- Fathom's API details: left to `fathom.md`.

## 8. Sources

- Typeform: VPS script `GET /forms`, `/forms/{id}`, `/forms/{id}/responses`,
  `/forms/{id}/webhooks`, token read by name from the VPS env file.
- Make: `GET /hooks?teamId=2108984`; `/scenarios?teamId=2108984` (202
  scenarios, 77 active); `/scenarios/{id}`, `/blueprint`, `/logs` for 9209179,
  9523861, 9000763, 9805665, 9805613, 9805538, 8962418, 8962328, 8962387,
  8922994, 8979157, 9169732, 9018535, 9122691, 9169735, 9188441, 9190294,
  9195843, 9205789, 9282377, 9783436, 9165775; a text search of all 77 active
  blueprints for every form id.
- SQL (Creative Triage, SELECT only):
  `select form_id, count(*), max(submitted_at)::date, count(*) filter (where submitted_at > now() - interval '90 days') from cockpit_csm_call_forms group by form_id`
  → KFRCXPFx 46/17, fRokTITH 34/25, BbJy6xg4 27/6, tG7dnxBn 8/8, oYZKtogO 1/1;
  `cockpit_sales_client_forms` 3 rows; `cockpit_csm_form_sends` 0;
  `cockpit_ceo_extension_field_writes` 0; `cockpit_webinar_forms` 0;
  `cockpit_team_onboarding` 0.
- ClickUp (read only): custom fields of list `901816559981`; filters Churn Date
  ≥ 2026-07-27 (4 real + 1 test), Paused On ≥ 2026-07-27 (0), Current extension
  > 0 (0), Client Status = Stopped (26 real + 1 test), Pause Form Link set (64);
  task `86eywfu7g`; doc `2kzmr1ky-4598` "Important Forms"; lists `901816723226`,
  `901818343027`, `901818016338`, `901816723190`.
- Slack (read only): channel search for the five channel ids above.

## Follow-up 2026-10-25

Task: client-form-delivery. How each external client form reaches the client
today, who wrote the per-client links, and who fills the Pause form. Read only.
Nothing was submitted, sent, enrolled or changed. No secret, phone number,
email, contact id, group id, message body or card data is in this section.
Message evidence is counts only.

### F0. The short version

1. **Section 3.2 has the wrong Extension Form Link id.** The right one is
   `538b6c6a-4919-41df-ac0b-8da5caea7fcb`.
2. **The per-client links were a one-time backfill on 2026-09-14.** All three
   link fields were created by the API within 1.2 seconds, five minutes before
   the lifecycle build task `86eywfu7g` was opened. Every card created up to
   2026-09-12 has all three links. No card created since has any. Nothing in
   code, Make or the context repo writes them.
3. **Almost none of these forms reach a client today.** Since the WhatsApp
   mirror began (2026-09-20) no message carried a termination, pause, NPS,
   extension, reactivate or card link. One CSAT link went to one group. The
   only form that reliably reaches clients is onboarding `KFRCXPFx`, in the
   Arabic welcome Make MAIN posts in each new client group.
4. **HighLevel is not a live path.** Its own Client Pausing, Client Extension,
   Offboarding and Onboarding forms and its NPS, CSAT and Termination surveys
   have 0 submissions ever. Six matching workflows are published, but their
   triggers cannot be read.
5. **Pause: both maps are partly right.** The client fills Typeform `CTUjv6l3`
   (first-person consent, written request), only after a call agrees the pause.
   The CSM files a separate ClickUp "Client Pause Request" ticket. A
   non-payment pause has a ticket and no client form.
6. **Termination is sent after the exit call, never instead of it.** The SOP
   template sends a bare link, so Make `9805538` skips it and the card does not
   change.

### F1. Correction: link field ids

Read 2026-10-25 with `clickup_get_custom_fields` on list `901816559981`.

| Field | Id | Type |
|---|---|---|
| Extension Form Link | `538b6c6a-4919-41df-ac0b-8da5caea7fcb` | url |
| Pause Form Link | `3a04c8a1-d00a-4127-a9fd-5c355fde24bc` | url |
| Termination Form Link | `24a77b61-af94-46df-b567-d596271421c7` | url |
| Daily Budget (the id 3.2 spliced in) | `539743c2-b6cd-4eeb-bf2f-abaf64769a5e` | currency |

Section 3.2's `538b6c6a-b6cd-4eeb-bf2f-abaf64769a5e` does not exist.
`clickup-ticketing.md` has the right id. Every search below uses the right
one.

### F2. Who wrote the per-client links

| Check | Result | Source |
|---|---|---|
| When the fields were made | Termination 09:35:00.754, Pause 09:35:01.335, Extension 09:35:01.880 UTC, 2026-09-14. Three fields in 1.2 s means a script | `GET /api/v2/list/901816559981/field` `date_created`, VPS, ClickUp key read by name |
| The build task | `86eywfu7g` "[Codex] Build client lifecycle Typeform writebacks" opened 09:40:33 UTC and closed 10:47:00 UTC the same day. It names the three forms and says the join key is `hidden.onboarding_client_id`. It does not mention writing the links | ClickUp `get_task 86eywfu7g` |
| Cards with links | 70 top-level cards (88 with subtasks). 64 carry all three links. None carries one or two. 6 carry none | `GET /list/901816559981/task?include_closed=true&subtasks=true` |
| When those cards were made | All 64 with links: 2026-01 to 2026-09-12. All 6 without: 2026-09-14 or later | same, `date_created` |
| The 6 without | The test card `86eywg1cq` (made 10:28 UTC on 2026-09-14, after the fields) and five real clients made 2026-10-02, 10-04, 10-09, 10-13 and 10-17 | same; ClickUp `get_task 86eywg1cq` |
| Link shape (all 64 × 3) | Host `maharamedia.typeform.com`, path `/to/CTUjv6l3`, `/to/gqBcyK6g` or `/to/knIe4eF3`, fragment keys `client_name` and `onboarding_client_id`, no query. `onboarding_client_id` equals the card's own id on 64 of 64 for each field | same; values were compared on the VPS, never printed |
| Worktree grep | 0 hits for the three ids, their first 8 characters, or the three names, outside `docs/forms/maps` (includes `viktor-side-scripts`, `hermes`, `scripts`) | `grep -rn` |
| mahara-context | Local copy (HEAD `15368c7`, 2026-09-19): 0 hits. Remote main `d9687d90`, 765 files fetched by path (sessions since 2026-09-13, `systems/`, `client-comms/`, `context/`, the form-building, client-comms, ClickUp and external-services skills): 0 hits for the ids. One hit on the names: a 2026-10-15 session hand-edited `client_name=` in one card's three links after a client rename | `shared/sessions/2026-10-15T144000Z-claude-professional-touch-rename.md:14` |
| Client portal repo | 0 hits in `scripts/backfill-clickup.ts`, `src/lib/provisioning.ts`, `src/lib/billing-clickup.ts`, `docs/client-journey/make-audit.md`, `make-delivery.md` | `gh api repos/AzizWaheedi/mahara-client-portal/contents/...` |
| Make | 202 of 202 blueprints read (4 needed a retry). 0 hits for the three ids, the wrong id, their prefixes or the three names | `GET /scenarios?teamId=2108984`, `/scenarios/{id}/blueprint` |
| ClickUp search | "Pause Form Link" and "Termination Form Link" find `86eywfu7g` and two unrelated tasks (`z8xmdvgu3f`, `z8xmdvfpt6`) | `clickup_search` |
| Cockpit readers | No cockpit code reads the three fields. The CSM sees them only on the ClickUp card | worktree grep |

**Answer.** A one-time scripted backfill on 2026-09-14, after 09:35 UTC,
almost certainly by the Codex session that built the lifecycle writebacks
(`86eywfu7g`). Nothing writes the links for new clients. Since then they are
kept by hand (the 2026-10-15 rename).

**Not verified:** the writer itself. ClickUp's public API has no field edit
history, so this rests on timing.

**What it means.** The five clients signed since 2026-09-14 have no prefilled
lifecycle link. Any pause or termination link they get is bare, and Make
`9805613` and `9805538` skip a bare submission (filter on
`hidden.onboarding_client_id`, `86eywfu7g`; section 3.3, 3.4).

### F3. How the links reach clients

#### F3a. WhatsApp and other message mirrors (SQL, counts only)

`public.wa_messages` joined to `public.wa_threads`: 7,812 messages in 170
threads (64 groups, 106 one-to-one), all desk `csm` on location
`wwG426bwruWWv9W3fazQ`, from 2026-09-20 to 2026-10-25. In groups, team posts
arrive as `inbound` with a speaker ending "| MaharaMedia". I counted those and
every `outbound` row as "us → client".

| Form | Month | Direction | Chat | Messages | With the card id |
|---|---|---|---|---|---|
| Onboarding `KFRCXPFx` | 2026-10 | us → client | group | 5 | 5 |
| Onboarding `KFRCXPFx` | 2026-10 | us → client | 1-1 | 1 | 1 |
| CSAT `KbcbPA73` | 2026-09 | us → client | group | 1 | 0 |
| New Client Form `BTzMwXiw` | 2026-10 | us → client | 1-1, not linked to a card | 1 | 0 |
| Termination `knIe4eF3`, Pause `CTUjv6l3`, Extension `gqBcyK6g`, NPS `fuPgs85S`, Reactivate `ecJQ5Z5C`, Card `Uju17Z13` | any | any | any | **0** | — |

- Client → us: 0 for every form.
- The five group onboarding posts fall on 2026-10-02, 10-04, 10-10, 10-13 and
  10-17, one per new card. Each is about 800 characters from a team account,
  mostly Arabic (about 470 Arabic letters to 180 Latin). That is Make MAIN
  `8979157` module 40 (`whapi-cloud:text`, `to` mapped from module 39, body
  naming `KFRCXPFx` and `onboarding_client_id`). This also confirms
  `make-inventory.md` 4.1's "Arabic welcome".
- The one CSAT post (2026-09-21) was a long, mostly English message from a team
  account in one client group. No CSAT response followed.
- `portal_data.messages`: 57,885 messages from 35 client sub-accounts,
  2025-10-25 to 2026-09-19, none from location `wwG426bwruWWv9W3fazQ`. These
  are the clients' own lead chats. 0 hits for every form.
- `cockpit_sales_messages`: 67 rows, 0 Typeform links.

SQL (Creative Triage, SELECT only), for example:
`select f.label, to_char(m.at,'YYYY-MM'), case when m.direction='outbound' or m.speaker ilike '%mahara%' then 'us_to_client' else 'client_to_us' end, t.is_group, count(*) from (values ...) f(id,label) join wa_messages m on m.body ilike '%/to/'||f.id||'%' join wa_threads t on t.id=m.thread_id group by 1,2,3,4`.

#### F3b. Templates and link lists in code

| Place | Forms | Link |
|---|---|---|
| `apps/client-success-cockpit/src/lib/csmTemplates.ts:224-231` "Onboarding, book the call" (EN and AR) | Onboarding | `onboardingFormLink(taskId)`, card id included (`onboardingCore.ts:86-88`) |
| `csmTemplates.ts:197-205` "Pausing, tell the client" | none | Tells the client a non-payment pause is being filed. No form |
| `csmTemplates.ts:37` | Call notes (CSM's own) | bare |
| `csmTemplates.ts` | Termination, pause, extension, NPS, CSAT, reactivate, card | **no template carries them** |
| `apps/client-success-cockpit/src/lib/csmLinks.ts:133-150` "Send these to the client" | CSAT `:138`, NPS `:143`, Card `:147` | bare |
| `csmLinks.ts:215-240` "Changing a client's plan" | Pause `:221`, Extension `:226`, Reactivate `:231`, Termination `:236`, exit doc `:239` | bare |
| `apps/media-buyer-cockpit/src/lib/csmLinks.ts:111,116,120,194,199,204,209` | same seven | bare |
| `apps/media-buyer-cockpit/src/lib/csmTemplates.ts:34-35` | Call notes, retired kickoff `BbJy6xg4` | bare |
| `apps/client-success-cockpit/src/components/OnboardingKit.tsx:443` | Onboarding | Copy link with the card id |
| `viktor-side-scripts/csm/csm_assistant.py:37-44` | Pause `:39`, Extension `:40`, Reactivate `:41`, Termination `:42` | bare |
| `viktor-side-scripts/csm/csm_daily.py:37-38`, `:600` | Extension Typeform, and the ClickUp ticket form as "pause task" | bare, in the CSM's daily sheet footer |
| mahara-context `client-comms/csm-templates.md:524-533` "Client is confirmed to cancel" (EN and AR) | Termination | bare |
| mahara-context `client-comms/_RESOURCES.md:44` | Termination | bare |
| Google doc "Client Exit Process" `1tlZlMcasIXU23wMNjvqcrzx1qzKeCLlPyDLOPcGfoNc` | Termination | bare |
| ClickUp doc "Important Forms" `2kzmr1ky-4598`, page `2kzmr1ky-1438` | none of these seven | — |

#### F3c. HighLevel, location `wwG426bwruWWv9W3fazQ`

Token `GHL_MAHARA_PIT` read by name on the VPS; base
`https://services.leadconnectorhq.com`, `Version: 2021-07-28`.

- `GET /forms/?locationId=`: 19 forms. Per-form submissions need `startAt` and
  `endAt`; without them the API answers 0 for every form. With
  `startAt=2024-01-01`: 36 submissions in all, in three forms only.
  "5. Post Client Call Task Creation Form" 17 (2025-11-14 to 2026-05-23),
  "7. New Creative Form (Video)" 11 (2026-02-24 to 2026-03-25), "*General
  Universal Ticket*" 8 (2025-11-14). "2. Client Pausing", "3. Client
  Offboarding Request", "6. Client Extension", "1. Onboarding Form" and the
  other 12: 0 ever. Last 90 days: 0 for all 19.
- `GET /surveys/?locationId=`: "NPS Survey", "CSAT Survey - Onboarding",
  "CONTRACT TERMINATION SURVEY". 0 submissions ever
  (`/surveys/submissions`, same date range).
- `GET /workflows/?locationId=`: 20 workflows, 17 published, 3 draft. Names
  that match: "3.1 Client Cancellation Survey Automation", "3.2 Client Churned
  - Bad Terms", "3.3 Client Churned - Good Terms Reactivation Sequence", "3.4
  Client Paused", "3.5 Giving Clients Extensions", "4.5 NPS / CSAT
  Submissions". All published; last updated 2025-10-21 or 2025-11-14.
- Two active legacy Make webhooks carry matching names: `8069181` "03. Client
  Extension Given (OLD)" (hook 3587385) and `8068892` "07. NPS and CSAT to
  Slack + Sheet (OLD)" (hook 3587165). Both queues are 0 (`GET /hooks/{id}`)
  and both show 0 runs in the log window (`make-inventory.md`).
- **Not verified:** the six workflows' triggers and actions. The public API
  lists names and status only. This corrects section 7, which said the API
  cannot read workflows at all. With 0 HighLevel submissions and 0 matching
  WhatsApp messages since 2026-09-20, no evidence shows them sending anything.
- None of the eight client forms has a HighLevel webhook
  (`GET api.typeform.com/forms/{id}/webhooks`: Make hooks only).

#### F3d. Slack

`slack_search_public_and_private`, bots included, as the CEO's account.

| Search | Hits | Channels and dates |
|---|---|---|
| `knIe4eF3` | 0 | — |
| "termination survey" | 3 | the 2026-09-14 test notice: #csm-announcements (bot), #csm-general and #client-success-general (CEO account) |
| `CTUjv6l3` | 1 | #client-billing 2026-09-16 (the assistant's daily overdue check) |
| `gqBcyK6g` | 2 | #client-billing 2026-09-16; DM CEO and assistant 2026-08-29 |
| `fuPgs85S`, `KbcbPA73`, `Uju17Z13` | 0 | — |
| `ecJQ5Z5C` | 1 | DM CEO and assistant 2026-09-07 (names it the card-declined form) |
| `KFRCXPFx` | 4 | #new-leads-and-texts 2026-04-02; #csm-client-notis 2026-04-16, 04-18 (copies of the welcome when a client texted); #tech-general 2026-09-04 (the welcome template) |
| "pause request" | 14 | #client-billing 2026-09-14 to 09-23 (overdue checks marking day-3 pauses) and DMs 2026-09-03. All about the CSM's non-payment pause ticket |

No Slack message ever carried the termination, NPS or CSAT link.

### F4. Who fills the Pause form, and the Termination survey

**Pause: there are two records, and the maps each saw one.**

1. **Typeform `CTUjv6l3`: the client fills it.** It opens with a contact block
   (first name, phone and email required, `pa0003`-`pa0007`). The welcome
   screen speaks to the client ("Your fees, billing dates and program end date
   do not change"). The consents are first person (`pa0018`, `pa0019`). The
   ending says "Your account manager will call you to confirm" (`pa0002`).
   The form was copied from the client-facing cancellation form
   (mahara-context `skills/meta/mahara-form-building/references/sibling-forms-and-acknowledgements.md:13-14`,
   `:20-30`). The contract asks for a "written request, 3 business days'
   notice" (`skills/meta/mahara-client-comms/references/pause-and-reset-calls.md:28`,
   `:48`); this form is that written request.
2. **The CSM's pause: a ClickUp "Client Pause Request" ticket.** "If a pause is
   genuinely agreed, the CSM submits the ClickUp pause request form"
   (`pause-and-reset-calls.md:40-41`). The CSM's daily sheet links that form as
   "pause task" (`csm_daily.py:38`, `:600`). The cockpit can raise the same
   ticket (`supabase/functions/cockpit-csm-api/core.ts:11`). For a
   non-payment pause on day 3 the CSM files the ticket and tells the client,
   with no client form (DMs 2026-08-29 and 2026-09-03; `csmTemplates.ts:197-205`).

**When and after which conversation.** The client asks to pause. The CSM calls
the same day and runs the reset call. Never handle it in writing, and never
send the form as the first reply (`pause-and-reset-calls.md:9-12`;
`sibling-forms-and-acknowledgements.md:52-60`; `csmLinks.ts:217`). Only if a
pause is agreed does the CSM send the client the Typeform and file the ticket.

So section 3.3 is right that the client fills `CTUjv6l3`. `repo-forms.md` 8.3
is right that the CSM files a pause, but that is the ClickUp ticket, not this
form. The cockpit needs both: a CSM action and a client consent page. Gap:
the ending promises a call before anything pauses, but Make `9805613` sets
Client Status to Paused on submit (section 3.3).

**Termination survey `knIe4eF3`: the client fills it after the exit call, never
instead of it.**
- `csmLinks.ts:237`: "After the exit call only, never instead of it".
- SOP: a cancel request is a concern. Call on Maqsam first, never negotiate
  over WhatsApp (`client-comms/csm-templates.md:409-410`). The link goes out
  only in "Client is confirmed to cancel" (`:524-533`).
- Exit Call Framework (Google doc `1sieoIr3ts6cR6xnuCnKlREogRFzzCmDB4PupGKBe1C4`):
  the contract requires a 30-minute exit call, booked within 24 hours; the
  churn ladder offers half price, a 2-week or a 4-week extension before churn.
- The form's welcome screen: "Submitting this form will automatically
  initiate your notice period." The survey is also the client's written
  notice.
- The SOP link is bare. Make `9805538` acts only with
  `hidden.onboarding_client_id`, so a survey sent by the SOP changes nothing on
  the card and posts nothing to #csm-announcements. Only the 64 old per-card
  links would work.
- In 90 days: 0 real responses, while 4 real cards got a Churn Date (section
  3.4). **Not verified:** whether those four were sent the survey. Some left
  before the mirror began, and a CSM's own phone is not mirrored.

### F5. Where the client opens each form

| Form | Channel | Device | Language |
|---|---|---|---|
| Termination | WhatsApp, after the exit call (SOP template; group or 1-1 is not fixed) | Not verified: no real response; the 2026-09-14 test was desktop | Bilingual in every string; SOP message in EN or AR. Typeform `language` en; the contact block has no title ("...") |
| Pause | WhatsApp, after the agreeing call | Not verified: test only | Bilingual titles; the contact subfields are English only |
| NPS | None today; Links page only | Not verified | Bilingual; its welcome title is "Anonymous NPS Survey" |
| CSAT | WhatsApp client group (one post, 2026-09-21) | Not verified | Bilingual |
| Onboarding | WhatsApp client group, in Make MAIN's Arabic welcome; CSM reminder (EN or AR) and a 1-1 resend | 9 of 17 responses in 90 days on mobile, 8 "other" (desktop) (Typeform `metadata.platform`) | Bilingual questions; Arabic-only welcome screen |
| Reactivate your ads | None found | Not verified | English only |
| Client Card Info | Links page | — | Not checked (titles not read, to stay clear of card data) |

### F6. Final table

Responses are completed Typeform responses since 2026-07-27 (`GET
/forms/{id}/responses?response_type=completed&since=`).

| Form | Who fills | How it reaches them today (evidence) | Where they open it | Hidden client id on the link | Responses in 90 days | What a cockpit version must carry |
|---|---|---|---|---|---|---|
| Contract Termination Survey `knIe4eF3` | Client, after the exit call | SOP "Client is confirmed to cancel" (`csm-templates.md:524-533`), Links page `csmLinks.ts:236`, exit doc; 64 old per-card links. 0 WhatsApp sends since 2026-09-20; 0 in Slack | WhatsApp | Per-card link yes (64 cards, last made 2026-09-12); every link in use no | 1 (the 2026-09-14 test) | A per-card bilingual page opened from the client page once the exit call is logged; the notice-period line first; reasons, three 1-10 ratings, recommend, comments; name and company from the card; answer stored by card id; the CSM confirms the churn in the churn tracker before ClickUp gets Churn Date, Reason, Type and Stopped (today `9805538` writes them on submit); #csm-announcements post; offboarding tasks (templates `t-86ex629x6`, `t-86ex629ve` from inactive `8962418`) and the media buyer offboarding hold; a Send button with the SOP text in EN and AR |
| Pause Request Form `CTUjv6l3` | Client, after the agreeing call; the CSM files a separate ticket | Links page `csmLinks.ts:221`, assistant `csm_assistant.py:39`, 64 old per-card links. 0 WhatsApp sends; 1 Slack mention (#client-billing 2026-09-16) | WhatsApp | Per-card yes; Links page no | 1 (test) | Two parts. CSM action: reason, dates, 14-day cap, 3-business-day check, the "Client Pause Request" ticket, billing pause, media buyer hold, Resume On reminder (as `9686154`). Client page: reason, dates, two required ticks (not yes/no), note, contact from the card. Card writes (Paused On, Paused, Resume On, comment, as `9805613`) only after the CSM confirms |
| NPS Survey `fuPgs85S` | Client | Links page `csmLinks.ts:143` only. No template, no Make sender, 0 WhatsApp, 0 Slack; HighLevel copy has 0 | Not sent today | No (no hidden fields; titled anonymous) | 0 | A decision first: anonymous or named. If named: a per-card page, one true 0-10 question, a communication rating, one text box, a send schedule, scores stored and shown on the client page, the #nps-survey-feedback post (`8962328` today) |
| CSAT Survey - Onboarding `KbcbPA73` | Client, once onboarding ends | Links page `csmLinks.ts:138`; 1 WhatsApp group post 2026-09-21; 0 Slack; HighLevel copy 0 | WhatsApp group | No (no hidden fields) | 0 | A per-card page sent when onboarding ends; 1-10 plus liked and not liked; no name question; stored by card id; #nps-survey-feedback post (`8962387` today) |
| Mahara - Onboarding `KFRCXPFx` | Client | Make MAIN `8979157` module 40 Arabic welcome in the new client group (5 of 5 new cards in October); CSM reminder `csmTemplates.ts:224-231`; Copy link `OnboardingKit.tsx:443`; 1 1-1 resend | WhatsApp group, phone or desktop | Yes (17 of 17 responses carry it) | 17 | The same Arabic welcome with a cockpit token link; 31 answers and the onsite logic; prefill from the New Client Form; phone-first layout; every effect of Make 13 `8922994` (Client Profile, kickoff link, comment, onboarding map, group WhatsApp, Media/Creative task, market intel) |
| Reactivate your ads `ecJQ5Z5C` | Client, after a failed ad payment | Links page `csmLinks.ts:231` (bare), assistant `:41`. No sender, no reader | Not sent today | Form declares four; the links in use fill none (both responses came from filled links on the creation day) | 2 (both 2026-08-27) | Owned by the ad-billing guard: `client_id`, `payment_id`, `client_name`, `min_spend` filled; two legal ticks and a typed signature; Arabic as well as English; stored, and the media buyer told to relaunch |
| Client Card Info Form `Uju17Z13` | Client | Links page `csmLinks.ts:147` | Links page | No | 0 | Nothing. Do not move it; retire it (section 3.10) |

The CSM's Extension Form `gqBcyK6g` follows the same link pattern (64
per-card links, bare elsewhere) and had 1 response in 90 days, the test.

### F7. Contradictions this follow-up settles

- **Extension Form Link id:** `clickup-ticketing.md` is right (F1).
- **Pause filler:** both maps saw half of it (F4).
- **Typeform with a signed webhook (`repo-forms.md`) or a native page:** none
  of the eight client forms' webhooks has a secret today (`GET
  /forms/{id}/webhooks`, `secret` unset on all). The links that reach clients
  are bare for termination, NPS and CSAT, and the per-card links stopped on
  2026-09-12. Keeping Typeform would still need a secret and the cockpit
  putting the card id on every link. The CEO asked to move them. A per-card
  native page fixes both.
- **Termination webhooks:** hook 4371873 belongs to `9805538` (`GET
  /scenarios/9805538`, `GET /hooks/4371873`, form id in its data). The other
  enabled webhook, tag `WHTP4007438`, matches section 3.4's inactive `8962418`
  by elimination (not read directly). `9805538`'s blueprint does not name the
  form; its hook does. A blueprint text search therefore misses it.
- **Make 13:** use ids. `8922994` is the onboarding scenario; `8962418` is the
  old cancellation scenario.
- **"Arabic welcome" in Make MAIN:** confirmed by the delivered messages (F3a).

### F8. Not verified

- Who wrote the 64 per-card links (F2). Inferred from timing.
- HighLevel workflow triggers and actions (F3c).
- Messages sent outside HighLevel (a CSM's own WhatsApp) and anything before
  2026-09-20 (F3a).
- Client devices for termination, pause, NPS and CSAT (no real responses).
- Whether the four clients who churned in 90 days were sent the survey (F4).
- The NPS form: the REST API returns four fields, including the untitled
  scale `2cce0e77…`. The Typeform MCP `get_form` returns three. Likely an
  unpublished draft; not checked.

Sources for this section: ClickUp MCP (`get_custom_fields`, `get_task`,
`search`, `list_document_pages`, `get_document_pages`); ClickUp REST on the VPS
(`/list/901816559981/field`, `/list/901816559981/task`); Make REST GET
(`/scenarios`, `/scenarios/{id}`, `/blueprint`, `/hooks/{id}`); Typeform REST
on the VPS (`/forms/{id}`, `/responses`, `/webhooks`) and MCP `get_form`;
HighLevel REST on the VPS (`/forms/`, `/forms/submissions`, `/surveys/`,
`/surveys/submissions`, `/workflows/`); Supabase SELECT (`wa_messages`,
`wa_threads`, `portal_data.messages`, `cockpit_sales_messages`,
`cockpit_csm_call_forms`); Slack search; Google Drive read of the two exit
docs; GitHub API reads of `mahara-context` and `mahara-client-portal`.
