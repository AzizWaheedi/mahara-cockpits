import { ChevronRight, Headset, Play, X } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Chip, Dot, Kicker, Pill, StatTile, type Tone } from "@/components/kit";
import { ResultsSection } from "@/components/ResultsLayout";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  assignedCallers,
  CALL_RULES,
  type CallCentre,
  type CallCentreSummary,
  type CallCentreVerdict,
  type CallRow,
  callCentreVerdict,
  calledLines,
  formatCallLength,
  formatDuration,
  formatPerLead,
  formatRate,
  lostLabel,
  NOT_MEASURED,
  type RowFlag,
  rate,
  rowFlag,
  summarize,
} from "@/lib/callCentre";
import {
  type Caller,
  type CallersState,
  type CallRange,
  type CallsState,
  callerNames,
  callRange,
  playCall,
  rangeLabel,
  reportDidNotAnswer,
  rowRates,
  useClientCalls,
} from "@/lib/callCentreClient";
import type { RecordingResult } from "@/lib/callRecording";
import {
  BOOKING_RATE_GATE,
  CONVERSATION_GATE,
  FOLLOW_UP_ATTEMPTS,
  REACHED_GATE,
} from "@/lib/kpi";
import { dayLabel, kuwaitDay } from "@/lib/reportPeriod";
import { cn } from "@/lib/utils";

/**
 * The Calls part of a client's Results tab (Aziz, 2026-10-13: "is this a call
 * center issue or is it not? ... where we can actually listen to the calls
 * ... see why exactly the leads were lost ... Don't make it too busy").
 *
 * The first screen answers the question: the verdict, four tiles and the
 * path a lead takes from arriving to showing, with the leads nobody called
 * drawn as the gap. Campaigns and ads, who is waiting, why leads were lost
 * (with the longest call to play) and where the numbers come from follow.
 *
 * Every number and sentence comes from lib/callCentre.ts, the same file the
 * media buyer cockpit reads; nothing is worked out again here. Missing is
 * never zero: a rate with nothing under it reads "Not measured".
 */

const TONES: Record<CallCentreVerdict["tone"], Tone> = {
  bad: "bad",
  watch: "warn",
  good: "good",
  muted: "neutral",
};

/** Campaigns or ads shown before "Show the other N". */
export const TABLE_SHOWN = 8;
/** Lost leads shown before "Show the other N". */
export const LOST_SHOWN = 5;

const NUMBER = new Intl.NumberFormat("en-US");
const count = (n: number | null | undefined) =>
  n === null || n === undefined ? NOT_MEASURED : NUMBER.format(n);

const STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuwait",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "13 Oct, 16:25" in Kuwait time, or "Not measured". */
export function kuwaitStamp(iso: string | null | undefined): string {
  if (!iso) return NOT_MEASURED;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NOT_MEASURED;
  // Built from parts: engines join day and time differently ("," or "at").
  const part = Object.fromEntries(
    STAMP.formatToParts(d).map(p => [p.type, p.value]),
  );
  return `${part.day} ${part.month}, ${part.hour}:${part.minute}`;
}

/**
 * The Kuwait day of a moment, as "9 Oct". A timestamp's own first ten
 * characters are its UTC day, a day early between midnight and 03:00 in
 * Kuwait.
 */
export function kuwaitDayLabel(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? "an unknown day" : dayLabel(kuwaitDay(t));
}

/** Days in a stage: "under a day", "12 d". */
export function stageDays(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days))
    return NOT_MEASURED;
  return days < 1 ? "under a day" : `${Math.round(days)} d`;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${NUMBER.format(n)} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// What the view shows, worked out from the read (tested in
// scripts/call-centre-section.test.tsx).

export type PathStep = {
  key: "leads" | "called" | "answered" | "talked" | "booked" | "showed";
  label: string;
  count: number;
  /** Of the period's leads, in %; null with no leads. */
  share: number | null;
  /** How far the bar reaches: never past the step before it. */
  width: number;
};

/**
 * Leads, called, answered, booked and showed are the dialer's own report;
 * talked 2 min+ follows the same leads through every verified call.
 */
export function callPath(
  data: CallCentre,
): { steps: PathStep[]; notCalled: number } | null {
  const o = data.official;
  if (!o) return null;
  const raw: [PathStep["key"], string, number][] = [
    ["leads", "Leads", o.leads],
    ["called", "Called", o.leadsDialed],
    ["answered", "Answered", o.leadsContacted],
    ["talked", "Talked 2 min+", data.cohort.talked120],
    ["booked", "Booked", o.confirmedBookings],
    ["showed", "Showed", o.shows],
  ];
  let reach = 100;
  const steps = raw.map(([key, label, n]) => {
    const share = rate(n, o.leads);
    reach = Math.min(reach, Math.max(0, share ?? 0));
    return { key, label, count: n, share, width: reach };
  });
  return { steps, notCalled: o.noVerifiedDial };
}

/** Anything a person should act on now: it opens "Waiting now". */
export function somethingWaits(data: CallCentre): boolean {
  const w = data.waiting;
  return (
    w.untouched.count > 0 ||
    w.callbacks.overThreeDays > 0 ||
    w.callbacks.overdue > 0 ||
    w.missedInbound.never > 0
  );
}

const FLAG_TONES: Record<RowFlag["kind"], Tone> = {
  below: "warn",
  not_called: "warn",
  above: "good",
  even: "neutral",
  too_few: "neutral",
};

export type TableRow = {
  key: string;
  name: string;
  /** The campaign an ad runs in. */
  under: string | null;
  leads: number;
  called: number | null;
  dials: number;
  dialsPerLead: number | null;
  answered: number | null;
  booked: number | null;
  firstCall: number | null;
  flag: RowFlag;
  tone: Tone;
  /** Said under the name: a row below or above the client, or not called. */
  speaks: boolean;
};

