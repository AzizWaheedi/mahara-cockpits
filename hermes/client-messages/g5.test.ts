import { describe, expect, test } from "bun:test";
import type { Db } from "./db.ts";
import {
  BOOKING_ID,
  BOOKING_WORDS,
  checkG5,
  type G5Deps,
  g5Main,
  readPairs,
} from "./g5.ts";
import type { Receipt } from "./ledger.ts";
import type { WaMessage } from "./whapi.ts";

// Every card, group, number and message here is invented.
const G1 = "120363000000000001@g.us";
const G2 = "120363000000000002@g.us";
const SHEET = [
  ["Client", "", "", "", "ClickUp ID", "WA Group ID"],
  ["Acme Interiors", "", "", "", "86abc0001", G1],
  ["Beta Build", "", "", "", "86abc0002", G2],
];
const AT1 = "2026-10-13T14:55:12Z";
const AT2 = "2026-10-11T15:04:06Z";
const t = (iso: string, plus = 0) => Math.floor(Date.parse(iso) / 1000) + plus;
const recap = (
  id: string,
  at: number,
  fromMe: boolean,
  from = "96550001111",
): WaMessage => ({
  id,
  fromMe,
  from,
  at,
  body: `ملخص تجريبي.\n\n${BOOKING_WORDS} لين الحين، تقدر تحجزها من هنا:\nhttps://api.leadconnectorhq.com/widget/booking/${BOOKING_ID}`,
});
function deps(
  pages: Record<string, WaMessage[] | "fail">,
  health = { channelLast4: "2222" },
): G5Deps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    sheet: async () => SHEET,
    page: async (group, from, to, offset) => {
      asked.push(`${group} ${from} ${to} ${offset}`);
      const p = pages[group];
      if (p === "fail" || !p) throw new Error("unreadable");
      return p.slice(offset, offset + 100);
    },
    health: async () => health,
  };
}

describe("G5", () => {
  test("Make 07's recap read as from_me in every pair: same number", async () => {
    const d = deps({
      [G1]: [recap("a", t(AT1, 20), true)],
      [G2]: [recap("b", t(AT2, -30), true)],
    });
    const out = await checkG5(d, [
      { task: "86abc0001", at: AT1 },
      { task: "86abc0002", at: AT2 },
    ]);
    expect(out).toEqual({
      verdict: "same number",
      checked: [
        {
          task: "86abc0001",
          at: AT1,
          found: true,
          fromMe: true,
          fromLast4: "1111",
        },
        {
          task: "86abc0002",
          at: AT2,
          found: true,
          fromMe: true,
          fromLast4: "1111",
        },
      ],
      channelLast4: null,
    });
    expect(d.asked[0]).toBe(`${G1} ${t(AT1) - 180} ${t(AT1) + 180} 0`);
  });

  test("a recap from another number: different number, with both numbers' last four only", async () => {
    const out = await checkG5(
      deps({ [G1]: [recap("a", t(AT1), false, "96550003333")] }),
      [{ task: "86abc0001", at: AT1 }],
    );
    expect(out).toEqual({
      verdict: "different number",
      checked: [
        {
          task: "86abc0001",
          at: AT1,
          found: true,
          fromMe: false,
          fromLast4: "3333",
        },
      ],
      channelLast4: "2222",
    });
    expect(JSON.stringify(out)).not.toContain("96550003333");
  });

  test("no recap within 3 minutes, a message without the booking block, an unreadable group or no group: not proven", async () => {
    for (const pages of [
      { [G1]: [recap("a", t(AT1, 400), true)] },
      {
        [G1]: [
          {
            ...recap("a", t(AT1), true),
            body: "Invented message without the block.",
          },
        ],
      },
      { [G1]: "fail" as const },
    ]) {
      expect(
        (await checkG5(deps(pages), [{ task: "86abc0001", at: AT1 }])).verdict,
      ).toBe("not proven");
    }
    expect(
      (
        await checkG5(deps({ [G1]: [recap("a", t(AT1), true)] }), [
          { task: "86abc0001", at: AT1 },
          { task: "86abc0009", at: AT2 },
        ])
      ).verdict,
    ).toBe("not proven");
  });

  test("a time filter the list ignores: a full page pages on by offset, to 500", async () => {
    const noise = Array.from({ length: 250 }, (_, i) => ({
      ...recap(`n${i}`, t(AT1, -100_000 - i), true),
      body: "Old invented message.",
    }));
    const d = deps({ [G1]: [...noise, recap("hit", t(AT1, 5), true)] });
    const out = await checkG5(d, [{ task: "86abc0001", at: AT1 }]);
    expect(out.verdict).toBe("same number");
    expect(d.asked.map(a => a.split(" ").at(-1))).toEqual(["0", "100", "200"]);
  });

  test("readPairs reads --task and --at in pairs, refusing anything else", () => {
    expect(readPairs(["--task", "86abc0001", "--at", AT1])).toEqual([
      { task: "86abc0001", at: AT1 },
    ]);
    expect(readPairs([])).toBe(
      "Give at least one --task <card> --at <iso time>.",
    );
    expect(readPairs(["--at", AT1, "--task", "86abc0001"])).toBe(
      "Give pairs of --task <card> --at <iso time>.",
    );
    expect(readPairs(["--task", "bad id!", "--at", AT1])).toBe(
      "bad id! is not a ClickUp card id.",
    );
    expect(readPairs(["--task", "86abc0001", "--at", "yesterday"])).toBe(
      "yesterday is not a time.",
    );
  });

  test("the command writes client-messages-g5, ok only for same number, and refuses bad pairs before any call", async () => {
    const healths: unknown[] = [];
    const receipts: Receipt[] = [];
    const db: Db = {
      rpc: async () => null,
      receipt: async r => void receipts.push(r),
      health: async h => void healths.push(h),
    };
    const code = await g5Main({ env: {} }, ["--task", "86abc0001"], db);
    expect(code).toBe(2);
    expect(healths).toEqual([]);
    expect(receipts).toEqual([]);
    // Client Data unreadable (no credential here): not proven, written not ok, and no call made.
    expect(
      await g5Main({ env: {} }, ["--task", "86abc0001", "--at", AT1], db),
    ).toBe(1);
    expect(healths).toEqual([
      {
        key: "client-messages-g5",
        ok: false,
        note: "not proven",
        detail: {
          verdict: "not proven",
          checked: [
            {
              task: "86abc0001",
              at: AT1,
              found: false,
              fromMe: null,
              fromLast4: null,
            },
          ],
          channelLast4: null,
          // The one ledger of the check: no call left, so no answer was lost.
          receiptsMissing: 0,
        },
      },
    ]);
    expect(receipts).toEqual([]);
  });
});
