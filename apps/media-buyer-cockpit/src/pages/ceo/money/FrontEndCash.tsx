import { change, money, shortDate } from "@/components/ceo/format";
import {
  attributedLine,
  FRONT_END_CASH_HINT,
  FRONT_END_CASH_NA,
  frontEndCashSub,
  frontEndOf,
  paidFrontEnd,
  paidSplit,
  typedNotSeenText,
} from "@/components/ceo/timeframe";
import type { FunnelWindow } from "@/types/ceo/payloads";
import { byCloserFromLines, byCloserText, type MoneyLine } from "./credit";

/**
 * The front-end cash tile on Sales and Frontend (Aziz, 2026-10-18;
 * MONEY-ATTRIBUTION.md rule 6): the money paid on signed deals, with the
 * typed amounts beside it as typed, not money, when the money was last
 * attributed (and that it may be behind past 2 hours), and who it is
 * credited to. Missing is n/a, never $0 and never the typed figure.
 */

/** The value, delta inputs, line, hint and n/a reason for the tile. */
export function frontEndTile(
  w: FunnelWindow,
  prev: FunnelWindow | null,
  attributedAt: number | null,
  now: number,
) {
  const fe = frontEndOf(w);
  const paid = paidFrontEnd(w);
  const at = attributedLine(attributedAt ?? fe.attributedAt, now);
  return {
    paid,
    value: money(paid),
    change: change(paid, paidFrontEnd(prev)),
    sub: (
      <>
        <span className="block">{frontEndCashSub(fe, w.from)}</span>
        {paid !== null && at ? (
          <span
            className={
              at.stale ? "block font-medium text-[var(--ceo-warning)]" : "block"
            }
          >
            {at.text}
          </span>
        ) : null}
      </>
    ),
    hint: FRONT_END_CASH_HINT,
    naHint: FRONT_END_CASH_NA,
  };
}

/**
 * The facts under the tiles: who the money is credited to, what it is made
 * of, and the typed amounts no payment matches. A window the server keeps
 * no split for (a custom range) takes the closers from the Money tab's
 * payments for the same days, and says so.
 */
export function frontEndFacts(
  w: FunnelWindow,
  lines: MoneyLine[],
): { label: string; value: string | null; hint?: string }[] {
  const fe = frontEndOf(w);
  if (paidFrontEnd(w) === null) return [];
  const own = Array.isArray(fe.byCloser);
  const closers = own ? fe.byCloser : byCloserFromLines(lines, w.from, w.to);
  const typedOut = typedNotSeenText(fe);
  return [
    {
      label: "By closer",
      value: byCloserText(closers),
      hint: own
        ? "Front-end cash in this window by the deal's closer, as written on the closer form."
        : "Front-end money in the Money tab's list of payments for these days, by the deal's closer as written on the form. Webinar deals are not taken out here, so it can sit above the figure.",
    },
    {
      label: "Paid as",
      value: paidSplit(fe),
      hint: "The deposit is a deal's money up to what the closer typed on the form; the rest is everything after it until the contract is paid.",
    },
    {
      label: "Counted from",
      value: fe.paidFrom ? shortDate(fe.paidFrom) : null,
      hint: "The deal ledger starts on this day, so the days before it in this window are not counted.",
    },
    {
      label: "Typed, no payment seen",
      value: typedOut?.value ?? null,
      hint: typedOut?.hint,
    },
  ];
}
