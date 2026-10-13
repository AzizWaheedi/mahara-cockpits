// cockpit-call-recording: plays one call centre call to the CEO, client
// success or a media buyer, for a client on their seat. Deploy with the JWT
// check ON (read verify_jwt back as true). Needs the project secrets
// SALES_MAQSAM_ACCESS_KEY and SALES_MAQSAM_SECRET (already set for
// sales-api) and migration 20261013180000_cockpit_client_calls.sql applied.
// Bundle: this folder only (handler.ts, tools.ts).
import { createClient } from "npm:@supabase/supabase-js@2";
import { makeRecordingApi } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

Deno.serve(
  makeRecordingApi({
    userRpc: async (jwt, fn, args) => {
      const seat = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      });
      const { data, error } = await seat.rpc(fn, args);
      return {
        data,
        error: error ? { message: error.message, code: error.code } : null,
      };
    },
    health: async row => {
      const { error } = await admin
        .from("cockpit_csm_provider_health")
        .insert(row);
      if (error) throw new Error("Could not save provider health receipt");
    },
    env: name => Deno.env.get(name),
    fetch,
  }),
);
