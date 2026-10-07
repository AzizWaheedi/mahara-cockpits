import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const nativeUrl = z
  .string()
  .regex(
    /^https:\/\/bldgtotkfmhoxmlzowdx\.supabase\.co\/storage\/v1\/object\/public\/cockpit-ad-stills\/(?:[a-f0-9]{64}\/)?[a-f0-9]{64}$/,
  );
const itemSchema = z
  .object({
    key: z.string().min(1),
    url: nativeUrl.nullable(),
    tinyUrl: nativeUrl.nullable(),
    missing: z.boolean(),
    error: z.string().nullable(),
  })
  .strict();
const responseSchema = z
  .object({ ok: z.literal(true), stills: z.array(itemSchema).max(200) })
  .strict();
export type NativeStill = {
  url?: string;
  tinyUrl?: string;
  error?: string;
  missing?: boolean;
};

export async function nativeStillsRead(
  client: SupabaseClient,
  keys: readonly string[],
): Promise<Record<string, NativeStill>> {
  const requested = Array.from(new Set(keys));
  if (requested.length > 2000)
    throw new Error("Choose at most 2,000 saved images in one view.");
  if (requested.length === 0) return {};
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new Error("Sign in again before loading saved images.");
  const actor = data.user.id;
  let changed = false;
  const subscription = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== actor) changed = true;
  }).data.subscription;
  const check = async () => {
    const current = await client.auth.getSession();
    if (changed || current.error || current.data.session?.user.id !== actor)
      throw new Error("The signed-in account changed. Reload saved images.");
  };
  try {
    const result: Record<string, NativeStill> = {};
    for (let offset = 0; offset < requested.length; offset += 200) {
      const batch = requested.slice(offset, offset + 200);
      await check();
      const response = await client.rpc("cockpit_native_stills_read", {
        p_keys: batch,
      });
      await check();
      if (response.error) throw new Error(response.error.message);
      const parsed = responseSchema.parse(response.data),
        expected = new Set(batch);
      for (const item of parsed.stills) {
        if (!expected.delete(item.key))
          throw new Error(
            "The saved-image response contains an unexpected or repeated image.",
          );
        if (item.error && (item.url || item.tinyUrl))
          throw new Error(
            "The saved-image response combines a denial with an image.",
          );
        result[item.key] = {
          ...(item.url ? { url: item.url } : {}),
          ...(item.tinyUrl ? { tinyUrl: item.tinyUrl } : {}),
          ...(item.error ? { error: item.error } : {}),
          missing: item.missing,
        };
      }
      if (expected.size)
        throw new Error(
          "The saved-image response is incomplete. Reload the view.",
        );
    }
    return result;
  } finally {
    subscription.unsubscribe();
  }
}
