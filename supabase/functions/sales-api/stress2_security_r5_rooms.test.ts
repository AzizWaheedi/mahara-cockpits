// bun test supabase/functions/sales-api/stress2_security_r5_rooms.test.ts
//
// Second series, round 5, angle: security and abuse. Zoom's callbacks in the
// order they really arrive, against "That was not the lead".
//
// Fix round 4 (not-lead-swallows-later-real-join) made a later Zoom join
// stand after That was not the lead: laterJoinStands re-applies any handled
// join of "someone outside the team" on the room's own meeting whose time is
// after the taken-back join and before the press. It never asks WHO joined.
// The person the rep just said is not the lead (an assistant, a colleague
// not in room_hosts, whoever had the link) drops and rejoins once, as a phone
// on a weak line does: Zoom sends a second participant_joined for the same
// participant_uuid, read while the room is lead_in. The rep's press then
// re-marks the room lead_in on that same person's rejoin, and the count runs
// on it.
//
// A failing test is a finding. Against testfakes.ts: nothing reaches
// HighLevel, Zoom, Google or Slack; every lead is invented.

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "stress-r5-setter@stress.invalid";
const LEAD = "stress-r5-lead-000001";
const MEETING = "81234500095";
const ZOOM_URL = `https://us06web.zoom.us/j/${MEETING}?pwd=stress`;

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

function setup() {
  const w = fakeWorld();
  const audits: Row[] = [];
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
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({ crm: "quiet" }),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, rooms, room, audits };
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

/** The door's stored Zoom event of someone outside the team, then room.event for it. */
async function zoomPerson(
  w: ReturnType<typeof setup>,
  id: string,
  event: "meeting.participant_joined" | "meeting.participant_left",
  name: string,
  uuid: string,
  at: number,
): Promise<void> {
  const eventId = fakeUuid();
  const timeKey = event === "meeting.participant_joined" ? "join_time" : "leave_time";
  const detail = {
    event,
    event_ts: at,
    payload: {
      object: {
        id: MEETING,
        uuid: "u1==",
        host_id: "Z-setter",
        participant: { id: "", user_name: name, [timeKey]: new Date(at).toISOString(), participant_uuid: uuid },
      },
    },
  };
  w.db.seed("cockpit_sales_room_events", [
    {
      id: eventId,
      room_id: id,
      kind: `zoom.${event}`,
      source: "zoom",
      dedupe_key: `zoom:${event}:u1==:${uuid}:${new Date(at).toISOString()}`,
      at: new Date(at).toISOString(),
      text: "Zoom: someone.",
      detail,
    },
  ]);
  await w.rooms.desk["room.event"]!(desk, { kind: `zoom.${event}`, event_id: eventId, payload: {} });
  await w.flush();
}

describe("stress2 security r5: That was not the lead, and the same person's rejoin", () => {
  test("control: one join of the assistant, taken back: the room waits for the real lead again (the fixture works)", async () => {
    const w = setup();
    const id = await hostedZoomRoom(w);
    const t1 = w.clock.now;
    await zoomPerson(w, id, "meeting.participant_joined", "Sara (assistant)", "p-assistant", t1);
    expect(w.room(id).state).toBe("lead_in");
    w.clock.now += MIN;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    await w.flush();
    expect(w.room(id).state).toBe("host_in");
  });

  test("not-lead-rejoin-restores-lead-in: the assistant joins, her phone drops and she rejoins (a second join of the same Zoom participant), then the setter presses That was not the lead: the room must not go back to lead_in on her own rejoin", async () => {
    const w = setup();
    const id = await hostedZoomRoom(w);
    const t1 = w.clock.now;
    // 14:03:00 the assistant joins: the panel says the lead is in.
    await zoomPerson(w, id, "meeting.participant_joined", "Sara (assistant)", "p-assistant", t1);
    expect(w.room(id).state).toBe("lead_in");
    // 14:03:30 her line drops; 14:03:40 she is back in (same participant_uuid).
    w.clock.now += 30 * S;
    await zoomPerson(w, id, "meeting.participant_left", "Sara (assistant)", "p-assistant", w.clock.now);
    w.clock.now += 10 * S;
    await zoomPerson(w, id, "meeting.participant_joined", "Sara (assistant)", "p-assistant", w.clock.now);
    expect(w.room(id).state).toBe("lead_in");
    // 14:04:00 the setter, who can hear it is the assistant, takes the join back.
    w.clock.now += 20 * S;
    const out = await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    await w.flush();
    const r = w.room(id);
    // Nobody but the assistant ever joined: the room waits for Huda, and the
    // answer the setter's panel gets says so.
    expect({ state: r.state, answered: String((out.room as Row).state) }).toEqual({ state: "host_in", answered: "host_in" });
    // And no audit row says the lead's join stands.
    expect(w.audits.filter(a => String((a.metadata as Row | undefined)?.why ?? "").includes("later join stands"))).toHaveLength(0);
  });
});
