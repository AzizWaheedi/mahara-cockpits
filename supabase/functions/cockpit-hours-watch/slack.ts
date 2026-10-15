/**
 * Hubstaff watch on Slack (SPEC.md "Slack"): one plain message per incident
 * in #team-management, one reply in its thread when it clears. A post is
 * claimed before it is sent (cockpit_hours_watch_slack_claim moves pending
 * to sending, so two runs never send the same post) and its outcome is
 * recorded after (cockpit_hours_watch_slack_result). An answer that never
 * came, or a server error, is "unknown": it may have arrived, so it is never
 * sent again. With alerts switched off the claim mutes the post in the
 * database and returns nothing, so nothing is sent; the incident is still
 * recorded. Once claimed, a post always ends recorded: anything that breaks
 * before the request leaves is "failed", anything after it is "unknown". If
 * even the record fails, the apply's sweep moves a "sending" left for 10
 * minutes to "unknown". Each opening post (never a thread reply) starts with
 * a mention of settings.mentionUser while settings.mention is on, so the CEO's
 * phone gets a push; the stored sentence stays without it. Screenshots never
 * go to Slack.
 *
 * Every call is receipted in cockpit_hours_provider_health (provider slack).
 * The token is the function secret SLACK_BOT_TOKEN, read by name, never
 * written anywhere.
 */
import type { Rpc } from "../cockpit-hours-sync/db.ts";
import { field, isObj, SLACK_USER_RE } from "./inputs.ts";
import type { WatchHealth } from "./ledger.ts";

export type SlackDeps = { rpc: Rpc; health: WatchHealth; fetch: typeof fetch; token: () => string };
export type SlackAnswer = { kind: "ok"; body: Record<string, unknown> } | { kind: "refused"; code: string } | { kind: "unknown" };
/** What a send needs from the settings. */
export type SendSettings = { on: boolean; channel: string; mention?: boolean; mentionUser?: string };
export type PostOutcome = { incidentId: number; which: "open" | "resolve"; state: "posted" | "failed" | "unknown" | "skipped" | "muted"; ts?: string; error?: string };

