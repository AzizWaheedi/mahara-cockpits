// bun test supabase/functions/sales-api/stress2_security_r2_rooms.test.ts
//
// Second series, round 2 (4 October 2026): security and abuse of sales-api's
// live-call actions as they stand after fix round 1. Each `test` held when
// written; each `test.failing` pins a reproduced finding (its key is in its
// name) and goes red when the fix lands. Against testfakes.ts; no network,
// no real row, no HighLevel.

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const HOST = "stress2r2-host@stress.invalid";
const LEAD = "stress-2r2-lead-1";

const host: Who = { signed_in: true, seat: true, manager: false, email: HOST, name: "Stress Host", role: "closer", ghl_user_id: "G-host" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: false, email: true },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};

function setup(o: { live?: Row; start?: number } = {}) {
  const w = fakeWorld(o.start);
  const audits: Row[] = [];
  const texts: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: ROOMS_ON },
    { key: "live", value: { enabled: false, standby: true, ...(o.live ?? {}) } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: HOST, name: "Stress Host", role: "closer", ghl_user_id: "G-host", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: HOST, zoom_user_id: "Z-host", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - 3_600_000).toISOString() }]);
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
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(x => x.id === id) as Row;
  /** The room worker, as far as the cockpit can see it: the meeting is made and the room opens. */
  function workerOpens(id: string): void {
    const r = room(id);
    const zoom = r.provider === "zoom";
    Object.assign(r, {
      state: "open",
      version: Number(r.version ?? 1) + 2,
      provider_meeting_id: zoom ? String(80_000_000_000 + Math.floor(Math.random() * 1e9)) : `evt-${String(r.id).slice(-6)}`,
      join_url: zoom ? "https://us06web.zoom.us/j/81234567890?pwd=abc" : "https://meet.google.com/abc-defg-hij",
      opened_at: w.db.iso(),
    });
  }
  return { ...w, rooms, audits, texts, room, workerOpens };
}

/** "I can't let them in" on a room, then on the room it made, and so on: how many meetings one seat gets made. */
async function admitChain(w: ReturnType<typeof setup>, firstId: string, presses: number): Promise<{ made: number; ids: string[] }> {
  let id = firstId;
  const ids = [firstId];
  for (let i = 0; i < presses; i++) {
    w.workerOpens(id);
    const out = await w.rooms.actions["room.end"]!(host, { room_id: id, version: Number(w.room(id).version), reason: "admit_blocked" }).catch(
      () => null,
    );
    await w.flush();
    const next = (out?.replacement as Row | undefined)?.id as string | undefined;
    if (!next) break;
    ids.push(next);
    id = next;
    w.clock.now += 15_000;
  }
  return { made: ids.length, ids };
}

// ---------------------------------------------------------------------------

