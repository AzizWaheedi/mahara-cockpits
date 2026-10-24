# Launch desk: every client's real state (read-only map, 2026-10-24)

Sources read on 24 Oct, around 12:00 to 13:30 Kuwait time. Everything here was a read: no writes to Meta, ClickUp or GoHighLevel.
- Supabase: `cockpit_board_clients`, `cockpit_client_onboarding`, `cockpit_meta_account_state` (the hourly read at 12:07), `cockpit_meta_budgets` (campaign switches, read at 12:14), `cockpit_meta_ad_days` (only the last day each account spent), `cockpit_campaigns`, `cockpit_media_sources`, and the live definitions of `cockpit_media_live_campaigns` and `cockpit_build_scope`.
- ClickUp GETs: the Clients - Mahara list 901816559981 (70 cards), the Ads Managment list 901817774521 (60 cards, closed ones included), and the open tasks on the Marketing / ADs list 901816723196.
- Meta GETs: account_status and campaigns on 7 accounts (ARCWANI, Liwan, AIVE, QA Tech, Olivar, Uvan and Evan, Kesan).

No money is shown. The 50-cent figure below is the worker's own threshold.

## A correction to the brief

The per-client ads cards (one per campaign, joined to the client by tag) are on **Ads Managment `901817774521`** in the Mahara Client Database space, not on Marketing / ADs. **Marketing / ADs `901816723196`** holds the "{card} - New Client Campaign Launch 🚀" tasks, the "Payment Failure" tasks and team tasks.

## The rule that decides who the Ads section shows

1. The native worker publishes a campaign to `cockpit_campaigns` only if it spent **at least $0.50 in the 7-day window**. The rule is `if (a.spend < 0.5) continue;` in `hermes/cockpit-sync/calculator.ts:2614`. The window comes from `sevenDayWindow` at `:157` and ends on the sheet's last spend day, about yesterday. A campaign that drops out is set `source_deleted` on the next publish.
2. The Ads section reads `cockpit_media_live_campaigns()`, which returns `cockpit_campaigns WHERE NOT source_deleted`, filtered by the seat's client access. The live definition matches migration 20260927u. The page reads it through `apps/media-buyer-cockpit/src/lib/mediaSourceClient.ts` `readMediaSnapshot`.
3. The "Running" and "Off the board" tabs, and the account page `/ads?account=`, only split or filter those same rows (`CockpitPage.tsx`: `isParked` at :1543, the tabs at about :3346, `AccountView` at :3875). The board's Ad Status ("Paused", "Dead Campaign") never adds a row. So a client is in Ads only while one of its campaigns has spent in the last 7 days. A paused or unsettled client drops out a week after its last spend, along with its account page.
4. Build and launch for a client go through `cockpit_build_scope(tag)`. It needs **exactly one ad account among that client's current `cockpit_campaigns` rows** (the live definition matches 20260927r). Otherwise it refuses with "The client ad account is missing or ambiguous". So no client outside the Ads list can have a campaign built, and a client with two current accounts cannot either.
5. The "launching" rule: a client is launching only while an **open top-level "New Client Campaign Launch" task** exists. The worker reads Marketing / ADs and Ads Managment with `subtasks=false` (calculator.ts :2388 and :2980). It feeds the "New client launches" panel (`Onboardings.tsx`), which sits on **Today only** (CockpitPage.tsx :3833), never in Ads.
6. The worker reads closed Ads Managment cards too (`include_closed=true`, :2049). A closed card therefore does not hide a spending campaign. Spend is the gate.

## Every client in scope (33)

Out of scope: the 34 Cancelled clients, the "TEST - Viktor" row (Removed from sheet), "[INTERNAL TEST]" and "Zeiad Playing Account" (a test card, not on the board).

Columns:
- **Client card:** the client's card on Clients - Mahara. The list status is "in progress" for every client; the real state is the card's Client Status field, mirrored in `cockpit_client_onboarding`.
- **Ads cards:** open / closed cards on Ads Managment.
- **Account status:** Meta account_status. 1 = active, 2 = disabled, 3 = unsettled (owes Meta), 9 = grace period, 101 = closed.
- **On Meta:** campaign switches from the 12:14 hourly read, or a Meta GET today.
- **Last spend:** the last day with spend in `cockpit_meta_ad_days`.
- **In Ads today:** a current, non-deleted `cockpit_campaigns` row.

### Active (19)

