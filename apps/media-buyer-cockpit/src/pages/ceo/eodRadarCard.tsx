import { ChevronRight, CircleDashed, TriangleAlert } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { SectionCard } from "@/components/ceo/SectionCard";
import { STATUS_COLOR, StatusDot } from "@/components/ceo/StatusChip";
import { cn } from "@/lib/utils";
import type {
  EodDay,
  EodPerson,
  EodRadarBoard,
  EodStatus,
} from "@/types/ceo/eodRadar";
import {
  checkedLine,
  dayNumber,
  daySentence,
  digestLine,
  problems,
  radarToday,
  STATUS_LABEL,
  settingsLine,
  tally,
  tallyText,
  weekdayShort,
  workingDays,
} from "./eodRadarCopy";

/**
 * EOD Radar on the Management tab (2026-10-15): the last 15 working days per
 * person, one dot a day, from the Slack EOD channels (Edge Function
 * eod-radar, every 30 minutes). Quiet on purpose: the colour sits on the
 * dots, and the one teal mark is today's column, the radar's lamp. A row
 * opens to the days in words (the dots' hover text), so a phone gets them
 * too. Every channel that could not be read is named; its people read
 * "not read", never missed.
 */

/**
 * Narrow (a phone, a half-width card): the name on its own line, then the 15
 * days across the full width. Wide: the name on the left of its days.
 */
const GRID =
  "grid grid-cols-[repeat(15,minmax(0,1fr))] @lg:grid-cols-[minmax(8rem,14rem)_repeat(15,minmax(1.5rem,2.25rem))]";

/** One day's mark. Colour for the outcome; shape for what is not an outcome (a ring still open, a dash not read). */
export function RadarDot({ status }: { status: EodStatus | null }) {
  const base = "inline-block shrink-0 rounded-full";
  if (status === "on_time" || status === "late")
    return (
      <span
        aria-hidden
        className={cn(base, "size-2 @lg:size-2.5")}
        style={{
          backgroundColor: STATUS_COLOR[status === "late" ? "warning" : "good"],
        }}
      />
    );
  if (status === "missed")
    return (
      <span
        aria-hidden
        className={cn(base, "size-2 @lg:size-2.5")}
        style={{ boxShadow: `inset 0 0 0 1.5px ${STATUS_COLOR.serious}` }}
      />
    );
  if (status === "pending")
    return (
      <span
        aria-hidden
        className={cn(base, "size-2 opacity-70 @lg:size-2.5")}
        style={{ boxShadow: "inset 0 0 0 1.5px var(--muted-foreground)" }}
      />
    );
  if (status === "not_read")
    return (
      <span
        aria-hidden
        className={cn(
          base,
          "size-2 border-[1.5px] border-dashed border-muted-foreground @lg:size-2.5",
        )}
      />
    );
  if (status === "leave")
    return (
      <span
        aria-hidden
        className={cn(
          base,
          "size-2 bg-muted-foreground opacity-45 @lg:size-2.5",
        )}
      />
    );
  if (status === "off")
    return (
      <span
        aria-hidden
        className={cn(base, "size-1 bg-muted-foreground opacity-30")}
      />
    );
  // No row: the radar has not looked at that day.
  return (
    <span aria-hidden className={cn(base, "size-1 bg-[var(--ceo-grid)]")} />
  );
}

const LEGEND: EodStatus[] = [
  "on_time",
  "late",
  "missed",
  "pending",
  "leave",
  "off",
  "not_read",
];

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {LEGEND.map(s => (
        <li key={s} className="flex items-center gap-1.5">
          <span className="flex size-2.5 items-center justify-center">
            <RadarDot status={s} />
          </span>
          {STATUS_LABEL[s]}
        </li>
      ))}
    </ul>
  );
}

function DayHeader({ days, today }: { days: string[]; today: string }) {
  return (
    <div className={cn(GRID, "items-end pb-1")} aria-hidden>
      <span className="hidden @lg:block" />
      {days.map(d => (
        <span
          key={d}
          className={cn(
            "flex flex-col items-center gap-0.5 font-mono text-[10px] leading-none tabular-nums text-muted-foreground",
            d === today && "text-foreground",
          )}
        >
          <span className="hidden @lg:block">{weekdayShort(d)}</span>
          <span>{dayNumber(d)}</span>
          {/* Today's lamp: the one teal mark on the card. */}
          <span
            className={cn(
              "mt-0.5 h-0.5 w-3 rounded-full",
              d === today ? "bg-primary" : "bg-transparent",
            )}
          />
        </span>
      ))}
    </div>
  );
}

