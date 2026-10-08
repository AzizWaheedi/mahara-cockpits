// Milestone 1, video-link round 3: end-to-end journeys through the dialer
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
// bun test src/lib/m1_journeys_r3_ui.test.ts   (from apps/sales-cockpit)
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
const SETTER = "stress-m1j3-setter@stress.invalid";
const CLOSER = "stress-m1j3-closer@stress.invalid";
const LEAD = "stress-m1j3-huda";
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
function bookIntro(w: World, start: number, id = "stress-m1j3-appt") {
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
// ---------------------------------------------------------------------------
// Round 3 helpers
// ---------------------------------------------------------------------------

/**
 * Whether the dialer offers "Send a video link" now (DialerPage CallPane
 * offerVideo, lines 1828-1837): the gate shows, a miss seen within
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

// ---------------------------------------------------------------------------
// Control: the setter misses the intro, sends a Meet link, Huda joins, the setter marks it
// ---------------------------------------------------------------------------

describe("control r3: the setter's intro rings out at 10:00, a Meet link goes by email, Huda knocks, the setter lets her in and presses The lead is in, then Finished", () => {
  test("each step says what happened and the one right press; nothing is booked or marked by the join", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.words).toMatch(/^Link sent by email at /);
    expect(p.primary).toBe("open");
    expect(stepAfterMiss(p.room, false, { now: w.clock.now }).title).toBe(
      "The video link went",
    );
    w.clock.now += 60 * S;
    await R.roomsApi.mark(p.room, "host_in");
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.primary).toBe("lead_in");
    w.clock.now += 60 * S;
    await R.roomsApi.mark(p.room, "lead_in");
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.moment).toBe("joined");
    expect(p.words).toMatch(/^Huda joined at /);
    expect(w.marks).toHaveLength(0);
    expect(R.videoJoinedAt(p.room)).toBeTruthy();
    w.clock.now += 15 * MIN;
    await R.roomsApi.end(p.room, "finished", true);
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.words).toMatch(/^Finished at /);
    expect(w.texts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// J1. The lead never opens; the room closes; the setter presses Send a Meet link again
// ---------------------------------------------------------------------------

describe("journey r3-1: the setter's intro rings out at 10:00, a Meet link goes by email at 10:00:40, Huda never opens it and the room closes at 10:10:40; at 10:12 the setter presses Send a video link, Send a Meet link", () => {
  test("the press makes a new room or says why not; it is never answered with the closed room in silence", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    const missAt = T0 + 30 * S;
    w.clock.now = T0 + 40 * S;
    const first = await R.roomsApi.create(
      dialerAsk("meet", "intro", appt, att),
    );
    const id = first.room.id;
    await w.workerOpens(id);
    expect(w.texts).toHaveLength(1);
    for (let i = 0; i < 10; i++) await w.minute(id);
    // R4: Huda did not come within her ten minutes (20261004a).
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
    expect(p.moment).toBe("expired_opened");
    // The dialer (same miss, 11.5 minutes ago) offers Send a video link in
    // the band and in the step: the room is final, nothing joined.
    expect(dialerOffersVideo(p.room as never, missAt, w.clock.now)).toBe(true);
    // The setter presses it, then Send a Meet link (VideoPicker make()).
    let answered: Row | null = null;
    let refusal: string | null = null;
    try {
      answered = (
        await R.roomsApi.create(dialerAsk("meet", "intro", appt, att))
      ).room as unknown as Row;
    } catch (e) {
      refusal = R.errorText(e);
    }
    // What happens: sales-api's "one video link per missed call" (rooms.ts
    // createPrep, m1 round 2) answers the fresh press with the closed room;
    // VideoPicker's onRoom puts it back on the panel exactly as it was, no
    // email goes, and nothing on screen says why the press did nothing.
    const silentSameRoom =
      refusal === null &&
      answered !== null &&
      answered.id === id &&
      R.isFinal(answered.state as never);
    expect({
      silentSameRoom,
      newLinks: w.texts.length - 1,
    }).not.toEqual({ silentSameRoom: true, newLinks: 0 });
  });
});

describe("journey r3-1b: the setter's Zoom link (Use Zoom instead) after the missed intro; Huda waits in the waiting room and nobody lets her in; the sweep closes the room", () => {
  test("the panel's 'send a new link' is a press that sends a new link, not the closed room back", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    const missAt = T0 + 30 * S;
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("zoom", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    w.clock.now += 2 * MIN;
    await zoomSays(
      w,
      id,
      "meeting.participant_joined_waiting_room",
      { user_name: "Huda", id: "", email: "" },
      "Z-setter",
    );
    for (let i = 0; i < 9; i++) await w.minute(id);
    // R4 with the knock: not admitted (20261004a).
    w.sweepCloses(id, {
      state: "expired",
      end_reason: "not_admitted",
      result: "no_join",
      error: "Closed: the lead waited and was not let in.",
    });
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    // "Huda knocked at 10:02 and was not let in. Call them now and send a new link."
    expect(p.moment).toBe("expired_knocked");
    expect(p.words).toMatch(/send a new link/);
    expect(dialerOffersVideo(p.room as never, missAt, w.clock.now)).toBe(true);
    let answered: Row | null = null;
    try {
      answered = (
        await R.roomsApi.create(dialerAsk("meet", "intro", appt, att))
      ).room as unknown as Row;
    } catch {
      answered = null;
    }
    // What happens: the press is answered with the closed Zoom room (rooms.ts
    // createPrep's one link per missed call), so the panel shows the same
    // "knocked and was not let in" again, no new link goes, and nothing says
    // a call first is what lets a new link go.
    expect(answered?.id === id && w.texts.length === 1).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// J2. The lead page's Meet link (the pilot's path for the test contact): the room closes with nothing seen
// ---------------------------------------------------------------------------

describe("journey r3-2: the setter, on Huda's lead page, presses Video call, Send a Meet link (manual, the pilot's path without a booked intro); the setter joins the Meet, lets Huda in and they talk, but nobody presses I'm in or The lead is in", () => {
  test("after the timer closes the room, the lead page says what to do if they did speak, not only if they did not", async () => {
    const w = begin();
    w.clock.now = T0 + 5 * MIN;
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      trigger: "manual",
    });
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
    // LeadPage.tsx's RoomPanel: no onMarkIntro, no talkBelow.
    const p = await panelNow(w, id);
    expect(p.moment).toBe("expired_opened");
    // "The room is closed, and Meet cannot say whether Huda came in. If you
    // did not speak, call them now." and no button at all: a setter who did
    // speak (the usual case on Meet, which reports nothing) is told nothing
    // about saving how it went; Book the next call shows only after a join
    // a press recorded (toDialer needs lead_in_at).
    expect(p.words).toMatch(/If you (spoke|did speak)/);
  });
});

// ---------------------------------------------------------------------------
// J3. A closer's missed demo: no video link and no sentence why
// ---------------------------------------------------------------------------

describe("journey r3-3: Huda's demo with the closer starts at 10:00; the closer calls at 10:02 from the dialer and nobody picks up", () => {
  test("the dialer says why there is no video link and what to do instead (the demo's own Zoom link)", async () => {
    const w = begin({}, closer);
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "stress-m1j3-demo",
        contact_id: LEAD,
        call_type: "demo",
        start_at: new Date(T0).toISOString(),
        end_at: new Date(T0 + 60 * MIN).toISOString(),
        status: "confirmed",
        assigned_user_id: "G-closer",
        calendar_id: "cal-demo",
      },
    ]);
    w.clock.now = T0 + 2 * MIN;
    // DialerPage: the demo item's appt.type is "demo", so bookedDemo.
    const gate = VL.videoLinkGate({
      setting: VL.readRoomsSetting({ ...PILOT_ROOMS }),
      contactId: LEAD,
      seatEmail: CLOSER,
      purpose: "fallback",
      bookedIntro: false,
      bookedDemo: true,
      client: false,
      dnd: false,
      country: "KW",
      now: w.clock.now,
      introNow: false,
    });
    expect(gate).toEqual({ show: false, why: "booked_demo" });
    // DialerPage AfterMissStep videoUnread (m1 round 3): ROOMS_UNREAD (the
    // rooms setting unread), else the gate's own line, VL.gateLine: the
    // lead's night (NIGHT_LINE) or the booked demo's own link (DEMO_LINK_LINE).
    const videoUnread = VL.gateLine(gate.why);
    const step = stepAfterMiss(null, false);
    const said = [step.title, step.text, videoUnread ?? ""].join(" ");
    // The step: "No answer. Send them an email? ... send an email instead."
    // Nothing tells the closer that the demo's own Zoom link (in HighLevel's
    // invite) is the video link for this call, which sales-api's refusal
    // says ("Its Zoom link comes from HighLevel").
    expect(said).toMatch(/Zoom link|demo's link|HighLevel/);
  });
});

// ---------------------------------------------------------------------------
// J4. The worker opens the room but its word to sales-api is lost: the panel says the link has not gone
// ---------------------------------------------------------------------------

describe("journey r3-4: the setter's intro rings out; the worker makes the Meet room and opens it, but its worker.ready never reaches sales-api (the VPS lost its connection after the open) and the sweep's replay is late", () => {
  test("the dialer's step under the panel does not say the link is on its way, or offer the next lead, while the panel says it has not gone", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    // Open, but sales-api never told (tell = false): no link claimed, none sent.
    await w.workerOpens(id, MEET_URL, false);
    w.clock.now += 100 * S;
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(w.texts).toHaveLength(0);
    // The panel: "The link has not gone yet. Read it out: abc-defg-hij"
    // (lib/rooms.ts roomMoment link_late, 90 s after the room opened).
    expect(p.moment).toBe("link_late");
    expect(p.words).toMatch(/has not gone yet/);
    const step = stepAfterMiss(p.room, false, {
      now: w.clock.now,
      workerDown: p.feed.health?.worker_ok === false,
    });
    // DialerPage's step right under it (dialerUi afterMiss: a live room with
    // no refusal): "The video link is on its way to them. Wait for them
    // here, or go to the next lead." The rep is told two opposite things,
    // and the step's Next lead leaves a lead who has no link and no call.
    expect(`${step.title}. ${step.text}`).not.toMatch(
      /on its way|go to the next lead/,
    );
  });
});

// ---------------------------------------------------------------------------
// J5. The setter's Zoom link (Use Zoom instead): Huda is in the waiting room
// ---------------------------------------------------------------------------

describe("journey r3-5: the setter's intro rings out; the setter picks Use Zoom instead (their Basic seat takes an intro); the link goes by email; Huda opens it and waits in Zoom's waiting room", () => {
  test("the dialer's step under the panel does not offer the next lead while Huda waits to be admitted", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("zoom", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    expect(w.texts.map(t => t.channel)).toEqual(["email"]);
    w.clock.now += 90 * S;
    await zoomSays(
      w,
      id,
      "meeting.participant_joined_waiting_room",
      { user_name: "Huda", id: "", email: "" },
      "Z-setter",
    );
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    // The panel: "Huda is in the waiting room. Admit them in Zoom."
    expect(p.moment).toBe("waiting_room");
    const step = stepAfterMiss(p.room, false, { now: w.clock.now });
    // The step right under it: "The video link went by email at 10:00.
    // Wait for them here, or go to the next lead." with Next lead beside it,
    // while Huda sits in the waiting room for someone to let her in.
    expect(`${step.title}. ${step.text}`).not.toMatch(/go to the next lead/);
  });
});

// ---------------------------------------------------------------------------
// J6. A Zoom link that is late: the panel says to send it another way, then the late send goes too
// ---------------------------------------------------------------------------

describe("journey r3-6: a closer on Huda's lead page sends a Zoom link (the pilot's closer path); the worker makes the meeting, but its worker.ready forward fails and the sweep's first replay fails too", () => {
  test("once the panel has told the closer to copy the link and send it another way, the late email does not also go (or the panel never says so while a send is still coming)", async () => {
    const w = begin({}, closer);
    w.clock.now = T0 + 2 * 60 * MIN;
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "demo",
      purpose: "manual",
      trigger: "manual",
    });
    const id = made.room.id;
    // The meeting is made and the room opened; the worker's word to
    // sales-api is lost (stored as worker.ready, never handled).
    await w.workerOpens(id, ZOOM_URL, false);
    w.clock.now += 95 * S;
    const p = await panelNow(w, id);
    // "The link has not gone yet. Copy it and send it another way, or end
    // this room and use Meet, whose link can be read out." with Copy link
    // as the primary button: the closer copies the Zoom link and sends it
    // to Huda from their own WhatsApp.
    expect(p.moment).toBe("link_late");
    expect(p.words).toMatch(/send it another way/);
    expect(p.primary).toBe("copy");
    expect(w.texts).toHaveLength(0);
    // The sweep's next minute replays the stored worker.ready (E0), and
    // sales-api sends the link by email as if nothing had been said.
    await w.minute(id);
    const after = await panelNow(w, id);
    // What happens: Huda gets the same Zoom link twice, from the closer's
    // WhatsApp and then "Your Mahara Media call is ready" by email, a minute
    // or more apart, and the panel now says "Link sent by email at ...".
    expect({
      toldToSendItAnotherWay: true,
      systemEmailsAfter: w.texts.length,
      panelNow: after.moment,
    }).not.toMatchObject({ systemEmailsAfter: 1 });
  });
});

void bannerNow;
