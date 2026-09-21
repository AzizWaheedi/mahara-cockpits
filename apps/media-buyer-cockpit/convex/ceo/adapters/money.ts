import { internal } from "../../_generated/api";
import {
  type Attributed,
  attribute,
  totals as attributionTotals,
  byPerson,
  type CardRef,
  type DealRef,
  FRONT_END_DAYS,
  FRONT_END_DAYS_MONTHLY,
  type PaymentIn,
} from "../attribution";
import { type BillingRow, LIVE_GROUPS, summariseBilling } from "../billing";
import { KIND_LABEL, type LineKind, matchPayouts } from "../bank";
import { byNewest, type ManualLoad, type ManualRow } from "../data/money";
import {
  capturedCharges,
  TAP_CONNECT_COMMAND,
  TAP_KEY_NAME,
  type TapCharge,
  tapKeyState,
  USD_PER,
} from "../data/tap";
import { type BillingRow as BillingRowType, groupOf, isOneOffPlan } from "../billing";
import {
  amountGap,
  cashDuplicates,
  coverWithTap,
  dayGap,
  type DealLike,
  dealDuplicates,
  MATCH_DAYS,
  MATCH_GAP,
  nameBook,
  type TapCover,
  usdWords,
  type WhopLike,
} from "../manualMatch";
import { sbWritable, upsertMerge } from "../sbWrite";
import type {
  CashRail,
  ManualPaymentRow,
  MoneyPayload,
  Note,
  Point,
  PossibleDuplicate,
  Transaction,
} from "../payloads";
import { B2B, num, type Row, sql, TRIAGE } from "../sb";
import {
  addDays,
  daysInMonth,
  KUWAIT_OFFSET_MS,
  kuwaitDay,
  monthStart,
} from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";
import { IS_LEAD } from "./growth";

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

