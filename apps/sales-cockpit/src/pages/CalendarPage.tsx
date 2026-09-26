import {
  CalendarCheck2,
  CalendarClock,
  History,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import {
  EmptyState,
  Failed,
  FilterChip,
  page,
  SectionCard,
  Segmented,
  StatusChip,
  type Tone,
} from "../components/kit";
import { CrmLine, MarkControls } from "../components/MarkControls";
import { useScope } from "../components/Scope";
import {
  type Loaded,
  useCalendar,
  useMirrorRun,
  useNow,
  useOwed,
  useQuery,
} from "../lib/data";
import {
  ago,
  callType,
  clock,
  day,
  dayLabel,
  KUWAIT,
  kuwaitDay,
  kuwaitMidnight,
  statusLabel,
} from "../lib/format";
import { supabase } from "../lib/supabase";
import type { CalendarRow, Me } from "../lib/types";

/**
 * Every call in Kuwait time: what is coming, what happened, and what is
 * still owed a mark. The view and the call type live in the address, so
 * Today's "All owed" lands on the right list and Back returns to it.
 */

type View = "upcoming" | "past" | "owed";

const VIEWS: { key: View; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "owed", label: "Owed" },
];

const TYPES: { key: string; label: string; one: string; many: string }[] = [
  { key: "", label: "All", one: "call", many: "calls" },
  { key: "intro", label: "Intro", one: "intro", many: "intros" },
  { key: "demo", label: "Demo", one: "demo", many: "demos" },
  {
    key: "follow_up",
    label: "Follow-up",
    one: "follow-up",
    many: "follow-ups",
  },
  { key: "callback", label: "Callback", one: "callback", many: "callbacks" },
];

const DAY_MS = 86_400_000;
/** Upcoming and Past each reach this many whole Kuwait days past today. */
const SPAN_DAYS = 14;
/** useOwed's window; older unmarked calls are backlog, kept out of reminders. */
const OWED_DAYS = 30;
/** The row caps in data.ts, so a full read is said rather than passed off as all. */
const CALENDAR_CAP = 1000;
const OWED_CAP = 300;

const RELATIVE = new Set(["Today", "Yesterday", "Tomorrow"]);

function toView(v: string | null): View {
  return v === "past" || v === "owed" ? v : "upcoming";
}

function toType(v: string | null): string {
  return TYPES.find(t => t.key === v)?.key ?? "";
}

function noun(type: string, n: number): string {
  const t = TYPES.find(x => x.key === type) ?? TYPES[0];
  return n === 1 ? t.one : t.many;
}

/** Kuwait midnight `n` days after today's, as an instant. */
function midnight(now: number, n: number): string {
  return kuwaitMidnight(kuwaitDay(now + n * DAY_MS)).toISOString();
}

function startOf(r: CalendarRow): number {
  return r.start_at ? Date.parse(r.start_at) : Number.NaN;
}

function open(r: CalendarRow): boolean {
  const s = r.status ?? "new";
  return s === "new" || s === "confirmed";
}

/** Owed a mark, or a past follow-up or callback still sitting as booked. */
function markable(r: CalendarRow, now: number): boolean {
  if (r.marked_status) return false;
  return r.needs_mark || (open(r) && startOf(r) < now);
}

function chipFor(r: CalendarRow, now: number): { tone: Tone; label: string } {
  const s = r.status ?? "new";
  if (s === "showed") return { tone: "good", label: "Showed" };
  if (s === "noshow") return { tone: "critical", label: "No-show" };
  if (s === "cancelled") return { tone: "neutral", label: "Cancelled" };
  if (s === "invalid") return { tone: "serious", label: "Disqualified" };
  if (open(r) && startOf(r) < now)
    return r.needs_mark
      ? { tone: "warning", label: "Owed a mark" }
      : { tone: "neutral", label: "Not marked" };
  return { tone: "neutral", label: statusLabel(s) };
}

