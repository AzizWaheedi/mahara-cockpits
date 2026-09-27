import { Check, Loader2, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Person } from "@/lib/team";
import { DAY_NAMES } from "../../../convex/teamCore";


/** Native selects styled as the kit's Input, so a phone gets its own picker. */
export const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Thu 25 Sep" from "2026-09-25". */
export function dayName(day: string | null | undefined): string {
  if (!day) return "";
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "10:42" today, "Tue 10:42" this week, "16 Sep" before that. */
export function when(iso: string | null | undefined, today: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  const local = new Date(at.getTime() + 3 * 3_600_000); // Kuwait
  const day = local.toISOString().slice(0, 10);
  const hm = local.toISOString().slice(11, 16);
  if (day === today) return hm;
  const ago =
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) /
    86_400_000;
  if (ago < 7) return `${WEEKDAYS[local.getUTCDay()]} ${hm}`;
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`;
}

/** The part of an address before the @, for "saved by". */
export const shortName = (email: string | null | undefined) =>
  String(email ?? "").split("@")[0];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function Initials({
  person,
  tone = "muted",
}: {
  person: Person | undefined;
  tone?: "muted" | "host";
}) {
  const name = person?.name ?? "?";
  return (
    <span
      title={name}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
        tone === "host"
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground"
      }`}
      dir="auto"
    >
      {initials(name)}
    </span>
  );
}

export function peopleById(people: Person[]): Map<string, Person> {
  return new Map(people.map(p => [p.id, p]));
}

/**
 * The roster as <option>s, grouped by department. A function, not a
 * component: AnimatedSelect reads its options from its direct children, so
 * they must be real <optgroup> and <option> elements.
 */
export function peopleOptions(
  people: Person[],
  exclude?: Set<string>,
  withRole = true,
): ReactNode {
  const groups = new Map<string, Person[]>();
  for (const p of people) {
    if (exclude?.has(p.id)) continue;
    const key = p.department ?? "Other";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return (
    <>
      {[...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dept, list]) => (
          <optgroup key={dept} label={dept}>
            {list.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
                {withRole && p.role ? `, ${p.role}` : ""}
              </option>
            ))}
          </optgroup>
        ))}
    </>
  );
}

/** A labelled control: the label points at the control by id. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid content-start gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

export function errorText(e: unknown): string {
  // The server sends each refusal as a ConvexError, whose data survives.
  const data = (e as { data?: unknown } | null)?.data;
  if (typeof data === "string") return data;
  if (data && typeof (data as { message?: unknown }).message === "string")
    return (data as { message: string }).message;
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.match(/Uncaught Error: ([\s\S]*?)(?:\n\s+at |$)/);
  return (
    (m ? m[1] : raw).trim().slice(0, 300) ||
    "That did not save, so nothing changed. Try again in a minute."
  );
}

export type SaveResult =
  | { ok: true }
  | {
      ok: false;
      conflict: {
        text: string;
        by: string | null;
        at: string | null;
        version: number;
      };
    };

type Theirs = {
  text: string;
  by: string | null;
  at: string | null;
  version: number;
};

/**
 * A shared text, like a Google Doc for the one thing it holds: saves by
 * itself a moment after typing stops, and never overwrites a newer version
 * somebody else saved in between. When that happens both versions are on
 * screen and the person chooses. Saves never overlap, and each one starts
 * from the version the last one left, so a person typing through their own
 * save is never told somebody else got there first.
 */
export function SharedText({
  value,
  version,
  savedBy,
  savedAt,
  today,
  placeholder,
  minRows = 6,
  label,
  onSave,
}: {
  value: string;
  version: number;
  savedBy: string | null;
  savedAt: string | null;
  today: string;
  placeholder: string;
  minRows?: number;
  label: string;
  onSave: (text: string, version: number) => Promise<SaveResult>;
}) {
  const [text, setText] = useState(value);
  const [state, setState] = useState<"idle" | "dirty" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [theirs, setTheirs] = useState<Theirs | null>(null);
  const base = useRef(version);
  const latest = useRef(value);
  const inFlight = useRef(false);
  const blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});

  // A newer version from a refresh: take it when nothing local is unsaved,
  // otherwise show it beside the unsaved text.
  useEffect(() => {
    // While a save is on its way, the page it returns carries this editor's
    // own version; the save itself settles what happens next.
    if (inFlight.current || version <= base.current) return;
    if (state === "idle") {
      base.current = version;
      latest.current = value;
      setText(value);
    } else {
      blocked.current = true;
      setTheirs({ text: value, by: savedBy, at: savedAt, version });
    }
  }, [value, version, savedBy, savedAt, state]);

  // Grow with the text, so the page scrolls rather than a small box.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, minRows * 22)}px`;
  }, [text, minRows]);

  saveRef.current = async () => {
    if (inFlight.current || blocked.current) return;
    const content = latest.current;
    const from = base.current;
    inFlight.current = true;
    setState("saving");
    setError(null);
    try {
      const res = await onSave(content, from);
      if (res.ok) {
        base.current = from + 1;
        if (latest.current === content) setState("idle");
        else {
          setState("dirty");
          schedule();
        }
      } else {
        blocked.current = true;
        setTheirs(res.conflict);
        setState("dirty");
      }
    } catch (e) {
      setError(errorText(e));
      setState("dirty");
    } finally {
      inFlight.current = false;
    }
  };

  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(), 1500);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const status =
    state === "saving"
      ? "Saving…"
      : state === "dirty"
        ? "Not saved yet"
        : savedAt
          ? `Saved ${when(savedAt, today)} by ${shortName(savedBy)}`
          : "Nothing written yet";

  return (
    <div className="grid gap-2">
      <Textarea
        ref={area}
        aria-label={label}
        value={text}
        placeholder={placeholder}
        onChange={e => {
          latest.current = e.target.value;
          setText(e.target.value);
          setState("dirty");
          schedule();
        }}
        onBlur={() => {
          if (state === "dirty") {
            if (timer.current) clearTimeout(timer.current);
            void saveRef.current();
          }
        }}
        className="resize-none leading-relaxed"
        dir="auto"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span role="status">{status}</span>
        {state === "dirty" && !theirs ? (
          <button
            type="button"
            className="underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current);
              void saveRef.current();
            }}
          >
            Save now
          </button>
        ) : null}
      </div>
      {theirs ? (
        <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <p>
            {shortName(theirs.by) || "Someone"} saved a newer version
            {theirs.at ? ` at ${when(theirs.at, today)}` : ""} while you were
            writing. Yours is not saved yet.
          </p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Read their version</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-sans">
              {theirs.text || "(empty)"}
            </pre>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                base.current = theirs.version;
                latest.current = theirs.text;
                blocked.current = false;
                setText(theirs.text);
                setTheirs(null);
                setState("idle");
              }}
            >
              Use theirs
            </Button>
            <Button
              size="sm"
              onClick={() => {
                base.current = theirs.version;
                blocked.current = false;
                setTheirs(null);
                void saveRef.current();
              }}
            >
              Keep mine
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// --- inline editing -------------------------------------------------------------

