# Output Specifications: analyze-creative

## Deliverable 1: Creative Scorecard

### File Naming
`{account_slug}_creative-scorecard_{YYYY-MM-DD}.md`

### Template

```markdown
# Creative Scorecard: {account_name}
Generated: {YYYY-MM-DD} | Period: {start_date} to {end_date}
Account Average CPA: ${avg_cpa} | Target CPA: ${target_cpa}
Account Average CTR: {avg_ctr}% | Active Ads Analyzed: {count}

---

## Star Performers (Score 4.0+) -- Scale These

| Ad Name | Format | Concept | Spend | CPA | vs Target | CTR | Freq | Hook | Hold | Score | Action |
|---------|--------|---------|-------|-----|-----------|-----|------|------|------|-------|--------|
| {name}  | {type} | {concept} | ${spend} | ${cpa} | {pct}% | {ctr}% | {freq} | {rate}% | {rate}% | {score} | Scale budget +20% |

**Total spend on Star Performers:** ${amount} ({pct}% of total)
**Combined CPA:** ${cpa}

---

## Solid Performers (Score 3.0-3.9) -- Maintain

| Ad Name | Format | Concept | Spend | CPA | vs Target | CTR | Freq | Hook | Hold | Score | Action |
|---------|--------|---------|-------|-----|-----------|-----|------|------|------|-------|--------|
| {name}  | {type} | {concept} | ${spend} | ${cpa} | {pct}% | {ctr}% | {freq} | {rate}% | {rate}% | {score} | Maintain, monitor fatigue |

---

## Underperformers (Score 2.0-2.9) -- Optimize or Replace

| Ad Name | Format | Concept | Spend | CPA | vs Target | CTR | Freq | Hook | Hold | Score | Issue | Action |
|---------|--------|---------|-------|-----|-----------|-----|------|------|------|-------|-------|--------|
| {name}  | {type} | {concept} | ${spend} | ${cpa} | +{pct}% | {ctr}% | {freq} | {rate}% | {rate}% | {score} | Low CTR | Test new hook |

---

## Kill Candidates (Score <2.0) -- Pause Immediately

| Ad Name | Format | Concept | Spend | CPA | vs Target | CTR | Score | Reason |
|---------|--------|---------|-------|-----|-----------|-----|-------|--------|
| {name}  | {type} | {concept} | ${spend} | ${cpa} | +{pct}% | {ctr}% | {score} | CPA 2x target, CTR below average |

**Estimated daily savings from pausing Kill Candidates:** ${amount}

---

## Insufficient Data (Monitor)

| Ad Name | Format | Impressions | Spend | Days Active | Note |
|---------|--------|-------------|-------|-------------|------|
| {name}  | {type} | {count}     | ${spend} | {days} | Need {amount} more spend for scoring |
```

### Field Definitions

| Field | Definition | Format |
|-------|-----------|--------|
| Format | Creative type parsed from naming convention | STATIC, VID, UGC, CAROUSEL, COLL, DPA |
| Concept | Concept name parsed from naming convention | Short name (e.g., TESTIMON, FOUNDER) |
| vs Target | (CPA - target) / target * 100 | Negative = below target (good), positive = above |
| Hook | 3s video views / impressions * 100 | Percentage, video only |
| Hold | 50% video views / 3s video views * 100 | Percentage, video only |
| Score | Composite score (avg of applicable dimensions) | 1.0-5.0, one decimal |
| Action | Recommended next step | Scale / Maintain / Test new hook / Pause |

---

## Deliverable 2: Fatigue Alert List

### File Naming
`{account_slug}_fatigue-alerts_{YYYY-MM-DD}.md`

### Template

