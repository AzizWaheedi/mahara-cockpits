import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTION_DEADLINE_MS, answerBy } from "@/lib/clientMessages";
import type { Timeline } from "@/lib/csmCalls";
import { sessionId } from "@/present/blueprintSaver";
import {
  type CallsAnswer,
  type CallView,
  CheckinError,
  clauseOf,
  type DraftKind,
  type DraftsAnswer,
  type DraftView,
  type EffectView,
  type MoveAnswer,
  OFFLINE,
  type OpenAnswer,
  offline,
  type ReadAnswer,
  type ResponseView,
  type SubmitAnswer,
  type TranscriptAnswer,
} from "./checkinClient";
import {
  type Answers,
  ASK_WHYS,
  type CallAnswer,
  type CheckinSchema,
  CONFIRMED_WHYS,
  callOf,
  callRef,
  checkValue,
  SCHEMA,
  sameValue,
  schemaFrom,
  sendBlock,
  type TodoItem,
  todosOf,
  WHYS,
  type Why,
} from "./checkinForm";
import { STEPS_UNREAD, trailSettled } from "./checkinTrail";
import { type Change, FieldSaver, type SaveResult } from "./fieldSaver";
import type { FormNews } from "./formConfig";

/**
 * The 1-1 notes window's model (docs/forms/STAGE2-CONTRACT.md 8.2 and 8.5):
 * open (this seat's draft for the client, or a new one with the browser's
 * own response ID), the reads beside it (the calls, the drafts, the
 * client's timeline for the rail), the saver, the call's pick and the
 * pasted link, the send, and after it the trail and the recap step.
 *
 * Two rules hold whatever arrives and whenever: drafts fill only We owe,
 * They owe and Client notes, only while the field is empty and untouched,
 * and only as unsaved drafts (saved with their `from` on the first edit or
 * on Send); DEFCON and priority change only on a click, a choice or
 * "Use it", which saves at once. Draft again, which the CSM asks for, never
 * empties a field first and never replaces her own words: a new draft
 * that would waits beside the field until she replaces them (then Undo),
 * and a refused or failed one leaves the field as it was. A guessed call ("Is this the call?") is
 * saved unconfirmed and holds Send until "Yes, this call". A recording the
 * server marks blocked (a team meeting, gone, on another client) is never
 * picked, by the store, a click or a pasted link.
 *
 * Rehearsal (`?rehearse=1`, admins and the CEO): nothing is saved, nothing
 * is sent, nothing is drafted; the window is drawn read only beside the
 * call the store would pick.
 */

export interface CheckinIO {
  open(a: {
    taskId: string;
    responseId: string | null;
    rehearse: boolean;
  }): Promise<OpenAnswer>;
  save(a: {
    responseId: string;
    changes: Record<string, Change>;
    session: string;
    baseRevision: number | null;
  }): Promise<SaveResult>;
  submit(a: {
    responseId: string;
    baseRevision: number | null;
  }): Promise<SubmitAnswer>;
  discard(responseId: string): Promise<unknown>;
  read(responseId: string): Promise<ReadAnswer>;
  /** checkin.drafts: begins what can be drafted, then reads. */
  drafts(responseId: string): Promise<DraftsAnswer>;
  draftAgain(
    responseId: string,
    kind: Exclude<DraftKind, "grade">,
  ): Promise<DraftsAnswer>;
  calls(a: {
    taskId: string;
    responseId: string | null;
    shareUrl: string | null;
    refresh: boolean;
  }): Promise<CallsAnswer>;
  transcript(
    responseId: string,
    recordingId: string,
  ): Promise<TranscriptAnswer>;
  /**
   * Move it here (docs/forms/STAGE2B-CONTRACT.md 4.11, 5.3): an admin or
   * the CEO moves a recording from another client onto this one.
   */
  move?(a: { recordingId: string; taskId: string }): Promise<MoveAnswer>;
  timeline(): Promise<Timeline>;
  announce?(news: FormNews): void;
}

/** Time for the polls; tests pass a clock they can move. */
export interface Clock {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
  visible(): boolean;
}

export const realClock: Clock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: h => clearTimeout(h as ReturnType<typeof setTimeout>),
  visible: () =>
    typeof document === "undefined" || document.visibilityState !== "hidden",
};

/** The polls of 8.2: a fast start, then slower, then stop. */
export const POLLS = {
  trail: {
    fast: 15_000,
    fastFor: 3 * 60_000,
    slow: 60_000,
    until: 25 * 60_000,
  },
  drafts: { fast: 60_000, fastFor: 0, slow: 60_000, until: 15 * 60_000 },
  recap: {
    fast: 15_000,
    fastFor: 3 * 60_000,
    slow: 60_000,
    until: 15 * 60_000,
  },
} as const;
type Plan = (typeof POLLS)[keyof typeof POLLS];

export type Seat = "csm" | "admin";

export type Phase =
  | { kind: "loading" }
  | {
      kind: "blocked";
      reason: "list" | "roster" | "live" | "read";
      text: string;
    }
  | { kind: "ready" };

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; message: string };

export type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  /**
   * The server's sentence. `stale`: another window saved these notes since
   * this one read them (40001), so they are read again before a send.
   */
  | { kind: "refused"; text: string; stale?: boolean };

export interface Conflict {
  theirs: unknown;
  mine: unknown;
  by: string | null;
  at: string | null;
}

export type DraftedKey = "we_owe" | "they_owe" | "client_notes";
export interface Origin {
  from: string;
  value: unknown;
  recordingId: string | null;
  /** When that recording started ("The drafts were for the 10:34 recording."). */
  recordingAt: string | null;
}

/**
 * Draft again for Client notes: a new draft being written (`mine` when the
 * field holds the CSM's own words, which it keeps), or one that came while
 * the field held her words, waiting beside it until she replaces them.
 */
export type NotesAgain =
  | { kind: "writing"; mine: boolean }
  | { kind: "ready"; text: string; origin: Origin };

/** A Draft again asked for: the call it is for, and the fields as they were at the click. */
interface Asked {
  rec: string;
  base: Partial<Record<DraftedKey, unknown>>;
  /** The fields that held the CSM's own words (typed, or a draft she edited). */
  mine: ReadonlySet<DraftedKey>;
}

export interface CallsState {
  status: "loading" | "ready" | "failed";
  answer: CallsAnswer | null;
  error: string | null;
  checking: boolean;
  checkedAt: string | null;
}

