/**
 * The CEO, 2026-10-19: "Ads turning on and off in the CEO cockpit isn't
 * working." Meta took every change; the switch read its state from the
 * published section, refreshed every 15 minutes, so it went straight back.
 * These tests hold the fix (src/pages/ceo/adsSwitch.tsx): a change Meta
 * confirmed is held until a payload has read Meta since it (its snapshot
 * stamp, not when it was published), or an hour; then a change that turned
 * something off gives way to the payload whatever it says, and one that
 * turned something on gives way once the payload shows it on; a refusal holds
 * nothing; every switch of one Meta object agrees; a reload inside the hour
 * still shows it; the row's verdict, "Nothing running" and the top line never
 * contradict it. The switch is rendered in happy-dom with its `setStatus`
 * answered here, so nothing reaches the network. Every id and name is made up.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Nothing here may outlive this file: bun runs every test file in one
// process, so no module mocks, and every global is put back.
const g = globalThis as any;
const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/ceo?tab=ads" });
const DOM: string[] = [
  "window",
  "document",
  "navigator",
  "sessionStorage",
  "localStorage",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "PointerEvent",
  "KeyboardEvent",
  "FocusEvent",
  "MutationObserver",
  "ResizeObserver",
  "DocumentFragment",
  "Text",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IS_REACT_ACT_ENVIRONMENT",
  ...Object.getOwnPropertyNames(win).filter(k =>
    /^(HTML|SVG)\w*Element$|^(CustomEvent|DOMRect|NodeFilter|Range)$/.test(k),
  ),
];
const globalsBefore = new Map(
  DOM.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
);
for (const k of DOM)
  Object.defineProperty(globalThis, k, {
    configurable: true,
    writable: true,
    value:
      k === "window"
        ? win
        : k === "IS_REACT_ACT_ENVIRONMENT"
          ? true
          : typeof (win as any)[k] === "function" && /^[a-z]/.test(k)
            ? (win as any)[k].bind(win)
            : (win as any)[k],
  });

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const sw = await import("../src/pages/ceo/adsSwitch");
const {
  anyTurnedOn,
  changeSwitch,
  HELD_KEY,
  HOLD_MS,
  heldSentence,
  isHeld,
  liveHolds,
  META_READ_SOURCE,
  metaReadAt,
  nextRefreshAt,
  onIds,
  REFRESH_EVERY_MS,
  REREAD_GRACE_MS,
  reloadSwitches,
  RowSwitch,
  rereadDelay,
  settleSwitches,
  shownOn,
  SwitchNote,
  switchesNow,
  UnlessHeld,
} = sw;
type SetStatus = import("../src/pages/ceo/adsSwitch").SetStatus;
type SwitchClock = import("../src/pages/ceo/adsSwitch").SwitchClock;
type PayloadRead = import("../src/pages/ceo/adsSwitch").PayloadRead;

const host = win.document.createElement("div");
win.document.body.append(host);
const root = createRoot(host as any);

async function flush(times = 4) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}
const switches = () =>
  Array.from(
    host.querySelectorAll('button[role="switch"]') as ArrayLike<any>,
  ) as any[];
const checked = (b: any) => b.getAttribute("aria-checked") === "true";

/** 10:30 UTC on 19 Oct 2026: 13:30 in Kuwait. */
const T = Date.UTC(2026, 9, 19, 10, 30);
const MIN = 60_000;
/** The payload on screen: it last read Meta five minutes before the change. */
const SEEN = T - 5 * MIN;
const AD = "900000000000001";

/** A payload that last read Meta at `readAt` and shows `on` running, looked at `now`. */
const read = (
  readAt: number | null,
  now: number,
  on: string[] = [],
): PayloadRead => ({ readAt, on: new Set(on), now });

/** Turn the made-up ad on or off with Meta saying yes, at T, over the payload read at SEEN. */
async function confirmed(active: boolean, metaId = AD) {
  await changeSwitch({
    metaId,
    level: "ad",
    name: "Founder story",
    active,
    setStatus: okNow().fn,
    seen: SEEN,
    clock: () => T,
  });
  return switchesNow().held[metaId];
}

/** A setStatus that answers as told and records every call. */
function server(answer: () => Promise<any>) {
  const calls: any[] = [];
  const fn: SetStatus = async args => {
    calls.push(args);
    return answer();
  };
  return { fn, calls };
}
const okNow = () => server(async () => ({ ok: true, receiptId: "r1" }));

