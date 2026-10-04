/**
 * Backlog waves, the browser's half (P3 phase 1; the desk's NOTES sections
 * 1 and 4). The desk enrols each pool, drafts the day's openers from 09:00
 * Kuwait time on working days, and sends an approved batch one every
 * `batch_gap_s`. A manager starts, pauses, resumes and stops a wave; the
 * day's batch goes only once a person approves it. A tenth of each pool is
 * held back and never written to, so the wave's effect can be measured.
 *
 * Every count here is read from the members table, never estimated: a
 * pool's size is said only once the desk has enrolled it (the contract's
 * rule that wave copy shows no number before the pools are recounted).
 */
import { clock, KUWAIT } from "./format";

export const POOLS = [
  "no_show_cancelled",
  "good_intro",
  "unclosed_demo",
  "never_booked",
] as const;
export type Pool = (typeof POOLS)[number];

/** Each pool as a manager says it: the picker's label and the line's noun. */
export const POOL_WORDS: Record<Pool, { label: string; noun: string }> = {
  no_show_cancelled: {
    label: "No-shows and cancellations",
    noun: "no-shows and cancellations",
  },
  good_intro: {
    label: "Good intros, no demo",
    noun: "good intros with no demo",
  },
  unclosed_demo: { label: "Demos not closed", noun: "demos not closed" },
  never_booked: { label: "Never booked", noun: "leads never booked" },
};

export function isPool(v: unknown): v is Pool {
  return (POOLS as readonly unknown[]).includes(v);
}

export type WaveState = "draft" | "running" | "paused" | "done" | "cancelled";

export interface Wave {
  id: string;
  pool: Pool;
  state: WaveState;
  per_day: number;
  holdout_share: number;
  created_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  made_by: string | null;
  /** Set by the desk once every lead of the pool is in (contract v2 section 10). */
  enrolled_at: string | null;
  /** Why the wave ended, as a sentence (the desk's, or "Stopped by a manager."). */
  done_reason: string | null;
}

export interface MemberRow {
  wave_id: string;
  arm: "wave" | "holdout";
  state: string;
  /** The holdout's turn, or a wave member's turn when they were taken out at it (desk waves.py). */
  due_at?: string | null;
  sent_at?: string | null;
}

/**
 * A member is in its arm's comparison once their turn came (intent to treat
 * at the turn, desk waves.py _t0): the opener went, or due_at was set (the
 * turn, stamped once on both arms alike, which is where each member's 14
 * days start; a wave member taken out at their turn is watched like their
 * twins). A member a stopped wave let go of before their turn is in
 * neither arm, so the two arms compare like with like.
 */
export function measured(m: MemberRow): boolean {
  if (m.arm === "holdout")
    return Boolean(m.due_at) || m.state === "booked" || m.state === "closed";
  return (
    m.state === "sent" ||
    m.state === "replied" ||
    m.state === "booked" ||
    m.state === "closed" ||
    m.state === "done" ||
    (m.state === "excluded" && Boolean(m.due_at))
  );
}

const STATES: readonly WaveState[] = [
  "draft",
  "running",
  "paused",
  "done",
  "cancelled",
];

type Raw = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const time = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;

/** A wave row as the screen can draw it, or null when it is not one. */
export function readWave(v: unknown): Wave | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Raw;
  const id = text(r.id);
  if (!id || !isPool(r.pool)) return null;
  const n = (x: unknown, d: number) =>
    typeof x === "number" && Number.isFinite(x) ? x : Number(x) || d;
  return {
    id,
    pool: r.pool,
    state: (STATES as readonly unknown[]).includes(r.state)
      ? (r.state as WaveState)
      : "draft",
    per_day: n(r.per_day, 40),
    holdout_share: n(r.holdout_share, 0.1),
    created_at: time(r.created_at),
    started_at: time(r.started_at),
    ended_at: time(r.ended_at),
    made_by: text(r.made_by) ?? text(r.created_by),
    enrolled_at: time(r.enrolled_at),
    done_reason: text(r.done_reason) ?? text(r.note),
  };
}

