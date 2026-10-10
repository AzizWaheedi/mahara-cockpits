import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { kuwaitDay } from "@/components/ceo/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Ymd } from "@/types/ceo/hoursContract";

/**
 * The roster changes this build makes (design 5.10). Pay and hours now have
 * a history, so every change says from when; each is pre-filled, so an
 * ordinary edit is still one click. Dates are Kuwait days, never UTC.
 */

/** The 1st of the current Kuwait month. */
export function firstOfThisMonth(now: number = Date.now()): Ymd {
  return `${kuwaitDay(now).slice(0, 7)}-01`;
}

/**
 * A small dialog that asks one date: "Last working day", "First day back",
 * "Back on". Pre-set to today in Kuwait.
 */
export function DayDialog({
  open,
  title,
  description,
  label,
  help,
  confirm,
  initial,
  min,
  max,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  label: string;
  help?: string;
  confirm: string;
  initial?: Ymd;
  min?: Ymd;
  max?: Ymd;
  onClose: () => void;
  /** Throws the server's sentence to show under the field. */
  onConfirm: (day: Ymd) => Promise<void>;
}) {
  const id = useId();
  const [day, setDay] = useState<Ymd>(initial ?? kuwaitDay());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) {
          setMsg(null);
          onClose();
        }
      }}
    >
      <DialogContent className="ceo-root sm:max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async e => {
            e.preventDefault();
            setBusy(true);
            setMsg(null);
            try {
              await onConfirm(day);
              onClose();
            } catch (err) {
              setMsg(
                String(err instanceof Error ? err.message : err).split(
                  "\n",
                )[0] || "That did not go through.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-day`}>{label}</Label>
            <DateInput
              id={`${id}-day`}
              required
              value={day}
              min={min}
              max={max}
              onChange={e => setDay(e.target.value)}
              aria-describedby={`${id}-help`}
            />
            <p id={`${id}-help`} className="text-xs text-muted-foreground">
              {msg ? (
                <span className="text-[var(--ceo-critical)]">{msg}</span>
              ) : (
                help
              )}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !day}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Applies from" for a pay edit, pre-set to the 1st, with the typo fix beside it. */
export function PayFrom({
  value,
  replace,
  onChange,
  onReplace,
  disabled,
}: {
  value: Ymd;
  replace: boolean;
  onChange: (day: Ymd) => void;
  onReplace: (replace: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      {replace ? null : (
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Applies from</span>
          <DateInput
            value={value}
            max={kuwaitDay()}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
            aria-label="Pay applies from"
            className="ceo-select-sm w-36"
          />
        </span>
      )}
      <label htmlFor={`${id}-typo`} className="flex items-center gap-1.5">
        <Checkbox
          id={`${id}-typo`}
          checked={replace}
          disabled={disabled}
          onCheckedChange={v => onReplace(v === true)}
          className="size-4"
        />
        <span className="text-muted-foreground">
          Fix a typo (replace the current figure)
        </span>
      </label>
    </span>
  );
}

/** "Applies from" for an hours edit: today, or since the 1st. */
export function ScheduleFrom({
  value,
  onChange,
  disabled,
}: {
  value: Ymd;
  onChange: (day: Ymd) => void;
  disabled?: boolean;
}) {
  const first = firstOfThisMonth();
  const today = kuwaitDay();
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Applies from</span>
      <DateInput
        value={value}
        max={today}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        aria-label="Hours apply from"
        className="ceo-select-sm w-36"
      />
      {value !== first ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(first)}
          className="font-medium text-foreground/80 underline-offset-2 hover:underline"
        >
          Since the 1st
        </button>
      ) : value !== today ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(today)}
          className="font-medium text-foreground/80 underline-offset-2 hover:underline"
        >
          From today
        </button>
      ) : null}
    </span>
  );
}
