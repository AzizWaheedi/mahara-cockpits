---
name: measurement_methodology
description: Measurement and attribution framework for Meta Ads. Covers attribution windows, Conversions API (CAPI) setup and deduplication, UTM strategies, third-party attribution tools (Triple Whale, Northbeam, Hyros), MER methodology, and incrementality testing. Referenced by audit-measurement action skill.
---

# Measurement Methodology

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

This skill defines the complete measurement and attribution framework for Meta Ads. Attribution is where most advertisers make their worst decisions -- they either over-credit Meta (counting view-through as incremental) or under-credit it (ignoring conversions outside the click window). This framework provides the tools, methodologies, and decision criteria to measure Meta Ads performance accurately and make confident budget decisions.

## Core Framework: The Measurement Stack

A complete Meta Ads measurement system has four layers:

```
Layer 1: Platform Attribution (Meta Ads Manager)
  └── Default view. Necessary but insufficient. Subject to attribution model biases.

Layer 2: Server-Side Tracking (CAPI + Pixel)
  └── Recovers lost conversions. Improves data quality. Required for optimization.

Layer 3: Third-Party Attribution (Triple Whale, Northbeam, Hyros)
  └── Cross-platform view. De-duplicated. More conservative than platform.

Layer 4: Incrementality (Lift studies, MER, holdout tests)
  └── Ground truth. Measures actual causal impact. Ultimate decision-maker.
```

Most accounts operate on Layer 1 alone. Every account should reach Layer 2. Accounts spending $50K+/month should have Layer 3. Accounts spending $200K+/month need Layer 4.

---

## 1. Attribution Windows

### Available Windows

| Window | What It Measures | Best For |
|--------|-----------------|----------|
| 1-day click | Conversions within 1 day of clicking an ad | Conservative view, direct response |
| 7-day click (default) | Conversions within 7 days of clicking an ad | Standard e-commerce and SaaS |
| 1-day view | Conversions within 1 day of viewing (not clicking) | Awareness impact, often inflated |
| 7-day click + 1-day view | Both click and view-through in one window | Broadest view, includes impression impact |

### 2026 Attribution Change

**Critical update:** As of 2025, click-through attribution only counts conversions that occur after a link click (not after any engagement). Previously, a "click" included video plays, reactions, and comments. This means:
- Reported conversions may decrease vs historical data
- Click attribution is now more conservative and accurate
- View-through attribution is unchanged

### Window Selection by Business Model

| Business Type | Recommended Window | Why |
|--------------|-------------------|-----|
| E-commerce (impulse buy) | 7-day click | Most purchases happen within 7 days |
| E-commerce (high AOV) | 7-day click + 1-day view | Longer consideration, view impact matters |
| SaaS / Free trial | 7-day click | Signup usually happens in-session or within days |
| Lead generation | 7-day click | Lead forms completed quickly after click |
| B2B (long sales cycle) | 7-day click | Use as top-of-funnel metric, track downstream in CRM |
| App installs | 7-day click + 1-day view | View impact is real for app discovery |

### Comparing Windows for Decision-Making

Always compare 1-day click vs 7-day click to understand your attribution distribution:

| Ratio (7d click / 1d click) | Interpretation |
|-----------------------------|---------------|
| 1.0-1.2x | Most conversions happen same-day. Tight attribution. |
| 1.2-1.5x | Moderate delayed attribution. Normal for most businesses. |
| 1.5-2.0x | Significant delayed conversions. Consider longer window. |
| 2.0x+ | Very long consideration cycle. Meta may be getting credit for organic. Investigate. |

If 7-day click is 3x+ your 1-day click numbers, some of those "delayed" conversions may not be truly attributable to Meta. Cross-reference with third-party tools.

---

## 2. Conversions API (CAPI)

### What CAPI Is

The Conversions API is a server-to-server integration that sends conversion events directly from your server to Meta, bypassing the browser entirely. It runs alongside the Meta Pixel (browser-based tracking) to create redundant measurement.

### Why CAPI Matters

- Browser tracking is degraded: iOS 14.5+ App Tracking Transparency, ad blockers, cookie restrictions, Safari ITP
- CAPI recovers 20-30% of lost conversion data
- Better data = better optimization = lower CPA
- Required for Event Match Quality (EMQ) scores above 6.0
- Meta gives algorithmic preference to advertisers with strong CAPI implementation

### CAPI Toolkit Capabilities (Meta Ads MCP)

