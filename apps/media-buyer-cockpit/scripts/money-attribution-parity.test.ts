/**
 * The two live copies of the money attribution rule decide the same:
 * the native worker's (hermes/ceo-refresh/native/adapters/money.js, every 15
 * minutes) and the Edge Function's (supabase/functions/cockpit-ceo-api/
 * finance/attribution.ts, "Refresh now"). Contract
 * docs/money/MONEY-ATTRIBUTION.md section 2: both copies run the same made-up
 * fixtures and must give the same rows, totals, people, ties and deal
 * ledger. Every person, client, email and id here is made up.
 */
import { describe, expect, test } from "bun:test";
import * as native from "../../../hermes/ceo-refresh/native/adapters/money.js";
import type {
  Attributed,
  CardRef,
  DealRef,
  PaymentIn,
  TieRow,
} from "../../../supabase/functions/cockpit-ceo-api/finance/attribution";
import * as edge from "../../../supabase/functions/cockpit-ceo-api/finance/attribution";
import { money as edgeMoney } from "../../../supabase/functions/cockpit-ceo-api/finance/adapters/money";
import { financeContext } from "../../../supabase/functions/cockpit-ceo-api/finance/context";
import { withFinanceRuntime } from "../../../supabase/functions/cockpit-ceo-api/finance/runtime";
import { withRuntime } from "../../../hermes/ceo-refresh/runtime";

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
const deal = (
  d: Partial<DealRef> & { responseId: string; day: string; business: string },
): DealRef => ({
  email: null,
  contactName: null,
  closer: "Closer One Example",
  csm: "Csm Deal Example",
  deposit: 500,
  paymentStructure: "Paid in full ($6,000)",
  contracted: 6000,
  ...d,
});
const tie = (t: Partial<TieRow> & { id: number }): TieRow => ({
  payment_id: null,
  payer_email: null,
  payer_key: null,
  deal_response_id: null,
  clickup_task_id: null,
  not_client: false,
  note: "The CEO: this payer is that deal's client",
  evidence: null,
  set_by: "ceo@example.test",
  set_at: "2026-10-18T09:00:00+00:00",
  cleared_by: null,
  cleared_at: null,
  ...t,
});

