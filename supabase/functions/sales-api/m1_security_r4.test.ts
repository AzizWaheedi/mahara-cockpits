// bun test supabase/functions/sales-api/m1_security_r4.test.ts
//
// Milestone 1, video-link round 4, security angle (sales-api): what a lead
// can put on the rep's screen through Zoom's own fields, and the host's link
// kept to the host. Pilot settings (m1-scope.md section 3): rooms on for the
// test contact, Meet and Zoom on, every send channel on, count_on_join,
// settle and wrap off, live off, short_link off. Against testfakes.ts; no
// network, every lead and seat invented (stress-..., ...@stress.invalid).
//
// A test named "control" passes and proves the fixture; any other failing
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
const SETTER = "stress-m1s4-setter@stress.invalid";
const OTHER = "stress-m1s4-other@stress.invalid";
const MANAGER = "stress-m1s4-manager@stress.invalid";
const LEAD = "stress-m1s4-lead";
const MEETING = "81234567890";
const ZOOM_URL = `https://us06web.zoom.us/j/${MEETING}?pwd=abc`;
const HOST_TOKEN = "hosttokenm1s4";

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
  w.routes.push((m, p) => (m === "GET" && p === `/contacts/${LEAD}` ? { contact } : (null as unknown as Row)));
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
  return { ...w, rooms, audits, sends, room };
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

/** The setter presses Send a video link on the lead page (manual, Zoom); the worker makes and opens it; the link goes. */
async function zoomRoom(w: ReturnType<typeof setup>): Promise<string> {
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider: "zoom",
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
    body: { state: "open", join_url: ZOOM_URL, provider_meeting_id: MEETING, opened_at: w.db.iso(), version: Number(w.room(id).version) + 1 },
  });
  w.db.seed("cockpit_sales_room_secrets", [
    { room_id: id, start_url: `https://us06web.zoom.us/s/${MEETING}?zak=${HOST_TOKEN}`, expires_at: new Date(w.clock.now + 60 * MIN).toISOString() },
  ]);
  await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
  await w.flush();
  return id;
}

/** Zoom's webhook as sales-live keeps it (cleanZoom, zoomText, zoomDedupeKey) and passes it on. */
async function zoomEvent(w: ReturnType<typeof setup>, id: string, body: Row): Promise<void> {
  const d = cleanZoom(body);
  if (!d) throw new Error("not a Zoom event");
  const eventId = fakeUuid();
  w.db.seed("cockpit_sales_room_events", [
    {
      id: eventId,
      room_id: id,
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
}

const join = (w: ReturnType<typeof setup>, p: Row): Row => ({
  event: "meeting.participant_joined",
  event_ts: w.clock.now,
  payload: {
    account_id: "acct-m1s4",
    object: {
      id: MEETING,
      uuid: "m1s4==",
      host_id: "Z-setter",
      topic: "Mahara call K7Q4MX",
      participant: { join_time: new Date(w.clock.now).toISOString(), ...p },
    },
  },
});

// ---------------------------------------------------------------------------
// The lead's Zoom display name on the rep's own panel
// ---------------------------------------------------------------------------

describe("m1 security r4: the lead's Zoom display name on the rep's room panel", () => {
  test("control: the host's and the lead's Zoom joins move the room and say who joined (the fixture works)", async () => {
    const w = setup();
    const id = await zoomRoom(w);
    await zoomEvent(w, id, join(w, { id: "Z-setter", user_name: "Tara Setter", participant_uuid: "pu-host" }));
    await zoomEvent(w, id, join(w, { id: "", user_name: "Huda", participant_uuid: "pu-lead" }));
    expect(w.room(id).state).toBe("lead_in");
    const st = await w.rooms.actions["room.status"]!(setter, { room_id: id });
    const texts = (st.events as Row[]).map((e) => String(e.text));
    expect(texts).toContain("Zoom: Huda joined.");
  });

  test("zoom-name-bidi-spoofs-room-timeline: a lead whose Zoom name starts with a right-to-left override puts a backwards line on the rep's timeline (room.status carries the control as it is)", async () => {
    const w = setup();
    const id = await zoomRoom(w);
    await zoomEvent(w, id, join(w, { id: "", user_name: "‮.tfel tsoh ehT", participant_uuid: "pu-lead" }));
    const st = await w.rooms.actions["room.status"]!(setter, { room_id: id });
    const texts = (st.events as Row[]).map((e) => String(e.text));
    const spoofed = texts.filter((t) => /[‪-‮⁦-⁩​-‏]/.test(t));
    expect(spoofed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The host's link, kept to the host (controls)
// ---------------------------------------------------------------------------

describe("m1 security r4: the host's start link (controls)", () => {
  test("control: a manager is refused room.open on the setter's room, and no seat but the host reads the host token anywhere", async () => {
    const w = setup();
    const id = await zoomRoom(w);
    const r = await refused(w.rooms.actions["room.open"]!(manager, { room_id: id }));
    expect(r?.status).toBe(403);
    for (const who of [other, manager]) {
      const st = await w.rooms.actions["room.status"]!(who, { room_id: id });
      expect(JSON.stringify(st)).not.toContain(HOST_TOKEN);
      const live = await w.rooms.actions["live.status"]!(who, {}).catch((e) => ({ error: String(e) }));
      expect(JSON.stringify(live)).not.toContain(HOST_TOKEN);
    }
    const mine = await w.rooms.actions["live.status"]!(setter, {});
    expect(JSON.stringify(mine)).not.toContain(HOST_TOKEN);
    expect(JSON.stringify(w.sends)).not.toContain(HOST_TOKEN);
    expect(JSON.stringify(w.audits)).not.toContain(HOST_TOKEN);
    expect(JSON.stringify(w.db.t("cockpit_sales_room_events"))).not.toContain(HOST_TOKEN);
  });

  test("control: a room.event worker.ready from the cron door's caller for a room the worker never told about sends nothing", async () => {
    const w = setup();
    const out = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
    });
    const id = String((out.room as Row).id);
    const answer = await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "forged" } });
    await w.flush();
    expect(answer.handled).toBe(false);
    expect(w.sends.length).toBe(0);
    expect(w.room(id).state).toBe("requested");
  });
});
