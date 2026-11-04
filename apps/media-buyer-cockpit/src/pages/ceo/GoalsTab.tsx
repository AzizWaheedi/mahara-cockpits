import { CalendarPlus, Loader2, Pencil, Target } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import {
  capitalize,
  count,
  pct,
  plural,
  shortDate,
} from "@/components/ceo/format";
import { KICKER } from "@/components/ceo/Kicker";
import { Na } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip, StatusDot } from "@/components/ceo/StatusChip";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { api, useAction } from "@/lib/cockpitApi";
import { BOOKING_RATE_GATE } from "@/lib/kpi";
import { cn } from "@/lib/utils";
import { qualifiedIntroShare } from "@/types/ceo/costsModel";
import type { Board, TargetRow } from "@/types/ceo/goals";
import { PlanEditor } from "./goalsEdit";
import { fmt, PaceBar, paceTone, planName, worstThree } from "./goalsKit";
import { NextMonth } from "./goalsNext";
import { GoalsSheet } from "./goalsSheet";
import { show } from "./goalsSheetCells";
import {
  boardLabelOf,
  COLUMN_BY_KEY,
  RETIRED_SHEET_KEYS,
  type SheetColumn,
} from "./goalsSheetModel";
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
 * pace mark is the one number that broke, which is exactly the question the
 * plan says the daily review has to answer.
 *
 * Every other part of the business is a list of the same rows, grouped the
 * way Aziz groups them: the back end, the money, the client standard, the
 * call centre, content, creative, systems and the team. The call centre is a
 * short ladder of its own (Aziz, 2026-10-02: "call centers' main metric
 * should be lead to booking"), with the same rate client by client under it.
 *
 * Aziz, 2026-11-02: "Remove all the other metrics that aren't in the example
 * spreadsheet I gave." The metrics the sheet retired (RETIRED_SHEET_KEYS) are
 * not listed here either, nor named in the verdict. Their targets stay on the
 * plan, and AOV still reads on the ladder, where closed deals turn into
 * contracted revenue.
 *
 * And: "make this one the main source of truth so everything else ties into
 * it." Every number the sheet below has is the sheet's own roll-up for the
 * plan's days, its pace and its reasons (lib/ceoGoalsModel.ts), written the
 * way the sheet writes it, so the two never show two figures for one metric.
 */

type LadderRung = { key: string; into?: { key: string; label: string } };

/** The rungs of the front-end ladder, in funnel order, with the rate between them. */
const LADDER: LadderRung[] = [
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

/** The call centre's ladder: client leads, the rate they book at, the bookings. */
const CALL_LADDER: LadderRung[] = [
  { key: "callLeads", into: { key: "callLeadToBooking", label: "book at" } },
  { key: "callBookings" },
];

const LADDERS: Record<string, LadderRung[]> = {
  front_end: LADDER,
  calls: CALL_LADDER,
};

/**
 * A target row with the sheet's column behind it, when the sheet answers it
 * (2026-11-02): the model hands the column over for every such row, a metric
 * added on the sheet and an older key ("Software and overhead") included.
 */
type BoardRow = TargetRow & { column?: SheetColumn };

/**
 * A number as the sheet writes it, for a row the sheet has (2026-11-02): a
 * rate to a tenth of a point (35.9%, not 36%), an average to one decimal, so
 * the board and the sheet under it read the same figure. Any other row is
 * written as before.
 */
function shown(
  v: number | null | undefined,
  t: Pick<BoardRow, "metricKey" | "unit" | "column">,
): string {
  const c = t.column ?? COLUMN_BY_KEY[t.metricKey];
  if (!c || v === null || v === undefined || !Number.isFinite(v))
    return fmt(v, t.unit);
  return show(v, c);
}

/**
 * How far off pace, in the row's own figures, or null when it is on pace or
 * not judged. The verdict is the sheet's Colour row (2026-11-02), so a row can
 * be behind by less than the last digit the sheet writes (35.9996% against
 * 36% is yellow there, no close yet against 0.3 by now is red): that reads
 * "Under target" or "Behind pace", never "0% under" or "0 behind".
 */
function behindWords(t: BoardRow): string | null {
  if (t.onPace !== false) return null;
  const words =
    t.direction === "down"
      ? `over ${t.level ? "target" : "pace"}`
      : t.level
        ? "under target"
        : "behind pace";
  const off =
    t.actual === null || t.pacedTarget === null
      ? null
      : t.direction === "up"
        ? t.pacedTarget - t.actual
        : t.actual - t.pacedTarget;
  if (off === null || !(off > 0)) return capitalize(words);
  const amount = shown(off, t);
  return /[1-9]/.test(amount) ? `${amount} ${words}` : capitalize(words);
}

function Row({
  t,
  compact,
  worst,
}: {
  t: BoardRow;
  compact?: boolean;
  /** The three the verdict names; only these can turn red. */
  worst?: ReadonlySet<string>;
}) {
  // Said only when the verdict says behind: the sheet's Colour is the verdict
  // (2026-11-02), and the gap is written in the row's own figures.
  const behind = behindWords(t);
  const tone = paceTone(t, worst);
  return (
    <div className="grid gap-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-medium">{t.label}</span>
        <span className="tabular-nums text-sm">
          {t.actual === null ? (
            <Na hint={t.sourceText} />
          ) : (
            <span>{shown(t.actual, t)}</span>
          )}
          <span className="text-muted-foreground">
            {` of ${shown(t.target, t)}`}
            {t.stretch !== null ? `, ${shown(t.stretch, t)} stretch` : ""}
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
        tone={tone === "critical" ? "critical" : "warning"}
        label={`${t.label}: ${shown(t.actual, t)} against a target of ${shown(t.target, t)}${behind ? `, ${behind}` : t.onPace ? ", on pace" : ""}`}
      />
      {compact ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {behind ? (
            <StatusChip
              tone={tone === "critical" ? "critical" : "warning"}
              label={behind}
            />
          ) : t.onPace ? (
            <StatusChip tone="good" label="On pace" />
          ) : null}
          {t.baseline !== null ? (
            <span>{`Was ${shown(t.baseline, t)}`}</span>
          ) : null}
          {t.source === "typed" ? <span>Typed in</span> : null}
          {/* Nothing recorded: the n/a beside the target already says so. */}
          {t.note ? <span className="basis-full">{t.note}</span> : null}
        </div>
      )}
    </div>
  );
}

function Ladder({
  spec,
  rows,
  worst,
}: {
  spec: LadderRung[];
  rows: BoardRow[];
  worst: ReadonlySet<string>;
}) {
  const by = new Map(rows.map(r => [r.metricKey, r]));
  const rungs = spec.filter(l => by.has(l.key));
  if (!rungs.length) return null;
  return (
    <ol className="grid">
      {rungs.map((l, i) => {
        const t = by.get(l.key) as BoardRow;
        const into = l.into ? by.get(l.into.key) : undefined;
        return (
          <li key={l.key} className={i ? "border-t" : ""}>
            <Row t={t} worst={worst} />
            {/* The rate into the next rung, in words. Its own row further
                down carries the verdict, so this line carries no chip. */}
            {into ? (
              <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 pb-3 text-xs text-muted-foreground">
                <span>{capitalize(l.into?.label ?? "")}</span>
                <span className="font-medium text-foreground tabular-nums">
                  {shown(into.actual, into)}
                </span>
                <span>{`against ${shown(into.target, into)}`}</span>
              </p>
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
  worst,
  extra,
}: {
  label: string;
  blurb: string;
  rows: BoardRow[];
  order: number;
  ladder?: LadderRung[];
  worst: ReadonlySet<string>;
  /** Anything the group shows under its rows. */
  extra?: ReactNode;
}) {
  const inLadder = new Set((ladder ?? []).map(l => l.key));
  const drawn = ladder?.some(l => rows.some(r => r.metricKey === l.key));
  // The ladder reads every row (AOV is its "at an average of"); the list
  // under it leaves the retired ones out.
  const rest = (
    drawn ? rows.filter(r => !inLadder.has(r.metricKey)) : rows
  ).filter(r => !RETIRED_SHEET_KEYS.has(r.metricKey));
  if (!drawn && !rest.length && !extra) return null;
  return (
    <SectionCard title={label} description={blurb || undefined} order={order}>
      <div className="grid">
        {ladder && drawn ? (
          <Ladder spec={ladder} rows={rows} worst={worst} />
        ) : null}
        {rest.length ? (
          <div className={`grid ${drawn ? "mt-4 border-t pt-2" : ""}`}>
            {rest.map((t, i) => (
              <div key={t.id} className={i ? "border-t" : ""}>
                <Row t={t} worst={worst} />
              </div>
            ))}
          </div>
        ) : null}
        {extra}
      </div>
    </SectionCard>
  );
}

/**
 * The call centre's lead to booking client by client, most leads first,
 * against the plan's target (or the 25% client booking line when the plan
 * has none). "Depending on client results": the overall rate is these rows,
 * and the clients under the line are the ones moving it.
 */
function ByClient({
  clients,
  target,
  measured,
}: {
  clients: Board["callClients"];
  target: number | null;
  measured: Record<string, number>;
}) {
  const [all, setAll] = useState(false);
  if (!clients?.length) return null;
  const line = target ?? BOOKING_RATE_GATE / 100;
  const listed = all ? clients : clients.slice(0, 6);
  const under = clients.filter(c => c.rate !== null && c.rate < line).length;
  const overall = measured.callLeadToBooking;
  return (
    <div className="mt-4 grid gap-2 border-t pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={KICKER}>Lead to booking by client</span>
        <span className="text-xs text-muted-foreground">
          {`${under} of ${clients.length} under ${pct(line)}${target === null ? ", the client booking line" : ""}`}
        </span>
      </div>
      {target === null && overall !== undefined ? (
        <p className="text-sm">
          {`${shown(overall, { metricKey: "callLeadToBooking", unit: "rate" })} overall: ${count(measured.callBookings)} bookings from ${count(measured.callLeads)} new client leads. This plan has no target for it yet.`}
        </p>
      ) : null}
      <ul className="grid">
        {listed.map(c => (
          <li
            key={c.name}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 py-1 text-sm"
          >
            <span className="truncate" dir="auto">
              {c.name}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {`${count(c.bookings)} of ${count(c.leads)}`}
            </span>
            <span className="inline-flex items-center justify-end gap-1.5 font-medium tabular-nums">
              {c.rate !== null && c.rate < line ? (
                <StatusDot tone="warning" label="Under the line" />
              ) : null}
              {pct(c.rate)}
            </span>
          </li>
        ))}
      </ul>
      {clients.length > 6 ? (
        <button
          type="button"
          className="justify-self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setAll(v => !v)}
        >
          {all ? "Show fewer" : `Show all ${clients.length}`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * What the plan is behind on, worst first, as the board's own list ranks it
 * (the gap against the paced target), without the retired metrics. Read from
 * every row, so "and 4 more" counts them all.
 */
function behindNow(groups: Board["groups"]): { label: string }[] {
  return (
    (groups ?? [])
      .flatMap(g => g.targets)
      // The stored order (group, sort, id), so ties rank as the board's own list does.
      .sort(
        (a, b) =>
          a.groupKey.localeCompare(b.groupKey) ||
          a.sort - b.sort ||
          a.id - b.id,
      )
      .filter(t => t.onPace === false && !RETIRED_SHEET_KEYS.has(t.metricKey))
      .map(t => ({
        label: t.label,
        gap:
          t.pacedTarget && t.actual !== null
            ? Math.abs(t.actual - t.pacedTarget) / Math.abs(t.pacedTarget)
            : 0,
      }))
      .sort((a, b) => b.gap - a.gap)
  );
}

/**
 * A row named as the sheet names it (2026-11-02). The label stored on a
 * target row is the one it was saved under: "Total new cash" on the plan's
 * revenue goal, "CAC", "Software expenses", "Software and overhead". The sheet
 * now gives Total new cash to the Cash collected mirror and calls those CPA
 * and Overhead expenses, so the stored name put one name on two numbers on the
 * same page. The column is the one the model read the number from (`columns`,
 * the board's sheetColumns), so a metric added on the sheet and an older key
 * are named and written as the sheet has them too. A row the sheet does not
 * have keeps its own.
 */
function asOnSheet(
  t: TargetRow,
  columns: Record<string, SheetColumn>,
): BoardRow {
  const c = columns[t.metricKey] ?? COLUMN_BY_KEY[t.metricKey];
  return c ? { ...t, label: boardLabelOf(c), column: c } : t;
}

/** A name inside a sentence: "Intro show rate" reads "intro show rate", "CPA" stays. */
function inSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label)
    ? `${label.charAt(0).toLowerCase()}${label.slice(1)}`
    : label;
}

/**
 * The creative group once its old rows are retired (2026-11-02): his one
 * creative number lives on the sheet until it has a target here.
 */
function CreativePointer({ rows }: { rows: TargetRow[] }) {
  if (rows.some(r => !RETIRED_SHEET_KEYS.has(r.metricKey))) return null;
  return (
    <p className="text-sm text-muted-foreground">
      Videos completed is typed day by day on the monthly sheet above, under
      Creative. Give it a target on the sheet's Target row to score it here.
    </p>
  );
}

/** The event cockpitApi's refreshAfter sends after every write (src/lib/cockpitApi.ts). */
const DATA_CHANGED = "cockpit-data-changed";
/** Saves typed in a run (Enter, Enter, Enter) make one re-read, not three. */
const REFRESH_AFTER_MS = 400;

/** LIVE, DRAFT or CLOSED in the brand's badge: mono capitals, a teal dot when live. */
function PlanBadge({ status }: { status: string }) {
  const live = status === "live";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-full border px-2 font-mono text-[11px] font-normal uppercase leading-none tracking-[0.08em]",
        live
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          live ? "bg-primary" : "bg-muted-foreground/60",
        )}
      />
      {status}
    </span>
  );
}

export function GoalsTab({ sections, goTab }: CeoTabProps) {
  const growth = sections.growth?.payload ?? null;
  const qualified = useMemo(
    () => qualifiedIntroShare([growth?.windows.lastMonth, growth?.windows.mtd]),
    [growth],
  );
  const read = useAction(api.ceo.goals.board);
  const [board, setBoard] = useState<Board | null>(null);
  const [planId, setPlanId] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [planning, setPlanning] = useState(false);

  // A background re-read that failed: the board stays, and says so.
  const [stale, setStale] = useState<string | null>(null);
  // The board on screen and the plan chosen, for the quiet re-read.
  const shownBoard = useRef<Board | null>(null);
  shownBoard.current = board;
  const chosen = useRef(planId);
  chosen.current = planId;
  // Only the newest read lands, so a slow one never overwrites a newer plan.
  const reads = useRef(0);

  const load = useCallback(
    async (id?: number, quiet = false) => {
      const mine = ++reads.current;
      setBusy(true);
      if (!quiet) setError(null);
      try {
        const next = (await read({
          planId: id,
          // A save on the sheet cannot change the call centre's numbers:
          // hand the report back instead of reading the slow report again
          // (2026-11-02). It is used only if it covers the same days.
          calls: quiet ? (shownBoard.current?.calls ?? null) : null,
        })) as Board;
        if (mine !== reads.current) return;
        setBoard(next);
        setStale(null);
        setError(null);
      } catch (e) {
        if (mine !== reads.current) return;
        const why = String(e instanceof Error ? e.message : e).slice(0, 300);
        // A quiet re-read keeps the numbers already on screen.
        if (quiet && shownBoard.current) setStale(why);
        else setError(why);
      } finally {
        if (mine === reads.current) setBusy(false);
      }
    },
    [read],
  );

  // The action identity changes on every render, so only the chosen plan is
  // allowed to retrigger this.
  useEffect(() => {
    void load(planId);
  }, [planId, load]);

  // The board reads the sheet (2026-11-02), so a number typed on the sheet
  // below changes it. Every save in the app sends DATA_CHANGED (cockpitApi's
  // refreshAfter, the same signal useQuery refreshes on), and the sheet calls
  // onChanged after a target: either way one quiet re-read follows, a moment
  // after the last save, with the call report handed back.
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (soon.current !== null) clearTimeout(soon.current);
    soon.current = setTimeout(() => {
      soon.current = null;
      void load(chosen.current, true);
    }, REFRESH_AFTER_MS);
  }, [load]);
  useEffect(() => {
    window.addEventListener(DATA_CHANGED, refresh);
    return () => {
      window.removeEventListener(DATA_CHANGED, refresh);
      if (soon.current !== null) clearTimeout(soon.current);
    };
  }, [refresh]);

  // Every row named as the sheet names it, so the verdict, the red three and
  // the lists below all say the same name.
  const groups = useMemo(() => {
    const columns: Record<string, SheetColumn> = board?.sheetColumns ?? {};
    return (board?.groups ?? []).map(g => ({
      ...g,
      targets: g.targets.map(t => asOnSheet(t, columns)),
    }));
  }, [board]);
  const behind = useMemo(() => behindNow(groups), [groups]);
  const verdict = useMemo(() => {
    if (!board?.plan) return null;
    if (!behind.length) return "Everything with a number on it is on pace.";
    const names = behind.map(b => inSentence(b.label));
    return `Behind on ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}.`;
  }, [board, behind]);

  if (busy && !board)
    return (
      <SectionCard title="This month's plan" order={0}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Reading the plan
        </p>
      </SectionCard>
    );

  if (error)
    return (
      <SectionCard title="The plan could not be read" order={0}>
        <p className="text-sm text-muted-foreground">{error}</p>
      </SectionCard>
    );

  if (!board?.plan)
    return (
      <div className="grid gap-4 lg:gap-6">
        <SectionCard title="This month's plan" order={0}>
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
  const worst = worstThree(behind);
  // One line under the title: the period, how far into it we are, and the
  // newest day the numbers cover.
  const period = [
    `${shortDate(p.periodFrom)} to ${shortDate(p.periodTo)}`,
    pace
      ? `working day ${count(pace.workedSoFar)} of ${count(pace.workingDays)}, ${plural(pace.daysLeft, "day")} left`
      : null,
    pace ? `numbers run to ${shortDate(pace.through)}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="@container grid gap-4 lg:gap-6">
      <SectionCard
        title={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {planName(p.title)}
            <PlanBadge status={p.status} />
          </span>
        }
        description={`${period.charAt(0).toUpperCase()}${period.slice(1)}.`}
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
              <AnimatedSelect
                aria-label="Which plan"
                className="ceo-select-sm max-w-56"
                value={String(p.id)}
                onChange={e => setPlanId(Number(e.target.value))}
              >
                {(board.plans ?? []).map(x => (
                  <option key={x.id} value={x.id}>
                    {`${planName(x.title)}${x.status === "draft" ? " (draft)" : ""}`}
                  </option>
                ))}
              </AnimatedSelect>
            ) : null}
            {/* Toggles: pressed while their card is open below, and each of
                those cards carries its own Close. */}
            <Button
              variant="outline"
              size="sm"
              aria-pressed={planning}
              className={cn(planning && "bg-accent text-accent-foreground")}
              onClick={() => {
                setPlanning(v => !v);
                setEditing(false);
              }}
            >
              <CalendarPlus aria-hidden />
              Plan next month
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={editing}
              className={cn(editing && "bg-accent text-accent-foreground")}
              onClick={() => {
                setEditing(v => !v);
                setPlanning(false);
              }}
            >
              <Pencil aria-hidden />
              Edit this plan
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          {p.mission ? <p className="text-base">{p.mission}</p> : null}
          {p.headline ? (
            <p className="text-sm text-muted-foreground">{p.headline}</p>
          ) : null}
          {verdict ? <p className="text-sm font-medium">{verdict}</p> : null}
          {stale ? (
            <p className="text-xs text-muted-foreground">
              {`Not refreshed after the last change: ${stale.replace(/\.$/, "")}. These are the numbers from the read before; reload the page to try again.`}
            </p>
          ) : null}
        </div>
      </SectionCard>

      {planning ? (
        <NextMonth
          board={board}
          qualifiedIntroShare={qualified?.share ?? null}
          onCosts={() => goTab("costs")}
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

      <GoalsSheet onChanged={refresh} />

      {groups.map((g, i) => (
        <Group
          key={g.key}
          label={g.label}
          blurb={g.blurb}
          rows={g.targets}
          order={i + 1}
          ladder={LADDERS[g.key]}
          worst={worst}
          extra={
            g.key === "calls" ? (
              <ByClient
                clients={board.callClients ?? null}
                target={
                  g.targets.find(t => t.metricKey === "callLeadToBooking")
                    ?.target ?? null
                }
                measured={board.measured ?? {}}
              />
            ) : g.key === "creative" ? (
              <CreativePointer rows={g.targets} />
            ) : null
          }
        />
      ))}
    </div>
  );
}
