/**
 * Every decision Hubstaff watch makes (SPEC.md "The three alerts", "When
 * someone is on shift", "source"). Pure: no I/O, `now` is passed in. Given
 * the people on the watch list, what Hubstaff said this run, the screenshots
 * and their verdicts, and the incidents already open, it returns the status
 * rows, the 10-minute slots, and which incidents to open, touch and close.
 *
 * The rules that keep it honest:
 * - Missing is never zero. When Hubstaff could not be read, the source
 *   incident opens and no person incident opens or closes on that missing
 *   data; only the end of a shift (a fact of the schedule) still closes one.
 * - A screenshot the model could not judge (error), one not judged yet
 *   (pending) or one the check skipped never counts as not work, and never
 *   proves work either. `unclear` never counts.
 * - At most one open incident per (person, kind). A kind closed in this run
 *   opens again only on a later run, as a new incident.
 * - One break a day (Hours' rule): on a shift longer than
 *   breakWhenLongerThanHours, the first stop after the person has tracked
 *   waits max(notTrackingMinutes, breakMinutes + graceMinutes); later stops
 *   wait notTrackingMinutes. Off time counts from max(last activity, shift start).
 * - Idle is keyboard and mouse over input-tracked time (phone and web timer
 *   time has no activity level), judged on finished 10-minute blocks only
 *   (the window ends at the last block finished before now - 20 min). It
 *   opens under the floor with at least 20 minutes on the computer, clears
 *   only 5 points above it, and closes as not judged only under 10 minutes,
 *   so neither a share nor a block length hovering at a line flaps.
 * - The idle and not-work windows never reach before the shift starts.
 * - While a person is stopped inside the day's break wait, they are on_break
 *   (since they stopped): no alert, not a problem on the card.
 * - Part-day leave (person.leave) is off time: off time never counts from
 *   before a window's end, no not_tracking opens inside one (the status is
 *   on_leave), and the idle and not-work windows skip it.
 * - "Not in Hubstaff" stays open across shifts: one post, not one a day. It
 *   closes when an account is linked, or as not_watched once the person is
 *   no longer employed or is paused.
 * - The source alert waits until Hubstaff has not been read in an ok run for
 *   10 minutes, so one blip posts nothing; person alerts freeze at once.
 */
import {
  type BreakRules, DEFAULT_BREAK_RULES, type Kind, type KnownShot, leaveAt, type LeaveWindow, onShift, type OpenIncident, type Verdict, type WatchPerson, type WatchSettings,
} from "./inputs.ts";
import {
  activeAgainText, backOnText, idleText, idleUnjudgedText, kuwaitDay, linkedText, noAccountText, notTrackingText, notWatchedText, notWorkText,
  shiftEndedOffText, shiftEndedText, sourceBackText, sourceText, workAgainText,
} from "./text.ts";

/** Hubstaff's activity data lags up to 20 minutes (its docs): the idle window ends this far back. */
export const ACTIVITY_LAG_MS = 20 * 60_000;
/** The idle window must hold at least this much input-tracked time to open the alert. */
export const IDLE_MIN_TRACKED_S = 20 * 60;
/** An open idle alert closes as not judged only when the window holds less input-tracked time than this. */
export const IDLE_KEEP_TRACKED_S = 10 * 60;
/** An open idle alert clears only this many points above the floor (hysteresis). */
export const IDLE_CLEAR_MARGIN_PCT = 5;
/** The source alert opens only when no ok run has read Hubstaff for this long. */
export const SOURCE_AFTER_MS = 10 * 60_000;
/** A screenshot the model failed on is tried this many times in all. */
export const MAX_ATTEMPTS = 3;
/** New screenshots classified per run, oldest first. */
export const SHOTS_PER_RUN = 12;
const SLOT_MS = 10 * 60_000;

export type State = "tracking" | "not_tracking" | "on_break" | "idle" | "not_work" | "off_shift" | "on_leave" | "holiday" | "no_account" | "cant_tell";

