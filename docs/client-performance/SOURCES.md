# Client Performance board: sources of truth

Every column of the shared Client Performance board, where its number comes
from, what it is checked against, the exact rule, how fresh it is, what it
covers today, what is still wrong and who fixes it. At the end, the
second-source check of 16 October 2026, client by metric.

The CEO asked for this on 16 October 2026: "check the numbers and even make it
better and more accurate the data and tell me all sources of truth". Three
read-only checks compared the stored numbers with Meta, the dialer's own
report, the lead sync watch, each client's own tracking sheet (read live in
Google Sheets) and the ClickUp client roster. What they found is fixed in four
migrations, one Edge Function change and two worker changes (see "What
changed on 16 October"); what needs a person is listed under "What is left".

Roles, not names: the CEO, client success, the media buyer, the systems
manager, the call-centre lead, and the board team (the team building the
board's read functions and screen).

## How the numbers flow

| Source | Read by | Stored in |
| --- | --- | --- |
| Meta Marketing API (Graph v25.0, Mahara's business 767701513092162, the system-user token) | Edge Function `meta-ad-days`: hourly at minute 7, nightly at 03:20 Kuwait | `cockpit_meta_ad_days` (one row per ad per ad-account day), `cockpit_meta_reach` (reach over windows), `cockpit_meta_lead_ids` (lead ids and times only) |
| GoHighLevel contacts and appointments | `mahara-ghl-leads` (:35) and `mahara-ghl-appointments` (:20) | `client_leads`, `appointments`, `ghl_calendars` |
| The dialer (call-centre console and Maqsam) | its own syncs | `mahara_reporting` views (`call_center_events`, `cc_results`, `cc_attempts`, `sheet_snapshots`), `mahara_console` |
| Each client's tracking sheet | the dialer's sheet reader (about every 4 minutes) and the CSM copy (native feed, every 15 minutes) | `mahara_reporting.sheet_snapshots`, `cockpit_csm_sources` clientProfiles |
| The client portal (outcomes the client types) | portal sync | `portal_data.appointment_outcomes` |
| ClickUp client cards (the CSM roster) | native feed | `cockpit_csm_sources` table `clients` |
| All of the business sources above | `cockpit_board_facts_refresh` inside the database, at minutes 10 and 40 (3 days) and 03:50 Kuwait (120 days) | `cockpit_board_clients` (the client spine), `cockpit_client_days` (per client per Kuwait day), `cockpit_client_now` (the call centre now) |

## Rules every column follows

- **Missing is never zero.** NULL means no source could say (a failed read, a
  client who does not fill the field, a day after a sync's last read, a
  client the dialer does not serve). 0 means a source read the day and found
  nothing. The board must show NULL as "unknown" or a dash, never as 0, and
  never colour it against a target.
- **Two calendars.** Ad numbers use each ad account's own day (Meta counts
  them that way; Atlantis's account is on Los Angeles time, 10 hours behind
  Kuwait in October and 11 from November). CRM, booking, sheet and call numbers use Kuwait days.
- **Windows.** The five reach windows (last 7, 14 and 30 days, this month,
  last month) end today, the way the cockpits' reporting periods count them.
  `last_7_full` and `last_30_full` end yesterday, the last complete day. A
  board that shows full days must sum ad-days and CRM days over the same days
  as the reach row it shows.
- **Today is "so far".** Every source on a day carries `partial: true` while
  its last read is before the day ended. Show "so far, as of HH:MM Kuwait"
  and no rates or target colours on a partial day. The dialer's dials are
  read live by each refresh, so its `as_of` is the refresh's read, and the
  newest saved attempt is kept apart as `lastAttemptAt` (activity, not a
  read). The portal's outcomes carry no `partial`: their `as_of` is the
  client's latest report.
- **Ratios are ratios of sums** over the same rows, never averages of daily
  or per-account ratios.
- **A stale source never lowers a closed day**; a complete read may, and the
  refresh's audit row lists each drop.

## Column by column

### Client list and status

- **Source of truth:** the ClickUp client card's stage (the CSM roster,
  `cockpit_csm_sources` table `clients`), joined on the card's task id.
  Stored in `cockpit_board_clients.status`.
- **Checked against:** the client registry (`ghl_clients.status`, kept beside
  it in `registry_status`) and the churn log.
- **Rule:** Active is Active. Brand Blueprint Booked, LAUNCH BOOKED, Ready For
  Launch and Needs Contacting are Launching. Paused is Paused. Stopped is
  Stopped (no new days), except where the registry already says Cancelled,
  which is kept. A location with no card uses the registry's status.
- **Freshness:** the roster every 15 minutes; the spine on every facts
  refresh (minutes 10 and 40).
- **Coverage on 16 Oct:** 54 cards, 18 Active (17 in the registry: Shades was
  Launching there).
- **Gaps:** the registry disagreed with the card on 7 clients (Shades,
  Olivar Design, Uvan and Evan, شركة كيسان, Greystone; Kazak and Prime
  Project Solutions have no card). Fixed: the card wins and
  `cockpit_board_facts_doctor()->'spine'` lists `registryDisagrees` and
  `noCard`. Fixing the registry rows: client success.

### Service mode (done for you, done with you)

- **Source of truth:** the ClickUp card's service; the registry's
  `service_mode` where the card has none.
- **Rule:** DWY means the call centre does not call the client's leads: its
  dials, leads called and waiting figures are not applicable (stored NULL,
  shown as a dash).
- **Coverage:** 17 of 17 active agree (16 DFY, نهوض نجد DWY). Six non-active
  clients were blank in the registry and DFY on the card; fixed.

### Ad accounts tied to a client

- **Source of truth:** `cockpit_board_clients.ad_account_ids` and
  `ad_account_ties`, refreshed with the facts.
- **Rule:** a hand tie in `cockpit_board_account_ties` (cockpit-owned, each
  row with its evidence, added only in a migration) first; then
  `clients.ghl_location_id`, `ghl_client_ad_accounts`, and the client name
  (the board card's name, then the account's name) matched to one registry
  client that is not cancelled; last (since 16 Oct) the registry's own ad
  account field `ghl_clients.meta_ad_account`: a known account id written in
  it, or a name equal to exactly one Meta account's name. Accounts hidden on
  purpose (a hidden clients row) and Mahara's own two accounts are left out,
  unless tied by hand. A hand row marked `kept_out` names an account that is
  the client's but stays out of its figures: no rule ties it, and
  `meta-ad-days` lists it as "Hidden on purpose", not "Not linked".
- **The registry field, checked on live data:** it gives 19 ties; 18 agree
  with the tie already made, and the 19th is Shades, which no other step
  reached.
- **Checked against:** Meta, each account's owning business and promoted Page
  (GET only); the CRM, `client_leads.ad_id` at each location joined to
  `cockpit_meta_ad_days.ad_id` (no ad id of one client was found at
  another).
- **Coverage after the hand ties:** every spending active client has its
  accounts tied except Professional Touch, whose account is not shared with
  Mahara's business.
- **Hand ties added on 16 Oct** (`20261016210200_board_account_ties.sql`):
  Shades 762687672022667 (account and campaign names, registry account name);
  Ardon 718146936708597 (was tied by the card name only); Pidco
  134992869555229 and AEA Designs 854779610674376, both cancelled, for the
  history.
- **Kept out on purpose:** Alkhalil's SAR account 640644143620696. It sits in
  the client's own Meta business, but all 13 of its campaigns are the
  client's Instagram post boosts (2021 to the one since 12 Oct), none
  Mahara's; Mahara's Alkhalil work runs on 1649852845764859. Tied, it would
  have moved Alkhalil's 9 to 15 Oct spend from $94.30 to $174.06, impressions
  from 5,890 to 28,590, link CTR from 1.73% to 0.48% and CPM from $16.01 to
  $6.09. Its row is `kept_out`; set it to tied only if the media buyer
  confirms Mahara manages the account.
- **Left out on purpose (unsure):** Triple Edge 2002793296961811 (no
  GoHighLevel location), Art Vision 750052678056652 (no client record),
  ريبالو/ORB 827972432407411 (hidden; probably the Ocean Home owner's other
  brand). See "What is left".

### TikTok

- **Source of truth:** stored TikTok advertisers or accounts (`clients`,
  `ghl_clients.tiktok_ad_account`) and the card's Ads Platform.
- **Rule:** a flagged client's spend, CPL and ROAS are "Meta only": no TikTok
  spend is read anywhere.
- **Gaps:** Joe and Sera is flagged (a stored TikTok advertiser) while its card
  says Facebook/Meta; نهوض نجد's card says Tiktok and is now flagged. Client
  success confirms both.

### Spend (account currency and USD)

- **Source of truth:** `cockpit_meta_ad_days.spend` and `spend_usd`.
- **Checked against:** Meta account insights for the same account days
  (16 Oct: 27 accounts over 30 and 7 days, equal to the cent apart from one
  cent still settling on SAFAD and Shades; the 90-day backfill equal on 32
  accounts).
- **Rule:** spend as Meta reports it. `spend_usd = spend x` the cockpit's
  fixed rate: USD 1, KWD 3.26, AED 0.2723, SAR 0.2666, QAR 0.2747. A currency
  with no rate leaves `spend_usd` NULL, never 1 to 1. Never take spend from
  `cockpit_media_daily_stats` (it holds board-card campaigns only: 13% short
  over 30 days).
- **Freshness:** hourly (yesterday and today); the nightly run reads the last
  28 days again because Meta settles them.
- **Coverage:** every account shared with Mahara's business that spent;
  Mahara's own account left out.
- **Gaps:** SAR and QAR rates are rounded (0.03% and 0.01% low; about $0.50 in
  30 days). Fix if wanted: the pegs 0.266667 and 0.274725 in `tap.js`
  USD_PER, `calculator.ts` FX and both SQL rate functions together (the
  tests pin them): systems manager. Professional Touch's account cannot be
  read. TikTok is not read.

### Impressions

- **Source of truth:** `cockpit_meta_ad_days.impressions`, summed over
  ad-days. **Checked against:** Meta account insights (equal on all 27
  accounts). **Freshness:** hourly; the latest day settles for a day or two.

### Reach

- **Source of truth:** `cockpit_meta_reach`, read from Meta's own
  `time_ranges` per account (hourly), campaign, ad set and ad (nightly);
  a client's row is the sum of its accounts.
- **Checked against:** Meta account insights `reach` over the same range
  (equal for every account with no delivery today).
- **Rule:** never add daily reach. A client with two or more accounts is a
  sum, and the note says a person reached by both counts twice. The client's
  reach is NULL, with the account named, when an account failed its read,
  still holds an earlier day's windows, or delivered in the window and has not
  been read for it yet.
- **Freshness:** account and client rows hourly for the accounts that spent in
  the last two days; every account that delivered in any window nightly.
- **Gaps fixed on 16 Oct:** Marble and more's 30-day reach summed one account
  of two with no note; ARCWANI and Liwan had no client row at all. Both now
  read "unknown, waits for the nightly run" until the nightly run. Windows
  with the same days (last 7 days and this month on the 7th of a month) were
  refused or written as 0; now read once and written to both.

### Frequency

- **Source of truth:** impressions / reach of the same `cockpit_meta_reach`
  row. Never an average or the maximum of daily frequency
  (`cockpit_meta_ad_days.frequency` is per ad-day, for display only).
- **Checked against:** Meta's frequency for the same range (equal).
- **Gaps:** for a two-account client the reach is a sum, so frequency reads a
  little low.

### Link clicks, link CTR, CPC, CPM

- **Source of truth:** `cockpit_meta_ad_days.link_clicks` (Meta
  `inline_link_clicks`; the tap that opens an instant form counts),
  `impressions` and `spend_usd`.
- **Rule:** link CTR = sum(link_clicks) / sum(impressions), shown from 1,000
  impressions; CPC = sum(spend_usd) / sum(link_clicks); CPM = sum(spend_usd) /
  sum(impressions) x 1000.
- **Checked against:** Meta `inline_link_click_ctr`, `cost_per_inline_link_click`
  and `cpm` (times the fixed rate): equal to two decimals for every client.

### Leads (from lead campaigns)

- **Source of truth:** `cockpit_meta_ad_days.leads`.
- **Rule:** only on OUTCOME_LEADS and LEAD_GENERATION campaigns: Meta's lead
  action less its messaging leads. NULL on every other objective and on chat
  ad sets (destination WhatsApp, Messenger, Instagram Direct). Instant-form
  leads and website (pixel) leads both count; `destination_type` tells them
  apart (Atlantis: 38 instant form + 4 website over 30 days). Label it "Leads
  from lead campaigns", not "instant form".
- **Checked against:** Meta ad set insights by destination (equal on all 27
  accounts), and Meta's Leads API lead by lead (ids and times only) for 10
  clients.
- **Freshness:** hourly; nightly 28-day re-read (attribution settles).
- **Gaps:** Ardon's Page gives Mahara no lead access, so its leads cannot be
  matched lead by lead.

### Meta's lead action (all objectives)

- **Source of truth:** `cockpit_meta_ad_days.lead_actions`: Meta's "lead" on
  any objective, WhatsApp and Messenger leads and engagement-campaign leads
  included. Only for matching Ads Manager's account total; never the board's
  lead count (Khalida 48 against 10 form leads, ARCWANI 53 against 31, Pidco
  12 against 8).

### Cost per lead

- **Rule:** sum(spend_usd where leads is not NULL) / sum(leads): only the
  spend of rows that can have form leads, so engagement, sales and chat ad
  sets stay out (Pidco: $60.31 / 8 = $7.54, not $553 / 12). Target $15 (the
  KPI gate, imported from `kpi.ts`). "Not enough data" under $45 of spend.
- **Checked against:** Meta ad set spend and leads on lead-campaign ad sets.
- **Gaps:** for bulk-uploaded clients (Ardon, نهوض نجد) take leads from Meta,
  not the CRM, for cost per lead.

### Meta leads not in the CRM

- **Source of truth (new):** `cockpit_meta_lead_ids` (the nightly run reads
  each lead ad's lead ids and times, never a name, phone or answer) and
  `cockpit_meta_leads_not_in_crm(from, to)`.
- **Rule:** one lead to one contact, per ad, over the Kuwait days. Meta's
  leads and the ad's CRM contacts (not deleted) go in time order. First each
  lead takes the earliest free contact created within 10 minutes of it. Then
  each lead still alone takes the earliest free contact from 10 minutes before
  it to a day after it (a late sync). The leads of the two days before the
  window and of the day after it take part, so a contact of the next day's
  lead pairs with that lead and never covers a lead of the window that did not
  arrive. A client's "not in the CRM" is its window leads left without a
  contact.
- **Unknown, never 0:** the function returns metaLeads, inCrm and notInCrm
  NULL with a note when an account with form leads in the window has never
  been read, when the window starts before the lead ids held for an account
  (`cockpit_meta_lead_id_cover.covered_from`: 31 days before the first nightly
  read), or when Meta shows none of the client's lead ads (no lead access on
  the Page: Ardon). With some ads unread, or a window that runs past the last
  nightly read (today), the numbers stand with a note.
- **Kept:** each nightly run reads the last 31 days and adds to what is held,
  so the history grows from the first nightly run. Lead ids older than 180
  days are deleted.
- **Checked against:** the check's lead-by-lead match on 16 Oct: about 19
  form leads in 30 days never became contacts (Arcturus 5 of 83, Atlantis 3
  of 38, Liwan 3 of 19, SAFAD 3 of 49, Castello 2 of 69, City Wood 2 of 48,
  Khalida 1 of 10). On 16 Oct the rule was re-run on Arcturus's Meta lead
  ids and contact times. It gives 5 of 83 over 16 Sep to 15 Oct (2 on 7 Oct,
  2 on 8 Oct, 1 on 9 Oct) and 1 of 23 over 9 to 15 Oct, equal to the check.
  The first version counted contacts up to a day after the window and gave
  1 and 0.
- **Gaps:** website (pixel) leads are not in Meta's Leads API, so metaLeads
  can be under the ad-days leads (Atlantis 4). A bulk upload more than a day
  late counts as not in the CRM (Ardon, نهوض نجد). The guardian should flag a
  client above 0 for two days: systems manager.

### Landing page views and opt-in rate

- **Source of truth:** `cockpit_meta_ad_days.landing_page_views`; NULL when
  Meta lists none (instant forms have no landing page).
- **Rule:** website opt-in = leads / landing page views on website ad sets;
  the client row's opt-in = leads / link clicks (from 50 link clicks).
- **Checked against:** Meta account insights (equal: Khalida 146, Atlantis
  101, Liwan 51, Ideal Elite 31).

### Video: hook rate, plays, retention, ThruPlays, hold rate

- **Source of truth:** `cockpit_meta_ad_days.video_3s` (actions video_view),
  `video_plays` (every start), `video_p25` to `video_p100`, `thruplays`.
- **Rule:** hook rate = sum(video_3s) / sum(impressions) over video rows only;
  retention at each mark = sum(video_pXX) / sum(video_plays), never divided by
  3-second plays; hold rate = sum(thruplays) / sum(video_3s), and its target
  must use the same formula (the repo's 40-50% table is p50 / 3-second
  viewers). NULL on a row that is not a video; 0 on a video row with none.
- **Checked against:** Meta account insights video fields (equal on all
  accounts, 30 and 7 days).
- **Gaps:** no agreed hook or hold targets. Generic 20% lines would turn most
  clients red; set them from Mahara's own spread: the media buyer and the CEO.

### Ad account day and time zone

- **Source of truth:** `cockpit_meta_ad_days.day` and `account_timezone`.
- **Rule:** ad days are each account's own calendar. Atlantis (Los Angeles):
  its day runs 10:00 to 10:00 Kuwait time in October; the board says so on
  its row, and for 7 days or fewer compares ad-led ratios with CRM leads by
  the account's day.

### Ad account status (billing, disabled)

- **Source of truth (new on the board's status read):**
  `cockpit_meta_ad_days_status()` gives each account's Meta `account_status`
  (from the latest run that listed it in the last 3 days) with a word, its
  client's status, its last day with spend, and two lists:
  `cancelledDelivering` (spent in the last 2 days for a cancelled or stopped
  client) and `billingStopped` (tied to a live client, Meta status not
  active).
- **Checked against:** `mahara-ad-billing-watchdog` (every 5 minutes).
- **On 16 Oct:** ARCWANI (no delivery since 9 Oct), Liwan (since 12 Oct),
  Ocean Home, SAFAD and شركة العلا are unsettled (status 3); marblemore1 is
  disabled. The board should show "Billing unsettled: delivery stopped 9 Oct"
  beside the client: board team. Settling billing: client success.

### CRM leads

- **Source of truth:** `client_leads` (GoHighLevel contacts), stored as
  `cockpit_client_days.crm_leads`.
- **Rule:** not deleted, by the Kuwait day the contact was created, WhatsApp
  chats left out (tagged "inbound whatsapp" with no ad and no campaign,
  DECISIONS 2026-10-15). Instagram and Messenger DMs stay in (the call centre
  calls them; only the WhatsApp tag was taken out).
- **Checked against:** the dialer's report (equal for all 17 active clients
  once its WhatsApp chats are added back: Alkhalil 3, ARCWANI 16, SAFAD 3,
  Khalida 19) and the lead sync watch (equal 10 to 15 Oct).
- **Freshness:** lead sync hourly at :35; behind after 3 hours.
- **Gaps:** bulk uploads put the upload's day on the contact (Ardon 28 Sep and
  13 Oct, نهوض نجد 6 Oct); the day's note now names them.

