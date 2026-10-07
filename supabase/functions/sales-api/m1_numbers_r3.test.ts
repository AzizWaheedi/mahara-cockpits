// bun test supabase/functions/sales-api/m1_numbers_r3.test.ts
//
// Milestone 1, video-link round 3, NUMBERS AND RECORDS. The pilot's
// settings (m1-scope.md section 3): rooms on for the test contact only,
// Meet and Zoom on, every send channel on, count_on_join, settle, wrap and
// auto_on_miss off, live off. What must hold on the video-link path:
//   - every room, send and mark leaves exactly one audit row, and the row
//     says what happened (a link that went is never recorded as not sent,
//     and an email that went is never left with no row);
//   - the health line reads the truth the room worker reports.
//
// Round 3's angle: a send whose answer was lost (HighLevel took it, the
// answer never came back), which the lead's conversation then confirms.
//
// A test that fails here is a finding; tests named "control" pass.
// sales-api's rooms.ts on testfakes.ts. Every lead, seat and link is
// invented; nothing reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const LEAD = "stress-m1num3-lead-0001";
const SETTER = "setter-m1num3@stress.invalid";
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

/** The room worker's own status row when Google's breaker is open (hermes/sales-desk desk/rooms.py sentence()). */
const GOOGLE_DOWN =
  "Working. No rooms were asked for in the last 60 seconds. Google is not answering, so new Meet rooms fail at once until it answers again.";

