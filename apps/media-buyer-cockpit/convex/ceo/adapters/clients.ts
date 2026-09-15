import { internal } from "../../_generated/api";
import { CPL_GATE } from "../../constants";
import type { ClientRow, ClientsPayload, Note } from "../payloads";
import { B2B, num, type Row, sql, TRIAGE } from "../sb";
import { KUWAIT_OFFSET_MS, kuwaitDay } from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

type Any = any;

/**
 * Clients: the roster, each client's health signals and a transparent risk
 * score. The roster and campaign numbers are Convex tables the media buyer
 * sync keeps; Pulse inputs come from Creative Triage and portal visits from
 * the Mahara OS state document in B2B. Either outside read may fail on its
 * own: the rows then carry null for it and add no risk points from it.
 */

const DAY_MS = 86_400_000;

/** Cost per booking gate, the same number as src/lib/kpi.ts. */
const CPB_GATE = 80;

/**
 * Creative Triage hangs when degraded (a Pulse read took 30 s on 2026-09-15
 * and the original RPC hit its 2 minute limit), so a slow read is dropped for
 * this run rather than holding up the refresh.
 */
const PULSE_TIMEOUT_MS = 60_000;
const PORTAL_TIMEOUT_MS = 30_000;

/** The sync stores the roster every 10 minutes by day, hourly at night. */
const ROSTER_STALE_MS = 3 * 3600_000;

/** The GHL leads cron runs hourly; past 3 hours at least two runs failed. */
const LEADS_STALE_MS = 3 * 3600_000;

const UNHAPPY = /at risk|unhappy|angry|upset|danger|churn|\bred\b/i;
/**
 * DEFCON comes from the 1-1 call notes form and today carries the happiness
 * labels (Happy, Neutral, At Risk); the Client Success cockpit also treats
 * "red" and DEFCON 1 or 2 as danger.
 */
const HIGH_DEFCON =
  /at risk|unhappy|angry|upset|danger|\bred\b|defcon\s*[12]\b/i;

/** The error without the API url, and the database's message when it sent one. */
const errText = (e: unknown) => {
  const raw = String(e instanceof Error ? e.message : e);
  const message = /"message"\s*:\s*"([^"]+)"/.exec(raw)?.[1];
  return (message ?? raw.replace(/https?:\/\/\S+:?\s*/g, ""))
    .trim()
    .slice(0, 160);
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Same normalisation the sync uses for campaign client labels (sync.ts normalize). */
const tight = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

const firstName = (s: unknown): string | null =>
  String(s ?? "")
    .trim()
    .split(/\s+/)[0] || null;

/** Epoch ms of Kuwait midnight for a YYYY-MM-DD day, or null. */
const dayStart = (day: unknown): number | null =>
  typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? new Date(`${day}T00:00:00Z`).getTime() - KUWAIT_OFFSET_MS
    : null;

/** Epoch ms computed in SQL, or null. */
const epoch = (x: unknown): number | null =>
  x === null || x === undefined || x === "" ? null : num(x) || null;

/**
 * Active, onboarding, paused or churned, the same rule the Client Success
 * cockpit uses for its tabs: the sync's bucket first, the stage name as the
 * fallback.
 */
function bucketOf(bucket: string | null, stage: string): string {
  if (bucket === "onboarding") return "onboarding";
  if (bucket === "management") return "active";
  if (bucket === "inactive")
    return /pause|freeze|hold/i.test(stage) ? "paused" : "churned";
  if (/contact|booked|ready for launch|ghosted|delay|blueprint/i.test(stage))
    return "onboarding";
  if (/pause|freeze|hold/i.test(stage)) return "paused";
  if (/stop|cancel|churn|offboard|lost/i.test(stage)) return "churned";
  return "active";
}

/**
 * One read with a time limit. Dropped connections ("Connection terminated
 * due to connection timeout") are retried while time is left; any other
 * error is thrown at once.
 */
