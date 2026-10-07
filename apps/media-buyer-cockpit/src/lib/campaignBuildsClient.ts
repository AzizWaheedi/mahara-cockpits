import type { SupabaseClient } from "@supabase/supabase-js";

const canonical = (value: any): string =>
  JSON.stringify(
    value && typeof value === "object"
      ? Array.isArray(value)
        ? value.map(v => JSON.parse(canonical(v)))
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .filter(k => value[k] !== undefined)
              .map(k => [k, JSON.parse(canonical(value[k]))]),
          )
      : (value ?? null),
  );
export async function campaignBuildAction(
  client: SupabaseClient,
  operation: string,
  args: Record<string, unknown>,
) {
  if (["buildsFor", "saveVariants", "discardBuild"].includes(operation)) {
    const { data, error } = await client.rpc("cockpit_build_action", {
      p_operation: {
        buildsFor: "list",
        saveVariants: "saveVariants",
        discardBuild: "discard",
      }[operation],
      p_args: args,
    });
    if (error) throw new Error(error.message);
    return data;
  }
  if (!["requestBuild", "launchBuild"].includes(operation))
    throw new Error("Unknown campaign draft operation");
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw new Error("Sign in again");
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical([operation, args])),
      ),
    ),
  )
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
  const key = `cockpit-build:${auth.user.id}:${hash}`;
  const requestId = localStorage.getItem(key) ?? crypto.randomUUID();
  localStorage.setItem(key, requestId);
  const { data, error } = await client.functions.invoke(
    "cockpit-creative-api",
    { body: { operation, args, apply: true, requestId } },
  );
  if (error) {
    const response = (error as { context?: Response }).context;
    let detail: any;
    try {
      detail = await response?.json();
    } catch {}
    throw new Error(detail?.error ?? error.message);
  }
  if (!data?.id || !["ready", "launched"].includes(data.status))
    throw new Error(data?.error ?? "The campaign draft was not confirmed.");
  localStorage.removeItem(key);
  return operation === "requestBuild" ? data.id : null;
}
