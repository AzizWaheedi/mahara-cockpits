// bun test supabase/functions/sales-api/stress2_concurrency_r5_fuzz.test.ts
//
// Second series, round 5, dimension: concurrency and idempotency. A seeded
// interleaving search over one Zoom room with the live count on.
//
// The story is fixed; only the order and the timing move:
//   - the lead's assistant joins the setter's Zoom room first (14:03:00,
//     Zoom sees a guest outside the team), then Huda herself (14:03:03);
//   - Zoom's webhook for each join reaches sales-api once, twice (Zoom's
//     retry, the door's second try) or late (the sweep's replay);
//   - the setter, seeing the assistant's name on the panel, presses "That
//     was not the lead" (only while the panel shows the assistant's join);
//   - the minute's tick runs beside all of it;
//   - HighLevel answers slowly, and sometimes 429 to the live booking.
// Every database, rpc and HighLevel call yields a random number of turns
// first, so the actors interleave at every await, as two Edge Function
// instances and the sweep do.
//
// Whatever the order, once the sweep's minutes have run: Huda's join
// stands, the room's count is "booked" on exactly one "Live · Huda" booking
// in HighLevel, the cockpit's calendar copy holds that one booking, and no
// other live booking is left behind.
//
// A failing seed is a finding for the fix agent (the failure names the seed
// and the order the actors took). Nothing here reaches HighLevel, Zoom,
// Google or Slack; every lead is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { GhlError, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, leadJoined } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-lead-s2c5-000003";
const MEETING = "81234500097";
const ZOOM_URL = `https://us06web.zoom.us/j/${MEETING}?pwd=stress`;
const SEEDS = Number(process.env.R5_SEEDS ?? 300);

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

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

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const turn = () => new Promise<void>(r => setTimeout(r, 0));

function world(seed: number) {
  const rnd = prng(seed);
  const w = fakeWorld();
  const hl = new Map<string, Row>();
  const order: string[] = [];
  let posts = 0;
  const p429 = rnd() < 0.3 ? 0.4 : 0;
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON } },
    { key: "live", value: { enabled: false, standby: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.routes.push(async (m, p, body) => {
    const b = (body ?? {}) as Row;
    if (m === "GET" && p === `/contacts/${LEAD}`)
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", tags: ["roas-qualified"], country: "KW" } };
    if (m === "GET" && p === `/contacts/${LEAD}/appointments`) return { events: [...hl.values()] };
    if (m === "POST" && p === "/calendars/events/appointments") {
      posts++;
      if (rnd() < p429) throw new GhlError("HighLevel said 429: Too many requests", 429);
      const id = `live-${fakeUuid()}`;
      hl.set(id, { id, ...b });
      // HighLevel made it; its answer takes a while.
      // Mostly quick; now and then as slow as a whole second count's run.
      const n = rnd() < 0.35 ? 100 + Math.floor(rnd() * 300) : Math.floor(rnd() * 40);
      for (let i = 0; i < n; i++) await turn();
      return { id };
    }
    const del = /^\/calendars\/events\/([^/?]+)$/.exec(p);
    if (del && m === "DELETE") {
      const id = decodeURIComponent(del[1] as string);
      if (!hl.has(id)) throw new GhlError("HighLevel said 404: not found", 404);
      hl.delete(id);
      return { ok: true };
    }
    const one = /^\/calendars\/events\/appointments\/([^/?]+)$/.exec(p);
    if (one) {
      const id = decodeURIComponent(one[1] as string);
      if (!hl.has(id)) throw new GhlError("HighLevel said 404: not found", 404);
      if (m === "GET") return { appointment: { ...hl.get(id) } };
      if (m === "PUT") {
        hl.set(id, { ...(hl.get(id) as Row), ...b });
        return { ok: true };
      }
    }
    return null as unknown as Row;
  });
  const jitter = async () => {
    const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) await turn();
  };
  const io: LiveIO = {
    ...w.io,
    db: async (path, init) => {
      await jitter();
      const out = await w.io.db(path, init);
      await jitter();
      return out;
    },
    rpc: async (fn, args) => {
      await jitter();
      const out = await w.io.rpc(fn, args);
      await jitter();
      return out;
    },
    ghl: async (m, p, b, v) => {
      await jitter();
      const out = await w.io.ghl(m, p, b, v);
      await jitter();
      return out;
    },
    // A background job never holds the clock still for the others.
    sleep: async ms => {
      w.clock.now += ms;
      await turn();
    },
  };
  const deps: RoomDeps = {
    io,
    audit: async () => {},
    markAppointment: async () => ({ crm: "quiet" }),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, rnd, hl, rooms, room, order, posts: () => posts };
}

