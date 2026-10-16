/**
 * Client performance (/performance): the board every team member opens in
 * the meetings (Aziz, 2026-10-16). One row per client over a time frame,
 * the ad and business numbers against their targets, the appointments still
 * waiting for an outcome, each client's assigned caller, and a click on a
 * client for its campaigns, ad sets and ads and its levers.
 *
 * The route is open to every signed-in seat; the database decides who reads
 * what (any active seat, each client through cockpit_client_allowed).
 */
import {
  Columns3,
  Presentation,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Table2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FilterChips } from "@/components/ceo/FilterChips";
import { dateTime, isNum } from "@/components/ceo/format";
import { Kicker } from "@/components/ceo/Kicker";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  type Board,
  type ClientRow,
  DEFAULT_FRAME,
  FRAMES,
  type FrameKey,
  frameOf,
  kuwaitToday,
  rangeLabel,
  reloadBoard,
  reloadEveryRead,
  useBoard,
} from "@/lib/boardClient";
import {
  type BoardColumn,
  COLUMNS,
  formatValue,
  GROUPS,
  KEY_COLUMNS,
  noOutcomeTotal,
  portfolio,
} from "@/lib/boardColumns";
import { matchScore } from "@/lib/search";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { BoardGrid, BoardGridSkeleton, type Sort, sortRows } from "./BoardGrid";
import { ClientPanel } from "./ClientPanel";
import { BoardDot, Problem } from "./cells";
import { TargetsDialog } from "./TargetsDialog";

// ---------------------------------------------------------------------------
// The columns each viewer picked, remembered in this browser only.

const COLUMNS_KEY = "cockpit.board.columns.v1";
const MEETING_KEY = "cockpit.board.meeting.v1";
/** The meeting view: bigger type, the columns the room reads. */
export const MEETING_COLUMNS = [
  "caller",
  "spend",
  "cpl",
  "confirmedBookings",
  "leadToBooking",
  "showRate",
  "closeRate",
  "roas",
  "noOutcome",
];

function readStored<T>(key: string, check: (v: unknown) => T | null): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? check(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function store(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private window: the choice lasts this visit only.
  }
}
const known = new Set(COLUMNS.map(c => c.key));
function storedColumns(): string[] | null {
  return readStored(COLUMNS_KEY, v =>
    Array.isArray(v) && v.every(x => typeof x === "string")
      ? (v as string[]).filter(k => known.has(k))
      : null,
  );
}

// ---------------------------------------------------------------------------

