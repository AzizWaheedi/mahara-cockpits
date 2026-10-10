import { useEffect, useRef } from "react";
import { clock } from "../lib/format";
import { type SaveState, saveWords } from "../lib/scriptNotes";

/** The most one part's notes may hold (sales-api script.save refuses more). */
export const PART_NOTE_MAX = 4_000;

/**
 * Open notes on one part of the script: whatever the rep wants to keep
 * that no field asks for. It grows as they type and saves by itself a few
 * seconds after they stop; the line under it says where the notes are.
 * On the intro's last part it is the setter's line for the closer.
 */
export function PartNotes({
  id,
  label,
  hint,
  value,
  onChange,
  state,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  state: SaveState;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: grows with what is typed
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 76), 420)}px`;
  }, [value]);
  const words = saveWords(state, ms => clock(new Date(ms).toISOString()));
  const bad = state.kind === "failed";
  const left = PART_NOTE_MAX - value.length;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {left < 400 ? (
          <span
            className="font-mono text-[11px] tabular-nums"
            style={{
              color: left < 0 ? "var(--warning)" : "var(--muted-foreground)",
            }}
          >
            {left} left
          </span>
        ) : null}
      </div>
      <textarea
        ref={ref}
        id={id}
        value={value}
        onChange={e => onChange(e.target.value.slice(0, PART_NOTE_MAX))}
        maxLength={PART_NOTE_MAX}
        dir="auto"
        rows={3}
        placeholder={hint}
        className="block w-full resize-none rounded-[14px] border border-white/10 bg-[color:var(--background)] px-3.5 py-2.5 text-sm leading-relaxed placeholder:text-[color:var(--muted-foreground)] focus:border-[color:var(--ring)] focus:outline-none focus:ring-1 focus:ring-[color:var(--ring)]"
      />
      {words ? (
        <p
          role="status"
          aria-live="polite"
          className={`text-xs ${bad ? "" : "muted"}`}
          style={bad ? { color: "var(--warning)" } : undefined}
        >
          {words}
        </p>
      ) : null}
    </div>
  );
}
