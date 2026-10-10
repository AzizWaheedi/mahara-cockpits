// zoom.link, zoom.start and zoom.link.shared against recorded Zoom answers
// (no real Zoom call is ever made here): the switch, the keys, the lead,
// reuse, the cap, who hosts it, the meeting's settings, failures, the start
// link's rules, the tidy, the health row and the audit rows.

import { beforeEach, describe, expect, test } from "bun:test";
import { ApiRefusal } from "./liveio.ts";
import type { Who } from "./lib.ts";
import { FakeDb } from "./testfakes.ts";
import {
  BUSY_UNKNOWN,
  makeZoomLinks,
  meetingBody,
  readZoomSetting,
  SHARED_BUSY,
  SHARED_DOWN,
  withPasscode,
  ZOOM_NO_KEYS,
  ZOOM_OFF,
  ZOOM_TIMEOUT,
  ZOOM_UNREAD,
} from "./zoomlinks.ts";

type Row = Record<string, unknown>;

const T0 = Date.parse("2026-10-10T11:02:00Z");
const SETTER: Who = { signed_in: true, seat: true, manager: false, email: "tahreer@maharamedia.com", name: "Tahreer", role: "setter" };
const CLOSER: Who = { signed_in: true, seat: true, manager: false, email: "ahmed@maharamedia.com", name: "Ahmed Abu Shaiba", role: "closer" };
const CEO: Who = { signed_in: true, seat: true, manager: true, email: "aziz@maharamedia.com", name: "Aziz Waheedi", role: "manager" };
const MANAGER: Who = { signed_in: true, seat: true, manager: true, email: "boss@maharamedia.com", name: "Boss", role: "manager" };

// Zoom's own answers, recorded in the shapes the API returns them.
const USERS: Record<string, Row> = {
  "aziz@maharamedia.com": { id: "u-aziz", email: "aziz@maharamedia.com", type: 2, status: "active" },
  "ahmed@maharamedia.com": { id: "u-ahmed", email: "ahmed@maharamedia.com", type: 2, status: "active" },
  "z-tahreer": { id: "z-tahreer", email: "tahreer@maharamedia.com", type: 1, status: "pending" },
};
const MEETING = (id: number, opts: Row = {}): Row => ({
  uuid: "abc==",
  id,
  host_id: "u-aziz",
  topic: "Mahara Media: Sara (intro)",
  type: 2,
  status: "waiting",
  start_url: `https://us06web.zoom.us/s/${id}?zak=SECRET`,
  join_url: `https://us06web.zoom.us/j/${id}`,
  password: "abc123",
  encrypted_password: "EnCrYpTeD.1",
  ...opts,
});

interface Call {
  method: string;
  url: string;
  body: Row | null;
}

let db: FakeDb;
let clock: { now: number };
let calls: Call[];
let audits: { action: string; id: string | null; before: unknown; after: unknown; meta?: Row }[];
let envs: Record<string, string>;
let bg: Promise<unknown>[];
/** Overrides for one URL pattern: answer with a status and body, or throw. */
let routes: { re: RegExp; method?: string; reply: (c: Call) => { status: number; body?: unknown } | "timeout" | "network" }[];
let meetingSeq: number;
let liveMeetings: Row[];
let tokenAsks: number;
let meetings: Map<string, Row>;
/** Zoom's past-meeting records: a meeting held at least once (GET /past_meetings/{id}). */
let pastMeetings: Map<string, Row>;

