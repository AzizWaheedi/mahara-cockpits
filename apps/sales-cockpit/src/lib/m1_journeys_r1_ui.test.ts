// Milestone 1, video-link round 1: end-to-end journeys through the dialer and
// the lead page, with the pilot's settings (m1-scope.md section 3): rooms on
// for the test contact only, Meet and Zoom on, every send channel on, the
// WhatsApp gate still shut (the link goes by email), short link off,
// count_on_join, settle and wrap off, automatic mode off, fallback scope
// "intro", live handover off, followups.agent off.
//
// The cockpit's own press code (lib/rooms.ts roomsApi, roomSentence,
// roomActions, bannerRoomSentence, myRoom; videoLink.ts; dialerUi afterMiss)
// is wired straight into sales-api's real room actions over the shared fakes
// (supabase/functions/sales-api/testfakes.ts), answered the way index.ts
// answers a seat. The SQL sweep's closes are played as 20261004a writes them.
//
// bun test src/lib/m1_journeys_r1_ui.test.ts   (from apps/sales-cockpit)
//
// Each test's last expectations are what should hold; a failing one is a
// finding, and its comment says what the rep or the lead gets instead.

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
const VL = await import("./videoLink");
const { afterMiss } = await import("./dialerUi");

const S = 1000;
const MIN = 60 * S;
const SETTER = "stress-m1j-setter@stress.invalid";
const CLOSER = "stress-m1j-closer@stress.invalid";
const LEAD = "stress-m1j-huda";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL = "https://us06web.zoom.us/j/85550000001?pwd=sb";
/** Thursday 8 October 2026, 10:00 in Kuwait. */
const T0 = Date.parse("2026-10-08T07:00:00Z");

const setter = {
  signed_in: true,
  seat: true,
  manager: false,
  email: SETTER,
  name: "Tara Setter",
  role: "setter",
  ghl_user_id: "G-setter",
};
const closer = {
  signed_in: true,
  seat: true,
  manager: false,
  email: CLOSER,
  name: "Sami Closer",
  role: "closer",
  ghl_user_id: "G-closer",
};
const desk = {
  signed_in: true,
  seat: true,
  manager: false,
  email: "sales-desk",
};

/** The pilot's rooms setting (m1-scope.md section 3). */
const PILOT_ROOMS = {
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
    scope: "intro",
    auto_on_miss: false,
  },
};
/** The WhatsApp gate as production has it today: shut. */
const GATE_SHUT = {
  connector_off: false,
  single_copy_ok_at: null,
  templates_per_day: 250,
};
const GATE_OPEN = {
  connector_off: true,
  single_copy_ok_at: "2026-10-01T00:00:00Z",
  templates_per_day: 250,
};

interface Opts {
  start?: number;
  rooms?: Row;
  guard?: Row;
  hosts?: Row[];
  /** The lead wrote on WhatsApp this long ago (the 24-hour window); null: never. */
  inboundAgoMs?: number | null;
  contact?: Row;
}

