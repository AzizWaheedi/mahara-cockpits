import {
  CircleAlert,
  Headset,
  LoaderCircle,
  PhoneForwarded,
  PhoneOff,
  Play,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";
import { EmptyState } from "@/components/ceo/EmptyState";
import { count, dateTime, shortDate } from "@/components/ceo/format";
import { StatTile } from "@/components/ceo/StatTile";
import {
  STATUS_COLOR,
  StatusChip,
  StatusDot,
  type StatusTone,
} from "@/components/ceo/StatusChip";
import { useWidth } from "@/components/ceo/useWidth";
import { SECTION_OFFSET } from "@/components/SectionNav";
import { Button } from "@/components/ui/button";
import {
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
  NO_CALLER,
  NOT_MEASURED,
  type RowFlag,
  rate,
  rowFlag,
  summarize,
} from "@/lib/callCentre";
import {
  type CallerState,
  type CallWindow,
  callerNames,
  callsAreEmpty,
  callsHoldLost,
  callWindow,
  dayLabel,
  leadsOutsideRows,
  loadClientCalls,
  loadRecording,
  rowRates,
  useAssignedCallers,
  useClientCalls,
  waitingHeadline,
} from "@/lib/callCentreClient";
import {
  BOOKING_RATE_GATE,
  CONVERSATION_GATE,
  FIRST_CALL_MINUTES,
  FOLLOW_UP_ATTEMPTS,
  REACHED_GATE,
} from "@/lib/kpi";
import { cn } from "@/lib/utils";

/**
 * Calls: one client's call centre on the media buyer's client page (Aziz,
 * 2026-10-13: "is this a call center issue or is it not? ... see why exactly
 * the leads were lost ... Don't make it too busy").
 *
 * The first screen answers the question: the verdict, the caller, four tiles
 * with their lines, then the campaigns and ads the media buyer acts on. Below
 * them the lead bar (every lead, drawn deeper the further it got, with the
 * leads nobody called as the hatched gap), who is waiting, why leads were
 * lost with their calls to play, and where the numbers come from, folded.
 *
 * Numbers, the verdict, the row flags and their words come from callCentre.ts
 * (shared with client success); the reads from callCentreClient.ts. Missing is
 * never zero: a number the read could not give says "Not measured".
 */

/** The anchor the board's "Calls for this client" link opens. */
export const CALLS_ANCHOR = "calls";
/** Rows shown before "Show the other N". */
const ROWS_SHOWN = 8;
/** Lost leads shown before "Show the other N". */
const LOST_SHOWN = 5;
/** The card is wide enough for the table from here; stacked rows below. */
const TABLE_WIDTH = 720;

const VERDICT_TONE: Record<CallCentreVerdict["tone"], StatusTone> = {
  bad: "serious",
  watch: "warning",
  good: "good",
  muted: "neutral",
};

const FLAG_TONE: Record<RowFlag["kind"], StatusTone> = {
  below: "warning",
  not_called: "serious",
  above: "good",
  even: "neutral",
  too_few: "neutral",
};

/** How far a lead got, drawn as depth: one teal, deeper per step. */
const DEPTH = {
  called: 24,
  answered: 42,
  talked: 60,
  booked: 80,
  showed: 100,
} as const;
const tint = (pct: number) =>
  `color-mix(in srgb, var(--ceo-emphasis) ${pct}%, transparent)`;
const HATCH =
  "repeating-linear-gradient(135deg, var(--ceo-deemphasis) 0 2px, transparent 2px 6px)";

type Range = { start?: string | null; end?: string | null } | null;

function useCallWindow(range: Range | undefined): CallWindow {
  const start = range?.start ?? null;
  const end = range?.end ?? null;
  return useMemo(() => callWindow({ start, end }), [start, end]);
}

// ---------------------------------------------------------------------------
// The caller, on the page header and the section header.

function callerText(state: CallerState, leadsOnly: boolean): ReactNode {
  // Done with you: a caller is named only when the dialer has one.
  if (state.status === "loading" && leadsOnly) return null;
  if (state.status === "loading")
    return (
      <span>
        Caller: <span className="italic">checking the dialer</span>
      </span>
    );
  if (state.status === "unknown") return null;
  if (!state.names.length) return leadsOnly ? null : <span>{NO_CALLER}</span>;
  return (
    <span className="min-w-0">
      {state.names.length > 1 ? "Callers" : "Caller"}:{" "}
      <span className="font-medium text-foreground" dir="auto">
        {callerNames(state.names)}
      </span>
    </span>
  );
}

/**
 * The client's assigned caller under the client's name (Aziz, 2026-10-13:
 * "see the assigned caller for each client easily, the assigned agent").
 */
export function CallerLine({
  clientName,
  accountKey,
  range,
  leadsOnly = false,
  className,
}: {
  clientName: string;
  accountKey: string | null;
  range?: Range;
  leadsOnly?: boolean;
  className?: string;
}) {
  const w = useCallWindow(range);
  const state = useAssignedCallers(clientName, accountKey, w);
  const text = callerText(state, leadsOnly);
  if (!text) return null;
  return (
    <p
      className={cn(
        "mt-1 flex items-center gap-1.5 text-sm text-muted-foreground",
        className,
      )}
    >
      <Headset className="size-3.5 shrink-0" aria-hidden />
      {text}
    </p>
  );
}

/**
 * True when the Calls part shows the client's lost leads, so the page drops
 * its own lost pipeline and its "Lost leads" pill (one lost breakdown per
 * client). Reads the same cached answer as the section: no second read.
 */
export function useCallsHoldLost(
  accountKey: string | null,
  range: Range | undefined,
  leadsOnly: boolean,
): boolean {
  const w = useCallWindow(range);
  const state = useClientCalls(accountKey, w);
  return callsHoldLost(state, { leadsOnly, hasKey: Boolean(accountKey) });
}

// ---------------------------------------------------------------------------
// The section.

export function CallCentreSection({
  accountKey,
  clientName,
  range,
  leadsOnly = false,
  className,
}: {
  /** The client's Meta ad account id: the read finds the client by it. */
  accountKey: string | null;
  clientName: string;
  /** The page's range; clamped to the read's 93 days, 30 days when absent. */
  range?: Range;
  /** The campaigns say done-with-you: the client's own team calls. */
  leadsOnly?: boolean;
  className?: string;
}) {
  const w = useCallWindow(range);
  const state = useClientCalls(accountKey, w);
  const callers = useAssignedCallers(clientName, accountKey, w);
  const ref = useAnchor(CALLS_ANCHOR);
  const data = state.status === "ready" ? state.data : null;
  const dwy = data
    ? data.client.serviceMode?.toUpperCase() === "DWY"
    : leadsOnly;
  const caller = callerText(callers, dwy);

  return (
    <section
      ref={ref}
      id={CALLS_ANCHOR}
      aria-labelledby="calls-title"
      className={cn(
        "rounded-2xl border bg-card p-4 sm:p-6",
        SECTION_OFFSET,
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 id="calls-title" className="text-[15px] font-semibold">
            Calls
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Leads that came in {dayLabel(w.from)} to {dayLabel(w.to)}, and every
            call made to them.
          </p>
        </div>
        {accountKey && caller ? (
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <Headset className="size-3.5 shrink-0" aria-hidden />
            {caller}
          </p>
        ) : null}
      </div>
      {w.why ? (
        <p className="mt-2 text-xs text-muted-foreground">{w.why}</p>
      ) : null}

      <div className="@container mt-4">
        {!accountKey ? (
          <EmptyState
            compact
            icon={PhoneOff}
            title="No ad account to look the calls up by"
            text="This client's campaigns carry no Meta ad account. Ask the CEO to add it to the client record, then reload the page."
          />
        ) : dwy ? (
          <DoneWithYou data={data} />
        ) : state.status === "ready" ? (
          <Ready data={state.data} />
        ) : state.status === "error" ? (
          <ReadFailed
            message={state.message}
            onRetry={() => loadClientCalls(accountKey, w, true)}
          />
        ) : (
          <Loading />
        )}
      </div>
    </section>
  );
}

/**
 * Opened at #calls (the board's "Calls for this client"), the section is
 * brought into view and held there while the parts above it fill in, until
 * the reader scrolls or presses a key.
 */
function useAnchor(id: string) {
  const ref = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash !== `#${id}`) return;
    let done = false;
    const align = () => {
      if (!done) ref.current?.scrollIntoView({ block: "start" });
    };
    // After the page's own "start at the top" has run.
    const frame = requestAnimationFrame(align);
    const watcher =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(align);
    watcher?.observe(document.body);
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    const stop = () => {
      done = true;
      watcher?.disconnect();
      for (const k of events) window.removeEventListener(k, stop);
    };
    for (const k of events) window.addEventListener(k, stop, { passive: true });
    const timer = window.setTimeout(stop, 8000);
    return () => {
      stop();
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [hash, id]);
  return ref;
}

function Loading() {
  return (
    <div role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle
          className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
        Reading the dialer for these dates. It takes a few seconds; the rest of
        the page works meanwhile.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 @2xl:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className="h-[104px] animate-pulse rounded-xl bg-muted/40 motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}

function ReadFailed({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl bg-muted/40 p-4" role="alert">
      <p className="flex items-start gap-2 text-sm">
        <CircleAlert
          className="mt-0.5 size-4 shrink-0"
          style={{ color: STATUS_COLOR.warning }}
          aria-hidden
        />
        <span className="min-w-0">{message}</span>
      </p>
      <p className="mt-1 pl-6 text-xs text-muted-foreground">
        The calls could not be read, which does not mean none were made.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="mt-3 ml-6"
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}

/** Done with you: the client's own team calls, so one quiet line. */
function DoneWithYou({ data }: { data: CallCentre | null }) {
  const dialled = data?.callers.dialled ?? [];
  const total = dialled.reduce((s, d) => s + d.dials, 0);
  return (
    <div>
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <PhoneForwarded className="mt-0.5 size-4 shrink-0" aria-hidden />
        The client's own team calls these leads, so there is no call centre
        view.
      </p>
      {total > 0 ? (
        <p className="mt-1 pl-6 text-xs text-muted-foreground">
          Our callers still made {count(total)} verified call
          {total === 1 ? "" : "s"} in these dates:{" "}
          {dialled.map(d => `${d.name} ${count(d.dials)}`).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The answer.

function Ready({ data }: { data: CallCentre }) {
  const verdict = callCentreVerdict(data);
  const s = summarize(data);
  if (callsAreEmpty(data))
    return (
      <EmptyState
        compact
        title={`No leads came in between ${dayLabel(data.from)} and ${dayLabel(data.to)}`}
        text="Pick a longer range at the top of the page; the call read covers up to 93 days."
      />
    );
  const hasOfficial = Boolean(data.official);
  return (
    <div>
      <VerdictLine verdict={verdict} />
      {!data.client.dialerActive ? (
        <p className="mt-3 flex items-start gap-2 text-xs">
          <span
            aria-hidden
            className="mt-1 size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: STATUS_COLOR.warning }}
          />
          This client is switched off in the dialer, so no new leads reach the
          callers.
        </p>
      ) : null}
      {hasOfficial ? <Tiles data={data} s={s} /> : null}
      <CallRowsPart data={data} />
      {hasOfficial ? <LeadBar data={data} /> : null}
      <WaitingPart data={data} />
      <LostPart data={data} />
      <SourcesPart data={data} />
    </div>
  );
}

function VerdictLine({ verdict }: { verdict: CallCentreVerdict }) {
  const more = verdict.reasons.slice(1);
  return (
    <div>
      <p className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5 text-sm leading-6">
        <StatusChip
          size="md"
          tone={VERDICT_TONE[verdict.tone]}
          label={verdict.label}
          className="mt-px"
        />
        <span className="min-w-0 flex-1 basis-64">{verdict.why}</span>
      </p>
      {more.length ? <MoreLines lead="Also" items={more} /> : null}
      {verdict.watch.length ? (
        <MoreLines lead="Worth fixing" items={verdict.watch} />
      ) : null}
    </div>
  );
}

/**
 * "Worth fixing: the first one, and 2 more", the rest a tap away. The button
 * stays where it is and turns into "Show fewer", so focus never drops to the
 * page and the list folds again from the keyboard.
 */
function MoreLines({ lead, items }: { lead: string; items: string[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const rest = items.length - 1;
  return (
    <div className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
      <p>
        {lead}: {items[0]}
        {rest > 0 ? (
          <>
            {" "}
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen(v => !v)}
              className="no-touch relative rounded-sm font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 after:absolute after:-inset-2 after:content-[''] hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {open ? "Show fewer" : `and ${rest} more`}
            </button>
          </>
        ) : null}
      </p>
      {rest > 0 ? (
        <ul
          id={listId}
          hidden={!open}
          className="mt-1 list-disc space-y-1 pl-5"
        >
          {items.slice(1).map(t => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function NotMeasured() {
  return (
    <span className="text-base font-medium text-muted-foreground">
      {NOT_MEASURED}
    </span>
  );
}

const shown = (text: string) =>
  text === NOT_MEASURED ? <NotMeasured /> : text;

function lineChip(met: boolean | null, good: string, bad: string) {
  if (met === null) return undefined;
  return (
    <StatusChip tone={met ? "good" : "warning"} label={met ? good : bad} />
  );
}

function Tiles({ data, s }: { data: CallCentre; s: CallCentreSummary }) {
  const slowLine = CALL_RULES.firstCallWorkMinutes;
  const inH = data.speed.inHours;
  const outH = data.speed.outOfHours;
  const followJudged =
    s.followUpCalls !== null && s.followUpLeads >= CALL_RULES.followUpMinLeads;
  const tile = (
    label: string,
    value: ReactNode,
    extra: { sub?: ReactNode; status?: ReactNode; hint: string },
  ) => (
    <StatTile
      key={label}
      variant="plain"
      className="rounded-xl bg-muted/40 p-3"
      label={label}
      value={value}
      sub={extra.sub}
      status={extra.status}
      hint={extra.hint}
    />
  );
  const lines = (...parts: (string | null | false)[]) => {
    const kept = parts.filter(Boolean) as string[];
    return kept.length
      ? kept.map(t => (
          <span key={t} className="block">
            {t}
          </span>
        ))
      : undefined;
  };
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 @2xl:grid-cols-4">
      {tile("First call", shown(formatDuration(s.firstCallWorkSeconds)), {
        status: lineChip(
          s.firstCallWorkSeconds === null
            ? null
            : s.firstCallWorkSeconds <= slowLine * 60,
          `${slowLine} min line met`,
          `Over ${slowLine} min line`,
        ),
        sub: lines(
          "Median, in working time",
          s.withinFiveRate !== null &&
            `${formatRate(s.withinFiveRate)} within ${FIRST_CALL_MINUTES} min`,
        ),
        hint: `Median time to the first verified call, counted in the callers' working hours (the dialer's report). The line is ${slowLine} min; the checklist asks for ${FIRST_CALL_MINUTES}. Leads in working hours: half called within ${formatDuration(inH.medianClockSeconds)}, ${formatRate(rate(inH.withinFiveMinutes, inH.leads))} within 5 min. Out of hours: half called within ${formatDuration(outH.medianClockSeconds)}.`,
      })}
      {tile("Dials", s.dials === null ? <NotMeasured /> : count(s.dials), {
        status: followJudged
          ? lineChip(
              (s.followUpCalls ?? 0) >= CALL_RULES.followUpCalls,
              "Retries on line",
              "Thin retries",
            )
          : undefined,
        sub: lines(
          // Not dials / leads: the calls to these dates' leads, per lead.
          s.dialsPerLead !== null &&
            `${formatPerLead(s.dialsPerLead)} per lead from these dates`,
          followJudged &&
            `${formatPerLead(s.followUpCalls)} in 3 days if unanswered (line ${CALL_RULES.followUpCalls})`,
        ),
        hint: `Verified Maqsam calls made for this client in these dates. Per lead counts every call to these dates' leads so far. ${count(s.outcomesWithoutCall)} outcome${s.outcomesWithoutCall === 1 ? "" : "s"} saved without a call ${s.outcomesWithoutCall === 1 ? "is" : "are"} not counted. A lead who does not answer should get ${CALL_RULES.followUpCalls} calls in 3 days; the checklist asks for ${FOLLOW_UP_ATTEMPTS}.`,
      })}
      {tile("Answered", shown(formatRate(s.reachedPerDial)), {
        status: lineChip(
          s.reachedPerDial === null ? null : s.reachedPerDial >= REACHED_GATE,
          `${REACHED_GATE}% line met`,
          `Under ${REACHED_GATE}% line`,
        ),
        sub: lines(
          "Of dials",
          s.reachedPerLeadCalled !== null &&
            `${formatRate(s.reachedPerLeadCalled)} of leads called`,
        ),
        hint: `Calls answered per dial, the dialer's official rate; voicemail counts as answered. Per lead called is beside it for context. Talks over 2 minutes: ${formatRate(s.talked120PerDial)} of dials (the line is ${CONVERSATION_GATE}%).`,
      })}
      {tile("Booked", shown(formatRate(s.bookedRate)), {
        status: lineChip(
          s.bookedRate === null ? null : s.bookedRate >= BOOKING_RATE_GATE,
          `${BOOKING_RATE_GATE}% line met`,
          `Under ${BOOKING_RATE_GATE}% line`,
        ),
        sub: lines(
          s.confirmed !== null &&
            s.leads !== null &&
            `${count(s.confirmed)} confirmed of ${count(s.leads)} leads`,
          Boolean(s.provisional) &&
            `${count(s.provisional)} provisional, not counted`,
        ),
        hint: "Confirmed bookings per lead, from the dialer's report. Provisional bookings are shown apart and not counted in the rate.",
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Campaigns and ads: the media buyer's part, right under the tiles.

type Grain = "campaign" | "ad";

function rowName(row: CallRow, grain: Grain): string {
  if (row.name) return row.name;
  const id = row.id ?? "";
  const tail = id.length > 6 ? `…${id.slice(-6)}` : id;
  return grain === "ad" ? `Ad ${tail} (no name)` : `Campaign ${tail} (no name)`;
}

const GRAINS = [
  ["campaign", "By campaign"],
  ["ad", "By ad"],
] as const;

function CallRowsPart({ data }: { data: CallCentre }) {
  const [picked, setGrain] = useState<Grain>("campaign");
  const [all, setAll] = useState(false);
  const [ref, width] = useWidth<HTMLDivElement>();
  const counts = { campaign: data.byCampaign.length, ad: data.byAd.length };
  // A split with no rows has no pill (zero-count chips hide); the other
  // split stands in for it.
  const grains = GRAINS.filter(([key]) => counts[key] > 0);
  const grain =
    counts[picked] > 0 ? picked : (grains[0]?.[0] ?? ("campaign" as Grain));
  const rows = grain === "campaign" ? data.byCampaign : data.byAd;
  const visible = all ? rows : rows.slice(0, ROWS_SHOWN);
  const outside = leadsOutsideRows(rows, data.clientAverage);
  const wide = width >= TABLE_WIDTH;
  return (
    <div className="mt-6 border-t pt-4" ref={ref}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <h4 className="text-[13px] font-semibold">Campaigns and ads</h4>
          {/* The tiles count dials in the dates and rates per lead or dial;
              these follow the leads, so the qualifier is said, not hovered. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Dials are the calls to these dates' leads; answered and booked are
            per lead called, provisional included.
          </p>
        </div>
        {grains.length ? (
          <div
            role="group"
            aria-label="Split the calls by"
            className="flex shrink-0 gap-1"
          >
            {grains.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={grain === key}
                onClick={() => {
                  setGrain(key);
                  setAll(false);
                }}
                className={cn(
                  "inline-flex h-8 items-center whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors",
                  grain === key
                    ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
                <span className="ml-1.5 tabular-nums opacity-70">
                  {counts[key]}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No lead in these dates carries a campaign or an ad id, so there is
          nothing to split. The totals above still count every lead.
        </p>
      ) : wide ? (
        <RowsTable rows={visible} grain={grain} average={data.clientAverage} />
      ) : (
        <RowsStacked
          rows={visible}
          grain={grain}
          average={data.clientAverage}
        />
      )}
      {rows.length > ROWS_SHOWN ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll(v => !v)}
          className="mt-3 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {all ? "Show fewer" : `Show the other ${rows.length - ROWS_SHOWN}`}
        </button>
      ) : null}
      {rows.length > 0 && outside > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {count(outside)} lead{outside === 1 ? " has" : "s have"} no{" "}
          {grain === "campaign" ? "campaign" : "ad"} on file: counted in the
          client average, in no row.
        </p>
      ) : null}
    </div>
  );
}

type Cell = { key: string; label: string; title: string; value: string };

function cells(row: CallRow): Cell[] {
  const r = rowRates(row);
  return [
    {
      key: "leads",
      label: "Leads",
      title: "Leads that came in these dates",
      value: count(row.leads),
    },
    {
      key: "called",
      label: "Called",
      title: "Share of its leads with a verified call",
      value: formatRate(r.calledRate),
    },
    {
      key: "dials",
      label: "Dials",
      title: "Verified calls to its leads",
      value: count(row.dials),
    },
    {
      key: "perLead",
      label: "Per lead",
      title: "Dials per lead",
      value: formatPerLead(r.dialsPerLead),
    },
    {
      key: "answered",
      label: "Answered",
      title: "Reached per lead called; voicemail counts",
      value: formatRate(r.answeredRate),
    },
    {
      key: "booked",
      label: "Booked",
      title: "Booked per lead called, provisional included",
      value: formatRate(r.bookedRate),
    },
    {
      key: "first",
      label: "First call",
      title: "Median time to the first call, clock time",
      value: formatDuration(row.medianFirstCallSeconds),
    },
  ];
}

/** "Not measured" may wrap in a narrow cell, and reads quieter than a number. */
const muteMissing = (v: string) =>
  v === NOT_MEASURED
    ? "whitespace-normal text-xs font-normal text-muted-foreground"
    : "";

/** Too few leads to judge: its numbers read quieter, not as a result. */
const unjudged = (flag: RowFlag | null) => flag?.kind === "too_few";

function RowName({
  row,
  grain,
  flag,
}: {
  row: CallRow;
  grain: Grain;
  flag: RowFlag | null;
}) {
  const tone = flag ? FLAG_TONE[flag.kind] : "neutral";
  // Every judgement but "in line" is said in words under the name, too few
  // leads included, so a grey dot never passes for an ordinary row.
  const says = flag && flag.kind !== "even";
  const label = flag ? flag.why : "The client's own average";
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-[7px] inline-flex" title={label}>
        <StatusDot tone={tone} label={label} />
      </span>
      <div className="min-w-0">
        <p
          className="line-clamp-2 break-words text-[13px] font-medium"
          dir="auto"
          title={row.id ?? undefined}
        >
          {flag ? rowName(row, grain) : "Client average"}
        </p>
        {grain === "ad" && flag && row.campaignName ? (
          <p className="truncate text-xs text-muted-foreground" dir="auto">
            {row.campaignName}
          </p>
        ) : null}
        {says ? (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {flag.why}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function RowsTable({
  rows,
  grain,
  average,
}: {
  rows: CallRow[];
  grain: Grain;
  average: CallRow | null;
}) {
  const head = cells(rows[0]);
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm" data-layout="table">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">
              {grain === "campaign" ? "Campaign" : "Ad"}
            </th>
            {head.map(c => (
              <th
                key={c.key}
                scope="col"
                title={c.title}
                className="whitespace-nowrap px-2 py-2 text-right font-medium"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row, i) => {
            const flag = rowFlag(row, average);
            return (
              <tr key={row.id ?? i} className="align-top">
                <td className="max-w-[22rem] py-2.5 pr-3">
                  <RowName row={row} grain={grain} flag={flag} />
                </td>
                {cells(row).map(c => (
                  <td
                    key={c.key}
                    className={cn(
                      "whitespace-nowrap px-2 py-2.5 text-right text-[13px] tabular-nums",
                      unjudged(flag) && "text-muted-foreground",
                      muteMissing(c.value),
                    )}
                  >
                    {c.value}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {average ? (
          <tfoot>
            <tr className="border-t bg-muted/40 align-top">
              <td className="rounded-l-lg py-2.5 pr-3 pl-0">
                <RowName row={average} grain={grain} flag={null} />
              </td>
              {cells(average).map((c, i, list) => (
                <td
                  key={c.key}
                  className={cn(
                    "whitespace-nowrap px-2 py-2.5 text-right text-[13px] tabular-nums text-muted-foreground",
                    i === list.length - 1 && "rounded-r-lg",
                  )}
                >
                  {c.value}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function RowsStacked({
  rows,
  grain,
  average,
}: {
  rows: CallRow[];
  grain: Grain;
  average: CallRow | null;
}) {
  const block = (row: CallRow, flag: RowFlag | null) => (
    <>
      <RowName row={row} grain={grain} flag={flag} />
      <dl className="mt-2 grid grid-cols-4 gap-x-2 gap-y-2 pl-3.5">
        {cells(row).map(c => (
          // A label that cannot fit wraps rather than cuts, and the number
          // under it keeps the row's line (the cell grows, the label takes it).
          <div key={c.key} className="flex min-w-0 flex-col" title={c.title}>
            <dt className="flex-1 font-mono text-[10px] uppercase leading-tight tracking-[0.04em] text-muted-foreground">
              {c.label}
            </dt>
            <dd
              className={cn(
                "mt-0.5 whitespace-nowrap text-[13px] font-semibold tabular-nums",
                unjudged(flag) && "font-normal text-muted-foreground",
                muteMissing(c.value),
              )}
            >
              {c.value}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
  return (
    <ul className="mt-2 divide-y" data-layout="stacked">
      {rows.map((row, i) => (
        <li key={row.id ?? i} className="py-3">
          {block(row, rowFlag(row, average))}
        </li>
      ))}
      {/* Pulled out by its own padding, so its numbers sit in the same
          columns as the rows above and get the same width. */}
      {average ? (
        <li className="-mx-2 mt-1 rounded-xl bg-muted/40 px-2 py-3">
          {block(average, null)}
        </li>
      ) : null}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The lead bar: every lead, deeper the further it got; the gap is the leads
// nobody called.

function LeadBar({ data }: { data: CallCentre }) {
  const o = data.official;
  if (!o || o.leads <= 0) return null;
  const share = (n: number) => Math.max(0, Math.min(100, (n / o.leads) * 100));
  const steps: {
    key: keyof typeof DEPTH | "leads";
    label: string;
    value: number;
  }[] = [
    { key: "leads", label: "Leads", value: o.leads },
    { key: "called", label: "Called", value: o.leadsDialed },
    { key: "answered", label: "Answered", value: o.leadsContacted },
    { key: "talked", label: "Talked 2 min+", value: data.cohort.talked120 },
    { key: "booked", label: "Booked", value: o.confirmedBookings },
    { key: "showed", label: "Showed", value: o.shows },
  ];
  const gap = Math.max(0, o.leads - o.leadsDialed);
  const nc = data.notCalled;
  const causes = [
    nc.noPhone > 0 && `${count(nc.noPhone)} have no phone on the lead`,
    nc.unreadablePhone > 0 &&
      `${count(nc.unreadablePhone)} have a phone the dialer cannot read`,
    nc.dialledUnderAnotherLead > 0 &&
      `${count(nc.dialledUnderAnotherLead)} were dialled under another lead with the same phone`,
    nc.neverDialled > 0 &&
      `${count(nc.neverDialled)} were never dialled${
        nc.neverDialledOutsideDialerCountries || nc.neverDialledWithSavedOutcome
          ? ` (${[
              nc.neverDialledOutsideDialerCountries > 0 &&
                `${count(nc.neverDialledOutsideDialerCountries)} outside the dialer's countries`,
              nc.neverDialledWithSavedOutcome > 0 &&
                `${count(nc.neverDialledWithSavedOutcome)} with an outcome saved but no call`,
            ]
              .filter(Boolean)
              .join("; ")})`
          : ""
      }`,
  ].filter(Boolean) as string[];
  const described = steps
    .slice(1)
    .map(st => `${count(st.value)} ${st.label.toLowerCase()}`)
    .join(", ");
  return (
    <div className="mt-6 border-t pt-4">
      <h4 className="text-[13px] font-semibold">Where the leads got to</h4>
      <div
        role="img"
        aria-label={`${count(o.leads)} leads: ${described}; ${count(gap)} not called yet.`}
        className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-muted"
        style={{ backgroundImage: HATCH }}
      >
        {steps.slice(1).map(st => (
          <span
            key={st.key}
            className="absolute inset-y-0 left-0 rounded-r-full"
            style={{
              width: `${share(st.value)}%`,
              backgroundColor: tint(DEPTH[st.key as keyof typeof DEPTH]),
            }}
          />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-3 @xl:grid-cols-6">
        {steps.map(st => (
          <div key={st.key} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {st.key !== "leads" ? (
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-[3px]"
                  style={{
                    backgroundColor: tint(DEPTH[st.key as keyof typeof DEPTH]),
                  }}
                />
              ) : null}
              <span className="truncate">{st.label}</span>
            </dt>
            <dd className="text-[15px] font-semibold tabular-nums">
              {count(st.value)}
            </dd>
            <dd className="text-[11px] text-muted-foreground tabular-nums">
              {st.key === "leads"
                ? "in these dates"
                : `${formatRate(rate(st.value, o.leads))} of leads`}
            </dd>
          </div>
        ))}
      </dl>
      {gap > 0 ? (
        <details className="mt-3">
          <summary className="text-[13px]">
            <span
              aria-hidden
              className="mr-1.5 inline-block size-2 rounded-[3px] bg-muted align-middle"
              style={{ backgroundImage: HATCH }}
            />
            <span className="font-medium">Not called yet: {count(gap)}</span>
            <span className="ml-1.5 text-muted-foreground">
              {formatRate(rate(gap, o.leads))} of leads. Why
            </span>
          </summary>
          {causes.length ? (
            <div className="mt-2 pl-5 text-xs text-muted-foreground">
              {nc.total !== gap ? (
                <p className="mb-1">
                  Counted lead by lead, {count(nc.total)} have no verified call:
                </p>
              ) : null}
              <ul className="list-disc space-y-1 pl-4">
                {causes.map(c => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-2 pl-5 text-xs text-muted-foreground">
              The read could not say why for these leads.
            </p>
          )}
        </details>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Who is waiting now.

function WaitingPart({ data }: { data: CallCentre }) {
  const w = data.waiting;
  const u = w.untouched;
  const cb = w.callbacks;
  const mi = w.missedInbound;
  const stuck = w.stages.reduce((n, st) => n + st.overSevenDays, 0);
  const open = w.stages.reduce((n, st) => n + st.count, 0);
  // The headline is built from the same lines the body shows, so it never
  // says "nothing" over a list of waiting leads.
  const headline = waitingHeadline({
    untouched: u.count,
    callbacks: cb.count,
    overdue: cb.overdue,
    notReturned: mi.never,
    stuck,
  });
  const waits = headline.length > 0;
  // The 90% line is a Maqsam call (2026-10-16): said under the first line,
  // which warns under it. A read without the called count shows neither.
  // The waiting list stays the touched rule, so on the new read it is worded
  // as a call or a saved outcome, never as contact.
  const line = calledLines(data);
  const stages = [...w.stages].sort(
    (a, b) => (a.position ?? 99) - (b.position ?? 99),
  );
  return (
    <details open={waits} className="mt-6 border-t pt-4">
      <summary className="text-[13px] font-semibold">
        Waiting now{" "}
        <span className="font-normal text-muted-foreground">
          {waits
            ? headline.join(" · ")
            : open > 0
              ? "nothing overdue"
              : "nothing is waiting"}
        </span>
      </summary>
      <ul className="mt-3 space-y-2.5 text-[13px] leading-5">
        <WaitLine
          tone={u.count > 0 || line?.under ? "warning" : "good"}
          label={
            u.count === 0 && line?.under ? "Under the 90% line" : undefined
          }
        >
          {u.count > 0 ? (
            <>
              {count(u.count)} lead{u.count === 1 ? " was" : "s were"} not
              called or messaged after a working hour
              {u.oldestWorkSeconds !== null
                ? `; the oldest has waited ${formatDuration(u.oldestWorkSeconds)} of working time`
                : ""}
              {u.oldestAt
                ? ` (came in ${dateTime(Date.parse(u.oldestAt))})`
                : ""}
              .
            </>
          ) : w.callable > 0 ? (
            <>
              Every lead older than a working hour{" "}
              {!line
                ? "was called or messaged"
                : line.outcomeOnly
                  ? "has a Maqsam call or a saved outcome"
                  : "has a call on Maqsam"}{" "}
              ({count(w.touched)} of {count(w.callable)}).
            </>
          ) : (
            <>No lead in these dates is old enough to be waiting.</>
          )}
          {line && w.callable > 0 ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {line.called}
              {line.outcomeOnly ? (
                <span className="block">{line.outcomeOnly}</span>
              ) : null}
            </span>
          ) : null}
        </WaitLine>
        {cb.count > 0 ? (
          <WaitLine tone={cb.overdue > 0 ? "warning" : "neutral"}>
            {count(cb.count)} callback{cb.count === 1 ? "" : "s"} waiting:{" "}
            {count(cb.overdue)} overdue, {count(cb.overThreeDays)} untouched for
            over 3 days.
          </WaitLine>
        ) : null}
        {mi.count > 0 ? (
          <WaitLine tone={mi.never > 0 ? "warning" : "neutral"}>
            {count(mi.count)} missed call{mi.count === 1 ? "" : "s"} from{" "}
            {count(mi.callers)} number{mi.callers === 1 ? "" : "s"}:{" "}
            {count(mi.withinFifteenMinutes)} called back within 15 min,{" "}
            {count(mi.never)} never.
          </WaitLine>
        ) : null}
      </ul>
      {stages.length ? (
        <div className="mt-4">
          <p className="text-xs text-muted-foreground">
            Open leads by stage in the new leads pipeline
          </p>
          <ul className="mt-1.5 divide-y text-[13px]">
            {stages.map(st => (
              <li
                key={st.stage}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5"
              >
                <span className="min-w-0 flex-1 basis-40" dir="auto">
                  {st.stage}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  <span className="font-semibold text-foreground">
                    {count(st.count)}
                  </span>{" "}
                  · median {formatDuration(daysToSeconds(st.medianDays))} ·
                  oldest {formatDuration(daysToSeconds(st.oldestDays))}
                  {st.overSevenDays > 0 ? (
                    <>
                      {" · "}
                      <span className="inline-flex items-center gap-1">
                        <StatusDot tone="warning" label="Over a week" />
                        {count(st.overSevenDays)} over a week
                      </span>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  );
}

const daysToSeconds = (d: number | null) => (d === null ? null : d * 86400);

function WaitLine({
  tone,
  label,
  children,
}: {
  tone: StatusTone;
  /** What the dot says, when the tone's own words do not fit. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[7px] inline-flex">
        <StatusDot
          tone={tone}
          label={
            label ??
            (tone === "warning"
              ? "Waiting too long"
              : tone === "good"
                ? "On time"
                : "For information")
          }
        />
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Why leads were lost, with the call to play.

type Lost = CallCentre["lost"]["latest"][number];

type PlayerState =
  | { row: string; status: "loading" }
  | { row: string; status: "ready"; url: string }
  | { row: string; status: "error"; message: string };

/**
 * One recording at a time, fetched only when Play is pressed. The audio is a
 * blob URL (an <audio> tag cannot send the seat's token), released when the
 * player closes, another call plays, or the page goes.
 */
function usePlayer() {
  const [state, setState] = useState<PlayerState | null>(null);
  const url = useRef<string | null>(null);
  const turn = useRef(0);
  const release = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  };
  useEffect(
    () => () => {
      turn.current += 1;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
    },
    [],
  );
  const play = async (row: string, callId: string) => {
    const mine = ++turn.current;
    release();
    setState({ row, status: "loading" });
    const res = await loadRecording(callId);
    if (mine !== turn.current) return;
    if (!res.ok) {
      setState({ row, status: "error", message: res.message });
      return;
    }
    url.current = URL.createObjectURL(res.blob);
    setState({ row, status: "ready", url: url.current });
  };
  const close = () => {
    turn.current += 1;
    release();
    setState(null);
  };
  return { state, play, close };
}

function LostPart({ data }: { data: CallCentre }) {
  const lost = data.lost;
  const [all, setAll] = useState(false);
  const player = usePlayer();
  const rows = all ? lost.latest : lost.latest.slice(0, LOST_SHOWN);
  const un = lost.unreachable;
  return (
    <div className="mt-6 border-t pt-4">
      <h4 className="text-[13px] font-semibold">
        Why leads were lost{" "}
        <span className="font-normal text-muted-foreground">
          {lost.total > 0
            ? `${count(lost.total)} marked lost in the dialer`
            : "none marked lost"}
        </span>
      </h4>
      {lost.total === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No lead was marked lost in the dialer in these dates.
        </p>
      ) : (
        <>
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Lost reasons">
            {lost.reasons.map(r => (
              <li
                key={r.key}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs"
              >
                {lostLabel(r.key)}
                <span className="font-semibold tabular-nums">
                  {count(r.count)}
                </span>
              </li>
            ))}
          </ul>
          {un.leads > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Of the {count(un.leads)} who could not be reached,{" "}
              {count(un.fourPlus)} got 4 or more calls and {count(un.noCall)}{" "}
              had no verified call.
            </p>
          ) : null}
          {rows.length ? (
            <ul className="mt-3 divide-y" aria-label="Latest lost leads">
              {rows.map((lead, i) => {
                const key = `${lead.at}-${i}`;
                return (
                  <LostRow
                    key={key}
                    lead={lead}
                    state={player.state?.row === key ? player.state : null}
                    onPlay={id => void player.play(key, id)}
                    onClose={player.close}
                  />
                );
              })}
            </ul>
          ) : null}
          {lost.latest.length > LOST_SHOWN ? (
            <button
              type="button"
              aria-expanded={all}
              onClick={() => setAll(v => !v)}
              className="mt-2 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {all
                ? "Show fewer"
                : `Show the other ${lost.latest.length - LOST_SHOWN}`}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function LostRow({
  lead,
  state,
  onPlay,
  onClose,
}: {
  lead: Lost;
  state: PlayerState | null;
  onPlay: (callId: string) => void;
  onClose: () => void;
}) {
  const name = lead.firstName ?? "A lead";
  // [text, keep on one line]: short facts never break inside themselves.
  const meta = (
    [
      [shortDate(lead.day), true],
      [
        lead.adName ??
          (lead.adId ? `Ad …${lead.adId.slice(-6)}` : "No ad on file"),
        false,
      ],
      [`${count(lead.calls)} call${lead.calls === 1 ? "" : "s"}`, true],
      [
        lead.longestSeconds !== null
          ? `longest ${formatCallLength(lead.longestSeconds)}`
          : null,
        true,
      ],
      [lead.agent, false],
    ] as [string | null, boolean][]
  ).filter((m): m is [string, boolean] => Boolean(m[0]));
  const callId = lead.longestCallId;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm">
            <span className="font-semibold" dir="auto">
              {name}
            </span>
            <span className="text-muted-foreground">
              {" "}
              · {lostLabel(lead.key)}
            </span>
          </p>
          {lead.note ? (
            <p className="mt-0.5 text-[13px] leading-5" dir="auto">
              {lead.note}
            </p>
          ) : null}
          {/* Each part isolated, so an Arabic ad name keeps its place. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {meta.map(([m, nowrap], i) => (
              <span key={`${i}-${m}`}>
                {i > 0 ? " · " : null}
                <bdi className={nowrap ? "whitespace-nowrap" : undefined}>
                  {m}
                </bdi>
              </span>
            ))}
          </p>
        </div>
        {callId ? (
          state && state.status !== "error" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1.5"
              onClick={onClose}
              aria-label={`Close the call with ${name}`}
            >
              {state.status === "loading" ? (
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <X aria-hidden />
              )}
              {state.status === "loading" ? "Loading" : "Close"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1.5"
              onClick={() => onPlay(callId)}
              aria-label={`Play the longest call with ${name}, ${formatCallLength(lead.longestSeconds)}`}
            >
              <Play aria-hidden />
              Play
            </Button>
          )
        ) : (
          <span className="shrink-0 pt-1.5 text-xs text-muted-foreground">
            {lead.calls > 0 ? "No answered call to play" : "No call made"}
          </span>
        )}
      </div>
      {state?.status === "loading" ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          Fetching the recording from Maqsam…
        </p>
      ) : state?.status === "ready" ? (
        <audio
          controls
          autoPlay
          src={state.url}
          className="mt-2 h-10 w-full"
          aria-label={`The call with ${name}`}
        >
          <track kind="captions" />
        </audio>
      ) : state?.status === "error" ? (
        <p role="alert" className="mt-2 flex items-start gap-2 text-xs">
          <CircleAlert
            className="mt-px size-3.5 shrink-0"
            style={{ color: STATUS_COLOR.warning }}
            aria-hidden
          />
          {state.message}
        </p>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Where the numbers come from.

function SourcesPart({ data }: { data: CallCentre }) {
  const c = data.coverage;
  const when = (iso: string | null) =>
    iso ? dateTime(Date.parse(iso)) : "not known";
  const sentence = (n: number, one: string, many: string) =>
    n > 0 ? `${count(n)} ${n === 1 ? one : many}` : null;
  const gaps = [
    sentence(
      c.unlinkedCalls,
      "outbound call in these dates is linked to no client",
      "outbound calls in these dates are linked to no client",
    ),
    sentence(c.leadsWithoutPhone, "lead has no phone", "leads have no phone"),
    sentence(
      c.leadsWithUnreadablePhone,
      "lead has a phone the dialer cannot read",
      "leads have a phone the dialer cannot read",
    ),
    sentence(
      c.leadsWithoutAdId,
      `lead has no ad id${c.metaLeadsWithoutAdId ? ` (${count(c.metaLeadsWithoutAdId)} from Meta)` : ""}, so it sits in no ad row`,
      `leads have no ad id${c.metaLeadsWithoutAdId ? ` (${count(c.metaLeadsWithoutAdId)} from Meta)` : ""}, so they sit in no ad row`,
    ),
    sentence(
      c.leadsOnlyInGhl,
      "lead is in GoHighLevel only, with no campaign or ad",
      "leads are in GoHighLevel only, with no campaign or ad",
    ),
  ].filter(Boolean) as string[];
  const dialled = data.callers.dialled;
  const others = data.callers.otherAccess;
  const lostOther = data.lost.otherNotes;
  return (
    <details className="mt-6 border-t pt-4 text-xs text-muted-foreground">
      <summary className="text-[13px] font-medium text-foreground">
        Where these numbers come from
      </summary>
      <div className="mt-3 space-y-3 leading-5">
        <p>
          {`Leads that came in ${shortDate(data.from)} to ${shortDate(data.to)}, Kuwait days. Newest call for this client ${when(c.newestClientCallAt)}; newest outcome saved ${when(c.newestClientAttemptAt)}; leads synced ${when(c.leadSyncAt)}. Read ${when(data.generatedAt)}.`}
        </p>
        <p>
          The lead bar counts leads: talked 2 min+ is per lead, the rest is the
          dialer's report.
          {data.messages.handled > 0
            ? ` ${count(data.messages.handled)} lead${data.messages.handled === 1 ? " was" : "s were"} handled by message.`
            : ""}
          {lostOther.total > 0
            ? ` ${count(lostOther.sorted)} of ${count(lostOther.total)} lost notes under Other were sorted by keyword.`
            : ""}
        </p>
        {dialled.length ? (
          <p>
            Dials by caller:{" "}
            {dialled.map(d => `${d.name} ${count(d.dials)}`).join(", ")}.
            {others.length
              ? ` Also on this client in the dialer, not callers: ${others
                  .map(o => `${o.name} (${o.why.toLowerCase()})`)
                  .join(", ")}.`
              : ""}
          </p>
        ) : null}
        {gaps.length ? (
          <div>
            <p>What the numbers leave out:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {gaps.map(g => (
                <li key={g}>{g}.</li>
              ))}
            </ul>
          </div>
        ) : null}
        {data.notes.length ? (
          <ul className="list-disc space-y-0.5 pl-5">
            {data.notes.map(n => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
