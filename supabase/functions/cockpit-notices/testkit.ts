/**
 * Fakes for the cockpit-notices tests: a Slack that stores posts the way the
 * real one does (text rewritten, a person's post landing in a D channel), a
 * ClickUp with card comments, an RPC that answers the contract's service
 * functions from made-up rows, and a receipts recorder. Nothing here touches a
 * network or a database. Test-only: index.ts never imports it. Every client,
 * card and person is invented.
 */
import { RpcError } from "../cockpit-hours-sync/db.ts";
import type { ClaimedRow, LedgerRow, NoticeDeps } from "./send.ts";

export const BOT_USER = "U0C0MJZNS2Y";
export const BOT_ID = "B0FAKEBOT01";
export const CSM_GENERAL = "C09RZ0GS0V9";
export const MEDIA_GENERAL = "C0AE8G5MT7Y";
export const SCOPES = "chat:write,groups:history,groups:read,users:read,users:read.email,im:history";
export const NOW = new Date("2026-10-25T11:30:00Z"); // 14:30 in Kuwait, a Sunday
export const minutesAgo = (n: number, from = NOW) => new Date(from.getTime() - n * 60_000).toISOString();

export type Call = { url: URL; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };

const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "x-oauth-scopes": SCOPES, ...headers } });

type PostMode =
  | "ok"
  | "ratelimited"
  | "5xx"
  | "unreadable"
  | "throw"
  | "no-ts"
  | { refuse: string }
  | { channel: string };

/** Slack's stored text: & < > as entities, a bare URL in angle brackets, an email as a mailto link. */
export function slackStored(text: string): string {
  return text
    .replace(/&(?!amp;|lt;|gt;)/g, "&amp;")
    .replace(/\b(https?:\/\/[^\s<>|]+)(?![^<]*>)/g, "<$1>")
    .replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b(?![^<]*>)/g, "<mailto:$1|$1>");
}

export class FakeSlack {
  calls: Call[] = [];
  /** Messages per channel id, newest last. */
  messages = new Map<string, Record<string, unknown>[]>();
  dms = new Map<string, string>([["U09305KE2KS", "D0ALERTDM01"], ["U0TESTER001", "D0TESTDM001"]]);
  users = new Map<string, string>();
  authUser = BOT_USER;
  authCode: string | null = null;
  scopes = SCOPES;
  post: PostMode = "ok";
  /** Channel info by id; absent is channel_not_found. */
  channels = new Map<string, { name: string; is_private: boolean; is_member: boolean; is_archived?: boolean }>([
    [CSM_GENERAL, { name: "csm-general", is_private: true, is_member: true }],
    [MEDIA_GENERAL, { name: "media-general", is_private: true, is_member: true }],
  ]);
  infoCode: string | null = null;
  historyPages = 1;
  seq = 0;
  /** When set, message timestamps follow this clock (ms) instead of a fixed base. */
  clock: (() => number) | null = null;

  private nextTs(base: number) {
    const n = this.seq++;
    if (this.clock) return `${Math.floor(this.clock() / 1000)}.${String(100000 + n).slice(-6)}`;
    return `1792900${String(base + n).padStart(3, "0")}.000${base === 100 ? 1 : 2}00`;
  }

  posts() {
    return this.calls.filter(c => c.method === "POST" && c.url.pathname === "/api/chat.postMessage");
  }

  /** Put a message in a channel as if an earlier, unconfirmed post had arrived. */
  seed(channel: string, text: string, opts: { ts?: string; bot?: boolean; thread?: string } = {}) {
    const ts = opts.ts ?? this.nextTs(100);
    const list = this.messages.get(channel) ?? [];
    list.push({ type: "message", ts, text: slackStored(text), ...(opts.bot === false ? { user: "U0SOMEONE1" } : { bot_id: BOT_ID }), ...(opts.thread ? { thread_ts: opts.thread } : {}) });
    this.messages.set(channel, list);
    return ts;
  }

