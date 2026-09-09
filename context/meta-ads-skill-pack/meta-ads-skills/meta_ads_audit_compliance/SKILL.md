---
name: audit_compliance
description: Action skill that audits Meta Ads accounts for privacy and compliance requirements. Checks Special Ad Category status, GDPR/CCPA compliance, CAPI data processing options, ad content restrictions, and disapproval history. Produces compliance status report.
triggers:
  - "audit compliance"
  - "compliance check"
  - "privacy audit"
  - "special ad category check"
  - "ad disapprovals"
  - "GDPR compliance"
---

# Audit Compliance

## Purpose

This skill audits Meta Ads accounts for privacy, legal, and policy compliance. Non-compliance can result in ad disapprovals, account restrictions, or full account shutdowns, often with little warning and slow appeal processes. This audit is preventive: catch issues before Meta catches them for you.

Compliance in Meta Ads spans four domains:
1. **Ad policy compliance** -- content rules, special ad categories, restricted content
2. **Privacy compliance** -- GDPR, CCPA, consent management, data processing
3. **Data handling compliance** -- custom audience practices, CAPI data flow, retention
4. **Platform compliance** -- account health, business verification, payment integrity

---

## Dependencies

This skill loads the following at Step 0:

| Dependency | Purpose |
|------------|---------|
| `compliance_methodology` | Complete compliance framework, regulation summaries, policy checklists |
| `account_conventions` | Account config, compliance section (special_ad_categories, gdpr_applicable, ccpa_applicable) |

---

## Workflow

### Step 0: Load Dependencies

1. Read `compliance_methodology` for the complete compliance framework
2. Read `account_conventions` for this account's compliance config:
   - `special_ad_categories` setting
   - `gdpr_applicable` flag
   - `ccpa_applicable` flag
   - Business model (affects which policies apply)
   - Geographic targeting (determines which privacy regulations apply)
3. Confirm data source method and determine which checks can be automated vs manual

### Step 1: Special Ad Category Check

Special Ad Categories restrict targeting options and require disclosure. Getting this wrong is one of the fastest paths to account restriction.

**Categories requiring declaration:**

| Category | Applies When | Targeting Restrictions |
|----------|-------------|----------------------|
| Housing | Ads for housing sales, rentals, mortgages, home insurance | No age, gender, zip code targeting; no lookalikes |
| Credit | Ads for credit cards, loans, financing, insurance | No age, gender, zip code targeting; no lookalikes |
| Employment | Ads for job listings, career opportunities | No age, gender, zip code targeting; no lookalikes |
| Social Issues, Elections, Politics | Ads about social issues, elections, or political figures | Requires "Paid for by" disclaimer; restricted targeting |

**Audit checklist:**

| Check | How to Verify | Pass/Fail Criteria |
|-------|---------------|-------------------|
| Category declaration matches ad content | Review campaign settings vs ad creative | Ads about housing/credit/employment must have category declared |
| No undeclared restricted content | Review all active ad copy and creative | No content that implies housing, credit, or employment without category |
| Targeting restrictions enforced | Check ad set targeting settings | If category declared, targeting must comply with restrictions |
| Disclaimer present (politics/social) | Review ad preview | "Paid for by" disclaimer visible on political ads |
| Category consistently applied | Check all campaigns | Same category applied to all relevant campaigns (not just some) |

**Common mistakes:**
- SaaS companies offering "free trials" that auto-convert to paid -- may trigger credit category concerns if language implies financing
- Job boards or career platforms not declaring employment category
- Real estate adjacent services (cleaning, renovation) incorrectly declaring housing
- Not declaring when running ads in regulated markets (financial services, insurance)

**Red flag patterns:**
- Account has some campaigns with special category and some without for similar products
- Targeting settings are more restrictive than necessary (declared wrong category)
- Ad copy uses language that Meta's AI classifiers flag (even if technically not in a special category)

### Step 2: Privacy Configuration

Privacy compliance depends on where your audience is located and what data you collect.

**GDPR Compliance (EU/EEA audiences):**

| Check | Requirement | How to Verify |
|-------|------------|---------------|
| Consent before tracking | Pixel must not fire before user consents | Check consent banner implementation |
| Consent mode active | Meta pixel consent mode enabled | Pixel settings or Google Tag Manager config |
| Data processing agreement | Signed with Meta | Business Manager settings |
| Cookie banner | Compliant banner on all landing pages | Visit landing pages, check banner |
| Data retention limits | Custom audiences have retention policies | Check custom audience settings |
| Right to erasure | Process for removing users from custom audiences | Document internal process |
| Legitimate interest basis | If not using consent, documented LI assessment | Legal documentation |

