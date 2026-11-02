/**
 * Client forms in the cockpit, as words and shapes (docs/forms/WAVE34-CONTRACT.md
 * 3.3, 5.1 to 5.3): what cockpit_form_invite_view, cockpit_form_invites_today
 * and cockpit_form_answer_read answer, read defensively (a value nobody holds
 * stays null, never 0); the presence line and the default channels of Send a
 * form; the delivery line's rings and each invite's state in words; Today's
 * band lines. It imports nothing, so a test runs it without React or Supabase.
 *
 * The database decides every rule and words every refusal; these words only
 * say what it answered. The one check made here before a press is the client
 * text rule (V18), mirrored from cockpit_client_text_ok so a CSM sees the
 * refusal under the box before sending; the server checks again.
 */

export type Channel = "portal" | "whatsapp" | "copy";
export type Lang = "ar" | "en";
export type Bilingual = { en: string; ar: string };

export type InviteState = "open" | "answered" | "withdrawn" | "expired";
export type InviteOrigin = "csm" | "schedule" | "pause" | "churn" | "canary";

/** 3.3 InviteRow. */
export type InviteRow = {
  id: string;
  formKey: string;
  title: Bilingual;
  state: InviteState;
  channels: Channel[];
  origin: InviteOrigin | null;
  issuedAt: string | null;
  issuedByRole: string | null;
  expiresAt: string | null;
  /** The portal showed it (the pop-up or the card); read when the view carries it. */
  seen: boolean;
  seenAt: string | null;
  opened: boolean;
  openedAt: string | null;
  answeredAt: string | null;
  responseId: string | null;
  messageId: string | null;
  messageState: string | null;
  linkMade: boolean;
  closedReason: string | null;
};

export type Presence = {
  lastSessionAt: string | null;
  admins: number | null;
  members: number | null;
  pushedAt: string | null;
  note: string | null;
};

export type Problem =
  | "no_workspace"
  | "two_workspaces"
  | "workspace_closed"
  | "no_recent_session"
  | null;

export type FormChoice = {
  key: string;
  title: Bilingual;
  live: boolean;
  sendable: boolean;
  why: string | null;
  audience: "any" | "admin";
  defaultChannels: Channel[];
};

/** 3.3 cockpit_form_invite_view's answer. */
export type InviteView = {
  taskId: string;
  clientName: string;
  cardStatus: string | null;
  workspace: {
    locationId: string;
    name: string | null;
    status: string | null;
  } | null;
  presence: Presence;
  problem: Problem;
  defaultChannels: Channel[];
  forms: FormChoice[];
  open: InviteRow[];
  history: InviteRow[];
  templates: Record<string, Bilingual>;
};

export type TodayKind =
  | "sent_today"
  | "not_answered"
  | "approve_link"
  | "answered"
  | "exit_survey_due";

/** 3.3 cockpit_form_invites_today's rows. */
export type TodayRow = {
  kind: TodayKind;
  inviteId: string | null;
  taskId: string;
  clientName: string;
  formKey: string;
  title: Bilingual;
  at: string | null;
  days: number | null;
  messageId: string | null;
  departureId: number | null;
};

/** 3.3 cockpit_form_answer_read's answer. */
export type AnswerRead = {
  formKey: string;
  title: Bilingual;
  submittedAt: string | null;
  source: string | null;
  signer: string | null;
  lang: Lang | null;
  fields: { key: string; label: string; value: unknown; display: string }[];
};

/** _issue's answer (3.3). */
export type IssueResult = {
  inviteId: string;
  messageId: string | null;
  delivered: "portal" | "waiting_approval";
  view: InviteView | null;
};

// --- Reading -------------------------------------------------------------------

type Any = any;

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};
const count = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Any =>
  v && typeof v === "object" && !Array.isArray(v) ? v : null;
const arr = (v: unknown): Any[] => (Array.isArray(v) ? v : []);