### CRM ad leads and DM contacts

- **Source of truth:** `cockpit_client_days.crm_ad_leads` and
  `crm_dm_contacts`.
- **Rule (fixed 16 Oct):** an ad lead has an ad id, or a Facebook Ads source
  or ad click id in its attribution (`adSource`, `utmFbclid`, `fbc`). A Meta
  channel contact with none of them is a DM (`crm_dm_contacts`), never an ad
  lead. Before the fix the Meta channel alone counted (98 DMs at active
  clients in 30 days; Ocean Home 139 against Meta's 115).
- **Checked against:** Meta form leads for the client's accounts: after the
  fix Ocean Home 115 = 115, Alkhalil 57 = 57, City Wood 48 = 48, شركة العلا
  108 against 107.
- **Use:** the delivery check against Meta's leads, and "Meta leads not in the
  CRM" lead by lead. Cost per lead uses Meta's leads.
- **Open decision:** whether DMs should leave CRM leads like WhatsApp chats:
  the CEO with the systems manager.

### Confirmed bookings

- **Source of truth:** `appointments` (GoHighLevel sync at :20), stored as
  `confirmed_bookings`.
- **Rule:** main and online calendars, by the Kuwait day the booking was made,
  minus cancelled, invalid, Google Calendar copies, and (since 16 Oct) the
  call centre's RESCHEDULE and CALLBACK bookings, dropped by their ids (a
  meeting moved is not a new booking). No calendar is dropped by its name for
  this: Atlantis's "Project Review & Qualification Call" holds 2 CALLBACK
  bookings and a lead's own widget booking among its 5.
