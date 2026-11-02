import { ChevronLeft, ChevronRight, Pencil, Table2 } from "lucide-react";
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { shortDate } from "@/components/ceo/format";
import { StatusDot } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PaceBar } from "./goalsKit";
import {
  COLOUR_TONE,
  editText,
  parseCell,
  readPref,
  show,
  writePref,
} from "./goalsSheetCells";
import { rowsOf, type SheetData, type TargetMap } from "./goalsSheetData";
import {
  type Colour,
  colourFor,
  fixedHintOf,
  isLevel,
  isWorkingDay,
  rollUp,
  type SectionKey,
  type SheetColumn,
  targetKeyOf,
} from "./goalsSheetModel";

/**
 * The Goals sheet on a phone (2026-11-02). Aziz: "Make sure it's extremely
 * mobile-friendly as well ... because I want to be looking at this every
 * single day."
 *
 * Design plan. The job: in twenty seconds each morning, see which numbers are
 * behind and type the few counts only he knows. Inside the cockpit's own
 * system, no new palette: Geist with tabular figures, teal for on pace, the
 * kit's warning and critical for close and behind, StatusDot and the CEO
 * format helpers. Layout, top to bottom: a strip of days (the last complete
 * day picked, today there for typed counts), three counts that filter (behind,
 * close, on pace), then his sections in his order, each a list of rows: the
 * day's number, tap to type it on the number keypad; the month so far and
 * where it is heading; a pace bar. The signature is that bar, the board's own
 * PaceBar, so the phone and the board read alike. Every row is at least 44px
 * to tap, an empty number is "—" with its reason a tap away, never 0, and the
 * whole table is one tap away ("Open as table"). The cockpit's touch rule
 * gives every button 40px on a phone; these opt out of it ("no-touch") to set
 * their own 44px, keeping its touch-action.
 *
 * Round 2 (2026-11-02): an empty number says why on tap (the day's reason and
 * the month's, from the sheet), Escape or Done puts focus back on the row's
 * number, and the cockpit-wide "Ask Hermes" button (fixed, bottom right,
 * 44px) never sits on a value: each row's number keeps clear of its column,
 * and the list ends far enough above it to scroll clear.
 */

/**
 * Room for "Ask Hermes" on a phone: it is fixed 16px from the right edge and
 * about 60px wide, and the page's own gutter and the card's padding give 32px
 * of it, so a row's number keeps 48px more clear of the right edge.
 */
const CLEAR_OF_HERMES = "pr-12";

type Section = {
  key: SectionKey;
  label: string;
  cols: SheetColumn[];
};

/** Which sections are open on this device, by key; one never opened is closed. */
const OPEN_PREF = "ceo.goals.phoneSections";

const COUNT_WORD: Record<Colour, string> = {
  red: "behind",
  yellow: "close",
  green: "on pace",
};

const EMPTY = "—";

