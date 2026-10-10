// bun test supabase/functions/sales-api/zoomlinks_router.test.ts
//
// The instant Zoom link and the WhatsApp group through sales-api's own door
// (index.ts Deno.serve), so the wiring is proven, not only the modules: the
// switch, the keys, a seat's press on the shared host, the desk's service
// token refused, the group's HighLevel note. The outside world is faked at
// fetch with Zoom's answers in their recorded shapes (zoomlinks.test.ts);
// nothing leaves this process and every lead is invented.

import { beforeAll, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.zoomr.invalid";
const GHL = "https://services.leadconnectorhq.com";
const SETTER = "zoomr-setter@zoomr.invalid";
const SHARED = "aziz@maharamedia.com";
const LEAD = "zoomr-lead";
const db = new FakeDb({
  get now() {
    return Date.now();
  },
} as { now: number });
const env: Record<string, string> = {
  SUPABASE_URL: DB,
  SUPABASE_SERVICE_ROLE_KEY: "service-zoomr",
  SUPABASE_ANON_KEY: "anon-zoomr",
  SALES_GHL_TOKEN: "ghl-zoomr",
};
const ZOOM_ENV = { ZOOM_ACCOUNT_ID: "acct-zoomr", ZOOM_CLIENT_ID: "cid-zoomr", ZOOM_CLIENT_SECRET: "secret-zoomr" };
const ghl: { method: string; path: string; body: Row | null }[] = [];
const zoom: { method: string; url: string; body: Row | null }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;

const SEATS: Record<string, Row> = {
  "seat-setter": { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" },
  "seat-none": { signed_in: true, seat: false, manager: false, email: "nobody@zoomr.invalid" },
};

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Zoom's answers in the shapes the API returns them (recorded; no real Zoom call). */
function zoomReply(url: string, method: string, body: Row | null): Response {
  if (url.startsWith("https://zoom.us/oauth/token")) return reply({ access_token: "tok-zoomr", token_type: "bearer", expires_in: 3599 });
  const path = new URL(url).pathname.replace(/^\/v2/, "");
  if (method === "GET" && path === `/users/${encodeURIComponent(SETTER)}`)
    return reply({ code: 1001, message: "User does not exist" }, 404);
  if (method === "GET" && path === `/users/${encodeURIComponent(SHARED)}`)
    return reply({ id: "u-aziz", email: SHARED, type: 2, status: "active" });
  if (method === "GET" && path === "/users/u-aziz/meetings") return reply({ page_size: 1, total_records: 0, meetings: [] });
  if (method === "POST" && path === "/users/u-aziz/meetings")
    return reply(
      {
        uuid: "abc==",
        id: 81234567890,
        host_id: "u-aziz",
        topic: body?.topic,
        type: 2,
        status: "waiting",
        start_url: "https://us06web.zoom.us/s/81234567890?zak=HOST-SECRET",
        join_url: "https://us06web.zoom.us/j/81234567890",
        password: "abc123",
        encrypted_password: "EnCrYpTeD.1",
      },
      201,
    );
  throw new Error(`unrecorded Zoom call: ${method} ${url}`);
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers as HeadersInit);
  const body = init.body ? (JSON.parse(String(init.body)) as Row) : null;
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`)) {
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    if (/^[^.]+\.[^.]+\.sig$/.test(token) && !SEATS[token]) return reply({ signed_in: false });
    return SEATS[token] ? reply(SEATS[token]) : reply({ message: "JWT invalid" }, 401);
  }
  if (url.startsWith(`${DB}/rest/v1/`)) {
    const path = url.slice(`${DB}/rest/v1/`.length);
    const prefer = headers.get("prefer") ?? "";
    try {
      const rows = await db.db(path, { method, body: body ?? undefined, prefer });
      return /return=representation/.test(prefer) || method === "GET" ? reply(rows) : reply(null, 201);
    } catch (e) {
      const err = e as DbError;
      return reply({ code: err.code, message: err.message }, err.status ?? 500);
    }
  }
  if (url.startsWith(GHL)) {
    ghl.push({ method, path: url.slice(GHL.length), body });
    return reply({ note: { id: "n-1" } });
  }
  if (url.startsWith("https://zoom.us/") || url.startsWith("https://api.zoom.us/")) {
    zoom.push({ method, url, body });
    return zoomReply(url, method, body);
  }
  throw new Error(`no fake for ${method} ${url}`);
}

beforeAll(async () => {
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => env[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  await import("./index.ts?zoomlinks_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

function serviceToken(): string {
  const b64 = (o: Row) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "service_role" })}.sig`;
}

async function call(token: string, body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const res = await handler(
    new Request("https://fn.zoomr.invalid/sales-api", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

function reset(enabled: boolean, keys: boolean): void {
  db.tables = {};
  ghl.length = 0;
  zoom.length = 0;
  for (const k of Object.keys(ZOOM_ENV)) delete env[k];
  if (keys) Object.assign(env, ZOOM_ENV);
  db.seed("cockpit_sales_settings", [
    {
      key: "zoom_links",
      value: { enabled, fallback_host: SHARED, per_seat_hour: 20, reuse_hours: 12, tidy_after_h: 24, lengths_min: { intro: 30, demo: 60 } },
    },
  ]);
  db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", name_ar: "تارا", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: SHARED, name: "Aziz Waheedi", role: "manager", active: true },
  ]);
  db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", company: "Huda Interiors", phone: "+96550000000", tags: ["roas-qualified"] }]);
}

const health = () => db.t("cockpit_sales_worker_status").find(r => r.worker === "sales-api" && r.job === "zoom-links");
const audit = (action: string) => db.t("cockpit_audit_log").filter(a => a.action === action);

describe("zoom.link through sales-api's door", () => {
  test("switched off: 409 off, and Zoom is never asked", async () => {
    reset(false, true);
    const r = await call("seat-setter", { action: "zoom.link", contact_id: LEAD, kind: "intro" });
    expect([r.status, r.body.code, r.body.ok]).toEqual([409, "off", false]);
    expect(zoom).toHaveLength(0);
  });

  test("on, keys missing: 503 no_keys, the health row is red, Zoom is never asked", async () => {
    reset(true, false);
    const r = await call("seat-setter", { action: "zoom.link", contact_id: LEAD, kind: "intro" });
    expect([r.status, r.body.code]).toEqual([503, "no_keys"]);
    expect(health()).toMatchObject({ ok: false, detail: "Zoom keys are missing on sales-api" });
    expect(zoom).toHaveLength(0);
  });

  test("a setter with no licensed Zoom: the shared host, join before host on, the link with its passcode, the rows", async () => {
    reset(true, true);
    const r = await call("seat-setter", { action: "zoom.link", contact_id: LEAD, kind: "intro" });
    expect(r.status).toBe(200);
    const link = r.body.link as Row;
    expect(link).toMatchObject({ host: "shared", kind: "intro", join_url: "https://us06web.zoom.us/j/81234567890?pwd=EnCrYpTeD.1" });
    expect(r.body.rep).toEqual({ name: "Tara Setter", name_ar: "تارا" });
    const create = zoom.find(c => c.method === "POST" && c.url.endsWith("/users/u-aziz/meetings"));
    expect((create?.body?.settings as Row).join_before_host).toBe(true);
    expect((create?.body?.settings as Row).waiting_room).toBe(false);
    expect(db.t("cockpit_sales_zoom_links")).toHaveLength(1);
    expect(audit("zoom.link.create")).toHaveLength(1);
    expect(health()?.ok).toBe(true);
    // The host's start link never leaves Zoom's answer.
    expect(JSON.stringify(r.body)).not.toContain("HOST-SECRET");
    expect(JSON.stringify(db.tables)).not.toContain("HOST-SECRET");
    // Pressed again: the same link, no second meeting.
    const again = await call("seat-setter", { action: "zoom.link", contact_id: LEAD, kind: "intro" });
    expect(again.body.reused).toBe(true);
    expect(zoom.filter(c => c.method === "POST" && c.url.includes("/meetings"))).toHaveLength(1);
    // The shared host's start link is never the setter's.
    const start = await call("seat-setter", { action: "zoom.start", id: link.id });
    expect(start.status).toBe(403);
  });

  test("the desk's service token cannot make a link; a signed-in person without a seat cannot either", async () => {
    reset(true, true);
    const desk = await call(serviceToken(), { action: "zoom.link", contact_id: LEAD, kind: "intro" });
    expect(desk.status).toBe(403);
    const none = await call("seat-none", { action: "zoom.link", contact_id: LEAD, kind: "intro" });
    expect(none.status).toBe(403);
    expect(zoom).toHaveLength(0);
  });
});

describe("group.made through sales-api's door", () => {
  test("one row, the audit row and the HighLevel note without the link; nothing else goes to HighLevel", async () => {
    reset(false, false);
    const invite = "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv";
    const r = await call("seat-setter", { action: "group.made", contact_id: LEAD, name: "Huda Interiors | Mahara Media", invite_link: `${invite}?mode=ems_copy_t` });
    expect(r.status).toBe(200);
    expect((r.body.group as Row).invite_link).toBe(invite);
    expect(db.t("cockpit_sales_groups")).toHaveLength(1);
    expect(audit("group.made")).toHaveLength(1);
    expect(ghl.map(g => `${g.method} ${g.path}`)).toEqual([`POST /contacts/${LEAD}/notes`]);
    expect(String(ghl[0]?.body?.body)).toMatch(/^WhatsApp group made by Tara Setter on /);
    expect(JSON.stringify(ghl)).not.toContain("chat.whatsapp.com");
    const bad = await call("seat-setter", { action: "group.made", contact_id: LEAD, invite_link: "https://wa.me/96550000000" });
    expect([bad.status, bad.body.code]).toEqual([400, "bad_invite"]);
  });
});