function FrameControl({
  frame,
  today,
  custom,
  onPick,
  onCustom,
}: {
  frame: FrameKey;
  today: string;
  custom: { from: string; to: string };
  onPick: (key: FrameKey) => void;
  onCustom: (from: string, to: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <FilterChips
        ariaLabel="Time frame"
        value={frame}
        onChange={k => onPick(k)}
        options={FRAMES.map(f => ({ key: f.key, label: f.label }))}
      />
      {frame === "custom" ? (
        <div className="flex items-center gap-2">
          <DateInput
            aria-label="First day"
            className="ceo-select-sm"
            value={custom.from}
            max={today}
            onChange={e => onCustom(e.target.value, custom.to)}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <DateInput
            aria-label="Last day"
            className="ceo-select-sm"
            value={custom.to}
            max={today}
            onChange={e => onCustom(custom.from, e.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}

function Portfolio({ rows }: { rows: ClientRow[] }) {
  const totals = portfolio(rows);
  return (
    <section
      aria-label="Every client together"
      className="ceo-card @container rounded-2xl border bg-card px-4 py-4 sm:px-6"
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 @md:grid-cols-4 @4xl:grid-cols-8">
        {totals.map(t => (
          <div key={t.key} className="min-w-0">
            <dt>
              <Kicker as="span">{t.label}</Kicker>
            </dt>
            <dd className="mt-1 whitespace-nowrap text-lg font-semibold leading-7 tracking-tight tabular-nums @md:text-xl">
              {isNum(t.value) ? (
                <>
                  {formatValue(t.value, t.unit)}
                  {t.atLeast ? (
                    <>
                      <span aria-hidden>+</span>
                      <span className="sr-only"> or more</span>
                    </>
                  ) : null}
                </>
              ) : (
                <span className="text-base font-normal text-muted-foreground">
                  n/a
                </span>
              )}
            </dd>
            <dd className="text-[11px] leading-4 text-muted-foreground tabular-nums">
              {t.covered === t.of
                ? `All ${t.of} clients`
                : `${t.covered} of ${t.of} clients`}
              {t.partial ? `, ${t.partial} with days missing` : ""}
              {t.aside ? ` · ${t.aside}` : ""}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const OFF_BOARD_REASON: Record<string, string> = {
  cancelled: "cancelled client",
  not_tied: "not tied to a client",
  kept_out: "kept out: the client's own boosting",
};

/**
 * Spend no client row carries, said under the totals so the board never
 * looks like all of Meta's spend. Whole-board seats only (offBoard is null
 * for the rest).
 */
function OffBoardLine({ off }: { off: NonNullable<Board["offBoard"]> }) {
  if (!off.accounts.length) return null;
  const n = off.accounts.length;
  return (
    <details className="rounded-xl border bg-card px-4 py-3 text-sm sm:px-5">
      <summary className="flex items-baseline select-none">
        <span className="min-w-0 flex-1">
          <span className="font-medium tabular-nums">
            Not in these totals: {formatValue(off.spend, "usd")}
            {off.unpriced ? "+" : ""}
          </span>{" "}
          <span className="text-muted-foreground tabular-nums">
            spent on {n === 1 ? "1 ad account" : `${n} ad accounts`} no client
            on the board carries.
          </span>
        </span>
      </summary>
      <ul className="mt-3 divide-y border-t text-xs">
        {off.accounts.map(a => (
          <li
            key={a.accountId}
            className="flex items-baseline justify-between gap-3 py-2"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-foreground">
                {a.name ?? `act_${a.accountId}`}
              </span>
              <span className="block truncate text-muted-foreground">
                {[a.client, OFF_BOARD_REASON[a.reason ?? ""] ?? a.reason]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">
              {formatValue(a.spend ?? null, "usd")}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Switch off delivery where the client is gone, or tie the account to its
        client so its row counts it.
      </p>
    </details>
  );
}

function NoOutcomeLine({
  rows,
  active,
  onPress,
}: {
  rows: ClientRow[];
  active: boolean;
  onPress: () => void;
}) {
  const n = noOutcomeTotal(rows);
  if (n.unknown === rows.length)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        Appointments with no outcome are not measured for these days yet.
      </p>
    );
  if (n.total === 0)
    return (
      <p className="flex items-center gap-2 text-sm">
        <BoardDot status="good" />
        Every appointment due in this time frame has an outcome.
        {n.unknown ? (
          <span className="text-muted-foreground">
            {n.unknown} {n.unknown === 1 ? "client is" : "clients are"} not
            measured.
          </span>
        ) : null}
      </p>
    );
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-xl border px-4 py-3 text-left text-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:items-center sm:px-5",
        active ? "border-primary/40 bg-primary/5" : "bg-card",
      )}
    >
      <BoardDot status="off" className="mt-[7px] sm:mt-0" />
      <span className="min-w-0 flex-1">
        <span className="font-medium tabular-nums">
          {n.total === 1
            ? "1 appointment in this time frame has no outcome yet"
            : `${n.total} appointments in this time frame have no outcome yet`}
        </span>{" "}
        <span className="text-muted-foreground tabular-nums">
          across {n.clients} {n.clients === 1 ? "client" : "clients"}
          {isNum(n.oldestDays)
            ? `, the oldest ${n.oldestDays === 1 ? "1 day" : `${n.oldestDays} days`} old`
            : ""}
          {n.unknown ? `; ${n.unknown} not measured` : ""}.
        </span>
        <span className="mt-1 block text-xs font-medium text-muted-foreground group-hover:text-foreground sm:hidden">
          {active ? "Sorted by no outcome" : "Sort the clients by it"}
        </span>
      </span>
      <span className="hidden shrink-0 text-xs font-medium text-muted-foreground group-hover:text-foreground sm:inline">
        {active ? "Sorted by no outcome" : "Sort the clients by it"}
      </span>
    </button>
  );
}

function ColumnPicker({
  shown,
  onChange,
}: {
  shown: string[];
  onChange: (keys: string[]) => void;
}) {
  const set = new Set(shown);
  const toggle = (key: string) => {
    const next = set.has(key) ? shown.filter(k => k !== key) : [...shown, key];
    onChange(COLUMNS.map(c => c.key).filter(k => next.includes(k)));
  };
  const groupKeys = (g: string) =>
    COLUMNS.filter(c => c.group === g).map(c => c.key);
  return (
    <div className="rounded-xl bg-muted/40 p-4" id="board-columns">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Show</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange(KEY_COLUMNS)}
        >
          Key columns
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange(COLUMNS.map(c => c.key))}
        >
          Every column
        </Button>
        {GROUPS.filter(g => g.key !== "client").map(g => (
          <Button
            key={g.key}
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange(
                COLUMNS.map(c => c.key).filter(
                  k => k === "caller" || groupKeys(g.key).includes(k),
                ),
              )
            }
          >
            {g.label} only
          </Button>
        ))}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {GROUPS.map(g => (
          <fieldset key={g.key} className="min-w-0">
            <legend>
              <Kicker as="span">{g.label}</Kicker>
            </legend>
            <ul className="mt-1.5 space-y-1">
              {COLUMNS.filter(c => c.group === g.key).map(c => (
                <li key={c.key}>
                  <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={set.has(c.key)}
                      onChange={() => toggle(c.key)}
                      className="size-4"
                    />
                    {c.name}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>
    </div>
  );
}

function Freshness({ board, now }: { board: Board; now: number }) {
  const facts = board.freshness?.facts;
  const meta = board.freshness?.meta;
  const at = (s: string | null | undefined) =>
    s ? dateTime(Date.parse(s), now) : null;
  const bits = [
    at(facts?.lastRunAt)
      ? `CRM, calendars and client sheets ${at(facts?.lastRunAt)}`
      : "CRM figures not worked out yet",
    at(meta?.lastFetchedAt)
      ? `Meta ${at(meta?.lastFetchedAt)}`
      : "Meta not read yet",
  ];
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      As of: {bits.join(" · ")} (Kuwait time).
    </p>
  );
}

export function PerformancePage() {
  const [params, setParams] = useSearchParams();
  const now = useNow();
  const today = kuwaitToday(now);
  const frameKey = (
    FRAMES.some(f => f.key === params.get("tf"))
      ? params.get("tf")
      : DEFAULT_FRAME
  ) as FrameKey;
  const frame = frameOf(frameKey, today, {
    from: params.get("from"),
    to: params.get("to"),
  });
  const customDraft = {
    from: params.get("from") ?? frame.from,
    to: params.get("to") ?? frame.to,
  };
  const selected = params.get("client");
  const board = useBoard(frame.from, frame.to);
  const data =
    board.status === "ready"
      ? board.data
      : board.status === "error"
        ? board.data
        : undefined;

  const [shownKeys, setShownKeys] = useState<string[]>(
    () => storedColumns() ?? KEY_COLUMNS,
  );
  const [meeting, setMeeting] = useState<boolean>(
    () =>
      readStored(MEETING_KEY, v => (typeof v === "boolean" ? v : null)) ??
      false,
  );
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "client", dir: "asc" });
  const [editing, setEditing] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        prev => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const columns: BoardColumn[] = useMemo(() => {
    const keys = meeting ? MEETING_COLUMNS : shownKeys;
    return COLUMNS.filter(c => keys.includes(c.key));
  }, [meeting, shownKeys]);

  const rows = useMemo(() => {
    const all = data?.clients ?? [];
    const q = query.trim();
    const hit = q ? all.filter(r => matchScore(r.clientName, q) > 0) : all;
    return sortRows(hit, sort);
  }, [data, query, sort]);

  useEffect(() => {
    if (sort.key !== "client" && !columns.some(c => c.key === sort.key))
      setSort({ key: "client", dir: "asc" });
  }, [columns, sort.key]);

  const selectedRow =
    data?.clients.find(c => c.locationId === selected) ?? null;
  const openClient = (row: ClientRow) => setParam({ client: row.locationId });
  const sortByNoOutcome = () => {
    if (!columns.some(c => c.key === "noOutcome") && !meeting)
      setShownKeys(k => [...k, "noOutcome"]);
    setSort({ key: "noOutcome", dir: "desc" });
    gridRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };

  const pickColumns = (keys: string[]) => {
    setShownKeys(keys);
    store(COLUMNS_KEY, keys);
  };
  const toggleMeeting = () => {
    setMeeting(m => {
      store(MEETING_KEY, !m);
      return !m;
    });
  };

  const adNote =
    data?.adWindow.note ??
    "Ad numbers end yesterday on each ad account's own clock; today is not in yet.";

  return (
    <div className="ceo-root mx-auto w-full min-w-0 max-w-[1440px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">
            Client performance
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every client against its targets. Open a client for its ads and to
            add a lever.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={board.reload}
            disabled={
              board.status === "loading" ||
              (board.status === "ready" && board.refreshing)
            }
            aria-label="Read the board again"
          >
            <RefreshCw
              aria-hidden
              className={cn(
                board.status === "ready" && board.refreshing && "animate-spin",
              )}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          {data?.canEditTargets ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              <SlidersHorizontal aria-hidden />
              Edit targets
            </Button>
          ) : null}
        </div>
      </header>

      <div className="space-y-2">
        <FrameControl
          frame={frameKey}
          today={today}
          custom={customDraft}
          onPick={k =>
            setParam(
              k === "custom"
                ? {
                    tf: k,
                    from: params.get("from") ?? frame.from,
                    to: params.get("to") ?? frame.to,
                  }
                : { tf: k === DEFAULT_FRAME ? null : k, from: null, to: null },
            )
          }
          onCustom={(from, to) => setParam({ tf: "custom", from, to })}
        />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {rangeLabel(frame.from, frame.to, today)}.
          </span>{" "}
          {frame.problem
            ? `${frame.problem} Showing the last 30 days until then. `
            : ""}
          {adNote}
        </p>
      </div>

      {data ? (
        <>
          {data.notes?.length ? (
            <ul className="space-y-1.5" aria-label="What to read with care">
              {data.notes.map(n => (
                <li
                  key={n}
                  className="ceo-stale flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
                >
                  <TriangleAlert
                    aria-hidden
                    className="mt-0.5 size-3.5 shrink-0"
                    style={{ color: "var(--ceo-warning)" }}
                  />
                  {n}
                </li>
              ))}
            </ul>
          ) : null}
          {data.clients.length ? <Portfolio rows={data.clients} /> : null}
          {data.clients.length ? (
            <NoOutcomeLine
              rows={data.clients}
              active={sort.key === "noOutcome"}
              onPress={sortByNoOutcome}
            />
          ) : null}
          {data.offBoard ? <OffBoardLine off={data.offBoard} /> : null}
        </>
      ) : null}

      <section
        ref={gridRef}
        aria-label="Clients"
        className="ceo-card scroll-mt-4 rounded-2xl border bg-card p-4 sm:p-6"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="relative flex w-full min-w-0 items-center sm:w-auto sm:max-w-64 sm:flex-1">
            <span className="sr-only">Find a client</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Find a client"
              className="h-8 w-full rounded-md border bg-background pl-8 pr-2.5 text-base placeholder:text-muted-foreground sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div className="ml-auto flex items-center gap-2">
            {!meeting ? (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={picking}
                aria-controls="board-columns"
                onClick={() => setPicking(p => !p)}
              >
                <Columns3 aria-hidden />
                Columns
                <span className="tabular-nums text-muted-foreground">
                  {shownKeys.length}
                </span>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={meeting ? "teal" : "ghost"}
              aria-pressed={meeting}
              onClick={toggleMeeting}
            >
              <Presentation aria-hidden />
              Meeting view
            </Button>
          </div>
        </div>
        {picking && !meeting ? (
          <div className="mb-4">
            <ColumnPicker shown={shownKeys} onChange={pickColumns} />
          </div>
        ) : null}

        {board.status === "error" && !data ? (
          <EmptyState
            icon={TriangleAlert}
            title="The board did not load"
            text={board.message}
            action={
              <Button size="sm" variant="outline" onClick={board.reload}>
                Try again
              </Button>
            }
          />
        ) : !data ? (
          <div role="status" aria-label="Reading the board">
            <BoardGridSkeleton columns={Math.min(columns.length, 10)} />
          </div>
        ) : !data.clients.length ? (
          <EmptyState
            icon={Table2}
            title="No clients on your board"
            text="The board lists every active client your seat may see. Ask the CEO to add clients to your seat in the portal's admin view."
          />
        ) : !rows.length ? (
          <EmptyState
            icon={Search}
            title="No client matches that name"
            text="Check the spelling or clear the search."
            compact
          />
        ) : columns.length === 0 ? (
          <EmptyState
            icon={Columns3}
            title="No columns picked"
            text="Pick the columns to show, or go back to the key columns."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => pickColumns(KEY_COLUMNS)}
              >
                Key columns
              </Button>
            }
            compact
          />
        ) : (
          <BoardGrid
            rows={rows}
            columns={columns}
            targets={data.targets}
            sort={sort}
            onSort={setSort}
            onOpen={openClient}
            selected={selected}
            meeting={meeting}
          />
        )}

        {board.status === "error" && data ? (
          <Problem className="mt-3">
            {board.message} Showing the numbers read before.
          </Problem>
        ) : null}
        {data ? (
          <div className="mt-4 space-y-1">
            <Freshness board={data} now={now} />
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <BoardDot status="good" /> On target
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BoardDot status="watch" /> Watch
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BoardDot status="off" /> Off target
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BoardDot status="too_few" /> Too few to judge
              </span>
              <span>A + means at least this much.</span>
            </p>
          </div>
        ) : null}
      </section>

      {data && data.offBoard === undefined && data.notLinked?.length ? (
        <details className="rounded-2xl border bg-card px-4 py-3 text-sm sm:px-6">
          <summary className="cursor-pointer select-none text-[13px] font-medium">
            {data.notLinked.length === 1
              ? "1 ad account that spent is not tied to a client"
              : `${data.notLinked.length} ad accounts that spent are not tied to a client`}
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {data.notLinked.map(a => (
              <li key={a.accountId}>
                {a.name ?? "No name"} (act_{a.accountId})
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Their spend is on no client's row. Tie each one to its client so the
            board counts it.
          </p>
        </details>
      ) : null}

      <ClientPanel
        location={selected}
        row={selectedRow}
        from={frame.from}
        to={frame.to}
        today={today}
        onOpenChange={o => {
          if (!o) setParam({ client: null });
        }}
        onChanged={() => reloadBoard(frame.from, frame.to)}
        boardTargets={data?.targets ?? null}
      />
      {data?.canEditTargets ? (
        <TargetsDialog
          open={editing}
          onOpenChange={setEditing}
          targets={data.targets}
          clients={data.clients}
          onSaved={() => reloadEveryRead(frame.from, frame.to, selected)}
        />
      ) : null}
    </div>
  );
}

export default PerformancePage;
