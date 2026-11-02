import { describe, expect, test } from "bun:test";
import { attributePayments, backEndBook, bookMonthEndsSql, cardForDealOf, cardsOnDeals, recurringCards, withManualRefunds } from "./native/adapters/money.js";

/**
 * The Goals sheet, round 2 (2026-11-02), the CEO refresh's money section:
 * - fix 1: a month's refunds are Whop's plus the hand-logged ones, the hand-logged part apart
 *   (`refundsManual`) because Whop cash is already net, with the count beside them;
 * - fix 8: MRR collected and Collections % on the back end only (the CEO's choice): payments on
 *   recurring cards of clients from before the month, over what those same cards owed. A card still
 *   on its deal that month (new, or paying a deal in its term) owes front-end money, not MRR, decided
 *   from the deal at the month's start (review, 2026-11-02), so an instalment never moves the base.
 */
describe("fix 1: refunds are Whop's plus the hand-logged ones", () => {
  const manual = [
    { day: "2026-08-12", amountUsd: 200, kind: "refund", checkState: "checked" },
    // Waiting on its check still counts: money out is never held back (refunds.mtd's rule).
    { day: "2026-08-30", amountUsd: 75.5, kind: "refund", checkState: "logged" },
    { day: "2026-09-02", amountUsd: 40, kind: "refund", checkState: "checked" },
  ];

  test("August: Whop's $1,666 (already netted off its charge) plus $275.50 logged by hand", () => {
    const row = withManualRefunds({ month: "2026-08", cash: 22333.01, refunds: 1666, refundCount: 1, deals: 10, contracted: 61000 }, manual);
    expect(row).toEqual({ month: "2026-08", cash: 22333.01, refunds: 1941.5, refundsManual: 275.5, refundCount: 3, deals: 10, contracted: 61000 });
  });

  test("October 2026: nothing refunded on either side reads a measured $0 and 0", () => {
    const row = withManualRefunds({ month: "2026-10", cash: 10050, refunds: 0, refundCount: 0, deals: 5, contracted: 30000 }, manual);
    expect(row).toMatchObject({ refunds: 0, refundsManual: 0, refundCount: 0 });
  });

  test("a month with only hand-logged refunds", () => {
    expect(withManualRefunds({ month: "2026-09", refunds: 0, refundCount: 0 }, manual)).toMatchObject({ refunds: 40, refundsManual: 40, refundCount: 1 });
  });
});

/**
 * October 2026's book (live, read 2 Nov): the recurring cards on 31 Oct, the closer-form deals tied to
 * them, and the month's attributed payments. Madana signed in October; Al Ola, Ardon, Castello and
 * Arcturus were clients before it but still mid-deal (inside DEAL_TERM_DAYS, contract not paid in full),
 * so their payments are front-end money, the deal's; Safad, Liwan, Joe and Sera and Nohod owe MRR.
 */
const card = (taskId: string, mrrUsd: number) => ({ taskId, mrrUsd });
const octoberCards = [
  card("safad", 1300), card("liwan", 1333), card("joe-sera", 1666), card("nohod", 700),
  card("madana", 2000), card("al-ola", 2000), card("ardon", 2000), card("arcturus", 2000), card("castello", 2000),
];
const deal = (responseId: string, day: string, contracted: number | null, business = responseId) => ({ responseId, day, contracted, business, email: null });
const octoberDeals = [
  deal("madana", "2026-10-02", 6000),
  deal("al-ola", "2026-08-30", 7000),
  deal("ardon", "2026-09-06", 6000),
  deal("castello", "2026-08-17", 6000),
  deal("arcturus", "2026-08-25", 6000),
  // Nohod's deal was paid in full before October: its money since is back end.
  deal("nohod", "2026-07-20", 2100),
  // Liwan's deal is past its 120 days at 1 Oct, contract open or not.
  deal("liwan", "2026-04-15", 8000),
];
/** Each deal sits on the card of the same name, as cardForDealOf's name match does. */
const sameName = (d: { business: string }) => ({ taskId: d.business });
const pay = (clientTaskId: string | null, day: string, usd: number, side: string, dealResponseId: string | null = null) => ({ clientTaskId, day, usd, side, dealResponseId });
const octoberPayments = [
  // Before October: what each deal had paid by 1 Oct.
  pay("al-ola", "2026-08-30", 3018.76, "front_end", "al-ola"),
  pay("castello", "2026-08-17", 3500, "front_end", "castello"),
  pay("arcturus", "2026-08-25", 2000, "front_end", "arcturus"),
  pay("ardon", "2026-09-06", 2000, "front_end", "ardon"),
  pay("nohod", "2026-07-20", 2100, "front_end", "nohod"),
  pay("liwan", "2026-09-23", 1333, "back_end"),
  // October.
  pay("madana", "2026-10-01", 500, "front_end", "madana"),
  pay("safad", "2026-10-04", 1300, "back_end"),
  // Smmim's back-end $2,300 is on a card that is not a recurring Monthly card.
  pay("smmim", "2026-10-06", 2300, "back_end"),
  pay("madana", "2026-10-07", 1500, "front_end", "madana"),
  pay("al-ola", "2026-10-20", 2021.2, "front_end", "al-ola"),
  pay(null, "2026-10-23", 3.26, "unattributed"),
  pay("ardon", "2026-10-27", 2000, "front_end", "ardon"),
];

