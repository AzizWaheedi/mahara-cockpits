// bun test supabase/functions/sales-live
import { describe, expect, test } from "bun:test";
import { CRON_FORWARD, CRON_KINDS, cronForwardable, REPLAY_MAX } from "./cron.ts";

const ID1 = "0b6f2d1e-4c3a-4f7e-9a51-2d8c6b0e7f11";
const ID2 = "5e9a7c3b-1d2f-4a6e-8b40-7f1c2e3d4a52";

describe("the cron door's allow-list", () => {
  test("passes on the sweep's replays and thread.tick only, rebuilt from the checked fields", () => {
    expect([...CRON_FORWARD].sort()).toEqual(["room.event", "thread.tick"]);
    expect(
      cronForwardable({
        action: "room.event",
        kind: "sweep.replay",
        room_id: "r1",
        source: "zoom",
        payload: { event_ids: [ID1, ID2.toUpperCase(), ID1], event: "meeting.participant_joined" },
      }),
    ).toEqual({
      ok: true,
      body: { action: "room.event", kind: "sweep.replay", payload: { event_ids: [ID1, ID2] } },
    });
    expect(cronForwardable({ action: "thread.tick", payload: { anything: 1 } })).toEqual({
      ok: true,
      body: { action: "thread.tick" },
    });
  });

  test("the sweep's settle and tick pass on as their room ids only (contract-v2 S4)", () => {
    expect(Object.keys(CRON_KINDS).sort()).toEqual(["sweep.replay", "sweep.settle", "tick"]);
    for (const kind of ["sweep.settle", "tick"]) {
      expect(
        cronForwardable({
          action: "room.event",
          kind,
          room_id: "r1",
          payload: { room_ids: [ID1, ID2.toUpperCase(), ID1], event_ids: [ID2], pending_events: 3 },
        }),
      ).toEqual({ ok: true, body: { action: "room.event", kind, payload: { room_ids: [ID1, ID2] } } });
      // A settle or tick carries room ids, never event ids.
      expect(cronForwardable({ action: "room.event", kind, payload: { event_ids: [ID1] } })).toMatchObject({ ok: false, status: 400 });
      for (const room_ids of [undefined, null, [], "x", [ID1, "room-1"], [ID1, 7], Array.from({ length: 51 }, () => ID1)])
        expect(cronForwardable({ action: "room.event", kind, payload: { room_ids } })).toMatchObject({ ok: false, status: 400 });
      expect(cronForwardable({ action: "room.event", kind, payload: { room_ids: Array.from({ length: 50 }, () => ID1) } }).ok).toBe(true);
    }
    // A replay carries event ids, never room ids.
    expect(cronForwardable({ action: "room.event", kind: "sweep.replay", payload: { room_ids: [ID1] } })).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  test("a room.event of any other kind is refused: the cron secret cannot stand in for Zoom's signature", () => {
    for (const kind of ["zoom.meeting.participant_joined", "zoom.meeting.started", "worker.ready", "worker.failed", "live.claimed", "room.settle", "toString", "constructor", "lead_in", "", undefined]) {
      const out = cronForwardable({ action: "room.event", kind, room_id: "room-1", payload: { event_ids: [ID1] } });
      expect([kind, out.ok, out.ok ? 0 : out.status]).toEqual([kind, false, 403]);
    }
  });

  test("a replay needs 1 to 50 event ids, each a UUID", () => {
    expect(REPLAY_MAX).toBe(50);
    for (const event_ids of [undefined, null, [], "x", [ID1, "room-1"], [ID1, 7], Array.from({ length: 51 }, () => ID1)])
      expect(cronForwardable({ action: "room.event", kind: "sweep.replay", payload: { event_ids } })).toMatchObject({
        ok: false,
        status: 400,
      });
    expect(cronForwardable({ action: "room.event", kind: "sweep.replay" })).toMatchObject({ ok: false, status: 400 });
    expect(
      cronForwardable({ action: "room.event", kind: "sweep.replay", payload: { event_ids: Array.from({ length: 50 }, () => ID1) } }).ok,
    ).toBe(true);
  });

  test("refuses every other sales-api action, desk and seat alike", () => {
    for (const action of [
      "contract.sync",
      "live.press",
      "reply.seen",
      "room.settle",
      "followup.autosend",
      "dial.resync_stuck",
      "room.create",
      "room.open",
      "",
    ]) {
      const out = cronForwardable({ action, kind: "sweep.replay", payload: { event_ids: [ID1] } });
      expect([action, out.ok]).toEqual([action, false]);
      if (!out.ok) expect(out.status).toBe(403);
    }
  });

  test("a body that is not an object is refused", () => {
    expect(cronForwardable(null)).toMatchObject({ ok: false, status: 400 });
    expect(cronForwardable([{ action: "room.event" }])).toMatchObject({ ok: false, status: 400 });
    expect(cronForwardable("room.event")).toMatchObject({ ok: false, status: 400 });
  });
});
