// bun test supabase/functions/sales-api/stress2_concurrency_r5_copy.test.ts
//
// Second series, round 5, dimension: concurrency and idempotency. The
// minute's tick against "That was not the lead".
//
// For an hour after a join the tick keeps the live booking's calendar copy
// in step (rooms.ts tick -> syncLiveCopy, fix round 4). The tick reads the
// room first (count_result booked, the booking's id), then the room's
// pending events and the host's next call, and only then starts
// syncLiveCopy on the room AS IT READ IT. syncLiveCopy never reads the room
// again: it reads the copy, then HighLevel's booking, and when neither is
// there it raises "the live booking was not copied" for a person.
//
// "That was not the lead" pressed inside its five minutes lands in that
// gap: its undo deletes the booking in HighLevel and its copy, resolves the
// room's alerts (live_copy among them) and writes undone. syncLiveCopy then
// finds no copy and no booking (HighLevel answers 404) and raises the
// alert for a booking that was taken back on purpose. Nothing answers it
// after that (the undo's resolve ran first), so #sales-alerts asks a person
// to copy a live intro that does not exist.
//
// A failing test is a finding for the fix agent. Nothing here reaches
// HighLevel, Zoom, Google or Slack; every lead and figure is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { GhlError, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-lead-s2c5-000002";
const ZOOM_URL = "https://us06web.zoom.us/j/81234500096?pwd=stress";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  count_on_join: true,
  test_calendar_id: "TESTCAL",
  live_calendar_id: "LIVECAL",
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: false, whatsapp_template: false, email: false },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};

function setup() {
  const w = fakeWorld();
  const hl = new Map<string, Row>();
  const jobs: Promise<unknown>[] = [];
  /** Runs once, the first time a read's path starts with `prefix` (before the read answers). */
  let hook: { prefix: string; run: () => Promise<void> } | null = null;
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON } },
    { key: "live", value: { enabled: false, standby: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.routes.push(async (m, p, body) => {
    const b = (body ?? {}) as Row;
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [...hl.values()] };
    if (m === "POST" && p === "/calendars/events/appointments") {
      const id = `live-${fakeUuid()}`;
      hl.set(id, { id, ...b });
      return { id };
    }
    const del = /^\/calendars\/events\/([^/?]+)$/.exec(p);
    if (del && m === "DELETE") {
      const id = decodeURIComponent(del[1] as string);
      if (!hl.has(id)) throw new GhlError("HighLevel said 404: not found", 404);
      hl.delete(id);
      return { ok: true };
    }
    const one = /^\/calendars\/events\/appointments\/([^/?]+)$/.exec(p);
    if (one) {
      const id = decodeURIComponent(one[1] as string);
      if (!hl.has(id)) throw new GhlError("HighLevel said 404: not found", 404);
      if (m === "GET") return { appointment: { ...hl.get(id) } };
      if (m === "PUT") {
        hl.set(id, { ...(hl.get(id) as Row), ...b });
        return { ok: true };
      }
    }
    return null as unknown as Row;
  });
  const io: LiveIO = {
    ...w.io,
    db: async (path, init) => {
      if (hook && (init?.method ?? "GET") === "GET" && path.startsWith(hook.prefix)) {
        const h = hook;
        hook = null;
        await h.run();
      }
      return await w.io.db(path, init);
    },
    background: p => {
      jobs.push(p);
      w.io.background(p);
    },
  };
  const deps: RoomDeps = {
    io,
    audit: async () => {},
    markAppointment: async () => ({ crm: "quiet" }),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function notLeadNow(id: string): Promise<void> {
    const from = jobs.length;
    await rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(room(id).version), what: "not_lead" });
    for (let i = 0; i < 10; i++) {
      const now = jobs.slice(from);
      await Promise.allSettled(now);
      if (jobs.length - from === now.length) break;
    }
  }
  return {
    ...w,
    rooms,
    room,
    hl,
    notLeadNow,
    setHook: (prefix: string, run: () => Promise<void>) => {
      hook = { prefix, run };
    },
  };
}

/** The setter's lead-page Zoom room; someone outside the team joins and the count books "Live · Huda". */
async function joinAndCount(w: ReturnType<typeof setup>): Promise<string> {
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
      provider_meeting_id: "81234500096",
      opened_at: w.db.iso(),
      host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
      ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
      version: Number(w.room(id).version) + 1,
    },
  });
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso() } });
  seedLeadZoomJoin(w.db, id);
  await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
  await w.flush();
  return id;
}

