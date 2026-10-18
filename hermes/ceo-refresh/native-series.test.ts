import { describe, expect, test } from "bun:test";
import { KICKOFF_READ_FROM, kickoffAmount, kickoffIn, paidIn, readDealLedger, readKickoffs, typedNotSeen, withKickoff, withPaid } from "./native/adapters/growth.js";
import { churnRegisterOf, clientDailyOf, extensionJobNote, grantRowsOf } from "./native/adapters/clients.js";
import { eodDaysOf } from "./native/adapters/team.js";
import { hiringSeries } from "./native/adapters/hiring.js";

describe("The kickoff form's amount is read and confirmed on the rails (A087), typed beside front-end cash", () => {
  const forms = [
    { clickup_task_id: "t-alpha", client_name: "Client Alpha", day: "2026-10-04", payment: "1500" },
    { clickup_task_id: "t-beta", client_name: "Client Beta", day: "2026-10-08", payment: "0" },
    { clickup_task_id: "t-blank", client_name: "Blank Co", day: "2026-10-09", payment: null },
    { clickup_task_id: "t-early", client_name: "Client Early", day: "2026-09-13", payment: null },
    { clickup_task_id: "t-tap", client_name: "Tap Co", day: "2026-10-10", payment: "$2,000" },
  ];
  const payments = [
    // Client Beta's money logged by hand: not a rail, never confirms.
    { payment_id: "manual:1", clickup_task_id: "t-beta", day: "2026-10-06", usd: 5608.8, rail: "manual" },
    // Tap Co paid 1,980 on Tap two days later: within 3 days and 5%.
    { payment_id: "tap:1", clickup_task_id: "t-tap", day: "2026-10-12", usd: 1980, rail: "tap" },
    // A Whop payment for Client Alpha, but 10 days off: not a confirmation.
    { payment_id: "whop:1", clickup_task_id: "t-alpha", day: "2026-10-14", usd: 1500, rail: "whop" },
  ];

  test("amounts are read as typed, blanks are missing, never zero", () => {
    expect(kickoffAmount("1500")).toBe(1500);
    expect(kickoffAmount("$2,000.50")).toBe(2000.5);
    expect(kickoffAmount("")).toBeNull();
    expect(kickoffAmount(null)).toBeNull();
    expect(kickoffAmount("about 1500 KWD")).toBeNull();
    const { kickoffs, blank } = readKickoffs(forms, payments);
    expect(kickoffs.map(k => [k.taskId, k.amount, k.confirmed, k.rail])).toEqual([
      ["t-alpha", 1500, 0, null],
      ["t-beta", 0, 0, null],
      ["t-tap", 2000, 2000, "tap"],
    ]);
    expect(blank).toEqual([{ day: "2026-10-09", client: "Blank Co" }]);
  });

  test("a window before the form was read says not read; a window across it counts from the first day", () => {
    const { kickoffs } = readKickoffs(forms, payments);
    expect(kickoffIn(kickoffs, "2026-09-01", "2026-09-30")).toBeNull();
    expect(kickoffIn(null, "2026-10-01", "2026-10-11")).toBeNull();
    expect(kickoffIn(kickoffs, "2026-10-01", "2026-10-11")).toEqual({ amount: 3500, confirmed: 2000, forms: 3, from: KICKOFF_READ_FROM, partial: true });
    expect(kickoffIn(kickoffs, "2026-10-05", "2026-10-07")).toEqual({ amount: 0, confirmed: 0, forms: 0, from: "2026-10-05", partial: false });
  });

  test("the kickoff is typed, not money: it never changes front-end cash or front-end ROAS (2026-10-18)", () => {
    const { kickoffs } = readKickoffs(forms, payments);
    const base = { from: "2026-10-01", to: "2026-10-11", spend: 1000, frontEndCash: { deposit: 500, kickoff: null, total: 900, deals: 1, dealsConfirmed: 1, confirmed: 500, confirmedShare: 1 }, roasCash: 0.9 };
    const w = withKickoff(base, kickoffs);
    expect(w.frontEndCash.kickoff).toBe(3500);
    expect(w.frontEndCash.total).toBe(900);
    expect(w.frontEndCash.kickoffConfirmed).toBe(2000);
    expect(w.frontEndCash.kickoffConfirmedShare).toBe(0.571);
    expect(w.roasCash).toBe(0.9);
    const before = withKickoff({ ...base, from: "2026-09-01", to: "2026-09-30" }, kickoffs);
    expect(before.frontEndCash.kickoff).toBeNull();
    expect(before.frontEndCash.total).toBe(900);
  });
});

