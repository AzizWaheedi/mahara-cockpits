// Milestone 1, video-link round 5: end-to-end journeys through the dialer
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
// bun test src/lib/m1_journeys_r5_ui.test.ts   (from apps/sales-cockpit)
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
const SETTER = "stress-m1j5-setter@stress.invalid";
const CLOSER = "stress-m1j5-closer@stress.invalid";
const LEAD = "stress-m1j5-huda";
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
function bookIntro(w: World, start: number, id = "stress-m1j5-appt") {
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

// ---------------------------------------------------------------------------
// J5-1. I can't let them in, the Zoom room is not made, the setter has moved on
// ---------------------------------------------------------------------------

describe("journey r5-1: the setter's Meet link after the missed 10:00 intro; the setter is in at 10:01:10, Huda knocks and Meet will not let her in; I can't let them in at 10:03:10; Zoom does not answer the room worker, so the Zoom room is not made; the setter has pressed Next lead and reads the banner", () => {
  test("the banner never sends the setter back to Meet, the door Huda was locked out of, and says to call her now as the panel does", async () => {
    const b = await meetSent();
    const { w } = b;
    w.clock.now += 30 * S;
    await R.roomsApi.mark((await panelNow(w, b.id)).room, "host_in");
    w.clock.now += 2 * MIN;
    const out = await R.roomsApi.end(
      (await panelNow(w, b.id)).room,
      "admit_blocked",
    );
    const next = R.afterAdmitBlocked(out);
    if (next.kind !== "show") throw new Error(next.text);
    const nid = next.room.id;
    w.clock.now += 5 * S;
    // desk rooms.py SAY["zoom_down"]: the worker's own sentence for the room.
    workerFails(
      w,
      nid,
      "Zoom did not answer. Try again in a minute, or use Meet.",
    );
    w.clock.now += 20 * S;
    const p = await panelNow(w, nid, DIALER_CTX);
    const banner = await bannerNow(w);
    // The panel (on the lead's screen) is right: a call now.
    expect(panelSays(p)).toContain("Call them on the phone now");
    expect(p.keys).not.toContain("retry");
    // What happens: the banner (the seat's one line while the setter works
    // the next lead) reads "The link to Huda was not sent. Zoom did not
    // answer. Try again in a minute, or use Meet. Open the lead." It sends
    // the setter back to a Meet room, the door Huda knocked on and could not
    // get through, and to "try again" a replacement the panel no longer
    // offers; nothing in it says Huda came on time and is waiting for a call.
    expect(banner.words ?? "").not.toMatch(/use Meet|try Meet|try again/i);
    expect(banner.words ?? "").toMatch(/call/i);
  });
});

// ---------------------------------------------------------------------------
// J5-2. The setter rings Huda again while her link is out, and she answers
// ---------------------------------------------------------------------------

describe("journey r5-2: the setter's Meet link reached Huda by email at 10:00:40 after the missed intro; at 10:02 the setter presses Call again (the quiet Call button under the panel), Huda answers and they talk until 10:07; at 10:07:30 the setter saves Held it", () => {
  test("after a five-minute answered call to Huda, the room panel and the banner no longer wait for her on video with Open my room as the one teal button", async () => {
    const b = await meetSent();
    const { w } = b;
    // The re-call through the dialer (dial.call), Maqsam's record of it
    // (dial.status writes call_state and its length), and the setter's save
    // of the intro as held (dial.save on that attempt).
    w.db.seed("cockpit_sales_attempts", [
      {
        id: crypto.randomUUID(),
        contact_id: LEAD,
        rep_email: SETTER,
        item_kind: "intro",
        appointment_id: b.appt,
        started_at: new Date(T0 + 2 * MIN).toISOString(),
        state: "saved",
        outcome: "showed",
        call_state: "completed",
        call_duration_s: 300,
        saved_at: new Date(T0 + 7 * MIN + 30 * S).toISOString(),
      },
    ]);
    w.clock.now = T0 + 7 * MIN + 40 * S;
    await w.minute(b.id, 0);
    // The dialer after the held save: the item is lead work now (kind
    // "lead"), so the panel has no intro marks; its own step is below.
    const p = await panelNow(w, b.id, { talkBelow: true });
    const banner = await bannerNow(w);
    // What happens: the panel still reads "Link sent by email at 10:00.
    // Waiting for Huda." with Open my room as its one teal button, and the
    // banner "Video room: Huda, 3:15 left. Meet lets Huda in only when you
    // are in the room.", while the setter has just finished a five-minute
    // call with her and marked the intro held: nothing in sales-api reads the
    // answered call (rang_at is kept only for a room the lead joined), so the
    // room keeps waiting and tells the setter to go and wait in Meet.
    if (process.env.R5_SHOW)
      console.log(
        JSON.stringify({
          primary: p.primary,
          words: panelSays(p),
          banner: banner.words,
        }),
      );
    expect({
      primary: p.primary,
      words: panelSays(p),
      banner: banner.words,
    }).not.toMatchObject({ primary: "open" });
    expect(panelSays(p)).not.toMatch(/Waiting for Huda/);
    expect(banner.words ?? "").not.toMatch(/left/);
  });

  test("the room the setter and Huda talked past is not closed as Huda's no-show of the video call", async () => {
    const b = await meetSent();
    const { w } = b;
    w.db.seed("cockpit_sales_attempts", [
      {
        id: crypto.randomUUID(),
        contact_id: LEAD,
        rep_email: SETTER,
        item_kind: "intro",
        appointment_id: b.appt,
        started_at: new Date(T0 + 2 * MIN).toISOString(),
        state: "saved",
        outcome: "showed",
        call_state: "completed",
        call_duration_s: 300,
        saved_at: new Date(T0 + 7 * MIN + 30 * S).toISOString(),
      },
    ]);
    for (let i = 0; i < 10; i++) await w.minute(b.id);
    // The sweep's R4 at lead_by, as 20261004a writes it.
    w.sweepCloses(b.id, {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      error: "Closed: the lead did not join in 10 minutes.",
    });
    w.clock.now += 20 * S;
    const p = await panelNow(w, b.id, { talkBelow: true });
    // What happens: the panel under the setter's held intro reads "The room
    // is closed, and Meet cannot say whether Huda came in. If you spoke,
    // save how it went below; if not, call them now.", a question about a
    // talk the setter saved three minutes earlier, and the room's record is
    // Huda's no-show (lead_no_show).
    expect(panelSays(p)).not.toMatch(/call them now|did not join/i);
  });
});

// ---------------------------------------------------------------------------
// J5-6. Huda waited at the Zoom door; the room closed on her knock; a new link
// ---------------------------------------------------------------------------

describe("journey r5-6: the setter's Zoom link (Use Zoom instead) after the missed 10:00 intro reached Huda by email at 10:00:40; she waited in Zoom's waiting room from 10:02, nobody let her in, and the room closed at 10:13 on her knock; at 10:14 the setter, back on Huda, presses Send a video link, which the dialer still offers", () => {
  test("the new link never tells Huda 'I just tried to call you for your intro call and couldn't get through' after she waited at our own door", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const ask = dialerAsk("zoom", "intro", appt, att);
    const made = await R.roomsApi.create(ask);
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    w.clock.now += 80 * S;
    const lead = { user_name: "Huda", id: "", email: "", user_id: "16779264" };
    await zoomSays(w, id, "meeting.participant_jbh_waiting", lead, "Z-setter");
    for (let i = 0; i < 11; i++) await w.minute(id);
    // The sweep's R4 for a knock that stands (20261004a): not_admitted.
    w.sweepCloses(id, {
      state: "expired",
      end_reason: "not_admitted",
      result: "admit_blocked",
      error: "Closed: the lead knocked but was not let in.",
    });
    w.clock.now = T0 + 14 * MIN;
    const p = await panelNow(w, id, DIALER_CTX);
    expect(p.moment).toBe("expired_knocked");
    // The dialer's Send a video link (the miss at 10:00:10 is still fresh).
    expect(
      dialerOffersVideo(p.room as unknown as Row, T0 + 10 * S, w.clock.now),
    ).toBe(true);
    const before = w.texts.length;
    const again = await R.roomsApi.create(
      dialerAsk("zoom", "intro", appt, att),
    );
    await w.workerOpens(
      again.room.id,
      "https://us06web.zoom.us/j/85550000077?pwd=sb",
    );
    const sent = w.texts.slice(before).map(t => String(t.body ?? ""));
    if (process.env.R5_SHOW)
      console.log(
        JSON.stringify(
          {
            step: stepAfterMiss(p.room as unknown as Row, false, {
              now: w.clock.now,
            }),
            sent,
          },
          null,
          1,
        ),
      );
    // What happens: the second email opens "Hi Huda, it's Tara from Mahara
    // Media. I just tried to call you for your intro call and couldn't get
    // through. We can do it on video now instead": the missed-call words of
    // 10:00, sent to a lead who came, waited eleven minutes at the room's
    // door and was never let in, and nobody has called her since.
    expect(sent.length).toBe(1);
    expect(sent.join(" ")).not.toMatch(/tried to call you/i);
  });
});

