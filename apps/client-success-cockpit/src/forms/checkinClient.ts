import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * The 1-1 notes window's calls (docs/forms/STAGE2-CONTRACT.md 2.1, 2.2,
 * 3.3, 3.4 with A7.3, and 6.2): the gated RPCs of cockpit_form_* through
 * the seat's own client, and the cockpit-forms-api operations (the pull on
 * open, the drafts, the transcript link, the Typeform check). Every answer
 * is parsed before the window reads it. The sign-in guard is
 * formClient.ts's: an answer that arrives after the account changed is
 * thrown away. While the backend is not deployed every call says so in one
 * plain sentence.
 */

export type FormClient = Pick<SupabaseClient, "rpc" | "auth" | "functions">;

const NOT_LIVE = "The cockpit's 1-1 notes are not live yet.";

/**
 * A request that never reached the cockpit (the Wi-Fi dropped, the laptop
 * slept), in plain words instead of the browser's own ("Failed to fetch" in
 * Chrome, "Load failed" in Safari, "NetworkError…" in Firefox).
 */
export const OFFLINE = "The connection dropped.";
const FETCH_FAILED =
  /^(?:TypeError:\s*)?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource|Network request failed|fetch failed|Failed to send a request to the Edge Function)\b/i;
/** The browser's words for a request that never got an answer. */
export const offline = (text: string | null | undefined) =>
  FETCH_FAILED.test(String(text ?? "").trim());
/** OFFLINE as a clause after a colon ("Not saved: the connection dropped."). */
export const clauseOf = (text: string) => {
  const t = text.trim().replace(/\.$/, "");
  return t === OFFLINE.replace(/\.$/, "") ? "the connection dropped" : t;
};

