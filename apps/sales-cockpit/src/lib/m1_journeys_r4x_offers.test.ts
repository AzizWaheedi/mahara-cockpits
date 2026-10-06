// Milestone 1, video-link round 4 (second pass, the offers explorer): end-to-end journeys through the dialer
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
// bun test src/lib/m1_journeys_r4x_offers.test.ts   (from apps/sales-cockpit)
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
const SETTER = "stress-m1j4x-setter@stress.invalid";
const CLOSER = "stress-m1j4x-closer@stress.invalid";
const LEAD = "stress-m1j4x-huda";
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
  const textModes: ("ok" | "lost" | "busy")[] = [];
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
      // HighLevel's burst limit: nothing went, the same key may be asked
      // again (index.ts keeps no row for a send HighLevel refused at once).
      if (mode === "busy")
        throw new ApiRefusal(
          "HighLevel did not send it: HighLevel said 429: Too many requests",
          502,
          { certain: true },
        );
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
function bookIntro(w: World, start: number, id = "stress-m1j4x-appt") {
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
void workerStopped;

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
    // Since round 4: a closed room whose link may have gone holds the offer.
    !R.linkMayHaveGoneClosed(room as never) &&
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
// The offers explorer: every room the journeys reach, and every press its
// panel offers there, pressed (each in a world of its own, built again the
// same way). A press the panel offers and sales-api refuses for a reason
// the panel already knew is a rep stranded on a dead button.
// ---------------------------------------------------------------------------

interface Built {
  w: World;
  id: string;
  ask: Row | null;
  ctx: Row;
}

const DIALER = { canMarkIntro: true, talkBelow: true };
const LEADPAGE = {};

async function meetSent(): Promise<Built> {
  const w = begin();
  const appt = bookIntro(w, T0);
  const att = attempt(w, T0 + 10 * S);
  w.clock.now = T0 + 40 * S;
  const ask = dialerAsk("meet", "intro", appt, att);
  const made = await R.roomsApi.create(ask);
  await w.workerOpens(made.room.id);
  return { w, id: made.room.id, ask: ask as Row, ctx: DIALER };
}

const SCENARIOS: Record<string, () => Promise<Built>> = {
  meet_sent: meetSent,
  meet_host_in: async () => {
    const b = await meetSent();
    b.w.clock.now += 30 * S;
    await R.roomsApi.mark((await panelNow(b.w, b.id)).room, "host_in");
    return b;
  },
  meet_lead_in: async () => {
    const b = await meetSent();
    b.w.clock.now += 30 * S;
    await R.roomsApi.mark((await panelNow(b.w, b.id)).room, "host_in");
    b.w.clock.now += 2 * MIN;
    await R.roomsApi.mark((await panelNow(b.w, b.id)).room, "lead_in");
    return b;
  },
  meet_still_on: async () => {
    const b = await meetSent();
    b.w.clock.now += 30 * S;
    await R.roomsApi.mark((await panelNow(b.w, b.id)).room, "host_in");
    b.w.clock.now += 2 * MIN;
    await R.roomsApi.mark((await panelNow(b.w, b.id)).room, "lead_in");
    b.w.clock.now += 31 * MIN;
    return b;
  },
  meet_expired: async () => {
    const b = await meetSent();
    for (let i = 0; i < 10; i++) await b.w.minute(b.id);
    b.w.sweepCloses(b.id, {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      error: "Closed: the lead did not join in 10 minutes.",
    });
    b.w.clock.now += 30 * S;
    return b;
  },
  meet_retrying: async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    for (let i = 0; i < 20; i++) w.textModes.push("busy");
    const ask = dialerAsk("meet", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    await w.workerOpens(made.room.id);
    await w.minute(made.room.id);
    return { w, id: made.room.id, ask: ask as Row, ctx: DIALER };
  },
  meet_not_sent: async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    for (let i = 0; i < 20; i++) w.textModes.push("busy");
    const ask = dialerAsk("meet", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    await w.workerOpens(made.room.id);
    for (let i = 0; i < 10; i++) await w.minute(made.room.id);
    w.clock.now += 5 * S;
    w.textModes.length = 0;
    return { w, id: made.room.id, ask: ask as Row, ctx: DIALER };
  },
  meet_unclear: async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    w.textModes.push("lost");
    w.convo.unread = true;
    const ask = dialerAsk("meet", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    await w.workerOpens(made.room.id);
    w.clock.now += 20 * S;
    return { w, id: made.room.id, ask: ask as Row, ctx: DIALER };
  },
  zoom_sent: async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const ask = dialerAsk("zoom", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    await w.workerOpens(made.room.id, ZOOM_URL);
    w.clock.now += 40 * S;
    return { w, id: made.room.id, ask: ask as Row, ctx: DIALER };
  },
  zoom_knock: async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const ask = dialerAsk("zoom", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    w.clock.now += 40 * S;
    const host = {
      user_name: "Tara Setter",
      id: "Z-setter",
      email: SETTER,
      user_id: "16778240",
    };
    const lead = { user_name: "Huda", id: "", email: "", user_id: "16779264" };
    await zoomSays(w, id, "meeting.started", null, "Z-setter");
    await zoomSays(w, id, "meeting.participant_joined", host, "Z-setter");
    w.clock.now += 60 * S;
    await zoomSays(
      w,
      id,
      "meeting.participant_joined_waiting_room",
      lead,
      "Z-setter",
    );
    w.clock.now += 10 * S;
    return { w, id, ask: ask as Row, ctx: DIALER };
  },
  failed_meet: async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const ask = dialerAsk("meet", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    const id = made.room.id;
    Object.assign(w.room(id), {
      state: "failed",
      result: "failed",
      error: "Google did not make the Meet link. Try Zoom.",
      ended_at: w.db.iso(),
      version: Number(w.room(id).version) + 1,
    });
    w.clock.now += 5 * S;
    return { w, id, ask: ask as Row, ctx: DIALER };
  },
  making_late: async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const ask = dialerAsk("meet", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    w.clock.now += 3 * MIN;
    return { w, id: made.room.id, ask: ask as Row, ctx: DIALER };
  },
  admit_replacement: async () => {
    const b = await meetSent();
    b.w.clock.now += 30 * S;
    await R.roomsApi.mark((await panelNow(b.w, b.id)).room, "host_in");
    b.w.clock.now += 2 * MIN;
    const out = await R.roomsApi.end(
      (await panelNow(b.w, b.id)).room,
      "admit_blocked",
    );
    const next = R.afterAdmitBlocked(out);
    if (next.kind !== "show") throw new Error(`no replacement: ${next.text}`);
    const nid = next.room.id;
    await b.w.workerOpens(nid, ZOOM_URL);
    b.w.clock.now += 40 * S;
    return { ...b, id: nid };
  },
  leadpage_meet: async () => {
    const w = begin();
    w.clock.now = T0 + 2 * 3_600_000;
    const ask = {
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      trigger: "manual",
    };
    const made = await R.roomsApi.create(ask as never);
    await w.workerOpens(made.room.id);
    w.clock.now += 20 * S;
    return { w, id: made.room.id, ask, ctx: LEADPAGE };
  },
  leadpage_meet_expired: async () => {
    const w = begin();
    w.clock.now = T0 + 2 * 3_600_000;
    const ask = {
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      trigger: "manual",
    };
    const made = await R.roomsApi.create(ask as never);
    const id = made.room.id;
    await w.workerOpens(id);
    for (let i = 0; i < 10; i++) await w.minute(id);
    w.sweepCloses(id, {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      error: "Closed: the lead did not join in 10 minutes.",
    });
    w.clock.now += 30 * S;
    return { w, id, ask, ctx: LEADPAGE };
  },
  zoom_knock_closed: async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const ask = dialerAsk("zoom", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    w.clock.now += 40 * S;
    const lead = { user_name: "Huda", id: "", email: "", user_id: "16779264" };
    await zoomSays(w, id, "meeting.started", null, "Z-setter");
    w.clock.now += 60 * S;
    await zoomSays(
      w,
      id,
      "meeting.participant_joined_waiting_room",
      lead,
      "Z-setter",
    );
    for (let i = 0; i < 9; i++) await w.minute(id);
    w.sweepCloses(id, {
      state: "expired",
      end_reason: "not_admitted",
      result: "admit_blocked",
      error: "Closed: the lead knocked but was not let in.",
    });
    w.clock.now += 30 * S;
    return { w, id, ask: ask as Row, ctx: DIALER };
  },
  link_late_zoom: async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const ask = dialerAsk("zoom", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    await w.workerOpens(made.room.id, ZOOM_URL, false);
    w.clock.now += 3 * MIN;
    return { w, id: made.room.id, ask: ask as Row, ctx: DIALER };
  },
  moved_to_phone: async () => {
    const b = await meetSent();
    b.w.clock.now += 60 * S;
    await R.roomsApi.end((await panelNow(b.w, b.id)).room, "on_phone");
    b.w.clock.now += 5 * S;
    return b;
  },
  joined_finished: async () => {
    const b = await meetSent();
    b.w.clock.now += 30 * S;
    await R.roomsApi.mark((await panelNow(b.w, b.id)).room, "host_in");
    b.w.clock.now += 2 * MIN;
    await R.roomsApi.mark((await panelNow(b.w, b.id)).room, "lead_in");
    b.w.clock.now += 15 * MIN;
    await R.roomsApi.end((await panelNow(b.w, b.id)).room, "finished", true);
    b.w.clock.now += 5 * S;
    return b;
  },
  overdue_meet: async () => {
    const b = await meetSent();
    b.w.clock.now += 14 * MIN;
    return b;
  },
  closer_zoom: async () => {
    const w = begin({}, closer);
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "stress-m1j4x-demo",
        contact_id: LEAD,
        call_type: "demo",
        start_at: new Date(T0).toISOString(),
        end_at: new Date(T0 + 60 * MIN).toISOString(),
        status: "confirmed",
        assigned_user_id: "G-closer",
        calendar_id: "cal-demo",
      },
    ]);
    w.clock.now = T0 + 65 * MIN;
    const ask = {
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "demo",
      purpose: "manual",
      trigger: "manual",
    };
    const made = await R.roomsApi.create(ask as never);
    await w.workerOpens(made.room.id, ZOOM_URL);
    w.clock.now += 40 * S;
    return { w, id: made.room.id, ask, ctx: LEADPAGE };
  },
};

