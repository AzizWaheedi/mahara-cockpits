// bun test supabase/functions/sales-api/m1_security_r5.test.ts
//
// Milestone 1, video-link round 5, security angle (sales-api): a seat acting
// on another rep's room through the newest press (Use Meet / Try Zoom, one
// room.create naming the room it replaces), and what a lead's own Zoom name
// puts on the rep's timeline. Pilot settings (m1-scope.md section 3): rooms
// on for the test contact, Meet and Zoom on, every send channel on,
// count_on_join, settle and wrap off, live off, short_link off. Against
// testfakes.ts; no network, every lead and seat invented (stress-...,
// ...@stress.invalid).
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
const SETTER = "stress-m1s5-setter@stress.invalid";
const OTHER = "stress-m1s5-other@stress.invalid";
const MANAGER = "stress-m1s5-manager@stress.invalid";
const LEAD = "stress-m1s5-Lead";
const MEETING = "81234567895";
const ZOOM_URL = `https://us06web.zoom.us/j/${MEETING}?pwd=abc`;
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const HOST_TOKEN = "hosttokenm1s5";

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
  w.routes.push((m, p) => {
    if (m === "GET" && p.startsWith("/contacts/")) return { contact };
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
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
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

/** The worker makes and opens a requested room (as desk rooms.py finish does), then the handshake sends its link. */
async function workerOpens(w: ReturnType<typeof setup>, id: string, run: string): Promise<void> {
  const provider = String(w.room(id).provider);
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: { state: "creating", claimed_at: w.db.iso(), worker_run: run, version: Number(w.room(id).version) + 1 },
  });
  await w.io.db("cockpit_sales_room_events", {
    method: "POST",
    body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: run } },
  });
  const meeting = provider === "meet" ? `evt-${run}` : MEETING;
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.${run}`, {
    method: "PATCH",
    body: {
      state: "open",
      join_url: provider === "meet" ? MEET_URL : ZOOM_URL,
      provider_meeting_id: meeting,
      opened_at: w.db.iso(),
      version: Number(w.room(id).version) + 1,
    },
  });
  if (provider === "zoom")
    w.db.seed("cockpit_sales_room_secrets", [
      { room_id: id, start_url: `https://us06web.zoom.us/s/${MEETING}?zak=${HOST_TOKEN}`, expires_at: new Date(w.clock.now + 60 * MIN).toISOString() },
    ]);
  await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: run } });
  await w.flush();
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
  await workerOpens(w, id, "run-1");
  return id;
}

/** Use Meet / Try Zoom as the panel asks for it (lib/rooms.ts retryAsk): one room.create naming the room it replaces. */
function useOther(w: ReturnType<typeof setup>, id: string): Row {
  const r = w.room(id);
  return {
    request_id: crypto.randomUUID(),
    contact_id: r.contact_id,
    provider: r.provider === "zoom" ? "meet" : "zoom",
    call_kind: r.call_kind,
    purpose: r.purpose,
    replaces: id,
    replaces_version: Number(r.version),
  };
}

