// TIME stress, round 4, the panel's side: a Zoom join that reaches the room
// late (the door stored it during a sales-api outage and the sweep replayed it
// four minutes on). sales-api gives the host five minutes of "That was not the
// lead" from when the room first SHOWED the join (lead_in_seen_at, migration
// 20261003d, roomlogic.ts notLead); the panel decides whether to offer the
// button from the RoomView, which carries only lead_in_at (Zoom's own join
// time). The server halves are in supabase/functions/sales-api/stress_time_r3.test.ts.
//
//     bun test apps/sales-cockpit/src/lib/stress_time_r4.test.ts

import { describe, expect, mock, test } from "bun:test";

mock.module("./api", () => ({ api: async () => ({ ok: true }) }));

const R = await import("./rooms");
const L = await import("../../../../supabase/functions/sales-api/roomlogic.ts");

const S = 1000;
const MIN = 60 * S;
const iso = (t: number) => new Date(t).toISOString();

describe("a Zoom join read four minutes late, and the panel's That was not the lead", () => {
  const ctx = L.roomCtx({
    waits_s: { ...L.DEFAULT_WAITS },
    lengths_min: { intro: 30, demo: 60 },
    count_on_join: false,
  });
  const t0 = Date.parse("2026-10-08T10:00:00.000Z"); // 13:00 Kuwait
  const room = {
    id: "00000000-0000-4000-8000-0000000000r4",
    code: "K7Q2MZ",
    contact_id: "stress-r4-lead-z",
    purpose: "fallback",
    call_kind: "intro",
    provider: "zoom",
    host_email: "setter-r4@stress.invalid",
    state: "host_in",
    version: 4,
    requested_at: iso(t0),
    created_at: iso(t0),
    opened_at: iso(t0 + 5 * S),
    host_in_at: iso(t0 + 30 * S),
    link_sent_at: iso(t0 + 6 * S),
    lead_by: iso(t0 + 6 * S + 10 * MIN),
    ends_at: iso(t0 + 30 * MIN),
    join_url: "https://us06web.zoom.us/j/81000000004?pwd=x",
  } as const;
  // Zoom's join_time 13:02:00; the replay reads it at 13:06:10, and the panel shows The lead is in.
  const joinAt = t0 + 2 * MIN;
  const shownAt = joinAt + 4 * MIN + 10 * S;
  const joined = L.applyRoomEvent(
    room as never,
    { kind: "lead_in", source: "zoom", at: iso(joinAt) },
    shownAt,
    ctx,
  );
  if (!joined.ok)
    throw new Error(`setup: the join was refused (${joined.code})`);
  const view = L.toRoomView(joined.room, {
    short_link: false,
  }) as unknown as Parameters<typeof R.canSayNotLead>[0];

  test("setup: the room shows the lead in, and the server takes the press 80 s after it was shown", () => {
    expect(view.state).toBe("lead_in");
    const press = L.applyRoomEvent(
      joined.room,
      {
        kind: "not_lead",
        actor: { email: room.host_email },
        version: joined.room.version,
      },
      shownAt + 80 * S,
      ctx,
    );
    expect(press.ok).toBe(true);
  });

  test("80 s after the panel first showed the join, the panel still offers That was not the lead", () => {
    expect(R.canSayNotLead(view, shownAt + 80 * S)).toBe(true);
  });

  test("a join shown five minutes after Zoom's own time: the panel offers the button at all", () => {
    const late = L.applyRoomEvent(
      room as never,
      { kind: "lead_in", source: "zoom", at: iso(joinAt) },
      joinAt + 5 * MIN,
      ctx,
    );
    if (!late.ok) throw new Error("setup");
    const v = L.toRoomView(late.room, {
      short_link: false,
    }) as unknown as Parameters<typeof R.canSayNotLead>[0];
    expect(R.canSayNotLead(v, joinAt + 5 * MIN + 10 * S)).toBe(true);
  });

  test("control: a join read at once keeps the button for 280 s and takes it away after", () => {
    const now = L.applyRoomEvent(
      room as never,
      { kind: "lead_in", source: "zoom", at: iso(joinAt) },
      joinAt,
      ctx,
    );
    if (!now.ok) throw new Error("setup");
    const v = L.toRoomView(now.room, {
      short_link: false,
    }) as unknown as Parameters<typeof R.canSayNotLead>[0];
    expect([
      R.canSayNotLead(v, joinAt + 279 * S),
      R.canSayNotLead(v, joinAt + 281 * S),
    ]).toEqual([true, false]);
  });
});
