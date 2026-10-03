// bun test supabase/functions/sales-live
import { describe, expect, test } from "bun:test";
import { CRON_FORWARD, cronForwardable } from "./cron.ts";

describe("the cron door's allow-list", () => {
  test("passes on room.event replays and thread.tick only", () => {
    expect([...CRON_FORWARD].sort()).toEqual(["room.event", "thread.tick"]);
    expect(cronForwardable({ action: "room.event", kind: "sweep.replay", room_id: "r1" })).toEqual({
      ok: true,
      body: { action: "room.event", kind: "sweep.replay", room_id: "r1" },
    });
    expect(cronForwardable({ action: "thread.tick" }).ok).toBe(true);
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
      const out = cronForwardable({ action, kind: "x" });
      expect([action, out.ok]).toEqual([action, false]);
      if (!out.ok) expect(out.status).toBe(403);
    }
  });

  test("a room.event needs a sane kind", () => {
    expect(cronForwardable({ action: "room.event" })).toMatchObject({ ok: false, status: 400 });
    expect(cronForwardable({ action: "room.event", kind: "DROP TABLE" })).toMatchObject({ ok: false, status: 400 });
    expect(cronForwardable({ action: "room.event", kind: "zoom.meeting.participant_joined" }).ok).toBe(true);
  });

  test("a body that is not an object is refused", () => {
    expect(cronForwardable(null)).toMatchObject({ ok: false, status: 400 });
    expect(cronForwardable([{ action: "room.event" }])).toMatchObject({ ok: false, status: 400 });
    expect(cronForwardable("room.event")).toMatchObject({ ok: false, status: 400 });
  });
});
