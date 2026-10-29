/**
 * One claimed notice, from its facts to Slack and back (contract 4.3 step 6).
 *
 * The order is fixed: the kickoff's Kickoff Handoff comment check (ClickUp,
 * through cockpit-csm-api/tools.ts), the variant, the tags, the text, one
 * chat.postMessage, then one result RPC. A post counts only on Slack's
 * receipt and the channel rule (_shared/slackReceipt.ts). Once the request
 * has left, any break is `unknown` and is never sent again: the reconcile
 * looks for the Ref instead. Waiting (Make has not written the comment yet)
 * is `requeue`, never an attempt; a rate limit, or a break before the request
 * left, is a counted `retry`.
 *
 * Every Slack and ClickUp call is receipted in cockpit_csm_provider_health
 * with run_key = the notice id (or run, doctor, dry-run). A receipt that
 * cannot be saved throws, so no call is made without one.
 *
 * The 1-1 notes notices (docs/forms/STAGE2B-CONTRACT.md 4.2): the call grade
 * reads its words from the claim's live read of the stored grade and tags
 * nobody, a test of it included; the recap reminder is a plain post.
 */
import { providerTools, slackTools, type SlackHealthRow, type SlackTools } from "../cockpit-csm-api/tools.ts";
import type { Rpc } from "../cockpit-hours-sync/db.ts";
import { slackReceiptConfirmed } from "../_shared/slackReceipt.ts";
import { cachedLookup, type ClaimMentions, type Mention, mentionsFor, type PersonLooked, personNote, plainLabels, readMention, resolveMentions } from "./mentions.ts";
import { isNoticeKind, isVariantOf, type NoticeFacts, type NoticeKind, noticeText, sampleFacts, type SlackBlock, type TextMention, type Variant } from "./text.ts";

// ------------------------------------------------------------------ deps and the ledger

export type LedgerRow = {
  provider: string;
  method: string;
  resource: string;
  phase: string;
  http_status: number | null;
  object_id: string | null;
  action_id: null;
  run_key: string;
};
export type InsertHealth = (row: LedgerRow) => Promise<void>;

export type NoticeDeps = {
  rpc: Rpc;
  insertHealth: InsertHealth;
  fetch: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  slackToken: () => string;
  clickupToken: () => string;
  /** NOTICES_BOT_USER: the only Slack user the sender posts as (mahara-club-bot, U0C0MJZNS2Y). */
  botUser: () => string;
  /** ALERT_SLACK_TO: where a rehearsal from the door goes when no `to` is given. */
  alertTo: () => string;
  secrets: () => { SLACK_BOT_TOKEN: boolean; CLICKUP_API_TOKEN: boolean; NOTICES_CRON_SECRET: boolean };
};

