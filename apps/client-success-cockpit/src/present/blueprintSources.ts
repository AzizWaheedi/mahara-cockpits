import { z } from "zod";
import type { OnboardingRow } from "@/lib/onboardingCore";
import type { Answers, BpPart } from "./blueprintForm";
import type { Change, SaveResult } from "./blueprintSaver";
import type { Overrides } from "./deckData";
import { type DeckClient, problem, sourcesSchema } from "./sources";
import type { Loaded } from "./useDeckModel";

/**
 * The Brand Blueprint's reads and writes (docs/brand-blueprint/SPEC.md 2
 * and 3), through the signed-in seat's own client:
 * cockpit_blueprint_sources (everything the deck reads, gated for creative
 * and CSM seats), cockpit_blueprint_save (autosave per field),
 * cockpit_blueprint_part_done (a press), and cockpit-creative-api's
 * clientAction (the run) and blueprintRehearse (a plan from reads only).
 * Every answer is zod-checked; every error is a plain sentence.
 */

const text = z.string();
const opt = text.nullable().optional();
const answers = z.record(z.string(), z.unknown());

const outboxRow = z
  .object({
    id: text,
    state: z.string(),
    error: opt,
    result: z.unknown().optional(),
    createdAt: opt,
    settledAt: opt,
  })
  .passthrough();
export type OutboxRow = z.infer<typeof outboxRow>;

const partStamp = z
  .object({
    status: z.string().optional(),
    firstAt: opt,
    firstBy: opt,
    lastAt: opt,
    lastBy: opt,
    presses: z.number().optional(),
    lastRequestId: opt,
    sent: answers.optional(),
  })
  .passthrough();
export type PartStamp = z.infer<typeof partStamp>;

const meta = z.record(
  z.string(),
  z.object({ by: opt, at: opt, from: opt }).passthrough(),
);

export const rowSchema = z
  .object({
    taskId: text,
    clientName: text,
    answers: answers.default({}),
    meta: meta.default({}),
    parts: z.record(z.string(), partStamp).default({}),
    revision: z.number(),
    launchTaskId: opt,
    createdAt: opt,
    updatedAt: opt,
    updatedBy: opt,
    outbox: z.record(z.string(), outboxRow.nullable()).nullable().optional(),
  })
  .passthrough();
export type BlueprintRow = z.infer<typeof rowSchema>;

const stepRow = z
  .object({ taskId: opt, parentId: opt, name: opt, status: opt })
  .passthrough();

const settingsSchema = z
  .object({
    packs: z.record(z.string(), text.nullable()).nullable().default({}),
    assignee: z
      .object({ id: text, label: opt })
      .passthrough()
      .nullable()
      .optional(),
    closeRoute: text.default("card_only"),
  })
  .passthrough();

export const blueprintSourcesSchema = z
  .object({
    taskId: text,
    clientName: text,
    at: opt,
    can: z
      .object({
        write: z.boolean().nullable(),
        rehearse: z.boolean().nullable(),
      })
      .passthrough(),
    presenter: z.object({ firstName: opt }).passthrough().nullable().optional(),
    deck: sourcesSchema,
    kit: z.record(z.string(), z.unknown()).nullable().optional(),
    card: z
      .object({
        templatedAds: opt,
        canSelfRecord: opt,
        adApproval: opt,
        offerCreation: opt,
      })
      .passthrough()
      .nullable()
      .optional(),
    creativeOnboarding: z
      .object({
        parentId: opt,
        parentName: opt,
        steps: z.record(z.string(), stepRow).default({}),
      })
      .passthrough()
      .nullable()
      .optional(),
    settings: settingsSchema,
    blueprint: rowSchema.nullable().optional(),
    outbox: z.record(z.string(), outboxRow.nullable()).nullable().optional(),
  })
  .passthrough();
export type BlueprintSources = z.infer<typeof blueprintSourcesSchema>;

