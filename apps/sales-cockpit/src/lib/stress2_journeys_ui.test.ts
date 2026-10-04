// Stress series 2, round 1: end-to-end journeys through the cockpit's own
// press code (lib/rooms.ts roomsApi, stripLine, roomActions) and sales-api's
// real room actions (supabase/functions/sales-api/rooms.ts) over the shared
// fakes (testfakes.ts). The browser's `api` is routed straight into
// sales-api's handlers, wrapped the way index.ts answers a seat, so what the
// rep sees at each step is what the two halves do together.
//
// bun test src/lib/stress2_journeys_ui.test.ts   (from apps/sales-cockpit)
//
// Fix round 1: each journey's last expectation is what the fix holds; where
// a fix changed the journey itself (a press now refused, or a room made),
// the steps say what happens now.

import { describe, expect, mock, test } from "bun:test";

// The Supabase client needs the build's settings; nothing here reaches it.
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

// ---------------------------------------------------------------------------
// The bridge: the browser's api() is sales-api's handler, answered as index.ts does
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// The world: one setter, one closer, one test lead
// ---------------------------------------------------------------------------

const S = 1000;
const MIN = 60 * S;
const CLOSER = "closer@maharamedia.com";
const SETTER = "setter@maharamedia.com";
const LEAD = "VjPfR4Cc1Y0OFvaqeor5";
const MEET_URL = "https://meet.google.com/abc-defg-hij";

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
      // As the build brief has it: the setter's Zoom is Basic and pending; Meet is theirs.
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
  /** The view cockpit_sales_presence, as the database would compute it for this seat now. */
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
  return {
    ...w,
    rooms,
    audits,
    texts,
    room,
    workerOpens,
    leadOpens,
    presenceRow,
  };
}

function begin(o: Opts = {}, who: Row = setter): World {
  const w = setup(o);
  world = w;
  actor = who;
  calls.length = 0;
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
  });
  return { data, line, words: R.sentenceText(line.sentence) };
}

