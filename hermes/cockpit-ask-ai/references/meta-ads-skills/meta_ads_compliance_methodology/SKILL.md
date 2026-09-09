---
name: compliance_methodology
description: Privacy and compliance framework for Meta Ads covering Special Ad Categories (housing, credit, employment), GDPR/CCPA requirements, Aggregated Event Measurement, Consent Mode, and data sharing restrictions. Referenced by audit-compliance action skill.
---

# Compliance Methodology

## Purpose

This skill encodes the privacy and compliance framework for Meta Ads as of March 2026. Compliance failures can result in ad disapprovals, account restrictions, legal penalties, and reputational damage. This framework covers regulatory requirements (GDPR, CCPA), Meta-specific policies (Special Ad Categories, ad review), and technical compliance (consent management, data processing). Media buyers need to understand these constraints before launching any campaign.

## Compliance Hierarchy

```
Legal Requirements (GDPR, CCPA, LGPD, etc.)
├── Supersede all other requirements
├── Penalties: up to 4% of global revenue (GDPR), $7,500/violation (CCPA)
└── Non-negotiable regardless of performance impact

Meta Platform Policies
├── Ad content restrictions
├── Special Ad Categories
├── Data use policies
└── Account-level enforcement (restrictions, bans)

Industry Self-Regulation
├── NAI/DAA guidelines
├── IAB frameworks (TCF 2.2)
└── Voluntary commitments
```

---

## 1. Special Ad Categories

### Overview

Meta requires advertisers to declare Special Ad Categories for ads related to housing, credit, employment, and in some markets, social issues/elections/politics. Declaring a special category imposes significant targeting restrictions to prevent discriminatory advertising.

### Category Definitions

| Category | What's Included | Examples |
|----------|----------------|---------|
| **Housing** | Ads for the sale, rental, or financing of housing | Real estate listings, mortgage offers, apartment rentals, home insurance |
| **Credit** | Ads for credit offers or financial products | Credit cards, loans, insurance quotes, debt consolidation |
| **Employment** | Ads for job opportunities | Job postings, career pages, recruitment campaigns |
| **Social Issues/Elections/Politics** | Ads about social issues, elections, or political figures | Issue advocacy, candidate ads, political PACs (US, EU, select markets) |

### Targeting Restrictions When Special Category is Declared

| Feature | Available? | Notes |
|---------|-----------|-------|
| Age targeting | No | Cannot restrict by age |
| Gender targeting | No | Cannot restrict by gender |
| ZIP/postal code targeting | No | Minimum 15-mile radius from any point |
| Detailed targeting (interests) | Limited | Many interest categories removed |
| Lookalike audiences | No | Replaced by "Special Ad Audiences" |
| Custom Audiences | Yes | But with restrictions on source |
| Advantage+ Audience | Limited | Auto-expansion still applies, but within compliant bounds |
| Geographic targeting | Yes | But with 15-mile minimum radius |
| Language targeting | Yes | Allowed |
| Placement selection | Yes | Allowed |

### Special Ad Audiences (Replacing Lookalikes)

- For Special Ad Categories, standard Lookalike Audiences are not available
- "Special Ad Audiences" use a similar concept but with compliance guardrails
- They find users similar to your source audience but exclude age, gender, and ZIP-level precision
- Performance is typically 20-30% lower than standard lookalikes due to restrictions
- Recommendation: use broader targeting with strong creative rather than relying on Special Ad Audiences

### Consequences of Not Declaring

- **Ad rejection:** Meta's automated review may catch and reject the ad
- **Account restriction:** Repeated violations can result in advertising restrictions
- **Retroactive enforcement:** Ads can be pulled mid-campaign if flagged
- **Legal liability:** In the US, housing and employment advertising discrimination is a federal civil rights issue (Fair Housing Act, Title VII)

### When It's Ambiguous

If your ad could be interpreted as housing, credit, or employment:

- **Err on the side of declaring.** The performance cost of declaring (targeting restrictions) is far less than the cost of an account restriction or legal issue
- **SaaS products used by these industries:** If Viktor is advertising to real estate agents, the ad is for Viktor (a software tool), not for housing. You do not need to declare Housing. But if the ad copy references "find your next home" or similar housing-adjacent language, Meta's automated review may flag it
- **Financial tools vs financial offers:** An ad for accounting software is not a credit ad. An ad for "get a business loan" is a credit ad. The distinction is whether the ad promotes a financial product or a tool
- **Job boards vs employer branding:** An ad for a job posting is employment. An ad for your company's brand (that doesn't reference specific jobs) is not

---

## 2. GDPR (General Data Protection Regulation)

### Applicability

GDPR applies when:
- Targeting users in the European Economic Area (EEA), UK, or Switzerland
- Processing personal data of EEA residents (regardless of where your company is based)
- Using Meta's advertising tools for the above (Meta is a joint data controller in the EU)

### Core Requirements for Advertisers

| Requirement | What It Means for Meta Ads | Implementation |
|-------------|---------------------------|----------------|
| **Lawful basis** | You need a legal basis to process data for advertising | Consent (most common) or Legitimate Interest (harder to defend for tracking) |
| **Explicit consent** | Users must actively opt in before tracking | CMP (Consent Management Platform) with granular controls |
| **Granular permissions** | Separate consent for different purposes (analytics, advertising, personalization) | CMP must offer purpose-level toggles |
| **Right to erasure** | Users can request deletion of their data | Process to remove users from Custom Audiences, honor within 30 days |
| **Right to access** | Users can request what data you hold | Document data flows between your systems and Meta |
| **Data minimization** | Only collect and share data necessary for the stated purpose | Don't send unnecessary parameters via CAPI |
| **Privacy policy** | Must disclose Meta tracking and advertising use | Update privacy policy to reference Meta Pixel, CAPI, and advertising purposes |

### Consent Management Platform (CMP) Integration

**Recommended CMPs for Meta Ads:**
- OneTrust (enterprise, full TCF 2.2 support)
- Cookiebot (mid-market, easy setup)
- Osano (SMB-friendly)
- Termly (budget option)
- Didomi (EU-focused, strong TCF support)

**CMP Configuration for Meta:**
1. Block Meta Pixel from firing until consent is granted
2. Pass consent signal to Meta via the Consent Mode API
3. When consent is denied: Meta uses modeled conversions (see Section 5)
4. When consent is granted: full pixel + CAPI tracking activates
5. Store consent records for audit purposes (minimum 3 years recommended)

**TCF 2.2 (Transparency and Consent Framework):**
- Meta is registered as a vendor in IAB's TCF
- If using TCF-compliant CMP: Meta automatically respects the consent signal
- Purpose 1 (Store/access device info) must be consented for pixel to fire
- Purposes 3, 4, 5 (personalized ads, content, measurement) needed for full functionality

### GDPR Impact on Campaign Performance

- Expect 20-40% fewer reported conversions in EU markets vs non-consent environments
- Modeled conversions fill some of this gap (see Section 5)
- Conversion rates may appear lower due to measurement gaps, not actual performance decline
- Adjust EU CPA targets upward by 10-20% to account for measurement loss
- CAPI reduces the consent gap (server-side events fire regardless of cookie consent, with appropriate data processing controls)

---

## 3. CCPA (California Consumer Privacy Act) / CPRA

### Applicability

CCPA/CPRA applies when:
- You serve California residents AND
- Annual revenue >$25M, OR process data of 100K+ California consumers/households, OR derive 50%+ revenue from selling/sharing personal information

### Core Requirements for Advertisers

| Requirement | What It Means for Meta Ads | Implementation |
|-------------|---------------------------|----------------|
| **Right to know** | California users can request what data you share with Meta | Document all data flows to Meta (pixel events, CAPI events, Custom Audiences) |
| **Right to opt out** | Must offer "Do Not Sell or Share My Personal Information" link | Implement GPC (Global Privacy Control) signal handling |
| **Right to delete** | Users can request deletion | Remove from Custom Audiences, honor within 45 days |
| **Limited Data Use (LDU)** | Flag data as California-restricted | Send LDU flag via CAPI (see Section 4) |
| **Privacy policy** | Must disclose sharing of data with Meta for advertising | List "advertising partners" or name Meta specifically |

