import { createClient } from "@supabase/supabase-js";
import { supabaseEnvProblem } from "./env";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// The build already refuses these (vite.config.ts); this is for a dev server
// started without .env.local. The page prints the sentence (index.html).
const problem = supabaseEnvProblem(url, anon);
if (problem || !url || !anon) {
  throw new Error(`${problem} See .env.example.`);
}

/**
 * The anon key is public by design. Every sales table has row security on
 * and one policy, `cockpit_sales_seat()`, so a key on its own reads nothing:
 * the address on the signed-in session has to hold a seat. Nothing is ever
 * written from the browser; changes go through the sales-api function.
 */
export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const SUPABASE_URL = url;
export const PROPOSALS_BUCKET = "sales-proposals";
