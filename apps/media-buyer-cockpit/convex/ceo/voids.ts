import { num, type Row } from "./sb";

/**
 * Voided deals: one rule for every CEO number that counts a signed deal.
 *
 * Aziz, 2026-09-27: take voided deals out of every number the cockpit shows.
 * B2B does not keep a voided deal out of `public.closed_deals`: the row is
 * there, and `public.record_voids` marks it (`entity = 'closed_deal'`,
 * `record_id` = the deal's `response_id`). B2B's own functions count every
 * row of closed_deals, voided or not (b2b_window_metrics, b2b_rep_scorecard,
 * b2b_marketing_ads, b2b_pacing_pipeline, b2b_action_queue, b2b_deal_cash and
 * b2b_asset_performance, read 2026-09-27). So:
 *
 * - every direct read of closed_deals here adds NOT_VOIDED(alias);
 * - every number read from one of those functions has the voided deals of the
 *   same window taken off, dated and attributed the way the function dates and
 *   attributes a deal, and the rates built on them are worked out again with
 *   the function's own formulas.
 *
 * On 2026-09-27 two deals are voided, both test submissions of the New Client
 * Form on 29 August 2026, $8,000 contracted and $1,500 cash between them:
 * August reads 12 closes and $6,500 cash on the B2B dashboard, 10 and $5,000
 * here.
 */

const ALIAS = /^[a-z_][a-z0-9_]*$/i;

function alias(a: string): string {
  // `rv` is the alias inside the fragment; an outer `rv` would be shadowed.
  if (!ALIAS.test(a) || a.toLowerCase() === "rv")
    throw new Error(`voids: bad alias ${a}`);
  return a;
}

/** A response id (any SQL expression) B2B has voided. */
export function voidedId(responseId: string): string {
  return `exists (select 1 from public.record_voids rv where rv.entity = 'closed_deal' and rv.record_id = ${responseId})`;
}

/** The closed_deals row under this alias is voided. */
export function VOIDED(d: string): string {
  return voidedId(`${alias(d)}.response_id`);
}

/** The closed_deals row under this alias is not voided. */
export function NOT_VOIDED(d: string): string {
  return `not ${VOIDED(d)}`;
}

/**
 * What voided deals add to b2b_window_metrics' deal keys, as a select list
 * over closed_deals under this alias: one close each, and their contracted
 * revenue, cash collected and new MRR.
 */
export function voidedSums(d: string): string {
  const a = alias(d);
  return `count(*) as signed,
    coalesce(sum(${a}.contracted_revenue), 0) as revenue,
    coalesce(sum(${a}.cash_collected), 0) as cash_collected,
    coalesce(sum(${a}.new_mrr), 0) as new_mrr`;
}

/** The voided deals of one window, in b2b_window_metrics' keys. */
export type VoidedPart = {
  signed: number;
  revenue: number;
  cash_collected: number;
  new_mrr: number;
};

export const NO_VOIDS: VoidedPart = {
  signed: 0,
  revenue: 0,
  cash_collected: 0,
  new_mrr: 0,
};

/** A VoidedPart from a SQL cell: json, a json string, or nothing. */
export function voidedPartOf(x: unknown): VoidedPart {
  const raw = typeof x === "string" ? JSON.parse(x) : x;
  if (!raw || typeof raw !== "object") return NO_VOIDS;
  const r = raw as Row;
  return {
    signed: num(r.signed),
    revenue: num(r.revenue),
    cash_collected: num(r.cash_collected),
    new_mrr: num(r.new_mrr),
  };
}

export const hasVoids = (v: VoidedPart): boolean =>
  v.signed !== 0 ||
  v.revenue !== 0 ||
  v.cash_collected !== 0 ||
  v.new_mrr !== 0;

/**
 * b2b_window_metrics less the voided deals of the same window.
 *
 * The function counts every row of closed_deals by the Riyadh day its form
 * was submitted, whatever campaigns it is asked about (the campaign filter
 * only narrows spend), so the caller passes the voided deals of exactly those
 * days. They come off signed, revenue, cash_collected and new_mrr, and every
 * rate built on those is worked out again with the function's own formulas
 * (read 2026-09-27): roas, cac, close_rate, close_rate_all and
 * lead_to_client. A window with no voided deal is returned untouched.
 */
export function withoutVoids(m: Row, v: VoidedPart): Row {
  if (!hasVoids(v)) return m;
  const div = (a: number, b: number, times: number, places: number) =>
    b > 0 ? Math.round(((times * a) / b) * 10 ** places) / 10 ** places : null;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const signed = num(m.signed) - v.signed;
  const revenue = r2(num(m.revenue) - v.revenue);
  const spend = num(m.spend);
  return {
    ...m,
    signed,
    revenue,
    cash_collected: r2(num(m.cash_collected) - v.cash_collected),
    new_mrr: r2(num(m.new_mrr) - v.new_mrr),
    roas: div(revenue, spend, 1, 2),
    cac: div(spend, signed, 1, 2),
    close_rate: div(signed, num(m.demos_qualified), 100, 1),
    close_rate_all: div(signed, num(m.demos_shown), 100, 1),
    lead_to_client: div(signed, num(m.leads), 100, 1),
  };
}

/** Voided deals per Riyadh day of the form, between two days (inclusive). */
export function voidedByDaySql(from: string, to: string): string {
  for (const d of [from, to])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`voids: bad day ${d}`);
  return `select to_char((d.submitted_at at time zone 'Asia/Riyadh')::date, 'YYYY-MM-DD') as day,
  ${voidedSums("d")}
from public.closed_deals d
where ${VOIDED("d")}
  and (d.submitted_at at time zone 'Asia/Riyadh')::date between date '${from}' and date '${to}'
group by 1
order by 1`;
}

export type VoidedDay = { day: string } & VoidedPart;

export function voidedDayOf(r: Row): VoidedDay {
  return { day: String(r.day), ...voidedPartOf(r) };
}

/** Whole dollars with thousands commas. */
export function dollars(x: number): string {
  return `$${String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

const MONTHS = [
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

/** "2026-08-29" as "29 August 2026". */
export function longDay(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  return `${dd} ${MONTHS[m - 1] ?? m} ${y}`;
}

/** "2 voided deals" / "1 voided deal". */
export const voidedDeals = (n: number): string =>
  n === 1 ? "1 voided deal" : `${n} voided deals`;

/**
 * "2 voided deals, both signed on 29 August 2026 ($8,000 contracted, $1,500
 * cash)", or one clause per day when they fall on several. Null when none.
 */
export function voidedDaysText(days: VoidedDay[]): string | null {
  const live = days.filter(d => d.signed > 0);
  if (!live.length) return null;
  const n = live.reduce((t, d) => t + d.signed, 0);
  const money = (v: VoidedPart) =>
    `${dollars(v.revenue)} contracted, ${dollars(v.cash_collected)} cash`;
  if (live.length === 1)
    return `${voidedDeals(n)}, ${n === 1 ? "signed" : n === 2 ? "both signed" : "all signed"} on ${longDay(live[0].day)} (${money(live[0])})`;
  const shown = live.slice(0, 6);
  const rest = live.length - shown.length;
  return `${voidedDeals(n)}: ${shown
    .map(d => `${d.signed} on ${longDay(d.day)} (${money(d)})`)
    .join("; ")}${rest > 0 ? `; and ${rest} more days` : ""}`;
}
