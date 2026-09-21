import type { CallsPayload, CallWindow, Note, WorkingHours } from "../payloads";
import { num, type Row, sql, TRIAGE } from "../sb";
import { workingHoursForAdapters } from "../settings";
import { addDays, KUWAIT_OFFSET_MS, kuwaitDay } from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";
import { describeWorkingHours, workingMinutesSql } from "../workingHours";

/**
 * Call centre numbers from the dialer's reporting store in Creative Triage
 * (mahara_reporting.facts, source maqsam, kind call). The formulas are the
 * dialer's own: a dial is an outbound call with exactly one agent, connected
 * is state completed with a duration above 0, and talk time only counts
 * connected calls (inbound abandoned calls carry waiting time, not talk).
 */

/** First Kuwait day on which dialer calls carry the lead phone. */
const PHONE_SINCE = "2026-09-12";

/** The dialer imports about every 40 s while healthy. */
const STORE_STALE_MS = 30 * 60_000;

/** The GHL leads cron runs hourly; past 3 hours at least two runs failed. */
const LEADS_STALE_MS = 3 * 3600_000;

/** Clients on the roster (Pulse uses the same statuses). */
const LIVE = `g.status in ('Active', 'Launching', 'Paused')`;

/**
 * Leads of these clients are the call centre's job (DWY clients dial their
 * own). A blank Service Mode is unknown and stays out until the CSM fills it
 * (plan decision 2), but those clients are named in a note.
 */
const SPEED_SCOPE = `g.service_mode = 'DFY' and ${LIVE}`;
const BLANK_MODE = `g.service_mode is null and ${LIVE}`;

/** A Kuwait day checked before it goes into query text. */
function checked(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`calls: bad day ${d}`);
  return d;
}

/** Kuwait midnight of a day as a SQL timestamptz. */
const midnight = (d: string) => `timestamptz '${checked(d)} 00:00+03'`;

/** Epoch ms computed in SQL, or null. */
const epoch = (x: unknown): number | null =>
  x === null || x === undefined || x === "" ? null : num(x) || null;

const round = (x: number, places: number) => {
  const f = 10 ** places;
  return Math.round(x * f) / f;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Creative Triage drops connections under load ("Connection terminated due
 * to connection timeout"), so retry those a couple of times. Any other error
 * (a bad query, a statement timeout) is thrown at once, and so is a failure
 * that took long: every section refreshes inside one action with a time limit.
 */
async function triage(query: string): Promise<Row[]> {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      return await sql(TRIAGE, query);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (
        attempt >= 2 ||
        !/connection/i.test(msg) ||
        Date.now() - started > 30_000
      )
        throw e;
      await sleep(2000 + attempt * 3000);
    }
  }
}

/**
 * Per Kuwait day and agent for the last 30 days, split by hour for today only
 * (so the reply stays small), plus the store's last import and capture. The
 * calls hang off the imports row, so the freshness survives a month with no
 * calls.
 */
function coreQuery(from: string, today: string): string {
  return `with c as (
  select (f.data->>'timestamp')::timestamptz as ts,
    f.data->>'type' as typ,
    f.data->>'state' as st,
    (f.data->>'duration')::numeric as dur,
    f.data->'agents'->0->>'name' as agent,
    f.captured_at
  from mahara_reporting.facts f
  where f.namespace = 'production' and f.source = 'maqsam' and f.kind = 'call'
    and not f.conflict
    and jsonb_array_length(f.data->'agents') = 1
    and (f.data->>'timestamp')::timestamptz >= ${midnight(from)}
), agg as (
  select (ts at time zone 'Asia/Kuwait')::date::text as day,
    case when (ts at time zone 'Asia/Kuwait')::date = date '${checked(today)}'
      then extract(hour from ts at time zone 'Asia/Kuwait')::int end as hour,
    agent,
    count(*) filter (where typ = 'outbound') as dials,
    count(*) filter (where typ = 'outbound' and st = 'completed' and dur > 0) as connected,
    coalesce(sum(dur) filter (where typ = 'outbound' and st = 'completed' and dur > 0), 0) as talk_s,
    count(*) filter (where typ = 'outbound' and st = 'completed' and dur >= 90) as over90,
    count(*) filter (where typ = 'inbound') as inbound,
    count(*) filter (where typ = 'inbound' and st = 'abandoned') as missed,
    (extract(epoch from max(ts) filter (where typ = 'outbound' or st = 'serviced')) * 1000)::bigint as handled_ms,
    (extract(epoch from max(ts)) * 1000)::bigint as newest_ms,
    (extract(epoch from max(captured_at)) * 1000)::bigint as captured_ms
  from c group by 1, 2, 3
)
select s.store_ms, s.scopes, a.*
from (
  select (extract(epoch from max(captured_at)) * 1000)::bigint as store_ms,
    count(distinct scope) as scopes
  from mahara_reporting.imports
  where namespace = 'production' and source = 'maqsam'
    and captured_at > now() - interval '2 days'
) s
left join agg a on true`;
}