/** A refusal in the server's words, with its SQL state or HTTP status. */
export class CheckinError extends Error {
  code: string | null;
  status: number | null;
  constructor(message: string, code: string | null, status: number | null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Null and missing are the same answer: nothing. */
const nul = <T extends z.ZodType>(t: T) =>
  t.nullish().transform(v => (v ?? null) as z.output<T> | null);

// ------------------------------------------------------------ shapes (3.3, 3.4)

const metaEntry = z
  .object({
    at: nul(z.string()),
    from: nul(z.string()),
    by: nul(z.string()),
  })
  .passthrough();

export const responseView = z.object({
  id: z.string(),
  formKey: z.string(),
  formVersion: z.number(),
  mode: z.enum(["shadow", "live"]),
  state: z.enum(["draft", "submitted", "confirmed", "legacy", "void"]),
  revision: z.number(),
  taskId: z.string(),
  clientName: nul(z.string()),
  answers: z.record(z.string(), z.unknown()),
  meta: z.record(z.string(), metaEntry).default({}),
  createdAt: z.string(),
  submittedAt: nul(z.string()),
});
export type ResponseView = z.output<typeof responseView>;

export const EFFECT_STATES = [
  "planned",
  "dry_run",
  "queued",
  "delivered",
  "failed",
  "unknown",
  "skipped",
] as const;
export const OWNERS = ["make", "shadow", "cockpit"] as const;

export const effectView = z.object({
  key: z.string(),
  label: z.string(),
  owner: z.enum(OWNERS),
  delivery: z.string(),
  state: z.enum(EFFECT_STATES),
  at: z.string(),
  reason: nul(z.string()),
  lines: z.array(z.string()).default([]),
});
export type EffectView = z.output<typeof effectView>;

export const DRAFT_KINDS = [
  "todos",
  "client_notes",
  "defcon_priority",
  "grade",
  "recap",
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const draftView = z.object({
  kind: z.enum(DRAFT_KINDS),
  state: z.enum(["drafting", "ready", "off", "failed", "skipped"]),
  attempt: z.number().default(0),
  provider: z.string().default("none"),
  model: nul(z.string()),
  promptVersion: z.string().default(""),
  at: z.string().default(""),
  reason: nul(z.string()),
  output: nul(z.record(z.string(), z.unknown())),
});
export type DraftView = z.output<typeof draftView>;

export const callView = z.object({
  ref: z.string(),
  kind: z.enum(["fathom", "booking"]),
  recordingId: nul(z.string()),
  callId: nul(z.number()),
  title: nul(z.string()),
  startsAt: z.string(),
  endsAt: nul(z.string()),
  minutes: nul(z.number()),
  why: z.string(),
  label: z.enum(["exact", "likely", "possible", "default", "hint", "booking"]),
  ask: z.boolean(),
  whyText: z.string().default(""),
  booking: nul(
    z.object({
      callId: z.number(),
      startsAt: z.string(),
      kind: z.string(),
      status: z.string(),
    }),
  ),
  shareUrl: nul(z.string()),
  recorder: nul(z.enum(["csm", "team", "other"])),
  recorderRole: nul(z.string()),
  actionItems: nul(z.number()),
  hasSummary: z.boolean().default(false),
  hasTranscript: z.boolean().default(false),
  onClient: z.enum(["this", "other", "none"]).default("none"),
  otherClient: nul(z.string()),
  /** The 3.2 sentence when this recording cannot be picked here (A7.3). */
  blocked: nul(z.string()),
  notesAlready: nul(
    z.object({ at: z.string(), source: z.enum(["cockpit", "typeform"]) }),
  ),
  duplicateOf: nul(z.string()),
});
export type CallView = z.output<typeof callView>;

// ------------------------------------------------------------ answers

const entryAnswer = z.object({
  key: z.string(),
  title: z.string(),
  provider: z.enum(["native", "typeform", "clickup"]),
  typeformId: nul(z.string()),
  version: z.number(),
  native: z.boolean(),
  mode: nul(z.enum(["live", "shadow"])),
  now: z.string(),
});
export type EntryAnswer = z.output<typeof entryAnswer>;

const openAnswer = z.object({
  form: z.object({
    key: z.string(),
    title: z.string(),
    provider: z.string(),
    version: z.number(),
    schema: z.unknown(),
    effects: z
      .array(
        z.object({
          key: z.string(),
          owner: z.enum(OWNERS),
          delivery: z.string(),
          label: z.string(),
        }),
      )
      .default([]),
    mode: z.enum(["live", "shadow"]),
  }),
  response: nul(responseView),
  client: z.object({
    taskId: z.string(),
    name: z.string(),
    stage: nul(z.string()),
    happiness: nul(z.string()),
  }),
  rehearse: z.boolean(),
  now: z.string(),
});
export type OpenAnswer = z.output<typeof openAnswer>;

const saveAnswer = z.object({
  row: z.object({
    answers: z.record(z.string(), z.unknown()),
    meta: z.record(z.string(), metaEntry).default({}),
    revision: z.number(),
  }),
  applied: z.array(z.string()),
  conflicts: z
    .array(
      z.object({
        key: z.string(),
        theirs: z.unknown(),
        by: nul(z.string()),
        at: nul(z.string()),
      }),
    )
    .default([]),
});
export type SaveAnswer = z.output<typeof saveAnswer>;

const submitAnswer = z.object({
  response: responseView,
  effects: z.array(effectView),
  duplicate: z.boolean().default(false),
});
export type SubmitAnswer = z.output<typeof submitAnswer>;

const readAnswer = z.object({
  response: responseView,
  effects: z.array(effectView),
  drafts: z.array(draftView).default([]),
  now: z.string(),
});
export type ReadAnswer = z.output<typeof readAnswer>;

const draftsRead = z.object({
  recordingId: nul(z.string()),
  drafts: z.array(draftView),
  started: z.array(z.string()).default([]),
  now: z.string(),
});
export type DraftsAnswer = z.output<typeof draftsRead>;

const callsAnswer = z.object({
  picked: nul(callView),
  others: z.array(callView).default([]),
  fathom: z.object({
    state: z.enum(["ok", "waiting", "failed", "busy", "off"]),
    checkedAt: nul(z.string()),
    note: nul(z.string()),
  }),
  now: z.string(),
});
export type CallsAnswer = z.output<typeof callsAnswer>;

const transcriptAnswer = z.union([
  z.object({ url: z.string() }),
  z.object({ text: z.string() }),
]);
export type TranscriptAnswer = z.output<typeof transcriptAnswer>;

const sentAnswer = z.object({
  items: z.array(
    z.object({
      taskId: z.string(),
      sent: nul(z.boolean()),
      at: nul(z.string()),
    }),
  ),
  now: z.string(),
});
export type SentAnswer = z.output<typeof sentAnswer>;

// ------------------------------------------------------------ the guard

/** No connection right now: the browser says so, or the sign-in check could not be sent. */
const noConnection = (error: unknown) => {
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return true;
  const e = error as { name?: string; status?: number; message?: string };
  return (
    e?.name === "AuthRetryableFetchError" ||
    e?.status === 0 ||
    offline(e?.message)
  );
};

async function guard(client: FormClient) {
  let got: Awaited<ReturnType<FormClient["auth"]["getUser"]>>;
  try {
    got = await client.auth.getUser();
  } catch (e) {
    if (noConnection(e)) throw new CheckinError(OFFLINE, null, null);
    throw e;
  }
  const { data, error } = got;
  // The sign-in check could not reach the server: the seat is still signed
  // in, so the sentence is about the connection, not about signing in.
  if (error && noConnection(error)) throw new CheckinError(OFFLINE, null, null);
  if (error || !data.user)
    throw Error("Sign in to the cockpit, then try again.");
  const uid = data.user.id;
  let changed = false;
  const sub = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== uid) changed = true;
  }).data.subscription;
  return {
    check: async () => {
      const current = await client.auth.getSession();
      if (changed || current.error || current.data.session?.user.id !== uid)
        throw Error("The signed-in account changed. Reload this window.");
    },
    release: () => sub.unsubscribe(),
  };
}

