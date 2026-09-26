import { ChevronLeft, ChevronRight, Target } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  button,
  EmptyState,
  Failed,
  page,
  SectionCard,
  SourceNote,
  StatusChip,
  select,
} from "../components/kit";
import { PaceRail } from "../components/NumbersGoals";
import { api } from "../lib/api";
import {
  useDialMonths,
  useGoalRows,
  useMonthCards,
  useNow,
  usePeople,
  useReps,
} from "../lib/data";
import { ago, count, money } from "../lib/format";
import {
  type GoalMetric,
  type GoalRow,
  kuwaitToday,
  METRICS,
  type MonthLine,
  monthKeys,
  monthLines,
  monthWords,
  shiftMonth,
} from "../lib/goals";
import { elapsedWorkingDays, monthEnd, workingDays } from "../lib/pay";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me, Rep, ScoreRow } from "../lib/types";

/**
 * Goals by the month: what each rep is aiming at, where their pace lands,
 * what they said they would do, and the months behind them.
 *
 * A manager sets the goal; the rep (or a manager) puts their own forecast
 * beside it. Actuals are the same as the Numbers page's: B2B's scorecard
 * with voided deals taken out, and Maqsam's outbound dials.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function fmt(metric: GoalMetric, v: number | null): string {
  if (v === null) return "n/a";
  return metric === "cash" ? money(v) : count(Math.round(v));
}

/** The first month any deal was recorded; closes and cash before it are unknown. */
function useFirstDealMonth(): string | null {
  const [m, setM] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase
      .from("cockpit_sales_deals")
      .select("submitted_at")
      .order("submitted_at", { ascending: true })
      .limit(1)
      .then(({ data }) => {
        const at = data?.[0]?.submitted_at as string | undefined;
        if (alive && at) setM(kuwaitToday(Date.parse(at)).slice(0, 7));
      });
    return () => {
      alive = false;
    };
  }, []);
  return m;
}

