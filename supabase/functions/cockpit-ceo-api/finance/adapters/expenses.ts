import type {
  ExpenseGroup,
  ExpenseLine,
  ExpensesPayload,
  Note,
} from "../payloads.ts";
import { USD_PER } from "../data/tap.ts";
import { B2B, num, sql, TRIAGE } from "../sb.ts";
import { daysInMonth, kuwaitDay } from "../time.ts";
import type { Adapter, DailyPoint, SourceStamp } from "../types.ts";

/**
 * Expenses and the P&L, from the bank statement import in the B2B Supabase
 * project (public.expenses) with cash in from Whop and client media from the
 * native media feed (cockpit_media_daily_stats in Creative Triage).
 *
 * The import is a hand loaded CSV, not a live feed: it covers the months that
 * were loaded and nothing else. Everything here is about one month at a time,
 * and every number that cannot be trusted at face value carries the sentence
 * that says why.
 */

/**
 * Cash in is Whop only today: bank transfers, Tap and cheques do not reach the
 * cockpit (see money.rails). While this is false a profit line is never drawn,
 * because the top of the subtraction is a floor. Flip it in one place when
 * every cash rail is live.
 */
const REVENUE_IS_COMPLETE = false;

/** The rates the import could have converted KWD at, biggest fit wins. */
const CANDIDATE_RATES = [3.248, 3.25];

/**
 * Lines that sit inside a category but are not what the category says. They
 * are taken out of the group and named on the card, never deleted: the money
 * still counts inside `total` and `spend`.
 */
const RECLASS_RULES: { reclass: string; label: string; test: RegExp }[] = [
  {
    reclass: "bank",
    label: "Bank charges, card fees and payments to a bank",
    test: /\b(nbk|kfh|cbk)\b|kuwait finance house|national bank of kuwait|boubyan|gulf bank|burgan|warba|non sufficient|decline fee|control card|ann\.?\s*sub\s*fee/i,
  },
  {
    reclass: "course",
    label: "Courses and communities bought from other people",
    test: /whop\s*\*|^whop\b|teachable|kajabi|circle\.so/i,
  },
  {
    reclass: "personal",
    label: "Books, audiobooks and personal subscriptions",
    test: /audible|kindle|netflix|spotify|apple\.com\/bill/i,
  },
];

/**
 * What counts as overhead. The import has no overhead category, so a line only
 * becomes overhead when its payee says so. Nothing has matched in the months
 * loaded so far, which is why overhead reads as missing rather than zero.
 */
const OVERHEAD_RULES: { label: string; test: RegExp }[] = [
  {
    label: "Rent and office",
    test: /\brent\b|\boffice\b|real estate|leasing/i,
  },
  {
    label: "Utilities",
    test: /electric|water auth|ministry of electricity|\bmew\b/i,
  },
  {
    label: "Phone and internet",
    test: /\bzain\b|ooredoo|\bstc\b|\bviva\b|telecom|broadband/i,
  },
  { label: "Insurance", test: /insurance|takaful/i },
  {
    label: "Accounting, legal, licences and government fees",
    test: /accounting|accountant|auditor?\b|\blegal\b|law firm|ministry|municipal|\bpaci\b|licen[cs]e|government|visa fee/i,
  },
];

/** A payee that is a money rail rather than a person, which makes labour a floor. */
const RAIL_PAYEE =
  /top\s*up|weyay|payoneer|\bwise\b|western union|remit|\batm\b|cash withdrawal|transfer/i;

/** A card unload line: money moved to a card, never a cost. */
const UNLOAD_SQL = "(e.note ilike '%unload%' or e.vendor ilike '%unload%')";

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

const usd = (x: number) => Math.round(x * 100) / 100;

/** Whole dollars with thousands commas, without relying on Intl. */
const dollars = (x: number) =>
  `$${String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

/** "2026-06" as "June 2026". */
function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] ?? month} ${y}`;
}

