import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Download,
  KeyRound,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FilterChips } from "@/components/ceo/FilterChips";
import { kuwaitDay, relative, shiftMonth } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { useNow } from "@/components/ceo/useCeo";
import { Button } from "@/components/ui/button";
import type { HoursStatus, HoursView, SyncResult } from "@/lib/ceoHoursClient";
import { api, useAction } from "@/lib/cockpitApi";
import type { PersonMonth, SourceStatus, Ym } from "@/types/ceo/hoursContract";
import { ApproveDialog } from "./ApproveDialog";
import { ConnectionsCard } from "./ConnectionsCard";
import { HoursMonthView } from "./HoursMonthView";
import {
  goToConnections,
  PROVIDER_NAME,
  sentenceAway,
  sourceSentence,
} from "./hoursCopy";
import { monthLabel } from "./hoursFormat";
import { LeaveTypes } from "./LeaveTypes";
import { LinkAccounts } from "./LinkAccounts";
import { PeopleRules } from "./PeopleRules";
import { PersonSheet } from "./PersonSheet";
import { type HoursViewKey, useHoursHash } from "./useHoursHash";

/**
 * Hours, leave and pay on Team & payroll (design 5.2): the Connections card,
 * then Hours and pay with four views in a segmented control. The month and
 * the view live in the address hash. The CEO's one job here is to decide
 * whether each person's pay for the month is right, then approve it; the
 * card asks only the four questions in design 4.5 and says everything else
 * as a note.
 */

const VIEWS: { key: HoursViewKey; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "people", label: "People and rules" },
  { key: "links", label: "Link accounts" },
  { key: "leave", label: "Leave types" },
];

/** Six months back is the limit of Hubstaff's 10-minute records. */
export const MONTHS_BACK = 6;

function errorText(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return raw.split("\n")[0].trim() || fallback;
}

/** "Hubstaff read 14 min ago · Timetastic read 14 min ago · Rule hours-1". */
function freshness(sources: SourceStatus[], rule: string, now: number): string {
  const parts = (["hubstaff", "timetastic"] as const).map(p => {
    const s = sources.find(x => x.provider === p);
    const at = s?.lastOkAt ? Date.parse(s.lastOkAt) : null;
    return at
      ? `${PROVIDER_NAME[p]} read ${relative(at, now)}`
      : `${PROVIDER_NAME[p]} not read yet`;
  });
  // A non-breaking hyphen: "hours-1" never wraps after "hours-".
  return [...parts, `Rule ${rule.replace(/-/g, "\u2011")}`].join(" · ");
}

/** Which empty state the month shows, if any (design 5.9). */
export function emptyState(
  view: HoursView,
): "nothing_connected" | "never_read" | "month_unread" | null {
  const states = view.sources.map(s => s.state);
  if (states.length && states.every(s => s === "missing_key"))
    return "nothing_connected";
  if (
    states.length &&
    view.sources.every(s => !s.lastOkAt) &&
    states.every(s => s !== "missing_key")
  )
    return "never_read";
  const cov = view.inputs.coverage;
  if (!cov.hubstaff?.length && !cov.timetastic?.length) return "month_unread";
  return null;
}