const CHANNELS: readonly Channel[] = ["portal", "whatsapp", "copy"];
export function channelsOf(v: unknown): Channel[] {
  const out: Channel[] = [];
  for (const c of arr(v))
    if (CHANNELS.includes(c) && !out.includes(c)) out.push(c as Channel);
  return out;
}

export function bilingual(v: unknown, fallback = ""): Bilingual {
  const o = obj(v);
  if (typeof v === "string") return { en: v, ar: v };
  const en = text(o?.en) ?? text(o?.ar) ?? fallback;
  const ar = text(o?.ar) ?? en;
  return { en, ar };
}

const STATES: readonly InviteState[] = [
  "open",
  "answered",
  "withdrawn",
  "expired",
];
const ORIGINS: readonly InviteOrigin[] = [
  "csm",
  "schedule",
  "pause",
  "churn",
  "canary",
];

export function inviteRow(r: Any): InviteRow | null {
  const o = obj(r);
  const id = text(o?.id);
  if (!o || !id) return null;
  const formKey = text(o.formKey ?? o.form_key) ?? "";
  const openedAt = text(o.openedAt ?? o.opened_at);
  const seenAt = text(o.seenAt ?? o.seen_at);
  return {
    id,
    formKey,
    title: bilingual(o.title, formWords(formKey)),
    state: STATES.includes(o.state) ? o.state : "open",
    channels: channelsOf(o.channels),
    origin: ORIGINS.includes(o.origin) ? o.origin : null,
    issuedAt: text(o.issuedAt ?? o.issued_at),
    issuedByRole: text(o.issuedByRole ?? o.issued_by_role),
    expiresAt: text(o.expiresAt ?? o.expires_at),
    opened: o.opened === true || Boolean(openedAt),
    openedAt,
    seen:
      o.seen === true ||
      Boolean(seenAt) ||
      o.opened === true ||
      Boolean(openedAt),
    seenAt: seenAt ?? openedAt,
    answeredAt: text(o.answeredAt ?? o.answered_at),
    responseId: text(o.responseId ?? o.response_id),
    messageId: text(o.messageId ?? o.message_id),
    messageState: text(o.messageState ?? o.message_state),
    linkMade: o.linkMade === true || o.link_made === true,
    closedReason: text(o.closedReason ?? o.closed_reason),
  };
}

const rows = (v: unknown): InviteRow[] =>
  arr(v)
    .map(inviteRow)
    .filter((r): r is InviteRow => r !== null);

const PROBLEMS = [
  "no_workspace",
  "two_workspaces",
  "workspace_closed",
  "no_recent_session",
];

export function inviteView(d: unknown): InviteView | null {
  const o = obj(d);
  const taskId = text(o?.taskId ?? o?.task_id);
  if (!o || !taskId) return null;
  const ws = obj(o.workspace);
  const p = obj(o.presence) ?? {};
  const templates: Record<string, Bilingual> = {};
  for (const [k, v] of Object.entries(obj(o.templates) ?? {}))
    if (obj(v) || typeof v === "string") templates[k] = bilingual(v);
  return {
    taskId,
    clientName: text(o.clientName ?? o.client_name) ?? "This client",
    cardStatus: text(o.cardStatus ?? o.card_status),
    workspace:
      ws && text(ws.locationId ?? ws.location_id)
        ? {
            locationId: String(text(ws.locationId ?? ws.location_id)),
            name: text(ws.name),
            status: text(ws.status),
          }
        : null,
    presence: {
      lastSessionAt: text(p.lastSessionAt ?? p.last_session_at),
      admins: count(p.admins),
      members: count(p.members),
      pushedAt: text(p.pushedAt ?? p.pushed_at),
      note: text(p.note),
    },
    problem: PROBLEMS.includes(o.problem) ? o.problem : null,
    defaultChannels: channelsOf(o.defaultChannels),
    forms: arr(o.forms)
      .map((f: Any): FormChoice | null => {
        const key = text(f?.key);
        if (!key) return null;
        return {
          key,
          title: bilingual(f.title, formWords(key)),
          live: f.live === true,
          sendable: f.sendable === true,
          why: text(f.why),
          audience: f.audience === "admin" ? "admin" : "any",
          defaultChannels: channelsOf(f.defaultChannels),
        };
      })
      .filter((f): f is FormChoice => f !== null),
    open: rows(o.open),
    history: rows(o.history),
    templates,
  };
}

