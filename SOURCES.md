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
| Live campaign structure, previews, ad ids | Meta Marketing API, business `767701513092162`, system-user token | `sync.ts`, `fanout.ts`, `marketCollect.ts` |
| Campaign card, KPI columns the team reads in ClickUp | ClickUp **Ads Managment** list `901817774521`, card name = Meta campaign name, tag = client | `sync.ts`, `writeback.ts` |
| Bookings, shows, lost-lead reasons | GoHighLevel sub-account (location id + `pit-` token from Client Data) | `sync.ts`, `csmProfiles.ts` |
| Appointments, shows, quotes, closes per month | The client's own stat sheet (`Sheet Link` on the card, else Client Data) | `csmProfiles.ts`, `fanout.ts` |
| Scripts and footage | The client's Drive folder (card `Drive Folder`/`Drive Link`, else Client Data `Google Drive Link`) | `fanout.ts` |
| Recorded calls | Fathom (`FATHOM_API_KEY`), plus backfills in `fathomCache` | `csmProfiles.ts` |
| WhatsApp threads, calendars | WHAPI tokens and shared Google Calendars (`CSM_*`, `CREATIVE_*` env) | `comms.ts` |
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

Full sync every 15 minutes 06:00–22:00 Kuwait, hourly overnight; each run
feeds the other two cockpits and re-stores the media buyer's own roster.
Outbox drains every 5 minutes. Board KPI columns written hourly through the
working day. Tracking audit daily 05:30 Kuwait. Playbook mining Fridays.

## Smoke checks

Every 15 minutes the media buyer backend runs the queries behind each
cockpit's main screens (start of day, meetings and messages, data backlog,
creative dashboard) exactly as a browser would, minus the sign-in. The first
time one throws, Aziz gets a Slack DM with the app, the screen and the error;
the same error is not repeated for six hours. `smoke.check` on the media buyer
deployment, `smoke.run` in the other two.

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
