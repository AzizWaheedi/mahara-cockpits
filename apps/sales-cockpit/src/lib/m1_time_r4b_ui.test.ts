// Milestone 1, video-link round 4 (second run), the TIME angle, through the
// room panel (lib/rooms.ts roomMoment, roomSentence, roomActions) over
// sales-api's real room actions (testfakes.ts): night on the lead's clock.
//
// bun test src/lib/m1_time_r4b_ui.test.ts   (from apps/sales-cockpit)
//
//  1. A lead-page room made at night (the setter is speaking with the lead):
//     sales-api holds every message (rooms.ts nightHolds) and the room says
//     to read the link out. What the panel offers next, and whether
//     sales-api takes it.
//  2. That room closed by the sweep's R4 at the lead's ten minutes (as
//     20261004a writes it: link_not_sent, no result), with the lead in the
//     Meet: what the panel then says.
//
// Pilot settings (m1-scope.md section 3): rooms on, both providers, every
// send lane on, short_link off, test_only with the lead as the test
// contact; the WhatsApp gate shut (today: the link goes by email). A failing
// expectation is a finding; its comment says what the rep sees instead.
// Every lead is invented (stress-m1t4b-ui-...), every seat @stress.invalid.

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
const { DEFAULT_ROOMS_JSON, LANE_COPY } = await import(`${SA}/roomlogic.ts`);
const R = await import("./rooms");
const V = await import("./videoLink");

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-m1t4b-ui@stress.invalid";
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
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function setup(now: number) {
  const w = fakeWorld(now);
  const LEAD = `stress-m1t4b-ui-${fakeUuid().slice(-8)}`;
  const phone = "+96550123456";
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
    { key: "followups", value: { enabled: true, agent: false } },
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
      zoom_user_id: "Z-setter",
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
    return null as unknown as Row;
  });
  const jobs: Promise<unknown>[] = [];
  const sent: { channel: string; at: number }[] = [];
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
      sent.push({ channel: String(b.channel), at: w.clock.now });
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
    provider: "meet" | "zoom" = "meet",
  ): Promise<string> {
    w.clock.now = at;
    heartbeat(at);
    const out = (await rooms.actions["room.create"](setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      purpose: "manual",
      provider,
      call_kind: "intro",
      trigger: "manual",
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
        : `https://us06web.zoom.us/j/${mid}?pwd=StressM1t4b`;
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
      payload: {
        provider,
        provider_meeting_id: mid,
        worker_run: "run-1",
      },
    });
    await drain();
  }
  /** What the room panel says and offers for the room as room.status serves it. */
  async function panel(id: string) {
    heartbeat(w.clock.now);
    const feed = (await rooms.actions["room.status"](setter, {
      room_id: id,
    })) as Row;
    const view = feed.room as Parameters<typeof R.roomActions>[0];
    const ctx = {
      now: w.clock.now,
      lineShown: true,
      otherOk: (feed.other_ok as boolean | null) ?? null,
      workerDown: (feed.health as Row | undefined)?.worker_ok === false,
    };
    const acts = R.roomActions(view, ctx);
    return {
      moment: R.momentFor(view, ctx),
      words: R.sentenceText(R.roomSentence(view, ctx)),
      keys: [acts.primary?.key, ...acts.quiet.map(a => a.key)].filter(
        Boolean,
      ) as string[],
      labels: [acts.primary?.label, ...acts.quiet.map(a => a.label)].filter(
        Boolean,
      ) as string[],
    };
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
  return { ...w, rooms, room, sent, create, workerOpens, panel, press, LEAD };
}

// ---------------------------------------------------------------------------
// 1. Night on the lead's clock: the panel's buttons and sales-api's answers.
// ---------------------------------------------------------------------------

