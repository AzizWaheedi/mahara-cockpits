// Stress series 2, round 2: end-to-end journeys through the cockpit's own
// press code (lib/rooms.ts roomsApi, stripLine, roomActions, the banner's
// bannerRoomSentence and bannerRoomAction) and sales-api's real room actions
// (supabase/functions/sales-api/rooms.ts) over the shared fakes
// (testfakes.ts). The browser's `api` is routed straight into sales-api's
// handlers, answered the way index.ts answers a seat, so what the rep sees at
// each step is what the two halves do together. The SQL sweep's closes are
// written onto the rows the way 20261004a writes them.
//
// bun test src/lib/stress2_journeys_r2_ui.test.ts   (from apps/sales-cockpit)
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

// ---------------------------------------------------------------------------
// Journey: a closer on Zoom goes Available and joins the standby room
// ---------------------------------------------------------------------------

describe("journey: a licensed Zoom closer presses I'm available, joins, and Zoom's join event never lands", () => {
  test("the strip must offer the rep's own I'm in after 30 s of Zoom silence, as every other Zoom room does (build brief: manual buttons after 30 s)", async () => {
    const w = begin({}, closer);
    await R.roomsApi.availability("available");
    const sb = w.db
      .t("cockpit_sales_rooms")
      .find((r: Row) => r.purpose === "standby") as Row;
    expect(sb?.provider).toBe("zoom");
    await w.workerOpens(String(sb.id), ZOOM_URL);
    w.presenceRow(CLOSER, {
      state: "available",
      until: new Date(w.clock.now + 2 * 3_600_000).toISOString(),
      zoom_status: "licensed",
      default_provider: "zoom",
    });
    // Join my room: the host link opens; the closer sits in their Zoom room.
    const opened = await R.roomsApi.open(String(sb.id));
    expect(opened.start_url).toBeTruthy();
    // A minute of Zoom silence (the door down, Zoom's webhook late): the
    // participant_joined for the host never reached sales-api.
    w.clock.now += 60 * S;
    const s = await stripNow(w);
    // "Available until 12:00. Join your room to get leads first." [Join my
    // room] [Set me away]: no press says the closer is in, so the seat never
    // becomes Ready, while a lead's Zoom room offers I'm in after 30 s.
    expect(s.words).toMatch(/Join your room to get leads first/);
    expect(s.keys).toContain("host_in");
  });

  test("after the sweep closes it (nobody in by host_by), the strip must not tell a Zoom closer to press an I'm in no Zoom strip shows", async () => {
    const w = begin({}, closer);
    await R.roomsApi.availability("available");
    const sb = w.db
      .t("cockpit_sales_rooms")
      .find((r: Row) => r.purpose === "standby") as Row;
    await w.workerOpens(String(sb.id), ZOOM_URL);
    await R.roomsApi.open(String(sb.id));
    // R3 at host_by (opened + standby_host, 5 minutes): expired host_not_in.
    w.clock.now = Date.parse(String(w.room(String(sb.id)).host_by)) + 61 * S;
    w.sweepCloses(String(sb.id), {
      state: "expired",
      result: null,
      end_reason: "host_not_in",
    });
    w.presenceRow(CLOSER, {
      state: "available",
      until: new Date(w.clock.now + 3_600_000).toISOString(),
      zoom_status: "licensed",
      default_provider: "zoom",
    });
    const s = await stripNow(w);
    expect(s.line.moment).toBe("standby_failed");
    // Said: "Your last standby room closed at 10:06 because nobody pressed
    // I'm in. Press Try again, then I'm in once you are in the room." Then
    // Try again makes a fresh Zoom room, whose strip again offers only Join
    // my room and Set me away: the button the sentence names is never there.
    const said = s.words;
    await R.roomsApi.availability("available");
    const fresh = w.db
      .t("cockpit_sales_rooms")
      .find((r: Row) => r.purpose === "standby" && r.id !== sb.id) as Row;
    expect(fresh?.provider).toBe("zoom");
    await w.workerOpens(String(fresh.id), ZOOM_URL);
    w.clock.now += 60 * S;
    const after = await stripNow(w);
    const namesImIn = /I'm in/.test(said);
    expect({
      said,
      namesImIn,
      offersImIn: after.keys.includes("host_in"),
    }).toEqual({
      said,
      namesImIn,
      offersImIn: namesImIn,
    });
  });
});