function zoomFetch(url: string, init: RequestInit): Response {
  const method = String(init.method ?? "GET");
  const body = init.body ? (JSON.parse(String(init.body)) as Row) : null;
  const c: Call = { method, url, body };
  calls.push(c);
  for (const r of routes) {
    if (r.re.test(url) && (!r.method || r.method === method)) {
      const out = r.reply(c);
      if (out === "timeout") throw Object.assign(new Error("Zoom did not answer within 25 seconds"), { status: 0 });
      // Deno's own words for a request that never reached the server: the URL is in them.
      if (out === "network") throw new TypeError(`error sending request for url (${url}): client error (Connect): dns error`);
      return new Response(out.body === undefined ? "" : JSON.stringify(out.body), { status: out.status });
    }
  }
  if (url.startsWith("https://zoom.us/oauth/token")) {
    tokenAsks++;
    return Response.json({ access_token: `tok-${tokenAsks}`, token_type: "bearer", expires_in: 3599 });
  }
  const u = new URL(url);
  const path = u.pathname.replace(/^\/v2/, "");
  let m = /^\/users\/([^/]+)$/.exec(path);
  if (m && method === "GET") {
    const user = USERS[decodeURIComponent(m[1])];
    return user ? Response.json(user) : Response.json({ code: 1001, message: "User does not exist" }, { status: 404 });
  }
  m = /^\/users\/([^/]+)\/meetings$/.exec(path);
  if (m && method === "GET") return Response.json({ page_size: 1, total_records: liveMeetings.length, meetings: liveMeetings });
  if (m && method === "POST") {
    const id = meetingSeq++;
    const made = MEETING(id, { topic: body?.topic, host_id: decodeURIComponent(m[1]) });
    meetings.set(String(id), made);
    return Response.json(made, { status: 201 });
  }
  m = /^\/past_meetings\/(\d+)$/.exec(path);
  if (m && method === "GET") {
    const past = pastMeetings.get(m[1]);
    return past ? Response.json(past) : Response.json({ code: 3001, message: `Meeting does not exist: ${m[1]}.` }, { status: 404 });
  }
  m = /^\/meetings\/(\d+)$/.exec(path);
  if (m && method === "GET") {
    const found = meetings.get(m[1]);
    return found ? Response.json(found) : Response.json({ code: 3001, message: "Meeting does not exist" }, { status: 404 });
  }
  if (m && method === "DELETE") {
    if (!meetings.has(m[1])) return Response.json({ code: 3001, message: "Meeting does not exist" }, { status: 404 });
    meetings.delete(m[1]);
    return new Response(null, { status: 204 });
  }
  throw new Error(`unrecorded Zoom call: ${method} ${url}`);
}

function setting(value: Row | null) {
  db.tables.cockpit_sales_settings = value ? [{ key: "zoom_links", value, updated_by: "test" }] : [];
}

const ON = {
  enabled: true,
  fallback_host: "aziz@maharamedia.com",
  per_seat_hour: 20,
  reuse_hours: 12,
  tidy_after_h: 24,
  lengths_min: { intro: 30, demo: 60 },
};

function build() {
  return makeZoomLinks({
    svc: (path, init) => db.db(path, init),
    audit: async (_who, action, _type, id, before, after, meta) => {
      audits.push({ action, id, before, after, meta });
    },
    fetchWithin: async (url, init) => zoomFetch(url, init),
    env: n => envs[n] ?? "",
    background: p => {
      bg.push(p);
    },
    now: () => clock.now,
  });
}

let z: ReturnType<typeof build>;

async function refusal(p: Promise<unknown>): Promise<ApiRefusal> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

const links = () => db.t("cockpit_sales_zoom_links");
const health = () => db.t("cockpit_sales_worker_status").find(r => r.worker === "sales-api" && r.job === "zoom-links");
const zoomCalls = () => calls.filter(c => c.url.includes("api.zoom.us"));
const creates = () => calls.filter(c => c.method === "POST" && /\/meetings$/.test(c.url));

