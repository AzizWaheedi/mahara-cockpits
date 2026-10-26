/**
 * Requests: thin wrappers over the browser functions of
 * docs/requests/CONTRACT.md 2.5. Each one throws the server's own sentence
 * (a RequestError, with the Postgres code when there is one), so a screen
 * shows exactly what the database refused and why. Byte-identical in all
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
    throw new RequestError(
      e instanceof Error && e.message
        ? `The cockpit could not reach the database: ${e.message}`
        : "The cockpit could not reach the database. Try again in a minute.",
    );
  }
  if (answer.error) {
    const code = answer.error.code ?? null;
    // PostgREST's "no such function": the migration is not applied yet.
    if (code === "PGRST202" || code === "42883")
      throw new RequestError(REQUEST_SENTENCES.missingFunction, code);
    const message = (answer.error.message ?? "").trim();
    throw new RequestError(
      message || "The database refused this without a reason.",
      code,
    );
  }
  if (answer.data === null || answer.data === undefined)
    throw new RequestError("The database sent back nothing. Try again.");
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

/** A thrown value as a sentence. */
export function errorWords(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e ?? "");
  return text.trim() || "Something went wrong. Try again.";
}
