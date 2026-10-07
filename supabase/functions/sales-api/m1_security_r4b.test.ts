// bun test supabase/functions/sales-api/m1_security_r4b.test.ts
//
// Milestone 1, video-link round 4 (second pass), security angle (sales-api):
// a seat acting on another rep's room, the pilot's test list written another
// way, and who a Zoom participant is taken for when the lead chooses their
// own name. Pilot settings (m1-scope.md section 3): rooms on for the test
// contact, Meet and Zoom on, every send channel on, count_on_join, settle
// and wrap off, live off, short_link off. Against testfakes.ts; no network,
// every lead and seat invented (stress-..., ...@stress.invalid).
//
// A test named "control" passes and proves the rule holds; any other failing
// test is a finding.

import { describe, expect, test } from "bun:test";
import { cleanZoom, zoomDedupeKey, zoomText } from "../sales-live/zoom.ts";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const SETTER = "stress-m1s4b-setter@stress.invalid";
const OTHER = "stress-m1s4b-other@stress.invalid";
const MANAGER = "stress-m1s4b-manager@stress.invalid";
const LEAD = "stress-m1s4b-Lead";
const MEETING = "81234567891";
const ZOOM_URL = `https://us06web.zoom.us/j/${MEETING}?pwd=abc`;
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const HOST_TOKEN = "hosttokenm1s4b";

const seat = (email: string, name: string, role: string, ghl: string, manager = false): Who => ({
  signed_in: true,
  seat: true,
  manager,
  email,
  name,
  role,
  ghl_user_id: ghl,
});
const setter = seat(SETTER, "Tara Setter", "setter", "G-setter");
const other = seat(OTHER, "Omar Other", "setter", "G-other");
const manager = seat(MANAGER, "Mona Manager", "manager", "G-manager", true);
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

function setup() {
  const w = fakeWorld();
  const audits: Row[] = [];
  const sends: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: PILOT_ROOMS },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    { key: "followups", value: { enabled: true, agent: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: OTHER, name: "Omar Other", role: "setter", ghl_user_id: "G-other", active: true },
    { email: MANAGER, name: "Mona Manager", role: "manager", ghl_user_id: "G-manager", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: OTHER, zoom_user_id: "Z-other", zoom_status: "licensed", google_ok: true },
    { email: MANAGER, zoom_user_id: "Z-manager", zoom_status: "licensed", google_ok: true },
  ]);
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
  const contactReads: string[] = [];
  // HighLevel answers any contact path with the test contact, as a HighLevel
  // that matches ids loosely would: the pilot's fence must hold by itself.
  w.routes.push((m, p) => {
    if (m === "GET" && p.startsWith("/contacts/")) {
      contactReads.push(p);
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
      sends.push({ who: who.email, kind: "text", ...b });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent", created_at: w.db.iso() } };
    },
    sendTemplate: async (who, t) => {
      sends.push({ who: who.email, kind: "template", ...t });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent", created_at: w.db.iso() } };
    },
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find((r) => r.id === id) as Row;
  return { ...w, rooms, audits, sends, room, contactReads };
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

/** The setter presses Send a video link on the lead page (manual); the worker makes and opens it; the link goes. */
async function openRoom(w: ReturnType<typeof setup>, provider: "meet" | "zoom"): Promise<string> {
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider,
    call_kind: "intro",
    purpose: "manual",
  });
  const id = String((out.room as Row).id);
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
      provider_meeting_id: provider === "meet" ? "evt-m1s4b" : MEETING,
      opened_at: w.db.iso(),
      version: Number(w.room(id).version) + 1,
    },
  });
  if (provider === "zoom")
    w.db.seed("cockpit_sales_room_secrets", [
      { room_id: id, start_url: `https://us06web.zoom.us/s/${MEETING}?zak=${HOST_TOKEN}`, expires_at: new Date(w.clock.now + 60 * MIN).toISOString() },
    ]);
  await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
  await w.flush();
  return id;
}

/** Zoom's webhook as sales-live keeps it (cleanZoom, zoomText, zoomDedupeKey), stored on `roomId`, then passed on. */
async function zoomEvent(w: ReturnType<typeof setup>, roomId: string, body: Row): Promise<string> {
  const d = cleanZoom(body);
  if (!d) throw new Error("not a Zoom event");
  const eventId = fakeUuid();
  w.db.seed("cockpit_sales_room_events", [
    {
      id: eventId,
      room_id: roomId,
      kind: `zoom.${d.event}`,
      source: "zoom",
      dedupe_key: zoomDedupeKey(d),
      at: new Date(w.clock.now).toISOString(),
      text: zoomText(d),
      detail: d,
    },
  ]);
  await w.rooms.desk["room.event"]!(desk, { kind: `zoom.${d.event}`, event_id: eventId, payload: {} });
  await w.flush();
  return eventId;
}

