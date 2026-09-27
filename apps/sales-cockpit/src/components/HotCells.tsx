import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Flame,
  Loader2,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "../lib/api";
import { localInput } from "../lib/dialer";
import { num, when } from "../lib/format";
import {
  amountText,
  BY_WORD,
  CURRENCIES,
  type Due,
  type FollowUp,
  followUpPicks,
  HEATS,
  type Heat,
  type HotRow,
  type HotStatus,
  heatWord,
  parseAmount,
  STATUSES,
  statusWord,
} from "../lib/hot";

/**
 * The hot list's cells, shared by the sheet (HotSheet.tsx) and a lead's page
 * (HotList.tsx): each one shows its value and edits it in place, and a change
 * is saved on Enter or on leaving the cell, a field at a time, through
 * sales-api hot.save. A save that fails keeps what was typed and says why.
 */

export type HotField =
  | "heat"
  | "status"
  | "amount"
  | "last_objection"
  | "note"
  | "next_at"
  | "last_fu_at"
  | "owner_email";

export const FIELD_WORD: Record<HotField, string> = {
  heat: "Type",
  status: "Status",
  amount: "Amount",
  last_objection: "Last objection",
  note: "Notes",
  next_at: "Next follow-up",
  last_fu_at: "Last follow-up",
  owner_email: "Owner",
};

export type Phase =
  | { phase: "saving" }
  | { phase: "saved" }
  | { phase: "failed"; error: string };

type Body = Record<string, unknown>;
interface Edit {
  /** What was sent: shown in place of the row's value while it saves or after it failed. */
  body: Body;
  phase: Phase;
}

export interface HotEdits {
  /** The row with every field still saving, or that failed, as it was typed. */
  view: (row: HotRow) => HotRow;
  phase: (contactId: string, field: HotField) => Phase | undefined;
  failures: (contactId: string) => { field: HotField; error: string }[];
  /** Save fields of one row; the saved row, or null when it failed. */
  commit: (
    contactId: string,
    field: HotField,
    body: Body,
  ) => Promise<HotRow | null>;
  retry: (contactId: string, field: HotField) => void;
  /** Drop a failed change: the cell shows the saved value again. */
  undo: (contactId: string, field: HotField) => void;
}

/**
 * Saving a hot row a field at a time. Each field keeps what was sent until
 * the server answers: on a yes the saved row goes to `onSaved` and the cell
 * shows a tick for two seconds; on a no the typed value stays with the
 * server's sentence, until it is tried again or undone.
 */
