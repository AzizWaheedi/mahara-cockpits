/**
 * Hubstaff watch (the CEO, 2026-10-13): the shapes the CEO cockpit reads and
 * writes, as docs/hours-watch/SPEC.md names them. The board is
 * `cockpit_ceo_hours_watch_board()`; the settings live in `cockpit_settings`
 * under `hours.watch`. Times are ISO strings from the server; seconds are
 * whole seconds.
 */

/** The four alerts. `source` has no person: Hubstaff itself cannot be read. */
export type WatchKind = "not_tracking" | "not_work" | "idle" | "source";

/** One person's state right now (`cockpit_hours_watch_status.state`). */
export type WatchState =
  | "tracking"
  | "not_tracking"
  /** Inside the allowed break wait: stopped, no alert yet (SPEC, final round). */
  | "on_break"
  | "idle"
  | "not_work"
  | "off_shift"
  | "on_leave"
  | "holiday"
  | "no_account"
  | "cant_tell";

/** Why someone is not on shift today, when they are not. */
export type WatchOffReason =
  | "day_off"
  | "holiday"
  | "leave"
  | "not_employed"
  | "paused"
  /** Paid by the hour with no schedule at all: nothing is expected of them. */
  | "no_schedule";

/** What the vision check made of one screenshot. */
export type ShotVerdict =
  | "pending"
  | "work"
  | "not_work"
  | "unclear"
  | "error"
  | "skipped";

/** Where an incident's Slack post stands. */
export type SlackState =
  | "pending"
  | "sending"
  | "posted"
  | "failed"
  | "unknown"
  | "muted";

export type WatchSettings = {
  /** Slack alerts on. Off still records incidents, with Slack muted. */
  on: boolean;
  /** The screenshot check on. */
  shots: boolean;
  channel: string;
  channelName: string;
  notTrackingMinutes: number;
  graceMinutes: number;
  idleMinutes: number;
  idleFloorPct: number;
  windowMinutes: number;
  nonWorkShots: number;
  minConfidence: number;
  /** Each opening Slack post starts with an @-mention of `mentionUser`. */
  mention: boolean;
  /** The Slack user mentioned (the CEO); never shown on the screen. */
  mentionUser: string;
};

/** The numeric settings, each with the bounds the server enforces. */
export type WatchNumberKey = Exclude<
  keyof WatchSettings,
  "on" | "shots" | "channel" | "channelName" | "mention" | "mentionUser"
>;

export const WATCH_BOUNDS: Record<
  WatchNumberKey,
  { min: number; max: number }
> = {
  notTrackingMinutes: { min: 10, max: 240 },
  graceMinutes: { min: 0, max: 120 },
  idleMinutes: { min: 20, max: 240 },
  idleFloorPct: { min: 1, max: 50 },
  windowMinutes: { min: 20, max: 120 },
  nonWorkShots: { min: 1, max: 6 },
  minConfidence: { min: 0.5, max: 0.99 },
};

/**
 * The plain label and unit of each number, for the settings sheet and for the
 * sentence that refuses a value out of bounds. minConfidence is shown and
 * typed as a percentage; it is stored as a fraction.
 */
export const WATCH_FIELDS: Record<
  WatchNumberKey,
  { label: string; unit: "minutes" | "percent" | "screenshots" }
> = {
  notTrackingMinutes: {
    label: "Alert after Hubstaff is off for",
    unit: "minutes",
  },
  graceMinutes: { label: "Grace after the shift starts", unit: "minutes" },
  idleFloorPct: { label: "Keyboard and mouse below", unit: "percent" },
  idleMinutes: { label: "Keyboard and mouse measured over", unit: "minutes" },
  nonWorkShots: { label: "Screenshots off work", unit: "screenshots" },
  windowMinutes: { label: "Screenshots looked at over", unit: "minutes" },
  minConfidence: { label: "Only when the check is at least", unit: "percent" },
};

