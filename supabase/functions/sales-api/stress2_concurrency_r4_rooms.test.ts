// bun test supabase/functions/sales-api/stress2_concurrency_r4_rooms.test.ts
//
// Second series, round 4, dimension: concurrency and idempotency. Two Zoom
// joins and "That was not the lead" in the order they really arrive.
//
// The panel shows "the lead is in" from the first outside join (14:03, the
// lead's assistant). The lead herself joins at 14:04; Zoom's webhook for
// her join reaches sales-api while the room is still lead_in, where a lead
// join is a no-op (the event is finished, nothing kept). The setter, looking
// at the 14:03 join on the panel, presses "That was not the lead" at 14:04:10.
// roomlogic's own rule (takenBack) says only joins at or before the
// taken-back one (14:03) are taken back, and a later join stands; but the
// 14:04 join was already swallowed, so nothing re-applies it. The room goes
// back to "waiting for the lead" with the lead in the meeting; the sweep's
// R4 closes it as a no-show at lead_by, and her join is never counted.
//
// A failing test is a finding for the fix agent. Nothing here reaches
// HighLevel, Zoom, Google or Slack; every lead is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-lead-s2c4-000002";
const MEETING = "81234500088";
const ZOOM_URL = `https://us06web.zoom.us/j/${MEETING}?pwd=stress`;

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

function setup() {
  const w = fakeWorld();
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        count_on_join: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: false, whatsapp_template: false, email: false },
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
      },
    },
    { key: "live", value: { enabled: false } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: async () => ({ crm: "quiet" }),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, rooms, room };
}

/** The setter's lead-page Zoom room, made, opened, its link gone, the setter in. */
async function hostedZoomRoom(w: ReturnType<typeof setup>): Promise<string> {
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
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
    method: "PATCH",
    body: {
      state: "open",
      join_url: ZOOM_URL,
      provider_meeting_id: MEETING,
      opened_at: w.db.iso(),
      host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
      ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
      lead_by: new Date(w.clock.now + 10 * MIN).toISOString(),
      version: Number(w.room(id).version) + 1,
    },
  });
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), link_claimed_at: w.db.iso() } });
  await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "host_in" });
  await w.flush();
  return id;
}

/** The door's stored Zoom join of someone outside the team, then room.event for it. */
async function zoomJoin(w: ReturnType<typeof setup>, id: string, name: string, uuid: string, at: number): Promise<void> {
  const eventId = fakeUuid();
  const detail = {
    event: "meeting.participant_joined",
    event_ts: at,
    payload: { object: { id: MEETING, uuid: "u1==", host_id: "Z-setter", participant: { id: "", user_name: name, join_time: new Date(at).toISOString(), participant_uuid: uuid } } },
  };
  w.db.seed("cockpit_sales_room_events", [
    {
      id: eventId,
      room_id: id,
      kind: "zoom.meeting.participant_joined",
      source: "zoom",
      dedupe_key: `zoom:meeting.participant_joined:${eventId}`,
      at: new Date(at).toISOString(),
      text: "Zoom: someone joined.",
      detail,
    },
  ]);
  await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: eventId, payload: {} });
  await w.flush();
}

describe("That was not the lead after the lead's own later join was read", () => {
  test("not-lead-swallows-later-real-join: the assistant joins at 14:03 (the panel says the lead is in), Huda joins at 14:04 and Zoom's webhook is read, then the setter presses That was not the lead about the 14:03 join; Huda's 14:04 join must stand", async () => {
    const w = setup();
    const id = await hostedZoomRoom(w);
    const t1 = w.clock.now;
    await zoomJoin(w, id, "Sara (assistant)", "p-assistant", t1);
    expect(w.room(id).state).toBe("lead_in");
    expect(Date.parse(String(w.room(id).lead_in_at))).toBe(t1);
    // A minute on, the lead herself joins; her webhook is read while the room is lead_in.
    w.clock.now += MIN;
    const t2 = w.clock.now;
    await zoomJoin(w, id, "Huda Ali", "p-lead", t2);
    expect(w.room(id).state).toBe("lead_in");
    // Ten seconds later the setter, looking at the 14:03 join on the panel, takes it back.
    w.clock.now += 10 * S;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    await w.flush();
    // The sweep's minute (the tick) changes nothing either.
    w.clock.now += MIN;
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    const r = w.room(id);
    expect({ state: r.state, lead_in_at: r.lead_in_at ? new Date(String(r.lead_in_at)).toISOString() : null }).toEqual({
      state: "lead_in",
      lead_in_at: new Date(t2).toISOString(),
    });
  });

  test("control: the same two joins with Huda's webhook read after the press: her join stands (takenBack keeps a later join)", async () => {
    const w = setup();
    const id = await hostedZoomRoom(w);
    const t1 = w.clock.now;
    await zoomJoin(w, id, "Sara (assistant)", "p-assistant", t1);
    w.clock.now += MIN;
    const t2 = w.clock.now;
    w.clock.now += 10 * S;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    await w.flush();
    await zoomJoin(w, id, "Huda Ali", "p-lead", t2);
    expect(w.room(id).state).toBe("lead_in");
  });
});
