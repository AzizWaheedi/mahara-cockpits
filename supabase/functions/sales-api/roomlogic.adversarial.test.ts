// Adversarial review of roomlogic.ts (review lane, 2026-10-03).
//
// Each test below states the behaviour the specs need. They were written as
// `test.failing` against the first roomlogic.ts; every finding is now fixed,
// so they run as plain tests and pin the fixes. The last block pins rules the
// review checked and found sound. Finding numbers match the review's list
// (F1 to F20; the fix commit's tests in roomlogic.test.ts cover the rest).
// Two setups changed with the fixes: wrapPlan now takes the rooms setting and
// the contact (F17), and the sweep re-asks for a count only with
// count_on_join on (the scenario of F20 needs the switch on).

import { describe, expect, test } from "bun:test";
import {
  type Applied,
  type Changed,
  type RoomEvent,
  type RoomRow,
  applyRoomEvent,
  createRefusal,
  countLive,
  DEFAULT_ROOMS_JSON,
  DEFAULT_ROOMS_SETTING,
  fill,
  holdUntil,
  meetingFromAddress,
  newRoomRow,
  panelLine,
  presenceOf,
  ROOM_COPY,
  roomCtx,
  roomsHealth,
  roomsSetting,
  settleDue,
  sweepRoom,
  toRoomView,
  wrapPlan,
  wrapRoomRow,
  zoomEffect,
  zoomRole,
} from "./roomlogic.ts";

const S = 1000;
const MIN = 60 * S;
const T0 = Date.parse("2026-10-04T08:00:00.000Z");
const ROOM_ID = "3f2a9c1e-7b4d-4e8a-9c2f-0a1b2c3d4e5f";
const SETTER = "setter@maharamedia.com";
const CLOSER = "closer@maharamedia.com";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=AbC123";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ctx = roomCtx(DEFAULT_ROOMS_SETTING);
/** Rooms on for everyone, so room.wrap's switch and test list pass. */
const WRAP_ON = roomsSetting({ ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false });
const at = (t: number) => new Date(t).toISOString();

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
const apply = (r: RoomRow, e: RoomEvent, t: number) => applyRoomEvent(r, e, t, ctx);
const step = (r: RoomRow, e: RoomEvent, t: number) => ok(apply(r, e, t)).room;
function claimed(over: Partial<RoomRow> = {}): RoomRow {
  return step(room(over), { kind: "claim" }, T0);
}
function opened(over: Partial<RoomRow> = {}, url = MEET_URL): RoomRow {
  return step(claimed(over), { kind: "ready", join_url: url }, T0 + 5 * S);
}
const kinds = (a: Applied) => (a.ok ? a.effects.map(e => e.kind) : []);

// ---------------------------------------------------------------------------
// Finding 1: the link can be sent twice
// ---------------------------------------------------------------------------