beforeEach(() => {
  win.sessionStorage.clear();
  reloadSwitches();
});
afterEach(async () => {
  await act(async () => root.render(null));
  await flush(2);
});
afterAll(async () => {
  await act(async () => root.unmount());
  for (const [k, d] of globalsBefore)
    if (d) Object.defineProperty(globalThis, k, d);
    else delete g[k];
  await win.happyDOM.close();
});

describe("a change Meta confirmed", () => {
  test("holds until a payload that read Meta after it arrives, then the payload is trusted", async () => {
    const s = okNow();
    const r = await changeSwitch({
      metaId: AD,
      level: "ad",
      name: "Founder story",
      active: true,
      setStatus: s.fn,
      seen: SEEN,
      clock: () => T,
    });
    expect(r).toEqual({ ok: true });
    expect(s.calls).toEqual([
      { metaId: AD, level: "ad", active: true, name: "Founder story" },
    ]);
    const h = switchesNow().held[AD];
    expect(h).toEqual({ on: true, at: T, seen: SEEN });

    // The payload on screen says off; the switch says on.
    expect(shownOn(AD, false, h, read(SEEN, T + MIN))).toBe(true);
    // A reload that brings the same payload back still holds.
    expect(shownOn(AD, false, h, read(SEEN, T + 20 * MIN))).toBe(true);
    // A payload that read Meta after the change and agrees: trusted, nothing held.
    expect(isHeld(AD, h, read(T + 10 * MIN, T + 11 * MIN, [AD]))).toBe(false);
    expect(shownOn(AD, true, h, read(T + 10 * MIN, T + 11 * MIN, [AD]))).toBe(
      true,
    );
  });

  test("a payload published after the change from snapshots synced before it keeps the hold", async () => {
    const on = await confirmed(true);
    const off = await confirmed(false, "900000000000002");
    // Published ten minutes after the change; its snapshots last synced two
    // minutes before it. The publish time and the other stamps say nothing.
    const sources = [
      { name: "B2B leads, calls and closed deals (ad attribution)", ok: true },
      {
        name: "Meta frequency by level (Graph API insights)",
        ok: true,
        freshestAt: T + 10 * MIN,
      },
      { name: META_READ_SOURCE, ok: true, freshestAt: T - 2 * MIN },
    ];
    const readAt = metaReadAt(sources);
    expect(readAt).toBe(T - 2 * MIN);
    expect(shownOn(AD, false, on, read(readAt, T + 11 * MIN))).toBe(true);
    expect(
      shownOn(
        "900000000000002",
        true,
        off,
        read(readAt, T + 11 * MIN, ["900000000000002"]),
      ),
    ).toBe(false);
    // No snapshot stamp at all: nothing says the payload has seen the change,
    // so it holds until the hour is up.
    expect(metaReadAt([])).toBeNull();
    expect(metaReadAt(undefined)).toBeNull();
    expect(metaReadAt([{ name: META_READ_SOURCE, ok: true }])).toBeNull();
    expect(isHeld(AD, on, read(null, T + 59 * MIN))).toBe(true);
    expect(isHeld(AD, on, read(null, T + 60 * MIN))).toBe(false);
  });

  test("a newer payload that disagrees wins", async () => {
    const h = await confirmed(false);
    // It read Meta after the change and still shows the ad on: on it is.
    expect(shownOn(AD, true, h, read(T + 1, T + 2 * MIN, [AD]))).toBe(true);
    expect(isHeld(AD, h, read(T + 1, T + 2 * MIN, [AD]))).toBe(false);
    // A read from before the change never releases it.
    expect(shownOn(AD, true, h, read(T - 1, T + 2 * MIN, [AD]))).toBe(false);
    // Nor does the read that was on screen when the change was made, even
    // when this browser's clock ran behind the server's.
    expect(
      shownOn(
        AD,
        true,
        { on: false, at: T, seen: T + MIN },
        read(T + MIN, T, [AD]),
      ),
    ).toBe(false);
  });

  test("a change that turned something on waits for the payload to show it on, since nothing runs before it delivers", async () => {
    const h = await confirmed(true);
    // Read after the change, and the ad has not delivered yet: still on here.
    expect(shownOn(AD, false, h, read(T + 5 * MIN, T + 20 * MIN))).toBe(true);
    // Its ad set showing on says nothing about the ad.
    expect(isHeld(AD, h, read(T + 5 * MIN, T + 20 * MIN, ["ad-set-1"]))).toBe(
      true,
    );
    // It delivered and the payload shows it on: the payload again.
    expect(isHeld(AD, h, read(T + 30 * MIN, T + 31 * MIN, [AD]))).toBe(false);
    // Or the hour is up, and the payload is shown whatever it says.
    expect(shownOn(AD, false, h, read(T + 30 * MIN, T + 60 * MIN))).toBe(false);
  });

  test("with Meta's own status (statusReadAt) a read after the change decides, turned on or off; without it the snapshot rule stands", async () => {
    const on = await confirmed(true);
    const off = await confirmed(false, "900000000000002");
    // The snapshot stamp is from before the change on purpose: Meta's status read decides.
    const live = (
      statusReadAt: number | null,
      now: number,
      ids: string[] = [],
    ): PayloadRead => ({ readAt: SEEN, statusReadAt, on: new Set(ids), now });
    // Meta's status read before the change: held, whatever the payload says.
    expect(shownOn(AD, false, on, live(T - MIN, T + 5 * MIN))).toBe(true);
    expect(
      shownOn("900000000000002", true, off, live(T - MIN, T + 5 * MIN)),
    ).toBe(false);
    // Read after it: the payload decides for both, even a switch-on it shows
    // off (Meta still reviewing it, say), long before any delivery.
    expect(isHeld(AD, on, live(T + MIN, T + 16 * MIN))).toBe(false);
    expect(shownOn(AD, false, on, live(T + MIN, T + 16 * MIN))).toBe(false);
    expect(shownOn(AD, true, on, live(T + MIN, T + 16 * MIN, [AD]))).toBe(true);
    expect(
      shownOn(
        "900000000000002",
        true,
        off,
        live(T + MIN, T + 16 * MIN, ["900000000000002"]),
      ),
    ).toBe(true);
    // The read on screen at the change never ends it, even with this
    // browser's clock behind the server's.
    expect(
      isHeld(
        AD,
        { on: true, at: T, seen: T + MIN },
        live(T + MIN, T + 2 * MIN),
      ),
    ).toBe(true);
    // While held, the note waits for the refresh, never for delivery.
    expect(
      heldSentence(on, {
        ...live(T - MIN, T + 5 * MIN),
        refreshAt: T + 15 * MIN,
      }),
    ).toContain("the numbers catch up at the next refresh");
    // No status read (the fallback, or an older payload): the snapshot rule,
    // where a switch-on waits for the payload to show it on.
    expect(isHeld(AD, on, live(null, T + 20 * MIN))).toBe(true);
    expect(
      isHeld(AD, on, { readAt: T + 5 * MIN, on: new Set(), now: T + 20 * MIN }),
    ).toBe(true);
    // Only a payload that says it read Meta has a status read.
    expect(sw.liveStatusAt({ statusFrom: "meta", statusReadAt: T })).toBe(T);
    expect(
      sw.liveStatusAt({ statusFrom: "snapshots", statusReadAt: T }),
    ).toBeNull();
    expect(
      sw.liveStatusAt({ statusFrom: "meta", statusReadAt: null }),
    ).toBeNull();
    expect(sw.liveStatusAt({})).toBeNull();
    expect(sw.liveStatusAt(null)).toBeNull();

    // A switch flipped over such a payload remembers that read as the one on screen.
    win.sessionStorage.clear();
    reloadSwitches();
    await act(async () =>
      root.render(
        createElement(RowSwitch, {
          metaId: AD,
          level: "ad",
          name: "Founder story",
          running: false,
          clock: { ...live(T - MIN, T), refreshAt: T + 14 * MIN },
          setStatus: okNow().fn,
          onDone: () => {},
        }),
      ),
    );
    await act(async () => switches()[0].click());
    await flush();
    expect(switchesNow().held[AD]).toMatchObject({ on: true, seen: T - MIN });
  });

  test("expires after 60 minutes", () => {
    const h = { on: false, at: T, seen: SEEN };
    expect(HOLD_MS).toBe(60 * MIN);
    expect(shownOn(AD, true, h, read(SEEN, T + 59 * MIN, [AD]))).toBe(false);
    expect(shownOn(AD, true, h, read(SEEN, T + 60 * MIN, [AD]))).toBe(true);
    expect(isHeld(AD, h, read(null, T + 60 * MIN))).toBe(false);
  });

  test("survives a reload in sessionStorage, and works without it", async () => {
    await changeSwitch({
      metaId: AD,
      level: "ad",
      name: "Founder story",
      active: false,
      setStatus: okNow().fn,
      seen: SEEN,
      clock: () => T,
    });
    expect(JSON.parse(win.sessionStorage.getItem(HELD_KEY) ?? "{}")).toEqual({
      [AD]: { on: false, at: T, seen: SEEN },
    });
    reloadSwitches();
    expect(switchesNow().held[AD]).toEqual({ on: false, at: T, seen: SEEN });

    // Broken storage reads as nothing held, never a crash.
    win.sessionStorage.setItem(HELD_KEY, "{not json");
    reloadSwitches();
    expect(switchesNow().held).toEqual({});
    win.sessionStorage.setItem(
      HELD_KEY,
      JSON.stringify({ a: { on: "yes", at: 1 }, b: { on: true, at: T } }),
    );
    reloadSwitches();
    expect(switchesNow().held).toEqual({ b: { on: true, at: T, seen: null } });

    // Blocked storage: the hold still works for the page.
    const before = Object.getOwnPropertyDescriptor(
      globalThis,
      "sessionStorage",
    );
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      reloadSwitches();
      const r = await changeSwitch({
        metaId: AD,
        level: "ad",
        name: "Founder story",
        active: true,
        setStatus: okNow().fn,
        seen: SEEN,
        clock: () => T,
      });
      expect(r).toEqual({ ok: true });
      expect(switchesNow().held[AD]?.on).toBe(true);
    } finally {
      if (before) Object.defineProperty(globalThis, "sessionStorage", before);
    }
  });

  test("settling forgets the holds a newer read of Meta or the hour has settled", async () => {
    for (const [id, at, active] of [
      ["new", T, true],
      ["old", T - 70 * MIN, false],
      ["caught-off", T - 20 * MIN, false],
      ["caught-on", T - 20 * MIN, true],
      ["waiting-on", T - 20 * MIN, true],
    ] as const)
      await changeSwitch({
        metaId: id,
        level: "ad",
        name: id,
        active,
        setStatus: okNow().fn,
        seen: at - MIN,
        clock: () => at,
      });
    const c = read(T - 10 * MIN, T + MIN, ["caught-on"]);
    expect(liveHolds(switchesNow().held, c)).toBe(2);
    expect(anyTurnedOn(switchesNow().held, c)).toBe(true);
    settleSwitches(c);
    expect(Object.keys(switchesNow().held).sort()).toEqual([
      "new",
      "waiting-on",
    ]);
    expect(
      Object.keys(JSON.parse(win.sessionStorage.getItem(HELD_KEY)!)).sort(),
    ).toEqual(["new", "waiting-on"]);
  });

  test("the payload's on set covers campaigns, ad sets and ads", () => {
    const ad = (id: string, running: boolean) => ({ id, running });
    const p = {
      campaigns: [
        {
          id: "c1",
          running: true,
          adsets: [
            { id: "s1", running: true, ads: [ad("a1", true), ad("a2", false)] },
            { id: "s2", running: false, ads: [ad("a3", false)] },
          ],
        },
      ],
    } as any;
    expect([...onIds(p)].sort()).toEqual(["a1", "c1", "s1"]);
    expect(onIds(null).size).toBe(0);
  });
});

