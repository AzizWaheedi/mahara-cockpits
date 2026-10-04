import { describe, expect, mock, test } from "bun:test";
import { ApiError, answerFailure } from "./apiErrors";
import type { LiveStatus, PollEnv, RoomView } from "./rooms";

// sales-api is replaced before rooms.ts loads, as in rooms.test.ts.
mock.module("./api", () => ({
  api: async () => ({ ok: true }),
}));

const R = await import("./rooms");
const V = await import("./videoLink");
const W = await import("./waves");
const H = await import("./roomsHealth");
const F = await import("../dev/roomFixtures");
const L = await import("../dev/liveHarness");

/** 14:12:00 in Kuwait on Saturday 3 October 2026. */
const NOW = Date.parse("2026-10-03T11:12:00.000Z");
const S = 1000;
const MIN = 60 * S;
const iso = (ms: number) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// Refusal codes (contract v2 section 3)
// ---------------------------------------------------------------------------

describe("refusals carry a code, and the screens read it first", () => {
  test("answerFailure keeps a code the server sent, and nothing that is not one", () => {
    const e = answerFailure(409, {
      ok: false,
      error: "This changed a moment ago.",
      code: "stale",
    });
    expect(e?.code).toBe("stale");
    expect(e?.kind).toBe("refused");
    expect(
      answerFailure(409, { ok: false, error: "No.", code: "DROP TABLE" })?.code,
    ).toBeNull();
    expect(answerFailure(409, { ok: false, error: "No." })?.code).toBeNull();
    expect(answerFailure(200, { ok: true })).toBeNull();
  });

  test("stale and confirm_end are read from the code before the words", () => {
    const coded = (code: string, msg = "Something else.") =>
      new ApiError(msg, "refused", 409, code);
    expect(R.isStale(coded("stale"))).toBe(true);
    expect(R.needsEndConfirm(coded("confirm_end"))).toBe(true);
    // A code that says otherwise wins over words that match.
    expect(R.isStale(coded("final", "This changed a moment ago."))).toBe(false);
    expect(
      R.needsEndConfirm(
        coded("stale", "The lead is still in this room. End it anyway?"),
      ),
    ).toBe(false);
    // Without a code, the two pinned sentences still work.
    const plain = (m: string) => new ApiError(m, "refused", 409);
    expect(R.isStale(plain("This changed a moment ago."))).toBe(true);
    expect(
      R.needsEndConfirm(
        plain("The lead is still in this room. End it anyway?"),
      ),
    ).toBe(true);
    expect(R.refusalCode(coded("disabled"))).toBe("disabled");
    expect(R.refusalCode(new Error("x"))).toBeNull();
  });
});

describe("I can't let them in: the replacement room (contract v2 section 4)", () => {
  const ended = { ...F.baseRoom(NOW), state: "cancelled", version: 5 };
  const zoom = { ...F.baseRoom(NOW), id: "room-z", provider: "zoom" };

  test("the room sales-api made is shown", () => {
    const out = R.endAnswer({ ok: true, room: ended, replacement: zoom });
    expect(R.afterAdmitBlocked(out)).toEqual({
      kind: "show",
      room: R.normalizeRoom(zoom) as RoomView,
    });
  });

  test("why it could not be made is said, and no second room is made", () => {
    const out = R.endAnswer({
      ok: true,
      room: ended,
      replacement_refusal: "Your Zoom seat is not active yet.",
    });
    expect(R.afterAdmitBlocked(out)).toEqual({
      kind: "refused",
      text: "Your Zoom seat is not active yet.",
    });
  });

  test("an answer with neither: the panel makes the Zoom room itself", () => {
    expect(R.afterAdmitBlocked(R.endAnswer({ ok: true, room: ended }))).toEqual(
      { kind: "make" },
    );
    // An empty refusal is no refusal.
    expect(
      R.afterAdmitBlocked(
        R.endAnswer({ ok: true, room: ended, replacement_refusal: "  " }),
      ).kind,
    ).toBe("make");
  });
});

