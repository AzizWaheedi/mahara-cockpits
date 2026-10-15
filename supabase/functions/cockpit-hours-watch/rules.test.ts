import { describe, expect, test } from "bun:test";
import {
  type BreakRules, DEFAULT_SETTINGS, type KnownShot, type OpenIncident, parseBreakRules, parseInputs, parsePerson, parseSettings, type WatchPerson, type WatchSettings,
} from "./inputs.ts";
import { type ActivityRecord, decide, IDLE_KEEP_TRACKED_S, IDLE_MIN_TRACKED_S, type LastActivity, needsVerdict, pickShots, type Readings, type ShotFact, withinOneWindow } from "./rules.ts";
import { kw, person } from "./testkit.ts";

const UID = "3616851";
type Opts = {
  people?: WatchPerson[];
  open?: OpenIncident[];
  readings?: Readings;
  la?: LastActivity | null;
  activities?: ActivityRecord[];
  shots?: ShotFact[];
  settings?: Partial<WatchSettings>;
  rules?: BreakRules;
  lastOkRunAt?: string | null;
};
function readings(la: LastActivity | null, activities: ActivityRecord[] = []): Extract<Readings, { ok: true }> {
  const map = new Map<string, LastActivity>();
  if (la) map.set(UID, la);
  return { ok: true, lastActivities: map, activities, screenshotsOn: new Map([[UID, true]]) };
}
function run(now: string, o: Opts = {}) {
  return decide({
    now: new Date(now),
    settings: { ...DEFAULT_SETTINGS, ...o.settings },
    people: o.people ?? [person()],
    open: o.open ?? [],
    readings: o.readings ?? readings(o.la === undefined ? { online: true, lastClientActivity: now } : o.la, o.activities ?? []),
    shots: o.shots ?? [],
    rules: o.rules,
    lastOkRunAt: o.lastOkRunAt,
  });
}
/** No break allowance: every stop waits notTrackingMinutes. */
const NO_BREAK: BreakRules = { breakMinutes: 0, breakWhenLongerThanHours: 6 };
const OFF: LastActivity = { online: false, lastClientActivity: null };
let nextId = 100;
function incident(kind: OpenIncident["kind"], openedAt: string, detail: Record<string, unknown> = {}, personId: number | null = 1): OpenIncident {
  return { id: nextId++, personId: kind === "source" ? null : personId, kind, openedAt, detail, slackState: "posted" };
}
/** 10-minute blocks from one Kuwait time to another (exclusive), each tracked 600 s on the computer with `overall` seconds of activity. */
function blocks(from: string, to: string, overall: number | ((i: number) => number), extra: Partial<ActivityRecord> = {}, day?: string): ActivityRecord[] {
  const out: ActivityRecord[] = [];
  let i = 0;
  for (let t = Date.parse(kw(from, day)); t < Date.parse(kw(to, day)); t += 600_000)
    out.push({ userId: UID, slotStart: new Date(t).toISOString(), tracked: 600, inputTracked: 600, overall: typeof overall === "number" ? overall : overall(i++), idle: false, ...extra });
  return out;
}
const live = (t: number): LastActivity => ({ online: true, lastClientActivity: new Date(t).toISOString() });

/**
 * The rules every 5 minutes from one Kuwait time to another, carrying open
 * incidents from run to run as the database would (the reviewers' sim.ts).
 * Activity blocks show up only once Hubstaff's 20-minute lag has passed.
 */
function simulate(o: {
  from: string; to: string; day?: string; people?: WatchPerson[]; la: (t: number) => LastActivity | null; acts?: ActivityRecord[];
  shots?: ShotFact[]; settings?: Partial<WatchSettings>; open?: OpenIncident[]; rules?: BreakRules;
}) {
  let open = o.open ?? [];
  const log: string[] = [];
  for (let t = Date.parse(kw(o.from, o.day)); t <= Date.parse(kw(o.to, o.day)); t += 5 * 60_000) {
    const la = o.la(t);
    const acts = (o.acts ?? []).filter(a => Date.parse(a.slotStart) + 600_000 <= t - 20 * 60_000);
    const d = decide({
      now: new Date(t), settings: { ...DEFAULT_SETTINGS, ...o.settings }, people: o.people ?? [person()], open, rules: o.rules,
      readings: readings(la, acts), shots: (o.shots ?? []).filter(s => Date.parse(s.recordedAt!) <= t),
    });
    const hhmm = new Date(t + 3 * 3600_000).toISOString().slice(11, 16);
    for (const c of d.close) {
      log.push(`${hhmm} close ${open.find(i => i.id === c.id)!.kind} ${c.closeReason}`);
      open = open.filter(i => i.id !== c.id);
    }
    for (const n of d.open) {
      open.push({ id: nextId++, personId: n.personId, kind: n.kind, openedAt: new Date(t).toISOString(), detail: n.detail, slackState: "posted" });
      log.push(`${hhmm} open ${n.kind}`);
    }
    for (const u of d.update) {
      const inc = open.find(x => x.id === u.id);
      if (inc) inc.detail = u.detail;
    }
  }
  return { log, open, opens: log.filter(l => l.includes(" open ")), closes: log.filter(l => l.includes(" close ")) };
}
function shot(id: number, hhmm: string, verdict: ShotFact["verdict"], confidence: number | null = 0.9, label: string | null = "YouTube video"): ShotFact {
  return { shotId: id, personId: 1, recordedAt: kw(hhmm), verdict, confidence, label };
}

describe("on shift or not", () => {
  test("before the shift, after it, and on days off nothing opens, whatever Hubstaff says", () => {
    for (const now of [kw("09:50"), kw("18:00"), kw("18:05")]) {
      const d = run(now, { la: OFF });
      expect(d.open).toEqual([]);
      expect(d.statuses[0].state).toBe("off_shift");
      expect(d.onShift).toBe(0);
    }
    const cases: [WatchPerson["offReason"], string][] = [["leave", "on_leave"], ["holiday", "holiday"], ["day_off", "off_shift"], ["not_employed", "off_shift"], ["paused", "off_shift"]];
    for (const [offReason, state] of cases) {
      const d = run(kw("12:00"), { la: OFF, people: [person({ offReason })] });
      expect(d.open).toEqual([]);
      expect(d.statuses[0]).toMatchObject({ state, detail: { offReason } });
    }
  });
  test("no shift today is off shift", () => {
    const d = run(kw("12:00"), { la: OFF, people: [person({ shift: null })] });
    expect(d.open).toEqual([]);
    expect(d.statuses[0].state).toBe("off_shift");
  });
});

