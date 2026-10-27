# Fathom and the 1-1 call notes form: map

Read only, 2026-10-25. Worktree `forms-1025` at `d2c9817c`. The form is Typeform
`fRokTITH`, "Client 1-1 Call Notes Form". The goal: the CSM opens the form in
the cockpit and finds it nearly filled from Fathom.

Nothing was submitted, sent, posted or changed while making this map. Client
business names appear; client contact names, emails, phone numbers and
message bodies do not.

---

## 0. The answer in eight lines

1. **A Typeform embed cannot be pre-filled.** Typeform fills hidden fields only,
   and URLs stop at about 2,048 characters. The required transcript averages
   15,000 characters (§3). The form has to be native in the cockpit, the way the
   Brand Blueprint went native.
2. **No new Fathom key is needed for the CSM.** The key on the VPS belongs to the
   CEO. It is an `account_admin` key with `all_teams` view access, and every
   recording the CSM made is shared with `all_teams` (§4).
3. **The real gap is matching, not access.** In the last 30 days the CSM recorded
   27 calls that Fathom marks `one_or_more_external`. The worker kept 8 and
   dropped 19 as "internal". 17 of the 19 are "Impromptu Zoom/Google Meet"
   rooms, and the worker deleted their summaries (§5.2).
4. **Fathom already has what the form asks for:** the full transcript, a
   four-part summary, and action items with an owner and a timestamp link. The
   worker never asks for the action items (§5.3).
5. **Pick the call for the CSM.** First choice: the CSM's recording that overlaps
   this client's booked GoHighLevel call (±60 min). If none, the newest recording
   of the CSM's that no client has claimed. Last, a pasted share link. One tap to
   change it (§9.3).
6. **Get the call three ways.** The 15-minute poll already runs. Add a pull when
   the form opens, so the call shows up minutes after it ends. Then add a signed
   Fathom webhook (§9.2).
7. **AI drafts, the CSM decides.** deepseek-flash drafts the internal notes and
   the to-do list. The frontier model suggests DEFCON and priority with evidence,
   grades the call, and writes the Kuwaiti Arabic WhatsApp recap for the client.
   The CSM approves the recap before it goes (§9.4).
8. **Parity first.** Before Typeform is retired, a native submit must do
   everything Make 06 does today: the ClickUp comment, Happiness and Last POC,
   the call grade in #client-call-feedback, and the recap approval in
   #csm-general (§2, §9.5).

---

## 1. The form today

`GET /forms/fRokTITH` (Typeform MCP, skeleton and fields views). It has one
inline group, "Client 1-1 Call Notes" (`8f5d364f-…`), and one hidden field,
`task_id`.

| Question | Ref | Type, required | Read by |
|---|---|---|---|
| Client ID | `c484f390-9695-4ffa-9693-9cc219592713` | short text, **required** | Make 06 [16] ClickUp get task and [13] sheet lookup: `ifempty(hidden.onboarding_client_id; Client ID)`. The form has no `onboarding_client_id`, so Make uses the typed ID. The cockpit's `#task_id=` link (`apps/client-success-cockpit/src/lib/onboardingCore.ts:105-108`) feeds only the cockpit's own match (`hermes/csm-calls/match.ts:296-339`). |
| Clients Call Transcript | `0773087f-beda-4e2c-bf50-acdac0dcbe05` | long text, **required** | Make 06 [3] to-do, [4] grade, [22] client recap. |
| Additional Notes | `82a6b434-15d9-4a14-8496-c20c94628536` | long text | Make 06 [3] and [22]. The cockpit uses it for commitments (`hermes/cockpit-sync/csmProviders.ts:34`). |
| Client Notes | `5d071906-da6a-4413-a729-0c76d0188d91` | long text | Not read by Make 06. Read by the cockpit for commitments (`csmProviders.ts:34`, `csmCadence.ts:71`). |
| Defcon Status | `ff7970f7-9fad-4fa5-b12b-4d719dfb7587` | single choice, **required**: Paused, At Risk, Neutral, Happy, Very Happy (testimonial), Churned | Make 06 [21] ClickUp Happiness field `4e3924e3-4898-4e98-aca1-cc1ac3015b73`. Cockpit DEFCON (`csmCadence.ts:72`, `apps/client-success-cockpit/src/lib/clientBrief.ts:1638-1649`). |
| Task Priority | `c9f99fb1-fec9-47e7-9baa-c5554733723d` | single choice, **required**: 911, High, Medium, Low | Not read by Make 06. Cockpit `callPriority` only (`csmCadence.ts:73,495`). |

