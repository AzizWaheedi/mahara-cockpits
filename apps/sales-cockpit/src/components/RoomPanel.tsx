import { Check, Loader2, RotateCcw } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { useNow } from "../lib/data";
import {
  clockSec,
  copyText,
  errorText,
  type Health,
  healthSentence,
  healthTone,
  isMaking,
  isStale,
  mergeRoomFeed,
  needsEndConfirm,
  needsUndo,
  openHostRoom,
  otherProvider,
  providerName,
  type RoomAction,
  type RoomActionKey,
  type RoomEvent,
  type RoomFeed,
  type RoomView,
  roomActions,
  roomHint,
  roomMoment,
  roomSentence,
  roomsApi,
  roomsChanged,
  roomTone,
  sentenceText,
  shortLink,
  UNDO_MS,
  undoLabel,
  useRoomStatus,
  useUndo,
} from "../lib/rooms";
import { button, buttonPrimary, Failed, Reading } from "./kit";
import { RoomLine, Spoken, toneColor } from "./RoomLine";

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
  link?: { href: string; label: string };
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
  /** The last read failed and what shows is the last good one. */
  readError?: string | null;
  /** The booked intro is marked already, so its two buttons go. */
  introMarked?: boolean;
  onAction?: (key: RoomActionKey) => void;
  onUndo?: () => void;
  onConfirmEnd?: (yes: boolean) => void;
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
  readError = null,
  introMarked = false,
  onAction = () => undefined,
  onUndo = () => undefined,
  onConfirmEnd = () => undefined,
  className = "",
}: RoomPanelViewProps) {
  const { room, events, health } = feed;
  const ctx = { now, canMarkIntro };
  const moment = roomMoment(room, now);
  const sentence = roomSentence(room, ctx);
  const hint = roomHint(room, now);
  const actions = roomActions(room, ctx);
  const primary = actions.primary;
  const quiet = introMarked
    ? actions.quiet.filter(a => a.key !== "noshow" && a.key !== "showed")
    : actions.quiet;
  const tone = roomTone(moment);
  // A failed room never got as far as a step, and a standby room has no
  // lead to wait for: neither draws the line.
  const showLine =
    room.state !== "failed" &&
    (room.purpose !== "standby" || Boolean(room.contact_id));
  const red = health && healthTone(health) !== "good";

  return (
    <section
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
        {readError ? (
          <span className="txt-warn text-[12px]">Not updated: {readError}</span>
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

      {notice ? <NoticeLine notice={notice} /> : null}

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
      <button
        type="button"
        onClick={onUndo}
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
          className={`${buttonPrimary} h-9 ${TOUCH}`}
        >
          Keep it
        </button>
      </div>
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  const cls =
    notice.tone === "good"
      ? "callout-good"
      : notice.tone === "owed"
        ? "callout-warn"
        : "callout-bad";
  return (
    <p
      role={notice.tone === "bad" ? "alert" : "status"}
      className={`${cls} mt-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm [overflow-wrap:anywhere]`}
    >
      {notice.text}
      {notice.link ? (
        <>
          {" "}
          <a
            href={notice.link.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center font-medium underline underline-offset-2 ${TOUCH}`}
          >
            {notice.link.label}
          </a>
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

/**
 * The room panel as a page uses it: give it the room `room.create` (or
 * `room.wrap`) returned and it reads the room until it is final, runs the
 * presses, and hands a changed room back through `onRoomChange` (a new one
 * too, after "Try Zoom").
 *
 * `onMarkIntro` is for a booked intro: with it, an expired room asks for
 * the intro's mark ("No-show", "We spoke on the phone") instead of saying
 * "Call again or send a message".
 */
export function RoomPanel({
  room: start,
  onMarkIntro,
  onRoomChange,
  className = "",
}: {
  room: RoomView;
  onMarkIntro?: (status: "noshow" | "showed") => Promise<void>;
  onRoomChange?: (room: RoomView) => void;
  className?: string;
}) {
  // The room on show, and what was known of it before its first read: the
  // page's room, or the one "Try Zoom" made.
  const [shown, setShown] = useState<RoomView>(start);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new room from the page replaces the one on show
  useEffect(() => setShown(start), [start.id]);
  const feed = useRoomStatus(shown.id, shown);
  const now = useNow(1000);
  const [busy, setBusy] = useState<RoomActionKey | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [copied, setCopied] = useState(false);
  const [introMarked, setIntroMarked] = useState(false);
  const busyRef = useRef(false);
  const latest = useRef<RoomView | null>(feed.data?.room ?? null);
  latest.current = feed.data?.room ?? latest.current;
  const changed = useRef(onRoomChange);
  changed.current = onRoomChange;
  const markIntro = useRef(onMarkIntro);
  markIntro.current = onMarkIntro;
  const { set: setFeed, reload } = feed;

  const room = feed.data?.room ?? null;
  const moment = room ? roomMoment(room, now) : null;

  // The page above hears of every change (the dialer hides its own button
  // while a room is open).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the row's identity and version
  useEffect(() => {
    if (room) changed.current?.(room);
  }, [room?.id, room?.version]);

  // A rep in the Meet tab sees the cockpit's tab say the lead is coming.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the moment matters
  useEffect(() => {
    if (!room || (moment !== "opened" && moment !== "waiting_room")) return;
    const was = document.title;
    const say = () => {
      if (document.visibilityState === "hidden")
        document.title = `${sentenceText(roomSentence(room, { now: Date.now() }), true)} · ${was}`;
      else document.title = was;
    };
    say();
    document.addEventListener("visibilitychange", say);
    return () => {
      document.removeEventListener("visibilitychange", say);
      document.title = was;
    };
  }, [moment, room?.id]);

  /** A press's answer on screen now; a later read never takes it back. */
  function apply(next: RoomView) {
    setFeed(prev =>
      mergeRoomFeed(prev, {
        room: next,
        events: prev?.room.id === next.id ? prev.events : [],
        health: prev?.health ?? null,
      }),
    );
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
      roomsChanged();
    } catch (e) {
      failed(e);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const held = useUndo<RoomActionKey>(key => {
    const r = latest.current;
    if (!r) return;
    void run(key, async () => {
      if (key === "lead_in" || key === "not_lead") {
        apply((await roomsApi.mark(r, key)).room);
        return;
      }
      const mark = markIntro.current;
      if (!mark) return;
      await mark(key === "noshow" ? "noshow" : "showed");
      setIntroMarked(true);
      setNotice({
        tone: "good",
        text: key === "noshow" ? "Marked no-show." : "Marked showed.",
      });
    });
  });

  async function onAction(key: RoomActionKey) {
    const r = latest.current;
    if (!r || busyRef.current || held.pending) return;
    if (needsUndo(key)) {
      setNotice(null);
      held.start(key);
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
          if (out.kind === "blocked")
            setNotice({
              tone: "owed",
              text: "Your browser blocked the new tab.",
              link: { href: out.url, label: "Open my room" },
            });
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
        case "finished":
          // The rep says the call is over, so the lead-in question is answered.
          apply((await roomsApi.end(r, "finished", true)).room);
          return;
        case "retry": {
          const out = await roomsApi.create({
            contact_id: r.contact_id,
            provider: otherProvider(r.provider),
            call_kind: r.call_kind,
            purpose: r.purpose,
          });
          setShown(out.room);
          return;
        }
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
    if (feed.error)
      return (
        <div className={className}>
          <Failed what="The video room" error={feed.error} retry={reload} />
        </div>
      );
    return <Reading what="the video room" className={`text-sm ${className}`} />;
  }

  return (
    <RoomPanelView
      feed={feed.data}
      now={now}
      canMarkIntro={Boolean(onMarkIntro)}
      busy={busy}
      notice={notice}
      undo={held.pending}
      confirmEnd={confirmEnd}
      copied={copied}
      readError={feed.failures >= 2 ? feed.error : null}
      introMarked={introMarked}
      onAction={key => void onAction(key)}
      onUndo={held.undo}
      onConfirmEnd={yes => void answerEnd(yes)}
      className={className}
    />
  );
}
