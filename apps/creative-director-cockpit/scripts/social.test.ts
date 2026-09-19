import { describe, expect, it } from "bun:test";
import { GhlError, listBody, ourStatus, VERSION } from "../convex/ghlSocial";
import { spread } from "../convex/social";

/**
 * The pure parts of the Social Planner integration: what GHL's words mean
 * in our vocabulary, when posts go out, and whether a refusal explains
 * itself. Everything else in that path is a network call.
 */
describe("ourStatus", () => {
  it("maps what GHL says onto where the post actually is", () => {
    expect(ourStatus("in_review")).toBe("with_client");
    expect(ourStatus("pending")).toBe("with_client");
    expect(ourStatus("scheduled")).toBe("scheduled");
    expect(ourStatus("notification_sent")).toBe("scheduled");
    expect(ourStatus("published")).toBe("published");
    expect(ourStatus("failed")).toBe("failed");
    expect(ourStatus("deleted")).toBe("client_rejected");
  });

  it("is not case sensitive, because their casing is not consistent", () => {
    expect(ourStatus("IN_REVIEW")).toBe("with_client");
    expect(ourStatus("Published")).toBe("published");
  });

  it("carries an unfamiliar status through rather than inventing one", () => {
    // Showing a status nobody recognises beats saying "published" about
    // something that is not.
    expect(ourStatus("some_new_thing")).toBe("some_new_thing");
    expect(ourStatus("")).toBe("unknown");
  });
});

describe("spread", () => {
  it("puts one post per slot across the month, in order", () => {
    const slots = spread("2026-09", 8);
    expect(slots).toHaveLength(8);
    const sorted = [...slots].sort();
    expect(slots).toEqual(sorted);
  });

  it("never schedules the 1st, so a batch approved that morning is not late", () => {
    for (const n of [1, 4, 8, 12, 30]) {
      for (const iso of spread("2026-09", n)) {
        expect(new Date(iso).getUTCDate()).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("stays inside the month, including a short one", () => {
    for (const month of ["2026-02", "2026-04", "2026-12"]) {
      const days = new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
      ).getUTCDate();
      for (const iso of spread(month, 12)) {
        const d = new Date(iso);
        expect(d.getUTCMonth()).toBe(Number(month.slice(5, 7)) - 1);
        expect(d.getUTCDate()).toBeLessThanOrEqual(days);
      }
    }
  });

  it("handles a leap February", () => {
    const slots = spread("2028-02", 12);
    for (const iso of slots)
      expect(new Date(iso).getUTCDate()).toBeLessThanOrEqual(29);
  });

  it("posts mid-morning in Kuwait, not at midnight", () => {
    // 07:00 UTC is 10am in Kuwait. Midnight would be the giveaway that
    // nobody chose a time.
    for (const iso of spread("2026-09", 4)) {
      expect(new Date(iso).getUTCHours()).toBe(7);
    }
  });

  it("does not stack two posts on the same day for a normal month", () => {
    const days = spread("2026-09", 12).map(s => new Date(s).getUTCDate());
    expect(new Set(days).size).toBe(12);
  });
});

describe("GhlError", () => {
  it("tells a missing scope apart from a bad token", () => {
    // Both are 401 and they need different people to fix them: one is a
    // token regenerated with the right boxes ticked, the other is the
    // wrong token entirely. Seen for real on 2026-09-19, minutes apart.
    const scope = GhlError.explain(
      401,
      '{"statusCode":401,"message":"The token is not authorized for this scope."}',
    );
    expect(scope).toContain("Social Planner scopes");
    expect(scope).toContain("Regenerate");
    expect(scope).not.toContain("Version header");
  });

  it("translates Invalid JWT into the thing that is actually wrong", () => {
    // It reads like a bad token and it is almost always a missing Version
    // header. Saying so is the difference between a minute and an evening.
    const why = GhlError.explain(401, '{"message":"Invalid JWT"}');
    expect(why).toContain("Version header");
    expect(why).toContain("GHL_SOCIAL_VERSION");
  });

  it("names the scopes a refused token needs", () => {
    const why = GhlError.explain(403, "forbidden");
    expect(why).toContain("socialplanner/post.write");
    expect(why).toContain("sub-account");
  });

  it("says a 404 is a missing sub-account, not a broken call", () => {
    expect(GhlError.explain(404, "")).toContain("no such sub-account");
  });

  it("passes anything else through with its body", () => {
    expect(GhlError.explain(500, "boom")).toContain("500");
    expect(GhlError.explain(500, "boom")).toContain("boom");
  });
});

describe("VERSION", () => {
  it("keeps the read and write versions separate", () => {
    // Their create-post page says v3 while the rest of v2 says a date.
    // Conflating them is what produces the Invalid JWT above.
    expect(VERSION.write).not.toBe(VERSION.posts);
  });
});

/**
 * The three ways the live API disagreed with its own documentation, each
 * found by calling it against a real sub-account on 2026-09-19 and each
 * now pinned so a tidy-up cannot quietly undo them.
 */
describe("what the live API actually wants", () => {
  it("sends limit as a number string", () => {
    // Send the number and it answers "limit must be a number string".
    const body = listBody({ limit: 10 });
    expect(body.limit).toBe("10");
    expect(typeof body.limit).toBe("string");
    expect(typeof body.skip).toBe("string");
  });

  it("clamps the limit but keeps it a string", () => {
    expect(listBody({ limit: 5000 }).limit).toBe("100");
    expect(listBody({ limit: 0 }).limit).toBe("1");
    expect(listBody().limit).toBe("100");
  });

  it("passes a window through only when given one", () => {
    expect(listBody().fromDate).toBeUndefined();
    const w = listBody({
      from: "2026-09-01T00:00:00Z",
      to: "2026-10-01T00:00:00Z",
    });
    expect(w.fromDate).toBe("2026-09-01T00:00:00Z");
    expect(w.toDate).toBe("2026-10-01T00:00:00Z");
  });
});
