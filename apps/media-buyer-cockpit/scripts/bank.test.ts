/** The bank statement parser, the line kinds and the payout matcher. */
import { describe, expect, test } from "bun:test";
import {
  categorise,
  classifyLine,
  isExcluded,
  lineHash,
  matchPayouts,
  parseAmount,
  parseDay,
  parseStatement,
  statementId,
} from "../convex/ceo/bank";

const CARD = `CBK Online,,,,
Customer No  1234567,,,,
Date  01-Jun-2026,,,,
From Date [DD/MM/YYYY]  01/05/2026,,,,
To Date [DD/MM/YYYY]  31/05/2026,,,,
Account  537015XXXXXX4348,,,,
Type  537015XXXXXX4348,,,,
Currency  Control account Card,,,,
,,,,
Date,Amount,Balance,Reference,TRSH_NUMBER
01/05/2026,-0.15,673.191,Non Sufficient Bal. Decline Fee,900001
01/05/2026,500,1172.891,123456XXXXX4348 /CC,900002
03/05/2026,-12.5,1160.391,OPENAI *CHATGPT SUBSCR,900003
04/05/2026,-30,1130.391,WHOP* SKOOL COURSE,900004
,"Total Debit Transaction Amount  -4,772.310",,,
,Curr. Bal.  175.735,,,
,Available Bal.  175.735,,,
`;

const ACCOUNT = `CBK Online,,,,
Account  0011223344,,,,
Type  Current Account,,,,
Currency  KWD,,,,
,,,,
Date,Amount,Balance,Reference,TRSH_NUMBER
02/06/2026,150,5000,TRF FROM DECOR PLUS CO,1
03/06/2026,"1,234.5",6234.5,WHOP PAYOUT 2026-06-02,2
04/06/2026,-100,6134.5,TRANSFER TO WHOP BALANCE,3
05/06/2026,-200,5934.5,537015XXXXXX4348 /CC,4
06/06/2026,80,6014.5,TAP PAYMENTS SETTLEMENT,5
`;