/** What the deck keeps of the Blueprint beside its own read. */
export interface BlueprintBundle {
  can: { write: boolean; rehearse: boolean };
  card: BlueprintSources["card"] | null;
  steps: BlueprintSources["creativeOnboarding"] | null;
  settings: z.infer<typeof settingsSchema>;
  row: BlueprintRow | null;
  outbox: Record<string, OutboxRow | null>;
}

/** The kit as the deck model reads it: the OnboardingRow fields, the rest empty. */
function kitOf(
  kit: Record<string, unknown> | null | undefined,
): OnboardingRow | null {
  if (!kit) return null;
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    clickup_task_id: String(kit.clickup_task_id ?? ""),
    client_name: String(kit.client_name ?? ""),
    clickup_status: null,
    client_status: s(kit.client_status),
    in_onboarding: true,
    csm: s(kit.csm),
    signup_on: null,
    onboarding_call_on: null,
    launch_on: null,
    links: (kit.links ?? {}) as OnboardingRow["links"],
    handover: (kit.handover ?? {}) as OnboardingRow["handover"],
    sales_transcript: null,
    forms: (kit.forms ?? {}) as OnboardingRow["forms"],
    card_updated_at: null,
    seen_at: "",
    synced_at: "",
  };
}

/** The Blueprint's read as the deck model takes it. */
export function loadedFromBlueprint(src: BlueprintSources): Loaded {
  const prep: Loaded["prep"] = {
    onboarding:
      (src.deck.prep?.onboarding?.overrides as Overrides | undefined) ?? {},
    launch: {},
    blueprint: {},
  };
  return {
    sources: src.deck,
    kit: kitOf(src.kit),
    ads: [],
    prep,
    problems: [],
    videos: null,
    videosProblem: null,
    blueprint: {
      can: {
        write: src.can.write === true,
        rehearse: src.can.rehearse === true,
      },
      card: src.card ?? null,
      steps: src.creativeOnboarding ?? null,
      settings: src.settings,
      row: src.blueprint ?? null,
      outbox: {
        ...(src.outbox ?? {}),
        ...(src.blueprint?.outbox ?? {}),
      },
    },
  };
}

export async function readBlueprintSources(
  client: DeckClient,
  taskId: string,
): Promise<BlueprintSources> {
  const { data, error } = await client.rpc("cockpit_blueprint_sources", {
    p_task_id: taskId,
  });
  if (error)
    throw Error(
      problem(error, "The Brand Blueprint could not be read.").replace(
        "its sources and prep",
        "the Blueprint",
      ),
    );
  const parsed = blueprintSourcesSchema.safeParse(data);
  if (!parsed.success)
    throw Error(
      "The Brand Blueprint came back in a shape this page does not read.",
    );
  return parsed.data;
}

export async function loadBlueprint(
  client: DeckClient,
  taskId: string,
): Promise<Loaded> {
  return loadedFromBlueprint(await readBlueprintSources(client, taskId));
}