const TODAY_KINDS: readonly TodayKind[] = [
  "sent_today",
  "not_answered",
  "approve_link",
  "answered",
  "exit_survey_due",
];

export function todayRows(d: unknown): TodayRow[] {
  return arr(d)
    .map((r: Any): TodayRow | null => {
      const taskId = text(r?.taskId ?? r?.task_id);
      if (!taskId || !TODAY_KINDS.includes(r?.kind)) return null;
      const formKey =
        text(r.formKey ?? r.form_key) ??
        (r.kind === "exit_survey_due" ? "exit_survey" : "");
      return {
        kind: r.kind,
        inviteId: text(r.inviteId ?? r.invite_id),
        taskId,
        clientName: text(r.clientName ?? r.client_name) ?? "A client",
        formKey,
        title: bilingual(r.title, formWords(formKey)),
        at: text(r.at),
        days: count(r.days),
        messageId: text(r.messageId ?? r.message_id),
        departureId: count(r.departureId ?? r.departure_id),
      };
    })
    .filter((r): r is TodayRow => r !== null);
}

export function answerRead(d: unknown): AnswerRead | null {
  const o = obj(d);
  if (!o) return null;
  const formKey = text(o.formKey ?? o.form_key) ?? "";
  return {
    formKey,
    title: bilingual(o.title, formWords(formKey)),
    submittedAt: text(o.submittedAt ?? o.submitted_at),
    source: text(o.source),
    signer: text(o.signer),
    lang: o.lang === "ar" || o.lang === "en" ? o.lang : null,
    fields: arr(o.fields)
      .filter((f: Any) => text(f?.key))
      .map((f: Any) => ({
        key: String(f.key),
        label: text(f.label) ?? String(f.key),
        value: f.value ?? null,
        display: text(f.display) ?? displayValue(f.value),
      })),
  };
}

/** A stored value in words when the server gave no display: an empty one says so. */
export function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "Not answered";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v))
    return v.length ? v.map(String).join(", ") : "Not answered";
  return String(v);
}

export function issueResult(d: unknown): IssueResult | null {
  const o = obj(d);
  const inviteId = text(o?.inviteId ?? o?.invite_id);
  if (!o || !inviteId) return null;
  return {
    inviteId,
    messageId: text(o.messageId ?? o.message_id),
    delivered: o.delivered === "portal" ? "portal" : "waiting_approval",
    view: inviteView(o.view),
  };
}

// --- Words ---------------------------------------------------------------------

/**
 * The form's name as a chip says it (5.1). Every client form needs one: the
 * server sends the client's own title ("Send your transfer receipt"), which
 * reads wrong inside "Send the …". The two tail forms follow the server's
 * words (cockpit_form_invite_tail_forms: "A receipt request").
 */
export const FORM_WORDS: Record<string, string> = {
  nps: "NPS survey",
  csat: "Onboarding survey",
  exit_survey: "Exit survey",
  pause_consent: "Pause consent",
  portal_feedback: "Portal feedback",
  bank_receipt: "Receipt request",
  onboarding: "Onboarding form",
};

export function formWords(key: string, title?: Bilingual | null): string {
  return FORM_WORDS[key] ?? title?.en ?? key.replace(/_/g, " ");
}