/** Filters, tabs and day chips: 32px pills, the active one teal (docs/DESIGN.md). */
export const chip = (on: boolean) =>
  `inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-medium transition-colors ${
    on
      ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
      : "text-muted-foreground hover:bg-muted hover:text-foreground"
  }`;

/** An icon button that stays small with a mouse and grows under a finger. */
export const iconButton =
  "flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 pointer-coarse:size-10";

/** "13:30 to 14:00". */
export function timeRange(start: string | null, end: string | null): string {
  if (!start) return "";
  return end ? `${start} to ${end}` : start;
}

/**
 * Text that turns into a field when clicked, like a Google Doc: Enter or
 * leaving the field saves, Escape puts it back.
 */
export function InlineText({
  value,
  onSave,
  placeholder,
  label,
  multiline = false,
  className = "",
  disabled = false,
  max = 200,
  emptyClass = "",
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
  placeholder: string;
  label: string;
  multiline?: boolean;
  className?: string;
  disabled?: boolean;
  max?: number;
  /** Extra classes while there is no text, to keep an empty prompt quiet. */
  emptyClass?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  const save = async () => {
    const next = text.trim();
    if (next === value.trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      // The page shows the error; the text stays for another try.
    } finally {
      setBusy(false);
    }
  };
  if (!editing || disabled)
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className={`min-w-0 text-left underline-offset-4 decoration-muted-foreground/40 enabled:hover:underline disabled:cursor-default ${value ? "" : `text-muted-foreground ${emptyClass}`} ${className}`}
        dir="auto"
        aria-label={`${label}: ${value || placeholder}. Edit`}
      >
        {value || placeholder}
      </button>
    );
  const common = {
    autoFocus: true,
    value: text,
    maxLength: max,
    "aria-label": label,
    placeholder,
    dir: "auto" as const,
    disabled: busy,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: () => void save(),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setText(value);
        setEditing(false);
      }
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void save();
      }
    },
  };
  return multiline ? (
    <Textarea
      {...common}
      rows={2}
      className={`resize-none text-sm ${className}`}
    />
  ) : (
    <Input {...common} className={`h-8 text-sm ${className}`} />
  );
}

/** Pick days of the week: Sunday first, the Kuwaiti week. */
export function DayChips({
  value,
  onChange,
  label = "Days",
}: {
  value: number[];
  onChange: (days: number[]) => void;
  label?: string;
}) {
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {DAY_NAMES.map((d, i) => {
          const on = value.includes(i);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange(
                  on
                    ? value.filter(x => x !== i)
                    : [...value, i].sort((a, b) => a - b),
                )
              }
              className={`${chip(on)} w-11 justify-center`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export const fieldClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";

/** A small confirm in place: "Delete?" with Yes and No, no dialog. */
export function ConfirmInline({
  ask,
  yes,
  onYes,
  children,
}: {
  ask: string;
  yes: string;
  onYes: () => Promise<void>;
  children: (open: () => void) => ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) return <>{children(() => setAsking(true))}</>;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs"
      role="group"
      aria-label={ask}
    >
      <span className="text-muted-foreground">{ask}</span>
      <Button
        size="sm"
        variant="destructive"
        className="h-7 px-2"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onYes();
          } catch {
            // The page shows the error.
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Check aria-hidden />
        )}
        {yes}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2"
        onClick={() => setAsking(false)}
      >
        <X aria-hidden /> Keep
      </Button>
    </span>
  );
}

/** Run one small change: busy while it runs, the page shows any error. */
export function useBusy(): [
  string | null,
  (key: string, fn: () => Promise<unknown>) => Promise<void>,
] {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch {
      // The page shows the error.
    } finally {
      setBusy(null);
    }
  };
  return [busy, run];
}
