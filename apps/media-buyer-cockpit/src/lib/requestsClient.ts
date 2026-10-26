/**
 * Requests: thin wrappers over the browser functions of
 * docs/requests/CONTRACT.md 2.5. Each one throws a RequestError: the
 * server's own sentence when it refused on purpose, plain words when the
 * database or the network failed (the raw text goes to the console). Byte-identical in all
 * five apps (scripts/check-shared.sh).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ClientsRead,
  REQUEST_SENTENCES,
  type RequestDetail,
  type RequestRow,
  type RequestsRead,
  type RequestView,
  type RoutePreview,
  type SubmitInput,
  type SubmitResult,
  type TypesRead,
} from "@/lib/requestsCore";

/** A refusal or failure, in the server's words. */
export class RequestError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "RequestError";
    this.code = code;
  }
}

type RpcAnswer = {
  data: unknown;
  error: { message?: string; code?: string } | null;
};

/**
 * The codes the request and task functions raise their own sentences with
 * (RAISE EXCEPTION ... USING ERRCODE, migrations r and t): those sentences
 * are written for the screen and shown as they are. Anything else is the
 * database or the network talking, and the screen says it in plain words.
 */
const OWN_SENTENCE_CODES = new Set([
  "P0001",
  "P0002",
  "22023",
  "23505",
  "40001",
  "42501",
  "55000",
]);

/**
 * Postgres's own wording, which can come back under the same codes (a grant
 * missing, a constraint, a bad value): never shown as it is.
 */
const RAW_DATABASE =
  /permission denied|duplicate key value|violates [\w-]+ constraint|invalid input syntax|syntax error|does not exist|canceling statement|null value in column/i;

/** Plain words for what the database or the network said (D5). */
export const PLAIN_ERRORS = {
  unreachable:
    "The cockpit could not reach the database. Check your connection, then try again.",
  slow: "The database took too long to answer. Try again in a minute.",
  signedOut: "Your sign-in has run out. Sign in again, then try again.",
  other:
    "The database could not answer just now. Try again in a minute; if it keeps happening, tell the systems manager.",
  nothing: "The database sent back nothing. Try again.",
  notAllowed:
    "Your seat cannot do this here. Ask the systems manager if you need it.",
  clash: "That is already saved for someone else. Reload, then try again.",
} as const;

/** The plain sentence for a database refusal that is not one of ours. */
export function plainError(code: string | null, message: string): string {
  if (
    code === "57014" ||
    /statement timeout|canceling statement/i.test(message)
  )
    return PLAIN_ERRORS.slow;
  if (code === "PGRST301" || code === "PGRST302" || /jwt/i.test(message))
    return PLAIN_ERRORS.signedOut;
  if (/failed to fetch|network|load failed|fetch failed/i.test(message))
    return PLAIN_ERRORS.unreachable;
  if (code === "42501") return PLAIN_ERRORS.notAllowed;
  if (code === "23505") return PLAIN_ERRORS.clash;
  return PLAIN_ERRORS.other;
}

/** One RPC, its refusal turned into a RequestError. */
export async function callRequests<T>(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  let answer: RpcAnswer;
  try {
    answer = (await client.rpc(name, args)) as RpcAnswer;
  } catch (e) {
    // The raw text goes to the console for whoever debugs it, not the screen.
    console.warn(`${name} could not reach the database`, e);
    throw new RequestError(PLAIN_ERRORS.unreachable);
  }
  if (answer.error) {
    const code = answer.error.code ?? null;
    // PostgREST's "no such function": the migration is not applied yet.
    if (code === "PGRST202" || code === "42883")
      throw new RequestError(REQUEST_SENTENCES.missingFunction, code);
    const message = (answer.error.message ?? "").trim();
    if (
      code &&
      OWN_SENTENCE_CODES.has(code) &&
      message &&
      !RAW_DATABASE.test(message)
    )
      throw new RequestError(message, code);
    console.warn(`${name} refused`, code, message);
    throw new RequestError(plainError(code, message), code);
  }
  if (answer.data === null || answer.data === undefined)
    throw new RequestError(PLAIN_ERRORS.nothing);
  return answer.data as T;
}

/** The types this seat may ask for, the seat and whether the writer is on. */
export const readRequestTypes = (client: SupabaseClient) =>
  callRequests<TypesRead>(client, "cockpit_request_types_read");

/** Client cards this seat may raise a request for, by name. */
export const readRequestClients = (
  client: SupabaseClient,
  search: string | null = null,
  includeStopped = false,
) =>
  callRequests<ClientsRead>(client, "cockpit_request_clients", {
    p_search: search?.trim() ? search.trim() : null,
    p_include_stopped: includeStopped,
  });

/** Where a request would go, without writing anything. */
export const previewRequest = (
  client: SupabaseClient,
  typeKey: string,
  clientTaskId: string | null,
  answers: Record<string, string | number>,
) =>
  callRequests<RoutePreview>(client, "cockpit_request_preview", {
    p_type_key: typeKey,
    p_client_task_id: clientTaskId,
    p_answers: answers,
  });

/** Sends a request. The same requestId and answers return the first send. */
export const submitRequest = (client: SupabaseClient, input: SubmitInput) =>
  callRequests<SubmitResult>(client, "cockpit_request_submit", {
    p_request_id: input.requestId,
    p_type_key: input.typeKey,
    p_client_task_id: input.clientTaskId,
    p_answers: input.answers,
    p_due_on: input.dueOn,
    p_priority: input.priority,
    p_source: input.source,
    p_replaces_task_id: input.replacesTaskId ?? null,
  });

/** Cancels a request that has not reached ClickUp. */
export const cancelRequest = (
  client: SupabaseClient,
  requestId: string,
  reason: string,
) =>
  callRequests<RequestRow>(client, "cockpit_request_cancel", {
    p_request_id: requestId,
    p_reason: reason,
  });

/** One view of requests: mine, assigned, team or all. */
export const readRequests = (
  client: SupabaseClient,
  view: RequestView,
  limit = 50,
) =>
  callRequests<RequestsRead>(client, "cockpit_requests_read", {
    p_view: view,
    p_limit: Math.min(200, Math.max(1, Math.round(limit))),
  });

/** One request with its answers and history. */
export const readRequest = (client: SupabaseClient, requestId: string) =>
  callRequests<RequestDetail>(client, "cockpit_request_get", {
    p_request_id: requestId,
  });

/** A request id for one send; kept across retries of the same press. */
export function newRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * A thrown value as a sentence. A RequestError already carries the words
 * the screen should show; anything else (a bug, a browser error) is kept
 * out of the screen and logged.
 */
export function errorWords(e: unknown): string {
  if (e instanceof RequestError && e.message.trim()) return e.message.trim();
  console.warn("Request screen error", e);
  return plainError(null, e instanceof Error ? e.message : String(e ?? ""));
}
