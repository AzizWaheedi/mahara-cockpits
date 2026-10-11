import {
  ArrowLeft,
  CalendarClock,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  RotateCcw,
  TriangleAlert,
  X,
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
  addDays,
  type BookResult,
  type CallKind,
  CHECK_EVERY_MS,
  CHECK_FOR_MS,
  type CheckResult,
  checkView,
  clockLine,
  customIso,
  customPrecheck,
  customTile,
  dayBook,
  dayChips,
  defaultWith,
  doneLink,
  doneSub,
  doneTitle,
  farLine,
  firstOf,
  HOLD_MS,
  holdWords,
  isFarDay,
  kindNoun,
  kwDay,
  type LeadLike,
  linkLine,
  type MoveReason,
  type MoveResult,
  type MoveSource,
  noTimesLine,
  type Placement,
  pickerKey,
  pickerLine,
  pressExtras,
  reasonChips,
  refusalLine,
  type Slots,
  spanUntil,
  type Tile,
  type TimeCheck,
  theirTime,
  tileOf,
  tiles,
  toastWords,
  untilWords,
  type WeekCell,
  weekOf,
  weekRange,
  weekSpan,
  weekStartOf,
  weekTitle,
  weekToRead,
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
 *
 * Booking further out (2026-10-11): Another day shows a week at a time up
 * to the reach (60 days), past the calendar's own booking page, which
 * stays as it is for the lead. A dashed teal hairline in the week strip is
 * where the booking page ends; days past it press exactly like the others.
 * Custom time takes a day and a time the rep types, checks it against the
 * host's calendar and hours (book.check), and offers Book anyway outside
 * working hours. The lead's own link to pick a time shows where HighLevel
 * lets them reschedule (intros and Follow up call).
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
  /** Where the time sat: the booking page, past it, or typed (sales-api's answer). */
  placement?: Placement | null;
  /** A custom time booked outside the host's working hours. */
  outside?: boolean;
  /**
   * The lead's own link to pick another time, as sales-api answered the
   * booking or the move (undefined: an older server said nothing).
   */
  link?: string | null;
}

/** What a press sends besides the time: who takes it, and whether it was typed. */
interface Press {
  iso: string;
  hostId?: string | null;
  host?: string | null;
  far?: boolean;
  custom?: boolean;
  /** Book anyway, outside the host's working hours. */
  outsideOk?: boolean;
}

