---
name: launch_campaign
description: Takes a campaign brief and launches a complete Meta Ads campaign (campaign → ad set → creative → ad), enforcing naming conventions, running a pre-launch checklist, and producing a human-approved Launch Draft before any creation happens.
triggers:
  - "launch campaign"
  - "create campaign"
  - "new campaign"
  - "launch a meta ad"
  - "set up a campaign"
  - "build a campaign"
  - "create a meta campaign"
  - "start a new campaign"
  - "campaign brief"
  - launch_campaign
---

# Launch Campaign

## How to Call Meta Ads Tools

Viktor calls tools by writing Python scripts that use the generated SDK. All Meta Ads MCP functions are available at `sdk/tools/mcp_meta_ads.py`. Read that file for the full list of available functions and their parameters.

**Common pattern:**

```python
import asyncio
from sdk.tools.mcp_meta_ads import meta_ads_get_insights

async def main():
    result = await meta_ads_get_insights(
        account_id="act_XXXXXXXXX",
        date_preset="last_7d",
        fields=["spend", "impressions", "clicks", "actions", "cost_per_action_type"]
    )
    print(result)

asyncio.run(main())
```

Run scripts with: `uv run python script.py`

**Key functions:**
- `meta_ads_get_insights(...)` — performance data for any object (account/campaign/ad set/ad)
- `meta_ads_list_campaigns(account_id, ...)` — list campaigns
- `meta_ads_create_campaign(...)` — create campaign (returns draft for approval)
- `meta_ads_create_ad_set(...)` — create ad set
- `meta_ads_create_ad_creative(...)` — create creative
- `meta_ads_create_ad(...)` — create ad

All write operations create **drafts** requiring human approval via `submit_draft(draft_id)`.

All monetary values are in **cents** (divide by 100 for dollars).

Refer to `sdk/tools/mcp_meta_ads.py` for the complete function list with parameters and docstrings.

## Purpose

This skill takes a campaign brief and creates a complete Meta Ads campaign from scratch: campaign → ad set → creative → ad. It enforces naming conventions from `account_conventions`, runs a pre-launch checklist, and produces a structured Launch Draft for human review before a single API call executes.

All write operations are drafts until explicitly approved. Viktor never auto-launches.

## When to Use This Skill

- You have creatives ready and want to push a new test campaign live
- You are launching a Winners campaign to scale a proven concept
- You need to build an ASC (Advantage+ Shopping) campaign
- You are setting up a lead gen or awareness campaign
- You want to duplicate a campaign structure for a new vertical or audience

## Required Inputs

Before execution, collect:

- **Account:** Which ad account (from `account_conventions` roster)
- **Campaign type:** Creative Testing / Winners / ASC / Lead Gen / Awareness / Engagement
- **Objective:** What are we optimizing for? (conversions, leads, traffic, etc.)
- **Budget:** Daily or lifetime? Amount?
- **Bid strategy:** Lowest cost / Cost cap / Bid cap?
- **Audience:** Cold / warm / retargeting? Existing audience or build new?
- **Placements:** Advantage+ Placements or manual selection?
- **Creatives:** Asset list — images/videos, headlines, primary text, CTAs, destination URL
- **Flight dates:** Start date (and end date if lifetime budget)
- **UTM parameters:** Tracking template or UTM string for destination URL

If any input is missing, ask before proceeding to the Launch Draft.

---

## Execution Model

### Step 1: Load Account Configuration

Read `account-conventions/SKILL.md` and extract for the target account:
- `ad_account_id` (format: act_XXXXXXXXX)
- `naming_convention` (campaign, ad set, ad level patterns)
- `pixel_id` and `custom_conversion_ids`
- `kpi_config` (primary KPI, CPA/ROAS targets, bid cap ceilings)
- `maturity_level` (affects structural guidance)
- `default_placements` and `targeting_exclusions`

Also read `account-maturity-methodology/SKILL.md` to confirm the appropriate campaign model for this account's maturity level.

### Step 2: Determine Campaign Type and Apply Template

Match the user's brief to one of the five campaign types. Load the corresponding template from `references/campaign_templates.md`:

| Brief Signals | Campaign Type |
|--------------|---------------|
| "test new creatives," "creative test," "new concepts" | Creative Testing (ABO) |
| "scale winners," "proven creative," "post ID," "social proof" | Winners (CBO) |
| "advantage+," "ASC," "blended prospecting + retargeting" | ASC / Advantage+ |
| "lead form," "collect leads," "lead ads" | Lead Generation |
| "brand awareness," "video views," "reach," "engagement" | Awareness / Engagement |

