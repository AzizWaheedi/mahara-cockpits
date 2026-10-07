// bun test supabase/functions/sales-api/stress2_concurrency_r4_count_undo.test.ts
//
// Second series, round 4, dimension: concurrency and idempotency. The live
// count against "That was not the lead" when the press lands AFTER the
// count's result write and BEFORE the count's last steps.
//
// countResult guards only the result write (count_undo_at null, F7). What
// comes after it runs on the room as the count read it, never re-read:
//   - countMove: markShowed (the showed status on the moved call);
//   - countCreate: markShowed, then copyLiveBooking (the cockpit's calendar
//     copy that the pay estimate and the EOD read).
// markShowed retries after 2 s when HighLevel refuses the first try (a 429:
// the cockpit, the mirror and the desk share one HighLevel location). The
// rep presses "That was not the lead" in that gap (inside its five minutes),
// and runUndo finishes before the retry:
//   - move: the undo puts the intro back to tomorrow, status confirmed; the
//     count's retry then marks it showed. Tomorrow's intro reads "showed" in
//     HighLevel (B2B's show rate counts a call that has not happened).
//   - create: the undo deletes the live booking and its (absent) copy; the
//     count's retry fails on the deleted booking, raises "Mark it shown in
//     HighLevel" for a booking that was taken back, and copyLiveBooking then
//     writes the copy row the undo meant to remove: the pay estimate and the
//     EOD count a live intro that was taken back.
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
const HOUR = 60 * MIN;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-lead-s2c4-000001";
const ZOOM_URL = "https://us06web.zoom.us/j/81234500077?pwd=stress";

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

/**
 * HighLevel as a stateful calendar: POST books, PUT writes, DELETE removes,
 * a PUT or GET on a deleted booking is a 404. `onShowed` runs when the
 * count's showed-status PUT (a body of appointmentStatus "showed" alone)
 * arrives the first time; it may answer 429 (HighLevel refused that try).
 */
