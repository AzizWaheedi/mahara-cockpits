// fathom-webhook: Fathom's push of each finished Customer Success recording
// into the cockpit's call store (docs/forms/STAGE2-CONTRACT.md 4.4; README.md
// here). Deployed with verify_jwt OFF: Fathom sends no JWT and no custom
// header, so its signature is the only door (verify.ts), checked before the
// body is trusted. Secrets are read by name, never printed: SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY from the platform; the webhook's own secret comes
// from the vault through cockpit_forms_key_get, so this function needs no
// secret of its own.

import { makeHandler } from "./handler.ts";

Deno.serve(
  makeHandler({
    env: name => Deno.env.get(name) ?? "",
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    log: line => console.log(line),
  }),
);
