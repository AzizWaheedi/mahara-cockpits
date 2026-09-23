import { internal } from "../../_generated/api";
import { CPB_GATE, CPL_GATE } from "../../constants";
import type { BillingRow } from "../billing";
import { BUCKET_CHURNED, BUCKET_METRIC, LAUNCH_METRIC } from "../data/clients";
import { tapKeyState } from "../data/tap";
import {
  averageRetainer,
  type Card,
  createdDayOf,
  daysToLaunchOf,
  EXT_PAGE,
  EXTENSION_FIELD_NAME,
  type ExtensionsWithLastMonth,
  FIELD_ASK,
  findExtensionField,
  readExtensionForm,
  summariseExtensions,
  summariseLaunch,
} from "../extensions";
import { CEO_EMAILS } from "../gate";
import { nameKey } from "../manualMatch";
import type {
  ChurnClient,
  ChurnPayload,
  ClientRow,
  ClientsPayload,
  Note,
  RenewalEvidence,
  TermClient,
} from "../payloads";
import { B2B, num, type Row, sql, TRIAGE } from "../sb";
import { addDays, KUWAIT_OFFSET_MS, kuwaitDay, monthStart } from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";
import { MANUAL_RAIL_LABEL, type ManualRail } from "../writeGuard";

type Any = any;

/**
 * Clients: the roster, each client's health signals and a transparent risk
 * score. The roster and campaign numbers are Convex tables the media buyer
 * sync keeps; Pulse inputs come from Creative Triage and portal visits from
 * the Mahara OS state document in B2B. Either outside read may fail on its
 * own: the rows then carry null for it and add no risk points from it.
 */

const DAY_MS = 86_400_000;

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

// --- Churn and the 90 day term (decisions of 2026-09-16) ---
//
// Decision 1: logo churn counts launched clients only (the card has a Launch
// Date); a client lost before launch is listed apart. Decision 4 with the
// renewal rule: a launched client whose term (Launch Date plus 90 days) has
// ended is churned on the term end unless a payment on any rail is dated
// after it. Paused is not churn (decision 3 is still open).

/** Decision 4: the term runs 90 days from the card's Launch Date. */
const TERM_DAYS = 90;
/** A term end this many days away or fewer is "renewal due soon". */
const RENEWAL_SOON_DAYS = 15;
const WHOP_TIMEOUT_MS = 30_000;

/** The BUCKET_METRIC values, the order TABS.md fixes: 0 active to 3 churned. */
const BUCKET_VALUE: Record<string, number> = {
  active: 0,
  onboarding: 1,
  paused: 2,
  churned: BUCKET_CHURNED,
};
const BUCKET_NAME = ["active", "onboarding", "paused", "churned"];

/** Cards on the client list that are not clients (the 2026-09-14 lifecycle test card). */
const INTERNAL_CARD = /\binternal test\b/i;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const epochDay = (day: string) =>
  Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const fromEpochDay = (n: number) =>
  new Date(n * DAY_MS).toISOString().slice(0, 10);
/** Whole days from `from` to `to`. */
const daysBetween = (from: string, to: string) => epochDay(to) - epochDay(from);

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const monthName = (ym: string) =>
  `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;
/** "14 Sep" for a note. */
const shortDay = (day: string) =>
  `${Number(day.slice(8, 10))} ${(MONTH_NAMES[Number(day.slice(5, 7)) - 1] ?? "").slice(0, 3)}`;

const dollars = (x: number) =>
  `$${String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
const share = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "n/a";
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
/** "A, B and 3 more" for a note. */
function nameList(names: string[], max = 5): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length < 2) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Paid Whop payments tied to a client card. Whop carries no ClickUp id, so a
 * payment is tied when its payer email is a login on exactly one card in the
 * Mahara OS portal (client-access.json principals, joined to the card through
 * directory.json). Emails never leave the database: only the card id, the
 * Kuwait paid day and the net amount do, plus the counts that say how much of
 * Whop this ties. Fully refunded rows (net 0) are never renewal evidence, and
 * Mahara's own test payments are left out.
 */
const WHOP_BY_CARD_SQL = `with docs as (
  select key, body from public.mahara_portal_documents
  where key in ('directory.json', 'client-access.json')
),
dir as (
  select e->>'id' as client_id, e->>'clickupId' as clickup_id
  from docs, jsonb_array_elements(case when jsonb_typeof(docs.body) = 'array' then docs.body else '[]'::jsonb end) e
  where docs.key = 'directory.json' and coalesce(e->>'id', '') <> '' and coalesce(e->>'clickupId', '') <> ''
),
logins as (
  select lower(btrim(pr->>'email')) as email, dir.clickup_id
  from docs
  cross join lateral jsonb_each(case when jsonb_typeof(docs.body->'profiles') = 'object' then docs.body->'profiles' else '{}'::jsonb end) p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p.value->'principals') = 'array' then p.value->'principals' else '[]'::jsonb end) pr
  join dir on dir.client_id = p.key
  where docs.key = 'client-access.json' and jsonb_typeof(pr) = 'object' and coalesce(btrim(pr->>'email'), '') <> ''
),
tied as (
  select email, min(clickup_id) as clickup_id
  from logins group by email having count(distinct clickup_id) = 1
),
paid as (
  select nullif(lower(btrim(coalesce(user_email, ''))), '') as email, paid_on, net_amount
  from public.whop_payments
  where status = 'paid' and currency = 'usd' and net_amount > 0 and paid_on is not null
    and lower(btrim(coalesce(user_email, ''))) not like '%@maharamedia.com'
    and lower(btrim(coalesce(user_email, ''))) not in (${CEO_EMAILS.map(sqlText).join(", ")})
),
hit as (
  select t.clickup_id, p.paid_on, p.net_amount from paid p join tied t on t.email = p.email
)
select 'pay' as kind, clickup_id as card, to_char(paid_on, 'YYYY-MM-DD') as day, net_amount as usd,
  null::numeric as n1, null::numeric as n2, null::numeric as n3, null::numeric as n4, null::numeric as n5
from hit
union all
select 'card', clickup_id, null, null, null, null, null, null, null from (select distinct clickup_id from tied) c
union all
select 'sum', null, null, null,
  (select count(*) from paid), (select count(*) from hit),
  (select coalesce(sum(net_amount), 0) from paid), (select coalesce(sum(net_amount), 0) from hit),
  (select count(*) from (select email from logins group by email having count(distinct clickup_id) > 1) x)
union all
select 'payers', null, null, null,
  (select count(distinct email) from paid), (select count(distinct p.email) from paid p join tied t on t.email = p.email),
  (select floor(extract(epoch from max(synced_at)) * 1000) from public.whop_payments),
  null, null`;

