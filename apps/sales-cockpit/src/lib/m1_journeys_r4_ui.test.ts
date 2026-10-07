// Milestone 1, video-link round 4: end-to-end journeys through the dialer
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
// bun test src/lib/m1_journeys_r4_ui.test.ts   (from apps/sales-cockpit)
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
const SETTER = "stress-m1j4-setter@stress.invalid";
const CLOSER = "stress-m1j4-closer@stress.invalid";
const LEAD = "stress-m1j4-huda";
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
function bookIntro(w: World, start: number, id = "stress-m1j4-appt") {
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
// Round 4 helpers
// ---------------------------------------------------------------------------

/**
 * Whether the dialer offers "Send a video link" now (DialerPage CallPane
 * offerVideo, lines 1830-1840): the gate shows, a miss seen within
 * MISS_FRESH_MS (15 minutes), a provider, and the lead's room on screen not
 * running, not failed, not joined, not moved to the phone, intro not marked.
 */
function dialerOffersVideo(
  room: Row | null,
  missAt: number,
  now: number,
  gateShow = true,
): boolean {
  const MISS_FRESH_MS = 15 * MIN;
  const open = Boolean(room && !R.isFinal(room.state as never));
  return (
    gateShow &&
    now - missAt <= MISS_FRESH_MS &&
    !open &&
    room?.state !== "failed" &&
    !R.videoJoinedAt(room as never) &&
    !R.spokeAt(room as never)
  );
}

/**
 * The room worker's status row as the desk writes it (every 25 s while it
 * runs), last written `agoMs` before now: the worker stopped then.
 */
function workerStopped(w: World, agoMs: number) {
  w.db.seed("cockpit_sales_worker_status", [
    {
      worker: "sales-desk",
      job: "rooms",
      ok: true,
      detail: "Working. No rooms were asked for in the last 60 seconds.",
      at: new Date(w.clock.now - agoMs).toISOString(),
    },
  ]);
}

/**
 * Everything the panel says as RoomPanelView draws it: the status sentence,
 * then the health line, which shows under it while the health is not good
 * (and the moment is not making_down, which says it itself).
 */
function panelSays(p: Awaited<ReturnType<typeof panelNow>>): string {
  const h = p.feed.health;
  const red =
    h && R.healthTone(h) !== "good" && p.moment !== "making_down"
      ? ` ${R.panelHealthSentence(h, p.room)}`
      : "";
  return `${p.words}${red}`;
}

// ---------------------------------------------------------------------------
// Control: the setter misses the intro, sends a Meet link, Huda joins, the setter marks it
// ---------------------------------------------------------------------------

describe("control r4: the setter's intro rings out at 10:00 on Maqsam, a Meet link goes by email, the setter opens the room and presses I'm in, Huda is let in, The lead is in, then Finished", () => {
  test("each step says what happened and the one right press; one email, nothing booked or marked by the join", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.words).toMatch(/^Link sent by email at 10:00/);
    expect(stepAfterMiss(p.room, false, { now: w.clock.now }).title).toBe(
      "The video link went",
    );
    w.clock.now += 30 * S;
    await R.roomsApi.open(id);
    await R.roomsApi.mark(p.room, "host_in");
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.primary).toBe("lead_in");
    w.clock.now += 2 * MIN;
    await R.roomsApi.mark(p.room, "lead_in");
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.words).toMatch(/^Huda joined at /);
    expect(R.videoJoinedAt(p.room)).toBeTruthy();
    expect(w.marks).toHaveLength(0);
    w.clock.now += 20 * MIN;
    await R.roomsApi.end(p.room, "finished", true);
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.words).toMatch(/^Finished at /);
    expect(R.videoJoinedAt(p.room)).toBeTruthy();
    expect(w.texts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// J1. The lead never opens: a miss saved by hand (the setter rang from the
// softphone or a mobile, so the dialer holds no Maqsam attempt) carries two links
// ---------------------------------------------------------------------------

describe('journey r4-1: the setter rings Huda for her 10:00 intro from a mobile (Copy the number), nobody answers, and at 10:00:30 the setter picks No answer and presses Save and email them ("No call through the dialer: saved as a call made elsewhere."); the step offers Send a video link, a Meet link goes by email at 10:00:40, Huda never opens it and the room closes; at 10:12 the setter presses Send a video link, Send a Meet link', () => {
  test("control: with the dialer's own Maqsam attempt, the second press is refused with link_already_sent", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const first = await R.roomsApi.create(
      dialerAsk("meet", "intro", appt, att),
    );
    await w.workerOpens(first.room.id);
    for (let i = 0; i < 10; i++) await w.minute(first.room.id);
    w.sweepCloses(first.room.id, {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      error: "Closed: the lead did not join in 10 minutes.",
    });
    w.clock.now = T0 + 12 * MIN;
    let code: string | null = null;
    try {
      await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    } catch (e) {
      code = R.refusalCode(e);
    }
    expect(code).toBe("link_already_sent");
    expect(w.texts).toHaveLength(1);
  });

  test("the same missed call never carries a second 'I just tried to call you' link", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    // DialerPage save(undefined, "message"): no open attempt (the call was
    // not placed through the dialer), so the lead stays on the step with
    // missed.attemptId null, and the video ask carries no attempt_id; the
    // miss is fresh from the save (MISS_FRESH_MS).
    const missAt = T0 + 30 * S;
    w.clock.now = T0 + 40 * S;
    const first = await R.roomsApi.create(
      dialerAsk("meet", "intro", appt, null),
    );
    const id = first.room.id;
    await w.workerOpens(id);
    expect(w.texts).toHaveLength(1);
    for (let i = 0; i < 10; i++) await w.minute(id);
    w.sweepCloses(id, {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      error: "Closed: the lead did not join in 10 minutes.",
    });
    w.clock.now = T0 + 12 * MIN;
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    // The panel: "The room is closed, and Meet cannot say whether Huda came
    // in. If you spoke, say so below; if not, call them now."
    expect(p.words).toMatch(/call them now/);
    // The dialer still offers Send a video link (the step's button).
    expect(dialerOffersVideo(p.room as never, missAt, w.clock.now)).toBe(true);
    let refused: string | null = null;
    try {
      const second = await R.roomsApi.create(
        dialerAsk("meet", "intro", appt, null),
      );
      await w.workerOpens(second.room.id);
    } catch (e) {
      refused = R.refusalCode(e);
    }
    // What happens: rooms.ts createPrep's "one video link per missed call"
    // runs only when the press carries an attempt id, so a second room is
    // made and Huda gets "Hi Huda, it's Tara from Mahara Media. I just tried
    // to call you for your intro call and couldn't get through..." a second
    // time, twelve minutes after the first, for the one call that rang out.
    expect({
      refused,
      fallbackEmails: w.texts.filter(t =>
        /I just tried to call you/.test(String(t.body)),
      ).length,
    }).toEqual({ refused: "link_already_sent", fallbackEmails: 1 });
  });
});

