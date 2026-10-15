/**
 * The Payments strip on Today and Ads, as plain rules.
 *
 * Aziz, 2026-10-13: "I want the payment section to be a bit less noisy at the
 * top of the ad section. Make it foldable, cleaner, or less messy, so we can
 * focus on the ads." The old "Ad billing watch" card listed every flagged
 * account and every receipt above the first ad (about 2,000px). The strip is
 * one row: counts, the accounts that stopped spending, the one action that
 * matters (the client messages waiting for review), and Show. Everything
 * else waits in the opened panel. The strip, the board's row chips and the
 * tests read these rules, so they cannot drift.
 */
import { dateTime, plural, shortDate } from "@/components/ceo/format";
import type { StatusTone } from "@/components/ceo/StatusChip";

export type Delivery = {
  channel: string;
  channelLabel?: string;
  state: string;
  error: string | null;
  providerId: string | null;
  taskId?: string | null;
  commentRole?: "client" | "ads" | null;
};
export type Binding = {
  id: string;
  client: string;
  clientTaskId: string;
  accountId: string;
  signal: string;
  enabled: boolean;
  ready: boolean;
  checkedAt: string | null;
  lastGoodAt: string | null;
  error: string | null;
  deliveries: Delivery[];
  review?: {
    state: string;
    reason: string | null;
    decidedAt: string | null;
  } | null;
};
/** What `cockpit_ad_billing_panel()` returns. */
export type BillingPanel = {
  apply: boolean;
  finishedAt: string | null;
  error: string | null;
  bindings: Binding[];
  roster: { client: string; clientTaskId: string; enrolled: boolean }[];
};
/** The campaign fields the strip reads from the media buyer snapshot. */
export type StripCampaign = {
  metaAccountId?: string | null;
  dataThrough?: string | null;
  internal?: boolean;
  /** Meta's flag on the campaign's ad account: what the Payment problem filter reads. */
  accountIssue?: unknown;
  /** Off on the board and not running on Meta: on the Off tab, so the filter never shows it. */
  parked?: boolean;
};

/**
 * One "overdue" line for every check in the strip: the watchdog's 30 minutes
 * (supabase/migrations/20261013104500_ad_billing_watchdog_quieter.sql). The
 * worker runs every 5 minutes and has short, harmless misses; at 15 minutes
 * one missed run turned all 16 accounts into "Check overdue" cards.
 */
export const OVERDUE_MS = 30 * 60_000;
/**
 * A flagged account has stopped spending when its last day of spend is this
 * many days behind the newest day any campaign reports. Meta reports up to
 * yesterday, and a healthy campaign can miss one day.
 */
export const STOPPED_DAYS = 2;
/** Accounts shown in the opened panel before "Show the other N". */
export const FIRST_ROWS = 5;
/** Where the fold is remembered on this device; Today and Ads share it. */
export const STRIP_KEY = "mahara-buyer-billing-strip";
/** The board filter the strip's count chips turn on. */
export const PAYMENT_FILTER = "Payment problem";
/** The client success review page (media buyers can open it too). */
export const REVIEW_HREF = "/client-success/ad-billing";

/** The words and tone of each Meta billing signal, most urgent first. */
export const SIGNALS: Record<
  string,
  { label: string; tone: StatusTone; rank: number }
> = {
  unsettled: { label: "Unpaid balance", tone: "critical", rank: 0 },
  restricted: { label: "Account restricted", tone: "critical", rank: 1 },
  payment_grace: { label: "Payment grace period", tone: "warning", rank: 2 },
  unknown: { label: "Not verified yet", tone: "neutral", rank: 3 },
};

export type StripAccount = {
  id: string;
  /** The panel's Meta signal: unsettled, restricted, payment_grace, healthy… */
  signal: string;
  client: string;
  clientTaskId: string;
  accountId: string;
  label: string;
  tone: StatusTone;
  rank: number;
  /** Why this account's own check cannot be trusted, in words. */
  fault: string | null;
  /** The client message's state, in words. */
  review: string | null;
  pending: boolean;
  sent: number;
  waiting: number;
  failures: { label: string; state: string; error: string | null }[];
  /** The newest day any of this account's campaigns spent, or null. */
  lastSpend: string | null;
  stopped: boolean;
  /**
   * The board's Payment problem filter shows a campaign of this account: a
   * running campaign whose account Meta flags. False when it has no such
   * campaign, so a count chip sends you to the panel instead.
   */
  onBoard: boolean;
};