describe("the switch shows Meta's own setting, from the newest read", () => {
  /** A made-up stored payload: one campaign, one ad set, two ads. */
  const tree = (o: {
    statusFrom?: "meta" | "snapshots";
    statusReadAt?: number | null;
    campaign?: Record<string, unknown>;
    adset?: Record<string, unknown>;
    ads?: Record<string, unknown>[];
  }) =>
    ({
      statusFrom: o.statusFrom,
      statusReadAt: o.statusReadAt,
      campaigns: [
        {
          id: "c1",
          running: false,
          ...o.campaign,
          adsets: [
            {
              id: "s1",
              running: false,
              ...o.adset,
              ads: o.ads ?? [],
            },
          ],
        },
      ],
    }) as any;

  test("the switch is the row's own setting where the payload knows it, else running", () => {
    expect(sw.switchedOn({ running: false, switchOn: true })).toBe(true);
    expect(sw.switchedOn({ running: true, switchOn: false })).toBe(false);
    expect(sw.switchedOn({ running: true })).toBe(true);
    expect(sw.switchedOn({ running: false })).toBe(false);
    // Why a row switched on is not running, in Meta's words; nothing otherwise.
    expect(
      sw.onNotRunning({
        running: false,
        switchOn: true,
        status: "CAMPAIGN_PAUSED",
      }),
    ).toBe(
      "On, but its campaign is switched off in Meta, so it is not running.",
    );
    expect(
      sw.onNotRunning({
        running: false,
        switchOn: true,
        status: "ADSET_PAUSED",
      }),
    ).toBe("On, but its ad set is switched off in Meta, so it is not running.");
    expect(
      sw.onNotRunning({
        running: false,
        switchOn: true,
        status: "WITH_ISSUES",
      }),
    ).toBe("On, but not running: Meta says with issues.");
    expect(
      sw.onNotRunning({ running: true, switchOn: true, status: "ACTIVE" }),
    ).toBeNull();
    expect(
      sw.onNotRunning({ running: false, switchOn: false, status: "PAUSED" }),
    ).toBeNull();
    expect(sw.onNotRunning({ running: false, status: "PAUSED" })).toBeNull();
  });

  test("a picked range read before the stored payload takes the stored switches; otherwise each row's own", () => {
    const stored = tree({
      statusFrom: "meta",
      statusReadAt: T + 16 * MIN,
      campaign: { running: false, switchOn: false },
      adset: { running: false, switchOn: true },
      ads: [
        { id: AD, running: false, switchOn: true },
        { id: "900000000000002", running: true },
      ],
    });
    const range = tree({ statusFrom: "meta", statusReadAt: T - 20 * MIN });
    const newer = sw.newerSwitches(stored, range);
    expect(newer && Object.fromEntries(newer)).toEqual({
      c1: false,
      s1: true,
      [AD]: true,
      "900000000000002": true,
    });
    // The stored payload itself, or a range read as late or later: the rows' own.
    expect(sw.newerSwitches(stored, stored)).toBeNull();
    expect(
      sw.newerSwitches(
        stored,
        tree({ statusFrom: "meta", statusReadAt: T + 16 * MIN }),
      ),
    ).toBeNull();
    // A range that fell back to the snapshots is older than any status read.
    expect(
      sw.newerSwitches(
        stored,
        tree({ statusFrom: "snapshots", statusReadAt: null }),
      ),
    ).not.toBeNull();
    // A stored payload on the fallback, or none, places nothing.
    expect(
      sw.newerSwitches(
        tree({ statusFrom: "snapshots", statusReadAt: null }),
        range,
      ),
    ).toBeNull();
    expect(sw.newerSwitches(tree({}), range)).toBeNull();
    expect(sw.newerSwitches(null, range)).toBeNull();
  });

  test("on a picked range, a change made here stays put once the stored read after it ends the hold, on and off", async () => {
    // The range on screen was read at T - 20 minutes: the ad off, the other ad on.
    // The CEO turns the first on and the second off at T; the stored payload reads Meta at T + 16.
    const on = await confirmed(true);
    const off = await confirmed(false, "900000000000002");
    expect([on.on, off.on]).toEqual([true, false]);
    const stored = tree({
      statusFrom: "meta",
      statusReadAt: T + 16 * MIN,
      ads: [
        { id: AD, running: true, switchOn: true },
        { id: "900000000000002", running: false, switchOn: false },
      ],
    });
    const range = tree({ statusFrom: "meta", statusReadAt: T - 20 * MIN });
    const clock: SwitchClock = {
      readAt: SEEN,
      statusReadAt: T + 16 * MIN,
      on: onIds(stored),
      refreshAt: T + 31 * MIN,
      now: T + 17 * MIN,
      newer: sw.newerSwitches(stored, range),
    };
    // The holds have given way to the stored read.
    expect(liveHolds(switchesNow().held, clock)).toBe(0);
    const row = (metaId: string, running: boolean) =>
      createElement(RowSwitch, {
        key: metaId,
        metaId,
        level: "ad",
        name: metaId,
        running,
        clock,
        setStatus: okNow().fn,
        onDone: () => {},
      });
    // The range's own rows still say off and on; the switches show Meta's newer answer.
    await act(async () =>
      root.render([row(AD, false), row("900000000000002", true)]),
    );
    expect(switches().map(checked)).toEqual([true, false]);
    // Without the newer read they would snap back: the bug this guards.
    await act(async () =>
      root.render([
        createElement(RowSwitch, {
          key: "a",
          metaId: AD,
          level: "ad",
          name: "a",
          running: false,
          clock: { ...clock, newer: null },
          setStatus: okNow().fn,
          onDone: () => {},
        }),
      ]),
    );
    expect(switches().map(checked)).toEqual([false]);
  });

  test("an ad set switched on under a paused campaign shows on, and says why it is not running", async () => {
    const clock: SwitchClock = {
      readAt: SEEN,
      statusReadAt: SEEN,
      on: new Set(),
      refreshAt: SEEN + REFRESH_EVERY_MS,
      now: T,
    };
    const set = {
      id: "s1",
      running: false,
      switchOn: true,
      status: "CAMPAIGN_PAUSED",
    };
    await act(async () =>
      root.render([
        createElement(RowSwitch, {
          key: "switch",
          metaId: set.id,
          level: "adset",
          name: "Kuwait founders",
          running: sw.switchedOn(set),
          clock,
          setStatus: okNow().fn,
          onDone: () => {},
        }),
        createElement(sw.OnNotRunning, { key: "why", node: set, clock }),
      ]),
    );
    expect(switches().map(checked)).toEqual([true]);
    expect(host.textContent).toContain(
      "On, but its campaign is switched off in Meta, so it is not running.",
    );
    // A newer read that has it off, or a held change, says nothing.
    expect(
      renderToStaticMarkup(
        createElement(sw.OnNotRunning, {
          node: set,
          clock: { ...clock, newer: new Map([["s1", false]]) },
        }),
      ),
    ).toBe("");
    // Clicking it turns its own switch off, the one Meta changes.
    const s = okNow();
    await act(async () =>
      root.render(
        createElement(RowSwitch, {
          metaId: set.id,
          level: "adset",
          name: "Kuwait founders",
          running: sw.switchedOn(set),
          clock,
          setStatus: s.fn,
          onDone: () => {},
        }),
      ),
    );
    await act(async () => switches()[0].click());
    await flush();
    expect(s.calls).toEqual([
      { metaId: "s1", level: "adset", active: false, name: "Kuwait founders" },
    ]);
    // Held, so the old reason waits with the verdicts (by this browser's clock at the change).
    const h = switchesNow().held.s1;
    expect(h).toMatchObject({ on: false, seen: SEEN });
    expect(
      renderToStaticMarkup(
        createElement(sw.OnNotRunning, {
          node: set,
          clock: { ...clock, now: h.at + MIN },
        }),
      ),
    ).toBe("");
  });
});

