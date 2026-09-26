import { useAction } from "convex/react";
import { Loader2, Wand2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { KICKER } from "@/components/ceo/Kicker";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip, StatusDot } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Board, TargetRow } from "../../../convex/ceo/goals";
import { fmt, paceTone, planTitle, worstThree } from "./goalsKit";

/**
 * Next month's plan, set in one screen.
 *
 * Aziz, 2026-09-22: "I should be able to set next month's goals in a very
 * easy way in the goals section with that template and set the numbers
 * straight from there for every single thing."
 *
 * So it is one row per target with this month's real number beside the box
 * you type into, and one button at the end. The rows arrive filled in with
 * this month's target, because the usual answer is "the same again" and the
 * ones that change are the ones worth thinking about. The three helpers at
 * the top fill every box at once: keep the target, take this month's actual,
 * or lift the target by a tenth.
 *
 * Nothing is written until Save, and the new plan is a draft until it is made
 * live, so a month can be drafted days before it starts without the cockpit
 * scoring the business against it.
 */

const field =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring";
const label = "text-xs font-medium text-muted-foreground";

function monthEnd(from: string): string {
  const [y, m] = from.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function nextMonthFrom(to: string): string {
  const [y, m] = to.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/** Round the way a target is written: money and counts whole, rates to 2dp. */
function tidy(v: number, unit: string): number {
  if (unit === "rate") return Math.round(v * 100) / 100;
  if (unit === "usd") return Math.round(v);
  if (unit === "x") return Math.round(v * 10) / 10;
  return Math.round(v);
}

export function NextMonth({
  board,
  onClose,
  onSaved,
}: {
  board: Board;
  onClose: () => void;
  onSaved: (planId: number) => void;
}) {
  const savePlan = useAction(api.ceo.goals.savePlan);
  const saveTargets = useAction(api.ceo.goals.saveTargets);

  const plan = board.plan;
  const worst = useMemo(() => worstThree(board.behind), [board]);
  const groups = useMemo(
    () => (Array.isArray(board.groups) ? board.groups : []),
    [board],
  );
  const rows: TargetRow[] = useMemo(
    () => groups.flatMap(g => (Array.isArray(g.targets) ? g.targets : [])),
    [groups],
  );
  const firstDay = plan ? nextMonthFrom(plan.periodTo) : "";
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(firstDay ? monthEnd(firstDay) : "");
  const [title, setTitle] = useState(firstDay ? planTitle(firstDay) : "");
  const [mission, setMission] = useState(plan?.mission ?? "");
  const [headline, setHeadline] = useState("");
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      rows.map(t => [t.id, t.target === null ? "" : String(t.target)]),
    ),
  );
  const [stretch, setStretch] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      rows.map(t => [t.id, t.stretch === null ? "" : String(t.stretch)]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fillAll = (pick: (t: TargetRow) => number | null) =>
    setValues(
      Object.fromEntries(
        rows.map(t => {
          const v = pick(t);
          return [t.id, v === null ? "" : String(tidy(v, t.unit))];
        }),
      ),
    );

  const changed = rows.filter(
    t => (values[t.id] ?? "") !== (t.target === null ? "" : String(t.target)),
  ).length;

  return (
    <SectionCard
      title="Plan the next month"
      description="This month's real numbers beside next month's targets."
      order={1}
      actions={
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-3 @2xl:grid-cols-4">
          <label className="grid gap-1 @2xl:col-span-2">
            <span className={label}>Name</span>
            <input
              className={field}
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </label>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
          <label className="grid gap-1">
            <span className={label}>From</span>
            <DateInput
              className="ceo-select-md w-full"
              value={from}
              onChange={e => {
                setFrom(e.target.value);
                if (e.target.value) {
                  setTo(monthEnd(e.target.value));
                  setTitle(planTitle(e.target.value));
                }
              }}
            />
          </label>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
          <label className="grid gap-1">
            <span className={label}>To</span>
            <DateInput
              className="ceo-select-md w-full"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </label>
          <label className="grid gap-1 @2xl:col-span-4">
            <span className={label}>Mission</span>
            <textarea
              className={`${field} min-h-[56px]`}
              value={mission}
              onChange={e => setMission(e.target.value)}
              placeholder="The one sentence next month is for."
            />
          </label>
          <label className="grid gap-1 @2xl:col-span-4">
            <span className={label}>The number to beat</span>
            <textarea
              className={`${field} min-h-[56px]`}
              value={headline}
              onChange={e => setHeadline(e.target.value)}
              placeholder="Collect $X, spend $Y, keep $Z at a W% margin."
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <span className={label}>Fill every box</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fillAll(t => t.target)}
          >
            Same as this month
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fillAll(t => t.actual ?? t.target)}
          >
            This month's actual
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              fillAll(t =>
                t.target === null
                  ? null
                  : t.direction === "up"
                    ? t.target * 1.1
                    : t.target * 0.9,
              )
            }
          >
            <Wand2 aria-hidden />A tenth better
          </Button>
          <span className="text-xs text-muted-foreground">
            {`${changed} of ${rows.length} changed`}
          </span>
        </div>

        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 text-left font-medium">Target</th>
                <th className="py-2 text-right font-medium">This month</th>
                <th className="py-2 text-right font-medium">Actual</th>
                <th className="py-2 text-right font-medium">Next month</th>
                <th className="py-2 text-right font-medium">Stretch</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <Fragment key={g.key}>
                  <tr className="border-b">
                    <td colSpan={5} className={cn(KICKER, "pb-2 pt-4")}>
                      {g.label}
                    </td>
                  </tr>
                  {g.targets.map(t => (
                    <tr key={t.id} className="border-b last:border-b-0">
                      <td className="py-1.5 pr-3">
                        <span className="font-medium">{t.label}</span>
                        {t.source === "typed" || t.source === "none" ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            typed in
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {fmt(t.target, t.unit)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {/* Behind pace shows as a dot; the number stays in ink. */}
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {t.onPace === false ? (
                            <StatusDot
                              tone={
                                paceTone(t, worst) === "critical"
                                  ? "critical"
                                  : "warning"
                              }
                              label="Behind pace"
                            />
                          ) : null}
                          <span
                            className={
                              t.actual === null ? "text-muted-foreground" : ""
                            }
                          >
                            {fmt(t.actual, t.unit)}
                          </span>
                        </span>
                      </td>
                      <td className="w-28 py-1.5 pl-3">
                        <input
                          className={field}
                          aria-label={`${t.label} target for next month`}
                          inputMode="decimal"
                          value={values[t.id] ?? ""}
                          onChange={e =>
                            setValues(v => ({ ...v, [t.id]: e.target.value }))
                          }
                        />
                      </td>
                      <td className="w-24 py-1.5 pl-2">
                        <input
                          className={field}
                          aria-label={`${t.label} stretch for next month`}
                          inputMode="decimal"
                          value={stretch[t.id] ?? ""}
                          onChange={e =>
                            setStretch(v => ({ ...v, [t.id]: e.target.value }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={busy || !title.trim() || !from || !to}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const made = await savePlan({
                  periodKind: "month",
                  periodFrom: from,
                  periodTo: to,
                  title,
                  mission,
                  headline,
                  status: "draft",
                });
                await saveTargets({
                  planId: made.id,
                  targets: rows.map((t, i) => ({
                    groupKey: t.groupKey,
                    metricKey: t.metricKey,
                    label: t.label,
                    unit: t.unit,
                    direction: t.direction,
                    target:
                      values[t.id] === "" || values[t.id] === undefined
                        ? undefined
                        : Number(values[t.id]),
                    stretch:
                      stretch[t.id] === "" || stretch[t.id] === undefined
                        ? undefined
                        : Number(stretch[t.id]),
                    // This month's real number is next month's baseline, so
                    // the change shows on the row instead of in somebody's
                    // memory.
                    baseline: t.actual ?? t.target ?? undefined,
                    note: t.note ?? "",
                    sort: i,
                  })),
                });
                onSaved(made.id);
              } catch (e) {
                setError(
                  String(e instanceof Error ? e.message : e).slice(0, 300),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Saving
              </>
            ) : (
              `Save ${rows.length} targets as a draft`
            )}
          </Button>
          <StatusChip
            tone="neutral"
            label="Draft until you make it live"
            hint="A draft is not scored, so next month can be written days before it starts."
          />
          {error ? (
            <span className="text-sm text-[var(--ceo-critical)]">{error}</span>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}
