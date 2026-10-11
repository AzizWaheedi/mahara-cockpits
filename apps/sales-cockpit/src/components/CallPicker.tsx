import {
  ArrowLeft,
  CalendarClock,
  CalendarPlus,
  CircleCheck,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { ApiError, api, uncertain } from "../lib/api";
import { ghlContactUrl } from "../lib/highlevel";
import {
  type ApptOut,
  type As,
  type BookResult,
  type CallKind,
  CHECK_EVERY_MS,
  CHECK_FOR_MS,
  type CheckResult,
  clockLine,
  dayChips,
  defaultWith,
  doneSub,
  doneTitle,
  firstOf,
  HOLD_MS,
  holdWords,
  kindNoun,
  type LeadLike,
  type MoveReason,
  type MoveResult,
  type MoveSource,
  noTimesLine,
  pickerKey,
  pickerLine,
  reasonChips,
  refusalLine,
  type Slots,
  type Tile,
  theirTime,
  tileOf,
  tiles,
  toastWords,
  untilWords,
  whenWords,
} from "../lib/reschedule";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";
import type { Lang } from "../lib/zoomLink";
import { button, field, Segmented } from "./kit";
import { TellThem } from "./TellThem";

/**
 * The one picker (plan D6 to D14), on the lead page, Today, the Calendar,
 * the dialer and the scripts: the soonest four free times as tiles, then
 * Another day. Pressing a time is the action: a four-second hold with Undo,
 * then it goes to HighLevel (book.move moves the call in place; book.create
 * books a new one). Errors and doubt stay here, never in a toast; the toast
 * is for success only. The done state says what happened and opens Tell
 * them with the message ready.
 *
 * Desktop keys, as an extra: 1 to 4 press the soonest times, A opens
 * Another day, Esc closes the picker or undoes the hold.
 */

export interface PickerDone {
  mode: "reschedule" | "book";
  kind: CallKind;
  start: string;
  appointment: ApptOut | null;
  host: string | null;
  /** The host before a move, when the move changed it. */
  wasHost: string | null;
  rescheduleId: string | null;
  /** False: HighLevel took it, but reading it back did not match. */
  verified: boolean;
}

type Phase =
  | { k: "pick" }
  | {
      k: "hold";
      start: string;
      userId: string | null;
      host: string | null;
      requestId: string;
    }
  | { k: "sending"; start: string }
  | {
      k: "checking";
      start: string;
      requestId: string;
      rescheduleId: string | null;
      since: number;
    }
  | { k: "done"; d: PickerDone };

type Line = { text: string; tone: "warn" | "bad" | "muted"; ghl?: boolean };

const msg = (e: unknown) => String((e as Error)?.message ?? e);
const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : null);

/** The page's one picker that answers keys: the one opened (or touched) last. */
let keyOwner = 0;
let pickerSeq = 0;

/** Some of the element is in the window, away from its very edges. */
function onScreen(el: HTMLElement | null): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const h = window.innerHeight || document.documentElement.clientHeight;
  return r.top < h - 48 && r.bottom > 48;
}

function typing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    (el.tagName === "INPUT" &&
      !["button", "checkbox", "radio", "submit"].includes(
        (el as HTMLInputElement).type,
      ))
  );
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }
}