export function HoursAndPay({ order = 1 }: { order?: number }) {
  const now = useNow();
  const thisMonth = kuwaitDay(now).slice(0, 7);
  const [place, setPlace] = useHoursHash(thisMonth);
  const readMonth = useAction(api.ceo.hours.month);
  const readStatus = useAction(api.ceo.hours.status);
  const syncNow = useAction(api.ceo.hours.syncNow);
  const [view, setView] = useState<HoursView | null>(null);
  const [status, setStatus] = useState<HoursStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<PersonMonth[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const month = place.month;
  const latest = useRef(month);
  latest.current = month;

  const loadStatus = useCallback(async () => {
    try {
      setStatus((await readStatus({})) as HoursStatus);
      setStatusError(null);
    } catch (e) {
      setStatusError(errorText(e, "The connections could not be read."));
    }
  }, [readStatus]);

  const loadMonth = useCallback(
    async (m: Ym) => {
      setLoading(true);
      try {
        const v = (await readMonth({ month: m })) as HoursView;
        if (latest.current !== m) return;
        setView(v);
        setError(null);
      } catch (e) {
        if (latest.current !== m) return;
        setError(
          errorText(e, `The hours for ${monthLabel(m)} could not be read.`),
        );
      } finally {
        if (latest.current === m) setLoading(false);
      }
    },
    [readMonth],
  );

  const refresh = useCallback(async () => {
    await Promise.all([loadStatus(), loadMonth(latest.current)]);
  }, [loadStatus, loadMonth]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);
  useEffect(() => {
    void loadMonth(month);
  }, [month, loadMonth]);

  const earliest = shiftMonth(thisMonth, -MONTHS_BACK) ?? thisMonth;
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const canPrev = prev !== null && prev >= earliest;
  const canNext = next !== null && next <= thisMonth;

  const sync = async (args: Record<string, unknown>, started: string) => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const out = (await syncNow(args)) as SyncResult;
      setSyncMsg(
        out.ok
          ? started
          : "A read is already running. It finishes in about a minute.",
      );
      window.setTimeout(() => void refresh(), 5000);
    } catch (e) {
      setSyncMsg(errorText(e, "The read did not start."));
    } finally {
      setSyncing(false);
    }
  };

  const monthSwitcher = (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        disabled={!canPrev}
        aria-label="Previous month"
        onClick={() => prev && setPlace({ month: prev, person: null })}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <span className="min-w-[7.5rem] text-center text-sm font-medium tabular-nums">
        {`${monthLabel(month)} ${month.slice(0, 4)}`}
      </span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        disabled={!canNext}
        aria-label="Next month"
        onClick={() => next && setPlace({ month: next, person: null })}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );

  // The month on screen: the old one stays dimmed only while the same month reloads.
  const shown = view && view.month === month ? view : null;
  const empty = shown ? emptyState(shown) : null;
  // Only what breaks a read repeats above the tiles; a key that expires
  // soon or waits to be checked is said once, on Connections.
  const problems = (shown?.sources ?? []).filter(s =>
    [
      "refused",
      "plan_blocked",
      "needs_new_key",
      "firewall_blocked",
      "failing",
      "stale",
    ].includes(s.state),
  );
  const mName = monthLabel(month);

  let body: ReactNode;
  if (error && !shown)
    body = (
      <EmptyState
        icon={CircleDashed}
        title={error}
        text="The hours read from the database failed. Try again; nothing was changed."
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden />
            Try again
          </Button>
        }
        compact
      />
    );
  else if (!shown)
    body = (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {`Reading ${mName}`}
      </p>
    );
  else if (empty === "nothing_connected" && place.view === "month")
    body = (
      <EmptyState
        icon={KeyRound}
        title="Paste the Hubstaff and Timetastic keys in Connections to see hours and leave."
        text="Until then, hours show as no data and nobody's pay is worked out from them."
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={goToConnections}
          >
            <ArrowUp aria-hidden />
            Open Connections
          </Button>
        }
        compact
      />
    );
  else if (empty === "never_read" && place.view === "month")
    body = (
      <EmptyState
        icon={CircleDashed}
        title="Nothing has been read yet."
        text="The first read starts when a key is saved and takes about a minute. If the month is still empty after that, press Sync now."
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={syncing}
            onClick={() =>
              void sync(
                { mode: "recent" },
                "Reading now. This card fills in when it finishes.",
              )
            }
          >
            <RefreshCw aria-hidden />
            Sync now
          </Button>
        }
        compact
      />
    );
  else if (empty === "month_unread" && place.view === "month")
    body = (
      <EmptyState
        icon={Download}
        title={`${mName} hasn't been read yet.`}
        text="Loading reads Hubstaff and Timetastic for the whole month. It takes about a minute."
        action={
          <Button
            type="button"
            size="sm"
            disabled={syncing}
            onClick={() =>
              void sync(
                { mode: "month", month },
                `Reading ${mName}. This card fills in when it finishes.`,
              )
            }
          >
            {syncing ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Download aria-hidden />
            )}
            {`Load ${mName}`}
          </Button>
        }
        compact
      />
    );
  else if (place.view === "people")
    body = (
      <PeopleRules view={shown} focus={place.person} onChanged={refresh} />
    );
  else if (place.view === "links")
    body = <LinkAccounts view={shown} status={status} onChanged={refresh} />;
  else if (place.view === "leave")
    body = <LeaveTypes view={shown} onChanged={refresh} />;
  else
    body = (
      <HoursMonthView
        view={shown}
        now={now}
        onOpen={id => setPlace({ person: id })}
        onApprove={setApproving}
        onGoLink={() => setPlace({ view: "links", person: null })}
        onGoLeave={() => setPlace({ view: "leave", person: null })}
      />
    );

  return (
    <>
      <ConnectionsCard
        status={status}
        error={statusError}
        now={now}
        onChanged={refresh}
        order={order}
      />
      <SectionCard
        id="team-hours"
        title="Hours and pay"
        description={
          shown ? freshness(shown.sources, shown.ruleVersion, now) : undefined
        }
        actions={monthSwitcher}
        order={order + 1}
      >
        <div className="grid gap-5">
          <FilterChips
            options={VIEWS}
            value={place.view}
            onChange={v => setPlace({ view: v, person: null })}
            ariaLabel="What to show"
          />
          {problems.length ? (
            <div className="ceo-stale flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm">
              <ul className="grid min-w-0 flex-1 basis-64 gap-1">
                {problems.map(s => {
                  const at = s.lastOkAt ? Date.parse(s.lastOkAt) : null;
                  const text = sourceSentence(s, {
                    ago: at ? relative(at, now) : undefined,
                  });
                  return (
                    <li key={s.provider}>{text ? sentenceAway(text) : null}</li>
                  );
                })}
              </ul>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={goToConnections}
              >
                <ArrowUp aria-hidden />
                Open Connections
              </Button>
            </div>
          ) : null}
          {error && shown ? (
            <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
          ) : null}
          {syncMsg ? (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {syncMsg}
            </p>
          ) : null}
          <div
            className={
              loading && shown ? "opacity-60 transition-opacity" : undefined
            }
            aria-busy={loading}
          >
            {body}
          </div>
        </div>
      </SectionCard>
      {shown ? (
        <>
          <PersonSheet
            view={shown}
            personId={place.view === "month" ? place.person : null}
            now={now}
            onClose={() => setPlace({ person: null })}
            onChanged={refresh}
            onApprove={p => setApproving([p])}
            onGoLink={() => setPlace({ view: "links", person: null })}
            onGoSettings={id => {
              setPlace({ view: "people", person: id });
              window.setTimeout(
                () =>
                  document
                    .getElementById(`hours-person-${id}`)
                    ?.scrollIntoView({ block: "center", behavior: "smooth" }),
                350,
              );
            }}
          />
          <ApproveDialog
            view={shown}
            people={approving}
            onClose={() => setApproving(null)}
            onDone={refresh}
          />
        </>
      ) : null}
    </>
  );
}