| Client | Card status (board / registry) | Client card | Ads cards (open/closed) | Ad account(s) and Meta status | On Meta | Last spend | In Ads today | Why, or what is about to happen |
|---|---|---|---|---|---|---|---|---|
| **ARCWANI** ("Arcone") | Active / Active | yes | **0 / 1**: ARCWANI-MAHARA-29\8 was closed on 21 Oct, 16:51 Kuwait | 1034584029438250: **3 unsettled** (Meta GET) | 4 campaigns. 2 are switched on (ARCWANI-MAHARA-29\8 and "Arcwani 1\| Leads \| Sep2026 \| MHM™") and 2 are paused. Nothing delivers. | 9 Oct | **no**. Row retired 17 Oct. | No spend in the window, because the account owes Meta. See below. |
| **Liwan** Limited Construction and Finishing Of Buildings | Active / Active | yes | **3 / 0**: 21\9, 10\9, 20\8 | 1938709086836136 "Liwan Construction": **3 unsettled** (Meta GET) | 7 campaigns. 2 are switched on, **both named "Liwan \|MAHARA\|10\9"**, and 5 are paused. Nothing delivers. | 12 Oct | **no**. Rows retired 10 Oct and 19 Oct. | No spend in the window, because the account owes Meta. Its cards are still open. See below. |
| Joe and Sera Company | Active / **Paused** (the board and registry disagree) | yes | 1 / 1: 11\8 (the campaign still switched on) was closed 21 Oct; the old 12\7 card is open | 955658453671990: **3 unsettled** | 3 campaigns. 1 is switched on (JOE&SERA\|MHARA\|11\8); nothing delivers. | 11 Sep | **no**. No row since the native cutover. | No spend for 6 weeks. The account owes Meta. |
| SAFAD Consultant Engineering | Active / Active | yes | 1 / 0 | 774492648699300: 1 (it was unsettled on 17 Oct) | "Safad \| MAHARA \| 16-8" is switched on and marked delivering at 12:14 | 20 Oct | **no**. Row retired 23 Oct. | Spend in the window was under the 50-cent floor. It comes back on the first sync after it spends. |
| Professional Touch Company | Active / Active | yes | 2 / 0: 29\8 and 9\7 | **none tied**, and none of its accounts is in any Meta read | nothing visible | none in the reads | **no** | No ad account is tied or shared, so there is nothing to show or build. |
| Alkhalil | Active / Active | yes | 1 / 0 | 1649852845764859: **3 unsettled** | 1 campaign, switched on, not delivering | 24 Oct | yes (ALKHALIL- MAHRA-15\9) | **At risk**: unsettled as of today, so it drops out of Ads about 7 days after its last spend. A separate SAR account, 640644143620696, carries Instagram boosts named after Alkhalil's projects. It is not tied on the board and is the cockpit's only launch-watch row today ("spending with no card"). |
| Arcturus Construction | Active / Active | yes | 1 / 0 | 3658852461068269: 1 | Mahara's campaign Arcturus-Mahara-3\9 is **paused**. The account has 125 campaigns and none is switched on with a daily budget. | 20 Oct | yes, until about 27 Oct | **At risk**: paused with nothing running, so it drops out once the window passes 20 Oct. |
| Marble and more | Active / Active | yes | 1 / 1 | 2631767157271939: **3 unsettled**. 1639470257874847: **2 disabled** (integrity) | 1 campaign switched on on each account; nothing delivers | 21 Oct | yes, until about 28 Oct | **At risk**: unsettled. |
| mergestudio.kw | Active / Active | yes | 1 / 0 | 1200680597801129: 1, but the **prepaid balance is used up** | 1 campaign switched on, not delivering | 22 Oct | yes, until about 29 Oct | **At risk**: needs funds added. |
| Ardon | Active / Active | yes | 1 / 0 | 718146936708597 SAR: 1. 1059789685990610 SAR: 1 (no campaigns) | 1 campaign delivering | 24 Oct | yes | |
| Atlantis Contracting | Active / Active | yes | 3 / 1 | 290802986: 1 | 1 delivering (19\10). 7\10 is "Paused" on the board. | 24 Oct | yes (2 rows) | |
| Castello Industries | Active / Active | yes | 2 / 2 | 2140901837311419: **9 grace period**. 1557828282750961: **101 closed** | 1 delivering (19\10). 6\10 is "Paused" on the board. | 24 Oct | yes (2 rows) | Its account warning shows. |
| City Wood | Active / Active | yes | 1 / 0 | 927741509922733: 1. 912269544891805: **101 closed** | 1 delivering | 24 Oct | yes | |
| Ocean Home | Active / Active | yes | 2 / 0 | 568262692064148: 1 | ocean home-mahara-9\9 is delivering | 24 Oct | yes | The card's Ad Status says Paused, so the row shows red: "Board says Paused, still on Meta". |
| Shades Interior Design & General Contracting | Active / Active | yes | 1 / 0 | 762687672022667 SAR: 1 | 1 delivering | 24 Oct | yes | |
| شركة العلا (Al Ola) | Active / Active | yes | 1 / 0 | 1066476902802166: 1 | 1 delivering | 24 Oct | yes | |
| شركة منشآت خالدة (Khalida) | Active / Active | yes | 6 / 0 | 1275190574533155: 1 (nothing switched on). 1839126900588107: 1 | 1 delivering (monshaat-mahara-20\10). 14\10 is "Paused" on the board. | 24 Oct | yes (2 rows) | **Build refused**: its current rows hold two ad accounts, so `cockpit_build_scope` says "ambiguous". |
| مدانة العمرانية (Madana) | Active / Active | yes | 1 / 0 | 2513187079184888: 1 | 1 delivering | 24 Oct | yes | |
| نهوض نجد (Nuhoud Najd) | Active / Active | yes | 1 / 1 | 1326793265986543: 1 | 1 delivering | 24 Oct | yes | |

