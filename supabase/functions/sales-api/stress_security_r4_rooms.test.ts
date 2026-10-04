// bun test supabase/functions/sales-api/stress_security_r4_rooms.test.ts
//
// Security and abuse stress of sales-api's live-call actions, round 4,
// 3 October 2026: a request id read from another rep's room (every seat reads
// cockpit_sales_rooms.request_id under row security) handed to room.wrap, and
// the "lead evidence" a hand-pressed join leans on, made by the host
// themselves. Each `test` held when written; each `test.failing` pins a
// confirmed finding (its key is in its name) and goes red when the fix
// lands, so the fix flips it to `test`. Against testfakes.ts; no network, no
// real row, no HighLevel.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps, seatRequestId } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const HOST = "stress-host@stress.invalid";
const OTHER = "stress-other@stress.invalid";
const LEAD = "stress-lead-r4-1";
const LEAD2 = "stress-lead-r4-2";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const MEET_URL = "https://meet.google.com/abc-defg-hij";

const host: Who = { signed_in: true, seat: true, manager: false, email: HOST, name: "Stress Host", role: "setter", ghl_user_id: "G-host" };
const other: Who = { signed_in: true, seat: true, manager: false, email: OTHER, name: "Stress Other", role: "setter", ghl_user_id: "G-other" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: false, whatsapp_template: false, email: false },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};

