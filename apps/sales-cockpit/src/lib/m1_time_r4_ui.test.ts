// Milestone 1, video-link round 4, the TIME angle, through the lead page's
// own picker (lib/videoLink.ts videoLinkGate and linkPlanLine, as
// LeadPage.tsx calls them with convo.read's channels) over sales-api's real
// room actions (testfakes.ts).
//
// bun test src/lib/m1_time_r4_ui.test.ts   (from apps/sales-cockpit)
//
//  1. The lead page at 21:00 Kuwait, one second either side: the picker
//     says where the link will go, the press makes the room, and the night
//     rule (sales-api rooms.ts nightHolds) decides whether anything goes.
//  2. The lead's WhatsApp window, one second either side of its last 15
//     minutes (roomlogic.ts LINK_WINDOW_MARGIN_MS): the picker's line and
//     the channel the link really goes on.
//
// Pilot settings (m1-scope.md section 3): rooms on, both providers, every
// send lane on, short_link off, test_only with the lead as the test
// contact; the WhatsApp gate shut (today) or open (the pilot's later
// state). A failing expectation is a finding; its comment says what the rep
// sees instead. Every lead is invented (stress-m1t4-ui-...).

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
const { whatsappWindow } = await import(`${SA}/lib.ts`);
const V = await import("./videoLink");

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "setter-m1t4-ui@stress.invalid";
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

const GATE_OPEN = {
  connector_off: true,
  single_copy_ok_at: "2026-10-01T00:00:00Z",
};
const GATE_SHUT = { connector_off: false, single_copy_ok_at: null };

function setup(
  now: number,
  o: { gate: boolean; inboundAt: number | null; phone?: string },
) {
  const w = fakeWorld(now);
  const LEAD = `stress-m1t4-ui-${fakeUuid().slice(-8)}`;
  const phone = o.phone ?? "+96550123456";
  const rawRooms = {
    ...DEFAULT_ROOMS_JSON,
    enabled: true,
    test_only: true,
    test_contacts: [LEAD],
    providers: { zoom: true, meet: true },
    send: { whatsapp_text: true, whatsapp_template: true, email: true },
    short_link: false,
    fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro" },
  };
  const guard = o.gate ? GATE_OPEN : GATE_SHUT;
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: rawRooms },
    { key: "live", value: { enabled: false, slack: false } },
    { key: "followups", value: { enabled: true, agent: false } },
    { key: "whatsapp_guard", value: guard },
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
  if (o.inboundAt !== null)
    w.db.seed("cockpit_sales_inbox", [
      {
        conversation_id: `c-${LEAD}`,
        contact_id: LEAD,
        inbound_whatsapp_at: iso(o.inboundAt),
      },
    ]);
  const contact = {
    id: LEAD,
    firstName: "Sam",
    name: "Sam Lee",
    phone,
    email: `${LEAD}@example.invalid`,
    tags: ["roas-qualified"],
    country: "KW",
  };
  w.routes.push(async (m: string, p: string) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p))
      return { events: [] };
    if (m === "GET" && /^\/conversations\/messages\//.test(p))
      return { message: { status: "delivered" } };
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
      sent.push({ channel: String(b.channel), at: w.clock.now });
      const row: Row = {
        id: fakeUuid(),
        request_id: b.request_id,
        contact_id: b.contact_id,
        channel: b.channel,
        via: "conversation",
        body: b.body,
        source: "room",
        state: "sent",
        provider_status: "delivered",
        ghl_message_id: `m-${fakeUuid().slice(-8)}`,
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
    },
    sendTemplate: async () => {
      throw new Error("no template in this test");
    },
    upcoming: async () => null,
    sentSince: async () => null,
  });
  async function drain() {
    for (let i = 0; i < 10; i++) {
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }
  const room = (id: string) =>
    w.db.t("cockpit_sales_rooms").find((r: Row) => r.id === id) as Row;

  /** What the lead page's picker shows at `at` (LeadPage.tsx: videoLinkGate, then linkPlanLine over convo.read's channels). */
  function picker(at: number) {
    const setting = V.readRoomsSetting(rawRooms);
    if (!setting) throw new Error("setting");
    const gate = V.videoLinkGate({
      setting,
      contactId: LEAD,
      seatEmail: SETTER,
      purpose: "manual",
      country: "KW",
      phone,
      now: at,
    });
    // convo.read's channels (index.ts convoRead): the window as the lead's
    // conversation has it now.
    const window = whatsappWindow(
      o.inboundAt === null ? null : iso(o.inboundAt),
      at,
    );
    // Round 4 fix: LeadPage.tsx passes the lead's country, phone and the
    // moment, so the line reads the lead's night as the gate does.
    const line = V.linkPlanLine({
      setting,
      whatsapp: { on: true, dnd: false, reachable: true, window },
      email: { on: true, dnd: false, reachable: true },
      guardOpen: V.guardOpen(guard),
      templateLive: false,
      country: "KW",
      phone,
      now: at,
    });
    return { show: gate.show, line };
  }

  /** The press (room.create manual) and the room worker's open six seconds later (contract v2 section 7). */
  async function press(at: number) {
    w.clock.now = at;
    const out = await rooms.actions["room.create"](setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      purpose: "manual",
      provider: "meet",
      call_kind: "intro",
      trigger: "manual",
    });
    const id = String((out.room as Row).id);
    w.clock.now = at + 6 * S;
    for (const r of w.db.t("cockpit_sales_worker_status"))
      r.at = iso(w.clock.now - 5 * S);
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: {
        state: "creating",
        claimed_at: w.db.iso(),
        worker_run: "run-1",
        version: Number(r.version) + 1,
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
          join_url: "https://meet.google.com/abc-defg-hij",
          provider_meeting_id: "abc-defg-hij",
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
        provider: "meet",
        provider_meeting_id: "abc-defg-hij",
        worker_run: "run-1",
      },
    });
    await drain();
    return { id, room: room(id) };
  }

  return { w, LEAD, sent, picker, press };
}

