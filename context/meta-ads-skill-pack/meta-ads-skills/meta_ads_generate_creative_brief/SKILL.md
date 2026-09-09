---
name: generate_creative_brief
description: Action skill that generates creative testing plans and concept briefs for Meta Ads. Based on current performance data, produces prioritized creative concepts, hook strategies, format recommendations, and testing schedules. Uses creative-strategy-methodology to inform recommendations.
triggers:
  - "generate creative brief"
  - "creative brief"
  - "new ad concepts"
  - "creative testing plan"
  - "what ads should I make"
  - "creative ideas"
  - "ad concepts"
  - "creative calendar"
---

# Generate Creative Brief

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

Produce actionable creative briefs and testing plans for Meta Ads campaigns. This skill bridges the gap between performance data (what is working, what is fatigued, what is missing) and creative production (what to make next). It generates prioritized creative concepts across multiple categories, recommends specific hook strategies for each, builds a weekly testing calendar, and outputs individual concept briefs ready to hand off to a creative team or freelancer.

This skill is typically run after analyze_creative has surfaced fatigue alerts and format gaps, but it can also be run standalone when the team needs fresh creative direction.

## When to Use

- After analyze_creative identifies fatigue or format gaps (most common trigger)
- At the start of a creative production sprint
- When the team asks "what ads should we make next?"
- When launching a new campaign and need initial creative concepts
- Monthly creative planning sessions
- When entering a new market, audience segment, or product vertical
- When creative win rate drops below 10% (concepts need to change, not just execution)

## Dependencies

| Skill | Why It's Needed |
|-------|----------------|
| `account_conventions` | Account config: KPI targets, creative config (testing framework, volume targets, active types), naming conventions |
| `creative_strategy_methodology` | Concept categories, hook frameworks, format guidelines, testing frameworks, volume requirements |
| `account_maturity_methodology` | Maturity determines creative sophistication expectations and testing velocity |

---

## Step 0: Load Dependencies

1. **Read `account-conventions/SKILL.md`** and extract for the target account:
   - `ad_account_id`, `currency`, `timezone`
   - `kpi_config` (primary KPI, targets -- used for success criteria in briefs)
   - `creative_config`:
     - `testing_framework` (Faris method, 3:2:2, DCT, or custom)
     - `weekly_creative_volume_target` (number of new ads per week)
     - `creative_types_active` (which formats are currently running: video, static, carousel, UGC, etc.)
     - `concept_rotation` (if configured -- active concept themes)
   - `naming_conventions.ad` (to align brief naming with account conventions)
   - `capabilities.campaign_types_active`
   - `maturity_level`
   - `data_source.method`

2. **Read `creative-strategy-methodology/SKILL.md`** and load:
   - Complete concept category framework (Section 5):
     - Social Proof / Testimonial
     - Founder Story / Behind the Scenes
     - UGC (User Generated Content)
     - Product Demo / Feature Walkthrough
     - Comparison / Us vs Them
     - Educational / How-To
     - Problem / Solution
     - Pain Point Agitation
     - Seasonal / Timely / Newsjacking
     - Transformation / Before-After
   - Hook strategy framework (Section 3):
     - iMessage hook
     - Compliment hook
     - Trend hook
     - Exaggeration hook
     - Comparison hook
     - Pain point hook
     - Oddly-satisfying hook
     - Question hook
     - Statistic hook
     - Curiosity gap hook
   - Format guidelines: optimal aspect ratios, durations, platform specs
   - Testing framework details for the account's chosen method
   - Win rate benchmarks and volume requirements by spend level

3. **Read `account-maturity-methodology/SKILL.md`** and determine:
   - Creative velocity expectations by maturity:
     - **Nascent:** 3-5 new ads/week, focus on finding first winners, test broad concepts
     - **Developing:** 5-10 new ads/week, double down on winning concepts, test more formats
     - **Established:** 10-20 new ads/week, systematic concept rotation, multi-format production
     - **Advanced:** 20+ new ads/week, full creative engine with iterative testing, UGC pipeline

