import { Check, Loader2, RotateCcw } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { useNow } from "../lib/data";
import {
  alertWhileHidden,
  bannerRoomSentence,
  type CreateRoom,
  clockSec,
  copyText,
  errorText,
  type Health,
  healthSentence,
  healthTone,
  heldTarget,
  isMaking,
  isStale,
  mergeRoomFeed,
  momentFor,
  needsEndConfirm,
  needsUndo,
  normalizeRoom,
  openHostRoom,
  otherProvider,
  type Provider,
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
  sentenceText,
  shortLink,
  UNDO_MS,
  undoLabel,
  useFocusRescue,
  useRoomStatus,
  useUndo,
} from "../lib/rooms";
import { StaleNote } from "./AvailabilityStrip";
import { button, buttonPrimary } from "./kit";
import { LiveBoundary, RoomLine, Spoken, toneColor } from "./RoomLine";

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
   * the new tab). It is opened from a button, never written into the page,
   * and the panel clears it after a minute.
   */
  open?: { url: string; label: string };
}

const TOUCH = "pointer-coarse:min-h-11";

export interface RoomPanelViewProps {
  feed: RoomFeed;
  now: number;
  canMarkIntro?: boolean;
  /** The press on its way; every button waits while one is. */
  busy?: RoomActionKey | null;
  notice?: Notice | null;
  /** A press held behind its Undo. */
  undo?: RoomActionKey | null;
  confirmEnd?: boolean;
  copied?: boolean;
  /** What shows may be old: since the last good read, or never read. */
  stale?: { since: number | null } | null;
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
  onAction?: (key: RoomActionKey) => void;
  onUndo?: () => void;
  onConfirmEnd?: (yes: boolean) => void;
  /** The notice's link was opened: the panel lets it go. */
  onNoticeOpened?: () => void;
  className?: string;
}

