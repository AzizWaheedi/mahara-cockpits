// Milestone 1, video-link round 5, the TIME angle, through the room panel
// (lib/rooms.ts roomMoment, roomLeft, roomSentence, roomActions) and the
// dialer's step under it (lib/dialerUi.ts afterMiss), over sales-api's real
// room actions (testfakes.ts) with a clock only the test moves.
//
// bun test src/lib/m1_time_r5_ui.test.ts   (from apps/sales-cockpit)
//
// The deadline one second either side: a later send of the link (Also send
// by email) promises the lead its own ten minutes ("I'll be there for the
// next 10 minutes"), and sales-api moves lead_by to it; the sweep's R3 then
// keeps the host's wait open until lead_by + open_grace (20261004a R3, m1
// round 3, later-link-promise-cut-by-host-wait) and R4 closes the room at
// lead_by. What does the panel count down to, and what does it tell the rep
// to do between host_by and lead_by?
//
// Pilot settings (m1-scope.md section 3): rooms on, both providers, every
// send lane on, short_link off, test_only with the lead as the test
// contact, count_on_join / settle / wrap / auto_on_miss off, live off,
// followups.agent off. The WhatsApp gate is open here (the link goes on
// WhatsApp first, as it will once the CEO confirms the WA Connector is off);
// fallback.scope "any" where a manager set it (m1-scope section 3) for the
// dialer's own room. A failing expectation is a finding. Every lead is
// invented (stress-m1t5-ui-...), every seat @stress.invalid.

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
const { DEFAULT_ROOMS_JSON, LANE_COPY, timers, roomCtx, roomsSetting } =
  await import(`${SA}/roomlogic.ts`);
