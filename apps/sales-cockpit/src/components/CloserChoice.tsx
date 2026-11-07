import { type CloserOption, closerChips, type Person } from "../lib/reschedule";

/**
 * "Who takes the demo" in the picker (the demo's closer picker, 2026-11-07).
 * The CEO, verbatim: "He should also be able to pick the specific closer he
 * wants to book the demo on their calendar for." Anyone free comes first
 * and is the default: the Demo calendar's soonest times, HighLevel's round
 * robin picks who takes it, as before. Then one choice per closer with their
 * soonest time, closers before managers. The chips are the picker's own Why
 * chips, so nothing new to learn. Missing is never zero: a list not read
 * yet, a list that could not be read and a calendar that did not answer
 * each say so.
 */
export function CloserChoice({
  list,
  picked,
  now,
  onPick,
}: {
  /** undefined: not read yet; null: the seats could not be read just now. */
  list: CloserOption[] | null | undefined;
  /** The closer picked (their HighLevel user), or null for Anyone free. */
  picked: string | null;
  now: number;
  onPick: (closer: Person | null) => void;
}) {
  const chips = closerChips(list, now);
  const chip = (on: boolean) =>
    `inline-flex min-h-8 items-center gap-1 rounded-full border px-3 py-1 text-left text-xs pointer-coarse:min-h-10 ${
      on
        ? "border-[color:color-mix(in_oklch,var(--primary)_40%,transparent)] bg-[color:color-mix(in_oklch,var(--primary)_15%,transparent)]"
        : "hairline hover:bg-[color:var(--secondary)]"
    }`;
  const note =
    list === undefined
      ? "Reading the closers' calendars…"
      : list === null
        ? "The closers could not be read just now. Anyone free still works."
        : !chips.length
          ? "No closer is on the Demo calendar in HighLevel, so the calendar picks who takes it."
          : null;
  return (
    <div className="space-y-1.5" data-closer-choice>
      <p className="muted text-xs" aria-hidden>
        Who takes the demo
      </p>
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Who takes the demo"
      >
        <button
          type="button"
          aria-pressed={!picked}
          onClick={() => onPick(null)}
          className={chip(!picked)}
        >
          <span className="font-medium">Anyone free</span>
        </button>
        {chips.map(c => (
          <button
            key={c.user_id}
            type="button"
            aria-pressed={picked === c.user_id}
            aria-label={c.label}
            onClick={() => onPick({ user_id: c.user_id, name: c.name })}
            className={chip(picked === c.user_id)}
          >
            <span className="font-medium">{c.first}</span>
            <span className="muted tabular-nums">· {c.when}</span>
          </button>
        ))}
      </div>
      {note ? <p className="muted text-xs">{note}</p> : null}
    </div>
  );
}
