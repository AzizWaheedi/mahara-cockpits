import { useState } from "react";
import { PRESETS, type Range, customRange, kuwaitDay } from "@/lib/range";

/**
 * Pick a window: a preset, or two dates.
 *
 * Deliberately a row of small buttons rather than a dropdown — the whole point
 * is that switching from "7 days" to "today" is one click, not three.
 */
export function RangePicker({
  value,
  onChange,
  compact,
}: {
  value: Range;
  onChange: (r: Range) => void;
  compact?: boolean;
}) {
  const [showCustom, setShowCustom] = useState(value.key === "custom");
  const [start, setStart] = useState(value.start);
  const [end, setEnd] = useState(value.end);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {!compact && (
        <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Range
        </span>
      )}
      {PRESETS.map(p => {
        const active = value.key === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              setShowCustom(false);
              onChange(p.make());
            }}
            className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {p.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setShowCustom(s => !s)}
        className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
          value.key === "custom"
            ? "border-primary bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted"
        }`}
      >
        Custom
      </button>
      {showCustom && (
        <span className="flex items-center gap-1">
          <input
            type="date"
            value={start}
            max={kuwaitDay(0)}
            onChange={e => {
              setStart(e.target.value);
              if (e.target.value && end) {
                onChange(customRange(e.target.value, end));
              }
            }}
            className="rounded border bg-background px-1 py-0.5 text-[11px]"
          />
          <span className="text-[11px] text-muted-foreground">→</span>
          <input
            type="date"
            value={end}
            max={kuwaitDay(0)}
            onChange={e => {
              setEnd(e.target.value);
              if (start && e.target.value) {
                onChange(customRange(start, e.target.value));
              }
            }}
            className="rounded border bg-background px-1 py-0.5 text-[11px]"
          />
        </span>
      )}
    </div>
  );
}