const DEALS: DealRef[] = [
  deal({
    responseId: "deal-pif",
    day: "2026-10-13",
    business: "Client B Example",
    email: "owner@client-b.example.test",
  }),
  deal({
    responseId: "deal-card",
    day: "2026-09-12",
    business: "Client Card Example",
    email: "deal@card.example.test",
    closer: "Closer Two Example",
  }),
  deal({
    responseId: "deal-cap",
    day: "2026-07-01",
    business: "Client Cap Example",
    email: "cap@cap.example.test",
    contracted: 2000,
  }),
  deal({
    responseId: "deal-old",
    day: "2026-03-01",
    business: "Client Term Example",
    email: "term@term.example.test",
  }),
  deal({
    responseId: "deal-tie",
    day: "2026-10-02",
    business: "Client Tied Example",
    email: "placeholder@example.test",
    contactName: "Payer .",
    paymentStructure: "Monthly",
    contracted: 6000,
  }),
  deal({
    responseId: "deal-sub",
    day: "2026-06-01",
    business: "Client Subscription Example",
    email: "sub@sub.example.test",
    paymentStructure: "Monthly",
    contracted: 3000,
    deposit: 1000,
  }),
  deal({
    responseId: "deal-solo",
    day: "2026-08-14",
    business: "Client Solo Example",
    email: "solo@solo.example.test",
    contracted: 5608.8,
  }),
  deal({
    responseId: "deal-early",
    day: "2026-04-01",
    business: "Client Twice Example",
    email: "twice@twice.example.test",
  }),
  deal({
    responseId: "deal-late",
    day: "2026-04-05",
    business: "Client Twice Again Example",
    email: "twice@twice.example.test",
    closer: "Closer Two Example",
  }),
];
const CARDS: CardRef[] = [
  {
    taskId: "card-b",
    names: ["Client B Example"],
    csm: "Csmone",
    emails: [],
    payerKeys: [],
  },
  {
    taskId: "card-card",
    names: ["Client Card Example"],
    csm: "Csmtwo",
    emails: ["login@card.example.test"],
    payerKeys: ["Card Payer Example"],
  },
  {
    taskId: "card-cap",
    names: ["Client Cap Example"],
    csm: "Csmthree",
    emails: [],
    payerKeys: [],
  },
  {
    taskId: "card-term",
    names: ["Client Term Example"],
    csm: "Csmfour",
    emails: [],
    payerKeys: [],
  },
];
const TIES: TieRow[] = [
  tie({
    id: 11,
    payer_email: "payer.tied@example.test",
    deal_response_id: "deal-tie",
  }),
  tie({
    id: 12,
    payment_id: "whop:pay_tied_card",
    deal_response_id: "deal-pif",
  }),
  tie({
    id: 13,
    payment_id: "bank:77",
    not_client: true,
    note: "Own transfer between our accounts",
  }),
  tie({
    id: 14,
    payer_email: "nobody@example.test",
    deal_response_id: "deal-gone",
  }),
  // The CEO's word on one payment months before the deal: taken.
  tie({
    id: 15,
    payment_id: "whop:pay_old_tied",
    deal_response_id: "deal-card",
  }),
];
const PAYMENTS: PaymentIn[] = [
  // Deposit, then the rest: both the closer's.
  pay({
    id: "whop:pay_dep",
    day: "2026-10-13",
    usd: 500,
    dealResponseId: "deal-pif",
  }),
  pay({
    id: "whop:pay_rest",
    day: "2026-10-17",
    usd: 5500,
    payerEmail: "OWNER@client-b.example.test",
  }),
  // A card match inside its deal's term: front end, the closer's.
  pay({
    id: "whop:pay_card_dep",
    day: "2026-09-12",
    usd: 500,
    payerEmail: "deal@card.example.test",
  }),
  pay({
    id: "tap:chg_card",
    day: "2026-09-13",
    usd: 5496.36,
    rail: "tap",
    payerName: "Card Payer Example",
  }),
  // The contract cap: past $2,000 it is back end.
  pay({
    id: "whop:pay_cap1",
    day: "2026-07-01",
    usd: 1500,
    payerEmail: "cap@cap.example.test",
  }),
  pay({
    id: "whop:pay_cap2",
    day: "2026-07-20",
    usd: 500,
    payerEmail: "cap@cap.example.test",
  }),
  pay({
    id: "whop:pay_cap3",
    day: "2026-08-20",
    usd: 500,
    payerEmail: "cap@cap.example.test",
  }),
  // 120 days: past them it is back end, though the contract is not collected.
  pay({
    id: "whop:pay_term1",
    day: "2026-03-01",
    usd: 500,
    payerEmail: "term@term.example.test",
  }),
  pay({
    id: "whop:pay_term2",
    day: "2026-07-01",
    usd: 1000,
    payerEmail: "term@term.example.test",
  }),
  // A payer-email tie: both payments the tied deal's closer's.
  pay({
    id: "whop:pay_tie1",
    day: "2026-10-01",
    usd: 500,
    payerEmail: "payer.tied@example.test",
    payerName: "Payer Tiedfamily",
  }),
  pay({
    id: "whop:pay_tie2",
    day: "2026-10-07",
    usd: 1500,
    payerEmail: "payer.tied@example.test",
    payerName: "Payer Tiedfamily",
  }),
  // A payer tie leaves a payment 30 days before its deal's form to the automatic rules.
  pay({
    id: "whop:pay_tie_early",
    day: "2026-09-02",
    usd: 3000,
    payerEmail: "payer.tied@example.test",
    payerName: "Payer Tiedfamily",
  }),
  // A payment tie months before its deal's form is the CEO's word: taken.
  pay({
    id: "whop:pay_old_tied",
    day: "2026-06-01",
    usd: 100,
  }),
  // A paid-in-full payment: the deposit and the remainder in one.
  pay({
    id: "whop:pay_pif_one",
    day: "2026-08-15",
    usd: 5608.8,
    payerEmail: "solo@solo.example.test",
  }),
  // A payment tie that beats the card the payer would have matched.
  pay({
    id: "whop:pay_tied_card",
    day: "2026-10-15",
    usd: 250,
    payerEmail: "login@card.example.test",
  }),
  // A not-client tie.
  pay({
    id: "bank:77",
    day: "2026-10-03",
    usd: 900,
    rail: "transfer",
    payerName: "Client B Example",
  }),
  // Subscription cycles follow the same cap.
  pay({
    id: "whop:pay_sub1",
    day: "2026-06-01",
    usd: 1000,
    dealResponseId: "deal-sub",
    billingReason: "subscription_create",
  }),
  pay({
    id: "whop:pay_sub2",
    day: "2026-07-01",
    usd: 1000,
    dealResponseId: "deal-sub",
    billingReason: "subscription_cycle",
  }),
  pay({
    id: "whop:pay_sub3",
    day: "2026-08-01",
    usd: 1000,
    dealResponseId: "deal-sub",
    billingReason: "subscription_cycle",
  }),
  pay({
    id: "whop:pay_sub4",
    day: "2026-09-01",
    usd: 1000,
    dealResponseId: "deal-sub",
    billingReason: "subscription_cycle",
  }),
  // Two deals for one email: nearest by payment minus deal.
  pay({
    id: "whop:pay_twice1",
    day: "2026-04-03",
    usd: 100,
    payerEmail: "twice@twice.example.test",
  }),
  pay({
    id: "whop:pay_twice2",
    day: "2026-04-06",
    usd: 100,
    payerEmail: "twice@twice.example.test",
  }),
  // Matches nothing.
  pay({
    id: "whop:pay_none",
    day: "2026-10-10",
    usd: 40,
    payerName: "Unknown Payer Example",
  }),
];

