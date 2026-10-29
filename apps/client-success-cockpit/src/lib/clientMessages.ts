import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * The client's WhatsApp messages as a browser reads and decides them
 * (docs/forms/STAGE2B-CONTRACT.md 3.7, 4.3 and 5.1): the one message a
 * client's group reads after a 1-1, which a person approves (the exact text
 * they saw), skips, or reopens. Reads, Skip and reopen are gated RPCs
 * through the seat's own client (cockpit_client_messages_read, _waiting,
 * cockpit_client_message_read, _skip, _reopen; the database checks every
 * gate and writes every audit row). Approve is never an RPC from here: it
 * goes through cockpit-forms-api's op recap.approve, which runs the recap's
 * checks on the text, then the service RPC with the verified seat
 * (Z27, src/forms/checkinClient.ts approveRecap; the IO that joins both is
 * src/forms/RecapApproval.tsx messagesIO). Nothing here talks to WhatsApp.
 */

type Rpc = Pick<SupabaseClient, "rpc">;

/** A refusal or failure, in the server's words, with its Postgres code. */
export class MessageError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.code = code;
  }
}

/** The RPC is not in the database yet (before the deploy, or rolled back). */
export const NOT_LIVE =
  "Approving client recaps is not live in the cockpit yet. Tell the tech lead.";
export const notLive = (e: unknown) =>
  e instanceof Error && e.message === NOT_LIVE;

const nul = <T extends z.ZodType>(s: T) =>
  s.nullish().transform(v => (v ?? null) as z.output<T> | null);

export const MESSAGE_STATES = [
  "draft",
  "approved",
  "claimed",
  "sending",
  "sent",
  "unknown",
  "failed",
  "refused",
  "skipped",
] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

/** 3.7 MessageView: never the claim token, the provider's id or an address. */
export const messageView = z.object({
  id: z.string(),
  kind: z.string(),
  state: z.enum(MESSAGE_STATES),
  taskId: z.string(),
  clientName: nul(z.string()),
  responseId: nul(z.string()),
  body: z.string(),
  reason: nul(z.string()),
  callAt: nul(z.string()),
  /** A role ("the CSM"), never an address. */
  approvedBy: nul(z.string()),
  approvedAt: nul(z.string()),
  expiresAt: nul(z.string()),
  sentAt: nul(z.string()),
  readBack: nul(z.object({ by: nul(z.string()), at: nul(z.string()) })),
  /** The registry's current owner of the recap effect. */
  owner: nul(z.enum(["make", "shadow", "cockpit"])),
  /** The recap effect's state. */
  effectState: nul(z.string()),
});
export type MessageView = z.output<typeof messageView>;

/**
 * A list of views, bare or under `messages` (the RPCs answer one or the
 * other; the screens read both).
 */
const messageList = z
  .union([
    z.array(messageView),
    z.object({ messages: z.array(messageView) }).passthrough(),
  ])
  .transform(v => (Array.isArray(v) ? v : v.messages));

/** One view, bare or under `message`. */
const oneMessage = z
  .union([messageView, z.object({ message: messageView }).passthrough()])
  .transform(v => ("message" in v ? v.message : v));

/** recap.approve's answer (4.3): the stored row, or warnings to confirm first. */
export const approveAnswer = z.union([
  z.object({
    needsConfirm: z.literal(true),
    warnings: z.array(z.string()).default([]),
  }),
  z.object({
    message: messageView,
    warnings: z.array(z.string()).default([]),
  }),
]);
export type ApproveAnswer = z.output<typeof approveAnswer>;

/** An action that came back with no sentence of its own: what to do next. */
export const NO_REASON =
  "No reason came back. Try again; if it stays, tell the tech lead.";
/** A refused or failed message with no reason: its two buttons are the next step. */
export const NO_WHATSAPP_REASON =
  "WhatsApp gave no reason. Try again, or skip it.";
/** Missing is never zero: the same sentence on the card and in the window. */
export const MESSAGES_FAILED =
  "The messages could not be read, so a recap may be missing here. Reload the page; if it stays, tell the tech lead.";

function plain(error: { message?: string; code?: string } | null): never {
  const m = String(error?.message ?? "").trim();
  const code = error?.code ?? null;
  if (
    /could not find the function|PGRST202|schema cache|does not exist/i.test(m)
  )
    throw new MessageError(NOT_LIVE, code);
  if (/JWT|not authenticated/i.test(m))
    throw new MessageError("Sign in again, then try once more.", code);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m))
    throw new MessageError(
      "The connection dropped. Nothing was changed; try again when you are back online.",
      code,
    );
  throw new MessageError(m || NO_REASON, code);
}

