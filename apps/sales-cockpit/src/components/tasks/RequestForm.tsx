import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Cable,
  CalendarClock,
  CalendarDays,
  CalendarX,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  Contact,
  CreditCard,
  FileExclamationPoint,
  FileLock,
  Funnel,
  Headset,
  HeartHandshake,
  Inbox,
  LayoutGrid,
  List,
  ListChecks,
  LoaderCircle,
  Lock,
  LogOut,
  MapPin,
  Megaphone,
  MessageCircleWarning,
  MessagesSquare,
  Palette,
  PanelsTopLeft,
  Pause,
  PenLine,
  PhoneForwarded,
  PhoneIncoming,
  Play,
  ReceiptText,
  ScrollText,
  Search,
  Send,
  Share2,
  Signpost,
  SlidersHorizontal,
  Split,
  SquarePlus,
  Target,
  Ticket,
  UserRoundMinus,
  UserRoundPlus,
  Wrench,
  X,
} from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import {
  errorWords,
  newRequestId,
  previewRequest,
  readRequest,
  readRequestClients,
  readRequests,
  readRequestTypes,
  submitRequest,
} from "@/lib/requestsClient";
import {
  answerTeamLines,
  bodyFields,
  type ClientOption,
  carriedDueOn,
  choiceControl,
  cleanAnswers,
  clientField,
  countWords,
  dayLabel,
  display,
  dueChoices,
  dueField,
  everyType,
  type FieldView,
  fieldOfSentence,
  GENERAL_KEYS,
  type HeldWait,
  handLists,
  heldWait,
  kuwaitClock,
  kuwaitToday,
  type LaneWorks,
  LIMITS,
  markWords,
  numberWord,
  PRIORITIES,
  type Priority,
  partMoving,
  priorityField,
  questionGroups,
  REQUEST_SENTENCES,
  type ReachPiece,
  type RequestRow,
  ROUTE_WORDS,
  type RouteLane,
  type RouteModel,
  type RoutePart,
  type RoutePreview,
  reachPieces,
  requestsOpen,
  routeModel,
  routeNote,
  routesKnown,
  routingFields,
  type SentLane,
  type SentModel,
  type SubmitResult,
  searchCountWords,
  searchLeads,
  searchTypes,
  sentModel,
  TEAM_LABEL,
  TEAM_ORDER,
  type Team,
  type TypeFact,
  type TypesRead,
  type TypeView,
  taskNameParts,
  teamByAnswer,
  teamExamples,
  teamLook,
  teamRelated,
  teamTypes,
  typeFacts,
  typeLook,
  validateAnswers,
} from "@/lib/requestsCore";
import { useTaskSeat } from "@/lib/taskSeat";
import "./requests.css";

/*
 * The department map (tickets-look-1028). The CEO, 2026-10-28: "make it ...
 * easy for the team to understand what is for which department and what
 * happens exactly ... Just don't make it like a boring form."
 *
 * Design plan (frontend-design skill; docs/DESIGN.md is the locked system):
 * - Subject and job: a thirteen-person agency team asking another team for
 *   work. Find the right team and request in seconds, answer only what it
 *   needs, and know before and after Send where it lands, who owns it, what
 *   they work from, by when and how you hear back.
 * - Tokens: each app's own (--card, --foreground, --muted-foreground,
 *   --border, --primary as the one accent, --success, --warning and
 *   --destructive on marks only), mixed in requests.css. No department
 *   colour: a department is a lucide mark in a seal, its ClickUp name, one
 *   plain line and its place on the map.
 * - Type: Geist; 20px plate and sent headings, 15-16px tile and lane names,
 *   14px rows and inputs, 13px lines; Geist Mono only for the short
 *   uppercase kickers and the "Checked 14:03" stamp.
 * - Layout: container queries on the form's own width. The map in three,
 *   two or one column; a chosen request as a plate, then the questions
 *   beside the route from 880px (the route a sticky read-out; the held
 *   note, the error summary and Send under the questions); one column
 *   below, the route ending in Send. No box scrolls inside the page.
 * - Signature: the route on the map. A vertical route of stops drawn in CSS
 *   borders: Now, the held stop when it would be held, the decision at the
 *   fork, one lane per department (dashed "May go to" lanes before the
 *   deciding answer, side by side only for exactly two), How they do it,
 *   Due, After that. After Send the same drawing becomes the tracker.
 * - Copy: plain and active, the server's own sentences for every state,
 *   each said once. "Send request" becomes "Save request" while a send
 *   would be held.
 */

export type RequestFormProps = {
  /** Where the request is raised: the portal's /requests or a client page. */
  source: "requests_page" | "client_page";
  /** The client, fixed (the CSM client page, or a routed old ticket). */
  presetClient?: { taskId: string; name: string };
  /** A type key to start on; the person can still change it. */
  presetType?: string;
  /** Text for the type's details question (a routed old ticket). */
  presetDetails?: string;
  /**
   * Answers to start from, by field key, as words (a request filed again
   * after it did not reach ClickUp). A choice matches by its name or id.
   */
  presetAnswers?: Record<string, string>;
  /**
   * The priority and due day to start from (a request filed again, or an old
   * form ticket made a request) in place of the type's defaults. A due day
   * before today in Kuwait, or more than a year ahead, gives the default.
   */
  presetPriority?: Priority;
  presetDueOn?: string;
  /** The old ClickUp form ticket this request routes (2.10). */
  replacesTaskId?: string;
  /**
   * A request filed again routes its old form ticket only while the ticket
   * still waits: once it is routed ("That old ticket was already routed."),
   * the request goes on its own. "Make it a request" leaves this off, so a
   * ticket a teammate routed first is never asked for twice.
   */
  replacesIfOpen?: boolean;
  /** Smaller tiles and two shortcuts a team, inside another card. */
  compact?: boolean;
  /** Called once a request is sent (not for a duplicate). */
  onSent?: (result: SubmitResult) => void;
};

type Load<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

type Answers = Record<string, string>;

/**
 * What a request brings into the form (an old form ticket made a request, or
 * a request filed again): its details, its answers as words, its priority
 * and due day. Kept for whichever type is picked, a changed or replacement
 * type too, until "Ask for something else".
 */
type Carried = {
  details?: string;
  answers?: Record<string, string>;
  priority?: Priority;
  dueOn?: string;
};

/** The lucide marks the looks name (requestsCore keeps names, not icons). */
const ICONS: Record<string, typeof Ticket> = {
  Cable,
  CalendarClock,
  CalendarX,
  Contact,
  CreditCard,
  FileExclamationPoint,
  FileLock,
  Funnel,
  Headset,
  HeartHandshake,
  Inbox,
  ListChecks,
  LogOut,
  MapPin,
  Megaphone,
  MessageCircleWarning,
  MessagesSquare,
  Palette,
  PanelsTopLeft,
  Pause,
  PenLine,
  PhoneForwarded,
  PhoneIncoming,
  Play,
  ReceiptText,
  ScrollText,
  Share2,
  Signpost,
  SlidersHorizontal,
  SquarePlus,
  Target,
  Ticket,
  UserRoundMinus,
  UserRoundPlus,
  Wrench,
};