const joinOn = (w: ReturnType<typeof setup>, meeting: string, p: Row): Row => ({
  event: "meeting.participant_joined",
  event_ts: w.clock.now,
  payload: {
    account_id: "acct-m1s4b",
    object: {
      id: meeting,
      uuid: `m1s4b-${meeting}==`,
      host_id: "Z-setter",
      topic: "Mahara call K7Q4MB",
      participant: { join_time: new Date(w.clock.now).toISOString(), ...p },
    },
  },
});

// ---------------------------------------------------------------------------
// 1. Another seat acting on the setter's room
// ---------------------------------------------------------------------------

describe("m1 security r4b: another seat's presses on the setter's room", () => {
  test("control: another setter's I can't let them in on the setter's open Meet room is refused, the room stays open, and no replacement room or message is made", async () => {
    const w = setup();
    const id = await openRoom(w, "meet");
    const roomsBefore = w.db.t("cockpit_sales_rooms").length;
    const sendsBefore = w.sends.length;
    const v = Number(w.room(id).version);
    const r = await refused(w.rooms.actions["room.end"]!(other, { room_id: id, version: v, reason: "admit_blocked" }));
    await w.flush();
    expect(r?.status).toBe(403);
    expect(w.room(id).state).toBe("open");
    expect(w.db.t("cockpit_sales_rooms").length).toBe(roomsBefore);
    expect(w.sends.length).toBe(sendsBefore);
  });

  test("control: another setter's That was not the lead and Still on it on the setter's room are refused and move nothing", async () => {
    const w = setup();
    const id = await openRoom(w, "zoom");
    await zoomEvent(w, id, joinOn(w, MEETING, { id: "Z-setter", user_name: "Tara Setter", participant_uuid: "pu-host" }));
    await zoomEvent(w, id, joinOn(w, MEETING, { id: "", user_name: "Huda", participant_uuid: "pu-lead" }));
    expect(w.room(id).state).toBe("lead_in");
    const before = JSON.stringify(w.room(id));
    const v = Number(w.room(id).version);
    for (const what of ["not_lead", "still_on", "lead_in", "host_in"]) {
      const r = await refused(w.rooms.actions["room.mark"]!(other, { room_id: id, version: v, what }));
      expect([what, r?.status]).toEqual([what, 403]);
    }
    expect(JSON.stringify(w.room(id))).toBe(before);
  });

  test("control: a manager's I can't let them in on the setter's Meet room keeps the replacement the setter's room (host and host link stay the setter's)", async () => {
    const w = setup();
    const id = await openRoom(w, "meet");
    const v = Number(w.room(id).version);
    const out = await w.rooms.actions["room.end"]!(manager, { room_id: id, version: v, reason: "admit_blocked" });
    await w.flush();
    const rep = out.replacement as Row | undefined;
    expect(rep).toBeTruthy();
    const made = w.room(String(rep?.id));
    expect(String(made.host_email)).toBe(SETTER);
    expect(String(made.contact_id)).toBe(LEAD);
    expect(String(made.provider)).toBe("zoom");
  });
});

// ---------------------------------------------------------------------------
// 2. The pilot's test list, written another way
// ---------------------------------------------------------------------------