describe("Front-end cash is the paid deal ledger (MONEY-ATTRIBUTION.md rule 6)", () => {
  const computed = Date.parse("2026-10-18T03:10:00Z");
  const section = JSON.stringify({ rows: 5, usd: 7800, from: "2025-11-01" });
  const ledgerRows = [
    { computed_ms: computed, ledger: section, payment_id: "whop:pay_1", deal_response_id: "deal-a", day: "2026-10-13", usd: 500, rail: "whop", kind: "deposit", matched_by: "deal_id" },
    { computed_ms: computed, ledger: section, payment_id: "whop:pay_2", deal_response_id: "deal-a", day: "2026-10-17", usd: 5500, rail: "whop", kind: "remainder", matched_by: "deal_id" },
    { computed_ms: computed, ledger: section, payment_id: "manual:m1", deal_response_id: "deal-b", day: "2026-10-06", usd: 1000, rail: "manual", kind: "deposit", matched_by: "deal_name" },
    { computed_ms: computed, ledger: section, payment_id: "transfer:t1", deal_response_id: "deal-b", day: "2026-09-30", usd: 300, rail: "transfer", kind: "remainder", matched_by: "card_payer" },
    { computed_ms: computed, ledger: section, payment_id: "tap:c1", deal_response_id: "deal-web", day: "2026-10-10", usd: 500, rail: "tap", kind: "deposit", matched_by: "ceo" },
  ];
  const deals = [
    { response_id: "deal-a", day: "2026-10-13", business: "Client A", closer: "Closer One", deposit: 500, webinar: false, voided: false },
    { response_id: "deal-b", day: "2026-09-29", business: "Client B", closer: "Closer Two", deposit: 1000, webinar: false, voided: false },
    { response_id: "deal-web", day: "2026-10-09", business: "Webinar Co", closer: "Closer One", deposit: 500, webinar: true, voided: false },
    { response_id: "deal-c", day: "2026-10-15", business: "Client C", closer: "Closer One", deposit: 250, webinar: false, voided: false },
  ];

  test("the ledger is read with each deal's closer, webinar deals set aside, and checked against the Money section", () => {
    const ledger = readDealLedger(ledgerRows, deals);
    expect(ledger.ready).toBe(true);
    expect(ledger.attributedAt).toBe(computed);
    expect(ledger.rows.map((r: { paymentId: string }) => r.paymentId)).toEqual(["whop:pay_1", "whop:pay_2", "manual:m1", "transfer:t1"]);
    expect(ledger.set.webinar).toEqual({ payments: 1, usd: 500 });
    // The ledger's active rows match the count and sum the section published with them.
    expect([ledger.agree, ledger.ledgerRows, ledger.ledgerUsd, ledger.sectionRows, ledger.sectionUsd]).toEqual([true, 5, 7800, 5, 7800]);
    // A section that counted another number says so.
    const other = JSON.stringify({ rows: 6, usd: 8300, from: "2025-11-01" });
    expect(readDealLedger(ledgerRows.map(r => ({ ...r, ledger: other })), deals).agree).toBe(false);
  });

  test("a Money section without the ledger, or none at all, is not read, never zero", () => {
    expect(readDealLedger([], deals)).toMatchObject({ ready: false, attributedAt: null });
    const old = readDealLedger([{ computed_ms: computed, ledger: null, payment_id: null }], deals);
    expect(old).toMatchObject({ ready: false, attributedAt: computed });
    const w = withPaid({ from: "2026-10-01", to: "2026-10-18", spend: 600, frontEndCash: { deposit: 750, kickoff: 1500, total: null, deals: 2, dealsConfirmed: 1, confirmed: 500, confirmedShare: 0.667 }, roasCash: null }, old, deals, []);
    expect(w.frontEndCash.total).toBeNull();
    expect(w.frontEndCash.paid).toBeNull();
    expect(w.frontEndCash.typed).toEqual({ deposit: 750, kickoff: 1500 });
    expect(w.roasCash).toBeNull();
  });

  test("paid by payment day, split deposit and remainder, by rail and by closer", () => {
    const ledger = readDealLedger(ledgerRows, deals);
    expect(paidIn(ledger.rows, "2026-10-01", "2026-10-18")).toEqual({
      paid: 7000, paidDeposit: 1500, paidRemainder: 5500, payments: 3, paidDeals: 2,
      byRail: { whop: 6000, tap: 0, bank: 0, manual: 1000 },
      byCloser: [{ name: "Closer One", usd: 6000, payments: 2 }, { name: "Closer Two", usd: 1000, payments: 1 }],
    });
    // A bank transfer is the bank rail; September's payment counts in September.
    expect(paidIn(ledger.rows, "2026-09-01", "2026-09-30")).toMatchObject({ paid: 300, byRail: { bank: 300 } });
  });

  test("a paid-in-full payment is split at the typed deposit, as the ledger's deposit_usd says", () => {
    // Rows written since the split carry deposit_usd; a deposit row without it is all deposit.
    const split = [
      { ...ledgerRows[0], payment_id: "whop:pay_pif", usd: 5608.8, kind: "deposit", deposit_usd: 500 },
      { ...ledgerRows[2], deposit_usd: null },
    ];
    const ledger = readDealLedger(split, deals);
    expect(ledger.rows.map((r: { depositUsd: number }) => r.depositUsd)).toEqual([500, 1000]);
    expect(paidIn(ledger.rows, "2026-10-01", "2026-10-18")).toMatchObject({ paid: 6608.8, paidDeposit: 1500, paidRemainder: 5108.8 });
  });

  test("the tile: total = paid, typed amounts beside it and never added, ROAS on the money", () => {
    const ledger = readDealLedger(ledgerRows, deals);
    const kickoffs = [
      { day: "2026-10-16", taskId: "t-c", client: "Client C", amount: 5750, confirmed: 0, rail: null },
      { day: "2026-10-14", taskId: "t-a", client: "Client A", amount: 5500, confirmed: 5500, rail: "whop" },
    ];
    const window = { from: "2026-10-01", to: "2026-10-18", spend: 700, frontEndCash: { deposit: 1250, kickoff: 11250, total: null, deals: 3, dealsConfirmed: 1, confirmed: 500, confirmedShare: 0.4 }, roasCash: null };
    const w = withPaid(window, ledger, deals, kickoffs);
    expect(w.frontEndCash.total).toBe(7000);
    expect(w.frontEndCash.paid).toBe(7000);
    expect(w.frontEndCash.typed).toEqual({ deposit: 1250, kickoff: 11250 });
    expect(w.frontEndCash.attributedAt).toBe(computed);
    expect(w.roasCash).toBe(10);
    // Client C typed a $250 deposit with no money yet, and a kickoff no rail confirms; the webinar deal is left out.
    expect(w.frontEndCash.typedNotSeen).toEqual({
      usd: 6000, count: 2,
      items: [
        { kind: "deposit", day: "2026-10-15", business: "Client C", typed: 250, seen: 0, usd: 250 },
        { kind: "kickoff", day: "2026-10-16", business: "Client C", typed: 5750, seen: 0, usd: 5750 },
      ],
    });
    expect(typedNotSeen({ from: "2026-09-01", to: "2026-09-30" }, ledger, deals, kickoffs)).toEqual({ usd: 0, count: 0, items: [] });
  });
});

