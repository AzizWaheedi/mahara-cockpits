import { money, shortDate } from "@/components/ceo/format";
import { CPB_BAD, CPB_GATE, CPL_BAD, CPL_GATE } from "./kpi";

/**
 * The colour of a cost on the Ads page, from Muhammed's grid in kpi.ts
 * (2026-10-13), not the old single gates: cost per lead is good up to
 * CPL_GATE, a warning up to CPL_BAD and bad above it; cost per booking is
 * good up to CPB_GATE, a warning up to CPB_BAD and bad above it. The board
 * cells, the Blended CPL tile and a client's page all read these two.
 */
export type CostTone = "good" | "warn" | "bad";

const band = (
  v: number | null | undefined,
  gate: number,
  bad: number,
): CostTone | undefined =>
  v === null || v === undefined || !Number.isFinite(v)
    ? undefined
    : v <= gate
      ? "good"
      : v <= bad
        ? "warn"
        : "bad";

/** Cost per lead against $15 and $22.50. Undefined when there is no number. */
export const cplTone = (v: number | null | undefined) =>
  band(v, CPL_GATE, CPL_BAD);
/** Cost per booking against $60 and $80. Undefined when there is no number. */
export const cpbTone = (v: number | null | undefined) =>
  band(v, CPB_GATE, CPB_BAD);

/** The text class for a tone (index.css). */
export const COST_TEXT: Record<CostTone, string> = {
  good: "txt-good",
  warn: "txt-warn",
  bad: "txt-bad",
};
/** The text class for a cost, or none when there is no number. */
export const costText = (tone: CostTone | undefined) =>
  tone ? COST_TEXT[tone] : "";
/** The dot colour for a tone. */
export const COST_DOT: Record<CostTone, string> = {
  good: "var(--success)",
  warn: "var(--warning)",
  bad: "var(--destructive)",
};

/** What a cost per booking cell says, its colour and the cost behind both. */
export type CpbShown = {
  /** "$60.62", "$118", "None yet", "None on $233" or "n/a". */
  text: string;
  /** No colour for n/a and for "None yet". */
  tone: CostTone | undefined;
  /**
   * The cost the colour and the "over $60" filter judge, as the cell shows
   * it: per booking, or the spend when nothing was booked on more than
   * CPB_GATE of it.
   */
  judged: number | undefined;
  /** Nothing booked on more than CPB_GATE of spend: "None on $233". */
  noneOnSpend: boolean;
  /** Why the cell reads as it does, for a title or a hint. */
  why?: string;
};

/**
 * The amount a money cell shows (format.ts money): cents under $100, whole
 * dollars from $100. A cost is coloured and filtered on this, never on the
 * unrounded figure, so the colour and the filters always agree with what
 * the cell reads: $60.40 reads "$60.40" and is over $60; $60.004 reads "$60"
 * and is not (2026-10-22).
 */
export function shownMoney(n: number): number {
  const abs = Math.abs(n);
  const cents = Math.round(abs * 100);
  const shown = abs < 100 && cents % 100 !== 0 ? cents / 100 : Math.round(abs);
  return n < 0 ? -shown : shown;
}

const NOT_KNOWN: CpbShown = {
  text: "n/a",
  tone: undefined,
  judged: undefined,
  noneOnSpend: false,
};

/**
 * A known cost per booking as a cell shows it: cents under $100 (Arcturus
 * reads "$60.62", not "$61"; Khalida's $80.27 reads "$80.27" in red, not a
 * red "$80"), coloured on that amount. Undefined reads "n/a".
 */
export function cpbValue(cost: number | null | undefined): CpbShown {
  if (cost === null || cost === undefined || !Number.isFinite(cost))
    return NOT_KNOWN;
  const shown = shownMoney(cost);
  return {
    text: money(cost),
    tone: cpbTone(shown),
    judged: shown,
    noneOnSpend: false,
  };
}

/** The reason a range after the media data's last day has no spend yet. */
export const spendNotInWhy = (last: string) =>
  `Meta's numbers after ${shortDate(last)} are not in yet`;

/**
 * A cost per booking as a cell shows it (2026-10-21). No booking after spend
 * is not "n/a": the grid (kpi.ts gridCell) takes the spend as the least one
 * booking costs, so "None on $233" carries $233's colour, as a $233 booking
 * would. Up to CPB_GATE spent it is too early to judge: "None yet", no colour.
 * Bookings unknown (Done With You, or a read that failed) stay "n/a". `cost`
 * is the caller's own cost per booking when it has one (the 7-day snapshot's);
 * otherwise spend / bookings. Bookings with nothing spent have no cost here,
 * whatever `cost` says: "n/a" with the reason, never $0 (2026-10-22).
 * `spendNotIn` is the media data's last day when the whole range comes after
 * it (Today, before the nightly pull): its bookings are real and counted, and
 * their cost waits for Meta's numbers.
 */
export function cpbDisplay(
  spend: number | null | undefined,
  bookings: number | null | undefined,
  options: { cost?: number | null; spendNotIn?: string | null } = {},
): CpbShown {
  if (bookings === null || bookings === undefined || !Number.isFinite(bookings))
    return NOT_KNOWN;
  const known = typeof spend === "number" && Number.isFinite(spend);
  const spent = known ? spend : 0;
  if (options.spendNotIn && spent <= 0) {
    const why = spendNotInWhy(options.spendNotIn);
    return bookings > 0
      ? {
          ...NOT_KNOWN,
          why: `${why}, so ${bookings === 1 ? "this booking has" : `these ${bookings} bookings have`} no spend to set against yet.`,
        }
      : { ...NOT_KNOWN, text: "None yet", why: `No booking yet. ${why}.` };
  }
  if (bookings > 0) {
    if (known && spent <= 0)
      return {
        ...NOT_KNOWN,
        why: "Nothing was spent in this range: these bookings came from ads that spent before it.",
      };
    const cost =
      typeof options.cost === "number" &&
      Number.isFinite(options.cost) &&
      options.cost > 0
        ? options.cost
        : known
          ? spent / bookings
          : undefined;
    return cost === undefined
      ? { ...NOT_KNOWN, why: "The spend could not be read." }
      : cpbValue(cost);
  }
  if (!known) return { ...NOT_KNOWN, why: "The spend could not be read." };
  // Judged on the spend as the cell shows it, as the "over $60" filter is.
  const shownSpend = shownMoney(spent);
  if (shownSpend <= CPB_GATE)
    return {
      ...NOT_KNOWN,
      text: "None yet",
      why: `No booking yet on ${money(spent)} of spend: too early to judge until it passes $${CPB_GATE}.`,
    };
  return {
    text: `None on ${money(spent)}`,
    tone: cpbTone(shownSpend),
    judged: shownSpend,
    noneOnSpend: true,
    why: `No booking on ${money(spent)} of spend, so one booking costs at least that.`,
  };
}
