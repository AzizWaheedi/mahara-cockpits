import type { SupabaseClient } from "@supabase/supabase-js";
import { getCockpitSupabaseClient } from "../auth/SupabaseAuthProvider";
import { isMetaPreviewUrl, type PreviewResult } from "./metaMedia";

export type NativePreviewArgs = {
  adId: string;
  campaignName?: string;
  clientName?: string;
};
export async function nativeAdPreview(
  args: NativePreviewArgs,
  expectedActor: string | undefined,
  client: SupabaseClient = getCockpitSupabaseClient(),
): Promise<PreviewResult> {
  if (!expectedActor) throw new Error("Sign in before opening a live preview.");
  const { data: actor, error: authError } = await client.auth.getUser();
  if (
    authError ||
    actor.user?.id !== expectedActor ||
    !actor.user.email_confirmed_at
  )
    throw new Error("A confirmed sign-in is required. Reload the cockpit.");
  let changed = false;
  const subscription = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== expectedActor) changed = true;
  }).data.subscription;
  const check = async () => {
    const { data, error } = await client.auth.getSession();
    if (changed || error || data.session?.user.id !== expectedActor)
      throw new Error("The account changed. The prior preview was discarded.");
  };
  try {
    await check();
    const { data, error } = await client.functions.invoke("cockpit-media-api", {
      body: { operation: "previews.fresh", args: { adId: args.adId } },
    });
    await check();
    if (error) {
      const response = "context" in error ? error.context : null;
      const body: unknown =
        response instanceof Response
          ? await response
              .clone()
              .json()
              .catch(() => null)
          : null;
      const message =
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : error.message;
      throw new Error(
        message || "The native preview could not be read. Try again.",
      );
    }
    if (
      !data ||
      typeof data !== "object" ||
      typeof data.ok !== "boolean" ||
      data.adId !== args.adId
    )
      throw new Error("The native preview response did not match this ad.");
    if (
      data.ok &&
      (!isMetaPreviewUrl(data.src) ||
        typeof data.fetchedAt !== "number" ||
        typeof data.expiresAt !== "number")
    )
      throw new Error("Meta returned no confirmed live preview link.");
    return data as PreviewResult;
  } finally {
    subscription.unsubscribe();
  }
}