**Validation gate:** If `creative_config` is missing or empty, use defaults from creative-strategy-methodology. If KPI targets are not set, briefs will lack success criteria -- flag this to the user.

---

## Step 1: Current Creative Inventory

Assess what is currently running to identify what is working, what is fatigued, and what is absent.

### Active Creative Pull

```
SDK call: `meta_ads_list_ads()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  fields:
    - id
    - name
    - status
    - effective_status
    - creative
    - created_time
  filtering:
    - field: "effective_status"
      operator: "IN"
      value: ["ACTIVE"]
```

### Creative Details (for format and asset identification)

```
SDK call: `meta_ads_list_ad_creatives()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  fields:
    - id
    - name
    - title
    - body
    - call_to_action_type
    - image_url
    - video_id
    - thumbnail_url
    - object_type
    - asset_feed_spec
```

### Performance Data (for identifying winners and losers)

```
SDK call: `meta_ads_get_insights()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  level: "ad"
  time_range: "last_14d"
  fields:
    - ad_id
    - ad_name
    - impressions
    - spend
    - clicks
    - ctr
    - conversions
    - cost_per_action_type
    - actions
    - action_values
    - video_p25_watched_actions
    - video_p50_watched_actions
    - video_p75_watched_actions
    - video_play_actions
```

### CSV Fallback

If data_source.method = "csv":
1. Ad-level export, last 14 days, with columns: Ad Name, Impressions, Spend, CTR, CPA, ROAS, Video Plays, ThruPlays
2. Ad creative export with format and asset info
3. Save to `{csv_import_path}` and confirm

### Build Inventory Map

From the data, construct:

| Ad Name | Format | Concept | Days Active | Spend | CPA | CTR | Hook Rate | Status |
|---------|--------|---------|-------------|-------|-----|-----|-----------|--------|
| Parse from naming convention | Video/Static/Carousel/UGC | Parse concept token | From created_time | Last 14d | vs target | vs avg | If video | Winner/Solid/Underperformer/Fatigued |

Classify each ad:
- **Winner:** CPA <100% of target, CTR above account average
- **Solid:** CPA 100-120% of target, stable metrics
- **Underperformer:** CPA >120% of target
- **Fatigued:** Was a winner but CTR declining >10% WoW or frequency >2.5 (prospecting)
- **New/Testing:** <7 days old, insufficient data

---

## Step 2: Gap Analysis

Compare current inventory to the ideal creative portfolio.

### Format Coverage

| Format | Recommended % of Spend | Actual % of Spend | Active Ads | Gap |
|--------|----------------------|-------------------|-----------|-----|
| Short-form video (9:16, <30s) | 40% | ? | ? | +/- |
| UGC video | 25% | ? | ? | +/- |
| Static image (1:1) | 15% | ? | ? | +/- |
| Carousel | 10% | ? | ? | +/- |
| Long-form video (16:9, 60s+) | 5% | ? | ? | +/- |
| Other | 5% | ? | ? | +/- |

Compare actual distribution to `creative_config.creative_types_active` and flag underrepresented formats.

### Concept Coverage

Map active concepts against the full concept category list from creative-strategy-methodology:

| Concept Category | Active Ads | % of Spend | Winning? | Coverage |
|-----------------|-----------|-----------|----------|---------|
| Social Proof / Testimonial | ? | ? | ? | Covered / Gap |
| Founder Story | ? | ? | ? | Covered / Gap |
| UGC | ? | ? | ? | Covered / Gap |
| Product Demo | ? | ? | ? | Covered / Gap |
| Comparison / Us vs Them | ? | ? | ? | Covered / Gap |
| Educational / How-To | ? | ? | ? | Covered / Gap |
| Problem / Solution | ? | ? | ? | Covered / Gap |
| Pain Point Agitation | ? | ? | ? | Covered / Gap |
| Seasonal / Timely | ? | ? | ? | Covered / Gap |
| Transformation / Before-After | ? | ? | ? | Covered / Gap |

### Angle Freshness

For covered concepts, check:
- How many unique angles/hooks exist per concept?
- Are all angles using the same hook type? (diversity issue)
- When was the most recent ad launched per concept? (staleness check)

### Gap Priority Ranking

Rank gaps by potential impact:
1. **High-spend format gaps** (underrepresented format that dominates winning accounts)
2. **Missing concept categories** (untested angles that could unlock new audiences)
3. **Fatiguing winner replacements** (winning concepts nearing fatigue need fresh executions)
4. **Hook diversity gaps** (all ads use the same hook type)

---

## Step 3: Concept Generation

Generate 3-5 creative concepts based on the gap analysis. Each concept should fill a specific gap identified in Step 2.

### Concept Development Framework

For each concept, define:

1. **Concept category** (from the framework list)
2. **Target audience** (who is this ad speaking to?)
3. **Key insight** (what human truth or pain point does this tap into?)
4. **Key message** (the single thing the viewer should remember)
5. **Proof point** (what makes this credible? data, testimonial, demo, comparison)
6. **Emotional register** (humor, urgency, aspiration, empathy, curiosity, FOMO)
7. **Format recommendation** (video, static, carousel, UGC)
8. **Aspect ratio** (9:16 for Stories/Reels, 1:1 for Feed, 4:5 for Feed)
9. **Duration** (if video: <15s, 15-30s, 30-60s, 60s+)
10. **Placement fit** (Feed, Stories, Reels, Search, all)

### Concept Prioritization

Rank concepts by:
- **Gap severity** (does it fill a critical missing category?)
- **Proximity to winners** (is it a variant on a proven concept? higher confidence)
- **Production effort** (low/medium/high -- lower effort gets priority for quick wins)
- **Audience reach potential** (does it appeal to a broader or niche segment?)

---

## Step 4: Hook Strategy per Concept

For each concept, recommend 2-3 specific hook strategies. The hook is the first 1-3 seconds of a video or the primary visual/headline of a static ad. It determines whether the viewer stops scrolling.

### Hook Selection Logic

Match hooks to concepts based on proven combinations:

| Concept Category | Best Hook Types | Why |
|-----------------|-----------------|-----|
| Social Proof / Testimonial | Compliment hook, Statistic hook | Social validation grabs attention |
| Founder Story | Question hook, Curiosity gap | Personal stories need a compelling open |
| UGC | iMessage hook, Trend hook | Native-feeling hooks outperform polished |
| Product Demo | Oddly-satisfying hook, Comparison hook | Visual hooks work best for demos |
| Comparison / Us vs Them | Comparison hook, Pain point hook | Direct contrast creates immediate interest |
| Educational / How-To | Question hook, Statistic hook | Learning intent hooks with "did you know?" |
| Problem / Solution | Pain point hook, Exaggeration hook | Agitate the problem before solving |
| Pain Point Agitation | Pain point hook, iMessage hook | Make the frustration visceral |
| Seasonal / Timely | Trend hook, Curiosity gap | Timeliness creates urgency |
| Transformation / Before-After | Oddly-satisfying hook, Comparison hook | Visual transformation is inherently hooky |

### Hook Specification

For each recommended hook, provide:
- **Hook text** (the actual opening line, headline, or visual description)
- **Duration** (for video: 1-3 seconds)
- **Visual treatment** (native/polished, text overlay style, camera angle)
- **Platform optimization** (Feed hooks differ from Reels hooks)

### Hook Testing Matrix

If the concept has multiple hook variants, create a testing matrix:

| Concept | Hook A | Hook B | Hook C | Test Priority |
|---------|--------|--------|--------|--------------|
| {concept_name} | iMessage hook: "{text}" | Pain point hook: "{text}" | Question hook: "{text}" | A > B > C |

---

## Step 5: Testing Schedule

Build a weekly testing calendar that aligns with the account's testing framework and creative production capacity.

### Calendar Structure

Based on `creative_config.testing_framework`:

**Faris Method (add to existing campaigns):**
```
Week of {date}:
- Monday: Launch 2-3 new ads into scaling campaign (use Post ID from drafts)
- Wednesday: Review 48h data on Monday launches
- Thursday: Launch 2-3 more ads (second batch)
- Friday: Review all new ads, kill <$X CPA threshold
- Following Monday: Graduate winners to higher budget ad sets
```

**3:2:2 Method (dedicated testing campaign):**
```
Week of {date}:
- Monday: Launch Test Campaign with 3 concepts, 2 hooks each, 2 formats each
  - Structure: 3 ad sets (one per concept), 4 ads per ad set (2 hooks x 2 formats)
  - Budget: ${testing_budget}/day per ad set