export function isOpenWave(w: Pick<Wave, "state">): boolean {
  return w.state === "running" || w.state === "paused";
}

/** One wave's members, by arm and state. */
export interface WaveCounts {
  /** Everyone enrolled, both arms. */
  total: number;
  wave: number;
  holdout: number;
  /** Wave arm, still to be written to. */
  waiting: number;
  /** Wave arm, with an opener drafted and not yet sent. */
  drafted: number;
  /** Wave arm, the opener went (and whatever followed: replied, booked, closed). */
  messaged: number;
  /** Booked within the 14 days, by arm. */
  bookedWave: number;
  bookedHoldout: number;
  /** Members whose 14 days have run (booked or closed), by arm. */
  settledWave: number;
  settledHoldout: number;
  excluded: number;
  /** Members in each arm's comparison (their turn came): the effect's denominators. */
  measuredWave: number;
  measuredHoldout: number;
}

const EMPTY: WaveCounts = {
  total: 0,
  wave: 0,
  holdout: 0,
  waiting: 0,
  drafted: 0,
  messaged: 0,
  bookedWave: 0,
  bookedHoldout: 0,
  settledWave: 0,
  settledHoldout: 0,
  excluded: 0,
  measuredWave: 0,
  measuredHoldout: 0,
};

/** Counts per wave from the member rows (one read, every wave on screen). */
export function countMembers(
  rows: readonly MemberRow[],
): Map<string, WaveCounts> {
  const out = new Map<string, WaveCounts>();
  for (const m of rows) {
    const c = out.get(m.wave_id) ?? { ...EMPTY };
    out.set(m.wave_id, c);
    c.total += 1;
    const hold = m.arm === "holdout";
    if (hold) c.holdout += 1;
    else c.wave += 1;
    if (measured(m)) {
      if (hold) c.measuredHoldout += 1;
      else c.measuredWave += 1;
    }
    switch (m.state) {
      case "waiting":
        if (!hold) c.waiting += 1;
        break;
      case "drafted":
        if (!hold) c.drafted += 1;
        break;
      case "sent":
      case "replied":
        if (!hold) c.messaged += 1;
        break;
      case "booked":
        if (hold) {
          c.bookedHoldout += 1;
          c.settledHoldout += 1;
        } else {
          // A member taken out at their turn (sent_at null) had no opener.
          if (m.sent_at !== null) c.messaged += 1;
          c.bookedWave += 1;
          c.settledWave += 1;
        }
        break;
      case "closed":
      case "done":
        if (hold) c.settledHoldout += 1;
        else {
          if (m.sent_at !== null) c.messaged += 1;
          c.settledWave += 1;
        }
        break;
      case "excluded":
      case "failed":
        c.excluded += 1;
        break;
    }
  }
  return out;
}

export function countsFor(
  all: Map<string, WaveCounts>,
  waveId: string,
): WaveCounts {
  return all.get(waveId) ?? { ...EMPTY };
}

// ---------------------------------------------------------------------------
// When the next batch is written
// ---------------------------------------------------------------------------

const KUWAIT_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * When the desk writes the next batch: from `firstHour`:00 Kuwait time on
 * the next day that is not a day off (Friday unless `quiet_days` says
 * otherwise). Today counts when the hour has not come yet, or when it has
 * and today's batch is not written yet (the desk writes it within five
 * minutes); `now` is returned then.
 */
