import { addDays, KUWAIT_OFFSET_MS, kuwaitDay } from "../time";

/**
 * Tap Payments, read only, for the CEO money section.
 *
 * A plain module like convex/ceo/sb.ts: the money adapter imports it and calls
 * it from inside its action. There is no secret in this file. The key lives on
 * the Convex deployment as TAP_SECRET_KEY and is never logged, never returned
 * and never put in an error message.
 *
 * What Tap gives here and what it does not:
 *
 * - Captured charges over a period, from POST /v2/charges/list. That endpoint
 *   takes at most 30 days per call, so a 90 day read goes out as chunks, and
 *   each chunk pages with `starting_after` until Tap says there is no more.
 * - A charge is counted on the Kuwait day of `transaction.created`, the same
 *   way Whop cash is counted on its Kuwait paid day.
 * - Amounts arrive in the charge currency, so each row is converted at the
 *   fixed rates convex/sync.ts already uses for ad spend. A currency with no
 *   rate here is carried with `usd` null and named on screen: a guessed rate
 *   would be a made up number.
 * - Refunds are a separate endpoint and the units on a Tap refund amount have
 *   not been checked against one real refund yet, so refunds are not read at
 *   all. Tap cash is therefore gross of refunds while Whop cash is net of
 *   them. The money adapter says so on the card.
 * - Test charges are never cash: a charge Tap marks as not live is counted and
 *   left out, and a test key is not read at all.
 */

declare const process: { env: Record<string, string | undefined> };

/** The deployment variable that turns the Tap rail on. */
export const TAP_KEY_NAME = "TAP_SECRET_KEY";

/** The exact command that connects Tap, shown on screen while the key is missing. */
export const TAP_CONNECT_COMMAND = `bunx convex env set ${TAP_KEY_NAME} sk_live_...`;

/**
 * Rates to USD, the same fixed table convex/sync.ts uses for ad spend, so one
 * number never means two things on two screens.
 */
export const USD_PER: Record<string, number> = {
  USD: 1,
  KWD: 3.26,
  AED: 0.2723,
  SAR: 0.2666,
  QAR: 0.2747,
};

/** One captured Tap charge, already placed on a Kuwait day. */
export type TapCharge = {
  id: string;
  /** Kuwait day the charge was made, YYYY-MM-DD. */
  day: string;
  /** When the charge was made, epoch ms. */
  at: number;
  currency: string;
  /** The amount in `currency`, as Tap gave it. */
  amount: number;
  /** `amount` in USD, or null when this file has no rate for the currency. */
  usd: number | null;
};

export type TapRead = {
  /** Captured live charges in the window, oldest first. */
  charges: TapCharge[];
  /** Newest charge seen, epoch ms, or null when the window held none. */
  newestAt: number | null;
  /** Charges kept but not converted, because their currency has no rate here. */
  unconverted: { currency: string; count: number }[];
  /** Charges left out because Tap gave them no created time. */
  undated: number;
  /** Charges left out because Tap marked them as test mode. */
  testRows: number;
  /** How many list calls went out. */
  requests: number;
  /** True when a page cap or the time budget stopped the read, so it is short. */
  truncated: boolean;
};

export type TapKeyState = "live" | "test" | "missing";

const API_URL = "https://api.tap.company/v2/charges/list";
/** The list endpoint takes at most 30 days in one call. */
const WINDOW_DAYS = 30;
/** Its maximum page size, sent as a string the way its own example does. */
const PAGE_LIMIT = "50";
/** 40 pages is 2000 charges in one 30 day window, far past Mahara's volume. */
const MAX_PAGES_PER_WINDOW = 40;
const REQUEST_TIMEOUT_MS = 20_000;
/** The whole Tap read, so money stays well inside its 150 s section budget. */
const READ_BUDGET_MS = 60_000;
const RETRIES = 2;

/** Tap replies are untyped JSON. */
type Any = any;

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const num = (x: unknown): number => {
  const n = typeof x === "number" ? x : Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/** A secret key must never reach a note, an error or a log. */
const redact = (s: string) =>
  s.replace(/\b[sp]k_(test|live)_[A-Za-z0-9]+/gi, "[key]");

const brief = (x: unknown, max = 160) =>
  redact(typeof x === "string" ? x : JSON.stringify(x ?? "")).slice(0, max);

/** Midnight Kuwait on a day, epoch ms. */
const dayStartMs = (day: string) =>
  new Date(`${day}T00:00:00Z`).getTime() - KUWAIT_OFFSET_MS;

/** The last millisecond of a Kuwait day. */
const dayEndMs = (day: string) => dayStartMs(day) + 86_400_000 - 1;

/** Whether the deployment has a Tap key, and whether it is a live one. */
export function tapKeyState(): TapKeyState {
  const key = (process.env[TAP_KEY_NAME] ?? "").trim();
  if (!key) return "missing";
  return /^sk_test/i.test(key) ? "test" : "live";
}

/** The key, or an error naming the command that sets it. */
function tapKey(): string {
  const key = (process.env[TAP_KEY_NAME] ?? "").trim();
  if (!key)
    throw new Error(
      `${TAP_KEY_NAME} is not set on this Convex deployment. Run: ${TAP_CONNECT_COMMAND}`,
    );
  return key;
}

/**
 * Stop waiting after `ms`. The Convex runtime has no AbortController, so the
 * call is not cancelled, only stopped being waited on, the same way
 * convex/ceo/refresh.ts holds a section to its budget.
 */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`${what} did not answer within ${Math.round(ms / 1000)} s`),
        ),
      ms,
    );
    p.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** One list call, retried on a rate limit, a server error or a dropped socket. */