- Thursday: Mid-week read (72h data). Kill any ad with CPA >2x target and zero conversions.
- Following Monday: Full read. Graduate CPA <target to scaling campaign. Kill the rest.
```

**DCT (Dynamic Creative Testing):**
```
Week of {date}:
- Monday: Launch DCT ad sets with multiple headlines, images/videos, CTAs
  - Structure: 1 ad per ad set, Meta tests combinations
  - Budget: ${testing_budget}/day
- Friday: Review asset-level breakdown. Identify winning combinations.
- Following Monday: Build manual ads from winning DCT combinations.
```

### Weekly Calendar Output

| Day | Action | Concept | Format | Hook | Status |
|-----|--------|---------|--------|------|--------|
| Mon | Launch | Concept 1: {name} | Video 9:16 | iMessage hook | Ready / In Production |
| Mon | Launch | Concept 1: {name} | Video 9:16 | Pain point hook | Ready / In Production |
| Mon | Launch | Concept 2: {name} | Static 1:1 | Comparison hook | Ready / In Production |
| Thu | Launch | Concept 3: {name} | UGC video | Trend hook | In Production |
| Thu | Launch | Concept 3: {name} | UGC video | Question hook | In Production |
| Fri | Review | All week's launches | -- | -- | Pending data |

### Velocity Check

- Planned launches this week: {count}
- Target per `creative_config.weekly_creative_volume_target`: {target}
- Gap: {count} (flag if below target)
- Production capacity note: if gap is due to production bandwidth, flag for the user

---

## Step 6: Brief Output

Generate an individual creative brief for each concept. These briefs should be directly actionable by a creative team, designer, video editor, or UGC creator.

### Creative Brief Template (per concept)

```markdown
# Creative Brief: {Concept Name}

