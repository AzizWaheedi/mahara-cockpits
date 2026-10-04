// bun test supabase/functions/sales-api/rooms.stress.test.ts
// The build brief's stress bar for rooms.ts, on testfakes.ts: fifty claims
// at once, the same request id again and again, duplicate and late Zoom
// events, a crash in the middle of a step, and provider failures. The fake
// database interleaves at every await, the way concurrent requests do.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, DbError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const LEAD = "VjPfR4Cc1Y0OFvaqeor5";
const SETTER = "setter@maharamedia.com";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/** A small seeded random source, so a failing run can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function world(seed = 1, failText = 0) {
  const w = fakeWorld();
  const rand = rng(seed);
  const sent = new Map<string, Row>();
  let attempts = 0;
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...DEFAULT_ROOMS_JSON, enabled: true, providers: { zoom: true, meet: true }, send: { whatsapp_text: true, whatsapp_template: false, email: true }, count_on_join: true, test_calendar_id: "TESTCAL" } },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, google_ok: true, zoom_status: "pending" }]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - 3_600_000).toISOString() }]);
  const bookings: Row[] = [];
  w.routes.push((m, p, body) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact: { firstName: "Huda", phone: "+96550000000", email: "h@example.com", tags: ["cockpit-test"] } };
    if (m === "POST" && p === "/calendars/events/appointments") {
      const id = `bk-${bookings.length + 1}`;
      bookings.push({ id, ...(body as Row) });
      return { id };
    }
    if (m === "DELETE") {
      const id = p.split("/").pop();
      const i = bookings.findIndex(b => b.id === id);
      if (i >= 0) bookings.splice(i, 1);
      return { ok: true };
    }
    if (m === "PUT") return { ok: true };
    return null as unknown as Row;
  });
  const rooms = makeRooms({
    io: w.io,
    audit: async () => {},
    markAppointment: async () => ({}),
    // convoSend's own rule: a request id is one message, whatever happens after.
    sendText: async (_who, b) => {
      const again = sent.get(b.request_id);
      if (again) return { message: again, repeated: true };
      attempts++;
      if (rand() < failText) {
        // convoSend writes the row before HighLevel answers: a failed send stays failed under its request id.
        sent.set(b.request_id, { id: fakeUuid(), state: "failed", channel: b.channel, error: "HighLevel did not send it: 503" });
        throw new ApiRefusal("HighLevel did not send it: 503", 502);
      }
      const m = { id: fakeUuid(), state: "sent", channel: b.channel };
      sent.set(b.request_id, m);
      return { message: m };
    },
    sendTemplate: async () => {
      throw new ApiRefusal("not used", 409);
    },
    upcoming: async () => null,
  });
  async function openRoom(): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const id = String((out.room as Row).id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { state: "creating", version: 2, claimed_at: w.db.iso(), worker_run: "r" } });
    await w.io.db("cockpit_sales_room_events", { method: "POST", body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}` } });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, {
      method: "PATCH",
      body: { state: "open", version: 3, join_url: MEET_URL, opened_at: w.db.iso(), host_by: new Date(w.clock.now + 900 * S).toISOString(), ends_at: new Date(w.clock.now + 1800 * S).toISOString() },
    });
    return id;
  }
  /** The same room on Zoom, on meeting "1": Zoom's events drive only a Zoom room on its own meeting (final review). */
  async function openZoomRoom(): Promise<string> {
    const id = await openRoom();
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, {
      method: "PATCH",
      body: { provider: "zoom", provider_meeting_id: "1", join_url: "https://us06web.zoom.us/j/1?pwd=stress" },
    });
    return id;
  }
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, rand, rooms, sent, bookings, openRoom, openZoomRoom, room, attempts: () => attempts };
}

describe("fifty at once", () => {
  test("fifty creates with one request id make one room; fifty with their own ids for one lead make one room", async () => {
    const w = world();
    const request_id = crypto.randomUUID();
    const body = { request_id, contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" };
    const outs = await Promise.allSettled(Array.from({ length: 50 }, () => w.rooms.actions["room.create"]!(setter, body)));
    expect(outs.every(o => o.status === "fulfilled")).toBe(true);
    expect(new Set(outs.map(o => (o.status === "fulfilled" ? (o.value.room as Row).id : null))).size).toBe(1);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(1);

    const w2 = world();
    const many = await Promise.allSettled(
      Array.from({ length: 50 }, () => w2.rooms.actions["room.create"]!(setter, { ...body, request_id: crypto.randomUUID() })),
    );
    expect(many.filter(o => o.status === "fulfilled")).toHaveLength(1);
    const codes = many.flatMap(o => (o.status === "rejected" ? [(o.reason as ApiRefusal).extra.code] : []));
    expect(new Set(codes)).toEqual(new Set(["lead_has_room"]));
    expect(w2.db.t("cockpit_sales_rooms")).toHaveLength(1);
  });

  test("fifty worker.ready calls at once (the worker and every replay): one handled, one message", async () => {
    const w = world();
    const id = await w.openRoom();
    const outs = await Promise.all(Array.from({ length: 50 }, () => w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} })));
    await w.flush();
    expect(outs.filter(o => o.handled)).toHaveLength(1);
    expect(w.sent.size).toBe(1);
    expect(w.room(id).link_channels).toEqual(["whatsapp_text"]);
  });

  test("fifty copies of the lead's join (Zoom's retries, the replay) count the join once and book once", async () => {
    const w = world();
    const id = await w.openZoomRoom();
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const eid = fakeUuid();
      ids.push(eid);
      w.db.seed("cockpit_sales_room_events", [
        {
          id: eid,
          room_id: id,
          kind: "zoom.meeting.participant_joined",
          source: "zoom",
          dedupe_key: `zoom:join:${eid}`,
          detail: { event: "meeting.participant_joined", event_ts: w.clock.now, payload: { object: { id: "1", participant: { email: "huda@example.com", join_time: new Date(w.clock.now).toISOString() } } } },
        },
      ]);
    }
    await Promise.all(ids.map(eid => w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: eid, payload: {} }).catch(() => null)));
    await w.flush();
    expect(w.room(id).state).toBe("lead_in");
    expect(w.bookings).toHaveLength(1);
    expect(w.bookings[0]).toMatchObject({ calendarId: "TESTCAL" });
    expect(w.db.t("cockpit_sales_room_events").filter(e => e.kind === "zoom.meeting.participant_joined" && !e.handled_at)).toHaveLength(0);
  });
});

