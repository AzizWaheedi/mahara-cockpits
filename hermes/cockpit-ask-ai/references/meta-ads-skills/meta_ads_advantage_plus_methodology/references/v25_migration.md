# v25.0 Migration Guide: Legacy to Unified Advantage+

## Overview

Meta's API v25.0 (released January 2026) introduces unified Advantage+ campaigns, consolidating legacy Advantage+ Shopping Campaigns (ASC) and Advantage+ App Campaigns into a single campaign type. **Legacy campaign creation will be disabled on May 19, 2026.**

---

## Migration Timeline

| Date | What Happens |
|------|-------------|
| **January 2026** | v25.0 API released, unified Advantage+ campaign type available |
| **March 2026 (now)** | Both legacy and unified available. Begin testing unified. |
| **April 2026** | Migrate high-performing campaigns. Run parallel tests. |
| **May 19, 2026** | Legacy ASC and App campaign creation disabled |
| **Q3 2026 (expected)** | Legacy campaigns enter "delivery only" mode (no edits) |
| **Q4 2026 (expected)** | Legacy campaigns fully deprecated |

---

## What's Changing

### Legacy ASC vs Unified Advantage+

| Feature | Legacy ASC | Unified Advantage+ |
|---------|-----------|-------------------|
| Campaign creation | Via "Advantage+ Shopping" template | Via "Advantage+" campaign type (new) |
| Audience inputs | None (fully algorithmic) | "Audience suggestions" (optional signals to seed the algorithm) |
| Geographic targeting | Country only | Country + regional suggestions |
| Existing customer cap | Yes (0-100%) | Yes, with enhanced controls and reporting |
| Optimization events | Single event per campaign | Multiple events with priority ordering possible |
| Creative enhancements | Basic auto-enhancements | Full Advantage+ Creative suite integrated |
| Minimum creative | 5 ads | 3 ads (lowered threshold) |
| Reporting | Limited breakdowns | Enhanced Delivery Insights with audience segments |
| Catalog integration | Supported | Supported + enhanced catalog overlays |
| App campaign support | Separate campaign type | Unified (same campaign type for shopping + app) |

### What Stays the Same

- Campaign-level budget (no ad set budgets)
- Existing customer definition via Custom Audiences
- Meta's algorithm handles targeting, placement, and bid optimization
- Performance benchmarks (no degradation expected from migration itself)

---

## Migration Playbook

### Phase 1: Audit (Week 1)

**List all active ASC campaigns:**

| Campaign | Daily Budget | CPA (30-day) | Creative Count | Existing Customer Cap | Country |
|----------|-------------|--------------|----------------|----------------------|---------|
| [Name] | $X | $X | X | X% | [Country] |

**For each campaign, document:**
1. Current performance (CPA, ROAS, conversion volume)
2. Number and types of creative
3. Existing customer cap setting
4. Existing customer audience definition
5. Any custom conversion events

### Phase 2: Build Unified Campaigns (Week 2)

**For each legacy ASC campaign, create a unified equivalent:**

1. Create new campaign using the unified Advantage+ type
2. Mirror the budget from the legacy campaign
3. Upload the same creative (use Post ID method for ads with social proof)
4. Set the same existing customer cap
5. Apply the same existing customer audience definition
6. Set the optimization event to match

**New features to test:**
- Audience suggestions: add 2-3 broad interest categories as suggestions (seed the algorithm)
- Multiple optimization events: if you have both Purchase and Lead, set priority ordering
- Enhanced Advantage+ Creative: enable all auto-enhancements initially

### Phase 3: Parallel Testing (Weeks 3-4)

**Split budget 50/50 between legacy and unified:**

| Campaign | Budget Split | KPI |
|----------|-------------|-----|
| Legacy ASC | 50% of original budget | CPA, ROAS, conversion volume |
| Unified A+ | 50% of original budget | CPA, ROAS, conversion volume |

**Run for 14 days minimum (or until 50+ conversions on each)**

**Evaluation criteria:**
- CPA within 15% of each other: migration safe, proceed
- Unified CPA 15%+ lower: migration will likely improve performance
- Unified CPA 15%+ higher: investigate (likely learning phase, extend test to 21 days)

