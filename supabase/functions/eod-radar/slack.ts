/**
 * EOD Radar on Slack: read the EOD channels (conversations.history), find a
 * person by email (users.lookupByEmail), post the one closeout message
 * (chat.postMessage) and check the token (auth.test). The token is the
 * function secret SLACK_BOT_TOKEN (mahara-club-bot), read by name and never
 * written anywhere.
 *
 * Every call is receipted in cockpit_eod_radar_receipts before it leaves
 * (intent) and after (response, or unknown when no answer came); a receipt
 * that cannot be saved throws, so no call is made without one. The resource
 * is the method name only: no channel, user, email or message text.
 *
 * Slack answers 200 with ok:false on a refusal, so both are checked. A read
 * Slack refused names its code (missing_scope, not_in_channel, ...), which the
 * run turns into "not read", never "missed". Slack sends the token's scopes in
 * the x-oauth-scopes header; the run keeps them so a missing groups:history
 * can be named.
 */

export type Receipt = {
  provider: "slack";
  method: "GET" | "POST";
  resource: string;
  phase: "intent" | "response" | "unknown";
  http_status?: number;
  error?: string;
};
export type Health = (row: Receipt) => Promise<void>;
export type SlackDeps = { health: Health; fetch: typeof fetch; sleep: (ms: number) => Promise<void> };

export type SlackAnswer =
  | { kind: "ok"; body: Record<string, unknown>; scopes: string | null }
  | { kind: "refused"; code: string; status: number; scopes: string | null; retryAfter: number | null }
  | { kind: "unknown" };

type Resource = "conversations.history" | "users.lookupByEmail" | "chat.postMessage" | "auth.test";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One Slack Web API call with its receipts. */
export async function slackCall(
  deps: Pick<SlackDeps, "health" | "fetch">,
  token: string,
  method: "GET" | "POST",
  resource: Resource,
  input: Record<string, string | number | boolean>,
  onSend?: () => void,
): Promise<SlackAnswer> {
  const receipt = { provider: "slack" as const, method, resource: `slack.com/api/${resource}` };
  await deps.health({ ...receipt, phase: "intent" });
  let response: Response;
  try {
    const query = method === "GET" ? `?${new URLSearchParams(Object.entries(input).map(([k, v]) => [k, String(v)]))}` : "";
    onSend?.();
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
  } catch {
    body = null;
  }
  const scopes = response.headers.get("x-oauth-scopes");
  const code = typeof body?.error === "string" ? body.error.replace(/[^a-z0-9_]/gi, "").slice(0, 60) : null;
  const ok = response.ok && body?.ok === true;
  await deps.health({ ...receipt, phase: "response", http_status: response.status, error: ok ? undefined : (code ?? `HTTP ${response.status}`) });
  if (ok && body) return { kind: "ok", body, scopes };
  if (response.status >= 500 || (response.ok && body === null)) return { kind: "unknown" };
  const retry = Number(response.headers.get("retry-after"));
  return {
    kind: "refused",
    code: response.status === 429 ? "ratelimited" : (code ?? `HTTP_${response.status}`),
    status: response.status,
    scopes,
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
  };
}

export type ChannelRead = { ok: true; messages: Record<string, unknown>[]; scopes: string | null } | { ok: false; error: string; scopes: string | null };

const MAX_PAGES = 30;

/**
 * Every top-level message in a channel since `oldest` (seconds), page by page.
 * One wait when Slack asks to slow down (up to 10 seconds), then a refusal.
 */
