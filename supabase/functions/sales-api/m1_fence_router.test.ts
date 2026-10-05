// bun test supabase/functions/sales-api/m1_fence_router.test.ts
//
// Milestone 1's fence through sales-api's own doors (index.ts Deno.serve):
// a seat's session, the desk's service-role token and the cron secret each
// ask for what lies outside Milestone 1 while its switch is off, and each is
// refused, or answered with nothing done. The one way to turn the agent's
// own sends on is a manager's followup.settings, which writes an audit row.
// The outside world is faked at fetch (as stress2_fix1_same_words.test.ts
// does); nothing leaves this process, every lead is invented.

import { beforeAll, describe, expect, test } from "bun:test";
import { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const CRON = "cron-secret-stress";
const SETTER = "stress-m1r-setter@stress.invalid";
const BOSS = "stress-m1r-boss@stress.invalid";
const LEAD = "stress-m1r-lead";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghl: { method: string; path: string }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;

const SEATS: Record<string, Row> = {
  "seat-setter": { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" },
  "seat-boss": { signed_in: true, seat: true, manager: true, email: BOSS, name: "Boss", role: "manager", ghl_user_id: "G-boss" },
};

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers as HeadersInit);
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`)) {
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    return SEATS[token] ? reply(SEATS[token]) : reply({ message: "JWT invalid" }, 401);
  }
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
    ghl.push({ method, path });
    if (method === "GET" && path.startsWith("/contacts/"))
      return reply({ contact: { id: LEAD, firstName: "Huda", phone: "+96550000000", tags: ["roas-qualified"], dnd: false, dndSettings: {} } });
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
    CRON_SECRET: CRON,
  };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts?m1_fence_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

/** A token whose role claim the gateway has verified: the desk's service key. */
function serviceToken(): string {
  const b64 = (o: Row) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "service_role" })}.sig`;
}

type Caller = "setter" | "boss" | "desk" | "cron";

async function call(who: Caller, body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (who === "setter") headers.authorization = "Bearer seat-setter";
  if (who === "boss") headers.authorization = "Bearer seat-boss";
  if (who === "desk") headers.authorization = `Bearer ${serviceToken()}`;
  if (who === "cron") {
    headers.authorization = "Bearer anon-stress";
    headers["x-cron-secret"] = CRON;
  }
  const res = await handler(new Request("https://fn.stress.invalid/sales-api", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Row };
}

const DRAFT = "6b0f6c1e-7d2a-4e3b-9c4d-5e6f7a8b9c0d";
const OPENER = "7c1a7d2f-8e3b-4f4c-8d5e-6f7a8b9c0d1e";
const WAVE = "8d2b8e3a-9f4c-4a5d-9e6f-7a8b9c0d1e2f";
const ROOM = "9e3c9f4b-0a5d-4b6e-8f7a-8b9c0d1e2f3a";

function reset(followups: Row = {}): void {
  db.tables = {};
  ghl.length = 0;
  db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_contacts: [LEAD], providers: { zoom: true, meet: true }, send: { whatsapp_text: true, whatsapp_template: true, email: true } },
      updated_at: new Date(Date.now() - 60_000).toISOString(),
    },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    {
      key: "followups",
      value: { enabled: true, agent: false, autosend: { confirm: true }, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18], ...followups },
      updated_at: new Date(Date.now() - 60_000).toISOString(),
    },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: BOSS, name: "Boss", role: "manager", active: true },
  ]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", assigned_to: "G-setter" }]);
  db.seed("cockpit_sales_followups", [
    { id: DRAFT, contact_id: LEAD, owner_email: SETTER, segment: "confirm", channel: "email", subject: "Your call", body: "See you tomorrow at 10.", status: "draft", touch: 1, created_at: new Date().toISOString() },
    { id: OPENER, contact_id: LEAD, owner_email: SETTER, segment: "reactivate", channel: "whatsapp_template", template_key: "opener_ar", body: "Hi Huda", status: "draft", touch: 1, created_at: new Date().toISOString(), context: { wave_id: WAVE } },
  ]);
  db.seed("cockpit_sales_followup_waves", [{ id: WAVE, pool: "never_booked", segment: "reactivate", state: "running", per_day: 40 }]);
  db.seed("cockpit_sales_followup_meta", [{ followup_id: OPENER, wave_id: WAVE, send_after: new Date(Date.now() - 60_000).toISOString(), approved_by: BOSS, held_by: null }]);
}

const sent = () => ghl.filter(g => g.method !== "GET");
const audit = (action: string) => db.t("cockpit_audit_log").filter(a => a.action === action);

