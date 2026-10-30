import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  count,
  decimal,
  money,
  NA,
  pct,
  pct1,
  shortDate,
} from "@/components/ceo/format";
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
  buildSheet,
  cellKey,
  inputKeyOf,
  inputsFromTargets,
  isWorkedOut,
  rowsOf,
  targetRows,
  targetsOf,
} from "./goalsSheetData";
import {
  addDays,
  type Colour,
  colourFor,
  evenDailyPlan,
  isLevel,
  isWorkingDay,
  onPaceFor,
  rollUp,
  SHEET_SECTIONS,
  type SheetColumn,
  shiftMonth,
  withComputed,
} from "./goalsSheetModel";

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
 */

const SAY = { money, count, pct };

function show(v: number | null | undefined, c: SheetColumn): string {
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
function parseCell(text: string, c: SheetColumn): number | null | "bad" {
  const t = text.replace(/[,$%×x\s]/gi, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "bad";
  return c.unit === "rate" ? n / 100 : n;
}

function editText(v: number | null | undefined, c: SheetColumn): string {
  if (v === null || v === undefined) return "";
  if (c.unit === "rate") return String(Math.round(v * 1000) / 10);
  return String(Math.round(v * 100) / 100);
}

type RowKey =
  | { kind: "day"; day: string }
  | { kind: "target" }
  | { kind: "roll"; label: string };

type Selected = { col: string; row: RowKey };

const COLOUR_TONE: Record<Colour, "good" | "warning" | "critical"> = {
  green: "good",
  yellow: "warning",
  red: "critical",
};
const COLOUR_WORD: Record<Colour, string> = {
  green: "Green",
  yellow: "Yellow",
  red: "Red",
};

const headCell =
  "border-b border-r px-2 py-1.5 text-left align-bottom text-[11px] font-medium leading-tight text-muted-foreground";
const cellBase =
  "h-7 min-w-[5.25rem] whitespace-nowrap border-b border-r px-2 text-right text-xs tabular-nums";
const leftCol =
  "sticky z-10 whitespace-nowrap border-b border-r bg-card px-2 text-left text-xs";

export function GoalsSheet({
  onChanged,
}: {
  /** The plan or a cell changed: the board above reads it again. */
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
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [editing, setEditing] = useState<{
    sel: Selected;
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (m: string) => {
      setBusy(true);
      setError(null);
      try {
        setCtx((await read({ month: m })) as SheetContext);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e).slice(0, 300));
      } finally {
        setBusy(false);
      }
    },
    [read],
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

  const months = useMemo(() => {
    const now = ctx?.today.slice(0, 7);
    const set = new Set<string>(
      (ctx?.plans ?? []).map(p => String(p.periodFrom).slice(0, 7)),
    );
    if (now) {
      set.add(now);
      set.add(shiftMonth(now, 1));
    }
    if (month) set.add(month);
    return [...set].sort();
  }, [ctx, month]);

  const sections = useMemo(() => {
    if (!sheet) return [];
    return SHEET_SECTIONS.map(s => ({
      ...s,
      cols: sheet.columns.filter(c => c.section === s.key),
    })).filter(s => s.cols.length);
  }, [sheet]);

  const flat = useMemo(() => sections.flatMap(s => s.cols), [sections]);

  /** The whole-month row and the month before's, for the plan's own check. */
  const monthly = useMemo(() => {
    if (!sheet) return null;
    const upTo = sheet.through
      ? sheet.days.filter(d => d <= (sheet.through as string))
      : [];
    const rows = rowsOf(sheet, upTo);
    const facts = withComputed(sheet.facts);
    const actual: Record<string, number | null> = {};
    const pace: Record<string, number | null> = {};
    const planned: Record<string, number | null> = {};
    const planRows = rowsOf(sheet, sheet.days, "plan");
    for (const c of sheet.columns) {
      const a = rollUp(c, rows, sheet.workedSoFar, facts);
      actual[c.key] = a;
      pace[c.key] = onPaceFor(c, a, sheet.workedSoFar, sheet.workingDays);
      // A day nobody typed carries its even share, so the row adds up to the target.
      planned[c.key] = rollUp(
        c,
        sheet.days.map((d, i) => {
          const part = cellKey(c);
          if (planRows[i][part] !== undefined) return planRows[i];
          const even = evenDailyPlan(
            c,
            targets[c.key]?.value ?? null,
            d,
            sheet.workingDays,
          );
          return { ...planRows[i], [part]: even };
        }),
        sheet.workingDays,
      );
    }
    return { actual, pace, planned };
  }, [sheet, targets]);

  const rollingRows = useMemo(() => {
    if (!sheet?.through) return [];
    const through = sheet.through;
    const windowDays = (n: number) => {
      const out: string[] = [];
      for (let i = n - 1; i >= 0; i--) out.push(addDays(through, -i));
      return out;
    };
    return [4, 7, 14, 30].map(n => {
      const days = windowDays(n);
      const worked = days.filter(isWorkingDay).length;
      const rows = rowsOf(sheet, days);
      return {
        label: `${n} days`,
        values: Object.fromEntries(
          sheet.columns.map(c => [c.key, rollUp(c, rows, worked)]),
        ) as Record<string, number | null>,
      };
    });
  }, [sheet]);

  const baseline = useMemo(() => {
    if (!sheet) return {};
    const prev = shiftMonth(sheet.month, -1);
    const days = Object.keys({ ...sheet.measured, ...sheet.typed })
      .filter(d => d.startsWith(prev))
      .sort();
    const rows = rowsOf(sheet, days);
    const worked = days.filter(isWorkingDay).length;
    const facts = withComputed(sheet.prevFacts);
    return Object.fromEntries(
      sheet.columns.map(c => [c.key, rollUp(c, rows, worked, facts)]),
    ) as Record<string, number | null>;
  }, [sheet]);

  const dayValue = useCallback(
    (c: SheetColumn, day: string) => {
      if (!sheet) return { value: null, typed: false };
      const key = cellKey(c);
      if (mode === "plan") {
        const typed = sheet.plan[day]?.[key];
        if (typed !== undefined) return { value: typed, typed: true };
        return {
          value: evenDailyPlan(
            c,
            targets[c.key]?.value ?? null,
            day,
            sheet.workingDays,
          ),
          typed: false,
        };
      }
      const typed = sheet.typed[day]?.[key];
      if (typed !== undefined) return { value: typed, typed: true };
      const row = rowsOf(sheet, [day]);
      return { value: rollUp(c, row, 1), typed: false };
    },
    [sheet, mode, targets],
  );

  const select = useCallback((sel: Selected) => {
    setSelected(sel);
    setEditing(null);
  }, []);

  const startEdit = useCallback(
    (sel: Selected) => {
      const c = flat.find(x => x.key === sel.col);
      if (!c) return;
      if (sel.row.kind === "day") {
        if (!c.editable) return;
        const raw = dayValue(c, sel.row.day);
        setSelected(sel);
        setEditing({ sel, text: editText(raw.value, c) });
      } else if (sel.row.kind === "target") {
        if (isWorkedOut(c, inputs)) return;
        setSelected(sel);
        setEditing({ sel, text: editText(targets[c.key]?.value, c) });
      }
    },
    [flat, dayValue, inputs, targets],
  );

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const ensurePlan = useCallback(async (): Promise<number> => {
    if (!ctx || !sheet) throw new Error("The sheet is still opening");
    if (ctx.plan?.id) return Number(ctx.plan.id);
    const from = sheet.days[0];
    const to = sheet.days[sheet.days.length - 1];
    const made = (await savePlan({
      periodKind: "month",
      periodFrom: from,
      periodTo: to,
      title: planTitle(from),
      status: "draft",
    })) as { id: number };
    return made.id;
  }, [ctx, sheet, savePlan]);

  const commitDay = useCallback(
    async (c: SheetColumn, day: string, value: number | null) => {
      setSaving(true);
      setError(null);
      try {
        await saveCells({
          cells: [{ day, key: cellKey(c), kind: mode, value }],
        });
        if (month) await load(month);
        onChanged?.();
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e).slice(0, 300));
      } finally {
        setSaving(false);
      }
    },
    [mode, saveCells, load, month, onChanged],
  );

  const commitTarget = useCallback(
    async (c: SheetColumn, value: number | null) => {
      setSaving(true);
      setError(null);
      try {
        const planId = await ensurePlan();
        const inputKey = inputKeyOf(c);
        let rows: Record<string, unknown>[];
        if (inputKey) {
          // A goal for the cash keeps the chain working back from it. A number
          // typed lower down moves the goal unless the goal is what was typed.
          const next = { ...inputs, [inputKey]: value };
          if (inputKey === "spend") next.goalCash = null;
          const keptNotes: Record<string, string | null> = {};
          for (const [k, t] of Object.entries(targets)) keptNotes[k] = t.note;
          // A typed number's own assumption no longer holds.
          keptNotes[c.key] = "Typed on the sheet.";
          rows = targetRows(next, keptNotes, SAY);
        } else {
          const section = SHEET_SECTIONS.find(s => s.key === c.section);
          rows = [
            {
              groupKey: section?.group ?? "team",
              metricKey: c.key,
              label: c.label,
              unit: c.unit,
              direction: c.direction,
              target: value === null ? null : tidy(value, c.unit),
              note: targets[c.key]?.note ?? null,
              sort: 2000,
            },
          ];
        }
        await saveTargets({ planId, targets: rows });
        if (month) await load(month);
        onChanged?.();
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e).slice(0, 300));
      } finally {
        setSaving(false);
      }
    },
    [ensurePlan, inputs, targets, saveTargets, load, month, onChanged],
  );

  const finishEdit = useCallback(
    async (move?: "down" | "right" | "left" | "up") => {
      if (!editing || !sheet) return;
      const { sel, text } = editing;
      const c = flat.find(x => x.key === sel.col);
      setEditing(null);
      if (!c) return;
      const parsed = parseCell(text, c);
      if (parsed === "bad") {
        setError(`"${text}" is not a number. Type a number or clear the cell.`);
        return;
      }
      if (sel.row.kind === "day") {
        const had = dayValue(c, sel.row.day);
        const same =
          (parsed === null && !had.typed) ||
          (parsed !== null && had.value === parsed);
        if (!same) await commitDay(c, sel.row.day, parsed);
      } else if (sel.row.kind === "target") {
        if (parsed !== (targets[c.key]?.value ?? null))
          await commitTarget(c, parsed);
      }
      if (!move || sel.row.kind !== "day") return;
      const colAt = flat.findIndex(x => x.key === sel.col);
      const dayAt = sheet.days.indexOf(sel.row.day);
      if (move === "down" || move === "up") {
        const next = sheet.days[dayAt + (move === "down" ? 1 : -1)];
        if (next)
          setSelected({ col: sel.col, row: { kind: "day", day: next } });
      } else {
        const step = move === "right" ? 1 : -1;
        let i = colAt + step;
        while (flat[i] && !flat[i].editable) i += step;
        if (flat[i]) setSelected({ col: flat[i].key, row: sel.row });
      }
    },
    [editing, sheet, flat, dayValue, targets, commitDay, commitTarget],
  );

  // Paste a block from Google Sheets: tabs across, new lines down.
  const onPaste = useCallback(
    async (e: ClipboardEvent) => {
      if (!selected || selected.row.kind !== "day" || !sheet) return;
      const text = e.clipboardData.getData("text/plain");
      if (!text.includes("\t") && !text.includes("\n")) return;
      e.preventDefault();
      const startCol = flat.findIndex(x => x.key === selected.col);
      const startDay = sheet.days.indexOf(selected.row.day);
      const cells: {
        day: string;
        key: string;
        kind: "actual" | "plan";
        value: number | null;
      }[] = [];
      for (const [r, line] of text.replace(/\r/g, "").split("\n").entries()) {
        if (!line && r > 0) continue;
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
      if (!cells.length) return;
      setSaving(true);
      setError(null);
      try {
        await saveCells({ cells });
        if (month) await load(month);
      } catch (err) {
        setError(
          String(err instanceof Error ? err.message : err).slice(0, 300),
        );
      } finally {
        setSaving(false);
      }
    },
    [selected, sheet, flat, mode, saveCells, load, month],
  );

  const onGridKey = useCallback(
    (e: KeyboardEvent) => {
      if (!selected || editing || !sheet) return;
      const colAt = flat.findIndex(x => x.key === selected.col);
      const move = (col: number, row: number) => {
        const c = flat[col];
        if (!c) return;
        if (selected.row.kind === "day") {
          const at = sheet.days.indexOf(selected.row.day) + row;
          const day = sheet.days[at];
          if (day) setSelected({ col: c.key, row: { kind: "day", day } });
        } else setSelected({ col: c.key, row: selected.row });
      };
      if (e.key === "ArrowRight") move(colAt + 1, 0);
      else if (e.key === "ArrowLeft") move(colAt - 1, 0);
      else if (e.key === "ArrowDown") move(colAt, 1);
      else if (e.key === "ArrowUp") move(colAt, -1);
      else if (e.key === "Enter") startEdit(selected);
      else if (e.key === "Delete" || e.key === "Backspace") {
        const c = flat[colAt];
        if (selected.row.kind === "day" && c?.editable)
          void commitDay(c, selected.row.day, null);
      } else if (/^[0-9.$-]$/.test(e.key)) {
        const c = flat[colAt];
        if (
          c &&
          ((selected.row.kind === "day" && c.editable) ||
            (selected.row.kind === "target" && !isWorkedOut(c, inputs)))
        )
          setEditing({ sel: selected, text: e.key });
      } else return;
      e.preventDefault();
    },
    [selected, editing, sheet, flat, startEdit, commitDay, inputs],
  );

  const bar = useMemo(() => {
    if (!selected || !sheet) return null;
    const c = flat.find(x => x.key === selected.col);
    if (!c) return null;
    const section = SHEET_SECTIONS.find(s => s.key === c.section);
    if (selected.row.kind === "target") {
      const t = targets[c.key];
      const worked = isWorkedOut(c, inputs);
      return {
        address: `Target · ${c.label}`,
        value: t ? show(t.value, c) : NA,
        text:
          t?.note ??
          (worked
            ? "Worked out from the plan's inputs. Change an input and this follows."
            : "No target yet. Type one."),
        hint: worked
          ? "Worked out: change what it depends on."
          : "Type to change it. The rest of the plan follows.",
        section: section?.label,
      };
    }
    if (selected.row.kind === "day") {
      const day = selected.row.day;
      const { value, typed } = dayValue(c, day);
      const measuredRow = rowsOf({ ...sheet, typed: {} }, [day]);
      const measured = rollUp(c, measuredRow, 1);
      const typedOver =
        typed && mode === "actual" && measured !== null
          ? ` Typed over the measured ${show(measured, c)}.`
          : "";
      return {
        address: `${shortDate(day)} · ${c.label}`,
        value: value === null ? "Empty" : show(value, c),
        text:
          mode === "plan"
            ? typed
              ? "This day's plan, typed."
              : "An even share of the month's target over its working days. Type over it to plan this day differently."
            : `${c.source}${typedOver}`,
        hint: c.editable
          ? "Type to fill it, Delete to clear it. Paste a block from a spreadsheet."
          : "Worked out from the columns it divides.",
        section: section?.label,
      };
    }
    return {
      address: `${selected.row.label} · ${c.label}`,
      value: "",
      text: c.source,
      hint: isLevel(c)
        ? "Judged whole: a rate or a cost is not paced through the month."
        : "Added up over these days.",
      section: section?.label,
    };
  }, [selected, sheet, flat, targets, inputs, dayValue, mode]);

  if (!month) return null;

  const left1 = "left-0";
  const stickyHead = "sticky top-0 z-20 gs-band";

  return (
    <SectionCard
      title="Monthly sheet"
      description={
        view === "sheet"
          ? "Days down the side, every metric across. What the cockpit measures fills itself in; type over it or fill in the rest."
          : "The month's numbers with their source and what they leave out, and what to do about the clients behind them."
      }
      order={1}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {busy || saving ? (
            <Loader2
              className="size-4 animate-spin text-muted-foreground"
              aria-hidden
            />
          ) : null}
          <AnimatedSelect
            aria-label="Which month"
            className="ceo-select-sm"
            value={month}
            onChange={e => {
              setMonth(e.target.value);
              setSelected(null);
              setEditing(null);
            }}
          >
            {months.map(m => (
              <option key={m} value={m}>
                {new Date(`${m}-01T00:00:00Z`).toLocaleString("en", {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })}
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
                  "rounded px-2.5 py-1 text-xs font-medium",
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
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      {view === "lockin" && ctx && sheet && monthly ? (
        <LockIn
          ctx={ctx}
          sheet={sheet}
          actual={monthly.actual}
          onChanged={() => void load(month)}
        />
      ) : null}

      {view === "sheet" && sheet && monthly ? (
        <div className="grid gap-3">
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
                    setMode(k);
                    setEditing(null);
                  }}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium",
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
              {ctx?.bankThrough ? (
                <span className="text-xs text-muted-foreground">
                  {`Bank lines stop at ${shortDate(ctx.bankThrough)}: upload a statement on Money to fill them in.`}
                </span>
              ) : null}
              {ctx && ctx.callDaily === null ? (
                <span className="text-xs text-muted-foreground">
                  The call centre report did not answer, so its columns read
                  empty.
                </span>
              ) : null}
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
                  setError(
                    String(e instanceof Error ? e.message : e).slice(0, 300),
                  );
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
                <div className="min-w-0 text-xs">
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
                    {new Date(`${month}-01T00:00:00Z`).toLocaleString("en", {
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
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
                                setError(
                                  String(
                                    e instanceof Error ? e.message : e,
                                  ).slice(0, 300),
                                );
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
                  values={baseline}
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
                        const { value, typed } = dayValue(c, day);
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
                            onClick={() => select(sel)}
                            onDoubleClick={() => startEdit(sel)}
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
                            {isEditing ? (
                              <input
                                ref={inputRef}
                                value={editing?.text ?? ""}
                                aria-label={`${c.label} on ${day}`}
                                onChange={e =>
                                  setEditing(
                                    x => x && { ...x, text: e.target.value },
                                  )
                                }
                                onBlur={() => void finishEdit()}
                                onKeyDown={e => {
                                  e.stopPropagation();
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void finishEdit("down");
                                  } else if (e.key === "Tab") {
                                    e.preventDefault();
                                    void finishEdit(
                                      e.shiftKey ? "left" : "right",
                                    );
                                  } else if (e.key === "Escape")
                                    setEditing(null);
                                }}
                                className="h-6 w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
                              />
                            ) : (
                              show(value, c)
                            )}
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
                    const t = targets[c.key];
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
                        style={{ bottom: 28 }}
                        onClick={() => select(sel)}
                        onDoubleClick={() => startEdit(sel)}
                        className={cn(
                          cellBase,
                          "sticky z-[5] gs-plan",
                          worked ? "text-muted-foreground" : "font-medium",
                          isSel &&
                            "outline outline-2 -outline-offset-2 outline-primary",
                        )}
                      >
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            value={editing?.text ?? ""}
                            aria-label={`Target for ${c.label}`}
                            onChange={e =>
                              setEditing(
                                x => x && { ...x, text: e.target.value },
                              )
                            }
                            onBlur={() => void finishEdit()}
                            onKeyDown={e => {
                              e.stopPropagation();
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void finishEdit();
                              } else if (e.key === "Escape") setEditing(null);
                            }}
                            className="h-6 w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
                          />
                        ) : (
                          show(t?.value, c)
                        )}
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
                    const col = colourFor(
                      c,
                      monthly.pace[c.key],
                      targets[c.key]?.value ?? null,
                    );
                    return (
                      <td
                        key={c.key}
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
        if (m.label.trim()) void onAdd(m);
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
          {SHEET_SECTIONS.map(s => (
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
