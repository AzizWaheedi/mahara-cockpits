import { describe, expect, test } from "bun:test";
import {
  ONLY_IF_WORSE,
  type Review,
  reviewState,
} from "../src/lib/reviewQueue";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-24T12:00:00+03:00");
const ago = (d: number) => NOW - d * DAY;
const review = (over: Partial<Review>): Review => ({
  subject: "Alpha|mahara|1\\10",
  kind: "approved",
  action: "Scale the winner",
  at: ago(2),
  ...over,
});

describe("the review queue", () => {
  test("keeps the launch window and the learning days", () => {
    expect(reviewState({ daysLive: 2 }, [], NOW)).toEqual({
      state: "launch",
      day: 3,
    });
    expect(
      reviewState({ daysLive: 20, lastChangeAt: ago(1) }, [], NOW),
    ).toEqual({
      state: "learning",
      sinceChange: 1,
    });
  });

  test("a campaign with no change for a week is due, and missing history is not zero", () => {
    expect(
      reviewState({ daysLive: 40, lastChangeAt: ago(30) }, [], NOW),
    ).toEqual({
      state: "due",
      since: 30,
    });
    expect(
      reviewState({ daysLive: 40, lastChangeAt: ago(5) }, [], NOW),
    ).toBeNull();
    expect(reviewState({}, [], NOW)).toEqual({ state: "due", since: null });
    expect(reviewState({ daysLive: 9 }, [], NOW)).toEqual({
      state: "due",
      since: 9,
    });
  });

  test("a decision in Ads counts as a review for a week", () => {
    const r = review({ at: ago(2) });
    expect(
      reviewState({ daysLive: 40, lastChangeAt: ago(30) }, [r], NOW),
    ).toEqual({
      state: "reviewed",
      review: r,
      nextAt: r.at + 7 * DAY,
    });
    expect(
      reviewState(
        { daysLive: 40, lastChangeAt: ago(30) },
        [review({ at: ago(8) })],
        NOW,
      ),
    ).toEqual({ state: "due", since: 8 });
  });

  test("a client message is not a review", () => {
    const touch = review({ kind: "touch", action: "Client updated" });
    expect(
      reviewState({ daysLive: 40, lastChangeAt: ago(30) }, [touch], NOW),
    ).toEqual({
      state: "due",
      since: 30,
    });
  });

  test("Leave it's clock sets the next check", () => {
    const c = { daysLive: 40, lastChangeAt: ago(30) };
    expect(
      reviewState(
        c,
        [review({ kind: "left", snooze: "Tomorrow", at: ago(2) })],
        NOW,
      ),
    ).toEqual({ state: "due", since: 2 });
    const three = review({ kind: "left", snooze: "In 3 days", at: ago(2) });
    expect(reviewState(c, [three], NOW)).toEqual({
      state: "reviewed",
      review: three,
      nextAt: three.at + 3 * DAY,
    });
    const week = review({ kind: "left", snooze: "Next week", at: ago(5) });
    expect(reviewState(c, [week], NOW)?.state).toBe("reviewed");
  });

  test("only if worse waits for a worse call, and an old call without one waits a week", () => {
    const left = review({
      kind: "left",
      snooze: ONLY_IF_WORSE,
      verdictAtDecision: "scale",
      at: ago(20),
    });
    expect(
      reviewState(
        { daysLive: 40, lastChangeAt: ago(30), verdict: "scale" },
        [left],
        NOW,
      ),
    ).toEqual({ state: "reviewed", review: left, nextAt: null });
    expect(
      reviewState(
        { daysLive: 40, lastChangeAt: ago(30), verdict: "kill" },
        [left],
        NOW,
      ),
    ).toEqual({ state: "due", since: 20 });
    const old = review({ kind: "left", snooze: ONLY_IF_WORSE, at: ago(8) });
    expect(
      reviewState(
        { daysLive: 40, lastChangeAt: ago(30), verdict: "scale" },
        [old],
        NOW,
      ),
    ).toEqual({ state: "due", since: 8 });
  });

  test("a Meta change after the decision restarts the clock from the change", () => {
    const c = { daysLive: 40, lastChangeAt: ago(4) };
    expect(reviewState(c, [review({ at: ago(6) })], NOW)).toBeNull();
    expect(
      reviewState(
        { daysLive: 40, lastChangeAt: ago(9) },
        [review({ at: ago(12) })],
        NOW,
      ),
    ).toEqual({ state: "due", since: 9 });
  });

  test("the latest decision wins", () => {
    const older = review({ kind: "left", snooze: "Next week", at: ago(6) });
    const newer = review({ kind: "left", snooze: "Tomorrow", at: ago(2) });
    expect(
      reviewState({ daysLive: 40, lastChangeAt: ago(30) }, [newer, older], NOW),
    ).toEqual({ state: "due", since: 2 });
  });
});
