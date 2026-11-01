/**
 * Invented client-forms rows for the tests and the harness
 * (docs/forms/WAVE34-CONTRACT.md 3.3, 5.1 to 5.4): one client's view in each
 * presence case, an invite in every state, Today's rows of every kind, the
 * client's voice full and empty, a pause consent in each state, and a stand-in
 * FormsIO that answers from memory and records each call. Nothing here reaches
 * the database, the portal or WhatsApp; the names and numbers are made up.
 */

import type { PauseConsent } from "@/forms/staff/formSheetCore";
import type { ApproveResult, FormsIO, IssueArgs } from "@/lib/clientForms";
import type {
  AnswerRead,
  InviteRow,
  InviteView,
  IssueResult,
  TodayRow,
} from "@/lib/clientFormsCore";
import type { LowScore, VoiceRead } from "@/lib/clientVoice";

/** 1 Nov 2026, 12:00 in Kuwait. */
export const NOW = Date.parse("2026-11-01T09:00:00Z");
export const TODAY = "2026-11-01";
export const TASK = "86exfix01";
export const NAME = "Castello Industries";
export const NAME_AR = "شركة العلا للمقاولات";
export const LOCATION = "locFixture01";

const T = (d: string) => `${d}T07:30:00Z`;

const base: InviteRow = {
  id: "00000000-0000-4000-8000-000000000001",
  formKey: "nps",
  title: { en: "How are we doing?", ar: "شلون شغلنا معاكم؟" },
  state: "open",
  channels: ["portal"],
  origin: "csm",
  issuedAt: T("2026-10-30"),
  issuedByRole: "the CSM",
  expiresAt: T("2026-11-13"),
  seen: false,
  seenAt: null,
  opened: false,
  openedAt: null,
  answeredAt: null,
  responseId: null,
  messageId: null,
  messageState: null,
  linkMade: false,
  closedReason: null,
};

/** One invite in each state the delivery line and the words can show. */
export const INVITES: Record<string, InviteRow> = {
  sent: { ...base },
  seen: {
    ...base,
    id: "00000000-0000-4000-8000-000000000002",
    seen: true,
    seenAt: T("2026-10-31"),
  },
  opened: {
    ...base,
    id: "00000000-0000-4000-8000-000000000003",
    seen: true,
    seenAt: T("2026-10-31"),
    opened: true,
    openedAt: T("2026-10-31"),
  },
  answered: {
    ...base,
    id: "00000000-0000-4000-8000-000000000004",
    state: "answered",
    seen: true,
    seenAt: T("2026-10-31"),
    opened: true,
    openedAt: T("2026-10-31"),
    answeredAt: T("2026-10-31"),
    responseId: "11111111-0000-4000-8000-000000000004",
  },
  approval: {
    ...base,
    id: "00000000-0000-4000-8000-000000000005",
    formKey: "csat",
    title: { en: "How was getting started?", ar: "شلون كانت البداية معانا؟" },
    channels: ["whatsapp"],
    messageId: "22222222-0000-4000-8000-000000000005",
    messageState: "draft",
  },
  withdrawn: {
    ...base,
    id: "00000000-0000-4000-8000-000000000006",
    state: "withdrawn",
    closedReason: "The client asked us to wait a week",
  },
  expired: {
    ...base,
    id: "00000000-0000-4000-8000-000000000007",
    expiresAt: T("2026-10-20"),
    issuedAt: T("2026-10-06"),
  },
  schedule: {
    ...base,
    id: "00000000-0000-4000-8000-000000000008",
    origin: "schedule",
    issuedByRole: "the cockpit",
    channels: ["portal", "whatsapp"],
    messageId: "22222222-0000-4000-8000-000000000008",
    messageState: "sent",
  },
};

