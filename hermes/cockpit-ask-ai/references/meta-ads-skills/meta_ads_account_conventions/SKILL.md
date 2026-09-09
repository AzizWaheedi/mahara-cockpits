---
name: account_conventions
description: Configuration engine for the Meta Ads Analysis Toolkit. Defines account identities, pixel/CAPI setup, KPI targets, flag thresholds, naming conventions, and business models. Every other skill in the toolkit reads from this configuration. Use when setting up the toolkit for a new brand, agency, or client, or when account details change. Works for both single-brand media buyers and multi-client agencies.
---

# Account Conventions

## Purpose

This is the personalization engine for the entire Meta Ads Analysis Toolkit. Every other skill in the toolkit (all 25 of them) reads from this configuration at Step 0 before producing any output.

**Works for both single-brand media buyers and multi-client agencies.** A solo DTC media buyer managing one account fills out the same config as an agency managing 30 accounts -- the structure adapts to both.

This file is the single source of truth for:
- Your organization (brand or agency) and which accounts are in scope
- How each account is structured (pixel, CAPI, catalogs, Advantage+)
- What KPIs matter and what thresholds trigger flags
- How campaigns, ad sets, and ads are named
- What attribution, measurement, and compliance rules apply
- Where data comes from and where reports go

When you onboard a new brand or client, this is the only file you edit. Every other skill adapts automatically.

## Config File Location

The config lives as a YAML block inside this SKILL.md file (below the `---` end marker) or as a separate file at `account_conventions/config.yaml` in the toolkit directory.

Viktor preserves content you add after the end marker across SDK regenerations, making this SKILL.md a safe place to store persistent configuration. Alternatively, store the config as a standalone YAML file alongside this skill.

If the config does not exist when another skill requests it, run the setup wizard from `references/setup_questionnaire.md`.

## How Other Skills Use This Config

At Step 0, every action and methodology skill:
1. Reads the `accounts` array to identify which account(s) are in scope
2. Pulls `maturity_level` to calibrate recommendations via the account-maturity-methodology skill
3. Checks capability flags (`has_capi`, `has_advantage_plus`, etc.) to skip irrelevant sections
4. Loads `kpi_config` to know which metrics to prioritize and what constitutes a flag
5. References `naming_conventions` to parse campaign/ad set/ad names for segmentation
6. Uses `measurement` settings to contextualize attribution data
7. Checks `compliance` before generating any audience or targeting recommendations

If a field is missing or set to a default, the skill will note the gap and recommend the user run the setup questionnaire (see `references/setup_questionnaire.md`).

## Complete Configuration Schema

