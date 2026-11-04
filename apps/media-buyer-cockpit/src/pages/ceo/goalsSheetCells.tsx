import { RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { count, decimal, money, pct1 } from "@/components/ceo/format";
import { Button } from "@/components/ui/button";
import type { SheetCell, SheetContext } from "@/lib/ceoGoalSheetClient";
import type { Colour, Revenue, SheetColumn } from "./goalsSheetModel";

/**
 * What the grid and the phone view share (2026-11-02): how a cell's number is
 * written and read back, the optimistic patch of the sheet's context, the
 * line a failed save leaves, and the switch between the two layouts. Both
 * views save through the one path in goalsSheet.tsx, so a number typed on the
 * phone follows the grid's rules.
 */

export function show(v: number | null | undefined, c: SheetColumn): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  switch (c.unit) {
    case "usd":
      return money(v);
    case "rate":
      return pct1(v);
    case "x":
      return `${decimal(v, 1)}×`;
    case "pts":
      return decimal(v, 1);
    default:
      return c.rollup.kind === "perWorkingDay" || c.rollup.kind === "avg"
        ? decimal(v, 1)
        : count(v);
  }
}

/** What a typed number means: 12% is 0.12, and $1,200 is 1200. */
export function parseCell(text: string, c: SheetColumn): number | null | "bad" {
  const t = text.replace(/[,$%×x\s]/gi, "").replace(/−/g, "-");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "bad";
  return c.unit === "rate" ? n / 100 : n;
}

/** The number as it is typed back: a rate in percent, two decimals at most. */
export function editText(v: number | null | undefined, c: SheetColumn): string {
  if (v === null || v === undefined) return "";
  if (c.unit === "rate") return String(Math.round(v * 1000) / 10);
  return String(Math.round(v * 100) / 100);
}

export const COLOUR_TONE: Record<Colour, "good" | "warning" | "critical"> = {
  green: "good",
  yellow: "warning",
  red: "critical",
};
export const COLOUR_WORD: Record<Colour, string> = {
  green: "Green",
  yellow: "Yellow",
  red: "Red",
};

export type CellWrite = {
  day: string;
  key: string;
  kind: "actual" | "plan";
  value: number | null;
};

/** The one string a cell is known by, for "is this still the newest save of it". */
export function cellId(w: Pick<CellWrite, "day" | "key" | "kind">): string {
  return `${w.kind}|${w.day}|${w.key}`;
}

/** The value a cell holds in the context now, or null when nothing is typed there. */
export function cellNow(ctx: SheetContext, w: CellWrite): number | null {
  const hit = ctx.cells.find(
    c => c.day === w.day && c.key === w.key && c.kind === w.kind,
  );
  return hit ? Number(hit.value) : null;
}

/**
 * The context with these cells typed (null clears one), so the sheet shows a
 * number the moment it is typed, before the save comes back (2026-11-02). A
 * new array, never the old one changed: the server's answer and the patch are
 * kept apart.
 */
export function patchCells(
  ctx: SheetContext,
  cells: CellWrite[],
): SheetContext {
  const ids = new Set(cells.map(cellId));
  const kept = ctx.cells.filter(c => !ids.has(cellId(c)));
  const at = new Date().toISOString();
  const added: SheetCell[] = cells
    .filter(w => w.value !== null)
    .map(w => ({
      day: w.day,
      key: w.key,
      kind: w.kind,
      value: w.value as number,
      note: null,
      by: "you",
      at,
    }));
  return { ...ctx, cells: [...kept, ...added] };
}

/** The context with these target rows (saveTargets' shape) in place, for the same reason. */
export function patchTargets(
  ctx: SheetContext,
  rows: Record<string, unknown>[],
): SheetContext {
  const targets = ctx.targets.map(t => ({ ...t }));
  for (const r of rows) {
    const key = String(r.metricKey);
    const hit = targets.find(t => String(t.metric_key) === key);
    if (hit) {
      hit.target = r.target;
      hit.note = r.note;
    } else
      targets.push({
        id: -1,
        metric_key: key,
        group_key: r.groupKey,
        label: r.label,
        unit: r.unit,
        direction: r.direction,
        target: r.target,
        note: r.note,
        sort: r.sort,
      });
  }
  return { ...ctx, targets };
}

