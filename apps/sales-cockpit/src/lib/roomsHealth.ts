/**
 * The Team page's video rooms card, in words: the jobs that keep rooms
 * working (contract v2 sections 7 and 10: the room worker, the host check,
 * and the five `sales-live` routes), and each seat's Zoom and Meet.
 *
 * Missing is never zero: a job that has not reported says so, and a seat
 * nobody has checked yet is "not checked", never "not set up".
 */
import { clock } from "./format";
import {
  type Health,
  healthTone,
  monoTimes,
  type Provider,
  type Sentence,
  type ZoomStatus,
} from "./rooms";

/** desk/rooms.py NOT_MAKING (roomlogic.ts NOT_MAKING_PREFIX): the worker runs and makes no room. */
const NOT_MAKING_PREFIX = "Not making rooms: ";

export interface JobRow {
  worker: string;
  job: string;
  ok: boolean;
  detail: string | null;
  at: string;
}

export interface RoomJob {
  worker: string;
  job: string;
  /** What it does, as a manager says it. */
  what: string;
  /** Late after this many seconds without a report; null: reports only on failure. */
  staleS: number | null;
  /** The runbook's next step when the line is red: who checks what. */
  fix: string;
}

/**
 * The rows the watchdog reads (contract v2 section 10, item 8): the room
 * worker red at 90 s, the host check at 20 minutes, and the door's five
 * routes, which report on use and count only when they fail; then the
 * database's own sweep (every minute) and watchdog (every five).
 */
export const ROOM_JOBS: readonly RoomJob[] = [
  {
    worker: "sales-desk",
    job: "rooms",
    what: "The room worker",
    staleS: 90,
    fix: "Hermes checks the rooms cron line and the log on the VPS (runbook: Video rooms are not being made).",
  },
  {
    worker: "sales-desk",
    job: "room-hosts",
    what: "The Zoom and Google check",
    staleS: 20 * 60,
    fix: "Hermes checks the room-hosts cron line on the VPS.",
  },
  {
    worker: "sales-live",
    job: "zoom",
    what: "Zoom's meeting events",
    staleS: null,
    fix: "Set ZOOM_WEBHOOK_SECRET and CRON_SECRET in sales-live's secrets.",
  },
  {
    worker: "sales-live",
    job: "go",
    what: "The short link",
    staleS: null,
    fix: "Hermes checks sales-live is deployed and reaches the database.",
  },
  {
    worker: "sales-live",
    job: "open",
    what: "Link opens",
    staleS: null,
    fix: "Hermes checks sales-live is deployed and reaches the database.",
  },
  {
    worker: "sales-live",
    job: "slack",
    what: "Slack presses",
    staleS: null,
    fix: "Set SLACK_SIGNING_SECRET in sales-live's secrets.",
  },
  {
    worker: "sales-live",
    job: "cron",
    what: "The minute sweep's posts",
    staleS: null,
    fix: "Hermes checks sales-live's CRON_SECRET and that sales-api takes the hooks.",
  },
  // Fix round 4: the sweep and the watchdog themselves, so a pg_net that
  // stopped answering (or a sweep that stopped) shows here without Slack.
  {
    worker: "sales-api",
    job: "sweep",
    what: "The room sweep",
    staleS: 5 * 60,
    fix: "Hermes checks the mahara-sales-rooms-sweep job and sales-live's CRON_SECRET (runbook: sweep_door).",
  },
  {
    worker: "sales-api",
    job: "watchdog",
    what: "The alert watchdog",
    staleS: 15 * 60,
    fix: "Hermes checks the mahara-sales-watchdog job in the database.",
  },
];

export type LineTone = "good" | "owed" | "bad" | "quiet";

export interface JobLine {
  key: string;
  tone: LineTone;
  text: string;
  /** The same words, with times set in Geist Mono. */
  say: Sentence;
}

/** A red line's sentence already says what to do (the job wrote its own next step). */
function saysNextStep(detail: string): boolean {
  return /(^|[.!?]\s+)(Add|Set|Check|Run|Deploy|Connect|Apply|Accept|Reconnect|Make|Ask|Press|Call|Create)\b/.test(
    detail,
  );
}

