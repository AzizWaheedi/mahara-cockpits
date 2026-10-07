// bun test supabase/functions/sales-api/m1_security_r2.test.ts
//
// Milestone 1, video-link round 2, security angle: the fence the pilot runs
// behind (rooms.enabled, the kill switch, and rooms.test_only with its one
// test contact) checked where the link actually goes, not only where the
// room is asked for. Pilot settings (m1-scope.md section 3): rooms on for
// the test contact, Meet and Zoom on, every send channel on, count_on_join,
// settle and wrap off, live off, short_link off. Against testfakes.ts; no
// network, every lead and seat invented (stress-..., ...@stress.invalid).

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const SETTER = "stress-m1s2-setter@stress.invalid";
const LEAD = "stress-m1s2-lead";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";

const setter: Who = {
  signed_in: true,
  seat: true,
  manager: false,
  email: SETTER,
  name: "Tara Setter",
  role: "setter",
  ghl_user_id: "G-setter",
};
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk", name: "Sales desk" };

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
};

function setup(o: { rooms?: Row; contactFails?: { n: number } } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const sends: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...PILOT_ROOMS, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    { key: "followups", value: { enabled: true, agent: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, at: w.db.iso(), detail: "ready" }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", assigned_to: "G-setter" }]);
  const contact = {
    id: LEAD,
    firstName: "Huda",
    name: "Huda Ali",
    phone: "+96550000000",
    email: "huda@stress.invalid",
    tags: ["roas-qualified"],
    country: "KW",
  };
  w.routes.push((m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) {
      if (o.contactFails && o.contactFails.n > 0) {
        o.contactFails.n -= 1;
        throw Object.assign(new Error("HighLevel said 503"), { status: 503 });
      }
      return { contact };
    }
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({}),
    sendText: async (who, b) => {
      sends.push({ who: who.email, kind: "text", at: w.clock.now, ...b });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent", created_at: w.db.iso() } };
    },
    sendTemplate: async (who, t) => {
      sends.push({ who: who.email, kind: "template", at: w.clock.now, ...t });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent", created_at: w.db.iso() } };
    },
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find((r) => r.id === id) as Row;
  /** A manager's write to the rooms setting (the kill switch, the test list), as SQL would make it. */
  const setRooms = (patch: Row) => {
    const row = w.db.t("cockpit_sales_settings").find((r) => r.key === "rooms") as Row;
    row.value = { ...(row.value as Row), ...patch };
    row.updated_by = "stress-m1s2-boss@stress.invalid";
    row.updated_at = w.db.iso();
  };
  return { ...w, rooms, audits, sends, room, setRooms };
}

async function refused(p: Promise<unknown>): Promise<ApiRefusal | null> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  return null;
}

/** The lead wrote on WhatsApp ten minutes ago: free text may go (the link's first lane). */
function windowOpen(w: ReturnType<typeof setup>): void {
  const at = new Date(w.clock.now - 10 * MIN).toISOString();
  w.db.seed("cockpit_sales_inbox", [
    { contact_id: LEAD, last_message_at: at, last_direction: "inbound", inbound_whatsapp_at: at },
  ]);
}

/** The seat presses Send a video link on the lead page (manual): the room is asked for. */
async function ask(w: ReturnType<typeof setup>, provider: "meet" | "zoom" = "meet"): Promise<string> {
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider,
    call_kind: "intro",
    purpose: "manual",
  });
  return String((out.room as Row).id);
}

/** The worker claims the room (it was asked for while the switch was on), makes the meeting, and tells sales-api. */
async function workerMakes(w: ReturnType<typeof setup>, id: string, provider: "meet" | "zoom" = "meet"): Promise<void> {
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(w.room(id).version) + 1 },
  });
  await w.io.db("cockpit_sales_room_events", {
    method: "POST",
    body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" } },
  });
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
    method: "PATCH",
    body: {
      state: "open",
      join_url: provider === "meet" ? MEET_URL : ZOOM_URL,
      provider_meeting_id: provider === "meet" ? "evt-1" : "81234567890",
      opened_at: w.db.iso(),
      version: Number(w.room(id).version) + 1,
    },
  });
  await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
  await w.flush();
}

// ---------------------------------------------------------------------------

