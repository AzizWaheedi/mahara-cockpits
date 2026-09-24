# Creative coverage runway for the Creative Director Cockpit

Status: planning workflow implemented on branch `codex/creative-cadence-calendar`; not deployed or pilot-verified. Aziz asked on 2026-09-24 for a sustainable video cadence and a cockpit view that prevents an approval delay from leaving client ads without a ready challenger.

## Director's daily workflow now implemented

The start-of-day checklist opens `/work` to check creative batches and client approvals. The mid-day checklist prompts a review of live response and an approved challenger. The calendar has a **Next creative batch** panel: choose one active client and schedule one real dated Media/Creative ClickUp task, or fill all active clients with an exact campaign mapping. The card's brief contains the production, internal review, client approval, media-buyer handoff and performance-review steps. It shows the briefing Monday, an approval target seven days later, and an intended first launch window fourteen days later. The director can move the card to another calendar date; ClickUp remains the source of truth.

Each client's auto-plan switch starts off. If the director enables it for an active client with an exact campaign mapping, a Thursday 08:17 Kuwait cron queues the next fortnight's card. A stable client-task-ID/date key and a claimed outbox prevent ordinary retries and overlapping syncs from creating duplicate cards. The bridge only creates planning tasks. It does not publish ads, contact a client, assert approval, or pause a winner. For an unmapped client, manual single-client planning remains available.

The cockpit's frequency wording now calls frequency a review cue and limits that watch to live ads. It does not label an ad fatigued solely because it crossed 2.5.

Before using this in production, deploy both the cockpit backend/site and the updated `viktor-side-scripts/sync_cockpit.py` on the actual sync host, then verify one supervised task creation and its appearance on the calendar. The full approved-asset runway and risk colors below remain a later phase because no verified per-asset approval evidence or 7-day comparable ad history is present in the current feed. Until then, the calendar card is a reminder and workflow container, not proof of approved coverage.

## Operating rule

For a USD 30-50/day client, the default *launch opportunity* is one materially new concept roughly each week, alternating video and image when both work. Produce **one video plus two distinct still-image concepts per client every two-week sprint**, preferably as a batch. That is two videos and four images per month. Do not automatically pause or replace a winner on its birthday.

Start with a live set of about three ads at USD 30/day or three to four at USD 50/day. Maintain at least one approved unused video and two approved unused images. A client whose stills consistently fail on qualified leads can move to a video-only exception: produce **two videos together every two weeks**, release at most one new challenger per week, and keep the other approved. This is four videos/month and should be assigned only where volume and capacity justify it, not to all clients by default. If approvals take more than two weeks, increase the approved reserve to cover the measured 90th-percentile approval + production delay.

This is a Mahara capacity policy to pilot. It is not a Meta-set refresh interval or a promise that an ad can never tire. The operational guarantee sought is **no scheduled launch without an approved replacement available**, while a performing winner continues.

## Why batching wins over serial weekly video

One video each week and two every two weeks have the same monthly output. A two-week batch lets the director submit concepts together, shoot/edit together, and obtain one client sign-off before a video is urgently needed. The release rhythm can still be weekly. With approximately 16 active rostered clients, a mandatory video per client per week would mean about 64 videos/month; the default above means about 32 plus stills. Count actual ad-spending clients and editor capacity before setting team-wide quotas.

Do not call crops, caption swaps or translated exports new concepts. Concepts differ by proof, audience objection, offer, visual or spokesperson. Use real project assets and client-approved claims; AI imagery must not imply that a fictional project was completed.

## Cockpit: one coverage row per active, mapped client

Place a compact **Creative runway** section above the Video Pipeline on Middle of the day, with drill-down on the Client page. Each row shows:

- Exact ClickUp client task ID/name, active spend tier and last sync age.
- Current live Meta ads by format and their last-seven-day spend share. Keep the current winner visible.
- Client-approved, unused assets by format, with approval timestamp, source link and planned first-use date. Distinguish **awaiting client review** from approved. A rendered file or a completed edit is not approval.
- Next planned challenger date, planned format/concept, and **approved runway in days**.
- Waiting-on owner: Creative Director, editor, client or media buyer, with oldest-blocked age and a link to the exact ClickUp task.
- Performance evidence: seven-day reach/frequency, CTR, qualified lead cost and lead-to-booking where attribution is reliable, compared with the preceding seven days. If the feed is stale or unmapped, show **unknown**, not green.

