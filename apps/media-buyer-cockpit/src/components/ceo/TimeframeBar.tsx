import { RangeControl } from "./chartKit";
import type { Timeframe } from "./timeframe";
import { range as rangeText } from "./windows";

/**
 * The one timeframe control a tab carries (Aziz, 2026-09-21): the same
 * presets as the charts, the days it covers spelled out, and the earlier
 * window it is compared with when one lines up.
 */
export function TimeframeBar({
  tf,
  bounds,
  compare,
  ariaLabel,
  first,
  last,
  note,
}: {
  tf: Timeframe;
  bounds: { from: string; to: string } | null;
  compare?: { from: string; to: string } | null;
  ariaLabel: string;
  first: string | null;
  last: string | null;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground tabular-nums">
        {bounds ? (
          <span className="font-medium text-foreground">
            {rangeText(bounds.from, bounds.to)}
          </span>
        ) : (
          "Pick both dates"
        )}
        {bounds && compare
          ? `, compared with ${rangeText(compare.from, compare.to)}`
          : bounds
            ? ", shown without a comparison"
            : ""}
        {note ? <span className="block text-xs">{note}</span> : null}
      </p>
      <div role="group" aria-label={ariaLabel}>
        <RangeControl
          range={tf.range}
          onRange={tf.setRange}
          custom={tf.custom}
          onCustom={tf.setCustom}
          first={first}
          last={last}
        />
      </div>
    </div>
  );
}