function setup() {
  const w = fakeWorld();
  const hl = new Map<string, Row>();
  const calls: { id: string; booked_at: number }[] = [];
  const jobs: Promise<unknown>[] = [];
  let onShowed: (() => Promise<"429" | "pass">) | null = null;
  /** Runs once after HighLevel has applied the count's showed PUT and before its answer reaches sales-api (a slow answer). */
  let afterShowed: (() => Promise<void>) | null = null;
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON } },
    { key: "live", value: { enabled: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
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
      if (m === "GET") {
        if (!hl.has(id)) throw new GhlError("HighLevel said 404: not found", 404);
        return { appointment: { ...hl.get(id) } };
      }
      if (m === "PUT") {
        if (b.appointmentStatus === "showed" && Object.keys(b).every(k => k === "appointmentStatus" || k === "toNotify") && onShowed) {
          const hook = onShowed;
          onShowed = null;
          if ((await hook()) === "429") throw new GhlError("HighLevel said 429: Too many requests", 429);
        }
        if (!hl.has(id)) throw new GhlError("HighLevel said 404: not found", 404);
        hl.set(id, { ...(hl.get(id) as Row), ...b });
        if (b.appointmentStatus === "showed" && Object.keys(b).every(k => k === "appointmentStatus" || k === "toNotify") && afterShowed) {
          const hook = afterShowed;
          afterShowed = null;
          await hook();
        }
        return { ok: true };
      }
    }
    return null as unknown as Row;
  });
  /** index.ts markAppointment as it writes: the cockpit's disposition, then HighLevel's status. */
  async function markAppointment(who: Who, id: string, status: string, opts: Row = {}): Promise<Row> {
    const current = w.db.t("cockpit_sales_dispositions").find(d => d.appointment_id === id && !d.superseded_at);
    if (current && current.status === status && current.crm !== "failed") return { ...current, repeated: true };
    if (current) current.superseded_at = w.db.iso();
    const made: Row = {
      id: fakeUuid(),
      appointment_id: id,
      status,
      marked_by: who.email,
      note: (opts.note as string | undefined) ?? null,
      superseded_at: null,
      marked_at: w.db.iso(),
      crm: opts.quiet ? "quiet" : "written",
    };
    w.db.t("cockpit_sales_dispositions").push(made);
    hl.set(id, { ...(hl.get(id) ?? { id }), appointmentStatus: status });
    return { ...made };
  }
  const io: LiveIO = {
    ...w.io,
    background: p => {
      jobs.push(p);
      w.io.background(p);
    },
  };
  const deps: RoomDeps = {
    io,
    audit: async () => {},
    markAppointment: (who, id, status, opts) => markAppointment(who, id, status, opts as Row),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async (_c, _kind, opts) => {
      const after = opts?.after ?? w.clock.now;
      const bound = opts?.booked_before ?? null;
      const ahead = calls
        .filter(c => hl.has(c.id))
        .map(c => ({ ...c, a: hl.get(c.id) as Row }))
        .filter(c => Date.parse(String(c.a.startTime)) > after && (bound === null || c.booked_at < bound))
        .sort((x, y) => Date.parse(String(x.a.startTime)) - Date.parse(String(y.a.startTime)))[0];
      return ahead
        ? {
            id: ahead.id,
            start: Date.parse(String(ahead.a.startTime)),
            end: Date.parse(String(ahead.a.endTime)),
            assigned_user_id: String(ahead.a.assignedUserId),
            status: String(ahead.a.appointmentStatus),
            booked_at: ahead.booked_at,
          }
        : null;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  /** "That was not the lead" pressed now, and the undo it starts run to its end. */
  async function notLeadNow(id: string): Promise<void> {
    const from = jobs.length;
    await rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(room(id).version), what: "not_lead" });
    await Promise.allSettled(jobs.slice(from));
  }
  return {
    ...w,
    rooms,
    room,
    hl,
    calls,
    notLeadNow,
    setOnShowed: (f: () => Promise<"429" | "pass">) => {
      onShowed = f;
    },
    setAfterShowed: (f: () => Promise<void>) => {
      afterShowed = f;
    },
  };
}

/** The setter's lead-page Zoom room; someone outside the team joins (Zoom sees a guest) and the count runs. */
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
      provider_meeting_id: "81234500077",
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
  await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
  await w.flush();
  return id;
}

