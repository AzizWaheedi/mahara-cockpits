import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The CEO Hiring tab's actions, served by the Supabase Edge Function
 * hiring-api (it replaced Convex hiring.actions on 2026-10-09).
 *
 * The function checks the signed-in user is the CEO and writes the audit
 * row. A dry run (HIRING_APPLY off on the server) comes back as an error
 * sentence, so the tab never says "Saved" for a change that was not made.
 */
export const HIRING_ACTIONS = [
  "refreshNow",
  "grade",
  "reassign",
  "setEngine",
  "drafts",
  "sendDraft",
] as const;
export type HiringAction = (typeof HIRING_ACTIONS)[number];

export const isHiringAction = (name: string): name is HiringAction =>
  (HIRING_ACTIONS as readonly string[]).includes(name);

export async function hiringAction(
  client: SupabaseClient,
  action: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  if (!isHiringAction(action))
    throw new Error(`There is no hiring operation called ${action}.`);
  const { data, error } = await client.functions.invoke("hiring-api", {
    body: { operation: action, args: args ?? {} },
  });
  if (error) {
    let detail: string | undefined;
    const response = (error as { context?: Response }).context;
    if (response && typeof response.json === "function") {
      try {
        detail = (await response.json())?.error;
      } catch {
        // Keep the transport message below.
      }
    }
    throw new Error(
      detail ?? error.message ?? "The hiring operation was not confirmed.",
    );
  }
  if (data?.dryRun === true)
    throw new Error(String(data.message ?? "Dry run: nothing was changed."));
  if (data?.ok !== true)
    throw new Error(
      String(data?.error ?? "The hiring operation was not confirmed."),
    );
  return data.result;
}
