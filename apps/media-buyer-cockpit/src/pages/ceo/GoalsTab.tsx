import { useAction } from "convex/react";
import { CalendarPlus, Loader2, Pencil, Target } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { count, shortDate } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip } from "@/components/ceo/StatusChip";
import { api } from "../../../convex/_generated/api";
import type { Board, TargetRow } from "../../../convex/ceo/goals";
import { PlanEditor } from "./goalsEdit";
import { behindBy, fmt, PaceBar } from "./goalsKit";
import { NextMonth } from "./goalsNext";
import type { CeoTabProps } from "./types";

/**
 * The plan for a period, and whether the business is on pace for it.
 *
 * Aziz, 2026-09-22: "I need to make sure that I can easily put goals for each
 * department of the team and front-end and back-end goals for the company...
 * set goals and projections for how we're going to get there through our
 * front-end funnel numbers, all of them."
 *
 * The front end is drawn as a ladder rather than a table, because that is
 * what it is: spend buys leads, leads book intros, intros make demos, demos
 * make clients. Reading down it, the rung where the fill falls behind the
 * pace mark is the one number that broke — which is exactly the question the
 * plan says the daily review has to answer.
 *
 * Every other part of the business is a list of the same rows, grouped the
 * way Aziz groups them: the back end, the money, the client standard, the
 * call centre, content, creative, systems and the team.
 */

/** The rungs of the front-end ladder, in funnel order, with the rate between them. */
const LADDER: { key: string; into?: { key: string; label: string } }[] = [
  { key: "spend", into: { key: "cpl", label: "at" } },
  { key: "leads", into: { key: "leadToBooked", label: "of which book" } },
  { key: "bookableLeads" },
  { key: "introsBooked", into: { key: "introShowRate", label: "show at" } },
  { key: "introsShown" },
  { key: "demosBooked", into: { key: "demoShowRate", label: "show at" } },
  { key: "demosShown", into: { key: "closeRate", label: "close at" } },
  { key: "closes", into: { key: "aov", label: "at an average of" } },
  { key: "contracted" },
  { key: "newCash" },
];

function Row({ t, compact }: { t: TargetRow; compact?: boolean }) {
  const behind = behindBy(t.actual, t.pacedTarget, t.direction, t.unit);
  return (
    <div className="grid gap-1.5 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-medium">{t.label}</span>
        <span className="tabular-nums text-sm">
          <span className={t.actual === null ? "text-muted-foreground" : ""}>
            {fmt(t.actual, t.unit)}
          </span>
          <span className="text-muted-foreground">
            {` of ${fmt(t.target, t.unit)}`}
            {t.stretch !== null ? `, ${fmt(t.stretch, t.unit)} stretch` : ""}
          </span>
        </span>
      </div>
      <PaceBar
        progress={t.progress}
        pace={
          // Where the fill should have reached by now. Only a number that
          // accumulates upwards has a place on the track: a cost, a rate or
          // an average is at the line or it is not, and a mark on it would
          // say the target moves through the month, which it does not.
          t.level || t.direction === "down" || !t.target || !t.pacedTarget
            ? null
            : t.pacedTarget / t.target
        }
        good={t.onPace}
        label={`${t.label}: ${fmt(t.actual, t.unit)} against a target of ${fmt(t.target, t.unit)}${t.onPace === false ? ", behind pace" : t.onPace ? ", on pace" : ""}`}
      />
      {compact ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {behind ? (
            <StatusChip tone="serious" label={`Behind: ${behind}`} />
          ) : t.onPace ? (
            <StatusChip tone="good" label="On pace" />
          ) : null}
          {t.baseline !== null ? (
            <span>{`was ${fmt(t.baseline, t.unit)}`}</span>
          ) : null}
          {t.source === "typed" ? <span>typed in</span> : null}
          {t.source === "none" ? <span>nothing recorded yet</span> : null}
          {t.note ? <span className="basis-full">{t.note}</span> : null}
        </div>
      )}
    </div>
  );
}