```yaml
# ============================================================
# META ADS ANALYSIS TOOLKIT - ACCOUNT CONVENTIONS
# ============================================================
# This is the ONLY file where agencyclient_specific data lives.
# All 25 other skills in the toolkit read from this config.
# ============================================================

# --- Organization Identity ---
# For single-brand users: this is your company (e.g., "Apex Athletics")
# For agencies: this is your agency (e.g., "Full Funnel Growth")
organization:
  name: ""                          # e.g., "Apex Athletics" or "Full Funnel Growth"
  slug: ""                          # e.g., "apex-athletics" or "ffg" (used in file names and UTMs)
  type: "brand"                     # "brand" (single company) or "agency" (multiple clients)

# --- Accounts ---
# Each account represents one Meta ad account (act_XXXXX).
# Single-brand users typically have 1-2 accounts (e.g., US and UK).
# Agencies may have many accounts across clients.
accounts:
  - name: ""                        # Human-readable account name, e.g., "Apex Athletics US"
    slug: ""                        # URLfile_safe slug, e.g., "apex-us"
    ad_account_id: ""               # Meta ad account ID, format: act_XXXXX
    pixel_id: ""                    # Meta Pixel ID for this account
    dataset_id: ""                  # Conversions API dataset ID (if using CAPI Gateway)
    currency: "USD"                 # ISO 4217 currency code
    timezone: "America/New_York"    # IANA timezone for the ad account
    business_model: "ecommerce"     # ecommerce | lead_gen | saas | app | local | dual
    maturity_level: "developing"    # nascent | developing | established | advanced
    monthly_conversion_volume: 0    # Average monthly purchase/lead conversions
    monthly_spend: 0                # Average monthly ad spend in account currency
    status: "active"                # active | paused | onboarding | offboarding

    # --- Capability Flags ---
    # These determine which toolkit skills are relevant for this account.
    # Skills check these flags at Step 0 and skip sections that don't apply.
    capabilities:
      has_capi: false               # Conversions API implemented (server-side events)
      has_catalog: false            # Product catalog connected for dynamic ads
      has_advantage_plus: false     # Advantage+ Shopping Campaigns (ASC) enabled
      has_value_optimization: false # Value-based optimization (VBO) active
      has_custom_conversions: false # Custom conversions defined beyond standard events
      campaign_types_active:        # Which campaign objectives are running
        - prospecting
        # - retargeting
        # - asc                     # Advantage+ Shopping Campaigns
        # - advantage_plus_app      # Advantage+ App Campaigns
        # - demand_gen              # Demand generation / awareness
        # - catalog_sales           # Dynamic product ads
        # - lead_gen                # On-platform lead forms

    # --- KPI Configuration ---
    # Defines what "good" and "bad" look like for this account.
    # Every analysis skill uses these targets and thresholds to generate flags.
    kpi_config:
      primary_kpi: "cpa"            # cpa | roas | cpl | cpv | cpm
      targets:
        cpa: 0.00                   # Target cost per acquisition
        roas: 0.00                  # Target return on ad spend (e.g., 4.0 = 4x)
        cpl: 0.00                   # Target cost per lead
        cpv: 0.00                   # Target cost per value event
        cpm: 0.00                   # Target CPM (awareness campaigns)
        ctr: 0.00                   # Target click-through rate (decimal, e.g., 0.015)
        hook_rate: 0.00             # Target 3-second video view rate (decimal)
        hold_rate: 0.00             # Target ThruPlay rate (decimal)
        frequency_cap: 0.0          # Max avg frequency before fatigue flag
        cpc: 0.00                   # Target cost per click
      flag_thresholds:
        critical:                   # Red flag: immediate action required
          cpa_over_target_pct: 50   # CPA exceeds target by this % = critical
          roas_under_target_pct: 40 # ROAS falls below target by this % = critical
          frequency_above: 4.0      # Frequency above this = creative fatigue critical
          ctr_below: 0.005          # CTR below this = creative relevance critical
          spend_no_conversions_hours: 48  # Hours spending with zero conversions
        warning:                    # Yellow flag: monitor closely
          cpa_over_target_pct: 20   # CPA exceeds target by this % = warning
          roas_under_target_pct: 20 # ROAS falls below target by this % = warning
          frequency_above: 2.5      # Frequency above this = creative fatigue warning
          ctr_below: 0.01           # CTR below this = creative relevance warning
          spend_no_conversions_hours: 24  # Hours spending with zero conversions

    # --- Creative Configuration ---
    # Controls how creative analysis and briefs are generated.
    creative_config:
      testing_framework: "dct"      # dct (Dynamic Creative Testing) | manual_ab | faris_method
      weekly_creative_volume_target: 5  # Number of new creatives to produce per week
      creative_types_active:        # Which creative formats are in rotation
        - static
        - video
        # - ugc
        # - carousel
        # - catalog                 # Dynamic product creative from catalog
        # - collection              # Instant Experience / Collection ads

    # --- Audience Configuration ---
    # Defines the audience strategy and assets for this account.
    audience_config:
      warm_audiences:               # Custom audiences available for retargeting
        - name: ""                  # e.g., "Website Visitors 180d"
          audience_id: ""           # Meta audience ID
          type: ""                  # website | customer_list | video_viewers | ig_engagers | fb_page | app_activity
          lookback_days: 0          # Retention window in days
      exclusion_audiences:          # Audiences excluded from prospecting
        - name: ""                  # e.g., "Purchasers 180d"
          audience_id: ""
      lookalike_sources:            # Seed audiences for lookalike creation
        - name: ""                  # e.g., "Top 25% LTV Customers"
          audience_id: ""
          recommended_pct: "1-3"    # Recommended lookalike percentage range
      advantage_plus_enabled: false # Whether Advantage+ Audience is the default targeting

    # --- Naming Conventions ---
    # Standardized naming enables automated parsing and segmentation.
    # Use tokens wrapped in curly braces. Skills parse these to extract metadata.
    naming_conventions:
      campaign: "{objective}_{audience}_{geo}_{launch_date}"
        # Example: "CONV_PROS_US_2026-03"
        # Tokens:
        #   {objective}    = CONV, TRAF, REACH, VV, LEAD, CATALOG
        #   {audience}     = PROS (prospecting), RT (retargeting), ASC, LAL (lookalike)
        #   {geo}          = US, UK, EU, GLOBAL, etc.
        #   {launch_date}  = YYYY-MM format
      ad_set: "{targeting}_{placement}_{bid_strategy}_{budget}"
        # Example: "LAL3-LTV_AUTO_LCAP50_D50"
        # Tokens:
        #   {targeting}    = BROAD, LAL1, LAL3, INT-FITNESS, RT-ATC, RT-VC, etc.
        #   {placement}    = AUTO (Advantage+), FEED, STORY, REEL, MANUAL
        #   {bid_strategy} = AUTO (lowest cost), LCAP (cost cap), BID (bid cap), ROAS (min ROAS)
        #   {budget}       = D50 ($50/day), L500 ($500 lifetime), CBO (campaign budget)
      ad: "{creative_type}_{concept}_{variant}_{format}"
        # Example: "VID_TESTIMON_V3_9x16"
        # Tokens:
        #   {creative_type} = STATIC, VID, UGC, CAROUSEL, COLL, DPA
        #   {concept}       = Short concept name (TESTIMON, FOUNDER, DEMO, UGC-UNBOX, etc.)
        #   {variant}       = V1, V2, V3 (iteration number)
        #   {format}        = 1x1, 9x16, 16x9, 4x5 (aspect ratio)

    # --- Measurement ---
    # Attribution and measurement setup for this account.
    measurement:
      attribution_window: "7d_click"  # 7d_click | 1d_click | 7d_click_1d_view
      third_party_tool: "none"        # none | triple_whale | northbeam | hyros
      utm_structure:
        utm_source: "meta"            # Always "meta" for Meta Ads
        utm_medium: "paid-social"     # Standard medium for paid social
        utm_campaign: "{campaign_name}"
        utm_content: "{ad_set_name}"
        utm_term: "{ad_name}"

    # --- Compliance ---
    # Legal and policy constraints that affect targeting and creative.
    compliance:
      special_ad_categories: "none"   # none | housing | credit | employment
      gdpr_applicable: false          # EU/EEA audiences require consent mode
      ccpa_applicable: false          # California audiences require LDU signal

    # --- Reporting ---
    # Output formatting preferences for this account.
    reporting:
      period: "last_7_days"           # last_7_days | last_14_days | last_30_days | mtd | last_month
      comparison: "preceding_period"  # preceding_period | same_period_last_month | same_period_last_year
      output_path: ""                 # Where reports are saved, e.g., "reportsapex_us/"
      output_naming: "{account_slug}_{skill_name}_{date}"  # File naming convention

# --- Data Source ---
# How the toolkit ingests Meta Ads data.
data_source:
  method: "csv"                     # mcp | csv | manual
  mcp_server: "none"               # pipeboard | gomarble | custom | none
  csv_import_path: ""              # Path to CSV exports if method is "csv"
  manual_instructions: ""          # Notes for manual data entry workflow
```

