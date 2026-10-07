// Stress series 2, round 3: end-to-end journeys through the cockpit's own
// press code (lib/rooms.ts roomsApi, stripLine, roomActions, the banner's
// bannerRoomSentence and bannerRoomAction, dialerUi afterMiss) and
// sales-api's real room actions (supabase/functions/sales-api/rooms.ts) over
// the shared fakes (testfakes.ts). The browser's `api` is routed straight
// into sales-api's handlers, answered the way index.ts answers a seat, so
// what the rep sees at each step is what the two halves do together. The SQL
// sweep's closes are written onto the rows the way 20261004a writes them;
// Zoom's webhooks go through room.event as the door forwards them.
//
// bun test src/lib/stress2_journeys_r3_ui.test.ts   (from apps/sales-cockpit)
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
  // Automatic mode on: these journeys run it (it ships off, Milestone 1).
  fallback: {
    ...DEFAULT_ROOMS_JSON.fallback,
    scope: "any",
    auto_on_miss: true,
  },
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

void roomForLead;

// ---------------------------------------------------------------------------
// Round 3 helpers
// ---------------------------------------------------------------------------

/** Zoom's webhook for a room's own meeting, stored by the door and forwarded to sales-api. */
async function zoomSays(
  w: World,
  roomId: string,
  event: string,
  participant: Row | null,
) {
  const id = fakeUuid();
  w.db.seed("cockpit_sales_room_events", [
    {
      id,
      room_id: roomId,
      kind: `zoom.${event}`,
      source: "zoom",
      dedupe_key: `zoom:${event}:${id}`,
      detail: {
        event,
        event_ts: w.clock.now,
        payload: {
          object: {
            id: String(w.room(roomId).provider_meeting_id ?? ""),
            host_id: "Z-closer",
            topic: "Mahara call",
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

const HOURS2 = 2 * 3_600_000;

/** A closer, Available, in a Zoom standby room the worker made. */
async function closerInStandby(w: World): Promise<string> {
  await R.roomsApi.availability("available");
  const sb = w.db
    .t("cockpit_sales_rooms")
    .find((r: Row) => r.purpose === "standby") as Row;
  expect(sb?.provider).toBe("zoom");
  await w.workerOpens(String(sb.id), ZOOM_URL);
  await R.roomsApi.open(String(sb.id));
  await zoomSays(w, String(sb.id), "meeting.participant_joined", {
    id: "Z-closer",
    user_name: "Sami",
  });
  expect(w.room(String(sb.id)).state).toBe("host_in");
  return String(sb.id);
}

/** The view (20261004a) for an Available seat with no standby room. */
function closerAvailable(w: World) {
  w.presenceRow(CLOSER, {
    state: "available",
    until: new Date(w.clock.now + HOURS2).toISOString(),
    zoom_status: "licensed",
    default_provider: "zoom",
  });
}

const FLOOD = /closed under 10 minutes ago/;

// ---------------------------------------------------------------------------
// Journey: a closer is Available, sends a lead a link, then wants the room back
// ---------------------------------------------------------------------------

describe("journey: a closer in their standby room sends a lead a video link, the call moves to the phone, then presses Get my room", () => {
  test("Get my room must make a standby room, not refuse it as if Set me away had closed the last one", async () => {
    const w = begin({}, closer);
    const sb = await closerInStandby(w);
    // 10:01: a lead the closer is working wants a video call: Send a video
    // link on the lead page. room.create ends the standby room for it
    // (rooms.ts endStandbyFor, its timeline line "Your standby room was
    // closed so you could send a lead a video link. Press Get my room on the
    // strip after the call.") and makes the lead's room.
    w.clock.now += MIN;
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "demo",
      purpose: "manual",
      trigger: "manual",
    });
    expect(w.room(sb).state).toBe("ended");
    await w.workerOpens(made.room.id, ZOOM_URL);
    // 10:04: the lead rings back; We are on the phone.
    w.clock.now += 3 * MIN;
    const p = await panelNow(w, made.room.id);
    await R.roomsApi.end(p.room, "on_phone");
    closerAvailable(w);
    const before = await stripNow(w);
    // "Available until 12:04." [Get my room] [Set me away]
    expect(before.line.primary?.key).toBe("available");
    await R.roomsApi.availability("available");
    const after = await stripNow(w);
    // Said: "Your last standby room closed under 10 minutes ago, so no new
    // one was made yet. Try again in a few minutes. You can still take a live
    // lead now." The room was closed by the cockpit for the lead's room, not
    // by Away; the strip's own button, and the line the room's timeline
    // gives, lead straight to this refusal (liveAvailability gives a fresh
    // try only to a failed room or one the sweep closed for no host).
    const fresh = w.db
      .t("cockpit_sales_rooms")
      .filter((r: Row) => r.purpose === "standby" && r.id !== sb);
    expect({ words: after.words, fresh: fresh.length }).toEqual({
      words: expect.not.stringMatching(FLOOD),
      fresh: 1,
    });
  });

  test("the same after Zoom ends the standby meeting the closer left (meeting.ended), then Get my room", async () => {
    const w = begin({}, closer);
    const sb = await closerInStandby(w);
    // 10:03 the closer leaves Zoom by mistake; alone in it, Zoom ends the
    // meeting: the standby room ends (roomlogic meeting_ended, no lead).
    w.clock.now += 3 * MIN;
    await zoomSays(w, sb, "meeting.participant_left", {
      id: "Z-closer",
      user_name: "Sami",
      leave_time: w.db.iso(),
    });
    await zoomSays(w, sb, "meeting.ended", null);
    expect(w.room(sb).state).toBe("ended");
    closerAvailable(w);
    const before = await stripNow(w);
    expect(before.line.primary?.key).toBe("available");
    await R.roomsApi.availability("available");
    const after = await stripNow(w);
    expect(after.words).not.toMatch(FLOOD);
  });
});

// ---------------------------------------------------------------------------
// Journey: Set me away, then I'm available again; half an hour later
// ---------------------------------------------------------------------------

describe("journey: a closer in their standby room presses Set me away, then I'm available two minutes later", () => {
  test("the 'under 10 minutes ago' refusal must not still be the strip's sentence half an hour later", async () => {
    const w = begin({}, closer);
    await closerInStandby(w);
    await R.roomsApi.availability("away");
    w.presenceRow(CLOSER, { state: "away", zoom_status: "licensed" });
    expect((await stripNow(w)).words).toBe("Away. Live leads skip you.");
    w.clock.now += 2 * MIN;
    await R.roomsApi.availability("available");
    closerAvailable(w);
    const now = await stripNow(w);
    // Within the ten minutes: said, and fair.
    expect(now.words).toMatch(FLOOD);
    // 10:32: still Available, still no room. live.status keeps the press's
    // sentence on the availability row for as long as the seat is Available
    // (rooms.ts liveStatus), so the strip still reads "Your last standby
    // room closed under 10 minutes ago, so no new one was made yet. Try
    // again in a few minutes." thirty minutes on, for up to two hours.
    w.clock.now += 30 * MIN;
    const later = await stripNow(w);
    expect(later.words).not.toMatch(FLOOD);
  });
});

// ---------------------------------------------------------------------------
// Journey: a new lead's call misses, a Meet link, they talk on Meet, End room
// ---------------------------------------------------------------------------

describe("journey: a setter's call to a new lead misses, the Meet link goes, the lead opens it and they talk on Meet; the setter presses End room", () => {
  test("the panel says 'If you spoke, say so below': there must be something below (or on the panel) to say it with", async () => {
    const w = begin({}, setter);
    // The dialer item is a new lead (kind "lead"): no booked intro, so
    // DialerPage passes no onMarkIntro and the panel's canMarkIntro is false.
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
    // Open my room: the setter lets Huda in on Meet and they talk. Meet sends
    // no join signal and the setter never pressed I'm in or The lead is in.
    await R.roomsApi.open(id);
    w.clock.now += 7 * MIN;
    let p = await panelNow(w, id);
    expect(p.keys).toContain("end");
    expect(p.keys).not.toContain("finished");
    await R.roomsApi.end(p.room, "end");
    // The dialer's panel (talkBelow: the call's own step is drawn below it).
    p = await panelNow(w, id, { talkBelow: true });
    // When found: "... If you spoke, say so below; if not, call them now."
    // with no button on the panel and nothing below to say it with. Fix
    // round 3: the sentence names what is below (Save how it went).
    expect(p.words).toMatch(/If you spoke, save how it went below/);
    // What is below: DialerPage CallPane, mode "unanswered" (Maqsam's record
    // saved No answer), with no join (videoJoinedAt) and no move to the phone
    // (spokeAt), draws AfterMissStep with afterMiss(...): the missed-call
    // WhatsApp, [Next lead] [WhatsApp them] [Send a video link], and no way
    // to save that they spoke. The call stays "No answer".
    const joined = R.videoJoinedAt(p.room);
    const spoke = R.spokeAt(p.room);
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
    const sayItHere = p.keys.includes("showed");
    const sayItBelow = joined !== null || spoke !== null || step.talk === true;
    expect({
      step: step.title,
      sayIt: sayItHere || sayItBelow,
    }).toEqual({
      step: expect.not.stringMatching(/^No answer/),
      sayIt: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Journey: the setter moves on; the room fails
// ---------------------------------------------------------------------------

describe("journey: automatic mode after a missed call, the setter presses Next lead during the ten seconds, and the room fails", () => {
  test("the rep must be told the lead got no link (not 'on its way'), and the banner must not drop it in silence", async () => {
    const w = begin({}, setter);
    // DialerPage sendOnLeave: Next lead inside the countdown sends the room
    // now and, when room.create answers, toasts "Video link on its way to
    // Huda." whatever the room's state. The worker fails the Meet room while
    // room.create waits for it (up to 15 s): a Google error.
    const sleep = w.io.sleep;
    let failed = false;
    w.io.sleep = async (ms: number) => {
      await sleep(ms);
      if (failed) return;
      const r = w.db
        .t("cockpit_sales_rooms")
        .find((x: Row) => x.contact_id === LEAD) as Row | undefined;
      if (!r) return;
      failed = true;
      Object.assign(r, {
        state: "failed",
        result: "failed",
        error: "Google did not make the Meet link. Try Zoom.",
        ended_at: w.db.iso(),
        version: Number(r.version) + 2,
      });
    };
    const out = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "auto",
    });
    w.io.sleep = sleep;
    // room.create answers 200 with the failed room; sendOnLeave's toast is
    // what lib/rooms leaveToast says for it (fix round 3; when found, the
    // success branch always said "Video link on its way to Huda.").
    const toast = R.leaveToast(
      out.room,
      String(out.room.contact_first_name ?? "the lead"),
    ).text;
    expect(out.room.state).toBe("failed");
    expect(w.texts).toHaveLength(0);
    // Lead B is on screen now: the room panel for Huda is gone, the banner
    // shows only the seat's live rooms, and a failed room is final.
    const banner = await bannerNow(w);
    const strip = await stripNow(w);
    expect({
      toast,
      bannerOrStripNamesIt:
        banner !== null || /Huda|link|room/i.test(strip.words),
    }).toEqual({
      toast: expect.not.stringMatching(/on its way/),
      bannerOrStripNamesIt: true,
    });
  });

  test("the same when the room is still being made as the setter leaves and the sweep fails it a minute later", async () => {
    const w = begin({}, setter);
    const out = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    // The worker did not pick it up in room.create's 15 s.
    expect(out.room.state).toBe("requested");
    // afterMiss: "The video link is on its way to them. Wait for them here,
    // or go to the next lead." The setter goes to the next lead.
    const b1 = await bannerNow(w);
    expect(b1?.words).toBe("Making your Meet room...");
    // R1 at a minute: failed, "Not made: the room worker did not pick this
    // room up in time."
    w.clock.now += 50 * S;
    w.sweepCloses(out.room.id, {
      state: "failed",
      result: "failed",
      error: "Not made: the room worker did not pick this room up in time.",
    });
    const b2 = await bannerNow(w);
    const strip = await stripNow(w);
    // The banner drops the room (myRoom skips final rooms) and the strip says
    // "Away. Live leads skip you.": nothing tells the setter that Huda got
    // no link and no missed-call message.
    expect(b2 !== null || /Huda|link|room/i.test(strip.words)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Journey: a setter on Meet waits in a standby room
// ---------------------------------------------------------------------------

describe("journey: a setter (Zoom seat pending) presses I'm available, joins the Meet standby room and waits", () => {
  test("thirty minutes in, the strip must not tell them Zoom closes their room", async () => {
    const w = begin({}, setter);
    await R.roomsApi.availability("available");
    const sb = w.db
      .t("cockpit_sales_rooms")
      .find((r: Row) => r.purpose === "standby") as Row;
    expect(sb.provider).toBe("meet");
    await w.workerOpens(String(sb.id));
    w.presenceRow(SETTER, {
      state: "available",
      until: new Date(w.clock.now + HOURS2).toISOString(),
      zoom_status: "pending",
      default_provider: "meet",
    });
    expect((await stripNow(w)).keys).toEqual(["join", "host_in", "away"]);
    await R.roomsApi.open(String(sb.id));
    const v = (await R.roomsApi.liveStatus()).rooms.find(r => r.id === sb.id);
    await R.roomsApi.mark(v as never, "host_in");
    w.presenceRow(SETTER, {
      state: "ready",
      room_id: sb.id,
      until: new Date(w.clock.now + HOURS2).toISOString(),
      zoom_status: "pending",
      default_provider: "meet",
    });
    expect((await stripNow(w)).line.moment).toBe("ready");
    w.clock.now += 31 * MIN;
    const s = await stripNow(w);
    // "Zoom closes a room 40 minutes after only one person is left. Stay
    // available?" [Keep me available] [Stop], over a Meet room. The SQL
    // sweep's R5 then closes the Meet room at standby_max all the same
    // ("Closed after 35 minutes, before Zoom closes it."), and the fresh
    // one waits for another Join and I'm in, or R3 closes it in 5 minutes.
    expect(s.words).not.toMatch(/Zoom/);
  });
});

// ---------------------------------------------------------------------------
// Journey: the setter moves on; the link may not have reached the lead, or
// the lead knocked and the room closed
// ---------------------------------------------------------------------------

describe("journey: the setter sends the link and moves to the next lead; the banner is where the room shows", () => {
  test("a template nobody saw, with no email behind it: the banner must say the link may not have reached the lead", async () => {
    const w = begin({}, setter);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    await w.workerOpens(made.room.id);
    // As the message service leaves it (rooms.ts backUpUnseen): the
    // template HighLevel took was not seen in 20 s, and the email backup
    // could not go (the lead has no email, or it was refused).
    Object.assign(w.room(made.room.id), {
      link_channels: ["whatsapp_template"],
      link_unconfirmed_at: w.db.iso(),
    });
    w.clock.now += 30 * S;
    const p = await panelNow(w, made.room.id);
    // The panel (not on screen any more): "WhatsApp did not confirm the
    // template and the email did not go. Read the link out: ..."
    expect(p.words).toMatch(
      /did not confirm the template and the email did not go/,
    );
    const b = await bannerNow(w);
    // The banner: "Video room: Huda, 9:30 left." [Open my room], as for a
    // link that went (BANNER_SAYS_PANEL has no not_confirmed).
    expect(b?.words).not.toMatch(/^Video room: Huda, /);
  });

  test("Zoom: the lead knocked while the rep was on another call and the room closed: the rep must be told to call them now", async () => {
    const w = begin({}, closer);
    const made = await R.roomsApi.create({
      contact_id: LEAD,
      provider: "zoom",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    const id = made.room.id;
    await w.workerOpens(id, ZOOM_URL);
    w.clock.now += 4 * MIN;
    await zoomSays(w, id, "meeting.participant_joined_waiting_room", {
      user_name: "Huda",
      email: "huda@example.com",
      date_time: w.db.iso(),
    });
    const b1 = await bannerNow(w);
    expect(b1?.words).toBe("Huda is in the waiting room. Admit them in Zoom.");
    // The closer is on another lead's call and does not see it. The sweep
    // (R4) closes the room past lead_by and the knock's grace.
    w.clock.now = Date.parse(String(w.room(id).lead_by)) + 4 * MIN;
    w.sweepCloses(id, {
      state: "expired",
      result: "no_join",
      end_reason: "lead_not_in",
    });
    const p = await panelNow(w, id);
    // The panel: "Huda knocked at 10:04 and was not let in. Call them now
    // and send a new link." The banner and strip, the only things on the
    // closer's screen: nothing (myRoom skips final rooms).
    expect(p.words).toMatch(/knocked at .* Call them now/);
    const b2 = await bannerNow(w);
    const s = await stripNow(w);
    expect(b2 !== null || /Huda|knocked|call them/i.test(s.words)).toBe(true);
  });
});