describe("not_tracking", () => {
  test("a late start: off time counts from the shift start, so it opens at start + the threshold, never earlier", () => {
    // Yesterday's last activity is long past the threshold at 10:00; the off time still starts at 10:00.
    const la = { online: false, lastClientActivity: kw("17:59", "2026-10-12") };
    const early = run(kw("10:29"), { la });
    expect(early.open).toEqual([]);
    expect(early.statuses[0]).toMatchObject({ state: "not_tracking", since: kw("10:00") });
    const d = run(kw("10:30"), { la });
    expect(d.open).toEqual([{ personId: 1, kind: "not_tracking", detail: expect.objectContaining({ reason: "off", since: kw("10:00"), shiftStart: kw("10:00"), shiftEnd: kw("18:00") }) }]);
    expect(d.open[0].detail.text).toContain("has not had Hubstaff on since 10:00, 30 min into the 10:00 to 18:00 shift.");
    // The reviewers' late16 case: starting at 10:16 posts nothing (it used to post at 10:15 and reply at 10:20).
    const late = simulate({ from: "10:00", to: "10:30", la: t => (t < Date.parse(kw("10:16")) ? la : live(t)) });
    expect(late.log).toEqual([]);
  });
  test("the grace still applies on top: a short threshold waits for the grace, a longer grace waits longer", () => {
    expect(run(kw("10:14"), { la: OFF, settings: { notTrackingMinutes: 10 } }).open).toEqual([]);
    expect(run(kw("10:15"), { la: OFF, settings: { notTrackingMinutes: 10 } }).open.length).toBe(1);
    expect(run(kw("10:10"), { la: OFF, settings: { notTrackingMinutes: 10, graceMinutes: 0 } }).open.length).toBe(1);
    expect(run(kw("10:40"), { la: OFF, settings: { graceMinutes: 45 } }).open).toEqual([]);
    expect(run(kw("10:45"), { la: OFF, settings: { graceMinutes: 45 } }).open.length).toBe(1);
  });
  test("mid-shift: opens only once Hubstaff has been off for the threshold", () => {
    const la = { online: false, lastClientActivity: kw("12:00") };
    expect(run(kw("12:29"), { la, rules: NO_BREAK }).open).toEqual([]);
    const d = run(kw("12:31"), { la, rules: NO_BREAK });
    expect(d.open[0]).toMatchObject({ kind: "not_tracking", detail: { since: kw("12:00"), lastActivityAt: kw("12:00") } });
    expect(run(kw("12:50"), { la, settings: { notTrackingMinutes: 60 }, rules: NO_BREAK }).open).toEqual([]);
  });
  test("online, or a recent client activity, is running: nothing opens", () => {
    expect(run(kw("12:00"), { la: { online: true, lastClientActivity: kw("08:00") } }).open).toEqual([]);
    const recent = run(kw("12:00"), { la: { online: false, lastClientActivity: kw("11:45") } });
    expect(recent.open).toEqual([]);
    expect(recent.statuses[0].state).toBe("tracking");
  });
  test("a person missing from last_activities never ran Hubstaff: not tracking", () => {
    expect(run(kw("10:30"), { la: null }).open[0]).toMatchObject({ kind: "not_tracking" });
  });
  test("online unknown (null) with an old activity changes nothing", () => {
    const d = run(kw("12:00"), { la: { online: null, lastClientActivity: kw("08:00") } });
    expect(d.open).toEqual([]);
    expect(d.statuses[0].state).toBe("cant_tell");
  });
  test("clears when Hubstaff runs again: Back on Hubstaff at", () => {
    const inc = incident("not_tracking", kw("10:15"), { reason: "off", since: kw("10:12"), shiftEnd: kw("18:00") });
    const d = run(kw("10:47"), { open: [inc], la: { online: true, lastClientActivity: kw("10:46") } });
    expect(d.close).toEqual([{ id: inc.id, closeReason: "back", detail: expect.objectContaining({ resolveText: "Back on Hubstaff at 10:47 (35 min off).", since: kw("10:12") }) }]);
    expect(d.open).toEqual([]);
  });
  test("still off: touched, not opened again", () => {
    const inc = incident("not_tracking", kw("10:15"), { reason: "off", since: kw("10:00") });
    const d = run(kw("11:00"), { open: [inc], la: OFF });
    expect(d.open).toEqual([]);
    expect(d.update.map(u => u.id)).toEqual([inc.id]);
    expect(d.close).toEqual([]);
  });
  test("the shift ends: closed with the off time to the end of the shift", () => {
    const inc = incident("not_tracking", kw("16:40"), { reason: "off", since: kw("16:10"), shiftEnd: kw("18:00") });
    const d = run(kw("18:05"), { open: [inc], la: OFF });
    expect(d.close).toEqual([{ id: inc.id, closeReason: "shift_ended", detail: expect.objectContaining({ resolveText: "Shift ended. Hubstaff was off from 16:10 to 18:00 (1 h 50 min)." }) }]);
    expect(d.open).toEqual([]);
  });
  test("closed, then off again on a later run: a new incident", () => {
    const inc = incident("not_tracking", kw("10:15"), { reason: "off", since: kw("10:00") });
    const first = run(kw("10:40"), { open: [inc], la: { online: true, lastClientActivity: kw("10:40") } });
    expect(first.close.map(c => c.id)).toEqual([inc.id]);
    const later = run(kw("11:20"), { open: [], la: { online: false, lastClientActivity: kw("10:45") }, rules: NO_BREAK });
    expect(later.open).toEqual([expect.objectContaining({ kind: "not_tracking", detail: expect.objectContaining({ since: kw("10:45") }) })]);
  });
  test("an alert left open from yesterday closes when today's shift is on", () => {
    const y = "2026-10-12";
    const inc = incident("not_tracking", kw("16:00", y), { reason: "off", since: kw("15:30", y), shiftEnd: kw("18:00", y) });
    const d = run(kw("10:05"), { open: [inc], la: OFF });
    expect(d.close).toEqual([{ id: inc.id, closeReason: "shift_ended", detail: expect.objectContaining({ resolveText: "Shift ended. Hubstaff was off from 15:30 to 18:00 (2 h 30 min)." }) }]);
    expect(d.open).toEqual([]);
  });
});