describe("stress2 security r2: the room caps against 'I can't let them in'", () => {
  test("room.create itself stops a fifth room for one lead in an hour (the fixture works)", async () => {
    const w = setup();
    let made = 0;
    for (let i = 0; i < 8; i++) {
      const out = await w.rooms.actions["room.create"]!(host, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        provider: "zoom",
        call_kind: "intro",
        purpose: "manual",
      }).catch(() => null);
      const id = (out?.room as Row | undefined)?.id as string | undefined;
      if (!id) continue;
      made++;
      w.workerOpens(id);
      await w.rooms.actions["room.end"]!(host, { room_id: id, version: Number(w.room(id).version), reason: "cancel" }).catch(() => null);
      w.clock.now += 15_000;
    }
    expect(made).toBe(4);
  });

  test(
    "room-flood-cap-bypassed-by-admit-blocked-chain: one room.create, then 'I can't let them in' on each room it makes, gives one seat a new Zoom meeting or Sales rooms calendar event every press for one lead, past the four-an-hour and eight-in-ten-minutes caps",
    async () => {
      // The caps (room-create-flood, fix round 1) live in roomCaps, which only
      // room.create calls. room.end admit_blocked makes its replacement
      // through createRoom straight away ("rooms the server makes are not
      // counted"), but the replacement is made by a press, and the room it
      // makes can be pressed again: Zoom, Meet, Zoom, Meet...
      const w = setup();
      const out = await w.rooms.actions["room.create"]!(host, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        provider: "zoom",
        call_kind: "intro",
        purpose: "manual",
      });
      const chain = await admitChain(w, String((out.room as Row).id), 20);
      const meetings = w.db.t("cockpit_sales_rooms").filter(r => r.contact_id === LEAD).length;
      // Five minutes of presses: never more rooms for one lead than room.create allows in an hour.
      // (Fix round 2: admit_blocked exists only on a Meet fallback or handover
      // room with a lead, so a Zoom manual room's press is refused at once.)
      expect(chain.made).toBeLessThanOrEqual(4);
      expect(meetings).toBeLessThanOrEqual(4);
    },
  );

  test("fix round 2: the P1 chain itself (a Meet fallback room, then its Zoom replacement) makes one replacement, and a Zoom room's press is refused", async () => {
    const w = setup();
    const out = await w.rooms.actions["room.create"]!(host, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
    });
    const chain = await admitChain(w, String((out.room as Row).id), 10);
    expect(chain.made).toBe(2);
    expect(w.room(chain.ids[1] as string).provider).toBe("zoom");
  });

  test("fix round 2: past the lead's four rooms an hour, 'I can't let them in' keeps the lead's room open and says why", async () => {
    const w = setup();
    for (let i = 0; i < 3; i++) {
      const o = await w.rooms.actions["room.create"]!(host, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "zoom", call_kind: "intro", purpose: "manual" });
      const id = String((o.room as Row).id);
      w.workerOpens(id);
      await w.rooms.actions["room.end"]!(host, { room_id: id, version: Number(w.room(id).version), reason: "cancel" });
      w.clock.now += 15_000;
    }
    const o = await w.rooms.actions["room.create"]!(host, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "fallback" });
    const id = String((o.room as Row).id);
    w.workerOpens(id);
    let code = "";
    try {
      await w.rooms.actions["room.end"]!(host, { room_id: id, version: Number(w.room(id).version), reason: "admit_blocked" });
    } catch (e) {
      code = String((e as { extra?: Row }).extra?.code ?? "");
    }
    expect(code).toBe("room_flood");
    expect(w.room(id).state).toBe("open");
  });
});

describe("stress2 security r2: an empty standby room and 'I can't let them in'", () => {
  test(
    "standby-rules-bypassed-by-admit-blocked: room.end admit_blocked on the seat's empty standby room makes another standby room on the other provider, outside live hours and past the four-an-hour standby cap, every press",
    async () => {
      // A standby room only comes from live.availability (stress2, round 1),
      // which holds the live switch, the hours, the role and the caps. The
      // admit_blocked replacement copies the room's purpose (standby) and
      // goes through createRoom, which checks none of them, and the
      // other-provider check runs only for a room with a lead.
      const w = setup({ live: { enabled: true, standby: true }, start: Date.parse("2026-10-04T19:00:00Z") });
      // The seat's standby room from an earlier Available (made inside hours).
      const first = crypto.randomUUID();
      w.db.seed("cockpit_sales_rooms", [
        {
          id: first,
          request_id: crypto.randomUUID(),
          code: "STBY23",
          contact_id: null,
          purpose: "standby",
          call_kind: "demo",
          provider: "zoom",
          host_email: HOST,
          made_by: HOST,
          state: "creating",
          version: 2,
          requested_at: w.db.iso(),
          host_by: new Date(w.clock.now + 15 * 60_000).toISOString(),
          ends_at: new Date(w.clock.now + 30 * 60_000).toISOString(),
        },
      ]);
      const chain = await admitChain(w, first, 12);
      const standby = w.db.t("cockpit_sales_rooms").filter(r => r.purpose === "standby" && r.host_email === HOST).length;
      // 22:00 Kuwait, outside live hours: no new standby room at all.
      expect({ chain: chain.made, standby }).toEqual({ chain: 1, standby: 1 });
    },
  );
});