export default function CalendarPage({ me }: { me: Me }) {
  const now = useNow();
  const { view: whose, ScopeSwitch } = useScope(me, { people: true });
  const mine = whose.ghl;
  const team = whose.kind === "team";
  const unlinked = whose.kind === "mine" && !me.ghl_user_id;
  const scope = whose.kind === "person" ? `rep:${whose.repId}` : whose.kind;

  const [params, setParams] = useSearchParams();
  const view = toView(params.get("view"));
  const type = toType(params.get("type"));
  const choose = (key: "view" | "type", value: string) =>
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });

  // Read on every view: it is the Owed list and the count on its button.
  const owed = useOwed(mine, OWED_DAYS);

  return (
    <main className={page}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <Freshness now={now} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewSwitch
            view={view}
            owed={unlinked ? null : owed.data}
            onPick={v => choose("view", v)}
          />
          {ScopeSwitch}
        </div>
      </header>

      {unlinked ? (
        <div className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          Your seat is not linked to your HighLevel user yet, so the cockpit
          cannot tell which calls are yours. Ask Aziz to link it on the Team
          page.
        </div>
      ) : view === "owed" ? (
        <OwedView
          owed={owed}
          mine={mine}
          team={team}
          type={type}
          now={now}
          onType={t => choose("type", t)}
        />
      ) : (
        // A new view or scope starts from its own read, never from the rows
        // of the one before, which would flash as an empty or wrong list.
        <SpanView
          key={`${view}:${scope}`}
          upcoming={view === "upcoming"}
          mine={mine}
          team={team}
          type={type}
          now={now}
          onType={t => choose("type", t)}
          onMarked={owed.reload}
        />
      )}
    </main>
  );
}

function Freshness({ now }: { now: number }) {
  const mirror = useMirrorRun();
  const run = mirror.data;
  if (mirror.error)
    return (
      <p className="muted mt-1 text-sm">
        Kuwait time. Could not tell when the calls were last read:{" "}
        {mirror.error}
      </p>
    );
  if (!run?.finished_at)
    return (
      <p className="muted mt-1 text-sm">
        {mirror.loading
          ? "Kuwait time"
          : "Kuwait time · waiting for the first read of the CRM"}
      </p>
    );
  const stale = now - Date.parse(run.finished_at) > 20 * 60_000;
  return (
    <p className="muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      Kuwait time · calls as of {ago(run.finished_at, now)}
      {run.ok === false || stale ? (
        <StatusChip
          tone="warning"
          label={stale ? "The CRM copy is late" : "The last read had a problem"}
          title={run.error ?? "The copy from B2B runs every three minutes."}
        />
      ) : null}
    </p>
  );
}

function ViewSwitch({
  view,
  owed,
  onPick,
}: {
  view: View;
  owed: CalendarRow[] | null;
  onPick: (v: View) => void;
}) {
  const n = owed?.length ?? 0;
  return (
    <Segmented
      label="Which calls"
      value={view}
      options={VIEWS.map((v): [string, ReactNode] => [
        v.key,
        v.key === "owed" && n > 0 ? (
          <>
            {v.label}
            <span
              className="rounded-full px-1.5 text-xs font-semibold tabular-nums"
              style={{
                background: "var(--owed)",
                color: "var(--warning-foreground)",
              }}
            >
              {n >= OWED_CAP ? `${OWED_CAP}+` : n}
            </span>
          </>
        ) : (
          v.label
        ),
      ])}
      onChange={v => onPick(v as View)}
    />
  );
}

/**
 * All, Intro, Demo, Follow-up, Callback, each with how many the view holds.
 * A type with none is left out (the chosen one and All stay, so a filter can
 * always be cleared); with nothing at all there is no row.
 */
function TypeChips({
  value,
  rows,
  onPick,
}: {
  value: string;
  /** The view's rows, or null while they are unread or cut off at a cap. */
  rows: CalendarRow[] | null;
  onPick: (t: string) => void;
}) {
  const chips = TYPES.map(t => ({
    ...t,
    n: rows
      ? t.key
        ? rows.filter(r => r.call_type === t.key).length
        : rows.length
      : null,
  })).filter(
    t =>
      t.n === null ||
      t.n > 0 ||
      t.key === value ||
      (t.key === "" && value !== ""),
  );
  if (!chips.some(t => t.key !== "") && !value) return null;
  return (
    <div
      className="no-scrollbar flex flex-nowrap gap-2 overflow-x-auto"
      role="group"
      aria-label="Call type"
    >
      {chips.map(t => (
        <FilterChip
          key={t.key || "all"}
          on={value === t.key}
          onClick={() => onPick(t.key)}
          count={t.n}
        >
          {t.label}
        </FilterChip>
      ))}
    </div>
  );
}

