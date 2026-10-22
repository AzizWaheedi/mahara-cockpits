import { expect, test } from "bun:test";
import { refreshDraft } from "./dayReview";

test("an outcome save refreshes automatic totals and keeps a manual correction", () => {
  expect(
    refreshDraft(
      {
        values: { demos_showed: "1", cash: "1500", summary: "Good day" },
        manual: { cash: true, summary: true },
      },
      { demos_showed: 2, cash: 0 },
      ["demos_showed", "cash"],
    ),
  ).toEqual({
    values: { demos_showed: "2", cash: "1500", summary: "Good day" },
    manual: { cash: true, summary: true },
  });
});
test("a source that became unavailable clears only an automatic number", () => {
  expect(
    refreshDraft({ values: { cash: "0" }, manual: {} }, { cash: null }, [
      "cash",
    ]).values.cash,
  ).toBe("");
});