describe("Wednesday 7 October, 21:30 Kuwait (night on the lead's clock): the setter, speaking with a Kuwait lead, makes a Meet room from the lead page", () => {
  const at = kw("2026-10-07T21:30:00");

  test("setup: no message goes, and the panel says to read the link out", async () => {
    const w = setup(at);
    const id = await w.create(at);
    await w.workerOpens(id, kw("2026-10-07T21:30:06"));
    expect(w.sent.length).toBe(0);
    expect(w.room(id).refusal).toBe(LANE_COPY.lead_night_read_out);
    w.clock.now = kw("2026-10-07T21:30:10");
    const p = await w.panel(id);
    expect(p.moment).toBe("not_sent");
    expect(p.words).toMatch(/^Not sent: it is night where the lead is/);
  });

  test("control: at 09:00:10 the next morning the same Send by email is taken (day on the lead's clock)", async () => {
    const morning = kw("2026-10-08T08:55:00");
    const w = setup(morning);
    const id = await w.create(morning);
    await w.workerOpens(id, kw("2026-10-08T08:55:06"));
    expect(w.room(id).refusal).toBe(LANE_COPY.lead_night_read_out);
    const sent = await w.press(
      "room.send",
      { room_id: id, request_id: crypto.randomUUID(), channel: "email" },
      kw("2026-10-08T09:00:10"),
    );
    expect(sent).toEqual({ ok: true, said: null });
    expect(w.sent.map(s => s.channel)).toEqual(["email"]);
  });

  test("the panel never offers a send sales-api refuses: no Send by email at night, or the press is taken", async () => {
    const w = setup(at);
    const id = await w.create(at);
    await w.workerOpens(id, kw("2026-10-07T21:30:06"));
    w.clock.now = kw("2026-10-07T21:30:20");
    const p = await w.panel(id);
    const offered = p.keys.includes("email");
    const answer = await w.press(
      "room.send",
      { room_id: id, request_id: crypto.randomUUID(), channel: "email" },
      kw("2026-10-07T21:30:25"),
    );
    // Found when it fails: the panel's not_sent moment offers "Send by
    // email" (lib/rooms.ts momentActions: emailBlocked reads only the words
    // email, no link can go, active client, no message can reach, call links
    // this hour, and the night refusal has none of them), and sales-api's
    // room.send refuses it at night (rooms.ts nightHolds: "It is night where
    // the lead is, so no video link goes now. Call them after 9 in the
    // morning, their time."). The rep, told to read the link out, is offered
    // a button whose only answer is a refusal (emailBlocked's own rule: the
    // panel never offers a send it refuses).
    expect({ offered, refused: answer.ok ? null : answer.said }).not.toEqual({
      offered: true,
      refused: LANE_COPY.lead_night,
    });
  });
});

// ---------------------------------------------------------------------------
// 2. That room closed at the lead's ten minutes with the lead in the Meet.
// ---------------------------------------------------------------------------

