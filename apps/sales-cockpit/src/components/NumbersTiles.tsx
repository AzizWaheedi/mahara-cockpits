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

/** "62.5% show rate", or what is missing when the rate cannot be worked out. */
function rateLine(value: string, words: string, none: string): string {
  return value === "--" ? none : `${value} ${words}`;
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Booked"
          value={count(card.calls_scheduled)}
          hint="Intros and demos whose time falls in this window."
        />
        <StatTile
          label="Due"
          value={count(card.calls_due)}
          hint="Booked calls whose time has passed, whatever happened on them."
        />
        <StatTile
          label="Shown"
          value={count(card.calls_shown)}
          sub={rateLine(
            pct(card.show_rate, 1),
            "show rate",
            "No calls due yet",
          )}
          hint="Marked showed, or confirmed or disqualified once the call time has passed. A past call nobody marked counts as shown until it is marked."
        />
        <StatTile
          label="Qualified rate"
          value={share(card.calls_qualified, card.calls_shown, 1)}
          sub={`${count(card.calls_qualified)} qualified of ${count(card.calls_shown)} shown`}
          hint="Qualified is shown minus disqualified."
        />
        <StatTile
          label="No-shows"
          value={count(card.noshow_count)}
          sub={rateLine(
            pct(card.noshow_rate, 1),
            "of due calls",
            "No calls due yet",
          )}
        />
        <StatTile label="Cancelled" value={count(card.cancelled_count)} />
        <StatTile
          label="Disqualified"
          value={count(card.disqualified_count)}
          sub={rateLine(
            pct(card.disqualified_rate, 1),
            "of due calls",
            "No calls due yet",
          )}
        />
      </div>
    </SectionCard>
  );
}

export function NumbersClosing({ card }: { card: Scorecard }) {
  return (
    <SectionCard title="Closing">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Closes"
          value={count(card.closes)}
          sub="on the New Client Form"
          hint="Deals are dated by the day the New Client Form was sent, so a short window can close more than it showed."
        />
        <StatTile
          label="Close rate"
          value={share(card.closes, card.demos_shown, 1)}
          sub={`${count(card.closes)} of ${count(card.demos_shown)} demos shown`}
        />
        <StatTile
          label="Qualified close rate"
          value={pct(card.close_rate, 1)}
          sub={`on ${count(card.demos_qualified)} qualified demos`}
          hint="B2B's close rate: closes over demos that showed and were not disqualified."
        />
        <StatTile
          label="Cash collected"
          value={money(card.cash_collected)}
          sub="deposits on the New Client Form"
        />
        <StatTile label="Revenue contracted" value={money(card.revenue)} />
        <StatTile
          label="Average deal"
          value={money(card.avg_deal)}
          sub="revenue contracted per close"
        />
        <StatTile
          label="Cash per call"
          value={money(per(card.cash_collected, card.demos_due))}
          sub={`over ${count(card.demos_due)} demos due`}
        />
        <StatTile
          label="Cash per show"
          value={money(per(card.cash_collected, card.demos_shown))}
          sub={`over ${count(card.demos_shown)} demos shown`}
        />
      </div>
    </SectionCard>
  );
}
