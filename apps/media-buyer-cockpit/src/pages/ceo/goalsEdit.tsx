import { useAction } from "convex/react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { SectionCard } from "@/components/ceo/SectionCard";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { api } from "../../../convex/_generated/api";
import type { Board, TargetRow } from "../../../convex/ceo/goals";
import type { MetricDef } from "../../../convex/ceo/scoreboard";
import { fmt, planTitle } from "./goalsKit";

/**
 * Writing the plan: the period and the sentence it is for, then a target on
 * every number that matters.
 *
 * Adding a target is picking a metric, not typing a name, because a metric
 * from the catalogue carries its own unit, its own direction and the cockpit
 * number that scores it. Anything the cockpit cannot measure is in the same
 * list, marked, and its actual is typed in beside the target.
 */

const field =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
// The shared select is sized by ceo.css (its own stylesheet beats utilities).
const selectField = "ceo-select-md w-full";
const label = "text-xs font-medium text-muted-foreground";

type Draft = {
  id?: number;
  groupKey: string;
  metricKey: string;
  label: string;
  unit: string;
  direction: string;
  target: string;
  stretch: string;
  baseline: string;
  actualManual: string;
  note: string;
};

function monthEnd(from: string): string {
  const [y, m] = from.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function nextMonthFrom(to: string): string {
  const [y, m] = to.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

const numOrUndef = (s: string) =>
  s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s);

export function PlanEditor({
  board,
  open,
  onClose,
  onSaved,
}: {
  board: Board | null;
  open: boolean;
  onClose: () => void;
  onSaved: (planId?: number) => void;
}) {
  const savePlan = useAction(api.ceo.goals.savePlan);
  const saveTargets = useAction(api.ceo.goals.saveTargets);
  const removeTarget = useAction(api.ceo.goals.removeTarget);
  const startFrom = useAction(api.ceo.goals.startFrom);

  const plan = board?.plan ?? null;
  const catalogue: MetricDef[] = board?.catalogue ?? [];
  const [title, setTitle] = useState(plan?.title ?? "");
  const [mission, setMission] = useState(plan?.mission ?? "");
  const [headline, setHeadline] = useState(plan?.headline ?? "");
  const [from, setFrom] = useState(
    plan?.periodFrom ?? new Date().toISOString().slice(0, 8) + "01",
  );
  const [to, setTo] = useState(plan?.periodTo ?? monthEnd(from));
  const [status, setStatus] = useState<"draft" | "live" | "closed">(
    plan?.status ?? "live",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const existing: TargetRow[] = useMemo(
    () => (board?.groups ?? []).flatMap(g => g.targets),
    [board],
  );
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [pick, setPick] = useState("");

  const taken = useMemo(
    () =>
      new Set([
        ...existing.map(t => t.metricKey),
        ...drafts.map(d => d.metricKey),
      ]),
    [existing, drafts],
  );

  if (!open) return null;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 300));
    } finally {
      setBusy(false);
    }
  };

  const add = (key: string) => {
    const def = catalogue.find(c => c.key === key);
    if (!def) return;
    setDrafts(d => [
      ...d,
      {
        groupKey: def.group,
        metricKey: def.key,
        label: def.label,
        unit: def.unit,
        direction: def.direction,
        target: "",
        stretch: "",
        baseline: "",
        actualManual: "",
        note: "",
      },
    ]);
    setPick("");
  };

  return (
    <SectionCard
      title="Edit the plan"
      order={1}
      actions={
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-3 @2xl:grid-cols-2">
          <label className="grid gap-1">
            <span className={label}>Name</span>
            <input
              className={field}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="October 2026 plan"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
            <label className="grid gap-1">
              <span className={label}>From</span>
              <DateInput
                className={selectField}
                value={from}
                onChange={e => {
                  setFrom(e.target.value);
                  if (e.target.value) setTo(monthEnd(e.target.value));
                }}
              />
            </label>
            {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
            <label className="grid gap-1">
              <span className={label}>To</span>
              <DateInput
                className={selectField}
                value={to}
                onChange={e => setTo(e.target.value)}
              />
            </label>
          </div>
          <label className="grid gap-1 @2xl:col-span-2">
            <span className={label}>Mission</span>
            <textarea
              className={`${field} min-h-[60px]`}
              value={mission}
              onChange={e => setMission(e.target.value)}
              placeholder="The one sentence this period is for."
            />
          </label>
          <label className="grid gap-1 @2xl:col-span-2">
            <span className={label}>The number to beat</span>
            <textarea
              className={`${field} min-h-[60px]`}
              value={headline}
              onChange={e => setHeadline(e.target.value)}
              placeholder="Collect $80,400, spend $41,960, keep $38,440 at a 48% margin."
            />
          </label>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
          <label className="grid gap-1">
            <span className={label}>Status</span>
            <AnimatedSelect
              className={selectField}
              value={status}
              onChange={e =>
                setStatus(e.target.value as "draft" | "live" | "closed")
              }
            >
              <option value="live">Live: this is the plan being scored</option>
              <option value="draft">Draft: still being written</option>
              <option value="closed">Closed: history</option>
            </AnimatedSelect>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy || title.trim().length < 3}
            onClick={() =>
              run(async () => {
                const res = await savePlan({
                  id: plan?.id,
                  periodKind: "month",
                  periodFrom: from,
                  periodTo: to,
                  title,
                  mission,
                  headline,
                  status,
                });
                onSaved(res.id);
                return "Plan saved.";
              })
            }
          >
            {busy ? "Saving" : plan ? "Save the plan" : "Start the plan"}
          </Button>
          {plan ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const nf = nextMonthFrom(plan.periodTo);
                  const res = await startFrom({
                    fromPlanId: plan.id,
                    periodFrom: nf,
                    periodTo: monthEnd(nf),
                    title: planTitle(nf),
                  });
                  onSaved(res.id);
                  return `Started the next period with ${res.targets} targets carried over, and this period's real numbers as their baselines.`;
                })
              }
            >
              Start the next period from this one
            </Button>
          ) : null}
        </div>

        {plan ? (
          <div className="grid gap-3 border-t pt-4">
            <div className="flex flex-wrap items-end gap-2">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
              <label className="grid min-w-[16rem] flex-1 gap-1">
                <span className={label}>Add a target</span>
                <AnimatedSelect
                  className={selectField}
                  value={pick}
                  onChange={e => add(e.target.value)}
                >
                  <option value="">Pick a number to set a goal on</option>
                  {catalogue
                    .filter(c => !taken.has(c.key))
                    .map(c => (
                      <option key={c.key} value={c.key}>
                        {`${c.label}${c.manual ? " (typed in)" : ""}`}
                      </option>
                    ))}
                </AnimatedSelect>
              </label>
            </div>

            {drafts.length ? (
              <div className="grid gap-2">
                {drafts.map((d, i) => (
                  <div
                    key={d.metricKey}
                    className="grid gap-2 rounded-xl bg-muted/40 p-3 @xl:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_auto] @xl:items-end"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{d.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {catalogue.find(c => c.key === d.metricKey)?.source}
                      </p>
                    </div>
                    <label className="grid gap-1">
                      <span className={label}>
                        {d.unit === "rate" ? "Target, 0 to 1" : "Target"}
                      </span>
                      <input
                        className={field}
                        inputMode="decimal"
                        value={d.target}
                        onChange={e =>
                          setDrafts(x =>
                            x.map((y, n) =>
                              n === i ? { ...y, target: e.target.value } : y,
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className={label}>Stretch</span>
                      <input
                        className={field}
                        inputMode="decimal"
                        value={d.stretch}
                        onChange={e =>
                          setDrafts(x =>
                            x.map((y, n) =>
                              n === i ? { ...y, stretch: e.target.value } : y,
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className={label}>Last period</span>
                      <input
                        className={field}
                        inputMode="decimal"
                        value={d.baseline}
                        onChange={e =>
                          setDrafts(x =>
                            x.map((y, n) =>
                              n === i ? { ...y, baseline: e.target.value } : y,
                            ),
                          )
                        }
                      />
                    </label>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        setDrafts(x => x.filter((_, n) => n !== i))
                      }
                      aria-label={`Drop ${d.label}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const res = await saveTargets({
                          planId: plan.id,
                          targets: drafts.map((d, i) => ({
                            groupKey: d.groupKey,
                            metricKey: d.metricKey,
                            label: d.label,
                            unit: d.unit,
                            direction: d.direction,
                            target: numOrUndef(d.target),
                            stretch: numOrUndef(d.stretch),
                            baseline: numOrUndef(d.baseline),
                            actualManual: numOrUndef(d.actualManual),
                            note: d.note,
                            sort: existing.length + i,
                          })),
                        });
                        setDrafts([]);
                        onSaved(plan.id);
                        return `${res.saved} ${res.saved === 1 ? "target" : "targets"} added.`;
                      })
                    }
                  >
                    <Plus aria-hidden />
                    {`Add ${drafts.length} ${drafts.length === 1 ? "target" : "targets"}`}
                  </Button>
                </div>
              </div>
            ) : null}

            <TargetList
              rows={existing}
              planId={plan.id}
              busy={busy}
              onSaved={() => onSaved(plan.id)}
              onSave={saveTargets}
              onRemove={removeTarget}
            />
          </div>
        ) : null}

        {msg ? <p className="text-sm">{msg}</p> : null}
        {error ? (
          <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
        ) : null}
      </div>
    </SectionCard>
  );
}

/** Every target already on the plan, editable in place. */
function TargetList({
  rows,
  planId,
  busy,
  onSaved,
  onSave,
  onRemove,
}: {
  rows: TargetRow[];
  planId: number;
  busy: boolean;
  onSaved: () => void;
  // biome-ignore lint/suspicious/noExplicitAny: convex action handles
  onSave: any;
  // biome-ignore lint/suspicious/noExplicitAny: convex action handles
  onRemove: any;
}) {
  const [edits, setEdits] = useState<Record<number, Partial<Draft>>>({});
  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(edits).length;
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">
        Nothing set yet. Pick a number above and give it a target.
      </p>
    );
  return (
    <div className="grid gap-2">
      <p className={label}>{`${rows.length} targets on this plan`}</p>
      <div className="max-h-[28rem] overflow-auto rounded-xl bg-muted/40">
        {rows.map(t => {
          const set = (patch: Partial<Draft>) =>
            setEdits(x => ({ ...x, [t.id]: { ...x[t.id], ...patch } }));
          return (
            <div
              key={t.id}
              className="grid gap-2 border-b border-[color:var(--ceo-grid)] px-3 py-2 last:border-b-0 @xl:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_6.5rem_auto] @xl:items-center"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t.label}</p>
                <p className="text-xs text-muted-foreground">
                  {`${t.groupKey.replace(/_/g, " ")} · now ${fmt(t.actual, t.unit)}`}
                </p>
              </div>
              <input
                className={field}
                aria-label={`${t.label} target`}
                inputMode="decimal"
                defaultValue={t.target ?? ""}
                onChange={ev => set({ target: ev.target.value })}
              />
              <input
                className={field}
                aria-label={`${t.label} stretch`}
                inputMode="decimal"
                defaultValue={t.stretch ?? ""}
                onChange={ev => set({ stretch: ev.target.value })}
              />
              <input
                className={field}
                aria-label={`${t.label} actual, typed in`}
                inputMode="decimal"
                placeholder={t.source === "measured" ? "measured" : "actual"}
                disabled={t.source === "measured"}
                defaultValue=""
                onChange={ev => set({ actualManual: ev.target.value })}
              />
              <Button
                variant="outline"
                size="icon"
                disabled={busy || saving}
                aria-label={`Take ${t.label} off the plan`}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onRemove({ id: t.id });
                    onSaved();
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          );
        })}
      </div>
      <div>
        <Button
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({
                planId,
                targets: rows
                  .filter(t => edits[t.id])
                  .map(t => {
                    const e = edits[t.id];
                    return {
                      id: t.id,
                      groupKey: t.groupKey,
                      metricKey: t.metricKey,
                      label: t.label,
                      unit: t.unit,
                      direction: t.direction,
                      target:
                        e.target !== undefined
                          ? numOrUndef(e.target)
                          : (t.target ?? undefined),
                      stretch:
                        e.stretch !== undefined
                          ? numOrUndef(e.stretch)
                          : (t.stretch ?? undefined),
                      baseline: t.baseline ?? undefined,
                      actualManual:
                        e.actualManual !== undefined
                          ? numOrUndef(e.actualManual)
                          : undefined,
                      note: t.note ?? "",
                      sort: t.sort,
                    };
                  }),
              });
              setEdits({});
              onSaved();
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Saving
            </>
          ) : (
            `Save ${dirty} ${dirty === 1 ? "change" : "changes"}`
          )}
        </Button>
      </div>
    </div>
  );
}
