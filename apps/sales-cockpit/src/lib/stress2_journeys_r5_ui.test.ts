// Stress series 2, round 5: end-to-end journeys through the cockpit's own
// press code (lib/rooms.ts roomsApi, stripLine, roomActions, the banner's
// bannerRoomSentence and myRoom, dialerUi afterMiss) and sales-api's real
// room actions (supabase/functions/sales-api/rooms.ts) over the shared fakes
// (testfakes.ts). The browser's `api` is routed straight into sales-api's
// handlers, answered the way index.ts answers a seat, so what the rep sees
// at each step is what the two halves do together. The SQL sweep's closes
// are written onto the rows the way 20261004a writes them; Zoom's webhooks
// go through room.event as the door forwards them.
//
// bun test src/lib/stress2_journeys_r5_ui.test.ts   (from apps/sales-cockpit)
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
/** Every intro mark sales-api wrote (index.ts markAppointment), in order. */
const marks: Row[] = [];

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
  // Rooms for booked calls (room.wrap) on: these journeys open one
  // (rooms.wrap ships off, outside Milestone 1).
  wrap: true,
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
    markAppointment: async (
      who: Row,
      id: string,
      status: string,
      opts: Row,
    ) => {
      marks.push({ who: who.email, id, status, note: opts?.note ?? null });
      return { crm: "ok" };
    },
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
  marks.length = 0;
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
// Round 5 helpers
// ---------------------------------------------------------------------------

/** The door (sales-live handler.ts recordOpen) on a link whose room is over: one door.open row, after_end, no open columns. */
function leadOpensAfterClose(w: World, id: string) {
  const at = w.db.iso();
  w.db.seed("cockpit_sales_room_events", [
    {
      id: fakeUuid(),
      room_id: id,
      kind: "door.open",
      source: "door",
      dedupe_key: `open:${id}:late`,
      at,
      handled_at: at,
      text: "The lead opened the link after the room closed.",
      detail: {
        device: "phone",
        os: "ios",
        room_state: w.room(id).state,
        after_end: true,
      },
    },
  ]);
}

/** The setter's booked intro with Huda, starting at `start`. */
function bookedIntro(w: World, start: number, id = "appt-r5-intro") {
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: id,
      contact_id: LEAD,
      calendar_id: "cal-intro",
      call_type: "intro",
      start_at: new Date(start).toISOString(),
      end_at: new Date(start + 30 * MIN).toISOString(),
      status: "confirmed",
      assigned_user_id: "G-setter",
    },
  ]);
  return id;
}

// ---------------------------------------------------------------------------
// Journey: the intro call misses, the link goes, the lead never comes in
// time, then opens the link two minutes after the room closed
// ---------------------------------------------------------------------------

