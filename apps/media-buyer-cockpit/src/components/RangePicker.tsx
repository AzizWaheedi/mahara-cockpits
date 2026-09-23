import { CalendarDays, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { customRange, kuwaitDay, PRESETS, type Range } from "@/lib/range";

function day(value: string): Date {
  const [year, month, date] = value.split("-").map(Number);
  return new Date(year, month - 1, date);
}

function isoDay(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** Preset range choices and a calendar, using Kuwait days throughout. */
export function RangePicker({
  value,
  onChange,
  compact,
}: {
  value: Range;
  onChange: (range: Range) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => day(value.end));
  const [draft, setDraft] = useState<DateRange>({
    from: day(value.start),
    to: day(value.end),
  });
  const today = day(kuwaitDay());

  useEffect(() => {
    setDraft({ from: day(value.start), to: day(value.end) });
    setMonth(day(value.end));
  }, [value.start, value.end]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Date range: ${value.label}`}
          className={`cockpit-range-trigger ${compact ? "cockpit-range-trigger-compact" : ""}`}
        >
          <CalendarDays aria-hidden="true" size={15} />
          <span>
            {value.key === "custom" && compact ? "Custom" : value.label}
          </span>
          <ChevronDown
            aria-hidden="true"
            size={15}
            className="cockpit-range-chevron"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={7}
        className="cockpit-range-popover w-auto p-0"
      >
        <div className="cockpit-range-layout">
          <div
            className="cockpit-range-presets"
            role="group"
            aria-label="Date range presets"
          >
            {PRESETS.map(preset => (
              <button
                type="button"
                key={preset.key}
                data-active={value.key === preset.key}
                onClick={() => {
                  const next = preset.make();
                  setDraft({ from: day(next.start), to: day(next.end) });
                  setMonth(day(next.end));
                  onChange(next);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="cockpit-range-calendar">
            <Calendar
              mode="range"
              selected={draft}
              month={month}
              onMonthChange={setMonth}
              onSelect={next => {
                if (!next) return;
                setDraft(next);
                if (next.from && next.to)
                  onChange(customRange(isoDay(next.from), isoDay(next.to)));
              }}
              disabled={{ after: today }}
              className="p-3"
            />
            <div className="cockpit-range-summary">
              <span>{draft.from ? isoDay(draft.from) : "Start date"}</span>
              <span aria-hidden="true">→</span>
              <span>{draft.to ? isoDay(draft.to) : "End date"}</span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
