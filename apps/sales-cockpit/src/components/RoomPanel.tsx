import { Check, ChevronDown, Loader2, RotateCcw } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { type ApiFailure, uncertain } from "../lib/apiErrors";
import { useMe, useNow } from "../lib/data";
import {
  afterAdmitBlocked,
  alertWhileHidden,
  bannerRoomSentence,
  CALL_BACK,
  type CreateRoom,
  clockSec,
  copyText,
  errorText,
  type Health,
  healthSentence,
  healthTone,
  heldTarget,
  isFinal,
  isMaking,
  isStale,
  markFinalSeen,
  mergeRoomFeed,
  momentFor,
  monoTimes,
  needsEndConfirm,
  needsUndo,
  normalizeRoom,
  openHostRoom,
  otherProvider,
  type Provider,
  panelHealthSentence,
  providerName,
  type RoomAction,
  type RoomActionKey,
  type RoomEvent,
  type RoomFeed,
  type RoomView,
  readIsOld,
  retryRequest,
  roomActions,
  roomHint,
  roomSentence,
  roomsApi,
  roomsChanged,
  roomTone,
  STILL_ON_ASK_AGAIN_MS,
  secondsLeft,
  sentenceText,
  shortLink,
  UNDO_MS,
  undoLabel,
  useFocusRescue,
  useRoomOnScreen,
  useRoomStatus,
  useUndo,
  workerDownOf,
} from "../lib/rooms";
import { StaleNote } from "./AvailabilityStrip";
import { button, buttonPrimary } from "./kit";
import { LiveBoundary, RoomLine, Say, Spoken, toneColor } from "./RoomLine";

/**
 * The video room card on the dialer and the lead page: what the room is,
 * where it stands (the room line), one sentence saying what is happening,
 * and the one right button with the quiet ones beside it. A refusal or a
 * failure shows in place as a sentence with what to do next; the health
 * line shows here only when the room worker is in trouble.
 */

export interface Notice {
  tone: "good" | "owed" | "bad";
  text: string;
  /**
   * A link to open with a press (the host's room when the browser blocked
   * the new tab, or the room's own link when the host link could not be
   * had). It is opened from a button, never written into the page, and the
   * panel clears it after a minute.
   */
  open?: { url: string; label: string };
}

/**
 * Every button in the room's screens is 44 px on a touch screen. Marked
 * important: the touch rule in index.css sits outside Tailwind's layers
 * (min-height 2.5rem on every button in <main>) and would win otherwise.
 */
export const TOUCH = "pointer-coarse:min-h-11!";

export interface RoomPanelViewProps {
  feed: RoomFeed;
  now: number;
  canMarkIntro?: boolean;
  /** The page draws the call's own step below (the dialer): the sentence points there. */
  talkBelow?: boolean;
  /** The press on its way; every button waits while one is. */
  busy?: RoomActionKey | null;
  notice?: Notice | null;
  /** A press held behind its Undo. */
  undo?: RoomActionKey | null;
  /** When the held press started, for the seconds left on its Undo. */
  undoAt?: number | null;
  confirmEnd?: boolean;
  copied?: boolean;
  /** What shows may be old: since the last good read, or never read. */
  stale?: { since: number | null; kind?: ApiFailure | null } | null;
  /**
   * The server stopped answering for this room (not yours, gone, signed
   * out): its sentence, said at once, and no buttons that would fail too.
   */
  blocked?: string | null;
  /** The booked intro is marked already, so its two buttons go. */
  introMarked?: boolean;
  /** A handover's retry belongs to project 2; without it, no retry here. */
  canRetry?: boolean;
  /** "Still on the call?" was answered "Still on it" a moment ago. */
  stillOn?: boolean;
  /** The viewer is a manager (a join marked by hand can be counted). */
  manager?: boolean;
  onAction?: (key: RoomActionKey) => void;
  onUndo?: () => void;
  onConfirmEnd?: (yes: boolean) => void;
  /** The notice's link was opened: the panel lets it go. */
  onNoticeOpened?: () => void;
  /** Read the room again now (the stale note's button). */
  onReload?: () => void;
  className?: string;
}

