// TIME stress, second series, round 1: the waves card's "Next batch" over a
// working day and a Thursday night, on a fake clock.
//
// The card (WavesCard.tsx) works out the next batch with nextBatchAt(now,
// {writtenToday}), and writtenToday is "an opener of today is still among
// `openers`". The Follow-ups page passes as `openers` only the open drafts
// (FollowupsPage.tsx: status draft and not expired). The desk (waves.py
// draft_day) writes a day's batch once, from first_hours[0] on a working day
// and never in the quiet hours (21:00 to 09:00 Kuwait), and says so on its
// status row with ok = true.
//
//     bun test apps/sales-cockpit/src/lib/stress2_time_waves.test.ts

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  batchWrittenToday,
  nextBatchAt,
  type Wave,
  type WaveCounts,
  waveLine,
} from "./waves";

const MIN = 60_000;
const HOUR = 60 * MIN;
const KUWAIT = 3 * HOUR;
/** A moment on Kuwait's clock, as an instant. */
const kw = (s: string) => Date.parse(`${s}Z`) - KUWAIT;
const kuwaitMidnight = (now: number) => {
  const k = now + KUWAIT;
  return k - (k % 86_400_000) - KUWAIT;
};

const wave: Wave = {
  id: "w1",
  pool: "no_show_cancelled",
  state: "running",
  per_day: 40,
  holdout_share: 0.1,
  created_at: "2026-10-04T06:00:00.000Z",
  started_at: "2026-10-04T06:00:00.000Z",
  ended_at: null,
  made_by: "manager@stress.invalid",
  enrolled_at: "2026-10-04T06:05:00.000Z",
  done_reason: null,
} as Wave;

const counts = {
  total: 400,
  wave: 360,
  holdout: 40,
  waiting: 280,
  drafted: 0,
  messaged: 80,
  bookedWave: 0,
  bookedHoldout: 0,
  settledWave: 0,
  settledHoldout: 0,
  excluded: 0,
  measuredWave: 80,
  measuredHoldout: 9,
} as WaveCounts;

/**
 * What the card does since fix round 1: today's batch is written once any
 * backlog opener of a wave was drafted today, whatever it has become
 * (WavesCard's `written`, every reactivate draft the page read), and the
 * next batch keeps to the desk's quiet hours (from 21:00).
 */
function cardLine(
  now: number,
  drafts: { created_at: string; status: string }[],
) {
  const written = drafts.map(d => ({
    ...d,
    segment: "reactivate",
    context: { wave_id: "w1" },
  }));
  const writtenToday = batchWrittenToday(written, now);
  // The old card read only the open drafts: kept here to show the difference.
  void kuwaitMidnight;
  const next = {
    at: nextBatchAt(now, {
      firstHour: 9,
      quietFrom: 21,
      daysOff: ["friday"],
      writtenToday,
    }),
    now,
  };
  // The desk's row: ok, written two minutes ago.
  return waveLine(wave, counts, next, {
    ok: true,
    detail:
      "1 wave running; Today's 40 openers are written. The next batch is tomorrow",
    at: new Date(now - 2 * MIN).toISOString(),
  });
}

describe("setup: the card counts today's batch from every backlog opener, not only the open ones", () => {
  test("FollowupsPage passes the open drafts as openers and every reactivate draft as written", () => {
    const page = readFileSync(
      new URL("../pages/FollowupsPage.tsx", import.meta.url),
      "utf8",
    );
    expect(page).toMatch(
      /const openers = all\.filter\(f => f\.segment === "reactivate" && open\(f\)\)/,
    );
    expect(page).toMatch(
      /written=\{all\.filter\(f => f\.segment === "reactivate"\)\}/,
    );
  });
});

describe("a working day: Sunday's batch written at 09:05, approved at 09:30, all 40 sent by 10:00", () => {
  const sent = Array.from({ length: 40 }, () => ({
    created_at: new Date(kw("2026-10-11T09:05:00")).toISOString(),
    status: "sent",
  }));

  test("control: at 09:40, with some still approved and waiting, the card says the next batch is tomorrow", () => {
    const some = sent.map((d, i) => (i < 10 ? { ...d, status: "draft" } : d));
    expect(cardLine(kw("2026-10-11T09:40:00"), some)).toContain(
      "Next batch tomorrow at 09:00.",
    );
  });

  test("at 14:00, every opener sent: the card still says the next batch is tomorrow at 09:00 (not 'being written now')", () => {
    const line = cardLine(kw("2026-10-11T14:00:00"), sent);
    expect(line).not.toContain("Today's batch is being written now.");
    expect(line).toContain("Next batch tomorrow at 09:00.");
  });
});

describe("Thursday night: a wave resumed (or its old batch approved) at 21:30 Kuwait, nothing written today", () => {
  test("the card names Saturday 09:00 (the desk writes nothing in the quiet hours or on Friday)", () => {
    const line = cardLine(kw("2026-10-08T21:30:00"), []);
    expect(line).not.toContain("Today's batch is being written now.");
    expect(line).toContain("Next batch on Saturday at 09:00.");
  });
});

describe("Approve all on a Thursday evening (Kuwait), the batch's openers to Gulf leads", () => {
  // followup.batch answers send_after times from the press, 45 s apart
  // (followupAgent.ts batch: first_at = now, last_at = now + 39 x 45 s). The
  // desk sends an opener only 09:00 to 18:00 on the lead's clock and never on
  // their Friday (waves.py send_due; sales-api hoursRefusal), so at 20:00 on
  // Thursday nothing goes before Saturday 09:00.
  const { approvedLine } = require("./waves") as typeof import("./waves");
  const press = kw("2026-10-08T20:00:00");
  const out = {
    count: 40,
    first_at: new Date(press).toISOString(),
    last_at: new Date(press + 39 * 45_000).toISOString(),
  };

  test("the line does not say they finish going out at 20:29 tonight", () => {
    const line = approvedLine(out, 45);
    expect(line).not.toMatch(/finishing at 20:29/);
  });

  test("control: approved at 10:00 on a Sunday the same line is right (they go 10:00 to 10:29)", () => {
    const sun = kw("2026-10-11T10:00:00");
    const line = approvedLine(
      {
        count: 40,
        first_at: new Date(sun).toISOString(),
        last_at: new Date(sun + 39 * 45_000).toISOString(),
      },
      45,
    );
    expect(line).toContain("finishing at 10:29");
  });
});
