import { Loader2, Plus, Smartphone, Trash2 } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { count, money, NA, pct, shortDate } from "@/components/ceo/format";
import { KICKER } from "@/components/ceo/Kicker";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusDot } from "@/components/ceo/StatusChip";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import type { SheetContext } from "@/lib/ceoGoalSheetClient";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import { planTitle } from "./goalsKit";
import { LockIn } from "./goalsLockIn";
import { tidy } from "./goalsModel";
import {
  type CellWrite,
  COLOUR_TONE,
  COLOUR_WORD,
  cellId,
  cellNow,
  editText,
  FROM_REVENUE,
  freshHint,
  parseCell,
  patchCells,
  patchTargets,
  readPref,
  reasonOf,
  revenueWords,
  type SaveProblem,
  SaveProblemLine,
  show,
  useNarrow,
  whyWords,
  writePref,
} from "./goalsSheetCells";
import {
  buildSheet,
  cellKey,
  inputKeyOf,
  inputsFromTargets,
  isWorkedOut,
  monthBefore,
  monthSoFar,
  notesFor,
  rangeOf,
  revenueFor,
  rowsOf,
  type SheetRange,
  targetRows,
  targetsOf,
} from "./goalsSheetData";
import {
  ADDABLE_SECTIONS,
  addDays,
  boardLabelOf,
  colourFor,
  daysOfMonth,
  evenDailyPlan,
  fixedHintOf,
  isLevel,
  isWorkingDay,
  paceFor,
  partsOf,
  rollUp,
  type SectionKey,
  SHEET_SECTIONS,
  type SheetColumn,
  shiftMonth,
  storedSection,
  targetKeyOf,
} from "./goalsSheetModel";
import { GoalsSheetPhone } from "./goalsSheetPhone";

/**
 * Aziz, 2026-10-30: "a spreadsheet where he can fill in the projections on a
 * daily basis for all these metrics". The layout is his: the rolling rows on
 * top, the days, then This Month Actual, On Pace For, Target and Colour.
 *
 * Design plan. The subject is one month of the business read across, and the
 * job is to answer "where does this number come from and are we on it". So the
 * grid stays quiet: the cockpit's Geist in tabular figures, hairlines, the two
 * bands (section, row) in muted tone and teal only for the plan row and today.
 * The signature is the formula bar over the grid, as a spreadsheet has: select
 * any cell and it names the cell, its value and, in plain words, where it comes
 * from, what it leaves out and how the plan worked it out. Nothing else moves.
 *
 * Aziz, 2026-11-02: "allow me to edit it in a smooth way, because when I click
 * it, sometimes the way I input numbers, it's glitchy". So the grid edits as
 * Google Sheets does: type on a cell to replace it, Enter, F2 or a double
 * click to change it, Enter down, Tab across, Escape to drop it. A typed number
 * shows at once and saves behind it, once; a save that fails puts the old
 * number back and says why. And "extremely mobile-friendly ... I want to be
 * looking at this every single day": below 640px the sheet is the daily check
 * in goalsSheetPhone.tsx, with the table one tap away.
 */

const SAY = { money, count, pct };

type RowKey =
  | { kind: "day"; day: string }
  | { kind: "target" }
  | { kind: "roll"; label: string };

type Selected = { col: string; row: RowKey };

/**
 * One edit, from the key that opens it to the key that ends it. `id` is how
 * the edit is finished exactly once: Enter, Tab and Escape each unmount the
 * input, and its blur then tried to finish the same edit a second time.
 */
type Editing = {
  id: number;
  sel: Selected;
  text: string;
  /** "end": opened by typing, so the caret follows it. "all": opened to change the number, all of it selected. */
  caret: "end" | "all";
};

function sameCell(a: Selected, b: Selected): boolean {
  if (a.col !== b.col || a.row.kind !== b.row.kind) return false;
  if (a.row.kind === "day")
    return b.row.kind === "day" && a.row.day === b.row.day;
  if (a.row.kind === "roll")
    return b.row.kind === "roll" && a.row.label === b.row.label;
  return true;
}

type Move = "down" | "up" | "right" | "left";
type Finish = Move | "tab" | "backtab" | "stay" | "cancel" | "blur";

const ARROWS: Record<string, Move> = {
  ArrowDown: "down",
  ArrowUp: "up",
  ArrowRight: "right",
  ArrowLeft: "left",
};

/** The keys that start typing over a selected cell: a "%" or "," alone would read as nothing and clear it. */
const STARTS_A_NUMBER = /^[0-9.$-]$/;

/**
 * Worked out from other columns' whole-month numbers: their plan is the
 * target, as only a column's own part gets an even share of a day.
 */
const PLAN_IS_TARGET: ReadonlySet<string> = new Set([
  "totalCash",
  "profit",
  "margin",
  "totalContracted",
  "marketingExpenses",
]);

/** "Open as table" on a phone, kept on the device. */
const TABLE_PREF = "ceo.goals.sheetAsTable";

const headCell =
  "border-b border-r px-2 py-1.5 text-left align-bottom text-[11px] font-medium leading-tight text-muted-foreground";
const cellBase =
  "h-7 min-w-[5.25rem] whitespace-nowrap border-b border-r px-2 text-right text-xs tabular-nums";
const leftCol =
  "sticky z-10 whitespace-nowrap border-b border-r bg-card px-2 text-left text-xs";
// 44px to tap on a phone (2026-11-02): "no-touch" lifts the cockpit's 40px
// touch floor so this one can apply.
const toggle =
  "no-touch touch-manipulation rounded px-2.5 py-1 text-xs font-medium max-sm:min-h-11 max-sm:px-3";

function sayError(e: unknown): string {
  return String(e instanceof Error ? e.message : e).slice(0, 300);
}

/** Every month with a plan, this month and the next: what the picker lists. */
function pickableMonths(ctx: SheetContext): string[] {
  const now = ctx.today.slice(0, 7);
  const set = new Set<string>(
    (ctx.plans ?? []).map(p => String(p.periodFrom).slice(0, 7)),
  );
  set.add(now);
  set.add(shiftMonth(now, 1));
  return [...set].sort();
}

function monthName(m: string, form: "long" | "short"): string {
  return new Date(`${m}-01T00:00:00Z`).toLocaleString("en", {
    month: form,
    year: "numeric",
    timeZone: "UTC",
  });
}

