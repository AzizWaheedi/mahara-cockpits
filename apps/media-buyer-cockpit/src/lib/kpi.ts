/**
 * The KPI gates, in one place. Aziz, 2026-09-03: anything above $15 a lead needs
 * action; cost per booking is judged against $80.
 */
export const CPL_GATE = 15;
export const CPB_GATE = 80;
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