### Phase 4: Migration (Week 5)

**Shift budget to unified campaigns:**
1. Increase unified campaign budget by 25% (absorbing from legacy)
2. Decrease legacy campaign budget by 25%
3. Wait 3-5 days for stabilization
4. Repeat until 100% of budget is on unified campaigns
5. Pause legacy campaigns (do not delete -- historical data lives here)

### Phase 5: Optimization (Week 6+)

- Test audience suggestions (add, modify, or remove suggestions based on performance)
- Experiment with multiple optimization events
- Test enhanced Advantage+ Creative features
- Document any performance differences vs legacy

---

## Risks and Mitigations

### Learning Phase Reset

**Risk:** New unified campaigns will enter learning phase, causing 7-14 days of volatile performance
**Mitigation:**
- Run parallel (legacy + unified) during learning, so total volume is maintained
- Start with 50% budget on unified, scale only after learning completes
- Ensure enough budget for 50+ events/week on the unified campaign

### Social Proof Loss

**Risk:** If creative is duplicated instead of using Post ID, accumulated likes/comments/shares are lost
**Mitigation:**
- Use the Post ID method to transfer winning ads to unified campaigns
- For each ad: find the Post ID (Ad level > Facebook Post with Comments preview > extract ID)
- In the unified campaign, create ads using "Use Existing Post" and enter the Post ID

### Reporting Continuity

**Risk:** Historical data stays in legacy campaigns. New campaigns start with fresh reporting.
**Mitigation:**
- Export legacy campaign reports before pausing
- Use campaign naming conventions that link legacy and unified (e.g., "Viktor - ASC - Legacy" and "Viktor - A+ Unified - V1")
- Build dashboards that combine both campaigns for continuity during transition

### Automation and Rules

**Risk:** Automated rules tied to legacy campaigns won't apply to new unified campaigns
**Mitigation:**
- Audit all automated rules before migration
- Recreate rules for unified campaigns
- Test rules with lower thresholds initially to avoid unintended actions

---

## Post-Migration Optimization

### Audience Suggestions (New Feature)

After migration, experiment with audience suggestions -- this is the primary new lever:

**Test 1: No suggestions (fully algorithmic)**
- Mirrors legacy ASC behavior
- Best for mature accounts with extensive pixel data

**Test 2: Customer list as seed**
- Upload top 1,000 customers as a suggestion
- Algorithm uses their profile patterns to find similar users
- Often the strongest single suggestion

**Test 3: Interest suggestions**
- Add 2-3 broad interest categories
- Use as a "starting direction" for the algorithm
- Best for accounts with less pixel data

**Test 4: Combined suggestions**
- Customer list + 2 interests
- Provides multiple signals for the algorithm
- Recommended for most accounts

### Multiple Optimization Events

Unified Advantage+ supports optimizing for multiple events:
- Primary: Purchase
- Secondary: AddToCart
- Tertiary: ViewContent

Meta allocates budget to maximize the primary event, using secondary/tertiary data as supplemental signals. This is particularly valuable for accounts with fewer than 50 weekly purchases.

---

## FAQ

**Q: Will my legacy ASC campaigns stop working on May 19?**
A: No. Existing legacy campaigns will continue to deliver. You just can't create new ones or make significant edits after the deadline. Eventually (Q3-Q4 2026), they'll be fully deprecated.

**Q: Should I migrate everything at once?**
A: No. Start with your second or third highest-performing campaign. Prove the unified format works, then migrate your top performer. Keep at least one legacy campaign running until you're confident.

**Q: What if unified performance is worse?**
A: Give it 14 days minimum. If CPA is >20% worse after 50+ conversions, check: (1) are suggestions helping or hurting? Remove them. (2) Is creative the same? Use Post ID. (3) Is the budget sufficient for learning? If still worse after 28 days, keep the legacy campaign and retry unified in a month.

**Q: Do I need to change my creative?**
A: No. The same creative works in unified campaigns. The only change is the campaign infrastructure, not the ad experience.

**Q: How does this affect my automated reporting?**
A: You'll need to update any API integrations that reference ASC-specific campaign fields. Check your reporting tools for v25.0 compatibility updates.
