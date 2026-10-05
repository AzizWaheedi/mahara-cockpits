import { describe, expect, test } from "bun:test";
import {
  type Applied,
  type Changed,
  type ChannelInput,
  type RoomEvent,
  type RoomRow,
  type RoomState,
  type Refused,
  appHint,
  applyRoomEvent,
  bookedDeadlines,
  canMove,
  channelPlan,
  clockWithDay,
  CODE_ALPHABET,
  CODE_RE,
  CODE_SPACE,
  codeFromTopic,
  countClaimable,
  countdown,
  countLive,
  countUndo,
  createRefusal,
  DEFAULT_ROOMS_JSON,
  DEFAULT_ROOMS_SETTING,
  DEFAULT_WAITS,
  defaultProvider,
  deviceOf,
  eventTime,
  FINAL_STATES,
  fill,
  GOOGLE_EVENT_ID_RE,
  googleEventId,
  heldContacts,
  holdUntil,
  isFinal,
  isPreviewBot,
  isTaggedLead,
  isTestContact,
  kuwaitClock,
  LANE_COPY,
  leadJoined,
  linkChannelsOf,
  liveTitle,
  makeCode,
  manualButtons,
  markEvent,
  meetingFromAddress,
  meetPendingExpired,
  newRoomRow,
  nextDueAt,
  noShowDoubt,
  panelLine,
  PENDING_HOLD_MAX_S,
  parseCode,
  presenceOf,
  readOutLink,
  REASK_AFTER_S,
  replayDue,
  resolveShortLink,
  ROOM_COPY,
  ROOM_STATES,
  ROOM_VIEW_KEYS,
  roomCtx,
  roomHolds,
  roomIdFromGoogleEventId,
  roomsHealth,
  roomsSetting,
  roomTitle,
  roomWhatsappHealth,
  settleDue,
  shortLinkTarget,
  shortUrl,
  stillOnCall,
  sweepRoom,
  timers,
  toRoomView,
  TRANSITIONS,
  waitsFrom,
  watchdogLine,
  whatsappGuardOpen,
  wrapPlan,
  wrapRoomRow,
  zoomDedupeKey,
  zoomEffect,
  zoomRole,
} from "./roomlogic.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const S = 1000;
const MIN = 60 * S;
/** Sunday 4 October 2026, 11:00 in Kuwait. */
const T0 = Date.parse("2026-10-04T08:00:00.000Z");
const ROOM_ID = "3f2a9c1e-7b4d-4e8a-9c2f-0a1b2c3d4e5f";
const REQ_ID = "9b0c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3";
const SETTER = "maria@maharamedia.com";
const CLOSER = "ahmed.abushaiba@maharamedia.com";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=AbC123";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ctx = roomCtx(DEFAULT_ROOMS_SETTING);
const W = ctx.waits;
/** Rooms on for everyone (room.wrap checks the switch and the test list). */
const WRAP_ON = roomsSetting({ ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false });
const at = (t: number) => new Date(t).toISOString();