const runNative = (
  payments = PAYMENTS,
  deals = DEALS,
  cards = CARDS,
  ties = TIES,
): Attributed[] =>
  native.attributePayments(payments, deals, cards, ties) as Attributed[];
const runEdge = (
  payments = PAYMENTS,
  deals = DEALS,
  cards = CARDS,
  ties = TIES,
): Attributed[] => edge.attribute(payments, deals, cards, ties);
const byId = (rows: Attributed[]) => new Map(rows.map(r => [r.id, r]));

describe("both copies decide every payment the same", () => {
  test("rows, totals, people, ties, the deal ledger and the words agree", () => {
    const n = runNative();
    const e = runEdge();
    expect(n).toEqual(e);
    expect(native.attributionTotals(n)).toEqual(edge.totals(e));
    expect(native.attributionByPerson(n)).toEqual(edge.byPerson(e));
    expect(native.tieSummary(TIES, n, DEALS, CARDS)).toEqual(
      edge.tieSummary(TIES, e, DEALS, CARDS),
    );
    expect(native.dealLedgerRows(n)).toEqual(edge.dealLedgerRows(e));
    const t = edge.totals(e);
    expect(
      native.attributionRuleText(t.unattributedCount, t.unattributed),
    ).toBe(edge.attributionRuleText(t.unattributedCount, t.unattributed));
    const ties = edge.tieSummary(TIES, e, DEALS, CARDS);
    expect(native.tieNoteText(ties)).toBe(edge.tieNoteText(ties));
    expect(native.normalizeTies(TIES)).toEqual(edge.normalizeTies(TIES));
    expect([native.BEFORE_FORM_DAYS, native.DEAL_TERM_DAYS]).toEqual([
      edge.BEFORE_FORM_DAYS,
      edge.DEAL_TERM_DAYS,
    ]);
  });

  test("and what they agree on is the contract", () => {
    const rows = byId(runNative());
    const look = (id: string) => {
      const r = rows.get(id);
      return [
        r?.side,
        r?.kind,
        r?.person,
        r?.dealResponseId ?? null,
        r?.matchedBy,
      ];
    };
    expect(look("whop:pay_dep")).toEqual([
      "front_end",
      "deposit",
      "Closer One Example",
      "deal-pif",
      "deal_id",
    ]);
    expect(look("whop:pay_rest")).toEqual([
      "front_end",
      "remainder",
      "Closer One Example",
      "deal-pif",
      "deal_email",
    ]);
    expect(look("tap:chg_card")).toEqual([
      "front_end",
      "remainder",
      "Closer Two Example",
      "deal-card",
      "card_payer",
    ]);
    expect(look("whop:pay_cap2")).toEqual([
      "front_end",
      "remainder",
      "Closer One Example",
      "deal-cap",
      "deal_email",
    ]);
    expect(look("whop:pay_cap3")).toEqual([
      "back_end",
      "client",
      "Csmthree",
      "deal-cap",
      "deal_email",
    ]);
    expect(look("whop:pay_term2")).toEqual([
      "back_end",
      "client",
      "Csmfour",
      "deal-old",
      "deal_email",
    ]);
    expect(look("whop:pay_tie1")).toEqual([
      "front_end",
      "deposit",
      "Closer One Example",
      "deal-tie",
      "ceo",
    ]);
    expect(look("whop:pay_tie2")).toEqual([
      "front_end",
      "remainder",
      "Closer One Example",
      "deal-tie",
      "ceo",
    ]);
    expect(look("whop:pay_tied_card")).toEqual([
      "front_end",
      "remainder",
      "Closer One Example",
      "deal-pif",
      "ceo",
    ]);
    expect(look("bank:77")).toEqual(["not_client", "none", null, null, "ceo"]);
    // A payer tie does not reach a payment 30 days before its deal's form; a payment tie does.
    expect(look("whop:pay_tie_early")).toEqual([
      "unattributed",
      "none",
      null,
      null,
      "none",
    ]);
    expect(rows.get("whop:pay_tie_early")?.tie).toBeNull();
    expect(look("whop:pay_old_tied")).toEqual([
      "front_end",
      "deposit",
      "Closer Two Example",
      "deal-card",
      "ceo",
    ]);
    // One paid-in-full payment: $500 of it is the deposit, the rest the remainder.
    expect(rows.get("whop:pay_pif_one")?.depositUsd).toBe(500);
    expect(rows.get("whop:pay_tie1")?.depositUsd).toBe(500);
    expect(rows.get("whop:pay_tie2")?.depositUsd).toBe(0);
    expect(
      ["whop:pay_sub1", "whop:pay_sub2", "whop:pay_sub3", "whop:pay_sub4"].map(
        id => rows.get(id)?.side,
      ),
    ).toEqual(["front_end", "front_end", "front_end", "back_end"]);
    expect(
      ["whop:pay_twice1", "whop:pay_twice2"].map(
        id => rows.get(id)?.dealResponseId,
      ),
    ).toEqual(["deal-early", "deal-late"]);
    expect(look("whop:pay_none")).toEqual([
      "unattributed",
      "none",
      null,
      null,
      "none",
    ]);
    expect(rows.get("whop:pay_tie1")?.tie).toEqual({
      id: 11,
      scope: "payer",
      note: "The CEO: this payer is that deal's client",
      setBy: "ceo@example.test",
      setAt: "2026-10-18T09:00:00+00:00",
    });
    const summary = native.tieSummary(TIES, [...rows.values()], DEALS, CARDS);
    expect(summary.notApplied).toEqual([
      { id: 14, scope: "payer", why: "deal_not_in_run" },
    ]);
    expect(summary.beforeDeal).toEqual([
      { id: 11, scope: "payer", payments: 1, usd: 3000 },
    ]);
    expect(native.tieNoteText(summary)).toContain(
      "tie 11 leaves 1 payment ($3,000)",
    );
  });

  test("each case alone, in every order the payments may come, still agrees", () => {
    for (const p of PAYMENTS) {
      expect(runNative([p])).toEqual(runEdge([p]));
    }
    const reversed = [...PAYMENTS].reverse();
    expect(runNative(reversed)).toEqual(runEdge(reversed));
    expect(runNative(PAYMENTS, DEALS, CARDS, [])).toEqual(
      runEdge(PAYMENTS, DEALS, CARDS, []),
    );
    expect(runNative(PAYMENTS, [], CARDS, TIES)).toEqual(
      runEdge(PAYMENTS, [], CARDS, TIES),
    );
  });
});

