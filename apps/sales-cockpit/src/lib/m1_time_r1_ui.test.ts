// Milestone 1, video-link round 1, the TIME angle, through the panel's own
// words (lib/rooms.ts) over sales-api's real room actions (testfakes.ts).
//
// bun test src/lib/m1_time_r1_ui.test.ts   (from apps/sales-cockpit)
//
// A Meet room sends no join signal: the setter lets the lead in from Meet's
// "Ask to join" and presses The lead is in. One press a few seconds after the
// lead's 10 minutes, after the minute's sweep closed the room (R4), is kept as
// the join (roomlogic.ts lateLeadIn: result joined, lead_in_at). A failing
// expectation is a finding; its comment says what the setter sees instead.
// Pilot settings (m1-scope.md section 3); every lead is invented.

import { describe, expect, mock, test } from "bun:test";

mock.module("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));

type Row = Record<string, unknown>;

const SA = "../../../../supabase/functions/sales-api";
const { makeRooms } = await import(`${SA}/rooms.ts`);
const { fakeWorld, fakeUuid } = await import(`${SA}/testfakes.ts`);
const { DEFAULT_ROOMS_JSON } = await import(`${SA}/roomlogic.ts`);
const R = await import("./rooms");

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter-m1t-ui@stress.invalid";
const LEAD = "stress-m1t-ui-lead";
const APPT = "stress-m1t-ui-appt";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter = {
  signed_in: true,
  seat: true,
  manager: false,
  email: SETTER,
  name: "Tara Setter",
  role: "setter",
  ghl_user_id: "G-setter",
};
const desk = {
  signed_in: true,
  seat: true,
  manager: false,
  email: "sales-desk",
};
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();

function setup(now: number, intro: number) {
  const w = fakeWorld(now);
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: true,
        test_contacts: [LEAD],
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        short_link: false,
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro" },
      },
    },
    { key: "live", value: { enabled: false, slack: false } },
    {
      key: "whatsapp_guard",
      value: { connector_off: false, single_copy_ok_at: null },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    {
      email: SETTER,
      name: "Tara Setter",
      role: "setter",
      ghl_user_id: "G-setter",
      active: true,
    },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    {
      email: SETTER,
      zoom_user_id: null,
      zoom_status: "pending",
      google_ok: true,
    },
  ]);
  w.db.seed("cockpit_sales_worker_status", [
    {
      worker: "sales-desk",
      job: "rooms",
      ok: true,
      detail: "Working.",
      at: iso(now - 5 * S),
    },
  ]);
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: APPT,
      contact_id: LEAD,
      call_type: "intro",
      status: "confirmed",
      start_at: iso(intro),
      end_at: iso(intro + 30 * MIN),
      booked_at: iso(intro - 86_400_000),
      assigned_user_id: "G-setter",
      calendar_id: "stress-cal",
    },
  ]);
  w.db.seed("cockpit_sales_leads", [
    { contact_id: LEAD, country: "KW", assigned_to: "G-setter" },
  ]);
  w.routes.push(async (m: string, p: string) =>
    m === "GET" && p === `/contacts/${LEAD}`
      ? {
          contact: {
            id: LEAD,
            firstName: "Huda",
            name: "Huda Ali",
            phone: "+96550000000",
            email: "huda@example.invalid",
            tags: ["roas-qualified"],
            country: "KW",
          },
        }
      : (null as unknown as Row),
  );
  const rooms = makeRooms({
    io: w.io,
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: async (_who: unknown, b: Row) => {
      const row: Row = {
        id: fakeUuid(),
        request_id: b.request_id,
        contact_id: b.contact_id,
        channel: b.channel,
        body: b.body,
        source: "room",
        state: "sent",
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
    },
    sendTemplate: async () => {
      throw new Error("no template in this test");
    },
    upcoming: async () => null,
    sentSince: async () => false,
  });
  const room = (id: string) =>
    w.db.t("cockpit_sales_rooms").find((r: Row) => r.id === id) as Row;
  return { ...w, rooms, room };
}