const R = await import("./rooms");
const D = await import("./dialerUi");
const V = await import("./videoLink");

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-m1t5-ui@stress.invalid";
const setter = {
  signed_in: true,
  seat: true,
  manager: false,
  email: SETTER,
  name: "Tara Setter",
  role: "setter",
  ghl_user_id: "G-setter",
};
const CLOSER = "closer-m1t5-ui@stress.invalid";
const closer = {
  signed_in: true,
  seat: true,
  manager: false,
  email: CLOSER,
  name: "Cora Closer",
  role: "closer",
  ghl_user_id: "G-closer",
};
const desk = {
  signed_in: true,
  seat: true,
  manager: false,
  email: "sales-desk",
};
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function setup(now: number) {
  const w = fakeWorld(now);
  const LEAD = `stress-m1t5-ui-${fakeUuid().slice(-8)}`;
  const phone = "+96550123456";
  const roomsValue = {
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
    fallback: {
      ...DEFAULT_ROOMS_JSON.fallback,
      scope: "any",
      auto_on_miss: false,
    },
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: roomsValue },
    { key: "live", value: { enabled: false, slack: false } },
    { key: "followups", value: { enabled: true, agent: false } },
    {
      key: "whatsapp_guard",
      value: {
        connector_off: true,
        single_copy_ok_at: "2026-10-01T00:00:00Z",
        templates_per_day: 250,
      },
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
    {
      email: CLOSER,
      name: "Cora Closer",
      role: "closer",
      ghl_user_id: "G-closer",
      active: true,
    },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    {
      email: SETTER,
      zoom_user_id: "Z-setter",
      zoom_status: "licensed",
      google_ok: true,
    },
    {
      email: CLOSER,
      zoom_user_id: "Z-closer",
      zoom_status: "licensed",
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
  w.db.seed("cockpit_sales_leads", [
    { contact_id: LEAD, country: "KW", phone, assigned_to: "G-setter" },
  ]);
  w.db.seed("cockpit_sales_inbox", [
    {
      conversation_id: `c-${LEAD}`,
      contact_id: LEAD,
      inbound_whatsapp_at: iso(now - 2 * HOUR),
    },
  ]);
  w.routes.push(async (m: string, p: string) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return {
        contact: {
          id: LEAD,
          firstName: "Sam",
          name: "Sam Lee",
          phone,
          email: `${LEAD}@example.invalid`,
          tags: ["roas-qualified"],
          country: "KW",
        },
      };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p))
      return { events: [] };
    if (m === "GET" && /^\/conversations\/messages\//.test(p)) {
      const id = decodeURIComponent(p.split("/").pop() ?? "");
      return { message: { id, status: "delivered" } };
    }
    return null as unknown as Row;
  });
  const jobs: Promise<unknown>[] = [];
  const sent: { channel: string; at: number; body: string }[] = [];
  const rooms = makeRooms({
    io: {
      ...w.io,
      background: (p: Promise<unknown>) => {
        jobs.push(p.catch(() => null));
      },
    },
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: async (_who: unknown, b: Row) => {
      const row: Row = {
        id: fakeUuid(),
        request_id: b.request_id,
        contact_id: b.contact_id,
        channel: b.channel,
        via: "conversation",
        body: b.body,
        source: "room",
        state: "sent",
        provider_status: "sent",
        ghl_message_id: `m-${fakeUuid().slice(-8)}`,
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      sent.push({
        channel: String(b.channel),
        at: w.clock.now,
        body: String(b.body ?? ""),
      });
      return { message: { ...row } };
    },
    sendTemplate: async () => {
      throw new Error("no template in this test");
    },
    upcoming: async () => null,
    sentSince: async () => null,
  });
  const room = (id: string) =>
    w.db.t("cockpit_sales_rooms").find((r: Row) => r.id === id) as Row;
  async function drain() {
    for (let i = 0; i < 10; i++) {
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }
  function heartbeat(at: number) {
    for (const r of w.db.t("cockpit_sales_worker_status"))
      if (r.job === "rooms") r.at = iso(at - 5 * S);
  }
  async function create(
    at: number,
    purpose: "manual" | "fallback",
    provider: "meet" | "zoom" = "meet",
  ): Promise<string> {
    w.clock.now = at;
    heartbeat(at);
    let attempt: string | null = null;
    if (purpose === "fallback") {
      attempt = fakeUuid();
      w.db.seed("cockpit_sales_attempts", [
        {
          id: attempt,
          contact_id: LEAD,
          rep_email: SETTER,
          appointment_id: null,
          item_kind: "lead",
          state: "saved",
          outcome: "no_answer",
          call_state: "no_answer",
          call_duration_s: 0,
          started_at: iso(at - 40 * S),
          saved_at: iso(at - 5 * S),
        },
      ]);
    }
    const out = (await rooms.actions["room.create"](setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      purpose,
      provider,
      call_kind: "intro",
      trigger: purpose === "manual" ? "manual" : "no_answer",
      ...(attempt ? { attempt_id: attempt, item_kind: "lead" } : {}),
    })) as Row;
    return String((out.room as Row).id);
  }
  async function workerOpens(
    id: string,
    at: number,
    provider: "meet" | "zoom" = "meet",
  ) {
    w.clock.now = at;
    heartbeat(at);
    const mid =
      provider === "meet"
        ? `abc-defg-h${fakeUuid().slice(-3)}`
        : `8${String(Date.now()).slice(-10)}`;
    const url =
      provider === "meet"
        ? `https://meet.google.com/${mid}`
        : `https://us06web.zoom.us/j/${mid}?pwd=StressM1t5`;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: {
        state: "creating",
        claimed_at: w.db.iso(),
        worker_run: "run-1",
        version: Number(room(id).version) + 1,
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
        text: "Room made in 4.0 s.",
      },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(
      `cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`,
      {
        method: "PATCH",
        body: {
          state: "open",
          join_url: url,
          provider_meeting_id: mid,
          opened_at: w.db.iso(),
          host_by: iso(w.clock.now + 15 * MIN),
          ends_at: iso(w.clock.now + 30 * MIN),
          version: Number(room(id).version) + 1,
        },
      },
    );
    await rooms.desk["room.event"](desk, {
      kind: "worker.ready",
      room_id: id,
      payload: { provider, provider_meeting_id: mid, worker_run: "run-1" },
    });
    await drain();
  }
  async function press(
    action: string,
    body: Row,
    at: number,
  ): Promise<{ ok: boolean; said: string | null }> {
    w.clock.now = at;
    heartbeat(at);
    try {
      await rooms.actions[action](setter, body);
      await drain();
      return { ok: true, said: null };
    } catch (e) {
      return { ok: false, said: String((e as Error).message) };
    }
  }
  /** What the room panel says and offers for the room as room.status serves it, at `at`. */
  async function panel(id: string, at: number) {
    w.clock.now = at;
    heartbeat(at);
    const feed = (await rooms.actions["room.status"](setter, {
      room_id: id,
    })) as Row;
    const view = feed.room as Parameters<typeof R.roomActions>[0];
    const ctx = {
      now: at,
      lineShown: false,
      otherOk: (feed.other_ok as boolean | null) ?? null,
      workerDown: (feed.health as Row | undefined)?.worker_ok === false,
    };
    const acts = R.roomActions(view, ctx);
    const step = D.afterMiss({
      moment: "missed_call",
      whatsapp: {
        on: true,
        dnd: false,
        reachable: true,
        window: { open: true },
      },
      email: { on: true, dnd: false, reachable: true },
      templatesLive: true,
      messageReady: true,
      video: view as never,
      now: at,
      workerDown: ctx.workerDown,
    } as never) as Row;
    return {
      view,
      moment: R.momentFor(view, ctx),
      left: R.roomLeft(view, at),
      words: R.sentenceText(R.roomSentence(view, ctx)),
      primary: acts.primary?.label ?? null,
      step: String(step?.title ?? ""),
    };
  }
  /**
   * When the server closes the room if nothing more happens: the earliest of
   * sales-api's own timers (roomlogic.ts timers(), the mirror of the
   * sweep's R3 and R4 in 20261004a), and the minute the pg_cron sweep
   * then runs.
   */
  function serverClose(id: string): { due: number; sweep: number } {
    const r = room(id);
    const setting = roomsSetting(
      (
        w.db
          .t("cockpit_sales_settings")
          .find((s: Row) => s.key === "rooms") as Row
      ).value,
    );
    const due = Math.min(
      ...timers(r as never, roomCtx(setting)).map((x: { at: number }) => x.at),
    );
    return { due, sweep: Math.floor(due / MIN) * MIN + MIN };
  }
  /** The closer's own Send a video link for the same lead (the lead page), at `at`: the refusal's words, or null. */
  async function closerPress(at: number): Promise<string | null> {
    w.clock.now = at;
    heartbeat(at);
    try {
      await rooms.actions["room.create"](closer, {
        request_id: crypto.randomUUID(),
        contact_id: LEAD,
        purpose: "manual",
        provider: "zoom",
        call_kind: "intro",
        trigger: "manual",
      });
      return null;
    } catch (e) {
      return String((e as Error).message);
    }
  }
  return {
    ...w,
    rooms,
    room,
    sent,
    create,
    workerOpens,
    press,
    panel,
    serverClose,
    closerPress,
    LEAD,
  };
}