type W = ReturnType<typeof world>;

async function hostedRoom(w: W): Promise<string> {
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider: "zoom",
    call_kind: "intro",
    purpose: "manual",
  });
  const id = String((out.room as Row).id);
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(w.room(id).version) + 1 },
  });
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
    method: "PATCH",
    body: {
      state: "open",
      join_url: ZOOM_URL,
      provider_meeting_id: MEETING,
      opened_at: w.db.iso(),
      host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
      ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
      lead_by: new Date(w.clock.now + 10 * MIN).toISOString(),
      version: Number(w.room(id).version) + 1,
    },
  });
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { link_sent_at: w.db.iso(), link_claimed_at: w.db.iso(), first_open_at: w.db.iso() } });
  await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "host_in" });
  await w.flush();
  return id;
}

/** The door's stored Zoom join (no room.event yet); answers its event id. */
function storeJoin(w: W, id: string, name: string, uuid: string, at: number): string {
  const eventId = fakeUuid();
  w.db.seed("cockpit_sales_room_events", [
    {
      id: eventId,
      room_id: id,
      kind: "zoom.meeting.participant_joined",
      source: "zoom",
      dedupe_key: `zoom:meeting.participant_joined:${MEETING}:${uuid}:${new Date(at).toISOString()}`,
      at: new Date(at).toISOString(),
      text: "Zoom: someone joined.",
      detail: {
        event: "meeting.participant_joined",
        event_ts: at,
        payload: { object: { id: MEETING, uuid: "u1==", host_id: "Z-setter", participant: { id: "", user_name: name, join_time: new Date(at).toISOString(), participant_uuid: uuid } } },
      },
    },
  ]);
  return eventId;
}