beforeEach(() => {
  clock = { now: T0 };
  db = new FakeDb(clock);
  calls = [];
  audits = [];
  bg = [];
  routes = [];
  meetingSeq = 81234567890;
  liveMeetings = [];
  tokenAsks = 0;
  meetings = new Map();
  pastMeetings = new Map();
  envs = { ZOOM_ACCOUNT_ID: "acct", ZOOM_CLIENT_ID: "cid", ZOOM_CLIENT_SECRET: "sec" };
  setting(ON);
  db.tables.cockpit_sales_leads = [
    { contact_id: "c-sara", name: "Sara Al Ali", company: "Al Noor Interiors", phone: "+96550000000", tags: ["roas-qualified"] },
    { contact_id: "c-client", name: "Client Co", company: "X", phone: "+96550000001", tags: ["client"] },
  ];
  db.tables.cockpit_sales_people = [
    { email: "tahreer@maharamedia.com", name: "Tahreer", name_ar: "تحرير", role: "setter", active: true },
    { email: "aziz@maharamedia.com", name: "Aziz Waheedi", name_ar: "عزيز", role: "manager", active: true },
    { email: "ahmed@maharamedia.com", name: "Ahmed Abu Shaiba", name_ar: null, role: "closer", active: true },
  ];
  db.tables.cockpit_sales_room_hosts = [{ email: "tahreer@maharamedia.com", zoom_user_id: "z-tahreer", zoom_status: "pending" }];
  z = build();
});

describe("pure parts", () => {
  test("the setting is off unless enabled is exactly true, with safe defaults", () => {
    expect(readZoomSetting(null).enabled).toBe(false);
    expect(readZoomSetting({ enabled: "true" }).enabled).toBe(false);
    expect(readZoomSetting({ enabled: 1 }).enabled).toBe(false);
    const s = readZoomSetting({ enabled: true, fallback_host: " Aziz@MaharaMedia.com ", per_seat_hour: "x", lengths_min: { demo: 5 } });
    expect(s).toEqual({
      enabled: true,
      fallback_host: "aziz@maharamedia.com",
      per_seat_hour: 20,
      reuse_hours: 12,
      tidy_after_h: 24,
      lengths_min: { intro: 30, demo: 60 },
    });
    expect(readZoomSetting({ enabled: true, fallback_host: "not an email" }).fallback_host).toBeNull();
  });

  test("pwd is added only when the join link has none", () => {
    expect(withPasscode("https://us06web.zoom.us/j/1", { encrypted_password: "a.b/c" })).toBe("https://us06web.zoom.us/j/1?pwd=a.b%2Fc");
    expect(withPasscode("https://us06web.zoom.us/j/1?pwd=KEEP", { encrypted_password: "x" })).toBe("https://us06web.zoom.us/j/1?pwd=KEEP");
    expect(withPasscode("https://us06web.zoom.us/j/1?x=1", { encrypted_password: "y" })).toBe("https://us06web.zoom.us/j/1?x=1&pwd=y");
    expect(withPasscode("https://us06web.zoom.us/j/1", {})).toBe("https://us06web.zoom.us/j/1");
  });

  test("the meeting body: a number for the length, a boolean for join before host, never a waiting room", () => {
    const b = meetingBody({ first: "Sara", kind: "demo", shared: true, minutes: 60, now: T0 });
    expect(b.topic).toBe("Mahara Media: Sara (demo)");
    expect(b.type).toBe(2);
    expect(b.duration).toBe(60);
    expect(b.start_time).toBe("2026-10-10T11:02:00Z");
    expect(b.timezone).toBe("Asia/Kuwait");
    const s = b.settings as Row;
    expect(s.join_before_host).toBe(true);
    expect(s.jbh_time).toBe(0);
    expect(s.waiting_room).toBe(false);
    expect(s.use_pmi).toBe(false);
    expect(s.auto_recording).toBe("none");
    expect((meetingBody({ first: "", kind: "intro", shared: false, minutes: 30, now: T0 }).settings as Row).join_before_host).toBe(false);
  });
});

