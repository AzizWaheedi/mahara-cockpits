// cockpit-forms-api: the 1-1 notes window's server (docs/forms/STAGE2-CONTRACT.md
// section 6). Deployed with the JWT check ON. Env by name, all project-wide:
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and TYPEFORM_TOKEN.
// No new function secret: the Fathom, DeepSeek and Anthropic keys come from the
// vault through cockpit_forms_key_get on each call.
import { createClient } from "npm:@supabase/supabase-js@2";
import { RpcError, restRpc, type Rpc } from "../cockpit-hours-sync/db.ts";
import { makeDoor } from "./door.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } };
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const BUCKET = "csm-call-transcripts";

/** One row into a service-only table; a row that cannot be saved throws, so the call it belongs to never leaves. */
const insert = (table: string, what: string) => async (row: Record<string, unknown>) => {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`The ${what} receipt could not be saved, so the call was not made.`);
};

const seat = (authorization: string) =>
  createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });

Deno.serve(makeDoor({
  serviceKey,
  getUser: async authorization => {
    const { data, error } = await seat(authorization).auth.getUser();
    return error || !data.user ? null : { id: data.user.id, email: data.user.email ?? null };
  },
  rpc: restRpc(url, serviceKey),
  userRpc: (authorization): Rpc => {
    const client = seat(authorization);
    return async (name, args) => {
      const { data, error } = await client.rpc(name, args);
      if (error) throw new RpcError(String(error.message ?? "The database refused the request.").slice(0, 240), error.code ?? null);
      return data;
    };
  },
  health: insert("cockpit_csm_provider_health", "provider health"),
  keyChecks: insert("cockpit_forms_key_checks", "key check"),
  storage: {
    read: async path => {
      const { data, error } = await admin.storage.from(BUCKET).download(path);
      return error || !data ? null : await data.text();
    },
    sign: async (path, seconds) => {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, seconds);
      return error || !data?.signedUrl ? null : data.signedUrl;
    },
  },
  fetch,
  env: name => Deno.env.get(name),
  now: () => new Date(),
  waitUntil: work => {
    const background = runtime.EdgeRuntime?.waitUntil;
    if (background) background(work);
  },
  uuid: () => crypto.randomUUID(),
}));
