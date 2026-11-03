import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  ClientFormSchema,
  EditorOne,
  EditorRead,
  Routing,
  RoutingPatch,
  StructuredRead,
} from "@/lib/formsEditorCore";

/**
 * The forms editor's reads and writes (docs/forms/WAVE34-CONTRACT.md 2.6,
 * 4.9; supabase/migrations/20261102d_forms_editor.sql): six gated RPCs,
 * and the structured version's read (20261103h, WAVE56-CONTRACT.md 4.22),
 * through the signed-in seat's own client. The database checks the seat
 * (an admin or the CEO), the base version, the schema, the text rule and
 * the field guard, and writes every audit row; this file only carries the
 * calls and turns a refusal into the server's own sentence.
 */

type Rpc = Pick<SupabaseClient, "rpc">;

export type PublishResult = {
  version: number;
  registryUpdated: boolean;
  read: EditorOne;
};

export type FormsEditorIO = {
  read: () => Promise<EditorRead>;
  readOne: (key: string) => Promise<EditorOne>;
  /** Saves the draft on `base`; `schema: null` discards it. */
  saveDraft: (
    key: string,
    schema: ClientFormSchema | null,
    base: number,
  ) => Promise<EditorOne>;
  publish: (key: string, note: string, base: number) => Promise<PublishResult>;
  restore: (
    key: string,
    version: number,
    note: string | null,
  ) => Promise<PublishResult>;
  setRouting: (patch: RoutingPatch) => Promise<Routing>;
  /**
   * The form's newest version when it is in client form schema version 2 (the structured onboarding,
   * 20261103h), else null. Optional: a stand-in without it shows the plain read-only view.
   */
  structured?: (key: string) => Promise<StructuredRead | null>;
};

/** A refusal in the server's words, with its code and the path it points at. */
export class FormsEditorError extends Error {
  code: string | null;
  where: string | null;
  constructor(
    message: string,
    code: string | null = null,
    where: string | null = null,
  ) {
    super(message);
    this.code = code;
    this.where = where;
  }
}

/** The seat is not an admin or the CEO (the editor's gate). */
export const notAllowed = (e: unknown) =>
  e instanceof FormsEditorError &&
  (e.code === "42501" || /Only an admin or the CEO/i.test(e.message));

/** Any thrown value as a FormsEditorError with a sentence a person can act on. */
export function editorError(
  error: { message?: string; code?: string; hint?: string | null } | unknown,
): FormsEditorError {
  if (error instanceof FormsEditorError) return error;
  const e = (error ?? {}) as {
    message?: string;
    code?: string;
    hint?: string | null;
  };
  const m = String(e.message ?? "").trim();
  const code = e.code ?? null;
  const where = e.hint ? String(e.hint) : null;
  if (/could not find the function|PGRST202|schema cache/i.test(m))
    return new FormsEditorError("Opens after the next cockpit update.", code);
  if (/JWT|not authenticated/i.test(m))
    return new FormsEditorError("Sign in again, then try once more.", code);
  if (/Failed to fetch|NetworkError|network/i.test(m))
    return new FormsEditorError(
      "No connection. Nothing was changed; try again when you are back online.",
      code,
    );
  return new FormsEditorError(
    m || "The server gave no reason. Try again.",
    code,
    where,
  );
}

const SHAPE =
  "The server answered in a shape this page does not read. Tell the tech lead.";

const schemaShape = z
  .object({ v: z.literal(1), key: z.string(), fields: z.array(z.any()) })
  .passthrough();
const draftRow = z
  .object({
    baseVersion: z.number(),
    savedAt: z.string(),
    savedBy: z.string(),
    stale: z.boolean(),
  })
  .nullable();
const formRow = z.object({
  key: z.string(),
  title: z.string(),
  titleAr: z.string().nullable(),
  group: z.enum(["client", "staff", "typeform"]),
  editable: z.boolean(),
  why: z.string().nullable(),
  provider: z.string(),
  audience: z.string(),
  version: z.number().nullable(),
  registryVersion: z.number(),
  publishedAt: z.string().nullable(),
  publishedBy: z.string().nullable(),
  questions: z.number().nullable(),
  live: z.boolean().nullable(),
  draft: draftRow,
});
const schedule = z
  .object({
    on: z.boolean(),
    rule: z.record(z.string(), z.unknown()),
    updatedAt: z.string().nullish(),
    updatedBy: z.string().nullish(),
  })
  .optional();