function world(o: { gate?: boolean; worker?: { ok: boolean; detail: string } } = {}) {
  const w = fakeWorld(Date.parse("2026-10-05T08:00:00Z")); // 11:00 Kuwait, a Monday
  const audits: Row[] = [];
  const delivered: { lane: string; requestId: string; body: string }[] = [];
  /** The next send on this lane is taken by HighLevel and its answer lost (index.ts convoSend: row unclear, 502 unclear). */
  const loseAnswer = new Set<string>();
  /** Whether the lead's conversation can be read (index.ts whatsappSentSince); unreadable answers null. */
  const convo = { readable: true };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: PILOT_ROOMS },
    { key: "live", value: { enabled: false, slack: false } },
    {
      key: "whatsapp_guard",
      value: o.gate
        ? { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 }
        : { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [
    { worker: "sales-desk", job: "rooms", ok: o.worker?.ok ?? true, detail: o.worker?.detail ?? "Working.", at: new Date(w.clock.now - 5 * S).toISOString() },
  ]);
  // The lead wrote an hour ago: WhatsApp free text is open (used with the gate open).
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - HOUR).toISOString() }]);
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
  // The message service's one rule (one request id, one message), as index.ts keeps it.
  async function send(lane: "text" | "template" | "email", requestId: string, channel: "whatsapp" | "email", body: string, extra: Row) {
    const again = msgRows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sent", created_at: at(), ghl_asked_at: at(), provider_status: "sent", ...extra };
    msgRows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    // HighLevel took it: it reaches the lead whatever happens to the answer.
    delivered.push({ lane, requestId, body });
    if (loseAnswer.delete(lane)) {
      row.state = "unclear";
      row.error = "HighLevel did not answer in time, so it may or may not have gone.";
      throw new ApiRefusal("HighLevel did not answer in time, so it may or may not have gone. Check the conversation before sending again.", 502, {
        unclear: true,
      });
    }
    return { message: { ...row } };
  }
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({}),
    sendText: (_who, b) =>
      send(b.channel === "email" ? "email" : "text", b.request_id, b.channel, b.body, { contact_id: b.contact_id, source: "room", subject: b.subject ?? null }),
    sendTemplate: (_who, t) =>
      send("template", t.requestId, "whatsapp", `Your Mahara call is ready. Join here: ${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        contact_id: t.contactId,
        source: "room",
      }),
    upcoming: async () => null,
    // index.ts sentSince: the send's own words in the lead's conversation, on its channel.
    sentSince: async (_c, _since, text, channel) => {
      if (!text) return null;
      if (!convo.readable) return null;
      const hit = delivered.find(d => d.body === text && (channel === "email") === (d.lane === "email"));
      return hit ? { id: `ghl-${hit.requestId.slice(0, 8)}`, status: "delivered" } : false;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  async function workerOpens(id: string) {
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
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
  async function make(): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
    });
    return String((out.room as Row).id);
  }
  /** A room made, opened by the worker and told ready: its link's cascade runs. */
  async function opened(): Promise<string> {
    const id = await make();
    await workerOpens(id);
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await w.flush();
    return id;
  }
  const tick = (id: string) => rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
  const ledger = (id: string) => audits.filter(a => a.entityId === id).map(a => String(a.action));
  const count = (id: string, action: string) => ledger(id).filter(a => a === action).length;
  /** Audit rows that record an email of the link going to the lead (room.send, or room.link naming email). */
  const emailRows = (id: string) =>
    audits.filter(
      a =>
        a.entityId === id &&
        (a.action === "room.send" ||
          (a.action === "room.link" && Array.isArray((a.after as Row | undefined)?.link_channels) && ((a.after as Row).link_channels as string[]).includes("email") &&
            !((a.before as Row | undefined)?.link_sent_at))),
    ).length;
  return { ...w, rooms, audits, delivered, loseAnswer, convo, room, opened, tick, ledger, count, emailRows };
}

async function answer(p: Promise<Row>): Promise<{ ok: Row | null; refused: ApiRefusal | null }> {
  try {
    return { ok: await p, refused: null };
  } catch (e) {
    if (e instanceof ApiRefusal) return { ok: null, refused: e };
    throw e;
  }
}

// ---------------------------------------------------------------------------

describe("control: Also send by email, answered", () => {
  test("control: the link went by WhatsApp; Also send by email goes and leaves one room.send row", async () => {
    const w = world({ gate: true });
    const id = await w.opened();
    expect(w.delivered.map(d => d.lane)).toEqual(["text"]);
    await w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() });
    await w.flush();
    expect(w.delivered.map(d => d.lane)).toEqual(["text", "email"]);
    expect(w.count(id, "room.send")).toBe(1);
  });
});

describe("an email that went always has its audit row", () => {
  test("Also send by email whose answer was lost, found at once in the lead's conversation: the email reached the lead, so a row records it", async () => {
    const w = world({ gate: true });
    const id = await w.opened();
    const before = w.ledger(id);
    w.loseAnswer.add("email");
    const out = await answer(w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() }));
    await w.flush();
    // One email reached the lead (HighLevel took it; its answer was lost and
    // the conversation shows it), and the room says it went by email.
    expect(w.delivered.filter(d => d.lane === "email")).toHaveLength(1);
    expect(w.room(id).link_channels).toContain("email");
    // The press answers that the email had already gone (it went on this press).
    const said = out.ok?.note ?? out.refused?.message ?? null;
    // What the press wrote to the audit log for this room: a row recording that email.
    const added = w.ledger(id).slice(before.length);
    expect({ added, email_rows: w.emailRows(id), said }).toEqual({ added: expect.arrayContaining(["room.send"]), email_rows: 1, said });
  });
});

describe("a link that went is never recorded as not sent", () => {
  test("the gate shut (production): the link's email answer was lost and the conversation could not be read yet; a minute on it is confirmed there: no room.link.not_sent row stands for a link that went", async () => {
    const w = world(); // the WhatsApp gate shut, as in production today: the link goes by email
    w.loseAnswer.add("email");
    w.convo.readable = false;
    const id = await w.opened();
    expect(w.delivered.map(d => d.lane)).toEqual(["email"]);
    expect(w.room(id).link_sent_at ?? null).toBeNull();
    // A minute on, the conversation reads, and the sweep's tick asks again.
    w.convo.readable = true;
    w.clock.now += MIN;
    await w.tick(id);
    await w.flush();
    expect(w.room(id).link_sent_at).toBeTruthy();
    expect(w.delivered).toHaveLength(1);
    expect(w.count(id, "room.link")).toBe(1);
    // The ledger for this one email: it went (room.link), and nothing says it did not.
    expect(w.ledger(id).filter(a => a.startsWith("room.link"))).toEqual(["room.link.unclear", "room.link"]);
  });
});

describe("the health line reads what the room worker reports", () => {
  test("control: the worker's fresh row says Working: the line says working", async () => {
    const w = world({ gate: true });
    const id = await w.opened();
    const st = await w.rooms.actions["room.status"]!(setter, { room_id: id });
    expect((st.health as Row).worker_ok).toBe(true);
  });

  test("the worker's fresh row says Google is not answering and new Meet rooms fail at once (ok false): the panel's health line does not say Rooms: working", async () => {
    const w = world({ gate: true, worker: { ok: false, detail: GOOGLE_DOWN } });
    const id = await w.opened();
    const st = await w.rooms.actions["room.status"]!(setter, { room_id: id });
    const h = st.health as Row;
    expect({ worker_ok: h.worker_ok, says_working: String(h.line).startsWith("Rooms: working") }).toEqual({ worker_ok: false, says_working: false });
  });
});
