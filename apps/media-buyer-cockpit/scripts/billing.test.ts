import { describe, expect, test } from "bun:test";
import { type Account, amountProblem, ladderOf } from "../convex/billingCore";
import { bankCanBe } from "../convex/ceo/manualMatch";

// The rules both cockpits and Maher bill by (convex/billingCore.ts).

describe("amounts", () => {
  test("every cent amount up to $10,000 is a payment", () => {
    // An exact comparison refused 18,865 of these, $2.01 among them.
    let refused = 0;
    for (let c = 1; c <= 1_000_000; c++)
      if (amountProblem(c / 100, "USD") !== null) refused++;
    expect(refused).toBe(0);
  });

  test("every fils amount up to 10,000 KWD is a payment", () => {
    let refused = 0;
    for (let f = 1; f <= 10_000_000; f++)
      if (amountProblem(f / 1000, "KWD") !== null) refused++;
    expect(refused).toBe(0);
  });

  test("what is not a payment", () => {
    expect(amountProblem(0, "USD")).not.toBeNull();
    expect(amountProblem(-5, "USD")).not.toBeNull();
    expect(amountProblem(Number.NaN, "USD")).not.toBeNull();
    expect(amountProblem(12.345, "USD")).toContain("two decimals");
    expect(amountProblem(12.3456, "KWD")).toContain("three decimals");
    expect(amountProblem(250_000, "USD")).not.toBeNull();
  });
});

const card = (over: Partial<Account>): Account => ({
  taskId: "t",
  name: "Client",
  url: null,
  status: "Active",
  group: "active",
  method: null,
  plan: "Monthly",
  country: null,
  nextUsd: 1000,
  nextDate: null,
  mrrUsd: null,
  ltvFieldUsd: null,
  pausedOn: null,
  extensionWeeks: null,
  churnDate: null,
  csm: null,
  syncedAt: null,
  source: "sync",
  ...over,
});

describe("the ladder, as the SOP and Maher's scan have it", () => {
  const today = "2026-09-23";
  const at = (nextDate: string) => ladderOf(card({ nextDate }), today);

  test("before the day", () => {
    expect(at("2026-10-05").rung).toBe("later");
    expect(at("2026-09-30").rung).toBe("confirm"); // 7 out
    expect(at("2026-09-27").rung).toBe("confirm"); // 4 out
    expect(at("2026-09-26").label).toBe("Send the invoice"); // 3 out
    expect(at("2026-09-24").label).toBe("Check the invoice went out");
  });

  test("the day and after", () => {
    expect(at("2026-09-23").rung).toBe("today");
    expect(at("2026-09-22").rung).toBe("day1");
    expect(at("2026-09-21").rung).toBe("call");
    expect(at("2026-09-20").rung).toBe("pause");
    expect(at("2026-09-09").rung).toBe("pause"); // day 14
    expect(at("2026-08-29").rung).toBe("churn"); // 25 days, never paused
  });

  test("paused is counted from Paused On, never from the payment date", () => {
    const paused = (pausedOn: string | null) =>
      ladderOf(
        card({
          status: "Paused",
          group: "paused",
          pausedOn,
          nextDate: "2026-09-01",
        }),
        today,
      );
    expect(paused(null).label).toContain("no pause date");
    expect(paused("2026-09-21").rung).toBe("paused");
    expect(paused("2026-09-08").rung).toBe("churn"); // 15 days
  });

  test("cards that are not paying clients have no step", () => {
    expect(ladderOf(card({ group: "gone" }), today).rung).toBe("none");
    expect(ladderOf(card({ group: "sales" }), today).rung).toBe("none");
  });
});

describe("a hand-logged payment and the bank line that is the same money", () => {
  test("a transfer matches within three days either way", () => {
    expect(bankCanBe("bank_transfer", "2026-09-23", "2026-09-26")).toBe(true);
    expect(bankCanBe("bank_transfer", "2026-09-23", "2026-09-20")).toBe(true);
    expect(bankCanBe("bank_transfer", "2026-09-23", "2026-09-27")).toBe(false);
  });

  test("a cheque matches its deposit up to two weeks later", () => {
    // Liwan's cheque: logged the day it was handed over, cleared later.
    expect(bankCanBe("cheque", "2026-09-23", "2026-09-30")).toBe(true);
    expect(bankCanBe("cheque", "2026-09-23", "2026-10-07")).toBe(true);
    expect(bankCanBe("cheque", "2026-09-23", "2026-10-08")).toBe(false);
    // Never a deposit from long before the cheque was received.
    expect(bankCanBe("cheque", "2026-09-23", "2026-09-19")).toBe(false);
  });
});