/** One campaign or ad as the table reads it, judged against the client. */
export function tableRow(
  row: CallRow,
  by: "campaign" | "ad",
  client: CallRow | null,
): TableRow {
  const flag = rowFlag(row, client);
  const rates = rowRates(row);
  const fallback = by === "ad" ? "Unnamed ad" : "Unnamed campaign";
  return {
    key: `${by}:${row.id ?? row.name ?? ""}`,
    name:
      row.name ??
      (row.id ? `${by === "ad" ? "Ad" : "Campaign"} ${row.id}` : fallback),
    under: by === "ad" ? row.campaignName : null,
    leads: row.leads,
    called: rates.calledRate,
    dials: row.dials,
    dialsPerLead: rates.dialsPerLead,
    answered: rates.answeredRate,
    booked: rates.bookedRate,
    firstCall: row.medianFirstCallSeconds,
    flag,
    tone: FLAG_TONES[flag.kind],
    speaks:
      flag.kind === "below" ||
      flag.kind === "above" ||
      flag.kind === "not_called",
  };
}

/** The dialer marked a lead lost in these dates: "Why leads were lost" has rows. */
export function hasLost(data: CallCentre): boolean {
  const l = data.lost;
  return l.total > 0 || l.reasons.length > 0 || l.latest.length > 0;
}

/**
 * The part shows why leads were lost in the dialer, so the page can leave
 * its own GoHighLevel list to the Ads tab. Not while loading, on an error,
 * for a done-with-you client, or when the dialer marked nobody lost: the
 * page then keeps its list, so Results never goes without lost reasons.
 */
export function showsLost(state: CallsState): boolean {
  return (
    state.status === "ready" &&
    callCentreVerdict(state.data).kind !== "client_calls" &&
    hasLost(state.data)
  );
}

// ---------------------------------------------------------------------------
// The container: the page's dates, the read and the player.

export function CallCentreSection({
  taskId,
  from,
  to,
  lostElsewhereHref,
  onLostShown,
}: {
  /** The client's ClickUp task id, the read's key. */
  taskId?: string;
  /** The page's reporting period; the last 30 days without one. */
  from?: string;
  to?: string;
  /** Where the GoHighLevel lost list lives while this part shows lost reasons. */
  lostElsewhereHref?: string;
  /** Told whether this part shows lost reasons now (see showsLost). */
  onLostShown?: (shown: boolean) => void;
}) {
  const auth = useCockpitAuth();
  const range = useMemo(
    () => callRange(from && to ? { from, to } : null),
    [from, to],
  );
  const actor = auth.session?.user.id ?? "";
  const { state, reload } = useClientCalls(
    auth.client,
    actor,
    taskId,
    range.from,
    range.to,
  );
  const play = useCallback(
    (callId: string) => playCall(auth.client, callId),
    [auth.client],
  );
  return (
    <CallCentreView
      state={state}
      range={range}
      onRetry={taskId ? reload : undefined}
      play={play}
      lostElsewhereHref={lostElsewhereHref}
      onLostShown={onLostShown}
    />
  );
}