describe("a refusal", () => {
  test("res.ok false holds nothing and hands back the server's sentence", async () => {
    const s = server(async () => ({
      ok: false,
      error: "Meta refused it: the account is not in good standing.",
    }));
    const r = await changeSwitch({
      metaId: AD,
      level: "ad",
      name: "Founder story",
      active: true,
      setStatus: s.fn,
      seen: SEEN,
    });
    expect(r).toEqual({
      ok: false,
      error: "Meta refused it: the account is not in good standing.",
    });
    expect(switchesNow().held).toEqual({});
    expect(win.sessionStorage.getItem(HELD_KEY)).toBeNull();
    // No sentence from the server: the plain one.
    const quiet = await changeSwitch({
      metaId: AD,
      level: "ad",
      name: "Founder story",
      active: true,
      setStatus: server(async () => ({ ok: false })).fn,
      seen: SEEN,
    });
    expect(quiet).toEqual({ ok: false, error: "Meta refused it." });
  });

  test("a request that fails holds nothing either", async () => {
    const r = await changeSwitch({
      metaId: AD,
      level: "ad",
      name: "Founder story",
      active: true,
      setStatus: server(async () => {
        throw new Error("Sign in again");
      }).fn,
      seen: SEEN,
    });
    expect(r).toEqual({ ok: false, error: "Sign in again" });
    expect(switchesNow().held).toEqual({});
    expect(switchesNow().busy).toEqual({});
  });
});

