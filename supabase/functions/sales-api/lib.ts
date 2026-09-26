// The rules of the sales cockpit's server, kept apart from index.ts so they
// can be tested without the Supabase runtime (bun test supabase/functions/sales-api).

export const MARKS = ["showed", "noshow", "cancelled", "invalid"] as const;
export type Mark = (typeof MARKS)[number];

export const ORIGINS = [
  "https://cockpit.maharamedia.com",
  "https://mahara-sales.vercel.app",
  "http://localhost:5190",
  "http://127.0.0.1:5190",
];

export function cors(origin: string | null): Record<string, string> {
  const ok = origin !== null && ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export interface Who {
  signed_in: boolean;
  email?: string;
  seat?: boolean;
  manager?: boolean;
  ceo?: boolean;
  name?: string | null;
  role?: string | null;
  ghl_user_id?: string | null;
  b2b_rep_id?: string | null;
  maqsam_email?: string | null;
  /** "seat" when the seat names it, "b2b" when it comes from the rep directory. */
  maqsam_from?: "seat" | "b2b" | null;
  fathom_email?: string | null;
}

export interface Appointment {
  appointment_id: string;
  contact_id: string | null;
  call_type: string | null;
  start_at: string | null;
  status: string | null;
  assigned_user_id: string | null;
  calendar_id: string | null;
  origin?: string | null;
}

/** A plain sentence when this person may not mark this call, else null. */
export function refuseMark(
  who: Who,
  appt: Appointment,
  mark: string,
  nowMs: number,
): string | null {
  if (!(MARKS as readonly string[]).includes(mark))
    return "Choose showed, no-show, cancelled or disqualified.";
  if (!who.manager) {
    if (!who.ghl_user_id)
      return "Your seat is not linked to your HighLevel user yet. Ask Aziz to link it on the Team page.";
    if (appt.assigned_user_id !== who.ghl_user_id)
      return "This call is booked with another rep. Only they or a manager can mark it.";
  }
  const start = appt.start_at ? Date.parse(appt.start_at) : Number.NaN;
  // A call can be cancelled ahead of time, but it cannot have been attended
  // before it starts.
  if (mark !== "cancelled" && Number.isFinite(start) && start > nowMs + 10 * 60_000)
    return "This call has not happened yet. Mark it once its time has passed, or mark it cancelled.";
  return null;
}

export interface CrmSettings {
  dispositions?: boolean;
  backlog_days?: number;
}

/**
 * Whether a mark goes to HighLevel. Aziz, 2026-09-24: yes for today's
 * calls, running HighLevel's usual automations; old appointments are marked
 * in the cockpit only, so an old lead is never sent a no-show message.
 */
export function crmDecision(
  s: CrmSettings | null | undefined,
  appt: Appointment,
  nowMs: number,
): "write" | "off" | "skipped" {
  if (!s?.dispositions) return "off";
  const days = Number.isFinite(Number(s.backlog_days)) ? Number(s.backlog_days) : 7;
  const start = appt.start_at ? Date.parse(appt.start_at) : Number.NaN;
  if (!Number.isFinite(start)) return "skipped";
  if (nowMs - start > days * 86_400_000) return "skipped";
  return "write";
}

export function cleanText(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
};

/** A pay rule as Aziz described it, or a sentence saying what is wrong. */
export function checkPay(
  p: unknown,
): { ok: true; pay: Record<string, unknown> } | { ok: false; error: string } {
  if (p === null || p === undefined) return { ok: true, pay: {} };
  if (typeof p !== "object" || Array.isArray(p))
    return { ok: false, error: "The pay rule must be a set of fields." };
  const src = p as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const rate = num(src.cash_rate);
  if (rate !== null) {
    if (Number.isNaN(rate) || rate < 0 || rate > 1)
      return { ok: false, error: "The cash rate is a share between 0 and 1 (10% is 0.10)." };
    out.cash_rate = rate;
  }
  for (const k of ["pif_bonus", "per_intro_shown", "per_demo_shown", "per_signed"]) {
    const n = num(src[k]);
    if (n === null) continue;
    if (Number.isNaN(n) || n < 0 || n > 100_000)
      return { ok: false, error: `${k.replace(/_/g, " ")} must be an amount of 0 or more.` };
    out[k] = n;
  }
  const cur = cleanText(src.currency ?? "USD", 3).toUpperCase();
  if (!["USD", "KWD", "SAR", "AED", "QAR", "BHD", "OMR"].includes(cur))
    return { ok: false, error: "Pay is in USD, KWD, SAR, AED, QAR, BHD or OMR." };
  out.currency = cur;
  const note = cleanText(src.note, 500);
  if (note) out.note = note;
  return { ok: true, pay: out };
}

const GOAL_KEYS = ["booked", "shown", "closes", "cash", "dials", "conversations"];

/** Weekly and monthly goals in units and cash. */
export function checkGoals(
  g: unknown,
): { ok: true; goals: Record<string, unknown> } | { ok: false; error: string } {
  if (g === null || g === undefined) return { ok: true, goals: {} };
  if (typeof g !== "object" || Array.isArray(g))
    return { ok: false, error: "Goals must be a set of fields." };
  const out: Record<string, Record<string, number>> = {};
  for (const period of ["weekly", "monthly"]) {
    const src = (g as Record<string, unknown>)[period];
    if (src === undefined || src === null) continue;
    if (typeof src !== "object" || Array.isArray(src))
      return { ok: false, error: `The ${period} goals must be a set of fields.` };
    const row: Record<string, number> = {};
    for (const k of GOAL_KEYS) {
      const n = num((src as Record<string, unknown>)[k]);
      if (n === null) continue;
      if (Number.isNaN(n) || n < 0 || n > 10_000_000)
        return { ok: false, error: `The ${period} ${k} goal must be 0 or more.` };
      row[k] = n;
    }
    if (Object.keys(row).length) out[period] = row;
  }
  return { ok: true, goals: out };
}

export function checkEmail(v: unknown): string | null {
  const e = cleanText(v, 200).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

export const LINK_KINDS = ["deck", "form", "calculator", "proof", "library", "script", "other"];

export function checkLink(
  l: Record<string, unknown>,
): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  const label = cleanText(l.label, 120);
  const url = cleanText(l.url, 2000);
  if (!label) return { ok: false, error: "Give the link a name." };
  if (!/^https:\/\/[^\s]+$/.test(url))
    return { ok: false, error: "A link must start with https://." };
  const kind = LINK_KINDS.includes(String(l.kind)) ? String(l.kind) : "other";
  // A blank order is the default place, not first: Number("") is 0.
  const sortRaw = l.sort === null || l.sort === undefined || String(l.sort).trim() === "" ? Number.NaN : Number(l.sort);
  const sort = Number.isFinite(sortRaw) ? Math.round(sortRaw) : 100;
  return {
    ok: true,
    row: {
      label,
      url,
      kind,
      note: cleanText(l.note, 500) || null,
      sort,
      active: l.active === undefined ? true : Boolean(l.active),
    },
  };
}

export interface OfferChoice {
  guarantee: boolean;
  payment: string;
  price?: number;
  months?: number;
}

/** The closer's choices for a proposal: guarantee or not, and how it is paid. */
export function checkOffer(
  o: unknown,
): { ok: true; offer: OfferChoice } | { ok: false; error: string } {
  const src = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const payment = cleanText(src.payment ?? "pif", 40) || "pif";
  if (!/^[a-z0-9_-]+$/.test(payment))
    return { ok: false, error: "Choose how the client pays." };
  const offer: OfferChoice = { guarantee: Boolean(src.guarantee), payment };
  const price = num(src.price);
  if (price !== null) {
    if (Number.isNaN(price) || price < 500 || price > 500_000)
      return { ok: false, error: "The price must be between 500 and 500,000." };
    offer.price = price;
  }
  const months = num(src.months);
  if (months !== null) {
    if (Number.isNaN(months) || months < 1 || months > 36 || !Number.isInteger(months))
      return { ok: false, error: "The length is a whole number of months, 1 to 36." };
    offer.months = months;
  }
  return { ok: true, offer };
}

/** HighLevel messages, trimmed to what the lead page shows. */
export function trimMessages(list: unknown): Record<string, unknown>[] {
  const arr = Array.isArray(list) ? list : [];
  return arr.slice(0, 50).map(m => {
    const r = (m ?? {}) as Record<string, unknown>;
    return {
      id: r.id ?? null,
      direction: r.direction ?? null,
      type: r.messageType ?? r.type ?? null,
      status: r.status ?? null,
      at: r.dateAdded ?? null,
      body: cleanText(r.body, 2000) || null,
      has_attachments: Array.isArray(r.attachments) && r.attachments.length > 0,
      source: r.source ?? null,
    };
  });
}

export function redact(s: string): string {
  return String(s)
    .replace(/sbp_[A-Za-z0-9]+/g, "[key]")
    .replace(/pit-[A-Za-z0-9-]+/g, "[key]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .slice(0, 300);
}

/** Every string in a draft that still carries a FILL, by its path. */
export function fillPaths(v: unknown, path: (string | number)[] = [], out: string[] = []): string[] {
  if (typeof v === "string") {
    if (/\bFILL\b/.test(v)) out.push(path.join("."));
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => fillPaths(x, [...path, i], out));
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) fillPaths(x, [...path, k], out);
  }
  return out;
}