describe("journey: a booked intro's call misses at its start, the Meet link goes, Huda opens it only after the room closed (short link on)", () => {
  test("the setter is told Huda is at the link now, and no screen offers No-show for a lead who just opened it", async () => {
    const w = begin({ rooms: { short_link: true } }, setter);
    const appt = bookedIntro(w, w.clock.now);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
      appointment_id: appt,
    });
    const id = made.room.id;
    await w.workerOpens(id);
    expect(w.room(id).link_sent_at).toBeTruthy();
    // The setter moves on (Next lead). Nobody opens the link; the sweep's R4
    // closes the room at lead_by as nobody joined (20261004a).
    const r = w.room(id);
    w.clock.now = Date.parse(String(r.lead_by)) + 30 * S;
    w.sweepCloses(id, {
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
    });
    // Two minutes later Huda taps the WhatsApp link: the door shows her
    // "This call has ended" and stores only a door.open row (after_end).
    w.clock.now += 2 * MIN;
    leadOpensAfterClose(w, id);
    const feed = await R.roomsApi.status(id);
    expect(feed.events.some(e => /after the room closed/.test(e.text))).toBe(
      true,
    );
    // What the setter sees now, on the banner, the strip and the dialer's panel
    // for the intro (canMarkIntro: the intro's own room).
    const banner = await bannerNow(w);
    const strip = await stripNow(w);
    const p = await panelNow(w, id, { canMarkIntro: true });
    // Today: the banner shows nothing (live.status keeps a closed room only
    // when first_open_at, last_open_at or a knock is set, and the door writes
    // neither on a closed room); the panel still says Huda did not join and
    // offers No-show, the press whose HighLevel automation writes to the lead.
    expect({
      bannerTellsSetter: Boolean(banner && /Huda/.test(banner.words)),
      panelOffersNoShow: p.keys.includes("noshow"),
      panelSaysNoJoin: /did not join|nobody joined/i.test(p.words),
      strip: strip.words,
    }).toEqual({
      bannerTellsSetter: true,
      panelOffersNoShow: false,
      panelSaysNoJoin: false,
      strip: expect.anything(),
    });
  });

  test("the settle at the intro's start + 20 minutes does not mark a no-show over Huda's open of the link (as it does not over a Zoom join after the close)", async () => {
    // The test contact's intro is on the test calendar, so the settle may mark it.
    const w = begin(
      { rooms: { short_link: true, test_calendar_id: "cal-intro" } },
      setter,
    );
    const start = w.clock.now;
    const appt = bookedIntro(w, start);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
      appointment_id: appt,
    });
    const id = made.room.id;
    await w.workerOpens(id);
    const r = w.room(id);
    w.clock.now = Date.parse(String(r.lead_by)) + 30 * S;
    w.sweepCloses(id, {
      state: "expired",
      result: "no_join",
      end_reason: "lead_no_show",
    });
    w.clock.now += 2 * MIN;
    leadOpensAfterClose(w, id);
    // 20261004a's S1 posts sweep.settle at start + settle (1200 s): the
    // cron door forwards it to room.event.
    w.clock.now = start + 1200 * S + 30 * S;
    w.db.seed("cockpit_sales_room_events", [
      {
        id: fakeUuid(),
        room_id: id,
        kind: "sweep.settle",
        source: "settle",
        dedupe_key: `sweep.settle:${id}`,
        text: "Due.",
        at: w.db.iso(),
      },
    ]);
    await w.rooms.desk["room.event"](desk, {
      kind: "sweep.settle",
      payload: { room_ids: [id] },
    });
    await w.flush();
    expect({
      noshow: marks.filter(m => m.status === "noshow").length,
      settled: w.room(id).settled_mark ?? null,
    }).toEqual({ noshow: 0, settled: expect.not.stringMatching(/^noshow$/) });
  });
});

// ---------------------------------------------------------------------------
// Journey: a closer opens the room for their booked Meet demo, joins Meet
// from the panel and talks; Meet sends no join signal
// ---------------------------------------------------------------------------

/** The closer's booked demo with Huda, on Meet, its link on the HighLevel event. */
function bookedDemo(w: World, start: number, id = "appt-r5-demo") {
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: id,
      contact_id: LEAD,
      calendar_id: "cal-demo",
      call_type: "demo",
      start_at: new Date(start).toISOString(),
      end_at: new Date(start + 60 * MIN).toISOString(),
      status: "confirmed",
      assigned_user_id: "G-closer",
    },
  ]);
  w.routes.unshift((m: string, p: string) =>
    m === "GET" && p === `/calendars/events/appointments/${id}`
      ? {
          appointment: {
            id,
            contactId: LEAD,
            calendarId: "cal-demo",
            appointmentStatus: "confirmed",
            startTime: new Date(start).toISOString(),
            endTime: new Date(start + 60 * MIN).toISOString(),
            assignedUserId: "G-closer",
            address: "https://meet.google.com/qrs-tuvw-xyz",
          },
        }
      : (null as unknown as Row),
  );
  return id;
}