type Press = {
  key: string;
  ok: boolean;
  said: string;
  texts: number;
  after: string | null;
  afterKeys: string[];
};

async function press(b: Built, key: string): Promise<Press> {
  const { w } = b;
  const before = w.texts.length;
  let said = "";
  let ok = true;
  let afterId = b.id;
  try {
    const r = (await panelNow(w, b.id, b.ctx)).room;
    switch (key) {
      case "open":
        await R.roomsApi.open(b.id);
        break;
      case "host_in":
      case "lead_in":
      case "not_lead":
      case "still_on":
        await R.roomsApi.mark(r, key as never);
        break;
      case "finished":
        await R.roomsApi.end(r, "finished", true);
        break;
      case "end":
        await R.roomsApi.end(
          r,
          r.state === "lead_in"
            ? "end"
            : R.isMaking(r.state)
              ? "cancel"
              : "end",
          r.state === "lead_in",
        );
        break;
      case "on_phone":
        await R.roomsApi.end(r, "on_phone");
        break;
      case "admit_blocked": {
        const out = await R.roomsApi.end(r, "admit_blocked");
        const next = R.afterAdmitBlocked(out);
        if (next.kind === "show") afterId = next.room.id;
        else {
          ok = false;
          said = next.text;
        }
        break;
      }
      case "retry": {
        if (R.isFinal(r.state) && r.result === "admit_blocked") {
          const out = await R.roomsApi.end(r, "admit_blocked");
          const next = R.afterAdmitBlocked(out);
          if (next.kind === "show") afterId = next.room.id;
          else {
            ok = false;
            said = next.text;
          }
          break;
        }
        // RoomPanel retry() since m1 round 4c: one room.create naming the
        // room it replaces, never a cancel first (m1 round 5 refuses a
        // create naming a room closed another way).
        const out = await R.roomsApi.create(
          R.retryRequest(r, b.ask as never, R.otherProvider(r.provider)),
        );
        afterId = out.room.id;
        break;
      }
      case "email":
        await R.roomsApi.sendEmail(b.id);
        break;
      default:
        said = "(not pressed here)";
    }
  } catch (e) {
    ok = false;
    said = `${R.refusalCode(e) ?? "?"}: ${R.errorText(e)}`;
  }
  let after: string | null = null;
  let afterKeys: string[] = [];
  try {
    const p = await panelNow(w, afterId, b.ctx);
    after = panelSays(p);
    afterKeys = p.keys;
  } catch (e) {
    after = `unreadable: ${R.errorText(e)}`;
  }
  return { key, ok, said, texts: w.texts.length - before, after, afterKeys };
}