type WhopTies = {
  byCard: Map<string, { day: string; usd: number }[]>;
  cardsWithLogin: Set<string>;
  rows: number;
  tiedRows: number;
  net: number;
  tiedNet: number;
  ambiguousLogins: number;
  payers: number;
  tiedPayers: number;
  syncedAt: number | null;
};

async function readWhopTies(): Promise<WhopTies> {
  const rows = await read(B2B, WHOP_BY_CARD_SQL, WHOP_TIMEOUT_MS);
  const sum = rows.find(r => r.kind === "sum");
  const payers = rows.find(r => r.kind === "payers");
  if (!sum || !payers)
    throw new Error("the Whop match came back without its totals");
  const byCard = new Map<string, { day: string; usd: number }[]>();
  const cardsWithLogin = new Set<string>();
  for (const r of rows) {
    const card = String(r.card ?? "");
    if (!card) continue;
    if (r.kind === "card") cardsWithLogin.add(card);
    if (r.kind !== "pay" || !ISO_DAY.test(String(r.day))) continue;
    const list = byCard.get(card) ?? [];
    list.push({ day: String(r.day), usd: round2(num(r.usd)) });
    byCard.set(card, list);
  }
  return {
    byCard,
    cardsWithLogin,
    rows: num(sum.n1),
    tiedRows: num(sum.n2),
    net: num(sum.n3),
    tiedNet: num(sum.n4),
    ambiguousLogins: num(sum.n5),
    payers: num(payers.n1),
    tiedPayers: num(payers.n2),
    syncedAt: epoch(payers.n3),
  };
}

/** One client's stored stage history, as convex/ceo/data/clients.ts reads it. */
export type StopTrail = {
  /** First day of the churned run the history ends with, or null. */
  churnedFrom: string | null;
  /** Newest day the client read anything but churned, or null. */
  liveOn: string | null;
};

/** A client in the churn rule, whether on the roster or gone from it. */
type ChurnSubject = {
  taskId: string;
  name: string;
  stage: string | null;
  /** The ClientRow bucket today, or null for a card that left the client list. */
  cardBucket: string | null;
  /** The bucket the rule judges: the card's, or the last one stored for a card that left. */
  bucket: string;
  launchDate: string | null;
  trail: StopTrail | undefined;
  /** Left the client list this month while not churned. */
  leftLive: boolean;
};

type Loss = {
  day: string;
  reason: ChurnClient["reason"];
  /** Launched on or before the loss day. */
  launched: boolean;
};

type Judged = ChurnSubject & {
  /** The Launch Date when it is a real day on or before today. */
  launched: string | null;
  futureLaunch: boolean;
  termEnd: string | null;
  daysToTermEnd: number | null;
  renewal: RenewalEvidence | null;
  termState: NonNullable<ClientRow["termState"]>;
  churnedNow: boolean;
  loss: Loss | null;
  /** Lost on or before this day, the exact day unknown (a stop older than the history). */
  lostBy: string | null;
  /** Stopped at an unknown day that may be after the term end, so the term lists leave it out. */
  termUnclear: boolean;
};

/**
 * When a client that reads churned now stopped: the first day of the churned
 * run its history ends with. A history that is churned all the way back (or
 * has no rows yet) only says the stop was on or before its oldest churned day.
 */
function stopOf(
  t: StopTrail | undefined,
  today: string,
): { known: true; day: string } | { known: false; by: string } {
  if (t?.liveOn) return { known: true, day: t.churnedFrom ?? today };
  return { known: false, by: t?.churnedFrom ?? today };
}