// ---------------------------------------------------------------------------
// Journey: a setter sends a Meet link, moves on, and the lead opens it
// ---------------------------------------------------------------------------

describe("journey: a missed call, a Meet link, the setter moves to the next lead, the lead opens the link", () => {
  test("the banner (the only place the room shows now) must lead the setter to I'm in and The lead is in, not only reopen Meet", async () => {
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
    expect(w.texts).toHaveLength(1);
    // The setter presses Next lead: lead A's panel is gone; the banner shows the room.
    w.clock.now += 3 * MIN;
    await w.leadOpens(id);
    const b1 = await bannerNow(w);
    expect(b1?.words).toBe("Huda opened the link.");
    expect(b1?.action.key).toBe("open_room");
    // The banner's one button: Open my room (room.open, the Meet link).
    const opened = await R.roomsApi.open(id);
    expect(opened.start_url).toBe(MEET_URL);
    // The setter is in the Meet and lets Huda in. Meet sends no signal, so
    // the room is still open, and the banner says and offers the same thing
    // on every read: "Huda opened the link." [Open my room].
    w.clock.now += 2 * MIN;
    const b2 = await bannerNow(w);
    const trail: string[] = [];
    trail.push(`${b2?.words} [${b2?.action.label}]`);
    // The sweep (R4) closes it at lead_by, held one open grace: while the two
    // are talking, the room expires, and the lead's page says she did not join.
    const r = w.room(id);
    w.clock.now = Date.parse(String(r.lead_by)) + 4 * MIN;
    w.sweepCloses(id, {
      state: "expired",
      result: "no_join",
      end_reason: "lead_not_in",
    });
    const p = await panelNow(w, id);
    trail.push(p.words);
    // Every banner read while the call ran offered only "Open my room": no
    // way from the banner to "I'm in" or "The lead is in" (or to the lead's
    // page, where they are), so the room ends "did not join".
    expect(b2?.action.key).toBe("open_lead");
    expect(p.words).not.toMatch(/did not join/);
  });
});

// ---------------------------------------------------------------------------
// Journey: an Away seat, ten minutes before a booked call
// ---------------------------------------------------------------------------

describe("journey: a setter who is Away has a booked intro in 8 minutes (live on)", () => {
  test("the strip must not say 'your room is closed' to a seat that never had a room", async () => {
    const w = begin({}, setter);
    // The view (20261004a): booked_soon comes before 'not avail', so an Away
    // seat with a call inside booked_guard gets reason booked_call_soon.
    w.presenceRow(SETTER, {
      state: "away",
      reason: "booked_call_soon",
      booked_at: new Date(w.clock.now + 8 * MIN).toISOString(),
      booked_kind: "intro",
      zoom_status: "pending",
    });
    const s = await stripNow(w);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
    // "Your booked intro starts at 10:08, so your room is closed. Press I'm
    // available after it." to a setter who never pressed I'm available today.
    expect(s.words).not.toMatch(/your room is closed/);
  });
});

// ---------------------------------------------------------------------------
// Journey: a closer presses I'm available four minutes before live calls end
// ---------------------------------------------------------------------------

describe("journey: a closer presses I'm available at 19:56 (live calls end at 20:00)", () => {
  test("the strip's one button must not be a Try again that is refused the same way", async () => {
    // Sunday 19:56 Kuwait.
    const w = begin({ start: Date.parse("2026-10-04T16:56:00Z") }, closer);
    await R.roomsApi.availability("available");
    w.presenceRow(CLOSER, {
      state: "available",
      until: "2026-10-04T17:00:00.000Z",
      zoom_status: "licensed",
      default_provider: "zoom",
    });
    const first = await stripNow(w);
    expect(first.line.moment).toBe("standby_failed");
    // (Before fix round 2 the strip's one button here was Try again, the
    // same press refused the same way; the assertion pinning that is gone.)
    // A press again (another tab, or the strip before it read the refusal).
    await R.roomsApi.availability("available");
    const again = await stripNow(w);
    // Same refusal, same sentence, same Try again, until 20:00:
    // "Your room was not made. Live calls end in under 5 minutes, so no
    // standby room was made. You can still take a live lead until then. Try
    // again, or set yourself away."
    expect(again.words).toBe(first.words);
    expect(first.words).not.toMatch(/Try again/);
    expect(first.line.primary?.key).not.toBe("available");
  });
});

// ---------------------------------------------------------------------------
// Journey: the fourth link in an hour after a missed call
// ---------------------------------------------------------------------------