describe("m1 security r2: the kill switch (rooms.enabled=false) where the link goes", () => {
  test("control: with the switch on, the test contact's link goes by email (the fixture works)", async () => {
    const w = setup({ rooms: { send: { whatsapp_text: false, whatsapp_template: false, email: true } } });
    const id = await ask(w);
    await workerMakes(w, id);
    expect(w.room(id).link_sent_at).toBeTruthy();
    expect(w.sends.filter((s) => s.channel === "email").length).toBe(1);
  });

  test("control: with the switch off, room.create is refused (the fence at the press holds)", async () => {
    const w = setup({ rooms: { enabled: false } });
    const r = await refused(ask(w));
    expect(r?.status).toBe(409);
    expect(w.sends.length).toBe(0);
  });

  test("kill-switch-link-still-sent (handshake): a manager switches rooms off while the room is being made; the worker's worker.ready still sends the lead the link", async () => {
    const w = setup({ rooms: { send: { whatsapp_text: false, whatsapp_template: false, email: true } } });
    const id = await ask(w);
    // The manager pulls the kill switch (final_spec_foundation: rooms.enabled=false is the kill switch).
    w.setRooms({ enabled: false });
    w.clock.now += 5_000;
    // The worker claimed the room before it read the switch again, and finishes it.
    await workerMakes(w, id);
    const after = w.sends.filter((s) => s.at >= w.clock.now - 5_000);
    // Nothing goes to a lead once rooms are switched off.
    expect({ sends: after.length, link_sent: Boolean(w.room(id).link_sent_at) }).toEqual({ sends: 0, link_sent: false });
  });

  test("kill-switch-link-still-sent (Also send by email): the link went on WhatsApp; after the kill switch the host's Also send by email still emails the lead", async () => {
    const w = setup({ rooms: { send: { whatsapp_text: true, whatsapp_template: false, email: true } } });
    windowOpen(w);
    const id = await ask(w);
    await workerMakes(w, id);
    // The control: the link went once, as WhatsApp free text, and no email yet.
    expect(w.sends.map((s) => s.channel)).toEqual(["whatsapp"]);
    const before = w.sends.length;
    w.setRooms({ enabled: false });
    w.clock.now += 2 * MIN;
    const r = await refused(w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" }));
    await w.flush();
    expect({ refused: r?.status ?? null, new_sends: w.sends.length - before }).toEqual({ refused: 409, new_sends: 0 });
  });

  test("kill-switch-link-still-sent (the minute's re-ask): a link that could not go at first (HighLevel unread) goes on the sweep's tick after rooms were switched off", async () => {
    const fails = { n: 0 };
    const w = setup({ rooms: { send: { whatsapp_text: false, whatsapp_template: false, email: true } }, contactFails: fails });
    const id = await ask(w);
    // HighLevel does not answer the contact read at the handshake: not sent yet, the tick asks again.
    fails.n = 1;
    await workerMakes(w, id);
    expect(w.room(id).link_sent_at).toBeFalsy();
    expect(w.sends.length).toBe(0);
    w.setRooms({ enabled: false });
    w.clock.now += 70_000;
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    expect({ sends: w.sends.length, link_sent: Boolean(w.room(id).link_sent_at) }).toEqual({ sends: 0, link_sent: false });
  });
});

describe("m1 security r2: the pilot's test list where the link goes", () => {
  test("test-list-checked-only-at-press: the test contact is taken off rooms.test_contacts (a manager narrows the pilot); the open room's Also send by email still emails that lead", async () => {
    const w = setup({ rooms: { send: { whatsapp_text: true, whatsapp_template: false, email: true } } });
    windowOpen(w);
    const id = await ask(w);
    await workerMakes(w, id);
    expect(w.sends.map((s) => s.channel)).toEqual(["whatsapp"]);
    const before = w.sends.length;
    w.setRooms({ test_contacts: [] });
    w.clock.now += 2 * MIN;
    const r = await refused(w.rooms.actions["room.send"]!(setter, { room_id: id, request_id: crypto.randomUUID(), channel: "email" }));
    await w.flush();
    expect({ refused: r !== null, new_sends: w.sends.length - before }).toEqual({ refused: true, new_sends: 0 });
  });

  test("test-list-checked-only-at-press (handshake): the contact is taken off the test list while its room is being made; worker.ready still sends the link", async () => {
    const w = setup({ rooms: { send: { whatsapp_text: false, whatsapp_template: false, email: true } } });
    const id = await ask(w);
    w.setRooms({ test_contacts: [] });
    w.clock.now += 5_000;
    await workerMakes(w, id);
    expect({ sends: w.sends.length, link_sent: Boolean(w.room(id).link_sent_at) }).toEqual({ sends: 0, link_sent: false });
  });
});
