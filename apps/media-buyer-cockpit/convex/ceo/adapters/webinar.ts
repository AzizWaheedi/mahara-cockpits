import { readInsights } from "../frequency";
import type {
  Note,
  WebinarCollectorRun,
  WebinarPayload,
  WebinarRound,
} from "../payloads";
import { B2B, ms, num, type Row, sql, TRIAGE } from "../sb";
import { kuwaitDay } from "../time";
import type { Adapter, SourceStamp } from "../types";
import {
  type MessageCount,
  type ObjectionCall,
  objectionStats,
  reminderStats,
} from "../webinarFollowUp";
import {
  AD_ID,
  type JoinClick,
  type PageVisitor,
  type PitchClick,
  pageStats,
} from "../webinarPage";
import {
  phoneKey,
  QUALIFIED_PROFIT,
  roomOf,
  type ZoomAttendance,
  type ZoomEngagement,
  type ZoomSession,
} from "../webinarRoom";
import {
  fieldValue,
  ROUND_FIELD,
  sessionAt,
  webbyCampaign,
  webbyFrom,
  webbyLead,
} from "../webinarSql";
import { BY_SALES_REP, CALL_IS_WITH_LEAD, DEPOSIT_CONFIRMED } from "./growth";

/**
 * The webinar funnel (Aziz, 2026-09-23: "separate the two funnels ... track
 * all of these metrics. These are the sources of truth"), built on the Live
 * Training tracking brief of 6 August 2026 and its sources of truth:
 *
 * - Meta, ad level: spend, impressions, clicks, link clicks, CTR from the
 *   B2B meta_ad_snapshots of the webinar campaigns; reach and frequency from
 *   one insights call per round, because reach cannot be added across days.
 *   Meta's own lead and conversion counts are never used.
 * - HighLevel: the registrant (a contact tagged webby-*, which the WEBBY
 *   workflows do), the round (the webby-mmm-yyyy tag, or the Webinar Round
 *   field), the session (the Webinar Datetime field), attendance (webby-
 *   attended / webby-noshow), the survey (webby-survey-done), appointments
 *   and their status, and signed deals (the closer form, confirmed by Whop).
 * - Maqsam: speed to first contact after registering, by a sales rep.
 * - Zoom and the gift survey, read hourly by hermes/webinar-pull into
 *   Creative Triage (Aziz, 2026-09-23: "use composio we have zoom api"):
 *   who was in the room and when, the chat, polls, and the survey's answers.
 *   Qualification is the survey's yearly profit (on the thank-you page and
 *   after the session) or the booking form's roas tag ("qualification in the
 *   form after also before they book a call").
 * - The landing page's events and the reminder stats are not connected yet;
 *   `tracking` says so per metric instead of showing zeros.
 *
 * Every figure comes from the same predicates the call funnel subtracts
 * (webinarSql.ts), so nothing is counted in both.
 */

// biome-ignore lint/suspicious/noExplicitAny: SQL and Graph rows
type Any = any;

/** The brief's targets for a $2,000, four-day flight (section 6). */
export const WEBINAR_TARGETS: WebinarPayload["targets"] = {
  plannedSpend: 2000,
  costPerRegistration: { low: 6, high: 10, plan: 8 },
  registrations: { low: 200, high: 330, plan: 250 },
  pageConversion: { low: 0.15, high: 0.25, floor: 0.1 },
  showRate: { low: 0.3, high: 0.4 },
  retentionAtPitch1: 0.5,
  attendeeToBooked: { low: 0.1, high: 0.15 },
  bookedToHeld: 0.6,
  closeRate: 0.2,
  killRule: { spendAfter: 500, costPerRegistrationAbove: 15 },
};

const MONTHS: Record<string, string> = {
  jan: "January",
  feb: "February",
  mar: "March",
  apr: "April",
  may: "May",
  jun: "June",
  jul: "July",
  aug: "August",
  sep: "September",
  oct: "October",
  nov: "November",
  dec: "December",
};

/** One row per registrant, with what happened to them after registering. */
const JOURNEY_SQL = `select
  l.contact_id,
  nullif(lower(btrim(l.email)), '') as email,
  l.name,
  l.ad_id,
  l.adset_id,
  l.campaign_id,
  l.lead_created_at as created_at,
  ${webbyFrom("l")} as registered_at,
  ${sessionAt("l")} as session_at,
  (select t from unnest(l.tags) t where t ~ '^webby-[a-z]{3}-[0-9]{4}$' order by t desc limit 1) as round_tag,
  (select count(*) from unnest(l.tags) t where t ~ '^webby-[a-z]{3}-[0-9]{4}$') as round_tags,
  ${fieldValue("l", ROUND_FIELD)} as round_field,
  'webby-attended' = any(l.tags) as attended,
  'webby-noshow' = any(l.tags) as noshow,
  'webby-survey-done' = any(l.tags) as survey,
  nullif(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), '') as phone,
  'roas-qualified' = any(l.tags) as roas_qualified,
  'roas-unqualified' = any(l.tags) as roas_unqualified,
  'roas-unprepared' = any(l.tags) as roas_unprepared,
  substring(coalesce(l.raw_contact->'lastAttributionSource'->>'url', '') || ' '
    || coalesce(l.raw_contact->'attributionSource'->>'url', '') from 'utm_content=pitch([12])(?:[^0-9]|$)') as pitch_utm,
  (select json_agg(json_build_object(
      'type', c.call_type, 'booked_at', c.booked_at, 'start_at', c.start_at, 'status', c.status)
      order by c.booked_at)
    from public.calls c
    where c.contact_id = l.contact_id and c.call_type in ('intro', 'demo')
      and c.booked_at >= ${webbyFrom("l")} - interval '1 hour') as calls,
  (select json_agg(json_build_object(
      'submitted_at', d.submitted_at, 'contracted', d.contracted_revenue,
      'cash', d.cash_collected, 'confirmed', ${DEPOSIT_CONFIRMED})
      order by d.submitted_at)
    from public.closed_deals d
    where ((d.contact_id is not null and d.contact_id = l.contact_id)
        or (nullif(lower(btrim(l.email)), '') is not null and lower(btrim(d.email)) = lower(btrim(l.email))))
      and d.submitted_at >= ${webbyFrom("l")} - interval '1 hour') as deals,
  (select min(m.occurred_at) from public.maqsam_calls m
    where m.occurred_at >= ${webbyFrom("l")}
      and ${BY_SALES_REP}
      and ${CALL_IS_WITH_LEAD}) as first_contact
from public.leads l
where ${webbyLead("l")}
order by l.lead_created_at`;

/** Every day of webinar-campaign delivery, per ad. */
const SPEND_SQL = `select s.date::text as day, s.campaign_id, max(s.campaign_name) as campaign_name,
  s.ad_id, max(s.ad_name) as ad_name,
  sum(s.spend) as spend, sum(s.impressions) as impressions,
  sum(s.clicks) as clicks, sum(s.inline_link_clicks) as link_clicks
from public.meta_ad_snapshots s
where ${webbyCampaign("s")}
group by 1, 2, 4
order by 1`;