describe("journey: a setter calls a lead four times in an hour, each a miss, and sends a video link each time", () => {
  test("the fourth press must not make a room whose link cannot go and tell the rep to read it out on a call that was not answered", async () => {
    const w = begin({}, setter);
    // Three links this hour, each room expired with nobody in.
    for (let i = 0; i < 3; i++) {
      const made = await R.roomsApi.create({
        contact_id: LEAD,
        provider: "meet",
        call_kind: "intro",
        purpose: "fallback",
        trigger: "no_answer",
      });
      await w.workerOpens(made.room.id);
      w.clock.now += 14 * MIN;
      w.sweepCloses(made.room.id, {
        state: "expired",
        result: "no_join",
        end_reason: "lead_not_in",
      });
      w.clock.now += MIN;
    }
    expect(w.texts).toHaveLength(3);
    // The fourth miss: the dialer offers Send a video link again; the picker
    // says "The lead gets the link on WhatsApp." The press:
    // Before fix round 2 a Meet meeting was made on the seat's Google, the
    // lead held out of the queue for 15 minutes, and the panel said "Not
    // sent: ... Read the code out on the phone." after a call nobody
    // answered. Now room.create refuses the fourth room with a next step
    // that needs no connected call, and no meeting is made.
    let refusal = "";
    try {
      await R.roomsApi.create({
        contact_id: LEAD,
        provider: "meet",
        call_kind: "intro",
        purpose: "fallback",
        trigger: "no_answer",
      });
    } catch (e) {
      refusal = String((e as Error).message);
    }
    expect(w.texts).toHaveLength(3);
    expect(refusal).toBe(
      "This lead has had three call links this hour, so no new room was made. Call them again later.",
    );
    expect(refusal).not.toMatch(/on the phone/);
  });
});

// ---------------------------------------------------------------------------
// Journey: the dialer's step after a miss, once the video link went on WhatsApp
// ---------------------------------------------------------------------------

describe("journey: a missed call, then the video link goes on WhatsApp", () => {
  test("the after-miss step must not still ask the setter to send the missed-call WhatsApp", async () => {
    const w = begin({}, setter);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    await w.workerOpens(made.room.id);
    // The link went as WhatsApp text: "Hi Huda, it's Tara from Mahara Media.
    // I tried to call you just now and couldn't get through. ... {link}"
    expect(w.texts).toHaveLength(1);
    const p = await panelNow(w, made.room.id);
    expect(p.words).toMatch(/^Link sent on WhatsApp at /);
    // DialerPage CallPane: mode "unanswered" and no join yet, so it draws
    // AfterMissStep with step = missStep(...) = afterMiss(...), which knows
    // nothing of the room: the step under the panel reads
    // Since fix round 2 the dialer passes the lead's room to afterMiss
    // (DialerPage missStep), so the step can see the link went.
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
    // "No answer. Send them a WhatsApp?" "A WhatsApp right after a missed call
    // gets answered far more often than an email. The missed-call message is
    // ready in the box; read it, then send." [Next lead] [WhatsApp them]:
    // a second "I tried to call you" WhatsApp a minute after the first.
    expect({ title: step.title, send: step.send }).not.toEqual({
      title: "No answer. Send them a WhatsApp?",
      send: "whatsapp",
    });
  });
});

// ---------------------------------------------------------------------------
// Journey: a missed call, a video link, then the lead calls back on the phone
// ---------------------------------------------------------------------------

