/**
 * Money from Meta is in each ad account's own currency; the cockpit speaks
 * dollars. Amounts cross between the two here, both ways, and nowhere else.
 *
 * Aziz, 2026-10-06: "ardon is in SAR it should automatically detect and
 * change it". An account's currency is what Meta says it is, never a sheet
 * column someone has to remember to fill. Ardon's campaign budget of 175 SAR
 * was shown as $175 a day, and a budget typed as $38 would have gone to Meta
 * as 38 riyals.
 */

/** Dollars per unit of each currency we run accounts in. */
export const USD_PER: Record<string, number> = {
  USD: 1,
  QAR: 0.2747,
  SAR: 0.2666,
  AED: 0.2723,
  KWD: 3.26,
};

/**
 * Currencies Meta counts budgets in hundredths of. A budget is only read or
 * written in one of these; any other currency is refused rather than guessed,
 * because a wrong guess moves real money by a factor of ten.
 */
const HUNDREDTHS = new Set(["USD", "SAR", "QAR", "AED"]);

export function currencyCode(currency: unknown): string {
  return (
    String(currency ?? "")
      .trim()
      .toUpperCase() || "USD"
  );
}

/** Dollars per unit, or undefined when the cockpit has no rate for it. */
export function rateOf(currency: unknown): number | undefined {
  return USD_PER[currencyCode(currency)];
}

/** An amount Meta reports in the account's currency (spend), in dollars. */
export function spendToUsd(amount: number, currency: unknown): number {
  return amount * (rateOf(currency) ?? 1);
}

/**
 * A Meta budget, in minor units of the account's currency, in dollars.
 * Undefined when there is no budget or the currency cannot be read safely.
 */
export function budgetToUsd(
  minor: unknown,
  currency: unknown,
): number | undefined {
  const n = Number(minor);
  if (!minor || !Number.isFinite(n) || n <= 0) return undefined;
  const code = currencyCode(currency);
  const rate = USD_PER[code];
  if (!rate || !HUNDREDTHS.has(code)) return undefined;
  return Math.round((n / 100) * rate * 100) / 100;
}

/**
 * Dollars typed in the cockpit, as a Meta budget in the account's currency
 * (minor units). Throws, in words she can act on, for a currency it cannot
 * convert.
 */
export function usdToBudget(usd: number, currency: unknown): number {
  const code = currencyCode(currency);
  const rate = USD_PER[code];
  if (!rate || !HUNDREDTHS.has(code))
    throw new Error(
      `This ad account is in ${code}, which the cockpit has no rate for. Change the budget in Ads Manager.`,
    );
  return Math.round((usd / rate) * 100);
}

/** "$38" for a dollar account, "$38 (142.54 SAR in Meta)" for any other. */
export function budgetWords(usd: number, currency: unknown): string {
  const code = currencyCode(currency);
  const dollars = `$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`;
  if (code === "USD") return dollars;
  const local = usdToBudget(usd, code) / 100;
  return `${dollars} (${local.toFixed(2)} ${code} in Meta)`;
}

export type MetaAccount = {
  /** Without the act_ prefix. */
  id: string;
  name: string;
  currency: string;
  /** Last 30 days, in the account's own currency. */
  spend30: number;
};

function normalize(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Find the Meta account a tracker-sheet label means. By name first; then by
 * an account id inside the label, because the sheet's connector names an
 * account with no name of its own "718146936708597, SAR" while Meta calls it
 * "718146936708597", and that mismatch counted Ardon's spend twice.
 */
export function accountIndex(accounts: MetaAccount[]) {
  const byId = new Map<string, MetaAccount>();
  const byName = new Map<string, MetaAccount>();
  for (const a of accounts) {
    const id = String(a.id).replace(/^act_/, "");
    byId.set(id, a);
    const key = normalize(a.name);
    if (key && !byName.has(key)) byName.set(key, a);
  }
  const find = (label: unknown): MetaAccount | undefined => {
    const text = String(label ?? "");
    const named = byName.get(normalize(text));
    if (named) return named;
    for (const digits of text.match(/\d{9,}/g) ?? []) {
      const hit = byId.get(digits);
      if (hit) return hit;
    }
    return undefined;
  };
  return {
    byId,
    find,
    /** The account's currency per Meta, or undefined when Meta does not know the label. */
    currencyOf: (label: unknown) => {
      const hit = find(label);
      return hit ? currencyCode(hit.currency) : undefined;
    },
  };
}

/**
 * The keys one ad-day row is known by. A Meta row that matches any key of a
 * sheet row is the same row, whatever either source calls the account.
 */
export function rowKeys(r: {
  date: string;
  adId?: string;
  campaign?: string;
  adSet?: string;
  adName?: string;
}): string[] {
  const keys: string[] = [];
  if (r.adId) keys.push(`${r.date}|id:${r.adId}`);
  if (r.campaign && r.adName)
    keys.push(
      `${r.date}|${normalize(r.campaign)}|${normalize(r.adSet ?? "")}|${normalize(r.adName)}`,
    );
  return keys;
}