The thank-you screen promises that "the client will receive their summary
shortly" and tells the CSM to book the next check-in 7 to 30 days out.

Typeform settings (`GET /forms/fRokTITH`, VPS): `is_public` true,
`autosave_progress` **true**, `partial_responses_to_all_integrations` true, last
updated 2026-10-13. One webhook, tag `WHTP4114295`, enabled, sent to Make, event
`form_response`, no secret, created 2026-05-10 (`GET /forms/fRokTITH/webhooks`).

> Autosave is the same trap the kickoff had: one client's half-written notes can
> come back in the next client's form. It was switched off on the kickoff on
> 2026-10-23 (memory: forms-in-cockpits-queue). On fRokTITH it is still on.

---

## 2. What a submit sets off

Make 06 "Post Call Summary - Tasks, Notes, Client Summary" (`9209179`). It is
active, starts immediately on hook `4114295`, and was last edited 2026-09-06
(`GET /scenarios/9209179`, `/blueprint`). The kickoff `tG7dnxBn` and the old
Blueprint `oYZKtogO` share the same hook.

| Step | Module | What it does |
|---|---|---|
| Trigger | [2] `typeform:WatchEventsWithResponses` | Any response on the hook. |
| Find the card | [16] `clickup:getATask` | Task = `ifempty(hidden.onboarding_client_id; Client ID)`. |
| Find the sheet row | [13] `google-sheets:filterRows` | Sheet "Client Data" (`1_0Nv-…`), where column C = the same ID. |
| **Route 0**, filter `form_id = fRokTITH` | | |
| | [3] GPT-4.1 "Internal To-Do List" | From the transcript and Additional Notes. |
| | [17] `clickup:postATaskComment` | Posts [3] on the card. `notify_all` false. |
| | [4] GPT-4.1 "Sales Call Grade" | From the transcript only. Scores rapport, knowledge, flow, urgency and so on. |
| | [21] `clickup:editATask` | Happiness `4e3924e3-…` = the Defcon answer mapped to an option. **Last POC** `e183f2ce-8b7a-491a-b160-2287a247758b` = `submitted_at`. |
| | [15] `slack:CreateMessage` | Posts [4] to `C09SVG6FHGU`, which is **#client-call-feedback** (`slack_read_channel`). |
| **Route 1**, filter "not a mid-call partial" | | |
| | [22] GPT-4.1 "Client WhatsApp Summary" | From the transcript, Additional Notes and the form title. |
| | [23] Data store `171744` | Keyed by the response token: to, body, status, client name, task ID. |
| | [24] `slack:CreateMessage` | **#csm-general** `C09RZ0GS0V9`: "Client summary pending approval — {client}", then the draft, a line in Arabic ("if you haven't booked the follow-up call yet, book it here") with the check-in booking link, then Approve and Deny links. |
| Approve | Make 07 "Send Approved Client Summary" (`9523861`) | Loads the record, waits 30 to 120 s, sends it by WHAPI, and marks it sent or denied. |

Runs (`GET /scenarios/9209179/logs`, the last 50): the check-in path costs 11
operations. There were **11 such runs in October** (Oct 1, 2, 4, 8, 11, 12,
13 ×2, 14, 17 and 21). The 6-operation runs are kickoffs.

---

## 3. How the CSM fills it today

From `cockpit_csm_call_forms`, which holds every answer (written by
`hermes/csm-calls`), with SQL on `form_id='fRokTITH'`:

| Fact | Value |
|---|---|
| Completed responses | 34 (23 May to 21 Oct 2026). Typeform agrees: 34 completed, plus 9 not completed. |
| Last 30 days | 10 forms. Over the same days the CSM recorded 27 calls that Fathom marks as client-facing (§5.2). |
| How the client is matched | 30 by the typed Client ID, **1** by the cockpit link's hidden `task_id`, 3 not matched. |
| The transcript answer | Averages **14,995 characters**. 30 of 34 contain Arabic, and 27 of 34 carry a `fathom.video/share/` link. The CSM copies Fathom's transcript and pastes it. |
| Additional Notes / Client Notes | Filled 13 and 9 times, averaging 199 and 173 characters. |
| When it is sent | For the CSM's own calls, 21 to 262 minutes after the call ends (join of the form's share link to `cockpit_fathom_meetings.share_url`). |

The form takes three pastes (ID, transcript, notes) and two judgments (DEFCON,
priority). Fathom can supply the transcript, and drafts of both notes boxes.

---

## 4. Our Fathom account

Read with the VPS key (`GET /teams`, `/team_members`, `/users`,
`/meeting_types`) and the Fathom MCP (`get_identity`, `list_teams`,
`list_meetings`).

| Fact | Value |
|---|---|
| The key | `FATHOM_API_KEY` on the VPS. It is the CEO's: the only `account_admin`, with `view_access: all_teams`. `hermes/sales-desk/desk/fathom.py:4-7` says the same. Every worker uses this one key (`hermes/csm-calls/lib.ts:15,176`, `hermes/cockpit-sync/transport.ts:9,207`, the sales and editor desks). |
| Teams | Customer Success, Engineering, Executive, Operations, Other, Product, Sales. |
| Customer Success team | The CSM, the creative director, and a former CSM (deactivated). Members can view their own team only. |
| Active users | 4: the CEO, the CSM, the creative director, the closer. Six are deactivated. |
| Meeting types | None defined (`GET /meeting_types` returns `[]`). Every stored `meeting_type` is null. |
| Sharing | All 48 of the CSM's stored recordings are `shared_with: all_teams` (SQL on `raw->>'shared_with'`). Of the CEO's, 190 are `no_teams` and 51 are `all_teams`. The CEO's key sees both: its own and everything shared. |
| CSM recordings | The first is 2026-10-06. Since then: 48 stored, about 20 a week. |
| Summary template | All are "Enhanced": four sections, **Meeting Purpose, Key Takeaways, Topics, Next Steps** (or their Arabic equivalents). Each bullet links to a timestamp. 116 are in Arabic and 73 in English. They average about 6,000 characters. |
| Transcript language | 314 `ar`, 118 `en`, 18 unknown, across 450 meetings. |
| Action items | Present on the CSM's calls: 2 to 25 per meeting, most with "assigned to" and a timestamp link (MCP `list_meetings`, team Customer Success, since 25 Sep, `include_action_items`: 43 meetings). |
| When content is ready | A meeting's `created_at` falls 12 s (median) after the recording ends. On calls the CEO hosted in September, the CSM sent the form 1 to 7 minutes after the call, with the transcript already in hand. |
| Who records what | Two calls checked by reading their summaries (not copied here), `192935730` and `194756343`: both are client calls held in "Impromptu" rooms. One is a start-of-service call. The other is a check-in about raising the Meta budget. |

---

## 5. What the cockpit already stores

### 5.1 The pipe

`hermes/csm-calls` runs every 15 minutes, plus a daily reconcile at 03:00 UTC
(`hermes/csm-calls/RUNBOOK.md:11-12`).

| Store | Holds | Source |
|---|---|---|
| `cockpit_fathom_meetings` | Every meeting the key returns, raw. The summary is kept only when the meeting "is external". 450 rows since 1 Jul, 200 external, 189 summaries, 35 transcripts. | `20261011c_csm_call_store.sql:72-90`, SQL |
| `cockpit_csm_calls` (`source='fathom'`) | A client call, matched to a card. 35 rows, 27 matched, all 35 with a summary and a transcript. | SQL |
| `cockpit_csm_calls` (`source='ghl_appointment'`) | Booked calls on the four GoHighLevel calendars. 52 rows, 49 matched by the contact's Client ID field. 38 have a join link. | SQL; `csm-ghl-calls` note |
| `cockpit_csm_call_forms` | Every response of the 1-1 form, kickoff, onboarding and Blueprint forms. | `20261011c…sql:51-67` |
| Bucket `csm-call-transcripts` | `fathom/<recording_id>.txt`, for client calls only, at most 8 a run. | `sources.ts:544-558`, `20261011c…sql:176` |
| Reads | `cockpit_csm_client_timeline`, `cockpit_csm_unmatched_list`, `cockpit_csm_manual_match` (with an audit row), `cockpit_csm_log_manual_call`. | `apps/client-success-cockpit/src/lib/csmCalls.ts:154-312` |
| Screen | The client page's calls list shows the Fathom summary, transcript and 1-1 notes (`ClientCalls.tsx:139-229`). The kickoff form's side panel already shows today's recording link: "Fathom, today 13:10" (`src/forms/formRail.ts:133-145,474-487`). | code |