export function nextBatchAt(
  now: number,
  o: { firstHour?: number; daysOff?: readonly string[]; writtenToday: boolean },
): number {
  const first = Number.isFinite(o.firstHour) ? Number(o.firstHour) : 9;
  const off = new Set((o.daysOff ?? ["friday"]).map(d => d.toLowerCase()));
  const k = now + KUWAIT_MS;
  const midnight = k - (((k % DAY_MS) + DAY_MS) % DAY_MS);
  for (let d = 0; d < 8; d++) {
    const dayStart = midnight + d * DAY_MS;
    const weekday = WEEKDAYS[new Date(dayStart).getUTCDay()];
    if (off.has(weekday)) continue;
    const at = dayStart + first * 3_600_000 - KUWAIT_MS;
    if (d === 0) {
      if (now < at) return at;
      if (!o.writtenToday) return now;
      continue;
    }
    return at;
  }
  return now;
}

/** "today at 09:00", "tomorrow at 09:00", "on Sunday at 09:00". */
export function batchWhen(at: number, now: number): string {
  const day = (t: number) => Math.floor((t + KUWAIT_MS) / DAY_MS);
  const diff = day(at) - day(now);
  const hhmm = clock(new Date(at).toISOString());
  if (diff <= 0) return `today at ${hhmm}`;
  if (diff === 1) return `tomorrow at ${hhmm}`;
  const name = new Date(at).toLocaleDateString("en-GB", {
    timeZone: KUWAIT,
    weekday: "long",
  });
  return `on ${name} at ${hhmm}`;
}

// ---------------------------------------------------------------------------
// The lines a manager reads
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * P3's wave line: "438 no-shows and cancellations, 40 a day, newest first;
 * 44 held back to measure the effect. Next batch tomorrow at 09:00." Before
 * the desk has enrolled the pool it gives no number at all.
 */
export function waveLine(
  w: Wave,
  c: WaveCounts,
  next: { at: number; now: number } | null,
  /**
   * The waves job's own status row (sales-desk/waves): when it is not ok,
   * the line says what holds the batch (a shut gate, a spent budget, a
   * template not set up, an earlier batch nobody decided on) instead of
   * "being written now".
   */
  desk: { ok: boolean; detail: string | null } | null = null,
): string {
  const noun = POOL_WORDS[w.pool].noun;
  if (w.state === "done" || w.state === "cancelled") {
    const why = w.done_reason ? ` ${w.done_reason.replace(/\s+$/, "")}` : "";
    const ended = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}: ended${w.ended_at ? ` ${clock(w.ended_at)}` : ""}.`;
    return `${ended}${why}`.trim();
  }
  if (!c.total && !w.enrolled_at)
    return `${noun.charAt(0).toUpperCase()}${noun.slice(1)}, ${w.per_day} a day, newest first. The desk adds the pool's leads within 5 minutes; nothing is counted before then.`;
  const head = `${plural(c.total, "lead", "leads")} in ${noun}, ${w.per_day} a day, newest first; ${c.holdout.toLocaleString("en-US")} held back to measure the effect.`;
  if (w.state === "paused") return `${head} Paused: no batch is written.`;
  if (!next) return head;
  if (desk && !desk.ok) {
    const why = (desk.detail ?? "").trim().replace(/[.\s]+$/, "");
    return `${head} The wave run is held: ${why || "it reported a problem and gave no reason"}. Nothing is written or sent until that is fixed.`;
  }
  if (next.at <= next.now) return `${head} Today's batch is being written now.`;
  return `${head} Next batch ${batchWhen(next.at, next.now)}.`;
}

/**
 * The wave's effect (P3 section 9): the booking rate of everyone in the
 * wave arm minus everyone held back, both counting the leads that left the
 * wave (intention to treat), with its range. Read only once every lead in
 * the wave has had their turn: before that, most of the arm has not been
 * written to, and the two rates would compare nothing with nothing. Leads
 * still inside their 14 days can still book, so the line says it may move.
 */
