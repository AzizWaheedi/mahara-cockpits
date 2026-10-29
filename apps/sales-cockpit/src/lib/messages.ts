/**
 * The Messages page's rules (Aziz, 2026-10-29: "the same way in the CRM
 * there's a messages section and they can filter the messages per platform
 * ... filtering by which inbox and which lead each is assigned to, like a
 * messages section for every single person").
 *
 * The list and its numbers come from cockpit_sales_conversations_list and
 * cockpit_sales_conversations_counts (migration 20261029d), over the copy
 * the sales-conversations worker keeps of HighLevel every minute. Needs a
 * reply means the lead wrote last and no person has answered since; the
 * clock beside it runs against the team's one-hour reply standard.
 */

export type InboxChannel =
  | "whatsapp"
  | "email"
  | "instagram"
  | "facebook"
  | "sms"
  | "call"
  | "webchat"
  | "google";

/**
 * The channels a rep filters by, in the order the chips show them. SMS is
 * not one (Aziz: "we don't even have anything connected to SMS"): every SMS
 * in the sub-account went through a WhatsApp connector, either as the copy
 * of a WhatsApp step (hidden) or, before June 2026, as WhatsApp itself, and
 * those older threads stay under All.
 */
export const FILTER_CHANNELS: InboxChannel[] = [
  "whatsapp",
  "email",
  "instagram",
  "facebook",
];

export const CHANNEL_LABEL: Record<InboxChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  instagram: "Instagram",
  facebook: "Facebook",
  sms: "SMS",
  call: "Call",
  webchat: "Web chat",
  google: "Google",
};

export type InboxState = "reply" | "unread" | "all" | "auto";

export const STATE_LABEL: Record<InboxState, string> = {
  reply: "Needs reply",
  unread: "Unread",
  all: "All",
  auto: "Automations only",
};

/** Whose inbox: everyone's, the unassigned queue, or one person's HighLevel user id. */
export type InboxPerson = "everyone" | "unassigned" | string;

export interface InboxRow {
  conversation_id: string;
  contact_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  assigned_to: string | null;
  owner: string | null;
  stage: string | null;
  client: boolean;
  channels: InboxChannel[];
  accounts: string[];
  last_at: string | null;
  last_channel: InboxChannel | null;
  last_direction: "inbound" | "outbound" | null;
  last_body: string | null;
  last_automated: boolean | null;
  last_in_at: string | null;
  last_in_channel: InboxChannel | null;
  last_in_body: string | null;
  last_reply_at: string | null;
  last_reply_by: string | null;
  needs_reply: boolean;
  unread: number;
  copies: number;
  /** False while the worker has not read this conversation's messages yet. */
  read: boolean;
  sort_at: string;
}

export interface InboxPage {
  rows: InboxRow[];
  more: boolean;
}

export interface Tally {
  reply: number;
  all: number;
}

