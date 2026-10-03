// bun test apps/sales-cockpit/src/lib/stress_chaos_rooms.test.ts
//
// Chaos round 1 (3 October 2026), the screen's side: when sales-api, the
// sweep's replays or the database fail mid-room, the panel still names the
// state and offers the one right action. The server-side halves of these
// cases are in supabase/functions/sales-api/stress_chaos_rooms.test.ts.
import { describe, expect, mock, test } from "bun:test";
import type { RoomView } from "./rooms";

mock.module("./api", () => ({
  api: async () => ({ ok: true }),
}));

const R = await import("./rooms");
const F = await import("../dev/roomFixtures");

const NOW = Date.parse("2026-10-03T11:12:00.000Z");
const S = 1000;
const MIN = 60 * S;
const iso = (ms: number) => new Date(ms).toISOString();
const room = (over: Partial<RoomView> = {}) => F.baseRoom(NOW, over);
const say = (r: RoomView) => R.sentenceText(R.roomSentence(r, { now: NOW }));

describe("chaos: the panel names the state and the next step", () => {
  test("a room open four minutes with a lead and no link sent and no reason (worker.ready given up, or the send killed) does not just say Room ready.", () => {
    // sales-api never claimed or never finished the link: link_sent_at and
    // refusal are both null, and stay so until the room expires as "the lead
    // did not join". The rep must learn the link has not gone and read it out.
    const r = room({
      created_at: iso(NOW - 4 * MIN),
      host_by: iso(NOW + 11 * MIN),
    });
    const words = say(r);
    expect(words).not.toBe("Room ready.");
    expect(words).toMatch(/K7Q2MX|call\.maharamedia\.com|link/i);
  });

  test("the Meet room closed by I can't let them in, whose Zoom replacement could not be made (the server's answer was an error): the panel offers Try Zoom", () => {
    // room.end landed (cancelled, admit_blocked) and the replacement's create
    // threw: the panel polls the room as closed and shows no button, while
    // the lead is knocking at a closed Meet room.
    const r = room({
      state: "cancelled",
      result: "admit_blocked",
      version: 4,
      link_channels: ["whatsapp_text"],
      link_sent_at: iso(NOW - 3 * MIN),
      first_open_at: iso(NOW - 2 * MIN),
      lead_waiting_at: iso(NOW - MIN),
      ended_at: iso(NOW - 5 * S),
    });
    const { primary } = R.roomActions(r, { now: NOW });
    expect(primary?.key).toBe("retry");
  });
});