describe("both copies build the same client cards (contract section 2)", () => {
  // Made-up snapshot rows: a card on billing only (a new client, no alias row
  // yet), a card with aliases and a CSM, logins and a hand-kept payer.
  const snapshot = {
    billing: [
      { clickup_task_id: "card-new", client_name: "Client New Example", captured_at: "2026-10-17T00:00:00Z" },
      { clickup_task_id: "card-old", client_name: "Client Old Example", captured_at: "2026-10-17T00:00:00Z" },
    ],
    aliases: [
      { task_id: "card-old", name: "Client Old Example", aliases: ["Old Example Co —  Branch"], csm: "Csmold Person" },
      { task_id: "card-old", name: "Client Old Example", aliases: [], csm: "Csmother Person" },
      { task_id: null, name: "Unmapped", aliases: [] },
    ],
    payers: [{ payer_key: "newpayerfamily", payer: "New Payer Family", clickup_task_id: "card-new" }],
    manual: [],
    series: [],
    newestManualChange: null,
  };
  const logins = [
    { email: "Owner@New.example.test", clickup_id: "card-new" },
    { email: "ops@old.example.test", clickup_id: "card-old" },
    { email: "stray@example.test", clickup_id: "card-unknown" },
  ];
  const edgeCards = async () => {
    const loaded = await financeContext(snapshot).runQuery("manual", {
      from: "2026-01-01",
      month: "2026-10",
    });
    return edge.cardRefs(loaded.cards, logins, snapshot.payers);
  };

  test("billing first, then aliases; logins and payers on the card", async () => {
    const n = native.cardReferences(snapshot, logins);
    expect(await edgeCards()).toEqual(n);
    expect(n).toEqual([
      {
        taskId: "card-new",
        names: ["Client New Example"],
        csm: null,
        emails: ["owner@new.example.test"],
        payerKeys: ["newpayerfamily", "New Payer Family"],
      },
      {
        taskId: "card-old",
        names: ["Client Old Example", "Old Example Co , Branch"],
        csm: "Csmold",
        emails: ["ops@old.example.test"],
        payerKeys: [],
      },
    ]);
  });

  test("a billing-only card matched inside its deal's term is front end in both copies", async () => {
    const cards = await edgeCards();
    const deals = [
      deal({
        responseId: "deal-new",
        day: "2026-10-12",
        business: "Client New Example",
        email: "form@new.example.test",
        closer: "Closer New Example",
      }),
    ];
    const payments = [
      // A hand-logged entry with the card typed, and a payer mapped by hand.
      pay({ id: "manual:m-new", rail: "manual", day: "2026-10-17", usd: 5500, payerName: "Someone Else", clickupTaskId: "card-new" }),
      pay({ id: "tap:chg_new", rail: "tap", day: "2026-10-12", usd: 500, payerName: "New Payer Family" }),
    ];
    const n = runNative(payments, deals, native.cardReferences(snapshot, logins), []);
    expect(runEdge(payments, deals, cards, [])).toEqual(n);
    expect(n.map(r => [r.id, r.side, r.person, r.clientTaskId, r.matchedBy])).toEqual([
      ["tap:chg_new", "front_end", "Closer New Example", "card-new", "card_payer"],
      ["manual:m-new", "front_end", "Closer New Example", "card-new", "card_typed"],
    ]);
  });
});