**CCPA Compliance (California audiences):**

| Check | Requirement | How to Verify |
|-------|------------|---------------|
| Limited Data Use (LDU) flag | CAPI events include LDU signal for CA users | Check CAPI implementation |
| "Do Not Sell" signal | Respect Global Privacy Control signals | Website implementation |
| Privacy policy | Discloses data sharing with Meta | Review privacy policy page |
| Opt-out mechanism | Users can opt out of data sharing | Check website for opt-out link |

**CAPI Data Processing Options:**

| Setting | Purpose | Recommended |
|---------|---------|-------------|
| Data Processing Options | Controls how Meta uses CAPI data | Enable for GDPR/CCPA markets |
| Limited Data Use | Restricts processing for CA users | Enable if targeting California |
| Data Deletion | Allows requesting deletion of user data | Configure with data retention policy |

**Assessment:**
- If `gdpr_applicable: true` and consent mode is not configured, flag as P0
- If `ccpa_applicable: true` and LDU is not implemented, flag as P0
- If neither applies, confirm geographic targeting does not include EU or California

### Step 3: Ad Review Status

Check all ads for review status, disapprovals, and policy violations.

**Ad review status audit:**

| Status | Count | Action Required |
|--------|-------|----------------|
| Active (approved) | | None |
| In Review | | Monitor (24-48h typical) |
| Not Approved | | Review violation, fix, resubmit or appeal |
| Partially Approved | | Check which placements are restricted |
| Account Quality Warning | | Immediate review required |

