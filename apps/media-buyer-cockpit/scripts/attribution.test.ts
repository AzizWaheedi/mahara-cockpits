/** Every payment in gets a side, a person and a deal or a client. */
import { describe, expect, test } from "bun:test";
import {
  attribute,
  byPerson,
  type CardRef,
  type DealRef,
  type PaymentIn,
  totals,
} from "../convex/ceo/attribution";

const deal: DealRef = {
  responseId: "d1",
  day: "2026-08-10",
  email: "owner@decorplus.com",
  business: "Decor Plus",
  contactName: "Fadi Rafie",
  closer: "Ghanim Al Ghanim",
  csm: "Saleh Attal",
  deposit: 500,
  paymentStructure: "Paid in full (90 days)",
};
const monthlyDeal: DealRef = {
  ...deal,
  responseId: "d2",
  day: "2026-07-01",
  email: "m@monthly.co",
  business: "Monthly Co",
  paymentStructure: "Monthly",
};
const card: CardRef = {
  taskId: "t1",
  names: ["Decor Plus", "decorplus.kw"],
  csm: "Mariam",
  emails: ["login@decorplus.com"],
  payerKeys: ["DP Trading"],
};
const pay = (
  p: Partial<PaymentIn> & { id: string; day: string; usd: number },
): PaymentIn => ({
  rail: "whop",
  currency: "USD",
  amount: p.usd,
  payerEmail: null,
  payerName: null,
  dealResponseId: null,
  clickupTaskId: null,
  billingReason: "one_time",
  ...p,
});

describe("attribute", () => {
  test("the first money against a deal, up to the deposit, is the closer's deposit", () => {
    const [r] = attribute(
      [pay({ id: "p1", day: "2026-08-11", usd: 500, dealResponseId: "d1" })],
      [deal],
      [card],
    );
    expect(r.side).toBe("front_end");
    expect(r.kind).toBe("deposit");
    expect(r.person).toBe("Ghanim");
    expect(r.personRole).toBe("closer");
    expect(r.matchedBy).toBe("deal_id");
    expect(r.clientTaskId).toBe("t1");
  });
  test("what follows the deposit inside the window is the rest of the cash, the CSM's", () => {
    const rows = attribute(
      [
        pay({
          id: "p1",
          day: "2026-08-11",
          usd: 500,
          payerEmail: "Owner@DecorPlus.com",
        }),
        pay({
          id: "p2",
          day: "2026-08-20",
          usd: 1500,
          payerEmail: "owner@decorplus.com",
        }),
      ],
      [deal],
      [card],
    );
    expect(rows.map(r => r.kind)).toEqual(["deposit", "kickoff"]);
    expect(rows[1].person).toBe("Saleh");
    expect(rows[1].matchedBy).toBe("deal_email");
  });
  test("a payment after the front-end window is back end, the card's CSM's", () => {
    const [r] = attribute(
      [
        pay({
          id: "p3",
          day: "2026-10-30",
          usd: 2000,
          payerName: "Decor Plus",
        }),
      ],
      [deal],
      [card],
    );
    expect(r.side).toBe("back_end");
    expect(r.person).toBe("Mariam");
    expect(r.matchedBy).toBe("deal_name");
  });
  test("a monthly deal's second month is back end", () => {
    const rows = attribute(
      [
        pay({
          id: "p1",
          day: "2026-07-01",
          usd: 1000,
          payerEmail: "m@monthly.co",
        }),
        pay({
          id: "p2",
          day: "2026-07-31",
          usd: 2000,
          payerEmail: "m@monthly.co",
        }),
      ],
      [monthlyDeal],
      [],
    );
    expect(rows.map(r => r.side)).toEqual(["front_end", "back_end"]);
  });
  test("a subscription cycle is never a deposit", () => {
    const [r] = attribute(
      [
        pay({
          id: "p1",
          day: "2026-08-12",
          usd: 500,
          dealResponseId: "d1",
          billingReason: "subscription_cycle",
        }),
      ],
      [deal],
      [card],
    );
    expect(r.side).toBe("back_end");
  });
  test("a payment well before the form is not that deal's", () => {
    const [r] = attribute(
      [
        pay({
          id: "p0",
          day: "2026-06-01",
          usd: 500,
          payerEmail: "owner@decorplus.com",
        }),
      ],
      [deal],
      [],
    );
    expect(r.side).toBe("unattributed");
  });
  test("a client is matched by portal login, hand mapping, name or the typed card", () => {
    const rows = attribute(
      [
        pay({
          id: "a",
          day: "2026-09-01",
          usd: 10,
          payerEmail: "login@decorplus.com",
        }),
        pay({ id: "b", day: "2026-09-01", usd: 10, payerName: "dp trading" }),
        pay({ id: "c", day: "2026-09-01", usd: 10, payerName: "DecorPlus KW" }),
        pay({
          id: "d",
          day: "2026-09-01",
          usd: 10,
          clickupTaskId: "t1",
          rail: "manual",
        }),
        pay({ id: "e", day: "2026-09-01", usd: 10, payerName: "Nobody Known" }),
      ],
      [],
      [card],
    );
    expect(rows.map(r => r.matchedBy)).toEqual([
      "card_email",
      "card_payer",
      "card_name",
      "card_typed",
      "none",
    ]);
    expect(
      rows
        .slice(0, 4)
        .every(r => r.side === "back_end" && r.person === "Mariam"),
    ).toBe(true);
    expect(rows[4].side).toBe("unattributed");
  });
  test("a payer under their own name, or a longer business name, still meets the deal", () => {
    const rows = attribute(
      [
        pay({ id: "n1", day: "2026-08-12", usd: 500, payerName: "Fadi Rafie" }),
        pay({
          id: "n2",
          day: "2026-08-13",
          usd: 700,
          payerName: "DECOR PLUS CO.",
        }),
      ],
      [deal],
      [],
    );
    expect(rows.map(r => [r.matchedBy, r.kind])).toEqual([
      ["deal_name", "deposit"],
      ["deal_name", "kickoff"],
    ]);
  });
  test("short names never match by accident", () => {
    const [r] = attribute(
      [pay({ id: "x", day: "2026-09-01", usd: 10, payerName: "Ali" })],
      [deal],
      [{ ...card, names: ["Ali"] }],
    );
    expect(r.side).toBe("unattributed");
  });
});

describe("totals and byPerson", () => {
  test("add up by side and by person", () => {
    const rows = attribute(
      [
        pay({ id: "p1", day: "2026-08-11", usd: 500, dealResponseId: "d1" }),
        pay({ id: "p2", day: "2026-08-20", usd: 1500, dealResponseId: "d1" }),
        pay({
          id: "p3",
          day: "2026-11-01",
          usd: 700,
          payerEmail: "login@decorplus.com",
        }),
        pay({ id: "p4", day: "2026-11-02", usd: 40, payerName: "Unknown Ltd" }),
      ],
      [deal],
      [card],
    );
    expect(totals(rows)).toEqual({
      in: 2740,
      count: 4,
      frontEnd: 2000,
      deposit: 500,
      kickoff: 1500,
      backEnd: 700,
      unattributed: 40,
      unattributedCount: 1,
    });
    const people = byPerson(rows);
    expect(people.map(p => [p.name, p.role, p.frontEnd, p.backEnd])).toEqual([
      ["Saleh", "csm", 1500, 0],
      ["Mariam", "csm", 0, 700],
      ["Ghanim", "closer", 500, 0],
    ]);
  });
});