function readOpen(): Record<string, boolean> {
  try {
    const v = JSON.parse(readPref(OPEN_PREF) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function weekday(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleString("en", {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function GoalsSheetPhone({
  sheet,
  today,
  sections,
  targets,
  actual,
  pace,
  valueOn,
  onSave,
  onBadNumber,
  explain,
  onOpenTable,
}: {
  sheet: SheetData;
  today: string;
  sections: Section[];
  targets: TargetMap;
  /** The month so far, by column, as the grid's This month actual row. */
  actual: Record<string, number | null>;
  /** On pace for, by column, as the grid's row. */
  pace: Record<string, number | null>;
  valueOn: (
    c: SheetColumn,
    day: string,
  ) => { value: number | null; typed: boolean };
  /** The grid's own save: optimistic, in the background, the old value back if it fails. */
  onSave: (c: SheetColumn, day: string, value: number | null) => void;
  onBadNumber: (text: string) => void;
  /** The day's and the month's reasons beside a row: why it is empty, what it leaves out, revenue's parts. */
  explain: (
    c: SheetColumn,
    day: string | null,
  ) => { day: string; month: string };
  onOpenTable: () => void;
}) {
  // A day still to come has nothing to show or type.
  const choosable = useMemo(
    () => sheet.days.filter(d => d <= today),
    [sheet.days, today],
  );
  const [day, setDay] = useState<string | null>(
    () => sheet.through ?? choosable[choosable.length - 1] ?? null,
  );
  const [only, setOnly] = useState<Colour | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>(readOpen);
  const [details, setDetails] = useState<string | null>(null);
  const [typing, setTyping] = useState<{ key: string; text: string } | null>(
    null,
  );
  const typingRef = useRef<{ key: string; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** The row whose number takes focus back once its box closes by a key (Escape, Enter, Done). */
  const focusBack = useRef<string | null>(null);

  const targetOf = useCallback(
    (c: SheetColumn) => targets[targetKeyOf(c)]?.value ?? null,
    [targets],
  );

  const judged = useMemo(() => {
    const out: Record<string, Colour | null> = {};
    for (const s of sections)
      for (const c of s.cols)
        out[c.key] = colourFor(c, pace[c.key] ?? null, targetOf(c));
    return out;
  }, [sections, pace, targetOf]);

  const tally = useMemo(() => {
    const n: Record<Colour, number> = { red: 0, yellow: 0, green: 0 };
    for (const v of Object.values(judged)) if (v) n[v] += 1;
    return n;
  }, [judged]);

  // The picked day in the middle of the strip; the strip scrolls, the page does not.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-day="${day}"]`);
    if (!strip || !chip) return;
    strip.scrollLeft =
      chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
  }, [day]);

  const typingKey = typing?.key;
  useLayoutEffect(() => {
    // Once as the box opens: everything selected, so a new count replaces the old.
    if (typingKey === undefined) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [typingKey]);
  useEffect(() => {
    // Closed by a key, the box hands focus back to its row's number, so the
    // keyboard and a screen reader stay on the row (2026-11-02).
    if (typingKey !== undefined || !focusBack.current) return;
    const key = focusBack.current;
    focusBack.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(`li[data-col="${key}"] [data-number]`)
      ?.focus();
  }, [typingKey]);

  const step = (by: -1 | 1) => {
    if (!day) return;
    const next = choosable[choosable.indexOf(day) + by];
    if (next) setDay(next);
  };

  const toggleSection = (key: string, isOpen: boolean) =>
    setOpen(was => {
      const next = { ...was, [key]: !isOpen };
      writePref(OPEN_PREF, JSON.stringify(next));
      return next;
    });

  const begin = (c: SheetColumn) => {
    if (!day) return;
    const t = { key: c.key, text: editText(valueOn(c, day).value, c) };
    typingRef.current = t;
    setTyping(t);
  };

  /** Ends the typing once: Done, Enter or a tap elsewhere saves; Escape drops it. */
  const end = (c: SheetColumn, save: boolean, byKey: boolean) => {
    const t = typingRef.current;
    if (!t || t.key !== c.key) return;
    typingRef.current = null;
    if (byKey) focusBack.current = c.key;
    setTyping(null);
    if (!save || !day) return;
    const parsed = parseCell(t.text, c);
    if (parsed === "bad") {
      onBadNumber(t.text);
      return;
    }
    // The grid's rule: the same number again, or clearing what nobody typed, saves nothing.
    const had = valueOn(c, day);
    if ((parsed === null && !had.typed) || parsed === had.value) return;
    onSave(c, day, parsed);
  };

  /** The open row's reasons, worked out only for the row whose details are showing. */
  const showingWhy = (c: SheetColumn) =>
    details === c.key ? explain(c, day) : null;

  const shown = sections
    .map(s => ({
      ...s,
      rows: only ? s.cols.filter(c => judged[c.key] === only) : s.cols,
    }))
    .filter(s => s.rows.length);

  const dayWords = !day
    ? null
    : day === today
      ? "Today so far: type what only you know."
      : day === sheet.through
        ? "The last complete day."
        : null;

  return (
    <div className="grid min-w-0 gap-3">
      {/* The day strip. */}
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="no-touch touch-manipulation size-[44px] shrink-0"
          aria-label="The day before"
          disabled={!day || choosable.indexOf(day) <= 0}
          onClick={() => step(-1)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <div
          ref={stripRef}
          role="group"
          aria-label="Which day"
          className="relative flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {sheet.days.map(d => {
            const picked = d === day;
            const later = d > today;
            return (
              <button
                key={d}
                type="button"
                data-day={d}
                aria-pressed={picked}
                aria-label={`${weekday(d)} ${shortDate(d)}${d === today ? ", today" : ""}`}
                disabled={later}
                onClick={() => {
                  setDay(d);
                  setTyping(null);
                  typingRef.current = null;
                }}
                className={cn(
                  "no-touch touch-manipulation grid h-[44px] min-w-[44px] shrink-0 place-items-center rounded-md px-2 text-xs leading-tight tabular-nums",
                  picked
                    ? "bg-primary/15 font-semibold text-foreground ring-1 ring-primary/50"
                    : "text-muted-foreground",
                  !isWorkingDay(d) && !picked && "opacity-60",
                  later && "opacity-35",
                )}
              >
                <span className="text-[10px] uppercase tracking-wide">
                  {d === today ? "Today" : weekday(d)}
                </span>
                <span className="text-sm">{Number(d.slice(8))}</span>
              </button>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="no-touch touch-manipulation size-[44px] shrink-0"
          aria-label="The day after"
          disabled={!day || choosable.indexOf(day) >= choosable.length - 1}
          onClick={() => step(1)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>

      {day ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{`${weekday(day)} ${shortDate(day)}`}</span>
          {dayWords ? ` · ${dayWords}` : null}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          This month has not started. Its days fill in from the 1st.
        </p>
      )}

      {/* Behind, close, on pace: tap one to show only those. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {(["red", "yellow", "green"] as const).map(k => (
          <button
            key={k}
            type="button"
            aria-pressed={only === k}
            onClick={() => setOnly(only === k ? null : k)}
            className={cn(
              "no-touch touch-manipulation inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2.5 text-sm",
              only === k
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted/60",
            )}
          >
            <StatusDot tone={COLOUR_TONE[k]} label={COUNT_WORD[k]} />
            <span className="font-semibold tabular-nums">{tally[k]}</span>
            <span className="text-muted-foreground">{COUNT_WORD[k]}</span>
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="no-touch touch-manipulation ml-auto min-h-[44px] pointer-coarse:min-h-11"
          onClick={onOpenTable}
        >
          <Table2 aria-hidden />
          Open as table
        </Button>
      </div>

      {only && !shown.length ? (
        <p className="text-sm text-muted-foreground">
          {`Nothing is ${COUNT_WORD[only]} this month.`}
        </p>
      ) : null}

      {/* Ends well above "Ask Hermes", so the last row scrolls clear of it. */}
      <div
        ref={listRef}
        className="grid pb-[calc(5rem+env(safe-area-inset-bottom,0px))]"
      >
        {shown.map(s => {
          const reds = s.cols.filter(c => judged[c.key] === "red").length;
          const yellows = s.cols.filter(c => judged[c.key] === "yellow").length;
          // Closed until opened, so the first screen is the sections and their
          // verdicts; what he opens stays open on this device. Filtering opens
          // what it shows.
          const isOpen = only ? true : (open[s.key] ?? false);
          return (
            <section key={s.key} className="border-t first:border-t-0">
              <button
                type="button"
                aria-expanded={isOpen}
                disabled={Boolean(only)}
                onClick={() => toggleSection(s.key, isOpen)}
                className="no-touch touch-manipulation flex min-h-[48px] w-full items-center gap-2 text-left disabled:cursor-default"
              >
                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                    isOpen && "rotate-90",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 text-sm font-semibold">
                  {s.label}
                </span>
                {reds || yellows ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                    <StatusDot
                      tone={reds ? "critical" : "warning"}
                      label={reds ? "Behind" : "Close"}
                    />
                    {reds ? `${reds} behind` : `${yellows} close`}
                  </span>
                ) : null}
              </button>
              {isOpen ? (
                <ul className="grid pb-2">
                  {s.rows.map(c => (
                    <Row
                      key={c.key}
                      c={c}
                      day={day}
                      today={today}
                      sheet={sheet}
                      v={day ? valueOn(c, day) : { value: null, typed: false }}
                      target={targetOf(c)}
                      note={targets[targetKeyOf(c)]?.note ?? null}
                      actual={actual[c.key] ?? null}
                      pace={pace[c.key] ?? null}
                      colour={judged[c.key]}
                      showing={details === c.key}
                      onDetails={() =>
                        setDetails(details === c.key ? null : c.key)
                      }
                      why={showingWhy(c)}
                      typing={typing?.key === c.key ? typing.text : null}
                      inputRef={inputRef}
                      onBegin={() => begin(c)}
                      onType={text => {
                        const t = { key: c.key, text };
                        typingRef.current = t;
                        setTyping(t);
                      }}
                      onEnd={(save, byKey) => end(c, save, byKey)}
                    />
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        An empty number is missing, never zero. Tap a name to see where its
        number comes from.
      </p>
    </div>
  );
}

function Row({
  c,
  day,
  today,
  sheet,
  v,
  target,
  note,
  actual,
  pace,
  colour,
  showing,
  onDetails,
  why,
  typing,
  inputRef,
  onBegin,
  onType,
  onEnd,
}: {
  c: SheetColumn;
  day: string | null;
  today: string;
  sheet: SheetData;
  v: { value: number | null; typed: boolean };
  target: number | null;
  note: string | null;
  actual: number | null;
  pace: number | null;
  colour: Colour | null;
  showing: boolean;
  onDetails: () => void;
  /** The day's and the month's reasons, while the details show. */
  why: { day: string; month: string } | null;
  typing: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onBegin: () => void;
  onType: (text: string) => void;
  onEnd: (save: boolean, byKey: boolean) => void;
}) {
  const level = isLevel(c);
  const value = show(v.value, c) || EMPTY;
  const mtd = show(actual, c) || EMPTY;
  const paced = show(pace, c);
  const aim = show(target, c);
  // "12 this month · on pace for 208 of 208"; a rate or a cost is judged
  // whole, so it reads against its target with no pace.
  const parts = [`${mtd} this month`];
  if (!level && paced)
    parts.push(aim ? `on pace for ${paced} of ${aim}` : `on pace for ${paced}`);
  else if (aim) parts.push(`target ${aim}`);
  if (!aim) parts.push("no target yet");
  const line = parts.join(" · ");
  // The board's bar: how much of the target is done, and for a count that
  // adds up, a tick where the working days so far should have reached.
  const progress =
    target === null || actual === null || target === 0
      ? null
      : c.direction === "up"
        ? actual / target
        : actual <= 0
          ? 1
          : target / actual;
  const tick =
    level || c.direction === "down" || !target || sheet.workingDays <= 0
      ? null
      : sheet.workedSoFar / sheet.workingDays;
  const measured =
    day && v.typed
      ? rollUp(c, rowsOf({ ...sheet, typed: {} }, [day]), 1)
      : null;

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onEnd(true, true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onEnd(false, true);
    }
  };

  return (
    <li className="grid gap-1.5 py-2" data-col={c.key}>
      <div
        className={cn(
          "flex min-h-[44px] items-center justify-between gap-3",
          CLEAR_OF_HERMES,
        )}
      >
        <button
          type="button"
          aria-expanded={showing}
          onClick={onDetails}
          className="no-touch touch-manipulation min-h-[44px] min-w-0 flex-1 text-left text-sm leading-5"
        >
          {c.label}
        </button>
        {typing !== null ? (
          <input
            ref={inputRef}
            value={typing}
            aria-label={`${c.label} on ${day}`}
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            spellCheck={false}
            onChange={e => onType(e.target.value)}
            onBlur={() => onEnd(true, false)}
            onKeyDown={onKey}
            // 16px, or a phone zooms the page in on the box.
            className="h-[44px] w-28 shrink-0 rounded-md border bg-background px-2.5 text-right text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : c.editable && day ? (
          <button
            type="button"
            data-number
            onClick={onBegin}
            aria-label={`Type ${c.label} for ${shortDate(day)}: ${value === EMPTY ? "empty" : value}`}
            className={cn(
              "no-touch touch-manipulation inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-end gap-1.5 rounded-md px-2 text-base tabular-nums hover:bg-muted/60",
              v.typed ? "font-semibold" : "font-medium",
              value === EMPTY && "text-muted-foreground",
            )}
          >
            {value}
            <Pencil className="size-3.5 text-muted-foreground" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            data-number
            onClick={onDetails}
            aria-label={`${c.label}: ${value === EMPTY ? "empty" : value}. Show where it comes from`}
            className={cn(
              "no-touch touch-manipulation inline-flex min-h-[44px] shrink-0 items-center justify-end px-2 text-base font-medium tabular-nums",
              value === EMPTY && "text-muted-foreground",
            )}
          >
            {value}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">{line}</p>
      <PaceBar
        progress={progress}
        pace={tick}
        good={colour === null ? null : colour === "green"}
        tone={colour === "red" ? "critical" : "warning"}
        label={`${c.label}: ${mtd} this month${aim ? ` against a target of ${aim}` : ", no target yet"}`}
      />
      {showing ? (
        <div className="grid gap-1 break-words rounded-md bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
          <p>{c.source}</p>
          {v.typed ? (
            <p>
              {measured !== null
                ? `Typed for this day, over the measured ${show(measured, c)}.`
                : "Typed for this day."}
            </p>
          ) : null}
          {why?.day ? (
            <p>{`${day === today ? "Today" : "This day"}: ${why.day}`}</p>
          ) : null}
          {why?.month ? <p>{`This month: ${why.month}`}</p> : null}
          {note ? <p>{`Target: ${note}`}</p> : null}
          <p>
            {c.editable
              ? day === today
                ? "Today is still running: what is measured so far shows here."
                : "Tap the number to type this day's; clear it to go back to what was measured."
              : fixedHintOf(c)}
          </p>
        </div>
      ) : null}
    </li>
  );
}