```markdown
# Fatigue Alerts: {account_name}
Generated: {YYYY-MM-DD}
Ads Analyzed: {count} | Fatiguing: {count} ({pct}%)

---

## Critical Fatigue -- Action Required Today
{count} ads | Combined daily spend: ${amount}

| Ad Name | Days Active | Frequency | CTR Trend | CPA Trend | Signals | Action |
|---------|-------------|-----------|-----------|-----------|---------|--------|
| {name}  | {days}      | {freq}    | {pct}% WoW | +{pct}% WoW | CTR -22%, Freq 3.8, CPA +28% | Pause, brief replacement |

---

## Active Fatigue -- Action Required This Week
{count} ads | Combined daily spend: ${amount}

| Ad Name | Days Active | Frequency | CTR Trend | CPA Trend | Signals | Action |
|---------|-------------|-----------|-----------|-----------|---------|--------|
| {name}  | {days}      | {freq}    | {pct}% WoW | +{pct}% WoW | CTR -12%, Freq 2.8 | Reduce budget 30%, prepare replacement |

---

## Early Warning -- Monitor, Prepare Replacements
{count} ads | Combined daily spend: ${amount}

| Ad Name | Days Active | Frequency | CTR Trend | CPA Trend | Signals | Action |
|---------|-------------|-----------|-----------|-----------|---------|--------|
| {name}  | {days}      | {freq}    | {pct}% WoW | Stable | Freq 2.3 (rising) | Brief replacement, launch next week |
```

---

## Deliverable 3: Refresh Priority List

### File Naming
`{account_slug}_creative-refresh-priorities_{YYYY-MM-DD}.md`

### Template

```markdown
# Creative Refresh Priorities: {account_name}
Generated: {YYYY-MM-DD}
Total creative production needed this sprint: {count} concepts / {count} ads

---

## Priority 1: Fatiguing Replacements (Produce This Week)

| # | Replacing | Concept | Why | Brief | Variants Needed |
|---|-----------|---------|-----|-------|----------------|
| 1 | VID_TESTIMON_V2 | Testimonial | Critical fatigue, freq 4.2, CPA +35% | New customer testimonial, different pain point, keep format | 3 |

---

## Priority 2: Format Gaps

| # | Missing Format | Recommended Share | Current Share | Gap | Brief |
|---|---------------|-------------------|---------------|-----|-------|
| 1 | UGC video | 30% | 5% | -25pp | 3 UGC concepts: unboxing, workflow demo, reaction |

---

## Priority 3: Concept Gaps

| # | Missing Angle | Last Tested | Why It Matters | Brief |
|---|--------------|-------------|----------------|-------|
| 1 | Comparisonus_vs_them | Never | High-intent angle, no creative running | Side-by-side with top 3 alternatives |

---

## Priority 4: Variant Expansion (Winning Concepts Need More Variants)

| # | Winning Concept | Current Variants | Target | Score | Brief |
|---|----------------|------------------|--------|-------|-------|
| 1 | FOUNDER_V1 | 1 | 3-5 | 4.5 (Star) | New hooks on same founder script, test 9:16 and 1:1 |
```

---

## Deliverable 4: Creative Test Plan

### File Naming
`{account_slug}_creative-test-plan_{YYYY-MM-DD}.md`

### Template

```markdown
# Creative Test Plan: {account_name}
Sprint: {week_start} to {week_end}
Testing Method: {testing_framework}
Testing Budget: ${amount}/day ({pct}% of total)

---

## New Tests to Launch

| # | Concept | Format | Angle | Variants | Hypothesis | Success Metric | Budget |
|---|---------|--------|-------|----------|------------|----------------|--------|
| 1 | Customer testimonial (new customer) | UGC Video | Social proof | 3 (hook swap) | New face refreshes social proof signal | CPA < ${target} | ${amount}/day |

---

## Graduating from Last Sprint

| Ad Name | Test Start | Result | CPA | CTR | Score | Action |
|---------|-----------|--------|-----|-----|-------|--------|
| VID_DEMO_V3_9x16 | {date} | Winner | ${cpa} | {ctr}% | 4.2 | Move to scaling campaign via Post ID #{id} |

---

## Killing from Last Sprint

| Ad Name | Test Start | Spend | Result | Reason | Replacement |
|---------|-----------|-------|--------|--------|-------------|
| STATIC_OFFER_V1_1x1 | {date} | ${spend} | Failed | CPA 2.1x target, CTR 0.4% | Yes -- test #3 above |

---

## Sprint Metrics Target

| Metric | Last Sprint | This Sprint Target |
|--------|------------|-------------------|
| New ads launched | {count} | {target} |
| Win rate | {pct}% | {target}% |
| Testing budget utilization | {pct}% | >90% |
```