describe("crashes and failures", () => {
  test("on 40 seeds, HighLevel failing a third of sends and the database failing writes at random: the lead gets exactly one link, in the end", async () => {
    const outcomes: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const w = world(seed, 0.33);
      const id = await w.openRoom();
      // The database drops one write in five while the link is recorded.
      const flaky = (prefix: string) => {
        if (w.rand() < 0.2) w.db.faults.push({ prefix, method: "PATCH", error: new DbError("database 503: try again", 503), times: 1 });
      };
      flaky("cockpit_sales_rooms");
      await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} }).catch(() => null);
      await w.flush();
      // The sweep's tick, every minute, until the link is recorded (or 20 minutes).
      for (let minute = 0; minute < 20 && !w.room(id).link_sent_at; minute++) {
        w.clock.now += 61 * S;
        flaky("cockpit_sales_rooms");
        await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } }).catch(() => null);
        await w.flush();
        // A worker.ready the crash left unhandled is replayed like the sweep would.
        const ev = w.db.t("cockpit_sales_room_events").find(e => e.kind === "worker.ready" && !e.handled_at);
        if (ev) {
          ev.lease_until = null;
          await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [ev.id] } }).catch(() => null);
          await w.flush();
        }
      }
      const r = w.room(id);
      // At most one message reached the lead, and the room says what happened:
      // the channel it went on, or (both channels failed at HighLevel, which a
      // re-ask never sends again under the same request id) why it did not go.
      const went = [...w.sent.values()].filter(m => m.state === "sent");
      expect([seed, went.length <= 1]).toEqual([seed, true]);
      if (went.length === 1) {
        expect(r.link_sent_at).toBeTruthy();
        expect(r.link_channels).toEqual([went[0]?.channel === "email" ? "email" : "whatsapp_text"]);
      } else {
        expect(r.link_sent_at ?? null).toBeNull();
        expect(String(r.refusal)).toContain("HighLevel did not send it");
      }
      outcomes.push(went.length);
    }
    // Most runs get the link through despite the faults.
    expect(outcomes.filter(n => n === 1).length).toBeGreaterThan(30);
  });

  test("a database outage while a room is read answers an error, and leaves the event for the replay", async () => {
    const w = world();
    const id = await w.openRoom();
    w.db.faults.push({ prefix: "cockpit_sales_rooms?id=eq.", method: "GET", error: new DbError("database: no answer within 8 s", 0), times: 1 });
    const err = await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} }).then(() => null, e => e as Error);
    expect(err?.message).toContain("no answer");
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.kind === "worker.ready") as Row;
    // Held by the lease until it runs out; never handled, so the sweep replays it.
    expect(ev.handled_at).toBeNull();
    w.clock.now += 31 * S;
    const again = await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [ev.id] } });
    expect(again.handled).toBe(1);
  });

  test("a late Zoom end for an earlier session, after the lead joined again, changes nothing", async () => {
    const w = world();
    const id = await w.openZoomRoom();
    const t = w.clock.now;
    const store = (event: string, at: number, participant?: Row) => {
      const eid = fakeUuid();
      w.db.seed("cockpit_sales_room_events", [
        { id: eid, room_id: id, kind: `zoom.${event}`, source: "zoom", dedupe_key: `z:${eid}`, detail: { event, event_ts: at, payload: { object: { id: "1", ...(participant ? { participant } : {}) } } } },
      ]);
      return eid;
    };
    const join = store("meeting.participant_joined", t + 10 * S, { email: "huda@example.com", join_time: new Date(t + 10 * S).toISOString() });
    w.clock.now += 20 * S;
    await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: join, payload: {} });
    const lateEnd = store("meeting.ended", t + 5 * S);
    await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.ended", event_id: lateEnd, payload: {} });
    expect(w.room(id).state).toBe("lead_in");
  });
});
