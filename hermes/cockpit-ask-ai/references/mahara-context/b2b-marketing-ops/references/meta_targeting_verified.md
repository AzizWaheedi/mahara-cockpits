# Mahara B2B — Meta targeting facts (verified 2026-08-04)

## CPM diagnosis: Broad | PPP | 4-9-26 [meta_ads, 2026-09-07]
Broad ad set `120255841789820242` (campaign `120255841789720242`, launched Sep 4) ran $22.29 CPM vs $10.09 (Interest Stack `120255141241350242`) and $10.12 (PPP Renovation `120254816762770242`), rising daily ($19.75 → $22.01 → $25.31). Verified causes:
- OFFSITE_CONVERSIONS on SCHEDULE with ~6 leads in 3 days → never exits learning (~50 conv/wk needed). Broad targeting does NOT lower CPM when optimizing a deep event.
- 9 creatives splitting ~$95/day → per-ad volume too low to build engagement history (Lead Filtration Hook 3: $96.86 CPM on 121 impressions).
- `attribution_spec` = 7d click ONLY — but so are Interest Stack and 1% LAL, so attribution does NOT explain the gap (only the older 4-12-25 ad sets carry 7d click + 1d view + 1d engaged video). Corrected same day after Aziz pushed back.
- **Optimization event is SCHEDULE on EVERY ad set in the account** (verified via API 2026-09-07): Broad 4-9 and all 4-12-25 sets = OFFSITE_CONVERSIONS/SCHEDULE; 7-8-26 CBO sets (Interest Stack, 1% LAL, Broad 25-65) = VALUE/SCHEDULE. All three campaigns are objective OUTCOME_LEADS at campaign level — that campaign objective is what Ads Manager shows as "Leads"; do not read it as the optimization event.
- Dominant CPM driver is creative age / per-ad volume: inside the broad set CPM scales inversely with impressions (Seen First Hook 1 at 6,233 impr = $17–26; Lead Filtration hooks at 81–194 impr/day = $27–97). The $10 CPM sets run months-old Team sitting videos. Secondary: broad uses Advantage+ placements + `frequently_in` vs restricted FB/IG feed-story-reels on the cheap sets, so inventory differs.
- Stray `subscriber_universe` WhatsApp customer base while `destination_type=WEBSITE`.
- Broad ad set has no `publisher_platforms`/positions (Advantage+ placements); older ad sets restrict to FB+IG feed/story/reels — so placements are not the CPM driver.
Fix proposed to Aziz: keep only Seen First Hook 1 + 2, judge on cost per booked call ($32.03, better than Kitchen & Baths $41.92), not CPM.

### Do NOT duplicate a campaign to fix high CPM (researched 2026-09-07)
A duplicate gets a new asset ID with zero delivery history → restarts learning, inflated CPM for ~5–14 days; no auction signals transfer. Duplication is a scaling tool for proven winners, not a repair tool. Documented fix for learning-limited/expensive delivery is **consolidation**: fewer ads/ad sets so units clear ~50 events per 7 days. Creative fragmentation warning: N near-identical ads = one targeting instruction repeated N times (Search Engine Land, 2026-09-02). Broad targeting normally runs 10–26% CHEAPER CPM than interest stacks, so an expensive broad set points at creative/history, not targeting. Escalation ladder given to Aziz: consolidate → wait 7 days → only then consider switching the ad set event from SCHEDULE to Lead (rare-event remedy; that edit also resets learning).

## Live setup (act_746108264865897, MaharaMedia)
- Campaign `MaharaMedia | Lead Gen | 4-12-25` (`120241804048580242`), ABO, 3 active ad sets @ $50/day.
- All ad sets: pixel `850580864362564`, `custom_event_type: SCHEDULE`, geo SA/AE/KW/QA/BH (**Oman missing**),
  age 18–65, Advantage+ Audience **ON**, attribution 7d click / 1d view.
- Only exclusion in use: `client_exclusion_audience.csv` (existing clients). No all-leads or unqualified exclusion.
- **Zero custom conversions** exist in the account.

## Lead quality reality (last 8 weeks, as of Aug 2026)
527 unique intro bookings. Self-reported profit (`customFields` id `IvdTSSuctezX9DTHo42K`):
under $100K = 341 (65%), $100–250K = 73, $250–500K = 33, $500K–1M = 51, $1–2.5M = 11, $2.5M+ = 14.
→ Qualified bookings ≈ 23/week, below Meta's 50/wk/ad-set learning threshold.
Implication: build a `QualifiedSchedule` custom conversion for reporting + LAL seed, but only switch it to the
optimization event after consolidating to 1–2 ad sets.

