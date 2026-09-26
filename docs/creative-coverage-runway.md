# Creative coverage runway for the Creative Director Cockpit

Status: planning workflow implemented on branch `codex/creative-cadence-calendar`; not deployed or pilot-verified. Aziz asked on 2026-09-24 for a sustainable video cadence and a cockpit view that prevents an approval delay from leaving client ads without a ready challenger.

## Director's daily workflow now implemented

The start-of-day checklist opens `/work` to check creative batches and client approvals. The mid-day checklist prompts a review of live response and an approved challenger. The calendar has a **Next creative batch** panel: choose one active client and schedule one real dated Media/Creative ClickUp task, or fill all active clients with an exact campaign mapping. The card's brief links the existing script, production, internal review, client approval, media-buyer handoff and performance-review steps. It shows the briefing Monday, an approval target seven days later, and an intended first launch window fourteen days later. The director can move the card to another calendar date; ClickUp remains the source of truth.

Each client's auto-plan switch starts off. If the director enables it for an active client with an exact campaign mapping, a Thursday 08:17 Kuwait cron queues the next fortnight's card. A stable client-task-ID/date key and the existing claimed outbox prevent ordinary retries and overlapping drains from creating duplicate cards. The media-buyer backend drains the creative outbox to ClickUp and its fanout classifies the new task. This planning action does not publish ads, contact a client, assert approval, or pause a winner. For an unmapped client, manual single-client planning remains available.

The cockpit's frequency wording now calls frequency a review cue and limits that watch to live ads. It does not label an ad fatigued solely because it crossed 2.5. The Video Pipeline count and client view now recognize the live `internal approved` and `client approved` statuses as director handoffs, distinct from `client review`.

### Script and approval path checked on 24 September

- The buyer's **New creative** request creates one existing Creative Triage record and one ClickUp script/creative request; the first real end-to-end request has not yet been observed through launch and result review.
- The director writes scripts with their own tools, reviews offer, hook, CTA, dialect and factual claims, then obtains client script approval before filming. The live ClickUp script delivery checklist and communication templates both call for this. The older scripting SOP mentions an Ad Scripts Bot, but Aziz's later decision is to keep drafting with their own LLM; this change does not revive that bot.
- A sampled completed script request had only request instructions and an unchecked delivery checklist, and another had only a buyer brief. Completion is not evidence that the task description is the final script. **Script handoff** now shows the description as source only. The director deliberately enters the final text, records where client approval is documented, and confirms it before creating an internal Video Pipeline request.
- The current ClickUp Video Pipeline exposes `internal review`, `internal approved`, `client review` and `client approved` as separate statuses. The batch card links the existing production tasks and previews and records approval source, person and date for each asset. It does not create duplicate production tasks or a second approval state.
- The editor cockpit has a built client review-link flow for video cuts, but this audit did not verify a live client decision or automatic status movement. Client conversation and ClickUp task status remain the operational record. Frame.io is researched and partially coded, but account setup and a real cut are still outstanding; it is not the approval dependency for this cadence.
- Some live static-ad tasks are titled as videos. The batch brief requires explicit links and asset format for two stills; the social Content Calendar is not their production or approval lane. No client message is sent by the planner.

Before using this in production, deploy the creative cockpit backend/site and the media-buyer Convex backend together, then verify one supervised task creation and its appearance on the calendar after fanout. The old `viktor-side-scripts/sync_cockpit.py` is a reference implementation and is not the current drain. The full approved-asset runway and risk colors below remain a later phase because no verified per-asset approval evidence or 7-day comparable ad history is present in the current feed. Until then, the calendar card is a reminder and workflow container, not proof of approved coverage.

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

1. On Monday, group the coming two weeks' concept briefs and choose one video plus two images per client. Record the hypothesis and who supplies footage/proof; reuse an open request where it covers the concept.
2. Write and review the filmed video's final script using the approved offer and Brand DNA. Record explicit client script approval before filming. Link the script task and approval evidence to the batch card.
3. Editors and designers deliver assets to internal review. The director checks brand, Arabic/dialect, offer accuracy, factual proof and format. After internal approval, send the actual previews through the existing client process and keep `client review` separate from `client approved`.
4. Record who approved each video or still, when and where. Only client-approved assets join the reserve. The director hands the next challenger to the media buyer, who launches it beside a current winner and records the ad ID.
5. Review after enough delivery, typically over 7-14 days at this budget. Replace a weak ad when rising repeat exposure is accompanied by worse engagement/qualified lead economics, checking other causes. Keep a healthy ad live.
6. Each Friday, check that every active client still has the minimum approved reserve and the next two-week batch is already in progress.

## What the current cockpit can and cannot do

Before this branch, the source described frequency above 2.5 as burnout and omitted `internal approved` and `client approved` from the cockpit's stage summary, even though those statuses exist in ClickUp. This branch corrects the language and stage summary. The `ads` mirror still has frequency, CTR and CPL point values, not an equal-period deterioration comparison; no approved-asset reserve or explicit image-ad lane is calculated yet.

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
