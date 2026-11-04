// The sales-conversations worker's pure parts: how a HighLevel conversation
// and message become cockpit rows. No I/O here, so every rule is tested in
// lib.test.ts. sales-api's lib.ts channelOf names channels the same way
// (lib.test.ts checks the two agree).

type Row = Record<string, unknown>;

export const SALES_LOCATION = "7NI8yyJtwsh2OOWA5Icr";

/**
 * The WA2 Connector: a third-party custom SMS provider in the sales
 * sub-account. Every WhatsApp step in the HighLevel workflows had an SMS
 * twin that went through it; none was ever marked delivered or answered.
 */
export const CONNECTOR_PROVIDER = "67c822224c79561add263440";

export type ConvChannel = "whatsapp" | "email" | "instagram" | "facebook" | "sms" | "call" | "webchat" | "google";

/** HighLevel's messageType (or its number) as the channel a rep would name; null for what is not a message. */
export function channelOfType(messageType: unknown): ConvChannel | null {
  const raw = String(messageType ?? "").toUpperCase().trim();
  const byNumber: Record<string, string> = {
    "1": "TYPE_CALL",
    "2": "TYPE_SMS",
    "3": "TYPE_EMAIL",
    "11": "TYPE_FACEBOOK",
    "15": "TYPE_GMB",
    "18": "TYPE_INSTAGRAM",
    "19": "TYPE_WHATSAPP",
    "20": "TYPE_CUSTOM_SMS",
    "21": "TYPE_CUSTOM_EMAIL",
    "22": "TYPE_CUSTOM_PROVIDER_SMS",
    "23": "TYPE_CUSTOM_PROVIDER_EMAIL",
    "29": "TYPE_LIVE_CHAT",
  };
  const t = byNumber[raw] ?? raw;
  // Comments on posts, activity lines and internal notes are not messages.
  if (!t || t.includes("COMMENT") || t.includes("ACTIVITY") || t.includes("INFO")) return null;
  if (t.includes("WHATSAPP")) return "whatsapp";
  if (t.includes("INSTAGRAM")) return "instagram";
  if (t.includes("FACEBOOK")) return "facebook";
  if (t.includes("EMAIL")) return "email";
  if (t.includes("CALL") || t.includes("VOICEMAIL")) return "call";
  if (t.includes("SMS")) return "sms";
  if (t.includes("LIVE_CHAT") || t.includes("WEBCHAT")) return "webchat";
  if (t.includes("GMB")) return "google";
  return null;
}

/** Sent by an automation rather than a person (a rep in HighLevel, or the cockpit). */
const AUTOMATED_SOURCES = new Set([
  "workflow",
  "campaign",
  "bulk_actions",
  "bulk_action",
  "automation",
  "trigger",
  "drip",
  "sequence",
  "ai_bot",
  "conversation_ai",
  "review_request",
]);
export function automatedSource(source: unknown): boolean {
  return AUTOMATED_SOURCES.has(String(source ?? "").toLowerCase().trim());
}

/** An SMS the WA2 Connector sent: the copy of a WhatsApp step, kept but never shown as a message. */
export function connectorCopy(m: Row, channel: ConvChannel | null): boolean {
  if (channel !== "sms" || m.direction !== "outbound") return false;
  if (String(m.conversationProviderId ?? "") === CONNECTOR_PROVIDER) return true;
  return /\bwa2?\s*connector\b/i.test(String(m.from ?? ""));
}

const clean = (v: unknown, max: number): string =>
  String(v ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, max);

/** HTML as plain text, keeping paragraph breaks. */
export function plainText(v: unknown, html: boolean): string {
  let s = String(v ?? "");
  if (html) {
    s = s
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  }
  return s;
}

/** The phone as +digits, or null. */
function phoneOf(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 7 ? `+${d}` : null;
}