async function read(
  project: string,
  query: string,
  timeoutMs: number,
): Promise<Row[]> {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    const left = deadline - Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`timed out after ${Math.round(timeoutMs / 1000)} s`),
          ),
        Math.max(left, 0),
      );
    });
    try {
      return await Promise.race([sql(project, query), timeout]);
    } catch (e) {
      const msg = errText(e);
      const timeLeft = deadline - Date.now();
      if (attempt >= 2 || !/connection/i.test(msg) || timeLeft < 10_000)
        throw e;
      await sleep(2000 + attempt * 3000);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Pulse health inputs per roster location, the same counting rules as
 * public.pulse_client_health(), keyed by the ClickUp card id. The RPC itself
 * aggregates whole views and times out on this instance, so this reads each
 * location through its indexes instead (lateral lookups, offset 0 to keep
 * the planner from parallel scans, which hang here). Bookings count on the
 * booking day, attendance on the meeting day up to today, unknown attendance
 * is never a no-show, spend is USD at the Pulse rates. Counts only.
 */
const PULSE_SQL = `with w as (
  select d,
    (d - 27)::timestamp at time zone 'Asia/Kuwait' as c28,
    (d - 55)::timestamp at time zone 'Asia/Kuwait' as p28,
    (d - 89)::timestamp at time zone 'Asia/Kuwait' as b90,
    (d + 1)::timestamp at time zone 'Asia/Kuwait' as tmr
  from (select (now() at time zone 'Asia/Kuwait')::date as d) x
)
select g.clickup_id,
  coalesce(ap.appts_28d, 0) as appts_28d,
  coalesce(ap.appts_90d, 0) as appts_90d,
  w.d - (ap.last_booked_at at time zone 'Asia/Kuwait')::date as days_since_booking,
  coalesce(ap.attended_28d, 0) as attended_28d,
  coalesce(ap.noshow_28d, 0) as noshow_28d,
  coalesce(le.leads_28d, 0) as leads_28d,
  coalesce(le.leads_prev28d, 0) as leads_prev28d,
  round(sp.spend_28d, 2) as spend_28d,
  round(sp.spend_90d, 2) as spend_90d,
  coalesce(op.open_opps, 0) as open_opps,
  coalesce(op.stalled_opps, 0) as stalled_opps,
  (select (extract(epoch from max(last_synced_at)) * 1000)::bigint
    from public.lead_sync_state where last_status = 'success') as leads_synced_ms
from public.ghl_clients g cross join w
left join lateral (
  select count(*) filter (where q.booked_at >= w.c28) as appts_28d,
    count(*) filter (where q.booked_at >= w.b90) as appts_90d,
    max(q.booked_at) filter (where q.booked_at >= w.b90) as last_booked_at,
    count(*) filter (where q.start_at >= w.c28 and q.start_at < w.tmr and q.o = 1) as attended_28d,
    count(*) filter (where q.start_at >= w.c28 and q.start_at < w.tmr and q.o = 0) as noshow_28d
  from (
    select a.booked_at, a.start_at,
      case when a.status = 'showed' then 1 when a.status = 'noshow' then 0
        when a.attended is true then 1 when a.attended is false then 0 end as o
    from public.appointments a
    where a.ghl_location_id = g.location_id and (a.booked_at >= w.b90 or a.start_at >= w.c28)
      and a.status is distinct from 'cancelled' and a.status is distinct from 'invalid'
    offset 0
  ) q
) ap on true
left join lateral (
  select count(*) filter (where q.created_at >= w.c28) as leads_28d,
    count(*) filter (where q.created_at < w.c28) as leads_prev28d
  from (
    select l.created_at from public.client_leads l
    where l.location_id = g.location_id and l.created_at >= w.p28 and l.deleted is not true
    offset 0
  ) q
) le on true
left join lateral (
  select sum(s.spend / case c.currency when 'SAR' then 3.75 when 'AED' then 3.6725 when 'QAR' then 3.64 else 1 end) filter (where s.date >= w.d - 27) as spend_28d,
    sum(s.spend / case c.currency when 'SAR' then 3.75 when 'AED' then 3.6725 when 'QAR' then 3.64 else 1 end) as spend_90d
  from public.ghl_client_ad_accounts m
  join public.clients c on c.id = m.client_id
  join lateral (
    select s.spend, s.date from public.ads_daily_snapshots s
    where s.client_id = m.client_id and s.date between w.d - 89 and w.d
    offset 0
  ) s on true
  where m.location_id = g.location_id
) sp on true
left join lateral (
  select count(*) filter (where o.status = 'open') as open_opps,
    count(*) filter (where o.status = 'open' and o.last_stage_change_at < (w.d - 21)) as stalled_opps
  from public.client_opportunities o where o.location_id = g.location_id
) op on true
where g.status in ('Active', 'Launching', 'Paused') and coalesce(g.clickup_id, '') <> ''
limit 200`;

/**
 * Pulse stores no score: its 0 to 100 rubric lives in the Pulse screen. This
 * is the cockpit's copy with the plan's weights: bookings 35, leads 20,
 * attendance 15, cost per booking 15, pipeline movement 15. Where a block
 * cannot be judged (no attendance marked, no ad link, no open deals) it gets
 * half its weight. A location with no leads, bookings or spend in 90 days is
 * not live, so it has no score.
 */
function pulseOf(r: Row): { score: number | null; status: string } {
  const appts28 = num(r.appts_28d);
  const leads28 = num(r.leads_28d);
  const spend28 = num(r.spend_28d);
  // Leads that stopped this month are a bad sign, not an idle location.
  if (
    leads28 === 0 &&
    num(r.leads_prev28d) === 0 &&
    num(r.appts_90d) === 0 &&
    num(r.spend_90d) === 0
  )
    return { score: null, status: "no-data" };
  const sinceBooking =
    r.days_since_booking == null ? null : num(r.days_since_booking);
  // Pulse calls spending with no booking in 21 days urgent.
  const bookings =
    appts28 === 0 || sinceBooking === null || sinceBooking > 21
      ? 0
      : 35 * Math.min(1, appts28 / 10);
  const leads =
    leads28 === 0
      ? 0
      : 20 * Math.min(1, leads28 / Math.max(1, num(r.leads_prev28d)));
  const known = num(r.attended_28d) + num(r.noshow_28d);
  const attendance = known === 0 ? 7.5 : (15 * num(r.attended_28d)) / known;
  const cost =
    spend28 <= 0
      ? 7.5
      : appts28 === 0
        ? 0
        : 15 * Math.min(1, CPB_GATE / (spend28 / appts28));
  const open = num(r.open_opps);
  const pipeline =
    open === 0 ? 7.5 : 15 * (1 - Math.min(open, num(r.stalled_opps)) / open);
  const score = Math.round(bookings + leads + attendance + cost + pipeline);
  return {
    score,
    status: score >= 75 ? "good" : score < 30 ? "bad" : "watch",
  };
}

/**
 * Portal access and last visit per ClickUp card, from the Mahara OS state
 * document. The document also holds session tokens, emails and credentials,
 * so only the client id, whether anyone has access and the newest session
 * time leave the database. Sessions are deleted when they expire, so there is
 * no visit history, only the newest live or unexpired session.
 */
const PORTAL_SQL = `with docs as (
  select key, body, updated_at from public.mahara_portal_documents
  where key in ('__state__', 'directory.json', 'client-access.json')
),
st as (select body, updated_at from docs where key = '__state__'),
dir as (
  select e->>'id' as client_id, e->>'clickupId' as clickup_id
  from docs, jsonb_array_elements(case when jsonb_typeof(docs.body) = 'array' then docs.body else '[]'::jsonb end) e
  where docs.key = 'directory.json' and coalesce(e->>'id', '') <> '' and coalesce(e->>'clickupId', '') <> ''
),
access as (
  select p.key as client_id
  from docs, jsonb_each(case when jsonb_typeof(docs.body->'profiles') = 'object' then docs.body->'profiles' else '{}'::jsonb end) p
  where docs.key = 'client-access.json'
    and jsonb_typeof(p.value->'principals') = 'array'
    and jsonb_array_length(p.value->'principals') > 0
),
seen as (
  select s.value->>'clientId' as client_id,
    max(greatest(
      case when jsonb_typeof(s.value->'authenticatedAt') = 'number' then (s.value->>'authenticatedAt')::numeric end,
      case when jsonb_typeof(s.value->'renewedAt') = 'number' then (s.value->>'renewedAt')::numeric end,
      case when jsonb_typeof(s.value->'created') = 'number' then (s.value->>'created')::numeric end
    ))::bigint as last_seen_ms
  from st, jsonb_each(case when jsonb_typeof(st.body->'sessions') = 'object' then st.body->'sessions' else '{}'::jsonb end) s
  where s.value->>'role' = 'client' and coalesce(s.value->>'clientId', '') <> ''
  group by 1
)
select dir.clickup_id,
  bool_or(access.client_id is not null) as has_access,
  max(seen.last_seen_ms) as last_seen_ms,
  (select (extract(epoch from max(updated_at)) * 1000)::bigint from st) as state_ms
from dir
left join access on access.client_id = dir.client_id
left join seen on seen.client_id = dir.client_id
group by dir.clickup_id
limit 500`;

type Signals = {
  bucket: string;
  happiness: string | null;
  defcon: string | null;
  silentDays: number | null;
  overdueDays: number | null;
  /** False when the campaigns table came back empty, so a missing campaign proves nothing. */
  boardKnown: boolean;
  leads7d: number | null;
  cpl7d: number | null;
  pulse: { score: number | null; status: string | null } | null;
  portal: { hasAccess: boolean; lastSeenAt: number | null } | null;
};

/** Transparent risk points; every point comes with its reason. */
function riskOf(s: Signals, now: number): ClientRow["risk"] {
  // A churned client is already lost; its old signals are not a risk.
  if (s.bucket === "churned") return { score: 0, level: "low", reasons: [] };
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };
  if (s.happiness && UNHAPPY.test(s.happiness))
    add(3, `happiness ${s.happiness}`);
  if (s.silentDays !== null && s.silentDays > 14)
    add(2, `silent ${s.silentDays} days`);
  else if (s.silentDays !== null && s.silentDays >= 8)
    add(1, `silent ${s.silentDays} days`);
  if (s.overdueDays !== null && s.overdueDays > 0)
    add(
      2,
      `payment ${s.overdueDays} ${s.overdueDays === 1 ? "day" : "days"} overdue`,
    );
  if (s.bucket === "active" && s.leads7d === null && s.boardKnown)
    add(2, "no campaign on the ads board");
  else if (s.bucket === "active" && s.leads7d === 0)
    add(2, "no leads in 7 days");
  if (s.cpl7d !== null && s.cpl7d > 1.5 * CPL_GATE)
    add(1, `CPL $${Math.round(s.cpl7d)} in 7 days`);
  if (s.pulse?.status === "bad")
    add(2, `Pulse health ${s.pulse.score ?? "low"} of 100`);
  if (s.portal?.hasAccess) {
    if (s.portal.lastSeenAt === null) add(1, "no portal visit on record");
    else if (now - s.portal.lastSeenAt >= 14 * DAY_MS)
      add(
        1,
        `not seen in the portal for ${Math.floor((now - s.portal.lastSeenAt) / DAY_MS)} days`,
      );
  }
  if (s.defcon && HIGH_DEFCON.test(s.defcon)) add(2, `DEFCON ${s.defcon}`);
  return {
    score,
    level: score >= 5 ? "high" : score >= 3 ? "medium" : "low",
    reasons,
  };
}

