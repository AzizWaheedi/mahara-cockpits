# Worked Example: analyze-creative

## Scenario

**Account:** Apex Athletics US (e-commerce, fitness apparel)
**Maturity:** Developing
**Monthly spend:** $50K
**Target CPA:** $45
**Primary KPI:** CPA (Purchase)
**Testing framework:** 3:2:2 Method
**Weekly creative volume target:** 5 ads

---

## Step 0: Dependencies Loaded

From account-conventions:
- ad_account_id: act_123456789
- Target CPA: $45
- Warning threshold: CPA >$54 (20% above target)
- Critical threshold: CPA >$67.50 (50% above target)
- CTR warning: <0.01 (1.0%)
- Frequency cap warning: 2.5 (prospecting)
- Creative types active: static, video, ugc
- Naming convention: `{creative_type}_{concept}_{variant}_{format}`

From creative-strategy-methodology:
- Fatigue thresholds loaded (CTR -10% WoW = warning, etc.)
- Hook rate benchmarks loaded
- Volume target for $50K/month: 2-4 concepts/week, 5-10 ads/week

From account-maturity-methodology:
- Developing: moderate expectations, focus on establishing baselines

---

## Step 1: Data Retrieved

Ad-level insights returned 12 active ads across 3 campaigns:

| Ad Name | Campaign | Impressions (7d) | Spend (7d) | Clicks | CPA | CTR | Freq | 3s Views | 50% Views |
|---------|----------|-----------------|------------|--------|-----|-----|------|----------|-----------|
| VID_TESTIMON_V1_9x16 | CONV_PROS_US | 45,200 | $890 | 678 | $38.70 | 1.50% | 2.1 | 15,820 | 8,230 |
| VID_TESTIMON_V2_9x16 | CONV_PROS_US | 38,400 | $720 | 538 | $41.20 | 1.40% | 2.8 | 12,480 | 5,990 |
| STATIC_OFFER_V1_1x1 | CONV_PROS_US | 28,600 | $510 | 229 | $63.75 | 0.80% | 1.9 | -- | -- |
| VID_FOUNDER_V1_9x16 | CONV_PROS_US | 52,100 | $1,050 | 886 | $35.00 | 1.70% | 1.6 | 22,400 | 14,560 |
| VID_DEMO_V1_1x1 | CONV_PROS_US | 31,800 | $620 | 414 | $44.30 | 1.30% | 2.0 | 10,180 | 4,580 |
| STATIC_SOCIAL_V1_1x1 | CONV_PROS_US | 22,400 | $380 | 269 | $47.50 | 1.20% | 1.7 | -- | -- |
| UGC_UNBOX_V1_9x16 | CONV_PROS_US | 18,200 | $290 | 255 | $48.30 | 1.40% | 1.4 | 7,280 | 3,640 |
| VID_TESTIMON_V3_9x16 | TEST_US | 8,400 | $165 | 118 | $55.00 | 1.40% | 1.2 | 3,360 | 1,510 |
| STATIC_COMP_V1_1x1 | TEST_US | 6,200 | $130 | 56 | $65.00 | 0.90% | 1.1 | -- | -- |
| VID_DEMO_V2_9x16 | TEST_US | 5,800 | $105 | 81 | -- | 1.40% | 1.0 | 2,320 | 1,160 |
| CAROUSEL_BENEFIT_V1 | RT_US | 15,600 | $210 | 202 | $26.25 | 1.30% | 4.2 | -- | -- |
| VID_TESTIMON_V1_9x16 | RT_US | 12,800 | $180 | 179 | $22.50 | 1.40% | 5.8 | 4,480 | 2,690 |

Prior 7-day data also retrieved for WoW comparison (not shown in full).

---

## Step 2: Creative Scorecard

### Account Averages (calculated)
- Average CPA: $43.80
- Average CTR: 1.30%

### Scoring Each Ad

**VID_FOUNDER_V1_9x16:**
1. Efficiency: CPA $35 = 78% of target -> Score 5
2. CTR: 1.70% = 131% of avg -> Score 4
3. Frequency: 1.6 (prospecting) -> Score 5
4. Spend capacity: spending $150/day, budget allows $200 -> Score 4 (75%)
5. Hook rate: 22,400/52,100 = 43% -> Score 5
6. Hold rate: 14,560/22,400 = 65% -> Score 5
- **Composite: 4.7 (Star Performer)**

**VID_TESTIMON_V1_9x16 (Prospecting):**
1. Efficiency: CPA $38.70 = 86% of target -> Score 4
2. CTR: 1.50% = 115% of avg -> Score 3
3. Frequency: 2.1 -> Score 4
4. Spend capacity: 89% -> Score 4
5. Hook rate: 15,820/45,200 = 35% -> Score 4
6. Hold rate: 8,230/15,820 = 52% -> Score 4
- **Composite: 3.8 (Solid)**

**STATIC_OFFER_V1_1x1:**
1. Efficiency: CPA $63.75 = 142% of target -> Score 2
2. CTR: 0.80% = 62% of avg -> Score 2
3. Frequency: 1.9 -> Score 4
4. Spend capacity: 85% -> Score 4
- **Composite: 3.0 (Solid, borderline)**

