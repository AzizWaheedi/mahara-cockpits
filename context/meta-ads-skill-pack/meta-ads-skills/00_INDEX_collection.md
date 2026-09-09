---
name: "Meta Ads Toolkit"
description: "28 skills for full Meta Ads execution — campaign creation, audience management, automated rules, A/B testing, CAPI events, and creative strategy, all with human approval on every write."
type: collection
source: "catalog_bundle"
---

# Meta Ads Toolkit

This collection is a routing index. Read the relevant child `SKILL.md` before acting.

## Included skills

- **account_conventions** — Configuration engine for the Meta Ads Analysis Toolkit. Defines account identities, pixel/CAPI setup, KPI targets, flag thresholds, naming conventions, and business models. Every other skill in the toolkit reads from this configuration. Use when setting up the toolkit for a new brand, agency, or client, or when account details change. Works for both single-brand media buyers and multi-client agencies.
  - `skills/catalog/meta_ads_account_conventions/SKILL.md`
- **account_maturity_methodology** — Four-stage maturity model for Meta Ads accounts based on monthly conversion volume and spend level. Calibrates every recommendation across the entire Meta Ads toolkit so guidance matches the account's sophistication level. Referenced by all action skills during Step 0.
  - `skills/catalog/meta_ads_account_maturity_methodology/SKILL.md`
- **advantage_plus_methodology** — Comprehensive framework for Meta's Advantage+ suite including Advantage+ Shopping Campaigns (ASC), Advantage+ Audience, Advantage+ Creative, and the unified Advantage+ campaigns migration (v25.0). Covers when to use each feature, optimization strategies, and the May 2026 migration deadline. Referenced by analyze-advantage-plus action skill.
  - `skills/catalog/meta_ads_advantage_plus_methodology/SKILL.md`
- **analyze_advantage_plus** — Action skill that deep-analyzes Advantage+ campaigns including ASC performance, audience expansion behavior, existing vs new customer split, creative performance within Advantage+, and catalog performance. Produces Advantage+ optimization report.
  - `skills/catalog/meta_ads_analyze_advantage_plus/SKILL.md`
- **analyze_catalog** — Action skill that analyzes product catalog and dynamic product ad performance for Meta Ads. Produces product tier classifications (Heroes/Sidekicks/Zombies/Villains), feed quality audit, product set performance analysis, and catalog optimization recommendations.
  - `skills/catalog/meta_ads_analyze_catalog/SKILL.md`
- **analyze_creative** — Action skill that executes creative performance analysis for Meta Ads accounts. Produces creative scorecards, fatigue detection reports, refresh priority lists, and creative test plans. Loads creative-strategy-methodology and account-maturity-methodology for calibrated analysis.
  - `skills/catalog/meta_ads_analyze_creative/SKILL.md`
- **audience_methodology** — Audience strategy framework for Meta Ads covering broad targeting, interest targeting, lookalike audiences, custom audiences, Advantage+ audience, and exclusion strategies. Includes decision trees for when to use each approach based on account maturity and business model. Referenced by audit-audiences action skill.
  - `skills/catalog/meta_ads_audience_methodology/SKILL.md`
- **audit_audiences** — Action skill that audits audience strategy for Meta Ads accounts. Identifies audience overlap, saturation signals, expansion opportunities, and Advantage+ audience performance. Produces audience health report with recommendations.
  - `skills/catalog/meta_ads_audit_audiences/SKILL.md`
- **audit_bidding** — Action skill that audits bidding strategies across Meta Ads campaigns. Assesses strategy-fit per campaign based on maturity level and performance data. Produces migration recommendations with sequenced timing to avoid learning phase disruption.
  - `skills/catalog/meta_ads_audit_bidding/SKILL.md`
- **audit_compliance** — Action skill that audits Meta Ads accounts for privacy and compliance requirements. Checks Special Ad Category status, GDPR/CCPA compliance, CAPI data processing options, ad content restrictions, and disapproval history. Produces compliance status report.
  - `skills/catalog/meta_ads_audit_compliance/SKILL.md`
- **audit_measurement** — Action skill that audits measurement infrastructure for Meta Ads accounts. Checks pixel health, Conversions API (CAPI) status, Event Match Quality scores, attribution settings, UTM structure, and third-party tool integration. Produces measurement health report with remediation priorities.
  - `skills/catalog/meta_ads_audit_measurement/SKILL.md`
- **audit_structure** — Action skill that audits campaign structure for Meta Ads accounts. Assesses adherence to the three-campaign model, identifies fragmentation, evaluates CBO vs ABO usage, and checks naming convention compliance. Produces restructuring recommendations.
  - `skills/catalog/meta_ads_audit_structure/SKILL.md`
- **bidding_methodology** — Bid strategy selection framework for Meta Ads mapped to account maturity stages. Covers Lowest Cost, Cost Cap, Bid Cap, and Minimum ROAS strategies with decision criteria, warning signals, and migration paths. Referenced by audit-bidding action skill.
  - `skills/catalog/meta_ads_bidding_methodology/SKILL.md`
- **budget_methodology** — Budget allocation, scaling methodology, and pacing framework for Meta Ads. Covers the three-tier allocation model, vertical and horizontal scaling protocols, learning phase management, and budget scheduling. Referenced by optimize-budgets action skill.
  - `skills/catalog/meta_ads_budget_methodology/SKILL.md`
