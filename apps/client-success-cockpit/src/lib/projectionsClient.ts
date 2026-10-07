import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildProjections } from "./projectionsModel";
import { projectionSourceSchema } from "./projectionsSchema";
import type { ProjectionsEdit, ProjectionsPage } from "./projectionsView";
export type ProjectionOptions = { forEmail?: string; meetingId?: string };
export async function readProjections(
  client: SupabaseClient | null,
  options: ProjectionOptions = {},
): Promise<ProjectionsPage> {
  if (!client) throw new Error("Client-success sign-in is required");
  const { data, error } = await client.rpc("cockpit_csm_projection_read", {
    p_for_email: options.forEmail ?? null,
    p_meeting_id: options.meetingId ?? null,
  });
  if (error) throw new Error(error.message);
  return buildProjections(projectionSourceSchema.parse(data));
}
export async function editProjections(
  client: SupabaseClient | null,
  edit: ProjectionsEdit,
  options: ProjectionOptions = {},
): Promise<ProjectionsPage> {
  if (!client) throw new Error("Client-success sign-in is required");
  const { error } = await client.rpc("cockpit_csm_projection_edit", {
    p_edit: edit,
    p_meeting_id: options.meetingId ?? null,
  });
  if (error) throw new Error(error.message);
  return readProjections(client, options);
}
const pending = new Map<string, string>();
const bookingResult = z.object({
  ok: z.literal(true),
  when: z.string(),
  title: z.string(),
  eventId: z.string(),
  receiptId: z.string(),
});
const billingResult = z.object({
  ok: z.boolean(),
  payments: z.number().int().nonnegative(),
  error: z.string().nullish(),
  ledgerSyncedAt: z.number().nullable().optional(),
});
export type BookingArgs = {
  taskId: string;
  day: string;
  time: string;
  minutes?: number;
  meetingId?: string;
};
export function projectionCommand(
  client: SupabaseClient | null,
  operation: "projections.bookCall",
  args: BookingArgs,
): Promise<z.infer<typeof bookingResult>>;
export function projectionCommand(
  client: SupabaseClient | null,
  operation: "projections.refreshBillingNow",
  args: Record<string, never>,
): Promise<z.infer<typeof billingResult>>;
export async function projectionCommand(
  client: SupabaseClient | null,
  operation: "projections.bookCall" | "projections.refreshBillingNow",
  args: BookingArgs | Record<string, never>,
) {
  if (!client) throw new Error("Client-success sign-in is required");
  const { data: auth, error: authError } = await client.auth.getSession();
  if (authError || !auth.session)
    throw new Error("Client-success sign-in is required");
  const key =
    auth.session.user.id + ":" + operation + ":" + JSON.stringify(args);
  const requestId = pending.get(key) ?? crypto.randomUUID();
  pending.set(key, requestId);
  const { data, error } = await client.functions.invoke("cockpit-csm-api", {
    body: {
      operation,
      args,
      requestId,
      apply: operation === "projections.bookCall",
    },
  });
  let body: unknown = data;
  if (error && "context" in error && error.context instanceof Response) {
    try {
      body = await error.context.json();
    } catch {
      /* The HTTP message remains available. */
    }
  }
  const failure = z
    .object({ error: z.string().optional(), ok: z.boolean().optional() })
    .safeParse(body);
  if (
    error ||
    (operation === "projections.bookCall" &&
      failure.success &&
      failure.data.ok === false)
  )
    throw new Error(
      (failure.success ? failure.data.error : undefined) ??
        error?.message ??
        "The booking needs reconciliation; do not create another appointment.",
    );
  if (operation === "projections.bookCall") {
    const confirmed = bookingResult.parse(body);
    pending.delete(key);
    return confirmed;
  }
  const result = billingResult.parse(body);
  pending.delete(key);
  return result;
}
