import {
  type CallsAnswer,
  type CallView,
  CheckinError,
  type DraftKind,
  type DraftsAnswer,
  type DraftView,
  type EffectView,
  OFFLINE,
  type OpenAnswer,
  type ResponseView,
} from "@/forms/checkinClient";
import {
  type Answers,
  callOf,
  checkValue,
  SCHEMA,
  sameValue,
  todosOf,
} from "@/forms/checkinForm";
import type { Change, SaveResult } from "@/forms/fieldSaver";
import { kuwaitDay } from "@/forms/formTime";
import type { CheckinIO } from "@/forms/useCheckin";
import type {
  ApproveAnswer,
  MessagesIO,
  MessageView,
} from "@/lib/clientMessages";
import type { Timeline } from "@/lib/csmCalls";
import { displayLabel, shortDay } from "@/lib/format";

/**
 * Invented clients, calls and drafts for the 1-1 notes window: every state
 * of docs/forms/STAGE2-CONTRACT.md 8.5 for the harness
 * (src/dev/checkinHarness.tsx) and the window's tests. Nothing here is a
 * real client, contact, meeting link or recording: the names, card IDs,
 * recording IDs and Fathom links are made up.
 *
 * `fakeCheckin(scenario)` is the backend in memory: the RPCs answer the way
 * the contract says the database does (a shadow submit plans eight effects,
 * `dry_run` or `skipped`, and writes nothing else), and the forms API
 * answers the pull, the drafts and the transcript from the scenario.
 */

export const TASK = "86exfix01";
export const NAME = "Cedar & Stone Interiors";
export const OTHER = "Harbor Glassworks";
/** Made up, at the length of the longest live client name. */
export const LONG_OTHER =
  "Harbor Glassworks & Marina Interior Fit-Out Contracts";
/** Sunday 25 October 2026, 11:30 in Kuwait. */
export const NOW = "2026-10-25T08:30:00Z";
/**
 * A clock that starts at NOW and runs on real timers, so a fixture row's age
 * reads as it was written (an approval a minute old, not a week old).
 */