export interface CheckinModel {
  taskId: string;
  phase: Phase;
  rehearse: boolean;
  seat: Seat;
  form: OpenAnswer["form"] | null;
  schema: CheckinSchema;
  client: OpenAnswer["client"] | null;
  response: ResponseView | null;
  /** The response's mode, else the registry's: shadow until the cut-over. */
  shadow: boolean;
  /** The server's clock at the open. */
  now: string | null;
  resumed: { at: string } | null;
  /** A shadow draft after the cut-over, or a send refused for it. */
  startedShadow: boolean;
  answers: Answers;
  meta: ResponseView["meta"];
  drafts: Partial<Record<DraftKind, DraftView>>;
  draftsFor: string | null;
  origin: Partial<Record<DraftedKey, Origin>>;
  unsaved: ReadonlySet<string>;
  calls: CallsState;
  /** The view of the call answered, or of the store's guess while none is. */
  view: CallView | null;
  /** The store's guess is not saved yet (a hint): Yes picks it. */
  guess: boolean;
  paste: { busy: boolean; error: string | null; unknown: boolean };
  /** The server refused the call: its sentence, under the card. */
  callError: string | null;
  fieldErrors: Record<string, string>;
  conflicts: Record<string, Conflict>;
  save: SaveState;
  rail: { timeline: Timeline | null; error: string | null; loading: boolean };
  send: SendState;
  /**
   * `unread`: the notes were reopened as sent and their effects are not read
   * yet, or the read failed. Then `effects` is empty and that says nothing.
   */
  sent: {
    response: ResponseView;
    effects: EffectView[];
    unread?: "reading" | "failed";
  } | null;
  recap: DraftView | null;
  block: string | null;
  /** Unsent notes for an older call (`day`), and the newer call the store picked. */
  other: { day: string; newest: string } | null;
  already: { at: string; source: "cockpit" | "typeform" } | null;
  repicked: { at: string } | null;
  transcript: { busy: boolean; error: string | null; text: string | null };
  retry(): void;
  confirmCall(): void;
  pick(view: CallView): void;
  pickNone(): void;
  pasteLink(url: string): Promise<boolean>;
  checkAgain(): void;
  /**
   * Move it here: the recording moves onto this client, then the calls are
   * read again and the moved recording is picked. True when it moved.
   */
  moveHere(view: CallView): Promise<boolean>;
  /** The move on its way, or its refusal in the server's words, for one row. */
  move: { busy: boolean; error: string | null; ref: string | null };
  clearMove(): void;
  choose(key: "defcon" | "priority", label: string): void;
  takeSuggestion(key: "defcon" | "priority"): void;
  setTodos(key: "we_owe" | "they_owe", items: TodoItem[]): void;
  setNotes(text: string): void;
  /**
   * Asks for a new draft. The field keeps what it holds until the draft
   * comes; the draft then takes it only if it held no one's own words and
   * nobody typed since, else it waits beside the field (`notesAgain`). A
   * refusal or a failed draft leaves the field as it was.
   */
  draftAgain(kind: Exclude<DraftKind, "grade">): void;
  notesAgain: NotesAgain | null;
  /**
   * Draft again refused or not reached (five drafts, the connection): the
   * server's sentence, for the call now picked. Its own line, so a save of
   * the field never clears it.
   */
  notesAgainError: string | null;
  /**
   * The server refused Draft again for this call (five drafts): asking again
   * brings the same sentence, so Draft again rests until the call changes.
   * A connection that dropped is not a refusal: it can be asked again.
   */
  notesAgainRefused: boolean;
  /** A new draft replaced the CSM's notes at her word: Undo puts them back. */
  notesReplaced: boolean;
  takeNewNotes(): void;
  keepNotes(): void;
  undoNotes(): void;
  redraft(): void;
  keepMine(key: string): void;
  keepTheirs(key: string): void;
  sendNotes(): Promise<void>;
  /**
   * After a send refused because another window saved these notes: read
   * them again (what waits to be sent stays as typed), then Send works.
   */
  readAgain(): Promise<void>;
  rereading: boolean;
  /** The recap of sent notes, drafted again (it failed). */
  recapAgain(): void;
  /** The recap's message row changed in the step: the trail reads again. */
  recapMoved(): void;
  recapAsking: boolean;
  /** Draft again for the recap refused or not reached: the server's sentence. */
  recapError: string | null;
  /** The server refused Draft again for the recap: asking again says the same. */
  recapRefused: boolean;
  discardRestart(): Promise<void>;
  finishOther(): void;
  startForThisCall(): Promise<void>;
  openTranscript(): void;
  closeTranscript(): void;
}

export const NOT_LIVE =
  "The cockpit's 1-1 notes are not live yet. Use the 1-1 form in Typeform for now.";
/** The move RPC is not in the database yet (5.3). */
export const MOVE_NOT_LIVE = "Moving a recording is not live yet.";
/** The move got no answer in time: what is known, and what to do next. */
export const MOVE_NO_ANSWER =
  "No answer came back, so the move may or may not have gone through. Reload the page to see where the recording is.";
/** Draft again got no answer in time: what is known, and what to do next. */
export const DRAFT_AGAIN_NO_ANSWER =
  "No answer came back, so the new draft may or may not have started. Reload the page to see where the recap stands.";
/** The move answered, and the list of calls after it did not. */
export const MOVED_NO_LIST =
  "The recording moved, but the list of calls did not come back. Reload the page to see it here.";
export const STARTED_SHADOW =
  "These notes were started as a shadow run. Discard them and start again.";
export const GATE_LOST =
  "This client left your list, so the notes were not sent. Ask your lead.";
const AFTER_SEND = "The recap is drafted after you send the notes.";

/**
 * A draft that waits for Fathom (the summary or the transcript): the server
 * says so in a sentence with "still writing", and the window asks again, before
 * the send and after it. Its sentence is shown as the server wrote it.
 */
const STILL_WRITING = /still writing/i;
export function stillWriting(reason: string | null | undefined): string | null {
  const t = reason?.trim() ?? "";
  return STILL_WRITING.test(t) ? t : null;
}

/**
 * The recap of sent notes is settled: written, off, failed, or skipped for its
 * own reason (the model found nothing worth sending, or the call is not a
 * client's). A recap that waits for Fathom, or for the send, is not: the
 * recap step keeps asking, and that ask is also what begins the call's grade
 * after a quick send (6.5).
 */
export const recapSettled = (d: DraftView | null | undefined) =>
  Boolean(
    d &&
      (d.state === "ready" ||
        d.state === "off" ||
        d.state === "failed" ||
        (d.state === "skipped" &&
          d.reason !== AFTER_SEND &&
          !stillWriting(d.reason))),
  );

/**
 * The server refused the ask (its sentence, a 4xx or a refusal code), as
 * against a request that never got there: asking again says the same.
 */
const refusedBy = (e: unknown) =>
  e instanceof CheckinError &&
  (Boolean(e.code) || (e.status !== null && e.status >= 400 && e.status < 500));

const message = (e: unknown) => {
  const t = String((e as Error)?.message ?? e ?? "").trim();
  return offline(t) ? OFFLINE : t;
};

/** 8.5 Saving: a save that could not be sent, with its reason in plain words. */
export function notSavedText(reason: string | null | undefined): string {
  return `Not saved: ${clauseOf(reason?.trim() || OFFLINE)}. What you typed is kept here and saves when you are back online.`;
}
const codeOf = (e: unknown) =>
  e instanceof CheckinError ? (e.code ?? "") : "";
const gateRefusal = (e: unknown) =>
  codeOf(e) === "42501" ||
  /not on your access list|access is required/i.test(message(e));

/** Why the notes stay closed, in plain words (8.5 Opening). */
export function blockedFor(e: unknown): Extract<Phase, { kind: "blocked" }> {
  const m = message(e);
  if (/not live yet/i.test(m))
    return { kind: "blocked", reason: "live", text: NOT_LIVE };
  if (gateRefusal(e))
    return {
      kind: "blocked",
      reason: "list",
      text: "This client is not on your list, so the 1-1 notes cannot open here. Ask your lead to add this client, then try again.",
    };
  if (/roster is incomplete|missing or ambiguous/i.test(m))
    return {
      kind: "blocked",
      reason: "roster",
      text: "The client list is refreshing. Try again in a minute.",
    };
  return {
    kind: "blocked",
    reason: "read",
    text: "The client's record could not be read, so the notes stay closed: notes without the right card reach no one.",
  };
}

const emptyAnswer = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && !v.trim()) ||
  (Array.isArray(v) && v.length === 0);