const UI_ONLY = new Set([
  "copy",
  "to_dialer",
  "noshow",
  "showed",
  "count_confirm",
]);

describe("explorer r4x: every press each room's panel offers, pressed", () => {
  for (const [name, build] of Object.entries(SCENARIOS)) {
    test(name, async () => {
      const b = await build();
      const p = await panelNow(b.w, b.id, b.ctx);
      const banner = await bannerNow(b.w);
      const step = stepAfterMiss(p.room, false, {
        now: b.w.clock.now,
        workerDown: p.feed.health?.worker_ok === false,
      });
      const rows: Press[] = [];
      for (const key of p.keys) {
        if (UI_ONLY.has(key)) continue;
        const fresh = await build();
        rows.push(await press(fresh, key));
      }
      const seen = {
        scenario: name,
        moment: p.moment,
        panel: panelSays(p),
        keys: p.labels,
        banner: banner.words,
        bannerAction: banner.action?.label ?? null,
        step: `${step.title} | ${step.text}`,
        presses: rows,
      };
      if (process.env.R4X_SHOW) console.log(JSON.stringify(seen, null, 1));
      // Every room says something, and no press it offers is refused.
      expect(panelSays(p).trim().length).toBeGreaterThan(0);
      expect(rows.filter(r => !r.ok).map(r => `${r.key}: ${r.said}`)).toEqual(
        [],
      );
    }, 60_000);
  }
});