**VID_TESTIMON_V2_9x16:**
1. Efficiency: CPA $41.20 = 92% -> Score 4
2. CTR: 1.40% = 108% -> Score 3
3. Frequency: 2.8 -> Score 2 (warning zone)
4. Spend capacity: 72% -> Score 3
5. Hook rate: 12,480/38,400 = 32.5% -> Score 4
6. Hold rate: 5,990/12,480 = 48% -> Score 3
- **Composite: 3.2 (Solid, but frequency warning)**

**STATIC_COMP_V1_1x1 (Test):**
1. Efficiency: CPA $65 = 144% -> Score 2
2. CTR: 0.90% = 69% -> Score 2
3. Frequency: 1.1 -> Score 5
4. Spend capacity: N/A (test, low budget by design) -> Score 3
- **Composite: 3.0 (Solid, but test -- needs more data)**

**VID_DEMO_V2_9x16 (Test):**
- Insufficient data ($105 spend, 5,800 impressions). Flagged as "Insufficient Data."

(Remaining ads scored similarly.)

### Final Classification

- Star Performers (4.0+): VID_FOUNDER_V1 (4.7)
- Solid (3.0-3.9): VID_TESTIMON_V1 (3.8), VID_TESTIMON_V2 (3.2), STATIC_OFFER_V1 (3.0), VID_DEMO_V1 (3.4), STATIC_SOCIAL_V1 (3.1), UGC_UNBOX_V1 (3.3), CAROUSEL_BENEFIT_V1 (3.5), RT VID_TESTIMON_V1 (3.6)
- Kill Candidates: STATIC_COMP_V1 (2.0 after 7 more days if no improvement)
- Insufficient Data: VID_TESTIMON_V3, VID_DEMO_V2

---

## Step 3: Fatigue Detection

**VID_TESTIMON_V2_9x16:**
- CTR: 1.40% current vs 1.58% prior = -11.4% (Warning: >10% decline)
- CPA: $41.20 current vs $36.80 prior = +11.9% (Below 15% threshold, monitoring)
- Frequency: 2.8 (Warning: >2.5 for prospecting)
- Classification: **Early Warning** (2 warning signals)

**STATIC_OFFER_V1_1x1:**
- CTR: 0.80% current vs 0.95% prior = -15.8% (Warning)
- CPA: $63.75 current vs $52.00 prior = +22.6% (Warning: >15%)
- Frequency: 1.9 (Healthy)
- Classification: **Active Fatigue** (2 warning signals, CPA significantly above target)

**CAROUSEL_BENEFIT_V1 (Retargeting):**
- Frequency: 4.2 (Below retargeting warning of 5.0, but worth monitoring)
- CTR: stable
- Classification: **Healthy** (retargeting thresholds are higher)

All other ads: **Healthy**

---

## Step 4: Format Analysis

| Format | Ads | Spend (7d) | Avg CPA | Avg CTR | Hook Rate | Win Rate |
|--------|-----|-----------|---------|---------|-----------|----------|
| Video | 6 | $3,550 | $39.50 | 1.44% | 36% | 67% |
| Static | 3 | $1,020 | $58.75 | 0.97% | N/A | 0% |
| UGC | 1 | $290 | $48.30 | 1.40% | 40% | 0% |
| Carousel | 1 | $210 | $26.25 | 1.30% | N/A | 100% |

**Finding:** Video outperforms static by 33% on CPA. Static ads are significantly underperforming. UGC has only 1 ad (underexplored).

**Format mix vs recommended (SaaS/B2B from methodology):**
- Video: 68% of spend (recommended: 30% UGC + 25% founder = 55%) -- overweight but performing
- Static: 20% of spend (recommended: 20%) -- on target but underperforming
- UGC: 6% of spend (recommended: 30%) -- significantly underrepresented
- Carousel: 4% of spend (recommended: 10%) -- underrepresented

---

## Step 5: Testing Analysis

- Ads launched in last 7 days: 2 (VID_DEMO_V2, VID_TESTIMON_V3)
- Weekly target: 5 ads
- Velocity: 40% of target (below expectations)

- Win rate (last 30 days): 1 winner out of 4 tests = 25% (above 15-20% benchmark)

- Missing concepts: Comparison (us vs alternatives), Before/After, Myth-busting

---

## Step 6: Outputs Generated

All four deliverables produced with the data above. Key recommendations:

1. **Scale VID_FOUNDER_V1** -- increase budget 20%, create 3 more variants with hook swaps
2. **Pause STATIC_OFFER_V1** -- CPA 42% above target, active fatigue, static format underperforming
3. **Brief 3 UGC concepts** -- format is underrepresented at 6% of spend vs 30% recommended
4. **Increase testing velocity** -- at 40% of target, need 3 more ads next week
5. **Monitor VID_TESTIMON_V2** -- early fatigue warning, prepare replacement testimonial
6. **Test comparison angle** -- no us-vs-them creative in rotation
