import { describe, expect, test } from "bun:test";
import {
  eodChangeLines,
  eodTaskEvidence,
  type MetaChange,
} from "../src/lib/eodChanges";

const T = Date.parse("2026-10-24T10:00:00+03:00");
const change = (over: Partial<MetaChange>): MetaChange => ({
  at: T,
  client: "Alpha",
  actor: "Nada Al Saed",
  eventType: "Ad created",
  ...over,
});

describe("End of day changes from Meta's log", () => {
  test("one line per client, counted, with who made them", () => {
    const lines = eodChangeLines(
      [
        change({}),
        change({ at: T + 60_000 }),
        change({
          eventType: "Ad set budget updated",
          actor: "Muhammed Burhan",
        }),
        change({ client: "Beta", eventType: "Ad status updated" }),
      ],
      [],
    );
    expect(lines).toEqual([
      "• Alpha - in Ads Manager: ad created (2), ad set budget updated - Nada Al Saed, Muhammed Burhan",
      "• Beta - in Ads Manager: ad status updated - Nada Al Saed",
    ]);
  });

  test("housekeeping and admin are left out", () => {
    expect(
      eodChangeLines(
        [
          change({ eventType: "Ad name updated" }),
          change({ eventType: "Spending limit updated" }),
          change({ eventType: "Person removed from account" }),
          change({ eventType: "Image added to the library" }),
        ],
        [],
      ),
    ).toEqual([]);
  });

  test("a cockpit decision's own write is not listed twice", () => {
    expect(
      eodChangeLines(
        [change({ eventType: "Ad set budget updated", at: T + 3 * 60_000 })],
        [{ client: "Alpha", at: T }],
      ),
    ).toEqual([]);
    expect(
      eodChangeLines(
        [change({ eventType: "Ad set budget updated", at: T + 30 * 60_000 })],
        [{ client: "Alpha", at: T }],
      ),
    ).toHaveLength(1);
  });

  test("the task evidence counts new ads and switches, and says when the log is missing", () => {
    expect(
      eodTaskEvidence([
        change({}),
        change({ eventType: "Ad status updated" }),
        change({ eventType: "Campaign status updated" }),
      ]),
    ).toEqual({
      creativesUploaded: "Meta's log today: 1 ad created.",
      launchedPaused: "Meta's log today: 1 ad created, 2 status changes.",
    });
    expect(eodTaskEvidence([])).toEqual({
      creativesUploaded: "Meta's log shows no new ad today.",
      launchedPaused: "Meta's log shows no launch or pause today.",
    });
    expect(eodTaskEvidence(null).creativesUploaded).toContain(
      "could not be read",
    );
  });
});