export type Strip = {
  /** Nothing to say: the row is not drawn at all. */
  hidden: boolean;
  /** Replaces the counts when the checks are overdue or failed. */
  sentence: string | null;
  counts: {
    unpaid: number;
    restricted: number;
    grace: number;
    /** Attention rows that are not one of the three signals above. */
    other: number;
  };
  pending: number;
  failed: number;
  /** Flagged accounts that have stopped spending, and since when. */
  stopped: { count: number; since: string } | null;
  accounts: StripAccount[];
  unmapped: { client: string; clientTaskId: string }[];
  enrolled: number;
  rosterSize: number;
  apply: boolean;
  lastRun: string | null;
};

const SENT = new Set(["accepted"]);
const WAITING = new Set(["queued", "retry", "claimed", "sending"]);
const IGNORED = new Set(["skipped"]);

/** "act_123" and "123" are the same account. */
const accountKey = (id: unknown) =>
  String(id ?? "")
    .trim()
    .replace(/^act_/, "");

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/** Where a delivery went, in words. */
export function deliveryLabel(d: Delivery): string {
  if (d.channel === "whatsapp") return "Client WhatsApp";
  if (d.channel === "slack") return d.channelLabel ?? "Media announcements";
  if (d.commentRole === "client") return "Client task comment";
  if (d.commentRole === "ads") return "Ads Management comment";
  return "ClickUp comment";
}

function reviewWords(review: Binding["review"]): string | null {
  if (!review) return null;
  if (review.state === "pending") return "Client message waiting for review";
  if (review.state === "approved") return "Client message approved";
  if (review.state === "denied")
    return `Client message denied${review.reason ? `: ${review.reason}` : ""}`;
  if (review.state === "expired") return "Client message expired";
  return `Client message ${String(review.state).replace(/_/g, " ")}`;
}

