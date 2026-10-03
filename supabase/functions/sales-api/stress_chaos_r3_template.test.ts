// bun test supabase/functions/sales-api/stress_chaos_r3_template.test.ts
//
// Chaos round 3 (3 October 2026): index.ts sendTemplate, run end to end
// through the real handler (Deno.serve's function) with the outside world
// faked at fetch, as stress_numbers_sendtemplate.test.ts does. HighLevel
// fails at the step BEFORE the workflow enrolment (the contact field write:
// the signature, the line, the room code): nothing can have gone, so the
// send is a certain failure, never "it may have gone". A room's template
// that is wrongly "unclear" stops its link cascade for good ("Check the
// conversation before sending it again, or read it out"), and every re-ask
// gets the same unclear row back.
import { beforeAll, describe, expect, test } from "bun:test";
import { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const REP = "rep-r3@stress.invalid";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghlCalls: { method: string; path: string }[] = [];
/** HighLevel's answer to the contact field write (PUT /contacts/{id}). */
let fieldWrite = 200;
let handler: ((req: Request) => Promise<Response>) | undefined;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`))
    return reply({ signed_in: true, seat: true, manager: false, email: REP, name: "Rafi Rep", role: "setter", ghl_user_id: "G-rep" });
  if (url.startsWith(`${DB}/rest/v1/rpc/`)) {
    const fn = url.slice(`${DB}/rest/v1/rpc/`.length).split("?")[0] as string;
    try {
      return reply(await db.rpc(fn, init.body ? JSON.parse(String(init.body)) : {}));
    } catch (e) {
      return reply({ message: String((e as Error).message) }, (e as DbError).status ?? 500);
    }
  }
  if (url.startsWith(`${DB}/rest/v1/`)) {
    const path = url.slice(`${DB}/rest/v1/`.length);
    const headers = new Headers(init.headers as HeadersInit);
    const prefer = headers.get("prefer") ?? "";
    try {
      const rows = await db.db(path, { method, body: init.body ? JSON.parse(String(init.body)) : undefined, prefer });
      return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
    } catch (e) {
      const err = e as DbError;
      return reply({ code: err.code, message: err.message }, err.status ?? 500);
    }
  }
  if (url.startsWith(GHL)) {
    const path = url.slice(GHL.length);
    ghlCalls.push({ method, path });
    if (method === "GET" && path.startsWith("/contacts/")) {
      const id = decodeURIComponent(path.split("/")[2]?.split("?")[0] ?? "");
      return reply({ contact: { id, firstName: "Huda", phone: "+96550000000", tags: ["roas-qualified"], dnd: false, dndSettings: {} } });
    }
    if (method === "PUT" && path.startsWith("/contacts/")) {
      return fieldWrite === 200 ? reply({ ok: true }) : reply({ message: "Service Unavailable" }, fieldWrite);
    }
    if (method === "GET" && path.startsWith("/conversations/search")) return reply({ conversations: [] });
    return reply({ ok: true });
  }
  throw new Error(`no fake for ${method} ${url}`);
}

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: DB,
    SUPABASE_SERVICE_ROLE_KEY: "service-stress",
    SUPABASE_ANON_KEY: "anon-stress",
    SALES_GHL_TOKEN: "ghl-stress",
  };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  // A module instance of its own (the query), so another test file that imported
  // index.ts first in the same bun process never hands this file its handler.
  await import("./index.ts?chaos-r3");
});

function reset(): void {
  db.tables = {};
  ghlCalls.length = 0;
  fieldWrite = 200;
  db.seed("cockpit_sales_settings", [
    { key: "messaging", value: { whatsapp: true, email: true } },
    { key: "whatsapp_guard", value: { templates_per_day: 250, template_budget_usd_month: 100 } },
    { key: "wa_fields", value: { rep: { id: "f-rep" }, line: { id: "f-line" } } },
  ]);
  db.seed("cockpit_sales_wa_templates", [
    { key: "stress_r3_en", name: "cockpit_stress_r3_en", language: "en", preview: "Hi {{1}}, it's {{2}} from Mahara Media.", variables: ["first_name", "rep_name"], workflow_id: "wf-stress-r3", active: true },
  ]);
  db.seed("cockpit_sales_people", [{ email: REP, name: "Rafi Rep", ghl_user_id: "G-rep", active: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: "stress-chaos-r3-tpl-1", name: "Huda Ali" }]);
}

async function send(contactId: string, requestId: string): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts was imported by another test file in this process: run this file on its own");
  const res = await handler(
    new Request("https://fn.stress.invalid/sales-api", {
      method: "POST",
      headers: { authorization: "Bearer a-seat-session", "content-type": "application/json" },
      body: JSON.stringify({ action: "wa.template.send", contact_id: contactId, template_key: "stress_r3_en", request_id: requestId }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const enrolled = () => ghlCalls.filter(c => c.method === "POST" && c.path.includes("/workflow/")).length;

describe("chaos r3: sendTemplate when HighLevel fails before the enrolment", () => {
  test("HELD: the harness sends one template end to end", async () => {
    reset();
    const out = await send("stress-chaos-r3-tpl-1", crypto.randomUUID());
    expect(out.status).toBe(200);
    expect(enrolled()).toBe(1);
  }, 60_000);

  test("HighLevel answers 503 to the contact field write, so the workflow is never asked: the send is a certain failure, never 'it may have gone'", async () => {
    reset();
    fieldWrite = 503;
    const out = await send("stress-chaos-r3-tpl-1", crypto.randomUUID());
    expect(enrolled()).toBe(0);
    const row = db.t("cockpit_sales_messages")[0] as Row;
    // unclearError reads any 5xx as "may have gone", wherever it came from:
    // the row says unclear, the answer carries unclear: true, and a room's
    // link cascade stops on it for good.
    expect(row.state).toBe("failed");
    expect(out.body.unclear ?? false).toBe(false);
  }, 60_000);
});