## LAL seed sizes
demo-attended contacts 624 · all demo contacts 878 · intro contacts 1185 · closed deals 37.
Leads table: 4273 total, 2766 with email, 3133 with phone. `fbc` present on only ~19% → CAPI match leans on phone (E.164).

## Verified targetable interests (searched via meta_ads_search_targeting)
Computer-aided design `6003647235838` · Autodesk 3ds Max `6003095963458` · Architecture `6004140335706` ·
Architectural engineering `6003346781327` · Construction engineering `6003306362021` · Construction management `6003142479061` ·
Civil engineering `6003632260183` · Interior design `6002920953955` · Interior architecture `6003350422793` ·
Facility management `6003695017513` · Project management `6003225004145` · Construction (industry) `6003395414271` ·
Home construction `6003574304918` · Renovation (construction) `6002979893723` · Building material `6002951756355` ·
Concrete `6003384841565` · Property development `6003332796032` · Construction services and organisations `6803923102411` ·
Power tool `6003488524831` · Woodworking `6003335221357` · Caterpillar Inc. `6003264878514` · JCB `6003382667344` ·
Makita `6003274916508` · DeWalt `6003266134514` · Robert Bosch GmbH `6003655319220` · Grohe `6003291420979`
Narrowing (behaviors): Small business owners `6002714898572` · Small B2B enterprise employees 10–200 `6080792282783`

## DO NOT recommend — not targetable on Meta (return unrelated results)
AutoCAD, Revit, SketchUp, ArchiCAD, Lumion, Primavera, LEED, Hilti, Sika, Knauf, Saint-Gobain, Häfele, Blum, Jotun.
Certifications/job titles are effectively dead (PMP 11.5k, Quantity Surveyor 14.8k worldwide — useless after GCC filter).
**Always verify interests with `meta_ads_search_targeting` before recommending them.**

## Supabase schema gotchas (project flwboeijllbtrufxkhts)
- `calls` uses `booked_at` / `start_at` (NOT `start_time`); `call_type` in (intro|demo);
  `status` in (showed|noshow|confirmed|cancelled|new|invalid).

## Renovation + showroom expansion (verified 2026-08-07, act_746108264865897)

### Owner-tier additions (highest signal, safe to add to the main stack)
Retail Page admins (behaviour) `6020530250383` — best showroom-owner signal on the platform ·
Interior design services and professionals `6791338191990` · Design trade shows and professional organisations `6790348659210` ·
home renovations `6003437629554` · Home furnishings retailers `6791338127990` · Hardware store `6003227113338` ·
home-improvement centre `6016008329543` · Retail (industry) `6003778400853` · Department store `6003196691872` ·
Wholesale (retail) `6003107626192` · Warehouse (industry) `6003253278111` · Business-to-business `6004040547748` ·
Small business `6002884511422` · Entrepreneurship `6003371567474` · property appraisal `6003398434130` ·
Residential property `6849417269780`
Other Page-admin behaviours: Facebook Page admins `6015683810783` · New Page admins `6041891177783` ·
Business Page admins `6020530281783`

### Trade / material interests — WORKER-HEAVY, only in a separately narrowed ad set
These skew to tradesmen and site labour in the GCC, not owners. Always Narrow with an owner layer
(Retail Page admins / Business Page admins / Small business owners / Business decision makers).
Flooring `6003321193914` · Laminate flooring `6002943145846` · Tile `6003432760175` · Ceramic `6003190695201` ·
Masonry `6003254548488` · Cement `6003382422181` · Stainless steel `6003649920113` · Metal `6003276721810` ·
Glass `6003289482743` · carpentry `6003287989541` · Plumbing `6003469754863` · HVAC `6003021624293` ·
Electrical wiring `6003186691855` · Bathroom (architecture) `6003234103485` · Cabinetry `6009938882662` ·
Wallpaper `6003347134405` · Landscape architecture `6003135760608` · house painter and decorator `6003728625553` ·
Roofing Contractor `6003009740281`