function setup(o: { rooms?: Row } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const marks: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: HOST, name: "Stress Host", role: "setter", ghl_user_id: "G-host", active: true },
    { email: OTHER, name: "Stress Other", role: "setter", ghl_user_id: "G-other", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: HOST, zoom_user_id: "Z-host", zoom_status: "licensed", google_ok: true },
    { email: OTHER, zoom_user_id: "Z-other", zoom_status: "licensed", google_ok: true },
  ]);
  const contacts: Record<string, Row> = {
    [LEAD]: { firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@stress.invalid", tags: ["roas-qualified"], country: "KW" },
    [LEAD2]: { firstName: "Noor", name: "Noor Saleh", phone: "+96550000002", email: "noor@stress.invalid", tags: ["roas-qualified"], country: "KW" },
  };
  let booked = 0;
  w.routes.push((m, p) => {
    if (m === "GET" && p.startsWith("/contacts/")) {
      const id = p.split("/")[2] as string;
      return contacts[id] ? { contact: { id, ...contacts[id] } } : (null as unknown as Row);
    }
    if (m === "POST" && p === "/calendars/events/appointments") return { id: `live-appt-${++booked}` };
    if (m === "PUT" || m === "DELETE") return { ok: true };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (who, id, status, opts) => {
      marks.push({ who: who.email, id, status, ...opts });
      return {};
    },
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const posts = () => w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments");
  return { ...w, rooms, audits, marks, room, posts };
}

async function refused(p: Promise<unknown>): Promise<ApiRefusal> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

/** HOST's open Zoom room for LEAD, as the worker leaves it; its request id is readable by every seat. */
function seedHostRoom(w: ReturnType<typeof setup>, requestId: string): string {
  const id = fakeUuid();
  w.db.seed("cockpit_sales_rooms", [
    {
      id,
      request_id: requestId,
      contact_id: LEAD,
      purpose: "fallback",
      call_kind: "intro",
      provider: "zoom",
      host_email: HOST,
      made_by: HOST,
      state: "open",
      join_url: ZOOM_URL,
      provider_meeting_id: "81234567890",
      opened_at: w.db.iso(),
      host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
      lead_by: new Date(w.clock.now + 10 * MIN).toISOString(),
      ends_at: new Date(w.clock.now + 60 * MIN).toISOString(),
      version: 3,
    },
  ]);
  return id;
}

/** OTHER's own booked intro with LEAD2 in 10 minutes, on Meet, in HighLevel and the mirror. */
function seedOthersBooking(w: ReturnType<typeof setup>, apptId: string): void {
  const start = new Date(w.clock.now + 10 * MIN).toISOString();
  const end = new Date(w.clock.now + 40 * MIN).toISOString();
  w.db.seed("cockpit_sales_appointments", [
    { appointment_id: apptId, contact_id: LEAD2, call_type: "intro", status: "confirmed", start_at: start, assigned_user_id: "G-other", calendar_id: "cal-intro" },
  ]);
  w.routes.unshift((m, p) =>
    m === "GET" && p === `/calendars/events/appointments/${apptId}`
      ? { appointment: { id: apptId, contactId: LEAD2, assignedUserId: "G-other", calendarId: "cal-intro", startTime: start, endTime: end, address: MEET_URL } }
      : (null as unknown as Row),
  );
}

// ---------------------------------------------------------------------------

describe("security r4: a request id read from another rep's room", () => {
  test("room.wrap with a fresh request id makes the seat's own booked room (the fixture works)", async () => {
    const w = setup();
    seedHostRoom(w, crypto.randomUUID());
    seedOthersBooking(w, "stress-appt-r4");
    const out = await w.rooms.actions["room.wrap"]!(other, { request_id: crypto.randomUUID(), appointment_id: "stress-appt-r4" });
    const r = out.room as Row;
    expect(r.host_email).toBe(OTHER);
    expect(r.purpose).toBe("booked");
    expect(r.contact_id).toBe(LEAD2);
  });

  test("room.create with another rep's request id makes this seat's own room and names nothing of theirs (final review: a seat's id is its own)", async () => {
    const w = setup();
    const rid = crypto.randomUUID();
    const hostRoom = seedHostRoom(w, rid);
    const out = await w.rooms.actions["room.create"]!(other, { request_id: rid, contact_id: LEAD2, provider: "meet", call_kind: "intro", purpose: "manual" });
    expect((out.room as Row).host_email).toBe(OTHER);
    expect(JSON.stringify(out)).not.toContain(hostRoom);
  });

  test("the same seat's double press is still one room: its request id maps to one stored id", async () => {
    const w = setup();
    const rid = crypto.randomUUID();
    const body = { request_id: rid, contact_id: LEAD2, provider: "meet", call_kind: "intro", purpose: "manual" };
    const [a, b] = await Promise.all([w.rooms.actions["room.create"]!(other, body), w.rooms.actions["room.create"]!(other, body)]);
    expect((a.room as Row).id).toBe((b.room as Row).id);
    expect(w.room(String((a.room as Row).id)).request_id).toBe(await seatRequestId(other, rid));
  });

  test("wrap-request-id-hands-over-room: room.wrap with another rep's request id answers THEIR room, and writes a room.wrap audit row and a 'room made for the booked call' line on it in this seat's name", async () => {
    // roomWrap's first read (`repeat`) checks the host and falls through when
    // the request id is another rep's. The seat's own booking passes every
    // check, the insert hits cockpit_sales_rooms_request_id_key, and the
    // 23505 branch takes the row on that request id as "the twin" without
    // the host check createRoom's own branch has: it records the wrap on the
    // other rep's room (claimLine room.wrapped:{their id} lands, so the
    // audit row is written as this seat's room.wrap) and answers their room,
    // so the seat's own booked call gets no room at all. Every seat reads
    // cockpit_sales_rooms.request_id under the seat-read policy, so the id
    // needs no guessing; a double press that reuses an id after another rep
    // took it does the same by accident.
    const w = setup();
    const rid = crypto.randomUUID();
    const hostRoom = seedHostRoom(w, rid);
    seedOthersBooking(w, "stress-appt-r4");
    let answer: Row | null = null;
    let code: unknown = null;
    try {
      answer = await w.rooms.actions["room.wrap"]!(other, { request_id: rid, appointment_id: "stress-appt-r4" });
    } catch (e) {
      if (!(e instanceof ApiRefusal)) throw e;
      code = e.extra.code;
    }
    // Never the other rep's room, as an answer or as a record in this seat's name.
    expect(answer ? (answer.room as Row).id : null).not.toBe(hostRoom);
    expect(w.audits.filter(a => a.entityId === hostRoom && a.who === OTHER)).toHaveLength(0);
    expect(w.db.t("cockpit_sales_room_events").filter(e => e.room_id === hostRoom && e.kind === "room.wrapped")).toHaveLength(0);
    // Either refused as createRoom refuses it, or the seat's own booked room on a fresh id.
    if (!answer) expect(code).toBe("bad_input");
    else expect((answer.room as Row).host_email).toBe(OTHER);
  });

  test("wrap-request-id-hands-over-room (the open booked room): room.wrap on another rep's booked call answers their open room to any seat, where the same press with no room open is refused 'booked with another rep'", async () => {
    // roomWrap answers "the booked call's room already open (another tab)"
    // before it reads who the call is assigned to, so the gate depends on
    // whether the other rep has opened their room yet: refused before,
    // answered (as this seat's booked room) after.
    const w = setup();
    const apptId = "stress-appt-r4-host";
    const start = new Date(w.clock.now + 10 * MIN).toISOString();
    w.db.seed("cockpit_sales_appointments", [
      { appointment_id: apptId, contact_id: LEAD, call_type: "intro", status: "confirmed", start_at: start, assigned_user_id: "G-host", calendar_id: "cal-intro" },
    ]);
    w.routes.unshift((m, p) =>
      m === "GET" && p === `/calendars/events/appointments/${apptId}`
        ? { appointment: { id: apptId, contactId: LEAD, assignedUserId: "G-host", calendarId: "cal-intro", startTime: start, endTime: new Date(w.clock.now + 40 * MIN).toISOString(), address: MEET_URL } }
        : (null as unknown as Row),
    );
    const before = await refused(w.rooms.actions["room.wrap"]!(other, { request_id: crypto.randomUUID(), appointment_id: apptId }));
    expect(before.extra.code).toBe("not_host");
    const mine = await w.rooms.actions["room.wrap"]!(host, { request_id: crypto.randomUUID(), appointment_id: apptId });
    expect((mine.room as Row).host_email).toBe(HOST);
    const after = await refused(w.rooms.actions["room.wrap"]!(other, { request_id: crypto.randomUUID(), appointment_id: apptId }));
    expect(after.extra.code).toBe("not_host");
  });
});

describe("security r4: the lead's evidence for a live count, made by the host", () => {
  /**
   * HOST's Meet room for LEAD, opened by the worker. Sending is off in this
   * setting (the rep copies the link instead), so nothing ever went to the
   * lead: the only person who holds the link is the host, whose panel shows
   * the code and copies the link.
   */
  async function hostRoomNothingSent(w: ReturnType<typeof setup>): Promise<string> {
    const out = await w.rooms.actions["room.create"]!(host, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
    });
    const id = String((out.room as Row).id);
    const v = Number(w.room(id).version);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, { method: "PATCH", body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: v + 1 } });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: MEET_URL,
        provider_meeting_id: "evt-r4",
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: v + 2,
      },
    });
    return id;
  }

  /** The host taps their own room's short link (to check it, or on purpose): the door's own writes. */
  async function hostOpensOwnLink(w: ReturnType<typeof setup>, id: string): Promise<void> {
    w.clock.now += 30_000;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { first_open_at: w.db.iso(), last_open_at: w.db.iso(), open_device: "phone" } });
    w.db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "door.open", source: "door", dedupe_key: `open:${id}:r4`, handled_at: w.db.iso(), text: "The lead opened the link on a phone.", detail: { device: "phone", os: "ios", ip_hash: "stress-host-network" } },
    ]);
  }

  test("a hand press with nothing from the lead is self_reported: no booking, a manager decides (round 1 holds)", async () => {
    const w = setup({ rooms: { count_on_join: true, test_calendar_id: "TESTCAL", live_calendar_id: "LIVECAL" } });
    const id = await hostRoomNothingSent(w);
    await w.rooms.actions["room.mark"]!(host, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    expect(w.posts()).toHaveLength(0);
    expect(w.room(id).count_result ?? null).toBe("self_reported");
  });

  test("host-open-is-lead-evidence: the host opens their own room's link (the link never went to the lead), presses 'The lead is in', and a live call is booked and marked shown in their numbers with no manager", async () => {
    // rooms.ts leadEvidence reads first_open_at / last_open_at as "something
    // from the lead says they came", so a hand press after any open counts
    // (countLive: lead_evidence true, not self_reported). But the short link
    // is not the lead's alone: the host's panel shows the code and copies
    // the link, and the door stamps first_open_at for whoever opens it (any
    // browser that is not a preview bot). Here the link never went to the
    // lead at all (link_sent_at is null), the only open is the host's own,
    // and the count still books a "Live" call and marks it shown, crediting
    // the host, with no manager's confirm (room.count_confirm is skipped).
    // The same holds for a Zoom room: the host joins from a guest device
    // with no email and no Zoom id, which zoomRole reads as the lead.
    const w = setup({ rooms: { count_on_join: true, test_calendar_id: "TESTCAL", live_calendar_id: "LIVECAL" } });
    const id = await hostRoomNothingSent(w);
    await hostOpensOwnLink(w, id);
    expect(w.room(id).link_sent_at ?? null).toBeNull();
    await w.rooms.actions["room.mark"]!(host, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    // An open before the link ever went to the lead is the host's own: it is
    // no evidence, so the join waits for a manager like any hand press.
    expect(w.posts()).toHaveLength(0);
    expect(w.room(id).count_result ?? null).toBe("self_reported");
  });
});

