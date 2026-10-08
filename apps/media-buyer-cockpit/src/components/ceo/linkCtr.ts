/**
 * The one click-through rate the CEO cockpit shows (the CEO, 2026-10-08):
 * link CTR, link clicks divided by impressions. Meta's plain `ctr`, CTR
 * (all), counts every click, likes and profile taps included, and reads well
 * above it (1.79% against 1.06% on lead-gen in August 2026), so it is never
 * shown as "CTR". The same words as the media buyer cockpit's Link CTR
 * (AccountView, CampaignRange).
 */
export const LINK_CTR = "Link CTR";
export const LINK_CTR_HINT =
  "Link clicks divided by impressions. Not CTR (all).";

/**
 * The money notes about the CTR target (cockpit-ceo-api finance/targets.ts,
 * linkCtrTargetNote). They belong beside the Link CTR meter, on the Money and
 * Frontend targets cards; a tab whose targets card leaves CTR out (Sales)
 * points at them instead.
 */
export const CTR_TARGET_NOTE = /\bCTR targets?\b/;
