/**
 * The board's one grid: a sticky client column, the column groups (Ads,
 * Funnel, Outcomes, Calls), sort by any column, each value with its status
 * dot and its help. A client's name opens its panel.
 */
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";
import { Fragment } from "react";
import { isNum } from "@/components/ceo/format";
import type { Cell, ClientRow, Target, Targets } from "@/lib/boardClient";
import {
  type BoardColumn,
  firstBreak,
  GROUPS,
  type GroupKey,
  percent,
  sortNumber,
  statusOf,
} from "@/lib/boardColumns";
import { cn } from "@/lib/utils";
import {
  BoardDot,
  CellContent,
  CellHelp,
  callerLine,
  HelpCell,
  RetentionBars,
  retentionWords,
} from "./cells";

export type Sort = { key: string; dir: "asc" | "desc" };

/** The value a column sorts by: a number, a name, or null (always last). */
export function sortValue(
  row: ClientRow,
  column: string,
): number | string | null {
  if (column === "client") return row.clientName;
  if (column === "caller") {
    const c = callerLine(row);
    return c.none ? null : c.text;
  }
  if (column === "noOutcome")
    return isNum(row.noOutcome) ? row.noOutcome : null;
  return sortNumber(row.values[column]);
}

export function sortRows(rows: ClientRow[], sort: Sort): ClientRow[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va === null || vb === null) {
      if (va === vb) return a.clientName.localeCompare(b.clientName);
      return va === null ? 1 : -1;
    }
    const d =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "en", { sensitivity: "base" });
    return d * dir || a.clientName.localeCompare(b.clientName);
  });
}

/** The words under a client's name: where its funnel breaks first. */
export function FirstBreakLine({
  row,
  className,
}: {
  row: ClientRow;
  className?: string;
}) {
  const b = firstBreak(row);
  if (b.kind === "unknown")
    return (
      <span className={cn("text-muted-foreground", className)}>
        Not enough to judge
      </span>
    );
  if (b.kind === "on_target")
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <BoardDot status="good" />
        <span className="text-muted-foreground">On target</span>
      </span>
    );
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <BoardDot status={b.kind} />
      <span className="truncate text-muted-foreground">
        {b.kind === "off" ? "Off at" : "Watch"} {b.label}
      </span>
    </span>
  );
}

const STICKY_BG =
  "bg-card group-hover/row:[background:linear-gradient(var(--ceo-hover),var(--ceo-hover)),var(--card)]";

function GridValue({
  row,
  column,
  targets,
}: {
  row: ClientRow;
  column: BoardColumn;
  targets: Targets;
}) {
  const target = column.metric
    ? clientTarget(row, column.metric, targets)
    : null;
  if (column.special === "caller") {
    const c = callerLine(row);
    const emails = (row.callers ?? [])
      .map(p => `${p.name} (${p.email})`)
      .join(", ");
    return (
      <HelpCell
        label={`Caller: ${c.text}`}
        className="max-w-[124px] justify-start sm:max-w-[180px]"
        help={
          <div className="space-y-1">
            <p className="font-medium">Assigned caller: {c.text}</p>
            <p className="text-muted-foreground">
              {row.clientCalls
                ? "Done With You: the client calls its own leads."
                : emails
                  ? `The dialer assigns ${emails}.`
                  : "The dialer assigns no agent to this client. Assign one in the dialer."}
            </p>
          </div>
        }
      >
        <span
          className={cn(
            "truncate text-left",
            c.none && "text-xs text-muted-foreground",
          )}
        >
          {c.text}
        </span>
      </HelpCell>
    );
  }
  if (column.special === "retention") {
    const words = retentionWords(row.values);
    return (
      <HelpCell
        label={`Video retention: ${words ?? "n/a"}`}
        help={
          <CellHelp
            column={column}
            cell={row.values.retention50}
            extra={words}
          />
        }
      >
        <RetentionBars values={row.values} />
      </HelpCell>
    );
  }
  const cell =
    column.key === "noOutcome" ? noOutcomeCell(row) : row.values[column.key];
  const dot = column.dotFrom ? statusOf(row.values[column.dotFrom]) : undefined;
  const extra = extraLine(row, column.key);
  return (
    <HelpCell
      label={`${column.name}: ${cellWords(cell, column)}`}
      help={
        <CellHelp column={column} cell={cell} target={target} extra={extra} />
      }
    >
      <CellContent cell={cell} unit={column.unit} dot={dot} />
    </HelpCell>
  );
}