/** One Slack Web API call with its receipts. Slack answers 200 with ok:false on refusals, so both are checked. */
export async function slackApi(
  deps: Pick<SlackDeps, "health" | "fetch">,
  token: string,
  method: "GET" | "POST",
  resource: "chat.postMessage" | "conversations.info",
  input: Record<string, unknown>,
): Promise<SlackAnswer> {
  const receipt = { provider: "slack" as const, method, resource: `slack.com/api/${resource}` };
  await deps.health({ ...receipt, phase: "intent" });
  let response: Response;
  try {
    const query = method === "GET" ? `?${new URLSearchParams(Object.entries(input).map(([k, v]) => [k, String(v)]))}` : "";
    response = await deps.fetch(`https://slack.com/api/${resource}${query}`, {
      method,
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, ...(method === "POST" ? { "Content-Type": "application/json; charset=utf-8" } : {}) },
      body: method === "POST" ? JSON.stringify(input) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    await deps.health({ ...receipt, phase: "unknown", error: "No answer from Slack" });
    return { kind: "unknown" };
  }
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    body = isObj(parsed) ? parsed : null;
  } catch { body = null; }
  const code = typeof body?.error === "string" ? body.error.replace(/[^a-z0-9_]/gi, "").slice(0, 60) : null;
  const ok = response.ok && body?.ok === true;
  await deps.health({ ...receipt, phase: "response", http_status: response.status, error: ok ? undefined : code ?? `HTTP ${response.status}` });
  if (ok) return { kind: "ok", body: body! };
  // A server error or an unreadable 200 may still have posted: unknown, never sent again.
  if (response.status >= 500 || (response.ok && body === null)) return { kind: "unknown" };
  return { kind: "refused", code: code ?? `HTTP ${response.status}` };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

type Outcome = { state: "posted" | "failed" | "unknown"; ts?: string; error?: string };

/**
 * Claim, send, record: one post or one thread reply. The claim is the
 * switch's word (it mutes a pending post when alerts are off); `settings.on`
 * only names the outcome when nothing comes back.
 */
export async function sendPost(
  deps: SlackDeps,
  incidentId: number,
  which: "open" | "resolve",
  settings: SendSettings,
): Promise<PostOutcome> {
  const claimed = await deps.rpc("cockpit_hours_watch_slack_claim", { p: { incidentId, which } });
  if (!isObj(claimed)) return { incidentId, which, state: settings.on ? "skipped" : "muted" };
  let channel = settings.channel;
  // Set the moment the request is handed to fetch: from then on it may have arrived.
  let sent = false;
  let out: Outcome;
  try {
    out = await deliver(deps, claimed, which, settings, c => { channel = c; }, () => { sent = true; });
  } catch (e) {
    const why = e instanceof Error && e.message ? e.message.slice(0, 160) : "no answer";
    out = sent
      ? { state: "unknown", error: `The send broke after the request left (${why}); it is not sent again in case it arrived.` }
      : { state: "failed", error: `The message was not sent: ${why}` };
  }
  await deps.rpc("cockpit_hours_watch_slack_result", { p: { incidentId, which, state: out.state, channel, ...(out.ts ? { ts: out.ts } : {}), ...(out.error ? { error: out.error.slice(0, 240) } : {}) } });
  return { incidentId, which, ...out };
}

/** "<@U09305KE2KS> " before an opening post while the mention is on and the user id is one; else nothing. */
export function mentionPrefix(settings: Pick<SendSettings, "mention" | "mentionUser">): string {
  return settings.mention === true && typeof settings.mentionUser === "string" && SLACK_USER_RE.test(settings.mentionUser) ? `<@${settings.mentionUser}> ` : "";
}

/** Everything between the claim and the record. `onSend` fires just before the request goes out. */
async function deliver(
  deps: SlackDeps,
  claimed: Record<string, unknown>,
  which: "open" | "resolve",
  settings: SendSettings,
  setChannel: (c: string) => void,
  onSend: () => void,
): Promise<Outcome> {
  const detail = isObj(field(claimed, "detail")) ? field(claimed, "detail") as Record<string, unknown> : {};
  const channel = str(field(claimed, "slackChannel")) ?? settings.channel;
  setChannel(channel);
  const sentence = str(which === "open" ? detail.text : detail.resolveText);
  const text = sentence && which === "open" ? mentionPrefix(settings) + sentence : sentence;
  const threadTs = str(field(claimed, "slackTs"));
  const token = deps.token().trim();
  if (!token) return { state: "failed", error: "SLACK_BOT_TOKEN is not set on cockpit-hours-watch. Set it in the function's secrets." };
  if (!text) return { state: "failed", error: "This alert has no sentence to send." };
  if (which === "resolve" && !threadTs) return { state: "failed", error: "The alert's own message has no Slack timestamp to reply to." };
  const watched: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    onSend();
    return deps.fetch(input, init);
  }) as typeof fetch;
  const answer = await slackApi({ health: deps.health, fetch: watched }, token, "POST", "chat.postMessage", {
    channel, text, unfurl_links: false, unfurl_media: false, ...(which === "resolve" ? { thread_ts: threadTs } : {}),
  });
  if (answer.kind === "unknown") return { state: "unknown", error: "Slack did not confirm the message; it is not sent again in case it arrived." };
  if (answer.kind === "refused") return { state: "failed", error: answer.code };
  const ts = str(answer.body.ts);
  if (!ts) return { state: "unknown", error: "Slack answered without the message's timestamp." };
  return { state: "posted", ts };
}

/** The doctor's channel check: conversations.info, read only. */
export async function checkChannel(deps: Pick<SlackDeps, "health" | "fetch" | "token">, channel: string): Promise<{ state: "ok" | "failing" | "unknown"; note: string }> {
  const token = deps.token().trim();
  if (!token) return { state: "failing", note: "SLACK_BOT_TOKEN is not set on cockpit-hours-watch." };
  const answer = await slackApi(deps, token, "GET", "conversations.info", { channel });
  if (answer.kind === "unknown") return { state: "unknown", note: "Slack did not answer." };
  if (answer.kind === "refused") return { state: "failing", note: `Slack refused the channel check: ${answer.code}.` };
  const c = isObj(answer.body.channel) ? answer.body.channel : {};
  const name = typeof c.name === "string" ? `#${c.name}` : channel;
  if (c.is_archived === true) return { state: "failing", note: `${name} is archived.` };
  return { state: "ok", note: c.is_member === true ? `${name} found; the bot is a member.` : `${name} found; the bot posts without joining (chat:write.public).` };
}
