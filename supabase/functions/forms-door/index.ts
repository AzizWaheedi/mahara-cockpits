// forms-door: Typeform's push of each kickoff response into the forms tables
// (docs/forms/STAGE2B-CONTRACT.md 4.8; README.md here). Deployed with
// verify_jwt OFF: Typeform sends no JWT, so its signature is the only door,
// checked before anything of the body is parsed. Secrets are read by name,
// never printed: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the platform;
// the signing key comes from the vault through cockpit_forms_key_get, so this
// function needs no secret of its own.

import { makeHandler } from "./handler.ts";

Deno.serve(
  makeHandler({
    env: name => Deno.env.get(name) ?? "",
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    log: line => console.log(line),
  }),
);
