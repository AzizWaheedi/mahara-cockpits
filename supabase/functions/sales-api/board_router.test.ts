// bun test supabase/functions/sales-api/board_router.test.ts
//
// pipeline.board and pipeline.move through sales-api's own door (index.ts
// Deno.serve): a signed or handed-over client stays on the board in its
// pipeline's Closed column (the CEO, 2026-10-11), with the signed date, the
// value and who closed it, counted apart from open leads; "Mine" keeps the
// deals I closed or set; and a client is never moved from the board, so no
// HighLevel stage write reaches them. HighLevel is faked at fetch; nothing
// leaves this process and every lead is invented.

import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { DbError } from "./liveio.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.boardr.invalid";
const GHL = "https://services.leadconnectorhq.com";
const PIPE = "pipe-2call";
const NOW = Date.now();
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

const db = new FakeDb({
  get now() {
    return Date.now();
  },
} as { now: number });
const env: Record<string, string> = {
  SUPABASE_URL: DB,
  SUPABASE_SERVICE_ROLE_KEY: "service-boardr",
  SUPABASE_ANON_KEY: "anon-boardr",
  SALES_GHL_TOKEN: "ghl-boardr",
};
const ghl: { method: string; path: string; body: Row | null }[] = [];
let handler: ((req: Request) => Promise<Response>) | undefined;

const SEATS: Record<string, Row> = {
  "seat-manager": { signed_in: true, seat: true, manager: true, email: "boss@boardr.invalid", name: "Boss", role: "manager", ghl_user_id: "u-boss" },
  "seat-ahmed": {
    signed_in: true,
    seat: true,
    manager: false,
    email: "ahmed@boardr.invalid",
    name: "Ahmed Abushaiba",
    role: "closer",
    ghl_user_id: "u-ahmed",
    b2b_rep_id: "rep-ahmed",
  },
  "seat-tahreer": {
    signed_in: true,
    seat: true,
    manager: false,
    email: "tahreer@boardr.invalid",
    name: "Tahrir Abadi",
    role: "setter",
    ghl_user_id: "u-tahreer",
    b2b_rep_id: "rep-tahreer",
  },
};

