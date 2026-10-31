// bun test supabase/functions/sales-api/wa_direct_template.test.ts
//
// A WhatsApp template marked direct goes straight through HighLevel's
// POST /conversations/messages (tested 2026-10-31): no contact field write and
// no workflow enrolment. Run end to end through the real handler with the
// outside world faked at fetch: PostgREST is testfakes.ts FakeDb behind the
// same URLs, and HighLevel answers the contact, the conversations send and an
// empty read-back. Nothing leaves this process.
import { beforeAll, describe, expect, test } from "bun:test";
import { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.direct.invalid";
const GHL = "https://services.leadconnectorhq.com";
const REP = "rep@direct.invalid";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghlCalls: { method: string; path: string; body: Row | null }[] = [];
/** The status HighLevel answers the conversations send with. */
let sendStatus = 201;
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
    ghlCalls.push({ method, path, body: init.body ? (JSON.parse(String(init.body)) as Row) : null });
    if (method === "GET" && path.startsWith("/contacts/")) {
      const id = decodeURIComponent(path.split("/")[2]?.split("?")[0] ?? "");
      return reply({ contact: { id, firstName: "Huda", phone: "+96550000000", tags: ["roas-qualified"], dnd: false, dndSettings: {} } });
    }
    if (method === "GET" && path.startsWith("/conversations/search")) return reply({ conversations: [] });
    if (method === "POST" && path === "/conversations/messages")
      return sendStatus === 201 ? reply({ conversationId: "conv-1", messageId: "msg-1" }, 201) : reply({ message: "Service Unavailable" }, sendStatus);
    return reply({ ok: true });
  }
  throw new Error(`no fake for ${method} ${url}`);
}

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: DB,
    SUPABASE_SERVICE_ROLE_KEY: "service-direct",
    SUPABASE_ANON_KEY: "anon-direct",
    SALES_GHL_TOKEN: "ghl-direct",
  };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

const DIRECT = {
  key: "new_lead_2",
  name: "new_lead_2",
  language: "ar",
  preview: "اهلا {{1}}، تواصلت معنا",
  variables: ["first_name"],
  workflow_id: null,
  active: true,
  direct: true,
};

function reset(over: Row = {}): void {
  db.tables = {};
  ghlCalls.length = 0;
  sendStatus = 201;
  db.seed("cockpit_sales_settings", [
    { key: "messaging", value: { whatsapp: true, email: true } },
    { key: "whatsapp_guard", value: { templates_per_day: 250, template_budget_usd_month: 100 } },
    { key: "wa_fields", value: { rep: { id: "f-rep" }, line: { id: "f-line" } } },
  ]);
  db.seed("cockpit_sales_wa_templates", [
    { ...DIRECT, ...over },
    { key: "flow_en", name: "cockpit_flow_en", language: "en", preview: "Hi {{1}}, it's {{2}} from Mahara Media.", variables: ["first_name", "rep_name"], workflow_id: "wf-flow", active: true, direct: false },
  ]);
  db.seed("cockpit_sales_people", [{ email: REP, name: "Rafi Rep", ghl_user_id: "G-rep", active: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: "direct-lead-1", name: "Huda Lead" }]);
}

async function send(key: string): Promise<{ status: number; body: Row }> {
  const res = await (handler as (req: Request) => Promise<Response>)(
    new Request("https://fn.direct.invalid/sales-api", {
      method: "POST",
      headers: { authorization: "Bearer a-seat-session", "content-type": "application/json" },
      body: JSON.stringify({ action: "wa.template.send", contact_id: "direct-lead-1", template_key: key, request_id: crypto.randomUUID() }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const sends = () => ghlCalls.filter(c => c.method === "POST" && c.path === "/conversations/messages");
const writes = () => ghlCalls.filter(c => c.method === "PUT" && c.path.startsWith("/contacts/"));
const enrolments = () => ghlCalls.filter(c => c.method === "POST" && c.path.includes("/workflow/"));

describe("a template marked direct is sent through the conversations API (index.ts sendTemplateOnce)", () => {
  test("one POST /conversations/messages with the template's name, language, values and text; no field write, no workflow", async () => {
    reset();
    const out = await send("new_lead_2");
    expect(out.status).toBe(200);
    expect(sends()).toHaveLength(1);
    expect(sends()[0]?.body).toEqual({
      type: "WhatsApp",
      contactId: "direct-lead-1",
      message: "اهلا Huda، تواصلت معنا",
      whatsapp: { type: "template", template: { name: "new_lead_2", lang: "ar" }, placeholders: { body: ["Huda"] } },
    });
    expect(writes()).toHaveLength(0);
    expect(enrolments()).toHaveLength(0);
    const row = db.t("cockpit_sales_messages")[0] as Row;
    expect({ via: row.via, workflow_id: row.workflow_id, template_key: row.template_key, ghl_message_id: row.ghl_message_id }).toEqual({
      via: "workflow",
      workflow_id: null,
      template_key: "new_lead_2",
      ghl_message_id: "msg-1",
    });
  }, 60_000);

  test("a direct template with a button is refused as a setup fault and nothing is sent", async () => {
    reset({ button_variable: "join_code" });
    const out = await send("new_lead_2");
    expect(out.body.code).toBe("setup");
    expect(out.status).toBe(409);
    expect(sends()).toHaveLength(0);
    expect(db.t("cockpit_sales_messages")).toHaveLength(0);
  }, 60_000);

  test("active with no workflow and not direct is refused as not set up", async () => {
    reset({ direct: false });
    const out = await send("new_lead_2");
    expect(out.body.code).toBe("setup");
    expect(out.status).toBe(409);
    expect(String(out.body.error)).toContain("not set up");
    expect(sends()).toHaveLength(0);
  }, 60_000);

  test("a workflow template still writes the fields and enrols, with no conversations send", async () => {
    reset();
    const out = await send("flow_en");
    expect(out.status).toBe(200);
    expect(writes()).toHaveLength(1);
    expect(enrolments()).toHaveLength(1);
    expect(sends()).toHaveLength(0);
  }, 60_000);

  test("HighLevel answering the send with 503 leaves the row unclear, not failed", async () => {
    reset();
    sendStatus = 503;
    const out = await send("new_lead_2");
    expect(out.status).toBe(502);
    expect(sends()).toHaveLength(1);
    expect((db.t("cockpit_sales_messages")[0] as Row).state).toBe("unclear");
  }, 60_000);
});