Default traffic lights (pilot, calibrate on actual turnaround):
- **Green:** at least two weeks of approved release slots covered and no overdue approval or production blocker.
- **Amber:** 7-13 days of approved runway, or the next batch is waiting in client review near its needed date.
- **Red:** fewer than seven days of runway, the next planned release has no approved asset, or a live client has no usable creative.
- **Unknown:** client/ad mapping, ad metrics, asset approval evidence or source freshness is missing. Never score missing data as zero risk.

The row should tell the director the *next action*: brief new angle, chase named approval, hand an approved asset to the media buyer, or leave a healthy winner running. It must not automatically publish, pause or message a client.

## Canonical records and sync

Reuse the existing ClickUp client roster, Video Pipeline and Media/Creative work as production truth. Give each ad concept one linked ClickUp task and identify its format, concept ID, intended ad account/client ID, stage, due date, approved asset URL, approval evidence/time and planned launch date. The image lane must be represented explicitly; social Content Calendar posts are not ad assets.

The cockpit's Convex mirror may store these fields for reading, but approval is counted only from an explicit client-approved field/status with an actual asset link. Avoid a second manual cockpit approval state that can disagree with ClickUp. The media buyer records the Meta ad ID and first live date once launched. Preserve client-task and ad-account IDs rather than matching only by client name.

The current `convex/schema.ts` `ads` row has optional frequency but no period/history and the historical Creative Triage ad table has no reach/frequency. Extend the media-buyer feed to provide comparable seven-day and preceding-seven-day metrics plus freshness and format. Do not infer media type from an ad name or thumbnail. A frequency of 2.5 alone is not a fatigue verdict.

## Workflow in the cockpit

1. On Monday, group the coming two weeks' concept briefs and choose one video plus two images per client. Record the hypothesis and who supplies footage/proof.
2. On the same day, send the monthly approval batch through the existing client process at least two weeks before any planned use. Approval delays appear on the runway row by client and owner.
3. Editors deliver to internal review; the director checks brand, Arabic/dialect, offer accuracy, factual proof and format. Only then send for client review.
4. The client-approved record joins the reserve. The director selects the next challenger and hands it to the media buyer. The media buyer launches it beside a current winner and records the ad ID.
5. Review after enough delivery, typically over 7-14 days at this budget. Replace a weak ad when rising repeat exposure is accompanied by worse engagement/qualified lead economics, checking other causes. Keep a healthy ad live.
6. Each Friday, check that every active client still has the minimum approved reserve and the next two-week batch is already in progress.

## What the current cockpit can and cannot do

Verified from the current GitHub main source on 2026-09-24:
- `convex/creative.ts` uses a hard-coded `FATIGUE_FREQUENCY = 2.5` and describes frequency alone as burnout. Its `fatiguing` leaderboard can include ads not verified as live.
- `DashboardPage.tsx` says that being below 2.5 means no replacements are needed.
- The Video Pipeline stages show `client review`, but no explicit client-approved reserve stage or image-ad lane.
- The `ads` mirror has frequency, CTR and CPL point values, not an equal-period deterioration comparison.

These are product gaps to fix before calling the new panel a fatigue detector. The initial release should present the reserve/approval queue honestly even if the performance comparison has to show unknown.

## Acceptance checks

- A completed edit in client review does not count as approved. A client-approved image and video count only for their exact client/account.
- Removing or changing approval evidence removes it from the reserve. Launching an asset moves it out of unused reserve without losing history.
- An unmapped client, stale Meta feed, missing frequency or missing approval record displays unknown, not green.
- A high-frequency ad with stable qualified outcomes is not labelled fatigued. A low-frequency ad with worsening qualified outcomes is still reviewed for other causes.
- Approval delay turns a row amber/red *before* the next planned launch, and the media buyer can open the approved asset without waiting for the director to locate a file.
- No automatic campaign edits, client messages or production quotas are switched on by the cockpit.
- Pilot with 2-3 accounts of different spend/audience sizes and compare approved-runway coverage, launch gaps, staff load and qualified consultation outcomes for four weeks.

## Research and related records

- Mahara shared playbook: https://github.com/AzizWaheedi/mahara-context/blob/main/tools/client-results-consistency/PLAYBOOK.md
- Meta Blueprint creative diversification: https://www.facebookblueprint.com/student/activity/707402
- Meta Blueprint creative testing: https://www.facebookblueprint.com/student/path/253050-ad-creative-testing-course
- Meta for Business Reels guidance (images eligible, purpose-made vertical video favored in its Reels tests): https://www.facebook.com/business/ads/facebook-instagram-reels-ads