## Overview
- **Concept category:** {category from framework}
- **Target audience:** {specific persona or segment}
- **Campaign:** {which campaign this will run in}
- **Testing method:** {Faris / 3:2:2 / DCT}
- **Launch date:** {scheduled date from testing calendar}
- **Priority:** {1-5, from concept prioritization}

## Strategic Context
- **Gap filled:** {what gap from Step 2 this addresses}
- **Key insight:** {human truth or pain point}
- **Key message:** {single takeaway}
- **Proof point:** {what makes this credible}
- **Emotional register:** {humor / urgency / aspiration / empathy / curiosity / FOMO}

## Creative Specifications
- **Format:** {Video / Static / Carousel / UGC}
- **Aspect ratio:** {9:16 / 1:1 / 4:5 / 16:9}
- **Duration:** {if video: length in seconds}
- **Placements:** {Feed / Stories / Reels / Search / All}
- **Sound:** {Sound-on required / Sound-off friendly / Both versions needed}

## Hook Strategy
### Hook A (Primary): {hook type}
- **Opening line/visual:** "{exact text or visual description}"
- **Duration:** {1-3 seconds}
- **Visual treatment:** {native/polished, text overlay, camera angle}

### Hook B (Variant): {hook type}
- **Opening line/visual:** "{exact text or visual description}"
- **Duration:** {1-3 seconds}
- **Visual treatment:** {description}

## Body / Middle
- **Structure:** {for video: scene-by-scene breakdown; for static: layout description; for carousel: card sequence}
- **Key scenes/elements:**
  1. {Scene/element 1 -- what happens, what is shown}
  2. {Scene/element 2}
  3. {Scene/element 3}
- **Text overlay:** {any on-screen text}
- **Music/audio:** {style, tempo, mood}