export function useHotEdits(onSaved: (row: HotRow) => void): HotEdits {
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const latest = useRef(edits);
  const seq = useRef<Record<string, number>>({});
  const timers = useRef<Record<string, number>>({});
  const alive = useRef(true);
  useEffect(() => {
    latest.current = edits;
  });
  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      for (const t of Object.values(pending)) window.clearTimeout(t);
    };
  }, []);

  const commit = useCallback(
    async (
      contactId: string,
      field: HotField,
      body: Body,
    ): Promise<HotRow | null> => {
      const key = `${contactId}|${field}`;
      const n = (seq.current[key] ?? 0) + 1;
      seq.current[key] = n;
      window.clearTimeout(timers.current[key]);
      setEdits(e => ({ ...e, [key]: { body, phase: { phase: "saving" } } }));
      try {
        const out = await api<{ hot?: HotRow }>("hot.save", {
          ...body,
          contact_id: contactId,
        });
        // An older answer still lands (the newer row wins by its time);
        // only the latest save of this field sets the cell's mark.
        if (out.hot) onSaved(out.hot);
        if (!alive.current || seq.current[key] !== n) return out.hot ?? null;
        setEdits(e => ({
          ...e,
          [key]: { body: {}, phase: { phase: "saved" } },
        }));
        timers.current[key] = window.setTimeout(() => {
          setEdits(e => {
            if (e[key]?.phase.phase !== "saved") return e;
            const { [key]: _done, ...rest } = e;
            return rest;
          });
        }, 2000);
        return out.hot ?? null;
      } catch (err) {
        if (alive.current && seq.current[key] === n)
          setEdits(e => ({
            ...e,
            [key]: {
              body,
              phase: {
                phase: "failed",
                error: String((err as Error).message ?? err),
              },
            },
          }));
        return null;
      }
    },
    [onSaved],
  );

  const undo = useCallback((contactId: string, field: HotField) => {
    const key = `${contactId}|${field}`;
    seq.current[key] = (seq.current[key] ?? 0) + 1;
    setEdits(e => {
      const { [key]: _gone, ...rest } = e;
      return rest;
    });
  }, []);

  const retry = useCallback(
    (contactId: string, field: HotField) => {
      const e = latest.current[`${contactId}|${field}`];
      if (e?.phase.phase === "failed") void commit(contactId, field, e.body);
    },
    [commit],
  );

  const view = useCallback(
    (row: HotRow): HotRow => {
      let out = row;
      for (const [key, e] of Object.entries(edits))
        if (key.startsWith(`${row.contact_id}|`) && Object.keys(e.body).length)
          out = { ...out, ...e.body } as HotRow;
      return out;
    },
    [edits],
  );

  const phase = useCallback(
    (contactId: string, field: HotField) =>
      edits[`${contactId}|${field}`]?.phase,
    [edits],
  );

  const failures = useCallback(
    (contactId: string) =>
      Object.entries(edits).flatMap(([key, e]) =>
        key.startsWith(`${contactId}|`) && e.phase.phase === "failed"
          ? [{ field: key.split("|")[1] as HotField, error: e.phase.error }]
          : [],
      ),
    [edits],
  );

  return { view, phase, failures, commit, retry, undo };
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** Saving, saved or not saved, as a small mark in the cell's corner. */
export function SaveMark({
  phase,
  className = "",
}: {
  phase?: Phase;
  className?: string;
}) {
  if (!phase) return null;
  return (
    <span
      role="status"
      className={`pointer-events-none inline-flex ${className}`}
    >
      {phase.phase === "saving" ? (
        <Loader2 className="muted size-3 animate-spin" aria-hidden />
      ) : phase.phase === "saved" ? (
        <Check
          className="size-3"
          style={{ color: "var(--success)" }}
          aria-hidden
        />
      ) : (
        <CircleAlert
          className="size-3"
          style={{ color: "var(--destructive)" }}
          aria-hidden
        />
      )}
      <span className="sr-only">
        {phase.phase === "saving"
          ? "Saving"
          : phase.phase === "saved"
            ? "Saved"
            : `Not saved: ${phase.error}`}
      </span>
    </span>
  );
}

/**
 * A cell's look while it saves: a green wash laid over it just after a
 * save, fading over a second, and a red edge while a change that failed is
 * still there. The wash is its own layer, so the row's hover stays instant.
 * The cell must be positioned (relative or sticky).
 */
export function phaseClass(phase: Phase | undefined): string {
  const p = phase?.phase;
  return `after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-[color:var(--success)] after:transition-opacity after:duration-700 after:content-[''] ${
    p === "saved" ? "after:opacity-15" : "after:opacity-0"
  } ${p === "failed" ? "shadow-[inset_0_0_0_1px_var(--destructive)]" : ""}`;
}

/** An empty cell: a dash, and on hover what it means. */
export function Dash({ why }: { why: string }) {
  return (
    <span className="muted" title={why}>
      –
    </span>
  );
}

const DISPLAY =
  "no-touch block w-full min-w-0 rounded-md px-1.5 py-1 text-left hover:bg-[color:var(--secondary)]";
const EDITOR =
  "w-full min-w-0 rounded-md border border-transparent bg-[color:var(--background)] px-1.5 py-1 text-[13px] leading-5 ring-1 ring-[color:var(--primary)] focus-visible:outline-none";

