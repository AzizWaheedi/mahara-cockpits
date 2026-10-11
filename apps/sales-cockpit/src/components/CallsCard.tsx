import { CalendarClock, MessageCircle, TriangleAlert } from "lucide-react";
import { Fragment, type ReactNode, useRef, useState } from "react";
import { isClient } from "../lib/clients";
import { useLead, useUnverifiedMoves } from "../lib/data";
import { ghlContactUrl } from "../lib/highlevel";
import {
  againLine,
  bookedAgain,
  type CallKind,
  callSubLine,
  dayLine,
  dayWords,
  firstOf,
  groupCalls,
  kindNoun,
  kindOf,
  type LeadLike,
  latestMiss,
  liveChip,
  type MoveSource,
  rowActions,
  suggestedBook,
  timeParts,
  whenWords,
} from "../lib/reschedule";
import { rowMoment } from "../lib/tellThem";
import type { CalendarRow, Me } from "../lib/types";
import type { Lang } from "../lib/zoomLink";
import { CallPicker, type PickerDone } from "./CallPicker";
import { button, Failed, Reading, StatusChip, type Tone } from "./kit";
import { CrmLine, MarkControls, type MarkHold } from "./MarkControls";
import { TellThem } from "./TellThem";

/**
 * The lead page's Calls card (2026-10-11, plan D1 and the design): the
 * next call first, with its buttons on its own row, then any later ones,
 * the calls owed a mark and the calls before. Book sits once in the header:
 * Intro, Demo, Follow-up call, the one the lead's calls suggest tinted when
 * nothing is booked. Reschedule, Tell them and the marks open under the
 * row they belong to; while a panel is open the row hands it its buttons,
 * so there is never a second Reschedule on screen.
 */

type Panel =
  // `at`: the call's time when the panel opened. The row keeps that place
  // in its group until the panel closes, so a move that changes the order
  // (a later call moved before the next one) never remounts the picker and
  // loses its done state, with Tell them, under the rep's thumb.
  | { what: "reschedule" | "tell"; id: string; at: string | null }
  | { what: "book"; kind: CallKind; missed: CalendarRow | null }
  | null;

const ROW_BTN = `${button} h-9 pointer-coarse:min-h-11`;
const MISSED = new Set(["noshow", "cancelled"]);

/** A recent booking: Tell them opens on "Just booked" instead of the confirmation. */
function bookedRecently(r: CalendarRow, now: number): boolean {
  const t = r.booked_at ? Date.parse(r.booked_at) : Number.NaN;
  return Number.isFinite(t) && now - t < 2 * 3_600_000;
}