Apply the structural rules for that campaign type (budget type, CBO vs ABO, creative count, bid strategy defaults).

### Step 3: Collect and Validate the Brief

Gather all inputs. For each field, validate:

- Budget in cents (e.g., $50/day = 5000). Flag if budget is below $20/day per ad set for testing campaigns.
- Bid cap: must be >= 1.5x historical average CPA for the account (from account-conventions KPI config). Flag if lower.
- Audience size: for cold audiences, warn if estimated reach < 1M. For retargeting, note if audience is < 10K (learning phase risk).
- Creative count: for Creative Testing campaigns, flag if fewer than 5 ads or more than 20.
- Dynamic creative: confirm with user if `is_dynamic_creative: true` is intended. Note this cannot be changed after ad set creation.
- Day parting: if requested, confirm lifetime budget is being used (daily budget is incompatible with day parting).
- CBO + ad set budgets: if CBO is enabled at campaign level, confirm no ad set-level budgets are set.

### Step 4: Apply Naming Convention

Generate names for each object using the naming convention from account-conventions.

Typical pattern:
```
Campaign: {ACCOUNT_PREFIX}_{OBJECTIVE}_{TYPE}_{AUDIENCE}_{DATE}
Ad Set:   {CAMPAIGN_PREFIX}_{AUDIENCE_DETAIL}_{BUDGET}_{DATE}
Ad:       {AD_SET_PREFIX}_{FORMAT}_{CONCEPT}_{VARIANT}_{DATE}
```

Example (Viktor):
```
Campaign: VIK_CONV_CRT_COLD_2026-03-31
Ad Set:   VIK_CONV_CRT_COLD_BROAD_50D_2026-03-31
Ad:       VIK_CONV_CRT_COLD_BROAD_VID_DEMO_V1_2026-03-31
```

If the account has no naming convention configured in account-conventions, use this default structure and flag that a convention should be added to the config.

### Step 5: Run Pre-Launch Checklist

Before generating the Launch Draft, validate every item in `references/launch_checklist.md`.

Present checklist results as:

```
Pre-Launch Checklist
====================
[PASS] Pixel is firing on destination URL (verified via pixel helper or recent events)
[PASS] Custom conversion is active and receiving events
[PASS] Tracking template / UTM parameters set
[PASS] Cold audience estimated reach > 1M
[PASS] Exclusions set (past purchasers, current customers)
[WARN] No creative refresh since last campaign -- verify assets are new
[FAIL] Bid cap below 1.5x historical CPA -- recommend raising from $45 to $65

Checklist result: PASS WITH WARNINGS (1 warn, 1 fail)
```

If any item is FAIL, block launch and explain what needs to be resolved. WARN items are flagged but do not block. User can override a FAIL with explicit acknowledgment ("I acknowledge the bid cap is low, proceed").

### Step 6: Generate Launch Draft

Produce the full Launch Draft showing every parameter before execution:

```
LAUNCH DRAFT -- Pending Approval
=================================
Account: {account_name} ({ad_account_id})
Campaign Type: {type}
Pre-Launch Checklist: {PASS / PASS WITH WARNINGS / BLOCKED}

--- CAMPAIGN ---
Name:        {generated name}
Objective:   {OUTCOME_SALES / OUTCOME_LEADS / etc.}
Status:      PAUSED (activate manually after review)
Buying Type: AUCTION
Special Ad Category: NONE (or HOUSING / CREDIT / EMPLOYMENT if applicable)
CBO Enabled: {true/false}
Daily Budget (if CBO): ${amount} ({amount_cents} cents)

--- AD SET ---
Name:              {generated name}
Optimization Goal: {OFFSITE_CONVERSIONS / LEADS / etc.}
Billing Event:     IMPRESSIONS
Bid Strategy:      {LOWEST_COST_WITHOUT_CAP / COST_CAP / LOWEST_COST_WITH_BID_CAP}
Bid Amount:        ${amount} (if applicable)
Daily Budget:      ${amount} ({amount_cents} cents) [ABO only]
Start Time:        {ISO 8601}
End Time:          {ISO 8601 or "None -- ongoing"}
Targeting:
  - Geo: {locations}
  - Age: {min}-{max}
  - Gender: {all/male/female}
  - Interests: {list or "None -- broad"}
  - Custom Audiences: {list or "None"}
  - Exclusions: {list}
  - Audience Size Est: {range}
Placements:        {Advantage+ / Manual: Feed, Reels, Stories, etc.}
Dynamic Creative:  {true/false}
Day Parting:       {schedule or "None"}

--- CREATIVE ---
(Repeat per unique creative)
Creative Name:  {generated name}
Format:         {SINGLE_IMAGE / VIDEO / CAROUSEL / COLLECTION}
Image/Video:    {asset reference or upload required}
Headline:       {text}
Primary Text:   {text}
Description:    {text or "None"}
CTA Button:     {LEARN_MORE / SIGN_UP / etc.}
Destination URL: {url}
Tracking:       {UTM string}

--- AD ---
Name:    {generated name}
Status:  PAUSED
Creative: {creative name above}
Ad Set:  {ad set name above}

--- API CALL SEQUENCE ---
1. create_campaign       -- creates campaign object
2. create_ad_set         -- creates ad set linked to campaign
3. upload_ad_image       -- uploads image asset (if not already in library)
   OR upload_ad_video    -- uploads video asset
4. create_ad_creative    -- assembles creative from assets
5. create_ad             -- links creative to ad set
6. [Optional] set_ad_set_schedule -- applies day parting if configured

IMPORTANT: Campaign launches in PAUSED status. You must manually activate in Ads Manager or confirm below to launch active.
```

**Checkpoint: Present Launch Draft. Do NOT proceed until user explicitly approves.**

Ask: "Does everything look correct? Type APPROVE to proceed with creation, or tell me what to change."

### Step 7: Execute in Order

On approval, write and run a Python script that executes the creation sequence. Each step captures IDs needed by subsequent steps.

```python
import asyncio
from sdk.tools.mcp_meta_ads import (
    meta_ads_create_campaign,
    meta_ads_create_ad_set,
    meta_ads_upload_ad_image,
    meta_ads_create_ad_creative,
    meta_ads_create_ad,
)

async def launch():
    # Step 1: Create campaign
    campaign = await meta_ads_create_campaign(
        account_id="act_XXXXXXXXX",
        name="{campaign_name}",
        objective="OUTCOME_SALES",
        status="PAUSED",
        special_ad_categories=[],
        daily_budget=5000,  # $50/day in cents
    )
    campaign_id = campaign["id"]
    print(f"Campaign created: {campaign_id}")

    # Step 2: Create ad set
    ad_set = await meta_ads_create_ad_set(
        account_id="act_XXXXXXXXX",
        campaign_id=campaign_id,
        name="{ad_set_name}",
        optimization_goal="OFFSITE_CONVERSIONS",
        billing_event="IMPRESSIONS",
        bid_strategy="LOWEST_COST_WITHOUT_CAP",
        daily_budget=5000,
        targeting={"geo_locations": {"countries": ["US"]}, "age_min": 25, "age_max": 55},
        start_time="2026-04-01T00:00:00-0400",
    )
    ad_set_id = ad_set["id"]
    print(f"Ad set created: {ad_set_id}")

    # Step 3: Upload image (if needed)
    image = await meta_ads_upload_ad_image(
        account_id="act_XXXXXXXXX",
        # base64 encoded bytes or use upload_ad_video for video
    )
    image_hash = image["hash"]

    # Step 4: Create creative
    creative = await meta_ads_create_ad_creative(
        account_id="act_XXXXXXXXX",
        name="{creative_name}",
        object_story_spec={...},  # assembled from brief
        url_tags="{UTM string}",
    )
    creative_id = creative["id"]

    # Step 5: Create ad
    ad = await meta_ads_create_ad(
        account_id="act_XXXXXXXXX",
        ad_set_id=ad_set_id,
        name="{ad_name}",
        creative={"creative_id": creative_id},
        status="PAUSED",
    )
    ad_id = ad["id"]
    print(f"Ad created: {ad_id}")

asyncio.run(launch())
```

Run with: `uv run python launch_script.py`

**Write operations return drafts** — Viktor will present each draft for user approval before executing. If any step fails, stop immediately and report the error with full API response. Do not attempt cleanup of partially created objects unless the user asks.

