import { Target } from "lucide-react";
import { Link } from "react-router";
import { count, money, num } from "../lib/format";
import {
  dayWords,
  elapsedWorkingDays,
  GOAL_FIELDS,
  goalActual,
  goalPeriod,
  paceVerdict,
  projection,
  rangeWords,
  workingDays,
} from "../lib/pay";
import type { Goals, Scorecard, WindowKey } from "../lib/types";
import { EmptyState, SectionCard, StatusChip } from "./kit";

/**
 * Each goal against the period's pace: the pace rail.
 *
 * The rail is the one picture on the Numbers page. The teal fill is what is
 * done; the hatched run beyond it is where this pace lands by the end of the
 * period (hatched, as the day line hatches what has not happened yet); the
 * upright hairline is the goal. Past the hairline is past the goal. The
 * chip says the verdict in words, so the colour is never the only signal.
 */

const HATCH =
  "repeating-linear-gradient(135deg, color-mix(in oklch, var(--primary) 50%, transparent) 0 3px, color-mix(in oklch, var(--primary) 14%, transparent) 3px 6px)";

export function PaceRail({
  actual,
  goal,
  projected,
  label,
}: {
  actual: number | null;
  goal: number;
  projected: number | null;
  label: string;
}) {
  const a = Math.max(0, actual ?? 0);
  const p = projected === null ? null : Math.max(0, projected);
  const scale = Math.max(goal, a, p ?? 0) || 1;
  const at = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <div
      role="img"
      aria-label={label}
      className="relative h-2 rounded-full"
      style={{ background: "var(--secondary)" }}
    >
      {p !== null && p > a ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: at(p), background: HATCH }}
        />
      ) : null}
      {a > 0 ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: at(a), background: "var(--primary)" }}
        />
      ) : null}
      <span
        aria-hidden
        className="absolute -top-1 -bottom-1 w-0.5 rounded-full"
        style={{
          left: `calc(${at(goal)} - 1px)`,
          background: "var(--foreground)",
        }}
      />
    </div>
  );
}

function Legend() {
  return (
    <div className="muted flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2 w-4 rounded-full"
          style={{ background: "var(--primary)" }}
        />
        So far
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-2 w-4 rounded-full"
          style={{ background: HATCH }}
        />
        On this pace
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-3 w-0.5 rounded-full"
          style={{ background: "var(--foreground)" }}
        />
        Goal
      </span>
    </div>
  );
}

export function NumbersGoals({
  windowKey,
  fromDay,
  today,
  card,
  goals,
  outboundDials,
  hasMaqsam,
  team,
  whose,
  onWindow,
}: {
  windowKey: WindowKey;
  /** The window's first day, from the scorecard row. */
  fromDay: string;
  /** Today in Kuwait. */
  today: string;
  card: Scorecard | null;
  goals: Goals | null;
  outboundDials: number | null;
  hasMaqsam: boolean;
  team: boolean;
  whose: "your" | "their";
  onWindow: (w: WindowKey) => void;
}) {
  if (team)
    return (
      <SectionCard title="Goals">
        <p className="muted text-sm">
          Goals are set per person. Choose someone above to see their pace.
        </p>
      </SectionCard>
    );

  const has = (kind: "weekly" | "monthly") =>
    GOAL_FIELDS.some(f => (num(goals?.[kind]?.[f.key]) ?? 0) > 0);
  if (!has("weekly") && !has("monthly"))
    return (
      <SectionCard title="Goals">
        <EmptyState
          compact
          icon={Target}
          title="No goals set yet"
          text={
            whose === "your" ? (
              "Aziz sets weekly and monthly goals on the Team page."
            ) : (
              <>
                Set weekly and monthly goals on the{" "}
                <Link to="/team" className="underline underline-offset-2">
                  Team page
                </Link>
                .
              </>
            )
          }
        />
      </SectionCard>
    );

  const period = goalPeriod(windowKey, fromDay);
  if (!period)
    return (
      <SectionCard title="Goals">
        <p className="muted text-sm">
          Goals are weekly and monthly. Choose a window to see the pace.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onWindow("week")}
            className="rounded-full border hairline px-3 py-1 text-xs font-medium hover:bg-[color:var(--secondary)]"
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => onWindow("month")}
            className="rounded-full border hairline px-3 py-1 text-xs font-medium hover:bg-[color:var(--secondary)]"
          >
            This month
          </button>
        </div>
      </SectionCard>
    );

  const set = goals?.[period.kind] ?? {};
  const rows = GOAL_FIELDS.map(f => ({
    ...f,
    goal: num(set[f.key]) ?? 0,
  })).filter(f => f.goal > 0);
  const other = period.kind === "weekly" ? "monthly" : "weekly";

  const total = workingDays(period.from, period.to);
  const elapsed = elapsedWorkingDays(period.from, today, period.to);
  const finished = today > period.to;

  return (
    <SectionCard
      title={period.kind === "weekly" ? "Weekly goals" : "Monthly goals"}
      side={
        <span className="muted text-xs">
          {finished ? "Finished" : `Working day ${elapsed} of ${total}`}
        </span>
      }
    >
      {rows.length ? (
        <>
          <Legend />
          <ul className="mt-1 divide-y hairline">
            {rows.map(f => {
              const actual = goalActual(f.key, card, outboundDials);
              const projected = projection(actual, elapsed, total);
              const verdict = paceVerdict(actual, f.goal, projected, finished);
              const show = (v: number | null) =>
                v === null ? "n/a" : f.money ? money(v) : count(Math.round(v));
              const noDials = f.key === "dials" && !hasMaqsam;
              return (
                <li key={f.key} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="text-sm font-medium">{f.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-sm">
                        {show(actual)}
                        <span className="muted"> of {show(f.goal)}</span>
                      </span>
                      {verdict ? (
                        <StatusChip tone={verdict.tone} label={verdict.label} />
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-2.5">
                    <PaceRail
                      actual={actual}
                      goal={f.goal}
                      projected={finished ? null : projected}
                      label={`${f.label}: ${show(actual)} of ${show(f.goal)}${
                        projected !== null && !finished
                          ? `, on this pace ${show(projected)}`
                          : ""
                      }${verdict ? `, ${verdict.label.toLowerCase()}` : ""}`}
                    />
                  </div>
                  <p className="muted mt-2 text-xs">
                    {noDials
                      ? "Dials count once the seat has a Maqsam email."
                      : actual === null
                        ? "Not known for this window yet."
                        : finished
                          ? `Ended at ${show(actual)}.`
                          : projected !== null
                            ? `On this pace, ${show(projected)} by ${dayWords(period.to)}.`
                            : "The pace shows from the first working day."}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="muted mt-1 text-xs">
            {rangeWords(period.from, period.to)}. On this pace = so far ÷
            working days so far (today included) × working days in the period.
            Saturday to Thursday are working days; Friday is off.
          </p>
        </>
      ) : (
        <p className="muted text-sm">
          No {period.kind} goals set.
          {has(other) ? (
            <>
              {" "}
              The {other} goals show on{" "}
              <button
                type="button"
                onClick={() => onWindow(other === "weekly" ? "week" : "month")}
                className="no-touch underline underline-offset-2"
              >
                {other === "weekly" ? "This week" : "This month"}
              </button>
              .
            </>
          ) : null}
        </p>
      )}
    </SectionCard>
  );
}