export function CallsCard({
  me,
  lead,
  rows,
  error,
  reload,
  client,
  dnd,
  lang,
  noShowHeld,
  source = "lead",
}: {
  me: Me;
  lead: LeadLike;
  /** Null until the lead's calls have been read. */
  rows: CalendarRow[] | null;
  error: string | null;
  reload: () => void;
  /** Tagged client or signed: their calls are listed, nothing is booked or moved. */
  client: boolean;
  dnd: boolean;
  lang: Lang;
  /** The lead's video room is open: Didn't happen waits. */
  noShowHeld: boolean;
  source?: "lead";
}) {
  const now = Date.now();
  const [panel, setPanel] = useState<Panel>(null);
  // A call this page just rescheduled shows its new time at once, until the
  // next read of the calendar carries it.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [allBefore, setAllBefore] = useState(false);
  const unverified = useUnverifiedMoves(lead.contact_id);

  const startOf = (r: CalendarRow) => {
    const m = moved[r.appointment_id];
    return m && m !== r.start_at ? m : r.start_at;
  };
  const list = rows ?? [];
  const groups = groupCalls(list, now, r =>
    panel && panel.what !== "book" && panel.id === r.appointment_id
      ? panel.at
      : startOf(r),
  );
  // Each row's mark on hold (Didn't happen's five seconds), so its own
  // Reschedule can drop it instead of sending it (MarkHold).
  const holds = useRef(new Map<string, MarkHold>());
  const miss = latestMiss(list, now);
  const suggest = client ? null : suggestedBook(list, false, now);
  const leadDnd = { ...lead, dnd };

  const done = (d: PickerDone, id?: string | null) => {
    if (d.mode === "reschedule" && id) setMoved(m => ({ ...m, [id]: d.start }));
    reload();
  };

  /** The picker or Tell them under a row, when that row's panel is open. */
  const under = (r: CalendarRow): ReactNode => {
    if (!panel || panel.what === "book" || panel.id !== r.appointment_id)
      return null;
    const kind = kindOf(r.call_type);
    if (panel.what === "reschedule")
      return (
        <div className="px-3 pb-4 sm:px-6">
          <CallPicker
            me={me}
            lead={leadDnd}
            mode="reschedule"
            kind={kind}
            appointmentId={r.appointment_id}
            current={{ start: startOf(r), host: r.assigned_user_name }}
            source={source}
            lang={lang}
            onClose={() => setPanel(null)}
            onDone={d => done(d, r.appointment_id)}
          />
        </div>
      );
    const status = String(r.marked_status ?? r.status ?? "");
    const isMiss = MISSED.has(status);
    const again = isMiss ? bookedAgain(r, list, now) : null;
    const chip = liveChip(r, now, Boolean(moved[r.appointment_id]));
    return (
      <div className="px-3 pb-4 sm:px-6">
        <div className="rounded-[18px] border border-[color:color-mix(in_oklch,var(--primary)_35%,transparent)] bg-[color:var(--card)] p-3.5 sm:p-4">
          <TellThem
            me={me}
            lead={leadDnd}
            call={{
              appointment_id: again?.appointment_id ?? r.appointment_id,
              kind,
              start: again ? startOf(again) : isMiss ? null : startOf(r),
              host_name: (again ?? r).assigned_user_name,
              host_user_id: (again ?? r).assigned_user_id,
              meet_url: (again ?? r).meet_url ?? null,
            }}
            moment={rowMoment({
              status,
              movedRecently: chip.label === "Rescheduled",
              bookedRecently: bookedRecently(r, now),
              missed: isMiss ? (again ? "booked" : "open") : null,
            })}
            lang={lang}
            // The lead's own link to pick another time, where HighLevel allows it.
            readLink
            extra={
              <button
                type="button"
                className={`${button} pointer-coarse:min-h-11 max-sm:flex-auto max-sm:px-3 whitespace-nowrap`}
                onClick={() => setPanel(null)}
              >
                Done
              </button>
            }
          />
        </div>
      </div>
    );
  };

  /** The buttons on a row, by where the call stands (lib/reschedule rowActions). */
  const actions = (r: CalendarRow, big = false): ReactNode => {
    if (panel && panel.what !== "book" && panel.id === r.appointment_id)
      return null;
    // A booking panel open under the next call carries the controls: the
    // next call and the missed one hand it theirs (one set on screen).
    const booking = panel?.what === "book";
    if (booking && big) return null;
    const acts = rowActions(r, now, {
      client,
      dnd,
      latestMiss: !booking && miss?.appointment_id === r.appointment_id,
      start: startOf(r),
    });
    if (!acts.length) return null;
    const marks = acts.includes("showed") ? (
      <MarkControls
        row={r}
        variant="row"
        compact={!big}
        disqualify={acts.includes("disqualify")}
        noShowHeld={noShowHeld}
        onDone={() => reload()}
        onMarked={status => {
          if (status === "noshow" || status === "cancelled")
            setPanel({ what: "book", kind: kindOf(r.call_type), missed: r });
        }}
        hold={h => {
          if (h) holds.current.set(r.appointment_id, h);
          else holds.current.delete(r.appointment_id);
        }}
      />
    ) : null;
    const resched = acts.includes("reschedule") ? (
      <button
        type="button"
        className={`${ROW_BTN} ${big ? "max-sm:flex-1" : ""}`}
        onClick={() => {
          holds.current.get(r.appointment_id)?.drop();
          setPanel({
            what: "reschedule",
            id: r.appointment_id,
            at: startOf(r),
          });
        }}
      >
        <CalendarClock className="size-3.5" aria-hidden />
        Reschedule
      </button>
    ) : null;
    const tell = acts.includes("tell") ? (
      <button
        type="button"
        className={`${ROW_BTN} ${big ? "max-sm:flex-1" : ""}`}
        onClick={() =>
          setPanel({ what: "tell", id: r.appointment_id, at: startOf(r) })
        }
      >
        <MessageCircle className="size-3.5" aria-hidden />
        Tell them
      </button>
    ) : null;
    return (
      <div
        className={`flex flex-wrap items-center gap-2 ${big ? "max-sm:w-full" : ""}`}
      >
        {marks}
        {resched}
        {tell}
      </div>
    );
  };

  const bookPicker =
    panel?.what === "book" ? (
      <div className={`px-3 pb-4 sm:px-6 ${groups.next ? "" : "pt-4"}`}>
        <CallPicker
          key={`${panel.kind}:${panel.missed?.appointment_id ?? ""}`}
          me={me}
          lead={leadDnd}
          mode="book"
          kind={panel.kind}
          source={source}
          lang={lang}
          missed={panel.missed ? { start: panel.missed.start_at } : null}
          line={
            panel.missed
              ? againLine(panel.missed.start_at, panel.kind, me.name)
              : `Booked from the lead page by ${firstOf(me.name) || "the team"}.`
          }
          onClose={() => setPanel(null)}
          onDone={d => done(d)}
        />
      </div>
    ) : null;

  const bookGroup = client ? null : (
    <div className="flex items-center gap-2 max-sm:grid max-sm:w-full max-sm:grid-cols-[auto_1fr_1fr_1.5fr]">
      <span className="muted text-[13px]">Book</span>
      {(
        [
          ["intro", "Intro", "Book intro"],
          ["demo", "Demo", "Book demo"],
          ["follow_up", "Follow-up call", "Book a follow-up call"],
        ] as [CallKind, string, string][]
      ).map(([k, label, aria]) => {
        const on =
          (panel?.what === "book" && panel.kind === k) ||
          (!panel && suggest === k);
        return (
          <button
            key={k}
            type="button"
            aria-label={aria}
            aria-pressed={panel?.what === "book" && panel.kind === k}
            onClick={() => setPanel({ what: "book", kind: k, missed: null })}
            className={`${button} h-10 whitespace-nowrap max-sm:px-2 max-sm:text-[13px] ${
              on
                ? "border-[color:color-mix(in_oklch,var(--primary)_45%,transparent)]! bg-[color:color-mix(in_oklch,var(--primary)_15%,transparent)]!"
                : ""
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  let body: ReactNode;
  if (error)
    body = (
      <div className="p-4 sm:px-6">
        <Failed what="This lead's calls" error={error} retry={reload} />
      </div>
    );
  else if (!rows)
    body = <Reading what="the calls" className="px-4 py-4 text-sm sm:px-6" />;
  else {
    const n = groups.next;
    const before = allBefore ? groups.before : groups.before.slice(0, 3);
    body = (
      <>
        {client ? (
          // The page's header already says they are an active client.
          <p className="muted px-4 py-3 text-sm sm:px-6">
            {list.length
              ? "Their calls are listed only. Client success books and reschedules them."
              : "No calls on the calendar. Client success books and reschedules their calls."}
          </p>
        ) : null}
        {n ? (
          <NextRow
            r={n}
            start={startOf(n)}
            lead={lead}
            now={now}
            moved={Boolean(moved[n.appointment_id])}
            actions={actions(n, true)}
          />
        ) : client ? null : (
          <div className="flex items-start gap-2.5 bg-[color:color-mix(in_oklch,var(--warning)_8%,transparent)] px-4 py-4 sm:px-6">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0"
              style={{ color: "var(--warning)" }}
              aria-hidden
            />
            <div>
              <p
                className="text-[15px] font-semibold"
                style={{
                  color:
                    "color-mix(in oklch, var(--warning) 85%, var(--foreground))",
                }}
              >
                No next call booked.
              </p>
              {/* With a booking open under it, the picker is what to do next. */}
              {panel?.what === "book" ? null : (
                <p className="muted mt-0.5 text-sm">
                  Book one above, or set a call-back in the dialer.
                </p>
              )}
            </div>
          </div>
        )}
        {n ? under(n) : null}
        {bookPicker}
        {(unverified.data ?? []).map(u => (
          <p
            key={u.id}
            role="status"
            className="callout-warn mx-4 mb-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm sm:mx-6"
          >
            The reschedule of the {kindNoun(kindOf(u.call_type))} to{" "}
            {whenWords(u.to_start)} was not confirmed by HighLevel.{" "}
            <a
              href={ghlContactUrl(lead.contact_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Open it in HighLevel
            </a>{" "}
            and check the time.
          </p>
        ))}
        <Group title="Coming up" rows={groups.coming}>
          {r => (
            <CallLine
              r={r}
              start={startOf(r)}
              now={now}
              chip={liveChip(r, now, Boolean(moved[r.appointment_id]))}
              actions={actions(r)}
              under={under(r)}
            />
          )}
        </Group>
        <Group title="Needs a mark" rows={groups.owed}>
          {r => (
            <CallLine
              r={r}
              start={startOf(r)}
              now={now}
              chip={{ tone: "warning", label: "Not marked" }}
              actions={actions(r)}
              under={under(r)}
            />
          )}
        </Group>
        <Group title="Before" rows={before}>
          {r => (
            <CallLine
              r={r}
              start={startOf(r)}
              now={now}
              chip={pastChip(r)}
              actions={actions(r)}
              under={under(r)}
              past
              onRetried={reload}
            />
          )}
        </Group>
        {groups.before.length > 3 && !allBefore ? (
          <div className="px-4 pb-3 sm:px-6">
            <button
              type="button"
              onClick={() => setAllBefore(true)}
              className="muted text-xs underline underline-offset-2 hover:text-[color:var(--foreground)]"
            >
              Show {groups.before.length - 3} more
            </button>
          </div>
        ) : null}
        {!list.length && !client ? (
          <p className="muted px-4 pb-4 text-xs sm:px-6">
            No calls on the calendar yet.
          </p>
        ) : null}
      </>
    );
  }

  return (
    <section
      aria-label="Calls"
      className="panel min-w-0 overflow-hidden shadow-lg"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b hairline px-4 py-3 sm:px-6">
        <h2 className="text-[15px] font-semibold tracking-tight">Calls</h2>
        {bookGroup}
      </header>
      {body}
    </section>
  );
}

function pastChip(r: CalendarRow): { tone: Tone; label: string } {
  const s = String(r.marked_status ?? r.status ?? "");
  if (s === "showed") return { tone: "good", label: "Showed" };
  if (s === "noshow") return { tone: "critical", label: "No-show" };
  if (s === "cancelled") return { tone: "neutral", label: "Cancelled" };
  if (s === "invalid") return { tone: "serious", label: "Disqualified" };
  return { tone: "neutral", label: "Done" };
}

function Clock({ iso, big = false }: { iso: string | null; big?: boolean }) {
  if (!iso) return <span className="muted">--:--</span>;
  const p = timeParts(iso);
  return (
    <span
      className={`font-mono font-semibold tabular-nums ${big ? "text-[22px] leading-7 tracking-tight" : "text-[13px]"}`}
    >
      {p.digits}
      <span
        className={`ms-1 font-sans font-medium ${big ? "text-xs" : "text-[11px]"}`}
      >
        {p.ap}
      </span>
    </span>
  );
}

function NextRow({
  r,
  start,
  lead,
  now,
  moved,
  actions,
}: {
  r: CalendarRow;
  start: string | null;
  lead: LeadLike;
  now: number;
  moved: boolean;
  actions: ReactNode;
}) {
  const chip = liveChip(r, now, moved);
  return (
    <div className="grid grid-cols-1 items-center gap-x-6 gap-y-3 px-4 pt-4 pb-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-6">
      <div className="min-w-0">
        <p className="muted mb-1 text-xs">Next</p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Clock iso={start} big />
          <span className="text-[15px] font-medium">
            {start ? dayLine(start, now) : "No time set"}
          </span>
          <span className="self-center">
            <StatusChip tone={chip.tone} label={chip.label} />
          </span>
        </div>
        <p className="muted mt-1 text-sm">
          {callSubLine(kindOf(r.call_type), r.assigned_user_name, start, lead)}
        </p>
      </div>
      {actions}
    </div>
  );
}

function Group({
  title,
  rows,
  children,
}: {
  title: string;
  rows: CalendarRow[];
  children: (r: CalendarRow) => ReactNode;
}) {
  if (!rows.length) return null;
  return (
    <div>
      <p className="muted border-t hairline px-4 pt-3 pb-1 text-xs sm:px-6">
        {title}
      </p>
      <ul className="pb-2">
        {rows.map(r => (
          <Fragment key={r.appointment_id}>{children(r)}</Fragment>
        ))}
      </ul>
    </div>
  );
}

function CallLine({
  r,
  start,
  now,
  chip,
  actions,
  under,
  past = false,
  onRetried,
}: {
  r: CalendarRow;
  start: string | null;
  now: number;
  chip: { tone: Tone; label: string };
  actions: ReactNode;
  under: ReactNode;
  past?: boolean;
  onRetried?: () => void;
}) {
  const kind = kindOf(r.call_type);
  const what = `${kind === "follow_up" ? (r.call_type === "callback" ? "Callback" : "Follow-up call") : kind === "demo" ? "Demo" : "Intro"}${r.assigned_user_name ? ` with ${r.assigned_user_name}` : ""}`;
  return (
    <li className="border-t border-[color:color-mix(in_oklch,var(--border)_60%,transparent)] first:border-t-0">
      <div
        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm sm:grid-cols-[11.5rem_minmax(0,1fr)_auto_auto] sm:px-6 ${past ? "text-[color:color-mix(in_oklch,var(--foreground)_78%,transparent)]" : ""}`}
      >
        <span className="flex items-baseline gap-2.5">
          <span className="min-w-[5.2rem]">
            {start ? dayWords(start, now) : "No time set"}
          </span>
          <Clock iso={start} />
        </span>
        <span className="muted col-span-2 row-start-2 min-w-0 text-[13px] sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:text-sm sm:text-[color:inherit]">
          <bdi>{what}</bdi>
          {r.marked_status ? (
            <span className="block">
              <CrmLine row={r} onRetried={onRetried ?? (() => undefined)} />
            </span>
          ) : null}
        </span>
        <span className="col-start-2 row-start-1 flex justify-end sm:col-start-3">
          <StatusChip tone={chip.tone} label={chip.label} />
        </span>
        {actions ? (
          <div className="col-span-2 row-start-3 mt-1 sm:col-span-1 sm:col-start-4 sm:row-start-1 sm:mt-0">
            {actions}
          </div>
        ) : null}
      </div>
      {under}
    </li>
  );
}

/**
 * Reschedule and Tell them on a call row outside the lead page (Today, the
 * Calendar): the two buttons, by where the call stands. Marks stay in their
 * own place (the owed lists), so only these two show here.
 */
export function RowButtons({
  row,
  lead,
  open,
  onOpen,
  now = Date.now(),
  compact = true,
}: {
  row: CalendarRow;
  /** The lead when it was read: no Tell them on do not disturb, nothing for a client. */
  lead?: LeadLike | null;
  open: "reschedule" | "tell" | null;
  onOpen: (what: "reschedule" | "tell" | null) => void;
  now?: number;
  compact?: boolean;
}) {
  if (open) return null;
  const acts = rowActions(row, now, {
    client: isClient(lead),
    dnd: Boolean(lead?.dnd),
  }).filter(a => a === "reschedule" || a === "tell");
  if (!acts.length) return null;
  const cls = `${button} ${compact ? "h-8 px-3 text-[13px]" : "h-9"} pointer-coarse:min-h-11`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {acts.includes("reschedule") ? (
        <button
          type="button"
          className={cls}
          onClick={() => onOpen("reschedule")}
        >
          <CalendarClock className="size-3.5" aria-hidden />
          Reschedule
        </button>
      ) : null}
      {acts.includes("tell") ? (
        <button type="button" className={cls} onClick={() => onOpen("tell")}>
          <MessageCircle className="size-3.5" aria-hidden />
          Tell them
        </button>
      ) : null}
    </div>
  );
}

/**
 * The picker or Tell them under a call row anywhere outside the lead page,
 * or the picker to book a missed call again. The lead is read when the row
 * did not bring it, so the lead's own clock and number are always used.
 */
export function RowPanel({
  me,
  row,
  lead: given,
  what,
  source,
  onClose,
  onDone,
}: {
  me: Me;
  row: CalendarRow;
  lead?: LeadLike | null;
  what: "reschedule" | "tell" | "again";
  source: MoveSource;
  onClose: () => void;
  onDone: (d: PickerDone) => void;
}) {
  const read = useLead(given ? "" : (row.contact_id ?? ""));
  const lead: LeadLike | null = given ?? (read.data as LeadLike | null) ?? null;
  if (!lead)
    return read.error ? (
      <Failed what="This lead" error={read.error} retry={read.reload} />
    ) : (
      <Reading what="the lead" />
    );
  const kind = kindOf(row.call_type);
  if (what === "tell") {
    const status = String(row.marked_status ?? row.status ?? "");
    const isMiss = MISSED.has(status);
    return (
      <div className="rounded-[18px] border border-[color:color-mix(in_oklch,var(--primary)_35%,transparent)] bg-[color:var(--card)] p-3.5 sm:p-4">
        <TellThem
          me={me}
          lead={lead}
          call={{
            appointment_id: row.appointment_id,
            kind,
            start: isMiss ? null : row.start_at,
            host_name: row.assigned_user_name,
            host_user_id: row.assigned_user_id,
            meet_url: row.meet_url ?? null,
          }}
          moment={rowMoment({
            status,
            movedRecently: liveChip(row).label === "Rescheduled",
            bookedRecently: bookedRecently(row, Date.now()),
            missed: isMiss ? "open" : null,
          })}
          readLink
          extra={
            <button
              type="button"
              className={`${button} pointer-coarse:min-h-11 max-sm:flex-auto max-sm:px-3 whitespace-nowrap`}
              onClick={onClose}
            >
              Done
            </button>
          }
        />
      </div>
    );
  }
  if (what === "again")
    return (
      <CallPicker
        me={me}
        lead={lead}
        mode="book"
        kind={kind}
        source={source}
        missed={{ start: row.start_at }}
        line={againLine(row.start_at, kind, me.name)}
        onClose={onClose}
        onDone={onDone}
      />
    );
  return (
    <CallPicker
      me={me}
      lead={lead}
      mode="reschedule"
      kind={kind}
      appointmentId={row.appointment_id}
      current={{ start: row.start_at, host: row.assigned_user_name }}
      source={source}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