- **campaign_diagnostics_methodology** — Systematic root-cause analysis framework for diagnosing underperforming Meta Ads campaigns. Provides an 8-branch diagnostic tree covering measurement, delivery, audience, creative, landing page, budget, bidding, and external factors. Each branch specifies diagnostic data to pull and resolution actions. Referenced by investigate-campaign action skill.
  - `skills/catalog/meta_ads_campaign_diagnostics_methodology/SKILL.md`
- **campaign_structure_methodology** — Campaign architecture framework for Meta Ads. Covers CBO vs ABO decision criteria, the three-campaign model (Testing, Winners, ASC), Consolidated Account Structure principles, and naming conventions. Referenced by audit-structure action skill.
  - `skills/catalog/meta_ads_campaign_structure_methodology/SKILL.md`
- **catalog_methodology** — Product catalog and dynamic product ads (DPA) framework for Meta Ads. Covers catalog setup, feed optimization, product set strategies, Advantage+ Catalog Ads, and catalog-driven retargeting. Referenced by analyze-catalog action skill.
  - `skills/catalog/meta_ads_catalog_methodology/SKILL.md`
- **compliance_methodology** — Privacy and compliance framework for Meta Ads covering Special Ad Categories (housing, credit, employment), GDPR/CCPA requirements, Aggregated Event Measurement, Consent Mode, and data sharing restrictions. Referenced by audit-compliance action skill.
  - `skills/catalog/meta_ads_compliance_methodology/SKILL.md`
- **creative_strategy_methodology** — Comprehensive creative strategy framework for Meta Ads. Covers testing methodologies (DCT, 3:2:2, Faris method), creative fatigue detection, hook/hold rate benchmarks, creative diversification strategy, and volume requirements by spend level. Use when evaluating creative performance, planning creative tests, diagnosing fatigue, or calibrating benchmarks. Referenced by analyze-creative and generate-creative-brief action skills.
  - `skills/catalog/meta_ads_creative_strategy_methodology/SKILL.md`
- **generate_creative_brief** — Action skill that generates creative testing plans and concept briefs for Meta Ads. Based on current performance data, produces prioritized creative concepts, hook strategies, format recommendations, and testing schedules. Uses creative-strategy-methodology to inform recommendations.
  - `skills/catalog/meta_ads_generate_creative_brief/SKILL.md`
- **investigate_campaign** — Action skill that performs root-cause analysis on underperforming Meta Ads campaigns. Walks through the 8-branch diagnostic tree (measurement, delivery, audience, creative, landing page, budget, bidding, external) to identify the primary issue and produce a prioritized action plan with evidence chain.
  - `skills/catalog/meta_ads_investigate_campaign/SKILL.md`
- **launch_campaign** — Takes a campaign brief and launches a complete Meta Ads campaign (campaign → ad set → creative → ad), enforcing naming conventions, running a pre-launch checklist, and producing a human-approved Launch Draft before any creation happens.
  - `skills/catalog/meta_ads_launch_campaign/SKILL.md`
- **manage_automated_rules** — Audits existing Meta Ads automated rules, identifies gaps in campaign protection, proposes new guardian rules for kill switches, budget pacing, creative fatigue, and scale triggers, and creates/updates rules with human approval before any changes execute.
  - `skills/catalog/meta_ads_manage_automated_rules/SKILL.md`
- **measurement_methodology** — Measurement and attribution framework for Meta Ads. Covers attribution windows, Conversions API (CAPI) setup and deduplication, UTM strategies, third-party attribution tools (Triple Whale, Northbeam, Hyros), MER methodology, and incrementality testing. Referenced by audit-measurement action skill.
  - `skills/catalog/meta_ads_measurement_methodology/SKILL.md`
- **meta_ads_weekly_review** — Orchestration skill that coordinates all 28 Meta Ads action skills into a structured weekly review workflow. Determines which skills to run for which accounts based on campaign types, maturity level, and cadence (weekly/monthly/quarterly). Includes 4 mandatory human checkpoints for recommendation review before output.
  - `skills/catalog/meta_ads_weekly_review/SKILL.md`
- **optimize_budgets** — Action skill that optimizes budget allocation across Meta Ads campaigns. Produces reallocation tables with projected impact, scaling recommendations, and pacing analysis. Uses marginal efficiency modeling to shift budget from diminishing-return campaigns to constrained-efficient ones.
  - `skills/catalog/meta_ads_optimize_budgets/SKILL.md`
- **performance_analysis** — Action skill that produces account and campaign-level performance dashboards for Meta Ads with week-over-week and month-over-month comparisons, trend analysis, and automated flag generation. This is typically the first skill run in any review cadence.
  - `skills/catalog/meta_ads_performance_analysis/SKILL.md`
- **placement_methodology** — Placement optimization framework for Meta Ads covering performance benchmarks by placement (Feed, Stories, Reels, Right Column, Audience Network, Messenger), creative specifications per placement, and Advantage+ Placements vs manual selection. Referenced by all action skills evaluating placement performance.
  - `skills/catalog/meta_ads_placement_methodology/SKILL.md`