// ---------------------------------------------------------------------------
// J5-7. The call-now steps send the setter to WhatsApp, which cannot go
// ---------------------------------------------------------------------------

describe("journey r5-7: the pilot (the WhatsApp gate shut, no call_link template live) and Huda has not written in 24 hours; her Meet link went by email after the missed 10:00 intro and the room closed", () => {
  /** The step under the panel with the pilot's channels: WhatsApp reachable but outside its window, no template live, email open. */
  function pilotStep(room: Row | null, now: number, onWhatsApp = true) {
    return afterMiss({
      moment: "missed_call",
      whatsapp: {
        on: true,
        dnd: false,
        reachable: onWhatsApp,
        window: { open: false },
      },
      email: { on: true, dnd: false, reachable: true },
      templatesLive: false,
      messageReady: true,
      video: room as never,
      now,
    });
  }

  test("the steps that end on a message never say to send a WhatsApp that cannot go, and offer the email the plain step offers", async () => {
    // A: the Meet room closed with nothing seen (short link off): "Did you speak on video?".
    const a = await meetSent();
    for (let i = 0; i < 10; i++) await a.w.minute(a.id);
    a.w.sweepCloses(a.id, {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      error: "Closed: the lead did not join in 10 minutes.",
    });
    a.w.clock.now += 20 * S;
    const roomA = (await panelNow(a.w, a.id, DIALER_CTX))
      .room as unknown as Row;
    // B: Huda waited at the Zoom door and the room closed on her knock.
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("zoom", "intro", appt, att));
    await w.workerOpens(made.room.id, ZOOM_URL);
    w.clock.now += 80 * S;
    await zoomSays(
      w,
      made.room.id,
      "meeting.participant_jbh_waiting",
      { user_name: "Huda", id: "", email: "", user_id: "16779264" },
      "Z-setter",
    );
    for (let i = 0; i < 11; i++) await w.minute(made.room.id);
    w.sweepCloses(made.room.id, {
      state: "expired",
      end_reason: "not_admitted",
      result: "admit_blocked",
      error: "Closed: the lead knocked but was not let in.",
    });
    w.clock.now += 20 * S;
    const roomB = (await panelNow(w, made.room.id, DIALER_CTX))
      .room as unknown as Row;
    const plain = pilotStep(null, w.clock.now);
    // The same with a number that is not on WhatsApp at all (any template
    // state): the plain step says email; these steps still say WhatsApp.
    const plainNoWa = pilotStep(null, w.clock.now, false);
    expect(plainNoWa.send).toBe("email");
    const said = [
      pilotStep(roomA, a.w.clock.now),
      pilotStep(roomB, w.clock.now),
      pilotStep(roomA, a.w.clock.now, false),
      pilotStep(roomB, w.clock.now, false),
    ].map(s => ({
      title: s.title,
      text: s.text,
      send: s.send,
    }));
    if (process.env.R5_SHOW)
      console.log(JSON.stringify({ plain, said }, null, 1));
    // The plain step for the same channels knows WhatsApp cannot go: "No
    // answer. Send them an email? ... none is set up yet: send an email
    // instead."
    expect(plain.send).toBe("email");
    // What happens: "Did you speak on video? ... If not, send them a
    // WhatsApp." and "They knocked and were not let in. Call them now. ...
    // if they do not answer, send them a WhatsApp with a new link.", each
    // with its WhatsApp button (send: whatsapp), for a lead WhatsApp cannot
    // reach in the pilot: the setter is sent to a box that cannot send, and
    // never told that email is the way.
    for (const s of said) {
      expect(s.text).not.toMatch(/WhatsApp/);
      expect(s.send).not.toBe("whatsapp");
    }
  });
});