// ---------------------------------------------------------------------------
// J2. The worker stops after the link went: the red line under a working room
// ---------------------------------------------------------------------------

describe("journey r4-2: the setter's Meet link reached Huda by email at 10:00:40; at 10:00 the room worker's last report was written and then the VPS stopped (its cron missed two minutes)", () => {
  test("the panel under Huda's open room never tells the setter to send their own Zoom or Meet link", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    w.clock.now += 60 * S;
    workerStopped(w, 2 * MIN);
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    // The room is fine: its link went and Huda has ten minutes.
    expect(p.moment).toBe("sent");
    expect(p.words).toMatch(/^Link sent by email at 10:00\. Waiting for Huda/);
    expect(p.feed.health?.worker_ok).toBe(false);
    // What the panel draws: "Link sent by email at 10:00. Waiting for Huda."
    // and right under it, red, "Video rooms are not being made (last check
    // 09:59). Call the lead on the phone, or send your own Zoom or Meet
    // link." A setter who follows the red line sends Huda a second link
    // (and a second room) while she may be opening the first.
    expect(panelSays(p)).not.toMatch(/send your own Zoom or Meet link/);
  });
});

// ---------------------------------------------------------------------------
// J3. The worker stops while Huda knocks: "I can't let them in" stays and is refused
// ---------------------------------------------------------------------------

