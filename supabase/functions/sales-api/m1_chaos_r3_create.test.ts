// bun test supabase/functions/sales-api/m1_chaos_r3_create.test.ts
//
// Milestone 1, video-link round 3, chaos at the press: the rep presses Send
// a video link and the room's insert lands while its answer is lost (a
// timeout, a cut connection). The worker makes the room and the link goes
// to the lead; the rep's screen says the answer did not come back and asks
// them to check the lead's room before trying again (videoLink CREATE_LOST),
// so the rep does not press again.
//
// What must hold: the room the rep asked for has its room.create audit row
// (who asked, for which lead, on which provider) and its "asked" line, as
// every write leaves an audit row; and the lead gets the link once.
//
// sales-api's rooms.ts on testfakes.ts; every lead, seat and link is
// invented; nothing reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DbError, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const LEAD = "stress-m1chaos3-create-0001";
const SETTER = "setter-m1chaos3c@stress.invalid";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

function world() {
  const w = fakeWorld(Date.parse("2026-10-05T08:00:00Z")); // 11:00 Kuwait, a Monday
  const audits: Row[] = [];
  const delivered: { requestId: string; body: string }[] = [];
  let lostInsert = 0;
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: true,
        test_contacts: [LEAD],
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        short_link: false,
      },
    },
    { key: "live", value: { enabled: false, slack: false } },
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: new Date(w.clock.now - 5 * S).toISOString() }]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - 60 * MIN).toISOString() }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: [], country: "KW" };
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [] };
    return null as unknown as Row;
  });
  const io: LiveIO = {
    ...w.io,
    db: async (path, init = {}) => {
      if (lostInsert > 0 && path === "cockpit_sales_rooms" && String(init.method ?? "GET").toUpperCase() === "POST") {
        lostInsert--;
        await w.io.db(path, init);
        throw new DbError("database: no answer within 8 s", 0);
      }
      return await w.io.db(path, init);
    },
  };
  const rows = new Map<string, Row>();
  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => {
      throw new Error("no mark in Milestone 1's link path");
    },
    sendText: async (_who, b) => {
      const again = rows.get(b.request_id);
      if (again) return { message: { ...again }, repeated: true };
      const row: Row = { id: fakeUuid(), request_id: b.request_id, channel: b.channel, body: b.body, state: "sent", provider_status: "sent", created_at: new Date(w.clock.now).toISOString(), contact_id: b.contact_id, source: "room" };
      rows.set(b.request_id, row);
      w.db.t("cockpit_sales_messages").push(row);
      delivered.push({ requestId: b.request_id, body: b.body });
      return { message: { ...row } };
    },
    sendTemplate: async () => {
      throw new Error("no template in this test");
    },
    upcoming: async () => null,
    sentSince: async () => null,
  };
  const rooms = makeRooms(deps);
  return {
    ...w,
    rooms,
    audits,
    delivered,
    loseInsert: () => {
      lostInsert = 1;
    },
  };
}

describe("m1 chaos r3: the room's insert lands and the press's answer is lost", () => {
  test("HELD: with no blip the press leaves its room.create audit row", async () => {
    const w = world();
    const out = await w.rooms.actions["room.create"]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const id = String((out.room as Row).id);
    expect(w.audits.filter(a => a.action === "room.create" && a.entityId === id).length).toBe(1);
  });

  test("m1-chaos-r3-create-lost-answer-no-audit-row: the insert lands, its answer is lost, the rep is told to check before trying again: the room still gets its room.create audit row once it is made and its link goes", async () => {
    const w = world();
    w.loseInsert();
    let said = "";
    try {
      await w.rooms.actions["room.create"]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    } catch (e) {
      said = String((e as Error).message);
    }
    const room = w.db.t("cockpit_sales_rooms").find(r => r.contact_id === LEAD) as Row;
    expect(Boolean(room)).toBe(true);
    // The worker makes the room and tells sales-api; the cron runs for five minutes.
    const id = String(room.id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: new Date(w.clock.now).toISOString(), worker_run: "run-1", version: Number(room.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    const cur = w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: "https://meet.google.com/crt-abcd-efg",
        provider_meeting_id: "crt-abcd-efg",
        opened_at: new Date(w.clock.now).toISOString(),
        version: Number(cur.version) + 1,
      },
    });
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await w.flush();
    for (let i = 0; i < 5; i++) {
      w.clock.now += MIN;
      await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } }).catch(() => null);
      await w.flush();
    }
    expect({
      press_answered: said ? "an error" : "a room",
      links: w.delivered.length,
      link_sent: Boolean((w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row).link_sent_at),
      create_audit_rows: w.audits.filter(a => a.action === "room.create" && a.entityId === id).length,
      asked_line: w.db.t("cockpit_sales_room_events").filter(e => e.dedupe_key === `room.asked:${id}`).length,
    }).toEqual({ press_answered: "an error", links: 1, link_sent: true, create_audit_rows: 1, asked_line: 1 });
  });
});