/** The form's name inside a sentence: "Send the onboarding survey". NPS keeps its capitals. */
export function formInline(key: string, title?: Bilingual | null): string {
  const w = formWords(key, title);
  return /^[A-Z]{2,}/.test(w) ? w : w.charAt(0).toLowerCase() + w.slice(1);
}

/** The survey a score was given on, for the low-score line: "NPS survey", "onboarding survey". */
export const sendLabel = (key: string, title?: Bilingual | null) =>
  `Send the ${formInline(key, title)}`;

/** The toast after a send (5.1): Sent only when the portal is a channel. */
export function sendToast(delivered: IssueResult["delivered"]): string {
  return delivered === "portal"
    ? "Sent"
    : "Saved. Approve the WhatsApp message to send it.";
}

export const WAITS_FOR_APPROVAL =
  "The WhatsApp message waits for your approval.";
export const APPROVED = "Approved. It sends within about 3 minutes.";
export const FORMS_OUT_EMPTY = "No forms out. Send one with Send a form.";
export const WITHDRAW_PROMPT = "Why are you withdrawing it?";
export const SENT_AGAIN_REASON = "Sent again";
export const NOTE_HINT =
  "Shown under the form's title. No numbers about leads or cost.";
/** Under the WhatsApp text: what {form_link} is and the one rule it keeps (the live check uses the same words in red). */
export const WHATSAPP_HINT =
  "Keep {form_link} in the text once; the link goes there when it sends.";
export const PHONE_ALERT = "Phone alert to people who turned alerts on";
export const PREVIEW_HINT = "Team preview: nothing is recorded.";

/** The press never reached the server (5.1). */
export const networkSentence = (key: string, title?: Bilingual | null) =>
  `Not sent. Check your connection and press ${sendLabel(key, title)} again.`;

const NETWORK =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed/i;
export function isNetworkError(e: unknown): boolean {
  return NETWORK.test(e instanceof Error ? e.message : String(e ?? ""));
}

/** The link modal's line (5.2). */
export const linkLine = (expiresAt: string | null) =>
  `This link works once and ends on ${kuwaitDayWords(expiresAt) || "its end day"}. It is shown only now.`;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const KUWAIT_MS = 3 * 3600_000;