const forms: InviteView["forms"] = [
  {
    key: "nps",
    title: { en: "How are we doing?", ar: "شلون شغلنا معاكم؟" },
    live: true,
    sendable: true,
    why: null,
    audience: "any",
    defaultChannels: ["portal"],
  },
  {
    key: "csat",
    title: { en: "How was getting started?", ar: "شلون كانت البداية معانا؟" },
    live: true,
    sendable: false,
    why: "They already filled it on 20 Oct.",
    audience: "any",
    defaultChannels: ["portal"],
  },
  {
    key: "exit_survey",
    title: { en: "Before you go", ar: "قبل لا تمشي" },
    live: true,
    sendable: false,
    why: "Mark Client is leaving first, then send the exit survey.",
    audience: "admin",
    defaultChannels: ["portal", "whatsapp"],
  },
  {
    key: "pause_consent",
    title: { en: "Confirm your pause", ar: "أكّد الإيقاف المؤقت" },
    live: true,
    sendable: false,
    why: "Sent from Pause this client.",
    audience: "admin",
    defaultChannels: ["portal"],
  },
];

/** The view of a client who opened the portal 2 days ago, 3 people. */
export const VIEW: InviteView = {
  taskId: TASK,
  clientName: NAME,
  cardStatus: "Active",
  workspace: { locationId: LOCATION, name: NAME, status: "Active" },
  presence: {
    lastSessionAt: "2026-10-30T15:00:00Z",
    admins: 1,
    members: 2,
    pushedAt: "2026-11-01T08:55:00Z",
    note: null,
  },
  problem: null,
  defaultChannels: ["portal"],
  forms,
  open: [INVITES.approval, INVITES.opened],
  history: [INVITES.answered, INVITES.withdrawn],
  templates: {
    nps: {
      en: "Hi {client} team, a quick question from Mahara: how likely are you to recommend us? It takes a minute: {form_link}",
      ar: "هلا فريق {client}، عندنا سؤال سريع من مهارة: شكثر ممكن تنصحون فينا؟ ما ياخذ إلا دقيقة: {form_link}",
    },
    csat: {
      en: "Hi {client} team, now that your campaign is live, how was getting started with us? Tell us in a minute: {form_link}",
      ar: "هلا فريق {client}، الحين حملتكم اشتغلت. شلون كانت البداية معانا؟ قولوا لنا بدقيقة: {form_link}",
    },
    exit_survey: {
      en: "Hi {client} team, thank you for the time we worked together. Two minutes of honest feedback would help us a lot: {form_link}",
      ar: "هلا فريق {client}، شكراً على الفترة اللي اشتغلنا فيها سوا. دقيقتين من رأيكم الصريح تفرق معانا وايد: {form_link}",
    },
  },
};

/** Presence cases (5.1). */
export const VIEWS: Record<string, InviteView> = {
  recent: VIEW,
  none: {
    ...VIEW,
    workspace: null,
    problem: "no_workspace",
    defaultChannels: ["whatsapp"],
    forms: forms.map(f => ({ ...f, defaultChannels: ["whatsapp"] })),
  },
  closed: {
    ...VIEW,
    workspace: { locationId: LOCATION, name: NAME, status: "Cancelled" },
    problem: "workspace_closed",
    defaultChannels: ["whatsapp"],
    forms: forms.map(f => ({ ...f, defaultChannels: ["whatsapp"] })),
  },
  notReported: {
    ...VIEW,
    presence: {
      lastSessionAt: null,
      admins: 0,
      members: 0,
      pushedAt: null,
      note: null,
    },
    defaultChannels: ["portal", "whatsapp"],
    forms: forms.map(f => ({ ...f, defaultChannels: [] })),
  },
  quiet: {
    ...VIEW,
    presence: {
      lastSessionAt: "2026-10-01T10:00:00Z",
      admins: 1,
      members: 1,
      pushedAt: "2026-11-01T08:55:00Z",
      note: null,
    },
    problem: "no_recent_session",
    forms: forms.map(f => ({ ...f, defaultChannels: [] })),
  },
  membersOnly: {
    ...VIEW,
    presence: {
      lastSessionAt: "2026-10-31T10:00:00Z",
      admins: 0,
      members: 2,
      pushedAt: "2026-11-01T08:55:00Z",
      note: null,
    },
    forms: forms.map(f => ({ ...f, defaultChannels: [] })),
  },
  leaving: {
    ...VIEW,
    cardStatus: "Stopped",
    forms: forms.map(f =>
      f.key === "exit_survey"
        ? { ...f, sendable: true, why: null }
        : f.key === "nps"
          ? {
              ...f,
              sendable: false,
              why: `${NAME} is leaving. Send the exit survey instead.`,
            }
          : f,
    ),
  },
  empty: { ...VIEW, open: [], history: [] },
};