describe("journey r4-3: the setter is in the Meet room (I'm in at 10:01:40) when the room worker stops; at 10:04:40 Huda knocks and the setter cannot let her in", () => {
  test("the panel does not keep offering I can't let them in while sales-api refuses it for the worker every time", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    w.clock.now += 60 * S;
    await R.roomsApi.mark((await panelNow(w, id)).room, "host_in");
    w.clock.now += 3 * MIN;
    workerStopped(w, 4 * MIN);
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    const offeredBefore = p.keys.includes("admit_blocked");
    const refusals: string[] = [];
    for (let i = 0; i < 2; i++) {
      try {
        const out = await R.roomsApi.end(p.room, "admit_blocked");
        const next = R.afterAdmitBlocked(out);
        if (next.kind === "refused") refusals.push(next.text);
      } catch (e) {
        refusals.push(`${R.refusalCode(e)}: ${R.errorText(e)}`);
      }
      w.clock.now += 20 * S;
      p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    }
    // What happens: both presses (each after its five-second Undo) are
    // refused "Video rooms are down right now. Call the lead on the phone,
    // or send your own Zoom or Meet link." (worker_down), the room stays
    // host_in, and the panel offers I can't let them in again, as "Use Meet"
    // and "Try Zoom" are hidden while the worker is down.
    // Round 4 fix: while the worker is down the panel never offers it (as
    // Try Zoom and Use Meet), and says the next step: call them on the
    // phone. A press from an older view is still refused by sales-api.
    expect(offeredBefore).toBe(false);
    expect(refusals).toHaveLength(2);
    expect(refusals[0]).toMatch(/^worker_down/);
    expect(p.keys).not.toContain("admit_blocked");
    expect(p.words).toMatch(/call them on the phone/);
  });
});

// ---------------------------------------------------------------------------
// J4. The worker stops right after the press: the failed room says Try Zoom with no way to
// ---------------------------------------------------------------------------

describe("journey r4-4: the room worker's last report is 85 s old when the setter presses Send a Meet link (sales-api takes it); no worker comes, and the sweep's R1 fails the room at a minute", () => {
  test("the failed room's panel and the banner never say Try Zoom while no Try Zoom can be pressed or made", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    workerStopped(w, 85 * S);
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    w.clock.now += 65 * S;
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    // Control: before the sweep, the panel says the room will not be made.
    expect(p.moment).toBe("making_down");
    // R1 (20261004a): the worker did not pick it up in time.
    w.sweepCloses(id, {
      state: "failed",
      end_reason: "worker_timeout",
      result: "failed",
      error: "Not made: the room worker did not pick this room up in time.",
    });
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    const banner = await bannerNow(w);
    // What happens: the panel says "Meet did not make the room: the room
    // worker did not pick this room up in time. Try Zoom, or call again."
    // with no button at all (Try Zoom is hidden while the health line is
    // red, and the dialer's Send a video link is hidden under a failed
    // room), under the red line "Video rooms are not being made ... Call the
    // lead on the phone"; the banner says "The link to Huda was not sent.
    // ... Try Zoom, or call again. Open the lead." Any Zoom room asked for
    // now waits on the same stopped worker.
    expect(p.moment).toBe("failed");
    expect(p.keys).not.toContain("retry");
    expect(p.words).not.toMatch(/Try Zoom/);
    expect(String(banner.words ?? "")).not.toMatch(/Try Zoom/);
  });
});

// ---------------------------------------------------------------------------
// J5. A closer's Zoom call: the lead drops and comes back to the waiting room
// ---------------------------------------------------------------------------