// ---------------------------------------------------------------------------
// The lead page's Meet room: its link on WhatsApp at 14:00:06, Also send by
// email at 14:09:06 ("I'll be there for the next 10 minutes" until 14:19:06),
// the setter in the Meet without having pressed I'm in (Meet sends no join
// signal, so the room stays `open`; host_by 14:15:06).
// ---------------------------------------------------------------------------

describe("Tuesday 6 October, by day, WhatsApp gate open: the lead page's Meet link goes on WhatsApp at 14:00:06; the lead asks for it by email and the setter presses Also send by email at 14:09:06", () => {
  async function scene(purpose: "manual" | "fallback") {
    const w = setup(kw("2026-10-06T14:00:00"));
    const id = await w.create(kw("2026-10-06T14:00:00"), purpose);
    await w.workerOpens(id, kw("2026-10-06T14:00:06"));
    const mail = await w.press(
      "room.send",
      { room_id: id, request_id: crypto.randomUUID(), channel: "email" },
      kw("2026-10-06T14:09:06"),
    );
    return { w, id, mail };
  }

  test("setup (control): the email went, sales-api moved lead_by to 14:19:06 and host_by to 14:22:06 (keepHostWait), and the server keeps the room open until 14:19:06 (the sweep's 14:20:00 run closes it)", async () => {
    const { w, id, mail } = await scene("manual");
    expect(mail).toEqual({ ok: true, said: null });
    expect(w.sent.map(s => s.channel)).toEqual(["whatsapp", "email"]);
    expect(w.sent[1]?.body).toContain("ready now");
    const r = w.room(id);
    expect({
      state: r.state,
      lead_by: r.lead_by,
      host_by: r.host_by,
    }).toEqual({
      state: "open",
      lead_by: iso(kw("2026-10-06T14:19:06")),
      host_by: iso(kw("2026-10-06T14:22:06")),
    });
    const close = w.serverClose(id);
    expect(iso(close.due)).toBe(iso(kw("2026-10-06T14:19:06")));
    expect(iso(close.sweep)).toBe(iso(kw("2026-10-06T14:20:00")));
  });

  test("control (14:12:00, before host_by): the panel counts down to the server's close", async () => {
    const { w, id } = await scene("manual");
    const p = await w.panel(id, kw("2026-10-06T14:12:00"));
    expect(p.moment).toBe("sent");
    expect(p.left).toBe(7 * MIN + 6 * S);
  });

  test("control: 14:15:07, one second past the first host_by: the panel's countdown still runs to the email's ten minutes", async () => {
    const { w, id } = await scene("manual");
    const p = await w.panel(id, kw("2026-10-06T14:15:07"));
    expect(p.left).toBe(3 * MIN + 59 * S);
  });

  test("control: 14:17:10 (the room open, the email's ten minutes running until 14:19:06): the panel never says the room should have closed nor makes End room its one button", async () => {
    const { w, id } = await scene("manual");
    const at = kw("2026-10-06T14:17:10");
    expect(at).toBeLessThan(w.serverClose(id).due);
    const p = await w.panel(id, at);
    expect({
      moment: p.moment,
      words: p.words,
      primary: p.primary,
    }).toEqual({
      moment: "sent",
      words: expect.not.stringContaining("should have closed"),
      primary: expect.not.stringMatching(/^End room$/),
    });
  });

  test("control: the dialer's own room (a missed call, scope any): at 14:17:10 the step under it says the link went and to wait, never 'This room should have closed'", async () => {
    const { w, id } = await scene("fallback");
    const r = w.room(id);
    expect(r.lead_by).toBe(iso(kw("2026-10-06T14:19:06")));
    const p = await w.panel(id, kw("2026-10-06T14:17:10"));
    expect(p.step).toBe("The video link went");
  });
});

