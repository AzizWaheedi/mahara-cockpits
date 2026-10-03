// TIME stress for roomlogic.ts: whole days of rooms on a fake clock, midnight
// in Kuwait, and a lead (or a press) one second before and one second after
// every deadline. The SQL sweep owns the timers (contract v2 S1); where a
// test needs its decision it uses the rule as 20261003a writes it (sqlLeadDue
// below), and supabase/migrations/tests/stress_time.py runs the deployed
// sweep itself on the same moments.
//
//     bun test supabase/functions/sales-api/stress_time_rooms.test.ts

import { describe, expect, test } from "bun:test";
import {
  type Applied,
  type Changed,
  type RoomRow,
  applyRoomEvent,
  bookedDeadlines,
  clockWithDay,
  countdown,
  DEFAULT_ROOMS_SETTING,
  holdUntil,
  kuwaitClock,
  kuwaitDay,
  manualButtons,
  newRoomRow,
  roomCtx,
  roomHolds,
  roomsHealth,
  settleWanted,
  sweepRoom,
  timers,
  wrapPlan,
} from "./roomlogic.ts";

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (t: number) => new Date(t).toISOString();
const ctx = roomCtx(DEFAULT_ROOMS_SETTING);
const W = ctx.waits;
const HOST = "setter@stress.invalid";
const JOIN = "https://us06web.zoom.us/j/81234567890?pwd=abc";
/** Thursday 8 October 2026, 00:00 in Kuwait. */
const THU = Date.parse("2026-10-07T21:00:00.000Z");

function changed(a: Applied): Changed {
  if (!a.ok) throw new Error(`refused: ${a.code} ${a.message}`);
  return a;
}
/** Applies the change the way sales-api writes it (the patch lands). */
function land(room: RoomRow, a: Applied): RoomRow {
  return changed(a).room;
}

/** A fallback room for a booked intro, made at t0 and taken through the worker and the first send. */
function liveRoom(t0: number, over: Partial<RoomRow> = {}): RoomRow {
  let r = newRoomRow({
    id: "11111111-1111-4111-8111-111111111111",
    request_id: "22222222-2222-4222-8222-222222222222",
    code: "K7Q2MX",
    contact_id: "stress-time-lead",
    purpose: "fallback",
    call_kind: "intro",
    provider: "zoom",
    host_email: HOST,
    made_by: HOST,
    now: t0,
    appointment_id: "stress-time-appt",
  });
  r = land(r, applyRoomEvent(r, { kind: "claim", worker_run: "run-1" }, t0 + 1 * S, ctx));
  r = land(r, applyRoomEvent(r, { kind: "ready", join_url: JOIN, provider_meeting_id: "81234567890" }, t0 + 4 * S, ctx));
  r = land(r, applyRoomEvent(r, { kind: "link_sent", channel: "whatsapp_text", at: iso(t0 + 6 * S) }, t0 + 6 * S, ctx));
  return { ...r, ...over };
}

/**
 * The SQL sweep's R4 due time for a room with a lead (20261003a, R4): the
 * later of lead_by and an open or knock in the last grace, each capped at
 * link (or open) + lead + grace.
 */
function sqlLeadDue(r: RoomRow): number {
  const t = (v: unknown) => (typeof v === "string" ? Date.parse(v) : null);
  const cap = (t(r.link_sent_at) ?? (t(r.opened_at) as number)) + (W.lead + W.open_grace) * S;
  const base =
    t(r.lead_by) ??
    (t(r.link_sent_at) ?? t(r.host_in_at) ?? t(r.opened_at) ?? (t(r.requested_at) as number)) + W.lead * S;
  const open = t(r.last_open_at) ?? t(r.first_open_at);
  const knock = t(r.lead_waiting_at);
  return Math.max(
    base,
    open === null ? -Infinity : Math.min(open + W.open_grace * S, cap),
    knock === null ? -Infinity : Math.min(knock + W.open_grace * S, cap),
  );
}

