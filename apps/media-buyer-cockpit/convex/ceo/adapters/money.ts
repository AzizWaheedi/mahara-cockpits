import { internal } from "../../_generated/api";
import { type BillingRow, LIVE_GROUPS, summariseBilling } from "../billing";
import { byNewest, type ManualLoad, type ManualRow } from "../data/money";
import {
  capturedCharges,
  TAP_CONNECT_COMMAND,
  TAP_KEY_NAME,
  type TapCharge,
  tapKeyState,
  USD_PER,
} from "../data/tap";
import {
  cashDuplicates,
  coverWithTap,
  type DealLike,
  dealDuplicates,
  MATCH_DAYS,
  nameBook,
  type TapCover,
  usdWords,
  type WhopLike,
} from "../manualMatch";
import type {
  CashRail,
  ManualPaymentRow,
  MoneyPayload,
  Note,
  Point,
  PossibleDuplicate,
} from "../payloads";
import { B2B, num, sql } from "../sb";
import {
  addDays,
  daysInMonth,
  KUWAIT_OFFSET_MS,
  kuwaitDay,
  monthStart,
} from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

/** Whop and the closer form sync every 15 minutes; an hour behind is stale. */
const STALE_MS = 60 * 60_000;

/** monthly_targets keeps these as percents; the payload wants fractions. */
const PERCENT_METRICS = new Set([
  "close_rate",
  "ctr",
  "demo_show_rate",
  "lead_to_demo",
]);

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

/** A Kuwait day as a SQL date literal, checked so only a real day goes into the query text. */
function day(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`money: bad day ${d}`);
  return `date '${d}'`;
}

