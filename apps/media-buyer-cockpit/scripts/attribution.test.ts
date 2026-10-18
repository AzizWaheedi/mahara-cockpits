/**
 * Every payment in gets a side, a person and a deal or a client: the Edge
 * copy of the rule that "Refresh now" publishes (contract
 * docs/money/MONEY-ATTRIBUTION.md, 2026-10-18). The native copy runs on the
 * same cases in money-attribution-parity.test.ts. Every person, client,
 * email and id here is made up.
 */
import { describe, expect, test } from "bun:test";
import {
  attribute,
  byPerson,
  type CardRef,
  type DealRef,
  dealLedgerRows,
  type PaymentIn,
  type TieRow,
  tieSummary,
  totals,
} from "../../../supabase/functions/cockpit-ceo-api/finance/attribution";

const deal: DealRef = {
  responseId: "d1",
  day: "2026-08-10",
  email: "owner@clientalpha.example.test",
  business: "Client Alpha",
  contactName: "Owner Alphaone",
  closer: "Closer One Example",
  csm: "Csm Deal Example",
  deposit: 500,
  paymentStructure: "Paid in full ($6,000)",
  contracted: 6000,
};
const monthlyDeal: DealRef = {
  ...deal,
  responseId: "d2",
  day: "2026-07-01",
  email: "m@monthly.example.test",
  business: "Monthly Co",
  contactName: null,
  paymentStructure: "Monthly",
  contracted: 3000,
};
const card: CardRef = {
  taskId: "t1",
  names: ["Client Alpha", "clientalpha.kw"],
  csm: "Csmone",
  emails: ["login@clientalpha.example.test"],
  payerKeys: ["Alpha Trading"],
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
const tie = (t: Partial<TieRow> & { id: number }): TieRow => ({
  payment_id: null,
  payer_email: null,
  payer_key: null,
  deal_response_id: null,
  clickup_task_id: null,
  not_client: false,
  note: "The CEO's note on this tie",
  evidence: null,
  set_by: "ceo@example.test",
  set_at: "2026-10-18T09:00:00+00:00",
  cleared_by: null,
  cleared_at: null,
  ...t,
});

describe("attribute: a deal's money is the closer's (rule 1)", () => {
  test("the first money up to the typed deposit is the deposit, the rest the remainder, both the closer's, full name", () => {
    const rows = attribute(
      [
        pay({ id: "p1", day: "2026-08-11", usd: 500, dealResponseId: "d1" }),
        pay({
          id: "p2",
          day: "2026-08-20",
          usd: 5500,
          payerEmail: "Owner@ClientAlpha.example.test",
        }),
      ],
      [deal],
      [card],
    );
    expect(rows.map(r => [r.side, r.kind, r.person, r.personRole])).toEqual([
      ["front_end", "deposit", "Closer One Example", "closer"],
      ["front_end", "remainder", "Closer One Example", "closer"],
    ]);
    expect(rows.map(r => r.matchedBy)).toEqual(["deal_id", "deal_email"]);
    expect(rows[0].clientTaskId).toBe("t1");
    expect(rows[0].dealResponseId).toBe("d1");
    expect(rows[0].tie).toBeNull();
  });
  test("once the deal's tied cash reaches its contract, the next payment is back end, the card's CSM's", () => {
    const rows = attribute(
      [
        pay({ id: "p1", day: "2026-08-11", usd: 500, dealResponseId: "d1" }),
        pay({ id: "p2", day: "2026-08-20", usd: 5500, dealResponseId: "d1" }),
        pay({ id: "p3", day: "2026-09-20", usd: 1000, dealResponseId: "d1" }),
      ],
      [deal],
      [card],
    );
    expect(rows.map(r => [r.side, r.kind, r.person])).toEqual([
      ["front_end", "deposit", "Closer One Example"],
      ["front_end", "remainder", "Closer One Example"],
      ["back_end", "client", "Csmone"],
    ]);
  });
  test("a payment that carries the deal over its contract (fees, exchange rate) is still front end", () => {
    const rows = attribute(
      [
        pay({ id: "p1", day: "2026-08-10", usd: 500, dealResponseId: "d1" }),
        pay({
          id: "p2",
          day: "2026-08-12",
          usd: 5528.96,
          dealResponseId: "d1",
        }),
      ],
      [deal],
      [card],
    );
    expect(rows.map(r => r.side)).toEqual(["front_end", "front_end"]);
  });
  test("more than 120 days after signing it is back end, even under the contract", () => {
    const [first, late] = attribute(
      [
        pay({
          id: "p1",
          day: "2026-08-10",
          usd: 500,
          payerEmail: "owner@clientalpha.example.test",
        }),
        pay({
          id: "p2",
          day: "2026-12-09",
          usd: 1000,
          payerEmail: "owner@clientalpha.example.test",
        }),
      ],
      [deal],
      [card],
    );
    expect(first.side).toBe("front_end");
    expect([late.side, late.person, late.matchedBy]).toEqual([
      "back_end",
      "Csmone",
      "deal_email",
    ]);
  });
  test("a monthly plan's later instalments are the closer's until the contract is collected", () => {
    const rows = attribute(
      [
        pay({
          id: "p1",
          day: "2026-07-01",
          usd: 500,
          payerEmail: "m@monthly.example.test",
        }),
        pay({
          id: "p2",
          day: "2026-07-31",
          usd: 1500,
          payerEmail: "m@monthly.example.test",
        }),
        pay({
          id: "p3",
          day: "2026-08-30",
          usd: 1000,
          payerEmail: "m@monthly.example.test",
        }),
        pay({
          id: "p4",
          day: "2026-09-29",
          usd: 1000,
          payerEmail: "m@monthly.example.test",
        }),
      ],
      [monthlyDeal],
      [],
    );
    expect(rows.map(r => [r.side, r.kind])).toEqual([
      ["front_end", "deposit"],
      ["front_end", "remainder"],
      ["front_end", "remainder"],
      ["back_end", "client"],
    ]);
    // Past the contract, with no card for the deal, the deal's own CSM.
    expect(rows[3].person).toBe("Csm Deal Example");
  });
  test("a subscription cycle follows the same cap", () => {
    const rows = attribute(
      [
        pay({
          id: "p1",
          day: "2026-07-01",
          usd: 1000,
          dealResponseId: "d2",
          billingReason: "subscription_create",
        }),
        pay({
          id: "p2",
          day: "2026-08-01",
          usd: 1000,
          dealResponseId: "d2",
          billingReason: "subscription_cycle",
        }),
        pay({
          id: "p3",
          day: "2026-09-01",
          usd: 1000,
          dealResponseId: "d2",
          billingReason: "subscription_cycle",
        }),
        pay({
          id: "p4",
          day: "2026-10-01",
          usd: 1000,
          dealResponseId: "d2",
          billingReason: "subscription_cycle",
        }),
      ],
      [monthlyDeal],
      [],
    );
    expect(rows.map(r => r.side)).toEqual([
      "front_end",
      "front_end",
      "front_end",
      "back_end",
    ]);
  });
  test("a deal with no contract typed is bounded by the 120 days alone", () => {
    const rows = attribute(
      [
        pay({ id: "p1", day: "2026-08-10", usd: 9000, dealResponseId: "d1" }),
        pay({ id: "p2", day: "2026-09-10", usd: 9000, dealResponseId: "d1" }),
      ],
      [{ ...deal, contracted: null }],
      [],
    );
    expect(rows.map(r => r.side)).toEqual(["front_end", "front_end"]);
  });
  test("a payment well before the form is not that deal's", () => {
    const [r] = attribute(
      [
        pay({
          id: "p0",
          day: "2026-06-01",
          usd: 500,
          payerEmail: "owner@clientalpha.example.test",
        }),
      ],
      [deal],
      [],
    );
    expect(r.side).toBe("unattributed");
  });
  test("two deals for one email: the nearest by payment minus deal, a form on or before the payment preferred", () => {
    const early: DealRef = { ...deal, responseId: "early", day: "2026-04-01" };
    const late: DealRef = { ...deal, responseId: "late", day: "2026-04-05" };
    const rows = attribute(
      [
        pay({
          id: "a",
          day: "2026-04-03",
          usd: 100,
          payerEmail: "owner@clientalpha.example.test",
        }),
        pay({
          id: "b",
          day: "2026-04-06",
          usd: 100,
          payerEmail: "owner@clientalpha.example.test",
        }),
      ],
      [early, late],
      [],
    );
    // 2 days after "early" beats 2 days before "late"; 1 day after "late" beats 5 after "early".
    expect(rows.map(r => r.dealResponseId)).toEqual(["early", "late"]);
  });
});

describe("attribute: a card match inside a deal's term is that deal's money (rule 2)", () => {
  test("a payer mapped to the card while its deal is still collecting is front end, the closer's", () => {
    const rows = attribute(
      [
        pay({ id: "p1", day: "2026-08-10", usd: 500, dealResponseId: "d1" }),
        pay({
          id: "p2",
          day: "2026-08-12",
          usd: 5500,
          rail: "tap",
          payerName: "ALPHA TRADING",
        }),
      ],
      [deal],
      [card],
    );
    expect(rows[1]).toMatchObject({
      side: "front_end",
      kind: "remainder",
      person: "Closer One Example",
      dealResponseId: "d1",
      matchedBy: "card_payer",
    });
  });
  test("a client is matched by portal login, hand mapping, name or the typed card; with no deal it is back end", () => {
    const rows = attribute(
      [
        pay({
          id: "a",
          day: "2027-01-01",
          usd: 10,
          payerEmail: "login@clientalpha.example.test",
        }),
        pay({
          id: "b",
          day: "2027-01-01",
          usd: 10,
          payerName: "alpha trading",
        }),
        pay({
          id: "c",
          day: "2027-01-01",
          usd: 10,
          payerName: "ClientAlpha KW",
        }),
        pay({
          id: "d",
          day: "2027-01-01",
          usd: 10,
          clickupTaskId: "t1",
          rail: "manual",
        }),
        pay({ id: "e", day: "2027-01-01", usd: 10, payerName: "Nobody Known" }),
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
        .every(r => r.side === "back_end" && r.person === "Csmone"),
    ).toBe(true);
    expect(rows[4].side).toBe("unattributed");
  });
  test("a payer under their own name, or a longer business name, still meets the deal", () => {
    const rows = attribute(
      [
        pay({
          id: "n1",
          day: "2026-08-12",
          usd: 500,
          payerName: "Owner Alphaone",
        }),
        pay({
          id: "n2",
          day: "2026-08-13",
          usd: 700,
          payerName: "CLIENT ALPHA CO.",
        }),
      ],
      [deal],
      [],
    );
    expect(rows.map(r => [r.matchedBy, r.kind])).toEqual([
      ["deal_name", "deposit"],
      ["deal_name", "remainder"],
    ]);
  });
  test("short names never match by accident", () => {
    const [r] = attribute(
      [pay({ id: "x", day: "2026-09-01", usd: 10, payerName: "Ali" })],
      [{ ...deal, contactName: "Ali ." }],
      [{ ...card, names: ["Ali"] }],
    );
    expect(r.side).toBe("unattributed");
  });
});

describe("attribute: the CEO's tie wins (rules 3 and 4)", () => {
  const other: DealRef = {
    ...deal,
    responseId: "d9",
    day: "2026-10-02",
    email: "placeholder@example.test",
    business: "Client Omega",
    contactName: "Omar .",
    closer: "Closer Two Example",
    deposit: 500,
    contracted: 6000,
  };
  test("a payer-email tie credits every payment from that payer to the deal's closer", () => {
    const rows = attribute(
      [
        pay({
          id: "w1",
          day: "2026-10-01",
          usd: 500,
          payerEmail: "omar.payer@example.test",
          payerName: "Omar Payerfamily",
        }),
        pay({
          id: "w2",
          day: "2026-10-07",
          usd: 1500,
          payerEmail: "OMAR.PAYER@example.test",
          payerName: "Omar Payerfamily",
        }),
      ],
      [deal, other],
      [card],
      [
        tie({
          id: 4,
          payer_email: "omar.payer@example.test",
          deal_response_id: "d9",
        }),
      ],
    );
    expect(
      rows.map(r => [r.side, r.kind, r.person, r.matchedBy, r.tie?.id]),
    ).toEqual([
      ["front_end", "deposit", "Closer Two Example", "ceo", 4],
      ["front_end", "remainder", "Closer Two Example", "ceo", 4],
    ]);
    expect(rows[0].tie).toEqual({
      id: 4,
      scope: "payer",
      note: "The CEO's note on this tie",
      setBy: "ceo@example.test",
      setAt: "2026-10-18T09:00:00+00:00",
    });
  });
  test("a payment tie beats a payer tie and Whop's own link", () => {
    const [r] = attribute(
      [
        pay({
          id: "whop:pay_x",
          day: "2026-10-03",
          usd: 500,
          dealResponseId: "d1",
          payerEmail: "omar.payer@example.test",
        }),
      ],
      [deal, other],
      [card],
      [
        tie({
          id: 1,
          payer_email: "omar.payer@example.test",
          deal_response_id: "d1",
        }),
        tie({ id: 2, payment_id: "whop:pay_x", deal_response_id: "d9" }),
      ],
    );
    expect([r.dealResponseId, r.matchedBy, r.tie?.scope]).toEqual([
      "d9",
      "ceo",
      "payment",
    ]);
  });
  test("a not-client tie keeps the payment out of client money", () => {
    const rows = attribute(
      [
        pay({
          id: "bank:7",
          day: "2026-10-03",
          usd: 900,
          rail: "transfer",
          payerName: "Client Alpha",
        }),
      ],
      [deal],
      [card],
      [tie({ id: 3, payment_id: "bank:7", not_client: true })],
    );
    expect(rows[0]).toMatchObject({
      side: "not_client",
      kind: "none",
      person: null,
      clientTaskId: null,
      matchedBy: "ceo",
    });
    expect(totals(rows)).toMatchObject({
      in: 900,
      notClient: 900,
      notClientCount: 1,
      unattributed: 0,
      unattributedCount: 0,
    });
  });
  test("a tie to a card runs rule 2: inside the deal's term it is the deal's money", () => {
    const [r] = attribute(
      [
        pay({
          id: "tap:9",
          day: "2026-08-12",
          usd: 2000,
          rail: "tap",
          payerName: "Someone Else",
        }),
      ],
      [deal],
      [card],
      [tie({ id: 5, payment_id: "tap:9", clickup_task_id: "t1" })],
    );
    expect([r.side, r.dealResponseId, r.person, r.matchedBy]).toEqual([
      "front_end",
      "d1",
      "Closer One Example",
      "ceo",
    ]);
  });
  test("a payer key ties only on the exact key and never on a short name; a tie whose deal is gone is listed and the payment falls back", () => {
    const rows = attribute(
      [
        pay({
          id: "k1",
          day: "2026-10-04",
          usd: 300,
          payerName: "Omar Payerfamily",
        }),
        pay({ id: "k2", day: "2026-10-04", usd: 300, payerName: "Omar" }),
        pay({
          id: "k3",
          day: "2026-10-05",
          usd: 300,
          payerEmail: "gone@example.test",
        }),
      ],
      [other],
      [],
      [
        tie({ id: 6, payer_key: "omarpayerfamily", deal_response_id: "d9" }),
        tie({ id: 7, payer_key: "omar", deal_response_id: "d9" }),
        tie({
          id: 8,
          payer_email: "gone@example.test",
          deal_response_id: "voided-deal",
        }),
        tie({ id: 9, payment_id: "whop:not-this-run", deal_response_id: "d9" }),
        tie({
          id: 10,
          payment_id: "k1",
          deal_response_id: "d9",
          cleared_at: "2026-10-18T10:00:00Z",
        }),
      ],
    );
    expect(rows.map(r => [r.id, r.matchedBy, r.tie?.id ?? null])).toEqual([
      ["k1", "ceo", 6],
      ["k2", "none", null],
      ["k3", "none", null],
    ]);
    expect(
      tieSummary(
        [
          tie({ id: 6, payer_key: "omarpayerfamily", deal_response_id: "d9" }),
          tie({ id: 7, payer_key: "omar", deal_response_id: "d9" }),
          tie({
            id: 8,
            payer_email: "gone@example.test",
            deal_response_id: "voided-deal",
          }),
          tie({
            id: 9,
            payment_id: "whop:not-this-run",
            deal_response_id: "d9",
          }),
        ],
        rows,
        [other],
        [],
      ),
    ).toEqual({
      live: 4,
      applied: 1,
      payments: 1,
      notApplied: [
        { id: 7, scope: "payer", why: "payer_key_too_short" },
        { id: 8, scope: "payer", why: "deal_not_in_run" },
        { id: 9, scope: "payment", why: "no_payment_in_run" },
      ],
      beforeDeal: [],
    });
  });

  test("a payer tie covers the deal's money from 7 days before the form; a payment tie takes even an earlier one", () => {
    // A returning client: an old deal in March, a new one in September, and the CEO's payer tie to the new one.
    const old: DealRef = {
      ...deal,
      responseId: "d-old",
      day: "2026-03-01",
      email: "back@returning.example.test",
      business: "Returning Old Example",
      closer: "Closer Old Example",
    };
    const fresh: DealRef = {
      ...old,
      responseId: "d-new",
      day: "2026-09-10",
      business: "Returning New Example",
      closer: "Closer New Example",
    };
    const payments = [
      pay({ id: "w1", day: "2026-03-02", usd: 3000, payerEmail: "back@returning.example.test" }),
      pay({ id: "w2", day: "2026-04-01", usd: 3000, payerEmail: "back@returning.example.test" }),
      pay({ id: "w3", day: "2026-09-11", usd: 500, payerEmail: "back@returning.example.test" }),
      pay({ id: "w4", day: "2026-09-20", usd: 5500, payerEmail: "back@returning.example.test" }),
    ];
    const ties = [tie({ id: 21, payer_email: "back@returning.example.test", deal_response_id: "d-new" })];
    const rows = attribute(payments, [old, fresh], [], ties);
    expect(rows.map(r => [r.id, r.side, r.dealResponseId, r.person, r.matchedBy, r.tie?.id ?? null])).toEqual([
      ["w1", "front_end", "d-old", "Closer Old Example", "deal_email", null],
      ["w2", "front_end", "d-old", "Closer Old Example", "deal_email", null],
      ["w3", "front_end", "d-new", "Closer New Example", "ceo", 21],
      ["w4", "front_end", "d-new", "Closer New Example", "ceo", 21],
    ]);
    expect(tieSummary(ties, rows, [old, fresh], [])).toEqual({
      live: 1,
      applied: 1,
      payments: 2,
      notApplied: [],
      beforeDeal: [{ id: 21, scope: "payer", payments: 2, usd: 6000 }],
    });
    // Only the early payments in scope: the tie credited nothing, and says why.
    const early = attribute(payments.slice(0, 2), [old, fresh], [], ties);
    expect(tieSummary(ties, early, [old, fresh], []).notApplied).toEqual([
      { id: 21, scope: "payer", why: "before_deal" },
    ]);
    // The CEO's tie on the one payment is taken, however early.
    const one = attribute(payments.slice(0, 1), [old, fresh], [], [tie({ id: 22, payment_id: "w1", deal_response_id: "d-new" })]);
    expect([one[0].dealResponseId, one[0].matchedBy, one[0].side]).toEqual(["d-new", "ceo", "front_end"]);
  });
});

describe("the deposit is the part up to the typed deposit (rule 1)", () => {
  test("one paid-in-full payment is the deposit and the remainder; a later payment is all remainder", () => {
    const rows = attribute(
      [
        pay({ id: "q1", day: "2026-08-11", usd: 5608.8, dealResponseId: "d1" }),
        pay({ id: "q2", day: "2026-08-20", usd: 391.2, dealResponseId: "d1" }),
      ],
      [deal],
      [card],
    );
    expect(rows.map(r => [r.id, r.kind, r.depositUsd])).toEqual([
      ["q1", "deposit", 500],
      ["q2", "remainder", 0],
    ]);
    expect(totals(rows)).toMatchObject({ frontEnd: 6000, deposit: 500, remainder: 5500 });
    expect(dealLedgerRows(rows).map(r => [r.payment_id, r.kind, r.deposit_usd])).toEqual([
      ["q1", "deposit", 500],
      ["q2", "remainder", 0],
    ]);
    // A deposit paid in two parts; with none typed, the first payment is the deposit.
    const parts = attribute(
      [
        pay({ id: "r1", day: "2026-08-11", usd: 300, dealResponseId: "d1" }),
        pay({ id: "r2", day: "2026-08-12", usd: 1000, dealResponseId: "d1" }),
      ],
      [deal],
      [card],
    );
    expect(parts.map(r => r.depositUsd)).toEqual([300, 200]);
    const untyped = attribute(
      [
        pay({ id: "s1", day: "2026-08-11", usd: 900, dealResponseId: "d1" }),
        pay({ id: "s2", day: "2026-08-12", usd: 100, dealResponseId: "d1" }),
      ],
      [{ ...deal, deposit: 0 }],
      [card],
    );
    expect(untyped.map(r => [r.kind, r.depositUsd])).toEqual([
      ["deposit", 900],
      ["remainder", 0],
    ]);
  });
});

describe("totals, byPerson and the deal ledger", () => {
  test("add up by side and by person; the ledger is every front-end payment", () => {
    const rows = attribute(
      [
        pay({ id: "p1", day: "2026-08-11", usd: 500, dealResponseId: "d1" }),
        pay({ id: "p2", day: "2026-08-20", usd: 1500, dealResponseId: "d1" }),
        pay({
          id: "p3",
          day: "2027-01-02",
          usd: 700,
          payerEmail: "login@clientalpha.example.test",
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
      remainder: 1500,
      kickoff: 1500,
      backEnd: 700,
      unattributed: 40,
      unattributedCount: 1,
      notClient: 0,
      notClientCount: 0,
    });
    expect(
      byPerson(rows).map(p => [p.name, p.role, p.frontEnd, p.backEnd]),
    ).toEqual([
      ["Closer One Example", "closer", 2000, 0],
      ["Csmone", "csm", 0, 700],
    ]);
    expect(dealLedgerRows(rows)).toEqual([
      {
        payment_id: "p1",
        deal_response_id: "d1",
        day: "2026-08-11",
        usd: 500,
        rail: "whop",
        kind: "deposit",
        deposit_usd: 500,
        matched_by: "deal_id",
        tie_id: null,
        payer: null,
      },
      {
        payment_id: "p2",
        deal_response_id: "d1",
        day: "2026-08-20",
        usd: 1500,
        rail: "whop",
        kind: "remainder",
        deposit_usd: 0,
        matched_by: "deal_id",
        tie_id: null,
        payer: null,
      },
    ]);
  });
});
