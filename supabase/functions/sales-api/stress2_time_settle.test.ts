// bun test supabase/functions/sales-api/stress2_time_settle.test.ts
//
// TIME stress, second series, round 1: a booked intro moved in HighLevel in
// the minutes before its settle. The cockpit's copy of the calendar
// (cockpit_sales_appointments) is B2B's mirror, every three minutes, so it
// lags HighLevel. The setter's 10:00 intro: no answer at 10:00, a Zoom
// fallback room at 10:01, nobody joined, R4 closed it at 10:15. At 10:18 the
// lead rescheduled to 10:45 through HighLevel's own booking link (or the
// setter moved it in HighLevel's calendar): same appointment id, status
// still confirmed, start 10:45. The sweep's S1 at 10:21 still reads the old
// start from the lagging copy, so it posts sweep.settle; sales-api's settle
// reads the same copy and HighLevel's own record, but of HighLevel's record
// it reads only the status. The intro the lead has just moved must not be
// marked a no-show (a hard number in B2B's show rate, and the dialer drops
// a call marked noshow from the setter's queue).
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-time2-lead-000001";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/** Thursday 8 October 2026, 10:00 Kuwait. */
const START = Date.parse("2026-10-08T07:00:00.000Z");

function setup(hlStartMs: number) {
  const w = fakeWorld();
  w.clock.now = START;
  const marks: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: { ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, providers: { zoom: true, meet: true }, fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" } },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: {} },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  // The cockpit's copy: still the 10:00 start (the mirror has not run since the move).
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "intro-moved",
      contact_id: LEAD,
      call_type: "intro",
      calendar_id: BOOKING_CALENDARS.intro_qualified,
      status: "confirmed",
      start_at: new Date(START).toISOString(),
      assigned_user_id: "G-setter",
    },
  ]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact: { id: LEAD, firstName: "Huda", phone: "+96550000000", tags: ["roas-qualified"] } };
    // HighLevel's own record: the same appointment, still confirmed, at its new time.
    if (m === "GET" && p === "/calendars/events/appointments/intro-moved")
      return {
        appointment: {
          id: "intro-moved",
          appointmentStatus: "confirmed",
          startTime: new Date(hlStartMs).toISOString(),
          endTime: new Date(hlStartMs + 30 * MIN).toISOString(),
          assignedUserId: "G-setter",
        },
      };
    if (m === "PUT" || m === "DELETE") return { ok: true };
    if (m === "POST") return { id: "live-x" };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: async (who, id, status) => {
      marks.push({ who: who.email, id, status });
      w.db.t("cockpit_sales_dispositions").push({ id: fakeUuid(), appointment_id: id, status, marked_by: who.email, superseded_at: null, crm: "written" });
      return { crm: "written" };
    },
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const api = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const id = fakeUuid();
  w.db.seed("cockpit_sales_rooms", [
    {
      id,
      request_id: fakeUuid(),
      contact_id: LEAD,
      purpose: "fallback",
      trigger: "no_answer",
      call_kind: "intro",
      provider: "zoom",
      host_email: SETTER,
      made_by: SETTER,
      appointment_id: "intro-moved",
      // room.create stored the intro's start as it stood at 10:01.
      appointment_start_at: new Date(START).toISOString(),
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
      join_url: ZOOM_URL,
      provider_meeting_id: "81234567890",
      requested_at: new Date(START + 1 * MIN).toISOString(),
      opened_at: new Date(START + 1 * MIN).toISOString(),
      link_sent_at: new Date(START + 1 * MIN + 5 * S).toISOString(),
      link_channels: ["whatsapp_text"],
      host_in_at: new Date(START + 2 * MIN).toISOString(),
      ended_at: new Date(START + 15 * MIN).toISOString(),
      version: 4,
    },
  ]);
  w.db.seed("cockpit_sales_room_events", [
    {
      room_id: id,
      kind: "zoom.meeting.started",
      source: "zoom",
      dedupe_key: `zoom:meeting.started:${id}`,
      at: new Date(START + 2 * MIN).toISOString(),
      handled_at: new Date(START + 2 * MIN).toISOString(),
    },
  ]);
  async function settle(at: number) {
    w.db.insertOne(
      "cockpit_sales_room_events",
      { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}`, text: "Due." },
      "ignore",
      "dedupe_key",
    );
    w.clock.now = at;
    await api.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    await w.flush();
  }
  const noshows = () => marks.filter(m => m.status === "noshow");
  return { ...w, id, room, settle, noshows };
}

describe("an intro moved in HighLevel three minutes before its settle (the copy has not caught up)", () => {
  test("moved to 10:45 the same morning: the settle at 10:21 marks nothing on the moved intro", async () => {
    const w = setup(START + 45 * MIN);
    await w.settle(START + 21 * MIN);
    expect(w.noshows()).toHaveLength(0);
    expect(w.room(w.id).settled_mark).not.toBe("noshow");
  });

  test("moved to tomorrow 10:00 (the lead's own reschedule link): no no-show on tomorrow's intro", async () => {
    const w = setup(START + 24 * 60 * MIN);
    await w.settle(START + 21 * MIN);
    expect(w.noshows()).toHaveLength(0);
  });

  test("control: HighLevel still has the 10:00 start: the no-show is written once", async () => {
    const w = setup(START);
    await w.settle(START + 21 * MIN);
    expect(w.noshows()).toHaveLength(1);
    expect(w.room(w.id).settled_mark).toBe("noshow");
  });
});

// ---------------------------------------------------------------------------
// settle-open-sibling-read-as-lead-joined (fix round 1): room A for the 10:00
// intro went out at 10:01 and closed at 10:15 with nobody in it; the setter
// tried again and room B went out at 10:16. When A comes due at 10:21, B is
// merely open (no join). A waits for B, never "the lead joined another room
// for this call"; once B closes with nobody in it, the intro is marked a
// no-show once, and every room's "mark this intro" alert is answered.
// ---------------------------------------------------------------------------

describe("a second try's room is still open when the first room's settle comes due", () => {
  function withSibling(w: ReturnType<typeof setup>, state: string, joined = false) {
    const b = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      {
        ...(w.room(w.id) as Row),
        id: b,
        request_id: fakeUuid(),
        code: "B2TRYX",
        state,
        result: state === "expired" ? "no_join" : null,
        end_reason: state === "expired" ? "lead_no_show" : null,
        requested_at: new Date(START + 16 * MIN).toISOString(),
        opened_at: new Date(START + 16 * MIN).toISOString(),
        link_sent_at: new Date(START + 16 * MIN + 5 * S).toISOString(),
        lead_in_at: joined ? new Date(START + 18 * MIN).toISOString() : null,
        ended_at: state === "expired" ? new Date(START + 31 * MIN).toISOString() : null,
        version: 3,
      },
    ]);
    // An alert a person was asked about room B earlier (any reason): answered once the intro is marked.
    w.db.t("cockpit_sales_alerts").push({ id: fakeUuid(), dedupe_key: `room:${b}:mark_intro`, kind: "room_mark_intro", raised_at: new Date(START).toISOString() });
    return b;
  }
  const alertsOn = (w: ReturnType<typeof setup>) =>
    w.db.t("cockpit_sales_alerts").filter(a => String(a.dedupe_key).endsWith(":mark_intro") && !a.resolved_at);

  test("B open with no join: A's settle waits (no mark, no 'joined another room', no alert); after B closes empty, one no-show", async () => {
    const w = setup(START);
    const b = withSibling(w, "open");
    await w.settle(START + 21 * MIN);
    expect(w.noshows()).toHaveLength(0);
    expect(w.room(w.id).settled_mark ?? null).toBeNull();
    expect(alertsOn(w).map(a => a.dedupe_key)).toEqual([`room:${b}:mark_intro`]);
    // B closes with nobody in it; A's settle is asked again.
    Object.assign(w.room(b), { state: "expired", result: "no_join", end_reason: "lead_no_show", ended_at: new Date(START + 31 * MIN).toISOString() });
    await w.settle(START + 32 * MIN);
    expect(w.noshows()).toHaveLength(1);
    expect(w.room(w.id).settled_mark).toBe("noshow");
    expect(alertsOn(w)).toHaveLength(0);
  });

  test("control: B's lead joined and the join stands: A marks nothing (the lead came)", async () => {
    const w = setup(START);
    withSibling(w, "lead_in", true);
    await w.settle(START + 21 * MIN);
    expect(w.noshows()).toHaveLength(0);
    expect(w.room(w.id).settled_mark).toBe("none");
  });
});