### CAPI Limited Data Use (LDU) Implementation

When a California user has opted out of data sharing:
1. Set `data_processing_options` to `['LDU']` in your CAPI event payload
2. Set `data_processing_options_country` to `1` (US)
3. Set `data_processing_options_state` to `1000` (California)
4. Meta will process this event with restrictions (no cross-site tracking, limited optimization)

**When to apply LDU:**
- User has opted out via your "Do Not Sell/Share" mechanism
- GPC (Global Privacy Control) signal is detected in the user's browser
- User is identified as a California resident and has not explicitly consented

**Impact of LDU on performance:**
- Events with LDU flag provide less optimization signal to Meta
- Typically affects 5-15% of California traffic (opt-out rate varies)
- Impact on overall campaign performance is minimal if CAPI is properly implemented
- Do not apply LDU universally -- only for opted-out California users

---

## 4. Aggregated Event Measurement (AEM)

### Current State (March 2026)

AEM was introduced in 2021 as part of Apple's ATT (App Tracking Transparency) response. It originally limited advertisers to 8 prioritized conversion events per domain.

**2025 update:** Meta removed the 8-event limit. Advertisers can now track unlimited conversion events. However, the aggregation and modeling concepts from AEM persist:

| AEM Feature | Current Status |
|-------------|---------------|
| 8-event limit | Removed (2025) |
| Event prioritization | No longer required (but still available) |
| Automatic aggregation | Still active for opted-out iOS users |
| 24-hour delayed reporting | Reduced to near-real-time in most cases |
| Modeled conversions | Expanded and improved |
| Domain verification | Still required for link ownership claims |

### What Advertisers Need to Know

1. **Event tracking is no longer limited.** You can use Purchase, Lead, AddToCart, ViewContent, and custom events without worrying about the 8-event cap
2. **Modeled conversions are standard.** Meta models conversions for users who opt out of tracking. These modeled conversions appear in your reporting with a note
3. **CAPI is essential.** Server-side events provide data that browser-side tracking cannot capture for opted-out users. CAPI + Pixel together give the most complete picture
4. **Domain verification is still required** if you want to control who can edit events on your domain or verify link ownership for branded content

### Domain Verification

**When you need it:**
- Claiming ownership of your domain for event configuration (no longer tied to AEM limits)
- Branded content partnerships where you need to verify link ownership
- When multiple Business Managers advertise on the same domain

**How to verify:**
1. Add a DNS TXT record to your domain, OR
2. Upload an HTML file to your domain root, OR
3. Add a meta tag to your homepage header

**Where:** Business Settings > Brand Safety > Domains > Add Domain

---

## 5. Meta Consent Mode

### How It Works

Meta Consent Mode bridges the gap between privacy compliance and advertising measurement. When users decline cookie consent, Meta Consent Mode enables modeled attribution.

```
User visits site
├── Consent granted --> Full pixel + CAPI tracking --> Observed conversions
└── Consent denied --> Consent Mode active --> Modeled conversions
    ├── Meta estimates the user's likelihood of converting
    ├── Based on aggregate patterns from consented users
    ├── Modeled conversions appear in reporting (flagged as modeled)
    └── Accuracy improves with higher consent rates and more CAPI data
```

### Implementation

**Via Google Tag Manager (most common):**
1. Set up your CMP to integrate with GTM Consent Mode
2. Map consent categories to Meta's required signals
3. Meta Pixel fires in "consent mode" when consent is denied
4. CAPI events can still fire server-side with appropriate flags

**Via direct implementation:**
1. Use Meta's Conversions API Gateway or direct CAPI implementation
2. Pass consent status as a parameter with each event
3. When consent is denied: send event with `consent_status: 'denied'`
4. Meta applies modeled attribution for denied-consent events

### Modeled Conversion Accuracy