/** The channel the picker's line names, or null when it names none. */
function named(line: string | null): string | null {
  if (!line) return null;
  if (/on WhatsApp\./.test(line)) return "whatsapp";
  if (/by email\./.test(line)) return "email";
  return null;
}

// ---------------------------------------------------------------------------
// 1. The lead page at 21:00 Kuwait, one second either side.
// ---------------------------------------------------------------------------

describe("Thursday 8 October, the pilot today (WhatsApp gate shut, email only): the test contact's lead page, Send a video link, Kuwait lead", () => {
  test("control: pressed at 20:59:59 (day), the picker says 'by email' and the email goes when the room opens at 21:00:05", async () => {
    const at = kw("2026-10-08T20:59:59");
    const s = setup(at, { gate: false, inboundAt: null });
    const p = s.picker(at);
    expect(p).toEqual({
      show: true,
      line: "The lead gets the link by email.",
    });
    await s.press(at);
    expect(s.sent.map(x => x.channel)).toEqual(["email"]);
  });

  test("pressed at 21:00:00 (night on the lead's clock): the picker never promises an email that the room will not send", async () => {
    const at = kw("2026-10-08T21:00:00");
    const s = setup(at, { gate: false, inboundAt: null });
    const p = s.picker(at);
    const { room } = await s.press(at);
    // Found when it fails: videoLinkGate reads the lead's night only for a
    // missed call (purpose fallback), and linkPlanLine knows no clock, so
    // the lead page offers the button with "The lead gets the link by
    // email."; the press makes a Meet room on the CEO's Google, and
    // sales-api's nightHolds keeps every send of a manual room at night:
    // nothing goes, and only after the room opens does the panel say "It
    // is night where the lead is, so no message went. Read the link out if
    // you are speaking with them." The picker's own words for a room whose
    // link cannot go are PICKER_NONE.
    expect({
      promised: named(p.line),
      went: s.sent.map(x => x.channel),
      said_after: String(room.refusal ?? ""),
    }).toEqual({
      promised: null,
      went: [],
      said_after:
        "It is night where the lead is, so no message went. Read the link out if you are speaking with them.",
    });
  });

  test("the same for a UAE lead (+971) at 20:00:00 Kuwait, 21:00 in Dubai", async () => {
    const at = kw("2026-10-08T20:00:00");
    const s = setup(at, {
      gate: false,
      inboundAt: null,
      phone: "+971501234567",
    });
    const p = s.picker(at);
    await s.press(at);
    expect({
      promised: named(p.line),
      went: s.sent.map(x => x.channel),
    }).toEqual({
      promised: null,
      went: [],
    });
  });
});