/** The part itself, from a read's state: the harness and the tests draw this. */
export function CallCentreView({
  state,
  range,
  onRetry,
  play,
  lostElsewhereHref,
  onLostShown,
}: {
  state: CallsState;
  range: CallRange;
  onRetry?: () => void;
  play: (callId: string) => Promise<RecordingResult>;
  lostElsewhereHref?: string;
  onLostShown?: (shown: boolean) => void;
}) {
  const lostNow = showsLost(state);
  // Before paint, so the page's own lost list never flashes in and out.
  useLayoutEffect(() => {
    onLostShown?.(lostNow);
  }, [lostNow, onLostShown]);
  const lede = `Leads that arrived ${rangeLabel(range)}, and every verified call made to them, from the dialer.${
    range.clamped
      ? ` The call read covers 93 days at most, so it starts on ${dayLabel(range.from)}.`
      : ""
  }`;
  return (
    <ResultsSection id="results-calls" title="Calls" lede={lede}>
      <div className="@container space-y-6">
        {state.status === "loading" ? (
          <Loading range={range} />
        ) : state.status === "error" ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 p-4 text-sm"
          >
            <p className="min-w-0 flex-[1_1_16rem]">{state.message}</p>
            {onRetry ? (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : (
          <Calls
            // Other dates are a new view: the toggles and the player reset.
            key={`${state.data.from}|${state.data.to}|${state.data.generatedAt}`}
            data={state.data}
            play={play}
            onRetry={onRetry}
            lostElsewhereHref={lostElsewhereHref}
          />
        )}
      </div>
    </ResultsSection>
  );
}

function Loading({ range }: { range: CallRange }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="shrink-0" />
        Reading the dialer for {rangeLabel(range)}. This takes a few seconds;
        the rest of the page works meanwhile.
      </p>
      <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4 @2xl:gap-4">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            aria-hidden
            className="h-28 rounded-2xl border bg-card motion-safe:animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

function Calls({
  data,
  play,
  onRetry,
  lostElsewhereHref,
}: {
  data: CallCentre;
  play: (callId: string) => Promise<RecordingResult>;
  onRetry?: () => void;
  lostElsewhereHref?: string;
}) {
  const verdict = useMemo(() => callCentreVerdict(data), [data]);
  const s = useMemo(() => summarize(data), [data]);

  if (verdict.kind === "client_calls") {
    const dialled = data.callers.dialled;
    return (
      <p className="text-sm text-muted-foreground">
        The client's own team calls these leads, so there is no call centre
        view.
        {dialled.length
          ? ` Our callers still dialled ${plural(
              dialled.reduce((n, d) => n + d.dials, 0),
              "time",
            )} in these dates: ${dialled
              .map(d => `${d.name} ${NUMBER.format(d.dials)}`)
              .join(", ")}.`
          : ""}
      </p>
    );
  }

  const hasLeads = (s.leads ?? 0) > 0;
  return (
    <>
      <VerdictLine data={data} verdict={verdict} />
      {verdict.kind === "no_data" ? (
        <NoData data={data} onRetry={onRetry} />
      ) : hasLeads ? (
        <>
          <div className="space-y-2">
            <Tiles s={s} />
            <SpeedFold data={data} s={s} />
          </div>
          <CallPath data={data} />
          <Breakdown data={data} />
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          No lead arrived in these dates. Pick a longer period at the top of the
          tab to see the calls.
        </p>
      )}
      <WaitingNow data={data} />
      {/* The lost reasons are the dialer's outcomes, apart from its report:
          they show even when the report has no row or did not answer. */}
      {verdict.kind !== "no_data" || hasLost(data) ? (
        <Lost data={data} play={play} lostElsewhereHref={lostElsewhereHref} />
      ) : null}
      <Sources data={data} />
    </>
  );
}

/**
 * No headline from the dialer's report: why, and what to do next. A report
 * that did not answer, or has no row while leads came in, is worth another
 * read; a client switched off in the dialer needs the CEO.
 */
function NoData({ data, onRetry }: { data: CallCentre; onRetry?: () => void }) {
  const leads = data.cohort.leads;
  const failed = reportDidNotAnswer(data);
  const off = !data.client.dialerActive;
  const retry = failed || (!off && leads > 0);
  const line = failed
    ? "The dialer's report did not answer for these dates, so its numbers are missing. Try again in a minute."
    : off
      ? "This client is switched off in the dialer. If our callers should call their leads, ask the CEO to switch it on."
      : leads > 0
        ? `The dialer's report has no row for this client in these dates, though ${plural(leads, "lead")} came in. Try again in a few minutes; if it stays, tell the CEO.`
        : "Numbers show here once leads arrive and the callers dial them.";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
      <p className="min-w-0 flex-[1_1_16rem]">{line}</p>
      {retry && onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. The verdict and the caller.

function VerdictLine({
  data,
  verdict,
}: {
  data: CallCentre;
  verdict: CallCentreVerdict;
}) {
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const more = verdict.reasons.slice(1);
  const watch = verdict.watch;
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
      <div className="min-w-0 flex-[1_1_28rem] space-y-2">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <Chip tone={TONES[verdict.tone]} className="mt-px shrink-0">
            {verdict.label}
          </Chip>
          <p className="min-w-0 flex-[1_1_16rem] text-[15px] leading-6">
            {verdict.why}
          </p>
        </div>
        {more.length ? (
          <div className="space-y-1.5">
            <button
              type="button"
              aria-expanded={reasonsOpen}
              onClick={() => setReasonsOpen(v => !v)}
              className="no-touch text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {reasonsOpen
                ? "Show fewer reasons"
                : `and ${plural(more.length, "more reason")}`}
            </button>
            {reasonsOpen ? <Bullets items={more} /> : null}
          </div>
        ) : null}
        {watch.length ? (
          <div className="space-y-1.5 text-[13px] text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">
                Worth fixing:{" "}
              </span>
              {watch[0]}
              {watch.length > 1 ? (
                <>
                  {" "}
                  <button
                    type="button"
                    aria-expanded={watchOpen}
                    onClick={() => setWatchOpen(v => !v)}
                    className="no-touch underline underline-offset-4 hover:text-foreground"
                  >
                    {watchOpen ? "show fewer" : `and ${watch.length - 1} more`}
                  </button>
                </>
              ) : null}
            </p>
            {watchOpen ? <Bullets items={watch.slice(1)} /> : null}
          </div>
        ) : null}
      </div>
      <CallerLine data={data} />
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted-foreground marker:text-muted-foreground/60">
      {items.map(r => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  );
}

/** "Caller: Lama Harb", on the verdict's line. */
function CallerLine({ data }: { data: CallCentre }) {
  const n = data.callers.assigned.length;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-sm">
      {n ? (
        <Headset
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      ) : (
        <Dot tone="warn" />
      )}
      {n ? (
        <>
          <span className="text-muted-foreground">
            {n > 1 ? "Callers:" : "Caller:"}
          </span>{" "}
          <span className="min-w-0 font-medium">{assignedCallers(data)}</span>
        </>
      ) : (
        <span className="text-muted-foreground">{assignedCallers(data)}</span>
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// 2. Four tiles, each naming its line.

function TileLabel({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <Dot tone={tone} />
      {children}
    </span>
  );
}

/** A value as the tile shows it; "Not measured" quietly. */
function TileValue({ text }: { text: string }) {
  if (text === NOT_MEASURED)
    return (
      <span className="text-base font-normal text-muted-foreground">
        {NOT_MEASURED}
      </span>
    );
  return (
    <span className={text.length > 9 ? "text-lg @md:text-2xl" : undefined}>
      {text}
    </span>
  );
}

function Lines({ lines }: { lines: ReactNode[] }) {
  return (
    <span className="mt-1 block space-y-0.5 leading-4">
      {lines.filter(Boolean).map((l, i) => (
        <span key={i} className="block">
          {l}
        </span>
      ))}
    </span>
  );
}

const meets = (v: number | null, ok: (v: number) => boolean): Tone =>
  v === null ? "neutral" : ok(v) ? "good" : "warn";

export function Tiles({ s }: { s: CallCentreSummary }) {
  const slowLine = CALL_RULES.firstCallWorkMinutes * 60;
  const judged =
    s.followUpCalls !== null && s.followUpLeads >= CALL_RULES.followUpMinLeads;
  const followTone: Tone = !judged
    ? "neutral"
    : (s.followUpCalls ?? 0) < CALL_RULES.followUpCalls
      ? "warn"
      : "good";
  const talkTone = meets(s.talked120PerDial, v => v >= CONVERSATION_GATE);
  return (
    <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4 @2xl:gap-4">
      <StatTile
        label={
          <TileLabel tone={meets(s.firstCallWorkSeconds, v => v <= slowLine)}>
            First call
          </TileLabel>
        }
        value={<TileValue text={formatDuration(s.firstCallWorkSeconds)} />}
        sub={
          <Lines
            lines={[
              s.withinFiveRate === null
                ? "Within 5 min: not measured"
                : `${formatRate(s.withinFiveRate)} within 5 min`,
              `Median working time, line ${CALL_RULES.firstCallWorkMinutes} min`,
            ]}
          />
        }
      />
      <StatTile
        label={<TileLabel tone={followTone}>Dials</TileLabel>}
        value={<TileValue text={count(s.dials)} />}
        sub={
          <Lines
            lines={[
              s.dialsPerLead === null
                ? "Per lead: not measured"
                : `${formatPerLead(s.dialsPerLead)} per lead`,
              s.followUpLeads > 0
                ? `No answer: ${formatPerLead(s.followUpCalls)} in 3 days, line ${CALL_RULES.followUpCalls}`
                : `Line: ${CALL_RULES.followUpCalls} in 3 days if no answer`,
            ]}
          />
        }
      />
      <StatTile
        label={
          <TileLabel tone={meets(s.reachedPerDial, v => v >= REACHED_GATE)}>
            Answered
          </TileLabel>
        }
        value={<TileValue text={formatRate(s.reachedPerDial)} />}
        sub={
          <Lines
            lines={[
              `Of dials, line ${REACHED_GATE}%`,
              s.reachedPerLeadCalled === null
                ? "Of leads called: not measured"
                : `${formatRate(s.reachedPerLeadCalled)} of leads called`,
              <span key="talk" className="flex items-start gap-1">
                {talkTone === "warn" ? (
                  <span className="mt-[5px]">
                    <Dot tone="warn" />
                  </span>
                ) : null}
                Talked 2 min+: {formatRate(s.talked120PerDial)}, line{" "}
                {CONVERSATION_GATE}%
              </span>,
            ]}
          />
        }
      />
      <StatTile
        label={
          <TileLabel tone={meets(s.bookedRate, v => v >= BOOKING_RATE_GATE)}>
            Booked
          </TileLabel>
        }
        value={<TileValue text={formatRate(s.bookedRate)} />}
        sub={
          <Lines
            lines={[
              `${count(s.confirmed)} confirmed of ${count(s.leads)} leads, line ${BOOKING_RATE_GATE}%`,
              s.provisional
                ? `${count(s.provisional)} provisional, not counted`
                : null,
            ]}
          />
        }
      />
    </div>
  );
}

/** Speed in and out of working hours, and follow-up, folded under the tiles. */
function SpeedFold({ data, s }: { data: CallCentre; s: CallCentreSummary }) {
  const sp = data.speed;
  const f = data.followUp;
  const part = (name: string, p: CallCentre["speed"]["inHours"]) => (
    <div className="min-w-0 space-y-0.5">
      <p className="font-medium text-foreground">{name}</p>
      <p>
        {plural(p.leads, "lead")}, {NUMBER.format(p.called)} called. Median
        first call {formatDuration(p.medianClockSeconds)};{" "}
        {formatRate(rate(p.withinFiveMinutes, p.leads))} within 5 min,{" "}
        {formatRate(rate(p.withinThirtyMinutes, p.leads))} within 30 min.
      </p>
    </div>
  );
  return (
    <details className="group text-[13px] text-muted-foreground">
      <summary className="inline-flex items-center rounded-md hover:text-foreground">
        In and out of working hours, and follow-up
      </summary>
      <div className="mt-2 grid gap-4 rounded-xl bg-muted/40 p-4 @2xl:grid-cols-3">
        {part("In working hours", sp.inHours)}
        {part("Out of hours", sp.outOfHours)}
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground">
            Leads who did not answer
          </p>
          <p>
            {f.leads
              ? `${plural(f.leads, "lead")} called but not reached in their first 3 days got ${formatPerLead(s.followUpCalls)} calls each; ${NUMBER.format(f.threePlus)} got 3 or more. The checklist asks for ${FOLLOW_UP_ATTEMPTS}.`
              : "No lead was called and left unreached in its first 3 days."}
          </p>
          {data.messages.outcomesWithoutCall ? (
            <p>
              {plural(data.messages.outcomesWithoutCall, "outcome")} saved
              without a Maqsam call, not counted as dials.
            </p>
          ) : null}
        </div>
        <p className="@2xl:col-span-3">
          Clock time from the lead arriving.{" "}
          {sp.hoursSource === "schedule"
            ? "Working hours are the assigned callers' hours on Team & Payroll."
            : "Working hours are 10:00 to 18:00 Kuwait time, Friday off: no assigned caller has hours on Team & Payroll."}
        </p>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// 3. The path a lead takes, with the leads nobody called as the gap.

const STEP_FILL: Record<PathStep["key"], string> = {
  leads: "var(--muted)",
  called: "color-mix(in srgb, var(--primary) 32%, var(--card))",
  answered: "color-mix(in srgb, var(--primary) 50%, var(--card))",
  talked: "color-mix(in srgb, var(--primary) 68%, var(--card))",
  booked: "color-mix(in srgb, var(--primary) 85%, var(--card))",
  showed: "var(--primary)",
};

const GAP_FILL =
  "repeating-linear-gradient(135deg, color-mix(in srgb, var(--warning) 70%, transparent) 0 2px, transparent 2px 6px)";

function CallPath({ data }: { data: CallCentre }) {
  const path = callPath(data);
  if (!path) return null;
  const [leads, called] = path.steps;
  const nc = data.notCalled;
  const causes = [
    nc.noPhone ? `${plural(nc.noPhone, "lead")} with no phone` : null,
    nc.unreadablePhone
      ? `${plural(nc.unreadablePhone, "lead")} with a phone the dialer cannot read`
      : null,
    nc.dialledUnderAnotherLead
      ? `${plural(nc.dialledUnderAnotherLead, "lead")} whose phone was dialled under another lead`
      : null,
    nc.neverDialled
      ? `${plural(nc.neverDialled, "lead")} with a good phone never dialled${
          nc.neverDialledOutsideDialerCountries ||
          nc.neverDialledWithSavedOutcome
            ? ` (${[
                nc.neverDialledOutsideDialerCountries
                  ? `${NUMBER.format(nc.neverDialledOutsideDialerCountries)} outside the dialer's countries`
                  : null,
                nc.neverDialledWithSavedOutcome
                  ? `${NUMBER.format(nc.neverDialledWithSavedOutcome)} with an outcome saved but no call`
                  : null,
              ]
                .filter(Boolean)
                .join(", ")})`
            : ""
        }`
      : null,
  ].filter((c): c is string => Boolean(c));
  const label = path.steps
    .map(st => `${st.label} ${NUMBER.format(st.count)}`)
    .join(", ");
  return (
    <div className="space-y-3">
      <Kicker>Where the leads went</Kicker>
      <div
        role="img"
        aria-label={`${label}. ${NUMBER.format(path.notCalled)} not called yet.`}
        className="relative h-3 overflow-hidden rounded-full"
        style={{ background: STEP_FILL.leads }}
      >
        {path.notCalled > 0 ? (
          <span
            data-gap
            className="absolute inset-y-0 right-0"
            style={{ left: `${called.width}%`, background: GAP_FILL }}
          />
        ) : null}
        {path.steps.slice(1).map(st => (
          <span
            key={st.key}
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${st.width}%`, background: STEP_FILL[st.key] }}
          />
        ))}
      </div>
      <dl className="grid grid-cols-3 gap-x-4 gap-y-3 @xl:grid-cols-6">
        {path.steps.map(st => (
          <div key={st.key} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-sm",
                  st.key === "leads" && "ring-1 ring-inset ring-border",
                )}
                style={{ background: STEP_FILL[st.key] }}
              />
              <span className="truncate">{st.label}</span>
            </dt>
            <dd className="mt-0.5 whitespace-nowrap tabular-nums">
              <span className="text-[15px] font-semibold">
                {NUMBER.format(st.count)}
              </span>
              {st.key !== "leads" && st.share !== null ? (
                <span className="ml-1 text-xs text-muted-foreground">
                  {formatRate(st.share)}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {path.notCalled > 0 ? (
        <details className="text-[13px]">
          <summary className="inline-flex items-center gap-1.5 rounded-md">
            <span
              aria-hidden
              className="inline-block size-2 shrink-0 rounded-sm bg-muted"
              style={{ background: `${GAP_FILL}, var(--muted)` }}
            />
            <span className="font-medium">
              {NUMBER.format(path.notCalled)} not called yet
            </span>
            <span className="text-muted-foreground">
              {formatRate(rate(path.notCalled, leads.count))} of leads, why
            </span>
          </summary>
          <div className="mt-2 rounded-xl bg-muted/40 p-4 text-muted-foreground">
            {causes.length ? (
              <Bullets items={causes} />
            ) : (
              <p>
                The dialer's report counts them; the reasons are not split yet.
              </p>
            )}
          </div>
        </details>
      ) : (
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Dot tone="good" />
          Every lead has a verified call.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. By campaign and by ad.

// One grid for the labels and every row so the numbers line up; narrower, a
// row reads as a line of words under its name.
const GRID =
  "@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_repeat(6,4.5rem)_5.5rem] @3xl:gap-x-3";

/**
 * One number in the wide layout. A screen reader hears the row's line of
 * words instead (sr-only when wide), which names every number, so the cells
 * are hidden from it. Missing is a dash that says "Not measured" on hover.
 */
function Cell({ v }: { v: string }) {
  const missing = v === NOT_MEASURED;
  return (
    <span
      aria-hidden
      title={missing ? NOT_MEASURED : undefined}
      className={cn(
        "hidden text-right tabular-nums @3xl:block",
        missing ? "text-xs text-muted-foreground" : "text-sm",
      )}
    >
      {missing ? "-" : v}
    </span>
  );
}

/** A row has a number the wide layout draws as a dash. */
const hasDash = (r: TableRow) =>
  [r.called, r.dialsPerLead, r.answered, r.booked, r.firstCall].some(
    v => v === null,
  );

function Breakdown({ data }: { data: CallCentre }) {
  const [by, setBy] = useState<"campaign" | "ad">("campaign");
  const [all, setAll] = useState(false);
  const source = by === "campaign" ? data.byCampaign : data.byAd;
  const rows = useMemo(
    () => source.map(r => tableRow(r, by, data.clientAverage)),
    [source, by, data.clientAverage],
  );
  const avg = data.clientAverage
    ? tableRow(data.clientAverage, by, null)
    : null;
  const shown = all ? rows : rows.slice(0, TABLE_SHOWN);
  const dash = shown.some(hasDash) || (avg ? hasDash(avg) : false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h3 className="text-[15px] font-semibold">
            {by === "campaign" ? "By campaign" : "By ad"}
          </h3>
          <p className="text-[13px] text-muted-foreground">
            Answered and booked per lead called, against the client's average.
            First call is clock time from the lead arriving.
            {dash ? (
              <span className="hidden @3xl:inline">
                {" "}
                A dash is not measured.
              </span>
            ) : null}
          </p>
        </div>
        <div
          role="group"
          aria-label="Show calls by"
          className="flex items-center gap-1"
        >
          <Pill
            active={by === "campaign"}
            onClick={() => {
              setBy("campaign");
              setAll(false);
            }}
          >
            By campaign
          </Pill>
          <Pill
            active={by === "ad"}
            onClick={() => {
              setBy("ad");
              setAll(false);
            }}
          >
            By ad
          </Pill>
        </div>
      </div>
      {rows.length ? (
        <div className="rounded-2xl border bg-card">
          <div
            aria-hidden
            className={cn(
              GRID,
              "hidden border-b px-4 py-2.5 text-xs text-muted-foreground @xl:px-6",
            )}
          >
            <span>{by === "campaign" ? "Campaign" : "Ad"}</span>
            <span className="text-right">Leads</span>
            <span className="text-right">Called</span>
            <span className="text-right">Dials</span>
            <span className="text-right">Per lead</span>
            <span className="text-right">Answered</span>
            <span className="text-right">Booked</span>
            <span className="text-right">First call</span>
          </div>
          <ul className="divide-y">
            {shown.map(r => (
              <BreakdownRow key={r.key} r={r} />
            ))}
            {avg ? <BreakdownRow r={avg} average /> : null}
          </ul>
        </div>
      ) : (
        <p className="rounded-xl bg-muted/40 p-4 text-[13px] text-muted-foreground">
          No lead in these dates carries{" "}
          {by === "campaign" ? "a campaign" : "an ad"} id, so the calls cannot
          be split this way.
        </p>
      )}
      {rows.length > TABLE_SHOWN ? (
        <Button variant="ghost" size="sm" onClick={() => setAll(v => !v)}>
          {all ? "Show fewer" : `Show the other ${rows.length - TABLE_SHOWN}`}
        </Button>
      ) : null}
    </div>
  );
}

/** "70% answered", or "answered not measured" with nothing under it. */
const share = (v: number | null, word: string) =>
  v === null ? `${word} not measured` : `${formatRate(v)} ${word}`;

function BreakdownRow({ r, average }: { r: TableRow; average?: boolean }) {
  const words = [
    plural(r.leads, "lead"),
    share(r.called, "called"),
    `${plural(r.dials, "dial")}${r.dialsPerLead === null ? "" : ` (${formatPerLead(r.dialsPerLead)} a lead)`}`,
    share(r.answered, "answered"),
    share(r.booked, "booked"),
    r.firstCall === null
      ? "first call not measured"
      : `first call ${formatDuration(r.firstCall)}`,
  ];
  return (
    <li
      data-row={average ? "average" : r.key}
      className={cn("px-4 py-3 @xl:px-6", average && "bg-muted/40")}
    >
      <div className={cn(GRID, "@3xl:items-start")}>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {average ? null : <Dot tone={r.tone} label={r.flag.why} />}
            <span
              className={cn(
                "min-w-0 truncate text-sm",
                average ? "text-muted-foreground" : "font-medium",
              )}
              title={average ? undefined : r.name}
              dir="auto"
            >
              {average ? "Client average, every lead" : r.name}
            </span>
          </div>
          {r.under && !average ? (
            <p
              className="truncate pl-3.5 text-xs text-muted-foreground"
              dir="auto"
            >
              {r.under}
            </p>
          ) : null}
          <p
            data-stacked
            className={cn(
              "mt-1 text-xs text-muted-foreground tabular-nums @3xl:sr-only",
              !average && "pl-3.5",
            )}
          >
            {words.join(" · ")}
          </p>
          {r.speaks && !average ? (
            <p className="mt-1 pl-3.5 text-xs text-muted-foreground">
              {r.flag.why}
            </p>
          ) : null}
        </div>
        <Cell v={count(r.leads)} />
        <Cell v={formatRate(r.called)} />
        <Cell v={count(r.dials)} />
        <Cell v={formatPerLead(r.dialsPerLead)} />
        <Cell v={formatRate(r.answered)} />
        <Cell v={formatRate(r.booked)} />
        <Cell v={formatDuration(r.firstCall)} />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 5. Waiting now.

/** A fold drawn like the kit's, open from the start when it should be. */
function Folded({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="group rounded-2xl border bg-card"
    >
      <summary className="no-marker flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-4 py-4 text-[15px] font-semibold sm:px-6">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        {title}
        {hint ? (
          <span className="min-w-0 text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </summary>
      {open ? (
        <div className="border-t px-4 py-4 sm:px-6">{children}</div>
      ) : null}
    </details>
  );
}

function WaitRow({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="pt-[7px]">
        <Dot tone={tone} />
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        {children ? (
          <div className="text-[13px] text-muted-foreground">{children}</div>
        ) : null}
      </div>
    </li>
  );
}

function WaitingNow({ data }: { data: CallCentre }) {
  const w = data.waiting;
  const waits = somethingWaits(data);
  const u = w.untouched;
  const cb = w.callbacks;
  const mi = w.missedInbound;
  const touched = rate(w.touched, w.callable);
  // The 90% line is a Maqsam call (2026-10-16); a read without the called
  // count keeps the touched share. The waiting list stays the touched rule,
  // so on the new read it is worded as a call or a saved outcome, never as
  // contact.
  const line = calledLines(data);
  const hint = [
    u.count
      ? `${NUMBER.format(u.count)} with no call ${line ? "or outcome " : ""}yet`
      : null,
    cb.count ? `${plural(cb.count, "callback")} asked for` : null,
    mi.never ? `${plural(mi.never, "missed call")} not returned` : null,
  ].filter(Boolean);
  return (
    <Folded
      title="Waiting now"
      hint={
        hint.length
          ? hint.join(", ")
          : line
            ? "Nobody waits for a call or an outcome"
            : "Nobody waits for a first call"
      }
      defaultOpen={waits}
    >
      <ul className="divide-y divide-border/60">
        <WaitRow
          tone={u.count || line?.under ? "warn" : "good"}
          title={
            u.count
              ? `${plural(u.count, "lead")} with no call or ${line ? "outcome" : "message"} yet`
              : !line
                ? "Every lead older than a working hour was called or messaged"
                : line.outcomeOnly
                  ? "Every lead older than a working hour has a Maqsam call or a saved outcome"
                  : "Every lead older than a working hour has a call on Maqsam"
          }
        >
          {u.count ? (
            <p>
              The oldest has waited {formatDuration(u.oldestWorkSeconds)} of
              working time, since {kuwaitDayLabel(u.oldestAt)}.
            </p>
          ) : null}
          {line ? (
            <>
              <p>{line.called}</p>
              {line.outcomeOnly ? <p>{line.outcomeOnly}</p> : null}
            </>
          ) : (
            <p>
              {NUMBER.format(w.touched)} of {NUMBER.format(w.callable)} callable
              leads reached out to ({formatRate(touched)}, the line is{" "}
              {CALL_RULES.touchedShare}%).
            </p>
          )}
        </WaitRow>
        {w.stages.length ? (
          <WaitRow
            tone={
              w.stages.some(st => st.overSevenDays > 0) ? "warn" : "neutral"
            }
            title="Open leads by stage"
          >
            <ul className="mt-1 space-y-1">
              {w.stages.map(st => (
                <li key={st.stage} className="tabular-nums">
                  <span className="text-foreground" dir="auto">
                    {st.stage}
                  </span>
                  : {plural(st.count, "lead")}, median{" "}
                  {stageDays(st.medianDays)}, oldest {stageDays(st.oldestDays)}
                  {st.overSevenDays
                    ? `, ${NUMBER.format(st.overSevenDays)} over a week`
                    : ""}
                </li>
              ))}
            </ul>
          </WaitRow>
        ) : null}
        <WaitRow
          tone={cb.overThreeDays || cb.overdue ? "warn" : "neutral"}
          title={
            cb.count
              ? `${plural(cb.count, "lead")} asked to be called back`
              : "No callback waiting"
          }
        >
          {cb.count ? (
            <p>
              {NUMBER.format(cb.overThreeDays)} last touched over 3 days ago.{" "}
              {NUMBER.format(cb.scheduled)}{" "}
              {cb.scheduled === 1 ? "has" : "have"} a time set
              {cb.overdue
                ? `, ${NUMBER.format(cb.overdue)} of them overdue`
                : ""}
              .
            </p>
          ) : null}
        </WaitRow>
        <WaitRow
          tone={mi.never ? "warn" : "neutral"}
          title={
            mi.count
              ? `${plural(mi.count, "missed call")} from ${plural(mi.callers, "lead")}`
              : "No missed call from a lead"
          }
        >
          {mi.count ? (
            <p>
              {mi.never
                ? `${NUMBER.format(mi.never)} never called back, the oldest since ${kuwaitDayLabel(mi.oldestNeverAt)}. `
                : "Every one was called back. "}
              {NUMBER.format(mi.withinFifteenMinutes)} within 15 min,{" "}
              {NUMBER.format(mi.withinTwoHours)} within 2 hours,{" "}
              {NUMBER.format(mi.withinDay)} within a day.
            </p>
          ) : null}
        </WaitRow>
      </ul>
    </Folded>
  );
}

// ---------------------------------------------------------------------------
// 6. Why leads were lost, with the longest call to play.

type Player =
  | { row: string; status: "loading" }
  | { row: string; status: "ready"; url: string }
  | { row: string; status: "error"; message: string };

const PLAY_FAILED =
  "The recording could not be played. Try again; if it keeps failing, open the call in the dialer.";

function Lost({
  data,
  play,
  lostElsewhereHref,
}: {
  data: CallCentre;
  play: (callId: string) => Promise<RecordingResult>;
  lostElsewhereHref?: string;
}) {
  const lost = data.lost;
  const [all, setAll] = useState(false);
  const [player, setPlayer] = useState<Player | null>(null);
  const url = useRef<string | null>(null);
  const ticket = useRef(0);
  const release = useCallback(() => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }, []);
  // Leaving the page stops the player and frees its audio.
  useEffect(
    () => () => {
      ticket.current += 1;
      release();
    },
    [release],
  );
  const open = async (row: string, callId: string) => {
    release();
    const mine = ++ticket.current;
    setPlayer({ row, status: "loading" });
    let res: RecordingResult;
    try {
      res = await play(callId);
    } catch {
      res = { ok: false, message: PLAY_FAILED };
    }
    if (mine !== ticket.current) return;
    if (!res.ok) {
      setPlayer({ row, status: "error", message: res.message });
      return;
    }
    const made = URL.createObjectURL(res.blob);
    url.current = made;
    setPlayer({ row, status: "ready", url: made });
  };
  const close = () => {
    ticket.current += 1;
    release();
    setPlayer(null);
  };
  const latest = lost.latest;
  const rowKey = (l: (typeof latest)[number], i: number) =>
    `${l.at}|${l.longestCallId ?? i}`;
  const shown = all ? latest : latest.slice(0, LOST_SHOWN);
  // Folding the list away closes a player in a row it hides, and frees it.
  const toggleAll = () => {
    if (
      all &&
      player &&
      !latest.slice(0, LOST_SHOWN).some((l, i) => rowKey(l, i) === player.row)
    )
      close();
    setAll(v => !v);
  };
  const un = lost.unreachable;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-[15px] font-semibold">
          Why leads were lost
          {lost.total ? (
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              {NUMBER.format(lost.total)}
            </span>
          ) : null}
        </h3>
        <p className="text-[13px] text-muted-foreground">
          {lost.total
            ? "The reason the agent picked, sorted by their note, and the longest call to listen to."
            : "No lead was marked lost in the dialer in these dates."}
        </p>
      </div>
      {lost.reasons.length ? (
        <ul aria-label="Lost reasons" className="flex flex-wrap gap-2">
          {lost.reasons.map(r => (
            <li key={r.key}>
              <Chip dot={false} className="font-normal text-muted-foreground">
                {lostLabel(r.key)}
                <span className="ml-1.5 font-semibold text-foreground tabular-nums">
                  {NUMBER.format(r.count)}
                </span>
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}
      {un.leads ? (
        <p className="text-[13px] text-muted-foreground">
          {plural(un.leads, "lead")} marked could not be reached got{" "}
          {formatPerLead(un.calls / un.leads)} verified calls each:{" "}
          {NUMBER.format(un.noCall)} had none, {NUMBER.format(un.fourPlus)} got
          4 or more.
        </p>
      ) : null}
      {latest.length ? (
        <ul className="divide-y rounded-2xl border bg-card">
          {shown.map((l, i) => {
            const row = rowKey(l, i);
            const mine = player?.row === row ? player : null;
            return (
              <li key={row} className="space-y-1.5 px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium" dir="auto">
                    {l.firstName ?? "A lead"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {lostLabel(l.key)}
                  </span>
                  {l.adName ? (
                    <span
                      className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs"
                      dir="auto"
                    >
                      {l.adName}
                    </span>
                  ) : null}
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
                    {dayLabel(l.day)}
                  </span>
                </div>
                {l.note ? (
                  <p
                    className={cn(
                      "text-[13px] text-muted-foreground",
                      all ? null : "line-clamp-2",
                    )}
                    dir="auto"
                  >
                    {l.note}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No note from the agent.
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {plural(l.calls, "verified call")}
                    {l.calls
                      ? l.longestSeconds === null
                        ? ", none answered"
                        : `, longest ${formatCallLength(l.longestSeconds)}`
                      : ""}
                    {l.agent ? ` · ${l.agent}` : ""}
                  </p>
                  {l.longestCallId ? (
                    mine ? (
                      <Button variant="ghost" size="sm" onClick={close}>
                        <X aria-hidden />
                        Close the player
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Play the longest call with ${l.firstName ?? "this lead"}`}
                        onClick={() => void open(row, String(l.longestCallId))}
                      >
                        <Play aria-hidden className="text-primary" />
                        Play
                      </Button>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {l.calls ? "No recording to play" : "No call to play"}
                    </span>
                  )}
                </div>
                {mine ? (
                  <div className="rounded-xl bg-muted/40 p-3">
                    {mine.status === "loading" ? (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Spinner className="shrink-0" />
                        Fetching the recording from Maqsam…
                      </p>
                    ) : mine.status === "error" ? (
                      <p role="alert" className="text-xs">
                        {mine.message}
                      </p>
                    ) : (
                      // biome-ignore lint/a11y/useMediaCaption: a phone call recording has no captions
                      <audio
                        controls
                        autoPlay
                        src={mine.url}
                        className="h-10 w-full"
                        aria-label={`The longest call with ${l.firstName ?? "this lead"}`}
                      />
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {latest.length > LOST_SHOWN ? (
        <Button variant="ghost" size="sm" onClick={toggleAll}>
          {all ? "Show fewer" : `Show the other ${latest.length - LOST_SHOWN}`}
        </Button>
      ) : null}
      {lostElsewhereHref && hasLost(data) ? (
        <p>
          <Link
            to={lostElsewhereHref}
            className="inline-flex items-center gap-0.5 text-[13px] text-primary underline-offset-4 hover:underline"
          >
            Leads marked lost in GoHighLevel, with the team's notes, are on the
            Ads tab
            <ChevronRight aria-hidden className="size-4 shrink-0" />
          </Link>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Where the numbers come from.

function Sources({ data }: { data: CallCentre }) {
  const c = data.coverage;
  const gaps = [
    c.unlinkedCalls
      ? `${plural(c.unlinkedCalls, "call")} in these dates could not be linked to one lead.`
      : null,
    c.leadsWithoutPhone
      ? `${plural(c.leadsWithoutPhone, "lead")} have no phone.`
      : null,
    c.leadsWithUnreadablePhone
      ? `${plural(c.leadsWithUnreadablePhone, "lead")} have a phone the dialer cannot read.`
      : null,
    c.leadsWithoutAdId
      ? `${plural(c.leadsWithoutAdId, "lead")} have no ad id, so they are not in By ad${
          c.metaLeadsWithoutAdId
            ? ` (${NUMBER.format(c.metaLeadsWithoutAdId)} of them from Meta)`
            : ""
        }.`
      : null,
    c.leadsOnlyInGhl
      ? `${plural(c.leadsOnlyInGhl, "lead")} are in GoHighLevel only, outside the lead feed.`
      : null,
    data.lost.otherNotes.total
      ? `${NUMBER.format(data.lost.otherNotes.sorted)} of ${NUMBER.format(data.lost.otherNotes.total)} leads lost as Other were sorted by the agent's note.`
      : null,
    data.messages.handled
      ? `${plural(data.messages.handled, "lead")} handled by message, not by a call.`
      : null,
  ].filter((g): g is string => Boolean(g));
  const dialled = data.callers.dialled;
  const others = data.callers.otherAccess;
  return (
    <Folded
      title="Where these numbers come from"
      hint={`${dayLabel(data.from)} to ${dayLabel(data.to)}, Kuwait time`}
    >
      <div className="space-y-4 text-[13px] text-muted-foreground">
        <p>
          Newest call {kuwaitStamp(c.newestClientCallAt)}, newest outcome{" "}
          {kuwaitStamp(c.newestClientAttemptAt)}, leads synced{" "}
          {kuwaitStamp(c.leadSyncAt)}. Read {kuwaitStamp(data.generatedAt)}.
        </p>
        {dialled.length || others.length ? (
          <div className="space-y-1">
            {dialled.length ? (
              <p>
                Dialled in these dates:{" "}
                {dialled
                  .map(d => `${d.name} ${NUMBER.format(d.dials)}`)
                  .join(", ")}
                .
              </p>
            ) : null}
            {others.length ? (
              <p>
                Can also open this client in the dialer:{" "}
                {others.map(o => `${o.name} (${o.why})`).join(", ")}.
              </p>
            ) : null}
          </div>
        ) : null}
        {gaps.length ? <Bullets items={gaps} /> : null}
        {data.notes.length ? (
          <div className="space-y-1">
            <Kicker>How to read them</Kicker>
            <Bullets items={data.notes} />
          </div>
        ) : null}
      </div>
    </Folded>
  );
}

// ---------------------------------------------------------------------------
// The assigned caller outside the part (Aziz, 2026-10-13: "The CSM needs to
// be able to see the assigned caller for each client easily").

/**
 * The caller on a row of the client list. Nothing while the read is on its
 * way; "No caller" only for a live client we call, where it is a gap.
 */
export function ClientCallerChip({
  callers,
  expected,
}: {
  /** undefined while the read is on its way or when it failed. */
  callers?: Caller[];
  /** A live done-for-you client: our call centre should be calling them. */
  expected: boolean;
}) {
  if (!callers) return null;
  if (!callers.length)
    return expected ? (
      <Chip tone="warn" title={callerNames([])}>
        No caller
      </Chip>
    ) : null;
  return (
    <span
      title={`Assigned caller in the dialer: ${callerNames(callers)}`}
      className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
    >
      <Headset aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <span className="sr-only">Caller: </span>
      <span className="min-w-0 truncate">{callerNames(callers)}</span>
    </span>
  );
}

/** The caller in the client page header, beside the client's main contact. */
export function ClientCallerLine({
  read,
  taskId,
  dwy,
}: {
  read: CallersState;
  taskId: string;
  dwy: boolean;
}) {
  if (read.error)
    return (
      <p className="text-xs text-muted-foreground">
        The caller is not shown. {read.error}
      </p>
    );
  if (!read.byTask)
    return (
      <p className="text-xs text-muted-foreground">
        Finding their caller in the dialer…
      </p>
    );
  const callers = read.byTask.get(taskId) ?? [];
  if (!callers.length)
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {dwy ? (
          <Headset aria-hidden className="size-4 shrink-0" />
        ) : (
          <Dot tone="warn" />
        )}
        {dwy
          ? "No caller: the client's own team calls their leads"
          : callerNames([])}
      </p>
    );
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
      <Headset aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">
        {callers.length > 1 ? "Callers:" : "Caller:"}
      </span>{" "}
      <span className="font-medium">{callerNames(callers)}</span>
    </p>
  );
}