### Paused (1)

| Client | Card status | Client card | Ads cards | Ad account and status | On Meta | Last spend | In Ads | Why |
|---|---|---|---|---|---|---|---|---|
| AIVE designs | Paused / GHOSTED | yes | 1 / 0 (LEADS-MAHARA-21\6) | 1910040802988539: **3 unsettled** (Meta GET). It is **not in the hourly account read.** | AIVE-mahara - 27\7 switched on; 22\7 paused | none in 60 days | no | Nothing has spent in months, and the account owes Meta. |

### Stopped (3)

| Client | Card status (board / registry) | Client card | Ads cards | Ad account | Meta answer | In Ads |
|---|---|---|---|---|---|---|
| Olivar Design | Stopped / Paused | yes | 1 / 0 | 1923309945035375 | **#200: the owner has not granted ads access**. Access is gone. | no |
| Uvan and Evan | Stopped / Ghosting | yes | 1 / 0 | 1041319501689281 | **#200, access gone** | no |
| شركة كيسان (Kesan) | Stopped / Paused | yes | 1 / 0 | 2441363879610593 | **#200, access gone** | no |

### Ghosting (2)

| Client | Card status | Client card | Ads cards | Ad account | In Ads |
|---|---|---|---|---|---|
| Kazak | Ghosting / SALES TEAM TO CONTACT | yes | none | none | no |
| Prime Project Solutions | Ghosting / SALES TEAM TO CONTACT | yes | none | none | no |

### In onboarding (8; board "Launching", `in_onboarding = true`)

| Client | Card stage | Client card | Ads cards | Launch task | Ad account | In Ads |
|---|---|---|---|---|---|---|
| Alalia.co | Brand Blueprint Booked | yes | none | none | none | no |
| Makers | Brand Blueprint Booked | yes | none | none | none | no |
| SMART INTERIOR (board name شركة مصنع المعادن الهندسية للصناعة) | Brand Blueprint Booked | yes | none | none | none | no |
| Smmim studio | Ready For Launch | yes | none | none | none tied. The 23 Oct Business Manager note keeps an "artist (Smmim)" account for Aziz. | no |
| Qatar Technology | GHOSTED | yes | none | none | 1748440529712852: **1 active, 0 campaigns** (Meta GET). It is **not in the hourly account read.** | no |
| Render | GHOSTED | yes | none | "RENDER - New Client Campaign Launch 🚀" is complete | none | no |
| Ghazzawi.sa | GHOSTED | yes | none | none | none | no |
| Greystone Contracting | GHOSTED | yes | none | none | none | no |

## ARCWANI and Liwan, precisely

**ARCWANI.**
- It is an Active client with an Active card and one ad account, 1034584029438250. Meta says status 3 (unsettled) today.
- It last spent on 9 Oct. On 17 Oct the 7-day window passed that day, so the worker retired ARCWANI-MAHARA-29\8 (`source_deleted_at` 17 Oct). It has had no row since. That means:
  - no Ads row;
  - no `/ads?account=ARCWANI` page, because that page filters the same rows;
  - no Build, because `cockpit_build_scope` finds zero accounts.
