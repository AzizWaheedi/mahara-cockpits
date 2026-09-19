import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anon) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set. See .env.example.");
}

/**
 * The anon key is public by design. Every editor table has row security on and
 * a single policy that calls `is_editor()`, so a key on its own reads nothing:
 * the address on the signed-in session has to be on `editor_people`.
 */
export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const STILLS_BUCKET = "editor-stills";
/** The ideation radar keeps its frames in its own bucket. */
export const IDEA_STILLS_BUCKET = "ideation-stills";