export function effectLine(c: WaveCounts): string {
  const due = c.waiting + c.drafted;
  if (due > 0) {
    const had = c.wave - due;
    return `The effect is read once every lead in the wave has had their opener: ${had.toLocaleString("en-US")} of ${c.wave.toLocaleString("en-US")} so far. It is the wave's booking rate against the held-back leads', 14 days after each opener.`;
  }
  // Each arm over the members whose turn came: a stopped wave's leads whose
  // turn never came are in neither (like with like).
  const nWave = c.measuredWave;
  const nHold = c.measuredHoldout;
  if (nHold < 10 || nWave < 10)
    return "Too few leads to read the effect. It is the wave's booking rate against the held-back leads', 14 days after each opener.";
  const p1 = c.bookedWave / nWave;
  const p2 = c.bookedHoldout / nHold;
  const diff = p1 - p2;
  const se = Math.sqrt((p1 * (1 - p1)) / nWave + (p2 * (1 - p2)) / nHold);
  const pts = (x: number) => `${(x * 100).toFixed(1)}`;
  const pct = (n: number, d: number) =>
    `${n.toLocaleString("en-US")} of ${d.toLocaleString("en-US")} (${pts(n / d)}%)`;
  const open = c.settledWave < c.wave || c.settledHoldout < c.holdout;
  return `Booked: ${pct(c.bookedWave, nWave)} in the wave, ${pct(c.bookedHoldout, nHold)} held back. Difference ${pts(diff)} points, range ${pts(diff - 1.96 * se)} to ${pts(diff + 1.96 * se)}.${open ? " Leads still inside their 14 days can still book, so this moves." : ""}`;
}

// ---------------------------------------------------------------------------
// The day's batch
// ---------------------------------------------------------------------------

/** An opener in the batch, with what its meta row says. */
export interface BatchDraft {
  id: string;
  contact_id: string;
  wave_id: string | null;
  send_after: string | null;
  held_by: string | null;
  hold_reason: string | null;
  /** When held_by was written: tells a send in flight from one that stopped half way. */
  held_at?: string | null;
}

export type BatchState =
  | "undecided"
  | "approved"
  | "held"
  | "set_aside"
  | "sending"
  | "stalled";

/** sales-api's mark on an opener it is sending now (followupAgent.ts SENDING). */
export const SENDING_MARK = "sales-desk:sending";
/** A sending mark older than this is a send that stopped half way (followupAgent.ts SENDING_STALE_MS). */
export const SENDING_STALE_MS = 5 * 60_000;

/**
 * Where an opener stands: approved (it has a send time), going out now,
 * stopped half way through its send (Approve all sends it again), held by a
 * person, set aside by the desk after a refusal (it says why), or waiting
 * for a person to decide.
 */
export function batchState(
  d: BatchDraft,
  now: number = Date.now(),
): BatchState {
  if (d.held_by === "sales-desk") return "set_aside";
  if (d.held_by === SENDING_MARK) {
    const at = d.held_at ? Date.parse(d.held_at) : Number.NaN;
    return Number.isFinite(at) && now - at < SENDING_STALE_MS
      ? "sending"
      : "stalled";
  }
  if (d.held_by) return "held";
  if (d.send_after) return "approved";
  return "undecided";
}

/** At most this many openers go in one approval (followup.batch refuses more). */
export const BATCH_MAX = 40;

/** The openers "Approve all" sends: undecided ones and sends that stopped half way, oldest first, at most 40. */
export function toApprove(
  drafts: readonly BatchDraft[],
  now: number = Date.now(),
): string[] {
  return drafts
    .filter(d => ["undecided", "stalled"].includes(batchState(d, now)))
    .slice(0, BATCH_MAX)
    .map(d => d.id);
}

/**
 * "Approved. One goes every 45 seconds, finishing at 09:20." from
 * followup.batch's answer; the gap is the setting's when the answer has no
 * times.
 */
export function approvedLine(
  out: { count?: unknown; first_at?: unknown; last_at?: unknown },
  gapS: number,
): string {
  const n = typeof out.count === "number" ? out.count : null;
  const last = time(out.last_at);
  const gap = Math.round(gapS);
  if (n === 0) return "Nothing was approved: no opener was waiting.";
  if (n === 1) return "Approved. It goes in the next few minutes.";
  return `Approved. One goes every ${gap} seconds${last ? `, finishing at ${clock(last)}` : ""}.`;
}