/** What the room panel says and offers for a room as room.status serves it. */
async function panelNow(w: World, id: string) {
  const feed = await R.roomsApi.status(id);
  // As RoomPanel builds it: room.status's other_ok says whether the host can
  // use the other provider now (fix round 1).
  const ctx = {
    now: w.clock.now,
    lineShown: true,
    otherOk: feed.other_ok ?? null,
  };
  const acts = R.roomActions(feed.room, ctx);
  return {
    room: feed.room,
    moment: R.momentFor(feed.room, ctx),
    words: R.sentenceText(R.roomSentence(feed.room, ctx)),
    primary: acts.primary?.key ?? null,
    keys: [acts.primary?.key, ...acts.quiet.map(a => a.key)].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Journey: the closer goes Available, outside live hours
// ---------------------------------------------------------------------------

describe("journey: a closer presses I'm available", () => {
  test("outside live hours: the strip must say when live calls run, not show Away again with the same button", async () => {
    // Sunday 21:00 Kuwait: after the 10:00 to 20:00 window.
    const w = begin({ start: Date.parse("2026-10-04T18:00:00Z") }, closer);
    const before = await stripNow(w);
    expect(before.line.primary?.key).toBe("available");
    // The press, as SalesBanner's onAction("available") makes it.
    const out = await R.roomsApi.availability("available");
    // sales-api did say why (live.availability's standby_error) ...
    const served = calls.find(c => c.action === "live.availability")?.answer;
    expect(String(served?.standby_error ?? "")).toMatch(/^Live calls run /);
    expect(out.me.state).toBe("away");
    // ... and the browser kept only `me`, so the strip after the press (and
    // after every read since) is the same Away line with the same button.
    const after = await stripNow(w);
    expect(after.words).toMatch(/Live calls run/);
  });

  test("Available with no standby room made (the host cannot host on either provider): the strip must say why", async () => {
    const w = begin(
      {
        hosts: [
          // Zoom not on Mahara's account and the worker's Google down.
          {
            email: CLOSER,
            zoom_user_id: null,
            zoom_status: "missing",
            google_ok: false,
            google_checked: true,
          },
        ],
      },
      closer,
    );
    await R.roomsApi.availability("available");
    const served = calls.find(c => c.action === "live.availability")?.answer;
    expect(String(served?.standby_error ?? "")).not.toBe("");
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
    // The view: Available, no room.
    w.presenceRow(CLOSER, {
      state: "available",
      until: new Date(w.clock.now + 2 * 3_600_000).toISOString(),
      zoom_status: "missing",
    });
    const after = await stripNow(w);
    // The server's sentence ("Meet rooms are down until the CEO reconnects
    // Google ...") never reaches the strip: it says only "Available until 12:00."
    expect(after.words).toContain(String(served?.standby_error));
  });
});

// ---------------------------------------------------------------------------
// Journey: a seat whose standby room is on Meet
// ---------------------------------------------------------------------------

describe("journey: a setter goes Available and gets a Meet standby room", () => {
  test("after Join my room there must be a press that says the rep is in (Meet sends no join signal)", async () => {
    const w = begin({}, setter);
    await R.roomsApi.availability("available");
    const sb = w.db
      .t("cockpit_sales_rooms")
      .find((r: Row) => r.purpose === "standby") as Row;
    expect(sb?.provider).toBe("meet");
    await w.workerOpens(String(sb.id));
    w.presenceRow(SETTER, {
      state: "available",
      until: new Date(w.clock.now + 2 * 3_600_000).toISOString(),
      zoom_status: "pending",
      default_provider: "meet",
    });
    const s1 = await stripNow(w);
    expect(s1.line.primary?.key).toBe("join");
    // Join my room: room.open hands the Meet link; nothing marks the host in.
    const opened = await R.roomsApi.open(String(sb.id));
    expect(opened.start_url).toBe(MEET_URL);
    expect(w.room(String(sb.id)).state).toBe("open");
    // The rep is sitting in the Meet. Every surface that shows this room:
    const s2 = await stripNow(w);
    const panelKeys = (await panelNow(w, String(sb.id))).keys;
    const offered = new Set<string>([
      ...(s2.line.primary ? [s2.line.primary.key] : []),
      ...s2.line.quiet.map(a => a.key),
      ...panelKeys,
    ]);
    // Only "join"/"open" (room.open again) and "away": none moves the room to
    // host_in, so the seat never becomes Ready, and the strip keeps saying
    // "Join your room to get leads first." to a rep who is in it.
    expect(offered.has("host_in")).toBe(true);
  });

  test("the sweep then closes the Meet standby room the rep is sitting in, and the strip says nothing about it", async () => {
    const w = begin({}, setter);
    await R.roomsApi.availability("available");
    const sb = w.db
      .t("cockpit_sales_rooms")
      .find((r: Row) => r.purpose === "standby") as Row;
    await w.workerOpens(String(sb.id));
    await R.roomsApi.open(String(sb.id));
    // R3 (host_not_in) at host_by: the rep pressed Join my room, but no press said they were in.
    w.clock.now = Date.parse(String(w.room(String(sb.id)).host_by)) + 61 * S;
    Object.assign(w.room(String(sb.id)), {
      state: "expired",
      result: null,
      end_reason: "host_not_in",
      ended_at: w.db.iso(),
      version: Number(w.room(String(sb.id)).version) + 1,
    });
    w.presenceRow(SETTER, {
      state: "available",
      until: new Date(w.clock.now + 3_600_000).toISOString(),
      zoom_status: "pending",
      default_provider: "meet",
    });
    const s = await stripNow(w);
    // "Available until 12:06." with Set me away only: no word that the room
    // closed, no way to get a room again but Away then Available (which the
    // ten-minute standby cap then refuses).
    expect(s.words).not.toMatch(/^Available until \d\d:\d\d\.$/);
  });
});

// ---------------------------------------------------------------------------
// Journey: a setter's Meet room, the lead knocks, "I can't let them in"
// ---------------------------------------------------------------------------

describe("journey: a missed call, a Meet link, the lead knocks and the setter cannot let them in", () => {
  test("with the setter's Zoom pending, the lead's room must not be closed for a Zoom room that cannot be made", async () => {
    const w = begin({}, setter);
    // The dialer after a missed call: P1's picker, Send a Meet link.
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
    // The setter is in the Meet (I'm in), the lead opens the link and knocks.
    let p = await panelNow(w, id);
    await R.roomsApi.mark(p.room, "host_in");
    await w.leadOpens(id);
    p = await panelNow(w, id);
    expect(p.moment).toBe("host_in_opened");
    // Fix round 1: the seat cannot use Zoom, so the panel does not offer
    // "I can't let them in" for this fallback Meet room ...
    expect(p.keys).not.toContain("admit_blocked");
    // ... and a press from a panel read earlier (or another tab) is refused
    // before anything moves: the lead's Meet room stays open.
    let said: string | null = null;
    try {
      await R.roomsApi.end(p.room, "admit_blocked");
    } catch (e) {
      said = (e as Error).message;
    }
    expect(said).toMatch(/^Zoom cannot be used from your seat yet/);
    const live = w.db
      .t("cockpit_sales_rooms")
      .filter(
        (r: Row) =>
          r.contact_id === LEAD &&
          !["ended", "expired", "failed", "cancelled"].includes(
            String(r.state),
          ),
      );
    expect(live).toHaveLength(1);
  });

  test("what the setter is told after it: the panel says the lead can move to Zoom and offers Try Zoom, which is refused the same way every press", async () => {
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
    await w.leadOpens(id);
    p = await panelNow(w, id);
    let refused = "";
    try {
      await R.roomsApi.end(p.room, "admit_blocked");
    } catch (e) {
      refused = (e as Error).message;
    }
    const after = await panelNow(w, id);
    // The panel's sentence and the notice under it, as RoomPanel shows them.
    const said = `${after.words} ${refused}`;
    // Before the fix: "Closed at 07:00 so the lead can move to Zoom. Your
    // Zoom seat is not active yet. Accept Zoom's email invite. Meet works
    // now.", and a Try Zoom refused the same way on every press.
    expect(said).not.toMatch(/Meet works now/);
    expect(said).not.toMatch(/so the lead can move to Zoom/);
    // The room is as it was, and the rep is told the real next step.
    expect(after.moment).toBe("host_in_opened");
    expect(after.keys).not.toContain("retry");
    expect(refused).toMatch(
      /Keep trying to let them in on Meet, or call the lead now\.$/,
    );
  });
});

// ---------------------------------------------------------------------------
// Journey: the setter's confirmation call (the evening before the intro) rings out
// ---------------------------------------------------------------------------

const { videoLinkGate, readRoomsSetting, videoAppointmentId } = await import(
  "./videoLink"
);
const { createAsk } = await import("../components/VideoLink");

describe("journey: a confirmation call for a booked intro rings out", () => {
  test("with fallback.scope 'intro' as shipped, the dialer shows Send a video link and the press must make the room", async () => {
    const w = begin(
      {
        rooms: {
          fallback: {
            scope: "intro",
            auto_on_miss: false,
            pilot_emails: [],
            ended_page_whatsapp: null,
          },
        },
      },
      setter,
    );
    // The intro is tomorrow at 10:00 Kuwait, booked with this setter.
    const apptId = "appt-intro-tomorrow";
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: apptId,
        contact_id: LEAD,
        call_type: "intro",
        status: "confirmed",
        start_at: new Date(w.clock.now + 24 * 3_600_000).toISOString(),
        assigned_user_id: "G-setter",
        calendar_id: "cal-intro",
      },
    ]);
    // DialerPage CallPane, item kind "confirm" for that intro.
    const kind = "confirm" as string;
    const appt = { id: apptId, type: "intro" as const };
    const bookedIntro =
      (kind === "intro" || kind === "confirm") && appt.type === "intro";
    const setting = readRoomsSetting(
      (
        w.db
          .t("cockpit_sales_settings")
          .find((r: Row) => r.key === "rooms") as Row
      ).value,
    );
    const gate = videoLinkGate({
      setting,
      contactId: LEAD,
      seatEmail: SETTER,
      purpose: "fallback",
      bookedIntro,
    });
    // The button shows (and automatic mode would count down and press it) ...
    expect(gate.show).toBe(true);
    // ... with the ask CallPane builds (videoAsk): since fix round 1 the
    // intro goes on its confirmation call too (videoAppointmentId).
    const ask = createAsk(
      {
        contactId: LEAD,
        purpose: "fallback",
        callKind: "intro",
        trigger: "no_answer",
        attemptId: null,
        appointmentId: videoAppointmentId(kind, appt),
      },
      "meet",
    );
    let said: string | null = null;
    try {
      await R.roomsApi.create(ask);
    } catch (e) {
      said = (e as Error).message;
    }
    // Before the fix sales-api read "a booked intro" only from the
    // appointment it was sent, so every press was refused: "For now, video
    // links after a missed call are only for booked intros."
    expect(said).toBeNull();
    // The room is a plain room: tomorrow's intro is outside its window.
    const made = w.db
      .t("cockpit_sales_rooms")
      .find((r: Row) => r.contact_id === LEAD) as Row;
    expect(made.appointment_id ?? null).toBeNull();
  });

  test("control: the same press with the intro sent makes a plain room (sales-api leaves a confirmation call's room off the intro)", async () => {
    const w = begin(
      {
        rooms: {
          fallback: {
            scope: "intro",
            auto_on_miss: false,
            pilot_emails: [],
            ended_page_whatsapp: null,
          },
        },
      },
      setter,
    );
    const apptId = "appt-intro-tomorrow";
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: apptId,
        contact_id: LEAD,
        call_type: "intro",
        status: "confirmed",
        start_at: new Date(w.clock.now + 24 * 3_600_000).toISOString(),
        assigned_user_id: "G-setter",
        calendar_id: "cal-intro",
      },
    ]);
    const out = await R.roomsApi.create(
      createAsk(
        {
          contactId: LEAD,
          purpose: "fallback",
          callKind: "intro",
          trigger: "no_answer",
          attemptId: null,
          appointmentId: apptId,
        },
        "meet",
      ),
    );
    // Made, and not carrying tomorrow's intro (introNow is false): no settle, no mark.
    expect(out.room.appointment_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Journey: a closer's standby room closes for their booked demo
// ---------------------------------------------------------------------------

describe("journey: Available, then a booked demo, then after it", () => {
  test("the strip says 'Press I'm available after it', and after the demo there must be that button (or a room again)", () => {
    const F_NOW = Date.parse("2026-10-04T10:50:00Z");
    const until = new Date(F_NOW + 90 * MIN).toISOString();
    const health = {
      worker_ok: true,
      last_run_at: new Date(F_NOW).toISOString(),
      rooms_today: 3,
      failed_today: 0,
      line: "Rooms: working.",
    };
    const me = (over: Row) =>
      ({
        email: CLOSER,
        state: "available",
        until,
        room_id: null,
        zoom_status: "licensed",
        default_provider: "zoom",
        reason: null,
        booked_at: null,
        booked_kind: null,
        ...over,
      }) as never;
    // 13:50 Kuwait: R6 closed the standby room; the view says away, booked_call_soon.
    const before = R.stripLine({
      me: me({
        state: "away",
        reason: "booked_call_soon",
        booked_at: new Date(F_NOW + 10 * MIN).toISOString(),
        booked_kind: "demo",
      }),
      rooms: [],
      offers: [],
      health: health as never,
      now: F_NOW,
      flash: null,
    });
    expect(R.sentenceText(before.sentence)).toBe(
      "Your booked demo starts at 14:00, so your room is closed. Press I'm available after it.",
    );
    expect(before.primary).toBeNull();
    // 15:01: the demo is over; Available has not run out (16:20), so the view
    // says available, with no standby room (nothing makes one again).
    const after = R.stripLine({
      me: me({}),
      rooms: [],
      offers: [],
      health: health as never,
      now: F_NOW + 71 * MIN,
      flash: null,
    });
    const keys = [after.primary?.key, ...after.quiet.map(a => a.key)];
    // "Available until 16:20." and Set me away: no I'm available to press,
    // no Join my room, so the closer can never be Ready again without going
    // Away first.
    expect(keys).toContain("available");
  });
});

// ---------------------------------------------------------------------------
// Journey: the lead knocks in Zoom's waiting room and is never let in
// ---------------------------------------------------------------------------

const RF = await import("../dev/roomFixtures");

describe("journey: the lead opens the link and knocks, the rep never lets them in, the sweep closes the room", () => {
  // The sweep's R4 for a knock (20261003d): state expired, end_reason
  // not_admitted, result admit_blocked ("Closed: the lead knocked but was not
  // let in." goes only to the timeline). The settle never marks such a room
  // a no-show (roomlogic settleWanted).
  const NOW = Date.parse("2026-10-08T11:14:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const knocked = RF.baseRoom(NOW, {
    provider: "zoom",
    join_url: "https://us06web.zoom.us/j/81234567890",
    state: "expired",
    version: 6,
    link_channels: ["whatsapp_text"],
    link_sent_at: iso(NOW - 14 * MIN),
    first_open_at: iso(NOW - 9 * MIN),
    open_device: "phone",
    lead_waiting_at: iso(NOW - 8 * MIN),
    host_in_at: null,
    lead_by: iso(NOW - 4 * MIN),
    ended_at: iso(NOW - MIN),
    result: "admit_blocked",
    appointment_id: "appt-intro",
  });

  test("on the dialer's intro call: the panel must not say nobody joined, nor offer No-show for a lead who knocked", () => {
    const ctx = { now: NOW, canMarkIntro: true, lineShown: true };
    const said = R.sentenceText(R.roomSentence(knocked, ctx));
    const keys = R.roomActions(knocked, ctx).quiet.map(a => a.key);
    // "Nobody joined in 10 minutes. The room is closed. Mark the intro:"
    // [No-show] [We spoke on the phone], under a room line whose Opened step
    // is done: a No-show press here marks a lead who was knocking (and is
    // not quiet, so HighLevel's no-show automation writes to them).
    expect({ said, noShow: keys.includes("noshow") }).toEqual({
      said: expect.not.stringMatching(/Nobody joined|did not join/),
      noShow: false,
    });
  });

  test("anywhere else: the sentence must say the lead knocked and was not let in, with a next step for that", () => {
    const said = R.sentenceText(
      R.roomSentence(knocked, { now: NOW, lineShown: true }),
    );
    // "The lead did not join in 10 minutes. Room closed. Call again or send a message."
    expect(said).toMatch(/knock|let in|waiting room/i);
  });
});

