import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import {
  fetchGap,
  fetchGapClient,
  type GapMeeting,
  type GapRow,
  useRead,
} from "@/lib/resultsReads";
import {
  dayText,
  gapAside,
  gapWindow,
  kuwaitToday,
  percent,
  plural,
  SHEET_STATE_TEXT,
} from "@/lib/resultsModel";
import { cn } from "@/lib/utils";
import {
  Notice,
  OutLink,
  Problem,
  ResultCard,
  RowsSkeleton,
  SourceNote,
  StateChip,
  WarnLine,
} from "./ResultsKit";

/** Rows shown before "Show the other N" (docs/DESIGN.md: long lists show the first few). */
const FIRST = 10;

const GRID =
  "grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,2.2fr)_4rem_4.5rem_5.5rem_5.5rem_minmax(7rem,1.4fr)] sm:items-center sm:gap-x-4";

/**
 * Meetings with no result (Muhammed, 2026-10-21): one row per client with a past meeting in the last
 * 14 days, how many have no result, then "Blank in sheet" and "Still confirmed" apart (they overlap),
 * and a bar for the share. The most missing first. A client opens to its own meetings. The numbers are
 * cockpit_gap_read's, which counts with the board's own rule, so a client's count equals the board's.
 * Read only: it changes nothing.
 */
export function GapReport({ className }: { className?: string }) {
  const win = useMemo(() => gapWindow(kuwaitToday()), []);
  const read = useRead(`gap|${win.from}|${win.to}`, () =>
    fetchGap(win.from, win.to),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const data = read.status === "ready" ? read.data : read.status === "error" ? read.data : undefined;
  const rows = data?.rows ?? [];
  const shown = all ? rows : rows.slice(0, FIRST);
  const total = data?.totals;
  const share = percent(total?.share);
  const comparable = rows.filter(r => r.matchesBoard !== null && r.matchesBoard !== undefined);
  const agree = comparable.filter(r => r.matchesBoard).length;
  const unread = rows.filter(r => r.sheetReadOk === false);

  return (
    <ResultCard
      id="gap-report"
      kicker="Last 14 days"
      title="Meetings with no result"
      className={className}
      aside={
        total && total.meetings > 0 ? (
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            <span className="block text-xl font-semibold leading-7 text-foreground">
              {share ?? "n/a"}
            </span>
            {total.noResult} of {plural(total.meetings, "meeting")}
          </p>
        ) : undefined
      }
    >
      {read.status === "loading" ? <RowsSkeleton /> : null}
      {read.status === "error" ? (
        <Problem message={read.message} onRetry={read.reload} />
      ) : null}
      {data && rows.length === 0 ? (
        <Notice
          title="No past meetings in these 14 days"
          text={`${dayText(win.from)} to ${dayText(win.to)}. When a client has one, it is listed here.`}
        />
      ) : null}
      {rows.length > 0 ? (
        <div>
          <div
            className={cn(
              GRID,
              "hidden border-b pb-2 text-xs text-muted-foreground sm:grid",
            )}
          >
            <span>Client</span>
            <span className="text-right">Meetings</span>
            <span className="text-right">No result</span>
            <span className="text-right">Blank in sheet</span>
            <span className="text-right">Still confirmed</span>
            <span>Share with no result</span>
          </div>
          <ul className="divide-y">
            {shown.map(r => (
              <GapLine
                key={r.locationId}
                row={r}
                from={win.from}
                to={win.to}
                open={open === r.locationId}
                onToggle={() =>
                  setOpen(open === r.locationId ? null : r.locationId)
                }
              />
            ))}
          </ul>
          {rows.length > FIRST ? (
            <button
              type="button"
              onClick={() => setAll(a => !a)}
              aria-expanded={all}
              className="mt-3 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {all ? "Show fewer" : `Show the other ${rows.length - FIRST}`}
            </button>
          ) : null}
        </div>
      ) : null}
      {unread.length > 0 ? (
        <WarnLine>
          The dialer could not read the sheet of{" "}
          {unread.map(r => r.clientName).join(", ")} on its last pass, so their
          counts may be too high.
        </WarnLine>
      ) : null}
      {data && data.quietClients > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {plural(data.quietClients, "client")} had no past meeting in these days.
        </p>
      ) : null}
      {data ? (
        <SourceNote>
          A meeting has no result when it has ended, was not cancelled, and the
          CRM status, the client's sheet and the portal all say nothing about
          whether the lead came.{" "}
          {comparable.length > 0
            ? `The count equals the board's for ${agree} of ${comparable.length} clients; the rest differ where a portal row holds no attendance. `
            : ""}
          Blank in sheet and Still confirmed overlap, so they do not add up to
          the no-result count.
        </SourceNote>
      ) : null}
    </ResultCard>
  );
}