describe("F1 send_link is not claimed atomically", () => {
  test("ready then the host joining before link_sent is written asks for the link once, not twice", () => {
    // Fallback room, send_on=open: `ready` asks for the send. The message
    // service then reads back for up to 20 s before link_sent lands. The
    // setter presses Open my room and Zoom (or "I'm in") moves the room to
    // host_in inside that window: linkDue() is still true, so a second
    // send_link comes out and the lead gets the link twice.
    const c = claimed({ provider: "zoom" });
    const ready = ok(apply(c, { kind: "ready", join_url: ZOOM_URL }, T0 + 5 * S));
    const hostIn = ok(apply(ready.room, { kind: "host_in", source: "zoom" }, T0 + 12 * S));
    const sends = [...kinds(ready), ...kinds(hostIn)].filter(k => k === "send_link").length;
    expect(sends).toBe(1);
  });

  test("a host who leaves and comes back before link_sent lands does not ask for a third send", () => {
    const r = opened({ purpose: "handover", send_on: "host_in", provider: "zoom", host_email: CLOSER, call_kind: "demo" }, ZOOM_URL);
    const a = ok(apply(r, { kind: "host_in", source: "zoom" }, T0 + 20 * S));
    const b = ok(apply(a.room, { kind: "host_left" }, T0 + 25 * S));
    const c = ok(apply(b.room, { kind: "host_in", source: "zoom" }, T0 + 28 * S));
    const sends = [...kinds(a), ...kinds(b), ...kinds(c)].filter(k => k === "send_link").length;
    expect(sends).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Finding 2: presence says ready after Available ran out, or after Go away
// ---------------------------------------------------------------------------

describe("F2 presence ignores availability for a standby room", () => {
  const sbIn = () => ({
    ...opened({ purpose: "standby", contact_id: null, call_kind: "demo", provider: "zoom", host_email: CLOSER }, ZOOM_URL),
    state: "host_in" as const,
  });
  const base = { email: CLOSER, now: T0, rooms: [] as RoomRow[], open_attempt: false, appointment_now: false, default_provider: "zoom" as const };

  test("a closer who pressed Go away is not offered leads, even while still in the standby room", () => {
    const p = presenceOf({ ...base, availability: { state: "away", until: null }, rooms: [sbIn()] });
    expect(p.state).not.toBe("ready");
  });

  test("once Available runs out the strip never shows a raw {until}", () => {
    const p = presenceOf({ ...base, availability: { state: "available", until: at(T0 - MIN) }, rooms: [sbIn()] });
    const line = fill(ROOM_COPY.strip.ready, { until: p.until });
    expect(line).not.toContain("{until}");
  });
});

// ---------------------------------------------------------------------------
// Finding 3: a Zoom start link in a booked call's address becomes join_url
// ---------------------------------------------------------------------------

describe("F3 room.wrap accepts a Zoom host (start) link", () => {
  const START = "https://us06web.zoom.us/s/81234567890?zak=eyJhbGciOiJIUzI1NiJ9.HOSTTOKEN.sig";

  test("a /s/ start link with a zak token is never taken as the lead's join link", () => {
    const m = meetingFromAddress(`Zoom: ${START}`);
    expect(m?.join_url ?? "").not.toContain("zak=");
  });

  test("so the browser's view and the short link cannot carry the host token", () => {
    const plan = wrapPlan({ setting: WRAP_ON, contact_id: "c1", start: at(T0 + 10 * MIN), end: at(T0 + 55 * MIN), address: START, call_kind: "demo", now: T0, ctx });
    if (!plan.ok) return; // refusing the address is also a pass
    const row = wrapRoomRow({ id: ROOM_ID, request_id: "r", code: "K7Q2MX", contact_id: "c1", call_kind: "demo", host_email: CLOSER, made_by: CLOSER, now: T0 }, plan);
    expect(JSON.stringify(toRoomView(row, { short_link: false }))).not.toContain("HOSTTOKEN");
  });
});

// ---------------------------------------------------------------------------
// Finding 4: a contact that could not be read passes the client and DND checks
// ---------------------------------------------------------------------------

describe("F4 createRefusal fails open on an unread contact", () => {
  const ON = roomsSetting({ ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, providers: { zoom: true, meet: true } });
  test("a room for a lead whose HighLevel contact could not be read is refused, not made", () => {
    const r = createRefusal({
      setting: ON,
      purpose: "fallback",
      provider: "meet",
      call_kind: "intro",
      contact_id: "c1",
      contact: null, // the HighLevel read failed or timed out
      host: { zoom_status: "licensed", zoom_live: false, google_ok: true },
      lead_room_open: false,
      host_room_open: false,
      booked_demo: false,
      host_email: SETTER,
      booked_intro: true,
    });
    expect(r).not.toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Finding 5: the timer can close a room whose lead event is still queued
// ---------------------------------------------------------------------------

describe("F5 the sweep does not wait for unhandled events, and events carry no time of their own", () => {
  test("a tick on a room with a queued (unhandled) Zoom event does not expire it", () => {
    const r = step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "link_sent" }, T0 + 10 * S);
    const leadBy = Date.parse(r.lead_by as string);
    // The lead knocked at leadBy - 5 s; the door stored the event but the
    // forward to room.event failed, so it waits for the 20 s replay. The
    // sweep runs first: expired + close_provider ends the meeting on the lead.
    const tick = { kind: "tick", next_booked_start: null, pending_events: 1 } as unknown as RoomEvent;
    const a = ok(apply(r, tick, leadBy + 10 * S));
    expect(a.changed).toBe(false);
  });

  test("a lead_in from Zoom is stamped with Zoom's join_time, not with when it was handled", () => {
    const eff = zoomEffect(
      {
        event: "meeting.participant_joined",
        payload: {
          object: {
            id: "81234567890",
            host_id: "HOSTZOOMID",
            participant: { participant_uuid: "p-lead", email: "", join_time: "2026-10-04T08:03:00Z" },
          },
        },
      },
      { host_zoom_user_id: "HOSTZOOMID", host_email: CLOSER },
    );
    expect("room_event" in eff && (eff.room_event as { at?: unknown }).at).toBe("2026-10-04T08:03:00Z");
  });
});

// ---------------------------------------------------------------------------
// Finding 6: "That was not the lead" cannot be undone once the room is final
// ---------------------------------------------------------------------------

describe("F6 not_lead after the room closed", () => {
  test("within 5 minutes of the join, a closed room still undoes the count", () => {
    // A staff member who was not signed in joined (lead_in, counted), then
    // left and the host ended the meeting a minute later. The rep presses
    // "That was not the lead" at +2 min: the booking must still be undone.
    const joined = { ...step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "lead_in", source: "zoom" }, T0 + MIN), count_claimed_at: at(T0 + MIN) };
    const ended = step(joined, { kind: "meeting_ended" }, T0 + 2 * MIN);
    const a = apply(ended, { kind: "not_lead", actor: { email: SETTER } }, T0 + 3 * MIN);
    expect(kinds(a)).toContain("undo_count");
  });
});

// ---------------------------------------------------------------------------
// Finding 7: an undo pressed while the count is in flight is lost
// ---------------------------------------------------------------------------

describe("F7 not_lead while countLive is still booking", () => {
  test("the not_lead write leaves a durable mark, so the finishing count undoes itself", () => {
    const joined = { ...step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "lead_in", source: "zoom" }, T0 + MIN), count_claimed_at: at(T0 + MIN) };
    // count_result is still null: the booking POST is in flight. countUndo
    // answers in_flight and nothing records that an undo was asked for.
    const c = ok(apply(joined, { kind: "not_lead", actor: { email: SETTER } }, T0 + MIN + 5 * S));
    expect(c.patch).toHaveProperty("count_result", "undone");
  });
});

// ---------------------------------------------------------------------------
// Finding 8: a missed booked intro that the setter closed by hand stays "confirmed"
// ---------------------------------------------------------------------------

describe("F8 settleDue only settles expired rooms", () => {
  test("a fallback room for a booked intro ended with no join is settled as a no-show too", () => {
    const r = step(step(opened({ appointment_id: "APPT1" }), { kind: "link_sent" }, T0 + 10 * S), { kind: "end", reason: "end", actor: { email: SETTER } }, T0 + 4 * MIN);
    expect([r.state, r.result]).toEqual(["ended", "no_join"]);
    expect(settleDue(r, at(T0), false, T0 + 21 * MIN, ctx.waits)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finding 9: Zoom's meeting.ended when the host leaves an empty meeting
// ---------------------------------------------------------------------------

describe("F9 meeting.ended before the lead came", () => {
  test("a handover room whose host left an empty meeting goes back to open, as P2's host_left rule says", () => {
    let r = opened({ purpose: "handover", send_on: "host_in", provider: "zoom", host_email: CLOSER, call_kind: "demo" }, ZOOM_URL);
    r = step(r, { kind: "host_in", source: "zoom" }, T0 + 20 * S);
    r = step(r, { kind: "link_sent" }, T0 + 25 * S);
    // Zoom ends a meeting when the only person in it (the host) leaves; the
    // lead still has 9 minutes on the link. The room ends and the short link
    // shows "This call has ended."
    r = step(r, { kind: "host_left" }, T0 + 60 * S);
    const a = ok(apply(r, { kind: "meeting_ended" }, T0 + 61 * S));
    expect(a.to).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// Finding 10: unfilled placeholders reach the screen
// ---------------------------------------------------------------------------

describe("F10 fill() treats an empty value as missing", () => {
  test("an open from an unknown device reads as a sentence, not with a raw {device}", () => {
    const r = step(step(opened({ purpose: "manual" }), { kind: "link_sent" }, T0 + 10 * S), { kind: "opened", device: null }, T0 + 2 * MIN);
    const line = panelLine(toRoomView(r, { short_link: true, contact_first_name: "Sara" }), { now: T0 + 3 * MIN });
    expect(line.text).not.toContain("{device}");
  });

  test("an offer for a lead with no company (Offer.company is null by contract) has no raw {company}", () => {
    const text = fill(ROOM_COPY.slack.offer, { name: "Sara", company: null, country: "Kuwait", note: "Wants pricing" });
    expect(text).not.toContain("{company}");
  });
});

// ---------------------------------------------------------------------------
// Finding 11: "Use Zoom" when Zoom is off too
// ---------------------------------------------------------------------------

describe("F11 provider_off names an alternative that is also off", () => {
  test("with both providers off the refusal does not tell the rep to use the other", () => {
    const ON = roomsSetting({ ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false });
    const r = createRefusal({
      setting: ON,
      purpose: "fallback",
      provider: "meet",
      call_kind: "intro",
      contact_id: "c1",
      contact: { tags: ["roas-qualified"], phone: "+96550001234" },
      host: { zoom_status: "licensed", zoom_live: false, google_ok: true },
      lead_room_open: false,
      host_room_open: false,
      booked_demo: false,
      host_email: SETTER,
      booked_intro: true,
    });
    expect(r?.message ?? "").not.toContain("Use Zoom");
  });
});

// ---------------------------------------------------------------------------
// Finding 12: a test contact's real booked intro is marked shown
// ---------------------------------------------------------------------------

describe("F12 countLive marks a test contact's appointment before the test check", () => {
  test("a test contact never marks an appointment outside the test calendar", () => {
    const COUNT_ON = roomsSetting({ ...DEFAULT_ROOMS_JSON, count_on_join: true, test_calendar_id: "TESTCAL" });
    const r = { ...opened({ contact_id: "VjPfR4Cc1Y0OFvaqeor5", appointment_id: "REALAPPT" }), state: "lead_in" as const, lead_in_at: at(T0 + MIN) };
    const plan = countLive({
      room: r,
      setting: COUNT_ON,
      contact: { tags: ["cockpit-test", "unqualified"] },
      upcoming: null,
      host_ghl_user_id: "GHLSETTER",
      location_id: "LOC",
      link: "https://call.maharamedia.com/K7Q2MX",
    });
    expect(plan.action).not.toBe("mark");
  });
});

// ---------------------------------------------------------------------------
// Finding 13: missing counts come back as 0
// ---------------------------------------------------------------------------

describe("F13 roomsHealth returns 0 for counts it could not read", () => {
  test("rooms_today is not 0 when the count could not be read", () => {
    const h = roomsHealth({ now: T0, last_run_at: at(T0 - S), rooms_today: null, failed_today: undefined });
    expect(h.rooms_today).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Finding 14: a second meeting made by a racing worker is never cleaned up
// ---------------------------------------------------------------------------

describe("F14 a second, different link for an open room", () => {
  test("is refused with the clean-up flag so the orphan meeting is deleted", () => {
    const r = opened({ provider: "zoom" }, ZOOM_URL);
    const a = apply(r, { kind: "ready", join_url: "https://us06web.zoom.us/j/89999999999?pwd=X" }, T0 + 70 * S);
    expect(!a.ok && a.cleanup).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finding 15: a booked room holds the lead out of the dialer
// ---------------------------------------------------------------------------

describe("F15 roomHolds on booked rooms", () => {
  test("a wrapped booked call does not take the lead out of the queue (its own call items stay)", () => {
    const plan = wrapPlan({ setting: WRAP_ON, contact_id: "c1", start: at(T0 + 30 * MIN), end: at(T0 + 75 * MIN), address: ZOOM_URL, call_kind: "demo", now: T0, ctx });
    if (!plan.ok) throw new Error(plan.message);
    const b = wrapRoomRow({ id: ROOM_ID, request_id: "r", code: "K7Q2MX", contact_id: "c1", call_kind: "demo", host_email: CLOSER, made_by: CLOSER, now: T0 }, plan);
    expect(holdUntil(b, ctx)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Finding 16: refresh_standby right before a booked call
// ---------------------------------------------------------------------------

describe("F16 standby refresh near a booked call", () => {
  test("no fresh standby room is asked for when the host's booked call is inside the next room's life", () => {
    const sb = step(
      opened({ purpose: "standby", contact_id: null, call_kind: "demo", provider: "zoom", host_email: CLOSER }, ZOOM_URL),
      { kind: "host_in", source: "zoom" },
      T0 + 30 * S,
    );
    const refreshAt = T0 + 5 * S + 2100 * S;
    const booked = refreshAt + 15 * MIN; // guard fires at booked - 10 min, 5 minutes after the refresh
    const a = ok(sweepRoom(sb, refreshAt, ctx, booked));
    expect(kinds(a)).not.toContain("refresh_standby");
  });
});

// ---------------------------------------------------------------------------
// Finding 17: classification hangs on an unverified participant_uuid match
// ---------------------------------------------------------------------------

describe("F17 a signed-in lead whose waiting-room uuid differs from the admitted one", () => {
  test("is still the lead (F: staff are only the host and room_hosts)", () => {
    const lead = { id: "EXTUSER", participant_user_id: "EXTUSER", email: "lead@gmail.com", participant_uuid: "p-after-admit" };
    expect(zoomRole(lead, "HOSTZOOMID", { host_zoom_user_id: "HOSTZOOMID", host_email: CLOSER, staff_emails: [CLOSER, SETTER], waited: ["p-in-waiting-room"] })).toBe("lead");
  });
});

// ---------------------------------------------------------------------------
// Finding 18: repeated opens keep a room alive for ever
// ---------------------------------------------------------------------------

describe("F18 the open grace has no ceiling", () => {
  test("a page reloaded (or a script hitting /open) every 170 s cannot hold a room open past one grace", () => {
    let r = step(opened(), { kind: "link_sent" }, T0 + 10 * S);
    const firstLeadBy = Date.parse(r.lead_by as string);
    let t = firstLeadBy - 10 * S;
    for (let i = 0; i < 40; i++) {
      r = ok(apply(r, { kind: "opened", device: "phone" }, t)).room;
      t = Date.parse(r.lead_by as string) - 10 * S;
    }
    // 40 opens later the room, the queue hold and the host's one-room slot are still held.
    expect(Date.parse(r.lead_by as string)).toBeLessThanOrEqual(firstLeadBy + ctx.waits.open_grace * S);
  });
});

// ---------------------------------------------------------------------------
// Finding 19: the contract has the worker write state=open itself
// ---------------------------------------------------------------------------

describe("F19 worker.ready on a row the worker already set to open (contract.md 'Success')", () => {
  test("still sets the deadlines and asks for the link once", () => {
    // contract.md: the worker saves provider_meeting_id, join_url and
    // state=open, then calls room.event worker.ready. Applying `ready` to that
    // row finds state open and returns same(): no host_by/lead_by/ends_at,
    // no send_link. C20's "the handler sends the link once" never happens.
    const workerWrote: RoomRow = { ...claimed(), state: "open", join_url: MEET_URL, provider_meeting_id: null };
    const a = ok(apply(workerWrote, { kind: "ready", join_url: MEET_URL }, T0 + 6 * S));
    expect(kinds(a)).toContain("send_link");
    expect(a.room.lead_by).not.toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Finding 20: an effect lost to a crash after the write is never asked for again
// ---------------------------------------------------------------------------

describe("F20 the sweep never re-asks for count_live or send_link", () => {
  test("a lead_in room with no count claim gets count_live again from the sweep", () => {
    // The lead_in write landed, then the function died before countLive ran
    // (or the HighLevel call timed out before the claim). Nothing retries:
    // the join is never booked and nobody is told (P2: booked within 1 minute
    // or flagged).
    const joined = step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "lead_in", source: "zoom" }, T0 + MIN);
    expect(joined.count_claimed_at ?? null).toBe(null);
    const a = ok(sweepRoom(joined, T0 + 3 * MIN, roomCtx({ ...DEFAULT_ROOMS_SETTING, count_on_join: true })));
    expect(kinds(a)).toContain("count_live");
  });

  test("an open room whose link is due but was never sent gets send_link again from the sweep", () => {
    const r = opened(); // ready landed and asked for send_link; the sender died
    const a = ok(sweepRoom(r, T0 + 2 * MIN, ctx));
    expect(kinds(a)).toContain("send_link");
  });
});

// ---------------------------------------------------------------------------
// Checked and sound (kept as regression pins)
// ---------------------------------------------------------------------------

describe("checked: holds that stand", () => {
  test("a lead_in room is never expired by any tick before ends_at + no_end_signal, even with a booked call due", () => {
    const joined = step(step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "host_in", source: "zoom" }, T0 + 20 * S), { kind: "lead_in", source: "zoom" }, T0 + MIN);
    const endsAt = Date.parse(joined.ends_at as string);
    for (let t = T0 + MIN; t < endsAt + 1800 * S; t += 37 * S) {
      const a = ok(sweepRoom(joined, t, ctx, t + 5 * MIN));
      expect(a.to).toBe("lead_in");
      expect(kinds(a)).not.toContain("close_provider");
    }
  });

  test("a final room ignores every system event and refuses every press", () => {
    const ended = step(opened(), { kind: "end", reason: "end" }, T0 + MIN);
    const events: RoomEvent[] = [
      { kind: "claim" },
      { kind: "ready", join_url: MEET_URL },
      { kind: "link_sent" },
      { kind: "opened" },
      { kind: "lead_waiting" },
      { kind: "host_in", source: "zoom" },
      { kind: "host_left" },
      { kind: "lead_in", source: "zoom" },
      { kind: "meeting_ended" },
      { kind: "adopt", contact_id: "c2", call_kind: "demo" },
      { kind: "tick" },
    ];
    for (const e of events) {
      const a = apply(ended, e, T0 + 2 * MIN);
      if (a.ok) expect(a.changed).toBe(false);
    }
  });
});
