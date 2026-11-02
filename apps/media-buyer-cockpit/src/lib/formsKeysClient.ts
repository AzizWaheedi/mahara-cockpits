import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * The keys the 1-1 notes use, for the CEO's "Connections for 1-1 notes"
 * card (docs/forms/STAGE2-CONTRACT.md 2.2 and 6.7). The status comes from
 * cockpit_forms_keys_status (the CEO only); a pasted key goes to
 * cockpit-forms-api `keys.save`, which checks it with the provider before it
 * replaces the old one and keeps it in the vault. Neither call ever answers
 * with a key: only its last four characters come back. Both answers are
 * parsed before the card reads them.
 */

export type FormsKeyProvider = "fathom" | "deepseek" | "anthropic";

const nul = <T extends z.ZodType>(t: T) =>
  t.nullish().transform(v => (v ?? null) as z.output<T> | null);

const keyRow = z.object({
  provider: z.enum(["fathom", "fathom_webhook", "deepseek", "anthropic"]),
  label: z.string(),
  connected: z.boolean(),
  state: z.enum(["connected", "unchecked", "refused", "missing"]),
  last4: nul(z.string()),
  savedAt: nul(z.string()),
  savedBy: nul(z.string()),
  checkedAt: nul(z.string()),
  sentence: z.string(),
});
export type FormsKeyRow = z.output<typeof keyRow>;

const statusShape = z.object({
  keys: z.array(keyRow),
  webhook: z.object({
    registered: z.boolean(),
    triggeredFor: nul(z.array(z.string())),
    lastDeliveryAt: nul(z.string()),
    stored24h: z.number().default(0),
    ignored24h: z.number().default(0),
    failed24h: z.number().default(0),
  }),
  pull: z.object({
    lastRunAt: nul(z.string()),
    ok: nul(z.boolean()),
    note: nul(z.string()),
  }),
  now: z.string(),
});
export type FormsKeysStatus = z.output<typeof statusShape>;

const saveShape = z.object({
  ok: z.boolean(),
  state: z.string(),
  text: z.string(),
  last4: nul(z.string()),
});
export type FormsKeySaved = z.output<typeof saveShape>;

const NOT_LIVE = "The 1-1 notes connections are not live yet.";
const notLive = (s: string) =>
  /could not find the function|PGRST202|requested function was not found|NOT_FOUND/i.test(
    s,
  );

async function signedIn(client: SupabaseClient | null) {
  if (!client) throw new Error("Sign in to the cockpit first.");
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Sign in to the cockpit first.");
  return data.user.id;
}

/** cockpit_forms_keys_status: every key's state, the webhook and the pull. */
export async function readFormsKeys(
  client: SupabaseClient | null,
): Promise<FormsKeysStatus> {
  await signedIn(client);
  const { data, error } = await (client as SupabaseClient).rpc(
    "cockpit_forms_keys_status",
  );
  if (error) {
    const said = `${error.message} ${(error as { code?: string }).code ?? ""}`;
    throw new Error(notLive(said) ? NOT_LIVE : error.message);
  }
  const parsed = statusShape.safeParse(data);
  if (!parsed.success)
    throw new Error("the answer came back in a shape this card does not read");
  return parsed.data;
}

/**
 * cockpit-forms-api `keys.save`: the server checks the pasted key with the
 * provider before it keeps it. The key is sent once and never returned.
 */
export async function saveFormsKey(
  client: SupabaseClient | null,
  provider: FormsKeyProvider,
  key: string,
): Promise<FormsKeySaved> {
  const uid = await signedIn(client);
  const c = client as SupabaseClient;
  const { data, error } = await c.functions.invoke("cockpit-forms-api", {
    body: { op: "keys.save", provider, key },
  });
  const current = await c.auth.getSession();
  if (current.error || current.data.session?.user.id !== uid)
    throw new Error("The signed-in account changed. Reload the page.");
  let answer: unknown = data;
  if (error && "context" in error && error.context instanceof Response)
    answer = await error.context
      .clone()
      .json()
      .catch(() => null);
  const said = z.object({ error: z.string() }).safeParse(answer);
  if (said.success) throw new Error(said.data.error);
  if (error) {
    const raw = answer as { message?: string; code?: string } | null;
    throw new Error(
      notLive(`${raw?.message ?? ""} ${raw?.code ?? ""}`)
        ? NOT_LIVE
        : "The key could not be checked just now. Nothing was changed.",
    );
  }
  const parsed = saveShape.safeParse(answer);
  if (!parsed.success)
    throw new Error("The server did not confirm the key. Read the card again.");
  return parsed.data;
}
