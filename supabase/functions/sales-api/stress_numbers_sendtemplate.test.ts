// bun test supabase/functions/sales-api/stress_numbers_sendtemplate.test.ts
//
// Stress round 1, numbers and data integrity: the send ceilings in index.ts
// sendTemplate, run end to end through the real handler (Deno.serve's
// function) with the outside world faked at fetch: PostgREST is testfakes.ts
// FakeDb behind the same URLs, answering at most 1,000 rows a request as
// Creative Triage does (postgrest max_rows = 1000, read 2026-10-03), and
// HighLevel answers the contact, the field write, the workflow enrolment and
// an empty read-back. Nothing leaves this process.
//
// The ceilings: 30 messages in ten minutes per sender, one template per lead
// every two minutes, whatsapp_guard.templates_per_day (250) a Kuwait day, and
// the month's budget (D18, $100 at $0.0792 a template). A ceiling holds only
// if a burst of sends at once cannot pass it. A test that fails here is a
// finding, kept as a regression test for its fix.
import { beforeAll, describe, expect, test } from "bun:test";
import { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const REP = "rep@stress.invalid";
const MAX_ROWS = 1000;
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghlCalls: { method: string; path: string }[] = [];
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
      let rows = await db.db(path, { method, body: init.body ? JSON.parse(String(init.body)) : undefined, prefer });
      if (method === "GET") rows = rows.slice(0, MAX_ROWS); // PostgREST max_rows
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
      // index.ts registers its handler once per process: a second test file
      // that imports it (cached) takes the same handler from here.
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

function reset(): void {
  db.tables = {};
  ghlCalls.length = 0;
  db.seed("cockpit_sales_settings", [
    { key: "messaging", value: { whatsapp: true, email: true } },
    { key: "whatsapp_guard", value: { templates_per_day: 250, template_budget_usd_month: 100 } },
    { key: "wa_fields", value: { rep: { id: "f-rep" }, line: { id: "f-line" } } },
  ]);
  db.seed("cockpit_sales_wa_templates", [
    { key: "stress_en", name: "cockpit_stress_en", language: "en", preview: "Hi {{1}}, it's {{2}} from Mahara Media.", variables: ["first_name", "rep_name"], workflow_id: "wf-stress", active: true },
  ]);
  db.seed("cockpit_sales_people", [{ email: REP, name: "Rafi Rep", ghl_user_id: "G-rep", active: true }]);
}

function lead(i: number): string {
  const id = `stress-ceiling-${String(i).padStart(4, "0")}`;
  if (!db.t("cockpit_sales_leads").some(l => l.contact_id === id)) db.seed("cockpit_sales_leads", [{ contact_id: id, name: `Lead ${i}` }]);
  return id;
}

function seedMessages(n: number, at: (i: number) => string, over: Row = {}): void {
  db.seed(
    "cockpit_sales_messages",
    Array.from({ length: n }, (_, i) => ({
      request_id: crypto.randomUUID(),
      contact_id: `stress-old-${i}`,
      channel: "whatsapp",
      via: "workflow",
      body: "An earlier template.",
      source: "rep",
      sent_by: "someone-else@stress.invalid",
      state: "sent",
      created_at: at(i),
      ...over,
    })),
  );
}

async function send(contactId: string): Promise<{ status: number; body: Row }> {
  const res = await (handler as (req: Request) => Promise<Response>)(
    new Request("https://fn.stress.invalid/sales-api", {
      method: "POST",
      headers: { authorization: "Bearer a-seat-session", "content-type": "application/json" },
      body: JSON.stringify({ action: "wa.template.send", contact_id: contactId, template_key: "stress_en", request_id: crypto.randomUUID() }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const enrolled = () => ghlCalls.filter(c => c.method === "POST" && c.path.includes("/workflow/")).length;

// ---------------------------------------------------------------------------

describe("the send ceilings hold under a burst (index.ts sendTemplate)", () => {
  test("the harness sends one template end to end", async () => {
    reset();
    const out = await send(lead(1));
    expect(out.status).toBe(200);
    expect(enrolled()).toBe(1);
  }, 60_000);

  test("30 messages in ten minutes per sender: 25 sent, then 15 at once, at most 5 more go", async () => {
    reset();
    seedMessages(25, () => new Date(Date.now() - 60_000).toISOString(), { sent_by: REP, via: "conversation", channel: "email" });
    const out = await Promise.all(Array.from({ length: 15 }, (_, i) => send(lead(100 + i))));
    const mine = db.t("cockpit_sales_messages").filter(m => m.sent_by === REP).length;
    expect({ sent_in_ten_minutes: mine, refused: out.filter(o => o.status === 429).length }).toEqual({ sent_in_ten_minutes: 30, refused: 10 });
  }, 60_000);

  test("one template per lead every two minutes: five presses at once on one lead enrol it once", async () => {
    reset();
    const c = lead(200);
    await Promise.all(Array.from({ length: 5 }, () => send(c)));
    // A second enrolment within two minutes overwrites the first one's line, signature or room code.
    expect(enrolled()).toBe(1);
  }, 60_000);

  test("templates_per_day: 249 went today, then 10 at once, the day ends at 250", async () => {
    reset();
    seedMessages(249, i => new Date(Date.now() - 30 * 60_000 + i * 1000).toISOString());
    await Promise.all(Array.from({ length: 10 }, (_, i) => send(lead(300 + i))));
    const today = db.t("cockpit_sales_messages").filter(m => m.via === "workflow" && m.state !== "failed").length;
    expect(today).toBeLessThanOrEqual(250);
  }, 60_000);

  test("the month's budget: 1,263 templates this month ($100.03) and the next one is refused", async () => {
    reset();
    const now = Date.now();
    // This Kuwait month, before today's Kuwait midnight (so the daily ceiling is not what refuses it).
    const k = new Date(now + 3 * 3_600_000);
    const monthStart = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - 3 * 3_600_000;
    const todayStart = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 3 * 3_600_000;
    if (todayStart - monthStart < 3_600_000) return; // the 1st of the month: nothing earlier this month to seed
    const span = todayStart - monthStart - 60_000;
    seedMessages(1263, i => new Date(monthStart + 30_000 + Math.floor((i * span) / 1263)).toISOString());
    const out = await send(lead(400));
    expect([out.status, enrolled()]).toEqual([409, 0]);
  }, 60_000);
});
