// Tests for the fixes to the adversarial review of roomlogic.ts (2026-10-03).
// Each block names its finding: the review's numbers 1 to 26 ("#n"), with
// the adversarial file's test ids in brackets where they differ ("F19").
// roomlogic.adversarial.test.ts pins each finding's own scenario; these pin
// the rest of every fix, and the last block runs the effects themselves
// (the message service, the count and the undo) with crashes in between.

import { describe, expect, test } from "bun:test";
import {
  type Applied,
  type Changed,
  type Effect,
  type GuardedWrite,
  type RoomEvent,
  type RoomRow,
  adoptRefusal,
  appHomeReadyLine,
  applyRoomEvent,
  COUNT_STUCK_S,
  countClaim,
  countFinish,
  countInFlight,
  countLive,
  countUndo,
  countUndone,
  createRefusal,
  DEFAULT_ROOMS_JSON,
  DEFAULT_ROOMS_SETTING,
  eventTime,
  fill,
  guardFilter,
  holdUntil,
  holdsHostLink,
  isHostLink,
  LANE_COPY,
  leadJoined,
  linkDue,
  MAX_WRITE_TRIES,
  meetingFromAddress,
  newRoomRow,
  nextDueAt,
  offerLine,
  panelLine,
  PENDING_HOLD_MAX_S,
  presenceOf,
  presenceView,
  REASK_AFTER_S,
  REASK_WINDOW_S,
  redactRoom,
  refuse,
  ROOM_COPY,
  roomCtx,
  roomsHealth,
  roomsSetting,
  settleDue,
  shortUrl,
  standbyToEnd,
  stripLine,
  stripOfferLine,
  sweepRoom,
  timers,
  toRoomView,
  wrapPlan,
  wrapRoomRow,
} from "./roomlogic.ts";

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
/** Sunday 4 October 2026, 11:00 in Kuwait. */
const T0 = Date.parse("2026-10-04T08:00:00.000Z");
const ROOM_ID = "3f2a9c1e-7b4d-4e8a-9c2f-0a1b2c3d4e5f";
const SETTER = "setter@maharamedia.com";
const CLOSER = "closer@maharamedia.com";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=AbC123";
const START_URL = "https://us06web.zoom.us/s/81234567890?zak=eyJhbGciOiJIUzI1NiJ9.HOSTTOKEN.sig";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ctx = roomCtx(DEFAULT_ROOMS_SETTING);
const countOn = roomCtx({ ...DEFAULT_ROOMS_SETTING, count_on_join: true });
const W = ctx.waits;
const at = (t: number) => new Date(t).toISOString();
const ON = roomsSetting({ ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, providers: { zoom: true, meet: true } });
const COUNT_ON = roomsSetting({ ...DEFAULT_ROOMS_JSON, count_on_join: true, test_calendar_id: "TESTCAL", live_calendar_id: "LIVECAL" });
const LEAD = { phone: "+96550001234", email: "lead@example.com", tags: ["roas-qualified"], dnd: false, dndSettings: {} };

function room(over: Partial<RoomRow> = {}): RoomRow {
  return {
    ...newRoomRow({
      id: ROOM_ID,
      request_id: "9b0c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3",
      code: "K7Q2MX",
      contact_id: "c1",
      purpose: "fallback",
      call_kind: "intro",
      provider: "meet",
      host_email: SETTER,
      made_by: SETTER,
      now: T0,
    }),
    ...over,
  };
}
function ok(a: Applied): Changed {
  if (!a.ok) throw new Error(`refused: ${a.code}: ${a.message}`);
  return a;
}
const apply = (r: RoomRow, e: RoomEvent, t: number, c = ctx) => applyRoomEvent(r, e, t, c);
const step = (r: RoomRow, e: RoomEvent, t: number, c = ctx) => ok(apply(r, e, t, c)).room;
const claimed = (over: Partial<RoomRow> = {}) => step(room(over), { kind: "claim", worker_run: "run-1" }, T0);
function opened(over: Partial<RoomRow> = {}, url = MEET_URL): RoomRow {
  return step(claimed(over), { kind: "ready", join_url: url }, T0 + 5 * S);
}
const kinds = (a: Applied) => (a.ok ? a.effects.map(e => e.kind) : []);
const sends = (a: Applied) => (a.ok ? a.effects.filter(e => e.kind === "send_link").length : 0);

