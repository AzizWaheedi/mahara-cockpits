// bun test supabase/functions/sales-api/stress2_concurrency_r5_later_join.test.ts
//
// Second series, round 5, dimension: concurrency and idempotency. Two Zoom
// joins and "That was not the lead" in the order they really arrive, read
// on to the call's end and the sweep's settle.
//
// Round 4 (not-lead-swallows-later-real-join) made the lead's own join stand
// again when its webhook was read while the room was lead_in and the setter
// then took the earlier join (her assistant's) back: laterJoinStands puts
// the room back to lead_in with lead_in_at = Huda's join. But every rule
// that asks "did the lead join" reads roomlogic leadJoined(), which is
// lead_in_at > count_undo_at, and Huda's join (14:04) is BEFORE the press
// (14:04:10) by construction (it is the join the press did not mean). So
// the restored join reads as taken back everywhere it counts:
//   - the live count never claims it (countClaimable/leadJoined);
//   - the host's End with Huda in the room writes result no_join;
//   - the sweep's settle reads the closed room as nobody joined and, on the
//     shipped settings (short_link off, so no door open), marks the booked
//     intro a no-show in HighLevel although Huda sat in it for 25 minutes.
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
const LEAD = "stress-lead-s2c5-000004";
const MEETING = "81234500098";
const ZOOM_URL = `https://us06web.zoom.us/j/${MEETING}?pwd=stress`;
/** Thursday 8 October 2026, 10:00 Kuwait: the setter's own booked intro with Huda. */
const START = Date.parse("2026-10-08T07:00:00.000Z");

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

function setup(countOnJoin: boolean) {
  const w = fakeWorld();
  w.clock.now = START + MIN;
  const marks: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        count_on_join: countOnJoin,
        live_calendar_id: "LIVECAL",
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: false, whatsapp_template: false, email: false },
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
      },
    },
    { key: "live", value: { enabled: false } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "intro-1",
      contact_id: LEAD,
      call_type: "intro",
      calendar_id: "dsqmJ393Dwl9fDSbIVOI",
      status: "confirmed",
      start_at: new Date(START).toISOString(),
      end_at: new Date(START + 30 * MIN).toISOString(),
      assigned_user_id: "G-setter",
      booked_at: new Date(START - 48 * 60 * MIN).toISOString(),
    },
  ]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "PUT") return { ok: true };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: async (who, id, status, opts) => {
      const cur = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === id && !d.superseded_at);
      if (cur && cur.status === status) return { ...cur, repeated: true };
      if (cur) cur.superseded_at = w.db.iso();
      const made = { id: fakeUuid(), appointment_id: id, status, marked_by: who.email, note: opts?.note ?? null, superseded_at: null, marked_at: w.db.iso(), crm: "quiet" };
      marks.push({ id, status, by: who.email });
      w.db.t("cockpit_sales_dispositions").push(made);
      return { ...made };
    },
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, rooms, room, marks };
}
type W = ReturnType<typeof setup>;