/** One 10-minute block. inputTracked is the time tracked with keyboard and mouse (the computer app); phone and web timer time has none. */
export type ActivityRecord = { userId: string; slotStart: string; tracked: number; inputTracked: number; overall: number; idle: boolean };
export type LastActivity = { online: boolean | null; lastClientActivity: string | null };
export type Readings =
  | { ok: true; lastActivities: Map<string, LastActivity>; activities: ActivityRecord[]; screenshotsOn: Map<string, boolean> | null; readAt?: string }
  | { ok: false; note: string };
export type ShotFact = { shotId: number; personId: number | null; recordedAt: string | null; verdict: Verdict; confidence: number | null; label: string | null };

export type StatusRow = {
  personId: number;
  state: State;
  since: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  online: boolean | null;
  lastActivityAt: string | null;
  trackedTodayS: number | null;
  activePct30m: number | null;
  screenshotsOn: boolean | null;
  detail: Record<string, unknown>;
};
/** One block of the shift line; inputTrackedS is its keyboard-and-mouse time (the rest is phone or web timer time). */
export type SlotRow = { personId: number; slotStart: string; trackedS: number; inputTrackedS: number; overallS: number; idle: boolean };
export type NewIncident = { personId: number | null; kind: Kind; detail: Record<string, unknown> };
export type UpdateRow = { id: number; detail: Record<string, unknown> };
export type CloseRow = { id: number; closeReason: string; detail: Record<string, unknown> };

export type RulesInput<S = unknown> = {
  now: Date;
  settings: WatchSettings;
  people: WatchPerson[];
  open: OpenIncident[];
  readings: Readings;
  /** Every screenshot known with its verdict: earlier runs' and this run's. */
  shots: ShotFact[];
  /** The screenshot rows this run writes, passed through to the plan. */
  shotRows?: S[];
  /** Hours' break rule; 60 minutes past 6 hours when absent. */
  rules?: BreakRules;
  /** When an ok run last read Hubstaff; null or absent counts as long ago. */
  lastOkRunAt?: string | null;
};
export type Decision<S = unknown> = {
  statuses: StatusRow[];
  slots: SlotRow[];
  shots: S[];
  open: NewIncident[];
  update: UpdateRow[];
  close: CloseRow[];
  onShift: number;
  note: string;
};

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
/** A percentage as stored in a detail: rounded down to two decimals, so every reader that rounds down agrees with the sentence. */
const pct2 = (pct: number) => Math.floor(pct * 100 + 1e-9) / 100;
const inLeave = (leave: LeaveWindow[], ms: number) => leave.some(w => at(w.start) <= ms && ms < at(w.end));
/** How much of [from, to) falls inside leave windows. */
function leaveOverlap(leave: LeaveWindow[], from: number, to: number): number {
  let n = 0;
  for (const w of leave) n += Math.max(0, Math.min(to, at(w.end)) - Math.max(from, at(w.start)));
  return n;
}
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const COUNTED: Verdict[] = ["work", "not_work", "unclear"];
const UNDECIDED: Verdict[] = ["pending", "error", "skipped"];

/** Is this screenshot still owed a verdict? New, pending, skipped, or failed fewer than 3 times. */
export function needsVerdict(known: KnownShot | undefined): boolean {
  if (!known) return true;
  if (known.verdict === "pending" || known.verdict === "skipped") return true;
  return known.verdict === "error" && known.attempts < MAX_ATTEMPTS;
}

/** The screenshots to send to the model this run: owed a verdict, oldest first, at most SHOTS_PER_RUN. */
export function pickShots<T extends { id: number; recordedAt: string }>(screens: T[], known: Map<number, KnownShot>, limit = SHOTS_PER_RUN): T[] {
  return screens.filter(s => needsVerdict(known.get(s.id))).sort((a, b) => at(a.recordedAt) - at(b.recordedAt) || a.id - b.id).slice(0, limit);
}

/** The slot a time falls in (Hubstaff's 10-minute blocks start on the 10 minutes, UTC). */
export function slotOf(ms: number): string {
  return iso(Math.floor(ms / SLOT_MS) * SLOT_MS);
}