async function run(seed: number): Promise<{ ok: boolean; detail: Row }> {
  const w = world(seed);
  const id = await hostedRoom(w);
  const t1 = w.clock.now;
  const t2 = t1 + 3 * S;
  const e1 = storeJoin(w, id, "Sara (assistant)", "p-assistant", t1);
  const e2 = storeJoin(w, id, "Huda Ali", "p-huda", t2);
  const wait = async (max: number) => {
    const n = Math.floor(w.rnd() * max);
    for (let i = 0; i < n; i++) await turn();
  };
  const safe = async (name: string, f: () => Promise<unknown>) => {
    try {
      await f();
      w.order.push(name);
    } catch (e) {
      w.order.push(`${name}!${String((e as { code?: unknown })?.code ?? (e as Error)?.message ?? e).slice(0, 40)}`);
    }
  };
  const zoom = (eid: string) => () => w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: eid, payload: {} });
  const actors: (() => Promise<void>)[] = [
    async () => {
      await wait(5);
      await safe("e1", zoom(e1));
    },
    async () => {
      await wait(60);
      w.clock.now = Math.max(w.clock.now, t2);
      await safe("e2", zoom(e2));
    },
    async () => {
      // The setter presses only while the panel shows the assistant's join.
      for (let i = 0; i < 80; i++) {
        const r = w.room(id);
        if (r.state === "lead_in" && Date.parse(String(r.lead_in_at)) === t1) {
          await wait(30);
          const now = w.room(id);
          if (now.state === "lead_in" && Date.parse(String(now.lead_in_at)) === t1)
            await safe("not_lead", () => w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(now.version), what: "not_lead" }));
          return;
        }
        await turn();
      }
    },
    async () => {
      await wait(80);
      await safe("tick", () => w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } }));
    },
  ];
  if (w.rnd() < 0.5)
    actors.push(async () => {
      await wait(80);
      await safe("e2-again", zoom(e2));
    });
  if (w.rnd() < 0.5)
    actors.push(async () => {
      await wait(100);
      await safe("replay", () => w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [e1, e2] } }));
    });
  await Promise.all(actors.map(a => a()));
  await w.flush();
  // The sweep's minutes: a replay of anything not handled, then the tick.
  // Eight of them (fix round 5): a count that met HighLevel's 429 five
  // times running gives its claim back and books at a later minute, as the
  // sweep's re-asks do for the hour after the join.
  for (let i = 0; i < 8; i++) {
    w.clock.now += MIN + S;
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [e1, e2] } }).catch(() => null);
    await w.flush();
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } }).catch(() => null);
    await w.flush();
  }
  const r = w.room(id);
  const live = [...w.hl.keys()].filter(k => k.startsWith("live-"));
  const copies = w.db.t("cockpit_sales_appointments").filter(a => String(a.appointment_id).startsWith("live-")).map(a => String(a.appointment_id));
  const detail = {
    seed,
    order: w.order.join(" > "),
    posts: w.posts(),
    state: r.state,
    lead_in_at_is_huda: Date.parse(String(r.lead_in_at)) === t2,
    count_result: r.count_result ?? null,
    room_booking_standing: live.includes(String(r.count_appointment_id)),
    live_bookings: live.length,
    copies: copies.length,
    copy_is_the_booking: copies.length === 1 && copies[0] === r.count_appointment_id,
    errors: w.logs.filter(l => l.startsWith("background:")).slice(0, 3),
    ...(process.env.R5_DEBUG ? { logs: w.logs.slice(-12), room: { ...r, join_url: undefined } } : {}),
  };
  // The count's own rule for "the lead joined" (roomlogic leadJoined). A
  // press that landed after Huda's join time reads her join as taken back
  // (stress2_concurrency_r5_later_join.test.ts pins that); here the
  // bookkeeping is checked against the rule as it stands: a join that counts
  // is booked once on one standing booking, and one that does not leaves no
  // booking and no copy behind.
  // Fix round 5: the rule reads the taken-back join's own time
  // (taken_back_join_at), so Huda's join before the press stands.
  const joinedByRule = leadJoined(r as never);
  (detail as Row).joined_by_rule = joinedByRule;
  const ok = joinedByRule
    ? detail.count_result === "booked" && detail.room_booking_standing && detail.live_bookings === 1 && detail.copy_is_the_booking && detail.errors.length === 0
    : detail.live_bookings === 0 && detail.copies === 0 && detail.errors.length === 0;
  return { ok, detail };
}

describe("one Zoom room, the assistant then Huda, That was not the lead, the tick, in every order", () => {
  test(`stale-count-takeback fuzz: ${SEEDS} seeded interleavings; Huda's join is counted once on one standing booking`, async () => {
    const bad: Row[] = [];
    const kinds = new Map<string, number>();
    for (let s = 1; s <= SEEDS; s++) {
      const out = await run(s);
      if (!out.ok) {
        bad.push(out.detail);
        const k = `${out.detail.joined_by_rule}:${out.detail.count_result}/${out.detail.live_bookings}/${out.detail.room_booking_standing}/${out.detail.copies}`;
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
      }
    }
    if (bad.length && process.env.R5_DEBUG) console.log(JSON.stringify(bad.slice(0, 5), null, 1));
    expect({ failing_seeds: bad.length, kinds: Object.fromEntries(kinds), first: bad[0] ?? null }).toEqual({
      failing_seeds: 0,
      kinds: {},
      first: null,
    });
  }, 900_000);
});