/** What the SQL sweep writes when R4 closes a room with no lead in it. */
function sweptNoShow(r: RoomRow, at: number): RoomRow {
  return { ...r, state: "expired", end_reason: "lead_no_show", result: "no_join", ended_at: iso(at), version: r.version + 1 };
}

// ---------------------------------------------------------------------------
// A whole day, minute by minute
// ---------------------------------------------------------------------------

describe("a day of fallback rooms, one made every minute of a Kuwait Thursday into Friday", () => {
  test("every room gets the same deadlines whatever the hour, and the panel names the day only across midnight", () => {
    let crossed = 0;
    for (let m = 0; m < 1440 + 30; m++) {
      const t0 = THU + m * MIN;
      const r = liveRoom(t0);
      const link = t0 + 6 * S;
      expect(r.state).toBe("open");
      expect(Date.parse(r.lead_by as string)).toBe(link + W.lead * S);
      expect(Date.parse(r.host_by as string)).toBe(t0 + 4 * S + W.fallback_host * S);
      expect(Date.parse(r.ends_at as string)).toBe(t0 + 4 * S + 30 * MIN);
      const due = Date.parse(r.lead_by as string);
      const said = clockWithDay(due, link);
      const sameDay = kuwaitDay(due) === kuwaitDay(link);
      if (!sameDay) crossed++;
      expect(said.includes(" on ")).toBe(!sameDay);
      expect(said.startsWith(kuwaitClock(due))).toBe(true);
    }
    // Rooms whose link went in the last 10 minutes before a Kuwait midnight (two midnights in range).
    expect(crossed).toBe(10);
  });

  test("a lead joining one second before, and one second after, lead_by (the sweep has not run yet) is let in", () => {
    for (let m = 0; m < 1440; m += 7) {
      const r = liveRoom(THU + m * MIN);
      const due = Date.parse(r.lead_by as string);
      for (const at of [due - S, due + S]) {
        const a = applyRoomEvent(r, { kind: "lead_in", source: "zoom", at: iso(at) }, at + 300, ctx);
        expect(changed(a).to).toBe("lead_in");
        expect(changed(a).effects.some(e => e.kind === "count_live")).toBe(true);
      }
    }
  });

  test("the host gets in one second before host_by, and a meeting.ended one second after lead_by is the end", () => {
    const t0 = THU + 23 * HOUR + 55 * MIN;
    const r = liveRoom(t0);
    const hostBy = Date.parse(r.host_by as string);
    expect(changed(applyRoomEvent(r, { kind: "host_in", source: "zoom", at: iso(hostBy - S) }, hostBy - S, ctx)).to).toBe("host_in");
    const leadBy = Date.parse(r.lead_by as string);
    // Before the lead's deadline, Zoom ending an empty meeting is the host leaving: back to open.
    const early = changed(applyRoomEvent(r, { kind: "meeting_ended", at: iso(leadBy - S) }, leadBy - S, ctx));
    expect(early.to).toBe("open");
    const late = changed(applyRoomEvent(r, { kind: "meeting_ended", at: iso(leadBy + S) }, leadBy + S, ctx));
    expect([late.to, late.room.result]).toEqual(["ended", "no_join"]);
  });

  test("the reference timers fire exactly at their time, never a millisecond early", () => {
    const r = liveRoom(THU + 12 * HOUR);
    const due = Math.min(...timers(r, ctx).map(t => t.at));
    expect(changed(sweepRoom(r, due - 1, ctx)).changed).toBe(false);
    expect(changed(sweepRoom(r, due, ctx)).changed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The race at the deadline: the sweep closes, the lead arrives a second later
// ---------------------------------------------------------------------------

describe("the minute's sweep closes the room, then the lead's join lands one second later", () => {
  const start = THU + 14 * HOUR; // the booked intro, 14:00 Kuwait
  const r = liveRoom(start - 2 * MIN); // the setter rang at 13:58, no answer, sent a video link
  const closedAt = Date.parse(r.lead_by as string) + 5 * S; // the sweep ran 5 s after lead_by
  const swept = sweptNoShow(r, closedAt);

  test("Zoom's join and the host's press are kept as evidence on the closed room: it stays closed, the join is not lost", () => {
    const zoom = changed(applyRoomEvent(swept, { kind: "lead_in", source: "zoom", at: iso(closedAt + S) }, closedAt + 2 * S, ctx));
    expect([zoom.to, zoom.room.version, zoom.room.lead_in_at, zoom.room.result]).toEqual(["expired", swept.version, iso(closedAt + S), "joined"]);
    expect(zoom.effects.map(e => e.kind)).toEqual(["count_live"]);
    // The host pressed on the version they saw before the close.
    const press = changed(
      applyRoomEvent(swept, { kind: "lead_in", source: "mark", actor: { email: HOST }, version: r.version }, closedAt + 3 * S, ctx),
    );
    expect([press.to, press.room.lead_in_at]).toEqual(["expired", iso(closedAt + 3 * S)]);
    // Past the open grace after the close it is a new call, not this room's: refused.
    const late = applyRoomEvent(swept, { kind: "lead_in", source: "zoom", at: iso(closedAt + W.open_grace * S + S) }, closedAt + W.open_grace * S + 2 * S, ctx);
    expect(late.ok).toBe(false);
  });

  test("so the intro the lead joined is not settled as a no-show at start + 20 minutes", () => {
    // The lead is talking to the setter on Zoom (the worker holds the meeting: someone outside the team is in it).
    const after = applyRoomEvent(swept, { kind: "lead_in", source: "zoom", at: iso(closedAt + S) }, closedAt + 2 * S, ctx);
    const room = after.ok ? after.room : swept;
    expect(settleWanted(room, iso(start), false, start + W.settle * S + S, W)).toBe(false);
  });
});

describe("a booked intro moved to a later day", () => {
  test("yesterday's empty fallback room does not settle today's (moved) call as a no-show", () => {
    const yesterday = THU + 11 * HOUR;
    const r = liveRoom(yesterday);
    const swept = sweptNoShow(r, Date.parse(r.lead_by as string) + 20 * S);
    const movedStart = THU + DAY + 15 * HOUR; // the intro now starts Friday 15:00
    const now = movedStart + W.settle * S + S;
    expect(settleWanted(swept, iso(movedStart), false, now, W)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The dialer's hold and the sweep's open grace
// ---------------------------------------------------------------------------

describe("the dialer's queue hold lasts as long as the sweep keeps the room open", () => {
  test("a lead who opened the link 10 s before lead_by is not dialled while the room still waits for them", () => {
    const r0 = liveRoom(THU + 16 * HOUR);
    const leadBy = Date.parse(r0.lead_by as string);
    // The door writes only first_open_at and last_open_at (OPEN_COLUMNS); lead_by stays.
    const r: RoomRow = { ...r0, state: "host_in", host_in_at: iso(leadBy - 5 * MIN), first_open_at: iso(leadBy - 10 * S), last_open_at: iso(leadBy - 10 * S) };
    const sqlDue = sqlLeadDue(r);
    expect(sqlDue).toBe(leadBy + (W.open_grace - 10) * S); // the room stays open to here
    const now = leadBy + 60 * S; // the next minute's sweep keeps it
    expect(now < sqlDue).toBe(true);
    expect(roomHolds(r, now, ctx)).toBe(true);
    expect(holdUntil(r, ctx)).toBeGreaterThanOrEqual(sqlDue);
  });

  test("a knock moves lead_by itself, so the hold already follows it (control)", () => {
    const r0 = liveRoom(THU + 16 * HOUR);
    const leadBy = Date.parse(r0.lead_by as string);
    const r = land(r0, applyRoomEvent(r0, { kind: "lead_waiting", at: iso(leadBy - 10 * S) }, leadBy - 9 * S, ctx));
    expect(holdUntil(r, ctx)).toBe(Math.min(leadBy - 10 * S + W.open_grace * S, sqlLeadDue(r)));
    expect(roomHolds(r, leadBy + 60 * S, ctx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Every other boundary, to the millisecond
// ---------------------------------------------------------------------------

describe("boundaries, to the millisecond", () => {
  const setting = { ...DEFAULT_ROOMS_SETTING, enabled: true, test_only: false };
  const start = THU + 23 * HOUR + 50 * MIN; // a booked demo at 23:50 Kuwait, running into Friday
  const wrap = (now: number) =>
    wrapPlan({ setting, contact_id: "stress-time-lead", start: iso(start), end: iso(start + 45 * MIN), address: JOIN, call_kind: "demo", now, ctx });

  test("room.wrap opens exactly 30 minutes before the call and closes at its end", () => {
    expect(wrap(start - 30 * MIN - 1).ok).toBe(false);
    expect(wrap(start - 30 * MIN).ok).toBe(true);
    expect(wrap(start + 45 * MIN - 1).ok).toBe(true);
    expect(wrap(start + 45 * MIN).ok).toBe(false);
    const d = bookedDeadlines(start, start + 45 * MIN, "demo", ctx);
    expect([kuwaitDay(Date.parse(d.host_by)), kuwaitClock(Date.parse(d.host_by))]).toEqual(["2026-10-09", "00:05"]);
    expect(kuwaitClock(Date.parse(d.lead_by))).toBe("00:10");
  });

  test("That was not the lead: allowed 300 s after the join, refused 1 ms later", () => {
    const r0 = liveRoom(THU + 9 * HOUR);
    const joined = Date.parse(r0.lead_by as string) - 2 * MIN;
    const r = land(r0, applyRoomEvent(r0, { kind: "lead_in", source: "zoom", at: iso(joined) }, joined, ctx));
    const act = (now: number) =>
      applyRoomEvent(r, { kind: "not_lead", actor: { email: HOST }, version: r.version }, now, ctx);
    expect(act(joined + W.not_lead_undo * S).ok).toBe(true);
    const late = act(joined + W.not_lead_undo * S + 1);
    expect(late.ok ? "allowed" : late.code).toBe("not_lead_late");
  });

  test("the manual buttons show 30 s after the link, not a millisecond sooner", () => {
    const r = liveRoom(THU);
    const link = Date.parse(r.link_sent_at as string);
    expect(manualButtons(r, link + W.manual_buttons * S - 1, W)).toBe(false);
    expect(manualButtons(r, link + W.manual_buttons * S, W)).toBe(true);
  });

  test("the health line turns red after 90 s, and on a clock 5 minutes ahead", () => {
    const now = THU + 10 * HOUR;
    const h = (last: number) => roomsHealth({ now, last_run_at: iso(last), rooms_today: 1, failed_today: 0 }).worker_ok;
    expect(h(now - 90 * S)).toBe(true);
    expect(h(now - 90 * S - 1)).toBe(false);
    expect(h(now + 5 * MIN)).toBe(true);
    expect(h(now + 5 * MIN + 1)).toBe(false);
  });

  test("countdowns never go below 0:00 and round down", () => {
    expect(countdown(-5 * S)).toBe("0:00");
    expect(countdown(Number.NaN)).toBe("0:00");
    expect(countdown(10 * MIN - 1)).toBe("9:59");
    expect(countdown(10 * MIN)).toBe("10:00");
  });

  test("Kuwait midnight is 21:00 UTC: the day changes on the second", () => {
    const before = Date.parse("2026-10-08T20:59:59.999Z");
    const after = Date.parse("2026-10-08T21:00:00.000Z");
    expect(kuwaitDay(before)).toBe("2026-10-08");
    expect(kuwaitDay(after)).toBe("2026-10-09");
    expect(clockWithDay(after, before)).toBe("00:00 on Fri 9 Oct");
    expect(clockWithDay(before, before)).toBe("23:59");
  });
});
