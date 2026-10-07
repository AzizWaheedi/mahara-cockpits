// bun test supabase/functions/sales-api/m1_numbers_r4b.test.ts
//
// Milestone 1, video-link round 4 (again), NUMBERS AND RECORDS. The pilot's
// settings (m1-scope.md section 3): rooms on for the test contact only,
// Meet and Zoom on, every send channel on, count_on_join, settle, wrap and
// auto_on_miss off, live off. What must hold on the video-link path:
//   - every room, send and mark leaves exactly one audit row;
//   - nothing books, marks or settles by itself.
//
// This round's angle: a timeline line that is the claim on an audit row
// (rooms.ts claimLine) and whose insert did not land (the database did not
// answer, nothing written). claimLine answers true on any error ("a row too
// many is better than none"), so the audit row is written, but the claim
// line is still missing: the next writer that looks for the claim (the
// worker's ready, which backfills a missing room.create record; a second
// tab's press of the same version; a retry of End) finds no line, takes the
// claim and writes the same audit row again.
//
// A test that fails here is a finding; tests named "control" pass.
// sales-api's rooms.ts on testfakes.ts. Every lead, seat and link is
// invented; nothing reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const LEAD = "stress-m1num4b-lead-0001";
const SETTER = "setter-m1num4b@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const PILOT_ROOMS = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: true,
  test_contacts: [LEAD],
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
  count_on_join: false,
  settle: false,
  wrap: false,
  short_link: false,
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro", auto_on_miss: false },
};