Health on 2026-10-25 (`cockpit_sync_state`): `csm-fathom` ok, "37 Fathom
meetings read since 2026-10-18 … 2 with a client-side invitee outside sales, 1
matched … 0 transcripts stored".

### 5.2 Gap 1: the CSM's impromptu client calls are thrown away

- The worker calls a meeting external only when one of its **calendar invitees**
  is external (`hermes/csm-calls/sources.ts:435`). Anything else counts as
  internal. It keeps no summary for such a meeting (`:457-458`) and makes no
  call row (`:461-464`). So the meeting never reaches the unmatched queue
  either, and the CSM cannot attach it.
- An "Impromptu" room has one calendar invitee, the CSM. Fathom still marks it
  `calendar_invitees_domains_type = one_or_more_external`.

The CSM's meetings in the last 30 days, by Fathom's flag and the worker's
(SQL, grouped by `raw->>'calendar_invitees_domains_type'` and `external`):

| Fathom says | Worker kept | Meetings | Of them impromptu | Summaries kept |
|---|---|---|---|---|
| one_or_more_external | yes | 8 | 0 | 8 |
| one_or_more_external | **no** | **19** | **17** | **0** |
| only_internal | no | 21 | 0 | 0 (team meetings: CSM Daily, Whole Team, Slow Client Call…) |

The evidence that the 19 are client calls:

- **11 of the 19** start within an hour of a booked GoHighLevel call for a
  client: City Wood (twice), Safad Consultant Engineering (twice), Makers
  (twice), Smmim studio, Arcturus Construction, Ardon, Shades Interior Design
  (cancelled), and Munshaat Khalda (cancelled). That is a time join on
  `cockpit_csm_calls`.
- **6 of the 19** 1-1 forms whose Fathom link is in the store point at a meeting
  the worker dropped. That is a join on the share link.
- The #client-call-feedback grade posted on 2026-10-21 is for recording
  `194756343`, a dropped impromptu Google Meet.

The RUNBOOK says that when Fathom coverage is low, "recordings belong to the
recorder" (`RUNBOOK.md`, Alerts). That is not today's cause. The cause is the
invitee rule.

### 5.3 Other gaps

| Gap | Where | Effect |
|---|---|---|
| Action items are never asked for | `sources.ts:405` sends `include_summary` only. `raw.action_items` is null on all 450 rows (SQL). | Fathom's ready-made to-do list, with owners, is lost. |
| A transcript costs a window query | `sources.ts:549` re-lists `/meetings` ±1 s around `created_at` with `include_transcript`. The transport allows `/external/v1/meetings` only (`lib.ts:70`). | Each one is a heavy request. `/recordings/{id}/transcript` is the direct read. |
| Matching a booking needs an invitee email | `match.ts:196-202`: within 30 min **and** a shared invitee email. | An impromptu room never matches its booking. A same-room join works: all 8 kept CSM calls have `meeting_url` equal to the booking's `join_url` (SQL). |
| Recording to cockpit is slow | `first_seen_at − recording_end_time` over 14 days: median 9 min, p90 126 min. | Too slow for "fill it the moment the call ends" without a pull on open or a webhook. |
| The cockpit link's hidden id goes unused | Only 1 of 34 forms came through it (§3). Make reads the typed ID only. | The CSM still types the card ID. |

---

## 6. The Fathom API, as it is documented

Sources: `developers.fathom.ai` (api-overview, faq, webhooks, the
list-meetings and create-a-webhook references), and `openapi.yaml` (downloaded
2026-10-25, 46 KB).

