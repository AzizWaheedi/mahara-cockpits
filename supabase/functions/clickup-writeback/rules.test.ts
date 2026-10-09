import { describe, expect, it } from "bun:test";
import { GOLDEN } from "./convexGolden";
import {
  boardStatusAfter,
  cardFor,
  changeComment,
  cleanDosDonts,
  CPB_GATE,
  CPL_GATE,
  daysAgo,
  decisionComment,
  isChange,
  kpiBand,
  money,
  refLine,
} from "./rules";

// Every expectation here was produced by the Convex code itself (convexGolden.ts).
describe("parity with the paused Convex code", () => {
  it("bands CPL and CPB exactly as the board dropdowns did", () => {
    expect(CPL_GATE).toBe(15);
    expect(CPB_GATE).toBe(60);
    for (const [v, label] of GOLDEN.kpiBandCpl) expect(kpiBand(v, CPL_GATE)).toBe(label);
    for (const [v, label] of GOLDEN.kpiBandCpb) expect(kpiBand(v, CPB_GATE)).toBe(label);
  });
  it("formats money the same way", () => {
    for (const [v, s] of GOLDEN.money) expect(money(v ?? undefined)).toBe(s);
  });
  it("writes the decision comment byte for byte", () => {
    for (const [d, text] of GOLDEN.decisionComment) expect(decisionComment(d as any)).toBe(text);
  });
  it("writes the change comment byte for byte, including the late-post rule", () => {
    const now = Date.parse("2026-10-09T09:00:00Z");
    for (const [m, text] of GOLDEN.changeComment) expect(changeComment(m as any, now)).toBe(text);
  });
  it("treats questions and requests as not changes", () => {
    for (const [t, v] of GOLDEN.isChange) expect(isChange(t)).toBe(v);
  });
  it("finds the same card: own card first, then the client's biggest spender", () => {
    const campaigns = [
      { campaignName: "Castello Leads", clientName: "Castello Industries", clientTag: "castello industries", taskId: "t1", spend7d: 100 },
      { campaignName: "Castello Retarget", clientName: "Castello Industries", clientTag: "castello industries", spend7d: 300 },
      { campaignName: "Castello Video", clientName: "Castello Industries", clientTag: "castello industries", taskId: "t2", spend7d: 50 },
      { campaignName: "Arcturus A", clientName: "Arcturus Construction", clientTag: "arcturus construction", spend7d: 10 },
      { campaignName: "Ardon", clientName: "Ardon", clientTag: "ardon", taskId: "t9", spend7d: 5 },
    ];
    for (const [name, card] of GOLDEN.cardFor) expect(cardFor(name, campaigns) ?? null).toEqual(card as any);
  });
  it("moves the Ad Status only when the board disagrees with Meta", () => {
    for (const [meta, board, out] of GOLDEN.boardStatusAfter) expect(boardStatusAfter(meta ?? undefined, board ?? undefined) ?? null).toBe(out);
  });
  it("cleans Do's & Don'ts into the same format", () => {
    for (const [raw, out] of GOLDEN.cleanDosDonts) expect(cleanDosDonts(raw)).toEqual(out as any);
  });
  it("uses the Kuwait-day 7-day window", () => {
    for (const w of GOLDEN.cplWindow) expect(daysAgo(7, Date.parse(w.now))).toBe(w.since7);
  });
});

describe("retry reference line", () => {
  it("is stable per item and step, and short", () => {
    const id = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
    expect(refLine(id)).toBe("Cockpit ref 0f1e2d3c4b");
    expect(refLine(id, "l")).toBe("Cockpit ref 0f1e2d3c4b-l");
    expect(refLine(id)).toBe(refLine(id));
  });
});