describe("final review: only Zoom's join on the room's own meeting is the lead's evidence", () => {
  async function sentRoom(w: ReturnType<typeof setup>, provider: "meet" | "zoom"): Promise<string> {
    const out = await w.rooms.actions["room.create"]!(host, { request_id: crypto.randomUUID(), contact_id: LEAD, provider, call_kind: "intro", purpose: "manual" });
    const id = String((out.room as Row).id);
    const v = Number(w.room(id).version);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, { method: "PATCH", body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: v + 1 } });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: provider === "zoom" ? ZOOM_URL : MEET_URL,
        provider_meeting_id: provider === "zoom" ? "81234567890" : "evt-final",
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: v + 2,
        // The link went to the lead a minute ago.
        link_sent_at: w.db.iso(),
        link_channels: ["whatsapp_text"],
      },
    });
    return id;
  }

  test("host-open-after-send: the host taps the sent link on their own phone and presses The lead is in: self_reported, nothing booked, a manager decides", async () => {
    const w = setup({ rooms: { count_on_join: true, test_calendar_id: "TESTCAL", live_calendar_id: "LIVECAL" } });
    const id = await sentRoom(w, "meet");
    w.clock.now += 60_000;
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { first_open_at: w.db.iso(), last_open_at: w.db.iso(), lead_waiting_at: w.db.iso() } });
    w.db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "door.open", source: "door", dedupe_key: `open:${id}:after-send`, handled_at: w.db.iso(), text: "The lead opened the link on a phone.", detail: { device: "phone", os: "ios", ip_hash: "the-hosts-phone" } },
    ]);
    await w.rooms.actions["room.mark"]!(host, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    expect(w.posts()).toHaveLength(0);
    expect(w.room(id).count_result ?? null).toBe("self_reported");
  });

  test("a Zoom join from another meeting on the room's timeline is never the lead's evidence", async () => {
    const w = setup({ rooms: { count_on_join: true, test_calendar_id: "TESTCAL", live_calendar_id: "LIVECAL" } });
    const id = await sentRoom(w, "zoom");
    w.db.seed("cockpit_sales_room_events", [
      {
        room_id: id, kind: "zoom.meeting.participant_joined", source: "zoom", dedupe_key: `zoom:join:other:${id}`, handled_at: w.db.iso(),
        detail: { event: "meeting.participant_joined", role: "lead", payload: { object: { id: "11122233344", participant: { user_name: "A Friend" } } } },
      },
    ]);
    await w.rooms.actions["room.mark"]!(host, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    expect(w.posts()).toHaveLength(0);
    expect(w.room(id).count_result ?? null).toBe("self_reported");
  });

  test("Zoom's join of the lead on the room's own meeting counts: booked, no manager needed", async () => {
    const w = setup({ rooms: { count_on_join: true, test_calendar_id: "TESTCAL", live_calendar_id: "LIVECAL" } });
    const id = await sentRoom(w, "zoom");
    w.db.seed("cockpit_sales_room_events", [
      {
        room_id: id, kind: "zoom.meeting.participant_joined", source: "zoom", dedupe_key: `zoom:join:own:${id}`, handled_at: w.db.iso(),
        detail: { event: "meeting.participant_joined", role: "lead", payload: { object: { id: "81234567890", participant: { user_name: "Huda Ali" } } } },
      },
    ]);
    await w.rooms.actions["room.mark"]!(host, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    expect(w.posts()).toHaveLength(1);
    expect(w.room(id).count_result).toBe("booked");
  });

  test("a count that books answers the room's earlier count alerts (final review: per-room alerts were never resolved)", async () => {
    const w = setup({ rooms: { count_on_join: true, test_calendar_id: "TESTCAL", live_calendar_id: "LIVECAL" } });
    const id = await sentRoom(w, "zoom");
    w.db.seed("cockpit_sales_alerts", [
      { id: fakeUuid(), dedupe_key: `room:${id}:count_unread`, kind: "room_count_stuck", message: "Room: could not count yet.", raised_at: w.db.iso() },
      { id: fakeUuid(), dedupe_key: `room:${id}:undo_stuck`, kind: "room_count_stuck", message: "Room: remove it by hand.", raised_at: w.db.iso() },
    ]);
    w.db.seed("cockpit_sales_room_events", [
      {
        room_id: id, kind: "zoom.meeting.participant_joined", source: "zoom", dedupe_key: `zoom:join:own2:${id}`, handled_at: w.db.iso(),
        detail: { event: "meeting.participant_joined", role: "lead", payload: { object: { id: "81234567890", participant: { user_name: "Huda Ali" } } } },
      },
    ]);
    await w.rooms.actions["room.mark"]!(host, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    expect(w.room(id).count_result).toBe("booked");
    const alert = (what: string) => w.db.t("cockpit_sales_alerts").find(a => a.dedupe_key === `room:${id}:${what}`) as Row;
    expect(alert("count_unread").resolved_at).toBeTruthy();
    // An alert that asks a person to act on HighLevel stays until a person does.
    expect(alert("undo_stuck").resolved_at ?? null).toBeNull();
  });

  test("a Zoom event pinned to a Meet room is applied to nothing, and leaves the room's timeline", async () => {
    const w = setup();
    const id = await sentRoom(w, "meet");
    const eid = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      {
        id: eid, room_id: id, kind: "zoom.meeting.participant_joined", source: "zoom", dedupe_key: `zoom:join:meet:${id}`,
        detail: { event: "meeting.participant_joined", event_ts: w.clock.now, payload: { object: { id: "11122233344", topic: `Mahara call ${String(w.room(id).code)}`, participant: { user_name: "A Friend", email: "friend@stress.invalid" } } } },
      },
    ]);
    const out = await w.rooms.desk["room.event"]!({ signed_in: true, seat: true, manager: false, email: "sales-desk" }, { kind: "zoom.meeting.participant_joined", event_id: eid });
    await w.flush();
    expect(out.skipped).toBe("another meeting");
    expect(w.room(id).state).toBe("open");
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === eid) as Row;
    expect(ev.room_id ?? null).toBeNull();
    expect(ev.handled_at).toBeTruthy();
    expect(JSON.stringify(ev)).not.toContain("friend@stress.invalid");
  });
});