**For each disapproved ad, document:**
- Ad name and ID
- Disapproval reason (Meta's stated policy violation)
- Specific policy reference number
- Whether the ad was correctly flagged or a false positive
- Recommended fix
- Whether to appeal or revise

**Common disapproval categories:**

| Category | Examples | Fix Approach |
|----------|---------|-------------|
| Personal attributes | "Are you struggling with..." (implies personal characteristic) | Reframe to general statements |
| Before/after claims | Weight loss, cosmetic, financial transformation images | Remove transformation imagery |
| Misleading claims | Exaggerated results, fake UI elements, misleading buttons | Tone down claims, remove fake UI |
| Non-functional landing page | 404, slow load, redirect chains | Fix LP issues |
| Prohibited content | Weapons, drugs, adult content, surveillance | Remove or don't advertise |
| Circumventing systems | Cloaking, misleading ad text | Do not do this |
| Discriminatory practices | Targeting that excludes protected classes | Review targeting settings |

**Account Quality Score:**
- Check Account Quality in Business Manager
- Score below 3/5: at risk of restrictions
- Multiple disapprovals in short timeframe: increased scrutiny on new ads
- Pattern of violations: may trigger manual review on all new ads

### Step 4: Data Sharing Audit

Audit how user data flows between your systems and Meta.

**Custom Audience practices:**

| Check | Requirement | Pass/Fail |
|-------|------------|-----------|
| Customer list consent | Users consented to being added to custom audiences | Verify consent language in signup flow |
| List freshness | Custom audiences updated within retention window | Check last update date |
| Retention policy | Audiences have defined expiration | 180-day max recommended |
| Hashed data | All uploaded data is hashed before transmission | Verify upload method (Meta hashes in-browser) |
| No over-sharing | Not sharing more data fields than needed | Review which fields are included in uploads |
| Audience size minimums | Custom audiences meet 100-user minimum | Check audience sizes |

**CAPI data flow audit:**

| Check | Requirement | Pass/Fail |
|-------|------------|-----------|
| Event parameters | Only sending necessary parameters | Review CAPI event payloads |
| User data fields | Appropriate match keys (email, phone, fbp, fbc) | Check which user data is sent |
| Server-side deduplication | Browser and server events are deduplicated | Check event_id implementation |
| Test events | Test events removed from production | Verify no test event IDs in production |
| Error rates | CAPI error rate below 5% | Check Events Manager diagnostics |

### Step 5: Compliance Checklist

Run through the comprehensive compliance checklist. Each item is rated:
- **Compliant:** Meets requirements
- **At Risk:** Partially meets requirements, needs attention
- **Non-Compliant:** Does not meet requirements, immediate action needed
- **N/A:** Not applicable to this account

**Master Checklist:**

| # | Category | Item | Status | Priority |
|---|----------|------|--------|----------|
| 1 | Policy | All ads comply with Meta Advertising Standards | | |
| 2 | Policy | Special Ad Categories correctly declared | | |
| 3 | Policy | No disapproved ads currently active or pending | | |
| 4 | Policy | Ad copy does not reference personal attributes | | |
| 5 | Policy | Landing pages functional and policy-compliant | | |
| 6 | Privacy | GDPR consent mechanism in place (if applicable) | | |
| 7 | Privacy | CCPA LDU signals implemented (if applicable) | | |
| 8 | Privacy | Privacy policy covers Meta data sharing | | |
| 9 | Privacy | Cookie banner compliant with local regulations | | |
| 10 | Privacy | Consent mode configured for Meta Pixel | | |
| 11 | Data | Custom audiences have consent basis | | |
| 12 | Data | Customer lists refreshed within retention window | | |
| 13 | Data | CAPI data processing options configured | | |
| 14 | Data | No unnecessary user data fields in CAPI events | | |
| 15 | Data | Event deduplication working correctly | | |
| 16 | Account | Business verification complete | | |
| 17 | Account | Account Quality score above 3/5 | | |
| 18 | Account | Payment method current and valid | | |
| 19 | Account | Two-factor authentication enabled for all admins | | |
| 20 | Account | User access roles appropriate (no over-permissioning) | | |

---

## Output

### Compliance Status Report

```markdown
# Meta Ads Compliance Audit Report

**Account:** [Name] | **Account ID:** [act_XXXXX]
**Audit Date:** [Today]
**Auditor:** [Name/System]

## Compliance Score

**Overall: [X/20 items compliant]**

| Category | Compliant | At Risk | Non-Compliant | N/A |
|----------|-----------|---------|---------------|-----|
| Ad Policy | X/5 | X | X | X |
| Privacy | X/5 | X | X | X |
| Data Handling | X/5 | X | X | X |
| Account Health | X/5 | X | X | X |

## Executive Summary

[2-3 sentences: overall compliance posture, biggest risk, most urgent fix]

## Non-Compliant Items (Immediate Action Required)

| # | Item | Issue | Risk Level | Remediation | Owner | Deadline |
|---|------|-------|-----------|-------------|-------|----------|
| | | | | | | |

## At-Risk Items (Action Within 2 Weeks)

| # | Item | Issue | Risk Level | Remediation | Owner | Deadline |
|---|------|-------|-----------|-------------|-------|----------|
| | | | | | | |

## Special Ad Category Status

**Current setting:** [None / Housing / Credit / Employment / Social Issues]
**Recommendation:** [Keep / Change to X / Add Y]
**Rationale:** [Why]

## Privacy Compliance Detail

### GDPR Status: [Compliant / At Risk / Non-Compliant / N/A]
[Details]

### CCPA Status: [Compliant / At Risk / Non-Compliant / N/A]
[Details]

## Ad Disapproval Summary

| Total Ads | Approved | Disapproved | In Review | Disapproval Rate |
|-----------|----------|-------------|-----------|-----------------|
| | | | | |

### Disapproved Ads Detail
[Table of disapproved ads with reasons and recommended fixes]

## Data Handling Assessment

### Custom Audience Practices
[Findings]

### CAPI Configuration
[Findings]

## Remediation Plan

### P0: Fix Today (account at risk)
1. [Action] - [Owner] - [Deadline]

### P1: Fix This Week (compliance gap)
1. [Action] - [Owner] - [Deadline]

### P2: Fix This Month (best practice)
1. [Action] - [Owner] - [Deadline]

## Next Audit

**Recommended:** [Quarterly / Monthly if non-compliant items exist]
**Scheduled:** [Date]
```

---

## Regulation Quick Reference

### GDPR Key Points for Meta Ads
- Applies to any EU/EEA resident, regardless of where your business is located
- Requires explicit consent for tracking (opt-in, not opt-out)
- Fines up to 4% of global revenue or 20M EUR
- Meta acts as joint controller for on-platform data, separate controller for off-platform (pixel/CAPI)
- Since January 2024, Meta requires consent signals via Consent Mode or equivalent

### CCPA Key Points for Meta Ads
- Applies to California residents
- Requires ability to opt out of "sale" of personal information
- Meta pixel data sharing may qualify as "sale" under CCPA
- Limited Data Use (LDU) flag restricts Meta's use of CA user data
- Fines up to $7,500 per intentional violation

### Meta Advertising Standards Quick Reference
- No ads for illegal products or services
- No discriminatory practices in housing, credit, or employment
- No misleading or deceptive content
- No adult content (with limited exceptions for dating)
- No sensational or violent content
- No personal health or financial information references
- No surveillance equipment targeting protected groups
- No cryptocurrency or financial product ads without prior authorization

---

## Reference Files

- `references/data_requirements.md` - MCP calls for ad review status, account quality, CAPI diagnostics
- `references/output_specs.md` - Report format specifications