type Phase =
  | { k: "pick" }
  | {
      k: "hold";
      start: string;
      userId: string | null;
      host: string | null;
      requestId: string;
      far: boolean;
      custom: boolean;
      outsideOk: boolean;
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
  // Another day, a week at a time: the week shown (its Sunday) and the
  // later pages of free times read for it (book.slots with `from`).
  const [week, setWeek] = useState<string | null>(null);
  const [pages, setPages] = useState<Slots[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageTick, setPageTick] = useState(0);
  // Custom time: a day and a time the rep types, checked by book.check.
  const [customOpen, setCustomOpen] = useState(false);
  const [cDate, setCDate] = useState("");
  const [cTime, setCTime] = useState("");
  const [cHostId, setCHostId] = useState("");
  const [cTick, setCTick] = useState(0);
  const [cCheck, setCCheck] = useState<{
    key: string;
    r: TimeCheck | null;
    error: string | null;
  }>({ key: "", r: null, error: null });
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
  /** The last time pressed: its flags reach the done state, however the answer came. */
  const pressed = useRef<Extract<Phase, { k: "hold" }> | null>(null);
  /** Which calendar read the later pages belong to (a page for an old read is dropped). */
  const readKey = `${mode}|${appointmentId}|${anyone}|${lead.contact_id}|${kind}|${withWho}`;
  const readKeyRef = useRef(readKey);
  readKeyRef.current = readKey;
  /** Who the calendar is read for: the call to move, or the lead and the kind of call. */
  const who = (): Record<string, unknown> =>
    mode === "reschedule"
      ? { appointment_id: appointmentId, with: anyone ? "anyone" : "same" }
      : { contact_id: lead.contact_id, kind, with: withWho };

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
    api<Slots>("book.slots", who())
      .then(s => {
        if (!live) return;
        setNow(Date.now());
        setSlots(s);
        // A fresh read starts the later pages again: they were the old read's.
        setPages([]);
        setPageError(null);
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
  /** What the done state says about how the time was placed. */
  function placed(placement: Placement | null | undefined) {
    const p = pressed.current;
    return {
      placement:
        placement ?? (p?.custom ? "custom" : p?.far ? "far_out" : null),
      outside: Boolean(p?.custom && p.outsideOk),
    };
  }

  function finishMove(r: {
    start: string;
    appointment: ApptOut | null;
    host_changed?: boolean;
    reschedule_id?: string | null;
    placement?: Placement;
    reschedule_link?: string | null;
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
      ...placed(r.placement),
      link: r.reschedule_link,
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
        (pressed.current?.host || null) ??
        (withWho === "me" && !slots?.fallback ? (me.name ?? null) : null),
      wasHost: null,
      rescheduleId: null,
      verified: r.verified,
      ...placed(r.placement),
      link: r.reschedule_link,
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
          reschedule_link: r.reschedule_link,
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
      ...pressExtras(h),
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
      // A far-out tile names who takes it, and a custom time always does.
      ...pressExtras(h),
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
      // A typed time is checked again: Book anyway, or whose call is there now.
      if (h.custom && (a.reread || a.anyway)) setCTick(n => n + 1);
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
      if (h.custom && (a.reread || a.anyway)) setCTick(n => n + 1);
    }
  }

  function press(t: Press) {
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
      far: Boolean(t.far),
      custom: Boolean(t.custom),
      outsideOk: Boolean(t.custom && t.outsideOk),
    };
    pressed.current = h;
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
  // What the booking page alone offers: "no free time" and the team's
  // fallback are about those days (the far-out part is read separately).
  const windowWords = untilWords(
    slots
      ? { days: slots.days, until: slots.window_until ?? slots.until }
      : null,
  );
  const book = dayBook(slots, pages);
  const chips = dayChips(book, now);
  // Another day opens on the first day the soonest four leave times on.
  const inSoonest = new Set(soonest.map(t => t.iso));
  const firstDay =
    chips.find(c => c.slots.some(x => !inSoonest.has(x)))?.day ??
    chips[0]?.day ??
    null;
  const today = kwDay(now);
  const span = weekSpan(book, now);
  const weekShown = (() => {
    const w = week ?? weekStartOf(day ?? firstDay ?? today);
    return w < span.first ? span.first : w > span.last ? span.last : w;
  })();
  const cells: WeekCell[] = weekOf(book, weekShown, now);
  const shownCell =
    cells.find(c => c.day === day && c.count) ??
    (week === null && !day
      ? cells.find(c => c.day === firstDay && c.count)
      : undefined) ??
    cells.find(c => c.count) ??
    null;
  const toRead =
    view === "another" && slots && !pageError
      ? weekToRead(book, weekShown, now)
      : null;
  const farState = slots?.far?.state ?? null;
  const team =
    mode === "reschedule" &&
    (anyone || slots?.with === "anyone" || slots?.fallback);
  const noTimes = slots && !readError && !soonest.length && !slots.existing;
  const custom = slots?.custom ?? null;
  const customHost =
    custom?.host ?? custom?.hosts.find(h => h.user_id === cHostId) ?? null;
  const customStart = customIso(cDate, cTime);
  const customPre = customOpen
    ? custom && !customHost
      ? { line: "Pick who takes the call.", tone: "muted" as const }
      : customPrecheck(cDate, cTime, {
          now,
          reachUntil: slots?.reach_until ?? slots?.until ?? null,
          stepMin: custom?.step_min ?? 5,
        })
    : null;
  const customKey = `${readKey}|${customStart}|${customHost?.user_id ?? ""}|${cTick}`;

  // A week Another day has not read yet: ask for it (book.slots with `from`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: who() and readKey are the read's identity
  useEffect(() => {
    if (!toRead) return;
    let live = true;
    const key = readKey;
    api<Slots>("book.slots", { ...who(), from: toRead })
      .then(s => {
        if (!live || readKeyRef.current !== key) return;
        // An answer that pages nowhere (an older server), or not for the
        // week asked: said, never shown as a week with no free time.
        if (!s.page || toRead < s.page.from || toRead > s.page.to) {
          setPageError("The calendar did not answer for that week.");
          return;
        }
        setPages(p => [...p, s]);
      })
      .catch(e => {
        if (live && readKeyRef.current === key) setPageError(msg(e));
      });
    return () => {
      live = false;
    };
  }, [toRead, pageTick]);

  // The custom time, checked against the host's calendar a moment after
  // the last change (book.check is read-only).
  // biome-ignore lint/correctness/useExhaustiveDependencies: customKey holds the time, the host, the read and the re-check
  useEffect(() => {
    if (!customOpen || !custom || customPre || !customStart) return;
    let live = true;
    const key = customKey;
    const t = window.setTimeout(() => {
      api<TimeCheck>("book.check", {
        ...who(),
        start: customStart,
        ...(custom.host ? {} : { user_id: customHost?.user_id }),
      })
        .then(r => {
          if (live) setCCheck({ key, r, error: null });
        })
        .catch(e => {
          if (live) setCCheck({ key, r: null, error: msg(e) });
        });
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [customOpen, customKey, customPre?.line]);

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
            setWeek(null);
            setDay(null);
            setCustomOpen(false);
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
                outside: d.outside,
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
              // The lead's own link to pick another time, where HighLevel
              // allows it: as sales-api answered the booking or the move, else
              // the calendar read's (a move keeps the call's id).
              link={doneLink(d.mode, d.link, slots?.reschedule_link)}
              linkNote={linkLine(slots?.window_until ?? slots?.until)}
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

  const tileBtn = (
    t: Tile,
    i: number | null,
    small = false,
    typed: { anyway: boolean } | null = null,
  ) => (
    <button
      key={t.iso}
      type="button"
      onClick={() =>
        press({
          iso: t.iso,
          hostId: t.hostId,
          host: t.host,
          far: t.far,
          custom: Boolean(typed),
          outsideOk: Boolean(typed?.anyway),
        })
      }
      disabled={blocked}
      aria-label={`${typed?.anyway ? "Book anyway, outside working hours: " : ""}${mode === "reschedule" ? "Reschedule to" : "Book"} ${t.day} ${t.digits} ${t.ap}${t.theirs ? `, ${t.theirs}` : ""}${t.host ? `, with ${t.host}` : ""}${t.far ? ", past the booking page" : ""}${i !== null ? ` (key ${i + 1})` : ""}`}
      className={`flex flex-col items-start justify-center rounded-[14px] border bg-[color:color-mix(in_oklch,var(--foreground)_3%,transparent)] text-left transition-colors hover:border-[color:color-mix(in_oklch,var(--primary)_60%,transparent)] hover:bg-[color:color-mix(in_oklch,var(--primary)_8%,transparent)] disabled:opacity-50 ${
        typed?.anyway
          ? "border-[color:color-mix(in_oklch,var(--warning)_45%,transparent)]"
          : "border-[color:var(--border)]"
      } ${small ? "px-2.5 py-1.5" : "px-3 py-2"}`}
      // Inline, so the phone's 40 px floor for buttons (index.css, outside
      // the layers) cannot shrink a tile below its own height.
      style={{ minHeight: small ? "3.6rem" : "4.6rem" }}
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
      {typed?.anyway ? (
        <span className="txt-warn text-[11px] font-semibold">Book anyway</span>
      ) : null}
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
          : holdWords(mode, callKind, phase.start, Date.now(), {
              far: phase.far,
              outside: phase.outsideOk,
              host: phase.host ?? hostName ?? me.name,
            });
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
            setWeek(null);
            setDay(null);
            setCustomOpen(false);
            setTick(n => n + 1);
          }}
        >
          <CalendarClock className="size-3.5" aria-hidden />
          Reschedule that one
        </button>
      </div>
    );
  } else if (noTimes && view === "soonest") {
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
            until: spanUntil(slots),
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
        {farState === "ok" && slots.page?.next ? (
          <button
            type="button"
            className={`${button} h-8`}
            onClick={() => {
              const next = slots.page?.next ?? today;
              setWeek(weekStartOf(next));
              setDay(next);
              setView("another");
            }}
          >
            Later weeks
          </button>
        ) : null}
        {custom && !customOpen ? (
          <button
            type="button"
            className={`${button} h-8`}
            onClick={() => setCustomOpen(true)}
          >
            Custom time
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
    const edgeIdx = cells.findIndex(c => c.edgeBefore);
    const weekFar = cells.some(c => c.far && c.count !== null);
    const whose =
      mode === "reschedule"
        ? team
          ? null
          : firstOf(hostName) || null
        : // Mine only when sales-api read my own times ("me"): a rep not on
          // the calendar's team, or with no time of their own, gets the
          // team's, each tile naming who takes it.
          slots.with === "me" && !slots.fallback
          ? "you"
          : null;
    const go = (n: number) => {
      setWeek(addDays(weekShown, n));
      setDay(null);
      setPageError(null);
    };
    const navBtn =
      "inline-flex size-9 shrink-0 items-center justify-center rounded-full border hairline transition-colors hover:bg-[color:var(--secondary)] disabled:opacity-30 disabled:hover:bg-transparent pointer-coarse:size-11";
    const reading = cells.some(c => c.reading);
    body = (
      <div className="space-y-2.5">
        <div className="space-y-1 @2xl:max-w-[44rem]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="The week before"
              disabled={weekShown <= span.first}
              onClick={() => go(-7)}
              className={navBtn}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <p
              className="min-w-0 flex-1 text-center text-sm font-semibold"
              aria-live="polite"
            >
              {weekTitle(weekShown, now)}
              <span className="muted ms-2 font-mono text-xs font-medium">
                {weekRange(weekShown)}
              </span>
            </p>
            <button
              type="button"
              aria-label="The week after"
              disabled={weekShown >= span.last}
              onClick={() => go(7)}
              className={navBtn}
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
          <div
            className="grid grid-cols-7 gap-1 @max-md:-mx-2 @max-md:gap-px"
            role="group"
            aria-label="Day"
          >
            {cells.map(c => {
              const on = shownCell?.day === c.day;
              const state = c.reading
                ? "reading the calendar"
                : c.count === null
                  ? "not offered"
                  : c.count
                    ? `${c.count} free time${c.count === 1 ? "" : "s"}`
                    : "no free time";
              return (
                <button
                  key={c.day}
                  type="button"
                  disabled={c.disabled}
                  aria-pressed={on}
                  aria-label={`${c.label}: ${state}${c.far && c.count !== null ? ", past the booking page" : ""}`}
                  onClick={() => {
                    setDay(c.day);
                    setWeek(weekShown);
                  }}
                  className={`relative flex min-h-[3.75rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-[12px] border py-1.5 transition-colors disabled:cursor-default ${
                    on
                      ? "border-[color:color-mix(in_oklch,var(--primary)_45%,transparent)] bg-[color:color-mix(in_oklch,var(--primary)_15%,transparent)]"
                      : "border-transparent enabled:hover:bg-[color:var(--secondary)]"
                  }`}
                >
                  {c.edgeBefore ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -start-[3px] -top-1 -bottom-1 border-s border-dashed border-[color:var(--now)]"
                    />
                  ) : null}
                  <span
                    className={`text-[11px] font-medium leading-4 ${c.today ? "txt-now" : "muted"}`}
                  >
                    {c.wd}
                  </span>
                  <span
                    className={`font-mono text-[15px] font-semibold leading-5 tabular-nums ${c.count ? "" : "opacity-40"}`}
                  >
                    {c.num}
                  </span>
                  <span className="muted font-mono text-[11px] leading-4 tabular-nums">
                    {/* A day not offered keeps the line, so the week's numbers stay level. */}
                    {c.reading
                      ? "…"
                      : c.count === null
                        ? "\u00a0"
                        : c.count || "–"}
                  </span>
                </button>
              );
            })}
          </div>
          {edgeIdx >= 0 ? (
            <div
              className="grid grid-cols-7 gap-1 @max-md:-mx-2 @max-md:gap-px"
              aria-hidden
            >
              <span
                className="relative h-4"
                style={{ gridColumnStart: edgeIdx + 1 }}
              >
                <span
                  className={`muted absolute top-0 whitespace-nowrap border-dashed border-[color:var(--now)] text-[11px] leading-4 ${
                    edgeIdx <= 3
                      ? "-start-[3px] border-s ps-1.5"
                      : "end-[calc(100%+2px)] border-e pe-1.5"
                  }`}
                >
                  booking page ends
                </span>
              </span>
            </div>
          ) : null}
        </div>
        {pageError ? (
          <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
            This week could not be read: {pageError}{" "}
            <button
              type="button"
              onClick={() => {
                setPageError(null);
                setPageTick(n => n + 1);
              }}
              className="underline underline-offset-2"
            >
              Read it again
            </button>
          </p>
        ) : shownCell ? (
          <div
            className="grid grid-cols-3 gap-2 @2xl:grid-cols-[repeat(7,minmax(0,8.5rem))]"
            role="group"
            aria-label={`Times on ${shownCell.label}`}
          >
            {shownCell.slots.map(iso =>
              tileBtn(
                tileOf(iso, lead, now, book.slot_hosts, shownCell.far),
                null,
                true,
              ),
            )}
          </div>
        ) : reading ? (
          <p className="muted text-sm">Reading the calendar…</p>
        ) : (
          <p className="muted text-sm">
            No free time this week.{" "}
            {weekShown < span.last
              ? "Try the week after"
              : "Try an earlier week"}
            {custom ? ", or a custom time." : "."}
          </p>
        )}
        {weekFar && farState === "ok" ? (
          <p className="muted text-xs leading-relaxed">
            {farLine({ windowUntil: slots.window_until, who: whose })}
          </p>
        ) : null}
        {farState && farState !== "ok" && slots.far?.note ? (
          <p className="muted hairline rounded-[var(--radius-md)] border px-3 py-2 text-xs leading-relaxed">
            {slots.far.note}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={() => setView("soonest")}
            className="muted inline-flex items-center gap-1 text-xs underline underline-offset-2 hover:text-[color:var(--foreground)] pointer-coarse:h-11"
          >
            <ArrowLeft className="size-3" aria-hidden /> Back to the soonest
          </button>
          {custom && !customOpen ? (
            <button
              type="button"
              onClick={() => {
                setCustomOpen(true);
                if (!cDate && shownCell) setCDate(shownCell.day);
              }}
              className="muted inline-flex items-center text-xs underline underline-offset-2 hover:text-[color:var(--foreground)] pointer-coarse:h-11"
            >
              Custom time
            </button>
          ) : null}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-2">
        <div
          className="grid grid-cols-2 gap-2 @2xl:grid-cols-[repeat(5,minmax(0,11rem))]"
          role="group"
          aria-label="The soonest free times"
        >
          {soonest.map((t, i) => tileBtn(t, i))}
          {chips.length || slots.page?.next ? (
            <button
              type="button"
              onClick={() => setView("another")}
              aria-label={`Another day${until ? `, ${until}` : ""} (key A)`}
              className="col-span-2 flex min-h-12 items-center justify-between gap-2 rounded-[14px] border border-[color:var(--border)] px-3 py-2 text-left transition-colors hover:border-[color:color-mix(in_oklch,var(--primary)_60%,transparent)] hover:bg-[color:color-mix(in_oklch,var(--primary)_8%,transparent)] @2xl:col-span-1 @2xl:min-h-[4.6rem] @2xl:flex-col @2xl:items-start @2xl:justify-center @2xl:gap-0"
            >
              <span className="text-sm font-semibold">Another day</span>
              {until ? (
                <span className="muted text-[11px]">{until}</span>
              ) : null}
            </button>
          ) : null}
        </div>
        {custom && !customOpen ? (
          <button
            type="button"
            onClick={() => setCustomOpen(true)}
            className="muted inline-flex items-center text-xs underline underline-offset-2 hover:text-[color:var(--foreground)] pointer-coarse:h-11"
          >
            Custom time
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
    !(mode === "book" && slots.existing) &&
    (!noTimes || customOpen || view === "another");

  // ------------------------------------------------------------ custom time
  let customRow: ReactNode = null;
  if (showFoot && custom && customOpen) {
    const answer = cCheck.key === customKey ? cCheck : null;
    const cv = answer ? checkView(answer.r) : null;
    const hostFirst = firstOf(customHost?.name) || "the host";
    const said: { line: string; tone: "muted" | "warn" } | null = customPre
      ? customPre
      : !answer
        ? { line: `Checking ${hostFirst}'s calendar…`, tone: "muted" }
        : answer.error
          ? {
              line: `The time could not be checked: ${answer.error}`,
              tone: "warn",
            }
          : cv;
    const typed =
      cv?.tile && customStart && !customPre
        ? (() => {
            const named = answer?.r?.host ?? customHost;
            const t = customTile(
              customStart,
              lead,
              named,
              now,
              isFarDay(cDate, slots),
            );
            // The call's own host (or me) needs no name on the tile; a
            // person picked from the list does.
            return custom.host ? { ...t, host: null } : t;
          })()
        : null;
    const reach = slots?.reach_until ?? slots?.until ?? undefined;
    customRow = (
      <div
        className="space-y-2.5 rounded-[14px] border hairline p-3"
        role="group"
        aria-label="Custom time"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            Custom time
            <span className="muted ms-2 text-xs font-normal">Kuwait time</span>
          </p>
          <button
            type="button"
            aria-label="Close custom time"
            onClick={() => setCustomOpen(false)}
            className="muted inline-flex size-8 items-center justify-center rounded-full hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)] pointer-coarse:size-11"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 @md:grid-cols-2 @lg:flex @lg:flex-wrap @lg:items-end">
          <label className="block min-w-0 space-y-1 @lg:w-44">
            <span className="muted block text-xs">Day</span>
            <input
              type="date"
              value={cDate}
              min={today}
              max={
                reach && /^\d{4}-\d{2}-\d{2}$/.test(reach) ? reach : undefined
              }
              onChange={e => setCDate(e.target.value)}
              className={`${field} min-w-0 font-mono tabular-nums dark:[color-scheme:dark] pointer-coarse:min-h-11`}
            />
          </label>
          <label className="block min-w-0 space-y-1 @lg:w-36">
            <span className="muted block text-xs">Time</span>
            <input
              type="time"
              step={300}
              value={cTime}
              onChange={e => setCTime(e.target.value)}
              className={`${field} min-w-0 font-mono tabular-nums dark:[color-scheme:dark] pointer-coarse:min-h-11`}
            />
          </label>
          {!custom.host ? (
            <label className="block min-w-0 space-y-1 @md:col-span-2 @lg:w-52">
              <span className="muted block text-xs">Who takes it</span>
              <select
                value={cHostId}
                onChange={e => setCHostId(e.target.value)}
                className={`${field} pointer-coarse:min-h-11`}
              >
                <option value="">Pick someone</option>
                {custom.hosts.map(h => (
                  <option key={h.user_id} value={h.user_id}>
                    {h.name ?? h.user_id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {said ? (
          <p
            role="status"
            className={
              said.tone === "warn"
                ? "callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm"
                : "muted text-xs leading-relaxed"
            }
          >
            {said.line}
            {answer?.error ? (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setCTick(n => n + 1)}
                  className="underline underline-offset-2"
                >
                  Check again
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {typed ? (
          <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-[repeat(5,minmax(0,11rem))]">
            {tileBtn(typed, null, false, { anyway: cv?.tile === "anyway" })}
          </div>
        ) : null}
      </div>
    );
  }

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
          {windowWords ? ` ${windowWords}` : ""}, so these are the team's times;
          each names who takes it.
        </p>
      ) : null}
      {body}
      {customRow}
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
              linkNote={linkLine(slots.window_until ?? slots.until)}
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
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => setLinkOpen(true)}
              className="muted inline-flex items-center text-xs underline underline-offset-2 hover:text-[color:var(--foreground)] pointer-coarse:h-11"
            >
              Or send them the link to pick a time themselves
            </button>
            <p className="muted text-[11px] leading-snug opacity-80">
              {linkLine(slots.window_until ?? slots.until)}
            </p>
          </div>
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