// ---------------------------------------------------------------------------
// J-x2. "I can't let them in", then the Zoom room closes: No-show for a lead who knocked
// ---------------------------------------------------------------------------

describe("journey r4x-2: the setter's Meet room after the missed 10:00 intro; the setter is in (I'm in at 10:01:10), Huda knocks at 10:03 and Meet will not let her in; I can't let them in at 10:03:30; the Zoom room's link goes by email, the setter opens Zoom (Zoom reports the host), calls Huda to tell her and gets no answer; Huda never sees the email and the Zoom room closes at 10:14", () => {
  test("the closed Zoom room and the step under it never offer No-show or say No answer for a lead who knocked on this call's Meet room", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const meetId = made.room.id;
    await w.workerOpens(meetId);
    w.clock.now += 30 * S;
    await R.roomsApi.mark((await panelNow(w, meetId)).room, "host_in");
    w.clock.now = T0 + 3 * MIN + 30 * S;
    const out = await R.roomsApi.end(
      (await panelNow(w, meetId)).room,
      "admit_blocked",
    );
    const next = R.afterAdmitBlocked(out);
    expect(next.kind).toBe("show");
    const zoomId = (next as { room: { id: string } }).room.id;
    await w.workerOpens(zoomId, ZOOM_URL);
    // Control: the panel says Huda is at the Meet door and to call her.
    let p = await panelNow(w, zoomId, { canMarkIntro: true, talkBelow: true });
    expect(p.words).toMatch(/still at the Meet door/);
    w.clock.now += 30 * S;
    const host = {
      user_name: "Tara Setter",
      id: "Z-setter",
      email: SETTER,
      user_id: "16778240",
    };
    await zoomSays(w, zoomId, "meeting.started", null, "Z-setter");
    await zoomSays(w, zoomId, "meeting.participant_joined", host, "Z-setter");
    for (let i = 0; i < 10; i++) await w.minute(zoomId);
    w.sweepCloses(zoomId, {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      error: "Closed: the lead did not join in 10 minutes.",
    });
    w.clock.now += 30 * S;
    p = await panelNow(w, zoomId, { canMarkIntro: true, talkBelow: true });
    const step = stepAfterMiss(p.room, false, { now: w.clock.now });
    expect(p.room.moved_from).toBe("meet");
    // What happens: the dialer's panel (now on the Zoom room) says "Nobody
    // joined in 10 minutes. The room is closed. Mark the intro:" with
    // [No-show] first, and the step under it "No answer. Send them an
    // email?" with the missed-call email: for a lead who came to her intro
    // at 10:03 and could not be let in by our own room. A No-show press
    // writes her a no-show in HighLevel and its automation messages her.
    expect(p.keys).not.toContain("noshow");
    expect(p.words).not.toMatch(/^Nobody joined/);
    expect(step.title).not.toMatch(/^No answer/);
  });
});