describe("a seat's session", () => {
  test("refused: I'm available, a room for a booked call, a confirmation draft's approval; nothing reaches HighLevel", async () => {
    reset();
    const avail = await call("setter", { action: "live.availability", state: "available" });
    expect([avail.status, avail.body.code]).toEqual([409, "disabled"]);
    const wrap = await call("setter", { action: "room.wrap", appointment_id: "appt-1", request_id: crypto.randomUUID() });
    expect([wrap.status, wrap.body.code]).toEqual([409, "disabled"]);
    const confirm = await call("setter", { action: "followup.approve", id: DRAFT });
    expect(confirm.status).toBe(409);
    expect(String(confirm.body.error)).toMatch(/Confirmation messages are switched off/);
    expect(sent()).toHaveLength(0);
    expect((db.t("cockpit_sales_followups").find(f => f.id === DRAFT) as Row).status).toBe("draft");
  });

  test("the desk's own actions are not a seat's to take", async () => {
    reset();
    for (const action of ["room.event", "followup.send_due", "followup.autosend", "live.press", "thread.tick"]) {
      const out = await call("setter", { action, kind: "sweep.settle", payload: { room_ids: [ROOM] }, id: OPENER });
      expect([action, out.status, out.body.error]).toEqual([action, 400, "Unknown action."]);
    }
    expect(sent()).toHaveLength(0);
  });

  test("a rep cannot turn the agent's own sends on", async () => {
    reset();
    const out = await call("setter", { action: "followup.settings", value: { agent: true } });
    expect(out.status).toBe(403);
    expect((db.t("cockpit_sales_settings").find(s => s.key === "followups")?.value as Row).agent).toBe(false);
    expect(audit("followup.settings")).toHaveLength(0);
  });
});

describe("the desk's service key", () => {
  test("refused or inert: the settle, the paced send, autosend and a Slack press", async () => {
    reset();
    const settle = await call("desk", { action: "room.event", kind: "sweep.settle", payload: { room_ids: [ROOM] } });
    expect([settle.status, settle.body.ok, settle.body.handled, settle.body.off]).toEqual([200, true, 0, "settle"]);
    const due = await call("desk", { action: "followup.send_due", id: OPENER });
    expect([due.status, due.body.hold_all]).toEqual([409, true]);
    const auto = await call("desk", { action: "followup.autosend", id: DRAFT });
    expect([auto.status, auto.body.hold_all]).toEqual([409, true]);
    expect(String(auto.body.error)).toMatch(/followups\.agent/);
    const press = await call("desk", { action: "live.press", slack_user_id: "U1" });
    expect([press.status, press.body.code]).toEqual([409, "disabled"]);
    expect(sent()).toHaveLength(0);
    expect(db.t("cockpit_sales_dispositions")).toHaveLength(0);
  });

  test("a seat's action is not the desk's to take (no switch through the service key)", async () => {
    reset();
    const out = await call("desk", { action: "followup.settings", value: { agent: true } });
    expect([out.status, out.body.error]).toEqual([403, "Not an action the desk may take."]);
    expect((db.t("cockpit_sales_settings").find(s => s.key === "followups")?.value as Row).agent).toBe(false);
  });
});

describe("the cron secret (what the sweep's door passes on)", () => {
  test("room.event sweep.settle is answered with nothing done; nothing else it may not take gets through", async () => {
    reset();
    const settle = await call("cron", { action: "room.event", kind: "sweep.settle", payload: { room_ids: [ROOM] } });
    expect([settle.status, settle.body.handled, settle.body.off]).toEqual([200, 0, "settle"]);
    for (const action of ["followup.send_due", "followup.autosend", "live.press", "followup.settings", "live.take"]) {
      const out = await call("cron", { action, id: OPENER, value: { agent: true } });
      // Not a cron action: read as a person's session, which the anon key is not.
      expect([action, out.status]).toEqual([action, 401]);
    }
    expect(sent()).toHaveLength(0);
    expect((db.t("cockpit_sales_settings").find(s => s.key === "followups")?.value as Row).agent).toBe(false);
  });
});

describe("turning the agent's own sends on: a manager's followup.settings, with its audit row", () => {
  test("refused before it, allowed after it, and the audit row names the manager and the change", async () => {
    reset();
    const before = await call("boss", { action: "followup.wave", request_id: crypto.randomUUID(), op: "start", pool: "good_intro" });
    expect(before.status).toBe(409);
    expect(String(before.body.error)).toMatch(/own sends are switched off/);
    const on = await call("boss", { action: "followup.settings", value: { agent: true } });
    expect(on.status).toBe(200);
    expect((db.t("cockpit_sales_settings").find(s => s.key === "followups")?.value as Row).agent).toBe(true);
    const rows = audit("followup.settings");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_email: BOSS, entity_id: "followups" });
    expect([(rows[0]?.before as Row).agent, (rows[0]?.after as Row).agent]).toEqual([false, true]);
    // The drafts reps approve were never touched by it.
    expect((db.t("cockpit_sales_settings").find(s => s.key === "followups")?.value as Row).enabled).toBe(true);
    const after = await call("boss", { action: "followup.wave", request_id: crypto.randomUUID(), op: "start", pool: "good_intro" });
    expect(after.status).toBe(200);
  });
});
