/**
 * The one show rate line for clients, in percent: shows over appointments
 * with an outcome.
 *
 * - Aziz, 2026-09-21: "60% show rate is our thing for clients, not 40%".
 * - Aziz, 2026-10-12: "the show rate metric is 60%, so anything around that
 *   is fine, not 70%".
 *
 * There is no lower line and no higher one. Under it is "watch", never
 * "fix first" and never bad: bad is cost per booking or cost per lead.
 *
 * The same name as SHOW_RATE_GOOD in apps/media-buyer-cockpit/src/lib/kpi.ts,
 * so one grep finds both. No imports: the cockpit-csm-api Edge Function
 * bundles this file too.
 */
export const SHOW_RATE_GOOD = 60;