// ---------------------------------------------------------------------------
// J-x3. A failed room: Try Zoom on the panel, the missed-call email on the step
// ---------------------------------------------------------------------------

describe("journey r4x-3: the setter's 10:00 intro rings out; the Meet room fails (Google did not make the Meet link) and the panel says Try Zoom", () => {
  test("the step under the panel does not offer the missed-call email beside Try Zoom (both pressed, Huda gets 'I tried to call you' twice in a minute)", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const ask = dialerAsk("meet", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    const id = made.room.id;
    Object.assign(w.room(id), {
      state: "failed",
      result: "failed",
      error: "Google did not make the Meet link. Try Zoom.",
      ended_at: w.db.iso(),
      version: Number(w.room(id).version) + 1,
    });
    w.clock.now += 5 * S;
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.primary).toBe("retry");
    const step = stepAfterMiss(p.room, false, { now: w.clock.now });
    // What happens: the step says "No answer. Send them an email?" and opens
    // the missed-call email; the panel's teal button says Try Zoom, whose
    // email opens "I just tried to call you for your intro call and couldn't
    // get through". A setter who does both (the step first, then the panel)
    // sends Huda two "I tried to call you" emails for one missed call.
    const tryZoom = await R.roomsApi.create(
      R.retryRequest(p.room, ask as never, "zoom"),
    );
    await w.workerOpens(tryZoom.room.id, ZOOM_URL);
    expect(
      w.texts.filter(t => /tried to call you/.test(String(t.body))),
    ).toHaveLength(1);
    expect({ title: step.title, send: step.send }).not.toEqual({
      title: "No answer. Send them an email?",
      send: "email",
    });
  });
});

// ---------------------------------------------------------------------------
// J-x4. A link that may have gone, its room closed: the dialer offers a second one
// ---------------------------------------------------------------------------