export function GoalsSheet({
  onChanged,
}: {
  /** The plan changed: the board above reads it again. */
  onChanged?: () => void;
}) {
  const read = useAction(api.ceo.goals.sheet);
  const saveCells = useAction(api.ceo.goals.saveCells);
  const saveTargets = useAction(api.ceo.goals.saveTargets);
  const savePlan = useAction(api.ceo.goals.savePlan);
  const addMetric = useAction(api.ceo.goals.addMetric);
  const removeMetric = useAction(api.ceo.goals.removeMetric);

  const [month, setMonth] = useState<string | null>(null);
  const [ctx, setCtx] = useState<SheetContext | null>(null);
  const [view, setView] = useState<"sheet" | "lockin">("sheet");
  const [mode, setMode] = useState<"actual" | "plan">("actual");
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<SaveProblem | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(0);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [adding, setAdding] = useState(false);
  const narrow = useNarrow();
  const [asTable, setAsTable] = useState(() => readPref(TABLE_PREF) === "1");

  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** The context as shown, typed numbers included: what a save reads "before" from. */
  const ctxRef = useRef<SheetContext | null>(null);
  const monthRef = useRef<string | null>(null);
  monthRef.current = month;
  /** The edit in progress with its newest text; the input's events read it here, never from a stale render. */
  const editRef = useRef<Editing | null>(null);
  const finishedEdit = useRef(0);
  const editCount = useRef(0);
  /** Bumped by every typed number, so a read that began before one never draws over it. */
  const writes = useRef(0);
  const reads = useRef(0);
  const loads = useRef(0);
  const inflight = useRef(0);
  /** Each cell's newest save: only that one puts the old value back when it fails. */
  const newest = useRef(new Map<string, number>());
  /** The same for targets, by metric key: a typed target re-solves several. */
  const newestTargets = useRef(new Map<string, number>());
  const planMade = useRef<{ month: string; id: Promise<number> } | null>(null);

  /**
   * The months the picker offers, from the newest context read. Kept while
   * another month opens, or fails to, so he can always pick his way back
   * (2026-11-02): changing month clears the context, and the list was built
   * from it alone.
   */
  const [pickable, setPickable] = useState<string[]>([]);

  const put = useCallback((next: SheetContext | null) => {
    ctxRef.current = next;
    setCtx(next);
    if (!next) return;
    const list = pickableMonths(next);
    setPickable(was => (was.join() === list.join() ? was : list));
  }, []);

  /** Opening a month: the whole context, the call centre report with it. */
  const load = useCallback(
    async (m: string) => {
      const mine = ++reads.current;
      const myLoad = ++loads.current;
      setBusy(true);
      setError(null);
      try {
        const next = (await read({ month: m })) as SheetContext;
        if (mine === reads.current && monthRef.current === m) put(next);
      } catch (e) {
        if (mine === reads.current) setError(sayError(e));
      } finally {
        if (myLoad === loads.current) setBusy(false);
      }
    },
    [read, put],
  );

  /**
   * The read after a save (2026-11-02): no spinner, the call centre report it
   * already holds, and dropped if another number was typed meanwhile, as that
   * save brings its own read. Before, every save re-read everything and the
   * cell showed the old number until it came back.
   */
  const refresh = useCallback(
    async (m: string) => {
      if (monthRef.current !== m) return;
      const mine = ++reads.current;
      const since = writes.current;
      const held = ctxRef.current;
      try {
        const next = (await read({
          month: m,
          callDaily: held?.month === m ? held.callDaily : undefined,
        })) as SheetContext;
        if (
          mine === reads.current &&
          monthRef.current === m &&
          since === writes.current &&
          inflight.current === 0
        )
          put(next);
      } catch {
        // The save went through; the next read shows the server's numbers.
      }
    },
    [read, put],
  );

  // Opens on the month the Kuwait clock is in; the server's answer settles it.
  useEffect(() => {
    if (month) void load(month);
  }, [month, load]);
  useEffect(() => {
    if (month) return;
    setMonth(new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 7));
  }, [month]);

  const sheet = useMemo(() => (ctx ? buildSheet(ctx) : null), [ctx]);
  const targets = useMemo(() => (ctx ? targetsOf(ctx) : {}), [ctx]);
  const inputs = useMemo(() => inputsFromTargets(targets), [targets]);
  /** A column's target: a mirror reads the column it mirrors (Total new cash reads Cash collected's). */
  const targetOf = useCallback(
    (c: SheetColumn) => targets[targetKeyOf(c)]?.value ?? null,
    [targets],
  );

  const months = useMemo(
    () => [...new Set(month ? [...pickable, month] : pickable)].sort(),
    [pickable, month],
  );

  const sections = useMemo(() => {
    if (!sheet) return [];
    return SHEET_SECTIONS.map(s => ({
      ...s,
      cols: sheet.columns.filter(c => c.section === s.key),
    })).filter(s => s.cols.length);
  }, [sheet]);

  const flat = useMemo(() => sections.flatMap(s => s.cols), [sections]);

  /**
   * The whole-month rows: the month so far, its pace, and the plan's own
   * check. Read through the same range rule the Goals board reads
   * (goalsSheetData's rangeOf), so the two tie (2026-11-02).
   */
  const monthly = useMemo(() => {
    if (!sheet) return null;
    const range = monthSoFar(sheet);
    const actual: Record<string, number | null> = {};
    const pace: Record<string, number | null> = {};
    const planned: Record<string, number | null> = {};
    const notes: Record<string, { waits: string[]; leaves: string[] }> = {};
    const planRows = rowsOf(sheet, sheet.days, "plan");
    for (const c of sheet.columns) {
      actual[c.key] = rollUp(c, range.rows, range.worked, range.facts);
      notes[c.key] = notesFor(sheet, c, range, actual[c.key]);
      // Profit, margin and revenue pace from their parts, so overhead and
      // payroll are counted once and not stretched over the month.
      pace[c.key] = paceFor(
        c,
        range.rows,
        sheet.workedSoFar,
        sheet.workingDays,
        range.facts,
      );
      const target = targets[targetKeyOf(c)]?.value ?? null;
      if (PLAN_IS_TARGET.has(c.key)) {
        planned[c.key] = target;
        continue;
      }
      // A day nobody typed carries its even share, so the row adds up to the target.
      const part = cellKey(c);
      const rolled = rollUp(
        c,
        sheet.days.map((d, i) => {
          if (planRows[i][part] !== undefined) return planRows[i];
          const even = evenDailyPlan(c, target, d, sheet.workingDays);
          return { ...planRows[i], [part]: even };
        }),
        sheet.workingDays,
      );
      // A rate or a book number has no daily share: its plan is the target.
      planned[c.key] = rolled ?? target;
    }
    return { actual, pace, planned, notes, range };
  }, [sheet, targets]);

  const rollingRows = useMemo(() => {
    if (!sheet?.through) return [];
    const through = sheet.through;
    return [4, 7, 14, 30].map(n => {
      const range = rangeOf(sheet, addDays(through, -(n - 1)), through);
      return {
        label: `${n} days`,
        range,
        values: Object.fromEntries(
          sheet.columns.map(c => [
            c.key,
            rollUp(c, range.rows, range.worked, range.facts),
          ]),
        ) as Record<string, number | null>,
      };
    });
  }, [sheet]);

  const baseline = useMemo(() => {
    if (!sheet) return null;
    const range = monthBefore(sheet);
    return {
      range,
      values: Object.fromEntries(
        sheet.columns.map(c => [
          c.key,
          rollUp(c, range.rows, range.worked, range.facts),
        ]),
      ) as Record<string, number | null>,
    };
  }, [sheet]);

  /**
   * What a number over a run says beside its source (2026-11-02): revenue's
   * parts, why it is missing or what it leaves out, and the newest days'
   * caveat.
   */
  const explain = useCallback(
    (c: SheetColumn, range: SheetRange, value: number | null): string => {
      if (!sheet) return "";
      return [
        FROM_REVENUE.has(c.key) ? revenueWords(revenueFor(sheet, range)) : "",
        whyWords(notesFor(sheet, c, range, value), value),
        freshHint(
          c,
          range.days.length ? range.through : null,
          sheet.today,
          partsOf(c),
        ),
      ]
        .filter(Boolean)
        .join(" ");
    },
    [sheet],
  );

  /** A day's cell: typed wins over measured; the plan's days carry an even share until typed. */
  const valueOn = useCallback(
    (c: SheetColumn, day: string, kind: "actual" | "plan") => {
      if (!sheet) return { value: null, typed: false };
      const key = cellKey(c);
      if (kind === "plan") {
        const typed = sheet.plan[day]?.[key];
        if (typed !== undefined) return { value: typed, typed: true };
        return {
          value: evenDailyPlan(c, targetOf(c), day, sheet.workingDays),
          typed: false,
        };
      }
      const typed = sheet.typed[day]?.[key];
      if (typed !== undefined) return { value: typed, typed: true };
      return { value: rollUp(c, rowsOf(sheet, [day]), 1), typed: false };
    },
    [sheet, targetOf],
  );

  /** Whether this cell takes a typed number. */
  const canType = useCallback(
    (c: SheetColumn, row: RowKey) =>
      row.kind === "day"
        ? c.editable
        : row.kind === "target"
          ? !isWorkedOut(c, inputs)
          : false,
    [inputs],
  );

  const moveFrom = useCallback(
    (sel: Selected, dir: Move, typeable: boolean): Selected => {
      if (!sheet) return sel;
      if (dir === "up" || dir === "down") {
        if (sel.row.kind !== "day") return sel;
        const at = sheet.days.indexOf(sel.row.day) + (dir === "down" ? 1 : -1);
        const day = sheet.days[at];
        return day ? { col: sel.col, row: { kind: "day", day } } : sel;
      }
      const step = dir === "right" ? 1 : -1;
      let i = flat.findIndex(x => x.key === sel.col) + step;
      if (typeable) while (flat[i] && !canType(flat[i], sel.row)) i += step;
      return flat[i] ? { col: flat[i].key, row: sel.row } : sel;
    },
    [sheet, flat, canType],
  );

  const ensurePlan = useCallback(async (): Promise<number> => {
    const at = ctxRef.current;
    if (!at) throw new Error("The sheet is still opening");
    if (at.plan?.id) return Number(at.plan.id);
    // Two targets typed before the first save comes back make one plan, not two.
    if (planMade.current?.month === at.month) return planMade.current.id;
    const days = daysOfMonth(at.month);
    const id = (async () => {
      const made = (await savePlan({
        periodKind: "month",
        periodFrom: days[0],
        periodTo: days[days.length - 1],
        title: planTitle(days[0]),
        status: "draft",
      })) as { id: number };
      return made.id;
    })();
    planMade.current = { month: at.month, id };
    id.catch(() => {
      if (planMade.current?.id === id) planMade.current = null;
    });
    return id;
  }, [savePlan]);

  const settle = useCallback(
    (m: string) => {
      inflight.current -= 1;
      setSaving(n => n - 1);
      if (inflight.current === 0) void refresh(m);
    },
    [refresh],
  );

  /**
   * The one way a typed day is saved, from the grid, a paste or the phone
   * (2026-11-02): the number shows at once, the save runs behind it, and a
   * save that fails puts back what was there and says why, with Try again.
   */
  const commitCells = useCallback(
    (cells: CellWrite[], what: string) => {
      const at = ctxRef.current;
      if (!at || !cells.length) return;
      const before = cells.map(w => ({ ...w, value: cellNow(at, w) }));
      const token = ++writes.current;
      for (const w of cells) newest.current.set(cellId(w), token);
      put(patchCells(at, cells));
      setProblem(null);
      setError(null);
      inflight.current += 1;
      setSaving(n => n + 1);
      (saveCells({ cells }) as Promise<unknown>)
        .catch((e: unknown) => {
          // Only the cells this save is still the newest of: one typed again
          // since carries its own save, and putting this one's old value back
          // or retrying it would write over the newer number (2026-11-02).
          const still = (w: CellWrite) =>
            newest.current.get(cellId(w)) === token;
          const back = before.filter(still);
          const again = cells.filter(still);
          if (!again.length) return;
          const now = ctxRef.current;
          if (now && now.month === at.month) put(patchCells(now, back));
          const which =
            again.length < cells.length ? `${again.length} of ${what}` : what;
          const many = again.length > 1;
          setProblem({
            text: `${which} ${many ? "were" : "was"} not saved: ${reasonOf(e)}. The old ${many ? "values are" : "value is"} back.`,
            retry: () => commitCells(again, which),
          });
        })
        .finally(() => settle(at.month));
    },
    [put, saveCells, settle],
  );

  const commitTarget = useCallback(
    (c: SheetColumn, value: number | null) => {
      const at = ctxRef.current;
      if (!at) return;
      const now = targetsOf(at);
      const key = targetKeyOf(c);
      const inputKey = inputKeyOf(c);
      let rows: Record<string, unknown>[];
      if (inputKey) {
        // A goal for the cash keeps the chain working back from it. A number
        // typed lower down moves the goal unless the goal is what was typed.
        const next = { ...inputsFromTargets(now), [inputKey]: value };
        if (inputKey === "spend") next.goalCash = null;
        const keptNotes: Record<string, string | null> = {};
        for (const [k, t] of Object.entries(now)) keptNotes[k] = t.note;
        // A typed number's own assumption no longer holds.
        keptNotes[c.key] = "Typed on the sheet.";
        rows = targetRows(next, keptNotes, SAY);
      } else {
        const section = SHEET_SECTIONS.find(s => s.key === c.section);
        rows = [
          {
            groupKey: section?.group ?? "team",
            metricKey: key,
            label: boardLabelOf(c),
            unit: c.unit,
            direction: c.direction,
            target: value === null ? null : tidy(value, c.unit),
            note: now[key]?.note ?? null,
            sort: 2000,
          },
        ];
      }
      const before = at.targets;
      const token = ++writes.current;
      const keys = new Set([key, ...rows.map(r => String(r.metricKey))]);
      for (const k of keys) newestTargets.current.set(k, token);
      put(patchTargets(at, rows));
      setProblem(null);
      setError(null);
      inflight.current += 1;
      setSaving(n => n + 1);
      (async () => {
        const planId = await ensurePlan();
        await saveTargets({ planId, targets: rows });
        onChanged?.();
      })()
        .catch((e: unknown) => {
          // This target typed again since carries its own save: saying the
          // old one is back, or retrying it, would undo the newer number
          // (2026-11-02). Only the targets still this save's go back.
          if (newestTargets.current.get(key) !== token) return;
          const back = new Set(
            [...keys].filter(k => newestTargets.current.get(k) === token),
          );
          const was = new Map(before.map(t => [String(t.metric_key), t]));
          const held = ctxRef.current;
          if (held && held.month === at.month)
            put({
              ...held,
              targets: held.targets.flatMap(t => {
                const k = String(t.metric_key);
                if (!back.has(k)) return [t];
                const old = was.get(k);
                return old ? [old] : [];
              }),
            });
          setProblem({
            text: `The target for ${c.label} was not saved: ${reasonOf(e)}. The old target is back.`,
            retry: () => commitTarget(c, value),
          });
        })
        .finally(() => settle(at.month));
    },
    [put, ensurePlan, saveTargets, onChanged, settle],
  );

  const beginEdit = useCallback(
    (sel: Selected, text: string, caret: Editing["caret"]) => {
      const e: Editing = { id: ++editCount.current, sel, text, caret };
      editRef.current = e;
      setSelected(sel);
      setEditing(e);
      setError(null);
    },
    [],
  );

  const editId = editing?.id;
  useLayoutEffect(() => {
    // Once per edit, as its input appears (2026-11-02). Selecting on every
    // keystroke made each digit replace the one before: typing 150 saved 0.
    const el = inputRef.current;
    const e = editRef.current;
    if (editId === undefined || !el || !e) return;
    el.focus({ preventScroll: true });
    if (e.caret === "all") el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [editId]);

  const textOf = useCallback(
    (c: SheetColumn, row: RowKey): string =>
      row.kind === "day"
        ? editText(valueOn(c, row.day, mode).value, c)
        : row.kind === "target"
          ? editText(targetOf(c), c)
          : "",
    [valueOn, mode, targetOf],
  );

  /** Ends the edit once: saves it unless Escape, then moves where the key says. */
  const finish = useCallback(
    (how: Finish) => {
      const e = editRef.current;
      if (!e || finishedEdit.current === e.id) return;
      finishedEdit.current = e.id;
      editRef.current = null;
      setEditing(null);
      // Back on the grid so arrows and typing carry on; a blur went where the
      // person chose, so it keeps its focus.
      if (how !== "blur") gridRef.current?.focus({ preventScroll: true });
      if (how === "cancel") return;
      const c = flat.find(x => x.key === e.sel.col);
      if (!c) return;
      const parsed = parseCell(e.text, c);
      if (parsed === "bad") {
        setError(
          `"${e.text}" is not a number. Type a number, or press Delete to clear the cell.`,
        );
        return;
      }
      const row = e.sel.row;
      if (row.kind === "day") {
        const had = valueOn(c, row.day, mode);
        const same =
          (parsed === null && !had.typed) ||
          (parsed !== null && had.value === parsed);
        if (!same)
          commitCells(
            [{ day: row.day, key: cellKey(c), kind: mode, value: parsed }],
            `${c.label} on ${shortDate(row.day)}`,
          );
      } else if (row.kind === "target" && parsed !== targetOf(c))
        commitTarget(c, parsed);
      if (how === "stay" || how === "blur") return;
      const dir: Move =
        how === "tab" ? "right" : how === "backtab" ? "left" : how;
      setSelected(moveFrom(e.sel, dir, how === "tab" || how === "backtab"));
    },
    [flat, valueOn, mode, targetOf, commitCells, commitTarget, moveFrom],
  );

  const select = useCallback(
    (sel: Selected) => {
      const open = editRef.current;
      // A click inside the cell being typed in keeps it open, as in Sheets
      // (2026-11-02): it used to save and close the box under the pointer.
      if (open && sameCell(open.sel, sel)) return;
      // A click on another cell first ends the edit in hand, saving it.
      if (open) finish("blur");
      setSelected(sel);
      gridRef.current?.focus({ preventScroll: true });
    },
    [finish],
  );

  /** A double click opens a cell with all of it selected; in the open cell it is the box's own. */
  const openByDoubleClick = useCallback(
    (c: SheetColumn, sel: Selected) => {
      const open = editRef.current;
      if (open && sameCell(open.sel, sel)) return;
      if (open) finish("blur");
      if (canType(c, sel.row)) beginEdit(sel, textOf(c, sel.row), "all");
    },
    [finish, canType, beginEdit, textOf],
  );

  const onEditKey = useCallback(
    (ev: KeyboardEvent<HTMLInputElement>) => {
      ev.stopPropagation();
      const e = editRef.current;
      if (!e) return;
      let how: Finish | null = null;
      if (ev.key === "Enter")
        how = e.sel.row.kind === "day" ? (ev.shiftKey ? "up" : "down") : "stay";
      else if (ev.key === "Tab") how = ev.shiftKey ? "backtab" : "tab";
      else if (ev.key === "Escape") how = "cancel";
      // Typed straight over a cell, the arrows save it and move on, as in Sheets.
      else if (e.caret === "end" && ARROWS[ev.key]) how = ARROWS[ev.key];
      if (!how) return;
      ev.preventDefault();
      finish(how);
    },
    [finish],
  );

  const onEditChange = useCallback((text: string) => {
    const e = editRef.current;
    if (!e) return;
    editRef.current = { ...e, text };
    setEditing(x => (x && x.id === e.id ? { ...x, text } : x));
  }, []);

  // Paste from Google Sheets: tabs across, new lines down; one value fills one cell.
  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      if (selected?.row.kind !== "day" || !sheet) return;
      // While a cell is open the paste goes into it.
      if (editRef.current) return;
      const text = e.clipboardData.getData("text/plain").replace(/\r/g, "");
      if (!text.trim()) return;
      e.preventDefault();
      const startCol = flat.findIndex(x => x.key === selected.col);
      const startDay = sheet.days.indexOf(selected.row.day);
      const cells: CellWrite[] = [];
      for (const [r, line] of text.replace(/\n$/, "").split("\n").entries()) {
        const day = sheet.days[startDay + r];
        if (!day) break;
        for (const [k, raw] of line.split("\t").entries()) {
          const c = flat[startCol + k];
          if (!c?.editable) continue;
          const v = parseCell(raw, c);
          if (v === "bad") continue;
          cells.push({ day, key: cellKey(c), kind: mode, value: v });
        }
      }
      commitCells(
        cells,
        cells.length === 1 ? "The pasted cell" : `${cells.length} pasted cells`,
      );
    },
    [selected, sheet, flat, mode, commitCells],
  );

  const onGridKey = useCallback(
    (e: KeyboardEvent) => {
      if (!selected || editRef.current || !sheet) return;
      const c = flat.find(x => x.key === selected.col);
      if (!c) return;
      const arrow = ARROWS[e.key];
      if (arrow) setSelected(moveFrom(selected, arrow, false));
      else if (e.key === "Tab") {
        const next = moveFrom(selected, e.shiftKey ? "left" : "right", false);
        // At the edge of the sheet Tab leaves the grid, so the page stays reachable.
        if (next === selected) return;
        setSelected(next);
      } else if (e.key === "Enter" || e.key === "F2") {
        if (!canType(c, selected.row)) return;
        beginEdit(selected, textOf(c, selected.row), "all");
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const row = selected.row;
        if (row.kind !== "day" || !c.editable) return;
        // Only a typed number clears; what was measured stays.
        if (!valueOn(c, row.day, mode).typed) return;
        commitCells(
          [{ day: row.day, key: cellKey(c), kind: mode, value: null }],
          `Clearing ${c.label} on ${shortDate(row.day)}`,
        );
      } else if (
        STARTS_A_NUMBER.test(e.key) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        if (!canType(c, selected.row)) return;
        beginEdit(selected, e.key, "end");
      } else return;
      e.preventDefault();
    },
    [
      selected,
      sheet,
      flat,
      moveFrom,
      canType,
      beginEdit,
      textOf,
      valueOn,
      mode,
      commitCells,
    ],
  );

  const bar = useMemo(() => {
    if (!selected || !sheet || !monthly || !baseline) return null;
    const c = flat.find(x => x.key === selected.col);
    if (!c) return null;
    const section = SHEET_SECTIONS.find(s => s.key === c.section);
    const row = selected.row;
    if (row.kind === "target") {
      const t = targets[targetKeyOf(c)];
      const worked = isWorkedOut(c, inputs);
      const mirrors = c.targetKey
        ? flat.find(x => x.key === c.targetKey)
        : undefined;
      return {
        address: `Target · ${c.label}`,
        value: t ? show(t.value, c) : NA,
        text: mirrors
          ? `${mirrors.label}'s target, the same number.${t?.note ? ` ${t.note}` : ""}`
          : (t?.note ??
            (worked
              ? "Worked out from the plan's inputs. Change an input and this follows."
              : "No target yet. Type one.")),
        hint: mirrors
          ? `Type it on ${mirrors.label}.`
          : worked
            ? "Worked out: change what it depends on."
            : "Type to change it. The rest of the plan follows.",
        section: section?.label,
      };
    }
    if (row.kind === "day") {
      const day = row.day;
      const { value, typed } = valueOn(c, day, mode);
      const measured = rollUp(c, rowsOf({ ...sheet, typed: {} }, [day]), 1);
      const typedOver =
        typed && mode === "actual" && measured !== null
          ? ` Typed over the measured ${show(measured, c)}.`
          : "";
      const why =
        mode === "actual" && day <= sheet.today
          ? ` ${explain(c, rangeOf(sheet, day, day), value)}`
          : "";
      return {
        address: `${shortDate(day)} · ${c.label}`,
        value: value === null ? "Empty" : show(value, c),
        text:
          mode === "plan"
            ? typed
              ? "This day's plan, typed."
              : "An even share of the month's target over its working days. Type over it to plan this day differently."
            : `${c.source}${typedOver}${why}`,
        hint: c.editable
          ? "Type to fill it, Enter to change it, Delete to clear it. Paste a block from a spreadsheet."
          : fixedHintOf(c),
        section: section?.label,
      };
    }
    // The rows over a run of days: each says what it waits on or leaves out.
    const label = row.label;
    const run =
      label === "MTD" ||
      label === "This month actual" ||
      label === "On pace for"
        ? { range: monthly.range, value: monthly.actual[c.key] }
        : label === "Last month"
          ? { range: baseline.range, value: baseline.values[c.key] }
          : (() => {
              const r = rollingRows.find(x => x.label === label);
              return r ? { range: r.range, value: r.values[c.key] } : null;
            })();
    const why = run ? ` ${explain(c, run.range, run.value ?? null)}` : "";
    const planIsTarget = label === "Plan added up" && PLAN_IS_TARGET.has(c.key);
    return {
      address: `${label} · ${c.label}`,
      value: "",
      text: planIsTarget
        ? "The plan's target: its parts are whole-month numbers, so no day carries a share of it."
        : label === "Plan added up"
          ? c.source
          : `${c.source}${why}`,
      hint: planIsTarget
        ? "Change it on the Target row below."
        : isLevel(c)
          ? "Judged whole: a rate or a cost is not paced through the month."
          : "Added up over these days.",
      section: section?.label,
    };
  }, [
    selected,
    sheet,
    monthly,
    baseline,
    rollingRows,
    flat,
    targets,
    inputs,
    valueOn,
    mode,
    explain,
  ]);

  /**
   * The sheet's notes, once at the top, quiet (2026-11-02): the bank, the
   * call centre report, and each server read that is not live or failed
   * (readsMissing). An older server sends no readsMissing: one sentence then
   * says the empty numbers carry their reason.
   */
  const notes = useMemo(() => {
    const out: string[] = [];
    if (ctx?.bankThrough)
      out.push(
        `Bank lines stop at ${shortDate(ctx.bankThrough)}: upload a statement on Money to fill them in.`,
      );
    if (ctx && ctx.callDaily === null)
      out.push(
        "The call centre report did not answer, so its columns read empty.",
      );
    if (sheet)
      out.push(
        ...(sheet.readsMissing ?? [
          "Some numbers wait on the sheet's server update of 2 Nov 2026: until it is live they read empty, with the reason beside each.",
        ]),
      );
    return [...new Set(out)];
  }, [ctx, sheet]);

  /** The reasons beside a phone row: the day's and the month's (2026-11-02). */
  const explainPhone = useCallback(
    (c: SheetColumn, day: string | null) => {
      if (!sheet || !monthly) return { day: "", month: "" };
      const dayValue = day ? rollUp(c, rowsOf(sheet, [day]), 1) : null;
      return {
        day: day ? explain(c, rangeOf(sheet, day, day), dayValue) : "",
        month: explain(c, monthly.range, monthly.actual[c.key] ?? null),
      };
    },
    [sheet, monthly, explain],
  );

  if (!month) return null;

  const phone = narrow && !asTable;
  const left1 = "left-0";
  const stickyHead = "sticky top-0 z-20 gs-band";

  /**
   * A press on the open cell's edge, around its box, would move focus to the
   * grid and the box's blur would save and close it: the focus stays in the
   * box instead, as in Sheets (2026-11-02).
   */
  const keepBoxFocus = (e: MouseEvent) => {
    if (e.target !== inputRef.current) e.preventDefault();
  };

  const editor = (label: string) => (
    <input
      ref={inputRef}
      value={editing?.text ?? ""}
      aria-label={label}
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      onChange={e => onEditChange(e.target.value)}
      onBlur={() => finish("blur")}
      onKeyDown={onEditKey}
      // A click or double click in the box places the caret or picks a word;
      // reaching the cell under it, it closed the edit or opened it afresh.
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      className="h-6 w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
    />
  );

  return (
    <SectionCard
      title="Monthly sheet"
      description={
        view === "lockin"
          ? "The month's numbers with their source and what they leave out, and what to do about the clients behind them."
          : phone
            ? "Each day against the plan. Tap a number to type it."
            : "Days down the side, every metric across. What the cockpit measures fills itself in; type over it or fill in the rest."
      }
      order={1}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {busy || saving ? (
            <Loader2
              className="size-4 animate-spin text-muted-foreground"
              aria-label={saving ? "Saving" : "Reading the sheet"}
            />
          ) : null}
          <AnimatedSelect
            aria-label="Which month"
            // 44px to tap on a phone (2026-11-02); the CEO select rule sets
            // a fixed height, so these override it below 640px only.
            className="ceo-select-sm max-sm:h-11! max-sm:min-h-11!"
            value={month}
            onChange={e => {
              // The old month's numbers never sit under the new month's name.
              put(null);
              setMonth(e.target.value);
              setSelected(null);
              editRef.current = null;
              setEditing(null);
              setProblem(null);
            }}
          >
            {months.map(m => (
              <option key={m} value={m}>
                {monthName(m, "long")}
              </option>
            ))}
          </AnimatedSelect>
          <fieldset className="inline-flex rounded-md border p-0.5">
            <legend className="sr-only">Which view</legend>
            {(
              [
                ["sheet", "Sheet"],
                ["lockin", "Lock in"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={view === k}
                onClick={() => setView(k)}
                className={cn(
                  toggle,
                  view === k
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </fieldset>
        </div>
      }
    >
      {error ? (
        <p
          role="alert"
          className="mb-3 break-words rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}
      {problem ? (
        <div className="mb-3">
          <SaveProblemLine problem={problem} onClose={() => setProblem(null)} />
        </div>
      ) : null}

      {view === "sheet" && notes.length ? (
        <SheetNotes notes={notes} open={!narrow} />
      ) : null}

      {view === "lockin" && ctx && sheet && monthly ? (
        <LockIn
          ctx={ctx}
          sheet={sheet}
          actual={monthly.actual}
          onChanged={() => void load(month)}
        />
      ) : null}

      {view === "sheet" && ctx && sheet && monthly && phone ? (
        <GoalsSheetPhone
          key={sheet.month}
          sheet={sheet}
          today={ctx.today}
          sections={sections}
          targets={targets}
          actual={monthly.actual}
          pace={monthly.pace}
          valueOn={(c, day) => valueOn(c, day, "actual")}
          onSave={(c, day, value) =>
            commitCells(
              [{ day, key: cellKey(c), kind: "actual", value }],
              `${c.label} on ${shortDate(day)}`,
            )
          }
          onBadNumber={text =>
            setError(
              `"${text}" is not a number. Type a number, or clear it to go back to what was measured.`,
            )
          }
          explain={explainPhone}
          onOpenTable={() => {
            setAsTable(true);
            writePref(TABLE_PREF, "1");
          }}
        />
      ) : null}

      {view === "sheet" && sheet && monthly && baseline && !phone ? (
        <div className="grid gap-3">
          {narrow ? (
            <Button
              variant="outline"
              size="sm"
              className="no-touch touch-manipulation min-h-[44px] justify-self-start pointer-coarse:min-h-11"
              onClick={() => {
                setAsTable(false);
                writePref(TABLE_PREF, null);
              }}
            >
              <Smartphone aria-hidden />
              Back to the daily view
            </Button>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <fieldset className="inline-flex rounded-md border p-0.5">
              <legend className="sr-only">What the days hold</legend>
              {(
                [
                  ["actual", "Actuals"],
                  ["plan", "Daily plan"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={mode === k}
                  onClick={() => {
                    finish("stay");
                    setMode(k);
                  }}
                  className={cn(
                    toggle,
                    mode === k
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                aria-pressed={adding}
                onClick={() => setAdding(v => !v)}
              >
                <Plus aria-hidden />
                Add a metric
              </Button>
            </div>
          </div>

          {adding ? (
            <AddMetric
              onAdd={async m => {
                setError(null);
                try {
                  await addMetric(m);
                  setAdding(false);
                  await load(month);
                } catch (e) {
                  setError(sayError(e));
                }
              }}
              onClose={() => setAdding(false)}
            />
          ) : null}

          {/* The formula bar: the sheet's one signature. */}
          <div className="grid min-h-16 grid-cols-[minmax(0,14rem)_auto_minmax(0,1fr)] items-start gap-x-4 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 max-md:grid-cols-1">
            {bar ? (
              <>
                <div className="min-w-0">
                  <p className={KICKER}>{bar.section}</p>
                  <p className="truncate text-sm font-medium">{bar.address}</p>
                </div>
                <p className="text-lg font-semibold tabular-nums">
                  {bar.value}
                </p>
                <div className="min-w-0 break-words text-xs">
                  <p>{bar.text}</p>
                  <p className="mt-0.5 text-muted-foreground">{bar.hint}</p>
                </div>
              </>
            ) : (
              <p className="col-span-full self-center text-sm text-muted-foreground">
                Select a cell to see where its number comes from and what it
                leaves out.
              </p>
            )}
          </div>

          <div
            ref={gridRef}
            role="grid"
            tabIndex={0}
            aria-label={`Sheet for ${month}`}
            onKeyDown={onGridKey}
            onPaste={onPaste}
            className="max-h-[75vh] overflow-auto rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <table className="border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th
                    colSpan={1}
                    className={cn(
                      headCell,
                      stickyHead,
                      left1,
                      "z-30 min-w-[7.5rem]",
                    )}
                  >
                    {monthName(month, "short")}
                  </th>
                  {sections.map(s => (
                    <th
                      key={s.key}
                      colSpan={s.cols.length}
                      className={cn(
                        headCell,
                        stickyHead,
                        "text-xs font-semibold text-foreground",
                      )}
                    >
                      <span className="sticky left-[8rem]">{s.label}</span>
                    </th>
                  ))}
                </tr>
                <tr>
                  <th
                    className={cn(
                      headCell,
                      "sticky left-0 top-[1.9rem] z-30 bg-card",
                    )}
                  >
                    Day
                  </th>
                  {flat.map(c => (
                    <th
                      key={c.key}
                      title={c.source}
                      className={cn(
                        headCell,
                        "sticky top-[1.9rem] z-20 max-w-[6.5rem] whitespace-normal bg-card",
                      )}
                    >
                      <span className="inline-flex items-start gap-1">
                        {c.label}
                        {c.custom ? (
                          <button
                            type="button"
                            aria-label={`Remove ${c.label}`}
                            className="text-muted-foreground hover:text-foreground"
                            onClick={async () => {
                              setError(null);
                              try {
                                await removeMetric({ key: c.key });
                                await load(month);
                              } catch (e) {
                                setError(sayError(e));
                              }
                            }}
                          >
                            <Trash2 className="size-3" aria-hidden />
                          </button>
                        ) : null}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rollingRows.map(r => (
                  <RollRow
                    key={r.label}
                    label={r.label}
                    values={r.values}
                    cols={flat}
                    selected={selected}
                    onSelect={select}
                  />
                ))}
                <RollRow
                  label="MTD"
                  values={monthly.actual}
                  cols={flat}
                  selected={selected}
                  onSelect={select}
                />
                <RollRow
                  label="Last month"
                  values={baseline.values}
                  cols={flat}
                  selected={selected}
                  onSelect={select}
                  band
                />

                {sheet.days.map(day => {
                  const off = !isWorkingDay(day);
                  const isToday = ctx?.today === day;
                  return (
                    <tr key={day}>
                      <th
                        scope="row"
                        className={cn(
                          leftCol,
                          left1,
                          "font-normal",
                          off && "text-muted-foreground",
                          isToday && "border-l-2 border-l-primary font-medium",
                        )}
                      >
                        {`${new Date(`${day}T00:00:00Z`).toLocaleString("en", { weekday: "short", timeZone: "UTC" })} ${Number(day.slice(8))}`}
                      </th>
                      {flat.map(c => {
                        const { value, typed } = valueOn(c, day, mode);
                        const sel: Selected = {
                          col: c.key,
                          row: { kind: "day", day },
                        };
                        const isSel =
                          selected?.col === c.key &&
                          selected.row.kind === "day" &&
                          selected.row.day === day;
                        const isEditing =
                          isSel && editing?.sel.row.kind === "day";
                        return (
                          <td
                            key={c.key}
                            data-col={c.key}
                            data-day={day}
                            data-selected={isSel || undefined}
                            onMouseDown={isEditing ? keepBoxFocus : undefined}
                            onClick={() => select(sel)}
                            onDoubleClick={() => openByDoubleClick(c, sel)}
                            className={cn(
                              cellBase,
                              off && "bg-muted/30",
                              !c.editable && "text-muted-foreground",
                              mode === "plan" &&
                                !typed &&
                                "text-muted-foreground",
                              typed && "font-medium",
                              typed &&
                                "bg-[linear-gradient(225deg,var(--mahara-teal)_0,var(--mahara-teal)_5px,transparent_5px)]",
                              isSel &&
                                "outline outline-2 -outline-offset-2 outline-primary",
                            )}
                          >
                            {isEditing
                              ? editor(`${c.label} on ${day}`)
                              : show(value, c)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                <RollRow
                  label={
                    mode === "plan" ? "Plan added up" : "This month actual"
                  }
                  values={mode === "plan" ? monthly.planned : monthly.actual}
                  cols={flat}
                  selected={selected}
                  onSelect={select}
                  strong
                  bottom={84}
                />
                <RollRow
                  label="On pace for"
                  values={monthly.pace}
                  cols={flat}
                  selected={selected}
                  onSelect={select}
                  bottom={56}
                />
                <tr>
                  <th
                    scope="row"
                    style={{ bottom: 28 }}
                    className={cn(
                      leftCol,
                      left1,
                      "z-[15] gs-plan font-semibold",
                    )}
                  >
                    Target
                  </th>
                  {flat.map(c => {
                    const sel: Selected = {
                      col: c.key,
                      row: { kind: "target" },
                    };
                    const isSel =
                      selected?.col === c.key && selected.row.kind === "target";
                    const worked = isWorkedOut(c, inputs);
                    const isEditing =
                      isSel && editing?.sel.row.kind === "target";
                    return (
                      <td
                        key={c.key}
                        data-col={c.key}
                        data-row="target"
                        data-selected={isSel || undefined}
                        style={{ bottom: 28 }}
                        onMouseDown={isEditing ? keepBoxFocus : undefined}
                        onClick={() => select(sel)}
                        onDoubleClick={() => openByDoubleClick(c, sel)}
                        className={cn(
                          cellBase,
                          "sticky z-[5] gs-plan",
                          worked ? "text-muted-foreground" : "font-medium",
                          isSel &&
                            "outline outline-2 -outline-offset-2 outline-primary",
                        )}
                      >
                        {isEditing
                          ? editor(`Target for ${c.label}`)
                          : show(targetOf(c), c)}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <th
                    scope="row"
                    style={{ bottom: 0 }}
                    className={cn(leftCol, left1, "z-[15] font-medium")}
                  >
                    Colour
                  </th>
                  {flat.map(c => {
                    const col = colourFor(c, monthly.pace[c.key], targetOf(c));
                    return (
                      <td
                        key={c.key}
                        data-col={c.key}
                        data-row="colour"
                        style={{ bottom: 0 }}
                        className={cn(
                          cellBase,
                          "sticky z-[5] bg-card text-left",
                        )}
                      >
                        {col ? (
                          <span className="inline-flex items-center gap-1.5">
                            <StatusDot
                              tone={COLOUR_TONE[col]}
                              label={COLOUR_WORD[col]}
                            />
                            {COLOUR_WORD[col]}
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            {`A teal corner is a typed number. An empty cell is missing, never zero. Fridays are shaded: pace counts ${sheet.workingDays} working days, Saturday to Thursday.`}
          </p>
        </div>
      ) : null}

      {!sheet && !error ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Opening the sheet
        </p>
      ) : null}
    </SectionCard>
  );
}

/**
 * The sheet's notes in one quiet place at the top (2026-11-02): open on a
 * desktop, one tap away on a phone so the day's numbers come first.
 */
function SheetNotes({ notes, open }: { notes: string[]; open: boolean }) {
  return (
    <details
      open={open}
      className="mb-3 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
    >
      <summary className="no-touch flex min-h-11 cursor-pointer items-center font-medium text-foreground/80 sm:min-h-0">
        {`About these numbers (${notes.length})`}
      </summary>
      <ul className="mt-1 grid list-disc gap-1 pl-4">
        {notes.map(n => (
          <li key={n} className="break-words">
            {n}
          </li>
        ))}
      </ul>
    </details>
  );
}

function RollRow({
  label,
  values,
  cols,
  selected,
  onSelect,
  strong,
  band,
  bottom,
}: {
  label: string;
  values: Record<string, number | null>;
  cols: SheetColumn[];
  selected: Selected | null;
  onSelect: (s: Selected) => void;
  strong?: boolean;
  band?: boolean;
  /** Pinned this far from the bottom of the grid, so the plan stays in view. */
  bottom?: number;
}) {
  const pin = bottom === undefined ? undefined : { bottom };
  return (
    <tr>
      <th
        scope="row"
        style={pin}
        className={cn(
          leftCol,
          "left-0",
          pin && "z-[15]",
          strong ? "font-semibold" : "font-medium",
          band && "gs-band",
        )}
      >
        {label}
      </th>
      {cols.map(c => {
        const v = values[c.key];
        const isSel =
          selected?.col === c.key &&
          selected.row.kind === "roll" &&
          selected.row.label === label;
        return (
          <td
            key={c.key}
            data-col={c.key}
            data-row={label}
            style={pin}
            onClick={() =>
              onSelect({ col: c.key, row: { kind: "roll", label } })
            }
            className={cn(
              cellBase,
              pin && "sticky z-[5] bg-card",
              strong ? "font-semibold" : "text-muted-foreground",
              band && "gs-band",
              v === null || v === undefined ? "text-muted-foreground/60" : "",
              isSel && "outline outline-2 -outline-offset-2 outline-primary",
            )}
          >
            {v === null || v === undefined ? NA : show(v, c)}
          </td>
        );
      })}
    </tr>
  );
}

const field =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function AddMetric({
  onAdd,
  onClose,
}: {
  onAdd: (m: Record<string, string>) => Promise<void>;
  onClose: () => void;
}) {
  const [m, setM] = useState({
    label: "",
    section: "custom",
    unit: "count",
    direction: "up",
    rollup: "sum",
    note: "",
  });
  const put = (k: keyof typeof m, v: string) => setM(x => ({ ...x, [k]: v }));
  return (
    <form
      className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]"
      onSubmit={e => {
        e.preventDefault();
        // Saved under a section key the table's CHECK allows today, and read
        // back into the same section (2026-11-02).
        if (m.label.trim())
          void onAdd({
            ...m,
            section: storedSection(m.section as SectionKey),
          });
      }}
    >
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Name
        <input
          className={field}
          value={m.label}
          maxLength={60}
          placeholder="Case studies filmed"
          onChange={e => put("label", e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Section
        <select
          className={field}
          value={m.section}
          onChange={e => put("section", e.target.value)}
        >
          {ADDABLE_SECTIONS.map(s => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Kind of number
        <select
          className={field}
          value={m.unit}
          onChange={e => put("unit", e.target.value)}
        >
          <option value="count">A count</option>
          <option value="usd">Dollars</option>
          <option value="rate">A percent</option>
          <option value="x">A multiple</option>
          <option value="pts">A score</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Over the month
        <select
          className={field}
          value={m.rollup}
          onChange={e => put("rollup", e.target.value)}
        >
          <option value="sum">Add the days up</option>
          <option value="avg">Average the days</option>
          <option value="last">Take the newest</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Better when
        <select
          className={field}
          value={m.direction}
          onChange={e => put("direction", e.target.value)}
        >
          <option value="up">Higher</option>
          <option value="down">Lower</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground sm:col-span-full">
        Ad spend / lead gen and Intro calls take new metrics once the sheet's
        table allows those sections; until then add it under Demo calls.
      </p>
      <div className="flex gap-2 sm:col-span-full">
        <Button type="submit" size="sm" disabled={!m.label.trim()}>
          Add metric
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </form>
  );
}