const BUCKET_ORDER = ["active", "onboarding", "paused", "churned"];

export const clients: Adapter = {
  key: "clients",
  label: "Clients",
  compute: async ctx => {
    const now = Date.now();
    const today = kuwaitDay(now);
    const notes: Note[] = [];
    const sources: SourceStamp[] = [];

    const data: Any = await ctx.runQuery(internal.ceo.data.clients.load, {});
    const roster: Any[] = data?.clients ?? [];
    if (!roster.length)
      throw new Error("clients: the Convex client roster is empty");
    const rosterAt = Math.max(...roster.map(c => num(c.syncedAt)));
    sources.push({
      name: "Client roster (ClickUp via the media buyer sync)",
      freshestAt: rosterAt,
      ok: true,
    });
    if (now - rosterAt > ROSTER_STALE_MS)
      notes.push({
        level: "warn",
        text: `The client roster was last stored ${Math.round((now - rosterAt) / 3600_000)} hours ago, so stages, silence and payments may be out of date.`,
      });

    // Campaigns to client cards: the card name first, then the ClickUp
    // client list's names and aliases.
    const rosterIds = new Set(roster.map(c => c.taskId as string));
    const cardByKey = new Map<string, string>();
    for (const c of roster) cardByKey.set(tight(c.name), c.taskId);
    for (const l of data.links ?? [])
      for (const k of [l.name, ...(l.aliases ?? [])]) {
        const key = tight(k);
        if (key && !cardByKey.has(key)) cardByKey.set(key, l.taskId);
      }
    const perf = new Map<
      string,
      { spend: number; leads: number; bookings: number | null }
    >();
    const board: Any[] = data.campaigns ?? [];
    const boardKnown = board.length > 0;
    sources.push({
      name: "Ads board campaigns (media buyer sync)",
      freshestAt: boardKnown
        ? Math.max(...board.map(k => num(k.syncedAt)))
        : undefined,
      ok: boardKnown,
      note: boardKnown ? undefined : "no on-board campaigns stored",
    });
    if (!boardKnown)
      notes.push({
        level: "warn",
        text: "No on-board campaigns are stored right now, so leads, CPL and bookings are blank and add no risk points.",
      });
    let unmatched = 0;
    let unmatchedSpend = 0;
    for (const k of board) {
      const taskId = [k.clientTag, ...(k.tags ?? []), k.clientName]
        .map(tight)
        .filter(Boolean)
        .map(key => cardByKey.get(key))
        .find(id => id && rosterIds.has(id));
      if (!taskId) {
        unmatched += 1;
        unmatchedSpend += num(k.spend7d);
        continue;
      }
      const p = perf.get(taskId) ?? { spend: 0, leads: 0, bookings: null };
      p.spend += num(k.spend7d);
      p.leads += num(k.leads7d);
      // bookings7d is the client's whole GHL count, repeated on each of its
      // campaigns, so a client with two campaigns must not count it twice.
      if (k.bookings7d !== null)
        p.bookings = Math.max(p.bookings ?? 0, num(k.bookings7d));
      perf.set(taskId, p);
    }
    if (unmatched)
      notes.push({
        level: "warn",
        text: `${unmatched} on-board ${unmatched === 1 ? "campaign" : "campaigns"} ($${Math.round(unmatchedSpend)} spend in 7 days) matched no client card, so those leads are missing from the rows.`,
      });

    // Pulse health from Creative Triage.
    let pulse: Map<string, { score: number | null; status: string }> | null =
      null;
    try {
      const rows = await read(TRIAGE, PULSE_SQL, PULSE_TIMEOUT_MS);
      if (!rows.length) throw new Error("the Pulse roster came back empty");
      pulse = new Map(rows.map(r => [String(r.clickup_id), pulseOf(r)]));
      const leadsAt = epoch(rows[0].leads_synced_ms);
      sources.push({
        name: "Creative Triage Pulse inputs",
        freshestAt: leadsAt ?? undefined,
        ok: true,
      });
      if (leadsAt && now - leadsAt > LEADS_STALE_MS)
        notes.push({
          level: "warn",
          text: `Creative Triage last synced GHL leads ${Math.round((now - leadsAt) / 3600_000)} hours ago, so Pulse health is based on old leads and bookings.`,
        });
      notes.push({
        level: "info",
        text: "Pulse health is scored by the cockpit with the Pulse weights (bookings 35, leads 20, attendance 15, cost per booking 15, pipeline movement 15): 75 or more is good, under 30 is bad. Pulse stores no score, so how each block is scored is the cockpit's own rule until it is checked against the Pulse screen. Attendance is only known where the client fills the stat sheet, and open deals include the Lost Leads pipelines.",
      });
    } catch (e) {
      sources.push({
        name: "Creative Triage Pulse inputs",
        ok: false,
        note: errText(e),
      });
      notes.push({
        level: "warn",
        text: `Pulse health could not be read this run (${errText(e)}), so it is blank and adds no risk points.`,
      });
    }

    // Portal visits from Mahara OS.
    let portal: Map<
      string,
      { hasAccess: boolean; lastSeenAt: number | null }
    > | null = null;
    try {
      const rows = await read(B2B, PORTAL_SQL, PORTAL_TIMEOUT_MS);
      if (!rows.length) throw new Error("the portal directory came back empty");
      portal = new Map(
        rows.map(r => [
          String(r.clickup_id),
          {
            hasAccess: r.has_access === true || r.has_access === "true",
            lastSeenAt: epoch(r.last_seen_ms),
          },
        ]),
      );
      sources.push({
        name: "Mahara OS portal state",
        freshestAt: epoch(rows[0].state_ms) ?? undefined,
        ok: true,
      });
      notes.push({
        level: "info",
        text: "Portal last seen comes from sessions that have not expired. The portal deletes a session when it expires (30 to 90 days), so a blank means no visit in that time, not never.",
      });
    } catch (e) {
      sources.push({
        name: "Mahara OS portal state",
        ok: false,
        note: errText(e),
      });
      notes.push({
        level: "warn",
        text: `Portal visits could not be read this run (${errText(e)}), so last seen is blank and adds no risk points.`,
      });
    }

    const latest: Record<string, { at: number; summary: string }> =
      data.latestUpdate ?? {};
    const rows: ClientRow[] = roster.map(c => {
      const bucket = bucketOf(c.bucket, String(c.stage ?? ""));
      const p = perf.get(c.taskId);
      const leads7d = p ? p.leads : null;
      const cpl7d = p && p.leads > 0 ? round2(p.spend / p.leads) : null;
      const pl = pulse?.get(c.taskId) ?? null;
      const po = portal?.get(c.taskId) ?? null;
      const silentDays = c.silentDays === null ? null : num(c.silentDays);
      // The sync sets paymentDue (days past Next Payment Date) only for live
      // stages; an extension on the card moves the date.
      const extended =
        typeof c.extendedUntil === "string" && c.extendedUntil >= today;
      const overdueDays =
        c.paymentDue === null || extended ? null : num(c.paymentDue);
      const contacts = [dayStart(c.lastPoc), dayStart(c.lastCall)].filter(
        (x): x is number => x !== null,
      );
      return {
        name: c.name,
        clickupTaskId: c.taskId,
        stage: c.stage || null,
        bucket,
        csm: firstName(c.csm),
        service: c.service,
        happiness: c.happiness,
        silentDays,
        lastContactAt: contacts.length ? Math.max(...contacts) : null,
        paymentDue: c.paymentDate,
        leads7d,
        cpl7d,
        bookings7d: p ? p.bookings : null,
        pulse: pl,
        portalLastSeenAt: po?.lastSeenAt ?? null,
        risk: riskOf(
          {
            bucket,
            happiness: c.happiness,
            defcon: c.defcon,
            silentDays,
            overdueDays,
            boardKnown,
            leads7d,
            cpl7d,
            pulse: pl,
            portal: po,
          },
          now,
        ),
        latestUpdate: latest[c.taskId]?.summary ?? null,
      };
    });

    rows.sort(
      (a, b) =>
        BUCKET_ORDER.indexOf(a.bucket ?? "") -
          BUCKET_ORDER.indexOf(b.bucket ?? "") ||
        b.risk.score - a.risk.score ||
        a.name.localeCompare(b.name),
    );

    const counts = { active: 0, onboarding: 0, paused: 0, churned: 0 };
    for (const r of rows)
      if (r.bucket && r.bucket in counts)
        counts[r.bucket as keyof typeof counts] += 1;

    const live = rows.filter(
      r => r.bucket === "active" || r.bucket === "onboarding",
    );
    // High and medium only: one weak point (say no portal visit) is not "at risk".
    const atRisk = live
      .filter(r => r.risk.level !== "low")
      .sort(
        (a, b) =>
          b.risk.score - a.risk.score ||
          (b.silentDays ?? -1) - (a.silentDays ?? -1) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 8);

    const noPoc = live.filter(r => r.silentDays === null).length;
    if (noPoc)
      notes.push({
        level: "info",
        text: `${noPoc} active or onboarding ${noPoc === 1 ? "client has" : "clients have"} no Last POC date on the card, so silence cannot be judged for ${noPoc === 1 ? "it" : "them"}.`,
      });
    notes.push({
      level: "info",
      text: `Risk points: unhappy 3, silent over 14 days 2 (8 to 14 days 1), payment overdue with no extension 2, active with no campaign on the ads board or no leads in 7 days 2, CPL over 1.5x the $${CPL_GATE} gate 1, Pulse bad 2, portal access but no visit in 14 days 1, DEFCON at risk on the latest call notes 2. High is 5 or more, medium 3 to 4; churned clients score 0. Leads, CPL and bookings are the last 7 days of on-board campaigns.`,
    });

    const payload = {
      counts: { ...counts, total: rows.length },
      atRisk,
      rows,
      notes,
    } satisfies ClientsPayload;

    // The roster keeps no history of its own, so today's counts are kept here.
    const point = (metric: string, value: number): DailyPoint => ({
      date: today,
      metric,
      scope: "company",
      value,
    });
    const daily: DailyPoint[] = [
      point("clients.active", counts.active),
      point("clients.onboarding", counts.onboarding),
      point("clients.paused", counts.paused),
      point("clients.churned", counts.churned),
      point(
        "clients.highRisk",
        live.filter(r => r.risk.level === "high").length,
      ),
    ];

    return { payload, daily, sources };
  },
};