describe("security r4: the gate's shared secret", () => {
  // index.ts has no harness (it calls Deno.serve when imported), so the gate
  // is read from its source, as stress_numbers_ceilings reads the budget.
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  test("the gate reads x-cron-secret only for CRON_ACTIONS, and a seat never gets the desk's handlers (the fixture works)", () => {
    expect(src).toMatch(/req\.headers\.get\("x-cron-secret"\)/);
    expect(src).toMatch(/CRON_ACTIONS\.has\(String\(body\?\.action \?\? ""\)\)/);
  });

  test("cron-secret-compare-not-constant-time: sales-api compares x-cron-secret with ===, which stops at the first differing character; the door (sales-live/sign.ts timingSafeEqual) compares the same secret in constant time", () => {
    // The same CRON_SECRET opens room.event of every kind (a forged Zoom
    // join included), live.press and contract.sync at sales-api with only
    // the public anon key beside it. The door and the cron door compare it
    // with timingSafeEqual; the gate here does not. Remote timing is hard to
    // use against a long random secret, but nothing says this one is long,
    // and the fix is one line: the door's own constant-time compare.
    const gate = src.slice(src.indexOf("const byCron"), src.indexOf("const byCron") + 400);
    expect(gate).not.toMatch(/\.trim\(\)\s*===\s*cronSecret/);
  });
});
