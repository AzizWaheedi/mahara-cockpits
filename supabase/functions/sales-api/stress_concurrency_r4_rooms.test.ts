// bun test supabase/functions/sales-api/stress_concurrency_r4_rooms.test.ts
//
// Round 4 stress, dimension: concurrency and idempotency at scale. rooms.ts
// on testfakes.ts, where every await is a point another request (or a
// background job of the same request) can run in. Each test names the race:
//
//   - two rooms of one lead counted at the same moment. standingCount reads
//     the lead's other rooms before this room's claim is written, so two
//     counts that start together each find "no other count" and each book a
//     "Live ·" call. The tick posts every room with a lead and every room
//     whose join is in the last hour in one body, and carries out each
//     room's count in the background, side by side; a Zoom join on the new
//     room lands beside the tick's re-ask for the old one the same way.
//   - a manager's "Count it" (room.count_confirm) pressed in two tabs.
//
// A failing test is a finding for the fix agent; once fixed it stays as a
// regression test. Nothing here reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld, seedLeadZoomJoin } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const CLOSER = "closer@stress.invalid";
const BOSS = "boss@stress.invalid";
const LEAD = "stress-r4-lead-000001";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
// Sunday 4 October 2026, 11:00 in Kuwait.
const SUN_11 = Date.parse("2026-10-04T08:00:00Z");

const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: BOSS, name: "Bea Boss", role: "manager", ghl_user_id: "G-boss" };
const boss2: Who = { ...boss, email: "boss2@stress.invalid", name: "Ben Boss", ghl_user_id: "G-boss2" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  count_on_join: true,
  test_calendar_id: "TESTCAL",
  live_calendar_id: "LIVECAL",
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: false, whatsapp_template: false, email: false },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};

async function settled<T>(ps: Promise<T>[]) {
  const out = await Promise.allSettled(ps);
  return out.map(o => {
    if (o.status === "fulfilled") return { ok: true as const, value: o.value as Row };
    const e = o.reason;
    if (e instanceof ApiRefusal) return { ok: false as const, code: String(e.extra.code ?? ""), message: e.message, status: e.status };
    return { ok: false as const, code: "crash", message: String((e as Error)?.stack ?? e), status: 500 };
  });
}