const STAGES = [
  { id: "s-new", name: "🚨New Lead", position: 0 },
  { id: "s-intro", name: "👀Intro Call REQUESTED", position: 1 },
  { id: "s-demo", name: "📅Demo Booked (Qualified)", position: 4 },
  { id: "s-short", name: "⏳Short Term Nurture", position: 9 },
  { id: "s-closed", name: "🎉Closed", position: 12 },
];

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers as HeadersInit);
  const body = init.body ? (JSON.parse(String(init.body)) as Row) : null;
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`)) {
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
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
    const path = url.slice(GHL.length);
    ghl.push({ method, path, body });
    if (method === "GET" && path.startsWith("/opportunities/pipelines"))
      return reply({ pipelines: [{ id: PIPE, name: "Sales Pipeline (2-Call)", stages: STAGES }] });
    if (method === "PUT" && path.startsWith("/opportunities/")) return reply({ opportunity: { id: path.split("/")[2] } });
    throw new Error(`unrecorded HighLevel call: ${method} ${path}`);
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
  await import("./index.ts?board_router");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

async function call(token: string, body: Row): Promise<{ status: number; body: Row }> {
  if (!handler) throw new Error("index.ts did not register its handler");
  const res = await handler(
    new Request("https://fn.boardr.invalid/sales-api", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const lead = (id: string, over: Row = {}): Row => ({
  contact_id: id,
  name: id,
  lead_class: "qualified",
  stage_id: "s-new",
  stage_name: "🚨New Lead",
  opp_status: "open",
  pipeline_id: PIPE,
  opportunity_id: `opp-${id}`,
  assigned_to: "u-tahreer",
  revenue: null,
  readiness: null,
  lead_created_at: iso(NOW - 2 * DAY),
  opp_updated_at: iso(NOW - 2 * DAY),
  dnd: false,
  tags: ["roas-qualified"],
  ...over,
});

const OLD = iso(NOW - 300 * DAY);

beforeEach(() => {
  db.tables = {};
  ghl.length = 0;
  db.seed("cockpit_sales_settings", [{ key: "pipeline", value: { auto_moves: true, roles: {} } }]);
  db.seed("cockpit_sales_people", [
    { email: "ahmed@boardr.invalid", name: "Ahmed Abushaiba", ghl_user_id: "u-ahmed", active: true },
    { email: "tahreer@boardr.invalid", name: "Tahrir Abadi", ghl_user_id: "u-tahreer", active: true },
  ]);
  db.seed("cockpit_sales_reps", [
    { id: "rep-ahmed", display_name: "Ahmed Abushaiba", closer_aliases: ["Ahmed Abusahiba"] },
    { id: "rep-tahreer", display_name: "Tahrir Abadi", closer_aliases: ["تحرير عبادي"] },
  ]);
  db.seed("cockpit_sales_leads", [
    // An open lead being worked.
    lead("c-open"),
    // Tagged client, sitting in Demo Booked in HighLevel: was left off the board.
    lead("c-tag", { stage_id: "s-demo", stage_name: "📅Demo Booked (Qualified)", tags: ["client"], opp_updated_at: OLD, lead_created_at: OLD }),
    // Signed on the New Client Form, no tag yet, quiet for months.
    lead("c-deal", { stage_id: "s-short", stage_name: "⏳Short Term Nurture", opp_updated_at: OLD, lead_created_at: OLD, assigned_to: "u-other" }),
    // A tagged client whose opportunity HighLevel abandoned: still Closed.
    lead("c-tag-gone", { stage_id: "s-short", stage_name: "⏳Short Term Nurture", tags: ["client"], opp_status: "abandoned", opp_updated_at: iso(NOW - 10 * DAY) }),
    // In HighLevel's Closed stage, no tag and no deal: a legacy Closed lead.
    lead("c-legacy", { stage_id: "s-closed", stage_name: "🎉Closed", opp_updated_at: OLD, lead_created_at: OLD, assigned_to: "u-ahmed" }),
    // A voided deal: not a client, quiet like any old lead.
    lead("c-void", { stage_id: "s-short", stage_name: "⏳Short Term Nurture", opp_updated_at: OLD, lead_created_at: OLD }),
    // Lost, not a client: off the board as before.
    lead("c-lost", { opp_status: "lost" }),
  ]);
  db.seed("cockpit_sales_deals", [
    { response_id: "r-deal", contact_id: "c-deal", submitted_at: iso(NOW - 2 * DAY), closer: "Ahmed Abushaiba", setter: "تحرير عبادي", contracted_revenue: 6000, voided: false },
    { response_id: "r-tag", contact_id: "c-tag", submitted_at: iso(NOW - 40 * DAY), closer: "Maria", setter: null, contracted_revenue: 3000, voided: false },
    { response_id: "r-void", contact_id: "c-void", submitted_at: iso(NOW - 5 * DAY), closer: "Ahmed Abushaiba", setter: null, contracted_revenue: 9000, voided: true },
    { response_id: "r-none", contact_id: null, submitted_at: iso(NOW - 1 * DAY), closer: "Ahmed Abushaiba", setter: null, contracted_revenue: 1000, voided: false },
  ]);
});

const ids = (cards: Row[]) => cards.map(c => c.contact_id);

describe("pipeline.board: signed clients stay, in Closed", () => {
  test("the team's board: clients and legacy Closed leads in the Closed column, newest signing first", async () => {
    const r = await call("seat-manager", { action: "pipeline.board", scope: "team" });
    expect(r.status).toBe(200);
    const cards = r.body.cards as Row[];
    const closed = cards.filter(c => c.closed === true);
    expect(ids(closed)).toEqual(["c-deal", "c-tag", "c-tag-gone", "c-legacy"]);
    for (const c of closed) expect(c.stage_id).toBe("s-closed");
    expect(ids(cards.filter(c => c.closed === false))).toEqual(["c-open"]);
    expect(r.body.closed_stage).toEqual({ id: "s-closed", name: "🎉Closed", synthetic: false });
    expect(r.body.counts).toEqual({ open: 1, signed: 3 });
    // The voided deal's lead is quiet in its own stage; the lost lead is gone.
    expect((r.body.quiet as Row)["s-short"]).toBe(1);
    expect(ids(cards)).not.toContain("c-lost");
    expect(ids(cards)).not.toContain("c-void");
  });

  test("a Closed card: signed date, value, who closed it and HighLevel's real stage; no heat, hot flag or next step", async () => {
    const r = await call("seat-manager", { action: "pipeline.board", scope: "team" });
    const card = (r.body.cards as Row[]).find(c => c.contact_id === "c-deal") as Row;
    expect(card).toMatchObject({
      client: true,
      closed: true,
      value: 6000,
      closer: "Ahmed Abushaiba",
      setter: "تحرير عبادي",
      crm_stage: "⏳Short Term Nurture",
      heat: 0,
      hot: false,
      next_at: null,
      next_what: null,
      quiet: false,
    });
    expect(Date.parse(String(card.signed_at))).toBe(NOW - 2 * DAY);
    const tagOnly = (r.body.cards as Row[]).find(c => c.contact_id === "c-tag-gone") as Row;
    expect([tagOnly.client, tagOnly.signed_at, tagOnly.value]).toEqual([true, null, null]);
    const legacy = (r.body.cards as Row[]).find(c => c.contact_id === "c-legacy") as Row;
    expect([legacy.client, legacy.closed, legacy.crm_stage]).toEqual([false, true, "🎉Closed"]);
    const open = (r.body.cards as Row[]).find(c => c.contact_id === "c-open") as Row;
    expect([open.client, open.closed, open.signed_at, open.crm_stage]).toEqual([false, false, null, null]);
  });

  test("Mine, for the closer: the deal he closed and the Closed lead he owns, not Maria's client", async () => {
    const r = await call("seat-ahmed", { action: "pipeline.board", scope: "mine" });
    expect(r.status).toBe(200);
    expect(ids((r.body.cards as Row[]).filter(c => c.closed))).toEqual(["c-deal", "c-legacy"]);
    expect(r.body.counts).toEqual({ open: 1, signed: 1 });
  });

  test("Mine, for the setter: the deal she set (her name as the form spells it in Arabic), and her open lead", async () => {
    const r = await call("seat-tahreer", { action: "pipeline.board", scope: "mine" });
    const cards = r.body.cards as Row[];
    expect(ids(cards.filter(c => c.closed))).toContain("c-deal");
    expect(ids(cards.filter(c => !c.closed))).toEqual(["c-open"]);
  });

  test("a pipeline with no won stage: the cockpit's own Signed column", async () => {
    const saved = STAGES.splice(4, 1);
    try {
      // pipelines() keeps HighLevel's answer ten minutes: ask with a fresh read.
      await call("seat-manager", { action: "pipeline.stages", fresh: true });
      const r = await call("seat-manager", { action: "pipeline.board", scope: "team" });
      expect(r.body.closed_stage).toEqual({ id: "signed", name: "Signed", synthetic: true });
      expect((r.body.cards as Row[]).filter(c => c.client).every(c => c.stage_id === "signed")).toBe(true);
    } finally {
      STAGES.push(...saved);
      await call("seat-manager", { action: "pipeline.stages", fresh: true });
    }
  });
});

describe("pipeline.move: a client is never moved from the board", () => {
  for (const id of ["c-deal", "c-tag"]) {
    test(`${id}: 409 client, the words, no HighLevel write, no stage move written`, async () => {
      const r = await call("seat-manager", { action: "pipeline.move", contact_id: id, stage_id: "s-new", pipeline_id: PIPE });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("client");
      expect(r.body.error).toBe("This client is signed, so they stay in Closed. Client success looks after them.");
      expect(ghl.filter(g => g.method !== "GET")).toHaveLength(0);
      expect(db.t("cockpit_sales_stage_moves")).toHaveLength(0);
    });
  }

  test("a voided deal is not a client: the move goes to HighLevel and is written down", async () => {
    const r = await call("seat-manager", { action: "pipeline.move", contact_id: "c-void", stage_id: "s-new", pipeline_id: PIPE });
    expect(r.status).toBe(200);
    expect((r.body.move as Row).state).toBe("done");
    expect(ghl.filter(g => g.method === "PUT").map(g => g.path)).toEqual(["/opportunities/opp-c-void"]);
    expect(db.t("cockpit_audit_log").filter(a => a.action === "pipeline.move")).toHaveLength(1);
  });

  test("a legacy Closed lead (no tag, no deal) can still be moved out", async () => {
    const r = await call("seat-manager", { action: "pipeline.move", contact_id: "c-legacy", stage_id: "s-short", pipeline_id: PIPE });
    expect(r.status).toBe(200);
    expect((r.body.move as Row).state).toBe("done");
  });
});

describe("the other sales doors stay shut for a signed client (D54)", () => {
  const draft = (id: string, contact: string): Row => ({
    id,
    contact_id: contact,
    status: "draft",
    segment: "no_show",
    touch: 1,
    body: "Hello",
    owner_email: "boss@boardr.invalid",
    created_at: iso(NOW - 3_600_000),
  });

  test("a follow-up draft for a client signed on the form closes, saying the form; nothing is sent", async () => {
    db.seed("cockpit_sales_followups", [draft("f-deal", "c-deal")]);
    const r = await call("seat-manager", { action: "followup.approve", id: "f-deal" });
    expect([r.status, r.body.code]).toEqual([409, "client"]);
    expect(r.body.error).toBe(
      "This is an active client (signed on the New Client Form), so it stays out of the sales lists and follow-ups. Client success looks after them.",
    );
    const row = db.t("cockpit_sales_followups").find(f => f.id === "f-deal") as Row;
    expect([row.status, row.error]).toEqual(["expired", "An active client (signed on the New Client Form): kept out of sales follow-ups."]);
    expect(db.t("cockpit_audit_log").filter(a => a.action === "followup.approve")).toHaveLength(1);
    expect(ghl.filter(g => g.method !== "GET")).toHaveLength(0);
  });

  test("a tagged client's draft keeps the words the team knows", async () => {
    db.seed("cockpit_sales_followups", [draft("f-tag", "c-tag")]);
    const r = await call("seat-manager", { action: "followup.approve", id: "f-tag" });
    expect(r.body.error).toBe(
      "This is an active client (tagged client in HighLevel), so it stays out of the sales lists and follow-ups. Client success looks after them.",
    );
    expect((db.t("cockpit_sales_followups").find(f => f.id === "f-tag") as Row).error).toBe(
      "An active client (tagged client in HighLevel): kept out of sales follow-ups.",
    );
  });

  test("hot.save: a signed client is not put on the hot list", async () => {
    const r = await call("seat-manager", { action: "hot.save", contact_id: "c-deal", amount: 6000 });
    expect([r.status, r.body.code]).toEqual([409, "client"]);
    expect(db.t("cockpit_sales_hot")).toHaveLength(0);
  });

  test("hot.save: a client's row already on the list can be marked closed, and nothing else", async () => {
    db.seed("cockpit_sales_hot", [
      { contact_id: "c-deal", owner_email: "boss@boardr.invalid", status: "nurturing", added_at: iso(NOW - 9 * DAY), updated_at: iso(NOW - DAY) },
    ]);
    const edit = await call("seat-manager", { action: "hot.save", contact_id: "c-deal", note: "Still keen" });
    expect([edit.status, edit.body.code]).toEqual([409, "client"]);
    const close = await call("seat-manager", { action: "hot.save", contact_id: "c-deal", status: "closed" });
    expect(close.status).toBe(200);
    expect((db.t("cockpit_sales_hot")[0] as Row).status).toBe("closed");
    expect(db.t("cockpit_audit_log").filter(a => a.action === "hot.save")).toHaveLength(1);
  });

  test("hot.save: a voided deal is not a client", async () => {
    const r = await call("seat-manager", { action: "hot.save", contact_id: "c-void" });
    expect(r.status).toBe(200);
    expect(db.t("cockpit_sales_hot")).toHaveLength(1);
  });
});