describe("zoom.link: before Zoom is asked", () => {
  test("switched off, or no row: 409 off, no Zoom call", async () => {
    setting({ ...ON, enabled: false });
    let r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" }));
    expect([r.status, r.message, r.extra.code]).toEqual([409, ZOOM_OFF, "off"]);
    setting(null);
    r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" }));
    expect([r.status, r.extra.code]).toEqual([409, "off"]);
    expect(calls).toHaveLength(0);
  });

  test("a setting that cannot be read: 503 with the sentence", async () => {
    db.faults.push({ prefix: "cockpit_sales_settings", error: new Error("database 500"), times: 1 });
    const r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" }));
    expect([r.status, r.message]).toEqual([503, ZOOM_UNREAD]);
  });

  test("keys missing: 503 no_keys, the health row says so, no Zoom call", async () => {
    envs = { ZOOM_ACCOUNT_ID: "acct", ZOOM_CLIENT_ID: "", ZOOM_CLIENT_SECRET: "sec" };
    const r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" }));
    expect([r.status, r.message, r.extra.code]).toEqual([503, ZOOM_NO_KEYS, "no_keys"]);
    expect(health()).toMatchObject({ ok: false, detail: "Zoom keys are missing on sales-api" });
    expect(calls).toHaveLength(0);
  });

  test("an active client is refused; a lead not in the cockpit is 404; the kind is asked", async () => {
    let r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-client", kind: "intro" }));
    expect([r.status, r.extra.code]).toEqual([409, "client"]);
    r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-nobody", kind: "intro" }));
    expect([r.status, r.message]).toEqual([404, "That lead is not in the cockpit."]);
    r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "webinar" }));
    expect(r.status).toBe(400);
    expect(creates()).toHaveLength(0);
  });
});

describe("zoom.link: who hosts it", () => {
  test("a pending setter goes on the shared host: join before host on, jbh 0, no waiting room", async () => {
    const out = await z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" });
    const post = creates()[0];
    expect(post.url).toBe("https://api.zoom.us/v2/users/u-aziz/meetings");
    const s = post.body?.settings as Row;
    expect([s.join_before_host, s.jbh_time, s.waiting_room]).toEqual([true, 0, false]);
    expect(post.body?.duration).toBe(30);
    expect(post.body?.topic).toBe("Mahara Media: Sara (intro)");
    const link = out.link as Row;
    expect(link.host).toBe("shared");
    expect(link.host_name).toBe("Aziz Waheedi");
    expect(String(link.join_url)).toBe("https://us06web.zoom.us/j/81234567890?pwd=EnCrYpTeD.1");
    expect(out.reused).toBe(false);
    expect(out.warning).toBeNull();
    expect(out.rep).toEqual({ name: "Tahreer", name_ar: "تحرير" });
    // The row: no start link anywhere in it.
    expect(links()).toHaveLength(1);
    expect(links()[0]).toMatchObject({ host_kind: "shared", host_email: "aziz@maharamedia.com", seat_email: "tahreer@maharamedia.com", call_kind: "intro", meeting_id: "81234567890" });
    expect(JSON.stringify(links()[0])).not.toContain("zak=");
    // The setter's own Zoom user was looked up by the id room_hosts keeps.
    expect(zoomCalls().some(c => c.url.endsWith("/users/z-tahreer"))).toBe(true);
  });

  test("a licensed rep hosts it on their own user: join before host off, no waiting room", async () => {
    const out = await z.actions["zoom.link"](CLOSER, { contact_id: "c-sara", kind: "demo" });
    const post = creates()[0];
    expect(post.url).toBe("https://api.zoom.us/v2/users/u-ahmed/meetings");
    const s = post.body?.settings as Row;
    expect([s.join_before_host, s.waiting_room]).toEqual([false, false]);
    expect(post.body?.duration).toBe(60);
    expect((out.link as Row).host).toBe("own");
    // No busy check on an own host.
    expect(zoomCalls().some(c => c.url.includes("type=live"))).toBe(false);
  });

  test("a Basic or missing rep goes shared too", async () => {
    USERS["noor@maharamedia.com"] = { id: "u-noor", email: "noor@maharamedia.com", type: 1, status: "active" };
    const basic: Who = { ...SETTER, email: "noor@maharamedia.com", name: "Noor" };
    expect(((await z.actions["zoom.link"](basic, { contact_id: "c-sara", kind: "intro" })).link as Row).host).toBe("shared");
    const missing: Who = { ...SETTER, email: "ghost@maharamedia.com", name: "Ghost" };
    expect(((await z.actions["zoom.link"](missing, { contact_id: "c-sara", kind: "intro" })).link as Row).host).toBe("shared");
    delete USERS["noor@maharamedia.com"];
  });

  test("the shared host not licensed: 503, nothing made", async () => {
    setting({ ...ON, fallback_host: "ahmed-basic@maharamedia.com" });
    USERS["ahmed-basic@maharamedia.com"] = { id: "u-b", type: 1, status: "active" };
    const r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" }));
    expect([r.status, r.message]).toEqual([503, SHARED_DOWN]);
    expect(creates()).toHaveLength(0);
    expect(links()).toHaveLength(0);
    expect(health()?.ok).toBe(false);
    delete USERS["ahmed-basic@maharamedia.com"];
  });

  test("the shared host busy: the link is still made, with the warning", async () => {
    liveMeetings = [{ id: 1, topic: "Board call" }];
    const out = await z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" });
    expect(out.warning).toBe(SHARED_BUSY);
    expect(links()).toHaveLength(1);
  });

  test("the busy check that fails is said, never read as free", async () => {
    routes.push({ re: /type=live/, reply: () => ({ status: 500, body: { message: "oops" } }) });
    const out = await z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" });
    expect(out.warning).toBe(BUSY_UNKNOWN);
  });
});