/** The response ID this tab is working on, kept across a reload. */
const ID_KEY = (taskId: string) => `mahara-checkin-response:${taskId}`;
function keptId(taskId: string): string | null {
  try {
    const v = sessionStorage.getItem(ID_KEY(taskId));
    return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}
function keepId(taskId: string, id: string | null) {
  try {
    if (id) sessionStorage.setItem(ID_KEY(taskId), id);
    else sessionStorage.removeItem(ID_KEY(taskId));
  } catch {
    // A reload opens this seat's draft anyway.
  }
}

/** The call answer a view stands for, as the browser saves it (3.1). */
export function answerFor(view: CallView, why?: Why): CallAnswer | null {
  if (view.kind === "booking" && view.callId != null)
    return { kind: "booking", callId: view.callId, why: "booking" };
  if (view.kind !== "fathom" || !view.recordingId) return null;
  const w = why ?? (WHYS.includes(view.why as Why) ? (view.why as Why) : null);
  if (!w) return null;
  return {
    kind: "fathom",
    recordingId: view.recordingId,
    why: w,
    confirmed: CONFIRMED_WHYS.has(w) || (!view.ask && !ASK_WHYS.has(w)),
  };
}

/**
 * Why a view cannot be picked for this client, in the server's words (a
 * team meeting, a recording Fathom no longer has, one on another client),
 * else null (A7.3). A blocked view is listed, disabled, with this sentence,
 * and is never picked, pasted or not.
 */
export function blockedOf(view: CallView): string | null {
  if (view.blocked?.trim()) return view.blocked.trim();
  return view.onClient === "other"
    ? `On ${view.otherClient ?? "another client"}. If that is wrong, ask an admin to move it.`
    : null;
}

/** A view drawn from a saved call the store no longer lists (an older call). */
function viewOf(call: CallAnswer | null): CallView | null {
  if (!call || call.kind === "none") return null;
  if (call.kind === "booking")
    return {
      ref: `booking:${call.callId}`,
      kind: "booking",
      recordingId: null,
      callId: call.callId,
      title: null,
      startsAt: call.startsAt ?? "",
      endsAt: call.endsAt ?? null,
      minutes: null,
      why: "booking",
      label: "booking",
      ask: false,
      whyText: "",
      booking: null,
      shareUrl: null,
      recorder: null,
      recorderRole: null,
      actionItems: null,
      hasSummary: false,
      hasTranscript: false,
      onClient: "this",
      otherClient: null,
      blocked: null,
      notesAlready: null,
      duplicateOf: null,
      movable: false,
    };
  return {
    ref: `fathom:${call.recordingId}`,
    kind: "fathom",
    recordingId: call.recordingId,
    callId: call.callId ?? null,
    title: call.title ?? null,
    startsAt: call.startsAt ?? "",
    endsAt: call.endsAt ?? null,
    minutes: null,
    why: call.why,
    label: ASK_WHYS.has(call.why) ? "likely" : "exact",
    ask: ASK_WHYS.has(call.why),
    whyText: "",
    booking: null,
    shareUrl: call.shareUrl ?? null,
    recorder: call.recorder ?? null,
    recorderRole: null,
    actionItems: null,
    hasSummary: false,
    hasTranscript: false,
    onClient: "this",
    otherClient: null,
    blocked: null,
    notesAlready: null,
    duplicateOf: null,
    movable: false,
  };
}

const views = (a: CallsAnswer | null) =>
  a ? [...(a.picked ? [a.picked] : []), ...a.others] : [];

/** A Fathom link's page as the matcher keys it (callMatch.ts shareKey): the path, no query. */
const pageOf = (url: string | null) => {
  const m = /^(?:https?:\/\/)?(?:www\.)?fathom\.video(\/[^?#\s]*)/i.exec(
    (url ?? "").trim(),
  );
  return m ? m[1].replace(/\/+$/, "") || null : null;
};

/** The kinds the fields wait on before the send. */
const FIELD_KINDS: DraftKind[] = ["todos", "client_notes", "defcon_priority"];
const waiting = (d: DraftView | undefined) =>
  Boolean(
    d &&
      (d.state === "drafting" ||
        (d.state === "skipped" && stillWriting(d.reason))),
  );

/** One poll: runs at once, then on the plan, only while the window is seen. */
function usePoll(
  active: boolean,
  plan: Plan,
  run: () => Promise<boolean>,
  clock: Clock,
  key: string,
  immediate = false,
) {
  const runRef = useRef(run);
  runRef.current = run;
  // biome-ignore lint/correctness/useExhaustiveDependencies: key restarts the poll
  useEffect(() => {
    if (!active) return;
    const started = clock.now();
    let handle: unknown = null;
    let stopped = false;
    const next = () => {
      const elapsed = clock.now() - started;
      if (elapsed >= plan.until) return null;
      const wait = elapsed < plan.fastFor ? plan.fast : plan.slow;
      return Math.min(wait, plan.until - elapsed);
    };
    const tick = async () => {
      if (stopped) return;
      if (clock.visible()) {
        let more = true;
        try {
          more = await runRef.current();
        } catch {
          // A read that failed is tried again on the next tick.
        }
        if (!more || stopped) return;
      }
      const wait = next();
      if (wait === null || wait <= 0) return;
      handle = clock.set(() => void tick(), wait);
    };
    const first = immediate ? 0 : next();
    if (first !== null) handle = clock.set(() => void tick(), first);
    return () => {
      stopped = true;
      if (handle !== null) clock.clear(handle);
    };
  }, [active, key, clock, plan, immediate]);
}

export function useCheckin({
  taskId,
  rehearse,
  seat,
  io,
  clock = realClock,
  newId = () => crypto.randomUUID(),
}: {
  taskId: string;
  rehearse: boolean;
  seat: Seat;
  io: CheckinIO;
  clock?: Clock;
  newId?: () => string;
}): CheckinModel {
  const ioRef = useRef(io);
  ioRef.current = io;
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [opened, setOpened] = useState<OpenAnswer | null>(null);
  const [response, setResponse] = useState<ResponseView | null>(null);
  const responseRef = useRef<ResponseView | null>(null);
  responseRef.current = response;
  const [answers, setAnswers] = useState<Answers>({});
  const answersRef = useRef<Answers>({});
  answersRef.current = answers;
  const [meta, setMeta] = useState<ResponseView["meta"]>({});
  const [drafts, setDrafts] = useState<Partial<Record<DraftKind, DraftView>>>(
    {},
  );
  const [draftsFor, setDraftsFor] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Partial<Record<DraftedKey, Origin>>>({});
  const originRef = useRef(origin);
  originRef.current = origin;
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(new Set());
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const touched = useRef(new Set<string>());
  const asked = useRef<Partial<Record<"todos" | "client_notes", Asked>>>({});
  const [notesAgain, setNotesAgain] = useState<NotesAgain | null>(null);
  /** Draft again's refusal or failure, for the recording it was asked for. */
  const [notesAgainError, setNotesAgainError] = useState<{
    text: string;
    rec: string;
    refused: boolean;
  } | null>(null);
  const notesErrorRef = useRef(notesAgainError);
  notesErrorRef.current = notesAgainError;
  const [notesUndo, setNotesUndo] = useState<{
    value: unknown;
    origin: Origin | undefined;
  } | null>(null);
  const [calls, setCalls] = useState<CallsState>({
    status: "loading",
    answer: null,
    error: null,
    checking: false,
    checkedAt: null,
  });
  const callsRef = useRef(calls);
  callsRef.current = calls;
  const [paste, setPaste] = useState<CheckinModel["paste"]>({
    busy: false,
    error: null,
    unknown: false,
  });
  const [callError, setCallError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<Record<string, Conflict>>({});
  /** A change she makes to a field settles its conflict: the field is hers now. */
  const settleConflict = useCallback(
    (key: string) =>
      setConflicts(c => {
        if (!(key in c)) return c;
        const { [key]: _, ...rest } = c;
        return rest;
      }),
    [],
  );
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [rail, setRail] = useState<CheckinModel["rail"]>({
    timeline: null,
    error: null,
    loading: true,
  });
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  const [sent, setSent] = useState<CheckinModel["sent"]>(null);
  /** The effects read failed while they were still unread: said, never as no steps. */
  const effectsNotRead = useCallback(
    () => setSent(s => (s?.unread ? { ...s, unread: "failed" } : s)),
    [],
  );
  const [recap, setRecap] = useState<DraftView | null>(null);
  const [recapAsking, setRecapAsking] = useState(false);
  const [recapError, setRecapError] = useState<string | null>(null);
  const [recapRefused, setRecapRefused] = useState(false);
  /** Recap Draft agains answered: each reads the trail again (Z28). */
  const [recapRedrafts, setRecapRedrafts] = useState(0);
  const [recapMoves, setRecapMoves] = useState(0);
  const [startedShadow, setStartedShadow] = useState(false);
  const [otherDismissed, setOtherDismissed] = useState(false);
  const [transcript, setTranscript] = useState<CheckinModel["transcript"]>({
    busy: false,
    error: null,
    text: null,
  });
  const [generation, setGeneration] = useState(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const schema = useMemo(
    () => (opened ? schemaFrom(opened.form.schema) : SCHEMA),
    [opened],
  );
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  const session = useMemo(() => sessionId(), []);
  const lastError = useRef<string | null>(null);

  const saver = useMemo(
    () =>
      new FieldSaver({
        check: (k, v) => checkValue(k, v, schemaRef.current),
        same: sameValue,
        keep: e => !(e instanceof CheckinError && e.code),
        save: async (changes, base) => {
          const r = responseRef.current;
          if (!r) throw Error("These notes are not open yet.");
          setSave({ kind: "saving" });
          return ioRef.current.save({
            responseId: r.id,
            changes,
            session,
            baseRevision: base,
          });
        },
        onSaved: result => {
          if (!live.current) return;
          lastError.current = null;
          setSave({ kind: "saved", at: new Date(clock.now()).toISOString() });
          if (result.row?.meta) {
            const m = result.row.meta;
            setMeta(old => ({ ...old, ...(m as ResponseView["meta"]) }));
          }
          setFieldErrors(f => {
            const next = { ...f };
            for (const k of result.applied) delete next[k];
            return next;
          });
          // The server's own call (its times, link and title) once nothing
          // newer is waiting; typed text stays as typed.
          if (
            result.applied.includes("call") &&
            result.row &&
            !saver.waiting.includes("call")
          ) {
            const stored = result.row.answers.call ?? null;
            setAnswers(a => ({ ...a, call: stored }));
            setCallError(null);
          }
          if (result.row)
            setResponse(r =>
              r ? { ...r, revision: result.row?.revision ?? r.revision } : r,
            );
        },
        onConflict: c => {
          if (!live.current) return;
          setConflicts(list => ({
            ...list,
            [c.key]: { theirs: c.theirs, mine: c.mine, by: c.by, at: c.at },
          }));
          setAnswers(a => ({ ...a, [c.key]: c.theirs }));
        },
        onError: (raw, keys, kept) => {
          if (!live.current) return;
          const msg = offline(raw) ? OFFLINE : raw;
          if (kept) {
            lastError.current = msg;
            setSave({ kind: "error", message: msg });
            return;
          }
          // Refused: the server's sentence goes under the field, and the
          // field goes back to what the server holds.
          setSave({ kind: "idle" });
          setFieldErrors(f => {
            const next = { ...f };
            for (const k of keys) next[k] = msg;
            return next;
          });
          if (keys.includes("call")) {
            setCallError(msg);
            const back = saver.seen("call");
            setAnswers(a => ({ ...a, call: back ?? null }));
          }
        },
      }),
    [session, clock],
  );

  // ------------------------------------------------------------ open

  const applyCalls = useCallback(
    (answer: CallsAnswer, now: string) => {
      // When Fathom itself was asked, else when the cockpit answered.
      const checkedAt = answer.fathom.checkedAt ?? now;
      callsRef.current = {
        ...callsRef.current,
        status: "ready",
        answer,
        error: null,
        checking: false,
        checkedAt,
      };
      setCalls(c => ({
        ...c,
        status: "ready",
        answer,
        error: null,
        checking: false,
        checkedAt,
      }));
      const current = callOf(answersRef.current.call);
      const picked = answer.picked;
      if (current || !picked || blockedOf(picked)) return null;
      const a = answerFor(picked);
      if (!a) return null;
      answersRef.current = { ...answersRef.current, call: a };
      setAnswers(x => ({ ...x, call: a }));
      if (!rehearse && responseRef.current?.state === "draft")
        saver.set("call", a, { now: true });
      return a;
    },
    [rehearse, saver],
  );

  const fill = useCallback((answer: DraftsAnswer) => {
    const byKind: Partial<Record<DraftKind, DraftView>> = {};
    for (const d of answer.drafts) byKind[d.kind] = d;
    setDrafts(byKind);
    setDraftsFor(answer.recordingId);
    const call = callOf(answersRef.current.call);
    const rec = call?.kind === "fathom" ? call.recordingId : null;
    // A Draft again asked for another recording is over.
    for (const kind of ["todos", "client_notes"] as const)
      if (asked.current[kind] && asked.current[kind]?.rec !== rec) {
        delete asked.current[kind];
        if (kind === "client_notes") setNotesAgain(null);
      }
    if (!rec || answer.recordingId !== rec) return;
    if (responseRef.current?.state !== "draft") return;
    const at =
      views(callsRef.current.answer).find(v => v.recordingId === rec)
        ?.startsAt ??
      (call?.kind === "fathom" ? (call.startsAt ?? null) : null);
    const add: Partial<Record<DraftedKey, Origin>> = {};
    const values: Answers = {};
    const open = (k: DraftedKey) =>
      emptyAnswer(answersRef.current[k]) && !touched.current.has(k);
    // A draft asked for takes a field that is empty, or that still holds
    // what it held at the click when that was no one's own words; a draft
    // that comes by itself takes only an empty, untouched one.
    const takes = (a: Asked | undefined, k: DraftedKey) =>
      a
        ? emptyAnswer(answersRef.current[k]) ||
          (!a.mine.has(k) &&
            sameValue(answersRef.current[k] ?? null, a.base[k] ?? null))
        : open(k);
    const over = (d: DraftView | undefined) => Boolean(d && !waiting(d));
    const todosDraft = byKind.todos;
    const todosAsked = asked.current.todos;
    if (todosDraft?.state === "ready") {
      const items = Array.isArray(todosDraft.output?.items)
        ? (todosDraft.output?.items as Record<string, unknown>[])
        : [];
      for (const [key, side] of [
        ["we_owe", "we"],
        ["they_owe", "they"],
      ] as const) {
        const list: TodoItem[] = todosOf(
          items
            .filter(i => i.side === side)
            .map(i => ({ ...i, from: "fathom" })),
        );
        if (list.length && takes(todosAsked, key)) {
          values[key] = list;
          add[key] = {
            from: "fathom.action_items",
            value: list,
            recordingId: rec,
            recordingAt: at,
          };
        }
      }
    }
    // Lists the CSM changed keep her lines; a new draft of them is not offered.
    if (todosAsked && over(todosDraft)) delete asked.current.todos;
    const notesDraft = byKind.client_notes;
    const notesAsked = asked.current.client_notes;
    const text = notesDraft?.output?.text;
    let offer: NotesAgain | null = null;
    if (
      notesDraft?.state === "ready" &&
      typeof text === "string" &&
      text.trim()
    ) {
      const drafted: Origin = {
        from: "ai.client_notes",
        value: text.trim(),
        recordingId: rec,
        recordingAt: at,
      };
      if (takes(notesAsked, "client_notes")) {
        values.client_notes = text.trim();
        add.client_notes = drafted;
      } else if (
        notesAsked &&
        !sameValue(answersRef.current.client_notes ?? null, text.trim())
      )
        // Her words stay; the new draft waits beside them.
        offer = { kind: "ready", text: text.trim(), origin: drafted };
    }
    if (notesAsked && over(notesDraft)) {
      delete asked.current.client_notes;
      setNotesAgain(offer);
    }
    const keys = Object.keys(values);
    if (!keys.length) return;
    for (const k of keys) touched.current.delete(k);
    answersRef.current = { ...answersRef.current, ...values };
    setAnswers(a => ({ ...a, ...values }));
    setOrigin(o => ({ ...o, ...add }));
    setUnsaved(u => new Set([...u, ...keys]));
  }, []);

  const readDraftsNow = useCallback(async () => {
    const r = responseRef.current;
    if (!r || rehearse) return null;
    const call = callOf(answersRef.current.call);
    if (call?.kind !== "fathom") return null;
    // The drafts follow the call the server holds: a pick still on its way
    // is saved first.
    if (saver.waiting.includes("call") || saver.busy) await saver.flush();
    const answer = await ioRef.current.drafts(r.id);
    if (!live.current) return null;
    fill(answer);
    return answer;
  }, [rehearse, fill, saver]);

  const readCallsNow = useCallback(
    async (refresh: boolean) => {
      setCalls(c => ({ ...c, checking: true }));
      try {
        const answer = await ioRef.current.calls({
          taskId,
          responseId: responseRef.current?.id ?? null,
          shareUrl: null,
          refresh,
        });
        if (!live.current) return;
        const picked = applyCalls(answer, answer.now);
        if (picked?.kind === "fathom") void readDraftsNow().catch(() => {});
      } catch (e) {
        if (!live.current) return;
        setCalls(c => ({
          ...c,
          status: c.answer ? "ready" : "failed",
          error: message(e),
          checking: false,
        }));
      }
    },
    [taskId, applyCalls, readDraftsNow],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: generation reopens
  useEffect(() => {
    let current = true;
    setPhase({ kind: "loading" });
    const start = async () => {
      let id = rehearse ? null : (keptId(taskId) ?? newId());
      let out: OpenAnswer;
      try {
        out = await ioRef.current.open({ taskId, responseId: id, rehearse });
        if (
          !rehearse &&
          (out.response?.state === "void" || out.response?.state === "legacy")
        ) {
          id = newId();
          out = await ioRef.current.open({ taskId, responseId: id, rehearse });
        }
      } catch (e) {
        // Notes kept for another seat in this tab: start this seat's own.
        if (!rehearse && /belong to another seat/i.test(message(e))) {
          try {
            id = newId();
            out = await ioRef.current.open({
              taskId,
              responseId: id,
              rehearse,
            });
          } catch (e2) {
            if (current) setPhase(blockedFor(e2));
            return;
          }
        } else {
          if (current) setPhase(blockedFor(e));
          return;
        }
      }
      if (!current || !live.current) return;
      const r = out.response;
      if (!rehearse && !r) {
        setPhase(blockedFor(null));
        return;
      }
      if (!rehearse) keepId(taskId, r?.id ?? null);
      setOpened(out);
      setResponse(r);
      responseRef.current = r;
      const a = { ...(r?.answers ?? {}) };
      answersRef.current = a;
      setAnswers(a);
      setMeta(r?.meta ?? {});
      saver.load(a, r?.revision ?? null);
      touched.current = new Set(Object.keys(a).filter(k => !emptyAnswer(a[k])));
      setStartedShadow(
        Boolean(r && r.state === "draft" && r.mode !== out.form.mode),
      );
      setPhase({ kind: "ready" });
      if (r && (r.state === "submitted" || r.state === "confirmed")) {
        setSent({ response: r, effects: [], unread: "reading" });
        setSend({ kind: "sent" });
        // The trail's poll also asks while they stay unread, so this one
        // read is not the only chance; it ends by its deadline either way.
        answerBy(
          ioRef.current.read(r.id),
          ACTION_DEADLINE_MS,
          clock,
          STEPS_UNREAD,
        ).then(
          read => {
            if (current && live.current)
              setSent({ response: read.response, effects: read.effects });
          },
          () => {
            if (current && live.current) effectsNotRead();
          },
        );
      }
      void readCallsNow(false);
      void readDraftsNow().catch(() => {});
      setRail(x => ({ ...x, loading: true }));
      ioRef.current.timeline().then(
        timeline => {
          if (current && live.current)
            setRail({ timeline, error: null, loading: false });
        },
        e => {
          if (current && live.current)
            setRail({ timeline: null, error: message(e), loading: false });
        },
      );
    };
    void start();
    return () => {
      current = false;
    };
  }, [taskId, rehearse, generation]);

  // A save that failed offline goes again when the connection comes back,
  // and a window closed within the pause still sends its last keystrokes.
  useEffect(() => {
    const again = () => void saver.flush();
    window.addEventListener("online", again);
    window.addEventListener("pagehide", again);
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener("pagehide", again);
    };
  }, [saver]);
  useEffect(() => {
    if (save.kind !== "error") return;
    const h = clock.set(() => void saver.flush(), 20_000);
    return () => clock.clear(h);
  }, [save, saver, clock]);

  // ------------------------------------------------------------ the call

  const call = callOf(answers.call);
  const all = views(calls.answer);
  const ref = callRef(call);
  const listed = ref ? (all.find(v => v.ref === ref) ?? null) : null;
  const picked = calls.answer?.picked ?? null;
  const guess =
    !call && Boolean(picked && !blockedOf(picked) && !answerFor(picked));
  const view: CallView | null =
    listed ?? (call ? viewOf(call) : guess ? picked : null);

  const saveCall = useCallback(
    (a: CallAnswer, from?: string) => {
      setCallError(null);
      setAnswers(x => ({ ...x, call: a }));
      answersRef.current = { ...answersRef.current, call: a };
      touched.current.add("call");
      if (!rehearse && responseRef.current?.state === "draft")
        saver.set("call", a, { now: true, ...(from ? { from } : {}) });
    },
    [rehearse, saver],
  );

  const confirmCall = useCallback(() => {
    const c = callOf(answersRef.current.call);
    if (c?.kind === "fathom") {
      saveCall({ ...c, confirmed: true }, "pick");
      return;
    }
    // A hint the store did not save: Yes is a pick.
    const p = callsRef.current.answer?.picked;
    if (!c && p?.kind === "fathom" && p.recordingId && !blockedOf(p)) {
      saveCall(
        {
          kind: "fathom",
          recordingId: p.recordingId,
          why: "picked",
          confirmed: true,
        },
        "pick",
      );
      void readDraftsNow().catch(() => {});
    }
  }, [saveCall, readDraftsNow]);

  const pick = useCallback(
    (v: CallView) => {
      if (blockedOf(v)) return;
      const a =
        v.kind === "booking"
          ? answerFor(v)
          : answerFor(v, v.why === "pasted" ? "pasted" : "picked");
      if (!a) return;
      saveCall(a, "pick");
      if (a.kind === "fathom") void readDraftsNow().catch(() => {});
    },
    [saveCall, readDraftsNow],
  );

  const pickNone = useCallback(
    () => saveCall({ kind: "none", why: "none" }, "pick"),
    [saveCall],
  );

  const pasteLink = useCallback(
    async (url: string) => {
      const link = url.trim();
      if (!link) return false;
      setPaste({ busy: true, error: null, unknown: false });
      try {
        const answer = await ioRef.current.calls({
          taskId,
          responseId: responseRef.current?.id ?? null,
          shareUrl: link,
          refresh: true,
        });
        if (!live.current) return false;
        setCalls(c => ({
          ...c,
          status: "ready",
          answer,
          error: null,
          checkedAt: answer.now,
        }));
        // The view the link found reads as pasted, and so does one whose link
        // is in an earlier 1-1 form: the link itself decides, then a blocked
        // one (only the pasted recording is blocked as pasted), then the order.
        const pasted = views(answer).filter(v => v.why === "pasted");
        const page = pageOf(link);
        const found =
          pasted.find(v => page !== null && pageOf(v.shareUrl) === page) ??
          pasted.find(v => blockedOf(v)) ??
          pasted[0];
        if (!found) {
          setPaste({ busy: false, error: null, unknown: true });
          return false;
        }
        // One that cannot be used for this client says why and is not picked.
        const blocked = blockedOf(found);
        if (blocked) {
          setPaste({ busy: false, error: blocked, unknown: false });
          return false;
        }
        setPaste({ busy: false, error: null, unknown: false });
        pick(found);
        return true;
      } catch (e) {
        if (live.current)
          setPaste({ busy: false, error: message(e), unknown: false });
        return false;
      }
    },
    [taskId, pick],
  );

  const checkAgain = useCallback(() => void readCallsNow(true), [readCallsNow]);

  const [move, setMove] = useState<CheckinModel["move"]>({
    busy: false,
    error: null,
    ref: null,
  });
  const moveHere = useCallback(
    async (v: CallView) => {
      const io = ioRef.current;
      if (rehearse || !v.recordingId || !io.move) return false;
      setMove({ busy: true, error: null, ref: v.ref });
      try {
        await answerBy(
          io.move({ recordingId: v.recordingId, taskId }),
          ACTION_DEADLINE_MS,
          clock,
          MOVE_NO_ANSWER,
        );
      } catch (e) {
        const said = message(e);
        if (!live.current) return false;
        setMove({
          busy: false,
          // The function is not in the database yet: said plainly (5.3).
          error:
            codeOf(e) === "PGRST202" ||
            /not live yet|could not find the function/i.test(said)
              ? MOVE_NOT_LIVE
              : // The answer may have been lost after the move landed.
                said === OFFLINE
                ? MOVE_NO_ANSWER
                : said,
          ref: v.ref,
        });
        return false;
      }
      if (!live.current) return false;
      // A pasted link's sentence ("On Atlantis Contracting…") was about where
      // the recording was. It is here now.
      setPaste({ busy: false, error: null, unknown: false });
      // Read the calls again and pick the moved recording: it is on this
      // client now, so the store lists it as this client's. The move stays
      // busy through this read, so the confirm's two answers rest until the
      // sheet closes: the move has already happened.
      try {
        const answer = await answerBy(
          io.calls({
            taskId,
            responseId: responseRef.current?.id ?? null,
            shareUrl: null,
            refresh: false,
          }),
          ACTION_DEADLINE_MS,
          clock,
          MOVED_NO_LIST,
        );
        if (!live.current) return true;
        applyCalls(answer, answer.now);
        const moved = views(answer).find(
          x => x.kind === "fathom" && x.recordingId === v.recordingId,
        );
        // Picked as the store now has it (matched on this client), so the
        // call card says where it is, in teal (5.3).
        const a = moved && !blockedOf(moved) ? answerFor(moved) : null;
        if (a) {
          saveCall(a, "pick");
          if (a.kind === "fathom") void readDraftsNow().catch(() => {});
        }
      } catch (e) {
        if (live.current) {
          setCalls(c => ({ ...c, error: message(e), checking: false }));
          // The sheet closes on the toast, so the call card says it too.
          setCallError(MOVED_NO_LIST);
        }
      } finally {
        if (live.current) setMove({ busy: false, error: null, ref: null });
      }
      return true;
    },
    [rehearse, taskId, clock, applyCalls, saveCall, readDraftsNow],
  );
  // A move on its way keeps its rest: its answer always comes (the deadline).
  const clearMove = useCallback(
    () =>
      setMove(was =>
        was.busy ? was : { busy: false, error: null, ref: null },
      ),
    [],
  );

  // ------------------------------------------------------------ answers

  const choose = useCallback(
    (key: "defcon" | "priority", label: string) => {
      if (rehearse) return;
      touched.current.add(key);
      settleConflict(key);
      setAnswers(a => ({ ...a, [key]: label }));
      saver.set(key, label, { now: true, from: "pick" });
    },
    [rehearse, saver, settleConflict],
  );

  const takeSuggestion = useCallback(
    (key: "defcon" | "priority") => {
      if (rehearse) return;
      const out = drafts.defcon_priority?.output?.[key] as
        | { value?: unknown }
        | null
        | undefined;
      const value = typeof out?.value === "string" ? out.value : null;
      if (!value) return;
      touched.current.add(key);
      settleConflict(key);
      setAnswers(a => ({ ...a, [key]: value }));
      saver.set(key, value, {
        now: true,
        from: key === "defcon" ? "ai.defcon" : "ai.priority",
      });
    },
    [rehearse, drafts, saver, settleConflict],
  );

  const edit = useCallback(
    (key: DraftedKey, value: unknown, saved: unknown = value) => {
      if (rehearse) return;
      touched.current.add(key);
      // Typing after "Changed in another window" works from what the field
      // shows: her edit settles it, so a later "Use mine" cannot undo it.
      settleConflict(key);
      setAnswers(a => ({ ...a, [key]: value }));
      // Typing over a replaced draft makes it hers: Undo is gone.
      if (key === "client_notes") setNotesUndo(null);
      if (unsavedRef.current.has(key))
        setUnsaved(u => {
          const next = new Set(u);
          next.delete(key);
          return next;
        });
      const from = originRef.current[key]?.from;
      const refused = saver.set(key, saved, from ? { from } : {});
      setFieldErrors(f => {
        const next = { ...f };
        if (refused) next[key] = refused;
        else delete next[key];
        return next;
      });
    },
    [rehearse, saver, settleConflict],
  );
  const setTodos = useCallback(
    (key: "we_owe" | "they_owe", items: TodoItem[]) => {
      // A line being typed over stays here; the saved list leaves it out
      // until it has words again.
      const kept = items.filter(t => t.text.trim());
      edit(key, items.length ? items : null, kept.length ? kept : null);
    },
    [edit],
  );
  const setNotes = useCallback(
    (text: string) => edit("client_notes", text),
    [edit],
  );

  /** The field holds the CSM's own words: typed, or a draft she edited. */
  const ownWords = useCallback((k: DraftedKey) => {
    const v = answersRef.current[k];
    if (emptyAnswer(v)) return false;
    const o = originRef.current[k];
    return !(o && sameValue(o.value, typeof v === "string" ? v.trim() : v));
  }, []);

  const draftAgain = useCallback(
    (kind: Exclude<DraftKind, "grade">) => {
      const r = responseRef.current;
      if (!r || rehearse || r.state !== "draft") return;
      const c = callOf(answersRef.current.call);
      if (c?.kind !== "fathom") return;
      // Refused for this call (five drafts): asking again says the same.
      const no = notesErrorRef.current;
      if (kind === "client_notes" && no?.refused && no.rec === c.recordingId)
        return;
      // Asked for, but never by emptying the field first: what it holds
      // stays until the new draft comes, and her own words stay after it.
      if (kind === "todos" || kind === "client_notes") {
        if (asked.current[kind]) return;
        const keys: DraftedKey[] =
          kind === "todos" ? ["we_owe", "they_owe"] : ["client_notes"];
        asked.current[kind] = {
          rec: c.recordingId,
          base: Object.fromEntries(
            keys.map(k => [k, answersRef.current[k] ?? null]),
          ),
          mine: new Set(keys.filter(ownWords)),
        };
      }
      if (kind === "client_notes") {
        setNotesAgain({ kind: "writing", mine: ownWords("client_notes") });
        // An Undo stays across Draft again: her own words are still the ones
        // it puts back, whatever draft the field holds next. Only her typing
        // (which makes the field hers) or the send ends it.
        setNotesAgainError(null);
      } else
        setFieldErrors(f => {
          if (!(kind in f)) return f;
          const { [kind]: _, ...rest } = f;
          return rest;
        });
      ioRef.current.draftAgain(r.id, kind).then(
        answer => live.current && fill(answer),
        e => {
          if (!live.current) return;
          // Refused (five drafts, the call) or failed: the field is as it was.
          if (kind === "todos" || kind === "client_notes")
            delete asked.current[kind];
          if (kind === "client_notes") {
            setNotesAgain(null);
            setNotesAgainError({
              text: message(e),
              rec: c.recordingId,
              refused: refusedBy(e),
            });
          } else setFieldErrors(f => ({ ...f, [kind]: message(e) }));
        },
      );
    },
    [rehearse, fill, ownWords],
  );

  const takeNewNotes = useCallback(() => {
    const offer = notesAgain;
    if (rehearse || offer?.kind !== "ready") return;
    if (responseRef.current?.state !== "draft") return;
    const prev = answersRef.current.client_notes ?? null;
    const prevOrigin = originRef.current.client_notes;
    answersRef.current = { ...answersRef.current, client_notes: offer.text };
    setAnswers(a => ({ ...a, client_notes: offer.text }));
    setOrigin(o => ({ ...o, client_notes: offer.origin }));
    setUnsaved(u => {
      if (!u.has("client_notes")) return u;
      const next = new Set(u);
      next.delete("client_notes");
      return next;
    });
    touched.current.add("client_notes");
    setNotesAgain(null);
    // Her choice, like "Use it": saved at once with the draft's source.
    const refused = saver.set("client_notes", offer.text, {
      now: true,
      from: offer.origin.from,
    });
    setFieldErrors(f => {
      const next = { ...f };
      if (refused) next.client_notes = refused;
      else delete next.client_notes;
      return next;
    });
    setNotesUndo(
      emptyAnswer(prev) || refused ? null : { value: prev, origin: prevOrigin },
    );
  }, [rehearse, notesAgain, saver]);

  const keepNotes = useCallback(() => setNotesAgain(null), []);

  const undoNotes = useCallback(() => {
    const u = notesUndo;
    if (rehearse || !u) return;
    answersRef.current = { ...answersRef.current, client_notes: u.value };
    setAnswers(a => ({ ...a, client_notes: u.value }));
    setOrigin(o => {
      const next = { ...o };
      if (u.origin) next.client_notes = u.origin;
      else delete next.client_notes;
      return next;
    });
    touched.current.add("client_notes");
    setNotesUndo(null);
    saver.set("client_notes", u.value, {
      now: true,
      ...(u.origin ? { from: u.origin.from } : {}),
    });
  }, [rehearse, notesUndo, saver]);

  const redraft = useCallback(() => {
    // Lines drafted from the earlier recording and never edited go; edited
    // ones stay as the CSM's own words.
    const drop = [...unsavedRef.current] as DraftedKey[];
    setAnswers(a => {
      const next = { ...a };
      for (const k of drop) next[k] = null;
      answersRef.current = next;
      return next;
    });
    for (const k of drop) touched.current.delete(k);
    asked.current = {};
    setNotesAgain(null);
    setNotesAgainError(null);
    setNotesUndo(null);
    setUnsaved(new Set());
    setOrigin({});
    void readDraftsNow().catch(() => {});
  }, [readDraftsNow]);

  const keepMine = useCallback(
    (key: string) => {
      const c = conflicts[key];
      if (!c) return;
      const from = originRef.current[key as DraftedKey]?.from;
      saver.keepMine(key, c.mine, c.theirs, from);
      setAnswers(a => ({ ...a, [key]: c.mine }));
      setConflicts(({ [key]: _, ...rest }) => rest);
    },
    [conflicts, saver],
  );
  const keepTheirs = useCallback(
    (key: string) => setConflicts(({ [key]: _, ...rest }) => rest),
    [],
  );

  // ------------------------------------------------------------ drafts

  const fieldWait = FIELD_KINDS.some(k => waiting(drafts[k]));
  usePoll(
    fieldWait && !sent && call?.kind === "fathom",
    POLLS.drafts,
    async () => {
      const answer = await readDraftsNow();
      return Boolean(
        answer &&
          FIELD_KINDS.some(k => waiting(answer.drafts.find(d => d.kind === k))),
      );
    },
    clock,
    `drafts:${ref}`,
  );

  const drafted = Object.values(origin).find(o => o?.recordingId);
  const repicked =
    drafted?.recordingId &&
    call?.kind === "fathom" &&
    drafted.recordingId !== call.recordingId &&
    !sent
      ? { at: drafted.recordingAt ?? "" }
      : null;

  // ------------------------------------------------------------ send

  const shadow = (response?.mode ?? opened?.form.mode ?? "shadow") === "shadow";
  // A saved call that can no longer be used holds Send with its reason.
  const block = (view ? blockedOf(view) : null) ?? sendBlock(answers);
  const clientName = opened?.client.name ?? response?.clientName ?? "";

  const sendNotes = useCallback(async () => {
    const r = responseRef.current;
    if (rehearse || !r || r.state !== "draft") return;
    if (sendBlock(answersRef.current)) return;
    setSend({ kind: "sending" });
    for (const k of unsavedRef.current) {
      const from = originRef.current[k as DraftedKey]?.from;
      saver.set(k, answersRef.current[k], from ? { from } : {});
    }
    setUnsaved(new Set());
    await saver.flush();
    if (saver.waiting.length) {
      setSend({ kind: "refused", text: notSavedText(lastError.current) });
      return;
    }
    try {
      const out = await ioRef.current.submit({
        responseId: r.id,
        baseRevision: saver.revision,
      });
      if (!live.current) return;
      setResponse(out.response);
      setSent({ response: out.response, effects: out.effects });
      setSend({ kind: "sent" });
      // The notes went as they stood: there is nothing to put back now.
      setNotesUndo(null);
      const name = out.response.clientName ?? clientName;
      ioRef.current.announce?.({
        type: "sent",
        taskId,
        form: "checkin",
        clientName: name,
        say:
          out.response.mode === "shadow"
            ? `Shadow run sent for ${name}.`
            : `1-1 notes sent for ${name}. The card updates in a minute.`,
      });
    } catch (e) {
      if (!live.current) return;
      const text = gateRefusal(e) ? GATE_LOST : message(e);
      if (text === STARTED_SHADOW) setStartedShadow(true);
      setSend({
        kind: "refused",
        text,
        ...(codeOf(e) === "40001" ? { stale: true } : {}),
      });
    }
  }, [rehearse, saver, taskId, clientName]);

  const [rereading, setRereading] = useState(false);
  const readAgain = useCallback(async () => {
    const r = responseRef.current;
    if (rehearse || !r || r.state !== "draft") return;
    setRereading(true);
    try {
      // Every answer typed here is saved first, so reading again loses nothing.
      await saver.flush();
      const read = await ioRef.current.read(r.id);
      if (!live.current) return;
      const fresh = read.response;
      if (fresh.state === "submitted" || fresh.state === "confirmed") {
        // Sent from the other window.
        setResponse(fresh);
        responseRef.current = fresh;
        setSent({ response: fresh, effects: read.effects });
        setSend({ kind: "sent" });
        return;
      }
      if (fresh.state !== "draft") {
        // Discarded in the other window: these notes open again, new.
        setSend({ kind: "idle" });
        setGeneration(g => g + 1);
        return;
      }
      // The server's answers as they stand now; what still waits to be sent
      // stays as typed.
      const waits = new Set([...saver.waiting, ...unsavedRef.current]);
      const next: Answers = { ...fresh.answers };
      for (const k of waits) next[k] = answersRef.current[k];
      saver.load(fresh.answers, fresh.revision);
      for (const k of Object.keys(next))
        if (!emptyAnswer(next[k])) touched.current.add(k);
      answersRef.current = next;
      setAnswers(next);
      setResponse(fresh);
      responseRef.current = fresh;
      setMeta(fresh.meta);
      setConflicts({});
      setSend({ kind: "idle" });
    } catch (e) {
      if (live.current)
        setSend({ kind: "refused", text: message(e), stale: true });
    } finally {
      if (live.current) setRereading(false);
    }
  }, [rehearse, saver]);

  const restart = useCallback(
    async (discard: boolean) => {
      const r = responseRef.current;
      if (discard && r && r.state === "draft") {
        try {
          await saver.flush();
          await ioRef.current.discard(r.id);
        } catch (e) {
          setSend({ kind: "refused", text: message(e) });
          return;
        }
      }
      keepId(taskId, newId());
      touched.current = new Set();
      asked.current = {};
      setNotesAgain(null);
      setNotesAgainError(null);
      setNotesUndo(null);
      setPhase({ kind: "loading" });
      setOpened(null);
      setResponse(null);
      setAnswers({});
      setDrafts({});
      setOrigin({});
      setUnsaved(new Set());
      setConflicts({});
      setFieldErrors({});
      setCallError(null);
      setSend({ kind: "idle" });
      setSent(null);
      setRecap(null);
      setRecapError(null);
      setRecapRefused(false);
      setRecapRedrafts(0);
      setRecapMoves(0);
      setStartedShadow(false);
      setOtherDismissed(false);
      setCalls({
        status: "loading",
        answer: null,
        error: null,
        checking: false,
        checkedAt: null,
      });
      setGeneration(g => g + 1);
    },
    [saver, taskId, newId],
  );

  // ------------------------------------------------------------ after the send

  // A failed recap is made again from a newer ready draft within 24 hours
  // of the send (Z28): after Draft again the trail is read again until the
  // recap effect leaves failed (or the poll's 25 minutes end), so the rail
  // follows the step instead of keeping the old failure.
  const trailOpen = (effects: EffectView[]) =>
    !trailSettled(effects) ||
    (recapRedrafts > 0 &&
      effects.some(e => e.key === "recap" && e.state === "failed"));
  usePoll(
    Boolean(sent) && (Boolean(sent?.unread) || trailOpen(sent?.effects ?? [])),
    POLLS.trail,
    async () => {
      const r = responseRef.current;
      if (!r) return false;
      let read: Awaited<ReturnType<CheckinIO["read"]>>;
      try {
        // A read with no answer ends, or the poll would wait on it for ever.
        read = await answerBy(
          ioRef.current.read(r.id),
          ACTION_DEADLINE_MS,
          clock,
          STEPS_UNREAD,
        );
      } catch (e) {
        if (live.current) effectsNotRead();
        throw e;
      }
      if (!live.current) return false;
      setSent({ response: read.response, effects: read.effects });
      return trailOpen(read.effects);
    },
    clock,
    `trail:${sent?.response.id ?? ""}:${recapRedrafts}:${recapMoves}`,
  );

  // The recap's message row changed in the step beside the trail (an
  // approval, or the sender moving it on): the trail reads again, even after
  // its 25 minutes, so the rail and the fold's count follow the step.
  const recapMoved = useCallback(() => setRecapMoves(n => n + 1), []);

  const recapAgain = useCallback(() => {
    const r = responseRef.current;
    if (rehearse || !r || r.state === "draft" || recapAsking || recapRefused)
      return;
    if (callOf(r.answers.call)?.kind !== "fathom") return;
    setRecapAsking(true);
    setRecapError(null);
    // The answer's recap (drafting, or already done) restarts the poll below.
    answerBy(
      ioRef.current.draftAgain(r.id, "recap"),
      ACTION_DEADLINE_MS,
      clock,
      DRAFT_AGAIN_NO_ANSWER,
    )
      .then(
        answer => {
          if (!live.current) return;
          setRecap(answer.drafts.find(d => d.kind === "recap") ?? null);
          setRecapRedrafts(n => n + 1);
        },
        e => {
          if (!live.current) return;
          setRecapError(message(e));
          setRecapRefused(refusedBy(e));
        },
      )
      .finally(() => {
        if (live.current) setRecapAsking(false);
      });
  }, [rehearse, recapAsking, recapRefused, clock]);

  const sentCall = callOf(sent?.response.answers.call ?? null);
  // A recap that waits for Fathom's summary or transcript is not final: the
  // step keeps asking on its plan (8.2), and each ask also begins the grade.
  usePoll(
    Boolean(sent) && sentCall?.kind === "fathom" && !recapSettled(recap),
    POLLS.recap,
    async () => {
      const r = responseRef.current;
      if (!r) return false;
      const answer = await ioRef.current.drafts(r.id);
      if (!live.current) return false;
      const d = answer.drafts.find(x => x.kind === "recap") ?? null;
      setRecap(d);
      return !recapSettled(d);
    },
    clock,
    `recap:${sent?.response.id ?? ""}`,
    true,
  );

  // ------------------------------------------------------------ the rest

  const resumed =
    response?.state === "draft" &&
    opened &&
    Date.parse(opened.now) - Date.parse(response.createdAt) > 60_000
      ? { at: response.createdAt }
      : null;

  const other =
    resumed &&
    !otherDismissed &&
    call &&
    call.kind !== "none" &&
    picked &&
    !blockedOf(picked) &&
    picked.ref !== ref &&
    call.startsAt &&
    Date.parse(picked.startsAt) > Date.parse(call.startsAt)
      ? { day: call.startsAt, newest: picked.startsAt }
      : null;

  const openTranscript = useCallback(() => {
    const r = responseRef.current;
    const c = callOf(answersRef.current.call);
    const rec =
      c?.kind === "fathom" ? c.recordingId : (view?.recordingId ?? null);
    if (!r || !rec) return;
    // The tab opens on the click, so no popup blocker stops it.
    const tab =
      typeof window !== "undefined"
        ? window.open("about:blank", "_blank")
        : null;
    try {
      if (tab) tab.opener = null;
    } catch {
      // the link still opens
    }
    setTranscript({ busy: true, error: null, text: null });
    ioRef.current.transcript(r.id, rec).then(
      out => {
        if ("url" in out) {
          if (tab) tab.location.replace(out.url);
          setTranscript({ busy: false, error: null, text: null });
        } else {
          tab?.close();
          setTranscript({ busy: false, error: null, text: out.text });
        }
      },
      e => {
        tab?.close();
        setTranscript({ busy: false, error: message(e), text: null });
      },
    );
  }, [view]);

  return {
    taskId,
    phase,
    rehearse,
    seat,
    form: opened?.form ?? null,
    schema,
    client: opened?.client ?? null,
    response,
    shadow,
    now: opened?.now ?? null,
    resumed,
    startedShadow,
    answers,
    meta,
    drafts,
    draftsFor,
    origin,
    unsaved,
    calls,
    view,
    guess,
    paste,
    callError,
    fieldErrors,
    conflicts,
    save,
    rail,
    send,
    sent,
    recap,
    block,
    other,
    already: view?.notesAlready ?? null,
    repicked,
    transcript,
    retry: () => setGeneration(g => g + 1),
    confirmCall,
    pick,
    pickNone,
    pasteLink,
    checkAgain,
    moveHere,
    move,
    clearMove,
    choose,
    takeSuggestion,
    setTodos,
    setNotes,
    draftAgain,
    notesAgain,
    // Said for the recording it was asked for: another call is asked afresh.
    notesAgainError:
      notesAgainError &&
      call?.kind === "fathom" &&
      notesAgainError.rec === call.recordingId
        ? notesAgainError.text
        : null,
    notesAgainRefused: Boolean(
      notesAgainError?.refused &&
        call?.kind === "fathom" &&
        notesAgainError.rec === call.recordingId,
    ),
    notesReplaced: Boolean(notesUndo),
    takeNewNotes,
    keepNotes,
    undoNotes,
    redraft,
    keepMine,
    keepTheirs,
    sendNotes,
    readAgain,
    rereading,
    recapAgain,
    recapMoved,
    recapAsking,
    recapError,
    recapRefused,
    discardRestart: () => restart(true),
    finishOther: () => setOtherDismissed(true),
    startForThisCall: () => restart(true),
    openTranscript,
    closeTranscript: () => setTranscript(t => ({ ...t, text: null })),
  };
}
