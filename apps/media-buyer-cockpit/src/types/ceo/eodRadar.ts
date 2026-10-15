/**
 * EOD Radar on the Management tab (2026-10-15): what
 * `cockpit_eod_radar_read(p_from, p_to)` answers (migration
 * 20261015210000_eod_radar.sql), as the screen trusts it. The rows are
 * written by the Edge Function eod-radar every 30 minutes from the five Slack
 * EOD channels and the cockpit's sent EODs.
 */

export type EodStatus =
  | "on_time"
  | "late"
  | "missed"
  | "pending"
  | "leave"
  | "off"
  | "not_read";
export type EodCredit =
  | "poster"
  | "submitted_by"
  | "name_line"
  | "cockpit_outbox";

export type EodDay = {
  day: string;
  status: EodStatus;
  /** When the EOD was filed or posted (ISO), for on_time and late. */
  postedAt: string | null;
  lateMinutes: number | null;
  creditedBy: EodCredit | null;
  words: number | null;
  /** The old radar's "lazy" rule as a note: under 50 words, or no wins, blockers or plan. Never a strike. */
  quality: string | null;
  note: string | null;
  slackTs: string | null;
  postedChannel: string | null;
  posts: number;
};

export type EodPerson = {
  personId: number;
  name: string;
  role: string | null;
  active: boolean;
  channel: string | null;
  channelName: string | null;
  /** The radar has the person's Slack id (their own posts can be found). */
  slackLinked: boolean;
  days: EodDay[];
};

export type EodChannelRead = {
  id: string;
  name: string;
  ok: boolean;
  error: string | null;
  posts: number | null;
};

export type EodRadarSettings = {
  digestOn: boolean;
  remindersOn: boolean;
  strikesOn: boolean;
  lateAt: string;
  closeoutAt: string;
  digestChannelName: string;
  lookbackDays: number;
};

export type EodRadarBoard = {
  now: string;
  /** Today's EOD working day (Kuwait time minus 4 hours). */
  today: string;
  from: string;
  to: string;
  settings: EodRadarSettings;
  /** The last run (sync-state row eod-radar); null before the first. */
  sync: {
    lastRunAt: string | null;
    lastOkAt: string | null;
    ok: boolean;
    note: string | null;
    channels: EodChannelRead[];
    unmatched: { channel: string; name: string | null; reason: string }[];
    /** Scopes the run needs that the Slack token lacks; null when Slack did not say. */
    missingScopes: string[] | null;
  } | null;
  /** The half-hour job (sync-state row eod-radar-kick). */
  kick: { lastRunAt: string | null; ok: boolean; note: string | null } | null;
  people: EodPerson[];
  /** Active people whose role has no EOD channel. */
  notTracked: { personId: number; name: string; role: string | null }[];
  /** The last closeout posts, newest first. */
  digests: {
    day: string;
    state: string;
    slackTs: string | null;
    error: string | null;
    finishedAt: string | null;
  }[];
};
