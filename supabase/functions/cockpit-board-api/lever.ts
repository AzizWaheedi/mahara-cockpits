// A lever from the Client Performance board (CEO, 2026-10-16: "from the board,
// add a task per client with the levers to pull"). One ClickUp task in the
// owning department's list and a comment on the client's card, both read back,
// filed with cockpit-csm-api's own ClickUp code (core.ts prepareCsm and
// executeCsm, tools.ts providerTools), imported, never copied: the department
// lists, the task read-back and the comment read-back stay one implementation.
//
// The gate is the database's: cockpit_board_lever_context, called as the
// signed-in seat (any active seat, the client through cockpit_client_allowed,
// a ClickUp card on the client). A dry run returns what would be filed and
// writes nothing. Applying needs a request id: the lever row is written first
// (cockpit_board_lever_begin, service role), ClickUp is called, and the row
// ends open with its task or reconcile with the error
// (cockpit_board_lever_finish). A request id seen before replays a confirmed
// lever and refuses anything else, so a retry never files twice. Every ClickUp
// call lands in cockpit_board_provider_health.
import { z } from "zod";
import { executeCsm, prepareCsm } from "../cockpit-csm-api/core.ts";
import { providerTools } from "../cockpit-csm-api/tools.ts";

export const DEPARTMENTS = ["creative", "tech", "client_success", "call_center", "media_buyer"] as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const leverInput = z
  .object({
    operation: z.literal("lever"),
    args: z
      .object({
        locationId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        metric: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
        lever: z.string().trim().min(3).max(200),
        department: z.enum(DEPARTMENTS),
        note: z.string().trim().max(1000).optional(),
        meetingId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,80}$/)
          .optional(),
        from: day.optional(),
        to: day.optional(),
      })
      .strict(),
    requestId: uuid.optional(),
    apply: z.boolean().optional(),
  })
  .strict();

const contextSchema = z
  .object({
    actorId: uuid,
    email: z.string().min(3),
    locationId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    taskId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    clientName: z.string().trim().min(1),
    metric: z.string().min(2),
    metricLabel: z.string().min(1),
    lever: z.string().trim().min(3).max(200),
    department: z.enum(DEPARTMENTS),
    note: z.string().nullable(),
    meetingId: z.string().nullable(),
    evidence: z.string().min(1).max(500),
    day,
    from: day,
    to: day,
  })
  .strict();
export type LeverContext = z.infer<typeof contextSchema>;

type Result = { data: any; error: { message: string } | null };
export type UserClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<Result> };
export type AdminClient = UserClient & {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

/** The gate refused: the seat, the client or the card. */
export class LeverAccessError extends Error {}
/** The request itself is not a lever. */
export class LeverInputError extends Error {}

const canonical = (v: unknown): string =>
  JSON.stringify(
    v && typeof v === "object"
      ? Array.isArray(v)
        ? v.map(x => JSON.parse(canonical(x)))
        : Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .filter(k => (v as Record<string, unknown>)[k] !== undefined)
              .map(k => [k, JSON.parse(canonical((v as Record<string, unknown>)[k]))]),
          )
      : v,
  );

/** The fields the gate decides; the evidence may move between two reads and does not. */
const GATE_FIELDS = ["actorId", "email", "locationId", "taskId", "clientName", "metric", "lever", "department"] as const;
const sameGate = (a: LeverContext, b: LeverContext) => GATE_FIELDS.every(k => a[k] === b[k]);

/** The ClickUp task's description: where it came from and why. */
export function taskDescription(c: LeverContext): string {
  return [
    `Lever from the Client Performance board, added by ${c.email}.`,
    `Client: ${c.clientName}`,
    `Metric: ${c.metricLabel}`,
    `Why: ${c.evidence}`,
    c.note ? `Note: ${c.note}` : "",
    c.meetingId ? `Raised in meeting ${c.meetingId}.` : "",
    `Client task: https://app.clickup.com/t/${c.taskId}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runLever(
  client: UserClient,
  admin: AdminClient,
  raw: unknown,
  env: (name: string) => string | undefined,
  request: typeof fetch = fetch,
) {
  const parsed = leverInput.safeParse(raw);
  if (!parsed.success)
    throw new LeverInputError(
      "Send the client, the metric, the lever (3 to 200 characters) and the department that owns it.",
    );
  const input = parsed.data;
  const scope = async (): Promise<LeverContext> => {
    const { data, error } = await client.rpc("cockpit_board_lever_context", { p_args: input.args });
    if (error) throw new LeverAccessError(error.message);
    const context = contextSchema.safeParse(data);
    if (!context.success) throw Error("The lever's context could not be read. Refresh the board and try again.");
    return context.data;
  };
  const context = await scope();

  let leverId: string | null = null;
  const provider = providerTools(
    env("CLICKUP_API_TOKEN") ?? "",
    async row => {
      const { error } = await admin.from("cockpit_board_provider_health").insert({ ...row, lever_id: leverId });
      if (error) throw Error("Could not save the ClickUp receipt; nothing more was sent.");
    },
    request,
  );
  const args = {
    kind: "ticket",
    department: context.department,
    action: context.lever,
    ...(context.note ? { note: context.note } : {}),
  };
  const plan = await prepareCsm("act", args, context, provider);
  if (!plan.ticket) throw Error("The lever has no ClickUp list.");
  plan.ticket.description = taskDescription(context);
  const preview = {
    list: plan.ticket.list,
    department: context.department,
    name: plan.ticket.name,
    description: plan.ticket.description,
    dueDate: plan.ticket.due_date,
    clientTask: `https://app.clickup.com/t/${context.taskId}`,
  };
  if (input.apply !== true) return { dryRun: true, plan: preview, context };

  if (!input.requestId) throw new LeverInputError("A request id is required to add the lever.");
  const fresh = await scope();
  if (!sameGate(fresh, context))
    throw new LeverAccessError("Client access changed; refresh the board before adding the lever.");

  const { data: begun, error: beginError } = await admin.rpc("cockpit_board_lever_begin", {
    p_id: input.requestId,
    p_context: context,
    p_request: input.args,
  });
  if (beginError) throw Error(`The lever could not be recorded, so nothing was sent to ClickUp: ${beginError.message}`);
  if (begun?.existing) {
    const prior = begun.existing;
    if (
      prior.status === "open" &&
      prior.createdById === context.actorId &&
      canonical(prior.request) === canonical(input.args)
    ) {
      const { request: _request, result, createdById: _by, ...lever } = prior;
      return { ...(result ?? {}), ok: true, replayed: true, lever };
    }
    throw Error("This request may have reached ClickUp. Reconcile it before retrying.");
  }

  leverId = input.requestId;
  let done: Awaited<ReturnType<typeof executeCsm>>;
  try {
    done = await executeCsm(plan, provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ClickUp did not confirm the lever. Reconcile before retrying.";
    await admin.rpc("cockpit_board_lever_finish", { p_id: leverId, p_result: null, p_error: message });
    throw Error(message);
  }
  const { data: lever, error: finishError } = await admin.rpc("cockpit_board_lever_finish", {
    p_id: leverId,
    p_result: done.result,
    p_error: null,
  });
  if (finishError) throw Error("ClickUp has the task but the board could not record it. Reconcile before retrying.");
  return { ...done.result, ok: true, lever };
}