describe("the switches on screen", () => {
  const clock: SwitchClock = {
    readAt: SEEN,
    on: new Set(),
    refreshAt: SEEN + REFRESH_EVERY_MS,
    now: T,
  };

  test("two rows of one object agree, and a second click while in flight is ignored", async () => {
    let release: (v: unknown) => void = () => {};
    const s = server(
      () =>
        new Promise(r => {
          release = r;
        }),
    );
    const done: (string | null)[] = [];
    const row = (key: string) =>
      createElement(RowSwitch, {
        key,
        metaId: AD,
        level: "ad",
        name: "Founder story",
        running: false,
        clock,
        setStatus: s.fn,
        onDone: (m: string | null) => done.push(m),
      });
    // The same ad twice, as the funnel and a remounted row would show it.
    await act(async () => root.render([row("funnel"), row("table")]));
    const [a, b] = switches();
    expect([checked(a), checked(b)]).toEqual([false, false]);
    expect(a.getAttribute("aria-label")).toBe("Turn on ad Founder story");

    await act(async () => a.click());
    await flush();
    // In flight: both disabled, and a click on either is ignored.
    expect(switches().map(x => x.disabled)).toEqual([true, true]);
    await act(async () => b.click());
    await act(async () => a.click());
    await flush();
    expect(s.calls.length).toBe(1);

    await act(async () => release({ ok: true }));
    await flush();
    const [a2, b2] = switches();
    expect([checked(a2), checked(b2)]).toEqual([true, true]);
    expect([a2.disabled, b2.disabled]).toEqual([false, false]);
    expect(a2.getAttribute("aria-label")).toBe("Turn off ad Founder story");
    // The row's note carries it; the line at the top is cleared, never left
    // saying "Turned on" after the hold has given way.
    expect(done).toEqual([null]);
  });

  test("a refusal leaves the switch where it was and shows the server's sentence", async () => {
    const done: (string | null)[] = [];
    await act(async () =>
      root.render(
        createElement(RowSwitch, {
          metaId: AD,
          level: "campaign",
          name: "Lead gen, October",
          running: true,
          clock,
          setStatus: server(async () => ({
            ok: false,
            error: "Meta refused it.",
          })).fn,
          onDone: (m: string | null) => done.push(m),
        }),
      ),
    );
    await act(async () => switches()[0].click());
    await flush();
    expect(checked(switches()[0])).toBe(true);
    expect(done).toEqual(["Meta refused it."]);
    expect(switchesNow().held).toEqual({});
  });

  test("the note says what happened and about when the numbers catch up, in Kuwait time", async () => {
    const none = renderToStaticMarkup(
      createElement(SwitchNote, { metaId: AD, clock }),
    );
    expect(none).toBe("");
    await changeSwitch({
      metaId: AD,
      level: "ad",
      name: "Founder story",
      active: true,
      setStatus: okNow().fn,
      seen: SEEN,
      clock: () => T,
    });
    const note = renderToStaticMarkup(
      createElement(SwitchNote, { metaId: AD, clock }),
    );
    expect(note.replace(/<[^>]+>/g, "")).toBe(
      "Turned on · Meta has it now; the numbers catch up at the next refresh (about 13:40)",
    );
    const off = { on: false, at: T, seen: SEEN };
    expect(heldSentence(off, { ...clock, refreshAt: null })).toBe(
      "Turned off · Meta has it now; the numbers catch up at the next refresh, which is late: the Machine tab says why",
    );
    // Read since the change and still off: the wait is for delivery.
    const later = { ...clock, readAt: T + 5 * MIN, now: T + 20 * MIN };
    expect(
      renderToStaticMarkup(
        createElement(SwitchNote, { metaId: AD, clock: later }),
      ).replace(/<[^>]+>/g, ""),
    ).toBe(
      "Turned on · Meta has it now; it shows as running here once it delivers",
    );
    expect(note).not.toContain("—");
  });

  test("the row's verdict chip and sentence wait while a change is held", async () => {
    const verdict = () =>
      renderToStaticMarkup(
        createElement(
          UnlessHeld,
          { metaId: AD, clock },
          createElement("p", null, "Not delivering: switched off in Meta."),
        ),
      );
    expect(verdict()).toBe("<p>Not delivering: switched off in Meta.</p>");
    await confirmed(true);
    expect(verdict()).toBe("");
    // Another ad's sentence stays.
    expect(
      renderToStaticMarkup(
        createElement(
          UnlessHeld,
          { metaId: "900000000000009", clock },
          createElement("p", null, "Scale"),
        ),
      ),
    ).toBe("<p>Scale</p>");
  });
});