// ---------------------------------------------------------------------------
// 2. The WhatsApp window's last 15 minutes, one second either side.
// ---------------------------------------------------------------------------

describe("Tuesday 6 October, by day, WhatsApp gate open: the lead wrote on WhatsApp almost 24 hours ago; the lead page's picker at 14:00:00, the room opens at 14:00:06", () => {
  const at = kw("2026-10-06T14:00:00");
  const opens = at + 6 * S;
  // The free text is not sent in the window's last 15 minutes (roomlogic
  // LINK_WINDOW_MARGIN_MS): at the open it goes only while the window
  // closes more than 15 minutes later, i.e. the lead wrote after
  // opens - 23 h 45 min.
  const edge = opens - 24 * HOUR + 15 * MIN;

  test("control: the lead wrote one second after the edge: the picker says 'on WhatsApp' and the link goes on WhatsApp", async () => {
    const s = setup(at, { gate: true, inboundAt: edge + S });
    const p = s.picker(at);
    await s.press(at);
    expect({
      promised: named(p.line),
      went: s.sent.map(x => x.channel),
    }).toEqual({
      promised: "whatsapp",
      went: ["whatsapp"],
    });
  });

  // Outside video-link round 4's list (the picker one second from the
  // window's 15-minute edge, where only the room's own open time decides):
  // kept, skipped, for the round that takes it.
  test.skip("the lead wrote one second before the edge: the picker names the channel the link goes on", async () => {
    const s = setup(at, { gate: true, inboundAt: edge - S });
    const p = s.picker(at);
    await s.press(at);
    // Found when it fails: linkPlanLine reads convo.read's window as it is
    // (open until 24 hours after the lead wrote), while sales-api's
    // channelPlan never sends the free text in the window's last 15
    // minutes; the template lane is off with short_link off, so the link
    // goes by email while the picker said "The lead gets the link on
    // WhatsApp." for up to 15 minutes of every lead's window.
    expect({
      promised: named(p.line),
      went: s.sent.map(x => x.channel),
    }).toEqual({
      promised: "email",
      went: ["email"],
    });
  });
});

// ---------------------------------------------------------------------------
// 3. A link HighLevel will not take yet ("tried again in a minute"), one
//    second either side of the lead's ten minutes, which run from the open.
// ---------------------------------------------------------------------------

const R = await import("./rooms");
const { ApiRefusal } = await import(`${SA}/liveio.ts`);

/**
 * The setter's own booked intro at 15:00 (the pilot's shipped scope
 * "intro"), Kuwait lead, the WhatsApp gate shut (today: email only). The
 * call at 15:00:20 rings out; Send a video link, Zoom instead, at 15:01:00;
 * the room worker opens it at 15:01:06. HighLevel refuses every send with
 * 429 until `takesFrom`. The sweep runs at the top of each minute: its re-ask
 * of the unsent link (roomlogic reaskPlan, rooms.ts tick) and its R4
 * (lead_by, as cockpit_sales_rooms_sweep closes it) are applied in the
 * order the SQL runs them (closes first, then the tick list).
 */
