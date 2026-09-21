/**
 * The official KPI gates, in one place for the site. Aziz, 2026-09-16: $15 per
 * lead and $60 per booking are what we aim for; anything above needs action.
 * Keep in step with convex/constants.ts.
 */
export const CPL_GATE = 15;
export const CPB_GATE = 60;
/** The rate gates the client reports use, in percent. Keep in step with convex/constants.ts. */
export const BOOKING_RATE_GATE = 25;
export const SHOW_RATE_GATE = 75;
export const CLOSE_RATE_GATE = 20;
/**
 * The client status rule on the CEO Delivery tab (Aziz, 2026-09-21): good
 * needs a show rate of at least SHOW_RATE_GOOD and a cost per confirmed
 * booking within CPB_GATE; bad is a cost per booking over CPB_BAD or a bad
 * cost per lead (CPL_GATE * 1.5). There is one show rate line for clients,
 * 60, and no lower one (Aziz, 2026-09-21). Keep in step with convex/constants.ts.
 */
export const SHOW_RATE_GOOD = 60;
export const CPB_BAD = 80;
/** Days a change needs before its numbers mean anything. */
export const LEARNING_DAYS = 3;
/** A new campaign is watched twice a day for this long. */
export const LAUNCH_WATCH_DAYS = 3;

/**
 * Link CTR below this reads as a hook that is not landing.
 *
 * Grounded in Mahara's own tracker rather than a generic 1% "industry floor":
 * across 83 ads with real impressions the median link CTR is 0.77%, so a 1%
 * floor would flag over half of everything. Keep in step with LINK_CTR_FLOOR
 * in convex/sync.ts. [tracker, 2026-09-06]
 */
export const LINK_CTR_FLOOR = 0.3;
