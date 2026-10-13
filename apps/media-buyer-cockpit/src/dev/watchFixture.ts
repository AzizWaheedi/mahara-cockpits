/**
 * Hubstaff watch for the layout harness (2026-10-13): what
 * `cockpit_ceo_hours_watch_board` would answer on a lively day, built around
 * the real clock so the now needle sits on the bars. The people are the
 * hours harness's invented three (hoursHarness.ts people()): Hala Mansour and
 * Omar Fayed, call centre agents, and Sara Kanaan, media buyer, plus two more
 * for the final round: Lina Haddad (call centre agent) on her lunch break,
 * and Yousef Karam (media buyer) on leave for the morning. Every name, time
 * and screenshot is made up. Never imported by the production app.
 *
 * `?watch=full|none|source|noai|aifail|offshift|slack` picks the scenario
 * (default full): one working, one not tracking since 12 minutes into the
 * shift with the alert posted to Slack, one with two screenshots off work and
 * an open alert, one on an allowed lunch break (no alert, a neutral chip),
 * one with a morning leave window drawn as off time. `aifail` is the full day with the screenshot check failing
 * (a saved key whose last screenshots all ended in an error). Each person
 * carries `readAt`, the last read of their Hubstaff data; the last 7 days
 * include someone no longer watched, named by the incident.
 */

export type WatchScenario =
  | "full"
  | "none"
  | "source"
  | "noai"
  | "aifail"
  | "offshift"
  | "slack";

const SCENARIOS: WatchScenario[] = [
  "full",
  "none",
  "source",
  "noai",
  "aifail",
  "offshift",
  "slack",
];