async function listOnce(
  key: string,
  body: Record<string, unknown>,
  deadline: number,
): Promise<Any> {
  for (let attempt = 0; ; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error("Tap took longer than the read budget");
    const perCall = Math.min(REQUEST_TIMEOUT_MS, left);
    let res: Response | null = null;
    let failure = "";
    try {
      res = await withTimeout(
        fetch(API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        }),
        perCall,
        "Tap",
      );
    } catch (e) {
      failure = brief(e instanceof Error ? e.message : String(e), 120);
    }

    if (!res) {
      if (attempt < RETRIES && Date.now() < deadline) {
        await wait((attempt + 1) * 2_000);
        continue;
      }
      throw new Error(`Tap could not be reached: ${failure}`);
    }

    let text = "";
    try {
      text = await withTimeout(res.text(), perCall, "Tap");
    } catch (e) {
      text = `body could not be read: ${brief(e instanceof Error ? e.message : String(e), 80)}`;
    }

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < RETRIES && Date.now() < deadline) {
        await wait((attempt + 1) * 5_000);
        continue;
      }
      throw new Error(`Tap returned HTTP ${res.status}: ${brief(text)}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `Tap returned something that is not JSON: ${brief(text)}`,
      );
    }
  }
}

/**
 * Every captured charge between two Kuwait days, both ends included.
 *
 * Throws when the key is missing or Tap cannot be read. The caller shows n/a
 * and says why; it never turns a failed read into a zero.
 */
export async function capturedCharges(
  from: string,
  to: string,
): Promise<TapRead> {
  const key = tapKey();
  const deadline = Date.now() + READ_BUDGET_MS;
  const charges: TapCharge[] = [];
  const seen = new Set<string>();
  const unknown = new Map<string, number>();
  let newestAt: number | null = null;
  let undated = 0;
  let testRows = 0;
  let requests = 0;
  let truncated = false;

  for (
    let windowFrom = from;
    windowFrom <= to;
    windowFrom = addDays(windowFrom, WINDOW_DAYS)
  ) {
    const windowToRaw = addDays(windowFrom, WINDOW_DAYS - 1);
    const windowTo = windowToRaw > to ? to : windowToRaw;
    let startingAfter: string | null = null;

    for (let page = 0; page < MAX_PAGES_PER_WINDOW; page++) {
      if (Date.now() >= deadline) {
        truncated = true;
        break;
      }
      const body: Record<string, unknown> = {
        period: {
          date: {
            from: String(dayStartMs(windowFrom)),
            to: String(dayEndMs(windowTo)),
          },
          type: "CHARGE",
        },
        status: "CAPTURED",
        limit: PAGE_LIMIT,
        order: "chronological",
        order_by: "date",
      };
      if (startingAfter) body.starting_after = startingAfter;

      const reply: Any = await listOnce(key, body, deadline);
      requests++;
      const list: Any[] | null = Array.isArray(reply?.charges)
        ? reply.charges
        : null;
      if (!list)
        throw new Error(
          `Tap sent no charges list (keys: ${Object.keys(reply ?? {}).join(", ") || "none"})`,
        );
      if (!list.length) break;
      const before = seen.size;

      for (const c of list) {
        const id = String(c?.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (String(c?.status ?? "").toUpperCase() !== "CAPTURED") continue;
        // A charge Tap marks as not live is test money, never cash.
        if (c?.live_mode === false) {
          testRows++;
          continue;
        }
        let at = num(c?.transaction?.created);
        // Documented as milliseconds; a seconds value would read as 1973.
        if (at > 0 && at < 1e11) at *= 1000;
        if (!at) {
          undated++;
          continue;
        }
        if (newestAt === null || at > newestAt) newestAt = at;
        const currency = String(c?.currency ?? "").toUpperCase() || "(none)";
        const amount = round2(num(c?.amount));
        const rate = USD_PER[currency];
        if (rate === undefined)
          unknown.set(currency, (unknown.get(currency) ?? 0) + 1);
        charges.push({
          id,
          day: kuwaitDay(at),
          at,
          currency,
          amount,
          usd: rate === undefined ? null : round2(amount * rate),
        });
      }

      // A page that carried nothing new means the cursor is not moving, so
      // stop rather than ask the same question forty times.
      if (seen.size === before) break;
      startingAfter = String(list[list.length - 1]?.id ?? "") || null;
      if (reply?.has_more !== true || !startingAfter) break;
      if (page === MAX_PAGES_PER_WINDOW - 1) truncated = true;
    }
  }

  charges.sort((a, b) => a.at - b.at);
  return {
    charges,
    newestAt,
    unconverted: [...unknown].map(([currency, count]) => ({ currency, count })),
    undated,
    testRows,
    requests,
    truncated,
  };
}
