import { expect, test } from "bun:test";
import {
  emptyNudge,
  loadNudge,
  localDay,
  markDismissed,
  markShown,
  markUsed,
  pickNudge,
  shouldNudge,
} from "../src/lib/hermesNudge";

const DAY = 86400000;
const at = (day: number, hour = 10) =>
  new Date(2026, 10, day, hour, 0).getTime();

test("shouldNudge is false while muted, used today, or shown today", () => {
  const now = at(5);
  expect(shouldNudge({ ...emptyNudge(), mutedUntil: now + 1 }, "/a", now)).toBe(
    false,
  );
  expect(
    shouldNudge({ ...emptyNudge(), usedOn: localDay(now) }, "/a", now),
  ).toBe(false);
  expect(
    shouldNudge({ ...emptyNudge(), shown: { "/a": localDay(now) } }, "/a", now),
  ).toBe(false);
  expect(shouldNudge(emptyNudge(), "/a", now)).toBe(true);
});

test("a page shows a nudge once a day and other pages still get one", () => {
  const now = at(5);
  const yesterday = at(4);
  const state = markShown(
    markShown(emptyNudge(), "/old", yesterday),
    "/a",
    now,
  );
  expect(shouldNudge(state, "/a", now)).toBe(false);
  expect(shouldNudge(state, "/b", now)).toBe(true);
  expect(state.shown).toEqual({ "/a": localDay(now) });
});

test("two dismissals mute for 7 days and the mute ends after 7 days", () => {
  const now = at(5);
  const once = markDismissed(emptyNudge(), now);
  expect(once.dismissStreak).toBe(1);
  expect(once.mutedUntil).toBe(0);
  const twice = markDismissed(once, now);
  expect(twice.dismissStreak).toBe(0);
  expect(twice.mutedUntil).toBe(now + 7 * DAY);
  expect(shouldNudge(twice, "/a", now + 6 * DAY)).toBe(false);
  expect(shouldNudge(twice, "/a", now + 7 * DAY)).toBe(true);
});

test("one dismissal then use resets the streak", () => {
  const now = at(5);
  const state = markUsed(markDismissed(emptyNudge(), now), now);
  expect(state.dismissStreak).toBe(0);
  expect(state.usedOn).toBe(localDay(now));
});

test("markUsed blocks the rest of the day and allows the next day", () => {
  const now = at(5);
  const state = markUsed(emptyNudge(), now);
  expect(shouldNudge(state, "/a", at(5, 18))).toBe(false);
  expect(shouldNudge(state, "/a", at(6))).toBe(true);
});

test("pickNudge rotates with the day and returns null for an empty list", () => {
  const list = ["one", "two", "three"];
  const dayNumber = (now: number) => {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return Math.floor(midnight.getTime() / DAY);
  };
  const today = at(5);
  expect(pickNudge(list, today)).toBe(list[dayNumber(today) % list.length]);
  expect(pickNudge(list, today + DAY)).toBe(
    list[(dayNumber(today) + 1) % list.length],
  );
  expect(pickNudge([], today)).toBeNull();
});

test("loadNudge returns an empty state when the store is missing or broken", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      configurable: true,
    });
    expect(loadNudge("media-buyer")).toEqual(emptyNudge());
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => "{not json", setItem: () => {} },
      configurable: true,
    });
    expect(loadNudge("media-buyer")).toEqual(emptyNudge());
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