## Config Validation Rules

When loading config, skills validate the following before proceeding:

| Field | Validation | Error Behavior |
|-------|-----------|----------------|
| `ad_account_id` | Must match `act_` + digits | Skip account, flag error |
| `pixel_id` | Must be numeric string | Warn, proceed without pixel analysis |
| `maturity_level` | Must be one of four stages | Default to "developing", warn |
| `primary_kpi` | Must match supported list | Default to "cpa", warn |
| `business_model` | Must match supported list | Default to "ecommerce", warn |
| `currency` | Must be valid ISO 4217 | Default to "USD", warn |
| `attribution_window` | Must match supported list | Default to "7d_click", warn |
| `flag_thresholds` | All values must be > 0 | Use defaults, warn |
| `naming_conventions` | Must contain at least one token | Warn, disable name-based parsing |

## Updating This Config

**When to update:**
- New client onboarded
- Account structure changes (new campaigns, new pixel, CAPI added)
- KPI targets revised (seasonal, post-test, scaling phase)
- Naming conventions updated
- New creative types or campaign types activated
- Attribution or measurement setup changes

**How to update:**
1. Run the setup questionnaire (`references/setup_questionnaire.md`) for the relevant section
2. Update the YAML block above
3. Re-run any active analysis skills to pick up the new config

## Multi-Account Usage

The `accounts` array supports unlimited accounts. Common patterns:

- **Single brand, single market:** 1 account
- **Single brand, multi-market:** 1 account per country/region (shared pixel, different currency/timezone)
- **Agency managing multiple brands:** 1 account per brand, separate KPI configs
- **Hybrid model:** Some accounts may be "dual" business_model (e.g., ecommerce + lead gen for B2B wholesale)

Skills iterate over all `status: "active"` accounts unless the user specifies a particular account by name or slug.