/**
 * Put the closer's figures into a draft. Only a string that still carries a
 * FILL can be replaced, so this cannot rewrite anything the model or the
 * validator already settled. A bare number becomes a number.
 */
export function applyFills(
  deal: unknown,
  fills: Record<string, unknown>,
): { ok: true; deal: unknown; changed: string[] } | { ok: false; error: string } {
  const copy = JSON.parse(JSON.stringify(deal ?? null));
  if (!copy || typeof copy !== "object") return { ok: false, error: "This proposal has no draft to fill in." };
  const allowed = new Set(fillPaths(copy));
  const changed: string[] = [];
  for (const [path, raw] of Object.entries(fills ?? {})) {
    if (!allowed.has(path)) return { ok: false, error: `"${path}" is not a blank in this draft.` };
    const value = cleanText(raw, 1000);
    if (!value) continue;
    if (/\bFILL\b/.test(value)) return { ok: false, error: "Replace every FILL with the real figure or words." };
    const keys = path.split(".").map(k => (/^\d+$/.test(k) ? Number(k) : k));
    let node: any = copy;
    for (const k of keys.slice(0, -1)) node = node?.[k as keyof typeof node];
    const last = keys[keys.length - 1];
    if (node === null || node === undefined || typeof node[last] !== "string")
      return { ok: false, error: `"${path}" is not a blank in this draft.` };
    node[last] = /^-?\d+(\.\d+)?$/.test(value.replace(/,/g, "")) && node[last].trim() === "FILL"
      ? Number(value.replace(/,/g, ""))
      : value;
    changed.push(path);
  }
  return { ok: true, deal: copy, changed };
}

