// bun test src/lib/stress_security_rooms_ui.test.ts  (from apps/sales-cockpit)
//
// Security stress of the cockpit's room screens' data layer, round 1,
// 3 October 2026: a tampered or hostile sales-api answer never gives a
// screen a script link, never carries a host link into a room the screens
// keep, and the host link only ever comes back from room.open. The screens
// draw every string as React text (no dangerouslySetInnerHTML anywhere in
// src), so these normalizers are the gate.

import { describe, expect, mock, test } from "bun:test";

let answer: (action: string) => unknown = () => ({});
mock.module("./api", () => ({
  api: async (action: string) => answer(action),
}));

const R = await import("./rooms");

const base = {
  id: "00000000-0000-4000-8000-000000000001",
  code: "K7Q2MX",
  state: "open",
  version: 2,
  provider: "zoom",
  purpose: "manual",
  call_kind: "intro",
  host_email: "stress-host@stress.invalid",
};

describe("security: hostile room answers", () => {
  test("a join or short link that is not http(s) is dropped, so no button or copy ever holds a script URL", () => {
    for (const bad of [
      "javascript:alert(document.cookie)",
      " javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "https://zoom.us/j/1 onmouseover=alert(1)",
    ]) {
      const room = R.normalizeRoom({ ...base, join_url: bad, short_url: bad });
      expect([bad, room?.join_url ?? null, room?.short_url ?? null]).toEqual([
        bad,
        null,
        null,
      ]);
      expect(R.shortLink(room!)).toBeNull();
    }
  });

  test("a start_url or zak a tampered answer slips into a room is never kept on the room the screens hold", () => {
    const room = R.normalizeRoom({
      ...base,
      join_url: "https://us06web.zoom.us/j/1?pwd=x",
      start_url: "https://us06web.zoom.us/s/1?zak=HOST",
      zak: "HOST",
      host_link: "https://us06web.zoom.us/s/1?zak=HOST",
    });
    expect(JSON.stringify(room)).not.toContain("zak");
    expect(Object.keys(room ?? {})).not.toContain("start_url");
  });

  test("room.open's answer is used only when it is a web link; anything else is a refusal, never a navigation", async () => {
    for (const start_url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "",
      null,
      42,
    ]) {
      answer = () => ({ start_url });
      await expect(
        R.roomsApi.open("00000000-0000-4000-8000-000000000001"),
      ).rejects.toBeTruthy();
    }
    answer = () => ({ start_url: "https://us06web.zoom.us/s/1?zak=HOST" });
    expect(
      (await R.roomsApi.open("00000000-0000-4000-8000-000000000001")).start_url,
    ).toMatch(/^https:\/\//);
  });

  test("timeline lines with markup stay plain strings; an event without text is dropped, never drawn as markup", () => {
    const feed = R.normalizeRoomFeed({
      room: base,
      events: [
        {
          at: "2026-10-03T11:00:00Z",
          kind: "zoom.x",
          source: "zoom",
          text: "<img src=x onerror=alert(1)> joined",
        },
        {
          at: "2026-10-03T11:00:01Z",
          kind: "zoom.y",
          source: "zoom",
          text: { __html: "<b>x</b>" },
        },
      ],
    });
    expect(feed.events.map(e => typeof e.text)).toEqual(["string"]);
  });
});