/** One row behind a compare-and-set write, the way a PATCH with guardFilter(expect) behaves. */
class Store {
  writes = 0;
  constructor(public row: RoomRow) {}
  writeGuarded(w: GuardedWrite | Changed): boolean {
    const cur = this.row as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(w.expect)) if ((cur[k] ?? null) !== (v ?? null)) return false;
    this.row = { ...this.row, ...w.patch };
    this.writes++;
    return true;
  }
  /** Read, apply, write; a lost write is read again, at most MAX_WRITE_TRIES times. Returns what landed. */
  run(e: RoomEvent, t: number, c = ctx, from?: RoomRow): Applied | null {
    let snap = from ?? this.row;
    for (let i = 0; i < MAX_WRITE_TRIES; i++) {
      const a = applyRoomEvent(snap, e, t, c);
      if (!a.ok || !a.changed) return a;
      if (this.writeGuarded(a)) return a;
      snap = this.row;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// #1 (F19): sales-api applies worker.ready; the worker writes only the link
// ---------------------------------------------------------------------------

describe("#1 who opens a room", () => {
  test("the worker saves only the link on the creating row; worker.ready with no payload opens it and asks for the link once", () => {
    const workerSaved: RoomRow = { ...claimed(), join_url: MEET_URL, provider_meeting_id: "evt-1" };
    expect(workerSaved.state).toBe("creating");
    const a = ok(apply(workerSaved, { kind: "ready" }, T0 + 6 * S));
    expect(a.to).toBe("open");
    expect(a.room).toMatchObject({ join_url: MEET_URL, provider_meeting_id: "evt-1", opened_at: at(T0 + 6 * S), link_claimed_at: at(T0 + 6 * S) });
    expect(a.room.lead_by).toBe(at(T0 + 6 * S + W.lead * S));
    expect(kinds(a)).toEqual(["send_link"]);
    // The handler's retry, or a second worker.ready, asks for nothing more.
    expect(ok(apply(a.room, { kind: "ready" }, T0 + 9 * S)).changed).toBe(false);
  });

  test("a worker.ready that never landed: the sweep opens the room at claim + 15 s, once, and the late worker.ready is a no-op", () => {
    const workerSaved: RoomRow = { ...claimed(), join_url: MEET_URL };
    expect(timers(workerSaved, ctx).find(t => t.reason === "recover")?.at).toBe(T0 + W.ready * S);
    expect(ok(sweepRoom(workerSaved, T0 + 14 * S, ctx)).changed).toBe(false);
    const swept = ok(sweepRoom(workerSaved, T0 + 15 * S, ctx));
    expect([swept.to, swept.reason]).toEqual(["open", "recover"]);
    expect(kinds(swept)).toEqual(["send_link"]);
    const late = ok(apply(swept.room, { kind: "ready" }, T0 + 20 * S));
    expect([late.changed, sends(late)]).toEqual([false, 0]);
    // Without a saved link the old recover stands: the worker looks for the code at 60 s.
    expect(ok(sweepRoom(claimed(), T0 + 60 * S, ctx)).effects).toEqual([{ kind: "recover" }]);
  });

  test("a row an older worker opened itself is finished once; a host_in row too, with the link claimed", () => {
    const own: RoomRow = { ...claimed(), state: "open", join_url: MEET_URL };
    const a = ok(apply(own, { kind: "ready", join_url: MEET_URL }, T0 + 6 * S));
    expect([a.to, a.room.version, sends(a)]).toEqual(["open", own.version, 1]);
    expect(ok(apply(a.room, { kind: "ready", join_url: MEET_URL }, T0 + 7 * S)).changed).toBe(false);
  });

  test("worker.failed fails the room through the same rules, with the error redacted", () => {
    const f = ok(apply(claimed({ provider: "zoom" }), { kind: "fail", error: `Zoom said no: ${START_URL}` }, T0 + 3 * S));
    expect(f.to).toBe("failed");
    expect(f.room.error).not.toContain("HOSTTOKEN");
    expect(f.room.error).toContain("[host link]");
  });
});

// ---------------------------------------------------------------------------
// #2 (F1): the link is claimed in the same write that asks for it
// ---------------------------------------------------------------------------

describe("#2 the link goes once", () => {
  test("ready and the host's join raced from one snapshot: the compare-and-set lets only one ask", () => {
    const store = new Store({ ...claimed({ provider: "zoom" }), join_url: ZOOM_URL });
    const snap = store.row;
    const asked: Effect[] = [];
    const r1 = store.run({ kind: "ready" }, T0 + 5 * S, ctx, snap);
    if (r1?.ok) asked.push(...r1.effects);
    // The host's join, applied by another request that read the room before ready landed: it re-reads and finds the claim.
    const r2 = store.run({ kind: "host_in", source: "zoom" }, T0 + 6 * S);
    if (r2?.ok) asked.push(...r2.effects);
    expect(asked.filter(e => e.kind === "send_link").length).toBe(1);
    expect(store.row.state).toBe("host_in");
  });

  test("a send nobody claimed (Also send by email first) closes the claim, so the host's join asks for nothing", () => {
    const r = opened({ purpose: "handover", send_on: "host_in", provider: "zoom", host_email: CLOSER, call_kind: "demo" }, ZOOM_URL);
    expect(linkDue({ ...r, state: "host_in" })).toBe(true);
    const sent = step(r, { kind: "link_sent", channel: "email" }, T0 + 20 * S);
    expect(sent.link_claimed_at).toBe(at(T0 + 20 * S));
    expect(sends(apply(sent, { kind: "host_in", source: "zoom" }, T0 + 30 * S))).toBe(0);
  });

  test("a room whose link is a host link is never due", () => {
    expect(linkDue({ ...opened(), link_claimed_at: null, join_url: START_URL })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #3 (F3): a host link never reaches a lead
// ---------------------------------------------------------------------------

describe("#3 start links and zak tokens", () => {
  test("isHostLink knows Zoom's start links and any zak token; join links pass", () => {
    for (const u of [START_URL, "https://zoom.us/s/812?x=1", "https://us06web.zoom.us/wc/812/start", "https://zoomgov.com/s/1", "https://us06web.zoom.us/j/812?zak=abc"])
      expect([u, isHostLink(u)]).toEqual([u, true]);
    for (const u of [ZOOM_URL, MEET_URL, "https://us06web.zoom.us/my/ahmed", "https://example.com/s/1"]) expect([u, isHostLink(u)]).toEqual([u, false]);
  });

  test("the address keeps only a join link: /j/ or /my/, never /s/ or /w/; with both, the join link is taken", () => {
    expect(meetingFromAddress(`Host: ${START_URL} Join: ${ZOOM_URL}`)).toEqual({ provider: "zoom", join_url: ZOOM_URL, meeting_id: "81234567890" });
    expect(meetingFromAddress("https://us06web.zoom.us/my/ahmed.room")).toEqual({ provider: "zoom", join_url: "https://us06web.zoom.us/my/ahmed.room", meeting_id: null });
    expect(meetingFromAddress("https://us06web.zoom.us/w/81234567890?tk=x")).toBe(null);
    expect(meetingFromAddress("https://us06web.zoom.us/j/81234567890?zak=abc")).toBe(null);
  });

  test("room.wrap refuses an address holding only a start link, and says what to do", () => {
    const r = wrapPlan({ setting: ON, contact_id: "c1", start: at(T0 + 10 * MIN), address: `Zoom: ${START_URL}`, call_kind: "demo", now: T0, ctx });
    expect(!r.ok && [r.code, r.message]).toEqual(["host_link", LANE_COPY.host_link]);
    expect(holdsHostLink("call me on +965 5000 1234")).toBe(false);
  });

  test("the worker can never save a start link as the room's link; the view and the short link drop one already stored", () => {
    const c = claimed({ provider: "zoom" });
    const bad = apply(c, { kind: "ready", join_url: START_URL }, T0 + 5 * S);
    expect(!bad.ok && bad.code).toBe("bad_link");
    const stored = { ...opened({ provider: "zoom" }, ZOOM_URL), join_url: START_URL };
    const v = toRoomView(stored, { short_link: false });
    expect([v.join_url, v.short_url]).toEqual([null, null]);
    expect(shortUrl("K7Q2MX", START_URL, false)).toBe(null);
  });

  test("redactRoom takes out start links and zak tokens before lib's redact", () => {
    expect(redactRoom(`failed at ${START_URL} for user`)).toBe("failed at [host link] for user");
    // Contract v2 section 9: lib's redact hides pwd= too (only in errors and logs; a join link is never redacted).
    expect(redactRoom("https://us06web.zoom.us/j/1?zak=SECRET&pwd=x")).toBe("https://us06web.zoom.us/j/1?zak=[key]&pwd=[key]");
    expect(redactRoom("Bearer abc.def")).toBe("Bearer [key]");
    expect(redactRoom("")).toBe(null);
    expect((redactRoom("x".repeat(5000)) as string).length).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// #4 (F5): timers wait for unhandled events; events carry their own time
// ---------------------------------------------------------------------------

describe("#4 pending events and event times", () => {
  const sent = () => step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "link_sent" }, T0 + 10 * S);

  test("a pending event holds the expiry for at most 5 minutes; a count that could not be read holds too", () => {
    const r = sent();
    const leadBy = Date.parse(r.lead_by as string);
    expect(ok(sweepRoom(r, leadBy + 4 * MIN, ctx, null, { pending_events: 2 })).changed).toBe(false);
    expect(ok(sweepRoom(r, leadBy + 4 * MIN, ctx, null, { pending_events: null })).changed).toBe(false);
    expect(ok(sweepRoom(r, leadBy + 4 * MIN, ctx, null, { pending_events: Number.NaN })).changed).toBe(false);
    expect(ok(sweepRoom(r, leadBy + PENDING_HOLD_MAX_S * S, ctx, null, { pending_events: 2 })).to).toBe("expired");
    expect(ok(sweepRoom(r, leadBy, ctx, null, { pending_events: 0 })).to).toBe("expired");
  });

  test("the replayed knock then lands with its own time and the grace keeps the room", () => {
    const r = sent();
    const leadBy = Date.parse(r.lead_by as string);
    const held = ok(sweepRoom(r, leadBy + 15 * S, ctx, null, { pending_events: 1 })).room;
    const knock = ok(apply(held, { kind: "lead_waiting", at: at(leadBy - 5 * S) }, leadBy + 20 * S));
    expect(knock.room.lead_waiting_at).toBe(at(leadBy - 5 * S));
    expect(knock.room.lead_by).toBe(at(leadBy - 5 * S + W.open_grace * S));
    expect(ok(sweepRoom(knock.room, leadBy + 30 * S, ctx, null, { pending_events: 0 })).changed).toBe(false);
  });

  test("stamps: Zoom's time for Zoom, now for a press; a time ahead of our clock or a day old is now", () => {
    const r = sent();
    const t = T0 + 3 * MIN;
    expect(step(r, { kind: "lead_in", source: "zoom", at: at(t - 40 * S) }, t).lead_in_at).toBe(at(t - 40 * S));
    expect(step(r, { kind: "lead_in", source: "mark", at: at(t - 40 * S), actor: { email: SETTER } }, t).lead_in_at).toBe(at(t));
    expect(eventTime(at(t + 3 * S), t)).toBe(t);
    expect(eventTime(at(t + 60 * S), t)).toBe(t);
    expect(eventTime(t - 2 * 86_400_000, t)).toBe(t);
    expect(eventTime("garbage", t)).toBe(t);
  });

  test("late, out-of-order Zoom events: a host_left from before the host came back, and an earlier meeting's end, change nothing", () => {
    const back = step(sent(), { kind: "host_in", source: "zoom", at: at(T0 + 2 * MIN) }, T0 + 2 * MIN);
    expect(ok(apply(back, { kind: "host_left", at: at(T0 + 90 * S) }, T0 + 2 * MIN + 5 * S)).changed).toBe(false);
    const joined = step(back, { kind: "lead_in", source: "zoom", at: at(T0 + 4 * MIN) }, T0 + 4 * MIN);
    expect(ok(apply(joined, { kind: "meeting_ended", at: at(T0 + 3 * MIN) }, T0 + 5 * MIN)).changed).toBe(false);
    const real = ok(apply(joined, { kind: "meeting_ended", at: at(T0 + 30 * MIN) }, T0 + 30 * MIN + 20 * S));
    expect([real.to, real.room.ended_at]).toEqual(["ended", at(T0 + 30 * MIN)]);
  });
});

// ---------------------------------------------------------------------------
// #5 (F2): presence follows availability; the standby room follows it too
// ---------------------------------------------------------------------------

describe("#5 availability and the standby room", () => {
  const sbIn = () =>
    step(opened({ purpose: "standby", contact_id: null, call_kind: "demo", provider: "zoom", host_email: CLOSER }, ZOOM_URL), { kind: "host_in", source: "zoom" }, T0 + 30 * S);
  const base = { email: CLOSER, now: T0 + MIN, open_attempt: false, appointment_now: false, default_provider: "zoom" as const };

  test("ready only while Available runs; then away, and the strip says Away, never a raw {until}", () => {
    const ready = presenceOf({ ...base, availability: { state: "available", until: at(T0 + HOUR) }, rooms: [sbIn()] });
    expect([ready.state, ready.until]).toEqual(["ready", at(T0 + HOUR)]);
    expect(stripLine(ready, T0 + MIN)).toBe("In your room until 12:00. The next live lead comes to you.");
    for (const availability of [{ state: "away", until: null }, { state: "available", until: at(T0) }, null]) {
      const p = presenceOf({ ...base, availability, rooms: [sbIn()] });
      expect([p.state, p.room_id, stripLine(p, T0 + MIN)]).toEqual(["away", null, "Away"]);
    }
    expect(stripLine({ state: "available", until: at(T0 + HOUR) }, T0)).toBe("Available until 12:00. Join your room to get leads first.");
    expect(stripLine({ state: "on_call", until: null }, T0)).toBe(null);
  });

  test("presenceView gives the contract's shape, without why", () => {
    const p = presenceOf({ ...base, availability: null, rooms: [] });
    expect(Object.keys(presenceView(p)).sort()).toEqual(["default_provider", "email", "room_id", "state", "until", "zoom_status"]);
  });

  test("the sweep closes an empty standby room once Available ends, and never refreshes it", () => {
    const sb = sbIn();
    const gone = ok(sweepRoom(sb, T0 + 10 * MIN, ctx, null, { available_until: at(T0 + 9 * MIN) }));
    expect([gone.to, gone.reason]).toEqual(["expired", "availability"]);
    expect(kinds(gone)).toEqual(["delete_secret", "close_provider"]);
    expect(ok(sweepRoom(sb, T0 + 10 * MIN, ctx, null, { available_until: null })).reason).toBe("availability");
    expect(ok(sweepRoom(sb, T0 + 10 * MIN, ctx, null, { available_until: at(T0 + HOUR) })).changed).toBe(false);
    const max = T0 + 5 * S + W.standby_max * S;
    expect(kinds(ok(sweepRoom(sb, max, ctx, null, { available_until: at(max - S) })))).not.toContain("refresh_standby");
    expect(kinds(ok(sweepRoom(sb, max, ctx, null, { available_until: at(max + HOUR) })))).toContain("refresh_standby");
  });

  test("Go away ends the rep's empty standby rooms only", () => {
    const sb = sbIn();
    const other = { ...sbIn(), id: "other", host_email: SETTER };
    const handover = { ...sbIn(), id: "h", contact_id: "c9", purpose: "handover" as const };
    expect(standbyToEnd([sb, other, handover, { ...sb, id: "x", state: "expired" as const }], CLOSER).map(r => r.id)).toEqual([ROOM_ID]);
  });
});

// ---------------------------------------------------------------------------
// #6 (F20): the sweep asks again for what a crash lost
// ---------------------------------------------------------------------------

describe("#6 re-asks", () => {
  const joined = () => step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "lead_in", source: "zoom" }, T0 + MIN);

  test("a count never claimed is asked again from a minute after the join, for an hour, only with count_on_join on", () => {
    const j = joined();
    expect(kinds(ok(sweepRoom(j, T0 + MIN + 59 * S, countOn)))).not.toContain("count_live");
    expect(ok(sweepRoom(j, T0 + 2 * MIN, countOn)).effects).toContainEqual({ kind: "count_live", retry: true });
    expect(kinds(ok(sweepRoom(j, T0 + 2 * MIN, ctx)))).not.toContain("count_live");
    expect(kinds(ok(sweepRoom(j, T0 + MIN + REASK_WINDOW_S * S + S, countOn)))).not.toContain("count_live");
    // Also once the room closed (the end came before the count ran).
    const ended = step(j, { kind: "meeting_ended" }, T0 + 90 * S);
    expect(kinds(ok(sweepRoom(ended, T0 + 3 * MIN, countOn)))).toEqual(["count_live"]);
  });

  test("a claim stuck with no result is flagged once at 2 minutes (one dedupe key)", () => {
    const j = { ...joined(), count_claimed_at: at(T0 + MIN) };
    expect(kinds(ok(sweepRoom(j, T0 + MIN + (COUNT_STUCK_S - 1) * S, countOn)))).toEqual([]);
    const a = ok(sweepRoom(j, T0 + MIN + COUNT_STUCK_S * S, countOn));
    expect(a.effects).toEqual([{ kind: "alert", what: "count_stuck", dedupe_key: `room:${ROOM_ID}:count_stuck:${at(T0 + MIN)}` }]);
    expect(kinds(ok(sweepRoom({ ...j, count_result: "booked", count_appointment_id: "B1" }, T0 + 5 * MIN, countOn)))).toEqual([]);
  });

  test("an undo that never landed is asked again until the booking is gone", () => {
    const booked = { ...joined(), count_claimed_at: at(T0 + MIN), count_result: "booked" as const, count_appointment_id: "B1" };
    const undone = step(booked, { kind: "not_lead", actor: { email: SETTER } }, T0 + 2 * MIN);
    expect(ok(sweepRoom(undone, T0 + 2 * MIN + REASK_AFTER_S * S, ctx)).effects).toContainEqual({ kind: "undo_count", retry: true });
    expect(kinds(ok(sweepRoom({ ...undone, count_result: "undone" }, T0 + 4 * MIN, ctx)))).not.toContain("undo_count");
  });

  test("a link claimed and never sent is asked again each sweep while the room is open; never once sent or in lead_in", () => {
    const r = opened();
    expect(kinds(ok(sweepRoom(r, T0 + 5 * S + 59 * S, ctx)))).toEqual([]);
    expect(ok(sweepRoom(r, T0 + 5 * S + 60 * S, ctx)).effects).toEqual([{ kind: "send_link", retry: true }]);
    expect(kinds(ok(sweepRoom(step(r, { kind: "link_sent" }, T0 + 70 * S), T0 + 3 * MIN, ctx)))).toEqual([]);
    expect(kinds(ok(sweepRoom(step(r, { kind: "lead_in", source: "mark" }, T0 + 70 * S), T0 + 3 * MIN, ctx)))).toEqual([]);
  });

  test("nextDueAt: the earliest timer or re-ask, so SQL can pick due rooms without its own copy of the rules", () => {
    const r = opened();
    expect(nextDueAt(r, T0 + 10 * S, ctx)).toBe(T0 + 5 * S + REASK_AFTER_S * S);
    const sent = step(r, { kind: "link_sent" }, T0 + 10 * S);
    expect(nextDueAt(sent, T0 + 20 * S, ctx)).toBe(Date.parse(sent.lead_by as string));
    const ended = step(joined(), { kind: "meeting_ended" }, T0 + 90 * S);
    expect(nextDueAt(ended, T0 + 2 * MIN, countOn)).toBe(T0 + 2 * MIN);
    expect(nextDueAt(ended, T0 + 2 * MIN, ctx)).toBe(null);
    expect(nextDueAt(ended, T0 + 2 * HOUR, countOn)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// #7 (F4) and #17: the lead's checks, the switches and the pilot
// ---------------------------------------------------------------------------

describe("#7 #17 #21 room.create, Take and room.wrap", () => {
  const okHost = { zoom_status: "licensed" as const, zoom_live: false, google_ok: true };
  const input = (over: Partial<Parameters<typeof createRefusal>[0]> = {}) =>
    createRefusal({ setting: ON, purpose: "fallback", provider: "meet", call_kind: "intro", contact_id: "c1", contact: LEAD, host: okHost, host_email: SETTER, lead_room_open: false, host_room_open: false, booked_demo: false, booked_intro: true, ...over });

  test("an unread contact is refused with a sentence that says what to do; a standby room needs none", () => {
    const r = input({ contact: null });
    expect([r?.code, r?.message, r?.retry]).toEqual(["contact_unread", "HighLevel did not answer, so we cannot check this lead yet. Try again in a minute.", true]);
    expect(input({ purpose: "standby", contact_id: null, contact: null, provider: "zoom", call_kind: "demo" })).toBe(null);
  });

  test("fallback.scope intro needs a booked intro; any does not; the pilot list holds the seats", () => {
    expect(input({ booked_intro: false })?.message).toBe(LANE_COPY.fallback_scope);
    expect(input({ booked_intro: false, purpose: "manual" })).toBe(null);
    const any = { ...ON, fallback: { ...ON.fallback, scope: "any" } };
    expect(input({ booked_intro: false, setting: any })).toBe(null);
    const pilot = { ...ON, fallback: { ...ON.fallback, pilot_emails: ["closer@maharamedia.com"] } };
    expect(input({ setting: pilot })?.code).toBe("fallback_pilot");
    expect(input({ setting: pilot, host_email: " Closer@MaharaMedia.com " })).toBe(null);
  });

  test("both providers off is the off switch; client and do-not-disturb come before the provider", () => {
    const off = { ...ON, providers: { zoom: false, meet: false } };
    expect(input({ setting: off })?.code).toBe("disabled");
    const meetOff = { ...ON, providers: { zoom: true, meet: false } };
    expect(input({ setting: meetOff, contact: { ...LEAD, tags: ["client"] } })?.code).toBe("client");
    expect(input({ setting: meetOff, contact: { ...LEAD, dnd: true } })?.code).toBe("dnd");
  });

  test("Zoom refusals say 'use Meet' only when Meet can be used", () => {
    const zoom = (host: Partial<typeof okHost>, setting = ON) => input({ provider: "zoom", call_kind: "demo", host: { ...okHost, ...host }, setting });
    expect(zoom({ zoom_status: "missing" as never })?.message).toBe(LANE_COPY.zoom_missing);
    expect(zoom({ zoom_status: "missing" as never, google_ok: false })?.message).toBe(LANE_COPY.zoom_missing_no_meet);
    expect(zoom({ zoom_status: "pending" as never }, { ...ON, providers: { zoom: true, meet: false } })?.message).toBe("Your Zoom seat is not active yet. Accept Zoom's email invite.");
    expect(zoom({ zoom_live: true, google_ok: false })?.message).toBe("Your Zoom is in another meeting. End it first.");
    expect(zoom({ zoom_status: "basic" as never, google_ok: false })?.message).toBe(LANE_COPY.zoom_basic_demo_no_meet);
    expect(zoom({ zoom_status: "basic" as never })?.message).toBe(ROOM_COPY.refusals.zoom_basic_demo);
    expect(input({ contact_id: null })?.message).toBe("Choose a lead first.");
  });

  test("Take on a standby room runs the lead's checks: switch, unread contact, test list, client, do-not-disturb", () => {
    const take = (over: Partial<Parameters<typeof adoptRefusal>[0]> = {}) => adoptRefusal({ setting: ON, contact_id: "c1", contact: LEAD, ...over })?.code ?? null;
    expect(take()).toBe(null);
    expect(take({ setting: DEFAULT_ROOMS_SETTING })).toBe("disabled");
    expect(take({ contact: null })).toBe("contact_unread");
    expect(take({ setting: { ...ON, test_only: true } })).toBe("test_only");
    expect(take({ setting: { ...ON, test_only: true }, contact_id: "VjPfR4Cc1Y0OFvaqeor5" })).toBe(null);
    expect(take({ contact: { ...LEAD, tags: ["client"] } })).toBe("client");
    expect(take({ contact: { ...LEAD, dnd: true } })).toBe("dnd");
    expect(take({ contact_id: null })).toBe("no_contact");
  });

  test("room.wrap obeys the off switch and the test list", () => {
    const w = (over: Partial<Parameters<typeof wrapPlan>[0]> = {}) =>
      wrapPlan({ setting: ON, contact_id: "c1", start: at(T0 + 10 * MIN), address: ZOOM_URL, call_kind: "demo", now: T0, ctx, ...over });
    expect(w().ok).toBe(true);
    const code = (r: ReturnType<typeof w>) => (r.ok ? null : r.code);
    expect(code(w({ setting: DEFAULT_ROOMS_SETTING }))).toBe("disabled");
    expect(code(w({ setting: { ...ON, test_only: true } }))).toBe("test_only");
    // A tag alone lets no room through while test_only is on; the listed contact does (final review).
    expect(code(w({ setting: { ...ON, test_only: true }, contact: { tags: ["cockpit-test"] } }))).toBe("test_only");
    expect(code(w({ setting: { ...ON, test_only: true, test_contacts: ["c1"] }, contact: { tags: [] } }))).toBe(null);
    expect(code(w({ contact_id: null }))).toBe("no_contact");
  });
});

// ---------------------------------------------------------------------------
// #8 (F7), #9 (F6): "That was not the lead"
// ---------------------------------------------------------------------------

describe("#8 #9 That was not the lead", () => {
  const joined = (over: Partial<RoomRow> = {}) => ({ ...step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "lead_in", source: "zoom" }, T0 + MIN), ...over });

  test("pressed while the count runs: undone at once, so the count's own result write misses and it takes back what it made", () => {
    const j = joined({ count_claimed_at: at(T0 + MIN) });
    const press = ok(apply(j, { kind: "not_lead", actor: { email: SETTER } }, T0 + MIN + 5 * S));
    expect(press.patch).toMatchObject({ count_undo_at: at(T0 + MIN + 5 * S), count_result: "undone" });
    const store = new Store(press.room);
    expect(store.writeGuarded(countFinish(at(T0 + MIN), { count_result: "booked", count_appointment_id: "B1" }))).toBe(false);
    expect(leadJoined(store.row)).toBe(false);
  });

  test("pressed after the count finished: the count stays until the undo lands, which then writes undone", () => {
    const j = joined({ count_claimed_at: at(T0 + MIN), count_result: "booked", count_appointment_id: "B1" });
    const press = ok(apply(j, { kind: "not_lead", actor: { email: SETTER } }, T0 + 2 * MIN));
    expect(press.patch.count_result).toBeUndefined();
    expect(countUndo(press.room)).toEqual({ action: "delete", appointment_id: "B1" });
    const store = new Store(press.room);
    expect(store.writeGuarded(countUndone(press.room))).toBe(true);
    expect(store.row.count_result).toBe("undone");
  });

  test("once the room closed: the count is taken back, the state stays, the result becomes no_join; a repeat is a no-op", () => {
    const j = joined({ count_claimed_at: at(T0 + MIN), count_result: "booked", count_appointment_id: "B1" });
    const ended = step(j, { kind: "meeting_ended" }, T0 + 2 * MIN);
    const press = ok(apply(ended, { kind: "not_lead", actor: { email: SETTER }, version: ended.version - 1 }, T0 + 3 * MIN));
    expect([press.to, press.room.result, press.room.version, kinds(press)]).toEqual(["ended", "no_join", ended.version, ["undo_count"]]);
    expect(ok(apply(press.room, { kind: "not_lead", actor: { email: SETTER } }, T0 + 4 * MIN)).changed).toBe(false);
    // Too late, someone else, a version two moves old, or a room nobody joined: refused.
    expect(!apply(ended, { kind: "not_lead", actor: { email: SETTER } }, T0 + MIN + 301 * S).ok).toBe(true);
    const other = apply(ended, { kind: "not_lead", actor: { email: "other@maharamedia.com" } }, T0 + 3 * MIN);
    expect(!other.ok && other.code).toBe("not_host");
    const old = apply(ended, { kind: "not_lead", actor: { email: SETTER }, version: ended.version - 2 }, T0 + 3 * MIN);
    expect(!old.ok && old.code).toBe("stale");
    const empty = step(opened(), { kind: "end", reason: "end" }, T0 + MIN);
    expect(!apply(empty, { kind: "not_lead", actor: { email: SETTER } }, T0 + 2 * MIN).ok).toBe(true);
    // A manager may press it too.
    expect(ok(apply(ended, { kind: "not_lead", actor: { email: "ceo@maharamedia.com", manager: true } }, T0 + 3 * MIN)).changed).toBe(true);
  });

  test("the join that was taken back, delivered again by Zoom, is not a new join; a real later join is", () => {
    const j = joined();
    const back = step(j, { kind: "not_lead", actor: { email: SETTER } }, T0 + 2 * MIN);
    expect(ok(apply(back, { kind: "lead_in", source: "zoom", at: j.lead_in_at }, T0 + 2 * MIN + 10 * S)).changed).toBe(false);
    const real = ok(apply(back, { kind: "lead_in", source: "zoom", at: at(T0 + 3 * MIN) }, T0 + 3 * MIN));
    expect([real.to, kinds(real)]).toEqual(["lead_in", ["count_live"]]);
    expect(leadJoined(real.room)).toBe(true);
  });

  test("countClaim clears an earlier undo; countLive skips a join that was taken back", () => {
    const j = joined({ count_claimed_at: at(T0 + MIN), count_result: "undone", count_undo_at: at(T0 + 2 * MIN) });
    expect(countLive({ room: j, setting: COUNT_ON, contact: LEAD, upcoming: null, host_ghl_user_id: "G", location_id: "L", link: null })).toMatchObject({ reason: "not_joined" });
    const again = { ...j, lead_in_at: at(T0 + 3 * MIN) };
    const plan = countLive({ room: again, setting: COUNT_ON, contact: LEAD, upcoming: null, host_ghl_user_id: "G", location_id: "L", link: null });
    expect(plan.action).toBe("create");
    expect(countClaim(again, T0 + 3 * MIN, plan)?.patch).toEqual({ count_claimed_at: at(T0 + 3 * MIN), count_result: null, count_appointment_id: null, count_undo_at: null });
    expect(countClaim({ ...again, count_result: "booked" }, T0, plan)).toBe(null);
    const notLead = countLive({ room: again, setting: COUNT_ON, contact: { tags: [] }, upcoming: null, host_ghl_user_id: "G", location_id: "L", link: null });
    expect(countClaim(again, T0, notLead)?.patch.count_result).toBe("not_a_lead");
  });
});

// ---------------------------------------------------------------------------
// #10 (F8), #11 (F9), #12 (F18), #13 (F15), #25: closing, holding, wrapping
// ---------------------------------------------------------------------------

describe("#10 #11 #12 #13 #25 settle, Zoom's end, the grace, the hold and the wrap", () => {
  test("settle: expired or ended with no join; never moved to the phone, cancelled, or a real join", () => {
    const sent = step(opened({ appointment_id: "APPT1" }), { kind: "link_sent" }, T0 + 10 * S);
    const ended = step(sent, { kind: "end", reason: "end" }, T0 + 4 * MIN);
    // The short link went and was never opened: evidence that nobody came (Meet sends no join signal).
    expect(settleDue(ended, at(T0), false, T0 + 20 * MIN, W, { short_link: true })).toBe(true);
    expect(settleDue(ended, at(T0), false, T0 + 20 * MIN, W)).toBe(false);
    for (const reason of ["on_phone", "cancel"] as const) expect(settleDue(step(sent, { kind: "end", reason }, T0 + 4 * MIN), at(T0), false, T0 + 20 * MIN, W)).toBe(false);
    const joined = step(step(sent, { kind: "lead_in", source: "mark" }, T0 + MIN), { kind: "end", reason: "finished" }, T0 + 9 * MIN);
    expect(settleDue(joined, at(T0), false, T0 + 20 * MIN, W)).toBe(false);
    // A join taken back is no join.
    const taken = step(step(step(sent, { kind: "lead_in", source: "mark" }, T0 + MIN), { kind: "not_lead", actor: { email: SETTER } }, T0 + 2 * MIN), { kind: "end", reason: "end" }, T0 + 3 * MIN);
    expect(settleDue(taken, at(T0), false, T0 + 20 * MIN, W, { short_link: true })).toBe(true);
    // The panel asks for the mark on an ended booked intro too.
    const v = toRoomView(ended, { short_link: true, contact_first_name: "Sara" });
    expect(panelLine(v, { now: T0 + 5 * MIN, booked_intro: true }).text).toBe(LANE_COPY.ended_mark_intro);
    expect(panelLine(v, { now: T0 + 5 * MIN }).text).toBe(LANE_COPY.room_closed);
    expect(panelLine(toRoomView(taken, { short_link: true }), { now: T0 + 5 * MIN }).text).toBe(LANE_COPY.room_closed);
  });

  test("Zoom's end before the lead came returns the room to open while the lead has time; after that, or with the lead in, it ends", () => {
    const sent = step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "link_sent" }, T0 + 10 * S);
    const inRoom = step(sent, { kind: "host_in", source: "zoom" }, T0 + 30 * S);
    const back = ok(apply(inRoom, { kind: "meeting_ended" }, T0 + 2 * MIN));
    expect([back.to, back.room.host_by, kinds(back)]).toEqual(["open", inRoom.host_by, []]);
    const leadBy = Date.parse(sent.lead_by as string);
    expect(ok(apply(inRoom, { kind: "meeting_ended" }, leadBy + S)).to).toBe("ended");
    const handover = step(opened({ purpose: "handover", send_on: "host_in", provider: "zoom" }, ZOOM_URL), { kind: "host_in", source: "zoom" }, T0 + 20 * S);
    const h = ok(apply(handover, { kind: "meeting_ended" }, T0 + MIN));
    expect([h.to, h.room.host_by]).toEqual(["open", at(T0 + MIN + W.handover_host * S)]);
    const sb = step(opened({ purpose: "standby", contact_id: null, provider: "zoom", host_email: CLOSER }, ZOOM_URL), { kind: "host_in", source: "zoom" }, T0 + 20 * S);
    expect(ok(apply(sb, { kind: "meeting_ended" }, T0 + MIN)).to).toBe("ended");
  });

  test("the grace extends lead_by once at most: a booked room is capped at the call's end", () => {
    const plan = wrapPlan({ setting: ON, contact_id: "c1", start: at(T0 + 10 * MIN), end: at(T0 + 31 * MIN), address: ZOOM_URL, call_kind: "intro", now: T0, ctx });
    if (!plan.ok) throw new Error(plan.message);
    const b = wrapRoomRow({ id: ROOM_ID, request_id: "r", code: "K7Q2MX", contact_id: "c1", call_kind: "intro", host_email: SETTER, made_by: SETTER, now: T0 }, plan);
    const leadBy = Date.parse(b.lead_by as string);
    const a = ok(apply(b, { kind: "opened", device: "phone" }, leadBy - 10 * S));
    expect(Date.parse(a.room.lead_by as string)).toBe(Date.parse(b.ends_at as string));
  });

  test("a wrap more than 30 minutes ahead is too early, and says when to come back; a booked room holds nobody", () => {
    const early = wrapPlan({ setting: ON, contact_id: "c1", start: at(T0 + 3 * HOUR), address: ZOOM_URL, call_kind: "demo", now: T0, ctx });
    expect(!early.ok && [early.code, early.message, early.retry]).toEqual(["wrap_too_early", "This call's room opens at 13:30, 30 minutes before it starts. Try again then.", true]);
    const tomorrow = wrapPlan({ setting: ON, contact_id: "c1", start: at(T0 + 25 * HOUR), address: ZOOM_URL, call_kind: "demo", now: T0, ctx });
    expect(!tomorrow.ok && tomorrow.message).toBe("This call's room opens at 11:30 on Mon 5 Oct, 30 minutes before it starts. Try again then.");
    expect(wrapPlan({ setting: ON, contact_id: "c1", start: at(T0 + 30 * MIN), address: ZOOM_URL, call_kind: "demo", now: T0, ctx }).ok).toBe(true);
  });

  test("a room being made holds its lead until it would fail (claim + 120 s), not requested + 60 s", () => {
    const c = claimed();
    expect(holdUntil(c, ctx)).toBe(T0 + 2 * W.fail * S);
    expect(holdUntil(room(), ctx)).toBe(T0 + W.fail * S);
  });
});

// ---------------------------------------------------------------------------
// #14 (F12): test contacts
// ---------------------------------------------------------------------------

describe("#14 a test contact's booked call", () => {
  const joined = (over: Partial<RoomRow>) => ({ ...opened(over), state: "lead_in" as const, lead_in_at: at(T0 + MIN) });
  const plan = (over: Partial<Parameters<typeof countLive>[0]>) =>
    countLive({ room: joined({ contact_id: "VjPfR4Cc1Y0OFvaqeor5", appointment_id: "APPT" }), setting: COUNT_ON, contact: { tags: ["cockpit-test"] }, upcoming: null, host_ghl_user_id: "G", location_id: "L", link: null, ...over });

  test("is marked only on the test calendar, and nothing happens with no test calendar", () => {
    expect(plan({ appointment_calendar_id: "TESTCAL" })).toEqual({ action: "mark", claim: true, appointment_id: "APPT" });
    expect(plan({ appointment_calendar_id: "dsqmJ393Dwl9fDSbIVOI" })).toMatchObject({ action: "none", reason: "test_not_on_test_calendar", count_result: "not_a_lead" });
    expect(plan({ setting: { ...COUNT_ON, test_calendar_id: null }, appointment_calendar_id: "TESTCAL" })).toMatchObject({ action: "none", reason: "test_calendar_missing" });
  });

  test("a real lead's booked intro is still marked; upcoming() needs no kind of its own", () => {
    const real = countLive({ room: joined({ appointment_id: "APPT" }), setting: COUNT_ON, contact: LEAD, upcoming: null, host_ghl_user_id: "G", location_id: "L", link: null });
    expect(real.action).toBe("mark");
    const moved = countLive({ room: joined({}), setting: COUNT_ON, contact: LEAD, upcoming: { id: "UP", start: T0 + 86_400_000, end: T0 + 86_400_000 + 1_800_000, assigned_user_id: "G" }, host_ghl_user_id: "G", location_id: "L", link: null });
    expect(moved.action).toBe("move");
  });
});

// ---------------------------------------------------------------------------
// #16 (F10), #21: no raw placeholder reaches a screen; plural and singular
// ---------------------------------------------------------------------------

describe("#16 #21 every line a person reads", () => {
  const RAW = /\{[a-z_]+\}/;

  test("fill: a key passed empty goes with its comma or space; a key not passed stays; template slots stay", () => {
    expect(fill("at 14:03{device}.", { device: "" })).toBe("at 14:03.");
    expect(fill("{name}, {company}, {country}.", { name: "Sara", company: null, country: "Kuwait" })).toBe("Sara, Kuwait.");
    expect(fill("{name}, {company}, {country}.", { name: null, company: "Acme", country: "Kuwait" })).toBe("Acme, Kuwait.");
    expect(fill("{name}, {company}.", { name: "Sara", company: undefined })).toBe("Sara.");
    expect(fill("Hi {first_name}, hello", {})).toBe("Hi {first_name}, hello");
    expect(fill("Hi {{1}}", { "1": "x" } as never)).toBe("Hi {{1}}");
    expect(fill("{n} rooms", { n: 0 })).toBe("0 rooms");
  });

  test("the offer and the strip leave out what is not known", () => {
    expect(offerLine({ kind: "demo", name: "Sara Al Ali", company: null, country: "Kuwait", note: "Wants pricing" })).toBe(
      "Live demo for you: Sara, Kuwait. On the phone with the setter now. Note: Wants pricing. Take it within 2 minutes.",
    );
    expect(offerLine({ kind: "demo", name: "Sara", company: "Acme", country: null, note: null })).toBe(
      "Live demo for you: Sara, Acme. On the phone with the setter now. Take it within 2 minutes.",
    );
    expect(offerLine({ kind: "intro", name: null, company: null, country: null, note: "  " })).toBe(
      "Live intro for you: a lead. On the phone with the setter now. Take it within 2 minutes.",
    );
    expect(stripOfferLine({ kind: "demo", country: null, note: null, left_ms: 107_000 })).toBe("Live lead: demo, on the line with the setter. 1:47 left.");
    expect(stripOfferLine({ kind: "demo", country: "Saudi Arabia", note: "Two villas", left_ms: 107_000 })).toBe(
      "Live lead: demo, Saudi Arabia, on the line with the setter. Note: Two villas. 1:47 left.",
    );
    expect(appHomeReadyLine(1, 2)).toBe("Ready now: 1 closer, 2 setters.");
    expect(appHomeReadyLine(0, 1)).toBe("Ready now: 0 closers, 1 setter.");
  });

  test("every panel line, on every path, in both voices, with and without a name, never shows a raw placeholder", () => {
    const lines: string[] = [];
    for (const purpose of ["fallback", "manual", "handover", "booked", "standby"] as const) {
      for (const provider of ["meet", "zoom"] as const) {
        const contact_id = purpose === "standby" ? null : "c1";
        let r = room({ purpose, provider, contact_id, send_on: purpose === "handover" ? "host_in" : "open" });
        const seen: RoomRow[] = [r];
        r = step(r, { kind: "claim" }, T0);
        seen.push(r);
        r = step(r, { kind: "ready", join_url: provider === "zoom" ? ZOOM_URL : MEET_URL }, T0 + 5 * S);
        seen.push(r);
        if (contact_id) {
          for (const e of [
            { kind: "link_sent" },
            { kind: "opened", device: null },
            { kind: "lead_waiting" },
            { kind: "host_in", source: "zoom" },
            { kind: "lead_in", source: "zoom" },
          ] as RoomEvent[]) {
            r = step(r, e, T0 + 30 * S);
            seen.push(r);
          }
          seen.push({ ...r, count_result: "booked" }, { ...r, count_result: "not_a_lead" }, { ...r, ends_at: at(T0) });
          seen.push(step(r, { kind: "end", reason: "finished" }, T0 + 5 * MIN));
          seen.push(ok(sweepRoom({ ...seen[3], state: "open" } as RoomRow, T0 + 2 * HOUR, ctx)).room);
        }
        seen.push({ ...seen[1], state: "failed", error: null }, { ...seen[1], state: "failed", error: "Zoom refused the meeting." }, { ...seen[2], state: "cancelled" });
        for (const row of seen)
          for (const first of ["Sara", null])
            for (const c of [{}, { not_sent_reason: "the lead has no email address" }, { not_confirmed: true }, { booked_intro: true }, { count: "marked" as const }]) {
              const v = toRoomView(row, { short_link: true, contact_first_name: first });
              lines.push(panelLine(v, { now: T0 + 3 * MIN, ...c }).text);
            }
      }
    }
    expect(lines.length).toBeGreaterThan(500);
    for (const l of lines) expect([l, RAW.test(l)]).toEqual([l, false]);
  });

  test("every refusal, health line and strip line, filled as the code fills it, never shows a raw placeholder", () => {
    const vars = { host: "Ahmed", provider: "Meet", other: "Zoom", minutes: 5, time: "14:02" };
    const codes = ["stale", "not_host", "confirm_end", "not_lead_late", "final", "too_early", "not_requested", "not_claimed", "already_open", "bad_link", "bad_input", "no_lead", "not_standby", "no_contact", "contact_unread", "disabled", "provider_off", "test_only", "client", "dnd", "booked_demo", "fallback_scope", "fallback_pilot", "lead_has_room", "host_has_room", "zoom_busy", "zoom_basic_demo", "zoom_pending", "zoom_missing", "no_google", "meet_pending", "phone_call", "host_link", "call_over", "wrap_too_early"] as const;
    for (const code of codes) {
      const m = refuse(code, vars).message;
      expect([code, RAW.test(m)]).toEqual([code, false]);
    }
    for (const h of [
      roomsHealth({ now: T0, last_run_at: at(T0 - S), rooms_today: 2, failed_today: 0 }),
      roomsHealth({ now: T0, last_run_at: at(T0 - S), rooms_today: null, failed_today: 0 }),
      roomsHealth({ now: T0, last_run_at: at(T0 - HOUR), rooms_today: 2, failed_today: 0 }),
      roomsHealth({ now: T0, last_run_at: null, rooms_today: 2, failed_today: 0 }),
      roomsHealth({ now: T0, last_run_at: at(T0 - S), rooms_today: 2, failed_today: 0, mismatched_today: 3 }),
    ])
      expect([h.line, RAW.test(h.line)]).toEqual([h.line, false]);
    for (const state of ["away", "available", "ready", "on_call"] as const)
      for (const until of [at(T0 + HOUR), null]) {
        const l = stripLine({ state, until }, T0);
        if (l) expect([l, RAW.test(l)]).toEqual([l, false]);
      }
  });

  test("health: counts that could not be read are null, never 0", () => {
    const h = roomsHealth({ now: T0, last_run_at: at(T0 - S), rooms_today: "n/a", failed_today: undefined });
    expect([h.rooms_today, h.failed_today]).toEqual([null, null]);
  });
});

// ---------------------------------------------------------------------------
// #19 (F14), #20 (F16), #24: clean-up, the refresh near a booked call, guards
// ---------------------------------------------------------------------------

describe("#19 #20 #24 clean-up, refresh and write guards", () => {
  test("the same link again is a quiet retry; a different one asks the worker to delete it", () => {
    const r = opened({ provider: "zoom" }, ZOOM_URL);
    expect(ok(apply(r, { kind: "ready", join_url: ZOOM_URL }, T0 + MIN)).changed).toBe(false);
    const other = apply(r, { kind: "ready", join_url: "https://us06web.zoom.us/j/89999999999" }, T0 + MIN);
    expect(!other.ok && [other.code, other.cleanup]).toEqual(["already_open", true]);
  });

  test("a fresh standby room only when no booked call falls inside its life", () => {
    const sb = step(opened({ purpose: "standby", contact_id: null, call_kind: "demo", provider: "zoom", host_email: CLOSER }, ZOOM_URL), { kind: "host_in", source: "zoom" }, T0 + 30 * S);
    const max = T0 + 5 * S + W.standby_max * S;
    const avail = { available_until: at(max + 2 * HOUR) };
    expect(kinds(ok(sweepRoom(sb, max, ctx, max + (W.standby_max + W.booked_guard) * S, avail)))).not.toContain("refresh_standby");
    expect(kinds(ok(sweepRoom(sb, max, ctx, max + (W.standby_max + W.booked_guard) * S + S, avail)))).toContain("refresh_standby");
  });

  test("guardFilter encodes every value (a Postgres time's +00:00 stays a +), nulls are is.null, and nothing is dropped", () => {
    expect(guardFilter({ state: "open", version: 3, link_sent_at: null, lead_by: "2026-10-04T08:10:00+00:00" })).toBe(
      "state=eq.open&version=eq.3&link_sent_at=is.null&lead_by=eq.2026-10-04T08%3A10%3A00%2B00%3A00",
    );
    expect(() => guardFilter({ link_message_ids: { a: 1 } } as never)).toThrow();
    expect(() => guardFilter({ "state;drop": "x" } as never)).toThrow();
    // Every guard the state machine writes can be put in a filter.
    const c = ok(apply(opened(), { kind: "lead_in", source: "zoom" }, T0 + MIN));
    expect(guardFilter(c.expect)).toContain("lead_in_at=is.null");
    expect(MAX_WRITE_TRIES).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Stress: the effects carried out, with crashes in between (#2, #6, #8, #26)
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe("2,000 runs with the message service, the count and the undo crashing at random", () => {
  test("the lead gets at most one message and gets it while the room is open; bookings end consistent with the joins; a stuck count is flagged", () => {
    let delivered = 0;
    let undosTried = 0;
    let crashes = 0;
    let stuckRuns = 0;
    let bookedRuns = 0;
    for (let run = 1; run <= 2_000; run++) {
      const rnd = mulberry32(run * 7919);
      const purpose = rnd() < 0.5 ? "fallback" : "handover";
      const store = new Store(room({ provider: "zoom", purpose, send_on: purpose === "handover" ? "host_in" : "open", host_email: CLOSER }));
      const messages = new Set<string>();
      let messagesSent = 0;
      const bookings = new Set<string>();
      const alerts = new Set<string>();
      const jobs: (() => void)[] = [];
      let ids = 0;
      let stuck = false;
      let t = T0;

      const runEffects = (effects: Effect[], now: number) => {
        for (const ef of effects) {
          if (ef.kind === "send_link") {
            if (rnd() < 0.2) { crashes++; continue; }
            // The message service is keyed on request_id = the room id: a repeat never sends twice.
            if (!messages.has(store.row.id)) {
              messages.add(store.row.id);
              messagesSent++;
            }
            if (rnd() < 0.2) { crashes++; continue; }
            act({ kind: "link_sent", channel: "email", at: at(now) }, now);
          } else if (ef.kind === "count_live") {
            if (rnd() < 0.1) { crashes++; continue; }
            const row = store.row;
            const plan = countLive({ room: row, setting: COUNT_ON, contact: { firstName: "Sara", tags: ["roas-qualified"] }, upcoming: null, host_ghl_user_id: "G", location_id: "L", link: null });
            const claim = countClaim(row, now, plan);
            if (!claim || !store.writeGuarded(claim)) continue;
            if (plan.action === "none") continue;
            if (rnd() < 0.1) { crashes++; stuck = true; continue; }
            const mine = claim.patch.count_claimed_at as string;
            const id = `B${++ids}`;
            bookings.add(id);
            jobs.push(() => {
              if (store.writeGuarded(countFinish(mine, { count_result: "booked", count_appointment_id: id }))) return;
              // An undo came in, or a new claim replaced this one: take back what this count made.
              bookings.delete(id);
              if (store.row.count_claimed_at === mine) store.writeGuarded(countUndone(store.row));
            });
          } else if (ef.kind === "undo_count") {
            const row = store.row;
            const plan = countUndo(row);
            if (plan.action !== "delete") continue;
            undosTried++;
            if (rnd() < 0.2) { crashes++; continue; }
            bookings.delete(plan.appointment_id);
            if (rnd() < 0.2) { crashes++; continue; }
            store.writeGuarded(countUndone(row));
          } else if (ef.kind === "alert") alerts.add(ef.dedupe_key);
        }
      };
      const act = (e: RoomEvent, now: number) => {
        const a = store.run(e, now, countOn);
        if (a?.ok) runEffects(a.effects, now);
      };

      act({ kind: "claim" }, t);
      t += 2 * S;
      act({ kind: "ready", join_url: ZOOM_URL }, t);
      const steps = 6 + Math.floor(rnd() * 14);
      for (let i = 0; i < steps; i++) {
        t += (1 + Math.floor(rnd() * 90)) * S;
        const roll = rnd();
        if (jobs.length && rnd() < 0.4) jobs.splice(Math.floor(rnd() * jobs.length), 1)[0]?.();
        if (roll < 0.15) act({ kind: "host_in", source: "zoom", at: at(t) }, t);
        else if (roll < 0.25) act({ kind: "host_left", at: at(t) }, t);
        else if (roll < 0.45) act({ kind: "lead_in", source: rnd() < 0.5 ? "zoom" : "mark", at: at(t) }, t);
        else if (roll < 0.6) act({ kind: "not_lead", actor: { email: CLOSER } }, t);
        else if (roll < 0.65) act({ kind: "meeting_ended", at: at(t) }, t);
        else if (roll < 0.7) act({ kind: "end", reason: "finished", actor: { email: CLOSER } }, t);
        else act({ kind: "tick" }, t);
      }
      // Drain: the counts still running finish, then the sweep runs every minute for two hours.
      while (jobs.length) jobs.shift()?.();
      for (let i = 0; i < 120; i++) {
        t += MIN;
        act({ kind: "tick" }, t);
        while (jobs.length) jobs.shift()?.();
      }

      const row = store.row;
      delivered += messagesSent;
      expect(messagesSent).toBeLessThanOrEqual(1);
      // The row says sent only when the message went; a claimed link that never went is one the room closed on first.
      if (row.link_sent_at) expect(messagesSent).toBe(1);
      expect(bookings.size).toBeLessThanOrEqual(1);
      if (stuck) {
        stuckRuns++;
        // A count stuck after its claim, for a lead who did join, was flagged to a person.
        if (countInFlight(row) && leadJoined(row)) expect([...alerts].some(k => k.includes("count_stuck"))).toBe(true);
        continue;
      }
      if (leadJoined(row)) {
        // A real join with the switch on is counted, once.
        expect([run, row.count_result]).toEqual([run, "booked"]);
        expect([...bookings]).toEqual([row.count_appointment_id]);
        bookedRuns++;
      } else {
        // No join, or the join was taken back: nothing stays booked.
        expect([run, bookings.size]).toEqual([run, 0]);
      }
    }
    expect(delivered).toBeGreaterThan(1_000);
    expect(undosTried).toBeGreaterThan(200);
    expect(crashes).toBeGreaterThan(1_000);
    expect(bookedRuns).toBeGreaterThan(300);
    expect(stuckRuns).toBeGreaterThan(10);
  });

  test("a count stuck after its claim is flagged within the sweep after 2 minutes", () => {
    const j = { ...step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "lead_in", source: "zoom" }, T0 + MIN) };
    const store = new Store(j);
    const plan = countLive({ room: j, setting: COUNT_ON, contact: LEAD, upcoming: null, host_ghl_user_id: "G", location_id: "L", link: null });
    const claim = countClaim(j, T0 + MIN, plan);
    expect(claim && store.writeGuarded(claim)).toBe(true);
    // The function dies here. The sweep:
    const a = ok(sweepRoom(store.row, T0 + 3 * MIN + S, countOn));
    expect(kinds(a)).toEqual(["alert"]);
  });
});