function setup() {
  const w = fakeWorld(SUN_11);
  const audits: Row[] = [];
  let contactUp = true;
  // overlap(n): the next n contact reads answer together, once all n are in
  // flight (two counts both waiting on HighLevel at the same moment).
  let barrier: { n: number; arrived: number; open: () => void; p: Promise<void> } | null = null;
  // holdContact(): the next contact read waits until the test lets it go
  // (HighLevel answering in seconds, not milliseconds).
  let held: { reached: () => void; go: Promise<void> } | null = null;
  function holdContact() {
    let reached!: () => void;
    let release!: () => void;
    const at = new Promise<void>(r => (reached = r));
    const go = new Promise<void>(r => (release = r));
    held = { reached, go };
    return { at, release };
  }
  function overlap(n: number) {
    let open!: () => void;
    const p = new Promise<void>(r => (open = r));
    barrier = { n, arrived: 0, open, p };
  }
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON } },
    { key: "live", value: { enabled: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
    { email: BOSS, name: "Bea Boss", role: "manager", ghl_user_id: "G-boss", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true },
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
  ]);
  let n = 0;
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) {
      // HighLevel answers slower than the database (a few hundred ms against
      // tens): modelled as more turns of the event loop than a database read.
      for (let i = 0; i < 40; i++) await null;
      if (held) {
        const h = held;
        held = null;
        h.reached();
        await h.go;
      }
      if (barrier && barrier.arrived < barrier.n) {
        const b = barrier;
        b.arrived++;
        if (b.arrived === b.n) {
          barrier = null;
          b.open();
        }
        await b.p;
      }
      if (!contactUp) throw Object.assign(new Error("HighLevel said 503"), { status: 503 });
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    }
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [] };
    if (m === "POST" && p === "/calendars/events/appointments") return { id: `live-appt-${++n}` };
    if (m === "PUT" || m === "DELETE") return { ok: true };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (_who, id, status) => ({ id: fakeUuid(), appointment_id: id, status }),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;

  /**
   * A room of the lead's with the lead in it: the short link opened, Zoom
   * saw the lead join the room's own meeting (the lead's own evidence, final
   * review), joined `joinedAgo` ago, and never counted (the count could not
   * read the lead while HighLevel was down, so no claim).
   */
  function joinedRoom(o: { joinedAgo: number; state: "lead_in" | "ended"; host?: string }): string {
    const id = fakeUuid();
    const joined = w.clock.now - o.joinedAgo;
    w.db.seed("cockpit_sales_rooms", [
      {
        id,
        request_id: fakeUuid(),
        code: `R${String(id).slice(-5).toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "K")}`.slice(0, 6).padEnd(6, "K"),
        contact_id: LEAD,
        contact_first_name: "Huda",
        purpose: "manual",
        trigger: "manual",
        call_kind: "intro",
        provider: "meet",
        host_email: o.host ?? SETTER,
        made_by: o.host ?? SETTER,
        state: o.state,
        result: o.state === "ended" ? "joined" : null,
        join_url: MEET_URL,
        provider_meeting_id: `evt-${id.slice(-4)}`,
        requested_at: new Date(joined - 5 * MIN).toISOString(),
        opened_at: new Date(joined - 4 * MIN).toISOString(),
        link_sent_at: new Date(joined - 4 * MIN).toISOString(),
        first_open_at: new Date(joined - 2 * MIN).toISOString(),
        last_open_at: new Date(joined - 2 * MIN).toISOString(),
        host_in_at: new Date(joined - 3 * MIN).toISOString(),
        lead_in_at: new Date(joined).toISOString(),
        lead_in_seen_at: new Date(joined).toISOString(),
        ended_at: o.state === "ended" ? new Date(joined + 90 * S).toISOString() : null,
        ends_at: new Date(joined + 30 * MIN).toISOString(),
        version: 6,
      },
    ]);
    seedLeadZoomJoin(w.db, id, { at: new Date(joined).toISOString() });
    return id;
  }
  const posts = () => w.ghlCalls.filter(c => c.method === "POST" && c.path === "/calendars/events/appointments");
  return {
    ...w,
    rooms,
    audits,
    room,
    joinedRoom,
    posts,
    overlap,
    holdContact,
    setContactUp: (v: boolean) => {
      contactUp = v;
    },
  };
}

// ---------------------------------------------------------------------------
// Two rooms of one lead, counted at the same moment
// ---------------------------------------------------------------------------