/** Upcoming (the next two weeks) or Past (the last two weeks). */
function SpanView({
  upcoming,
  mine,
  team,
  type,
  now,
  onType,
  onMarked,
}: {
  upcoming: boolean;
  mine: string | null;
  team: boolean;
  type: string;
  now: number;
  onType: (t: string) => void;
  onMarked: () => void;
}) {
  // Whole Kuwait days, so the far end never cuts a day in half and the read
  // only moves at midnight; the line between the two views is this minute.
  const cal = useCalendar(
    upcoming ? midnight(now, 0) : midnight(now, -SPAN_DAYS),
    upcoming ? midnight(now, SPAN_DAYS + 1) : midnight(now, 1),
    mine,
  );
  const rows = useMemo(() => {
    const list = (cal.data ?? []).filter(r =>
      upcoming ? startOf(r) >= now : startOf(r) < now,
    );
    return upcoming ? list : list.reverse();
  }, [cal.data, upcoming, now]);
  const capped = (cal.data?.length ?? 0) >= CALENDAR_CAP;
  const shown = type ? rows.filter(r => r.call_type === type) : rows;
  const reload = () => {
    cal.reload();
    onMarked();
  };

  let body: ReactNode;
  if (cal.error)
    body = <Failed what="The calendar" error={cal.error} retry={cal.reload} />;
  else if (!cal.data)
    body = <p className="muted text-sm">Reading the calendar…</p>;
  else if (shown.length)
    body = <Days rows={shown} now={now} team={team} reload={reload} tally />;
  else if (upcoming)
    body = (
      <Empty
        icon={CalendarClock}
        title={
          type
            ? `No ${noun(type, 2)} booked in the next two weeks`
            : "Nothing booked in the next two weeks"
        }
        text="Bookings appear here within a few minutes of being made in HighLevel."
      />
    );
  else
    body = (
      <Empty
        icon={History}
        title={`No ${noun(type, 2)} in the last two weeks`}
        text="Calls land here once their time has passed, with their outcome or the buttons to mark it."
      />
    );

  return (
    <>
      <TypeChips
        value={type}
        rows={cal.data && !capped ? rows : null}
        onPick={onType}
      />
      {body}
      {capped ? (
        <p className="muted text-xs">
          Only the first {CALENDAR_CAP.toLocaleString("en-US")} calls of these
          two weeks could be read, so some are missing from this list.
        </p>
      ) : null}
    </>
  );
}

/** How many unmarked calls sit before the Owed window, of one type or all. */
function useBacklog(mine: string | null, type: string): Loaded<number> {
  return useQuery<number>(
    async () => {
      let q = supabase
        .from("cockpit_sales_calendar")
        .select("appointment_id", { count: "exact", head: true })
        .eq("needs_mark", true)
        .lt(
          "start_at",
          new Date(Date.now() - OWED_DAYS * DAY_MS).toISOString(),
        );
      if (mine) q = q.eq("assigned_user_id", mine);
      if (type) q = q.eq("call_type", type);
      const { count, error } = await q;
      return { data: count, error };
    },
    [mine, type],
    60_000,
  );
}

function OwedView({
  owed,
  mine,
  team,
  type,
  now,
  onType,
}: {
  owed: Loaded<CalendarRow[]>;
  mine: string | null;
  team: boolean;
  type: string;
  now: number;
  onType: (t: string) => void;
}) {
  const rows = owed.data ?? [];
  const capped = rows.length >= OWED_CAP;
  const shown = type ? rows.filter(r => r.call_type === type) : rows;
  const backlog = useBacklog(mine, type);
  const before = day(new Date(now - OWED_DAYS * DAY_MS).toISOString());
  const older = backlog.data;

  let body: ReactNode;
  if (owed.error)
    body = (
      <Failed what="The calls to mark" error={owed.error} retry={owed.reload} />
    );
  else if (!owed.data)
    body = <p className="muted text-sm">Reading the calls to mark…</p>;
  else if (shown.length)
    body = <Days rows={shown} now={now} team={team} reload={owed.reload} />;
  else
    body = (
      <Empty
        icon={CalendarCheck2}
        title={
          type ? `No ${noun(type, 2)} owed a mark` : "Every call is marked"
        }
        text={
          type === "follow_up" || type === "callback"
            ? "Only intros and demos are owed a mark: they are the calls every show rate counts."
            : "Past intros and demos from the last 30 days all have an outcome."
        }
      />
    );

  return (
    <>
      <div className="space-y-4">
        <TypeChips
          value={type}
          rows={owed.data && !capped ? rows : null}
          onPick={onType}
        />
        <div className="muted space-y-1 text-sm">
          <p>
            A call nobody marks counts as shown in every show rate. Mark each
            one as soon as it ends.
          </p>
          {backlog.error ? (
            <p>Could not count the older unmarked calls: {backlog.error}</p>
          ) : older ? (
            <p>
              {older.toLocaleString("en-US")} older {noun(type, older)} from
              before {before} {older === 1 ? "was" : "were"} never marked. They
              are kept out of reminders; mark them from the lead page if you
              know the outcome.
            </p>
          ) : null}
        </div>
      </div>
      {body}
      {capped ? (
        <p className="muted text-xs">
          Showing the {OWED_CAP} most recent calls owed a mark; older ones in
          the last 30 days are not listed.
        </p>
      ) : null}
    </>
  );
}

