import type { SupabaseClient } from "@supabase/supabase-js";

const IMPORT_REQUEST_KEY = "cockpit.ceo.workspace-import.request-id";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const memoryRequestIds = new Map<string, string>();

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function apiError(value: unknown): string | null {
  return isRow(value) && typeof value.error === "string" ? value.error : null;
}

function newRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pendingRequestId(key: string): string {
  try {
    if (typeof sessionStorage !== "undefined") {
      const stored = sessionStorage.getItem(key);
      if (stored && UUID.test(stored)) return stored;
      const created = newRequestId();
      sessionStorage.setItem(key, created);
      return created;
    }
  } catch {
    // Preserve the same actor's uncertain intent in memory if storage is unavailable.
  }
  const existing = memoryRequestIds.get(key);
  if (existing) return existing;
  const created = newRequestId();
  memoryRequestIds.set(key, created);
  return created;
}

function clearPendingRequestId(key: string, requestId: string): void {
  try {
    if (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(key) === requestId
    ) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // The in-memory ID is still cleared after the server confirms the import.
  }
  if (memoryRequestIds.get(key) === requestId) memoryRequestIds.delete(key);
}

async function providerCall(
  client: SupabaseClient,
  operation: string,
  args: Row = {},
  apply = false,
  expectedUserId?: string,
): Promise<unknown> {
  const { data: actor, error: authError } = await client.auth.getUser();
  if (authError || !actor.user?.email_confirmed_at)
    throw new Error("A confirmed founder sign-in is required.");
  if (expectedUserId && actor.user.id !== expectedUserId)
    throw new Error(
      "The account changed before the import; no request was sent.",
    );
  const { data, error } = await client.functions.invoke("cockpit-ceo-api", {
    body: { operation, args, apply },
  });
  const { data: current, error: sessionError } = await client.auth.getSession();
  if (sessionError || current.session?.user.id !== actor.user.id)
    throw new Error("The account changed; the prior response was discarded.");
  if (error) {
    const context = "context" in error ? error.context : null;
    if (context instanceof Response) {
      const body: unknown = await context
        .clone()
        .json()
        .catch(() => null);
      const detail = apiError(body);
      if (detail) throw new Error(detail);
    }
    throw new Error(
      apiError(data) ??
        error.message ??
        "The CEO provider operation was not confirmed.",
    );
  }
  const detail = apiError(data);
  if (detail) throw new Error(detail);
  if (data === null || data === undefined)
    throw new Error("The CEO provider operation was not confirmed.");
  return data as unknown;
}

export function readFrequencyForRange(
  client: SupabaseClient,
  args: { from: string; to: string },
): Promise<unknown> {
  return providerCall(client, "ceo.frequency.forRange", args);
}

export function readAdsWindow(
  client: SupabaseClient,
  args: { from: string; to: string },
): Promise<unknown> {
  return providerCall(client, "ceo.windows.ads", args);
}

export function readContentWindow(
  client: SupabaseClient,
  args: { from: string; to: string },
): Promise<unknown> {
  return providerCall(client, "ceo.windows.content", args);
}

export function readWorkspaceDirectory(
  client: SupabaseClient,
): Promise<unknown> {
  return providerCall(client, "ceo.people.workspace");
}

export async function importWorkspace(
  client: SupabaseClient,
  args: Row = {},
  options: { apply?: boolean } = {},
): Promise<unknown> {
  const { data: actor, error: authError } = await client.auth.getUser();
  if (authError || !actor.user?.email_confirmed_at)
    throw new Error("A confirmed founder sign-in is required.");
  const key = `${IMPORT_REQUEST_KEY}:${actor.user.id}`;
  const supplied = args.requestId;
  const requestId =
    supplied === undefined ? pendingRequestId(key) : String(supplied);
  if (!UUID.test(requestId))
    throw new Error(
      "Workspace import request ID is invalid. Retry from the roster screen.",
    );
  const apply = options.apply === true;
  const result: unknown = await providerCall(
    client,
    "ceo.people.importWorkspace",
    { ...args, requestId },
    apply,
    actor.user.id,
  );
  if (apply && isRow(result) && result.ok === true && result.dryRun !== true)
    clearPendingRequestId(key, requestId);
  return result;
}