/** The setter's fallback room for the intro, made at 10:01, opened, its link gone, the setter in, Zoom saw the meeting start. */
async function introRoom(w: W): Promise<string> {
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider: "zoom",
    call_kind: "intro",
    purpose: "fallback",
    trigger: "no_answer",
    appointment_id: "intro-1",
    item_kind: "intro",
  });
  const id = String((out.room as Row).id);
  expect(w.room(id).appointment_id).toBe("intro-1");
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(w.room(id).version) + 1 },
  });
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
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
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}`, {
    method: "PATCH",
    body: { link_sent_at: w.db.iso(), link_claimed_at: w.db.iso(), link_channels: ["whatsapp_text"] },
  });
  w.db.seed("cockpit_sales_room_events", [
    {
      room_id: id,
      kind: "zoom.meeting.started",
      source: "zoom",
      dedupe_key: `zoom:meeting.started:${MEETING}`,
      at: w.db.iso(),
      handled_at: w.db.iso(),
      detail: { event: "meeting.started", payload: { object: { id: MEETING } } },
    },
  ]);
  await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "host_in" });
  await w.flush();
  return id;
}

/** The door's stored Zoom join of someone outside the team, then room.event for it. */
async function zoomJoin(w: W, id: string, name: string, uuid: string, at: number): Promise<void> {
  const eventId = fakeUuid();
  w.db.seed("cockpit_sales_room_events", [
    {
      id: eventId,
      room_id: id,
      kind: "zoom.meeting.participant_joined",
      source: "zoom",
      dedupe_key: `zoom:meeting.participant_joined:${MEETING}:${uuid}:${new Date(at).toISOString()}`,
      at: new Date(at).toISOString(),
      text: "Zoom: someone joined.",
      detail: {
        event: "meeting.participant_joined",
        event_ts: at,
        payload: { object: { id: MEETING, uuid: "u1==", host_id: "Z-setter", participant: { id: "", user_name: name, join_time: new Date(at).toISOString(), participant_uuid: uuid } } },
      },
    },
  ]);
  await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: eventId, payload: {} });
  await w.flush();
}

/** 10:02 the assistant joins; 10:03 Huda joins (read while the room is lead_in); 10:03:10 That was not the lead about the assistant. */
async function assistantThenHuda(w: W, id: string): Promise<{ t2: number }> {
  w.clock.now = START + 2 * MIN;
  await zoomJoin(w, id, "Sara (assistant)", "p-assistant", w.clock.now);
  expect(w.room(id).state).toBe("lead_in");
  w.clock.now += MIN;
  const t2 = w.clock.now;
  await zoomJoin(w, id, "Huda Ali", "p-huda", t2);
  w.clock.now += 10 * S;
  await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
  await w.flush();
  // Round 4's fix: Huda's join stands again.
  expect(w.room(id).state).toBe("lead_in");
  expect(Date.parse(String(w.room(id).lead_in_at))).toBe(t2);
  return { t2 };
}

describe("Huda's own join, restored after That was not the lead, read on to the end of the call", () => {
  test("later-join-restored-reads-as-taken-back (shipped settings: count_on_join off, short_link off): Huda is in the intro for 25 minutes and the setter ends it; the room must say she joined, and the settle must never mark her intro a no-show", async () => {
    const w = setup(false);
    const id = await introRoom(w);
    await assistantThenHuda(w, id);
    // The intro runs; at 10:28 the setter ends the room with Huda in it.
    w.clock.now = START + 28 * MIN;
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "finished" });
    await w.flush();
    // The sweep posts the settle at the intro's start + settle (20 minutes after 10:00, run at 10:31).
    w.clock.now = START + 31 * MIN;
    w.db.insertOne("cockpit_sales_room_events", { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due." }, "ignore", "dedupe_key");
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    await w.flush();
    const r = w.room(id);
    expect({
      room_result: r.result,
      noshow_marks_on_the_intro: w.marks.filter(m => m.id === "intro-1" && m.status === "noshow").length,
      settled_as_noshow: r.settled_mark === "noshow",
    }).toEqual({ room_result: "joined", noshow_marks_on_the_intro: 0, settled_as_noshow: false });
  });

  test("later-join-restored-never-counted (count_on_join on): Huda's restored join must be counted (the intro the room carries marked shown)", async () => {
    const w = setup(true);
    const id = await introRoom(w);
    await assistantThenHuda(w, id);
    // The sweep's minutes re-ask whatever is owed.
    for (let i = 0; i < 3; i++) {
      w.clock.now += MIN;
      await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
      await w.flush();
    }
    const r = w.room(id);
    // The count for the assistant's join marked the intro and the press took
    // that back; what matters is where the intro stands now.
    const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === "intro-1" && !d.superseded_at);
    expect({
      intro_current_mark: current?.status ?? null,
      count_result: r.count_result ?? null,
      lead_joined_reads: Date.parse(String(r.lead_in_at)) > Date.parse(String(r.count_undo_at ?? 0)),
    }).toEqual({ intro_current_mark: "showed", count_result: null, lead_joined_reads: true });
  });

  test("control: Huda's webhook read after the press (her join time still before it) is the same join and must count the same way", async () => {
    const w = setup(true);
    const id = await introRoom(w);
    w.clock.now = START + 2 * MIN;
    await zoomJoin(w, id, "Sara (assistant)", "p-assistant", w.clock.now);
    const t2 = w.clock.now + MIN;
    w.clock.now = t2 + 10 * S;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
    await w.flush();
    // Zoom's webhook for Huda's 10:03 join arrives at 10:03:15 (Zoom's lag).
    w.clock.now += 5 * S;
    await zoomJoin(w, id, "Huda Ali", "p-huda", t2);
    for (let i = 0; i < 3; i++) {
      w.clock.now += MIN;
      await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
      await w.flush();
    }
    expect(w.room(id).state).toBe("lead_in");
    const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === "intro-1" && !d.superseded_at);
    expect({ intro_current_mark: current?.status ?? null, count_result: w.room(id).count_result ?? null }).toEqual({
      intro_current_mark: "showed",
      count_result: null,
    });
  });
});
