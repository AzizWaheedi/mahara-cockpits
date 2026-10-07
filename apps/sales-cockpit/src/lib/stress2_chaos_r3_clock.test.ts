// CHAOS stress, second series, round 3: a browser clock that is not the
// server's. The room panel and the banner add the server's offset (live.status
// and room.status carry `now`) to every countdown and gate; the Team page's
// Video rooms card (RoomsHealth.tsx) reads the jobs' report times against the
// browser's own clock (useNow), though the live.status feed it already reads
// carries the offset.
//
//     bun test apps/sales-cockpit/src/lib/stress2_chaos_r3_clock.test.ts

import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

// The Supabase client needs the build's settings; nothing here reaches it.
mock.module("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));

const { roomJobLines, roomsSummary } = await import("./roomsHealth");

const S = 1000;
const MIN = 60 * S;

describe("chaos2 r3: the Team page on a laptop whose clock runs fast", () => {
  // The server's moment, and the room worker's report 10 s before it (it reports every 25 s).
  const server = Date.parse("2026-10-04T08:00:00.000Z");
  const rows = [
    {
      worker: "sales-desk",
      job: "rooms",
      ok: true,
      detail: "Working.",
      at: new Date(server - 10 * S).toISOString(),
    },
    {
      worker: "sales-desk",
      job: "room-hosts",
      ok: true,
      detail: "Checked.",
      at: new Date(server - 4 * MIN).toISOString(),
    },
    {
      worker: "sales-api",
      job: "sweep",
      ok: true,
      detail: "Swept.",
      at: new Date(server - 20 * S).toISOString(),
    },
    {
      worker: "sales-api",
      job: "watchdog",
      ok: true,
      detail: "Watched.",
      at: new Date(server - 2 * MIN).toISOString(),
    },
  ];
  const health = {
    worker_ok: true,
    last_run_at: rows[0]!.at,
    rooms_today: 3,
    failed_today: 0,
    line: "Rooms: working.",
  };

  test("HELD: on the server's clock, the room worker that reported 10 s ago reads as working", () => {
    const lines = roomJobLines(rows as never, server, true);
    expect(lines.find(l => l.key === "sales-desk:rooms")?.tone).toBe("good");
    expect(roomsSummary(health as never, lines).tone).toBe("good");
  });

  test("team-page-job-lines-read-browser-clock: the manager's laptop runs 3 minutes fast: the card must read the jobs on the server's clock (live.status's offset), never call a working worker late", () => {
    const src = readFileSync(
      new URL("../components/RoomsHealth.tsx", import.meta.url),
      "utf8",
    );
    // What the card passes as `now` to roomJobLines today: the browser's clock.
    const usesOffset =
      /useNow\([^)]*\)\s*\+\s*[^;]*offset/.test(src) ||
      /roomJobLines\([^)]*offset/.test(src);
    const browser = server + 3 * MIN;
    const lines = roomJobLines(
      rows as never,
      usesOffset ? server : browser,
      true,
    );
    const worker = lines.find(l => l.key === "sales-desk:rooms");
    expect(
      {
        tone: worker?.tone,
        summary: roomsSummary(health as never, lines).tone,
      },
      `the card says: "${worker?.text}" / "${roomsSummary(health as never, lines).sentence}"`,
    ).toEqual({ tone: "good", summary: "good" });
  });
});

describe("chaos2 r3: the room panel's call-back on a laptop whose clock runs slow or fast", () => {
  test("panel-callback-reads-browser-clock: the lead opens the link while the rep is in another tab: the call-back sentence is the panel's own (server clock), whatever the laptop's clock says", async () => {
    const R = await import("./rooms");
    const F = await import("../dev/roomFixtures");
    const server = Date.parse("2026-10-04T08:00:00.000Z");
    const room = F.baseRoom(server - 3 * MIN, {
      state: "host_in",
      provider: "meet",
      version: 5,
      link_channels: ["whatsapp_text"],
      link_sent_at: new Date(server - 2 * MIN).toISOString(),
      lead_by: new Date(server + 8 * MIN).toISOString(),
      host_in_at: new Date(server - 90 * S).toISOString(),
      first_open_at: new Date(server - 5 * S).toISOString(),
      last_open_at: new Date(server - 5 * S).toISOString(),
      open_device: "phone",
    } as never);
    // The panel's moment on the server's clock: the lead is at the door.
    const moment = R.momentFor(room, { now: server });
    expect(R.CALL_BACK.has(moment)).toBe(true);
    const panel = R.sentenceText(R.bannerRoomSentence(room, server), true);
    // RoomPanel.tsx says it with Date.now(): the laptop runs 15 minutes fast.
    const src = readFileSync(
      new URL("../components/RoomPanel.tsx", import.meta.url),
      "utf8",
    );
    const raw =
      /alertWhileHidden\([\s\S]{0,200}bannerRoomSentence\(room, Date\.now\(\)\)/.test(
        src,
      );
    const said = R.sentenceText(
      R.bannerRoomSentence(room, raw ? server + 15 * MIN : server),
      true,
    );
    expect(said, `server: "${panel}" / laptop: "${said}"`).toBe(panel);
  });
});
