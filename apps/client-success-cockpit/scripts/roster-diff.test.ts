import { describe, expect, test } from "bun:test";
import {
  type RosterEvent,
  type RosterRow,
  rosterDiff,
  rosterEventId,
} from "../convex/csmSync";

/**
 * The churn event log went 0 rows for its whole life because the diff compared
 * today's roster against the newest stored roster, which after the first sync
 * of the day is today's own. These tests pin the two properties that failure
 * needed, so it cannot come back quietly.
 */

const client = (
  key: string,
  status: string,
  paying: boolean,
  name = key,
): RosterRow => ({ key, name, status, paying });

/** Reconcile, exactly as recordRoster does, so the test exercises the real rule. */
function reconcile(held: RosterEvent[], want: RosterEvent[]) {
  const wanted = new Set(want.map(rosterEventId));
  const have = new Set(held.map(rosterEventId));
  return {
    inserted: want.filter(e => !have.has(rosterEventId(e))),
    deleted: held.filter(e => !wanted.has(rosterEventId(e))),
  };
}

describe("roster diff", () => {
  const yesterday = [
    client("a", "Active", true, "Acme"),
    client("b", "Active", true, "Bravo"),
  ];

  test("a quiet day produces nothing", () => {
    expect(rosterDiff(yesterday, yesterday)).toEqual([]);
  });

  test("a status changed during the working day is caught", () => {
    // This is the case the old code lost: the first sync of the day saw no
    // change, and every later sync returned early.
    const afterLunch = [
      client("a", "Active", true, "Acme"),
      client("b", "Stopped", false, "Bravo"),
    ];
    const events = rosterDiff(yesterday, afterLunch);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("lost");
    expect(events[0].key).toBe("b");
    expect(events[0].from).toBe("Active");
    expect(events[0].to).toBe("Stopped");
  });

  test("running the diff again the same day adds nothing", () => {
    const afterLunch = [
      client("a", "Active", true, "Acme"),
      client("b", "Stopped", false, "Bravo"),
    ];
    const first = rosterDiff(yesterday, afterLunch);
    const second = rosterDiff(yesterday, afterLunch);
    const { inserted, deleted } = reconcile(first, second);
    expect(inserted).toEqual([]);
    expect(deleted).toEqual([]);
  });

  test("a change undone the same day leaves nothing behind", () => {
    const afterLunch = [
      client("a", "Active", true, "Acme"),
      client("b", "Stopped", false, "Bravo"),
    ];
    const heldFromLunch = rosterDiff(yesterday, afterLunch);
    // The CSM put it back before the end of the day.
    const atClose = rosterDiff(yesterday, yesterday);
    const { inserted, deleted } = reconcile(heldFromLunch, atClose);
    expect(inserted).toEqual([]);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].kind).toBe("lost");
  });

  test("a client that joins and one that leaves the board", () => {
    const today = [
      client("a", "Active", true, "Acme"),
      client("c", "Needs Contacting", false, "Charlie"),
    ];
    const events = rosterDiff(yesterday, today);
    const byKey = Object.fromEntries(events.map(e => [e.key, e]));
    expect(byKey.c.kind).toBe("new_inactive");
    expect(byKey.b.kind).toBe("lost");
    expect(byKey.b.to).toBe("removed from the board");
  });

  test("a pause is a pause, and coming back is regained", () => {
    const paused = rosterDiff(yesterday, [
      client("a", "Active", true, "Acme"),
      client("b", "Paused", false, "Bravo"),
    ]);
    expect(paused.find(e => e.key === "b")?.kind).toBe("paused");

    const back = rosterDiff(
      [client("b", "Paused", false, "Bravo")],
      [client("b", "Active", true, "Bravo")],
    );
    expect(back[0].kind).toBe("regained");
  });

  test("moving between two onboarding stages is not an event", () => {
    const events = rosterDiff(
      [client("d", "Needs Contacting", false, "Delta")],
      [client("d", "LAUNCH BOOKED", false, "Delta")],
    );
    expect(events).toEqual([]);
  });
});