  route = (call: Call): Response | null => {
    if (call.url.host !== "slack.com") return null;
    this.calls.push(call);
    const method = call.url.pathname.replace("/api/", "");
    const q = call.url.searchParams;
    const b = call.body ?? {};
    if (method === "auth.test") {
      if (this.authCode) return ok({ ok: false, error: this.authCode });
      return new Response(JSON.stringify({ ok: true, user_id: this.authUser, user: "mahara-club-bot", url: "https://example-team.slack.com/" }), { status: 200, headers: { "x-oauth-scopes": this.scopes } });
    }
    if (method === "chat.postMessage") {
      const mode = this.post;
      if (mode === "throw") throw new Error("connection reset after the request left");
      if (mode === "ratelimited") return ok({ ok: false, error: "ratelimited" }, 429, { "retry-after": "7" });
      if (mode === "5xx") return ok({ ok: false }, 503);
      if (mode === "unreadable") return new Response("<html>gateway</html>", { status: 200 });
      if (typeof mode === "object" && "refuse" in mode) return ok({ ok: false, error: mode.refuse });
      const to = String(b.channel ?? "");
      const channel = /^[UW]/.test(to) ? (this.dms.get(to) ?? "D0OTHERDM01") : to;
      const ts = this.nextTs(500);
      const list = this.messages.get(channel) ?? [];
      list.push({ type: "message", ts, text: slackStored(String(b.text ?? "")), bot_id: BOT_ID, ...(b.thread_ts ? { thread_ts: b.thread_ts } : {}) });
      this.messages.set(channel, list);
      if (mode === "no-ts") return ok({ ok: true, channel });
      const answered = typeof mode === "object" && "channel" in mode ? mode.channel : channel;
      return ok({ ok: true, ts, channel: answered, message: { bot_id: BOT_ID, text: slackStored(String(b.text ?? "")) } });
    }
    if (method === "chat.getPermalink") {
      return ok({ ok: true, permalink: `https://example-team.slack.com/archives/${q.get("channel")}/p${String(q.get("message_ts")).replace(".", "")}` });
    }
    if (method === "conversations.info") {
      if (this.infoCode) return ok({ ok: false, error: this.infoCode });
      const id = String(q.get("channel"));
      const c = this.channels.get(id);
      return c ? ok({ ok: true, channel: { id, ...c } }) : ok({ ok: false, error: "channel_not_found" });
    }
    if (method === "conversations.history" || method === "conversations.replies") {
      const id = String(q.get("channel"));
      if (!this.messages.has(id) && !this.channels.has(id) && !id.startsWith("D")) return ok({ ok: false, error: "channel_not_found" });
      const oldest = Number(q.get("oldest") ?? 0);
      let list = (this.messages.get(id) ?? []).filter(m => Number(m.ts) >= oldest);
      if (method === "conversations.replies") {
        const parent = String(q.get("ts"));
        list = list.filter(m => m.ts === parent || m.thread_ts === parent);
      } else {
        list = list.filter(m => !m.thread_ts || m.thread_ts === m.ts);
      }
      // Split the answer into historyPages pages to exercise the cursor.
      const cursor = Number(q.get("cursor") ?? 0);
      const size = Math.max(1, Math.ceil(list.length / this.historyPages));
      const page = [...list].reverse().slice(cursor, cursor + size);
      const next = cursor + size < list.length ? String(cursor + size) : "";
      return ok({ ok: true, messages: page, has_more: !!next, response_metadata: { next_cursor: next } });
    }
    if (method === "users.lookupByEmail") {
      const id = this.users.get(String(q.get("email")));
      return id ? ok({ ok: true, user: { id, deleted: false } }) : ok({ ok: false, error: "users_not_found" });
    }
    return ok({ ok: false, error: "unknown_method" });
  };
}

export class FakeClickUp {
  calls: Call[] = [];
  comments = new Map<string, { id: string; comment_text: string; date: string }[]>();
  fail = false;
  route = (call: Call): Response | null => {
    if (call.url.host !== "api.clickup.com") return null;
    this.calls.push(call);
    if (this.fail) return new Response(JSON.stringify({ err: "Internal" }), { status: 500 });
    const m = call.url.pathname.match(/^\/api\/v2\/task\/([^/]+)\/comment$/);
    if (m && call.method === "GET") return new Response(JSON.stringify({ comments: this.comments.get(m[1]) ?? [] }), { status: 200 });
    return new Response(JSON.stringify({ err: "Unexpected" }), { status: 400 });
  };
  handoff(taskId: string, at: string, text = "KICKOFF HANDOFF\nEvery answer is in this comment.") {
    const list = this.comments.get(taskId) ?? [];
    list.push({ id: `c${list.length + 1}`, comment_text: text, date: String(Date.parse(at)) });
    this.comments.set(taskId, list);
  }
}

/** A fetch over the fakes; anything unrouted is a 599 the test will see. */
export function fakeFetch(...routes: ((call: Call) => Response | null)[]) {
  const calls: Call[] = [];
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]));
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = null; }
    }
    const call = { url, method: init?.method ?? "GET", headers, body };
    calls.push(call);
    for (const route of routes) {
      const answer = route(call);
      if (answer) return answer;
    }
    return new Response(JSON.stringify({ error: "unrouted" }), { status: 599 });
  }) as typeof fetch;
  return { calls, request };
}

export type RpcCall = { name: string; args: Record<string, unknown> };
type Handler = (args: Record<string, unknown>) => unknown;