describe("Churn from the register (A078)", () => {
  test("the client success rule over the register's months and departures", () => {
    const reg = churnRegisterOf(
      [
        { month: "2026-01", active_at_start: 15, new_clients: 5, lost_before_register: 3, note: "sheet" },
        { month: "2026-08", active_at_start: null, new_clients: 10, lost_before_register: 2, note: null },
        { month: "2026-09", active_at_start: 22, new_clients: null, lost_before_register: 1, note: null },
      ],
      [],
      "2026-10-11",
    );
    expect(reg.through).toBe("2026-10");
    expect(reg.departures).toBe(0);
    const sep = reg.months.find(m => m.month === "2026-09")!;
    expect(sep.churned).toBe(1);
    expect(sep.churnPct).toBe(4.5);
    const oct = reg.months.find(m => m.month === "2026-10")!;
    expect(oct.activeAtStart).toBeNull();
    expect(oct.churnPct).toBeNull();
    expect(reg.months.at(-1)?.month).toBe("2026-10");
  });

  test("a logged departure before day 90 is churn, after it is a completed term", () => {
    const reg = churnRegisterOf([{ month: "2026-10", active_at_start: 20, new_clients: 2, lost_before_register: null, note: null }], [
      { left_on: "2026-10-05", launched_on: "2026-08-01" },
      { left_on: "2026-10-06", launched_on: "2026-06-01" },
    ], "2026-10-11");
    const oct = reg.months.find(m => m.month === "2026-10")!;
    expect(oct.churned).toBe(1);
    expect(oct.completed).toBe(1);
    expect(oct.churnPct).toBe(5);
  });
});