export function RoomPanelView({
  feed,
  now,
  canMarkIntro = false,
  busy = null,
  notice = null,
  undo = null,
  confirmEnd = false,
  copied = false,
  stale = null,
  blocked = null,
  introMarked = false,
  canRetry = true,
  stillOn = false,
  onAction = () => undefined,
  onUndo = () => undefined,
  onConfirmEnd = () => undefined,
  onNoticeOpened = () => undefined,
  className = "",
}: RoomPanelViewProps) {
  const { room, events, health } = feed;
  const ctx = { now, canMarkIntro, stillOn };
  const moment = momentFor(room, ctx);
  const sentence = roomSentence(room, ctx);
  const hint = roomHint(room, now);
  const actions = roomActions(room, ctx);
  const primary =
    blocked || (actions.primary?.key === "retry" && !canRetry)
      ? null
      : actions.primary;
  const quiet = blocked
    ? []
    : introMarked
      ? actions.quiet.filter(a => a.key !== "noshow" && a.key !== "showed")
      : actions.quiet;
  const tone = roomTone(moment);
  // A failed room never got as far as a step, and a standby room has no
  // lead to wait for: neither draws the line.
  const showLine =
    room.state !== "failed" &&
    (room.purpose !== "standby" || Boolean(room.contact_id));
  const red = health && healthTone(health) !== "good";
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
      className={`panel min-w-0 p-4 sm:p-5 ${className}`}
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
            never="This room could not be read. Check the connection."
          />
        ) : null}
      </header>

      {showLine ? <RoomLine room={room} now={now} className="mt-4" /> : null}

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

      {/* Said right under the sentence: a room still "making" while the
          worker is down will not be made. */}
      {red && health ? <HealthLine health={health} className="mt-3" /> : null}

      {confirmEnd ? (
        <ConfirmEnd busy={busy !== null} onAnswer={onConfirmEnd} />
      ) : undo ? (
        <UndoStrip label={undoLabel(undo)} onUndo={onUndo} />
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
  const label = (a: RoomAction) =>
    a.key === "copy" && copied ? "Copied" : a.label;
  const icon = (a: RoomAction) =>
    busy === a.key ? (
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
    ) : a.key === "copy" && copied ? (
      <Check className="size-3.5" aria-hidden />
    ) : null;
  return (
    // On a phone the main button takes the row and the quiet ones sit two
    // to a row under it; from a tablet up they run in one line.
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {primary ? (
        <button
          type="button"
          onClick={() => onAction(primary.key)}
          disabled={busy !== null}
          aria-busy={busy === primary.key}
          data-key={primary.key}
          className={`${buttonPrimary} h-9 w-full sm:w-auto ${TOUCH}`}
        >
          {icon(primary)}
          {label(primary)}
        </button>
      ) : null}
      {quiet.length ? (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {quiet.map(a => (
            <button
              key={a.key}
              type="button"
              onClick={() => onAction(a.key)}
              disabled={busy !== null}
              aria-busy={busy === a.key}
              data-key={a.key}
              className={`${button} h-9 min-w-0 whitespace-normal text-center leading-tight ${TOUCH}`}
            >
              {icon(a)}
              {label(a)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UndoStrip({ label, onUndo }: { label: string; onUndo: () => void }) {
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
        className={`inline-flex shrink-0 items-center gap-1 px-1 text-sm font-medium underline-offset-2 hover:underline ${TOUCH}`}
      >
        <RotateCcw className="size-3.5" aria-hidden />
        Undo
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

function NoticeLine({
  notice,
  onOpened,
}: {
  notice: Notice;
  onOpened: () => void;
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
      className={`${cls} mt-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm [overflow-wrap:anywhere]`}
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
        {open ? "Hide the timeline" : "Timeline"}
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

/** "Rooms: working. Last run 14:03:58. 6 rooms today, 0 failed." with its dot. */
export function HealthLine({
  health,
  className = "",
}: {
  health: Health;
  className?: string;
}) {
  const tone = healthTone(health);
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
      <span className="min-w-0">{healthSentence(health)}</span>
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
  onRoomChange?: (room: RoomView) => void;
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
  return (
    <LiveBoundary
      fallback={
        <p
          role="alert"
          className={`callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm ${props.className ?? ""}`}
        >
          The video room could not be shown. Reload the page to see it again.
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
  onRoomChange,
  className = "",
}: RoomPanelProps) {
  // The room on show, and what was known of it before its first read: the
  // page's room, or the one "Try Zoom" made.
  const [shown, setShown] = useState<RoomView>(start);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new room from the page replaces the one on show
  useEffect(() => setShown(start), [start.id]);
  const feed = useRoomStatus(shown.id, shown);
  const localNow = useNow(1000);
  // The server's clock, for every countdown and gate.
  const now = localNow + feed.offset;
  const [busy, setBusy] = useState<RoomActionKey | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [copied, setCopied] = useState(false);
  const [introMarked, setIntroMarked] = useState(false);
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

  const room = feed.data?.room ?? null;
  const stillOn = Boolean(
    room &&
      stillAt?.id === room.id &&
      localNow - stillAt.at < STILL_ON_ASK_AGAIN_MS,
  );
  const moment = room ? momentFor(room, { now, stillOn }) : null;

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
    if (!room || (moment !== "opened" && moment !== "waiting_room")) return;
    alertWhileHidden(
      `room:${room.id}:${moment}`,
      sentenceText(bannerRoomSentence(room, Date.now()), true),
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

  async function retry(r: RoomView, provider: Provider) {
    if (r.purpose === "handover") {
      const make = swap.current;
      if (!make) return;
      const next = normalizeRoom(await make(provider));
      if (next) setShown(next);
      return;
    }
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
          // P1 edge case 9: this Meet room closes and the lead moves to Zoom.
          const out = await roomsApi.end(r, "admit_blocked");
          apply(out.room);
          if (out.replacement) {
            setShown(out.replacement);
            return;
          }
          await retry(r, "zoom");
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
      setStillAt({ id: r.id, at: Date.now() });
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
    await run(key, async () => {
      switch (key) {
        case "open": {
          const out = await openHostRoom(r.id);
          if (out.kind === "blocked") offerHostLink(out.url);
          return;
        }
        case "host_in":
          apply((await roomsApi.mark(r, "host_in")).room);
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
      busy={busy}
      notice={notice}
      undo={held.pending?.key ?? null}
      confirmEnd={confirmEnd}
      copied={copied}
      stale={readIsOld(feed, localNow)}
      blocked={blocked}
      introMarked={introMarked}
      canRetry={shown.purpose !== "handover" || Boolean(onRetry)}
      stillOn={stillOn}
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