export function RoomPanelView({
  feed,
  now,
  canMarkIntro = false,
  talkBelow = false,
  busy = null,
  notice = null,
  undo = null,
  undoAt = null,
  confirmEnd = false,
  copied = false,
  stale = null,
  blocked = null,
  introMarked = false,
  canRetry = true,
  stillOn = false,
  manager = false,
  onAction = () => undefined,
  onUndo = () => undefined,
  onConfirmEnd = () => undefined,
  onNoticeOpened = () => undefined,
  onReload,
  className = "",
}: RoomPanelViewProps) {
  const { room, events, health } = feed;
  // A failed room never got as far as a step, and a standby room has no
  // lead to wait for: neither draws the line.
  const showLine =
    room.state !== "failed" &&
    (room.purpose !== "standby" || Boolean(room.contact_id));
  // The room worker down: a failed room offers no "Try {other}" (no worker
  // makes that room either); its sentence says to phone the lead.
  const ctx = {
    now,
    canMarkIntro,
    talkBelow,
    stillOn,
    manager,
    workerDown: workerDownOf(health),
    lineShown: showLine,
    // Whether the host can use the other provider now (room.status): no
    // "Try {other}" and no "I can't let them in" when it cannot.
    otherOk: feed.other_ok ?? null,
  };
  const moment = momentFor(room, ctx);
  const sentence = roomSentence(room, ctx);
  const hint = stale ? null : roomHint(room, now);
  const actions = roomActions(room, ctx);
  const primary =
    blocked || (actions.primary?.key === "retry" && !canRetry)
      ? null
      : actions.primary;
  const quiet = blocked
    ? []
    : actions.quiet.filter(
        a =>
          !(introMarked && (a.key === "noshow" || a.key === "showed")) &&
          !(a.key === "retry" && !canRetry),
      );
  // A stale read draws no live teal: the dot says "not known now".
  const own = roomTone(moment, room);
  const tone = stale && own === "now" ? "quiet" : own;
  // Nothing on the line is moving: a stale read, a room that will not be
  // made or is late, and a room the sweep should have closed.
  const frozen =
    Boolean(stale) ||
    moment === "making_down" ||
    moment === "making_late" ||
    moment === "overdue";
  // Said in the sentence itself when it is about this room.
  const red =
    health && healthTone(health) !== "good" && moment !== "making_down";
  const zone = useRef<HTMLElement>(null);
  useFocusRescue(
    zone,
    [
      undo,
      confirmEnd,
      busy,
      primary?.key,
      quiet.map(a => a.key).join(","),
    ].join("|"),
  );

  return (
    <section
      ref={zone}
      aria-label={`Video room ${room.code}`}
      className={`panel @container min-w-0 p-4 sm:p-5 ${className}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight">
          Video room on {providerName(room.provider)}
          <span className="muted ml-2 font-mono text-[13px] font-medium tracking-normal">
            {room.code}
          </span>
        </h2>
        {stale && !blocked ? (
          <StaleNote
            since={stale.since}
            kind={stale.kind ?? null}
            never="This room could not be read. Check the connection."
            onRetry={onReload}
          />
        ) : null}
      </header>

      {showLine ? (
        <RoomLine
          room={room}
          now={now}
          frozen={frozen}
          dim={Boolean(stale) || isFinal(room.state)}
          className="mt-4"
        />
      ) : null}

      <div className="mt-4 flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden
          className="mt-[7px] size-2 shrink-0 rounded-full"
          style={{ background: toneColor(tone) }}
        />
        <div className="min-w-0 flex-1">
          <Spoken
            s={sentence}
            className="text-[15px] leading-6 [overflow-wrap:anywhere]"
          />
          {hint ? (
            <p className="muted mt-0.5 text-[13px] leading-5">
              {sentenceText(hint)}
            </p>
          ) : null}
        </div>
      </div>

      {blocked ? (
        <p
          role="alert"
          className="callout-bad mt-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm [overflow-wrap:anywhere]"
        >
          {blocked}
        </p>
      ) : null}

      {notice ? <NoticeLine notice={notice} onOpened={onNoticeOpened} /> : null}

      {/* Said right under the sentence when the worker is in trouble; a
          room still being made says it in its own sentence instead. */}
      {red && health ? (
        <HealthLine
          health={health}
          sentence={panelHealthSentence(health, room)}
          className="mt-3"
        />
      ) : null}

      {confirmEnd ? (
        <ConfirmEnd busy={busy !== null} onAnswer={onConfirmEnd} />
      ) : undo ? (
        <UndoStrip label={undoLabel(undo)} startedAt={undoAt} onUndo={onUndo} />
      ) : primary || quiet.length ? (
        <Actions
          primary={primary}
          quiet={quiet}
          busy={busy}
          copied={copied}
          onAction={onAction}
        />
      ) : null}

      {events.length ? <Timeline events={events} /> : null}
    </section>
  );
}

/**
 * The quiet buttons a rep reaches for most: at most two sit beside the main
 * one. The rest wait behind More, and End room goes last on its own.
 */
const FRONT_ORDER: readonly RoomActionKey[] = [
  "count_confirm",
  "lead_in",
  "host_in",
  "open",
  "copy",
  "still_on",
  "finished",
  "not_lead",
  "noshow",
  "showed",
  "retry",
];
const FRONT_MAX = 2;

/** Split the quiet buttons: up to two up front, the rest behind More, End room apart. */
export function splitQuiet(quiet: readonly RoomAction[]): {
  front: RoomAction[];
  more: RoomAction[];
  end: RoomAction | null;
} {
  const end = quiet.find(a => a.key === "end") ?? null;
  const rest = quiet.filter(a => a.key !== "end");
  const ranked = rest
    .filter(a => FRONT_ORDER.includes(a.key))
    .sort((a, b) => FRONT_ORDER.indexOf(a.key) - FRONT_ORDER.indexOf(b.key))
    .slice(0, FRONT_MAX);
  const keep = new Set(ranked.map(a => a.key));
  const front = rest.filter(a => keep.has(a.key));
  const more = rest.filter(a => !keep.has(a.key));
  // One button behind More is no saving: it shows with the others.
  if (more.length === 1) return { front: [...front, ...more], more: [], end };
  return { front, more, end };
}

function Actions({
  primary,
  quiet,
  busy,
  copied,
  onAction,
}: {
  primary: RoomAction | null;
  quiet: RoomAction[];
  busy: RoomActionKey | null;
  copied: boolean;
  onAction: (key: RoomActionKey) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  const { front, more, end } = splitQuiet(quiet);
  const label = (a: RoomAction) =>
    a.key === "copy" && copied ? "Copied" : a.label;
  const icon = (a: RoomAction) =>
    busy === a.key ? (
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
    ) : a.key === "copy" && copied ? (
      <Check className="size-3.5" aria-hidden />
    ) : null;
  const quietButton = (a: RoomAction) => (
    <button
      key={a.key}
      type="button"
      onClick={() => onAction(a.key)}
      disabled={busy !== null}
      aria-busy={busy === a.key}
      data-key={a.key}
      className={`${button} h-9 flex-[1_1_auto] whitespace-nowrap @md:flex-none ${TOUCH}`}
    >
      {icon(a)}
      {label(a)}
    </button>
  );
  // A press from behind More keeps its row open while the panel changes.
  const openMore =
    moreOpen || (busy !== null && more.some(a => a.key === busy));
  return (
    <div className="mt-4">
      {/* The panel's own width decides: on a narrow card the main button
          takes the row and the quiet ones fill the rows under it; on a
          wide one they run in one line, with End room at the far end. */}
      <div className="flex flex-col gap-2 @md:flex-row @md:flex-wrap @md:items-center">
        {primary ? (
          <button
            type="button"
            onClick={() => onAction(primary.key)}
            disabled={busy !== null}
            aria-busy={busy === primary.key}
            data-key={primary.key}
            className={`${buttonPrimary} h-9 w-full @md:w-auto ${TOUCH}`}
          >
            {icon(primary)}
            {label(primary)}
          </button>
        ) : null}
        {front.length ? (
          <div className="flex flex-wrap gap-2">{front.map(quietButton)}</div>
        ) : null}
        {more.length || end ? (
          <div className="flex items-center gap-3 @md:contents">
            {more.length ? (
              <button
                type="button"
                aria-expanded={openMore}
                aria-controls={moreId}
                onClick={() => setMoreOpen(o => !o)}
                className={`muted inline-flex h-9 items-center gap-1 px-1 text-sm font-medium underline-offset-2 hover:underline ${TOUCH}`}
              >
                More
                <ChevronDown
                  className={`size-3.5 transition-transform ${openMore ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
            ) : null}
            {end ? (
              <button
                type="button"
                onClick={() => onAction(end.key)}
                disabled={busy !== null}
                aria-busy={busy === end.key}
                data-key={end.key}
                className={`muted ms-auto inline-flex h-9 items-center gap-1 px-1 text-sm font-medium underline-offset-2 hover:text-[color:var(--destructive)] hover:underline disabled:opacity-50 ${TOUCH}`}
              >
                {icon(end)}
                {end.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {more.length && openMore ? (
        <div id={moreId} className="mt-2 flex flex-wrap gap-2">
          {more.map(quietButton)}
        </div>
      ) : null}
    </div>
  );
}

function UndoStrip({
  label,
  startedAt,
  onUndo,
}: {
  label: string;
  startedAt: number | null;
  onUndo: () => void;
}) {
  // The seconds in words too: under reduced motion the bar does not drain.
  const now = useNow(250);
  const left = secondsLeft(startedAt ?? now, UNDO_MS, now);
  return (
    <div className="relative mt-4 flex min-w-0 items-center gap-2 overflow-hidden rounded-[var(--radius-md)] border hairline px-3 py-2 text-sm">
      <span
        aria-hidden
        className="drain absolute inset-x-0 bottom-0 h-0.5"
        style={
          {
            background: "var(--now)",
            "--undo-ms": `${UNDO_MS}ms`,
          } as CSSProperties
        }
      />
      <span className="min-w-0 flex-1" role="status">
        {label}
      </span>
      {/* Focus lands here when the press that started it goes, so a
          keyboard can take it back inside the five seconds. */}
      <button
        type="button"
        onClick={onUndo}
        data-autofocus
        className={`inline-flex min-h-8 shrink-0 items-center gap-1 px-1 text-sm font-medium underline-offset-2 hover:underline ${TOUCH}`}
      >
        <RotateCcw className="size-3.5" aria-hidden />
        Undo
        <span aria-hidden className="muted font-mono text-[12px]">
          · {left} s
        </span>
      </button>
    </div>
  );
}

function ConfirmEnd({
  busy,
  onAnswer,
}: {
  busy: boolean;
  onAnswer: (yes: boolean) => void;
}) {
  return (
    <div className="callout-warn mt-4 rounded-[var(--radius-md)] border px-3 py-2.5">
      <p className="text-sm" role="alert">
        The lead is still in this room. End it anyway?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(true)}
          className={`${button} h-9 ${TOUCH}`}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          Yes, end it
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(false)}
          data-autofocus
          className={`${buttonPrimary} h-9 ${TOUCH}`}
        >
          Keep it
        </button>
      </div>
    </div>
  );
}

export function NoticeLine({
  notice,
  onOpened,
  className = "mt-3",
}: {
  notice: Notice;
  onOpened: () => void;
  className?: string;
}) {
  const cls =
    notice.tone === "good"
      ? "callout-good"
      : notice.tone === "owed"
        ? "callout-warn"
        : "callout-bad";
  const open = notice.open;
  return (
    <p
      role={notice.tone === "bad" ? "alert" : "status"}
      className={`${cls} ${className} rounded-[var(--radius-md)] border px-3 py-2 text-sm [overflow-wrap:anywhere]`}
    >
      {notice.text}
      {open ? (
        <>
          {" "}
          <button
            type="button"
            onClick={() => {
              window.open(open.url, "_blank", "noopener,noreferrer");
              onOpened();
            }}
            data-autofocus
            className={`inline-flex items-center font-medium underline underline-offset-2 ${TOUCH}`}
          >
            {open.label}
          </button>
        </>
      ) : null}
    </p>
  );
}

/** The room's last events, folded away until asked for. */
function Timeline({ events }: { events: RoomEvent[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mt-4 border-t hairline pt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
        className={`muted inline-flex min-h-8 items-center text-xs underline-offset-2 hover:underline ${TOUCH}`}
      >
        {open ? "Hide the timeline" : "Show the timeline"}
      </button>
      {open ? (
        <ol id={id} className="muted mt-1 space-y-1 text-xs leading-relaxed">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-2">
              <span className="shrink-0 font-mono">{clockSec(e.at)}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{e.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** "Rooms: working. Last run 14:03:58. 6 rooms today, 0 failed." with its dot, times in mono. */
export function HealthLine({
  health,
  className = "",
  sentence,
  tone: toneOver,
}: {
  health: Health;
  className?: string;
  /** Said instead of the health sentence (the Team page's summary). */
  sentence?: string;
  tone?: "good" | "owed" | "bad";
}) {
  const tone = toneOver ?? healthTone(health);
  return (
    <p
      className={`flex min-w-0 items-start gap-2 text-[13px] leading-5 ${className}`}
    >
      <span
        aria-hidden
        className="mt-1.5 size-2 shrink-0 rounded-full"
        style={{
          background:
            tone === "bad"
              ? "var(--destructive)"
              : tone === "owed"
                ? "var(--owed)"
                : "var(--won)",
        }}
      />
      <span className="min-w-0">
        <Say s={monoTimes(sentence ?? healthSentence(health))} />
      </span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// The connected panel
// ---------------------------------------------------------------------------

export interface RoomPanelProps {
  room: RoomView;
  /**
   * What room.create was asked for this room, so "Try Zoom" asks for the
   * same room on the other provider, with its trigger, attempt and booked
   * call (the room's own fields are the fallback).
   */
  request?: CreateRoom | null;
  /**
   * A handover's "Use Meet": project 2's own action makes the new room
   * inside the claim. Without it a handover room shows no retry here.
   */
  onRetry?: (provider: Provider) => Promise<RoomView>;
  onMarkIntro?: (status: "noshow" | "showed") => Promise<void>;
  /** The page draws the call's own step below the panel (the dialer, stress2 round 3). */
  talkBelow?: boolean;
  onRoomChange?: (room: RoomView) => void;
  /**
   * What the panel reads beside the room (room.status): whether the other
   * provider is usable now, and the server's clock offset, so the page's own
   * step under the panel says what the panel says (m1 round 4).
   */
  onFeed?: (f: { otherOk: boolean | null; offset: number }) => void;
  className?: string;
}

/**
 * The room panel as a page uses it: give it the room `room.create` (or
 * `room.wrap`) returned and it reads the room until it is final, runs the
 * presses, and hands a changed room back through `onRoomChange` (a new one
 * too, after "Try Zoom").
 *
 * `onMarkIntro` is for a booked intro: with it, an expired room asks for
 * the intro's mark ("No-show", "We spoke on the phone") instead of saying
 * "Call again or send a message".
 *
 * Behind its own boundary: a room that cannot be drawn says so in place,
 * and the dialer around it keeps working.
 */
export function RoomPanel(props: RoomPanelProps) {
  const link = shortLink(props.room);
  return (
    <LiveBoundary
      fallback={
        <p
          role="alert"
          className={`callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm [overflow-wrap:anywhere] ${props.className ?? ""}`}
        >
          The video room could not be shown. Reload the page to see it again.
          {props.room.code ? (
            <>
              {" "}
              Your room's code is{" "}
              <span className="font-mono">{props.room.code}</span>
              {link ? (
                <>
                  , link <span className="font-mono">{link}</span>
                </>
              ) : null}
              .
            </>
          ) : null}
        </p>
      }
    >
      <LiveRoomPanel {...props} />
    </LiveBoundary>
  );
}

/** A press held behind its Undo, and the room it was pressed on. */
interface Held {
  key: RoomActionKey;
  roomId: string;
}

function LiveRoomPanel({
  room: start,
  request = null,
  onRetry,
  onMarkIntro,
  talkBelow = false,
  onRoomChange,
  onFeed,
  className = "",
}: RoomPanelProps) {
  // The room on show, and what was known of it before its first read: the
  // page's room, or the one "Try Zoom" made.
  const [shown, setShown] = useState<RoomView>(start);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new room from the page replaces the one on show
  useEffect(() => setShown(start), [start.id]);
  const feed = useRoomStatus(shown.id, shown);
  // The banner above draws this room's button quietly while it is here.
  useRoomOnScreen(shown.id);
  const localNow = useNow(1000);
  // The server's clock, for every countdown and gate.
  const now = localNow + feed.offset;
  const [busy, setBusy] = useState<RoomActionKey | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [copied, setCopied] = useState(false);
  const [introMarked, setIntroMarked] = useState(false);
  const navigate = useNavigate();
  const [stillAt, setStillAt] = useState<{ id: string; at: number } | null>(
    null,
  );
  const busyRef = useRef(false);
  const latest = useRef<RoomView | null>(feed.data?.room ?? null);
  latest.current = feed.data?.room ?? latest.current;
  const changed = useRef(onRoomChange);
  changed.current = onRoomChange;
  const markIntro = useRef(onMarkIntro);
  markIntro.current = onMarkIntro;
  const asked = useRef(request);
  asked.current = request;
  const swap = useRef(onRetry);
  swap.current = onRetry;
  const linkTimer = useRef<number | null>(null);
  const { set: setFeed, reload } = feed;
  const reportFeed = useRef(onFeed);
  reportFeed.current = onFeed;
  const otherOkNow = feed.data?.other_ok ?? null;
  useEffect(() => {
    reportFeed.current?.({ otherOk: otherOkNow, offset: feed.offset });
  }, [otherOkNow, feed.offset]);

  const room = feed.data?.room ?? null;
  // Who is looking, read only when a join marked by hand waits to be counted.
  const me = useMe(room?.count_result === "self_reported");
  const stillOn = Boolean(
    room &&
      stillAt?.id === room.id &&
      localNow - stillAt.at < STILL_ON_ASK_AGAIN_MS,
  );
  const moment = room ? momentFor(room, { now, stillOn }) : null;

  // A closed room shown here is seen: the banner lets it go (stress2 round 3).
  const finalId = room && isFinal(room.state) ? room.id : null;
  useEffect(() => {
    if (finalId) markFinalSeen(finalId);
  }, [finalId]);

  // The page above hears of every change (the dialer hides its own button
  // while a room is open).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the row's identity and version
  useEffect(() => {
    if (room) changed.current?.(room);
  }, [room?.id, room?.version]);

  // A rep in the Meet or Zoom tab is called back: the tab's title, a short
  // sound and a notification, once for each moment (the banner uses the
  // same key, so the two never say it twice).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the moment matters
  useEffect(() => {
    if (!room || !moment || !CALL_BACK.has(moment)) return;
    alertWhileHidden(
      `room:${room.id}:${moment}`,
      // On the server's clock, as the panel itself says it (stress2 round 3).
      sentenceText(bannerRoomSentence(room, Date.now() + feed.offset), true),
    );
  }, [moment, room?.id]);

  useEffect(
    () => () => {
      if (linkTimer.current) window.clearTimeout(linkTimer.current);
    },
    [],
  );

  /** A press's answer on screen now; a later read never takes it back. */
  function apply(next: RoomView) {
    setFeed(prev =>
      mergeRoomFeed(prev, {
        room: next,
        events: prev?.room.id === next.id ? prev.events : [],
        health: prev?.health ?? null,
      }),
    );
    // The strip hears of it too, with the room, so its own read on the
    // way cannot bring an ended room back.
    roomsChanged(next);
  }

  function failed(e: unknown) {
    if (needsEndConfirm(e)) {
      setConfirmEnd(true);
      reload();
      return;
    }
    setNotice({ tone: isStale(e) ? "owed" : "bad", text: errorText(e) });
    reload();
  }

  async function run(key: RoomActionKey, work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      failed(e);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  /** The host link the browser would not open in a new tab: a button, for a minute. */
  function offerHostLink(url: string) {
    setNotice({
      tone: "owed",
      text: "Your browser blocked the new tab.",
      open: { url, label: "Open my room" },
    });
    if (linkTimer.current) window.clearTimeout(linkTimer.current);
    linkTimer.current = window.setTimeout(() => {
      linkTimer.current = null;
      setNotice(n =>
        n?.open
          ? {
              tone: "owed",
              text: "The host link was cleared after a minute. Press Open my room again.",
            }
          : n,
      );
    }, 60_000);
  }

  /** The room's own link, when the host link could not be had: a button, for a minute. */
  function offerRoomLink(url: string) {
    setNotice({
      tone: "owed",
      text: "The cockpit could not get your host link. Open the room with its own link.",
      open: { url, label: "Open the room" },
    });
    if (linkTimer.current) window.clearTimeout(linkTimer.current);
    linkTimer.current = window.setTimeout(() => {
      linkTimer.current = null;
      setNotice(n => (n?.open ? null : n));
    }, 60_000);
  }

  async function retry(r: RoomView, provider: Provider) {
    if (r.purpose === "handover") {
      const make = swap.current;
      if (!make) return;
      const next = normalizeRoom(await make(provider));
      if (next) setShown(next);
      return;
    }
    // A room still open (a Zoom link nobody can say, one still being made
    // long past its time) is replaced in one call: sales-api checks the new
    // room first and cancels this one only when the new one will be made, so
    // a refusal leaves the lead's link leading somewhere (m1 round 4).
    const out = await roomsApi.create(retryRequest(r, asked.current, provider));
    setShown(out.room);
  }

  const held = useUndo<Held>(({ key, roomId }) => {
    // The press was for the room on show when it was pressed; if another
    // room has taken its place in the five seconds, it is not sent.
    const r = heldTarget(roomId, latest.current);
    if (!r) {
      setNotice({
        tone: "owed",
        text: "The room changed before that press went, so it was not sent. Press it again if you still mean it.",
      });
      return;
    }
    void run(key, async () => {
      switch (key) {
        case "lead_in":
        case "not_lead":
          apply((await roomsApi.mark(r, key)).room);
          return;
        case "finished":
          // The rep says the call is over, so the lead-in question is answered.
          apply((await roomsApi.end(r, "finished", true)).room);
          return;
        case "admit_blocked": {
          // P1 edge case 9: this Meet room closes and the lead moves to
          // Zoom. sales-api makes the Zoom room in the same request, or
          // says why it made none; the panel never makes a plain room of
          // its own (m1 round 2: no "moved" words, no night rule cleared).
          const out = await roomsApi.end(r, "admit_blocked");
          apply(out.room);
          const next = afterAdmitBlocked(out);
          if (next.kind === "show") setShown(next.room);
          else setNotice({ tone: "bad", text: next.text });
          return;
        }
        case "noshow":
        case "showed": {
          const mark = markIntro.current;
          if (!mark) return;
          await mark(key);
          setIntroMarked(true);
          setNotice({
            tone: "good",
            text: key === "noshow" ? "Marked no-show." : "Marked showed.",
          });
          return;
        }
      }
    });
  });

  async function onAction(key: RoomActionKey) {
    const r = latest.current;
    if (!r || busyRef.current || held.pending) return;
    if (key === "still_on") {
      // Shown at once, and told to sales-api (room.mark still_on), which moves
      // the room's end ten minutes on: the sweep then counts from this answer
      // and never closes a call the rep says is still running (fix round 4).
      setStillAt({ id: r.id, at: Date.now() });
      await run(key, async () =>
        apply((await roomsApi.mark(r, "still_on")).room),
      );
      return;
    }
    if (needsUndo(key)) {
      setNotice(null);
      held.start({ key, roomId: r.id });
      return;
    }
    if (key === "copy") {
      const link = shortLink(r) ?? "";
      const ok = await copyText(link);
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } else
        setNotice({
          tone: "owed",
          text: `Copy did not work here. The link is ${link}`,
        });
      return;
    }
    if (key === "end" && r.state === "lead_in") {
      setConfirmEnd(true);
      return;
    }
    // The dialer's pane for this lead, where the next call is booked and how
    // the call went is saved (stress2 round 4).
    if (key === "to_dialer") {
      if (r.contact_id)
        navigate(`/dialer?lead=${encodeURIComponent(r.contact_id)}`);
      return;
    }
    await run(key, async () => {
      switch (key) {
        case "open": {
          try {
            const out = await openHostRoom(r.id);
            if (out.kind === "blocked") offerHostLink(out.url);
          } catch (e) {
            // No host link (the server unreachable, slow, or garbled): the
            // room's own link still gets the rep in. Meet always uses it;
            // Zoom lets a signed-in host in through it too (contract 0b.4).
            if (!uncertain(e) || !r.join_url) throw e;
            offerRoomLink(r.join_url);
          }
          return;
        }
        case "host_in":
          apply((await roomsApi.mark(r, "host_in")).room);
          return;
        case "count_confirm":
          apply((await roomsApi.countConfirm(r.id)).room);
          setNotice({
            tone: "good",
            text: "Counted: the join is booked and marked shown in HighLevel.",
          });
          return;
        case "email":
          apply((await roomsApi.sendEmail(r.id)).room);
          setNotice({ tone: "good", text: "Sent by email." });
          return;
        case "end":
          apply(
            (await roomsApi.end(r, isMaking(r.state) ? "cancel" : "end")).room,
          );
          return;
        case "on_phone":
          apply((await roomsApi.end(r, "on_phone")).room);
          return;
        case "retry":
          if (isFinal(r.state) && r.result === "admit_blocked") {
            // The Meet room is closed and its Zoom replacement was not made:
            // ask again for that same replacement (sales-api makes it once).
            const out = await roomsApi.end(r, "admit_blocked");
            apply(out.room);
            const next = afterAdmitBlocked(out);
            if (next.kind === "show") setShown(next.room);
            else setNotice({ tone: "bad", text: next.text });
            return;
          }
          await retry(r, otherProvider(r.provider));
          return;
      }
    });
  }

  async function answerEnd(yes: boolean) {
    const r = latest.current;
    if (!yes || !r) {
      setConfirmEnd(false);
      return;
    }
    await run("end", async () => {
      apply((await roomsApi.end(r, "end", true)).room);
      setConfirmEnd(false);
    });
  }

  if (!feed.data) {
    // Never reached with a room from the page (it seeds the read), but a
    // panel with nothing to draw still says so.
    return (
      <p className={`muted text-sm ${className}`} role="status">
        {feed.error ?? "Reading the video room..."}
      </p>
    );
  }

  const blocked = feed.stopped && feed.error ? feed.error : null;
  return (
    <RoomPanelView
      feed={feed.data}
      now={now}
      canMarkIntro={Boolean(onMarkIntro)}
      talkBelow={talkBelow}
      busy={busy}
      notice={notice}
      undo={held.pending?.key ?? null}
      undoAt={held.startedAt}
      confirmEnd={confirmEnd}
      copied={copied}
      stale={readIsOld(feed, localNow)}
      blocked={blocked}
      onReload={reload}
      introMarked={introMarked}
      canRetry={shown.purpose !== "handover" || Boolean(onRetry)}
      stillOn={stillOn}
      manager={Boolean(me.data?.manager)}
      onAction={key => void onAction(key)}
      onUndo={held.undo}
      onConfirmEnd={yes => void answerEnd(yes)}
      onNoticeOpened={() => {
        if (linkTimer.current) window.clearTimeout(linkTimer.current);
        linkTimer.current = null;
        setNotice(null);
      }}
      className={className}
    />
  );
}