describe("The extension field note follows the hourly job (A120, A136)", () => {
  test("dry run, writing, no run yet, and no field", () => {
    const at = Date.parse("2026-10-11T12:47:02Z");
    expect(extensionJobNote({ job: "ceo-extensions-auto", ok: true, error: "Dry run: every card already says what the form says.", at }, true))
      .toBe("Automatic writes are off (dry run): the hourly job at :47 checks the 'Current extension (weeks)' field against the extension form but writes nothing (last run 2026-10-11 15:47 Kuwait: Dry run: every card already says what the form says.). The button writes it now.");
    expect(extensionJobNote({ job: "ceo-extensions-auto", ok: true, error: "Wrote 2 cards.", at }, true))
      .toBe("Kept current every hour at :47 from the extension form (last run 2026-10-11 15:47 Kuwait: Wrote 2 cards.). The button writes it now.");
    expect(extensionJobNote(null, true)).toContain("has not reported a run yet");
    expect(extensionJobNote(null, false)).toContain("Create a Number field");
    expect(extensionJobNote({ error: "Dry run" }, true)).not.toContain("never automatically");
  });

  test("grant rows by day for twelve months, matched to a card, tests left out", () => {
    const cards = [{ taskId: "t1", name: "Ocean Home" }, { taskId: "t2", name: "Internal Test" }];
    const rows = grantRowsOf([
      { client: "ocean home", day: "2026-10-02", weeks: 2, until: "2026-10-16", submittedAt: 0 },
      { client: "Someone New", day: "2026-09-10", weeks: 1, until: "2026-09-17", submittedAt: 0 },
      { client: "internal test", day: "2026-10-03", weeks: 4, until: "2026-10-31", submittedAt: 0 },
      { client: "ocean home", day: "2025-09-01", weeks: 4, until: "2025-09-29", submittedAt: 0 },
    ], cards, "2026-10-11");
    expect(rows).toEqual([
      { day: "2026-09-10", taskId: null, client: "Someone New", weeks: 1, until: "2026-09-17" },
      { day: "2026-10-02", taskId: "t1", client: "Ocean Home", weeks: 2, until: "2026-10-16" },
    ]);
  });
});