const notLive = (s: string) =>
  /could not find the function|PGRST202|does not exist|requested function was not found|NOT_FOUND/i.test(
    s,
  );

async function rpc<T extends z.ZodType>(
  client: FormClient | null,
  name: string,
  args: Record<string, unknown>,
  shape: T,
): Promise<z.output<T>> {
  if (!client) throw Error("Sign in to the cockpit, then try again.");
  const actor = await guard(client);
  try {
    await actor.check();
    const { data, error } = await client.rpc(name, args);
    await actor.check();
    if (error) {
      const code = (error as { code?: string }).code ?? null;
      // The request never reached the database (postgrest-js answers code "").
      if (!code && offline(error.message))
        throw new CheckinError(OFFLINE, null, null);
      if (notLive(`${error.message} ${code ?? ""}`))
        throw new CheckinError(NOT_LIVE, code, null);
      throw new CheckinError(error.message, code, null);
    }
    const parsed = shape.safeParse(data);
    if (!parsed.success)
      throw Error(
        "The 1-1 notes came back in a shape this window does not read.",
      );
    return parsed.data;
  } finally {
    actor.release();
  }
}

async function door<T extends z.ZodType>(
  client: FormClient | null,
  body: Record<string, unknown>,
  shape: T,
): Promise<z.output<T>> {
  if (!client) throw Error("Sign in to the cockpit, then try again.");
  const actor = await guard(client);
  try {
    await actor.check();
    const { data, error } = await client.functions.invoke("cockpit-forms-api", {
      body,
    });
    await actor.check();
    let answer: unknown = data;
    let status: number | null = null;
    if (error && "context" in error && error.context instanceof Response) {
      status = error.context.status;
      answer = await error.context
        .clone()
        .json()
        .catch(() => null);
    }
    const said = z.object({ error: z.string() }).safeParse(answer);
    if (said.success) throw new CheckinError(said.data.error, null, status);
    // The request never reached the function (FunctionsFetchError).
    if (
      error &&
      status === null &&
      (error.name === "FunctionsFetchError" || offline(error.message))
    )
      throw new CheckinError(OFFLINE, null, null);
    if (error) {
      const raw = answer as { message?: string; code?: string } | null;
      if (status === 404 || notLive(`${raw?.message ?? ""} ${raw?.code ?? ""}`))
        throw new CheckinError(NOT_LIVE, raw?.code ?? null, status);
      throw new CheckinError(error.message, null, status);
    }
    const parsed = shape.safeParse(answer);
    if (!parsed.success)
      throw Error(
        "The 1-1 notes came back in a shape this window does not read.",
      );
    return parsed.data;
  } finally {
    actor.release();
  }
}

