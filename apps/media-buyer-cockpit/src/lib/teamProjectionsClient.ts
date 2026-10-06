import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildProjections } from "./projectionsModel";
import { projectionSourceSchema } from "./projectionsSchema";
import type { ProjectionsEdit, ProjectionsPage } from "./projectionsView";

export type ProjectionOptions = {
  meetingId?: string;
  forEmail?: string;
};

export type TeamProjectionsEditArgs = {
  meetingId?: string;
  edit: ProjectionsEdit;
  forEmail?: string;
};

export type BookingArgs = {
  taskId: string;
  day: string;
  time: string;
  minutes?: number;
  meetingId?: string;
};

export const bookingResultSchema = z.object({
  ok: z.literal(true),
  when: z.string(),
  title: z.string(),
  eventId: z.string(),
  receiptId: z.string(),
});
export type BookingResult = z.infer<typeof bookingResultSchema>;

const pending = new Map<string, string>();

async function getVerifiedUserId(client: SupabaseClient | null): Promise<string> {
  if (!client) throw new Error("Client-success sign-in is required");
  const { data: auth, error: authError } = await client.auth.getSession();
  if (authError || !auth.session?.user?.id) {
    throw new Error("Client-success sign-in is required");
  }
  return auth.session.user.id;
}

async function verifySessionUnchanged(
  client: SupabaseClient | null,
  expectedUserId: string,
): Promise<void> {
  if (!client) throw new Error("Client-success sign-in is required");
  const { data: auth } = await client.auth.getSession();
  if (auth?.session?.user?.id !== expectedUserId) {
    throw new Error("User session changed; prior response discarded");
  }
}

export async function readTeamProjections(
  client: SupabaseClient | null,
  options: ProjectionOptions = {},
): Promise<ProjectionsPage> {
  const actorId = await getVerifiedUserId(client);
  if (!client) throw new Error("Client-success sign-in is required");

  const { data, error } = await client.rpc("cockpit_csm_projection_read", {
    p_for_email: options.forEmail ?? null,
    p_meeting_id: options.meetingId ?? null,
  });
  if (error) throw new Error(error.message);

  await verifySessionUnchanged(client, actorId);
  const parsed = projectionSourceSchema.parse(data);
  return buildProjections(parsed);
}

export async function editTeamProjections(
  client: SupabaseClient | null,
  args: TeamProjectionsEditArgs,
): Promise<ProjectionsPage> {
  const actorId = await getVerifiedUserId(client);
  if (!client) throw new Error("Client-success sign-in is required");

  const { error } = await client.rpc("cockpit_csm_projection_edit", {
    p_edit: args.edit,
    p_meeting_id: args.meetingId ?? null,
  });
  if (error) throw new Error(error.message);

  await verifySessionUnchanged(client, actorId);
  return readTeamProjections(client, {
    meetingId: args.meetingId,
    forEmail: args.forEmail,
  });
}

export async function bookTeamProjectionCall(
  client: SupabaseClient | null,
  args: BookingArgs,
): Promise<BookingResult> {
  const actorId = await getVerifiedUserId(client);
  if (!client) throw new Error("Client-success sign-in is required");

  const bookingArgs: BookingArgs = {
    taskId: args.taskId,
    day: args.day,
    time: args.time,
    minutes: args.minutes,
    meetingId: args.meetingId,
  };

  const key = `${actorId}:projections.bookCall:${JSON.stringify(bookingArgs)}`;
  const requestId = pending.get(key) ?? crypto.randomUUID();
  pending.set(key, requestId);

  const { data, error } = await client.functions.invoke("cockpit-csm-api", {
    body: {
      operation: "projections.bookCall",
      args: bookingArgs,
      requestId,
      apply: true,
    },
  });

  await verifySessionUnchanged(client, actorId);

  let body: unknown = data;
  if (error && "context" in error && error.context instanceof Response) {
    try {
      body = await error.context.json();
    } catch {
      // The HTTP message remains available.
    }
  }

  const failure = z
    .object({ error: z.string().optional(), ok: z.boolean().optional() })
    .safeParse(body);

  if (error || (failure.success && failure.data.ok === false)) {
    throw new Error(
      (failure.success ? failure.data.error : undefined) ??
        error?.message ??
        "The booking needs reconciliation; do not create another appointment.",
    );
  }

  const confirmed = bookingResultSchema.parse(body);
  pending.delete(key);
  return confirmed;
}
