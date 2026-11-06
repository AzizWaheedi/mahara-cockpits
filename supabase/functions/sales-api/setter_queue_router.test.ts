// bun test supabase/functions/sales-api/setter_queue_router.test.ts
//
// The setter's one queue (Aziz, 2026-11-05), end to end through the real
// handler (index.ts, Deno.serve's function): dial.queue's new items and
// numbers, the burst's quick second try on dial.save, the voice note
// (dial.touch), "Not ready yet" and the hot list after a held intro
// (dial.hot). The outside world is faked at fetch: PostgREST is testfakes.ts
// FakeDb behind the same URLs, the seat check answers a setter, HighLevel
// answers {} and is recorded. Synthetic names only; nothing leaves this process.
import { beforeAll, describe, expect, test } from "bun:test";
import { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.setter.invalid";
const GHL = "https://services.leadconnectorhq.com";
const SETTER = "setter-q@setter.invalid";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
const ghlCalls: { method: string; url: string; body: unknown }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`))
    return reply({
      signed_in: true,
      seat: true,
      manager: false,
      email: SETTER,
      name: "Tara Setter",
      role: "setter",
      ghl_user_id: "G-setter",
      maqsam_email: SETTER,
    });
  if (url.startsWith(`${DB}/rest/v1/rpc/`)) {
    const fn = url.slice(`${DB}/rest/v1/rpc/`.length).split("?")[0] as string;
    try {
      return reply(await db.rpc(fn, init.body ? JSON.parse(String(init.body)) : {}));
    } catch (e) {
      return reply({ message: String((e as Error).message) }, (e as DbError).status ?? 500);
    }
  }
  if (url.startsWith(`${DB}/rest/v1/`)) {
    // The fake does not parse or= filters; every world here has one lead per question.
    const path = url.slice(`${DB}/rest/v1/`.length).replace(/&or=[^&]*/, "");
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
    ghlCalls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    return reply({});
  }
  throw new Error(`no fake for ${method} ${url}`);
}

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: DB,
    SUPABASE_SERVICE_ROLE_KEY: "service-setter",
    SUPABASE_ANON_KEY: "anon-setter",
    SALES_GHL_TOKEN: "ghl-setter",
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

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

// index.ts keeps its heavy reads for 20 s (HEAVY_FOR) and whether the
// 2026-11-05 update is in for a minute: each world starts two minutes after
// the last, so no test reads the one before's rows.
const realNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => realNow() + offset;

async function call(action: string, body: Row = {}): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler (run this file on its own)");
  const res = await handler(
    new Request("https://fn.setter.invalid/sales-api", {
      method: "POST",
      headers: { authorization: "Bearer a-seat-session", "content-type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const lead = (id: string, over: Row = {}): Row => ({
  contact_id: id,
  name: `${id} Person`,
  phone: "+96550001234",
  phone8: "50001234",
  lead_created_at: iso(Date.now() - 20 * DAY),
  stage_id: "s-new",
  stage_name: "🚨New Lead",
  pipeline_id: "p-sales",
  lead_class: "qualified",
  dnd: false,
  contact_type: "lead",
  assigned_to: null,
  tags: ["roas-qualified"],
  country: "KW",
  ...over,
});

/** A fresh world: the setter's seat, the pipeline setting, and whatever the test adds. */
function world(o: { touches?: boolean } = {}) {
  db.tables = {};
  db.faults = [];
  ghlCalls.length = 0;
  offset += 2 * MIN;
  db.seed("cockpit_sales_settings", [
    { key: "pipeline", value: { auto_moves: true, id: "p-sales", roles: { "s-new": "new", "s-long": "nurture_long" } } },
  ]);
  db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", name_ar: "تارا", role: "setter", ghl_user_id: "G-setter", active: true, via_portal: true },
    { email: "closer-q@setter.invalid", name: "Cole Closer", role: "closer", ghl_user_id: "G-closer", active: true, via_portal: true },
  ]);
  // Before the 2026-11-05 database update the voice-note table is not there.
  if (o.touches === false)
    db.faults.push({
      prefix: "cockpit_sales_touches",
      error: new DbError('database 404: {"code":"PGRST205","message":"Could not find the table \'public.cockpit_sales_touches\' in the schema cache"}', 404, "PGRST205"),
      times: 1000,
    });
}

describe("dial.queue: the setter's one queue", () => {
  test("new items, the voice note's facts, the call to mark, today's speed and the replies Messages holds", async () => {
    world();
    const now = Date.now();
    const intro = { appointment_id: "a-jb", contact_id: "jb", call_type: "intro", start_at: iso(now + DAY), booked_at: iso(now - 5 * MIN), status: "confirmed", assigned_user_id: "G-setter" };
    const owed = { appointment_id: "a-owed", contact_id: "owed", call_type: "intro", start_at: iso(now - 2 * HOUR), booked_at: iso(now - 2 * DAY), status: "confirmed", assigned_user_id: "G-setter" };
    db.seed("cockpit_sales_leads", [
      lead("fresh", {
        lead_created_at: iso(now - 2 * MIN),
        revenue: "$500k - $1M",
        revenue_goal: "$3M+",
        readiness: "$8K - $12K",
        decision_maker: "Yes, only me",
        challenge: "Not enough clients",
        services: "Yes",
      }),
      lead("jb", { phone: "+96550001235", phone8: "50001235" }),
      lead("owed", { phone: "+96550001236", phone8: "50001236" }),
      lead("waiting", { phone: "+96550001237", phone8: "50001237" }),
      lead("dm", { phone: null, phone8: null }),
    ]);
    db.seed("cockpit_sales_calendar", [intro, owed]);
    db.seed("cockpit_sales_appointments", [intro, owed]);
    db.seed("cockpit_sales_conversations", [
      { conversation_id: "c-w", contact_id: "waiting", last_in_at: iso(now - 3 * DAY), needs_reply: true, tags: [], phone: "+96550001237" },
      { conversation_id: "c-dm", contact_id: "dm", last_in_at: iso(now - 2 * HOUR), needs_reply: true, tags: [], phone: null },
    ]);
    db.seed("cockpit_sales_dials", [
      // Called once, twenty days ago, so not "never called" today.
      { call_id: "d1", contact_id: "waiting", lead_phone8: "50001237", occurred_at: iso(now - 19 * DAY), state: "completed", direction: "outbound" },
      { call_id: "d2", contact_id: "owed", lead_phone8: "50001236", occurred_at: iso(now - 3 * DAY), state: "completed", direction: "outbound" },
      { call_id: "d3", contact_id: "jb", lead_phone8: "50001235", occurred_at: iso(now - 10 * DAY), state: "completed", direction: "outbound" },
    ]);
    const { status, body } = await call("dial.queue", { as: "setter", limit: 25 });
    expect(status).toBe(200);
    const items = body.queue as Row[];
    const by = (id: string) => items.find(i => i.contact_id === id) ?? null;
    expect(by("fresh")).toMatchObject({ tier: 0, code: "new_lead", why: "New lead, call now" });
    const facts = (by("fresh")?.voice_note ?? null) as Row | null;
    expect(facts).toMatchObject({
      due: false,
      step: "new",
      first_name: "fresh",
      revenue: "$500k - $1M",
      goal: "$3M+",
      services: null,
      language: "en",
      rep: { first_name: "Tara", first_name_ar: "تارا" },
    });
    expect(by("jb")).toMatchObject({ tier: 0, code: "just_booked" });
    expect(String(by("jb")?.why)).toMatch(/^Booked an intro for tomorrow at \d\d:\d\d, call now$/);
    expect(by("jb")?.just_booked).toMatchObject({ appointment_id: "a-jb" });
    expect(by("owed")).toMatchObject({ tier: 1, code: "mark_call" });
    expect((by("owed")?.mark_call as Row)?.appointment_id).toBe("a-owed");
    expect(by("waiting")).toMatchObject({ tier: 2, code: "reply_waiting", why: "Still waiting on you" });
    expect(by("dm")).toBeNull();
    expect(body.messages).toMatchObject({ count: 1 });
    // One new sales lead today ("fresh", if it came in after 00:00 Kuwait), not called.
    const speed = body.speed as Row;
    expect(speed.not_known).toEqual([]);
    expect(speed.within5).toBe(0);
    expect(speed.median_min).toBeNull();
    expect(body.voice_notes_known).toBe(true);
  });

  // 2026-11-06 review: an item "I sent the voice note" cannot clear (dial.touch
  // refuses before the update) is never raised; the screen is told why.
  test("the voice notes unread (before the database update): no voice-note item is raised, and the screen is told", async () => {
    world({ touches: false });
    const now = Date.now();
    db.seed("cockpit_sales_leads", [lead("v", { lead_created_at: iso(now - 8 * MIN) })]);
    db.seed("cockpit_sales_attempts", [
      { id: "00000000-0000-4000-8000-0000000000a1", contact_id: "v", rep_email: SETTER, state: "saved", outcome: "no_answer", item_kind: "lead", started_at: iso(now - MIN), saved_at: iso(now - 40_000) },
    ]);
    db.seed("cockpit_sales_queue_state", [{ contact_id: "v", step: 0, last_outcome: "no_answer", last_outcome_at: iso(now - 40_000), due_at: iso(now + 80_000) }]);
    const { body } = await call("dial.queue", { as: "setter" });
    expect(body.voice_notes_known).toBe(false);
    const items = body.queue as Row[];
    expect(items.some(i => i.code === "voice_note")).toBe(false);
    for (const i of items) expect(i.voice_step).toBeNull();
  });
});

describe("dial.save: the burst's two calls, then the ladder", () => {
  test("the first no-answer on a new lead comes back in two minutes with the ladder unmoved, and the voice note is next", async () => {
    world();
    const now = Date.now();
    db.seed("cockpit_sales_leads", [lead("n", { lead_created_at: iso(now - 4 * MIN), country: "AE", phone: "+971501234567", phone8: "01234567" })]);
    const first = await call("dial.save", { contact_id: "n", outcome: "no_answer", item_kind: "lead", as: "setter" });
    expect(first.status).toBe(200);
    const state = first.body.state as Row;
    expect(state.step).toBe(0);
    expect(Date.parse(String(state.due_at)) - Date.now()).toBeLessThanOrEqual(2 * MIN);
    expect(Date.parse(String(state.due_at)) - Date.now()).toBeGreaterThan(MIN);
    const next = first.body.next_step as Row;
    expect(next).toMatchObject({ kind: "voice_note", facts: { step: "new", first_name: "n", country: "United Arab Emirates" } });
    expect(next.second_try_at).not.toBeNull();
    // The second no-answer is the ladder's first step.
    offset += 3 * MIN;
    const second = await call("dial.save", { contact_id: "n", outcome: "no_answer", item_kind: "lead", as: "setter" });
    expect((second.body.state as Row).step).toBe(1);
    expect(Date.parse(String((second.body.state as Row).due_at)) - Date.now()).toBeGreaterThan(HOUR - MIN);
    expect((second.body.next_step as Row)?.second_try_at ?? null).toBeNull();
  });

  test("an old lead's no-answer, outside any burst, is the ladder as before, with no voice note asked", async () => {
    world();
    db.seed("cockpit_sales_leads", [lead("o")]);
    const out = await call("dial.save", { contact_id: "o", outcome: "no_answer", item_kind: "lead", as: "setter" });
    expect((out.body.state as Row).step).toBe(1);
    expect(out.body.next_step ?? null).toBeNull();
  });
});

describe("dial.touch: the voice note went (nothing is sent from here)", () => {
  test("recorded once per lead per ten minutes, with an audit row; the next save does not ask again", async () => {
    world();
    const now = Date.now();
    db.seed("cockpit_sales_leads", [lead("t", { lead_created_at: iso(now - 5 * MIN) })]);
    const one = await call("dial.touch", { contact_id: "t", kind: "voice_note", step: "new" });
    expect(one.status).toBe(200);
    expect(one.body.touch).toMatchObject({ contact_id: "t", kind: "voice_note", step: "new", rep_email: SETTER });
    const two = await call("dial.touch", { contact_id: "t", kind: "voice_note", step: "new" });
    expect(two.body.repeated).toBe(true);
    expect(db.tables.cockpit_sales_touches?.length).toBe(1);
    expect((db.tables.cockpit_audit_log ?? []).filter(a => a.action === "dial.touch")).toHaveLength(1);
    const saved = await call("dial.save", { contact_id: "t", outcome: "no_answer", item_kind: "lead", as: "setter" });
    expect(saved.body.next_step ?? null).toBeNull();
  });

  test("before the database update it says so; a lead on do not disturb is refused", async () => {
    world({ touches: false });
    db.seed("cockpit_sales_leads", [lead("t"), lead("dnd", { dnd: true })]);
    const out = await call("dial.touch", { contact_id: "t", kind: "voice_note" });
    expect(out.status).toBe(409);
    expect(String(out.body.error)).toMatch(/database update of 5 November/);
    const dnd = await call("dial.touch", { contact_id: "dnd", kind: "voice_note" });
    expect(dnd.status).toBe(409);
    expect(String(dnd.body.error)).toMatch(/do not disturb/);
  });
});

describe("Not ready yet (nurture), and the hot list after a held intro", () => {
  test("not ready closes the lead with no 'not interested' tag; before the update it is refused and nothing is written", async () => {
    world({ touches: false });
    db.seed("cockpit_sales_leads", [lead("r")]);
    const early = await call("dial.save", { contact_id: "r", outcome: "not_ready", note: "Selling the business, back in six months", item_kind: "lead", as: "setter" });
    expect(early.status).toBe(409);
    expect(db.tables.cockpit_sales_attempts ?? []).toHaveLength(0);
    world();
    db.seed("cockpit_sales_leads", [lead("r")]);
    const out = await call("dial.save", { contact_id: "r", outcome: "not_ready", note: "Selling the business, back in six months", item_kind: "lead", as: "setter" });
    expect(out.status).toBe(200);
    expect(out.body.state).toMatchObject({ closed: "not_ready", last_outcome: "not_ready" });
    expect(out.body.stage_move).toEqual({ state: "pending" });
    await new Promise(r => setTimeout(r, 50));
    expect(ghlCalls.some(c => /\/tags/.test(c.url))).toBe(false);
    // A note is required, as for not interested.
    const bare = await call("dial.save", { contact_id: "r", outcome: "not_ready", item_kind: "lead", as: "setter" });
    expect(bare.status).toBe(400);
  });

  test("dial.hot puts the lead on the hot list for the next working morning, once", async () => {
    world();
    db.seed("cockpit_sales_leads", [lead("h")]);
    const one = await call("dial.hot", { contact_id: "h" });
    expect(one.status).toBe(200);
    expect(one.body.hot).toMatchObject({ contact_id: "h", owner_email: SETTER, next_how: "call", note: "Held the intro, no demo booked yet." });
    expect(Date.parse(String((one.body.hot as Row).next_at))).toBeGreaterThan(Date.now());
    const two = await call("dial.hot", { contact_id: "h" });
    expect(two.body.repeated).toBe(true);
    expect((db.tables.cockpit_audit_log ?? []).filter(a => a.action === "hot.save")).toHaveLength(1);
  });
});

describe("today's speed counts the setter's Maqsam calls by his seat's address (2026-11-05)", () => {
  test("his call with no B2B rep id counts; a call-centre agent's does not; the reads are named when they fail", async () => {
    world();
    // Past index.ts's five-minute keep of the seats' addresses, so this world's are read.
    offset += 6 * MIN;
    const seat = (db.tables.cockpit_sales_people ?? []).find(p => p.email === SETTER) as Row;
    seat.maqsam_email = SETTER;
    const now = Date.now();
    db.seed("cockpit_sales_leads", [
      lead("sp", { lead_created_at: iso(now - 3 * MIN), phone: "+96550007001", phone8: "50007001" }),
      lead("cc", { lead_created_at: iso(now - 3 * MIN), phone: "+96550007002", phone8: "50007002" }),
    ]);
    db.seed("cockpit_sales_dials", [
      // The desk copies the setter's call with no rep id: he has no row on B2B's roster.
      { call_id: "m-sp", contact_id: "sp", lead_phone8: "50007001", occurred_at: iso(now - MIN), agent_email: SETTER.toUpperCase(), sales_rep_id: null, direction: "outbound", state: "no_answer", mirrored_at: iso(now) },
      // Someone outside the sales seats.
      { call_id: "m-cc", contact_id: "cc", lead_phone8: "50007002", occurred_at: iso(now - MIN), agent_email: "agent@callcentre.invalid", sales_rep_id: null, direction: "outbound", state: "completed", mirrored_at: iso(now) },
    ]);
    const out = await call("dial.queue", { as: "setter" });
    expect(out.status).toBe(200);
    expect(out.body.speed).toMatchObject({ leads: 2, called: 1, within5: 1, median_min: 2, not_called: 1, not_known: [] });
    expect((out.body.speed as Row).oldest_waiting).toMatchObject({ contact_id: "cc" });
  });
});