describe("the next refresh", () => {
  const STALE = 45 * MIN;
  test("is 15 minutes after the last run, rolled on when that has passed", () => {
    expect(nextRefreshAt(SEEN, T, STALE)).toBe(SEEN + 15 * MIN);
    expect(nextRefreshAt(SEEN, SEEN + 15 * MIN, STALE)).toBe(SEEN + 30 * MIN);
    expect(nextRefreshAt(SEEN, SEEN + 22 * MIN, STALE)).toBe(SEEN + 30 * MIN);
    // A server clock a little ahead of this one.
    expect(nextRefreshAt(T + MIN, T, STALE)).toBe(T + 16 * MIN);
  });

  test("is unknown, never a guess, when the last run is missing or overdue", () => {
    expect(nextRefreshAt(null, T, STALE)).toBeNull();
    expect(nextRefreshAt(0, T, STALE)).toBeNull();
    expect(nextRefreshAt(T - 46 * MIN, T, STALE)).toBeNull();
  });

  test("the page reads the sections again just after it, at least a minute on", () => {
    expect(rereadDelay(SEEN, T)).toBe(SEEN + 15 * MIN + REREAD_GRACE_MS - T);
    expect(rereadDelay(T - 40 * MIN, T)).toBe(MIN);
    expect(rereadDelay(null, T)).toBe(5 * MIN);
  });
});