/** The inbox on our side: the WhatsApp number, our email address, or the Instagram or Facebook page. */
export function accountOf(m: Row, channel: ConvChannel): string | null {
  const ours = m.direction === "outbound" ? m.from : m.to;
  const meta = (m.meta ?? {}) as Row;
  if (channel === "instagram" || channel === "facebook") {
    const page = (meta[channel === "instagram" ? "ig" : "fb"] ?? {}) as Row;
    const name = clean(page.pageName ?? (m.direction === "outbound" ? m.from : m.to), 120);
    return name || null;
  }
  if (channel === "whatsapp") return phoneOf(ours);
  if (channel === "email") {
    const email = (meta.email ?? {}) as Row;
    const v = String((m.direction === "outbound" ? (email.from ?? m.from) : (email.to ?? m.to)) ?? "");
    const at = /[^\s<>"',;]+@[^\s<>"',;]+\.[a-z]{2,}/i.exec(v);
    return at ? at[0].toLowerCase() : null;
  }
  return null;
}

/** HighLevel's millisecond or ISO time as ISO, or null. */
export function isoOf(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : /^\d+$/.test(String(v)) ? Number(v) : Date.parse(String(v));
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

/** A HighLevel message as a cockpit row, or null for what is not a message. */
export function messageRow(m: Row, at: string): Row | null {
  const id = clean(m.id, 80);
  const conversationId = clean(m.conversationId, 80);
  const contactId = clean(m.contactId, 80);
  const when = isoOf(m.dateAdded);
  const direction = m.direction === "inbound" || m.direction === "outbound" ? m.direction : null;
  const channel = channelOfType(m.messageType ?? m.type);
  if (!id || !conversationId || !contactId || !when || !direction || !channel) return null;
  const meta = (m.meta ?? {}) as Row;
  const email = (meta.email ?? {}) as Row;
  const html = /html/i.test(String(m.contentType ?? "")) || channel === "email";
  const status = m.status ? clean(m.status, 40).toLowerCase() : null;
  const failed = status !== null && ["failed", "undelivered", "bounced", "opt_out"].includes(status);
  let error: string | null = null;
  if (failed) {
    for (const v of [m.error, m.errorMessage, meta.error, meta.errorMessage, meta.failedReason, m.statusReason]) {
      if (!v) continue;
      error = clean(typeof v === "string" ? v : JSON.stringify(v), 500) || null;
      if (error) break;
    }
  }
  return {
    id,
    conversation_id: conversationId,
    contact_id: contactId,
    at: when,
    direction,
    channel,
    type: m.messageType ? clean(m.messageType, 60) : null,
    account: accountOf(m, channel),
    body: clean(plainText(m.body, html), 8000) || null,
    subject: clean(email.subject ?? m.subject, 300) || null,
    status,
    error,
    source: m.source ? clean(m.source, 40) : null,
    user_id: m.userId ? clean(m.userId, 80) : null,
    automated: automatedSource(m.source),
    copy: connectorCopy(m, channel),
    attachments: (Array.isArray(m.attachments) ? m.attachments : [])
      .map(a => String(a ?? ""))
      .filter(a => /^https:\/\//.test(a))
      .slice(0, 5),
    mirrored_at: at,
  };
}

/**
 * A conversation from HighLevel's search as the cockpit's row: who it is
 * and HighLevel's own fields. The summary columns are never written here;
 * cockpit_sales_conversation_refresh works them out from the messages.
 */
export function conversationRow(c: Row, at: string): Row | null {
  const id = clean(c.id, 80);
  const contactId = clean(c.contactId, 80);
  if (!id || !contactId) return null;
  const unread = Number(c.unreadCount);
  return {
    conversation_id: id,
    contact_id: contactId,
    contact_name: clean(c.fullName ?? c.contactName, 200) || null,
    email: clean(c.email, 200).toLowerCase() || null,
    phone: clean(c.phone, 40) || null,
    assigned_to: c.assignedTo ? clean(c.assignedTo, 80) : null,
    tags: (Array.isArray(c.tags) ? c.tags : []).map(t => clean(t, 80)).filter(Boolean).slice(0, 50),
    unread: Number.isFinite(unread) && unread > 0 ? Math.floor(unread) : 0,
    starred: c.starred === true,
    ghl_last_at: isoOf(c.lastMessageDate),
    ghl_updated_at: isoOf(c.dateUpdated),
    ghl_last_type: c.lastMessageType ? clean(c.lastMessageType, 60) : null,
    mirrored_at: at,
  };
}

/**
 * Which conversations need their messages read: new ones, ones never read,
 * and ones whose last message HighLevel moved on since the copy.
 */
export function needsMessages(
  fresh: { conversation_id: string; ghl_last_at: string | null }[],
  stored: Map<string, { ghl_last_at: string | null; messages_synced_at: string | null }>,
): string[] {
  return fresh
    .filter(f => {
      const s = stored.get(f.conversation_id);
      if (!s || !s.messages_synced_at) return true;
      const a = f.ghl_last_at ? Date.parse(f.ghl_last_at) : 0;
      const b = s.ghl_last_at ? Date.parse(s.ghl_last_at) : 0;
      return a > b;
    })
    .map(f => f.conversation_id);
}

export function redact(s: string): string {
  return String(s)
    .replace(/sbp_[A-Za-z0-9]+/g, "[key]")
    .replace(/pit-[A-Za-z0-9-]+/g, "[key]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [key]")
    .slice(0, 400);
}