function GapLine({
  row,
  from,
  to,
  open,
  onToggle,
}: {
  row: GapRow;
  from: string;
  to: string;
  open: boolean;
  onToggle: () => void;
}) {
  const share = row.share ?? null;
  const aside = gapAside(row);
  const panel = `gap-${row.locationId}`;
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panel}
        className={cn(
          GRID,
          "w-full rounded-lg py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-1">
          <ChevronRight
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {row.clientName}
            </span>
            {aside ? (
              <span className="block truncate text-xs text-muted-foreground">
                {aside}
              </span>
            ) : null}
          </span>
        </span>
        <Cell label="Meetings">{row.meetings}</Cell>
        <Cell label="No result" strong>
          {row.noResult}
        </Cell>
        <Cell label="Blank in sheet">{row.sheetBlank}</Cell>
        <Cell label="Still confirmed">{row.crmConfirmed}</Cell>
        <span className="col-span-2 flex items-center gap-2 sm:col-span-1">
          <span
            role="meter"
            aria-label={`${row.clientName}: share of meetings with no result`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={share === null ? undefined : Math.round(share * 100)}
            aria-valuetext={percent(share) ?? "n/a"}
            className="relative h-1.5 min-w-0 flex-1 rounded-full bg-primary/15"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-primary"
              style={{ width: `${Math.round((share ?? 0) * 100)}%` }}
            />
          </span>
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {percent(share) ?? "n/a"}
          </span>
        </span>
      </button>
      {open ? (
        <div id={panel} className="pb-3 sm:pl-6">
          <GapMeetings row={row} from={from} to={to} />
        </div>
      ) : null}
    </li>
  );
}

/** One number of a client's row: its label shows only on a phone, where the table's header does not. */
function Cell({
  label,
  strong,
  children,
}: {
  label: string;
  strong?: boolean;
  children: number;
}) {
  return (
    <span
      className={cn(
        "flex items-baseline justify-between gap-2 text-sm tabular-nums sm:justify-end",
        strong ? "font-semibold" : "text-muted-foreground",
      )}
    >
      <span className="text-xs font-normal text-muted-foreground sm:hidden">
        {label}
      </span>
      {children}
    </span>
  );
}

function GapMeetings({
  row,
  from,
  to,
}: {
  row: GapRow;
  from: string;
  to: string;
}) {
  const read = useRead(`gap-client|${row.locationId}|${from}|${to}`, () =>
    fetchGapClient(row.locationId, from, to),
  );
  return (
    <div className="rounded-xl bg-muted/40 p-4">
      {read.status === "loading" ? <RowsSkeleton rows={3} /> : null}
      {read.status === "error" ? (
        <Problem message={read.message} onRetry={read.reload} />
      ) : null}
      {read.status === "ready" && read.data.meetings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No meeting with no result is left for {row.clientName} in these days.
        </p>
      ) : null}
      {read.status === "ready" && read.data.meetings.length > 0 ? (
        <ul className="divide-y">
          {read.data.meetings.map(m => (
            <MeetingLine key={m.id} meeting={m} />
          ))}
        </ul>
      ) : null}
      {row.sheetReadOk === false ? (
        <WarnLine>
          {row.sheetError
            ? `The dialer's last read of this sheet said: ${row.sheetError}`
            : "The dialer could not read this sheet on its last pass."}
        </WarnLine>
      ) : null}
    </div>
  );
}

function MeetingLine({ meeting: m }: { meeting: GapMeeting }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-sm first:pt-0 last:pb-0">
      <span className="w-28 shrink-0 font-medium tabular-nums">{dayText(m.day)}</span>
      <span className="min-w-0 text-muted-foreground">
        <bdi>{m.firstName || "Lead"}</bdi>
        {typeof m.daysSince === "number"
          ? `, ${m.daysSince === 0 ? "today" : `${plural(m.daysSince, "day")} ago`}`
          : ""}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <StateChip tone={m.sheetState === "blank" ? "warn" : "neutral"}>
          {SHEET_STATE_TEXT[m.sheetState] ?? m.sheetState}
        </StateChip>
        {m.crmConfirmed ? <StateChip tone="warn">Still confirmed</StateChip> : null}
      </span>
      {m.contactUrl ? (
        <OutLink href={m.contactUrl} className="ml-auto text-xs">
          Open in CRM
        </OutLink>
      ) : null}
    </li>
  );
}
