// Milestone 1, video-link round 6: end-to-end journeys through the dialer
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
// bun test src/lib/m1_journeys_r6_ui.test.ts   (from apps/sales-cockpit)
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
const { afterMiss, messagedSinceMiss } = await import("./dialerUi");

const S = 1000;
const MIN = 60 * S;
const SETTER = "stress-m1j6-setter@stress.invalid";
const CLOSER = "stress-m1j6-closer@stress.invalid";
const LEAD = "stress-m1j6-huda";
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
    // The sweep's R3 and R4 close only a room that is still open or has the
    // host in it (20261004a: state in open, host_in); a room closed since
    // (moved to the phone after an answered call, m1 round 5) stays as it is.
    if (!["open", "host_in"].includes(String(r.state))) return;
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
function bookIntro(w: World, start: number, id = "stress-m1j6-appt") {
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
  /** The conversation's own sends (convo.read's sends), for round 6's rule. */
  sends: Row[] = [],
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
    !R.spokeAt(room as never) &&
    // Since round 6 (DialerPage offerVideo): the missed-call message went already.
    !messagedSinceMiss(sends as never, missAt)
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
// Round 5 helpers
// ---------------------------------------------------------------------------

/** The setter's Meet link after the missed 10:00 intro, opened by the worker at 10:00:40. */
async function meetSent(o: Opts = {}) {
  const w = begin(o);
  const appt = bookIntro(w, T0);
  const att = attempt(w, T0 + 10 * S);
  w.clock.now = T0 + 40 * S;
  const ask = dialerAsk("meet", "intro", appt, att);
  const made = await R.roomsApi.create(ask);
  await w.workerOpens(made.room.id);
  return { w, id: made.room.id as string, ask, appt, att };
}

/** The room worker's own failure write on a room it claimed (desk rooms.py fail()). */
function workerFails(w: World, id: string, sentence: string) {
  const r = w.room(id);
  if (r.state === "requested")
    Object.assign(r, {
      state: "creating",
      claimed_at: w.db.iso(),
      worker_run: "run-2",
      version: Number(r.version) + 1,
    });
  Object.assign(w.room(id), {
    state: "failed",
    result: "failed",
    error: sentence,
    ended_at: w.db.iso(),
    version: Number(w.room(id).version) + 1,
  });
}

const DIALER_CTX = { canMarkIntro: true, talkBelow: true };

const closer = {
  signed_in: true,
  seat: true,
  manager: false,
  email: CLOSER,
  name: "Sami Closer",
  role: "closer",
  ghl_user_id: "G-closer",
};
void closer;
void meetSent;
void workerFails;

// ---------------------------------------------------------------------------
// Round 6 helpers
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

const DIALER_PAGE = readFileSync(
  new URL("../pages/DialerPage.tsx", import.meta.url),
  "utf8",
);

/** The keys of one item kind's outcome grid, as DialerPage OUTCOMES lists them. */
function gridKeys(kind: "intro" | "confirm" | "lead"): string[] {
  const start = DIALER_PAGE.indexOf(
    "const OUTCOMES: Record<ItemKind, OutcomeDef[]> = {",
  );
  if (start < 0) throw new Error("OUTCOMES not found in DialerPage.tsx");
  const body = DIALER_PAGE.slice(start, DIALER_PAGE.indexOf("\n};", start));
  if (kind === "lead")
    return [
      "no_answer",
      "callback",
      "booked",
      "not_interested",
      "disqualified",
      "wrong_number",
      "handled",
    ];
  const from = body.indexOf(`${kind}: [`);
  const next =
    kind === "intro" ? body.indexOf("confirm: [", from) : body.length;
  return [...body.slice(from, next).matchAll(/key: "([a-z_]+)"/g)].map(m =>
    String(m[1]),
  );
}

/** The joined step's buttons for a confirm item (DialerPage CallPane, mode "unanswered" and joinedAt). */
function joinedStepConfirmSaves(): string[] {
  const start = DIALER_PAGE.indexOf('mode === "unanswered" && joinedAt ? (');
  const end = DIALER_PAGE.indexOf(
    ') : mode === "unanswered" && spoke ? (',
    start,
  );
  const step = DIALER_PAGE.slice(start, end);
  const confirm = step.slice(
    step.indexOf('{kind === "confirm" ? ('),
    step.indexOf(') : kind === "intro" ? ('),
  );
  return [...confirm.matchAll(/outcome: "([a-z_]+)"/g)].map(m => String(m[1]));
}

const zoomLead = {
  user_name: "Huda",
  id: "",
  email: "",
  user_id: "16779264",
  participant_uuid: "pu-lead",
};
const zoomHost = {
  user_name: "Tara Setter",
  id: "Z-setter",
  email: SETTER,
  user_id: "16778240",
  participant_uuid: "pu-host",
};

// ---------------------------------------------------------------------------
// J6-1. The confirmation call's link invites the call now; the intro is had
// on video half an hour early and the dialer cannot record it
// ---------------------------------------------------------------------------

describe("journey r6-1: Huda's intro is at 10:30; the dialer's confirmation call rings her at 10:00 (half an hour before, dialer.ts), nobody answers, and the setter presses Send a Meet link on the confirm item; the link's email says 'If you have 15 minutes, we can talk on video now'; Huda joins at 10:03 and the setter has the intro with her on video", () => {
  test("a lead who comes to the video call the link invited her to has her intro recorded as had, or the confirmation call's link does not invite her to have the call now", async () => {
    const w = begin();
    const appt = bookIntro(w, T0 + 30 * MIN);
    const att = attempt(w, T0 + 5 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(
      dialerAsk("meet", "confirm", appt, att),
    );
    const id = made.room.id;
    await w.workerOpens(id);
    const body = String(w.texts[0]?.body ?? "");
    w.clock.now += 60 * S;
    await R.roomsApi.mark((await panelNow(w, id)).room, "host_in");
    w.clock.now += 90 * S;
    await R.roomsApi.mark((await panelNow(w, id)).room, "lead_in");
    const joined = (await panelNow(w, id, DIALER_CTX)).room;
    const invitesNow =
      /we can talk on video now|we can do it on video now/i.test(body);
    // What the setter can save for the confirm item after the join: the
    // joined step's own button and the confirm grid behind Save how it went.
    const saves = [
      ...new Set([...joinedStepConfirmSaves(), ...gridKeys("confirm")]),
    ];
    const canRecordHeld = saves.includes("showed");
    if (process.env.R6_SHOW)
      console.log(
        JSON.stringify({
          body,
          joined: R.videoJoinedAt(joined),
          room_appt: joined.appointment_id ?? null,
          saves,
        }),
      );
    // What happens: the confirm item's room never carries the intro
    // (rooms.ts introNow: item_kind confirm), so its link goes with
    // fallback_unbooked ("I tried to call you just now and couldn't get
    // through. If you have 15 minutes, we can talk on video now"); Huda
    // comes and the setter has the intro on video at 10:03. The dialer's
    // joined step for a confirm item asks "Are they coming to the intro?"
    // and offers Confirmed the call; the confirm grid behind Save how it
    // went has Confirmed, No answer, Reschedule, Cancelled and Not coming,
    // never Held it. The intro stays booked for 10:30 and unmarked: the
    // queue brings it back as "Intro call now" (its join rows need the
    // room's appointment_id) and its No-show is taken (the router test
    // m1_journeys_r6_router.test.ts r6-1b).
    expect({
      joined: Boolean(R.videoJoinedAt(joined)),
      invitesNow,
      canRecordHeld,
    }).not.toEqual({
      joined: true,
      invitesNow: true,
      canRecordHeld: false,
    });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// J6-2. The setter's Zoom drops while Huda is in the meeting
// ---------------------------------------------------------------------------

describe("journey r6-2: the setter's Zoom link (Use Zoom instead) after the missed 10:00 intro; Huda waits, the setter admits her at 10:02 and they talk; at 10:07 the setter's laptop sleeps and Zoom reports the host left; Huda stays in the meeting; the setter wakes at 10:09 and looks at the dialer's room panel", () => {
  test("the panel says the setter is out of the call Huda is still in, and offers the way back in (Open my room)", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("zoom", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    w.clock.now += 60 * S;
    await zoomSays(w, id, "meeting.started", null, "Z-setter");
    await zoomSays(w, id, "meeting.participant_joined", zoomHost, "Z-setter");
    w.clock.now += 20 * S;
    await zoomSays(
      w,
      id,
      "meeting.participant_joined_waiting_room",
      zoomLead,
      "Z-setter",
    );
    w.clock.now += 20 * S;
    await zoomSays(w, id, "meeting.participant_joined", zoomLead, "Z-setter");
    w.clock.now += 5 * MIN;
    await zoomSays(w, id, "meeting.participant_left", zoomHost, "Z-setter");
    w.clock.now += 2 * MIN;
    await w.minute(id, 0);
    const p = await panelNow(w, id, DIALER_CTX);
    const b = await bannerNow(w);
    // The server holds the way back in: room.open answers the host link.
    let opens = "";
    try {
      opens = (await R.roomsApi.open(id)).start_url;
    } catch (e) {
      opens = `refused: ${R.errorText(e)}`;
    }
    if (process.env.R6_SHOW)
      console.log(
        JSON.stringify({
          host_left_at: w.room(id).host_left_at,
          panel: panelSays(p),
          keys: p.labels,
          banner: b.words,
          bannerAction: b.action?.label ?? null,
          opens,
        }),
      );
    // What happens: Zoom's host leave lands on the lead_in room as
    // host_left_at (roomlogic host_left keeps the state), the view never
    // carries it (no host_left_at in ROOM_VIEW_KEYS), and the joined
    // moment's presses are That was not the lead and Finished only
    // (roomActions "joined"): the panel says "Huda joined at 10:02." with
    // Finished, the banner "Huda joined." with Open the lead, which shows
    // the same panel. room.open would answer the host link, but no screen
    // offers it, so a setter whose Zoom window is gone has no way back to
    // the meeting Huda is waiting in.
    expect(w.room(id).host_left_at).toBeTruthy();
    expect(opens.startsWith("https://")).toBe(true);
    expect(p.keys).toContain("open");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// J6-3. The missed-call email first, then the video link: two "I tried to
// call you" messages for one missed call
// ---------------------------------------------------------------------------

describe("journey r6-3: Huda's 10:00 intro rings out on Maqsam at 10:00:10 and Maqsam's record saves No answer; the step after the miss says 'No answer. Send them an email?' with the missed-call message ready, and Send a video link beside it; the setter sends the missed-call email at 10:00:30 from the conversation box, then presses Send a video link, Send a Meet link at 10:00:50", () => {
  test("Huda gets one 'I tried to call you' message for the one missed call: after the missed-call message went, the step no longer offers a video link that says it again", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 20 * S;
    const missAt = w.clock.now;
    // The plain step after the miss (no room yet): the missed-call email.
    const before = stepAfterMiss(null, false, { now: w.clock.now });
    // The setter sends it from the conversation box (index.ts convo.send,
    // the message service's own send: no room, no link).
    w.clock.now += 10 * S;
    w.texts.push({
      who: SETTER,
      channel: "email",
      body: "Hi Huda, it's Tara from Mahara Media. I tried to call you for your intro call just now and couldn't reach you. When is a good time to call you back?",
      mode: "ok",
      request_id: crypto.randomUUID(),
    });
    // The same send as convo.read lists it on the page (its sends).
    const sends: Row[] = [
      {
        source: "rep",
        state: "sent",
        channel: "email",
        created_at: new Date(w.clock.now).toISOString(),
      },
    ];
    // The dialer's Send a video link after it (nothing on the page knows the
    // message went: offerVideo reads the room, the miss and the gate).
    w.clock.now += 20 * S;
    const stillOffered = dialerOffersVideo(
      null,
      missAt,
      w.clock.now,
      true,
      sends,
    );
    if (stillOffered) {
      const made = await R.roomsApi.create(
        dialerAsk("meet", "intro", appt, att),
      );
      await w.workerOpens(made.room.id);
    }
    const toldTried = w.texts.filter(
      t => t.mode !== "busy" && /tried to call you/i.test(String(t.body ?? "")),
    );
    if (process.env.R6_SHOW)
      console.log(
        JSON.stringify({
          before,
          stillOffered,
          sent: toldTried.map(t => String(t.body).slice(0, 90)),
        }),
      );
    // What happens: the step offers the missed-call email (send: email) and,
    // after it went, the dialer still offers Send a video link (DialerPage
    // offerVideo has no input for a message sent since the miss), and
    // room.create checks nothing the lead was sent: Huda gets "I tried to
    // call you for your intro call..." at 10:00:30 and "I just tried to call
    // you for your intro call and couldn't get through. We can do it on
    // video now instead" at 10:00:50, two messages for one missed call (the
    // reverse order, a link first, is held since stress2 round 2).
    expect(before.send).toBe("email");
    expect(toldTried.length).toBe(1);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// J6-4. The pilot's test contact without a booked intro: the dialer hides
// Send a video link and says nothing
// ---------------------------------------------------------------------------

describe("journey r6-4: the pilot (fallback scope 'intro', m1-scope.md section 3); the setter rings the test contact, who has no booked intro, from the dialer and nobody answers", () => {
  test("the dialer's step says why no video link is offered and where to send one (the lead page's Video call), as it does for a booked demo and the lead's night", async () => {
    const w = begin();
    w.clock.now = T0 + 2 * 3_600_000;
    const gate = VL.videoLinkGate({
      setting: PILOT_ROOMS as never,
      contactId: LEAD,
      seatEmail: SETTER,
      purpose: "fallback",
      bookedIntro: false,
      bookedDemo: false,
      client: false,
      dnd: false,
      country: "KW",
      phone: "+96550000000",
      now: w.clock.now,
      introNow: false,
    });
    // What the step under the miss says where the button would be
    // (DialerPage AfterMissStep videoUnread: gateLine(gate.why)).
    const said = VL.gateLine(gate.why);
    // The lead page would make the link (manual): the pilot's own path.
    const manual = VL.videoLinkGate({
      setting: PILOT_ROOMS as never,
      contactId: LEAD,
      seatEmail: SETTER,
      purpose: "manual",
      client: false,
      dnd: false,
      bookedDemo: false,
    });
    if (process.env.R6_SHOW)
      console.log(JSON.stringify({ gate, said, manual }));
    // What happens: the gate hides the button (why "scope") and gateLine
    // has a sentence only for lead_night and booked_demo, so the step after
    // the miss shows the missed-call message and nothing about video; the
    // pilot's setter is never told the link goes from the lead page (where
    // the gate shows it) or that the dialer's links are for booked intros.
    expect(gate).toEqual({ show: false, why: "scope" });
    expect(manual.show).toBe(true);
    expect(said).not.toBeNull();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// The journeys explorer: seeded random journeys from a missed call, with the
// sweep's closes played by the screens' own reading of its rules
// (roomClock.ts), checked after every step. Run with R6_EXPLORE=n.
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const LETTERS = "abcdefghijkmnopqrstuvwxyz";
function meetUrl(r: () => number) {
  const p = (n: number) =>
    Array.from(
      { length: n },
      () => LETTERS[Math.floor(r() * LETTERS.length)],
    ).join("");
  return `https://meet.google.com/${p(3)}-${p(4)}-${p(3)}`;
}

const UI_ONLY_KEYS = new Set([
  "copy",
  "to_dialer",
  "noshow",
  "showed",
  "count_confirm",
]);

async function sweepPlay(w: World, id: string) {
  const r = w.room(id);
  const view = (await panelNow(w, id)).room;
  if (["open", "host_in"].includes(String(r.state))) {
    const d = (await import("./roomClock")).roomDeadline(view as never);
    if (d !== null && w.clock.now >= d) {
      const knocked = Boolean(r.lead_waiting_at);
      const sent = Boolean(r.link_sent_at);
      const unsent = !sent && !/may have gone/i.test(String(r.refusal ?? ""));
      w.sweepCloses(id, {
        state: "expired",
        end_reason: knocked
          ? "not_admitted"
          : unsent
            ? "link_not_sent"
            : r.state === "open" && !r.host_in_at
              ? "lead_no_show"
              : "lead_no_show",
        result: knocked ? "admit_blocked" : unsent ? null : "no_join",
        error: knocked
          ? "Closed: the lead knocked but was not let in."
          : "Closed: the lead did not join in 10 minutes.",
      });
    }
  } else if (r.state === "lead_in") {
    const ends = Date.parse(String(r.ends_at ?? ""));
    if (Number.isFinite(ends) && w.clock.now >= ends + 30 * MIN)
      Object.assign(r, {
        state: "ended",
        result: "joined",
        end_reason: "no_end_signal",
        ended_at: w.db.iso(),
        version: Number(r.version) + 1,
      });
  }
}

describe("explorer r6: random journeys after a missed intro call", () => {
  const n = Number(process.env.R6_EXPLORE ?? 0);
  test.skipIf(!n)(
    "journeys hold",
    async () => {
      const problems: string[] = [];
      for (let seed = 1; seed <= n; seed++) {
        const r = rng(seed * 7919);
        const zoom = r() < 0.5;
        const w = begin();
        const appt = bookIntro(w, T0);
        const att = attempt(w, T0 + 10 * S);
        w.clock.now = T0 + 40 * S;
        const mode = r();
        if (mode < 0.15) for (let i = 0; i < 3; i++) w.textModes.push("busy");
        else if (mode < 0.25) w.textModes.push("lost");
        if (r() < 0.15) w.convo.unread = true;
        const url = zoom
          ? `https://us06web.zoom.us/j/8555${Math.floor(r() * 1e7)}?pwd=sb`
          : meetUrl(r);
        let id: string;
        try {
          id = (
            await R.roomsApi.create(
              dialerAsk(zoom ? "zoom" : "meet", "intro", appt, att),
            )
          ).room.id;
        } catch (e) {
          problems.push(`seed ${seed}: create refused: ${R.errorText(e)}`);
          continue;
        }
        await w.workerOpens(id, url);
        const log: string[] = [];
        const lead = {
          user_name: "Huda",
          id: "",
          email: "",
          user_id: "16779264",
          participant_uuid: "pu-lead",
        };
        const host = {
          user_name: "Tara Setter",
          id: "Z-setter",
          email: SETTER,
          user_id: "16778240",
          participant_uuid: "pu-host",
        };
        for (let step = 0; step < 22; step++) {
          const cur = w.room(id);
          if (!cur) break;
          const x = r();
          let did = "";
          if (x < 0.35) {
            const by = (20 + Math.floor(r() * 100)) * S;
            await w.minute(id, by);
            w.convo.unread = w.convo.unread && r() < 0.7;
            await sweepPlay(w, id);
            did = `+${by / S}s`;
          } else if (x < 0.65) {
            const p = await panelNow(w, id, DIALER_CTX);
            const keys = p.keys.filter(k => !UI_ONLY_KEYS.has(k));
            if (!keys.length) continue;
            const key = keys[Math.floor(r() * keys.length)] as string;
            did = `press ${key}`;
            try {
              const room = p.room;
              switch (key) {
                case "open":
                  await R.roomsApi.open(id);
                  break;
                case "host_in":
                case "lead_in":
                case "not_lead":
                case "still_on":
                  await R.roomsApi.mark(room, key as never);
                  break;
                case "finished":
                  await R.roomsApi.end(room, "finished", true);
                  break;
                case "end":
                  await R.roomsApi.end(
                    room,
                    room.state === "lead_in"
                      ? "end"
                      : R.isMaking(room.state)
                        ? "cancel"
                        : "end",
                    room.state === "lead_in",
                  );
                  break;
                case "on_phone":
                  await R.roomsApi.end(room, "on_phone");
                  break;
                case "admit_blocked": {
                  const out = await R.roomsApi.end(room, "admit_blocked");
                  const next = R.afterAdmitBlocked(out);
                  if (next.kind === "show") {
                    id = next.room.id;
                    await w.workerOpens(
                      id,
                      zoom
                        ? meetUrl(r)
                        : `https://us06web.zoom.us/j/8556${Math.floor(r() * 1e7)}?pwd=sb`,
                    );
                  } else did += ` -> ${next.text}`;
                  break;
                }
                case "retry": {
                  const out = await R.roomsApi.create(
                    R.retryRequest(room, null, R.otherProvider(room.provider)),
                  );
                  id = out.room.id;
                  await w.workerOpens(
                    id,
                    room.provider === "zoom"
                      ? meetUrl(r)
                      : `https://us06web.zoom.us/j/8557${Math.floor(r() * 1e7)}?pwd=sb`,
                  );
                  break;
                }
                case "email":
                  await R.roomsApi.sendEmail(id);
                  break;
                default:
                  did += " (skipped)";
              }
            } catch (e) {
              const msg = `${R.refusalCode(e) ?? "?"}: ${R.errorText(e)}`;
              did += ` REFUSED ${msg}`;
              if (!/may have gone|tried again|in a minute/i.test(msg))
                problems.push(
                  `seed ${seed} step ${step}: offered ${key} refused: ${msg} | ${log.slice(-6).join(" ; ")}`,
                );
            }
          } else if (zoom) {
            const y = r();
            const room = w.room(id);
            const zs = async (ev: string, who: Row | null) => {
              try {
                await zoomSays(w, id, ev, who, "Z-setter");
              } catch (e) {
                did += ` (zoom ${ev}: ${R.errorText(e)})`;
              }
            };
            if (y < 0.3)
              await zs("meeting.participant_joined_waiting_room", lead);
            else if (y < 0.5) {
              await zs("meeting.started", null);
              await zs("meeting.participant_joined", host);
            } else if (y < 0.7) await zs("meeting.participant_joined", lead);
            else if (y < 0.8) await zs("meeting.participant_left", lead);
            else if (y < 0.9) await zs("meeting.participant_left", host);
            else if (room?.state === "lead_in" || room?.state === "host_in")
              await zs("meeting.ended", null);
            did = `zoom ${y.toFixed(2)}${did}`;
          } else {
            w.clock.now += 10 * S;
            did = "+10s";
          }
          const p = await panelNow(w, id, DIALER_CTX);
          const said = panelSays(p);
          const st = stepAfterMiss(p.room as Row, false, {
            now: w.clock.now,
            workerDown: p.feed.health?.worker_ok === false,
          });
          const b = await bannerNow(w);
          log.push(
            `${did} => [${p.room.state}/${p.moment}] ${said} | step: ${st.title} | banner: ${b.words ?? "-"} | keys ${p.keys.join(",")}`,
          );
          if (
            /\bundefined\b|\bnull\b|\bNaN\b|Invalid Date|\[object/.test(
              `${said} ${st.text} ${b.words ?? ""}`,
            )
          )
            problems.push(
              `seed ${seed} step ${step}: bad words: ${log.at(-1)}`,
            );
          if (/ {2,}|\.\./.test(said))
            problems.push(`seed ${seed} step ${step}: spacing: ${said}`);
          if (
            /call (them|huda|the lead)( now| on the phone)/i.test(said) &&
            /go to the next lead/i.test(st.text)
          )
            problems.push(
              `seed ${seed} step ${step}: panel says call, step says next lead: ${log.at(-1)}`,
            );
          if (!R.isFinal(p.room.state) && !b.words)
            problems.push(
              `seed ${seed} step ${step}: open room, no banner: ${log.at(-1)}`,
            );
        }
        if (process.env.R6_LOG && Number(process.env.R6_LOG) === seed)
          console.log(log.join("\n"));
        // One message per room and lane: what went (or may have) carrying each room's link.
        const rooms = w.db.t("cockpit_sales_rooms") as Row[];
        for (const room of rooms) {
          const u = String(room.join_url ?? "");
          if (!u) continue;
          const went = w.texts.filter(
            t => String(t.body ?? "").includes(u) && t.mode !== "busy",
          );
          if (went.length > 1)
            problems.push(
              `seed ${seed}: ${went.length} messages for room ${room.code}: ${log.join(" ; ")}`,
            );
        }
      }
      if (problems.length) console.log(problems.join("\n\n"));
      expect(problems).toEqual([]);
    },
    600_000,
  );
});
