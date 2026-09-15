import type { MoneyPayload, Note, Point } from "../payloads";
import { B2B, num, sql } from "../sb";
import { addDays, daysInMonth, kuwaitDay, monthStart } from "../time";
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

/**
 * Money: Whop cash (the only live cash rail), deals and contracted value from
 * the closer form, monthly targets and the bank expense import, all from the
 * B2B Supabase project. Days and months are Kuwait time.
 */
export const money: Adapter = {
  key: "money",
  label: "Money",
  compute: async () => {
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

    notes.push({
      level: "warn",
      text: "Cash is Whop only. Bank transfers, Tap and cheques are not live, and Whop fees are not taken off. Cash is already net of refunds on the day of the original charge; refunds are also shown by the month they happened, so never subtract them again.",
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
            text: "The revenue target is compared with contracted value, as the B2B dashboard does. Its definition is still pending, so read that pace with care.",
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

    const payload = {
      month,
      dayOfMonth,
      daysInMonth: dim,
      cash: {
        today: cashBetween(today, today),
        yesterday: cashBetween(addDays(today, -1), addDays(today, -1)),
        mtd,
        lastMonthToDate: cashBetween(lastMonthStart, lastMonthToDateEnd),
        lastMonth: cashBetween(lastMonthStart, lastMonthEnd),
        projectedMonth: usd((mtd / dayOfMonth) * dim),
        daily: cashDaily,
      },
      monthly,
      refunds: {
        mtd: usd(num(s.refunds_mtd)),
        last90: usd(num(s.refunds_90)),
      },
      deals,
      failedCharges: { count30d: failedCount, amount30d: failedAmount },
      expenses,
      targets,
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
    ];

    return { payload, daily, sources };
  },
};
