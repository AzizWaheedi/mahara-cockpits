// The design review and the fallback review of live calls (4 October 2026):
// one describe per finding, named by its number in each review ("D" for the
// design review, "F" for the fallback review).
//
// bun test src/lib/design_fallback.test.tsx

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError, answerFailure, SIGNED_OUT } from "./apiErrors";
import type { LiveStatus, PollEnv, Presence, RoomView } from "./rooms";

mock.module("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));
mock.module("./api", () => ({ api: async () => ({ ok: true }) }));

const R = await import("./rooms");
const F = await import("../dev/roomFixtures");
const H = await import("./roomsHealth");
const W = await import("./waves");
const V = await import("./videoLink");
const { readConvo } = await import("../components/Conversation");
const { RoomPanelView, splitQuiet, TOUCH } = await import(
  "../components/RoomPanel"
);
const { RoomLine, Countdown } = await import("../components/RoomLine");
const { SalesBannerView } = await import("../components/SalesBanner");
const { buttonPrimary } = await import("../components/kit");
const { AvailabilityStrip, PresenceDot, StaleNote } = await import(
  "../components/AvailabilityStrip"
);

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
const text = (s: Parameters<typeof R.sentenceText>[0]) => R.sentenceText(s);
const me = (over: Partial<Presence> = {}): Presence => ({
  email: "omar@example.com",
  state: "away",
  until: null,
  room_id: null,
  zoom_status: "licensed",
  default_provider: "zoom",
  ...over,
});
const decode = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const panel = (
  feed = F.roomFixture("sent", NOW).feed,
  props: Partial<Parameters<typeof RoomPanelView>[0]> = {},
) => renderToStaticMarkup(<RoomPanelView feed={feed} now={NOW} {...props} />);
const live = (room: RoomView, over: Partial<LiveStatus> = {}): LiveStatus => ({
  me: me(),
  rooms: [room],
  offers: [],
  health: F.healthFixture(NOW),
  live_enabled: false,
  ...over,
});

beforeEach(() => {
  R.forgetRequests();
  R.resetAlerts();
});
afterEach(() => {
  R.forgetRequests();
  R.resetAlerts();
});

describe("D1. the room line never cuts its own words", () => {
  const html = renderToStaticMarkup(<RoomLine room={sentRoom()} now={NOW} />);
  test("labels are kept whole (no truncate), the countdown takes its own row when narrow", () => {
    expect(html).not.toContain("truncate");
    for (const label of ["Link sent", "Opened", "You&#x27;re in", "Lead in"])
      expect(html).toMatch(new RegExp(`whitespace-nowrap[^>]*>${label}<`));
    // Below 28rem: a column, countdown first (reversed), on its own row.
    expect(html).toContain(
      "flex min-w-0 max-w-3xl flex-col-reverse items-stretch gap-2 @md:flex-row",
    );
    expect(html).toContain("self-end @md:self-auto");
  });

  test("at the panel's narrowest widths (254, 294, 302 px) the steps sit two to a row", () => {
    // Two columns until the card is 28rem (448 px) wide: each label then has
    // at least (254 - 8) / 2 = 123 px, wider than "Link sent" with its dot.
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("@md:grid-cols-4");
    for (const w of [254, 294, 302]) expect(w).toBeLessThan(448);
  });
});

describe("D3. every room button is 44 px on touch, over the global rule", () => {
  test("the touch class is marked important", () => {
    expect(TOUCH).toBe("pointer-coarse:min-h-11!");
    const html = panel();
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(3);
    for (const b of buttons) expect(b).toContain("pointer-coarse:min-h-11!");
  });

  test("the video link button and the Video call menu carry it too", () => {
    const {
      VideoLinkButton,
      VideoCallMenu,
    } = require("../components/VideoLink");
    expect(
      renderToStaticMarkup(<VideoLinkButton onPress={() => undefined} />),
    ).toContain("pointer-coarse:min-h-11!");
    expect(
      renderToStaticMarkup(
        <VideoCallMenu linkShown liveOn={false} onPick={() => undefined} />,
      ),
    ).toContain("pointer-coarse:min-h-11!");
  });
});

describe("D4. the panel is the room line first, not a wall of buttons", () => {
  test("one primary, at most two quiet buttons, More, then End room last", () => {
    const quiet = R.roomActions(sentRoom(), { now: NOW }).quiet;
    expect(quiet.map(a => a.key)).toEqual([
      "host_in",
      "copy",
      "email",
      "on_phone",
      "admit_blocked",
      "end",
    ]);
    const split = splitQuiet(quiet);
    expect(split.front.map(a => a.key)).toEqual(["host_in", "copy"]);
    expect(split.more.map(a => a.key)).toEqual([
      "email",
      "on_phone",
      "admit_blocked",
    ]);
    expect(split.end?.key).toBe("end");
    const html = panel();
    expect(decode(html)).toContain("More");
    // End room is a text button at the far end, red only on hover.
    expect(html).toMatch(
      /ms-auto[^"]*hover:text-\[color:var\(--destructive\)\][^>]*>End room/,
    );
    // Behind More until asked for.
    expect(decode(html)).not.toContain("We are on the phone");
    // The layout reads the panel's own width.
    expect(html).toContain("@container");
    expect(html).toContain("@md:flex-row");
  });

  test("a single extra button is not hidden behind More", () => {
    const s = splitQuiet([
      { key: "copy", label: "Copy link" },
      { key: "host_in", label: "I'm in" },
      { key: "email", label: "Send by email" },
    ]);
    expect(s.more).toEqual([]);
    expect(s.front.map(a => a.key)).toEqual(["copy", "host_in", "email"]);
  });

  test("a manager's Count this join always stays in front", () => {
    const s = splitQuiet([
      { key: "not_lead", label: "That was not the lead" },
      { key: "finished", label: "Finished" },
      { key: "count_confirm", label: "Count this join" },
    ]);
    expect(s.front.map(a => a.key)).toContain("count_confirm");
  });
});

describe("D5. one teal button at a time", () => {
  const room = sentRoom({ first_open_at: iso(NOW - 10 * S) });
  test("with the room on a panel, the banner's Open my room is quiet", () => {
    const on = renderToStaticMarkup(
      <SalesBannerView now={NOW} data={live(room)} roomOnScreen />,
    );
    const off = renderToStaticMarkup(
      <SalesBannerView now={NOW} data={live(room)} />,
    );
    // The kit's own primary class, whatever it looks like this season: the
    // test asks which button is primary, not what teal is drawn with.
    const primary = new RegExp(
      `class="${buttonPrimary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*"[^>]*>Open my room`,
    );
    expect(off).toMatch(primary);
    expect(on).not.toMatch(primary);
    expect(decode(on)).toContain("Open my room");
  });
});

describe("D6. ending a room yourself never says the lead did not join in 10 minutes", () => {
  test("ended with nobody in it says it ended, and asks for the intro's mark", () => {
    const r = sentRoom({
      state: "ended",
      result: "no_join",
      ended_at: iso(NOW),
    });
    expect(R.roomMoment(r, NOW)).toBe("ended_empty");
    expect(text(R.roomSentence(r, { now: NOW }))).toBe(
      "Room ended at 14:12. Nobody joined. Call again or send a message.",
    );
    expect(text(R.roomSentence(r, { now: NOW, canMarkIntro: true }))).toBe(
      "Room ended at 14:12. Nobody joined. Mark the intro:",
    );
    expect(
      R.roomActions(r, { now: NOW, canMarkIntro: true }).quiet.map(a => a.key),
    ).toEqual(["noshow", "showed"]);
    // The sweep's own expiry keeps its words.
    expect(
      text(
        R.roomSentence(sentRoom({ state: "expired", result: "no_join" }), {
          now: NOW,
        }),
      ),
    ).toContain("did not join in 10 minutes");
  });
});

describe("D7 and F9. a room still being made when it will not be made", () => {
  const making = (age: number) =>
    F.baseRoom(NOW, {
      state: "requested",
      version: 1,
      short_url: null,
      join_url: null,
      created_at: iso(NOW - age),
    });

  test("with the worker down: one red sentence with the next step, no teal step, no second health line", () => {
    const { feed } = F.roomFixture("down", NOW);
    const ctx = { now: NOW, workerDown: true };
    expect(R.momentFor(feed.room, ctx)).toBe("making_down");
    expect(text(R.roomSentence(feed.room, ctx))).toBe(
      "This room will not be made: video rooms are down. Call the lead on the phone, or send your own Zoom or Meet link.",
    );
    expect(R.roomTone("making_down")).toBe("bad");
    const html = panel(feed);
    expect(html).not.toContain('aria-current="step"');
    expect(decode(html)).not.toContain("last check");
    expect(decode(html)).not.toContain("Making your");
    // The banner says the same.
    expect(
      text(R.bannerRoomSentence(feed.room, NOW, { workerDown: true })),
    ).toContain("This room will not be made");
  });

  test("past 150 s it says it is taking too long, and offers the other provider", () => {
    expect(R.roomMoment(making(30 * S), NOW)).toBe("making");
    const late = making(160 * S);
    expect(R.roomMoment(late, NOW)).toBe("making_late");
    expect(text(R.roomSentence(late, { now: NOW }))).toBe(
      "This room is taking too long to make. Call the lead on the phone, or end it and try Zoom.",
    );
    expect(R.roomTone("making_late")).toBe("owed");
    expect(
      R.roomActions(late, { now: NOW }).quiet.map(a => [a.key, a.label]),
    ).toEqual([
      ["retry", "Try Zoom"],
      ["end", "End room"],
    ]);
    // A room 30 minutes in "requested" never still says "Making...".
    expect(text(R.roomSentence(making(30 * MIN), { now: NOW }))).not.toContain(
      "Making",
    );
  });
});

describe("D8. a closed room says how it ended, once", () => {
  test("moved to the phone, finished, and the line set back", () => {
    expect(
      text(
        R.summarySentence(
          sentRoom({
            state: "cancelled",
            result: "moved_to_phone",
            ended_at: iso(NOW),
          }),
        ),
      ),
    ).toBe("Moved to the phone at 14:12. Room closed.");
    const done = sentRoom({
      state: "ended",
      result: "joined",
      lead_in_at: iso(NOW - 5 * MIN),
      ended_at: iso(NOW),
    });
    expect(text(R.summarySentence(done))).toBe("Finished at 14:12.");
    expect(text(R.summarySentence(done))).not.toContain("Video room on");
    expect(panel({ room: done, events: [], health: null })).toContain(
      "opacity-60",
    );
  });
});

describe("D9. the countdown shows once in the panel", () => {
  test("the line has it; the sentence under it does not", () => {
    const html = decode(panel());
    expect(html).toContain(
      "Link sent on WhatsApp at 14:11. Waiting for Faisal.",
    );
    expect(html).not.toContain("(9:12 left)");
    expect(html.match(/9:12/g)?.length).toBe(1);
    // The banner has no line, so it keeps it.
    expect(text(R.bannerRoomSentence(sentRoom(), NOW))).toContain("9:12 left");
  });
});

describe("D10. the current step is said in words, and its dot passes 3:1 on white", () => {
  test("waiting under the current step, inked like the countdown; the dot mixes teal with the ink", () => {
    const html = renderToStaticMarkup(<RoomLine room={sentRoom()} now={NOW} />);
    expect(html).toMatch(/aria-current="step".*?waiting/s);
    expect(html).toContain(
      "bg-[color:color-mix(in_oklch,var(--now)_55%,var(--foreground))] dark:bg-[color:var(--now)]",
    );
  });

  test("a frozen line has no current step and no countdown", () => {
    const html = renderToStaticMarkup(
      <RoomLine room={sentRoom()} now={NOW} frozen dim />,
    );
    expect(html).not.toContain('aria-current="step"');
    expect(html).not.toContain('role="timer"');
    expect(html).toContain("opacity-60");
  });
});

describe("D11. the banner's room row: the room's own dot, and a button that says where it goes", () => {
  test("no grey away dot beside urgent news; Open the lead, hidden when the lead is on screen", () => {
    const opened = sentRoom({ first_open_at: iso(NOW - 5 * S) });
    const html = renderToStaticMarkup(
      <SalesBannerView now={NOW} data={live(opened)} />,
    );
    expect(html).not.toContain('aria-label="Away"');
    expect(html).toContain("background:var(--now)");
    const joined = sentRoom({
      state: "lead_in",
      lead_in_at: iso(NOW - 10 * S),
    });
    expect(
      decode(
        renderToStaticMarkup(<SalesBannerView now={NOW} data={live(joined)} />),
      ),
    ).toContain("Open the lead");
    expect(
      decode(
        renderToStaticMarkup(
          <SalesBannerView now={NOW} data={live(joined)} roomOnScreen />,
        ),
      ),
    ).not.toContain("Open the lead");
  });
});

describe("D12. the offer reads at a glance", () => {
  test("bold head, the note muted under it, the countdown in mono beside the buttons", () => {
    const line = R.stripLine({
      me: me({ state: "ready" }),
      rooms: [],
      offers: [F.offerFixture(NOW)],
      health: F.healthFixture(NOW),
      now: NOW,
      flash: null,
    });
    const html = renderToStaticMarkup(
      <AvailabilityStrip
        line={line}
        presence="ready"
        now={NOW}
        onAction={() => undefined}
      />,
    );
    expect(html).toMatch(/font-semibold[^>]*>Live demo lead, Saudi Arabia/);
    expect(html).toMatch(/muted[^>]*>Note: Runs 3 fit-out crews/);
    expect(html).toContain('role="timer"');
    expect(html).toMatch(/font-mono text-\[15px\] font-semibold[^>]*>1:47/);
    expect(text(line.sentence)).not.toContain("left");
  });
});

describe("D14. failures in the strip are plain, red, and say what to do", () => {
  test("rooms down: red dot, the plain sentence", () => {
    const html = renderToStaticMarkup(
      <PresenceDot state="available" tone="bad" />,
    );
    expect(html).toContain("background:var(--destructive)");
  });
});

describe("D15 and F19. a stale read looks stale, says why, and offers a read", () => {
  test("the panel's line is set back, frozen, and the note has Read again", () => {
    const html = panel(F.roomFixture("sent", NOW).feed, {
      stale: { since: NOW - 30 * S, kind: "network" },
      onReload: () => undefined,
    });
    expect(html).toContain("opacity-60");
    expect(html).not.toContain('aria-current="step"');
    expect(html).not.toContain('role="timer"');
    expect(decode(html)).toContain("Read again");
    expect(decode(html)).toContain("Check the connection.");
  });

  test("a server in trouble is not the rep's connection", () => {
    const html = renderToStaticMarkup(
      <StaleNote since={NOW - 30 * S} kind="server" />,
    );
    expect(decode(html)).toContain(
      "The server is having trouble; the cockpit tries again by itself. Call the lead if you need to.",
    );
    expect(decode(html)).not.toContain("Check the connection");
  });
});

describe("D16. the Undo window can be seen without motion", () => {
  test("seconds left in mono, and a 32 px Undo", () => {
    const html = panel(F.roomFixture("host_in", NOW).feed, {
      undo: "lead_in",
      undoAt: Date.now() - 1000,
    });
    expect(html).toMatch(/min-h-8[^>]*>.*Undo/s);
    expect(decode(html)).toMatch(/Undo· \d s/);
    expect(R.secondsLeft(NOW, 5000, NOW + 1200)).toBe(4);
    expect(R.secondsLeft(NOW, 5000, NOW + 9000)).toBe(0);
    expect(text(V.autoParts("Faisal", 8))).toBe(
      "Sending a video link to Faisal in 8 s.",
    );
    expect(V.autoParts("Faisal", 8)).toContainEqual({ mono: "8" });
  });
});

describe("D17. labels say what they do", () => {
  test("Send by email when nothing went, hidden when email cannot reach the lead", () => {
    const fresh = F.baseRoom(NOW);
    expect(
      R.roomActions(fresh, { now: NOW }).quiet.find(a => a.key === "email")
        ?.label,
    ).toBe("Send by email");
    const blocked = F.baseRoom(NOW, {
      refusal: "No message can reach this lead.",
    });
    expect(
      R.roomActions(blocked, { now: NOW }).quiet.some(a => a.key === "email"),
    ).toBe(false);
    expect(
      R.roomActions(sentRoom(), { now: NOW }).quiet.find(a => a.key === "email")
        ?.label,
    ).toBe("Also send by email");
  });

  test("I'm in on both providers; the hint names the button; the timeline toggle says what it does", () => {
    const meet = R.roomActions(sentRoom(), { now: NOW }).quiet;
    expect(meet.find(a => a.key === "host_in")?.label).toBe("I'm in");
    const zoom = sentRoom({ provider: "zoom", link_sent_at: iso(NOW - MIN) });
    expect(
      R.roomActions(zoom, { now: NOW }).quiet.find(a => a.key === "host_in")
        ?.label,
    ).toBe("I'm in");
    expect(text(R.roomHint(zoom, NOW) ?? [])).toBe(
      "Zoom has not said you are in. Press I'm in once you are.",
    );
    expect(decode(panel())).toContain("Show the timeline");
  });
});

describe("D18. the picker's labels and the plan line", () => {
  test("Send a Meet link / Use Zoom instead; by email", () => {
    const setting = V.readRoomsSetting({
      enabled: true,
      providers: { meet: true, zoom: true },
      send: { email: true },
    });
    const c = setting && V.providerChoice({ setting, role: "setter" });
    expect(c && V.choiceLabels(c)).toEqual({
      first: "Send a Meet link",
      other: "Use Zoom instead",
    });
    expect(
      setting &&
        V.linkPlanLine({
          setting,
          whatsapp: null,
          email: { on: true, dnd: false, reachable: true },
          guardOpen: true,
          templateLive: true,
          emailFirst: true,
        }),
    ).toBe("The lead gets the link by email.");
  });
});

describe("D19. the Team card never says working above red jobs", () => {
  test("the worst tone leads, with how many jobs need attention", () => {
    const lines = H.roomJobLines(
      [
        {
          worker: "sales-live",
          job: "zoom",
          ok: false,
          detail: "The webhook secret is not set",
          at: iso(NOW - 9 * MIN),
        },
      ],
      NOW,
      true,
    );
    const s = H.roomsSummary(F.healthFixture(NOW), lines);
    expect(s.tone).toBe("bad");
    expect(s.sentence).toMatch(
      /^Rooms make links, but \d jobs? needs? attention\.$/,
    );
    // Each red line ends with its runbook step; times are mono.
    const zoom = lines.find(l => l.key === "sales-live:zoom");
    expect(zoom?.text).toContain("Set ZOOM_WEBHOOK_SECRET");
    expect(zoom?.say).toContainEqual({ mono: "14:03" });
    // A step the job already wrote is not said twice.
    const own = H.roomJobLines(
      [
        {
          worker: "sales-live",
          job: "zoom",
          ok: false,
          detail:
            "ZOOM_WEBHOOK_SECRET is missing on sales-live. Add it to the function's secrets.",
          at: iso(NOW - 9 * MIN),
        },
      ],
      NOW,
      true,
    ).find(l => l.key === "sales-live:zoom");
    expect(own?.text).not.toContain("Set ZOOM_WEBHOOK_SECRET and");
  });

  test("Basic is owed, not green", () => {
    expect(
      H.seatRoomLines(
        {
          email: "a@x",
          zoom_status: "basic",
          zoom_live_until: null,
          google_ok: true,
          default_provider: "zoom",
          checked_at: iso(NOW),
        },
        NOW,
      ).zoom.tone,
    ).toBe("owed");
  });
});

describe("D21. tones", () => {
  test("a room waiting on a Zoom seat is owed; Still on the call? is now", () => {
    const pending = F.roomFixture("pending_zoom", NOW).feed.room;
    expect(R.roomTone("failed", pending)).toBe("owed");
    expect(R.roomTone("failed", F.roomFixture("failed", NOW).feed.room)).toBe(
      "bad",
    );
    expect(R.roomTone("still_on_call")).toBe("now");
  });
});

// ---------------------------------------------------------------------------
// The fallback review
// ---------------------------------------------------------------------------

describe("F1. a lapsed sign-in is said, never hidden", () => {
  test("any 401 is a sign-in, the gateway's included", () => {
    const own = answerFailure(401, { ok: false, error: "Sign in again." });
    expect(own?.kind).toBe("signin");
    const gateway = answerFailure(401, { error: "Invalid JWT" } as never);
    expect(gateway?.kind).toBe("signin");
    expect(gateway?.message).toBe(SIGNED_OUT);
  });

  test("a stopped poll for a lapsed sign-in reads again when the session comes back", async () => {
    const page = fakePage();
    let authed = false;
    let reads = 0;
    const p = R.startPoll<LiveStatus>({
      fetcher: async () => {
        reads += 1;
        if (!authed) throw new ApiError(SIGNED_OUT, "signin", 401);
        return F.liveFixture("away", NOW).live;
      },
      delay: R.liveDelay,
      merge: R.mergeLive,
      onChange: () => undefined,
      env: page.env,
    });
    await page.pass(0);
    expect(p.snapshot().stopped).toBe(true);
    await page.pass(60_000);
    expect(reads).toBe(1);
    // A refreshed token restarts it.
    authed = true;
    page.auth();
    await page.pass(10);
    expect(reads).toBe(2);
    expect(p.snapshot().stopped).toBe(false);
    p.stop();
  });

  test("the network's return and the tab coming back restart it too", async () => {
    for (const how of ["online", "show"] as const) {
      const page = fakePage();
      let reads = 0;
      const p = R.startPoll<LiveStatus>({
        fetcher: async () => {
          reads += 1;
          throw new ApiError(SIGNED_OUT, "signin", 401);
        },
        delay: R.liveDelay,
        merge: R.mergeLive,
        onChange: () => undefined,
        env: page.env,
      });
      await page.pass(0);
      if (how === "online") page.online();
      else page.show();
      await page.pass(10);
      expect([how, reads]).toEqual([how, 2]);
      p.stop();
    }
  });

  test("the banner keeps an open room's last copy under a Sign in row", () => {
    const room = sentRoom({ first_open_at: iso(NOW - 5 * S) });
    const html = decode(
      renderToStaticMarkup(
        <SalesBannerView
          now={NOW}
          data={live(room)}
          signedOut
          staleSince={NOW - 40 * S}
        />,
      ),
    );
    expect(html).toContain(
      "Your sign-in ran out. Sign in again to see your room and live leads.",
    );
    expect(html).toContain("Sign in");
    expect(html).toContain("Faisal opened the link.");
    expect(html).toContain("Not updated since");
    // With nothing read at all the row still shows.
    expect(
      decode(
        renderToStaticMarkup(
          <SalesBannerView now={NOW} data={null} signedOut />,
        ),
      ),
    ).toContain("Sign in");
  });
});

describe("F2 and F3. Open my room never fails without a word", () => {
  test("the room row shows what the press said, with a link to open", () => {
    const html = decode(
      renderToStaticMarkup(
        <SalesBannerView
          now={NOW}
          data={live(sentRoom())}
          roomNote={{
            tone: "owed",
            text: "The cockpit could not get your host link. Open the room with its own link.",
            open: {
              url: "https://meet.google.com/abc",
              label: "Open the room",
            },
          }}
        />,
      ),
    );
    expect(html).toContain("Open the room with its own link.");
    expect(html).toContain("Open the room");
  });
});

describe("F4. a hung read counts as old", () => {
  test("in flight past 20 s with no error yet is stale", () => {
    expect(
      R.readIsOld(
        {
          error: null,
          failures: 0,
          okAt: NOW - 25 * S,
          stopped: false,
          busySince: NOW - 21 * S,
        },
        NOW,
      ),
    ).toEqual({ since: NOW - 25 * S, kind: null });
    expect(
      R.readIsOld(
        {
          error: null,
          failures: 0,
          okAt: NOW - 5 * S,
          stopped: false,
          busySince: NOW - 3 * S,
        },
        NOW,
      ),
    ).toBeNull();
    expect(R.READ_TIMEOUT_MS).toBe(10_000);
  });
});

describe("F5. a garbled conversation never takes the page down", () => {
  test("no thread or channels is no answer; missing parts are filled empty", () => {
    expect(() => readConvo({ ok: true })).toThrow();
    expect(() => readConvo("nonsense")).toThrow();
    const c = readConvo({ thread: [], channels: {} });
    expect(c.cursors).toEqual({});
    expect(c.channels.whatsapp).toEqual({
      on: false,
      dnd: false,
      reachable: false,
    });
    expect(Object.keys(c.cursors)).toEqual([]);
    const d = readConvo({
      thread: [{ id: "m1" }, null, 3],
      channels: { whatsapp: { on: true, dnd: false, reachable: true } },
      cursors: { a: "x", b: 4 },
    });
    expect(d.thread.length).toBe(1);
    expect(d.cursors).toEqual({ a: "x" });
  });
});

describe("F6. an offer taken in another tab is not said to have closed", () => {
  test("a room made for the offer means it was taken here", () => {
    const o = F.offerFixture(NOW);
    const room = sentRoom({ purpose: "handover", handover_id: o.id });
    expect(
      R.offerGone([o], [], me({ state: "ready" }), new Set(), NOW, [room]),
    ).toBeNull();
    expect(
      R.offerGone([o], [], me({ state: "ready" }), new Set(), NOW, []),
    ).toMatchObject({ kind: "closed" });
  });
});

describe("F7. the waves card says when the desk is not running", () => {
  const wave = {
    id: "w",
    pool: "no_show_cancelled",
    segment: "reactivate",
    per_day: 40,
    holdout_share: 0.1,
    state: "running",
    made_by: "a",
    created_at: iso(NOW - 86_400_000),
    started_at: iso(NOW - 86_400_000),
    enrolled_at: iso(NOW - 86_400_000),
    ended_at: null,
    done_reason: null,
  } as unknown as Parameters<typeof W.waveLine>[0];
  const c = W.countsFor(
    W.countMembers([
      { wave_id: "w", contact_id: "x", arm: "wave", state: "waiting" },
    ] as never),
    "w",
  );
  const next = { at: NOW - MIN, now: NOW };
  test("no row, an old row, or an unread row: no batch is being written", () => {
    expect(W.waveLine(wave, c, next, { missing: true })).toContain(
      "The wave run has not reported yet, so no batch is being written. A manager checks the Team page.",
    );
    expect(
      W.waveLine(wave, c, next, {
        ok: true,
        detail: null,
        at: iso(NOW - 20 * MIN),
      }),
    ).toContain(
      "The wave run has not reported since 13:52, so no batch is being written.",
    );
    expect(W.waveLine(wave, c, next, { unread: true })).toContain(
      "could not be read",
    );
    expect(
      W.waveLine(wave, c, next, {
        ok: true,
        detail: null,
        at: iso(NOW - 2 * MIN),
      }),
    ).toContain("Today's batch is being written now.");
  });
});

describe("F10. a countdown stuck at 0:00 says the room should have closed", () => {
  test("two minutes past the deadline: end the room is the one action", () => {
    const r = sentRoom({ lead_by: iso(NOW - 3 * MIN) });
    expect(R.roomMoment(r, NOW)).toBe("overdue");
    expect(text(R.roomSentence(r, { now: NOW }))).toBe(
      "This room should have closed. Call the lead, or end the room.",
    );
    expect(R.roomActions(r, { now: NOW }).primary?.key).toBe("end");
    expect(R.roomMoment(sentRoom({ lead_by: iso(NOW - 60 * S) }), NOW)).toBe(
      "sent",
    );
  });
});

describe("F16 and F17. links nobody can send", () => {
  test("a Zoom link nobody can read out offers Meet", () => {
    const url =
      "https://us06web.zoom.us/j/81234567890?pwd=aBcD3fGhIjKlMnOpQrStUvWxYz012345.1";
    const r = F.baseRoom(NOW, {
      provider: "zoom",
      short_url: url,
      join_url: url,
      refusal: "No message can reach this lead.",
    });
    expect(text(R.roomSentence(r, { now: NOW }))).toContain(
      "or end this room and use Meet, whose link can be read out.",
    );
    expect(
      R.roomActions(r, { now: NOW }).quiet.find(a => a.key === "retry")?.label,
    ).toBe("Use Meet");
  });
});

describe("F18. garbage never reads as truth", () => {
  test("an error that is not a sentence; a health with no yes or no; a time nobody can read", () => {
    expect(
      answerFailure(500, { ok: false, error: { a: 1 } } as never)?.message,
    ).toBe("The server answered 500. Try again.");
    const long = "x".repeat(400);
    expect(answerFailure(409, { ok: false, error: long })?.message.length).toBe(
      300,
    );
    expect(R.normalizeHealth({})).toBeNull();
    expect(R.normalizeHealth({ worker_ok: "yes" })).toBeNull();
    expect(R.normalizeHealth({ worker_ok: false })?.worker_ok).toBe(false);
    const line = H.roomJobLines(
      [
        {
          worker: "sales-desk",
          job: "rooms",
          ok: true,
          detail: null,
          at: "soon",
        },
      ],
      NOW,
      true,
    )[0];
    expect(line.tone).toBe("owed");
    expect(line.text).toContain("reported at a time that cannot be read");
  });
});

describe("F20. copy that says something", () => {
  test("the sweep's Not made: prefix goes", () => {
    const r = F.baseRoom(NOW, {
      state: "failed",
      error: "Not made: the room worker did not pick this room up in time.",
    });
    expect(text(R.failedSentence(r))).toBe(
      "Meet did not make the room: the room worker did not pick this room up in time. Try Zoom, or call again.",
    );
  });
});

describe("F21. a crashed panel still gives the code and link", () => {
  test("the boundary's words carry the room's code", () => {
    const { RoomPanel } = require("../components/RoomPanel");
    expect(typeof RoomPanel).toBe("function");
    // The boundary's fallback is built from the page's room, before any read.
    const room = F.baseRoom(NOW);
    expect(R.shortLink(room)).toBe("https://call.maharamedia.com/K7Q2MX");
  });
});

describe("F22. one clock for the banner and the panel", () => {
  test("a slow trip does not move the offset; a seed starts the panel on the page's", async () => {
    const page = fakePage();
    let slow = false;
    const p = R.startPoll<LiveStatus>({
      fetcher: async () => {
        if (slow) await new Promise<void>(r => page.after(3000, r));
        return { ...F.liveFixture("away", NOW).live, now: iso(NOW + 5000) };
      },
      delay: R.liveDelay,
      merge: R.mergeLive,
      serverNow: d => d.now,
      seedOffset: 1234,
      onChange: () => undefined,
      env: page.env,
    });
    expect(p.snapshot().offset).toBe(1234);
    await page.pass(0);
    const quick = p.snapshot().offset;
    expect(quick).toBe(5000);
    slow = true;
    await page.pass(40_000);
    expect(p.snapshot().offset).toBe(quick);
    p.stop();
  });
});

describe("Countdown face", () => {
  test("mono 15 px semibold, as the room line's", () => {
    expect(renderToStaticMarkup(<Countdown ms={107_000} />)).toContain(
      "font-mono text-[15px] font-semibold",
    );
  });
});

/** A page the poller can run in: a clock, timers, visibility, the network and the session. */
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
    onAuth: fn => {
      listen("auth", fn);
      return () => unlisten("auth", fn);
    },
  };
  const settle = () => new Promise(r => setTimeout(r, 0));
  return {
    env,
    show() {
      env.doc.visibilityState = "visible";
      fire("visibilitychange");
    },
    online: () => fire("online"),
    auth: () => fire("auth"),
    /** A wait inside a fetcher, on the page's own clock. */
    after(ms: number, fn: () => void) {
      seq += 1;
      timers.set(seq, { at: t + ms, fn });
    },
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
        await settle();
      }
      t = end;
    },
  };
}
