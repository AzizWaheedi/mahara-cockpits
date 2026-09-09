# Meta Ads Skill Pack — Mahara Media

This is the exact knowledge base used to set up, edit and optimise Meta ad campaigns.
Drop the whole folder into another LLM (Claude Projects, Cursor, a custom GPT, an agent
framework) as reference files. Nothing here is host-specific.

## How it is structured

Two layers, deliberately:

1. **Methodology skills** (`*_methodology`) — the thinking. Bidding, budgets, audiences,
   creative, structure, placements, measurement, compliance, catalog, Advantage+,
   diagnostics, and the account-maturity model.
2. **Action skills** (`analyze_*`, `audit_*`, `optimize_*`, `launch_campaign`,
   `investigate_campaign`, `manage_automated_rules`, `generate_creative_brief`,
   `performance_analysis`) — the doing. Each one is a step-by-step procedure with the
   data to pull, the checks to run, and the output format.

`meta_ads_account_maturity_methodology` is the calibration layer: every action skill
reads it first (Step 0) so advice matches the account's conversion volume and spend
instead of giving a $500/day account advice built for $50k/day.

`meta_ads_weekly_review` is the orchestrator — it decides which skills run weekly,
monthly, quarterly. That is the one to hand a media buyer as their operating rhythm.

`00_INDEX_collection.md` is the routing index with one-line descriptions of all 28.

## How to use it with another LLM

System prompt, roughly:

> You are a Meta Ads media buyer. Before acting, read `00_INDEX_collection.md`, pick the
> relevant skill file, and follow it exactly. Always read
> `meta_ads_account_maturity_methodology` first to calibrate. Never write to the ad
> account without producing a draft for human approval first.

Then give it API access (below) and the Mahara context folder.

## Mahara-specific context (`mahara-context/`)

- `meta_ads_account_setup.md` — account IDs, pages, pixel, and the hard rules that
  prevent real damage: budgets are integer minor units (cents), read the setup back from
  Meta and reconcile before activating, launch scripts must be idempotent (look objects
  up by name, never blind-create).
- `b2b-marketing-ops/` — the KPI framework. Metric that matters is cost per booked call
  and per qualified bookable lead, not CPL. `references/meta_targeting_verified.md` has
  the targeting that is actually verified to exist in the API.
- `client-ads-audience-library/` — reusable interest stacks by service line and the
  standard per-client account skeleton.

## What actually edits the campaigns

No magic tool. It is the **Meta Marketing API (Graph API)** — campaigns, adsets,
adcreatives, ads endpoints — driven by scripts. Any LLM with a system-user token and the
`ads_management` permission can do the same. What makes it efficient is not the API, it
is the pack above plus two hard rules:

1. **Draft then approve.** Produce a full launch/change table for a human, then execute.
2. **Read back and reconcile before activating.** Count objects and check budgets against
   the plan; mismatch means stop.

To get a token: Meta Business Settings → Users → System Users → create/assign the ad
accounts and pages → Generate token with `ads_management`, `ads_read`,
`business_management`, `pages_read_engagement`.
