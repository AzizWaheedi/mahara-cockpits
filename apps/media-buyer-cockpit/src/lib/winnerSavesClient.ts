import type { SupabaseClient } from "@supabase/supabase-js";
export async function runWinnerSave(
  client: SupabaseClient,
  operation: string,
  args: Record<string, unknown> = {},
) {
  const calls: Record<string, [string, Record<string, unknown>]> = {
    preview: ["cockpit_winner_preview", { p_args: args }],
    save: ["cockpit_winner_save", { p_args: args }],
    unsave: ["cockpit_winner_unsave", { p_id: args.adId }],
    savedIn: ["cockpit_winner_saved_in", { p_ids: args.adIds ?? [] }],
  };
  const call = calls[operation];
  if (!call) throw new Error("Unknown saved-winner operation.");
  const { data, error } = await client.rpc(call[0], call[1]);
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object")
    throw new Error("The saved-winner operation was not confirmed.");
  return data;
}
