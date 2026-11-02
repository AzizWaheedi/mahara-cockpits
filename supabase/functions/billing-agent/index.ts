// billing-agent: the billing agent's own door into the cockpit
// (docs/forms/WAVE56-CONTRACT.md 3.4, AG). Deployed with the JWT check OFF:
// the agent sends its own key (Authorization: Bearer mak_...), whose sha256
// alone is stored in cockpit_agent_keys; with no key there (the state at
// deploy) every call is refused "This key is not known." The service key is
// read by name here and never leaves this function; the agent never holds it
// for these writes. Every call is receipted in cockpit_csm_provider_health as
// billing-agent:<op>. See door.ts for the bodies and answers.
import { restRpc } from "../cockpit-hours-sync/db.ts";
import { type HealthRow, makeAgentDoor, sha256Hex } from "./door.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const url = env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");

/** Receipts through PostgREST with the service key (as cockpit-notices' restHealth). */
async function insertHealth(row: HealthRow): Promise<void> {
  const res = await fetch(`${url}/rest/v1/cockpit_csm_provider_health`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error("The billing agent's receipt could not be saved.");
}

Deno.serve(makeAgentDoor({
  rpc: restRpc(url, serviceKey),
  insertHealth,
  sha256Hex,
  uuid: () => crypto.randomUUID(),
}));