describe("zoom.link: reuse and the cap", () => {
  test("pressing again inside 12 hours gives the same link; fresh makes a new one", async () => {
    const a = await z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" });
    clock.now += 11 * 3_600_000;
    const b = await z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" });
    expect(b.reused).toBe(true);
    expect((b.link as Row).id).toBe((a.link as Row).id);
    expect(creates()).toHaveLength(1);
    const c = await z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro", fresh: true });
    expect(c.reused).toBe(false);
    expect((c.link as Row).id).not.toBe((a.link as Row).id);
    expect(creates()).toHaveLength(2);
  });

  test("after 12 hours, or for the other kind, or another seat, a new meeting", async () => {
    await z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" });
    await z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "demo" });
    await z.actions["zoom.link"](CLOSER, { contact_id: "c-sara", kind: "intro" });
    clock.now += 12 * 3_600_000 + 1000;
    await z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" });
    expect(creates()).toHaveLength(4);
  });

  test("the cap: 20 links in an hour, then 429 with the sentence", async () => {
    for (let i = 0; i < 20; i++) {
      db.t("cockpit_sales_zoom_links").push({
        id: `00000000-0000-4000-8000-${String(900000 + i).padStart(12, "0")}`,
        contact_id: `c-${i}`,
        seat_email: "tahreer@maharamedia.com",
        call_kind: "intro",
        host_kind: "shared",
        host_email: "aziz@maharamedia.com",
        meeting_id: String(i),
        join_url: "https://us06web.zoom.us/j/1",
        made_at: new Date(T0 - 30 * 60_000).toISOString(),
        deleted_at: null,
        started_at: null,
      });
    }
    const r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" }));
    expect([r.status, r.message]).toEqual([429, "You made 20 Zoom links in the last hour. Use one you made, or wait a few minutes."]);
    expect(creates()).toHaveLength(0);
  });
});

