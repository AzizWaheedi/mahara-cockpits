import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_PATH = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/i;

export async function readClientLogos(client: SupabaseClient): Promise<{clientKey: string; url: string}[]> {
  const { data, error } = await client.rpc("cockpit_get_client_logos");
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("The client logo source did not return its verified records.");
  return data.map((row: {client_key: string; storage_path: string}) => {
    if (typeof row.client_key !== "string" || !STORAGE_PATH.test(row.storage_path)) {
      throw new Error("A verified client logo has an invalid image path.");
    }
    return {
      clientKey: row.client_key.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""),
      url: client.storage.from("cockpit-client-logos").getPublicUrl(row.storage_path).data.publicUrl,
    };
  });
}