The Meta Ads MCP supports programmatic CAPI verification and testing:

| Capability | MCP Tool | Use Case |
|------------|----------|----------|
| Check CAPI setup status | `get_server_events_setup` | First step in any CAPI audit -- shows configuration state without going to Events Manager |
| Monitor pixel event volume | `get_pixel_stats` | Returns event statistics by event type, device, and count. Identify firing gaps programmatically. |
| Send a test server-side event | `send_server_event` | Verify CAPI is working end-to-end. Use test mode to send a synthetic event and confirm receipt. Supports Purchase, Lead, AddToCart, and other standard events. |

**Testing CAPI with `send_server_event`:**
- Use this when deduplication rate is 0% (server events not reaching Meta)
- Use after implementing a new CAPI integration to confirm it's working before launch
- Always use test mode for verification; live events affect optimization data
- Human approval required before sending any test event

### CAPI Setup Requirements

**Data you send:**
- Event name (Purchase, Lead, AddToCart, etc.)
- Event time
- Event ID (for deduplication with pixel)
- User data: email (hashed), phone (hashed), IP, user agent, fbclid, external_id
- Custom data: value, currency, content_ids, content_type

**Implementation methods:**
1. **Partner integrations:** Shopify, WooCommerce, WordPress plugins (easiest)
2. **Google Tag Manager server-side:** Medium complexity, flexible
3. **Direct API integration:** Most control, requires engineering resources
4. **Customer Data Platform:** Segment, mParticle, Rudderstack (if you already use one)

### Deduplication

When both Pixel and CAPI fire for the same event, Meta must deduplicate to avoid double-counting.

**Deduplication mechanism:** The `event_id` parameter. Both Pixel and CAPI must send the same `event_id` for the same event occurrence.

**How to implement:**
1. Generate a unique event_id when the conversion occurs (e.g., order ID, transaction ID)
2. Include this event_id in both the Pixel event and the CAPI event
3. Meta matches on event_id + event_name and deduplicates automatically

**Without deduplication:**
- Conversions are double-counted
- CPA appears artificially low
- You make bad budget decisions based on inflated data
- Meta's algorithm optimizes on inflated signals

**Verification:**
- Check Events Manager > Overview > "Deduplicated" vs "Total" event counts
- Healthy deduplication: 5-20% of events are duplicates (means both systems are firing)
- 0% duplicates: One system isn't firing, or event_id isn't matching
- 50%+ duplicates: Something is misconfigured, investigate immediately

### Event Match Quality (EMQ)

EMQ scores how well Meta can match your server events to Meta users. Higher EMQ = better optimization.

| EMQ Score | Rating | Action |
|-----------|--------|--------|
| <3.0 | Poor | Urgently improve. Send more user parameters. |
| 3.0-5.0 | Below Average | Add email, phone, and external_id to CAPI events |
| 5.0-6.0 | Average | Acceptable minimum. Add fbclid and user agent. |
| 6.0-8.0 | Good | Strong. Continue monitoring. |
| 8.0-10.0 | Excellent | Optimal. No action needed. |

**How to improve EMQ:**
1. Send hashed email with every event (biggest single improvement)
2. Send hashed phone number
3. Pass fbclid from URL to server events
4. Include external_id (your user ID)
5. Send IP address and user agent
6. Ensure data is properly hashed (SHA256, lowercase, trimmed)

See `references/capi_implementation.md` for complete setup guides by platform.

---

## 3. UTM Strategy

UTMs (Urchin Tracking Module) are URL parameters that enable tracking in Google Analytics and other analytics tools, independent of Meta's attribution.

### UTM Structure for Meta Ads

| Parameter | Value | Purpose |
|-----------|-------|---------|
| utm_source | `meta` or `facebook` | Identifies the platform |
| utm_medium | `cpc` (paid) or `social` (organic) | Traffic type |
| utm_campaign | Campaign name (e.g., `sales_winners_cbo_2026-03`) | Campaign identification |
| utm_content | Ad name (e.g., `ugc_testimonial_slack-chaos_v1`) | Ad-level identification |
| utm_term | Ad set name (e.g., `broad_us_allplacements`) | Audience identification |

### Dynamic UTM Parameters

Meta supports dynamic URL parameters that auto-populate:

| Parameter | Dynamic Value | What It Returns |
|-----------|--------------|----------------|
| `{{campaign.name}}` | Campaign name | As set in Ads Manager |
| `{{adset.name}}` | Ad set name | As set in Ads Manager |
| `{{ad.name}}` | Ad name | As set in Ads Manager |
| `{{campaign.id}}` | Campaign ID | Numeric ID |
| `{{adset.id}}` | Ad set ID | Numeric ID |
| `{{ad.id}}` | Ad ID | Numeric ID |
| `{{placement}}` | Placement name | e.g., "Facebook_Feed" |
| `{{site_source_name}}` | Publisher platform | e.g., "fb", "ig", "an" |

**Recommended UTM template:**
```
?utm_source=meta&utm_medium=cpc&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}
```

### UTM Best Practices

- Use consistent naming across all campaigns (match your naming conventions)
- Use lowercase only (UTMs are case-sensitive in most analytics tools)
- Never use spaces (use hyphens or underscores)
- Test UTMs before launching (click the ad preview URL and verify parameters)
- Track UTM data in Google Analytics 4 alongside Meta's attribution for comparison

---

## 4. Third-Party Attribution Tools

### Why You Need Third-Party Attribution

- Meta over-reports conversions by 10-40% (self-attribution bias)
- Google also over-reports (same bias)
- When you add up all platform-reported conversions, the total exceeds actual revenue
- Third-party tools de-duplicate across platforms and provide a unified view

### Tool Comparison

| Feature | Triple Whale | Northbeam | Hyros |
|---------|-------------|-----------|-------|
| **Best for** | Shopify e-commerce | Multi-platform, complex stack | High-AOV, info products, coaching |
| **Pricing** | $$$-$$$$ ($100-300/mo start) | $$$$-$$$$$ ($500+/mo start) | $$$$$ ($500+/mo start) |
| **Attribution model** | First-party pixel + modeling | Multi-touch, proprietary | Click-based, deterministic |
| **Shopify integration** | Native, seamless | Good | Manual setup |
| **Multi-platform** | Meta, Google, TikTok, email | All major platforms + offline | Meta, Google, YouTube, email |
| **Real-time** | Near real-time | Near real-time | Near real-time |
| **Data method** | First-party pixel + server | First-party pixel + server | Click tracking + CRM matching |
| **Learning curve** | Low | Medium | High |
| **Best feature** | Summary dashboard, benchmarks | Spend optimization recs | Revenue attribution accuracy |
| **Limitation** | Shopify-centric | Complex setup | Expensive, steep learning curve |

### When to Implement Each

| Monthly Ad Spend | Recommendation |
|-----------------|---------------|
| <$10K | Meta Ads Manager + GA4 (no third-party needed) |
| $10K-50K | Consider Triple Whale (if Shopify) or GA4 advanced |
| $50K-150K | Implement Triple Whale or Northbeam |
| $150K-500K | Northbeam or Hyros (need sophisticated multi-touch) |
| $500K+ | Northbeam + incrementality testing |

### How to Use Third-Party Data

1. **Set it as your source of truth for CPA/ROAS** (not Meta Ads Manager)
2. **Compare platform vs third-party regularly:** Meta says CPA is $30, Triple Whale says $45 -- the truth is closer to $45
3. **Use the "blended CPA" concept:** (Total spend across all platforms) / (Third-party attributed conversions)
4. **Don't disable Meta's optimization based on third-party data.** Meta still needs its own data to optimize. Use third-party for budget allocation decisions.

See `references/third_party_comparison.md` for detailed setup guides and comparison matrices.

---

## 5. Marketing Efficiency Ratio (MER)

### What MER Is

MER = Total Revenue / Total Marketing Spend (all channels combined)

This is the simplest and often most reliable measure of marketing efficiency. It eliminates attribution debates by looking at the total picture.

### Why MER Matters

- No attribution model is perfect. MER doesn't require attribution.
- If you increase Meta spend by $10K and total revenue increases by $30K, your incremental MER is 3.0x -- regardless of which tool gets "credit."
- MER captures cross-channel effects (Meta ad drives a branded Google search that converts)
- MER is the metric CFOs and CEOs understand

### MER Calculation

```
MER = Total Revenue / Total Ad Spend

Incremental MER = (Revenue Change) / (Spend Change)
```

**Example:**
- Week 1: $100K revenue, $25K total ad spend --> MER = 4.0x
- Week 2: $130K revenue, $35K total ad spend --> MER = 3.7x
- Incremental MER: ($130K - $100K) / ($35K - $25K) = $30K / $10K = 3.0x