/** Run a secondary read; on failure keep going with a fallback and a warning. */
async function attempt<T>(
  what: string,
  notes: Note[],
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    notes.push({
      level: "warn",
      text: `${what} could not be read this run (${errText(e)}).`,
    });
    return fallback;
  }
}

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
    // The daily series and the Tap read cover 180 days so a chart can show
    // six months; the "90 days" figures (refunds, average contract) keep to 90.
    const from180 = addDays(today, -179);
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
         and paid_on between ${day(from180)} and ${day(today)}
       group by paid_on`,
    );
    const byDay = new Map(cashRows.map(r => [String(r.day), num(r.cash)]));
    const cashDaily: Point[] = [];
    for (let d = from180; d <= today; d = addDays(d, 1))
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
             where jsonb_typeof(m.value) = 'number'`,
          );
          for (const r of got)
            if (!(String(r.metric) in actuals))
              actuals[String(r.metric)] = num(r.actual);
          // Leads on this cockpit are the ROAS-tagged contacts (growth.ts),
          // not the dashboard's is_lead flag, so the three lead actuals are
          // recomputed on that rule from the dashboard's own spend and demos.
          const [roas] = await sql(
            B2B,
            `select count(*) as leads from public.leads l
             where ${IS_LEAD}
               and (l.lead_created_at at time zone 'Asia/Riyadh')::date
                   between ${day(monthStart(today))} and ${day(today)}`,
          );
          const leads = num(roas?.leads);
          actuals.leads = leads;
          actuals.cost_per_lead = leads > 0 ? (actuals.spend ?? 0) / leads : 0;
          actuals.lead_to_demo =
            leads > 0 ? (100 * (actuals.demos_scheduled ?? 0)) / leads : 0;
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
        const read = await capturedCharges(from180, today);
        tapCharges = read.charges;
        const byTapDay = new Map<string, number>();
        for (const c of read.charges)
          if (c.usd !== null)
            byTapDay.set(c.day, (byTapDay.get(c.day) ?? 0) + c.usd);
        const tapDaily: Point[] = [];
        for (let d = from180; d <= today; d = addDays(d, 1))
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

    // --- The Bank rail: the statements Aziz uploads (cockpit_bank_lines,
    // 2026-09-21). Client payments on them are cash; Whop payouts, Tap
    // settlements and Mahara's own transfers are dropped, so nothing is
    // counted twice; the debits are the expenses, personal exclusions apart.
    type BankLine = {
      id: number;
      day: string;
      usd: number;
      amount: number;
      currency: string;
      reference: string;
      account: string;
      kind: LineKind;
      category: string | null;
      note: string | null;
    };
    let bankLines: BankLine[] = [];
    let bankStatements: NonNullable<MoneyPayload["bank"]>["statements"] = [];
    let bankExclusions: NonNullable<MoneyPayload["bank"]>["exclusions"] = [];
    let bankRead = false;
    try {
      const [lineRows, stmtRows, exRows] = await Promise.all([
        sql(
          TRIAGE,
          `select id, to_char(day, 'YYYY-MM-DD') as day, usd, amount, currency, reference, account, kind, category, note
           from public.cockpit_bank_lines
           where day >= ${day(firstMonthStart)}
           order by day, id`,
        ),
        sql(
          TRIAGE,
          `select id, account, account_kind, to_char(from_day, 'YYYY-MM-DD') as from_day,
                  to_char(to_day, 'YYYY-MM-DD') as to_day, lines,
                  floor(extract(epoch from imported_at) * 1000) as imported_ms
           from public.cockpit_statements
           order by to_day desc nulls last, imported_at desc
           limit 36`,
        ),
        sql(
          TRIAGE,
          `select id, kind, pattern, note from public.cockpit_expense_exclusions order by id`,
        ),
      ]);
      bankLines = lineRows.map(r => ({
        id: num(r.id),
        day: String(r.day),
        usd: usd(num(r.usd)),
        amount: num(r.amount),
        currency: String(r.currency ?? "KWD"),
        reference: String(r.reference ?? ""),
        account: String(r.account ?? ""),
        kind: String(r.kind ?? "unknown") as LineKind,
        category: r.category ? String(r.category) : null,
        note: r.note ? String(r.note) : null,
      }));
      bankStatements = stmtRows.map(r => ({
        id: String(r.id),
        account: String(r.account),
        accountKind: String(r.account_kind ?? "account"),
        fromDay: r.from_day ? String(r.from_day) : null,
        toDay: r.to_day ? String(r.to_day) : null,
        lines: num(r.lines),
        importedAt: epoch(r.imported_ms) ?? null,
      }));
      bankExclusions = exRows.map(r => ({
        id: num(r.id),
        kind: r.kind === "card" ? ("card" as const) : ("vendor" as const),
        pattern: String(r.pattern ?? ""),
        note: r.note ? String(r.note) : null,
      }));
      bankRead = true;
      sources.push({
        name: "Bank statements",
        freshestAt: bankStatements[0]?.importedAt ?? undefined,
        ok: true,
        note: `${bankStatements.length} statement${bankStatements.length === 1 ? "" : "s"}, ${bankLines.length} lines in 12 months`,
      });
    } catch (e) {
      sources.push({ name: "Bank statements", ok: false, note: errText(e) });
      notes.push({
        level: "warn",
        text: "The uploaded bank statements could not be read this run, so the Bank rail is n/a and not in the total.",
      });
    }

    // Whop payouts on the statements against the Whop payments they carry,
    // and Tap settlements against Tap charges: neither is cash here, the
    // payments behind them already are, on their own rail.
    const whopPaymentsForPayouts = await attempt(
      "Whop payments for the payout match",
      notes,
      [] as { id: string; day: string; usd: number }[],
      async () =>
        bankLines.some(l => l.kind === "whop_payout")
          ? (
              await sql(
                B2B,
                `select payment_id, to_char(paid_on, 'YYYY-MM-DD') as day, net_amount
                 from public.whop_payments
                 where status = 'paid' and currency = 'usd' and net_amount > 0
                   and paid_on >= ${day(addDays(firstMonthStart, -30))}`,
              )
            ).map(r => ({
              id: String(r.payment_id),
              day: String(r.day),
              usd: usd(num(r.net_amount)),
            }))
          : [],
    );
    const payoutLines = bankLines.filter(l => l.kind === "whop_payout");
    const payoutMatches = matchPayouts(
      payoutLines.map(l => ({ id: String(l.id), day: l.day, usd: l.usd })),
      whopPaymentsForPayouts,
    );
    const settlementLines = bankLines.filter(l => l.kind === "tap_settlement");
    const settlementMatches = matchPayouts(
      settlementLines.map(l => ({ id: String(l.id), day: l.day, usd: l.usd })),
      (tapCharges ?? [])
        .filter(c => c.usd !== null)
        .map(c => ({ id: c.id, day: c.day, usd: c.usd as number })),
      { lookback: 10, tolerance: 0.05 },
    );
    // Tap charges a settlement line accounts for count on the bank line, not twice.
    const tapCoveredIds = new Set<string>();
    if (tapCharges && settlementMatches.size) {
      const sorted = [...tapCharges]
        .filter(c => c.usd !== null)
        .sort((a, b) => (a.day < b.day ? -1 : 1));
      for (const [lineId, m] of settlementMatches) {
        const line = settlementLines.find(l => String(l.id) === lineId);
        if (!line) continue;
        let left = m.count;
        for (const c of sorted)
          if (left > 0 && c.day >= m.from && c.day <= m.to && !tapCoveredIds.has(c.id)) {
            tapCoveredIds.add(c.id);
            left -= 1;
          }
      }
      if (tapCoveredIds.size) {
        const covered = usd(
          (tapCharges ?? [])
            .filter(c => tapCoveredIds.has(c.id) && c.usd !== null)
            .reduce((t, c) => t + (c.usd as number), 0),
        );
        const drop = (rail: CashRail) => {
          const byDay = new Map<string, number>();
          for (const c of tapCharges ?? [])
            if (tapCoveredIds.has(c.id) && c.usd !== null)
              byDay.set(c.day, (byDay.get(c.day) ?? 0) + (c.usd as number));
          rail.daily = rail.daily.map(p => ({
            date: p.date,
            value: usd(p.value - (byDay.get(p.date) ?? 0)),
          }));
          const between = (f: string, t: string) =>
            usd(rail.daily.filter(p => p.date >= f && p.date <= t).reduce((x, p) => x + p.value, 0));
          rail.today = between(today, today);
          rail.yesterday = between(addDays(today, -1), addDays(today, -1));
          rail.mtd = between(monthStart(today), today);
          rail.lastMonthToDate = between(lastMonthStart, lastMonthToDateEnd);
          rail.lastMonth = between(lastMonthStart, lastMonthEnd);
          rail.projectedMonth = usd(((rail.mtd ?? 0) / dayOfMonth) * dim);
        };
        if (tapRail.connected) drop(tapRail);
        notes.push({
          level: "info",
          text: `${tapCoveredIds.size} Tap charges (${usdWords(covered)}) are covered by ${settlementMatches.size} Tap settlement line${settlementMatches.size === 1 ? "" : "s"} on the bank statements, so they count once, on the Bank rail, with Tap as the confirmation.`,
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
    /** The hand-logged entries that count (not covered by a Tap charge or a statement line), for the attribution below. */
    let manualCounted: ManualRow[] = [];
    /** Refunds logged by hand, for the refunds figures and the Transactions tab. */
    let manualRefunds: ManualRow[] = [];
    let manualCoveredByBank = 0;
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
      // Refunds logged by hand are money given back: they come off the
      // manual rail on their day and are counted among refunds, never as cash.
      const refundEntries: ManualRow[] = manual.live.filter(e => e.kind === "refund");
      manualRefunds = refundEntries;
      const entries: ManualRow[] = manual.live.filter(e => e.kind !== "refund");
      const book = nameBook(manual.cards);
      const sumUsd = (rows: ManualRow[], pick: (e: ManualRow) => number) =>
        usd(rows.reduce((t, e) => t + pick(e), 0));
      const firstDay = (rows: ManualRow[]) =>
        rows.reduce((m, e) => (e.day < m ? e.day : m), today);

      // A payment logged as Tap before Tap was connected drops out once a
      // Tap charge shows the same money, so it counts once, on the Tap rail.
      const tapFrom = addDays(from180, -MATCH_DAYS);
      const covered = tapCharges
        ? coverWithTap(entries, tapCharges, tapFrom)
        : new Map<string, TapCover>();
      // A bank transfer, cheque or cash payment logged by hand drops out once
      // a statement line shows the same money: it counts once, on the Bank rail.
      const bankClientLines = bankLines.filter(l => l.kind === "client_payment");
      const usedBankLine = new Set<number>();
      for (const e of entries) {
        if (covered.has(e.id) || e.rail === "tap") continue;
        let best: { id: number; d: number; g: number } | null = null;
        for (const l of bankClientLines) {
          if (usedBankLine.has(l.id)) continue;
          const d = dayGap(e.day, l.day);
          if (d > MATCH_DAYS) continue;
          const g = amountGap(e.amountUsd, l.usd);
          if (g > MATCH_GAP) continue;
          if (!best || d < best.d || (d === best.d && g < best.g)) best = { id: l.id, d, g };
        }
        if (best) {
          usedBankLine.add(best.id);
          const line = bankClientLines.find(l => l.id === best?.id);
          covered.set(e.id, { chargeDay: line?.day ?? e.day, chargeUsd: line?.usd ?? e.amountUsd });
          manualCoveredByBank += 1;
        }
      }
      const counted = entries.filter(e => !covered.has(e.id));
      manualCounted = counted;

      // Cash that Whop may already have: live entries of the last 90 days.
      const recent = counted.filter(e => e.day >= from180);
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
        for (let d = from180; d <= today; d = addDays(d, 1))
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
          text: `Payments logged by hand are only what was typed in on the Money tab, so a transfer, cheque or cash payment nobody logged is missing, not zero. Each is converted to USD at the fixed rate stored on it when it was logged (1 KWD reads as $${USD_PER.KWD} today). A refund is logged as an entry of its own kind and comes off cash on its day.${manualCoveredByBank ? ` ${manualCoveredByBank} hand-logged payment${manualCoveredByBank === 1 ? "" : "s"} now show on an uploaded statement and count once, on the Bank rail.` : ""}`,
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

    // --- The Bank rail itself: client payments on the statements, by day.
    const bankRail: CashRail = {
      label: "Bank",
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
    if (bankRead && bankStatements.length) {
      const byBankDay = new Map<string, number>();
      for (const l of bankLines)
        if (l.kind === "client_payment")
          byBankDay.set(l.day, (byBankDay.get(l.day) ?? 0) + l.usd);
      const bankDaily: Point[] = [];
      for (let d = from180; d <= today; d = addDays(d, 1))
        bankDaily.push({ date: d, value: usd(byBankDay.get(d) ?? 0) });
      const bankBetween = (f: string, t: string) =>
        usd(bankDaily.filter(p => p.date >= f && p.date <= t).reduce((x, p) => x + p.value, 0));
      const bankMtd = bankBetween(monthStart(today), today);
      const newestClient = bankLines
        .filter(l => l.kind === "client_payment")
        .reduce<string | null>((m, l) => (m === null || l.day > m ? l.day : m), null);
      bankRail.connected = true;
      bankRail.today = bankBetween(today, today);
      bankRail.yesterday = bankBetween(addDays(today, -1), addDays(today, -1));
      bankRail.mtd = bankMtd;
      bankRail.lastMonthToDate = bankBetween(lastMonthStart, lastMonthToDateEnd);
      bankRail.lastMonth = bankBetween(lastMonthStart, lastMonthEnd);
      bankRail.projectedMonth = usd((bankMtd / dayOfMonth) * dim);
      // A refund given back never shows on our statement as a debit we can
      // tell from an expense, so the Bank rail carries no refund figure.
      bankRail.refundsMtd = null;
      bankRail.daily = bankDaily;
      bankRail.lastPaymentAt = newestClient ? kuwaitMidnight(newestClient) : null;
    }

    // --- The total covers the connected rails only, and a total over a
    // number no rail can give stays null rather than quietly dropping to 0.
    const connected = [whopRail, tapRail, manualRail, bankRail].filter(r => r.connected);
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
    for (let d = from180; d <= today; d = addDays(d, 1)) {
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
    if (bankRail.connected) {
      cashScopeNote.level = "info";
      cashScopeNote.text = `Cash on the rails covers Whop, the uploaded bank statements (client payments on them), ${tapRail.connected ? "Tap charges no settlement line covers, " : ""}and payments logged by hand that no statement line covers. Whop payouts, Tap settlements and Mahara's own transfers on the statements are never counted, so nothing is counted twice. Processor fees are not taken off.`;
    } else if (!tapRail.connected && !manualRail.connected) {
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
      // Hand-logged refunds are entries of their own kind; the Manual rail's
      // own figure is filled below from them.
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
          if (typeof r.mrrUsd === "number")
            mrrDaily.push({
              date: today,
              metric: "money.mrr.card",
              scope: `client:${r.taskId}`,
              value: r.mrrUsd,
            });
          // The card's LTV field, per card and per day. The earliest of these
          // is what convex/ceo/ltv.ts treats as the baseline: what a person
          // had typed before the cockpit ever wrote to the field. Recording it
          // every day costs nothing and means the hand-typed figure survives
          // even after the cockpit starts writing over it.
          if (typeof r.ltvUsd === "number")
            mrrDaily.push({
              date: today,
              metric: "money.ltv.card",
              scope: `client:${r.taskId}`,
              value: r.ltvUsd,
            });
        }
      }
    } catch (e) {
      notes.push({
        level: "warn",
        text: `The client cards' MRR could not be read this run (${String(e).slice(0, 160)}).`,
      });
    }

    // --- Signed deals against the cash that can be tied to them ----------
    // b2b_deal_cash() joins each closing-form deal to payments through
    // whop_payments.deal_response_id and transfers.deal_response_id. The
    // second is empty because no off-Whop payment has ever been logged, and
    // the first is only as good as its matching rule, which is email alone.
    let collection: MoneyPayload["collection"];
    const collectionDaily: DailyPoint[] = [];
    try {
      const [byMonthRows, linkRows, unmatchedRows] = await Promise.all([
        sql(
          B2B,
          `select to_char(d.submitted_at at time zone 'Asia/Kuwait', 'YYYY-MM') as month,
                  count(*) as deals,
                  coalesce(sum(d.contracted_revenue), 0) as contracted,
                  coalesce(sum(d.whop_cash), 0) as linked,
                  count(*) filter (where coalesce(d.whop_cash, 0) > 0) as with_cash
           from public.b2b_deal_cash() d
           group by 1 order by 1`,
        ),
        sql(
          B2B,
          `select count(*) filter (where deal_response_id is null) as unlinked_rows,
                  coalesce(sum(net_amount) filter (where deal_response_id is null), 0) as unlinked_cash,
                  coalesce(sum(net_amount) filter (where deal_response_id is null
                    and paid_on < (select min((submitted_at at time zone 'Asia/Kuwait')::date)
                                   from public.closed_deals)), 0) as before_form,
                  (select to_char(min(submitted_at at time zone 'Asia/Kuwait'), 'YYYY-MM')
                     from public.closed_deals) as form_started
           from public.whop_payments where status = 'paid'`,
        ),
        sql(
          B2B,
          `select d.business_name, d.payment_structure,
                  to_char(d.submitted_at at time zone 'Asia/Kuwait', 'YYYY-MM') as month,
                  d.contracted_revenue
           from public.b2b_deal_cash() d
           where coalesce(d.whop_cash, 0) = 0 and coalesce(d.ledger_cash, 0) = 0
             and coalesce(d.contracted_revenue, 0) > 0
           order by d.contracted_revenue desc limit 12`,
        ),
      ]);

      const byMonth = byMonthRows.map(r => ({
        month: String(r.month),
        deals: num(r.deals),
        contracted: usd(num(r.contracted)),
        linked: usd(num(r.linked)),
      }));
      const deals = byMonth.reduce((n, m) => n + m.deals, 0);
      const contracted = usd(byMonth.reduce((n, m) => n + m.contracted, 0));
      const linkedCash = usd(byMonth.reduce((n, m) => n + m.linked, 0));
      const dealsWithCash = byMonthRows.reduce(
        (n, r) => n + num(r.with_cash),
        0,
      );
      const link = linkRows[0] ?? {};
      const unlinkedCash = usd(num(link.unlinked_cash));
      const beforeFormCash = usd(num(link.before_form));

      collection = {
        deals,
        contracted,
        linkedCash,
        dealsWithCash,
        unlinkedCash,
        unlinkedRows: num(link.unlinked_rows),
        beforeFormCash,
        formStarted: link.form_started ? String(link.form_started) : null,
        byMonth,
        unmatched: unmatchedRows.map(r => ({
          client: String(r.business_name ?? "(no name)"),
          month: String(r.month),
          contracted: usd(num(r.contracted_revenue)),
          plan: r.payment_structure ? String(r.payment_structure) : null,
        })),
      };

      notes.push({
        level: "warn",
        text: `Of ${usdWords(linkedCash + unlinkedCash)} collected on Whop, only ${usdWords(linkedCash)} can be tied to a signed deal. The other ${usdWords(unlinkedCash)} across ${collection.unlinkedRows} payments belongs to no deal, no client and no lifetime value. ${beforeFormCash > 0 ? `${usdWords(beforeFormCash)} of that arrived before the closing form existed in ${collection.formStarted ?? "its first month"} and can never be tied. ` : ""}The rest fails because the only rule that ties a payment to a deal is an email match between the payer and the form, and clients often pay from a different address.`,
      });
      notes.push({
        level: "warn",
        text: `So a deal with no cash against it has not been shown to be unpaid, only to have no payment matched to it. ${deals - dealsWithCash} of ${deals} signed deals are in that position. Do not chase anyone on this figure alone: check Whop first.`,
      });
      // The closing form gained its contracted-value question in May 2026, so
      // April's rows came from the form with nothing in that column. Muhammed's
      // backfill fills them from the closer tracker. Whether that has been
      // applied is a fact about the database, not something to assert here.
      const firstMonth = byMonth[0];
      const earlyBlank =
        firstMonth && firstMonth.deals > 0 && firstMonth.contracted === 0;
      notes.push({
        level: "info",
        text: `Contracted is what the closing form recorded, ${usdWords(contracted)} over ${deals} deals.${
          earlyBlank
            ? ` ${firstMonth.month} reads as nothing contracted while still collecting cash, because the form had no contracted-value question that early.`
            : ""
        }`,
      });

      const point = (metric: string, value: number): DailyPoint => ({
        date: today,
        metric,
        scope: "company",
        value,
      });
      collectionDaily.push(
        point("money.collection.linkedCash", linkedCash),
        point("money.collection.unlinkedCash", unlinkedCash),
        point("money.collection.dealsNoCash", deals - dealsWithCash),
      );
    } catch (e) {
      notes.push({
        level: "warn",
        text: `Deal collection could not be read this run (${String(e).slice(0, 160)}).`,
      });
    }

    // --- Every payment in, given a side, a person and a deal or a client --
    // (Aziz, 2026-09-21). The rules live in ../attribution; this loads the
    // rows: Whop and bank transfers from the B2B database, Tap from the read
    // above, hand-logged entries from the Convex table, the closer-form deals,
    // the client cards with their portal logins and hand-kept payer mapping,
    // and the money out the database holds (Whop refunds, the bank expenses).
    let attribution: MoneyPayload["attribution"];
    const attributionDaily: DailyPoint[] = [];
    try {
      const from12 = firstMonthStart;
      const [whopRows, transferRows, dealRows, loginRows, expenseRows] =
        await Promise.all([
          sql(
            B2B,
            `select payment_id, to_char(paid_on, 'YYYY-MM-DD') as day,
                    net_amount, final_amount, refunded_amount,
                    to_char((refunded_at at time zone 'Asia/Kuwait')::date, 'YYYY-MM-DD') as refund_day,
                    nullif(lower(btrim(user_email)), '') as email,
                    nullif(btrim(billing_name), '') as billing,
                    nullif(btrim(user_username), '') as username,
                    deal_response_id, billing_reason
             from public.whop_payments
             where status = 'paid' and currency = 'usd' and paid_on >= ${day(from12)}
             order by paid_on`,
          ),
          sql(
            B2B,
            `select id, to_char(received_at, 'YYYY-MM-DD') as day, amount_usd, method,
                    nullif(btrim(client_name), '') as client, reference, deal_response_id
             from public.transfers
             where received_at >= ${day(from12)}`,
          ),
          sql(
            B2B,
            `select response_id,
                    to_char((submitted_at at time zone 'Asia/Kuwait')::date, 'YYYY-MM-DD') as day,
                    nullif(lower(btrim(email)), '') as email,
                    nullif(btrim(business_name), '') as business,
                    nullif(btrim(concat_ws(' ', client_first_name, client_last_name)), '') as contact,
                    closer, csm, cash_collected, payment_structure
             from public.closed_deals
             where submitted_at >= ${day(addDays(from12, -90))}`,
          ),
          sql(
            B2B,
            `with docs as (
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
             )
             select email, min(clickup_id) as clickup_id
             from logins group by email having count(distinct clickup_id) = 1`,
          ),
          sql(
            B2B,
            `select id, to_char(incurred_at, 'YYYY-MM-DD') as day, amount_usd, category, vendor
             from public.expenses
             where incurred_at >= ${day(from12)}
             order by incurred_at desc
             limit 600`,
          ),
        ]);
      let payerRows: Row[] = [];
      try {
        payerRows = await sql(
          TRIAGE,
          `select payer, payer_key, clickup_task_id
           from public.cockpit_payer_clients
           where coalesce(clickup_task_id, '') <> ''`,
        );
      } catch (e) {
        notes.push({
          level: "info",
          text: `The hand-kept payer mapping could not be read this run (${errText(e)}), so a payer mapped by hand matches by name alone.`,
        });
      }

      const detailOf = new Map<string, string | null>();
      const paymentsIn: PaymentIn[] = [];
      for (const r of whopRows) {
        // A payment refunded in full is not money in; its refund is listed below.
        if (num(r.net_amount) <= 0) continue;
        const id = `whop:${r.payment_id}`;
        detailOf.set(id, r.billing_reason ? String(r.billing_reason) : null);
        paymentsIn.push({
          id,
          rail: "whop",
          day: String(r.day),
          usd: usd(num(r.net_amount)),
          currency: "USD",
          amount: usd(num(r.final_amount)),
          payerEmail: r.email ? String(r.email) : null,
          payerName: r.billing
            ? String(r.billing)
            : r.username
              ? String(r.username)
              : null,
          dealResponseId: r.deal_response_id
            ? String(r.deal_response_id)
            : null,
          clickupTaskId: null,
          billingReason: r.billing_reason ? String(r.billing_reason) : null,
        });
      }
      for (const c of tapCharges ?? []) {
        if (c.usd === null) continue;
        const id = `tap:${c.id}`;
        detailOf.set(id, null);
        paymentsIn.push({
          id,
          rail: "tap",
          day: c.day,
          usd: c.usd,
          currency: c.currency,
          amount: c.amount,
          payerEmail: c.email,
          payerName: c.name,
          dealResponseId: null,
          clickupTaskId: null,
          billingReason: null,
        });
      }
      for (const r of transferRows) {
        const id = `transfer:${r.id}`;
        detailOf.set(id, r.method ? String(r.method) : null);
        paymentsIn.push({
          id,
          rail: "transfer",
          day: String(r.day),
          usd: usd(num(r.amount_usd)),
          currency: "USD",
          amount: usd(num(r.amount_usd)),
          payerEmail: null,
          payerName: r.client ? String(r.client) : null,
          dealResponseId: r.deal_response_id
            ? String(r.deal_response_id)
            : null,
          clickupTaskId: null,
          billingReason: null,
        });
      }
      for (const l of bankLines) {
        if (l.kind !== "client_payment") continue;
        const id = `bank:${l.id}`;
        detailOf.set(id, l.reference.slice(0, 80) || null);
        paymentsIn.push({
          id,
          rail: "transfer",
          day: l.day,
          usd: l.usd,
          currency: l.currency,
          amount: l.amount,
          payerEmail: null,
          payerName: l.reference || null,
          dealResponseId: null,
          clickupTaskId: null,
          billingReason: null,
        });
      }
      for (const e of manualCounted) {
        const id = `manual:${e.id}`;
        detailOf.set(id, e.rail);
        paymentsIn.push({
          id,
          rail: "manual",
          day: e.day,
          usd: e.amountUsd,
          currency: e.currency,
          amount: e.amount,
          payerEmail: null,
          payerName: e.client || null,
          dealResponseId: null,
          clickupTaskId: e.clickupTaskId,
          billingReason: null,
        });
      }

      const dealRefs: DealRef[] = dealRows
        .filter(r => r.response_id && r.business)
        .map(r => ({
          responseId: String(r.response_id),
          day: String(r.day),
          email: r.email ? String(r.email) : null,
          business: String(r.business),
          contactName: r.contact ? String(r.contact) : null,
          closer: r.closer ? String(r.closer) : null,
          csm: r.csm ? String(r.csm) : null,
          deposit: usd(num(r.cash_collected)),
          paymentStructure: r.payment_structure
            ? String(r.payment_structure)
            : null,
        }));
      const emailsByCard = new Map<string, string[]>();
      for (const r of loginRows)
        if (r.email && r.clickup_id)
          emailsByCard.set(String(r.clickup_id), [
            ...(emailsByCard.get(String(r.clickup_id)) ?? []),
            String(r.email),
          ]);
      const payersByCard = new Map<string, string[]>();
      for (const r of payerRows)
        payersByCard.set(String(r.clickup_task_id), [
          ...(payersByCard.get(String(r.clickup_task_id)) ?? []),
          ...[r.payer_key, r.payer].filter(Boolean).map(String),
        ]);
      const cardRefs: CardRef[] = (manual?.cards ?? []).map(c => ({
        taskId: c.taskId,
        names: c.names,
        csm: c.csm,
        emails: emailsByCard.get(c.taskId) ?? [],
        payerKeys: payersByCard.get(c.taskId) ?? [],
      }));

      const rows = attribute(paymentsIn, dealRefs, cardRefs);
      const toTx = (r: Attributed): Transaction => ({
        id: r.id,
        day: r.day,
        rail: r.rail,
        direction: "in",
        usd: r.usd,
        currency: r.currency,
        amount: r.amount,
        payerEmail: r.payerEmail,
        payerName: r.payerName,
        side: r.side,
        kind: r.kind,
        person: r.person,
        personRole: r.personRole,
        dealBusiness: r.dealBusiness,
        clientName: r.clientName,
        clientTaskId: r.clientTaskId,
        matchedBy: r.matchedBy,
        detail: detailOf.get(r.id) ?? null,
      });
      const outRows: Transaction[] = [];
      for (const r of whopRows) {
        if (num(r.refunded_amount) <= 0 || !r.refund_day) continue;
        outRows.push({
          id: `whop-refund:${r.payment_id}`,
          day: String(r.refund_day),
          rail: "whop",
          direction: "out",
          usd: usd(num(r.refunded_amount)),
          currency: "USD",
          amount: usd(num(r.refunded_amount)),
          payerEmail: r.email ? String(r.email) : null,
          payerName: r.billing ? String(r.billing) : null,
          side: "out",
          kind: "refund",
          person: null,
          personRole: null,
          dealBusiness: null,
          clientName: null,
          clientTaskId: null,
          matchedBy: "none",
          detail: "Whop refund, already netted off the charge it refunds",
        });
      }
      // Every other statement line: expenses, fees and exclusions as money
      // out; payouts, settlements, own transfers and refunds received as
      // lines that are neither cash in nor an expense, so the tab shows why
      // a bank credit did not become cash.
      for (const l of bankLines) {
        if (l.kind === "client_payment") continue;
        const out = l.usd < 0;
        const isExpense = l.kind === "expense" || l.kind === "fee" || l.kind === "excluded";
        outRows.push({
          id: `bankline:${l.id}`,
          day: l.day,
          rail: "bank",
          direction: out ? "out" : "in",
          usd: Math.abs(l.usd),
          currency: l.currency,
          amount: Math.abs(l.amount),
          payerEmail: null,
          payerName: l.reference || null,
          side: isExpense || out ? "out" : "unattributed",
          kind: l.kind === "excluded" ? "expense" : isExpense ? "expense" : "none",
          person: null,
          personRole: null,
          dealBusiness: null,
          clientName: null,
          clientTaskId: null,
          matchedBy:
            l.kind === "whop_payout"
              ? (payoutMatches.get(String(l.id))
                  ? `Whop payments ${payoutMatches.get(String(l.id))?.from} to ${payoutMatches.get(String(l.id))?.to}`
                  : "none")
              : "none",
          detail: `${KIND_LABEL[l.kind] ?? l.kind}${l.category ? ` · ${l.category}` : ""}${l.note ? ` · ${l.note}` : ""}`,
          bankKind: l.kind,
          bankLineId: l.id,
        });
      }
      for (const e of manualRefunds)
        outRows.push({
          id: `manual-refund:${e.id}`,
          day: e.day,
          rail: "manual",
          direction: "out",
          usd: e.amountUsd,
          currency: e.currency,
          amount: e.amount,
          payerEmail: null,
          payerName: e.client || null,
          side: "out",
          kind: "refund",
          person: null,
          personRole: null,
          dealBusiness: null,
          clientName: e.client || null,
          clientTaskId: e.clickupTaskId,
          matchedBy: "none",
          detail: `Refund logged by hand (${e.rail})`,
        });
      for (const r of expenseRows)
        outRows.push({
          id: `bank:${r.id}`,
          day: String(r.day),
          rail: "bank",
          direction: "out",
          usd: usd(num(r.amount_usd)),
          currency: "USD",
          amount: usd(num(r.amount_usd)),
          payerEmail: null,
          payerName: r.vendor ? String(r.vendor) : null,
          side: "out",
          kind: "expense",
          person: null,
          personRole: null,
          dealBusiness: null,
          clientName: null,
          clientTaskId: null,
          matchedBy: "none",
          detail: r.category ? String(r.category) : null,
        });
      const transactions = [...rows.map(toTx), ...outRows]
        .sort((a, b) =>
          a.day === b.day ? a.id.localeCompare(b.id) : a.day < b.day ? 1 : -1,
        )
        .slice(0, 1500);
      const inMonth = (m: string) => rows.filter(r => r.day.slice(0, 7) === m);
      const all = attributionTotals(rows);
      const out = usd(outRows.reduce((t, r) => t + r.usd, 0));
      attribution = {
        from: from12,
        to: today,
        kickoffRead: false,
        tapRead: tapCharges !== null,
        totals: { ...all, out, outCount: outRows.length },
        mtd: attributionTotals(inMonth(month)),
        lastMonth: attributionTotals(inMonth(lastMonth)),
        byPerson: byPerson(rows),
        transactions,
      };

      notes.push({
        level: "info",
        text: `Every payment in over the last 12 months is given a side. Front end is the deposit at signing (the closer's) and the rest of the cash inside ${FRONT_END_DAYS} days of the deal (${FRONT_END_DAYS_MONTHLY} on a monthly plan, the CSM's); back end is a payment matched to an existing client (that client's CSM's). A payment is tied to a deal by Whop's own link, the payer's email or the business name, and to a client by a portal login, the hand-kept payer mapping, the card's names or the card typed on a hand-logged entry. ${payments(all.unattributedCount)} (${usdWords(all.unattributed)}) match no deal and no client; the Transactions tab lists every payment in and out.`,
      });
      notes.push({
        level: "warn",
        text: "Kickoff cash is not read: the CSM's kickoff form (Typeform BbJy6xg4) has no field for the remaining cash and is not loaded into the database. Until it has two fields (remaining cash collected, and the amount) and Muhammed's Typeform sync loads it, the rest of the cash is judged from the rails alone.",
      });
      if (tapCharges === null)
        notes.push({
          level: "info",
          text: "Tap charges are not in the attribution this run, because Tap was not read.",
        });

      const point = (metric: string, value: number): DailyPoint => ({
        date: today,
        metric,
        scope: "company",
        value,
      });
      attributionDaily.push(
        point("money.attribution.frontEndMtd", attribution.mtd.frontEnd),
        point("money.attribution.backEndMtd", attribution.mtd.backEnd),
        point(
          "money.attribution.unattributedMtd",
          attribution.mtd.unattributed,
        ),
      );
    } catch (e) {
      notes.push({
        level: "warn",
        text: `Payments could not be attributed this run (${errText(e)}), so the front end and back end split and the Transactions tab keep their last figures.`,
      });
    }

    // --- Refunds logged by hand, this month and 90 days.
    const manualRefundsMtd = usd(
      manualRefunds
        .filter(e => e.day >= monthStart(today) && e.day <= today)
        .reduce((t, e) => t + e.amountUsd, 0),
    );
    const manualRefunds90 = usd(
      manualRefunds
        .filter(e => e.day >= from90 && e.day <= today)
        .reduce((t, e) => t + e.amountUsd, 0),
    );
    if (manualRail.connected) manualRail.refundsMtd = manualRefundsMtd;
    if (manualRefunds.length)
      notes.push({
        level: "info",
        text: `Refunds are Whop refunds by refund day plus ${payments(manualRefunds.length)} logged by hand as refunds (${usdWords(manualRefunds90)} in 90 days). A hand-logged refund comes off the Manual rail on its day.`,
      });

    // --- The bank block: what the statements hold, how old the newest is,
    // the expenses on them by month, and the exclusions.
    const lastStatementTo = bankStatements.reduce<string | null>(
      (m, st) => (st.toDay && (!m || st.toDay > m) ? st.toDay : m),
      null,
    );
    const daysSince = lastStatementTo
      ? Math.round((Date.parse(today) - Date.parse(lastStatementTo)) / 86_400_000)
      : null;
    const bankKinds = new Map<string, { count: number; usd: number }>();
    for (const l of bankLines) {
      const r = bankKinds.get(l.kind) ?? { count: 0, usd: 0 };
      r.count += 1;
      r.usd += l.usd;
      bankKinds.set(l.kind, r);
    }
    const expByMonth = new Map<
      string,
      { total: number; byCategory: Map<string, { usd: number; lines: number }>; excluded: { usd: number; lines: number }; fees: number }
    >();
    for (const l of bankLines) {
      if (!["expense", "fee", "excluded"].includes(l.kind)) continue;
      const m = l.day.slice(0, 7);
      const row = expByMonth.get(m) ?? {
        total: 0,
        byCategory: new Map(),
        excluded: { usd: 0, lines: 0 },
        fees: 0,
      };
      const amount = Math.abs(l.usd);
      if (l.kind === "excluded") {
        row.excluded.usd += amount;
        row.excluded.lines += 1;
      } else {
        row.total += amount;
        if (l.kind === "fee") row.fees += amount;
        const cat = l.category ?? (l.kind === "fee" ? "bank" : "other");
        const c = row.byCategory.get(cat) ?? { usd: 0, lines: 0 };
        c.usd += amount;
        c.lines += 1;
        row.byCategory.set(cat, c);
      }
      expByMonth.set(m, row);
    }
    const bankBlock: MoneyPayload["bank"] = {
      lastStatementTo,
      daysSince,
      stale: daysSince === null || daysSince > 7,
      statements: bankStatements,
      accounts: [...new Set(bankStatements.map(st => st.account))].sort(),
      kinds: [...bankKinds.entries()]
        .map(([kind, r]) => ({
          kind,
          label: KIND_LABEL[kind as LineKind] ?? kind,
          count: r.count,
          usd: usd(r.usd),
        }))
        .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd)),
      payouts: {
        count: payoutLines.length,
        matched: payoutMatches.size,
        usd: usd(payoutLines.reduce((t, l) => t + l.usd, 0)),
        matchedUsd: usd([...payoutMatches.values()].reduce((t, m) => t + m.usd, 0)),
      },
      tapSettlements: {
        count: settlementLines.length,
        usd: usd(settlementLines.reduce((t, l) => t + l.usd, 0)),
        chargesCovered: tapCoveredIds.size,
      },
      manualCovered: manualCoveredByBank,
      expenses: [...expByMonth.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([m, row]) => ({
          month: m,
          total: usd(row.total),
          byCategory: [...row.byCategory.entries()]
            .map(([category, c]) => ({ category, usd: usd(c.usd), lines: c.lines }))
            .sort((a, b) => b.usd - a.usd),
          excluded: { usd: usd(row.excluded.usd), lines: row.excluded.lines },
          fees: usd(row.fees),
        })),
      exclusions: bankExclusions,
      unknown: bankLines.filter(l => l.kind === "unknown").length,
    };
    if (bankRead) {
      notes.push({
        level: bankBlock.stale ? "warn" : "info",
        text: lastStatementTo
          ? `The newest bank statement ends ${lastStatementTo}, ${daysSince} day${daysSince === 1 ? "" : "s"} ago${bankBlock.stale ? ": upload the latest CBK export on the Money tab, cash and expenses since then are missing, not zero" : ""}. Statements are the CBK Online CSV export; CBK has no API.`
          : "No bank statement has been uploaded yet, so bank cash and bank expenses are missing, not zero. Drop the CBK Online CSV export on the Money tab.",
      });
      if (payoutLines.length)
        notes.push({
          level: "info",
          text: `${payoutLines.length} Whop payout${payoutLines.length === 1 ? "" : "s"} (${usdWords(bankBlock.payouts.usd)}) on the statements ${payoutLines.length === 1 ? "is" : "are"} not cash: the Whop payments behind ${payoutLines.length === 1 ? "it" : "them"} already count on the Whop rail. ${payoutMatches.size} of them match a run of Whop payments within 3% and 14 days.`,
        });
      if (bankBlock.unknown)
        notes.push({
          level: "info",
          text: `${bankBlock.unknown} statement line${bankBlock.unknown === 1 ? "" : "s"} could not be sorted by the rules and ${bankBlock.unknown === 1 ? "sits" : "sit"} as unknown on the Transactions tab; mark them by hand.`,
        });
    }

    // --- Projected MRR and the collection rate (Aziz, 2026-09-21).
    let book: MoneyPayload["book"];
    const bookDaily: DailyPoint[] = [];
    try {
      const billingRows: BillingRowType[] = await ctx.runQuery(
        internal.ceo.billing.allBilling,
        {},
      );
      const recurring = billingRows.filter(
        r =>
          groupOf(r.stage) === "active" &&
          typeof r.mrrUsd === "number" &&
          r.paymentPlan &&
          !isOneOffPlan(r.paymentPlan),
      );
      const projected = usd(recurring.reduce((t, r) => t + (r.mrrUsd ?? 0), 0));
      const cardIds = new Set(recurring.map(r => r.taskId));
      const collected = usd(
        (attribution?.transactions ?? [])
          .filter(
            t =>
              t.direction === "in" &&
              t.clientTaskId &&
              cardIds.has(t.clientTaskId) &&
              t.day.slice(0, 7) === month,
          )
          .reduce((t, x) => t + x.usd, 0),
      );
      const [projSeries, collSeries] = await Promise.all([
        ctx.runQuery(internal.ceo.store.series, {
          metric: "money.book.projected",
          scope: "company",
          since: firstMonthStart,
        }),
        ctx.runQuery(internal.ceo.store.series, {
          metric: "money.book.collected",
          scope: "company",
          since: firstMonthStart,
        }),
      ]);
      const collByMonth = new Map(collSeries.map(p => [p.date.slice(0, 7), p.value]));
      const history = projSeries
        .filter(p => p.date.slice(0, 7) !== month)
        .map(p => {
          const m = p.date.slice(0, 7);
          const c = collByMonth.get(m) ?? 0;
          return { month: m, projected: p.value, collected: c, rate: p.value > 0 ? Math.round((c / p.value) * 1000) / 1000 : null };
        });
      book = {
        month,
        projectedMrr: projected,
        projectedCards: recurring.length,
        collected,
        collectionRate: projected > 0 ? Math.round((collected / projected) * 1000) / 1000 : null,
        averageRetainer: recurring.length ? usd(projected / recurring.length) : null,
        history,
      };
      const monthDay = `${month}-01`;
      bookDaily.push(
        { date: monthDay, metric: "money.book.projected", scope: "company", value: projected },
        { date: monthDay, metric: "money.book.collected", scope: "company", value: collected },
      );
      notes.push({
        level: "info",
        text: `Projected MRR is the MRR field added up over the ${recurring.length} active cards on a recurring plan; collection rate is the cash attributed to those clients this month, every rail, over it. Both are kept per month from ${month} on, so the history grows from here.`,
      });
    } catch (e) {
      notes.push({
        level: "warn",
        text: `Projected MRR and the collection rate could not be worked out this run (${errText(e)}).`,
      });
    }

    // --- The client's LTV table: every payment attributed to a card, mirrored
    // to cockpit_client_payments in Creative Triage, one row per payment.
    if (attribution && sbWritable())
      try {
        const rows = attribution.transactions
          .filter(t => t.direction === "in" && t.clientTaskId)
          .map(t => ({
            payment_id: t.id,
            clickup_task_id: t.clientTaskId,
            client_name: t.clientName ?? t.dealBusiness ?? null,
            day: t.day,
            usd: t.usd,
            rail: t.rail,
            side: t.side,
            kind: t.kind,
            person: t.person,
            recorded_at: new Date().toISOString(),
          }));
        for (let i = 0; i < rows.length; i += 200)
          await upsertMerge("cockpit_client_payments", rows.slice(i, i + 200), "payment_id");
        sources.push({
          name: "Client payments mirror",
          ok: true,
          note: `${rows.length} attributed payments written to cockpit_client_payments`,
        });
      } catch (e) {
        sources.push({ name: "Client payments mirror", ok: false, note: errText(e) });
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
        ...(bankRead ? { bank: bankRail } : {}),
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
        mtd: usd(refundsMtd + manualRefundsMtd),
        last90: usd(num(s.refunds_90) + manualRefunds90),
        manualMtd: manualRefundsMtd,
        manualLast90: manualRefunds90,
      },
      deals,
      failedCharges: { count30d: failedCount, amount30d: failedAmount },
      expenses,
      targets,
      // Left off when the cards could not be read, so the screen says "not
      // read" rather than showing a book of zero.
      ...(mrr ? { mrr } : {}),
      ...(collection ? { collection } : {}),
      ...(attribution ? { attribution } : {}),
      ...(bankRead ? { bank: bankBlock } : {}),
      ...(book ? { book } : {}),
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
      ...collectionDaily,
      ...attributionDaily,
      ...bookDaily,
    ];

    return { payload, daily, sources };
  },
};
