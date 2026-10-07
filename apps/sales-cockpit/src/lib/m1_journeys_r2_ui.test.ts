// Milestone 1, video-link round 2: end-to-end journeys through the dialer
// and the lead page, with the pilot's settings (m1-scope.md section 3):
// rooms on for the test contact only, Meet and Zoom on, every send channel
// on, the WhatsApp gate shut (the link goes by email), short link off,
// count_on_join, settle and wrap off, automatic mode off, fallback scope
// "intro", live handover off, followups.agent off.
//
// The cockpit's own code (lib/rooms.ts, videoLink.ts, dialerUi.ts afterMiss)
// is wired straight into sales-api's real room actions over the shared fakes
// (supabase/functions/sales-api/testfakes.ts), answered the way index.ts
// answers a seat; the message service is a fake that keeps index.ts's rules
// (one request id, one message; a lost answer is "may have gone"). The SQL
// sweep's closes are played as 20261004a writes them.
//
// bun test src/lib/m1_journeys_r2_ui.test.ts   (from apps/sales-cockpit)
//
// Each test's last expectations are what should hold; a failing one is a
// finding, and its comment says what the rep or the lead gets instead.
// Every lead, seat and link is invented (stress-..., @stress.invalid).
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
/**
 * Actions whose next answer is lost after sales-api ran them: the laptop's
 * lid shut while the press waited (room.create waits up to 15 s for the
 * worker), and the browser's fetch failed on waking.
 */