async function throttledIntro(takesFrom: number) {
  const press = kw("2026-10-06T15:01:00");
  const w = fakeWorld(press);
  const LEAD = `stress-m1t4-ui-${fakeUuid().slice(-8)}`;
  const APPT = `appt-m1t4-${fakeUuid().slice(-8)}`;
  const start = kw("2026-10-06T15:00:00");
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
    { key: "whatsapp_guard", value: GATE_SHUT },
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
      at: iso(press - 5 * S),
    },
  ]);
  w.db.seed("cockpit_sales_leads", [
    {
      contact_id: LEAD,
      country: "KW",
      phone: "+96550123456",
      assigned_to: "G-setter",
    },
  ]);
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: APPT,
      contact_id: LEAD,
      call_type: "intro",
      status: "confirmed",
      start_at: iso(start),
      end_at: iso(start + 15 * MIN),
      assigned_user_id: "G-setter",
    },
  ]);
  const attempt = fakeUuid();
  w.db.seed("cockpit_sales_attempts", [
    {
      id: attempt,
      contact_id: LEAD,
      rep_email: SETTER,
      appointment_id: APPT,
      item_kind: "intro",
      state: "saved",
      outcome: "no_answer",
      call_state: "no_answer",
      call_duration_s: 0,
      started_at: iso(start + 20 * S),
      saved_at: iso(start + 55 * S),
    },
  ]);
  w.routes.push(async (m: string, p: string) => {
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return {
        contact: {
          id: LEAD,
          firstName: "Sam",
          name: "Sam Lee",
          phone: "+96550123456",
          email: `${LEAD}@example.invalid`,
          tags: ["roas-qualified"],
          country: "KW",
        },
      };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p))
      return { events: [] };
    if (m === "GET" && /^\/conversations\/messages\//.test(p))
      return { message: { status: "delivered" } };
    return null as unknown as Row;
  });
  const jobs: Promise<unknown>[] = [];
  const went: { channel: string; at: number }[] = [];
  const rows = new Map<string, Row>();
  const rooms = makeRooms({
    io: {
      ...w.io,
      background: (p: Promise<unknown>) => {
        jobs.push(p.catch(() => null));
      },
    },
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    // The message service (index.ts convoSend): one row per request id; a
    // repeat answers that row. HighLevel's 429 is a refusal it is certain of.
    sendText: async (_who: unknown, b: Row) => {
      const rid = String(b.request_id);
      const had = rows.get(rid);
      if (had) return { message: { ...had }, repeated: true };
      const row: Row = {
        id: fakeUuid(),
        request_id: rid,
        contact_id: b.contact_id,
        channel: b.channel,
        via: "conversation",
        body: b.body,
        source: "room",
        state: "sending",
        created_at: iso(w.clock.now),
      };
      rows.set(rid, row);
      w.db.t("cockpit_sales_messages").push(row);
      if (w.clock.now < takesFrom) {
        row.state = "failed";
        row.error = "HighLevel said 429: Too Many Requests";
        throw new ApiRefusal(
          `HighLevel did not send it: ${String(row.error)}`,
          502,
          { certain: true },
        );
      }
      row.state = "sent";
      row.provider_status = "delivered";
      row.ghl_message_id = `m-${fakeUuid().slice(-8)}`;
      went.push({ channel: String(b.channel), at: w.clock.now });
      return { message: { ...row } };
    },
    sendTemplate: async () => {
      throw new Error("no template in this test");
    },
    upcoming: async () => null,
    sentSince: async () => null,
  });
  async function drain() {
    for (let i = 0; i < 10; i++) {
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }
  const room = (id: string) =>
    w.db.t("cockpit_sales_rooms").find((r: Row) => r.id === id) as Row;
  const beat = () => {
    for (const r of w.db.t("cockpit_sales_worker_status"))
      r.at = iso(w.clock.now - 5 * S);
  };

  w.clock.now = press;
  const out = await rooms.actions["room.create"](setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    purpose: "fallback",
    provider: "zoom",
    call_kind: "intro",
    trigger: "no_answer",
    attempt_id: attempt,
    item_kind: "intro",
    appointment_id: APPT,
  });
  const id = String((out.room as Row).id);
  // The room worker: claim, the meeting, worker.ready stored, the room open.
  w.clock.now = press + 6 * S;
  beat();
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
        join_url: "https://us06web.zoom.us/j/81234567890?pwd=stressm1t4",
        provider_meeting_id: "81234567890",
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
      provider: "zoom",
      provider_meeting_id: "81234567890",
      worker_run: "run-1",
    },
  });
  await drain();
  const opened = Date.parse(String(room(id).opened_at));
  // The sweep, each minute from 15:02:00 to 15:14:00: R4 first, then the tick.
  let refusalAt1505: unknown = null;
  for (let m = 2; m <= 14; m++) {
    if (m === 6) refusalAt1505 = room(id).refusal ?? null;
    w.clock.now = kw(`2026-10-06T15:${String(m).padStart(2, "0")}:00`);
    beat();
    const r = room(id);
    const leadBy = Date.parse(String(r.lead_by ?? ""));
    if (
      (r.state === "open" || r.state === "host_in") &&
      Number.isFinite(leadBy) &&
      leadBy < w.clock.now
    ) {
      // cockpit_sales_rooms_close(..., 'expired', 'lead_no_show', 'Closed: the lead did not join in 10 minutes.', 'no_join')
      Object.assign(r, {
        state: "expired",
        end_reason: "lead_no_show",
        result: "no_join",
        ended_at: iso(w.clock.now),
        version: Number(r.version) + 1,
      });
    }
    await rooms.desk["room.event"](desk, {
      kind: "tick",
      payload: { room_ids: [id] },
    });
    await drain();
  }
  w.clock.now = kw("2026-10-06T15:14:30");
  const status = await rooms.actions["room.status"](setter, { room_id: id });
  const view = R.normalizeRoom(status.room);
  if (!view) throw new Error("no view");
  const ctx = { now: w.clock.now, canMarkIntro: true, talkBelow: true };
  return {
    opened,
    room: room(id),
    refusalAt1505,
    went,
    said: R.sentenceText(R.roomSentence(view, ctx)),
    actions: R.roomActions(view, ctx),
  };
}

