/**
 * Meta budgets in dollars, for the native media worker.
 *
 * Meta reports a budget in minor units of the ad account's own currency; the
 * cockpit speaks dollars. Ardon's campaign budget "17500" is SAR 175, which
 * is $46.66 a day, and this worker stored it as $175 until 2026-10-21.
 * Copied from apps/media-buyer-cockpit/convex/currency.ts (the Convex fix of
 * 2026-10-06), with one difference: a missing currency is refused here,
 * never read as dollars. Spend is converted with FX in calculator.ts.
 */

/** Dollars per unit. The same table as FX in calculator.ts. */
export const USD_PER: Record<string, number> = {
  USD: 1,
  QAR: 0.2747,
  SAR: 0.2666,
  AED: 0.2723,
  KWD: 3.26,
};

/**
 * Currencies Meta counts budgets in hundredths of (its currency table,
 * checked 2026-10-21). A budget in any other currency is refused rather than
 * guessed, because a wrong guess is ten times out. KWD has a rate for spend
 * but Meta offers no KWD ad account, so it is not here.
 */
export const HUNDREDTHS: ReadonlySet<string> = new Set([
  "USD",
  "SAR",
  "QAR",
  "AED",
]);

function code(currency: unknown): string {
  return String(currency ?? "")
    .trim()
    .toUpperCase();
}

function convertible(currency: unknown): boolean {
  const c = code(currency);
  return Boolean(USD_PER[c]) && HUNDREDTHS.has(c);
}

/**
 * A Meta budget, in minor units of the account's currency, in dollars to the
 * cent. Undefined when there is no budget or the currency cannot be read
 * safely, never the raw number.
 */
export function budgetToUsd(
  minor: unknown,
  currency: unknown,
): number | undefined {
  const n = Number(minor);
  if (!minor || !Number.isFinite(n) || n <= 0) return undefined;
  if (!convertible(currency)) return undefined;
  return Math.round((n / 100) * USD_PER[code(currency)] * 100) / 100;
}

/**
 * The currency an account's budgets are in. Meta's account listing first.
 * The campaign's currency (the tracker sheet's) only when Meta gave none and
 * it names something other than dollars: the calculator reads a blank cell
 * as "USD", so a "USD" from the sheet says nothing and is refused.
 */
export function budgetCurrency(
  byAccount: ReadonlyMap<string, string>,
  metaAccountId: unknown,
  campaignCurrency: unknown,
): string | undefined {
  const meta = code(
    byAccount.get(String(metaAccountId ?? "").replace(/^act_/, "")),
  );
  if (meta) return meta;
  const sheet = code(campaignCurrency);
  return sheet && sheet !== "USD" ? sheet : undefined;
}

type MetaBudget = { daily_budget?: unknown; lifetime_budget?: unknown };
type MetaAdSet = MetaBudget & {
  id?: unknown;
  status?: unknown;
  effective_status?: unknown;
};

export type CampaignBudgets = {
  /** A budget on the campaign means CBO, and edits must go there. */
  level: "campaign" | "adset";
  /** Dollars a day: the campaign's, or the delivering ad sets' summed. */
  daily?: number;
  lifetime?: number;
  /** Dollars a day per ad set id, for the live tree. */
  adSetDaily: Map<string, number | undefined>;
  /** Meta gave a budget that cannot be turned into dollars. */
  unconverted: boolean;
};

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * A campaign's budgets in dollars, from Meta's campaign read
 * (daily_budget, lifetime_budget and its ad sets) and the account's currency.
 * Ad set budgets count only the delivering ad sets, or every ad set when none
 * is delivering.
 */
export function campaignBudgets(
  campRes: (MetaBudget & { adsets?: { data?: MetaAdSet[] } }) | undefined,
  currency: unknown,
): CampaignBudgets {
  const usd = (x: unknown) => budgetToUsd(x, currency);
  const setRows = campRes?.adsets?.data ?? [];
  const adSetDaily = new Map<string, number | undefined>();
  for (const s of setRows) adSetDaily.set(String(s.id), usd(s.daily_budget));
  const unconverted =
    !convertible(currency) &&
    [campRes, ...setRows].some(
      r => Number(r?.daily_budget) > 0 || Number(r?.lifetime_budget) > 0,
    );
  if (campRes?.daily_budget || campRes?.lifetime_budget)
    return {
      level: "campaign",
      daily: usd(campRes.daily_budget),
      lifetime: usd(campRes.lifetime_budget),
      adSetDaily,
      unconverted,
    };
  const delivering = setRows.filter(
    s => String(s.effective_status ?? s.status) === "ACTIVE",
  );
  const counted = delivering.length ? delivering : setRows;
  const daily = counted.reduce((sum, s) => sum + (usd(s.daily_budget) ?? 0), 0);
  const lifetime = counted.reduce(
    (sum, s) => sum + (usd(s.lifetime_budget) ?? 0),
    0,
  );
  return {
    level: "adset",
    daily: daily ? cents(daily) : undefined,
    lifetime: lifetime ? cents(lifetime) : undefined,
    adSetDaily,
    unconverted,
  };
}

// Per process, like the spend path's unknownCurrencies; a native run is one
// process.
const noted = new Set<string>();

/**
 * The log sentence for an account whose budgets cannot be read in dollars,
 * once per account and currency; undefined after the first time. The budget
 * is left blank, which is safe, so the calculator logs it as a warning: an
 * error log stops the native run from publishing anything.
 */
export function unconvertedBudgetNote(
  metaAccountId: unknown,
  currency: unknown,
): string | undefined {
  const account = String(metaAccountId ?? "").replace(/^act_/, "");
  const c = code(currency);
  if (noted.has(`${account}:${c}`)) return undefined;
  noted.add(`${account}:${c}`);
  return c
    ? `No dollar conversion for ${c} budgets on ad account ${account}; its budgets are left blank, not shown as dollars. Add it to USD_PER and HUNDREDTHS in currency.ts once Meta's offset for it is checked.`
    : `Meta's account listing gave no currency for ad account ${account}; its budgets are left blank, not shown as dollars. Add the account to the business's ad accounts in Meta so the listing includes it.`;
}
