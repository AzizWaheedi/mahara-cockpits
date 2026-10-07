// Stress series 2, round 4: end-to-end journeys through the cockpit's own
// press code (lib/rooms.ts roomsApi, stripLine, roomActions, the banner's
// bannerRoomSentence and myRoom, dialerUi afterMiss) and sales-api's real
// room actions (supabase/functions/sales-api/rooms.ts) over the shared fakes
// (testfakes.ts). The browser's `api` is routed straight into sales-api's
// handlers, answered the way index.ts answers a seat, so what the rep sees
// at each step is what the two halves do together. The SQL sweep's closes
// are written onto the rows the way 20261004a writes them; Zoom's webhooks
// go through room.event as the door forwards them.
//
// bun test src/lib/stress2_journeys_r4_ui.test.ts   (from apps/sales-cockpit)
//
// Each test's last expectations are what should hold; a failing one is a
// finding, and its comment says what the rep sees instead.

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
const { ApiRefusal } = await import(`${SA}/liveio.ts`);
const { DEFAULT_ROOMS_JSON } = await import(`${SA}/roomlogic.ts`);
const { answerFailure, ApiError } = await import("./apiErrors");

type World = ReturnType<typeof setup>;
let world: World | null = null;
let actor: Row = {};
const calls: { action: string; body: Row; answer?: Row; refused?: string }[] =
  [];

mock.module("./api", () => ({
  api: async (action: string, body: Row = {}) => {
    const w = world;
    if (!w) throw new Error("no world");
    const h = w.rooms.actions[action];
    const c: (typeof calls)[number] = { action, body };
    calls.push(c);
    if (!h) throw new ApiError("Unknown action.", "refused", 400);
    try {
      const out = (await h(actor, body)) as Row;
      await w.flush();
      c.answer = out;
      return { ok: true, ...out };
    } catch (e) {
      await w.flush();
      if (e instanceof ApiRefusal) {
        const {
          retry: _r,
          cleanup: _c,
          ...extra
        } = (e as InstanceType<typeof ApiRefusal>).extra as Row;
        c.refused = (e as Error).message;
        throw answerFailure((e as InstanceType<typeof ApiRefusal>).status, {
          ...extra,
          ok: false,
          error: (e as Error).message,
        } as never);
      }
      throw new ApiError(
        `That did not work: ${(e as Error).message}`,
        "server",
        500,
      );
    }
  },
}));

const R = await import("./rooms");
const { afterMiss } = await import("./dialerUi");
const { roomForLead } = await import("./videoLink");

const S = 1000;
const MIN = 60 * S;
const CLOSER = "closer@maharamedia.com";
const SETTER = "setter@maharamedia.com";
const LEAD = "VjPfR4Cc1Y0OFvaqeor5";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/85550000001?pwd=sb";

const closer = {
  signed_in: true,
  seat: true,
  manager: false,
  email: CLOSER,
  name: "Sami Closer",
  role: "closer",
  ghl_user_id: "G-closer",
};
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

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_contacts: [LEAD],
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};
const GUARD_OPEN = {
  connector_off: true,
  single_copy_ok_at: "2026-10-01T00:00:00Z",
  templates_per_day: 250,
};

interface Opts {
  start?: number;
  rooms?: Row;
  live?: Row;
  hosts?: Row[];
}