// ---------------------------------------------------------------------------
// J5-8. A second knock in the hour: the replacement's link meets the link cap
// ---------------------------------------------------------------------------

describe("journey r5-8: Huda's 10:00 intro rings out; the Meet link goes at 10:00:40, she knocks and the setter cannot let her in, so I can't let them in at 10:03 moves her to Zoom; she misses that email and the Zoom room closes at 10:13; the setter rings her at 10:20, nobody answers, a new Meet link goes at 10:20:40, she knocks at 10:22 and Meet will not let her in again; I can't let them in at 10:22:30", () => {
  test("the lead knocking on the closed Meet room gets the Zoom room's link, or her Meet room is not closed under her", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const a1 = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const A = await R.roomsApi.create(dialerAsk("meet", "intro", appt, a1));
    await w.workerOpens(A.room.id);
    w.clock.now += 30 * S;
    await R.roomsApi.mark((await panelNow(w, A.room.id)).room, "host_in");
    w.clock.now = T0 + 3 * MIN;
    const outA = await R.roomsApi.end(
      (await panelNow(w, A.room.id)).room,
      "admit_blocked",
    );
    const nextA = R.afterAdmitBlocked(outA);
    if (nextA.kind !== "show") throw new Error(nextA.text);
    const B = nextA.room.id;
    await w.workerOpens(B, ZOOM_URL);
    for (let i = 0; i < 10; i++) await w.minute(B);
    w.sweepCloses(B, {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      error: "Closed: the lead did not join in 10 minutes.",
    });
    // The 10:20 call that rang out, and its link.
    w.clock.now = T0 + 20 * MIN;
    const a2 = attempt(w, w.clock.now);
    w.clock.now += 40 * S;
    expect(
      dialerOffersVideo(
        (await panelNow(w, B, DIALER_CTX)).room as unknown as Row,
        T0 + 20 * MIN + 10 * S,
        w.clock.now,
      ),
    ).toBe(true);
    const C = await R.roomsApi.create(dialerAsk("meet", "intro", appt, a2));
    await w.workerOpens(C.room.id, "https://meet.google.com/xyz-wxyz-xyz");
    w.clock.now += 30 * S;
    await R.roomsApi.mark((await panelNow(w, C.room.id)).room, "host_in");
    w.clock.now = T0 + 22 * MIN + 30 * S;
    const before = w.texts.length;
    const outC = await R.roomsApi.end(
      (await panelNow(w, C.room.id)).room,
      "admit_blocked",
    );
    const nextC = R.afterAdmitBlocked(outC);
    if (nextC.kind !== "show") throw new Error(`no replacement: ${nextC.text}`);
    await w.workerOpens(
      nextC.room.id,
      "https://us06web.zoom.us/j/85550000088?pwd=sb",
    );
    w.clock.now += 10 * S;
    const p = await panelNow(w, nextC.room.id, DIALER_CTX);
    const step = stepAfterMiss(p.room as unknown as Row, false, {
      now: w.clock.now,
    });
    if (process.env.R5_SHOW)
      console.log(
        JSON.stringify(
          {
            meet: w.room(C.room.id).state,
            texts: w.texts.length - before,
            panel: panelSays(p),
            keys: p.labels,
            step,
          },
          null,
          1,
        ),
      );
    // What happens: the Meet room Huda is knocking on is cancelled
    // (admit_blocked) and the Zoom room is made, but its link never goes:
    // "Not sent: this lead has had three call links this hour, so no new one
    // went. Read the code out on the phone. Copy the link and send it
    // another way, or end this room and use Meet, whose link can be read
    // out." The link cap counts the 10:03 replacement as a link of its own
    // and the replacement's create never checks it, so the server closes
    // the door she is at and keeps the new one from her; the code it says to
    // read out is the short link's, which is off, and "use Meet" is the room
    // that would not let her in twice.
    expect(w.texts.length - before).toBe(1);
  });
});

describe("control r5: the setter's intro rings out at 10:00, the Meet link goes by email, the setter is in, Huda is let in, The lead is in, then Finished", () => {
  test("every step says what happened, and the closed room asks how it went", async () => {
    const b = await meetSent();
    const { w } = b;
    expect(panelSays(await panelNow(w, b.id, DIALER_CTX))).toMatch(
      /Link sent by email at 10:00/,
    );
    w.clock.now += 30 * S;
    await R.roomsApi.mark((await panelNow(w, b.id)).room, "host_in");
    w.clock.now += 2 * MIN;
    await R.roomsApi.mark((await panelNow(w, b.id)).room, "lead_in");
    expect((await bannerNow(w)).words).toBe("Huda joined.");
    w.clock.now += 15 * MIN;
    await R.roomsApi.end((await panelNow(w, b.id)).room, "finished", true);
    const p = await panelNow(w, b.id, DIALER_CTX);
    expect(R.videoJoinedAt(p.room)).not.toBeNull();
    expect(w.texts.length).toBe(1);
  });
});