describe("two rooms of one lead counted at the same moment", () => {
  test("sibling-counts-race: the call dropped and the lead joined a second room while HighLevel was down; the tick re-asks both counts in one body: one Live booking for one conversation", async () => {
    const w = setup();
    // Room A: the lead joined 4 minutes ago, talked 90 s, the call dropped
    // and the setter ended the room. Room B: a new room, the lead in it a
    // minute ago. HighLevel could not be read for either count (contact read
    // 503), so neither was claimed and the sweep re-asks both.
    const a = w.joinedRoom({ joinedAgo: 4 * MIN, state: "ended" });
    const b = w.joinedRoom({ joinedAgo: 70 * S, state: "lead_in" });
    // HighLevel is back. The SQL tick posts both rooms (B has a lead and is
    // not final; A's join is within the hour) in one body, as
    // cockpit_sales_rooms_tick builds it. Both counts wait on HighLevel's
    // contact read at the same time (it answers in hundreds of ms; the tick
    // reaches room B within tens).
    w.overlap(2);
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [a, b] } });
    await w.flush();
    // standingCount (rooms.ts) reads the lead's other rooms before this
    // room's claim is written: both counts find "no other count", both
    // claim their own row, and both book "Live · Huda". One conversation,
    // two shows on the live calendar.
    const booked = [a, b].filter(id => w.room(id).count_result === "booked");
    expect({ posts: w.posts().length, booked: booked.length }).toEqual({ posts: 1, booked: 1 });
  });

  test("sibling-counts-race (two ticks): the sweep overran and two ticks carry the two rooms at once: still one Live booking", async () => {
    const w = setup();
    const a = w.joinedRoom({ joinedAgo: 4 * MIN, state: "ended" });
    const b = w.joinedRoom({ joinedAgo: 70 * S, state: "lead_in" });
    await Promise.all([
      w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [a] } }),
      w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [b] } }),
    ]);
    await w.flush();
    expect(w.posts().length).toBe(1);
  });

  test("sibling-counts-race (join beside a re-ask): the lead's join on room B is pressed while the tick re-asks room A's count: one Live booking", async () => {
    const w = setup();
    const a = w.joinedRoom({ joinedAgo: 3 * MIN, state: "ended" });
    // Room B: the setter's new room, the host in it, the lead not marked yet.
    const b = w.joinedRoom({ joinedAgo: 0, state: "lead_in" });
    const rb = w.room(b);
    rb.state = "host_in";
    rb.lead_in_at = null;
    rb.lead_in_seen_at = null;
    rb.version = 5;
    w.overlap(2);
    await Promise.all([
      w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [a] } }),
      w.rooms.actions["room.mark"]!(setter, { room_id: b, version: 5, what: "lead_in" }),
    ]);
    await w.flush();
    expect(w.room(b).state).toBe("lead_in");
    expect(w.posts().length).toBe(1);
  });

  test("sibling-counts-race (reopened together): That was not the lead on the counted room reopens its two already-counted siblings, and their two counts run side by side: one Live booking", async () => {
    const w = setup();
    // Room A was counted (Live booking made); rooms B and C, joined after it
    // inside three hours, were told "already counted". The rep then says the
    // join in A was not the lead (within its five minutes): the undo deletes
    // A's booking and reopenSiblings (rooms.ts) sets B and C back to undone
    // and runs both counts in the background at once.
    const a = w.joinedRoom({ joinedAgo: 4 * MIN, state: "ended" });
    const b = w.joinedRoom({ joinedAgo: 3 * MIN, state: "ended" });
    const c = w.joinedRoom({ joinedAgo: 2 * MIN, state: "ended" });
    Object.assign(w.room(a), {
      count_claimed_at: new Date(w.clock.now - 4 * MIN).toISOString(),
      count_result: "booked",
      count_appointment_id: "live-appt-0",
      lead_in_seen_at: new Date(w.clock.now - 60 * S).toISOString(),
    });
    for (const id of [b, c])
      Object.assign(w.room(id), { count_claimed_at: new Date(w.clock.now - 2 * MIN).toISOString(), count_result: "already_counted" });
    w.overlap(2);
    await w.rooms.actions["room.mark"]!(setter, { room_id: a, version: Number(w.room(a).version), what: "not_lead" });
    await w.flush();
    expect(w.room(a).count_result).toBe("undone");
    // Both siblings' counts read "no other count stands" before either claims.
    expect(w.posts().length).toBe(1);
  });

  test("control: the same two rooms counted one after the other book once (standingCount holds when the counts do not overlap)", async () => {
    const w = setup();
    const a = w.joinedRoom({ joinedAgo: 4 * MIN, state: "ended" });
    const b = w.joinedRoom({ joinedAgo: 70 * S, state: "lead_in" });
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [a] } });
    await w.flush();
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [b] } });
    await w.flush();
    expect(w.posts().length).toBe(1);
    expect(w.room(b).count_result).toBe("already_counted");
  });

  test("fifty ticks at once over five rooms of one lead (an outage's backlog): one Live booking, and every other room says it was already counted", async () => {
    const w = setup();
    const ids = [
      w.joinedRoom({ joinedAgo: 40 * MIN, state: "ended" }),
      w.joinedRoom({ joinedAgo: 30 * MIN, state: "ended" }),
      w.joinedRoom({ joinedAgo: 20 * MIN, state: "ended" }),
      w.joinedRoom({ joinedAgo: 10 * MIN, state: "ended" }),
      w.joinedRoom({ joinedAgo: 70 * S, state: "lead_in" }),
    ];
    const outs = await settled(
      Array.from({ length: 50 }, (_, i) => w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [ids[i % 5]!] } })),
    );
    await w.flush();
    expect(outs.filter(o => !o.ok)).toHaveLength(0);
    expect(w.posts().length).toBe(1);
    const results = ids.map(id => w.room(id).count_result ?? null).sort();
    expect(results.filter(r => r === "booked")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// "That was not the lead" pressed while the count is still reading the lead
// ---------------------------------------------------------------------------

describe("That was not the lead pressed before the count has claimed", () => {
  test("count-claim-erases-not-lead: the host presses That was not the lead while the join's count waits on HighLevel; the count's claim clears the press and books a Live call for a join that was not the lead", async () => {
    const w = setup();
    // The setter's room, the host in it, the lead's link opened.
    const id = w.joinedRoom({ joinedAgo: 0, state: "lead_in" });
    Object.assign(w.room(id), { state: "host_in", lead_in_at: null, lead_in_seen_at: null, version: 5 });
    // Someone joins and the host presses The lead is in: count_live runs in
    // the background and first reads the lead from HighLevel (slow today).
    const h = w.holdContact();
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: 5, what: "lead_in" });
    await h.at;
    expect(w.room(id).state).toBe("lead_in");
    // The host sees it was their colleague and presses That was not the
    // lead; the panel sends it after its 5 s Undo. HighLevel is slow today
    // (its read timeouts are 8 to 25 s), or this is a minute's re-ask of a
    // count that could not read the lead before: no count is claimed yet,
    // so the press writes count_undo_at only (roomlogic notLead).
    const v = Number(w.room(id).version);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "not_lead" });
    expect(w.room(id).state).toBe("host_in");
    expect(w.room(id).count_undo_at).toBeTruthy();
    // HighLevel answers. runCount decided from the row it read before the
    // press (countClaimable and leadJoined on that copy) and claims with
    // expect {count_claimed_at: null, count_result: null}: the claim lands,
    // sets count_undo_at back to null, and the count books "Live · Huda".
    h.release();
    await w.flush();
    const r = w.room(id);
    // No Live booking stands for a join the host took back (one made and
    // deleted again would do), and the press is kept on the room.
    const deleted = w.ghlCalls.filter(c => c.method === "DELETE").length;
    expect({ standing: w.posts().length - deleted, undo_kept: Boolean(r.count_undo_at), counted: ["booked", "moved"].includes(String(r.count_result)) }).toEqual({
      standing: 0,
      undo_kept: true,
      counted: false,
    });
  });
});