function setup(o: Opts = {}) {
  const w = fakeWorld(o.start ?? T0);
  const audits: Row[] = [];
  const texts: Row[] = [];
  const templates: Row[] = [];
  const marks: Row[] = [];
  const seen = new Map<string, Row>();
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...PILOT_ROOMS, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    {
      key: "followups",
      value: { enabled: true, agent: false, first_hours: [9, 18] },
    },
    { key: "whatsapp_guard", value: o.guard ?? GATE_SHUT },
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
      name: "Sami Closer",
      role: "closer",
      ghl_user_id: "G-closer",
      active: true,
    },
  ]);
  w.db.seed(
    "cockpit_sales_room_hosts",
    o.hosts ?? [
      {
        email: SETTER,
        zoom_user_id: "Z-setter",
        zoom_status: "basic",
        google_ok: true,
      },
      {
        email: CLOSER,
        zoom_user_id: "Z-closer",
        zoom_status: "licensed",
        google_ok: true,
      },
    ],
  );
  // The view cockpit_sales_presence (20261004a) with live calls off: every
  // seat Away, its default provider the role's (setter Meet, closer Zoom).
  w.db.seed("cockpit_sales_presence", [
    {
      email: SETTER,
      state: "away",
      until: null,
      room_id: null,
      zoom_status: "basic",
      default_provider: "meet",
      reason: null,
      booked_at: null,
      booked_kind: null,
    },
    {
      email: CLOSER,
      state: "away",
      until: null,
      room_id: null,
      zoom_status: "licensed",
      default_provider: "zoom",
      reason: null,
      booked_at: null,
      booked_kind: null,
    },
  ]);
  w.db.seed("cockpit_sales_leads", [
    {
      contact_id: LEAD,
      name: "Huda Ali",
      country: "KW",
      assigned_to: "G-setter",
    },
  ]);
  const inbound = o.inboundAgoMs === undefined ? null : o.inboundAgoMs;
  if (inbound !== null)
    w.db.seed("cockpit_sales_inbox", [
      {
        conversation_id: "c0",
        contact_id: LEAD,
        inbound_whatsapp_at: new Date(w.clock.now - inbound).toISOString(),
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
            email: "huda@stress.invalid",
            tags: ["roas-qualified"],
            country: "KW",
            ...(o.contact ?? {}),
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
    sendTemplate: async (who: Row, t: Row) => {
      const again = seen.get(String(t.requestId));
      if (again) return { message: again, repeated: true };
      templates.push({ who: who.email, ...t });
      const r = { id: fakeUuid(), state: "sent", provider_status: "sent" };
      seen.set(String(t.requestId), r);
      return { message: r };
    },
    upcoming: async () => null,
  } as never);
  const room = (id: string) =>
    w.db.t("cockpit_sales_rooms").find((r: Row) => r.id === id) as Row;
  /** The room worker: claim, store worker.ready, open the room (contract v2 section 7), then tell sales-api. */
  async function workerOpens(id: string, url = MEET_URL, tell = true) {
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
          provider_meeting_id: url.includes("zoom")
            ? "85550000001"
            : `evt-${id.slice(-4)}`,
          opened_at: w.db.iso(),
          host_by:
            cur.host_by ?? new Date(w.clock.now + 15 * MIN).toISOString(),
          ends_at:
            cur.ends_at ??
            new Date(
              w.clock.now + (cur.call_kind === "demo" ? 60 : 30) * MIN,
            ).toISOString(),
          version: Number(cur.version) + 1,
        },
      },
    );
    if (tell) {
      await rooms.desk["room.event"](desk, {
        kind: "worker.ready",
        room_id: id,
        payload: { worker_run: "run-1" },
      });
      await w.flush();
    }
  }
  /** The SQL sweep's close of a room, as 20261004a's cockpit_sales_rooms_close writes it. */
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
    templates,
    marks,
    room,
    workerOpens,
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

/** What the room panel says and offers for a room as room.status serves it. */
async function panelNow(w: World, id: string, extra: Row = {}) {
  const feed = await R.roomsApi.status(id);
  const ctx = {
    now: w.clock.now,
    lineShown: true,
    otherOk: feed.other_ok ?? null,
    workerDown: feed.health?.worker_ok === false,
    ...extra,
  };
  const acts = R.roomActions(feed.room, ctx);
  return {
    feed,
    room: feed.room,
    moment: R.momentFor(feed.room, ctx),
    words: R.sentenceText(R.roomSentence(feed.room, ctx)),
    steps: R.roomSteps(feed.room),
    primary: acts.primary?.key ?? null,
    keys: [acts.primary?.key, ...acts.quiet.map(a => a.key)].filter(
      Boolean,
    ) as string[],
    labels: [acts.primary?.label, ...acts.quiet.map(a => a.label)].filter(
      Boolean,
    ) as string[],
  };
}

/** What the banner's room row says and offers, as SalesBannerView draws it (live calls off: no strip). */
async function bannerNow(w: World) {
  const data = await R.roomsApi.liveStatus();
  const room = R.myRoom(data.rooms, w.clock.now);
  if (!room) return { data, room: null, words: null, action: null };
  return {
    data,
    room,
    words: R.sentenceText(
      R.bannerRoomSentence(room, w.clock.now, {
        workerDown: data.health?.worker_ok === false,
      }),
    ),
    action: R.bannerRoomAction(room),
  };
}

