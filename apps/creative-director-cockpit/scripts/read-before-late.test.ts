import { describe, expect, test } from "bun:test";
import { shouldReadAgain } from "../src/lib/readBeforeLate";

const now = 1_000_000_000_000;
const lastTry = now - 10 * 60_000;

describe("shouldReadAgain", () => {
  test("a hidden tab never reads", () => {
    expect(
      shouldReadAgain({
        now,
        lateAt: now + 1 * 60_000,
        lastTry,
        visible: false,
      }),
    ).toBe(false);
  });

  test("no late time means nothing to judge", () => {
    expect(shouldReadAgain({ now, lateAt: null, lastTry, visible: true })).toBe(
      false,
    );
  });

  test("a NaN late time is not a late time", () => {
    expect(
      shouldReadAgain({ now, lateAt: Number.NaN, lastTry, visible: true }),
    ).toBe(false);
  });

  test("fresh data more than two minutes ahead does not read", () => {
    expect(
      shouldReadAgain({
        now,
        lateAt: now + 10 * 60_000,
        lastTry,
        visible: true,
      }),
    ).toBe(false);
  });

  test("inside the two minute read-ahead it reads", () => {
    expect(
      shouldReadAgain({
        now,
        lateAt: now + 1 * 60_000,
        lastTry,
        visible: true,
      }),
    ).toBe(true);
  });

  test("already late it reads", () => {
    expect(
      shouldReadAgain({
        now,
        lateAt: now - 30 * 60_000,
        lastTry,
        visible: true,
      }),
    ).toBe(true);
  });

  test("already late but inside the minimum gap it waits", () => {
    expect(
      shouldReadAgain({
        now,
        lateAt: now - 30 * 60_000,
        lastTry: now - 2 * 60_000,
        visible: true,
      }),
    ).toBe(false);
  });

  test("a shorter minimum gap lets an already late page read", () => {
    expect(
      shouldReadAgain({
        now,
        lateAt: now - 30 * 60_000,
        lastTry: now - 2 * 60_000,
        visible: true,
        minGapMs: 60_000,
      }),
    ).toBe(true);
  });

  test("a wider read-ahead reads four minutes before late", () => {
    expect(
      shouldReadAgain({
        now,
        lateAt: now + 4 * 60_000,
        lastTry,
        visible: true,
        aheadMs: 5 * 60_000,
      }),
    ).toBe(true);
  });
});