describe("the day's break (Hours: 60 minutes on a shift over 6 hours)", () => {
  const lunchLa = (t: number) => (t >= Date.parse(kw("13:00")) && t < Date.parse(kw("14:00")) ? { online: false, lastClientActivity: kw("13:00") } : live(t));
  test("the reviewers' lunch.ts: tracking 10:00-13:00, off an hour, back at 14:00 posts nothing all day", () => {
    const acts = [...blocks("10:00", "13:00", 360), ...blocks("14:00", "18:00", 360)];
    expect(simulate({ from: "10:00", to: "18:00", la: lunchLa, acts }).log).toEqual([]);
  });
  test("the first stop after tracking waits max(threshold, break + grace): 75 minutes by default", () => {
    const la = { online: false, lastClientActivity: kw("13:00") };
    const acts = blocks("10:00", "13:00", 360);
    const lunch = run(kw("14:14"), { la, activities: acts });
    expect(lunch.open).toEqual([]);
    // Final round: inside the break wait the status is on_break since they stopped, not a problem.
    expect(lunch.statuses[0]).toMatchObject({ state: "on_break", since: kw("13:00") });
    const over = run(kw("14:15"), { la, activities: acts });
    expect(over.open).toEqual([expect.objectContaining({ kind: "not_tracking", detail: expect.objectContaining({ since: kw("13:00") }) })]);
    expect(over.statuses[0]).toMatchObject({ state: "not_tracking", since: kw("13:00") });
    // A threshold longer than the break wins.
    expect(run(kw("14:30"), { la, activities: acts, settings: { notTrackingMinutes: 120 } }).open).toEqual([]);
  });
  test("only one break: a later stop waits the threshold", () => {
    const acts = [...blocks("10:00", "13:00", 360), ...blocks("14:00", "16:00", 360)];
    const la = { online: false, lastClientActivity: kw("16:00") };
    expect(run(kw("16:29"), { la, activities: acts }).open).toEqual([]);
    expect(run(kw("16:30"), { la, activities: acts }).open.map(o => o.kind)).toEqual(["not_tracking"]);
    // The whole day: lunch, then a second hour off from 16:00, alerts once at 16:30 and replies at 17:00.
    const day = simulate({
      from: "10:00", to: "18:00", acts: [...acts, ...blocks("17:00", "18:00", 360)],
      la: t => (t >= Date.parse(kw("16:00")) && t < Date.parse(kw("17:00")) ? la : lunchLa(t)),
    });
    expect(day.log).toEqual(["16:30 open not_tracking", "17:00 close not_tracking back"]);
  });
  test("a stop shorter than the threshold is not the break; the stop before tracking starts is not either", () => {
    const short = [...blocks("10:00", "11:00", 360), ...blocks("11:20", "13:00", 360)];
    expect(run(kw("13:35"), { la: { online: false, lastClientActivity: kw("13:00") }, activities: short }).open).toEqual([]);
    const late = [...blocks("10:40", "13:00", 360)];
    expect(run(kw("13:35"), { la: { online: false, lastClientActivity: kw("13:00") }, activities: late }).open).toEqual([]);
  });
  test("a shift of 6 hours or less has no break", () => {
    const six = person({ shift: { start: kw("10:00"), end: kw("16:00") } });
    const la = { online: false, lastClientActivity: kw("13:00") };
    expect(run(kw("13:30"), { people: [six], la, activities: blocks("10:00", "13:00", 360) }).open.map(o => o.kind)).toEqual(["not_tracking"]);
    expect(run(kw("13:30"), { la, activities: blocks("10:00", "13:00", 360), rules: { breakMinutes: 60, breakWhenLongerThanHours: 8 } }).open.length).toBe(1);
  });
  test("a stop of the threshold or longer earlier in the day used the break, even one that alerted", () => {
    const acts = [...blocks("10:00", "11:00", 360), ...blocks("11:40", "13:00", 360)];
    expect(run(kw("13:30"), { la: { online: false, lastClientActivity: kw("13:00") }, activities: acts }).open.length).toBe(1);
  });
});

describe("no_account", () => {
  const nada = person({ personId: 2, name: "Nada Al Saed", role: "Media Buyer", hubstaffUserId: null, accountStatus: "invited" });
  test("on shift with no Hubstaff account: opens after the grace, says the invite is not accepted", () => {
    expect(run(kw("10:10"), { people: [nada] }).open).toEqual([]);
    const d = run(kw("10:20"), { people: [nada] });
    expect(d.open).toEqual([{ personId: 2, kind: "not_tracking", detail: expect.objectContaining({ reason: "no_account", invited: true }) }]);
    expect(d.open[0].detail.text).toContain("*Nada Al Saed* (media buyer) is on shift but is not in Hubstaff yet (invite not accepted).");
    expect(d.statuses[0]).toMatchObject({ personId: 2, state: "no_account", trackedTodayS: null, online: null });
  });
  test("a linked account closes it; a not-tracking alert can only open on a later run", () => {
    const inc = incident("not_tracking", kw("10:20"), { reason: "no_account" }, 2);
    const linked = person({ personId: 2, name: "Nada Al Saed", role: "Media Buyer" });
    const d = run(kw("11:00"), { people: [linked], open: [inc], la: OFF });
    expect(d.close).toEqual([{ id: inc.id, closeReason: "linked", detail: expect.objectContaining({ resolveText: "Now in Hubstaff (linked by 11:00)." }) }]);
    expect(d.open).toEqual([]);
    const next = run(kw("11:05"), { people: [linked], open: [], la: OFF });
    expect(next.open[0]).toMatchObject({ personId: 2, kind: "not_tracking", detail: { reason: "off" } });
  });
  test("an account that is only invited (pending) or removed in Hubstaff counts as none", () => {
    const pending = run(kw("10:20"), { people: [person({ accountStatus: "pending" })], la: OFF });
    expect(pending.open).toEqual([{ personId: 1, kind: "not_tracking", detail: expect.objectContaining({ reason: "no_account", invited: true }) }]);
    const removed = run(kw("10:20"), { people: [person({ accountStatus: "removed" })], la: OFF });
    expect(removed.open[0].detail).toMatchObject({ reason: "no_account", invited: false });
  });
  test("off shift, no alert", () => {
    expect(run(kw("19:00"), { people: [nada] }).open).toEqual([]);
  });
  test("the reviewers' noacct.ts: three days without an account post once and never reply 'Shift ended'", () => {
    let open: OpenIncident[] = [];
    const log: string[] = [];
    for (const day of ["2026-10-13", "2026-10-14", "2026-10-15"]) {
      const nadaDay = { ...nada, shift: { start: kw("10:00", day), end: kw("18:00", day) } };
      const r = simulate({ day, from: "09:00", to: "19:00", open, people: [nadaDay], la: () => null });
      open = r.open;
      log.push(...r.log.map(l => `${day} ${l}`));
    }
    expect(log).toEqual(["2026-10-13 10:15 open not_tracking"]);
    expect(open.map(o => o.detail.reason)).toEqual(["no_account"]);
  });
  test("a linked account closes it even off shift; leaving the watch list closes it", () => {
    const inc = incident("not_tracking", kw("10:20"), { reason: "no_account" }, 2);
    const linked = person({ personId: 2, name: "Nada Al Saed", role: "Media Buyer" });
    expect(run(kw("21:00"), { people: [linked], open: [inc] }).close).toEqual([expect.objectContaining({ id: inc.id, closeReason: "linked" })]);
    expect(run(kw("21:00"), { people: [], open: [inc] }).close).toEqual([expect.objectContaining({ id: inc.id, closeReason: "not_watched" })]);
    // Still no account, off shift or Hubstaff down: it stays open and untouched.
    expect(run(kw("21:00"), { people: [nada], open: [inc] }).close).toEqual([]);
    expect(run(kw("11:00"), { people: [nada], open: [inc], readings: { ok: false, note: "x" } }).close).toEqual([]);
  });
});

