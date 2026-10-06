// Milestone 1, video-link round 3 (this run's third pass at the journeys):
// end-to-end journeys through the dialer and the lead page, with the pilot's
// settings (m1-scope.md section 3): rooms on for the test contact only, Meet
// and Zoom on, every send channel on, the WhatsApp gate shut (the link goes
// by email), short link off, count_on_join, settle and wrap off, automatic
// mode off, fallback scope "intro", live handover off, followups.agent off.
//
// The cockpit's own code (lib/rooms.ts, videoLink.ts, dialerUi.ts afterMiss)
// is wired straight into sales-api's real room actions over the shared fakes
// (supabase/functions/sales-api/testfakes.ts), answered the way index.ts
// answers a seat; the message service is a fake that keeps index.ts's rules
// (one request id, one message; a lost answer is "may have gone"; a 429 is a
// refusal the minute's re-ask tries again). The SQL sweep's closes are
// played as 20261004a writes them.
//
// bun test src/lib/m1_journeys_r3b_ui.test.ts   (from apps/sales-cockpit)
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
const SETTER = "stress-m1j3b-setter@stress.invalid";
const CLOSER = "stress-m1j3b-closer@stress.invalid";
const LEAD = "stress-m1j3b-huda";
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
function bookIntro(w: World, start: number, id = "stress-m1j3b-appt") {
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
// Round 3b helpers
// ---------------------------------------------------------------------------

/** Every sentence a screen shows: never empty, never a raw value. */
function sane(text: string | null | undefined): string[] {
  const s = String(text ?? "");
  const bad: string[] = [];
  if (!s.trim()) bad.push("empty");
  if (/\bundefined\b|\bnull\b|\bNaN\b|\[object|Invalid Date/.test(s))
    bad.push(`raw value in "${s}"`);
  if (/ {2,}| \.|\.\./.test(s)) bad.push(`spacing in "${s}"`);
  return bad;
}

// ---------------------------------------------------------------------------
// JA. HighLevel is busy, the link is "tried again in a minute", and the
// setter ends the Meet room before it ever went
// ---------------------------------------------------------------------------

describe("journey r3b-A: the setter's 10:00 intro rings out on Maqsam; the Meet link's email meets HighLevel's burst limit (429) at 10:00:40 and is tried again every minute; at 10:03 the setter gives up waiting, presses End room and goes back to the dialer's step", () => {
  test("the panel and the step under it never say Meet cannot tell whether Huda came in, for a link that never reached her", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    for (let i = 0; i < 20; i++) w.textModes.push("busy");
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    // Control: the link is tried again; the panel says only that.
    expect(p.moment).toBe("retrying");
    expect(p.words).toMatch(/tried again in a minute/);
    await w.minute(id);
    await w.minute(id);
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.moment).toBe("retrying");
    expect(p.keys).toContain("end");
    expect(w.room(id).link_sent_at ?? null).toBeNull();
    // End room (no Undo on it).
    await R.roomsApi.end(p.room, "end");
    w.clock.now += 5 * S;
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    const step = stepAfterMiss(p.room, false, { now: w.clock.now });
    expect(w.room(id).link_sent_at ?? null).toBeNull();
    // What the setter is told for a Meet link that never left HighLevel:
    // the panel "The room is closed, and Meet cannot say whether Huda came
    // in. If you spoke, say so below; if not, call them now." (only "We
    // spoke on the phone" under it), and the dialer's step "Did you speak on
    // video? Meet cannot say whether they came in. If you spoke, save how it
    // went." with Save how it went beside the WhatsApp: a call that never
    // happened offered as one that may have.
    const said = `${p.words} ${step.title} ${step.text}`;
    expect(said).not.toMatch(/Meet cannot say whether/);
    expect(step.title).not.toBe("Did you speak on video?");
    expect(step.talk ?? false).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// JB. Zoom: the lead waits for the host, nobody lets her in, the room closes
// on her knock, and the screens say to send a new link
// ---------------------------------------------------------------------------

describe("journey r3b-B: the setter's 10:00 intro rings out at 10:00:10; the setter picks Use Zoom instead (their Basic seat) and the link goes by email at 10:00:40; Huda opens it at 10:04 and waits for the host, but the setter is on the next lead; the sweep closes the room on her knock at 10:10:41", () => {
  test("the panel and the step tell the setter to send a new link, so the dialer's Send a video link makes one (or nothing says to)", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const missAt = T0 + 10 * S;
    const att = attempt(w, missAt);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("zoom", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    expect(w.texts).toHaveLength(1);
    w.clock.now = T0 + 4 * MIN;
    const lead = { user_name: "Huda", id: "", email: "", user_id: "16779264" };
    await zoomSays(w, id, "meeting.participant_jbh_waiting", lead, "Z-setter");
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.moment).toBe("waiting_room");
    // R4 (20261004a) at lead_by (the link + 10 minutes): a standing knock
    // closes not_admitted, result admit_blocked.
    w.clock.now = T0 + 40 * S + 10 * MIN + 1 * S;
    w.sweepCloses(id, {
      state: "expired",
      end_reason: "not_admitted",
      result: "admit_blocked",
      error: "Closed: the lead knocked but was not let in.",
    });
    w.clock.now += 30 * S;
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    const step = stepAfterMiss(p.room, false, { now: w.clock.now });
    const b = await bannerNow(w);
    expect(p.moment).toBe("expired_knocked");
    const told = `${p.words} ${step.text} ${b.words ?? ""}`;
    const offered = dialerOffersVideo(p.room as never, missAt, w.clock.now);
    let refused: string | null = null;
    let refusedWords: string | null = null;
    try {
      await R.roomsApi.create(dialerAsk("zoom", "intro", appt, att));
    } catch (e) {
      refused = R.refusalCode(e);
      refusedWords = R.errorText(e);
    }
    // What happens (10:11:11): the panel says "Huda knocked at 10:04 and was not let
    // in. Call them now and send a new link.", the step under it "They
    // knocked and were not let in. Call them now; if they do not answer,
    // send them a WhatsApp with a new link.", and the banner the panel's
    // sentence; the dialer offers Send a video link, and the press is
    // refused link_already_sent: "This call's video link went at 10:00.
    // Call them again; a call they miss can carry a new link."
    expect({
      told: /send (them )?(a WhatsApp with )?a new link/i.test(told),
      offered,
      refused,
      refusedWords,
    }).toEqual({
      told: true,
      offered: true,
      refused: null,
      refusedWords: null,
    });
  });
});

// ---------------------------------------------------------------------------
// JC. The intro had on video, a call-back agreed, nobody pressed Finished;
// the call-back rings out
// ---------------------------------------------------------------------------

/**
 * The dialer's step after a miss, as DialerPage CallPane chooses it (lines
 * 2420-2520): the joined step while the lead's room (useLeadRoom: the newest
 * room live.status lists for the lead) has a join, the phone step after We
 * are on the phone, else AfterMissStep (afterMiss).
 */
function dialerStep(
  room: Row | null,
  now: number,
  // Fix round (m1 round 3b): DialerPage ties the joined and phone steps to
  // the call that missed (R.forThisMiss), so the mirror takes the miss too.
  missed: { at: number; attemptId: string | null } | null = null,
) {
  const joinedAt = R.forThisMiss(
    R.videoJoinedAt(room as never),
    room as never,
    missed,
  );
  if (joinedAt)
    return {
      kind: "joined" as const,
      title: "Huda joined the video call. How did the intro go?",
      band: `Joined on video at ${R.clockSec(joinedAt).slice(0, 5)}`,
      whatsapp: false,
    };
  if (R.forThisMiss(R.spokeAt(room as never), room as never, missed))
    return {
      kind: "phone" as const,
      title: "You moved to the phone with Huda.",
      band: null,
      whatsapp: false,
    };
  const s = stepAfterMiss(room, false, { now });
  return {
    kind: "miss" as const,
    title: s.title,
    band: null,
    whatsapp: s.send === "whatsapp",
  };
}

describe("journey r3b-C: Huda's 10:00 intro rings out, the Meet link goes, Huda comes in (The lead is in at 10:03) and they talk; the setter marks it held and sets a call-back for 10:25 to book the demo, then presses Next lead (nobody presses Finished); at 10:25 the setter rings Huda back from the dialer and nobody answers", () => {
  test("the call-back's miss is said as a miss (WhatsApp, a video link), never as 'Huda joined the video call' from the room of 10:03", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    w.clock.now = T0 + 2 * MIN;
    await R.roomsApi.open(id);
    await R.roomsApi.mark((await panelNow(w, id)).room, "host_in");
    w.clock.now = T0 + 3 * MIN;
    await R.roomsApi.mark((await panelNow(w, id)).room, "lead_in");
    // 10:08 Held the intro, 10:09 a call-back for 10:25, Next lead.
    w.clock.now = T0 + 25 * MIN;
    for (let i = 0; i < 1; i++) await w.minute(id, 0);
    // 10:25: Huda's call-back comes up; a fresh pane reads her room from live.status.
    const live = await R.roomsApi.liveStatus();
    const listed = VL.roomForLead(live.rooms, LEAD);
    expect(listed?.id).toBe(id);
    expect(listed?.state).toBe("lead_in");
    // The call at 10:25:00 rings out (Maqsam: No answer at 10:25:40).
    const callBack = attempt(w, w.clock.now);
    w.clock.now += 40 * S;
    const step = dialerStep(listed as never, w.clock.now, {
      at: w.clock.now,
      attemptId: callBack,
    });
    const b = await bannerNow(w);
    // What happens: the band says "Joined on video at 10:03" and the step
    // "Huda joined the video call. How did the intro go?" with Book the
    // demo, Save how it went and Next lead; no missed-call WhatsApp and no
    // Send a video link (the 10:03 room is still open, so video.open hides
    // it), while the banner still says "Huda joined." for a call that rang
    // out twenty minutes after the video call ended.
    expect({ step: step.kind, banner: b.words }).toEqual({
      step: "miss",
      banner: expect.not.stringMatching(/joined/) as unknown as string,
    });
  });
});

describe("journey r3b-C2: the same 10:25 call-back rings out; the setter sees Huda's 10:03 room still on the dialer's panel and presses Finished to close it", () => {
  test("once the old room is finished, the call-back's miss is said as a miss", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    w.clock.now = T0 + 2 * MIN;
    await R.roomsApi.mark((await panelNow(w, id)).room, "host_in");
    w.clock.now = T0 + 3 * MIN;
    await R.roomsApi.mark((await panelNow(w, id)).room, "lead_in");
    w.clock.now = T0 + 25 * MIN;
    const live = await R.roomsApi.liveStatus();
    // useLeadRoom holds the room it saw until another lead takes the pane.
    const held = VL.roomForLead(live.rooms, LEAD) as Row;
    const callBack = attempt(w, w.clock.now);
    w.clock.now += 40 * S;
    // RoomPanel: Finished, after its five-second Undo (confirm: the call is over).
    const out = await R.roomsApi.end(held as never, "finished", true);
    w.clock.now += 5 * S;
    const after = out.room as Row;
    expect(after.state).toBe("ended");
    const step = dialerStep(after, w.clock.now, {
      at: w.clock.now,
      attemptId: callBack,
    });
    // What happens: the room closes "Finished at 10:25." with result joined,
    // and videoJoinedAt still answers 10:03, so the pane keeps "Huda joined
    // the video call. How did the intro go?" for the call that just rang
    // out, with no missed-call message and no Send a video link, until the
    // setter leaves the lead.
    expect(step.kind).toBe("miss");
  });
});

// ---------------------------------------------------------------------------
// JD. The closer's Zoom link cannot reach the lead; Use Meet
// ---------------------------------------------------------------------------

describe("journey r3b-D: the closer, on Huda's lead page at 11:05 after her missed 10:00 demo, sends a Zoom link (manual); HighLevel has no email for Huda and the WhatsApp gate is shut, so nothing can carry it; the closer presses Use Meet", () => {
  test("Use Meet makes a Meet room whose link can be read out, and the panel says what to do with it", async () => {
    const w = begin({ contact: { email: null } }, closer);
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "stress-m1j3b-demo",
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
    const ask = {
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "demo",
      purpose: "manual",
      trigger: "manual",
    } as never;
    const made = await R.roomsApi.create(ask);
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    w.clock.now += 5 * S;
    let p = await panelNow(w, id);
    expect(w.texts).toHaveLength(0);
    for (const bad of [p.words]) expect(sane(bad)).toEqual([]);
    expect(p.moment).toBe("not_sent");
    expect(p.keys).toContain("retry");
    // RoomPanel retry(): a room still open is cancelled first, then the other provider.
    const r = p.room;
    let notice: string | null = null;
    let next: Row | null = null;
    try {
      if (!R.isFinal(r.state)) await R.roomsApi.end(r, "cancel");
      const out = await R.roomsApi.create(R.retryRequest(r, ask, "meet"));
      next = out.room as Row;
    } catch (e) {
      notice = R.errorText(e);
    }
    expect(notice).toBeNull();
    const nid = String(next?.id);
    await w.workerOpens(nid, MEET_URL);
    w.clock.now += 5 * S;
    p = await panelNow(w, nid);
    expect(sane(p.words)).toEqual([]);
    // The Meet link can be read out: the panel says it.
    expect(p.words).toMatch(/Read it out: meet\.google\.com\/abc-defg-hij/);
    expect(w.texts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JE. The worker misses a minute: "will not be made", then it is made
// ---------------------------------------------------------------------------

describe("journey r3b-E: the room worker's last report is 100 s old when the setter presses Send a Meet link at 10:00:40 (room.create takes it); at 10:01:41 the panel says the room will not be made; the worker's next cron run starts at 10:02:00 and polls before the minute's sweep reaches R1", () => {
  // Outside video-link round 3b's list (the worker's late claim of a room
  // the panel already called down): kept, skipped, for the round that takes it.
  test.skip("once the setter is told to call or send their own link, no link of the cockpit's goes to Huda as well", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    workerStopped(w, 100 * S);
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    expect(made.room.state).toBe("requested");
    w.clock.now = T0 + 101 * S;
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    const step = stepAfterMiss(p.room, false, {
      now: w.clock.now,
      workerDown: p.feed.health?.worker_ok === false,
    });
    const told = `${panelSays(p)} ${step.title}. ${step.text}`;
    // Control: the panel and the step say the room will not be made.
    expect(p.moment).toBe("making_down");
    expect(told).toMatch(/will not be made/);
    expect(told).toMatch(/send your own Zoom or Meet link/);
    // 10:02:00: the worker's cron run starts; its first poll (every second)
    // finds the room still requested (STALE_S is 600 s) and claims it before
    // pg_cron's minute reaches R1.
    w.clock.now = T0 + 120 * S;
    w.db.seed("cockpit_sales_worker_status", [
      {
        worker: "sales-desk",
        job: "rooms",
        ok: true,
        detail: "Working.",
        at: w.db.iso(),
      },
    ]);
    await w.workerOpens(id);
    // What happens: the room opens at 10:02:00 and sales-api emails Huda the
    // Meet link ("I just tried to call you..."), after the panel told the
    // setter at 10:01:41 "This room will not be made: video rooms are down.
    // Call the lead on the phone, or send your own Zoom or Meet link." and
    // the step "The video room has not been made, so no link has gone. Call
    // them on the phone.": Huda gets the setter's own link and the
    // cockpit's, two rooms for one missed call.
    expect(w.texts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JF. Control: the closer's Zoom link from the lead page, every screen sane
// ---------------------------------------------------------------------------

describe("control r3b-F: the closer, on Huda's lead page at 11:05 after her missed 10:00 demo, sends a Zoom link; opens the room, Huda waits, is admitted, they talk, the closer ends the meeting in Zoom", () => {
  test("every panel and banner sentence on the way is a plain sentence, and each moment offers a next press or says what to do", async () => {
    const w = begin({}, closer);
    w.db.seed("cockpit_sales_appointments", [
      {
        appointment_id: "stress-m1j3b-demo",
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
    } as never);
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    const seen: string[] = [];
    const look = async (label: string) => {
      const p = await panelNow(w, id);
      const b = await bannerNow(w);
      for (const s of [p.words, b.words]) {
        if (s === null) continue;
        const bad = sane(s);
        if (bad.length) seen.push(`${label}: ${bad.join("; ")}`);
      }
      return p;
    };
    let p = await look("sent");
    expect(p.primary).toBe("open");
    const opened = await R.roomsApi.open(id);
    expect(
      String((opened as Row).start_url ?? (opened as Row).url ?? ""),
    ).not.toBe("");
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
    p = await look("host in");
    w.clock.now += 60 * S;
    await zoomSays(w, id, "meeting.participant_joined_waiting_room", lead);
    p = await look("waiting");
    expect(p.moment).toBe("waiting_room");
    w.clock.now += 20 * S;
    await zoomSays(w, id, "meeting.participant_admitted", lead);
    await zoomSays(w, id, "meeting.participant_joined", lead);
    p = await look("joined");
    expect(p.moment).toBe("joined");
    w.clock.now += 40 * MIN;
    await zoomSays(w, id, "meeting.participant_left", lead);
    await zoomSays(w, id, "meeting.ended", null);
    p = await look("ended");
    expect(p.room.state).toBe("ended");
    expect(p.words).toMatch(/^Finished at /);
    expect(p.keys).toContain("to_dialer");
    expect(seen).toEqual([]);
    expect(w.texts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// JG. The link did not go (said as final) under a room still open
// ---------------------------------------------------------------------------

describe("journey r3b-G: the setter's 10:00 intro rings out; the Meet room opens at 10:00:40 and HighLevel answers every send of the link's email with its 429 for ten minutes; at 10:10:41 the room says the link did not go (final) and to read it out, and the setter looks at the dialer's step under it", () => {
  test("the step under the open room points to the room's link (call and read it out), never the missed-call email without it", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    for (let i = 0; i < 20; i++) w.textModes.push("busy");
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    // The minute's re-ask, ten times (LINK_RETRY_S): then said as final.
    for (let i = 0; i < 10; i++) await w.minute(id);
    w.clock.now += 5 * S;
    const p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.moment).toBe("not_sent");
    expect(p.words).toMatch(
      /^Not sent: HighLevel did not take the link in 10 minutes .*Read it out: meet\.google\.com\/abc-defg-hij$/,
    );
    expect(w.room(id).link_sent_at ?? null).toBeNull();
    // DialerPage missStep under the panel (the email channel is fine as far
    // as the conversation read knows; the gate is shut and no template is live).
    const step = afterMiss({
      moment: "missed_call",
      whatsapp: {
        on: true,
        dnd: false,
        reachable: true,
        window: { open: false },
      },
      email: { on: true, dnd: false, reachable: true },
      templatesLive: false,
      messageReady: true,
      video: p.room as never,
      now: w.clock.now,
    });
    // What happens: "No answer. Send them an email? They have not written in
    // the last 24 hours, so WhatsApp takes only an approved template, and
    // none is set up yet: send an email instead." with Send an email, which
    // opens the missed-call email (no video link in it), under a panel that
    // says the link did not go and to read it out while Huda's room waits
    // (lead_by is now + 10 minutes): the step's email goes through the same
    // HighLevel, and if it does Huda gets "I tried to call you" with no link.
    expect(step.title).not.toMatch(/^No answer\./);
    expect(step.send).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// JH. Control: the setter cannot admit Huda on Meet; the call moves to Zoom
// ---------------------------------------------------------------------------

describe("control r3b-H: the setter's Meet room after the missed 10:00 intro; the setter is in (I'm in at 10:01:40), Huda knocks at 10:03 and Meet will not let the setter admit her; I can't let them in at 10:03:30; the Zoom room's link goes by email, the setter opens it, Huda waits and is admitted", () => {
  test("one Meet email, one 'moved' Zoom email, and each screen says what to do next", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    w.clock.now = T0 + 100 * S;
    await R.roomsApi.open(id);
    await R.roomsApi.mark((await panelNow(w, id)).room, "host_in");
    w.clock.now = T0 + 210 * S;
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.keys).toContain("admit_blocked");
    // The press after its five-second Undo; sales-api makes the Zoom room in
    // the same request and waits for the worker (the test's worker runs
    // after the answer: the room is asked for, then made).
    const out = await R.roomsApi.end(p.room, "admit_blocked");
    const next = R.afterAdmitBlocked(out);
    expect(next.kind).toBe("show");
    const nid = (next as { room: Row }).room.id as string;
    await w.workerOpens(nid, ZOOM_URL);
    w.clock.now += 5 * S;
    p = await panelNow(w, nid, { canMarkIntro: true, talkBelow: true });
    const step = stepAfterMiss(p.room, false, { now: w.clock.now });
    const b = await bannerNow(w);
    for (const s of [p.words, step.title, step.text, b.words])
      expect(sane(s)).toEqual([]);
    expect(w.texts).toHaveLength(2);
    expect(String(w.texts[1]?.body)).toMatch(/Meet would not let you in/);
    expect(String(w.texts[1]?.body)).toContain(ZOOM_URL);
    expect(p.words).toMatch(/still at the Meet door/);
    expect(step.callNow).toBe(true);
    expect(p.primary).toBe("open");
    // Zoom: the setter starts the meeting, Huda knocks and is admitted.
    await R.roomsApi.open(nid);
    const host = {
      user_name: "Tara Setter",
      id: "Z-setter",
      email: SETTER,
      user_id: "16778241",
    };
    const lead = { user_name: "Huda", id: "", email: "", user_id: "16779265" };
    w.clock.now += 20 * S;
    await zoomSays(w, nid, "meeting.started", null, "Z-setter");
    await zoomSays(w, nid, "meeting.participant_joined", host, "Z-setter");
    w.clock.now += 40 * S;
    await zoomSays(
      w,
      nid,
      "meeting.participant_joined_waiting_room",
      lead,
      "Z-setter",
    );
    p = await panelNow(w, nid, { canMarkIntro: true, talkBelow: true });
    expect(p.moment).toBe("waiting_room");
    expect(stepAfterMiss(p.room, false, { now: w.clock.now }).title).toBe(
      "They are in the waiting room",
    );
    w.clock.now += 15 * S;
    await zoomSays(w, nid, "meeting.participant_admitted", lead, "Z-setter");
    await zoomSays(w, nid, "meeting.participant_joined", lead, "Z-setter");
    p = await panelNow(w, nid, { canMarkIntro: true, talkBelow: true });
    expect(p.moment).toBe("joined");
    expect(R.videoJoinedAt(p.room)).toBeTruthy();
    expect(w.marks).toHaveLength(0);
    expect(w.texts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// JI. Short link off: the Meet link went, the setter goes to the next lead
// ---------------------------------------------------------------------------

describe("journey r3b-I: short link off (the pilot); the setter's Meet link reaches Huda by email at 10:00:40 ('I'll wait for you for the next 10 minutes'); the step says Wait for them here, or go to the next lead, and the setter rings the next lead; Huda opens the link at 10:04 and asks to join an empty Meet room", () => {
  test("the setter is told to be in the room for Huda (or is told afterwards that she may have knocked), never left with nothing", async () => {
    const w = begin();
    const appt = bookIntro(w, T0);
    const att = attempt(w, T0 + 10 * S);
    w.clock.now = T0 + 40 * S;
    const made = await R.roomsApi.create(dialerAsk("meet", "intro", appt, att));
    const id = made.room.id;
    await w.workerOpens(id);
    expect(String(w.texts[0]?.body)).toMatch(
      /I'll wait for you for the next 10 minutes/,
    );
    w.clock.now += 5 * S;
    let p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    const step = stepAfterMiss(p.room, false, { now: w.clock.now });
    // Control: the step offers the next lead while the link is out.
    expect(step.text).toMatch(/go to the next lead/);
    // 10:04: Huda opens Meet's own link and asks to join; nothing is seen.
    w.clock.now = T0 + 4 * MIN;
    const during = await bannerNow(w);
    p = await panelNow(w, id, { canMarkIntro: true, talkBelow: true });
    expect(p.moment).toBe("sent");
    // R4 at lead_by (the link + 10 minutes): lead_no_show, no_join.
    w.clock.now = T0 + 40 * S + 10 * MIN + 1 * S;
    w.sweepCloses(id, {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      error: "Closed: the lead did not join in 10 minutes.",
    });
    w.clock.now += 30 * S;
    const after = await bannerNow(w);
    // What happens: while the setter is on the next lead the banner says only
    // "Video room: Huda, 6:55 left." (Open my room); nothing says that Meet
    // lets Huda in only once someone is in the room, and Meet never reports
    // her knock. At 10:10:41 the room closes and the banner drops it (a
    // closed Meet room with nothing seen is not kept): Huda, promised "I'll
    // wait for you for the next 10 minutes", asked to join an empty room and
    // nothing ever tells the setter to call her back.
    const toldDuring =
      /in the room|let (her|them) in|join (it|your room)|be there/i.test(
        String(during.words ?? ""),
      );
    const toldAfter = after.room !== null;
    expect({ toldDuring, toldAfter }).not.toEqual({
      toldDuring: false,
      toldAfter: false,
    });
  });
});
