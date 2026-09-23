import { callTool } from "../../tools";
import { readInsights } from "../frequency";
import type { Note, WebinarPayload, WebinarRound } from "../payloads";
import { B2B, ms, num, type Row, sql } from "../sb";
import { kuwaitDay } from "../time";
import type { Adapter, SourceStamp } from "../types";
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
 * - Zoom, the landing page's events and the reminder stats are not connected
 *   yet; `tracking` says so per metric instead of showing zeros.
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
  ${fieldValue("l", ROUND_FIELD)} as round_field,
  'webby-attended' = any(l.tags) as attended,
  'webby-noshow' = any(l.tags) as noshow,
  'webby-survey-done' = any(l.tags) as survey,
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

const TYPEFORM_SURVEY = "P1xP4r24";

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

    const [journeyRows, spendRows, ltRows] = await Promise.all([
      sql(B2B, JOURNEY_SQL),
      sql(B2B, SPEND_SQL),
      sql(B2B, LT_SQL).catch(() => [] as Row[]),
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
    if (spendByRound.has(NEXT) && !byRound.has(NEXT))
      rounds.push({
        key: NEXT,
        label: "Next session",
        sessionAt: null,
        list: [],
      });

    const built: WebinarRound[] = [];
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

      const registrations = list.length;
      const attended = list.filter(j => j.attended).length;
      const noShow = list.filter(j => j.noshow).length;
      const attendanceRecorded = attended + noShow > 0;
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
          showRateByLead:
            session && attendanceRecorded
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
                    attended: inBucket.filter(j => j.attended).length,
                  };
                })
              : null,
        },
        conversion: {
          surveys: list.filter(j => j.survey).length,
          booked: booked.length,
          bookedIntro: booked.filter(j => j.calls.some(c => c.type === "intro"))
            .length,
          bookedDemo: booked.filter(j => j.calls.some(c => c.type === "demo"))
            .length,
          bookedWhileLive,
          attendeeToBooked: attendanceRecorded
            ? ratio(booked.filter(j => j.attended).length, attended)
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
          attendeeToClose: attendanceRecorded
            ? ratio(closed.filter(j => j.attended).length, attended)
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
      const ids = new Set([
        ...sp.map(s => s.adId),
        ...r.list.map(j => j.adId).filter((x): x is string => Boolean(x)),
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
          attended: regs.filter(j => j.attended).length,
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

    // The post-event survey (Typeform), counted from its responses API.
    let surveyResponses: number | null = null;
    try {
      const since = new Date(now - 120 * 86_400_000).toISOString().slice(0, 19);
      const res: Any = await callTool("pd_typeform_proxy_get", {
        url: `https://api.typeform.com/forms/${TYPEFORM_SURVEY}/responses?page_size=1&since=${since}`,
      });
      surveyResponses = num(res?.total_items);
      sources.push({
        name: "Typeform survey (P1xP4r24)",
        ok: true,
        freshestAt: now,
      });
    } catch (e) {
      sources.push({
        name: "Typeform survey (P1xP4r24)",
        ok: false,
        note: String(e instanceof Error ? e.message : e).slice(0, 140),
      });
    }

    const anyRegistrant = journeys.length > 0;
    const anySpend = spend.length > 0;
    const anyAdId = journeys.some(j => j.adId);
    const anyAttendance = journeys.some(j => j.attended || j.noshow);
    const anySession = journeys.some(j => j.sessionAt !== null);
    const ltPage = num(lt.page_events) > 0;
    const ltZoom = num(lt.attendance) > 0;
    const ltEngagement = num(lt.engagement) > 0;
    const waitRegistrants =
      "Waiting for the first registrant: the Webinar Opt In form creates the contact and the WEBBY workflow tags it webby-registered.";

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
        metric: "Landing page sessions, visitors, form starts",
        source: "Landing page events (B2B lt_page_events)",
        status: ltPage ? "live" : "missing",
        note: ltPage
          ? "From the page's own events."
          : "Not connected: webinar.maharamedia.com sends no events, and the B2B lt-events-ingest function only accepts training.maharamedia.com. Registration rate and page conversion stay empty until both are fixed.",
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
        metric: "Qualification: firm type, service line, revenue, role, city",
        source: "Landing page form fields into HighLevel",
        status: "missing",
        note: "The Webinar Opt In form does not ask these, so qualified registrations and cost per qualified registration cannot be counted.",
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
        source: "HighLevel workflow stats, Kit email stats",
        status: "missing",
        note: "HighLevel's API does not give workflow message stats, and the Kit API key in HighLevel is still a placeholder.",
      },
      {
        stage: 2,
        metric: "Calendar-add clicks",
        source: "Thank-you page event",
        status: "missing",
        note: "The thank-you page sends no events.",
      },
      {
        stage: 2,
        metric: "Attendees, show rate, show rate by lead time and by ad",
        source: "Zoom participants, or the webby-attended / webby-noshow tags",
        status: anyAttendance || ltZoom ? "live" : "waiting",
        note:
          anyAttendance || ltZoom
            ? "Attendance is recorded."
            : "Nothing marks attendance yet: after the session, the Zoom attendee list has to reach HighLevel as webby-attended and webby-noshow tags.",
      },
      {
        stage: 3,
        metric:
          "Watch time, retention curve, presence at each pitch, drop-offs",
        source: "Zoom join and leave times (B2B lt_attendance)",
        status: ltZoom ? "live" : "missing",
        note: ltZoom
          ? "From Zoom's join and leave rows."
          : "Not connected: nothing pulls Zoom's participant report yet.",
      },
      {
        stage: 3,
        metric: "Chat, polls, Q&A, the pitch-1 “drop a 1” count",
        source: "Zoom chat, polls and Q&A (B2B lt_engagement)",
        status: ltEngagement ? "live" : "missing",
        note: "Not connected yet.",
      },
      {
        stage: 4,
        metric: "Pitch link clicks, per pitch",
        source: "One booking link per pitch",
        status: ltEngagement ? "live" : "missing",
        note: "There are no separate pitch-1 and pitch-2 links yet. Two HighLevel trigger links, each tagging who clicked, would do it at no cost.",
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
        source: "Typeform P1xP4r24, and the webby-survey-done tag",
        status: surveyResponses !== null ? "live" : "missing",
        note:
          surveyResponses !== null
            ? `${surveyResponses} responses in the last 120 days.`
            : "Typeform could not be read this run.",
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
        source: "Fathom transcripts",
        status: "missing",
        note: "Nothing tags objections from the transcripts yet.",
      },
    ];

    if (!anyRegistrant && !anySpend)
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