/** Today's rows, one of each kind (3.3). */
export const TODAY_ROWS: TodayRow[] = [
  {
    kind: "sent_today",
    inviteId: INVITES.sent.id,
    taskId: TASK,
    clientName: NAME,
    formKey: "nps",
    title: INVITES.sent.title,
    at: T("2026-11-01"),
    days: 0,
    messageId: null,
    departureId: null,
  },
  {
    kind: "not_answered",
    inviteId: INVITES.opened.id,
    taskId: TASK,
    clientName: NAME,
    formKey: "nps",
    title: INVITES.opened.title,
    at: T("2026-10-24"),
    days: 8,
    messageId: null,
    departureId: null,
  },
  {
    kind: "approve_link",
    inviteId: INVITES.approval.id,
    taskId: TASK,
    clientName: NAME_AR,
    formKey: "csat",
    title: INVITES.approval.title,
    at: T("2026-11-01"),
    days: 0,
    messageId: INVITES.approval.messageId,
    departureId: null,
  },
  {
    kind: "answered",
    inviteId: INVITES.answered.id,
    taskId: TASK,
    clientName: NAME,
    formKey: "nps",
    title: INVITES.answered.title,
    at: T("2026-10-31"),
    days: 1,
    messageId: null,
    departureId: null,
  },
  {
    kind: "exit_survey_due",
    inviteId: null,
    taskId: "86exfix02",
    clientName: "Shades Studio",
    formKey: "exit_survey",
    title: { en: "Before you go", ar: "قبل لا تمشي" },
    at: null,
    days: null,
    messageId: null,
    departureId: 41,
  },
];

export const LOW_SCORES: LowScore[] = [
  {
    responseId: "33333333-0000-4000-8000-000000000001",
    taskId: TASK,
    clientName: NAME,
    formKey: "nps",
    score: 4,
    at: T("2026-10-31"),
    ticketOpen: false,
  },
];

export const VOICE_SOURCE_TEXT =
  "From the client's own answers in the portal or by link. The 2 old Typeform answers could not be matched to a client, so they are left out.";

export const VOICE_FULL: VoiceRead = {
  nps: {
    latest: {
      score: 9,
      results: 8,
      communication: 10,
      startStop: "ابدوا ترسلون تقرير أسبوعي أقصر",
      at: T("2026-10-31"),
      round: 2,
    },
    history: [
      { score: 9, at: T("2026-10-31") },
      { score: 6, at: T("2026-08-02") },
    ],
  },
  csat: {
    score: 8,
    liked: "The kickoff call was clear",
    disliked: "Waiting for the ad account",
    at: T("2026-08-20"),
  },
  feedback: [
    {
      kind: "idea",
      topic: "reports",
      rating: 4,
      message: "A shorter monthly report would help",
      at: T("2026-10-12"),
    },
  ],
  open: [],
  source: VOICE_SOURCE_TEXT,
  lowScoreMax: 6,
};

export const VOICE_NONE: VoiceRead = {
  nps: { latest: null, history: [] },
  csat: { score: null, liked: null, disliked: null, at: null },
  feedback: [],
  open: [],
  source: VOICE_SOURCE_TEXT,
  lowScoreMax: 6,
};

export const ANSWER: AnswerRead = {
  formKey: "nps",
  title: { en: "How are we doing?", ar: "شلون شغلنا معاكم؟" },
  submittedAt: T("2026-10-31"),
  source: "portal",
  signer: "the client admin",
  lang: "ar",
  fields: [
    {
      key: "recommend",
      label: "How likely are you to recommend Mahara?",
      value: 9,
      display: "9",
    },
    {
      key: "startStop",
      label: "What should we start or stop doing?",
      value: "ابدوا ترسلون تقرير أسبوعي أقصر",
      display: "ابدوا ترسلون تقرير أسبوعي أقصر",
    },
  ],
};