type Sum = { tracked: number; input: number; overall: number; first: number | null };
/** The blocks starting in [from, to), leaving out any that start inside a leave window. */
function sumWindow(records: ActivityRecord[], from: number, to: number, leave: LeaveWindow[] = []): Sum {
  const out: Sum = { tracked: 0, input: 0, overall: 0, first: null };
  for (const r of records) {
    const t = at(r.slotStart);
    if (t < from || t >= to || inLeave(leave, t)) continue;
    out.tracked += r.tracked;
    out.input += r.inputTracked;
    out.overall += r.overall;
    if (r.tracked > 0 && (out.first === null || t < out.first)) out.first = t;
  }
  return out;
}

/** The start of the latest run of tracked slots with no gap longer than one slot. */
function trackingSince(records: ActivityRecord[]): string | null {
  const slots = [...new Set(records.filter(r => r.tracked > 0).map(r => at(r.slotStart)))].sort((a, b) => b - a);
  if (!slots.length) return null;
  let start = slots[0];
  for (const t of slots.slice(1)) {
    if (start - t > SLOT_MS) break;
    start = t;
  }
  return iso(start);
}

/**
 * Before `before`, inside the shift: has the person tracked at all, and was
 * there already an untracked stretch of at least `minMs` after their first
 * tracked block (the day's break, from the 10-minute blocks)? Leave inside a
 * stretch is not part of it.
 */
function earlierStops(records: ActivityRecord[], shiftStart: number, before: number, minMs: number, leave: LeaveWindow[] = []): { tracked: boolean; stopped: boolean } {
  const slots = [...new Set(records.filter(r => r.tracked > 0).map(r => at(r.slotStart)))]
    .filter(t => t + SLOT_MS > shiftStart && t < before).sort((a, b) => a - b);
  let stopped = false;
  for (let i = 1; i < slots.length; i++) {
    const from = slots[i - 1] + SLOT_MS;
    if (slots[i] - from - leaveOverlap(leave, from, slots[i]) >= minMs) stopped = true;
  }
  return { tracked: slots.length > 0, stopped };
}

/** The Hubstaff user to watch: none when the account is only invited (pending) or removed. */
export function watchedUserId(p: Pick<WatchPerson, "hubstaffUserId" | "accountStatus">): string | null {
  return /pending|invit|removed/i.test(p.accountStatus ?? "") ? null : p.hubstaffUserId;
}

/** A "not in Hubstaff" alert (not_tracking with reason no_account). */
export const isNoAccount = (inc: Pick<OpenIncident, "kind" | "detail">) => inc.kind === "not_tracking" && inc.detail.reason === "no_account";
const noAccount = isNoAccount;