describe("the minute's tick keeps the live copy in step while That was not the lead lands", () => {
  test("tick-live-copy-alert-after-undo: the tick read the room as booked; the undo deletes the booking and its copy before syncLiveCopy reads them; no 'live booking not copied' alert may be left open for a booking taken back", async () => {
    const w = setup();
    const id = await joinAndCount(w);
    const booked = w.room(id);
    expect(booked.count_result).toBe("booked");
    const apptId = String(booked.count_appointment_id);
    expect(w.db.t("cockpit_sales_appointments").some(a => a.appointment_id === apptId)).toBe(true);
    // A minute on, the sweep's tick; the setter's That was not the lead lands
    // after the tick read the room and before syncLiveCopy reads the copy.
    w.clock.now += MIN;
    w.setHook(`cockpit_sales_appointments?appointment_id=eq.${apptId}&select=status`, async () => {
      // The press, and its undo run to its end (polled: the undo is a
      // background job beside this tick's own syncLiveCopy, which waits here).
      await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "not_lead" });
      for (let i = 0; i < 200 && w.room(id).count_result !== "undone"; i++) await new Promise(r => setTimeout(r, 0));
      for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
    });
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    expect(w.room(id).count_result).toBe("undone");
    expect(w.hl.has(apptId)).toBe(false);
    const open = w.db
      .t("cockpit_sales_alerts")
      .filter(a => !a.resolved_at && String(a.dedupe_key).startsWith(`room:${id}:`))
      .map(a => ({ key: String(a.dedupe_key).replace(`room:${id}:`, "room:"), message: String(a.message) }));
    expect({ open_alerts_for_the_room: open }).toEqual({ open_alerts_for_the_room: [] });
  });

  test("control: the undo with no tick beside it leaves no alert open", async () => {
    const w = setup();
    const id = await joinAndCount(w);
    w.clock.now += MIN;
    await w.notLeadNow(id);
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    expect(w.room(id).count_result).toBe("undone");
    expect(w.db.t("cockpit_sales_alerts").filter(a => !a.resolved_at && String(a.dedupe_key).startsWith(`room:${id}:`))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The rep's hand press and Zoom's own join of the lead, in the order a slow
// webhook delivers them.
//
// Zoom's join of Huda is stored by the door, but sales-api did not take it
// in time (an instance busy, the door's 16 s window passed): it waits for
// the sweep's replay (event_replay, 20 s). The panel offers "The lead is in"
// on a Zoom room after 30 s, and the setter, who sees Huda on screen,
// presses it. The live count runs at the press: Zoom's join is not read yet
// (no role on it until it is handled), so the join is self_reported and a
// manager is asked to confirm it. The replay then handles Zoom's join: the
// room is lead_in already, so it changes nothing, and nothing runs the count
// again. A join Zoom itself reported waits on a manager for good.
// ---------------------------------------------------------------------------

describe("the hand press lands before Zoom's own join of the lead is read", () => {
  test("zoom-join-after-hand-press-stays-self-reported: the replay reads Zoom's join of Huda after the setter's press; the count must stand on Zoom's join, with no manager's confirm left asked", async () => {
    const w = setup();
    const out = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "intro",
      purpose: "manual",
    });
    const id = String((out.room as Row).id);
    await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(w.room(id).version) + 1 },
    });
    await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: ZOOM_URL,
        provider_meeting_id: "81234500096",
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(w.room(id).version) + 1,
      },
    });
    await w.db.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), link_claimed_at: w.db.iso() } });
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "host_in" });
    await w.flush();
    // 14:03:00 Huda joins; the door stores Zoom's join, sales-api has not taken it.
    const at = w.clock.now;
    const eventId = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      {
        id: eventId,
        room_id: id,
        kind: "zoom.meeting.participant_joined",
        source: "zoom",
        dedupe_key: `zoom:meeting.participant_joined:81234500096:p-huda:${new Date(at).toISOString()}`,
        at: new Date(at).toISOString(),
        text: "Zoom: someone joined.",
        detail: {
          event: "meeting.participant_joined",
          event_ts: at,
          payload: { object: { id: "81234500096", uuid: "u1==", host_id: "Z-setter", participant: { id: "", user_name: "Huda Ali", join_time: new Date(at).toISOString(), participant_uuid: "p-huda" } } },
        },
      },
    ]);
    // 14:03:30 the panel offers The lead is in; the setter presses it.
    w.clock.now += 30 * 1000;
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    // 14:03:40 the sweep replays Zoom's join; then the minute's tick.
    w.clock.now += 10 * 1000;
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [eventId] } });
    await w.flush();
    for (let i = 0; i < 2; i++) {
      w.clock.now += MIN;
      await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
      await w.flush();
    }
    const r = w.room(id);
    const confirmAsked = w.db.t("cockpit_sales_alerts").filter(a => !a.resolved_at && String(a.dedupe_key) === `room:${id}:count_confirm`).length;
    expect({ zoom_join_handled: Boolean(w.db.t("cockpit_sales_room_events").find(e => e.id === eventId)?.handled_at), count_result: r.count_result, manager_confirm_asked: confirmAsked }).toEqual({
      zoom_join_handled: true,
      count_result: "booked",
      manager_confirm_asked: 0,
    });
  });
});