describe("source: Hubstaff cannot be read", () => {
  const down: Readings = { ok: false, note: "Hubstaff refused the key (401)." };
  test("opens the source incident once; no person incident opens or closes on missing data", () => {
    const back = incident("not_tracking", kw("10:15"), { reason: "off", since: kw("10:00") });
    const d = run(kw("11:00"), { readings: down, open: [back], shots: [shot(1, "10:45", "not_work"), shot(2, "10:55", "not_work")] });
    expect(d.open).toEqual([{ personId: null, kind: "source", detail: { note: "Hubstaff refused the key (401).", text: expect.stringContaining("Hubstaff watch cannot read Hubstaff: Hubstaff refused the key (401). Nobody is being watched") } }]);
    expect(d.close).toEqual([]);
    expect(d.update).toEqual([]);
    expect(d.statuses[0]).toMatchObject({ state: "cant_tell", trackedTodayS: null, activePct30m: null, online: null });
    expect(d.slots).toEqual([]);
  });
  test("a person with no account does not open either while Hubstaff is down", () => {
    expect(run(kw("11:00"), { readings: down, people: [person({ hubstaffUserId: null })] }).open.map(o => o.kind)).toEqual(["source"]);
  });
  test("already open: touched, not posted again", () => {
    const src = incident("source", kw("10:00"));
    const d = run(kw("11:00"), { readings: down, open: [src] });
    expect(d.open).toEqual([]);
    expect(d.update).toEqual([{ id: src.id, detail: { note: "Hubstaff refused the key (401)." } }]);
  });
  test("the end of a shift is a fact of the schedule: it still closes", () => {
    const inc = incident("idle", kw("15:00"), { since: kw("14:00") });
    const d = run(kw("18:10"), { readings: down, open: [inc] });
    expect(d.close).toEqual([{ id: inc.id, closeReason: "shift_ended", detail: expect.objectContaining({ resolveText: "Shift ended at 18:00." }) }]);
  });
  test("the reviewers' source.ts: one blip posts nothing; it opens once no ok run has read Hubstaff for 10 minutes", () => {
    const blip = run(kw("11:00"), { readings: { ok: false, note: "Hubstaff answered 502." }, lastOkRunAt: kw("10:55"), la: OFF });
    expect(blip.open).toEqual([]);
    expect(blip.statuses[0].state).toBe("cant_tell");
    expect(run(kw("11:04"), { readings: down, lastOkRunAt: kw("10:55") }).open).toEqual([]);
    expect(run(kw("11:05"), { readings: down, lastOkRunAt: kw("10:55") }).open.map(o => o.kind)).toEqual(["source"]);
    expect(run(kw("11:00"), { readings: down, lastOkRunAt: null }).open.map(o => o.kind)).toEqual(["source"]);
    // Person alerts freeze from the first failed read, before the source alert opens.
    const back = incident("not_tracking", kw("10:15"), { reason: "off", since: kw("10:00") });
    const frozen = run(kw("11:00"), { readings: down, lastOkRunAt: kw("10:58"), open: [back] });
    expect([frozen.open, frozen.close, frozen.update]).toEqual([[], [], []]);
  });
  test("closes when a read works, and people are judged again in the same run", () => {
    const src = incident("source", kw("10:00"));
    const d = run(kw("11:00"), { open: [src], la: OFF });
    expect(d.close).toEqual([{ id: src.id, closeReason: "read_ok", detail: expect.objectContaining({ resolveText: "Hubstaff can be read again." }) }]);
    expect(d.open.map(o => o.kind)).toEqual(["not_tracking"]);
  });
});

describe("not_work", () => {
  test("two screenshots judged not work with enough confidence open it", () => {
    const shots = [shot(1, "11:31", "work", 0.9, "Dialer"), shot(2, "11:41", "not_work", 0.9, "YouTube video"), shot(3, "11:51", "not_work", 0.8, "Instagram feed")];
    const d = run(kw("11:55"), { shots });
    expect(d.open).toEqual([{ personId: 1, kind: "not_work", detail: expect.objectContaining({ count: 2, total: 3, shotIds: [3, 2], labels: ["Instagram feed", "YouTube video"], lastNotWorkAt: kw("11:51") }) }]);
    expect(d.open[0].detail.text).toContain(": 2 of the last 3 screenshots do not look like work (Instagram feed, YouTube video).");
    expect(d.statuses[0].state).toBe("not_work");
  });
  test("a model error never counts, and unclear never counts", () => {
    expect(run(kw("11:55"), { shots: [shot(1, "11:41", "error", null, null), shot(2, "11:51", "not_work")] }).open).toEqual([]);
    expect(run(kw("11:55"), { shots: [shot(1, "11:41", "unclear", 0.99), shot(2, "11:51", "not_work")] }).open).toEqual([]);
    expect(run(kw("11:55"), { shots: [shot(1, "11:41", "skipped", null), shot(2, "11:51", "pending", null)] }).open).toEqual([]);
  });
  test("the confidence threshold: below never counts, equal counts", () => {
    expect(run(kw("11:55"), { shots: [shot(1, "11:41", "not_work", 0.74), shot(2, "11:51", "not_work", 0.9)] }).open).toEqual([]);
    expect(run(kw("11:55"), { shots: [shot(1, "11:41", "not_work", 0.75), shot(2, "11:51", "not_work", 0.9)] }).open.length).toBe(1);
    expect(run(kw("11:55"), { shots: [shot(1, "11:41", "not_work", 0.8), shot(2, "11:51", "not_work", 0.9)], settings: { minConfidence: 0.85 } }).open).toEqual([]);
  });
  test("screenshots that reach Hubstaff late still count: the look-back is the window plus the 20-minute lag", () => {
    // 14:03 and 14:13, read at 14:35: the old [now - 30 min] window held only the second one.
    const pair = [shot(1, "14:03", "not_work"), shot(2, "14:13", "not_work")];
    expect(run(kw("14:35"), { shots: pair }).open.map(o => o.kind)).toEqual(["not_work"]);
    // Two screenshots more than one window apart never make an alert, however late they arrive.
    expect(run(kw("14:45"), { shots: [shot(1, "14:03", "not_work"), shot(2, "14:40", "not_work")] }).open).toEqual([]);
    expect(withinOneWindow([{ recordedAt: kw("14:03") }, { recordedAt: kw("14:33") }], 2, 30 * 60_000)).toBe(true);
    expect(withinOneWindow([{ recordedAt: kw("14:03") }, { recordedAt: kw("14:34") }], 2, 30 * 60_000)).toBe(false);
  });
  test("only the window counts, and the count is a setting", () => {
    expect(run(kw("11:55"), { shots: [shot(1, "11:20", "not_work"), shot(2, "11:51", "not_work")] }).open).toEqual([]);
    expect(run(kw("11:55"), { shots: [shot(1, "11:51", "not_work")], settings: { nonWorkShots: 1 } }).open[0].detail.text).toContain(": The last screenshot does not look like work");
    expect(run(kw("11:55"), { shots: [shot(1, "11:41", "not_work"), shot(2, "11:51", "not_work")], settings: { nonWorkShots: 3 } }).open).toEqual([]);
  });
  test("the reviewers' preshift.ts: screenshots from before the shift never count", () => {
    const shots = [shot(1, "09:38", "not_work", 0.9, "Instagram feed"), shot(2, "09:49", "not_work", 0.9, "Instagram feed"), shot(3, "10:01", "work", 0.9, "Dialer")];
    expect(simulate({ from: "10:00", to: "10:30", la: live, shots }).log).toEqual([]);
    expect(run(kw("10:05"), { shots: [...shots, shot(4, "10:03", "not_work")] }).open).toEqual([]);
    expect(run(kw("10:15"), { shots: [...shots, shot(4, "10:03", "not_work"), shot(5, "10:13", "not_work")] }).open[0].detail).toMatchObject({ count: 2, shotIds: [5, 4] });
  });
  test("clears when the window has no not-work screenshot left; an undecided one keeps it open", () => {
    const inc = incident("not_work", kw("11:55"), { lastNotWorkAt: kw("11:30") });
    const clean = run(kw("12:20"), { open: [inc], shots: [shot(4, "12:01", "work"), shot(5, "12:11", "unclear")] });
    expect(clean.close).toEqual([{ id: inc.id, closeReason: "work", detail: expect.objectContaining({ resolveText: "No more screenshots off work since 11:30." }) }]);
    const errored = run(kw("12:20"), { open: [inc], shots: [shot(4, "12:01", "work"), shot(5, "12:11", "error", null)] });
    expect(errored.close).toEqual([]);
    expect(errored.update.map(u => u.id)).toEqual([inc.id]);
    const lowConfidence = run(kw("12:20"), { open: [inc], shots: [shot(6, "12:11", "not_work", 0.6)] });
    expect(lowConfidence.close).toEqual([]);
    expect(lowConfidence.update[0].detail.lastNotWorkAt).toBe(kw("12:11"));
  });
});