describe("m1 security r4b: the pilot's one test contact, its id written another way", () => {
  for (const variant of [LEAD.toLowerCase(), LEAD.toUpperCase(), ` ${LEAD} `, `${LEAD}/`, `${LEAD}%00`, `${LEAD}​`]) {
    test(`control: room.create for ${JSON.stringify(variant)} is answered as the test contact or refused, never a room for a contact off the list`, async () => {
      const w = setup();
      const out = await w.rooms.actions["room.create"]!(setter, {
        request_id: crypto.randomUUID(),
        contact_id: variant,
        provider: "meet",
        call_kind: "intro",
        purpose: "manual",
      }).catch((e) => e);
      await w.flush();
      const made = w.db.t("cockpit_sales_rooms");
      // Either refused (test_only) or a room for exactly the listed id.
      if (out instanceof ApiRefusal) expect(made.length).toBe(0);
      else expect(made.every((r) => r.contact_id === LEAD)).toBe(true);
      expect(w.sends.length).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Who a Zoom participant is, when the lead picks their own name
// ---------------------------------------------------------------------------

describe("m1 security r4b: a Zoom name is never who someone is", () => {
  test("control: a guest whose Zoom name is the host's own full name (no id, no email) is the lead, never the host", async () => {
    const w = setup();
    const id = await openRoom(w, "zoom");
    await zoomEvent(w, id, joinOn(w, MEETING, { id: "Z-setter", user_name: "Tara Setter", participant_uuid: "pu-host" }));
    expect(w.room(id).state).toBe("host_in");
    await zoomEvent(w, id, joinOn(w, MEETING, { id: "", user_name: "Tara Setter", participant_uuid: "pu-guest" }));
    expect(w.room(id).state).toBe("lead_in");
  });

  test("control: a guest whose Zoom name is the host's, read before the host's own join, is recorded as the lead (role lead), never as the host", async () => {
    const w = setup();
    const id = await openRoom(w, "zoom");
    const ev = await zoomEvent(w, id, joinOn(w, MEETING, { id: "", user_name: "Tara Setter", participant_uuid: "pu-guest", email: "" }));
    // A lead let in means the host let them in (join_before_host is off), so
    // host_in_at takes the join's time by design; the person is the lead.
    expect(w.room(id).state).toBe("lead_in");
    const row = w.db.t("cockpit_sales_room_events").find((e) => e.id === ev) as Row;
    expect((row.detail as Row).role).toBe("lead");
  });

  test("control: the lead's Zoom email never reaches the rep's room.status, live.status or the timeline text", async () => {
    const w = setup();
    const id = await openRoom(w, "zoom");
    await zoomEvent(w, id, joinOn(w, MEETING, { id: "Z-setter", user_name: "Tara Setter", participant_uuid: "pu-host" }));
    await zoomEvent(w, id, joinOn(w, MEETING, { id: "", user_name: "Huda", email: "huda.private@stress.invalid", participant_uuid: "pu-lead" }));
    const st = await w.rooms.actions["room.status"]!(setter, { room_id: id });
    const live = await w.rooms.actions["live.status"]!(setter, {});
    expect(JSON.stringify(st)).not.toContain("huda.private");
    expect(JSON.stringify(live)).not.toContain("huda.private");
    expect(JSON.stringify(st)).not.toContain(HOST_TOKEN);
  });

  test("control: a Zoom event stored on the setter's room but from another meeting (the topic names the room) moves nothing and keeps no name", async () => {
    const w = setup();
    const id = await openRoom(w, "zoom");
    const before = String(w.room(id).state);
    const ev = await zoomEvent(w, id, joinOn(w, "89999999999", { id: "", user_name: "Stranger Name", participant_uuid: "pu-x" }));
    expect(String(w.room(id).state)).toBe(before);
    const row = w.db.t("cockpit_sales_room_events").find((e) => e.id === ev) as Row;
    expect(JSON.stringify(row)).not.toContain("Stranger Name");
    expect(row.room_id ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Another Zoom meeting named after a room still being made
// ---------------------------------------------------------------------------

/** The setter's Zoom room, asked for and claimed by the worker: no meeting id written yet. */
async function makingRoom(w: ReturnType<typeof setup>): Promise<{ id: string; code: string }> {
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider: "zoom",
    call_kind: "intro",
    purpose: "manual",
  });
  const id = String((out.room as Row).id);
  // The fake database leaves the code to the caller: the real one picks it in its guard.
  if (!w.room(id).code) await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { code: "K7Q4MB" } });
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(w.room(id).version) + 1 },
  });
  return { id, code: String(w.room(id).code) };
}

/**
 * meeting.deleted for a meeting another Zoom user on Mahara's account made
 * and deleted, titled with the room's code (every rep has a Zoom user there,
 * and every seat reads the rooms table, codes included). Stored on the room
 * exactly as the door stores it: pickZoomRoom takes the topic's code for a
 * room whose meeting id is not written yet.
 */
const foreignDeleted = (w: ReturnType<typeof setup>, code: string): Row => ({
  event: "meeting.deleted",
  event_ts: w.clock.now,
  payload: {
    account_id: "acct-m1s4b",
    object: { id: "86666666666", uuid: "foreign-instance==", host_id: "Z-other", topic: `Mahara call ${code}`, type: 2 },
  },
});

describe("m1 security r4b: another rep's Zoom meeting named after the setter's room while it is being made", () => {
  test("control: the same meeting.deleted once the room has its own meeting id moves nothing", async () => {
    const w = setup();
    const id = await openRoom(w, "zoom");
    const code = String(w.room(id).code || "K7Q4MB");
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { code } });
    await zoomEvent(w, id, foreignDeleted(w, code));
    expect(w.room(id).state).toBe("open");
  });

  test("zoom-foreign-meeting-deletes-room-being-made: a meeting.deleted from another Zoom user's meeting titled 'Mahara call {code}' cancels the setter's room while the worker is making it", async () => {
    const w = setup();
    const { id, code } = await makingRoom(w);
    expect(w.room(id).state).toBe("creating");
    await zoomEvent(w, id, foreignDeleted(w, code));
    const r = w.room(id);
    // The room was never on meeting 86666666666; another meeting's end or
    // deletion must never drive it (final review, zoom-topic-code-beats-meeting-id).
    expect({ state: r.state, error: r.error ?? null }).toEqual({ state: "creating", error: null });
  });
});
