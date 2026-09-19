import { adAsIdea } from "./adAsIdea";
import { boom, who } from "./ideation";
import { supabase } from "./supabase";

/**
 * The swipe file's verbs, for a cockpit with no backend.
 *
 * The same three functions the other two cockpits call as Convex actions in
 * `convex/foreplay.ts`, against the same tables, so the page above them is
 * the same file in all three. Row security does here what the service key
 * bypassed there: `foreplay_ads` and `foreplay_boards` are readable by
 * `is_editor()`, and writing an ideation post uses the policies added in
 * `supabase/migrations/20260919c_ideation_for_editors.sql`.
 */
// biome-ignore lint/suspicious/noExplicitAny: Supabase rows are untyped here
type Row = Record<string, any>;

/** Saved ads, longest on air first: the strongest single signal one works. */
async function ads({ limit }: { limit?: number } = {}) {
  const n = Math.max(1, Math.min(500, limit ?? 300));
  const { data, error } = await supabase
    .from("foreplay_ads")
    .select("*")
    .order("running_duration", { ascending: false, nullsFirst: false })
    .limit(n);
  boom(error);
  return data ?? [];
}

/**
 * Every board, including one nobody has saved to yet -- read from the board
 * table rather than counted off the ads, because a board somebody just made
 * still has to appear.
 */
async function boards(_args: Record<string, never> = {}) {
  const { data, error } = await supabase
    .from("foreplay_boards")
    .select("*")
    .order("name")
    .limit(200);
  boom(error);
  return data ?? [];
}

/**
 * Put a saved ad on the ideation board.
 *
 * The same row the worker writes when an ad lands in the Foreplay drop box,
 * so an ad forwarded by hand and one forwarded automatically are the same
 * thing on the board. The key is the ad's own id, so pressing twice updates
 * rather than duplicating.
 */
async function toIdeation({ id }: { id: string }) {
  const { email, name } = await who();
  const { data, error: read } = await supabase
    .from("foreplay_ads")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  boom(read);
  const ad = data as Row | null;
  if (!ad) throw new Error("That ad is no longer in the swipe file.");
  const { error } = await supabase
    .from("ideation_posts")
    .upsert(adAsIdea(ad, { by: email, byName: name }), {
      onConflict: "key",
    });
  boom(error);
  return { key: `foreplay:${ad.id}` };
}

export const api = { foreplay: { ads, boards, toIdeation } };

/** Convex's hook, minus Convex. See the note on the one in `ideation.ts`. */
export function useAction<T>(fn: T): T {
  return fn;
}
