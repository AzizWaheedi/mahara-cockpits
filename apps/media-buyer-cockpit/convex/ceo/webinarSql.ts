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

/** The contact custom field "Webinar Datetime" (DATE), set by the opt-in. */
export const SESSION_FIELD = "x7aG8iLqmTzQEr6SGCaH";
/** The contact custom field "Webinar Round" (TEXT). */
export const ROUND_FIELD = "a2j833icPANKyXtSsGu1";

/** One custom field's value off a contact row's raw_contact. */
export function fieldValue(a: string, id: string): string {
  return `(select cf->>'value' from jsonb_array_elements(case when jsonb_typeof(${a}.raw_contact->'customFields') = 'array' then ${a}.raw_contact->'customFields' else '[]'::jsonb end) cf where cf->>'id' = '${id}' limit 1)`;
}

/**
 * The contact's webinar session as a timestamp: GoHighLevel sends a DATE
 * field as epoch milliseconds or as YYYY-MM-DD; anything else is unknown.
 */
export function sessionAt(a: string): string {
  const v = fieldValue(a, SESSION_FIELD);
  return `(case when ${v} ~ '^[0-9]{13}$' then to_timestamp((${v})::numeric / 1000)
    when ${v} ~ '^[0-9]{10}$' then to_timestamp((${v})::numeric)
    when ${v} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then (${v})::timestamptz
    else null end)`;
}

/**
 * When a contact's webinar story starts. The CRM keeps no time for when a
 * tag was added, so: the contact's creation, or three weeks before their
 * session when the contact is older than that. A lead from August who
 * registers for October keeps August's calls in the call funnel.
 */
export function webbyFrom(a: string): string {
  return `greatest(${a}.lead_created_at, coalesce(${sessionAt(a)} - interval '21 days', ${a}.lead_created_at))`;
}

/**
 * A contact the webinar brought in: webby-tagged and created no earlier than
 * its registration period. An older lead who later registered stays a call
 * funnel lead on the day it was one.
 */
export function webbyNewLead(a: string): string {
  return `(${webbyLead(a)} and ${a}.lead_created_at >= ${webbyFrom(a)} - interval '1 hour')`;
}

/** A call (public.calls, alias `c`) booked by a registrant after registering. */
export function webbyCall(c: string): string {
  return `(${c}.contact_id is not null and exists (
    select 1 from public.leads wl
    where wl.contact_id = ${c}.contact_id and ${webbyLead("wl")}
      and ${c}.booked_at >= ${webbyFrom("wl")} - interval '1 hour'))`;
}

/**
 * A signed deal (public.closed_deals, alias `d`) from a registrant, signed
 * after registering: by the CRM contact id first, the lowercased email
 * second. Never by name (the brief's rule).
 */
export function webbyDeal(d: string): string {
  return `exists (
    select 1 from public.leads wl
    where ${webbyLead("wl")}
      and ((${d}.contact_id is not null and wl.contact_id = ${d}.contact_id)
        or (nullif(lower(btrim(wl.email)), '') is not null
            and lower(btrim(wl.email)) = lower(btrim(${d}.email))))
      and ${d}.submitted_at >= ${webbyFrom("wl")} - interval '1 hour')`;
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
