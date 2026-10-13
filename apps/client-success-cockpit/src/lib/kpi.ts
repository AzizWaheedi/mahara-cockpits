/**
 * The official KPI gates, in one place for the site. Aziz, 2026-09-16: $15 per
 * lead and $60 per booking are what we aim for; anything above needs action.
 * Aziz, 2026-10-13: "The CSM: make it $15 cost per lead and $60 cost per
 * booking", so the client success cockpit judges on the same two.
 *
 * The client success cockpit holds this same file, byte for byte, at
 * apps/client-success-cockpit/src/lib/kpi.ts (an app cannot import from
 * another); scripts/check-shared.sh stops the two drifting. No imports: the
 * cockpit-ceo-api and cockpit-csm-api Edge Functions bundle it. Keep in step
 * with convex/constants.ts and hermes/ceo-refresh/native/constants.js.
 */
export const CPL_GATE = 15;
export const CPB_GATE = 60;
/**
 * The rate gates the client reports use, in percent. The show rate has no gate
 * of its own: it is SHOW_RATE_GOOD below. Keep in step with convex/constants.ts.
 */
export const BOOKING_RATE_GATE = 25;
export const CLOSE_RATE_GATE = 20;
/**
 * The client status rule on the CEO Delivery tab (Aziz, 2026-09-21): good
 * needs a show rate of at least SHOW_RATE_GOOD and a cost per confirmed
 * booking within CPB_GATE; bad is a cost per booking over CPB_BAD or a bad
 * cost per lead (CPL_GATE * 1.5). There is one show rate line for clients,
 * 60, and no lower or higher one (Aziz, 2026-09-21 and 2026-10-12): under it
 * is watch, never bad. SHOW_RATE_AIM is what we aim for above it, not a
 * second line. Keep in step with convex/constants.ts.
 */
export const SHOW_RATE_GOOD = 60;
export const CPB_BAD = 80;
/**
 * The client show rate we aim for, in percent: the October KPI. Aziz,
 * 2026-10-13: "The October KPI is what we shoot for, but I don't want to make
 * that the main constraint." The aim, never the main constraint: nothing is
 * judged against it. The line stays SHOW_RATE_GOOD, under it is a watch, and
 * client-facing text keeps "under our 60% line".
 */
export const SHOW_RATE_AIM = 70;
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
