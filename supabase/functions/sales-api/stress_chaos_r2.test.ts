// bun test supabase/functions/sales-api/stress_chaos_r2.test.ts
//
// Chaos round 2 (3 October 2026), sales-api's side: outside dependencies
// failing half-way through a step, and what the room, the intro and the
// person pressing are left with. The bar the CEO set: every room ends in a
// named state, nothing is sent or booked twice, and a person is told what to
// do. The SQL halves are in supabase/migrations/tests/stress_chaos.py (C3,
// C4); the desk's in hermes/sales-desk/tests/test_stress_chaos_r2.py.
//
// Tests marked HELD pass today and stay as regression tests. The others state
// the behaviour asked for and fail until it is fixed.
import { describe, expect, test } from "bun:test";
import { makeFollowupAgent } from "./followupAgent.ts";
import type { Who } from "./lib.ts";
import { DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const LEAD = "stress-chaos-lead-1";
const SETTER = "setter@maharamedia.com";
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

// ---------------------------------------------------------------------------
// The settle and a Zoom join the door could not place
// ---------------------------------------------------------------------------

function settleWorld() {
  const w = fakeWorld();
  const marks: Row[] = [];
  const audits: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, providers: { zoom: true, meet: true } } },
    { key: "live", value: { enabled: false } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => (m === "GET" && p === `/contacts/${LEAD}` ? { contact } : (null as unknown as Row)));
  const start = w.clock.now - 25 * MIN;
  w.db.seed("cockpit_sales_appointments", [
    { appointment_id: "appt-1", contact_id: LEAD, calendar_id: "cal-intro", call_type: "intro", start_at: new Date(start).toISOString(), status: "confirmed" },
  ]);
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (_who, id, status) => {
      marks.push({ id, status });
      return { id: fakeUuid(), status };
    },
    sendText: async () => ({ message: { state: "sent" } }),
    sendTemplate: async () => ({ message: { state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  return { ...w, rooms, marks, audits, start };
}

describe("chaos: the settle", () => {
  test("the lead's Zoom join was stored with no room (the door's 500 ms lookup ran out) and never read: the intro is not marked a no-show", async () => {
    const w = settleWorld();
    const roomId = fakeUuid();
    // The Zoom fallback room for the intro closed as "the lead did not join"
    // (the SQL sweep's R4 cannot see a join stored with room_id null).
    w.db.seed("cockpit_sales_rooms", [
      {
        id: roomId,
        request_id: fakeUuid(),
        code: "K7Q2MX",
        contact_id: LEAD,
        purpose: "fallback",
        call_kind: "intro",
        provider: "zoom",
        host_email: SETTER,
        made_by: SETTER,
        state: "expired",
        result: "no_join",
        end_reason: "lead_no_show",
        version: 5,
        join_url: "https://us06web.zoom.us/j/81234567890?pwd=abc",
        provider_meeting_id: "81234567890",
        appointment_id: "appt-1",
        appointment_start_at: new Date(w.start).toISOString(),
        requested_at: new Date(w.start + MIN).toISOString(),
        opened_at: new Date(w.start + MIN).toISOString(),
        link_sent_at: new Date(w.start + 2 * MIN).toISOString(),
        host_in_at: new Date(w.start + 2 * MIN).toISOString(),
        ended_at: new Date(w.start + 13 * MIN).toISOString(),
      },
    ]);
    // The join the door kept "with no room" for sales-api to place: sales-api
    // was down, so it is still unhandled.
    w.db.seed("cockpit_sales_room_events", [
      {
        id: fakeUuid(),
        room_id: null,
        kind: "zoom.meeting.participant_joined",
        source: "zoom",
        dedupe_key: "zoom:meeting.participant_joined:81234567890:lead:1",
        at: new Date(w.start + 4 * MIN).toISOString(),
        handled_at: null,
        tries: 0,
        detail: {
          event: "meeting.participant_joined",
          payload: { object: { id: "81234567890", topic: "Mahara call K7Q2MX", participant: { user_name: "Huda", email: "huda@example.com" } } },
        },
      },
      {
        id: fakeUuid(),
        room_id: roomId,
        kind: "sweep.settle",
        source: "settle",
        dedupe_key: `sweep.settle:${roomId}`,
        at: new Date(w.clock.now - MIN).toISOString(),
        handled_at: null,
        tries: 1,
        detail: { appointment_id: "appt-1" },
      },
    ]);
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [roomId] } });
    await w.flush();
    // A no-show is a hard number in B2B's show rate: a stored, unread join
    // for this room's meeting is a doubt, wherever the door could file it.
    expect(w.marks.filter(m => m.status === "noshow")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Approve all, half-way through a database stall
// ---------------------------------------------------------------------------

describe("chaos: Approve all", () => {
  const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@maharamedia.com" };
  const GATE = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" };

  function agentWorld() {
    const w = fakeWorld(Date.parse("2026-10-04T08:00:00Z"));
    const audits: Row[] = [];
    w.db.seed("cockpit_sales_settings", [
      { key: "whatsapp_guard", value: GATE },
      { key: "followups", value: { enabled: true, waves: { per_day: 40, batch_gap_s: 45 }, first_hours: [9, 18] } },
      { key: "messaging", value: { whatsapp: true } },
    ]);
    const agent = makeFollowupAgent({
      io: w.io,
      audit: async (who, action, entityType, entityId, before, after, metadata) => {
        audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
      },
      sendFollowup: async () => ({ followup: { status: "sent" }, message: { state: "sent" } }),
      whatsappHealth: async () => ({ paused: false, why: "" }),
    });
    const ids = Array.from({ length: 20 }, (_, i) => {
      const id = fakeUuid();
      w.db.seed("cockpit_sales_followups", [
        { id, contact_id: `stress-chaos-c${i}`, segment: "reactivate", channel: "whatsapp_template", status: "draft", touch: 1, body: "Hi", created_at: w.db.iso() },
      ]);
      return id;
    });
    return { ...w, agent, audits, ids };
  }

  test("the database stalls on the 11th opener: every opener that will now go to a lead has an audit row, and the answer says what went through", async () => {
    const w = agentWorld();
    // The 11th approval's write does not answer (a stall, a deploy of the database's pooler).
    w.db.faults.push({ prefix: `cockpit_sales_followup_meta?followup_id=eq.${w.ids[10]}`, error: new DbError("database: no answer within 8 s", 0), times: 9 });
    let thrown: unknown = null;
    let answer: Row | null = null;
    try {
      answer = await w.agent.actions["followup.batch"]!(boss, { request_id: crypto.randomUUID(), ids: w.ids });
    } catch (e) {
      thrown = e;
    }
    const scheduled = w.db.t("cockpit_sales_followup_meta").filter(m => m.send_after && m.approved_by === boss.email).map(m => String(m.followup_id));
    const audited = w.audits.filter(a => a.action === "followup.batch").flatMap(a => ((a.metadata as Row)?.ids as string[]) ?? []);
    // What the desk will send to real leads (scheduled) is exactly what the
    // audit says a manager approved: never a send nobody can trace.
    expect([...scheduled].sort()).toEqual([...new Set(audited)].sort());
    // And the manager is not left with a bare "That did not work": either it
    // all went through, or the answer names what did (a refusal with a count).
    if (thrown) expect(String((thrown as Error).message)).toMatch(/approved|scheduled|went through/i);
    else expect(answer).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A link whose send may have gone, re-asked every minute
// ---------------------------------------------------------------------------

describe("chaos: the link that may have gone", () => {
  test("HighLevel's answer to the WhatsApp text is lost: the minute re-asks never send again, and the timeline says it once, not once a minute", async () => {
    const w = fakeWorld();
    const audits: Row[] = [];
    const rows = new Map<string, Row>();
    const attempts: string[] = [];
    w.db.seed("cockpit_sales_settings", [
      {
        key: "rooms",
        value: {
          ...DEFAULT_ROOMS_JSON,
          enabled: true,
          test_only: false,
          providers: { zoom: true, meet: true },
          send: { whatsapp_text: true, whatsapp_template: false, email: false },
          fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
        },
      },
      { key: "live", value: { enabled: false } },
      { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
      { key: "messaging", value: { whatsapp: true, email: true } },
    ]);
    w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
    w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: null, zoom_status: "pending", google_ok: true }]);
    w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - 3_600_000).toISOString() }]);
    const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" };
    w.routes.push((m, p) => (m === "GET" && p === `/contacts/${LEAD}` ? { contact } : (null as unknown as Row)));
    const { ApiRefusal } = await import("./liveio.ts");
    const deps: RoomDeps = {
      io: w.io,
      audit: async (who, action, entityType, entityId, before, after, metadata) => {
        audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
      },
      markAppointment: async () => ({}),
      // convoSend as index.ts writes it: the row first; HighLevel took the
      // text and its answer was lost, so the row is "unclear"; a repeat of
      // the request id answers the row as it stands.
      sendText: async (_who, b) => {
        attempts.push(b.request_id);
        const again = rows.get(b.request_id);
        if (again) return { message: { ...again }, repeated: true };
        rows.set(b.request_id, { id: fakeUuid(), request_id: b.request_id, state: "unclear", created_at: new Date(w.clock.now).toISOString() });
        throw new ApiRefusal("The send may have gone; read the conversation in HighLevel before writing to the lead again (HighLevel did not answer within 25 seconds)", 502, { unclear: true });
      },
      sendTemplate: async () => {
        throw new Error("no template in this test");
      },
      upcoming: async () => null,
      // HighLevel's conversation does not show it yet (Meta is slow).
      sentSince: async () => false,
    };
    const rooms = makeRooms(deps);
    const out = await rooms.actions["room.create"]!(
      { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" },
      { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" },
    );
    const id = String((out.room as Row).id);
    // The room worker's handshake: claim, worker.ready stored, open.
    const room = () => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(room().version) + 1 },
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
        join_url: "https://meet.google.com/abc-defg-hij",
        provider_meeting_id: "evt-1",
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room().version) + 1,
      },
    });
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    // The SQL sweep's tick, every minute for eight minutes.
    for (let minute = 0; minute < 8; minute++) {
      w.clock.now += 61 * S;
      await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
      await w.flush();
    }
    // HELD part: one request id, so nothing reached the lead twice.
    expect(new Set(attempts).size).toBe(1);
    // The panel's timeline (room.status shows the last 20 lines) and the
    // audit log say "may have gone" once, not once a minute: eight copies
    // push the room's real history (made, opened, knocked) off the panel.
    const lines = w.db.t("cockpit_sales_room_events").filter(e => e.room_id === id && e.kind === "link.not_sent");
    const unclear = audits.filter(a => a.action === "room.link.unclear" && a.entityId === id);
    expect([lines.length, unclear.length]).toEqual([1, 1]);
  });
});