export function CallPicker({
  me,
  as,
  lead,
  mode: firstMode,
  kind: firstKind,
  appointmentId: firstAppt,
  current,
  source,
  attemptId = null,
  itemKind,
  title,
  line: firstLine,
  lineLabel = "A line on the call (goes on the lead in HighLevel)",
  missed = null,
  withDefault,
  beforeBook,
  onSlots,
  onRead,
  onClose,
  onDone,
  tell = true,
  lang,
  footer,
  frame = true,
  doneExtra,
  closeLabel = "Close",
}: {
  me: Me;
  as?: As;
  lead: LeadLike;
  mode: "reschedule" | "book";
  kind: CallKind;
  /** Reschedule: the call to move. */
  appointmentId?: string | null;
  /** Reschedule: the call as the row shows it, until the calendar is read. */
  current?: { start: string | null; host: string | null } | null;
  source: MoveSource;
  /** The dialer's open call with this lead (a dialer move saves it). */
  attemptId?: string | null;
  itemKind?: "intro" | "confirm" | "lead";
  title?: string;
  /** Booking: the line that goes with it, prefilled and never empty. */
  line?: string;
  lineLabel?: string;
  /** Booking again after a missed call: the missed call's time. */
  missed?: { start: string | null } | null;
  withDefault?: "me" | "anyone";
  /** Booking: work that goes first (the script marks today's intro held). */
  beforeBook?: (start: string) => Promise<void>;
  /** The soonest free times, for the script's "__ or __". */
  onSlots?: (isos: string[]) => void;
  /** Every read of the calendar (the script's block shows its booking page). */
  onRead?: (s: Slots) => void;
  onClose?: () => void;
  onDone?: (d: PickerDone) => void;
  /** Open Tell them in the done state. */
  tell?: boolean;
  lang?: Lang;
  footer?: ReactNode;
  /** Draw the picker's own frame (the script's block has one already). */
  frame?: boolean;
  /** More buttons in the done state (the dialer's Next lead). */
  doneExtra?: ReactNode;
  closeLabel?: string;
}) {
  const [mode, setMode] = useState(firstMode);
  const [kind, setKind] = useState<CallKind>(firstKind);
  const [appointmentId, setAppointmentId] = useState<string | null>(
    firstAppt ?? null,
  );
  const [withWho, setWithWho] = useState<"me" | "anyone">(
    withDefault ?? defaultWith(firstKind, me.role),
  );
  const [anyone, setAnyone] = useState(false);
  const [slots, setSlots] = useState<Slots | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<"soonest" | "another">("soonest");
  const [day, setDay] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "pick" });
  /** The booking or move "Reschedule" in the done state left: Keep it goes back. */
  const [kept, setKept] = useState<PickerDone | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [reason, setReason] = useState<MoveReason>("they_asked");
  const [note, setNote] = useState("");
  // The lead's own link to pick another time, offered beside the tiles
  // when HighLevel lets the lead reschedule this call (plan D17).
  const [linkOpen, setLinkOpen] = useState(false);
  const [bookLine, setBookLine] = useState(firstLine ?? "");
  useEffect(() => {
    if (firstLine !== undefined) setBookLine(l => (l.trim() ? l : firstLine));
  }, [firstLine]);
  const [now, setNow] = useState(() => Date.now());
  const myId = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  /** What a hold will send, kept so leaving the page inside it still sends. */
  const toSend = useRef<(() => Promise<void>) | null>(null);
  /** A booking that got no clear answer: its time, checked against the next read. */
  const tried = useRef<{ start: string; quiet: boolean } | null>(null);
  /** How many checks in a row found no reschedule for this press. */
  const missing = useRef(0);
  const slotsRef = useRef(onSlots);
  slotsRef.current = onSlots;
  const readRef = useRef(onRead);
  readRef.current = onRead;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    myId.current = ++pickerSeq;
    keyOwner = myId.current;
    return () => {
      alive.current = false;
      if (keyOwner === myId.current) keyOwner = 0;
    };
  }, []);

  // ------------------------------------------------------------ the read
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick reads the calendar again
  useEffect(() => {
    let live = true;
    setReadError(null);
    const body =
      mode === "reschedule"
        ? { appointment_id: appointmentId, with: anyone ? "anyone" : "same" }
        : { contact_id: lead.contact_id, kind, with: withWho };
    api<Slots>("book.slots", body)
      .then(s => {
        if (!live) return;
        setNow(Date.now());
        setSlots(s);
        slotsRef.current?.(tiles(s, lead, 4).map(t => t.iso));
        readRef.current?.(s);
        const asked = tried.current;
        tried.current = null;
        if (asked && mode === "book") {
          if (
            s.existing &&
            Date.parse(s.existing.start) === Date.parse(asked.start)
          )
            finishBook(asked.start, {
              verified: true,
              words: s.existing.words,
            });
          else if (!asked.quiet)
            setLine({
              text: "It is not on the calendar. Press the time again: a booking already on its way is refused, never made twice.",
              tone: "warn",
            });
        }
      })
      .catch(e => {
        if (!live) return;
        const code = codeOf(e);
        if (
          code &&
          ["not_yours", "client", "over", "held", "late", "calendar"].includes(
            code,
          )
        ) {
          setBlocked(true);
          setLine({ text: msg(e), tone: "warn" });
        } else setReadError(msg(e));
      });
    return () => {
      live = false;
    };
  }, [mode, appointmentId, anyone, lead.contact_id, kind, withWho, tick]);

  // ------------------------------------------------------------ sending
  function finishMove(r: {
    start: string;
    appointment: ApptOut | null;
    host_changed?: boolean;
    reschedule_id?: string | null;
  }) {
    const was = slots?.moving?.host_name ?? current?.host ?? null;
    const d: PickerDone = {
      mode: "reschedule",
      kind: callKindNow(),
      start: r.start,
      appointment: r.appointment,
      host: r.appointment?.host_name ?? was,
      wasHost: r.host_changed ? was : null,
      rescheduleId: r.reschedule_id ?? null,
      verified: true,
    };
    toast.success(toastWords("reschedule", d.kind, r.start));
    setLine(null);
    setKept(null);
    setPhase({ k: "done", d });
    doneRef.current?.(d);
  }

  /** The call's kind as the calendar read it (a Demo 2 call is a demo). */
  function callKindNow(): CallKind {
    return (
      (mode === "reschedule" ? slots?.moving?.kind : null) ??
      slots?.kind ??
      kind
    );
  }

  function finishBook(start: string, r: BookResult) {
    const d: PickerDone = {
      mode: "book",
      kind: callKindNow(),
      start,
      appointment: r.appointment ?? null,
      host:
        r.appointment?.host_name ??
        (withWho === "me" && !slots?.fallback ? (me.name ?? null) : null),
      wasHost: null,
      rescheduleId: null,
      verified: r.verified,
    };
    if (r.verified) toast.success(toastWords("book", d.kind, start));
    setLine(null);
    setKept(null);
    setPhase({ k: "done", d });
    doneRef.current?.(d);
  }

  async function check(
    start: string,
    requestId: string,
    rescheduleId: string | null,
    since: number,
  ) {
    if (!alive.current) return;
    if (Date.now() - since > CHECK_FOR_MS) {
      setPhase({ k: "pick" });
      setLine({
        text: "HighLevel did not confirm the new time. Open it in HighLevel and check before you press again.",
        tone: "warn",
        ghl: true,
      });
      return;
    }
    try {
      const r = await api<CheckResult>("book.move.check", {
        request_id: requestId,
        ...(rescheduleId ? { reschedule_id: rescheduleId } : {}),
      });
      if (!alive.current) return;
      if (r.result === "moved") {
        finishMove({
          start: r.start ?? start,
          appointment: r.appointment,
          reschedule_id: rescheduleId,
        });
        return;
      }
      if (r.result === "not_moved") {
        setPhase({ k: "pick" });
        setLine({
          text: `HighLevel did not reschedule it${r.start ? `: the call is still at ${whenWords(r.start)}` : ""}. Press the time again: a move on its way is refused, never made twice.`,
          tone: "warn",
        });
        setTick(n => n + 1);
        return;
      }
      if (r.result === "unverified") {
        setPhase({ k: "pick" });
        setLine({
          text: "HighLevel took it, but shows a different time. Open it in HighLevel and check.",
          tone: "warn",
          ghl: true,
        });
        return;
      }
      missing.current = 0;
    } catch (e) {
      // The cockpit has no reschedule for this press, twice in a row: the
      // press never reached it, so nothing moved and a new press is safe.
      if (e instanceof ApiError && e.status === 404) {
        missing.current += 1;
        if (missing.current >= 2) {
          missing.current = 0;
          setPhase({ k: "pick" });
          setLine({
            text: "The reschedule never reached the cockpit, so nothing moved. Press the time again.",
            tone: "warn",
          });
          setTick(n => n + 1);
          return;
        }
      }
      // No answer to the check either: ask again until the minute is up.
    }
    window.setTimeout(
      () => void check(start, requestId, rescheduleId, since),
      CHECK_EVERY_MS,
    );
  }

  function startCheck(
    start: string,
    requestId: string,
    rescheduleId: string | null,
  ) {
    const since = Date.now();
    setPhase({ k: "checking", start, requestId, rescheduleId, since });
    window.setTimeout(
      () => void check(start, requestId, rescheduleId, since),
      CHECK_EVERY_MS,
    );
  }

  function moveBody(h: Extract<Phase, { k: "hold" }>) {
    return {
      appointment_id: appointmentId,
      start: h.start,
      reason,
      ...(reason === "other" ? { note: note.trim() } : {}),
      ...(h.userId ? { user_id: h.userId } : {}),
      request_id: h.requestId,
      source,
      ...(attemptId ? { attempt_id: attemptId } : {}),
      ...(itemKind ? { item_kind: itemKind } : {}),
      ...(as ? { as } : {}),
    };
  }

  function bookBody(h: Extract<Phase, { k: "hold" }>) {
    return {
      contact_id: lead.contact_id,
      kind,
      with: slots?.with === "anyone" ? "anyone" : withWho,
      start: h.start,
      note: bookLine.trim(),
      request_id: h.requestId,
      source,
      ...(attemptId ? { attempt_id: attemptId } : {}),
      ...(itemKind ? { item_kind: itemKind } : {}),
      ...(as ? { as } : {}),
    };
  }

  async function sendMove(h: Extract<Phase, { k: "hold" }>) {
    setPhase({ k: "sending", start: h.start });
    try {
      const r = await api<MoveResult>("book.move", moveBody(h));
      if (!alive.current) return;
      if (r.result === "moved") finishMove(r);
      else startCheck(h.start, h.requestId, r.reschedule_id ?? null);
    } catch (e) {
      if (!alive.current) return;
      // A 503 "unread" (the calendars setting) is said before anything is
      // written, so nothing can have moved: its words, not a minute of checks.
      if (uncertain(e) && codeOf(e) !== "unread") {
        startCheck(h.start, h.requestId, null);
        return;
      }
      const a = refusalLine(codeOf(e), msg(e));
      setPhase({ k: "pick" });
      setLine({ text: a.text, tone: a.tone });
      if (a.blocked) setBlocked(true);
      if (a.reread) setTick(n => n + 1);
    }
  }

  async function sendBook(h: Extract<Phase, { k: "hold" }>) {
    setPhase({ k: "sending", start: h.start });
    try {
      if (beforeBook) await beforeBook(h.start);
      const r = await api<BookResult>("book.create", bookBody(h));
      if (!alive.current) return;
      finishBook(h.start, r);
    } catch (e) {
      if (!alive.current) return;
      setPhase({ k: "pick" });
      const first = codeOf(e);
      // HighLevel answered no (sales-api says so with a 502 and "refused"):
      // nothing was booked, whatever the status says.
      if (first === "refused") {
        setLine({ text: msg(e), tone: "bad" });
        return;
      }
      // No answer from HighLevel: the server's own words say to check
      // HighLevel before booking again; the calendar is read in case the
      // booking shows already.
      if (first === "unverified") {
        tried.current = { start: h.start, quiet: true };
        setLine({ text: msg(e), tone: "warn", ghl: true });
        setTick(n => n + 1);
        return;
      }
      if (uncertain(e)) {
        tried.current = { start: h.start, quiet: false };
        setLine({
          text: "No answer came back about the booking, so it may have gone through. Checking the calendar…",
          tone: "muted",
        });
        setTick(n => n + 1);
        return;
      }
      const code = codeOf(e);
      const a = refusalLine(code, msg(e));
      // Already booked: the next read shows that call with "Reschedule that
      // one", which says the same; the line would say it twice.
      setLine(
        code === "already_booked" ? null : { text: a.text, tone: a.tone },
      );
      if (a.blocked) setBlocked(true);
      // Taken, or already booked: the next read shows what is free, or
      // the call to reschedule instead.
      if (
        a.reread ||
        code === "already_booked" ||
        /taken|already have/i.test(msg(e))
      )
        setTick(n => n + 1);
    }
  }

  function press(t: {
    iso: string;
    hostId?: string | null;
    host?: string | null;
  }) {
    if (phase.k !== "pick" || blocked) return;
    if (mode === "reschedule" && reason === "other" && note.trim().length < 3) {
      setLine({
        text: "Write why in a few words, then pick the time.",
        tone: "warn",
      });
      document.getElementById(`why-${myId.current}`)?.focus();
      return;
    }
    if (mode === "book" && bookLine.trim().length < 3) {
      setLine({
        text: "Write a line on the call first, so whoever takes it knows what was said.",
        tone: "warn",
      });
      return;
    }
    setLine(null);
    keyOwner = myId.current;
    const h: Extract<Phase, { k: "hold" }> = {
      k: "hold",
      start: t.iso,
      userId: t.hostId ?? null,
      host: t.host ?? null,
      requestId: newId(),
    };
    setPhase(h);
    const go = mode === "reschedule" ? () => sendMove(h) : () => sendBook(h);
    toSend.current = go;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const f = toSend.current;
      toSend.current = null;
      if (f) void f();
    }, HOLD_MS);
  }

  function undo() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    toSend.current = null;
    setPhase({ k: "pick" });
  }

  // Leaving the page inside the hold still sends it: the rep meant it.
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      const f = toSend.current;
      toSend.current = null;
      if (f) void f().catch(() => undefined);
    },
    [],
  );

  // ------------------------------------------------------------ keys
  const soonest = tiles(slots, lead, 4, now);
  const keyState = useRef({ phase, soonest, press, undo, onClose, view });
  keyState.current = { phase, soonest, press, undo, onClose, view };
  useEffect(() => {
    const fine =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: fine)").matches;
    if (!fine) return;
    const onKey = (e: KeyboardEvent) => {
      if (keyOwner !== myId.current) return;
      const k = pickerKey(e, typing());
      if (!k) return;
      // Only a picker the rep can see answers (2026-10-11 review): the
      // script's Book the demo block sits below the lines being read, and a
      // stray 1 after ticking a box started a booking whose strip and Undo
      // were off the screen, so HighLevel's confirmation reached the lead.
      if (!onScreen(rootRef.current)) return;
      const s = keyState.current;
      if (k === "esc") {
        if (s.phase.k === "hold") s.undo();
        else if (s.phase.k === "pick") s.onClose?.();
        else return;
        e.preventDefault();
        return;
      }
      if (s.phase.k !== "pick") return;
      if (k === "a") {
        setView("another");
        e.preventDefault();
        return;
      }
      if (s.view !== "soonest") return;
      const t = s.soonest[Number(k) - 1];
      if (t) {
        e.preventDefault();
        s.press(t);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ------------------------------------------------------------ words
  const moving = slots?.moving ?? null;
  const callKind: CallKind =
    (mode === "reschedule" ? moving?.kind : null) ?? slots?.kind ?? kind;
  const hostName =
    mode === "reschedule"
      ? (moving?.host_name ?? slots?.host?.name ?? current?.host ?? null)
      : null;
  // The given title is for the mode the picker opened in: a call booked here
  // and then rescheduled ("Reschedule" in the done state) says so.
  const heading =
    (mode === firstMode ? title : undefined) ??
    (mode === "reschedule"
      ? `Reschedule the ${kindNoun(callKind)}`
      : missed
        ? `Book the ${kindNoun(callKind)} again`
        : `Book ${callKind === "intro" ? "an" : "a"} ${kindNoun(callKind)}`);
  const sub = [
    pickerLine({
      mode,
      start: moving?.start ?? current?.start ?? null,
      host: hostName,
      minutes: slots?.minutes ?? null,
    }),
    clockLine(lead),
  ]
    .filter(Boolean)
    .join(" ");
  const until = untilWords(slots);
  const chips = dayChips(slots, now);
  // Another day opens on the first day the soonest four leave times on.
  const inSoonest = new Set(soonest.map(t => t.iso));
  const shownDay =
    chips.find(c => c.day === day) ??
    chips.find(c => c.slots.some(x => !inSoonest.has(x))) ??
    chips[0] ??
    null;
  const team =
    mode === "reschedule" &&
    (anyone || slots?.with === "anyone" || slots?.fallback);
  const noTimes = slots && !readError && !soonest.length && !slots.existing;

  const frameCls = frame
    ? "@container rounded-[18px] border border-[color:color-mix(in_oklch,var(--primary)_35%,transparent)] bg-[color:var(--card)] p-3.5 sm:p-4"
    : "@container";

  // ------------------------------------------------------------ done
  if (phase.k === "done") {
    const d = phase.d;
    const again =
      d.mode === "reschedule" || d.appointment?.id ? (
        <button
          type="button"
          className={`${button} pointer-coarse:min-h-11 max-sm:flex-auto max-sm:px-3 whitespace-nowrap`}
          onClick={() => {
            if (d.mode === "book" && d.appointment?.id) {
              setMode("reschedule");
              setAppointmentId(d.appointment.id);
            }
            setKept(d);
            setPhase({ k: "pick" });
            setView("soonest");
            setAnyone(false);
            setTick(n => n + 1);
          }}
        >
          {d.mode === "reschedule" ? "Reschedule again" : "Reschedule"}
        </button>
      ) : null;
    const closeBtn = onClose ? (
      <button
        type="button"
        className={`${button} pointer-coarse:min-h-11 max-sm:flex-auto max-sm:px-3 whitespace-nowrap`}
        onClick={onClose}
      >
        Done
      </button>
    ) : null;
    const extras = (
      <>
        {again}
        {closeBtn}
        {doneExtra}
      </>
    );
    return (
      <div ref={rootRef} className={`${frameCls} space-y-3`}>
        <div className="flex items-start gap-3">
          {d.verified ? (
            <CircleCheck
              className="mt-0.5 size-5 shrink-0"
              style={{ color: "var(--success)" }}
              aria-hidden
            />
          ) : (
            <TriangleAlert
              className="mt-0.5 size-5 shrink-0"
              style={{ color: "var(--warning)" }}
              aria-hidden
            />
          )}
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug">
              {d.verified
                ? doneTitle(d.mode, d.kind, d.start)
                : `Sent to HighLevel for ${whenWords(d.start)}`}
            </p>
            <p className="muted mt-1 text-[13px] leading-relaxed">
              {doneSub({
                mode: d.mode,
                iso: d.start,
                lead,
                host: d.host,
                wasHost: d.wasHost,
                missed: Boolean(missed),
              })}
            </p>
          </div>
        </div>
        {!d.verified ? (
          <p
            role="status"
            className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm"
          >
            HighLevel took the booking, but reading it back did not match.{" "}
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
        ) : null}
        <div className="sm:ps-8">
          {tell ? (
            <TellThem
              me={me}
              lead={lead}
              call={{
                appointment_id: d.appointment?.id ?? appointmentId,
                kind: d.kind,
                start: d.start,
                host_name: d.host,
                host_user_id: d.appointment?.host_user_id ?? null,
                meet_url: d.appointment?.meet_url ?? null,
              }}
              moment={
                d.mode === "reschedule"
                  ? "rescheduled"
                  : missed
                    ? "missed_booked"
                    : "booked"
              }
              lang={lang}
              rescheduleId={d.rescheduleId}
              extra={extras}
            />
          ) : (
            <div className="flex flex-wrap gap-2">{extras}</div>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ hold
  const holding =
    phase.k === "hold" || phase.k === "sending" || phase.k === "checking";
  const holdIso = holding ? phase.start : null;
  const holdTheirs = holdIso ? theirTime(holdIso, lead) : null;

  const tileBtn = (t: Tile, i: number | null, small = false) => (
    <button
      key={t.iso}
      type="button"
      onClick={() => press({ iso: t.iso, hostId: t.hostId, host: t.host })}
      disabled={blocked}
      aria-label={`${mode === "reschedule" ? "Reschedule to" : "Book"} ${t.day} ${t.digits} ${t.ap}${t.theirs ? `, ${t.theirs}` : ""}${t.host ? `, with ${t.host}` : ""}${i !== null ? ` (key ${i + 1})` : ""}`}
      className={`flex flex-col items-start justify-center rounded-[14px] border border-[color:var(--border)] bg-[color:color-mix(in_oklch,var(--foreground)_3%,transparent)] text-left transition-colors hover:border-[color:color-mix(in_oklch,var(--primary)_60%,transparent)] hover:bg-[color:color-mix(in_oklch,var(--primary)_8%,transparent)] disabled:opacity-50 ${
        small ? "min-h-[3.6rem] px-2.5 py-1.5" : "min-h-[4.6rem] px-3 py-2"
      }`}
    >
      {!small ? (
        <span className="muted text-[11px] font-medium">{t.day}</span>
      ) : null}
      <span
        className={`font-mono font-semibold tabular-nums ${small ? "text-[15px] leading-5" : "text-[17px] leading-6"}`}
      >
        {t.digits}
        <span className="ms-1 font-sans text-[11px] font-medium">{t.ap}</span>
      </span>
      {t.theirs ? <span className="muted text-[11px]">{t.theirs}</span> : null}
      {t.host ? <span className="text-[11px]">with {t.host}</span> : null}
    </button>
  );

  const why =
    mode === "reschedule" ? (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="muted max-sm:basis-full">Why</span>
        {reasonChips(hostName).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={reason === k}
            onClick={() => setReason(k)}
            className={`h-8 rounded-full border px-3 font-medium pointer-coarse:min-h-10 ${
              reason === k
                ? "border-[color:color-mix(in_oklch,var(--primary)_40%,transparent)] bg-[color:color-mix(in_oklch,var(--primary)_15%,transparent)]"
                : "hairline hover:bg-[color:var(--secondary)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    ) : null;

  // Only what the keys do here: 1 to 4 press the soonest times (not the
  // day's list), and Esc closes only a picker that can be closed.
  const keysWords = [
    view === "soonest" ? "Keys 1 to 4 pick a time." : null,
    onClose ? "Esc closes." : null,
  ]
    .filter(Boolean)
    .join(" ");
  const keysLine = keysWords ? (
    <span className="muted text-xs max-sm:hidden pointer-coarse:hidden">
      {keysWords}
    </span>
  ) : null;

  let body: ReactNode;
  if (holding) {
    const words =
      phase.k === "checking"
        ? "No answer from HighLevel yet. Checking the calendar…"
        : phase.k === "sending"
          ? `Sending to HighLevel: ${whenWords(phase.start)}`
          : holdWords(mode, callKind, phase.start);
    body = (
      <div
        role="status"
        className="relative flex min-h-[52px] max-w-[56.5rem] items-center gap-3 overflow-hidden rounded-[18px] border border-teal-500/30 bg-teal-500/10 py-2 ps-[18px] pe-2 sm:rounded-full"
      >
        {phase.k === "hold" ? (
          <span
            aria-hidden
            className="drain absolute inset-x-0 bottom-0 h-[3px]"
            style={
              {
                background: "var(--now)",
                "--undo-ms": `${HOLD_MS}ms`,
              } as CSSProperties
            }
          />
        ) : null}
        <span className="min-w-0 flex-1 text-sm font-semibold">
          {words}
          {phase.k === "hold" && holdTheirs ? (
            <span className="muted font-normal"> · {holdTheirs}</span>
          ) : null}
          {phase.k === "hold" && phase.host ? (
            <span className="muted font-normal"> · with {phase.host}</span>
          ) : null}
        </span>
        {phase.k === "hold" ? (
          <button
            type="button"
            onClick={undo}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold txt-now hover:bg-teal-500/15 pointer-coarse:min-h-11"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Undo
          </button>
        ) : null}
      </div>
    );
  } else if (readError) {
    body = (
      <p className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm">
        The calendar could not be read: {readError}{" "}
        <button
          type="button"
          onClick={() => setTick(n => n + 1)}
          className="underline underline-offset-2"
        >
          Read it again
        </button>
      </p>
    );
  } else if (blocked) {
    body = null;
  } else if (!slots) {
    body = (
      <p className="muted text-sm">
        Reading the {kindNoun(callKind)} calendar's free times…
      </p>
    );
  } else if (mode === "book" && slots.existing) {
    const ex = slots.existing;
    body = (
      <div className="callout-warn flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm">
        {/* The sentence keeps a readable width; on a phone the button goes under it. */}
        <span className="min-w-0 flex-[1_1_14rem]">
          They already have{" "}
          {kindNoun(ex.kind ?? callKind) === "intro" ? "an" : "a"}{" "}
          {kindNoun(ex.kind ?? callKind)} on {ex.words} (Kuwait time).
        </span>
        <button
          type="button"
          className={`${button} h-8 pointer-coarse:min-h-11`}
          onClick={() => {
            setMode("reschedule");
            setKind(ex.kind ?? callKind);
            setAppointmentId(ex.id);
            setLine(null);
            setView("soonest");
            setTick(n => n + 1);
          }}
        >
          <CalendarClock className="size-3.5" aria-hidden />
          Reschedule that one
        </button>
      </div>
    );
  } else if (noTimes) {
    body = (
      <div className="callout-warn flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm">
        <span className="min-w-0 flex-1">
          {noTimesLine({
            mode,
            host:
              mode === "reschedule"
                ? hostName
                : withWho === "me"
                  ? me.name
                  : null,
            until,
            withWho:
              mode === "reschedule" ? (team ? "anyone" : "same") : withWho,
            onTeam: slots.on_team,
          })}
        </span>
        {mode === "reschedule" && !team ? (
          <button
            type="button"
            className={`${button} h-8`}
            onClick={() => {
              setAnyone(true);
              setLine(null);
            }}
          >
            Show anyone free
          </button>
        ) : mode === "book" && withWho === "me" && slots.on_team ? (
          <button
            type="button"
            className={`${button} h-8`}
            onClick={() => setWithWho("anyone")}
          >
            Anyone free
          </button>
        ) : null}
        <a
          href={ghlContactUrl(lead.contact_id)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          Open in HighLevel
        </a>
      </div>
    );
  } else if (view === "another") {
    body = (
      <div className="space-y-2.5">
        <div
          className="grid grid-cols-2 gap-1.5 @2xl:flex @2xl:flex-wrap"
          role="group"
          aria-label="Day"
        >
          {chips.map(c => (
            <button
              key={c.day}
              type="button"
              aria-pressed={shownDay?.day === c.day}
              onClick={() => setDay(c.day)}
              className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-medium @2xl:h-8 ${
                shownDay?.day === c.day
                  ? "border-[color:color-mix(in_oklch,var(--primary)_45%,transparent)] bg-[color:color-mix(in_oklch,var(--primary)_15%,transparent)]"
                  : "hairline hover:bg-[color:var(--secondary)]"
              }`}
            >
              {c.label}
              <span className="tabular-nums opacity-70">{c.count}</span>
            </button>
          ))}
        </div>
        <div
          className="grid grid-cols-3 gap-2 @2xl:grid-cols-[repeat(7,minmax(0,8.5rem))]"
          role="group"
          aria-label={`Times on ${shownDay?.label ?? "the day"}`}
        >
          {(shownDay?.slots ?? []).map(iso =>
            tileBtn(tileOf(iso, lead, now, slots.slot_hosts), null, true),
          )}
        </div>
        <button
          type="button"
          onClick={() => setView("soonest")}
          className="muted inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:text-[color:var(--foreground)]"
        >
          <ArrowLeft className="size-3" aria-hidden /> Back to the soonest
        </button>
      </div>
    );
  } else {
    body = (
      <div
        className="grid grid-cols-2 gap-2 @2xl:grid-cols-[repeat(5,minmax(0,11rem))]"
        role="group"
        aria-label="The soonest free times"
      >
        {soonest.map((t, i) => tileBtn(t, i))}
        {chips.length ? (
          <button
            type="button"
            onClick={() => setView("another")}
            aria-label={`Another day${until ? `, ${until}` : ""} (key A)`}
            className="col-span-2 flex min-h-12 items-center justify-between gap-2 rounded-[14px] border border-[color:var(--border)] px-3 py-2 text-left transition-colors hover:border-[color:color-mix(in_oklch,var(--primary)_60%,transparent)] hover:bg-[color:color-mix(in_oklch,var(--primary)_8%,transparent)] @2xl:col-span-1 @2xl:min-h-[4.6rem] @2xl:flex-col @2xl:items-start @2xl:justify-center @2xl:gap-0"
          >
            <span className="text-sm font-semibold">Another day</span>
            {until ? <span className="muted text-[11px]">{until}</span> : null}
          </button>
        ) : null}
      </div>
    );
  }

  const showFoot =
    !holding &&
    !readError &&
    slots &&
    !blocked &&
    !noTimes &&
    !(mode === "book" && slots.existing);

  return (
    <div
      ref={rootRef}
      className={`${frameCls} space-y-3`}
      onPointerDown={() => {
        keyOwner = myId.current;
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          {mode === "reschedule" ? (
            <CalendarClock
              className="size-4 shrink-0"
              style={{ color: "var(--primary)" }}
              aria-hidden
            />
          ) : (
            <CalendarPlus
              className="size-4 shrink-0"
              style={{ color: "var(--primary)" }}
              aria-hidden
            />
          )}
          {heading}
        </p>
        {onClose && !holding ? (
          <button
            type="button"
            onClick={onClose}
            className="muted shrink-0 text-xs underline underline-offset-2 hover:text-[color:var(--foreground)] pointer-coarse:min-h-10"
          >
            {closeLabel}
          </button>
        ) : kept && !holding ? (
          // No Close here (a script's block): the way back to the call as
          // it was booked, with its Tell them.
          <button
            type="button"
            onClick={() => {
              setLine(null);
              setPhase({ k: "done", d: kept });
              setKept(null);
            }}
            className="muted shrink-0 text-xs underline underline-offset-2 hover:text-[color:var(--foreground)] pointer-coarse:min-h-10"
          >
            Keep {whenWords(kept.start)}
          </button>
        ) : null}
      </div>
      <p className="muted text-[13px] leading-relaxed">{sub}</p>
      {mode === "book" && slots?.on_team && !slots.fallback && !holding ? (
        <Segmented
          label="With whom"
          value={withWho}
          options={[
            ["me", `With ${firstOf(me.name) || "me"}`],
            ["anyone", "Anyone free"],
          ]}
          onChange={v => {
            setWithWho(v as "me" | "anyone");
            setDay(null);
          }}
        />
      ) : null}
      {mode === "book" && slots?.fallback && !holding ? (
        <p className="muted text-xs">
          You have no free time of your own on this calendar, so these are the
          team's; HighLevel's round robin picks who takes the call.
        </p>
      ) : null}
      {team && slots && soonest.length && !holding ? (
        <p className="muted text-xs">
          {firstOf(hostName) || "The host"} has no free time
          {until ? ` ${until}` : ""}, so these are the team's times; each names
          who takes it.
        </p>
      ) : null}
      {body}
      {line ? (
        <p
          role="status"
          className={`${line.tone === "bad" ? "callout-bad" : line.tone === "warn" ? "callout-warn" : "muted hairline"} rounded-[var(--radius-md)] border px-3 py-2 text-sm`}
        >
          {line.text}
          {line.ghl ? (
            <>
              {" "}
              <a
                href={ghlContactUrl(lead.contact_id)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Open in HighLevel
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {showFoot ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {why}
          {mode === "book" ? null : keysLine}
        </div>
      ) : null}
      {showFoot && mode === "reschedule" && reason === "other" ? (
        <label className="block max-w-[38rem] space-y-1">
          <span className="muted block text-xs">Why, in a few words</span>
          <input
            id={`why-${myId.current}`}
            value={note}
            onChange={e => setNote(e.target.value)}
            dir="auto"
            className={field}
            placeholder="They are travelling that day"
          />
        </label>
      ) : null}
      {showFoot && mode === "book" ? (
        <div className="space-y-1.5">
          <label className="block max-w-[38rem] space-y-1">
            <span className="muted block text-xs">{lineLabel}</span>
            <input
              value={bookLine}
              onChange={e => setBookLine(e.target.value)}
              dir="auto"
              className={field}
            />
          </label>
          {keysLine}
        </div>
      ) : null}
      {showFoot && mode === "reschedule" && slots?.reschedule_link ? (
        linkOpen ? (
          <div className="border-t hairline pt-3">
            <TellThem
              me={me}
              lead={lead}
              call={{
                appointment_id: appointmentId,
                kind: callKind,
                start: moving?.start ?? current?.start ?? null,
                host_name: hostName,
              }}
              moment="pick_time"
              lang={lang}
              link={slots.reschedule_link}
              extra={
                <button
                  type="button"
                  className={`${button} pointer-coarse:min-h-11 whitespace-nowrap`}
                  onClick={() => setLinkOpen(false)}
                >
                  Back to the times
                </button>
              }
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLinkOpen(true)}
            className="muted text-xs underline underline-offset-2 hover:text-[color:var(--foreground)]"
          >
            Or send them the link to pick a time themselves
          </button>
        )
      ) : null}
      {footer}
    </div>
  );
}

/** The booked call, as a time words a parent needs (the dialer's saved line). */
export function pickedWords(d: PickerDone): string {
  return `${doneTitle(d.mode, d.kind, d.start)} (Kuwait time)`;
}

/** The host's first name for a row's Why chip, from a calendar row. */
export function hostOf(name: string | null | undefined): string | null {
  return firstOf(name) || null;
}