/** The B2B live training tables, when anything has reached them. */
const LT_SQL = `select
  (select count(*) from public.lt_events) as events,
  (select count(*) from public.lt_page_events) as page_events,
  (select count(*) from public.lt_attendance) as attendance,
  (select count(*) from public.lt_engagement) as engagement`;

/**
 * What hermes/webinar-pull keeps in Creative Triage (supabase/migrations/
 * 20260923g_webinar_collection.sql), in one read: the Zoom sessions, every
 * join and leave in the room, the chat and polls (a chat line that is only
 * "1" or ١ answers the pitch-1 ask), the gift survey, and the worker's last
 * run per source.
 */
const COLLECTED_SQL = `select
  (select coalesce(json_agg(x order by x.started_at), '[]'::json) from (
    select uuid, started_at, ended_at, pitch1_at, pitch2_at, complete
    from public.cockpit_webinar_sessions) x) as sessions,
  (select coalesce(json_agg(x), '[]'::json) from (
    select session_uuid, person_key, email, contact_id, internal, join_at, leave_at
    from public.cockpit_webinar_attendance where status = 'in_meeting') x) as attendance,
  (select coalesce(json_agg(x), '[]'::json) from (
    select session_uuid, kind, at, person_key,
      (kind = 'chat' and coalesce(body, '') ~ '^\\s*[1١]\\s*[!.]*\\s*$') as one,
      coalesce(payload ? 'to', false) as private
    from public.cockpit_webinar_engagement where session_uuid is not null) x) as engagement,
  (select coalesce(json_agg(x order by x.submitted_at), '[]'::json) from (
    select response_id, submitted_at, email, phone, contact_id, profit_band, profit_min
    from public.cockpit_webinar_forms) x) as survey,
  (select coalesce(json_agg(x), '[]'::json) from (
    select distinct on (p.source) p.source, p.started_at, p.finished_at, p.ok, p.via, p.detail, p.counts,
      (select max(q.finished_at) from public.cockpit_webinar_pulls q
        where q.source = p.source and q.ok) as last_ok
    from public.cockpit_webinar_pulls p order by p.source, p.started_at desc) x) as pulls,
  (select coalesce(json_agg(x), '[]'::json) from (
    select e.visitor_id,
      min(e.at) as first_at,
      min(e.at) filter (where e.page = 'landing') as first_landing,
      count(*) filter (where e.page = 'landing' and e.event = 'page_view') as landing_views,
      count(distinct e.session_id) filter (where e.page = 'landing' and e.event = 'page_view') as landing_sessions,
      bool_or(e.event = 'form_view') as form_view,
      bool_or(e.event = 'form_focus') as form_focus,
      bool_or(e.event = 'form_submit') as form_submit,
      bool_or(e.event = 'cta_click') as cta,
      max(e.value) filter (where e.event = 'scroll') as max_scroll,
      max(e.value) filter (where e.event = 'page_leave' and e.page = 'landing') as landing_seconds,
      min(e.at) filter (where e.page = 'thank_you' and e.event = 'page_view') as thank_you_at,
      bool_or(e.event = 'calendar_add') as calendar_add,
      bool_or(e.event = 'whatsapp_click') as whatsapp,
      bool_or(e.event = 'whatsapp_click' and e.label = 'placeholder') as whatsapp_placeholder,
      bool_or(e.event = 'survey_start') as survey_start,
      bool_or(e.event = 'survey_submit') as survey_submit,
      bool_or(e.event = 'video_play' and e.page = 'landing') as landing_video,
      bool_or(e.event = 'video_play' and e.page = 'thank_you') as thank_you_video,
      bool_or(e.event = 'video_progress' and e.page = 'thank_you' and e.value >= 75) as thank_you_video_75,
      (array_agg(e.utm_content order by e.at) filter (where e.utm_content is not null))[1] as utm_content,
      (array_agg(e.utm_source order by e.at) filter (where e.utm_source is not null))[1] as utm_source,
      bool_or(e.has_fbclid) as fbclid,
      (array_agg(e.device order by e.at))[1] as device
    from public.cockpit_webinar_page_events e
    where e.origin_host = 'webinar.maharamedia.com' and e.page <> 'live'
      and e.at > now() - interval '180 days'
    group by e.visitor_id) x) as visitors,
  (select coalesce(json_agg(x), '[]'::json) from (
    select e.visitor_id, e.at
    from public.cockpit_webinar_page_events e
    where e.origin_host = 'webinar.maharamedia.com' and e.event = 'join_click'
      and e.at > now() - interval '180 days') x) as joins,
  (select coalesce(json_agg(x), '[]'::json) from (
    select e.visitor_id, e.at, e.label
    from public.cockpit_webinar_page_events e
    where e.origin_host = 'webinar.maharamedia.com' and e.event = 'pitch_click'
      and e.label in ('pitch1', 'pitch2')
      and e.at > now() - interval '180 days') x) as pitches,
  (select coalesce(json_agg(x), '[]'::json) from (
    select m.contact_id, m.channel, m.step, m.status, count(*) as n
    from public.cockpit_webinar_messages m
    group by 1, 2, 3, 4) x) as messages,
  (select coalesce(json_agg(x), '[]'::json) from (
    select o.call_id, o.contact_id, o.categories, o.objections
    from public.cockpit_webinar_objections o) x) as objections`;

type SurveyRow = {
  submittedAt: number;
  email: string | null;
  phone: string | null;
  contactId: string | null;
  band: string | null;
  profitMin: number | null;
};

function runOf(r: Any): WebinarCollectorRun {
  const c = r?.counts && typeof r.counts === "object" ? r.counts : {};
  const flag = (x: unknown) => (x === true ? true : x === false ? false : null);
  return {
    at: ms(r?.finished_at) ?? ms(r?.started_at) ?? null,
    ok: flag(r?.ok),
    lastOkAt: ms(r?.last_ok) ?? null,
    via: r?.via ? String(r.via) : null,
    detail: r?.detail ? String(r.detail) : null,
    registration: flag(c.registration),
    joinLinkOk: flag(c.join_link_ok),
    pollsReadable: flag(c.polls_readable),
  };
}

type Journey = {
  contactId: string;
  email: string | null;
  adId: string | null;
  campaignId: string | null;
  registeredAt: number;
  sessionAt: number | null;
  roundKey: string;
  roundLabel: string;
  attended: boolean;
  noshow: boolean;
  survey: boolean;
  phone: string | null;
  /** The booking form's verdict (roas tags); qualified wins when both are set. */
  roas: "qualified" | "unqualified" | "not_ready" | null;
  /** The pitch whose booking link the contact came through, from utm_content. */
  pitchUtm: 1 | 2 | null;
  /** How many sessions' round tags the contact carries; 2 or more is a repeat registrant. */
  roundTags: number;
  calls: {
    type: string;
    bookedAt: number;
    startAt: number | null;
    status: string;
  }[];
  deals: {
    submittedAt: number;
    contracted: number;
    cash: number;
    confirmed: boolean;
  }[];
  firstContact: number | null;
};

function jsonArray(x: unknown): Any[] {
  if (Array.isArray(x)) return x;
  if (typeof x === "string" && x.trim().startsWith("[")) {
    try {
      return JSON.parse(x);
    } catch {
      return [];
    }
  }
  return [];
}