/**
 * Lead-linked numbers in one statement, so the slow facts scan runs once.
 * - Per client: each single-agent dial in the window goes to the newest
 *   client lead with that phone created before the call (a phone can sit
 *   under two clients).
 * - Speed to lead: for leads of DFY clients created in the window, the first
 *   outbound call to the same phone at or after creation (1 minute of clock
 *   skew allowed). The dialer console's own speed metric is empty (2
 *   attempts), so this replaces it. Two clocks over the same leads: the
 *   plain clock, and the working clock (Aziz, 2026-09-21, item 10), whose
 *   minutes are counted by workingMinutesSql in the `clocked` CTE: the
 *   clock starts at the later of the lead's creation and the next working
 *   window in `hours`, and only working minutes count.
 * Both sides are materialized so each join is one hash join: row-by-row
 * lookups and parallel scans hang on this instance. The per-client rows hang
 * off the single speed row, so the speed numbers survive a window with no
 * dials.
 */
function leadQuery(from: string, hours: WorkingHours): string {
  return `with c as materialized (
  select f.external_id as id,
    (f.data->>'timestamp')::timestamptz as ts,
    f.data->>'state' as st,
    (f.data->>'duration')::numeric as dur,
    jsonb_array_length(f.data->'agents') = 1 as single,
    nullif(regexp_replace(coalesce(f.data->>'phone', ''), '\\D', '', 'g'), '') as pkey
  from mahara_reporting.facts f
  where f.namespace = 'production' and f.source = 'maqsam' and f.kind = 'call'
    and not f.conflict
    and f.data->>'type' = 'outbound'
    and (f.data->>'timestamp')::timestamptz >= ${midnight(from)} - interval '1 minute'
), l as materialized (
  select l.ghl_contact_id as lead_id, l.created_at,
    regexp_replace(l.contact_phone, '\\D', '', 'g') as pkey,
    g.client_name, g.clickup_id,
    (${SPEED_SCOPE}) as in_scope,
    (${BLANK_MODE}) as blank_mode
  from public.ghl_clients g
  join public.client_leads l on l.location_id = g.location_id
  where l.contact_phone is not null and not coalesce(l.deleted, false)
), dials as (
  select distinct on (c.id) c.st, c.dur, c.pkey, l.client_name, l.clickup_id
  from c
  left join l on l.pkey = c.pkey and l.created_at <= c.ts + interval '1 minute'
  where c.single and c.ts >= ${midnight(from)}
  order by c.id, l.created_at desc nulls last
), per_client as (
  select client_name as client, clickup_id,
    count(*) as dials,
    count(*) filter (where st = 'completed' and dur > 0) as connected,
    count(distinct pkey) as leads_called,
    count(*) filter (where pkey is null) as no_phone
  from dials group by 1, 2
), first_calls as (
  select l.lead_id, l.created_at, min(c.ts) as first_call
  from l
  left join c on c.pkey = l.pkey and c.ts >= l.created_at - interval '1 minute'
  where l.in_scope and l.created_at >= ${midnight(from)}
  group by 1, 2
), clocked as (
  select f.*,
    ${workingMinutesSql("f.created_at", "f.first_call", hours)} as working_min
  from first_calls f
), speed as (
  select count(*) as leads,
    count(first_call) as called,
    percentile_cont(0.5) within group (
      order by greatest(0, extract(epoch from first_call - created_at)) / 60
    ) filter (where first_call is not null) as median_min,
    count(*) filter (where first_call - created_at <= interval '5 minutes') as within5,
    percentile_cont(0.5) within group (order by working_min)
      filter (where first_call is not null) as working_median_min,
    count(*) filter (where first_call is not null and working_min <= 5) as working_within5,
    count(*) filter (where first_call is null and created_at < now() - interval '1 day') as uncalled_1d,
    (select (extract(epoch from max(last_synced_at)) * 1000)::bigint
      from public.lead_sync_state where last_status = 'success') as leads_synced_ms,
    (select count(*) from l
      where l.blank_mode and l.created_at >= ${midnight(from)}) as blank_leads,
    (select string_agg(distinct l.client_name, ', ' order by l.client_name) from l
      where l.blank_mode and l.created_at >= ${midnight(from)}) as blank_clients
  from clocked
)
select s.*, pc.*
from speed s
left join per_client pc on true
order by pc.dials desc nulls last`;
}

