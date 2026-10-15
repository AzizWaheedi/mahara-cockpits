/**
 * Hubstaff watch, the screen side (docs/hours-watch/SPEC.md, the CEO
 * 2026-10-13): the board the browser trusts, how each action reaches the
 * server, the shift line's marks and what it reads aloud, and every missing
 * or failing sentence the card prints. Every name, time and screenshot is
 * made up (src/dev/watchFixture.ts).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { time } from "../src/components/ceo/format";
import { installCeoHarness } from "../src/dev/ceoHarness";
import {
  type WatchScenario,
  watchBoardFixture,
  watchSettings,
} from "../src/dev/watchFixture";
import {
  ceoHoursAction,
  checkWatchPatch,
  parseWatchBoard,
  parseWatchKey,
  parseWatchNow,
  parseWatchReview,
  parseWatchSet,
  parseWatchSettings,
} from "../src/lib/ceoHoursClient";
import { ShiftLegend, ShiftLine } from "../src/pages/ceo/hours/ShiftLine";
import { WatchCard } from "../src/pages/ceo/hours/WatchCard";
import {
  AlertSwitches,
  KeyBox,
  settingsPatch,
} from "../src/pages/ceo/hours/WatchSettings";
import {
  AI_KEY_NEEDED,
  aiSentence,
  boardErrorText,
  buildLine,
  dayLabel,
  figures,
  headline,
  incidentSentence,
  lineDomain,
  needsLook,
  PHONE_ACTIVITY,
  problems,
  recentSentence,
  rowFix,
  slackLine,
  slotActivity,
  stateChip,
  TICK_MERGE_PX,
  tickGroups,
} from "../src/pages/ceo/hours/watchCopy";
import { WATCH_DEFAULTS, type WatchBoard } from "../src/types/ceo/hoursWatch";

/** 11:40 in Kuwait on Tuesday 13 October 2026: the 10:00 to 18:00 shift is on. */
const NOW = Date.parse("2026-10-13T08:40:00Z");
const board = (scenario: WatchScenario = "full") =>
  parseWatchBoard(watchBoardFixture(scenario, NOW));
const raw = (scenario: WatchScenario = "full") =>
  watchBoardFixture(scenario, NOW) as Record<string, any>;

