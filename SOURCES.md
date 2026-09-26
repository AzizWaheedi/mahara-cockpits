# Sources of truth

What each cockpit shows, where it is read from, and what has to exist for one
client to fill every screen. Only the media buyer backend
(`apps/media-buyer-cockpit`) holds credentials; the other two receive
everything through `POST /bridge` on their own deployment.

Service account for every sheet, Drive folder and calendar:
`claude@studied-handler-508106-m5.iam.gserviceaccount.com`.

## The rule

| Kind of fact | Source of truth | Read by |
|---|---|---|
| Relationship state: stage, CSM, happiness, Last/Next POC, launch date, payment date, Service | ClickUp **Clients - Mahara** list `901816559981`, one task per client | `csmSync.ts`, `csmProfiles.ts`, `fanout.ts` |
| Integration ids and links: GHL location + token, WhatsApp group id, stat sheet, Drive folder, Meta ad account | Google Sheet **DATABASE - MAHARA** `1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0`, tab **Client Data**, one row per client, joined by **Clickup ID** | `clientData.ts` (header-based, any column order, rows to 500) |
| Ad spend, leads, clicks, currency | Sheet **Master Dashboard - Mahara** `1pBEyClUxPLc4-RdXR8gZ0MxsLkLLFkWJwkiVqVf2rro`, tab `data_fb`, rows 3+ | `sync.ts` |
| Ad spend, leads, clicks for an account the sheet does not carry | Straight from Meta (ad-level daily insights, last 30 days) for every visible account with spend that has no `data_fb` row, in the same row shape. The sheet's connector no longer has to be set up before a new account shows in the cockpits. | `sync.ts` `metaRowsForMissingAccounts` |
| Live campaign structure, previews, ad ids | Meta Marketing API, business `767701513092162`, system-user token | `sync.ts`, `fanout.ts`, `marketCollect.ts` |
| Campaign card, KPI columns the team reads in ClickUp | ClickUp **Ads Managment** list `901817774521`, card name = Meta campaign name, tag = client | `sync.ts`, `writeback.ts` |
| Bookings, shows, lost-lead reasons | GoHighLevel sub-account (location id + `pit-` token from Client Data) | `sync.ts`, `csmProfiles.ts` |
| Appointments, shows, quotes, closes per month | The client's own stat sheet (`Sheet Link` on the card, else Client Data). Since 2026-09-18 the show rate divides shows by the appointments that came due (date passed, Show column filled), never by every booking | `csmProfiles.ts`, `fanout.ts` |
| Outlier posts, trends, scraped pages and long-running ads for ideation | Supabase `ideation_posts`, `ideation_watchlist`, `ideation_requests`, `ideation_scans` in the Creative Triage project `bldgtotkfmhoxmlzowdx`, written by the ideation radar on the VPS (Apify for the Saturday scan, ScrapeCreators on demand) and by the boards' own actions | `hermes/ideation-radar`, `ideation.ts` (creative, media buyer) |
| The text of every finished script | The ClickUp creative board task's description, carried as `creativeTasks.script` on the creative cockpit | `fanout.ts` (`gatherCreative`), `scripts.ts` |
| Leads per client (month, last month, 7 days, since launch) | Meta, via the `data_fb` grain rolled up per client in `csmProfiles.adLeadsByClient`; the sheet's own count is kept as `sheetLeads` for comparison | `csmProfiles.ts` |
| Scripts and footage | The client's Drive folder (card `Drive Folder`/`Drive Link`, else Client Data `Google Drive Link`) | `fanout.ts` |
| Recorded calls | Fathom (`FATHOM_API_KEY`), plus backfills in `fathomCache` | `csmProfiles.ts` |
| What the latest client comments said (call summaries, kickoff handoffs, briefs, notes) | Comments on the client's ClickUp card, read every 15 minutes and digested by Hermes (`comment_digest`); stored in `clientComments` | `commentWatch.ts`, shown via `cockpit.ts`, `fanout.ts`, `csmProfiles.ts` |
| Client do's and don'ts (what to target, promise, say or avoid) | ClickUp **Clients - Mahara** card, field **Do's & Don'ts** `0f06a523-64f9-4f20-90a1-f76cb6f85318`: DO / DON'T / NOTES headings, one `- ` line each with its source. Removed from Ads Management on 2026-09-14; edit it only on the client card | `fanout.ts` (media buyer, creative), `csmProfiles.ts` (client success), `builder.ts` / `assist.ts` (ad copy prompts) |
| WhatsApp threads, calendars | Mahara's own GHL sub-account (`MAHARA_GHL_TOKEN`): its calendars and its WhatsApp conversations since `WHATSAPP_SINCE`; WHAPI / Google Calendar env only as fallbacks | `comms.ts` |
| Call notes, DEFCON, promises | Typeform `fRokTITH`, keyed on the ClickUp task id | `csmSync.ts` |