- **Checked against:** the dialer's report (board 170 against the dialer's 176
  over 30 days, every difference traced: the dialer keeps bookings cancelled
  later and 4 bookings GoHighLevel no longer holds) and the media sync's
  booking events. The media sync counted the call centre's CALLBACK bookings
  on Atlantis's qualification calendar; it now drops the call centre's
  RESCHEDULE and CALLBACK booking ids as the facts do, read from the dialer
  once a run (122 ids on 16 Oct; 2 of that calendar's 5 appointments), and
  counts as before when the dialer cannot be read. The other 3 on that
  calendar (a widget booking, a booking page booking, one with no source) stay
  in the media sync, while the board counts main and online calendars only.
- **Gaps:** the dialer's appointment facts never learn that GoHighLevel
  dropped a booking: systems manager (dialer).

### Provisional bookings

- **Source of truth:** `appointments`, the dialer's verified bookings and its
  GoHighLevel appointment facts, newest version, on a not-confirmed,
  provisional or tentative calendar (triage.js rule), by booking day, minus
  Google copies by id and by contact and start time.
- **Checked against:** the dialer's report (equal except its Google copies:
  Atlantis 16, mergestudio 6).
- **Gaps:** provisional meetings never reach meetings due (the appointments
  sync does not carry that calendar). No effect today.

### Meetings due

- **Source of truth:** `appointments`, main, online and provisional kinds,
  stored as `meetings_due`.
- **Rule:** by the Kuwait meeting day, time passed, not cancelled or invalid,
  not a Google copy, and (since 16 Oct) not a booking the contact replaced
  before its time with no mark anywhere and no row on the client's sheet
  (GoHighLevel leaves the old one confirmed). The day's note counts those.
- **Checked against:** the client's own sheet, read live in Google Sheets. After
  the fix Alkhalil 7 = 7 and Atlantis 10 = 10; Ardon 4 against 3 (its sheet
  starts in October), Professional Touch 5 against 4 and شركة العلا 37
  against 36 are real (a contact who rebooked after the meeting time).
- **Gaps:** upstream, the dialer's RESCHEDULE flow should cancel the old
  GoHighLevel appointment: systems manager (dialer).

### Shows, no-shows, show rate

- **Source of truth:** CRM status showed or noshow, then the client sheet's
  mark (the CRM copy `appointments.attended`, else the dialer's sheet row at
  the same contact and time, else, since 16 Oct, the contact's only sheet row
  that Kuwait day for the contact's only meeting that day), then the portal.
- **Rule:** unmarked is never a no-show; a day whose due meetings are all
  unmarked is NULL. Show rate = shows / (shows + no-shows); the client line is
  60%, under it is a watch.
- **Checked against:** the client sheets' Show column and the dialer's report
  (equal; after the fix Atlantis 6/3 = 6/3).
- **Gaps:** شركة العلا leaves Show blank on 35 of 36 sheet rows and Ocean Home
  on 30 of 31; Castello, mergestudio and Professional Touch mark none. Ask
  them to fill it: client success.

### Appointments with no outcome

- **Rule:** a due meeting with no portal outcome at any revision and no sheet
  mark. **Checked against:** sheet rows with Show blank and no portal outcome;
  five meetings read raw. After the fix Alkhalil 1 and Atlantis 1, equal to
  the sheet. Ocean Home 30 and شركة العلا 36 are real.

### Quotations and quotation rate

- **Source of truth:** the client sheet's Quotation column (column K) through
  the CSM copy, and the portal's quotation; the larger per day.
- **Rule:** by meeting day. The board's quotation rate = quotations / shows,
  summed over the days both are known; target 50% of shows (the constraints
  checklist). NULL when the client fills neither source, and (since 16 Oct) on
  a day whose due meetings have no quotation answer. `quotation_answers`
  (Y + N) tells a "no" from a blank and is known once the copy keeps N
  (`quoteKeepsN`, the native feed release after 16 Oct); the board's read
  carries it as its own figure (`quotationAnswers`), never as the rate's
  denominator, so a client who marks only Y does not read 100%.
- **Checked against:** the client sheets read live (Arcturus 12 Y and 14 N: a
  46% rate the board could not show).
- **Gaps:** six clients leave Quotation blank on every row (Ardon, Castello,
  Marble and more, mergestudio, Professional Touch, شركة العلا): client
  success. SAFAD's sheet says Y where its portal says no for the same two
  meetings (the sheet wins as the larger).

### Closes, revenue, AOV, close rate

- **Source of truth:** the client sheet's Closed (Y, N, P) and value columns
  through the dialer's `cc_results` (the first closed meeting per contact, no
  conflict), and the portal's won deals, one deal counted once.