// ---------------------------------------------------------------------------
// Night on the lead's clock: the setter, on the phone with a Kuwait lead,
// makes a Meet room from the lead page at 21:30:00 (open 21:30:06). No
// message goes (sales-api's nightHolds): "Read the link out if you are
// speaking with them." The lead's ten minutes never start (no lead_by), and
// the sweep's R4 closes the room as link_not_sent at the open + 10 minutes
// (20261004a R4, the "unstarted" rule; roomlogic.ts timers() the same),
// while the setter has not pressed I'm in yet (state open).
// ---------------------------------------------------------------------------

describe("Wednesday 7 October, 21:30 Kuwait (night on the lead's clock): the lead page's Meet room read out to a Kuwait lead; the setter has not pressed I'm in", () => {
  async function scene() {
    const w = setup(kw("2026-10-07T21:30:00"));
    const id = await w.create(kw("2026-10-07T21:30:00"), "manual");
    await w.workerOpens(id, kw("2026-10-07T21:30:06"));
    return { w, id };
  }

  test("setup: no message went, no lead_by, host_by 21:45:06, and the server closes the room at 21:40:06 (the sweep's 21:41:00 run)", async () => {
    const { w, id } = await scene();
    const r = w.room(id);
    expect(w.sent).toEqual([]);
    expect({ lead_by: r.lead_by ?? null, host_by: r.host_by }).toEqual({
      lead_by: null,
      host_by: iso(kw("2026-10-07T21:45:06")),
    });
    expect(iso(w.serverClose(id).due)).toBe(iso(kw("2026-10-07T21:40:06")));
  });

  test("21:31:00: the room line's countdown runs to the server's close (9:06), never to host_by (14:06)", async () => {
    const { w, id } = await scene();
    const p = await w.panel(id, kw("2026-10-07T21:31:00"));
    // Found when it fails: roomClock.ts roomDeadline reads an open room
    // with no lead_by as host_by, so the line says 14:06 left while the
    // sweep closes the room at 21:41:00 as link_not_sent; the setter reading
    // the link out tells the lead they have a quarter of an hour.
    expect(p.left).toBe(9 * MIN + 6 * S);
  });

  test("21:31:00: the closer pressing Send a video link for the same lead is told when the setter's room closes (21:40 or 21:41), never 21:45", async () => {
    const { w } = await scene();
    const said = await w.closerPress(kw("2026-10-07T21:31:00"));
    // Found when it fails: leadRoomRefusal (rooms.ts) names holdUntil, which
    // reads lead_by ?? host_by, so it says "open until 21:45" for a room
    // the sweep closes at 21:41.
    expect(String(said)).toMatch(/open until 21:4[01]\b/);
  });
});

// ---------------------------------------------------------------------------
// The dialer's intro item, called outside the intro's own window, at night
// on the lead's clock. sales-api's night exception holds only for a call
// inside the intro's window (start - 5 min to start + settle, 20 min:
// roomlogic.ts inIntroWindow); DialerPage.tsx asks videoLinkGate with
// introNow = "the item is the intro itself", at any time. Scope "intro" as
// shipped (the dialer names the intro: bookedIntro).
// ---------------------------------------------------------------------------