// ---------------------------------------------------------------------------
// Conversations: reading a lead's thread and sending on it
// ---------------------------------------------------------------------------

export type Channel = "whatsapp" | "sms" | "email";

export interface ThreadMessage {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound" | null;
  channel: Channel | "call" | "other";
  type: string | null;
  status: string | null;
  at: string | null;
  body: string | null;
  subject: string | null;
  attachments: string[];
  error: string | null;
  source: string | null;
}

/** HighLevel's messageType as the channel a rep would name. */
export function channelOf(messageType: unknown): ThreadMessage["channel"] {
  const t = String(messageType ?? "").toUpperCase();
  if (t.includes("WHATSAPP")) return "whatsapp";
  if (t.includes("EMAIL")) return "email";
  if (t.includes("CALL") || t.includes("VOICEMAIL")) return "call";
  if (t.includes("SMS")) return "sms";
  return "other";
}

/** A failure's reason, wherever HighLevel put it on this message. */
function errorOf(m: Record<string, unknown>): string | null {
  const meta = (m.meta ?? {}) as Record<string, unknown>;
  for (const v of [m.error, m.errorMessage, meta.error, meta.errorMessage, meta.failedReason, m.statusReason]) {
    if (!v) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s && s !== "{}") return cleanText(s, 300);
  }
  return null;
}

