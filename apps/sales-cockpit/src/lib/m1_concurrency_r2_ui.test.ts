// bun test apps/sales-cockpit/src/lib/m1_concurrency_r2_ui.test.ts
//
// Milestone 1 (the video link when a call fails), round 2, angle:
// concurrency and idempotency, the cockpit's half: the request id a press
// carries (lib/rooms.ts once) and what the panel does with room.end's answer
// after "I can't let them in" (afterAdmitBlocked). sales-api is replaced by
// a small fake that keeps the server's own rules for these calls (rooms.ts
// createPrep: a request id already used answers its room as it stands;
// roomEnd: an admit_blocked press on a room already closed by another press
// or the sweep answers the room with neither a replacement nor a refusal).
//
// A failing test is a finding. Every lead and seat is invented.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ApiError } from "./apiErrors";
import type { RoomView } from "./rooms";

type Call = { action: string; body: Record<string, unknown> };
const calls: Call[] = [];
let answer: (c: Call) => Promise<unknown> = async () => ({ ok: true });
mock.module("./api", () => ({
  api: (action: string, body: Record<string, unknown> = {}) => {
    const c = { action, body };
    calls.push(c);
    return answer(c);
  },
}));

const R = await import("./rooms");
const F = await import("../dev/roomFixtures");

/** 14:12:00 in Kuwait on 8 October 2026. */
const NOW = Date.parse("2026-10-08T11:12:00.000Z");
const S = 1000;

beforeEach(() => {
  calls.length = 0;
  answer = async () => ({ ok: true });
  R.forgetRequests();
});
afterEach(() => R.forgetRequests());

/** sales-api's room.create and room.end for one lead, by the server's rules. */
function fakeServer() {
  const byRequest = new Map<string, RoomView>();
  let n = 0;
  let loseNextAnswer = false;
  const server = async (c: Call): Promise<unknown> => {
    if (c.action === "room.create") {
      const rid = String(c.body.request_id);
      const repeat = byRequest.get(rid);
      // createPrep: the same request again is answered by its room, as it stands.
      if (repeat) return { ok: true, room: repeat };
      const live = [...byRequest.values()].find(
        r => !["ended", "expired", "failed", "cancelled"].includes(r.state),
      );
      if (live)
        throw new ApiError(
          "This lead already has a room open.",
          "refused",
          409,
          "lead_has_room",
        );
      n += 1;
      const room = F.baseRoom(NOW, {
        id: `room-${n}`,
        code: `K7Q2M${n}`,
        contact_id: "stress-m1c2-lead",
        purpose: "fallback",
        provider: String(c.body.provider) as RoomView["provider"],
        state: "open",
        version: 3,
        link_channels: ["email"],
        link_sent_at: new Date(NOW).toISOString(),
      });
      byRequest.set(rid, room);
      if (loseNextAnswer) {
        loseNextAnswer = false;
        // The room was made and its link went; the answer never arrived.
        throw new ApiError(
          "The cockpit could not reach its server. Check the connection and try again.",
          "network",
        );
      }
      return { ok: true, room };
    }
    if (c.action === "room.end") {
      const room = [...byRequest.values()].find(r => r.id === c.body.room_id);
      if (!room)
        throw new ApiError("This room has closed.", "refused", 409, "final");
      if (!["ended", "expired", "failed", "cancelled"].includes(room.state)) {
        room.state = "cancelled";
        room.result =
          c.body.reason === "on_phone" ? "moved_to_phone" : "cancelled";
        room.version += 1;
      }
      return { ok: true, room };
    }
    return { ok: true };
  };
  return {
    server,
    loseNext: () => {
      loseNextAnswer = true;
    },
  };
}

const ask = {
  contact_id: "stress-m1c2-lead",
  provider: "meet" as const,
  call_kind: "intro" as const,
  purpose: "fallback" as const,
  trigger: "no_answer",
};

describe("m1 concurrency r2 (cockpit): Send a video link again after the room it made was ended", () => {
  test("HELD (control): a press whose answer was lost, pressed again, gets the room it made (one room, the same request id)", async () => {
    const s = fakeServer();
    answer = s.server;
    s.loseNext();
    await expect(R.roomsApi.create(ask)).rejects.toThrow();
    const again = await R.roomsApi.create(ask);
    const ids = calls
      .filter(c => c.action === "room.create")
      .map(c => c.body.request_id);
    expect(ids[0]).toBe(ids[1]);
    expect(again.room.state).toBe("open");
  });

  test("create-retry-id-returns-ended-room: the first press's answer was lost (its room was made and its link went); the banner shows that room and the setter presses We are on the phone on it (the lead called back); the call drops and Send a video link a minute later must make a new room, never answer the room that was ended", async () => {
    const s = fakeServer();
    answer = s.server;
    s.loseNext();
    await expect(R.roomsApi.create(ask)).rejects.toThrow();
    // The banner's live.status shows the room the lost answer made; the
    // setter ends it from its panel.
    const made = calls.filter(c => c.action === "room.create").length;
    expect(made).toBe(1);
    await R.roomsApi.end({ id: "room-1", version: 3 }, "on_phone");
    // A minute later: the call dropped again, Send a video link (Meet).
    const again = await R.roomsApi.create(ask);
    const ids = calls
      .filter(c => c.action === "room.create")
      .map(c => c.body.request_id);
    expect({
      second_press_carries_first_id: ids[0] === ids[1],
      answered_room_state: again.room.state,
    }).toEqual({
      second_press_carries_first_id: false,
      answered_room_state: "open",
    });
  });
});

describe("m1 concurrency r2 (cockpit): the panel's step after I can't let them in", () => {
  // Round 2's fix: sales-api answers a closed room with its reason
  // (replacement_refusal), and an answer with neither is said, never read as
  // "make the Zoom room yourself" (a plain room with no "moved" words and no
  // night rule cleared, to a lead who may be on the phone).
  test("admit-blocked-on-closed-room-answers-neither (the panel half): an answer with neither a replacement nor a refusal is said as a closed room, never a room the panel makes", () => {
    const closed = F.baseRoom(NOW, {
      state: "cancelled",
      result: "moved_to_phone",
      version: 4,
      ended_at: new Date(NOW - S).toISOString(),
    });
    const out = R.endAnswer({ ok: true, room: closed });
    expect(R.afterAdmitBlocked(out)).toEqual({
      kind: "refused",
      text: R.ADMIT_NO_ANSWER,
    });
  });

  test("the server's reason for a closed room is shown as it is", () => {
    const closed = F.baseRoom(NOW, {
      state: "cancelled",
      result: "moved_to_phone",
      version: 4,
      ended_at: new Date(NOW - S).toISOString(),
    });
    const out = R.endAnswer({
      ok: true,
      room: closed,
      replacement_refusal:
        "This room was closed: you are on the phone with the lead. No new room was made.",
    });
    expect(R.afterAdmitBlocked(out)).toEqual({
      kind: "refused",
      text: "This room was closed: you are on the phone with the lead. No new room was made.",
    });
  });
});
