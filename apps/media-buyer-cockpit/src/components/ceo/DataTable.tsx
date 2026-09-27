import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Search,
  Table2,
} from "lucide-react";
import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";
import { count, isNum } from "./format";

export type Column<T> = {
  /** Unique column id, also used for sorting. */
  key: string;
  /** Header text, sentence case. */
  header: string;
  /** Cell content; format numbers with format.ts. */
  cell: (row: T) => ReactNode;
  /** Value to sort by; leave out for a column that does not sort. Null sorts last either way. */
  sortValue?: (row: T) => number | string | null | undefined;
  /** Right-aligned with tabular figures. */
  numeric?: boolean;
  /**
   * Hide the column while the table is narrower than this, to spare phone
   * width. Measured on the table's own width, not the screen's, so a table
   * in a half-width card on a laptop drops the same columns as on a phone:
   * sm 448px, md 576px, lg 768px.
   */
  hideBelow?: "sm" | "md" | "lg";
  /** Extra classes for the header and cells (widths, wrapping). */
  className?: string;
};

type Sort = { key: string; dir: "asc" | "desc" };

const HIDE: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden @md:table-cell",
  md: "hidden @xl:table-cell",
  lg: "hidden @3xl:table-cell",
};

/**
 * A quiet, sortable table: tabular numbers aligned right, hairline rows, an
 * optional search box and filter row, and horizontal scroll inside its card.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  search,
  filters,
  limit,
  pageSize,
  emptyText = "Nothing to show yet.",
  caption,
  stickyFirst = false,
  bleed = true,
  onRowClick,
  className,
  tableClassName,
}: {
  /** The rows, in their default order. */
  rows: T[];
  /** Column definitions, left to right. */
  columns: Column<T>[];
  /** Stable key per row. */
  rowKey: (row: T, index: number) => string;
  /** Sort applied on first render. */
  initialSort?: Sort;
  /** Adds a search box that matches this text per row. */
  search?: { placeholder?: string; text: (row: T) => string };
  /** Controls for the filter row, beside the search box (chips, selects). */
  filters?: ReactNode;
  /** Show the first N rows with a "Show all" button. */
  limit?: number;
  /**
   * For lists that can run to hundreds of rows: show the first N, then N more
   * per press ("Show 50 more"). Takes the place of `limit`; a new search or a
   * new set of rows starts again from the first page.
   */
  pageSize?: number;
  /** Text when there are no rows (or none match the search). */
  emptyText?: string;
  /** Screen reader caption naming the table. */
  caption?: string;
  /** Keep the first column visible while scrolling sideways on a phone. */
  stickyFirst?: boolean;
  /** Run rows to the card edges; assumes the SectionCard padding (16px, 24px from sm up). */
  bleed?: boolean;
  /** Makes rows clickable. */
  onRowClick?: (row: T) => void;
  className?: string;
  /** Classes for the table itself, e.g. min-w-max so wide rows scroll inside the card instead of wrapping. */
  tableClassName?: string;
}) {
  const [sort, setSort] = useState<Sort | null>(initialSort ?? null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [pages, setPages] = useState(1);
  const deferredQuery = useDeferredValue(query);
  // Back to the first page when the list itself changes (a filter, a new
  // timeframe) or the search does; a refresh that keeps the rows keeps it.
  const firstKey = rows.length ? rowKey(rows[0], 0) : "";
  const listSignature = `${rows.length}:${firstKey}:${deferredQuery}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the signature is the trigger
  useEffect(() => {
    setPages(1);
  }, [listSignature]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!search || !q) return rows;
    return rows.filter(r => search.text(r).toLowerCase().includes(q));
  }, [rows, search, deferredQuery]);

  const sorted = useMemo(() => {
    const col = sort ? columns.find(c => c.key === sort.key) : undefined;
    if (!sort || !col?.sortValue) return filtered;
    const get = col.sortValue;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const na =
        va === null ||
        va === undefined ||
        (typeof va === "number" && !isNum(va));
      const nb =
        vb === null ||
        vb === undefined ||
        (typeof vb === "number" && !isNum(vb));
      if (na || nb) return na === nb ? 0 : na ? 1 : -1;
      if (typeof va === "number" && typeof vb === "number")
        return (va - vb) * dir;
      return (
        String(va).localeCompare(String(vb), "en", { sensitivity: "base" }) *
        dir
      );
    });
  }, [filtered, sort, columns]);

  const visible = pageSize
    ? sorted.slice(0, pageSize * pages)
    : limit && !expanded
      ? sorted.slice(0, limit)
      : sorted;
  const hiddenCount = sorted.length - visible.length;

  const toggleSort = (col: Column<T>) => {
    setSort(prev => {
      if (prev?.key === col.key)
        return { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { key: col.key, dir: col.numeric ? "desc" : "asc" };
    });
  };

  // The bleed matches the SectionCard padding, so the first and last cells
  // line up with the card's other content and the hairlines run edge to edge.
  const edge = bleed
    ? "first:pl-4 sm:first:pl-6 last:pr-4 sm:last:pr-6"
    : "first:pl-0 last:pr-0";

  return (
    // A size container: hideBelow reads the table's own width.
    <div className={cn("@container min-w-0", className)}>
      {search || filters ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {search ? (
            <label className="relative flex min-w-0 flex-1 items-center @md:max-w-64">
              <span className="sr-only">Search</span>
              <Search
                className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={search.placeholder ?? "Search"}
                className="h-8 w-full rounded-md border bg-background pl-8 pr-2.5 text-base placeholder:text-muted-foreground sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          ) : null}
          {filters}
          {search && deferredQuery.trim() ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {count(filtered.length)} of {count(rows.length)}
            </span>
          ) : null}
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <EmptyState icon={Table2} title={emptyText} compact />
      ) : (
        // relative: a visually hidden element in a scrolled-off cell (the
        // native select behind a Kind picker, a screen reader label) belongs
        // to this scroller, so it is clipped here instead of widening the page.
        <div
          className={cn(
            "ceo-table-scroll relative overflow-x-auto",
            bleed && "-mx-4 sm:-mx-6",
          )}
        >
          <table
            className={cn("w-full border-collapse text-sm", tableClassName)}
          >
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead>
              <tr className="border-b">
                {columns.map((col, ci) => {
                  const active = sort?.key === col.key;
                  const ariaSort = active
                    ? sort?.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined;
                  const Icon = active
                    ? sort?.dir === "asc"
                      ? ArrowUp
                      : ArrowDown
                    : ChevronsUpDown;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={ariaSort}
                      className={cn(
                        "h-9 whitespace-nowrap px-3 text-xs font-medium text-muted-foreground",
                        col.numeric ? "text-right" : "text-left",
                        edge,
                        col.hideBelow && HIDE[col.hideBelow],
                        stickyFirst &&
                          ci === 0 &&
                          "sticky left-0 z-[1] bg-card",
                        col.className,
                      )}
                    >
                      {col.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col)}
                          className={cn(
                            "no-touch group relative inline-flex items-center gap-1 rounded-sm after:absolute after:-inset-x-1.5 after:-inset-y-2 after:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            col.numeric && "flex-row-reverse",
                            active && "text-foreground",
                          )}
                        >
                          {col.header}
                          <Icon
                            className={cn(
                              "size-3 shrink-0",
                              active
                                ? "opacity-100"
                                : "opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60",
                            )}
                            aria-hidden
                          />
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, ri) => (
                <tr
                  key={rowKey(row, ri)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "group/row border-b border-[color:var(--ceo-grid)] last:border-0",
                    onRowClick
                      ? "cursor-pointer hover:bg-[var(--ceo-hover)]"
                      : "hover:bg-[var(--ceo-hover)]",
                  )}
                >
                  {columns.map((col, ci) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-3 py-2.5 align-middle",
                        col.numeric
                          ? "whitespace-nowrap text-right tabular-nums"
                          : "text-left",
                        edge,
                        col.hideBelow && HIDE[col.hideBelow],
                        stickyFirst &&
                          ci === 0 &&
                          "sticky left-0 z-[1] bg-card",
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageSize ? (
        sorted.length > pageSize ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {hiddenCount > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPages(p => p + 1)}
              >
                {`Show ${count(Math.min(pageSize, hiddenCount))} more`}
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground tabular-nums">
              {`${count(visible.length)} of ${count(sorted.length)} shown`}
            </span>
            {pages > 1 ? (
              <button
                type="button"
                onClick={() => setPages(1)}
                className="rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Show fewer
              </button>
            ) : null}
          </div>
        ) : null
      ) : limit && sorted.length > limit ? (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
          className="mt-3 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? "Show fewer" : `Show all ${count(sorted.length)}`}
        </button>
      ) : null}
    </div>
  );
}