/** Zoom's webhook as sales-live keeps it (cleanZoom, zoomText, zoomDedupeKey), stored on `roomId`, then passed on. */
async function zoomEvent(w: ReturnType<typeof setup>, roomId: string, body: Row): Promise<string> {
  // Each event a second after the last, so the timeline tells them apart by time.
  w.clock.now += 1000;
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

const joinOn = (w: ReturnType<typeof setup>, p: Row): Row => ({
  event: "meeting.participant_joined",
  event_ts: w.clock.now,
  payload: {
    account_id: "acct-m1s5",
    object: {
      id: MEETING,
      uuid: `m1s5-${MEETING}==`,
      host_id: "Z-setter",
      topic: "Mahara call K7Q5MB",
      participant: { join_time: new Date(w.clock.now).toISOString(), ...p },
    },
  },
});

/** The rep's timeline line for a Zoom event, as room.status gives it. */
async function timelineLine(w: ReturnType<typeof setup>, roomId: string, eventId: string): Promise<string> {
  const st = await w.rooms.actions["room.status"]!(setter, { room_id: roomId });
  const row = w.db.t("cockpit_sales_room_events").find(e => e.id === eventId) as Row;
  const ev = (st.events as Row[]).find(e => e.kind === row.kind && e.at === row.at);
  return String(ev?.text ?? "");
}

// ---------------------------------------------------------------------------
// 1. Use Meet / Try Zoom on another rep's room (round 4c's one-step replace)
// ---------------------------------------------------------------------------

describe("m1 security r5: Use Meet / Try Zoom naming another rep's room", () => {
  test("control: the setter's own Try Zoom on their open Meet room cancels it and makes the Zoom room, still the setter's", async () => {
    const w = setup();
    const id = await openRoom(w, "meet");
    const out = await w.rooms.actions["room.create"]!(setter, useOther(w, id));
    await w.flush();
    const made = w.room(String((out.room as Row).id));
    expect(w.room(id).state).toBe("cancelled");
    expect(String(made.host_email)).toBe(SETTER);
    expect(String(made.provider)).toBe("zoom");
  });

  test("control: another setter's Try Zoom naming the setter's open Meet room is refused, and the setter's room stays open with no new room", async () => {
    const w = setup();
    const id = await openRoom(w, "meet");
    const before = w.db.t("cockpit_sales_rooms").length;
    const r = await refused(w.rooms.actions["room.create"]!(other, useOther(w, id)));
    await w.flush();
    expect(r).not.toBeNull();
    expect(w.room(id).state).toBe("open");
    expect(w.db.t("cockpit_sales_rooms").length).toBe(before);
  });

  test("m1-security-r5-manager-use-other-takes-setters-lead: a manager's Try Zoom naming the setter's open Meet room cancels the setter's room and makes the lead's new room the manager's own (host, host link and the name in the lead's message), unlike the manager's I can't let them in, which keeps the replacement the setter's", async () => {
    const w = setup();
    const id = await openRoom(w, "meet");
    const sendsBefore = w.sends.length;
    const out = await w.rooms.actions["room.create"]!(manager, useOther(w, id)).catch(e => e);
    await w.flush();
    if (out instanceof ApiRefusal) {
      // Refused is a rule that holds: the setter's room is untouched.
      expect(w.room(id).state).toBe("open");
      return;
    }
    const madeId = String((out.room as Row).id);
    await workerOpens(w, madeId, "run-2");
    const made = w.room(madeId);
    const said = w.sends.slice(sendsBefore).map(s => String(s.body ?? "")).join(" | ");
    // The same rule as admit_blocked's replacement (m1 round 4b control):
    // the setter's call, the setter's room. Observed: the manager's.
    expect({
      setter_room: w.room(id).state,
      new_host: String(made.host_email),
      setter_can_open: await refused(w.rooms.actions["room.open"]!(setter, { room_id: madeId })).then(r => (r ? r.message : "yes")),
      message_names: /Mona/.test(said) ? "the manager" : /Tara/.test(said) ? "the setter" : said,
    }).toEqual({ setter_room: "cancelled", new_host: SETTER, setter_can_open: "yes", message_names: "the setter" });
  });
});

// ---------------------------------------------------------------------------
// 2. A lead's Zoom name nobody can see, on the rep's timeline
// ---------------------------------------------------------------------------

describe("m1 security r5: a Zoom name made of letters that draw nothing", () => {
  test("control: a Zoom name of zero-width spaces is no name on the timeline (m1 round 4 holds)", async () => {
    const w = setup();
    const id = await openRoom(w, "zoom");
    await zoomEvent(w, id, joinOn(w, { id: "Z-setter", user_name: "Tara Setter", participant_uuid: "pu-host" }));
    const ev = await zoomEvent(w, id, joinOn(w, { id: "", user_name: "​​​", participant_uuid: "pu-lead" }));
    expect(await timelineLine(w, id, ev)).toBe("Zoom: Someone joined.");
  });

  for (const [label, name] of [
    ["Hangul fillers (U+3164)", "ㅤㅤㅤ"],
    ["Hangul choseong and jungseong fillers (U+115F U+1160)", "ᅟᅠ"],
    ["a halfwidth Hangul filler and a braille blank (U+FFA0 U+2800)", "ﾠ⠀"],
    ["soft hyphens and a combining grapheme joiner (U+00AD U+034F)", "­­͏"],
  ] as const) {
    test(`m1-security-r5-zoom-blank-name-on-timeline: a lead's Zoom name of ${label} draws nothing, yet the rep's line reads "Zoom: <nothing> joined." where a name nobody can see should read Someone`, async () => {
      const w = setup();
      const id = await openRoom(w, "zoom");
      await zoomEvent(w, id, joinOn(w, { id: "Z-setter", user_name: "Tara Setter", participant_uuid: "pu-host" }));
      const ev = await zoomEvent(w, id, joinOn(w, { id: "", user_name: name, participant_uuid: "pu-lead" }));
      expect(w.room(id).state).toBe("lead_in");
      expect(await timelineLine(w, id, ev)).toBe("Zoom: Someone joined.");
    });
  }
});
