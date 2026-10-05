// Tests added with the fixes to the lc-ui review (2026-10-03). Each
// describe names the finding it proves; rooms.adversarial.test.tsx holds
// the reviewer's own tests, all passing now.
//
// bun test src/lib/rooms.review.test.tsx

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "./apiErrors";
import type { LiveStatus, Offer, PollEnv, Presence, RoomView } from "./rooms";

// The Supabase client needs the build's settings; nothing here reaches it.
mock.module("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));

type Call = { action: string; body: Record<string, unknown> };
const calls: Call[] = [];
let answer: (c: Call) => Promise<unknown> = async () => ({ ok: true });
mock.module("./api", () => ({
  api: (action: string, body: Record<string, unknown> = {}) => {
    const c = { action, body };
    calls.push(c);
    return answer(c);
  },
}));

const R = await import("./rooms");
const F = await import("../dev/roomFixtures");
const { SalesBannerView } = await import("../components/SalesBanner");
const { RoomPanelView } = await import("../components/RoomPanel");
const { LiveBoundary } = await import("../components/RoomLine");

/** 14:12:00 in Kuwait on 3 October 2026. */
const NOW = Date.parse("2026-10-03T11:12:00.000Z");
const S = 1000;
const MIN = 60 * S;
const iso = (ms: number) => new Date(ms).toISOString();

const sentRoom = (over: Partial<RoomView> = {}) =>
  F.baseRoom(NOW, {
    link_channels: ["whatsapp_text"],
    link_sent_at: iso(NOW - 48 * S),
    lead_by: iso(NOW + 552 * S),
    ...over,
  });
const joined = (over: Partial<RoomView> = {}) =>
  sentRoom({
    state: "lead_in",
    host_in_at: iso(NOW - 45 * S),
    lead_in_at: iso(NOW - 25 * S),
    ...over,
  });
const say = (r: RoomView) => R.sentenceText(R.roomSentence(r, { now: NOW }));
const me = (over: Partial<Presence> = {}): Presence => ({
  email: "omar@example.com",
  state: "away",
  until: null,
  room_id: null,
  zoom_status: "licensed",
  default_provider: "zoom",
  ...over,
});
const strip = (over: Partial<Parameters<typeof R.stripLine>[0]> = {}) =>
  R.stripLine({
    me: me(),
    rooms: [],
    offers: [],
    health: F.healthFixture(NOW),
    now: NOW,
    flash: null,
    ...over,
  });

/** HTML text with the entities React writes turned back into characters. */
const decode = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const banner = (
  props: Partial<Parameters<typeof SalesBannerView>[0]> & { data: unknown },
) =>
  renderToStaticMarkup(
    <SalesBannerView
      now={NOW}
      {...props}
      data={props.data as LiveStatus | null}
    />,
  );

const panel = (props: Partial<Parameters<typeof RoomPanelView>[0]> = {}) =>
  renderToStaticMarkup(
    <RoomPanelView
      feed={F.roomFixture("sent", NOW).feed}
      now={NOW}
      {...props}
    />,
  );

beforeEach(() => {
  calls.length = 0;
  answer = async () => ({ ok: true });
  R.forgetRequests();
  R.resetAlerts();
});
afterEach(() => {
  R.forgetRequests();
  R.resetAlerts();
});

// ---------------------------------------------------------------------------

describe("1. channels: P1's wait is said even when the server names no channel", () => {
  test("a link sent on a channel the server did not name still counts down for the lead", () => {
    expect(say(sentRoom({ link_channels: [] }))).toBe(
      "Link sent at 14:11. Waiting for Faisal (9:12 left).",
    );
    expect(say(sentRoom({ link_channels: ["read_out"] }))).toBe(
      "Link sent at 14:11. Waiting for Faisal (9:12 left).",
    );
    expect(say(sentRoom({ link_channels: [], purpose: "manual" }))).toBe(
      "Link sent at 14:11.",
    );
  });

  test("every room fixture uses only channel names the database and sales-api accept", () => {
    // Contract v2 section 3: the glossary's three, nothing else.
    const ok = new Set(R.LINK_CHANNELS);
    for (const knob of F.ROOM_KNOBS)
      for (const c of F.roomFixture(knob, NOW).feed.room.link_channels)
        expect(ok.has(c)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("2. a malformed answer is a failed read, never a throw while drawing", () => {
  const good = F.liveFixture("incoming", NOW, "sent").live;

  test("the shapes the reviewer named are coerced", () => {
    const { offers: _o, ...noOffers } = good;
    expect(R.normalizeLive(noOffers).offers).toEqual([]);
    const nullChannels = {
      ...good,
      rooms: good.rooms.map(r => ({ ...r, link_channels: null })),
    };
    expect(
      R.normalizeLive(nullChannels).rooms.every(r =>
        Array.isArray(r.link_channels),
      ),
    ).toBe(true);
  });

  test("rooms without an id, a known state, a version or a provider are dropped", () => {
    const base = good.rooms[0];
    const rooms = [
      null,
      7,
      "room",
      {},
      { ...base, id: "" },
      { ...base, id: "b", state: "dancing" },
      { ...base, id: "c", version: "3" },
      { ...base, id: "d", provider: "teams" },
      base,
    ];
    const out = R.normalizeLive({ ...good, rooms });
    expect(out.rooms.map(r => r.id)).toEqual([base.id]);
  });

  test("an answer with no readable presence is a failed read, not Away", () => {
    for (const bad of [
      null,
      3,
      "x",
      [],
      {},
      { me: null },
      { me: { state: "x" } },
    ]) {
      let err: unknown = null;
      try {
        R.normalizeLive(bad);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).kind).toBe("server");
    }
  });

  test("a good answer reads back unchanged", () => {
    expect(R.normalizeLive(good)).toEqual(good);
    for (const knob of F.ROOM_KNOBS) {
      const { feed } = F.roomFixture(knob, NOW);
      expect(R.normalizeRoomFeed(feed)).toEqual(feed);
    }
  });

  test("fuzz: 600 damaged live.status answers never throw while drawing", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const junk = () =>
      [
        null,
        undefined,
        0,
        -1,
        Number.NaN,
        "",
        "x",
        "2026-13-45",
        [],
        [null],
        {},
        true,
      ][Math.floor(rnd() * 12)];
    const damage = (v: unknown, depth: number): unknown => {
      if (depth > 3 || rnd() < 0.15) return junk();
      if (Array.isArray(v)) return v.map(x => damage(x, depth + 1));
      if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) {
          if (rnd() < 0.1) continue;
          out[k] = rnd() < 0.2 ? junk() : damage(x, depth + 1);
        }
        return out;
      }
      return rnd() < 0.2 ? junk() : v;
    };
    const sources = [
      F.liveFixture("incoming", NOW, "sent").live,
      F.liveFixture("ready", NOW, "joined").live,
      F.liveFixture("available", NOW, "waiting").live,
      F.liveFixture("booked", NOW, "booked").live,
    ];
    for (let i = 0; i < 600; i++) {
      const raw = damage(sources[i % sources.length], 0);
      expect(() => R.readLive(raw)).not.toThrow();
      expect(() => banner({ data: raw })).not.toThrow();
    }
  });

  test("fuzz: damaged room.status answers are either read or refused, and what is read draws", () => {
    let seed = 11;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const keys = Object.keys(F.roomFixture("joined", NOW).feed.room);
    for (let i = 0; i < 300; i++) {
      const knob = F.ROOM_KNOBS[i % F.ROOM_KNOBS.length];
      const { feed } = F.roomFixture(knob, NOW);
      const room: Record<string, unknown> = { ...feed.room };
      for (const k of keys)
        if (rnd() < 0.2)
          room[k] = [null, 1, "", "x", [], {}][Math.floor(rnd() * 6)];
      let read: ReturnType<typeof R.normalizeRoomFeed> | null = null;
      try {
        read = R.normalizeRoomFeed({ ...feed, room, events: [null, 1, {}] });
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
      }
      if (read) {
        const ok = read;
        expect(() =>
          renderToStaticMarkup(<RoomPanelView feed={ok} now={NOW} />),
        ).not.toThrow();
      }
    }
  });

  test("room.status answering for another room is a failed read, never drawn as this one", async () => {
    answer = async () => ({ ok: true, room: sentRoom({ id: "room-other" }) });
    const err = await R.roomsApi.status("room-k7q2mx").catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe("server");
    answer = async () => ({ ok: true, room: sentRoom() });
    expect((await R.roomsApi.status("room-k7q2mx")).room.id).toBe(
      "room-k7q2mx",
    );
  });

  test("roomsApi.liveStatus turns a bad answer into a server failure", async () => {
    answer = async () => ({ ok: true, rooms: "nope" });
    const err = await R.roomsApi.liveStatus().catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe("server");
    expect(err.message).toBe(R.UNREADABLE);
  });

  test("a press whose answer cannot be read may have landed: the retry is the same request", async () => {
    answer = async () => ({ ok: true, room: { id: "x" } });
    const ask = {
      contact_id: "lead-1",
      provider: "meet" as const,
      call_kind: "intro" as const,
      purpose: "fallback" as const,
    };
    const err = await R.roomsApi.create(ask).catch(e => e);
    expect(err.message).toBe(R.UNREADABLE_PRESS);
    answer = async () => ({ ok: true, room: sentRoom() });
    await R.roomsApi.create(ask);
    expect(calls[0].body.request_id).toBe(calls[1].body.request_id);
  });

  test("the banner's boundary shows the portal's banner when it throws, then tries again", () => {
    expect(LiveBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const b = new LiveBoundary({ fallback: "portal", children: "strip" });
    expect(b.render()).toBe("strip");
    b.state = { failed: true };
    expect(b.render()).toBe("portal");
  });
});

// ---------------------------------------------------------------------------

/** A page the poller can run in: a clock, timers, visibility and the network. */
function fakePage() {
  let t = NOW;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const on = new Map<string, Set<() => void>>();
  const listen = (type: string, fn: () => void) => {
    if (!on.has(type)) on.set(type, new Set());
    on.get(type)?.add(fn);
  };
  const unlisten = (type: string, fn: () => void) => on.get(type)?.delete(fn);
  const fire = (type: string) => {
    for (const fn of on.get(type) ?? []) fn();
  };
  const env: PollEnv = {
    doc: {
      visibilityState: "visible",
      addEventListener: listen,
      removeEventListener: unlisten,
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
      addEventListener: listen,
      removeEventListener: unlisten,
    },
    now: () => t,
  };
  const settle = () => new Promise(r => setTimeout(r, 0));
  return {
    env,
    hide() {
      env.doc.visibilityState = "hidden";
      fire("visibilitychange");
    },
    show() {
      env.doc.visibilityState = "visible";
      fire("visibilitychange");
    },
    online: () => fire("online"),
    /** Let `ms` pass, firing every timer due on the way. */
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
    timers: () => timers.size,
  };
}

describe("3, 6, 14, 26. the poller", () => {
  const live = F.liveFixture("ready", NOW).live;

  test("both feeds keep reading while the tab is hidden, at the same pace", async () => {
    const page = fakePage();
    let reads = 0;
    const p = R.startPoll<LiveStatus>({
      fetcher: async () => {
        reads += 1;
        return live;
      },
      delay: R.liveDelay,
      merge: R.mergeLive,
      whileHidden: true,
      onChange: () => undefined,
      env: page.env,
    });
    await page.pass(0);
    expect(reads).toBe(1);
    page.hide();
    await page.pass(12_000);
    expect(reads).toBe(4);
    p.stop();
  });

  test("without it, a hidden tab reads nothing, and reads at once when it shows", async () => {
    const page = fakePage();
    let reads = 0;
    const p = R.startPoll<LiveStatus>({
      fetcher: async () => {
        reads += 1;
        return live;
      },
      delay: R.liveDelay,
      merge: R.mergeLive,
      onChange: () => undefined,
      env: page.env,
    });
    await page.pass(0);
    page.hide();
    await page.pass(20_000);
    expect(reads).toBe(1);
    page.show();
    await page.pass(5);
    expect(reads).toBe(2);
    p.stop();
  });

  test("failures back off, keep the last good copy, and the network's return reads at once", async () => {
    const page = fakePage();
    let fail = false;
    let reads = 0;
    let last: ReturnType<typeof p.snapshot> | null = null;
    const p = R.startPoll<LiveStatus>({
      fetcher: async () => {
        reads += 1;
        if (fail) throw new ApiError(R.UNREADABLE, "server");
        return live;
      },
      delay: R.liveDelay,
      merge: R.mergeLive,
      whileHidden: true,
      onChange: s => {
        last = s;
      },
      env: page.env,
    });
    await page.pass(0);
    fail = true;
    await page.pass(4000);
    await page.pass(8000);
    expect(reads).toBe(3);
    expect(last?.failures).toBe(2);
    expect(last?.data).toEqual(live);
    expect(
      R.readIsOld(
        { error: "x", failures: 2, okAt: NOW, stopped: false },
        NOW + 12_000,
      ),
    ).toEqual({ since: NOW, kind: null });
    // The backoff is now 16 s; the connection coming back reads at once.
    fail = false;
    page.online();
    await page.pass(5);
    expect(reads).toBe(4);
    expect(last?.failures).toBe(0);
    p.stop();
    expect(page.timers()).toBe(0);
  });

  test("a read that left before a press merges as the older copy (presence kept)", async () => {
    const page = fakePage();
    let release: (v: LiveStatus) => void = () => undefined;
    const merges: boolean[] = [];
    const p = R.startPoll<LiveStatus>({
      fetcher: () => new Promise<LiveStatus>(r => (release = r)),
      delay: () => 4000,
      merge: (prev, next, afterSet) => {
        merges.push(afterSet);
        return R.mergeLive(prev, next, afterSet);
      },
      seed: live,
      whileHidden: true,
      onChange: () => undefined,
      env: page.env,
    });
    await page.pass(0);
    // The press lands while the read is on its way: Away.
    p.set(prev => (prev ? { ...prev, me: me({ state: "away" }) } : prev));
    release(live); // the read still says Ready
    await page.pass(0);
    expect(merges).toEqual([true]);
    expect(p.snapshot().data?.me.state).toBe("away");
    // The next read left after the press: it is believed.
    await page.pass(4000);
    release(live);
    await page.pass(0);
    expect(merges).toEqual([true, false]);
    expect(p.snapshot().data?.me.state).toBe("ready");
    p.stop();
  });

  test("the server's clock sets the offset every countdown adds", async () => {
    const page = fakePage();
    const p = R.startPoll<LiveStatus>({
      // The server is 30 s ahead of this laptop.
      fetcher: async () => ({ ...live, now: iso(NOW + 30 * S) }),
      delay: () => 0,
      merge: R.mergeLive,
      serverNow: d => d.now,
      onChange: () => undefined,
      env: page.env,
    });
    await page.pass(0);
    expect(p.snapshot().offset).toBe(30 * S);
    expect(p.snapshot().stopped).toBe(true);
    expect(R.clockOffset(null, NOW, NOW)).toBeNull();
    expect(R.clockOffset(iso(NOW + 1000), NOW, NOW + 2000)).toBe(0);
    p.stop();
  });

  test("a 403 stops a room's reads and keeps the reason to say", async () => {
    const page = fakePage();
    const p = R.startPoll({
      fetcher: async () => {
        throw new ApiError("This room belongs to Sara.", "refused", 403);
      },
      delay: R.roomDelay,
      merge: R.mergeRoomFeed,
      seed: F.roomFixture("making", NOW).feed,
      whileHidden: true,
      onChange: () => undefined,
      env: page.env,
    });
    await page.pass(0);
    const s = p.snapshot();
    expect(s.stopped).toBe(true);
    expect((s.error as Error).message).toBe("This room belongs to Sara.");
    expect(page.timers()).toBe(0);
    // A reload still reads.
    p.kick();
    expect(page.timers()).toBe(1);
    p.stop();
  });
});

// ---------------------------------------------------------------------------

describe("3. calling a rep back to a hidden tab", () => {
  const fakeDoc = (state = "hidden") => {
    const on = new Set<() => void>();
    return {
      visibilityState: state,
      title: "Dialer · Mahara sales",
      addEventListener: (_: string, fn: () => void) => on.add(fn),
      removeEventListener: (_: string, fn: () => void) => on.delete(fn),
      fire() {
        for (const fn of [...on]) fn();
      },
    };
  };

  test("a new offer and a room's knock are news; the same news is not news twice", () => {
    const before = F.liveFixture("ready", NOW).live;
    const offered = F.liveFixture("incoming", NOW).live;
    expect(R.liveNews(before, offered, NOW)).toEqual({
      key: "offer:live-1",
      text: "Live demo lead, Saudi Arabia, on the line with the setter. Note: Runs 3 fit-out crews and wants more villa projects.",
    });
    expect(R.liveNews(offered, offered, NOW)).toBeNull();
    // An offer whose time is up, or one answered here, is not news.
    expect(R.liveNews(before, offered, NOW + 200 * S)).toBeNull();
    expect(R.liveNews(before, offered, NOW, ["live-1"])).toBeNull();
    const waiting = F.liveFixture("ready", NOW, "waiting").live;
    const sent = F.liveFixture("ready", NOW, "sent").live;
    expect(R.liveNews(sent, waiting, NOW)).toEqual({
      key: "room:room-k7q2mx:waiting_room",
      text: "Faisal is in the waiting room. Admit them in Zoom.",
    });
    expect(R.liveNews(waiting, waiting, NOW)).toBeNull();
  });

  test("on Meet, the lead's open while the rep is already in the room calls the rep back (final review)", () => {
    const sent = F.liveFixture("ready", NOW, "sent").live;
    const meetRoom = (over: Partial<RoomView>) => ({
      ...sent,
      rooms: sent.rooms.map(r => ({
        ...r,
        provider: "meet" as const,
        state: "host_in" as const,
        host_in_at: iso(NOW - 60 * S),
        ...over,
      })),
    });
    const inRoom = meetRoom({});
    const knock = meetRoom({ first_open_at: iso(NOW - 5 * S) });
    const news = R.liveNews(inRoom, knock, NOW);
    expect(news?.key).toBe(`room:${sent.rooms[0]!.id}:host_in_opened`);
    expect(news?.text).toMatch(
      /opened the link at \d{2}:\d{2}\. Let them in, then press The lead is in\.$/,
    );
    expect(R.liveNews(knock, knock, NOW)).toBeNull();
    expect(R.roomActions(knock.rooms[0]!, { now: NOW }).primary?.key).toBe(
      "lead_in",
    );
  });

  test("hidden: the title says it, a sound plays and a notification goes, once", () => {
    const doc = fakeDoc();
    const said: string[] = [];
    let chimes = 0;
    const env = {
      doc,
      chime: () => {
        chimes += 1;
      },
      notify: (text: string) => said.push(text),
    };
    expect(R.alertWhileHidden("offer:live-1", "Live lead: demo.", env)).toBe(
      true,
    );
    expect(doc.title).toBe("Live lead: demo. · Dialer · Mahara sales");
    expect(chimes).toBe(1);
    expect(said).toEqual(["Live lead: demo."]);
    expect(R.alertWhileHidden("offer:live-1", "Live lead: demo.", env)).toBe(
      false,
    );
    expect(chimes).toBe(1);
    // A second piece of news keeps the page's own title underneath.
    R.alertWhileHidden("room:a:opened", "Faisal opened the link.", env);
    expect(doc.title).toBe("Faisal opened the link. · Dialer · Mahara sales");
    // The tab shows: the title is the page's again.
    doc.visibilityState = "visible";
    doc.fire();
    expect(doc.title).toBe("Dialer · Mahara sales");
  });

  test("a visible tab is already saying it: nothing happens", () => {
    const doc = fakeDoc("visible");
    let chimes = 0;
    const env = { doc, chime: () => (chimes += 1) };
    expect(R.alertWhileHidden("k", "x", env)).toBe(false);
    expect(chimes).toBe(0);
    expect(doc.title).toBe("Dialer · Mahara sales");
  });

  test("a sound or a notification that fails never stops the title", () => {
    const doc = fakeDoc();
    const env = {
      doc,
      chime: () => {
        throw new Error("no audio");
      },
      notify: () => {
        throw new Error("denied");
      },
    };
    expect(R.alertWhileHidden("k2", "Faisal joined.", env)).toBe(true);
    expect(doc.title.startsWith("Faisal joined.")).toBe(true);
  });

  test("I'm available asks for notifications once, from the press", () => {
    const g = globalThis as { Notification?: unknown };
    const had = g.Notification;
    let asked = 0;
    try {
      g.Notification = {
        permission: "default",
        requestPermission: async () => {
          asked += 1;
          return "granted";
        },
      };
      R.primeAlerts();
      expect(asked).toBe(1);
      (g.Notification as { permission: string }).permission = "granted";
      R.primeAlerts();
      expect(asked).toBe(1);
    } finally {
      g.Notification = had;
    }
  });
});

// ---------------------------------------------------------------------------

describe("4. P1's joined lines", () => {
  test("a room made for a booked intro is marked, not booked again", () => {
    expect(
      say(joined({ count_result: "booked", appointment_id: "appt-1" })),
    ).toBe("Faisal joined at 14:11. The intro is marked shown.");
    expect(say(joined({ count_result: "moved" }))).toBe(
      "Faisal joined at 14:11. The intro is marked shown.",
    );
    expect(say(joined({ count_result: "booked" }))).toBe(
      "Faisal joined. Booked as a live intro and marked shown.",
    );
  });
});

describe("6. presence from an older read, and rooms that are gone", () => {
  test("presence a press set survives a read that left before it", () => {
    const prev = F.liveFixture("away", NOW).live;
    const pressed = { ...prev, me: me({ state: "available" }) };
    expect(R.mergeLive(pressed, prev, true).me.state).toBe("available");
    expect(R.mergeLive(pressed, prev, false).me.state).toBe("away");
  });

  test("an ended room is remembered only until the server stops listing it", () => {
    const before = F.liveFixture("away", NOW, "host_in").live;
    const own = before.rooms[0];
    const ended = R.withRoom(before, {
      ...own,
      version: own.version + 1,
      state: "ended",
    });
    expect(ended.gone).toEqual({ [own.id]: own.version + 1 });
    const late = R.mergeLive(ended, before);
    expect(late.rooms).toHaveLength(0);
    expect(late.gone).toEqual({ [own.id]: own.version + 1 });
    const fresh = R.mergeLive(late, { ...before, rooms: [] });
    expect(fresh.gone).toBeUndefined();
  });
});

describe("7. flashes and offers", () => {
  test("a Taken or Lost flash never hides another live offer", () => {
    for (const flash of [
      { kind: "taken" as const, at: NOW - S },
      { kind: "lost" as const, at: NOW - S, by: "Omar", text: null },
    ]) {
      const l = strip({
        me: me({ state: "ready" }),
        offers: [F.offerFixture(NOW, { id: "live-9" })],
        flash,
      });
      expect(l.moment).toBe("offer");
      expect(l.offer?.id).toBe("live-9");
    }
  });

  test("the offer card shows a failed press under the offer", () => {
    const html = banner({
      data: F.liveFixture("incoming", NOW).live,
      flash: {
        kind: "error",
        at: NOW,
        text: "Not now did not reach the server. Press it again.",
      },
    });
    const text = decode(html);
    expect(text).toContain("Live demo lead");
    expect(text).toContain("Not now did not reach the server. Press it again.");
    expect(text).toContain("Take it");
  });
});

describe("9. a room the server will not read for this seat", () => {
  test("says the server's sentence at once, with no buttons that would fail too", () => {
    const html = panel({
      feed: F.roomFixture("making", NOW).feed,
      blocked: "This room belongs to Sara.",
    });
    expect(decode(html)).toContain("This room belongs to Sara.");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("data-key=");
  });
});

describe("10. rooms on, live calls off", () => {
  test("the seat's own room still shows, with no presence and no offers", () => {
    const live = {
      ...F.liveFixture("incoming", NOW, "sent").live,
      live_enabled: false,
    };
    const text = decode(banner({ data: live }));
    expect(text).toContain("Video room: Faisal, 9:12 left.");
    expect(text).not.toContain("Live lead");
    expect(text).not.toContain("I'm available");
  });

  test("with no room of its own the slot is the portal's", () => {
    const html = banner({
      data: F.liveFixture("live_off", NOW).live,
      portal: <p>portal</p>,
    });
    expect(html).not.toContain('role="region"');
    expect(html).toContain("<div><p>portal</p></div>");
  });
});

describe("11. Try Zoom asks for the same room", () => {
  test("the retry carries the trigger, the attempt and the booked call", () => {
    const failed = F.baseRoom(NOW, { state: "failed" });
    expect(
      R.retryRequest(
        failed,
        {
          contact_id: "lead-1",
          provider: "meet",
          call_kind: "intro",
          purpose: "fallback",
          trigger: "no_answer",
          attempt_id: "att-1",
          appointment_id: "appt-1",
        },
        "zoom",
      ),
    ).toEqual({
      contact_id: "lead-1",
      provider: "zoom",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
      attempt_id: "att-1",
      appointment_id: "appt-1",
    });
    // Without the first request, the room's own fields when served.
    expect(
      R.retryRequest(
        { ...failed, trigger: "busy", appointment_id: "appt-2" },
        null,
        "zoom",
      ),
    ).toMatchObject({ trigger: "busy", appointment_id: "appt-2" });
  });

  test("a handover's retry is project 2's: shown only when the page passes it", () => {
    const feed = F.roomFixture("failed_handover", NOW).feed;
    const button = /<button[^>]*data-key="retry"[^>]*>Use Meet<\/button>/;
    expect(panel({ feed })).toMatch(button);
    expect(panel({ feed, canRetry: false })).not.toContain('data-key="retry"');
    expect(decode(panel({ feed }))).toContain(
      "Zoom did not open your room: the host was not found. Use Meet.",
    );
  });
});

describe("12. focus and what a screen reader hears", () => {
  test("the Undo strip and the end question take the focus a press let go", () => {
    expect(panel({ undo: "lead_in" })).toMatch(
      /<button[^>]*data-autofocus[^>]*>.*Undo/,
    );
    const confirm = panel({
      feed: F.roomFixture("joined", NOW).feed,
      confirmEnd: true,
    });
    expect(confirm).toMatch(/<button[^>]*data-autofocus[^>]*>Keep it/);
    // Every action button can be found again by its key.
    expect(panel()).toContain('data-key="open"');
  });

  test("the banner has exactly two live regions, mounted always; an offer goes in the assertive one", () => {
    const offer = banner({ data: F.liveFixture("incoming", NOW).live });
    expect(offer.match(/aria-live=/g)?.length).toBe(2);
    expect(offer).toMatch(
      /aria-live="assertive"[^>]*>Live demo lead, Saudi Arabia, on the line with the setter\. Note: Runs 3 fit-out crews/,
    );
    const idle = banner({ data: F.liveFixture("away", NOW).live });
    expect(idle.match(/aria-live=/g)?.length).toBe(2);
    expect(idle).toMatch(/aria-live="assertive"[^>]*><\/p>/);
    const nothing = banner({ data: null });
    expect(nothing.match(/aria-live=/g)?.length).toBe(2);
  });
});

describe("15. the standby room", () => {
  test("a room that could not be made says why, and Try again tries again", () => {
    const l = strip({
      me: me({ state: "available", until: iso(NOW + 2 * 3600 * S) }),
      standbyError: "The host's Zoom user was not found.",
    });
    // A whole sentence from the worker is said as it is, with the next step.
    expect(R.sentenceText(l.sentence)).toBe(
      "Your room was not made. The host's Zoom user was not found. Try again, or set yourself away.",
    );
    expect(l.primary).toEqual({ key: "available", label: "Try again" });
    expect(l.quiet).toEqual([{ key: "away", label: "Set me away" }]);
    // A bare reason is set after a colon; one that only repeats itself goes.
    expect(R.standbyFailedSentence("your Zoom account was not found")).toBe(
      "Your room was not made: your Zoom account was not found. Try again, or set yourself away.",
    );
    expect(R.standbyFailedSentence("the room could not be made")).toBe(
      "Your room was not made. Try again, or set yourself away.",
    );
    expect(
      R.standbyFailedSentence(
        "Not made: the room worker did not pick this room up in time.",
      ),
    ).toBe(
      "Your room was not made: the room worker did not pick this room up in time. Try again, or set yourself away.",
    );
  });

  test("Available with a room open or being made can still go Away (final review)", () => {
    const until = iso(NOW + 2 * 3600 * S);
    for (const state of ["open", "host_in", "creating"] as const) {
      const l = strip({
        me: me({ state: "available", until }),
        rooms: [
          F.baseRoom(NOW, {
            purpose: "standby",
            contact_id: null,
            contact_first_name: null,
            state,
          }),
        ],
      });
      // A Meet standby room also offers I'm in (Meet sends no join signal; stress2 fix round 1).
      expect(l.quiet.at(-1)).toEqual({ key: "away", label: "Set me away" });
    }
  });

  test("the standby cap's sentence is said whole, with Try again", () => {
    const said =
      "Your last standby room closed under 10 minutes ago, so no new one was made yet. Try again in a few minutes. You can still take a live lead now.";
    expect(R.standbyFailedSentence(said)).toBe(said);
    const l = strip({
      me: me({ state: "available", until: iso(NOW + 3600 * S) }),
      standbyError: said,
    });
    expect(R.sentenceText(l.sentence)).toBe(said);
    expect(l.quiet).toEqual([{ key: "away", label: "Set me away" }]);
  });

  test("a room on its way says so; no room and no reason claims nothing", () => {
    const until = iso(NOW + 138 * MIN);
    const making = strip({
      me: me({ state: "available", until }),
      rooms: [F.standbyFixture(NOW, { state: "requested" })],
    });
    expect(R.sentenceText(making.sentence)).toBe(
      "Available until 16:30. Making your room...",
    );
    expect(making.primary?.disabled).toBe(true);
    const none = strip({ me: me({ state: "available", until }) });
    expect(R.sentenceText(none.sentence)).toBe("Available until 16:30.");
    // No room and no reason (it closed for a booked call or a lead's room):
    // Get my room asks for one again (stress2 fix round 1) ...
    expect(none.primary).toEqual({ key: "available", label: "Get my room" });
    expect(none.quiet.map(a => a.key)).toEqual(["away"]);
    // ... unless standby rooms are off, where none is ever made.
    const off = strip({
      me: me({ state: "available", until }),
      standbyOn: false,
    });
    expect(off.primary).toBeNull();
  });
});

describe("16, 17. Not now and Take", () => {
  test("Not now is one request however often it is pressed, and a retry is the same one", async () => {
    let fail = true;
    answer = async () => {
      if (fail) throw new ApiError("maybe", "timeout");
      return { ok: true };
    };
    const o = F.offerFixture(NOW);
    await expect(R.roomsApi.decline(o)).rejects.toThrow();
    fail = false;
    await Promise.all([R.roomsApi.decline(o), R.roomsApi.decline(o)]);
    expect(calls).toHaveLength(2);
    expect(calls[0].body.request_id).toBe(calls[1].body.request_id);
  });

  test("what a failed press means", () => {
    const stale = new ApiError("This changed a moment ago.", "refused", 409);
    const lost = new ApiError("Someone else took this lead.", "refused", 409);
    const maybe = new ApiError("no answer", "timeout");
    expect(R.takeFailure(stale)).toBe("stale");
    expect(R.takeFailure(lost)).toBe("lost");
    expect(R.takeFailure(maybe)).toBe("uncertain");
    expect(R.declineFailure(lost)).toBe("gone");
    expect(R.declineFailure(maybe)).toBe("again");
    expect(R.declineFailure(new Error("x"))).toBe("again");
  });
});

describe("18. I can't let them in", () => {
  test("on a Meet fallback room with a lead, behind its Undo; never on Zoom", () => {
    const keys = (r: RoomView) =>
      R.roomActions(r, { now: NOW }).quiet.map(a => a.key);
    expect(keys(sentRoom())).toContain("admit_blocked");
    expect(keys(sentRoom({ state: "host_in" }))).toContain("admit_blocked");
    expect(keys(sentRoom({ provider: "zoom" }))).not.toContain("admit_blocked");
    expect(keys(sentRoom({ purpose: "handover" }))).not.toContain(
      "admit_blocked",
    );
    expect(R.needsUndo("admit_blocked")).toBe(true);
    expect(R.undoLabel("admit_blocked")).toBe("Moving the lead to Zoom");
  });

  test("room.end hands back the Zoom room that replaces it", async () => {
    answer = async c =>
      F.answerRoomsAction(c.action, c.body, { room: "host_in" }, NOW);
    const r = F.roomFixture("host_in", NOW).feed.room;
    const out = await R.roomsApi.end(r, "admit_blocked");
    expect(calls[0].body).toMatchObject({ reason: "admit_blocked" });
    expect(out.room.state).toBe("cancelled");
    expect(out.room.result).toBe("admit_blocked");
    expect(out.replacement?.provider).toBe("zoom");
  });
});

describe("20. the booked-call line", () => {
  test("says the call's kind, and gives the button back once the call starts", () => {
    const booked = me({
      reason: "booked_call_soon",
      booked_at: iso(NOW + 38 * MIN),
      booked_kind: "intro",
    });
    const l = strip({ me: booked });
    expect(R.sentenceText(l.sentence)).toBe(
      "Your booked intro starts at 14:50, so your room is closed. Press I'm available after it.",
    );
    const after = strip({ me: booked, now: NOW + 39 * MIN });
    expect(after.moment).toBe("away");
    expect(after.primary?.key).toBe("available");
  });

  test("with the reason served, only missed_offer is a miss", () => {
    const o = F.offerFixture(NOW, { offer_until: iso(NOW - 2 * S) });
    expect(
      R.offerGone([o], [], me({ reason: "missed_offer" }), new Set(), NOW)
        ?.kind,
    ).toBe("missed");
    // Went Away by hand while the offer was up: it closed, not missed.
    expect(
      R.offerGone([o], [], me({ reason: null }), new Set(), NOW)?.kind,
    ).toBe("closed");
  });
});

describe("22. held request ids belong to the signed-in seat", () => {
  test("another seat on the same tab starts fresh; the same seat keeps its retry", async () => {
    answer = async () => {
      throw new ApiError("maybe", "timeout");
    };
    const ask = {
      contact_id: "lead-1",
      provider: "meet" as const,
      call_kind: "intro" as const,
      purpose: "fallback" as const,
    };
    R.scopeRequests("sara@example.com");
    await R.roomsApi.create(ask).catch(() => undefined);
    const key = "room.create:lead-1:fallback:meet";
    const first = R.heldRequestId(key);
    expect(first).not.toBeNull();
    R.scopeRequests("SARA@example.com ");
    expect(R.heldRequestId(key)).toBe(first);
    R.scopeRequests("omar@example.com");
    expect(R.heldRequestId(key)).toBeNull();
  });
});

describe("23. reasons after a colon", () => {
  test("only sentence openers lose their capital", () => {
    expect(R.reasonWords("Do not disturb is on in HighLevel.")).toBe(
      "do not disturb is on in HighLevel",
    );
    expect(R.reasonWords("The host's Zoom user was not found.")).toBe(
      "the host's Zoom user was not found",
    );
    expect(R.reasonWords("Omar has the only Zoom seat.")).toBe(
      "Omar has the only Zoom seat",
    );
  });
});

describe("25. the not-updated lines", () => {
  test("one sentence for the strip and the panel, and one for a first read that failed", () => {
    expect(decode(panel({ stale: { since: NOW - 30 * S } }))).toContain(
      "Not updated since 14:11. Check the connection.",
    );
    expect(decode(panel({ stale: { since: null } }))).toContain(
      "This room could not be read. Check the connection.",
    );
    const text = decode(banner({ data: null, readFailed: true }));
    expect(text).toContain(
      "Live calls could not be read. Check the connection.",
    );
    expect(text).toContain("Try again");
    expect(
      R.readIsOld({ error: null, failures: 0, okAt: NOW, stopped: false }, NOW),
    ).toBeNull();
    expect(
      R.readIsOld({ error: "x", failures: 1, okAt: NOW, stopped: false }, NOW),
    ).toBeNull();
    expect(
      R.readIsOld({ error: "x", failures: 1, okAt: null, stopped: true }, NOW),
    ).toBeNull();
  });
});

describe("28. a press held behind its Undo", () => {
  test("goes only to the room it was pressed on", () => {
    const a = sentRoom();
    expect(R.heldTarget(a.id, a)).toBe(a);
    expect(R.heldTarget(a.id, { ...a, id: "room-other" })).toBeNull();
    expect(R.heldTarget(a.id, null)).toBeNull();
  });
});

describe("29. the host's link when the browser blocks the tab", () => {
  test("is a button that opens it, never a link written into the page", () => {
    const url = "https://us06web.zoom.us/s/81234567890?zak=secret";
    const html = panel({
      notice: {
        tone: "owed",
        text: "Your browser blocked the new tab.",
        open: { url, label: "Open my room" },
      },
    });
    expect(html).not.toContain("href=");
    expect(html).not.toContain("zak=");
    expect(decode(html)).toContain(
      "Your browser blocked the new tab. Open my room",
    );
  });
});

// ---------------------------------------------------------------------------

describe("14. every fixture draws", () => {
  // Contract v2 section 3: roomlogic's 28 keys plus the six v2 adds
  // (link_unconfirmed_at, starts_at, trigger, attempt_id, appointment_id,
  // handover_id). Pinned here so a change on either side is seen.
  const ROOM_VIEW_KEYS = [
    "id",
    "code",
    "contact_id",
    "contact_first_name",
    "purpose",
    "call_kind",
    "provider",
    "host_email",
    "state",
    "version",
    "short_url",
    "join_url",
    "link_channels",
    "link_sent_at",
    "first_open_at",
    "open_device",
    "lead_waiting_at",
    "host_in_at",
    "lead_in_at",
    "lead_in_seen_at",
    "ended_at",
    "host_by",
    "lead_by",
    "ends_at",
    "result",
    "count_result",
    "error",
    "refusal",
    "created_at",
    "link_unconfirmed_at",
    "trigger",
    "attempt_id",
    "appointment_id",
    "handover_id",
    "starts_at",
    // stress2 fix round 1.
    "end_reason",
    "last_open_at",
    // stress2 fix round 5: the link's later send, and an open after the close.
    "last_link_at",
    "late_open_at",
  ];

  test("the browser's key list is contract v2's, in full", () => {
    expect([...R.ROOM_VIEW_KEYS].sort()).toEqual([...ROOM_VIEW_KEYS].sort());
  });

  test("every room fixture is a RoomView sales-api can serve (roomlogic ROOM_VIEW_KEYS)", () => {
    for (const knob of F.ROOM_KNOBS) {
      const room = F.roomFixture(knob, NOW).feed.room;
      for (const k of ROOM_VIEW_KEYS) expect(k in room).toBe(true);
      for (const k of Object.keys(room)) expect(ROOM_VIEW_KEYS).toContain(k);
      expect(R.normalizeRoom(room)).toEqual(room);
      expect(JSON.stringify(room)).not.toMatch(/start_url|zak=/);
    }
  });

  for (const knob of F.ROOM_KNOBS)
    test(`the room panel draws room=${knob} with its sentence`, () => {
      const { feed, canMarkIntro } = F.roomFixture(knob, NOW);
      const html = renderToStaticMarkup(
        <RoomPanelView feed={feed} now={NOW} canMarkIntro={canMarkIntro} />,
      );
      // The panel's own context: the room line on screen carries the
      // countdown, and a room still being made with the worker down says so.
      const showLine =
        feed.room.state !== "failed" &&
        (feed.room.purpose !== "standby" || Boolean(feed.room.contact_id));
      const said = R.sentenceText(
        R.roomSentence(feed.room, {
          now: NOW,
          canMarkIntro,
          lineShown: showLine,
          workerDown: feed.health?.worker_ok === false,
        }),
      );
      expect(decode(html)).toContain(said);
      expect(html).not.toMatch(/undefined|NaN|\[object/);
    });

  const ROOMS_FOR_BANNER = [
    null,
    "sent",
    "waiting",
    "joined",
    "booked",
  ] as const;
  for (const knob of F.OFFER_KNOBS)
    for (const roomKnob of ROOMS_FOR_BANNER)
      test(`the banner draws offer=${knob} room=${roomKnob ?? "none"}`, () => {
        const { live, flash } = F.liveFixture(knob, NOW, roomKnob);
        const html = banner({ data: live, flash, portal: <i>portal</i> });
        expect(html).not.toMatch(/undefined|NaN|\[object/);
        // Something is always said, or the portal's banner is on show.
        expect(
          html.includes('role="region"') || html.includes("<div><i>portal"),
        ).toBe(true);
      });

  test("the harness answers every press, the new ones too", () => {
    for (const [action, body] of [
      ["room.end", { reason: "admit_blocked" }],
      ["room.end", { reason: "finished", confirm: true }],
      ["live.take", { live_id: "live-1" }],
      ["live.decline", { live_id: "live-1" }],
    ] as const) {
      const out = F.answerRoomsAction(
        action,
        { ...body },
        { room: "sent" },
        NOW,
      );
      expect(out?.ok).toBe(true);
    }
  });
});

describe("helpers the fixes rely on", () => {
  test("an offer is live until its time is up", () => {
    const offers: Offer[] = [
      F.offerFixture(NOW, { id: "late", offer_until: iso(NOW + 90 * S) }),
      F.offerFixture(NOW, { id: "gone", offer_until: iso(NOW - 1) }),
      F.offerFixture(NOW, { id: "soon", offer_until: iso(NOW + 10 * S) }),
    ];
    expect(R.liveOffers(offers, NOW).map(o => o.id)).toEqual(["soon", "late"]);
    expect(R.liveOffers(offers, NOW, ["soon"]).map(o => o.id)).toEqual([
      "late",
    ]);
  });

  test("health counts that could not be read are left out, never 0", () => {
    expect(
      R.healthSentence({
        worker_ok: true,
        last_run_at: iso(NOW - 2 * S),
        rooms_today: null,
        failed_today: null,
        line: "",
      }),
    ).toBe("Rooms: working. Last run 14:11:58.");
  });
});