- **Rule:** by meeting day; USD only at the fixed rates, an unknown currency
  left out and counted (`sources.sheet.unpricedCloses`). A day whose due
  meetings have no deal answer is NULL, not 0 (31 client-days read 0 before;
  Ocean Home's October rows are blank).
- **Close rate (the gate):** closes / shows, as `reportPeriod.ts` computes it,
  judged against `CLOSE_RATE_GATE` = 20% in `kpi.ts` (the checklist's 20% of
  shown appointments). Never color closes / closes_answered against that gate.
- **Won, pending, lost (new on 16 Oct):** `closes_pending` and `closes_lost`
  (meetings marked pending or lost, one per contact, not a contact closed that
  day) and `closes_answered` (meetings with a deal answer; a sheet win counts
  on the contact's first closed meeting only, as closes does). The board shows
  them as a breakdown beside closes: "won 0, pending 25, lost 1" (Arcturus).
  All three are NULL on a day whose closes are NULL, and NULL for a client
  whose sheet and portal never mark a deal lost or pending. A client who marks
  wins only (Ocean Home's single Y) would otherwise read answered = won, a
  100% rate by construction.
- **Checked against:** the sheets read live and the portal: 1 close in 30 days
  (Ocean Home, USD 67,000 on both), equal.
- **Gaps:** seven clients fill no closes source: client success.

### Lead quality

- **Source of truth:** the portal's latest revision per appointment, scores 1
  to 10 only; average = sum / count. **Checked against:** a recount from the
  raw outcomes (equal). **Coverage:** 7 clients, 14 scores in 30 days.

### Official dials

- **Source of truth:** the dialer's saved outcomes with a note
  (`call_center_events` kind outcome), by the Kuwait day saved.
- **Checked against:** `mahara_call_center_report` dials (equal for all 17).
- **Rule (fixed 16 Oct):** NULL for a client the dialer does not list (15
  such clients read 0 on every day), and NULL for a done-with-you client the
  dialer lists (نهوض نجد read 0 on all 120 days); the day's `sources.dialer`
  says which, with state `none`.
- **Gaps:** a dial is a saved outcome, not a Maqsam call: one caller saved 798
  outcomes against 530 provider calls in 30 days. See "Leads contacted".

### Leads called

- **Source of truth:** `call_center_events` leads with a verified Maqsam first
  dial, by lead creation day, WhatsApp chats left out.
- **Checked against:** the dialer's report `leadsDialed` (equal for all 17).
- **Rule:** NULL, never 0, for a client the dialer does not list and for a
  done-with-you client, as dials.
- **Freshness:** as current as the oldest Maqsam call job of the client's
  assigned callers (behind after 3 hours or an error).

### Leads contacted (the 90% line)

- **Source of truth:** `cockpit_client_now`, the last 30 Kuwait days,
  dialable GCC leads older than one working hour.
- **Rule:** `touched_30d` keeps the client page's rule (a Maqsam call by
  contact, a call to the phone under another lead, or a saved attempt). New
  on 16 Oct: `verified_called_30d` (a Maqsam call only) and
  `outcome_only_30d` (touched by a saved outcome alone). Since
  `20261016220000_board_read_checked.sql` the board's Leads contacted is
  verified / callable, judged against the 90% line; the touched share and the
  outcome-only count stay in the cell and its note ("38 more have a saved
  outcome but no Maqsam call, so they are not counted (95% if they were)").
  The client success and media buyer client pages keep the touched rule and
  say "called or messaged". DWY clients store no waiting figures.
- **Checked against:** Maqsam outbound calls with saved attempts left out:
  City Wood 95% touched against 57% called, شركة العلا 95% against 80%,
  Marble 100% against 76%, Arcturus 99% against 89%, Khalida 100% against
  57%, mergestudio 94% against 81%. Six clients flip from pass to fail on the
  90% line. Professional Touch's 64% is real (31 waiting, the oldest from 29
  Sep).
- **Gaps:** almost all outcome-only touches are on clients of one caller. The
  call-centre lead asks whether that caller dials from a line Maqsam does not
  see.

### Median first call (working seconds)

- **Source of truth:** `call_center_events` lead speed (the caller's Team &
  Payroll hours), median over 30 days. **Checked against:** the dialer's
  report `medianSpeedSeconds` (equal). **Gaps:** breaks and schedule changes
  are not recorded.

### Assigned caller

- **Source of truth:** the dialer's access list (`mahara_console.metadata`
  access:agent, active, with the location), kept when the account's role is
  agent. **Checked against:** who saved the dials (100% from the assigned
  caller for all 16 DFY clients).

### Tracking sheet link

- **Source of truth:** the ClickUp card's Sheet Link. **Checked against:**
  `ghl_clients.sheet_link`, `portal_data.workspaces` and the dialer's
  `sheet_snapshots.sheet_id`: 17 of 17 active agree.
- **Gap fixed:** the dialer stores only filled rows, so an empty month tab
  read as a missing tab (Khalida's October). The note now says "Its Oct 26 tab
  has no rows yet".

### Freshness of each source

| Source | Where the board reads its time | Behind when |
| --- | --- | --- |
| Meta ad numbers | `cockpit_sync_state` meta-ad-days-hourly / -nightly, `cockpit_meta_ad_days_status()` per account | suggested: the hourly run's last ok over 2 hours ago; an account failing its read |
| CRM leads | `lead_sync_state` per location (`sources.leads.as_of`) | 3 hours, or a failed run |
| Appointments | `appointment_sync_state` (`sources.appointments.as_of`) | 3 hours, or a failed run |
| Provisional bookings | `mahara_reporting.sync_jobs` appointments_recent `last_success` | 3 hours, or an error |
| Calls and leads called | `sync_jobs` kind calls, the oldest job of the assigned callers | 3 hours, or an error |
| Client sheets | `sheet_snapshots.checked_at` and `error`; the CSM copy's `performanceSyncedAt` | 3 hours, or an error |
| Portal outcomes | the latest client report (`sources.outcomes.as_of`) | not a read time: no "behind" |
| The facts | `cockpit_sync_state` board-facts and `cockpit_board_facts_doctor()` | 2 hours; the 120-day fill 26 hours |

On 16 Oct at 16:30 Kuwait every source was fresh: lead sync 15:35, appointments
16:20, the dialer's appointment and call jobs 16:25 to 16:27, sheets 16:22 to
16:27, the CSM copy 16:10, meta-ad-days hourly 16:12, the facts 16:10.

## What changed on 16 October

| Found | Fixed in | Effect |
| --- | --- | --- |
| The board judged Leads contacted on saved outcomes as well as Maqsam calls | `20261016220000_board_read_checked.sql` | verified / callable on the 90% line: City Wood 95% to 57%, Marble and more 100% to 76%, شركة العلا 95% to 80%, mergestudio 94% to 81%, Arcturus 99% to 89%, Khalida 100% to 57% |
| Spend on accounts no client row carries was silently outside the totals | same | `offBoard` on the read and a "Not in these totals" line under the totals (whole-board seats): $1,712 on 10 accounts over 16 Sep to 15 Oct |
| Won, pending and lost not on the board | same | the Closes cell and its note ("Won 0, still pending 23, lost 1"), the totals' "N pending" |
| DMs inside CRM leads not said | same | the CRM leads cell counts them (`dms`) and says so |
| DMs counted as CRM ad leads | `20261016210000_board_facts_checked.sql` | Ocean Home 139 to 115, Alkhalil 75 to 57, City Wood 52 to 48; DMs in `crm_dm_contacts` |
| Status and service from the registry, not ClickUp | same | Shades Active; three lost clients Stopped; doctor lists disagreements |
| Spending accounts no tie reached | same, and `20261016210200_board_account_ties.sql` | Shades, Ardon, Pidco, AEA tied with evidence; Alkhalil's SAR account (the client's own post boosts) kept out and named; the registry's own ad account field read as the last tie |
| Bookings replaced before their time still due | same | Alkhalil 8 to 7, Atlantis 12 to 10 meetings due |
| RESCHEDULE and CALLBACK bookings counted as bookings | same | Alkhalil 8 to 7, Arcturus 29 to 28 confirmed |
| A sheet mark lost when the CRM moved the meeting | same | Atlantis shows 5 to 6 |
| Pending and lost deals not kept | same | `closes_pending`, `closes_lost`, `closes_answered` as a breakdown; NULL for a client who marks wins only; the gate's close rate stays closes / shows |
| 0 closes and quotations on unreported days | same | NULL on those days |
| Quotation N dropped | same, and `hermes/cockpit-sync/csmProviders.ts` | answers known after the native feed release |
| Dials 0 for clients the dialer does not list | same | NULL with a note |
| Saved outcomes counted as contact | same | `verified_called_30d`, `outcome_only_30d`; DWY stores no waiting figures |
| Today read as complete | same | `partial` on every source of a day not yet over |
| Stale notes on old days after one failed read | same | the 30-minute run fills the 120 days again when the source reads again |
| Bulk uploads unnamed | same | the day's leads note and `bulkImport` |
| The call centre's CALLBACK bookings counted by the media sync | `calculator.ts` | dropped by their ids, as the facts do; no calendar dropped by its name |
| An empty month tab called missing | same | "Its Oct 26 tab has no rows yet" |
| The doctor's plain-word problems could not be added | same | typed as text |
| A client's reach summed part of its accounts | `20261016210100_meta_ad_days_checked.sql` | Marble, ARCWANI, Liwan read "unknown" until the nightly run |
| No full-day reach windows | same | `last_7_full`, `last_30_full` |
| Hidden accounts called "not linked" | same | "Hidden on purpose" |
| No word for billing or cancelled-client spend | same, and the doctor in `meta-ad-days` | `billingStopped`, `cancelledDelivering` |
| The doctor's "not linked" list always empty | same, and `run.ts` | the accounts are sent with their names |
| Reach windows on the same days refused or 0 | `meta-ad-days` `parse.ts`, `run.ts` | each span read once, written to both |
| Lead ids never kept | `20261016210100_meta_ad_days_checked.sql`, `run.ts` | `cockpit_meta_lead_ids`, `cockpit_meta_leads_not_in_crm` |

To make it live, in order (systems manager, the lead session):
1. Apply `20261016210000_board_facts_checked.sql`.
2. Apply `20261016210100_meta_ad_days_checked.sql` and deploy `meta-ad-days`
   (either order).
3. Apply `20261016210200_board_account_ties.sql`.
4. `select public.cockpit_board_facts_run('nightly');` once, then
   `select public.cockpit_board_facts_doctor();`.
5. Post `{"job":"doctor"}` to `meta-ad-days`; the next hourly run ties the new
   accounts, and the nightly run (03:20 Kuwait) reads every account's reach
   and the lead ids.
6. Release the native feed (`hermes/cockpit-sync`) so the CSM copy keeps
   quotation N and the media sync drops the call centre's RESCHEDULE and
   CALLBACK bookings by id.

## What is left, and who does it

| What | Who |
| --- | --- |
| Shades's lead form "Shades\|mahara\|14\10" is not connected to its GoHighLevel location (newest contact 8 Oct; 3 to 4 form leads since 14 Oct never arrived). Connect it, send one test lead, re-send the missing ones. | Media buyer |
| Professional Touch's ad account is not shared with Mahara's business 767701513092162: ask the client to share it and give the system user ads_read; then add a hand tie and run a backfill for that account. Until then spend is "unknown", never $0. | CEO, then systems manager |
| Cancelled clients' accounts spent $1,507 in 30 days (Ideal Elite $578.62 on a Mahara campaign, Pidco $553.00 still delivering, AEA, Rm decor, حول العمران, MOFAG). Confirm each client's status; switch delivery off where the client is gone; decide whether to remove Pidco's account from Mahara's business. | Client success, media buyer, CEO |
| Alkhalil's SAR account 640644143620696 is kept out of Alkhalil's figures (only the client's own Instagram post boosts). If Mahara does manage it, set its `kept_out` to false in a migration with the evidence. | Media buyer, then systems manager |
| Atlantis's "Project Review & Qualification Call" calendar also takes leads' own bookings (3 of 5). Say whether it is a booking calendar: if yes, the board's calendar rule should count it (by its calendar id); if no, the booking page should not offer it. | Client success, then systems manager |
| Triple Edge (spending, a clients row, no GoHighLevel location): a client or not? If yes, create its location and tie it; if no, hide it. | Client success |
| Art Vision (spent $25.67, no client record) and ريبالو/ORB (hidden; Ocean Home's owner's other brand?): name, hide or remove. | Client success, CEO |
| Ardon's Page gives Mahara no lead access, so its leads cannot be matched lead by lead. | CEO asks the client |
| ARCWANI, Liwan, Ocean Home, SAFAD and شركة العلا accounts are unsettled (billing); marblemore1 is disabled. | Client success |
| شركة العلا and Ocean Home leave the Show column blank; six clients leave Quotation and Closed blank. | Client success |
| Confirm نهوض نجد's ad platform (its card says Tiktok) and Joe and Sera's (flagged TikTok, card says Meta). | Client success |
| One caller's leads are "touched" by saved outcomes with no Maqsam call. | Call-centre lead |
| Whether Instagram and Messenger DMs should leave CRM leads like WhatsApp chats. | CEO, systems manager |
| The dialer: RESCHEDULE should cancel the old GoHighLevel appointment; its appointment facts should learn when GoHighLevel drops a booking; its sheet reader could keep column K as a second quotation source; the copy of sheet marks onto `appointments.attended` should take the same moved-time fallback as the facts. | Systems manager (dialer) |
| The board, still to read (done on 16 Oct: NULL as unknown, the 90% line on `verified_called_30d`, close rate = closes / shows with won, pending and lost beside it, cost per lead from Meta's leads, spend outside the rows as "Not in these totals", each account's own clock, a dash for DWY call-centre figures): "so far, as of" on a partial today; full-day windows by default; the billing reason from `billingStopped`; "Meta leads not in the CRM" from `cockpit_meta_leads_not_in_crm` on the client page, once the first nightly run (03:20 Kuwait) has stored Meta's lead ids. | Board team |
| Flag a client whose "Meta leads not in the CRM" is above 0 for two days. | Systems manager (cockpit guardian) |
| The SAR and QAR pegs in the fixed rates (about $0.50 in 30 days). | Systems manager, optional |
| Hook and hold targets from Mahara's own spread; one KPI set (`kpi.ts` or the October plan). | Media buyer, CEO |
| Composio's HighLevel connections are expired, so GoHighLevel could not be read as a third source. | CEO, optional |

## Second-source check, 16 October 2026

Run on 16 Oct 2026 between 16:07 and 16:50 Kuwait, read only. Windows: 30 days
= 16 Sep to 15 Oct, 7 days = 9 to 15 Oct (full days) unless a row says
otherwise. Ad numbers are in USD at the fixed rates. "Stored" is what the board's
tables held at the time; "Independent" is the second source; "After the fixes"
is the stored figure the 16 Oct corrections give, recounted read-only on live
data (blank where nothing changes).

### A. Meta ad numbers (stored `cockpit_meta_ad_days`, `cockpit_meta_reach`; independent Meta Graph v25.0 GET)

| Client | Metric | Stored | Independent | Match | Note, after the fixes |
| --- | --- | --- | --- | --- | --- |
| Alkhalil | spend / impressions / link clicks, 30d, 7d | 644.12 / 28,426 / 563; 94.30 / 5,890 / 102 | same | yes | |
| Alkhalil | link CTR / CPC / CPM, 30d, 7d | 1.98% / $1.14 / $22.66; 1.73% / $0.92 / $16.01 | same | yes | |
| Alkhalil | form leads / lead action, 30d, 7d | 57 / 57; 4 / 4 | same | yes | |
| Alkhalil | video 3s / plays / ThruPlays / p25 / p50 / p75 / p100, 30d | 2,915 / 26,933 / 580 / 1,230 / 548 / 403 / 200 | same | yes | 7d equal too |
| Alkhalil | reach / impressions / frequency, last_30, last_7 (to today) | 20,748 / 32,384 / 1.56; 9,288 / 10,552 / 1.14 | 21,000 / 32,713 / 1.56; 9,606 / 10,881 / 1.13 | yes | gap is today's delivery between the two reads |
| Alkhalil | CRM ad leads vs Meta form leads, 30d, 7d | 75; 7 | 57; 4 | no | 18 Instagram DMs counted. After: 57 |
| Arcturus Construction | spend / impressions / link clicks, 30d, 7d | 993.65 / 61,788 / 1,391; 257.65 / 17,633 / 407 | same | yes | |
| Arcturus Construction | link CTR / CPC / CPM, 30d, 7d | 2.25% / $0.71 / $16.08; 2.31% / $0.63 / $14.61 | same | yes | |
| Arcturus Construction | form leads / lead action, 30d, 7d | 83 / 83; 23 / 23 | same | yes | |
| Arcturus Construction | video fields, 30d, 7d | 9,038 / 58,515 / 2,124 / 2,967 / 1,552 / 823 / 468 | same | yes | |
| Arcturus Construction | reach / impressions / frequency, last_30, last_7 | 28,655 / 67,036 / 2.34; 12,694 / 21,364 / 1.68 | 28,867 / 67,312 / 2.33; 12,919 / 21,640 / 1.68 | yes | today's delivery |
| Arcturus Construction | CRM ad leads vs Meta form leads, 30d, 7d | 82; 22 | 83; 23 | no | 5 Meta leads never became contacts (7 to 9 Oct); 4 DMs counted. After: 78 |
| ARCWANI | spend / impressions / link clicks, 30d, 7d | 859.08 / 146,514 / 2,088; 126.43 / 51,744 / 527 | same | yes | no delivery since 9 Oct (unsettled billing) |
| ARCWANI | link CTR / CPC / CPM, 30d, 7d | 1.43% / $0.41 / $5.86; 1.02% / $0.24 / $2.44 | same | yes | |
| ARCWANI | form leads / lead action, 30d, 7d | 31 / 53; 0 / 0 | 31 / 53; none | yes | 22 lead actions from an Engagement campaign |
| ARCWANI | video fields, 30d, 7d | 4,246 / 28,152 / 674 / 810 / 409 / 556 / 150 | same | yes | |
| ARCWANI | reach, last_30, last_7 | no client row | 106,233 / 144,862 / 1.36; no delivery | no | After: a row reading "unknown, waits for the nightly run" until it runs |
| ARCWANI | CRM ad leads vs Meta form leads, 30d, 7d | 32; 0 | 31; none | no | all 31 matched; one contact's lead is outside the window. After: 32 |
| Ardon | spend / impressions / link clicks, 30d, 7d | 887.83 / 180,822 / 991; 320.92 / 72,618 / 410 | same | yes | SAR 3,330.21 at 0.2666 ($888.06 at the peg) |
| Ardon | link CTR / CPC / CPM, 30d, 7d | 0.55% / $0.90 / $4.91; 0.56% / $0.78 / $4.42 | same | yes | |
| Ardon | form leads / lead action, 30d, 7d | 79 / 79; 21 / 21 | same | yes | |
| Ardon | video fields, 30d, 7d | 27,923 / 168,859 / 5,439 / 5,887 / 2,450 / 1,303 / 570 | same | yes | |
| Ardon | reach, last_30, last_7 | 98,073 / 188,356 / 1.92; 50,303 / 71,677 / 1.42 | 98,191 / 188,606 / 1.92; 50,492 / 71,927 / 1.42 | yes | today's delivery |
| Ardon | CRM ad leads vs Meta form leads, 30d, 7d | 81; 29 | 79; 21 | no | bulk uploads on 28 Sep and 13 Oct; no lead access on its Page. After: 76 |
| Atlantis Contracting | spend / impressions / link clicks, 30d, 7d | 930.33 / 25,234 / 334; 152.28 / 5,655 / 60 | same | yes | account on Los Angeles days |
| Atlantis Contracting | link CTR / CPC / CPM, 30d, 7d | 1.32% / $2.79 / $36.87; 1.06% / $2.54 / $26.93 | same | yes | |
| Atlantis Contracting | form leads / lead action, 30d, 7d; LPV | 42 / 42; 2 / 2; 101 | same | yes | 38 instant form + 4 website |
| Atlantis Contracting | video fields, 30d, 7d | 2,621 / 13,324 / 556 / 857 / 405 / 218 / 123 | same | yes | |
| Atlantis Contracting | reach, last_30, last_7 | 11,910 / 25,030 / 2.10; 2,990 / 4,927 / 1.65 | 11,915 / 25,075 / 2.10; 3,012 / 4,972 / 1.65 | yes | today's delivery |
| Atlantis Contracting | CRM ad leads vs Meta form leads, 30d, 7d | 46; 3 | 42; 2 | no | 3 form leads never became contacts; 6 DMs counted. After: 40 |
| Castello Industries | spend / impressions / link clicks, 30d, 7d | 946.89 / 111,629 / 462; 269.47 / 65,859 / 207 | same | yes | second account closed, spent nothing |
| Castello Industries | link CTR / CPC / CPM, 30d, 7d | 0.41% / $2.05 / $8.48; 0.31% / $1.30 / $4.09 | same | yes | |
| Castello Industries | form leads / lead action, 30d, 7d | 69 / 69; 34 / 34 | same | yes | |
| Castello Industries | video fields, 30d, 7d | 10,617 / 94,337 / 2,095 / 4,597 / 2,228 / 1,342 / 953 | same | yes | |
| Castello Industries | reach, last_30, last_7 | 47,607 / 114,230 / 2.40; 29,350 / 62,044 / 2.11 | 47,701 / 114,348 / 2.40; 29,453 / 62,162 / 2.11 | yes | today's delivery |
| Castello Industries | CRM ad leads vs Meta form leads, 30d, 7d | 79; 37 | 69; 34 | no | 2 never became contacts; 13 DMs counted. After: 66 |
| City Wood | spend / impressions / link clicks, 30d, 7d | 946.96 / 47,366 / 438; 152.00 / 10,189 / 90 | same | yes | second account closed |
| City Wood | link CTR / CPC / CPM, 30d, 7d | 0.92% / $2.16 / $19.99; 0.88% / $1.69 / $14.92 | same | yes | |
| City Wood | form leads / lead action, 30d, 7d | 48 / 48; 7 / 7 | same | yes | |
| City Wood | video fields, 30d, 7d | 5,890 / 42,727 / 1,382 / 2,028 / 950 / 534 / 318 | same | yes | |
| City Wood | reach, last_30, last_7 | 30,826 / 51,855 / 1.68; 9,243 / 12,251 / 1.33 | 30,986 / 52,013 / 1.68; 9,330 / 12,409 / 1.33 | yes | today's delivery |
| City Wood | CRM ad leads vs Meta form leads, 30d, 7d | 52; 8 | 48; 7 | no | 2 never became contacts; 5 DMs counted. After: 48 |
| Joe and Sera Company | spend, 30d, 7d | 0; 0 | 0.00; 0.00 | yes | last spend 11 Sep; also runs TikTok (not read) |
| Liwan | spend / impressions / link clicks, 30d, 7d | 1,893.87 / 473,975 / 3,405; 268.94 / 4,174 / 93 | same | yes | no delivery since 12 Oct (unsettled) |
| Liwan | link CTR / CPC / CPM, 30d, 7d | 0.72% / $0.56 / $4.00; 2.23% / $2.89 / $64.43 | same | yes | |
| Liwan | form leads / lead action, 30d, 7d; LPV | 19 / 20; 4 / 4; 51 | same | yes | 1 WhatsApp lead from Engagement |
| Liwan | video fields, 30d, 7d | 3,082 / 17,402 / 645 / 1,030 / 525 / 363 / 191 | same | yes | |
| Liwan | reach, last_30, last_7 | no client row | 360,759 / 472,739 / 1.31; 2,830 / 3,526 / 1.25 | no | After: "unknown, waits for the nightly run" |
| Liwan | CRM ad leads vs Meta form leads, 30d, 7d | 17; 3 | 19; 4 | no | 3 never became contacts; 2 DMs counted. After: 15 |
| Marble and more | spend / impressions / link clicks, 30d, 7d | 228.44 / 12,171 / 106; 65.54 / 4,035 / 36 | same | yes | two accounts (marblemore1 disabled) |
| Marble and more | link CTR / CPC / CPM, 30d, 7d | 0.87% / $2.16 / $18.77; 0.89% / $1.82 / $16.24 | same | yes | |
| Marble and more | form leads / lead action, 30d, 7d | 26 / 26; 9 / 9 | same | yes | |
| Marble and more | video fields, 30d, 7d | 3,023 / 11,757 / 680 / 1,571 / 774 / 451 / 247 | same | yes | |
| Marble and more | reach, last_30 | 3,604 / 5,673 / 1.57 | 8,063 / 13,871 / 1.72 | no | one account of two, no note. After: "unknown, waits for the nightly run", then the two-account sum |
| Marble and more | reach, last_7 | 3,604 / 5,673 / 1.57 | 3,635 / 5,735 / 1.58 | yes | |
| Marble and more | CRM ad leads vs Meta form leads, 30d, 7d | 26; 9 | 26; 9 | yes | |
| mergestudio.kw | spend / impressions / link clicks, 30d, 7d | 154.12 / 5,692 / 93; 153.76 / 5,637 / 93 | same | yes | |
| mergestudio.kw | link CTR / CPC / CPM, 30d, 7d | 1.63% / $1.66 / $27.08; 1.65% / $1.65 / $27.28 | same | yes | |
| mergestudio.kw | form leads / lead action, 30d, 7d | 16 / 16; 16 / 16 | same | yes | |
| mergestudio.kw | video fields, 30d, 7d | 1,049 / 5,295 / 228 / 337 / 158 / 87 / 55 | same | yes | |
| mergestudio.kw | reach, last_30, last_7 | 3,881 / 6,555 / 1.69; 3,845 / 6,500 / 1.69 | 3,904 / 6,590 / 1.69; 3,868 / 6,535 / 1.69 | yes | today's delivery |
| mergestudio.kw | CRM ad leads vs Meta form leads, 30d, 7d | 16; 16 | 16; 16 | yes | |
| Ocean Home | spend / impressions / link clicks, 30d, 7d | 1,128.74 / 63,858 / 748; 228.94 / 12,498 / 128 | same | yes | unsettled billing |
| Ocean Home | link CTR / CPC / CPM, 30d, 7d | 1.17% / $1.51 / $17.68; 1.02% / $1.79 / $18.32 | same | yes | |
| Ocean Home | form leads / lead action, 30d, 7d | 115 / 115; 21 / 21 | same | yes | |
| Ocean Home | video fields, 30d, 7d | 13,932 / 58,430 / 4,282 / 11,056 / 6,463 / 4,475 / 2,748 | same | yes | |
| Ocean Home | reach, last_30, last_7 | 20,036 / 61,459 / 3.07; 5,866 / 10,131 / 1.73 | same | yes | |
| Ocean Home | CRM ad leads vs Meta form leads, 30d, 7d | 139; 28 | 115; 21 | no | 24 Instagram DMs counted. After: 115 |
| Professional Touch Company | spend, impressions, clicks, video | none: no account tied | unknown: Meta says the ads cannot be loaded | no | the account is not shared with Mahara's business |
| SAFAD Consultant Engineering | spend / impressions / link clicks, 30d, 7d | 883.42 / 551,066 / 4,142; 507.69 / 502,143 / 3,799 | 883.43 / 551,072 / 4,142; 507.70 / 502,149 / 3,799 | no | Meta added 6 impressions to 15 Oct after the read; the nightly re-read settles it |
| SAFAD Consultant Engineering | link CTR / CPC / CPM, 30d, 7d | 0.75% / $0.21 / $1.60; 0.76% / $0.13 / $1.01 | same | yes | |
| SAFAD Consultant Engineering | form leads / lead action, 30d, 7d | 49 / 49; 15 / 15 | same | yes | |
| SAFAD Consultant Engineering | video fields, 30d, 7d | 8,548 / 63,434 / 1,434 / 4,220 / 1,451 / 798 / 467 | same | yes | |
| SAFAD Consultant Engineering | reach, last_30, last_7 | 412,228 / 545,726 / 1.32; 383,856 / 497,690 / 1.30 | 412,228 / 545,732 / 1.32; 383,856 / 497,696 / 1.30 | yes | |
| SAFAD Consultant Engineering | CRM ad leads vs Meta form leads, 30d, 7d | 49; 16 | 49; 15 | no | equal by chance: 3 never became contacts, 3 DMs counted. After: 46 |
| شركة العلا | spend / impressions / link clicks, 30d, 7d | 1,000.55 / 34,773 / 666; 238.10 / 8,133 / 150 | same | yes | unsettled billing |
| شركة العلا | link CTR / CPC / CPM, 30d, 7d | 1.92% / $1.50 / $28.77; 1.84% / $1.59 / $29.28 | same | yes | |
| شركة العلا | form leads / lead action, 30d, 7d | 107 / 107; 19 / 19 | same | yes | |
| شركة العلا | video fields, 30d, 7d | 8,614 / 31,664 / 2,672 / 3,623 / 1,747 / 968 / 450 | same | yes | |
| شركة العلا | reach, last_30, last_7 | 12,527 / 33,728 / 2.69; 4,353 / 6,883 / 1.58 | same | yes | |
| شركة العلا | CRM ad leads vs Meta form leads, 30d, 7d | 122; 26 | 107; 19 | no | 15 DMs counted. After: 108 |
| شركة منشآت خالدة | spend / impressions / link clicks, 30d, 7d | 1,983.36 / 111,374 / 1,279; 388.96 / 55,035 / 601 | same | yes | campaign level equal too |
| شركة منشآت خالدة | link CTR / CPC / CPM, 30d, 7d | 1.15% / $1.55 / $17.81; 1.09% / $0.65 / $7.07 | same | yes | |
| شركة منشآت خالدة | form leads / lead action, 30d, 7d; LPV | 10 / 48; 4 / 4; 146 | same | yes | 38 WhatsApp leads from Engagement campaigns |
| شركة منشآت خالدة | video fields, 30d, 7d | 1,794 / 10,685 / 363 / 537 / 269 / 165 / 88 | same | yes | |
| شركة منشآت خالدة | reach, last_30, last_7 | 92,283 / 111,613 / 1.21; 2,399 / 2,749 / 1.15 | same | yes | |
| شركة منشآت خالدة | CRM ad leads vs Meta form leads, 30d, 7d | 9; 4 | 10; 4 | no | 1 never became a contact. After: 9 |
| نهوض نجد | spend / impressions / link clicks, 30d, 7d | 799.19 / 24,032 / 242; 173.48 / 5,470 / 69 | same | yes | |
| نهوض نجد | link CTR / CPC / CPM, 30d, 7d | 1.01% / $3.30 / $33.26; 1.26% / $2.51 / $31.71 | same | yes | |
| نهوض نجد | form leads / lead action, 30d, 7d | 67 / 67; 13 / 13 | same | yes | |
| نهوض نجد | video fields, 30d, 7d | 4,629 / 21,859 / 1,340 / 2,501 / 1,293 / 761 / 417 | same | yes | |
| نهوض نجد | reach, last_30, last_7 | 10,726 / 23,701 / 2.21; 3,408 / 5,299 / 1.55 | 10,726 / 23,723 / 2.21; 3,416 / 5,321 / 1.56 | yes | today's delivery |
| نهوض نجد | CRM ad leads vs Meta form leads, 30d, 7d | 58; 10 | 67; 13 | no | bulk upload on 6 Oct; 9 not contacts in the window |
| Ideal Elite (cancelled) | spend / impressions / link clicks, 30d | 578.62 / 5,281 / 106 | same | yes | Mahara campaign ran 24 Sep to 7 Oct, 0 leads |
| Ideal Elite (cancelled) | form leads / lead action; LPV | none / 0; 31 | 0 / none; 31 | yes | |
| MOFAG (cancelled) | spend / impressions / link clicks, 30d | 31.48 / 883 / 27 | same | yes | QAR at 0.2747 |
| MOFAG (cancelled) | form leads, video | 4 / 4; 142 / 810 / 40 / 48 / 28 / 19 / 14 | same | yes | |
| Rm decor (cancelled) | spend / impressions / link clicks, 30d | 127.38 / 1,724 / 31 | same | yes | |
| حول العمران (cancelled) | spend / impressions / link clicks, 30d | 108.62 / 8,535 / 33 | same | yes | |
| حول العمران (cancelled) | form leads, video | 6 / 6; 1,139 / 7,734 / 202 / 693 / 338 / 197 / 121 | same | yes | |
| AEA Designs (cancelled) | spend / impressions / link clicks, 30d | 109.04 / 3,041 / 31 | same | yes | After: tied by hand for the history |
| Art Vision (no client) | spend / impressions / link clicks, 30d; lead action | 25.67 / 11,531 / 79; 6 | same | yes | WhatsApp Engagement only |
| Alkhalil SAR account 640644143620696 | spend / impressions / link clicks, 30d, 7d | 79.76 / 22,700 / 35 | same | yes | After: kept out of Alkhalil's figures (the client's own post boosts), named "Hidden on purpose" |
| Shades | spend / impressions / link clicks, 30d, 7d | 446.84 / 80,612 / 544; 46.70 / 15,401 / 74 | 446.85 / 80,614 / 544; 46.71 / 15,403 / 74 | no | 2 impressions still settling. After: tied to Shades by hand |
| Shades | form leads / lead action, 30d, 7d | 3 / 3; 3 / 3 | same | yes | none reached GoHighLevel |
| Pidco (cancelled) | spend / impressions / link clicks, 30d, 7d | 553.00 / 55,151 / 473; 198.39 / 27,352 / 195 | same | yes | After: tied for the history; named as delivering for a cancelled client |
| Pidco (cancelled) | form leads / lead action, 30d, 7d | 8 / 12; 8 / 8 | same | yes | 4 WhatsApp leads kept out of form leads |
| ريبالو / ORB (hidden) | spend / impressions / link clicks, 30d | 91.91 / 4,932 / 21 | same | yes | After: named "Hidden on purpose" |
| Triple Edge (no location) | spend / impressions / link clicks | 6.97 / 5,821 / 28 | 6.97 / 5,822 / 28 | no | 1 impression still settling |
| All 32 accounts, 90-day backfill | spend and impressions per account | equal to the cent except Shades and SAFAD | Shades SAR 4,871.53 / 282,027; SAFAD $1,730.72 / 667,248 | yes | the latest days were still settling |

### B. Business numbers (stored `cockpit_client_days`, `cockpit_client_now`; independent the dialer's report, the client sheets read live, the portal, the media sync)

| Client | Metric | Stored | Independent | Match | Note, after the fixes |
| --- | --- | --- | --- | --- | --- |
| Alkhalil | CRM leads | 76 | 76 (79 less 3 WhatsApp chats) | yes | |
| Alkhalil | confirmed bookings | 8 | dialer 7, media 5 | no | a RESCHEDULE booking counted. After: 7 |
| Alkhalil | provisional bookings | 3 | 3 | yes | |
| Alkhalil | meetings due | 8 | 7 sheet rows | no | the replaced booking still due. After: 7 |
| Alkhalil | shows / no-shows | 3/3 | 2/3 on the sheet | no | the portal's show on a meeting the sheet left blank: the rule's order, correct |
| Alkhalil | no outcome | 2 | 1 | no | After: 1 |
| Alkhalil | quotations | 2 | 2 (sheet Y 1, N 1) | yes | |
| Alkhalil | closes / revenue | 0 / $0 | 0 | yes | |
| Alkhalil | lead quality | 3 scores, average 6.7 | same | yes | |
| Alkhalil | dials / leads called | 100 / 51 | same | yes | |
| Alkhalil | leads contacted (30d) | 55/55 | 55/55 called | yes | |
| Arcturus Construction | CRM leads | 86 | 86 | yes | |
| Arcturus Construction | confirmed bookings | 29 | dialer 29, media 28 | yes | equal by two opposite differences. After: 28 (the RESCHEDULE booking left out) |
| Arcturus Construction | provisional / meetings due | 1 / 29 | 1 / 29 sheet rows | yes | |
| Arcturus Construction | shows / no-shows / no outcome | 17/9 / 3 | same | yes | |
| Arcturus Construction | quotations | 12 | 12 (Y 12, N 14) | yes | After the native release: answers 26, rate 46% |
| Arcturus Construction | closes / revenue | 0 / $0 | 0 won, 25 pending, 1 lost | yes | After: pending and lost kept |
| Arcturus Construction | dials / leads called | 165 / 52 | same | yes | |
| Arcturus Construction | leads contacted (30d) | 73/74 (99%) | 66/74 called (89%) | no | After: verified 66, outcome only 7 |
| ARCWANI | CRM leads | 34 | 34 (50 less 16 chats) | yes | |
| ARCWANI | confirmed / provisional / meetings due | 9 / 0 / 12 | 9 / 0 / 12 | yes | |
| ARCWANI | shows / no-shows / no outcome | 5/2 / 5 | same | yes | |
| ARCWANI | quotations / closes | 4 / 0 | 4 (Y 4, N 1) / 0 (P 3, N 2) | yes | |
| ARCWANI | dials / leads called / contacted | 81 / 15 / 29 of 32 | same | yes | |
| Ardon | CRM leads / confirmed / provisional | 81 / 9 / 1 | same | yes | |
| Ardon | meetings due / no outcome | 4 / 1 | 3 sheet rows / 0 | no | a 16 Sep meeting before its sheet starts: correct |
| Ardon | shows / no-shows | 1/2 | same | yes | |
| Ardon | quotations / closes | NULL / NULL | columns blank | yes | |
| Ardon | dials / leads called / contacted | 100 / 50 / 52 of 63 | same | yes | |
| Atlantis Contracting | CRM leads / confirmed | 50 / 11 | 50 / dialer 11, media 14 | yes | media counted the qualification calendar: 2 CALLBACK bookings (now dropped by id) and 3 leads' own bookings, which the board does not count (main and online calendars only) |
| Atlantis Contracting | provisional | 1 | dialer 17 | no | the dialer counts 16 Google copies: correct |
| Atlantis Contracting | meetings due | 12 | 10 sheet rows | no | two replaced bookings. After: 10 |
| Atlantis Contracting | shows / no-shows | 5/3 | 6/3 | no | the CRM moved one meeting's time. After: 6/3 |
| Atlantis Contracting | no outcome | 4 | 1 | no | After: 1 |
| Atlantis Contracting | quotations / closes | 5 / 0 | 5 / 0 (P 2, N 3) | yes | |
| Atlantis Contracting | lead quality | 3 scores, average 7.7 | same | yes | |
| Atlantis Contracting | dials / leads called / contacted | 64 / 29 / 33 of 37 | same | yes | |
| Castello Industries | CRM leads / confirmed / meetings due | 79 / 4 / 4 | same | yes | |
| Castello Industries | shows / no outcome | NULL / 4 | no marks / 4 | yes | |
| Castello Industries | quotations / closes | NULL / NULL | columns blank | yes | |
| Castello Industries | dials / leads called / contacted | 106 / 45 / 45 of 45 | same | yes | |
| City Wood | CRM leads / confirmed | 52 / 6 | 52 / dialer 7 | no | the dialer counts a booking GoHighLevel dropped: the board is right |
| City Wood | meetings due / shows / no outcome | 6 / 1/5 / 0 | same | yes | |
| City Wood | quotations / closes / lead quality | 2 / 0 / 2 scores, 3.0 | same | yes | |
| City Wood | dials / leads called | 108 / 18 | same | yes | |
| City Wood | leads contacted (30d) | 42/44 (95%) | 25/44 called (57%) | no | 17 touched by a saved outcome only. After: verified 25 |
| Joe and Sera Company | all business figures | 0 | 0 | yes | dials 17 (16 by the assigned caller, 1 by the CEO) |
| Liwan | CRM leads / confirmed / meetings due | 18 / 4 / 6 | same | yes | |
| Liwan | shows / no outcome / quotations / closes | 1/1 / 4 / 0 / 0 | same | yes | |
| Liwan | dials / leads called / contacted | 52 / 11 / 14 of 14 | same | yes | |
| Marble and more | CRM leads / confirmed / meetings due | 26 / 6 / 6 | same | yes | |
| Marble and more | shows / no outcome / lead quality | 2/2 / 2 / 2 scores, 4.5 | same | yes | |
| Marble and more | dials / leads called | 45 / 12 | same | yes | |
| Marble and more | leads contacted (30d) | 21/21 (100%) | 16/21 called (76%) | no | After: verified 16 |
| mergestudio.kw | CRM leads / confirmed / meetings due | 18 / 6 / 2 | same | yes | |
| mergestudio.kw | provisional | 0 | dialer 6 | no | the dialer counts Google copies: correct |
| mergestudio.kw | shows / no outcome | NULL / 2 | no marks / 2 | yes | |
| mergestudio.kw | dials / leads called | 29 / 9 | same | yes | |
| mergestudio.kw | leads contacted (30d) | 15/16 (94%) | 13/16 called (81%) | no | After: verified 13 |
| Ocean Home | CRM leads / provisional | 139 / 4 | same | yes | |
| Ocean Home | confirmed bookings | 30 | dialer 31 | no | the dialer counts a booking GoHighLevel dropped: the board is right |
| Ocean Home | meetings due / shows | 31 / 1/0 | 31 sheet rows / 1/0 | yes | rows differ, totals agree |
| Ocean Home | no outcome | 30 | 30 | yes | the client leaves Show blank |
| Ocean Home | quotations / closes / revenue | 1 / 1 / $67,000 | same | yes | |
| Ocean Home | dials / leads called / contacted | 209 / 102 / 105 of 109 | same | yes | |
| Professional Touch Company | CRM leads / confirmed | 100 / 4 | 100 / dialer 4 | yes | no ad account tied |
| Professional Touch Company | meetings due / no outcome | 5 / 5 | 4 sheet rows / 4 | no | one contact rebooked after the meeting: correct |
| Professional Touch Company | dials / leads called | 115 / 58 | same | yes | |
| Professional Touch Company | leads contacted (30d) | 56/87 (64%) | 55/87 called (63%) | yes | 31 waiting, the oldest from 29 Sep |
| SAFAD Consultant Engineering | CRM leads / confirmed / meetings due | 50 / 4 / 3 | same | yes | |
| SAFAD Consultant Engineering | shows / no outcome / quotations | 2/0 / 1 / 2 | same | yes | the sheet says Y where the portal says no |
| SAFAD Consultant Engineering | dials / leads called / contacted | 107 / 42 / 39 of 42 | same | yes | |
| شركة العلا | CRM leads / provisional | 126 / 0 | same | yes | |
| شركة العلا | confirmed bookings | 40 | dialer 42 | no | the dialer counts two bookings GoHighLevel dropped: the board is right |
| شركة العلا | meetings due / no outcome | 37 / 36 | 36 sheet rows / 35 | no | a contact who rebooked the next day: correct |
| شركة العلا | shows / quotations / lead quality | 1/0 / 0 / 1 score, 6 | same | yes | |
| شركة العلا | dials / leads called | 262 / 83 | same | yes | |
| شركة العلا | leads contacted (30d) | 100/105 (95%) | 84/105 called (80%) | no | After: verified 84 |
| شركة منشآت خالدة | CRM leads | 11 | 11 (30 less 19 chats) | yes | |
| شركة منشآت خالدة | bookings, meetings, outcomes | 0 | 0 | yes | |
| شركة منشآت خالدة | dials / leads called | 37 / 4 | same | yes | |
| شركة منشآت خالدة | leads contacted (30d) | 7/7 | 4/7 called | no | After: verified 4 |
| نهوض نجد (DWY) | CRM leads / dials / leads called | 58 / 0 / 0 | same | yes | After: waiting figures not stored (done with you) |

### C. The client spine, ties and freshness (stored `cockpit_board_clients`, `cockpit_meta_reach`, the facts' sources; independent the ClickUp roster, the registry, Meta, the client sheets)

| Client | Metric | Stored | Independent | Match | Note, after the fixes |
| --- | --- | --- | --- | --- | --- |
| All clients | active clients | 17 (registry) | 18 Active ClickUp cards | no | After: 18 (the card) |
| Shades | status | Launching | Active on its card since 4 Oct | no | After: Active |
| Olivar Design | status | Paused | Stopped since 20 Sep (churn log: lost) | no | After: Stopped, no new days |
| Uvan and Evan | status | Ghosting | Stopped since 20 Sep | no | After: Stopped |
| شركة كيسان | status | Paused | Stopped since 20 Sep | no | After: Stopped |
| Greystone Contracting | status | Launching | Paused on its card | no | After: Paused |
| Kazak; Prime Project Solutions | status | Ghosting, every CRM figure NULL | no ClickUp card | no | After: the registry's word, named by the doctor as noCard |
| Pidco Group | on the board | Cancelled, no card, not tied | ads live: SAR 2,178.99 in 30 days | no | After: tied for the history, named as delivering for a cancelled client |
| 16 DFY and نهوض نجد | service mode | 16 DFY, 1 DWY | same on the cards | yes | |
| Six non-active clients | service mode | blank | DFY on the cards | no | After: DFY |
| Shades | ad accounts | none | act 762687672022667, lead campaign since 14 Oct | no | After: tied by hand |
| Shades | CRM leads 14 to 16 Oct | 0, 0, 0 | Meta form leads 1, 2, 1 | no | the lead form is not connected to GoHighLevel |
| Alkhalil | ad accounts | 1 | 2 (same Meta business) | no | After: 1 tied; the SAR account holds only the client's own post boosts, so it is kept out and named |
| Marble, City Wood, Castello, Ardon | two-account clients | 2 each | lead sync watch agrees (15 of 15) | yes | |
| Professional Touch Company | ad accounts | none | not shared with Mahara's business | yes | spend must read unknown |
| Joe and Sera; نهوض نجد | TikTok flag | true; false | cards say Meta; Tiktok | no | After: نهوض نجد flagged from its card; Joe and Sera to confirm |
| Atlantis, Castello, Shades, Alkhalil's second account | Meta spend per day, 12 to 16 Oct | closed days as stored | equal to the cent on closed days | yes | today lags the hourly read by about 25 minutes |
| Marble and more | client reach last_30 | 5,673 impressions, no note | 13,809 impressions in the store across both accounts | no | After: unknown until the nightly run |
| ARCWANI; Liwan | client reach | no row | 144,862 and 472,739 impressions in 30 days | no | After: a row reading unknown |
| All 17 active | sheet link | the dialer's sheet id | card = registry = portal = dialer for 17 of 17 | yes | |
| Castello Industries | closes and quotations with blank columns | NULL every October day | Sep and Oct tabs blank | yes | |
| Ocean Home | closes and quotations on unreported days | 0 on 18 days | October tab blank on Show, Quotation and Closed | no | After: NULL on those days |
| شركة منشآت خالدة | sheet month note | "holds the month tabs Jul, Aug, Sep 2026" | every tab exists; October empty | no | After: "Its Oct 26 tab has no rows yet" |
| 15 clients outside the dialer | dials | 0 on all 120 days | not in the dialer's client list | no | After: NULL with a note |
| All 17 active | source freshness at 16:30 | every source ok | every sync fresh, every cron active | yes | |
| Atlantis Contracting | day boundary | Meta on Los Angeles days, CRM on Kuwait days | 9 of 50 CRM leads fall on another date on Meta's clock | no | the board's note on its row: board team |
| نهوض نجد (DWY) | leads waiting | 53 untouched, share 0.0185 | the call centre does not call this client | no | After: NULL |