describe("fix 8: the back-end book", () => {
  test("October: $1,300 collected (Safad) of $4,999 owed by the clients past their deal, 26.0%; $10,000 is mid-deal", () => {
    const onDeals = cardsOnDeals(octoberDeals, sameName, octoberPayments, "2026-10");
    expect([...onDeals].sort()).toEqual(["al-ola", "arcturus", "ardon", "castello", "madana"]);
    const b = backEndBook(octoberPayments, octoberCards, "2026-10", onDeals);
    expect(b).toEqual({ collectedBackEnd: 1300, projectedExisting: 4999, projectedOnDeals: 10000 });
    expect(Math.round((b.collectedBackEnd / b.projectedExisting) * 1000) / 10).toBe(26);
    // The whole book (book.collected) reads $7,321.20 of $14,999: the deal money is in it.
    expect(octoberCards.reduce((n, c) => n + c.mrrUsd, 0)).toBe(b.projectedExisting + b.projectedOnDeals);
  });

  test("an instalment landing never moves what is owed: the review's November case (11,333 fell to 5,333 on the stand-in)", () => {
    const novCards = [card("safad", 1300), card("liwan", 1333), card("nohod", 700), card("castello", 2000), card("ardon", 2000), card("al-ola", 2000), card("madana", 2000)];
    const before = octoberPayments;
    const after = [...octoberPayments, pay("madana", "2026-11-03", 2000, "front_end", "madana"), pay("al-ola", "2026-11-05", 1960.04, "front_end", "al-ola"), pay("ardon", "2026-11-06", 2000, "front_end", "ardon")];
    const owed = (rows: typeof octoberPayments) => backEndBook(rows, novCards, "2026-11", cardsOnDeals(octoberDeals, sameName, rows, "2026-11"));
    expect(owed(before)).toEqual({ collectedBackEnd: 0, projectedExisting: 3333, projectedOnDeals: 8000 });
    expect(owed(after)).toEqual({ collectedBackEnd: 0, projectedExisting: 3333, projectedOnDeals: 8000 });
    // Safad's retainer then raises what is collected, never lowers what is owed.
    expect(owed([...after, pay("safad", "2026-11-04", 1300, "back_end")])).toEqual({ collectedBackEnd: 1300, projectedExisting: 3333, projectedOnDeals: 8000 });
  });

  test("a deal leaves the card on it once paid in full or past 120 days at the month's start; signed in the month always counts", () => {
    // Al Ola paid in full before December: owes MRR in December.
    const paidUp = [...octoberPayments, pay("al-ola", "2026-11-05", 1960.04, "front_end", "al-ola")];
    expect(cardsOnDeals(octoberDeals, sameName, paidUp, "2026-12").has("al-ola")).toBe(false);
    // Castello (17 Aug): 106 days at 1 Dec, still on its deal; 137 at 1 Jan, off it whatever is unpaid.
    expect(cardsOnDeals(octoberDeals, sameName, octoberPayments, "2026-12").has("castello")).toBe(true);
    expect(cardsOnDeals(octoberDeals, sameName, octoberPayments, "2027-01").has("castello")).toBe(false);
    // Signed in the month, paid in full ahead of the form: still new that month.
    const upfront = [deal("new", "2026-11-20", 3000)];
    expect(cardsOnDeals(upfront, sameName, [pay("new", "2026-11-15", 3000, "front_end", "new")], "2026-11").has("new")).toBe(true);
    // Signed after the month: not that month's.
    expect(cardsOnDeals(upfront, sameName, [], "2026-10").size).toBe(0);
    // No contracted amount: on the deal for its whole term, as attribution keeps it open.
    expect(cardsOnDeals([deal("x", "2026-10-10", null)], sameName, [], "2026-11").has("x")).toBe(true);
    // A deal tied to no card holds no card.
    expect(cardsOnDeals(octoberDeals, () => null, octoberPayments, "2026-10").size).toBe(0);
  });

  test("a card with deal money in the month but no deal on it then (paid ahead of a later form) is still left out", () => {
    const early = [...octoberPayments, pay("safad", "2026-10-30", 500, "front_end", "safad-next")];
    expect(backEndBook(early, octoberCards, "2026-10", cardsOnDeals(octoberDeals, sameName, early, "2026-10"))).toEqual({ collectedBackEnd: 0, projectedExisting: 3699, projectedOnDeals: 11300 });
  });

  test("no payment in the month is a measured zero collected, never missing, with what was owed", () => {
    expect(backEndBook([], [card("safad", 1300)], "2026-12")).toEqual({ collectedBackEnd: 0, projectedExisting: 1300, projectedOnDeals: 0 });
  });

  test("the book ties a deal to the same card attribution does", () => {
    const cards = [
      { taskId: "t-castello", names: ["Castello Interiors"], emails: [], payerKeys: [], csm: null },
      { taskId: "t-ardon", names: ["Ardon"], emails: ["owner@ardon.example"], payerKeys: [], csm: null },
    ];
    const deals = [
      { ...deal("d-castello", "2026-08-17", 6000, "Castello Interiors LLC"), deposit: 2000, closer: "Ahmed", csm: null, contactName: null },
      { ...deal("d-ardon", "2026-09-06", 6000, "A.R.D."), email: "owner@ardon.example", deposit: 2000, closer: "Ahmed", csm: null, contactName: null },
    ];
    const payments = [
      { id: "whop:1", rail: "whop", day: "2026-08-17", usd: 3500, payerEmail: null, payerName: "Castello Interiors LLC", dealResponseId: "d-castello", clickupTaskId: null },
      { id: "whop:2", rail: "whop", day: "2026-09-06", usd: 2000, payerEmail: null, payerName: null, dealResponseId: "d-ardon", clickupTaskId: null },
    ];
    const rows = attributePayments(payments, deals, cards, []);
    const of = cardForDealOf(cards);
    for (const d of deals) expect(rows.find((r: { dealResponseId: string }) => r.dealResponseId === d.responseId)?.clientTaskId).toBe(of(d)?.taskId);
    expect([...cardsOnDeals(deals, of, rows, "2026-10")].sort()).toEqual(["t-ardon", "t-castello"]);
  });

  test("the recurring cards are the book's own rule: active, an MRR, a recurring plan", () => {
    const rows = [
      { taskId: "a", stage: "Active", mrrUsd: 2000, paymentPlan: "Monthly" },
      { taskId: "b", stage: "Active", mrrUsd: 2000, paymentPlan: "Split Pay (2x payments)" },
      { taskId: "c", stage: "Active", mrrUsd: 2000, paymentPlan: "Paid in full (90 days)" },
      { taskId: "d", stage: "Stopped", mrrUsd: 1333, paymentPlan: "Monthly" },
      { taskId: "e", stage: "Active", mrrUsd: undefined, paymentPlan: "Monthly" },
      { taskId: "f", stage: "Active", mrrUsd: 700, paymentPlan: undefined },
    ];
    expect(recurringCards(rows).map(r => r.taskId)).toEqual(["a"]);
  });

  test("each past month's recurring cards come from its own last billing snapshot", () => {
    const q = bookMonthEndsSql("2025-12-01", "2026-11-01");
    expect(q).toContain("/* ceo-refresh:money.book_month_ends */");
    expect(q).toContain("FROM public.cockpit_client_billing_days");
    expect(q).toContain("SELECT max(day) FROM public.cockpit_client_billing_days WHERE day>=date '2025-12-01' AND day<date '2026-11-01' GROUP BY date_trunc('month',day)");
    expect(q).toContain("mrr_usd::float8 AS mrr_usd");
  });
});