const sentence = (s: string | null | undefined) => {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/**
 * One line per job. With rooms switched off, a job that has not run is
 * quiet, not a fault; with them on, the room worker that has not run, or
 * runs late, is red because no room can be made.
 */
export function roomJobLines(
  rows: readonly JobRow[],
  now: number,
  roomsOn: boolean,
  /**
   * The parts a switch keeps off (m1 round 1, slack-fenced-stray-post): Slack
   * presses while live.enabled and live.slack are not both on, and the short
   * link's routes while rooms.short_link is off. Not given: off, as
   * Milestone 1 ships. A part switched off is quiet, whatever a stray
   * request made its row say.
   */
  parts: { slack?: boolean; shortLink?: boolean } = {},
): JobLine[] {
  return ROOM_JOBS.map(j => {
    const key = `${j.worker}:${j.job}`;
    const line = (tone: LineTone, text: string): JobLine => {
      // A red line ends with what to do, unless the job said it already.
      const full =
        tone === "bad" && !saysNextStep(text) ? `${text} ${j.fix}` : text;
      return { key, tone, text: full, say: monoTimes(full) };
    };
    if (key === "sales-live:slack" && parts.slack !== true)
      return line("quiet", `${j.what}: switched off.`);
    if (
      (key === "sales-live:go" || key === "sales-live:open") &&
      parts.shortLink !== true
    )
      return line("quiet", `${j.what}: switched off (the short link is off).`);
    const r = rows.find(x => x.worker === j.worker && x.job === j.job);
    if (!r) {
      if (j.staleS === null) return line("quiet", `${j.what}: no report yet.`);
      return line(roomsOn ? "bad" : "quiet", `${j.what} has not run yet.`);
    }
    const at = Date.parse(r.at);
    // A time nobody can read is never "working": it is said, in the owed colour.
    if (!Number.isFinite(at))
      return line(
        r.ok ? "owed" : "bad",
        `${j.what} reported at a time that cannot be read.`,
      );
    const when = clock(r.at);
    // The room worker that runs and reports a problem it rode out (a
    // database blip, a refused room message: desk/rooms.py ok false with
    // rooms made) is not down (m1 round 4,
    // team-page-worker-line-failed-while-making-rooms): owed, its own
    // words, and no "not being made" runbook. Red only for a fresh row that
    // says "Not making rooms:" or for a row gone stale (below).
    if (
      !r.ok &&
      key === "sales-desk:rooms" &&
      !String(r.detail ?? "").startsWith(NOT_MAKING_PREFIX) &&
      !(j.staleS !== null && now - at > j.staleS * 1000)
    )
      return line(
        "owed",
        `${j.what} reported a problem at ${when}${r.detail ? `: ${sentence(r.detail)}` : "."} If a room fails, make it on the other provider.`,
      );
    // The host check ran and found something not ready (a Zoom report it
    // could not read, Google slow or refusing the sign-in): its own words,
    // never the cron-line step for a check that is not running (m1 round 4,
    // host-check-ran-said-as-not-being-checked). Red only when it says rooms
    // cannot be made; a stale row still goes to the cron line (below).
    if (
      !r.ok &&
      key === "sales-desk:room-hosts" &&
      !(j.staleS !== null && now - at > j.staleS * 1000)
    ) {
      const text = `${j.what} ran at ${when} and found something to fix${r.detail ? `: ${sentence(r.detail)}` : "."}`;
      const bad = /cannot be made/i.test(String(r.detail ?? ""));
      return { key, tone: bad ? "bad" : "owed", text, say: monoTimes(text) };
    }
    // A room worker whose last row is old has stopped, whatever that row
    // said (the guardian and the watchdog read its age first too).
    if (
      key === "sales-desk:rooms" &&
      !r.ok &&
      j.staleS !== null &&
      now - at > j.staleS * 1000
    )
      return line(
        roomsOn ? "bad" : "owed",
        `${j.what} last ran at ${when}, later than it should.`,
      );
    if (!r.ok)
      return line(
        "bad",
        `${j.what} failed at ${when}${r.detail ? `: ${sentence(r.detail)}` : "."}`,
      );
    if (j.staleS !== null && now - at > j.staleS * 1000)
      return line(
        roomsOn ? "bad" : "owed",
        `${j.what} last ran at ${when}, later than it should.`,
      );
    return line(
      "good",
      `${j.what}: working, last at ${when}.${r.detail && j.staleS !== null ? ` ${sentence(r.detail)}` : ""}`,
    );
  });
}

/**
 * The card's head line: the health sentence, unless the jobs behind it
 * disagree. "Rooms: working" never sits above red jobs: the worst tone of
 * the two leads, and the sentence says how many jobs need attention.
 */
export function roomsSummary(
  health: Health,
  lines: readonly JobLine[],
): { tone: "good" | "owed" | "bad"; sentence: string | null } {
  const own = healthTone(health);
  const bad = lines.filter(l => l.tone === "bad").length;
  const owed = lines.filter(l => l.tone === "owed").length;
  if (own === "bad") return { tone: "bad", sentence: null };
  if (bad)
    return {
      tone: "bad",
      sentence: `Rooms make links, but ${bad} ${bad === 1 ? "job needs" : "jobs need"} attention.`,
    };
  if (own === "owed") return { tone: "owed", sentence: null };
  if (owed)
    return {
      tone: "owed",
      sentence: `Rooms make links; ${owed} ${owed === 1 ? "job is" : "jobs are"} late or unclear.`,
    };
  return { tone: "good", sentence: null };
}

/** A seat's row in cockpit_sales_room_hosts. */
export interface HostRow {
  email: string;
  zoom_status: ZoomStatus | null;
  zoom_live_until: string | null;
  google_ok: boolean | null;
  default_provider: Provider | null;
  checked_at: string | null;
}

const ZOOM_WORDS: Record<ZoomStatus, { tone: LineTone; text: string }> = {
  licensed: { tone: "good", text: "Zoom: ready" },
  // Works, with a limit someone has to keep in mind: owed, not green.
  basic: {
    tone: "owed",
    text: "Zoom: ready on Basic, so meetings end at 40 minutes",
  },
  pending: {
    tone: "owed",
    text: "Zoom: the seat is pending until Zoom's email invite is accepted",
  },
  missing: {
    tone: "bad",
    text: "Zoom: not set up on Mahara's account",
  },
};

/**
 * A seat's Zoom and Meet in two short lines, from the host check: "Zoom:
 * ready", "Meet: Google connected", and when it was checked. A seat with no
 * row has not been checked yet.
 */
export function seatRoomLines(
  h: HostRow | null | undefined,
  now: number,
): { zoom: { tone: LineTone; text: string }; meet: string; note: string } {
  if (!h)
    return {
      zoom: { tone: "quiet", text: "Zoom: not checked yet" },
      meet: "Meet: not checked yet",
      note: "The host check runs every 10 minutes once rooms are on.",
    };
  const zoom = h.zoom_status
    ? { ...ZOOM_WORDS[h.zoom_status] }
    : { tone: "quiet" as const, text: "Zoom: not checked yet" };
  const live = h.zoom_live_until ? Date.parse(h.zoom_live_until) : Number.NaN;
  // As the presence view reads it (20261004a): the meeting's own end ahead,
  // or a meeting the last host check saw live, for 15 minutes from it.
  const checked = h.checked_at ? Date.parse(h.checked_at) : Number.NaN;
  if (
    Number.isFinite(live) &&
    (live > now || (Number.isFinite(checked) && now - checked < 15 * 60_000))
  )
    zoom.text += ", in a meeting now";
  const meet =
    h.google_ok === true
      ? "Meet: Google connected"
      : h.google_ok === false
        ? "Meet: Google not connected"
        : "Meet: not checked yet";
  const bits = [
    h.default_provider
      ? `Rooms start on ${h.default_provider === "zoom" ? "Zoom" : "Meet"}`
      : null,
    h.checked_at ? `checked ${clock(h.checked_at)}` : "not checked yet",
  ].filter(Boolean);
  return { zoom, meet, note: `${bits.join(", ")}.` };
}

/** The `rooms` switches in one sentence for the card's head. */
export function switchesLine(
  s: {
    enabled: boolean;
    test_only: boolean;
    providers: Record<Provider, boolean>;
  } | null,
): string {
  if (!s) return "The video rooms setting could not be read.";
  if (!s.enabled) return "Video rooms are switched off.";
  const on = (["meet", "zoom"] as const)
    .filter(p => s.providers[p])
    .map(p => (p === "zoom" ? "Zoom" : "Meet"));
  const providers = on.length
    ? `${on.join(" and ")} ${on.length === 1 ? "is" : "are"} on`
    : "no provider is on, so no room can be made";
  return s.test_only
    ? `Video rooms are on for the test contact only; ${providers}.`
    : `Video rooms are on; ${providers}.`;
}