describe("journey: a closer opens the room for their booked Meet demo two minutes before it, joins Meet and talks with Huda for the hour (never pressing I'm in)", () => {
  for (const shortLink of [true, false]) {
    test(`short link ${shortLink ? "on" : "off"}: once the sweep closes the room at start + 15 (the host's deadline), the panel must not tell the closer the lead did not join`, async () => {
      const w = begin({ rooms: { short_link: shortLink } }, closer);
      const start = w.clock.now + 2 * MIN;
      const appt = bookedDemo(w, start);
      const out = await R.roomsApi.wrap(appt);
      const id = out.room.id;
      expect(w.room(id).purpose).toBe("booked");
      expect(w.room(id).state).toBe("open");
      // The panel before: Open my room, with I'm in beside it (Meet sends no join signal).
      w.clock.now = start - MIN;
      const before = await panelNow(w, id);
      expect(before.keys).toContain("host_in");
      // The closer presses Open my room, joins Meet, Huda joins from the
      // calendar invite's link (never the short link), and they talk. At
      // start + 15 the sweep's R3 closes the room: the host did not join.
      w.clock.now = Date.parse(String(w.room(id).host_by)) + 40 * S;
      w.sweepCloses(id, {
        state: "expired",
        result: "no_join",
        end_reason: "host_not_in",
      });
      const p = await panelNow(w, id);
      expect(p.words).not.toMatch(/did not join in 10 minutes/);
    });
  }
});

// ---------------------------------------------------------------------------
// Journey: a closer opens the room for their booked demo 25 minutes early,
// then presses I'm available on the strip to take live leads meanwhile
// ---------------------------------------------------------------------------

