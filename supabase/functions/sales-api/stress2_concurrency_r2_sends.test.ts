// bun test supabase/functions/sales-api/stress2_concurrency_r2_sends.test.ts
//
// Second series, round 2, dimension: concurrency and idempotency, the sends.
// index.ts sendTemplate run end to end through the real handler (Deno.serve's
// function) with the outside world faked at fetch (PostgREST is testfakes.ts
// FakeDb behind the same URLs, its message slot the 20261004a function's
// model), as stress_numbers_sendtemplate.test.ts does.
//
// The race: HighLevel cannot send a template itself. sendTemplate writes the
// lead's words (and a room's code) into the contact's cockpit fields, then
// enrols the contact in a one-step workflow that reads those fields when it
// runs. A workflow HighLevel accepted runs later when its queue is slow, and
// it reads the fields as they are THEN. Fix round 4
// (delayed-workflow-sends-new-room-code-twice) refuses a second template
// while an earlier one is "sent / enrolled" (taken, not seen). A template
// whose enrolment answer was lost (state "unclear": the call timed out or
// HighLevel answered 5xx, so it may have been enrolled), or whose function
// stopped between the slot and HighLevel's answer (an orphaned "sending"
// row), is just as possibly in that queue, and is not counted: after the
// lead's two minutes, a second template overwrites the fields and enrols
// again, and the first enrolment, when it runs, sends the second's words.
//
// Synthetic only; nothing leaves this process.
import { beforeAll, describe, expect, test } from "bun:test";
import { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const REP = "rep-s2c2@stress.invalid";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghlCalls: { method: string; path: string; body: unknown }[] = [];
/** HighLevel's answer to the next workflow enrolments: "ok", or "lost" (a 504 after HighLevel took it). */
const enrolModes: ("ok" | "lost")[] = [];
/** HighLevel's side: the contact's cockpit fields, and the enrolments it accepted and has not run yet. */
const hl = { fields: {} as Record<string, string>, queue: [] as { at: number }[] };
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
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    ghlCalls.push({ method, path, body });
    if (method === "GET" && path.startsWith("/contacts/")) {
      const id = decodeURIComponent(path.split("/")[2]?.split("?")[0] ?? "");
      return reply({ contact: { id, firstName: "Huda", phone: "+96550000000", tags: ["roas-qualified"], dnd: false, dndSettings: {} } });
    }
    if (method === "PUT" && path.startsWith("/contacts/")) {
      for (const f of ((body as Row)?.customFields ?? []) as Row[]) hl.fields[String(f.id)] = String(f.field_value ?? "");
      return reply({ contact: {} });
    }
    if (method === "POST" && path.includes("/workflow/")) {
      // HighLevel takes the enrolment either way; "lost" is its answer never reaching sales-api.
      hl.queue.push({ at: Date.now() });
      if ((enrolModes.shift() ?? "ok") === "lost") return reply({ message: "Gateway Timeout" }, 504);
      return reply({ succeded: true });
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
  enrolModes.length = 0;
  hl.fields = {};
  hl.queue = [];
  db.seed("cockpit_sales_settings", [
    { key: "messaging", value: { whatsapp: true, email: true } },
    { key: "whatsapp_guard", value: { templates_per_day: 250, template_budget_usd_month: 100 } },
    { key: "wa_fields", value: { rep: { id: "f-rep" }, line: { id: "f-line" } } },
  ]);
  db.seed("cockpit_sales_wa_templates", [
    {
      key: "stress_line_en",
      name: "cockpit_stress_line_en",
      language: "en",
      preview: "Hi {{1}}, {{2}} — {{3}}",
      variables: ["first_name", "line", "rep_name"],
      workflow_id: "wf-stress-line",
      active: true,
    },
  ]);
  db.seed("cockpit_sales_people", [{ email: REP, name: "Rafi Rep", ghl_user_id: "G-rep", active: true }]);
}

function lead(id: string): string {
  if (!db.t("cockpit_sales_leads").some(l => l.contact_id === id)) db.seed("cockpit_sales_leads", [{ contact_id: id, name: "Huda Ali" }]);
  return id;
}

async function sendLine(contactId: string, line: string): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler (run this file on its own)");
  const res = await handler(
    new Request("https://fn.stress.invalid/sales-api", {
      method: "POST",
      headers: { authorization: "Bearer a-seat-session", "content-type": "application/json" },
      body: JSON.stringify({ action: "wa.template.send", contact_id: contactId, template_key: "stress_line_en", line, request_id: crypto.randomUUID() }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const enrolments = () => ghlCalls.filter(c => c.method === "POST" && c.path.includes("/workflow/")).length;

/** Time passes for the lead's rows: the earlier send happened `ms` ago (the lead's two minutes are over). */
function age(contactId: string, ms: number): void {
  for (const m of db.t("cockpit_sales_messages")) if (m.contact_id === contactId) m.created_at = new Date(Date.parse(String(m.created_at)) - ms).toISOString();
}

describe("a template that may be in HighLevel's queue, and a second template to the same lead", () => {
  test("control (fix round 4, held): the first template was taken and not seen (sent / enrolled): a second one three minutes later is refused before any field is written", async () => {
    reset();
    const c = lead("stress-s2c2-lead-control");
    const first = await sendLine(c, "your call is at 3 pm today");
    expect(first.status).toBe(200);
    // The read-back never saw it: stored sent / enrolled.
    const row = db.t("cockpit_sales_messages").find(m => m.contact_id === c) as Row;
    expect([row.state, row.provider_status]).toEqual(["sent", "enrolled"]);
    age(c, 3 * 60_000);
    const second = await sendLine(c, "the room is ready, join now");
    expect(second.status).toBe(409);
    expect(enrolments()).toBe(1);
    expect(hl.fields["f-line"]).toBe("your call is at 3 pm today");
  }, 60_000);

  test("unclear-template-not-waiting: the first template's enrolment answer was lost (HighLevel took it; a 504 came back), so the row says unclear; a second template three minutes later must not rewrite the fields and enrol again", async () => {
    reset();
    const c = lead("stress-s2c2-lead-unclear");
    enrolModes.push("lost");
    const first = await sendLine(c, "your call is at 3 pm today");
    // The rep is told it may have gone.
    expect(first.status).toBe(502);
    const row = db.t("cockpit_sales_messages").find(m => m.contact_id === c) as Row;
    expect(row.state).toBe("unclear");
    expect(hl.queue.length).toBe(1); // HighLevel has it queued
    age(c, 3 * 60_000);
    // Another rep (or the room's new link, or the desk's opener) sends a template to the same lead.
    const second = await sendLine(c, "the room is ready, join now");
    const fieldWhenQueuedRuns = hl.fields["f-line"];
    // What reached HighLevel: the queued first enrolment reads the fields when it runs.
    const toLead = [...hl.queue.map(() => fieldWhenQueuedRuns)];
    expect({
      status: second.status,
      enrolments: enrolments(),
      // Both queued runs would send "the room is ready, join now": the lead gets it twice.
      lead_receives: toLead,
    }).toEqual({ status: 409, enrolments: 1, lead_receives: ["your call is at 3 pm today"] });
  }, 60_000);

  test("orphaned-sending-template-not-waiting: the function stopped between the message row and HighLevel's answer (the row still says sending, five minutes on); a second template must not rewrite the fields and enrol again", async () => {
    reset();
    const c = lead("stress-s2c2-lead-orphan");
    // The first send's row as a killed isolate leaves it: the slot's "sending"
    // row, its fields written and its enrolment sent, no answer recorded.
    db.seed("cockpit_sales_messages", [
      {
        request_id: crypto.randomUUID(),
        contact_id: c,
        channel: "whatsapp",
        via: "workflow",
        template_key: "stress_line_en",
        workflow_id: "wf-stress-line",
        body: "Hi Huda, your call is at 3 pm today — Rafi",
        source: "rep",
        sent_by: REP,
        state: "sending",
        created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
    ]);
    hl.fields["f-line"] = "your call is at 3 pm today";
    hl.queue.push({ at: Date.now() - 5 * 60_000 });
    const second = await sendLine(c, "the room is ready, join now");
    expect({ status: second.status, enrolments: enrolments(), field: hl.fields["f-line"] }).toEqual({
      status: 409,
      enrolments: 0,
      field: "your call is at 3 pm today",
    });
  }, 60_000);
});
