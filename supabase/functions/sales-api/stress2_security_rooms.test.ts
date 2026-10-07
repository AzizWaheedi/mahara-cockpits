// bun test supabase/functions/sales-api/stress2_security_rooms.test.ts
//
// Second series, round 1 (4 October 2026): security and abuse of sales-api's
// live-call actions as they stand after the first series' fixes. Each
// `test` held when written; each test that was `test.failing` pinned a reproduced finding
// (its key is in its name) and goes red when the fix lands. Against
// testfakes.ts; no network, no real row, no HighLevel.

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const HOST = "stress2-host@stress.invalid";
const OTHER = "stress2-other@stress.invalid";
const LEAD = "stress-2-lead-1";

const host: Who = { signed_in: true, seat: true, manager: false, email: HOST, name: "Stress Host", role: "closer", ghl_user_id: "G-host" };
const other: Who = { signed_in: true, seat: true, manager: false, email: OTHER, name: "Stress Other", role: "setter", ghl_user_id: "G-other" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: false, email: true },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};

function setup(o: { rooms?: Row; live?: Row; start?: number } = {}) {
  const w = fakeWorld(o.start);
  const audits: Row[] = [];
  const texts: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, standby: true, ...(o.live ?? {}) } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: HOST, name: "Stress Host", role: "closer", ghl_user_id: "G-host", active: true },
    { email: OTHER, name: "Stress Other", role: "setter", ghl_user_id: "G-other", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: HOST, zoom_user_id: "Z-host", zoom_status: "licensed", google_ok: true },
    { email: OTHER, zoom_user_id: "Z-other", zoom_status: "licensed", google_ok: true },
  ]);
  w.routes.push((m, p) =>
    m === "GET" && p === `/contacts/${LEAD}`
      ? { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@stress.invalid", tags: [], country: "KW" } }
      : (null as unknown as Row),
  );
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({}),
    sendText: async (who, b) => {
      texts.push({ who: who.email, ...b });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent" } };
    },
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent", provider_status: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  /** The room worker, as far as the cockpit can see it: the meeting is made and the room opens. */
  function workerOpens(id: string): void {
    const r = w.db.t("cockpit_sales_rooms").find(x => x.id === id) as Row;
    Object.assign(r, {
      state: "open",
      version: Number(r.version ?? 1) + 2,
      provider_meeting_id: String(80_000_000_000 + Math.floor(Math.random() * 1e9)),
      join_url: "https://us06web.zoom.us/j/81234567890?pwd=abc",
      opened_at: w.db.iso(),
    });
  }
  return { ...w, rooms, audits, texts, workerOpens };
}

async function refusal(p: Promise<unknown>): Promise<ApiRefusal | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
}

/**
 * The r3 harness's worker handshake (contract-v2 section 7): claim, store
 * worker.ready, open on Meet, tell sales-api, so the link goes the way it
 * goes in production.
 */