function Empty({
  icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <section className="panel">
      <EmptyState icon={icon} title={title} text={text} />
    </section>
  );
}

/** Rows under one card per Kuwait day, in the order they came. */
function Days({
  rows,
  now,
  team,
  reload,
  tally = false,
}: {
  rows: CalendarRow[];
  now: number;
  team: boolean;
  reload: () => void;
  /** Say beside each day how many of its calls still need a mark. */
  tally?: boolean;
}) {
  const days = new Map<string, CalendarRow[]>();
  for (const r of rows) {
    const t = startOf(r);
    const key = Number.isFinite(t) ? kuwaitDay(t) : "";
    const list = days.get(key);
    if (list) list.push(r);
    else days.set(key, [r]);
  }
  return (
    <div className="space-y-6">
      {[...days].map(([key, list]) => {
        const iso = list[0]?.start_at ?? null;
        const title = key ? dayLabel(iso, now) : "No time set";
        const date =
          key && iso && RELATIVE.has(title)
            ? `${new Date(iso).toLocaleDateString("en-GB", {
                timeZone: KUWAIT,
                weekday: "short",
                day: "numeric",
                month: "short",
              })} · `
            : "";
        const toMark = tally ? list.filter(r => markable(r, now)).length : 0;
        return (
          <SectionCard
            key={key || "none"}
            title={title}
            side={
              <span className="muted text-xs">
                {date}
                {list.length} {list.length === 1 ? "call" : "calls"}
                {toMark ? ` · ${toMark} to mark` : ""}
              </span>
            }
            flush
          >
            <ul className="divide-y hairline">
              {list.map(r => (
                <CallRow
                  key={r.appointment_id}
                  r={r}
                  now={now}
                  team={team}
                  reload={reload}
                />
              ))}
            </ul>
          </SectionCard>
        );
      })}
    </div>
  );
}

function CallRow({
  r,
  now,
  team,
  reload,
}: {
  r: CalendarRow;
  now: number;
  team: boolean;
  reload: () => void;
}) {
  const chip = chipFor(r, now);
  const name = r.contact_name?.trim() || "A lead";
  return (
    <li className="flex gap-3 px-4 py-3">
      <p className="w-12 shrink-0 pt-px text-right text-sm font-semibold tabular-nums">
        {clock(r.start_at)}
      </p>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {r.contact_id ? (
              <Link
                to={`/lead/${encodeURIComponent(r.contact_id)}`}
                className="min-w-0 truncate text-sm font-medium hover:underline"
                dir="auto"
              >
                {name}
              </Link>
            ) : (
              <span className="min-w-0 truncate text-sm font-medium" dir="auto">
                {name}
              </span>
            )}
            <StatusChip
              tone={chip.tone}
              label={chip.label}
              title={r.mark_reason ?? undefined}
            />
          </div>
          <p className="muted text-xs">
            {callType(r.call_type)}
            {team ? (
              <>
                {" · "}
                <bdi>{r.assigned_user_name?.trim() || "rep not known"}</bdi>
              </>
            ) : null}
            {r.mark_reason ? (
              <>
                {" · "}
                <bdi>{r.mark_reason}</bdi>
              </>
            ) : null}
          </p>
          {r.marked_status ? (
            <div className="mt-0.5 [overflow-wrap:anywhere]">
              <CrmLine row={r} onRetried={reload} />
            </div>
          ) : null}
        </div>
        {markable(r, now) ? (
          <MarkControls row={r} onDone={() => reload()} compact />
        ) : null}
      </div>
    </li>
  );
}