// ------------------------------------------------------------ the RPCs (2.1)

/** cockpit_form_entry: where a form is filled today, for this seat. */
export function readEntry(client: FormClient | null, formKey = "checkin") {
  return rpc(
    client,
    "cockpit_form_entry",
    { p_form_key: formKey },
    entryAnswer,
  );
}

/** cockpit_form_open: this seat's draft for the client, or a new one. */
export function openCheckin(
  client: FormClient | null,
  a: { taskId: string; responseId: string | null; rehearse: boolean },
) {
  return rpc(
    client,
    "cockpit_form_open",
    {
      p_form_key: "checkin",
      p_task_id: a.taskId,
      p_response_id: a.responseId,
      p_rehearse: a.rehearse,
    },
    openAnswer,
  );
}

export function saveCheckin(
  client: FormClient | null,
  a: {
    responseId: string;
    changes: Record<string, unknown>;
    session: string;
    baseRevision: number | null;
  },
) {
  return rpc(
    client,
    "cockpit_form_save",
    {
      p_response_id: a.responseId,
      p_changes: a.changes,
      p_session: a.session,
      p_base_revision: a.baseRevision,
    },
    saveAnswer,
  );
}

export function submitCheckin(
  client: FormClient | null,
  a: { responseId: string; baseRevision: number | null },
) {
  return rpc(
    client,
    "cockpit_form_submit",
    { p_response_id: a.responseId, p_base_revision: a.baseRevision },
    submitAnswer,
  );
}

export function discardCheckin(client: FormClient | null, responseId: string) {
  return rpc(
    client,
    "cockpit_form_discard",
    { p_response_id: responseId },
    z.object({ id: z.string(), state: z.string() }),
  );
}

/** cockpit_form_responses_read: the response, its effects and its drafts. */
export function readResponse(client: FormClient | null, responseId: string) {
  return rpc(
    client,
    "cockpit_form_responses_read",
    { p_response_id: responseId },
    readAnswer,
  );
}

/** cockpit_form_drafts_read: the newest attempt per kind, read only. */
export function readDrafts(client: FormClient | null, responseId: string) {
  return rpc(
    client,
    "cockpit_form_drafts_read",
    { p_response_id: responseId },
    draftsRead,
  );
}

// ------------------------------------------------------------ cockpit-forms-api (6.2)

/** checkin.calls: the pull on open, the pasted link, Check again. */
export function readCalls(
  client: FormClient | null,
  a: {
    taskId: string;
    responseId: string | null;
    shareUrl: string | null;
    refresh: boolean;
  },
) {
  return door(client, { op: "checkin.calls", ...a }, callsAnswer);
}

/** checkin.drafts: begins what can be drafted, then reads every kind. */
export function startDrafts(client: FormClient | null, responseId: string) {
  return door(client, { op: "checkin.drafts", responseId }, draftsRead);
}

export function draftAgain(
  client: FormClient | null,
  responseId: string,
  kind: Exclude<DraftKind, "grade">,
) {
  return door(
    client,
    { op: "checkin.draftAgain", responseId, kind },
    draftsRead,
  );
}

/** checkin.transcript: a 60-second link to the stored text, or Fathom's. */
export function readTranscriptLink(
  client: FormClient | null,
  responseId: string,
  recordingId: string,
) {
  return door(
    client,
    { op: "checkin.transcript", responseId, recordingId },
    transcriptAnswer,
  );
}

/** checkin.typeformSent: has the 1-1 form been sent since the client's last call. */
export function readTypeformSent(
  client: FormClient | null,
  items: { taskId: string; since: string }[],
) {
  return door(client, { op: "checkin.typeformSent", items }, sentAnswer);
}