- Meta's modeling improves with more data (more consented conversions = better models)
- Accounts with 100+ weekly conversions see higher modeling accuracy
- Modeling fills approximately 60-80% of the consent gap (varies by account)
- Modeled conversions are not perfect -- expect 10-20% variance vs actual
- For campaign optimization: modeled conversions provide directionally accurate signals
- For financial reporting: use a blended approach (observed + modeled, with a noted margin of error)

### Consent Rate Optimization

Higher consent rates = better measurement and optimization. Improve consent rates by:
1. Using a non-intrusive CMP design (bottom bar > full-screen overlay)
2. Making the "Accept" button visually prominent (not dark pattern, but clear hierarchy)
3. Providing clear, concise explanations of data use
4. Offering genuine value exchange ("accept to personalize your experience")
5. Testing CMP placement, timing, and copy
6. Average consent rates: 70-85% (varies by market and CMP design)

---

## 6. Data Retention and Audience Management

### Customer List Policies

| Requirement | Details |
|-------------|---------|
| Data source | Must be first-party data (customers who interacted with your business) |
| Consent | Users must have consented to data use for marketing (or legitimate interest in non-GDPR markets) |
| Hashing | PII must be SHA-256 hashed before upload (Meta hashes automatically in Ads Manager UI) |
| Retention | Custom Audiences auto-expire after 180 days without refresh |
| Refresh cadence | Update customer lists at least monthly (weekly recommended) |
| Removal requests | Honor opt-out/deletion requests within 30 days (GDPR) or 45 days (CCPA) |
| Source disclosure | Users can ask where their data came from -- be prepared to answer |

### Audience Refresh Requirements

- Custom Audiences built from customer lists should be refreshed every 30 days minimum
- Website Custom Audiences are automatically refreshed by the pixel (no action needed)
- Engagement Custom Audiences (video views, page engagement) are automatically maintained
- Stale audiences degrade in performance even before the 180-day expiry
- Set a calendar reminder to refresh lists on the 1st and 15th of each month

### Data Minimization for CAPI

Only send parameters necessary for your optimization goals:

**Always send (required for matching):**
- em (hashed email)
- fn (hashed first name)
- ln (hashed last name)
- client_ip_address
- client_user_agent
- fbc (Facebook click ID)
- fbp (Facebook browser ID)

**Send when available (improves matching):**
- ph (hashed phone)
- external_id (hashed user ID)
- ge (hashed gender)
- db (hashed date of birth)
- ct, st, zp (hashed city, state, ZIP)

**Do not send:**
- Sensitive health information
- Financial account numbers
- Social security numbers
- Any data not covered by your privacy policy

---

## 7. Ad Review and Disapproval

### Meta's Ad Review Process

All ads go through automated review before delivery, with some flagged for manual review. Review typically takes <24 hours but can take up to 72 hours for new accounts or flagged content.

### Common Disapproval Reasons

| Reason | What Triggers It | Resolution |
|--------|-----------------|------------|
| **Personal attributes** | "Are you [condition]?" phrasing, implying knowledge of personal characteristics | Rephrase to be about the product, not the person. "Smart email management" instead of "Tired of email overload?" |
| **Before/after images** | Side-by-side transformations | Avoid transformation imagery; show the product experience instead |
| **Unsubstantiated claims** | "Best," "#1," specific ROI claims without evidence | Add disclaimers, use qualified language ("up to," "based on user data") |
| **Misleading content** | Clickbait, sensationalized copy, fake UI elements | Make ads accurate representations of the product experience |
| **Non-functional landing page** | 404 errors, broken pages, mismatched domains | Test all landing page URLs before launching ads |
| **Restricted content** | Alcohol, gambling, supplements without proper authorization | Apply for special authorization where available, or adjust content |
| **Low quality** | Excessive text on image, grammar errors, all caps | Follow creative best practices, proofread copy |
| **Circumventing systems** | Cloaking, misleading ad text to avoid detection | Never attempt to circumvent ad review -- this can result in permanent account ban |
| **Special category not declared** | Housing/credit/employment ad without category flag | Declare the appropriate special category |

### Appeal Process