// ---------------------------------------------------------------------------
// Journey: an Available closer (standby room open) sends a lead a video link
// ---------------------------------------------------------------------------

describe("journey: a closer is Available with a standby room and wants to send a lead a video link", () => {
  test("the refusal must name the standby room and how to free it, not 'the lead you sent it to'", async () => {
    const w = begin({}, closer);
    await R.roomsApi.availability("available");
    const sb = w.db
      .t("cockpit_sales_rooms")
      .find((r: Row) => r.purpose === "standby") as Row;
    await w.workerOpens(
      String(sb.id),
      "https://us06web.zoom.us/j/85550000001?pwd=sb",
    );
    // The lead page's "Send a video link" (purpose manual), Zoom as the closer's default.
    let err: InstanceType<typeof ApiError> | null = null;
    try {
      await R.roomsApi.create({
        contact_id: LEAD,
        provider: "zoom",
        call_kind: "demo",
        purpose: "manual",
        trigger: "manual",
      });
    } catch (e) {
      err = e as InstanceType<typeof ApiError>;
    }
    // Before the fix: "You already have a room open. End it first. Your other
    // room is on the lead you sent it to.", for every link while Available.
    // Fix round 1: the empty standby room is ended for the lead's room, with
    // its audit row and a timeline line that says how to get one again.
    expect(err).toBeNull();
    expect(w.room(String(sb.id)).state).toBe("ended");
    expect(
      w.audits.some(a => a.action === "room.end" && a.entityId === sb.id),
    ).toBe(true);
    const lead = w.db
      .t("cockpit_sales_rooms")
      .find((r: Row) => r.contact_id === LEAD) as Row;
    expect(lead.state).not.toBe("failed");
    const line = w.db
      .t("cockpit_sales_room_events")
      .find((e: Row) => e.room_id === sb.id && e.kind === "room.end") as Row;
    expect(String(line?.text ?? "")).toMatch(
      /Press Get my room on the strip after the call\.$/,
    );
  });
});

