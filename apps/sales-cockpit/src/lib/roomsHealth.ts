/**
 * The Team page's video rooms card, in words: the jobs that keep rooms
 * working (contract v2 sections 7 and 10: the room worker, the host check,
 * and the five `sales-live` routes), and each seat's Zoom and Meet.
 *
 * Missing is never zero: a job that has not reported says so, and a seat
 * nobody has checked yet is "not checked", never "not set up".
 */
import { clock } from "./format";
import type { Provider, ZoomStatus } from "./rooms";

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
}

/**
 * The rows the watchdog reads (contract v2 section 10, item 8): the room
 * worker red at 90 s, the host check at 20 minutes, and the door's five
 * routes, which report on use and count only when they fail.
 */
export const ROOM_JOBS: readonly RoomJob[] = [
  { worker: "sales-desk", job: "rooms", what: "The room worker", staleS: 90 },
  {
    worker: "sales-desk",
    job: "room-hosts",
    what: "The Zoom and Google check",
    staleS: 20 * 60,
  },
  {
    worker: "sales-live",
    job: "zoom",
    what: "Zoom's meeting events",
    staleS: null,
  },
  { worker: "sales-live", job: "go", what: "The short link", staleS: null },
  { worker: "sales-live", job: "open", what: "Link opens", staleS: null },
  { worker: "sales-live", job: "slack", what: "Slack presses", staleS: null },
  {
    worker: "sales-live",
    job: "cron",
    what: "The minute sweep's posts",
    staleS: null,
  },
];

export type LineTone = "good" | "owed" | "bad" | "quiet";

export interface JobLine {
  key: string;
  tone: LineTone;
  text: string;
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
): JobLine[] {
  return ROOM_JOBS.map(j => {
    const key = `${j.worker}:${j.job}`;
    const r = rows.find(x => x.worker === j.worker && x.job === j.job);
    if (!r) {
      if (j.staleS === null)
        return { key, tone: "quiet", text: `${j.what}: no report yet.` };
      return {
        key,
        tone: roomsOn ? "bad" : "quiet",
        text: `${j.what} has not run yet.`,
      };
    }
    const at = Date.parse(r.at);
    const when = clock(r.at);
    if (!r.ok)
      return {
        key,
        tone: "bad",
        text: `${j.what} failed at ${when}${r.detail ? `: ${sentence(r.detail)}` : "."}`,
      };
    if (j.staleS !== null && Number.isFinite(at) && now - at > j.staleS * 1000)
      return {
        key,
        tone: roomsOn ? "bad" : "owed",
        text: `${j.what} last ran at ${when}, later than it should.`,
      };
    return {
      key,
      tone: "good",
      text: `${j.what}: working, last at ${when}.${r.detail && j.staleS !== null ? ` ${sentence(r.detail)}` : ""}`,
    };
  });
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
  basic: {
    tone: "good",
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
  if (Number.isFinite(live) && live > now) zoom.text += ", in a meeting now";
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
