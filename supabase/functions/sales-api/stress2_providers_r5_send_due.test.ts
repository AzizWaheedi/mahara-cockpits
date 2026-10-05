// bun test supabase/functions/sales-api/stress2_providers_r5_send_due.test.ts
//
// Second series, round 5, provider quirks: HighLevel failing the contact read
// that sendTemplate makes before anything is written, on an opener a manager
// approved, run end to end through the real handler (index.ts Deno.serve,
// followupAgent.ts send_due, index.ts sendFollowup and sendTemplate) with the
// outside world faked at fetch, as stress_numbers_sendtemplate.test.ts does.
// The desk calls with a service-role token, as the VPS does. Nothing leaves
// this process; every lead is invented. Run this file on its own (it sets
// globalThis.fetch and Deno for index.ts).
import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
// Monday 5 October 2026, 11:00 in Kuwait: inside the first-message hours, not a Friday.
const NOW = Date.parse("2026-10-05T08:00:00Z");
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghlCalls: { method: string; path: string }[] = [];
/** HighLevel's answer to the contact read, when a test makes it fail: [status, message]. */
let contactRead: [number, string] | null = null;
let handler: ((req: Request) => Promise<Response>) | undefined;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  // PostgREST checks the desk token's signature (m1 round 1): a good one, the
  // service role, has no seat.
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`)) return reply({ signed_in: false });
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
      if (method === "GET") rows = rows.slice(0, 1000);
      return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
    } catch (e) {
      const err = e as DbError;
      return reply({ code: err.code, message: err.message }, err.status ?? 500);
    }
  }
  if (url.startsWith(GHL)) {
    const path = url.slice(GHL.length);
    ghlCalls.push({ method, path });
    if (method === "GET" && /^\/contacts\/[^/]+$/.test(path.split("?")[0] as string) && contactRead !== null)
      return reply({ statusCode: contactRead[0], message: contactRead[1] }, contactRead[0]);
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
  setSystemTime(new Date(NOW));
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
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  // A module instance of its own (the query string), as the other end-to-end
  // files load it, so another file that loaded index.ts first never answers here.
  await import("./index.ts?stress2_providers_r5_send_due");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

afterAll(() => {
  setSystemTime();
});

const WAVE = "5e1a7c3d-0b2f-4c8e-9a6d-1f2e3d4c5b6a";
const LEAD = "stress-p5-send-due";

function reset(): string {
  db.tables = {};
  ghlCalls.length = 0;
  contactRead = null;
  db.seed("cockpit_sales_settings", [
    { key: "messaging", value: { whatsapp: true, email: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250, template_budget_usd_month: 100 } },
    { key: "followups", value: { enabled: true, agent: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], stop_pause_days: 30 } },
    { key: "wa_fields", value: { rep: { id: "f-rep" }, line: { id: "f-line" } } },
  ]);
  db.seed("cockpit_sales_wa_templates", [
    { key: "opener_ar", name: "cockpit_opener_ar", language: "ar", preview: "Hi {{1}}, it's {{2}} from Mahara Media.", variables: ["first_name", "rep_name"], workflow_id: "wf-opener", active: true },
  ]);
  db.seed("cockpit_sales_people", [{ email: "rep@stress.invalid", name: "Rafi Rep", ghl_user_id: "G-rep", active: true }]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", assigned_to: "G-rep" }]);
  db.seed("cockpit_sales_followup_waves", [{ id: WAVE, pool: "noshow", state: "running", segment: "reactivate", per_day: 40 }]);
  const id = crypto.randomUUID();
  db.seed("cockpit_sales_followups", [
    {
      id,
      contact_id: LEAD,
      segment: "reactivate",
      channel: "whatsapp_template",
      template_key: "opener_ar",
      status: "draft",
      touch: 1,
      body: "Hi Huda",
      created_at: new Date(NOW - 2 * 3_600_000).toISOString(),
      context: { wave_id: WAVE, language: "ar" },
    },
  ]);
  db.seed("cockpit_sales_followup_meta", [
    { followup_id: id, wave_id: WAVE, send_after: new Date(NOW - 60_000).toISOString(), approved_by: "boss@stress.invalid", held_by: null },
  ]);
  return id;
}

/** A token whose role claim the gateway verified: service_role, as the desk's key. */
const DESK_TOKEN = `x.${btoa(JSON.stringify({ role: "service_role" })).replace(/=+$/, "")}.y`;

async function sendDue(id: string): Promise<{ status: number; body: Row }> {
  const res = await (handler as (req: Request) => Promise<Response>)(
    new Request("https://fn.stress.invalid/sales-api", {
      method: "POST",
      headers: { authorization: `Bearer ${DESK_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "followup.send_due", id }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const meta = (id: string) => db.t("cockpit_sales_followup_meta").find(m => m.followup_id === id) as Row;

// ---------------------------------------------------------------------------
// HighLevel fails the contact read sendTemplate makes before its message row
// (a 502 from its gateway, or a 400 that is not about the contact).
//
// Round 4 made index.ts answer any failure before the message row as a
// certain "not sent yet" (beforeRowCertain: Refusal 503, code not_sent_yet,
// retry). sendFollowup puts the draft back to draft and rethrows it.
// followupAgent.ts send_due then reads it as an ApiRefusal: not hold_all, not
// a 502, not a state race, so it SETS THE APPROVED OPENER ASIDE for a person
// (held_by sales-desk, hold_reason "Not sent: HighLevel or the database did
// not answer ... Try again in a minute."). highlevelBlip and contactRefused,
// the round-3 fix for exactly this (highlevel-400-sets-approved-opener-aside),
// return false for any ApiRefusal, so they never see it now. Every HighLevel
// blip during a paced batch spends one manager approval: the opener waits for
// a person instead of the next run.
// ---------------------------------------------------------------------------

describe("providers2 r5: HighLevel fails the contact read before an approved opener's row", () => {
  test("HELD (control): HighLevel answering, the approved opener goes", async () => {
    const id = reset();
    const out = await sendDue(id);
    expect(out.status).toBe(200);
    expect(ghlCalls.some(c => c.method === "POST" && c.path.includes("/workflow/"))).toBe(true);
  }, 60_000);

  for (const [status, message] of [
    [502, "Bad Gateway"],
    [400, "Bad Request"],
  ] as [number, string][]) {
    test(`not-sent-yet-sets-approved-opener-aside: HighLevel ${status} ${message} on the contact read`, async () => {
      const id = reset();
      contactRead = [status, message];
      const out = await sendDue(id);
      const m = meta(id);
      const f = db.t("cockpit_sales_followups").find(x => x.id === id) as Row;
      expect(
        { held_by: m.held_by ?? null, draft: f.status },
        `HighLevel answered ${status} "${message}" to the contact read before anything was written (sales-api answered ` +
          `${out.status} ${String(out.body.code ?? "")}: ${String(out.body.error ?? "")}); the manager's approved opener was set aside ` +
          `for a person (held_by ${String(m.held_by)}, reason ${JSON.stringify(m.hold_reason ?? null)}) instead of waiting in the queue for the next run`,
      ).toEqual({ held_by: null, draft: "draft" });
    }, 60_000);
  }
});
