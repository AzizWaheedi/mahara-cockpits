// bun test supabase/functions/sales-mirror/intake_router.test.ts
//
// The minute job end to end through sales-mirror's real handler (index.ts,
// Deno.serve's function), 2026-11-05: {"mode":"new_contacts"} reads
// HighLevel once, copies a new lead, brings a ROAS tag that came late into
// lead_class, never writes over B2B's row, and reports in its worker status
// row. PostgREST is sales-api's FakeDb behind the same URLs; HighLevel and
// B2B are faked at fetch. Synthetic names only; nothing leaves this process.
import { beforeAll, describe, expect, test } from "bun:test";
import { FakeDb } from "../sales-api/testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.mirror.invalid";
const GHL = "https://services.leadconnectorhq.com";
const SECRET = "cron-secret-test";
const db = new FakeDb({ now: Date.now() });
let contacts: Row[] = [];
let ghlStatus = 200;
const outside: string[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  if (url === `${DB}/rest/v1/rpc/cockpit_sales_lock`) return reply(true);
  if (url === `${DB}/rest/v1/rpc/cockpit_sales_unlock`) return reply(null);
  if (url.startsWith(`${DB}/rest/v1/`)) {
    const path = url.slice(`${DB}/rest/v1/`.length);
    const prefer = new Headers(init.headers as HeadersInit).get("prefer") ?? "";
    const rows = await db.db(path, { method, body: init.body ? JSON.parse(String(init.body)) : undefined, prefer });
    return method === "GET" || /return=representation/.test(prefer) ? reply(rows) : reply(null, 201);
  }
  outside.push(`${method} ${url.split("?")[0]}`);
  if (url === `${GHL}/contacts/search` && method === "POST")
    return ghlStatus === 200 ? reply({ contacts }) : reply({ message: "Too many requests" }, ghlStatus);
  throw new Error(`no fake for ${method} ${url}`);
}

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: DB,
    SUPABASE_SERVICE_ROLE_KEY: "service-test",
    CRON_SECRET: SECRET,
    SALES_GHL_TOKEN: "ghl-test",
  };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts");
});

async function minute(body: unknown = { mode: "new_contacts" }, secret = SECRET): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler (run this file on its own)");
  const res = await handler(
    new Request("https://fn.mirror.invalid/sales-mirror", {
      method: "POST",
      headers: { "x-cron-secret": secret, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const added = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ghlContact = (id: string, tags: string[], over: Row = {}): Row => ({
  id,
  firstName: "Lead",
  lastName: id,
  phone: "+96550009999",
  tags,
  dnd: false,
  dateAdded: added(1),
  dateUpdated: added(0),
  customFields: [],
  ...over,
});
const lead = (id: string) => (db.tables.cockpit_sales_leads ?? []).find(r => r.contact_id === id);
const status = () => (db.tables.cockpit_sales_worker_status ?? []).find(r => r.worker === "sales-mirror" && r.job === "new_contacts");

function fresh() {
  db.tables = {};
  db.calls = [];
  outside.length = 0;
  ghlStatus = 200;
}

describe("the minute job: new contacts, and the ROAS tag that came late", () => {
  test("a new lead is copied the first minute; its tag, landing a minute later, reaches lead_class on the next", async () => {
    fresh();
    contacts = [ghlContact("n1", [])];
    const one = await minute();
    expect(one.status).toBe(200);
    expect(lead("n1")).toMatchObject({ lead_class: null, is_lead: null, tags: [] });
    // The form's automation tags the lead after the first read.
    contacts = [ghlContact("n1", ["roas-qualified"], { customFields: [{ id: "IvdTSSuctezX9DTHo42K", value: "$500k - $1M" }] })];
    const two = await minute();
    expect(two.status).toBe(200);
    expect(lead("n1")).toMatchObject({ lead_class: "qualified", tags: ["roas-qualified"], revenue: "$500k - $1M" });
    expect(two.body.counts).toMatchObject({ n: 1, patched: 1, classed: 0 });
    // One HighLevel search a minute, and nothing else outside: no B2B, no conversations.
    expect(outside).toEqual([`POST ${GHL}/contacts/search`, `POST ${GHL}/contacts/search`]);
    // Its own status row, said plainly; no mirror run row a minute.
    expect(status()).toMatchObject({ ok: true });
    expect(String(status()?.detail)).toMatch(/^Read 1 contact added in the last day from HighLevel; 1 brought up to date\.$/);
    expect(db.tables.cockpit_sales_mirror_runs ?? []).toHaveLength(0);
  });

  test("B2B's row with no class takes the late tag; B2B's other columns stay", async () => {
    fresh();
    db.seed("cockpit_sales_leads", [
      { contact_id: "b1", is_lead: true, lead_class: null, tags: ["fb-lead"], pipeline_id: "p-sales", stage_id: "s-new", lead_created_at: added(5) },
    ]);
    contacts = [ghlContact("b1", ["fb-lead", "roas-unqualified"])];
    const out = await minute();
    expect(out.body.counts).toMatchObject({ patched: 1, classed: 1 });
    expect(lead("b1")).toMatchObject({ is_lead: true, lead_class: "unqualified", tags: ["fb-lead", "roas-unqualified"], pipeline_id: "p-sales", stage_id: "s-new" });
    expect(String(status()?.detail)).toContain("1 with a ROAS tag that came late");
  });

  test("B2B's row landing between the read and the write is never written over", async () => {
    fresh();
    contacts = [ghlContact("r1", [])];
    await minute();
    contacts = [ghlContact("r1", ["roas-qualified"])];
    // B2B's fuller copy lands just before the patch.
    db.beforePatch = (table, rows) => {
      if (table !== "cockpit_sales_leads") return;
      for (const r of rows) Object.assign(r, { is_lead: true, lead_class: "unprepared", tags: ["roas-unprepared"], pipeline_id: "p-sales" });
    };
    await minute();
    expect(lead("r1")).toMatchObject({ is_lead: true, lead_class: "unprepared", pipeline_id: "p-sales" });
    // The next minute reads B2B's row and brings HighLevel's newer tag in, guarded on B2B's class.
    db.beforePatch = null;
    await minute();
    expect(lead("r1")).toMatchObject({ is_lead: true, lead_class: "qualified", pipeline_id: "p-sales" });
  });

  test("HighLevel busy: the minute says so in its row and the next one reads again", async () => {
    fresh();
    ghlStatus = 429;
    const out = await minute();
    expect(out.status).toBe(207);
    expect(status()).toMatchObject({ ok: false });
    expect(String(status()?.detail)).toMatch(/^New contacts were not copied this minute: HighLevel 429 on contacts/);
  });

  test("the door: no cron secret, no run", async () => {
    fresh();
    const out = await minute({ mode: "new_contacts" }, "wrong");
    expect(out.status).toBe(401);
    expect(outside).toEqual([]);
  });
});