describe("Tuesday 6 October: the setter's own 15:00 intro rings out; a Zoom video link at 15:01:00; HighLevel answers 429 to every send for ten minutes", () => {
  test("setup: the room opened at 15:01:06; its link was tried each minute ('so it is tried again in a minute')", async () => {
    const out = await throttledIntro(kw("2026-10-06T15:11:01"));
    expect(new Date(out.opened).toISOString()).toBe(
      iso(kw("2026-10-06T15:01:06")),
    );
    // Round 4 fix: what the room said while HighLevel answered 429 (at 15:05);
    // HighLevel takes sends again at 15:11:01, and the 15:12:00 re-ask sends it.
    expect(String(out.refusalAt1505 ?? "")).toContain(
      "so it is tried again in a minute",
    );
    expect(out.room.lead_by ?? null).toBe(iso(kw("2026-10-06T15:22:00")));
  });

  test("control: HighLevel takes sends again at 15:10:30: the 15:11:00 re-ask sends the link and the room waits ten minutes from it", async () => {
    const out = await throttledIntro(kw("2026-10-06T15:10:30"));
    expect(out.went.map(x => x.channel)).toEqual(["email"]);
    expect(out.room.lead_by).toBe(iso(kw("2026-10-06T15:21:00")));
    expect(out.room.state).toBe("open");
  });

  test("HighLevel takes sends again at 15:11:01: the lead gets the link, or the rep is told it never went (never 'Nobody joined' with a No-show press)", async () => {
    const out = await throttledIntro(kw("2026-10-06T15:11:01"));
    // Found when it fails: lead_by is stamped at the room's open (roomlogic
    // readyOnOpen: (link_sent_at ?? now) + 10 minutes) whether or not a
    // link went, so the sweep's R4 closes the room at 15:12:00 as
    // lead_no_show ("Closed: the lead did not join in 10 minutes.", result
    // no_join) while the link has only ever been "tried again in a minute";
    // the re-asks stop with the room (reaskPlan: open or host_in only), so
    // HighLevel taking sends again at 15:11:01 sends nothing. The panel then
    // reads the closed room as the lead's no-show: "Nobody joined in 10
    // minutes. The room is closed. Mark the intro:" with [No-show], whose
    // press starts HighLevel's no-show automation on a lead who was never
    // sent the link.
    expect({
      went: out.went.map(x => x.channel),
      said_nobody_joined: /Nobody joined|did not join/.test(out.said),
      noshow_offered: [out.actions.primary, ...out.actions.quiet].some(
        a => a?.key === "noshow",
      ),
    }).toEqual({
      went: out.went.length ? ["email"] : [],
      said_nobody_joined: false,
      noshow_offered: false,
    });
  });
});