export function decide<S = unknown>(input: RulesInput<S>): Decision<S> {
  const { now, settings: cfg, readings } = input;
  const rules = input.rules ?? DEFAULT_BREAK_RULES;
  const nowMs = now.getTime();
  const nowIso = iso(nowMs);
  const out: Decision<S> = { statuses: [], slots: [], shots: input.shotRows ?? [], open: [], update: [], close: [], onShift: 0, note: "" };
  const open = new Map<string, OpenIncident>();
  for (const inc of input.open) {
    const key = `${inc.personId ?? 0}:${inc.kind}`;
    if (!open.has(key)) open.set(key, inc);
  }
  const closedNow = new Set<string>();
  const close = (inc: OpenIncident, closeReason: string, resolveText: string, extra: Record<string, unknown> = {}) => {
    out.close.push({ id: inc.id, closeReason, detail: { ...inc.detail, ...extra, resolvedAt: nowIso, resolveText } });
    closedNow.add(`${inc.personId ?? 0}:${inc.kind}`);
    open.delete(`${inc.personId ?? 0}:${inc.kind}`);
  };
  const raise = (personId: number | null, kind: Kind, detail: Record<string, unknown>) => {
    const key = `${personId ?? 0}:${kind}`;
    if (open.has(key) || closedNow.has(key)) return;
    out.open.push({ personId, kind, detail });
  };
  const touch = (inc: OpenIncident, detail: Record<string, unknown> = {}) => out.update.push({ id: inc.id, detail: { ...inc.detail, ...detail } });

  // ------------------------------------------------------------------ source
  const source = open.get("0:source");
  if (!readings.ok) {
    const note = readings.note.slice(0, 200);
    const lastOk = input.lastOkRunAt ? at(input.lastOkRunAt) : Number.NaN;
    if (source) touch(source, { note });
    else if (!Number.isFinite(lastOk) || nowMs - lastOk >= SOURCE_AFTER_MS) raise(null, "source", { note, text: sourceText(note) });
  } else if (source) close(source, "read_ok", sourceBackText());

  // People no longer on the watch list: their open alerts close.
  const listed = new Set(input.people.map(p => p.personId));
  for (const inc of [...open.values()])
    if (inc.personId !== null && !listed.has(inc.personId)) close(inc, "not_watched", notWatchedText());

  const records = new Map<string, ActivityRecord[]>();
  if (readings.ok) for (const r of readings.activities) {
    const list = records.get(r.userId) ?? [];
    list.push(r);
    records.set(r.userId, list);
  }
  const shotsOf = new Map<number, ShotFact[]>();
  for (const s of input.shots) {
    if (s.personId === null || !s.recordedAt) continue;
    const list = shotsOf.get(s.personId) ?? [];
    list.push(s);
    shotsOf.set(s.personId, list);
  }
  const dayStart = at(`${kuwaitDay(now)}T00:00:00Z`) - 3 * 3600_000;
  const opened: string[] = [];

  for (const p of input.people) {
    const on = onShift(p, now);
    if (on) out.onShift += 1;
    const mine = (["not_tracking", "not_work", "idle"] as Kind[]).map(k => open.get(`${p.personId}:${k}`)).filter((x): x is OpenIncident => !!x);

    const uid = watchedUserId(p);

    // "Not in Hubstaff" closes only when an account is linked, or as no longer
    // watched once the person has left or is paused (facts of the inputs, on
    // shift or not); the shift ending never closes it.
    const gone = p.offReason === "not_employed" || p.offReason === "paused";
    for (const inc of mine) {
      if (!noAccount(inc)) continue;
      if (gone) close(inc, "not_watched", notWatchedText());
      else if (uid) close(inc, "linked", linkedText({ at: nowIso }));
    }

    // The shift ended (or the person is off today, or this is a new day's
    // shift): every other open alert of theirs closes, whatever Hubstaff said.
    for (const inc of mine) {
      if (noAccount(inc)) continue;
      const stale = p.shift && on && at(inc.openedAt) < at(p.shift.start);
      if (on && !stale) continue;
      const end = str(inc.detail.shiftEnd) ?? (p.shift && !stale ? p.shift.end : null);
      const endIso = end && at(end) < nowMs ? end : nowIso;
      if (inc.kind === "not_tracking" && inc.detail.reason !== "no_account")
        close(inc, "shift_ended", shiftEndedOffText({ since: str(inc.detail.since) ?? inc.openedAt, shiftEnd: endIso }), { shiftEndedAt: endIso });
      else close(inc, "shift_ended", shiftEndedText({ shiftEnd: endIso }), { shiftEndedAt: endIso });
    }

    const recs = uid ? records.get(uid) ?? [] : [];
    const leave = p.leave ?? [];
    // Now inside part-day leave: off, whatever Hubstaff says.
    const leaveNow = on ? leaveAt(p, nowMs) : null;
    const la: LastActivity | null = readings.ok && uid ? readings.lastActivities.get(uid) ?? { online: false, lastClientActivity: null } : null;
    const status: StatusRow = {
      personId: p.personId, state: "off_shift", since: null, shiftStart: p.shift?.start ?? null, shiftEnd: p.shift?.end ?? null,
      online: la?.online ?? null, lastActivityAt: la?.lastClientActivity ?? null,
      trackedTodayS: readings.ok && uid ? recs.filter(r => at(r.slotStart) >= dayStart).reduce((n, r) => n + r.tracked, 0) : null,
      activePct30m: null,
      screenshotsOn: (readings.ok && uid ? readings.screenshotsOn?.get(uid) : undefined) ?? p.screenshotsOn,
      detail: { offReason: p.offReason },
    };
    if (readings.ok && uid) {
      // Blocks after readAt - 20 min may not be in Hubstaff yet: the screen shows them as unread, never as a gap.
      status.detail = { ...status.detail, readAt: readings.readAt ?? nowIso };
      const last30 = sumWindow(recs, nowMs - ACTIVITY_LAG_MS - 30 * 60_000, nowMs - ACTIVITY_LAG_MS, leave);
      // Unrounded: the database keeps two decimals, and every sentence and the card round down.
      status.activePct30m = last30.input > 0 ? (last30.overall / last30.input) * 100 : null;
    }
    if (readings.ok && uid) {
      // The shift line: today's 10-minute blocks.
      const bySlot = new Map<string, SlotRow>();
        for (const r of recs) {
        const row = bySlot.get(r.slotStart) ?? { personId: p.personId, slotStart: r.slotStart, trackedS: 0, inputTrackedS: 0, overallS: 0, idle: false };
        row.trackedS += r.tracked;
        row.inputTrackedS += r.inputTracked;
        row.overallS += r.overall;
        row.idle = row.idle || r.idle;
        bySlot.set(r.slotStart, row);
      }
      for (const row of bySlot.values()) {
        // Idle on the shift line by keyboard and mouse over input-tracked time; phone or web timer time is never idle.
        if (row.inputTrackedS >= 60 && row.overallS * 100 < row.inputTrackedS * cfg.idleFloorPct) row.idle = true;
        out.slots.push(row);
      }
    }

    if (!on) {
      status.state = p.offReason === "holiday" ? "holiday" : p.offReason === "leave" ? "on_leave" : "off_shift";
      out.statuses.push(status);
      continue;
    }
    const shift = p.shift!;
    const pastGrace = nowMs >= at(shift.start) + cfg.graceMinutes * 60_000;
    const nt = open.get(`${p.personId}:not_tracking`);
    const nw = open.get(`${p.personId}:not_work`);
    const idle = open.get(`${p.personId}:idle`);

    if (!uid) {
      status.state = leaveNow ? "on_leave" : "no_account";
      status.since = leaveNow?.start ?? null;
      status.detail = { ...status.detail, accountStatus: p.accountStatus };
      if (readings.ok) {
        if (nt && noAccount(nt)) touch(nt);
        // Inside part-day leave no "not in Hubstaff" opens either.
        else if (!nt && pastGrace && !leaveNow) {
          const invited = /invit|pending/i.test(p.accountStatus ?? "");
          raise(p.personId, "not_tracking", {
            reason: "no_account", invited, shiftStart: shift.start, shiftEnd: shift.end,
            text: noAccountText({ name: p.name, role: p.role, invited }),
          });
        }
      }
      out.statuses.push(status);
      continue;
    }
    if (!readings.ok) {
      status.state = leaveNow ? "on_leave" : "cant_tell";
      status.since = leaveNow?.start ?? null;
      status.detail = { ...status.detail, note: readings.note.slice(0, 200) };
      out.statuses.push(status);
      continue;
    }

    // ------------------------------------------------------------ not_tracking
    const lca = la!.lastClientActivity;
    const age = lca ? nowMs - at(lca) : Number.POSITIVE_INFINITY;
    const threshold = cfg.notTrackingMinutes * 60_000;
    // Off for the threshold or longer is not running (so 30 minutes off alerts at 30, not at 35).
    const running = la!.online === true || (lca !== null && age < threshold);
    const notRunning = la!.online === false && (lca === null || age >= threshold);
    // Off time counts from the latest of the last activity, the shift start and the end of any leave
    // window already over, so a late start alerts at start + threshold and a return from leave at its end + threshold.
    const lastActive = lca && at(lca) > at(shift.start) ? at(lca) : null;
    const offSinceMs = Math.max(lastActive ?? at(shift.start), ...leave.map(w => at(w.end)).filter(end => end <= nowMs));
    const offSince = iso(offSinceMs);
    // Off since a leave window ended: due back then, so the wait is the threshold, never the break.
    const backFromLeave = offSinceMs > (lastActive ?? at(shift.start));
    // The day's one break: a long shift, already tracked in it, and no earlier stop of the threshold or longer.
    const prior = earlierStops(recs, at(shift.start), offSinceMs, threshold, leave);
    const breakAllowed = at(shift.end) - at(shift.start) > rules.breakWhenLongerThanHours * 3600_000
      && (prior.tracked || lastActive !== null) && !prior.stopped && !backFromLeave;
    const wait = breakAllowed ? Math.max(threshold, (rules.breakMinutes + cfg.graceMinutes) * 60_000) : threshold;
    const offLongEnough = nowMs - offSinceMs >= wait;
    if (nt) {
      if (running) close(nt, "back", backOnText({ at: nowIso, since: str(nt.detail.since) ?? nt.openedAt }), { backAt: nowIso });
      else touch(nt, { lastActivityAt: lca });
    } else if (notRunning && pastGrace && offLongEnough && !leaveNow) {
      raise(p.personId, "not_tracking", {
        reason: "off", since: offSince, lastActivityAt: lca, shiftStart: shift.start, shiftEnd: shift.end,
        text: notTrackingText({ name: p.name, role: p.role, since: offSince, shiftStart: shift.start, shiftEnd: shift.end, now: nowIso }),
      });
    }

    // -------------------------------------------------------------------- idle
    // Keyboard and mouse over input-tracked time, on finished blocks only: the window ends at the last
    // 10-minute block finished before now - 20 min (Hubstaff's lag), never reaches before the shift
    // starts, and skips leave.
    const winEnd = Math.max(Math.floor((nowMs - ACTIVITY_LAG_MS) / SLOT_MS) * SLOT_MS, at(shift.start));
    const winStart = Math.max(winEnd - cfg.idleMinutes * 60_000, at(shift.start));
    const w = winEnd > winStart ? sumWindow(recs, winStart, winEnd, leave) : { tracked: 0, input: 0, overall: 0, first: null };
    // Opens with 20 minutes on the computer; once open it is still judged down to 10, so a window hovering at 20 never flaps.
    const judged = w.input >= IDLE_MIN_TRACKED_S;
    const kept = w.input >= IDLE_KEEP_TRACKED_S;
    const pct = kept ? (w.overall / w.input) * 100 : null;
    const below = judged && w.overall * 100 < w.input * cfg.idleFloorPct;
    const recovered = kept && w.overall * 100 >= w.input * (cfg.idleFloorPct + IDLE_CLEAR_MARGIN_PCT);
    const windowNote = { windowStart: iso(winStart), windowEnd: iso(winEnd), trackedS: w.tracked, inputTrackedS: w.input, overallS: w.overall };
    if (idle) {
      if (recovered) close(idle, "active", activeAgainText({ floorPct: cfg.idleFloorPct, at: nowIso }), { ...windowNote, pct: pct2(pct!) });
      else if (!kept) close(idle, "not_judged", idleUnjudgedText({ at: nowIso }), windowNote);
      else touch(idle, { ...windowNote, pct: pct2(pct!) });
    } else if (below) {
      const since = iso(w.first ?? winStart);
      raise(p.personId, "idle", { ...windowNote, since, pct: pct2(pct!), floorPct: cfg.idleFloorPct, text: idleText({ name: p.name, role: p.role, since, pct: pct! }) });
    }

    // ---------------------------------------------------------------- not_work
    // Screenshots reach Hubstaff up to 20 minutes late, so the look-back is the
    // window plus that lag; an alert needs the screenshots inside one window's span.
    const from = Math.max(nowMs - ACTIVITY_LAG_MS - cfg.windowMinutes * 60_000, at(shift.start));
    const inWindow = (shotsOf.get(p.personId) ?? []).filter(s => at(s.recordedAt!) >= from && at(s.recordedAt!) <= nowMs && !inLeave(leave, at(s.recordedAt!)))
      .sort((a, b) => at(b.recordedAt!) - at(a.recordedAt!));
    const counting = inWindow.filter(s => s.verdict === "not_work" && s.confidence !== null && s.confidence >= cfg.minConfidence);
    const anyNotWork = inWindow.filter(s => s.verdict === "not_work");
    const undecided = inWindow.some(s => UNDECIDED.includes(s.verdict));
    const judgedShots = inWindow.filter(s => COUNTED.includes(s.verdict));
    const latestNotWork = anyNotWork[0]?.recordedAt ?? null;
    if (nw) {
      const last = [str(nw.detail.lastNotWorkAt), latestNotWork].filter((x): x is string => !!x).sort().pop() ?? nw.openedAt;
      if (!anyNotWork.length && !undecided) close(nw, "work", workAgainText({ lastNotWorkAt: last }), { lastNotWorkAt: last });
      else touch(nw, { lastNotWorkAt: last });
    } else if (withinOneWindow(counting, cfg.nonWorkShots, cfg.windowMinutes * 60_000)) {
      const labels = [...new Set(counting.map(s => s.label).filter((l): l is string => !!l))].slice(0, 3);
      raise(p.personId, "not_work", {
        count: counting.length, total: judgedShots.length, labels, shotIds: counting.map(s => s.shotId), lastNotWorkAt: latestNotWork,
        firstNotWorkAt: counting[counting.length - 1].recordedAt,
        text: notWorkText({ name: p.name, role: p.role, count: counting.length, total: judgedShots.length, labels }),
      });
    }

    // ------------------------------------------------------------------ status
    const isOpen = (k: Kind) => open.has(`${p.personId}:${k}`) || out.open.some(o => o.personId === p.personId && o.kind === k);
    if (isOpen("not_work")) {
      status.state = "not_work";
      const inc = open.get(`${p.personId}:not_work`);
      status.since = inc ? str(inc.detail.firstNotWorkAt) ?? inc.openedAt : counting[counting.length - 1]?.recordedAt ?? nowIso;
    } else if (leaveNow && !running) {
      status.state = "on_leave";
      status.since = leaveNow.start;
    } else if (notRunning) {
      // Inside the day's break wait (no alert yet, and the wait is the break one): on a break since they stopped.
      const onBreak = breakAllowed && !offLongEnough && !isOpen("not_tracking");
      status.state = onBreak ? "on_break" : "not_tracking";
      status.since = offSince;
    } else if (isOpen("idle")) {
      status.state = "idle";
      const inc = open.get(`${p.personId}:idle`);
      status.since = str(inc?.detail.since) ?? iso(w.first ?? winStart);
    } else if (running) {
      status.state = "tracking";
      status.since = trackingSince(recs);
    } else status.state = "cant_tell";
    if (pct !== null) status.detail = { ...status.detail, idlePct: pct2(pct) };
    out.statuses.push(status);
  }

  for (const o of out.open) opened.push(o.kind === "source" ? "Hubstaff" : `${input.people.find(p => p.personId === o.personId)?.name ?? "someone"} (${o.kind})`);
  const parts = [`${out.onShift} on shift`];
  if (!readings.ok) parts.push(`Hubstaff cannot be read: ${readings.note.slice(0, 160)}`);
  parts.push(opened.length ? `opened ${opened.join(", ")}` : "nothing opened");
  parts.push(`${out.close.length} closed`);
  out.note = `${parts.join("; ")}.`;
  return out;
}

/** True when `n` of the shots were taken within one window's span of each other. */
export function withinOneWindow(shots: { recordedAt: string | null }[], n: number, spanMs: number): boolean {
  const times = shots.map(s => (s.recordedAt ? Date.parse(s.recordedAt) : Number.NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  for (let i = 0; i + n - 1 < times.length; i++) if (times[i + n - 1] - times[i] <= spanMs) return true;
  return false;
}
