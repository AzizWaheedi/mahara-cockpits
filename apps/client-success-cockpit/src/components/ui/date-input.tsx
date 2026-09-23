import { CalendarDays } from "lucide-react";
import * as React from "react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function parseDay(
  value: string | number | readonly string[] | undefined,
): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
}

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Calendar UI with the same ISO value and onChange contract as an input[type=date]. */
export function DateInput({
  value,
  defaultValue,
  onChange,
  className,
  disabled,
  min,
  max,
  required,
  name,
  id,
  title,
  placeholder,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const [localValue, setLocalValue] = React.useState(
    String(defaultValue ?? ""),
  );
  const [open, setOpen] = React.useState(false);
  const eventTarget = React.useRef<HTMLInputElement>(null);
  const selectedValue = value !== undefined ? String(value) : localValue;
  const selectedDay = parseDay(selectedValue);
  const minDay = parseDay(min);
  const maxDay = parseDay(max);

  function choose(nextValue: string) {
    if (value === undefined) setLocalValue(nextValue);
    if (eventTarget.current) {
      eventTarget.current.value = nextValue;
      const nativeEvent = new Event("change", { bubbles: true });
      onChange?.({
        target: eventTarget.current,
        currentTarget: eventTarget.current,
        nativeEvent,
        type: "change",
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        eventPhase: 3,
        isTrusted: false,
        timeStamp: nativeEvent.timeStamp,
        preventDefault: () => nativeEvent.preventDefault(),
        stopPropagation: () => nativeEvent.stopPropagation(),
        isDefaultPrevented: () => nativeEvent.defaultPrevented,
        isPropagationStopped: () => false,
        persist: () => {},
      } as React.ChangeEvent<HTMLInputElement>);
    }
    setOpen(false);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            title={title}
            aria-label={ariaLabel}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            disabled={disabled}
            data-cockpit-date=""
            className={`cockpit-date-trigger ${className ?? ""}`}
          >
            <span className={selectedDay ? "" : "cockpit-date-placeholder"}>
              {selectedDay
                ? selectedDay.toLocaleDateString("en", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : (placeholder ?? "Choose date")}
            </span>
            <CalendarDays aria-hidden="true" size={16} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="cockpit-date-popover w-auto p-0"
        >
          <Calendar
            mode="single"
            selected={selectedDay}
            defaultMonth={selectedDay ?? new Date()}
            onSelect={day => day && choose(isoDay(day))}
            disabled={day =>
              Boolean((minDay && day < minDay) || (maxDay && day > maxDay))
            }
            startMonth={minDay}
            endMonth={maxDay}
            captionLayout="dropdown"
          />
          {!required && selectedValue && (
            <div className="cockpit-date-footer">
              <button type="button" onClick={() => choose("")}>
                Clear date
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <input
        ref={eventTarget}
        type="date"
        value={selectedValue}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={() => {}}
      />
      {name && (
        <input
          type="hidden"
          name={name}
          value={selectedValue}
          disabled={disabled}
        />
      )}
    </>
  );
}