/** YYYY-MM shifted by n months. */
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Whole months between two YYYY-MM, b minus a. */
function monthsApart(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** The last day of a month, YYYY-MM-DD. */
function monthEnd(month: string): string {
  return `${month}-${String(daysInMonth(`${month}-01`)).padStart(2, "0")}`;
}

/**
 * A month as the two SQL date literals that bound it, checked so only a real
 * month goes into the query text.
 */
function monthBounds(month: string): [string, string] {
  if (!/^\d{4}-\d{2}$/.test(month))
    throw new Error(`expenses: bad month ${month}`);
  return [`date '${month}-01'`, `date '${shiftMonth(month, 1)}-01'`];
}

/**
 * Client media from the native media feed. cockpit_media_daily_stats holds
 * one row per ad per day with spend already in USD (the media sync converts
 * it, apps/media-buyer-cockpit/convex/sync.ts spendToUsd) and no client id.
 * A row is tied to a client through its campaign name in cockpit_campaigns
 * (rows the source deleted are kept for the tie), that campaign's Meta ad
 * account, and the client whose meta_ad_account_id is that account. It is
 * the same tie as the CEO worker's mediaClientDaysSql
 * (hermes/ceo-refresh/native/data/triage.js). A campaign that does not tie is
 * counted apart and named in the note, never dropped silently. Mahara's own
 * accounts (maharamedia, maharamassdesign, as the worker folds names) are
 * the company's own lead generation and are taken out.
 *
 * The feed carries only the campaigns the media buyer cockpit tracks and
 * drops a campaign's rows when it leaves the board, so up to 2 Oct 2026 the
 * old ad snapshots fill every ad-day the feed has no tied row for, matched by
 * Meta ad id (metaAdId = ad_id), as the worker does (olderClientMediaSql).
 */
export const MEDIA_FEED_FIRST_DAY = "2026-08-13";
const OWN_MEDIA_ACCOUNT_SQL = "regexp_replace(lower(coalesce(c.name, '')), '[^[:alnum:]]', '', 'g') in ('maharamedia', 'maharamassdesign')";

/** The campaign tie (newest row per name, deleted ones kept) as a CTE body. */
const CAMP_CTE = `camp as (
    select distinct on (raw_data->>'campaignName') raw_data->>'campaignName' as name,
           coalesce(nullif(meta_account_id, ''), nullif(raw_data->>'metaAccountId', '')) as account
    from public.cockpit_campaigns
    where coalesce(raw_data->>'campaignName', '') <> ''
    order by raw_data->>'campaignName', synced_at desc
  )`;

export function clientMediaSql(fromSql: string, toSql: string): string {
  return `with ${CAMP_CTE}, d0 as (
    select s.campaign_name, s.day, coalesce(nullif(s.data->>'metaAdId', ''), s.source_id) as ad,
           coalesce(nullif(s.data->>'spend', '')::numeric, 0) as spend, c.id::text as client_id,
           coalesce(${OWN_MEDIA_ACCOUNT_SQL}, false) as own
    from public.cockpit_media_daily_stats s
    left join camp on camp.name = s.campaign_name
    left join public.clients c on camp.account is not null and replace(c.meta_ad_account_id, 'act_', '') = camp.account
    where s.day >= ${fromSql} and s.day < ${toSql}
  ), d as (
    -- An untied ad-day the old snapshots hold for a client is counted there
    -- (olderClientMediaSql), so it is not counted as untied here.
    select * from d0
    where client_id is not null
       or not exists (select 1 from public.ads_daily_snapshots a join public.clients c on c.id = a.client_id
                      where a.date = d0.day and a.ad_id = d0.ad)
  )
  select coalesce(sum(spend) filter (where client_id is not null and not own), 0) as spend,
         coalesce(array_agg(distinct client_id) filter (where client_id is not null and not own), '{}') as client_ids,
         coalesce(sum(spend) filter (where own), 0) as own_spend,
         count(distinct client_id) filter (where own) as own_clients,
         coalesce(sum(spend) filter (where client_id is null), 0) as untied_spend,
         coalesce(array_agg(distinct campaign_name) filter (where client_id is null), '{}') as untied_campaigns,
         (select to_char(min(day), 'YYYY-MM-DD') from public.cockpit_media_daily_stats) as first_day,
         (select ready from public.cockpit_media_feed_state where feed = 'dailyStats') as ready,
         (select source_rows from public.cockpit_media_feed_state where feed = 'dailyStats') as source_rows,
         (select count(*) from public.cockpit_media_daily_stats) as actual_rows,
         (select floor(extract(epoch from source_snapshot_at) * 1000) from public.cockpit_media_feed_state where feed = 'dailyStats') as synced_ms
  from d`;
}

/**
 * The old ad snapshots (frozen on 2 Oct 2026) for the ad-days the native feed
 * has no tied row for, per currency, converted in code at USD_PER.
 */
export function olderClientMediaSql(fromSql: string, toSql: string): string {
  return `with ${CAMP_CTE}
  select coalesce(c.currency, 'USD') as currency,
         coalesce(sum(a.spend) filter (where not coalesce(${OWN_MEDIA_ACCOUNT_SQL}, false)), 0) as spend,
         coalesce(array_agg(distinct a.client_id::text) filter (where not coalesce(${OWN_MEDIA_ACCOUNT_SQL}, false)), '{}') as client_ids,
         count(*) filter (where coalesce(${OWN_MEDIA_ACCOUNT_SQL}, false)) as own_rows
  from public.ads_daily_snapshots a
  left join public.clients c on c.id = a.client_id
  where a.date >= ${fromSql} and a.date < ${toSql}
    and a.spend <> 0
    and not exists (
      select 1 from public.cockpit_media_daily_stats s
      join camp on camp.name = s.campaign_name
      join public.clients t on replace(t.meta_ad_account_id, 'act_', '') = camp.account
      where s.day = a.date and coalesce(nullif(s.data->>'metaAdId', ''), s.source_id) = a.ad_id)
  group by 1`;
}

/** Null when the feed can be trusted; otherwise the sentence that says why not. */
export function mediaFeedCheck(r: Record<string, unknown>): string | null {
  if (r.ready !== true) return "the native media feed is not marked ready (cockpit_media_feed_state dailyStats)";
  if (num(r.source_rows) !== num(r.actual_rows))
    return `the native media feed holds ${num(r.actual_rows)} rows but its state says ${num(r.source_rows)}, so it is mid-import`;
  return null;
}

const asList = (x: unknown): string[] =>
  Array.isArray(x)
    ? x.map(String)
    : typeof x === "string" && x.startsWith("{")
      ? x.slice(1, -1).split(",").filter(Boolean).map(v => v.replace(/^"|"$/g, ""))
      : [];

export type ClientMedia = {
  amount: number;
  clients: number;
  ownFound: boolean;
  untiedSpend: number;
  untiedCampaigns: string[];
  olderUsd: number;
  unknownCurrencies: string[];
};

/** The month's client media in USD: the native feed plus the old snapshots for the ad-days it lacks, converted at USD_PER. */
export function combineClientMedia(r: Record<string, unknown>, older: Record<string, unknown>[]): ClientMedia {
  const ids = new Set(asList(r.client_ids));
  let olderUsd = 0;
  const unknownCurrencies: string[] = [];
  let ownOlder = 0;
  for (const o of older) {
    const currency = String(o.currency ?? "USD").toUpperCase();
    const rate = USD_PER[currency];
    ownOlder += num(o.own_rows);
    if (rate === undefined) {
      if (num(o.spend)) unknownCurrencies.push(currency);
      continue;
    }
    olderUsd += num(o.spend) * rate;
    for (const id of asList(o.client_ids)) ids.add(id);
  }
  return {
    amount: usd(num(r.spend) + olderUsd),
    clients: ids.size,
    ownFound: num(r.own_clients) > 0 || ownOlder > 0,
    untiedSpend: usd(num(r.untied_spend)),
    untiedCampaigns: asList(r.untied_campaigns).sort(),
    olderUsd: usd(olderUsd),
    unknownCurrencies,
  };
}

export function clientMediaNote(month: string, firstDay: string, m: ClientMedia): string {
  const parts = [
    `Client media for ${month} is what clients' ad accounts spent on Meta, read from the native media feed (cockpit_media_daily_stats, already in dollars) and tied to each client through the campaign's ad account.`,
    "It is a delivery cost carried against each client and is never company overhead, and it is never added to Mahara's own ad spend: the two are different money.",
    m.ownFound
      ? "Mahara's own accounts are taken out of this figure by name."
      : "Mahara's own accounts had no spend in that month's rows, so nothing was taken out for them.",
  ];
  if (m.olderUsd)
    parts.push(`The feed starts ${firstDay} and holds only the campaigns the media buyer tracks, so ads it does not hold come from the old ad snapshots (frozen on 2 Oct 2026), matched by Meta ad id and converted at the cockpit's fixed rates: ${dollars(m.olderUsd)}.`);
  if (m.unknownCurrencies.length)
    parts.push(`Spend in ${m.unknownCurrencies.join(", ")} has no fixed rate and is left out, so the figure is short by that much.`);
  if (m.untiedCampaigns.length)
    parts.push(`${m.untiedCampaigns.length} campaign${m.untiedCampaigns.length === 1 ? "" : "s"} could not be tied to a client and ${m.untiedCampaigns.length === 1 ? "is" : "are"} left out (${dollars(m.untiedSpend)}): ${m.untiedCampaigns.join(", ")}.`);
  parts.push("It is Meta spend as Meta reported it, not a bank charge, so it will not match a bank line.");
  return parts.join(" ");
}

/** Epoch ms computed in SQL (Postgres "+00" timestamps do not parse in JS). */
const epoch = (x: unknown): number | undefined =>
  x === null || x === undefined || x === "" ? undefined : num(x) || undefined;

/** "a, b and c", so a list of reasons reads as a sentence. */
const joinWords = (xs: string[]) =>
  xs.length <= 1
    ? (xs[0] ?? "")
    : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

const errText = (e: unknown) =>
  String(e instanceof Error ? e.message : e).slice(0, 160);

/** One vendor in the month, with the part of it that is not a cost split off. */
type Line = {
  category: string;
  vendor: string;
  rows: number;
  /** Every row for this vendor, card unloads included. */
  amount: number;
  /** The part of `amount` that is a card unload. */
  unload: number;
  /** amount minus unload: the money that actually left. */
  spend: number;
  reclass: string | null;
  reclassLabel: string | null;
  /** The overhead rule that matched this payee, if any. */
  overhead: string | null;
};

const biggestFirst = <T extends { amount: number }>(xs: T[]) =>
  xs.slice().sort((a, b) => b.amount - a.amount);

const asLine = (l: Line): ExpenseLine => ({
  vendor: l.vendor,
  amount: usd(l.spend),
  rows: l.rows,
  category: l.category,
  reclass: l.reclass,
});

/** Group the lines that were moved out of a headline into one row per reason. */
function excludedFrom(moved: Line[]): { label: string; amount: number }[] {
  const by = new Map<string, number>();
  for (const l of moved) {
    const label = l.overhead
      ? `Moved to overhead: ${l.overhead}`
      : (l.reclassLabel ?? "Moved out");
    by.set(label, (by.get(label) ?? 0) + l.spend);
  }
  return biggestFirst(
    [...by].map(([label, amount]) => ({ label, amount: usd(amount) })),
  );
}

/** An empty group, for a P&L line the month has nothing to say about. */
const emptyGroup = (why: string): ExpenseGroup => ({
  amount: null,
  headline: null,
  excluded: [],
  vendors: [],
  quality: "missing",
  why,
});

export const expenses: Adapter = {
  key: "expenses",
  label: "Expenses and P&L",
  compute: async () => {
    const today = kuwaitDay();
    const thisMonth = today.slice(0, 7);
    const notes: Note[] = [];
    const sources: SourceStamp[] = [];

    // --- Core: every month the import covers, with its totals and the import
    // stamps. This is the whole trust story of the tab, so a failure here
    // throws and the last good payload survives.
    const monthRows = await sql(
      B2B,
      `select to_char(date_trunc('month', e.incurred_at), 'YYYY-MM') as month,
              count(*) as rows,
              sum(e.amount_usd) as total,
              coalesce(sum(e.amount_usd) filter (where ${UNLOAD_SQL}), 0) as unloads,
              floor(extract(epoch from max(e.created_at)) * 1000) as imported_ms,
              floor(extract(epoch from max(e.updated_at)) * 1000) as updated_ms,
              count(*) filter (where abs(e.amount_usd / 3.248 - round(e.amount_usd / 3.248, 2)) <= 0.005) as fits_3248,
              count(*) filter (where abs(e.amount_usd / 3.25 - round(e.amount_usd / 3.25, 2)) <= 0.005) as fits_325
       from public.expenses e
       group by 1
       order by 1`,
    );
    const importedAt = monthRows.length
      ? (epoch(monthRows[monthRows.length - 1].imported_ms) ?? null)
      : null;
    const updatedAt = monthRows.length
      ? Math.max(...monthRows.map(r => epoch(r.updated_ms) ?? 0)) || undefined
      : undefined;
    sources.push({
      name: "Bank expense import",
      freshestAt: updatedAt,
      ok: monthRows.length > 0,
      note: monthRows.length ? undefined : "no expense rows are loaded",
    });

    if (!monthRows.length) {
      const why =
        "No expense rows are loaded at all, so no cost can be shown. The expense table is filled by a hand loaded bank statement CSV.";
      notes.push({ level: "warn", text: why });
      const payload = {
        month: null,
        monthsLoaded: [],
        importedAt: null,
        fxUsdPerKwd: null,
        total: null,
        spend: null,
        unloads: null,
        software: emptyGroup(why),
        overhead: emptyGroup(why),
        labour: emptyGroup(why),
        ownAdSpend: emptyGroup(why),
        byCategory: [],
        clientAdSpend: { amount: null, clients: null },
        revenue: null,
        profit: {
          amount: null,
          margin: null,
          why: "Profit cannot be drawn: no expense rows are loaded, so money out is not known.",
        },
        peopleFilingEods: null,
        notes,
      } satisfies ExpensesPayload;
      return { payload, sources };
    }

    const monthsLoaded = monthRows.map(r => String(r.month));
    const month = monthsLoaded[monthsLoaded.length - 1];
    // The import is loaded by hand, so a fresh stamp is not a healthy feed:
    // say which month it covers right on the source.
    sources[0].note = `covers ${monthsLoaded.map(monthName).join(", ")}, loaded by hand and not a live feed`;
    const latest = monthRows[monthRows.length - 1];
    const [monthFrom, monthTo] = monthBounds(month);

    // --- Core: the month's vendor grain. One row per category and payee, with
    // the card unload part of each split off so it never lands in a P&L group.
    const vendorRows = await sql(
      B2B,
      `select coalesce(nullif(lower(btrim(e.category)), ''), 'uncategorised') as category,
              left(coalesce(nullif(btrim(e.vendor), ''), '(no payee)'), 60) as vendor,
              count(*) as rows,
              sum(e.amount_usd) as amount,
              coalesce(sum(e.amount_usd) filter (where ${UNLOAD_SQL}), 0) as unload
       from public.expenses e
       where e.incurred_at >= ${monthFrom} and e.incurred_at < ${monthTo}
       group by 1, 2
       order by sum(e.amount_usd) desc`,
    );
    if (!vendorRows.length)
      throw new Error(`expenses: ${month} has months but no rows`);

    const lines: Line[] = vendorRows.map(r => {
      const amount = num(r.amount);
      const unload = num(r.unload);
      const vendor = String(r.vendor);
      const rule = RECLASS_RULES.find(x => x.test.test(vendor));
      const over = OVERHEAD_RULES.find(x => x.test.test(vendor));
      return {
        category: String(r.category),
        vendor,
        rows: num(r.rows),
        amount,
        unload,
        spend: amount - unload,
        reclass: rule?.reclass ?? null,
        reclassLabel: rule?.label ?? null,
        // A payee that is plainly overhead is overhead whatever the import
        // called it, but a bank or a course is never overhead.
        overhead: !rule && over ? over.label : null,
      };
    });

    const sum = (xs: Line[], pick: (l: Line) => number) =>
      usd(xs.reduce((t, l) => t + pick(l), 0));
    const total = sum(lines, l => l.amount);
    const unloads = sum(lines, l => l.unload);
    const spend = usd(total - unloads);

    // --- The P&L groups. The import's own category picks the group; a payee
    // that is not what its category says is moved out and named.
    const buildGroup = (
      category: string,
      emptyWhy: string,
      quality: (kept: Line[]) => ExpenseGroup["quality"],
      why: (kept: Line[], moved: Line[]) => string,
    ): ExpenseGroup => {
      const inCategory = lines.filter(
        l => l.category === category && l.spend > 0,
      );
      // No line at all is not a zero cost: the import simply said nothing.
      if (!inCategory.length) return emptyGroup(emptyWhy);
      const moved = inCategory.filter(l => l.reclass || l.overhead);
      const kept = inCategory.filter(l => !l.reclass && !l.overhead);
      return {
        amount: sum(kept, l => l.spend),
        headline: sum(inCategory, l => l.spend),
        excluded: excludedFrom(moved),
        vendors: biggestFirst(kept.map(asLine)),
        quality: quality(kept),
        why: why(kept, moved),
      };
    };

    const software = buildGroup(
      "software",
      `The import has no software line for ${monthName(month)}, so tool spend is missing, not zero.`,
      () => "measured",
      (_kept, moved) =>
        `Tool spend${
          moved.length
            ? " after the lines listed below were taken out of the raw software category"
            : ""
        }. The payee is the bank card descriptor, so one tool can appear under several names and nothing marks a line as recurring: there is no per tool total, no renewal date, no seat count and no run rate.`,
    );

    const overheadLines = lines.filter(l => l.overhead && l.spend > 0);
    const overhead: ExpenseGroup = overheadLines.length
      ? {
          amount: sum(overheadLines, l => l.spend),
          headline: sum(overheadLines, l => l.spend),
          excluded: [],
          vendors: biggestFirst(overheadLines.map(asLine)),
          quality: "measured",
          why: "Overhead is matched by payee, not by an import category, because the import has none. Only the payees that plainly read as rent, utilities, phone and internet, insurance, accounting, legal, licences or government fees are counted, so anything paid under a name that does not say what it is will be missing.",
        }
      : emptyGroup(
          `No rent, utility, phone, internet, insurance, accounting, legal, licence or government fee payee exists in the import for ${monthName(
            month,
          )}, so overhead cannot be shown. It is missing, not zero.`,
        );

    const labour = buildGroup(
      "salaries",
      `The import has no payroll line for ${monthName(month)}, so labour is missing, not zero. Nobody works for free, so read it as a gap in the import.`,
      kept =>
        kept.length && kept.every(l => RAIL_PAYEE.test(l.vendor))
          ? "floor"
          : "measured",
      kept => {
        const rails = kept.filter(l => RAIL_PAYEE.test(l.vendor));
        const named = rails.map(l => l.vendor).join(", ");
        return rails.length === kept.length && kept.length
          ? `Every payroll line is paid through a money rail (${named}), never to a named person, so this is what left through those rails and not a payroll figure. Anyone paid another way is missing, and a top up is not proof the money reached a person. Never read a cost per head, a payroll share of revenue or a margin from it.`
          : "Payroll as the import recorded it. The payee on a bank line is rarely a person, so read it as money that left through the payroll rails rather than as pay.";
      },
    );

    const ownAdSpend = buildGroup(
      "ad_spend",
      `The import has no ad spend line for ${monthName(month)}, so Mahara's own ad spend is missing here. The Frontend and Marketing tabs read it from Meta instead.`,
      () => "measured",
      () =>
        "Mahara's own lead-gen charges on the company card. This is the same money as the growth spend on the Frontend and Marketing tabs, so it is counted once and never added to it. The bank books a charge on the day it settles, so it will not match the Meta figure day for day.",
    );

    // Every category exactly as imported, nothing moved, card unloads included.
    const byCategoryMap = new Map<string, { amount: number; rows: number }>();
    for (const l of lines) {
      const row = byCategoryMap.get(l.category) ?? { amount: 0, rows: 0 };
      row.amount += l.amount;
      row.rows += l.rows;
      byCategoryMap.set(l.category, row);
    }
    const byCategory = biggestFirst(
      [...byCategoryMap].map(([category, r]) => ({
        category,
        amount: usd(r.amount),
        rows: r.rows,
      })),
    );

    // --- The month this covers. Everything else on the tab is read through it.
    notes.push({
      level: "warn",
      text: `These numbers cover ${monthName(month)} only.${
        monthsLoaded.length > 1
          ? ` The import holds ${monthsLoaded.length} months (${monthsLoaded.map(monthName).join(", ")}).`
          : " It is the only month with expense rows, so there is no trend, no month on month movement, no run rate and no projection."
      }${
        month !== thisMonth
          ? ` Today is ${monthName(thisMonth)}, so this is ${monthsApart(month, thisMonth)} month${
              monthsApart(month, thisMonth) === 1 ? "" : "s"
            } behind and is not what the company is spending now.`
          : ""
      }`,
    });
    const gaps: string[] = [];
    for (let i = 1; i < monthsLoaded.length; i++)
      if (monthsApart(monthsLoaded[i - 1], monthsLoaded[i]) > 1)
        gaps.push(
          `${monthName(monthsLoaded[i - 1])} to ${monthName(monthsLoaded[i])}`,
        );
    if (gaps.length)
      notes.push({
        level: "warn",
        text: `The import skips months (${gaps.join(", ")}). The months in between are missing, not zero.`,
      });

    // --- The exchange rate. The import stores USD only and keeps no rate, so
    // it is derived, and only when one candidate fits every row.
    const rowsInMonth = num(latest.rows);
    const fitCounts = [num(latest.fits_3248), num(latest.fits_325)];
    const fitting = CANDIDATE_RATES.filter(
      (_, i) => fitCounts[i] === rowsInMonth,
    );
    const fxUsdPerKwd = fitting.length === 1 ? fitting[0] : null;
    notes.push({
      level: "info",
      text: fxUsdPerKwd
        ? `The import stores USD only and records no exchange rate. Every row in ${monthName(month)} fits ${fxUsdPerKwd} USD per KWD to the cent, so that is the rate shown and it is derived, not recorded. Other parts of the stack convert with their own rate, so never mix the two.`
        : `The import stores USD only and records no exchange rate.${
            fitting.length > 1
              ? ` Every row in ${monthName(month)} fits both ${CANDIDATE_RATES.join(" and ")} USD per KWD to the cent, so the rate it used cannot be pinned down.`
              : ` No single fixed rate fits every row in ${monthName(month)}.`
          } Read the USD amounts as converted at a fixed rate near 3.25, and never mix them with a rate from elsewhere in the stack.`,
    });

    // --- How the grouping works, in the CEO's own words, so nobody has to
    // guess what counts as software, overhead or labour.
    const GROUPED_CATEGORIES = ["software", "salaries", "ad_spend"];
    const movedOut = lines.filter(
      l =>
        (l.reclass || l.overhead) &&
        l.spend > 0 &&
        GROUPED_CATEGORIES.includes(l.category),
    );
    notes.push({
      level: "info",
      text: `How the P&L is grouped: the import's own category picks the group. software is tools, salaries is labour, ad_spend is Mahara's own lead-gen, and other is left out of all three. On top of that, a payee that is not what its category says is moved out and named on the card: bank charges and card fees, courses and communities bought from other people, and books and personal subscriptions.${
        movedOut.length
          ? ` In ${monthName(month)} that moved ${dollars(sum(movedOut, l => l.spend))} out.`
          : ""
      } Overhead is matched by payee only, because the import has no overhead category.`,
    });

    const grouped = usd(
      (software.amount ?? 0) +
        (overhead.amount ?? 0) +
        (labour.amount ?? 0) +
        (ownAdSpend.amount ?? 0),
    );
    const outsideGroups = usd(Math.max(0, spend - grouped));
    notes.push({
      level: "info",
      text: `Money out in ${monthName(month)} was ${dollars(spend)}: ${dollars(
        software.amount ?? 0,
      )} tools, ${dollars(labour.amount ?? 0)} labour, ${dollars(
        ownAdSpend.amount ?? 0,
      )} own ad spend and ${dollars(
        outsideGroups,
      )} that sits outside the three groups (the lines moved out above, plus anything the import left in other). Card unloads of ${dollars(
        unloads,
      )} are on top of that and are not a cost: they are money moved to a card, which is then spent under its own lines. Use money out, not the total of every row.`,
    });

    // --- Secondary: cash in for the same month, what the bank transfer rows
    // in the same import really are, and how many people filed an EOD.
    let revenue: number | null = null;
    let peopleFilingEods: number | null = null;
    try {
      const [r] = await sql(
        B2B,
        `select
           (select coalesce(sum(net_amount), 0) from public.whop_payments
             where status = 'paid' and currency = 'usd'
               and paid_on >= ${monthFrom} and paid_on < ${monthTo}) as revenue,
           (select floor(extract(epoch from max(synced_at)) * 1000) from public.whop_payments) as whop_synced_ms,
           (select count(*) from public.transfers
             where received_at >= ${monthFrom} and received_at < ${monthTo}) as transfer_rows,
           (select coalesce(sum(amount_usd), 0) from public.transfers
             where received_at >= ${monthFrom} and received_at < ${monthTo}) as transfer_amount,
           (select count(*) from public.transfers
             where received_at >= ${monthFrom} and received_at < ${monthTo}
               and reference ilike '%/CC') as transfer_card,
           (select count(*) from public.transfers
             where received_at >= ${monthFrom} and received_at < ${monthTo}
               and (client_name is not null and btrim(client_name) <> '' or deal_response_id is not null)) as transfer_named,
           (select count(distinct lower(btrim(person_name))) from (
              select person_name from public.eod_reports
                where report_date >= ${monthFrom} and report_date < ${monthTo} and person_name is not null
              union all
              select person_name from public.team_eod_reports
                where report_date >= ${monthFrom} and report_date < ${monthTo} and person_name is not null
            ) p) as eod_people`,
      );
      if (!r) throw new Error("cash in query returned no row");
      revenue = usd(num(r.revenue));
      peopleFilingEods = num(r.eod_people);
      sources.push({
        name: "Whop payments",
        freshestAt: epoch(r.whop_synced_ms),
        ok: true,
      });
      const tRows = num(r.transfer_rows);
      const tAmount = usd(num(r.transfer_amount));
      const tCard = num(r.transfer_card);
      const tNamed = num(r.transfer_named);
      notes.push({
        level: "warn",
        text: `Cash in for ${monthName(month)} is Whop only and is gross of processor fees.${
          tRows
            ? ` The same import holds ${tRows} bank transfer row${tRows === 1 ? "" : "s"} worth ${dollars(tAmount)}${
                tNamed === 0
                  ? `, but not one names a client or links a deal${
                      tCard === tRows
                        ? " and every one carries a card credit reference, the same card as the unload lines"
                        : ""
                    }, so they read as money moved rather than client payments and are not counted as cash in.`
                  : `, of which ${tNamed} name a client or a deal. They are not added here because the rest cannot be told apart from money moved between accounts.`
              }`
            : ""
        }`,
      });
      if (peopleFilingEods !== null)
        notes.push({
          level: "info",
          text: `${peopleFilingEods} people filed an EOD in ${monthName(month)}. It is the only head count the cockpit can see, and filing an EOD is not the same as being paid, so read it beside labour rather than dividing one by the other.`,
        });
    } catch (e) {
      sources.push({ name: "Whop payments", ok: false, note: errText(e) });
      notes.push({
        level: "warn",
        text: "Cash in for the month could not be read, so no profit line and no revenue figure can be shown.",
      });
    }

    // --- Secondary: client media for the same month. A delivery cost carried
    // per client, never part of company overhead, so it is kept apart from
    // every P&L group. Read from the native media feed since 2026-10-11 (see
    // clientMediaSql below); the old ad snapshots stopped on 2026-10-02.
    const clientAdSpend: ExpensesPayload["clientAdSpend"] = {
      amount: null,
      clients: null,
    };
    try {
      const [r] = await sql(TRIAGE, clientMediaSql(monthFrom, monthTo));
      if (!r) throw new Error("client media query returned no row");
      const feed = mediaFeedCheck(r);
      if (feed) throw new Error(feed);
      const firstDay = /^\d{4}-\d{2}-\d{2}$/.test(String(r.first_day)) ? String(r.first_day) : MEDIA_FEED_FIRST_DAY;
      // The old snapshots stop on 2 Oct 2026; a later month reads none.
      const older = `${month}-01` <= "2026-10-02"
        ? await sql(TRIAGE, olderClientMediaSql(monthFrom, monthTo))
        : [];
      const media = combineClientMedia(r, older);
      clientAdSpend.amount = media.amount;
      clientAdSpend.clients = media.clients;
      sources.push({
        name: "Native media feed (cockpit_media_daily_stats)",
        freshestAt: epoch(r.synced_ms),
        ok: true,
      });
      if (older.length)
        sources.push({
          name: "Creative Triage ad snapshots (frozen 2 Oct 2026)",
          ok: true,
          note: "ad-days the native feed has no tied row for, up to 2 Oct 2026",
        });
      notes.push({
        level: media.untiedCampaigns.length || media.unknownCurrencies.length ? "warn" : "info",
        text: clientMediaNote(monthName(month), firstDay, media),
      });
    } catch (e) {
      sources.push({
        name: "Native media feed (cockpit_media_daily_stats)",
        ok: false,
        note: errText(e),
      });
      notes.push({
        level: "warn",
        text: "Client media spend for the month could not be read, so it shows as not known. It is missing, not zero.",
      });
    }

    // --- Profit, only when every side of the subtraction is real. Today the
    // labour line is a rail floor, overhead is missing and cash in is Whop
    // only, so the honest answer is that there is no profit line.
    const missing: string[] = [];
    const groupNames: [string, ExpenseGroup][] = [
      ["tool spend", software],
      ["overhead", overhead],
      ["labour", labour],
      ["own ad spend", ownAdSpend],
    ];
    for (const [name, g] of groupNames)
      if (g.quality === "missing") missing.push(`${name} is missing`);
      else if (g.quality === "floor") missing.push(`${name} is a known floor`);
    if (revenue === null) missing.push("cash in could not be read");
    else if (!REVENUE_IS_COMPLETE)
      missing.push("cash in is Whop only, which is a floor too");

    const profit: ExpensesPayload["profit"] =
      missing.length === 0 && revenue !== null
        ? {
            amount: usd(revenue - spend),
            margin:
              revenue > 0
                ? Math.round((1 - spend / revenue) * 1e4) / 1e4
                : null,
            why: null,
          }
        : {
            amount: null,
            margin: null,
            why: `Profit is not drawn for ${monthName(month)} because ${joinWords(
              missing,
            )}. Money out and cash in are both shown, so read them side by side: the gap between them is not a profit or a loss.`,
          };

    const payload = {
      month,
      monthsLoaded,
      importedAt,
      fxUsdPerKwd,
      total,
      spend,
      unloads,
      software,
      overhead,
      labour,
      ownAdSpend,
      byCategory,
      clientAdSpend,
      revenue,
      profit,
      peopleFilingEods,
      notes,
    } satisfies ExpensesPayload;

    // The import is loaded by hand and a reload can replace a month in place,
    // so keep what each load said. One point per loaded month, dated on the
    // month's last day (never in the future), which is also the trend the tab
    // can draw the day a second month lands.
    const daily: DailyPoint[] = [];
    const points = (date: string, metric: string, value: number) => {
      daily.push({ date, metric, scope: "company", value });
    };
    const keep = (date: string, metric: string, value: number | null) => {
      if (value !== null) points(date, metric, value);
    };
    for (const r of monthRows) {
      const m = String(r.month);
      const at = monthEnd(m) > today ? today : monthEnd(m);
      const mTotal = usd(num(r.total));
      points(at, "expenses.total", mTotal);
      points(at, "expenses.spend", usd(mTotal - num(r.unloads)));
      points(at, "expenses.unloads", usd(num(r.unloads)));
    }
    const at = monthEnd(month) > today ? today : monthEnd(month);
    keep(at, "expenses.software", software.amount);
    keep(at, "expenses.overhead", overhead.amount);
    keep(at, "expenses.labour", labour.amount);
    keep(at, "expenses.ownAdSpend", ownAdSpend.amount);
    keep(at, "expenses.clientAdSpend", clientAdSpend.amount);
    keep(at, "expenses.revenue", revenue);

    return { payload, daily, sources };
  },
};