export function judge(
  c: ChurnSubject,
  paid: RenewalEvidence[],
  today: string,
): Judged {
  const valid = c.launchDate !== null && ISO_DAY.test(c.launchDate);
  const launched =
    valid && (c.launchDate as string) <= today ? c.launchDate : null;
  const termEnd = launched ? addDays(launched, TERM_DAYS) : null;
  const daysToTermEnd = termEnd ? daysBetween(today, termEnd) : null;
  // The renewal is the first payment dated after the term end, on any rail.
  // A payment dated after today is not money in hand yet, so it never counts.
  const renewal = termEnd
    ? (paid.find(p => p.day > termEnd && p.day <= today) ?? null)
    : null;
  const pastTerm = termEnd !== null && today > termEnd;
  const termState: Judged["termState"] = !launched
    ? "not-launched"
    : !pastTerm
      ? "in-term"
      : renewal
        ? "renewed"
        : "no-renewal";
  const termLoss = pastTerm && !renewal ? termEnd : null;
  const churnedNow = c.bucket === "churned";

  let loss: Loss | null = null;
  let lostBy: string | null = null;
  let termUnclear = false;
  if (churnedNow) {
    const stop = stopOf(c.trail, today);
    if (stop.known)
      // The earlier of the two dates a client is listed under; a stop on the
      // term end day itself is a term that ended without a renewal.
      loss =
        termLoss !== null && termLoss <= stop.day
          ? { day: termLoss, reason: "term-ended-no-renewal", launched: true }
          : {
              day: stop.day,
              reason: "stopped",
              launched: launched !== null && launched <= stop.day,
            };
    else if (termLoss !== null && stop.by >= termLoss) {
      // Stopped on or before stop.by, term ended on termLoss: which came
      // first is not known, only that the client was gone by the term end.
      lostBy = termLoss;
      termUnclear = true;
    } else lostBy = stop.by;
  } else if (termLoss !== null && !c.leftLive)
    loss = { day: termLoss, reason: "term-ended-no-renewal", launched: true };

  return {
    ...c,
    launched,
    futureLaunch: valid && !launched,
    termEnd,
    daysToTermEnd,
    renewal,
    termState,
    churnedNow,
    loss,
    lostBy,
    termUnclear,
  };
}

export type MonthPoint = {
  taskId: string;
  metric: string;
  date: string;
  value: number;
};

export type ChurnInput = {
  today: string;
  roster: Omit<ChurnSubject, "trail" | "leftLive">[];
  /** ClickUp card names, for cards that are no longer on the client list. */
  cardNames: Map<string, string>;
  /** Payments tied to each card, oldest first. */
  paid: Map<string, RenewalEvidence[]>;
  trails: Map<string, StopTrail>;
  /** First day any client's stage was stored, or null. */
  historyStart: string | null;
  month: { from: string; points: MonthPoint[]; truncated: boolean };
};

type ChurnResult = {
  churn: Omit<ChurnPayload, "notes">;
  /** Coverage notes: what the history and the roster could not say. */
  notes: Note[];
  judged: Map<string, Judged>;
  internal: string[];
};

/**
 * The churn and term lists. Pure, and exported with `judge` only so the rule
 * can be checked on its own without Convex or Supabase.
 */