function room(over: Partial<RoomRow> = {}): RoomRow {
  return {
    ...newRoomRow({
      id: ROOM_ID,
      request_id: REQ_ID,
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
function no(a: Applied): Refused {
  if (a.ok) throw new Error(`expected a refusal, got ${a.from} -> ${a.to}`);
  return a;
}
const apply = (r: RoomRow, e: RoomEvent, t: number) => applyRoomEvent(r, e, t, ctx);
const step = (r: RoomRow, e: RoomEvent, t: number) => ok(apply(r, e, t)).room;

/** A room made, claimed at T0 and opened at T0 + 5 s. */
function opened(over: Partial<RoomRow> = {}, url = MEET_URL): RoomRow {
  let r = room(over);
  r = step(r, { kind: "claim" }, T0);
  return step(r, { kind: "ready", join_url: url, provider_meeting_id: url === ZOOM_URL ? "81234567890" : null }, T0 + 5 * S);
}
const kinds = (c: Changed) => c.effects.map(e => e.kind);

// ---------------------------------------------------------------------------
// Names and settings
// ---------------------------------------------------------------------------

describe("room states and the allowed moves", () => {
  test("nine states, four of them final, and finals have no way out", () => {
    expect(ROOM_STATES.length).toBe(9);
    expect([...FINAL_STATES].sort()).toEqual(["cancelled", "ended", "expired", "failed"]);
    for (const f of FINAL_STATES) expect(TRANSITIONS[f]).toEqual([]);
    for (const s of ROOM_STATES) expect(isFinal(s)).toBe(FINAL_STATES.includes(s));
  });

  test("the move table is exactly the spec's, including host_in back to open and the undo to host_in", () => {
    const allowed = new Set([
      "requested>creating",
      "requested>failed",
      "requested>cancelled",
      "creating>open",
      "creating>failed",
      "creating>cancelled",
      "open>host_in",
      "open>lead_in",
      "open>ended",
      "open>expired",
      "open>cancelled",
      "host_in>open",
      "host_in>lead_in",
      "host_in>ended",
      "host_in>expired",
      "host_in>cancelled",
      "lead_in>host_in",
      "lead_in>ended",
    ]);
    for (const a of ROOM_STATES) for (const b of ROOM_STATES) expect(canMove(a, b)).toBe(allowed.has(`${a}>${b}`));
  });
});

describe("the rooms setting", () => {
  test("ships switched off, test contact only, with the 1.4 waits", () => {
    const s = DEFAULT_ROOMS_SETTING;
    expect(s.enabled).toBe(false);
    expect(s.test_only).toBe(true);
    expect(s.test_contacts).toEqual(["VjPfR4Cc1Y0OFvaqeor5"]);
    expect(s.providers).toEqual({ zoom: false, meet: false });
    expect(s.send).toEqual({ whatsapp_text: false, whatsapp_template: false, email: false });
    expect(s.count_on_join).toBe(false);
    expect(s.short_link).toBe(false);
    expect(s.default_provider).toEqual({ setter: "meet", closer: "zoom" });
    expect(s.waits_s).toEqual({ ...DEFAULT_WAITS });
    expect(s.lengths_min).toEqual({ intro: 30, demo: 60 });
    expect(s.booking_min).toEqual({ intro: 15, demo: 45 });
    expect(DEFAULT_WAITS).toMatchObject({ lead: 600, open_grace: 180, no_end_signal: 1800, standby_max: 2100, booked_guard: 600 });
  });

  test("a damaged setting can only switch things off", () => {
    const s = roomsSetting({ enabled: "true", test_only: "no", providers: { zoom: 1 }, count_on_join: "yes", send: null });
    expect(s.enabled).toBe(false);
    expect(s.test_only).toBe(true);
    expect(s.providers.zoom).toBe(false);
    expect(s.count_on_join).toBe(false);
    expect(s.send.email).toBe(false);
    expect(roomsSetting(null).test_contacts).toEqual([]);
    expect(roomsSetting({ test_only: false }).test_only).toBe(false);
  });

  test("bad waits fall back to the spec's values", () => {
    const w = waitsFrom({ lead: -5, fail: "90", open_grace: 1e9, settle: Number.NaN, ready: "x" });
    expect(w.lead).toBe(600);
    expect(w.fail).toBe(90);
    expect(w.open_grace).toBe(180);
    expect(w.settle).toBe(1200);
    expect(w.ready).toBe(15);
  });

  test("WhatsApp opens only once the connector is off and the single-copy test passed", () => {
    expect(whatsappGuardOpen({ connector_off: true, single_copy_ok_at: "2026-10-03T09:00:00Z" })).toBe(true);
    expect(whatsappGuardOpen({ connector_off: false, single_copy_ok_at: "2026-10-03T09:00:00Z" })).toBe(false);
    expect(whatsappGuardOpen({ connector_off: true, single_copy_ok_at: null })).toBe(false);
    expect(whatsappGuardOpen({ connector_off: "true", single_copy_ok_at: "bad" })).toBe(false);
    expect(whatsappGuardOpen(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Codes and links
// ---------------------------------------------------------------------------

describe("the join code", () => {
  test("32 characters with no I, O, 0 or 1, six long, 1.07 billion codes", () => {
    expect(CODE_ALPHABET.length).toBe(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const c of "IO01") expect(CODE_ALPHABET.includes(c)).toBe(false);
    for (const c of CODE_ALPHABET) expect(CODE_RE.test(c.repeat(6))).toBe(true);
    expect(CODE_SPACE).toBe(1_073_741_824);
  });

  test("random bytes map to characters without bias, and the result always validates", () => {
    expect(makeCode(() => new Uint8Array([0, 31, 32, 255, 100, 7]))).toBe("A9A9EH");
    const counts = new Map<string, number>();
    for (let i = 0; i < 20_000; i++) {
      const code = makeCode();
      expect(CODE_RE.test(code)).toBe(true);
      for (const ch of code) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    // 120,000 characters over 32: about 3,750 each.
    for (const ch of CODE_ALPHABET) {
      expect(counts.get(ch) ?? 0).toBeGreaterThan(3_350);
      expect(counts.get(ch) ?? 0).toBeLessThan(4_150);
    }
    expect(() => makeCode(() => new Uint8Array(3))).toThrow();
  });

  test("a code typed or pasted by a person is read back; anything else is not a code", () => {
    expect(parseCode("k7q2mx")).toBe("K7Q2MX");
    expect(parseCode(" K7Q-2MX ")).toBe("K7Q2MX");
    expect(parseCode("https://call.maharamedia.com/K7Q2MX/?utm=wa")).toBe("K7Q2MX");
    expect(parseCode("call.maharamedia.com/k7q2mx")).toBe("K7Q2MX");
    for (const bad of ["K7Q2M", "K7Q2MXX", "K7Q2M0", "K7Q2MI", "", null, 42, "K7Q2M!", "x".repeat(300)])
      expect(parseCode(bad)).toBe(null);
  });

  test("titles carry the code only, and the code comes back out of a Zoom topic", () => {
    expect(roomTitle("K7Q2MX")).toBe("Mahara call K7Q2MX");
    expect(codeFromTopic("Mahara call K7Q2MX")).toBe("K7Q2MX");
    expect(codeFromTopic("Demo with Sara")).toBe(null);
    expect(codeFromTopic("Mahara call K7Q2M0")).toBe(null);
  });
});

describe("the short link", () => {
  test("is call.maharamedia.com/{code} when switched on, else the room's own link", () => {
    expect(shortUrl("K7Q2MX", MEET_URL, true)).toBe("https://call.maharamedia.com/K7Q2MX");
    expect(shortUrl("K7Q2MX", MEET_URL, false)).toBe(MEET_URL);
    expect(shortUrl("K7Q2MX", "http://insecure.example", false)).toBe(null);
    expect(shortUrl("K7Q2MX", "javascript:alert(1)", false)).toBe(null);
    expect(readOutLink("K7Q2MX", MEET_URL, true)).toBe("call.maharamedia.com/K7Q2MX");
    expect(readOutLink("K7Q2MX", MEET_URL, false)).toBe("meet.google.com/abc-defg-hij");
  });

  test("opens a live room, waits on one being made, and shows the ended page after", () => {
    expect(shortLinkTarget(room(), T0)).toEqual({ kind: "pending", room_id: ROOM_ID });
    const r = opened();
    expect(shortLinkTarget(r, T0)).toEqual({ kind: "join", url: MEET_URL, room_id: ROOM_ID });
    const ended = step(r, { kind: "end", reason: "end" }, T0 + MIN);
    expect(shortLinkTarget(ended, T0 + MIN)).toEqual({ kind: "ended", room_id: ROOM_ID });
    expect(shortLinkTarget(null, T0)).toEqual({ kind: "unknown" });
  });

  test("a booked room keeps working until the call's end, because the meeting is the closer's own", () => {
    const plan = wrapPlan({ setting: WRAP_ON, contact_id: "c1", start: at(T0 + 15 * MIN), end: at(T0 + 60 * MIN), address: ZOOM_URL, call_kind: "demo", now: T0, ctx });
    if (!plan.ok) throw new Error(plan.message);
    const b = wrapRoomRow({ id: ROOM_ID, request_id: REQ_ID, code: "K7Q2MX", contact_id: "c1", call_kind: "demo", host_email: CLOSER, made_by: CLOSER, now: T0 }, plan);
    const expired = ok(sweepRoom(b, T0 + 31 * MIN, ctx)).room;
    expect(expired.state).toBe("expired");
    expect(shortLinkTarget(expired, T0 + 40 * MIN).kind).toBe("join");
    expect(shortLinkTarget(expired, T0 + 60 * MIN).kind).toBe("ended");
  });

  test("follows a replaced room, at most three steps, and never loops", () => {
    const a = { ...opened(), state: "cancelled" as RoomState, replaced_by: "b" };
    const b = { ...opened({ id: "b", code: "B2B2B2" }), replaced_by: null };
    const rows: Record<string, RoomRow> = { K7Q2MX: a, b };
    const find = (by: { code?: string; id?: string }) => (by.code ? rows[by.code] : rows[by.id ?? ""]);
    expect(resolveShortLink("k7q2mx", find, T0)).toEqual({ kind: "join", url: MEET_URL, room_id: "b" });
    const loop = { ...a, replaced_by: ROOM_ID };
    expect(resolveShortLink("K7Q2MX", by => (by.code ? loop : loop), T0)).toEqual({ kind: "ended", room_id: ROOM_ID });
    expect(resolveShortLink("nope", find, T0)).toEqual({ kind: "unknown" });
    expect(resolveShortLink("ZZZZZZ", () => null, T0)).toEqual({ kind: "unknown" });
  });
});

// ---------------------------------------------------------------------------
// The state machine, event by event
// ---------------------------------------------------------------------------

describe("making a room: claim, ready, fail", () => {
  test("the worker's claim moves requested to creating and bumps the version", () => {
    const c = ok(apply(room(), { kind: "claim", worker_run: "run-1" }, T0));
    expect(c.to).toBe("creating");
    expect(c.patch).toEqual({ claimed_at: at(T0), worker_run: "run-1", state: "creating", version: 2 });
    expect(c.expect).toEqual({ state: "requested", version: 1, claimed_at: null, worker_run: null });
    expect(no(apply(c.room, { kind: "claim" }, T0)).code).toBe("not_requested");
  });

  test("ready opens a fallback room with its deadlines, and the link goes at once", () => {
    const r = step(room(), { kind: "claim" }, T0);
    const c = ok(apply(r, { kind: "ready", join_url: MEET_URL }, T0 + 5 * S));
    expect(c.to).toBe("open");
    expect(c.room.opened_at).toBe(at(T0 + 5 * S));
    expect(c.room.host_by).toBe(at(T0 + 5 * S + 900 * S));
    expect(c.room.lead_by).toBe(at(T0 + 5 * S + 600 * S));
    expect(c.room.ends_at).toBe(at(T0 + 5 * S + 30 * MIN));
    expect(kinds(c)).toEqual(["send_link"]);
  });

  test("a handover made for a taker sends its link only when the host is in", () => {
    const r = opened({ purpose: "handover", call_kind: "demo", provider: "zoom", host_email: CLOSER, send_on: "host_in" }, ZOOM_URL);
    expect(r.host_by).toBe(at(T0 + 5 * S + 120 * S));
    expect(r.ends_at).toBe(at(T0 + 5 * S + 60 * MIN));
    const c = ok(apply(r, { kind: "host_in", source: "zoom" }, T0 + 30 * S));
    expect(kinds(c)).toEqual(["send_link"]);
  });

  test("a standby room has no lead: no lead deadline and no link", () => {
    const r = opened({ purpose: "standby", contact_id: null, call_kind: "demo", provider: "zoom", host_email: CLOSER }, ZOOM_URL);
    expect(r.host_by).toBe(at(T0 + 5 * S + 300 * S));
    expect(r.lead_by).toBe(null);
    expect(no(apply(r, { kind: "link_sent" }, T0 + 10 * S)).code).toBe("no_lead");
    expect(no(apply(r, { kind: "lead_in", source: "zoom" }, T0 + 10 * S)).code).toBe("no_lead");
  });

  test("ready refuses a bad link, an unclaimed room, and a second different link", () => {
    const r = step(room(), { kind: "claim" }, T0);
    expect(no(apply(r, { kind: "ready", join_url: "http://meet.google.com/x" }, T0)).code).toBe("bad_link");
    const early = no(apply(room(), { kind: "ready", join_url: MEET_URL }, T0));
    expect(early.code).toBe("not_claimed");
    expect(early.retry).toBe(true);
    const o = step(r, { kind: "ready", join_url: MEET_URL }, T0);
    expect(ok(apply(o, { kind: "ready", join_url: MEET_URL }, T0)).changed).toBe(false);
    expect(no(apply(o, { kind: "ready", join_url: ZOOM_URL }, T0)).code).toBe("already_open");
  });

  test("a provider failure fails the room with its sentence; a working room cannot fail", () => {
    const r = step(room({ provider: "zoom" }), { kind: "claim" }, T0);
    const c = ok(apply(r, { kind: "fail", error: "Zoom refused the meeting: the user is not active." }, T0 + 3 * S));
    expect(c.to).toBe("failed");
    expect(c.room.result).toBe("failed");
    expect(c.room.error).toBe("Zoom refused the meeting: the user is not active.");
    expect(kinds(c)).toEqual(["delete_secret", "close_provider"]);
    expect(ok(apply(room(), { kind: "fail", error: "" }, T0)).room.error).toBe(LANE_COPY.worker_failed);
    expect(kinds(ok(apply(room(), { kind: "fail", error: "x" }, T0)))).toEqual(["delete_secret"]);
    expect(no(apply(opened(), { kind: "fail", error: "late" }, T0 + MIN)).code).toBe("already_open");
  });

  test("a link saved for a room that closed meanwhile is refused, and the worker deletes the meeting", () => {
    const r = step(room(), { kind: "claim" }, T0);
    const cancelled = step(r, { kind: "end", reason: "cancel", actor: { email: SETTER } }, T0 + 2 * S);
    const late = no(apply(cancelled, { kind: "ready", join_url: MEET_URL }, T0 + 8 * S));
    expect(late.code).toBe("final");
    expect(late.cleanup).toBe(true);
    expect(late.retry).toBe(false);
  });
});

describe("the lead's side: link sent, opened, waiting", () => {
  test("the first send sets link_sent_at and the 10 minutes; later sends change nothing", () => {
    const r = opened();
    const c = ok(apply(r, { kind: "link_sent", channel: "email" }, T0 + 20 * S));
    expect(c.room.link_sent_at).toBe(at(T0 + 20 * S));
    expect(c.room.lead_by).toBe(at(T0 + 20 * S + 600 * S));
    expect(c.patch.version).toBeUndefined();
    expect(c.expect).toEqual({ state: "open", link_sent_at: null, lead_by: r.lead_by });
    expect(ok(apply(c.room, { kind: "link_sent" }, T0 + 60 * S)).changed).toBe(false);
    expect(no(apply(room(), { kind: "link_sent" }, T0)).code).toBe("too_early");
  });

  test("an open in the last 3 minutes moves lead_by to open + 180 s; an early open does not", () => {
    let r = step(opened(), { kind: "link_sent" }, T0 + 20 * S);
    const leadBy = Date.parse(r.lead_by as string);
    const early = ok(apply(r, { kind: "opened", device: "phone" }, T0 + 60 * S));
    expect(early.room.first_open_at).toBe(at(T0 + 60 * S));
    expect(early.room.open_device).toBe("phone");
    expect(early.room.lead_by).toBe(r.lead_by);
    r = early.room;
    const late = ok(apply(r, { kind: "opened", device: "computer" }, leadBy - 60 * S));
    expect(late.room.lead_by).toBe(at(leadBy - 60 * S + 180 * S));
    expect(late.room.first_open_at).toBe(at(T0 + 60 * S));
    expect(late.room.open_device).toBe("phone");
  });

  test("a knock in the waiting room is a time and also gets the grace", () => {
    const r = step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "link_sent" }, T0 + 20 * S);
    const leadBy = Date.parse(r.lead_by as string);
    const c = ok(apply(r, { kind: "lead_waiting" }, leadBy - 10 * S));
    expect(c.to).toBe("open");
    expect(c.room.lead_waiting_at).toBe(at(leadBy - 10 * S));
    expect(c.room.lead_by).toBe(at(leadBy - 10 * S + 180 * S));
    expect(no(apply(room(), { kind: "lead_waiting" }, T0)).code).toBe("too_early");
  });
});

describe("host and lead in the room", () => {
  test("host_in from open; a repeat changes nothing; too early is left for the replay", () => {
    const c = ok(apply(opened(), { kind: "host_in", source: "mark", actor: { email: SETTER } }, T0 + 30 * S));
    expect(c.to).toBe("host_in");
    expect(c.room.host_in_at).toBe(at(T0 + 30 * S));
    expect(c.room.version).toBe(4);
    // The same join again (Zoom's retry carries the same time): nothing changes.
    expect(ok(apply(c.room, { kind: "host_in", source: "zoom", at: at(T0 + 30 * S) }, T0 + 31 * S)).changed).toBe(false);
    // A later join (a rejoin after a drop) moves host_in_at on, never the state or the version.
    const rejoin = ok(apply(c.room, { kind: "host_in", source: "zoom" }, T0 + 31 * S));
    expect([rejoin.to, rejoin.room.version, rejoin.room.host_in_at]).toEqual(["host_in", 4, at(T0 + 31 * S)]);
    expect(rejoin.expect).toEqual({ state: "host_in", host_in_at: at(T0 + 30 * S) });
    const early = no(apply(room(), { kind: "host_in", source: "zoom" }, T0));
    expect(early.code).toBe("too_early");
    expect(early.retry).toBe(true);
  });

  test("the host leaving before the lead returns the room to open with at least 120 s", () => {
    const r = step(opened({ purpose: "handover", send_on: "host_in" }), { kind: "host_in", source: "zoom" }, T0 + 20 * S);
    const c = ok(apply(r, { kind: "host_left" }, T0 + 40 * S));
    expect(c.to).toBe("open");
    expect(c.room.host_by).toBe(at(T0 + 40 * S + 120 * S));
    // A fallback room's 15 minutes are not cut short by the reset.
    const f = step(opened(), { kind: "host_in", source: "zoom" }, T0 + 20 * S);
    expect(ok(apply(f, { kind: "host_left" }, T0 + 40 * S)).room.host_by).toBe(f.host_by);
    expect(ok(apply(opened(), { kind: "host_left" }, T0 + 40 * S)).changed).toBe(false);
  });

  test("the lead in, from open (a Meet press) or host_in, asks for the count once", () => {
    const fromOpen = ok(apply(opened(), { kind: "lead_in", source: "mark", actor: { email: SETTER } }, T0 + MIN));
    expect(fromOpen.to).toBe("lead_in");
    expect(kinds(fromOpen)).toEqual(["count_live"]);
    expect(fromOpen.room.ends_at).toBe(at(T0 + MIN + 30 * MIN));
    const twice = ok(apply(fromOpen.room, { kind: "lead_in", source: "zoom" }, T0 + 2 * MIN));
    expect(twice.changed).toBe(false);
    expect(twice.effects).toEqual([]);
    const r = step(opened(), { kind: "host_in", source: "zoom" }, T0 + 20 * S);
    expect(ok(apply(r, { kind: "lead_in", source: "zoom" }, T0 + MIN)).to).toBe("lead_in");
  });

  test("'That was not the lead' within 5 minutes goes back to host_in and undoes the count", () => {
    const joined = { ...step(opened(), { kind: "lead_in", source: "zoom" }, T0 + MIN), count_claimed_at: at(T0 + MIN) };
    const c = ok(apply(joined, { kind: "not_lead", actor: { email: SETTER }, version: joined.version }, T0 + 4 * MIN));
    expect(c.to).toBe("host_in");
    expect(kinds(c)).toEqual(["undo_count"]);
    expect(Date.parse(c.room.lead_by as string)).toBeGreaterThanOrEqual(T0 + 4 * MIN + 180 * S);
    const late = no(apply(joined, { kind: "not_lead", actor: { email: SETTER } }, T0 + MIN + 301 * S));
    expect(late.code).toBe("not_lead_late");
    expect(late.message).toBe("They joined more than 5 minutes ago, so this cannot be undone here. Fix the call in HighLevel.");
    expect(no(apply(opened(), { kind: "not_lead", actor: { email: SETTER } }, T0)).code).toBe("stale");
  });

  test("a standby room is adopted on Take: the lead is set, it becomes a handover, the link goes at once", () => {
    const sb = step(
      opened({ purpose: "standby", contact_id: null, call_kind: "demo", provider: "zoom", host_email: CLOSER }, ZOOM_URL),
      { kind: "host_in", source: "zoom" },
      T0 + 30 * S,
    );
    const c = ok(apply(sb, { kind: "adopt", contact_id: "c9", call_kind: "demo", handover_id: "h1", actor: { email: CLOSER } }, T0 + 20 * MIN));
    expect(c.to).toBe("host_in");
    expect(c.room).toMatchObject({ contact_id: "c9", purpose: "handover", handover_id: "h1", send_on: "open" });
    expect(c.room.version).toBe(sb.version + 1);
    expect(c.room.lead_by).toBe(at(T0 + 20 * MIN + 600 * S));
    expect(kinds(c)).toEqual(["send_link"]);
    expect(no(apply(c.room, { kind: "adopt", contact_id: "c2", call_kind: "demo" }, T0 + 21 * MIN)).code).toBe("not_standby");
    // Not in the room yet: the link waits for the host, and the host has 120 s.
    const sbOpen = opened({ purpose: "standby", contact_id: null, call_kind: "demo", provider: "zoom", host_email: CLOSER }, ZOOM_URL);
    const o = ok(apply(sbOpen, { kind: "adopt", contact_id: "c9", call_kind: "demo" }, T0 + MIN));
    expect(o.room.send_on).toBe("host_in");
    expect(o.effects).toEqual([]);
    expect(Date.parse(o.room.host_by as string)).toBeGreaterThanOrEqual(T0 + MIN + 120 * S);
  });
});

describe("ending a room", () => {
  test("a room with the lead in it needs a yes, and never gets a provider call", () => {
    const joined = step(opened(), { kind: "lead_in", source: "zoom" }, T0 + MIN);
    const ask = no(apply(joined, { kind: "end", reason: "end", actor: { email: SETTER }, version: joined.version }, T0 + 5 * MIN));
    expect(ask.code).toBe("confirm_end");
    expect(ask.message).toBe("The lead is still in this room. End it anyway?");
    const yes = ok(apply(joined, { kind: "end", reason: "end", confirm: true, actor: { email: SETTER } }, T0 + 5 * MIN));
    expect(yes.to).toBe("ended");
    expect(yes.room.result).toBe("joined");
    expect(kinds(yes)).toEqual(["delete_secret"]);
    const finished = ok(apply(joined, { kind: "end", reason: "finished", actor: { email: SETTER } }, T0 + 20 * MIN));
    expect(finished.to).toBe("ended");
    expect(kinds(finished)).toEqual(["delete_secret"]);
  });

  test("cancel, on the phone and end each close a room with no lead in it, with a result", () => {
    const r = opened();
    const cancel = ok(apply(r, { kind: "end", reason: "cancel" }, T0 + MIN));
    expect([cancel.to, cancel.room.result]).toEqual(["cancelled", "cancelled"]);
    expect(kinds(cancel)).toEqual(["delete_secret", "close_provider"]);
    const phone = ok(apply(r, { kind: "end", reason: "on_phone" }, T0 + MIN));
    expect([phone.to, phone.room.result]).toEqual(["cancelled", "moved_to_phone"]);
    const end = ok(apply(r, { kind: "end", reason: "end" }, T0 + MIN));
    expect([end.to, end.room.result]).toEqual(["ended", "no_join"]);
    expect(end.room.ended_at).toBe(at(T0 + MIN));
  });

  test("'I can't let them in' closes the room and asks for one on the other provider", () => {
    const c = ok(apply(opened(), { kind: "end", reason: "admit_blocked", actor: { email: SETTER } }, T0 + MIN));
    expect([c.to, c.room.result]).toEqual(["cancelled", "admit_blocked"]);
    expect(c.effects).toContainEqual({ kind: "replace", provider: "zoom" });
  });

  test("a room still being made is cancelled; one never claimed needs no provider call", () => {
    expect(kinds(ok(apply(room(), { kind: "end", reason: "end" }, T0)))).toEqual(["delete_secret"]);
    const creating = step(room(), { kind: "claim" }, T0);
    const c = ok(apply(creating, { kind: "end", reason: "finished" }, T0 + S));
    expect(c.to).toBe("cancelled");
    expect(kinds(c)).toEqual(["delete_secret", "close_provider"]);
  });

  test("Zoom's meeting.ended ends the room; a booked room's meeting is never closed by us", () => {
    const joined = step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "lead_in", source: "zoom" }, T0 + MIN);
    const c = ok(apply(joined, { kind: "meeting_ended" }, T0 + 20 * MIN));
    expect([c.to, c.room.result]).toEqual(["ended", "joined"]);
    expect(kinds(c)).toEqual(["delete_secret"]);
    const plan = wrapPlan({ setting: WRAP_ON, contact_id: "c1", start: at(T0 + 15 * MIN), address: ZOOM_URL, call_kind: "demo", now: T0, ctx });
    if (!plan.ok) throw new Error("wrap");
    const b = wrapRoomRow({ id: ROOM_ID, request_id: REQ_ID, code: "K7Q2MX", contact_id: "c1", call_kind: "demo", host_email: CLOSER, made_by: CLOSER, now: T0 }, plan);
    expect(kinds(ok(apply(b, { kind: "end", reason: "cancel" }, T0 + MIN)))).toEqual(["delete_secret"]);
  });

  test("ending a room that already closed is a quiet no-op", () => {
    const ended = step(opened(), { kind: "end", reason: "end" }, T0 + MIN);
    const again = ok(apply(ended, { kind: "end", reason: "end", actor: { email: SETTER } }, T0 + 2 * MIN));
    expect(again.changed).toBe(false);
    expect(again.room).toBe(ended);
  });
});

describe("who may press, and stale buttons", () => {
  test("only the host or a manager; the refusal names the host", () => {
    const r = opened({ host_email: CLOSER, purpose: "manual" });
    const other = no(apply(r, { kind: "end", reason: "end", actor: { email: SETTER } }, T0));
    expect(other.code).toBe("not_host");
    expect(other.status).toBe(403);
    expect(other.message).toBe("This room belongs to Ahmed.");
    const named = applyRoomEvent(r, { kind: "end", reason: "end", actor: { email: SETTER } }, T0, { ...ctx, host_first_name: "Ahmed Abushaiba" });
    expect(no(named).message).toBe("This room belongs to Ahmed.");
    expect(ok(apply(r, { kind: "end", reason: "end", actor: { email: "ceo@maharamedia.com", manager: true } }, T0)).to).toBe("ended");
    expect(ok(apply(r, { kind: "end", reason: "end", actor: { email: " AHMED.ABUSHAIBA@maharamedia.com " } }, T0)).to).toBe("ended");
  });

  test("a press made on an old version is refused with 'This changed a moment ago.'", () => {
    const r = opened();
    const stale = no(apply(r, { kind: "host_in", source: "mark", actor: { email: SETTER }, version: r.version - 1 }, T0));
    expect(stale.code).toBe("stale");
    expect(stale.message).toBe("This changed a moment ago.");
    expect(stale.status).toBe(409);
    const closed = step(r, { kind: "end", reason: "end" }, T0 + S);
    expect(no(apply(closed, { kind: "lead_in", source: "mark", actor: { email: SETTER } }, T0 + 2 * S)).code).toBe("stale");
    expect(no(apply(closed, { kind: "lead_in", source: "zoom" }, T0 + 2 * S)).code).toBe("final");
  });

  test("room.mark's three presses, and nonsense refused", () => {
    expect(markEvent("host_in", { email: SETTER }, 3)).toEqual({ kind: "host_in", source: "mark", actor: { email: SETTER }, version: 3 });
    expect(markEvent("lead_in", { email: SETTER }, 3)?.kind).toBe("lead_in");
    expect(markEvent("not_lead", { email: SETTER }, 3)?.kind).toBe("not_lead");
    expect(markEvent("showed", { email: SETTER }, 3)).toBe(null);
    expect(no(apply(opened(), { kind: "dance" } as unknown as RoomEvent, T0)).code).toBe("bad_input");
    expect(no(apply(opened(), { kind: "end", reason: "whenever" } as unknown as RoomEvent, T0)).code).toBe("bad_input");
    expect(no(apply({ ...opened(), state: "zombie" } as unknown as RoomRow, { kind: "tick" }, T0)).code).toBe("bad_input");
    expect(no(apply(opened(), { kind: "tick" }, Number.NaN)).code).toBe("bad_input");
  });

  test("every write carries a compare-and-set guard: the state, the version on a move, and each old value", () => {
    const r = opened();
    const c = ok(apply(r, { kind: "lead_in", source: "zoom" }, T0 + MIN));
    expect(c.expect).toEqual({ state: "open", version: r.version, lead_in_at: null, lead_in_seen_at: null, ends_at: r.ends_at });
    expect(c.patch.version).toBe(r.version + 1);
  });
});

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

describe("the sweep and its timers", () => {
  test("a room nobody claimed fails after 60 s, not before", () => {
    expect(ok(sweepRoom(room(), T0 + 59 * S, ctx)).changed).toBe(false);
    const c = ok(sweepRoom(room(), T0 + 60 * S, ctx));
    expect([c.to, c.reason, c.room.error]).toEqual(["failed", "fail", LANE_COPY.worker_late]);
    expect(kinds(c)).toEqual(["delete_secret"]);
  });

  test("a room stuck in creating is recovered at 60 s and failed at 120 s (the worker crashed half way)", () => {
    const r = step(room(), { kind: "claim" }, T0);
    expect(ok(sweepRoom(r, T0 + 59 * S, ctx)).effects).toEqual([]);
    const rec = ok(sweepRoom(r, T0 + 60 * S, ctx));
    expect(rec.changed).toBe(false);
    expect(rec.effects).toEqual([{ kind: "recover" }]);
    const f = ok(sweepRoom(r, T0 + 120 * S, ctx));
    expect([f.to, f.room.error]).toEqual(["failed", LANE_COPY.worker_lost]);
    expect(kinds(f)).toEqual(["delete_secret", "close_provider"]);
  });

  test("a fallback room expires 10 minutes after the link, and the provider side is closed", () => {
    const r = step(opened(), { kind: "link_sent" }, T0 + 10 * S);
    expect(ok(sweepRoom(r, T0 + 10 * S + 599 * S, ctx)).changed).toBe(false);
    const c = ok(sweepRoom(r, T0 + 10 * S + 600 * S, ctx));
    expect([c.to, c.reason, c.room.result]).toEqual(["expired", "lead_by", "no_join"]);
    expect(kinds(c)).toEqual(["delete_secret", "close_provider"]);
  });

  test("a handover host who is not in within 120 s lets the room expire", () => {
    const r = opened({ purpose: "handover", send_on: "host_in", provider: "zoom" }, ZOOM_URL);
    expect(ok(sweepRoom(r, T0 + 5 * S + 119 * S, ctx)).changed).toBe(false);
    expect(ok(sweepRoom(r, T0 + 5 * S + 120 * S, ctx)).reason).toBe("host_by");
  });

  test("a standby room expires at 300 s with no host, and is refreshed at 35 minutes while the host is available", () => {
    const sb = opened({ purpose: "standby", contact_id: null, call_kind: "demo", provider: "zoom", host_email: CLOSER }, ZOOM_URL);
    expect(ok(sweepRoom(sb, T0 + 5 * S + 300 * S, ctx)).reason).toBe("host_by");
    const inRoom = step(sb, { kind: "host_in", source: "zoom" }, T0 + 60 * S);
    const avail = { available_until: at(T0 + 2 * 3_600_000) };
    expect(ok(sweepRoom(inRoom, T0 + 5 * S + 2099 * S, ctx, null, avail)).changed).toBe(false);
    const c = ok(sweepRoom(inRoom, T0 + 5 * S + 2100 * S, ctx, null, avail));
    expect([c.to, c.reason]).toEqual(["expired", "standby_max"]);
    expect(kinds(c)).toEqual(["delete_secret", "close_provider", "refresh_standby"]);
    // Availability not given: the room still closes, and no fresh one is made that nobody asked to keep.
    expect(kinds(ok(sweepRoom(inRoom, T0 + 5 * S + 2100 * S, ctx)))).toEqual(["delete_secret", "close_provider"]);
  });

  test("the booked-call guard closes an empty standby room 10 minutes before; anything else only alerts", () => {
    const sb = step(
      opened({ purpose: "standby", contact_id: null, call_kind: "demo", provider: "zoom", host_email: CLOSER }, ZOOM_URL),
      { kind: "host_in", source: "zoom" },
      T0 + 30 * S,
    );
    const booked = T0 + 20 * MIN;
    expect(ok(sweepRoom(sb, booked - 601 * S, ctx, booked)).changed).toBe(false);
    const g = ok(sweepRoom(sb, booked - 600 * S, ctx, booked));
    expect([g.to, g.reason]).toEqual(["expired", "booked_guard"]);
    expect(kinds(g)).not.toContain("refresh_standby");

    const live = step(
      step(opened({ purpose: "handover", call_kind: "demo", provider: "zoom", host_email: CLOSER }, ZOOM_URL), { kind: "host_in", source: "zoom" }, T0 + 30 * S),
      { kind: "lead_in", source: "zoom" },
      T0 + MIN,
    );
    const a = ok(sweepRoom(live, booked - 5 * MIN, ctx, booked));
    expect(a.changed).toBe(false);
    expect(a.effects).toEqual([{ kind: "alert", what: "booked_guard", dedupe_key: `room:${ROOM_ID}:booked_guard:${at(booked)}` }]);
  });

  test("no timer ends a room with the lead in it before ends_at + 30 minutes, and then only in the books", () => {
    const joined = step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "lead_in", source: "zoom" }, T0 + MIN);
    const endsAt = Date.parse(joined.ends_at as string);
    expect(stillOnCall(joined, endsAt - S)).toBe(false);
    expect(stillOnCall(joined, endsAt)).toBe(true);
    for (const t of [T0 + 2 * MIN, endsAt, endsAt + 1799 * S])
      expect(ok(sweepRoom(joined, t, ctx, t + MIN)).to).toBe("lead_in");
    const c = ok(sweepRoom(joined, endsAt + 1800 * S, ctx));
    expect([c.to, c.reason, c.room.result, c.room.error]).toEqual(["ended", "no_end_signal", "joined", "No end signal from Zoom"]);
    expect(kinds(c)).toEqual(["delete_secret"]);
    const meet = step(opened(), { kind: "lead_in", source: "mark" }, T0 + MIN);
    expect(ok(sweepRoom(meet, Date.parse(meet.ends_at as string) + 1800 * S, ctx)).room.error).toBe("No end signal");
  });

  test("a booked room uses the appointment's times: host by start + 15, lead by start + 20", () => {
    const start = T0 + 15 * MIN;
    expect(bookedDeadlines(start, start + 45 * MIN, "demo", ctx)).toEqual({
      host_by: at(start + 15 * MIN),
      lead_by: at(start + 20 * MIN),
      ends_at: at(start + 45 * MIN),
    });
    expect(bookedDeadlines(start, null, "demo", ctx).ends_at).toBe(at(start + 60 * MIN));
    const plan = wrapPlan({ setting: WRAP_ON, contact_id: "c1", start: at(start), end: at(start + 45 * MIN), address: ZOOM_URL, call_kind: "demo", now: T0, ctx });
    if (!plan.ok) throw new Error("wrap");
    const b = wrapRoomRow({ id: ROOM_ID, request_id: REQ_ID, code: "K7Q2MX", contact_id: "c1", call_kind: "demo", host_email: CLOSER, made_by: CLOSER, now: T0 }, plan);
    expect(ok(sweepRoom(b, start + 15 * MIN - S, ctx)).changed).toBe(false);
    const c = ok(sweepRoom(b, start + 15 * MIN, ctx));
    expect([c.to, c.reason]).toEqual(["expired", "host_by"]);
    expect(kinds(c)).toEqual(["delete_secret"]);
  });

  test("every room that is not final has a timer, so nothing waits forever", () => {
    const broken = { ...opened(), host_by: null, lead_by: null, ends_at: null, opened_at: null };
    for (const s of ["requested", "creating", "open", "host_in", "lead_in"] as RoomState[]) {
      // A Zoom standby room: standby_max (Zoom's 40-minute rule).
      for (const r of [{ ...broken, state: s }, { ...broken, state: s, contact_id: null, purpose: "standby" as const, provider: "zoom" as const }]) {
        const t = timers(r, ctx);
        expect(t.length).toBeGreaterThan(0);
        for (const x of t) expect(Number.isFinite(x.at)).toBe(true);
      }
    }
    // A Meet standby room with its host in has no time limit (stress2 round
    // 3): it ends with the host's Available (the sweep's R8, R6).
    expect(timers({ ...broken, state: "host_in", contact_id: null, purpose: "standby" as const, provider: "meet" as const }, ctx)).toEqual([]);
    for (const f of FINAL_STATES) expect(timers({ ...broken, state: f }, ctx)).toEqual([]);
  });
});

describe("small timing rules", () => {
  test("manual buttons: always on Meet and booked rooms, on Zoom after 30 s of silence", () => {
    const meet = step(opened(), { kind: "link_sent" }, T0 + 10 * S);
    expect(manualButtons(meet, T0 + 11 * S, W)).toBe(true);
    const zoom = step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "link_sent" }, T0 + 10 * S);
    expect(manualButtons(zoom, T0 + 39 * S, W)).toBe(false);
    expect(manualButtons(zoom, T0 + 40 * S, W)).toBe(true);
    expect(manualButtons(zoom, T0 + 50 * S, W, at(T0 + 30 * S))).toBe(false);
    expect(manualButtons(zoom, T0 + 60 * S, W, at(T0 + 30 * S))).toBe(true);
    expect(manualButtons(room(), T0 + 600 * S, W)).toBe(false);
  });

  test("Meet pending gives up at 30 s; events replay after 20 s for a day", () => {
    const m = step(room(), { kind: "claim" }, T0);
    expect(meetPendingExpired(m, T0 + 29 * S, W)).toBe(false);
    expect(meetPendingExpired(m, T0 + 30 * S, W)).toBe(true);
    expect(meetPendingExpired({ ...m, provider: "zoom" }, T0 + 30 * S, W)).toBe(false);
    expect(replayDue({ handled_at: null, received_at: at(T0) }, T0 + 19 * S, W)).toBe(false);
    expect(replayDue({ handled_at: null, received_at: at(T0) }, T0 + 20 * S, W)).toBe(true);
    expect(replayDue({ handled_at: at(T0 + S), received_at: at(T0) }, T0 + 60 * S, W)).toBe(false);
    expect(replayDue({ handled_at: null, created_at: at(T0) }, T0 + 2 * 86_400 * S, W)).toBe(false);
  });

  test("an expired booked intro with no mark becomes a no-show at start + 20 minutes; no booking, nothing", () => {
    const start = T0;
    // The link went (link_sent_at): a link that never reached the lead is no evidence (round 3).
    const exp = { ...opened({ appointment_id: "a1" }), state: "expired" as RoomState, link_sent_at: at(T0 + 6 * S) };
    // Evidence that nobody came: the short link went and was never opened (Meet sends no join signal).
    const seen = { short_link: true };
    // The link never reached the lead: the timer leaves the intro to a person.
    expect(settleDue({ ...exp, link_sent_at: null }, at(start), false, start + 1200 * S, W, seen)).toBe(false);
    expect(noShowDoubt({ ...exp, link_sent_at: null }, seen)).toBe("the link never reached the lead");
    expect(settleDue(exp, at(start), false, start + 1199 * S, W, seen)).toBe(false);
    expect(settleDue(exp, at(start), false, start + 1200 * S, W, seen)).toBe(true);
    // Without that evidence a Meet room never settles itself: a person marks the intro.
    expect(settleDue(exp, at(start), false, start + 1200 * S, W)).toBe(false);
    expect(settleDue({ ...exp, first_open_at: at(start) }, at(start), false, start + 1200 * S, W, seen)).toBe(false);
    expect(settleDue({ ...exp, provider: "zoom" }, at(start), false, start + 1200 * S, W, { zoom_unclear: false, zoom_reported: true })).toBe(true);
    // Zoom's silence (no event at all, not even the meeting's start) is no evidence.
    expect(settleDue({ ...exp, provider: "zoom" }, at(start), false, start + 1200 * S, W, { zoom_unclear: false })).toBe(false);
    expect(settleDue({ ...exp, provider: "zoom" }, at(start), false, start + 1200 * S, W, { zoom_unclear: true })).toBe(false);
    expect(settleDue(exp, at(start), false, start + 1200 * S, W, { ...seen, sibling_joined: true })).toBe(false);
    expect(settleDue(exp, at(start), false, start + 1200 * S, W, { ...seen, test_off_calendar: true })).toBe(false);
    // A room made a day before the intro's (moved) start never settles it.
    expect(settleDue(exp, at(start + 86_400_000), false, start + 86_400_000 + 1200 * S, W, seen)).toBe(false);
    expect(settleDue(exp, at(start), true, start + 1200 * S, W)).toBe(false);
    expect(settleDue({ ...exp, settled_mark: "noshow" }, at(start), false, start + 1300 * S, W)).toBe(false);
    expect(settleDue({ ...exp, appointment_id: null }, at(start), false, start + 1300 * S, W)).toBe(false);
    expect(settleDue({ ...exp, call_kind: "demo" }, at(start), false, start + 1300 * S, W)).toBe(false);
    expect(settleDue({ ...exp, state: "ended" }, at(start), false, start + 1300 * S, W)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The queue hold
// ---------------------------------------------------------------------------

describe("roomHolds", () => {
  test("holds a lead while the room is live and its deadline is ahead", () => {
    const r = room();
    expect(holdUntil(r, ctx)).toBe(T0 + 60 * S);
    expect(roomHolds(r, T0 + 59 * S, ctx)).toBe(true);
    expect(roomHolds(r, T0 + 60 * S, ctx)).toBe(false);
    const o = step(opened(), { kind: "link_sent" }, T0 + 10 * S);
    expect(holdUntil(o, ctx)).toBe(Date.parse(o.lead_by as string));
    const noLead = { ...o, lead_by: null };
    expect(holdUntil(noLead, ctx)).toBe(Date.parse(o.host_by as string));
  });

  test("a lead on the video call stays held until the no-end-signal time; finals and standby hold nobody", () => {
    const j = step(opened(), { kind: "lead_in", source: "mark" }, T0 + MIN);
    const until = Date.parse(j.ends_at as string) + 1800 * S;
    expect(roomHolds(j, until - S, ctx)).toBe(true);
    expect(roomHolds(j, until, ctx)).toBe(false);
    expect(roomHolds(step(j, { kind: "end", reason: "finished" }, T0 + 2 * MIN), T0 + 2 * MIN, ctx)).toBe(false);
    expect(holdUntil(opened({ purpose: "standby", contact_id: null }), ctx)).toBe(null);
    const set = heldContacts([room({ contact_id: "a" }), { ...room({ contact_id: "b" }), state: "expired" }, room({ contact_id: null })], T0, ctx);
    expect([...set]).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

const ALL_ON = roomsSetting({
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  short_link: true,
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
});
const LEAD = { phone: "+96550001234", email: "lead@example.com", tags: ["roas-qualified"], dnd: false, dndSettings: {} };
const GUARD = { connector_off: true, single_copy_ok_at: "2026-10-03T09:00:00Z" };
function plan(over: Partial<ChannelInput> = {}) {
  return channelPlan({
    contact: LEAD,
    last_inbound_at: at(T0 - HOURS(2)),
    now: T0,
    setting: ALL_ON,
    whatsapp_on: true,
    guard: GUARD,
    template_live: true,
    room_wa: [],
    ...over,
  });
}
function HOURS(n: number) {
  return n * 3_600_000;
}

describe("which channel carries the link", () => {
  test("inside the window: WhatsApp text first, then the template, then email", () => {
    const p = plan();
    expect(p.order).toEqual(["whatsapp_text", "whatsapp_template", "email"]);
    expect(p.primary).toBe("whatsapp_text");
    expect(p.email_backup).toBe(true);
    expect(p.line).toBe("The lead gets the link on WhatsApp.");
  });

  test("window closed: the template, which needs the short link and a live route", () => {
    const closed = plan({ last_inbound_at: at(T0 - HOURS(30)) });
    expect(closed.primary).toBe("whatsapp_template");
    expect(closed.line).toBe("The lead gets the link on a WhatsApp template.");
    expect(closed.skipped).toContainEqual({ channel: "whatsapp_text", why: "the WhatsApp window is closed" });
    const noShort = plan({ last_inbound_at: null, setting: { ...ALL_ON, short_link: false } });
    expect(noShort.primary).toBe("email");
    expect(noShort.skipped).toContainEqual({ channel: "whatsapp_template", why: "the short link is not live yet" });
    expect(plan({ last_inbound_at: null, template_live: false }).primary).toBe("email");
  });

  test("a bad number sends email first", () => {
    expect(plan({ email_first: true }).order).toEqual(["email", "whatsapp_text", "whatsapp_template"]);
  });

  test("clients and do-not-disturb on every channel are refused; on WhatsApp only, email goes", () => {
    expect(plan({ contact: { ...LEAD, tags: ["client"] } }).refusal).toBe("client");
    expect(plan({ contact: { ...LEAD, dnd: true } }).refusal).toBe("dnd");
    const both = { ...LEAD, dndSettings: { WhatsApp: { status: "active" }, Email: { status: "permanent" } } };
    expect(plan({ contact: both }).refusal).toBe("dnd");
    const waOnly = plan({ contact: { ...LEAD, dndSettings: { WhatsApp: { status: "active" } } } });
    expect(waOnly.refusal).toBe(null);
    expect(waOnly.order).toEqual(["email"]);
  });

  test("the connector gate, the duplicate pause, the global switch and a missing phone each stop WhatsApp", () => {
    expect(plan({ guard: { connector_off: false } }).order).toEqual(["email"]);
    expect(plan({ guard: { connector_off: false } }).skipped[0]?.why).toBe("WhatsApp waits for the single-copy test");
    expect(plan({ wa_paused: true }).order).toEqual(["email"]);
    expect(plan({ whatsapp_on: false }).order).toEqual(["email"]);
    expect(plan({ contact: { ...LEAD, phone: "" } }).order).toEqual(["email"]);
  });

  test("room WhatsApp pauses at 30% of the last 20 sends, its own sends only", () => {
    const sends = (failed: number, total: number) => Array.from({ length: total }, (_, i) => ({ failed: i < failed }));
    expect(roomWhatsappHealth(sends(5, 20)).ok).toBe(true);
    expect(roomWhatsappHealth(sends(6, 20)).ok).toBe(false);
    expect(roomWhatsappHealth(sends(4, 4)).ok).toBe(true); // under the 5-send minimum
    expect(roomWhatsappHealth(sends(2, 5)).ok).toBe(false);
    // Only the newest 20 count.
    expect(roomWhatsappHealth([...sends(0, 20), ...sends(20, 20)]).ok).toBe(true);
    expect(roomWhatsappHealth(null)).toEqual({ ok: false, failed: 0, counted: 0, share: null });
    // The health gates the free text only (stress2 fix round 1): the template still goes, so the share can recover.
    expect(plan({ room_wa: sends(6, 20) }).order).toEqual(["whatsapp_template", "email"]);
    expect(plan({ room_wa: null }).skipped[0]?.why).toBe("WhatsApp video links are failing");
    const tight = { ...GUARD, health: { room: { window: 10, fail_share: 0.5 } } };
    expect(plan({ guard: tight, room_wa: sends(4, 10) }).primary).toBe("whatsapp_text");
  });

  test("nothing can go: read it out, with every reason said once", () => {
    const p = plan({ contact: { ...LEAD, email: "" }, last_inbound_at: null, template_live: false });
    expect(p.read_out).toBe(true);
    expect(p.primary).toBe(null);
    expect(p.not_sent_reason).toBe("the WhatsApp window is closed, no call link template is live and the lead has no email address");
    expect(p.line).toBe("No message can reach this lead. You can still make the room and read the link out.");
    const off = plan({ setting: DEFAULT_ROOMS_SETTING });
    expect(off.not_sent_reason).toBe("WhatsApp is off for video links and email is off for video links");
  });
});

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/** Payloads in the shape Zoom sends (meeting.participant_joined and friends). */
function zoomEvt(event: string, participant?: Record<string, unknown>) {
  return {
    event,
    event_ts: 1_759_564_810_000,
    payload: {
      account_id: "ACCT",
      object: {
        id: "81234567890",
        uuid: "4444AAAiAAAAAiAiAiiAii==",
        host_id: "HOSTZOOMID",
        topic: "Mahara call K7Q2MX",
        ...(participant ? { participant } : {}),
      },
    },
  };
}
const HOST_P = {
  user_id: "16778240",
  user_name: "Ahmed",
  id: "HOSTZOOMID",
  participant_user_id: "HOSTZOOMID",
  participant_uuid: "p-host",
  email: "ahmed.abushaiba@maharamedia.com",
  join_time: "2026-10-04T08:00:10Z",
};
const GUEST_P = { user_id: "16779264", user_name: "Sara", id: "", participant_user_id: "", participant_uuid: "p-lead", email: "", join_time: "2026-10-04T08:03:00Z" };
const ZCTX = { host_zoom_user_id: "HOSTZOOMID", host_email: CLOSER, staff_emails: [CLOSER, SETTER, "ceo@maharamedia.com"], staff_zoom_user_ids: ["SETTERZOOMID"] };

describe("Zoom: staff or lead", () => {
  test("the host by id or email, staff by room_hosts, a guest as the lead", () => {
    expect(zoomRole(HOST_P, "HOSTZOOMID", ZCTX)).toBe("host");
    expect(zoomRole({ ...HOST_P, id: "", participant_user_id: "" }, "HOSTZOOMID", ZCTX)).toBe("host");
    expect(zoomRole({ email: "CEO@maharamedia.com", participant_uuid: "p3" }, "HOSTZOOMID", ZCTX)).toBe("staff");
    expect(zoomRole({ id: "SETTERZOOMID", participant_uuid: "p4" }, "HOSTZOOMID", ZCTX)).toBe("staff");
    expect(zoomRole(GUEST_P, "HOSTZOOMID", ZCTX)).toBe("lead");
  });

  test("being signed in to Zoom says nothing: only the host and room_hosts are staff (F17)", () => {
    const signedIn = { id: "EXT", participant_user_id: "EXT", email: "sara@gmail.com", participant_uuid: "p-sara" };
    expect(zoomRole(signedIn, "HOSTZOOMID", ZCTX)).toBe("lead");
    // The waiting room's uuid no longer decides anything, either way.
    expect(zoomRole(signedIn, "HOSTZOOMID", { ...ZCTX, waited: ["p-other"] })).toBe("lead");
    expect(zoomRole(HOST_P, "HOSTZOOMID", { ...ZCTX, waited: ["p-host"] })).toBe("host");
    expect(zoomRole({ ...signedIn, email: CLOSER }, "OTHERHOST", ZCTX)).toBe("host");
    expect(zoomRole({ ...signedIn, id: "SETTERZOOMID" }, "HOSTZOOMID", ZCTX)).toBe("staff");
  });

  test("the seven events map onto the room, each with when it happened; anything else is ignored", () => {
    const TS = 1_759_564_810_000;
    expect(zoomEffect(zoomEvt("meeting.started"), ZCTX)).toEqual({ room_event: { kind: "host_in", source: "zoom", at: TS }, role: null });
    expect(zoomEffect(zoomEvt("meeting.ended"), ZCTX)).toEqual({ room_event: { kind: "meeting_ended", at: TS }, role: null });
    expect(zoomEffect(zoomEvt("meeting.participant_joined", HOST_P), ZCTX)).toEqual({ room_event: { kind: "host_in", source: "zoom", at: HOST_P.join_time }, role: "host" });
    expect(zoomEffect(zoomEvt("meeting.participant_joined", GUEST_P), ZCTX)).toEqual({ room_event: { kind: "lead_in", source: "zoom", at: GUEST_P.join_time }, role: "lead" });
    expect(zoomEffect(zoomEvt("meeting.participant_jbh_joined", GUEST_P), ZCTX)).toMatchObject({ room_event: { kind: "lead_in" } });
    expect(zoomEffect(zoomEvt("meeting.participant_joined", { email: SETTER, participant_uuid: "s" }), ZCTX)).toMatchObject({ ignore: "staff joined" });
    expect(zoomEffect(zoomEvt("meeting.participant_left", { ...HOST_P, leave_time: "2026-10-04T08:05:00Z" }), ZCTX)).toEqual({ room_event: { kind: "host_left", at: "2026-10-04T08:05:00Z" }, role: "host" });
    expect(zoomEffect(zoomEvt("meeting.participant_left", GUEST_P), ZCTX)).toMatchObject({ role: "lead" });
    expect(zoomEffect(zoomEvt("meeting.participant_joined_waiting_room", { ...GUEST_P, join_time: undefined, date_time: "2026-10-04T08:02:30Z" }), ZCTX)).toEqual({ room_event: { kind: "lead_waiting", at: "2026-10-04T08:02:30Z" }, role: "lead" });
    expect(zoomEffect(zoomEvt("meeting.participant_jbh_waiting", GUEST_P), ZCTX)).toMatchObject({ room_event: { kind: "lead_waiting" } });
    expect(zoomEffect(zoomEvt("meeting.participant_joined_waiting_room", HOST_P), ZCTX)).toMatchObject({ ignore: "staff waiting" });
    expect(zoomEffect(zoomEvt("endpoint.url_validation"), ZCTX)).toMatchObject({ ignore: "not a room event" });
    expect(zoomEffect(null, ZCTX)).toMatchObject({ ignore: "not a room event" });
  });

  test("a retried event has the same dedupe key; a second join is a new one", () => {
    const a = zoomEvt("meeting.participant_joined", GUEST_P);
    expect(zoomDedupeKey(a)).toBe(zoomDedupeKey(JSON.parse(JSON.stringify(a))));
    expect(zoomDedupeKey(a)).toBe("zoom:meeting.participant_joined:4444AAAiAAAAAiAiAiiAii==:p-lead:2026-10-04T08:03:00Z");
    expect(zoomDedupeKey(zoomEvt("meeting.participant_joined", { ...GUEST_P, join_time: "2026-10-04T08:09:00Z" }))).not.toBe(zoomDedupeKey(a));
    expect(zoomDedupeKey(zoomEvt("meeting.ended"))).toBe("zoom:meeting.ended:4444AAAiAAAAAiAiAiiAii==");
  });
});

// ---------------------------------------------------------------------------
// Bots and devices
// ---------------------------------------------------------------------------

const BOTS = [
  "WhatsApp/2.23.20.0 A",
  "WhatsApp/2.2335.6 W",
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
  "Twitterbot/1.0",
  "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  "TelegramBot (like TwitterBot)",
  "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
  "curl/8.4.0",
  "python-requests/2.31.0",
  "Go-http-client/2.0",
  "okhttp/4.12.0",
  "",
];
const PEOPLE: [string, string][] = [
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "phone"],
  ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", "phone"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54 (iPhone15,3; iOS 17_5; en_US; en; scale=3.00; 1290x2796; 615584364)", "phone"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.98;FBBV/612345678;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.5]", "phone"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0", "phone"],
  ["Mozilla/5.0 (Linux; Android 9; CUBOT X19) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "phone"],
  ["Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "tablet"],
  ["Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "tablet"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "computer"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "computer"],
];

describe("link previews and devices", () => {
  test("previews and machines are bots", () => {
    for (const ua of BOTS) expect([ua, isPreviewBot(ua)]).toEqual([ua, true]);
    expect(isPreviewBot(PEOPLE[0]?.[0], "HEAD")).toBe(true);
    expect(isPreviewBot(undefined)).toBe(true);
  });

  test("people in browsers and in-app browsers are not, and their device is read", () => {
    for (const [ua, device] of PEOPLE) {
      expect([ua, isPreviewBot(ua, "GET")]).toEqual([ua, false]);
      expect([ua, deviceOf(ua)]).toEqual([ua, device]);
    }
    expect(deviceOf("")).toBe(null);
    expect(deviceOf("SomethingElse/1.0")).toBe(null);
  });

  test("the short page's app hint by provider", () => {
    expect(appHint("zoom")).toBe("No Zoom app? Tap Join from your browser.");
    expect(appHint("meet")).toBe("Meet needs iOS 17 or the Meet app.");
  });
});

// ---------------------------------------------------------------------------
// The Google event id
// ---------------------------------------------------------------------------

describe("the Google event id", () => {
  test("is the room's UUID as 32 hex digits, inside base32hex, and comes back", () => {
    const id = googleEventId(ROOM_ID);
    expect(id).toBe("3f2a9c1e7b4d4e8a9c2f0a1b2c3d4e5f");
    expect(GOOGLE_EVENT_ID_RE.test(id as string)).toBe(true);
    expect(googleEventId(ROOM_ID.toUpperCase())).toBe(id);
    expect(roomIdFromGoogleEventId(id)).toBe(ROOM_ID);
    for (let i = 0; i < 500; i++) {
      const u = crypto.randomUUID();
      const g = googleEventId(u) as string;
      expect(/^[0-9a-v]{32}$/.test(g)).toBe(true);
      expect(roomIdFromGoogleEventId(g)).toBe(u);
    }
  });

  test("anything that is not a UUID has no event id", () => {
    for (const bad of ["", "K7Q2MX", "3f2a9c1e-7b4d-4e8a-9c2f-0a1b2c3d4e5", null, 7, "zz2a9c1e-7b4d-4e8a-9c2f-0a1b2c3d4e5f"])
      expect(googleEventId(bad)).toBe(null);
    expect(roomIdFromGoogleEventId("xyz")).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// countLive
// ---------------------------------------------------------------------------

const COUNT_ON = roomsSetting({ ...DEFAULT_ROOMS_JSON, count_on_join: true, test_calendar_id: "TESTCAL", live_calendar_id: "LIVECAL" });
const JOIN = Date.parse("2026-10-04T08:04:37.000Z");
function joinedRoom(over: Partial<RoomRow> = {}): RoomRow {
  return { ...opened(), state: "lead_in", lead_in_at: at(JOIN), ...over };
}
function count(over: Partial<Parameters<typeof countLive>[0]> = {}) {
  return countLive({
    room: joinedRoom(),
    setting: COUNT_ON,
    contact: { firstName: "Sara", name: "Sara Al Ali", tags: ["roas-qualified"] },
    upcoming: null,
    host_ghl_user_id: "GHLSETTER",
    location_id: "7NI8yyJtwsh2OOWA5Icr",
    link: "https://call.maharamedia.com/K7Q2MX",
    ...over,
  });
}

describe("countLive", () => {
  test("switched off, no lead, not joined, or already claimed: nothing, and no claim", () => {
    expect(count({ setting: DEFAULT_ROOMS_SETTING })).toEqual({ action: "none", claim: false, count_result: null, reason: "switch_off" });
    expect(count({ room: joinedRoom({ contact_id: null }) })).toMatchObject({ reason: "no_contact", claim: false });
    expect(count({ room: joinedRoom({ lead_in_at: null }) })).toMatchObject({ reason: "not_joined", claim: false });
    expect(count({ room: joinedRoom({ count_claimed_at: at(JOIN), count_result: "booked" }) })).toMatchObject({ reason: "claimed", claim: false });
    expect(count({ room: joinedRoom({ purpose: "booked" }) })).toMatchObject({ reason: "booked_room", claim: false });
  });

  test("after an undo the claim can be taken again for the real lead", () => {
    const r = joinedRoom({ count_claimed_at: at(JOIN), count_result: "undone" });
    expect(countClaimable(r)).toBe(true);
    expect(count({ room: r }).action).toBe("create");
  });

  test("a fallback room for a booked intro marks that intro", () => {
    expect(count({ room: joinedRoom({ appointment_id: "APPT1" }) })).toEqual({ action: "mark", claim: true, appointment_id: "APPT1" });
  });

  test("clients and untagged contacts are not leads: claimed, nothing booked", () => {
    expect(count({ contact: { tags: ["roas-qualified", "client"] } })).toEqual({ action: "none", claim: true, count_result: "not_a_lead", reason: "client" });
    expect(count({ contact: { tags: ["roas-unprepared"] } })).toMatchObject({ count_result: "not_a_lead", reason: "not_a_lead" });
    expect(count({ contact: null })).toMatchObject({ count_result: "not_a_lead" });
  });

  test("a host with no HighLevel user cannot be booked or marked", () => {
    expect(count({ host_ghl_user_id: null })).toMatchObject({ action: "none", count_result: "failed", reason: "host_not_in_highlevel" });
  });

  test("a new live intro: the Live calendar (never B2B's), the join minute, 15 minutes, quiet, our link", () => {
    const p = count();
    if (p.action !== "create") throw new Error(p.action);
    expect(p.calendar_id).toBe("LIVECAL");
    expect(p.start).toBe("2026-10-04T08:04:00.000Z");
    expect(p.end).toBe("2026-10-04T08:19:00.000Z");
    expect(p.body).toEqual({
      calendarId: "LIVECAL",
      locationId: "7NI8yyJtwsh2OOWA5Icr",
      contactId: "c1",
      startTime: "2026-10-04T08:04:00.000Z",
      endTime: "2026-10-04T08:19:00.000Z",
      title: "Live · Sara",
      appointmentStatus: "confirmed",
      assignedUserId: "GHLSETTER",
      ignoreFreeSlotValidation: true,
      ignoreDateRange: true,
      toNotify: false,
      meetingLocationType: "custom",
      address: "https://call.maharamedia.com/K7Q2MX",
      overrideLocationConfig: true,
    });
    const unq = count({ contact: { firstName: "Omar", tags: ["roas-unqualified"] } });
    expect(unq.action === "create" && unq.calendar_id).toBe("LIVECAL");
    const demo = count({ room: joinedRoom({ call_kind: "demo" }) });
    expect(demo.action === "create" && [demo.calendar_id, demo.end]).toEqual(["LIVECAL", "2026-10-04T08:49:00.000Z"]);
    // D25: no Live calendar, or one of B2B's own, and nothing is booked.
    for (const live of [null, "dsqmJ393Dwl9fDSbIVOI", "cFeDl0FY8iaXll61lus8", "jQqXS1YuFnmGZKLkrE62"])
      expect(count({ setting: { ...COUNT_ON, live_calendar_id: live } })).toMatchObject({ action: "none", reason: "live_calendar_missing", count_result: "failed" });
    expect(count({ official_calendar_ids: ["LIVECAL"] })).toMatchObject({ action: "none", reason: "live_calendar_missing" });
  });

  test("a call of the same kind booked ahead is moved to now; another kind is not", () => {
    const up = {
      id: "UP1",
      start: Date.parse("2026-10-08T07:00:00Z"),
      end: Date.parse("2026-10-08T07:30:00Z"),
      assigned_user_id: "GHLCLOSER",
      status: "confirmed",
      kind: "intro" as const,
    };
    // Another rep's call ahead is never moved to this host (round 3): refused like the mark path.
    expect(count({ upcoming: up })).toMatchObject({ action: "none", reason: "booked_other_rep", count_result: "failed" });
    // The host's own call ahead (or a manager's room: upcoming_mine) is moved to now.
    const p = count({ upcoming: up, upcoming_mine: true });
    if (p.action !== "move") throw new Error(p.action);
    expect(p.appointment_id).toBe("UP1");
    expect(p.from_start).toBe("2026-10-08T07:00:00.000Z");
    expect([p.from_end, p.from_assigned_user_id, p.from_status]).toEqual(["2026-10-08T07:30:00.000Z", "GHLCLOSER", "confirmed"]);
    // A call ahead whose end or rep is not known is neither moved nor booked beside.
    expect(count({ upcoming: { id: "UP1", start: up.start, kind: "intro" } })).toMatchObject({ action: "none", reason: "upcoming_unknown", claim: false });
    expect(p.body).toMatchObject({ startTime: "2026-10-04T08:04:00.000Z", endTime: "2026-10-04T08:19:00.000Z", toNotify: false, assignedUserId: "GHLSETTER", meetingLocationType: "custom" });
    expect(count({ upcoming: { ...up, kind: "demo" } }).action).toBe("create");
  });

  test("test contacts book only on the test calendar, whatever their tags, and never move", () => {
    const test = count({ room: joinedRoom({ contact_id: "VjPfR4Cc1Y0OFvaqeor5" }), contact: { tags: ["cockpit-test", "unqualified"] }, upcoming: { id: "UP", start: JOIN + 86_400_000, kind: "intro" } });
    expect(test.action === "create" && [test.calendar_id, test.test]).toEqual(["TESTCAL", true]);
    const noCal = count({ setting: { ...COUNT_ON, test_calendar_id: null }, contact: { tags: ["cockpit-test", "roas-qualified"] } });
    expect(noCal).toEqual({ action: "none", claim: true, count_result: "not_a_lead", reason: "test_calendar_missing" });
    expect(isTestContact("x", ["Cockpit-Test"], COUNT_ON)).toBe(true);
    expect(isTestContact("VjPfR4Cc1Y0OFvaqeor5", [], COUNT_ON)).toBe(true);
    expect(isTestContact("x", ["roas-qualified"], COUNT_ON)).toBe(false);
  });

  test("lead tags and the title", () => {
    expect(isTaggedLead(["ROAS-Qualified"])).toBe(true);
    expect(isTaggedLead(["roas-unprepared"])).toBe(false);
    expect(liveTitle(null, "Sara Al Ali")).toBe("Live · Sara");
    expect(liveTitle("", "")).toBe("Live · lead");
  });

  test("the undo deletes what it made, moves back what it moved, takes back a mark, never marks invalid", () => {
    expect(countUndo(joinedRoom())).toEqual({ action: "none", reason: "nothing" });
    const claimed = { count_claimed_at: at(JOIN) };
    expect(countUndo(joinedRoom({ ...claimed, count_result: "booked", count_appointment_id: "NEW1" }))).toEqual({ action: "delete", appointment_id: "NEW1" });
    expect(countUndo(joinedRoom({ ...claimed, count_result: "moved", count_appointment_id: "UP1" }), "2026-10-08T07:00:00Z")).toEqual({
      action: "move_back",
      appointment_id: "UP1",
      start: "2026-10-08T07:00:00.000Z",
      end: null,
      assigned_user_id: null,
      status: "confirmed",
    });
    expect(
      countUndo(joinedRoom({ ...claimed, count_result: "moved", count_appointment_id: "UP1" }), {
        from_start: "2026-10-08T07:00:00Z",
        from_end: "2026-10-08T07:30:00Z",
        from_assigned_user_id: "GHLCLOSER",
        from_status: "new",
      }),
    ).toEqual({ action: "move_back", appointment_id: "UP1", start: "2026-10-08T07:00:00.000Z", end: "2026-10-08T07:30:00.000Z", assigned_user_id: "GHLCLOSER", status: "new" });
    expect(countUndo(joinedRoom({ ...claimed, count_result: "moved", count_appointment_id: "UP1" }))).toEqual({ action: "none", reason: "moved_from_unknown" });
    // No record of the status before the count's mark: nothing is guessed (confirmed on a past intro is a show).
    expect(countUndo(joinedRoom({ ...claimed, appointment_id: "A1", count_appointment_id: "A1" }))).toEqual({ action: "none", reason: "unmark_unknown" });
    expect(countUndo(joinedRoom({ ...claimed, appointment_id: "A1", count_appointment_id: "A1" }), { prior_status: "confirmed" })).toEqual({
      action: "unmark",
      appointment_id: "A1",
      status: "confirmed",
      own_disposition_id: null,
      prior_disposition_id: null,
    });
    expect(
      countUndo(joinedRoom({ ...claimed, appointment_id: "A1", count_appointment_id: "A1" }), { prior_status: "noshow", prior_disposition_id: "7", own_disposition_id: "9" }),
    ).toMatchObject({ action: "unmark", status: "noshow", prior_disposition_id: "7", own_disposition_id: "9" });
    expect(countUndo(joinedRoom({ ...claimed }))).toEqual({ action: "none", reason: "in_flight" });
    expect(countUndo(joinedRoom({ ...claimed, count_result: "not_a_lead" }))).toEqual({ action: "none", reason: "nothing" });
    for (const r of ["booked", "moved", null] as const)
      expect(JSON.stringify(countUndo(joinedRoom({ ...claimed, count_result: r, count_appointment_id: "X", appointment_id: "X" }), at(JOIN)))).not.toContain("invalid");
  });
});

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

describe("presence: the first state that applies wins", () => {
  const base = { email: CLOSER, now: T0, availability: { state: "available", until: at(T0 + HOURS(2)) }, rooms: [] as RoomRow[], open_attempt: false, appointment_now: false, default_provider: "zoom" as const };
  const sb = (state: RoomState) => ({ ...opened({ purpose: "standby", contact_id: null, provider: "zoom", host_email: CLOSER }, ZOOM_URL), state });

  test("available, then ready in a standby room, then on a call", () => {
    expect(presenceOf(base)).toMatchObject({ state: "available", until: at(T0 + HOURS(2)) });
    expect(presenceOf({ ...base, rooms: [sb("host_in")] })).toMatchObject({ state: "ready", until: at(T0 + HOURS(2)), room_id: ROOM_ID });
    expect(presenceOf({ ...base, rooms: [sb("host_in")], open_attempt: true })).toMatchObject({ state: "on_call", why: "dialing" });
    const live = { ...opened({ host_email: CLOSER, id: "L1" }), state: "lead_in" as RoomState };
    expect(presenceOf({ ...base, rooms: [sb("host_in"), live] })).toMatchObject({ state: "on_call", room_id: "L1", why: "lead_in" });
    expect(presenceOf({ ...base, appointment_now: true })).toMatchObject({ state: "on_call", why: "appointment" });
  });

  test("a room waiting for its own lead is on a call; a booked room is not", () => {
    expect(presenceOf({ ...base, rooms: [opened({ host_email: CLOSER })] })).toMatchObject({ state: "on_call", why: "room_waiting" });
    expect(presenceOf({ ...base, rooms: [{ ...opened({ host_email: CLOSER }), purpose: "booked" }] })).toMatchObject({ state: "available" });
  });

  test("a live Zoom meeting counts unless it is their own open room", () => {
    expect(presenceOf({ ...base, zoom_live_until: at(T0 + MIN) })).toMatchObject({ state: "on_call", why: "zoom" });
    expect(presenceOf({ ...base, zoom_live_until: at(T0 + MIN), rooms: [sb("host_in")] })).toMatchObject({ state: "ready" });
    expect(presenceOf({ ...base, zoom_live_until: at(T0 - MIN) })).toMatchObject({ state: "available" });
  });

  test("Available that ran out, or none, is away; other reps' and final rooms do not count", () => {
    expect(presenceOf({ ...base, availability: { state: "available", until: at(T0 - 1) } })).toMatchObject({ state: "away", until: null });
    expect(presenceOf({ ...base, availability: null })).toMatchObject({ state: "away" });
    expect(presenceOf({ ...base, availability: null, rooms: [{ ...opened({ host_email: SETTER }), state: "lead_in" }] })).toMatchObject({ state: "away" });
    expect(presenceOf({ ...base, availability: null, rooms: [{ ...opened({ host_email: CLOSER }), state: "ended" }] })).toMatchObject({ state: "away" });
  });

  test("the default provider: the setter's Meet, the closer's Zoom, the other when one cannot be used", () => {
    const on = { providers: { zoom: true, meet: true }, default_provider: { setter: "meet" as const, closer: "zoom" as const } };
    expect(defaultProvider("setter", { zoom_status: "licensed", google_ok: true }, on)).toBe("meet");
    expect(defaultProvider("closer", { zoom_status: "licensed", google_ok: true }, on)).toBe("zoom");
    expect(defaultProvider("closer", { zoom_status: "pending", google_ok: true }, on)).toBe("meet");
    expect(defaultProvider("setter", { zoom_status: "pending", google_ok: false }, on)).toBe("meet");
    expect(defaultProvider("setter", { zoom_status: "basic", google_ok: false }, on)).toBe("zoom");
    expect(defaultProvider("setter", { zoom_status: "licensed", google_ok: true, default_provider: "zoom" }, on)).toBe("zoom");
  });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe("the health line", () => {
  const now = Date.parse("2026-10-04T11:04:10Z");
  test("working, in the spec's words", () => {
    const h = roomsHealth({ now, last_run_at: "2026-10-04T11:03:58Z", rooms_today: 6, failed_today: 0 });
    expect(h).toEqual({ worker_ok: true, last_run_at: "2026-10-04T11:03:58.000Z", rooms_today: 6, failed_today: 0, line: "Rooms: working. Last run 14:03:58. 6 rooms today, 0 failed." });
    expect(roomsHealth({ now, last_run_at: "2026-10-04T11:03:58Z", rooms_today: 1, failed_today: 1 }).line).toBe("Rooms: working. Last run 14:03:58. 1 room today, 1 failed.");
  });

  test("red at 90 s, with the time it last ran; never ran is said, not zero", () => {
    expect(roomsHealth({ now, last_run_at: at(now - 90 * S), rooms_today: 0, failed_today: 0 }).worker_ok).toBe(true);
    const down = roomsHealth({ now, last_run_at: "2026-10-04T10:52:00Z", rooms_today: 6, failed_today: 0 });
    expect(down.worker_ok).toBe(false);
    expect(down.line).toBe("Video rooms are not being made (last check 13:52). Call the lead on the phone, or send your own Zoom or Meet link.");
    expect(roomsHealth({ now, last_run_at: "2026-10-02T10:52:00Z", rooms_today: 0, failed_today: 0 }).line).toBe("Video rooms are not being made (last check 13:52 on Fri 2 Oct). Call the lead on the phone, or send your own Zoom or Meet link.");
    expect(roomsHealth({ now, last_run_at: null, rooms_today: 0, failed_today: 0 }).line).toBe(LANE_COPY.health_never);
    expect(roomsHealth({ now, last_run_at: at(now + 10 * MIN), rooms_today: 0, failed_today: 0 }).worker_ok).toBe(false);
  });

  test("a mismatch with Zoom, and counts that could not be read", () => {
    expect(roomsHealth({ now, last_run_at: at(now - S), rooms_today: 6, failed_today: 0, mismatched_today: 1 }).line).toBe("Zoom and the cockpit disagree on 1 room today. Open its timeline.");
    expect(roomsHealth({ now, last_run_at: at(now - S), rooms_today: 6, failed_today: 0, mismatched_today: 2 }).line).toBe("Zoom and the cockpit disagree on 2 rooms today. Open their timelines.");
    expect(roomsHealth({ now, last_run_at: "2026-10-04T11:04:00Z", rooms_today: null, failed_today: 0 }).line).toBe("Rooms: working. Last run 14:04:00.");
  });

  test("the watchdog's Slack line", () => {
    expect(watchdogLine("2026-10-04T10:52:00Z", now)).toBe("The room worker has not run since 13:52. New video rooms cannot be made.");
    expect(watchdogLine(null, now)).toBe(LANE_COPY.watchdog_never);
  });

  test("times are Kuwait's", () => {
    expect(kuwaitClock(Date.parse("2026-10-04T11:02:00Z"))).toBe("14:02");
    expect(clockWithDay(Date.parse("2026-10-03T21:30:00Z"), Date.parse("2026-10-04T00:10:00Z"))).toBe("00:30");
    expect(countdown(552_400)).toBe("9:12");
    expect(countdown(-5)).toBe("0:00");
    expect(countdown(Number.NaN)).toBe("0:00");
  });
});

// ---------------------------------------------------------------------------
// RoomView
// ---------------------------------------------------------------------------

describe("the browser's view of a room", () => {
  const secretRow = {
    ...step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "link_sent" }, T0 + 10 * S),
    start_url: "https://us06web.zoom.us/s/81234567890?zak=HOSTSECRET",
    host_key: "HOSTKEY123",
    provider_meeting_id: "81234567890",
    worker_run: "run-7",
    link_message_ids: { whatsapp_text: "m1", email: "m2", junk: "m3" },
  } as RoomRow;

  test("has exactly the contract's keys and never the host link", () => {
    const v = toRoomView(secretRow, { short_link: true, contact_first_name: "Sara Al Ali" });
    expect(Object.keys(v).sort()).toEqual([...ROOM_VIEW_KEYS].sort());
    const json = JSON.stringify(v);
    for (const secret of ["HOSTSECRET", "HOSTKEY123", "start_url", "zak=", "run-7", "provider_meeting_id"]) expect(json).not.toContain(secret);
    expect(v.short_url).toBe("https://call.maharamedia.com/K7Q2MX");
    expect(v.join_url).toBe(ZOOM_URL);
    expect(v.contact_first_name).toBe("Sara");
    expect(v.link_channels).toEqual(["whatsapp_text", "email"]);
    expect(v.created_at).toBe(at(T0));
  });

  test("without the short link it shows the room's own link; bad values are dropped", () => {
    const v = toRoomView({ ...secretRow, join_url: "javascript:alert(1)", link_sent_at: "not a time", open_device: "toaster" } as RoomRow, { short_link: false, refusal: "This changed a moment ago." });
    expect(v.short_url).toBe(null);
    expect(v.join_url).toBe(null);
    expect(v.link_sent_at).toBe(null);
    expect(v.open_device).toBe(null);
    expect(v.refusal).toBe("This changed a moment ago.");
    expect(linkChannelsOf({ link_message_ids: [{ channel: "email", id: "x" }, "whatsapp_template"] })).toEqual(["email", "whatsapp_template"]);
  });
});

// ---------------------------------------------------------------------------
// Creating and wrapping
// ---------------------------------------------------------------------------

describe("room.create's checks", () => {
  const ON = roomsSetting({ ...DEFAULT_ROOMS_JSON, enabled: true, test_only: false, providers: { zoom: true, meet: true } });
  const okHost = { zoom_status: "licensed" as const, zoom_live: false, google_ok: true };
  const input = (over: Partial<Parameters<typeof createRefusal>[0]> = {}) =>
    createRefusal({ setting: ON, purpose: "fallback", provider: "meet", call_kind: "intro", contact_id: "c1", contact: LEAD, host: okHost, host_email: SETTER, lead_room_open: false, host_room_open: false, booked_demo: false, booked_intro: true, ...over });
  const code = (r: ReturnType<typeof createRefusal>) => r?.code ?? null;

  test("a good request passes", () => {
    expect(input()).toBe(null);
    expect(input({ purpose: "standby", contact_id: null, contact: null, provider: "zoom", call_kind: "demo" })).toBe(null);
  });

  test("each refusal, in the spec's words", () => {
    expect(input({ setting: DEFAULT_ROOMS_SETTING })?.message).toBe(LANE_COPY.disabled);
    expect(input({ setting: { ...ON, providers: { zoom: true, meet: false } } })?.message).toBe("Meet rooms are off for now. Use Zoom.");
    expect(input({ setting: { ...ON, test_only: true } })?.code).toBe("test_only");
    // While testing, only the listed contacts get a room; a HighLevel tag anyone can add is not enough (final review).
    expect(input({ setting: { ...ON, test_only: true }, contact: { ...LEAD, tags: ["cockpit-test"] } })?.code).toBe("test_only");
    expect(input({ setting: { ...ON, test_only: true, test_contacts: ["c1"] }, contact: LEAD })).toBe(null);
    expect(input({ contact: { ...LEAD, tags: ["client"] } })?.message).toBe("This contact is an active client. Client success looks after them.");
    expect(input({ contact: { ...LEAD, dnd: true } })?.message).toBe("Do not disturb is on in HighLevel. No link can go.");
    expect(input({ booked_demo: true })?.message).toBe("This lead has a booked demo. Its Zoom link comes from HighLevel, so no new room is made.");
    expect(input({ lead_room_open: true })?.message).toBe("A video room is already open for this lead. Use that one.");
    expect(input({ lead_room_open: true, purpose: "manual" })?.message).toBe("This lead already has a room open. Open it.");
    expect(input({ host_room_open: true })?.message).toBe("You already have a room open. End it first.");
    expect(input({ host: { ...okHost, google_ok: false } })?.message).toBe("Meet rooms are down until the CEO reconnects Google on the room worker. Use Zoom, or call the lead.");
    expect(input({ provider: "zoom", host: { ...okHost, zoom_status: "pending" } })?.message).toBe("Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.");
    expect(input({ provider: "zoom", host: { ...okHost, zoom_status: "missing" } })?.code).toBe("zoom_missing");
    expect(input({ provider: "zoom", call_kind: "demo", host: { ...okHost, zoom_status: "basic" } })?.message).toBe("The closer's Zoom is Basic and ends at 40 minutes. Use Meet for this demo.");
    expect(input({ provider: "zoom", call_kind: "intro", host: { ...okHost, zoom_status: "basic" } })).toBe(null);
    expect(input({ provider: "zoom", host: { ...okHost, zoom_live: true } })?.message).toBe("Your Zoom is in another meeting. End it or use Meet.");
  });

  test("a refusal says its cause and never points at a control nobody has (final review)", () => {
    // Not checked yet: no host row before the first 10-minute check, or no Google value written yet.
    expect(input({ host: null })?.code).toBe("meet_unchecked");
    expect(input({ host: null })?.message).toBe("Meet is not checked for your seat yet. Try again in 10 minutes, or call the lead.");
    expect(input({ host: { ...okHost, google_ok: false, google_checked: false } })?.message).toBe(
      "Meet is not checked for your seat yet. Try again in 10 minutes, or use Zoom.",
    );
    // The worker's one Google sign-in is down: Zoom when it works, else the phone.
    expect(input({ host: { ...okHost, google_ok: false, zoom_status: "missing" } })?.message).toBe(
      "Meet rooms are down until the CEO reconnects Google on the room worker. Call the lead for now.",
    );
    expect(input({ call_kind: "demo", host: { ...okHost, google_ok: false, zoom_status: "basic" } })?.message).toBe(
      "Meet rooms are down until the CEO reconnects Google on the room worker. Call the lead for now.",
    );
    // Zoom not checked yet is not "missing".
    expect(input({ provider: "zoom", host: { ...okHost, zoom_status: null } })?.code).toBe("zoom_unchecked");
    expect(input({ provider: "zoom", host: { ...okHost, zoom_status: null } })?.message).toBe("Zoom is not checked for your seat yet. Try again in 10 minutes, or use Meet.");
    expect(input({ provider: "zoom", host: null })?.message).toBe("Zoom is not checked for your seat yet. Try again in 10 minutes, or call the lead.");
    expect(input({ provider: "zoom", host: { ...okHost, zoom_status: "missing" } })?.message).toBe(
      "Your email has no Zoom user on Mahara's account. Ask the CEO to add you in Zoom. Meet works now.",
    );
    for (const host of [null, { ...okHost, google_ok: false }, { ...okHost, google_ok: false, google_checked: false }, { ...okHost, zoom_status: null }, { ...okHost, zoom_status: "missing" as const }])
      for (const provider of ["zoom", "meet"] as const) expect(String(input({ provider, host })?.message ?? "")).not.toContain("Team page");
  });

  test("bad shapes: no lead, a standby with a lead, a booked room, unknown names", () => {
    expect(code(input({ contact_id: null }))).toBe("no_contact");
    expect(code(input({ purpose: "standby" }))).toBe("bad_input");
    expect(code(input({ purpose: "booked" }))).toBe("bad_input");
    expect(code(input({ provider: "teams" }))).toBe("bad_input");
    expect(code(input({ call_kind: "lunch" }))).toBe("bad_input");
  });

  test("client and do-not-disturb come before the host's provider", () => {
    expect(code(input({ contact: { ...LEAD, tags: ["client"] }, host: null }))).toBe("client");
    expect(code(input({ contact: { ...LEAD, dnd: true }, lead_room_open: true }))).toBe("dnd");
  });
});

describe("room.wrap: a booked call keeps its own meeting", () => {
  test("reads the Zoom or Meet link from the address", () => {
    expect(meetingFromAddress(`Join: ${ZOOM_URL}.`)).toEqual({ provider: "zoom", join_url: ZOOM_URL, meeting_id: "81234567890" });
    expect(meetingFromAddress(MEET_URL)).toEqual({ provider: "meet", join_url: MEET_URL, meeting_id: null });
    expect(meetingFromAddress("+965 5000 1234")).toBe(null);
    expect(meetingFromAddress(null)).toBe(null);
  });

  test("a phone call has no link, a finished call none either; a good one is open at once", () => {
    const phone = wrapPlan({ setting: WRAP_ON, contact_id: "c1", start: at(T0), address: "+96550001234", call_kind: "intro", now: T0, ctx });
    expect(!phone.ok && phone.message).toBe("This call is on the phone. There is no link to send.");
    const over = wrapPlan({ setting: WRAP_ON, contact_id: "c1", start: at(T0 - 2 * 3_600_000), end: at(T0 - 3_600_000), address: ZOOM_URL, call_kind: "demo", now: T0, ctx });
    expect(!over.ok && over.code).toBe("call_over");
    expect(wrapPlan({ setting: WRAP_ON, contact_id: "c1", start: "never", address: ZOOM_URL, call_kind: "demo", now: T0, ctx }).ok).toBe(false);
    const p = wrapPlan({ setting: WRAP_ON, contact_id: "c1", start: at(T0 + 15 * MIN), end: at(T0 + 60 * MIN), address: ZOOM_URL, call_kind: "demo", now: T0, ctx });
    if (!p.ok) throw new Error(p.message);
    const row = wrapRoomRow({ id: ROOM_ID, request_id: REQ_ID, code: "K7Q2MX", contact_id: "c1", call_kind: "demo", host_email: CLOSER, made_by: CLOSER, now: T0 }, p);
    expect(row).toMatchObject({ purpose: "booked", state: "open", provider: "zoom", join_url: ZOOM_URL, provider_meeting_id: "81234567890", version: 1 });
  });
});

// ---------------------------------------------------------------------------
// The sentences
// ---------------------------------------------------------------------------

describe("the sentences", () => {
  const all = [...Object.values(ROOM_COPY).flatMap(g => Object.values(g as Record<string, string>)), ...Object.values(LANE_COPY)];

  test("none is empty, none has an em dash, every lead message says Mahara Media", () => {
    for (const s of all) {
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toContain("—");
    }
    for (const [k, s] of Object.entries(ROOM_COPY.lead_en))
      if (/Mahara/.test(s)) expect([k, /Mahara(?! Media)/.test(s)]).toEqual([k, false]);
  });

  test("the spec's key sentences, word for word", () => {
    expect(ROOM_COPY.refusals.lead_has_room).toBe("This lead already has a room open. Open it.");
    expect(ROOM_COPY.refusals.taken).toBe("Someone else took this lead.");
    expect(ROOM_COPY.refusals.live_call_open).toBe("You already have a live call.");
    expect(ROOM_COPY.panel.no_join).toBe("The lead did not join in {minutes} minutes. Room closed. Call again or send a message.");
    expect(ROOM_COPY.lead_en.call_link_template).toBe("Hi {{1}}, your call with {{2}} from Mahara Media is ready now. Tap the button below to join.");
    expect(ROOM_COPY.slack.unlinked).toBe("Your Slack is not linked to a sales seat. Ask the manager to add your Slack ID on the Team page.");
  });

  test("fill puts values in and leaves template slots and unknowns alone", () => {
    expect(fill(ROOM_COPY.strip.available, { until: "16:30" })).toBe("Available until 16:30. Join your room to get leads first.");
    expect(fill(ROOM_COPY.lead_en.call_link_template, { name: "x" })).toBe(ROOM_COPY.lead_en.call_link_template);
    expect(fill("Hi {first_name}", {})).toBe("Hi {first_name}");
    expect(fill("{n} rooms", { n: 0 })).toBe("0 rooms");
  });
});

describe("the panel's line", () => {
  const view = (r: RoomRow, short = true) => toRoomView(r, { short_link: short, contact_first_name: "Sara" });
  const P = { now: T0 + 2 * MIN };

  test("making, ready, sent, opened, host in, joined, in the spec's words", () => {
    expect(panelLine(view(room({ purpose: "manual" })), P).text).toBe("Making your Meet room...");
    const m = opened({ purpose: "manual" });
    expect(panelLine(view(m), P).text).toBe("Room ready.");
    const sent = step(m, { kind: "link_sent" }, Date.parse("2026-10-04T11:02:00Z"));
    expect(panelLine(view(sent), { ...P, channel: "whatsapp_text" }).text).toBe("Link sent on WhatsApp at 14:02.");
    const op = step(sent, { kind: "opened", device: "phone" }, Date.parse("2026-10-04T11:03:00Z"));
    expect(panelLine(view(op), P).text).toBe("The lead opened the link at 14:03 on a phone.");
    const inRoom = step(op, { kind: "host_in", source: "zoom" }, Date.parse("2026-10-04T11:03:30Z"));
    const left = Date.parse(inRoom.lead_by as string) - 552_000;
    expect(panelLine(view(inRoom), { now: left }).text).toBe("You are in. Waiting for the lead (9:12 left).");
    const joined = { ...step(inRoom, { kind: "lead_in", source: "zoom" }, Date.parse("2026-10-04T11:04:00Z")), count_result: "booked" as const };
    expect(panelLine(view(joined), P).text).toBe("The lead joined at 14:04. Booked and marked shown in HighLevel.");
    expect(panelLine(view({ ...joined, count_result: "not_a_lead" }), P).text).toBe("The lead joined at 14:04. Not counted: this contact is not a tagged lead.");
    expect(panelLine(view(joined), { now: Date.parse(joined.ends_at as string) }).prompt).toBe("Still on the call?");
  });

  test("a fallback room uses P1's words with the lead's name", () => {
    const f = step(opened({ provider: "zoom" }, ZOOM_URL), { kind: "link_sent" }, Date.parse("2026-10-04T11:03:00Z"));
    const lb = Date.parse(f.lead_by as string);
    expect(panelLine(view(f), { now: lb - 599_000, channel: "email" }).text).toBe("Link sent on email at 14:03. Waiting for Sara (9:59 left).");
    expect(panelLine(view({ ...f, lead_waiting_at: at(T0) }), P).text).toBe("Sara is in the waiting room. Admit them in Zoom.");
    const notSent = panelLine(view({ ...opened(), link_sent_at: null }), { ...P, not_sent_reason: "the lead has no email address" });
    expect(notSent.text).toBe("Not sent: the lead has no email address. Read it out: call.maharamedia.com/K7Q2MX");
    expect(panelLine(view(f), { ...P, not_confirmed: true })).toEqual({
      moment: "not_confirmed",
      text: "HighLevel did not confirm the WhatsApp template. The link went by email.",
      prompt: null,
    });
    const expired = ok(sweepRoom(f, lb, ctx)).room;
    expect(panelLine(view(expired), { ...P, booked_intro: true }).text).toBe("Nobody joined in 10 minutes. The room is closed. Mark the intro:");
    expect(panelLine(view(expired), P).text).toBe("The lead did not join in 10 minutes. Room closed. Call again or send a message.");
    expect(panelLine(view({ ...f, state: "lead_in", lead_in_at: at(T0), count_result: "booked" }), P).text).toBe("Sara joined. Booked as a live intro and marked shown.");
    expect(panelLine(view({ ...f, state: "lead_in", lead_in_at: "2026-10-04T11:06:00Z" }), { ...P, count: "marked" }).text).toBe("Sara joined at 14:06. The intro is marked shown.");
  });

  test("failures say what to do next", () => {
    const failed = (error: string | null, over: Partial<RoomRow> = {}) => view({ ...room(over), state: "failed", error });
    expect(panelLine(failed("Zoom refused the meeting.", { provider: "zoom" }), P).text).toBe("Zoom did not make the room: Zoom refused the meeting. Try Meet, or call again.");
    expect(panelLine(failed(LANE_COPY.worker_late), P).text).toBe("Meet did not make the room: the room worker did not pick this room up in time. Try Zoom, or call again.");
    expect(panelLine(failed(ROOM_COPY.refusals.meet_pending), P).text).toBe("Google did not make the Meet link. Try Zoom.");
    expect(panelLine(failed(null, { purpose: "handover", provider: "zoom" }), P).text).toBe("Zoom did not open your room: the room could not be made. Use Meet.");
  });
});

// ---------------------------------------------------------------------------
// Stress: concurrency, retries, duplicate and late events, crashes
// ---------------------------------------------------------------------------

/** One row behind a compare-and-set write, the way a conditional PATCH behaves. */
class Store {
  constructor(public row: RoomRow) {}
  write(c: Changed): boolean {
    const cur = this.row as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(c.expect)) if ((cur[k] ?? null) !== (v ?? null)) return false;
    this.row = { ...this.row, ...c.patch };
    return true;
  }
  /** Read, apply, write; on a lost write read again, as the server does. */
  run(e: RoomEvent, t: number, from?: RoomRow): Applied {
    let snap = from ?? this.row;
    for (let i = 0; i < 20; i++) {
      const a = applyRoomEvent(snap, e, t, ctx);
      if (!a.ok || !a.changed) return a;
      if (this.write(a)) return a;
      snap = this.row;
    }
    throw new Error("no progress");
  }
}

describe("stress", () => {
  test("fifty workers claim one room at once: exactly one wins", () => {
    const store = new Store(room());
    const snap = store.row;
    const outcomes = Array.from({ length: 50 }, () => store.run({ kind: "claim" }, T0, snap));
    expect(outcomes.filter(a => a.ok && a.changed).length).toBe(1);
    expect(outcomes.filter(a => !a.ok && a.code === "not_requested").length).toBe(49);
    expect(store.row.state).toBe("creating");
    expect(store.row.version).toBe(2);
  });

  test("two presses on the same version: the first lands, the second is stale", () => {
    const store = new Store(opened());
    const snap = store.row;
    const a = store.run({ kind: "end", reason: "cancel", actor: { email: SETTER }, version: snap.version }, T0 + MIN, snap);
    const b = store.run({ kind: "host_in", source: "mark", actor: { email: SETTER }, version: snap.version }, T0 + MIN, snap);
    expect(a.ok && a.to).toBe("cancelled");
    expect(!b.ok && b.code).toBe("stale");
    expect(store.row.state).toBe("cancelled");
  });

  test("a lead's open and a mark at the same moment both land, and lead_by keeps the later time", () => {
    const store = new Store(step(opened(), { kind: "link_sent" }, T0 + 10 * S));
    const snap = store.row;
    const leadBy = Date.parse(snap.lead_by as string);
    const t = leadBy - 30 * S;
    const open = store.run({ kind: "opened", device: "phone" }, t, snap);
    const mark = store.run({ kind: "host_in", source: "mark", actor: { email: SETTER }, version: snap.version }, t, snap);
    expect(open.ok && mark.ok).toBe(true);
    expect(store.row.state).toBe("host_in");
    expect(store.row.lead_by).toBe(at(t + 180 * S));
  });

  test("two writers raising lead_by from one snapshot: the loser re-reads, and the later deadline wins", () => {
    const store = new Store(opened());
    const snap = store.row;
    const leadBy = Date.parse(snap.lead_by as string);
    store.run({ kind: "opened" }, leadBy - 10 * S, snap); // lead_by → leadBy + 170 s
    store.run({ kind: "link_sent" }, T0 + 6 * S, snap); // would set link + 600 s, earlier than that
    expect(store.row.lead_by).toBe(at(leadBy - 10 * S + 180 * S));
    expect(store.row.link_sent_at).toBe(at(T0 + 6 * S));
  });

  test("the same request applied again changes nothing and asks for nothing twice", () => {
    const store = new Store(room());
    store.run({ kind: "claim" }, T0);
    expect(!store.run({ kind: "claim" }, T0).ok).toBe(true);
    const first = store.run({ kind: "ready", join_url: MEET_URL }, T0 + S);
    expect(first.ok && kinds(first as Changed)).toEqual(["send_link"]);
    const again = store.run({ kind: "ready", join_url: MEET_URL }, T0 + 2 * S);
    expect(again.ok && (again as Changed).changed).toBe(false);
    store.run({ kind: "link_sent" }, T0 + 3 * S);
    expect((store.run({ kind: "link_sent" }, T0 + 4 * S) as Changed).changed).toBe(false);
  });

  test("Zoom retries and a second join count the lead once; late events after the end are dropped", () => {
    const store = new Store(opened({ provider: "zoom", purpose: "handover", host_email: CLOSER, call_kind: "demo", send_on: "host_in" }, ZOOM_URL));
    const seen = new Set<string>();
    const deliver = (evt: ReturnType<typeof zoomEvt>, t: number) => {
      const key = zoomDedupeKey(evt);
      if (seen.has(key)) return null;
      seen.add(key);
      const eff = zoomEffect(evt, ZCTX);
      return "room_event" in eff ? store.run(eff.room_event, t) : null;
    };
    const counted: string[] = [];
    const note = (a: Applied | null) => {
      if (a?.ok) for (const e of a.effects) counted.push(e.kind);
    };
    note(deliver(zoomEvt("meeting.participant_joined", HOST_P), T0 + 20 * S));
    for (let i = 0; i < 5; i++) note(deliver(zoomEvt("meeting.participant_joined", GUEST_P), T0 + 60 * S + i * S));
    note(deliver(zoomEvt("meeting.participant_joined", { ...GUEST_P, join_time: "2026-10-04T08:09:00Z" }), T0 + 9 * MIN));
    expect(counted.filter(k => k === "count_live").length).toBe(1);
    expect(counted.filter(k => k === "send_link").length).toBe(1);
    note(deliver(zoomEvt("meeting.ended"), T0 + 50 * MIN));
    expect(store.row.state).toBe("ended");
    const late = store.run({ kind: "lead_in", source: "zoom" }, T0 + 51 * MIN);
    expect(!late.ok && [late.code, late.retry]).toEqual(["final", false]);
    expect(store.row.state).toBe("ended");
  });

  test("an event that arrives before the room is open is kept and applies on the replay", () => {
    const store = new Store(step(room({ provider: "zoom" }), { kind: "claim" }, T0));
    const early = store.run({ kind: "lead_waiting" }, T0 + 2 * S);
    expect(!early.ok && early.retry).toBe(true);
    store.run({ kind: "ready", join_url: ZOOM_URL }, T0 + 4 * S);
    const replay = store.run({ kind: "lead_waiting" }, T0 + 22 * S);
    expect(replay.ok && store.row.lead_waiting_at).toBe(at(T0 + 22 * S));
  });

  test("a worker that dies half way: recovered, then failed, and a late link is refused with clean-up", () => {
    const store = new Store(room({ provider: "zoom" }));
    store.run({ kind: "claim" }, T0);
    const rec = store.run({ kind: "tick" }, T0 + 61 * S);
    expect(rec.ok && rec.effects).toEqual([{ kind: "recover" }]);
    store.run({ kind: "tick" }, T0 + 121 * S);
    expect(store.row.state).toBe("failed");
    const late = store.run({ kind: "ready", join_url: ZOOM_URL }, T0 + 130 * S);
    expect(!late.ok && [late.code, late.cleanup]).toEqual(["final", true]);
    expect(store.row.state).toBe("failed");
  });

  test("a sweep that runs twice, or late, closes a room once", () => {
    const store = new Store(step(opened(), { kind: "link_sent" }, T0));
    const t = Date.parse(store.row.lead_by as string);
    const a = store.run({ kind: "tick" }, t);
    const b = store.run({ kind: "tick" }, t + 5 * MIN);
    expect(a.ok && (a as Changed).to).toBe("expired");
    expect(b.ok && (b as Changed).changed).toBe(false);
    expect(store.row.version).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 10,000 random runs
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

describe("10,000 random event sequences", () => {
  test("no final state reopens, no timer ends a lead_in room early or under a pending event, deadlines only move later, the link and the count are asked for once", () => {
    const RUNS = 10_000;
    const purposes = ["fallback", "handover", "standby", "booked", "manual"] as const;
    const seenStates = new Map<string, number>();
    const seenMoves = new Set<string>();
    const reasons = new Map<string, number>();
    let events = 0;
    let leadInTicks = 0;
    let heldTicks = 0;
    let finalUndos = 0;
    let linkReasks = 0;
    let countReasks = 0;
    const countOn = roomCtx({ ...DEFAULT_ROOMS_SETTING, count_on_join: true });

    for (let run = 1; run <= RUNS; run++) {
      const rnd = mulberry32(run);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)] as T;
      const cx = run % 2 ? countOn : ctx;
      const purpose = pick(purposes);
      const provider = rnd() < 0.5 ? "zoom" : "meet";
      const call_kind = rnd() < 0.5 ? "intro" : "demo";
      const host = rnd() < 0.5 ? SETTER : CLOSER;
      let t = T0;
      let r: RoomRow;
      if (purpose === "booked") {
        const p = wrapPlan({ setting: WRAP_ON, contact_id: "c1", start: at(T0 + Math.floor(rnd() * 40 - 10) * MIN), address: provider === "zoom" ? ZOOM_URL : MEET_URL, call_kind, now: T0, ctx: cx });
        if (!p.ok) continue;
        r = wrapRoomRow({ id: ROOM_ID, request_id: REQ_ID, code: "K7Q2MX", contact_id: "c1", call_kind, host_email: host, made_by: host, now: T0 }, p);
      } else {
        r = room({ purpose, provider, call_kind, host_email: host, contact_id: purpose === "standby" ? null : "c1", send_on: purpose === "handover" ? "host_in" : "open" });
      }
      (r as unknown as Record<string, unknown>).start_url = "https://zoom.us/s/1?zak=RANDOMSECRET";
      let firstSends = 0;

      const length = 1 + Math.floor(rnd() * 40);
      for (let i = 0; i < length; i++) {
        const u = rnd();
        t += u < 0.5 ? Math.floor(rnd() * 20 * S) : u < 0.8 ? Math.floor(rnd() * 200 * S) : u < 0.95 ? Math.floor(rnd() * 1000 * S) : Math.floor(rnd() * 4000 * S);
        const actor = rnd() < 0.9 ? { email: host } : rnd() < 0.5 ? { email: "ceo@maharamedia.com", manager: true } : { email: "other@maharamedia.com" };
        const version = rnd() < 0.85 ? r.version : r.version - 1;
        // Zoom's own time: usually a little before it is handled (a replay), sometimes ahead of our clock, sometimes none.
        const when = rnd() < 0.5 ? { at: at(t - Math.floor(rnd() * 40 * S) + (rnd() < 0.1 ? 30 * S : 0)) } : {};
        const roll = rnd();
        const e: RoomEvent =
          roll < 0.08 ? { kind: "claim" }
          : roll < 0.16 ? { kind: "ready", join_url: rnd() < 0.9 ? (provider === "zoom" ? ZOOM_URL : MEET_URL) : "nope" }
          : roll < 0.18 ? { kind: "fail", error: "Zoom refused the meeting." }
          : roll < 0.24 ? { kind: "link_sent", ...when }
          : roll < 0.29 ? { kind: "opened", device: "phone", ...when }
          : roll < 0.33 ? { kind: "lead_waiting", ...when }
          : roll < 0.41 ? { kind: "host_in", source: rnd() < 0.5 ? "zoom" : "mark", ...when, ...(rnd() < 0.5 ? { actor, version } : {}) }
          : roll < 0.45 ? { kind: "host_left", ...when }
          : roll < 0.53 ? { kind: "lead_in", source: rnd() < 0.5 ? "zoom" : "mark", ...when, ...(rnd() < 0.5 ? { actor, version } : {}) }
          : roll < 0.58 ? { kind: "not_lead", actor, version }
          : roll < 0.64 ? { kind: "end", reason: pick(["end", "on_phone", "finished", "cancel", "admit_blocked"] as const), actor, version, confirm: rnd() < 0.5 }
          : roll < 0.67 ? { kind: "meeting_ended", ...when }
          : roll < 0.68 ? { kind: "meeting_deleted", ...when }
          : roll < 0.71 ? { kind: "adopt", contact_id: "c7", call_kind: "demo", actor }
          : {
              kind: "tick",
              next_booked_start: rnd() < 0.3 ? t + Math.floor(rnd() * 25 - 5) * MIN : null,
              ...(rnd() < 0.2 ? { pending_events: rnd() < 0.8 ? 1 + Math.floor(rnd() * 3) : null } : {}),
              ...(rnd() < 0.5 ? { available_until: rnd() < 0.7 ? at(t + Math.floor(rnd() * 120 - 20) * MIN) : null } : {}),
            };

        const before = r;
        const a = applyRoomEvent(before, e, t, cx);
        events++;
        if (!a.ok) {
          expect(Object.keys(a)).toEqual(["ok", "code", "message", "status", "retry", "cleanup"]);
          expect(a.message.length).toBeGreaterThan(0);
          continue;
        }
        const after = a.room;
        seenStates.set(after.state, (seenStates.get(after.state) ?? 0) + 1);
        const firsts = a.effects.filter(x => x.kind === "send_link" && !x.retry).length;
        firstSends += firsts;

        // 1. A final room never changes state; the two writes it takes are "That was not the lead", which only
        // takes the count back, and a lead join the timer's close raced, kept as evidence only (lead_in_at, result).
        if (isFinal(before.state)) {
          if (a.changed) {
            expect(["not_lead", "lead_in"]).toContain(e.kind);
            expect([after.state, after.version]).toEqual([before.state, before.version]);
            const keys = e.kind === "lead_in" ? ["lead_in_at", "lead_in_seen_at", "result"] : ["count_undo_at", "taken_back_join_at", "count_result", "result"];
            expect(Object.keys(a.patch).every(k => keys.includes(k))).toBe(true);
            if (e.kind === "not_lead") finalUndos++;
          } else expect(after).toBe(before);
          expect(a.effects.some(x => x.kind === "send_link" || x.kind === "close_provider")).toBe(false);
          r = after;
          continue;
        }
        // 2. Only allowed moves; the version goes up by exactly one on a move.
        if (after.state !== before.state) {
          expect(canMove(before.state, after.state)).toBe(true);
          seenMoves.add(`${before.state}>${after.state}`);
          expect(after.version).toBe(before.version + 1);
          // A Zoom join from before a kept meeting end ends the room at that end (stress2, round 2).
          const stamped =
            e.kind === "meeting_ended" || e.kind === "meeting_deleted"
              ? eventTime((e as { at?: unknown }).at, t)
              : e.kind === "lead_in" && before.meeting_ended_at && after.state === "ended"
                ? Date.parse(before.meeting_ended_at)
                : t;
          if (isFinal(after.state)) expect(after.ended_at).toBe(at(stamped));
        } else {
          expect(after.version === before.version || (e.kind === "adopt" && after.version === before.version + 1)).toBe(true);
        }
        // 3. Deadlines only move later and never go away; the open grace never runs past one grace after the lead's 10 minutes.
        for (const k of ["host_by", "lead_by", "ends_at"] as const) {
          const b = before[k] ? Date.parse(before[k] as string) : null;
          const n = after[k] ? Date.parse(after[k] as string) : null;
          if (b !== null) {
            expect(n).not.toBe(null);
            expect(n as number).toBeGreaterThanOrEqual(b);
          }
        }
        if ((e.kind === "opened" || e.kind === "lead_waiting") && after.lead_by !== before.lead_by && before.purpose !== "booked") {
          const base = Date.parse((before.link_sent_at ?? before.opened_at) as string);
          expect(Date.parse(after.lead_by as string)).toBeLessThanOrEqual(base + (W.lead + W.open_grace) * S);
        }
        // 4. No timer ends a room with the lead in it, before ends_at + 30 minutes, and never with a provider call.
        if (before.state === "lead_in" && e.kind === "tick") {
          leadInTicks++;
          const due = (Date.parse(before.ends_at as string) || 0) + W.no_end_signal * S;
          if (t < due) expect(after.state).toBe("lead_in");
          else expect(after.state === "lead_in" || (after.state === "ended" && a.reason === "no_end_signal")).toBe(true);
        }
        if (before.state === "lead_in" && after.state === "ended" && e.kind === "end")
          expect(e.reason === "finished" || e.confirm === true).toBe(true);
        // 5. A tick with events still waiting closes nothing until 5 minutes past the earliest timer.
        if (e.kind === "tick" && e.pending_events !== undefined && e.pending_events !== 0 && ["open", "host_in", "lead_in"].includes(before.state)) {
          const ats = timers(before, cx).map(x => x.at);
          if (e.next_booked_start != null) ats.push(e.next_booked_start - W.booked_guard * S);
          if (e.available_until !== undefined) ats.push(e.available_until ? Date.parse(e.available_until as string) : t);
          if (after.state !== before.state) expect(t).toBeGreaterThanOrEqual(Math.min(...ats) + PENDING_HOLD_MAX_S * S);
          else heldTicks++;
        }
        // 6. Never a provider call for a room a lead reached, or for someone's booked meeting.
        if (a.effects.some(x => x.kind === "close_provider")) {
          expect(before.lead_in_at ?? null).toBe(null);
          expect(before.purpose).not.toBe("booked");
        }
        // 7. The link is asked for once, by the write that claims it; a re-ask only repeats a claim that never became a send.
        if (firsts) {
          expect(firsts).toBe(1);
          expect(before.link_claimed_at ?? null).toBe(null);
          expect(after.link_claimed_at).toBe(at(t));
        }
        if (a.effects.some(x => x.kind === "send_link" && x.retry)) {
          linkReasks++;
          expect(before.link_claimed_at).not.toBe(null);
          expect(before.link_sent_at ?? null).toBe(null);
          expect(t - Date.parse(before.link_claimed_at as string)).toBeGreaterThanOrEqual(REASK_AFTER_S * S);
        }
        // 8. A count is asked for on the move into lead_in, and asked again only for a real join whose count can be claimed, with the switch on.
        for (const x of a.effects.filter(x => x.kind === "count_live")) {
          if (x.kind === "count_live" && x.retry) {
            countReasks++;
            expect(cx.count_on_join).toBe(true);
            expect(leadJoined(before)).toBe(true);
            expect(countClaimable(before)).toBe(true);
          } else
            expect(
              (before.state !== "lead_in" && after.state === "lead_in") ||
                // A Zoom join from before a kept meeting end: ended joined, and counted (stress2, round 2).
                (e.kind === "lead_in" && Boolean(before.meeting_ended_at) && after.state === "ended" && after.result === "joined"),
            ).toBe(true);
        }
        if (a.reason) reasons.set(a.reason, (reasons.get(a.reason) ?? 0) + 1);
        // 9. Everything not final has a timer that will fire, and a lead held out of the queue is held for a bounded time.
        // An empty Meet standby room with its host in has no timer of its own
        // (stress2 round 3: Zoom's 40-minute rule is Zoom's): it ends with the
        // host's Available (the sweep's R8), which the row does not carry.
        const meetStandby = after.purpose === "standby" && after.provider !== "zoom" && after.state === "host_in" && !after.contact_id;
        if (!isFinal(after.state) && !meetStandby) {
          const ts = timers(after, cx);
          expect(ts.length).toBeGreaterThan(0);
          for (const x of ts) expect(Number.isFinite(x.at)).toBe(true);
          if (after.contact_id && after.purpose !== "booked") expect(Number.isFinite(holdUntil(after, cx) as number)).toBe(true);
          if (after.purpose === "booked") expect(holdUntil(after, cx)).toBe(null);
          expect(Number.isFinite(nextDueAt(after, t, cx) as number)).toBe(true);
        }
        // 10. The browser's view never carries the host link.
        expect(JSON.stringify(toRoomView(after, { short_link: rnd() < 0.5 }))).not.toContain("RANDOMSECRET");
        r = after;
      }
      // 11. Over the whole run, the link was asked for at most once.
      expect(firstSends).toBeLessThanOrEqual(1);
    }

    // The runs reached every state, every allowed move and every timer, so the checks above were not empty.
    for (const s of ROOM_STATES) expect([s, (seenStates.get(s) ?? 0) > 50]).toEqual([s, true]);
    const allowed = ROOM_STATES.flatMap(f => TRANSITIONS[f].map(to => `${f}>${to}`));
    for (const m of allowed) expect([m, seenMoves.has(m)]).toEqual([m, true]);
    expect([...seenMoves].every(m => allowed.includes(m))).toBe(true);
    // standby_max is Zoom's alone since stress2 round 3 and rarely reached at
    // random (a Zoom standby room with its host in for 35 minutes); its own
    // tests above and in roomlogic.fixes.test.ts cover it.
    for (const reason of ["fail", "recover", "host_by", "lead_by", "booked_guard", "availability", "no_end_signal"])
      expect([reason, (reasons.get(reason) ?? 0) > 0]).toEqual([reason, true]);
    expect(leadInTicks).toBeGreaterThan(1_000);
    expect(heldTicks).toBeGreaterThan(500);
    expect(finalUndos).toBeGreaterThanOrEqual(5);
    expect(linkReasks).toBeGreaterThan(50);
    expect(countReasks).toBeGreaterThan(30);
    expect(events).toBeGreaterThan(100_000);
  }, 60_000); // 10,000 runs take about 1 s alone and up to 8 s on a loaded machine: never cut short by the 5 s default.
});