export function watchScenario(): WatchScenario {
  const raw =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("watch");
  return SCENARIOS.includes(raw as WatchScenario)
    ? (raw as WatchScenario)
    : "full";
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const SLOT = 10 * MIN;
const KUWAIT = 3 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

/** The settings the CEO has changed in this tab, held in memory. */
export const watchSettings: Record<string, unknown> = {
  on: true,
  shots: true,
  channel: "C0B5TL9H370",
  channelName: "team-management",
  notTrackingMinutes: 30,
  graceMinutes: 15,
  idleMinutes: 30,
  idleFloorPct: 10,
  windowMinutes: 30,
  nonWorkShots: 2,
  minConfidence: 0.75,
  mention: true,
  mentionUser: "U09305KE2KS",
};
/** Alerts marked reviewed in this tab. */
export const watchReviewed = new Map<number, string>();

/** The shift in force today: 10:00 to 18:00 Kuwait, or one around now outside those hours. */
function shiftAround(now: number, scenario: WatchScenario) {
  const day = Math.floor((now + KUWAIT) / (24 * HOUR)) * 24 * HOUR - KUWAIT;
  const ten = day + 10 * HOUR;
  if (scenario === "offshift") {
    // Shifts that ended an hour ago, so nobody is on.
    const end = Math.floor(now / HOUR) * HOUR - HOUR;
    return { start: end - 8 * HOUR, end };
  }
  if (now >= ten + 90 * MIN && now < ten + 8 * HOUR)
    return { start: ten, end: ten + 8 * HOUR };
  const start = Math.floor(now / HOUR) * HOUR - 3 * HOUR;
  return { start, end: start + 8 * HOUR };
}

type Slot = {
  start: string;
  trackedS: number;
  overallS: number;
  /** Keyboard-and-mouse time; 0 is a block tracked on the phone only. */
  inputTrackedS: number | null;
  idle: boolean;
};

function slots(
  from: number,
  to: number,
  pick: (t: number, i: number) => Partial<Slot> | null,
): Slot[] {
  const out: Slot[] = [];
  for (let t = from, i = 0; t + SLOT <= to; t += SLOT, i++) {
    const s = pick(t, i);
    if (s)
      out.push({
        start: iso(t),
        trackedS: 600,
        overallS: 300,
        idle: false,
        ...s,
        // All on the computer unless the block says otherwise.
        inputTrackedS:
          "inputTrackedS" in s
            ? (s.inputTrackedS ?? null)
            : (s.trackedS ?? 600),
      });
  }
  return out;
}

/** The whole board for one scenario. */
export function watchBoardFixture(
  scenario: WatchScenario = watchScenario(),
  now = Date.now(),
): Record<string, unknown> {
  const shift = shiftAround(now, scenario);
  const lagged = Math.min(now - 20 * MIN, shift.end);
  const sinceOmar = shift.start + 12 * MIN;
  const shotA = Math.floor((now - 24 * MIN) / SLOT) * SLOT + 3 * MIN;
  const shotB = shotA + 10 * MIN;
  const shotC = shotA - 10 * MIN;
  const settings = { ...watchSettings };
  const off = scenario === "offshift";
  const blind = scenario === "source";
  // No key, or a key whose checks all fail: no screenshot was judged.
  const noShots = scenario === "noai" || scenario === "aifail";
  // The last run read everyone 2 minutes ago; after the shift, the read 30
  // minutes past its end was the last one with blocks.
  const readAt = blind ? null : off ? shift.end + 25 * MIN : now - 2 * MIN;

  const person = (
    personId: number,
    name: string,
    role: string,
    extra: Record<string, unknown>,
  ) => ({
    personId,
    name,
    role,
    since: null,
    shiftStart: iso(shift.start),
    shiftEnd: iso(shift.end),
    online: true,
    lastActivityAt: iso(now - 2 * MIN),
    trackedTodayS: null,
    activePct30m: null,
    screenshotsOn: true,
    offReason: null,
    readAt: readAt === null ? null : iso(readAt),
    onBreak: false,
    leave: [] as { start: string; end: string }[],
    slots: [] as Slot[],
    shots: [] as Record<string, unknown>[],
    ...extra,
  });

  // Blocks come in up to the last read less Hubstaff's 20-minute lag.
  const halaSlots = slots(shift.start, lagged, (_t, i) => ({
    overallS: [420, 360, 480, 300, 390, 450, 270, 330][i % 8],
    idle: i === 5,
  }));
  const omarSlots = slots(shift.start, lagged, (t, i) =>
    i === 0
      ? { overallS: 260 }
      : t < sinceOmar
        ? { trackedS: 120, overallS: 40 }
        : null,
  );
  const saraSlots = slots(shift.start, lagged, (_t, i) => ({
    overallS: [300, 240, 360, 180, 420, 210][i % 6],
  }));
  // Lina tracked from the start, with one block on the phone only (the middle
  // shade), and stopped for lunch 30 minutes ago: inside the allowed break.
  const lunchFrom = Math.floor((now - 30 * MIN) / SLOT) * SLOT;
  const linaSlots = slots(shift.start, Math.min(lunchFrom, lagged), (_t, i) =>
    i === 2
      ? { overallS: 0, inputTrackedS: 0 }
      : { overallS: [360, 420, 300, 390][i % 4] },
  );
  // Yousef is on leave for the morning: shift start to its midpoint.
  const morning = {
    start: iso(shift.start),
    end: iso(shift.start + (shift.end - shift.start) / 2),
  };
  const yousefAway = now < Date.parse(morning.end);
  const yousefSlots = slots(Date.parse(morning.end), lagged, (_t, i) => ({
    overallS: [330, 270, 390][i % 3],
  }));
  const sum = (s: Slot[]) => s.reduce((a, x) => a + x.trackedS, 0);
  const saraShots = [
    {
      id: 900_003,
      at: iso(shotB),
      verdict: "not_work",
      label: "Instagram feed",
      confidence: 0.88,
      thumbPath: "2026/10/103/900003-thumb.jpg",
      fullPath: "2026/10/103/900003-full.jpg",
    },
    {
      id: 900_002,
      at: iso(shotA),
      verdict: "not_work",
      label: "YouTube video",
      confidence: 0.93,
      thumbPath: "2026/10/103/900002-thumb.jpg",
      fullPath: "2026/10/103/900002-full.jpg",
    },
    {
      id: 900_001,
      at: iso(shotC),
      verdict: "unclear",
      label: "Lock screen",
      confidence: 0.6,
      thumbPath: null,
    },
  ];

  const people =
    scenario === "none"
      ? []
      : [
          person(101, "Hala Mansour", "Call centre agent", {
            state: blind ? "cant_tell" : off ? "off_shift" : "tracking",
            slots: blind ? [] : halaSlots,
            trackedTodayS: blind ? null : sum(halaSlots),
            activePct30m: blind || off ? null : 58,
          }),
          person(102, "Omar Fayed", "Call centre agent", {
            state: blind ? "cant_tell" : off ? "on_leave" : "not_tracking",
            offReason: off ? "leave" : null,
            since: off ? null : iso(sinceOmar),
            online: off ? null : false,
            lastActivityAt: iso(sinceOmar),
            slots: blind || off ? [] : omarSlots,
            trackedTodayS: blind ? null : off ? 0 : sum(omarSlots),
            activePct30m: blind || off ? null : 0,
          }),
          person(103, "Sara Kanaan", "Media buyer", {
            state: blind ? "cant_tell" : off ? "off_shift" : "not_work",
            slots: blind ? [] : saraSlots,
            trackedTodayS: blind ? null : sum(saraSlots),
            activePct30m: blind || off ? null : 41,
            shots: blind || off || noShots ? [] : saraShots,
          }),
          person(105, "Lina Haddad", "Call centre agent", {
            state: blind ? "cant_tell" : off ? "off_shift" : "on_break",
            onBreak: !blind && !off,
            since: blind || off ? null : iso(lunchFrom),
            online: off ? null : false,
            lastActivityAt: iso(lunchFrom),
            slots: blind ? [] : linaSlots,
            trackedTodayS: blind ? null : sum(linaSlots),
            activePct30m: blind || off ? null : 0,
          }),
          person(106, "Yousef Karam", "Media buyer", {
            state:
              yousefAway && !off
                ? "on_leave"
                : blind
                  ? "cant_tell"
                  : off
                    ? "off_shift"
                    : "tracking",
            online: !yousefAway && !off,
            lastActivityAt: yousefAway ? null : iso(now - 2 * MIN),
            leave: [morning],
            slots: blind ? [] : yousefSlots,
            trackedTodayS: blind ? null : sum(yousefSlots),
            activePct30m: blind || off || yousefAway ? null : 52,
          }),
        ];

  const slackState = settings.on ? "posted" : "muted";
  const failing = scenario === "slack";
  const open =
    scenario === "none" || off
      ? []
      : blind
        ? [
            {
              id: 512,
              personId: null,
              name: null,
              kind: "source",
              openedAt: iso(now - 25 * MIN),
              lastSeenAt: iso(now - 2 * MIN),
              detail: {
                note: "Hubstaff refused the saved key (401). It may have been revoked",
              },
              slackState,
              slackError: null,
              reviewedAt: watchReviewed.get(512) ?? null,
            },
          ]
        : [
            {
              id: 510,
              personId: 102,
              name: "Omar Fayed",
              kind: "not_tracking",
              openedAt: iso(sinceOmar + 33 * MIN),
              lastSeenAt: iso(now - 2 * MIN),
              detail: {
                since: iso(sinceOmar),
                shiftStart: iso(shift.start),
                shiftEnd: iso(shift.end),
              },
              slackState: failing ? "failed" : slackState,
              slackError: failing ? "not_in_channel" : null,
              reviewedAt: watchReviewed.get(510) ?? null,
            },
            ...(noShots
              ? []
              : [
                  {
                    id: 511,
                    personId: 103,
                    name: "Sara Kanaan",
                    kind: "not_work",
                    openedAt: iso(shotB + 4 * MIN),
                    lastSeenAt: iso(now - 2 * MIN),
                    detail: {
                      count: 2,
                      total: 3,
                      labels: ["YouTube video", "Instagram feed"],
                      shotIds: [900_002, 900_003],
                      text: "*Sara Kanaan* (media buyer): 2 of the last 3 screenshots do not look like work (YouTube video, Instagram feed). <https://cockpit.example.test/ceo?tab=management#hubstaff-watch|See the screenshots>",
                    },
                    slackState: failing ? "failed" : slackState,
                    slackError: failing ? "not_in_channel" : null,
                    reviewedAt: watchReviewed.get(511) ?? null,
                  },
                ]),
          ];

  const day = (n: number, h: number, m = 0) =>
    Math.floor((now + KUWAIT) / (24 * HOUR)) * 24 * HOUR -
    KUWAIT -
    n * 24 * HOUR +
    h * HOUR +
    m * MIN;
  const names: Record<number, string> = {
    101: "Hala Mansour",
    102: "Omar Fayed",
    103: "Sara Kanaan",
    104: "Nada Saleh",
    105: "Lina Haddad",
    106: "Yousef Karam",
  };
  const closed = (
    id: number,
    personId: number | null,
    kind: string,
    opened: number,
    mins: number,
    closeReason: string,
    detail: Record<string, unknown> = {},
  ) => ({
    id,
    personId,
    name: personId === null ? null : (names[personId] ?? null),
    kind,
    openedAt: iso(opened),
    closedAt: iso(opened + mins * MIN),
    closeReason,
    detail,
    reviewedAt: id % 3 ? iso(opened + (mins + 20) * MIN) : null,
  });
  const recent =
    scenario === "none"
      ? []
      : [
          closed(509, 101, "idle", day(0, 11, 40), 20, "active", {
            pct: 4,
          }),
          closed(508, 102, "not_tracking", day(1, 10, 0), 35, "back", {
            reason: "off",
          }),
          closed(507, 103, "not_work", day(1, 15, 10), 30, "work", {
            count: 2,
            total: 3,
            labels: ["TikTok For You"],
          }),
          closed(506, null, "source", day(2, 9, 55), 15, "read_ok", {
            note: "unreadable",
          }),
          closed(505, 102, "not_tracking", day(3, 16, 10), 110, "shift_ended"),
          closed(504, 103, "not_tracking", day(4, 10, 15), 45, "linked", {
            reason: "no_account",
          }),
          closed(503, 101, "not_tracking", day(5, 13, 5), 25, "back", {
            reason: "off",
          }),
          // Someone taken off the watch: not on today's roster, named by the incident.
          closed(502, 104, "idle", day(6, 12, 0), 30, "not_watched"),
        ];

  return {
    settings,
    sources: {
      hubstaff: blind
        ? {
            state: "refused",
            note: "Hubstaff refused the saved key (401). It may have been revoked",
          }
        : { state: "connected", note: null },
      ai:
        scenario === "noai"
          ? { state: "missing", provider: null, note: null }
          : scenario === "aifail"
            ? {
                state: "failing",
                provider: "openai",
                note: "OpenAI answered 500 three times in a row",
              }
            : { state: "connected", provider: "openai", note: null },
      slack: failing
        ? { state: "failing", note: "not_in_channel" }
        : { state: "ok", note: null },
    },
    lastRun: { at: iso(now - 2 * MIN), ok: true, note: null },
    cronOn: true,
    now: iso(now),
    people,
    open,
    recent,
  };
}

/** A stand-in screenshot: an invented screen with the label written on it. */
export function watchShotPicture(path: string): string {
  const label = /900003/.test(path)
    ? "Instagram feed (made up)"
    : /900002/.test(path)
      ? "YouTube video (made up)"
      : "Screenshot (made up)";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#1b2a52"/><rect x="0" y="0" width="1600" height="56" fill="#0f1b45"/><rect x="120" y="140" width="1360" height="640" rx="18" fill="#2c3d6b"/><circle cx="800" cy="460" r="70" fill="#f87171" opacity="0.8"/><text x="800" y="840" fill="#e5e9f5" font-family="sans-serif" font-size="44" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