/** "16 Nov" in Kuwait, for a day or a timestamp; empty when it is neither. */
export function kuwaitDayWords(v: string | null | undefined): string {
  if (!v) return "";
  const d = DAY.exec(v.trim());
  if (d) return `${Number(d[3])} ${MONTHS[Number(d[2]) - 1] ?? ""}`.trim();
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return "";
  const at = new Date(ms + KUWAIT_MS);
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

/** "10:42" in Kuwait for a timestamp; empty for a bare day. */
export function kuwaitTimeWords(v: string | null | undefined): string {
  if (!v || DAY.test(v.trim())) return "";
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return "";
  const at = new Date(ms + KUWAIT_MS);
  return `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
}

/** The Kuwait day "YYYY-MM-DD" of a moment. */
export function kuwaitIsoDay(ms: number): string {
  return new Date(ms + KUWAIT_MS).toISOString().slice(0, 10);
}

/** Whole Kuwait days from a moment to now (0 = today); null when it is not a date. */
export function daysAgo(at: string | null, now: number): number | null {
  if (!at) return null;
  const ms = Date.parse(DAY.test(at) ? `${at}T00:00:00+03:00` : at);
  if (!Number.isFinite(ms)) return null;
  const a = Date.parse(`${kuwaitIsoDay(ms)}T00:00:00Z`);
  const b = Date.parse(`${kuwaitIsoDay(now)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);
const agoWords = (n: number) =>
  n <= 0 ? "today" : n === 1 ? "1 day ago" : `${n} days ago`;

/**
 * The presence line of Send a form (5.1), for the form picked. The order is
 * the default channel rule's (3.3): no or closed workspace, presence not
 * reported yet, an admin-only form with members only, a live session in 14
 * days, none in 14 days.
 */
export function presenceLine(
  view: Pick<InviteView, "workspace" | "problem" | "presence">,
  form: Pick<FormChoice, "audience"> | null,
  now: number,
): string {
  if (view.problem === "workspace_closed")
    return "Workspace closed: send the link by WhatsApp.";
  if (
    !view.workspace ||
    view.problem === "no_workspace" ||
    view.problem === "two_workspaces"
  )
    return "No Mahara OS workspace: the WhatsApp link goes.";
  const p = view.presence;
  if (!p.pushedAt)
    return "We can't see portal visits yet, so it goes to the portal and by WhatsApp.";
  const admins = p.admins ?? 0;
  const members = p.members ?? 0;
  const ago = daysAgo(p.lastSessionAt, now);
  const recent = ago !== null && ago <= 14 && admins + members > 0;
  if (form?.audience === "admin" && admins === 0 && members > 0 && recent)
    return "No admin has opened the portal in 14 days, so the WhatsApp link goes too.";
  if (recent)
    return `Opened the portal ${agoWords(ago as number)} · ${people(admins + members)}`;
  return "Has not opened the portal in 14 days, so the WhatsApp link goes too.";
}

/**
 * The channels a form starts with: the server's own per-form answer, else
 * the same rule worked out here (3.3), never the sheet status alone.
 */
export function defaultChannels(
  view: Pick<
    InviteView,
    "workspace" | "problem" | "presence" | "defaultChannels"
  >,
  form: Pick<FormChoice, "audience" | "defaultChannels"> | null,
  now: number,
): Channel[] {
  if (form?.defaultChannels.length) return form.defaultChannels;
  if (
    !view.workspace ||
    view.problem === "workspace_closed" ||
    view.problem === "no_workspace" ||
    view.problem === "two_workspaces"
  )
    return ["whatsapp"];
  const p = view.presence;
  if (!p.pushedAt) return ["portal", "whatsapp"];
  const ago = daysAgo(p.lastSessionAt, now);
  const recent = ago !== null && ago <= 14;
  const admins = p.admins ?? 0;
  const members = p.members ?? 0;
  if (form?.audience === "admin")
    return recent && admins > 0 ? ["portal"] : ["portal", "whatsapp"];
  return recent && admins + members > 0 ? ["portal"] : ["portal", "whatsapp"];
}

/** True when the portal can take the form at all (an open workspace). */
export function portalOpen(
  view: Pick<InviteView, "workspace" | "problem">,
): boolean {
  return (
    Boolean(view.workspace) &&
    view.problem !== "no_workspace" &&
    view.problem !== "two_workspaces" &&
    view.problem !== "workspace_closed"
  );
}

// --- The client text rule (V18), mirrored from cockpit_client_text_ok ----------

const LEADS =
  /(^|[^ء-ي٠-٩A-Za-z0-9_])([وف]?(ال|لل|[بكل]|[بك]ال))?ليد(ز|ات)?(كم|كن|هم|هن|ها|ه|نا|ك)?($|[^ء-ي٠-٩A-Za-z0-9_])|(ال)?عملاء\s+(ال)?محتمل(ين|ون)|\bleads?\b|\bcpls?\b|\bcost\s+per\s+lead\b/iu;
const GUARANTEE = /\bguarantee[sd]?\b|\bguaranteeing\b|ضمان|نضمن|مضمون/iu;

export const TEXT_LEADS =
  "Client messages never quote leads or cost per lead. Say how the campaign is doing, or count appointments for clients we book for.";
export const TEXT_GUARANTEE =
  "Client forms never promise results. Remove the guarantee wording.";

/** cockpit_client_text_ok's sentence for a client-facing text, or null when it is fine. */
export function clientTextProblem(t: string): string | null {
  if (LEADS.test(t)) return TEXT_LEADS;
  if (GUARANTEE.test(t)) return TEXT_GUARANTEE;
  return null;
}

export const FORM_LINK = "{form_link}";
export const LINK_ONCE =
  "Keep {form_link} in the text once; the link goes there when it sends.";

/** The WhatsApp text's problem before Approve: the placeholder once, the text rule, 1,000 characters. */
export function whatsappProblem(body: string): string | null {
  const n = body.split(FORM_LINK).length - 1;
  if (n !== 1) return LINK_ONCE;
  if (body.trim().length > 1000)
    return "Keep the message under 1,000 characters.";
  return clientTextProblem(body);
}

/** The template with the client's name in, the link placeholder kept (3.9). */
export function fillTemplate(t: string, clientName: string): string {
  return t.split("{client}").join(clientName);
}

// --- The delivery line ------------------------------------------------------------

export type RingState = "done" | "waiting" | "todo" | "failed";
export type Ring = {
  key: "approve" | "sent" | "seen" | "opened" | "answered";
  label: string;
  state: RingState;
  at: string | null;
};
export type DeliveryLine = {
  rings: Ring[];
  cut: { word: string; at: string | null } | null;
};

const SENT_STATES = new Set([
  "approved",
  "claimed",
  "sending",
  "sent",
  "unknown",
]);
const FAILED_STATES = new Set(["refused", "failed"]);

/** True for an open invite whose fourteen days are over (V25: reads never expire it, they say it). */
export function isExpired(
  i: Pick<InviteRow, "state" | "expiresAt">,
  now: number,
): boolean {
  if (i.state === "expired") return true;
  if (i.state !== "open" || !i.expiresAt) return false;
  const ms = Date.parse(i.expiresAt);
  return Number.isFinite(ms) && ms <= now;
}

/**
 * The four rings, Sent → Seen → Opened → Answered, with Approve first when
 * WhatsApp is a channel (5.0's signature). The first ring not done on an open
 * invite waits (amber); the rest are hollow; a withdrawn or expired invite is
 * cut after its last done ring with its word.
 */
export function deliveryLine(i: InviteRow, now: number): DeliveryLine {
  const wa = i.channels.includes("whatsapp");
  const portal = i.channels.includes("portal");
  const msg = i.messageState ?? "";
  const rings: Ring[] = [];
  if (wa)
    rings.push({
      key: "approve",
      label: "Approve",
      state: SENT_STATES.has(msg)
        ? "done"
        : FAILED_STATES.has(msg)
          ? "failed"
          : "todo",
      at: null,
    });
  const sentDone =
    portal || msg === "sent" || (i.channels.includes("copy") && i.linkMade);
  rings.push({
    key: "sent",
    label: "Sent",
    state: sentDone ? "done" : "todo",
    at: portal ? i.issuedAt : null,
  });
  rings.push({
    key: "seen",
    label: "Seen",
    state: i.seen ? "done" : "todo",
    at: i.seenAt,
  });
  rings.push({
    key: "opened",
    label: "Opened",
    state: i.opened ? "done" : "todo",
    at: i.openedAt,
  });
  rings.push({
    key: "answered",
    label: "Answered",
    state: i.answeredAt || i.state === "answered" ? "done" : "todo",
    at: i.answeredAt,
  });
  // A later ring done means the earlier ones happened, even unseen (a link answered).
  let last = -1;
  rings.forEach((r, n) => {
    if (r.state === "done") last = n;
  });
  for (let n = 0; n < last; n++)
    if (rings[n].state === "todo") rings[n].state = "done";
  const expired = isExpired(i, now);
  const closed = i.state === "withdrawn" || expired;
  if (!closed && i.state === "open") {
    const next = rings.find(r => r.state === "todo");
    if (next) next.state = "waiting";
  }
  return {
    rings,
    cut:
      i.state === "withdrawn"
        ? { word: "Withdrawn", at: null }
        : expired
          ? { word: "Expired", at: i.expiresAt }
          : null,
  };
}

/** The invite's state in words (5.2). */
export function inviteStateWords(i: InviteRow, now: number): string {
  const d = (v: string | null) => kuwaitDayWords(v) || "on a day not recorded";
  if (i.state === "answered" || i.answeredAt)
    return `Answered ${d(i.answeredAt)}`;
  if (i.state === "withdrawn")
    return `Withdrawn: ${i.closedReason ?? "no reason recorded"}`;
  if (isExpired(i, now)) return `Expired ${d(i.expiresAt)}`;
  if (i.opened) return `Opened ${d(i.openedAt)}`;
  if (i.seen) return `Seen ${d(i.seenAt)}`;
  if (
    !i.channels.includes("portal") &&
    i.channels.includes("whatsapp") &&
    i.messageState !== "sent"
  )
    return "Waiting for approval";
  return `Sent ${d(i.issuedAt)}`;
}

/** Who sent it, in role words: "the CSM", "the cockpit" for the schedule. */
export function sentByWords(
  i: Pick<InviteRow, "origin" | "issuedByRole">,
): string {
  if (i.origin === "schedule") return "the cockpit, on its schedule";
  return i.issuedByRole ?? "the team";
}

/** The WhatsApp leg still waits on a person (a draft to approve). */
export const needsApproval = (
  i: Pick<InviteRow, "state" | "messageId" | "messageState">,
) => i.state === "open" && Boolean(i.messageId) && i.messageState === "draft";

// --- Today's band lines (5.3) ---------------------------------------------------------

export function todayLine(r: TodayRow): string {
  const form = formWords(r.formKey, r.title);
  switch (r.kind) {
    case "sent_today":
      return r.formKey === "nps"
        ? `NPS sent: ${r.clientName}`
        : `${form} sent: ${r.clientName}`;
    case "not_answered": {
      const n = r.days;
      const ago =
        n === null ? "some days ago" : n === 1 ? "1 day ago" : `${n} days ago`;
      return `Not answered: ${formInline(r.formKey, r.title)} to ${r.clientName}, sent ${ago}`;
    }
    case "approve_link":
      return `WhatsApp link to approve: ${formInline(r.formKey, r.title)} for ${r.clientName}`;
    case "answered":
      return `Answered: ${formInline(r.formKey, r.title)} from ${r.clientName}`;
    case "exit_survey_due":
      return `Send the exit survey to ${r.clientName}`;
  }
}

/**
 * A row under its band's title (5.3): the band already says what the row is
 * ("Not answered"), so the row drops that prefix and names the form as the
 * Send a form chips do ("Onboarding survey"). todayLine stays the full
 * sentence for the row's accessible name and wherever a row shows alone.
 */
export function todayRowText(r: TodayRow): string {
  const form = formWords(r.formKey, r.title);
  switch (r.kind) {
    case "sent_today":
      return `${form} to ${r.clientName}`;
    case "not_answered": {
      const n = r.days;
      const ago =
        n === null ? "some days ago" : n === 1 ? "1 day ago" : `${n} days ago`;
      return `${form} to ${r.clientName}, sent ${ago}`;
    }
    case "approve_link":
      return `${form} for ${r.clientName}`;
    case "answered":
      return `${form} from ${r.clientName}`;
    case "exit_survey_due":
      return `Send the exit survey to ${r.clientName}`;
  }
}

/** The pause consent's signer on Today and in the sheet (4.3, 5.2, 5.3). */
export function signerWords(via: string | null, signer: string | null): string {
  if (via === "link") return `by link by ${signer ?? "someone with the link"}`;
  return "in the portal by the client admin";
}

/** The staff preview of a form in the client's portal (3.7): nothing is recorded there. */
export function portalPreviewUrl(locationId: string, formKey: string): string {
  return `https://portal.maharamedia.com/?clientId=${encodeURIComponent(locationId)}&formPreview=${encodeURIComponent(formKey)}`;
}