const routing = z.object({
  schedules: z.object({ nps: schedule, csat: schedule }).nullable(),
  lowScore: z.object({ max: z.number() }).nullable(),
  scheduleOn: z.boolean().nullable(),
  note: z.string(),
});
const editorRead = z.object({
  forms: z.array(formRow),
  routing,
  portalBase: z.string(),
  workspaces: z.array(
    z.object({
      locationId: z.string(),
      name: z.string(),
      status: z.string().nullable(),
    }),
  ),
});
const editorOne = z.object({
  form: formRow,
  published: z
    .object({
      version: z.number(),
      schema: schemaShape,
      publishedAt: z.string(),
      publishedBy: z.string(),
      note: z.string().nullable(),
    })
    .nullable(),
  draft: z
    .object({
      schema: schemaShape,
      baseVersion: z.number(),
      savedAt: z.string(),
      savedBy: z.string(),
      stale: z.boolean(),
      problem: z.string().nullable(),
      where: z.string().nullable(),
    })
    .nullable(),
  history: z.array(
    z.object({
      version: z.number(),
      publishedAt: z.string(),
      publishedBy: z.string(),
      note: z.string().nullable(),
      client: z.boolean(),
      current: z.boolean(),
    }),
  ),
  reads: z.array(
    z.object({
      effect: z.string(),
      label: z.string(),
      fields: z.array(z.string()),
    }),
  ),
  record: z
    .object({
      fields: z.array(z.string()),
      lives: z.string().nullable(),
      typeformId: z.string().nullable(),
    })
    .nullable(),
});
const publishResult = z.object({
  version: z.number(),
  registryUpdated: z.boolean(),
  read: editorOne,
});

const text = z.object({ en: z.string(), ar: z.string() });
const structuredRead = z
  .object({
    version: z.number(),
    schema: z
      .object({
        v: z.literal(2),
        key: z.string(),
        title: text,
        minutes: z.number(),
        fields: z.array(
          z
            .object({ key: z.string(), type: z.string(), label: text })
            .passthrough(),
        ),
      })
      .passthrough(),
    publishedAt: z.string().nullable(),
    publishedBy: z.string(),
    note: z.string().nullable(),
    state: z.enum(["off", "canary", "on"]),
    issuing: z.number().nullable(),
    answers: z.number(),
    openInvites: z.number(),
  })
  .nullable();

function parse<T>(shape: z.ZodType, data: unknown): T {
  const out = shape.safeParse(data);
  if (!out.success) throw new FormsEditorError(SHAPE);
  return out.data as T;
}

async function call(client: Rpc, fn: string, args?: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw editorError(error);
  return data as unknown;
}

/** The editor's RPCs through the seat's own Supabase client. */
export function supabaseFormsEditorIO(client: Rpc): FormsEditorIO {
  return {
    read: async () =>
      normaliseRead(
        parse<EditorRead>(
          editorRead,
          await call(client, "cockpit_form_editor_read"),
        ),
      ),
    readOne: async key =>
      parse<EditorOne>(
        editorOne,
        await call(client, "cockpit_form_editor_read_one", { p_form_key: key }),
      ),
    saveDraft: async (key, schema, base) =>
      parse<EditorOne>(
        editorOne,
        await call(client, "cockpit_form_draft_save", {
          p_form_key: key,
          p_schema: schema,
          p_base_version: base,
        }),
      ),
    publish: async (key, note, base) =>
      parse<PublishResult>(
        publishResult,
        await call(client, "cockpit_form_publish", {
          p_form_key: key,
          p_note: note,
          p_base_version: base,
        }),
      ),
    restore: async (key, version, note) =>
      parse<PublishResult>(
        publishResult,
        await call(client, "cockpit_form_restore", {
          p_form_key: key,
          p_version: version,
          p_note: note,
        }),
      ),
    setRouting: async patch =>
      parse<Routing>(
        routing,
        await call(client, "cockpit_form_routing_set", { p_patch: patch }),
      ),
    structured: async key =>
      parse<StructuredRead | null>(
        structuredRead,
        await call(client, "cockpit_form_editor_structured", {
          p_form_key: key,
        }),
      ),
  };
}

function normaliseRead(r: EditorRead): EditorRead {
  return {
    ...r,
    workspaces: r.workspaces.map(w => ({ ...w, status: w.status ?? "" })),
  };
}

/**
 * Whether the editor's door is open: cockpit_form_doors().editor, true only
 * once 20261102d is live (20261102a reads its marker). Any error reads closed.
 */
export async function readEditorDoor(client: Rpc | null): Promise<boolean> {
  if (!client) return false;
  try {
    const { data, error } = await client.rpc("cockpit_form_doors");
    if (error) return false;
    return Boolean(
      data &&
        typeof data === "object" &&
        (data as Record<string, unknown>).editor === true,
    );
  } catch {
    return false;
  }
}