export function computeChurn(input: ChurnInput): ChurnResult {
  const { today, month } = input;
  const mStart = monthStart(today);
  const dayBefore = addDays(mStart, -1);
  const notes: Note[] = [];

  // Every stored stage and launch point since the day before the month.
  const monthBucket = new Map<string, Map<string, number>>();
  const monthLaunch = new Map<string, Map<string, number>>();
  const bucketDates = new Set<string>();
  for (const p of month.points) {
    const into =
      p.metric === BUCKET_METRIC
        ? monthBucket
        : p.metric === LAUNCH_METRIC
          ? monthLaunch
          : null;
    if (!into) continue;
    if (p.metric === BUCKET_METRIC) bucketDates.add(p.date);
    const byDate = into.get(p.taskId) ?? new Map<string, number>();
    byDate.set(p.date, p.value);
    into.set(p.taskId, byDate);
  }

  const internal: string[] = [];
  const subjects: ChurnSubject[] = [];
  const onRoster = new Set<string>();
  for (const r of input.roster) {
    onRoster.add(r.taskId);
    if (INTERNAL_CARD.test(r.name)) {
      internal.push(r.name);
      continue;
    }
    subjects.push({
      ...r,
      trail: input.trails.get(r.taskId),
      leftLive: false,
    });
  }

  // Cards stored this month that are no longer on the client list: moved to
  // the Sales Team To Contact stage (the sync leaves those out) or deleted.
  for (const [taskId, byDate] of monthBucket) {
    if (onRoster.has(taskId)) continue;
    const name = input.cardNames.get(taskId) ?? `ClickUp card ${taskId}`;
    if (INTERNAL_CARD.test(name)) continue;
    const dates = [...byDate.keys()].sort();
    let churnedFrom: string | null = null;
    let liveOn: string | null = null;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (byDate.get(dates[i]) === BUCKET_CHURNED) churnedFrom = dates[i];
      else {
        liveOn = dates[i];
        break;
      }
    }
    const last = byDate.get(dates[dates.length - 1]) ?? 0;
    const launches = monthLaunch.get(taskId);
    const launchDay = launches
      ? launches.get([...launches.keys()].sort().pop() ?? "")
      : undefined;
    subjects.push({
      taskId,
      name,
      stage: null,
      cardBucket: null,
      bucket: BUCKET_NAME[last] ?? "active",
      launchDate: launchDay ? fromEpochDay(launchDay) : null,
      trail: { churnedFrom, liveOn },
      leftLive: last !== BUCKET_CHURNED,
    });
  }

  const judged = new Map<string, Judged>();
  for (const s of subjects)
    judged.set(s.taskId, judge(s, input.paid.get(s.taskId) ?? [], today));
  const all = [...judged.values()];

  const pick = (j: Judged) => ({
    name: j.name,
    clickupTaskId: j.taskId,
    stage: j.stage,
    cardBucket: j.cardBucket,
  });
  const termClient = (j: Judged): TermClient => ({
    ...pick(j),
    launchDate: j.launched as string,
    termEnd: j.termEnd as string,
    daysToTermEnd: j.daysToTermEnd as number,
    renewal: j.renewal,
  });

  // --- The month lists.
  const churnedThisMonth: ChurnClient[] = [];
  const lostBeforeLaunchThisMonth: ChurnClient[] = [];
  for (const j of all) {
    const loss = j.loss;
    if (!loss || loss.day < mStart || loss.day > today) continue;
    const item: ChurnClient = {
      ...pick(j),
      launchDate: j.launched,
      day: loss.day,
      reason: loss.reason,
    };
    (loss.launched ? churnedThisMonth : lostBeforeLaunchThisMonth).push(item);
  }
  const byDay = (a: ChurnClient, b: ChurnClient) =>
    b.day.localeCompare(a.day) || a.name.localeCompare(b.name);
  churnedThisMonth.sort(byDay);
  lostBeforeLaunchThisMonth.sort(byDay);

  // --- The term lists. A card already in the churned bucket is not "due" and
  // not "renewed"; it is in the no-renewal list only when its stop is known to
  // be on or after the term end.
  const byTermEndDesc = (a: TermClient, b: TermClient) =>
    b.termEnd.localeCompare(a.termEnd) || a.name.localeCompare(b.name);
  const renewalDueSoon = all
    .filter(
      j =>
        !j.churnedNow &&
        !j.leftLive &&
        j.daysToTermEnd !== null &&
        j.daysToTermEnd >= 0 &&
        j.daysToTermEnd <= RENEWAL_SOON_DAYS,
    )
    .map(termClient)
    .sort(
      (a, b) =>
        a.daysToTermEnd - b.daysToTermEnd || a.name.localeCompare(b.name),
    );
  const termEndedRenewed = all
    .filter(j => !j.churnedNow && !j.leftLive && j.termState === "renewed")
    .map(termClient)
    .sort(byTermEndDesc);
  const termEndedNoRenewal = all
    .filter(j => j.loss?.reason === "term-ended-no-renewal")
    .map(termClient)
    .sort(byTermEndDesc);

  // --- The rate: launched clients on the books when the month began.
  const unknownAtStart: string[] = [];
  const inBase = new Set<string>();
  for (const j of all) {
    if (!j.launched || j.launched >= mStart) continue;
    if (j.loss && j.loss.day < mStart) continue;
    if (j.lostBy !== null && j.lostBy < mStart) continue;
    // Churned on the day before the month began, whatever happened since.
    if (monthBucket.get(j.taskId)?.get(dayBefore) === BUCKET_CHURNED) continue;
    if (j.lostBy !== null || j.leftLive) {
      unknownAtStart.push(j.name);
      continue;
    }
    inBase.add(j.taskId);
  }
  const lostFromBase = churnedThisMonth.filter(c =>
    inBase.has(c.clickupTaskId),
  ).length;
  let rate: number | null = null;
  let rateWhy: string | null = null;
  if (month.truncated)
    rateWhy =
      "This month's stored history could not be read in full, so a client that left the list may be missing.";
  else if (unknownAtStart.length)
    rateWhy = `Whether ${nameList(unknownAtStart)} ${unknownAtStart.length === 1 ? "was" : "were"} still a client when ${monthName(mStart.slice(0, 7))} began is not known, because the stop has no date or the card left the client list.`;
  else if (inBase.size === 0)
    rateWhy = `No launched client was on the books when ${monthName(mStart.slice(0, 7))} began.`;
  else rate = lostFromBase / inBase.size;
  const launchedAtMonthStart =
    month.truncated || unknownAtStart.length ? null : inBase.size;
  const outsideRate = churnedThisMonth.filter(
    c => !inBase.has(c.clickupTaskId),
  );
  if (rate !== null && outsideRate.length)
    notes.push({
      level: "info",
      text: `${nameList(outsideRate.map(c => c.name))} ${outsideRate.length === 1 ? "is" : "are"} named here but not in the rate, which only counts launched clients that were on the books when the month began.`,
    });

  // --- How far the stored history reaches.
  const hs = input.historyStart;
  const covered = hs !== null && hs <= dayBefore;
  // Days since the history began (or since the day before the month) with no
  // stored stage. Today's stage is stored by this refresh.
  const missing: string[] = [];
  if (hs !== null)
    for (let d = hs > dayBefore ? hs : dayBefore; d < today; d = addDays(d, 1))
      if (!bucketDates.has(d)) missing.push(d);
  const complete = covered && missing.length === 0 && !month.truncated;
  if (!covered)
    notes.push({
      level: "warn",
      text:
        hs === null
          ? `Partial month: the cockpit starts keeping each client's daily stage with this refresh, so no stop in ${monthName(mStart.slice(0, 7))} can be dated yet. The Client Success cockpit keeps a daily roster of its own, which this section does not read.`
          : `Partial month: the cockpit started keeping each client's daily stage on ${shortDay(hs)}, so a client that stopped earlier in ${monthName(mStart.slice(0, 7))} is not in these lists. The Client Success cockpit keeps a daily roster of its own, which this section does not read.`,
    });
  if (missing.length)
    notes.push({
      level: "warn",
      text: `No client stage was stored on ${plural(missing.length, "day")} this month (${nameList(missing.map(shortDay))}), so a stop on one of those days is dated on the next day that was stored.`,
    });
  if (month.truncated)
    notes.push({
      level: "warn",
      text: "This month's stored history was too long to read in one go, so clients that left the client list may be missing from these lists.",
    });

  const undated = all.filter(j => j.churnedNow && j.lostBy !== null);
  const undatedRecent = undated.filter(j => (j.lostBy as string) >= mStart);
  if (undated.length)
    notes.push({
      level: "info",
      text: `${plural(undated.length, "stopped client")} stopped before the cockpit's own history began, so the stop has no date and ${undated.length === 1 ? "is" : "they are"} not in the month lists${
        undatedRecent.length
          ? `. ${undatedRecent.length === undated.length ? "Any of them" : `${undatedRecent.length} of them`} may have stopped this month`
          : ""
      }. ClickUp keeps no Churn Date on them.`,
    });
  const unclear = all.filter(j => j.termUnclear);
  if (unclear.length)
    notes.push({
      level: "info",
      text: `${nameList(unclear.map(j => j.name))} ${unclear.length === 1 ? "is" : "are"} stopped and past the term end with no renewal payment, but whether the stop or the term end came first is not known, so the term lists leave ${unclear.length === 1 ? "it" : "them"} out.`,
    });
  const leftLive = all.filter(j => j.leftLive);
  if (leftLive.length)
    notes.push({
      level: "warn",
      text: `${nameList(leftLive.map(j => j.name))} left the client list this month without being stopped (moved to Sales Team To Contact, or deleted), so whether ${leftLive.length === 1 ? "it" : "they"} churned is not known and ${leftLive.length === 1 ? "it is" : "they are"} not in these lists.`,
    });
  if (internal.length)
    notes.push({
      level: "info",
      text: `${nameList(internal)} ${internal.length === 1 ? "is an internal card" : "are internal cards"}, not ${internal.length === 1 ? "a client" : "clients"}, and ${internal.length === 1 ? "is" : "are"} left out.`,
    });
  const future = all.filter(j => j.futureLaunch);
  if (future.length)
    notes.push({
      level: "info",
      text: `${nameList(future.map(j => j.name))} ${future.length === 1 ? "has a Launch Date" : "have Launch Dates"} in the future, so ${future.length === 1 ? "it counts" : "they count"} as not launched yet.`,
    });
  const secondTerms = all
    .filter(j => !j.churnedNow && j.termState === "renewed" && j.termEnd)
    .map(j => ({
      name: j.name,
      end: addDays(j.termEnd as string, TERM_DAYS),
    }))
    .sort((a, b) => a.end.localeCompare(b.end));
  notes.push({
    level: "info",
    text: `Only the first 90 day term is judged: a renewed client is not checked again at the end of a second term.${
      secondTerms.length
        ? ` The first second term to end is ${secondTerms[0].name}'s, on ${shortDay(secondTerms[0].end)}${secondTerms[0].end < today ? ", already past" : ""}.`
        : ""
    }`,
  });
  notes.push({
    level: "info",
    text: "Paused is not churn: the 14 day pause rule is still an open decision. A paused client's term keeps running, so it can reach its term end while paused and be counted here.",
  });

  return {
    churn: {
      month: mStart.slice(0, 7),
      churnedThisMonth,
      lostBeforeLaunchThisMonth,
      renewalDueSoon,
      termEndedRenewed,
      termEndedNoRenewal,
      launchedAtMonthStart,
      rate,
      rateWhy,
      complete,
    },
    notes,
    judged,
    internal,
  };
}

export const clients: Adapter = {
  key: "clients",
  label: "Client success",
  compute: async ctx => {
    const now = Date.now();
    const today = kuwaitDay(now);
    const notes: Note[] = [];
    const sources: SourceStamp[] = [];

    // Whop renewal evidence runs beside the Pulse and portal reads, so the
    // three outside reads share the section budget instead of queueing.
    const whopRead: Promise<
      { ok: true; ties: WhopTies } | { ok: false; error: string }
    > = readWhopTies().then(
      ties => ({ ok: true, ties }),
      e => ({ ok: false, error: errText(e) }),
    );
    // The Client Extension Form and the cards' billing fields run beside it,
    // for the same reason (Aziz's spec of 2026-09-21, points 12 to 15).
    const extRead = readExtensionForm(ctx);
    const billingRead: Promise<
      { ok: true; rows: BillingRow[] } | { ok: false; error: string }
    > = ctx.runQuery(internal.ceo.billing.allBilling, {}).then(
      (rows: BillingRow[]) => ({ ok: true as const, rows }),
      (e: unknown) => ({ ok: false as const, error: errText(e) }),
    );

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
    // The MRR, LTV and Payment Plan fields per card, when the billing table
    // could be read; a card that is not in it carries null, not zero.
    const billing = await billingRead;
    const billingByTask = new Map<string, BillingRow>(
      billing.ok ? billing.rows.map(r => [r.taskId, r]) : [],
    );
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
      const bill = billingByTask.get(c.taskId);
      // The card's creation day, anchored on the day the sync counted from.
      const syncedAt = num(c.syncedAt);
      const createdDay = createdDayOf(
        c.signupDays,
        syncedAt > 0 ? kuwaitDay(syncedAt) : today,
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
        ...(billing.ok
          ? {
              ltvUsd: typeof bill?.ltvUsd === "number" ? bill.ltvUsd : null,
              mrrUsd: typeof bill?.mrrUsd === "number" ? bill.mrrUsd : null,
              paymentPlan: bill?.paymentPlan ?? null,
            }
          : {}),
        createdDay,
        daysToLaunch: daysToLaunchOf(createdDay, c.launchDate, today),
        // The sync's own reading of the form; replaced below when the form
        // is read here.
        extendedUntil: extended ? String(c.extendedUntil) : null,
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

    // --- Churn and renewals (decisions of 2026-09-16).
    const launchOf = new Map<string, string | null>(
      roster.map(c => [
        c.taskId as string,
        typeof c.launchDate === "string" ? c.launchDate : null,
      ]),
    );

    // Renewal evidence per card, from every rail that can name the client.
    const paid = new Map<string, RenewalEvidence[]>();
    const addPaid = (taskId: string, p: RenewalEvidence) => {
      const list = paid.get(taskId) ?? [];
      list.push(p);
      paid.set(taskId, list);
    };

    const whop = await whopRead;
    if (whop.ok) {
      sources.push({
        name: "Whop payments tied to client cards (portal logins)",
        freshestAt: whop.ties.syncedAt ?? undefined,
        ok: true,
      });
      for (const [taskId, list] of whop.ties.byCard)
        for (const w of list)
          addPaid(taskId, {
            rail: "whop",
            day: w.day,
            amountUsd: w.usd,
            matchedBy: "Whop payer email is a portal login on this card",
          });
    } else {
      sources.push({
        name: "Whop payments tied to client cards (portal logins)",
        ok: false,
        note: whop.error,
      });
      notes.push({
        level: "warn",
        text: `Churn and renewals are not shown this run: Whop payments could not be read (${whop.error}), so no client can be judged renewed or not.`,
      });
    }

    // Hand-logged payments: the ClickUp card picked on the entry, else a typed
    // name that matches exactly one card name or alias. Names are compared
    // with nameKey, the rule manualPayments.ts and the money adapter use, and
    // a key under 3 letters matches nothing, as in manualMatch.nameBook.
    const cardsByName = new Map<string, Set<string>>();
    const cardNames = new Map<string, string>();
    const nameOf = (name: unknown) => {
      const key = nameKey(typeof name === "string" ? name : null);
      return key.length >= 3 ? key : "";
    };
    const addName = (name: unknown, taskId: string | null) => {
      const key = nameOf(name);
      if (!key || !taskId) return;
      const ids = cardsByName.get(key) ?? new Set<string>();
      ids.add(taskId);
      cardsByName.set(key, ids);
    };
    for (const c of roster) {
      addName(c.name, c.taskId);
      cardNames.set(c.taskId, c.name);
    }
    for (const l of data.links ?? []) {
      if (l.taskId && !cardNames.has(l.taskId)) cardNames.set(l.taskId, l.name);
      for (const k of [l.name, ...(l.aliases ?? [])]) addName(k, l.taskId);
    }
    const manual: Any[] = data.manualPayments ?? [];
    let manualTied = 0;
    for (const m of manual) {
      const usd = num(m.amountUsd);
      if (typeof m.day !== "string" || !ISO_DAY.test(m.day) || !(usd > 0))
        continue;
      let taskId: string | null = m.clickupTaskId ?? null;
      let how = "the ClickUp card was picked on the entry";
      if (!taskId) {
        const key = nameOf(m.clientName);
        const ids = key ? cardsByName.get(key) : undefined;
        if (ids?.size === 1) {
          taskId = [...ids][0];
          how = "the typed client name matches this card";
        }
      }
      if (!taskId) continue;
      manualTied += 1;
      const rail = String(m.rail);
      addPaid(taskId, {
        rail: rail === "tap" ? "tap" : "manual",
        day: m.day,
        amountUsd: round2(usd),
        matchedBy:
          rail === "tap"
            ? `Tap payment logged by hand; ${how}`
            : `Logged by hand (${MANUAL_RAIL_LABEL[rail as ManualRail] ?? "other"}); ${how}`,
      });
    }
    const RAIL_ORDER = { whop: 0, tap: 1, manual: 2 };
    for (const list of paid.values())
      list.sort(
        (a, b) =>
          a.day.localeCompare(b.day) || RAIL_ORDER[a.rail] - RAIL_ORDER[b.rail],
      );

    const trails = new Map<string, StopTrail>(
      (data.stops ?? []).map((t: Any) => [
        String(t.taskId),
        { churnedFrom: t.churnedFrom ?? null, liveOn: t.liveOn ?? null },
      ]),
    );
    const result = computeChurn({
      today,
      roster: rows.map(r => ({
        taskId: r.clickupTaskId,
        name: r.name,
        stage: r.stage,
        cardBucket: r.bucket,
        bucket: r.bucket ?? "active",
        launchDate: launchOf.get(r.clickupTaskId) ?? null,
      })),
      cardNames,
      paid,
      trails,
      historyStart: data.historyStart ?? null,
      month: {
        from: data.bucketMonth?.from ?? addDays(monthStart(today), -1),
        points: data.bucketMonth?.points ?? [],
        truncated: data.bucketMonth?.truncated === true,
      },
    });

    // Per row: the Launch Date, the term end and where the client stands.
    // Without Whop a past term cannot be judged, so its state is left out.
    for (const r of rows) {
      const j =
        result.judged.get(r.clickupTaskId) ??
        judge(
          {
            taskId: r.clickupTaskId,
            name: r.name,
            stage: r.stage,
            cardBucket: r.bucket,
            bucket: r.bucket ?? "active",
            launchDate: launchOf.get(r.clickupTaskId) ?? null,
            trail: trails.get(r.clickupTaskId),
            leftLive: false,
          },
          paid.get(r.clickupTaskId) ?? [],
          today,
        );
      r.launchDate = launchOf.get(r.clickupTaskId) ?? null;
      r.termEnd = j.termEnd;
      if (
        whop.ok ||
        j.termState === "not-launched" ||
        j.termState === "in-term"
      )
        r.termState = j.termState;
    }

    let churn: ChurnPayload | undefined;
    if (whop.ok) {
      const t = whop.ties;
      const onBooks = [...result.judged.values()].filter(
        j => j.launched && !j.churnedNow && !j.leftLive,
      );
      const withWhop = onBooks.filter(j =>
        (paid.get(j.taskId) ?? []).some(p => p.rail === "whop"),
      ).length;
      const launchedPayers = [...result.judged.values()].filter(
        j => j.launched && t.byCard.has(j.taskId),
      );
      const paidBeforeLaunch = launchedPayers.filter(j =>
        (t.byCard.get(j.taskId) ?? []).some(
          w => w.day < (j.launched as string),
        ),
      ).length;
      const tap = tapKeyState();
      churn = {
        ...result.churn,
        notes: [
          ...result.notes.filter(n => n.level === "warn"),
          {
            level: "warn",
            text: `A Whop payment counts only when the payer's email is a portal login on the client's card. Today that ties ${t.tiedRows} of ${t.rows} paid Whop payments (${share(t.tiedRows, t.rows)}, ${dollars(t.tiedNet)} of ${dollars(t.net)}) and ${t.tiedPayers} of ${t.payers} payers to a card, and ${withWhop} of the ${onBooks.length} launched clients still on the books have a Whop payment tied to them. A client paying Whop from another email looks unrenewed until the payment is logged by hand.${
              t.ambiguousLogins
                ? ` ${plural(t.ambiguousLogins, "portal login")} on more than one card ${t.ambiguousLogins === 1 ? "is" : "are"} not used.`
                : ""
            }`,
          },
          {
            level: "warn",
            text: "A client who renews but pays late reads as churned from its term end until the payment lands.",
          },
          {
            level: "warn",
            text: `A client paying its original contract in instalments can read as renewed when it has not renewed, because any payment after the term end counts.${
              launchedPayers.length
                ? ` ${paidBeforeLaunch === launchedPayers.length ? `All ${launchedPayers.length}` : `${paidBeforeLaunch} of the ${launchedPayers.length}`} launched clients with a tied Whop payment paid at least once before their Launch Date, so the Launch Date is often later than the contract start and a term end can fall before the contract is paid off.`
                : ""
            }`,
          },
          {
            level: "info",
            text: "A payment dated on or before the term end is never a renewal, even one paid early for the next term.",
          },
          {
            level: "info",
            text: manual.length
              ? `A hand-logged payment counts when a ClickUp client was picked on the entry, or when the typed name matches exactly one card: ${manualTied} of ${plural(manual.length, "live entry", "live entries")} ${manualTied === 1 ? "is" : "are"} tied to a client${manualTied < manual.length ? ", the rest do not count" : ""}.${data.manualCapped ? " Only the first 5,000 entries were read." : ""}`
              : "No payment has been logged by hand yet, so a bank transfer, cheque, cash or Tap payment is not renewal evidence until it is logged on the Money tab.",
          },
          {
            level: "info",
            text:
              tap === "live"
                ? "Tap charges carry no client in the cockpit's read, and the Money tab refuses a Tap payment logged by hand while Tap is connected, so a renewal paid through Tap is not seen: that client reads as not renewed. Only Tap payments logged by hand before Tap was connected count."
                : "Tap is not connected, and its charges would carry no client in the cockpit's read anyway, so a Tap payment counts as a renewal only when it is logged by hand with the client.",
          },
          ...result.notes.filter(n => n.level !== "warn"),
        ],
      };
      sources.push({ name: "Hand-logged payments (Convex)", ok: true });
    }

    // --- Extensions, time to first launch, average retainer (Aziz, 2026-09-21).
    const ext = await extRead;
    const cards: Card[] = roster.map(c => ({ taskId: c.taskId, name: c.name }));
    let extensions: ExtensionsWithLastMonth | undefined;
    if (ext.ok) {
      const s = summariseExtensions(ext.grants, cards, today);
      const fieldId = await findExtensionField();
      // The field is kept current by the cockpit itself once it exists (Aziz, 2026-09-21).
      if (fieldId)
        await ctx.scheduler.runAfter(0, internal.ceo.extensions.applyAuto, {});
      extensions = {
        from: s.from,
        to: s.to,
        totalWeeks: s.totalWeeks,
        grants: s.grants,
        perClient: s.perClient,
        read: true,
        // The write is started from the button on the tab, never here.
        clickupField: {
          written: 0,
          note: fieldId
            ? `The current extension is written to the '${EXTENSION_FIELD_NAME}' field by hand, from the button on this card, never automatically.`
            : FIELD_ASK,
        },
        lastMonth: s.lastMonth,
      };
      const perTask = new Map(
        s.perClient
          .filter(p => p.clickupTaskId)
          .map(p => [p.clickupTaskId as string, p]),
      );
      for (const r of rows) {
        const p = perTask.get(r.clickupTaskId);
        if (p && p.weeks > 0) r.extensionWeeks = p.weeks;
        r.extendedUntil = p?.live ? p.until : null;
      }
      sources.push({
        name: "Client Extension Form (Typeform)",
        freshestAt: s.newestAt ?? undefined,
        ok: true,
      });
      const liveCount = s.perClient.filter(p => p.live).length;
      notes.push({
        level: "info",
        text: `Extensions are the Client Extension Form's responses, read from Typeform (${plural(ext.responses, "response")} on the form, the newest ${EXT_PAGE} at most): 1, 2 or 4 weeks each, dated by the day the form was submitted, so the clock starts at submission and a late form cannot backdate cover. Month to date (${shortDay(s.from)} to ${shortDay(s.to)}): ${plural(s.totalWeeks, "week")} over ${plural(s.grants, "grant")}, ${plural(liveCount, "client")} covered today; last month ${plural(s.lastMonth.totalWeeks, "week")} over ${plural(s.lastMonth.grants, "grant")}. The typed client is matched to a card by name${
          s.unmatched
            ? `: ${plural(s.unmatched, "response")} of ${ext.responses} matched no card and ${s.unmatched === 1 ? "is" : "are"} listed under the typed name`
            : ""
        }.${
          s.internalTest
            ? ` ${plural(s.internalTest, "test submission")} (an internal test card) ${s.internalTest === 1 ? "is" : "are"} left out.`
            : ""
        }`,
      });
      notes.push({
        level: fieldId ? "info" : "warn",
        text: fieldId
          ? `The current extension reaches the ClickUp card only when the button on this card is pressed: it writes the live extension's weeks, or 0 once it has ended, to the '${EXTENSION_FIELD_NAME}' field on every card the form has named.`
          : `The current extension is not on the ClickUp cards yet. ClickUp's API cannot create a field, so: ${FIELD_ASK}. The button on this card then writes the live extension's weeks, or 0 once it has ended.`,
      });
    } else {
      sources.push({
        name: "Client Extension Form (Typeform)",
        ok: false,
        note: ext.error,
      });
      notes.push({
        level: "warn",
        text: `The Client Extension Form could not be read this run (${ext.error}), so extension weeks are missing, not zero, and a live extension is known only from the last CSM sync.`,
      });
    }

    const launchSummary = summariseLaunch(
      rows.map(r => ({
        client: r.name,
        clickupTaskId: r.clickupTaskId,
        bucket: r.bucket,
        internal: INTERNAL_CARD.test(r.name),
        createdDay: r.createdDay ?? null,
        launchDate: r.launchDate ?? null,
      })),
      today,
    );
    const launch: NonNullable<ClientsPayload["launch"]> = {
      averageDays: launchSummary.averageDays,
      medianDays: launchSummary.medianDays,
      clients: launchSummary.clients,
      rows: launchSummary.rows,
      notLaunched: launchSummary.notLaunched,
    };
    const after = launchSummary.createdAfterLaunch;
    notes.push({
      level: "info",
      text: `Time to first launch runs from the day the ClickUp card was created (derived from the sync's days since creation, so within a day of it) to the card's Launch Date, first launch only: a relaunch after a pause keeps the original date. ${
        launchSummary.clients
          ? `Over ${plural(launchSummary.clients, "launched client")} the average is ${launchSummary.averageDays} days and the median ${launchSummary.medianDays}.`
          : "No launched client has both a creation day and a Launch Date yet."
      } ${plural(launchSummary.notLaunched, "live client")} ${launchSummary.notLaunched === 1 ? "has" : "have"} not launched yet, a Launch Date still ahead included.${
        after.length
          ? ` ${nameList(after)} ${after.length === 1 ? "was created after its" : "were created after their"} Launch Date and ${after.length === 1 ? "is" : "are"} left out.`
          : ""
      }${
        launchSummary.noCreatedDay
          ? ` ${plural(launchSummary.noCreatedDay, "launched card")} ${launchSummary.noCreatedDay === 1 ? "has" : "have"} no creation day stored and ${launchSummary.noCreatedDay === 1 ? "is" : "are"} left out.`
          : ""
      }`,
    });

    let retainer: ClientsPayload["retainer"];
    if (billing.ok) {
      retainer = averageRetainer(billing.rows);
      sources.push({
        name: "Client card billing fields (CSM sync)",
        freshestAt: billing.rows.length
          ? Math.max(...billing.rows.map(r => num(r.syncedAt)))
          : undefined,
        ok: billing.rows.length > 0,
        note: billing.rows.length ? undefined : "no billing rows stored yet",
      });
      notes.push({
        level: "info",
        text: `Average retainer is the mean of the MRR field over active cards on a recurring plan (a Payment Plan that is not paid in full, split pay, one-off or upfront)${
          retainer.cards
            ? `: ${plural(retainer.cards, "card")}`
            : ": no card qualifies today"
        }. A card with a blank plan or a blank MRR is left out, so it is a figure over the cards that carry both, typed by hand. MRR and LTV on the roster are the same card fields.`,
      });
    } else {
      sources.push({
        name: "Client card billing fields (CSM sync)",
        ok: false,
        note: billing.error,
      });
      notes.push({
        level: "warn",
        text: `The client cards' billing fields could not be read this run (${billing.error}), so the average retainer, MRR and LTV per client are missing, not zero.`,
      });
    }

    const payload = {
      counts: { ...counts, total: rows.length },
      atRisk,
      rows,
      churn,
      extensions,
      launch,
      retainer,
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
    if (churn) {
      daily.push(
        point("clients.term.noRenewal", churn.termEndedNoRenewal.length),
        point("clients.term.dueSoon", churn.renewalDueSoon.length),
      );
      // The month counts and the rate are only kept for a month the stored
      // history fully covers: a partial month count is a floor, and a trend
      // drawn from it later would read the floor as the real figure.
      if (churn.complete) {
        daily.push(
          point("clients.churn.launchedMtd", churn.churnedThisMonth.length),
          point(
            "clients.churn.lostBeforeLaunchMtd",
            churn.lostBeforeLaunchThisMonth.length,
          ),
        );
        if (churn.rate !== null)
          daily.push(point("clients.churn.rateMtd", churn.rate));
      }
    }
    if (extensions)
      daily.push(
        point("clients.extensions.weeksMtd", extensions.totalWeeks),
        point(
          "clients.extensions.live",
          extensions.perClient.filter(p => p.live).length,
        ),
      );
    if (launch.averageDays !== null)
      daily.push(point("clients.launch.averageDays", launch.averageDays));
    if (retainer && retainer.averageUsd !== null)
      daily.push(point("clients.retainer.averageUsd", retainer.averageUsd));
    // Each card's stage and Launch Date, so a stop can be dated later
    // (ClickUp keeps no history) and a card that leaves the list is still known.
    for (const r of rows) {
      const scope = `client:${r.clickupTaskId}`;
      const value = BUCKET_VALUE[r.bucket ?? ""];
      if (value !== undefined)
        daily.push({ date: today, metric: BUCKET_METRIC, scope, value });
      if (r.launchDate && ISO_DAY.test(r.launchDate))
        daily.push({
          date: today,
          metric: LAUNCH_METRIC,
          scope,
          value: epochDay(r.launchDate),
        });
    }

    return { payload, daily, sources };
  },
};