/** The pause consent in each state (4.3.4). */
export const CONSENTS: Record<PauseConsent["state"], PauseConsent> = {
  none: {
    state: "none",
    inviteId: null,
    sentAt: null,
    responseId: null,
    signedAt: null,
    via: null,
    signer: null,
    start: null,
    restart: null,
    datesNote: null,
  },
  sent: {
    state: "sent",
    inviteId: "44444444-0000-4000-8000-000000000001",
    sentAt: T("2026-10-31"),
    responseId: null,
    signedAt: null,
    via: null,
    signer: null,
    start: "2026-11-01",
    restart: "2026-11-20",
    datesNote: null,
  },
  signed: {
    state: "signed",
    inviteId: "44444444-0000-4000-8000-000000000001",
    sentAt: T("2026-10-31"),
    responseId: "55555555-0000-4000-8000-000000000001",
    signedAt: T("2026-11-01"),
    via: "portal",
    signer: "the client admin",
    start: "2026-11-01",
    restart: "2026-11-20",
    datesNote: null,
  },
  dates_wrong: {
    state: "dates_wrong",
    inviteId: "44444444-0000-4000-8000-000000000001",
    sentAt: T("2026-10-31"),
    responseId: "55555555-0000-4000-8000-000000000002",
    signedAt: T("2026-11-01"),
    via: "link",
    signer: "Fahad Al-Ali",
    start: "2026-11-01",
    restart: "2026-11-20",
    datesNote: "We restart on 1 December",
  },
  expired: {
    state: "expired",
    inviteId: "44444444-0000-4000-8000-000000000001",
    sentAt: T("2026-10-10"),
    responseId: null,
    signedAt: null,
    via: null,
    signer: null,
    start: "2026-10-10",
    restart: "2026-10-30",
    datesNote: null,
  },
};

export type FakeCall = { op: string; args: unknown };

/** A stand-in FormsIO: answers from memory, records each call, a refusal on demand. */
export function fakeFormsIO(
  opts: {
    view?: InviteView;
    today?: TodayRow[];
    delivered?: IssueResult["delivered"];
    messageId?: string | null;
    refuse?: Partial<Record<keyof FormsIO, string>>;
    /** The first N issue calls fail with a lost connection. */
    dropIssue?: number;
    approve?: ApproveResult;
    delay?: number;
  } = {},
): FormsIO & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  let dropped = 0;
  const wait = () => new Promise(r => setTimeout(r, opts.delay ?? 0));
  const go = async <T>(
    op: keyof FormsIO,
    args: unknown,
    answer: () => T,
  ): Promise<T> => {
    calls.push({ op, args });
    await wait();
    const no = opts.refuse?.[op];
    if (no) throw new Error(no);
    return answer();
  };
  return {
    calls,
    view: t => go("view", t, () => opts.view ?? VIEW),
    issue: (a: IssueArgs) =>
      go("issue", a, () => {
        if (dropped < (opts.dropIssue ?? 0)) {
          dropped++;
          throw new Error("Failed to fetch");
        }
        return {
          inviteId: "66666666-0000-4000-8000-000000000001",
          messageId:
            opts.messageId ??
            (a.channels.includes("whatsapp")
              ? "77777777-0000-4000-8000-000000000001"
              : null),
          delivered:
            opts.delivered ??
            (a.channels.includes("portal") ? "portal" : "waiting_approval"),
          view: opts.view ?? VIEW,
        };
      }),
    withdraw: (t, i, r) => go("withdraw", { t, i, r }, () => opts.view ?? VIEW),
    link: (t, i) =>
      go("link", { t, i }, () => ({
        url: `https://portal.maharamedia.com/f#f1${"A".repeat(43)}`,
        expiresAt: T("2026-11-13"),
      })),
    today: () => go("today", null, () => opts.today ?? TODAY_ROWS),
    answer: id => go("answer", id, () => ANSWER),
    live: () =>
      go("live", null, () => ["nps", "csat", "exit_survey", "pause_consent"]),
    messageBody: id =>
      go("messageBody", id, () =>
        VIEW.templates.csat.ar.replace("{client}", NAME_AR),
      ),
    approve: a =>
      go(
        "approve",
        a,
        () =>
          opts.approve ?? {
            needsConfirm: false,
            warnings: [],
            state: "approved",
          },
      ),
  };
}