/** Enter saves and Escape puts it back; Shift+Enter is a new line in a note. */
function keys(
  e: KeyboardEvent,
  finish: (save: boolean) => void,
  multiline = false,
) {
  if (e.key === "Escape") {
    e.preventDefault();
    finish(false);
  } else if (
    e.key === "Enter" &&
    !(multiline && e.shiftKey) &&
    !e.nativeEvent.isComposing
  ) {
    e.preventDefault();
    finish(true);
  }
}

/**
 * Open and close an editor: `finish` runs once per opening (Enter, Escape
 * or leaving it), and after Enter or Escape the cell's button has the focus
 * back, so the keyboard carries on from where it was. The editor's field
 * takes the focus as it appears (`grab`, a ref that runs once per mount).
 */
function useEditor(onEditing?: (on: boolean) => void) {
  const [open, setOpen] = useState(false);
  // Open right now, read by handlers that run before the next render.
  const isOpen = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const grab = useCallback((el: HTMLElement | null) => el?.focus(), []);
  const refocus = useRef(false);
  const editing = useRef(onEditing);
  useEffect(() => {
    editing.current = onEditing;
  });
  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [open]);
  // An editor that goes away while open (its row left the list) counts as
  // closed, so the sheet does not stay frozen.
  useEffect(
    () => () => {
      if (isOpen.current) editing.current?.(false);
    },
    [],
  );
  const start = () => {
    isOpen.current = true;
    setOpen(true);
    editing.current?.(true);
  };
  /** True the first time it is called for an opening, false after. */
  const end = (byKey: boolean) => {
    if (!isOpen.current) return false;
    isOpen.current = false;
    refocus.current = byKey;
    setOpen(false);
    editing.current?.(false);
    return true;
  };
  return { open, start, end, button, grab };
}

/**
 * An editor wider than its cell, laid over it as a spreadsheet does: the
 * cell keeps its size (`under`, drawn invisibly), and the editor sits on top,
 * from the cell's left or right edge, over its neighbour.
 */