1. Go to Account Quality (business.facebook.com/accountquality)
2. Select the rejected ad
3. Click "Request Review"
4. Provide a brief explanation of why the ad complies with policies
5. Review typically completes within 24-48 hours
6. If appeal is denied: modify the ad to address the specific policy issue
7. For systematic issues: contact your Meta Business Partner representative

### Proactive Compliance Checklist (Pre-Launch)

- [ ] Ad copy avoids "you" + personal attribute phrasing
- [ ] No before/after transformation imagery
- [ ] Claims are qualified and substantiated
- [ ] Landing page is functional and matches ad content
- [ ] Special Ad Category declared if applicable
- [ ] No restricted content without proper authorization
- [ ] Text-to-image ratio is reasonable (ideally <20%)
- [ ] Ad copy is grammatically correct, no all-caps
- [ ] Privacy policy is accessible from the landing page
- [ ] CMP is functioning correctly (EU/CA traffic)

---

## 8. Restricted Content by Category

### Content Requiring Special Authorization

| Category | Requirements | Markets |
|----------|-------------|---------|
| **Alcohol** | Must comply with local laws, age-gating required, no targeting of minors | Varies by country (prohibited in some) |
| **Online gambling** | Prior written permission from Meta, licensed operator only | US (state by state), UK, EU (varies) |
| **Cryptocurrency** | Prior written permission, licensed exchange or wallet only | Global, strict enforcement |
| **Political/social issues** | "Paid for by" disclaimers, authorization required in many markets | US, EU, UK, AU, and expanding |
| **Pharmaceuticals** | Cannot promote prescription drugs to consumers (US), OTC allowed with restrictions | US, EU rules vary |
| **Supplements** | No health claims, no before/after, comply with FTC/local equivalent | Global |
| **Financial products** | APR/fee disclosures, no guaranteed returns, credit category declaration | Global |
| **Dating** | Approved advertisers only, no adult content | Global |
| **Weight loss** | No before/after, no unrealistic claims, no targeting of minors | Global, heavily enforced |

### Content Prohibited on Meta

- Illegal products or services
- Discriminatory practices
- Tobacco and related products (vapes in most markets)
- Weapons and ammunition
- Spyware or surveillance equipment
- Payday loans (in many markets)
- Multi-level marketing with income claims
- Misleading health claims
- Counterfeit goods

---

## 9. Compliance Audit Checklist

### Monthly Audit Items

**Measurement and Tracking:**
- [ ] Pixel is firing correctly on all key pages
- [ ] CAPI is active and EMQ score is >6.0
- [ ] CMP is blocking pixel until consent is granted (EU/CA)
- [ ] LDU flag is applied for opted-out California users
- [ ] Domain is verified in Business Settings
- [ ] Consent Mode is implemented and functioning

**Audience and Data:**
- [ ] Customer lists are refreshed within the last 30 days
- [ ] Opt-out/deletion requests have been processed
- [ ] Custom Audiences are built from consented first-party data
- [ ] No audience lists older than 180 days
- [ ] Data minimization: only necessary parameters sent via CAPI

**Ad Content:**
- [ ] No personal attribute phrasing in active ads
- [ ] Special Ad Categories declared where applicable
- [ ] Restricted content has proper authorization
- [ ] Landing pages are functional and match ad promises
- [ ] Claims are qualified and substantiated
- [ ] Privacy policy is current and accessible

**Account Health:**
- [ ] Account Quality page shows no active issues
- [ ] No pending ad disapprovals
- [ ] Business verification is current
- [ ] Payment method is valid and not flagged

### Quarterly Audit Items

- [ ] Privacy policy reviewed and updated
- [ ] CMP configuration verified (new features, new vendors)
- [ ] Data processing agreements (DPAs) current with Meta
- [ ] CAPI implementation reviewed for new events or parameters
- [ ] Training completed for any new team members on compliance requirements
- [ ] Competitor compliance reviewed (are competitors running non-compliant ads that give them unfair advantage? Report via Ad Library if so)

---

## Reference Files

- `references/special_categories_guide.md` - Complete guide to advertising in special categories
- `references/privacy_checklist.md` - GDPR/CCPA compliance checklist