function Ladder({ rows }: { rows: TargetRow[] }) {
  const by = new Map(rows.map(r => [r.metricKey, r]));
  const rungs = LADDER.filter(l => by.has(l.key));
  if (!rungs.length) return null;
  return (
    <ol className="grid">
      {rungs.map((l, i) => {
        const t = by.get(l.key) as TargetRow;
        const into = l.into ? by.get(l.into.key) : undefined;
        return (
          <li key={l.key} className={i ? "border-t" : ""}>
            <Row t={t} />
            {into ? (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pb-2.5 pl-3 text-xs text-muted-foreground">
                <span aria-hidden>↳</span>
                <span>{l.into?.label}</span>
                <span className="font-medium text-foreground tabular-nums">
                  {fmt(into.actual, into.unit)}
                </span>
                <span>{`against ${fmt(into.target, into.unit)}`}</span>
                {into.onPace === false ? (
                  <StatusChip tone="serious" label="behind" />
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Group({
  label,
  blurb,
  rows,
  order,
  ladder,
}: {
  label: string;
  blurb: string;
  rows: TargetRow[];
  order: number;
  ladder?: boolean;
}) {
  const inLadder = new Set(LADDER.map(l => l.key));
  const rest = ladder ? rows.filter(r => !inLadder.has(r.metricKey)) : rows;
  return (
    <SectionCard kicker={blurb} title={label} order={order}>
      <div className="grid">
        {ladder ? <Ladder rows={rows} /> : null}
        {rest.length ? (
          <div className={`grid ${ladder ? "mt-4 border-t pt-2" : ""}`}>
            {rest.map((t, i) => (
              <div key={t.id} className={i ? "border-t" : ""}>
                <Row t={t} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

export function GoalsTab({ sections }: CeoTabProps) {
  void sections;
  const read = useAction(api.ceo.goals.board);
  const [board, setBoard] = useState<Board | null>(null);
  const [planId, setPlanId] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);

  const load = useCallback(
    async (id?: number) => {
      setBusy(true);
      setError(null);
      try {
        setBoard((await read({ planId: id })) as Board);
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e).slice(0, 300));
      } finally {
        setBusy(false);
      }
    },
    [read],
  );

  // The action identity changes on every render, so only the chosen plan is
  // allowed to retrigger this.
  useEffect(() => {
    void load(planId);
  }, [planId, load]);

  const verdict = useMemo(() => {
    if (!board?.plan) return null;
    if (!board.behind?.length)
      return "Everything with a number on it is on pace.";
    const names = board.behind.map(b => b.label.toLowerCase());
    return `Behind on ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}.`;
  }, [board]);

  if (busy && !board)
    return (
      <SectionCard title="Goals" order={0}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Reading the plan
        </p>
      </SectionCard>
    );

  if (error)
    return (
      <SectionCard title="Goals" order={0}>
        <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
      </SectionCard>
    );

  if (!board?.plan)
    return (
      <div className="grid gap-4 lg:gap-6">
        <SectionCard title="Goals" order={0}>
          <EmptyState
            title="No plan yet"
            text="Write one for this month: the mission, the number to beat, and a target on every number that matters."
            icon={Target}
          />
        </SectionCard>
        <PlanEditor
          board={board}
          open
          onClose={() => undefined}
          onSaved={id => setPlanId(id)}
        />
      </div>
    );

  const p = board.plan;
  const pace = board.pace;

  return (
    <div className="@container grid gap-4 lg:gap-6">
      <SectionCard
        kicker={`${shortDate(p.periodFrom)} to ${shortDate(p.periodTo)}${pace ? ` · day ${count(pace.workedSoFar)} of ${count(pace.workingDays)} worked` : ""}`}
        title={p.title}
        order={0}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {busy ? (
              <Loader2
                className="size-4 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : null}
            {(board.plans?.length ?? 0) > 1 ? (
              <select
                aria-label="Which plan"
                className="rounded-md border bg-background px-2 py-1 text-xs"
                value={String(p.id)}
                onChange={e => setPlanId(Number(e.target.value))}
              >
                {(board.plans ?? []).map(x => (
                  <option key={x.id} value={x.id}>
                    {`${x.title}${x.status === "draft" ? " (draft)" : ""}`}
                  </option>
                ))}
              </select>
            ) : null}
            <StatusChip
              tone={p.status === "live" ? "good" : "neutral"}
              label={p.status}
            />
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setPlanning(v => !v);
                setEditing(false);
              }}
            >
              <CalendarPlus className="size-3.5" aria-hidden />
              {planning ? "Close" : "Plan next month"}
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setEditing(v => !v);
                setPlanning(false);
              }}
            >
              <Pencil className="size-3.5" aria-hidden />
              {editing ? "Close the editor" : "Edit this plan"}
            </button>
          </div>
        }
      >
        <div className="grid gap-4">
          {p.mission ? <p className="text-base">{p.mission}</p> : null}
          {p.headline ? (
            <p className="text-sm text-muted-foreground">{p.headline}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {pace ? (
              <span>
                {`${count(pace.daysLeft)} working ${pace.daysLeft === 1 ? "day" : "days"} left. Numbers run to ${shortDate(pace.through)}, the newest complete day.`}
              </span>
            ) : null}
          </div>
          {verdict ? (
            <p className="text-sm">
              <span className="font-medium">{verdict}</span>
            </p>
          ) : null}
        </div>
      </SectionCard>

      {planning ? (
        <NextMonth
          board={board}
          onClose={() => setPlanning(false)}
          onSaved={id => {
            setPlanning(false);
            setPlanId(id);
          }}
        />
      ) : null}

      {editing ? (
        <PlanEditor
          board={board}
          open
          onClose={() => setEditing(false)}
          onSaved={id => {
            setEditing(false);
            if (id && id !== planId) setPlanId(id);
            else void load(planId);
          }}
        />
      ) : null}

      {(board.groups ?? []).map((g, i) => (
        <Group
          key={g.key}
          label={g.label}
          blurb={g.blurb}
          rows={g.targets}
          order={i + 1}
          ladder={g.key === "front_end"}
        />
      ))}
    </div>
  );
}
