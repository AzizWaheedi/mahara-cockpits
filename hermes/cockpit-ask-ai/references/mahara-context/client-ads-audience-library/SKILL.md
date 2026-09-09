---
name: client_ads_audience_library
description: Reusable Meta audience architecture for Mahara Media's GCC client campaigns — modular interest stacks by service line plus the standard per-client account skeleton. Use when planning, building, or auditing a client's ad audiences.
---

# Client ads audience library (GCC consumer campaigns)

Verified interest IDs live in `references/gcc_b2c_audience_modules.md`. **Always re-verify with
`meta_ads_search_targeting` before recommending an interest** — a large share of the obvious ones
(Marble, Ceramic tile, Smart home, Bayut, AutoCAD, Hilti…) do not exist on Meta and silently
resolve to unrelated proxies.

## The core principle
You cannot buy wealth on Meta in the GCC. There is no income, net-worth, or homeowner targeting
outside the US. High-value buyers come from four levers, strongest first:

1. **Geo** — city + drop-pin radius on affluent districts. The strongest wealth signal available.
2. **Price-anchored creative** — state a starting price or minimum project size in the ad. Cheapest filter that exists.
3. **Form qualification + a qualified-lead CAPI event** so Meta optimises toward buyers, not form-fillers,
   plus lookalikes seeded on the client's actual closed buyers.
4. **Luxury interest proxies (M2)** — weakest. Aspirational followers outnumber owners heavily here.

Interest stacks decide *who sees it*. The funnel decides *who qualifies*. Never expect the stack to do the funnel's job.

## Module system
Six reusable modules (M1 property-owner intent, M2 wealth proxy, M3 property buyer/off-plan,
M4 life event, M5 design taste, M6 trade/decision maker). Build any service audience as
`{primary module OR-list}` then **Narrow with** `{M2 or M6}`. M2 is never standalone.

Service → module map:

| Client service | Stack |
|---|---|
| Villa construction / turnkey | M1 ∩ M2 + affluent-district geo |
| Villa renovation / fit-out | M1 ∩ M5 |
| Interior design / decor | M5 ∩ M2 |
| Kitchens / joinery / furniture | (M1 ∪ M4) ∩ M5 |
| Marble / ceramic / materials showroom | consumer: M1 ∩ M5 · trade: M6 (materials interests don't exist — use Kitchen, Home improvement, Interior design as proxies) |
| Landscaping / pools | M1 (Gardening, Landscaping, Swimming pool) ∩ M2 |
| HVAC / smart home / MEP | consumer: M1 (Air conditioning, Home automation) · trade: M6 |
| Real estate developer / off-plan | M3 ∩ M2, add Frequent international travellers for expat investors |
| Facility management / maintenance contracts | M6 only |

## Standard per-client account skeleton (identical every time)
Naming: audiences `AUD \| {Client} \| {Purpose}`, ad sets `AS \| {Service} \| {Module} \| {Age}`.

Assets to create before launch:
- Pixel + a `QualifiedLead` custom conversion fed by CAPI from the qualified branch of the client's CRM workflow.
- `AUD | {Client} | SEED Buyers` (closed customers, value-based if order value exists) → LAL 1% and 1–5%, all target countries pooled.
- `AUD | {Client} | EXCL All Leads 180d` and `AUD | {Client} | EXCL Unqualified` — applied to every ad set.

Campaign: one CBO campaign per service line, 3 ad sets, per-ad-set minimum spend limits so CBO can't
starve a test in 48h:
1. `AS | Broad` — no targeting, Advantage+ Audience **ON**.
2. `AS | Stack` — the service module stack, Advantage+ Audience **OFF** (on = Meta ignores your stack and the test is unreadable).
3. `AS | LAL` — buyer lookalike, Advantage+ **OFF**.
Add a warm/retargeting ad set only once the client has >1,000 site visitors or video engagers.

Read at day 4 (kill only catastrophes), day 7, decide day 14. Judge on **cost per qualified lead**, never CPL.

## Notes
- Age: set the floor at the age the service can actually be bought at (villa/turnkey 30–60; kitchens/fit-out 28–55). Never 18–65.
- Geo: "People living in this location" only — never "recently in", which buys tourists.
- Same three exclusions on every ad set, every client. Most accounts arrive with clients-only or nothing.