If the card and Client Data disagree, the card wins for relationship fields
and Client Data wins for ids and links. A value missing on the card is filled
from Client Data; a value missing on both becomes a row on the client success
**Data backlog** page.

## Client Data columns

Header names are what the code looks for; order does not matter.

| Header | Holds | Used for |
|---|---|---|
| `Status` | Launching / Active / … | launch watch, "already spending" check |
| `Client Name` | the client name as on the ClickUp card | name join |
| `Clickup ID` | the Clients - Mahara task id | exact join (the only one that never guesses) |
| `GHL ID` | sub-account location id | bookings, lost leads |
| `GHL API` | private integration token, must start `pit-`. Created inside the sub-account: Settings → Private Integrations (agency-level tokens cannot read a sub-account's pipelines or calendars) | same; a token without `pit-` is ignored |
| `WA GROUP ID` | `…@g.us` | WhatsApp thread to client |
| `Report Document ID` / `Sheet Link` | the stat sheet | performance when the card has no Sheet Link |
| `Google Drive Link` | the client folder | scripts/footage scan when the card has no Drive link |
| `Ad Account - Meta` | account name as in Business Manager, or the numeric id | account to client |
| `Service Mode` | `DFY` or `DWY` | whether bookings are chased |
| `Country`, `City`, `Service` | labels | playbook |

## ClickUp ids

Lists: Ads Managment `901817774521` · Marketing / ADs `901816723196` ·
Clients - Mahara `901816559981` · Client Success `901816723211` ·
Media/Creative `901818016338` · Video Pipeline `901816720767` ·
Content Calendar `901818697220` · Operations/Tech `901816723190` ·
Call Center `901816723206`. Team `90182518398`.

Clients - Mahara fields: Client Status `9368ca9e-3549-4320-84ff-9abd0a2901cb` ·
CSM `68ff84db-6c66-4e70-8e72-15d70828fda6` · Sheet Link
`e6da13ae-6498-44a1-b7dd-9c6198500aa9` · Launch Date
`2e744484-f581-4c37-962a-023c4de23729` · Last POC
`e183f2ce-8b7a-491a-b160-2287a247758b` · Last Call
`032203ad-e327-4d76-a0ce-c07496da6486` · Next POC
`c48c1323-ca6a-465f-84cb-8c24f0f62df3` · Client Happiness
`4e3924e3-4898-4e98-aca1-cc1ac3015b73` · Next Payment Date
`669ae046-bf82-4b59-80d5-bf25d6b57ef3` · Service
`fccfc09c-650e-4aed-b4cd-3f50beba05a3` · Drive Link
`19e39b91-dd2f-4027-ba88-31bc6aae07c3` · Drive Folder
`ce6129a5-c8e5-41ba-ac50-8650c7556469`. Creative fields are read by name:
`🧬 Brand DNA`, `📈 Offer Cheat Sheet`, `🧬 Brand Blueprint Form Link`,
`Drive Folder`, `Drive Link`, `Sheet Link`, `Client History Document`,
`Market Research doc`, `Client Status` (a card without it is dropped).

New-campaign form (creates the Ads Managment card):
`https://forms.clickup.com/90182518398/f/2kzmr1ky-3878/1BO7T0R9GQCL88NBHR`.

## What one client needs

1. ClickUp card on Clients - Mahara: name, Client Status, CSM, Service, Launch
   Date, Sheet Link (or leave it to Client Data), Drive Folder or Drive Link,
   the creative doc links.
2. Client Data row: Clickup ID, GHL ID, GHL API (`pit-`), WA GROUP ID, Sheet
   Link, Google Drive Link, Ad Account - Meta, Service Mode, Status.
3. Stat sheet shared with the service account, month tabs named like `Sep 26`
   or an `Appointments` tab, Y/N in Show, Quotation, Closed.
4. Drive folder shared with the service account, with a `scripts` subfolder and
   a `footage` (or `raw video`) subfolder.
5. Meta ad account shared with business `767701513092162`; campaign name equal
   to the Ads Managment card name; the card tagged with the client.
6. A GHL sub-account with a pipeline whose name contains `lost`.
7. Fathom calls whose title or invitees contain the client name.

## Client report docs

The CSM requests a report in the client success app. Every 3 minutes the
media buyer backend picks up requests, queues the narrative for Hermes as an
`aiJobs` row (`report_narrative`, answered through `/askai`), and once the
answer is in (or after 45 minutes without one, using the plain diagnosis)
writes a branded Google Doc from the stored profile: snapshot table, pipeline
health, appointment log, ad performance, lost reasons. The doc is created in
the client's Drive folder when the service account can write there, shared
with Aziz and the CSM, and the link is written back to the request.
`reportDocs.peek` prints a built doc from the command line.

## Schedules

Full sync every 10 minutes 06:00–22:00 Kuwait, hourly overnight; each run
feeds the other two cockpits and re-stores the media buyer's own roster.
Outbox drains every 5 minutes. Board KPI columns written hourly through the
working day. Tracking audit daily 05:30 Kuwait. Playbook mining Fridays.
Ideation radar (VPS, `hermes` user's cron): watchlist scan Saturdays 04:07 UTC
with the trend step and the Slack digest after it; pasted links and scrape
requests every two minutes.

## Smoke checks

Every 15 minutes the media buyer backend runs the queries behind each
cockpit's main screens (start of day, meetings and messages, data backlog,
creative dashboard) exactly as a browser would, minus the sign-in. The first
time one throws, Aziz gets a Slack DM with the app, the screen and the error;
the same error is not repeated for six hours. `smoke.check` on the media buyer
deployment, `smoke.run` in the other two. The creative check also covers the
Ideation board: a scan older than eight days, or a pasted link waiting over an
hour, sends the DM with the fix (RUNBOOK, "Ideation radar").

## Where it can still break quietly

- A campaign name that differs between Meta and the Ads Managment card loses
  its ad tree and previews.
- A card without the client tag on Ads Managment makes a relaunch create a
  second card.
- `Ad Account - Meta` holding a name that shares its first five characters
  with another account can cross-attribute; put the numeric id there instead.
- `data_fb` column Y (currency) blank reads as USD.
- Typeform notes with a wrong task id are dropped silently.
- Fathom matches only by title or invitee containing the client name.
- Google Sheets allows 60 reads a minute for the service account; reads retry on 429 and Client Data is memoized for two minutes, but adding many more sheets per run would need pacing.
- Gemini's daily quota: ideation captures and trend labels fall back to OpenAI, DeepSeek and Scribe and say so in the row's `method`; the board keeps working, the breakdowns read a little flatter.
- ScrapeCreators credits: a page scrape costs about five, an ad pull about three; `radar.py doctor` shows the balance and a request that finds no credits fails with the reason on the board.
- A script task with an empty description in ClickUp shows on Scripts we made with "no text on the task"; the text has to live in the ClickUp description to sync.


## Fallbacks

Aziz, 2026-09-13: "there should always be a fallback source for these types of things." Every feed and what happens when its first source fails:

| Feed | First source | Fallback |
| --- | --- | --- |
| Ad spend, leads, clicks | tracker sheet `data_fb` | Meta ad-level daily insights for any account the sheet lacks; the whole sheet unreadable means Meta for every account with spend |
| Client ids and links | Client Data tab | the last good copy of the tab (`docCache` "clientData"), then the ClickUp card |
| Ad account per client | matched campaign | Client Data "Ad Account - Meta", then a visible Meta account by name |
| Leads per client | Meta | the sheet's own lead count, kept as `sheetLeads` |
| Bookings | GHL calendars | the sheet's appointment rows |
| Recorded calls | Fathom API | the `fathomCache` backfill, 90 days |
| Client stage and group | ClickUp card | the last synced client row |
| Communication SOP | Google Doc | `docCache`, 24 hours |
| Ad previews | Meta preview | cached copy, refreshed after 18 hours |
| WhatsApp threads | GHL conversations | WHAPI channel when set |
| Slack alerts | Slack DM | `alerts` table, shown in Admin |
| Seats | `members` table | static list in `roles.ts` (first five people), and each cockpit's own `portalMembers` copy |
| Campaign snapshot | this sync | an empty or failed read keeps the previous snapshot; grain outside the 30-day window is kept for a year |
| Hermes | the agent on the VPS | jobs wait in the queue, reaped and retried; no second model by design |
| Ideation speech | ElevenLabs Scribe | Groq Whisper, then the video model's own hearing, then TikTok's auto captions |
| Ideation video understanding | Gemini 3.6 Flash on the video | sampled frames read by OpenAI plus a text breakdown by DeepSeek or OpenAI, named in `method` |
| Trend labels and embeddings | Gemini | OpenAI (vectors carry their provider so the two spaces never compare) |
| Ideation pictures | a three-frame storyboard from the clip | the platform thumbnail, with the failure noted on the row |
| Scrape requests | ScrapeCreators, run by the two-minute cron | retried up to three times, then failed with the reason shown under the Scrape box |

## Editor desk (added 2026-09-18)

| What | Where it comes from | Where it lands | Read by |
| --- | --- | --- | --- |
| Video jobs | ClickUp Video Pipeline `901816720767` | Supabase `editor_jobs` | video editor cockpit |
| The brand work behind a job | ClickUp Clients - Mahara `901816559981`, matched on the tag, plus the Brand DNA and Offer Cheat Sheet Google Docs | Supabase `editor_clients` | video editor cockpit |
| Footage, transcripts, shot maps, storyboards | Google Drive, ElevenLabs Scribe, ffmpeg | Supabase `editor_assets`, bucket `editor-stills` | video editor cockpit |
| What the cockpit asked the worker to do | the cockpit | Supabase `editor_requests` | `hermes/editor-desk` every 3 minutes |
| Who may open the cockpit | Aziz | Supabase `editor_people` | every `editor_*` row policy |

## Webinar correction checkpoint, 25 September 2026

See [the verified checkpoint](docs/WEBINAR-METRICS-2026-09-25.md). Date-only CRM values use the existing 20:00 Kuwait schedule consistently in `webinarSql.ts` and `pull.py`; explicit timestamps preserve their time. The launch checklist flags a conflicting live schedule. Round tags sort by calendar month/year. Acquisition visitors exclude live/pitch-only traffic and accept only the production domain and its production alias. Webinar retargeting leaves the call funnel's retargeting totals as well as daily figures; lead-gen cost denominators are preserved. Survey years/work distributions count matched responses for the selected round. `webinarMetrics.ts` projects 27 round-scoped metrics directly from the screen payload; unavailable values remain null. Repeat registrations are still latest-round attribution, not reconstructed historical occurrences. Readiness uses recent allowlisted provider evidence and does not prove delivery or a completed journey.