/** The target that judged this client's cell: its own override, else the board's. */
export function clientTarget(
  row: Pick<ClientRow, "overrides">,
  metric: string,
  targets: Targets,
): Target | null {
  const t = targets[metric];
  if (!t) return null;
  const own = row.overrides?.[metric] as
    | { good?: number; watch?: number | null }
    | undefined;
  if (!own || !isNum(own.good)) return t;
  return { ...t, good: own.good, watch: own.watch ?? null, source: "client" };
}

/** No outcome reads from the row's own count. */
function noOutcomeCell(row: ClientRow): Cell {
  return row.values.noOutcome ?? { v: row.noOutcome ?? null, status: null };
}

function extraLine(row: ClientRow, key: string): string | null {
  if (
    key === "noOutcome" &&
    isNum(row.noOutcomeOldestDays) &&
    (row.noOutcome ?? 0) > 0
  )
    return `The oldest is ${row.noOutcomeOldestDays === 1 ? "1 day" : `${row.noOutcomeOldestDays} days`} old.`;
  if (key === "leadsTouched") {
    const u = row.values.untouchedLeads;
    if (u && isNum(u.v))
      return `${u.v === 1 ? "1 lead is" : `${u.v} leads are`} waiting for a first call now.`;
  }
  if (key === "leadsCalled") {
    const share = row.values.leadsCalled?.share;
    if (isNum(share)) return `${percent(share)} of the CRM leads.`;
  }
  return null;
}

function cellWords(cell: Cell | undefined, column: BoardColumn): string {
  if (!cell || !isNum(cell.v))
    return statusOf(cell) === "not_filled_in"
      ? "not filled in"
      : "not measured";
  return String(cell.v) + (column.unit === "percent" ? "%" : "");
}

