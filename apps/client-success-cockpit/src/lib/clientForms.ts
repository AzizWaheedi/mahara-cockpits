import type { SupabaseClient } from "@supabase/supabase-js";
import { type Doors, NO_DOORS } from "@/forms/staff/lifecycleClient";
import {
  type AnswerRead,
  answerRead,
  type Channel,
  type InviteView,
  type IssueResult,
  inviteView,
  issueResult,
  type Lang,
  type TodayRow,
  todayRows,
} from "./clientFormsCore";

/**
 * The browser calls behind Send a form, Forms out and Today's form bands
 * (docs/forms/WAVE34-CONTRACT.md 3.3, 4.10): the seat RPCs of migration
 * 20261102a through the seat's own Supabase client, and the WhatsApp
 * approval through cockpit-forms-api's seat op `invite.approve` (4.1.5; the
 * service key never runs it). The database gates every call, writes every
 * audit row and words every refusal; this file passes the sentence on
 * unchanged. Nothing here talks to WhatsApp, the portal or Slack.
 *
 * A raw link (`cockpit_form_invite_link`) is returned to the caller once and
 * never stored here: no cache, no storage, no log.
 */

type Any = any;
export type FormsClient = Pick<SupabaseClient, "rpc" | "functions">;

/** A refusal or a lost connection, with the sentence to show. */
export class FormsError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "FormsError";
    this.code = code;
  }
}

/** The RPC is not in the database yet (before 20261102a, or rolled back). */
export const FORMS_NOT_LIVE = "Opens after the next cockpit update.";
export const FORMS_SHAPE =
  "The forms came back in a shape this page does not read. Reload the page; if it stays, tell the tech lead.";

function said(error: { message?: string; code?: string } | null): never {
  const m = String(error?.message ?? "").trim();
  const code = error?.code ?? null;
  if (/could not find the function|PGRST202|schema cache/i.test(m))
    throw new FormsError(FORMS_NOT_LIVE, code);
  throw new FormsError(
    m || "The server refused this with no reason. Try again in a minute.",
    code,
  );
}

async function rpc(
  c: FormsClient | null,
  name: string,
  args?: Record<string, unknown>,
): Promise<Any> {
  if (!c) throw new FormsError("Sign in to the cockpit, then try again.");
  const { data, error } = await Promise.resolve().then(() =>
    args === undefined ? c.rpc(name) : c.rpc(name, args),
  );
  if (error) said(error);
  return data;
}

function need<T>(v: T | null): T {
  if (v === null) throw new FormsError(FORMS_SHAPE);
  return v;
}

export type IssueArgs = {
  taskId: string;
  formKey: string;
  channels: Channel[];
  note: string | null;
  lang: Lang;
  push: boolean;
  context?: Record<string, unknown>;
  requestId: string;
  /** Where it is sent from: the client page, the pause sheet, the churn tracker (3.3), Billing's receipt ask (waves 5-6). */
  origin: "csm" | "pause" | "churn" | "billing";
};

export type ApproveResult =
  | { needsConfirm: true; warnings: string[] }
  | { needsConfirm: false; warnings: string[]; state: string | null };

/** What Send a form, Forms out and Today call; the tests and the harness pass stand-ins. */
export interface FormsIO {
  view(taskId: string): Promise<InviteView>;
  issue(a: IssueArgs): Promise<IssueResult>;
  withdraw(
    taskId: string,
    inviteId: string,
    reason: string,
  ): Promise<InviteView | null>;
  link(
    taskId: string,
    inviteId: string,
  ): Promise<{ url: string; expiresAt: string | null }>;
  today(): Promise<TodayRow[]>;
  answer(responseId: string): Promise<AnswerRead>;
  live(): Promise<string[]>;
  /** The draft's stored text, to approve from Today without the Send panel. */
  messageBody(messageId: string): Promise<string>;
  approve(a: {
    messageId: string;
    body: string;
    acceptWarnings?: boolean;
  }): Promise<ApproveResult>;
}

export function inviteViewRead(c: FormsClient | null, taskId: string) {
  return rpc(c, "cockpit_form_invite_view", { p_task_id: taskId }).then(d =>
    need(inviteView(d)),
  );
}

export function issueInvite(c: FormsClient | null, a: IssueArgs) {
  return rpc(c, "cockpit_form_invite_issue", {
    p_task_id: a.taskId,
    p_form_key: a.formKey,
    p_channels: a.channels,
    p_note: a.note?.trim() || null,
    p_lang: a.lang,
    p_push: a.push,
    p_context: a.context ?? {},
    p_request_id: a.requestId,
    p_origin: a.origin,
  }).then(d => need(issueResult(d)));
}

export function withdrawInvite(
  c: FormsClient | null,
  taskId: string,
  inviteId: string,
  reason: string,
) {
  return rpc(c, "cockpit_form_invite_withdraw", {
    p_task_id: taskId,
    p_invite_id: inviteId,
    p_reason: reason.trim(),
  }).then(d => inviteView(d));
}