describe("parseStatement", () => {
  test("reads the CBK card export: preamble, lines, footer", () => {
    const p = parseStatement(CARD);
    expect(p.account).toBe("537015XXXXXX4348");
    expect(p.accountKind).toBe("card");
    expect(p.currency).toBe("KWD");
    expect(p.fromDay).toBe("2026-05-01");
    expect(p.toDay).toBe("2026-05-31");
    expect(p.lines.length).toBe(4);
    expect(p.lines[1]).toMatchObject({ day: "2026-05-01", amount: 500, balance: 1172.891, trsh: "900002" });
    expect(p.totalDebit).toBe(-4772.31);
    expect(p.closingBalance).toBe(175.735);
    expect(p.problems).toEqual([]);
    expect(statementId(p)).toBe("537015XXXXXX4348:2026-05-01:2026-05-31");
    expect(lineHash(p.account, p.lines[0])).toBe("537015XXXXXX4348:900001");
  });
  test("reads an account export with quoted thousands", () => {
    const p = parseStatement(ACCOUNT);
    expect(p.accountKind).toBe("account");
    expect(p.lines[1].amount).toBe(1234.5);
    expect(p.lines.length).toBe(5);
  });
  test("refuses text with no statement table", () => {
    expect(() => parseStatement("hello,world\n1,2")).toThrow(/not a CBK statement/);
  });
  test("day and amount helpers", () => {
    expect(parseDay("01-May-2026")).toBe("2026-05-01");
    expect(parseDay("7/6/2026")).toBe("2026-06-07");
    expect(parseDay("2026-06-07")).toBeNull();
    expect(parseAmount("-4,772.310")).toBe(-4772.31);
    expect(parseAmount("(12.5)")).toBe(-12.5);
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("classifyLine", () => {
  const card = (amount: number, reference: string) =>
    classifyLine({ amount, reference }, "card", "537015XXXXXX4348");
  const acct = (amount: number, reference: string) =>
    classifyLine({ amount, reference }, "account", "0011223344");
  test("card credits are own transfers, card debits are expenses or fees", () => {
    expect(card(500, "123456XXXXX4348 /CC")).toBe("own_transfer");
    expect(card(-0.15, "Non Sufficient Bal. Decline Fee")).toBe("fee");
    expect(card(-12.5, "OPENAI *CHATGPT SUBSCR")).toBe("expense");
    expect(card(-30, "WHOP* SKOOL COURSE")).toBe("expense");
    expect(card(20, "REFUND OPENAI")).toBe("refund_in");
  });
  test("account credits are client money unless Whop, Tap or an own account", () => {
    expect(acct(150, "TRF FROM DECOR PLUS CO")).toBe("client_payment");
    expect(acct(1234.5, "WHOP PAYOUT 2026-06-02")).toBe("whop_payout");
    expect(acct(80, "TAP PAYMENTS SETTLEMENT")).toBe("tap_settlement");
    expect(acct(200, "537015XXXXXX4348 /CC")).toBe("own_transfer");
  });
  test("account debits: into Whop, to the card, fees, expenses", () => {
    expect(acct(-100, "TRANSFER TO WHOP BALANCE")).toBe("whop_topup");
    expect(acct(-200, "537015XXXXXX4348 /CC")).toBe("own_transfer");
    expect(acct(-5, "MONTHLY SERVICE CHARGE")).toBe("fee");
    expect(acct(-300, "ZAIN TELECOM")).toBe("expense");
    expect(card(-200, "P-123-Weyay Top Up KW")).toBe("own_transfer");
    expect(card(-150, "UnloadXXXXX4348 /IB")).toBe("own_transfer");
  });
  test("exclusions by vendor and by card", () => {
    const ex = [{ kind: "vendor" as const, pattern: "netflix" }, { kind: "card" as const, pattern: "537015XXXXXX4348" }];
    expect(classifyLine({ amount: -9, reference: "NETFLIX.COM" }, "account", "0011223344", ex)).toBe("excluded");
    expect(classifyLine({ amount: -9, reference: "OPENAI" }, "card", "537015XXXXXX4348", ex)).toBe("excluded");
    expect(isExcluded("OPENAI", "0011223344", ex)).toBeNull();
  });
});

describe("categorise", () => {
  test("sorts references onto P&L lines", () => {
    expect(categorise("FACEBK *ADS 12345")).toBe("ads");
    expect(categorise("OPENAI *CHATGPT")).toBe("software");
    expect(categorise("WHOP* SKOOL")).toBe("courses");
    expect(categorise("SALARY SEPTEMBER")).toBe("labour");
    expect(categorise("Non Sufficient Bal. Decline Fee")).toBe("bank");
    expect(categorise("SULTAN CENTER")).toBe("other");
    expect(categorise("P-123-GOGHL /456")).toBe("software");
    expect(categorise("P-123-KHAMSAT.COM /456")).toBe("labour");
  });
});

describe("matchPayouts", () => {
  test("ties a payout to the run of payments before it, within tolerance", () => {
    const payments = [
      { id: "a", day: "2026-06-01", usd: 500 },
      { id: "b", day: "2026-06-02", usd: 700 },
      { id: "c", day: "2026-06-03", usd: 300 },
      { id: "d", day: "2026-06-20", usd: 1000 },
    ];
    const m = matchPayouts([{ id: "p1", day: "2026-06-05", usd: 1470 }], payments);
    expect(m.get("p1")).toEqual({ from: "2026-06-01", to: "2026-06-03", count: 3, usd: 1500 });
  });
  test("leaves a payout unmatched when no run fits", () => {
    const m = matchPayouts([{ id: "p1", day: "2026-06-05", usd: 999 }], [{ id: "a", day: "2026-06-01", usd: 500 }]);
    expect(m.size).toBe(0);
  });
});