- On 21 Oct at 16:51 Kuwait its only ads card was set to complete. That was one ClickUp bulk action: 8 Ads Managment cards share the same closing millisecond, and the cockpit audit log has no row for it. The 8 cards are ARCWANI, Castello ×2, Marble 19/9, Atlantis 13\9, حول العمران, risingnajd 11\5 and Joe & Sera 11\8.
- Its launch task is long complete. One task is still open: "Arcwani | Create clean ad account", status pending, assigned to Muhammed Burhan and Nada, due 17 Oct. The relaunch may therefore come from a **new** ad account that the board does not know yet.
- On Meta, two of its four campaigns are still switched on. They deliver the moment the balance is paid (memory meta-ads-writes: pay first, then edit straight away).

**Liwan.**
- It is an Active client with an Active card and one account, 1938709086836136. Meta says status 3 today.
- It last spent on 12 Oct. Its rows were retired on 10 Oct (Liwan |MAHARA|10\9) and on 19 Oct (21\9).
- Unlike ARCWANI, its ads cards are **still open** (21\9, 10\9, 20\8). The card is not why it vanished. It vanished because the Ads list depends only on spend, and an unsettled account cannot spend.
- Two campaigns are still switched on, and both are named "Liwan |MAHARA|10\9". The worker groups rows by campaign name, so those two would merge into one row when it comes back.
- On 17 Oct its switched-on budgets were flagged as oversized (memory meta-ads-writes). Read the activity log before the balance is paid.

## The CEO's groups, counted

- **In scope:** 33 clients: 19 Active, 8 in onboarding (Launching), 1 Paused, 3 Stopped, 2 Ghosting.
- **ClickUp client card missing:** 0 of 33. Every client has a card on Clients - Mahara. What is missing is the **ads card** or the **launch task**, not the client card.
- **Shown in Ads today:** 14 clients, all Active. Not shown: 19.
- **Active or paused with nothing running, and not in Ads** (the "ARCWANI and Liwan" group): **6**.
  - ARCWANI, Liwan, Joe and Sera, AIVE: all four accounts are unsettled.
  - SAFAD: settled, but under the floor this week.
  - Professional Touch: no ad account at all.
- **In Ads now but nothing delivering, so leaving within about a week:** **4**.
  - Alkhalil and Marble and more: unsettled.
  - Arcturus: paused.
  - mergestudio.kw: prepaid balance used up.
- **Active or paused with no open ads card:** **1** (ARCWANI). Counting the 8 onboarding and the 2 ghosting clients, **11 clients have no open ads card**.
- **In onboarding:** **8**.
  - 3 Brand Blueprint Booked, 1 Ready For Launch, 4 GHOSTED.
  - Only 1 has an ad account tied (Qatar Technology: active and empty).
  - None has an open launch task. There are **0 open "New Client Campaign Launch" tasks** on Marketing / ADs. The newest one is Merge studio's, and it is complete; Blueprint "Send to media" has not created any yet.
  - So the "New client launches" panel on Today shows nothing: its `onboardings` source has 0 rows, and `launchWatch` has 1 row, the off-board boost account.
- **Can build a client campaign in the cockpit today:** 13 clients, the 14 in Ads minus Khalida, whose two accounts make it ambiguous. The other 19 cannot.
- **Account problems among the 33:**
  - **Unsettled, 6 accounts:** ARCWANI, Liwan, Joe and Sera, Alkhalil, Marble 2631…, AIVE.
  - Disabled: Marble 1639….
  - Closed: Castello 1557… and City Wood 9122….
  - Grace period: Castello 2140….
  - Prepaid balance used up: mergestudio.
  - Access gone: Olivar, Uvan and Evan, Kesan.

## Facts the launch desk must not trust blindly

- `cockpit_meta_account_state` covers 26 accounts, the business listing after the 23 Oct clean-up. **AIVE (status 3) and QA Tech (status 1) are readable but missing from it.** A launch must GET `act_X?fields=account_status,disable_reason,currency` itself, and treat a missing state row as "not known", never as fine.
- The board and registry disagree on 6 clients: Joe and Sera, AIVE, Olivar, Uvan and Evan, Kesan, and the two Ghosting clients. Show the card's stage and say where each label comes from.
- About 100 orphan "to do" subtasks (QA Checklist, Tracking Sheets, Facebook Ads Buildout and others) sit under **completed** launch tasks on Marketing / ADs. The launching rule ignores them (`subtasks=false`), and the desk should too.
- Unsettled accounts refuse every write (Meta error 200 / 4841021), pausing included. Their switched-on campaigns go live as soon as the balance is paid. A relaunch rehearsal should list those campaigns first.
