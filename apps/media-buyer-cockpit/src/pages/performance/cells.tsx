/**
 * How one board value reads: the number with a small status dot, the muted
 * words when there is no number ("Not filled in", "n/a"), and the help that
 * says what it is, how it was worked out and what its target is. The colour
 * sits on the dot only; the number stays in the text colour.
 */
import { CircleAlert } from "lucide-react";
import { isNum } from "@/components/ceo/format";
import { Hint } from "@/components/ceo/Hint";
import type { Cell, CellStatus, ClientRow, Target } from "@/lib/boardClient";
import {
  type BoardColumn,
  floorOf,
  formatValue,
  percent,
  STATUS_WORDS,
  statusOf,
  targetSource,
  targetText,
  targetUnit,
  type Unit,
} from "@/lib/boardColumns";
import { cn } from "@/lib/utils";

const DOT: Partial<Record<CellStatus, string>> = {
  good: "var(--ceo-good)",
  watch: "var(--ceo-warning)",
  off: "var(--ceo-critical)",
};

/** good, watch and off are filled dots; too few is a hollow ring; anything else has none. */
export function BoardDot({
  status,
  className,
}: {
  status: CellStatus | null;
  className?: string;
}) {
  if (!status) return null;
  if (status === "too_few")
    return (
      <span
        role="img"
        aria-label={STATUS_WORDS.too_few}
        className={cn(
          "inline-block size-1.5 shrink-0 rounded-full border border-[color:var(--ceo-deemphasis)]",
          className,
        )}
      />
    );
  const color = DOT[status];
  if (!color) return null;
  return (
    <span
      role="img"
      aria-label={STATUS_WORDS[status]}
      className={cn("inline-block size-1.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

/** The words a cell shows when it has no number. */
export function emptyWords(cell: Cell | null | undefined): string {
  const s = statusOf(cell);
  if (cell?.clientCalls) return "Client calls";
  if (cell?.clientBooks) return "Done with you";
  if (s === "not_filled_in") return "Not filled in";
  if (cell?.notVideo) return "Not a video";
  if (s === "too_few") return "Too few";
  return "n/a";
}

/**
 * The number as the board shows it: a trailing + when it is a floor ("at
 * least"), the dot of its own status (or of `dotFrom`'s cell).
 */
export function CellContent({
  cell,
  unit,
  dot,
}: {
  cell: Cell | null | undefined;
  unit: Unit;
  /** The status the dot shows; the cell's own when left out. */
  dot?: CellStatus | null;
}) {
  const status = dot === undefined ? statusOf(cell) : dot;
  const floor = floorOf(cell);
  if (!cell || (!isNum(cell.v) && floor === null))
    return (
      <span className="whitespace-nowrap text-xs font-normal text-muted-foreground">
        {emptyWords(cell)}
      </span>
    );
  const shown = isNum(cell.v) ? cell.v : (floor as number);
  const atLeast = !isNum(cell.v) || cell.atLeast === true;
  // Too few to judge: the number is shown, quieter, beside a hollow ring.
  const quiet = status === "too_few";
  return (
    <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
      <BoardDot status={status} />
      <span className={cn("tabular-nums", quiet && "text-muted-foreground")}>
        {formatValue(shown, unit)}
        {atLeast ? <span aria-hidden>+</span> : null}
      </span>
    </span>
  );
}

function figure(v: number | null | undefined, unit: Unit): string {
  return formatValue(v, unit);
}

/** What a cell is, how it came out, and its target: the help on hover or tap. */
export function CellHelp({
  column,
  cell,
  target,
  extra,
  status: own,
}: {
  column: BoardColumn;
  cell: Cell | null | undefined;
  target?: Target | null;
  /** A line of its own, e.g. the oldest appointment's age. */
  extra?: string | null;
  /** The status the dot shows, when it is not the cell's own (`dotFrom`). */
  status?: CellStatus | null;
}) {
  const status = own === undefined ? statusOf(cell) : own;
  const floor = floorOf(cell);
  const unit = column.unit;
  const value = isNum(cell?.v)
    ? `${formatValue(cell.v, unit)}${cell.atLeast === true ? " or more" : ""}`
    : floor !== null
      ? `at least ${formatValue(floor, unit)}`
      : emptyWords(cell);
  const parts =
    column.parts && cell && isNum(cell.num) && isNum(cell.den)
      ? `${figure(cell.num, column.parts[0].unit)} ${column.parts[0].label} / ${figure(cell.den, column.parts[1].unit)} ${column.parts[1].label}`
      : null;
  return (
    <div className="space-y-1">
      <p className="font-medium text-foreground">
        {column.name}: {value}
        {status && status !== "not_measured" && status !== "not_filled_in"
          ? ` (${STATUS_WORDS[status].toLowerCase()})`
          : ""}
      </p>
      <p className="text-muted-foreground">{column.how}</p>
      {parts ? <p className="tabular-nums">{parts}</p> : null}
      {target ? (
        <p>
          {targetText(target, targetUnit(target))}{" "}
          <span className="text-muted-foreground">
            {targetSource(target)}
            {isNum(target.minSample) && target.minSample > 1 && target.sample
              ? `, judged from ${formatValue(target.minSample, "count")} ${target.sample}`
              : ""}
            .
          </span>
        </p>
      ) : null}
      {extra ? <p>{extra}</p> : null}
      {cell?.note ? <p className="text-muted-foreground">{cell.note}</p> : null}
      {cell?.shareNote ? (
        <p className="text-muted-foreground">{cell.shareNote}</p>
      ) : null}
    </div>
  );
}

/** Four small bars for a video's 25, 50, 75 and 100% marks; words for anything else. */
export function RetentionBars({
  values,
  className,
}: {
  values: Record<string, Cell> | null | undefined;
  className?: string;
}) {
  const marks = [
    "retention25",
    "retention50",
    "retention75",
    "retention100",
  ].map(k => values?.[k]);
  const first = marks[0];
  if (!marks.every(m => m && isNum(m.v)))
    return (
      <span className="whitespace-nowrap text-xs font-normal text-muted-foreground">
        {first?.notVideo ? "Not a video" : "n/a"}
      </span>
    );
  const pcts = marks.map(m => Math.max(0, Math.min(100, m?.v as number)));
  const label = `Watched to 25%: ${percent(pcts[0])}, 50%: ${percent(pcts[1])}, 75%: ${percent(pcts[2])}, 100%: ${percent(pcts[3])}`;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex h-4 items-end gap-[2px] align-middle",
        className,
      )}
    >
      {pcts.map((p, i) => (
        <span
          key={i}
          className="flex h-full w-[5px] flex-col justify-end rounded-[1px] bg-[color:var(--ceo-emphasis-track)]"
        >
          <span
            className="block w-full rounded-[1px] bg-[color:var(--ceo-emphasis)]"
            style={{ height: `${Math.max(p, 4)}%` }}
          />
        </span>
      ))}
    </span>
  );
}

/** The four retention marks as words, for the help. */
export function retentionWords(
  values: Record<string, Cell> | null | undefined,
): string | null {
  const marks = [
    "retention25",
    "retention50",
    "retention75",
    "retention100",
  ].map(k => values?.[k]?.v);
  if (!marks.every(isNum)) return null;
  return `Watched to 25%: ${percent(marks[0])} · 50%: ${percent(marks[1])} · 75%: ${percent(marks[2])} · 100%: ${percent(marks[3])}`;
}

/**
 * The caller's names in one line (`text`), the grid's short form (`short`:
 * the first name and "+1" for the others), or the muted words when the
 * dialer assigns nobody.
 */
export function callerLine(row: Pick<ClientRow, "callers" | "clientCalls">): {
  text: string;
  short: string;
  none: boolean;
} {
  if (row.clientCalls)
    return { text: "Client calls", short: "Client calls", none: true };
  const names = (row.callers ?? []).map(c => c.name).filter(Boolean);
  if (!names.length)
    return {
      text: "No caller assigned",
      short: "No caller assigned",
      none: true,
    };
  return {
    text: names.join(", "),
    short: names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0],
    none: false,
  };
}

/** A grid or list cell with its help: hover with a mouse, tap on a touch screen. */
export function HelpCell({
  help,
  children,
  label,
  className,
}: {
  help: React.ReactNode;
  children: React.ReactNode;
  /** What a screen reader hears for the cell. */
  label: string;
  className?: string;
}) {
  return (
    <Hint content={help} side="top">
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        className={cn(
          "no-touch relative inline-flex min-w-0 cursor-default items-center justify-end rounded-sm after:absolute after:-inset-1.5 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {children}
      </button>
    </Hint>
  );
}

/** A problem in one sentence: the colour on the icon, the words in the text colour. */
export function Problem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      role="alert"
      className={cn("flex items-start gap-1.5 text-xs", className)}
    >
      <CircleAlert
        aria-hidden
        className="mt-px size-3.5 shrink-0"
        style={{ color: "var(--ceo-critical)" }}
      />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