function world() {
  const w = fakeWorld(Date.parse("2026-10-05T08:00:00Z")); // 11:00 Kuwait, a Monday
  const audits: Row[] = [];
  const delivered: { lane: string; requestId: string; body: string }[] = [];
  const marks: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: PILOT_ROOMS },
    { key: "live", value: { enabled: false, slack: false } },
    // The WhatsApp gate shut, as in production today: the link goes by email.
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: new Date(w.clock.now - 5 * S).toISOString() }]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  const contact: Row = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@stress.invalid", tags: [], country: "KW" };
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [] };
    return null as unknown as Row;
  });
  const msgRows = new Map<string, Row>();
  const at = () => new Date(w.clock.now).toISOString();
  async function send(lane: "text" | "template" | "email", requestId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = msgRows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sent", created_at: at(), ghl_asked_at: at(), provider_status: "sent", ...extra };
    msgRows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    delivered.push({ lane, requestId, body });
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (who, id, status, opts) => {
      marks.push({ who: who.email, id, status, ...opts });
      return {};
    },
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.channel, b.body, { contact_id: b.contact_id, source: "room" }),
    sendTemplate: (_who, t) =>
      send("template", t.requestId, "whatsapp", `Your Mahara call is ready. Join here: ${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        contact_id: t.contactId,
        source: "room",
      }),
    upcoming: async () => null,
    sentSince: async (_c, _since, text, channel) => {
      if (!text) return null;
      const hit = delivered.find(d => d.body === text && (channel === "email") === (d.lane === "email"));
      return hit ? { id: `ghl-${hit.requestId.slice(0, 8)}`, status: "delivered" } : false;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  /**
   * The database does not take the next timeline line whose dedupe key
   * starts with `prefix` (a 503 before PostgREST wrote anything): nothing
   * lands, the caller sees an error.
   */
  function dropLine(prefix: string, times = 1) {
    const real = w.io.db;
    let left = times;
    w.io.db = async (path, init) => {
      const body = (init?.body ?? null) as Row | null;
      if (
        left > 0 &&
        init?.method === "POST" &&
        path.startsWith("cockpit_sales_room_events") &&
        body &&
        typeof body.dedupe_key === "string" &&
        body.dedupe_key.startsWith(prefix)
      ) {
        left -= 1;
        throw new DbError("database 503: upstream connect error or disconnect/reset before headers", 503);
      }
      return real(path, init);
    };
  }

  async function workerOpens(id: string, run = "run-1") {
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: run, version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: run }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.${run}`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: MEET_URL,
        provider_meeting_id: `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
  }
  async function ask(): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
    });
    return String((out.room as Row).id);
  }
  async function ready(id: string) {
    await workerOpens(id);
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await w.flush();
  }
  const mark = async (id: string, what: string, version = Number(room(id).version)) => {
    await rooms.actions["room.mark"]!(setter, { room_id: id, version, what });
    await w.flush();
  };
  const rowsOf = (id: string, action: string) => audits.filter(a => a.entityId === id && a.action === action).length;
  const numbers = () => ({
    marks: marks.length,
    hl_writes: w.ghlCalls.filter(c => c.method !== "GET").length,
    dispositions: w.db.t("cockpit_sales_dispositions").length,
    appointments: w.db.t("cockpit_sales_appointments").length,
  });
  return { ...w, rooms, audits, room, dropLine, ask, ready, mark, rowsOf, numbers };
}

// ---------------------------------------------------------------------------

describe("a room asked for leaves one room.create row", () => {
  test("control: the press, the worker's ready and its link: one room.create row, nothing booked or marked", async () => {
    const w = world();
    const id = await w.ask();
    await w.ready(id);
    expect({ create_rows: w.rowsOf(id, "room.create"), link_sent: Boolean(w.room(id).link_sent_at) }).toEqual({ create_rows: 1, link_sent: true });
    expect(w.numbers()).toEqual({ marks: 0, hl_writes: 0, dispositions: 0, appointments: 0 });
  });

  test("the room's 'asked' line was not taken by the database (nothing written): the press writes its row, and the worker's ready writes it again", async () => {
    const w = world();
    w.dropLine("room.asked:");
    const id = await w.ask();
    // The press itself wrote the room.create row (claimLine answered true on the error).
    const afterPress = w.rowsOf(id, "room.create");
    await w.ready(id);
    // One room, one press, one room.create row.
    expect({ after_press: afterPress, after_ready: w.rowsOf(id, "room.create") }).toEqual({ after_press: 1, after_ready: 1 });
  });
});

describe("a mark leaves one row", () => {
  test("control: I'm in the room, pressed in two tabs on the same view: one room.mark.host_in row", async () => {
    const w = world();
    const id = await w.ask();
    await w.ready(id);
    const v = Number(w.room(id).version);
    await w.mark(id, "host_in", v);
    await w.mark(id, "host_in", v);
    expect(w.rowsOf(id, "room.mark.host_in")).toBe(1);
  });

  test("I'm in the room whose line the database did not take, pressed again from the second tab's view: still one room.mark.host_in row", async () => {
    const w = world();
    const id = await w.ask();
    await w.ready(id);
    const v = Number(w.room(id).version);
    w.dropLine("room.mark.host_in:");
    await w.mark(id, "host_in", v);
    const first = w.rowsOf(id, "room.mark.host_in");
    await w.mark(id, "host_in", v);
    expect({ first, after_second_tab: w.rowsOf(id, "room.mark.host_in") }).toEqual({ first: 1, after_second_tab: 1 });
  });
});

describe("an end leaves one row", () => {
  test("control: End pressed in two tabs on the same view: one room.end row", async () => {
    const w = world();
    const id = await w.ask();
    await w.ready(id);
    const v = Number(w.room(id).version);
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "end" });
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "end" });
    await w.flush();
    expect(w.rowsOf(id, "room.end")).toBe(1);
  });

  test("End whose line the database did not take, pressed again from the second tab's view: still one room.end row", async () => {
    const w = world();
    const id = await w.ask();
    await w.ready(id);
    const v = Number(w.room(id).version);
    w.dropLine("room.end:");
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "end" });
    const first = w.rowsOf(id, "room.end");
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "end" });
    await w.flush();
    expect({ first, after_second_tab: w.rowsOf(id, "room.end") }).toEqual({ first: 1, after_second_tab: 1 });
  });
});
