// bun test supabase/functions/sales-api/roomlogic.api.test.ts
// The integration lane's roomlogic changes (contract v2): S2 (ready on a room
// the worker opened claims the link), S1 (owner sql: the tick moves no
// state), the cancel-during-creating version rule, the settle rule for
// booked intros, and the six new RoomView keys.
import { describe, expect, test } from "bun:test";
import {
  applyRoomEvent,
  type Applied,
  type Changed,
  DEFAULT_WAITS,
  newRoomRow,
  ROOM_VIEW_KEYS,
  type RoomEvent,
  type RoomRow,
  roomCtx,
  settleDue,
  settleWanted,
  sweepRoom,
  toRoomView,
} from "./roomlogic.ts";

const S = 1000;
const MIN = 60 * S;
const T0 = Date.parse("2026-10-04T07:00:00Z");
const W = DEFAULT_WAITS;
const ctx = roomCtx(null);
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const at = (t: number) => new Date(t).toISOString();

function room(over: Partial<RoomRow> = {}): RoomRow {
  return {
    ...newRoomRow({
      id: "11111111-1111-4111-8111-111111111111",
      request_id: "22222222-2222-4222-8222-222222222222",
      code: "K7Q2MX",
      contact_id: "lead-1",
      purpose: "manual",
      call_kind: "intro",
      provider: "meet",
      host_email: "setter@maharamedia.com",
      made_by: "setter@maharamedia.com",
      now: T0,
    }),
    ...over,
  };
}
function ok(a: Applied): Changed {
  if (!a.ok) throw new Error(`refused: ${a.code}`);
  return a;
}
const apply = (r: RoomRow, e: RoomEvent, t: number) => applyRoomEvent(r, e, t, ctx);

/** What lc-worker writes when it opens a room itself (contract v2 section 7, step 5). */
function workerOpened(over: Partial<RoomRow> = {}): RoomRow {
  return room({
    state: "open",
    version: 3,
    claimed_at: at(T0 + S),
    opened_at: at(T0 + 4 * S),
    join_url: MEET_URL,
    provider_meeting_id: "evt-1",
    host_by: at(T0 + 4 * S + W.fallback_host * S),
    ends_at: at(T0 + 4 * S + 30 * MIN),
    worker_run: "run-1",
    ...over,
  });
}

describe("S2: worker.ready on a room the worker opened", () => {
  test("claims the link and fills only lead_by; never touches what the worker set; the version stays", () => {
    const r = workerOpened();
    const a = ok(apply(r, { kind: "ready" }, T0 + 5 * S));
    expect(a.changed).toBe(true);
    expect(a.effects).toEqual([{ kind: "send_link" }]);
    expect(a.patch).toEqual({ lead_by: at(T0 + 5 * S + W.lead * S), link_claimed_at: at(T0 + 5 * S) });
    expect(a.expect).toEqual({ state: "open", lead_by: null, link_claimed_at: null });
    expect(a.room.version).toBe(3);
  });

  test("a repeat asks for nothing (the claim is taken); a standby room gets no link", () => {
    const first = ok(apply(workerOpened(), { kind: "ready" }, T0 + 5 * S)).room;
    const again = ok(apply(first, { kind: "ready" }, T0 + 9 * S));
    expect([again.changed, again.effects]).toEqual([false, []]);
    const standby = ok(apply(workerOpened({ contact_id: null, purpose: "standby" }), { kind: "ready" }, T0 + 5 * S));
    expect([standby.changed, standby.effects]).toEqual([false, []]);
  });

  test("a handover the host is not in yet waits (send_on host_in); the host's join then claims it", () => {
    const r = workerOpened({ purpose: "handover", send_on: "host_in" });
    const a = ok(apply(r, { kind: "ready" }, T0 + 5 * S));
    expect(a.effects).toEqual([]);
    const inn = ok(apply(a.room, { kind: "host_in", source: "zoom" }, T0 + 20 * S));
    expect(inn.effects).toEqual([{ kind: "send_link" }]);
  });

  test("a link already sent (the rep's email first) is never asked for again", () => {
    const r = workerOpened({ link_sent_at: at(T0 + 4 * S), lead_by: at(T0 + 4 * S + W.lead * S) });
    const a = ok(apply(r, { kind: "ready" }, T0 + 5 * S));
    expect([a.changed, a.effects]).toEqual([false, []]);
  });

  test("a different meeting for the open room is still refused with cleanup", () => {
    const a = apply(workerOpened(), { kind: "ready", join_url: "https://meet.google.com/zzz-zzzz-zzz" }, T0 + 5 * S);
    expect(a.ok ? null : [a.code, a.cleanup]).toEqual(["already_open", true]);
  });
});

