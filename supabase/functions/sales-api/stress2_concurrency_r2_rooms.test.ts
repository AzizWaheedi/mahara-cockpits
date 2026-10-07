// bun test supabase/functions/sales-api/stress2_concurrency_r2_rooms.test.ts
//
// Second series, round 2, dimension: concurrency and idempotency. rooms.ts
// on testfakes.ts, where every await is a point another writer (the SQL
// sweep, a second tab) can move in.
//
//   - take-in-time-lost-when-sweep-runs-during-read: fix round 1 judges a
//     Take at the press (20261004a p_at), but only while the offer's row
//     still says offered. The SQL sweep runs every minute and its L1 ends
//     an offer at offer_until with no grace (and makes everyone it went to
//     who did not answer Away for a missed offer). A Take pressed seconds
//     before the end whose HighLevel contact read spans the minute's sweep
//     finds the offer expired: the closer is told the offer ended and is
//     made Away, though they pressed in time. The real claim and sweep do
//     the same (supabase/migrations/tests/stress2_concurrency_r2.py
//     take_sweep); this file pins what the closer is told.
//
// A failing test is a finding for the fix agent; once fixed it stays as a
// regression test. Nothing here reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, OFFER_GONE, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const LEAD = "stress2-c2-lead-0000001";
const CLOSER = "closer-c2@stress.invalid";
const SETTER = "setter-c2@stress.invalid";

const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" };

async function settle<T>(ps: Promise<T>[]) {
  const out = await Promise.allSettled(ps);
  return out.map(o => {
    if (o.status === "fulfilled") return { ok: true as const, value: o.value as Row };
    const e = o.reason;
    if (e instanceof ApiRefusal) return { ok: false as const, code: String(e.extra.code ?? ""), message: e.message, status: e.status };
    return { ok: false as const, code: "crash", message: String((e as Error)?.stack ?? e), status: 500 };
  });
}

function setup() {
  const w = fakeWorld(Date.parse("2026-10-04T08:00:00Z")); // Sunday 11:00 in Kuwait, inside live.hours
  const knobs = { contactMs: 0, sweepInsideRead: false };
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: false, whatsapp_template: false, email: false },
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
      },
    },
    { key: "live", value: { enabled: true, standby: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_availability", [{ email: CLOSER, state: "available", until: new Date(w.clock.now + 3_600_000).toISOString(), via: "cockpit" }]);

  /**
   * The SQL sweep's L1 as 20261004a writes it (fix round 2): an offer whose
   * offer_until passed more than the claim's 30 s p_at window ago is expired
   * (no_rep), and everyone it went to who is not in declined_by, is
   * Available and holds no live call is made Away (missed_offer).
   */
  function sweepL1() {
    const now = w.clock.now;
    for (const l of w.db.t("cockpit_sales_live")) {
      if (l.state !== "offered" || Date.parse(String(l.offer_until)) + 30 * S > now) continue;
      Object.assign(l, { state: "expired", end_reason: "no_rep", version: Number(l.version) + 1 });
      for (const a of w.db.t("cockpit_sales_availability")) {
        const email = String(a.email);
        if (!(l.offered_to as string[]).includes(email) || ((l.declined_by as string[]) ?? []).includes(email)) continue;
        if (a.state !== "available") continue;
        if (w.db.t("cockpit_sales_live").some(y => y.claimed_by === email && ["claimed", "room_ready", "lead_joined"].includes(String(y.state)))) continue;
        Object.assign(a, { state: "away", until: null, via: "sweep", reason: "missed_offer" });
      }
    }
  }

  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) {
      // HighLevel answering in seconds, and the minute's sweep running meanwhile.
      w.clock.now += knobs.contactMs;
      if (knobs.sweepInsideRead) sweepL1();
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: [], country: "KW" } };
    }
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async () => undefined,
    markAppointment: async () => ({}),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  function offer(to: string[], untilMs: number): string {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_live", [
      {
        id,
        request_id: fakeUuid(),
        contact_id: LEAD,
        asked_by: SETTER,
        kind: "demo",
        reason: "on_call",
        state: "offered",
        version: 1,
        reoffers: 0,
        offered_to: to,
        declined_by: [],
        offer_until: new Date(w.clock.now + untilMs).toISOString(),
      },
    ]);
    return id;
  }
  const live = (id: string) => w.db.t("cockpit_sales_live").find(r => r.id === id) as Row;
  const seat = (email: string) => w.db.t("cockpit_sales_availability").find(a => a.email === email) as Row;
  return { ...w, rooms, knobs, offer, live, seat };
}

describe("a Take pressed in time, with the minute's sweep inside HighLevel's contact read", () => {
  test("control (fix round 1, held): no sweep in between, the claim runs 4 s after the end: the closer holds the lead", async () => {
    const w = setup();
    const id = w.offer([CLOSER], 8 * S);
    w.knobs.contactMs = 12 * S;
    const [out] = await settle([w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() })]);
    await w.flush();
    expect(w.live(id).claimed_by ?? null).toBe(CLOSER);
    expect(out?.ok).toBe(true);
  });

  test("take-in-time-lost-when-sweep-runs-during-read: Take pressed with 8 s left; HighLevel takes 12 s and the sweep's L1 runs 4 s after the end, inside that read; the press was in time, so the closer holds the lead, is never told the offer ended, and is never made Away for a missed offer", async () => {
    const w = setup();
    const id = w.offer([CLOSER], 8 * S);
    w.knobs.contactMs = 12 * S;
    w.knobs.sweepInsideRead = true;
    const [out] = await settle([w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() })]);
    await w.flush();
    expect({
      claimed_by: w.live(id).claimed_by ?? null,
      answer: out?.ok ? "ok" : (out as { message: string }).message,
      seat: [w.seat(CLOSER).state, w.seat(CLOSER).reason ?? null],
    }).toEqual({ claimed_by: CLOSER, answer: "ok", seat: ["available", null] });
    // Before fix round 2: "This offer has ended." and Away with reason missed_offer.
    expect(out && !out.ok ? out.message : "").not.toBe(OFFER_GONE);
  });

  test("control (fix round 2): an offer nobody took is still ended by the sweep once its 30 s grace is over", async () => {
    const w = setup();
    const id = w.offer([CLOSER], 8 * S);
    w.clock.now += 8 * S + 31 * S;
    w.knobs.contactMs = 0;
    w.knobs.sweepInsideRead = true;
    const [out] = await settle([w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() })]);
    await w.flush();
    expect(w.live(id).state).toBe("expired");
    expect(out?.ok).toBe(false);
  });
});