export function BoardGrid({
  rows,
  columns,
  targets,
  sort,
  onSort,
  onOpen,
  selected,
  meeting,
  className,
}: {
  rows: ClientRow[];
  columns: BoardColumn[];
  targets: Targets;
  sort: Sort;
  onSort: (sort: Sort) => void;
  onOpen: (row: ClientRow) => void;
  /** The client whose panel is open. */
  selected: string | null;
  /** Bigger type for the meeting screen. */
  meeting: boolean;
  className?: string;
}) {
  // Consecutive columns of one group share a group heading.
  const groups: { key: GroupKey; span: number }[] = [];
  for (const c of columns) {
    const last = groups[groups.length - 1];
    if (last && last.key === c.group) last.span += 1;
    else groups.push({ key: c.group, span: 1 });
  }
  const groupStart = new Set<string>();
  {
    let i = 0;
    for (const g of groups) {
      groupStart.add(columns[i].key);
      i += g.span;
    }
  }
  const toggle = (key: string, numeric: boolean) =>
    onSort(
      sort.key === key
        ? { key, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { key, dir: numeric ? "desc" : "asc" },
    );
  const header = (
    key: string,
    label: string,
    numeric: boolean,
    hint?: string,
  ) => {
    const active = sort.key === key;
    const Icon = active
      ? sort.dir === "asc"
        ? ArrowUp
        : ArrowDown
      : ChevronsUpDown;
    return (
      <button
        type="button"
        onClick={() => toggle(key, numeric)}
        title={hint}
        aria-label={`Sort by ${label}`}
        className={cn(
          "no-touch group relative inline-flex items-center gap-1 whitespace-nowrap rounded-sm after:absolute after:-inset-x-1.5 after:-inset-y-2 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          numeric && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon
          aria-hidden
          className={cn(
            "size-3 shrink-0",
            active
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60",
          )}
        />
      </button>
    );
  };
  const ariaSort = (key: string) =>
    sort.key === key
      ? sort.dir === "asc"
        ? "ascending"
        : "descending"
      : undefined;
  const pad = meeting ? "py-3" : "py-2";

  return (
    <div
      className={cn(
        "relative -mx-4 overflow-auto sm:-mx-6 lg:max-h-[min(76vh,1080px)]",
        className,
      )}
      data-board-grid=""
    >
      <table
        className={cn(
          "w-max min-w-full border-separate border-spacing-0",
          meeting ? "text-[15px]" : "text-[13px]",
        )}
      >
        <caption className="sr-only">
          Every client over the time frame, against its targets
        </caption>
        <thead>
          <tr>
            <th
              scope="colgroup"
              className="sticky top-0 left-0 z-[4] h-7 bg-card pl-4 text-left align-bottom font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-muted-foreground sm:pl-6"
            >
              Client
            </th>
            {groups.map((g, gi) => (
              <th
                key={`${g.key}-${gi}`}
                scope="colgroup"
                colSpan={g.span}
                className={cn(
                  "sticky top-0 z-[2] h-7 bg-card px-3 text-left align-bottom font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-muted-foreground",
                  g.key !== "client" &&
                    "border-l border-[color:var(--ceo-grid)]",
                )}
              >
                {g.key === "client"
                  ? ""
                  : GROUPS.find(x => x.key === g.key)?.label}
              </th>
            ))}
          </tr>
          <tr>
            <th
              scope="col"
              aria-sort={ariaSort("client")}
              className="sticky top-7 left-0 z-[4] h-9 w-[148px] min-w-[148px] border-b bg-card pl-4 pr-3 text-left text-xs font-medium text-muted-foreground sm:w-[224px] sm:min-w-[224px] sm:pl-6"
            >
              {header("client", "Client", false)}
            </th>
            {columns.map(c => {
              const numeric = c.special !== "caller";
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort(c.key)}
                  className={cn(
                    "sticky top-7 z-[2] h-9 border-b bg-card px-3 text-xs font-medium text-muted-foreground",
                    numeric
                      ? "min-w-[84px] text-right"
                      : "min-w-[112px] text-left sm:min-w-[136px]",
                    groupStart.has(c.key) &&
                      c.group !== "client" &&
                      "border-l border-l-[color:var(--ceo-grid)]",
                    "last:pr-4 sm:last:pr-6",
                  )}
                >
                  {header(c.key, c.label, numeric, c.name)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const open = selected === row.locationId;
            return (
              <tr
                key={row.locationId}
                className="group/row"
                data-location={row.locationId}
              >
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-[1] border-b border-[color:var(--ceo-grid)] p-0 text-left font-normal",
                    STICKY_BG,
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(row)}
                    aria-label={`Open ${row.clientName}`}
                    aria-expanded={open}
                    className={cn(
                      "relative flex w-[148px] items-center gap-2 pl-4 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:w-[224px] sm:pl-6",
                      pad,
                    )}
                  >
                    {open ? (
                      <span
                        aria-hidden
                        className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-primary"
                      />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate font-medium text-foreground"
                        dir="auto"
                      >
                        {row.clientName}
                      </span>
                      <FirstBreakLine
                        row={row}
                        className={cn(
                          "mt-0.5 max-w-full",
                          meeting ? "text-xs" : "text-[11px]",
                        )}
                      />
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="hidden size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 sm:block"
                    />
                  </button>
                </th>
                {columns.map(c => (
                  <td
                    key={c.key}
                    className={cn(
                      "border-b border-[color:var(--ceo-grid)] px-3 align-middle group-hover/row:bg-[var(--ceo-hover)]",
                      pad,
                      c.special === "caller" ? "text-left" : "text-right",
                      groupStart.has(c.key) &&
                        c.group !== "client" &&
                        "border-l border-l-[color:var(--ceo-grid)]",
                      "last:pr-4 sm:last:pr-6",
                    )}
                    data-col={c.key}
                  >
                    <GridValue row={row} column={c} targets={targets} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The grid while the board is read: the real headers' shape, quiet bars for numbers. */
export function BoardGridSkeleton({ columns }: { columns: number }) {
  return (
    <div className="-mx-4 overflow-hidden sm:-mx-6" aria-hidden>
      <div className="space-y-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-6 border-b border-[color:var(--ceo-grid)] px-4 py-3 sm:px-6"
          >
            <span className="h-3.5 w-32 shrink-0 animate-pulse rounded bg-muted sm:w-48" />
            {Array.from({ length: columns }).map((__, j) => (
              <Fragment key={j}>
                <span className="h-3 w-14 shrink-0 animate-pulse rounded bg-muted" />
              </Fragment>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