/** The dialer's step after the miss for this room, as DialerPage missStep draws it. */
function stepAfterMiss(room: Row | null, gateOpen: boolean) {
  return afterMiss({
    moment: "missed_call",
    whatsapp: {
      on: true,
      dnd: false,
      reachable: true,
      window: { open: false },
    },
    email: { on: true, dnd: false, reachable: true },
    templatesLive: gateOpen,
    messageReady: true,
    video: room as never,
  });
}

/** The booked intro the dialer's item is for, at `start`. */
function bookIntro(w: World, start: number, id = "stress-m1j-appt") {
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: id,
      contact_id: LEAD,
      call_type: "intro",
      start_at: new Date(start).toISOString(),
      end_at: new Date(start + 30 * MIN).toISOString(),
      status: "confirmed",
      assigned_user_id: "G-setter",
      calendar_id: "cal-intro",
    },
  ]);
  return id;
}

/** A Maqsam attempt of the setter's for the lead, at `at`. */
function attempt(w: World, at: number): string {
  const id = crypto.randomUUID();
  w.db.seed("cockpit_sales_attempts", [
    {
      id,
      contact_id: LEAD,
      started_at: new Date(at).toISOString(),
      state: "done",
    },
  ]);
  return id;
}

// Kept for the next round's journeys.
void stepAfterMiss;
void GATE_OPEN;