Step 4: create_ad_creative
SDK call: `meta_ads_create_ad_creative()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  name: {creative_name}
  object_story_spec: {assembled from brief}
  url_tags: {UTM string}

→ Capture: creative_id

Step 5: create_ad
SDK call: `meta_ads_create_ad()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  ad_set_id: {ad_set_id from Step 2}
  name: {ad_name}
  creative: {id: creative_id}
  status: PAUSED

→ Capture: ad_id

Step 6 (optional): set_ad_set_schedule
SDK call: `meta_ads_set_ad_set_schedule()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  ad_set_id: {ad_set_id}
  schedule: {day_parting spec}
```

If any step fails:
- Stop immediately. Do not continue to next step.
- Report the error with the full API response.
- Do not attempt to clean up partially created objects unless the user asks.
- Note the IDs of any objects that were successfully created so the user can delete them manually if needed.

### Step 8: Verify Launch

After all steps complete, read back each created object to confirm:

```
SDK call: `meta_ads_get_campaign()` (from `sdk/tools/mcp_meta_ads`)
SDK call: `meta_ads_get_ad_set()` (from `sdk/tools/mcp_meta_ads`)
SDK call: `meta_ads_get_ad()` (from `sdk/tools/mcp_meta_ads`)
```

Confirm:
- Campaign exists with correct objective and status
- Ad set is linked to correct campaign with correct targeting
- Creative is correctly assembled
- Ad is linked to correct ad set and creative

If any verification fails (object not found, wrong parameters), flag immediately.

### Step 9: Launch Report

Output a final launch report:

```
LAUNCH REPORT
==============
Account: {name}
Date: {today}

Objects Created:
| Object | Name | ID | Status |
|--------|------|----|--------|
| Campaign | {name} | {id} | PAUSED |
| Ad Set | {name} | {id} | PAUSED |
| Creative | {name} | {id} | Active |
| Ad | {name} | {id} | PAUSED |

Ads Manager Links:
- Campaign: https://www.facebook.com/adsmanager/manage/campaigns?act={account_id_digits}&selected_campaign_ids={campaign_id}
- Ad Set: https://www.facebook.com/adsmanager/manage/adsets?act={account_id_digits}&selected_adset_ids={ad_set_id}

Pre-Launch Checklist: {status}
Naming Convention Applied: {yes/no}

Next Steps:
1. Review in Ads Manager using the links above
2. Preview ads: run meta_ads_get_ad_previews for each ad ID
3. Activate when ready: update campaign + ad set status to ACTIVE
4. Set a 72-hour check-in reminder to review initial delivery and CPM
5. If learning phase: expect 1-7 days before performance stabilizes (target 50 conversions/week per ad set)
```

---

## Campaign Type Quick Reference

See `references/campaign_templates.md` for full specs per type.

| Type | Budget | CBO | Bid Strategy | Creative Count | Key Constraint |
|------|--------|-----|-------------|----------------|----------------|
| Creative Testing | ABO | No | Cost Cap | 5-10 ads/concept, 15-20 total | 1 ad set per concept |
| Winners | CBO | Yes | Lowest Cost | 3-6 proven ads, post IDs | Reuse ad IDs to preserve social proof |
| ASC | Lifetime or Daily | N/A (ASC auto-manages) | Highest Value | 10+ assets recommended | Catalog required for DPA blend |
| Lead Gen | ABO or CBO | Either | Cost Cap or Lowest | 3-5 variations | Lead form must be pre-approved |
| Awareness | Lifetime | No | CPM / Lowest Cost | 3-5 video assets | Reels/video placements preferred |

---

## Technical Notes

- Monetary values are always in **cents**. $50 = 5000. $1,000 = 100000.
- Account ID format: `act_XXXXXXXXX` (include the `act_` prefix).
- `is_dynamic_creative: true` must be set at ad set creation. Cannot be changed afterward.
- Day parting requires lifetime budget on the ad set. Daily budget campaigns cannot use day parting.
- CBO (campaign budget optimization): when enabled at campaign level, never set `daily_budget` on individual ad sets.
- Ad status: always launch as PAUSED. User activates manually after final Ads Manager review.
- For Winners campaigns using the post ID method: use existing ad IDs to preserve social proof (likes, comments, shares). Do not create new creatives for proven concepts.

---

## Reference Files

- `references/campaign_templates.md` -- Full template specs for each campaign type (structural rules, targeting defaults, bid strategy guidance)
- `references/launch_checklist.md` -- Pre-launch validation checklist with pass/fail criteria