## CTA
- **CTA type:** {Learn More / Sign Up / Shop Now / Get Started / Try Free}
- **CTA text:** "{exact CTA copy}"
- **End card:** {if applicable -- visual description}

## Reference Examples
- {Link or description of similar ads that perform well, from competitor research or past winners}
- {Link or description 2}

## Production Requirements
- **Effort level:** {Low / Medium / High}
- **Assets needed:** {list: footage, graphics, voiceover, music, testimonial recording, etc.}
- **Talent:** {if applicable: founder, customer, UGC creator, actor}
- **Estimated production time:** {hours or days}
- **Naming convention:** {per account-conventions: e.g., VID_CONCEPT_V1_9x16}

## Success Criteria
- **Primary KPI:** CPA < ${target} (or ROAS > {target}x)
- **Secondary KPIs:** CTR > {account_avg}%, Hook rate > 30% (if video)
- **Kill criteria:** Spend > ${3x_target_CPA} with 0 conversions, or CPA > 2x target after 500+ impressions
- **Graduation criteria:** CPA within target for 72h+ with 10+ conversions
```

---

## Output Summary

The complete deliverable set from this skill:

### Deliverable 1: Creative Testing Plan

```markdown
# Creative Testing Plan: {account_name}
Generated: {date}
Testing Period: {date_range}
Testing Method: {framework}
Weekly Volume Target: {target} new ads

## Current Inventory Summary
- Active ads: {count}
- Winners: {count} | Solid: {count} | Underperformers: {count} | Fatigued: {count}
- Format coverage: {summary}
- Concept coverage: {count}/{total_categories} categories active

## Gap Analysis Summary
| Gap Type | Details | Priority | Brief # |
|----------|---------|----------|---------|
| {Format/Concept/Hook/Replacement} | {description} | {1-5} | {linked} |

## Testing Calendar
| Week | Day | Concept | Format | Hook | Priority | Production Status |
|------|-----|---------|--------|------|----------|-------------------|
| ... | ... | ... | ... | ... | ... | Ready / In Production / Briefed |

## Expected Outcomes
- New ads launching: {count}
- Gaps addressed: {count}/{total_gaps}
- Projected win rate (based on historical): {rate}%
- Projected new winners: {count}
```

### Deliverable 2: Individual Concept Briefs (3-5)

One brief per concept using the template above. Each brief is self-contained and can be handed to a creative team member independently.

### Deliverable 3: Weekly Testing Calendar

Standalone calendar view showing the complete weekly cadence:
- What launches when
- What gets reviewed when
- What gets killed or graduated when
- Production deadlines (briefs must be complete X days before launch)

---

## Error Handling

| Issue | Detection | Resolution |
|-------|----------|------------|
| No performance data available | Empty insights response | Generate briefs based on creative-strategy-methodology best practices alone. Note that briefs are not data-informed and should be treated as hypotheses. |
| Naming conventions not configured | Cannot parse concept/format tokens | Manually classify active ads by reviewing creative details. Recommend implementing naming conventions for future analysis. |
| No fatigue data from analyze-creative | Skill run standalone without prior analysis | Run Step 1 inventory analysis to build a baseline. Skip gap analysis relative to fatigue. Focus on concept coverage gaps. |
| Very new account (<7 days) | Minimal creative history | Generate "first wave" briefs: 3-5 broad concepts covering the top 3 concept categories. Recommend testimonial, product demo, and problem/solution as starting categories. |
| High creative volume already | Account already produces 20+ ads/week | Focus briefs on strategic direction and concept rotation, not individual ads. Output a concept calendar instead of individual briefs. |
| No clear KPI targets | Cannot set success criteria in briefs | Use industry benchmarks from creative-strategy-methodology. Flag that success criteria are approximate until account-specific targets are configured. |
| All concepts already covered | No category gaps found | Focus on hook diversity and format variants of existing winners. Generate "iteration briefs" that take winning concepts into new formats or hooks. |

---

## Reference Files

- `references/brief_template.md` -- Creative brief template with all fields, defaults, and formatting rules
- `references/concept_frameworks.md` -- Creative concept categories with examples, hook-concept pairings, and format recommendations