describe("That was not the lead lands while the count retries its showed status", () => {
  test("undo-during-showed-retry-marks-moved-back-intro-showed: the count moves tomorrow's intro to the join; HighLevel refuses its first showed write (429); in the 2 s before the retry the setter presses That was not the lead and the undo puts the intro back to tomorrow, confirmed; the retry must not mark tomorrow's intro showed", async () => {
    const w = setup();
    const tomorrow = w.clock.now + 20 * HOUR;
    w.hl.set("intro-1", {
      id: "intro-1",
      calendarId: "dsqmJ393Dwl9fDSbIVOI",
      startTime: new Date(tomorrow).toISOString(),
      endTime: new Date(tomorrow + 30 * MIN).toISOString(),
      assignedUserId: "G-setter",
      appointmentStatus: "confirmed",
    });
    w.calls.push({ id: "intro-1", booked_at: w.clock.now - 48 * HOUR });
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "intro-1",
        contact_id: LEAD,
        call_type: "intro",
        calendar_id: "dsqmJ393Dwl9fDSbIVOI",
        status: "confirmed",
        start_at: new Date(tomorrow).toISOString(),
        end_at: new Date(tomorrow + 30 * MIN).toISOString(),
        assigned_user_id: "G-setter",
        booked_at: new Date(w.clock.now - 48 * HOUR).toISOString(),
      },
    ]);
    let roomId = "";
    w.setOnShowed(async () => {
      // The count's result (moved) has landed; its first showed write meets a 429.
      expect(w.room(roomId).count_result).toBe("moved");
      await w.notLeadNow(roomId);
      return "429";
    });
    // The room id is known once room.create answers; the hook reads it lazily.
    const realCreate = w.rooms.actions["room.create"]!;
    w.rooms.actions["room.create"] = async (who, b) => {
      const out = await realCreate(who, b);
      roomId = String((out.room as Row).id);
      return out;
    };
    const id = await joinAndCount(w);
    await w.flush();
    // One more minute's tick, as the sweep would post it.
    w.clock.now += MIN;
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    const intro = w.hl.get("intro-1") as Row;
    // The undo landed and the intro is back at tomorrow's time...
    expect(w.room(id).count_result).toBe("undone");
    expect(Date.parse(String(intro.startTime))).toBe(tomorrow);
    // ...and it must still be the confirmed intro it was, not a show.
    expect({ tomorrow_intro_status_in_highlevel: intro.appointmentStatus }).toEqual({ tomorrow_intro_status_in_highlevel: "confirmed" });
  });

  test("undo-before-live-copy-resurrects-taken-back-booking: the count books 'Live · Huda'; HighLevel refuses its first showed write (429); the setter's That was not the lead deletes the booking before the retry; no copy of the deleted booking may stay in the cockpit's calendar (pay, EOD) and nobody may be told to mark it shown", async () => {
    const w = setup();
    let roomId = "";
    w.setOnShowed(async () => {
      expect(w.room(roomId).count_result).toBe("booked");
      await w.notLeadNow(roomId);
      return "429";
    });
    const realCreate = w.rooms.actions["room.create"]!;
    w.rooms.actions["room.create"] = async (who, b) => {
      const out = await realCreate(who, b);
      roomId = String((out.room as Row).id);
      return out;
    };
    const id = await joinAndCount(w);
    await w.flush();
    w.clock.now += MIN;
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    const r = w.room(id);
    expect(r.count_result).toBe("undone");
    // The booking itself is gone from HighLevel (the undo deleted it).
    expect([...w.hl.keys()].filter(k => k.startsWith("live-"))).toEqual([]);
    const copies = w.db.t("cockpit_sales_appointments").filter(a => String(a.appointment_id).startsWith("live-"));
    const openAlerts = w.db
      .t("cockpit_sales_alerts")
      .filter(a => !a.resolved_at && String(a.dedupe_key) === `room:${id}:showed_failed`)
      .map(a => String(a.message));
    expect({ copies_of_taken_back_booking: copies.map(c => ({ id: c.appointment_id, status: c.status })), mark_it_shown_alerts: openAlerts }).toEqual({
      copies_of_taken_back_booking: [],
      mark_it_shown_alerts: [],
    });
  });

  test("undo-during-slow-showed-answer-copies-taken-back-booking: no 429 at all: HighLevel takes the count's showed write and its answer is slow (a few seconds); the setter's That was not the lead deletes the booking meanwhile; the cockpit's calendar must not keep a shown live intro that was taken back", async () => {
    const w = setup();
    let roomId = "";
    w.setAfterShowed(async () => {
      expect(w.room(roomId).count_result).toBe("booked");
      await w.notLeadNow(roomId);
    });
    const realCreate = w.rooms.actions["room.create"]!;
    w.rooms.actions["room.create"] = async (who, b) => {
      const out = await realCreate(who, b);
      roomId = String((out.room as Row).id);
      return out;
    };
    const id = await joinAndCount(w);
    await w.flush();
    w.clock.now += MIN;
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    expect(w.room(id).count_result).toBe("undone");
    expect([...w.hl.keys()].filter(k => k.startsWith("live-"))).toEqual([]);
    const copies = w.db.t("cockpit_sales_appointments").filter(a => String(a.appointment_id).startsWith("live-"));
    expect({ copies_of_taken_back_booking: copies.map(c => ({ status: c.status, assigned_user_id: c.assigned_user_id })) }).toEqual({
      copies_of_taken_back_booking: [],
    });
  });
});
