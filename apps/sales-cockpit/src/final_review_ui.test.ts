// bun test src/final_review_ui.test.ts (in apps/sales-cockpit)
//
// The final review's cockpit findings (4 October 2026), held by the pages
// themselves. The components are read as source where they have no
// harness here; the pure parts are called.

import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

mock.module("./lib/supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));

const R = await import("./lib/rooms");
const F = await import("./dev/roomFixtures");

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const dialer = read("./pages/DialerPage.tsx");
const waves = read("./components/WavesCard.tsx");
const desk = read("./components/DeskStatus.tsx");
const NOW = Date.parse("2026-10-04T08:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("after a video intro, the dialer asks how it went", () => {
  test("a room the lead joined, live or closed, is a video join; a taken-back join and a room nobody joined are not", () => {
    expect(
      R.videoJoinedAt(
        F.baseRoom(NOW, { state: "lead_in", lead_in_at: iso(NOW) }),
      ),
    ).toBe(iso(NOW));
    expect(
      R.videoJoinedAt(
        F.baseRoom(NOW, {
          state: "ended",
          result: "joined",
          lead_in_at: iso(NOW),
        }),
      ),
    ).toBe(iso(NOW));
    expect(
      R.videoJoinedAt(F.baseRoom(NOW, { state: "host_in", lead_in_at: null })),
    ).toBeNull();
    expect(
      R.videoJoinedAt(
        F.baseRoom(NOW, {
          state: "expired",
          result: "no_join",
          lead_in_at: null,
        }),
      ),
    ).toBeNull();
    expect(R.videoJoinedAt(null)).toBeNull();
  });

  test("the step says joined, offers Book the demo, Save how it went and Next lead, and the band says when", () => {
    expect(dialer).toContain("joined the video call. How did the intro go?");
    expect(dialer).toMatch(
      /Book the demo[\s\S]{0,400}Save how it went[\s\S]{0,200}<NextLeadButton/,
    );
    expect(dialer).toMatch(/`Joined on video at \$\{clock\(joinedAt\)\}`/);
    // No missed-call WhatsApp and no second link once they joined.
    expect(dialer).toMatch(/mode === "unanswered" && joinedAt \?/);
    expect(dialer).toMatch(/!failedOnScreen &&\s*!joinedAt/);
  });

  test("Next lead and Alt+→ send automatic mode's link first, never cancel it silently", () => {
    expect(dialer).toMatch(
      /const toNext = \(\) => \{\s*leaveRef\.current\(\);/,
    );
    expect(dialer).toMatch(/const go = \(\) => \{\s*leaveRef\.current\(\);/);
    expect(dialer).toMatch(
      /toast\.error\(`The video link to \$\{name\} did not go\. \$\{errorText\(e\)\}`\)/,
    );
  });
});

describe("Approve all sends nothing nobody has read", () => {
  test("each opener's words show under its row, in their own direction", () => {
    expect(waves).toMatch(/body\?: string \| null;/);
    expect(waves).toMatch(
      /\{o\?\.body \? \(\s*<p[\s\S]{0,200}dir="auto"[\s\S]{0,80}\{o\.body\}/,
    );
  });
});

describe("team-facing copy names roles", () => {
  test("the desk's job lines say the CEO is alerted, never a name", () => {
    expect(desk).not.toContain("Aziz");
    expect(desk).toContain("The CEO is alerted if it stays that way.");
  });
});
