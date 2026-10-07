import { supabase } from "./supabase";

const sorted = (value: any): any =>
  value && typeof value === "object"
    ? Array.isArray(value)
      ? value.map(sorted)
      : Object.fromEntries(
          Object.keys(value)
            .sort()
            .filter(k => value[k] !== undefined)
            .map(k => [k, sorted(value[k])]),
        )
    : value;
const canonical = (value: any): string => JSON.stringify(sorted(value));
/** Invoke apply only from an explicit user action. Default calls only preview the change. */
export async function mediaAction(
  operation: string,
  args: Record<string, unknown>,
  options: { apply?: boolean; requestId?: string } = {},
) {
  const { data: auth, error: authError } = await supabase.auth.getUser();
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
  const key = `cockpit-provider-intent:${auth.user.id}:${hash}`;
  // Fail closed if durable browser storage is unavailable. A reload must not lose an ambiguous request.
  let requestId = options.requestId;
  if (options.apply === true) {
    requestId = localStorage.getItem(key) ?? requestId ?? crypto.randomUUID();
    localStorage.setItem(key, requestId);
  }
  const { data, error } = await supabase.functions.invoke("cockpit-media-api", {
    body: { operation, args, apply: options.apply === true, requestId },
  });
  if (error) {
    const response = (error as { context?: Response }).context;
    if (response) {
      let detail: any;
      try {
        detail = await response.json();
      } catch {
        /* Preserve transport message below. */
      }
      if (detail)
        throw new Error(
          `${detail.error ?? error.message}${detail.receiptId ? ` (receipt ${detail.receiptId})` : ""}`,
        );
    }
    throw new Error(error.message);
  }
  if (data?.ok === false && !data?.dryRun)
    throw new Error(
      `${data.error ?? "Provider action failed"}${data.receiptId ? ` (receipt ${data.receiptId})` : ""}`,
    );
  if (data?.ok === true) localStorage.removeItem(key);
  return data;
}