| Topic | Fact |
|---|---|
| Base and auth | `https://api.fathom.ai/external/v1`. The header is `X-Api-Key` (the spec also lists Bearer). Keys are made in User Settings → API Access. |
| Key scope | **Keys are per user. There are no org keys.** A key sees "Meetings you recorded and meetings shared with you or your team" and never another user's private, unshared meetings. Admin rights do not widen that. Org-wide reach comes only from an admin with "view access to all shared calls", which our CEO has. A private call can be read only with its host's key (faq). |
| OAuth | For apps other Fathom customers install. `include_summary` and `include_transcript` do not work on `/meetings` for OAuth apps (they use `/recordings` instead). We do not need OAuth. |
| `GET /meetings` filters | `created_after`, `created_before`, `cursor`, `recorded_by[]`, `teams[]`, `calendar_invitees_domains[]`, `calendar_invitees_domains_type` (`all`, `only_internal`, `one_or_more_external`), `meeting_type`, and `include_transcript`, `include_summary`, `include_action_items`, `include_highlights`, `include_crm_matches`. |
| Meeting fields | `recording_id`, `title`, `meeting_title`, `url`, `share_url`, `meeting_url` (the Zoom or Meet link), the scheduled and recording start and end times, `calendar_invitees[]` (name, email, `email_domain`, `is_external`, `matched_speaker_display_name`), `recorded_by` (name, email, team), `shared_with`, `transcript_language`, `transcript[]` (speaker `display_name` and `matched_calendar_invitee_email`, text, timestamp), `default_summary` (`template_name`, `markdown_formatted`), `action_items[]` (description, `user_generated`, `completed`, `recording_timestamp`, `recording_playback_url`, assignee name, email and team), `highlights[]`, `crm_matches`. |
| Per recording | `GET /recordings/{id}/summary` and `GET /recordings/{id}/transcript`. Each returns directly, or POSTs to a `destination_url` later. `POST /recordings/{id}/download` starts a file download. |
| Admin read | `GET /users` (account admin only) gives each user's settings and view access. |
| Rate limits | **60 calls per 60 s** per key. Heavy requests (any `include_summary` or `include_transcript`, and `/recordings`) get **30 per 60 s**, and that can drop to 5. Downloads get 30 per 60 s. The response headers are `RateLimit-Limit`, `-Remaining` and `-Reset`; a 429 carries `Retry-After`. Limits are per key. Fathom raises them only on a case-by-case request (faq). |
| Webhooks | `POST /webhooks` with `destination_url`, `triggered_for[]` (`my_recordings`, `shared_external_recordings`, `my_shared_with_team_recordings`, `shared_team_recordings`), and at least one `include_transcript`, `include_summary`, `include_action_items` or `include_crm_matches`. The reply carries a `whsec_…` secret. `DELETE /webhooks/{id}`. There is no list call: webhooks show in Settings. A private call fires only under `my_recordings`. It fires "when a recording finalizes", with no promised delay. |
| Webhook body | A full `Meeting` object (spec `webhooks.newMeeting`). |
| Signature | Headers `webhook-id`, `webhook-timestamp`, `webhook-signature` (`v1,<base64>`, several separated by spaces). The signed content is `id.timestamp.rawBody`, HMAC-SHA256, keyed with the base64-decoded secret after `whsec_`. Compare in constant time and reject timestamps more than 5 minutes off. A resend keeps the same `webhook-id`, so dedupe on it. |
| Live transcript | None. Content arrives after processing (faq). |

---

## 7. Matching a Fathom meeting to a client

Ranked strongest first, with what this data shows.