async function call<T>(
  client: Rpc,
  fn: string,
  args: Record<string, unknown> | undefined,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await (args === undefined
    ? client.rpc(fn)
    : client.rpc(fn, args));
  if (error) plain(error);
  const out = schema.safeParse(data);
  if (!out.success)
    throw new MessageError(
      "The messages came back in a shape this page does not read. Reload the page; if it stays, tell the tech lead.",
    );
  return out.data;
}

/** The client's newest 20 messages, newest first (cockpit_client_messages_read). */
export function readClientMessages(
  client: Rpc,
  taskId: string,
): Promise<MessageView[]> {
  return call(
    client,
    "cockpit_client_messages_read",
    { p_task_id: taskId },
    messageList,
  );
}

/**
 * Today's rows (cockpit_client_messages_waiting): drafts, refused and
 * failed messages of the seat's clients, and for the CEO or an admin the
 * ones WhatsApp never confirmed.
 */
export function readMessagesWaiting(client: Rpc): Promise<MessageView[]> {
  return call(
    client,
    "cockpit_client_messages_waiting",
    undefined,
    messageList,
  );
}

export function readClientMessage(
  client: Rpc,
  id: string,
): Promise<MessageView> {
  return call(client, "cockpit_client_message_read", { p_id: id }, oneMessage);
}

/** Skip: nothing is sent (draft, approved, refused or failed). */
export function skipClientMessage(
  client: Rpc,
  id: string,
  reason: string | null = null,
): Promise<MessageView> {
  return call(
    client,
    "cockpit_client_message_skip",
    { p_id: id, p_reason: reason },
    oneMessage,
  );
}

/** Back to a draft to edit and approve again (approved, refused or failed). */
export function reopenClientMessage(
  client: Rpc,
  id: string,
): Promise<MessageView> {
  return call(
    client,
    "cockpit_client_message_reopen",
    { p_id: id },
    oneMessage,
  );
}

// ------------------------------------------------------------ the IO

/** What the Messages card, Today's rows and the window's step call. */
export interface MessagesIO {
  read(taskId: string): Promise<MessageView[]>;
  waiting(): Promise<MessageView[]>;
  approve(a: {
    messageId: string;
    body: string;
    acceptWarnings: boolean;
  }): Promise<ApproveAnswer>;
  skip(messageId: string): Promise<MessageView>;
  reopen(messageId: string): Promise<MessageView>;
}

// ------------------------------------------------------------ the words

/** The app's base path, read when used (tests run without Vite's env). */
const base = () =>
  (import.meta.env?.BASE_URL ?? "/client-success/").replace(/\/$/, "");

/** The client's Messages card, as a path inside the app (a router link). */
export const messagesPath = (taskId: string) =>
  `/clients/${encodeURIComponent(taskId)}?tab=overview#messages`;
/** The same, as a full href for a plain link (the 1-1 notes window, the trail). */
export const messagesHref = (taskId: string) =>
  `${base()}${messagesPath(taskId)}`;

/** A message that waits on a person (Today's rows, the reminder). */
export const WAITING_STATES: ReadonlySet<MessageState> = new Set([
  "draft",
  "refused",
  "failed",
  "unknown",
]);

/** The sentence of one Today row (5.1). */
export function todayLine(m: MessageView): string {
  const client = m.clientName?.trim() || "this client";
  if (m.state === "draft")
    return `Recap waiting: ${client}. Read it, then approve or skip it.`;
  if (m.state === "unknown")
    return `Recap not confirmed: ${client}. Look in the group before anything else.`;
  const reason = m.reason?.trim() || NO_WHATSAPP_REASON;
  return `Recap not sent: ${client}. ${/[.!?]$/.test(reason) ? reason : `${reason}.`}`;
}

/**
 * The text as WhatsApp shows it: a single `*` around words is bold, and
 * the stars go. Nothing else changes, so what is previewed is what is sent.
 */
export type Piece = { text: string; bold: boolean };
const BOLD =
  /(^|[\s(،.,!?;:"'])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?=$|[\s)،.,!?;:"'])/gu;
export function whatsappPieces(body: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of body.matchAll(BOLD)) {
    const at = (m.index ?? 0) + m[1].length;
    if (at > last) out.push({ text: body.slice(last, at), bold: false });
    out.push({ text: m[2], bold: true });
    last = at + m[2].length + 2;
  }
  if (last < body.length) out.push({ text: body.slice(last), bold: false });
  return out;
}
