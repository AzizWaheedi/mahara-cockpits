/**
 * What belongs to the webinar funnel rather than the call funnel, as SQL on
 * the B2B tables (read only). Aziz, 2026-09-23: "separate the two funnels".
 *
 * The webinar system in GoHighLevel (the WEBBY workflows, pipeline Webinar)
 * tags every registrant `webby-registered` and every later step `webby-*`
 * (attended, noshow, booked, survey-done, and the round, `webby-sep-2026`).
 * A contact with any `webby-` tag came through the webinar, so:
 *
 * - their calls, leads and signed deals are the webinar's, not the call
 *   funnel's, even when they book the same intro and demo calendars;
 * - a Meta campaign is the webinar's when its name says so (webinar, webby,
 *   live training, training, تدريب, ويبينار) or when the B2B lt_events table
 *   names it as a session's campaign.
 *
 * Both funnels read these same predicates, so a call or a dollar is always in
 * exactly one of them.
 */

/** The tag every webinar step carries, as a LIKE pattern. */
export const WEBBY = "webby-%";

/** A contact row (public.leads, alias `a`) that came through the webinar. */
export function webbyLead(a: string): string {
  return `exists (select 1 from unnest(coalesce(${a}.tags, '{}'::text[])) wt where wt like '${WEBBY}')`;
}

/** A call (public.calls, alias `c`) booked by a webinar registrant. */
export function webbyCall(c: string): string {
  return `(${c}.contact_id is not null and exists (
    select 1 from public.leads wl
    where wl.contact_id = ${c}.contact_id and ${webbyLead("wl")}))`;
}

/**
 * A signed deal (public.closed_deals, alias `d`) whose client registered for
 * the webinar: by the CRM contact id first, the lowercased email second.
 * Never by name (the brief's rule).
 */
export function webbyDeal(d: string): string {
  return `exists (
    select 1 from public.leads wl
    where ${webbyLead("wl")}
      and ((${d}.contact_id is not null and wl.contact_id = ${d}.contact_id)
        or (nullif(lower(btrim(wl.email)), '') is not null
            and lower(btrim(wl.email)) = lower(btrim(${d}.email)))))`;
}

/** Campaign names that say webinar or live training, in either language. */
export const WEBINAR_CAMPAIGN_NAME = String.raw`(webinar|webby|live[ _-]?training|training|تدريب|ويبينار|ويبنار)`;

/**
 * A Meta snapshot row (public.meta_ad_snapshots, alias `s`) from a webinar
 * campaign.
 */
export function webbyCampaign(s: string): string {
  return `(coalesce(${s}.campaign_name, '') ~* '${WEBINAR_CAMPAIGN_NAME}'
    or ${s}.campaign_id in (
      select e.meta_campaign_id from public.lt_events e
      where e.meta_campaign_id is not null))`;
}
