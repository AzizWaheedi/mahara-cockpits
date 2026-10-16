// The door of cockpit-board-api: POST {operation: "lever", args, requestId?,
// apply?} with the seat's own bearer token (the function is deployed with the
// JWT check ON). The seat's token reaches the gate in the database; the service
// key writes only the lever row and the ClickUp receipts.
import { type AdminClient, LeverAccessError, LeverInputError, runLever, type UserClient } from "./lever.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export type BoardDeps = {
  env: (name: string) => string | undefined;
  createClient: (url: string, key: string, options: Record<string, unknown>) => unknown;
  request?: typeof fetch;
};
type SignedIn = UserClient & {
  auth: { getUser: () => PromiseLike<{ data: { user: unknown } | null; error: unknown }> };
};

export async function serveBoard(req: Request, deps: BoardDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in first" }, 401);
  const url = deps.env("SUPABASE_URL");
  const anon = deps.env("SUPABASE_ANON_KEY");
  const service = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ error: "The board's function is missing its Supabase settings." }, 500);
  let input: { operation?: unknown } | null;
  try {
    input = await req.json();
  } catch {
    return json({ error: "Send the request as JSON." }, 400);
  }
  if (input?.operation !== "lever") return json({ error: "Unknown board operation" }, 400);
  const client = deps.createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  }) as SignedIn;
  const { data: user, error } = await client.auth.getUser();
  if (error || !user?.user) return json({ error: "Sign in first" }, 401);
  const admin = deps.createClient(url, service, { auth: { persistSession: false } }) as AdminClient;
  try {
    return json(await runLever(client, admin, input, deps.env, deps.request ?? fetch));
  } catch (e) {
    const message = e instanceof Error ? e.message : "The lever could not be filed.";
    return json({ error: message }, e instanceof LeverAccessError ? 403 : e instanceof LeverInputError ? 400 : 502);
  }
}
