---
name: b2b-marketing-ops
description: Mahara Media's B2B paid ads strategy, KPI framework, constraint diagnosis, and scaling playbook. Used by the daily B2B marketing report cron.
---

# B2B Marketing Ops — Paid Ads Framework

## 3 Layers of KPIs (Priority Order)

### Layer 1 — The Only Metrics That Pay Bills
| Metric | Target | Notes |
|---|---|---|
| FE Cash ROAS | 3-4x (≥2x minimum) | Upfront cash collected ÷ ad spend |
| Contracted ROAS | 5-8x minimum | Total contract value ÷ ad spend |
| CPA (Cost Per Acquisition) | Varies (~$1,000-$2,000) | Total spend to get 1 client |
| CPA:LTGP Ratio | 1:4 minimum | CPA vs lifetime gross profit |

### Layer 2 — Core Conversion Metrics (Corrected Targets, Jul 2026)
| Metric | Target | Actual Jul MTD (Jul 21) |
|---|---|---|
| Link CTR | 1.2-1.5% | 0.87% |
| LP Conversion (click→lead) | 10-12% | 6.7% |
| CPL | $6-$9 | $9.95 (meta) / $8.13 (all) |
| Lead→Intro Booked | 80% | 72% |
| Intro Show Rate | 70% | 60% ← #1 bottleneck |
| Intro→Demo (of showed) | 55-60% | 44.6% MTD (55.3% current week ↑) |
| Demo Show Rate | 80% | 70.2% (↑ from 47%, same-day booking working) |
| Close Rate (2-call) | 20-25% | ~6% (still lagging — most Jul demos haven't closed yet) |
| Avg Upfront Cash/Close | $3,000 | $1,125 (3 of 4 only paid $500 onboarding fee) |

### Layer 3 — Diagnostic Micro Metrics
| Metric | Target |
|---|---|
| CTR | 2%+ |
| CPM | Flag if >$20 |
| Frequency | Watch if >2.5 (creative fatigue) |
| DQ Rate | Monitor trend |
| Video ThruPlay rate | Engagement signal |

## Golden Rule
**If Layer 1 is profitable, don't mess with winning campaigns just because a Layer 2/3 metric looks ugly.** Only optimize Layer 2/3 when Layer 1 is already healthy.

## Constraint Diagnosis Process
1. Compare actual vs targets weekly
2. Identify which layer has the problem (macro vs micro)
3. If macro (Layer 1 broken): likely offer/messaging problem — don't patch micro leaks
4. If micro (Layer 1 healthy but a Layer 2/3 metric is off): fix biggest lift + easiest implementation FIRST
5. Implement fix, measure, repeat

## Decision Framework for Ads
- **Green (2+ days):** Scale — duplicate winner, increase budget
- **Blue:** Monitor closely, prepare to scale
- **Yellow:** Test optimizations, watch trends
- **Orange:** Prepare to pause
- **Red:** Pause immediately

Need 3-5x target KPI spend across 4-6 days before judging an ad.

## Scaling Methods (in order)
1. **Vertical:** Duplicate winners, increase budget on duplicates
2. **Horizontal:** Test different audiences, slight creative variations
3. **Spherical:** Different creative concepts, actors, market segments (last resort)

## Aziz's Headline Metric (stated 2026-09-07)
He only cares about **cost per booked call** (and cost per qualified/bookable lead), not CPL. Disqualified bookings are irrelevant — exclude `calls.status='invalid'`. Always lead ad rankings with:
- $/booked intro call = spend ÷ intro calls booked with status <> 'invalid'
- $/booked call that showed (status in showed/confirmed) and $/demo booked
- Attribution: `COALESCE(calls.ad_id, leads.ad_id via contact_id)`, window on `calls.booked_at` (Asia/Riyadh).
- **Two intro calendars in GHL — both count as booked intro calls:** `cFeDl0FY8iaXll61lus8` and `dsqmJ393Dwl9fDSbIVOI` (both setter تحرير عبادي). Demo calendars: `NDBNz6Og4yfpdpWmHrue`, `jQqXS1YuFnmGZKLkrE62`. `calls.call_type` already classifies both intro calendars correctly.
- **Attribution: Aziz says essentially all bookings come from ads; some just lose the ad_id.** So the blended cost per booked call must divide total spend by ALL valid intro bookings, not only ad-attributed ones. Keep the attributed cut as a secondary line. (Sep 2026 attribution loss was only 3 of 40.)
- Blended spend must come from unfiltered `sum(spend)` over the window, not the >$5-per-ad table (Sep 1–6: $1,555.64 vs $1,493.58 filtered).
- Sep 1–6 2026: $39.89 per intro booked (39 valid of 40), $53.64 per booked call that showed, 7 demos booked, 0 closes [supabase, 2026-09-07].
- Pitfall: a per-ad table filtered to `HAVING sum(spend)>5` in-window undercounts bookings (ads that spent earlier still book calls). For blended cost per booked call, count all ad-attributed valid bookings, not the sum of the table rows.
Baseline Aug 1–Sep 6 2026: 289 intro booked / 258 valid / 236 ad-attributed → $31.92 per booked call, $52.67 per booked call that showed, $115.88/demo booked, CPA ~$1,255. DQ rate ~11% [supabase, 2026-09-07].

## Lead Quality vs Volume
- Even with good CPL, if leads don't close, the ad is losing money
- Track qualified lead % per ad (Demo Booked, Confirmed, Closed, Hot Lead stages)
- Cost per qualified lead matters more than raw CPL
- Sometimes intentionally higher CPL = better quality = lower CPA
- **Profit-level tracking:** Extract self-reported profit from `leads.raw_contact->'customFields'` field ID `IvdTSSuctezX9DTHo42K`. Values: "أقل من $100,000", "$100K - $250k", "$250k - $500k", "$500k - $1M", "$1M- $2.5M", "$2.5M+". Target: businesses above $100K profits.
- **Always verify Meta ad account statuses** before recommending pauses — some ads may already be paused by the team.

## Meta targeting / measurement facts
See `references/meta_targeting_verified.md` — live ad set settings, pixel/event setup, verified interest IDs
(and the many that are NOT targetable), LAL seed sizes, and the 65%-unqualified-bookings finding.
Always verify interests with `meta_ads_search_targeting` before recommending them.

## Mahara B2B Funnel
Ad → Landing Page → Opt-in → Intro Call Booked → Intro Call (setter) → Demo Booked (if qualified) → Demo Call (closer) → Close

## Supabase Data Source
Project: `flwboeijllbtrufxkhts` (Mahara B2B)
Key RPCs: `b2b_cockpit`, `b2b_marketing_daily`, `b2b_marketing_ads`, `b2b_window_metrics`, `b2b_pacing_pipeline`

## Cron
- **Path:** `/b2b/daily-marketing-report`
- **Schedule:** 8:00 AM Kuwait (0 5 * * 0-4,6 UTC), Sat–Thu
- **Pre-run:** `skills/b2b-marketing-ops/scripts/daily_b2b_prerun.py`
- **Arbitrary window (month-rollover fallback):** `scripts/window_fallback_queries.py START END` → `/work/temp/wk.json`
- **Close → ad attribution:** `scripts/close_attribution.py` (edit the date range in the CTE). `closed_deals` carries its own `ad_id`/`campaign_id`/`matched_by`; `matched_by='none'` = untraceable. The form's self-reported `lead_source` is unreliable — trust the ad_id.
- **Output:** Aziz DM (D0B21PZHDH9)

## Technical Notes
- Overloaded RPCs (`b2b_marketing_daily`, `b2b_marketing_ads`) need explicit casts: `'date'::date, 'date'::date, NULL::text[]`
- Two "System Explainer" ads share the same name but different IDs (`…600` vs `…450`) — always reference ad_id to avoid confusion
- Best CPL ads (Jul 21): Team sitting video $6.75, Lea Team sitting $8.26. System Explainer variants (44% of budget, $1,411) now PAUSED — only 1 close between them. Lea Team sitting is #1 ad: 2 closes, $339 CAC. Burnout From Work: best CPQL at $25 (50% quality rate).
- `meta_ad_snapshots` link click columns: `inline_link_clicks`, `cost_per_inline_link_click`, `inline_link_click_ctr`
- Monthly targets in Supabase `monthly_targets` table may need recalibration (flagged Jul 2026)

## Key Data Points (Jul 2026)
- Avg upfront cash per close: $3,000 (the $500 in closed_deals is just an ONBOARDING FEE; rest collected on onboarding call)
- June bank transfers: $43,370 — bulk is recurring book payments from existing client book.
- Cash engine = book size. ~$1,700/mo per active client. Need ~50-60 active clients for $100K/mo.
- Closers: Aziz, Ahmed Abushaiba, Ghanim Al Ghanim.
- Sales process: 2-call (intro setter → demo closer). Pre-call social proof + videos already sent.
- Close rate is THE binding constraint. **All 3 real July closes came from June demos** (Faris Jun 30 demo, Adwani Jun 22 demo, Laith no demo match). Zero July demos have closed yet → true 2-call close rate unknown until ~Aug.
- Faris: closed Jul 1 but didn't complete payment (deposit only, disappeared). Laith: $2K upfront total. Adwani: $3K.
- Elena Walsh ($23/$64) = test entry, exclude.
- Closers: Aziz, Ahmed Abushaiba, Ghanim Al Ghanim, **Samer Hadi** (some of Samer's demos are pipeline dials, not ad leads).
- Ad-lead-only show rates (Jul 19): Ahmed 64.3%, Ghanim 54.5%, Samer 56.3%, Aziz 100% (small sample).
- Every 5% close rate improvement saves $3-6K/mo ad spend.
- Aziz's $50K/$75K/$100K goals are in NEW CASH (new closes only), not total cash collected.
- Intro show rate (60% corrected) is #1 bottleneck. Demo show rate (70.2%) improving thanks to same-day booking at 65%.
- Booking lag is the biggest operational lever: same/next-day demos show 75% vs 60% for 2-3 day lag. 65% of demos are now same-day.
- Intro→Demo rate is 44.6% MTD but 55.3% this week — setter qualification improving.
- Closer show rates (Jul 21, ad leads): Samer 72%, Ahmed 66%, Ghanim 64%, Aziz 100% (small sample).

### Call Status Rules (from Aziz)
- For PAST calls: "showed" OR "confirmed" = showed up
- "noshow" = no-show, "invalid" = disqualified, "cancelled" = cancelled
- Don't count FUTURE "confirmed" as showed — wait until the day after
- Use `start_at` (appointment time) not `booked_at` (booking creation time) for when-did-the-call-happen filtering
- Close rate denominator = demos showed (showed+confirmed in past) from `calls` table
- Close rate numerator = new client forms from `closed_deals` table (exclude test entries like Elena Walsh $23/$64)

## Supabase Schema Notes
- `meta_ad_snapshots`: date column = `date` (not `snapshot_date`)
- `closed_deals`: close date = `submitted_at`, cash = `cash_collected`, contract = `contracted_revenue`
- `calls`: booking date = `booked_at`, outcome = `status` (showed/noshow/confirmed/cancelled/invalid)
- `leads`: created = `lead_created_at`, pipeline = `stage_name`, qualification = `opp_status`
- `transfers`: received = `received_at`, amount = `amount_usd`

## Reference Docs (Google Docs IDs)
| Doc | ID |
|---|---|
| Paid Ad KPIs & Math | `1_BtnWLQwb6qWUC0Loy1DDhgfhXa75amThq12juQeWsk` |
| Ad Pitfalls & Key Tips | `1Dd_VxexxYdD89VxXucpFijYHnyiFBWDaGW8lJMWIfyo` |
| Andromeda SOP | `1M5VtToFT9b_gRVnAr7fFc31Mn_vwiLVt9KumNO-m_Mc` |
| Media Buying Fundamentals | `1ULGkoMdb8hHIkrRiGuhRG7A6nlYyKzZMDdRsfemo9lE` |
| $0-$100/Day | `197Wpkydf0u2yUuMF7VJvdjlX_Vbplx96yhqFy1J75LY` |
| $100-$300/Day | `12iVLPU8ig0J2-fWOGJaXN2iwehLskAn_yr5u9H2Nak0` |
| $300/Day+ | `1acoWR8lfGPp-PksSxf-mjcjT0Vya5T2hsq-Qm9KIXag` |
| Diagnosing & Fixing Constraints | `1cioKqspTOI6zK76ob0lOTzfNLDMe5WS6NJ_hgTwb-p4` |
| Daily Ads Workflow - Basic | `1XU6bdwrBSPBX8SPrCuYe9fX8EDFzfiDZpglV5Ex8SE4` |
| July 2026 Plan & Projection | `1zqfRLcbrvTI6ZIvJi_JqzbUpjeOMOJlVdIplHmqN4ew` |

## Aug 2026 close-out (verified Aug 1–31) [supabase, 2026-09-01]
- Spend: lead gen $5,739.70 + retargeting $314.46 = $6,054.16. Leads 558, CPL $10.29. CAC $605.
- Intros booked 250 (lead→intro only 44.8% vs 80% target ← biggest leak). Intros held 253, shown 144 (56.9%).
- Demos booked 87, held 82, shown 47 (57.3%). Qualified demos 46.
- Closes 10, contracted $61,000 ($6,000/deal), contracted ROAS 10.1x. Close rate 21.3% live / 21.7% qualified — **close rate is now IN target; it is no longer the binding constraint** (July's ~6% was lag).
- Only 6 of 10 Aug closes were Meta-attributed (others: IG DMs, TikTok, referral) — don't credit ads with all closes.
- `closed_deals.cash_collected` = $500 onboarding fee ONLY — never use it as cash collected. Real cash lives in **Whop** (payments export/API) + off-platform providers/checks Aziz reports manually. Ask him for the Whop export + off-platform list.
- Aug cash reconciled: Whop net $22,333.01 (gross $23,999.01 − $1,666 refund) + $11,000 (2×$5,500 other provider) + $500 other provider + $1,333 check = **$35,166.01 total**. FE (new-client) $29,700 = 4.9x cash ROAS, $2,970/deal; back-end $5,466. Total cash ROAS 5.8x. [whop export + Aziz, 2026-09-01]
- Whop checkout is losing GCC cards to ZIP/postal verification failures ("billing postal/ZIP code doesn't match") — recommend disabling AVS zip check.
- Uncollected Aug: Arafat Algharieb $3,000 `open/incomplete` since Aug 6.
- Cockpit intro/demo "shown" counts include `invalid` (DQ'd on call) as showed: 144 = 97 showed + 17 confirmed + 30 invalid.

## Monthly one-pager
`scripts/monthly_onepager.py` renders the branded month-close overview PNG (KPI strip + funnel-vs-target + cash reconciliation + scenario columns) via `sdk.utils.render.html_to_image`. Edit the ROWS_* lists with the new month's numbers. Palette from Aziz's brand rules: navy #091333, cyan #00CFC8, cobalt #2E5BD6, Inter. Avoid mixing Arabic names inline with `$` amounts — RTL reorders them; transliterate or put the amount first.

## ROAS-form lead tags (GHL) — use for booking-rate math
Aziz's ROAS qualification form tags leads in `leads.tags`:
- `roas-unprepared` = fully disqualified, **not allowed to self-book** → ALWAYS exclude from any lead→intro-booked denominator.
- `roas-qualified` / `roas-unqualified` = form completed, allowed to book.
- **No roas-* tag** = NOT a plumbing failure. [aziz, 2026-09-07] These are inbound WhatsApp contacts auto-created by the WhatsApp API in the CRM (source NULL, no ad_id, 27 of 30 in Sep 1-6; 164 of 176 in Aug). They never saw the form, so **exclude them from every funnel denominator** rather than treating them as lost leads. Only untagged leads WITH an ad_id (3 in Sep 1-6) are real misses.
Correct metric: bookable form-completed leads → intro booked. Aug 2026: 261 bookable → 194 booked = **74.3%** (not the naive 44.8%). [supabase, 2026-09-01]
~~Aug finding: 175 untagged leads = webhook/tagging plumbing failure, ~$1,800 wasted spend/month.~~ **WRONG, retracted 2026-09-07** — they are WhatsApp inbound contacts (see above). Do not raise untagged leads as a leak again. Sept constraint order: cost per link click > lead quality at the form (bookable share of ad leads 67.5% Aug → 60.0% Sep 1-6) > intro show rate > demo show rate.
Open question for Aziz: intended rule for `roas-unqualified` (it books at 76.7% vs roas-qualified 70.6% → possible tag-hygiene issue).

## Sept 2026 plan model (agreed with Aziz 2026-09-01)
Assumptions: $6,000 lead gen, CPL held $9–10, bookable share 68.1% of leads, intro booked 74.3% of bookable, **intro show 60%** (Aziz: accept as natural), intro-shown→demo 60.4%, **demo show 75%**, **close 25%**.
Target: 583 leads → 397 bookable → 295 intros booked → 177 shown → 107 demos booked → 80 live demos → **20 clients / $59,400 new cash / $120,000 contracted / CAC $315**. Back-end $16,665–25,000 → total month $76–84K.
New primary KPI: **cost per bookable lead ≤ $15** (Aug $22.00). Also cost/intro booked ≤$20, cost/live demo ≤$75, CPA ≤$315.
Priority order: (1) fix untagged-lead routing + work backlog (worth ~6 clients/$18K per month), (2) demo show 57%→75% via mandatory same-day booking, (3) leave intro show alone.

## Finance mechanics (durable rules) [aziz+statements, 2026-09-01]
Point-in-time P&L numbers live in his own planning docs — **Month in Review** `13g8Rztu-kvigMAnPPQoEFMpukRmIyHb3-QN6KuxbNcg`, **September Plan** `1VNC6zYB6HSXy6qpHlLDDSd3FZZ5hxfGnJ6EKIG0dtN8`. Pull from those rather than trusting figures cached here. What stays true:
- **Use Meta's API spend as ad cost, never card charges** — the KWD card adds ~10% FX/bank markup.
- KWD statements show KWD then foreign amount in brackets; use USD where given, else KWD × ~3.16.
- Exclude `Card Payment - Tijari Mobile`, `Unload`, Weyay self-top-ups, food/grocery — transfers and personal, not business spend.
- Categorisation: Marketing = ad spend only. All SaaS (GHL, Higgsfield, Skool, Maqsam, Whop fees…) = Overhead. Payments to Abdullah Khaled Khaleel Humood = Labor. Denflow = personal, exclude.
- Largest overhead lines: GoHighLevel (~$1,150/mo run-rate) and **processing fees at ~4.46% of volume** — the processor rate is the only overhead lever worth pitching. He does NOT want software cancelled.
- **Payroll runs a month late** (July paid in August). Before quoting any month as final, ASK which lines actually left the account — accrual and cash views differ by a full payroll.
- Never surface any of this to the team (see his user skill).

### Client fulfillment KPI standard [aziz, 2026-09-01]
CPL **$10 stretch, $15 max** · lead→booking 30% · booking→show 75% · show→close 20% · tracking 100%. Daily ads brief reports pace against the monthly plan and names which number broke.

### Comp & docs
CSM Pay Structure `1CjwrBd6OFMI3j1fRYq1mJt83jeSQT76nF6U5ntspkZI` · Upsell Menu `1F04he2nna-1rljmlu-XxcAygWWZY0l4CC46__AcHOXI`. Branded docs: `MD=body.md TITLE="..." [DOC=id] uv run python skills/integrations/google_docs/scripts/branded_doc_tables.py` (real tables, ~4 API roundtrips each — background it for 15+ tables).

## Meta flexible ads (multi-text in one ad) — working recipe [meta, 2026-09-04]
- 5 bodies + 5 titles in `asset_feed_spec` alone = Dynamic Creative → ad creation fails ("Cannot create dynamic creative ad in non-dynamic creative ad set"), and dynamic ad sets allow only ONE ad (kills broad CBO).
- Working shape: `asset_feed_spec` with `optimization_type='DEGREES_OF_FREEDOM'` + bodies/titles/link_urls/call_to_action_types/ad_formats/videos, AND a full `object_story_spec.video_data` (video_id, image_url=video thumbnail, message=body[0], title=title[0], call_to_action LEARN_MORE with link). Without video_data Meta returns "The link field is required".
- Use `instagram_user_id` (not `instagram_actor_id`) in object_story_spec.
- Creative creation can fail generically while the video is still encoding; wait for `video_status: ready` and retry once.

## Live broad CBO test (Sept 2026) [meta, 2026-09-04]
- Campaign `MaharaMedia | Lead Gen | 4-9-26 | CBO` = `120255841789720242`, ad set `Broad | PPP | 4-9-26` = `120255841789820242`, 9 ads, $100/day, Schedule optimization. Older twin `120255841118100242` is ARCHIVED (Aziz republished via duplicate).
- Ads Manager edits/duplicates are invisible to the API until published; if objects read ARCHIVED and the duplicate is missing, it is an unpublished draft, not a failure.
- Standard UTM now: `utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&utm_placement={{placement}}`.
- `meta_ads_list_ads` with a broad `effective_status_filter` can return 0 rows; call it without the filter.

**Ad set count is a budget question, not a preference [aziz, 2026-09-05]:** never template a fixed
3-ad-set structure. Meta needs ~50 conversions/week per ad set to leave learning, so under $50/day
recommend ONE ad set, $50–99 two, $100+ three (lookalike only if the client has a real buyer seed
list). Aziz's rule for the cockpit generally: **recommend, never prescribe** — always leave a
free-text override that visibly wins over the recommendation. The goal for a media buyer tool is
coverage (30 → 60 accounts), not automation of the decision itself: Viktor triages all accounts and
hands over the 5 that need judgement; the human still decides.

## GCC learning database — what exists and what doesn't [supabase, 2026-09-05]
Creative-triage Supabase `bldgtotkfmhoxmlzowdx` is the spine: `ads_daily_snapshots` (11,085 rows,
2026-03→09, 530 ads, 32 clients, 4,275 leads, $88,327 spend), `appointments` (2,956; 979 carry
`adset_id`, so cost-per-booking is joinable to the ad set that produced it), `ghl_clients`
(country/city/language/service columns).
- **Targeting/interests are stored NOWHERE** — not in Supabase, not in the snapshots. Cannot be
  backfilled; only recorded going forward, and only on accounts with Meta partner access.
- **53 of 62 clients had no city and no service**; the 9 filled included `abc`/`xyz`. Correction
  sheet `10vGT2Jw43eCsSi5UfGY6O35_6pq-rjaEDi-fN86yZ-A`.
- Inferring client location without Meta access: **lead phone country codes** in `appointments`
  (966 SA · 965 KW · 974 QA · 971 AE · 973 BH · 968 OM) beat currency, which is billing-side and
  almost always USD. Meta ad-account `timezone_name` gives country but never city.
- `clients_full_profile_flat` in DATABASE-MAHARA is useless for enrichment — Google/Apple/Amazon
  test rows, 3 of 46 have Industry.
- **Cost per booking, not CPL, is the ranking metric.** Safad `30-12-25 | Video 8` runs $17.42 CPL
  (over the $15 gate) at $29/booking — third-best in the book. CPL-only triage kills winners.
- Half the winning ads are named `ad-1`/`ad-3`/`ad`: the data knows what won and can't say why.
  Naming convention (angle · offer · format) is the cheapest fix; transcribing winners is the
  retroactive substitute.

### Superseded Sept-6 breakeven models — DO NOT QUOTE
The 2026-09-06 versions (breakeven 2 clients / 7 clients, $12,900 fixed payroll, closer paid 12.5% of full deal value, backend treated as $16K recurring) are all superseded by "Break-even math (real payroll, 2026-09-08)" + "Roster correction" below. Use those.
Still valid from that day: Sept 1–6 actuals — lead gen $1,187.52 + retargeting $44.65 · 74 leads · 51 bookable · CPL $16.05 · intro show 19/40 = 47.5% · demo show 8/10 = 80% · 0 closes.

### Why margin feels thin — standing diagnosis [derived, 2026-09-06]
Not a margin problem, a **collection + reserve** problem. Use this framing when Aziz asks why profit feels low:
1. Collects ~49% of contracted value in-month ($61,000 contracted → $29,700 new cash in Aug) while carrying 100% of fulfilment cost immediately.
2. Back end only 16% of cash ($5,466 of $35,166) despite a $38,664 book — the book exists, the collecting doesn't ($8,416 overdue; 12 onboarding clients have blank Next Payment Date). NB: that book is a 90-day burn-off, not MRR (see below).
3. Labour 72% of collections in Aug (38% excluding the July catch-up); guaranteed payroll now $12,900/mo before any deal closes.
Counter-framing that is TRUE and worth repeating: CAC $605 on a $6,000 contract = 10x; unit economics are healthy.
Leakage ~$5,000/mo: processing 4.46% (~$3,100), FX ~$613, untagged spend ~$1,800, plus one-offs (GHL double bill $530, $1,666 refund).
Behavioural fixes recommended: one fixed owner draw on a fixed date (he made 8 ad-hoc top-ups totalling $2,556 in Aug → income never registers); 5% of every collection swept to an untouchable second account for a reserve.

## Bottleneck decomposition method (Sep 1-6 2026 run)
Full-funnel per-ad/per-adset query pattern: `meta_ad_snapshots` (spend, impressions, inline_link_clicks → CPM, link CTR) joined to `leads` by `ad_id` (opt-ins, `tags` roas-* for bookable/unprepared/untagged) joined to `calls` on `coalesce(calls.ad_id, leads.ad_id)`. Dates in Asia/Riyadh. `meta_ad_snapshots` has NO landing-page-view column, so **opt-in rate = leads / inline_link_clicks** (state the caveat: ~33% of leads carry no ad_id, so leads-over-clicks is generous; also report ad-attributed-only).
Beware per-adset `booked / bookable` >100%: bookings in-window can belong to leads created before it. Only the account-level chain is safe for rate math.
**Sep 1-6 vs Aug 2026:** CPM $11.81 vs $9.19 (+28%); link CTR 0.86% vs 1.01%; **cost per link click $1.37 vs $0.91 (+51%)** = the entire cause of cost/booked call $40.04 vs $27.82. Opt-in 9.1% vs 8.3% and bookable→booked 84.8% vs 82.3% both IMPROVED, so the landing page and setter were not the constraint. [supabase+meta, 2026-09-07]
Worst CTR line item: `Empty Showroom | Kitchen & Baths | 28-7-26` at 0.64% on $461 (30% of budget, 50% qualified, $46.12/booked). Best ad: `Lea Team sitting video | 20-2-26` $28.76/booked, 90.9% qualified. Use **ad-attributed leads only** as the funnel denominator (WhatsApp contacts pollute the raw lead count): Sep 1-6 = 1,136 clicks → 70 ad leads (6.2% opt-in) → 42 bookable (60.0%) → 38 booked (90.5%); Aug = 6,713 → 357 (5.3%) → 241 (67.5%). Secondary constraint is therefore **form lead quality** (roas-unprepared 31.1% → 35.7%), not tagging plumbing.

## Break-even math (real payroll, 2026-09-08)
**Real roster and commission structure live in the Sep-planning DM thread
`$SLACK_ROOT/Aziz/threads/1788246909.228639.log` — use it, never estimate salaries.**
Fixed payroll $12,900/mo: 3 call-centre agents $3,000 · systems mgr $1,200 · 2 client editors $1,400 ·
extra client editor $700 · own-content editor $700 · second editor $800 · creative director (Sabri) $1,000 ·
media buyer $800 · studio $700 · web dev $700 · setter base $600 · CSM base $1,300. Only $2,800 of that is
growth cost; $10,100 is delivery.
Commission per new client: **closer 12.5% of UPFRONT CASH COLLECTED = $375 on a $3,000 upfront, not 12.5%
of the $6k deal** [aziz, 2026-09-08] + $250/paid-in-full ·
setter $5 per showed intro AND showed demo (~17 shows = $85) + $50/close · CSM up to $2,900 at full target
(retention/upsell/renewal/referral/testimonial/review/podcast). **Payment processing is 4.46%, not 3%.**
Upfront cash per close averages $3,000 (deposit + onboarding), rest across the 90 days.
**Aziz's trimmed fixed roster [aziz, 2026-09-08] = $8,400/mo:** 2 call-centre agents $2,000 · CSM $1,300 ·
creative director $1,000 · media buyer $800 · ONE editor $700 · studio $700 · web dev $700 ·
systems manager part-time $600 · setter $600. (The $12,900 above was the untrimmed September plan.)
**Software = $6,332/mo (Maqsam is INSIDE this line, not on top), from August bank actuals** (overhead $7,403 minus $1,071 processing)
[bank, 2026-08]. Never estimate this line at ~$2,800; that error made a wind-down look survivable when it
actually costs ~$21.7K. Software does NOT scale down with the sales team, it scales with accounts serviced.
Also live: $613/mo FX markup because Meta is funded from the dinar card, not a USD account.
Monthly base = $8,400 fixed + $8,156 ads + $6,332 software + $1,000 CSM performance = $23,888.
Variable per close = $644 (closer $375 + setter $135 + processing $134). Each client nets $2,356 of its
$3,000 upfront. **Break-even = 6.5 closes/mo** against $9,066 of realistic backend (6 closes = -$1,089,
7 = +$1,267).
Onboarding/upfront cash for the onboarding pipeline is ALREADY COLLECTED at signup — never model it as
future upside [aziz, 2026-09-08].
Closes per booked intro = intro_show x intro_to_demo x demo_show x close_rate. At Sep 8 rates
(0.698 x 0.162 x 0.769 x 0.125 = 0.0109) that needs 480 booked intros/mo against ~219 actual, i.e.
impossible. At target intro-to-demo 55% and close 20% (0.0590) it needs 89. Same traffic swings the
business from -$13.8K/mo to +$37.3K/mo run-rate (commission scales with closes). Cost per booked intro $37.31 [supabase/meta, 2026-09-08].
Use this framing whenever Aziz asks about runway, break-even, or whether to scale spend: the binding
constraint is intro-to-demo, not budget.

### Backend is a 90-day burn-off, not MRR [2026-09-08]
Every contract is 90 days, so the book's collectible decays to zero ~90 days after the last launch
(Sep 2026 book: $9.1K Sep, $22.6K Oct, $7.2K Nov, $0 Dec). Never present backend as recurring.
The only real recurring line is the **$12,000 / 6-month backend renewal that fires 14 days before term
end** = $2,000/mo per client. 6 renewals ≈ 60% of the trimmed fixed base with zero ad spend or new-logo
commission. Renewal conversations for a September launch cohort must be booked in late November.
At $3,000 upfront, 7 closes/mo is break-even. Winding the business down instead costs ~$21.7K out of
pocket, because software/Maqsam and the delivery crew run until the last 90-day term ends.

## Roster correction [aziz, 2026-09-08]
No web developer exists, remove from all models. Call-centre agents are $800 each, not $1,000.
Delivery-only trimmed fixed roster = $6,000/mo (2 agents $1,600, CSM $1,300, creative director $1,000,
media buyer $800, 1 editor $700, systems manager part-time $600). September keep-running break-even
drops to ~5.5 closes at $3,000 upfront cash.

## Never refund to exit early [modelled 2026-09-08]
Stopping mid-term and refunding unearned months is worse than fulfilling at EVERY cut-off:
end Sep -$47.8K, end Oct -$27.9K, end Nov -$8.0K vs full term. Refunds are cash out today against
only $6-10K/mo of saved cost, and the newly launched cohort holds the most unearned cash
(stopping 30 Sep would owe $35,435 liquid). Exception is per client only: release accounts whose
remaining delivery cost exceeds remaining collections and whose unearned balance is small.

### Card statement / subscription parsing [2026-09-09]
`scripts/parse_card_statement.py` parses the KWD Burgan card statement text into vendor totals. Pipeline: `pypdfium2` → text → regex `P-\d+-(name) /\d+ -\n\((CUR)\n(KWD)\n(FX)\)`. Second number = foreign amount (use it when CUR=USD), else KWD × 3.16. Second card is a CSV export (`usd_amount`, skip `status=declined`).
August 2026 subscriptions **$6,317.03 / 38 vendors / 67 charges** [card statements, 2026-09-09] (I first miscounted these as 36 vendors / 81 charges — count from the parsed rows, don't eyeball). Top: Maqsam $1,343 (usage-based, grows with dial volume) · **GoGHL $1,064** · Higgsfield $804 · **GoHighLevel CRM $617** · Viktor.com $400 · Anthropic $305 · ClickUp $290.
**GOGHL and HIGHLEVEL are two different vendors — never merge them on the name.** GoGHL = AI product, $532/mo (August statement holds July + August cycles = $1,064; this is NOT a double-bill — I wrongly told Aziz to claim $530 back on 2026-09-09 and had to correct it). GoHighLevel CRM = $497 agency subscription + ~12 × $10 usage top-ups = ~$617/mo. Overhead total $7,404.30 incl. Whop fees $1,070.82 + 40 decline fees $16.45.
Duplication found: two video hosts (Wistia $99 + Vidalytics $79), three deck tools (Pitch, Gamma, Slides) ≈ $190/mo.
Live sheet: **Mahara Media — Software & Subscriptions** `183zGLw7V_wI4uwZ0qYPDbUJxHREbcyiTP4f5zPE0bok`, tab per month (`Aug 2026`). Built in ONE `pd_google_sheets_proxy_post` to `https://sheets.googleapis.com/v4/spreadsheets` with `sheets[0].data.rowData` — creates the file, values and formatting in a single call with no draft/approval round-trip, unlike `new_spreadsheet` + `add_rows`. Proxy GET responses here need `json.JSONDecoder().raw_decode()`, plain `json.loads` fails on trailing data.
