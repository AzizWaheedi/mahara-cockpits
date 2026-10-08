import { num } from "./numbers.js";
/**
 * Link CTR, the one click-through rate the CEO cockpit shows (the CEO,
 * 2026-10-08): link clicks (Meta's inline_link_clicks) divided by
 * impressions. Meta's plain `ctr`, CTR (all), counts every click, likes and
 * profile taps included, and is never shown as CTR.
 *
 * A link-click count Meta did not give is not known, never 0: one ad-day
 * without it makes the sum unknown, and a rate over an unknown count is
 * unknown. No delivery at all is a real 0 clicks over 0 impressions, which
 * has no rate.
 */
/** A count read from SQL; null when the source gave none. */
export function knownCount(x) {
    return x === null || x === undefined || x === "" ? null : num(x);
}
/** The sum of counts, null when any one is not known; 0 for no rows. */
export function knownSum(values) {
    let total = 0;
    for (const v of values) {
        if (v === null || v === undefined)
            return null;
        total += v;
    }
    return total;
}
/** Link clicks over impressions as a fraction (four places); null when the clicks are not known or nothing was shown. */
export function linkCtr(linkClicks, impressions) {
    if (linkClicks === null || linkClicks === undefined)
        return null;
    return impressions > 0
        ? Math.round((linkClicks / impressions) * 10000) / 10000
        : null;
}
/** Two link-click counts added; not known when either is. */
export function addKnown(a, b) {
    return a === null || b === null ? null : a + b;
}
/**
 * One ad's link clicks and link CTR from a b2b_marketing_ads row. An ad Meta
 * has no snapshot of has neither: its clicks are unknown, not zero.
 */
export function marketingAdLink(row) {
    const inMeta = String(row.in_meta) === "true";
    const linkClicks = inMeta ? knownCount(row.link_clicks) : null;
    return { linkClicks, linkCtr: linkCtr(linkClicks, num(row.impressions)) };
}
/**
 * SQL for a link-click sum that stays unknown (null) when any row in the
 * group lacks one, where a plain sum() would quietly drop it.
 */
export const LINK_CLICKS_SQL = (alias = "") => `case when bool_and(${alias}inline_link_clicks is not null) then sum(${alias}inline_link_clicks) end`;
