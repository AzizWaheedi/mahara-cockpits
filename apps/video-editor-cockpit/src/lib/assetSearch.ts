import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asset } from "./types";

export type SearchAsset = Pick<
  Asset,
  "id" | "task_id" | "name" | "transcript" | "error"
>;

/** Global search must include older clips, not just the gallery's newest page. */
export async function readSearchAssets(client: SupabaseClient): Promise<{
  data: SearchAsset[] | null;
  error: { message: string } | null;
}> {
  const assets: SearchAsset[] = [];
  for (;;) {
    const { data, error } = await client
      .from("editor_assets")
      .select("id,task_id,name,transcript,error")
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .range(assets.length, assets.length + 299);
    if (error) return { data: null, error };
    if (!data)
      return {
        data: null,
        error: {
          message:
            "The asset search returned no data. Close search and reopen it to try again.",
        },
      };
    if (data.length === 0) return { data: assets, error: null };
    assets.push(...data);
  }
}