describe("idle", () => {
  test("opens when the lagged window tracked 20 minutes or more under the floor; the last 20 minutes are not read", () => {
    // now 11:50: the window is 11:00 to 11:30; 11:30 to 11:50 may still be missing in Hubstaff, so even busy blocks there don't count.
    const activities = [...blocks("11:00", "11:30", 6), ...blocks("11:30", "11:50", 600)];
    const d = run(kw("11:50"), { activities });
    expect(d.open).toEqual([{ personId: 1, kind: "idle", detail: expect.objectContaining({ since: kw("11:00"), pct: 1, windowStart: kw("11:00"), windowEnd: kw("11:30"), trackedS: 1800, overallS: 18 }) }]);
    expect(d.open[0].detail.text).toContain("Hubstaff has been running since 11:00 with 1% keyboard and mouse activity.");
    expect(d.statuses[0].state).toBe("idle");
  });
  test("under 20 minutes tracked in the window says nothing; at the floor is not idle", () => {
    expect(run(kw("11:50"), { activities: blocks("11:10", "11:20", 0) }).open).toEqual([]);
    expect(run(kw("11:50"), { activities: blocks("11:00", "11:30", 60) }).open).toEqual([]);
    expect(run(kw("11:50"), { activities: blocks("11:00", "11:30", 60), settings: { idleFloorPct: 20 } }).open.length).toBe(1);
  });
  test("clears only 5 points above the floor, or when the window no longer holds 20 minutes on the computer", () => {
    const inc = incident("idle", kw("11:50"), { since: kw("11:00") });
    const d = run(kw("12:30"), { open: [inc], activities: blocks("11:40", "12:10", 300) });
    expect(d.close).toEqual([{ id: inc.id, closeReason: "active", detail: expect.objectContaining({ resolveText: "Activity back above 10% at 12:30." }) }]);
    expect(run(kw("12:30"), { open: [inc], activities: blocks("11:40", "12:10", 90) }).close.map(c => c.closeReason)).toEqual(["active"]);
    const between = run(kw("12:30"), { open: [inc], activities: blocks("11:40", "12:10", 84) });
    expect(between.close).toEqual([]);
    expect(between.update[0].detail).toMatchObject({ pct: 14 });
    expect(run(kw("12:30"), { open: [inc], activities: blocks("11:40", "12:10", 6) }).close).toEqual([]);
    const timerOff = run(kw("12:30"), { open: [inc], activities: [] });
    expect(timerOff.close).toEqual([{ id: inc.id, closeReason: "not_judged", detail: expect.objectContaining({ resolveText: "Too little time on the computer to judge activity at 12:30." }) }]);
    expect(timerOff.statuses[0].state).not.toBe("idle");
  });
  test("the reviewers' idle_day.ts and probe3: activity hovering at the floor opens once a day, not 18 times", () => {
    const hover = simulate({ from: "10:00", to: "18:00", la: live, acts: blocks("10:00", "18:00", i => [48, 66, 60, 54, 72, 50, 78, 42, 60, 57][i % 10]) });
    expect(hover.opens.length).toBe(1);
    expect(hover.closes).toEqual(["18:00 close idle shift_ended"]);
    const flap = simulate({ from: "10:00", to: "13:00", la: live, acts: blocks("10:00", "18:00", i => (i % 2 ? 84 : 36)) });
    expect(flap.opens.length).toBeLessThanOrEqual(1);
    expect(flap.closes).toEqual([]);
  });
  test("keyboard and mouse over input-tracked time: phone or web timer time is never idle", () => {
    // The reviewers' mobile case: tracked 600 s, no input tracking, no activity level.
    const phone = blocks("10:00", "12:00", 0, { inputTracked: 0 });
    expect(simulate({ from: "10:00", to: "12:00", la: live, acts: phone }).log).toEqual([]);
    const d = run(kw("11:50"), { activities: phone });
    expect(d.statuses[0]).toMatchObject({ state: "tracking", activePct30m: null });
    expect(d.slots.every(sl => !sl.idle)).toBe(true);
    // 60 s of activity in 400 s on the computer is 15%, over a 12% floor; over all 600 tracked seconds it would read 10%.
    const mixed = blocks("11:00", "11:30", 60, { inputTracked: 400 });
    expect(run(kw("11:50"), { activities: mixed, settings: { idleFloorPct: 12 } }).open).toEqual([]);
    expect(run(kw("11:50"), { activities: mixed, settings: { idleFloorPct: 12 } }).statuses[0].activePct30m).toBe(15);
    // Under 20 minutes on the computer in the window says nothing, however long the timer ran.
    expect(run(kw("11:50"), { activities: blocks("11:00", "11:30", 0, { inputTracked: 300 }) }).open).toEqual([]);
  });
  test("the window never reaches before the shift start (the reviewers' preshift idle case)", () => {
    const acts = [...blocks("09:00", "10:00", 0), ...blocks("10:00", "12:00", 360)];
    expect(simulate({ from: "10:00", to: "11:00", la: live, acts }).log).toEqual([]);
    const d = run(kw("10:40"), { activities: acts });
    expect(d.statuses[0].detail).toMatchObject({ idlePct: 60 });
  });
  test("the sentence rounds down: 9.7% under a 10% floor reads 9%", () => {
    const d = run(kw("11:50"), { activities: blocks("11:00", "11:30", 58.2) });
    expect(d.open[0].detail).toMatchObject({ pct: 9.7 });
    expect(d.open[0].detail.text).toContain("with 9% keyboard and mouse activity.");
  });
});