describe("zoom.link: Zoom's failures", () => {
  test("a 4xx on the create: 502 with Zoom's words, no row, health false", async () => {
    routes.push({ re: /\/users\/[^/]+\/meetings$/, method: "POST", reply: () => ({ status: 400, body: { code: 300, message: "Invalid meeting settings" } }) });
    const r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" }));
    expect(r.status).toBe(502);
    expect(r.message).toBe("Zoom did not make the meeting: Invalid meeting settings. Try again.");
    expect(links()).toHaveLength(0);
    expect(health()?.ok).toBe(false);
    expect(audits).toHaveLength(0);
  });

  test("a timeout on the create: 504, no row, never tried twice", async () => {
    routes.push({ re: /\/users\/[^/]+\/meetings$/, method: "POST", reply: () => "timeout" });
    const r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" }));
    expect([r.status, r.message]).toEqual([504, ZOOM_TIMEOUT]);
    expect(creates()).toHaveLength(1);
    expect(links()).toHaveLength(0);
    expect(health()?.ok).toBe(false);
  });

  test("the token is kept; a 401 asks for a new one once", async () => {
    await z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" });
    expect(tokenAsks).toBe(1);
    await z.actions["zoom.link"](CLOSER, { contact_id: "c-sara", kind: "intro" });
    expect(tokenAsks).toBe(1);
    let once = true;
    routes.push({
      re: /\/users\/u-ahmed\/meetings$/,
      method: "POST",
      reply: () => {
        if (once) {
          once = false;
          return { status: 401, body: { code: 124, message: "Invalid access token." } };
        }
        return { status: 201, body: MEETING(555) };
      },
    });
    await z.actions["zoom.link"](CLOSER, { contact_id: "c-sara", kind: "demo" });
    expect(tokenAsks).toBe(2);
    expect(links()).toHaveLength(3);
  });

  test("a save that fails after the create removes the meeting and says so", async () => {
    db.faults.push({ prefix: "cockpit_sales_zoom_links", method: "POST", error: new Error("database 500"), times: 1 });
    const r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" }));
    expect(r.status).toBe(503);
    await Promise.all(bg);
    expect(calls.some(c => c.method === "DELETE" && c.url.includes("/meetings/81234567890"))).toBe(true);
  });
});

describe("zoom.link: what it leaves behind", () => {
  test("the audit row, the health row, and the tidy in the background", async () => {
    const out = await z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" });
    const a = audits.find(x => x.action === "zoom.link.create");
    expect(a?.id).toBe(String((out.link as Row).id));
    expect(a?.after).toEqual({ id: (out.link as Row).id, host_kind: "shared", call_kind: "intro", meeting_id: "81234567890" });
    expect(health()).toMatchObject({ ok: true, detail: "Made a meeting at 14:02 (Kuwait time)" });
    expect(bg).toHaveLength(1);
  });
});