/** The seeded settings (never overwritten on the server). */
export const WATCH_DEFAULTS: WatchSettings = {
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

/** A Slack channel id: C or G and 8 to 12 capitals or digits. */
export const WATCH_CHANNEL = /^[CG][A-Z0-9]{8,12}$/;
/** A Slack user id: U or W and 8 to 12 capitals or digits. */
export const WATCH_MENTION_USER = /^[UW][A-Z0-9]{8,12}$/;

export type WatchAiProvider = "google_ai" | "openai";

export type WatchSources = {
  /** `connected` when Hubstaff can be read; anything else comes with a note. */
  hubstaff: { state: string; note: string | null };
  /**
   * `failing`: the key is saved but the last 3 screenshots checked in the
   * last hour all ended in an error; the note is the newest error.
   */
  ai: {
    state: "connected" | "missing" | "refused" | "failing";
    provider: WatchAiProvider | null;
    note: string | null;
  };
  slack: { state: "ok" | "failing" | "unknown"; note: string | null };
};

/** One 10-minute block of the shift line. */
export type WatchSlot = {
  start: string;
  trackedS: number;
  overallS: number;
  /**
   * Time tracked with a keyboard and mouse (`input_tracked_s`); null when the
   * server does not know it. Phone and web timer time has no activity level,
   * so the shade is `overallS / inputTrackedS`.
   */
  inputTrackedS: number | null;
  idle: boolean;
};

/** Leave covering only part of today's shift (ISO instants), drawn as off time. */
export type WatchLeave = { start: string; end: string };

/** A screenshot today judged not work or unclear. Paths are only for signing. */
export type WatchShot = {
  id: number;
  at: string;
  verdict: ShotVerdict;
  label: string | null;
  confidence: number | null;
  thumbPath: string | null;
  /** Not in the spec's board: used for the large view when the server sends it. */
  fullPath: string | null;
};

export type WatchPerson = {
  personId: number;
  name: string;
  role: string | null;
  state: WatchState;
  since: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  online: boolean | null;
  lastActivityAt: string | null;
  trackedTodayS: number | null;
  /** Keyboard and mouse in the last 30 minutes, in percent (0 to 100). */
  activePct30m: number | null;
  screenshotsOn: boolean | null;
  offReason: WatchOffReason | null;
  /**
   * When this run last read the person's Hubstaff data (`detail.readAt`).
   * Blocks after `readAt - 20 min`, or all of them when null, are not in
   * from Hubstaff yet: never a gap.
   */
  readAt: string | null;
  /** True while the person is inside the allowed break wait (state `on_break`). */
  onBreak: boolean;
  /** Part-day leave windows today; whole-shift leave is `offReason: 'leave'`. */
  leave: WatchLeave[];
  slots: WatchSlot[];
  shots: WatchShot[];
};

export type WatchIncident = {
  id: number;
  personId: number | null;
  /** The person's name as the board joins it, so someone off the roster keeps theirs. */
  name: string | null;
  kind: WatchKind;
  openedAt: string;
  lastSeenAt: string | null;
  detail: Record<string, unknown>;
  slackState: SlackState;
  slackError: string | null;
  reviewedAt: string | null;
};

export type WatchRecent = {
  id: number;
  personId: number | null;
  name: string | null;
  kind: WatchKind;
  openedAt: string;
  closedAt: string;
  closeReason: string | null;
  detail: Record<string, unknown>;
  reviewedAt: string | null;
};

export type WatchBoard = {
  settings: WatchSettings;
  sources: WatchSources;
  lastRun: { at: string; ok: boolean; note: string | null } | null;
  cronOn: boolean;
  now: string;
  people: WatchPerson[];
  open: WatchIncident[];
  recent: WatchRecent[];
};

export type WatchKeyResult =
  | { ok: true; state: WatchSources["ai"]["state"]; text: string }
  | { ok: false; state: WatchSources["ai"]["state"] | null; text: string };

export type WatchNowResult =
  | { ok: true }
  | { ok: false; busy: true; since: string | null };
