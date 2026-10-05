// bun test supabase/functions/sales-api/stress2_concurrency_r6_marks.test.ts
//
// Second series, round 6, dimension: concurrency and idempotency. The
// settle's no-show and a rep's own mark of the same intro, end to end
// through index.ts (the real handler, the real rooms module, the real
// markAppointment), with the outside world faked at fetch.
//
// Round 1 (settle-supersedes-fresh-rep-mark) made the timer's mark land only
// where nobody marked the call (onlyIfUnmarked), and round 4 put the two
// writes of a mark under the call's lock (cockpit_sales_disposition_replace).
// Both guard the cockpit's own row. HighLevel's copy of the mark, the one
// B2B's show rate reads, is written after the row by writeMarkToCrm: a PUT
// with no check of which mark is current when it lands, and no order between
// two marks' PUTs.
//
// The setter got Huda on her mobile after the room closed and they talked;
// at the intro's start + 20 minutes the sweep's settle writes its no-show
// (the cockpit's row first, then HighLevel's PUT, which is slow: HighLevel
// shares one location with the mirror and the desk). The setter presses
// Showed on the dialer in those seconds: the cockpit's current mark becomes
// her showed, and her PUT lands. Then the settle's PUT lands: HighLevel says
// no-show, the cockpit says showed, and nothing ever compares them again.
// B2B's show rate counts a no-show for an intro the lead attended, and the
// room says the timer settled it.
//
// A failing test is a finding for the fix agent. Nothing leaves this
// process; every lead is invented.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { FakeDb } from "./testfakes.ts";

type Row = Record<string, unknown>;

const DB = "https://db.stress.invalid";
const GHL = "https://services.leadconnectorhq.com";
const SETTER = "setter-r6m@stress.invalid";
const LEAD = "stress-r6-mark-lead";
const APPT = "stress-r6-intro-1";
const clock = {
  get now() {
    return Date.now();
  },
};
const db = new FakeDb(clock as { now: number });
let handler: ((req: Request) => Promise<Response>) | undefined;

/** HighLevel's own copy of the intro (B2B's show rate reads this). */
const hl = { status: "confirmed", start: "" };
/** The settle's no-show PUT waits here until the test lets it land. */
let holdNoshow: { reached: () => void; release: Promise<void> } | null = null;

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function jwt(claims: Row): string {
  const b = (o: Row) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256", typ: "JWT" })}.${b(claims)}.sig`;
}

async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? "GET").toUpperCase();
  if (url.startsWith(`${DB}/rest/v1/rpc/cockpit_sales_whoami`))
    return reply({ signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" });
  if (url.startsWith(`${DB}/rest/v1/rpc/`)) {
    const fn = url.slice(`${DB}/rest/v1/rpc/`.length).split("?")[0] as string;
    try {
      return reply(await db.rpc(fn, init.body ? JSON.parse(String(init.body)) : {}));
    } catch (e) {
      return reply({ code: (e as DbError).code, message: String((e as Error).message) }, (e as DbError).status ?? 500);
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
    const path = url.slice(GHL.length).split("?")[0] as string;
    if (method === "GET" && path === `/contacts/${LEAD}`)
      return reply({ contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], dndSettings: {} } });
    if (path === `/calendars/events/appointments/${APPT}`) {
      if (method === "GET")
        return reply({
          appointment: { id: APPT, contactId: LEAD, calendarId: "cal-intro", appointmentStatus: hl.status, startTime: hl.start, assignedUserId: "G-setter" },
        });
      if (method === "PUT") {
        const want = String((JSON.parse(String(init.body ?? "{}")) as Row).appointmentStatus ?? "");
        if (want === "noshow" && holdNoshow) {
          const h = holdNoshow;
          holdNoshow = null;
          h.reached();
          await h.release;
        }
        hl.status = want;
        return reply({ succeeded: true });
      }
    }
    return reply({ message: `no fake for ${method} ${path}` }, 404);
  }
  throw new Error(`no fake for ${method} ${url}`);
}

const before = { fetch: globalThis.fetch, deno: (globalThis as unknown as { Deno?: unknown }).Deno };

afterAll(() => {
  globalThis.fetch = before.fetch;
  (globalThis as unknown as { Deno?: unknown }).Deno = before.deno;
});

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
      (globalThis as unknown as { __salesApiHandler?: unknown }).__salesApiHandler = h;
    },
  };
  globalThis.fetch = fakeFetch as typeof fetch;
  // A module instance of its own (the query string), as the other end-to-end
  // tests load it: its live-call IO keeps this file's fetch, whichever test
  // file loaded index.ts first in this process.
  await import("./index.ts?stress2_concurrency_r6_marks");
  handler ??= (globalThis as unknown as { __salesApiHandler?: typeof handler }).__salesApiHandler as typeof handler;
});