| # | Signal | How | Hit rate here |
|---|---|---|---|
| 1 | **Same room as the booking** | `meeting_url` (with query and hash stripped) = the GoHighLevel appointment's `join_url`. The appointment's contact carries the Client ID field `Csj6vsVH3wSRseT3OkMU`. | 8 of 8 of the CSM's calendared calls. 38 of 52 appointments have a join link. |
| 2 | Booking time plus invitee email | Today's `appointment_time` rule (`match.ts:196-210`). | Same 8 calls. Useless for an impromptu room. |
| 3 | **The CSM's recording near the client's booking** | No external invitee, `one_or_more_external`, recorded by a Customer Success member, starts within ±60 min of a booked call for one client. Shown as a suggestion; the CSM confirms. | 11 of the 19 dropped calls. |
| 4 | The form names the recording | A share link inside the 1-1 answers (`shareToTask`, `match.ts:212-214`). | 19 of 26 links resolve to a stored meeting. |
| 5 | Invitee email or company domain | GoHighLevel contacts carrying the Client ID (`match.ts:91-111,215-223`). Free-mail domains are skipped. | Only for calendared calls. |
| 6 | Name in the title | `byNameIn` on the title and invitee names (`match.ts:224-228`). Titles look like "<contact> - Check In". | Weak. 0.6 confidence. |
| 7 | The CSM picks it | One tap in the form (§9.3), written through `cockpit_csm_manual_match`, which keeps an audit row. | Covers the rest. |

The process fix behind #1: when the CSM joins from the booked call's own link
(the cockpit can show a Join button from `join_url`), Fathom gets the calendar
invite and the client's email, and the match becomes exact. Today the CSM often
opens an instant room instead.

Speaker names (`transcript[].speaker.display_name`) can be a further weak hint.
Fathom's CRM matches cover only HubSpot, Salesforce and similar CRMs linked in
Fathom. We have none linked (**Not verified**: `crm_matches` was never
requested).

---

## 8. What Fathom can fill, and what the CSM decides

| Form question | Fill from | How | The CSM's part |
|---|---|---|---|
| Client ID | The client page | The card id, always. Never typed. | None. |
| Clients Call Transcript | Fathom `transcript[]` | Flattened to `[hh:mm:ss] Speaker: text` (the same format as `sources.ts:392-397` and `sales-desk/desk/fathom.py flatten`), plus the share link. Stored in the bucket; the form holds a pointer, not a copy. | Check it is the right call. |
| Additional Notes | Fathom `action_items[]` plus the "Next Steps" section | Two lists, "We owe" and "They owe", each item with its owner and a timestamp link. | Edit and add. |
| Client Notes | "Key Takeaways" plus the transcript | An internal note: their mood, promises made, risks (cancellation, pause or budget talk, a testimonial offer). | Edit. |
| Defcon Status | Suggested only | A suggestion, with the quote and timestamp that support it. Last DEFCON and the trend come from `clientBrief.ts`. | **Picks it. Never auto-selected.** |
| Task Priority | Suggested only | From how urgent the action items are, plus the DEFCON. | **Picks it.** |
| (After submit) Internal to-do on the card | Fathom action items | Formatted. No model is needed. | |
| (After submit) Call grade | The transcript | Today's rubric from Make 06 [4]. | Read in #client-call-feedback. |
| (After submit) WhatsApp recap for the client | The summary, the notes, and the booking link | Kuwaiti Arabic. | **Edits and approves before it is sent.** |

---

## 9. Recommended integration

### 9.1 Keys

- Keep the CEO's admin key as the one key. It already sees every shared
  recording. Store it server-side only.
- Add a "Fathom" row to Connections, the paste box the CEO cockpit already uses
  for the Team hours keys (`supabase/functions/cockpit-hours-sync/keys.ts`,
  `cockpit_hours_keys`). It holds the key and the webhook's `whsec_` secret.
  Edge Functions read it through a service-only RPC. The VPS keeps its env copy
  until the two are merged.
- A per-CSM key is needed only if a CSM starts recording privately. Then the CSM
  pastes his own key in the same box, tagged with his email. The guardian should
  watch `shared_with` and say so plainly: "3 of today's calls are private in
  Fathom; share them with the team or paste your key."

### 9.2 Getting the call: three paths, one store

1. **The poll (exists).** Keep `csm-fathom` every 15 minutes as the safety net.
   Change it:
   - ask for `include_action_items`;
   - treat `calendar_invitees_domains_type = one_or_more_external` from a
     Customer Success recorder as a *candidate* client call: keep its summary,
     action items and transcript, privately, and put it in the unmatched queue
     with the booking-time suggestion from §7 #3;
   - read transcripts with `/recordings/{id}/transcript` (widen the `lib.ts:70`
     guard to that one path).