describe("journey: a missed call and a Meet link, then the setter and the lead talk on the phone", () => {
  test("after We are on the phone, the dialer must not go back to 'No answer. Send them a WhatsApp?' and offer another video link", async () => {
    const w = begin({}, setter);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    await w.workerOpens(made.room.id);
    let p = await panelNow(w, made.room.id);
    expect(p.keys).toContain("on_phone");
    // The lead rings back; the setter presses We are on the phone.
    const out = await R.roomsApi.end(p.room, "on_phone");
    p = await panelNow(w, made.room.id);
    expect(p.words).toMatch(/^Moved to the phone at /);
    // DialerPage CallPane decides its step from videoJoinedAt(video.room)
    // alone: null here, so with mode "unanswered" it draws AfterMissStep
    // ("No answer. Send them a WhatsApp?" with the missed-call message ready
    // and [WhatsApp them]) and, the room being final, offerVideo is true
    // again: [Send a video link]. (The browser harness shows the same after
    // the expired panel's "We spoke on the phone": "Marked showed." over
    // "No answer. Send them a WhatsApp?".) The lead is on the phone with the
    // setter; the screen's next step is a missed-call message and a new link.
    // Since fix round 2 the dialer reads "we spoke" from R.spokeAt (the room
    // moved to the phone) beside R.videoJoinedAt, and draws the call's own
    // question instead of the missed-call step.
    const spoke = R.spokeAt(out.room) ?? R.videoJoinedAt(out.room);
    expect({ result: out.room.result, spokeSignal: spoke !== null }).toEqual({
      result: "moved_to_phone",
      spokeSignal: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Journey: the setter's link is out; a closer opens the same lead's page
// ---------------------------------------------------------------------------

describe("journey: a setter sent a lead a video link; a closer on that lead's page sends one too", () => {
  test("the refusal must not tell the closer to open a room only its host can open (and that no screen of theirs shows)", async () => {
    const w = begin({}, setter);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    await w.workerOpens(made.room.id);
    // The closer, on /lead/{LEAD}: the Video call menu offers Send a video link
    // (useLeadRoom lists only the closer's own rooms, so no panel shows).
    actor = closer;
    R.forgetRequests();
    const mine = await R.roomsApi.liveStatus();
    expect(roomForLead(mine.rooms, LEAD)).toBeNull();
    let said = "";
    try {
      await R.roomsApi.create({
        contact_id: LEAD,
        provider: "zoom",
        call_kind: "intro",
        purpose: "manual",
        trigger: "manual",
      });
    } catch (e) {
      said = (e as Error).message;
    }
    // "Open it.": the closer has no panel for it, and room.open refuses them.
    let open = "";
    try {
      await R.roomsApi.open(made.room.id);
    } catch (e) {
      open = (e as Error).message;
    }
    expect(open).toMatch(/belongs to/);
    expect(said).not.toMatch(/Open it\.$/);
  });
});

// ---------------------------------------------------------------------------
// Journey: the lead opens the link (or knocks), the setter presses End room
// ---------------------------------------------------------------------------

describe("journey: the setter's intro call misses, the lead opens the Meet link, the setter talks to them and presses End room", () => {
  test("the panel must not say nobody joined, nor offer No-show, for a lead who opened the link", async () => {
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
    w.clock.now += 2 * MIN;
    await w.leadOpens(id);
    // The setter opens Meet, lets Huda in and talks (no press: Meet sends no
    // signal). Afterwards the open room's quiet buttons hold no Finished, so
    // the setter presses End room (DialerPage passes onMarkIntro on the intro).
    w.clock.now += 6 * MIN;
    let p = await panelNow(w, id, { canMarkIntro: true });
    expect(p.keys).toContain("end");
    expect(p.keys).not.toContain("finished");
    await R.roomsApi.end(p.room, "end");
    p = await panelNow(w, id, { canMarkIntro: true });
    // "Room ended at 10:10. Nobody joined. Mark the intro:" [No-show] [We
    // spoke on the phone], under a room line whose Opened step is done. An
    // expired room in the same state says "opened the link but did not join"
    // and never offers No-show (stress2 round 1); an ended one still does, and
    // a No-show press starts HighLevel's no-show messages to a lead who came.
    expect(p.room.first_open_at).toBeTruthy();
    expect({ words: p.words, noShow: p.keys.includes("noshow") }).toEqual({
      words: expect.not.stringMatching(/Nobody joined/),
      noShow: false,
    });
  });

  test("Zoom: a lead who knocked in the waiting room, then the room is ended by hand, is never 'Nobody joined' with No-show", async () => {
    const w = begin({}, closer);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    const id = made.room.id;
    await w.workerOpens(id, "https://us06web.zoom.us/j/81234567890?pwd=x");
    w.clock.now += 2 * MIN;
    // Zoom's participant_joined_waiting_room, applied by sales-api.
    Object.assign(w.room(id), {
      lead_waiting_at: w.db.iso(),
      version: Number(w.room(id).version) + 1,
    });
    w.clock.now += MIN;
    let p = await panelNow(w, id, { canMarkIntro: true });
    expect(p.moment).toBe("waiting_room");
    await R.roomsApi.end(p.room, "end");
    p = await panelNow(w, id, { canMarkIntro: true });
    expect({ words: p.words, noShow: p.keys.includes("noshow") }).toEqual({
      words: expect.not.stringMatching(/Nobody joined/),
      noShow: false,
    });
  });
});
