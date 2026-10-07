import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type TeamPictureOperation =
  | "teamPictures.upload"
  | "teamPictures.ready"
  | "teamPictures.fromUrl";
export type TeamPictureUpload = { path: string; uploadUrl: string };
export type TeamPictureReady = { path: string; url: string };
const meetingId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/);
const inputs = {
  "teamPictures.upload": z.object({
    meetingId,
    contentType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
    bytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
  }),
  "teamPictures.ready": z.object({ meetingId, path: z.string().max(200) }),
  "teamPictures.fromUrl": z.object({
    meetingId,
    url: z.string().url().max(8192),
  }),
};
// Failed/unknown responses retain their ID. Repeating an in-flight call uses
// the same reservation; a confirmed new user action gets a new ID. Ownership
// changes discard old retry keys. Signed URLs are never cached here.
const retries = new WeakMap<
  SupabaseClient,
  { actor: string; ids: Map<string, string> }
>();

export async function teamPicturesAction(
  client: SupabaseClient,
  operation: TeamPictureOperation,
  args: Record<string, unknown>,
  requestId?: string,
): Promise<TeamPictureUpload | TeamPictureReady> {
  const parsed = inputs[operation].safeParse(args);
  if (!parsed.success)
    throw new Error(
      "Choose a valid meeting and a PNG, JPEG, GIF or WebP picture up to 10 MB.",
    );
  const { data: session, error: sessionError } = await client.auth.getSession();
  if (sessionError || !session.session)
    throw new Error("Sign in before adding a picture.");
  const actor = session.session.user.id;
  let pending = retries.get(client);
  if (!pending || pending.actor !== actor) {
    pending = { actor, ids: new Map() };
    retries.set(client, pending);
  }
  const key = `${operation}:${JSON.stringify(parsed.data)}`;
  const id = requestId ?? pending.ids.get(key) ?? crypto.randomUUID();
  if (!z.string().uuid().safeParse(id).success)
    throw new Error("A valid picture request ID is required.");
  pending.ids.set(key, id);
  const { data, error } = await client.functions.invoke("cockpit-team-api", {
    body: { operation, args: parsed.data, requestId: id },
  });
  const failure = z.object({ error: z.string() }).safeParse(data);
  if (error || failure.success) {
    let message = failure.success ? failure.data.error : undefined;
    if (
      !message &&
      error &&
      "context" in error &&
      error.context instanceof Response
    ) {
      try {
        const detail = z
          .object({ error: z.string() })
          .safeParse(await error.context.json());
        if (detail.success) message = detail.data.error;
      } catch {
        /* A transport failure has no server receipt; keep the request ID. */
      }
    }
    throw new Error(
      message ??
        "The picture operation was not confirmed. Retry the same picture.",
    );
  }
  const response =
    operation === "teamPictures.upload"
      ? z
          .object({ path: z.string(), uploadUrl: z.string().url() })
          .safeParse(data)
      : z.object({ path: z.string(), url: z.string().url() }).safeParse(data);
  if (
    !response.success ||
    response.data.path.split("/")[0] !== parsed.data.meetingId
  )
    throw new Error(
      "The server did not confirm this meeting’s picture. Retry the same picture.",
    );
  const current = await client.auth.getSession();
  if (current.error || current.data.session?.user.id !== actor) {
    retries.delete(client);
    throw new Error("Your signed-in account changed. Open this meeting again.");
  }
  if (pending.ids.get(key) === id) pending.ids.delete(key);
  return response.data;
}