describe("journey r4-5: the closer, on Huda's lead page after her missed 10:00 demo, sends a Zoom link at 11:05 (manual); Huda waits, is admitted and they talk; at 11:17 her connection drops and Zoom puts her back in the waiting room", () => {
  test("the panel or the banner says Huda is waiting to be let back in", async () => {
    const w = begin({}, closer);
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "stress-m1j4-demo",
        contact_id: LEAD,
        call_type: "demo",
        start_at: new Date(T0).toISOString(),
        end_at: new Date(T0 + 60 * MIN).toISOString(),
        status: "noshow",
        assigned_user_id: "G-closer",
        calendar_id: "cal-demo",
      },
    ]);
    w.clock.now = T0 + 65 * MIN;
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "demo",
      purpose: "manual",
      trigger: "manual",
    });
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    expect(w.texts.map(t => t.channel)).toEqual(["email"]);
    const host = {
      user_name: "Sami Closer",
      id: "Z-closer",
      email: CLOSER,
      user_id: "16778240",
    };
    const lead = { user_name: "Huda", id: "", email: "", user_id: "16779264" };
    w.clock.now += 20 * S;
    await zoomSays(w, id, "meeting.started", null);
    await zoomSays(w, id, "meeting.participant_joined", host);
    w.clock.now += 60 * S;
    await zoomSays(w, id, "meeting.participant_joined_waiting_room", lead);
    let p = await panelNow(w, id);
    // Control: the first knock is said.
    expect(p.words).toBe(
      "The lead is in the waiting room. Admit them in Zoom.",
    );
    w.clock.now += 20 * S;
    await zoomSays(w, id, "meeting.participant_admitted", lead);
    await zoomSays(w, id, "meeting.participant_joined", lead);
    p = await panelNow(w, id);
    expect(p.moment).toBe("joined");
    w.clock.now += 10 * MIN;
    await zoomSays(w, id, "meeting.participant_left", lead);
    w.clock.now += 30 * S;
    await zoomSays(w, id, "meeting.participant_joined_waiting_room", lead);
    w.clock.now += 5 * S;
    p = await panelNow(w, id);
    const banner = await bannerNow(w);
    // What happens: the room stays lead_in and its knock is not even kept
    // (lead_waiting_at is still the first knock's 11:06), so the panel says
    // "The lead joined at 11:06." with only Finished, the banner "Huda
    // joined.", and no call-back reaches a closer who left the Zoom tab
    // when the call dropped (CALL_BACK reads waiting_room, never joined).
    expect(`${p.words} ${banner.words ?? ""}`).toMatch(/waiting room/);
  });
});

// ---------------------------------------------------------------------------
// J6. The pilot's Meet room line waits on a step it can never see
// ---------------------------------------------------------------------------

describe("journey r4-6: short link off (the pilot), the setter's Meet link went by email and the setter pressed I'm in", () => {
  test("the room line's teal current step is the one the room is waiting on (Lead in), never Opened, which Meet's own link never reports", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    w.clock.now += 60 * S;
    await R.roomsApi.mark((await panelNow(w, id)).room, "host_in");
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(R.shortLinkOn(p.room)).toBe(false);
    expect(p.words).toMatch(/^You are in\. Waiting for Huda/);
    // What happens: Link sent done, You're in done, and the teal pulse sits
    // on "Opened", a step no Meet room can fill while the short link is off.
    const current = p.steps.find(s => s.current)?.key ?? null;
    expect(current).not.toBe("opened");
  });
});

// ---------------------------------------------------------------------------
// J7. After Open my room on Meet, the panel's one right press is still Open my room
// ---------------------------------------------------------------------------

describe("journey r4-7: the setter presses Open my room on the dialer's panel (Meet opens in a new tab) and waits there for Huda", () => {
  test("the panel's teal button moves on to I'm in, as the banner says it", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    w.clock.now += 20 * S;
    await R.roomsApi.open(id);
    expect(R.roomOpenedHere(id)).toBe(true);
    w.clock.now += 40 * S;
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    const b = await bannerNow(w);
    // The banner (once the setter is on another lead): "In your Meet room?
    // Open the lead and press I'm in."
    expect(b.words).toBe("In your Meet room? Open the lead and press I'm in.");
    // What happens: the panel's primary is still "Open my room" (a second
    // Meet tab), with I'm in among the quiet buttons.
    expect(p.primary).not.toBe("open");
  });
});