/** One conversation's messages in the cockpit's shape; only https attachments. */
export function toThread(list: unknown, conversationId: string): ThreadMessage[] {
  const arr = Array.isArray(list) ? list : [];
  return arr.flatMap(x => {
    const m = (x ?? {}) as Record<string, unknown>;
    if (!m.id) return [];
    const meta = (m.meta ?? {}) as Record<string, unknown>;
    const email = (meta.email ?? {}) as Record<string, unknown>;
    const direction = m.direction === "inbound" || m.direction === "outbound" ? m.direction : null;
    return [{
      id: String(m.id),
      conversation_id: String(m.conversationId ?? conversationId),
      direction,
      channel: channelOf(m.messageType ?? m.type),
      type: m.messageType ? String(m.messageType) : null,
      status: m.status ? String(m.status) : null,
      at: m.dateAdded ? String(m.dateAdded) : null,
      body: cleanText(m.body, 4000) || null,
      subject: cleanText(email.subject ?? m.subject, 300) || null,
      attachments: (Array.isArray(m.attachments) ? m.attachments : [])
        .map(a => String(a ?? ""))
        .filter(a => /^https:\/\//.test(a))
        .slice(0, 5),
      error: m.status === "failed" || m.status === "undelivered" ? errorOf(m) : null,
      source: m.source ? String(m.source) : null,
    }];
  });
}

/** Several conversations as one thread, newest first, each message once. */
export function mergeThreads(lists: ThreadMessage[][], limit = 80): ThreadMessage[] {
  const seen = new Set<string>();
  const all: ThreadMessage[] = [];
  for (const l of lists)
    for (const m of l)
      if (!seen.has(m.id)) {
        seen.add(m.id);
        all.push(m);
      }
  const t = (m: ThreadMessage) => (m.at ? Date.parse(m.at) : 0);
  return all.sort((a, b) => t(b) - t(a)).slice(0, limit);
}

/**
 * WhatsApp takes a free message only within 24 hours of the lead's last
 * message to us; after that, only an approved template (through a
 * HighLevel workflow, not this API).
 */
export function whatsappWindow(lastInboundAt: string | null | undefined, now: number): {
  open: boolean;
  closes_at: string | null;
  last_inbound_at: string | null;
} {
  const t = lastInboundAt ? Date.parse(String(lastInboundAt)) : Number.NaN;
  if (!Number.isFinite(t)) return { open: false, closes_at: null, last_inbound_at: null };
  const closes = t + 24 * 3_600_000;
  return { open: now < closes, closes_at: new Date(closes).toISOString(), last_inbound_at: new Date(t).toISOString() };
}

/** Do-not-disturb for one channel, as HighLevel records it on the contact. */
export function dndFor(contact: Record<string, unknown>, channel: Channel): boolean {
  if (contact.dnd === true) return true;
  const key = channel === "whatsapp" ? "WhatsApp" : channel === "email" ? "Email" : "SMS";
  const s = ((contact.dndSettings ?? {}) as Record<string, Record<string, unknown>>)[key];
  return String(s?.status ?? "").toLowerCase() === "active";
}

/** A plain-text email as simple, escaped HTML: paragraphs and line breaks. */
export function emailHtml(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return text
    .trim()
    .split(/\n{2,}/)
    .map(p => `<p dir="auto">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** The body HighLevel's POST /conversations/messages takes for one send. */
export function sendBody(channel: Channel, contactId: string, text: string, subject?: string | null) {
  if (channel === "email")
    return { type: "Email", contactId, subject: String(subject ?? "").trim(), html: emailHtml(text), message: text };
  return { type: channel === "whatsapp" ? "WhatsApp" : "SMS", contactId, message: text };
}

/** HighLevel's message status as the cockpit's send state. */
export function stateOf(status: unknown): "sending" | "sent" | "delivered" | "read" | "failed" {
  const s = String(status ?? "").toLowerCase();
  if (["failed", "undelivered", "opt_out"].includes(s)) return "failed";
  if (s === "read" || s === "opened" || s === "clicked") return "read";
  if (s === "delivered") return "delivered";
  if (["sent", "connected"].includes(s)) return "sent";
  return "sending";
}

// ---------------------------------------------------------------------------
// End of day: the same questions as the Typeforms, in the sheet's own order
// ---------------------------------------------------------------------------

export type EodRole = "setter" | "closer";
export type EodKind = "count" | "money" | "minutes" | "text";

export interface EodField {
  key: string;
  /** The question as the Typeform asked it, and the sheet's column. */
  label: string;
  column: string;
  kind: EodKind;
  required?: boolean;
}

export const EOD_FIELDS: Record<EodRole, EodField[]> = {
  setter: [
    { key: "dials", label: "Dials", column: "Dials", kind: "count", required: true },
    { key: "contact_made", label: "Contact made", column: "Contact Made", kind: "count", required: true },
    { key: "conversations", label: "Conversations", column: "Conversations", kind: "count", required: true },
    { key: "quality_conversations", label: "Quality conversations", column: "Quality Conversations", kind: "count", required: true },
    // The Typeform took a range ("13-25"), so it stays words; the cockpit's
    // own total from Maqsam is shown beside it for reference.
    { key: "talk_time", label: "Talk time", column: "Talk Time", kind: "text", required: true },
    { key: "intros_scheduled", label: "Intro calls scheduled", column: "Intro Calls Scheduled", kind: "count", required: true },
    { key: "intros_booked", label: "Intros booked", column: "Intro Booked", kind: "count", required: true },
    { key: "intro_shows", label: "Intro shows", column: "Intro Shows", kind: "count", required: true },
    { key: "demos_booked", label: "Demos booked", column: "Booked Demos", kind: "count", required: true },
    { key: "calls_confirmed", label: "Calls confirmed", column: "Calls Confirmed", kind: "count" },
    { key: "deals_closed", label: "Deals closed on your sets", column: "Deals Closed", kind: "count" },
    { key: "cash", label: "Cash collected on your sets ($)", column: "Cash Collected (Sets) $", kind: "money" },
    { key: "contracted", label: "Contracted revenue on your sets ($)", column: "Contracted Revenue (Sets) $", kind: "money" },
    { key: "objections", label: "Objections you heard", column: "Objections", kind: "text", required: true },
    { key: "summary", label: "How the day went", column: "Day Summary", kind: "text", required: true },
  ],
  closer: [
    { key: "slots", label: "Slots available", column: "Slots Available", kind: "count", required: true },
    { key: "demos_scheduled", label: "Demos scheduled", column: "Demos Scheduled", kind: "count", required: true },
    { key: "demos_showed", label: "Demos showed", column: "Demos Showed", kind: "count", required: true },
    { key: "no_shows", label: "No-shows", column: "No Shows", kind: "count", required: true },
    { key: "cancels", label: "Cancels", column: "Cancels", kind: "count", required: true },
    { key: "rescheduled", label: "Rescheduled", column: "Rescheduled", kind: "count", required: true },
    { key: "offers", label: "Offers given", column: "Offers Given", kind: "count", required: true },
    { key: "deposits", label: "Deposits", column: "Deposits", kind: "count", required: true },
    { key: "closed", label: "Clients closed", column: "Clients Closed", kind: "count", required: true },
    { key: "cash", label: "Cash collected ($)", column: "Cash Collected", kind: "money", required: true },
    { key: "contracted", label: "Contracted revenue ($)", column: "Contracted Revenue ($)", kind: "money", required: true },
    { key: "objections", label: "Objections you heard", column: "Objections", kind: "text", required: true },
    { key: "summary", label: "How the day went", column: "Day Summary", kind: "text", required: true },
  ],
};

/** The sheet tab each role's EOD goes to, and its first columns. */
export const EOD_TAB: Record<EodRole, string> = { setter: "Setter", closer: "Sales Rep" };

const KUWAIT = 3 * 3_600_000;

/**
 * The working day an EOD is for, in Kuwait: before 04:00 it is still
 * yesterday's (a rep who files at 00:37 is closing the day before, as the
 * sheet's own rows show), and Friday is not a working day, so an EOD filed
 * then is Thursday's.
 */
export function eodDay(nowMs: number): string {
  let d = new Date(nowMs + KUWAIT);
  if (d.getUTCHours() < 4) d = new Date(d.getTime() - 86_400_000);
  if (d.getUTCDay() === 5) d = new Date(d.getTime() - 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** "2026-09-05 19:44:57": Kuwait time, the hour unpadded, as the sheet has it. */
export function sheetStamp(ms: number): string {
  const d = new Date(ms + KUWAIT);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.toISOString().slice(0, 10)} ${d.getUTCHours()}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** An answer as the rep typed it: a count, dollars, minutes or words. */
export function eodValue(kind: EodKind, raw: unknown): { ok: true; value: number | string | null } | { ok: false } {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { ok: true, value: null };
  if (kind === "text") return { ok: true, value: cleanText(raw, 3000) };
  const n = Number(String(raw).replace(/[$,\s]/g, "").replace(/min(ute)?s?$/i, ""));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return { ok: false };
  if (kind === "count" && !Number.isInteger(n)) return { ok: false };
  return { ok: true, value: kind === "money" ? Math.round(n * 100) / 100 : n };
}

function shown(kind: EodKind, v: unknown): string {
  if (v === null || v === undefined || v === "") return "--";
  if (kind === "money") return `$${Number(v).toLocaleString("en-US")}`;
  if (kind === "minutes") return `${v} min`;
  return String(v);
}

/**
 * The Slack message, as text: EOD Radar reads `message.text` and credits a
 * person by the name line and the "Submitted by: <@id>" line, so both are
 * always there (a missing Slack id is said in words instead).
 */
export function eodMessage(role: EodRole, name: string, slackId: string | null, day: string,
                           answers: Record<string, unknown>): string {
  const fields = EOD_FIELDS[role];
  // Talk time is words (the Typeform took a range) but belongs with the
  // numbers, where the Typeform's message had it.
  const numbers = fields.filter(f => f.key !== "objections" && f.key !== "summary");
  return [
    role === "setter" ? "*SETTER EOD*" : "*SALES REP EOD*",
    `*Date - ${day}*`,
    "",
    `*Name - ${name}*`,
    slackId ? `Submitted by: <@${slackId}>` : `Submitted by: ${name} (no Slack id on their cockpit seat)`,
    "",
    "*Today's Numbers*",
    ...numbers.map(f => `${f.label} - ${shown(f.kind, answers[f.key])}`),
    "",
    "*Objections*",
    String(answers.objections ?? "--"),
    "",
    "*Day Summary*",
    String(answers.summary ?? "--"),
    "",
    "_Filed in the sales cockpit._",
  ].join("\n");
}

/**
 * The sheet row as named columns. The worker on the VPS reads the tab's
 * header and puts each value under its column, so a reordered sheet never
 * shifts a number into the wrong column.
 */
export function eodColumns(role: EodRole, name: string, day: string, submittedMs: number,
                           responseId: string, answers: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {
    "Submitted At": sheetStamp(submittedMs),
    Name: name,
    "Response ID": responseId,
    "Date For": day,
  };
  for (const f of EOD_FIELDS[role]) {
    const v = answers[f.key];
    out[f.column] = v === null || v === undefined ? "" : f.kind === "minutes" ? `${v} min` : (v as string | number);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aziz's own call reviews (Skool and elsewhere)
// ---------------------------------------------------------------------------

export const COACH_CALL_TYPES = ["intro", "demo", "phone", "other"] as const;

/** A coach review as the form sends it, cleaned, or why it cannot be saved. */
export function checkCoachReview(b: Record<string, unknown>):
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string } {
  const title = cleanText(b.title, 200);
  if (title.length < 2) return { ok: false, error: "Give the review a title." };
  const url = cleanText(b.url, 1000);
  if (url && !/^https?:\/\/\S+$/i.test(url)) return { ok: false, error: "The link has to start with https://." };
  const lessons = cleanText(b.lessons, 20000);
  if (!url && lessons.length < 3) return { ok: false, error: "Add the link to the review, or write what to take from it." };
  const callType = cleanText(b.call_type, 10);
  if (callType && !(COACH_CALL_TYPES as readonly string[]).includes(callType))
    return { ok: false, error: "Pick intro, demo, phone or other." };
  const forEmail = cleanText(b.for_email, 200).toLowerCase();
  if (forEmail && !/^[^@\s]+@[^@\s]+$/.test(forEmail)) return { ok: false, error: "That is not a seat's email." };
  const rawTags = Array.isArray(b.tags) ? b.tags : String(b.tags ?? "").split(",");
  const tags = [...new Set(rawTags.map(t => cleanText(t, 40).toLowerCase()).filter(Boolean))].slice(0, 12);
  let score: number | null = null;
  if (b.score !== undefined && b.score !== null && b.score !== "") {
    score = Number(b.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) return { ok: false, error: "A score is 0 to 100." };
  }
  return {
    ok: true,
    row: {
      title,
      url: url || null,
      recording_id: cleanText(b.recording_id, 200) || null,
      contact_id: cleanText(b.contact_id, 80) || null,
      call_type: callType || null,
      for_email: forEmail || null,
      lessons: lessons || null,
      tags,
      score,
    },
  };
}

// ---------------------------------------------------------------------------
// WhatsApp templates and the ready-made messages
// ---------------------------------------------------------------------------

export const FOLLOWUP_SEGMENTS = ["reply", "confirm", "no_show", "cancelled", "new", "after_call", "nurture"] as const;
export type FollowupSegment = (typeof FOLLOWUP_SEGMENTS)[number];

/** What each {{n}} of a template carries, in order. */
export const TEMPLATE_VARIABLES = ["first_name", "rep_name", "line"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export const SNIPPET_MOMENTS = [
  "first_touch", "missed_call", "no_show", "cancelled", "confirm", "booked",
  "after_intro", "after_demo", "no_reply", "nurture", "proof", "reactivate", "other",
] as const;

/**
 * One line to go inside an approved WhatsApp template. Meta refuses a
 * template value with a line break, a tab or more than four spaces in a row
 * (error 132018), and a template's whole text tops out at 1,024 characters,
 * so the line is flattened and capped here, before HighLevel sees it.
 */
export function templateLine(v: unknown, max = 700): string {
  return String(v ?? "")
    .replace(/\u0000/g, "")
    .replace(/[\r\n\t\u2028\u2029]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** The approved text with the lead's values in, as the lead will read it. */
export function renderTemplate(
  preview: string,
  variables: readonly string[],
  values: Partial<Record<TemplateVariable, string | null>>,
): string {
  return preview.replace(/\{\{(\d+)\}\}/g, (all, n) => {
    const name = variables[Number(n) - 1] as TemplateVariable | undefined;
    const v = name ? values[name] : null;
    return v ? v : all;
  });
}

/** The name to greet a lead by: HighLevel's first name, else the first word of the whole name. */
export function greetingName(first: unknown, full: unknown): string {
  const f = cleanText(first, 60) || cleanText(full, 120);
  return f.split(/\s+/)[0] ?? "";
}

/** A ready-made message with what the cockpit knows put in; anything unknown stays marked for the rep. */
export function fillSnippet(
  body: string,
  values: Partial<Record<"name" | "rep" | "day" | "time", string | null>>,
): string {
  return body.replace(/\{(name|rep|day|time)\}/g, (all, k: "name" | "rep" | "day" | "time") => values[k] || all);
}

export interface TemplateRoute {
  key: string;
  name: string;
  language: "ar" | "en";
  purpose: string;
  preview: string;
  variables: TemplateVariable[];
  workflow_id: string | null;
  active: boolean;
  segments: FollowupSegment[];
  sort: number;
}

/** A template route as a manager saves it, or why it cannot be saved. */
export function checkTemplateRoute(b: Record<string, unknown>): { ok: true; value: TemplateRoute } | { ok: false; error: string } {
  const key = cleanText(b.key, 40).toLowerCase();
  if (!/^[a-z0-9_]{2,40}$/.test(key)) return { ok: false, error: "Give it a short key: lowercase letters, digits and _." };
  const name = cleanText(b.name, 120);
  if (!/^[a-z0-9_]{1,120}$/.test(name))
    return { ok: false, error: "Type the template's name exactly as HighLevel shows it (lowercase, digits and _)." };
  const language = String(b.language ?? "");
  if (language !== "ar" && language !== "en") return { ok: false, error: "Pick Arabic or English." };
  const purpose = cleanText(b.purpose, 300);
  if (purpose.length < 3) return { ok: false, error: "Say in a few words what the template is for." };
  const preview = String(b.preview ?? "").replace(/\r\n/g, "\n").trim();
  if (!preview || preview.length > 1024) return { ok: false, error: "Paste the approved text (1,024 characters at most)." };
  const variables = (Array.isArray(b.variables) ? b.variables : []).map(v => String(v)) as TemplateVariable[];
  if (variables.some(v => !(TEMPLATE_VARIABLES as readonly string[]).includes(v)))
    return { ok: false, error: "Each {{n}} is the first name, the rep's name or the line." };
  const slots = [...new Set([...preview.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
  if (slots.length !== variables.length || slots.some((n, i) => n !== i + 1))
    return { ok: false, error: `The text has ${slots.length} {{n}} and ${variables.length} values are named; they have to match, from {{1}} on.` };
  const workflow = cleanText(b.workflow_id, 60) || null;
  if (workflow && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workflow))
    return { ok: false, error: "That is not a HighLevel workflow id." };
  const active = b.active === true;
  if (active && !workflow) return { ok: false, error: "Pick the workflow that sends it before switching it on." };
  const segments = (Array.isArray(b.segments) ? b.segments : []).map(s => String(s)) as FollowupSegment[];
  if (segments.some(s => !(FOLLOWUP_SEGMENTS as readonly string[]).includes(s)))
    return { ok: false, error: "That is not a kind of follow-up." };
  const sort = Number(b.sort ?? 100);
  if (!Number.isInteger(sort) || sort < 0 || sort > 1000) return { ok: false, error: "The order is a whole number from 0 to 1000." };
  return { ok: true, value: { key, name, language, purpose, preview, variables, workflow_id: workflow, active, segments, sort } };
}

/** A ready-made message as a manager saves it, or why it cannot be saved. */
export function checkSnippet(b: Record<string, unknown>):
  | { ok: true; row: { moment: string; language: "ar" | "en"; body: string; sort: number } }
  | { ok: false; error: string } {
  const moment = String(b.moment ?? "");
  if (!(SNIPPET_MOMENTS as readonly string[]).includes(moment)) return { ok: false, error: "Pick when the message is for." };
  const language = String(b.language ?? "");
  if (language !== "ar" && language !== "en") return { ok: false, error: "Pick Arabic or English." };
  const body = String(b.body ?? "").replace(/\r\n/g, "\n").trim();
  if (body.length < 2 || body.length > 1500) return { ok: false, error: "Write the message (1,500 characters at most)." };
  const sort = Number(b.sort ?? 100);
  if (!Number.isInteger(sort) || sort < 0 || sort > 1000) return { ok: false, error: "The order is a whole number from 0 to 1000." };
  return { ok: true, row: { moment, language, body, sort } };
}
