// bun test supabase/functions/sales-api/stress2_concurrency_rooms.test.ts
//
// Second series, round 1, dimension: concurrency and idempotency. rooms.ts
// on testfakes.ts, where every await is a point another request (or the
// clock) can move in. Each test names the race it stages.
//
//   - a Take (or Not now) that the closer pressed while the offer still
//     showed, landing after the offer's end: HighLevel's contact read for
//     the lead takes a moment, the offer_until passes inside it, and the
//     claim finds nothing to take. Nobody else took the lead, so the closer
//     must never be told "Someone else took this lead."
//
// A failing test is a finding for the fix agent; once fixed it stays as a
// regression test. Nothing here reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, ROOM_COPY } from "./roomlogic.ts";
import { makeRooms, OFFER_GONE, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const LEAD = "stress2-c-lead-0000001";
const CLOSER = "closer@stress.invalid";
const CLOSER2 = "closer2@stress.invalid";
const SETTER = "setter@stress.invalid";

const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" };
const closer2: Who = { signed_in: true, seat: true, manager: false, email: CLOSER2, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer2" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: false, whatsapp_template: false, email: false },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};

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
  const audits: Row[] = [];
  /** How long HighLevel takes to answer the lead's contact read (the clock moves by it). */
  const knobs = { contactMs: 0 };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON } },
    { key: "live", value: { enabled: true, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
    { email: CLOSER2, name: "Omar Closer", role: "closer", ghl_user_id: "G-closer2", active: true },
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
    { email: CLOSER2, zoom_user_id: "Z-closer2", zoom_status: "licensed", google_ok: true },
  ]);
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) {
      // HighLevel answering in seconds, not milliseconds.
      w.clock.now += knobs.contactMs;
      return { contact: { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: [], country: "KW" } };
    }
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({}),
    sendText: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  /** An offer to `to`, ending `untilMs` from now (the strip shows its countdown until then). */
  function offer(to: string[], untilMs: number, extra: Row = {}): string {
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
        ...extra,
      },
    ]);
    return id;
  }
  const live = (id: string) => w.db.t("cockpit_sales_live").find(r => r.id === id) as Row;
  return { ...w, rooms, audits, knobs, offer, live };
}

describe("a Take landing after the offer's end", () => {
  test("take-pressed-in-time-lost-to-contact-read: the closer presses Take with ten seconds left; sales-api reads the lead from HighLevel before it claims, and HighLevel takes twelve (inside liveio.ts GHL_MS, 15 s): the press was in time, so the closer holds the lead", async () => {
    const w = setup();
    const id = w.offer([CLOSER, CLOSER2], 10 * S);
    w.knobs.contactMs = 12 * S;
    const [out] = await settle([w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() })]);
    await w.flush();
    // The only Take, pressed with ten seconds on the offer's own clock.
    expect(w.live(id).claimed_by ?? null).toBe(CLOSER);
    expect(out?.ok).toBe(true);
  });

  test("take-after-offer-end-told-someone-else-took-it: a Take that reaches sales-api after the offer's end (its time ran out, the row still says offered): nobody took the lead, so the closer is told the offer ended, never that someone else took it", async () => {
    // Corrected in fix round 1: a Take pressed in time is now judged at the
    // press (p_at), so the press here lands two seconds after the end.
    const w = setup();
    const id = w.offer([CLOSER, CLOSER2], 1 * S);
    w.clock.now += 2 * S;
    const [out] = await settle([w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() })]);
    await w.flush();
    // Nobody holds the offer: the database says so.
    expect(w.live(id).claimed_by ?? null).toBeNull();
    // The late press is the closer's answer: the sweep's L1 never makes them Away for it.
    expect((w.live(id).declined_by as string[]) ?? []).toContain(CLOSER);
    expect(out?.ok).toBe(false);
    const said = out && !out.ok ? out.message : "";
    // The strip shows the server's sentence as it is ("lost"): this one is not true.
    expect(said).not.toBe(ROOM_COPY.refusals.taken);
    expect(said).toBe(OFFER_GONE);
  });

  test("take-after-offer-end-told-someone-else-took-it (the sweep ended it first): the offer is expired with nobody on it when the press lands; the answer is that the offer ended", async () => {
    const w = setup();
    const id = w.offer([CLOSER], 30 * S);
    // The sweep's L1 ran between the strip's last read and the press.
    Object.assign(w.live(id), { state: "expired", end_reason: "no_rep", offer_until: new Date(w.clock.now - 1 * S).toISOString() });
    const [out] = await settle([w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() })]);
    expect(out?.ok).toBe(false);
    const said = out && !out.ok ? out.message : "";
    expect(said).not.toBe(ROOM_COPY.refusals.taken);
    expect(said).toBe(OFFER_GONE);
  });

  test("late-not-now-read-as-miss: Not now lands a second after the offer's end, before the sweep has moved it (it still says offered): the closer's answer is recorded, so the sweep's L1 does not make them Away for a miss", async () => {
    const w = setup();
    const id = w.offer([CLOSER, CLOSER2], 1 * S);
    // The press left the closer's phone with a second to go; it lands a second late.
    w.clock.now += 2 * S;
    const [out] = await settle([w.rooms.actions["live.decline"]!(closer, { live_id: id, request_id: crypto.randomUUID() })]);
    // The row is still offered (L1 runs once a minute): Not now can still be written.
    expect(w.live(id).state).toBe("offered");
    // L1 makes Away everyone it went to who is not in declined_by.
    expect((w.live(id).declined_by as string[]) ?? []).toContain(CLOSER);
    expect(out?.ok).toBe(true);
  });

  test("control: another closer's Take landed first: 'Someone else took this lead.' is the true answer", async () => {
    const w = setup();
    const id = w.offer([CLOSER, CLOSER2], 60 * S);
    const outs = await settle([
      w.rooms.actions["live.take"]!(closer2, { live_id: id, request_id: crypto.randomUUID() }),
      w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() }),
    ]);
    await w.flush();
    expect(w.live(id).claimed_by).toBe(CLOSER2);
    const lost = outs.find(o => !o.ok);
    expect(lost && !lost.ok ? lost.message : "").toBe(ROOM_COPY.refusals.taken);
  });
});