describe("journey: the setter's Meet room fails to be made", () => {
  test("with the setter's Zoom pending, the failed panel's one button must not be Try Zoom (refused, 'Meet works now')", async () => {
    const w = begin({}, setter);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    const id = made.room.id;
    // The worker cannot make the Meet event: worker.failed, the room failed.
    Object.assign(w.room(id), {
      state: "failed",
      result: "failed",
      error: "Google did not make the Meet link. Try Zoom.",
      ended_at: w.db.iso(),
      version: Number(w.room(id).version) + 1,
    });
    const p = await panelNow(w, id);
    expect(p.moment).toBe("failed");
    // Before the fix the one button was Try Zoom, refused on every press
    // ("Your Zoom seat is not active yet. ... Meet works now."), and nothing
    // said to call the lead. Fix round 1: no retry the seat cannot use, and
    // the sentence's next step is the phone.
    expect(p.primary).toBeNull();
    expect(p.keys).not.toContain("retry");
    expect(p.words).toBe(
      "Google did not make the Meet link. Call the lead on the phone.",
    );
  });
});

describe("journey: a closer whose Zoom is Basic goes Available", () => {
  test("a standby room must be made on Meet (which works), not refused for Zoom Basic", async () => {
    const w = begin(
      {
        hosts: [
          {
            email: CLOSER,
            zoom_user_id: "Z-closer",
            zoom_status: "basic",
            google_ok: true,
          },
        ],
      },
      closer,
    );
    await R.roomsApi.availability("available");
    const served = calls.find(c => c.action === "live.availability")?.answer;
    const rooms = w.db
      .t("cockpit_sales_rooms")
      .filter((r: Row) => r.purpose === "standby");
    // defaultProvider picks Zoom (Basic counts as usable), the standby room is
    // a demo room, and createRefusal refuses Zoom Basic for a demo: "The
    // closer's Zoom is Basic and ends at 40 minutes. Use Meet for this demo."
    // No room is made, though Meet is on and the host's Google is fine; and
    // the sentence is dropped by the browser (see the first journey).
    expect({
      made: rooms.map((r: Row) => r.provider),
      why: served?.standby_error ?? null,
    }).toEqual({ made: ["meet"], why: null });
  });
});