describe("open_device is one of the three devices, or not known", () => {
  test("phone, tablet and computer are kept; anything else is null", () => {
    const r = (d: unknown) =>
      R.normalizeRoom({ ...F.baseRoom(NOW), open_device: d })?.open_device;
    expect(r("phone")).toBe("phone");
    expect(r("tablet")).toBe("tablet");
    expect(r("computer")).toBe("computer");
    expect(r("desktop")).toBeNull();
    expect(r("unknown")).toBeNull();
    expect(r(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// One live.status read for the whole page
// ---------------------------------------------------------------------------

function fakePage() {
  let t = NOW;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const env: PollEnv = {
    doc: {
      visibilityState: "visible",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    win: {
      setTimeout: (fn, ms) => {
        seq += 1;
        timers.set(seq, { at: t + ms, fn });
        return seq;
      },
      clearTimeout: id => {
        timers.delete(id);
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    now: () => t,
  };
  const settle = () => new Promise(r => setTimeout(r, 0));
  return {
    env,
    async pass(ms: number) {
      const end = t + ms;
      await settle();
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
        await settle();
      }
      t = end;
    },
  };
}

describe("the shared live.status store", () => {
  const live = F.liveFixture("ready", NOW).live;

  test("three listeners share one read every 4 s", async () => {
    const page = fakePage();
    let reads = 0;
    const store = R.createLiveStore({
      fetcher: async () => {
        reads += 1;
        return live;
      },
      env: page.env,
    });
    const seen: (LiveStatus | null)[][] = [[], [], []];
    const leave = seen.map((list, i) =>
      store.join(s => {
        list.push(s.data);
        void i;
      }),
    );
    await page.pass(0);
    expect(reads).toBe(1);
    await page.pass(12_000);
    expect(reads).toBe(4);
    for (const list of seen) expect(list.at(-1)).toEqual(live);
    for (const go of leave) go();
  });

  test("a late listener hears the last read at once", async () => {
    const page = fakePage();
    const store = R.createLiveStore({
      fetcher: async () => live,
      env: page.env,
    });
    const first = store.join(() => undefined);
    await page.pass(0);
    let heard: LiveStatus | null = null;
    const second = store.join(s => {
      heard = s.data;
    });
    expect(heard).toEqual(live);
    first();
    second();
  });

  test("the read stops a moment after the last listener leaves, not at a quick remount", async () => {
    const page = fakePage();
    let reads = 0;
    const store = R.createLiveStore({
      fetcher: async () => {
        reads += 1;
        return live;
      },
      env: page.env,
      linger: 1500,
    });
    const a = store.join(() => undefined);
    await page.pass(0);
    a();
    // Strict mode mounts again at once: the same read carries on.
    const b = store.join(() => undefined);
    await page.pass(2000);
    expect(store.running()).toBe(true);
    b();
    await page.pass(1600);
    expect(store.running()).toBe(false);
    const before = reads;
    await page.pass(20_000);
    expect(reads).toBe(before);
  });

  test("a press's room goes on screen through the store", async () => {
    const page = fakePage();
    const store = R.createLiveStore({
      fetcher: async () => live,
      env: page.env,
    });
    let last: LiveStatus | null = null;
    const go = store.join(s => {
      last = s.data;
    });
    await page.pass(0);
    const made = F.roomFixture("sent", NOW).feed.room;
    store.set(prev => (prev ? R.withRoom(prev, made) : prev));
    expect((last as LiveStatus | null)?.rooms.some(r => r.id === made.id)).toBe(
      true,
    );
    go();
  });
});

// ---------------------------------------------------------------------------
// Send a video link: the gate, the picker, the line, automatic mode
// ---------------------------------------------------------------------------

const ON = {
  enabled: true,
  test_only: false,
  test_contacts: ["VjPfR4Cc1Y0OFvaqeor5"],
  providers: { meet: true, zoom: true },
  default_provider: { setter: "meet", closer: "zoom" },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
  short_link: true,
  fallback: { scope: "intro", auto_on_miss: false, pilot_emails: [] },
};
const setting = (over: Record<string, unknown> = {}) =>
  V.readRoomsSetting({ ...ON, ...over }) as NonNullable<
    ReturnType<typeof V.readRoomsSetting>
  >;

describe("readRoomsSetting reads the switches as roomlogic does", () => {
  test("a missing or broken row is null; the shipped row is all off and testing", () => {
    expect(V.readRoomsSetting(null)).toBeNull();
    expect(V.readRoomsSetting("on")).toBeNull();
    expect(V.readRoomsSetting([])).toBeNull();
    const shipped = V.readRoomsSetting({
      enabled: false,
      test_only: true,
      providers: { zoom: false, meet: false },
    });
    expect(shipped?.enabled).toBe(false);
    expect(shipped?.test_only).toBe(true);
    expect(shipped?.providers).toEqual({ meet: false, zoom: false });
    expect(shipped?.fallback.scope).toBe("intro");
  });

  test("only exactly true is on, and testing stays on unless exactly false", () => {
    const s = V.readRoomsSetting({
      enabled: "true",
      test_only: 0,
      providers: { meet: 1, zoom: true },
      fallback: { pilot_emails: ["Sara@Example.com", 7, ""] },
    });
    expect(s?.enabled).toBe(false);
    expect(s?.test_only).toBe(true);
    expect(s?.providers).toEqual({ meet: false, zoom: true });
    expect(s?.fallback.pilot_emails).toEqual(["sara@example.com"]);
  });

  test("live, the WhatsApp gate and the call link template", () => {
    expect(V.liveSwitchOn({ enabled: true })).toBe(true);
    expect(V.liveSwitchOn({ enabled: "yes" })).toBe(false);
    expect(V.liveSwitchOn(null)).toBe(false);
    expect(V.guardOpen(null)).toBeNull();
    expect(V.guardOpen({ connector_off: true, single_copy_ok_at: null })).toBe(
      false,
    );
    expect(
      V.guardOpen({ connector_off: true, single_copy_ok_at: iso(NOW) }),
    ).toBe(true);
    expect(
      V.guardOpen({ connector_off: false, single_copy_ok_at: iso(NOW) }),
    ).toBe(false);
    const t = (
      key: string,
      active = true,
      workflow_id: string | null = "w",
    ) => ({
      key,
      active,
      workflow_id,
    });
    expect(V.callLinkLive(null)).toBeNull();
    expect(V.callLinkLive([t("opener_en")])).toBe(false);
    expect(V.callLinkLive([t("call_link_en", true, null)])).toBe(false);
    expect(V.callLinkLive([t("call_link_ar", false)])).toBe(false);
    expect(V.callLinkLive([t("call_link_ar")])).toBe(true);
    // A key that only begins like the route is not the route.
    expect(V.callLinkLive([t("call_linkage")])).toBe(false);
  });
});

describe("videoLinkGate: the button shows only where sales-api could make the room", () => {
  const base = {
    setting: setting({ fallback: { ...ON.fallback, scope: "any" } }),
    contactId: "lead-1",
    seatEmail: "sara@example.com",
    purpose: "fallback" as const,
  };
  const why = (over: Partial<Parameters<typeof V.videoLinkGate>[0]>) =>
    V.videoLinkGate({ ...base, ...over }).why;

  test("open for a lead when rooms are on", () => {
    expect(V.videoLinkGate(base)).toEqual({ show: true, why: "ok" });
  });

  test("each refusal for everyone keeps it off", () => {
    expect(why({ setting: null })).toBe("unread");
    expect(why({ setting: setting({ enabled: false }) })).toBe("off");
    expect(
      why({ setting: setting({ providers: { meet: false, zoom: false } }) }),
    ).toBe("no_provider");
    expect(why({ contactId: "" })).toBe("no_lead");
    expect(why({ client: true })).toBe("client");
    expect(why({ dnd: true })).toBe("dnd");
    expect(why({ bookedDemo: true })).toBe("booked_demo");
  });

  test("testing: only the test contacts", () => {
    const testing = setting({
      test_only: true,
      fallback: { ...ON.fallback, scope: "any" },
    });
    expect(why({ setting: testing })).toBe("test_only");
    expect(why({ setting: testing, contactId: "VjPfR4Cc1Y0OFvaqeor5" })).toBe(
      "ok",
    );
  });

  test("a missed call: booked intros only, and the pilot's seats", () => {
    const intro = setting();
    expect(why({ setting: intro })).toBe("scope");
    expect(why({ setting: intro, bookedIntro: true })).toBe("ok");
    // The lead page's own link is not a missed call's.
    expect(why({ setting: intro, purpose: "manual" })).toBe("ok");
    const pilot = setting({
      fallback: { scope: "any", pilot_emails: ["omar@example.com"] },
    });
    expect(why({ setting: pilot })).toBe("pilot");
    expect(why({ setting: pilot, seatEmail: "Omar@Example.com " })).toBe("ok");
  });
});

describe("the picker: Meet for the setter, Zoom for the closer", () => {
  test("the role's default, then the seat's own from live.status", () => {
    expect(
      V.providerChoice({ setting: setting(), role: "setter" }),
    ).toMatchObject({ first: "meet", other: "zoom" });
    expect(
      V.providerChoice({ setting: setting(), role: "closer" }),
    ).toMatchObject({ first: "zoom", other: "meet" });
    expect(
      V.providerChoice({
        setting: setting(),
        role: "closer",
        me: { default_provider: "meet", zoom_status: "pending" },
      }),
    ).toMatchObject({
      first: "meet",
      other: "zoom",
      note: "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.",
    });
  });

  test("a provider that is off is never offered", () => {
    const meetOnly = setting({ providers: { meet: true, zoom: false } });
    expect(
      V.providerChoice({ setting: meetOnly, role: "closer" }),
    ).toMatchObject({ first: "meet", other: null });
    expect(
      V.providerChoice({
        setting: setting({ providers: { meet: false, zoom: false } }),
        role: "setter",
      }),
    ).toBeNull();
  });

  test("labels say what they do: [Send a Meet link] [Use Zoom instead]", () => {
    const c = V.providerChoice({ setting: setting(), role: "setter" });
    expect(c && V.choiceLabels(c)).toEqual({
      first: "Send a Meet link",
      other: "Use Zoom instead",
    });
  });
});

describe("linkPlanLine says where the link will go, or nothing", () => {
  const wa = (over = {}) => ({
    on: true,
    dnd: false,
    reachable: true,
    window: { open: false },
    ...over,
  });
  const em = (over = {}) => ({
    on: true,
    dnd: false,
    reachable: true,
    ...over,
  });
  const line = (
    over: Partial<Parameters<typeof V.linkPlanLine>[0]> = {},
  ): string | null =>
    V.linkPlanLine({
      setting: setting(),
      whatsapp: wa(),
      email: em(),
      guardOpen: true,
      templateLive: true,
      ...over,
    });

  test("free WhatsApp inside the window, then the template, then email", () => {
    expect(line({ whatsapp: wa({ window: { open: true } }) })).toBe(
      "The lead gets the link on WhatsApp.",
    );
    expect(line()).toBe("The lead gets the link on a WhatsApp template.");
    expect(line({ templateLive: false })).toBe(
      "The lead gets the link by email.",
    );
    expect(line({ emailFirst: true })).toBe("The lead gets the link by email.");
  });

  test("the gate, the switches and do-not-disturb close WhatsApp", () => {
    expect(line({ guardOpen: false })).toBe("The lead gets the link by email.");
    expect(line({ whatsapp: wa({ dnd: true }) })).toBe(
      "The lead gets the link by email.",
    );
    expect(
      line({
        setting: setting({
          send: { whatsapp_text: true, whatsapp_template: false, email: true },
        }),
      }),
    ).toBe("The lead gets the link by email.");
    // The template needs the short link (its button opens it).
    expect(line({ setting: setting({ short_link: false }) })).toBe(
      "The lead gets the link by email.",
    );
  });

  test("nothing can go: the read-out line", () => {
    expect(line({ guardOpen: false, email: em({ reachable: false }) })).toBe(
      V.PICKER_NONE,
    );
  });

  test("a guess it cannot make is left unsaid", () => {
    expect(line({ whatsapp: null })).toBeNull();
    expect(line({ guardOpen: null })).toBeNull();
    expect(line({ templateLive: null })).toBeNull();
    // Unknowns after a clear yes do not matter.
    expect(
      line({ whatsapp: wa({ window: { open: true } }), templateLive: null }),
    ).toBe("The lead gets the link on WhatsApp.");
    // Email first: an unread conversation is still unknown.
    expect(line({ emailFirst: true, email: null })).toBeNull();
  });
});

describe("a call that did not connect, and automatic mode", () => {
  test("missTrigger: failed, busy, no answer; never an answered or ringing call", () => {
    expect(V.missTrigger({ attemptFailed: true, call: null })).toBe(
      "did_not_connect",
    );
    expect(
      V.missTrigger({
        attemptFailed: false,
        call: { final: true, answered: false, words: "No answer" },
      }),
    ).toBe("no_answer");
    expect(
      V.missTrigger({
        attemptFailed: false,
        call: { final: true, answered: false, words: "Busy" },
      }),
    ).toBe("busy");
    expect(
      V.missTrigger({
        attemptFailed: false,
        call: { final: true, answered: true, words: "Answered" },
      }),
    ).toBeNull();
    expect(
      V.missTrigger({
        attemptFailed: false,
        call: { final: false, answered: false, words: "In progress" },
      }),
    ).toBeNull();
    expect(V.missTrigger({ attemptFailed: false, call: null })).toBeNull();
  });

  test("ten seconds, counted down to zero and no further", () => {
    expect(V.autoLeft(NOW, NOW)).toBe(10);
    expect(V.autoLeft(NOW, NOW + 2500)).toBe(8);
    expect(V.autoLeft(NOW, NOW + 10_000)).toBe(0);
    expect(V.autoLeft(NOW, NOW + 60_000)).toBe(0);
    expect(V.autoSentence("Faisal", 10)).toBe(
      "Sending a video link to Faisal in 10 s.",
    );
    expect(V.autoSentence(" ", 3)).toBe(
      "Sending a video link to the lead in 3 s.",
    );
  });

  test("the not-connected line is P1's word for word", () => {
    expect(V.NOBODY_SPOKE_VIDEO).toBe(
      "Nobody spoke. Save it as No answer or Call back, or send a video link.",
    );
  });
});

describe("the lead's room, and the Video call menu", () => {
  test("roomForLead: this lead's newest room, one not over first", () => {
    const old = F.baseRoom(NOW, { id: "a", created_at: iso(NOW - 5 * MIN) });
    const fresh = F.baseRoom(NOW, { id: "b", created_at: iso(NOW - MIN) });
    const over = F.baseRoom(NOW, { id: "c", state: "ended" });
    const other = F.baseRoom(NOW, { id: "d", contact_id: "lead-9" });
    expect(V.roomForLead([old, over, fresh, other], "lead-1")?.id).toBe("b");
    // A closed room still listed is shown, after every open one.
    expect(V.roomForLead([over], "lead-1")?.id).toBe("c");
    expect(V.roomForLead(null, "lead-1")).toBeNull();
    expect(V.roomForLead([fresh], "")).toBeNull();
  });

  test("until live.ask is built, the menu offers only the video link, whatever the live switch (final review)", () => {
    expect(V.LIVE_ASK_BUILT).toBe(false);
    for (const liveOn of [false, true]) {
      const menu = V.videoMenu({ linkShown: true, liveOn });
      expect(menu?.items.map(i => i.key)).toEqual(["link"]);
      expect(menu?.note).toBeNull();
      expect(V.videoMenu({ linkShown: false, liveOn })).toBeNull();
    }
  });

  test("C42's three items once live.ask is built; the live two wait with a sentence", () => {
    const off = V.videoMenu({ linkShown: true, liveOn: false, askBuilt: true });
    expect(off?.items.map(i => [i.label, i.disabled])).toEqual([
      ["Send a video link", false],
      ["Demo now with a closer", true],
      ["Intro now with me", true],
    ]);
    expect(off?.note).toBe("Live handover is not switched on yet.");
    const on = V.videoMenu({ linkShown: false, liveOn: true, askBuilt: true });
    expect(on?.items.map(i => i.key)).toEqual(["demo_now", "intro_now"]);
    expect(on?.note).toBeNull();
    expect(
      V.videoMenu({ linkShown: false, liveOn: false, askBuilt: true }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

describe("waves: rows, counts and lines", () => {
  const wave = (over: Record<string, unknown> = {}) =>
    W.readWave({
      id: "w1",
      pool: "no_show_cancelled",
      state: "running",
      per_day: 40,
      holdout_share: 0.1,
      created_at: iso(NOW - 86_400_000),
      started_at: iso(NOW - 86_400_000),
      enrolled_at: iso(NOW - 86_400_000),
      made_by: "aziz@maharamedia.com",
      ...over,
    }) as NonNullable<ReturnType<typeof W.readWave>>;

  test("readWave keeps what it can draw and drops what it cannot", () => {
    expect(W.readWave(null)).toBeNull();
    expect(W.readWave({ id: "x", pool: "everyone" })).toBeNull();
    expect(wave({ state: "odd" }).state).toBe("draft");
    expect(wave({ per_day: "25" }).per_day).toBe(25);
    // The desk's notes say created_by; the table says made_by.
    expect(wave({ made_by: null, created_by: "a@b.c" }).made_by).toBe("a@b.c");
    expect(wave({ done_reason: "Stopped by a manager." }).done_reason).toBe(
      "Stopped by a manager.",
    );
  });

  test("countMembers splits the arms and their outcomes", () => {
    const rows = [
      ...Array(5).fill({ wave_id: "w1", arm: "wave", state: "waiting" }),
      ...Array(2).fill({ wave_id: "w1", arm: "wave", state: "drafted" }),
      ...Array(3).fill({ wave_id: "w1", arm: "wave", state: "sent" }),
      { wave_id: "w1", arm: "wave", state: "replied" },
      { wave_id: "w1", arm: "wave", state: "booked" },
      { wave_id: "w1", arm: "wave", state: "closed" },
      { wave_id: "w1", arm: "wave", state: "excluded" },
      ...Array(2).fill({ wave_id: "w1", arm: "holdout", state: "held_out" }),
      { wave_id: "w1", arm: "holdout", state: "booked" },
      { wave_id: "w2", arm: "wave", state: "waiting" },
    ];
    const c = W.countsFor(W.countMembers(rows), "w1");
    expect(c).toEqual({
      total: 17,
      wave: 14,
      holdout: 3,
      waiting: 5,
      drafted: 2,
      messaged: 6,
      bookedWave: 1,
      bookedHoldout: 1,
      settledWave: 2,
      settledHoldout: 1,
      excluded: 1,
      // In the comparison: the wave members whose opener went (6), and the
      // held-back member whose turn came (booked); held_out rows without
      // due_at and the excluded one (taken out before their turn) are not.
      measuredWave: 6,
      measuredHoldout: 1,
    });
    expect(W.countsFor(W.countMembers(rows), "nobody").total).toBe(0);
  });

  test("the next batch: from 09:00 Kuwait, never on a Friday", () => {
    // Saturday 14:12 Kuwait, today's batch written: Sunday 09:00.
    const sun9 = Date.parse("2026-10-04T06:00:00.000Z");
    expect(W.nextBatchAt(NOW, { writtenToday: true })).toBe(sun9);
    expect(W.batchWhen(sun9, NOW)).toBe("tomorrow at 09:00");
    // Not written yet after 09:00: it is being written now.
    expect(W.nextBatchAt(NOW, { writtenToday: false })).toBe(NOW);
    // Before 09:00: today at 09:00.
    const early = Date.parse("2026-10-03T03:00:00.000Z");
    const sat9 = Date.parse("2026-10-03T06:00:00.000Z");
    expect(W.nextBatchAt(early, { writtenToday: false })).toBe(sat9);
    expect(W.batchWhen(sat9, early)).toBe("today at 09:00");
    // Thursday afternoon, written: Friday is off, so Saturday.
    const thu = Date.parse("2026-10-08T12:00:00.000Z");
    const sat = Date.parse("2026-10-10T06:00:00.000Z");
    expect(W.nextBatchAt(thu, { writtenToday: true })).toBe(sat);
    expect(W.batchWhen(sat, thu)).toBe("on Saturday at 09:00");
  });

  test("P3's wave line, and no number before the pool is in", () => {
    const c = W.countsFor(
      W.countMembers([
        ...Array(30).fill({ wave_id: "w1", arm: "wave", state: "waiting" }),
        ...Array(4).fill({ wave_id: "w1", arm: "holdout", state: "held_out" }),
      ]),
      "w1",
    );
    const sun9 = Date.parse("2026-10-04T06:00:00.000Z");
    expect(W.waveLine(wave(), c, { at: sun9, now: NOW })).toBe(
      "34 leads in no-shows and cancellations, 40 a day, newest first; 4 held back to measure the effect. Next batch tomorrow at 09:00.",
    );
    expect(W.waveLine(wave(), c, { at: NOW, now: NOW })).toContain(
      "Today's batch is being written now.",
    );
    expect(W.waveLine(wave({ state: "paused" }), c, null)).toContain(
      "Paused: no batch is written.",
    );
    const empty = W.countsFor(W.countMembers([]), "w1");
    const fresh = W.waveLine(wave({ enrolled_at: null }), empty, null);
    expect(fresh).not.toMatch(/\d+ leads/);
    expect(fresh).toContain("nothing is counted before then");
    expect(
      W.waveLine(
        wave({
          state: "done",
          ended_at: iso(NOW),
          done_reason: "Stopped by a manager.",
        }),
        c,
        null,
      ),
    ).toBe("No-shows and cancellations: ended 14:12. Stopped by a manager.");
  });

  test("the effect: both arms by intention to treat, with its range", () => {
    const few = W.countsFor(
      W.countMembers([
        ...Array(20).fill({ wave_id: "w", arm: "wave", state: "sent" }),
        ...Array(3).fill({ wave_id: "w", arm: "holdout", state: "held_out" }),
      ]),
      "w",
    );
    expect(W.effectLine(few)).toMatch(/^Too few leads/);
    // Mid-wave: most of the arm has not been written to yet.
    const mid = W.countsFor(
      W.countMembers([
        ...Array(30).fill({ wave_id: "w", arm: "wave", state: "sent" }),
        ...Array(70).fill({ wave_id: "w", arm: "wave", state: "waiting" }),
        ...Array(20).fill({ wave_id: "w", arm: "holdout", state: "held_out" }),
      ]),
      "w",
    );
    expect(W.effectLine(mid)).toMatch(
      /^The effect is read once every lead in the wave has had their turn: 30 of 100 so far\./,
    );
    const enough = W.countsFor(
      W.countMembers([
        ...Array(90).fill({ wave_id: "w", arm: "wave", state: "closed" }),
        ...Array(10).fill({ wave_id: "w", arm: "wave", state: "booked" }),
        ...Array(19).fill({ wave_id: "w", arm: "holdout", state: "closed" }),
        { wave_id: "w", arm: "holdout", state: "booked" },
      ]),
      "w",
    );
    const line = W.effectLine(enough);
    expect(line).toContain("Booked: 10 of 100 (10.0%) in the wave");
    expect(line).toContain("1 of 20 (5.0%) held back");
    expect(line).toContain("Difference 5.0 points, range");
    // Every member has had their 14 days: nothing more can move.
    expect(line).not.toContain("can still book");
  });

  test("the effect compares like with like: members whose turn came, in both arms (stress round 1)", () => {
    const at = "2026-10-01T06:00:00.000Z";
    const rows: W.MemberRow[] = [
      // 50 had their opener (10 booked), 50 let go when the wave was stopped before their turn.
      ...Array(40).fill({
        wave_id: "w",
        arm: "wave",
        state: "closed",
        sent_at: at,
      }),
      ...Array(10).fill({
        wave_id: "w",
        arm: "wave",
        state: "booked",
        sent_at: at,
      }),
      ...Array(50).fill({
        wave_id: "w",
        arm: "wave",
        state: "excluded",
        sent_at: null,
        due_at: null,
      }),
      // 10 taken out at their turn (a rep skipped them), watched like their twins: 2 booked.
      ...Array(8).fill({
        wave_id: "w",
        arm: "wave",
        state: "closed",
        sent_at: null,
        due_at: at,
      }),
      ...Array(2).fill({
        wave_id: "w",
        arm: "wave",
        state: "booked",
        sent_at: null,
        due_at: at,
      }),
      // The holdout: 60 whose turn came (12 booked), 50 never measured.
      ...Array(48).fill({
        wave_id: "w",
        arm: "holdout",
        state: "closed",
        due_at: at,
      }),
      ...Array(12).fill({
        wave_id: "w",
        arm: "holdout",
        state: "booked",
        due_at: at,
      }),
      ...Array(50).fill({
        wave_id: "w",
        arm: "holdout",
        state: "excluded",
        due_at: null,
      }),
    ];
    const c = W.countsFor(W.countMembers(rows), "w");
    expect([c.measuredWave, c.measuredHoldout, c.messaged]).toEqual([
      60, 60, 50,
    ]);
    const line = W.effectLine(c);
    expect(line).toContain("Booked: 12 of 60 (20.0%) in the wave");
    expect(line).toContain("12 of 60 (20.0%) held back");
    expect(line).toContain("Difference 0.0 points");
  });

  test("the batch: approved, held, set aside, or waiting for a person", () => {
    const d = (over: Partial<W.BatchDraft>): W.BatchDraft => ({
      id: "f",
      contact_id: "c",
      wave_id: "w1",
      send_after: null,
      held_by: null,
      hold_reason: null,
      ...over,
    });
    expect(W.batchState(d({}))).toBe("undecided");
    expect(W.batchState(d({ send_after: iso(NOW) }))).toBe("approved");
    expect(W.batchState(d({ held_by: "sara@example.com" }))).toBe("held");
    expect(W.batchState(d({ held_by: "sales-desk" }))).toBe("set_aside");
    const many = Array.from({ length: 45 }, (_, i) => d({ id: `f${i}` }));
    many[0].send_after = iso(NOW);
    many[1].held_by = "sara@example.com";
    const ids = W.toApprove(many);
    expect(ids).toHaveLength(40);
    expect(ids).not.toContain("f0");
    expect(ids).not.toContain("f1");
  });

  test("an opener being sent, and one whose send stopped half way (fix round 3)", () => {
    const d = (over: Partial<W.BatchDraft>): W.BatchDraft => ({
      id: "f",
      contact_id: "c",
      wave_id: "w1",
      send_after: iso(NOW),
      held_by: null,
      hold_reason: null,
      ...over,
    });
    const now = Date.parse(iso(NOW));
    const fresh = d({
      held_by: W.SENDING_MARK,
      held_at: new Date(now - 60_000).toISOString(),
    });
    const stale = d({
      id: "f2",
      held_by: W.SENDING_MARK,
      held_at: new Date(now - 30 * 60_000).toISOString(),
    });
    expect(W.batchState(fresh, now)).toBe("sending");
    expect(W.batchState(stale, now)).toBe("stalled");
    // Never "held by a rep": Approve all sends a stopped one again, and leaves one in flight.
    expect(W.toApprove([fresh, stale], now)).toEqual(["f2"]);
  });

  test("the follow-ups' own WhatsApp pause: the last day, or since a manager cleared it (fix round 3)", () => {
    const now = Date.parse("2026-10-04T08:00:00Z");
    const at = (msAgo: number) => new Date(now - msAgo).toISOString();
    const failed = (msAgo: number) => ({
      state: "failed",
      error: "Insufficient funds",
      source: "followup",
      created_at: at(msAgo),
    });
    const six = [1, 2, 3, 4, 5, 6].map(i => failed(i * 60_000));
    expect(W.sourcePause(six, {}, "followup", now)).toMatchObject({
      paused: true,
      sent: 6,
      failed: 6,
      reason: "Insufficient funds",
    });
    // The same six three days ago: not paused for good.
    expect(
      W.sourcePause(
        [1, 2, 3, 4, 5, 6].map(i => failed(3 * 86_400_000 + i * 60_000)),
        {},
        "followup",
        now,
      ).paused,
    ).toBe(false);
    // Cleared by a manager after the six: nothing counts from before.
    expect(
      W.sourcePause(six, { health_cleared_at: at(10_000) }, "followup", now)
        .paused,
    ).toBe(false);
    // Another source's failures never pause follow-ups.
    expect(
      W.sourcePause(
        six.map(r => ({ ...r, source: "room" })),
        {},
        "followup",
        now,
      ).paused,
    ).toBe(false);
  });

  test("the approved line and the settings' defaults", () => {
    expect(
      W.approvedLine(
        { count: 40, first_at: iso(NOW), last_at: "2026-10-03T06:20:00.000Z" },
        45,
      ),
    ).toBe("Approved. One goes every 45 seconds, finishing at 09:20.");
    expect(W.approvedLine({ count: 0 }, 45)).toBe(
      "Nothing was approved: no opener was waiting.",
    );
    expect(W.approvedLine({ count: 1 }, 45)).toBe(
      "Approved. It goes in the next few minutes.",
    );
    expect(W.approvedLine({}, 30)).toBe("Approved. One goes every 30 seconds.");
    expect(W.waveSettings(null)).toEqual({
      perDay: 40,
      holdoutShare: 0.1,
      gapS: 45,
      firstHour: 9,
      daysOff: ["friday"],
    });
    expect(
      W.waveSettings({
        waves: { per_day: 500, batch_gap_s: 10, holdout_share: 0.2 },
        first_hours: [10, 18],
      }),
    ).toMatchObject({ perDay: 40, gapS: 45, holdoutShare: 0.2, firstHour: 10 });
  });
});

// ---------------------------------------------------------------------------
// The Team page's rooms card
// ---------------------------------------------------------------------------

describe("the rooms card's lines", () => {
  const row = (
    worker: string,
    job: string,
    ok: boolean,
    at: number,
    detail: string | null = null,
  ) => ({ worker, job, ok, at: iso(at), detail });

  test("missing is never zero, and the door's routes count only on failure", () => {
    const lines = H.roomJobLines([], NOW, true);
    expect(lines.map(l => l.tone)).toEqual([
      "bad",
      "bad",
      "quiet",
      "quiet",
      "quiet",
      "quiet",
      "quiet",
      // The sweep and the watchdog (fix round 4): missing is never zero.
      "bad",
      "bad",
    ]);
    // A red line ends with the runbook's next step.
    expect(lines[0].text).toBe(
      `The room worker has not run yet. ${H.ROOM_JOBS[0].fix}`,
    );
    expect(lines[2].text).toBe("Zoom's meeting events: no report yet.");
    // Rooms off: a worker that has not run is no fault.
    expect(H.roomJobLines([], NOW, false)[0].tone).toBe("quiet");
  });

  test("late, failing and working", () => {
    const lines = H.roomJobLines(
      [
        row("sales-desk", "rooms", true, NOW - 100 * S),
        row("sales-desk", "room-hosts", true, NOW - 5 * MIN, "Checked 3 hosts"),
        row(
          "sales-live",
          "zoom",
          false,
          NOW - 9 * MIN,
          "The secret is not set",
        ),
        row("sales-live", "go", true, NOW - 3 * 3_600_000),
      ],
      NOW,
      true,
    );
    expect(lines[0]).toMatchObject({
      tone: "bad",
      text: `The room worker last ran at 14:10, later than it should. ${H.ROOM_JOBS[0].fix}`,
    });
    // Times are set in Geist Mono.
    expect(lines[0].say).toContainEqual({ mono: "14:10" });
    expect(lines[1]).toMatchObject({
      tone: "good",
      text: "The Zoom and Google check: working, last at 14:07. Checked 3 hosts.",
    });
    expect(lines[2]).toMatchObject({
      tone: "bad",
      text: `Zoom's meeting events failed at 14:03: The secret is not set. ${H.ROOM_JOBS[2].fix}`,
    });
    // A route that reports only on use is never late.
    expect(lines[3]).toMatchObject({ tone: "good" });
  });

  test("a seat's Zoom and Meet", () => {
    expect(H.seatRoomLines(null, NOW).zoom).toEqual({
      tone: "quiet",
      text: "Zoom: not checked yet",
    });
    const s = H.seatRoomLines(
      {
        email: "omar@example.com",
        zoom_status: "pending",
        zoom_live_until: null,
        google_ok: false,
        default_provider: "meet",
        checked_at: iso(NOW - 4 * MIN),
      },
      NOW,
    );
    expect(s.zoom.tone).toBe("owed");
    expect(s.zoom.text).toBe(
      "Zoom: the seat is pending until Zoom's email invite is accepted",
    );
    expect(s.meet).toBe("Meet: Google not connected");
    expect(s.note).toBe("Rooms start on Meet, checked 14:08.");
    const busy = H.seatRoomLines(
      {
        email: "sara@example.com",
        zoom_status: "licensed",
        zoom_live_until: iso(NOW + 10 * MIN),
        google_ok: true,
        default_provider: null,
        checked_at: null,
      },
      NOW,
    );
    expect(busy.zoom.text).toBe("Zoom: ready, in a meeting now");
    expect(busy.note).toBe("not checked yet.");
  });

  test("the switches in one sentence", () => {
    expect(H.switchesLine(null)).toBe(
      "The video rooms setting could not be read.",
    );
    expect(
      H.switchesLine({
        enabled: false,
        test_only: true,
        providers: { meet: false, zoom: false },
      }),
    ).toBe("Video rooms are switched off.");
    expect(
      H.switchesLine({
        enabled: true,
        test_only: true,
        providers: { meet: true, zoom: false },
      }),
    ).toBe("Video rooms are on for the test contact only; Meet is on.");
    expect(
      H.switchesLine({
        enabled: true,
        test_only: false,
        providers: { meet: true, zoom: true },
      }),
    ).toBe("Video rooms are on; Meet and Zoom are on.");
  });
});

// ---------------------------------------------------------------------------
// The harness answers every press, as sales-api would
// ---------------------------------------------------------------------------

describe("the harness's rooms", () => {
  const knobs = (q: string) => L.liveKnobs(new URLSearchParams(q));

  test("the knobs, with the harness's defaults", () => {
    expect(knobs("")).toEqual({
      room: null,
      offer: null,
      rooms: "on",
      live: "off",
      auto: false,
      create: "ok",
      waves: "running",
      reply: false,
      handover: false,
      net: "ok",
      answer: "ok",
      auth: "ok",
      reads: "ok",
    });
    expect(knobs("room=sent&offer=incoming&live=on&auto=1")).toMatchObject({
      room: "sent",
      offer: "incoming",
      live: "on",
      auto: true,
    });
    expect(knobs("room=nonsense").room).toBeNull();
  });

  test("every room knob opens for the lead on screen", () => {
    for (const k of F.ROOM_KNOBS) {
      const stage = new L.RoomStage(knobs(`room=${k}`), NOW, "lead-7");
      const r = stage.rooms[0];
      expect(r).toBeDefined();
      if (r.purpose !== "handover") expect(r.contact_id).toBe("lead-7");
      const out = stage.answer("room.status", { room_id: r.id }, NOW);
      expect(R.normalizeRoomFeed(out).room.id).toBe(r.id);
    }
  });

  test("a room asked for is made in 3 s and its link goes; a second is refused", () => {
    const stage = new L.RoomStage(knobs(""), NOW, "lead-1");
    const made = stage.answer(
      "room.create",
      { contact_id: "lead-1", provider: "meet", purpose: "fallback" },
      NOW,
    );
    const room = R.roomAnswer(made).room;
    expect(room.state).toBe("creating");
    expect(() =>
      stage.answer(
        "room.create",
        { contact_id: "lead-1", provider: "zoom", purpose: "fallback" },
        NOW + S,
      ),
    ).toThrow("A video room is already open for this lead. Use that one.");
    const later = R.normalizeRoomFeed(
      stage.answer("room.status", { room_id: room.id }, NOW + 3 * S),
    ).room;
    expect(later.state).toBe("open");
    expect(later.link_channels).toEqual(["whatsapp_text"]);
    expect(R.roomMoment(later, NOW + 3 * S)).toBe("sent");
    // live.status lists it for the banner and the dialer.
    const live = R.normalizeLive(stage.answer("live.status", {}, NOW + 4 * S));
    expect(live.rooms.some(r => r.id === room.id)).toBe(true);
  });

  test("marks, the end question, stale versions and the Zoom swap", () => {
    const stage = new L.RoomStage(knobs("room=sent"), NOW, "lead-1");
    const r = stage.rooms[0];
    const v = r.version;
    const inRoom = R.roomAnswer(
      stage.answer(
        "room.mark",
        { room_id: r.id, version: v, what: "host_in" },
        NOW,
      ),
    ).room;
    expect(inRoom.state).toBe("host_in");
    expect(() =>
      stage.answer(
        "room.mark",
        { room_id: r.id, version: v, what: "lead_in" },
        NOW,
      ),
    ).toThrow("This changed a moment ago.");
    stage.answer(
      "room.mark",
      { room_id: r.id, version: inRoom.version, what: "lead_in" },
      NOW,
    );
    expect(() =>
      stage.answer(
        "room.end",
        { room_id: r.id, version: r.version, reason: "end" },
        NOW,
      ),
    ).toThrow("The lead is still in this room. End it anyway?");
    const meet = new L.RoomStage(knobs("room=opened"), NOW, "lead-1");
    const m = meet.rooms[0];
    const out = R.endAnswer(
      meet.answer(
        "room.end",
        { room_id: m.id, version: m.version, reason: "admit_blocked" },
        NOW,
      ),
    );
    expect(out.room.result).toBe("admit_blocked");
    expect(R.afterAdmitBlocked(out)).toMatchObject({ kind: "show" });
    expect(out.replacement?.provider).toBe("zoom");
  });

  test("refusals come with their code, and switched off is a disabled refusal", () => {
    const stage = new L.RoomStage(knobs("create=refused"), NOW, "lead-1");
    try {
      stage.answer("room.create", { contact_id: "lead-1" }, NOW);
      throw new Error("not refused");
    } catch (e) {
      expect(e).toBeInstanceOf(L.Refused);
      expect((e as InstanceType<typeof L.Refused>).code).toBe("host_has_room");
    }
    const off = new L.RoomStage(knobs("rooms=off"), NOW, "lead-1");
    expect(() => off.answer("live.status", {}, NOW)).toThrow(
      "Video rooms are off for now. Call or message the lead instead.",
    );
  });

  test("waves: start, approve the batch, hold and stop", () => {
    const t = L.waveTables("running", NOW, F_LEADS);
    expect(t.openers).toHaveLength(6);
    const ids = t.openers.map(o => String(o.id));
    const out = L.answerWaves("followup.batch", { ids }, t, NOW) as {
      count: number;
    };
    // One was held by a person and one set aside by the desk.
    expect(out.count).toBe(4);
    L.answerWaves("followup.hold", { id: ids[4], on: false }, t, NOW);
    expect(
      (L.answerWaves("followup.batch", { ids }, t, NOW) as { count: number })
        .count,
    ).toBe(1);
    expect(() =>
      L.answerWaves(
        "followup.wave",
        { op: "start", pool: "no_show_cancelled" },
        t,
        NOW,
      ),
    ).toThrow("A wave is already running on that pool.");
    L.answerWaves("followup.wave", { op: "stop", wave_id: "wave-1" }, t, NOW);
    expect(W.readWave(t.waves.find(w => w.id === "wave-1"))?.state).toBe(
      "done",
    );
  });
});

const F_LEADS = Array.from({ length: 20 }, (_, i) => ({
  contact_id: `lead-${i + 1}`,
}));