type Acc = {
  dials: number;
  connected: number;
  talkSec: number;
  over90: number;
};

const zero = (): Acc => ({ dials: 0, connected: 0, talkSec: 0, over90: 0 });

function add(acc: Acc, r: Row): void {
  acc.dials += num(r.dials);
  acc.connected += num(r.connected);
  acc.talkSec += num(r.talk_s);
  acc.over90 += num(r.over90);
}

function toWindow(a: Acc): CallWindow {
  return {
    dials: a.dials,
    connected: a.connected,
    connectRate: a.dials ? round(a.connected / a.dials, 4) : null,
    talkMinutes: round(a.talkSec / 60, 1),
    avgTalkSec: a.connected ? Math.round(a.talkSec / a.connected) : null,
    conversations90s: a.over90,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "45 minutes" or "14 hours" since an instant. */
function ago(at: number, now: number): string {
  const min = Math.max(0, Math.round((now - at) / 60_000));
  return min < 120
    ? plural(min, "minute")
    : plural(Math.round(min / 60), "hour");
}

/** Friday is the company's day off (Kuwait day). */
const isFriday = (day: string) =>
  new Date(`${day}T00:00:00Z`).getUTCDay() === 5;

/**
 * A short error for a note or source stamp: no API URL, and nothing that
 * could be a phone number or an email (a Postgres error can quote a value).
 */
const brief = (e: unknown) =>
  String(e instanceof Error ? e.message : e)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\s"'<>(),;]+@[^\s"'<>(),;]*/g, "[email]")
    .replace(/\+\d[\d\s-]{6,}\d|\b\d{8,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .slice(0, 160);

export const calls: Adapter = {
  key: "calls",
  label: "Call centre",
  compute: async () => {
    const now = Date.now();
    const today = kuwaitDay(now);
    const yesterday = addDays(today, -1);
    const from7 = addDays(today, -6);
    const from14 = addDays(today, -13);
    const from30 = addDays(today, -29);
    // Lead-linked numbers cannot reach back before calls carried the phone.
    const leadFrom = from7 < PHONE_SINCE ? PHONE_SINCE : from7;
    const notes: Note[] = [];

    // Core: if this fails there is nothing to show, so the store keeps the
    // last good payload.
    const core = await triage(coreQuery(from30, today));
    // The imports log can lag the calls it stored, so take the newer clock.
    const storeAt =
      Math.max(
        epoch(core[0]?.store_ms) ?? 0,
        ...core.map(r => epoch(r.captured_ms) ?? 0),
      ) || null;
    const scopes = num(core[0]?.scopes);
    const rows = core.filter(r => r.day);

    const byDay = new Map<string, Acc>();
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      dials: 0,
      connected: 0,
    }));
    const agents = new Map<
      string,
      {
        today: Acc;
        last7: Acc;
        dials30: number;
        inbound7: number;
        lastCallAt: number | null;
      }
    >();
    const windows = {
      today: zero(),
      yesterday: zero(),
      last7: zero(),
      prevLast7: zero(),
    };
    let inbound7 = 0;
    let missed7 = 0;
    let lastCallAt: number | null = null;

    for (const r of rows) {
      const day = String(r.day);
      const agent = String(r.agent ?? "Unknown");
      const newest = epoch(r.newest_ms);
      if (newest && (!lastCallAt || newest > lastCallAt)) lastCallAt = newest;

      if (!byDay.has(day)) byDay.set(day, zero());
      add(byDay.get(day) as Acc, r);
      if (day === today) add(windows.today, r);
      if (day === yesterday) add(windows.yesterday, r);
      if (day >= from7) add(windows.last7, r);
      else if (day >= from14) add(windows.prevLast7, r);

      if (day === today && r.hour !== null && r.hour !== undefined) {
        const h = hours[num(r.hour)];
        if (h) {
          h.dials += num(r.dials);
          h.connected += num(r.connected);
        }
      }

      let a = agents.get(agent);
      if (!a) {
        a = {
          today: zero(),
          last7: zero(),
          dials30: 0,
          inbound7: 0,
          lastCallAt: null,
        };
        agents.set(agent, a);
      }
      a.dials30 += num(r.dials);
      if (day === today) add(a.today, r);
      if (day >= from7) {
        add(a.last7, r);
        a.inbound7 += num(r.inbound);
        inbound7 += num(r.inbound);
        missed7 += num(r.missed);
      }
      const handled = epoch(r.handled_ms);
      if (handled && (!a.lastCallAt || handled > a.lastCallAt))
        a.lastCallAt = handled;
    }

    const daily = Array.from({ length: 30 }, (_, i) => {
      const date = addDays(from30, i);
      const acc = byDay.get(date) ?? zero();
      return {
        date,
        dials: acc.dials,
        connected: acc.connected,
        conversations90s: acc.over90,
      };
    });

    // Agents who dialed in the last 30 days, so one who stopped still shows.
    const byAgent = [...agents.entries()]
      .filter(([, a]) => a.dials30 > 0)
      .sort(
        ([n1, a1], [n2, a2]) =>
          a2.last7.dials - a1.last7.dials || n1.localeCompare(n2),
      )
      .map(([agent, a]) => ({
        agent,
        today: toWindow(a.today),
        last7: toWindow(a.last7),
        lastCallAt: a.lastCallAt,
      }));

    // Freshness of the dialer store: today reads 0 when imports stall. A gap
    // of over a day always counts; a short one only in working hours.
    const kuwaitHour = new Date(now + KUWAIT_OFFSET_MS).getUTCHours();
    const workingHours =
      !isFriday(today) && kuwaitHour >= 10 && kuwaitHour < 21;
    let storeBehind = false;
    if (!storeAt) {
      storeBehind = true;
      notes.push({
        level: "warn",
        text: "The dialer has not imported any calls in 2 days, so recent numbers are missing.",
      });
    } else if (
      now - storeAt > 24 * 3600_000 ||
      (now - storeAt > STORE_STALE_MS && workingHours)
    ) {
      storeBehind = true;
      notes.push({
        level: "warn",
        text: `The dialer last imported calls ${ago(storeAt, now)} ago, so today's numbers may be behind.`,
      });
    }
    notes.push({
      level: "info",
      text: `Only the ${scopes || "configured"} Maqsam accounts the dialer imports are counted. A new agent is missing until the dialer adds their account.`,
    });
    notes.push({
      level: "info",
      text: `Dials and connections count outbound calls with one agent. Connected can include voicemail. Inbound in the last 7 days: ${inbound7} calls, ${missed7} not answered.`,
    });
    for (const [agent, a] of agents)
      if (a.inbound7 >= 5 && a.inbound7 > a.last7.dials)
        notes.push({
          level: "info",
          text: `${agent}'s account mostly receives inbound calls (${a.inbound7} in 7 days against ${plural(a.last7.dials, "dial")}), so its row is not a dialing shift.`,
        });

    // Lead-linked numbers: secondary, so a failure leaves them empty.
    let leadsSyncedAt: number | null = null;
    let leadsOk = false;
    let perClient7d: CallsPayload["perClient7d"] = [];
    let speedToLead: CallsPayload["speedToLead"] = {
      medianMinutes7d: null,
      within5minShare7d: null,
      sample: 0,
      since: PHONE_SINCE,
      workingMedianMinutes7d: null,
      workingWithin5minShare7d: null,
    };
    let uncalled: number | null = null;
    let leadsError: string | undefined;
    // The working clock's hours: saved in cockpit_settings, or the default.
    // Never a throw; a problem becomes a note beside the number.
    const settings = await workingHoursForAdapters();
    const clockHours = settings.hours;
    try {
      const lead = await triage(leadQuery(leadFrom, clockHours));
      const s = lead[0];
      if (!s) throw new Error("no summary row");
      leadsOk = true;
      leadsSyncedAt = epoch(s.leads_synced_ms);

      const dialed = lead.filter(
        r => r.dials !== null && r.dials !== undefined,
      );
      perClient7d = dialed
        .filter(r => r.client)
        .map(r => {
          const dials = num(r.dials);
          const leads = num(r.leads_called);
          return {
            client: String(r.client),
            clickupTaskId: r.clickup_id ? String(r.clickup_id) : null,
            dials,
            connected: num(r.connected),
            leadsCalled: leads,
            callsPerLead: leads ? round(dials / leads, 2) : null,
          };
        });
      const unmatched = dialed.filter(r => !r.client);
      const lost = unmatched.reduce((sum, r) => sum + num(r.dials), 0);
      if (lost > 0) {
        const noPhone = unmatched.reduce((sum, r) => sum + num(r.no_phone), 0);
        notes.push({
          level: "warn",
          text: `Not in the client table: ${plural(lost, "dial")} since ${leadFrom} (${noPhone} without a lead phone, ${lost - noPhone} with no matching client lead).`,
        });
      }

      const called = num(s.called);
      uncalled = num(s.uncalled_1d);
      speedToLead = {
        medianMinutes7d:
          called && s.median_min !== null && s.median_min !== undefined
            ? round(num(s.median_min), 1)
            : null,
        within5minShare7d: called ? round(num(s.within5) / called, 4) : null,
        sample: called,
        since: PHONE_SINCE,
        workingMedianMinutes7d:
          called &&
          s.working_median_min !== null &&
          s.working_median_min !== undefined
            ? round(num(s.working_median_min), 1)
            : null,
        workingWithin5minShare7d: called
          ? round(num(s.working_within5) / called, 4)
          : null,
      };
      if (uncalled > 0)
        notes.push({
          level: "warn",
          text: `${uncalled} of ${num(s.leads)} leads from DFY clients since ${leadFrom} are more than a day old and have no call yet. They are left out of the speed to lead median and 5 minute share.`,
        });
      const blankLeads = num(s.blank_leads);
      if (blankLeads > 0)
        notes.push({
          level: "info",
          text: `${plural(blankLeads, "lead")} since ${leadFrom} from clients with a blank Service Mode are left out of speed to lead until the CSM fills it: ${String(s.blank_clients ?? "").slice(0, 300)}.`,
        });
    } catch (e) {
      leadsError = brief(e);
      notes.push({
        level: "warn",
        text: `Per-client call numbers and speed to lead could not be read from Creative Triage this run: ${leadsError}`,
      });
    }

    const leadsStale =
      leadsOk &&
      (leadsSyncedAt === null || now - leadsSyncedAt > LEADS_STALE_MS);
    if (leadsStale)
      notes.push({
        level: "warn",
        text:
          leadsSyncedAt === null
            ? "The GHL lead sync has no successful run on record, so per-client and speed to lead numbers may miss leads."
            : `The GHL lead sync last succeeded ${ago(leadsSyncedAt, now)} ago, so the newest leads are missing from per-client and speed to lead numbers.`,
      });
    notes.push({
      level: "info",
      text:
        `Per-client and speed to lead numbers start ${PHONE_SINCE}, the first day calls carry the lead phone` +
        (leadFrom > from7
          ? `, so they cover fewer than 7 days until ${addDays(PHONE_SINCE, 6)}.`
          : ".") +
        " Speed to lead counts leads of Active, Launching and Paused DFY clients; the median and the 5 minute share use called leads only.",
    });
    notes.push({
      level: "info",
      text: `Speed to lead on the working clock: the clock starts at the later of the lead's creation and the next working window, and only working minutes count, so a call before the clock starts is 0 minutes. Hours in force: ${describeWorkingHours(clockHours)} (${clockHours.source === "settings" ? "saved in the Working hours card" : "the default, nothing saved yet"}).`,
    });
    if (settings.problem)
      notes.push({
        level: "warn",
        text: `Speed to lead ran on the default working hours because the saved ones could not be read: ${settings.problem}`,
      });
    notes.push({
      level: "info",
      text: "B2B maqsam_client_calls is an old one-off import (history to 2026-07-18) and is not used for these live numbers.",
    });

    const payload = {
      today: toWindow(windows.today),
      yesterday: toWindow(windows.yesterday),
      last7: toWindow(windows.last7),
      prevLast7: toWindow(windows.prevLast7),
      daily,
      byAgent,
      byHourToday: hours,
      perClient7d,
      speedToLead,
      workingHours: clockHours,
      lastCallAt,
      notes,
    } satisfies CallsPayload;

    // Rolling lead-linked values the source keeps no history for.
    const points: DailyPoint[] = [];
    const keep = (metric: string, value: number | null) => {
      if (value !== null)
        points.push({
          date: today,
          metric: `calls.${metric}`,
          scope: "company",
          value,
        });
    };
    keep("speedToLeadMedianMin7d", speedToLead.medianMinutes7d);
    keep("speedToLeadWithin5minShare7d", speedToLead.within5minShare7d);
    keep(
      "speedToLeadWorkingMedianMin7d",
      speedToLead.workingMedianMinutes7d ?? null,
    );
    keep(
      "speedToLeadWorkingWithin5minShare7d",
      speedToLead.workingWithin5minShare7d ?? null,
    );
    keep("leadsUncalled1d", uncalled);

    const sources: SourceStamp[] = [
      {
        name: "Creative Triage dialer store (Maqsam calls)",
        freshestAt: storeAt ?? lastCallAt ?? undefined,
        ok: true,
        note: storeBehind ? "dialer imports are behind" : undefined,
      },
      {
        name: "Creative Triage GHL leads",
        freshestAt: leadsSyncedAt ?? undefined,
        ok: leadsOk,
        note: leadsError ?? (leadsStale ? "lead sync is behind" : undefined),
      },
    ];

    return { payload, daily: points, sources };
  },
};