describe("statuses and slots", () => {
  test("tracked today, the last 30 minutes' activity (lagged), the shift line's blocks", () => {
    const activities = [...blocks("10:00", "11:00", 300), { userId: UID, slotStart: kw("10:30"), tracked: 120, inputTracked: 120, overall: 0, idle: true }];
    const d = run(kw("11:30"), { activities });
    expect(d.statuses[0]).toMatchObject({ state: "tracking", trackedTodayS: 3720, activePct30m: 50, shiftStart: kw("10:00"), shiftEnd: kw("18:00"), online: true, screenshotsOn: true, since: kw("10:00") });
    expect(d.slots.length).toBe(6);
    expect(d.slots.find(s => s.slotStart === kw("10:30"))).toEqual({ personId: 1, slotStart: kw("10:30"), trackedS: 720, inputTrackedS: 720, overallS: 300, idle: true });
    expect(d.slots.find(s => s.slotStart === kw("10:00"))?.idle).toBe(false);
  });
  test("a person read this run carries readAt; one not read (no account, Hubstaff down) does not", () => {
    const read = decide({ now: new Date(kw("11:30")), settings: DEFAULT_SETTINGS, people: [person()], open: [], shots: [],
      readings: { ...readings({ online: true, lastClientActivity: kw("11:29") }), readAt: kw("11:30") } });
    expect(read.statuses[0].detail.readAt).toBe(kw("11:30"));
    expect(run(kw("19:00")).statuses[0].detail.readAt).toBe(kw("19:00"));
    expect(run(kw("11:30"), { people: [person({ hubstaffUserId: null })] }).statuses[0].detail.readAt).toBeUndefined();
    expect(run(kw("11:30"), { readings: { ok: false, note: "x" } }).statuses[0].detail.readAt).toBeUndefined();
  });
  test("a block under the floor is idle on the shift line", () => {
    expect(run(kw("11:30"), { activities: blocks("10:00", "10:10", 12) }).slots[0].idle).toBe(true);
  });
  test("at most one open incident per person and kind: an open one is never opened again", () => {
    const open = [incident("not_tracking", kw("10:15"), { reason: "off", since: kw("10:00") }), incident("idle", kw("10:50")), incident("not_work", kw("10:55"))];
    const d = run(kw("11:50"), { open, la: OFF, activities: blocks("11:00", "11:30", 0), shots: [shot(1, "11:41", "not_work"), shot(2, "11:45", "not_work")] });
    expect(d.open).toEqual([]);
    expect(new Set(d.update.map(u => u.id))).toEqual(new Set(open.map(o => o.id)));
  });
  test("someone taken off the watch list has their alerts closed", () => {
    const inc = incident("not_tracking", kw("10:15"), { since: kw("10:00") }, 9);
    const d = run(kw("11:00"), { open: [inc] });
    expect(d.close).toEqual([{ id: inc.id, closeReason: "not_watched", detail: expect.objectContaining({ resolveText: expect.stringContaining("No longer watched") }) }]);
  });
  test("the note says what happened", () => {
    expect(run(kw("10:30"), { la: OFF }).note).toBe("1 on shift; opened Lama Harb (not_tracking); 0 closed.");
  });
});

describe("screenshots owed a verdict", () => {
  const known = (shotId: number, verdict: KnownShot["verdict"], attempts: number): KnownShot => ({ shotId, personId: 1, recordedAt: null, verdict, confidence: null, label: null, attempts });
  test("new, pending, skipped and failed under 3 times are owed; judged ones and 3 failures are not", () => {
    expect(needsVerdict(undefined)).toBe(true);
    expect(needsVerdict(known(1, "pending", 0))).toBe(true);
    expect(needsVerdict(known(1, "skipped", 0))).toBe(true);
    expect(needsVerdict(known(1, "error", 2))).toBe(true);
    expect(needsVerdict(known(1, "error", 3))).toBe(false);
    expect(needsVerdict(known(1, "work", 1))).toBe(false);
    expect(needsVerdict(known(1, "unclear", 1))).toBe(false);
  });
  test("oldest first, at most 12", () => {
    const screens = Array.from({ length: 15 }, (_, i) => ({ id: 100 + i, recordedAt: new Date(Date.parse(kw("11:00")) - i * 60_000).toISOString() }));
    const map = new Map<number, KnownShot>([[114, known(114, "work", 1)], [113, known(113, "error", 3)]]);
    const picked = pickShots(screens, map);
    expect(picked.length).toBe(12);
    expect(picked[0].id).toBe(112);
    expect(picked.map(p => p.id)).not.toContain(114);
  });
});

describe("inputs", () => {
  test("settings out of bounds or of the wrong type fall back to the default, never to zero", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = parseSettings({ on: false, notTrackingMinutes: 5, graceMinutes: 0, idleFloorPct: "12", minConfidence: 1.5, nonWorkShots: 2.5, channel: "nope", windowMinutes: 60 });
    expect(s).toMatchObject({ on: false, notTrackingMinutes: 30, graceMinutes: 0, idleFloorPct: 12, minConfidence: 0.75, nonWorkShots: 2, channel: "C0B5TL9H370", windowMinutes: 60 });
  });
  test("incident rows read in snake_case; a second open row for the same person and kind is dropped", () => {
    const i = parseInputs({
      settings: {}, people: [{ person_id: 1, name: "Lama", hubstaff_user_id: 3616851, shift: { start: kw("10:00"), end: kw("18:00") } }],
      open: [
        { id: 7, person_id: 1, kind: "idle", opened_at: kw("11:00"), detail: {}, slack_state: "posted" },
        { id: 5, person_id: 1, kind: "idle", opened_at: kw("10:00"), detail: {} },
        { id: 8, person_id: null, kind: "source", opened_at: kw("10:00") },
        { id: 9, person_id: null, kind: "idle", opened_at: kw("10:00") },
      ],
      knownShots: [{ shot_id: 11, verdict: "error", attempts: 2, recorded_at: kw("11:00"), confidence: "0.8" }, { shotId: 12, verdict: "bogus" }],
    });
    expect(i.people[0]).toMatchObject({ personId: 1, hubstaffUserId: "3616851", shift: { start: kw("10:00"), end: kw("18:00") }, offReason: null });
    expect(i.open.map(o => o.id)).toEqual([5, 8]);
    expect(i.knownShots).toEqual([{ shotId: 11, personId: null, recordedAt: kw("11:00"), verdict: "error", confidence: 0.8, label: null, attempts: 2 }]);
    expect(() => parseInputs({ people: "x" })).toThrow("shape");
  });
  test("rules, lastOkRunAt and replies are read defensively: absent or odd falls back to the defaults", () => {
    const none = parseInputs({ people: [] });
    expect(none).toMatchObject({ rules: { breakMinutes: 60, breakWhenLongerThanHours: 6 }, lastOkRunAt: null, replies: [], lastPruneOn: null });
    const full = parseInputs({
      people: [], rules: { break_minutes: "45", breakWhenLongerThanHours: 5 }, last_ok_run_at: kw("10:55"), lastPruneOn: "2026-10-13",
      replies: [{ id: 4, person_id: 1, kind: "idle", opened_at: kw("10:00"), detail: { resolveText: "x" }, slack_state: "posted" }, { id: 4, person_id: 1, kind: "idle" }, { id: "x" }],
    });
    expect(full).toMatchObject({ rules: { breakMinutes: 45, breakWhenLongerThanHours: 5 }, lastOkRunAt: kw("10:55"), lastPruneOn: "2026-10-13" });
    expect(full.replies.map(r => r.id)).toEqual([4]);
    const odd = parseInputs({ people: [], rules: { breakMinutes: -5, breakWhenLongerThanHours: "lots" }, lastOkRunAt: "never", replies: "x" });
    expect(odd).toMatchObject({ rules: { breakMinutes: 60, breakWhenLongerThanHours: 6 }, lastOkRunAt: null, replies: [] });
  });
});

