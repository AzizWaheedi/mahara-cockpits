// Stress series 2, round 6: end-to-end journeys through the cockpit's own
// press code (lib/rooms.ts roomsApi, stripLine, roomActions, the banner's
// bannerRoomSentence and myRoom, dialerUi afterMiss) and sales-api's real
// room and wave actions over the shared fakes (testfakes.ts). The browser's
// `api` is routed straight into sales-api's handlers, answered the way
// index.ts answers a seat, so what the rep sees at each step is what the two
// halves do together.
//
// bun test src/lib/stress2_journeys_r6_ui.test.ts   (from apps/sales-cockpit)
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
// Kept for the next round's journeys, as in round 5.
void afterMiss;
void closer;
void stripNow;
void bannerNow;
void leadOpensAfterClose;

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

// ---------------------------------------------------------------------------
// Round 6: the harness (src/dev/liveHarness.ts RoomStage) against sales-api
// ---------------------------------------------------------------------------

const { RoomStage, liveKnobs, liveSettings } = await import(
  "../dev/liveHarness"
);

describe("journey on the harness and on sales-api alike: a missed call, a Meet link, I'm in, The lead is in (rooms.count_on_join off, as shipped and as the harness's own settings say)", () => {
  test("the harness's panel says what sales-api's panel says once the lead is in", async () => {
    // sales-api, as shipped: count_on_join false, so a join books nothing.
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
    let p = await panelNow(w, id);
    await R.roomsApi.mark(p.room, "host_in");
    w.clock.now += MIN;
    p = await panelNow(w, id);
    await R.roomsApi.mark(p.room, "lead_in");
    const real = await panelNow(w, id);
    // The harness, with the knobs /sales/harness.html?path=/dialer&call=noanswer
    // uses: its rooms setting has no count_on_join (off).
    const k = liveKnobs(new URLSearchParams("path=/dialer&call=noanswer"));
    const settings = liveSettings(k, LEAD).find(r => r.key === "rooms")
      ?.value as Row;
    expect(settings.count_on_join ?? false).toBe(false);
    const now = w.clock.now;
    const stage = new RoomStage(k, now, LEAD);
    const asked = stage.answer(
      "room.create",
      {
        contact_id: LEAD,
        provider: "meet",
        call_kind: "intro",
        purpose: "fallback",
        trigger: "no_answer",
      },
      now,
    ) as { room: { id: string; version: number } };
    const hid = asked.room.id;
    const made3 = stage.answer(
      "room.status",
      { room_id: hid },
      now + 4 * S,
    ) as {
      room: { version: number };
    };
    const hostIn = stage.answer(
      "room.mark",
      { room_id: hid, version: made3.room.version, what: "host_in" },
      now + 5 * S,
    ) as { room: { version: number } };
    const leadIn = stage.answer(
      "room.mark",
      { room_id: hid, version: hostIn.room.version, what: "lead_in" },
      now + 6 * S,
    ) as { room: Row };
    const harness = R.sentenceText(
      R.roomSentence(R.normalizeRoom(leadIn.room) as never, {
        now: now + 6 * S,
        lineShown: true,
      }),
    );
    // sales-api: "Huda joined at 10:01." The harness: "Huda joined. Booked
    // as a live intro and marked shown." (RoomStage's lead_in mark sets
    // count_result "booked" whatever count_on_join says), so a walk through
    // the harness shows the rep a booking and a shown mark that the shipped
    // system never makes.
    expect(real.words).not.toMatch(/Booked as a live/);
    expect(harness).not.toMatch(/Booked as a live|marked shown/);
  });
});

// ---------------------------------------------------------------------------
// Round 6: a missed call to a lead in the Emirates in the setter's last hour
// ---------------------------------------------------------------------------

const VL = await import("./videoLink");
const { autoSentence } = VL;

describe("journey: 20:30 in Kuwait (21:30 in Dubai), the setter's call to a lead in the Emirates rings out, automatic mode is on", () => {
  test("the dialer does not count down 'Sending a video link in 10 s' and then offer the same two buttons the server refuses for the night every press", async () => {
    // Sunday 4 October 2026, 17:30 UTC: 20:30 Kuwait, 21:30 Dubai.
    const w = begin(
      {
        start: Date.parse("2026-10-04T17:30:00Z"),
        rooms: { fallback: { ...ROOMS_ON.fallback, auto_on_miss: true } },
      },
      setter,
    );
    w.routes.unshift((m: string, p: string) =>
      m === "GET" && p === `/contacts/${LEAD}`
        ? {
            contact: {
              id: LEAD,
              firstName: "Huda",
              name: "Huda Ali",
              phone: "+971500000000",
              email: "huda@example.com",
              tags: ["cockpit-test"],
              country: "AE",
            },
          }
        : (null as unknown as Row),
    );
    const setting = {
      ...ROOMS_ON,
      fallback: { ...ROOMS_ON.fallback, auto_on_miss: true },
    } as never;
    // DialerPage CallPane after Maqsam's record saved No answer: the gate,
    // the picker's choice and its plan line, as the pane works them out.
    // Fix round 6: the dialer passes the lead's country and the moment, so
    // the gate reads the lead's clock as room.create does.
    const gate = VL.videoLinkGate({
      setting,
      contactId: LEAD,
      seatEmail: SETTER,
      purpose: "fallback",
      bookedIntro: false,
      bookedDemo: false,
      client: false,
      dnd: false,
      country: "AE",
      now: w.clock.now,
    } as never);
    const choice = VL.providerChoice({ setting, role: "setter" });
    const plan = VL.linkPlanLine({
      setting,
      whatsapp: {
        on: true,
        dnd: false,
        reachable: true,
        window: { open: true },
      },
      email: { on: true, dnd: false, reachable: true },
      guardOpen: true,
      templateLive: true,
    });
    // Fix round 6: the gate is shut for the night, so the dialer offers no
    // link and automatic mode never counts down (DialerPage offerVideo reads
    // gate.show); the after-miss step says NIGHT_LINE where the button was.
    expect(gate).toEqual({ show: false, why: "lead_night" });
    expect(VL.NIGHT_LINE).toMatch(/night where they are/);
    expect(choice?.first).toBe("meet");
    const counting =
      gate.show && plan !== VL.PICKER_NONE ? autoSentence("Huda", 10) : null;
    // The ten seconds run out: autoSend asks for the room, sales-api refuses
    // it for the night on the lead's clock; the picker opens with that
    // sentence under its two buttons, Send a Meet link (teal) and Use Zoom
    // instead. The setter presses each.
    // Pressed anyway (a picker opened before the hour turned): the server
    // refuses for the night, and the picker then offers no send button
    // (VideoPicker reads pickerSends), so the same press is never offered
    // again.
    const presses: string[] = [];
    let code: string | null = null;
    for (const provider of ["meet", "meet", "zoom"] as const) {
      if (!VL.pickerSends(code)) break;
      try {
        await R.roomsApi.create({
          contact_id: LEAD,
          provider,
          call_kind: "intro",
          purpose: "fallback",
          trigger: "no_answer",
        });
        presses.push("made");
      } catch (e) {
        code = R.refusalCode(e);
        presses.push(code ?? R.errorText(e));
      }
    }
    // What the setter met: a countdown promising a link, then three presses
    // refused with the same night sentence while the teal Send a Meet link
    // stays on screen (videoLinkGate, linkPlanLine and VideoPicker never
    // read the lead's clock; only room.create does).
    expect({
      countdownPromised: counting,
      presses,
    }).toEqual({
      countdownPromised: null,
      // One refusal at most, then no button offers the same press again.
      presses: ["lead_night"],
    });
  });
});