function PersonRow({
  person,
  days,
  today,
}: {
  person: EodPerson;
  days: string[];
  today: string;
}) {
  const byDay = useMemo(
    () => new Map(person.days.map(d => [d.day, d])),
    [person.days],
  );
  const t = tally(person, days);
  const newestFirst = [...days].reverse();
  return (
    <li className="min-w-0">
      <details className="group min-w-0">
        <summary className="no-marker block cursor-pointer select-none list-none rounded-sm hover:bg-[var(--ceo-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className={cn(GRID, "min-h-10 items-stretch")}>
            <span className="col-span-full flex min-w-0 items-center gap-1.5 pt-1.5 pr-2 @lg:col-span-1 @lg:py-1">
              <ChevronRight
                className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                aria-hidden
              />
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 @lg:block">
                <span
                  dir="auto"
                  className={cn(
                    "block max-w-full truncate text-[13px] font-medium",
                    person.active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {person.name}
                  {person.active ? "" : " (left)"}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
                  {tallyText(t)}
                </span>
              </span>
            </span>
            {days.map(d => (
              <span
                key={d}
                title={daySentence(d, byDay.get(d))}
                className={cn(
                  "flex h-6 items-center justify-center @lg:h-auto",
                  d === today && "bg-[var(--ceo-emphasis-wash)]",
                )}
              >
                <RadarDot status={byDay.get(d)?.status ?? null} />
              </span>
            ))}
          </div>
        </summary>
        <ol className="mb-3 ml-5 mt-1 min-w-0 space-y-1 rounded-xl bg-muted/40 p-3 text-xs leading-5">
          {newestFirst.map(d => (
            <DayLine key={d} day={d} row={byDay.get(d)} />
          ))}
        </ol>
      </details>
    </li>
  );
}

function DayLine({ day, row }: { day: string; row: EodDay | undefined }) {
  return (
    <li className="flex min-w-0 items-baseline gap-2">
      <span className="flex size-2.5 shrink-0 translate-y-px items-center justify-center">
        <RadarDot status={row?.status ?? null} />
      </span>
      <span className="min-w-0 text-foreground">{daySentence(day, row)}</span>
    </li>
  );
}

/** The card itself, from a board already read (or its error); pure, for the harness and the tests. */
export function EodRadarCard({
  board,
  error,
  now,
  order = 0,
}: {
  board: EodRadarBoard | null;
  error: string | null;
  now: number;
  order?: number;
}) {
  const today = board?.today ?? radarToday(now);
  const days = useMemo(() => workingDays(today), [today]);
  const lines = useMemo(
    () => (board ? problems(board, now) : []),
    [board, now],
  );

  let body: ReactNode;
  if (!board && error)
    body = (
      <EmptyState
        icon={TriangleAlert}
        title="EOD Radar could not be read"
        text={`${error.replace(/\.+$/, "")}. Reload the page; if it keeps failing, the radar's migration (20261015210000) may not be applied yet.`}
        compact
      />
    );
  else if (!board)
    body = <EmptyState icon={CircleDashed} title="Reading EOD Radar" compact />;
  else {
    const active = board.people.filter(p => p.active);
    const gone = board.people.filter(p => !p.active);
    const foot = digestLine(board);
    body = (
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <span className="mt-1.5">
            <StatusDot
              tone={board.sync?.ok ? "good" : "warning"}
              label={
                board.sync?.ok ? "Every channel read" : "Not every channel read"
              }
            />
          </span>
          <span>
            {checkedLine(board, now)}. {settingsLine(board)}
          </span>
        </p>
        {lines.length ? (
          <ul className="space-y-1.5 text-xs leading-5 text-foreground">
            {lines.map(l => (
              <li key={l.text} className="flex items-start gap-2">
                <span className="mt-1.5">
                  <StatusDot
                    tone={l.tone}
                    label={l.tone === "warning" ? "Needs a fix" : "Note"}
                  />
                </span>
                <span className="min-w-0">{l.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {board.people.length ? (
          <div className="min-w-0">
            <DayHeader days={days} today={today} />
            <ul className="min-w-0">
              {[...active, ...gone].map(p => (
                <PersonRow
                  key={p.personId}
                  person={p}
                  days={days}
                  today={today}
                />
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState
            title="Nobody owes an EOD"
            text="Everyone on the roster is the CEO, a bot or in a role with no EOD channel. Add the people who file EODs on Team & payroll."
            compact
          />
        )}
        <div className="space-y-2 border-t border-[color:var(--ceo-grid)] pt-3">
          <Legend />
          {foot ? (
            <p className="text-xs text-muted-foreground">{foot}</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <SectionCard
      kicker="Slack EODs"
      title="EOD Radar"
      description="One dot per working day, read from the five Slack EOD channels every 30 minutes. Open a person for the days in words."
      order={order}
    >
      {body}
    </SectionCard>
  );
}