export function fixtureClock() {
  const started = Date.now();
  return {
    now: () => Date.parse(NOW) + (Date.now() - started),
    set: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
    clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}
export const RESPONSE_ID = "0b5f7c9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f";
export const NEW_ID = "4e1d2c3b-5a69-4f78-8e9d-0a1b2c3d4e5f";

const REC = "190000101";
const REC2 = "190000102";
const REC3 = "190000103";
const REC4 = "190000104";
const REC5 = "190000105";
const REC6 = "190000106";
const REC7 = "190000107";
const SHARE = "https://fathom.video/share/EXAMPLEaaaa1111";
const SHARE2 = "https://fathom.video/share/EXAMPLEbbbb2222";

/** The check-in booked for 10:30 Kuwait, and the recording 4 minutes after. */
const BOOKED = "2026-10-25T07:30:00Z";
const REC_START = "2026-10-25T07:34:00Z";
const REC_END = "2026-10-25T08:08:00Z";

const booking = {
  callId: 50001,
  startsAt: BOOKED,
  kind: "checkin",
  status: "confirmed",
};

const view = (over: Partial<CallView>): CallView => ({
  ref: `fathom:${REC}`,
  kind: "fathom",
  recordingId: REC,
  callId: 60001,
  title: "Impromptu Google Meet Meeting",
  startsAt: REC_START,
  endsAt: REC_END,
  minutes: 34,
  why: "same_room",
  label: "exact",
  ask: false,
  whyText: "Same room as the check-in booked for 10:30.",
  booking,
  shareUrl: SHARE,
  recorder: "csm",
  recorderRole: "the CSM",
  actionItems: 12,
  hasSummary: true,
  hasTranscript: false,
  onClient: "this",
  otherClient: null,
  blocked: null,
  notesAlready: null,
  duplicateOf: null,
  movable: false,
  ...over,
});

/** A recording on a client this seat may not see (calls.ts `onOther(null)`). */
export const UNNAMED =
  "On another client. If that is wrong, ask an admin to move it.";
/** Outside Customer Success and not tied to this client (fathom.ts `OUTSIDE_CS`). */
export const OUTSIDE_CS =
  "That recording is from outside Customer Success and is not on this client. If it is this client's call, ask an admin to match it.";
/**
 * Outside Customer Success, its call row on this client only by a likely
 * sign, so the tie rule refuses it (fathom.ts `OUTSIDE_CS_LIKELY`, A7.14's
 * second sentence, A7.18).
 */
export const OUTSIDE_CS_LIKELY =
  "That recording is from outside Customer Success and was put on this client only by a name or email domain in it. If it is this client's call, ask an admin to send the 1-1 notes with it.";

/** Each "This call" state of 8.5 as the pull would answer it. */
export const VIEWS = {
  same_room: view({}),
  invitee_email: view({
    why: "invitee_email",
    whyText: "The client was on the invite.",
  }),
  pasted: view({
    why: "pasted",
    whyText: "From the Fathom link you pasted.",
  }),
  /** Its link is in an earlier 1-1 form: it reads as pasted too (5.2). */
  form_link: view({
    why: "pasted",
    whyText: "From the link in an earlier 1-1 form.",
    notesAlready: { at: "2026-10-25T08:10:00Z", source: "typeform" },
  }),
  matched: view({
    why: "matched",
    whyText: `On ${NAME} in the call store.`,
  }),
  likely: view({
    why: "speaker_name",
    label: "likely",
    ask: true,
    whyText: `${NAME}'s contact spoke on this call. Is this the call?`,
  }),
  possible_csm: view({
    why: "near_booking",
    label: "possible",
    ask: true,
    whyText:
      "Your recording 4 minutes after the check-in booked for 10:30. Is this the call?",
  }),
  possible_admin: view({
    why: "near_booking",
    label: "possible",
    ask: true,
    whyText:
      "The CSM's recording 4 minutes after the check-in booked for 10:30. Is this the call?",
  }),
  default_csm: view({
    why: "latest_unlinked",
    label: "default",
    ask: true,
    booking: null,
    whyText:
      "Your newest call that no client has yet (Sun 25 Oct, 10:34). Is this the call?",
  }),
  default_admin: view({
    why: "latest_unlinked",
    label: "default",
    ask: true,
    booking: null,
    whyText:
      "The CSM's newest call that no client has yet (Sun 25 Oct, 10:34). Is this the call?",
  }),
  booking: view({
    ref: "booking:50001",
    kind: "booking",
    recordingId: null,
    callId: 50001,
    title: null,
    startsAt: BOOKED,
    endsAt: "2026-10-25T08:00:00Z",
    minutes: 30,
    why: "booking",
    label: "booking",
    whyText: "The check-in booked for 10:30. No recording found for it.",
    shareUrl: null,
    recorder: null,
    recorderRole: null,
    actionItems: null,
    hasSummary: false,
  }),
  /** 25 minutes before the booked check-in: a hint, in A7.3's words. */
  hint: view({
    ref: `fathom:${REC7}`,
    recordingId: REC7,
    callId: 60007,
    startsAt: "2026-10-25T07:05:00Z",
    endsAt: "2026-10-25T07:15:00Z",
    minutes: 10,
    why: "hint_window",
    label: "hint",
    whyText: `25 min before ${NAME}'s booked call.`,
    shareUrl: "https://fathom.video/share/EXAMPLEgggg7777",
    actionItems: 2,
    onClient: "none",
  }),
  /** On another client: listed, disabled, with its sentence (A7.3). */
  other_client: view({
    ref: `fathom:${REC3}`,
    recordingId: REC3,
    callId: 60003,
    title: "Site visit follow-up",
    startsAt: "2026-10-24T13:00:00Z",
    endsAt: "2026-10-24T13:40:00Z",
    minutes: 40,
    why: "picked",
    label: "hint",
    whyText: "",
    booking: null,
    onClient: "other",
    otherClient: OTHER,
    blocked: `On ${OTHER}. If that is wrong, ask an admin to move it.`,
  }),
  /**
   * On another client, for an admin with Move it here switched on
   * (STAGE2B-CONTRACT.md 3.8): the door's `onOtherMovable` sentence.
   */
  other_movable: view({
    ref: `fathom:${REC3}`,
    recordingId: REC3,
    callId: 60003,
    title: "Impromptu Google Meet",
    startsAt: "2026-10-25T07:34:00Z",
    endsAt: "2026-10-25T08:08:00Z",
    minutes: 34,
    why: "picked",
    label: "hint",
    whyText: "",
    booking: null,
    recorder: "team",
    recorderRole: "the account manager",
    onClient: "other",
    otherClient: OTHER,
    blocked: `On ${OTHER}. If this is ${NAME}'s call, move it here.`,
    movable: true,
  }),
  /** The same on a client whose name runs long (53 characters, as live has). */
  other_movable_long: view({
    ref: "fathom:44444444-0000-4000-8000-000000000053",
    recordingId: "44444444-0000-4000-8000-000000000053",
    callId: 60053,
    title: "Impromptu Google Meet",
    startsAt: "2026-10-25T06:34:00Z",
    endsAt: "2026-10-25T07:08:00Z",
    minutes: 34,
    why: "picked",
    label: "hint",
    whyText: "",
    booking: null,
    recorder: "team",
    recorderRole: "the account manager",
    onClient: "other",
    otherClient: LONG_OTHER,
    blocked: `On ${LONG_OTHER}. If this is ${NAME}'s call, move it here.`,
    movable: true,
  }),
  /** No sign for this client (why picked, no why line), recorded by the team. */
  team: view({
    ref: `fathom:${REC2}`,
    recordingId: REC2,
    callId: 60002,
    title: "Content review",
    startsAt: "2026-10-24T09:00:00Z",
    endsAt: "2026-10-24T09:25:00Z",
    minutes: 25,
    why: "picked",
    label: "hint",
    whyText: "",
    booking: null,
    recorder: "team",
    recorderRole: "the creative director",
    actionItems: 3,
    notesAlready: { at: "2026-10-24T10:10:00Z", source: "typeform" },
    shareUrl: SHARE2,
    onClient: "none",
  }),
  /** No sign for this client, recorded by the CSM: the row is its title line. */
  no_sign: view({
    ref: `fathom:${REC4}`,
    recordingId: REC4,
    callId: 60004,
    title: "Impromptu Zoom Meeting",
    startsAt: "2026-10-24T11:00:00Z",
    endsAt: "2026-10-24T11:12:00Z",
    minutes: 12,
    why: "picked",
    label: "hint",
    whyText: "",
    booking: null,
    shareUrl: "https://fathom.video/share/EXAMPLEdddd4444",
    actionItems: 1,
    hasSummary: false,
    onClient: "none",
  }),
  /** A pasted team meeting: listed, disabled, never picked. */
  team_meeting: view({
    ref: `fathom:${REC5}`,
    recordingId: REC5,
    callId: null,
    title: "Weekly team sync",
    startsAt: "2026-10-22T06:00:00Z",
    endsAt: "2026-10-22T06:45:00Z",
    minutes: 45,
    why: "pasted",
    label: "hint",
    whyText: "",
    booking: null,
    shareUrl: "https://fathom.video/share/EXAMPLEeeee5555",
    recorder: "team",
    recorderRole: "the creative director",
    actionItems: null,
    hasSummary: false,
    onClient: "none",
    blocked: "That recording is a team meeting, not a client call.",
  }),
  /** A pasted recording Fathom no longer has. */
  gone: view({
    ref: `fathom:${REC6}`,
    recordingId: REC6,
    callId: 60006,
    startsAt: "2026-10-20T07:30:00Z",
    endsAt: "2026-10-20T08:00:00Z",
    minutes: 30,
    why: "pasted",
    label: "hint",
    whyText: "",
    booking: null,
    shareUrl: "https://fathom.video/share/EXAMPLEffff6666",
    actionItems: null,
    hasSummary: false,
    onClient: "none",
    blocked: "Fathom no longer has that recording. Pick another call.",
  }),
  /**
   * On a client this seat may not see (A7.3, calls.ts `unnamed`): listed
   * disabled with the unnamed sentence, and only its time, its length and
   * the recorder's role; no title, link, booking, items or marks.
   */
  unnamed: view({
    ref: "fathom:190000108",
    recordingId: "190000108",
    callId: 60008,
    title: null,
    startsAt: "2026-10-24T15:00:00Z",
    endsAt: "2026-10-24T15:30:00Z",
    minutes: 30,
    why: "picked",
    label: "hint",
    whyText: "",
    booking: null,
    shareUrl: null,
    recorder: "team",
    recorderRole: "the account manager",
    actionItems: null,
    hasSummary: false,
    hasTranscript: false,
    onClient: "other",
    otherClient: null,
    blocked: UNNAMED,
    notesAlready: null,
  }),
  /**
   * Recorded outside Customer Success, its link pasted, and the tie rule does
   * not let this seat use it (A7.14): listed disabled with its sentence.
   */
  outside_cs: view({
    ref: "fathom:190000109",
    recordingId: "190000109",
    callId: 60009,
    title: "Kitchen packages walkthrough",
    startsAt: "2026-10-24T17:00:00Z",
    endsAt: "2026-10-24T17:20:00Z",
    minutes: 20,
    why: "pasted",
    label: "hint",
    whyText: "",
    booking: null,
    shareUrl: "https://fathom.video/share/EXAMPLEhhhh8888",
    recorder: "other",
    recorderRole: "the sales closer",
    actionItems: 4,
    hasSummary: true,
    onClient: "none",
    blocked: OUTSIDE_CS,
  }),
  /**
   * Recorded outside Customer Success by an admin-only seat, and put on this
   * client by the worker from a name in it (A7.14 rule 2 does not tie it):
   * listed disabled with the second sentence, not pasted, no link.
   */
  outside_cs_likely: view({
    ref: "fathom:190000110",
    recordingId: "190000110",
    callId: 60010,
    title: "Showroom lighting options",
    startsAt: "2026-10-24T13:00:00Z",
    endsAt: "2026-10-24T13:25:00Z",
    minutes: 25,
    why: "picked",
    label: "hint",
    whyText: "",
    booking: null,
    shareUrl: null,
    recorder: "other",
    recorderRole: "an admin",
    actionItems: 3,
    hasSummary: true,
    onClient: "this",
    blocked: OUTSIDE_CS_LIKELY,
  }),
} satisfies Record<string, CallView>;

export type Scenario = {
  /** Who is looking: the CSM seat, or an admin or the CEO. */
  seat?: "csm" | "admin";
  mode?: "shadow" | "live";
  /** The registry's mode at the open (a shadow draft after the cut-over). */
  formMode?: "shadow" | "live";
  /**
   * How the open answers; `void` and `other_seat` are for the ID this tab
   * kept (RESPONSE_ID): this seat's discarded notes, returned as a read
   * (A7.5), or another seat's, refused.
   */
  open?: "new" | "resumed" | "submitted" | "fail" | "void" | "other_seat";
  openError?: string;
  /** The answers already saved (a resumed draft or a sent one). */
  answers?: Answers;
  /** Who saved each of them, and from what (`from`: "fathom.action_items"). */
  meta?: ResponseView["meta"];
  happiness?: string | null;
  picked?: CallView | null;
  others?: CallView[];
  fathom?: CallsAnswer["fathom"];
  callsError?: string;
  /** What the drafts answer, per kind; a list is answered one poll at a time. */
  drafts?: Partial<Record<DraftKind, DraftView | DraftView[]>>;
  /** The recap's answers after the send, one poll at a time. */
  recap?: DraftView[];
  /**
   * What Draft again answers, per kind: the drafts from then on (a list is
   * answered one read at a time, starting with Draft again's own answer),
   * the server's refusal (`Five drafts is the limit for this call.`), or a
   * request that never reached the server (the connection dropped).
   */
  again?: Partial<
    Record<
      DraftKind,
      DraftView | DraftView[] | { refused: string } | { unreached: true }
    >
  >;
  /**
   * The pasted link: found, unknown, or not Fathom's; or found and blocked
   * (a team meeting, gone, on another client).
   */
  paste?:
    | "found"
    | "unknown"
    | "not_fathom"
    | "team_meeting"
    | "gone"
    | "other_client";
  saveRefusal?: { key: string; text: string };
  conflict?: { key: string; theirs: unknown };
  submitRefusal?: { text: string; code?: string };
  timeline?: Timeline | "fail";
  transcript?: "text" | "none";
  /** The effects' states after the send (a cockpit-owned trail in 2b). */
  effects?: (answers: Answers, at: string) => EffectView[];
  latency?: number;
  /** Calls that never answer (a state caught in the middle). */
  hold?: ("open" | "save" | "submit")[];
  /** A save that fails the way a dropped connection does. */
  saveError?: string;
  /**
   * Move it here (STAGE2B-CONTRACT.md 4.11): moved, refused in the
   * server's words, or not in the database yet.
   */
  move?: "ok" | "not_live" | { refused: string };
  /** Reading the response back fails with this sentence, or never answers. */
  readError?: string | "never";
};

// ------------------------------------------------------------ drafts

export const draft = (
  kind: DraftKind,
  state: DraftView["state"],
  output: Record<string, unknown> | null = null,
  reason: string | null = null,
): DraftView => ({
  kind,
  state,
  attempt: 1,
  provider:
    kind === "todos"
      ? "none"
      : kind === "client_notes"
        ? "deepseek"
        : "anthropic",
  model: null,
  promptVersion: `checkin.${kind}.v1`,
  at: NOW,
  reason,
  output,
});

export const TODOS_READY = draft("todos", "ready", {
  items: [
    {
      side: "we",
      text: "Send the revised offer with the new kitchen packages",
      owner: "the CSM",
      at: 761,
      href: `${SHARE}?tab=summary&timestamp=761`,
      unsure: false,
    },
    {
      side: "we",
      text: "Pause the villa campaign until the new photos are in",
      owner: "the media buyer",
      at: 1012,
      href: `${SHARE}?tab=summary&timestamp=1012`,
      unsure: false,
    },
    {
      side: "we",
      text: "Check why two leads came in without a phone number",
      owner: null,
      at: 1490,
      href: `${SHARE}?tab=summary&timestamp=1490`,
      unsure: true,
    },
    {
      side: "they",
      text: "Share photos of the two finished villa projects",
      owner: null,
      at: 1330,
      href: `${SHARE}?tab=summary&timestamp=1330`,
      unsure: false,
    },
    {
      side: "they",
      text: "Confirm the budget for November",
      owner: null,
      at: 1802,
      href: null,
      unsure: false,
    },
  ],
  nextSteps: [
    { text: "Book a site visit for the new showroom", at: 1900, href: null },
  ],
});
export const TODOS_NONE = draft("todos", "ready", { items: [], nextSteps: [] });

export const NOTES_READY = draft("client_notes", "ready", {
  text: "Calm and positive about the leads. Wants more enquiries for full villa fit-outs, fewer for single rooms. Mentioned the budget may move to the new showroom in December.",
});
/** The draft Draft again brings. */
export const NOTES_AGAIN = draft("client_notes", "ready", {
  text: "Positive overall. Wants the next batch of leads to favour full villa fit-outs, and expects the budget to move to the new showroom in December.",
});
export const NOTES_ARABIC = draft("client_notes", "ready", {
  text: "مرتاح من جودة الطلبات، ويبي يركز على الفلل الكاملة بدل الغرف المفردة. قال إن الميزانية ممكن تنتقل للمعرض اليديد في ديسمبر.",
});

export const DEFCON_READY = draft("defcon_priority", "ready", {
  defcon: {
    value: "At Risk",
    quote: "If the next batch is the same, we will pause in December.",
    at: 761,
    href: `${SHARE}?tab=summary&timestamp=761`,
    why: "Talk of pausing",
  },
  priority: {
    value: "High",
    quote: "We need the new offer before the weekend.",
    at: 1330,
    href: `${SHARE}?tab=summary&timestamp=1330`,
    why: "2 urgent asks",
  },
});
export const DEFCON_NO_QUOTE = draft("defcon_priority", "ready", {
  defcon: null,
  priority: null,
});

export const SUMMARY_WAIT =
  "Fathom is still writing this call's summary. Drafts start when it is ready.";
/** The summary is there, but no transcript line can be read yet (drafts.ts). */
export const TRANSCRIPT_WAIT =
  "Fathom is still writing this call's transcript. Drafts start when it is ready.";
/** The model found nothing in the call worth sending to the client (prompts/recap.ts). */
export const NOTHING_TO_SEND = "Nothing worth sending from this call.";

/** No Fathom key in the vault: the note the calls answer carries (calls.ts offNote). */
export const OFF_NOTE =
  "Fathom isn't connected, so calls come only from the 15-minute read.";
export const OFF_ASK = `${OFF_NOTE} Ask the CEO to connect it.`;
export const OFF_PASTE = `${OFF_NOTE} Paste the Fathom key in CEO > Client success > Connections for 1-1 notes.`;

const RECAP_MESSAGE =
  "هلا والله، شكرًا على وقتكم اليوم. الزبدة من طرفكم:\n- تشاركونا صور مشروعين الفلل اللي خلصت\n- تأكدون ميزانية نوفمبر\n\nواحنا بنرد لكم بالعرض اليديد قبل نهاية الأسبوع.\nفريق مهارة";
/** Make [23]'s check-in block in its words, with an invented booking link. */
const RECAP_BOOKING = [
  "إذا ما حجزت مكالمة المتابعة لين الحين، تقدر تحجزها من هنا:",
  "https://booking.example.test/checkin",
  "عادة نخلي أسبوع تقريبًا بين مكالمات المتابعة، عشان يكون فيه تقدم واضح نستعرضه معك.",
].join("\n");

/** A ready recap as the server answers it: `text` is the stored text (A7.4). */
export const RECAP_READY = draft("recap", "ready", {
  skip: false,
  message: RECAP_MESSAGE,
  text: `${RECAP_MESSAGE}\n\n${RECAP_BOOKING}`,
  checks: [],
});

// ------------------------------------------------------------ the timeline

export function fixtureTimeline(): Timeline {
  return {
    taskId: TASK,
    clientName: NAME,
    calls: [
      {
        id: 40001,
        source: "ghl_appointment",
        kind: "checkin",
        status: "confirmed",
        upcoming: true,
        startsAt: "2026-11-02T07:30:00Z",
        endsAt: "2026-11-02T08:00:00Z",
      },
      {
        id: 40002,
        source: "fathom",
        kind: "checkin",
        status: "held",
        upcoming: false,
        startsAt: "2026-10-14T07:30:00Z",
        endsAt: "2026-10-14T08:05:00Z",
        recordingUrl: "https://fathom.video/share/EXAMPLEcccc3333",
      },
    ],
    forms: [
      {
        token: "fixture-1014",
        formId: "fRokTITH",
        kind: "checkin",
        submittedAt: "2026-10-14T09:00:00Z",
        linkedCallId: 40002,
        answers: [
          { title: "Defcon Status", value: "Neutral" },
          { title: "Task Priority", value: "High" },
          {
            title: "Additional Notes",
            value:
              "Mahara: Send the November content plan\nMahara: Add the showroom to the lead form\nClient: Send the logo files",
          },
        ],
      },
    ],
    changes: [],
    health: [
      {
        key: "csm-ghl-calls",
        ok: true,
        lastOkAt: NOW,
      },
      { key: "csm-fathom", ok: true, lastOkAt: NOW },
      { key: "csm-checkin-form", ok: true, lastOkAt: NOW },
    ],
    unmatchedCount: 0,
  };
}

// ------------------------------------------------------------ the plan (7.1)

const LABELS: [string, string, string][] = [
  ["call_form", "Notes where the client brief reads them", "sql"],
  ["call_match", "The recording on this client", "sql"],
  ["todo_comment", "To-do comment on the card", "clickup_queue"],
  ["happiness", "Client Happiness", "clickup_queue"],
  ["last_poc", "Last POC", "clickup_queue"],
  ["last_checkin_call", "Last Check-in Call", "clickup_queue"],
  ["grade_notice", "Call grade in #client-call-feedback", "slack_notice"],
  ["recap", "Recap for the client's group", "client_message"],
];

/** The eight effects a shadow submit plans, `dry_run` or `skipped` (7.1, 7.3). */
export function shadowEffects(answers: Answers, at: string): EffectView[] {
  const call = callOf(answers.call);
  const fathom = call?.kind === "fathom";
  const ours = todosOf(answers.we_owe).length;
  const theirs = todosOf(answers.they_owe).length;
  const end =
    call?.kind === "fathom"
      ? (call.endsAt ?? call.startsAt ?? at)
      : call?.kind === "booking"
        ? (call.startsAt ?? at)
        : at;
  const start =
    call?.kind === "fathom" || call?.kind === "booking"
      ? (call.startsAt ?? at)
      : at;
  const day = (iso: string) => shortDay(kuwaitDay(iso));
  const skip: Record<string, string | null> = {
    call_match: fathom ? null : "No recording to put on this client.",
    todo_comment:
      ours + theirs ? null : "No comment: We owe and They owe are empty.",
    grade_notice: fathom ? null : "No grade: no recording for this call.",
    recap: fathom ? null : "No recap: no recording for this call.",
  };
  const line: Record<string, string> = {
    call_form:
      "Would save the notes where the client brief and Today read them.",
    call_match: `Would put this recording on ${NAME}.`,
    todo_comment: `Would post the to-do comment on the card: ${ours + theirs} lines, recording link first.`,
    happiness: `Would set Client Happiness to ${displayLabel(String(answers.defcon ?? ""))}.`,
    last_poc: `Would set Last POC to ${day(end)}, only if the card's date is older.`,
    last_checkin_call: `Would set Last Check-in Call to ${day(start)}, only if the card's date is older.`,
    grade_notice: "Would post the call grade in #client-call-feedback.",
    recap: "Would hold the client's recap for approval in the cockpit.",
  };
  return LABELS.map(([key, label, delivery]) => ({
    key,
    label,
    owner: "shadow",
    delivery,
    state: skip[key] ? "skipped" : "dry_run",
    at,
    reason: skip[key] ?? null,
    lines: skip[key] ? [] : [line[key]],
  }));
}

/** A trail the cockpit delivers (2b): every stop of 8.5's table. */
export function cockpitEffects(answers: Answers, at: string): EffectView[] {
  const settled = "2026-10-25T08:11:00Z";
  const states: Record<string, [EffectView["state"], string | null]> = {
    call_form: ["delivered", null],
    call_match: ["delivered", null],
    todo_comment: ["delivered", null],
    happiness: ["delivered", null],
    last_poc: ["skipped", "Last POC stays 26 Oct: it is newer than this call."],
    last_checkin_call: ["delivered", null],
    grade_notice: ["queued", null],
    recap: ["planned", null],
  };
  return shadowEffects(answers, at).map(e => ({
    ...e,
    owner: "cockpit" as const,
    state: states[e.key][0],
    reason: states[e.key][1],
    at: settled,
  }));
}

/** A trail with the two stops that need a person (2b). */
export function troubleEffects(answers: Answers, at: string): EffectView[] {
  return cockpitEffects(answers, at).map(e =>
    e.key === "todo_comment"
      ? {
          ...e,
          state: "failed" as const,
          reason: "ClickUp refused the comment (400).",
        }
      : e.key === "grade_notice"
        ? {
            ...e,
            state: "unknown" as const,
            reason: "Slack did not answer in time.",
          }
        : e,
  );
}

/** Make still owns the to-do comment (owner `make`, skipped). */
export function makeEffects(answers: Answers, at: string): EffectView[] {
  return shadowEffects(answers, at).map(e =>
    e.key === "todo_comment"
      ? {
          ...e,
          owner: "make" as const,
          state: "skipped" as const,
          reason: "Make does this until the switch-over.",
          lines: [],
        }
      : e,
  );
}

// ------------------------------------------------------------ the backend in memory

export interface Fake {
  io: CheckinIO;
  calls: { name: string; args: unknown }[];
  /** How many times each operation ran. */
  count: (name: string) => number;
  state: { response: ResponseView | null };
}

const wait = (ms: number) =>
  ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();

export function fakeCheckin(s: Scenario = {}): Fake {
  const calls: Fake["calls"] = [];
  const mode = s.mode ?? "shadow";
  const formMode = s.formMode ?? mode;
  let response: ResponseView | null = null;
  let effects: EffectView[] = [];
  let recapPolls = 0;
  /** The recording Move it here put on this client. */
  let moved: string | null = null;
  const draftPolls: Partial<Record<DraftKind, number>> = {};
  const lag = () => wait(s.latency ?? 0);
  const held = (name: "open" | "save" | "submit") =>
    s.hold?.includes(name) ? new Promise<never>(() => {}) : Promise.resolve();
  const log = (name: string, args: unknown) => calls.push({ name, args });

  const makeResponse = (id: string, over: Partial<ResponseView> = {}) => ({
    id,
    formKey: "checkin",
    formVersion: 1,
    mode,
    state: "draft" as const,
    revision: 1,
    taskId: TASK,
    clientName: NAME,
    answers: {},
    meta: {},
    createdAt: NOW,
    submittedAt: null,
    ...over,
  });

  /** The drafts as they stand: Draft again's answers replace a kind's. */
  const current: NonNullable<Scenario["drafts"]> = { ...(s.drafts ?? {}) };
  const draftsNow = (): DraftView[] => {
    const out: DraftView[] = [];
    for (const [k, v] of Object.entries(current) as [
      DraftKind,
      DraftView | DraftView[],
    ][]) {
      if (Array.isArray(v)) {
        const n = draftPolls[k] ?? 0;
        draftPolls[k] = n + 1;
        out.push(v[Math.min(n, v.length - 1)]);
      } else out.push(v);
    }
    if (response && response.state !== "draft") {
      const list = s.recap ?? [draft("recap", "drafting"), RECAP_READY];
      out.push(list[Math.min(recapPolls, list.length - 1)]);
      recapPolls += 1;
    } else
      out.push(
        draft(
          "recap",
          "skipped",
          null,
          "The recap is drafted after you send the notes.",
        ),
      );
    return out;
  };

  const draftsAnswer = (): DraftsAnswer => {
    const call = callOf(response?.answers.call ?? null);
    return {
      recordingId: call?.kind === "fathom" ? call.recordingId : null,
      drafts: draftsNow(),
      started: [],
      now: NOW,
    };
  };

  const callsAnswer = (shareUrl: string | null): CallsAnswer => {
    if (s.callsError) throw Error(s.callsError);
    if (shareUrl && s.paste === "not_fathom")
      throw new CheckinError("That is not a Fathom link.", null, 400);
    // The pasted recording comes back with why `pasted`, blocked or not.
    const kind = shareUrl ? s.paste : undefined;
    const pasted =
      kind === "found"
        ? [
            {
              ...VIEWS.pasted,
              ref: `fathom:${REC2}`,
              recordingId: REC2,
              shareUrl: SHARE2,
            },
          ]
        : kind === "team_meeting" || kind === "gone" || kind === "other_client"
          ? [{ ...VIEWS[kind], why: "pasted" }]
          : [];
    // A moved recording is this client's now: listed as on it, teal.
    const here = (v: CallView): CallView =>
      v.recordingId && v.recordingId === moved
        ? {
            ...v,
            why: "matched",
            label: "exact",
            whyText: `On ${NAME} in the call store.`,
            onClient: "this",
            otherClient: null,
            blocked: null,
            movable: false,
          }
        : v;
    const picked = s.picked === undefined ? VIEWS.same_room : s.picked;
    return {
      picked: picked ? here(picked) : picked,
      others: [...(s.others ?? []), ...pasted].map(here),
      fathom: s.fathom ?? { state: "ok", checkedAt: NOW, note: null },
      now: NOW,
    };
  };

  const io: CheckinIO = {
    async open(a) {
      log("open", a);
      await lag();
      await held("open");
      if (s.open === "fail")
        throw new CheckinError(
          s.openError ?? "Failed to fetch",
          s.openError?.includes("access") ? "42501" : null,
          null,
        );
      const form: OpenAnswer["form"] = {
        key: "checkin",
        title: "1-1 call notes",
        provider: formMode === "live" ? "native" : "typeform",
        version: 1,
        schema: SCHEMA,
        effects: LABELS.map(([key, label, delivery]) => ({
          key,
          label,
          delivery,
          owner: "shadow" as const,
        })),
        mode: formMode,
      };
      const client = {
        taskId: TASK,
        name: NAME,
        stage: "Active",
        happiness: s.happiness === undefined ? "Happy" : s.happiness,
      };
      if (a.rehearse)
        return { form, response: null, client, rehearse: true, now: NOW };
      if (s.open === "other_seat" && a.responseId === RESPONSE_ID)
        throw new CheckinError(
          "These notes belong to another seat.",
          "42501",
          null,
        );
      if (s.open === "void" && a.responseId === RESPONSE_ID)
        return {
          form,
          response: makeResponse(RESPONSE_ID, {
            state: "void",
            answers: FILLED,
            createdAt: "2026-10-24T09:00:00Z",
          }),
          client,
          rehearse: false,
          now: NOW,
        };
      if (!response) {
        if (s.open === "resumed")
          response = makeResponse(RESPONSE_ID, {
            answers: s.answers ?? {},
            meta: s.meta ?? {},
            revision: 4,
            createdAt: "2026-10-25T07:02:00Z",
          });
        else if (s.open === "submitted") {
          response = makeResponse(RESPONSE_ID, {
            answers: s.answers ?? {},
            state: "submitted",
            submittedAt: "2026-10-25T08:10:00Z",
          });
          effects = (s.effects ?? shadowEffects)(
            response.answers,
            "2026-10-25T08:10:00Z",
          );
        } else
          response = makeResponse(a.responseId ?? NEW_ID, {
            answers: s.answers ?? {},
          });
      }
      return { form, response, client, rehearse: false, now: NOW };
    },
    async save(a): Promise<SaveResult> {
      log("save", a);
      await lag();
      await held("save");
      if (s.saveError) throw Error(s.saveError);
      if (!response) throw Error("No notes are open.");
      const applied: string[] = [];
      const conflicts: SaveResult["conflicts"] = [];
      const next = { ...response.answers };
      for (const [k, c] of Object.entries(a.changes) as [string, Change][]) {
        if (s.saveRefusal?.key === k)
          throw new CheckinError(s.saveRefusal.text, "22023", null);
        if (
          s.conflict?.key === k &&
          !sameValue(c.seen, s.conflict.theirs) &&
          !conflicts.length
        ) {
          next[k] = s.conflict.theirs;
          conflicts.push({
            key: k,
            theirs: s.conflict.theirs,
            by: "Dana",
            at: "2026-10-25T08:05:00Z",
          });
          continue;
        }
        const v = checkValue(k, c.value);
        if ("error" in v) throw new CheckinError(v.error, "22023", null);
        let value = v.value;
        // The server reads the call's times, link and title from the store.
        const call = callOf(value);
        if (call?.kind === "fathom") {
          const known = [
            ...Object.values(VIEWS),
            ...(s.others ?? []),
            ...(s.picked ? [s.picked] : []),
          ].find(x => x.recordingId === call.recordingId);
          value = {
            ...call,
            callId: known?.callId ?? null,
            shareUrl: known?.shareUrl ?? null,
            startsAt: known?.startsAt ?? REC_START,
            endsAt: known?.endsAt ?? REC_END,
            title: known?.title ?? "Fathom recording",
            recorder: known?.recorder ?? "csm",
          };
        } else if (call?.kind === "booking")
          value = {
            ...call,
            startsAt: BOOKED,
            endsAt: "2026-10-25T08:00:00Z",
            confirmed: true,
          };
        else if (call?.kind === "none") value = { ...call, confirmed: true };
        if (value === null) delete next[k];
        else next[k] = value;
        applied.push(k);
      }
      const revision = response.revision + (applied.length ? 1 : 0);
      response = { ...response, answers: next, revision };
      return {
        row: { answers: next, meta: {}, revision },
        applied,
        conflicts,
      };
    },
    async submit(a) {
      log("submit", a);
      await lag();
      await held("submit");
      if (!response) throw Error("No notes are open.");
      if (s.submitRefusal)
        throw new CheckinError(
          s.submitRefusal.text,
          s.submitRefusal.code ?? "22023",
          null,
        );
      if (response.state !== "draft")
        return { response, effects, duplicate: true };
      const at = "2026-10-25T08:10:00Z";
      response = {
        ...response,
        state: "submitted",
        submittedAt: at,
      };
      effects = (s.effects ?? shadowEffects)(response.answers, at);
      return { response, effects, duplicate: false };
    },
    async discard(id) {
      log("discard", id);
      await lag();
      response = null;
      return { id, state: "void" };
    },
    async read(id) {
      log("read", id);
      await lag();
      if (s.readError === "never") await new Promise(() => {});
      if (s.readError) throw Error(s.readError);
      if (!response) throw Error("No notes are open.");
      return { response, effects, drafts: draftsNow(), now: NOW };
    },
    async drafts(id) {
      log("drafts", id);
      await lag();
      return draftsAnswer();
    },
    async draftAgain(id, kind) {
      log("draftAgain", { id, kind });
      await lag();
      const next = s.again?.[kind];
      if (next && "refused" in next)
        throw new CheckinError(next.refused, "22023", null);
      if (next && "unreached" in next)
        throw new CheckinError(OFFLINE, null, null);
      if (next) {
        current[kind] = next;
        draftPolls[kind] = 0;
      }
      return draftsAnswer();
    },
    async calls(a) {
      log("calls", a);
      await lag();
      return callsAnswer(a.shareUrl);
    },
    async move(a) {
      log("move", a);
      await lag();
      if (s.move === "not_live")
        throw new CheckinError(
          "The cockpit's 1-1 notes are not live yet.",
          "PGRST202",
          null,
        );
      if (s.move && typeof s.move === "object")
        throw new CheckinError(s.move.refused, "22023", null);
      moved = a.recordingId;
      return {
        ok: true as const,
        callId: 60003,
        fromTaskId: "86exfix02",
        taskId: a.taskId,
      };
    },
    async transcript(id, rec) {
      log("transcript", { id, rec });
      await lag();
      if (s.transcript !== "text")
        throw new CheckinError(
          "No transcript yet. Open the call in Fathom.",
          null,
          404,
        );
      return {
        text: "L1 [00:00:04] CSM: Thanks for joining.\nL2 [00:00:09] Client: Happy to.",
      };
    },
    async timeline() {
      log("timeline", null);
      await lag();
      if (s.timeline === "fail") throw Error("Failed to fetch");
      return s.timeline ?? fixtureTimeline();
    },
    announce: n => log("announce", n),
  };
  return {
    io,
    calls,
    count: name => calls.filter(c => c.name === name).length,
    state: {
      get response() {
        return response;
      },
    },
  };
}

/** The answers of a finished set of notes, for the sent and resumed states. */
export const FILLED: Answers = {
  call: {
    kind: "fathom",
    recordingId: REC,
    why: "same_room",
    confirmed: true,
    callId: 60001,
    shareUrl: SHARE,
    startsAt: REC_START,
    endsAt: REC_END,
    title: "Impromptu Google Meet Meeting",
    recorder: "csm",
  },
  defcon: "At Risk",
  priority: "High",
  we_owe: todosOf([
    { text: "Send the revised offer with the new kitchen packages" },
    { text: "Pause the villa campaign until the new photos are in" },
  ]),
  they_owe: todosOf([
    { text: "Share photos of the two finished villa projects" },
  ]),
  client_notes:
    "Calm about the leads, worried about the budget for December. Wants the new offer before the weekend.",
};

// ------------------------------------------------------------ the client's messages (2b)

/** The stored recap text: the 2a draft's message, a blank line, Make's block. */
export const RECAP_BODY = `${RECAP_MESSAGE}\n\n${RECAP_BOOKING}`;
export const MESSAGE_ID = "33333333-0000-4000-8000-000000000001";
/** The window's response, whose recap message the step approves. */
export const SENT_RESPONSE_ID = RESPONSE_ID;

/** One message row as MessageView (STAGE2B-CONTRACT.md 3.7); invented. */
export function messageFixture(over: Partial<MessageView> = {}): MessageView {
  return {
    id: MESSAGE_ID,
    kind: "recap_checkin",
    state: "draft",
    taskId: TASK,
    clientName: NAME,
    responseId: RESPONSE_ID,
    body: RECAP_BODY,
    reason: null,
    callAt: REC_END,
    approvedBy: null,
    approvedAt: null,
    expiresAt: null,
    sentAt: null,
    readBack: null,
    owner: "cockpit",
    effectState: "queued",
    triesUsedUp: null,
    ...over,
  };
}

/** The 5.1 states, by name, as the card shows them. */
export function messageStates(now = NOW): Record<string, MessageView> {
  const at = (min: number) =>
    new Date(Date.parse(now) + min * 60_000).toISOString();
  // Each state its own fixed ID, the draft the window's MESSAGE_ID.
  let n = 0;
  const row = (over: Partial<MessageView> = {}) => {
    n += 1;
    return messageFixture(
      n === 1
        ? over
        : {
            id: `33333333-0000-4000-8000-${String(n).padStart(12, "0")}`,
            ...over,
          },
    );
  };
  return {
    draft: row(),
    expired: row({
      reason: "The approval ran out after 24 hours. Approve it again.",
    }),
    approved: row({
      state: "approved",
      approvedBy: "the CSM",
      approvedAt: at(-1),
      expiresAt: at(24 * 60 - 1),
    }),
    sending: row({
      state: "sending",
      approvedBy: "the CSM",
      approvedAt: at(-3),
    }),
    sent: row({
      state: "sent",
      approvedBy: "the CSM",
      approvedAt: at(-6),
      sentAt: at(-4),
      readBack: { by: "message_id", at: at(-3) },
      effectState: "delivered",
    }),
    "sent-checking": row({
      state: "sent",
      approvedBy: "the CSM",
      approvedAt: at(-2),
      sentAt: at(-1),
      effectState: "delivered",
    }),
    unknown: row({
      state: "unknown",
      approvedBy: "the CSM",
      approvedAt: at(-20),
      reason:
        "The sender stopped while sending. Look in the group before anything else.",
      effectState: "unknown",
    }),
    refused: row({
      state: "refused",
      reason:
        "No WhatsApp group on Client Data for this card. Add it to Client Data column F, then try again.",
    }),
    failed: row({
      state: "failed",
      reason: "WhatsApp answered 400. Check the group on Client Data.",
      effectState: "failed",
    }),
    skipped: row({
      state: "skipped",
      reason: "Skipped by the CSM.",
      effectState: "skipped",
    }),
    /** After a rollback: the draft stays, and Make owns the recap again. */
    "handed-back": row({ owner: "make" }),
    /** Refused at its fourth try, in the sender's sentence. */
    "tries-used-up": row({
      state: "refused",
      reason:
        "This recap was tried three times and did not go. Send it by hand in the group if it is still needed, then skip it here.",
      triesUsedUp: true,
    }),
  };
}

/** One week of a client's messages: the newest waiting, an older one sent. */
export function messagesWeek(now = NOW): MessageView[] {
  const st = messageStates(now);
  return [
    st.draft,
    {
      ...st.sent,
      id: "33333333-0000-4000-8000-0000000000b2",
      responseId: "11111111-0000-4000-8000-0000000000b2",
      callAt: "2026-10-22T08:00:00Z",
      sentAt: "2026-10-22T11:12:00Z",
      readBack: { by: "message_id", at: "2026-10-22T11:13:00Z" },
    },
  ];
}

export type MessagesScenario = {
  /** The first approve answers with warnings to confirm. */
  warn?: string[];
  /** The approve is refused by the check, in its words. */
  refuse?: string;
  /** The read fails. */
  readError?: string;
  /** Rows Today lists (cockpit_client_messages_waiting). */
  waiting?: MessageView[];
  latency?: number;
};

/**
 * The messages in memory, answering as recap.approve and the RPCs do:
 * warnings first when asked, the check's refusal, approve to approved
 * (+24 hours), Skip, reopen. Nothing leaves the page.
 */
export function fakeMessages(
  start: MessageView[],
  s: MessagesScenario = {},
): MessagesIO & { calls: { name: string; args: unknown }[] } {
  let rows = start.map(m => ({ ...m }));
  const calls: { name: string; args: unknown }[] = [];
  const lag = () => wait(s.latency ?? 0);
  let warned = false;
  const find = (id: string) => {
    const m = rows.find(x => x.id === id);
    if (!m) throw new CheckinError("There is no such message.", "22023", null);
    return m;
  };
  const put = (m: MessageView) => {
    rows = rows.map(x => (x.id === m.id ? m : x));
    return { ...m };
  };
  return {
    calls,
    async read(taskId) {
      calls.push({ name: "read", args: taskId });
      await lag();
      if (s.readError) throw Error(s.readError);
      return rows.filter(m => m.taskId === taskId).map(m => ({ ...m }));
    },
    async waiting() {
      calls.push({ name: "waiting", args: null });
      await lag();
      if (s.readError) throw Error(s.readError);
      return (s.waiting ?? []).map(m => ({ ...m }));
    },
    async approve(a): Promise<ApproveAnswer> {
      calls.push({ name: "approve", args: a });
      await lag();
      const m = find(a.messageId);
      if (m.state !== "draft")
        throw new CheckinError(
          "This message is not waiting for approval.",
          null,
          400,
        );
      if (s.refuse) throw new CheckinError(s.refuse, null, 400);
      if (s.warn?.length && !a.acceptWarnings && !warned) {
        warned = true;
        return { needsConfirm: true, warnings: s.warn };
      }
      const now = new Date(Date.parse(NOW) + 60_000).toISOString();
      return {
        message: put({
          ...m,
          body: a.body,
          state: "approved",
          reason: null,
          approvedBy: "the CSM",
          approvedAt: now,
          expiresAt: new Date(Date.parse(now) + 24 * 3_600_000).toISOString(),
        }),
        warnings: a.acceptWarnings ? (s.warn ?? []) : [],
      };
    },
    async skip(id) {
      calls.push({ name: "skip", args: id });
      await lag();
      const m = find(id);
      return put({ ...m, state: "skipped", reason: "Skipped by the CSM." });
    },
    async reopen(id) {
      calls.push({ name: "reopen", args: id });
      await lag();
      const m = find(id);
      return put({
        ...m,
        state: "draft",
        reason: null,
        approvedBy: null,
        approvedAt: null,
        expiresAt: null,
      });
    },
  };
}
