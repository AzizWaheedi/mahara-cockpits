/**
 * The hot list's review and referral asks follow Google's review rules and the referral
 * programme: the review goes to every active client the same way and offers nothing back,
 * and the referral quotes the programme's own ladder.
 */
import { describe, expect, test } from "bun:test";
import { opportunitiesFor } from "../src/lib/csmHotList";
import type { Client } from "../src/lib/csmTemplates";

const client = (over: Partial<Client>): Client =>
  ({
    taskId: "t1",
    name: "Alpha Build",
    stage: "Active",
    liveDays: 60,
    level: "green",
    happiness: "Happy",
    ...over,
  }) as Client;

const kinds = (c: Client) => opportunitiesFor(c).map(o => o.key.split(":")[1]);
const review = (c: Client) =>
  opportunitiesFor(c).find(o => o.key.endsWith(":review"));

describe("the review ask", () => {
  test("goes to happy, unhappy and unrated clients alike", () => {
    for (const happiness of ["Happy", "Neutral", "At Risk", undefined]) {
      const r = review(client({ happiness }));
      expect(r?.type).toBe("Review");
      expect(r?.leadType).toBe("Warm");
    }
    expect(kinds(client({ happiness: "At Risk", level: "red" }))).toContain(
      "review",
    );
  });

  test("waits for the first month and skips stopped clients", () => {
    expect(review(client({ liveDays: 20 }))).toBeUndefined();
    expect(review(client({ stage: "Paused" }))).toBeUndefined();
  });

  test("never offers a review back, in either language", () => {
    const r = review(client({}));
    for (const text of [
      r?.pitch("en"),
      r?.pitch("ar"),
      r?.objection.answer("en"),
      r?.objection.answer("ar"),
    ]) {
      expect(text).toContain("https://g.page/r/CeRMcUwFPpe7EAI/review");
      expect(text).not.toMatch(/same for you|نفس الشي لك|do the same/);
    }
  });
});

describe("the referral ask", () => {
  test("stays with happy clients", () => {
    expect(kinds(client({ happiness: "At Risk" }))).not.toContain("referral");
    expect(kinds(client({}))).toContain("referral");
  });

  test("quotes the programme's ladder, not a flat $1,000", () => {
    const r = opportunitiesFor(client({})).find(o =>
      o.key.endsWith(":referral"),
    );
    expect(r?.amount).toBe("$500, $750, $750, then $1,000 a firm");
    expect(r?.pitch("en")).toContain(
      "$500 for the first firm, $750 for the second, $750 for the third and $1,000 for every one after that",
    );
    expect(r?.pitch("ar")).toContain("٥٠٠ دولار عن أول شركة");
    expect(r?.pitch("ar")).not.toContain("$");
  });
});
