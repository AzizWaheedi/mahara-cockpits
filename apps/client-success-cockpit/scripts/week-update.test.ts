// "What we did this week" in the CSM's drafts: bun test scripts/week-update.test.ts
import { describe, expect, test } from "bun:test";
import { draftsFor } from "../src/lib/csmTemplates";

const NOW = Date.now();

// biome-ignore lint/suspicious/noExplicitAny: a client row, trimmed to what the drafts read
function client(over: any = {}): any {
  return {
    name: "Liwan Limited",
    stage: "Live",
    bucket: "management",
    liveDays: 40,
    silentDays: 1,
    callDays: 3,
    changes: [],
    ...over,
  };
}

const WEEK = {
  since: "2026-09-20",
  ads: [
    { at: NOW - 3 * 86_400_000, label: "Scale the winner" },
    {
      at: NOW - 86_400_000,
      label: 'Added a new video creative (paused) to "Hook 1"\'s ad set',
    },
  ],
  verdict: "scale",
  bookings: 4,
  weBook: true,
  videos: { finished: ["Villa reel"], withClient: [], making: 2 },
  board: ["Monthly report sent"],
};

describe("What we did this week", () => {
  test("offered when the team did something, with the facts above it", () => {
    const d = draftsFor(client({ work: WEEK }), "en").find(
      x => x.id === "what_we_did",
    );
    expect(d?.message).toContain(
      "Hi Liwan, a quick update on what we did for you this week:",
    );
    expect(d?.message).toContain(
      "• Ads: We gave more budget to your best-performing ad and added a new video ad. 4 appointments were booked with you this week.",
    );
    expect(d?.message).toContain(
      "• Videos: A new video is finished and we're working on 2 more.",
    );
    expect(d?.why).toContain("Since 20 Sep");
    expect(d?.why).toContain("finished Villa reel");
    expect(d?.why).toContain(
      "done on the Client Success board: Monthly report sent",
    );
    expect(d?.why).not.toContain("already sent them an update today");
  });

  test("in Arabic for an Arabic client", () => {
    const d = draftsFor(client({ work: WEEK }), "ar").find(
      x => x.id === "what_we_did",
    );
    expect(d?.message).toContain(
      "هلا Liwan، تحديث سريع على اللي سويناه لكم هالأسبوع",
    );
    expect(d?.message).toContain("خلصنا لكم فيديو يديد");
  });

  test("warns when the media buyer already wrote to them today", () => {
    const d = draftsFor(client({ work: { ...WEEK, toldAt: NOW } }), "en").find(
      x => x.id === "what_we_did",
    );
    expect(d?.why).toContain(
      "The media buyer already sent them an update today",
    );
  });

  test("not offered when nothing a client can be told happened", () => {
    for (const work of [
      undefined,
      {
        since: "2026-09-20",
        ads: [{ at: NOW, label: "Left" }],
        verdict: "hold",
      },
    ])
      expect(
        draftsFor(client({ work }), "en").some(x => x.id === "what_we_did"),
      ).toBe(false);
  });
});
