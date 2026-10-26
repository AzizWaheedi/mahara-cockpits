import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import * as KPI from "../../../apps/media-buyer-cockpit/src/lib/kpi.ts";
import { GOLDEN } from "./convexGolden";
import {
  boardStatusAfter,
  cardFor,
  changeComment,
  cleanDosDonts,
  CPB_911,
  CPB_GATE,
  cpbBand,
  CPL_911,
  CPL_GATE,
  cplBand,
  daysAgo,
  decisionComment,
  isChange,
  kpiBand,
  money,
  plain,
  REQUEST_TYPE_OPTION,
  refLine,
  TECH_REQUEST_TYPE,
} from "./rules";

// Every expectation here was produced by the Convex code itself (convexGolden.ts).
describe("parity with the paused Convex code", () => {
  it("bands CPL and CPB exactly as the board dropdowns did, on the Convex scale (1.5 x the gate)", () => {
    expect(CPL_GATE).toBe(15);
    expect(CPB_GATE).toBe(60);
    for (const [v, label] of GOLDEN.kpiBandCpl) expect(kpiBand(v, CPL_GATE, CPL_GATE * 1.5)).toBe(label);
    // The Convex scale before decision 3 (23 Oct 2026): 90 Below KPI, 90.01 911. A record, not today's band.
    for (const [v, label] of GOLDEN.kpiBandCpb) expect(kpiBand(v, CPB_GATE, CPB_GATE * 1.5)).toBe(label);
  });
  it("Cost Per Lead keeps the Convex band: its 911 line is the cockpit's very high line, 1.5 x the gate", () => {
    for (const [v, label] of GOLDEN.kpiBandCpl) expect(cplBand(v)).toBe(label);
  });
  // The only intended difference: em dashes become hyphens (plain), per the house style.
  it("formats money the same way", () => {
    for (const [v, s] of GOLDEN.money) expect(money(v ?? undefined)).toBe(plain(s));
  });
  it("writes the decision comment byte for byte, em dashes aside", () => {
    for (const [d, text] of GOLDEN.decisionComment) expect(decisionComment(d as any)).toBe(plain(text));
  });
  it("writes the change comment byte for byte, including the late-post rule, em dashes aside", () => {
    const now = Date.parse("2026-10-09T09:00:00Z");
    for (const [m, text] of GOLDEN.changeComment) expect(changeComment(m as any, now)).toBe(plain(text));
  });
  it("never writes an em dash and keeps the cockpit marker", () => {
    for (const [d] of GOLDEN.decisionComment) {
      const text = decisionComment(d as any);
      expect(text.includes("—")).toBe(false);
      expect(text.startsWith("🎯 Cockpit · ")).toBe(true);
    }
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

describe("decision 3 (Aziz, 23 Oct 2026): Cost Per Booking's 911 starts over $80", () => {
  it("takes the gates and the critical lines from the cockpit's kpi.ts, never its own numbers", () => {
    expect(CPL_GATE).toBe(KPI.CPL_GATE);
    expect(CPB_GATE).toBe(KPI.CPB_GATE);
    expect(CPB_911).toBe(KPI.CPB_BAD);
    expect(CPB_911).toBe(80);
    expect(CPL_911).toBe(KPI.CPL_BAD);
    expect(CPL_911).toBe(22.5);
    const src = readFileSync(new URL("./rules.ts", import.meta.url), "utf8");
    expect(src).toContain('import { CPB_BAD, CPB_GATE, CPL_BAD, CPL_GATE } from "../../../apps/media-buyer-cockpit/src/lib/kpi.ts";');
    expect(/const\s+(CPL_GATE|CPB_GATE|CPB_911|CPL_911)\s*=\s*\d/.test(src)).toBe(false);
    expect(src).not.toContain("gate * 1.5");
  });
  it("bands Cost Per Booking at $45 / $60 / $80", () => {
    const cases: [number, string][] = [
      [0, "Above KPI"], [45, "Above KPI"], [45.01, "At KPI"], [60, "At KPI"], [60.01, "Below KPI"],
      [80, "Below KPI"], [80.01, "911"], [86.07, "911"], [90, "911"], [90.01, "911"],
    ];
    for (const [v, label] of cases) expect([v, cpbBand(v)]).toEqual([v, label]);
  });
  it("bands Cost Per Lead at $11.25 / $15 / $22.50", () => {
    const cases: [number, string][] = [[11.25, "Above KPI"], [11.26, "At KPI"], [15, "At KPI"], [15.01, "Below KPI"], [22.5, "Below KPI"], [22.51, "911"]];
    for (const [v, label] of cases) expect([v, cplBand(v)]).toEqual([v, label]);
  });
  it("the convexGolden record is unchanged: it still says 90 Below KPI, 90.01 911", () => {
    expect(GOLDEN.kpiBandCpb.slice(-2)).toEqual([[90, "Below KPI"], [90.01, "911"]]);
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

describe("Request Type options for the cockpit's own tech wordings (contract 4.6, CT section 7)", () => {
  it("maps the qualification and landing page wordings to their own options, never Connect a New Lead Form", () => {
    expect(TECH_REQUEST_TYPE["Add qualification questions to the lead form"]).toBe("7fc82c41-7bcd-47f7-bae0-868d4954495b");
    expect(TECH_REQUEST_TYPE["Switch to a landing page"]).toBe("a2d9483c-2dde-486d-969e-78679e5d27a6");
    expect(TECH_REQUEST_TYPE["Switch this campaign to a landing page"]).toBe("a2d9483c-2dde-486d-969e-78679e5d27a6");
    expect(Object.values(TECH_REQUEST_TYPE)).not.toContain("37d99ca0-e53f-4499-90e8-f1be8a21b207");
  });
  it("keeps the two tracking wordings on Missing Leads", () => {
    expect(TECH_REQUEST_TYPE["Landing page or tracking is broken"]).toBe(REQUEST_TYPE_OPTION.missingLeads);
    expect(TECH_REQUEST_TYPE["Tracking / page is broken"]).toBe("9fd304bb-7078-4485-9b9f-aa19ad47ed98");
  });
  it("every option id is one of the folder field's options in request-types.json", () => {
    const types = JSON.parse(readFileSync(new URL("../../../docs/requests/request-types.json", import.meta.url), "utf8")).types as { request_type_option_id: string; clickup_option_name: string }[];
    const ids = new Map(types.map(t => [t.request_type_option_id, t.clickup_option_name]));
    for (const id of Object.values(TECH_REQUEST_TYPE)) expect(ids.has(id)).toBe(true);
    expect(ids.get(REQUEST_TYPE_OPTION.qualificationQuestions)).toBe("Add Custom Qualification Questions🙋");
    expect(ids.get(REQUEST_TYPE_OPTION.landingPage)).toBe("Create Landing Page📊");
  });
});