describe("both money adapters read the same inputs the same way (contract section 2)", () => {
  // One made-up finance snapshot and one set of made-up database rows, run
  // through the whole native adapter (every 15 minutes) and the whole Edge
  // adapter ("Refresh now"). Each reader gives rows in the order the query
  // asks for and, with no ORDER BY, in the order stored, as Postgres may.
  const now = Date.now();
  const today = new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
  const ago = (n: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000)
      .toISOString()
      .slice(0, 10);
  const stamp = new Date(now).toISOString();
  type Row = Record<string, unknown>;

  const snapshot = {
    revision: 3,
    totals_revision: 0,
    history_ready: true,
    aliases_ready: true,
    manual_ready: true,
    updated_at: stamp,
    newestManualChange: stamp,
    billing: [
      // A new client on billing only: no alias row yet.
      { clickup_task_id: "card-new", client_name: "Client New Example", csm: "Csmnew Person", stage: "Active", mrr_usd: 1000, ltv_usd: 5500, payment_plan: "Paid In Full", captured_at: stamp },
      { clickup_task_id: "card-old", client_name: "Client Old Example", stage: "Active", mrr_usd: 750, ltv_usd: 9000, payment_plan: "Monthly", captured_at: stamp },
    ],
    aliases: [{ task_id: "card-old", name: "Client Old Example", aliases: ["Old Example Co"], csm: "Csmold Person" }],
    payers: [{ payer_key: "oldpayerfamily", payer: "Old Payer Family", clickup_task_id: "card-old" }],
    ties: [
      tie({ id: 21, payment_id: "whop:pay_tied", deal_response_id: "deal-same-b" }),
    ],
    manual: [
      // Spaces and a dash in the client typed by hand.
      { id: "m-old", day: ago(3), amount: 1000, currency: "USD", amount_usd: 1000, usd_per_unit: 1, client_name: "Client  Old — Example", clickup_task_id: null, rail: "cash", kind: "payment", deal_contracted: null, deal_contracted_usd: null, note: null, added_at: stamp, deleted_at: null },
      // Dated after today: not money in yet.
      { id: "m-future", day: ago(-3), amount: 100, currency: "USD", amount_usd: 100, usd_per_unit: 1, client_name: "Client Old Example", clickup_task_id: "card-old", rail: "cash", kind: "payment", deal_contracted: null, deal_contracted_usd: null, note: null, added_at: stamp, deleted_at: null },
    ],
    series: [],
    exclusions: [],
    statements: [
      { id: "st-1", account: "XXXX0001", account_kind: "account", from_day: ago(40), to_day: ago(2), lines: 4, imported_at: stamp },
    ],
    bank_lines: [
      { id: 1, statement_id: "st-1", day: ago(8), usd: 326, amount: 100, currency: "KWD", reference: "Transfer  from   Client Old Example", account: "XXXX0001", kind: "client_payment" },
      { id: 2, statement_id: "st-1", day: ago(8), usd: -32.6, amount: -10, currency: "KWD", reference: "Software vendor", account: "XXXX0001", kind: "expense", category: "software" },
      // A Tap settlement: it credits nobody, the charge it covers does.
      { id: 3, statement_id: "st-1", day: ago(28), usd: 400, amount: 122.7, currency: "KWD", reference: "Tap settlement", account: "XXXX0001", kind: "tap_settlement" },
      // A debit classed as a client payment is no payment in.
      { id: 4, statement_id: "st-1", day: ago(7), usd: -50, amount: -15.34, currency: "KWD", reference: "Reversal Client Old Example", account: "XXXX0001", kind: "client_payment" },
    ],
  };

  // Two forms for one email on one day, stored newest first: the copies must
  // read them in form order to pick the same one.
  const dealRows: Row[] = [
    { response_id: "deal-new", submitted_at: `${ago(6)}T15:00:00Z`, day: ago(6), email: "form@new.example.test", business: "Client New Example", contact: "Payer  Newfamily", closer: "Closer  New   Example", csm: "Csm  Deal Example", cash_collected: 500, payment_structure: "Paid in full ($5,500)", contracted: 5500 },
    { response_id: "deal-same-b", submitted_at: `${ago(10)}T15:00:00Z`, day: ago(10), email: "same@same.example.test", business: "Client Same Late Example", contact: null, closer: "Closer Two Example", csm: null, cash_collected: 500, payment_structure: "Monthly", contracted: 3000 },
    { response_id: "deal-same-a", submitted_at: `${ago(10)}T09:00:00Z`, day: ago(10), email: "same@same.example.test", business: "Client Same Early Example", contact: null, closer: "Closer One Example", csm: null, cash_collected: 500, payment_structure: "Monthly", contracted: 3000 },
  ];
  const whop = (r: Row): Row => ({ final_amount: r.net_amount, refunded_amount: 0, refund_day: null, email: null, billing: null, username: null, deal_response_id: null, billing_reason: "one_time", ...r });
  const whopRows: Row[] = [
    whop({ payment_id: "pay_old_client", day: ago(20), net_amount: 750, billing: "Client Old  Example" }),
    whop({ payment_id: "pay_tied", day: ago(15), net_amount: 200, final_amount: 300, refunded_amount: 100, refund_day: ago(14), billing: "Refund  Payer" }),
    whop({ payment_id: "pay_same", day: ago(9), net_amount: 1000, email: "same@same.example.test", billing: "Same  Payer" }),
    whop({ payment_id: "pay_new_dep", day: ago(6), net_amount: 500, email: "form@new.example.test", billing: "Payer  Newfamily", deal_response_id: "deal-new" }),
    whop({ payment_id: "pay_new_rest", day: ago(2), net_amount: 5000, email: "owner@new.example.test", username: "owner  new" }),
  ];
  const tapRows: Row[] = [
    { id: "chg_settled", day: ago(30), at_ms: now - 30 * 86_400_000, currency: "USD", amount: 400, usd: 400, email: null, name: "Old  Payer Family" },
    { id: "chg_new", day: ago(5), at_ms: now - 5 * 86_400_000, currency: "USD", amount: 250, usd: 250, email: "OWNER@New.example.test", name: "Payer   Newfamily" },
  ];
  const transferRows: Row[] = [
    { id: 9, day: ago(12), amount_usd: 600, method: "wire", client: "Client  Old  Example", reference: "INV-1", deal_response_id: null },
  ];
  const loginRows: Row[] = [{ email: "owner@new.example.test", clickup_id: "card-new" }];
  const inOrder = (query: string, rows: Row[]) =>
    /order by submitted_at\s*$/i.test(query.trim())
      ? [...rows].sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)))
      : rows;

  const nativeReader = async (_project: string, query: string): Promise<Row[]> => {
    const marker = /\/\*\s*ceo-refresh:([a-z0-9._-]+)\s*\*\//i.exec(query)?.[1];
    const fixtures: Record<string, Row[]> = {
      "money.summary": [{ whop_synced_ms: now, whop_last_paid_ms: now, deals_synced_ms: now, failed_count_30: 0, failed_amount_30: 0, refunds_mtd: 0, refunds_90: 0, avg_contract_90: 3833.33, first_deal_day: ago(10) }],
      "money.attribution.whop": whopRows,
      "money.attribution.transfers": transferRows,
      "money.attribution.deals": inOrder(query, dealRows),
      "money.attribution.logins": loginRows,
      "money.tap_state": [{ ok: true, note: null, rows_seen: 2, run_ms: now, ok_ms: now }],
      "money.tap_charges": tapRows,
      "money.media_feed": [{ ready: true, source_rows: 2, actual_rows: 2, snapshot_ms: now - 600_000, first_day: ago(60), last_day: today }],
    };
    if (!marker) throw new Error(`Unmarked query ${query.slice(0, 80)}`);
    return fixtures[marker] ?? [];
  };
  const edgeReader = async (_project: string, query: string): Promise<Row[]> => {
    if (/failed_count_30/.test(query))
      return [{ refunds_mtd: 0, refunds_90: 0, failed_count_30: 0, failed_amount_30: 0, whop_synced_ms: now, whop_last_paid_ms: now, avg_contract_90: 3833.33, deals_synced_ms: now, first_deal_day: ago(10), expense_months: null, transfer_months: null }];
    if (/cockpit_sync_state/.test(query)) return [{ ok: true, note: null, rows_seen: 2, run_ms: now, ok_ms: now }];
    if (/from public\.cockpit_tap_charges/.test(query)) return tapRows;
    if (/from public\.cockpit_bank_lines/.test(query)) return snapshot.bank_lines;
    if (/from public\.cockpit_statements/.test(query))
      return snapshot.statements.map(st => ({ ...st, imported_ms: now }));
    if (/mahara_portal_documents/.test(query)) return loginRows;
    if (/client_first_name/.test(query)) return inOrder(query, dealRows);
    if (/billing_reason\s+from public\.whop_payments/.test(query)) return whopRows;
    if (/deal_response_id\s+from public\.transfers/.test(query)) return transferRows;
    return [];
  };

  const runBoth = async () => {
    const nativeOut = (await withRuntime(
      { env: () => undefined, read: nativeReader as never, repository: {} as never, tools: {} as never },
      () => native.createMoneyAdapter(snapshot).compute({ repository: {} as never }),
    )) as Row & { payload: Row; clientPayments: Row[]; dealPayments: Row[] };
    const edgeRuntime = { read: edgeReader, context: financeContext(snapshot), payments: [] as Row[], dealPayments: undefined as Row[] | undefined, failures: [] as string[] };
    const edgeOut = (await withFinanceRuntime(edgeRuntime as never, () =>
      edgeMoney.compute(edgeRuntime.context),
    )) as unknown as { payload: Row };
    return { nativeOut, edgeOut, edgeRuntime };
  };
  type Tx = Row & { id: string; direction: string };
  const moneyIn = (payload: Row) =>
    ((payload.attribution as { transactions: Tx[] }).transactions ?? [])
      .filter(t => t.direction === "in" && !t.id.startsWith("bankline:"))
      // The detail line is the rail's own words, said differently by each copy; every decision field is compared.
      .map(({ detail: _detail, ...t }) => t);
  const section = (payload: Row) => {
    const a = payload.attribution as Row & { totals: Row };
    const { out: _out, outCount: _outCount, ...totals } = a.totals;
    return { totals, mtd: a.mtd, lastMonth: a.lastMonth, byPerson: a.byPerson, ties: a.ties, dealLedger: a.dealLedger };
  };

  test("every payment in, the client payments and the deal ledger are the same rows", async () => {
    const { nativeOut, edgeOut, edgeRuntime } = await runBoth();
    for (const s of nativeOut.sources as { ok: boolean }[]) expect(s.ok).toBe(true);
    expect(edgeRuntime.failures).toEqual([]);
    expect(moneyIn(edgeOut.payload)).toEqual(moneyIn(nativeOut.payload));
    expect(section(edgeOut.payload)).toEqual(section(nativeOut.payload));
    const written = edgeRuntime.payments.map(({ recorded_at: _at, ...r }) => r);
    const byPayment = (rows: Row[]) => [...rows].sort((a, b) => String(a.payment_id).localeCompare(String(b.payment_id)));
    expect(byPayment(written)).toEqual(byPayment(nativeOut.clientPayments));
    expect(byPayment(edgeRuntime.dealPayments ?? [])).toEqual(byPayment(nativeOut.dealPayments));
  });

  test("and what they read is the contract", async () => {
    const { nativeOut } = await runBoth();
    const rows = new Map(moneyIn(nativeOut.payload).map(t => [t.id, t]));
    const look = (id: string) => {
      const r = rows.get(id);
      return r ? [r.side, r.person, r.dealResponseId ?? null, r.clientTaskId, r.matchedBy, r.payerName] : null;
    };
    // The new client's money is the closer's, on the billing-only card; names cleaned in both copies.
    expect(look("whop:pay_new_dep")).toEqual(["front_end", "Closer New Example", "deal-new", "card-new", "deal_id", "Payer Newfamily"]);
    expect(look("whop:pay_new_rest")).toEqual(["front_end", "Closer New Example", "deal-new", "card-new", "card_email", "owner new"]);
    // The payer pays under the contact's own name on the form: that deal, in its term.
    expect(look("tap:chg_new")?.slice(0, 5)).toEqual(["front_end", "Closer New Example", "deal-new", "card-new", "deal_name"]);
    expect(rows.get("tap:chg_new")?.payerEmail).toBe("owner@new.example.test");
    // Two forms on one day: the earlier form, in both copies.
    expect(look("whop:pay_same")?.slice(0, 3)).toEqual(["front_end", "Closer One Example", "deal-same-a"]);
    expect(look("whop:pay_tied")?.slice(0, 3)).toEqual(["front_end", "Closer Two Example", "deal-same-b"]);
    // A Tap charge a settlement line covers is still the payer's money.
    expect(look("tap:chg_settled")?.slice(0, 5)).toEqual(["back_end", "Csmold", null, "card-old", "card_payer"]);
    expect(look("transfer:9")?.[5]).toBe("Client Old Example");
    expect(look("bank:1")?.slice(0, 5)).toEqual(["back_end", "Csmold", null, "card-old", "card_name"]);
    expect(look("bank:1")?.[5]).toBe("Transfer from Client Old Example");
    expect(look("manual:m-old")?.[5]).toBe("Client Old , Example");
    expect(rows.has("bank:4")).toBe(false);
    expect(rows.has("manual:m-future")).toBe(false);
  });

  test("the cleaner is one rule in both copies", () => {
    for (const text of ["  Mohammed  Algodaihi ", "وليد  سندي", "Client — Example – Co", "pay me@example.test now", "Call +965 5555 1234 today", "2026-10-18 note", "x".repeat(300)])
      for (const max of [60, 80, 120, 240])
        expect(edge.cleanText(text, max)).toBe(native.cleanText(text, max));
  });
});