describe("Wednesday 7 October, 21:30 Kuwait: the setter read the Meet link out, pressed I'm in at 21:30:20; the lead came in at 21:40:55", () => {
  const at = kw("2026-10-07T21:30:00");
  test("the rep's The lead is in (pressed 21:40:57, sent after its 5 s Undo at 21:41:02) lands after the sweep's 21:41:00 close: the panel says the lead joined, never that the link never reached them", async () => {
    const w = setup(at);
    const id = await w.create(at);
    await w.workerOpens(id, kw("2026-10-07T21:30:06"));
    const inAt = kw("2026-10-07T21:30:20");
    expect(
      await w.press(
        "room.mark",
        { room_id: id, what: "host_in", version: Number(w.room(id).version) },
        inAt,
      ),
    ).toEqual({ ok: true, said: null });
    const seen = Number(w.room(id).version);
    // The sweep's R4 at 21:41:00 (host_in_at + 10 minutes is 21:40:20; no
    // lead_by, the link claimed and never sent: "unstarted"), as
    // cockpit_sales_rooms_close writes it.
    w.clock.now = kw("2026-10-07T21:41:00");
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=in.(open,host_in)`, {
      method: "PATCH",
      body: {
        state: "expired",
        end_reason: "link_not_sent",
        ended_at: w.db.iso(),
      },
    });
    const late = await w.press(
      "room.mark",
      { room_id: id, what: "lead_in", version: seen },
      kw("2026-10-07T21:41:02"),
    );
    const p = await w.panel(id);
    // Found when it fails: sales-api refuses the press ("This changed a
    // moment ago.": roomlogic.ts lateLeadIn keeps a late join only after
    // lead_no_show, not_admitted, host_not_in or no_deadline), and the panel
    // then reads expired_unsent: "The room closed and its link never reached
    // the lead. Call them, or send a new video link." to a setter who is on
    // the Meet with the lead, at night, when no new link can go.
    expect({ late: late.ok ? "kept" : late.said, moment: p.moment }).toEqual({
      late: "kept",
      moment: "closed",
    });
  });
});

// ---------------------------------------------------------------------------
// 3. A confirmation call the evening before a morning intro (scope "intro",
//    the pilot as shipped): Send a video link by day at 20:59:30; Google
//    refuses the Meet; the panel's "Try Zoom" lands after 21:00.
// ---------------------------------------------------------------------------

describe("Wednesday 7 October: the lead's intro is booked for Thursday 10:00; its confirmation call at 20:58:40 rings out; Send a Meet link at 20:59:30; the worker fails the room at 20:59:50 (Google refused the Meet)", () => {
  async function failedRoom(retryAt: number) {
    const press = kw("2026-10-07T20:59:30");
    const w = setup(press);
    const apptId = `stress-m1t4b-ui-intro-${fakeUuid().slice(-6)}`;
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: apptId,
        contact_id: w.LEAD,
        call_type: "intro",
        status: "confirmed",
        start_at: iso(kw("2026-10-08T10:00:00")),
        booked_at: iso(kw("2026-10-05T12:00:00")),
        assigned_user_id: "G-setter",
        calendar_id: "stress-intro-cal",
      },
    ]);
    const firstAsk = {
      contact_id: w.LEAD,
      provider: "meet" as const,
      call_kind: "intro" as const,
      purpose: "fallback" as const,
      trigger: "no_answer",
      appointment_id: apptId,
      item_kind: "confirm" as const,
    };
    w.clock.now = press;
    const made = (await w.rooms.actions["room.create"](setter, {
      ...firstAsk,
      request_id: crypto.randomUUID(),
    })) as Row;
    const id = String((made.room as Row).id);
    // The worker's fail() (desk rooms.py): Google refused, the room never opened.
    w.clock.now = kw("2026-10-07T20:59:50");
    await w.io.db(
      `cockpit_sales_rooms?id=eq.${id}&state=in.(requested,creating)`,
      {
        method: "PATCH",
        body: {
          state: "failed",
          error:
            "Not made: Google did not make the Meet link. Try Zoom, or call the lead.",
          result: "failed",
          ended_at: w.db.iso(),
        },
      },
    );
    w.clock.now = retryAt;
    const p = await w.panel(id);
    const feed = (await w.rooms.actions["room.status"](setter, {
      room_id: id,
    })) as Row;
    const ask = R.retryRequest(
      feed.room as Parameters<typeof R.retryRequest>[0],
      firstAsk,
      "zoom",
    );
    let refused: string | null = null;
    try {
      await w.rooms.actions["room.create"](setter, {
        ...ask,
        request_id: crypto.randomUUID(),
      });
    } catch (e) {
      refused = String((e as Error).message);
    }
    return { p, refused };
  }

  test("control: Try Zoom pressed at 20:59:58 (day on the lead's clock) makes the Zoom room", async () => {
    const { p, refused } = await failedRoom(kw("2026-10-07T20:59:58"));
    expect(p.moment).toBe("failed");
    expect(p.keys).toContain("retry");
    expect(refused).toBeNull();
  });

  test("Try Zoom, offered at 21:00:05, makes the room the day press asked for, or is not offered", async () => {
    const { p, refused } = await failedRoom(kw("2026-10-07T21:00:05"));
    // Found when it fails: the failed room's panel offers "Try Zoom" (lib/
    // rooms.ts momentActions "failed": no clock in it), retryRequest asks
    // room.create for a new fallback room, and sales-api refuses it at night
    // (rooms.ts createPrep: "It is night where the lead is, so no video link
    // goes now. Call them after 9 in the morning, their time."). The press
    // that the night rule let through at 20:59:30 would have had its link go
    // until 21:02:30 (PRESS_GRACE_MS) had Google made the Meet; a provider's
    // refusal 20 s later leaves the lead with no link, and the rep with a
    // button whose only answer is a refusal.
    expect({
      offered: p.keys.includes("retry"),
      refused,
    }).not.toEqual({ offered: true, refused: LANE_COPY.lead_night });
  });
});

// ---------------------------------------------------------------------------
// 4. The lead's own intro at 20:45 (the lead chose that hour): the setter's
//    last try inside its window, at 21:00:00, rings out; the dialer's
//    after-miss step still shows Send a video link.
// ---------------------------------------------------------------------------

describe("Wednesday 7 October: a Kuwait lead's own intro at 20:45; the setter's try at 21:00:00 (inside the intro's twenty minutes) rings out; Send a video link from the after-miss step", () => {
  async function press(at: number) {
    const w = setup(kw("2026-10-07T20:44:00"));
    const apptId = `stress-m1t4b-ui-intro-${fakeUuid().slice(-6)}`;
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: apptId,
        contact_id: w.LEAD,
        call_type: "intro",
        status: "confirmed",
        start_at: iso(kw("2026-10-07T20:45:00")),
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
        started_at: iso(kw("2026-10-07T21:00:00")),
        saved_at: iso(kw("2026-10-07T21:00:40")),
      },
    ]);
    // The dialer's gate as DialerPage.tsx asks it (introNow: the item is the
    // intro itself), at the moment of the press.
    const gate = V.videoLinkGate({
      setting: (
        (await w.io.db(
          "cockpit_sales_settings?key=eq.rooms&select=value",
        )) as Row[]
      )[0]?.value as never,
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
      introNow: true,
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

  test("control: pressed at 21:04:59 (the try's five minutes, inside the intro's window), the room is made for the intro", async () => {
    expect(await press(kw("2026-10-07T21:04:59"))).toEqual({
      shown: true,
      refused: null,
    });
  });

  test("pressed at 21:05:01: the step that shows the button gets the room, or the button is not shown", async () => {
    const got = await press(kw("2026-10-07T21:05:01"));
    // Found when it fails: the after-miss step keeps Send a video link for
    // the intro item at any hour (videoLinkGate: introNow skips the night
    // rule), while sales-api judges the room by the call it follows only
    // for ATTEMPT_CARRIES_MS (five minutes) after that call began and then
    // by the press's own moment (rooms.ts createPrep): 21:05:01 is past the
    // intro's start + 20 minutes, so the press is refused "It is night where
    // the lead is, so no video link goes now. Call them after 9 in the
    // morning, their time." for the lead's own booked intro, missed two
    // seconds earlier on the same step.
    expect(got).not.toEqual({ shown: true, refused: LANE_COPY.lead_night });
  });
});

// ---------------------------------------------------------------------------
// 5. The closer's default is Zoom: the lead page's picker at night, and the
//    Zoom room it makes (short_link off: the Zoom link carries its passcode).
// ---------------------------------------------------------------------------

describe("Wednesday 7 October, 21:30 Kuwait: the closer, speaking with a Kuwait lead, makes a room from the lead page at night (Zoom, the closer's default)", () => {
  const at = kw("2026-10-07T21:30:00");
  test("the picker and the room say one thing the closer can do: never 'read the link out' about a Zoom link nobody can say", async () => {
    const w = setup(at);
    const choice = V.providerChoice({
      setting: (
        (await w.io.db(
          "cockpit_sales_settings?key=eq.rooms&select=value",
        )) as Row[]
      )[0]?.value as never,
      role: "closer",
    });
    expect(choice?.first).toBe("zoom");
    const line = V.linkPlanLine({
      setting: (
        (await w.io.db(
          "cockpit_sales_settings?key=eq.rooms&select=value",
        )) as Row[]
      )[0]?.value as never,
      whatsapp: {
        on: true,
        dnd: false,
        reachable: true,
        window: { open: true },
      },
      email: { on: true, dnd: false, reachable: true },
      guardOpen: false,
      templateLive: false,
      country: "KW",
      phone: "+96550123456",
      now: at,
    });
    const id = await w.create(at, "zoom");
    await w.workerOpens(id, kw("2026-10-07T21:30:06"), "zoom");
    expect(w.sent.length).toBe(0);
    w.clock.now = kw("2026-10-07T21:30:10");
    const p = await w.panel(id);
    const readable = R.readOut(
      ((await w.rooms.actions["room.status"](setter, { room_id: id })) as Row)
        .room as Parameters<typeof R.readOut>[0],
    );
    // Found when it fails: the picker promises "You can make the room and
    // read the link out" (videoLink.ts PICKER_NIGHT, whatever the provider),
    // sales-api's refusal on the Zoom room says "Read the link out if you are
    // speaking with them" (LANE_COPY.lead_night_read_out), and the panel
    // then says, in one sentence, to read it out and that it cannot be read
    // out ("Copy the link and send it another way, or end this room and use
    // Meet, whose link can be read out"): the Zoom link with its passcode
    // has no read-out (lib/rooms.ts readOut is null), and "send it another
    // way" is a message at night.
    expect({ readable, picker: line, words: p.words }).not.toEqual({
      readable: null,
      picker: V.PICKER_NIGHT,
      words: expect.stringMatching(
        /Read the link out.*Copy the link and send it another way/,
      ),
    });
  });
});