function setup(o: Opts = {}) {
  const w = fakeWorld(o.start);
  const audits: Row[] = [];
  const texts: Row[] = [];
  const seen = new Map<string, Row>();
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: true, standby: true, ...(o.live ?? {}) } },
    { key: "whatsapp_guard", value: GUARD_OPEN },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    {
      email: CLOSER,
      name: "Sami Closer",
      role: "closer",
      ghl_user_id: "G-closer",
      active: true,
    },
    {
      email: SETTER,
      name: "Tara Setter",
      role: "setter",
      ghl_user_id: "G-setter",
      active: true,
    },
  ]);
  w.db.seed(
    "cockpit_sales_room_hosts",
    o.hosts ?? [
      {
        email: CLOSER,
        zoom_user_id: "Z-closer",
        zoom_status: "licensed",
        google_ok: true,
      },
      {
        email: SETTER,
        zoom_user_id: null,
        zoom_status: "pending",
        google_ok: true,
      },
    ],
  );
  w.db.seed("cockpit_sales_inbox", [
    {
      conversation_id: "c0",
      contact_id: LEAD,
      inbound_whatsapp_at: new Date(w.clock.now - 3_600_000).toISOString(),
    },
  ]);
  w.routes.push((m: string, p: string) =>
    m === "GET" && p === `/contacts/${LEAD}`
      ? {
          contact: {
            id: LEAD,
            firstName: "Huda",
            name: "Huda Ali",
            phone: "+96550000000",
            email: "huda@example.com",
            tags: ["cockpit-test"],
            country: "KW",
          },
        }
      : (null as unknown as Row),
  );
  const rooms = makeRooms({
    io: w.io,
    audit: async (
      who: Row,
      action: string,
      entityType: string,
      entityId: string | null,
      before: unknown,
      after: unknown,
      metadata?: Row,
    ) => {
      audits.push({
        who: who.email,
        action,
        entityType,
        entityId,
        before,
        after,
        metadata,
      });
    },
    markAppointment: async () => ({}),
    sendText: async (who: Row, b: Row) => {
      const again = seen.get(String(b.request_id));
      if (again) return { message: again, repeated: true };
      texts.push({ who: who.email, ...b });
      const r = { id: fakeUuid(), state: "sent", provider_status: "sent" };
      seen.set(String(b.request_id), r);
      return { message: r };
    },
    sendTemplate: async (_who: Row, t: Row) => {
      const r = { id: fakeUuid(), state: "sent", provider_status: "sent" };
      seen.set(String(t.requestId), r);
      return { message: r };
    },
    upcoming: async () => null,
  } as never);
  const room = (id: string) =>
    w.db.t("cockpit_sales_rooms").find((r: Row) => r.id === id) as Row;
  /** The room worker: claim, store worker.ready, open the room (contract v2 section 7), then tell sales-api. */
  async function workerOpens(id: string, url = MEET_URL) {
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
        text: "Room made.",
      },
      prefer: "resolution=ignore-duplicates",
    });
    const cur = room(id);
    await w.io.db(
      `cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`,
      {
        method: "PATCH",
        body: {
          state: "open",
          join_url: url,
          provider_meeting_id: `evt-${id.slice(-4)}`,
          opened_at: w.db.iso(),
          host_by:
            cur.host_by ?? new Date(w.clock.now + 15 * MIN).toISOString(),
          ends_at:
            cur.ends_at ?? new Date(w.clock.now + 30 * MIN).toISOString(),
          version: Number(cur.version) + 1,
        },
      },
    );
    await rooms.desk["room.event"](desk, {
      kind: "worker.ready",
      room_id: id,
      payload: { worker_run: "run-1" },
    });
    await w.flush();
  }
  /** The door (sales-live) records the lead's open of the short link. */
  async function leadOpens(id: string) {
    const at = w.db.iso();
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&first_open_at=is.null`, {
      method: "PATCH",
      body: { first_open_at: at, last_open_at: at, open_device: "phone" },
    });
  }
  /** The view cockpit_sales_presence, as 20261004a computes it for this seat now. */
  function presenceRow(email: string, over: Row) {
    const list = w.db.t("cockpit_sales_presence");
    const i = list.findIndex((r: Row) => r.email === email);
    const row = {
      email,
      state: "away",
      until: null,
      room_id: null,
      zoom_status: null,
      default_provider: "meet",
      reason: null,
      booked_at: null,
      booked_kind: null,
      ...over,
    };
    if (i >= 0) list[i] = row;
    else list.push(row);
  }
  /** The SQL sweep's close of a room, as 20261004a writes it. */
  function sweepCloses(id: string, patch: Row) {
    const r = room(id);
    Object.assign(r, {
      ended_at: w.db.iso(),
      version: Number(r.version) + 1,
      ...patch,
    });
  }
  return {
    ...w,
    rooms,
    audits,
    texts,
    room,
    workerOpens,
    leadOpens,
    presenceRow,
    sweepCloses,
  };
}

function begin(o: Opts = {}, who: Row = setter): World {
  const w = setup(o);
  world = w;
  actor = who;
  calls.length = 0;
  R.forgetRequests();
  return w;
}

/** What the strip says and offers after a live.status read, as SalesBannerView draws it. */
async function stripNow(w: World) {
  const data = await R.roomsApi.liveStatus();
  const line = R.stripLine({
    me: data.me,
    rooms: data.rooms,
    offers: data.offers,
    health: data.health,
    now: w.clock.now,
    flash: null,
    standbyError: data.standby_error ?? null,
    ...(typeof data.standby_on === "boolean"
      ? { standbyOn: data.standby_on }
      : {}),
  });
  const keys = [line.primary?.key, ...line.quiet.map(a => a.key)].filter(
    Boolean,
  ) as string[];
  return { data, line, keys, words: R.sentenceText(line.sentence) };
}

/** What the banner's room row says and offers, as SalesBannerView draws it. */
async function bannerNow(w: World) {
  const data = await R.roomsApi.liveStatus();
  const room = R.myRoom(data.rooms, w.clock.now);
  if (!room) return null;
  return {
    room,
    words: R.sentenceText(R.bannerRoomSentence(room, w.clock.now)),
    action: R.bannerRoomAction(room),
  };
}

/** What the room panel says and offers for a room as room.status serves it. */
async function panelNow(w: World, id: string, extra: Row = {}) {
  const feed = await R.roomsApi.status(id);
  const ctx = {
    now: w.clock.now,
    lineShown: true,
    otherOk: feed.other_ok ?? null,
    ...extra,
  };
  const acts = R.roomActions(feed.room, ctx);
  return {
    room: feed.room,
    moment: R.momentFor(feed.room, ctx),
    words: R.sentenceText(R.roomSentence(feed.room, ctx)),
    primary: acts.primary?.key ?? null,
    keys: [acts.primary?.key, ...acts.quiet.map(a => a.key)].filter(
      Boolean,
    ) as string[],
  };
}

void roomForLead;

// ---------------------------------------------------------------------------
// Round 3 helpers
// ---------------------------------------------------------------------------

/** Zoom's webhook for a room's own meeting, stored by the door and forwarded to sales-api. */
async function zoomSays(
  w: World,
  roomId: string,
  event: string,
  participant: Row | null,
) {
  const id = fakeUuid();
  w.db.seed("cockpit_sales_room_events", [
    {
      id,
      room_id: roomId,
      kind: `zoom.${event}`,
      source: "zoom",
      dedupe_key: `zoom:${event}:${id}`,
      detail: {
        event,
        event_ts: w.clock.now,
        payload: {
          object: {
            id: String(w.room(roomId).provider_meeting_id ?? ""),
            host_id: "Z-closer",
            topic: "Mahara call",
            ...(participant ? { participant } : {}),
          },
        },
      },
    },
  ]);
  const out = await w.rooms.desk["room.event"](desk, {
    kind: `zoom.${event}`,
    event_id: id,
    payload: {},
  });
  await w.flush();
  return out;
}

const HOURS2 = 2 * 3_600_000;

/** A closer, Available, in a Zoom standby room the worker made. */
async function closerInStandby(w: World): Promise<string> {
  await R.roomsApi.availability("available");
  const sb = w.db
    .t("cockpit_sales_rooms")
    .find((r: Row) => r.purpose === "standby") as Row;
  expect(sb?.provider).toBe("zoom");
  await w.workerOpens(String(sb.id), ZOOM_URL);
  await R.roomsApi.open(String(sb.id));
  await zoomSays(w, String(sb.id), "meeting.participant_joined", {
    id: "Z-closer",
    user_name: "Sami",
  });
  expect(w.room(String(sb.id)).state).toBe("host_in");
  return String(sb.id);
}

/** The view (20261004a) for an Available seat with no standby room. */
function closerAvailable(w: World) {
  w.presenceRow(CLOSER, {
    state: "available",
    until: new Date(w.clock.now + HOURS2).toISOString(),
    zoom_status: "licensed",
    default_provider: "zoom",
  });
}

const FLOOD = /closed under 10 minutes ago/;

void FLOOD;
// Round 3's helpers, kept for the journeys that use them next.
void closerInStandby;
void closerAvailable;

// ---------------------------------------------------------------------------
// Journey: a missed call, a Meet link, the setter moves on; the lead opens the
// link and waits at Meet's "Ask to join"; nobody comes; the room closes
// ---------------------------------------------------------------------------

describe("journey: a setter's call misses, the Meet link goes, the setter presses Next lead; the lead opens the link four minutes later and asks to join while the setter is on another call", () => {
  test("after the sweep closes the room, the banner (or strip) must still tell the setter the lead tried to join, as it does for a Zoom knock", async () => {
    // The short link is on: the lead's tap goes through the door, which
    // records the open (the only sign Meet ever gives that the lead came).
    const w = begin({ rooms: { short_link: true } }, setter);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    const id = made.room.id;
    await w.workerOpens(id);
    expect(w.texts).toHaveLength(1);
    // Next lead: lead A's panel is gone, the banner is where the room shows.
    w.clock.now += 4 * MIN;
    await w.leadOpens(id);
    const b1 = await bannerNow(w);
    // "Huda opened the link." [Open my room]: the setter is on Maqsam with
    // lead B and does not look up (Meet sends no knock, so this is all there is).
    expect(b1?.words).toBe("Huda opened the link.");
    // The sweep (20261004a R4) closes it at lead_by, held one open grace past
    // the open: a Meet room has no knock (lead_waiting_at is Zoom's), so it
    // closes as lead_no_show, result no_join, not not_admitted.
    const r = w.room(id);
    w.clock.now = Date.parse(String(r.lead_by)) + 3 * MIN + 10 * S;
    w.sweepCloses(id, {
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
    });
    // What lead A's panel would say: "Huda opened the link at 10:04. The room
    // is closed, and Meet cannot say whether they came in. If you did not
    // speak, call them now." Nobody sees it: the setter is on lead B.
    const p = await panelNow(w, id);
    expect(p.words).toMatch(/opened the link at .* call them now/);
    const b2 = await bannerNow(w);
    const s = await stripNow(w);
    // The Zoom knock's twin (expired_knocked) stays on the banner for 15
    // minutes with "Call them now and send a new link." This one is dropped:
    // live.status does not list it (bannerKeeps: lead_waiting_at or
    // admit_blocked only) and myRoom keeps only failed and knocked rooms.
    expect({
      banner: b2?.words ?? null,
      strip: s.words,
    }).toEqual({
      banner: expect.stringMatching(/Huda/),
      strip: expect.anything(),
    });
  });
});

// ---------------------------------------------------------------------------
// Journey: a wrong "The lead is in", taken back, then the real lead
// ---------------------------------------------------------------------------

describe("held (control): on Meet, a colleague opens the setter's room by mistake; the setter presses The lead is in, then That was not the lead; Huda comes in five minutes later", () => {
  test("the setter can still say Huda is in, and the room is not closed under them", async () => {
    const w = begin({}, setter);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    const id = made.room.id;
    await w.workerOpens(id);
    await R.roomsApi.open(id);
    let p = await panelNow(w, id);
    await R.roomsApi.mark(p.room, "host_in");
    w.clock.now += 2 * MIN;
    p = await panelNow(w, id);
    expect(p.primary).toBe("lead_in");
    await R.roomsApi.mark(p.room, "lead_in");
    w.clock.now += MIN;
    p = await panelNow(w, id);
    expect(p.keys).toContain("not_lead");
    await R.roomsApi.mark(p.room, "not_lead");
    p = await panelNow(w, id);
    const afterTakeBack = { state: p.room.state, words: p.words, keys: p.keys };
    // Huda opens the link and asks to join five minutes later; the setter lets her in.
    w.clock.now += 5 * MIN;
    await w.leadOpens(id);
    p = await panelNow(w, id);
    const beforeJoin = { state: p.room.state, words: p.words, keys: p.keys };
    let refused: string | null = null;
    try {
      await R.roomsApi.mark(p.room, "lead_in");
    } catch (e) {
      refused = (e as Error).message;
    }
    p = await panelNow(w, id);
    expect({ afterTakeBack, beforeJoin, refused, state: p.room.state }).toEqual(
      {
        afterTakeBack: expect.objectContaining({ state: "host_in" }),
        beforeJoin: expect.objectContaining({
          keys: expect.arrayContaining(["lead_in"]),
        }),
        refused: null,
        state: "lead_in",
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Journey: Meet with the short link off (as shipped): the setter and the lead
// talk on Meet and nobody presses anything
// ---------------------------------------------------------------------------

describe("journey: rooms.short_link is off (as shipped), a setter's call misses, the Meet link goes, the setter opens the room and lets the lead in; they talk and nobody presses I'm in or The lead is in", () => {
  async function talkedOnMeet(w: World, appointment: string | null) {
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
      ...(appointment
        ? { appointment_id: appointment, item_kind: "intro" as const }
        : {}),
    });
    const id = made.room.id;
    await w.workerOpens(id);
    // The link the lead got is Meet's own (shortUrl with short_link off): the
    // door never sees it opened, so first_open_at stays empty for good.
    expect(
      String(
        w.texts[0]?.text ?? w.texts[0]?.body ?? JSON.stringify(w.texts[0]),
      ),
    ).toContain(MEET_URL);
    await R.roomsApi.open(id);
    // 10:02 the lead taps the Meet link, asks to join, the setter admits her
    // in the Meet tab; they talk until 10:14. Meet says nothing to anyone.
    const r = w.room(id);
    expect(r.first_open_at ?? null).toBeNull();
    // The sweep's R4 at lead_by (no open, no knock to hold it): lead_no_show.
    w.clock.now = Date.parse(String(r.lead_by)) + 40 * S;
    w.sweepCloses(id, {
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
    });
    w.clock.now += 3 * MIN;
    return id;
  }

  test("a new lead (fallback scope any): the panel must not say the lead did not join, and the step below must let the setter save how it went", async () => {
    const w = begin({}, setter);
    const id = await talkedOnMeet(w, null);
    const p = await panelNow(w, id, { talkBelow: true });
    // Said: "The lead did not join in 10 minutes. Room closed. Call again or
    // send a message." with no button.
    const step = afterMiss({
      moment: "missed_call",
      whatsapp: {
        on: true,
        dnd: false,
        reachable: true,
        window: { open: true },
      } as never,
      email: { on: true, dnd: false, reachable: true } as never,
      templatesLive: true,
      messageReady: true,
      video: p.room,
    });
    // Below it, DialerPage's AfterMissStep: "No answer. Send them a
    // WhatsApp?" [Next lead] [WhatsApp them] [Send a video link]; no Save how
    // it went (afterMiss gives talk only to a Meet room the door saw opened,
    // which it never can with the short link off), so the 12 minutes on
    // video stay a "No answer" and the setter is offered the missed-call
    // WhatsApp and a second link.
    expect({
      words: p.words,
      title: step.title,
      talk: step.talk ?? false,
    }).toEqual({
      words: expect.not.stringMatching(/did not join/),
      title: expect.not.stringMatching(/^No answer/),
      talk: true,
    });
  });

  test("the booked intro: the panel must not say nobody joined nor offer No-show, which the settle itself refuses on this room", async () => {
    const w = begin({}, setter);
    const start = w.clock.now;
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "appt-intro-huda",
        contact_id: LEAD,
        call_type: "intro",
        start_at: new Date(start).toISOString(),
        status: "confirmed",
        assigned_user_id: "G-setter",
        calendar_id: "cal-intro",
      },
    ]);
    const id = await talkedOnMeet(w, "appt-intro-huda");
    expect(w.room(id).appointment_id).toBe("appt-intro-huda");
    // The dialer's panel on the intro call (DialerPage passes onMarkIntro).
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    // Said: "Nobody joined in 10 minutes. The room is closed. Mark the
    // intro:" [No-show] [We spoke on the phone]. The settle (roomlogic
    // noShowDoubt) will not mark this room a no-show: "Meet sends no join
    // signal and nobody pressed The lead is in". A No-show press fires
    // HighLevel's no-show automation at a lead who was on video for 12 minutes.
    expect({ words: p.words, noshow: p.keys.includes("noshow") }).toEqual({
      words: expect.not.stringMatching(/Nobody joined/),
      noshow: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Journey: the lead knocks on Meet and cannot be let in; I can't let them in
// ---------------------------------------------------------------------------

describe("journey: a closer's call misses, the Meet link goes, Huda opens it and asks to join; Meet will not let her in, so the closer presses I can't let them in", () => {
  test("the second message tells Huda the call moved to Zoom, never 'I just tried to call you and couldn't get through' again", async () => {
    const w = begin(
      {
        rooms: {
          short_link: true,
          fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
        },
      },
      closer,
    );
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    const id = made.room.id;
    await w.workerOpens(id);
    expect(w.texts).toHaveLength(1);
    const first = String(w.texts[0].text ?? w.texts[0].body ?? "");
    await R.roomsApi.open(id);
    w.clock.now += 2 * MIN;
    await w.leadOpens(id);
    let p = await panelNow(w, id);
    await R.roomsApi.mark(p.room, "host_in");
    p = await panelNow(w, id);
    // "Huda opened the link at 10:02. Let them in, then press The lead is in."
    expect(p.keys).toContain("admit_blocked");
    // Meet's "Ask to join" never reaches the closer (a phone not signed in to
    // Google, P1 edge case 9): I can't let them in, behind its 5 s Undo.
    const out = await R.roomsApi.end(p.room, "admit_blocked");
    expect(out.replacement?.provider).toBe("zoom");
    await w.workerOpens(String(out.replacement?.id), ZOOM_URL);
    expect(w.texts).toHaveLength(2);
    const second = String(w.texts[1].text ?? w.texts[1].body ?? "");
    // Sent (rooms.ts leadText, purpose fallback): the same opening as the
    // first message, word for word, with the Zoom link: "Hi Huda, it's Sami
    // from Mahara Media. I tried to call you just now and couldn't get
    // through. If you have 15 minutes, we can talk on video now: ... I'll be
    // there for the next 10 minutes." Huda is at Meet's door at that moment;
    // nothing says the call moved to Zoom or that the Meet link is no longer
    // the one to use.
    expect({ first, second }).toEqual({
      first: expect.stringMatching(/couldn't get through/),
      second: expect.not.stringMatching(/couldn't get through/),
    });
  });
});

// ---------------------------------------------------------------------------
// Journey: the banner sends the setter to the lead page to say the lead is in
// ---------------------------------------------------------------------------

describe("journey: a missed call, a Meet link, Next lead; Huda opens the link; the setter presses Open my room on the banner, lets her in on Meet, then follows the banner to the lead page", () => {
  test("the lead page offers The lead is in, the press the banner just named", async () => {
    const w = begin({ rooms: { short_link: true } }, setter);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    const id = made.room.id;
    await w.workerOpens(id);
    w.clock.now += 3 * MIN;
    await w.leadOpens(id);
    const b1 = await bannerNow(w);
    expect(b1?.action.key).toBe("open_room");
    // The banner's one button: Open my room (the Meet tab opens).
    await R.roomsApi.open(id);
    const b2 = await bannerNow(w);
    // "Huda opened the link. Let them in, then open the lead and press The
    // lead is in." [Open the lead]
    expect(b2?.words).toMatch(/press The lead is in/);
    expect(b2?.action.key).toBe("open_lead");
    // The setter admits Huda in Meet and follows the banner: the lead page's
    // panel (no marks below it).
    const p = await panelNow(w, id);
    // The panel says "Huda opened the link at 10:03. Join now." with [Open my
    // room] first and [I'm in] beside it: The lead is in waits for I'm in
    // (roomActions: only someone in the room can let the lead in), so the
    // press the banner named is not on the page, and the panel tells a rep
    // who is already in Meet to join.
    expect({ words: p.words, keys: p.keys }).toEqual({
      words: expect.not.stringMatching(/Join now/),
      keys: expect.arrayContaining(["lead_in"]),
    });
  });
});

// ---------------------------------------------------------------------------
// Journey: the lead joins after the setter moved on; the banner leads to the
// lead page; the setter wants to book the demo while the lead is warm
// ---------------------------------------------------------------------------

describe("journey: a missed call to a new lead, a Meet link, Next lead; Huda joins; the setter follows the banner, talks, presses Finished, and wants to book the demo", () => {
  test("the page the banner opens lets the setter book the call (or save how it went), as the dialer's joined step does", async () => {
    const w = begin({}, setter);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    const id = made.room.id;
    await w.workerOpens(id);
    // Next lead: lead B is on the dialer now. Huda asks to join; the setter
    // opens the Meet from the banner, presses I'm in and The lead is in.
    await R.roomsApi.open(id);
    w.clock.now += 3 * MIN;
    let p = await panelNow(w, id);
    await R.roomsApi.mark(p.room, "host_in");
    p = await panelNow(w, id);
    await R.roomsApi.mark(p.room, "lead_in");
    const b = await bannerNow(w);
    // "Huda joined." [Open the lead]: the banner's way to the call is the
    // lead page (SalesBanner open_lead navigates to /lead/{contact_id}).
    expect(b?.words).toBe("Huda joined.");
    expect(b?.action.key).toBe("open_lead");
    // They talk for 20 minutes; Finished on the lead page's panel.
    w.clock.now += 20 * MIN;
    p = await panelNow(w, id);
    await R.roomsApi.end(p.room, "finished", true);
    p = await panelNow(w, id);
    // The lead page's panel (no canMarkIntro, no talkBelow): "Finished at
    // 10:24." and no button. The page itself has no booking and no outcome
    // save (LeadPage.tsx draws neither BookForm nor dial.save; its calendar
    // card says "A setter books the intro from the dialer or HighLevel"), and
    // nothing on it leads to this lead in the dialer, whose joined step
    // ("Huda joined the video call. How did the intro go?" [Book the demo])
    // was only ever on the pane the setter left.
    const leadPage = await Bun.file(
      new URL("../pages/LeadPage.tsx", import.meta.url),
    ).text();
    const pageBooks =
      /BookForm|"book\.create"|"dial\.save"|to=\{?[`"]\/dialer/.test(leadPage);
    expect({ words: p.words, panelKeys: p.keys, pageBooks }).toEqual({
      words: expect.stringMatching(/^Finished at/),
      panelKeys: expect.arrayContaining([expect.any(String)]),
      pageBooks: true,
    });
  });
});
