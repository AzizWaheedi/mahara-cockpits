// cockpit-board-api: the Client Performance board's one write that leaves
// Supabase, a lever filed as a ClickUp task (lever.ts). The board's reads and
// its targets are database functions the browser calls directly
// (supabase/migrations/20261016133300_board_api.sql).
//
// Deploy with the JWT check ON and the files it imports from cockpit-csm-api:
//   python3 scripts/dev/deploy_composio.py cockpit-board-api --verify-jwt on \
//     --extra supabase/functions/cockpit-csm-api/core.ts supabase/functions/cockpit-csm-api/tools.ts
// Secrets by name: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// CLICKUP_API_TOKEN. Nothing here logs a key.
import { createClient } from "npm:@supabase/supabase-js@2";
import { serveBoard } from "./handler.ts";

Deno.serve(req =>
  serveBoard(req, {
    env: name => Deno.env.get(name),
    createClient: (url, key, options) => createClient(url, key, options),
  }),
);