describe("journey r4x-4: the setter's 10:00 intro rings out at 10:00:10; the Meet link's email goes to HighLevel at 10:00:40 and its answer is lost, and Huda's conversation cannot be read for the next quarter of an hour; the panel says the link may have gone; the room closes at 10:11; at 10:12 the setter looks at the dialer", () => {
  test("the closed room never leaves the dialer offering a second 'I just tried to call you' link while the first may have reached Huda", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const missAt = T0 + 10 * S;
    const att = attempt(w, missAt);
    w.clock.now = T0 + 40 * S;
    w.textModes.push("lost");
    w.convo.unread = true;
    const ask = dialerAsk("meet", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    const id = made.room.id;
    await w.workerOpens(id);
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    // Control: while the room is open, the panel says to check first.
    expect(p.moment).toBe("unclear");
    for (let i = 0; i < 10; i++) await w.minute(id);
    const r = w.room(id);
    // 20261004a R4 as it reads this row: the link claimed, never recorded
    // as sent, its refusal "may have gone" (not one the minute tries again);
    // with lead_by set the close is the lead's no-show, without it
    // link_not_sent ("unstarted").
    const unstarted =
      !r.link_sent_at && !r.lead_by && Boolean(r.link_claimed_at);
    w.sweepCloses(
      id,
      unstarted
        ? {
            state: "expired",
            end_reason: "link_not_sent",
            result: null,
            error:
              "Closed: the link never reached the lead, so this was no no-show.",
          }
        : {
            state: "expired",
            end_reason: "lead_no_show",
            result: "no_join",
            error: "Closed: the lead did not join in 10 minutes.",
          },
    );
    if (process.env.R4X_SHOW)
      console.log(
        JSON.stringify({ unstarted, lead_by: r.lead_by, refusal: r.refusal }),
      );
    w.clock.now = T0 + 12 * MIN;
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    const offered = dialerOffersVideo(p.room as never, missAt, w.clock.now);
    let second: string | null = null;
    let refused: string | null = null;
    if (offered) {
      try {
        const again = await R.roomsApi.create(ask);
        second = again.room.id;
        await w.workerOpens(second);
      } catch (e) {
        refused = R.refusalCode(e);
      }
    }
    const tried = w.texts.filter(t =>
      /I just tried to call you/.test(String(t.body)),
    );
    // What happens: the first link's answer was never settled (r.link_sent_at
    // stays null, its refusal "may have gone"), so after the close the panel
    // says only "Meet cannot say whether Huda came in", the dialer offers
    // Send a video link, and sales-api's one-link-per-missed-call check
    // (rooms.ts createPrep, which looks only at rooms whose link_sent_at is
    // set) makes a second room: Huda gets "I just tried to call you for your
    // intro call" twice for one missed call, the first link dead.
    expect(r.link_sent_at ?? null).toBeNull();
    expect({
      offered,
      refused,
      second: second !== null,
      emails: tried.length,
    }).toEqual({
      offered: false,
      refused: null,
      second: false,
      emails: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// J-x5. End room a minute into the lead's ten: No-show offered at once
// ---------------------------------------------------------------------------

describe("journey r4x-5: the setter's 10:00 intro rings out; Use Zoom instead, the link goes by email at 10:00:40 ('I'll wait for you for the next 10 minutes'); at 10:01:30 the setter decides not to wait and presses End room", () => {
  test("the panel does not offer No-show inside the ten minutes the lead was promised (the lead may be opening the link now)", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("zoom", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    expect(String(w.texts[0]?.body ?? "")).toMatch(
      /I'll wait for you for the next 10 minutes/,
    );
    w.clock.now = T0 + 90 * S;
    await R.roomsApi.end((await panelNow(w, id)).room, "end");
    w.clock.now += 5 * S;
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    // What happens: "Room ended at 10:01. Nobody joined. Mark the intro:"
    // with [No-show] first, 55 seconds after Huda was told the setter would
    // wait ten minutes. The No-show goes to HighLevel (index.ts holds it only
    // while a room is open, or for five minutes after an open or a knock,
    // and Zoom reports neither before the lead is in the waiting room), and
    // its automation writes "you missed your call" to a lead who may be
    // opening the link that minute: the round-2 rule
    // (noshow-mark-while-video-link-out) undone by one End press.
    expect(p.moment).toBe("ended_empty");
    expect(p.keys).not.toContain("noshow");
  });
});

// ---------------------------------------------------------------------------
// J-x6. The Zoom room in place of a Meet knock fails: Try Meet sends her back
// ---------------------------------------------------------------------------

describe("journey r4x-6: the setter's Meet room after the missed 10:00 intro; the setter is in, Huda knocks at 10:03 and Meet will not let her in; I can't let them in at 10:03:30; Zoom does not make the replacement room (the room worker's Zoom create fails)", () => {
  test("the failed replacement's panel never sends Huda back to Meet with 'I just tried to call you'", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const ask = dialerAsk("meet", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    const meetId = made.room.id;
    await w.workerOpens(meetId);
    w.clock.now += 30 * S;
    await R.roomsApi.mark((await panelNow(w, meetId)).room, "host_in");
    w.clock.now = T0 + 3 * MIN + 30 * S;
    const out = await R.roomsApi.end(
      (await panelNow(w, meetId)).room,
      "admit_blocked",
    );
    const next = R.afterAdmitBlocked(out);
    expect(next.kind).toBe("show");
    const zoomId = (next as { room: { id: string } }).room.id;
    // The room worker's Zoom create fails (worker.failed): the room failed.
    Object.assign(w.room(zoomId), {
      state: "failed",
      result: "failed",
      error: "Zoom did not answer in time",
      ended_at: w.db.iso(),
      version: Number(w.room(zoomId).version) + 1,
    });
    w.clock.now += 20 * S;
    const p = await panelNow(w, zoomId, {
      canMarkIntro: true,
      talkBelow: true,
    });
    expect(p.room.moved_from).toBe("meet");
    // The panel: "Zoom did not make the room: zoom did not answer in time.
    // Try Meet, or call again." with [Try Meet] as its one button.
    const offeredTryMeet = p.keys.includes("retry");
    let words: string | null = null;
    if (offeredTryMeet) {
      const again = await R.roomsApi.create(
        R.retryRequest(p.room, ask as never, "meet"),
      );
      await w.workerOpens(again.room.id);
      words = String(w.texts[w.texts.length - 1]?.body ?? "");
    }
    // What happens: Try Meet makes a new Meet room, and its email opens "Hi
    // Huda, it's Tara from Mahara Media. I just tried to call you for your
    // intro call and couldn't get through." to a lead who has been at the
    // Meet door since 10:03 (no call was missed: she was locked out), and
    // sends her back to the provider the setter could not admit her on.
    expect({ offeredTryMeet, words }).toEqual({
      offeredTryMeet: false,
      words: null,
    });
  });
});

// ---------------------------------------------------------------------------
// J-x7. The sweep is late: the panel says the room should have closed, the step says wait
// ---------------------------------------------------------------------------

describe("journey r4x-7: the setter's Meet link reached Huda by email at 10:00:40; the minute's sweep stops (pg_cron stalled), so at 10:14:40 Huda's room is still open, two minutes past its close", () => {
  test("the step under the panel does not tell the setter to wait for Huda while the panel says the room should have closed", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    w.clock.now += 14 * MIN;
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.moment).toBe("overdue");
    expect(p.words).toBe(
      "This room should have closed. Call the lead, or end the room.",
    );
    const step = stepAfterMiss(p.room, false, { now: w.clock.now });
    // What happens: the step says "The video link went by email at 10:00.
    // Wait for them here, or go to the next lead." under a panel that says
    // the room should have closed and to call the lead: Huda's ten minutes
    // ended four minutes ago.
    expect(step.text).not.toMatch(/Wait for them here/);
  });
});

// ---------------------------------------------------------------------------
// J-x8. The laptop's clock runs slow: the panel counts on the server's, the step on the laptop's
// ---------------------------------------------------------------------------

describe("journey r4x-8: the setter's laptop clock is two minutes slow (the panel corrects for it with room.status's server clock); the worker makes the Meet room at 10:00:40 but its worker.ready never reaches sales-api, so no link is sent", () => {
  test("the step under the panel says the link has not gone when the panel does, never 'on its way, go to the next lead'", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id, MEET_URL, false);
    w.clock.now += 2 * MIN;
    // RoomPanel: now = Date.now() + feed.offset (the server's clock).
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.moment).toBe("link_late");
    // DialerPage missStep: now = Date.now(), the laptop's own clock, plus
    // since the fix the panel's offset to the server's clock (RoomPanel's
    // onFeed), as the panel counts.
    const laptop = w.clock.now - 2 * MIN;
    const offset = 2 * MIN;
    const step = stepAfterMiss(p.room, false, { now: laptop + offset });
    // What happens: the panel says "The link has not gone yet. Read it out:
    // meet.google.com/abc-defg-hij" and the step under it "The video link is
    // on its way to them. Wait for them here, or go to the next lead."
    expect(step.title).not.toBe("The video link is on its way");
  });
});