/** `followups.waves` as the screens read it, with the desk's defaults. */
export function waveSettings(raw: unknown): {
  perDay: number;
  holdoutShare: number;
  gapS: number;
  firstHour: number;
  daysOff: string[];
} {
  const r =
    typeof raw === "object" && raw !== null ? (raw as Raw) : ({} as Raw);
  const w =
    typeof r.waves === "object" && r.waves !== null ? (r.waves as Raw) : {};
  const num = (v: unknown, d: number, lo: number, hi: number) => {
    const x = typeof v === "number" ? v : Number.NaN;
    return Number.isFinite(x) && x >= lo && x <= hi ? x : d;
  };
  const hours = Array.isArray(r.first_hours) ? r.first_hours : [];
  return {
    perDay: num(w.per_day, 40, 0, 200),
    holdoutShare: num(w.holdout_share, 0.1, 0, 0.5),
    gapS: num(w.batch_gap_s, 45, 30, 3600),
    firstHour: num(hours[0], 9, 0, 23),
    daysOff: Array.isArray(r.quiet_days)
      ? r.quiet_days.filter((d): d is string => typeof d === "string")
      : ["friday"],
  };
}

/** One WhatsApp message row as the Follow-ups page reads it. */
export interface WaSendRow {
  state: string;
  error: string | null;
  source?: string | null;
  created_at: string;
}

/**
 * One source's own WhatsApp pause (follow-ups, rooms), the rule sales-api
 * holds the desk's sends with (index.ts whatsappHealth({source}),
 * sendrules.ts healthCfg and sourceHealth): its last `window` settled sends
 * (20) from the last day, or from a manager's "Clear the pause"
 * (whatsapp_guard.health_cleared_at), paused when at least `min_sends` (5)
 * went and a `fail_share` (30%) of them failed.
 */
export function sourcePause(
  rows: readonly WaSendRow[],
  guard: unknown,
  source: string,
  now: number,
): { paused: boolean; sent: number; failed: number; reason: string | null } {
  const g = (
    typeof guard === "object" && guard !== null ? guard : {}
  ) as Record<string, unknown>;
  const health = (
    typeof g.health === "object" && g.health !== null ? g.health : {}
  ) as Record<string, unknown>;
  const per = (
    typeof health[source] === "object" && health[source] !== null
      ? health[source]
      : {}
  ) as Record<string, unknown>;
  const num = (v: unknown, d: number, lo: number, hi: number) => {
    const x = Number(v);
    return v !== undefined &&
      v !== null &&
      Number.isFinite(x) &&
      x >= lo &&
      x <= hi
      ? x
      : d;
  };
  const window = Math.round(num(per.window, 20, 1, 1000));
  const share = num(per.fail_share, 0.3, 0.01, 1);
  const min = Math.round(num(per.min_sends ?? g.pause_min_sends, 5, 1, 1000));
  const cleared = Date.parse(String(g.health_cleared_at ?? ""));
  const floor = Math.max(
    now - 86_400_000,
    Number.isFinite(cleared) ? cleared : 0,
  );
  const last = rows
    .filter(
      r =>
        r.source === source &&
        ["sent", "delivered", "read", "failed"].includes(r.state) &&
        Date.parse(r.created_at) >= floor,
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, window);
  const failed = last.filter(r => r.state === "failed");
  return {
    paused: last.length >= min && failed.length / last.length >= share,
    sent: last.length,
    failed: failed.length,
    reason: failed.map(r => r.error).find(Boolean) ?? null,
  };
}

/**
 * The follow-up agent's switch, read as sales-api and the desk read it
 * (sendrules.ts agentOff): set to anything but on (false, null, 0) is off;
 * no value at all is on.
 */
export function agentOff(settings: object | null | undefined): boolean {
  if (!settings) return false;
  return "enabled" in settings && !(settings as { enabled?: unknown }).enabled;
}