describe("Wednesday 7 October: a Kuwait lead's own intro booked at 20:30; the setter runs late and the intro item's call at 21:00:30 rings out; Send a video link from the after-miss step at 21:01:10", () => {
  async function press(o: { start: string; rang: string; at: string }) {
    const at = kw(o.at);
    const w = setup(kw(o.rang));
    // Shipped scope: a missed call's link needs the booked intro.
    const roomsRow = w.db
      .t("cockpit_sales_settings")
      .find((r: Row) => r.key === "rooms") as Row;
    roomsRow.value = {
      ...(roomsRow.value as Row),
      fallback: {
        ...((roomsRow.value as Row).fallback as Row),
        scope: "intro",
      },
    };
    const apptId = `stress-m1t5-ui-intro-${fakeUuid().slice(-6)}`;
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: apptId,
        contact_id: w.LEAD,
        call_type: "intro",
        status: "confirmed",
        start_at: iso(kw(o.start)),
        booked_at: iso(kw("2026-10-06T12:00:00")),
        assigned_user_id: "G-setter",
        calendar_id: "stress-intro-cal",
      },
    ]);
    const attempt = fakeUuid();
    w.db.seed("cockpit_sales_attempts", [
      {
        id: attempt,
        contact_id: w.LEAD,
        rep_email: SETTER,
        appointment_id: apptId,
        item_kind: "intro",
        state: "saved",
        outcome: "no_answer",
        call_state: "no_answer",
        call_duration_s: 0,
        started_at: iso(kw(o.rang)),
        saved_at: iso(kw(o.rang) + 35 * S),
      },
    ]);
    // The dialer's gate as DialerPage.tsx asks it for the intro item, at
    // the press. Since m1 round 5 the intro's own hour counts only for a
    // call inside its window (introCallInWindow, by the missed call's start,
    // as room.create reads it), never for any intro item.
    const introNow = V.introCallInWindow(
      kw(o.rang),
      iso(kw(o.start)),
      V.readRoomsSetting(roomsRow.value)!.settle_s,
    );
    const gate = V.videoLinkGate({
      setting: roomsRow.value as never,
      contactId: w.LEAD,
      seatEmail: SETTER,
      purpose: "fallback",
      bookedIntro: true,
      bookedDemo: false,
      client: false,
      dnd: false,
      country: "KW",
      phone: "+96550123456",
      now: at,
      introNow,
    });
    w.clock.now = at;
    for (const r of w.db.t("cockpit_sales_worker_status"))
      if (r.job === "rooms") r.at = iso(at - 5 * S);
    let refused: string | null = null;
    try {
      await w.rooms.actions["room.create"](setter, {
        request_id: crypto.randomUUID(),
        contact_id: w.LEAD,
        purpose: "fallback",
        provider: "meet",
        call_kind: "intro",
        trigger: "no_answer",
        attempt_id: attempt,
        appointment_id: apptId,
        item_kind: "intro",
      });
    } catch (e) {
      refused = String((e as Error).message);
    }
    return { shown: gate.show, refused };
  }

  test("control: the intro at 20:45, its call at 21:00:30 (inside the window), pressed at 21:01:10: shown and made", async () => {
    expect(
      await press({
        start: "2026-10-07T20:45:00",
        rang: "2026-10-07T21:00:30",
        at: "2026-10-07T21:01:10",
      }),
    ).toEqual({ shown: true, refused: null });
  });

  test("the intro at 20:30, its call at 21:00:30 (ten minutes past the window): the step that shows Send a video link gets the room, or the button is not shown", async () => {
    const got = await press({
      start: "2026-10-07T20:30:00",
      rang: "2026-10-07T21:00:30",
      at: "2026-10-07T21:01:10",
    });
    // Found when it fails: videoLinkGate skips the night rule for any intro
    // item (DialerPage introNow = kind "intro"), while room.create clears
    // the night only for a call inside the intro's window (inIntroWindow:
    // start + 20 minutes = 20:50), so the step shows the button and the
    // press is refused "It is night where the lead is, so no video link
    // goes now. Call them after 9 in the morning, their time."
    expect(got).not.toEqual({ shown: true, refused: LANE_COPY.lead_night });
  });

  test("the intro at 21:10, its call at 21:04:30 (the setter rings early, before the window's five minutes): the same", async () => {
    const got = await press({
      start: "2026-10-07T21:10:00",
      rang: "2026-10-07T21:04:30",
      at: "2026-10-07T21:05:10",
    });
    expect(got).not.toEqual({ shown: true, refused: LANE_COPY.lead_night });
  });
});