2. **A pull when the form opens (new, small).** The form's Edge Function sends
   one heavy request: `GET /meetings?recorded_by[]=<CSM>&created_after=<now-12h>&include_summary&include_action_items`.
   It goes through a `tools.ts` helper so it lands in the health ledger. Cache it
   60 s. This makes a call that ended minutes ago appear without waiting for
   cron. The limit is 30 per minute, far above need.
3. **A webhook (next).** An Edge Function, `fathom-webhook`, verifies
   `webhook-signature` (constant time, ±5 min, dedupe on `webhook-id`), upserts
   `cockpit_fathom_meetings`, runs the same matcher, and keeps summaries only for
   candidate client calls. Register it on the CEO's key with `triggered_for`
   `my_recordings`, `my_shared_with_team_recordings`, `shared_team_recordings`,
   and include transcript, summary and action items. This is a Fathom write, so
   it is done at build time. The ecom webhook is the pattern for signature
   checks (`supabase/functions/ecom-payments-sync/index.ts:142-178`).

Privacy rule, as today: the closer's sales calls (`cockpit_sales_recordings`),
hiring and team meetings keep metadata only, never a summary or transcript in
the CSM store.

### 9.3 How the CSM picks the call

On the client page, "Write 1-1 notes" opens the native form in the shared form
panel (`src/forms`, `FormKey "checkin"` already exists in `formConfig.ts:16`). At
the top is "This call":

1. Chosen for him: his recording that overlaps this client's booked call (±60
   min, signals 1 or 3), else this client's newest matched recording with no
   notes yet.
2. A short list beneath it: "Your other recordings since yesterday" (title,
   time, length, "near Makers' Blueprint call at 10:30"). One tap re-points it
   and writes `cockpit_csm_manual_match`.
3. "Paste a Fathom link": resolved through `share_url`.
4. Nothing yet: "Fathom hasn't sent this call yet. It usually takes a few minutes
   after the call ends. Check again." The form can still be filled by hand.

The panel also shows the last 1-1 (its DEFCON and promises), the open promises
from the client brief, and the next booked call.

### 9.4 What AI drafts, and on which model

These follow the DeepSeek routing rule (memory: deepseek-routing).

| Draft | Model | Why |
|---|---|---|
| Additional Notes ("we owe / they owe") and Client Notes | `deepseek-flash` | Internal extraction from Fathom's own lists, and easy to check. Read `message.content`, `max_tokens` ≥ 200. |
| Internal to-do comment | None (format Fathom's action items) | Fathom already did the work. |
| DEFCON and priority suggestion, with evidence | Frontier | Judgment. |
| Call grade for #client-call-feedback | Frontier (GPT-4.1 today) | Coaching judgment about a team member. |
| **WhatsApp recap for the client, in Kuwaiti Arabic** | **Frontier, under `aziz-kuwaiti-voice`** | Client-facing Arabic, where a cheap model once leaked Korean syllables. Rules: **no leads, CPL or booking cost numbers** (memory: client-messages-no-leads; the Fathom summaries quote cost per booking), **no results guarantee** (memory: guarantee-rule), the client's own words for changes. |

The summaries are in MSA Arabic or English, not in the client's dialect. Never
send them to a client as they are.

### 9.5 What is saved where, and what a submit does

- A new table, `cockpit_csm_checkin_notes` (name to settle). Row security is on
  and the service role is the only door, with the grant in the same migration.
  It holds: the card (`task_id`), the call (`cockpit_csm_calls.id`, Fathom
  `recording_id`), the author, DEFCON, priority, both notes boxes, a pointer to
  the transcript, each draft with its model and prompt version and what the CSM
  changed, the time sent, and one status per side effect.
- The client timeline RPC reads it beside `cockpit_csm_call_forms`, so the
  client brief and cadence keep working (`csmProviders.ts`, `csmCadence.ts`,
  `clientBrief.ts` read DEFCON, priority and commitments).
- Every write gets an audit row.
- On submit, a server-side outbox, with each step gated on the CSM's role for
  this client, doing exactly what Make 06 does today (§2):
  1. ClickUp comment with the to-do list on the card (`notify_all` false);
  2. Happiness `4e3924e3-…` from DEFCON and Last POC `e183f2ce-…` = now;
  3. the grade to #client-call-feedback `C09SVG6FHGU`;
  4. the recap approval to #csm-general `C09RZ0GS0V9`.
- The CSM can approve the recap in the cockpit itself. Sending it reuses Make
  07's rules (30 to 120 s delay, WHAPI to the client's group from the Client
  Data sheet) or the cockpit's WhatsApp path. That is a decision for the
  orchestrator; it is not settled here.