/** The markup as text: tags out, the escapes React writes put back. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

const noop = () => {};
const actions = {
  onCheckNow: noop,
  onSetAlerts: noop,
  onSet: async () => {},
  onKey: async () => ({
    ok: true as const,
    state: "connected" as const,
    text: "Connected.",
  }),
  onReview: noop,
  onGoTeam: noop,
  sign: async (p: string) => `https://example.test/${p}`,
};
const card = (b: WatchBoard | null, error: string | null = null) =>
  renderToStaticMarkup(
    createElement(WatchCard, { board: b, error, now: NOW, actions }),
  );

describe("the board the browser trusts", () => {
  test("every harness scenario parses", () => {
    for (const s of [
      "full",
      "none",
      "source",
      "noai",
      "aifail",
      "offshift",
      "slack",
    ] as WatchScenario[]) {
      const b = board(s);
      expect(b.settings).toEqual(WATCH_DEFAULTS);
      expect(Array.isArray(b.people)).toBe(true);
    }
    const b = board();
    expect(b.people.map(p => p.name)).toEqual([
      "Hala Mansour",
      "Omar Fayed",
      "Sara Kanaan",
      "Lina Haddad",
      "Yousef Karam",
    ]);
    expect(b.people[2].shots[0]).toMatchObject({
      verdict: "not_work",
      label: "Instagram feed",
      thumbPath: "2026/10/103/900003-thumb.jpg",
    });
    expect(b.open.map(i => [i.kind, i.slackState])).toEqual([
      ["not_tracking", "posted"],
      ["not_work", "posted"],
    ]);
    expect(b.recent).toHaveLength(8);
  });

  test("a shape it cannot trust is refused, never guessed", () => {
    const bad: [string, (r: Record<string, any>) => unknown][] = [
      ["no board", () => null],
      ["no settings", r => ({ ...r, settings: null })],
      ["no cron flag", r => ({ ...r, cronOn: "yes" })],
      ["people not a list", r => ({ ...r, people: {} })],
      [
        "an unknown state",
        r => ({ ...r, people: [{ ...r.people[0], state: "away" }] }),
      ],
      [
        "a person without an id",
        r => ({ ...r, people: [{ ...r.people[0], personId: null }] }),
      ],
      [
        "an unknown kind",
        r => ({ ...r, open: [{ ...r.open[0], kind: "late" }] }),
      ],
      [
        "an unknown Slack state",
        r => ({ ...r, open: [{ ...r.open[0], slackState: "sent" }] }),
      ],
      [
        "a closed alert without its close",
        r => ({ ...r, recent: [{ ...r.recent[0], closedAt: null }] }),
      ],
      [
        "an unknown AI state",
        r => ({
          ...r,
          sources: { ...r.sources, ai: { state: "fine", provider: null } },
        }),
      ],
    ];
    for (const [, make] of bad)
      expect(() => parseWatchBoard(make(raw()))).toThrow(
        "not confirmed by the server",
      );
  });

  test("missing figures stay missing; bad slots and shots are dropped", () => {
    expect(
      parseWatchBoard({ ...raw(), lastRun: { at: null, ok: null } }).lastRun,
    ).toBeNull();
    const r = raw();
    r.people[0] = {
      ...r.people[0],
      trackedTodayS: null,
      activePct30m: "",
      slots: [{ start: "nope", trackedS: 600 }, { trackedS: 1 }],
      shots: [{ id: 0, at: "x", verdict: "not_work" }],
    };
    const p = parseWatchBoard(r).people[0];
    expect(p.trackedTodayS).toBeNull();
    expect(p.activePct30m).toBeNull();
    expect(p.slots).toEqual([]);
    expect(p.shots).toEqual([]);
  });

  test("settings: every number is required; the answers to actions are checked", () => {
    expect(() =>
      parseWatchSettings({ ...WATCH_DEFAULTS, graceMinutes: null }),
    ).toThrow("not confirmed");
    expect(parseWatchSet({ ok: true })).toEqual({ ok: true, settings: null });
    expect(
      parseWatchSet({ ok: true, settings: { ...WATCH_DEFAULTS, on: false } })
        .settings?.on,
    ).toBe(false);
    expect(parseWatchSet({ ...WATCH_DEFAULTS }).settings?.channel).toBe(
      "C0B5TL9H370",
    );
    expect(() => parseWatchSet({})).toThrow("not confirmed");
    expect(parseWatchReview({ ok: true })).toEqual({
      ok: true,
      reviewedAt: null,
    });
    expect(() => parseWatchReview(null)).toThrow("not confirmed");
    expect(parseWatchNow({ ok: true })).toEqual({ ok: true });
    expect(
      parseWatchNow({ ok: false, busy: true, since: "2026-10-13T08:35:00Z" }),
    ).toEqual({ ok: false, busy: true, since: "2026-10-13T08:35:00Z" });
    expect(() => parseWatchNow({ ok: false })).toThrow("not confirmed");
    expect(parseWatchKey({ ok: false, state: "refused" })).toEqual({
      ok: false,
      state: "refused",
      text: "The key was refused. Nothing was changed.",
    });
    expect(() => parseWatchKey("ok")).toThrow("not confirmed");
  });

  test("a settings change is held to the server's bounds before it is sent", () => {
    expect(checkWatchPatch({ on: false, graceMinutes: 0 })).toEqual({
      on: false,
      graceMinutes: 0,
    });
    expect(() => checkWatchPatch({ graceMinutes: 121 })).toThrow(
      "Grace after the shift starts: choose 0 to 120 minutes.",
    );
    expect(() => checkWatchPatch({ minConfidence: 0.4 })).toThrow(
      "choose 50% to 99%",
    );
    expect(() => checkWatchPatch({ idleFloorPct: "10" })).toThrow(
      "Keyboard and mouse below: choose 1% to 50%.",
    );
    expect(() => checkWatchPatch({ channel: "team" })).toThrow("C or G");
    expect(() => checkWatchPatch({ webhook: "x" })).toThrow(
      "not a watch setting",
    );
    expect(() => checkWatchPatch({})).toThrow("Change a setting first.");
  });

  test("the sheet sends only what changed, and says which field is out of bounds", () => {
    const draft = {
      notTrackingMinutes: "45",
      graceMinutes: "15",
      idleMinutes: "30",
      idleFloorPct: "10",
      windowMinutes: "30",
      nonWorkShots: "2",
      minConfidence: "80",
      channel: "C0B5TL9H370",
      channelName: "#team-management",
    };
    expect(settingsPatch(WATCH_DEFAULTS, draft)).toEqual({
      patch: { notTrackingMinutes: 45, minConfidence: 0.8 },
      errors: {},
    });
    const out = settingsPatch(WATCH_DEFAULTS, {
      ...draft,
      graceMinutes: "",
      nonWorkShots: "9",
    });
    expect(out.errors).toEqual({
      graceMinutes: "Choose 0 to 120.",
      nonWorkShots: "Choose 1 to 6.",
    });
  });
});

/** A client that records what it was asked, for the routing tests. */
function recorder(answer: (name: string, args: unknown) => unknown) {
  const calls: { kind: "rpc" | "fn" | "sign"; name: string; args: unknown }[] =
    [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ kind: "rpc", name, args });
      return { data: answer(name, args), error: null };
    },
    functions: {
      invoke: async (name: string, opts: { body: unknown }) => {
        calls.push({ kind: "fn", name, args: opts.body });
        return { data: answer(name, opts.body), error: null };
      },
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, seconds: number) => {
          calls.push({ kind: "sign", name: bucket, args: [path, seconds] });
          return {
            data: { signedUrl: `https://example.test/signed/${path}` },
            error: null,
          };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("each action reaches the server the spec names", () => {
  test("the board, the settings and Mark reviewed are CEO-gated RPCs", async () => {
    const { client, calls } = recorder(name =>
      name === "cockpit_ceo_hours_watch_board"
        ? watchBoardFixture("full", NOW)
        : name === "cockpit_ceo_hours_watch_set"
          ? { ok: true, settings: { ...WATCH_DEFAULTS, on: false } }
          : { ok: true, reviewedAt: "2026-10-13T08:41:00Z" },
    );
    const b = (await ceoHoursAction(client, "watchBoard", {})) as WatchBoard;
    expect(b.people).toHaveLength(5);
    const set = (await ceoHoursAction(client, "watchSet", { on: false })) as {
      settings: { on: boolean };
    };
    expect(set.settings.on).toBe(false);
    await ceoHoursAction(client, "watchReview", { incidentId: 510 });
    await ceoHoursAction(client, "watchReview", {
      incidentId: 511,
      note: " Spoke to her ",
    });
    expect(calls).toEqual([
      { kind: "rpc", name: "cockpit_ceo_hours_watch_board", args: {} },
      {
        kind: "rpc",
        name: "cockpit_ceo_hours_watch_set",
        args: { p: { on: false } },
      },
      {
        kind: "rpc",
        name: "cockpit_ceo_hours_watch_review",
        args: { p: { incidentId: 510 } },
      },
      {
        kind: "rpc",
        name: "cockpit_ceo_hours_watch_review",
        args: { p: { incidentId: 511, note: "Spoke to her" } },
      },
    ]);
  });

  test("a refused value never leaves the browser", async () => {
    const { client, calls } = recorder(() => ({ ok: true }));
    await expect(
      ceoHoursAction(client, "watchSet", { nonWorkShots: 7 }),
    ).rejects.toThrow("choose 1 to 6 screenshots");
    await expect(
      ceoHoursAction(client, "watchReview", { incidentId: 0 }),
    ).rejects.toThrow("Choose an alert first.");
    await expect(
      ceoHoursAction(client, "watchKey", { provider: "anthropic", key: "x" }),
    ).rejects.toThrow("Google AI or OpenAI");
    await expect(
      ceoHoursAction(client, "watchKey", {
        provider: "google_ai",
        key: "two words here",
      }),
    ).rejects.toThrow("doesn't look like a key");
    expect(calls).toEqual([]);
  });

  test("Check now and the key go to cockpit-hours-api; the key is never echoed", async () => {
    const { client, calls } = recorder((_n, body) =>
      (body as { op: string }).op === "watchNow"
        ? { ok: true }
        : { ok: true, state: "connected", text: "Connected: Google AI." },
    );
    expect(await ceoHoursAction(client, "watchNow", {})).toEqual({ ok: true });
    const key = "AIza_made_up_key_value_123";
    const out = await ceoHoursAction(client, "watchKey", {
      provider: "google_ai",
      key: ` ${key} `,
    });
    expect(out).toEqual({
      ok: true,
      state: "connected",
      text: "Connected: Google AI.",
    });
    expect(JSON.stringify(out)).not.toContain(key);
    expect(calls).toEqual([
      { kind: "fn", name: "cockpit-hours-api", args: { op: "watchNow" } },
      {
        kind: "fn",
        name: "cockpit-hours-api",
        args: { op: "watchKey", provider: "google_ai", key },
      },
    ]);
  });

  test("a screenshot is signed for 10 minutes from the private bucket", async () => {
    const { client, calls } = recorder(() => null);
    expect(
      await ceoHoursAction(client, "watchShotUrl", {
        path: "2026/10/103/900002-thumb.jpg",
      }),
    ).toEqual({
      url: "https://example.test/signed/2026/10/103/900002-thumb.jpg",
    });
    expect(calls).toEqual([
      {
        kind: "sign",
        name: "cockpit-hours-watch",
        args: ["2026/10/103/900002-thumb.jpg", 600],
      },
    ]);
    for (const path of ["", "../keys", "/etc/x"])
      await expect(
        ceoHoursAction(client, "watchShotUrl", { path }),
      ).rejects.toThrow("not one the cockpit keeps");
  });

  test("the board is a read: it never fires the page-wide refresh", () => {
    const src = readFileSync(
      new URL("../src/lib/cockpitApi.ts", import.meta.url),
      "utf8",
    );
    const verbs = src.slice(
      src.indexOf("const READ_VERBS"),
      src.indexOf("};", src.indexOf("const READ_VERBS")),
    );
    expect(verbs).toMatch(/\n\s*watchBoard: true,/);
    expect(verbs).toMatch(/\n\s*watchShotUrl: true,/);
    expect(verbs).not.toMatch(/watch(Set|Review|Now|Key): true/);
  });
});

describe("the shift line", () => {
  const b = board();
  const domain = lineDomain(b.people, NOW);
  const line = (i: number, known = true) =>
    buildLine(b.people[i], domain, NOW, b.settings.graceMinutes, known);

  test("every row spans the same whole hours, an hour either side of the shift", () => {
    expect(new Date(domain.from).toISOString()).toBe(
      "2026-10-13T06:00:00.000Z",
    );
    expect(new Date(domain.to).toISOString()).toBe("2026-10-13T16:00:00.000Z");
  });

  test("tracked, idle, a gap past the grace, unread, ticks and now", () => {
    const hala = line(0);
    const kinds = (l: typeof hala) => l.segments.map(s => s.kind);
    expect(kinds(hala).filter(k => k === "tracked")).toHaveLength(7);
    expect(kinds(hala).filter(k => k === "idle")).toHaveLength(1);
    expect(kinds(hala)).not.toContain("gap");
    expect(hala.segments.find(s => s.kind === "unread")).toMatchObject({
      from: Date.parse("2026-10-13T08:20:00Z"),
      to: NOW,
    });
    const busy = hala.segments.find(s => s.kind === "tracked");
    expect(busy?.activity).toBeCloseTo(0.7);

    const omar = line(1);
    // Read at 11:38: blocks up to 11:18 are in, so the gap stops at 11:10.
    expect(omar.segments.filter(s => s.kind === "gap")).toEqual([
      {
        kind: "gap",
        from: Date.parse("2026-10-13T07:20:00Z"),
        to: Date.parse("2026-10-13T08:10:00Z"),
      },
    ]);
    expect(omar.summary).toBe(
      "Shift 10:00 to 18:00. Tracked 12 min today. Not tracked 10:20 to 11:10. The latest minutes are not in from Hubstaff yet. Now 11:40.",
    );

    const sara = line(2);
    expect(sara.ticks.map(t => t.shot.label)).toEqual([
      "YouTube video",
      "Instagram feed",
    ]);
    expect(sara.now).toBe(NOW);
    expect(sara.hours).toHaveLength(11);
  });

  test("when Hubstaff cannot be read, untracked time is unread, never a gap", () => {
    const omar = line(1, false);
    expect(omar.segments.some(s => s.kind === "gap")).toBe(false);
    expect(omar.segments.some(s => s.kind === "unread")).toBe(true);
  });

  test("it renders each mark, the ticks open screenshots, and it reads itself aloud", () => {
    const html = (i: number, widthPx = 900) =>
      renderToStaticMarkup(
        createElement(ShiftLine, {
          line: line(i),
          name: b.people[i].name,
          live: true,
          onOpenShot: noop,
          widthPx,
        }),
      );
    const hala = html(0);
    for (const kind of ["shift", "outside", "tracked", "idle", "unread", "now"])
      expect(hala).toContain(`data-kind="${kind}"`);
    expect(hala).toContain('role="img"');
    expect(hala).toContain('data-live="true"');
    expect(hala).toContain('--hw-a:0.81"');
    expect(html(1)).toContain('data-kind="gap"');
    const sara = html(2);
    expect(sara.match(/class="hw-tick no-touch/g)).toHaveLength(2);
    expect(words(sara)).not.toContain("Lock screen");
    expect(sara).toContain(
      'aria-label="Open Sara Kanaan&#x27;s screenshot from 11:13, judged not work: YouTube video"',
    );
    expect(words(sara)).toContain("10 11 12 13 14");
    // On a phone the two ticks, 10 minutes apart, are one button.
    const phone = html(2, 326);
    expect(phone.match(/class="hw-tick no-touch/g)).toHaveLength(1);
    expect(phone).toContain(
      'aria-label="Open Sara Kanaan&#x27;s 2 screenshots from 11:13 to 11:23, judged not work"',
    );
    expect(phone).toContain('data-count="2"');
  });

  // review_1 MINOR 4 (probe E): three screenshots 10 minutes apart on a 390 px phone.
  test("ticks closer than 12 px merge into one button", () => {
    const p = b.people[2];
    const shots = [0, 10, 20].map((m, i) => ({
      id: i + 1,
      at: new Date(
        Date.parse("2026-10-13T11:00:00Z") + m * 60_000,
      ).toISOString(),
      verdict: "not_work" as const,
      label: "YouTube",
      confidence: 0.9,
      thumbPath: null,
      fullPath: null,
    }));
    const now = Date.parse("2026-10-13T11:30:00Z");
    const l = buildLine({ ...p, shots }, lineDomain([p], now), now, 15);
    const phone = tickGroups(l, 326);
    expect(phone).toHaveLength(1);
    expect(phone[0].ticks.map(t => t.id)).toEqual([1, 2, 3]);
    // Wide enough, each is its own button.
    expect(tickGroups(l, 2000)).toHaveLength(3);
    expect(TICK_MERGE_PX).toBe(12);
  });
});

/** Kuwait wall clock on 13 October 2026. */
const kw = (h: number, m = 0) =>
  Date.parse("2026-10-12T21:00:00Z") + h * 3_600_000 + m * 60_000;
const kwIso = (h: number, m = 0) => new Date(kw(h, m)).toISOString();

// review_1 MAJOR 1 (probe A and B): time Hubstaff never sent is unread, never orange.
describe("the shift line only marks a gap where Hubstaff was read", () => {
  const tracked = (to: number) => {
    const out = [];
    for (let t = kw(10); t < to; t += 600_000)
      out.push({
        start: new Date(t).toISOString(),
        trackedS: 600,
        overallS: 400,
        idle: false,
      });
    return out;
  };
  const lama = {
    ...board().people[0],
    name: "Lama Harb",
    state: "off_shift" as const,
    shiftStart: kwIso(10),
    shiftEnd: kwIso(18),
    online: false,
    trackedTodayS: 7 * 3600 + 40 * 60,
    activePct30m: null,
    readAt: kwIso(17, 55),
    slots: tracked(kw(17, 40)),
    shots: [],
  };
  const spans = (l: ReturnType<typeof buildLine>, kind: string) =>
    l.segments
      .filter(s => s.kind === kind)
      .map(s => `${time(s.from)}-${time(s.to)}`);

  test("after the shift, the tail the last run could not see is unread", () => {
    const now = kw(19);
    const l = buildLine(lama, lineDomain([lama], now), now, 15);
    expect(spans(l, "gap")).toEqual([]);
    expect(spans(l, "unread")).toEqual(["17:40-18:00"]);
    expect(l.summary).not.toContain("Not tracked");
  });

  test("a schedule that stopped at noon leaves the afternoon unread", () => {
    const now = kw(19);
    const p = { ...lama, readAt: kwIso(11, 55), slots: tracked(kw(11, 0)) };
    const l = buildLine(p, lineDomain([p], now), now, 15);
    // Read at 11:55, so Hubstaff's data was in up to 11:35.
    expect(spans(l, "gap")).toEqual(["11:00-11:30"]);
    expect(spans(l, "unread")).toEqual(["11:30-18:00"]);
  });

  test("with no read time, no untracked block is ever a gap", () => {
    const now = kw(19);
    const p = { ...lama, readAt: null, slots: tracked(kw(12)) };
    const l = buildLine(p, lineDomain([p], now), now, 15);
    expect(spans(l, "gap")).toEqual([]);
    expect(spans(l, "unread")).toEqual(["12:00-18:00"]);
  });

  test("readAt is parsed, and a time it cannot place is no time", () => {
    const r = raw();
    expect(parseWatchBoard(r).people[0].readAt).toBe(
      new Date(NOW - 2 * 60_000).toISOString(),
    );
    r.people[0] = { ...r.people[0], readAt: "soon" };
    r.people[1] = { ...r.people[1], readAt: undefined };
    const b = parseWatchBoard(r);
    expect(b.people[0].readAt).toBeNull();
    expect(b.people[1].readAt).toBeNull();
    expect(parseWatchBoard(raw("source")).people[0].readAt).toBeNull();
  });

  // review_1 MINOR 5 (probe C).
  test("unknown tracked time is said as unknown, never as nothing", () => {
    const p = {
      ...lama,
      state: "cant_tell" as const,
      slots: [],
      trackedTodayS: null,
      readAt: null,
    };
    const l = buildLine(p, lineDomain([p], kw(11)), kw(11), 15, false);
    expect(l.summary).toContain("Tracked time can't be read yet.");
    expect(l.summary).not.toContain("Nothing tracked yet.");
    const zero = { ...p, state: "tracking" as const, trackedTodayS: 0 };
    expect(
      buildLine(zero, lineDomain([zero], kw(11)), kw(11), 15).summary,
    ).toContain("Nothing tracked yet.");
  });
});

describe("the words on the card", () => {
  test("the chips use the spec's tones", () => {
    const b = board();
    expect(b.people.map(p => stateChip(p, NOW))).toEqual([
      { tone: "good", label: "Working" },
      { tone: "warning", label: "Not tracking since 10:12" },
      { tone: "critical", label: "Not work on screen" },
      { tone: "neutral", label: "On a break since 11:10" },
      { tone: "neutral", label: "On leave until 14:00" },
    ]);
    const off = board("offshift");
    expect(off.people.map(p => stateChip(p, NOW).label)).toEqual([
      "Shift ended",
      "On leave",
      "Shift ended",
      "Shift ended",
      "Shift ended",
    ]);
    expect(stateChip({ ...b.people[0], state: "idle" }, NOW).tone).toBe(
      "warning",
    );
    expect(stateChip({ ...b.people[0], state: "no_account" }, NOW)).toEqual({
      tone: "neutral",
      label: "Not in Hubstaff",
    });
  });

  test("the headline says who needs a look, or that nobody is on", () => {
    expect(headline(board(), NOW)).toBe(
      "Omar and Sara need a look. 1 is working. Lina is on a break.",
    );
    const calm = board();
    calm.people = calm.people.map(p => ({
      ...p,
      state: "tracking",
      onBreak: false,
    }));
    expect(headline(calm, NOW)).toBe("All 5 are working.");
    expect(headline(board("offshift"), NOW)).toBe("Nobody is on shift now.");
    expect(headline(board("source"), NOW)).toBe(
      "Can't tell who is working: Hubstaff cannot be read.",
    );
    expect(headline(board("none"), NOW)).toBe("Nobody is watched yet.");
  });

  test("alerts and the last 7 days read like the Slack posts", () => {
    const b = board();
    const people = new Map(b.people.map(p => [p.personId, p]));
    expect(incidentSentence(b.open[0], people)).toBe(
      "Omar Fayed has not had Hubstaff on since 10:12.",
    );
    // The Slack post in detail.text carries Slack's markup; the card writes its own.
    expect(b.open[1].detail.text).toContain("<https://");
    expect(incidentSentence(b.open[1], people)).toBe(
      "Sara Kanaan: 2 of the last 3 screenshots do not look like work (YouTube video, Instagram feed).",
    );
    expect(
      incidentSentence(
        { ...b.open[0], detail: { reason: "no_account" } },
        people,
      ),
    ).toBe("Omar Fayed is on shift but is not in Hubstaff yet.");
    expect(incidentSentence(board("source").open[0], people)).toBe(
      "Hubstaff watch cannot read Hubstaff: Hubstaff refused the saved key (401). It may have been revoked. Nobody is being watched until it can.",
    );
    const shiftEnded = b.recent.find(r => r.closeReason === "shift_ended");
    if (!shiftEnded) throw new Error("missing fixture row");
    expect(recentSentence(shiftEnded, people)).toBe(
      "Omar Fayed: not tracking, 16:10 to 18:00 (1 h 50 min). Shift ended.",
    );
    expect(dayLabel(b.recent[0].openedAt, NOW)).toBe("Today");
    expect(dayLabel(b.recent[1].openedAt, NOW)).toBe("Yesterday");
    expect(dayLabel(b.recent[3].openedAt, NOW)).toBe("Sun 11 Oct");
  });

  // review_1 MINOR 3 (probe D) and the spec's Screen fixes.
  test("the last 7 days: the incident's own name, every close reason in words", () => {
    const b = board();
    const people = new Map(b.people.map(p => [p.personId, p]));
    const gone = b.recent.find(r => r.closeReason === "not_watched");
    if (!gone) throw new Error("missing fixture row");
    expect(gone.name).toBe("Nada Saleh");
    expect(people.has(gone.personId ?? 0)).toBe(false);
    expect(recentSentence(gone, people)).toBe(
      "Nada Saleh: timer on, no activity, 12:00 to 12:30 (30 min). No longer watched.",
    );
    const source = b.recent.find(r => r.kind === "source");
    if (!source) throw new Error("missing fixture row");
    expect(recentSentence(source, people)).toBe(
      "Hubstaff could not be read, 09:55 to 10:10 (15 min). Hubstaff can be read again.",
    );
    const said = b.recent.map(r => recentSentence(r, people));
    expect(said).toEqual([
      "Hala Mansour: timer on, no activity, 11:40 to 12:00 (20 min). Activity back above the floor.",
      "Omar Fayed: not tracking, 10:00 to 10:35 (35 min). Back on Hubstaff.",
      "Sara Kanaan: off work on screen, 15:10 to 15:40 (30 min). No more screenshots off work.",
      "Hubstaff could not be read, 09:55 to 10:10 (15 min). Hubstaff can be read again.",
      "Omar Fayed: not tracking, 16:10 to 18:00 (1 h 50 min). Shift ended.",
      "Sara Kanaan: not in Hubstaff, 10:15 to 11:00 (45 min). In Hubstaff now.",
      "Hala Mansour: not tracking, 13:05 to 13:30 (25 min). Back on Hubstaff.",
      "Nada Saleh: timer on, no activity, 12:00 to 12:30 (30 min). No longer watched.",
    ]);
    // The probe's case: an idle alert closed because the person left the watch.
    const probe = parseWatchBoard({
      ...raw(),
      recent: [
        {
          id: 9,
          personId: 42,
          name: "Nada Al Saed",
          kind: "idle",
          openedAt: "2026-10-13T08:00:00Z",
          closedAt: "2026-10-13T08:40:00Z",
          closeReason: "not_watched",
          detail: {},
          reviewedAt: null,
        },
      ],
    });
    expect(recentSentence(probe.recent[0], new Map())).toBe(
      "Nada Al Saed: timer on, no activity, 11:00 to 11:40 (40 min). No longer watched.",
    );
    // No name anywhere: someone, never "Person 42"; an unknown reason: plain words.
    const bare = { ...probe.recent[0], name: null, closeReason: "zz_new" };
    expect(recentSentence(bare, new Map())).toBe(
      "Someone: timer on, no activity, 11:00 to 11:40 (40 min). Closed.",
    );
    // An open alert's name comes from the board too.
    expect(b.open.map(i => i.name)).toEqual(["Omar Fayed", "Sara Kanaan"]);
    expect(
      incidentSentence({ ...b.open[0], name: "Nada Saleh" }, new Map()),
    ).toBe("Nada Saleh has not had Hubstaff on since 10:12.");
  });

  test("a code from the server never reaches the screen as a code", () => {
    const b = board("source");
    const people = new Map(b.people.map(p => [p.personId, p]));
    for (const [note, said] of [
      ["unreadable", "Hubstaff sent an answer the watch cannot read"],
      ["hubstaff unreadable", "Hubstaff sent an answer the watch cannot read"],
      ["rate_limited", "Hubstaff asked the watch to slow down"],
      ["some_new_code", "Hubstaff did not answer"],
      ["", "Hubstaff did not answer"],
    ]) {
      const i = { ...b.open[0], detail: { note } };
      expect(incidentSentence(i, people)).toBe(
        `Hubstaff watch cannot read Hubstaff: ${said}. Nobody is being watched until it can.`,
      );
      const withNote = {
        ...b,
        open: [i],
        sources: { ...b.sources, hubstaff: { state: "failing", note: null } },
      };
      expect(problems(withNote, NOW)[0].text).toBe(
        `Hubstaff cannot be read: ${said}. Reconnect it in Team & payroll.`,
      );
    }
    const failed = board();
    failed.lastRun = {
      at: "2026-10-13T08:35:00Z",
      ok: false,
      note: "unreachable",
    };
    expect(problems(failed, NOW)[0].text).toBe(
      "The last check failed at 11:35: Hubstaff could not be reached. Check now to try again.",
    );
    // Every scenario, rendered: no snake_case code outside Slack's bracketed one.
    for (const sc of [
      "full",
      "none",
      "source",
      "noai",
      "aifail",
      "offshift",
      "slack",
    ] as WatchScenario[]) {
      const text = words(card(board(sc))).replace(/\([a-z_]+\)/g, "");
      expect(text).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
      expect(text.toLowerCase()).not.toContain("hubstaff unreadable");
    }
  });

  test("the AI's state in the settings sheet, and percentages rounded down", () => {
    const ai = board("aifail").sources.ai;
    expect(ai.state).toBe("failing");
    expect(aiSentence(ai, "settings")).toBe(
      "The screenshot check is failing: OpenAI answered 500 three times in a row. Paste a new key.",
    );
    expect(
      aiSentence(
        {
          state: "refused",
          provider: "google_ai",
          note: "The saved AI key was refused. Paste a new one in Hubstaff watch settings.",
        },
        "card",
      ),
    ).toBe("The Google AI key was refused. Paste a new one in Settings.");
    expect(
      aiSentence({ state: "missing", provider: null, note: null }, "settings"),
    ).toBe("No key yet. The screenshot check stays off until one is saved.");
    const b = board();
    const people = new Map(b.people.map(p => [p.personId, p]));
    expect(
      incidentSentence(
        {
          kind: "idle",
          personId: 101,
          openedAt: "2026-10-13T08:00:00Z",
          detail: { pct: 9.7 },
        },
        people,
      ),
    ).toBe(
      "Hala Mansour: Hubstaff has been running since 11:00 with 9% keyboard and mouse activity.",
    );
    expect(figures({ ...b.people[0], activePct30m: 9.7 }).active).toBe("9%");
  });

  test("the Slack state line", () => {
    const s = WATCH_DEFAULTS;
    expect(slackLine("posted", null, s).text).toBe("Sent to #team-management");
    expect(slackLine("muted", null, s).text).toBe("Alerts are off");
    expect(slackLine("failed", "not_in_channel", s).text).toBe(
      "Slack refused: the Slack app is not in the channel (not_in_channel)",
    );
    expect(slackLine("failed", "some_new_code", s).text).toBe(
      "Slack refused: Slack answered with the code some_new_code",
    );
    expect(slackLine("failed", null, s).text).toBe(
      "Slack refused: no reason given",
    );
    expect(slackLine("unknown", null, s).text).toContain("not sent again");
  });

  test("every missing or failing piece says what to do", () => {
    const texts = (s: WatchScenario, mut?: (b: WatchBoard) => void) => {
      const b = board(s);
      mut?.(b);
      return problems(b, NOW).map(p => p.text);
    };
    expect(texts("full")).toEqual([]);
    expect(texts("source")).toEqual([
      "Hubstaff cannot be read: Hubstaff refused the saved key (401). It may have been revoked. Reconnect it in Team & payroll.",
    ]);
    expect(texts("noai")).toEqual([
      "The screenshot check needs an AI key. Paste an OpenAI or Google AI key in Settings.",
    ]);
    expect(
      texts("noai", b => {
        b.settings.shots = false;
      }),
    ).toEqual([]);
    expect(texts("slack")).toEqual([
      "Slack refused the last alert: the Slack app is not in the channel (not_in_channel). Invite the app to the channel in Slack.",
    ]);
    expect(texts("aifail")).toEqual([
      "The screenshot check is failing: OpenAI answered 500 three times in a row. Paste a new key in Settings.",
    ]);
    expect(
      texts("aifail", b => {
        b.sources.ai.note = "timeout";
      }),
    ).toEqual([
      "The screenshot check is failing: the AI did not answer in time. Paste a new key in Settings.",
    ]);
    expect(
      texts("aifail", b => {
        b.settings.shots = false;
      }),
    ).toEqual([]);
    expect(
      texts("full", b => {
        b.sources.ai = {
          state: "refused",
          provider: "openai",
          note: "Invalid API key.",
        };
      }),
    ).toEqual([
      "The OpenAI key was refused: Invalid API key. Paste a new one in Settings.",
    ]);
    expect(
      texts("full", b => {
        b.cronOn = false;
        b.lastRun = null;
      }),
    ).toEqual([
      "The 5-minute check is not scheduled, so nothing is watched on its own. Check now runs it once; the systems manager schedules it.",
      "No check has run yet. Check now to run the first.",
    ]);
    expect(
      texts("full", b => {
        b.lastRun = {
          at: "2026-10-13T08:35:00Z",
          ok: false,
          note: "Hubstaff took too long.",
        };
      }),
    ).toEqual([
      "The last check failed at 11:35: Hubstaff took too long. Check now to try again.",
    ]);
    expect(
      texts("full", b => {
        b.lastRun = { at: "2026-10-13T08:10:00Z", ok: true, note: null };
      }),
    ).toEqual([
      "The last check ran at 11:10, more than 15 minutes ago. Check now; if it stays old, the 5-minute schedule has stopped.",
    ]);
    expect(
      boardErrorText(
        "Could not find the function public.cockpit_ceo_hours_watch_board without parameters in the schema cache",
      ),
    ).toBe(
      "Hubstaff watch is not set up on the server yet. It appears here once its migration is applied.",
    );
    expect(boardErrorText("Verified founder access required")).toBe(
      "Only the CEO can see Hubstaff watch. Sign in again as the CEO.",
    );
  });
});

describe("the card", () => {
  test("a lively day: rows, chips, open alerts with Slack and screenshots, the last 7 days", () => {
    const text = words(card(board()));
    for (const s of [
      "Hubstaff watch",
      "Omar and Sara need a look. 1 is working.",
      "Check now",
      "Slack alerts",
      "Working",
      "Not tracking since 10:12",
      "Not work on screen",
      "Open alerts 2",
      "Omar Fayed has not had Hubstaff on since 10:12.",
      "Sent to #team-management",
      "Mark reviewed",
      "Last 7 days",
      "Show the other 3",
    ])
      expect(text).toContain(s);
    const html = card(board());
    expect(html).toContain('id="hubstaff-watch"');
    expect(html).toContain("Open Sara Kanaan&#x27;s screenshot from 11:23");
    expect(
      html.match(/aria-label="Screenshots behind this alert"/g),
    ).toHaveLength(1);
    expect(text).not.toContain("No open alerts.");
  });

  test("each missing or failing sentence reaches the screen", () => {
    expect(words(card(board("source")))).toContain(
      "Hubstaff cannot be read: Hubstaff refused the saved key (401). It may have been revoked. Reconnect it in Team & payroll.",
    );
    expect(words(card(board("noai")))).toContain(
      "The screenshot check needs an AI key. Paste an OpenAI or Google AI key in Settings.",
    );
    const slack = words(card(board("slack")));
    expect(slack).toContain(
      "Slack refused the last alert: the Slack app is not in the channel (not_in_channel).",
    );
    expect(slack).toContain(
      "Slack refused: the Slack app is not in the channel (not_in_channel)",
    );
    expect(words(card(board("aifail")))).toContain(
      "The screenshot check is failing: OpenAI answered 500 three times in a row. Paste a new key in Settings.",
    );
    const muted = board();
    muted.settings.on = false;
    muted.open = muted.open.map(i => ({ ...i, slackState: "muted" }));
    expect(words(card(muted))).toContain("Alerts are off");
    expect(words(card(board("none")))).toContain("Nobody is watched yet");
    expect(words(card(board("offshift")))).toContain("Nobody is on shift now.");
    expect(words(card(null))).toContain("Reading Hubstaff watch");
    expect(
      words(
        card(
          null,
          "Hubstaff watch was not confirmed by the server. Open the page again in a minute.",
        ),
      ),
    ).toContain(
      "Hubstaff watch was not confirmed by the server. Open the page again in a minute.",
    );
  });

  // review_1 MINOR 6: the header's Settings is the only one.
  test("one Settings button, even with a problem that is fixed in Settings", () => {
    for (const sc of ["noai", "aifail", "slack"] as WatchScenario[]) {
      const html = card(board(sc));
      const buttons = html
        .split("<button")
        .slice(1)
        .map(b => words(b.split("</button>")[0].replace(/^[^>]*>/, "")).trim());
      expect(buttons.filter(t => t === "Settings")).toHaveLength(1);
      expect(problems(board(sc), NOW).length).toBeGreaterThan(0);
    }
  });

  test("no em dash, no emoji and no company address in the watch's files", () => {
    for (const f of [
      "../src/pages/ceo/hours/WatchCard.tsx",
      "../src/pages/ceo/hours/WatchSettings.tsx",
      "../src/pages/ceo/hours/ShiftLine.tsx",
      "../src/pages/ceo/hours/HubstaffWatch.tsx",
      "../src/pages/ceo/hours/watchCopy.ts",
      "../src/dev/watchFixture.ts",
    ]) {
      const text = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(text).not.toContain("—");
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text).not.toContain("@maharamedia.com");
    }
  });
});

// docs/hours-watch/SPEC.md, "Final round (2026-10-13 evening, after the re-check)", Screen.
describe("final round", () => {
  test("the parsers take the new fields: on_break, onBreak, leave, no_schedule, inputTrackedS", () => {
    const r = raw();
    r.people[0] = {
      ...r.people[0],
      state: "on_break",
      onBreak: undefined,
      leave: [
        { start: kwIso(10), end: kwIso(14) },
        { start: "soon", end: kwIso(15) },
        { start: kwIso(16), end: kwIso(15) },
        "10:00",
      ],
      slots: [
        { start: kwIso(10), trackedS: 600, overallS: 0, inputTrackedS: 0 },
        { start: kwIso(10, 10), trackedS: 600, overallS: 300 },
      ],
    };
    r.people[1] = { ...r.people[1], onBreak: "yes", leave: "morning" };
    r.people[2] = {
      ...r.people[2],
      state: "off_shift",
      offReason: "no_schedule",
    };
    const b = parseWatchBoard(r);
    expect(b.people[0].state).toBe("on_break");
    expect(b.people[0].onBreak).toBe(true);
    expect(b.people[0].leave).toEqual([{ start: kwIso(10), end: kwIso(14) }]);
    expect(b.people[0].slots.map(s => s.inputTrackedS)).toEqual([0, null]);
    expect(b.people[1].onBreak).toBe(false);
    expect(b.people[1].leave).toEqual([]);
    expect(b.people[2].offReason).toBe("no_schedule");
    // The lunch person in the harness comes as the server sends it.
    expect(board().people[3]).toMatchObject({
      name: "Lina Haddad",
      state: "on_break",
      onBreak: true,
    });
    expect(board().people[4].leave).toEqual([
      { start: kwIso(10), end: kwIso(14) },
    ]);
    expect(board("aifail").sources.ai.state).toBe("failing");
  });

  test("settings: mention and mentionUser are read, defaulted and held to their bounds", () => {
    const s = parseWatchSettings({
      ...WATCH_DEFAULTS,
      mention: false,
      mentionUser: "W0ABCDEF12",
    });
    expect([s.mention, s.mentionUser]).toEqual([false, "W0ABCDEF12"]);
    const { mention: _m, mentionUser: _u, ...before } = WATCH_DEFAULTS;
    expect(parseWatchSettings(before)).toEqual(WATCH_DEFAULTS);
    expect(
      parseWatchSettings({
        ...WATCH_DEFAULTS,
        mention: "no",
        mentionUser: "@aziz",
      }),
    ).toEqual(WATCH_DEFAULTS);
    expect(checkWatchPatch({ mention: false })).toEqual({ mention: false });
    expect(checkWatchPatch({ mentionUser: " U09305KE2KS " })).toEqual({
      mentionUser: "U09305KE2KS",
    });
    expect(() => checkWatchPatch({ mention: "off" })).toThrow(
      "Choose on or off.",
    );
    for (const bad of ["C0B5TL9H370", "U123", "u09305ke2ks", "<@U09305KE2KS>"])
      expect(() => checkWatchPatch({ mentionUser: bad })).toThrow(
        "starts with U or W",
      );
  });

  test("the settings sheet has the switch Mention me in each alert", () => {
    const html = (mention: boolean) =>
      renderToStaticMarkup(
        createElement(AlertSwitches, {
          settings: { ...WATCH_DEFAULTS, mention },
          disabled: false,
          onSwitch: noop,
        }),
      );
    const on = html(true);
    expect(words(on)).toContain("Mention me in each alert");
    expect(on).toMatch(
      /id="hw-mention"[^>]*aria-checked="true"|aria-checked="true"[^>]*id="hw-mention"/,
    );
    expect(html(false)).toMatch(
      /id="hw-mention"[^>]*aria-checked="false"|aria-checked="false"[^>]*id="hw-mention"/,
    );
    // The user id is never shown.
    expect(on).not.toContain("U09305KE2KS");
    // The three switches, in order.
    expect(on.match(/id="hw-(on|mention|shots)"/g)).toEqual([
      'id="hw-on"',
      'id="hw-mention"',
      'id="hw-shots"',
    ]);
  });

  test("key copy is provider-neutral and the key box starts on OpenAI", () => {
    expect(AI_KEY_NEEDED).toBe(
      "The screenshot check needs an AI key. Paste an OpenAI or Google AI key in Settings.",
    );
    expect(
      aiSentence({ state: "missing", provider: null, note: null }, "card"),
    ).toBe(AI_KEY_NEEDED);
    for (const sc of ["full", "noai", "aifail"] as WatchScenario[])
      expect(words(card(board(sc)))).not.toContain("needs a Google AI key");
    for (const b of [board("noai"), board()]) {
      // Even with Google AI saved, OpenAI is the one the watch tries first.
      b.sources.ai.provider = b.sources.ai.provider && "google_ai";
      const html = renderToStaticMarkup(
        createElement(KeyBox, { board: b, onKey: actions.onKey }),
      );
      const chips = [
        ...html.matchAll(
          /data-chip="([a-z_]+)"[^>]*aria-pressed="(true|false)"/g,
        ),
      ].map(m => [m[1], m[2]]);
      expect(chips).toEqual([
        ["openai", "true"],
        ["google_ai", "false"],
      ]);
      expect(html).toContain('placeholder="Paste the OpenAI key"');
    }
  });

  test("an idle alert closed as not_judged says why in words", () => {
    const r = { ...board().recent[0], closeReason: "not_judged" };
    expect(recentSentence(r, new Map())).toBe(
      "Hala Mansour: timer on, no activity, 11:40 to 12:00 (20 min). Too little time on the computer to judge activity.",
    );
  });

  test("on a lunch break: a neutral chip, never needs a look", () => {
    const b = board();
    const lina = b.people[3];
    expect(stateChip(lina, NOW)).toEqual({
      tone: "neutral",
      label: "On a break since 11:10",
    });
    expect(needsLook(lina)).toBe(false);
    // A not-tracking row the server flags as on the break reads the same.
    const flagged = { ...lina, state: "not_tracking" as const, onBreak: true };
    expect(stateChip(flagged, NOW).label).toBe("On a break since 11:10");
    expect(needsLook(flagged)).toBe(false);
    expect(needsLook({ ...flagged, onBreak: false })).toBe(true);
    // Only Lina on shift, on her break: nobody needs a look.
    const lunch = { ...b, people: [lina], open: [] };
    expect(headline(lunch, NOW)).toBe("Lina is on a break.");
    const two = { ...b, people: [b.people[0], lina], open: [] };
    expect(headline(two, NOW)).toBe("1 is working. Lina is on a break.");
    const text = words(card(b));
    expect(text).toContain("On a break since 11:10");
    expect(text).toContain("Lina is on a break.");
    expect(text).not.toMatch(/Lina[^.]* needs? a look/);
  });

  test("no schedule: a neutral chip and a link to Team & payroll on the row", () => {
    const b = board();
    const p = {
      ...b.people[0],
      state: "off_shift" as const,
      offReason: "no_schedule" as const,
      shiftStart: null,
      shiftEnd: null,
      slots: [],
    };
    expect(stateChip(p, NOW)).toEqual({
      tone: "neutral",
      label: "No schedule set",
    });
    expect(rowFix(p)).toEqual({
      text: "Set one in Team & payroll",
      action: "team",
    });
    expect(rowFix(b.people[0])).toBeNull();
    const html = card({ ...b, people: [p, ...b.people.slice(1)] });
    expect(words(html)).toContain("No schedule set");
    expect(html).toMatch(
      /<a href="\?tab=team"[^>]*>Set one in Team &amp; payroll/,
    );
    expect(html.match(/href="\?tab=team"/g)).toHaveLength(1);
    expect(card(b)).not.toContain('href="?tab=team"');
  });

  test("leave windows are off time on the shift line, never a gap or unread", () => {
    const b = board();
    const domain = lineDomain(b.people, NOW);
    // Yousef, on leave for the morning, at 11:40.
    const yousef = buildLine(b.people[4], domain, NOW, 15);
    expect(yousef.segments.filter(s => s.kind === "leave")).toEqual([
      { kind: "leave", from: kw(10), to: kw(14) },
    ]);
    expect(
      yousef.segments.some(s => s.kind === "gap" || s.kind === "unread"),
    ).toBe(false);
    expect(yousef.summary).toContain("On leave 10:00 to 14:00.");
    // Later that day: back at 14:30, read at 17:55. The morning is off time;
    // the grace applies again after the leave, so the gap is 14:15 to 14:30.
    const now = kw(19);
    const back = {
      ...b.people[4],
      state: "off_shift" as const,
      readAt: kwIso(17, 55),
      slots: Array.from({ length: 19 }, (_, i) => ({
        start: kwIso(14, 30 + i * 10),
        trackedS: 600,
        overallS: 300,
        inputTrackedS: 600,
        idle: false,
      })),
    };
    const l = buildLine(back, lineDomain([back], now), now, 15);
    const spans = (kind: string) =>
      l.segments
        .filter(s => s.kind === kind)
        .map(s => `${time(s.from)}-${time(s.to)}`);
    expect(spans("leave")).toEqual(["10:00-14:00"]);
    expect(spans("gap")).toEqual(["14:15-14:30"]);
    expect(spans("unread")).toEqual(["17:40-18:00"]);
    const html = renderToStaticMarkup(
      createElement(ShiftLine, {
        line: yousef,
        name: "Yousef Karam",
        live: false,
        onOpenShot: noop,
        widthPx: 900,
      }),
    );
    expect(html).toContain('data-kind="leave"');
    expect(html).toContain("hw-seg hw-leave");
    expect(words(renderToStaticMarkup(createElement(ShiftLegend)))).toContain(
      "On leave",
    );
    const css = readFileSync(
      new URL("../src/pages/ceo/hours/hoursWatch.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/\.hw-leave \{\s*background: var\(--ceo-deemphasis\)/);
  });

  test("the shade uses keyboard-and-mouse time; phone time is the middle shade", () => {
    const slot = {
      start: kwIso(10),
      trackedS: 600,
      overallS: 300,
      idle: false,
    };
    expect(slotActivity({ ...slot, inputTrackedS: 300 })).toBe(1);
    expect(slotActivity({ ...slot, inputTrackedS: 600 })).toBe(0.5);
    expect(slotActivity({ ...slot, overallS: 0, inputTrackedS: 0 })).toBe(
      PHONE_ACTIVITY,
    );
    expect(slotActivity({ ...slot, inputTrackedS: null })).toBe(0.5);
    expect(
      slotActivity({ ...slot, idle: true, inputTrackedS: 600 }),
    ).toBeNull();
    // Lina's third block was tracked on the phone: drawn mid shade, never as idle-dark.
    const b = board();
    const lina = buildLine(b.people[3], lineDomain(b.people, NOW), NOW, 15);
    const phone = lina.segments.find(
      s => s.kind === "tracked" && s.from === kw(10, 20),
    );
    expect(phone?.activity).toBe(PHONE_ACTIVITY);
  });

  test("one screenshot reads as one, the same words as Slack", () => {
    const b = board();
    const people = new Map(b.people.map(p => [p.personId, p]));
    const sara = (detail: Record<string, unknown>) =>
      incidentSentence({ ...b.open[1], detail }, people);
    expect(sara({ count: 1, total: 1, labels: ["YouTube video"] })).toBe(
      "Sara Kanaan: the last screenshot does not look like work (YouTube video).",
    );
    expect(sara({ count: 1, total: 3, labels: ["YouTube video"] })).toBe(
      "Sara Kanaan: 1 of the last 3 screenshots does not look like work (YouTube video).",
    );
    expect(sara({ count: 2, total: 3, labels: ["YouTube video"] })).toBe(
      "Sara Kanaan: 2 of the last 3 screenshots do not look like work (YouTube video).",
    );
    expect(sara({ count: 1, labels: [] })).toBe(
      "Sara Kanaan: the last screenshot does not look like work.",
    );
    expect(words(card(b))).not.toContain("of the last 1 screenshots");
  });
});

describe("the harness answers the watch", () => {
  test("board, settings, review, the two Edge actions and a made-up screenshot", async () => {
    const answer = { data: null, error: { message: "not the harness" } };
    const client = {
      rpc: async () => answer,
      from: () => null,
      auth: { getUser: async () => ({}) },
      functions: { invoke: async () => answer },
      storage: { from: () => ({ createSignedUrl: async () => answer }) },
    } as unknown as SupabaseClient;
    installCeoHarness(client);
    const b = (await ceoHoursAction(client, "watchBoard", {})) as WatchBoard;
    expect(b.people.map(p => p.personId)).toEqual([101, 102, 103, 105, 106]);
    const set = (await ceoHoursAction(client, "watchSet", {
      graceMinutes: 20,
    })) as { settings: { graceMinutes: number } };
    expect(set.settings.graceMinutes).toBe(20);
    watchSettings.graceMinutes = 15;
    expect(
      await ceoHoursAction(client, "watchReview", { incidentId: 510 }),
    ).toMatchObject({ ok: true });
    expect(await ceoHoursAction(client, "watchNow", {})).toEqual({ ok: true });
    expect(
      await ceoHoursAction(client, "watchKey", {
        provider: "google_ai",
        key: "made_up_key_123456",
      }),
    ).toMatchObject({
      ok: true,
      state: "connected",
      text: expect.stringContaining("Google AI"),
    });
    // The answer names the provider the next run uses.
    expect(
      await ceoHoursAction(client, "watchKey", {
        provider: "openai",
        key: "made_up_key_123456",
      }),
    ).toMatchObject({
      ok: true,
      text: expect.stringMatching(/^Connected: OpenAI\./),
    });
    const shot = (await ceoHoursAction(client, "watchShotUrl", {
      path: "2026/10/103/900002-thumb.jpg",
    })) as { url: string };
    expect(shot.url.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(shot.url)).toContain("YouTube video (made up)");
  });
});