describe("final round (2026-10-13 evening)", () => {
  describe("idle on finished blocks", () => {
    test("the window ends at the last 10-minute block finished before now - 20 min, never before the shift start", () => {
      // 11:55 - 20 min = 11:35: the 11:30 block is not finished by then, so the window is 11:00 to 11:30.
      const acts = [...blocks("11:00", "11:30", 0), ...blocks("11:30", "11:40", 600)];
      const d = run(kw("11:55"), { activities: acts });
      expect(d.open[0].detail).toMatchObject({ windowStart: kw("11:00"), windowEnd: kw("11:30"), inputTrackedS: 1800 });
      expect(run(kw("10:25"), { activities: blocks("10:00", "10:10", 0) }).statuses[0].detail.idlePct).toBeUndefined();
      expect([IDLE_MIN_TRACKED_S, IDLE_KEEP_TRACKED_S]).toEqual([1200, 600]);
    });
    test("the reviewers' recheck_3 flap: 590-second blocks at 0% post once a day, not 43 times", () => {
      const short = simulate({ from: "10:00", to: "18:00", la: live, acts: blocks("10:00", "18:00", 0, { tracked: 590, inputTracked: 590 }) });
      expect(short.opens.length).toBe(1);
      expect(short.closes).toEqual(["18:00 close idle shift_ended"]);
      // One 500-second block an hour: was 15 posts and 14 replies.
      const holes = simulate({ from: "10:00", to: "18:00", la: live, acts: blocks("10:00", "18:00", 0, {}).map((b, i) => (i % 6 === 5 ? { ...b, tracked: 500, inputTracked: 500 } : b)) });
      expect(holes.opens.length).toBe(1);
      expect(holes.closes).toEqual(["18:00 close idle shift_ended"]);
    });
    test("opens only with 20 minutes on the computer; once open it closes as not judged only under 10", () => {
      // 3 blocks of 390 s on the computer: 19.5 minutes, nothing opens.
      expect(run(kw("11:55"), { activities: blocks("11:00", "11:30", 0, { inputTracked: 390 }) }).open).toEqual([]);
      const inc = incident("idle", kw("11:30"), { since: kw("11:00") });
      // 15 minutes on the computer, still idle: kept open and touched.
      const kept = run(kw("11:55"), { open: [inc], activities: blocks("11:00", "11:30", 0, { inputTracked: 300 }) });
      expect(kept.close).toEqual([]);
      expect(kept.update[0].detail).toMatchObject({ inputTrackedS: 900, pct: 0 });
      // 15 minutes on the computer and busy: active again (the floor + 5 rule, judged down to 10 minutes).
      expect(run(kw("11:55"), { open: [inc], activities: blocks("11:00", "11:30", 150, { inputTracked: 300 }) }).close.map(c => c.closeReason)).toEqual(["active"]);
      // 9.5 minutes: too little to judge.
      expect(run(kw("11:55"), { open: [inc], activities: blocks("11:00", "11:30", 0, { inputTracked: 190 }) }).close.map(c => c.closeReason)).toEqual(["not_judged"]);
    });
  });

  test("percentages: activePct30m unrounded; a detail's pct rounds down to two decimals, so 9.996% never reads 10", () => {
    const d = run(kw("11:50"), { activities: blocks("11:00", "11:30", 100) });
    expect(d.statuses[0].activePct30m).toBeCloseTo(100 / 6, 10);
    expect(d.statuses[0].activePct30m).not.toBe(16.7);
    const edge = run(kw("11:50"), { activities: blocks("11:00", "11:30", 59.976) });
    expect(edge.open[0].detail).toMatchObject({ pct: 9.99 });
    expect(edge.open[0].detail.text).toContain("with 9% keyboard and mouse activity.");
    expect(edge.statuses[0].detail.idlePct).toBe(9.99);
  });

  test("slots carry inputTrackedS: phone time is tracked with none on the computer", () => {
    const d = run(kw("11:30"), { activities: [...blocks("10:00", "10:10", 300), ...blocks("10:10", "10:20", 0, { inputTracked: 0 })] });
    expect(d.slots.map(sl => [sl.trackedS, sl.inputTrackedS, sl.idle])).toEqual([[600, 600, false], [600, 0, false]]);
  });

  describe("on a break", () => {
    test("inside the break wait the state is on_break since they stopped; never an alert; after the wait, not_tracking", () => {
      const lunchLa = (t: number) => (t >= Date.parse(kw("13:00")) && t < Date.parse(kw("14:00")) ? { online: false, lastClientActivity: kw("13:00") } : live(t));
      const acts = [...blocks("10:00", "13:00", 360), ...blocks("14:00", "18:00", 360)];
      const states: string[] = [];
      for (const hhmm of ["13:10", "13:30", "13:55"]) {
        const t = Date.parse(kw(hhmm));
        const d = run(kw(hhmm), { la: lunchLa(t), activities: acts.filter(a => Date.parse(a.slotStart) + 600_000 <= t - 20 * 60_000) });
        expect(d.open).toEqual([]);
        states.push(`${d.statuses[0].state} ${new Date(Date.parse(d.statuses[0].since!) + 3 * 3600_000).toISOString().slice(11, 16)}`);
      }
      // 13:10: Hubstaff stopped 10 minutes ago, still inside the threshold, so it reads as running.
      expect(states).toEqual(["tracking 10:00", "on_break 13:00", "on_break 13:00"]);
      // A second stop has no break: not_tracking, as before.
      const second = run(kw("16:20"), { la: { online: false, lastClientActivity: kw("15:50") }, activities: [...blocks("10:00", "13:00", 360), ...blocks("14:00", "15:50", 360)] });
      expect(second.statuses[0].state).toBe("not_tracking");
    });
  });

  describe("part-day leave", () => {
    const afternoon = person({ leave: [{ start: kw("14:00"), end: kw("18:00") }] });
    const morning = person({ leave: [{ start: kw("10:00"), end: kw("12:00") }] });
    test("no not_tracking opens inside a window; the status is on_leave since it started", () => {
      const d = run(kw("11:30"), { people: [morning], la: OFF });
      expect(d.open).toEqual([]);
      expect(d.statuses[0]).toMatchObject({ state: "on_leave", since: kw("10:00") });
      expect(d.onShift).toBe(1);
      const pm = run(kw("16:00"), { people: [afternoon], la: { online: false, lastClientActivity: kw("14:00") }, activities: blocks("10:00", "14:00", 360) });
      expect(pm.open).toEqual([]);
      expect(pm.statuses[0]).toMatchObject({ state: "on_leave", since: kw("14:00") });
      // No account and on leave: no "not in Hubstaff" post either.
      const nada = run(kw("11:00"), { people: [person({ hubstaffUserId: null, accountStatus: "invited", leave: morning.leave })] });
      expect(nada.open).toEqual([]);
      expect(nada.statuses[0].state).toBe("on_leave");
    });
    test("off time never counts from before a window's end: back from morning leave, alerts at its end + the threshold", () => {
      expect(run(kw("12:29"), { people: [morning], la: OFF }).open).toEqual([]);
      const d = run(kw("12:30"), { people: [morning], la: OFF });
      expect(d.open).toEqual([expect.objectContaining({ kind: "not_tracking", detail: expect.objectContaining({ since: kw("12:00") }) })]);
      expect(d.open[0].detail.text).toContain("has not had Hubstaff on since 12:00");
      // Tracked before a mid-day window and not back after it: due back at its end, so the threshold, not the break.
      const mid = person({ leave: [{ start: kw("12:00"), end: kw("14:00") }] });
      const back = run(kw("14:30"), { people: [mid], la: { online: false, lastClientActivity: kw("12:00") }, activities: blocks("10:00", "12:00", 360) });
      expect(back.open.map(o => [o.kind, o.detail.since])).toEqual([["not_tracking", kw("14:00")]]);
      // Leave between two tracked stretches is not the day's break: the next stop still gets it.
      const lunchLater = run(kw("16:30"), { people: [mid], la: { online: false, lastClientActivity: kw("16:00") }, activities: [...blocks("10:00", "12:00", 360), ...blocks("14:00", "16:00", 360)] });
      expect(lunchLater.open).toEqual([]);
      expect(lunchLater.statuses[0].state).toBe("on_break");
    });
    test("the idle and not-work windows skip it", () => {
      const p = person({ leave: [{ start: kw("11:00"), end: kw("11:30") }] });
      // A timer left running at 0% during leave is never idle.
      expect(run(kw("11:55"), { people: [p], activities: blocks("11:00", "11:30", 0) }).open).toEqual([]);
      // Screenshots off work inside the window never count.
      expect(run(kw("11:35"), { people: [p], shots: [shot(1, "11:12", "not_work"), shot(2, "11:22", "not_work")] }).open).toEqual([]);
      expect(run(kw("11:35"), { shots: [shot(1, "11:12", "not_work"), shot(2, "11:22", "not_work")] }).open.length).toBe(1);
    });
    test("the roster's windows are read defensively: each a start before its end, oldest first", () => {
      const p = parsePerson({ personId: 4, leave: [{ start: kw("15:00"), end: kw("16:00") }, { start: kw("12:00"), end: kw("11:00") }, { start: "x", end: kw("12:00") }, "nope", { start: kw("10:00"), end: kw("11:00") }] });
      expect(p?.leave).toEqual([{ start: kw("10:00"), end: kw("11:00") }, { start: kw("15:00"), end: kw("16:00") }]);
      expect(parsePerson({ personId: 4 })?.leave).toEqual([]);
    });
  });

  test("an open 'not in Hubstaff' alert closes as not_watched once the person is not employed or is paused", () => {
    for (const offReason of ["not_employed", "paused"] as const) {
      const inc = incident("not_tracking", kw("10:15", "2026-10-11"), { reason: "no_account" });
      const d = run(kw("12:00"), { people: [person({ hubstaffUserId: null, accountStatus: "invited", offReason, shift: null })], open: [inc] });
      expect(d.close).toEqual([{ id: inc.id, closeReason: "not_watched", detail: expect.objectContaining({ resolveText: "No longer watched: this person no longer has to track time." }) }]);
      expect(d.open).toEqual([]);
    }
    // A day off is not leaving: it stays open, one post across days.
    const inc = incident("not_tracking", kw("10:15", "2026-10-11"), { reason: "no_account" });
    expect(run(kw("12:00"), { people: [person({ hubstaffUserId: null, offReason: "day_off", shift: null })], open: [inc] }).close).toEqual([]);
  });

  test("no_schedule is an off reason: off shift, the reason kept in the detail, nothing opens", () => {
    const p = parsePerson({ personId: 5, name: "Hourly", offReason: "no_schedule" });
    expect(p?.offReason).toBe("no_schedule");
    const d = run(kw("12:00"), { people: [{ ...p!, hubstaffUserId: "3616851", shift: null }], la: OFF });
    expect(d.open).toEqual([]);
    expect(d.statuses[0]).toMatchObject({ state: "off_shift", detail: { offReason: "no_schedule" } });
  });

  test("inputs: the mention settings and the break bounds the database uses", () => {
    expect(parseSettings({})).toMatchObject({ mention: true, mentionUser: "U09305KE2KS" });
    expect(parseSettings({ mention: false, mentionUser: "W0123ABCDE" })).toMatchObject({ mention: false, mentionUser: "W0123ABCDE" });
    expect(parseSettings({ mention: "yes", mentionUser: "<!channel>" })).toMatchObject({ mention: true, mentionUser: "U09305KE2KS" });
    expect(parseSettings({ mentionUser: "u09305ke2ks" }).mentionUser).toBe("U09305KE2KS");
    // The reviewers' recheck E: a saved 300-minute break was read as 60.
    expect(parseBreakRules({ breakMinutes: 300 })).toEqual({ breakMinutes: 300, breakWhenLongerThanHours: 6 });
    expect(parseBreakRules({ breakMinutes: 600, breakWhenLongerThanHours: 24 })).toEqual({ breakMinutes: 600, breakWhenLongerThanHours: 24 });
    expect(parseBreakRules({ breakMinutes: 601, breakWhenLongerThanHours: 0 })).toEqual({ breakMinutes: 60, breakWhenLongerThanHours: 6 });
  });
});