function roundOf(
  tag: string | null,
  field: string | null,
): {
  key: string;
  label: string;
} {
  const t = tag?.match(/^webby-([a-z]{3})-(\d{4})$/);
  if (t)
    return { key: tag as string, label: `${MONTHS[t[1]] ?? t[1]} ${t[2]}` };
  const f = (field ?? "").trim();
  if (f) return { key: `round:${f.toLowerCase()}`, label: f };
  return { key: "untagged", label: "Registrants with no round" };
}

function journeyOf(r: Row): Journey {
  const round = roundOf(r.round_tag ?? null, r.round_field ?? null);
  // A shown call is the dashboard's rule: showed, or confirmed or invalid
  // once its time has passed (show-rate rule, 2026-09-21).
  return {
    contactId: String(r.contact_id),
    email: r.email ?? null,
    adId: r.ad_id ? String(r.ad_id) : null,
    campaignId: r.campaign_id ? String(r.campaign_id) : null,
    registeredAt: ms(r.registered_at) ?? ms(r.created_at) ?? 0,
    sessionAt: ms(r.session_at) ?? null,
    roundKey: round.key,
    roundLabel: round.label,
    attended: r.attended === true || r.attended === "true",
    noshow: r.noshow === true || r.noshow === "true",
    survey: r.survey === true || r.survey === "true",
    phone: r.phone ? String(r.phone) : null,
    roas:
      r.roas_qualified === true
        ? "qualified"
        : r.roas_unqualified === true
          ? "unqualified"
          : r.roas_unprepared === true
            ? "not_ready"
            : null,
    pitchUtm: r.pitch_utm === "1" ? 1 : r.pitch_utm === "2" ? 2 : null,
    roundTags: num(r.round_tags),
    calls: jsonArray(r.calls).map(c => ({
      type: String(c.type),
      bookedAt: ms(c.booked_at) ?? 0,
      startAt: ms(c.start_at) ?? null,
      status: String(c.status ?? ""),
    })),
    deals: jsonArray(r.deals).map(d => ({
      submittedAt: ms(d.submitted_at) ?? 0,
      contracted: num(d.contracted),
      cash: num(d.cash),
      confirmed: d.confirmed === true || d.confirmed === "true",
    })),
    firstContact: ms(r.first_contact) ?? null,
  };
}

const shown = (c: Journey["calls"][number], now: number) =>
  c.status === "showed" ||
  ((c.status === "confirmed" || c.status === "invalid") &&
    c.startAt !== null &&
    c.startAt <= now);

const ratio = (a: number, b: number | null | undefined) =>
  b && b > 0 ? Math.round((a / b) * 1000) / 1000 : null;
const money2 = (x: number) => Math.round(x * 100) / 100;
const per = (a: number, b: number) =>
  b > 0 ? Math.round((a / b) * 100) / 100 : null;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The most common session time among a round's registrants. */
function sessionFor(list: Journey[]): number | null {
  const counts = new Map<number, number>();
  for (const j of list)
    if (j.sessionAt)
      counts.set(j.sessionAt, (counts.get(j.sessionAt) ?? 0) + 1);
  let best: number | null = null;
  let n = 0;
  for (const [t, c] of counts)
    if (c > n) {
      best = t;
      n = c;
    }
  return best;
}

type SpendRow = {
  day: string;
  campaignId: string;
  campaignName: string;
  adId: string;
  adName: string;
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
};