### Brands (verified)
Milwaukee Electric Tool `6003248914467` · Stanley Black & Decker `6003445953080` · Black & Decker `6003329838643` ·
Husqvarna `6003426751919` · KOHLER `6003149658549` · Hansgrohe `6003381928218` · Villeroy & Boch `6002988868846` ·
Sherwin-Williams `6002990311259` · IKEA `6003427723137` · The Home Depot `6003178845152`

### Correction to the earlier "not targetable" list
`Ceramic` and `Tile` DO exist as standalone interests — only the phrase "Ceramic tile" fails. Marble still has no interest.
Still dead: Hilti · Jotun (work_employer only, 4.2k) · Mapei · Porcelanosa · RAK Ceramics · TOTO · Duravit ·
"Sanitary ware" · "Interior fit-out" · "Showroom" · "Building materials retail"

### Stack-size warning
Architecture (591M), Interior design (849M), Project management, Construction (industry) already make any stack
containing them effectively broad — Meta spends into the largest interest in an OR-list. Adding more interests
does not increase precision; the **Narrow-with owner layer** is what does. Advise adding narrowing, not breadth.

## Layer-2 narrowing (owner layer) — verified sizes 2026-08-07, worldwide lower bound
BEST (behavioural proof of running a business):
Business Page admins `6020530281783` (62.1M) · Instagram business profile admins `6297846662583` (87.5M) ·
Small business owners `6002714898572` (48.3M) · Retail Page admins `6020530250383` (17.4M)
Firm-size (industries): Small B2B 10–200 `6080792282783` (98.9M) · Medium B2B 200–500 `6080792228383` (38.3M) ·
Large B2B 500+ `6075565069783` (222.4M — too broad, skip)

**Company revenue / size targeting EXISTS** (industries type, small pools):
Company revenue <$1M `6377169088983` (3.26M) · $1M–$10M `6377168992983` (1.81M) · >$10M `6377408081983` (1.18M)
Company size 1–10 `6377169550583` · 11–100 `6377134779583` (1.48M) · 101–500 `6377169297783` · 500+ `6377408290383`
Closest thing Meta has to a revenue filter — ideal for Mahara's under-$100K junk-lead problem, but the pools are
worldwide totals, so in 6 GCC countries they may be too small to spend $30/day. Test as its own ad set, don't rely on it.

### CORRECTION — do not use these (I wrongly recommended them 2026-08-04/07)
Business decision makers `6262428231783` = **41,773 worldwide**. Business decision maker titles and interests
`6262428209783` = 41,774. IT decision makers `6262428248783` = 13,777. All effectively dead — unusable at any budget.
Always pull `audience_size_lower_bound` before recommending an `industries`-type option; several are tiny.

## UTM / attribution plumbing (audited 2026-09-07)
65 active ads, TWO url_tags schemas:
- **Schema A (47 ads, all except broad 4-9-26):** `utm_source={{site_source_name}}&utm_medium={{adset.name}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&medium_id={{adset.id}}&content_id={{ad.id}}` (no utm_term).
- **Schema B (9 ads, Broad|PPP|4-9-26):** `utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&utm_placement={{placement}}`.
- **9 ads with no UTMs by design:** `Vid 20`–`Vid 28` retargeting videos in "Hammer Them [LFC]" ad sets, `destination_type=ON_VIDEO`, no link.
All ads land on `https://funnel.maharamedia.com/`. Form (screenshot 2026-09-07) tracks only the 5 default utm_* params mapped to same-named GHL fields → `utm_placement`, `campaign_id`, `medium_id`, `content_id` are captured by nobody.
Attribution reality: GHL native `attributionSource`/`lastAttributionSource` are **empty on every lead**; all ad attribution flows through the form's custom-field mapping (campaign name, adset name, adset id, ad name, source fb/ig). Single point of failure.
Unattributed intro bookings since Aug 1: **27 of 295 (9%)**; September 2 of 44 (4.5%) — normal is 10–25%. Causes: ROASForm with UTM tracking disabled (13, real bug), `instagram ads` with empty attribution (9, profile/DM/ON_VIDEO), WhatsApp/social session (3), unrendered `{{site_source_name}}` macro (1 booking, 11 contacts total), blank (2).
Recommendation given: standardize on Schema B + append `campaign_id`/`adset_id`/`ad_id`/`fbclid`, add those as form custom params, enable UTM tracking on ROASForm. Caution: editing `url_tags` is a creative-level edit and can reset that ad's learning — roll out gradually, not on the broad set mid-test.