export interface InboxCounts {
  states: Record<InboxState, number>;
  channels: Partial<Record<InboxChannel, Tally>>;
  accounts: ({ key: string } & Tally)[];
  people: ({
    ghl_user_id: string;
    name: string;
    role: string | null;
  } & Tally)[];
  unassigned: Tally;
  everyone: Tally;
  sync: {
    last_ok_at: string | null;
    last_run_at: string | null;
    last_error: string | null;
    full_done_at: string | null;
    conversations: number;
    unread_backlog: number;
  } | null;
  sms_pause: {
    workflows: number;
    steps: number;
    since: string | null;
    copies_since: number;
  } | null;
  reply_days: number;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null;
const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const isChannel = (v: unknown): v is InboxChannel =>
  typeof v === "string" && v in CHANNEL_LABEL;
const tally = (v: unknown): Tally => ({
  reply: n(isObj(v) ? v.reply : 0),
  all: n(isObj(v) ? v.all : 0),
});

/** The list function's answer, or a thrown error: a garbled answer is never an empty inbox. */
export function readInboxPage(v: unknown): InboxPage {
  if (!isObj(v) || !Array.isArray(v.rows))
    throw new Error("The messages could not be read: the answer was not one.");
  const rows = v.rows.flatMap((r): InboxRow[] => {
    if (!isObj(r) || !str(r.conversation_id) || !str(r.contact_id)) return [];
    return [
      {
        conversation_id: String(r.conversation_id),
        contact_id: String(r.contact_id),
        name: str(r.name),
        phone: str(r.phone),
        email: str(r.email),
        assigned_to: str(r.assigned_to),
        owner: str(r.owner),
        stage: str(r.stage),
        client: r.client === true,
        channels: Array.isArray(r.channels) ? r.channels.filter(isChannel) : [],
        accounts: Array.isArray(r.accounts)
          ? r.accounts.filter((a): a is string => typeof a === "string")
          : [],
        last_at: str(r.last_at),
        last_channel: isChannel(r.last_channel) ? r.last_channel : null,
        last_direction:
          r.last_direction === "inbound" || r.last_direction === "outbound"
            ? r.last_direction
            : null,
        last_body: str(r.last_body),
        last_automated:
          typeof r.last_automated === "boolean" ? r.last_automated : null,
        last_in_at: str(r.last_in_at),
        last_in_channel: isChannel(r.last_in_channel)
          ? r.last_in_channel
          : null,
        last_in_body: str(r.last_in_body),
        last_reply_at: str(r.last_reply_at),
        last_reply_by: str(r.last_reply_by),
        needs_reply: r.needs_reply === true,
        unread: n(r.unread),
        copies: n(r.copies),
        read: r.read !== false,
        sort_at: str(r.sort_at) ?? str(r.last_at) ?? "",
      },
    ];
  });
  return { rows, more: v.more === true };
}

export function readInboxCounts(v: unknown): InboxCounts {
  if (!isObj(v) || !isObj(v.states))
    throw new Error(
      "The message counts could not be read: the answer was not one.",
    );
  const states = v.states;
  const channels: Partial<Record<InboxChannel, Tally>> = {};
  if (isObj(v.channels))
    for (const [k, t] of Object.entries(v.channels))
      if (isChannel(k)) channels[k] = tally(t);
  const sync = isObj(v.sync) ? v.sync : null;
  const pause = isObj(v.sms_pause) ? v.sms_pause : null;
  return {
    states: {
      reply: n(states.reply),
      unread: n(states.unread),
      all: n(states.all),
      auto: n(states.auto),
    },
    channels,
    accounts: Array.isArray(v.accounts)
      ? v.accounts.flatMap(a =>
          isObj(a) && str(a.key) ? [{ key: String(a.key), ...tally(a) }] : [],
        )
      : [],
    people: Array.isArray(v.people)
      ? v.people.flatMap(p =>
          isObj(p) && str(p.ghl_user_id)
            ? [
                {
                  ghl_user_id: String(p.ghl_user_id),
                  name: str(p.name) ?? "Someone",
                  role: str(p.role),
                  ...tally(p),
                },
              ]
            : [],
        )
      : [],
    unassigned: tally(v.unassigned),
    everyone: tally(v.everyone),
    sync: sync
      ? {
          last_ok_at: str(sync.last_ok_at),
          last_run_at: str(sync.last_run_at),
          last_error: str(sync.last_error),
          full_done_at: str(sync.full_done_at),
          conversations: n(sync.conversations),
          unread_backlog: n(sync.unread_backlog),
        }
      : null,
    sms_pause: pause
      ? {
          workflows: n(pause.workflows),
          steps: n(pause.steps),
          since: str(pause.since),
          copies_since: n(pause.copies_since),
        }
      : null,
    reply_days: n(v.reply_days) || 14,
  };
}

/** The person filter as the database takes it. */
export function personParam(p: InboxPerson): string | null {
  return p === "everyone" ? null : p;
}

/** An inbox key ("whatsapp:+96590054963") as people say it. */
export function accountLabel(key: string): string {
  const i = key.indexOf(":");
  const channel = key.slice(0, i);
  const value = key.slice(i + 1);
  if (channel === "whatsapp") return `WhatsApp ${spacedPhone(value)}`;
  if (channel === "instagram") return `Instagram @${value}`;
  if (channel === "facebook") return `Facebook page ${value}`;
  if (channel === "email") return value;
  return value;
}

/** +96590054963 as +965 9005 4963 (Gulf numbers), else as it is. */
export function spacedPhone(p: string): string {
  const m = /^\+(965|966|971|973|974|968)(\d{4})(\d{3,5})$/.exec(p);
  return m ? `+${m[1]} ${m[2]} ${m[3]}` : p;
}

/** How long the lead has waited, against the one-hour reply standard. */
export type WaitTone = "fresh" | "due" | "late" | "stale";
export function waitTone(sinceIso: string | null, now: number): WaitTone {
  const t = sinceIso ? Date.parse(sinceIso) : Number.NaN;
  if (!Number.isFinite(t)) return "fresh";
  const min = (now - t) / 60_000;
  if (min < 30) return "fresh";
  if (min < 60) return "due";
  if (min < 24 * 60) return "late";
  return "stale";
}

/** 7m, 2h 14m, 3d: the wait in the fewest words. */
export function waitWords(sinceIso: string | null, now: number): string {
  const t = sinceIso ? Date.parse(sinceIso) : Number.NaN;
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h}h ${min % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** The share of the reply hour gone, 0 to 1, for the clock's bar. */
export function hourShare(sinceIso: string | null, now: number): number {
  const t = sinceIso ? Date.parse(sinceIso) : Number.NaN;
  if (!Number.isFinite(t)) return 0;
  return Math.min(1, Math.max(0, (now - t) / 3_600_000));
}

/** The line under the name: what was said last, and by whom. */
export function previewLine(r: InboxRow): string {
  if (r.needs_reply && r.last_in_body) return r.last_in_body;
  const body = r.last_body ?? "";
  if (r.last_direction === "outbound")
    return `${r.last_automated ? "Automation" : (r.last_reply_by?.split(" ")[0] ?? "We")}: ${body}`;
  return body;
}

/** Is the copy behind? Said in words when it is; null when it is fresh. */
export function syncWords(
  sync: InboxCounts["sync"],
  now: number,
): { tone: "ok" | "behind" | "reading"; text: string } {
  if (!sync?.last_ok_at)
    return {
      tone: "behind",
      text: sync?.last_error
        ? `Messages are not coming in from HighLevel: ${sync.last_error}`
        : "Messages have not been copied from HighLevel yet.",
    };
  const age = now - Date.parse(sync.last_ok_at);
  if (age > 5 * 60_000)
    return {
      tone: "behind",
      text: `Messages may be behind: the last copy from HighLevel was ${Math.round(age / 60_000)} minutes ago.${sync.last_error ? ` ${sync.last_error}` : ""}`,
    };
  if (sync.unread_backlog > 0)
    return {
      tone: "reading",
      text: `Reading older conversations from HighLevel: ${(sync.conversations - sync.unread_backlog).toLocaleString("en-US")} of ${sync.conversations.toLocaleString("en-US")} so far. New messages come in every minute meanwhile.`,
    };
  return { tone: "ok", text: "Up to date with HighLevel" };
}