/** YYYY-MM shifted by n months. */
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** "2026-06" as "June 2026". */
function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] ?? month} ${y}`;
}

const usd = (x: number) => Math.round(x * 100) / 100;

/** Epoch ms computed in SQL (Postgres "+00" timestamps do not parse in JS). */
const epoch = (x: unknown): number | undefined =>
  x === null || x === undefined || x === "" ? undefined : num(x) || undefined;

/** Newest updated_ms across rows, or undefined. */
const newest = (rows: { updated_ms?: unknown }[]): number | undefined => {
  const all = rows.map(r => epoch(r.updated_ms)).filter(x => x !== undefined);
  return all.length ? Math.max(...all) : undefined;
};

/** Whole dollars with thousands commas, without relying on Intl. */
const dollars = (x: number) =>
  `$${String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

const errText = (e: unknown) =>
  String(e instanceof Error ? e.message : e).slice(0, 160);

/** "3 payments" / "1 payment". */
const payments = (n: number) => (n === 1 ? "1 payment" : `${n} payments`);

/** The singular or plural form, by count: says(n, "counts", "count"). */
const says = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Midnight Kuwait at the start of a day, epoch ms. */
const kuwaitMidnight = (d: string) =>
  new Date(`${d}T00:00:00Z`).getTime() - KUWAIT_OFFSET_MS;

/**
 * Money: cash by rail, deals and contracted value from the closer form,
 * monthly targets and the bank expense import. Everything but Tap and the
 * hand-logged payments comes from the B2B Supabase project; Tap comes
 * straight from its own API through ../data/tap and is off until
 * TAP_SECRET_KEY is set on the deployment; hand-logged payments come from
 * the Convex table ceoManualPayments through ../data/money.
 * Days and months are Kuwait time.
 *
 * `cash` stays Whop only, which is what the rest of the cockpit already reads.
 * `rails` says the same Whop money again beside Tap and the Manual rail, and
 * `rails.total` adds up the connected rails only, so the two are never summed
 * by accident.
 *
 * Hand-logged payments never count twice (../manualMatch): an entry logged on
 * the "tap" rail before Tap was connected drops out once a Tap charge matches
 * it; an entry that looks like a Whop or Tap payment is flagged, not dropped;
 * a hand-logged deal value the closer form already has is flagged and left
 * out of contracted.
 */
export const money: Adapter = {
  key: "money",
  label: "Money",
  compute: async ctx => {
    const now = Date.now();
    const today = kuwaitDay(now);
    const month = today.slice(0, 7);
    const dayOfMonth = Number(today.slice(8, 10));
    const dim = daysInMonth(today);
    const lastMonth = shiftMonth(month, -1);
    const lastMonthStart = `${lastMonth}-01`;
    // Same day of last month, capped at its length (March 31 compares to Feb 28).
    const lastMonthToDateEnd = `${lastMonth}-${String(
      Math.min(dayOfMonth, daysInMonth(lastMonthStart)),
    ).padStart(2, "0")}`;
    const lastMonthEnd = addDays(monthStart(today), -1);
    const from90 = addDays(today, -89);
    const from30 = addDays(today, -29);
    const firstMonthStart = `${shiftMonth(month, -11)}-01`;
    const notes: Note[] = [];

    // --- Core: Whop cash per day. paid_on is already the Kuwait (+03) day and
    // net_amount is net of refunds, booked on the charge day. Open rows are
    // declined or abandoned checkouts and never cash.
    const cashRows = await sql(
      B2B,
      `select to_char(paid_on, 'YYYY-MM-DD') as day, sum(net_amount) as cash
       from public.whop_payments
       where status = 'paid' and currency = 'usd'
         and paid_on between ${day(from90)} and ${day(today)}
       group by paid_on`,
    );
    const byDay = new Map(cashRows.map(r => [String(r.day), num(r.cash)]));
    const cashDaily: Point[] = [];
    for (let d = from90; d <= today; d = addDays(d, 1))
      cashDaily.push({ date: d, value: usd(byDay.get(d) ?? 0) });
    const cashBetween = (from: string, to: string) =>
      usd(
        cashDaily
          .filter(p => p.date >= from && p.date <= to)
          .reduce((s, p) => s + p.value, 0),
      );
    const mtd = cashBetween(monthStart(today), today);

    // --- Core: 12 months of cash, refunds (by the Kuwait day of the refund)
    // and deals (by the Kuwait day the closer form was submitted).
    const monthRows = await sql(
      B2B,
      `with months as (
         select generate_series(${day(firstMonthStart)}, ${day(monthStart(today))}, interval '1 month')::date as m
       ),
       cash as (
         select date_trunc('month', paid_on)::date as m, sum(net_amount) as cash
         from public.whop_payments
         where status = 'paid' and currency = 'usd' and paid_on >= ${day(firstMonthStart)}
         group by 1
       ),
       refunds as (
         select date_trunc('month', (refunded_at at time zone 'Asia/Kuwait')::date)::date as m,
                sum(refunded_amount) as refunds
         from public.whop_payments
         where status = 'paid' and currency = 'usd' and refunded_amount > 0
           and (refunded_at at time zone 'Asia/Kuwait')::date >= ${day(firstMonthStart)}
         group by 1
       ),
       deals as (
         select date_trunc('month', (submitted_at at time zone 'Asia/Kuwait')::date)::date as m,
                count(*) as deals,
                count(*) filter (where contracted_revenue is null) as missing_contracted,
                sum(contracted_revenue) as contracted
         from public.closed_deals
         where (submitted_at at time zone 'Asia/Kuwait')::date >= ${day(firstMonthStart)}
         group by 1
       )
       select to_char(mo.m, 'YYYY-MM') as month,
              coalesce(c.cash, 0) as cash,
              coalesce(r.refunds, 0) as refunds,
              coalesce(d.contracted, 0) as contracted,
              coalesce(d.deals, 0) as deals,
              coalesce(d.missing_contracted, 0) as missing_contracted
       from months mo
       left join cash c on c.m = mo.m
       left join refunds r on r.m = mo.m
       left join deals d on d.m = mo.m
       order by mo.m`,
    );
    const monthly = monthRows.map(r => ({
      month: String(r.month),
      cash: usd(num(r.cash)),
      refunds: usd(num(r.refunds)),
      contracted: usd(num(r.contracted)),
      deals: num(r.deals),
    }));
    const thisRow = monthly.find(m => m.month === month);
    const lastRow = monthly.find(m => m.month === lastMonth);

    // --- Core: refunds, failed charges, average contract, feed freshness and
    // which months the bank CSV covers, in one round trip. An open charge whose
    // membership was paid later did become cash, so it is not a failed charge.
    const [s] = await sql(
      B2B,
      `with w as (
         select status, final_amount, refunded_amount, synced_at, membership_id, paid_at, created_at,
                (created_at at time zone 'Asia/Kuwait')::date as created_day,
                (refunded_at at time zone 'Asia/Kuwait')::date as refund_day
         from public.whop_payments
         where currency = 'usd'
       ),
       failed as (
         select o.final_amount from w o
         where o.status = 'open' and o.created_day between ${day(from30)} and ${day(today)}
           and not exists (
             select 1 from w p
             where p.status = 'paid' and p.membership_id = o.membership_id and p.paid_at >= o.created_at
           )
       ),
       recent_deals as (
         select contracted_revenue
         from public.closed_deals
         where contracted_revenue is not null
           and (submitted_at at time zone 'Asia/Kuwait')::date between ${day(from90)} and ${day(today)}
       )
       select
         (select coalesce(sum(refunded_amount), 0) from w
           where status = 'paid' and refunded_amount > 0 and refund_day between ${day(monthStart(today))} and ${day(today)}) as refunds_mtd,
         (select coalesce(sum(refunded_amount), 0) from w
           where status = 'paid' and refunded_amount > 0 and refund_day between ${day(from90)} and ${day(today)}) as refunds_90,
         (select count(*) from failed) as failed_count_30,
         (select coalesce(sum(final_amount), 0) from failed) as failed_amount_30,
         (select floor(extract(epoch from max(synced_at)) * 1000) from w) as whop_synced_ms,
         (select floor(extract(epoch from max(paid_at)) * 1000) from w where status = 'paid') as whop_last_paid_ms,
         (select round(avg(contracted_revenue), 2) from recent_deals) as avg_contract_90,
         (select floor(extract(epoch from max(synced_at)) * 1000) from public.closed_deals) as deals_synced_ms,
         (select to_char(min((submitted_at at time zone 'Asia/Kuwait')::date), 'YYYY-MM-DD') from public.closed_deals) as first_deal_day,
         (select string_agg(distinct to_char(incurred_at, 'YYYY-MM'), ',') from public.expenses) as expense_months,
         (select string_agg(distinct to_char(received_at, 'YYYY-MM'), ',') from public.transfers) as transfer_months`,
    );
    if (!s) throw new Error("money: summary query returned no row");

    const whopAt = epoch(s.whop_synced_ms);
    const dealsAt = epoch(s.deals_synced_ms);
    const sources: SourceStamp[] = [
      {
        name: "Whop payments",
        freshestAt: whopAt,
        ok: whopAt !== undefined && now - whopAt < STALE_MS,
      },
      {
        name: "Closer form deals",
        freshestAt: dealsAt,
        ok: dealsAt !== undefined && now - dealsAt < STALE_MS,
      },
    ];
    const ageMin = (at?: number) =>
      at === undefined ? null : Math.round((now - at) / 60_000);
    if (!sources[0].ok)
      notes.push({
        level: "warn",
        text:
          whopAt === undefined
            ? "Whop payments have never synced, so cash is not known."
            : `Whop payments last synced ${ageMin(whopAt)} minutes ago, so cash may be behind.`,
      });
    if (!sources[1].ok)
      notes.push({
        level: "warn",
        text:
          dealsAt === undefined
            ? "The closer form has never synced, so deals are not known."
            : `The closer form last synced ${ageMin(dealsAt)} minutes ago, so deals may be behind.`,
      });

    // What cash covers leads the money notes, but it can only be written once
    // the rails below have been read: a Tap key that is set but cannot be
    // reached still leaves Tap out, and the Manual rail counts only once
    // something is logged. The note keeps its place here and its level and
    // text are filled in after the rails are built. It is the one note about
    // scope: the Tap note below only says why Tap is or is not read.
    const tapState = tapKeyState();
    const cashScopeNote: Note = { level: "warn", text: "" };
    notes.push(cashScopeNote);
    // The one note that says how the rails add up. Every tab that shows the
    // rails beside their total reads it from here.
    notes.push({
      level: "info",
      text: "The rails total already adds up every connected rail, and the Whop rail is the same money as Whop cash, so never add a rail's own figure to the total.",
    });
    notes.push({
      level: "info",
      text: "Whop cash is net of refunds and books a refund on the day of the original charge. Refunds are also listed by the month they happened, so never subtract them again.",
    });
    notes.push({
      level: "info",
      text: "Deal cash is the deposit the closer typed on the form. It is usually the same money as a Whop charge, so it is never added to cash.",
    });

    const missing = monthRows.filter(r => num(r.missing_contracted) > 0);
    if (missing.length) {
      const n = missing.reduce((t, r) => t + num(r.missing_contracted), 0);
      notes.push({
        level: "warn",
        text: `Contracted value was not captured on ${n} deals (${missing
          .map(r => monthName(String(r.month)))
          .join(
            ", ",
          )}), so contracted reads low for ${missing.length === 1 ? "that month" : "those months"}.`,
      });
    }
    const firstDeal = s.first_deal_day ? String(s.first_deal_day) : null;
    if (firstDeal && firstDeal > firstMonthStart)
      notes.push({
        level: "info",
        text: `The closer form has deals from ${firstDeal} only, so earlier months show no deals.`,
      });
    if (num(s.failed_count_30) > 0)
      notes.push({
        level: "info",
        text: "Failed charges are declined or abandoned Whop checkouts with no later payment on the same membership, counted per attempt, so one payer can show more than once.",
      });

    const splitMonths = (x: unknown) =>
      x ? String(x).split(",").filter(Boolean).sort() : [];
    const expenseMonths = splitMonths(s.expense_months);
    const transferMonths = splitMonths(s.transfer_months);
    if (!expenseMonths.includes(month) || !transferMonths.includes(month)) {
      const list = (ms: string[]) =>
        ms.length ? ms.map(monthName).join(", ") : "no months";
      notes.push({
        level: "warn",
        text:
          list(expenseMonths) === list(transferMonths)
            ? `Expenses and bank transfers only cover the months loaded (${list(expenseMonths)}). Other months are missing, not zero.`
            : `Expenses only cover ${list(expenseMonths)} and bank transfers only cover ${list(transferMonths)}. Other months are missing, not zero.`,
      });
    }

    const deals: MoneyPayload["deals"] = {
      mtd: thisRow?.deals ?? 0,
      lastMonth: lastRow?.deals ?? 0,
      contractedMtd: thisRow?.contracted ?? 0,
      contractedLastMonth: lastRow?.contracted ?? 0,
      avgContract90d:
        s.avg_contract_90 === null || s.avg_contract_90 === undefined
          ? null
          : usd(num(s.avg_contract_90)),
      recent: [],
    };

    // --- Secondary: the newest deals. Closer as a first name only; no contact
    // fields are selected.
    try {
      const rows = await sql(
        B2B,
        `select to_char((submitted_at at time zone 'Asia/Kuwait')::date, 'YYYY-MM-DD') as day,
                left(nullif(btrim(business_name), ''), 80) as business,
                nullif(split_part(btrim(coalesce(closer, '')), ' ', 1), '') as closer,
                contracted_revenue as contracted,
                cash_collected as cash,
                left(nullif(btrim(payment_structure), ''), 60) as plan
         from public.closed_deals
         where submitted_at is not null
         order by submitted_at desc
         limit 10`,
      );
      deals.recent = rows.map(r => ({
        date: String(r.day),
        business: r.business ?? null,
        closer: r.closer ?? null,
        contracted: r.contracted === null ? null : usd(num(r.contracted)),
        cash: r.cash === null ? null : usd(num(r.cash)),
        plan: r.plan ?? null,
      }));
    } catch (e) {
      sources[1].note = `recent deals failed: ${errText(e)}`;
      notes.push({
        level: "warn",
        text: "Recent deals could not be read, so the list is empty.",
      });
    }

    // --- Secondary: targets for this month. The latest month on or before
    // this one is read so the note can say which month has targets.
    const targets: MoneyPayload["targets"] = { month: null, items: [] };
    try {
      const rows = await sql(
        B2B,
        `select to_char(period_month, 'YYYY-MM') as month, metric, projection,
                floor(extract(epoch from updated_at) * 1000) as updated_ms
         from public.monthly_targets
         where projection is not null
           and period_month = (
             select max(period_month) from public.monthly_targets
             where period_month <= ${day(monthStart(today))}
           )
         order by metric`,
      );
      const targetMonth = rows[0] ? String(rows[0].month) : null;
      // The B2B dashboard's "revenue" is contracted value and "signed" is deals.
      const actuals: Record<string, number> = {
        revenue: deals.contractedMtd,
        signed: deals.mtd,
      };
      if (targetMonth === month) {
        // The target metric names are b2b_window_metrics keys, in the same
        // units (rates in percent), so month to date actuals come from there.
        // Only runs when this month has targets; cost_per_intro has no key.
        try {
          const got = await sql(
            B2B,
            `select m.key as metric, (m.value #>> '{}')::numeric as actual
             from jsonb_each(public.b2b_window_metrics(${day(monthStart(today))}, ${day(today)}, null::text[])::jsonb) m
             where jsonb_typeof(m.value) = 'number'
               and m.key in (select metric from public.monthly_targets where period_month = ${day(monthStart(today))})`,
          );
          for (const r of got)
            if (!(String(r.metric) in actuals))
              actuals[String(r.metric)] = num(r.actual);
        } catch (e) {
          notes.push({
            level: "warn",
            text: "Month to date actuals for targets other than revenue and signed could not be read.",
          });
          sources.push({
            name: "B2B window metrics",
            ok: false,
            note: errText(e),
          });
        }
        targets.month = month;
        targets.items = rows.map(r => {
          const metric = String(r.metric);
          const pct = PERCENT_METRICS.has(metric) || metric.endsWith("_rate");
          const scale = (x: number) => (pct ? x / 100 : x);
          return {
            metric,
            target: scale(num(r.projection)),
            actual: metric in actuals ? scale(actuals[metric]) : null,
          };
        });
        if (targets.items.some(i => i.metric === "revenue"))
          notes.push({
            level: "warn",
            text: "The revenue target is compared with closer form contracted value, as the B2B dashboard does, so deal values logged by hand are not in its pace. Its definition is still pending, so read that pace with care.",
          });
      } else {
        notes.push({
          level: "warn",
          text: targetMonth
            ? `No targets exist for ${monthName(month)}. The latest targets are for ${monthName(targetMonth)}.`
            : `No targets exist for ${monthName(month)}.`,
        });
      }
      sources.push({
        name: "Monthly targets",
        freshestAt: newest(rows),
        ok: true,
      });
    } catch (e) {
      sources.push({
        name: "Monthly targets",
        ok: false,
        note: errText(e),
      });
      notes.push({
        level: "warn",
        text: "Monthly targets could not be read.",
      });
    }

    // --- Secondary: the latest month of the bank expense import.
    const expenses: MoneyPayload["expenses"] = {
      month: null,
      total: null,
      byCategory: [],
    };
    try {
      const rows = await sql(
        B2B,
        `with latest as (
           select date_trunc('month', max(incurred_at))::date as m from public.expenses
         ),
         month_rows as (
           select e.category, e.amount_usd, e.note, e.vendor, e.updated_at
           from public.expenses e, latest l
           where e.incurred_at >= l.m and e.incurred_at < (l.m + interval '1 month')::date
         )
         select to_char((select m from latest), 'YYYY-MM') as month,
                coalesce(nullif(lower(btrim(category)), ''), 'uncategorised') as category,
                sum(amount_usd) as amount,
                coalesce(sum(amount_usd) filter (where note ilike '%unload%' or vendor ilike '%unload%'), 0) as unload,
                floor(extract(epoch from max(updated_at)) * 1000) as updated_ms
         from month_rows
         group by 2
         order by amount desc`,
      );
      if (rows.length) {
        expenses.month = String(rows[0].month);
        expenses.byCategory = rows.map(r => ({
          category: String(r.category),
          amount: usd(num(r.amount)),
        }));
        expenses.total = usd(rows.reduce((t, r) => t + num(r.amount), 0));
        const unload = usd(rows.reduce((t, r) => t + num(r.unload), 0));
        notes.push({
          level: "info",
          text: `Expenses come from a bank statement import converted from KWD. The ad_spend category is the same money as Meta ad spend, so never add both.${
            unload > 0
              ? ` In ${monthName(expenses.month)}, ${dollars(unload)} is card unload lines, which look like money moved to a card rather than a cost.`
              : ""
          }`,
        });
      }
      sources.push({
        name: "Bank expense import",
        freshestAt: newest(rows),
        ok: true,
      });
    } catch (e) {
      sources.push({
        name: "Bank expense import",
        ok: false,
        note: errText(e),
      });
      notes.push({
        level: "warn",
        text: "Expenses could not be read.",
      });
    }

    const failedCount = num(s.failed_count_30);
    const failedAmount = usd(num(s.failed_amount_30));

    // --- Cash by rail. `cash` below stays Whop only, which is what the rest of
    // the cockpit already reads, and `rails.whop` is the same money said again
    // for the rail card, so the two are never added together.
    const cash = {
      today: cashBetween(today, today),
      yesterday: cashBetween(addDays(today, -1), addDays(today, -1)),
      mtd,
      lastMonthToDate: cashBetween(lastMonthStart, lastMonthToDateEnd),
      lastMonth: cashBetween(lastMonthStart, lastMonthEnd),
      projectedMonth: usd((mtd / dayOfMonth) * dim),
      daily: cashDaily,
    };
    const refundsMtd = usd(num(s.refunds_mtd));

    const whopRail: CashRail = {
      label: "Whop",
      connected: true,
      ...cash,
      refundsMtd,
      lastPaymentAt: epoch(s.whop_last_paid_ms) ?? null,
    };

    // Not connected until proven otherwise: every Tap number stays null so the
    // screen shows n/a, never 0.
    const tapRail: CashRail = {
      label: "Tap",
      connected: false,
      today: null,
      yesterday: null,
      mtd: null,
      lastMonthToDate: null,
      lastMonth: null,
      projectedMonth: null,
      refundsMtd: null,
      daily: [],
      lastPaymentAt: null,
    };

    // The charges themselves, for matching hand-logged Tap payments. Null
    // while Tap is not read.
    let tapCharges: TapCharge[] | null = null;

    if (tapState === "missing") {
      notes.push({
        level: "warn",
        text: `Tap is not connected yet, so every Tap number is n/a. To connect it, set the key on this Convex deployment: ${TAP_CONNECT_COMMAND}`,
      });
      sources.push({
        name: "Tap payments (not connected)",
        ok: true,
        note: `${TAP_KEY_NAME} is not set on this deployment. Run: ${TAP_CONNECT_COMMAND}`,
      });
    } else if (tapState === "test") {
      notes.push({
        level: "warn",
        text: `Tap is not connected: the key on this deployment is a test key, so Tap charges are test money and every Tap number is n/a. Set the live key to turn the rail on: ${TAP_CONNECT_COMMAND}`,
      });
      sources.push({
        name: "Tap payments (test key)",
        ok: true,
        note: "A Tap test key is set, so Tap is not read as cash.",
      });
    } else {
      try {
        const read = await capturedCharges(from90, today);
        tapCharges = read.charges;
        const byTapDay = new Map<string, number>();
        for (const c of read.charges)
          if (c.usd !== null)
            byTapDay.set(c.day, (byTapDay.get(c.day) ?? 0) + c.usd);
        const tapDaily: Point[] = [];
        for (let d = from90; d <= today; d = addDays(d, 1))
          tapDaily.push({ date: d, value: usd(byTapDay.get(d) ?? 0) });
        const tapBetween = (from: string, to: string) =>
          usd(
            tapDaily
              .filter(p => p.date >= from && p.date <= to)
              .reduce((t, p) => t + p.value, 0),
          );
        const tapMtd = tapBetween(monthStart(today), today);

        tapRail.connected = true;
        tapRail.today = tapBetween(today, today);
        tapRail.yesterday = tapBetween(addDays(today, -1), addDays(today, -1));
        tapRail.mtd = tapMtd;
        tapRail.lastMonthToDate = tapBetween(
          lastMonthStart,
          lastMonthToDateEnd,
        );
        tapRail.lastMonth = tapBetween(lastMonthStart, lastMonthEnd);
        tapRail.projectedMonth = usd((tapMtd / dayOfMonth) * dim);
        tapRail.daily = tapDaily;
        tapRail.lastPaymentAt = read.newestAt;

        sources.push({
          name: "Tap payments",
          freshestAt: read.newestAt ?? undefined,
          ok: true,
          note: `${read.charges.length} captured charges over 90 days in ${read.requests} calls`,
        });
        notes.push({
          level: "warn",
          text: `Tap cash is captured Tap charges from the last 90 days, counted on the Kuwait day the charge was made and converted at the cockpit's fixed rates (1 KWD reads as $${USD_PER.KWD}), the same rates ad spend uses. Tap refunds are not read yet, so Tap refunds show n/a and Tap cash, like the rails total, is gross of anything refunded on Tap, while Whop is net.`,
        });
        if (read.unconverted.length)
          notes.push({
            level: "warn",
            text: `Tap charges in ${read.unconverted
              .map(u => `${u.currency} (${u.count})`)
              .join(
                ", ",
              )} are left out of Tap cash: the cockpit has no fixed rate for ${read.unconverted.length === 1 ? "that currency" : "those currencies"} and a guessed rate would be a made up number.`,
          });
        if (read.testRows > 0)
          notes.push({
            level: "warn",
            text: `${read.testRows} Tap charges are marked as test mode and are left out, because test charges are not cash.`,
          });
        if (read.undated > 0)
          notes.push({
            level: "warn",
            text: `${read.undated} Tap charges carry no time and could not be placed on a day, so they are left out of Tap cash.`,
          });
        if (read.truncated)
          notes.push({
            level: "warn",
            text: "The Tap read stopped early on its page or time limit, so Tap cash is a floor and reads low.",
          });
      } catch (e) {
        sources.push({
          name: "Tap payments",
          ok: false,
          note: errText(e),
        });
        notes.push({
          level: "warn",
          text: "Tap could not be read this run, so every Tap number is n/a and Tap money is not in the total. The Machine tab carries the error.",
        });
      }
    }

    // --- The Manual rail: payments Aziz logs by hand on the Money tab
    // (ceoManualPayments). Not connected until at least one live entry exists,
    // so an empty log reads as n/a, never as $0 of bank transfers.
    const manualRail: CashRail = {
      label: "Manual",
      connected: false,
      today: null,
      yesterday: null,
      mtd: null,
      lastMonthToDate: null,
      lastMonth: null,
      projectedMonth: null,
      // Never logged by hand: a refunded entry is removed instead.
      refundsMtd: null,
      daily: [],
      lastPaymentAt: null,
    };
    let manualEntries: ManualPaymentRow[] | undefined;
    let possibleDuplicates: PossibleDuplicate[] | undefined;
    let manualByMonth: Map<
      string,
      { cash: number; contracted: number }
    > | null = null;
    let dealsChecked = false;

    let manual: ManualLoad | null = null;
    try {
      manual = await ctx.runQuery(internal.ceo.data.money.load, {
        from: firstMonthStart,
        month,
      });
    } catch (e) {
      sources.push({ name: "Manual entries", ok: false, note: errText(e) });
      notes.push({
        level: "warn",
        text: "Payments logged by hand could not be read this run, so the Manual rail is n/a and not in the total.",
      });
    }

    if (manual) {
      const entries: ManualRow[] = manual.live;
      const book = nameBook(manual.cards);
      const sumUsd = (rows: ManualRow[], pick: (e: ManualRow) => number) =>
        usd(rows.reduce((t, e) => t + pick(e), 0));
      const firstDay = (rows: ManualRow[]) =>
        rows.reduce((m, e) => (e.day < m ? e.day : m), today);

      // A payment logged as Tap before Tap was connected drops out once a
      // Tap charge shows the same money, so it counts once, on the Tap rail.
      const tapFrom = addDays(from90, -MATCH_DAYS);
      const covered = tapCharges
        ? coverWithTap(entries, tapCharges, tapFrom)
        : new Map<string, TapCover>();
      const counted = entries.filter(e => !covered.has(e.id));

      // Cash that Whop may already have: live entries of the last 90 days.
      const recent = counted.filter(e => e.day >= from90);
      let whopRows: WhopLike[] = [];
      if (recent.length)
        try {
          // Billing name and username are read only to match on; the screen
          // is shown the linked deal's business name or nothing.
          const rows = await sql(
            B2B,
            `select to_char(w.paid_on, 'YYYY-MM-DD') as day,
                    w.net_amount as usd,
                    left(nullif(btrim(d.business_name), ''), 80) as business,
                    left(nullif(btrim(w.billing_name), ''), 120) as billing,
                    left(nullif(btrim(w.user_username), ''), 120) as username
             from public.whop_payments w
             left join public.closed_deals d on d.response_id = w.deal_response_id
             where w.status = 'paid' and w.currency = 'usd' and w.net_amount > 0
               and w.paid_on between ${day(addDays(firstDay(recent), -MATCH_DAYS))} and ${day(today)}`,
          );
          whopRows = rows.map(r => ({
            day: String(r.day),
            usd: usd(num(r.usd)),
            business: r.business ? String(r.business) : null,
            matchNames: [r.billing, r.username]
              .filter(x => x !== null && x !== undefined && x !== "")
              .map(String),
          }));
        } catch (e) {
          sources.push({
            name: "Whop payments (duplicate check)",
            ok: false,
            note: errText(e),
          });
          notes.push({
            level: "warn",
            text: "Whop payments could not be read for the duplicate check, so a payment logged by hand that Whop also has is not flagged this run.",
          });
        }

      // Deal values the closer form may already count. Only form deals with
      // a contracted value: a form deal worth nothing cannot count twice.
      const dealEntries = entries.filter(e => e.dealContractedUsd !== null);
      let dealRows: DealLike[] = [];
      if (!dealEntries.length) dealsChecked = true;
      else
        try {
          const first = firstDay(dealEntries);
          const lookFrom = [
            monthStart(first),
            addDays(first, -MATCH_DAYS),
          ].sort()[0];
          const rows = await sql(
            B2B,
            `select to_char((submitted_at at time zone 'Asia/Kuwait')::date, 'YYYY-MM-DD') as day,
                    left(btrim(business_name), 80) as business,
                    contracted_revenue as contracted
             from public.closed_deals
             where contracted_revenue is not null
               and nullif(btrim(business_name), '') is not null
               and (submitted_at at time zone 'Asia/Kuwait')::date between ${day(lookFrom)} and ${day(today)}`,
          );
          dealRows = rows.map(r => ({
            day: String(r.day),
            usd: usd(num(r.contracted)),
            business: String(r.business),
          }));
          dealsChecked = true;
        } catch (e) {
          sources.push({
            name: "Closer form deals (deal check)",
            ok: false,
            note: errText(e),
          });
          notes.push({
            level: "warn",
            text: "Closer form deals could not be read for the deal check, so deal values logged by hand are n/a this run rather than risk counting a deal twice.",
          });
        }

      const dupes = [
        ...cashDuplicates(recent, whopRows, tapCharges, book),
        ...(dealsChecked ? dealDuplicates(dealEntries, dealRows, book) : []),
      ].sort((a, b) =>
        a.manualDay === b.manualDay ? 0 : a.manualDay < b.manualDay ? 1 : -1,
      );
      possibleDuplicates = dupes;
      const flagged = new Set(dupes.map(d => d.manualId));
      const dealFlagged = new Set(
        dupes.filter(d => d.against === "closer_form").map(d => d.manualId),
      );
      const dealCounted = dealEntries.filter(e => !dealFlagged.has(e.id));

      // The rail itself, from counted entries on their own day.
      if (manual.anyLive) {
        const between = (from: string, to: string) =>
          sumUsd(
            counted.filter(e => e.day >= from && e.day <= to),
            e => e.amountUsd,
          );
        const byManualDay = new Map<string, number>();
        for (const e of recent)
          byManualDay.set(e.day, (byManualDay.get(e.day) ?? 0) + e.amountUsd);
        const manualDaily: Point[] = [];
        for (let d = from90; d <= today; d = addDays(d, 1))
          manualDaily.push({ date: d, value: usd(byManualDay.get(d) ?? 0) });
        const manualMtd = between(monthStart(today), today);
        const newestDay = counted.reduce<string | null>(
          (m, e) => (m === null || e.day > m ? e.day : m),
          null,
        );
        manualRail.connected = true;
        manualRail.today = between(today, today);
        manualRail.yesterday = between(addDays(today, -1), addDays(today, -1));
        manualRail.mtd = manualMtd;
        manualRail.lastMonthToDate = between(
          lastMonthStart,
          lastMonthToDateEnd,
        );
        manualRail.lastMonth = between(lastMonthStart, lastMonthEnd);
        manualRail.projectedMonth = usd((manualMtd / dayOfMonth) * dim);
        manualRail.daily = manualDaily;
        manualRail.lastPaymentAt = newestDay ? kuwaitMidnight(newestDay) : null;
      }

      manualByMonth = new Map();
      const monthOf = (m: string) => {
        const row = manualByMonth?.get(m) ?? { cash: 0, contracted: 0 };
        manualByMonth?.set(m, row);
        return row;
      };
      for (const e of counted) monthOf(e.day.slice(0, 7)).cash += e.amountUsd;
      for (const e of dealCounted)
        monthOf(e.day.slice(0, 7)).contracted += e.dealContractedUsd ?? 0;

      if (dealsChecked) {
        const inMonth = (m: string) =>
          dealCounted.filter(e => e.day.slice(0, 7) === m);
        deals.manualMtd = inMonth(month).length;
        deals.manualContractedMtd = sumUsd(
          inMonth(month),
          e => e.dealContractedUsd ?? 0,
        );
        deals.manualContractedLastMonth = sumUsd(
          inMonth(lastMonth),
          e => e.dealContractedUsd ?? 0,
        );
      }

      manualEntries = [
        ...entries.filter(e => e.day.slice(0, 7) === month),
        ...manual.removedThisMonth,
      ]
        .sort(byNewest)
        .map(e => ({
          id: e.id,
          day: e.day,
          amount: e.amount,
          currency: e.currency,
          amountUsd: e.amountUsd,
          client: e.client,
          clickupTaskId: e.clickupTaskId,
          rail: e.rail,
          dealContracted: e.dealContracted,
          dealContractedUsd: e.dealContractedUsd,
          note: e.note,
          addedBy: e.addedBy,
          addedAt: e.addedAt,
          deletedAt: e.deletedAt,
          deletedBy: e.deletedBy,
          possibleDuplicate: e.deletedAt === null && flagged.has(e.id),
          coveredByTap: covered.get(e.id) ?? null,
        }));

      sources.push({
        name: "Manual entries",
        freshestAt: manual.newestChangeAt ?? undefined,
        ok: !manual.truncated,
        note: `${payments(entries.length)} logged by hand in the last 12 months${
          covered.size ? `, ${covered.size} now counted on Tap` : ""
        }`,
      });

      // Notes, one per point.
      if (manual.truncated)
        notes.push({
          level: "warn",
          text: "More payments are logged by hand than one run reads, so the Manual rail reads low.",
        });
      if (manualRail.connected)
        notes.push({
          level: "info",
          text: `Payments logged by hand are only what was typed in on the Money tab, so a transfer, cheque or cash payment nobody logged is missing, not zero. Each is converted to USD at the fixed rate stored on it when it was logged (1 KWD reads as $${USD_PER.KWD} today), and a refund of a hand-logged payment is recorded by removing the entry.`,
        });
      const tapEntries = entries.filter(e => e.rail === "tap");
      if (!tapCharges && tapEntries.length)
        notes.push({
          level: "info",
          text: `${payments(tapEntries.length)} logged by hand as Tap (${usdWords(sumUsd(tapEntries, e => e.amountUsd))}) ${says(tapEntries.length, "counts", "count")} on the Manual rail while Tap is not read. Once Tap is connected, a hand-logged Tap payment that a Tap charge matches, at most ${MATCH_DAYS} days apart and within 5%, drops out by itself so it is never counted twice.`,
        });
      if (tapCharges) {
        const nowOnTap = tapEntries.filter(e => covered.has(e.id));
        if (nowOnTap.length)
          notes.push({
            level: "info",
            text: `${payments(nowOnTap.length)} logged by hand as Tap (${usdWords(sumUsd(nowOnTap, e => e.amountUsd))}) now ${says(nowOnTap.length, "shows as a Tap charge, so it was", "show as Tap charges, so they were")} dropped from the Manual rail and the money counts once, on the Tap rail.`,
          });
        const unmatched = tapEntries.filter(
          e => !covered.has(e.id) && e.day >= tapFrom,
        );
        if (unmatched.length)
          notes.push({
            level: "warn",
            text: `${payments(unmatched.length)} logged by hand as Tap (${usdWords(sumUsd(unmatched, e => e.amountUsd))}) ${says(unmatched.length, "matches", "match")} no Tap charge within ${MATCH_DAYS} days and 5%, so ${says(unmatched.length, "it still counts", "they still count")} on the Manual rail. Check against Tap and remove any that Tap already has.`,
          });
      }
      const cashFlagged = counted.filter(e =>
        dupes.some(d => d.manualId === e.id && d.against !== "closer_form"),
      );
      if (cashFlagged.length)
        notes.push({
          level: "warn",
          text: `${payments(cashFlagged.length)} logged by hand (${usdWords(sumUsd(cashFlagged, e => e.amountUsd))}) ${says(cashFlagged.length, "looks like money Whop or Tap already counts. It stays", "look like money Whop or Tap already counts. They stay")} in every total until removed, so check the possible duplicates.`,
        });
      const dealDupes = dealEntries.filter(e => dealFlagged.has(e.id));
      if (dealDupes.length)
        notes.push({
          level: "warn",
          text: `${dealDupes.length === 1 ? "1 deal value" : `${dealDupes.length} deal values`} logged by hand (${usdWords(sumUsd(dealDupes, e => e.dealContractedUsd ?? 0))}) ${says(dealDupes.length, "matches a closer form deal for the same client, so it is", "match a closer form deal for the same client, so they are")} left out of contracted and the closer form figure stands. See the possible duplicates.`,
        });
    }

    // --- The total covers the connected rails only, and a total over a
    // number no rail can give stays null rather than quietly dropping to 0.
    const connected = [whopRail, tapRail, manualRail].filter(r => r.connected);
    const railSum = (
      rails: CashRail[],
      pick: (r: CashRail) => number | null,
    ): number | null => {
      if (!rails.length) return null;
      let t = 0;
      for (const r of rails) {
        const v = pick(r);
        if (v === null) return null;
        t += v;
      }
      return usd(t);
    };
    const railMaps = connected.map(
      r => new Map(r.daily.map(p => [p.date, p.value])),
    );
    const totalDaily: Point[] = [];
    for (let d = from90; d <= today; d = addDays(d, 1)) {
      let t = 0;
      for (const m of railMaps) t += m.get(d) ?? 0;
      totalDaily.push({ date: d, value: usd(t) });
    }

    // The one note about what cash covers. The Whop only warning goes as soon
    // as a second rail is in the total. It never says "nothing was logged" or
    // "log Tap by hand" when that is not true: a failed read of the hand log
    // is not an empty log, and with a live Tap key a hand-logged Tap payment
    // is refused, so the scope note never asks for one. A Tap read that failed
    // this run has its own note above.
    const handWords =
      tapState === "live"
        ? "Bank transfers, cheques and cash count only once they are logged by hand on the Money tab"
        : "Bank transfers, cheques, cash and, until Tap is connected, Tap payments count only once they are logged by hand on the Money tab";
    if (!tapRail.connected && !manualRail.connected) {
      cashScopeNote.level = "warn";
      cashScopeNote.text =
        manual === null
          ? `Cash is Whop only this run: the payments logged by hand could not be read and no other rail is in the total, so bank transfers, cheques, cash and Tap money are missing from every cash figure, not zero. Processor fees are not taken off.`
          : `Cash is Whop only: no other rail is in the total and no payment has been logged by hand, so bank transfers, cheques, cash and Tap money are missing from every cash figure, not zero. Processor fees are not taken off.`;
    } else {
      cashScopeNote.level = "info";
      cashScopeNote.text = !manualRail.connected
        ? manual === null
          ? "Cash on the rails covers Whop and Tap this run: the payments logged by hand could not be read, so bank transfers, cheques and cash are missing from it, not zero. Processor fees are not taken off."
          : `Cash on the rails covers Whop and Tap. ${handWords}, and processor fees are not taken off.`
        : tapRail.connected
          ? `Cash on the rails covers Whop, Tap and payments logged by hand. ${handWords}, and processor fees are not taken off.`
          : `Cash on the rails covers Whop and payments logged by hand. ${handWords}, and processor fees are not taken off.`;
    }

    const lastPayments = connected
      .map(r => r.lastPaymentAt)
      .filter((x): x is number => x !== null);
    const totalRail: CashRail = {
      label: connected.length > 1 ? "All rails" : "All rails (Whop only)",
      connected: connected.length > 0,
      today: railSum(connected, r => r.today),
      yesterday: railSum(connected, r => r.yesterday),
      mtd: railSum(connected, r => r.mtd),
      lastMonthToDate: railSum(connected, r => r.lastMonthToDate),
      lastMonth: railSum(connected, r => r.lastMonth),
      projectedMonth: railSum(connected, r => r.projectedMonth),
      // Hand-logged money has no refunds to add: a refunded entry is removed.
      refundsMtd: railSum(
        connected.filter(r => r !== manualRail),
        r => r.refundsMtd,
      ),
      daily: totalDaily,
      lastPaymentAt: lastPayments.length ? Math.max(...lastPayments) : null,
    };

    // --- The MRR field on the ClickUp client cards ---------------------
    // Read for the first time on 2026-09-18. Nothing in the cockpit had ever
    // read it, so the money a client is on record as paying every month was
    // written on 20-odd cards and shown on no screen.
    let mrr: MoneyPayload["mrr"];
    const mrrDaily: DailyPoint[] = [];
    try {
      const rows: BillingRow[] = await ctx.runQuery(
        internal.ceo.billing.allBilling,
        {},
      );
      const b = summariseBilling(rows);
      if (b.cards === 0) {
        notes.push({
          level: "warn",
          text: "The client cards' billing fields have not been read yet, so MRR is missing, not zero. They are written by the CSM sync, which runs every 10 minutes through the working day.",
        });
      } else {
        mrr = {
          groups: (
            ["active", "paused", "pipeline", "sales", "gone"] as const
          ).map(group => ({ group, ...b.mrr[group] })),
          blank: b.mrrBlank.map(r => ({ ...r, stage: r.stage ?? null })),
          ltv: b.ltv,
          paymentMethod: b.paymentMethod,
          lifecycle: b.lifecycle,
          cards: b.cards,
          internalCards: b.internalCards,
          syncedAt: b.syncedAt,
        };

        const live = LIVE_GROUPS.map(g => b.mrr[g]);
        const liveRecurring = usd(live.reduce((t, g) => t + g.recurringUsd, 0));
        const liveOneOff = usd(live.reduce((t, g) => t + g.oneOffUsd, 0));
        const liveUnclassified = usd(
          live.reduce((t, g) => t + g.unclassifiedUsd, 0),
        );

        notes.push({
          level: "info",
          text: `MRR is the figure typed in the MRR field on each ClickUp client card, not a measured charge. Cards are grouped by their Client Status and never added together, because who counts as a paying client is not settled. Active ${usdWords(b.mrr.active.bookUsd)} over ${b.mrr.active.filled} of ${b.mrr.active.cards} cards, paused ${usdWords(b.mrr.paused.bookUsd)} over ${b.mrr.paused.filled} of ${b.mrr.paused.cards}, not yet live ${usdWords(b.mrr.pipeline.bookUsd)} over ${b.mrr.pipeline.filled} of ${b.mrr.pipeline.cards}. The ${b.mrr.sales.cards} cards parked on the sales list are counted apart, because they are not clients yet${b.internalCards ? `, as are ${b.internalCards} of Mahara's own cards` : ""}.`,
        });
        if (liveOneOff > 0 || liveUnclassified > 0)
          notes.push({
            level: "warn",
            text: `Not all of it is monthly money. Of the live cards, ${usdWords(liveRecurring)} sits on a recurring plan, ${usdWords(liveOneOff)} on Paid In Full or Split Pay, which is a share of a one-off contract, and ${usdWords(liveUnclassified)} on cards with no Payment Plan at all. How a one-off contract converts to MRR is undecided, so the three are never added into one figure here.`,
          });
        if (b.mrrBlank.length)
          notes.push({
            level: "warn",
            text: `${b.mrrBlank.length} ${says(b.mrrBlank.length, "live client card carries", "live client cards carry")} no MRR figure, so ${b.mrrBlank.length === 1 ? "its" : "their"} money is missing from every total, not zero: ${b.mrrBlank
              .slice(0, 8)
              .map(r => r.name)
              .join(
                ", ",
              )}${b.mrrBlank.length > 8 ? ` and ${b.mrrBlank.length - 8} more` : ""}.`,
          });
        if (b.paymentMethod.filled === 0)
          notes.push({
            level: "warn",
            text: `Payment Method is filled on none of the ${b.cards} client cards, so there is no way to tell which clients pay off Whop. That single field is the cheapest fix for the cash rails: one dropdown per client.`,
          });
        if (b.lifecycle.gone > b.lifecycle.goneWithChurnDate)
          notes.push({
            level: "warn",
            text: `${b.lifecycle.gone - b.lifecycle.goneWithChurnDate} of ${b.lifecycle.gone} stopped or cancelled clients have no Churn Date, and ${b.lifecycle.gone - b.lifecycle.goneWithChurnReason} have no Churn Reason. Tenure, average client life and any cohort view stay uncomputable until those cells are filled.`,
          });
        if (b.lifecycle.paused > b.lifecycle.pausedWithDate)
          notes.push({
            level: "warn",
            text: `${b.lifecycle.paused - b.lifecycle.pausedWithDate} of ${b.lifecycle.paused} paused clients have no Paused On date, so the 14-day pause clock is not running on ${b.lifecycle.paused - b.lifecycle.pausedWithDate === 1 ? "that one" : "them"}.`,
          });

        // History starts the first day this runs. ClickUp keeps none of its
        // own, so a month-on-month MRR comparison is only possible from the
        // day these points begin: today.
        const point = (metric: string, value: number): DailyPoint => ({
          date: today,
          metric,
          scope: "company",
          value,
        });
        mrrDaily.push(
          point("money.mrr.activeBook", b.mrr.active.bookUsd),
          point("money.mrr.activeRecurring", b.mrr.active.recurringUsd),
          point("money.mrr.pausedBook", b.mrr.paused.bookUsd),
          point("money.mrr.pipelineBook", b.mrr.pipeline.bookUsd),
          point("money.mrr.liveRecurring", liveRecurring),
          point(
            "money.mrr.liveFilled",
            live.reduce((t, g) => t + g.filled, 0),
          ),
          point("money.mrr.liveBlank", b.mrrBlank.length),
          point("money.ltv.fieldTotal", b.ltv.totalUsd),
        );
        // Each card's own MRR and payment plan, so a client's money has a past
        // even after somebody retypes the field or the card leaves the list.
        for (const r of rows) {
          if (typeof r.mrrUsd !== "number") continue;
          mrrDaily.push({
            date: today,
            metric: "money.mrr.card",
            scope: `client:${r.taskId}`,
            value: r.mrrUsd,
          });
        }
      }
    } catch (e) {
      notes.push({
        level: "warn",
        text: `The client cards' MRR could not be read this run (${String(e).slice(0, 160)}).`,
      });
    }

    const byMonth = manualByMonth;
    const payload = {
      month,
      dayOfMonth,
      daysInMonth: dim,
      cash,
      rails: {
        whop: whopRail,
        tap: tapRail,
        // Left off when the hand log could not be read, so the screen says
        // "not read" rather than "nothing logged".
        ...(manual ? { manual: manualRail } : {}),
        total: totalRail,
      },
      manualEntries,
      possibleDuplicates,
      monthly: byMonth
        ? monthly.map(r => ({
            ...r,
            manualCash: usd(byMonth.get(r.month)?.cash ?? 0),
            ...(dealsChecked
              ? { manualContracted: usd(byMonth.get(r.month)?.contracted ?? 0) }
              : {}),
          }))
        : monthly,
      refunds: {
        mtd: refundsMtd,
        last90: usd(num(s.refunds_90)),
      },
      deals,
      failedCharges: { count30d: failedCount, amount30d: failedAmount },
      expenses,
      targets,
      // Left off when the cards could not be read, so the screen says "not
      // read" rather than showing a book of zero.
      ...(mrr ? { mrr } : {}),
      notes,
    } satisfies MoneyPayload;

    // Whop rewrites open charges when a retry succeeds, so today's open count
    // cannot be rebuilt later: keep it as history.
    const daily: DailyPoint[] = [
      {
        date: today,
        metric: "money.failedCharges.count30d",
        scope: "company",
        value: failedCount,
      },
      {
        date: today,
        metric: "money.failedCharges.amount30d",
        scope: "company",
        value: failedAmount,
      },
      ...mrrDaily,
    ];

    return { payload, daily, sources };
  },
};