/** The whole strip from the panel read and the snapshot's campaigns. */
export function billingStrip(
  data: BillingPanel,
  {
    now = Date.now(),
    campaigns = [],
  }: { now?: number; campaigns?: StripCampaign[] } = {},
): Strip {
  const runAt = data.finishedAt ? Date.parse(data.finishedAt) : Number.NaN;
  const overdue = !Number.isFinite(runAt) || now - runAt > OVERDUE_MS;

  // The newest day each account spent, and the newest day any campaign has.
  const spent = new Map<string, string>();
  let latest: string | null = null;
  for (const c of campaigns) {
    const day = c.dataThrough;
    if (c.internal || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!latest || day > latest) latest = day;
    const key = accountKey(c.metaAccountId);
    if (!key) continue;
    const had = spent.get(key);
    if (!had || day > had) spent.set(key, day);
  }
  // The accounts the board's Payment problem filter shows (2026-10-13: a
  // restricted account with no campaign on the board was a dead end).
  const onBoard = new Set<string>();
  for (const c of campaigns) {
    const key = accountKey(c.metaAccountId);
    if (key && !c.parked && hasPaymentProblem(c)) onBoard.add(key);
  }

  const accounts: StripAccount[] = [];
  let pending = 0;
  let failed = 0;
  const counts = { unpaid: 0, restricted: 0, grace: 0, other: 0 };
  for (const b of data.bindings) {
    if (b.review?.state === "pending") pending++;
    if (b.signal === "unsettled") counts.unpaid++;
    else if (b.signal === "restricted") counts.restricted++;
    else if (b.signal === "payment_grace") counts.grace++;

    const lastGood = b.lastGoodAt ? Date.parse(b.lastGoodAt) : Number.NaN;
    // When the whole run is overdue the strip says so once; each account
    // does not repeat it.
    const late =
      !overdue && (!Number.isFinite(lastGood) || now - lastGood > OVERDUE_MS);
    const fault = b.error
      ? `The last check of this account failed: ${b.error}`
      : !b.enabled
        ? "Monitoring is off for this account."
        : !b.ready
          ? "The manual handover is not verified, so no client message goes out."
          : late
            ? Number.isFinite(lastGood)
              ? `Not checked since ${dateTime(lastGood, now)}.`
              : "Never checked."
            : null;
    let sent = 0;
    let waiting = 0;
    const failures: StripAccount["failures"] = [];
    for (const d of b.deliveries ?? []) {
      if (SENT.has(d.state)) sent++;
      else if (WAITING.has(d.state)) waiting++;
      else if (!IGNORED.has(d.state))
        failures.push({
          label: deliveryLabel(d),
          state: d.state,
          error: d.error,
        });
    }
    failed += failures.length;

    const flagged = b.signal !== "healthy";
    if (!flagged && !fault && failures.length === 0) continue;
    const shown = flagged
      ? (SIGNALS[b.signal] ?? {
          label: "Unverified state",
          tone: "neutral" as StatusTone,
          rank: 3,
        })
      : fault
        ? {
            label: b.error
              ? "Check failed"
              : !b.enabled
                ? "Monitoring off"
                : !b.ready
                  ? "Handover not verified"
                  : "Check overdue",
            tone: (b.error || late ? "warning" : "neutral") as StatusTone,
            rank: 4,
          }
        : { label: "Message failed", tone: "warning" as StatusTone, rank: 5 };
    // Accounts whose state is not known: an unknown signal or a check that
    // cannot be trusted. A failed message alone has its own chip.
    if (shown.rank === 3 || shown.rank === 4) counts.other++;
    const lastSpend = spent.get(accountKey(b.accountId)) ?? null;
    accounts.push({
      id: b.id,
      signal: b.signal,
      client: b.client,
      clientTaskId: b.clientTaskId,
      accountId: accountKey(b.accountId),
      label: shown.label,
      tone: shown.tone,
      rank: shown.rank,
      fault,
      review: reviewWords(b.review),
      pending: b.review?.state === "pending",
      sent,
      waiting,
      failures,
      lastSpend,
      stopped: Boolean(
        flagged &&
          lastSpend &&
          latest &&
          dayNumber(latest) - dayNumber(lastSpend) >= STOPPED_DAYS,
      ),
      onBoard: onBoard.has(accountKey(b.accountId)),
    });
  }
  // Most urgent first: the signal, then an account that has stopped
  // spending (the longest stopped first), then a message waiting.
  accounts.sort(
    (a, b) =>
      a.rank - b.rank ||
      Number(b.stopped) - Number(a.stopped) ||
      (a.stopped && b.stopped
        ? String(a.lastSpend).localeCompare(String(b.lastSpend))
        : 0) ||
      Number(b.pending) - Number(a.pending) ||
      a.client.localeCompare(b.client),
  );

  const halted = accounts.filter(a => a.stopped);
  const stopped = halted.length
    ? {
        count: halted.length,
        // Every one of them has not spent since this day, at least.
        since: halted
          .map(a => String(a.lastSpend))
          .sort()
          .pop() as string,
      }
    : null;

  const unmapped = data.roster
    .filter(c => !c.enrolled)
    .map(c => ({ client: c.client, clientTaskId: c.clientTaskId }));

  // Each sentence says what is true and what to do next; the time is when
  // the last check finished, not when it became overdue.
  const sentence = data.error
    ? `The last billing check failed${Number.isFinite(runAt) ? ` (${dateTime(runAt, now)})` : ""}. Treat these as old until the next one passes.`
    : overdue
      ? Number.isFinite(runAt)
        ? `No billing check has finished since ${dateTime(runAt, now)}, so these may be old. Refresh, and tell technical operations if this stays.`
        : "No billing check has finished yet, so nothing here is confirmed. Ask technical operations to check the billing worker."
      : data.roster.length === 0
        ? "No client is covered by the billing check yet. Ask technical operations to enrol the active clients."
        : null;

  return {
    hidden:
      !sentence &&
      accounts.length === 0 &&
      pending === 0 &&
      failed === 0 &&
      unmapped.length === 0,
    sentence,
    counts,
    pending,
    failed,
    stopped: sentence ? null : stopped,
    accounts,
    unmapped,
    enrolled: data.roster.length - unmapped.length,
    rosterSize: data.roster.length,
    apply: data.apply,
    lastRun: Number.isFinite(runAt) ? dateTime(runAt, now) : null,
  };
}

export type StripChip = {
  key: "unpaid" | "restricted" | "grace" | "other" | "failed" | "unmapped";
  label: string;
  tone: StatusTone;
  /** "board" turns on the board's Payment problem filter; "panel" opens the detail. */
  action: "board" | "panel";
};

const CHIP_SIGNAL: Partial<Record<StripChip["key"], string>> = {
  unpaid: "unsettled",
  restricted: "restricted",
  grace: "payment_grace",
};

/** The accounts a count chip counts (none for the unmapped clients). */
export function chipAccounts(s: Strip, key: StripChip["key"]): StripAccount[] {
  const signal = CHIP_SIGNAL[key];
  if (signal) return s.accounts.filter(a => a.signal === signal);
  if (key === "other")
    return s.accounts.filter(a => a.rank === 3 || a.rank === 4);
  if (key === "failed") return s.accounts.filter(a => a.failures.length > 0);
  return [];
}

/**
 * A chip that opens the panel shows every row when one of its accounts sits
 * past the first rows, so what it counts is always in sight.
 */
export function chipNeedsAll(s: Strip, key: StripChip["key"]): boolean {
  return chipAccounts(s, key).some(a => s.accounts.indexOf(a) >= FIRST_ROWS);
}