describe("held (control): a closer opens their booked Meet demo's room 25 minutes before it (room.wrap), then presses I'm available", () => {
  test("the strip never tells the closer to end the booked call's room (no panel can), nor offers a Try again that is refused the same way", async () => {
    const w = begin({}, closer);
    const start = w.clock.now + 25 * MIN;
    const appt = bookedDemo(w, start);
    const out = await R.roomsApi.wrap(appt);
    const id = out.room.id;
    expect(w.room(id).purpose).toBe("booked");
    // The banner keeps a booked room out of sight until its start (myRoom),
    // so the strip is what the closer sees, with I'm available on it.
    w.presenceRow(CLOSER, {
      state: "away",
      zoom_status: "licensed",
      default_provider: "zoom",
    });
    const before = await stripNow(w);
    expect(await bannerNow(w)).toBeNull();
    expect(before.keys).toContain("available");
    const press = await R.roomsApi.availability("available");
    const said = String((press as Row).standby_error ?? "");
    w.presenceRow(CLOSER, {
      state: "available",
      until: new Date(w.clock.now + HOURS2).toISOString(),
      zoom_status: "licensed",
      default_provider: "zoom",
    });
    const s = await stripNow(w);
    // The booked room's own panel never offers End room (roomActions: booked).
    const panel = await panelNow(w, id);
    // Pressing the strip's button again, as it asks.
    const again = s.keys.includes("available")
      ? String(
          ((await R.roomsApi.availability("available")) as Row).standby_error ??
            "",
        )
      : null;
    expect({
      pressSaid: said,
      strip: s.words,
      panelCanEnd: panel.keys.includes("end"),
      tryAgainSaysSame: again !== null && again === said,
    }).toEqual({
      pressSaid: expect.not.stringMatching(/End it first/),
      strip: expect.not.stringMatching(/End it first/),
      panelCanEnd: false,
      tryAgainSaysSame: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Journey: a closer's call misses, the Zoom link goes, Huda knocks in the
// waiting room while the closer looks at the dialer, nobody lets her in
// ---------------------------------------------------------------------------

describe("journey: on the closer's dialer, a missed call, a Zoom link; Huda knocks in Zoom's waiting room and is never let in; the sweep closes the room", () => {
  test("the step under the panel does not say 'No answer' with Next lead first while the panel says to call her now", async () => {
    const w = begin({}, closer);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "demo",
      purpose: "fallback",
      trigger: "no_answer",
    });
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    w.clock.now += 3 * MIN;
    await w.leadOpens(id);
    await zoomSays(w, id, "meeting.participant_joined_waiting_room", {
      user_name: "Huda Ali",
      id: "",
    });
    expect(w.room(id).lead_waiting_at).toBeTruthy();
    // Nobody admits her: the sweep's R4 closes the room as not_admitted
    // (20261004a: expired, result admit_blocked), one grace past the knock.
    w.clock.now =
      Date.parse(String(w.room(id).lead_waiting_at)) + 3 * MIN + 10 * S;
    w.sweepCloses(id, {
      state: "expired",
      result: "admit_blocked",
      end_reason: "not_admitted",
    });
    // What the dialer pane shows: the panel (talkBelow) and, under it, the
    // step after the miss (DialerPage missStep: afterMiss with the room).
    const p = await panelNow(w, id, { talkBelow: true });
    const step = afterMiss({
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
      video: p.room,
    });
    expect(p.words).toMatch(/knocked at .* Call them now/);
    expect({ title: step.title, send: step.send }).toEqual({
      title: expect.not.stringMatching(/^No answer/),
      send: expect.anything(),
    });
  });
});

// ---------------------------------------------------------------------------
// Journey: a lead never opens the WhatsApp link; seven minutes on the setter
// presses Also send by email; the lead reads the email and taps it
// ---------------------------------------------------------------------------

describe("journey: a missed call, the Meet link goes on WhatsApp at 10:00, Huda does not open it; at 10:07 the setter presses Also send by email; Huda reads the email at 10:12 and taps the link", () => {
  test("the email's 'I'll be there for the next 10 minutes' holds: the room still waits for her at 10:12", async () => {
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
    const sentAt = Date.parse(String(w.room(id).link_sent_at));
    expect(w.room(id).link_channels).toEqual(["whatsapp_text"]);
    // 10:07: the panel offers Also send by email; the setter presses it.
    w.clock.now = sentAt + 7 * MIN;
    const p = await panelNow(w, id, { talkBelow: true });
    expect(p.keys).toContain("email");
    await R.roomsApi.sendEmail(id);
    const email = w.texts.find(t => t.channel === "email") as Row | undefined;
    expect(String(email?.body ?? email?.text ?? JSON.stringify(email))).toMatch(
      /next 10 minutes/,
    );
    const emailAt = w.clock.now;
    // When the sweep's R4 closes the room if she does not open it (20261004a:
    // lead_by; an open only holds it to the link + lead + grace, 10:13).
    const leadBy = Date.parse(String(w.room(id).lead_by));
    const cap = sentAt + (600 + 180) * S;
    // The email promised ten minutes from 10:07: the room must wait at
    // least until 10:17 when she does not open it, and an open at 10:12
    // must not find it closed.
    expect({
      closesIfUnopened_minAfterEmail: (leadBy - emailAt) / MIN,
      latestClose_minAfterEmail: (Math.max(leadBy, cap) - emailAt) / MIN,
    }).toEqual({
      closesIfUnopened_minAfterEmail: 10,
      latestClose_minAfterEmail: 10,
    });
  });

  test("the same email, sent by the tick on its own when Meta fails the WhatsApp late (8 minutes in), keeps its ten minutes", async () => {
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
    const r = w.room(id);
    const sentAt = Date.parse(String(r.link_sent_at));
    const msgId = String((r.link_message_ids as Row)?.whatsapp_text ?? "");
    expect(msgId).not.toBe("");
    // Meta's answer comes late: the message service stored it failed (131026).
    w.db.seed("cockpit_sales_messages", [
      {
        id: msgId,
        request_id: "rq-late",
        state: "failed",
        provider_status: "failed",
        error: "131026: the number is not on WhatsApp",
        body: "Hi Huda",
        created_at: new Date(sentAt).toISOString(),
      },
    ]);
    // 10:08: the SQL tick posts the room; sales-api's tick reads the failure
    // and emails the link (recheckLink), "I'll be there for the next 10 minutes".
    w.clock.now = sentAt + 8 * MIN;
    await w.rooms.desk["room.event"](desk, {
      kind: "tick",
      payload: { room_ids: [id] },
    });
    await w.flush();
    const email = w.texts.find(t => t.channel === "email") as Row | undefined;
    expect(email).toBeTruthy();
    const leadBy = Date.parse(String(w.room(id).lead_by));
    expect((leadBy - w.clock.now) / MIN).toBeGreaterThanOrEqual(10);
  });
});
