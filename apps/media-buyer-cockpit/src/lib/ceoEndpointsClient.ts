import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The CEO endpoints that used to run on Convex:
 * - ceo.webinarPitch.set: a founder RPC (cockpit_ceo_webinar_pitch_set).
 * - ceo.extensions.applyToClickUp and ceo.posting.*: the cockpit-ceo-api
 *   gateway, which checks the founder, records provider health and writes
 *   through audited RPCs.
 */

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const POSTING_READS = new Set(["list", "get", "channels"]);
const POSTING_ROWS = new Set([
  "get",
  "create",
  "save",
  "approve",
  "checkInstagram",
  "discard",
]);
const POSTING_JOBS = new Set(["rerender", "reprepare", "youtubeConnect"]);

async function invokeCeo(
  client: SupabaseClient,
  operation: string,
  args: Row,
  apply: boolean,
): Promise<unknown> {
  const { data, error } = await client.functions.invoke("cockpit-ceo-api", {
    body: { operation, args, apply },
  });
  if (error || (isRow(data) && typeof data.error === "string")) {
    let detail =
      isRow(data) && typeof data.error === "string" ? data.error : null;
    const context = (error as { context?: { json?: () => Promise<unknown> } })
      ?.context;
    if (!detail && typeof context?.json === "function") {
      try {
        const body = await context.json();
        if (isRow(body) && typeof body.error === "string") detail = body.error;
      } catch {
        // The status line below still says the action was not confirmed.
      }
    }
    throw new Error(
      detail ?? error?.message ?? "The server operation was not confirmed.",
    );
  }
  return data;
}

function minute(value: unknown, name: string): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 300
  )
    throw new Error(`${name} has to be a whole minute between 0 and 300.`);
  return value;
}

/** Pitch times typed on the webinar funnel. The next CEO refresh uses them. */
export async function setWebinarPitches(
  client: SupabaseClient,
  args: Row,
): Promise<{ ok: true }> {
  if (typeof args.sessionUuid !== "string" || !args.sessionUuid.trim())
    throw new Error("Choose a webinar session.");
  const { data, error } = await client.rpc("cockpit_ceo_webinar_pitch_set", {
    p_session_uuid: args.sessionUuid,
    p_pitch1_min: minute(args.pitch1Min, "Pitch 1"),
    p_pitch2_min: minute(args.pitch2Min, "Pitch 2"),
  });
  if (error) throw new Error(error.message);
  if (!isRow(data) || data.ok !== true)
    throw new Error("The pitch times were not confirmed.");
  return { ok: true };
}

/** The button on the Client success tab: every card the form has named, written now. */
export async function applyExtensionsToClickUp(client: SupabaseClient) {
  const data = await invokeCeo(
    client,
    "ceo.extensions.applyToClickUp",
    {},
    true,
  );
  if (
    !isRow(data) ||
    !Number.isInteger(data.written) ||
    !Number.isInteger(data.cleared) ||
    !Number.isInteger(data.skipped) ||
    !Array.isArray(data.errors) ||
    typeof data.note !== "string"
  )
    throw new Error("The ClickUp write was not confirmed.");
  return {
    written: data.written as number,
    cleared: data.cleared as number,
    skipped: data.skipped as number,
    errors: (data.errors as unknown[]).map(String),
    note: data.note,
  };
}

const isPost = (value: unknown) =>
  isRow(value) && Number.isSafeInteger(value.id) && isRow(value.urls);

/** One Posting tab operation through the gateway, with the shape the tab reads. */
export async function postingAction(
  client: SupabaseClient,
  op: string,
  args: Row = {},
): Promise<unknown> {
  if (
    !POSTING_READS.has(op) &&
    !POSTING_ROWS.has(op) &&
    !POSTING_JOBS.has(op) &&
    op !== "uploadUrl"
  )
    throw new Error(`Unknown posting operation: ${op}`);
  const data = await invokeCeo(
    client,
    `ceo.posting.${op}`,
    args ?? {},
    !POSTING_READS.has(op),
  );
  if (op === "list") {
    if (!Array.isArray(data) || !data.every(isPost))
      throw new Error("The posts were not confirmed.");
    return data;
  }
  if (op === "channels") {
    if (
      !Array.isArray(data) ||
      !data.every(c => isRow(c) && typeof c.platform === "string")
    )
      throw new Error("The publishing channels were not confirmed.");
    return data;
  }
  if (op === "uploadUrl") {
    if (
      !isRow(data) ||
      typeof data.path !== "string" ||
      typeof data.url !== "string"
    )
      throw new Error("Supabase gave no upload link.");
    return { path: data.path, url: data.url };
  }
  if (POSTING_JOBS.has(op)) {
    if (!isRow(data) || !Number.isSafeInteger(data.jobId))
      throw new Error("The job was not queued.");
    return { jobId: data.jobId };
  }
  if (!isPost(data)) throw new Error("The server did not confirm the post.");
  return data;
}