async function call(body: Row, as: "setter" | "desk"): Promise<{ status: number; body: Row }> {
  const token = as === "desk" ? jwt({ role: "service_role" }) : jwt({ role: "authenticated", sub: "u-setter" });
  const res = await handler!(
    new Request("https://sales-api.stress.invalid/", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

/** cockpit_sales_disposition_replace as 20261004a makes it (one step under the call's lock). */
function replaceRpc(): void {
  let next = 1;
  db.rpcs.cockpit_sales_disposition_replace = (a: Row) => {
    const row = a.p_row as Row;
    const cur = db
      .t("cockpit_sales_dispositions")
      .filter(d => d.appointment_id === row.appointment_id && !d.superseded_at)
      .sort((x, y) => Number(y.id) - Number(x.id))[0];
    if ((cur ? Number(cur.id) : null) !== (a.p_current_id ?? null)) return [];
    if (cur) cur.superseded_at = new Date().toISOString();
    const made = { id: next++, ...row, crm: row.crm ?? "off", superseded_at: null, marked_at: new Date().toISOString() };
    db.t("cockpit_sales_dispositions").push(made);
    return [made];
  };
}

function seed(): string {
  db.tables = {};
  replaceRpc();
  const start = Date.now() - 21 * 60_000;
  hl.status = "confirmed";
  hl.start = new Date(start).toISOString();
  db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, short_link: true, providers: { zoom: true, meet: true } } },
    { key: "live", value: { enabled: false } },
    { key: "crm_writes", value: { dispositions: true, backlog_days: 7 } },
  ]);
  db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  db.seed("cockpit_sales_appointments", [
    { appointment_id: APPT, contact_id: LEAD, call_type: "intro", calendar_id: "cal-intro", status: "confirmed", start_at: new Date(start).toISOString(), assigned_user_id: "G-setter" },
  ]);
  const id = "00000000-0000-4000-8000-000000000a61";
  // The setter's Meet fallback room for the intro: the short link went, nobody opened it, R4 closed it.
  db.seed("cockpit_sales_rooms", [
    {
      id,
      request_id: "00000000-0000-4000-8000-0000000000b1",
      code: "K7Q2MX",
      contact_id: LEAD,
      purpose: "fallback",
      trigger: "no_answer",
      call_kind: "intro",
      provider: "meet",
      host_email: SETTER,
      made_by: SETTER,
      appointment_id: APPT,
      appointment_start_at: new Date(start).toISOString(),
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
      join_url: "https://meet.google.com/abc-defg-hij",
      requested_at: new Date(start + 60_000).toISOString(),
      opened_at: new Date(start + 60_000).toISOString(),
      link_sent_at: new Date(start + 2 * 60_000).toISOString(),
      link_channels: ["whatsapp_text"],
      ended_at: new Date(start + 15 * 60_000).toISOString(),
      version: 4,
    },
  ]);
  // The sweep's S1 stored the settle (source settle), and posts its room id.
  db.seed("cockpit_sales_room_events", [
    { id: "00000000-0000-4000-8000-0000000000e1", room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due to be settled.", tries: 0 },
  ]);
  return id;
}

describe("concurrency r6: the settle's no-show and the rep's Showed, HighLevel's copy", () => {
  test("settle-noshow-put-lands-after-rep-showed: HighLevel ends with the mark the cockpit holds", async () => {
    const roomId = seed();
    let reached!: () => void;
    const atPut = new Promise<void>(r => {
      reached = r;
    });
    let release!: () => void;
    holdNoshow = { reached: () => reached(), release: new Promise<void>(r => (release = r)) };
    // The sweep's settle: the cockpit's no-show row, then HighLevel's PUT (slow).
    const settle = call({ action: "room.event", kind: "sweep.settle", payload: { room_ids: [roomId] } }, "desk");
    await atPut;
    // Meanwhile the setter marks the intro Showed on the dialer (she talked to Huda on her mobile).
    const mine = await call({ action: "mark", appointment_id: APPT, status: "showed", note: "Talked on WhatsApp call" }, "setter");
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    // HighLevel answers the settle's PUT last.
    release();
    const settled = await settle;
    const current = db.t("cockpit_sales_dispositions").filter(d => d.appointment_id === APPT && !d.superseded_at);
    const room = db.t("cockpit_sales_rooms").find(r => r.id === roomId) as Row;
    expect(
      { cockpit: current.map(d => `${d.status} by ${d.marked_by}`), highlevel: hl.status },
      `the cockpit's current mark is the setter's, HighLevel (B2B's show rate) has the settle's no-show; the room says settled_mark ${String(room.settled_mark)}; settle answered ${JSON.stringify(settled.body).slice(0, 200)}`,
    ).toEqual({ cockpit: [`showed by ${SETTER}`], highlevel: "showed" });
  }, 60_000);
});