function linkWorld() {
  const w = setup();
  const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - 3_600_000).toISOString() }]);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function opens(id: string): Promise<void> {
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
    const cur = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: "https://meet.google.com/abc-defg-hij",
        provider_meeting_id: `evt-${id.slice(-6)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(cur.version) + 1,
      },
    });
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await w.flush();
  }
  async function make(): Promise<string> {
    const out = await w.rooms.actions["room.create"]!(host, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const id = String((out.room as Row).id);
    await opens(id);
    return id;
  }
  return { ...w, room, make };
}

// ---------------------------------------------------------------------------

describe("stress2 security: the three-links-an-hour cap on one lead", () => {
  test("the fourth room's own link does not go and the room says why (the fixture works)", async () => {
    const w = linkWorld();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = await w.make();
      ids.push(id);
      if (i < 3) await w.rooms.actions["room.end"]!(host, { room_id: id, version: Number(w.room(id).version), reason: "cancel" });
      w.clock.now += 60_000;
    }
    expect(w.texts.filter(t => t.contact_id === LEAD)).toHaveLength(3);
    expect(String(w.room(ids[3]!).refusal ?? "")).toContain("three call links this hour");
  });

  test(
    "link-flood-cap-bypassed-by-send-by-email: on the fourth room the panel's own Send by email button sends the lead a fourth link, and a make, email, end loop sends one a room",
    async () => {
      // The cap lives only in sendLinkHeld (the room's automatic link).
      // room.send (the panel's "Send by email", which it still offers on a
      // room refused with link_flood: emailBlocked() does not match its
      // words) calls sendOn directly, so the fourth room's link goes by
      // email after all, and every further room's goes too, until only the
      // sender's 30-in-ten-minutes ceiling stops it.
      const w = linkWorld();
      for (let i = 0; i < 10; i++) {
        // Since fix round 1 the fifth room for one lead in an hour is refused (room-create-flood).
        const id = await w.make().catch(() => null);
        if (!id) continue;
        await w.rooms.actions["room.send"]!(host, { room_id: id, request_id: crypto.randomUUID(), channel: "email" }).catch(() => null);
        await w.rooms.actions["room.end"]!(host, { room_id: id, version: Number(w.room(id).version), reason: "cancel" }).catch(() => null);
        await w.flush();
        w.clock.now += 30_000;
      }
      const toLead = w.texts.filter(t => t.contact_id === LEAD);
      // Five minutes, ten rooms: at most three links reach the lead, whatever the channel.
      expect(toLead.length).toBeLessThanOrEqual(3);
    },
  );
});

describe("stress2 security: a standby room asked for straight through room.create", () => {
  test("live.availability holds a seat to the standby rules (the fixture works)", async () => {
    // Outside live hours (22:00 Kuwait), with live calls off: Available makes no standby room.
    const w = setup({ start: Date.parse("2026-10-04T19:00:00Z") });
    await w.rooms.actions["live.availability"]!(other, { state: "available" }).catch(() => null);
    expect(w.db.t("cockpit_sales_rooms").filter(r => r.purpose === "standby")).toHaveLength(0);
  });

  test(
    "room-create-standby-bypasses-standby-rules: room.create {purpose: standby} makes a standby room with live calls off, outside live hours, and past the 4-an-hour cap",
    async () => {
      // The standby-flood fix (one standby room per seat each ten minutes,
      // four an hour) and the live switch, live.standby, live.hours and the
      // role check all live in live.availability. room.create takes
      // purpose "standby" from any seat (only "booked" is refused), and
      // createRefusal checks none of them: a seat loops create, wait for the
      // worker's open, end, create, and every turn is a new Zoom meeting on
      // its own user (Zoom caps creates per user per day) or a new event on
      // the CEO's "Sales rooms" calendar (one Google sign-in shared by every
      // Meet room). Live calls are off here and it is 22:00 Kuwait.
      const w = setup({ start: Date.parse("2026-10-04T19:00:00Z") });
      let made = 0;
      for (let i = 0; i < 12; i++) {
        const out = await w.rooms.actions["room.create"]!(other, {
          request_id: crypto.randomUUID(),
          purpose: "standby",
          provider: "zoom",
          call_kind: "intro",
          contact_id: null,
        }).catch(() => null);
        const id = (out?.room as Row | undefined)?.id as string | undefined;
        if (!id) continue;
        made++;
        w.workerOpens(id);
        const r = w.db.t("cockpit_sales_rooms").find(x => x.id === id) as Row;
        await w.rooms.actions["room.end"]!(other, { room_id: id, version: r.version, reason: "end" }).catch(() => null);
        w.clock.now += 20_000;
      }
      // At most what live.availability would ever make: none at all here.
      expect(made).toBe(0);
    },
  );

  test(
    "room-create-flood: one seat's create, open, end loop on one lead makes a new meeting every turn (no cap on room.create itself)",
    async () => {
      // The link to the lead is capped at three an hour (room-link-loop-floods-lead),
      // but the meetings are not: every room.create is a new Zoom meeting or
      // Google event, made by the worker before any link goes.
      const w = setup();
      let made = 0;
      for (let i = 0; i < 12; i++) {
        const out = await w.rooms.actions["room.create"]!(other, {
          request_id: crypto.randomUUID(),
          purpose: "manual",
          provider: "zoom",
          call_kind: "intro",
          contact_id: LEAD,
        }).catch(() => null);
        const id = (out?.room as Row | undefined)?.id as string | undefined;
        if (!id) continue;
        made++;
        w.workerOpens(id);
        const r = w.db.t("cockpit_sales_rooms").find(x => x.id === id) as Row;
        await w.rooms.actions["room.end"]!(other, { room_id: id, version: r.version, reason: "end" }).catch(() => null);
        w.clock.now += 20_000;
      }
      // Four minutes: as many meetings as the standby cap allows in an hour, at most.
      expect(made).toBeLessThanOrEqual(4);
    },
  );
});