### MER Benchmarks by Business Type

| Business Type | Healthy MER | Good MER | Exceptional MER |
|--------------|-------------|----------|-----------------|
| E-commerce (low margin) | 3.0-4.0x | 4.0-6.0x | 6.0x+ |
| E-commerce (high margin) | 2.0-3.0x | 3.0-5.0x | 5.0x+ |
| SaaS (monthly) | 2.0-3.0x | 3.0-5.0x | 5.0x+ |
| SaaS (annual) | 4.0-8.0x | 8.0-12.0x | 12.0x+ |
| Lead gen | Depends on LTV | -- | -- |
| Info products | 3.0-5.0x | 5.0-10.0x | 10.0x+ |

### MER Tracking Protocol

1. Track daily in a spreadsheet or dashboard (see Viktor Daily PNL)
2. Calculate rolling 7-day and 30-day MER
3. When making budget changes, track incremental MER for 14 days
4. If incremental MER drops below breakeven: scale back the most recent change
5. Use MER as the tiebreaker when platform attribution and third-party tools disagree

---

## 6. Incrementality Testing

### Why Incrementality Testing

Attribution (even third-party) only tells you who converted after seeing an ad. It doesn't tell you if they would have converted anyway. Incrementality testing measures the causal lift -- the conversions that would not have happened without the ad.

### Meta Conversion Lift Studies

**What it is:** Meta's built-in incrementality testing. It creates a holdout group that sees no ads and compares their conversion rate to the exposed group.

**Setup:**
1. Go to Experiments in Meta Ads Manager
2. Select "Conversion Lift"
3. Choose the campaign(s) to test
4. Meta randomly splits your audience into test (sees ads) and holdout (sees no ads)
5. Run for minimum 3-4 weeks (longer for lower-volume accounts)
6. Meta reports the incremental lift

**Requirements:**
- Minimum ~100 conversions per cell (test and holdout) for statistical significance
- This means you need ~$10K+ in spend during the test period
- Longer tests give more reliable results

**Interpreting results:**
- "20% incremental lift" means 20% of attributed conversions were truly incremental
- The other 80% would have happened organically or via other channels
- This does NOT mean you should cut 80% of Meta spend -- those other conversions benefit from Meta's influence

**Meta's own research** reports 20%+ improvement in optimization when using incremental attribution signals. Accounts that run lift studies and feed the data back into their strategy consistently outperform.

### DIY Incrementality Testing

**Method 1: Geographic holdout**
1. Select a representative region (similar demographics, similar baseline conversion rate)
2. Pause all Meta ads in that region for 2-4 weeks
3. Compare conversion rates: ad-exposed regions vs holdout region
4. Calculate lift: (Exposed conversion rate - Holdout conversion rate) / Holdout conversion rate

**Method 2: Spend level test**
1. Week 1-2: Baseline spend and revenue
2. Week 3-4: Increase spend by 30-50%
3. Week 5-6: Return to baseline
4. Compare revenue lift in weeks 3-4 vs revenue drop in weeks 5-6
5. If revenue increased proportionally with spend: Meta is driving incremental conversions
6. If revenue barely changed: Meta is mostly getting credit for organic

**Method 3: On/off test (nuclear option)**
1. Pause all Meta spend for 7-14 days
2. Measure total revenue change
3. Resume spending
4. Only use this for accounts where you suspect Meta isn't driving real value
5. Warning: this will degrade your campaigns. Algorithm loses learning. Only do this once.

### Incrementality Benchmarks

| Channel / Campaign Type | Typical Incrementality | Notes |
|------------------------|----------------------|-------|
| Prospecting (broad) | 30-50% | Reaches new users, moderate incrementality |
| Prospecting (interest) | 40-60% | More targeted, higher incrementality |
| Retargeting (7-day) | 10-30% | Many would convert anyway |
| Retargeting (30-day) | 5-20% | Even more would convert organically |
| Brand campaigns | 15-35% | Hard to measure, long-term effect |
| ASC (mixed) | 20-40% | Blended prospecting + retargeting |

---

## 7. Custom Conversions

### Why Custom Conversions Are Required

Meta groups all custom pixel events under a single `offsite_conversion.fb_pixel_custom` bucket in Ads Manager insights unless a Custom Conversion is explicitly created for each event. This means:

- Firing a custom event like `TrialStarted` or `WorkspaceCreated` without a Custom Conversion makes it invisible as a distinct metric in Ads Manager
- You cannot optimize a campaign for a custom event unless a Custom Conversion exists for it
- Reporting, ROAS calculations, and CPA calculations for custom events require Custom Conversions

**Rule:** For every custom pixel event you want to track or optimize for, create a corresponding Custom Conversion. The MCP tool `create_custom_conversion` can do this programmatically.

**Standard events** (Purchase, Lead, AddToCart, etc.) do not require Custom Conversions -- they appear natively in Ads Manager. Custom Conversions are only required for custom-named pixel events.

### Custom Conversion Setup via MCP

```
SDK call: `meta_ads_create_custom_conversion()` (from `sdk/tools/mcp_meta_ads`)
Parameters:
  account_id: {ad_account_id}
  name: "Viktor -- Trial Started"
  pixel_id: {pixel_id}
  custom_event_type: OTHER  # Use OTHER for custom-named events
  rule: {"event": {"i_contains": "TrialStarted"}}
Note: Human approval required before executing.
```

---

## 8. Aggregated Event Measurement (AEM)

### 2025 Change: No More 8-Event Limit

Previously, Apple's ATT framework limited Meta to tracking 8 prioritized conversion events per domain. As of 2025, this restriction has been relaxed. You can now track more events without the hard 8-event cap.

### What This Means

- You can optimize for more conversion events simultaneously
- Event prioritization is still important (Meta optimizes best with clear signals)
- Still respect the event hierarchy: track the events that matter most for your business
- iOS data is still partially limited by ATT -- CAPI and modeling fill the gaps

### Recommended Event Priority (Viktor / SaaS)

1. Purchase (highest priority)
2. Start Trial / Subscribe
3. Complete Registration
4. Add Payment Info
5. Initiate Checkout
6. Lead
7. Add to Cart
8. View Content

Even without the 8-event limit, focus optimization on events 1-3 for SaaS.

---

## Quick Reference Tables

### Attribution Setup Checklist

- [ ] Pixel installed and firing on all pages
- [ ] CAPI implemented and sending events (verify with `get_server_events_setup`)
- [ ] Pixel stats verified programmatically via `get_pixel_stats`
- [ ] Test CAPI event sent via `send_server_event` to confirm end-to-end delivery
- [ ] Deduplication configured (matching event_id)
- [ ] EMQ score >6.0 for key events
- [ ] Custom Conversions created for all custom pixel events (required for visibility)
- [ ] Attribution window set appropriately (7-day click for most)
- [ ] UTMs configured with dynamic parameters
- [ ] GA4 tracking aligned with Meta events
- [ ] Conversion events verified in Events Manager
- [ ] Third-party tool implemented (if spend >$50K/month)
- [ ] MER tracked weekly in dashboard

### Data Source Trust Hierarchy

| Decision | Use This Data Source |
|----------|---------------------|
| Campaign optimization (turn on/off) | Meta Ads Manager (7-day click) |
| Budget allocation across platforms | Third-party tool or MER |
| CPA/ROAS reporting to stakeholders | Third-party tool (most conservative) |
| True incremental impact | Lift study results |
| Daily performance monitoring | Meta Ads Manager + MER dashboard |

### Common Measurement Mistakes

| Mistake | Why It's Wrong | Fix |
|---------|---------------|-----|
| Using 28-day click attribution | Inflates Meta's contribution | Use 7-day click (or 1-day click for conservative view) |
| No CAPI implementation | Missing 20-30% of conversions | Implement CAPI with deduplication |
| Trusting Meta's reported ROAS | Self-attribution bias | Cross-reference with MER and third-party |
| Comparing platform CPAs directly | Different attribution models | Normalize to MER or use same third-party tool |
| No deduplication on CAPI | Double-counting conversions | Implement event_id matching |
| Optimizing for view-through conversions | Most are not incremental | Judge performance on click-through only |
| Custom pixel events without Custom Conversions | Events grouped under fb_pixel_custom, invisible in insights | Create a Custom Conversion for each custom event you track |

---

## Reference Files

- `references/attribution_guide.md` - Deep dive on attribution models, windows, and setup procedures
- `references/capi_implementation.md` - CAPI setup guides for Shopify, GTM, and direct API, with deduplication and EMQ optimization
- `references/third_party_comparison.md` - Detailed comparison of Triple Whale, Northbeam, and Hyros with setup requirements and decision criteria