- The Typeform stays live until the native path has matched it for a week.
  Then retire it, and its Make 06 Route 0, together. A switch-over day with both
  paths live would double every comment, grade and recap.

### 9.6 Build order

1. Worker: candidate impromptu calls, `include_action_items`, and the
   booking-time suggestion in the unmatched queue. Read only; nothing reaches a
   client.
2. Turn autosave off on fRokTITH (a form write, so the CEO's call; the kickoff
   precedent says yes).
3. The native form with pick-the-call and the drafts, behind a switch, saving
   only.
4. Side effects 1 to 3 (ClickUp and Slack) from the outbox, then the recap
   approval.
5. The Fathom webhook and the Connections paste box.
6. Retire the Typeform and Make 06 Route 0 for fRokTITH.

---

## 10. Not verified

- **Whether fRokTITH partials ever reached Make 06.** The form sends partials to
  integrations, and Route 0 filters on `form_id` only, not the event type. The
  form has 9 incomplete responses, and there were 7 four-operation error runs on
  2026-09-30. The logs did not show the payload type.
- **Webhook retry policy and delivery delay.** Fathom does not publish either.
- **Whether the creative director records Blueprint calls privately.** That
  person is in the Customer Success team with no stored recordings. A private
  call would be invisible to the CEO's key.
- **`crm_matches`.** It was never requested, and no CRM is linked in Fathom as
  far as the data shows.
- **Whether the Fathom key is also an Edge Function secret.** It is not read by
  any function in `supabase/functions`. The secrets were not listed.
- **How long a summary takes after `created_at`.** It was not timed directly.
  The forms the CSM sent within 1 to 7 minutes of a call suggest minutes.
- **The 19 dropped calls.** Two were read and both are client calls. The other
  17 are judged client calls from their timing next to bookings and from form
  links, not from their content.

---

## 11. Sources

- Typeform MCP `forms-public_get_form fRokTITH` (skeleton and fields). VPS
  `GET api.typeform.com/forms/fRokTITH`, `/webhooks`, `/responses?completed=`.
- Make API (GET) `/scenarios/9209179`, `/blueprint`, `/logs`;
  `/scenarios/9523861`, `/blueprint`.
- Fathom MCP `get_identity`, `list_teams`, `list_meetings` (team Customer
  Success, since 2026-09-25, with action items), `get_meeting_summary 192935730`
  and `194756343` (read, not copied). VPS `GET /teams`, `/team_members`,
  `/users`, `/meeting_types`.
- Slack `slack_read_channel C09SVG6FHGU` (the 3 latest messages).
- SQL with `sq.py` on `cockpit_fathom_meetings`, `cockpit_csm_calls`,
  `cockpit_csm_call_forms`, `cockpit_sync_state`, `cockpit_people`.
- Code: `hermes/csm-calls/{sources,match,lib}.ts`, `RUNBOOK.md`,
  `supabase/migrations/20261011c_csm_call_store.sql`,
  `hermes/cockpit-sync/{csmProviders,csmCadence,transport}.ts`,
  `apps/client-success-cockpit/src/{lib/onboardingCore.ts,lib/csmCalls.ts,components/ClientCalls.tsx,forms/formConfig.ts,forms/formRail.ts,lib/clientBrief.ts}`,
  `hermes/sales-desk/desk/fathom.py`,
  `supabase/functions/cockpit-hours-sync/keys.ts`,
  `supabase/functions/ecom-payments-sync/index.ts`.
- Fathom docs: developers.fathom.ai `llms.txt`, `api-overview.md`, `faq.md`,
  `webhooks.md`, `api-reference/meetings/list-meetings.md`,
  `api-reference/webhooks/create-a-webhook.md`, `api-reference/openapi.yaml`.
- Typeform prefill limits: help.typeform.com "Can I pre-populate forms?", and
  typeform.com/developers/create/url-parameters.
