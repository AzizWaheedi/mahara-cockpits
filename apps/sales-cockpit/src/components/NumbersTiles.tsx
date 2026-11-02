import type { ReactNode } from "react";
import { count, money, num, pct, share } from "../lib/format";
import type { Scorecard } from "../lib/types";
import { SectionCard, StatTile } from "./kit";

/**
 * B2B's scorecard for one person (or the team) as two cards of tiles. Every
 * count is B2B's own; the rates B2B gives are shown as it gives them (pct),
 * the rest are worked out here from its counts (share). A rate with nothing
 * to divide by is n/a, never 0%.
 */

/** "62.5% call show rate", or what is missing when the rate cannot be worked out. */
function rateLine(value: string, words: string, none: string): string {
  return value === "n/a" ? none : `${value} ${words}`;
}

function per(cash: unknown, calls: unknown): number | null {
  const c = num(cash);
  const n = num(calls);
  return c === null || n === null || n <= 0 ? null : c / n;
}

export function NumbersCalls({
  card,
  side,
}: {
  card: Scorecard;
  side?: ReactNode;
}) {
  return (
    <SectionCard title="Calls" side={side}>
      <div className="@container">
        <div className="grid grid-cols-2 gap-4 @md:grid-cols-3 @2xl:grid-cols-4">
          {/* calls_scheduled is by the day of the call, so "Scheduled", not
              "Booked": bookings by the day they were made are another count
              (2026-11-02, Goals sheet round 2, fix 17). */}
          <StatTile
            variant="plain"
            label="Scheduled"
            value={count(card.calls_scheduled)}
            hint="Intros and demos whose time falls in this window, by the day of the call. Calls booked in the window, by the day they were booked, are another count."
          />
          <StatTile
            variant="plain"
            label="Due"
            value={count(card.calls_due)}
            hint="Booked calls whose time has passed, whatever happened on them."
          />
          <StatTile
            variant="plain"
            label="Shown"
            value={count(card.calls_shown)}
            sub={rateLine(
              pct(card.show_rate, 1),
              "call show rate (intros and demos)",
              "No calls due yet",
            )}
            hint="Marked showed, or confirmed or disqualified once the call time has passed. A past call nobody marked counts as shown until it is marked. The call show rate is intros and demos together, shown over due; the CEO's Goals sheet shows the intro and demo show rates apart."
          />
          <StatTile
            variant="plain"
            label="Qualified rate"
            value={share(card.calls_qualified, card.calls_shown, 1)}
            sub={`${count(card.calls_qualified)} qualified of ${count(card.calls_shown)} shown`}
            hint="Qualified is shown minus disqualified."
          />
          <StatTile
            variant="plain"
            label="No-shows"
            value={count(card.noshow_count)}
            sub={rateLine(
              pct(card.noshow_rate, 1),
              "of due calls",
              "No calls due yet",
            )}
          />
          <StatTile
            variant="plain"
            label="Cancelled"
            value={count(card.cancelled_count)}
          />
          <StatTile
            variant="plain"
            label="Disqualified"
            value={count(card.disqualified_count)}
            sub={rateLine(
              pct(card.disqualified_rate, 1),
              "of due calls",
              "No calls due yet",
            )}
          />
        </div>
      </div>
    </SectionCard>
  );
}

export function NumbersClosing({ card }: { card: Scorecard }) {
  return (
    <SectionCard title="Closing">
      <div className="@container">
        <div className="grid grid-cols-2 gap-4 @md:grid-cols-3 @2xl:grid-cols-4">
          <StatTile
            variant="plain"
            label="Closes"
            value={count(card.closes)}
            sub="on the New Client Form"
            hint="Deals are dated by the day the New Client Form was sent, so a short window can close more than it showed."
          />
          <StatTile
            variant="plain"
            label="Close rate"
            value={share(card.closes, card.demos_shown, 1)}
            sub={`${count(card.closes)} of ${count(card.demos_shown)} demos shown`}
          />
          <StatTile
            variant="plain"
            label="Qualified close rate"
            value={pct(card.close_rate, 1)}
            sub={`on ${count(card.demos_qualified)} qualified demos`}
            hint="B2B's close rate: closes over demos that showed and were not disqualified."
          />
          {/* The scorecard's cash_collected is the deposit typed on the form.
              "Cash collected" is the deal ledger's money on the CEO's Goals
              sheet, so this tile says what it is (2026-11-02, fix 14). */}
          <StatTile
            variant="plain"
            label="Deposits typed"
            value={money(card.cash_collected)}
            sub="on the New Client Form"
            hint="The deposits the closers typed on the New Client Form, not money seen on a payment rail. Cash collected, the money actually paid on signed deals (the deal ledger), is on the CEO's Goals sheet."
          />
          <StatTile
            variant="plain"
            label="Revenue contracted"
            value={money(card.revenue)}
          />
          <StatTile
            variant="plain"
            label="Average deal"
            value={money(card.avg_deal)}
            sub="revenue contracted per close"
          />
          <StatTile
            variant="plain"
            label="Deposits per call"
            value={money(per(card.cash_collected, card.demos_due))}
            sub={`typed, over ${count(card.demos_due)} demos due`}
          />
          <StatTile
            variant="plain"
            label="Deposits per show"
            value={money(per(card.cash_collected, card.demos_shown))}
            sub={`typed, over ${count(card.demos_shown)} demos shown`}
          />
        </div>
      </div>
    </SectionCard>
  );
}