export async function inviteLink(
  c: FormsClient | null,
  taskId: string,
  inviteId: string,
): Promise<{ url: string; expiresAt: string | null }> {
  const d = await rpc(c, "cockpit_form_invite_link", {
    p_task_id: taskId,
    p_invite_id: inviteId,
  });
  const url = typeof d?.url === "string" ? d.url : "";
  // Only the portal's link page: anything else is not shown or copied.
  if (!/^https:\/\/portal\.maharamedia\.com\/f#f1[A-Za-z0-9_-]{43}$/.test(url))
    throw new FormsError(FORMS_SHAPE);
  return {
    url,
    expiresAt: typeof d?.expiresAt === "string" ? d.expiresAt : null,
  };
}

export function invitesToday(c: FormsClient | null) {
  return rpc(c, "cockpit_form_invites_today").then(todayRows);
}

export function answerReadOf(c: FormsClient | null, responseId: string) {
  return rpc(c, "cockpit_form_answer_read", {
    p_response_id: responseId,
  }).then(d => need(answerRead(d)));
}

/** The client forms live today (forms.client.live), for the Links rows (4.11). */
export async function liveForms(c: FormsClient | null): Promise<string[]> {
  const d = await rpc(c, "cockpit_form_client_live_list");
  return (Array.isArray(d) ? d : []).filter(
    (k): k is string => typeof k === "string",
  );
}

export async function messageBody(
  c: FormsClient | null,
  messageId: string,
): Promise<string> {
  const d = await rpc(c, "cockpit_client_message_read", { p_id: messageId });
  const m = d?.message ?? d;
  if (typeof m?.body !== "string") throw new FormsError(FORMS_SHAPE);
  return m.body;
}

/**
 * Approve and send a form link's WhatsApp message (4.1.5): the seat op
 * `invite.approve` runs the same checks as a recap, then the service RPC
 * with the verified seat. Its refusal comes back as `{error}`.
 */
export async function approveInvite(
  c: FormsClient | null,
  a: { messageId: string; body: string; acceptWarnings?: boolean },
): Promise<ApproveResult> {
  if (!c) throw new FormsError("Sign in to the cockpit, then try again.");
  const { data, error } = await c.functions.invoke("cockpit-forms-api", {
    body: {
      op: "invite.approve",
      messageId: a.messageId,
      body: a.body,
      ...(a.acceptWarnings ? { acceptWarnings: true } : {}),
    },
  });
  let answer: Any = data;
  let status: number | null = null;
  if (error && "context" in error && error.context instanceof Response) {
    status = error.context.status;
    answer = await error.context
      .clone()
      .json()
      .catch(() => null);
  }
  if (answer && typeof answer.error === "string")
    throw new FormsError(answer.error);
  if (error) {
    if (status === 404) throw new FormsError(FORMS_NOT_LIVE);
    throw new FormsError(
      /fetch|network/i.test(String(error.message))
        ? "Not approved. Check your connection and press Approve and send again."
        : String(error.message || FORMS_SHAPE),
    );
  }
  const warnings = Array.isArray(answer?.warnings)
    ? answer.warnings.filter((w: unknown) => typeof w === "string")
    : [];
  if (answer?.needsConfirm === true) return { needsConfirm: true, warnings };
  if (!answer?.message) throw new FormsError(FORMS_SHAPE);
  return {
    needsConfirm: false,
    warnings,
    state:
      typeof answer.message.state === "string" ? answer.message.state : null,
  };
}

/** The live IO for the page's own client. */
export function formsIO(c: FormsClient | null): FormsIO {
  return {
    view: taskId => inviteViewRead(c, taskId),
    issue: a => issueInvite(c, a),
    withdraw: (t, i, r) => withdrawInvite(c, t, i, r),
    link: (t, i) => inviteLink(c, t, i),
    today: () => invitesToday(c),
    answer: id => answerReadOf(c, id),
    live: () => liveForms(c),
    messageBody: id => messageBody(c, id),
    approve: a => approveInvite(c, a),
  };
}

// --- The doors -----------------------------------------------------------------------

/** Waves 3-4's four doors (3.3): each true only once its migration and marker are live. */
export type MoreDoors = {
  invites: boolean;
  lifecycle: boolean;
  voice: boolean;
  editor: boolean;
};
export const NO_MORE_DOORS: MoreDoors = {
  invites: false,
  lifecycle: false,
  voice: false,
  editor: false,
};

/**
 * cockpit_form_doors read once: W12's seven flags and waves 3-4's four.
 * Any error reads as every door closed, and nothing is called behind one.
 */
export async function readAllDoors(
  c: Pick<SupabaseClient, "rpc"> | null,
): Promise<{ doors: Doors; more: MoreDoors }> {
  const closed = { doors: { ...NO_DOORS }, more: { ...NO_MORE_DOORS } };
  if (!c) return closed;
  try {
    const { data, error } = await Promise.resolve().then(() =>
      c.rpc("cockpit_form_doors"),
    );
    if (error || !data || typeof data !== "object") return closed;
    const d = data as Record<string, unknown>;
    const doors = { ...NO_DOORS };
    for (const k of Object.keys(doors) as (keyof Doors)[])
      doors[k] = d[k] === true;
    const more = { ...NO_MORE_DOORS };
    for (const k of Object.keys(more) as (keyof MoreDoors)[])
      more[k] = d[k] === true;
    return { doors, more };
  } catch {
    return closed;
  }
}

/** Every RPC this file can call, for the deploy's to_regprocedure check. */
export const RPC_NAMES = [
  "cockpit_form_invite_view",
  "cockpit_form_invite_issue",
  "cockpit_form_invite_withdraw",
  "cockpit_form_invite_link",
  "cockpit_form_invites_today",
  "cockpit_form_answer_read",
  "cockpit_form_client_live_list",
  "cockpit_client_message_read",
  "cockpit_form_doors",
] as const;