describe("Thursday 8 October, the 13:00 intro: the Meet link goes at 13:01:20; the setter lets the lead in from Meet's lobby at 13:11:25 and presses The lead is in at 13:11:40", () => {
  test("the panel says the lead joined, never 'Nobody joined in 10 minutes ... Mark the intro:' with a No-show button", async () => {
    const intro = kw("2026-10-08T13:00:00");
    const w = setup(kw("2026-10-08T13:01:00"), intro);
    const made = (await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      purpose: "fallback",
      provider: "meet",
      call_kind: "intro",
      trigger: "no_answer",
      appointment_id: APPT,
      item_kind: "intro",
    })) as Row;
    const id = String((made.room as Row).id);
    // The worker (contract v2 section 7).
    w.clock.now = kw("2026-10-08T13:01:20");
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: {
        state: "creating",
        worker_run: "run-1",
        version: Number(w.room(id).version) + 1,
      },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: {
        room_id: id,
        kind: "worker.ready",
        source: "worker",
        dedupe_key: `worker.ready:${id}`,
        detail: { worker_run: "run-1" },
        text: "Room made on Meet in 3.0 s.",
      },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(
      `cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`,
      {
        method: "PATCH",
        body: {
          state: "open",
          join_url: MEET_URL,
          provider_meeting_id: "abc-defg-hij",
          opened_at: w.db.iso(),
          version: Number(w.room(id).version) + 1,
        },
      },
    );
    await w.rooms.desk["room.event"]!(desk, {
      kind: "worker.ready",
      room_id: id,
      payload: { provider: "meet" },
    });
    await w.flush();
    expect(w.room(id).link_sent_at).toBeTruthy();
    // I'm in the room at 13:01:40.
    w.clock.now = kw("2026-10-08T13:01:40");
    await w.rooms.actions["room.mark"]!(setter, {
      room_id: id,
      version: Number(w.room(id).version),
      what: "host_in",
    });
    const seen = Number(w.room(id).version);
    const leadBy = Date.parse(String(w.room(id).lead_by));
    // The SQL sweep's R4 at 13:11:22 (lead_by passed): expired, no_join, lead_no_show.
    w.clock.now = leadBy + 2 * S;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.host_in`, {
      method: "PATCH",
      body: {
        state: "expired",
        result: "no_join",
        end_reason: "lead_no_show",
        ended_at: w.db.iso(),
        error: "Closed: the lead did not join in 10 minutes.",
      },
    });
    // The setter, still on the tab that saw host_in, presses The lead is in 18 s later.
    w.clock.now = leadBy + 20 * S;
    await w.rooms.actions["room.mark"]!(setter, {
      room_id: id,
      version: seen,
      what: "lead_in",
    });
    await w.flush();
    const r = w.room(id);
    expect({
      state: r.state,
      result: r.result,
      joined: Boolean(r.lead_in_at),
    }).toEqual({ state: "expired", result: "joined", joined: true });
    const st = (await w.rooms.actions["room.status"]!(setter, {
      room_id: id,
    })) as Row;
    const view = R.normalizeRoom(st.room);
    expect(view).not.toBeNull();
    const now = w.clock.now + 2 * S;
    const said = R.sentenceText(
      R.roomSentence(view!, { now, canMarkIntro: true, talkBelow: true }),
    );
    // Found when it fails: roomMoment reads an expired room as "expired"
    // without looking at its result, and meetUnseen is false once lead_in_at
    // is set, so the setter who is talking to the lead reads "Nobody joined
    // in 10 minutes. The room is closed. Mark the intro:" with the intro's
    // No-show press under it.
    expect({ moment: R.roomMoment(view!, now), said }).toEqual({
      moment: expect.not.stringMatching(/^expired$/),
      said: expect.not.stringMatching(/Nobody joined|did not join/),
    });
  });
});