describe("Per-day series for the timeframe bar (A127)", () => {
  test("client spend, leads and due bookings per day, deleted campaigns kept by their tags", () => {
    const cardByKey = new Map([["oceanhome", "t-ocean"], ["liwan", "t-liwan"]]);
    const cardOf = (keys: unknown[]) => keys.map(k => String(k ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")).map(k => cardByKey.get(k)).find(Boolean) ?? null;
    const { byTask } = clientDailyOf({
      campaignTags: [
        { name: "Ocean A", tag: "oceanhome", tags: ["oceanhome"], client: "Ocean Home" },
        { name: "Liwan old (deleted)", tag: null, tags: [], client: "Liwan" },
        { name: "Nobody", tag: "nobody", tags: [], client: "Nobody" },
      ],
      cardOf,
      daily: [
        { campaignName: "Ocean A", date: "2026-10-09", spend: 10.5, leads: 2 },
        { campaignName: "Ocean A", date: "2026-10-09", spend: 4.5, leads: 1 },
        { campaignName: "Liwan old (deleted)", date: "2026-10-10", spend: 7, leads: 0 },
        { campaignName: "Nobody", date: "2026-10-10", spend: 99, leads: 9 },
      ],
      bookings: [
        { campaignName: "Ocean A", date: "2026-10-10", count: 3, future: 1 },
      ],
      from: "2026-10-09",
      to: "2026-10-11",
    });
    expect(byTask.get("t-ocean")).toEqual([
      { date: "2026-10-09", spend: 15, leads: 3, bookings: 0 },
      { date: "2026-10-10", spend: 0, leads: 0, bookings: 2 },
      { date: "2026-10-11", spend: 0, leads: 0, bookings: 0 },
    ]);
    expect(byTask.get("t-liwan")?.[1]).toEqual({ date: "2026-10-10", spend: 7, leads: 0, bookings: 0 });
    expect(byTask.has("nobody")).toBe(false);
  });

  test("the frozen snapshot fill adds only ad-days the live rows did not count, and gives a card with no live campaign its days", () => {
    const cardByKey = new Map([["oceanhome", "t-ocean"]]);
    const cardOf = (keys: unknown[]) => keys.map(k => String(k ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")).map(k => cardByKey.get(k)).find(Boolean) ?? null;
    const { byTask, filled, filledUsd } = clientDailyOf({
      campaignTags: [{ name: "Ocean A", tag: "oceanhome", tags: [], client: "Ocean Home" }],
      cardOf,
      daily: [{ campaignName: "Ocean A", metaAdId: "ad-1", date: "2026-09-20", spend: 10, leads: 1 }],
      bookings: [],
      from: "2026-09-20",
      to: "2026-09-21",
      fill: [
        // The live row's own ad-day: already counted, so not added again.
        { taskId: "t-ocean", date: "2026-09-20", ad: "ad-1", spend: 10, leads: 1 },
        // An ad the live table does not hold: added.
        { taskId: "t-ocean", date: "2026-09-20", ad: "ad-2", spend: 5.25, leads: 2 },
        // A card whose campaigns are not on the board at all.
        { taskId: "t-ribalo", date: "2026-09-21", ad: "ad-9", spend: 20, leads: 0 },
      ],
    });
    expect(byTask.get("t-ocean")?.[0]).toEqual({ date: "2026-09-20", spend: 15.25, leads: 3, bookings: 0 });
    expect(byTask.get("t-ribalo")).toEqual([
      { date: "2026-09-20", spend: 0, leads: 0, bookings: 0 },
      { date: "2026-09-21", spend: 20, leads: 0, bookings: 0 },
    ]);
    expect(filled).toBe(2);
    expect(filledUsd).toBe(25.25);
  });

  test("EOD days: due, filed and late, from the person's first day, Fridays and paused days not due", () => {
    const days = new Map([
      ["2026-10-07", { day: "2026-10-07", at: 1, onTime: true }],
      ["2026-10-08", { day: "2026-10-08", at: 1, onTime: false }],
    ]);
    const p = { key: "csm:sara", since: "2026-10-06", days, history: days };
    const offOn = (_key: string, day: string) => day === "2026-10-10";
    const series = eodDaysOf(p, "2026-10-01", "2026-10-10", offOn);
    expect(series[0]).toEqual({ date: "2026-10-06", due: true, filed: false, late: false });
    expect(series.find(d => d.date === "2026-10-07")).toEqual({ date: "2026-10-07", due: true, filed: true, late: false });
    expect(series.find(d => d.date === "2026-10-08")).toEqual({ date: "2026-10-08", due: true, filed: true, late: true });
    // 2026-10-09 is a Friday; 2026-10-10 the person was paused.
    expect(series.find(d => d.date === "2026-10-09")?.due).toBe(false);
    expect(series.find(d => d.date === "2026-10-10")?.due).toBe(false);
    expect(series).toHaveLength(5);
  });

  test("applied and hired per Kuwait day over every candidate", () => {
    const ms = (iso: string) => Date.parse(iso);
    const series = hiringSeries([
      { applied_ms: ms("2026-10-01T22:30:00Z"), stage: "application", stage_ms: ms("2026-10-01T22:30:00Z") },
      { applied_ms: ms("2026-10-02T08:00:00Z"), stage: "hired", stage_ms: ms("2026-10-09T10:00:00Z") },
      { applied_ms: null, stage: "hired", stage_ms: null },
    ]);
    // 22:30 UTC on 1 Oct is 2 Oct in Kuwait.
    expect(series.appliedByDay).toEqual([{ date: "2026-10-02", count: 2 }]);
    expect(series.hiredByDay).toEqual([{ date: "2026-10-09", count: 1 }]);
  });
});
