/**
 * keys.save (docs/forms/STAGE2-CONTRACT.md 6.7): the CEO pastes a Fathom, DeepSeek
 * or Anthropic key on the CEO cockpit. It is tested before it replaces the old
 * one: a refused key changes nothing, a provider that cannot be reached keeps the
 * key unchecked. The key goes to the vault through cockpit_forms_key_put; only its
 * last four characters come back. The test calls of a pasted key write their
 * receipts into cockpit_forms_key_checks, never into the monitored
 * cockpit_csm_provider_health (a refused paste is a user error, not an outage).
 *
 * The model-list read is here too, for the doctor: no tools.ts helper covers it,
 * so it writes its intent row before and its response or unknown row after
 * itself, and a row that cannot be saved stops it.
 */
import { RpcError } from "../cockpit-hours-sync/db.ts";
import { fathomTools } from "../cockpit-csm-api/tools.ts";
import { CS_TEAM } from "../../../hermes/csm-calls/fathomRules.ts";
import { DoorError, type OpCtx } from "./door.ts";

export type KeyProvider = "fathom" | "deepseek" | "anthropic";
export type SaveAnswer = { ok: boolean; state: "connected" | "unchecked" | "refused"; text: string; last4: string | null };
type Health = (row: Record<string, unknown>) => Promise<void>;

const LABEL: Record<KeyProvider, string> = { fathom: "Fathom", deepseek: "DeepSeek", anthropic: "Anthropic" };
export const NOT_A_KEY = "That doesn't look like a key: one line, 20 to 400 characters, no spaces. Nothing was changed.";
const MODEL_LIST: Record<"deepseek" | "anthropic", { url: string; model: string }> = {
  deepseek: { url: "https://api.deepseek.com/models", model: "deepseek-flash" },
  anthropic: { url: "https://api.anthropic.com/v1/models?limit=1000", model: "claude-opus-5-5" },
};

/** One GET of a provider's model list: 'ok' with whether the model the drafts use is listed, 'refused' (4xx) or 'unknown'. */
export async function modelList(
  provider: "deepseek" | "anthropic",
  key: string,
  health: Health,
  resource: string,
  request: typeof fetch,
): Promise<{ kind: "ok"; listed: boolean } | { kind: "refused"; status: number } | { kind: "unknown" }> {
  const row = { provider, method: "GET", resource };
  await health({ ...row, phase: "intent" });
  const headers: Record<string, string> =
    provider === "deepseek"
      ? { Authorization: `Bearer ${key}`, Accept: "application/json" }
      : { "x-api-key": key, "anthropic-version": "2023-06-01", Accept: "application/json" };
  let response: Response;
  try {
    response = await request(MODEL_LIST[provider].url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(15000) });
  } catch {
    await health({ ...row, phase: "unknown" });
    return { kind: "unknown" };
  }
  if (response.status >= 400 && response.status < 500) {
    await response.body?.cancel().catch(() => undefined);
    await health({ ...row, phase: "response", http_status: response.status });
    return { kind: "refused", status: response.status };
  }
  let body: unknown = null;
  if (response.ok) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } else await response.body?.cancel().catch(() => undefined);
  const data = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data) ? (body as { data: { id?: unknown }[] }).data : null;
  if (!response.ok || !data) {
    await health({ ...row, phase: "unknown", http_status: response.status });
    return { kind: "unknown" };
  }
  await health({ ...row, phase: "response", http_status: response.status });
  return { kind: "ok", listed: data.some(m => m?.id === MODEL_LIST[provider].model) };
}

/** The Fathom key's two light reads: users (200 only for an account admin) and a team-filtered page that holds only Customer Success. */
export async function fathomCheck(key: string, health: Health, request: typeof fetch, now: Date) {
  const tools = fathomTools(key, health, request);
  const users = await tools.users();
  const page = users.kind === "ok"
    ? await tools.meetings({ teams: [CS_TEAM], createdAfter: new Date(now.getTime() - 86_400_000).toISOString() })
    : null;
  const people = users.kind === "ok" ? (["items", "users", "data"].map(k => users.body[k]).find(Array.isArray) as unknown[] | undefined)?.length ?? 0 : null;
  return { users, page, people };
}

export async function saveKey(op: OpCtx, body: Record<string, unknown>): Promise<SaveAnswer> {
  const provider = String(body.provider ?? "") as KeyProvider;
  if (!(provider in LABEL)) throw new DoorError("Pick Fathom, DeepSeek or Anthropic.", 400);
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) return { ok: false, state: "refused", text: NOT_A_KEY, last4: null };
  const label = LABEL[provider];
  const runKey = `keys:${op.deps.uuid()}`;
  const health: Health = row => op.deps.keyChecks({ provider, method: row.method, resource: row.resource, phase: row.phase, http_status: row.http_status ?? null, run_key: runKey });
  const refused: SaveAnswer = { ok: false, state: "refused", text: `${label} refused this key. Nothing was changed.`, last4: null };
  const unreachable = `The key is saved, but ${label} couldn't be reached to check it.`;

  let state: "connected" | "unchecked" = "unchecked";
  let text = unreachable;
  let stateNote: string | null = null;
  let meta: Record<string, unknown> | undefined;
  if (provider === "fathom") {
    const check = await fathomCheck(key, health, op.deps.fetch, op.deps.now());
    const usersRefused = check.users.kind === "refused" && check.users.status !== 429;
    const pageRefused = check.page?.kind === "refused" && check.page.status !== 429;
    const dirty = check.page?.kind === "ok" && Number(check.page.body.dropped ?? 0) > 0;
    if (usersRefused || pageRefused || dirty) return refused;
    if (check.users.kind === "ok" && check.page?.kind === "ok") {
      state = "connected";
      text = `Connected. Fathom shows ${check.people} people.`;
      meta = { users: check.people, adminOk: true, csFilterOk: true };
    }
  } else {
    const list = await modelList(provider, key, health, provider === "deepseek" ? "api.deepseek.com/models" : "api.anthropic.com/v1/models", op.deps.fetch);
    if (list.kind === "refused" && list.status !== 429) return refused;
    if (list.kind === "ok") {
      state = "connected";
      text = "Connected.";
      if (!list.listed) {
        stateNote = `This key cannot see ${MODEL_LIST[provider].model}.`;
        text = `Connected. ${stateNote}`;
      }
    }
  }
  try {
    const saved = (await op.deps.rpc("cockpit_forms_key_put", {
      p: { provider, secret: key, savedBy: op.actor.email, state, ...(stateNote ? { stateNote } : {}), ...(meta ? { meta } : {}) },
    })) as { last4?: string | null; state?: string } | null;
    return { ok: true, state, text, last4: saved?.last4 ?? key.slice(-4) };
  } catch (e) {
    // The vault refuses a key in the wrong shape for its provider with its own sentence.
    if (e instanceof RpcError && e.code === "22023") return { ok: false, state: "refused", text: e.message, last4: null };
    throw e;
  }
}