/** The contract's service RPCs, answered from fixtures. `result` echoes a NoticeView. */
export function fakeRpc(handlers: Record<string, Handler> = {}) {
  const calls: RpcCall[] = [];
  const base: Record<string, Handler> = {
    cockpit_slack_notice_sweep: () => ({ unknown: 0, kickoffs: 0, closes: 0, media: 0, offers: 0, followups: 0 }),
    cockpit_slack_channel_pending: () => [],
    cockpit_slack_notice_unknowns: () => [],
    cockpit_slack_notice_claim: () => ({ busy: false, rows: [] }),
    cockpit_slack_notice_result: a => {
      const o = String(a.p_outcome);
      const state = o === "requeue" || o === "retry" ? "queued" : o;
      return { id: a.p_id, kind: "kickoff", state, variant: (a.p_detail as Record<string, unknown>)?.variant ?? null, channel: a.p_channel ? { id: a.p_channel, name: null } : null, reason: a.p_error ?? null };
    },
    cockpit_slack_channel_checked: a => ({ id: a.p_id, state: a.p_ok ? "ok" : "refused", note: a.p_note }),
    cockpit_slack_notice_doctor_inputs: () => ({
      channels: [{ id: CSM_GENERAL, name: "csm-general", private: true, state: "ok" }, { id: MEDIA_GENERAL, name: "media-general", private: true, state: "ok" }],
      settings: [],
    }),
  };
  const all = { ...base, ...handlers };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const h = all[name];
    if (!h) throw new RpcError(`No fake for ${name}`, null);
    return h(args);
  };
  return {
    calls,
    rpc,
    results: () => calls.filter(c => c.name === "cockpit_slack_notice_result").map(c => c.args),
  };
}

export function receiptsRecorder() {
  const rows: LedgerRow[] = [];
  let failAt: ((row: LedgerRow) => boolean) | null = null;
  return {
    rows,
    failWhen(test: (row: LedgerRow) => boolean) {
      failAt = test;
    },
    insert: async (row: LedgerRow) => {
      if (failAt?.(row)) throw new Error("The notices provider receipt could not be saved; no call was made without one.");
      rows.push(row);
    },
  };
}

export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ref = (id: string) => `CN-${id.slice(0, 8)}`;

/** A Mention as the database resolves it. */
export const mention = (rule: string, label: string, slackId: string | null, extra: Record<string, unknown> = {}) => ({ rule, personId: 1, label, slackId, email: null, missing: false, ...extra });

export const CREATIVE = mention("seat:creative", "the creative director", "U0B2SHGS1JA", { personId: 11 });
export const CSM = mention("seat:csm", "the CSM", "U0C5JHUCTPG", { personId: 12 });
export const SYSTEMS = mention("seat:systems_manager", "the systems manager", "U0AS90SHMH8", { personId: 13 });

/** A ClaimedRow like the claim RPC hands out (an object, as the RPC returns it). */
export function claimed(over: Partial<ClaimedRow> & { id?: string } = {}): Record<string, unknown> {
  const id = over.id ?? ID(1);
  return {
    id,
    ref: ref(id),
    kind: "kickoff",
    taskId: "task0001",
    clientName: "Acme & Sons <Interiors>",
    attempts: 0,
    createdAt: minutesAgo(25),
    facts: { taskId: "task0001", client: "Acme & Sons <Interiors>", responseId: "resp00000001", formId: "tG7dnxBn", submittedAt: minutesAgo(25), second: false, previousResponseId: null },
    live: { clientStatus: "Brand Blueprint Booked♠️", cardUpdatedAt: minutesAgo(23), blueprintLink: true, looksDone: true, filledByRole: "the CSM", dueBy: minutesAgo(5) },
    target: CSM_GENERAL,
    threadTs: null,
    parentId: null,
    mentions: { main: [CREATIVE], late: [CSM, SYSTEMS], second: [CSM] },
    ...over,
  };
}

/** Deps over the fakes. */
export function deps(opts: { slack?: FakeSlack; clickup?: FakeClickUp; rpc?: ReturnType<typeof fakeRpc>; receipts?: ReturnType<typeof receiptsRecorder>; now?: Date; token?: string; clickupToken?: string } = {}) {
  const slack = opts.slack ?? new FakeSlack();
  const clickup = opts.clickup ?? new FakeClickUp();
  const rpc = opts.rpc ?? fakeRpc();
  const receipts = opts.receipts ?? receiptsRecorder();
  const net = fakeFetch(slack.route, clickup.route);
  const d: NoticeDeps = {
    rpc: rpc.rpc,
    insertHealth: receipts.insert,
    fetch: net.request,
    now: () => opts.now ?? NOW,
    sleep: async () => {},
    slackToken: () => opts.token ?? "xoxb-test-token",
    clickupToken: () => opts.clickupToken ?? "pk_test_token",
    botUser: () => BOT_USER,
    alertTo: () => "U09305KE2KS",
    secrets: () => ({ SLACK_BOT_TOKEN: (opts.token ?? "x") !== "", CLICKUP_API_TOKEN: true, NOTICES_CRON_SECRET: true }),
  };
  return { deps: d, slack, clickup, rpc, receipts, net };
}
