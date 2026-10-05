// bun test supabase/functions/sales-api/stress2_providers_r4_count.test.ts
//
// Second series, round 4, provider quirks: HighLevel's rate limit (429, with
// or without Retry-After; its burst limit is shared with the dialer and the
// mirror) on the live count's own HighLevel writes, behind rooms.count_on_join.
// The real rooms.ts and roomlogic.ts on testfakes.ts; HighLevel answers as
// liveio.ts ghl() reads it (GhlError, "HighLevel said 429: ..."). A failing
// test is a finding. Nothing leaves this process; every lead is invented.
import { describe, expect, test } from "bun:test";
import { BOOKING_CALENDARS } from "./dialer.ts";
import type { Who } from "./lib.ts";
import { GhlError } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-p4c@stress.invalid";
const LEAD = "stress-p2r4-count-000001";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

function setup() {
  const w = fakeWorld();
  const knobs = {
    /** HighLevel's answer to the count's booking (POST) or move (PUT): ok, or its burst limit. */
    write: "ok" as "ok" | "429",
    calls: [] as { id: string; start: number; booked_at: number; assigned_user_id: string }[],
  };
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        count_on_join: true,
        test_calendar_id: "TESTCAL",
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
  const hlStart = new Map<string, string>();
  w.routes.push(async (m, p, body) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [] };
    const one = /^\/calendars\/events\/appointments\/([^/?]+)$/.exec(p);
    if (one) {
      const id = decodeURIComponent(one[1] as string);
      const call = knobs.calls.find(c => c.id === id);
      if (m === "GET" && call)
        return {
          appointment: {
            id,
            appointmentStatus: "confirmed",
            startTime: hlStart.get(id) ?? new Date(call.start).toISOString(),
            endTime: new Date(call.start + 30 * MIN).toISOString(),
            assignedUserId: call.assigned_user_id,
          },
        };
      if (m === "PUT") {
        // HighLevel's burst limit: the move is refused, nothing changed.
        if (knobs.write === "429") throw new GhlError("HighLevel said 429: Too Many Requests", 429);
        const st = (body as Row | undefined)?.startTime;
        if (typeof st === "string") hlStart.set(id, st);
        return { ok: true };
      }
    }
    if (m === "POST" && p === "/calendars/events/appointments") {
      if (knobs.write === "429") throw new GhlError("HighLevel said 429: Too Many Requests", 429);
      return { id: `live-${fakeUuid()}` };
    }
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => {},
    markAppointment: async (who, id, status) => {
      w.db.t("cockpit_sales_dispositions").push({ id: fakeUuid(), appointment_id: id, status, marked_by: who.email, superseded_at: null, crm: "quiet", note: null });
      return { crm: "quiet" };
    },
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async (_c, _kind, opts) => {
      const bound = opts?.booked_before ?? null;
      const after = opts?.after ?? w.clock.now;
      const ahead = knobs.calls.filter(c => c.start > after && (bound === null || c.booked_at < bound)).sort((a, b) => a.start - b.start)[0];
      return ahead
        ? { id: ahead.id, start: ahead.start, end: ahead.start + 30 * MIN, assigned_user_id: ahead.assigned_user_id, status: "confirmed", booked_at: ahead.booked_at }
        : null;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  /** The lead page's Video call (purpose manual), opened by the worker, the link opened, Zoom seeing the lead. */
  async function leadPageRoom(): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const id = String((out.room as Row).id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(room(id).version) + 1 },
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: MEET_URL,
        provider_meeting_id: `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(room(id).version) + 1,
      },
    });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), first_open_at: w.db.iso(), last_open_at: w.db.iso() } });
    seedLeadZoomJoin(w.db, id);
    return id;
  }
  async function leadIn(id: string) {
    await rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(room(id).version), what: "lead_in" });
    await w.flush();
  }
  async function tick(id: string) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
  }
  const roomAlerts = (id: string) => w.db.t("cockpit_sales_alerts").filter(a => String(a.dedupe_key ?? "").startsWith(`room:${id}:`) && !a.resolved_at);
  const writes = () => w.ghlCalls.filter(c => (c.method === "POST" && c.path === "/calendars/events/appointments") || c.method === "PUT");
  return { ...w, rooms, room, knobs, leadPageRoom, leadIn, tick, roomAlerts, writes, hlStart };
}

describe("providers2 r4: HighLevel's 429 on the live count's booking", () => {
  test("HELD (control): HighLevel answering, the join is booked as a live call", async () => {
    const w = setup();
    const id = await w.leadPageRoom();
    await w.leadIn(id);
    await w.tick(id);
    expect([w.room(id).count_result, Boolean(w.room(id).count_appointment_id)]).toEqual(["booked", true]);
  });

  test("count-429-failed-for-good-silent (create): a 429 on the live booking is tried again, or a person is told", async () => {
    const w = setup();
    const id = await w.leadPageRoom();
    w.knobs.write = "429";
    await w.leadIn(id);
    await w.tick(id);
    const first = { result: w.room(id).count_result, alerts: w.roomAlerts(id).length };
    // HighLevel answers again a minute later; the sweep ticks the room for an hour after the join.
    w.knobs.write = "ok";
    for (let i = 0; i < 5; i++) {
      w.clock.now += 70 * S;
      await w.tick(id);
    }
    const lines = w.db
      .t("cockpit_sales_room_events")
      .filter(e => e.room_id === id && String(e.kind ?? "").startsWith("count"))
      .map(e => String(e.text ?? ""));
    expect(
      { bookedLater: w.room(id).count_result === "booked", told: w.roomAlerts(id).length > 0 },
      `HighLevel's burst limit refused the live booking once: the count wrote ${JSON.stringify(first)} and stopped for good ` +
        `(count_result ${String(w.room(id).count_result)}, writes asked ${w.writes().length}, alerts ${w.roomAlerts(id).length}, ` +
        `timeline ${JSON.stringify(lines)}); the lead's live call is in no number and nobody is told`,
    ).not.toEqual({ bookedLater: false, told: false });
  });

  test("count-429-failed-for-good-silent (move): a 429 on moving the lead's booked call to the join is tried again, or a person is told", async () => {
    const w = setup();
    // The lead's intro is tomorrow (booked two days ago, with this setter);
    // the lead joins the lead page's room now, so the count moves it to the join.
    const tomorrow = w.clock.now + 24 * HOUR;
    w.knobs.calls = [{ id: "intro-tomorrow", start: tomorrow, booked_at: w.clock.now - 48 * HOUR, assigned_user_id: "G-setter" }];
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "intro-tomorrow",
        contact_id: LEAD,
        call_type: "intro",
        calendar_id: BOOKING_CALENDARS.intro_qualified,
        status: "confirmed",
        start_at: new Date(tomorrow).toISOString(),
        end_at: new Date(tomorrow + 30 * MIN).toISOString(),
        assigned_user_id: "G-setter",
      },
    ]);
    const id = await w.leadPageRoom();
    w.knobs.write = "429";
    await w.leadIn(id);
    await w.tick(id);
    const first = { result: w.room(id).count_result, alerts: w.roomAlerts(id).length };
    w.knobs.write = "ok";
    for (let i = 0; i < 5; i++) {
      w.clock.now += 70 * S;
      await w.tick(id);
    }
    expect(
      { movedLater: w.room(id).count_result === "moved", told: w.roomAlerts(id).length > 0 },
      `HighLevel's burst limit refused the move once: the count wrote ${JSON.stringify(first)} and stopped for good; the intro stays ` +
        `booked for tomorrow (HighLevel start ${w.hlStart.get("intro-tomorrow") ?? "unchanged"}), so the conversation the lead just had ` +
        "is counted nowhere and tomorrow's intro reads as a no-show; nobody is told",
    ).not.toEqual({ movedLater: false, told: false });
  });
});