describe("the Ads tab", () => {
  const src = readFileSync(
    join(import.meta.dir, "../src/pages/ceo/AdsTab.tsx"),
    "utf8",
  );
  test("every switch on the tab is the shared one, fed when the payload last read Meta", () => {
    expect(src).not.toContain("function Toggle(");
    expect(src).not.toContain("<Toggle");
    expect(src.match(/<RowSwitch\b/g)?.length).toBe(4);
    expect(src.match(/clock=\{(r\.)?clock\}/g)?.length).toBeGreaterThanOrEqual(
      4,
    );
    // The snapshot stamp ends a hold, never the publish time; the publish
    // time only says when the next refresh is due.
    expect(src).toContain("metaReadAt(section?.sources)");
    // Meta's own status read, when the payload has one, ends a hold (2026-10-19).
    expect(src).toContain("liveStatusAt(stored)");
    expect(src).toContain("statusReadAt,");
    expect(src).toContain("onIds(stored)");
    expect(src).not.toContain("payloadAt");
    expect(src).toContain("nextRefreshAt(lastRun, now, STALE_AFTER_MS)");
    // Every switch shows the row's own setting in Meta where the payload knows it.
    expect(src.match(/running=\{switchedOn\((ad|s|c|a)\)\}/g)?.length).toBe(4);
    expect(src).not.toMatch(/running=\{(ad|s|c|a)\.running\}/);
    // A picked range's switches follow the stored read when it is the newer one.
    expect(src).toContain("newerSwitches(stored, p)");
    expect(src).toContain("clock: rowClock,");
    expect(src).toContain("clock={rowClock}");
    // An ad set or campaign switched on that is not running says why.
    expect(
      src.match(/<OnNotRunning node=\{(s|c)\} clock=\{r\.clock\} \/>/g)?.length,
    ).toBe(2);
  });

  test("an ad row's verdict sentence follows the hold, like its chip", () => {
    expect(src).toMatch(
      /<UnlessHeld metaId=\{ad\.id\} clock=\{r\.clock\}>\s*<p[^>]*>\{ad\.verdict\.reason\}<\/p>\s*<\/UnlessHeld>/,
    );
    expect(src.match(/\{ad\.verdict\.reason\}/g)?.length).toBe(1);
  });

  test('a change that turned something on outranks "Nothing running" and its note', () => {
    expect(src).toContain("anyTurnedOn(switches.held, clock)");
    expect(src).toContain("p.running === 0 && !turnedOn ?");
    expect(src).toContain(
      'const NOTHING_DELIVERING = "Nothing on the account is delivering.";',
    );
    // Both writers of that note open with the same words.
    for (const f of [
      "../../hermes/ceo-refresh/native/adapters/b2bAds.js",
      "../../supabase/functions/cockpit-ceo-api/windows.ts",
    ])
      expect(readFileSync(join(import.meta.dir, "..", f), "utf8")).toContain(
        "Nothing on the account is delivering. Every ad is switched off",
      );
    const c = read(SEEN, T + MIN);
    expect(anyTurnedOn({ [AD]: { on: false, at: T, seen: SEEN } }, c)).toBe(
      false,
    );
    expect(anyTurnedOn({ [AD]: { on: true, at: T, seen: SEEN } }, c)).toBe(
      true,
    );
  });
});