describe("the tidy", () => {
  function seed(id: string, meetingId: string, hoursAgo: number, extra: Row = {}) {
    db.t("cockpit_sales_zoom_links").push({
      id,
      contact_id: "c-old",
      seat_email: "tahreer@maharamedia.com",
      call_kind: "intro",
      host_kind: "shared",
      host_email: "aziz@maharamedia.com",
      meeting_id: meetingId,
      join_url: `https://us06web.zoom.us/j/${meetingId}`,
      made_at: new Date(T0 - hoursAgo * 3_600_000).toISOString(),
      deleted_at: null,
      started_at: null,
      ...extra,
    });
  }

  test("only waiting meetings over 24 h go, at most five; started stays; a 404 is gone", async () => {
    for (let i = 0; i < 7; i++) {
      seed(`00000000-0000-4000-8000-00000000010${i}`, String(100 + i), 30 + i);
      meetings.set(String(100 + i), MEETING(100 + i));
    }
    meetings.set("100", MEETING(100, { status: "started" }));
    meetings.delete("101");
    seed("00000000-0000-4000-8000-000000000200", "200", 5);
    meetings.set("200", MEETING(200));
    seed("00000000-0000-4000-8000-000000000300", "300", 40, { started_at: new Date(T0 - 39 * 3_600_000).toISOString() });
    meetings.set("300", MEETING(300));
    const done = await z.tidy(SETTER, "aziz@maharamedia.com", 24);
    // The five oldest unstarted rows are looked at: 106..102 (oldest first).
    const deletes = calls.filter(c => c.method === "DELETE").map(c => /meetings\/(\d+)/.exec(c.url)?.[1]);
    expect(deletes.sort()).toEqual(["102", "103", "104", "105", "106"]);
    expect(done).toBe(5);
    expect(meetings.has("200")).toBe(true);
    expect(meetings.has("300")).toBe(true);
    const row = (id: string) => links().find(r => r.meeting_id === id);
    expect(row("106")?.deleted_why).toBe("tidied: never started");
    expect(row("100")?.deleted_at).toBeNull();
    expect(audits.filter(a => a.action === "zoom.link.tidy")).toHaveLength(5);
    // The next pass reaches the started one (kept) and the one Zoom lost.
    calls = [];
    await z.tidy(SETTER, "aziz@maharamedia.com", 24);
    expect(row("101")?.deleted_why).toBe("gone in Zoom");
    expect(row("100")?.deleted_at).toBeNull();
    expect(calls.filter(c => c.method === "DELETE").map(c => c.url)).toEqual([]);
  });

  test("a meeting that was held and ended reads waiting again: kept in Zoom, marked started, out of the queue", async () => {
    // Zoom's answer for a held, ended meeting (checked on Mahara's Zoom,
    // 2026-10-10): GET /meetings says waiting, and only the past-meeting
    // record tells it from one never held.
    seed("00000000-0000-4000-8000-000000000400", "400", 30);
    meetings.set("400", MEETING(400));
    pastMeetings.set("400", { id: 400, start_time: "2026-10-09T05:10:00Z", end_time: "2026-10-09T05:40:00Z", duration: 30 });
    seed("00000000-0000-4000-8000-000000000401", "401", 29);
    meetings.set("401", MEETING(401));
    const done = await z.tidy(SETTER, "aziz@maharamedia.com", 24);
    expect(done).toBe(1);
    expect(meetings.has("400")).toBe(true);
    expect(meetings.has("401")).toBe(false);
    const row = (id: string) => links().find(r => r.meeting_id === id);
    expect(row("400")).toMatchObject({ deleted_at: null, started_at: "2026-10-09T05:10:00.000Z" });
    expect(row("401")?.deleted_why).toBe("tidied: never started");
    expect(audits.find(a => a.action === "zoom.link.held")).toMatchObject({
      id: "00000000-0000-4000-8000-000000000400",
      before: { started_at: null },
      after: { started_at: "2026-10-09T05:10:00.000Z" },
    });
    calls = [];
    await z.tidy(SETTER, "aziz@maharamedia.com", 24);
    expect(calls.filter(c => c.url.includes("/400"))).toEqual([]);
  });

  test("Zoom not saying whether it was held: nothing is deleted or marked", async () => {
    seed("00000000-0000-4000-8000-000000000500", "500", 30);
    meetings.set("500", MEETING(500));
    routes.push({ re: /\/past_meetings\//, reply: () => ({ status: 500, body: { message: "oops" } }) });
    expect(await z.tidy(SETTER, "aziz@maharamedia.com", 24)).toBe(0);
    expect(meetings.has("500")).toBe(true);
    expect(links()[0]).toMatchObject({ deleted_at: null, started_at: null });
    expect(calls.filter(c => c.method === "DELETE")).toEqual([]);
    expect(audits).toEqual([]);
  });
});

describe("Zoom's keys stay on the server", () => {
  test("a network failure on the token request never puts the account id in the sentence or the health row", async () => {
    envs.ZOOM_ACCOUNT_ID = "AcCtId-9x8y7z";
    envs.ZOOM_CLIENT_SECRET = "S3cr3t-Value";
    routes.push({ re: /^https:\/\/zoom\.us\/oauth\/token/, reply: () => "network" });
    const r = await refusal(z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" }));
    expect(r.status).toBe(502);
    expect(r.message).toContain("account_id=[key]");
    for (const text of [r.message, String(health()?.detail), JSON.stringify(audits)]) {
      expect(text).not.toContain("AcCtId-9x8y7z");
      expect(text).not.toContain("S3cr3t-Value");
      expect(text).not.toContain(btoa("cid:S3cr3t-Value"));
    }
  });
});

describe("zoom.start", () => {
  async function made(who: Who) {
    const out = await z.actions["zoom.link"](who, { contact_id: "c-sara", kind: who === CLOSER ? "demo" : "intro" });
    return String((out.link as Row).id);
  }

  test("the own host's rep gets a fresh start link; started_at and the audit row, never the link itself", async () => {
    const id = await made(CLOSER);
    const out = await z.actions["zoom.start"](CLOSER, { id });
    expect(String(out.start_url)).toContain("/s/");
    expect(links()[0].started_at).toBe(new Date(T0).toISOString());
    const a = audits.find(x => x.action === "zoom.link.start");
    expect(a).toBeTruthy();
    expect(JSON.stringify(a)).not.toContain("zak=");
  });

  test("another seat is refused; a manager may", async () => {
    const id = await made(CLOSER);
    const r = await refusal(z.actions["zoom.start"](SETTER, { id }));
    expect([r.status, r.message]).toEqual([403, "Only the rep who made this link can start it as host."]);
    expect(String((await z.actions["zoom.start"](MANAGER, { id })).start_url)).toContain("/s/");
  });

  test("the shared host's start link goes to nobody but the shared host", async () => {
    const id = await made(SETTER);
    let r = await refusal(z.actions["zoom.start"](SETTER, { id }));
    expect(r.status).toBe(403);
    r = await refusal(z.actions["zoom.start"](MANAGER, { id }));
    expect(r.status).toBe(403);
    expect(String((await z.actions["zoom.start"](CEO, { id })).start_url)).toContain("/s/");
  });

  test("a meeting Zoom no longer has: 410 and the row is marked gone", async () => {
    const id = await made(CLOSER);
    meetings.clear();
    const r = await refusal(z.actions["zoom.start"](CLOSER, { id }));
    expect(r.status).toBe(410);
    expect(links()[0].deleted_why).toBe("gone in Zoom");
  });

  test("a bad id is 400", async () => {
    expect((await refusal(z.actions["zoom.start"](CLOSER, { id: "x" }))).status).toBe(400);
  });
});

describe("zoom.link.shared", () => {
  test("how is checked; the seat's own link is marked with its audit row", async () => {
    const out = await z.actions["zoom.link"](SETTER, { contact_id: "c-sara", kind: "intro" });
    const id = String((out.link as Row).id);
    expect((await refusal(z.actions["zoom.link.shared"](SETTER, { id, how: "sms" }))).status).toBe(400);
    expect((await refusal(z.actions["zoom.link.shared"](CLOSER, { id, how: "whatsapp" }))).status).toBe(403);
    await z.actions["zoom.link.shared"](SETTER, { id, how: "whatsapp" });
    expect(links()[0]).toMatchObject({ shared_how: "whatsapp", shared_at: new Date(T0).toISOString() });
    expect(audits.some(a => a.action === "zoom.link.shared")).toBe(true);
  });
});

describe("every write has its audit row", () => {
  test("create, start, shared, tidy", async () => {
    const own = await z.actions["zoom.link"](CLOSER, { contact_id: "c-sara", kind: "demo" });
    const id = String((own.link as Row).id);
    await z.actions["zoom.start"](CLOSER, { id });
    await z.actions["zoom.link.shared"](CLOSER, { id, how: "copy_link" });
    const actions = audits.map(a => a.action);
    expect(actions).toEqual(["zoom.link.create", "zoom.link.start", "zoom.link.shared"]);
  });
});