describe("S1: owner sql", () => {
  test("no timer moves a state under owner sql, whatever is due", () => {
    const cases: RoomRow[] = [
      room({ state: "requested" }),
      room({ state: "creating", claimed_at: at(T0) }),
      workerOpened(),
      workerOpened({ state: "host_in", host_in_at: at(T0 + 10 * S), lead_by: at(T0 + MIN) }),
      workerOpened({ state: "lead_in", lead_in_at: at(T0 + MIN) }),
      workerOpened({ contact_id: null, purpose: "standby" }),
    ];
    for (const r of cases) {
      const a = ok(sweepRoom(r, T0 + 6 * 3_600_000, ctx, null, { owner: "sql", available_until: null }));
      expect([r.state, a.changed]).toEqual([r.state, false]);
    }
    // Without the owner, the reference model still fires.
    expect(ok(sweepRoom(workerOpened(), T0 + 6 * 3_600_000, ctx)).to).toBe("expired");
  });

  test("the re-asks and alerts still come back: an unsent claimed link, a lead in as a booked call nears", () => {
    const claimed = workerOpened({ link_claimed_at: at(T0 + 5 * S), lead_by: at(T0 + 5 * S + W.lead * S) });
    expect(ok(sweepRoom(claimed, T0 + 70 * S, ctx, null, { owner: "sql" })).effects).toEqual([{ kind: "send_link", retry: true }]);
    const leadIn = workerOpened({ state: "lead_in", lead_in_at: at(T0 + MIN) });
    const near = T0 + 10 * MIN;
    const fx = ok(sweepRoom(leadIn, near, ctx, near + 5 * MIN, { owner: "sql" })).effects;
    expect(fx.map(e => e.kind)).toEqual(["alert"]);
  });
});

describe("cancel while the worker has only claimed the room (lc-worker finding 23)", () => {
  test("a press one version behind a creating room still ends it; two behind, or another press, is stale", () => {
    const c = room({ state: "creating", version: 2, claimed_at: at(T0) });
    const actor = { email: "setter@maharamedia.com" };
    expect(ok(apply(c, { kind: "end", reason: "cancel", actor, version: 1 }, T0 + S)).to).toBe("cancelled");
    const two = apply({ ...c, version: 3 }, { kind: "end", reason: "cancel", actor, version: 1 }, T0 + S);
    expect(two.ok ? null : two.code).toBe("stale");
    const open = apply(workerOpened(), { kind: "end", reason: "cancel", actor, version: 2 }, T0 + S);
    expect(open.ok ? null : open.code).toBe("stale");
    const mark = apply(c, { kind: "host_in", source: "mark", actor, version: 1 }, T0 + S);
    expect(mark.ok ? null : mark.code).toBe("stale");
  });
});

describe("settleWanted: what sweep.settle settles", () => {
  const start = T0;
  // A booked Zoom call whose join events were all read: Zoom would have said if the lead came.
  const expiredBooked = room({ purpose: "booked", provider: "zoom", appointment_id: "a1", state: "expired", result: "no_join", ended_at: at(T0 + 20 * MIN) });
  const read = { zoom_unclear: false };
  test("a booked intro that expired with no lead is due at start + settle; never before, never once marked", () => {
    expect(settleWanted(expiredBooked, at(start), false, start + W.settle * S - 1, W, read)).toBe(false);
    expect(settleWanted(expiredBooked, at(start), false, start + W.settle * S, W, read)).toBe(true);
    // Unread Zoom events, or a booked Meet call (no join signal at all): a person marks it.
    expect(settleWanted(expiredBooked, at(start), false, start + W.settle * S, W)).toBe(false);
    expect(settleWanted({ ...expiredBooked, provider: "meet" }, at(start), false, start + W.settle * S, W, { ...read, short_link: true })).toBe(false);
    expect(settleWanted(expiredBooked, at(start), true, start + W.settle * S, W)).toBe(false);
    expect(settleWanted({ ...expiredBooked, settled_mark: "noshow" }, at(start), false, start + 2 * W.settle * S, W)).toBe(false);
    expect(settleWanted({ ...expiredBooked, call_kind: "demo" }, at(start), false, start + 2 * W.settle * S, W)).toBe(false);
    expect(settleWanted({ ...expiredBooked, lead_in_at: at(T0) }, at(start), false, start + 2 * W.settle * S, W)).toBe(false);
    expect(settleWanted({ ...expiredBooked, result: "admit_blocked" }, at(start), false, start + 2 * W.settle * S, W)).toBe(false);
  });
  test("a fallback room for a booked intro follows settleDue", () => {
    const fb = { ...expiredBooked, purpose: "fallback" as const };
    expect(settleWanted(fb, at(start), false, start + W.settle * S, W, read)).toBe(settleDue(fb, at(start), false, start + W.settle * S, W, read));
    expect(settleWanted(fb, at(start), false, start + W.settle * S, W, read)).toBe(true);
    expect(settleWanted({ ...fb, result: "admit_blocked" }, at(start), false, start + W.settle * S, W)).toBe(false);
  });
});

describe("RoomView gains six keys (contract v2 section 3)", () => {
  test("link_unconfirmed_at, trigger, attempt_id, appointment_id, handover_id and starts_at, never start_url", () => {
    const v = toRoomView(
      workerOpened({
        trigger: "no_answer",
        attempt_id: "33333333-3333-4333-8333-333333333333",
        appointment_id: "appt-1",
        link_unconfirmed_at: at(T0 + MIN),
        refusal: "Nothing could go.",
      }),
      { short_link: true, starts_at: at(T0 - 5 * MIN) },
    );
    expect(Object.keys(v).sort()).toEqual([...ROOM_VIEW_KEYS].sort());
    expect(v).toMatchObject({
      trigger: "no_answer",
      attempt_id: "33333333-3333-4333-8333-333333333333",
      appointment_id: "appt-1",
      handover_id: null,
      link_unconfirmed_at: at(T0 + MIN),
      starts_at: at(T0 - 5 * MIN),
      refusal: "Nothing could go.",
      short_url: "https://call.maharamedia.com/K7Q2MX",
    });
    expect(toRoomView(workerOpened({ trigger: "nonsense" }), { short_link: false }).trigger).toBeNull();
    expect(JSON.stringify(v)).not.toContain("start_url");
  });
});