function Floating({
  anchor,
  under,
  children,
}: {
  anchor: "left" | "right";
  under: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="relative block">
      <span aria-hidden className="invisible block">
        {under}
      </span>
      <span
        className={`absolute top-1/2 z-30 -translate-y-1/2 rounded-md bg-[color:var(--card)] ${
          anchor === "left" ? "left-0" : "right-0"
        }`}
      >
        {children}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pickers: type, status, owner
// ---------------------------------------------------------------------------

const HEAT_COLOR: Record<Heat, string> = {
  red_hot: "var(--destructive)",
  hot: "var(--warning)",
  warm: "var(--muted-foreground)",
};

const STATUS_ICON: Record<HotStatus, [typeof CircleDashed, string]> = {
  nurturing: [CircleDashed, "var(--primary)"],
  closed: [CircleCheck, "var(--success)"],
  lost: [CircleX, "var(--muted-foreground)"],
};

function Picker({
  label,
  icon,
  value,
  options,
  onPick,
}: {
  label: string;
  icon?: ReactNode;
  value: string;
  options: [string, string][];
  onPick: (v: string) => void;
}) {
  return (
    <span className="relative flex w-full min-w-0 items-center">
      {icon ? (
        <span className="pointer-events-none absolute left-1.5 flex">
          {icon}
        </span>
      ) : null}
      <select
        aria-label={label}
        value={value}
        onChange={e => onPick(e.target.value)}
        className={`w-full min-w-0 cursor-pointer appearance-none truncate rounded-md bg-transparent py-1 pr-5 text-[13px] hover:bg-[color:var(--secondary)] ${icon ? "pl-6" : "pl-1.5"}`}
      >
        {options.map(([v, t]) => (
          <option
            key={v}
            value={v}
            className="bg-[color:var(--card)] text-[color:var(--foreground)]"
          >
            {t}
          </option>
        ))}
      </select>
      <ChevronDown
        className="muted pointer-events-none absolute right-1 size-3"
        aria-hidden
      />
    </span>
  );
}

export function HeatPick({
  value,
  readOnly,
  onPick,
}: {
  value: Heat;
  readOnly?: boolean;
  onPick: (v: Heat) => void;
}) {
  const icon = (
    <Flame
      className="size-3.5 shrink-0"
      style={{ color: HEAT_COLOR[value] }}
      aria-hidden
    />
  );
  if (readOnly)
    return (
      <span className="inline-flex items-center gap-1.5 px-1.5">
        {icon}
        {heatWord(value)}
      </span>
    );
  return (
    <Picker
      label="Type"
      icon={icon}
      value={value}
      options={HEATS}
      onPick={v => onPick(v as Heat)}
    />
  );
}

export function StatusPick({
  value,
  readOnly,
  onPick,
}: {
  value: HotStatus;
  readOnly?: boolean;
  onPick: (v: HotStatus) => void;
}) {
  const [Icon, color] = STATUS_ICON[value];
  const icon = (
    <Icon className="size-3.5 shrink-0" style={{ color }} aria-hidden />
  );
  if (readOnly)
    return (
      <span className="inline-flex items-center gap-1.5 px-1.5">
        {icon}
        {statusWord(value)}
      </span>
    );
  return (
    <Picker
      label="Status"
      icon={icon}
      value={value}
      options={STATUSES}
      onPick={v => onPick(v as HotStatus)}
    />
  );
}

/** "Sara Khalil" as "Sara K.". */
export function shortName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]}.` : first;
}

/** Whose hot lead it is: a manager hands it to another seat; everyone else reads it. */
export function OwnerPick({
  value,
  seats,
  readOnly,
  onPick,
}: {
  value: string;
  /** [email, name] of the seats it can go to. */
  seats: [string, string][];
  readOnly?: boolean;
  onPick: (email: string) => void;
}) {
  const known = seats.find(([e]) => e === value);
  if (readOnly)
    return (
      <span className="block truncate px-1.5" title={known?.[1] ?? value}>
        {known ? known[1].split(/\s+/)[0] : value.split("@")[0]}
      </span>
    );
  // "Sara K.": fits the column and still tells two Saras apart. One person
  // with two seats (a work and a personal address) is told apart by the
  // address: "Aziz W. (gmail.com)".
  const short = seats.map(([, n]) => shortName(n));
  const options: [string, string][] = seats.map(([e, n], i) => [
    e,
    short.filter(x => x === short[i]).length > 1
      ? `${short[i]} (${e.split("@")[1] ?? e})`
      : shortName(n),
  ]);
  if (!known) options.unshift([value, `${value.split("@")[0]} (no seat)`]);
  return (
    <Picker label="Owner" value={value} options={options} onPick={onPick} />
  );
}

// ---------------------------------------------------------------------------
// Text: the last objection and the notes
// ---------------------------------------------------------------------------

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " / ");

export function TextEdit({
  label,
  value,
  max,
  multiline = false,
  readOnly,
  empty,
  onCommit,
  onEditing,
}: {
  label: string;
  value: string | null | undefined;
  max: number;
  multiline?: boolean;
  readOnly?: boolean;
  /** What an empty cell means, said on hover. */
  empty: string;
  onCommit: (v: string | null) => void;
  onEditing?: (on: boolean) => void;
}) {
  const ed = useEditor(onEditing);
  const [text, setText] = useState("");
  const shown = value?.trim() ? (
    <span className="block truncate" dir="auto">
      {oneLine(value)}
    </span>
  ) : (
    <Dash why={empty} />
  );
  if (readOnly)
    return (
      <span className="block truncate px-1.5" title={value ?? undefined}>
        {shown}
      </span>
    );
  const finish = (save: boolean, byKey: boolean) => {
    if (!ed.end(byKey)) return;
    const next = text.trim();
    if (save && next !== (value ?? "").trim()) onCommit(next || null);
  };
  if (ed.open) {
    const props = {
      ref: ed.grab,
      value: text,
      maxLength: max,
      dir: "auto" as const,
      "aria-label": label,
      onChange: (e: { target: { value: string } }) => setText(e.target.value),
      onBlur: () => finish(true, false),
      onKeyDown: (e: KeyboardEvent) =>
        keys(e, save => finish(save, true), multiline),
      className: `${EDITOR} ${multiline ? "resize-y" : ""}`,
    };
    return multiline ? <textarea rows={3} {...props} /> : <input {...props} />;
  }
  return (
    <button
      ref={ed.button}
      type="button"
      onClick={() => {
        setText(value ?? "");
        ed.start();
      }}
      title={value?.trim() ? value : `${empty} Click to write one.`}
      aria-label={`${label}: ${value?.trim() ? value : "none"}`}
      className={DISPLAY}
    >
      {shown}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The amount
// ---------------------------------------------------------------------------

export function AmountEdit({
  amount,
  currency,
  readOnly,
  align = "right",
  onCommit,
  onEditing,
}: {
  /** A number, or the text of a change that failed. */
  amount: number | string | null | undefined;
  currency: string | null | undefined;
  readOnly?: boolean;
  /** Right in a column of amounts (the sheet), left under a label (a lead's page). */
  align?: "left" | "right";
  onCommit: (v: {
    amount: number | string | null;
    amount_currency: string;
  }) => void;
  onEditing?: (on: boolean) => void;
}) {
  const ed = useEditor(onEditing);
  const [text, setText] = useState("");
  const [cur, setCur] = useState("USD");
  const side = align === "right" ? "text-right" : "text-left";
  const money = amountText({ amount, amount_currency: currency });
  // A change that failed shows as it was typed.
  const typed =
    money === null && typeof amount === "string" && amount.trim()
      ? amount
      : null;
  const shown = money ?? typed ?? (
    <Dash why="No amount yet: what the deal is worth." />
  );
  if (readOnly)
    return (
      <span className={`block truncate px-1.5 tabular-nums ${side}`}>
        {shown}
      </span>
    );
  const finish = (save: boolean, byKey: boolean) => {
    if (!ed.end(byKey)) return;
    if (!save) return;
    const n = parseAmount(text);
    const was = num(amount);
    const same =
      (n === null ? was === null : n === was) &&
      cur === (currency || "USD") &&
      typed === null;
    // Something that is not a number goes as typed: the server says why.
    if (!same)
      onCommit({
        amount: Number.isNaN(n) ? text.trim() : n,
        amount_currency: cur,
      });
  };
  if (ed.open)
    return (
      <Floating
        anchor={align}
        under={<span className={`block px-1.5 py-1 ${side}`}>{shown}</span>}
      >
        <span
          role="group"
          aria-label="Amount and currency"
          className="flex items-center gap-1"
          onBlur={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              finish(true, false);
          }}
        >
          <input
            ref={ed.grab}
            inputMode="decimal"
            aria-label="Amount"
            placeholder="5,000"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => keys(e, save => finish(save, true))}
            className={`${EDITOR} w-[7rem] tabular-nums ${side}`}
          />
          <select
            aria-label="Currency"
            value={cur}
            onChange={e => setCur(e.target.value)}
            onKeyDown={e => keys(e, save => finish(save, true))}
            className="h-7 shrink-0 rounded-md border hairline bg-[color:var(--background)] px-1 text-[11px]"
          >
            {CURRENCIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </span>
      </Floating>
    );
  return (
    <button
      ref={ed.button}
      type="button"
      onClick={() => {
        setText(typed ?? (num(amount) === null ? "" : String(num(amount))));
        setCur(currency || "USD");
        ed.start();
      }}
      aria-label={`Amount: ${money ?? typed ?? "none"}`}
      className={`${DISPLAY} tabular-nums ${side}`}
    >
      {shown}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Dates: the next follow-up and the last one marked by hand
// ---------------------------------------------------------------------------

/**
 * A moment edited in a date-and-time field: it opens with the browser's own
 * picker, saves on Enter or on leaving it, and the X clears it.
 */
export function WhenEdit({
  label,
  value,
  min,
  max,
  readOnly,
  onCommit,
  onEditing,
  children,
}: {
  label: string;
  /** What the field starts from (the saved moment, or the one that failed). */
  value: string | null | undefined;
  min?: number;
  max?: number;
  readOnly?: boolean;
  /** An ISO moment, null to clear, or the text as typed when it is not a date. */
  onCommit: (iso: string | null) => void;
  onEditing?: (on: boolean) => void;
  /** The cell as it reads when not being edited. */
  children: ReactNode;
}) {
  const ed = useEditor(onEditing);
  const [text, setText] = useState("");
  // Opened by a pointer (not the keyboard): the browser's picker comes up.
  const byPointer = useRef(false);
  const input = useRef<HTMLInputElement | null>(null);
  const grab = ed.grab;
  const hold = useCallback(
    (el: HTMLInputElement | null) => {
      input.current = el;
      grab(el);
    },
    [grab],
  );
  const startAt = value ? Date.parse(value) : Number.NaN;
  const from = Number.isFinite(startAt) ? localInput(startAt) : "";
  useEffect(() => {
    if (!ed.open || !byPointer.current) return;
    try {
      // The click that opened the cell lets the browser show its picker; a
      // keyboard opening leaves the field to type in.
      input.current?.showPicker?.();
    } catch {
      // No picker from here (an older browser): the field takes typing.
    }
  }, [ed.open]);
  if (readOnly) return <span className="block px-1.5">{children}</span>;
  const finish = (save: boolean, byKey: boolean, clear = false) => {
    // A date half typed reads as blank: it puts the old one back rather
    // than clearing it.
    const half = !clear && Boolean(input.current?.validity.badInput);
    if (!ed.end(byKey) || !save || half) return;
    const next = clear ? "" : text;
    if (next === from) return;
    if (!next) return onCommit(null);
    // Something the browser holds but cannot read as a moment (a six-digit
    // year) goes as typed: the server says why, and nothing is cleared.
    const t = Date.parse(next);
    onCommit(Number.isFinite(t) ? new Date(t).toISOString() : next);
  };
  if (ed.open)
    return (
      <Floating
        anchor="left"
        under={<span className="block px-1.5 py-1">{children}</span>}
      >
        <span
          role="group"
          aria-label={label}
          className="flex items-center gap-0.5"
          onBlur={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              finish(true, false);
          }}
        >
          <input
            ref={hold}
            type="datetime-local"
            aria-label={label}
            value={text}
            min={min === undefined ? undefined : localInput(min)}
            max={max === undefined ? undefined : localInput(max)}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => keys(e, save => finish(save, true))}
            className={`${EDITOR} w-[12rem] text-xs tabular-nums`}
          />
          <button
            type="button"
            // Keep the field's focus, so leaving it does not save first.
            onMouseDown={e => e.preventDefault()}
            onClick={() => finish(true, true, true)}
            aria-label={`Clear the ${label.toLowerCase()}`}
            title={`Clear the ${label.toLowerCase()}`}
            className="no-touch muted relative inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      </Floating>
    );
  return (
    <button
      ref={ed.button}
      type="button"
      onClick={e => {
        byPointer.current = e.detail > 0;
        setText(from);
        ed.start();
      }}
      title={`Change the ${label.toLowerCase()}`}
      className={DISPLAY}
    >
      <span className="sr-only">{label}: </span>
      {children}
    </button>
  );
}

const DUE_COLOR: Record<Exclude<Due, "later">, string> = {
  overdue: "var(--destructive)",
  today: "var(--warning)",
};

/** The next follow-up as the sheet reads it: when, and a dot when it is due. */
export function NextShown({
  at,
  due,
  open,
  now,
}: {
  at: string | null | undefined;
  due: Due | null;
  /** Closed and lost deals have no follow-up coming: shown quietly. */
  open: boolean;
  now: number;
}) {
  if (!at)
    return (
      <Dash
        why={
          open
            ? "No follow-up set, so the dialer will not bring this lead up. Click to pick one."
            : "No follow-up set."
        }
      />
    );
  // A change that failed on a date that could not be read shows as typed.
  if (!Number.isFinite(Date.parse(at)))
    return <span className="block truncate tabular-nums">{at}</span>;
  const dot = open && due && due !== "later" ? DUE_COLOR[due] : null;
  return (
    <span className="block min-w-0 leading-tight">
      <span
        className={`flex min-w-0 items-center gap-1.5 whitespace-nowrap tabular-nums ${open ? "" : "muted"}`}
      >
        {dot ? (
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: dot }}
            aria-hidden
          />
        ) : null}
        <span className="truncate">{when(at, now)}</span>
      </span>
      {dot ? (
        <span className="muted block text-[11px]">
          {due === "overdue" ? "overdue" : "due today"}
        </span>
      ) : null}
    </span>
  );
}

/** The last follow-up: when, and in a small word what it was. */
export function LastShown({
  last,
  words,
  now,
}: {
  last: FollowUp | null;
  /** Every source in a sentence, for the hover. */
  words: string;
  now: number;
}) {
  if (!last) return <Dash why={`No follow-up yet. ${words}`} />;
  return (
    <span className="block min-w-0 leading-tight" title={words}>
      <span className="block truncate whitespace-nowrap tabular-nums">
        {when(new Date(last.at).toISOString(), now)}
      </span>
      <span className="muted block text-[11px]">{BY_WORD[last.by]}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// After "Followed up": when next
// ---------------------------------------------------------------------------

const CHIP =
  "no-touch inline-flex h-7 items-center rounded-full border hairline px-2.5 text-xs font-medium hover:border-[color:var(--primary)] disabled:opacity-50";

/** The question "Followed up" asks: the next follow-up, in one tap. */
export function NextAsk({
  name,
  busy,
  onPick,
  onClose,
}: {
  name: string;
  busy: boolean;
  onPick: (at: number) => void;
  onClose: () => void;
}) {
  const [now] = useState(() => Date.now());
  const [custom, setCustom] = useState("");
  const at = custom ? Date.parse(custom) : Number.NaN;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
      <span className="font-medium">
        Followed up with <bdi>{name}</bdi>. Next follow-up:
      </span>
      {followUpPicks(now).map(p => (
        <button
          key={p.at}
          type="button"
          disabled={busy}
          onClick={() => onPick(p.at)}
          className={CHIP}
        >
          {p.label}
        </button>
      ))}
      <span className="inline-flex items-center gap-1">
        <input
          type="datetime-local"
          aria-label="Another time for the next follow-up"
          value={custom}
          min={localInput(now)}
          onChange={e => setCustom(e.target.value)}
          className="h-7 rounded-md border hairline bg-[color:var(--background)] px-1.5 text-xs tabular-nums"
        />
        <button
          type="button"
          disabled={busy || !Number.isFinite(at)}
          onClick={() => onPick(at)}
          className={CHIP}
        >
          Set
        </button>
      </span>
      <button
        type="button"
        onClick={onClose}
        className="no-touch muted relative underline-offset-2 hover:underline after:absolute after:-inset-2"
      >
        Not now
      </button>
    </div>
  );
}

/** The saves that failed on one row, each with why, and the way to save it again or drop it. */
export function FailedSaves({
  list,
  onRetry,
  onUndo,
}: {
  list: { field: HotField; error: string }[];
  onRetry: (field: HotField) => void;
  onUndo: (field: HotField) => void;
}) {
  if (!list.length) return null;
  return (
    <div role="alert" className="space-y-1 text-xs">
      {list.map(f => (
        <p key={f.field} className="leading-relaxed">
          <span className="font-medium">{FIELD_WORD[f.field]}</span> not saved:{" "}
          {f.error}{" "}
          <button
            type="button"
            onClick={() => onRetry(f.field)}
            className="no-touch font-medium underline underline-offset-2"
          >
            Save again
          </button>{" "}
          <button
            type="button"
            onClick={() => onUndo(f.field)}
            className="no-touch underline underline-offset-2"
          >
            Undo
          </button>
        </p>
      ))}
    </div>
  );
}