/**
 * A signal's chip turns on the board's filter only when the board shows
 * every account it counts; otherwise it opens the panel, which lists them all.
 */
const signalAction = (s: Strip, key: StripChip["key"]): StripChip["action"] =>
  chipAccounts(s, key).every(a => a.onBoard) ? "board" : "panel";

/** The count chips on the row, most urgent first; zero counts are left out. */
export function stripChips(s: Strip): StripChip[] {
  if (s.sentence) return [];
  const all: (StripChip & { n: number })[] = [
    {
      key: "unpaid",
      n: s.counts.unpaid,
      label: `${s.counts.unpaid} unpaid`,
      tone: "critical",
      action: signalAction(s, "unpaid"),
    },
    {
      key: "restricted",
      n: s.counts.restricted,
      label: `${s.counts.restricted} restricted`,
      tone: "critical",
      action: signalAction(s, "restricted"),
    },
    {
      key: "grace",
      n: s.counts.grace,
      label: `${s.counts.grace} in grace period`,
      tone: "warning",
      action: signalAction(s, "grace"),
    },
    {
      key: "other",
      n: s.counts.other,
      label: `${plural(s.counts.other, "account")} to check`,
      tone: "warning",
      action: "panel",
    },
    {
      key: "failed",
      n: s.failed,
      label: `${plural(s.failed, "message")} to check`,
      tone: "warning",
      action: "panel",
    },
    {
      key: "unmapped",
      n: s.unmapped.length,
      label: `${plural(s.unmapped.length, "client")} not mapped`,
      tone: "neutral",
      action: "panel",
    },
  ];
  return all.filter(c => c.n > 0).map(({ n: _n, ...chip }) => chip);
}

/** "3 accounts have not spent since 9 Oct". */
export function stoppedLine(s: Strip): string | null {
  return s.stopped
    ? `${plural(s.stopped.count, "account")} ${s.stopped.count === 1 ? "has" : "have"} not spent since ${shortDate(s.stopped.since)}`
    : null;
}

/** "Review 9 client messages". */
export function reviewLabel(n: number): string {
  return `Review ${plural(n, "client message")}`;
}

/** "1 active client has no ad account mapped". */
export function unmappedLine(n: number): string {
  return `${plural(n, "active client")} ${n === 1 ? "has" : "have"} no ad account mapped`;
}

/** "4 sent · 1 waiting", failures listed apart. Null when nothing went out. */
export function receiptsLine(a: StripAccount): string | null {
  const parts = [
    a.sent ? `${a.sent} sent` : "",
    a.waiting ? `${a.waiting} waiting` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Meta's billing page for one ad account. */
export function metaBillingUrl(accountId: string): string {
  return `https://business.facebook.com/billing_hub/accounts/details/?asset_id=${encodeURIComponent(accountKey(accountId))}`;
}

/** The fold, remembered on this device. Starts folded; never throws. */
export function readFold(storage?: Pick<Storage, "getItem">): boolean {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(STRIP_KEY);
    if (!raw) return false;
    return (JSON.parse(raw) as { open?: unknown })?.open === true;
  } catch {
    return false;
  }
}

export function writeFold(open: boolean, storage?: Pick<Storage, "setItem">) {
  try {
    (storage ?? globalThis.localStorage)?.setItem(
      STRIP_KEY,
      JSON.stringify({ open }),
    );
  } catch {
    // Private windows and blocked storage: the fold just is not remembered.
  }
}

/**
 * The chip on a board row for a campaign whose ad account Meta flags
 * (`accountIssue`, written by hermes/cockpit-sync/calculator.ts from
 * account_status). A grace period or a pending review still runs on Meta,
 * so it is a warning, never "Account blocked" in red.
 */
export function accountIssueFlag(
  issue: unknown,
): { label: string; tone: "critical" | "warning" } | null {
  const text = typeof issue === "string" ? issue : "";
  if (!text) return null;
  if (/unsettled/i.test(text))
    return { label: "Unpaid balance", tone: "critical" };
  if (/grace/i.test(text))
    return { label: "Payment grace period", tone: "warning" };
  if (/pending review|settlement/i.test(text))
    return { label: "Payment under review", tone: "warning" };
  if (/disabled/i.test(text))
    return { label: "Account disabled", tone: "critical" };
  if (/clos/i.test(text)) return { label: "Account closed", tone: "critical" };
  return { label: "Account blocked", tone: "critical" };
}

/** The board's "Payment problem" filter: Meta flags the campaign's ad account. */
export const hasPaymentProblem = (c: { accountIssue?: unknown }) =>
  accountIssueFlag(c.accountIssue) !== null;