export default function GoalsPage({ me }: { me: Me }) {
  const now = useNow(60_000);
  const thisMonth = monthKeys(now, 0)[0];
  const [params, setParams] = useSearchParams();
  const asked = params.get("month") ?? "";
  const month =
    MONTH_RE.test(asked) &&
    asked >= shiftMonth(thisMonth, -23) &&
    asked <= shiftMonth(thisMonth, 3)
      ? asked
      : thisMonth;
  const reps = useReps();

  const whose = me.manager
    ? (params.get("rep") ?? "team")
    : (me.b2b_rep_id ?? null);
  const rep =
    whose && whose !== "team"
      ? ((reps.data ?? []).find(r => r.id === whose) ?? null)
      : null;

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null) next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };

  const active = (reps.data ?? [])
    .filter(r => r.is_active)
    .sort((a, b) =>
      String(a.display_name).localeCompare(String(b.display_name)),
    );

  const from = `${month}-01`;
  const total = workingDays(from, monthEnd(from));
  const today = kuwaitToday(now);
  const gone =
    today >= from ? elapsedWorkingDays(from, today, monthEnd(from)) : 0;
  const when =
    month === thisMonth
      ? `${gone} of ${total} working days gone`
      : month < thisMonth
        ? "A finished month"
        : "Not started yet";

  return (
    <main className={page}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Goals</h1>
          <p className="muted mt-1 text-sm">
            {monthWords(month)} · {when}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {me.manager ? (
            <label className="inline-flex items-center gap-2 text-sm">
              <span className="muted">Whose goals</span>
              <select
                value={whose ?? "team"}
                onChange={e =>
                  set("rep", e.target.value === "team" ? null : e.target.value)
                }
                className={select}
              >
                <option value="team">The whole team</option>
                {active.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.display_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div
            className="raised inline-flex items-center rounded-[var(--radius-md)] p-0.5 text-sm"
            role="group"
            aria-label="Month"
          >
            <button
              type="button"
              aria-label="The month before"
              disabled={month <= shiftMonth(thisMonth, -23)}
              onClick={() => set("month", shiftMonth(month, -1))}
              className="rounded-[calc(var(--radius-md)-2px)] p-1.5 disabled:opacity-40"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => set("month", null)}
              className="min-w-32 px-2 py-1 font-medium"
              title="Back to this month"
            >
              {monthWords(month)}
            </button>
            <button
              type="button"
              aria-label="The month after"
              disabled={month >= shiftMonth(thisMonth, 3)}
              onClick={() => set("month", shiftMonth(month, 1))}
              className="rounded-[calc(var(--radius-md)-2px)] p-1.5 disabled:opacity-40"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      {reps.error ? (
        <Failed what="The rep list" error={reps.error} retry={reps.reload} />
      ) : whose === "team" ? (
        <TeamGoals
          month={month}
          now={now}
          reps={active}
          onPick={id => set("rep", id)}
        />
      ) : !whose ? (
        <EmptyState
          icon={Target}
          title="Your goals are not linked yet"
          text="Once Aziz links your seat to your HighLevel user on the Team page, your goals and your months show here."
        />
      ) : rep ? (
        <RepGoals me={me} rep={rep} month={month} now={now} />
      ) : reps.loading ? (
        <p className="muted text-sm">Reading the team…</p>
      ) : (
        <EmptyState
          icon={Target}
          title="That rep is not in the list"
          text="They may have left B2B's rep list. Pick someone else above."
        />
      )}

      <SourceNote>
        Booked, shown, closes and cash are B2B's rep scorecard for each Kuwait
        month, the same one the CEO cockpit reads, with deals voided in B2B
        taken out (B2B's own scorecard still counts them). Dials are outbound
        Maqsam calls from the rep's Maqsam address. A month with no goal of its
        own uses the standing monthly goal on the seat. "On this pace" is what
        was done so far, spread over the month's working days (Friday off).
      </SourceNote>
    </main>
  );
}

// ---------------------------------------------------------------------------
// One rep
// ---------------------------------------------------------------------------

function RepGoals({
  me,
  rep,
  month,
  now,
}: {
  me: Me;
  rep: Rep;
  month: string;
  now: number;
}) {
  const months = monthKeys(now, 11);
  const oldest = months[months.length - 1];
  const rows = useGoalRows(rep.id, oldest < month ? oldest : month);
  const cards = useMonthCards(rep.id);
  const dials = useDialMonths(rep.maqsam_email);
  const people = usePeople();
  const firstDeal = useFirstDealMonth();
  const seat = (people.data ?? []).find(p => p.b2b_rep_id === rep.id) ?? null;
  const standing = seat?.goals?.monthly ?? null;

  const cardOf = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const c of cards.data ?? []) m.set(c.window_key.slice(1), c);
    return m;
  }, [cards.data]);
  const dialsOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dials.data ?? []) m.set(d.month, Number(d.outbound));
    return m;
  }, [dials.data]);
  const firstDial = useMemo(
    () =>
      (dials.data ?? []).reduce<string | null>(
        (a, d) => (a === null || d.month < a ? d.month : a),
        null,
      ),
    [dials.data],
  );

  const dialsFor = (m: string): number | null => {
    if (!rep.maqsam_email) return null;
    if (dialsOf.has(m)) return dialsOf.get(m) ?? null;
    // No row: none that month, once Maqsam's record covers it.
    return firstDial && m >= firstDial ? 0 : null;
  };

  const linesFor = (m: string): MonthLine[] =>
    monthLines({
      month: m,
      nowMs: now,
      card: cardOf.get(m)?.row ?? null,
      dials: dialsFor(m),
      rows: rows.data ?? [],
      standing,
    }).map(l =>
      // Before the first recorded deal, closes and cash are unknown, not zero.
      (l.metric === "closes" || l.metric === "cash") &&
      firstDeal &&
      m < firstDeal
        ? { ...l, actual: null, projected: null, verdict: null }
        : l,
    );

  const lines = linesFor(month);
  const canGoal = Boolean(me.manager);
  const canForecast = Boolean(me.manager) || me.b2b_rep_id === rep.id;
  const card = cardOf.get(month);

  if (rows.error || cards.error)
    return (
      <Failed
        what="The goals"
        error={rows.error ?? cards.error ?? ""}
        retry={() => {
          rows.reload();
          cards.reload();
        }}
      />
    );

  return (
    <>
      <SectionCard
        title={`${rep.display_name ?? "This rep"} in ${monthWords(month)}`}
        side={
          card ? (
            <span className="muted text-xs">
              Scorecard as of {ago(card.computed_at)}
            </span>
          ) : undefined
        }
      >
        <ul className="divide-y hairline">
          {lines.map(l => (
            <GoalLine
              key={l.metric}
              line={l}
              rep={rep.id}
              month={month}
              canGoal={canGoal}
              canForecast={canForecast}
              noDials={l.metric === "dials" && !rep.maqsam_email}
              onSaved={rows.reload}
            />
          ))}
        </ul>
        {canGoal && !(rows.data ?? []).some(r => r.month.startsWith(month)) ? (
          <CopyLastMonth
            rep={rep.id}
            month={month}
            rows={rows.data ?? []}
            onDone={rows.reload}
          />
        ) : null}
      </SectionCard>

      <SectionCard title="The months before" flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="muted text-left text-xs">
                <th className="px-4 py-2 font-medium">Month</th>
                {METRICS.map(m => (
                  <th key={m.key} className="px-3 py-2 text-right font-medium">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y hairline">
              {months
                .filter(m => m < monthKeys(now, 0)[0])
                .map(m => (
                  <tr key={m}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link
                        to={`?rep=${rep.id}&month=${m}`}
                        className="hover:underline"
                      >
                        {monthWords(m, true)}
                      </Link>
                    </td>
                    {linesFor(m).map(l => (
                      <td
                        key={l.metric}
                        className="px-3 py-2 text-right tabular-nums"
                      >
                        <span className={l.actual === null ? "muted" : ""}>
                          {fmt(l.metric, l.actual)}
                        </span>
                        {l.goal !== null && l.actual !== null ? (
                          <span
                            className="block text-xs"
                            style={{
                              color:
                                l.actual >= l.goal
                                  ? "var(--success)"
                                  : "var(--muted-foreground)",
                            }}
                          >
                            {l.actual >= l.goal ? "met" : "of"}{" "}
                            {fmt(l.metric, l.goal)}
                          </span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="muted border-t hairline px-4 py-2 text-xs">
          "n/a" is a month with nothing recorded for them
          {firstDeal
            ? `; closes and cash start in ${monthWords(firstDeal)}, when deals were first recorded`
            : ""}
          .
        </p>
      </SectionCard>
    </>
  );
}

function GoalLine({
  line,
  rep,
  month,
  canGoal,
  canForecast,
  noDials,
  onSaved,
}: {
  line: MonthLine;
  rep: string;
  month: string;
  canGoal: boolean;
  canForecast: boolean;
  noDials: boolean;
  onSaved: () => void;
}) {
  const meta = METRICS.find(m => m.key === line.metric);
  const label = meta?.label ?? line.metric;
  const railLabel =
    line.goal !== null
      ? `${label}: ${fmt(line.metric, line.actual)} of ${fmt(line.metric, line.goal)}`
      : `${label}: ${fmt(line.metric, line.actual)}, no goal`;
  return (
    <li className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-[9rem_1fr_auto] sm:items-center">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {noDials ? (
          <p className="muted mt-1 text-sm">No Maqsam address</p>
        ) : (
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            {fmt(line.metric, line.actual)}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-1.5">
        {line.goal !== null ? (
          <PaceRail
            actual={line.actual}
            goal={line.goal}
            projected={line.projected}
            label={railLabel}
          />
        ) : (
          <div
            className="h-2 rounded-full"
            style={{ background: "var(--secondary)" }}
            aria-hidden
          />
        )}
        <p className="muted flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {line.projected !== null && line.actual !== null ? (
            <span>On this pace {fmt(line.metric, line.projected)}</span>
          ) : null}
          {line.verdict ? (
            <StatusChip tone={line.verdict.tone} label={line.verdict.label} />
          ) : null}
          {line.goalFrom === "standing" ? (
            <span>goal from the seat's standing monthly goal</span>
          ) : null}
        </p>
      </div>
      <div className="flex gap-3 sm:justify-end">
        <NumberField
          label="Goal"
          value={line.goal}
          editable={canGoal}
          money={line.metric === "cash"}
          onSave={v =>
            api("goal.set", {
              rep,
              month,
              metric: line.metric,
              field: "goal",
              value: v,
            }).then(onSaved)
          }
        />
        <NumberField
          label="Forecast"
          value={line.forecast}
          editable={canForecast}
          money={line.metric === "cash"}
          onSave={v =>
            api("goal.set", {
              rep,
              month,
              metric: line.metric,
              field: "forecast",
              value: v,
            }).then(onSaved)
          }
        />
      </div>
    </li>
  );
}

/**
 * A number that saves when you leave the box or press Enter, once: Enter
 * followed by the box losing focus must not save twice (it did, 2026-09-24,
 * two audit rows for one goal), so a save in flight and the last value saved
 * are both remembered.
 */
function NumberField({
  label,
  value,
  editable,
  money: isMoney,
  onSave,
}: {
  label: string;
  value: number | null;
  editable: boolean;
  money?: boolean;
  onSave: (v: string) => Promise<unknown>;
}) {
  const shown = value === null ? "" : String(value);
  const [text, setText] = useState(shown);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const saved = useRef(shown);
  useEffect(() => {
    setText(shown);
    saved.current = shown;
  }, [shown]);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const t = text.replace(/,/g, "").trim();
    if (saving.current || t === saved.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await onSave(t);
      saved.current = t;
      toast.success(t ? `${label} saved.` : `${label} cleared.`);
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
      setText(saved.current);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  if (!editable)
    return (
      <div className="w-24 text-right">
        <p className="muted text-xs">{label}</p>
        <p className="text-sm tabular-nums">
          {value === null ? (
            <span className="muted">Not set</span>
          ) : isMoney ? (
            money(value)
          ) : (
            count(value)
          )}
        </p>
      </div>
    );
  return (
    <form onSubmit={save} className="w-24">
      <label className="block">
        <span className="muted block text-right text-xs">{label}</span>
        <input
          inputMode="decimal"
          value={text}
          aria-busy={busy}
          onChange={e => setText(e.target.value)}
          onBlur={() => void save()}
          placeholder="Not set"
          className="h-8 w-full rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-2 text-right text-sm tabular-nums"
        />
      </label>
    </form>
  );
}

function CopyLastMonth({
  rep,
  month,
  rows,
  onDone,
}: {
  rep: string;
  month: string;
  rows: GoalRow[];
  onDone: () => void;
}) {
  const last = shiftMonth(month, -1);
  const lastGoals = rows.filter(
    r => r.month.startsWith(last) && r.goal !== null,
  );
  const [busy, setBusy] = useState(false);
  if (!lastGoals.length) return null;
  async function copy() {
    setBusy(true);
    try {
      for (const g of lastGoals)
        await api("goal.set", {
          rep,
          month,
          metric: g.metric,
          field: "goal",
          value: g.goal,
        });
      toast.success(`Copied ${monthWords(last)}'s goals.`);
      onDone();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t hairline pt-3">
      <p className="muted text-sm">
        {monthWords(month)} has no goals of its own yet.
      </p>
      <button type="button" disabled={busy} onClick={copy} className={button}>
        {busy ? "Copying…" : `Copy ${monthWords(last, true)}'s goals`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The whole team (managers)
// ---------------------------------------------------------------------------

function TeamGoals({
  month,
  now,
  reps,
  onPick,
}: {
  month: string;
  now: number;
  reps: Rep[];
  onPick: (id: string) => void;
}) {
  const cards = useMonthCards(null, month);
  const rows = useGoalRows(null, month, month);
  const dials = useDialMonths(null, month);
  const people = usePeople();

  if (cards.error || rows.error)
    return (
      <Failed
        what="The team's goals"
        error={cards.error ?? rows.error ?? ""}
        retry={() => {
          cards.reload();
          rows.reload();
        }}
      />
    );

  const cardOf = new Map(
    (cards.data ?? []).map(c => [c.person_key, c.row] as const),
  );
  const dialsOf = new Map(
    (dials.data ?? []).map(d => [d.agent_email, Number(d.outbound)] as const),
  );
  const shown = reps.filter(
    r =>
      cardOf.has(r.id) ||
      (rows.data ?? []).some(g => g.person_key === r.id) ||
      r.ghl_user_id,
  );
  if (!shown.length)
    return (
      <EmptyState
        icon={Target}
        title="No reps to show"
        text="B2B's rep list has nobody active this month."
      />
    );

  return (
    <SectionCard title={`The team in ${monthWords(month)}`} flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="muted text-left text-xs">
              <th className="px-4 py-2 font-medium">Rep</th>
              {METRICS.map(m => (
                <th key={m.key} className="px-3 py-2 text-right font-medium">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y hairline">
            {shown.map(r => {
              const seat = (people.data ?? []).find(p => p.b2b_rep_id === r.id);
              const lines = monthLines({
                month,
                nowMs: now,
                card: cardOf.get(r.id) ?? null,
                dials: r.maqsam_email
                  ? (dialsOf.get(r.maqsam_email.toLowerCase()) ?? 0)
                  : null,
                rows: (rows.data ?? []).filter(g => g.person_key === r.id),
                standing: seat?.goals?.monthly ?? null,
              });
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => onPick(r.id)}
                      className="text-left font-medium hover:underline"
                    >
                      {r.display_name}
                    </button>
                    <span className="muted block text-xs">
                      {r.role === "setter"
                        ? "Setter"
                        : r.role === "both"
                          ? "Setter and closer"
                          : "Closer"}
                    </span>
                  </td>
                  {lines.map(l => (
                    <td
                      key={l.metric}
                      className="px-3 py-2 text-right tabular-nums"
                    >
                      <span className={l.actual === null ? "muted" : ""}>
                        {fmt(l.metric, l.actual)}
                      </span>
                      {l.goal !== null ? (
                        <span className="muted block text-xs">
                          of {fmt(l.metric, l.goal)}
                        </span>
                      ) : null}
                      {l.verdict ? (
                        <span className="mt-0.5 inline-block">
                          <StatusChip
                            tone={l.verdict.tone}
                            label={l.verdict.label}
                          />
                        </span>
                      ) : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted border-t hairline px-4 py-2 text-xs">
        Pick a name to set their goals and see their months.
      </p>
    </SectionCard>
  );
}