function Mark({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Ticket;
  return <Icon aria-hidden className={className} />;
}

/** A department's or a request's mark in its seal. */
function Seal({
  icon,
  size = "md",
  dashed = false,
}: {
  icon: string;
  size?: "sm" | "md" | "lg";
  dashed?: boolean;
}) {
  return (
    <span
      className="rq-seal"
      data-size={size}
      data-dashed={dashed || undefined}
      aria-hidden
    >
      <Mark name={icon} />
    </span>
  );
}

/**
 * Ask a team: the request form (CONTRACT.md 6.4). Shared byte for byte by
 * the five cockpits; it reads the seat through each app's own taskSeat.ts.
 */
export function RequestForm({
  source,
  presetClient,
  presetType,
  presetDetails,
  presetAnswers,
  presetPriority,
  presetDueOn,
  replacesTaskId,
  replacesIfOpen = false,
  compact = false,
  onSent,
}: RequestFormProps) {
  const seat = useTaskSeat();
  const client = seat.client;
  const [types, setTypes] = useState<Load<TypesRead>>({ status: "loading" });
  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [picked, setPicked] = useState<{ taskId: string; name: string } | null>(
    presetClient ?? null,
  );
  const [dueOn, setDueOn] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  // Each press of Send: the error summary is said again on every press.
  const [presses, setPresses] = useState(0);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<SubmitResult | null>(null);
  // Whether requests were open for the sent request: its words say "Saved"
  // until they are, never "Sending" or "In {list}".
  const [sentOpen, setSentOpen] = useState(true);
  // The press, on this device, in Kuwait time ("Sent at 14:02").
  const [sentAt, setSentAt] = useState<string | null>(null);
  // Filed again, and its old form ticket was routed meanwhile.
  const [sentAlone, setSentAlone] = useState(false);
  // The sent view's reads: the last one, and whether the two minutes ran out.
  const [checks, setChecks] = useState<{
    at: string | null;
    stopped: boolean;
  }>({ at: null, stopped: false });
  const [duplicate, setDuplicate] = useState<SubmitResult | null>(null);
  const [preview, setPreview] = useState<Load<RoutePreview> | null>(null);
  // What the shown preview was read for: its choices and its client. The
  // route is drawn from these, never from answers a newer preview has not
  // read yet, so it changes only when that preview lands (review BT-4).
  const [readFor, setReadFor] = useState<{
    choices: Record<string, string>;
    client: string | null;
  } | null>(null);
  // The error summary, said once a press through a polite line that is on
  // the page before it, filled once focus is on the first answer to fix;
  // the visible summary is not live (review A11Y-02).
  const [announce, setAnnounce] = useState("");
  // Before the deciding answer: each answer's own preview, for the owners
  // of the lanes that may run.
  const [choicePreviews, setChoicePreviews] = useState<Record<
    string,
    RoutePart[]
  > | null>(null);
  // True while a new preview is being read over the last one.
  const [previewBusy, setPreviewBusy] = useState(false);
  const [recentRows, setRecentRows] = useState<RequestRow[]>([]);
  // One id per request: a retry of the same press reuses it (2.5 step 3).
  const requestId = useRef(newRequestId());
  const inFlight = useRef(false);
  const formRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dupRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  // Where focus goes after the next render: the chosen request's plate after
  // a pick, the search after Change or "Ask for something else", the
  // duplicate's heading when the request is already open (research 2.12):
  // a keyboard never lands on the page body.
  const focusNext = useRef<"plate" | "search" | "dup" | null>(null);
  const baseId = useId();
  // What the request this form starts from brings (Carried): it goes with
  // whichever type is picked, so a Change or a type that is off never drops
  // the old ticket's words or the request's own priority and due day.
  const carried = useRef<Carried>({
    details: presetDetails?.trim() || undefined,
    answers: presetAnswers,
    priority: presetPriority,
    dueOn: presetDueOn,
  });
  // Why the type a request came with is not on the form, said once.
  const [presetOff, setPresetOff] = useState<string | null>(null);

  const loadTypes = useCallback(async () => {
    if (!client) return;
    setTypes({ status: "loading" });
    try {
      setTypes({ status: "ready", data: await readRequestTypes(client) });
    } catch (e) {
      setTypes({ status: "error", error: errorWords(e) });
    }
  }, [client]);

  useEffect(() => {
    if (seat.ready && client) void loadTypes();
  }, [seat.ready, client, loadTypes]);

  // The seat's own recent requests, for the row of shortcuts: one read, and
  // a failed one changes nothing.
  useEffect(() => {
    if (!seat.ready || !client) return;
    let live = true;
    readRequests(client, "mine", 20)
      .then(read => {
        if (live) setRecentRows(read.rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [seat.ready, client]);

  // On a client page only the types that take a client make sense.
  const offered = useMemo(() => {
    if (types.status !== "ready") return [];
    const all = types.data.types.filter(t => t.enabled);
    return source === "client_page" || presetClient
      ? all.filter(t => clientField(t))
      : all;
  }, [types, source, presetClient]);
  const type = offered.find(t => t.key === typeKey) ?? null;
  // The client that goes with the request: only a type that asks for one
  // takes one, so nothing else ever previews, sends or titles it.
  const chosenClient = type && clientField(type) ? picked : null;
  const chosenId = chosenClient?.taskId ?? null;

  const recent = useMemo(() => {
    const out: TypeView[] = [];
    const rows = [...recentRows].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    for (const r of rows) {
      const t = offered.find(x => x.key === r.typeKey);
      if (t && !out.includes(t)) out.push(t);
      if (out.length === 3) break;
    }
    return out;
  }, [recentRows, offered]);

  const choose = useCallback(
    (next: TypeView | null) => {
      setTypeKey(next?.key ?? null);
      setErrors({});
      setFormError(null);
      setAttempted(false);
      setPreview(null);
      setReadFor(null);
      setChoicePreviews(null);
      if (!next) return;
      // A request that asks for no client sends none: a client picked for
      // another request never goes with it (a fixed client never offers
      // such a type).
      if (!clientField(next)) setPicked(presetClient ?? null);
      const kept = carried.current;
      setDueOn(carriedDueOn(kept.dueOn) ?? next.dueDefault);
      setPriority(
        PRIORITIES.find(p => p.key === kept.priority)?.key ?? next.priority,
      );
      setAnswers(startAnswers(next, kept.details, kept.answers));
      setPresetOff(null);
    },
    [presetClient],
  );

  // The preset type, once the types are read. A type that is not on the
  // form is said once, and what the request brings waits for the type the
  // person picks instead.
  const presetDone = useRef(false);
  useEffect(() => {
    if (presetDone.current || types.status !== "ready") return;
    presetDone.current = true;
    if (!presetType) return;
    const hit = offered.find(t => t.key === presetType);
    if (hit) {
      choose(hit);
      return;
    }
    const listed = types.data.types.find(t => t.key === presetType);
    const kept = carried.current;
    const words =
      listed?.enabled && !clientField(listed)
        ? REQUEST_SENTENCES.presetNoClient
        : REQUEST_SENTENCES.presetOff;
    setPresetOff(
      kept.details || Object.keys(kept.answers ?? {}).length
        ? `${words} ${REQUEST_SENTENCES.presetKept}`
        : words,
    );
  }, [types, offered, presetType, choose]);

  // Focus follows the person's own move: onto the plate after a pick, back
  // to the search after Change. A target not on the page yet is waited for:
  // after "Try again" the types are read first, then the search takes focus,
  // or the next "Try again" if the read fails again (review T2-a11y-01).
  useEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    const target =
      next === "plate"
        ? plateRef.current
        : next === "dup"
          ? dupRef.current
          : (searchRef.current ?? retryRef.current);
    if (!target) return;
    focusNext.current = null;
    target.focus();
  });

  // Re-check a field once the person has pressed Send and then fixes it.
  useEffect(() => {
    if (!attempted || !type) return;
    setErrors(validateAnswers(type, answers, chosenId, dueOn));
  }, [attempted, type, answers, chosenId, dueOn]);
  // A fix silences the press's summary line: the visible summary shrinks
  // quietly, and only the next press says it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleared on each change of these
  useEffect(() => {
    setAnnounce("");
  }, [type, answers, chosenId, dueOn]);

  // The route: re-read when the type, the client or a choice changes (a
  // choice is the only kind of answer a part's "runs when" reads), never on
  // every key press.
  const choiceKey = useMemo(() => {
    if (!type) return "{}";
    const picks: Record<string, string> = {};
    for (const f of type.fields)
      if (f.kind === "select" && answers[f.key]) picks[f.key] = answers[f.key];
    return JSON.stringify(picks);
  }, [type, answers]);
  const previewSeq = useRef(0);
  useEffect(() => {
    if (!client || !type) return;
    const seq = ++previewSeq.current;
    const choices = JSON.parse(choiceKey) as Record<string, string>;
    // The one deciding question still unanswered, when the database says
    // which tasks it decides: each of its answers is read too, so the lanes
    // that may run name their real owner (never one that does not exist).
    const deciding = routesKnown(type)
      ? routingFields(type).filter(f => !choices[f.key])
      : [];
    const ask = deciding.length === 1 ? deciding[0] : null;
    setPreview(p => (p?.status === "ready" ? p : { status: "loading" }));
    setPreviewBusy(true);
    const timer = setTimeout(async () => {
      const clientId = chosenId;
      try {
        const [data, ...each] = await Promise.all([
          previewRequest(client, type.key, clientId, choices),
          ...(ask?.options ?? []).map(o =>
            previewRequest(client, type.key, clientId, {
              ...choices,
              [ask?.key ?? ""]: o.id,
            }).catch(() => null),
          ),
        ]);
        if (seq !== previewSeq.current) return;
        setPreview({ status: "ready", data });
        setReadFor({ choices, client: clientId });
        setChoicePreviews(
          ask
            ? Object.fromEntries(
                (ask.options ?? []).map((o, i) => [o.id, each[i]?.parts ?? []]),
              )
            : null,
        );
      } catch (e) {
        if (seq === previewSeq.current)
          setPreview({ status: "error", error: errorWords(e) });
      } finally {
        if (seq === previewSeq.current) setPreviewBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [client, type, chosenId, choiceKey]);

  const writer =
    preview?.status === "ready"
      ? preview.data.writer
      : types.status === "ready"
        ? types.data.writer
        : null;
  // Whether a send now reaches ClickUp, or is only saved until requests
  // open (a dry run, or off the test card): the server's answer for this
  // card (writer.held) when it gives one, else the writer's mode.
  const open =
    typeof writer?.held === "boolean"
      ? !writer.held
      : requestsOpen(
          types.status === "ready" ? types.data.writer : null,
          chosenId,
        );
  // The writer has not reported (mode unknown): held words follow the
  // gate's own note, never "once requests open" where requests had opened
  // (review CL-04). Only a lead seat's note then asks for action (check the
  // Machine tab), so only it holds back "Nothing else to do now"; a plain
  // seat's reads "when the writer is back" everywhere (clickup-diet-1029).
  const quiet =
    ((writer as { mode?: string } | null)?.mode ??
      (types.status === "ready" ? types.data.writer.mode : null)) === "unknown";
  const lead = types.status === "ready" && Boolean(types.data.seat.all);
  const wait: HeldWait = heldWait(quiet, lead, writer?.note);
  const asks = quiet && lead;

  // Requests that stop being open to the seat partway through swap the
  // questions for the writer's note: the control the person was on goes, so
  // focus moves to the note that replaces it, never the page body (CONTRACT
  // 6.7 Focus; review T3-a11y-behaviour-02).
  const off = Boolean(writer && !writer.canSend);
  const questionsShown = Boolean(type) && !off && !sent && !duplicate;
  const offRef = useRef<HTMLDivElement>(null);
  const hadQuestions = useRef(false);
  useEffect(() => {
    const before = hadQuestions.current;
    hadQuestions.current = questionsShown;
    if (!before || questionsShown || !type || !off || sent || duplicate) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    offRef.current?.focus();
  }, [questionsShown, type, off, sent, duplicate]);

  // After a send, read the request again while a task is on its way, so the
  // panel says "In {list}" only once ClickUp has it. Every 5 seconds for two
  // minutes at most; a failed read keeps the last answer.
  const sentId = sent?.id ?? null;
  const moving = Boolean(sent?.parts.some(p => partMoving(p, sentOpen)));
  useEffect(() => {
    if (!client || !sentId || !moving) return;
    let reads = 0;
    let live = true;
    const timer = setInterval(async () => {
      reads += 1;
      if (reads > 24) {
        clearInterval(timer);
        if (live) setChecks(c => ({ ...c, stopped: true }));
        return;
      }
      try {
        const next = await readRequest(client, sentId);
        if (!live) return;
        setSent(s => (s && s.id === sentId ? { ...s, parts: next.parts } : s));
        if (typeof next.held === "boolean") setSentOpen(!next.held);
        setChecks({ at: new Date().toISOString(), stopped: false });
      } catch {
        // The panel keeps what it last knew.
      }
    }, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client, sentId, moving]);

  const setAnswer = (key: string, value: string) =>
    setAnswers(a => ({ ...a, [key]: value }));

  // After the render that shows it (a due day's own date input opens with
  // its error), so the field is there to take focus. `then` runs once focus
  // has moved.
  const focusField = (key: string, then?: () => void) => {
    setTimeout(() => {
      formRef.current
        ?.querySelector<HTMLElement>(`[data-field="${key}"]`)
        ?.focus();
      then?.();
    }, 0);
  };

  // The fields in the order the form shows them, so the first error focused
  // is the first one on screen.
  const screenOrder = (t: TypeView) => [
    ...(clientField(t) ? [clientField(t)?.key ?? ""] : []),
    ...questionGroups(t).flatMap(g => g.fields.map(f => f.key)),
    dueField(t)?.key ?? "",
  ];

  async function send() {
    if (inFlight.current || !client) return;
    if (!type) {
      setFormError(REQUEST_SENTENCES.noType);
      return;
    }
    setAttempted(true);
    setPresses(n => n + 1);
    setFormError(null);
    const problems = validateAnswers(type, answers, chosenId, dueOn);
    setErrors(problems);
    const first = screenOrder(type).find(k => problems[k]);
    if (first || Object.keys(problems).length) {
      // Said after focus has moved, politely, so it waits behind the focused
      // field's own error and a focus change never cuts it off; a second
      // press with the same errors is told again (a trailing space).
      const said = `${summaryWords(
        problems,
        screenOrder(type),
        lostChoices(type).map(f => f.key),
      )}${presses % 2 ? "\u00a0" : ""}`;
      focusField(first ?? Object.keys(problems)[0], () => setAnnounce(said));
      return;
    }
    if (
      preview?.status === "ready" &&
      preview.data.parts.length === 0 &&
      preview.data.note
    ) {
      // Said as the route says it: never "Pick ..." for a choice ClickUp no
      // longer gives (review BT-6, S4).
      setFormError(routeNote(type, preview.data.note));
      return;
    }
    inFlight.current = true;
    setSending(true);
    try {
      const body = {
        requestId: requestId.current,
        typeKey: type.key,
        clientTaskId: chosenId,
        answers: cleanAnswers(type, answers),
        dueOn: dueOn || null,
        priority,
        source,
        replacesTaskId: replacesTaskId ?? null,
      };
      let alone = false;
      let result: SubmitResult;
      try {
        result = await submitRequest(client, body);
      } catch (e) {
        // Filed again, and its old form ticket was routed meanwhile: the
        // server wrote nothing, so the same request id goes on its own.
        if (
          !replacesIfOpen ||
          !body.replacesTaskId ||
          errorWords(e) !== REQUEST_SENTENCES.oldTicketRouted
        )
          throw e;
        alone = true;
        result = await submitRequest(client, { ...body, replacesTaskId: null });
      }
      if (result.state === "duplicate") {
        focusNext.current = "dup";
        setDuplicate(result);
      } else {
        // The sent view is the one voice for the event: focus moves to its
        // heading, so no toast says it again, and a held request never shows
        // a success mark.
        setSentOpen(typeof result.held === "boolean" ? !result.held : open);
        setSentAt(new Date().toISOString());
        setSentAlone(alone);
        setChecks({ at: null, stopped: false });
        setSent(result);
        onSent?.(result);
      }
    } catch (e) {
      const words = errorWords(e);
      const key = fieldOfSentence(type, words);
      if (key) {
        setErrors(x => ({ ...x, [key]: words }));
        focusField(key);
      } else setFormError(words);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  function again() {
    requestId.current = newRequestId();
    focusNext.current = "search";
    // Something else: nothing of the request this form started from.
    carried.current = {};
    setSent(null);
    setDuplicate(null);
    setSentAlone(false);
    setPicked(presetClient ?? null);
    choose(null);
    setAnswers({});
  }

  const root = `rq-form${compact ? " rq-compact" : ""}`;

  if (!seat.ready)
    return (
      <div className={root}>
        <Waiting text="Checking your seat" />
      </div>
    );
  if (!seat.signedIn || !client)
    return (
      <div className={root}>
        <p className="rq-note">Sign in with your cockpit seat to ask a team.</p>
      </div>
    );
  if (types.status === "loading")
    return (
      <div className={root}>
        <Waiting text={REQUEST_SENTENCES.loadingTypes} />
      </div>
    );
  if (types.status === "error")
    return (
      <div className={root}>
        <div className="rq-alert" role="alert">
          <CircleAlert aria-hidden />
          <div>
            <p>{types.error}</p>
            <button
              ref={retryRef}
              type="button"
              className="rq-btn rq-btn-outline rq-btn-sm"
              onClick={() => {
                focusNext.current = "search";
                void loadTypes();
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );

  if (sent && type)
    return (
      <div className={root}>
        <SentView
          type={type}
          model={sentModel(sent.parts, sentOpen, {
            stopped: checks.stopped,
            wait,
            asks,
          })}
          sentId={sent.id}
          client={chosenClient}
          answers={answers}
          dueOn={dueOn}
          priority={priority}
          sentAt={sentAt}
          alone={sentAlone}
          checks={checks}
          moving={moving}
          heldNote={writer?.note?.trim() || null}
          wait={wait}
          onAgain={again}
        />
      </div>
    );

  if (duplicate)
    return (
      <div className={root}>
        {/* Focus goes to the heading, which carries the server's note as its
            description: one voice, never a status inserted with its words
            (review A11Y-05). */}
        <div className="rq-dup">
          <CircleAlert aria-hidden className="rq-dup-icon" />
          <div>
            <h3
              ref={dupRef}
              tabIndex={-1}
              className="rq-sent-title"
              aria-describedby={duplicate.note ? `${baseId}-dup` : undefined}
            >
              Already open
              {type ? (
                <>
                  : {type.label}
                  {chosenClient ? (
                    <>
                      {" "}
                      for <bdi dir="auto">{chosenClient.name}</bdi>
                    </>
                  ) : null}
                </>
              ) : null}
            </h3>
            <p id={`${baseId}-dup`} className="rq-sent-sub">
              <WithName text={duplicate.note ?? ""} name={chosenClient?.name} />
            </p>
          </div>
        </div>
        <div className="rq-actions">
          {duplicate.duplicateOf ? (
            <PortalLink
              to={`/requests?id=${encodeURIComponent(duplicate.duplicateOf)}`}
              className="rq-btn rq-btn-primary"
            >
              Open it
            </PortalLink>
          ) : null}
          <button
            type="button"
            className="rq-btn rq-btn-outline"
            onClick={again}
          >
            Ask for something else
          </button>
        </div>
      </div>
    );

  const today = kuwaitToday();

  // The writer's answer before anyone types (2.8): said once at the top
  // until a type is picked, then in place of the questions and Send.
  const writerOff = writer && !writer.canSend ? writer : null;
  // A seat that may file while requests are not open (editors, admins, the
  // CEO in a dry run) is told the request is saved, not sent.
  const writerNote =
    writer?.canSend && writer.note?.trim() ? writer.note.trim() : null;
  const held = Boolean(writer?.canSend) && !open;
  // The words a request brought that the picked type has no question for
  // (an old ticket made a "Card missing" request): shown, not dropped.
  const keptWords =
    type && !type.fields.some(f => f.kind === "details")
      ? (carried.current.details ?? null)
      : null;
  // The answers given so far, kept on screen when requests stop being open
  // to the seat partway through (review BT-7): a client the person picked
  // and every question with an answer.
  const given = type
    ? bodyFields(type).filter(f => (answers[f.key] ?? "").trim())
    : [];
  const givenClient = presetClient ? null : chosenClient;
  // A required choice with no option ClickUp gives cannot be answered, so
  // the request cannot be sent here: the sentence says to tell the systems
  // manager, the lists its tasks go to in ClickUp are the way when it cannot
  // wait (there is no ClickUp form any more; every list, since the lost
  // answer may be what picks among them: clickup-diet-1029), Send says why,
  // and the route says only where it would go (review
  // T3-design-clarity-05). Send still takes a press, so the summary can take
  // focus to the lost choice (A11Y-21).
  const lost = type ? lostChoices(type) : [];

  return (
    <div className={root} ref={formRef}>
      {writerOff && !type ? <WriterOff note={writerOff.note} /> : null}
      {/* A held request's note (saved until requests open): said before
          anything is picked; once a type is, on the route. Every seat may
          now be held (20261029p), so it reads as the cockpit keeping the
          request, with the held mark, never as a warning. */}
      {writerNote && !type ? (
        <p className="rq-off rq-off-held" role="status">
          <Clock aria-hidden />
          <span>{writerNote}</span>
        </p>
      ) : null}
      {presetOff && !type ? (
        <p className="rq-off" role="status">
          <CircleAlert aria-hidden />
          <span>{presetOff}</span>
        </p>
      ) : null}

      {!type ? (
        offered.length ? (
          <Finder
            types={offered}
            compact={compact}
            recent={recent}
            searchRef={searchRef}
            ahead={Boolean(writerOff)}
            error={formError === REQUEST_SENTENCES.noType ? formError : null}
            onChoose={t => {
              focusNext.current = "plate";
              choose(t);
            }}
          />
        ) : (
          <p className="rq-note">{REQUEST_SENTENCES.noTypes}</p>
        )
      ) : (
        <>
          <Plate
            type={type}
            plateRef={plateRef}
            ahead={Boolean(writerOff)}
            onChange={() => {
              focusNext.current = "search";
              choose(null);
            }}
          />
          {writerOff ? (
            <div className="rq-body">
              <div className="rq-qs">
                <WriterOff
                  note={writerOff.note}
                  focusRef={offRef}
                  describedBy={`${baseId}-off-help`}
                />
                {given.length || givenClient ? (
                  <>
                    <AnswerList
                      title="Your answers so far"
                      client={givenClient}
                      fields={given}
                      answers={answers}
                    />
                    <p className="rq-help" id={`${baseId}-off-help`}>
                      {REQUEST_SENTENCES.offKept}
                    </p>
                  </>
                ) : (
                  <p className="rq-help" id={`${baseId}-off-help`}>
                    {REQUEST_SENTENCES.offAsked}
                  </p>
                )}
              </div>
              <RouteView
                type={type}
                preview={preview}
                choicePreviews={choicePreviews}
                readFor={readFor}
                client={chosenClient}
                busy={previewBusy}
                dueOn={dueOn}
                priority={priority}
                held={false}
                heldNote={null}
                wait={wait}
                ahead
              />
            </div>
          ) : (
            <div className="rq-body">
              <div className="rq-qs">
                {clientField(type) ? (
                  <ClientPicker
                    field={clientField(type) as FieldView}
                    baseId={baseId}
                    locked={presetClient ?? null}
                    lockedHelp={
                      source === "client_page"
                        ? "This page's client."
                        : "Fixed for this request."
                    }
                    picked={picked}
                    onPick={setPicked}
                    error={errors[clientField(type)?.key ?? ""] ?? null}
                  />
                ) : null}
                {questionGroups(type)
                  .filter(g => g.fields.length)
                  .map((g, i) => (
                    <div
                      key={g.title ?? `rest-${i}`}
                      className="rq-qgroup"
                      data-titled={g.title ? true : undefined}
                    >
                      {g.title ? (
                        <h4 className="rq-qgroup-title">{g.title}</h4>
                      ) : null}
                      {g.fields.map(f => (
                        <Question
                          key={f.key}
                          type={type}
                          field={f}
                          baseId={baseId}
                          value={answers[f.key] ?? ""}
                          onChange={v => setAnswer(f.key, v)}
                          error={errors[f.key] ?? null}
                        />
                      ))}
                    </div>
                  ))}
                {keptWords ? (
                  <div className="rq-field">
                    <p className="rq-label">{REQUEST_SENTENCES.keptLabel}</p>
                    <p className="rq-quote" dir="auto">
                      {keptWords}
                    </p>
                    <p className="rq-help">
                      {replacesTaskId
                        ? REQUEST_SENTENCES.keptRouted
                        : REQUEST_SENTENCES.keptNotSent}
                    </p>
                  </div>
                ) : null}
                <hr className="rq-sep" />
                <DueField
                  key={type.key}
                  type={type}
                  baseId={baseId}
                  dueOn={dueOn}
                  today={today}
                  onChange={setDueOn}
                  error={errors[dueField(type)?.key ?? ""] ?? null}
                />
                <PriorityField
                  type={type}
                  baseId={baseId}
                  value={priority}
                  onChange={setPriority}
                />
              </div>
              <RouteView
                type={type}
                preview={preview}
                choicePreviews={choicePreviews}
                readFor={readFor}
                client={chosenClient}
                busy={previewBusy}
                dueOn={dueOn}
                priority={priority}
                held={held}
                heldNote={held ? writerNote : null}
                wait={wait}
                blocked={lost.length > 0}
              />
              <SendBlock
                errors={attempted ? errors : {}}
                order={screenOrder(type)}
                lost={lost}
                hand={handLists(type)}
                announce={announce}
                formError={
                  formError && formError !== REQUEST_SENTENCES.noType
                    ? formError
                    : null
                }
                held={held}
                wait={wait}
                sending={sending}
                onSend={() => void send()}
                onFix={focusField}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A type's first answers: the routed ticket's details, or a request's own
 * answers as words when it is filed again (a choice by its name or id).
 */
export function startAnswers(
  type: TypeView,
  details?: string,
  start?: Record<string, string>,
): Answers {
  const out: Answers = {};
  for (const f of type.fields) {
    const raw = start?.[f.key];
    if (raw === undefined || raw === null || String(raw).trim() === "")
      continue;
    const text = String(raw).trim();
    if (f.kind === "select") {
      const hit = (f.options ?? []).find(o => o.id === text || o.name === text);
      if (hit) out[f.key] = hit.id;
    } else if (!["client", "deadline", "priority"].includes(f.kind))
      out[f.key] = text;
  }
  const detailsField = type.fields.find(f => f.kind === "details");
  if (details && detailsField) out[detailsField.key] = details;
  return out;
}

/** A link into the portal: in place inside it, a plain link from elsewhere. */
function PortalLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const seat = useTaskSeat();
  if (seat.inPortal)
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  return (
    <a href={seat.portalHref(to)} className={className}>
      {children}
    </a>
  );
}

/**
 * Said, not shown, inside a link that opens a new tab: its arrow says so on
 * screen (review A11Y-17).
 */
function NewTab() {
  return <span className="rq-sr"> (opens in a new tab)</span>;
}

/** A wait, said politely unless something else speaks for it (`live`). */
function Waiting({ text, live = true }: { text: string; live?: boolean }) {
  return (
    <p className="rq-note" role={live ? "status" : undefined}>
      <LoaderCircle aria-hidden className="rq-spin" />
      {text}
    </p>
  );
}

/** The required choices ClickUp lost: nothing can be picked for them. */
function lostChoices(type: TypeView): FieldView[] {
  return bodyFields(type).filter(
    f => f.required && f.kind === "select" && !(f.options ?? []).length,
  );
}

/**
 * The error summary's lead: "Fix these two answers first:", or, when every
 * answer in it is a choice ClickUp lost, that the request cannot be sent
 * here yet (review T3-design-clarity-05).
 */
function summaryLead(keys: string[], lost: string[]) {
  if (keys.length && keys.every(k => lost.includes(k)))
    return REQUEST_SENTENCES.lostLead;
  return keys.length === 1
    ? "Fix this answer first:"
    : `Fix these ${numberWord(keys.length)} answers first:`;
}

/** The error summary in words: "Fix these two answers first: ...". */
function summaryWords(
  errors: Record<string, string>,
  order: string[],
  lost: string[],
) {
  const keys = [
    ...order.filter(k => errors[k]),
    ...Object.keys(errors).filter(k => !order.includes(k)),
  ];
  return keys.length
    ? `${summaryLead(keys, lost)} ${keys.map(k => errors[k]).join(" ")}`
    : "";
}

/**
 * A server sentence that names the client: the name alone in its own
 * direction, so an Arabic name never reorders the words around it (review
 * A11Y-19).
 */
function WithName({ text, name }: { text: string; name?: string | null }) {
  if (!name || !text.includes(name)) return <>{text}</>;
  const runs = text.split(name);
  return (
    <>
      {runs.map((run, i) => (
        <span key={`${i}-${run}`}>
          {i > 0 ? <bdi dir="auto">{name}</bdi> : null}
          {run}
        </span>
      ))}
    </>
  );
}

/**
 * "Show the other {n}" goes once pressed, so focus moves to the first item
 * it showed (the item's own button, or the item itself), never to the page
 * body (research 2.12). Call the returned function with that item's index
 * before the list grows.
 */
function useRevealFocus(
  listRef: RefObject<HTMLElement | null>,
  selector: string | null,
) {
  const from = useRef<number | null>(null);
  useEffect(() => {
    const at = from.current;
    if (at === null) return;
    from.current = null;
    const item = listRef.current?.children[at] as HTMLElement | undefined;
    (selector ? item?.querySelector<HTMLElement>(selector) : item)?.focus();
  });
  return (at: number) => {
    from.current = at;
  };
}

/** A sentence a search found its words in, the words in bold. */
function Marked({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  return (
    <>
      {markWords(text, terms).map((run, i) =>
        run.hit ? (
          <b key={`${i}-${run.text}`} className="rq-hit">
            {run.text}
          </b>
        ) : (
          <span key={`${i}-${run.text}`}>{run.text}</span>
        ),
      )}
    </>
  );
}

/** Where a request goes, each team name with its mark. */
function Reach({ pieces }: { pieces: ReachPiece[] }) {
  return (
    <span className="rq-reach">
      {pieces.map((p, i) =>
        "text" in p ? (
          <span key={`${i}-${p.text}`}>{p.text}</span>
        ) : (
          <span key={`${i}-${p.label}`} className="rq-team-tag">
            <Mark name={teamLook(p.team).icon} />
            {p.label}
          </span>
        ),
      )}
    </span>
  );
}

function Facts({ facts }: { facts: TypeFact[] }) {
  return (
    <span className="rq-facts">
      {facts.map(f => (
        <span
          key={`${f.kind}-${f.text}`}
          className="rq-fact"
          data-kind={f.kind}
        >
          {f.pieces ? (
            <Reach pieces={f.pieces} />
          ) : (
            <>
              {f.team !== undefined ? (
                <Mark name={teamLook(f.team).icon} />
              ) : null}
              {f.text}
            </>
          )}
        </span>
      ))}
    </span>
  );
}

// --- Finding the request: search, recent, the map, a team, A to Z -----------

type FinderView =
  | { kind: "map" }
  | { kind: "team"; team: Team }
  | { kind: "all" };

/** "What do you need?": search on top, then the map of who does what. */
function Finder({
  types,
  compact,
  recent,
  searchRef,
  ahead,
  error,
  onChoose,
}: {
  types: TypeView[];
  compact: boolean;
  recent: TypeView[];
  searchRef: RefObject<HTMLInputElement | null>;
  /** Requests are not open to the seat: the reach words name the question. */
  ahead: boolean;
  error: string | null;
  onChoose: (t: TypeView) => void;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<FinderView>({ kind: "map" });
  const [more, setMore] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const id = useId();
  const found = useMemo(() => searchTypes(types, query), [types, query]);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searching = found.words.length > 0;
  const teams = TEAM_ORDER.filter(t => teamTypes(types, t).length > 0);
  // The count shows at once; a screen reader hears it once typing pauses,
  // never once a key (review A11Y-08).
  const count = searching ? searchCountWords(query, found) : "";
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSpoken(count), 500);
    return () => clearTimeout(timer);
  }, [count]);

  // A press that swaps the view takes focus to the new view's heading, so
  // a keyboard never lands on the page body.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    headRef.current?.focus();
  });
  const go = (next: FinderView) => {
    moved.current = true;
    setView(next);
  };

  return (
    <div className="rq-finder">
      <div className="rq-ask">
        <label className="rq-label rq-ask-label" htmlFor={`${id}-q`}>
          What do you need?
        </label>
        <div className="rq-search" data-filled={query ? true : undefined}>
          <Search aria-hidden className="rq-search-icon" />
          <input
            ref={searchRef}
            id={`${id}-q`}
            type="search"
            dir="auto"
            className="rq-input rq-search-input"
            placeholder="Search, for example: card declined"
            value={query}
            autoComplete="off"
            enterKeyHint="search"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-count`}
            onChange={e => {
              setQuery(e.target.value);
              setMore(false);
            }}
            onKeyDown={e => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
              // Return opens the first request only when it leads; when two
              // match as well, focus goes to the list to pick from.
              if (e.key === "Enter" && searching && found.hits[0]) {
                e.preventDefault();
                if (searchLeads(found)) onChoose(found.hits[0].type);
                else
                  resultsRef.current
                    ?.querySelector<HTMLElement>("button.rq-row")
                    ?.focus();
              }
            }}
          />
          {query ? (
            <button
              type="button"
              className="rq-search-clear"
              aria-label="Clear the search"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              <X aria-hidden />
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="rq-error" role="alert">
            <CircleAlert aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}
        {/* The one polite line for a search: the count, never the list,
            said once typing pauses. */}
        <p id={`${id}-count`} className={searching ? "rq-count" : "rq-sr"}>
          {count}
        </p>
        <p className="rq-sr" role="status">
          {spoken}
        </p>
      </div>

      {searching ? (
        <SearchResults
          rootRef={resultsRef}
          types={types}
          found={found}
          ahead={ahead}
          more={more}
          onMore={() => setMore(true)}
          onChoose={onChoose}
        />
      ) : view.kind === "map" ? (
        <>
          {recent.length ? (
            <div
              className="rq-recent"
              role="group"
              aria-labelledby={`${id}-recent`}
            >
              <h3 id={`${id}-recent`} className="rq-kicker">
                Your recent requests
              </h3>
              <ul className="rq-recent-list">
                {recent.map(t => (
                  <li key={t.key}>
                    <button
                      type="button"
                      className="rq-chip rq-type"
                      onClick={() => onChoose(t)}
                    >
                      <Mark name={typeLook(t).icon} />
                      <span className="rq-type-name">{t.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <section className="rq-map-wrap" aria-labelledby={`${id}-map`}>
            <div className="rq-map-head">
              <h3
                id={`${id}-map`}
                ref={headRef}
                tabIndex={-1}
                className="rq-kicker"
              >
                Who does what
              </h3>
              <p className="rq-muted">
                {capitalWord(numberWord(teams.length))}{" "}
                {teams.length === 1 ? "team takes" : "teams take"} requests.
                Start from the team, or search above.
              </p>
              <button
                type="button"
                className="rq-every"
                onClick={() => go({ kind: "all" })}
              >
                Every request, A to Z
                <span className="rq-pill-count">{types.length}</span>
                <ChevronRight aria-hidden />
              </button>
            </div>
            <div className="rq-map">
              {teams.map(team => (
                <Tile
                  key={team}
                  team={team}
                  types={types}
                  compact={compact}
                  onChoose={onChoose}
                  onOpen={() => go({ kind: "team", team })}
                />
              ))}
              <HelpTile types={types} onChoose={onChoose} />
            </div>
          </section>
        </>
      ) : (
        <>
          <TeamPills teams={teams} types={types} view={view} onGo={go} />
          {view.kind === "team" ? (
            <TeamList
              team={view.team}
              types={types}
              headRef={headRef}
              ahead={ahead}
              onChoose={onChoose}
            />
          ) : (
            <section className="rq-list" aria-labelledby={`${id}-all`}>
              <div className="rq-list-head">
                <h3
                  id={`${id}-all`}
                  ref={headRef}
                  tabIndex={-1}
                  className="rq-hero-name"
                >
                  Every request
                </h3>
                <p className="rq-dept-line">
                  A to Z, each with the team it is filed under. {types.length}{" "}
                  requests.
                </p>
              </div>
              <ul className="rq-rows">
                {everyType(types).map(t => (
                  <li key={t.key}>
                    <TypeRow type={t} named ahead={ahead} onChoose={onChoose} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

const capitalWord = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One department on the map: its seal, name, line and shortcuts. */
function Tile({
  team,
  types,
  compact,
  onChoose,
  onOpen,
}: {
  team: Team;
  types: TypeView[];
  compact: boolean;
  onChoose: (t: TypeView) => void;
  onOpen: () => void;
}) {
  const look = teamLook(team);
  const id = useId();
  const examples = teamExamples(types, team, compact ? 2 : 3);
  const all = teamTypes(types, team);
  // A group, not a landmark: the map is the one region (review A11Y-18).
  return (
    <div className="rq-dept" role="group" aria-labelledby={id}>
      <span className="rq-watermark" aria-hidden>
        <Mark name={look.icon} />
      </span>
      <div className="rq-dept-head">
        <Seal icon={look.icon} />
        <div>
          <h4 id={id} className="rq-group-label rq-dept-name">
            {TEAM_LABEL[team]}
          </h4>
          {look.line ? <p className="rq-dept-line">{look.line}</p> : null}
        </div>
      </div>
      {examples.length ? (
        <ul className="rq-dept-list">
          {examples.map(t => (
            <li key={t.key}>
              <button
                type="button"
                className="rq-pick rq-type"
                onClick={() => onChoose(t)}
              >
                <Mark name={typeLook(t).icon} />
                <span className="rq-type-name">{t.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {all.length > examples.length ? (
        <button
          type="button"
          className="rq-dept-more"
          aria-label={`See all ${all.length} ${TEAM_LABEL[team]} requests`}
          onClick={onOpen}
        >
          See all {all.length}
          <ChevronRight aria-hidden />
        </button>
      ) : null}
      <Related types={types} team={team} onChoose={onChoose} />
    </div>
  );
}

/**
 * A team's pointer to requests filed under another team that people often
 * look for there (review CL-09): "Ads stopped because a payment card
 * failed? Card missing for ads, under Client Success."
 */
function Related({
  types,
  team,
  onChoose,
}: {
  types: TypeView[];
  team: Team;
  onChoose: (t: TypeView) => void;
}) {
  const related = teamRelated(types, team);
  if (!related) return null;
  const one = related.types.every(t => t.team === related.types[0].team);
  return (
    <p className="rq-related">
      <Signpost aria-hidden />
      <span>
        {related.ask}{" "}
        {related.types.map((t, i) => (
          <span key={t.key}>
            {i ? (one ? " or " : ", or ") : ""}
            <button
              type="button"
              className="rq-inline"
              onClick={() => onChoose(t)}
            >
              {t.label}
            </button>
            {one ? "" : `, under ${t.teamLabel}`}
          </span>
        ))}
        {one ? `, under ${related.types[0].teamLabel}` : ""}.
      </span>
    </p>
  );
}

/** The way out: the three general requests, and who to ask. */
function HelpTile({
  types,
  onChoose,
}: {
  types: TypeView[];
  onChoose: (t: TypeView) => void;
}) {
  const id = useId();
  const general = GENERAL_KEYS.map(k => types.find(t => t.key === k)).filter(
    (t): t is TypeView => Boolean(t),
  );
  return (
    <div className="rq-dept rq-dept-help" role="group" aria-labelledby={id}>
      <div className="rq-dept-head">
        <Seal icon="Signpost" dashed />
        <div>
          <h4 id={id} className="rq-dept-name">
            Not sure which team?
          </h4>
          <p className="rq-dept-line">
            Pick the general request closest to it, or ask the systems manager.
          </p>
        </div>
      </div>
      {general.length ? (
        <ul className="rq-dept-list">
          {general.map(t => (
            <li key={t.key}>
              <button
                type="button"
                className="rq-pick rq-type"
                onClick={() => onChoose(t)}
              >
                <Mark name={teamLook(t.team).icon} />
                <span className="rq-type-name">{t.label}</span>
                <span className="rq-pick-team">{t.teamLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The way between teams: back to the map, each team, every request. */
function TeamPills({
  teams,
  types,
  view,
  onGo,
}: {
  teams: Team[];
  types: TypeView[];
  view: FinderView;
  onGo: (v: FinderView) => void;
}) {
  // When the teams do not fit beside the two overviews they take a row of
  // their own, which scrolls sideways where it must (review D8). The row
  // never shows a cut sliver of a pill at its edge (review
  // T3-design-clarity-09): it snaps to whole pills, and the room after its
  // end is sized so that even scrolled to the end it starts on a whole
  // pill. A current team already in view leaves the row as it is; one out
  // of view is brought to the row's start (or as near as the end allows),
  // the row alone scrolled, never the page.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    if (view.kind === "map" || !row) return;
    const pad = () => Number.parseFloat(getComputedStyle(row).paddingLeft) || 0;
    // The scroll that puts a pill at the row's start.
    const startOf = (el: Element) =>
      row.scrollLeft +
      el.getBoundingClientRect().left -
      row.getBoundingClientRect().left -
      pad();
    const fit = () => {
      row.style.paddingInlineEnd = "";
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 0) return;
      const end = Math.min(
        ...[...row.children].map(startOf).filter(s => s >= max - 1),
      );
      const room = Math.ceil(end - max);
      if (room > 0) row.style.paddingInlineEnd = `${pad() + room}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    const on = row.querySelector<HTMLElement>('[aria-current="true"]');
    const box = row.getBoundingClientRect();
    const pill = on?.getBoundingClientRect();
    if (
      on &&
      pill &&
      row.scrollWidth > row.clientWidth &&
      (pill.left < box.left + pad() - 1 || pill.right > box.right - pad() + 1)
    ) {
      const left = Math.min(startOf(on), row.scrollWidth - row.clientWidth);
      const still = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (typeof row.scrollTo === "function")
        row.scrollTo({ left, behavior: still ? "auto" : "smooth" });
      else row.scrollLeft = left;
    }
    return () => window.removeEventListener("resize", fit);
  }, [view]);
  // The current view is marked as the current item of the Teams navigation,
  // never as a toggle (review T3-a11y-behaviour-03).
  const current = (on: boolean) => (on ? ("true" as const) : undefined);
  return (
    <nav className="rq-teams" aria-label="Teams">
      {/* The two overviews first, outside the row that scrolls, so the way
          back to the map and the A to Z list always show; the teams follow
          on the same line when they fit, else on a line of their own
          (review T3-design-clarity-01). */}
      <button
        type="button"
        className="rq-pill rq-pill-home"
        onClick={() => onGo({ kind: "map" })}
      >
        <LayoutGrid aria-hidden />
        All teams
      </button>
      <button
        type="button"
        className="rq-pill rq-pill-home"
        aria-current={current(view.kind === "all")}
        onClick={() => onGo({ kind: "all" })}
      >
        <List aria-hidden />
        Every request
        <span className="rq-pill-count">{types.length}</span>
      </button>
      <div className="rq-teams-scroll" ref={rowRef}>
        {teams.map(team => (
          <button
            key={team}
            type="button"
            className="rq-pill"
            aria-current={current(view.kind === "team" && view.team === team)}
            onClick={() => onGo({ kind: "team", team })}
          >
            <Mark name={teamLook(team).icon} />
            {TEAM_LABEL[team]}
            <span className="rq-pill-count">
              {teamTypes(types, team).length}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/** One team opened: its own requests, then those that also give it a task. */
function TeamList({
  team,
  types,
  headRef,
  ahead,
  onChoose,
}: {
  team: Team;
  types: TypeView[];
  headRef: RefObject<HTMLHeadingElement | null>;
  ahead: boolean;
  onChoose: (t: TypeView) => void;
}) {
  const look = teamLook(team);
  const id = useId();
  const all = teamTypes(types, team);
  const own = all.filter(t => t.team === team).length;
  const also = all.length - own;
  // Those that give this team a task only for some answers are counted as
  // such, so the line is true for every answer (review T3-design-clarity-02).
  const some = teamByAnswer(types, team).length;
  const others = !also
    ? ""
    : !some
      ? `, and ${also} from other teams that also give it a task`
      : `, and ${also} from other teams that can give it a task, ${
          some === also
            ? also === 1
              ? "only for some answers"
              : "each only for some answers"
            : `${some} of them only for some answers`
        }`;
  return (
    <section className="rq-list" aria-labelledby={id}>
      <div className="rq-hero">
        <span className="rq-watermark" aria-hidden>
          <Mark name={look.icon} />
        </span>
        <Seal icon={look.icon} size="lg" />
        <div>
          <h3
            id={id}
            ref={headRef}
            tabIndex={-1}
            className="rq-group-label rq-hero-name"
          >
            {TEAM_LABEL[team]}
          </h3>
          <p className="rq-dept-line">
            {look.line ? `${look.line}. ` : ""}
            {own} request{own === 1 ? "" : "s"}
            {others}.
          </p>
        </div>
      </div>
      <Related types={types} team={team} onChoose={onChoose} />
      <ul className="rq-rows">
        {all.map(t => (
          <li key={t.key}>
            <TypeRow
              type={t}
              viewTeam={team}
              ahead={ahead}
              onChoose={onChoose}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A request as a row: its mark, name, one line and its own facts. */
function TypeRow({
  type,
  viewTeam = null,
  named = false,
  terms = [],
  via = null,
  ahead = false,
  onChoose,
}: {
  type: TypeView;
  viewTeam?: Team | null;
  named?: boolean;
  terms?: string[];
  via?: string | null;
  /** Requests are not open to the seat: the reach words name the question. */
  ahead?: boolean;
  onChoose: (t: TypeView) => void;
}) {
  const look = typeLook(type, ahead);
  const id = useId();
  // Named by its name, described by its line and facts (review A11Y-17).
  return (
    <button
      type="button"
      className="rq-row rq-type"
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-more`}
      onClick={() => onChoose(type)}
    >
      <Seal icon={look.icon} size="sm" />
      <span className="rq-row-text">
        <span className="rq-type-name" id={`${id}-name`}>
          <Marked text={type.label} terms={terms} />
        </span>
        <span className="rq-row-more" id={`${id}-more`}>
          {look.line ? (
            <span className="rq-row-line">
              <Marked text={look.line} terms={terms} />
            </span>
          ) : null}
          {via ? (
            <span className="rq-row-line">
              Found by <b className="rq-hit">{via}</b>
            </span>
          ) : null}
          <Facts facts={typeFacts(type, viewTeam, named, ahead)} />
        </span>
      </span>
    </button>
  );
}

/** A search's results, best first, then the general requests. */
function SearchResults({
  rootRef,
  types,
  found,
  ahead,
  more,
  onMore,
  onChoose,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  types: TypeView[];
  found: ReturnType<typeof searchTypes>;
  ahead: boolean;
  more: boolean;
  onMore: () => void;
  onChoose: (t: TypeView) => void;
}) {
  const FIRST = 6;
  const shown = more ? found.hits : found.hits.slice(0, FIRST);
  const rest = found.hits.length - shown.length;
  const listRef = useRef<HTMLUListElement>(null);
  const reveal = useRevealFocus(listRef, "button");
  const general = GENERAL_KEYS.map(k => types.find(t => t.key === k)).filter(
    (t): t is TypeView => Boolean(t),
  );
  return (
    <div className="rq-results" ref={rootRef}>
      {shown.length ? (
        <ul className="rq-rows" ref={listRef}>
          {shown.map(h => (
            <li key={h.type.key}>
              <TypeRow
                type={h.type}
                named
                terms={found.words}
                via={h.via}
                ahead={ahead}
                onChoose={onChoose}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {rest > 0 ? (
        <button
          type="button"
          className="rq-btn rq-btn-ghost rq-btn-sm rq-more"
          onClick={() => {
            reveal(shown.length);
            onMore();
          }}
        >
          Show the other {rest}
        </button>
      ) : null}
      <div className="rq-notit">
        <Signpost aria-hidden />
        <div>
          <p>
            <strong>{shown.length ? "Not it?" : "Nothing fits?"}</strong> Pick
            the general request closest to it, or ask the systems manager.
          </p>
          {general.length ? (
            <ul className="rq-notit-list">
              {general.map(t => (
                <li key={t.key}>
                  <button
                    type="button"
                    className="rq-inline"
                    onClick={() => onChoose(t)}
                  >
                    <Mark name={teamLook(t.team).icon} />
                    {t.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// --- The chosen request ------------------------------------------------------

/** The chosen request's plate: its mark, where it goes, its name and line. */
function Plate({
  type,
  plateRef,
  ahead,
  onChange,
}: {
  type: TypeView;
  plateRef: RefObject<HTMLHeadingElement | null>;
  /**
   * Requests are not open to the seat: the reach words name the deciding
   * question, as the route under it does (review T2-clarity-04).
   */
  ahead: boolean;
  onChange: () => void;
}) {
  const look = typeLook(type, ahead);
  const id = useId();
  return (
    <section className="rq-plate" aria-labelledby={id}>
      <Seal icon={look.icon} size="lg" />
      <div className="rq-plate-text">
        <p className="rq-plate-kicker" id={`${id}-reach`}>
          <Reach pieces={reachPieces(type, ahead)} />
        </p>
        {/* Focused after a pick: it says where the request goes and what it
            is for as its description (review A11Y-10). */}
        <h3
          id={id}
          ref={plateRef}
          tabIndex={-1}
          className="rq-plate-name"
          aria-describedby={
            look.line ? `${id}-reach ${id}-line` : `${id}-reach`
          }
        >
          {type.label}
        </h3>
        {look.line ? (
          <p className="rq-plate-line" id={`${id}-line`}>
            {look.line}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="rq-btn rq-btn-outline rq-btn-sm"
        aria-describedby={id}
        onClick={onChange}
      >
        Change
      </button>
    </section>
  );
}

function Labelled({
  id,
  label,
  optional,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  help?: string | null;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="rq-field">
      <label className="rq-label" htmlFor={id}>
        {label}
        {optional ? <span className="rq-optional"> (optional)</span> : null}
      </label>
      {children}
      <Note id={`${id}-note`} help={help} error={error} />
    </div>
  );
}

/** A field's note: its error in ink with a red mark, else its help. */
function Note({
  id,
  help,
  error,
}: {
  id: string;
  help?: string | null;
  error?: string | null;
}) {
  if (error)
    return (
      <p id={id} className="rq-error">
        <CircleAlert aria-hidden />
        <span>{error}</span>
      </p>
    );
  if (help)
    return (
      <p id={id} className="rq-help">
        {help}
      </p>
    );
  return null;
}

/** The client: picked from the cards this seat may raise a request for. */
function ClientPicker({
  field,
  baseId,
  locked,
  lockedHelp,
  picked,
  onPick,
  error,
}: {
  field: FieldView;
  baseId: string;
  locked: { taskId: string; name: string } | null;
  /** Why the client is fixed: the page's, or the old ticket's or link's. */
  lockedHelp: string;
  picked: { taskId: string; name: string } | null;
  onPick: (c: { taskId: string; name: string } | null) => void;
  error: string | null;
}) {
  const seat = useTaskSeat();
  const id = `${baseId}-client`;
  const [search, setSearch] = useState("");
  const [stopped, setStopped] = useState(false);
  const [all, setAll] = useState(false);
  // An optional client opens its list once the search is used, so a
  // request that needs no client stays short.
  const [browsing, setBrowsing] = useState(field.required);
  // Each read keeps the search and the stopped switch it was for, so its
  // count is never said for a newer search (review T3-a11y-behaviour-01).
  const [found, setFound] = useState<Load<{
    clients: ClientOption[];
    more: boolean;
    q: string;
    stopped: boolean;
  }> | null>(null);
  const [pickedStatus, setPickedStatus] = useState<string | null>(null);
  // The count is said aloud only once the person types; until then it is
  // the search's description (review A11Y-08).
  const [typed, setTyped] = useState(false);
  const seq = useRef(0);
  const open = !locked && !picked && browsing;
  // The pressed control goes with the press: focus moves to what replaces
  // it (the picked client's Change, or the search after Change).
  const changeRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const after = useRef<"change" | "search" | null>(null);
  useEffect(() => {
    const next = after.current;
    if (!next) return;
    after.current = null;
    (next === "change" ? changeRef.current : searchRef.current)?.focus();
  });
  const listRef = useRef<HTMLUListElement>(null);
  const reveal = useRevealFocus(listRef, "button");

  useEffect(() => {
    if (!open || !seat.client) return;
    const n = ++seq.current;
    const client = seat.client;
    setFound(f => (f?.status === "ready" ? f : { status: "loading" }));
    const timer = setTimeout(async () => {
      try {
        const data = await readRequestClients(client, search, stopped);
        if (n === seq.current)
          setFound({ status: "ready", data: { ...data, q: search, stopped } });
      } catch (e) {
        if (n === seq.current)
          setFound({ status: "error", error: errorWords(e) });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [open, seat.client, search, stopped]);

  if (locked)
    return (
      <div className="rq-field">
        <p className="rq-label">{field.label}</p>
        <div className="rq-client">
          <Lock aria-hidden className="rq-client-lock" />
          {/* The name isolated inside a span that takes the row, so an
              Arabic name starts where every name starts (review D9). */}
          <span className="rq-client-name">
            <bdi dir="auto">
              {locked.name || `Client card ${locked.taskId}`}
            </bdi>
          </span>
        </div>
        <p className="rq-help">{lockedHelp}</p>
      </div>
    );

  if (picked)
    return (
      <div className="rq-field">
        <p className="rq-label">{field.label}</p>
        <div className="rq-client">
          <span className="rq-client-name">
            <bdi id={`${id}-picked`} dir="auto">
              {picked.name}
            </bdi>
          </span>
          {pickedStatus ? (
            <span className="rq-client-status" id={`${id}-status`}>
              {pickedStatus}
            </span>
          ) : null}
          {/* Named apart from the plate's Change, and described by the
              client and its status, so the field and the client's state are
              said with it (review T2-a11y-02). */}
          <button
            ref={changeRef}
            type="button"
            className="rq-btn rq-btn-ghost rq-btn-sm"
            aria-label="Change client"
            aria-describedby={
              pickedStatus ? `${id}-picked ${id}-status` : `${id}-picked`
            }
            onClick={() => {
              setPickedStatus(null);
              after.current = "search";
              onPick(null);
            }}
          >
            Change
          </button>
        </div>
      </div>
    );

  const FIRST = 8;
  const clients = found?.status === "ready" ? found.data.clients : [];
  const shown = all ? clients : clients.slice(0, FIRST);
  // The count's words follow the search its read was for: shown while a
  // newer read waits, said only once the read for what is typed lands.
  const total = clients.length;
  const count =
    found?.status === "ready"
      ? total
        ? found.data.more
          ? "More clients match. Type more of the name."
          : found.data.q.trim()
            ? `${total} client${total === 1 ? " matches" : "s match"}.`
            : `${total} client${total === 1 ? "" : "s"}.`
        : REQUEST_SENTENCES.noClients
      : "";
  const settled =
    found?.status === "ready" &&
    found.data.q === search &&
    found.data.stopped === stopped;
  const described = [
    error || field.help ? `${id}-note` : "",
    browsing ? `${id}-count` : "",
  ]
    .filter(Boolean)
    .join(" ");
  // The note sits right under the search, before the list, so an error is
  // next to its field (review A11Y-13).
  return (
    <div className="rq-field">
      <label className="rq-label" htmlFor={id}>
        {field.label}
        {field.required ? null : (
          <span className="rq-optional"> (optional)</span>
        )}
      </label>
      <div className="rq-search">
        <Search aria-hidden className="rq-search-icon rq-search-icon-sm" />
        <input
          ref={searchRef}
          id={id}
          data-field={field.key}
          type="search"
          dir="auto"
          className="rq-input rq-search-input rq-search-client"
          placeholder="Search the client cards"
          value={search}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-required={field.required || undefined}
          aria-describedby={described || undefined}
          onFocus={() => setBrowsing(true)}
          onChange={e => {
            setBrowsing(true);
            setTyped(true);
            setAll(false);
            setSearch(e.target.value);
          }}
        />
      </div>
      <Note id={`${id}-note`} help={field.help} error={error} />
      {browsing ? (
        <div className="rq-clients">
          <label className="rq-check">
            <input
              type="checkbox"
              checked={stopped}
              onChange={e => setStopped(e.target.checked)}
            />
            Show stopped clients
          </label>
          {!found || found.status === "loading" ? (
            <Waiting text="Reading the client cards" live={false} />
          ) : found.status === "error" ? (
            <p className="rq-error">
              <CircleAlert aria-hidden />
              <span>{found.error}</span>
            </p>
          ) : clients.length ? (
            <ul className="rq-client-list" ref={listRef}>
              {shown.map(c => (
                <li key={c.taskId}>
                  <button
                    type="button"
                    className="rq-client-option"
                    onClick={() => {
                      setPickedStatus(c.status);
                      after.current = "change";
                      onPick({ taskId: c.taskId, name: c.name });
                    }}
                  >
                    <span className="rq-client-name">
                      <bdi dir="auto">{c.name}</bdi>
                    </span>
                    {c.status ? (
                      <span className="rq-client-status">{c.status}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {clients.length > shown.length ? (
            <button
              type="button"
              className="rq-btn rq-btn-ghost rq-btn-sm rq-more"
              onClick={() => {
                reveal(shown.length);
                setAll(true);
              }}
            >
              Show the other {clients.length - shown.length}
            </button>
          ) : null}
          {/* The list is not read out as it changes; this line is, once
              the person types. */}
          <p
            id={`${id}-count`}
            className={found?.status === "ready" ? "rq-count" : "rq-sr"}
          >
            {count}
          </p>
          <p className="rq-sr" role="status">
            {typed && settled ? count : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** One question of the chosen type, in the control its choices call for. */
function Question({
  type,
  field,
  baseId,
  value,
  onChange,
  error,
}: {
  type: TypeView;
  field: FieldView;
  baseId: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  if (field.kind === "select" && choiceControl(field) !== "select")
    return (
      <ChoiceField
        type={type}
        field={field}
        baseId={baseId}
        value={value}
        onChange={onChange}
        error={error}
      />
    );
  return (
    <FieldInput
      field={field}
      baseId={baseId}
      value={value}
      onChange={onChange}
      error={error}
    />
  );
}

/**
 * A choice as pills (up to five short ones) or a list of radios (up to ten):
 * native radios, the chosen one marked by React's own state. The question
 * that decides where it goes says so, and each choice names the team it
 * reaches. An optional choice can be cleared.
 */
function ChoiceField({
  type,
  field,
  baseId,
  value,
  onChange,
  error,
}: {
  type: TypeView;
  field: FieldView;
  baseId: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  const id = `${baseId}-${field.key}`;
  const options = field.options ?? [];
  const control = choiceControl(field);
  const deciding =
    routesKnown(type) && routingFields(type).some(f => f.key === field.key);
  const teamLines = deciding ? answerTeamLines(type, field) : null;
  const decides = deciding
    ? teamLines
      ? "Decides where it goes"
      : "Decides which task it makes"
    : null;
  const at = options.findIndex(o => o.id === value);
  const focusAt = at >= 0 ? at : 0;
  // Clear goes with the press: focus moves to the question's first choice.
  const groupRef = useRef<HTMLDivElement>(null);
  const cleared = useRef(false);
  useEffect(() => {
    if (!cleared.current) return;
    cleared.current = false;
    groupRef.current
      ?.querySelector<HTMLElement>(`[data-field="${field.key}"]`)
      ?.focus();
  });
  const described = [
    decides ? `${id}-decides` : "",
    error || field.help ? `${id}-note` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="rq-field" data-question={field.key}>
      <div className="rq-qhead">
        <p className="rq-label" id={`${id}-label`}>
          {field.label}
          {field.required ? null : (
            <span className="rq-optional"> (optional)</span>
          )}
        </p>
        {decides ? (
          <span className="rq-decides" id={`${id}-decides`}>
            <Split aria-hidden />
            {decides}
          </span>
        ) : null}
        {!field.required && value ? (
          <button
            type="button"
            className="rq-clear"
            aria-label={`Clear ${field.label}`}
            onClick={() => {
              cleared.current = true;
              onChange("");
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
      <div
        ref={groupRef}
        role="radiogroup"
        className={control === "pills" ? "rq-choices" : "rq-radios"}
        data-lines={teamLines ? 2 : undefined}
        aria-labelledby={`${id}-label`}
        aria-describedby={described || undefined}
        aria-required={field.required || undefined}
        aria-invalid={error ? true : undefined}
      >
        {options.map((o, i) => (
          <label
            key={o.id}
            className="rq-choice"
            data-on={o.id === value || undefined}
          >
            <input
              type="radio"
              className="rq-choice-input"
              name={id}
              value={o.id}
              checked={o.id === value}
              data-field={i === focusAt ? field.key : undefined}
              aria-invalid={error ? true : undefined}
              // On each radio too: a screen reader reads the focused
              // control's description, not reliably its group's (A11Y-07).
              aria-describedby={described || undefined}
              onChange={() => onChange(o.id)}
            />
            <span className="rq-choice-face">
              {control === "radios" ? (
                <span className="rq-radio-dot" aria-hidden />
              ) : (
                <Check aria-hidden className="rq-tick" />
              )}
              <span className="rq-choice-text">
                <span className="rq-choice-name">{o.name}</span>
                {teamLines?.[o.id] ? (
                  <span className="rq-choice-team">{teamLines[o.id]}</span>
                ) : null}
              </span>
            </span>
          </label>
        ))}
      </div>
      <Note id={`${id}-note`} help={field.help} error={error} />
    </div>
  );
}

/** A question answered in words, a link, a number, or the native select. */
function FieldInput({
  field,
  baseId,
  value,
  onChange,
  error,
}: {
  field: FieldView;
  baseId: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  const id = `${baseId}-${field.key}`;
  const missingChoice =
    field.kind === "select" && (field.options?.length ?? 0) === 0;
  // A choice ClickUp lost says why under it, and that sentence describes the
  // select it explains (review A11Y-21).
  const help = missingChoice ? REQUEST_SENTENCES.missingChoice : field.help;
  const common = {
    id,
    "data-field": field.key,
    "aria-invalid": error ? true : undefined,
    "aria-required": field.required || undefined,
    "aria-describedby": error || help ? `${id}-note` : undefined,
  } as const;
  let input: ReactNode;
  if (field.kind === "longtext" || field.kind === "details")
    input = (
      <textarea
        {...common}
        className="rq-input rq-textarea"
        dir="auto"
        rows={3}
        maxLength={LIMITS.longtext}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    );
  else if (field.kind === "select")
    input = (
      <select
        {...common}
        className="rq-input rq-select"
        value={value}
        // Not disabled: a required choice ClickUp lost still takes focus
        // from the error summary, with its sentence (review A11Y-21).
        aria-disabled={missingChoice || undefined}
        onChange={e => {
          if (!missingChoice) onChange(e.target.value);
        }}
      >
        <option value="">{missingChoice ? "Not available" : "Pick one"}</option>
        {(field.options ?? []).map(o => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    );
  else
    input = (
      <input
        {...common}
        className="rq-input"
        dir={field.kind === "text" ? "auto" : undefined}
        type={
          field.kind === "url"
            ? "url"
            : field.kind === "number"
              ? "number"
              : "text"
        }
        inputMode={field.kind === "number" ? "numeric" : undefined}
        min={field.kind === "number" ? 0 : undefined}
        max={field.kind === "number" ? LIMITS.number : undefined}
        step={field.kind === "number" ? 1 : undefined}
        maxLength={field.kind === "text" ? LIMITS.text : undefined}
        placeholder={field.kind === "url" ? "https://" : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    );
  return (
    <Labelled
      id={id}
      label={field.label}
      optional={!field.required}
      help={help}
      error={error}
    >
      {input}
    </Labelled>
  );
}

/**
 * Due: the usual day and the next working day as two choices, and "Pick a
 * day", which opens the native date input. That input is always on the page,
 * with the due day in it, and shows whenever a day is picked by hand, or
 * when the day carried in matches neither choice.
 */
function DueField({
  type,
  baseId,
  dueOn,
  today,
  onChange,
  error,
}: {
  type: TypeView;
  baseId: string;
  dueOn: string;
  today: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  const due = dueField(type);
  const choices = dueChoices(type.dueDefault, today);
  const quick = choices.some(c => c.iso === dueOn);
  const [picking, setPicking] = useState(!quick);
  if (!due) return null;
  const id = `${baseId}-due`;
  const showDate = picking || !quick || Boolean(error);
  const usualDays = `${
    type.dueDays <= 0
      ? "The same day"
      : `${type.dueDays} working day${type.dueDays === 1 ? "" : "s"}`
  } is the usual for this type. Working days are Sunday to Thursday`;
  const usual = `${usualDays}, Kuwait time.`;
  return (
    <div className="rq-field" data-question={due.key}>
      <p className="rq-label" id={`${id}-label`}>
        {due.label}
      </p>
      <div
        role="radiogroup"
        className="rq-choices rq-due"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-note`}
      >
        {choices.map(c => (
          <label
            key={c.iso}
            className="rq-choice rq-day"
            data-on={(!showDate && c.iso === dueOn) || undefined}
          >
            <input
              type="radio"
              className="rq-choice-input"
              name={id}
              checked={!showDate && c.iso === dueOn}
              onChange={() => {
                setPicking(false);
                onChange(c.iso);
              }}
            />
            <span className="rq-choice-face">
              <Check aria-hidden className="rq-tick" />
              <span className="rq-choice-text rq-day-text">
                <span className="rq-day-date">{dayLabel(c.iso, today)}</span>
                <span className="rq-day-tag">{c.tag}</span>
              </span>
            </span>
          </label>
        ))}
        <label className="rq-choice rq-day" data-on={showDate || undefined}>
          <input
            type="radio"
            className="rq-choice-input"
            name={id}
            checked={showDate}
            onChange={() => setPicking(true)}
          />
          <span className="rq-choice-face">
            {showDate ? (
              <Check aria-hidden className="rq-tick" />
            ) : (
              <CalendarDays aria-hidden className="rq-day-icon" />
            )}
            <span className="rq-day-date" id={`${id}-pick`}>
              Pick a day
            </span>
          </span>
        </label>
      </div>
      <div className="rq-date" hidden={!showDate}>
        <input
          id={`${id}-day`}
          data-field={due.key}
          type="date"
          className="rq-input rq-date-input"
          value={dueOn}
          min={today}
          required={due.required}
          aria-labelledby={`${id}-label ${id}-pick`}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-note`}
          onChange={e => onChange(e.target.value)}
        />
      </div>
      <Note
        id={`${id}-note`}
        error={error}
        help={
          // "Kuwait time" said once (review D16, CL-11).
          showDate && dueOn
            ? `${dayLabel(dueOn, today)}, Kuwait time. ${usualDays}.`
            : usual
        }
      />
    </div>
  );
}

/** Priority: four pills, the type's own marked "usual". */
function PriorityField({
  type,
  baseId,
  value,
  onChange,
}: {
  type: TypeView;
  baseId: string;
  value: Priority;
  onChange: (p: Priority) => void;
}) {
  const prio = priorityField(type);
  if (!prio) return null;
  const id = `${baseId}-priority`;
  return (
    <div className="rq-field" data-question={prio.key}>
      <p className="rq-label" id={`${id}-label`}>
        {prio.label}
      </p>
      <div
        role="radiogroup"
        className="rq-choices rq-prio"
        aria-labelledby={`${id}-label`}
      >
        {PRIORITIES.map(p => (
          <label
            key={p.key}
            className="rq-choice"
            data-on={p.key === value || undefined}
          >
            <input
              type="radio"
              className="rq-choice-input"
              name={id}
              value={p.key}
              checked={p.key === value}
              data-field={p.key === value ? prio.key : undefined}
              onChange={() => onChange(p.key)}
            />
            <span className="rq-choice-face">
              <Check aria-hidden className="rq-tick" />
              <span className="rq-choice-text">
                <span className="rq-choice-name">{p.label}</span>
              </span>
              {p.key === type.priority ? (
                <span className="rq-usual">usual</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

// --- The route (the signature) -----------------------------------------------

/** A task name with only its client in its own direction. */
function TaskName({ name, client }: { name: string; client?: string | null }) {
  const parts = taskNameParts(name, client);
  if (!parts) return <bdi dir="auto">{name}</bdi>;
  return (
    <>
      <bdi dir="auto">{parts.client}</bdi>
      {parts.rest}
    </>
  );
}

/** One stop on the route: its mark, a short kicker, its words. */
function Stop({
  mark,
  kicker,
  children,
  kind,
}: {
  mark: ReactNode;
  kicker: string;
  children: ReactNode;
  kind?: string;
}) {
  return (
    <li className="rq-stop" data-kind={kind}>
      <span className="rq-stop-mark" aria-hidden>
        {mark}
      </span>
      <div className="rq-stop-body">
        <p className="rq-stop-when">{kicker}</p>
        {children}
      </div>
    </li>
  );
}

/** What the owner works from: the template, or the SOP steps as a checklist. */
function Works({ works }: { works: LaneWorks }) {
  const [all, setAll] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const reveal = useRevealFocus(listRef, null);
  if (works.kind === "template") return <>{ROUTE_WORDS.template(works.name)}</>;
  const FIRST = 2;
  const steps = works.steps ?? [];
  const shown = all ? steps : steps.slice(0, FIRST);
  return (
    <>
      <span className="rq-works-count">
        {ROUTE_WORDS.stepsAdded(works.count)}
      </span>
      {shown.length ? (
        <ol className="rq-steps" ref={listRef}>
          {shown.map((s, i) => (
            // The first step the press showed takes focus, so it is read.
            <li key={`${i}-${s}`} tabIndex={i === FIRST ? -1 : undefined}>
              {s}
            </li>
          ))}
        </ol>
      ) : null}
      {steps.length > shown.length ? (
        <button
          type="button"
          className="rq-inline rq-steps-more"
          onClick={() => {
            reveal(FIRST);
            setAll(true);
          }}
        >
          Show the other {steps.length - shown.length}
        </button>
      ) : null}
      {works.draft ? (
        <span className="rq-quiet-note">{ROUTE_WORDS.draft}</span>
      ) : null}
    </>
  );
}

/** One department's lane on the route, before Send. */
function Lane({
  lane,
  timing,
  client,
  ahead,
}: {
  lane: RouteLane;
  timing: string;
  client: string | null;
  /** Requests are not open to the seat: no timing, and no client asked. */
  ahead: boolean;
}) {
  return (
    <>
      <span className="rq-stop-mark rq-seal" data-kind={lane.kind} aria-hidden>
        <Mark name={teamLook(lane.team).icon} />
      </span>
      <div className="rq-stop-body">
        {/* "Goes to" is said once to a screen reader, by the lane's name. */}
        <p
          className="rq-stop-when rq-lane-when"
          aria-hidden={
            (timing === ROUTE_WORDS.goesTo && lane.kind === "plan") || undefined
          }
        >
          {lane.kind === "may" ? ROUTE_WORDS.may : timing}
        </p>
        <p className="rq-lane-name">
          {lane.kind === "plan" ? (
            <span className="rq-sr">Goes to </span>
          ) : null}
          {lane.listName}
        </p>
        {lane.condition ? <p className="rq-lane-if">{lane.condition}</p> : null}
        <dl className="rq-facts-dl">
          <div>
            <dt>Task</dt>
            <dd>
              {lane.taskName ? (
                <q>
                  <TaskName name={lane.taskName} client={client} />
                </q>
              ) : (
                <span className="rq-quiet-note">
                  {ahead ? ROUTE_WORDS.namedForClient : ROUTE_WORDS.pickClient}
                </span>
              )}
            </dd>
          </div>
          {lane.owner ? (
            <div>
              <dt>Owner</dt>
              <dd>
                {lane.owner.label}
                {lane.owner.note ? (
                  <span className="rq-quiet-note">{lane.owner.note}</span>
                ) : null}
              </dd>
            </div>
          ) : null}
          {lane.works ? (
            <div>
              <dt>Works from</dt>
              <dd>
                <Works works={lane.works} />
              </dd>
            </div>
          ) : lane.byAnswer?.length ? (
            <div>
              <dt>Works from</dt>
              <dd>
                {/* One task per answer, said once: what each one works
                    from, by the answer (review D7). */}
                {lane.byAnswer.map(b => (
                  <span key={b.answer} className="rq-works-by">
                    <span className="rq-works-answer">{b.answer}:</span>{" "}
                    {b.works ? <Works works={b.works} /> : null}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </>
  );
}

/** The lanes: side by side for exactly two, else one under the other. */
function Lanes<L extends { part: string; kind?: string }>({
  layout,
  lanes,
  fork,
  render,
}: {
  layout: "pair" | "stack";
  lanes: L[];
  fork: string;
  render: (lane: L) => ReactNode;
}) {
  if (layout === "pair")
    return (
      <li
        className="rq-stop rq-stop-fork"
        data-n={lanes.length}
        data-kind={lanes.every(l => l.kind === "may") ? "may" : undefined}
      >
        <div className="rq-lanes">
          <p className="rq-fork-note rq-stop-when">{fork}</p>
          {lanes.map(l => (
            <div
              key={l.part}
              className="rq-lane rq-route-line"
              data-kind={l.kind}
            >
              {render(l)}
            </div>
          ))}
        </div>
      </li>
    );
  return (
    <>
      {lanes.map(l => (
        <li key={l.part} className="rq-stop rq-route-line" data-kind={l.kind}>
          {render(l)}
        </li>
      ))}
    </>
  );
}

/** What happens next, before Send: the route of stops. */
function RouteView({
  type,
  preview,
  choicePreviews,
  readFor,
  client,
  busy,
  dueOn,
  priority,
  held,
  heldNote,
  wait,
  ahead = false,
  blocked = false,
}: {
  type: TypeView;
  preview: Load<RoutePreview> | null;
  choicePreviews: Record<string, RoutePart[]> | null;
  /** What the shown preview was read for (review BT-4). */
  readFor: { choices: Record<string, string>; client: string | null } | null;
  client: { taskId: string; name: string } | null;
  busy: boolean;
  dueOn: string;
  priority: Priority;
  held: boolean;
  heldNote: string | null;
  /** When a held request goes, in the gate's words (heldWait). */
  wait: HeldWait;
  /** Requests are not open to this seat: where it would go, nothing else. */
  ahead?: boolean;
  /**
   * A required choice ClickUp lost: the request cannot be sent here, so the
   * route says only where it would go, as while requests are not open to
   * the seat, with the questions still on the page (T3-design-clarity-05).
   */
  blocked?: boolean;
}) {
  const id = useId();
  const ready = preview?.status === "ready" ? preview.data : null;
  // Drawn from the answers and the client the preview was read for, so the
  // lanes and the summary change only when its successor lands (BT-4).
  const model: RouteModel | null = ready
    ? routeModel({
        type,
        preview: ready,
        choicePreviews,
        answers: readFor?.choices ?? {},
        clientPicked: Boolean(readFor?.client),
        ahead,
      })
    : null;
  // The timing words only while requests are open to the seat (6.7): held,
  // "When requests open" ("Waits for the writer" while it is quiet); not
  // open to the seat at all, or not sendable here, none ("Goes to").
  const still = ahead || blocked;
  // Nothing is saved for a request that cannot be sent here.
  const keep = held && !blocked;
  const timing = still
    ? ROUTE_WORDS.goesTo
    : held
      ? wait === "open"
        ? ROUTE_WORDS.whenOpen
        : ROUTE_WORDS.whenQuiet
      : ROUTE_WORDS.soon;
  const fork = model?.lanes.some(l => l.kind === "may")
    ? ahead
      ? ROUTE_WORDS.dependsOnAnswer
      : "By your answer"
    : still
      ? countWords(model?.lanes.length ?? 0, "task")
      : timing;
  // The one polite line says only a settled answer; the first read's wait
  // shows, unsaid, in its place (review A11Y-08).
  const status =
    !preview || preview.status === "loading"
      ? ""
      : preview.status === "error"
        ? preview.error
        : model?.summary
          ? `${model.summary}${keep && model.lanes.length ? `, saved ${ROUTE_WORDS.savedUntil(wait)}` : ""}`
          : "";
  return (
    <section
      className="rq-next"
      aria-labelledby={id}
      aria-busy={busy || undefined}
      data-busy={busy || undefined}
    >
      <div className="rq-next-head">
        <h3 id={id} className="rq-kicker">
          {still ? ROUTE_WORDS.whereItGoes : "What happens next"}
        </h3>
        {preview?.status === "loading" ? (
          <p className="rq-route-wait" aria-hidden>
            {REQUEST_SENTENCES.previewWaiting}
          </p>
        ) : null}
        <p className={status ? "rq-route-sum" : "rq-sr"} role="status">
          {status}
        </p>
      </div>
      {model ? (
        <ol className="rq-stops">
          {still ? null : (
            <Stop mark={<Send />} kicker="Now" kind="send">
              <p className="rq-stop-text">
                {held ? ROUTE_WORDS.nowHeld : ROUTE_WORDS.now}
              </p>
            </Stop>
          )}
          {keep ? (
            <Stop mark={<Clock />} kicker={ROUTE_WORDS.heldTitle} kind="held">
              <p className="rq-stop-text">{ROUTE_WORDS.heldText}</p>
              {heldNote ? <p className="rq-quiet-note">{heldNote}</p> : null}
            </Stop>
          ) : null}
          {model.decision ? (
            <Stop
              mark={<span className="rq-diamond" />}
              kicker="Your answer"
              kind="decision"
            >
              <p className="rq-stop-text">
                {model.decision.question}{" "}
                <strong>{model.decision.answer}</strong>
              </p>
            </Stop>
          ) : null}
          {model.lanes.length ? (
            <Lanes
              layout={model.layout}
              lanes={model.lanes}
              fork={fork}
              render={lane => (
                <Lane
                  lane={lane}
                  timing={lane.kind === "may" ? ROUTE_WORDS.may : timing}
                  client={client?.name ?? null}
                  ahead={ahead}
                />
              )}
            />
          ) : (
            <Stop mark={<Split />} kicker="Then" kind="note">
              <p className="rq-stop-text">
                {model.note ?? REQUEST_SENTENCES.previewFailed}
              </p>
            </Stop>
          )}
          {type.sopUrl ? (
            <Stop mark={<BookOpen />} kicker="How they do it" kind="sop">
              <a
                className="rq-sop"
                href={type.sopUrl}
                target="_blank"
                rel="noreferrer"
              >
                {ROUTE_WORDS.sopLink}
                <NewTab />
                <ArrowUpRight aria-hidden />
              </a>
            </Stop>
          ) : null}
          {still ? null : (
            <>
              {/* The day is said here once; a held request's kept due day
                  is its quiet note (review CL-13, T3-design-clarity-04). */}
              <Stop mark={<CalendarDays />} kicker="Due" kind="due">
                <p className="rq-stop-text">
                  {dueOn ? `${dayLabel(dueOn)}, ` : ""}
                  {priority} priority
                </p>
                {held && dueOn ? (
                  <p className="rq-quiet-note">{ROUTE_WORDS.heldDue}</p>
                ) : null}
              </Stop>
              <Stop mark={<Bell />} kicker="After that" kind="bell">
                <p className="rq-stop-text">{ROUTE_WORDS.bell}</p>
                <p className="rq-quiet-note">
                  {held ? ROUTE_WORDS.bellAfterHeld : ROUTE_WORDS.bellAfter}
                </p>
              </Stop>
            </>
          )}
        </ol>
      ) : null}
      <ul className="rq-truths">
        <li>{ROUTE_WORDS.byRule}</li>
        {clientField(type) ? <li>{ROUTE_WORDS.noClient}</li> : null}
        {still ? null : <li>{ROUTE_WORDS.cancel}</li>}
      </ul>
    </section>
  );
}

/** Under the questions: the error summary, a refusal, and the one button. */
function SendBlock({
  errors,
  order,
  lost,
  hand,
  announce,
  formError,
  held,
  wait,
  sending,
  onSend,
  onFix,
}: {
  errors: Record<string, string>;
  order: string[];
  /** Required choices ClickUp lost: the request cannot be sent here. */
  lost: FieldView[];
  /**
   * The lists in ClickUp where the request can be made by hand (handLists):
   * every list its tasks go to, each with its link (none for a list that is
   * not one of the five).
   */
  hand: { lists: { name: string; url: string | null }[]; each: boolean };
  /** The press's summary, said once through the polite line below. */
  announce: string;
  formError: string | null;
  held: boolean;
  /** When a held request goes, in the gate's words (heldWait). */
  wait: HeldWait;
  sending: boolean;
  onSend: () => void;
  onFix: (key: string) => void;
}) {
  const id = useId();
  const keys = [
    ...order.filter(k => errors[k]),
    ...Object.keys(errors).filter(k => !order.includes(k)),
  ];
  const blocked = lost.length > 0;
  return (
    <div className="rq-send">
      {/* On the page before any press, and filled only once focus is on the
          first answer to fix, so a press's summary is said once, politely,
          after that field says its own error; the visible summary is not
          live, so each fix shrinks it quietly (review A11Y-02). */}
      <p className="rq-sr" role="status">
        {announce}
      </p>
      {keys.length ? (
        <div className="rq-alert rq-summary">
          <CircleAlert aria-hidden />
          <div>
            <p>
              {summaryLead(
                keys,
                lost.map(f => f.key),
              )}
            </p>
            <ul>
              {keys.map(k => (
                <li key={k}>
                  <button
                    type="button"
                    className="rq-inline"
                    onClick={() => onFix(k)}
                  >
                    {errors[k]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {formError ? (
        <div className="rq-alert" role="alert">
          <CircleAlert aria-hidden />
          <p>{formError}</p>
        </div>
      ) : null}
      {/* On the page before any press: tell the systems manager, or, when
          it cannot wait, make it on the lists its tasks go to in ClickUp,
          every one named (the lost answer may be what picks among them),
          one outlined link per list beside the outlined Send (review
          T3-design-clarity-05; clickup-diet-1029). */}
      {blocked ? (
        <div className="rq-off rq-blocked">
          <CircleAlert aria-hidden />
          <div>
            <p id={`${id}-blocked`}>
              {REQUEST_SENTENCES.lostBlocked(
                lost[0].label,
                hand.lists.map(l => l.name),
                hand.each,
              )}
            </p>
            {hand.lists.map(l =>
              l.url ? (
                <a
                  key={l.name}
                  className="rq-btn rq-btn-outline rq-off-action"
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open the {l.name} list in ClickUp
                  <NewTab />
                  <ArrowUpRight aria-hidden />
                </a>
              ) : null,
            )}
          </div>
        </div>
      ) : null}
      <div className="rq-actions">
        <button
          type="button"
          className={`rq-btn ${blocked ? "rq-btn-outline" : "rq-btn-primary"}`}
          aria-describedby={blocked ? `${id}-blocked` : undefined}
          data-state={sending ? "loading" : undefined}
          aria-busy={sending || undefined}
          // Not disabled while it sends, so focus stays on it; a second
          // press does nothing (send() holds one press at a time).
          aria-disabled={sending || undefined}
          onClick={onSend}
        >
          {sending ? (
            <>
              <LoaderCircle aria-hidden className="rq-spin" />
              {held ? "Saving" : "Sending"}
            </>
          ) : held ? (
            "Save request"
          ) : (
            "Send request"
          )}
        </button>
        {held ? (
          <span className="rq-hint">
            <Clock aria-hidden />
            Saved here {ROUTE_WORDS.savedUntil(wait)}.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * In place of the questions while requests cannot be sent from this seat
 * (2.8). Since 20261029p the database holds every seat's request rather
 * than refuse it, so this shows only on a database that still refuses; it
 * names no ClickUp form, as there is none to go to. Above the map it is a
 * status; in place of the questions it is a group named by its sentence and
 * described by the line under it, which the form moves focus to when it
 * replaces the questions partway through (`focusRef`; review
 * T3-a11y-behaviour-02), so the reason is never only a status inserted with
 * its words.
 */
function WriterOff({
  note,
  focusRef,
  describedBy,
}: {
  note: string | null;
  focusRef?: RefObject<HTMLDivElement | null>;
  describedBy?: string;
}) {
  const id = useId();
  const words =
    note ??
    "Requests cannot be sent from this seat just now. Tell the systems manager.";
  const body = (
    <>
      <Clock aria-hidden />
      <div>
        <p id={`${id}-words`}>{words}</p>
      </div>
    </>
  );
  if (!focusRef)
    return (
      <div className="rq-off" role="status">
        {body}
      </div>
    );
  return (
    <div
      className="rq-off"
      ref={focusRef}
      tabIndex={-1}
      role="group"
      aria-labelledby={`${id}-words`}
      aria-describedby={describedBy}
    >
      {body}
    </div>
  );
}

// --- After Send: the same route as the tracker -------------------------------

const TONE_ICON = {
  done: CircleCheck,
  moving: CircleDashed,
  checking: CircleDashed,
  held: Clock,
  failed: CircleAlert,
} as const;

/** One department's lane after Send: its sentence, its task, its link. */
function SentLaneView({
  lane,
  client,
}: {
  lane: SentLane;
  client: string | null;
}) {
  // In ClickUp but not finished (its note says what to check): the warning
  // mark in orange, never the success check (review T2-clarity-05).
  const unfinished = lane.state === "done" && Boolean(lane.note);
  const Icon = unfinished ? CircleAlert : TONE_ICON[lane.state];
  return (
    <>
      <span
        className="rq-stop-mark rq-seal"
        data-state={lane.state}
        aria-hidden
      >
        <Mark name={teamLook(lane.team).icon} />
      </span>
      <div className="rq-stop-body">
        <p
          className="rq-sent-line"
          data-state={lane.state}
          data-unfinished={unfinished || undefined}
        >
          <Icon aria-hidden />
          <span>{lane.line}</span>
        </p>
        <p className="rq-lane-task">
          <q>
            <TaskName name={lane.taskName} client={client} />
          </q>
        </p>
        {lane.note ? (
          <p className="rq-quiet-note rq-warn-note">{lane.note}</p>
        ) : null}
        {lane.url ? (
          <a
            className="rq-open"
            href={lane.url}
            target="_blank"
            rel="noreferrer"
            // Two tasks give two such links: each names its list and says
            // it opens a new tab (review A11Y-17).
            aria-label={`Open in ClickUp (${lane.listName}, opens in a new tab)`}
          >
            Open in ClickUp
            <ArrowUpRight aria-hidden />
          </a>
        ) : null}
      </div>
    </>
  );
}

/**
 * What was asked, as a list: the client and each answer. Due and priority
 * are the route's Due stop, said once (review T3-design-clarity-04).
 */
function AnswerList({
  title,
  client,
  fields,
  answers,
}: {
  title: string;
  client: { taskId: string; name: string } | null;
  fields: FieldView[];
  answers: Answers;
}) {
  const id = useId();
  return (
    <section className="rq-answers" aria-labelledby={id}>
      <h4 id={id} className="rq-kicker">
        {title}
      </h4>
      <dl>
        {client ? (
          <div>
            <dt>Client</dt>
            <dd>
              <bdi dir="auto">{client.name}</bdi>
            </dd>
          </div>
        ) : null}
        {fields.map(f => (
          <div key={f.key}>
            <dt>{f.label}</dt>
            <dd>
              <bdi dir="auto">{display(f, answers[f.key])}</bdi>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The sent view: what was asked, where it is now, what happens next. */
function SentView({
  type,
  model,
  sentId,
  client,
  answers,
  dueOn,
  priority,
  sentAt,
  alone,
  checks,
  moving,
  heldNote,
  wait,
  onAgain,
}: {
  type: TypeView;
  model: SentModel;
  sentId: string;
  client: { taskId: string; name: string } | null;
  answers: Answers;
  dueOn: string;
  priority: Priority;
  sentAt: string | null;
  alone: boolean;
  checks: { at: string | null; stopped: boolean };
  moving: boolean;
  heldNote: string | null;
  /** When a held request goes, in the gate's words (heldWait). */
  wait: HeldWait;
  onAgain: () => void;
}) {
  const headRef = useRef<HTMLDivElement>(null);
  const id = useId();
  // The one voice for the event (research 4.1.3): focus to the heading.
  useEffect(() => {
    headRef.current?.focus();
  }, []);
  // A task in ClickUp that is not finished takes the heading's mark to the
  // warning, as My requests' chip does; the heading's words stay (review
  // T2-clarity-05).
  const unfinished =
    model.tone === "done" &&
    model.lanes.some(l => l.state === "done" && l.note);
  const Icon = unfinished ? CircleAlert : TONE_ICON[model.tone];
  const held = model.tone === "held";
  const clock = sentAt ? kuwaitClock(sentAt) : "";
  const asked = bodyFields(type).filter(f => (answers[f.key] ?? "").trim());
  // Where the page's own checking stands: the time of the last read in
  // Geist Mono while it checks, then one sentence once it stops.
  const stamp: { text: string; clock: boolean } | null =
    checks.stopped && moving
      ? { text: ROUTE_WORDS.stillOnItsWay, clock: false }
      : checks.at
        ? moving
          ? { text: ROUTE_WORDS.checked(kuwaitClock(checks.at)), clock: true }
          : { text: ROUTE_WORDS.stopped(kuwaitClock(checks.at)), clock: false }
        : moving && !held
          ? { text: ROUTE_WORDS.checksFor, clock: false }
          : null;
  // The focused block is named by its heading and described by the line
  // under it (which carries a refusal's next step) and the routed-meanwhile
  // note, so each is said with it (review A11Y-09).
  const described = [`${id}-sub`, alone ? `${id}-alone` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className="rq-sent"
      data-tone={model.tone}
      data-unfinished={unfinished || undefined}
    >
      <div className="rq-sent-top">
        <div
          className="rq-sent-head"
          ref={headRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-title`}
          aria-describedby={described}
        >
          <Icon aria-hidden className="rq-sent-icon" />
          <div>
            <h3 className="rq-sent-title" id={`${id}-title`}>
              {model.heading}: {type.label}
              {client ? (
                <>
                  {" "}
                  for <bdi dir="auto">{client.name}</bdi>
                </>
              ) : null}
            </h3>
            {/* Present from the first paint, so a change of state is read
                out once, politely, and whole. A refusal that comes in while
                the page reads the request is said with its next step, which
                the panel below shows (review A11Y-09). */}
            <p
              className="rq-sent-sub"
              id={`${id}-sub`}
              aria-live="polite"
              aria-atomic="true"
            >
              {model.sub}
              {model.next ? <span className="rq-sr"> {model.next}</span> : null}
            </p>
          </div>
        </div>
        {alone ? (
          <p className="rq-off" id={`${id}-alone`}>
            <CircleAlert aria-hidden />
            <span>{REQUEST_SENTENCES.sentAlone}</span>
          </p>
        ) : null}
        {/* The next step in words; "Open the request" (where "File it
            again" is) follows in the actions. */}
        {model.next ? (
          <div className="rq-next-step">
            <CircleAlert aria-hidden />
            <div>
              <p>{model.next}</p>
            </div>
          </div>
        ) : null}
      </div>
      {/* In the page where it is drawn on a phone, under the heading, so the
          Tab order follows the screen; from 880px the grid puts it beside
          (review A11Y-11). */}
      <section className="rq-next rq-tracker" aria-labelledby={`${id}-now`}>
        <div className="rq-next-head">
          <h4 id={`${id}-now`} className="rq-kicker">
            Where it is now
          </h4>
          {stamp ? (
            <p className="rq-stamp" data-clock={stamp.clock || undefined}>
              {stamp.text}
            </p>
          ) : null}
        </div>
        <ol className="rq-stops">
          {/* Saved: one stop, the time and what happened to this request
              (review D6). The writer's sentence before a send is a rule
              ("What you send is saved ..."), so after Save it is kept only
              while the writer is quiet, where it says why it waits and, for
              a lead seat, what to check; the heading's sub-line says when it
              goes, in the same words (review T3-design-clarity-08;
              clickup-diet-1029). */}
          <Stop mark={<Send />} kicker={held ? "Saved" : "Sent"} kind="send">
            <p className="rq-stop-text">
              {clock
                ? held
                  ? ROUTE_WORDS.savedAt(clock)
                  : ROUTE_WORDS.sentAt(clock)
                : held
                  ? "Saved."
                  : "Sent."}
            </p>
            <p className="rq-quiet-note">
              {held
                ? ((wait === "open" ? null : heldNote) ?? ROUTE_WORDS.keptHere)
                : "The cockpit checked it and saved it."}
            </p>
          </Stop>
          <Lanes
            layout={model.layout}
            lanes={model.lanes}
            fork={
              held
                ? wait === "open"
                  ? ROUTE_WORDS.whenOpen
                  : ROUTE_WORDS.whenQuiet
                : model.refused
                  ? countWords(model.lanes.length, "task")
                  : ROUTE_WORDS.sentTogether
            }
            render={lane => (
              <SentLaneView lane={lane} client={client?.name ?? null} />
            )}
          />
          {type.sopUrl ? (
            <Stop mark={<BookOpen />} kicker="How they do it" kind="sop">
              <a
                className="rq-sop"
                href={type.sopUrl}
                target="_blank"
                rel="noreferrer"
              >
                {ROUTE_WORDS.sopLink}
                <NewTab />
                <ArrowUpRight aria-hidden />
              </a>
            </Stop>
          ) : null}
          {/* The due day and priority are said here once, never again in
              "What you asked" (review T3-design-clarity-04). */}
          <Stop mark={<CalendarDays />} kicker="Due" kind="due">
            <p className="rq-stop-text">
              {dueOn ? `${dayLabel(dueOn)}, ` : ""}
              {priority} priority
            </p>
            {held && dueOn ? (
              <p className="rq-quiet-note">{ROUTE_WORDS.heldDue}</p>
            ) : null}
          </Stop>
          <Stop mark={<Bell />} kicker="After that" kind="bell">
            {model.ended ? (
              <>
                <p className="rq-stop-text">{ROUTE_WORDS.endedBell}</p>
                <p className="rq-quiet-note">{ROUTE_WORDS.endedBellNote}</p>
              </>
            ) : (
              <>
                <p className="rq-stop-text">{ROUTE_WORDS.bell}</p>
                <p className="rq-quiet-note">
                  {held ? ROUTE_WORDS.bellAfterHeld : ROUTE_WORDS.bellAfter}
                </p>
              </>
            )}
          </Stop>
        </ol>
      </section>
      <div className="rq-sent-rest">
        {client || asked.length ? (
          <AnswerList
            title="What you asked"
            client={client}
            fields={asked}
            answers={answers}
          />
        ) : null}
        <div className="rq-actions">
          <button
            type="button"
            className="rq-btn rq-btn-outline"
            onClick={onAgain}
          >
            Ask for something else
          </button>
          {model.tone === "failed" ? (
            <PortalLink
              to={`/requests?id=${encodeURIComponent(sentId)}`}
              className="rq-btn rq-btn-ghost"
            >
              Open the request
              <ChevronRight aria-hidden />
            </PortalLink>
          ) : (
            <PortalLink
              to="/requests?view=mine"
              className="rq-btn rq-btn-ghost"
            >
              See it in My requests
              <ChevronRight aria-hidden />
            </PortalLink>
          )}
        </div>
        <ul className="rq-truths">
          <li>{ROUTE_WORDS.byRule}</li>
          {/* Only when a client went with it (review D18). */}
          {clientField(type) && client ? <li>{ROUTE_WORDS.noClient}</li> : null}
          {model.delivered ? (
            <li>{ROUTE_WORDS.changeInClickUp}</li>
          ) : model.ended ? null : (
            <li>{ROUTE_WORDS.cancel}</li>
          )}
        </ul>
      </div>
    </div>
  );
}