/** Receipts into cockpit_csm_provider_health through PostgREST with the service key. */
export function restHealth(url: string, serviceKey: string, request: typeof fetch = fetch): InsertHealth {
  return async row => {
    const res = await request(`${url}/rest/v1/cockpit_csm_provider_health`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error("The notices provider receipt could not be saved; no call was made without one.");
  };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const txt = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** A ledger row with only the ledger's columns; never a channel, a person or text. */
export function ledgerRow(row: Record<string, unknown>, runKey: string, provider: string): LedgerRow {
  return {
    provider: txt(row.provider) ?? provider,
    method: txt(row.method) ?? "GET",
    resource: (txt(row.resource) ?? "unknown").slice(0, 200),
    phase: txt(row.phase) ?? "unknown",
    http_status: num(row.http_status),
    object_id: txt(row.object_id),
    action_id: null,
    run_key: runKey,
  };
}

export const slackHealth = (deps: NoticeDeps, runKey: string) => (row: SlackHealthRow) => deps.insertHealth(ledgerRow(row, runKey, "slack"));
export const clickupHealth = (deps: NoticeDeps, runKey: string) => (row: Record<string, unknown>) => deps.insertHealth(ledgerRow(row, runKey, "clickup"));
export const slackFor = (deps: NoticeDeps, token: string, runKey: string): SlackTools => slackTools(token, slackHealth(deps, runKey), deps.fetch);

/** The tag warning the native monitor shows (http_status null) until a later notice resolves every tag (200). */
export const mentionsRow = (runKey: string, ok: boolean): LedgerRow => ({
  provider: "slack", method: "GET", resource: "notices/mentions", phase: "response", http_status: ok ? 200 : null, object_id: null, action_id: null, run_key: runKey,
});

// ------------------------------------------------------------------ the claimed row

export type ClaimedRow = {
  id: string;
  ref: string;
  kind: NoticeKind | "rehearsal";
  taskId: string | null;
  clientName: string | null;
  attempts: number;
  createdAt: string | null;
  facts: Record<string, unknown>;
  live: Record<string, unknown>;
  target: string | null;
  threadTs: string | null;
  parentId: string | null;
  mentions: ClaimMentions;
  rehearsal: { of: string | null; lookupEmail: string | null } | null;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One ClaimedRow from the claim RPC, kept to its known keys; null when it has no id. */
export function readClaimed(v: unknown): ClaimedRow | null {
  if (!isObj(v) || typeof v.id !== "string" || !UUID.test(v.id)) return null;
  const m = isObj(v.mentions) ? v.mentions : {};
  const r = isObj(v.rehearsal) ? v.rehearsal : null;
  const kind = v.kind === "rehearsal" || isNoticeKind(v.kind) ? v.kind : null;
  if (!kind) return null;
  return {
    id: v.id,
    ref: txt(v.ref) ?? `CN-${v.id.slice(0, 8)}`,
    kind,
    taskId: txt(v.taskId),
    clientName: txt(v.clientName),
    attempts: num(v.attempts) ?? 0,
    createdAt: txt(v.createdAt),
    facts: isObj(v.facts) ? v.facts : {},
    live: isObj(v.live) ? v.live : {},
    target: txt(v.target),
    threadTs: txt(v.threadTs),
    parentId: txt(v.parentId),
    mentions: {
      main: Array.isArray(m.main) ? m.main.map(readMention).filter((x): x is Mention => !!x) : [],
      late: Array.isArray(m.late) ? m.late.map(readMention).filter((x): x is Mention => !!x) : [],
      second: Array.isArray(m.second) ? m.second.map(readMention).filter((x): x is Mention => !!x) : [],
    },
    rehearsal: r ? { of: txt(r.of), lookupEmail: txt(r.lookupEmail) } : null,
  };
}

// ------------------------------------------------------------------ the kickoff comment check

export type CommentCheck = { state: "found"; at: string } | { state: "missing" } | { state: "unread" };

/**
 * The card's Kickoff Handoff comment, written at or after the kickoff (one
 * second of clock slack). A second kickoff, or a card already at Brand
 * Blueprint Booked, only counts when Make wrote a new comment.
 */
export async function kickoffComment(deps: NoticeDeps, taskId: string | null, submittedAt: string, runKey: string): Promise<CommentCheck> {
  if (!taskId || !/^[A-Za-z0-9_-]{1,40}$/.test(taskId)) return { state: "unread" };
  const since = Date.parse(submittedAt);
  try {
    const clickup = providerTools(deps.clickupToken(), clickupHealth(deps, runKey), deps.fetch);
    const data = await clickup.call("GET", `task/${taskId}/comment`);
    const comments: unknown[] = Array.isArray(data?.comments) ? data.comments : [];
    let best: number | null = null;
    for (const c of comments) {
      if (!isObj(c)) continue;
      const text = typeof c.comment_text === "string" ? c.comment_text : "";
      const at = Number(c.date);
      if (!/kickoff handoff/i.test(text) || !Number.isFinite(at) || !Number.isFinite(since) || at < since - 1000) continue;
      if (best === null || at < best) best = at;
    }
    return best === null ? { state: "missing" } : { state: "found", at: new Date(best).toISOString() };
  } catch {
    return { state: "unread" };
  }
}

// ------------------------------------------------------------------ variants and sentences

const ACTIVE = /^\s*active\s*$/i;

/** The variant for a non-kickoff notice, from its facts, what the claim read now, and whether it has a thread. */
export function pickVariant(kind: NoticeKind, facts: Record<string, unknown>, live: Record<string, unknown>, threadTs: string | null): Variant {
  if (kind === "checkin.grade") return "grade";
  if (kind === "checkin.recap_late") return "late";
  if (kind === "blueprint.close") return facts.source === "typeform" ? "typeform" : facts.settled === "reconcile" ? "reconcile" : "done";
  if (kind === "blueprint.media") {
    const phase = Number(facts.mapPhase);
    return (Number.isFinite(phase) && phase >= 5) || ACTIVE.test(String(live.clientStatus ?? facts.clientStatus ?? "")) ? "live" : "new";
  }
  if (kind === "kickoff") return "complete";
  return threadTs ? "thread" : "top";
}

/**
 * Who a notice tags, chosen in one place for the post and its dry run (a
 * preview is the post): nobody for the call grade, which is about a person's
 * call; the settings row's main list for the recap reminder, whose "late" is
 * its own wording, not the late kickoff's list; else the variant's list.
 */
export function wantedMentions(kind: NoticeKind, variant: Variant, mentions: ClaimMentions | Mention[] | null | undefined, second: boolean): Mention[] {
  if (kind === "checkin.grade") return [];
  return mentionsFor(kind === "checkin.recap_late" ? null : variant, mentions, second);
}

/** A test's variant: its facts' variant when it is one the kind has, else the plain one. */
export function rehearsalVariant(kind: NoticeKind, facts: Record<string, unknown>): Variant {
  if (isVariantOf(kind, facts.variant)) return facts.variant;
  if (kind === "checkin.grade") return "grade";
  if (kind === "checkin.recap_late") return "late";
  return kind === "kickoff" ? "complete" : kind === "blueprint.close" ? "done" : kind === "blueprint.media" ? "new" : "top";
}

export const WAITING = "Waiting for Make's Kickoff Handoff comment.";
export const WAITING_CARD = "Waiting for the card to show Brand Blueprint Booked.";
/** A late kickoff's reply waits for the comment the late notice said was missing. */
export const WAITING_REPLY = "Waiting for the card's Kickoff Handoff comment before saying the card is updated.";
/** How often a waiting reply checks the card's comments again. */
export const REPLY_RECHECK_SEC = 600;
export const UNKNOWN = "Slack did not confirm the post; it is not sent again in case it arrived.";
export const NO_SLACK_ID = "No Slack account was found for you. Ask the tech lead to add your address to the team list.";
// The reasons below reach the CSM's and the creative director's screens word
// for word, so they name what people recognise; the secret's name and the
// function's are the doctor's and the RUNBOOK's (doctor.ts).
export const WRONG_BOT = "The cockpit is connected to Slack as the wrong bot, so nothing was posted. Tell the tech lead.";
export const BAD_TOKEN = "Slack refused the cockpit's connection, so nothing was posted. Tell the tech lead.";
export const NO_TOKEN = "The cockpit's Slack connection is not set up, so nothing was posted. Tell the tech lead.";
/** The claim fails a grade with no stored grade first; the sender checks again before it builds a word. */
export const NO_GRADE = "The call's grade is not in the cockpit, so nothing was posted. Tell the tech lead.";
const TOKEN_CODES = new Set(["invalid_auth", "not_authed", "token_revoked", "account_inactive", "token_expired"]);
export const isTokenCode = (code: string) => TOKEN_CODES.has(code);

/** "#csm-general" for a channel, "the direct message" for a person. */
export function placeLabel(target: string, names: Map<string, string>): string {
  if (/^[UWD]/.test(target)) return "the direct message";
  return `#${names.get(target) ?? target}`;
}

/** Slack's refusal code as a plain sentence (contract 4.3). */
// Each sentence stands alone after a stop's own label ("Not posted in #csm-general."), so none
// starts with a label of its own.
export function refusalSentence(code: string, place: string): string {
  // The stop's lead already names the channel ("Not posted in #csm-general.").
  if (code === "not_in_channel" || code === "channel_not_found") return "Slack says mahara-club-bot is not in that channel. Ask the tech lead to add it there and send the notice again.";
  if (code === "is_archived") return `${place} is archived. Choose another channel in Settings, Notices and routing.`;
  if (code === "missing_scope") return "The bot lacks a Slack permission. The tech lead adds it to the Slack app.";
  if (isTokenCode(code)) return BAD_TOKEN;
  if (code === "invalid_blocks" || code === "msg_too_long") return "Slack refused the message's layout. The tech lead checks the notice text.";
  return `Slack refused it (${code.replace(/[^a-z0-9_]/g, "").slice(0, 60) || "no code"}).`;
}

const sentence = (e: unknown, fallback: string): string => {
  const m = e instanceof Error && e.message ? e.message : fallback;
  const s = m.trim().slice(0, 230);
  return /[.!?]$/.test(s) ? s : `${s}.`;
};

// ------------------------------------------------------------------ the bot check

export type Gate = { ok: true } | { ok: false; outcome: "failed" | "requeue"; error: string; retryAfterSec: number; userId: string | null };

/** auth.test once: the token must be mahara-club-bot's. Anything else posts nothing. */
export async function botGate(deps: NoticeDeps, token: string, runKey: string): Promise<Gate> {
  if (!token) return { ok: false, outcome: "failed", error: NO_TOKEN, retryAfterSec: 0, userId: null };
  let auth: Awaited<ReturnType<SlackTools["authTest"]>>;
  try {
    auth = await slackFor(deps, token, runKey).authTest();
  } catch (e) {
    return { ok: false, outcome: "requeue", error: sentence(e, "The token check could not be made"), retryAfterSec: 60, userId: null };
  }
  if (auth.ok && auth.userId && auth.userId === deps.botUser().trim()) return { ok: true };
  if (auth.ok) return { ok: false, outcome: "requeue", error: WRONG_BOT, retryAfterSec: 300, userId: auth.userId };
  if (isTokenCode(auth.code)) return { ok: false, outcome: "requeue", error: BAD_TOKEN, retryAfterSec: 300, userId: null };
  return { ok: false, outcome: "requeue", error: "Slack did not answer the token check, so nothing was posted. It tries again in a minute.", retryAfterSec: 60, userId: null };
}

// ------------------------------------------------------------------ recording

export type Outcome = "posted" | "failed" | "unknown" | "requeue" | "retry";
export type SendResult = {
  id: string;
  outcome: Outcome;
  variant: Variant | null;
  channel: string | null;
  ts: string | null;
  error: string | null;
  /** The NoticeView the result RPC returned, or null when it could not be recorded. */
  view: Record<string, unknown> | null;
  recordError?: string;
};

type Detail = { variant?: Variant; text?: string; blocks?: SlackBlock[]; permalink?: string | null; target?: string; facts?: Record<string, unknown>; retryAfterSec?: number };

async function record(deps: NoticeDeps, id: string, outcome: Outcome, p: { ts?: string | null; channel?: string | null; error?: string | null; detail?: Detail }): Promise<SendResult> {
  const detail: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p.detail ?? {})) if (v !== undefined && v !== null) detail[k] = v;
  const base: SendResult = { id, outcome, variant: p.detail?.variant ?? null, channel: p.channel ?? null, ts: p.ts ?? null, error: p.error ?? null, view: null };
  try {
    const view = await deps.rpc("cockpit_slack_notice_result", {
      p_id: id, p_outcome: outcome, p_ts: p.ts ?? null, p_channel: p.channel ?? null, p_error: p.error ? p.error.slice(0, 240) : null, p_detail: detail,
    });
    return { ...base, view: isObj(view) ? view : null };
  } catch (e) {
    const why = sentence(e, "The result could not be recorded");
    if (outcome !== "posted") return { ...base, recordError: why };
    // It posted, but the database refused the receipt: keep it from ever being sent again.
    const error = `The post's receipt could not be recorded (${why.replace(/\.$/, "")}). Look in Slack for this notice's Ref before anything else.`.slice(0, 240);
    try {
      const view = await deps.rpc("cockpit_slack_notice_result", { p_id: id, p_outcome: "unknown", p_ts: null, p_channel: null, p_error: error, p_detail: detail });
      return { ...base, outcome: "unknown", error, view: isObj(view) ? view : null, recordError: why };
    } catch {
      return { ...base, outcome: "unknown", error, recordError: why };
    }
  }
}

// ------------------------------------------------------------------ one send

export type SendContext = {
  deps: NoticeDeps;
  token: string;
  /** Channel id to name, read once per run (cockpit_slack_notice_doctor_inputs). */
  names: () => Promise<Map<string, string>>;
  /** A test's "would tag" list, from the settings row of the kind it rehearses. */
  rehearsalTags: (kind: NoticeKind, variant: Variant) => Promise<Mention[]>;
};

/** A context for one run: the lookups and the settings read are shared by every row. */
export function sendContext(deps: NoticeDeps, token: string): SendContext {
  let inputs: Promise<Record<string, unknown>> | null = null;
  const read = () => {
    if (!inputs) inputs = deps.rpc("cockpit_slack_notice_doctor_inputs", {}).then(v => (isObj(v) ? v : {})).catch(() => ({}));
    return inputs;
  };
  return {
    deps,
    token,
    names: async () => {
      const v = await read();
      const map = new Map<string, string>();
      for (const c of Array.isArray(v.channels) ? v.channels : []) if (isObj(c) && typeof c.id === "string" && typeof c.name === "string") map.set(c.id, c.name);
      return map;
    },
    rehearsalTags: async (kind, variant) => {
      const v = await read();
      const want = kind === "kickoff" && variant === "late" ? "kickoff.late" : kind;
      const row = (Array.isArray(v.settings) ? v.settings : []).find(s => isObj(s) && s.kind === want);
      return isObj(row) && Array.isArray(row.mentions) ? row.mentions.map(readMention).filter((x): x is Mention => !!x) : [];
    },
  };
}

const SUBMIT_WAIT_MS = 20 * 60_000;

/**
 * Slack's answer for each person looked up by address, kept in
 * cockpit_slack_people, so the Settings card says what a notice really does
 * with them (contract X4). Best effort: a record that fails never holds a post.
 */
export async function rememberPeople(deps: NoticeDeps, looked: PersonLooked[]): Promise<number> {
  let n = 0;
  for (const p of looked) {
    try {
      await deps.rpc("cockpit_slack_person_checked", { p_person: p.personId, p_state: p.state, p_slack: p.slackId, p_note: personNote(p) });
      n += 1;
    } catch {
      // Checked again by the next notice, or by an editor's next change.
    }
  }
  return n;
}

/** Post one claimed row and record what happened. Never throws for a Slack or ClickUp problem. */
export async function sendClaimed(ctx: SendContext, row: ClaimedRow): Promise<SendResult> {
  const { deps } = ctx;
  const rehearsal = row.kind === "rehearsal";
  const of = rehearsal ? (row.rehearsal?.of ?? row.facts.of) : row.kind;
  if (!isNoticeKind(of)) return record(deps, row.id, "failed", { error: "This notice has no wording to send. The tech lead checks its kind." });
  const kind: NoticeKind = of;
  const now = deps.now();
  const slack = slackFor(deps, ctx.token, row.id);
  const lookup = cachedLookup(email => slack.lookupByEmail(email));

  // The target. A test goes only to a person's direct messages.
  let target = row.target ?? "";
  const detailTarget: { target?: string } = {};
  if (rehearsal) {
    if (!target && row.rehearsal?.lookupEmail) {
      const found = await lookup(row.rehearsal.lookupEmail);
      if (found.state === "ok") {
        target = found.id;
        detailTarget.target = found.id;
      } else if (found.state !== "not_found") {
        return record(deps, row.id, "retry", { error: "Slack did not answer the lookup for your address. The test is tried again shortly.", detail: { retryAfterSec: 60 } });
      }
    }
    if (!target) return record(deps, row.id, "failed", { error: NO_SLACK_ID });
    if (!/^[UW][A-Z0-9]{8,12}$/.test(target)) return record(deps, row.id, "failed", { error: "A test only goes to a person's direct messages." });
  } else if (!/^[CG][A-Z0-9]{8,12}$/.test(target)) {
    return record(deps, row.id, "failed", { error: `The channel for this notice is not ready (${target || "none"}). Choose one in Settings, Notices and routing.` });
  }

  // The variant (the kickoff's comes from the card's comments).
  let variant: Variant;
  let sendFacts: Record<string, unknown> = {};
  if (rehearsal) {
    variant = rehearsalVariant(kind, row.facts);
  } else if (kind === "kickoff") {
    // Complete needs both halves of Make's run: the Kickoff Handoff comment
    // (module 11, written first) and the card at Brand Blueprint Booked
    // (module 21, written later). A run that broke between them is late.
    const submittedAt = String(row.facts.submittedAt ?? "");
    const check = await kickoffComment(deps, row.taskId, submittedAt, row.id);
    const looksDone = row.live.looksDone === true;
    const due = Date.parse(submittedAt) + SUBMIT_WAIT_MS;
    if ((check.state !== "found" || !looksDone) && Number.isFinite(due) && now.getTime() < due) {
      return record(deps, row.id, "requeue", { error: check.state !== "found" ? WAITING : WAITING_CARD, detail: { retryAfterSec: 60 } });
    }
    variant = check.state === "found" && looksDone ? "complete" : "late";
    // What this notice saw, kept on the row: the sweep decides a late
    // notice's reply from it (X19), never from the post time.
    sendFacts = { commentCheck: check.state, handoffAt: check.state === "found" ? check.at : null, filledByRole: txt(row.live.filledByRole), looksDone, cardUpdatedAt: txt(row.live.cardUpdatedAt) };
  } else if (kind === "kickoff.updated") {
    // The reply says the card caught up, so the comment the late notice
    // missed must be there now; the claim lets it go 48 hours after the
    // kickoff if it never comes.
    const check = await kickoffComment(deps, row.taskId, String(row.facts.submittedAt ?? ""), row.id);
    if (check.state !== "found") return record(deps, row.id, "requeue", { error: WAITING_REPLY, detail: { retryAfterSec: REPLY_RECHECK_SEC } });
    variant = pickVariant(kind, row.facts, row.live, row.threadTs);
    sendFacts = { commentCheck: check.state, handoffAt: check.at };
  } else {
    variant = pickVariant(kind, row.facts, row.live, row.threadTs);
  }

  // The tags. A test names who it would tag and tags nobody. The call grade
  // tags nobody at all: it is about a person's call.
  let tags: TextMention[];
  if (rehearsal) {
    tags = kind === "checkin.grade" ? [] : plainLabels(await ctx.rehearsalTags(kind, variant));
  } else {
    const wanted = wantedMentions(kind, variant, row.mentions, row.facts.second === true);
    const resolved = await resolveMentions(wanted, lookup);
    tags = resolved.tags;
    await rememberPeople(deps, resolved.looked);
    try {
      if (resolved.unresolved > 0) await deps.insertHealth(mentionsRow(row.id, false));
      else if (wanted.length) await deps.insertHealth(mentionsRow(row.id, true));
    } catch (e) {
      // Nothing has left yet: a counted retry, never a silent post without its warning.
      return record(deps, row.id, "retry", { error: sentence(e, "The tag check could not be recorded"), detail: { retryAfterSec: 60 } });
    }
  }

  if (!rehearsal && kind === "checkin.grade" && !isObj(row.live.grade)) return record(deps, row.id, "failed", { error: NO_GRADE });

  // The text.
  const facts: NoticeFacts = rehearsal
    ? { ...sampleFacts(kind, now), ref: row.ref, mentions: tags, rehearsal: true }
    : {
      ...row.facts,
      ...row.live,
      ...sendFacts,
      ref: row.ref,
      taskId: row.taskId ?? String(row.facts.taskId ?? ""),
      client: String(row.facts.client ?? row.clientName ?? ""),
      mentions: tags,
    };
  let built: { text: string; blocks: SlackBlock[] };
  try {
    built = noticeText(kind, variant, facts);
  } catch (e) {
    return record(deps, row.id, "failed", { error: sentence(e, "The notice text could not be built") });
  }
  // The grade's words stay in its draft: the outbox keeps the grade's one-line text (client, score,
  // colour, Ref) for the reconcile, never its blocks (Z7: no AI text in an outbox row).
  const detail: Detail = {
    variant,
    text: built.text,
    blocks: kind === "checkin.grade" ? undefined : built.blocks,
    facts: rehearsal ? undefined : sendFacts,
    ...detailTarget,
  };
  const threadTs = !rehearsal && row.threadTs && /^\d+\.\d+$/.test(row.threadTs) ? row.threadTs : undefined;

  // The post.
  let sent = false;
  let post: Awaited<ReturnType<SlackTools["postMessage"]>>;
  try {
    post = await slack.postMessage({ channel: target, text: built.text, blocks: built.blocks, thread_ts: threadTs }, () => {
      sent = true;
    });
  } catch (e) {
    if (sent) return record(deps, row.id, "unknown", { error: UNKNOWN, detail });
    return record(deps, row.id, "retry", { error: sentence(e, "The post could not be sent"), detail: { ...detail, retryAfterSec: 60 } });
  }
  if (post.state === "ratelimited") {
    return record(deps, row.id, "retry", { error: `Slack asked the cockpit to slow down (try ${Math.min(row.attempts + 1, 3)} of 3).`, detail: { ...detail, retryAfterSec: post.retryAfter } });
  }
  if (post.state === "failed") return record(deps, row.id, "failed", { error: refusalSentence(post.code, placeLabel(target, await ctx.names())), detail });
  if (post.state === "unknown") return record(deps, row.id, "unknown", { error: post.error, detail });

  const check = slackReceiptConfirmed(target, { ok: true, ts: post.ts, channel: post.channel });
  if (!check.ok) {
    const error = post.channel
      ? `Slack answered for another channel (${post.channel.replace(/[^A-Z0-9]/g, "").slice(0, 14)}). Look there first; it is not sent again.`
      : "Slack answered without saying which channel. Look in Slack for this notice's Ref first; it is not sent again.";
    return record(deps, row.id, "unknown", { error, detail });
  }
  const permalink = await slack.permalink(check.channel, check.ts);
  return record(deps, row.id, "posted", { ts: check.ts, channel: check.channel, detail: { ...detail, permalink } });
}

/** Settle every claimed row the same way when nothing may be posted (no token, or the wrong bot). */
export async function settleAll(deps: NoticeDeps, rows: ClaimedRow[], gate: Exclude<Gate, { ok: true }>): Promise<SendResult[]> {
  const out: SendResult[] = [];
  for (const row of rows) {
    out.push(await record(deps, row.id, gate.outcome, { error: gate.error, detail: gate.outcome === "requeue" ? { retryAfterSec: gate.retryAfterSec } : {} }));
  }
  return out;
}