const loseAnswer = new Set<string>();

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
      if (loseAnswer.delete(action))
        throw new ApiError(
          "The cockpit could not reach its server. Check the connection and try again.",
          "network",
        );
      return { ok: true, ...out };
    } catch (e) {
      await w.flush();
      if (e instanceof ApiError) throw e;
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
const SETTER = "stress-m1j2-setter@stress.invalid";
const CLOSER = "stress-m1j2-closer@stress.invalid";
const LEAD = "stress-m1j2-huda";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const MAY_HAVE_GONE =
  "The send may have gone; read the conversation in HighLevel before writing to the lead again";
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
  const textModes: ("ok" | "lost")[] = [];
  const convo = { unread: false };
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
    // index.ts convoSend: one message per request id; a lost answer
    // ("lost": HighLevel took it, its answer never came) is "may have gone".
    sendText: async (who: Row, b: Row) => {
      const again = seen.get(String(b.request_id));
      if (again) return { message: again, repeated: true };
      const mode = textModes.shift() ?? "ok";
      texts.push({ who: who.email, ...b, mode });
      if (mode === "lost") {
        seen.set(String(b.request_id), {
          id: fakeUuid(),
          state: "unclear",
          created_at: w.db.iso(),
        });
        throw new ApiRefusal(
          `${MAY_HAVE_GONE} (HighLevel did not answer: no answer within 25 s)`,
          502,
          { unclear: true },
        );
      }
      const r = {
        id: fakeUuid(),
        state: "sent",
        provider_status: "sent",
        created_at: w.db.iso(),
      };
      seen.set(String(b.request_id), r);
      return { message: r };
    },
    // index.ts whatsappSentSince: the lead's conversation, unreadable while
    // `convoUnread` is set (null), else what went.
    sentSince: async (
      _c: string,
      _since: number,
      text: string | null,
      channel?: string,
    ) => {
      if (convo.unread) return null;
      if (!text) return null;
      const hit = texts.find(
        t =>
          String(t.body) === text &&
          (channel === "email" ? t.channel === "email" : t.channel !== "email"),
      );
      return hit
        ? {
            id: `ghl-${String(hit.request_id).slice(0, 8)}`,
            status: "delivered",
          }
        : false;
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
    textModes,
    convo,
    /** The cron's minute: the sweep's replay of unhandled worker and Zoom events, then the room's tick. */
    async minute(id: string, by = 60 * S) {
      w.clock.now += by;
      const ids = w.db
        .t("cockpit_sales_room_events")
        .filter(
          (e: Row) =>
            !e.handled_at &&
            ["worker", "zoom", "claim"].includes(String(e.source)) &&
            (!e.lease_until ||
              Date.parse(String(e.lease_until)) <= w.clock.now) &&
            Date.parse(String(e.at ?? w.db.iso())) <= w.clock.now - 20 * S,
        )
        .map((e: Row) => String(e.id));
      if (ids.length)
        await rooms.desk["room.event"](desk, {
          kind: "sweep.replay",
          payload: { event_ids: ids },
        }).catch(() => null);
      await w.flush();
      await rooms.desk["room.event"](desk, {
        kind: "tick",
        payload: { room_ids: [id] },
      }).catch(() => null);
      await w.flush();
    },
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

/**
 * The dialer's step after the miss for this room, as DialerPage missStep
 * draws it: since round 2 with the panel's clock and its health line.
 */
function stepAfterMiss(
  room: Row | null,
  gateOpen: boolean,
  panel: { now?: number; workerDown?: boolean } = {},
) {
  return afterMiss({
    ...panel,
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
function bookIntro(w: World, start: number, id = "stress-m1j2-appt") {
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
// Controls: the pilot's own paths hold end to end
// ---------------------------------------------------------------------------

describe("control: the setter's intro rings out, a Meet link goes by email, Huda never opens it", () => {
  test("the panel counts down, the dialer's step says the link went, and after the sweep's close both say what to do next", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    expect(w.texts.map(t => t.channel)).toEqual(["email"]);
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.moment).toBe("sent");
    expect(stepAfterMiss(p.room, false).title).toBe("The video link went");
    for (let i = 0; i < 10; i++) await w.minute(id);
    // R4: the lead did not join by lead_by (20261004a).
    w.sweepCloses(id, {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      error: "Closed: the lead did not join in 10 minutes.",
    });
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    // Meet sends no join signal: never "nobody joined" with a No-show press.
    expect(p.words).toMatch(/Meet cannot say whether Huda came in/);
    expect(p.keys).not.toContain("noshow");
    expect(stepAfterMiss(p.room, false).title).toBe("Did you speak on video?");
    expect(w.texts).toHaveLength(1);
  });
});

describe("control: a closer on Huda's lead page sends a Zoom link; Huda waits in the waiting room, the closer comes in and admits her", () => {
  test("every step says what happened and the one right press", async () => {
    const w = begin({}, closer);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "demo",
      purpose: "manual",
      trigger: "manual",
    });
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    let p = await panelNow(w, id);
    expect(p.words).toMatch(/^Link sent by email at /);
    expect(p.primary).toBe("open");
    await zoomSays(w, id, "meeting.participant_joined_waiting_room", {
      user_name: "Huda",
      id: "",
      email: "",
    });
    p = await panelNow(w, id);
    expect(p.words).toBe(
      "The lead is in the waiting room. Admit them in Zoom.",
    );
    expect(p.primary).toBe("open");
    await zoomSays(w, id, "meeting.started", null);
    await zoomSays(w, id, "meeting.participant_joined", {
      user_name: "Sami Closer",
      id: "Z-closer",
      email: CLOSER,
    });
    p = await panelNow(w, id);
    expect(p.primary).toBe("lead_in");
    w.clock.now += 20 * S;
    await zoomSays(w, id, "meeting.participant_joined", {
      user_name: "Huda",
      id: "",
      email: "",
    });
    p = await panelNow(w, id);
    expect(p.moment).toBe("joined");
    expect(w.marks).toHaveLength(0);
    w.clock.now += 20 * 60 * S;
    await R.roomsApi.end(p.room, "finished", true);
    p = await panelNow(w, id);
    expect(p.words).toMatch(/^Finished at /);
    expect(p.labels).toEqual(["Book the next call"]);
  });
});

// ---------------------------------------------------------------------------
// 1. The link "may have gone": the panel says check first, the step below says send
// ---------------------------------------------------------------------------

describe("journey: the intro rings out at 10:00, the Meet link's email goes to HighLevel and its answer is lost, and HighLevel's conversation cannot be read for a few minutes", () => {
  test("the dialer's step under the panel does not offer a second 'I tried to call you' message while the panel says to check the conversation first", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    // HighLevel took the email and its answer never came (index.ts convoSend:
    // "may have gone"); the conversation read that would settle it fails too.
    w.textModes.push("lost");
    w.convo.unread = true;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    for (let i = 0; i < 3; i++) {
      await w.minute(id);
      p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    }
    // The panel: "The link may have gone by email. Check the lead's
    // conversation in HighLevel before sending anything else."
    expect(p.moment).toBe("unclear");
    expect(p.words).toMatch(/before sending anything else/);
    // The step right under it (DialerPage AfterMissStep, dialerUi afterMiss
    // with the room): a live room with no link_sent_at and a refusal falls
    // through to the ordinary missed-call step, "No answer. Send them an
    // email?" with its teal button opening the email box (send: "email").
    // A rep who follows the step sends Huda a second "I tried to call you"
    // beside the link email that most likely reached her.
    const step = stepAfterMiss(p.room, false);
    expect({ title: step.title, send: step.send }).not.toMatchObject({
      send: "email",
    });
    expect(step.send).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. The lid shut while room.create waited: the first room is never shown
// ---------------------------------------------------------------------------

describe("journey: the setter presses Send a Meet link and shuts the laptop's lid while room.create waits for the worker; the room is made and the link goes; the laptop wakes 13 minutes later", () => {
  test("the page learns of the first room (or the second press is answered with it), and Huda gets one link for one missed call", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const ask = dialerAsk("meet", "intro", appt, att);
    // sales-api ran the press; the browser's fetch failed on waking.
    loseAnswer.add("room.create");
    let first = "";
    try {
      await R.roomsApi.create(ask);
    } catch (e) {
      first = R.errorText(e);
    }
    // The picker says: "The cockpit could not reach its server. Check the
    // connection and try again."
    expect(first).toMatch(/try again/);
    const id = String(w.db.t("cockpit_sales_rooms")[0]?.id);
    await w.workerOpens(id);
    expect(w.texts).toHaveLength(1);
    // Asleep: the room waits its ten minutes and the sweep closes it (R4).
    for (let i = 0; i < 11; i++) await w.minute(id);
    w.sweepCloses(id, {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      error: "Closed: the lead did not join in 10 minutes.",
    });
    w.clock.now += 60 * S;
    // On waking: live.status lists no room (a closed Meet room nothing was
    // seen in is not one the banner keeps), so the dialer's useLeadRoom has
    // none, the banner says nothing, and the picker still shows its error.
    const live = await R.roomsApi.liveStatus();
    const seen = VL.roomForLead(live.rooms, LEAD);
    const banner = await bannerNow(w);
    expect(banner.words).toBeNull();
    // The setter does as told and presses Send a Meet link again: past the
    // two minutes once() holds a request id (RETRY_WINDOW_MS), so it is a new
    // request, and the miss is still inside the dialer's 15 minutes.
    const realNow = Date.now;
    Date.now = () => realNow() + 13 * 60_000;
    let second: Row | null = null;
    try {
      second = (await R.roomsApi.create(ask)).room as unknown as Row;
    } catch {
      second = null;
    } finally {
      Date.now = realNow;
    }
    const other = w.db.t("cockpit_sales_rooms").find((r: Row) => r.id !== id);
    if (other) await w.workerOpens(String(other.id));
    // What happens: a second room, and a second "I just tried to call you
    // for your intro call ... I'll wait for you for the next 10 minutes"
    // email, 14 minutes after the first, for the same missed call; the
    // setter never saw the first room or that its link went.
    expect({
      pageSawFirstRoom: seen?.id === id,
      linkEmails: w.texts.length,
    }).not.toEqual({ pageSawFirstRoom: false, linkEmails: 2 });
    expect(w.texts).toHaveLength(1);
    void second;
  });
});

// ---------------------------------------------------------------------------
// 3. A closer's missed demo: the lead page offers a link the server refuses every time
// ---------------------------------------------------------------------------

describe("journey: Huda's demo with the closer started at 10:00; she does not pick up; at 10:05 the closer opens her lead page and presses Video call, Send a video link", () => {
  test("the lead page does not offer a press sales-api refuses the same way every time", async () => {
    const w = begin({}, closer);
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "stress-m1j2-demo",
        contact_id: LEAD,
        call_type: "demo",
        start_at: new Date(T0).toISOString(),
        end_at: new Date(T0 + 60 * MIN).toISOString(),
        status: "confirmed",
        assigned_user_id: "G-closer",
        calendar_id: "cal-demo",
      },
    ]);
    w.clock.now = T0 + 5 * MIN;
    // LeadPage.tsx: nextAppt is the lead's next call that has not started
    // (start_at after now); the gate's bookedDemo reads only that one.
    const appointments = w.db.t("cockpit_sales_appointments") as Row[];
    const nextAppt = appointments
      .filter(
        r =>
          r.start_at &&
          Date.parse(String(r.start_at)) > w.clock.now &&
          r.status !== "cancelled",
      )
      .sort(
        (x, y) =>
          Date.parse(String(x.start_at)) - Date.parse(String(y.start_at)),
      )[0];
    const gate = VL.videoLinkGate({
      setting: VL.readRoomsSetting({ ...PILOT_ROOMS }),
      contactId: LEAD,
      seatEmail: CLOSER,
      purpose: "manual",
      client: false,
      dnd: false,
      // LeadPage.tsx since round 2's fix: a demo still on counts until it
      // ends, as room.create counts it (the old rule read only nextAppt).
      bookedDemo: VL.demoStillOn(appointments as never, w.clock.now),
    });
    void nextAppt;
    let code: string | null = null;
    let said = "";
    try {
      await R.roomsApi.create({
        contact_id: LEAD,
        provider: "zoom",
        call_kind: "demo",
        purpose: "manual",
        trigger: "manual",
      });
      said = "made";
    } catch (e) {
      code = R.refusalCode(e);
      said = R.errorText(e);
    }
    // What happens: the menu offers Send a video link (the demo has
    // started, so it is no longer "next"), sales-api's createPrep counts
    // the demo until it ends (m1 round 1) and refuses: "This lead has a
    // booked demo. Its Zoom link comes from HighLevel, so no new room is
    // made." The picker keeps both buttons (pickerSends holds back only
    // after lead_night), each refused the same way for the next 55 minutes,
    // and the sentence names no next step for a lead who did not pick up.
    expect({
      offered: gate.show,
      code,
      buttonsStay: VL.pickerSends(code),
    }).not.toEqual({
      offered: true,
      code: "booked_demo",
      buttonsStay: true,
    });
    expect(said === "made" || !gate.show).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. I can't let them in, in the pilot: the Zoom link goes by email to a lead still knocking on Meet
// ---------------------------------------------------------------------------

describe("journey: the setter's Meet link reached Huda by email; she knocks and the setter cannot let her in, so the setter presses I can't let them in", () => {
  test("the new Zoom room's panel and the step under it tell the setter that Huda, still at the Meet door, must be told where the new link is", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    await R.roomsApi.mark(p.room, "host_in");
    w.clock.now += 2 * MIN;
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.keys).toContain("admit_blocked");
    const out = await R.roomsApi.end(p.room, "admit_blocked");
    expect(out.replacement).toBeTruthy();
    const nid = String(out.replacement?.id);
    await w.workerOpens(nid, ZOOM_URL);
    // The replacement's link went the only way the pilot has: by email
    // ("Our call moved to Zoom."), while Huda sits on Meet's "Asking to
    // join" screen, likely on her phone.
    expect(w.texts.map(t => t.channel)).toEqual(["email", "email"]);
    const q = await panelNow(w, nid, { canMarkIntro: true, talkBelow: true });
    const step = stepAfterMiss(q.room, false);
    const said = `${q.words} ${step.title}. ${step.text}`;
    // What the setter is told: "Link sent by email at 10:03. Waiting for
    // Huda." and, under it, "The video link went by email at 10:03. Wait
    // for them here, or go to the next lead." Nothing says Huda is still at
    // the Meet door and has to be told the Zoom link is in her email; the
    // step even offers the next lead.
    expect(said).not.toMatch(/go to the next lead/);
    expect(said).toMatch(/call (her|them|the lead)|tell (her|them|the lead)/i);
  });
});

// ---------------------------------------------------------------------------
// 5. The worker is down: the dialer offers the link, the picker keeps a press refused every time
// ---------------------------------------------------------------------------

describe("journey: the room worker's last run was 200 s ago (its cron stopped) when the setter's intro rings out", () => {
  test("after the worker_down refusal the picker does not keep two buttons the server refuses the same way", async () => {
    const w = begin();
    w.db.seed("cockpit_sales_worker_status", [
      {
        worker: "sales-desk",
        job: "rooms",
        ok: true,
        at: new Date(w.clock.now - 200 * S).toISOString(),
        detail: "ready",
      },
    ]);
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    // The dialer's gate reads the switches and the lead, never the health
    // line live.status carries, so Send a video link shows.
    const live = await R.roomsApi.liveStatus();
    expect(live.health?.worker_ok).toBe(false);
    let code: string | null = null;
    let said = "";
    for (const provider of ["meet", "zoom"] as const) {
      try {
        await R.roomsApi.create(dialerAsk(provider, "intro", appt, att));
      } catch (e) {
        code = R.refusalCode(e);
        said = R.errorText(e);
      }
    }
    expect(said).toMatch(/Video rooms are down right now/);
    // VideoPicker keeps both send buttons after it (pickerSends holds them
    // back only after lead_night); each press is refused the same way until
    // the worker runs again.
    expect(VL.pickerSends(code)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. The panel says the room is not coming; the step under it says the link is on its way
// ---------------------------------------------------------------------------

describe("journey: the worker's last run is 100 s old when the setter presses Send a Meet link (room.create still takes it), and no worker comes", () => {
  test("once the panel says the room will not be made, the step under it does not say the link is on its way and offer the next lead", async () => {
    const w = begin();
    w.db.seed("cockpit_sales_worker_status", [
      {
        worker: "sales-desk",
        job: "rooms",
        ok: true,
        at: new Date(T0 + 40 * S - 100 * S).toISOString(),
        detail: "ready",
      },
    ]);
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    // 70 s on: past the sweep's claim minute, the health line red.
    w.clock.now += 70 * S;
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.moment).toBe("making_down");
    expect(p.words).toMatch(/will not be made/);
    // DialerPage passes the panel's clock and health line (round 2's fix).
    const step = stepAfterMiss(p.room, false, {
      now: w.clock.now,
      workerDown: p.feed.health?.worker_ok === false,
    });
    // DialerPage's step: "The video link is on its way to them. Wait for
    // them here, or go to the next lead." under "This room will not be
    // made: video rooms are down. Call the lead on the phone, or send your
    // own Zoom or Meet link."
    expect(`${step.title}. ${step.text}`).not.toMatch(
      /on its way|go to the next lead/,
    );
  });
});