export async function readChannel(deps: SlackDeps, token: string, channel: string, oldest: number): Promise<ChannelRead> {
  const messages: Record<string, unknown>[] = [];
  let cursor = "";
  let scopes: string | null = null;
  let waited = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const input: Record<string, string | number> = { channel, oldest: oldest.toFixed(6), limit: 200, inclusive: "true" };
    if (cursor) input.cursor = cursor;
    const answer = await slackCall(deps, token, "GET", "conversations.history", input);
    if (answer.kind === "unknown") return { ok: false, error: "no_answer", scopes };
    scopes = answer.scopes ?? scopes;
    if (answer.kind === "refused") {
      if (answer.code === "ratelimited" && !waited) {
        waited = true;
        await deps.sleep(Math.min(10, answer.retryAfter ?? 3) * 1000);
        page--;
        continue;
      }
      return { ok: false, error: answer.code, scopes };
    }
    const list = Array.isArray(answer.body.messages) ? answer.body.messages.filter(isObj) : [];
    messages.push(...list);
    const meta = isObj(answer.body.response_metadata) ? answer.body.response_metadata : {};
    cursor = typeof meta.next_cursor === "string" ? meta.next_cursor : "";
    if (!cursor || answer.body.has_more !== true) return { ok: true, messages, scopes };
  }
  return { ok: false, error: "too_many_pages", scopes };
}

export type Lookup = { state: "ok"; id: string } | { state: "not_found" } | { state: "refused"; code: string } | { state: "unknown" };

/** A person's Slack id from their email. users_not_found is "not found"; anything else Slack refuses keeps the old id. */
export async function lookupByEmail(deps: Pick<SlackDeps, "health" | "fetch">, token: string, email: string): Promise<Lookup> {
  const answer = await slackCall(deps, token, "GET", "users.lookupByEmail", { email });
  if (answer.kind === "unknown") return { state: "unknown" };
  if (answer.kind === "refused") return answer.code === "users_not_found" ? { state: "not_found" } : { state: "refused", code: answer.code };
  const user = isObj(answer.body.user) ? answer.body.user : {};
  const id = typeof user.id === "string" && /^[UW][A-Z0-9]{8,12}$/.test(user.id) ? user.id : null;
  if (!id || user.deleted === true) return { state: "not_found" };
  return { state: "ok", id };
}

export type Delivery = { state: "posted"; ts: string } | { state: "failed"; error: string } | { state: "unknown"; error: string };

/**
 * Post one message. Once the request has left, a break is "unknown" (it may
 * have arrived) and is never sent again; only Slack's own refusal is "failed".
 */
export async function postMessage(deps: Pick<SlackDeps, "health" | "fetch">, token: string, channel: string, text: string): Promise<Delivery> {
  let sent = false;
  try {
    const answer = await slackCall(deps, token, "POST", "chat.postMessage", { channel, text, unfurl_links: false, unfurl_media: false }, () => {
      sent = true;
    });
    if (answer.kind === "unknown") return { state: "unknown", error: "Slack did not confirm the post; it is not sent again in case it arrived." };
    if (answer.kind === "refused") return { state: "failed", error: answer.code };
    const ts = typeof answer.body.ts === "string" ? answer.body.ts : "";
    if (!/^[0-9]{9,11}\.[0-9]{6}$/.test(ts)) return { state: "unknown", error: "Slack answered without the message's timestamp." };
    return { state: "posted", ts };
  } catch (e) {
    const why = e instanceof Error && e.message ? e.message.slice(0, 160) : "no answer";
    return sent
      ? { state: "unknown", error: `The send broke after the request left (${why}); it is not sent again in case it arrived.` }
      : { state: "failed", error: `The message was not sent: ${why}` };
  }
}

/** The token's bot and scopes (auth.test), for the doctor. */
export async function authTest(deps: Pick<SlackDeps, "health" | "fetch">, token: string): Promise<{ ok: true; user: string | null; scopes: string | null } | { ok: false; error: string }> {
  const answer = await slackCall(deps, token, "POST", "auth.test", {});
  if (answer.kind === "unknown") return { ok: false, error: "no_answer" };
  if (answer.kind === "refused") return { ok: false, error: answer.code };
  return { ok: true, user: typeof answer.body.user === "string" ? answer.body.user : null, scopes: answer.scopes };
}

/** The scopes a run needs that the token's x-oauth-scopes header does not list. Null when Slack did not send the header. */
export function missingScopes(scopes: string | null): string[] | null {
  if (!scopes) return null;
  const have = new Set(scopes.split(",").map(s => s.trim()));
  return ["groups:history", "users:read.email", "chat:write"].filter(s => !have.has(s));
}