// ---------------------------------------------------------------------------
// "Count it" pressed in two tabs
// ---------------------------------------------------------------------------

describe("a manager's Count it pressed in two tabs", () => {
  function selfReported(w: ReturnType<typeof setup>): string {
    // A Meet room whose join only a hand press reported: no short-link open,
    // no knock (count_result self_reported, the count's alert to a manager).
    const id = w.joinedRoom({ joinedAgo: 3 * MIN, state: "ended" });
    const r = w.room(id);
    r.first_open_at = null;
    r.last_open_at = null;
    r.count_claimed_at = new Date(w.clock.now - 3 * MIN).toISOString();
    r.count_result = "self_reported";
    return id;
  }

  test("two managers (or two tabs) press Count it at once: one Live booking and one room.count_confirm audit row", async () => {
    const w = setup();
    const id = selfReported(w);
    const outs = await settled([
      w.rooms.actions["room.count_confirm"]!(boss, { room_id: id }),
      w.rooms.actions["room.count_confirm"]!(boss2, { room_id: id }),
    ]);
    await w.flush();
    expect(outs.filter(o => !o.ok && o.code === "crash")).toHaveLength(0);
    expect(w.posts().length).toBe(1);
    expect(w.room(id).count_result).toBe("booked");
    // The second press confirmed nothing (the first had taken the count):
    // it is told so, and leaves no second "confirmed" row in the audit log.
    expect(w.audits.filter(a => a.action === "room.count_confirm")).toHaveLength(1);
  });
});