const saveSchema = z
  .object({
    row: rowSchema.nullable(),
    applied: z.array(text).default([]),
    conflicts: z
      .array(
        z
          .object({ key: text, theirs: z.unknown(), by: opt, at: opt })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export async function saveBlueprint(
  client: DeckClient,
  taskId: string,
  changes: Record<string, Change>,
  session: string,
  baseRevision: number | null,
): Promise<SaveResult> {
  const { data, error } = await client.rpc("cockpit_blueprint_save", {
    p_task_id: taskId,
    p_changes: changes,
    p_session: session,
    p_base_revision: baseRevision,
  });
  if (error)
    throw Error(
      problem(
        error,
        "The answer could not be saved.",
        "No connection. What you typed is kept here and saves when you are back online.",
      ),
    );
  const parsed = saveSchema.safeParse(data);
  if (!parsed.success)
    throw Error("The save came back in a shape this page does not read.");
  return {
    row: parsed.data.row,
    applied: parsed.data.applied,
    conflicts: parsed.data.conflicts.map(c => ({
      key: c.key,
      theirs: c.theirs ?? null,
      by: c.by ?? null,
      at: c.at ?? null,
    })),
  };
}

const pressSchema = z
  .object({
    id: text,
    state: text,
    part: z.number(),
    firstAt: opt,
    presses: z.number().optional(),
    again: z.boolean().optional(),
    duplicate: z.boolean().optional(),
    lastAt: opt,
  })
  .passthrough();
export type PressResult = z.infer<typeof pressSchema>;

/** A refusal the press understands: the keys still missing, by the server. */
export class StillMissing extends Error {
  readonly keys: string[];
  constructor(keys: string[]) {
    super("Still missing");
    this.keys = keys;
  }
}

export async function blueprintPartDone(
  client: DeckClient,
  taskId: string,
  part: BpPart,
  requestId: string,
): Promise<PressResult> {
  const { data, error } = await client.rpc("cockpit_blueprint_part_done", {
    p_task_id: taskId,
    p_part: part,
    p_request_id: requestId,
  });
  if (error) {
    const e = error as { message?: string; details?: string | null };
    if (/^Still missing/.test(e.message ?? ""))
      throw new StillMissing(
        String(e.details ?? "")
          .split(",")
          .map(s => s.trim())
          .filter(Boolean),
      );
    throw Error(problem(error, "The part could not be sent. Press it again."));
  }
  const parsed = pressSchema.safeParse(data);
  if (!parsed.success)
    throw Error("The press came back in a shape this page does not read.");
  return parsed.data;
}

const runSchema = z
  .object({
    id: opt,
    state: opt,
    result: z.unknown().optional(),
    note: opt,
    lines: z.array(text).optional(),
  })
  .passthrough();
export type RunResult = z.infer<typeof runSchema>;

/**
 * What the Edge Function said: it answers {error: "plain sentence"} with a
 * 4xx, and supabase-js then returns no data and the response in
 * `error.context` (as `invoke()` in sources.ts reads it).
 */
async function functionSaid(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const j = (await (ctx as Response).clone().json()) as {
        error?: string;
      };
      return typeof j?.error === "string" ? j.error : "";
    } catch {
      // not JSON
    }
  }
  return "";
}

/** Runs the queued row now (cockpit-creative-api clientAction, apply). */
export async function runBlueprintPart(
  client: DeckClient,
  id: string,
): Promise<RunResult> {
  const { data, error } = await client.functions.invoke(
    "cockpit-creative-api",
    {
      body: { operation: "clientAction", args: { id }, apply: true },
    },
  );
  if (error) {
    const said =
      (await functionSaid(error)) ||
      ((data as { error?: unknown } | null)?.error as string | undefined) ||
      "";
    throw Error(
      said ||
        problem(
          error,
          "The part is saved, but its run did not finish. Run it again.",
        ),
    );
  }
  const parsed = runSchema.safeParse(data);
  if (!parsed.success)
    throw Error("The run came back in a shape this page does not read.");
  return parsed.data;
}

const rehearseSchema = z
  .object({
    dryRun: z.boolean().optional(),
    missing: z.array(text).default([]),
    lines: z.array(text).default([]),
  })
  .passthrough();

/** A rehearsal's plan, from ClickUp reads only (admins and the CEO). */
export async function rehearseBlueprintPart(
  client: DeckClient,
  taskId: string,
  part: BpPart,
  answers: Answers,
): Promise<{ lines: string[]; missing: string[] }> {
  const { data, error } = await client.functions.invoke(
    "cockpit-creative-api",
    {
      body: { operation: "blueprintRehearse", args: { taskId, part, answers } },
    },
  );
  if (error)
    throw Error(
      (await functionSaid(error)) ||
        problem(error, "The rehearsal's plan could not be read."),
    );
  const parsed = rehearseSchema.safeParse(data);
  if (!parsed.success)
    throw Error("The rehearsal came back in a shape this page does not read.");
  return { lines: parsed.data.lines, missing: parsed.data.missing };
}