export const webinar: Adapter = {
  key: "webinar",
  label: "Webinar funnel",
  compute: async () => {
    const now = Date.now();
    const today = kuwaitDay(now);
    const notes: Note[] = [];
    const sources: SourceStamp[] = [];

    const [journeyRows, spendRows, ltRows, collectedRows] = await Promise.all([
      sql(B2B, JOURNEY_SQL),
      sql(B2B, SPEND_SQL),
      sql(B2B, LT_SQL).catch(() => [] as Row[]),
      // Read apart: when Creative Triage cannot be read, the funnel still
      // shows and says what is missing.
      sql(TRIAGE, COLLECTED_SQL).catch((e: unknown) => {
        notes.push({
          level: "warn",
          text: `Zoom and the survey could not be read from Creative Triage this run (${String(e instanceof Error ? e.message : e).slice(0, 120)}).`,
        });
        return null;
      }),
    ]);
    sources.push({
      name: "B2B GHL contacts, calls and closer form (webby-* tags)",
      ok: true,
      freshestAt: now,
    });
    const journeys = journeyRows.map(journeyOf);
    const spend: SpendRow[] = spendRows.map(r => ({
      day: String(r.day),
      campaignId: String(r.campaign_id),
      campaignName: String(r.campaign_name ?? ""),
      adId: String(r.ad_id),
      adName: String(r.ad_name ?? `Ad ${r.ad_id}`),
      spend: num(r.spend),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
      linkClicks: num(r.link_clicks),
    }));
    const lt = ltRows[0] ?? {};

    // What hermes/webinar-pull has collected.
    const collected: Row | null = collectedRows?.[0] ?? null;
    const zSessions: ZoomSession[] = jsonArray(collected?.sessions)
      .map(r => ({
        uuid: String(r.uuid),
        startedAt: ms(r.started_at) ?? 0,
        endedAt: ms(r.ended_at) ?? null,
        pitch1At: ms(r.pitch1_at) ?? null,
        pitch2At: ms(r.pitch2_at) ?? null,
        complete: r.complete === true,
      }))
      .filter(x => x.startedAt > 0);
    const zAttendance: ZoomAttendance[] = jsonArray(collected?.attendance)
      .map(r => ({
        sessionUuid: String(r.session_uuid),
        personKey: String(r.person_key),
        email: r.email ? String(r.email).trim().toLowerCase() : null,
        contactId: r.contact_id ? String(r.contact_id) : null,
        internal: r.internal === true,
        joinAt: ms(r.join_at) ?? 0,
        leaveAt: ms(r.leave_at) ?? null,
      }))
      .filter(x => x.joinAt > 0);
    const zEngagement: ZoomEngagement[] = jsonArray(collected?.engagement).map(
      r => ({
        sessionUuid: String(r.session_uuid),
        kind: r.kind,
        at: ms(r.at) ?? null,
        personKey: r.person_key ? String(r.person_key) : null,
        one: r.one === true,
        private: r.private === true,
      }),
    );
    const surveyRows: SurveyRow[] = jsonArray(collected?.survey).map(r => ({
      submittedAt: ms(r.submitted_at) ?? 0,
      email: r.email ? String(r.email).trim().toLowerCase() : null,
      phone: r.phone ? String(r.phone) : null,
      contactId: r.contact_id ? String(r.contact_id) : null,
      band: r.profit_band ? String(r.profit_band) : null,
      profitMin:
        r.profit_min === null || r.profit_min === undefined
          ? null
          : num(r.profit_min),
    }));
    const runs = new Map(
      jsonArray(collected?.pulls).map(r => [String(r.source), runOf(r)]),
    );
    const flag = (x: unknown) => x === true;
    const pageVisitors: PageVisitor[] = jsonArray(collected?.visitors)
      .map(r => ({
        visitorId: String(r.visitor_id),
        firstAt: ms(r.first_at) ?? 0,
        firstLanding: ms(r.first_landing) ?? null,
        landingViews: num(r.landing_views),
        landingSessions: num(r.landing_sessions),
        formView: flag(r.form_view),
        formFocus: flag(r.form_focus),
        formSubmit: flag(r.form_submit),
        cta: flag(r.cta),
        maxScroll:
          r.max_scroll === null || r.max_scroll === undefined
            ? null
            : num(r.max_scroll),
        landingSeconds:
          r.landing_seconds === null || r.landing_seconds === undefined
            ? null
            : num(r.landing_seconds),
        thankYouAt: ms(r.thank_you_at) ?? null,
        calendarAdd: flag(r.calendar_add),
        whatsapp: flag(r.whatsapp),
        whatsappPlaceholder: flag(r.whatsapp_placeholder),
        surveyStart: flag(r.survey_start),
        surveySubmit: flag(r.survey_submit),
        landingVideo: flag(r.landing_video),
        thankYouVideo: flag(r.thank_you_video),
        thankYouVideo75: flag(r.thank_you_video_75),
        utmContent: r.utm_content ? String(r.utm_content) : null,
        utmSource: r.utm_source ? String(r.utm_source) : null,
        fbclid: flag(r.fbclid),
        device: r.device ? String(r.device) : null,
      }))
      .filter(v => v.firstAt > 0);
    const joinClicks: JoinClick[] = jsonArray(collected?.joins)
      .map(r => ({ visitorId: String(r.visitor_id), at: ms(r.at) ?? 0 }))
      .filter(j => j.at > 0);
    const pitchClicks: PitchClick[] = jsonArray(collected?.pitches)
      .map(r => ({
        visitorId: String(r.visitor_id),
        at: ms(r.at) ?? 0,
        pitch: (r.label === "pitch2" ? 2 : 1) as 1 | 2,
      }))
      .filter(c => c.at > 0);
    const messageCounts: MessageCount[] = jsonArray(collected?.messages).map(
      r => ({
        contactId: String(r.contact_id),
        channel: r.channel,
        step: r.step ? String(r.step) : null,
        status: r.status ? String(r.status) : null,
        n: num(r.n),
      }),
    );
    const objectionCalls: ObjectionCall[] = jsonArray(
      collected?.objections,
    ).map(r => ({
      callId: String(r.call_id),
      contactId: r.contact_id ? String(r.contact_id) : null,
      categories: Array.isArray(r.categories) ? r.categories.map(String) : [],
      objections: jsonArray(r.objections).map(o => ({
        category: String(o?.category ?? "other"),
        handled: o?.handled ? String(o.handled) : null,
      })),
    }));
    const zoomRun = runs.get("zoom") ?? null;
    const remindersRun = runs.get("reminders") ?? null;
    const objectionsRun = runs.get("objections") ?? null;
    const formRun = runs.get("typeform") ?? null;
    const pollsReadable = zoomRun?.pollsReadable === true;

    // Survey responses to registrants: HighLevel contact id first, then the
    // email, then the phone. Never the name (the brief's rule). The latest
    // response of a person wins.
    const byContact = new Map(journeys.map(j => [j.contactId, j]));
    const byEmail = new Map<string, Journey>();
    const byPhone = new Map<string, Journey>();
    for (const j of journeys) {
      if (j.email) byEmail.set(j.email, j);
      const pk = phoneKey(j.phone);
      if (pk) byPhone.set(pk, j);
    }
    const journeyFor = (r: SurveyRow): Journey | null => {
      if (r.contactId && byContact.has(r.contactId))
        return byContact.get(r.contactId) ?? null;
      if (r.email && byEmail.has(r.email)) return byEmail.get(r.email) ?? null;
      const pk = phoneKey(r.phone);
      if (pk && byPhone.has(pk)) return byPhone.get(pk) ?? null;
      return null;
    };
    const surveyOf = new Map<string, SurveyRow>();
    let surveyUnmatched = 0;
    for (const r of [...surveyRows].sort(
      (a, b) => a.submittedAt - b.submittedAt,
    )) {
      const j = journeyFor(r);
      if (j) surveyOf.set(j.contactId, r);
      else surveyUnmatched++;
    }

    // Rounds: one per round tag (or field), dated by its registrants'
    // Webinar Datetime. Spend belongs to the next session on or after its
    // day; spend after the last known session is the next round's.
    const byRound = new Map<string, Journey[]>();
    for (const j of journeys)
      byRound.set(j.roundKey, [...(byRound.get(j.roundKey) ?? []), j]);
    const rounds = [...byRound.entries()].map(([key, list]) => ({
      key,
      label: list[0].roundLabel,
      sessionAt: sessionFor(list),
      list,
    }));
    const dated = rounds
      .filter(r => r.sessionAt !== null)
      .sort((a, b) => (a.sessionAt ?? 0) - (b.sessionAt ?? 0));
    const spendByRound = new Map<string, SpendRow[]>();
    const NEXT = "next";
    for (const s of spend) {
      const dayEnd = Date.parse(`${s.day}T23:59:59+03:00`);
      const target =
        dated.find(r => (r.sessionAt ?? 0) >= dayEnd - 86_400_000)?.key ??
        (dated.length ? NEXT : (rounds[0]?.key ?? NEXT));
      spendByRound.set(target, [...(spendByRound.get(target) ?? []), s]);
    }
    // Page visitors belong to the next session on or after their first
    // visit, like spend.
    const visitorsByRound = new Map<string, PageVisitor[]>();
    for (const v of pageVisitors) {
      const t = v.firstLanding ?? v.firstAt;
      const target =
        dated.find(r => (r.sessionAt ?? 0) >= t)?.key ??
        (dated.length ? NEXT : (rounds[0]?.key ?? NEXT));
      visitorsByRound.set(target, [...(visitorsByRound.get(target) ?? []), v]);
    }
    if (
      (spendByRound.has(NEXT) || visitorsByRound.has(NEXT)) &&
      !byRound.has(NEXT)
    )
      rounds.push({
        key: NEXT,
        label: "Next session",
        sessionAt: null,
        list: [],
      });

    // Zoom sessions to rounds: a session that started within hours of the
    // round's Webinar Datetime, or, for a round without one, in its tag's
    // month after its first registration.
    const HOUR = 3_600_000;
    const claimed = new Set<string>();
    const sessionsOf = new Map<string, ZoomSession[]>();
    for (const r of rounds) {
      const firstReg = r.list.length
        ? Math.min(...r.list.map(j => j.registeredAt))
        : 0;
      const tag = r.key.match(/^webby-([a-z]{3})-(\d{4})$/);
      const month = tag
        ? `${tag[2]}-${String(Object.keys(MONTHS).indexOf(tag[1]) + 1).padStart(2, "0")}`
        : null;
      const mine = zSessions.filter(z => {
        if (claimed.has(z.uuid)) return false;
        if (r.sessionAt !== null)
          return (
            z.startedAt >= r.sessionAt - 2 * HOUR &&
            z.startedAt <= r.sessionAt + 4 * HOUR
          );
        return (
          month !== null &&
          kuwaitDay(z.startedAt).slice(0, 7) === month &&
          z.startedAt >= firstReg
        );
      });
      for (const z of mine) claimed.add(z.uuid);
      sessionsOf.set(r.key, mine);
    }
    // A session nobody's Webinar Datetime points at still happened: with
    // three people or more from outside, it shows as a round of its own.
    const orphanDays = new Map<string, ZoomSession[]>();
    for (const z of zSessions.filter(x => !claimed.has(x.uuid))) {
      const d = kuwaitDay(z.startedAt);
      orphanDays.set(d, [...(orphanDays.get(d) ?? []), z]);
    }
    for (const [day, list] of orphanDays) {
      const ids = new Set(list.map(z => z.uuid));
      const people = new Set(
        zAttendance
          .filter(a => ids.has(a.sessionUuid) && !a.internal)
          .map(a => a.personKey),
      );
      if (people.size < 3) continue;
      const key = `zoom:${day}`;
      rounds.push({
        key,
        label: "Zoom session",
        sessionAt: Math.min(...list.map(z => z.startedAt)),
        list: [],
      });
      sessionsOf.set(key, list);
      notes.push({
        level: "warn",
        text: `A Zoom session on ${day} had ${people.size} people, but no registrant's Webinar Datetime points at it, so its registrations and spend sit elsewhere. Check the Webinar Datetime field on the registrants.`,
      });
    }

    const built: WebinarRound[] = [];
    const cameBy = new Map<
      string,
      { personLevel: boolean; came: (j: Journey) => boolean }
    >();
    for (const r of rounds) {
      const list = r.list;
      const sp = spendByRound.get(r.key) ?? [];
      const totalSpend = money2(sp.reduce((t, s) => t + s.spend, 0));
      const impressions = sp.reduce((t, s) => t + s.impressions, 0);
      const clicks = sp.reduce((t, s) => t + s.clicks, 0);
      const linkClicks = sp.reduce((t, s) => t + s.linkClicks, 0);
      const campaignIds = [...new Set(sp.map(s => s.campaignId))];
      const days = sp.map(s => s.day).sort();
      // Reach and frequency for the round's window, deduplicated by Meta.
      let reach: number | null = null;
      let frequency: number | null = null;
      if (campaignIds.length && days.length) {
        try {
          const f = await readInsights(
            campaignIds,
            days[0],
            days[days.length - 1],
          );
          reach = f?.reach ?? null;
          frequency = f?.frequency ?? null;
        } catch (e) {
          notes.push({
            level: "warn",
            text: `Reach and frequency for ${r.label} could not be read from Meta this run (${String(e instanceof Error ? e.message : e).slice(0, 120)}).`,
          });
        }
      }

      // Who came. Zoom is the source of truth for the room; a registrant is
      // tied to a Zoom row only by contact id or email. The webby-attended
      // tag still counts a person when somebody tagged them.
      const room = roomOf(
        sessionsOf.get(r.key) ?? [],
        zAttendance,
        zEngagement,
        {
          scheduledAt: r.sessionAt,
          pollsReadable,
        },
      );
      const roomEmails = new Set(room?.emails ?? []);
      const roomContacts = new Set(room?.contactIds ?? []);
      const inZoom = (j: Journey) =>
        roomContacts.has(j.contactId) ||
        (j.email !== null && roomEmails.has(j.email));
      const cameJ = (j: Journey) => j.attended || inZoom(j);
      const matched = room ? list.filter(inZoom).length : 0;
      const tagged = list.some(j => j.attended || j.noshow);
      const registrations = list.length;
      const tagAttended = list.filter(j => j.attended).length;
      const noShow = list.filter(j => j.noshow).length;
      const attendSource: WebinarRound["showUp"]["source"] = room
        ? "zoom"
        : tagged
          ? "tags"
          : null;
      const attended = room ? room.attendees : tagAttended;
      const attendanceRecorded = attendSource !== null;
      const personLevel =
        tagged ||
        (room !== null && room.attendees > 0 && matched >= room.attendees / 2);
      const came = list.filter(cameJ);
      cameBy.set(r.key, { personLevel, came: cameJ });

      const booked = list.filter(j => j.calls.length > 0);
      const held = list.filter(j => j.calls.some(c => shown(c, now)));
      const due = list.filter(j =>
        j.calls.some(c => c.startAt !== null && c.startAt <= now),
      );
      const closed = list.filter(j => j.deals.length > 0);
      const contracted = money2(
        closed.reduce(
          (t, j) => t + j.deals.reduce((a, d) => a + d.contracted, 0),
          0,
        ),
      );
      const cash = money2(
        closed.reduce((t, j) => t + j.deals.reduce((a, d) => a + d.cash, 0), 0),
      );
      const cashConfirmed = money2(
        closed.reduce(
          (t, j) =>
            t +
            j.deals.filter(d => d.confirmed).reduce((a, d) => a + d.cash, 0),
          0,
        ),
      );
      const session = r.sessionAt;
      const bookedWhileLive = session
        ? booked.filter(j =>
            j.calls.some(
              c =>
                c.bookedAt >= session && c.bookedAt <= session + 3 * 3_600_000,
            ),
          ).length
        : null;
      const leadDays = { d0_1: 0, d2_3: 0, d4_7: 0, d8plus: 0 };
      if (session)
        for (const j of list) {
          const d = Math.floor((session - j.registeredAt) / 86_400_000);
          if (d <= 1) leadDays.d0_1++;
          else if (d <= 3) leadDays.d2_3++;
          else if (d <= 7) leadDays.d4_7++;
          else leadDays.d8plus++;
        }
      const contacted = list.filter(j => j.firstContact !== null);
      const firstContactMin = median(
        contacted.map(j => ((j.firstContact ?? 0) - j.registeredAt) / 60_000),
      );
      const status: WebinarRound["status"] =
        session === null ? "unknown" : session > now ? "upcoming" : "held";

      // Qualification: the booking form's verdict when there is one, else
      // the survey's yearly profit against the call funnel's line.
      const profitOf = (j: Journey) =>
        surveyOf.get(j.contactId)?.profitMin ?? null;
      const verdictOf = (j: Journey) => {
        if (j.roas) return j.roas;
        const p = profitOf(j);
        return p === null
          ? null
          : p >= QUALIFIED_PROFIT
            ? "qualified"
            : "unqualified";
      };
      const verdicts = list.map(verdictOf);
      const qualifiedN = verdicts.filter(v => v === "qualified").length;
      const notQualifiedN = verdicts.filter(
        v => v === "unqualified" || v === "not_ready",
      ).length;
      const answered = list.filter(j => surveyOf.has(j.contactId));
      const bands = new Map<
        string,
        { label: string; min: number; n: number }
      >();
      for (const j of answered) {
        const sv = surveyOf.get(j.contactId);
        if (!sv?.band) continue;
        const b = bands.get(sv.band) ?? {
          label: sv.band,
          min: sv.profitMin ?? 0,
          n: 0,
        };
        b.n++;
        bands.set(sv.band, b);
      }

      built.push({
        key: r.key,
        label: r.label,
        sessionAt: session,
        status,
        campaigns: campaignIds.map(id => ({
          id,
          name: sp.find(s => s.campaignId === id)?.campaignName ?? id,
        })),
        spendFrom: days[0] ?? null,
        spendTo: days[days.length - 1] ?? null,
        traffic: {
          spend: totalSpend,
          impressions,
          reach,
          frequency,
          clicks,
          linkClicks,
          ctr: ratio(clicks, impressions),
          linkCtr: ratio(linkClicks, impressions),
        },
        registration: {
          registrations,
          withAdId: list.filter(j => j.adId).length,
          repeat: list.filter(j => j.roundTags > 1).length,
          costPerRegistration: per(totalSpend, registrations),
          leadDays: session ? leadDays : null,
          firstRegisteredAt: list.length
            ? Math.min(...list.map(j => j.registeredAt))
            : null,
        },
        showUp: {
          attendanceRecorded,
          attended,
          noShow,
          showRate: attendanceRecorded ? ratio(attended, registrations) : null,
          source: attendSource,
          matched,
          personLevel,
          // The brief's non-attendee salvage: people who did not come and
          // booked a call anyway. Only with attendees tied to registrants.
          salvage:
            attendanceRecorded && personLevel
              ? {
                  missed: list.filter(j => !cameJ(j)).length,
                  booked: list.filter(j => !cameJ(j) && j.calls.length > 0)
                    .length,
                }
              : null,
          showRateByLead:
            session && attendanceRecorded && personLevel
              ? (["d0_1", "d2_3", "d4_7", "d8plus"] as const).map(k => {
                  const inBucket = list.filter(j => {
                    const d = Math.floor(
                      (session - j.registeredAt) / 86_400_000,
                    );
                    return k === "d0_1"
                      ? d <= 1
                      : k === "d2_3"
                        ? d >= 2 && d <= 3
                        : k === "d4_7"
                          ? d >= 4 && d <= 7
                          : d >= 8;
                  });
                  return {
                    bucket: k,
                    registrants: inBucket.length,
                    attended: inBucket.filter(cameJ).length,
                  };
                })
              : null,
        },
        room,
        reminders: reminderStats(
          messageCounts,
          new Set(list.map(j => j.contactId)),
        ),
        objections: objectionStats(
          objectionCalls,
          new Set(list.map(j => j.contactId)),
        ),
        page:
          (visitorsByRound.get(r.key) ?? []).length ||
          (session !== null &&
            (joinClicks.some(
              j =>
                j.at >= session - 24 * 3_600_000 &&
                j.at <= session + 3 * 3_600_000,
            ) ||
              pitchClicks.some(
                c =>
                  c.at >= session - 3_600_000 &&
                  c.at <= session + 48 * 3_600_000,
              )))
            ? pageStats(
                visitorsByRound.get(r.key) ?? [],
                joinClicks,
                session,
                pitchClicks,
              )
            : null,
        qualification: {
          surveyAnswered: answered.length,
          surveyQualified: answered.filter(
            j => (profitOf(j) ?? -1) >= QUALIFIED_PROFIT,
          ).length,
          booking: {
            qualified: list.filter(j => j.roas === "qualified").length,
            unqualified: list.filter(j => j.roas === "unqualified").length,
            notReady: list.filter(j => j.roas === "not_ready").length,
          },
          qualified: qualifiedN,
          notQualified: notQualifiedN,
          unknown: registrations - qualifiedN - notQualifiedN,
          costPerQualified: per(totalSpend, qualifiedN),
          bands: [...bands.values()].sort((a, b) => a.min - b.min),
          threshold: QUALIFIED_PROFIT,
        },
        pitchBookings: {
          pitch1: list.filter(j => j.pitchUtm === 1 && j.calls.length > 0)
            .length,
          pitch2: list.filter(j => j.pitchUtm === 2 && j.calls.length > 0)
            .length,
        },
        conversion: {
          surveys: list.filter(j => j.survey || surveyOf.has(j.contactId))
            .length,
          booked: booked.length,
          bookedIntro: booked.filter(j => j.calls.some(c => c.type === "intro"))
            .length,
          bookedDemo: booked.filter(j => j.calls.some(c => c.type === "demo"))
            .length,
          bookedWhileLive,
          attendeeToBooked:
            attendanceRecorded && personLevel
              ? ratio(booked.filter(cameJ).length, came.length)
              : null,
          registrantToBooked: ratio(booked.length, registrations),
          costPerBooked: per(totalSpend, booked.length),
        },
        sales: {
          due: due.length,
          held: held.length,
          bookedToHeld: ratio(held.length, due.length),
          closes: closed.length,
          closeRate: ratio(closed.length, held.length),
          attendeeToClose:
            attendanceRecorded && personLevel
              ? ratio(closed.filter(cameJ).length, came.length)
              : null,
          contracted,
          cash,
          cashConfirmed,
          cac: per(totalSpend, closed.length),
          roasCash: per(cash, totalSpend),
          roasContracted: per(contracted, totalSpend),
          firstContactMedianMin:
            firstContactMin === null
              ? null
              : Math.round(firstContactMin * 10) / 10,
          neverContacted: registrations - contacted.length,
        },
      });
    }
    built.sort(
      (a, b) =>
        (b.sessionAt ?? Number.MAX_SAFE_INTEGER) -
          (a.sessionAt ?? Number.MAX_SAFE_INTEGER) ||
        (b.registration.firstRegisteredAt ?? 0) -
          (a.registration.firstRegisteredAt ?? 0),
    );

    // Per ad, per round: the brief's ad-level question, spend to cash.
    const ads: WebinarPayload["ads"] = [];
    for (const r of rounds) {
      const sp = spendByRound.get(r.key) ?? [];
      const who = cameBy.get(r.key);
      const pageByAd = new Map<string, number>();
      for (const v of visitorsByRound.get(r.key) ?? [])
        if (v.firstLanding !== null && v.utmContent && AD_ID.test(v.utmContent))
          pageByAd.set(v.utmContent, (pageByAd.get(v.utmContent) ?? 0) + 1);
      const ids = new Set([
        ...sp.map(s => s.adId),
        ...r.list.map(j => j.adId).filter((x): x is string => Boolean(x)),
        ...pageByAd.keys(),
      ]);
      for (const adId of ids) {
        const rows = sp.filter(s => s.adId === adId);
        const regs = r.list.filter(j => j.adId === adId);
        const adSpend = money2(rows.reduce((t, s) => t + s.spend, 0));
        const impressions = rows.reduce((t, s) => t + s.impressions, 0);
        const clicks = rows.reduce((t, s) => t + s.clicks, 0);
        ads.push({
          roundKey: r.key,
          adId,
          adName: rows[0]?.adName ?? `Ad ${adId}`,
          campaignName: rows[0]?.campaignName ?? null,
          spend: adSpend,
          impressions,
          clicks,
          ctr: ratio(clicks, impressions),
          registrations: regs.length,
          visitors: pageVisitors.length ? (pageByAd.get(adId) ?? 0) : null,
          pageConversion: pageByAd.get(adId)
            ? ratio(regs.length, pageByAd.get(adId))
            : null,
          attended: who?.personLevel ? regs.filter(who.came).length : null,
          booked: regs.filter(j => j.calls.length > 0).length,
          closes: regs.filter(j => j.deals.length > 0).length,
          cash: money2(
            regs.reduce(
              (t, j) => t + j.deals.reduce((a, d) => a + d.cash, 0),
              0,
            ),
          ),
          costPerRegistration: per(adSpend, regs.length),
        });
      }
    }
    ads.sort((a, b) => b.spend - a.spend || b.registrations - a.registrations);

    // The worker's health, as the cockpit sees it.
    const surveyResponses = collected ? surveyRows.length : null;
    const zoomReads = zoomRun?.lastOkAt != null;
    const formReads = formRun?.lastOkAt != null;
    // Zoom, the survey and Fathom are read hourly, HighLevel's messages every
    // six hours: late is three missed runs of the source's own rhythm.
    const stale = (run: WebinarCollectorRun | null, every = 1) =>
      run?.lastOkAt != null && now - run.lastOkAt > 3 * every * HOUR;
    sources.push({
      name: "Zoom and the gift survey (hermes/webinar-pull)",
      ok:
        collected !== null &&
        zoomRun?.ok === true &&
        formRun?.ok === true &&
        !stale(zoomRun) &&
        !stale(formRun),
      freshestAt:
        Math.min(zoomRun?.lastOkAt ?? now, formRun?.lastOkAt ?? now) ||
        undefined,
      note: !zoomRun
        ? "The worker has not run yet."
        : zoomRun.ok === false
          ? `Zoom: ${zoomRun.detail ?? "the last read failed"}`
          : formRun?.ok === false
            ? `Survey: ${formRun.detail ?? "the last read failed"}`
            : undefined,
    });
    for (const [name, run, every] of [
      ["Zoom", zoomRun, 1],
      ["The survey", formRun, 1],
      ["HighLevel's messages", remindersRun, 6],
      ["Fathom's calls", objectionsRun, 1],
    ] as const) {
      if (run?.ok === false)
        notes.push({
          level: "warn",
          text: `${name} could not be read on the last run: ${String(run.detail ?? "no reason given").slice(0, 160)}. The worker tries again within the hour.`,
        });
      else if (stale(run, every))
        notes.push({
          level: "warn",
          text: `${name} was last read ${Math.round((now - (run?.lastOkAt ?? now)) / HOUR)} hours ago: the webinar-pull cron on the VPS has stopped (RUNBOOK.md, "Webinar pull").`,
        });
    }
    if (zoomRun?.joinLinkOk === false)
      notes.push({
        level: "warn",
        text: "webinar.maharamedia.com/live, the join link in the WhatsApp reminders (1 hour, 15 and 5 minutes before, started, last call), does not lead to Zoom: it answers 404. Point it at the Zoom meeting before the next session.",
      });

    const anyRegistrant = journeys.length > 0;
    const anySpend = spend.length > 0;
    const anyAdId = journeys.some(j => j.adId);
    const anyTags = journeys.some(j => j.attended || j.noshow);
    const anyRoom = built.some(r => (r.room?.attendees ?? 0) > 0);
    const anyChat = built.some(r => (r.room?.chat.messages ?? 0) > 0);
    const anyQual = built.some(
      r =>
        r.qualification.surveyAnswered +
          r.qualification.booking.qualified +
          r.qualification.booking.unqualified +
          r.qualification.booking.notReady >
        0,
    );
    const anyPitch = journeys.some(j => j.pitchUtm !== null);
    const anySession = journeys.some(j => j.sessionAt !== null);
    const anyReminder = built.some(r => r.reminders !== null);
    const anyObjection = built.some(r => r.objections !== null);
    const anyPage = pageVisitors.length > 0;
    const anyThankYou = pageVisitors.some(v => v.thankYouAt !== null);
    const anyJoin = joinClicks.length > 0;
    const placeholderClicks = pageVisitors.filter(
      v => v.whatsappPlaceholder,
    ).length;
    if (placeholderClicks)
      notes.push({
        level: "warn",
        text: `${placeholderClicks} people pressed the WhatsApp group button on the thank-you page, which still has no link ([WHATSAPP_LINK] in sites/webinar/thank-you.html).`,
      });
    const matchedAll = built.reduce((t, r) => t + r.showUp.matched, 0);
    const waitRegistrants =
      "Waiting for the first registrant: the Webinar Opt In form creates the contact and the WEBBY workflow tags it webby-registered.";
    const workerMissing =
      "Not connected yet: hermes/webinar-pull has not read Zoom (VPS cron, hourly).";

    const tracking: WebinarPayload["tracking"] = [
      {
        stage: 1,
        metric: "Spend, impressions, clicks, link clicks, CTR",
        source: "Meta Ads API, ad level (B2B snapshots)",
        status: anySpend ? "live" : "waiting",
        note: anySpend
          ? "Read from the webinar campaigns."
          : "No webinar campaign has delivered yet. Put Webinar or Training in the campaign's name so both funnels place its spend.",
      },
      {
        stage: 1,
        metric: "Reach and frequency",
        source: "Meta insights for the round's dates",
        status: anySpend ? "live" : "waiting",
        note: "Read once per round, so a person reached on two days counts once.",
      },
      {
        stage: 1,
        metric: "Landing page visitors, page conversion, form started and sent",
        source: "webinar.maharamedia.com page events (mm-track.js)",
        status: anyPage ? "live" : "waiting",
        note: anyPage
          ? "The page's own events: visitors, time on page, scroll, the register buttons, the form seen, started and sent. Page conversion is HighLevel's registrations over the page's visitors."
          : "Connected on 2026-09-23. Waiting for the first visit to webinar.maharamedia.com.",
      },
      {
        stage: 1,
        metric: "Registrations and cost per registration",
        source: "HighLevel contact tagged webby-registered",
        status: anyRegistrant ? "live" : "waiting",
        note: anyRegistrant
          ? "Counted from HighLevel, never from the page."
          : waitRegistrants,
      },
      {
        stage: 1,
        metric: "Registration source down to the ad",
        source: "HighLevel attribution (utm_content = ad id)",
        status: anyAdId ? "live" : anyRegistrant ? "missing" : "waiting",
        note: anyAdId
          ? "Registrants carry the ad they came from."
          : "Every ad's URL must carry utm_content={{ad.id}}, or registrations cannot be tied to an ad.",
      },
      {
        stage: 1,
        metric:
          "Qualification: yearly profit, years in the market, type of work",
        source:
          "Gift survey (Typeform P1xP4r24) and the booking form's roas tags",
        status: anyQual ? "live" : formReads ? "waiting" : "missing",
        note: anyQual
          ? `Qualified is a yearly net profit of $100K or more in the survey, or roas-qualified from the booking form, which wins when both exist. The survey does not ask role or city.${surveyUnmatched ? ` ${surveyUnmatched} survey responses match no registrant by contact id, email or phone.` : ""}`
          : formReads
            ? "Connected. Waiting for the first registrant to answer the survey (thank-you page, and after the session) or the booking form."
            : "Not connected yet: hermes/webinar-pull has not read the survey.",
      },
      {
        stage: 1,
        metric: "Days between registering and the session",
        source: "HighLevel Webinar Datetime field",
        status: anySession ? "live" : "waiting",
        note: "From the contact's creation, or three weeks before the session for an older contact.",
      },
      {
        stage: 2,
        metric: "Reminders sent, delivered, opened, clicked",
        source:
          "HighLevel conversations (hermes/webinar-pull); clicks from the /live join link",
        status: anyReminder
          ? "live"
          : remindersRun?.lastOkAt != null
            ? "waiting"
            : "missing",
        note: anyReminder
          ? "Every WhatsApp, SMS and email HighLevel sent a registrant after they registered, with its status; WhatsApp's read receipt is the open. Clicks are the join-link clicks. Email opens and clicks sit in Kit, whose API key in HighLevel is still a placeholder."
          : remindersRun?.lastOkAt != null
            ? "Connected. Waiting for the first registrant's messages."
            : "Not connected yet: hermes/webinar-pull has not read HighLevel's messages.",
      },
      {
        stage: 2,
        metric: "Calendar-add clicks",
        source: "Thank-you page events (mm-track.js)",
        status: anyThankYou ? "live" : "waiting",
        note: anyThankYou
          ? "People who pressed Add to calendar, over the people who reached the thank-you page."
          : "Connected on 2026-09-23. Waiting for the first registrant to reach the thank-you page.",
      },
      {
        stage: 2,
        metric: "Join-link clicks from the reminders",
        source:
          "webinar.maharamedia.com/live, the link in the WhatsApp reminders",
        status: anyJoin ? "live" : "waiting",
        note: anyJoin
          ? "People who opened the join link, from a day before the session to three hours after its start, split at the start."
          : "Connected on 2026-09-23: /live records the click and opens Zoom. Waiting for the first reminder.",
      },
      {
        stage: 2,
        metric: "Attendees, show rate, on-time rate",
        source:
          "Zoom participants (hermes/webinar-pull), or the webby-attended / webby-noshow tags",
        status: anyRoom || anyTags ? "live" : zoomReads ? "waiting" : "missing",
        note:
          anyRoom || anyTags
            ? "People in the room come from Zoom, our own team left out."
            : zoomReads
              ? "Connected. The session is read within the hour after it ends."
              : workerMissing,
      },
      {
        stage: 2,
        metric:
          "Attendees tied to a registrant (show rate by lead time and by ad)",
        source:
          "Zoom registration, or an attendee signed in to Zoom with the registered email",
        status:
          zoomRun?.registration === true || anyTags
            ? "live"
            : matchedAll > 0
              ? "live"
              : "missing",
        note:
          zoomRun?.registration === true
            ? "Zoom registration is on, so every attendee carries their registration."
            : "Zoom registration is off, so a guest joins with a name only and cannot be tied to a registrant; the brief never matches by name. Show rate and the retention curve do not need it. Attendee to booked, show rate by lead time and by ad do: turn on registration in Zoom and send each registrant their own join link.",
      },
      {
        stage: 3,
        metric:
          "Watch time, retention curve, presence at each pitch, drop-offs",
        source: "Zoom join and leave times (hermes/webinar-pull)",
        status: anyRoom ? "live" : zoomReads ? "waiting" : "missing",
        note: anyRoom
          ? "One row per join and leave; concurrent attendance is counted at the middle of each minute."
          : zoomReads
            ? "Connected. Waiting for the first session."
            : workerMissing,
      },
      {
        stage: 3,
        metric: "Chat, polls, Q&A, the pitch-1 “drop a 1” count",
        source:
          "Zoom recording chat; polls and Q&A from the Zoom app (hermes/webinar-pull)",
        status: anyChat ? "live" : zoomReads ? "waiting" : "missing",
        note: `Chat comes from the session's cloud recording, so recording must stay on. ${pollsReadable ? "Polls and Q&A come from the Zoom app." : "Polls and Q&A need the Zoom app keys on the VPS; Composio's Zoom connection cannot read them."} Pitch 1 is found from the burst of 1s in the chat unless a time is set here.`,
      },
      {
        stage: 4,
        metric: "Pitch link clicks and bookings, per pitch",
        source:
          "webinar.maharamedia.com/p1 and /p2; utm_content=pitch1 / pitch2 kept by HighLevel",
        status: anyPitch || pitchClicks.length ? "live" : "waiting",
        note: "Share webinar.maharamedia.com/p1 at pitch 1 and webinar.maharamedia.com/p2 at pitch 2. Each records the click and opens the booking page with its pitch in utm_content, which HighLevel keeps on whoever books, so clicks and bookings both say which pitch converted.",
      },
      {
        stage: 4,
        metric: "Calls booked, while live and after",
        source: "HighLevel appointments (intro and demo calendars)",
        status: anyRegistrant ? "live" : "waiting",
        note: "A registrant's calls from the moment they registered.",
      },
      {
        stage: 4,
        metric: "Post-event survey completions",
        source:
          "Typeform P1xP4r24 (hermes/webinar-pull), and the webby-survey-done tag",
        status: formReads ? "live" : "missing",
        note: formReads
          ? `${surveyResponses ?? 0} responses stored; ${surveyOf.size} tied to a registrant.`
          : "Not connected yet: hermes/webinar-pull has not read the survey.",
      },
      {
        stage: 5,
        metric: "Call held or no-show, close, contract value, cash",
        source: "HighLevel appointment status, the closer form, Whop",
        status: anyRegistrant ? "live" : "waiting",
        note: "The same rules as the call funnel, for registrants only.",
      },
      {
        stage: 5,
        metric: "Speed to first contact after registering",
        source: "Maqsam, a sales rep's first call",
        status: anyRegistrant ? "live" : "waiting",
        note: "Median minutes from registering to the first call a setter or closer made.",
      },
      {
        stage: 5,
        metric: "Objection category",
        source:
          "Fathom transcripts, tagged by deepseek-flash (hermes/webinar-pull)",
        status: anyObjection
          ? "live"
          : objectionsRun?.lastOkAt != null
            ? "waiting"
            : "missing",
        note: anyObjection
          ? "Each registrant's sales calls, tagged once from the transcript into fixed categories with the prospect's own words, never from the closer's notes. Client-service calls (launch, check-in, onboarding) are left out."
          : objectionsRun?.lastOkAt != null
            ? "Connected. Waiting for the first sales call with a registrant."
            : "Not connected yet: hermes/webinar-pull has not read Fathom.",
      },
    ];

    if (!anyRegistrant && !anySpend && !built.length)
      notes.push({
        level: "info",
        text: "The webinar has not started: no registrant carries a webby tag and no webinar campaign has spent. Every number here fills in on its own once it does.",
      });

    const payload: WebinarPayload = {
      today,
      rounds: built,
      ads,
      tracking,
      targets: WEBINAR_TARGETS,
      surveyResponses,
      survey: { matched: surveyOf.size, unmatched: surveyUnmatched },
      collector: {
        zoom: zoomRun,
        typeform: formRun,
        reminders: remindersRun,
        objections: objectionsRun,
      },
      lt: {
        events: num(lt.events),
        pageEvents: num(lt.page_events),
        attendance: num(lt.attendance),
        engagement: num(lt.engagement),
      },
      notes,
    };
    return { payload, sources };
  },
};
