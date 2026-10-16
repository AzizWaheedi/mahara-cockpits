/**
 * The board's targets, for the CEO and admins: each metric's official line
 * (kpi.ts, through cockpit_board_default_targets) and an override for the
 * whole board or for one client. Clearing both lines goes back to the
 * official target. The database refuses anyone else and writes an audit row
 * for every save.
 */
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { isNum } from "@/components/ceo/format";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type ClientRow,
  saveTarget,
  type Target,
  type Targets,
} from "@/lib/boardClient";
import {
  formatValue,
  targetList,
  targetText,
  targetUnit,
  type Unit,
} from "@/lib/boardColumns";
import { Problem } from "./cells";

type Line = {
  good: number | null;
  watch: number | null;
  by?: string | null;
  at?: string | null;
};

function asLine(x: unknown): Line | null {
  const o = x as
    | { good?: unknown; watch?: unknown; by?: unknown; at?: unknown }
    | null
    | undefined;
  if (!o || !isNum(o.good)) return null;
  return {
    good: o.good,
    watch: isNum(o.watch) ? o.watch : null,
    by: typeof o.by === "string" ? o.by : null,
    at: typeof o.at === "string" ? o.at : null,
  };
}

const parseNumber = (s: string): number | null | "bad" => {
  const t = s.trim().replace(/[$,%x\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "bad";
};

/** The lines that apply without this override: the official ones, or the board's for one client. */
export type Inherited = {
  good: number | null;
  watch: number | null;
  from: string;
};

/**
 * What a blank Watch field stands for when the good line is set. The
 * database stores a blank watch as "short of good is a watch, never off", so
 * the screen never sends one by accident: it carries the inherited watch
 * line, or asks for one.
 *   - The inherited target has no watch line (AOV): none, as before.
 *   - The inherited lines are equal ("any miss is off"): the new good line.
 *   - The inherited watch line still sits on the worse side of the new good
 *     line: that line.
 *   - Otherwise there is no line to carry: set one.
 */
export function blankWatch(
  t: Pick<Target, "direction">,
  unit: Unit,
  good: number,
  inherited: Inherited,
):
  | { watch: number | null; words: string; problem?: undefined }
  | { problem: string } {
  const w = inherited.watch;
  if (!isNum(w))
    return { watch: null, words: "No watch line: short of good is a watch." };
  if (isNum(inherited.good) && w === inherited.good)
    return {
      watch: good,
      words: "Watch stays on the good line: any miss is off.",
    };
  const worse = t.direction === "lower" ? w >= good : w <= good;
  if (worse)
    return {
      watch: w,
      words: `Watch stays at ${formatValue(w, unit)}, ${inherited.from === "the official target" ? "the official" : "the board's"} watch line.`,
    };
  return {
    problem: `Set the watch line too: ${inherited.from === "the official target" ? "the official" : "the board's"} one, ${formatValue(w, unit)}, is ${t.direction === "lower" ? "under" : "over"} this good line.`,
  };
}

/** Why these two lines cannot be saved, or null when they can. */
export function lineProblem(
  t: Pick<Target, "direction" | "label">,
  unit: Unit,
  good: string,
  watch: string,
  inherited?: Inherited,
): string | null {
  const g = parseNumber(good);
  const w = parseNumber(watch);
  if (g === "bad" || w === "bad") return "Use a number from 0.";
  if (g === null && w !== null)
    return "Set the good line, or clear both to go back.";
  if (unit === "percent" && ((g ?? 0) > 100 || (w ?? 0) > 100))
    return "Use a number from 0 to 100.";
  if (g !== null && w !== null) {
    if (t.direction === "higher" && w > g)
      return `${t.label}: higher is better, so the watch line must be at or below the good line.`;
    if (t.direction === "lower" && w < g)
      return `${t.label}: lower is better, so the watch line must be at or above the good line.`;
  }
  if (g !== null && w === null && inherited) {
    const b = blankWatch(t, unit, g, inherited);
    if (b.problem) return b.problem;
  }
  return null;
}

function TargetRow({
  metric,
  target,
  scope,
  own,
  inherited,
  onSaved,
}: {
  metric: string;
  target: Target;
  scope: string;
  /** This scope's override, if any. */
  own: Line | null;
  /** What applies without it: the official line, or the board's for a client. */
  inherited: Inherited;
  onSaved: () => void;
}) {
  const unit = targetUnit(target);
  const [good, setGood] = useState(
    own && isNum(own.good) ? String(own.good) : "",
  );
  const [watch, setWatch] = useState(
    own && isNum(own.watch) ? String(own.watch) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = lineProblem(target, unit, good, watch, inherited);
  const changed =
    good !== (own && isNum(own.good) ? String(own.good) : "") ||
    watch !== (own && isNum(own.watch) ? String(own.watch) : "");
  // A blank watch with a good line typed: the line it stands for.
  const typedGood = parseNumber(good);
  const implied =
    isNum(typedGood) && parseNumber(watch) === null
      ? blankWatch(target, unit, typedGood, inherited)
      : null;
  const impliedWatch = implied && !implied.problem ? implied : null;
  const watchHint = impliedWatch
    ? isNum(impliedWatch.watch)
      ? formatValue(impliedWatch.watch, unit).replace(/[$%x]|\smin/g, "")
      : "none"
    : isNum(inherited.watch)
      ? formatValue(inherited.watch, unit).replace(/[$%x]|\smin/g, "")
      : "none";
  const save = async (clear: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const g = clear ? null : (parseNumber(good) as number | null);
      const typed = clear ? null : (parseNumber(watch) as number | null);
      // Never a blank watch by accident: the line the field stood for.
      const w =
        g !== null && typed === null && impliedWatch
          ? impliedWatch.watch
          : typed;
      await saveTarget({ scope, metric, good: g, watch: w });
      toast.success(
        g === null && w === null
          ? `${target.label}: back to ${inherited.from}`
          : `${target.label} saved`,
      );
      if (clear) {
        setGood("");
        setWatch("");
      }
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The target was not saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const id = `target-${scope}-${metric}`;
  const sign =
    unit === "usd"
      ? "$"
      : unit === "percent"
        ? "%"
        : unit === "times"
          ? "x"
          : unit === "minutes"
            ? "min"
            : "";
  const ruleWords =
    target.direction === "lower" ? "Lower is better" : "Higher is better";
  return (
    <li className="grid gap-3 py-4 @2xl:grid-cols-[minmax(0,1fr)_auto] @2xl:items-start">
      <div className="min-w-0">
        <p className="text-[13px] font-medium" id={id}>
          {target.label}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {ruleWords}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {own ? (
            <>
              Override:{" "}
              {targetText(
                { ...target, good: own.good, watch: own.watch },
                unit,
              )}
              {own.by ? ` Set by ${own.by}.` : ""}{" "}
            </>
          ) : null}
          {inherited.from === "the official target"
            ? "Official"
            : "The board's"}
          :{" "}
          {isNum(inherited.good)
            ? targetText(
                { ...target, good: inherited.good, watch: inherited.watch },
                unit,
              )
            : "none."}
        </p>
        {error ? (
          <Problem className="mt-1">{error}</Problem>
        ) : problem && changed ? (
          <p className="mt-1 text-xs text-muted-foreground">{problem}</p>
        ) : impliedWatch && changed ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {impliedWatch.words}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-2 @2xl:w-[19rem] @2xl:flex-nowrap">
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">
            Good {sign ? `(${sign})` : ""}
          </span>
          <input
            aria-label={`${target.label} good line`}
            aria-describedby={id}
            inputMode="decimal"
            value={good}
            placeholder={
              isNum(inherited.good)
                ? formatValue(inherited.good, unit).replace(/[$%x]|\smin/g, "")
                : ""
            }
            onChange={e => setGood(e.target.value)}
            className="h-8 w-20 rounded-lg border bg-background px-2 text-base tabular-nums placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">
            Watch {sign ? `(${sign})` : ""}
          </span>
          <input
            aria-label={`${target.label} watch line`}
            aria-describedby={id}
            inputMode="decimal"
            value={watch}
            placeholder={watchHint}
            onChange={e => setWatch(e.target.value)}
            className="h-8 w-20 rounded-lg border bg-background px-2 text-base tabular-nums placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          />
        </label>
        {changed ? (
          <Button
            size="sm"
            disabled={
              busy || Boolean(problem) || (!good.trim() && !watch.trim())
            }
            onClick={() => void save(false)}
          >
            {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
            Save
          </Button>
        ) : own ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Use{" "}
            {inherited.from === "the official target"
              ? "official"
              : "the board's"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function TargetsDialog({
  open,
  onOpenChange,
  targets,
  clients,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The board's targets: the official lines and the board's overrides. */
  targets: Targets;
  clients: ClientRow[];
  onSaved: () => void;
}) {
  const [scope, setScope] = useState("defaults");
  const withCard = useMemo(
    () =>
      clients
        .filter(c => c.clickupId)
        .sort((a, b) => a.clientName.localeCompare(b.clientName)),
    [clients],
  );
  const client = scope.startsWith("client:")
    ? withCard.find(c => `client:${c.clickupId}` === scope)
    : null;
  const list = targetList(targets);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ceo-root max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit targets</DialogTitle>
          <DialogDescription>
            Every number on the board is judged against these lines: good, then
            watch; past the watch line is off. A blank watch line keeps the one
            in grey. Clear both lines to go back to the official target (for one
            client, the board's).
          </DialogDescription>
        </DialogHeader>
        <div className="block max-w-sm space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">
            Targets for
          </span>
          <AnimatedSelect
            aria-label="Targets for"
            className="ceo-select-md w-full"
            value={scope}
            onChange={e => setScope(e.target.value)}
          >
            <option value="defaults">The whole board</option>
            {withCard.map(c => (
              <option key={c.locationId} value={`client:${c.clickupId}`}>
                {c.clientName}
              </option>
            ))}
          </AnimatedSelect>
        </div>
        <ul className="@container divide-y divide-[color:var(--ceo-grid)]">
          {list.map(({ metric, target }) => {
            const board = asLine(target.board);
            const own =
              scope === "defaults"
                ? board
                : asLine(client?.overrides?.[metric]);
            const inherited =
              scope === "defaults"
                ? {
                    good: target.official.good ?? null,
                    watch: target.official.watch ?? null,
                    from: "the official target",
                  }
                : {
                    good: target.good,
                    watch: target.watch ?? null,
                    from: board ? "the board's target" : "the official target",
                  };
            return (
              <TargetRow
                key={`${scope}:${metric}:${own?.good ?? ""}:${own?.watch ?? ""}`}
                metric={metric}
                target={target}
                scope={scope}
                own={own}
                inherited={inherited}
                onSaved={onSaved}
              />
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