/**
 * Revenue's own words beside its number (2026-11-02, round 2): its parts over
 * the same days (new cash and back-end cash make every payment in, less the
 * refunds logged by hand) and the money the CEO left out, by name. Why a part
 * is not read comes from `whyWords`, once.
 */
export function revenueWords(rev: Revenue): string {
  const out: string[] = [];
  const { newCash, backEndCash, refundsManual } = rev.parts;
  if (rev.cashIn !== null) {
    const split =
      backEndCash !== null
        ? `Total new cash ${money(newCash ?? 0)} and back-end cash ${money(backEndCash)} make every payment in, ${money(rev.cashIn)}`
        : `Every payment in, ${money(rev.cashIn)}`;
    out.push(
      refundsManual !== null
        ? `${split}; less ${money(refundsManual)} of refunds logged by hand.`
        : `${split}.`,
    );
  }
  // What is not read is said once, by the reasons beside it (whyWords).
  if (rev.leftOut.length)
    out.push(`Leaves out ${rev.leftOut.join("; ")}: not program money.`);
  out.push(...rev.notes);
  return out.join(" ");
}

/**
 * Why a number is missing, or what it leaves out (2026-11-02): the sheet's
 * own reasons, so an empty cell says what it waits on and what to do next.
 */
export function whyWords(
  notes: { waits: string[]; leaves: string[] },
  value: number | null,
): string {
  if (value === null)
    return notes.waits.length
      ? `Missing: ${notes.waits.join(" ")}`
      : "Missing: nothing recorded it for these days yet.";
  return notes.leaves.join(" ");
}

/** Parts Meta reports, which it can still adjust for a few days. */
const META_PARTS: ReadonlySet<string> = new Set([
  "spend",
  "spendRetargeting",
  "uniqueLinkClicks",
  "clientSyncSpend",
  "clientImpressions",
  "clientLinkClicks",
  "clientSyncLeads",
  "clientSpend",
  "clientCplSpend",
  "clientSpendMeasured",
]);
const DUE_COLUMNS: ReadonlySet<string> = new Set([
  "introsDue",
  "demosDue",
  "introShowRate",
  "demoShowRate",
]);

/**
 * The newest days' caveat (2026-11-02, truth/SYNTHESIS.md fix 16): Meta can
 * still adjust its last 3 days (1 Nov's spend moved $84.32 to $84.34), and
 * today's calls scheduled count only the calls whose time has passed.
 */
export function freshHint(
  c: SheetColumn,
  through: string | null,
  today: string,
  parts: string[],
): string {
  if (!through) return "";
  const out: string[] = [];
  const three = new Date(Date.parse(`${today}T00:00:00Z`) - 3 * 86400000)
    .toISOString()
    .slice(0, 10);
  if (through >= three && parts.some(p => META_PARTS.has(p)))
    out.push("Meta can still adjust its last 3 days, so these can move.");
  if (through === today && !c.custom && DUE_COLUMNS.has(c.key))
    out.push(
      "Today's calls scheduled count only the calls whose time has passed.",
    );
  return out.join(" ");
}

/** Revenue and the two columns made from it carry revenue's words. */
export const FROM_REVENUE: ReadonlySet<string> = new Set([
  "totalCash",
  "profit",
  "margin",
]);

/** A failed save's message: the server's reason, short. */
export function reasonOf(e: unknown): string {
  return String(e instanceof Error ? e.message : e)
    .replace(/\.$/, "")
    .slice(0, 300);
}

export type SaveProblem = { text: string; retry: () => void };

/** What a failed save left: what was not saved, why, the old value back, and Try again. */
export function SaveProblemLine({
  problem,
  onClose,
}: {
  problem: SaveProblem;
  onClose: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
    >
      <p className="min-w-0 flex-1 break-words">{problem.text}</p>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="outline" onClick={problem.retry}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="Close this message"
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** Below 640px the sheet is a daily check, not a squeezed spreadsheet (2026-11-02). */
const NARROW = "(max-width: 639px)";

export function useNarrow(): boolean {
  const read = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(NARROW).matches;
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(NARROW);
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

/**
 * A choice kept on this device only. Storage can be off (a private window, a
 * blocked site): then the choice lasts until the page closes.
 */
export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Not kept: the choice still holds until the page closes.
  }
}
