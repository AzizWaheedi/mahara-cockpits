import { expect, test } from "bun:test";
import { summarizeFailing } from "../src/lib/failingSummary";

// 8 Oct 2026: the media buyer card on Admin repeated "Latest provider receipt
// is unsuccessful; inspect its protected ledger" once per provider receipt.
const receipt =
  "Latest provider receipt is unsuccessful; inspect its protected ledger";

test("a message repeated by many checks reads once, with how many", () => {
  expect(summarizeFailing(Array(42).fill(receipt))).toBe(
    `${receipt} (42 checks)`,
  );
});

test("different messages each read once, most frequent first", () => {
  expect(
    summarizeFailing([receipt, "Sheet not shared", receipt, receipt]),
  ).toBe(`${receipt} (3 checks), Sheet not shared`);
});

test("a single failure reads as before, and nothing reads as nothing", () => {
  expect(summarizeFailing(["Sheet not shared"])).toBe("Sheet not shared");
  expect(summarizeFailing([])).toBe("");
});