/** Zoom's webhook for a room's own meeting, stored by the door and forwarded to sales-api. */
async function zoomSays(
  w: World,
  roomId: string,
  event: string,
  participant: Row | null,
  hostId = "Z-closer",
) {
  const id = fakeUuid();
  w.db.seed("cockpit_sales_room_events", [
    {
      id,
      room_id: roomId,
      kind: `zoom.${event}`,
      source: "zoom",
      dedupe_key: `zoom:${event}:${id}`,
      at: w.db.iso(),
      detail: {
        event,
        event_ts: w.clock.now,
        payload: {
          object: {
            id: String(w.room(roomId).provider_meeting_id ?? ""),
            host_id: hostId,
            topic: `Mahara call ${String(w.room(roomId).code ?? "")}`,
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

/** The dialer's ask after a missed call, as DialerPage videoAsk and createAsk build it. */
function dialerAsk(
  provider: "meet" | "zoom",
  kind: "intro" | "confirm" | "lead",
  appt: string | null,
  attemptId: string | null,
) {
  const ask: Row = {
    contact_id: LEAD,
    provider,
    call_kind: "intro",
    purpose: "fallback",
    trigger: "no_answer",
    item_kind: kind,
  };
  const id = VL.videoAppointmentId(
    kind,
    appt ? { id: appt, type: "intro" } : null,
  );
  if (id) ask.appointment_id = id;
  if (attemptId) ask.attempt_id = attemptId;
  return ask as never;
}

// ---------------------------------------------------------------------------
// The control: the pilot's own path holds end to end
// ---------------------------------------------------------------------------

describe("control: the setter's booked intro rings out at 10:00, a Meet link goes by email (the gate is shut), Huda comes in, the setter marks the intro", () => {
  test("every step says what happened and what to do next; nothing is booked or marked by the join", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    // One email, the intro's own words, the room's own link.
    expect(w.texts.map(t => t.channel)).toEqual(["email"]);
    expect(String(w.texts[0]?.body)).toContain(MEET_URL);
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.moment).toBe("sent");
    expect(p.primary).toBe("open");
    const b = await bannerNow(w);
    expect(b.words).toMatch(/Video room: Huda/);
    await R.roomsApi.mark(p.room, "host_in");
    w.clock.now += 2 * MIN;
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.primary).toBe("lead_in");
    await R.roomsApi.mark(p.room, "lead_in");
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.words).toMatch(/^Huda joined at /);
    expect(w.marks).toHaveLength(0);
    expect(w.ghlCalls.filter((c: Row) => c.method !== "GET")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 1. I can't let them in on a room that does not carry the intro
// ---------------------------------------------------------------------------

describe("journey: the confirmation call for tomorrow's intro rings out at 17:00, the Meet link goes, Huda opens it and knocks; Meet will not let her in, so the setter presses I can't let them in", () => {
  test("the Meet room is not closed for a Zoom room the scope then refuses, and Try Zoom is not refused the same way every press", async () => {
    // Wednesday 7 October, 17:00 Kuwait. The intro is Thursday 10:00. The
    // dialer offers the link on the confirmation call (videoLinkGate:
    // bookedIntro holds for kind confirm) and sends the intro's id with
    // item_kind confirm; sales-api makes a plain room (it never carries the
    // intro from a confirmation call), so the room's appointment_id is null.
    const w = begin({ start: Date.parse("2026-10-07T14:00:00Z") });
    const appt = bookIntro(w, T0);
    const att = attempt(w, w.clock.now);
    w.clock.now += 30 * S;
    const gate = VL.videoLinkGate({
      setting: VL.readRoomsSetting({ ...PILOT_ROOMS }),
      contactId: LEAD,
      seatEmail: SETTER,
      purpose: "fallback",
      bookedIntro: true,
      bookedDemo: false,
      client: false,
      dnd: false,
      country: "KW",
      now: w.clock.now,
      introNow: false,
    });
    expect(gate.show).toBe(true);
    const made = await R.roomsApi.create(
      dialerAsk("meet", "confirm", appt, att),
    );
    const id = made.room.id;
    expect(made.room.appointment_id ?? null).toBeNull();
    await w.workerOpens(id);
    let p = await panelNow(w, id, { talkBelow: true });
    await R.roomsApi.mark(p.room, "host_in");
    w.clock.now += 2 * MIN;
    p = await panelNow(w, id, { talkBelow: true });
    // The panel offers it: the setter's Zoom works (Basic, for an intro).
    expect(p.keys).toContain("admit_blocked");
    const out = await R.roomsApi.end(p.room, "admit_blocked");
    // rooms.ts replacementFor asks createRoom for the replacement with the
    // closed room's appointment_id (null here), so createRefusal's
    // fallback.scope "intro" check finds no booked intro and refuses:
    // "For now, video links after a missed call are only for booked intros."
    // The Meet room is already cancelled (admit_blocked) by then.
    const after = await panelNow(w, id, { talkBelow: true });
    const replaced = Boolean(out.replacement);
    const meetStillOpen = !["cancelled", "ended", "expired", "failed"].includes(
      String(w.room(id).state),
    );
    // The panel's one button, Try Zoom, asks room.end admit_blocked again,
    // which asks for the same replacement and is refused the same way.
    let again: string | null = null;
    if (after.primary === "retry") {
      const second = await R.roomsApi.end(after.room, "admit_blocked");
      again = second.replacement
        ? "made"
        : (second.replacement_refusal ?? null);
    }
    // What should hold: Huda gets a Zoom room (or her Meet room stays open),
    // and the panel never offers a press refused the same way each time.
    expect({ replaced, meetStillOpen }).not.toEqual({
      replaced: false,
      meetStillOpen: false,
    });
    expect(again).not.toBe(out.replacement_refusal ?? "-");
    expect(out.replacement_refusal ?? "").not.toMatch(/only for booked intros/);
  });

  test("the same room failing on Meet, read back after a reload (no press held): Try Zoom is not refused as 'only for booked intros'", async () => {
    const w = begin({ start: Date.parse("2026-10-07T14:00:00Z") });
    const appt = bookIntro(w, T0);
    const att = attempt(w, w.clock.now);
    w.clock.now += 30 * S;
    const made = await R.roomsApi.create(
      dialerAsk("meet", "confirm", appt, att),
    );
    const id = made.room.id;
    // The worker could not make it: Google refused the Meet link.
    w.sweepCloses(id, {
      state: "failed",
      result: "failed",
      error: "Google did not make the Meet link. Try Zoom.",
    });
    // The page was reloaded (or the laptop slept and the dialer remounted):
    // the panel holds the room from live.status, and no first ask.
    const p = await panelNow(w, id, { talkBelow: true });
    expect(p.primary).toBe("retry");
    let said: string | null = null;
    try {
      await R.roomsApi.create(R.retryRequest(p.room, null, "zoom"));
      said = "made";
    } catch (e) {
      said = R.errorText(e);
    }
    expect(said).toBe("made");
  });
});

// ---------------------------------------------------------------------------
// 2. Meet will not let the lead in and nothing on the panel says what to do
// ---------------------------------------------------------------------------

describe("journey: Huda opens the Meet link and knocks; the setter is in the room but cannot let her in", () => {
  test("the pilot's setter (Zoom seat pending): the panel names a next step for a lead who cannot be let in", async () => {
    const w = begin({
      hosts: [
        {
          email: SETTER,
          zoom_user_id: null,
          zoom_status: "pending",
          google_ok: true,
        },
        {
          email: CLOSER,
          zoom_user_id: "Z-closer",
          zoom_status: "licensed",
          google_ok: true,
        },
      ],
    });
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    await R.roomsApi.mark(p.room, "host_in");
    w.clock.now += 3 * MIN;
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    // other_ok is false (Zoom pending), so I can't let them in is gone
    // (stress2 round 1), and Meet never reports the knock: the panel says
    // "You are in. Waiting for Huda." and offers The lead is in, Open my
    // room, Copy link, We are on the phone and End room. Nothing says what
    // to do while Huda waits at a door the setter cannot open.
    expect(p.feed.other_ok).toBe(false);
    const said = `${p.words} ${p.labels.join(" | ")}`;
    expect(said).toMatch(
      /can.?t let them in|cannot let|won.?t let|not let (them|her) in/i,
    );
  });

  test("the lead page's Meet room (the pilot's path for the test contact): I can't let them in is offered there too", async () => {
    const w = begin();
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      trigger: "manual",
    });
    const id = made.room.id;
    await w.workerOpens(id);
    let p = await panelNow(w, id);
    await R.roomsApi.mark(p.room, "host_in");
    w.clock.now += 3 * MIN;
    p = await panelNow(w, id);
    // The setter's Zoom works here (other_ok true), yet roomActions offers
    // admit_blocked only on purpose fallback and sales-api's
    // admitBlockedAllowed refuses it on a manual room.
    expect(p.feed.other_ok).toBe(true);
    const said = `${p.words} ${p.labels.join(" | ")}`;
    expect(said).toMatch(
      /can.?t let them in|cannot let|won.?t let|not let (them|her) in/i,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Rooms switched off with a room open
// ---------------------------------------------------------------------------

describe("journey: a manager switches rooms off (rooms.enabled false) a minute after the setter's link went to Huda by email", () => {
  test("the setter, who moved to the next lead, still sees Huda's open room in the banner", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("zoom", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    expect(w.texts).toHaveLength(1);
    // The setter presses Next lead: the banner is where the room shows now.
    let b = await bannerNow(w);
    expect(b.room?.id).toBe(id);
    w.clock.now += MIN;
    const st = w.db
      .t("cockpit_sales_settings")
      .find((r: Row) => r.key === "rooms") as Row;
    st.value = { ...(st.value as Row), enabled: false };
    // Huda taps the link and waits in Zoom's waiting room.
    await zoomSays(
      w,
      id,
      "meeting.participant_joined_waiting_room",
      { user_name: "Huda", id: "", email: "" },
      "Z-setter",
    );
    expect(w.room(id).lead_waiting_at).toBeTruthy();
    // live.status now refuses ("Video rooms are off for now."), and the
    // banner stays out of the way (SalesBanner: a refused read shows only the
    // portal's banner): nobody is told Huda is in the waiting room.
    let words: string | null = null;
    try {
      b = await bannerNow(w);
      words = b.words;
    } catch (e) {
      words = `refused: ${R.errorText(e)}`;
    }
    expect(words ?? "").toMatch(/waiting room/);
  });
});

// ---------------------------------------------------------------------------
// 4. The worker silent for 100 s: accepted, then "will not be made", then made
// ---------------------------------------------------------------------------

describe("journey: the room worker's last report is 100 s old (a slow minute on the VPS) when the setter presses Send a Meet link", () => {
  test("the panel does not say the room will not be made for a room sales-api accepted and the worker then makes and sends", async () => {
    const w = begin();
    w.db.seed("cockpit_sales_worker_status", [
      {
        worker: "sales-desk",
        job: "rooms",
        ok: true,
        at: new Date(w.clock.now - 100 * S).toISOString(),
        detail: "ready",
      },
    ]);
    const appt = bookIntro(w, T0);
    const made = await R.roomsApi.create(
      dialerAsk("meet", "intro", appt, null),
    );
    const id = made.room.id;
    // room.create accepted it (WORKER_DOWN_AFTER_S is 180 s), while the
    // health line it sends with room.status is red from 90 s
    // (WORKER_RED_AFTER_S), so the panel reads workerDown.
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    const told = p.words;
    // Twenty seconds later the worker's next run claims and makes the room,
    // and the link goes to Huda.
    w.clock.now += 20 * S;
    const status = w.db.t("cockpit_sales_worker_status")[0] as Row;
    status.at = w.db.iso();
    await w.workerOpens(id);
    expect(w.texts).toHaveLength(1);
    // The setter was told "This room will not be made: video rooms are down.
    // Call the lead on the phone, or send your own Zoom or Meet link." for
    // this very room: one who sent their own link meanwhile gave Huda two.
    expect(told).not.toMatch(/will not be made/);
  });
});

// ---------------------------------------------------------------------------
// 5. The dialer's after-miss step left open over lunch
// ---------------------------------------------------------------------------

describe("journey: the setter's intro call rings out at 10:00; the pane stays on Huda while the setter is away (the laptop sleeps); at 13:00 they press Send a Meet link", () => {
  test("Huda is not told 'I tried to call you just now' about a call three hours old", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0);
    w.clock.now = T0 + 3 * 3_600_000;
    // DialerPage keeps `missed` (trigger no_answer, the attempt) in state
    // until another call or another lead; nothing ages it, and sales-api
    // reads the attempt only to place a room in the intro's window.
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    await w.workerOpens(made.room.id);
    expect(w.texts).toHaveLength(1);
    expect(String(w.texts[0]?.body)).not.toMatch(/just now/);
  });
});

// ---------------------------------------------------------------------------
// 6. The pilot's link goes by email: the panel's words for it
// ---------------------------------------------------------------------------

describe("journey: the gate is shut, so the link goes by email (the pilot's every link)", () => {
  test("the panel says the link was sent by email, not 'on email'", async () => {
    const w = begin();
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      trigger: "manual",
    });
    await w.workerOpens(made.room.id);
    const p = await panelNow(w, made.room.id);
    expect(p.moment).toBe("sent");
    expect(p.words).not.toMatch(/sent on email/);
  });
});

// ---------------------------------------------------------------------------
// 7. The lead page's email: the room link with a full stop stuck to it
// ---------------------------------------------------------------------------

describe("journey: a closer on Huda's lead page sends a Zoom link; the gate is shut, so it goes by email", () => {
  test("the link in the email is not followed by a full stop (a Zoom link carries its passcode last)", async () => {
    const w = begin({}, closer);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "demo",
      purpose: "manual",
      trigger: "manual",
    });
    await w.workerOpens(made.room.id, ZOOM_URL);
    expect(w.texts.map(t => t.channel)).toEqual(["email"]);
    const body = String(w.texts[0]?.body);
    expect(body).toContain(ZOOM_URL);
    // ROOM_COPY.lead_en.manual_email_body: "Join here: {link}. If it does
    // not open, ...": "...?pwd=sb." A mail client that takes the stop into
    // the link sends Zoom a passcode that is not the meeting's.
    const after = body.slice(
      body.indexOf(ZOOM_URL) + ZOOM_URL.length,
      body.indexOf(ZOOM_URL) + ZOOM_URL.length + 1,
    );
    expect(after).toMatch(/^(\s|)$/);
  });
});
