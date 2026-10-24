import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as csBilling from "../../client-success-cockpit/src/lib/billing";
import * as mbBilling from "../src/lib/billing";
import {
  addMonths,
  type BalancesRead,
  buildPending,
  lastCardsRun,
  nameKey,
  type PendingRow,
  type PendingView,
  partsOf,
  proofs,
  type ReadConfirmation,
  type ReadDeal,
  type ReadRail,
  similarity,
} from "../src/lib/billingBalances";
import {
  afterTies,
  CASTELLO_WEBSITE,
  copyRead,
  LIVE_2026_10_23,
  websiteLeftOut,
} from "./fixtures/billingBalances20261023";

// Pending payments: the rule (src/lib/billingBalances.ts) on the rows the
// read returned live on 23 Oct 2026, against the expected list of
// hw-notes/billing-pending/PLAN.md section 5, then the edge cases of PLAN 3.4.

const NOW = Date.parse("2026-10-23T20:31:00+03:00");
const live = () => buildPending(LIVE_2026_10_23, NOW);
const rowOf = (v: PendingView, name: string): PendingRow => {
  const r = [...v.rows, ...v.quiet.rows].find(x => x.name === name);
  if (!r) throw new Error(`${name} is not on the list`);
  return r;
};
const partOf = (r: PendingRow, key: string) => {
  const p = r.parts.find(x => x.key === key);
  if (!p) throw new Error(`${r.name} has no part ${key}`);
  return p;
};
const names = (v: PendingView, chip: string) =>
  v.rows
    .filter(r => r.chips.includes(chip as never))
    .map(r => r.name)
    .sort();

const ALULA = "شركة العلا";
const METALS = "شركة مصنع المعادن الهندسية للصناعة";
const KHALIDA = "شركة منشآت خالدة للاستشارات الهندسية";
const NUHOOD = "نهوض نجد";
const MADANA = "مدانة العمرانية لﻺستشارات";

describe("the expected list on live data, 23 Oct 2026 (PLAN 5)", () => {
  const v = live();

  test("the figures", () => {
    expect(v.figures.onboarding).toEqual({
      usd: 23752.82,
      count: 6,
      unknown: 0,
    });
    expect(v.figures.later).toEqual({ usd: 8032, count: 4, unknown: 0 });
    // Not seen covers 9 different clients: ARCWANI is in both.
    expect(v.figures.notSeen).toEqual({ usd: 31784.82, count: 9, unknown: 0 });
    expect(v.figures.another).toEqual({ usd: 10000, count: 4, unknown: 0 });
    expect(v.figures.person).toEqual({ usd: 0, count: 0, unknown: 0 });
    // Typed on closer forms, not on a rail: shown, and already inside Not seen.
    expect(v.figures.typed).toEqual({ usd: 7500, count: 3, unknown: 0 });
    // Nothing is due on an onboarding call still to come today.
    expect(v.figures.upcoming).toEqual({ usd: 0, count: 0, unknown: 0 });
    // Every row with a deal has its amounts; the two card-only rows (no
    // closer form) have none and are in no figure, not even as unknown.
    expect(v.rows.filter(r => !r.cardOnly).every(r => r.amountsKnown)).toBe(
      true,
    );
    expect(v.rows.filter(r => r.cardOnly).map(r => r.amountsKnown)).toEqual([
      false,
      false,
    ]);
    expect(v.chips.map(c => [c.key, c.count])).toEqual([
      ["notSeen", 9],
      ["onboarding", 6],
      ["later", 4],
      ["another", 4],
      ["toCome", 5],
    ]);
  });

  test("not seen: deposit or onboarding payment", () => {
    expect(names(v, "onboarding")).toEqual(
      [
        ALULA,
        METALS,
        "ARCWANI",
        "Alalia.co",
        "Alkhalil",
        "Professional Touch Company",
      ].sort(),
    );
    const metals = rowOf(v, METALS);
    expect(metals.headline).toBe("Paid in full · Onboarding payment");
    expect([
      metals.contractUsd,
      metals.railsUsd,
      metals.onboardingNotSeenUsd,
    ]).toEqual([6000, 250, 5750]);
    // The call's time is the GHL booking's (Fathom's is when the recording began).
    expect(metals.dueLine).toBe(
      "Call 19 Oct 12:00 (Fathom held, GHL confirmed)",
    );
    expect([metals.daysLate, metals.tone, metals.when]).toEqual([
      4,
      "critical",
      "4 days late",
    ]);
    expect(metals.sources).toContain(
      "Kickoff form 20 Oct typed $0 (typed, not money)",
    );

    const touch = rowOf(v, "Professional Touch Company");
    expect(touch.deal?.business).toBe("Brillant touch company");
    expect(touch.deal?.matchedBy).toBe("alias");
    expect(touch.headline).toBe(
      "Paid in full · Deposit and onboarding payment",
    );
    expect([
      touch.contractUsd,
      touch.railsUsd,
      touch.notSeenUsd,
      touch.typedUsd,
    ]).toEqual([5000, 0, 5000, 4000]);
    expect(touch.dueLine).toBe(
      "Onboarding call not on record · kickoff form 15 Apr (old form)",
    );
    expect([touch.daysLate, touch.tone]).toEqual([191, "critical"]);
    expect(touch.disagree).toBe("Sources disagree: card LTV $4,000, rails $0");
    expect(touch.notes).toContain(
      "Terms from the closer form of 2 Apr. Check they still hold.",
    );
    expect(touch.notes).toContain(
      "No rail has ever shown a payment from this client. A transfer shows only once someone logs it.",
    );
    expect(
      touch.sources.some(s => s.startsWith("Older closer form of 1 Apr")),
    ).toBe(true);

    const alalia = rowOf(v, "Alalia.co");
    expect([alalia.railsUsd, alalia.notSeenUsd]).toEqual([2497.18, 3502.82]);
    expect(alalia.dueLine).toBe(
      "Onboarding call not on record · card moved past Onboarding Booked 13 Oct",
    );
    // Ten days late, held at warning by INV-2026-026's pay note (to 5 Nov).
    expect([alalia.daysLate, alalia.tone]).toEqual([10, "warning"]);
    expect(partOf(alalia, "onboarding").signals[0]).toBe(
      'Invoice INV-2026-026 (22 Oct) says: "The pending amount of 3,500$ must be fully paid by end of October."',
    );

    const khalil = rowOf(v, "Alkhalil");
    expect([khalil.railsUsd, khalil.notSeenUsd]).toEqual([2500, 3500]);
    expect(khalil.dueLine).toBe("Call 23 Aug (Fathom held, matched by name)");
    expect([khalil.daysLate, khalil.tone]).toEqual([61, "critical"]);
    expect(khalil.notes).toContain("The card says Split Pay (2x payments).");

    const arcwani = rowOf(v, "ARCWANI");
    expect(arcwani.headline).toBe("Split · Deposit and second half");
    expect([arcwani.onboardingNotSeenUsd, arcwani.typedUsd]).toEqual([
      3000, 3000,
    ]);
    expect(partOf(arcwani, "deposit")).toMatchObject({
      due: "2026-07-12",
      daysLate: 103,
      tone: "critical",
    });
    // The onboarding part is $0 (the typed $3,000 is the first half), so it is dropped.
    expect(arcwani.parts.map(p => p.key)).toEqual(["deposit", "later-1"]);

    const alula = rowOf(v, ALULA);
    expect(alula.headline).toBe("Monthly · Deposit and onboarding payment");
    expect([alula.onboardingNotSeenUsd, alula.typedUsd]).toEqual([3000, 500]);
    expect(alula.dueLine).toBe(
      "Onboarding call not on record · kickoff form 1 Sep (old form)",
    );
    expect(alula.daysLate).toBe(52);
  });

  test("not seen: later parts", () => {
    expect(names(v, "later")).toEqual(
      ["ARCWANI", "Atlantis Contracting", "Castello Industries", NUHOOD].sort(),
    );
    const arcwani = partOf(rowOf(v, "ARCWANI"), "later-1");
    expect(arcwani).toMatchObject({
      label: "Second half",
      notSeen: 3000,
      due: "2026-09-28",
      daysLate: 25,
      tone: "critical",
    });
    expect(arcwani.dueLine).toBe(
      "28 Sep (launch 28 Aug + 1 month); the card agrees",
    );

    const atlantis = rowOf(v, "Atlantis Contracting");
    expect([
      atlantis.railsUsd,
      atlantis.laterNotSeenUsd,
      atlantis.daysLate,
      atlantis.tone,
    ]).toEqual([3000, 3000, 11, "critical"]);
    expect(atlantis.dueLine).toBe(
      "12 Oct (card moved it from 30 Sep on 9 Oct, no reason on record)",
    );

    const nuhood = rowOf(v, NUHOOD);
    expect(nuhood.headline).toBe("Monthly · Month 3 of 3");
    expect([
      nuhood.contractUsd,
      nuhood.railsUsd,
      nuhood.laterNotSeenUsd,
      nuhood.daysLate,
    ]).toEqual([5000, 3468, 1532, 103]);
    expect(nuhood.dueLine).toBe("12 Jul (launch 12 May + 2 months)");
    expect(nuhood.disagree).toBe(
      "Sources disagree: card LTV $4,795, rails $3,468",
    );
    expect(nuhood.notes).toContain(
      "The card asks $700 on 7 Oct; the rails leave $1,532 on month 3 of 3.",
    );

    const castello = rowOf(v, "Castello Industries");
    expect([
      castello.railsUsd,
      castello.laterNotSeenUsd,
      castello.daysLate,
      castello.tone,
    ]).toEqual([3500, 500, 15, "critical"]);
    // Understated by the rails: the card (and Maher's invoice) put it at $2,000.
    expect(castello.notes).toContain(
      "The card asks $2,000 on 8 Oct; the rails leave $500 on month 2 of 3.",
    );
  });

  test("another source says paid", () => {
    expect(names(v, "another")).toEqual(
      [ALULA, "City Wood", "Marble and more", KHALIDA].sort(),
    );
    const wood = rowOf(v, "City Wood");
    expect([
      wood.anotherUsd,
      wood.notSeenUsd,
      wood.daysLate,
      wood.tone,
    ]).toEqual([5500, 0, 53, "warning"]);
    expect(wood.dueLine).toBe(
      "Onboarding call not on record · kickoff form 31 Aug (old form)",
    );
    expect(partOf(wood, "onboarding").signals).toEqual([
      "The card's LTV is $6,000, which covers it; the rails show $500",
    ]);

    const month2 = partOf(rowOf(v, ALULA), "later-1");
    expect([month2.another, month2.due]).toEqual([2000, "2026-10-13"]);
    expect(month2.signals).toEqual([
      "Aziz logged $2,000 Tap on 20 Oct, refused: Tap is connected, so a Tap payment arrives on the Tap rail by itself; logging it would count it twice.",
      "The card was marked paid on 20 Oct (LTV $2,000 → $4,000, next 13 Oct → 13 Nov, by Aziz)",
    ]);

    const khalida = rowOf(v, KHALIDA);
    expect([khalida.railsUsd, khalida.anotherUsd, khalida.daysLate]).toEqual([
      4500, 1500, 69,
    ]);

    const marble = rowOf(v, "Marble and more");
    expect([marble.railsUsd, marble.anotherUsd, marble.daysLate]).toEqual([
      2000, 1000, 34,
    ]);
    expect(marble.dueLine).toBe(
      "Onboarding call not on record · launched 19 Sep",
    );
    // The second half moved from 19 Oct to 2 Nov by the CEO's 2-week extension.
    expect(partOf(marble, "later-1")).toMatchObject({
      due: "2026-11-02",
      notDue: 3000,
      notSeen: 0,
    });
    expect(partOf(marble, "later-1").dueLine).toBe(
      "Moved from 19 Oct to 2 Nov by Abdulaziz (2-week extension): Issue with the ad account and had to be fixed",
    );
  });

  test("still to come", () => {
    expect(names(v, "toCome")).toEqual(
      [
        "Ardon",
        "Liwan Limited Construction and Finishing Of Buildings",
        "Safad Consultant Engineering",
        "Smmim studio",
        MADANA,
      ].sort(),
    );
    const ardon = rowOf(v, "Ardon");
    expect(ardon.nextPart).toEqual({
      key: "later-1",
      label: "Month 2 of 3",
      usd: 2000,
      due: "2026-10-27",
    });
    expect([ardon.leftUsd, ardon.cardNext]).toEqual([4000, null]);
    expect(ardon.when).toBe("in 4 days");
    const madana = rowOf(v, MADANA);
    expect(madana.nextPart?.due).toBe("2026-11-20");
    expect(madana.leftUsd).toBe(4000);
    const smmim = rowOf(v, "Smmim studio");
    expect(smmim.nextPart).toEqual({
      key: "later-1",
      label: "Month 2 of 3",
      usd: 834,
      due: null,
    });
    expect(smmim.dueLine).toBe("Due a month after launch (no launch day yet)");
    expect([smmim.railsUsd, smmim.leftUsd]).toEqual([2500, 2500]);
    expect(smmim.notes).toContain(
      "Terms from the closer form of 9 Apr. Check they still hold.",
    );
    expect(v.nothingDueLine).toBe(
      "Nothing due is unseen. Next: Ardon, $2,000 on 27 Oct.",
    );
  });

  test("the CEO's deal with no card, and what it becomes once linked", () => {
    expect(v.unlinked).toHaveLength(1);
    const u = v.unlinked[0];
    expect(u.deal.business).toBe("اكتوروس للتشيد");
    expect(u.line).toBe(
      "Signed 25 Aug, $6,000 Monthly, no client card found. Probably Arcturus Construction (signed up 25 Aug).",
    );
    expect(u.preview?.notSeenUsd).toBe(4000);
    expect(u.preview?.parts.map(p => [p.label, p.notSeen, p.due])).toEqual([
      ["Deposit", 500, "2026-08-25"],
      ["Onboarding payment", 1500, "2026-08-27"],
      ["Month 2 of 3", 2000, "2026-10-03"],
      ["Month 3 of 3", 0, "2026-11-03"],
    ]);
    expect(u.preview?.typedUsd).toBe(500);
    // Possible money: the Whop payer's $500 (24 Aug) and $1,500 (1 Sep).
    const whop = u.hints
      .filter(h => h.rail === "whop")
      .map(h => [h.partLabel, h.usd, h.day]);
    expect(whop).toEqual([
      ["Deposit", 500, "2026-08-24"],
      ["Onboarding payment", 1500, "2026-09-01"],
    ]);
    // Arcturus is late on its own card, but it is the suggested card, so it
    // is not in the footnote.
    expect(v.footnote?.names).toEqual(["Joe and Sera Company"]);
    expect(v.footnote?.line).toBe(
      "1 more client is late on its card's next payment with no signed deal we could match: Joe and Sera Company (the card asks $1,666, due 24 Sep). It is in the sheet's Late view.",
    );
  });

  test("active clients with no closer form whose card still asks for money: still to come, out of the figures", () => {
    // Signed before the deal copy starts (1 Apr 2026): the card is the only record.
    const liwan = rowOf(
      v,
      "Liwan Limited Construction and Finishing Of Buildings",
    );
    expect([
      liwan.cardOnly,
      liwan.deal,
      liwan.headline,
      liwan.dueLine,
      liwan.when,
      liwan.chips,
      liwan.amountsKnown,
      liwan.railsUsd,
      liwan.notSeenUsd,
      liwan.confirmable,
    ]).toEqual([
      true,
      null,
      "Terms not on record",
      "The card asks $1,333 on 2 Nov",
      "in 10 days",
      ["toCome"],
      false,
      null,
      null,
      [],
    ]);
    expect(liwan.nextPart).toEqual({
      key: "card",
      label: "The card's next payment",
      usd: 1333,
      due: "2026-11-02",
    });
    expect(liwan.notes[0]).toBe(
      "Terms not on record: no closer form we could match (the deal copy starts on 1 Apr 2026). The card's next payment is the only record, so this client is kept out of the figures.",
    );
    expect(rowOf(v, "Safad Consultant Engineering").dueLine).toBe(
      "The card asks $1,300 on 27 Oct",
    );
    // The late one stays the footnote's, now with what its card asks.
    expect(v.rows.some(r => r.name === "Joe and Sera Company")).toBe(false);
    // A success manager sees the same rows (Arcturus is late on its card, so
    // without the CEO's no-card group it is in their footnote, with its amount).
    const csm = buildPending(
      { ...copyRead(LIVE_2026_10_23), ceo: false, unlinked: [] },
      NOW,
    );
    expect(csm.rows.filter(r => r.cardOnly).map(r => r.name)).toEqual([
      "Safad Consultant Engineering",
      "Liwan Limited Construction and Finishing Of Buildings",
    ]);
    expect(csm.footnote?.line).toBe(
      "2 more clients are late on their card's next payment with no signed deal we could match: Arcturus Construction (the card asks $2,000, due 3 Oct), Joe and Sera Company (the card asks $1,666, due 24 Sep). They are in the sheet's Late view.",
    );
    expect(csm.figures.notSeen).toEqual(v.figures.notSeen);
  });

  test("finished on the rails is said in one line", () => {
    expect(v.finishedLine).toBe(
      "Finished on the rails: Makers, mergestudio.kw, ocean home, Shades Interior Design & General Contracting.",
    );
  });

  test("Possible money ranks a payer like the contact first", () => {
    const first = v.possibleMoney[0];
    expect([first.day, first.rail, first.usd, first.rank]).toEqual([
      "2026-08-30",
      "tap",
      502.04,
      "payer",
    ]);
    expect(first.candidates[0]).toMatchObject({
      clientName: ALULA,
      partLabel: "Deposit",
    });
    // 620 KWD on 20 Oct: the same day as Aziz's refused log on شركة العلا.
    const oct20 = v.possibleMoney.find(p => p.day === "2026-10-20");
    expect(oct20?.rank).toBe("log");
    expect(oct20?.candidates[0]).toMatchObject({
      clientName: ALULA,
      partLabel: "Month 2 of 3",
    });
    // A payment is offered only for a part with room. The 153 KWD Tap of
    // 13 Aug fits only deposits the rails already filled (Alkhalil, Atlantis,
    // Castello, Marble), so it is offered nowhere: PLAN 6.4 names it as
    // Marble's for the CEO to tie on Money by hand.
    expect(v.possibleMoney.some(p => p.day === "2026-08-13")).toBe(false);
    expect(v.possibleMoney).toHaveLength(13);
    for (const r of v.rows)
      for (const h of r.hints) {
        const part = r.parts.find(p => p.key === h.partKey);
        expect(
          (part?.usd ?? 0) - (part?.rails ?? 0) - (part?.person ?? 0),
        ).toBeGreaterThan(0);
      }
    // 772 KWD on 2 Sep: the payer is not like شركة العلا's contact by
    // trigrams (it is like another client's), so it is amount and timing only.
    expect(v.possibleMoney.find(p => p.day === "2026-09-02")?.rank).toBe(
      "amount",
    );
  });

  test("folded groups: gone quiet and back with sales", () => {
    expect(v.quiet.line).toBe(
      "Gone quiet: 3 clients, $10,800 left (kept out of the figures)",
    );
    expect(v.quiet.rows.map(r => [r.name, r.leftUsd])).toEqual([
      ["Ghazzawi.sa", 3000],
      ["Qatar Technology", 5500],
      ["Render", 2300],
    ]);
    expect(rowOf(v, "Render").deal?.business).toBe("شركة أدق الحلول للمقاوﻻت");
    expect(v.backWithSales?.line).toBe(
      "Back with sales: 10 clients, $49,217 left (kept out of the figures)",
    );
    expect(
      v.backWithSales?.rows.map(r => [r.name, r.signedOn, r.leftUsd]),
    ).toEqual([
      ["OMB group", "2026-04-02", 4800],
      ["NA Interiors", "2026-04-06", 5000],
      ["Prime Project Solutions", "2026-04-14", 3167],
      ["Zenit", "2026-05-04", 5000],
      ["مفك للمقاولات", "2026-05-12", 4500],
      ["Aalia Designs", "2026-06-08", 4500],
      ["Kazak", "2026-06-17", 5750],
      ["شركة سويل للمقاوﻻت", "2026-07-01", 5500],
      ["شركة نفش للتصميم", "2026-07-16", 5500],
      ["vangogh designers", "2026-07-28", 5500],
    ]);
  });

  test("not listed: finished on the rails", () => {
    expect(v.finished.map(f => [f.name, f.railsUsd]).sort()).toEqual(
      [
        ["Makers", 6000],
        ["Shades Interior Design & General Contracting", 6114.1],
        ["mergestudio.kw", 5996.36],
        ["ocean home", 6028.96],
      ].sort(),
    );
    // mergestudio is within 99% of its contract, so it is finished.
    expect(v.rows.some(r => r.name === "mergestudio.kw")).toBe(false);
  });

  test("each part adds up (an FX gap within 1% counts as filled), and the ribbon is the parts", () => {
    for (const r of [...v.rows, ...v.quiet.rows].filter(x => !x.cardOnly)) {
      let parts = 0;
      for (const p of r.parts) {
        const sum = Math.round(
          (p.rails + p.person + p.notSeen + p.another + p.notDue) * 100,
        );
        const size = Math.round(p.usd * 100);
        expect(size - sum).toBeGreaterThanOrEqual(0);
        expect(size - sum).toBeLessThanOrEqual(size / 100);
        parts += sum;
      }
      expect(r.ribbon.reduce((t, s) => t + Math.round(s.usd * 100), 0)).toBe(
        parts,
      );
      expect(r.parts.filter(p => p.next).length).toBe(1);
    }
  });
});

describe("the list after Aziz's ties (PLAN 5, last part)", () => {
  const v = buildPending(afterTies(LIVE_2026_10_23), NOW);

  test("the figures", () => {
    expect(v.figures.onboarding).toEqual({
      usd: 20752.82,
      count: 5,
      unknown: 0,
    });
    expect(v.figures.later).toEqual({ usd: 10032, count: 5, unknown: 0 });
    expect(v.figures.another).toEqual({ usd: 7501.22, count: 3, unknown: 0 });
  });

  test("شركة العلا moves to still to come, Marble keeps $501.22, Arcturus shows $2,000", () => {
    const alula = rowOf(v, ALULA);
    expect(alula.railsUsd).toBe(5039.96);
    expect(alula.chips).toEqual(["toCome"]);
    expect(alula.nextPart).toEqual({
      key: "later-2",
      label: "Month 3 of 3",
      usd: 1960.04,
      due: "2026-11-13",
    });
    const marble = rowOf(v, "Marble and more");
    expect([marble.railsUsd, marble.anotherUsd]).toEqual([2498.78, 501.22]);
    const arcturus = rowOf(v, "Arcturus Construction");
    expect(arcturus.deal?.matchedBy).toBe("link");
    expect(arcturus.notes).toContain(
      "Closer form linked to this card by Abdulaziz.",
    );
    expect([
      arcturus.railsUsd,
      arcturus.laterNotSeenUsd,
      arcturus.daysLate,
      arcturus.tone,
    ]).toEqual([2000, 2000, 20, "critical"]);
    expect(v.unlinked).toEqual([]);
    // The tied payments are no longer Possible money.
    expect(
      v.possibleMoney.some(p => p.day === "2026-08-30" && p.rail === "tap"),
    ).toBe(false);
  });
});

describe("the CEO's website mark on Castello (20261024p, WRITE-PLAN S7)", () => {
  const LINE =
    "$1,500 on 21 Aug was the website, not program money (Whop; left out by Abdulaziz)";
  const ties = buildPending(afterTies(LIVE_2026_10_23), NOW);
  const v = buildPending(websiteLeftOut(afterTies(LIVE_2026_10_23)), NOW);
  const others = (x: PendingView) =>
    JSON.stringify(
      [...x.rows, ...x.quiet.rows].filter(
        r => r.name !== "Castello Industries",
      ),
    );

  test("Castello reads $2,000 not seen on Month 2 of 3, and Later parts $11,532", () => {
    expect(v.figures.later).toEqual({ usd: 11532, count: 5, unknown: 0 });
    // Nothing else moves: the onboarding and another-source figures stay as after the ties.
    expect(v.figures.onboarding).toEqual(ties.figures.onboarding);
    expect(v.figures.another).toEqual(ties.figures.another);
    expect(v.figures.notSeen).toEqual({
      ...ties.figures.notSeen,
      usd: (ties.figures.notSeen.usd as number) + 1500,
    });
    expect(v.figures.notSeen.usd).toBe(32284.82);
    const castello = rowOf(v, "Castello Industries");
    expect([
      castello.railsUsd,
      castello.notSeenUsd,
      castello.laterNotSeenUsd,
      castello.leftUsd,
      castello.daysLate,
      castello.tone,
    ]).toEqual([2000, 2000, 2000, 4000, 15, "critical"]);
    expect(castello.headline).toBe("Monthly · Month 2 of 3");
    expect(castello.chips).toEqual(["notSeen", "later"]);
    expect(
      castello.parts.map(p => [p.key, p.usd, p.rails, p.notSeen, p.notDue]),
    ).toEqual([
      ["deposit", 500, 500, 0, 0],
      ["onboarding", 1500, 1500, 0, 0],
      ["later-1", 2000, 0, 2000, 0],
      ["later-2", 2000, 0, 0, 2000],
    ]);
    // The card's $2,000 now agrees with the rails, so the understated note is gone.
    expect(castello.notes.some(n => n.startsWith("The card asks"))).toBe(false);
    expect(partOf(castello, "later-1").dueLine).toBe(
      "8 Oct (launch 8 Sep + 1 month); the card agrees",
    );
    // The website payment is a source line, never a rail; its twin still counts.
    expect(castello.sources).toContain(LINE);
    expect(castello.sources.indexOf(LINE)).toBe(2);
    expect(castello.sources[1]).toBe(
      "Rails: Whop $500 (17 Aug), Whop $1,500 (21 Aug)",
    );
    expect(castello.rails.map(r => r.paymentId)).toEqual([
      "whop:pay_muyoob7p33D97Q",
      "whop:pay_GYsGMMpS9xosfk",
    ]);
    expect(castello.excluded.map(x => x.paymentId)).toEqual([CASTELLO_WEBSITE]);
    // Every other row is as it was after the ties.
    expect(others(v)).toBe(others(ties));
  });

  test("on the live read alone the mark moves Later parts from $8,032 to $9,532", () => {
    expect(live().figures.later).toEqual({ usd: 8032, count: 4, unknown: 0 });
    const alone = buildPending(websiteLeftOut(LIVE_2026_10_23), NOW);
    expect(alone.figures.later).toEqual({ usd: 9532, count: 4, unknown: 0 });
    expect(rowOf(alone, "Castello Industries").laterNotSeenUsd).toBe(2000);
  });

  test("an excluded payment is never counted twice", () => {
    // Listed twice in the read: taken out once, said once.
    const twice = websiteLeftOut(afterTies(LIVE_2026_10_23));
    twice.exclusions = [
      ...(twice.exclusions ?? []),
      ...(twice.exclusions ?? []),
    ];
    const t2 = buildPending(twice, NOW);
    expect(t2.figures).toEqual(v.figures);
    const c2 = rowOf(t2, "Castello Industries");
    expect(c2.railsUsd).toBe(2000);
    expect(c2.sources.filter(s => s === LINE)).toHaveLength(1);
    expect(c2.excluded).toHaveLength(1);
    // A read whose rails still carry the payment (a server before 20261024p
    // with the row added): the rule takes it out itself, once, not twice.
    const older = afterTies(LIVE_2026_10_23);
    older.exclusions = websiteLeftOut(older).exclusions;
    const t3 = buildPending(older, NOW);
    expect(t3.figures).toEqual(v.figures);
    expect(rowOf(t3, "Castello Industries")).toEqual(
      rowOf(v, "Castello Industries"),
    );
    // With no exclusions (an older read, or none set), nothing changes.
    const none = afterTies(LIVE_2026_10_23);
    delete none.exclusions;
    expect(buildPending(none, NOW)).toEqual(ties);
  });

  test("an exclusion never invents money: it only takes out the payment it names", () => {
    // A payment no row holds, on a deal no row shows: no figure, row or line changes.
    const stray = afterTies(LIVE_2026_10_23);
    stray.exclusions = [
      {
        ...(websiteLeftOut(stray).exclusions?.[0] as NonNullable<
          BalancesRead["exclusions"]
        >[number]),
        paymentId: "whop:pay_notOnAnyRow",
        dealResponseId: "no-such-deal",
        usd: 9999,
      },
    ];
    const s = buildPending(stray, NOW);
    expect(s.figures).toEqual(ties.figures);
    expect(
      JSON.stringify([...s.rows, ...s.quiet.rows].map(r => r.sources)),
    ).toBe(
      JSON.stringify([...ties.rows, ...ties.quiet.rows].map(r => r.sources)),
    );
    for (const r of [...s.rows, ...s.quiet.rows])
      expect(r.excluded).toEqual([]);
    // Its own dollars never move a figure: only the named payment leaves the rails.
    const big = websiteLeftOut(afterTies(LIVE_2026_10_23));
    (big.exclusions as NonNullable<BalancesRead["exclusions"]>)[0].usd = 9999;
    const b = buildPending(big, NOW);
    expect(b.figures).toEqual(v.figures);
    expect(rowOf(b, "Castello Industries").railsUsd).toBe(2000);
    // A mark counts only on the deal it was set on: the website payment named
    // on another deal (a read whose rails still carry it on Castello's) leaves
    // Castello's row, and every figure, as it was.
    const elsewhere = afterTies(LIVE_2026_10_23);
    elsewhere.exclusions = websiteLeftOut(elsewhere).exclusions?.map(x => ({
      ...x,
      dealResponseId: "no-such-deal",
    }));
    const e = buildPending(elsewhere, NOW);
    expect(e.figures).toEqual(ties.figures);
    expect(rowOf(e, "Castello Industries")).toEqual(
      rowOf(ties, "Castello Industries"),
    );
    // An untied payment is on no deal, so a mark on a deal never takes it off
    // Possible money (Money untied it since, or the mark names another deal).
    const read = copyRead(LIVE_2026_10_23);
    const offered = live().possibleMoney[0];
    read.exclusions = [
      {
        id: 7,
        paymentId: offered.paymentId,
        dealResponseId: "no-such-deal",
        taskId: null,
        day: offered.day,
        usd: offered.usd,
        rail: offered.rail,
        reason: "other",
        setByName: "Abdulaziz Waheedi",
        setAt: "2026-10-24T09:00:00+03:00",
        note: "A tile sample",
      },
    ];
    const p = buildPending(read, NOW);
    expect(p.possibleMoney).toEqual(live().possibleMoney);
  });

  test("Back with sales and the deals with no card count program money only too", () => {
    const read = copyRead(LIVE_2026_10_23);
    const sales = read.backWithSales.find(s => s.rails.length > 0);
    if (!sales?.deal) throw new Error("no Back with sales card with rails");
    const before = buildPending(read, NOW).backWithSales?.rows.find(
      r => r.taskId === sales.taskId,
    );
    const pay = sales.rails[0];
    read.exclusions = [
      {
        id: 8,
        paymentId: pay.paymentId,
        dealResponseId: sales.deal.responseId,
        taskId: sales.taskId,
        day: pay.day,
        usd: pay.usd,
        rail: pay.rail,
        reason: "website",
        setByName: "Abdulaziz Waheedi",
        setAt: "2026-10-24T09:00:00+03:00",
      },
    ];
    const after = buildPending(read, NOW).backWithSales?.rows.find(
      r => r.taskId === sales.taskId,
    );
    expect(before?.railsUsd).not.toBeNull();
    expect(after?.railsUsd).toBe((before?.railsUsd as number) - pay.usd);

    // The deal with no card: the 23 Oct read has one, with no rails, so a
    // made-up payment on it is left out, and the row fills as without it.
    const base = copyRead(LIVE_2026_10_23);
    const deal = base.unlinked[0];
    if (!deal) throw new Error("no deal with no card in the 23 Oct read");
    const rail = {
      dealResponseId: deal.responseId,
      paymentId: "whop:pay_unlinked1",
      usd: 500,
      day: deal.signedOn as string,
      rail: "whop",
      kind: "deposit",
      fromLedger: true,
      byHand: false,
    };
    const withRail = copyRead(LIVE_2026_10_23);
    withRail.unlinked[0].rails.push(rail);
    const leftOut = copyRead(withRail);
    leftOut.exclusions = [
      {
        id: 9,
        paymentId: rail.paymentId,
        dealResponseId: deal.responseId,
        taskId: null,
        day: rail.day,
        usd: rail.usd,
        rail: rail.rail,
        reason: "website",
        setByName: "Abdulaziz Waheedi",
        setAt: "2026-10-24T09:00:00+03:00",
      },
    ];
    const filled = (read: BalancesRead) => {
      const u = buildPending(read, NOW).unlinked.find(
        x => x.deal.responseId === deal.responseId,
      );
      if (!u) throw new Error("the deal with no card is not listed");
      return [
        u.railsUsd,
        u.leftUsd,
        u.preview?.railsUsd ?? null,
        u.preview?.parts.map(p => [p.key, p.rails]) ?? null,
      ];
    };
    expect(filled(withRail)).not.toEqual(filled(base));
    expect(filled(withRail)[0]).toBe(500);
    expect(filled(leftOut)).toEqual(filled(base));
    // Its preview on the suggested card names the payment as a source line, never a rail.
    const preview = buildPending(leftOut, NOW).unlinked.find(
      x => x.deal.responseId === deal.responseId,
    )?.preview;
    if (!preview) throw new Error("no preview for the deal with no card");
    expect(preview.rails.map(r => r.paymentId)).not.toContain(rail.paymentId);
    expect(preview.sources).toContain(
      "$500 on 25 Aug was the website, not program money (Whop; left out by Abdulaziz)",
    );
  });

  test("the line for something else carries the CEO's note; a success manager's read has none", () => {
    const read = websiteLeftOut(LIVE_2026_10_23);
    const x = (read.exclusions as NonNullable<BalancesRead["exclusions"]>)[0];
    x.reason = "other";
    x.note = "Logo design, sold the same day";
    expect(
      rowOf(buildPending(read, NOW), "Castello Industries").sources,
    ).toContain(
      "$1,500 on 21 Aug is not program money: Logo design, sold the same day (Whop; left out by Abdulaziz)",
    );
    // The server sends no note to a success manager; the website line needs none.
    const csm = websiteLeftOut(LIVE_2026_10_23);
    csm.ceo = false;
    delete (csm.exclusions as NonNullable<BalancesRead["exclusions"]>)[0].note;
    expect(
      rowOf(buildPending(csm, NOW), "Castello Industries").sources,
    ).toContain(LINE);
  });
});

// --- edge cases (PLAN 3.4) ----------------------------------------------------

/** A read with one card and one deal, made up, for the edge cases. */
function oneClient(over: {
  deal?: Partial<ReadDeal>;
  card?: Partial<BalancesRead["cards"][number]>;
  rails?: Partial<ReadRail>[];
  today?: string;
}): BalancesRead {
  const read = copyRead(LIVE_2026_10_23);
  const taskId = "edgecase01";
  read.today = over.today ?? "2026-10-23";
  read.cards = [
    {
      taskId,
      name: "Edge Case Co",
      url: null,
      group: "active",
      status: "Active",
      previousStatus: null,
      quiet: false,
      plan: null,
      method: null,
      nextUsd: null,
      nextDate: null,
      extensionWeeks: null,
      ltvFieldUsd: null,
      launchOn: "2026-09-01",
      signupOn: "2026-08-20",
      cardCallOn: null,
      noteAtOnboardingUsd: null,
      noteContractUsd: null,
      inOnboarding: false,
      firstPastOnboardingBookedOn: null,
      csm: null,
      ...over.card,
    },
  ];
  read.deals = [
    {
      responseId: "deal-edge-01",
      signedAt: "2026-08-20T12:00:00+03:00",
      signedOn: "2026-08-20",
      business: "Edge Case Co",
      paymentStructure: "Paid in full (90 days)",
      contractUsd: 6000,
      depositUsd: 500,
      atOnboardingUsd: null,
      secondPaymentUsd: null,
      newMrrUsd: null,
      taskId,
      matchedBy: "ledger",
      conflict: false,
      otherForms: [],
      ...over.deal,
    },
  ];
  read.rails = (over.rails ?? []).map((r, i) => ({
    dealResponseId: "deal-edge-01",
    paymentId: `whop:edge${i}`,
    day: "2026-08-20",
    usd: 500,
    rail: "whop",
    kind: "deposit",
    fromLedger: true,
    byHand: false,
    ...r,
  }));
  read.calls = [];
  read.kickoffs = [];
  read.cardHistory = [];
  read.events = [];
  read.inbox = [];
  read.invoices = [];
  read.ecomOpen = [];
  read.confirmations = [];
  read.untied = [];
  read.unlinked = [];
  read.backWithSales = [];
  return read;
}
const edge = (read: BalancesRead, now = NOW) => {
  const v = buildPending(read, now);
  return { v, row: v.rows[0] as PendingRow | undefined };
};

/** The live deal of a named card in a copy of the read. */
const dealFor = (read: BalancesRead, name: string): ReadDeal => {
  const card = read.cards.find(c => c.name === name);
  const deal = read.deals.find(d => card && d.taskId === card.taskId);
  if (!deal) throw new Error(`${name} has no deal in the fixture`);
  return deal;
};

/** A success manager's Tap confirmation (made-up person), for the cases below. */
const csmConfirmation = (
  deal: ReadDeal,
  over: Partial<ReadConfirmation> = {},
): ReadConfirmation => ({
  id: 51,
  taskId: deal.taskId as string,
  dealResponseId: deal.responseId,
  part: "all",
  partNo: 0,
  amount: 1000,
  currency: "USD",
  usd: 1000,
  rail: "tap",
  paidOn: "2026-10-10",
  evidenceUrl: null,
  note: null,
  railsUsdAtConfirm: 0,
  source: "csm",
  confirmedByName: "Sara Hamed",
  confirmedByCeo: false,
  byYou: false,
  // Eight days before NOW: past the 7 days a success manager's word waits.
  confirmedAt: "2026-10-15T10:00:00+03:00",
  withdrawnByName: null,
  withdrawnAt: null,
  withdrawnReason: null,
  ...over,
});

describe("the plan's parts", () => {
  const deal = (
    paymentStructure: string,
    over: Partial<ReadDeal> = {},
  ): ReadDeal => ({
    responseId: "d",
    signedAt: "2026-08-20T12:00:00+03:00",
    business: "x",
    paymentStructure,
    contractUsd: 6000,
    depositUsd: 500,
    atOnboardingUsd: null,
    secondPaymentUsd: null,
    newMrrUsd: null,
    ...over,
  });
  const cut = (d: ReadDeal) => partsOf(d).specs.map(s => [s.label, s.c / 100]);

  test("paid in full, split, monthly, month to month", () => {
    expect(cut(deal("Paid in full ($6,000)"))).toEqual([
      ["Deposit", 500],
      ["Onboarding payment", 5500],
    ]);
    expect(cut(deal("Split Pay (2x payments)"))).toEqual([
      ["Deposit", 500],
      ["Onboarding payment", 2500],
      ["Second half", 3000],
    ]);
    // C/3 rounded to the dollar; the last part absorbs the rounding.
    expect(cut(deal("Monthly", { contractUsd: 5000 }))).toEqual([
      ["Deposit", 500],
      ["Onboarding payment", 1167],
      ["Month 2 of 3", 1667],
      ["Month 3 of 3", 1666],
    ]);
    // The closer form's two answers set the onboarding payment and each later part.
    expect(
      cut(
        deal("Monthly", {
          contractUsd: 7000,
          atOnboardingUsd: 2500,
          secondPaymentUsd: 2000,
        }),
      ),
    ).toEqual([
      ["Deposit", 500],
      ["Onboarding payment", 2500],
      ["Month 2 of 3", 2000],
      ["Month 3 of 3", 2000],
    ]);
    expect(
      cut(deal("Month to month", { contractUsd: 2000, newMrrUsd: 2000 })),
    ).toEqual([
      ["Deposit", 500],
      ["Onboarding payment", 1500],
    ]);
    expect(partsOf(deal("Performance ($3k/$3k)")).plan).toBe("unreadable");
  });

  test("a monthly amount under a 36th of the contract is a typo: the parts still add up to it", () => {
    const sum = (d: ReadDeal) =>
      partsOf(d).specs.reduce((t, x) => t + x.c, 0) / 100;
    for (const over of [
      { secondPaymentUsd: 100 },
      { secondPaymentUsd: 3 },
      { newMrrUsd: 50 },
    ]) {
      const d = deal("Monthly", over);
      expect(sum(d)).toBe(6000);
      expect(cut(d)).toEqual([
        ["Deposit", 500],
        ["Onboarding payment", 1500],
        ["Month 2 of 3", 2000],
        ["Month 3 of 3", 2000],
      ]);
      expect(partsOf(d).notes).toEqual([
        `The closer form's monthly amount $${Object.values(over)[0]} looks wrong for a $6,000 contract; $2,000 a month is used.`,
      ]);
    }
    // A good second payment is used when the monthly field is the typo.
    const both = deal("Monthly", { newMrrUsd: 50, secondPaymentUsd: 1500 });
    expect(sum(both)).toBe(6000);
    expect(cut(both).slice(2)).toEqual([
      ["Month 2 of 4", 1500],
      ["Month 3 of 4", 1500],
      ["Month 4 of 4", 1500],
    ]);
    expect(partsOf(both).notes[0]).toBe(
      "The closer form's monthly amount $50 looks wrong for a $6,000 contract; $1,500 a month is used.",
    );
    // The live amounts are never typos.
    expect(partsOf(deal("Monthly", { secondPaymentUsd: 2000 })).notes).toEqual(
      [],
    );
  });

  test("a typed amount cuts the parts and a $0 part is dropped", () => {
    expect(cut(deal("Split Pay (2x payments)", { depositUsd: 3000 }))).toEqual([
      ["Deposit", 3000],
      ["Second half", 3000],
    ]);
  });

  test("months add as calendar months, clamped to the month's end", () => {
    expect(addMonths("2026-08-31", 1)).toBe("2026-09-30");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-05-12", 2)).toBe("2026-07-12");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("finished, FX and typed amounts", () => {
  test("a part within 1% counts as filled, figures stay exact", () => {
    const { row } = edge(
      oneClient({
        deal: {
          paymentStructure: "Monthly",
          depositUsd: 500,
          atOnboardingUsd: 1500,
          secondPaymentUsd: 2000,
        },
        rails: [
          { usd: 500 },
          { usd: 1490, day: "2026-09-01", paymentId: "tap:fx", rail: "tap" },
        ],
      }),
    );
    expect(partOf(row as PendingRow, "onboarding")).toMatchObject({
      rails: 1490,
      notSeen: 0,
    });
    expect(row?.railsUsd).toBe(1990);
    expect(row?.leftUsd).toBe(4010);
  });

  test("a closer who types the whole contract still leaves the client listed", () => {
    const { row } = edge(oneClient({ deal: { depositUsd: 6000 } }));
    expect(row?.notSeenUsd).toBe(6000);
    expect(row?.typedUsd).toBe(6000);
    expect(row?.headline).toBe("Paid in full · Deposit");
  });

  test("paid in full at 99% is finished", () => {
    const { v } = edge(
      oneClient({
        rails: [
          { usd: 500 },
          { usd: 5440, day: "2026-08-25", paymentId: "tap:x", rail: "tap" },
        ],
      }),
    );
    expect(v.rows).toEqual([]);
    expect(v.finished.map(f => f.railsUsd)).toEqual([5940]);
  });

  test("a deal older than 120 days counts a card payment after day 120 (نهوض نجد)", () => {
    const nuhood = rowOf(live(), NUHOOD);
    const cardSide = nuhood.rails.filter(r => !r.fromLedger);
    expect(cardSide.map(r => [r.day, r.usd])).toEqual([
      ["2026-08-07", 700],
      ["2026-09-22", 735],
    ]);
    expect(nuhood.railsUsd).toBe(3468);
  });

  test("a linked deal counts the card's own payments", () => {
    const { row } = edge(
      oneClient({
        deal: { matchedBy: "link", linkedByName: "Abdulaziz Waheedi" },
        rails: [
          { usd: 500 },
          {
            usd: 2000,
            day: "2026-09-02",
            paymentId: "transfer:c1",
            rail: "manual",
            fromLedger: false,
            byHand: true,
          },
        ],
      }),
    );
    expect(row?.railsUsd).toBe(2500);
    expect(row?.sources[1]).toBe(
      "Rails: Whop $500 (20 Aug), transfer $2,000 (2 Sep, logged by hand, tied to the card)",
    );
  });
});

describe("confirmations: a person's word, proven only by its rail", () => {
  const conf = (over: Partial<ReadConfirmation>): ReadConfirmation => ({
    id: 1,
    taskId: "edgecase01",
    dealResponseId: "deal-edge-01",
    part: "onboarding",
    partNo: 0,
    amount: 1000,
    currency: "USD",
    usd: 1000,
    rail: "tap",
    paidOn: "2026-10-10",
    evidenceUrl: null,
    note: null,
    railsUsdAtConfirm: 0,
    source: "csm",
    confirmedByName: "Sara Hamed",
    confirmedByCeo: false,
    byYou: false,
    confirmedAt: "2026-10-21T10:00:00+03:00",
    withdrawnByName: null,
    withdrawnAt: null,
    withdrawnReason: null,
    ...over,
  });
  const rail = (over: Partial<ReadRail>): ReadRail => ({
    dealResponseId: "deal-edge-01",
    paymentId: "tap:p1",
    day: "2026-10-10",
    usd: 1000,
    rail: "tap",
    kind: "remainder",
    fromLedger: true,
    byHand: false,
    ...over,
  });

  test("the proof: same rail, within 2%, 3 days before to 14 after", () => {
    const c = [conf({})];
    expect(
      proofs(c, [rail({ usd: 990, day: "2026-10-08" })]).get(1)?.paymentId,
    ).toBe("tap:p1");
    expect(proofs(c, [rail({ usd: 1030 })]).size).toBe(0);
    expect(proofs(c, [rail({ day: "2026-10-06" })]).size).toBe(0);
    expect(proofs(c, [rail({ day: "2026-10-25" })]).size).toBe(0);
    expect(proofs(c, [rail({ day: "2026-10-24" })]).size).toBe(1);
    // A later Whop instalment of the same size does not prove a Tap confirmation.
    expect(
      proofs(c, [
        rail({ rail: "whop", paymentId: "whop:x", day: "2026-10-12" }),
      ]).size,
    ).toBe(0);
    // A withdrawn confirmation proves nothing and holds nothing.
    expect(
      proofs(
        [
          conf({
            withdrawnAt: "2026-10-22T10:00:00+03:00",
            withdrawnByName: "Sara",
            withdrawnReason: "wrong client",
          }),
        ],
        [rail({})],
      ).size,
    ).toBe(0);
  });

  test("one payment proves one confirmation, oldest first, closest day first", () => {
    const c = [
      conf({
        id: 2,
        confirmedAt: "2026-10-21T11:00:00+03:00",
        paidOn: "2026-10-12",
      }),
      conf({
        id: 1,
        confirmedAt: "2026-10-21T10:00:00+03:00",
        paidOn: "2026-10-10",
      }),
    ];
    const p = proofs(c, [
      rail({ paymentId: "tap:a", day: "2026-10-11" }),
      rail({ paymentId: "tap:b", day: "2026-10-09" }),
    ]);
    expect(p.get(1)?.paymentId).toBe("tap:b");
    expect(p.get(2)?.paymentId).toBe("tap:a");
    expect(
      proofs(c, [rail({ paymentId: "tap:a", day: "2026-10-11" })]).has(2),
    ).toBe(false);
  });

  const withConfirmations = (
    cs: ReadConfirmation[],
    rails: Partial<ReadRail>[] = [{ usd: 500 }],
  ) => {
    const read = oneClient({
      deal: { paymentStructure: "Split Pay (2x payments)" },
      rails,
    });
    read.confirmations = cs;
    return read;
  };

  test("until proven it holds its part, and rail money fills the other parts first", () => {
    // Split $6,000: deposit 500, onboarding 2,500, second half 3,000.
    const read = withConfirmations(
      [conf({ amount: 2500, usd: 2500 })],
      [
        { usd: 500 },
        { usd: 2500, day: "2026-10-12", paymentId: "whop:later", rail: "whop" },
      ],
    );
    const { row } = edge(read);
    expect(partOf(row as PendingRow, "onboarding")).toMatchObject({
      rails: 0,
      person: 2500,
      notSeen: 0,
    });
    expect(partOf(row as PendingRow, "later-1")).toMatchObject({ rails: 2500 });
    expect(row?.personUsd).toBe(2500);
    expect(row?.confirmations[0].line).toBe(
      "Confirmed by Sara · waiting for Tap",
    );
    expect(row?.ribbon.find(s => s.partKey === "onboarding")?.state).toBe(
      "person",
    );
  });

  test("proven: the part turns solid and says which rail shows it", () => {
    const read = withConfirmations(
      [conf({ amount: 2500, usd: 2500, byYou: true })],
      [
        { usd: 500 },
        { usd: 2490, day: "2026-10-12", paymentId: "tap:p", rail: "tap" },
      ],
    );
    const { row } = edge(read);
    expect(row?.confirmations[0]).toMatchObject({
      state: "proven",
      line: "Tap shows it (12 Oct)",
    });
    expect(row?.personUsd).toBe(0);
    expect(partOf(row as PendingRow, "onboarding").rails).toBe(2490);
  });

  test("several confirmations on one part sum to it, capped at the part", () => {
    const read = withConfirmations([
      conf({ id: 1, amount: 2000, usd: 2000 }),
      conf({
        id: 2,
        amount: 2000,
        usd: 2000,
        confirmedAt: "2026-10-21T12:00:00+03:00",
      }),
    ]);
    const { row } = edge(read);
    expect(partOf(row as PendingRow, "onboarding")).toMatchObject({
      person: 2500,
      notSeen: 0,
    });
    // Only the second half (due 1 Oct) is left unseen.
    expect(row?.chips).toEqual(["notSeen", "later"]);
  });

  test("a withdrawn confirmation is ignored", () => {
    const read = withConfirmations([
      conf({
        withdrawnAt: "2026-10-22T10:00:00+03:00",
        withdrawnByName: "Sara Hamed",
        withdrawnReason: "Wrong client",
      }),
    ]);
    const { row } = edge(read);
    expect(row?.personUsd).toBe(0);
    expect(row?.confirmations[0]).toMatchObject({
      state: "withdrawn",
      line: "Withdrawn by Sara: Wrong client",
    });
    expect(partOf(row as PendingRow, "onboarding").notSeen).toBe(2500);
  });

  test("a success manager's confirmation older than 7 days goes to the CEO", () => {
    const read = withConfirmations([
      conf({ confirmedAt: "2026-10-14T10:00:00+03:00", byYou: true }),
    ]);
    const ceo = edge(read);
    expect(ceo.row?.confirmations[0].state).toBe("stale");
    expect(ceo.v.staleConfirmations.map(s => s.line)).toEqual([
      "Sara confirmed $1,000 Tap paid 10 Oct, 9 days ago; no Tap payment proves it yet",
    ]);
    const csm = edge({ ...read, ceo: false });
    expect(csm.row?.confirmations[0].line).toBe(
      "Confirmed by you 9 days ago · waiting for the CEO to find it",
    );
    expect(csm.v.staleConfirmations).toEqual([]);
    // The CEO's own confirmation never goes stale.
    const own = edge(
      withConfirmations([
        conf({
          confirmedAt: "2026-10-01T10:00:00+03:00",
          confirmedByCeo: true,
          source: "ceo",
        }),
      ]),
    );
    expect(own.row?.confirmations[0].state).toBe("waiting");
  });

  test("a row with no contract value or a plan nobody can read still shows its confirmations", () => {
    for (const [mutate, emptyUsd] of [
      [(d: ReadDeal) => Object.assign(d, { contractUsd: null }), null],
      [
        (d: ReadDeal) =>
          Object.assign(d, { paymentStructure: "Custom: 3 + 3" }),
        2500,
      ],
    ] as const) {
      const read = copyRead(LIVE_2026_10_23);
      const deal = dealFor(read, "Alkhalil");
      mutate(deal);
      read.confirmations = [csmConfirmation(deal)];
      const v = buildPending(read, NOW);
      const row = rowOf(v, "Alkhalil");
      expect(row.confirmations.map(c => [c.state, c.partKey])).toEqual([
        ["stale", null],
      ]);
      expect(row.personUsd).toBe(1000);
      expect(v.figures.person).toEqual({ usd: 1000, count: 1, unknown: 0 });
      expect(v.staleConfirmations.map(s => s.clientName)).toEqual(["Alkhalil"]);
      // Contract $6,000, rails $2,500, $1,000 held: $2,500 is left to confirm.
      expect(row.confirmable).toEqual([
        { part: "all", partNo: 0, label: "What they paid in all", emptyUsd },
      ]);
    }
  });

  test("after Confirm paid the row names the part it holds, never Finished", () => {
    const read = copyRead(LIVE_2026_10_23);
    const deal = dealFor(read, METALS);
    read.confirmations = [
      csmConfirmation(deal, {
        part: "onboarding",
        amount: 5750,
        usd: 5750,
        paidOn: "2026-10-19",
        confirmedAt: "2026-10-22T10:00:00+03:00",
        byYou: true,
      }),
    ];
    const v = buildPending(read, NOW);
    const metals = rowOf(v, METALS);
    expect(metals.headline).toBe("Paid in full · Onboarding payment");
    expect(metals.dueLine).toBe("Confirmed by you · waiting for Tap");
    expect([metals.notSeenUsd, metals.personUsd, metals.chips]).toEqual([
      0,
      5750,
      ["toCome"],
    ]);
    expect(metals.nextPart).toBeNull();
    expect(v.figures.onboarding).toEqual({
      usd: 18002.82,
      count: 5,
      unknown: 0,
    });
    expect(
      [...v.rows, ...v.quiet.rows].some(r => /Finished/.test(r.headline)),
    ).toBe(false);
  });

  test("the figure counts only confirmations no rail has proven", () => {
    const v = buildPending(withConfirmations([conf({})]), NOW);
    expect(v.figures.person).toEqual({ usd: 1000, count: 1, unknown: 0 });
  });
});

describe("dates", () => {
  test("an extension moves the part it moved from (Marble), marked paid is not a move (شركة العلا)", () => {
    const v = live();
    expect(partOf(rowOf(v, "Marble and more"), "later-1").due).toBe(
      "2026-11-02",
    );
    expect(partOf(rowOf(v, ALULA), "later-1").due).toBe("2026-10-13");
  });

  test("Set on the card's date event is the card catching up with the plan, not a move (Ardon)", () => {
    const read = copyRead(LIVE_2026_10_23);
    const card = read.cards.find(c => c.name === "Ardon");
    const deal = read.deals.find(d => d.taskId === card?.taskId);
    if (!card || !deal) throw new Error("No Ardon card or deal");
    const ardonOn = (day: string, cardWas: string) => {
      const r = copyRead(read);
      const c = r.cards.find(x => x.taskId === card.taskId);
      if (c) c.nextDate = "2026-10-27";
      // What "Set on the card" leaves in the billing log: the card's old day
      // to the plan's next part's day.
      r.events.push({
        id: 999_001,
        taskId: card.taskId,
        kind: "date",
        from: cardWas,
        to: "2026-10-27",
        reason: "Month 2 of 3, the plan's next part (Pending payments)",
        weeks: null,
        movedDate: null,
        source: "ceo",
        byName: "Aziz Waheedi",
        at: "2026-10-23T13:00:00+03:00",
      });
      r.today = day;
      return rowOf(
        buildPending(r, Date.parse(`${day}T12:00:00+03:00`)),
        "Ardon",
      );
    };
    // The card sat on month 3's day: month 3 stays on 27 Nov, not due.
    let ardon = ardonOn("2026-10-28", "2026-11-27");
    expect(partOf(ardon, "later-1").due).toBe("2026-10-27");
    expect(partOf(ardon, "later-2").due).toBe("2026-11-27");
    expect(partOf(ardon, "later-2").dueLine).not.toMatch(/^Moved/);
    expect(ardon.laterNotSeenUsd).toBe(2000);
    // The common case, the card a few days off the plan: nothing reads as moved.
    ardon = ardonOn("2026-10-23", "2026-10-25");
    expect(partOf(ardon, "later-1").due).toBe("2026-10-27");
    expect(partOf(ardon, "later-1").dueLine).not.toMatch(/^Moved/);
    // Once month 2 is on a rail, the same event still leaves month 3 alone.
    read.rails.push({
      dealResponseId: deal.responseId,
      paymentId: "test-ardon-month-2",
      day: "2026-10-27",
      usd: 2000,
      rail: "whop",
      kind: null,
      fromLedger: true,
      byHand: false,
    });
    ardon = ardonOn("2026-10-28", "2026-11-27");
    expect(partOf(ardon, "later-2").due).toBe("2026-11-27");
    expect(ardon.laterNotSeenUsd).toBe(0);
    // A real move by a person still moves its part (an extension, any gap).
    expect(partOf(rowOf(live(), "Marble and more"), "later-1").dueLine).toMatch(
      /^Moved from 19 Oct to 2 Nov by /,
    );
  });

  test("an unexplained card date moves a later part within 21 days, never an onboarding part", () => {
    const v = live();
    expect(partOf(rowOf(v, "Atlantis Contracting"), "later-1").due).toBe(
      "2026-10-12",
    );
    // City Wood's card says 11 Dec and Alkhalil's 1 Nov: the onboarding part stays.
    expect(partOf(rowOf(v, "City Wood"), "onboarding").due).toBe("2026-08-31");
    expect(partOf(rowOf(v, "Alkhalil"), "onboarding").due).toBe("2026-08-23");
    // 22 days on is too far: the plan's day stands.
    const { row } = edge(
      oneClient({
        deal: { paymentStructure: "Split Pay (2x payments)" },
        card: { launchOn: "2026-09-01", nextDate: "2026-10-23", nextUsd: 3000 },
        rails: [{ usd: 3000 }],
      }),
    );
    expect(partOf(row as PendingRow, "later-1").due).toBe("2026-10-01");
  });

  test("the pay note holds Alalia.co at warning for 14 days, then it is critical", () => {
    const read = copyRead(LIVE_2026_10_23);
    read.today = "2026-11-06";
    const alalia = rowOf(
      buildPending(read, NOW + 14 * 86_400_000),
      "Alalia.co",
    );
    expect(alalia.tone).toBe("critical");
    read.today = "2026-11-05";
    expect(
      rowOf(buildPending(read, NOW + 13 * 86_400_000), "Alalia.co").tone,
    ).toBe("warning");
  });

  test("an invoice's due date is the agreed day", () => {
    const read = oneClient({
      deal: { paymentStructure: "Split Pay (2x payments)" },
      rails: [{ usd: 3000 }],
    });
    read.invoices = [
      {
        taskId: "edgecase01",
        invoiceNo: "INV-9",
        kind: "checkout",
        amountUsd: 3000,
        issueDate: "2026-10-05",
        dueDate: "2026-10-25",
        status: "issued",
        payNote: null,
      },
    ];
    const before = edge(read).row as PendingRow;
    expect(partOf(before, "later-1")).toMatchObject({
      tone: "warning",
      daysLate: -2,
    });
    expect(partOf(before, "later-1").signals).toEqual([
      "Invoice INV-9 asks by 25 Oct",
    ]);
    read.today = "2026-10-30";
    expect(partOf(edge(read).row as PendingRow, "later-1")).toMatchObject({
      tone: "critical",
      daysLate: 5,
    });
  });

  test("marking a partly paid part paid is another source, not a move (Castello)", () => {
    // Month 2 has $1,500 on the rails and $500 empty. Maher marks it paid on
    // 20 Oct: the card's LTV rises by $500 and its next date moves on a month.
    const read = copyRead(LIVE_2026_10_23);
    const castello = read.cards.find(c => c.name === "Castello Industries");
    if (!castello) throw new Error("no Castello card");
    read.events.push({
      taskId: castello.taskId,
      kind: "date",
      from: "2026-10-08",
      to: "2026-11-08",
      reason: "Paid; next payment set",
      weeks: null,
      byName: "Maher",
      at: "2026-10-20T10:00:00+03:00",
    });
    read.cardHistory.push({
      taskId: castello.taskId,
      day: "2026-10-20",
      ltvUsd: 2500,
      nextDate: "2026-11-08",
      nextUsd: 2000,
      stage: "Active",
    });
    const v = buildPending(read, NOW);
    const month2 = partOf(rowOf(v, "Castello Industries"), "later-1");
    expect([month2.rails, month2.another, month2.notDue, month2.due]).toEqual([
      1500,
      500,
      0,
      "2026-10-08",
    ]);
    expect(month2.signals).toContain(
      "The card was marked paid on 20 Oct (LTV $2,000 → $2,500, next 8 Oct → 8 Nov, by Maher)",
    );
    expect(v.figures.later).toEqual({ usd: 7532, count: 3, unknown: 0 });
    expect(v.figures.another).toEqual({ usd: 10500, count: 5, unknown: 0 });
  });

  test("an invoice re-dates only the part its amount fits (ARCWANI)", () => {
    const read = copyRead(LIVE_2026_10_23);
    const arcwani = read.cards.find(c => c.name === "ARCWANI");
    if (!arcwani) throw new Error("no ARCWANI card");
    const invoice = (no: string, amountUsd: number) => ({
      taskId: arcwani.taskId,
      invoiceNo: no,
      kind: "checkout",
      amountUsd,
      issueDate: "2026-10-20",
      dueDate: "2026-11-30",
      status: "issued",
      payNote: null,
    });
    // A $250 checkout fits neither $3,000 part: a source line only.
    read.invoices = [invoice("INV-SMALL", 250)];
    const small = rowOf(buildPending(read, NOW), "ARCWANI");
    expect(
      small.parts.map(p => [p.key, p.tone, p.daysLate, p.signals]),
    ).toEqual([
      ["deposit", "critical", 103, []],
      ["later-1", "critical", 25, []],
    ]);
    expect(small.sources).toContain(
      "Invoice INV-SMALL (20 Oct, issued) $250, asks by 30 Nov",
    );
    // A $3,000 one asks for one part, the first due part it fits.
    read.invoices = [invoice("INV-FULL", 3000)];
    const full = rowOf(buildPending(read, NOW), "ARCWANI");
    expect(full.parts.map(p => [p.key, p.tone, p.daysLate])).toEqual([
      ["deposit", "warning", -38],
      ["later-1", "critical", 25],
    ]);
    expect(full.tone).toBe("critical");
  });

  test("the onboarding day is the earliest of call, kickoff (old form too) and stage", () => {
    const v = live();
    expect(partOf(rowOf(v, "Alalia.co"), "onboarding").due).toBe("2026-10-13");
    expect(partOf(rowOf(v, "City Wood"), "onboarding").due).toBe("2026-08-31");
    const read = oneClient({
      card: { firstPastOnboardingBookedOn: "2026-09-10" },
    });
    read.kickoffs = [
      {
        taskId: "edgecase01",
        submittedAt: "2026-09-05T10:00:00+03:00",
        kind: "kickoff_old",
        typedPayment: null,
      },
    ];
    read.calls = [
      {
        taskId: "edgecase01",
        startsAt: "2026-09-07T12:00:00+03:00",
        status: "held",
        source: "fathom",
        matchMethod: "appointment_time",
        confidence: 1,
        booked: false,
      },
    ];
    expect(partOf(edge(read).row as PendingRow, "onboarding").due).toBe(
      "2026-09-05",
    );
  });

  test("a booked call warns from 2 days before, is serious on the day and critical after", () => {
    const at = (today: string) => {
      const read = oneClient({
        today,
        card: {
          group: "pipeline",
          status: "Onboarding Booked",
          inOnboarding: true,
          launchOn: null,
        },
        rails: [{ usd: 500 }],
      });
      read.calls = [
        {
          taskId: "edgecase01",
          startsAt: "2026-10-30T12:00:00+03:00",
          status: "confirmed",
          source: "ghl_appointment",
          matchMethod: "client_id_field",
          confidence: 1,
          booked: true,
        },
      ];
      return edge(read).row as PendingRow;
    };
    expect(at("2026-10-27").notSeenUsd).toBe(0);
    expect(at("2026-10-27").dueLine).toBe("Call 30 Oct 12:00 (booked)");
    expect(at("2026-10-27").when).toBe("in 3 days");
    expect([at("2026-10-28").notSeenUsd, at("2026-10-28").tone]).toEqual([
      5500,
      "warning",
    ]);
    expect(at("2026-10-30").tone).toBe("serious");
    expect(at("2026-10-31").tone).toBe("critical");
  });

  test("an onboarding payment still to come is under Onboarding and its own figure, never in Not seen", () => {
    const read = oneClient({
      card: {
        group: "pipeline",
        status: "Onboarding Booked",
        inOnboarding: true,
        launchOn: null,
      },
      rails: [{ usd: 500 }],
    });
    // Not booked: the row says what to do so it warns in time.
    let { v, row } = edge(read);
    expect([
      row?.dueLine,
      row?.when,
      row?.chips,
      row?.notSeenUsd,
      row?.upcomingOnboardingUsd,
    ]).toEqual([
      "Onboarding call not booked yet. Book it on the GHL onboarding calendar so this warns 2 days before.",
      null,
      ["onboarding", "toCome"],
      0,
      5500,
    ]);
    expect(v.figures.upcoming).toEqual({ usd: 5500, count: 1, unknown: 0 });
    expect(v.figures.onboarding).toEqual({ usd: 0, count: 0, unknown: 0 });
    // Booked a week ahead: the call's day and time, and how soon.
    read.calls = [
      {
        taskId: "edgecase01",
        startsAt: "2026-10-30T14:30:00+03:00",
        status: "booked",
        source: "ghl_appointment",
        matchMethod: "client_id_field",
        confidence: 1,
        booked: true,
      },
    ];
    ({ v, row } = edge(read));
    expect([row?.dueLine, row?.when, row?.chips]).toEqual([
      "Call 30 Oct 14:30 (booked)",
      "in 7 days",
      ["onboarding", "toCome"],
    ]);
    expect(v.figures.upcoming).toEqual({ usd: 5500, count: 1, unknown: 0 });
  });

  test("the card's onboarding call date stands in when the GHL calendar has no booking", () => {
    const at = (today: string, over: Partial<BalancesRead> = {}) => {
      const read = oneClient({
        today,
        card: {
          group: "pipeline",
          status: "Onboarding Booked",
          inOnboarding: true,
          launchOn: null,
          cardCallOn: "2026-10-28",
        },
        rails: [{ usd: 500 }],
      });
      Object.assign(read, over);
      return edge(read).row as PendingRow;
    };
    const early = at("2026-10-23");
    expect([
      early.dueLine,
      early.when,
      early.notSeenUsd,
      early.upcomingOnboardingUsd,
    ]).toEqual([
      "Call 28 Oct (card date, not on the GHL onboarding calendar)",
      "in 5 days",
      0,
      5500,
    ]);
    // It warns from two days before, like a booked call.
    expect([at("2026-10-26").notSeenUsd, at("2026-10-26").tone]).toEqual([
      5500,
      "warning",
    ]);
    expect(at("2026-10-28").tone).toBe("serious");
    expect(at("2026-10-29").tone).toBe("critical");
    // A booking on the GHL onboarding calendar wins over the card's date.
    const booked = at("2026-10-23", {
      calls: [
        {
          taskId: "edgecase01",
          startsAt: "2026-11-02T11:00:00+03:00",
          status: "confirmed",
          source: "ghl_appointment",
          matchMethod: "client_id_field",
          confidence: 1,
          booked: true,
        },
      ],
    });
    expect(booked.dueLine).toBe("Call 2 Nov 11:00 (booked)");
    // So does a call already on record.
    const held = at("2026-10-23", {
      calls: [
        {
          taskId: "edgecase01",
          startsAt: "2026-10-20T11:00:00+03:00",
          status: "held",
          source: "fathom",
          matchMethod: "client_id_field",
          confidence: 1,
          booked: false,
        },
      ],
    });
    expect([held.dueLine, held.when]).toEqual([
      "Call 20 Oct (Fathom held)",
      "3 days late",
    ]);
    // The card's date is the source line it always was.
    expect(early.sources).toContain("Card: onboarding call date 28 Oct");
  });

  test("later parts: warning on the day, serious 1 to 3 days late, critical from 4", () => {
    const at = (today: string) =>
      partOf(
        edge(
          oneClient({
            today,
            deal: { paymentStructure: "Split Pay (2x payments)" },
            rails: [{ usd: 3000 }],
          }),
        ).row as PendingRow,
        "later-1",
      ).tone;
    expect(at("2026-10-01")).toBe("warning");
    expect(at("2026-10-02")).toBe("serious");
    expect(at("2026-10-04")).toBe("serious");
    expect(at("2026-10-05")).toBe("critical");
  });
});

describe("second sources", () => {
  test("S1 from a refused inbox row (شركة العلا), S3 all or nothing (City Wood in, ARCWANI out)", () => {
    const v = live();
    expect(partOf(rowOf(v, ALULA), "later-1").signals[0]).toContain(
      "Aziz logged $2,000 Tap on 20 Oct, refused",
    );
    expect(rowOf(v, "City Wood").anotherUsd).toBe(5500);
    expect(rowOf(v, "ARCWANI").anotherUsd).toBe(0);
    expect(rowOf(v, "ARCWANI").disagree).toBe(
      "Sources disagree: card LTV $3,000, rails $0",
    );
  });

  test("an ingested inbox row is money already, never a second source", () => {
    const read = oneClient({
      deal: { paymentStructure: "Split Pay (2x payments)" },
      rails: [{ usd: 3000 }],
    });
    read.inbox = [
      {
        id: 9,
        taskId: "edgecase01",
        paidOn: "2026-10-01",
        amount: 3000,
        currency: "USD",
        usd: 3000,
        method: "bank_transfer",
        source: "csm",
        status: "ingested",
        statusNote: "In the ledger.",
        loggedByName: "Sara",
        loggedAt: "2026-10-01T10:00:00+03:00",
      },
    ];
    expect(edge(read).row?.anotherUsd).toBe(0);
    read.inbox[0].status = "pending";
    expect(edge(read).row?.anotherUsd).toBe(3000);
  });
});

describe("scope", () => {
  test("GHOSTED straight from Paused counts as paused (AIVE, Greystone)", () => {
    const read = oneClient({
      card: { status: "GHOSTED", previousStatus: "Paused", quiet: true },
    });
    const { v } = edge(read);
    expect([v.rows.length, v.quiet.rows.length]).toEqual([0, 0]);
    read.cards[0].previousStatus = "Ready For Launch🚀";
    expect(edge(read).v.quiet.rows.length).toBe(1);
  });

  test("a success manager gets no Back with sales, no deals with no card and no Possible money", () => {
    const read = copyRead(LIVE_2026_10_23);
    read.ceo = false;
    read.untied = [];
    read.unlinked = [];
    read.backWithSales = [];
    for (const d of read.deals) {
      delete d.contactName;
      delete d.conflictWith;
    }
    const v = buildPending(read, NOW);
    expect(v.backWithSales).toBeNull();
    expect(v.unlinked).toEqual([]);
    expect(v.possibleMoney).toEqual([]);
    expect(v.rows.every(r => r.hints.length === 0)).toBe(true);
    // The figures are the same rows' (every seat sees every client today).
    expect(v.figures).toEqual(live().figures);
    // With no deal to suggest it, Arcturus is one more late card with no deal.
    expect(v.footnote?.names).toEqual([
      "Arcturus Construction",
      "Joe and Sera Company",
    ]);
  });
});

describe("Back with sales (CEO only)", () => {
  test("the CEO's confirmation on a Back with sales card shows there, and what is left to confirm", () => {
    const read = copyRead(LIVE_2026_10_23);
    const omb = read.backWithSales.find(s => s.name === "OMB group");
    if (!omb?.deal) throw new Error("OMB group has no deal in the fixture");
    read.confirmations = [
      {
        id: 7,
        taskId: omb.taskId,
        dealResponseId: omb.deal.responseId,
        part: "onboarding",
        partNo: 0,
        amount: 2300,
        currency: "USD",
        usd: 2300,
        rail: "tap",
        paidOn: "2026-10-20",
        evidenceUrl: null,
        note: null,
        railsUsdAtConfirm: 200,
        source: "ceo",
        confirmedByName: "Abdulaziz Waheedi",
        confirmedByCeo: true,
        byYou: true,
        confirmedAt: "2026-10-22T10:00:00+03:00",
        withdrawnByName: null,
        withdrawnAt: null,
        withdrawnReason: null,
      },
    ];
    const row = buildPending(read, NOW).backWithSales?.rows.find(
      r => r.name === "OMB group",
    );
    expect(row?.personUsd).toBe(2300);
    expect(row?.confirmations[0].line).toBe(
      "Confirmed by you · waiting for Tap",
    );
    // Split $5,000 with $200 typed and $200 on the rails: the deposit is
    // filled, and the CEO's unproven $2,300 holds the onboarding payment, so
    // only the second half is offered (as on a listed row).
    expect(row?.confirmable).toEqual([
      { part: "later", partNo: 1, label: "Second half", emptyUsd: 2500 },
    ]);
    // Never in a figure.
    expect(buildPending(read, NOW).figures).toEqual(live().figures);
  });

  test("an active card with no deal is never a Terms not on record row", () => {
    const read = oneClient({
      card: { group: "active", nextDate: "2026-10-01", nextUsd: 1000 },
    });
    read.deals = [];
    const { v } = edge(read);
    expect(v.rows).toEqual([]);
    expect(v.footnote?.names).toEqual(["Edge Case Co"]);
  });
});

describe("missing is never zero", () => {
  test("no contract value", () => {
    const { row, v } = edge(oneClient({ deal: { contractUsd: null } }));
    expect(row?.notes[0]).toBe(
      "Contract value not on the closer form. Ask the closer, then confirm what was paid.",
    );
    expect([row?.leftUsd, row?.parts.length, row?.ribbon.length]).toEqual([
      null,
      0,
      0,
    ]);
    // Unknown, never $0: the row's amounts are null and the figure says one
    // client's amount is not known.
    expect(row?.amountsKnown).toBe(false);
    expect([
      row?.notSeenUsd,
      row?.onboardingNotSeenUsd,
      row?.laterNotSeenUsd,
      row?.anotherUsd,
      row?.typedUsd,
    ]).toEqual([null, null, null, null, null]);
    expect(v.figures.notSeen).toEqual({ usd: 0, count: 0, unknown: 1 });
    expect(row?.chips).toEqual(["notSeen"]);
    expect(row?.confirmable).toEqual([
      {
        part: "all",
        partNo: 0,
        label: "What they paid in all",
        emptyUsd: null,
      },
    ]);
  });

  test("a plan nobody can read shows what is left on the contract", () => {
    const { row } = edge(
      oneClient({
        deal: { paymentStructure: "Performance ($3k/$3k)" },
        rails: [{ usd: 500 }],
      }),
    );
    expect(row?.notes[0]).toBe(
      "Plan not readable: 'Performance ($3k/$3k)'. $5,500 left on the contract.",
    );
  });

  test("month to month has no left on the contract", () => {
    const { row } = edge(
      oneClient({
        deal: { paymentStructure: "Month to month", contractUsd: 2000 },
        rails: [{ usd: 500 }],
      }),
    );
    expect(row?.leftUsd).toBeNull();
    expect(row?.plan).toBe("m2m");
  });

  test("month to month leaves the list once its deposit and first month are on the rails", () => {
    const read = copyRead(LIVE_2026_10_23);
    // Ardon's $500 + $1,500 are on the rails.
    dealFor(read, "Ardon").paymentStructure = "Month to month";
    const v = buildPending(read, NOW);
    expect(v.rows.some(r => r.name === "Ardon")).toBe(false);
    expect(v.finished.map(f => f.name)).toContain("Ardon");
    // With a person's unproven confirmation holding the first month, it stays.
    const held = oneClient({
      deal: {
        paymentStructure: "Month to month",
        contractUsd: 2000,
        newMrrUsd: 2000,
      },
      rails: [{ usd: 500 }],
    });
    held.confirmations = [
      csmConfirmation(dealFor(held, "Edge Case Co"), {
        part: "onboarding",
        amount: 1500,
        usd: 1500,
        confirmedAt: "2026-10-22T10:00:00+03:00",
      }),
    ];
    const { row } = edge(held);
    expect([row?.finished, row?.headline, row?.dueLine]).toEqual([
      false,
      "Month to month · Onboarding payment",
      "Confirmed by Sara · waiting for Tap",
    ]);
  });

  test("the folded groups name the clients with no amount left, never adding them as $0", () => {
    const read = copyRead(LIVE_2026_10_23);
    dealFor(read, "Render").contractUsd = null;
    const omb = read.backWithSales.find(x => x.name === "OMB group");
    if (!omb?.deal) throw new Error("OMB group has no deal in the fixture");
    omb.deal.contractUsd = null;
    const v = buildPending(read, NOW);
    expect(v.quiet.line).toBe(
      "Gone quiet: 3 clients, $8,500 left, not counting 1 with no contract value (kept out of the figures)",
    );
    expect(v.backWithSales?.line).toBe(
      "Back with sales: 10 clients, $44,417 left, not counting 1 with no contract value (kept out of the figures)",
    );
    expect(
      v.backWithSales?.rows.find(r => r.name === "OMB group")?.confirmable,
    ).toEqual([
      {
        part: "all",
        partNo: 0,
        label: "What they paid in all",
        emptyUsd: null,
      },
    ]);
  });

  test("a line with no name on record says Someone, never a made-up person", () => {
    const read = oneClient({
      deal: { paymentStructure: "Split Pay (2x payments)" },
      rails: [{ usd: 3000 }],
    });
    read.events = [
      {
        taskId: "edgecase01",
        kind: "invoice",
        from: null,
        to: null,
        reason: "Whop invoice for $3,000 sent",
        weeks: null,
        byName: null,
        at: "2026-10-19T10:00:00+03:00",
      },
    ];
    read.confirmations = [
      csmConfirmation(dealFor(read, "Edge Case Co"), {
        part: "later",
        partNo: 1,
        confirmedByName: null,
      }),
    ];
    const { row, v } = edge(read);
    expect(row?.sources).toContain(
      "Someone, 19 Oct: Whop invoice for $3,000 sent",
    );
    expect(v.staleConfirmations.map(s => s.line)).toEqual([
      "Someone confirmed $1,000 Tap paid 10 Oct, 8 days ago; no Tap payment proves it yet",
    ]);
  });

  test("a card in onboarding with no deal reads Terms not on record", () => {
    const read = oneClient({
      card: {
        group: "pipeline",
        status: "Onboarding Booked",
        inOnboarding: true,
      },
    });
    read.deals = [];
    const { row } = edge(read);
    expect(row?.notes).toEqual([
      "Terms not on record: no closer form we could match. Confirm what they paid.",
    ]);
    expect(row?.confirmable).toEqual([
      {
        part: "all",
        partNo: 0,
        label: "What they paid in all",
        emptyUsd: null,
      },
    ]);
    expect(row?.notSeenUsd).toBeNull();
  });

  test("the mirror columns empty: the plan's amounts, said as such", () => {
    const read = copyRead(LIVE_2026_10_23);
    for (const d of read.deals) {
      d.atOnboardingUsd = null;
      d.secondPaymentUsd = null;
    }
    const v = buildPending(read, NOW);
    const metals = rowOf(v, METALS);
    expect(metals.notSeenUsd).toBe(5750);
    expect(metals.notes).toContain(
      "Onboarding payment $5,750 from the plan (the closer form's answer is not on record).",
    );
    expect(rowOf(v, "Alkhalil").notes).toContain(
      "Onboarding payment $5,500 from the plan (the form did not ask before 29 Aug).",
    );
    // شركة العلا's month is C/3 then, so the $2,000 log no longer fits it.
    expect(partOf(rowOf(v, ALULA), "onboarding").usd).toBe(1833);
  });

  test("the money ledger never ran: figures read n/a", () => {
    const v = buildPending({ ...LIVE_2026_10_23, moneyAsOf: null }, NOW);
    expect(v.figures.onboarding.usd).toBeNull();
    expect(v.figures.another.usd).toBeNull();
    expect(v.moneyMissing).toBe(true);
    expect(v.staleLine).toBe(
      "The money ledger has not run yet, so no rail money is counted. The figures read n/a until it does. Check that the money refresh is running.",
    );
    // Every row's amounts are unknown too, so no screen can show $0.
    for (const r of [...v.rows, ...v.quiet.rows]) {
      expect(r.amountsKnown).toBe(false);
      expect([r.railsUsd, r.leftUsd, r.notSeenUsd, r.anotherUsd]).toEqual([
        null,
        null,
        null,
        null,
      ]);
      expect(r.confirmable.every(c => c.emptyUsd === null)).toBe(true);
      // No word leans on rails nobody read: no "no rail has ever shown",
      // no "the rails leave", no parts named as unseen, no late tone, and
      // nothing offered for the card.
      expect(r.notes.some(n => /No rail has ever|rails leave/.test(n))).toBe(
        false,
      );
      expect(r.sources.filter(x => x.startsWith("Rails:"))).toEqual(
        r.deal ? ["Rails: not read, the money ledger has not run"] : [],
      );
      // A card-only row's next payment is the card's own, never the rails'.
      expect([r.tone, r.daysLate, r.disagree, r.cardNext, r.nextPart]).toEqual([
        "neutral",
        null,
        null,
        null,
        r.cardOnly ? r.nextPart : null,
      ]);
      if (r.cardOnly) expect(r.nextPart?.key).toBe("card");
      else expect(r.when).toBeNull();
      if (r.parts.length) expect(r.headline).toBe(r.planLabel);
    }
    expect(v.figures.notSeen.count).toBe(0);
    // Card-only rows are in no figure, not even as unknown.
    expect(v.figures.notSeen.unknown).toBe(
      v.rows.filter(r => !r.cardOnly).length,
    );
    expect(v.quiet.line).toBe(
      "Gone quiet: 3 clients, left n/a until the money ledger runs (kept out of the figures)",
    );
    expect(v.backWithSales?.leftUsd).toBeNull();
    expect(
      buildPending({ ...LIVE_2026_10_23, moneyAsOf: null, ceo: false }, NOW)
        .staleLine,
    ).toBe(
      "The money ledger has not run yet, so no rail money is counted. The figures read n/a until it does. Ask the CEO to check the money refresh.",
    );
  });

  test("money older than an hour gets the banner", () => {
    expect(live().staleLine).toBeNull();
    const v = buildPending(LIVE_2026_10_23, NOW + 2 * 3600_000);
    expect(v.staleLine).toBe(
      "Money last read at 20:23. A payment made after that shows at the next refresh.",
    );
    expect(v.stale.money).toBe(true);
  });

  test("the cards, the closer forms and the calls each get a sentence when their feed falls behind its schedule", () => {
    expect(live().staleLines).toEqual([]);
    // billing-sync's 21:37 run failed (as on 23 Oct): at 21:55 the cards are
    // from the 21:07 run. Everything else is fresh.
    const at = (now: string, over: Partial<BalancesRead>, ceo = true) =>
      buildPending(
        {
          ...LIVE_2026_10_23,
          moneyAsOf: "2026-10-23T21:50:00+03:00",
          dealsAsOf: "2026-10-23T21:54:00+03:00",
          callsAsOf: "2026-10-23T21:45:00+03:00",
          ceo,
          ...over,
        },
        Date.parse(now),
      );
    const missed = at("2026-10-23T21:55:00+03:00", {
      cardsAsOf: "2026-10-23T21:07:01+03:00",
    });
    expect(missed.stale).toEqual({
      money: false,
      cards: true,
      deals: false,
      calls: false,
    });
    expect(missed.staleLines).toEqual([
      "Client cards last read at 21:07. A stage, plan or date changed in ClickUp after that shows at billing-sync's next read. Check that it is running.",
    ]);
    // Before the 21:37 run is 15 minutes old, nothing is said.
    expect(
      at("2026-10-23T21:45:00+03:00", {
        cardsAsOf: "2026-10-23T21:07:01+03:00",
      }).staleLines,
    ).toEqual([]);
    // Overnight the last run is 00:17, so at 05:00 that read is current, and
    // at 06:30 (the 06:07 run due) it is not.
    const night = {
      today: "2026-10-24",
      cardsAsOf: "2026-10-24T00:17:40+03:00",
      moneyAsOf: "2026-10-24T04:50:00+03:00",
      dealsAsOf: "2026-10-24T04:58:00+03:00",
      callsAsOf: "2026-10-24T04:45:00+03:00",
    };
    expect(at("2026-10-24T05:00:00+03:00", night).stale.cards).toBe(false);
    expect(
      at("2026-10-24T06:30:00+03:00", {
        ...night,
        moneyAsOf: "2026-10-24T06:20:00+03:00",
        dealsAsOf: "2026-10-24T06:28:00+03:00",
        callsAsOf: "2026-10-24T06:15:00+03:00",
      }).staleLines,
    ).toEqual([
      "Client cards last read at 00:17. A stage, plan or date changed in ClickUp after that shows at billing-sync's next read. Check that it is running.",
    ]);
    // The sales mirror copies every 3 minutes; the calls are read every 15.
    const behind = at(
      "2026-10-23T21:55:00+03:00",
      {
        cardsAsOf: "2026-10-23T21:38:00+03:00",
        dealsAsOf: "2026-10-23T21:30:00+03:00",
        callsAsOf: null,
      },
      false,
    );
    expect(behind.staleLines).toEqual([
      "Closer forms last copied at 21:30. A deal signed or changed after that shows once the sales mirror runs again. Tell the CEO if it stays this way.",
      "Onboarding calls have not been read yet, so no booked call moves a due day. Tell the CEO if it stays this way.",
    ]);
    // A read from another day says the day.
    expect(
      at("2026-10-23T21:55:00+03:00", {
        cardsAsOf: "2026-10-22T21:37:30+03:00",
      }).staleLines[0],
    ).toMatch(/^Client cards last read at 21:37 on 22 Oct\./);
  });

  test("billing-sync's schedule: every half hour from 06:07 to 21:37 Kuwait, then 00:17", () => {
    const k = (ts: string) =>
      new Date(lastCardsRun(Date.parse(ts)) + 3 * 3600_000)
        .toISOString()
        .slice(0, 16);
    expect(k("2026-10-23T21:40:00+03:00")).toBe("2026-10-23T21:37");
    expect(k("2026-10-23T23:59:00+03:00")).toBe("2026-10-23T21:37");
    expect(k("2026-10-24T00:20:00+03:00")).toBe("2026-10-24T00:17");
    expect(k("2026-10-24T06:06:00+03:00")).toBe("2026-10-24T00:17");
    expect(k("2026-10-24T06:07:00+03:00")).toBe("2026-10-24T06:07");
    expect(k("2026-10-24T13:36:59+03:00")).toBe("2026-10-24T13:07");
  });
});

describe("Possible money offers a payment only for a part with room", () => {
  test("a filled deposit gets no hint; the open onboarding payment does", () => {
    const read = oneClient({ rails: [{ usd: 500 }] });
    const untied = (id: string, day: string, usd: number) => ({
      id,
      day,
      rail: "whop",
      usd,
      currency: "USD",
      amount: usd,
      payerName: null,
    });
    read.untied = [
      // Deposit-sized, inside the deposit's window, but the deposit is on a rail.
      untied("whop:filled", "2026-08-21", 500),
      // The onboarding payment's full $5,500, and that part is empty.
      untied("whop:open", "2026-09-02", 5500),
    ];
    const { v, row } = edge(read);
    expect(row?.hints.map(h => [h.paymentId, h.partKey])).toEqual([
      ["whop:open", "onboarding"],
    ]);
    expect(v.possibleMoney.map(p => p.paymentId)).toEqual(["whop:open"]);
    // Once the deposit is empty, the same payment is offered for it.
    const empty = oneClient({});
    empty.untied = read.untied;
    expect(edge(empty).row?.hints.map(h => [h.paymentId, h.partKey])).toEqual([
      ["whop:filled", "deposit"],
      ["whop:open", "onboarding"],
    ]);
  });
});

describe("names", () => {
  test("nameKey is money.js nameKey, Arabic presentation forms included", () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        "../../../hermes/ceo-refresh/native/adapters/money.js",
      ),
      "utf8",
    );
    const body = src.match(
      /function nameKey\(value\) \{\n\s*(return [^\n]+)\n\}/,
    )?.[1];
    expect(body).toBeDefined();
    const moneyNameKey = new Function("value", body as string) as (
      v: unknown,
    ) => string;
    for (const s of [
      "مدانة العمرانية لﻺستشارات",
      "ﻻ",
      "لﻺ",
      "شركة أدق الحلول للمقاوﻻت",
      "Brillant Touch Company",
      "Ghazzawi.sa",
      "Café  Déjà-vu",
      null,
    ])
      expect(nameKey(s)).toBe(moneyNameKey(s));
    expect(nameKey("مدانة العمرانية لﻺستشارات")).toBe(
      nameKey("مدانة العمرانية للاستشارات"),
    );
  });

  test("similarity is pg_trgm's", () => {
    // One word against two, the first shared: half the trigrams (made-up names).
    expect(similarity("Kivepi", "Kivepi Gulama")).toBe(0.5);
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("", "abc")).toBe(0);
  });
});

describe("both cockpits run the same rule", () => {
  test("billingBalances.ts is the same file in both apps", () => {
    const a = readFileSync(
      join(import.meta.dir, "../src/lib/billingBalances.ts"),
      "utf8",
    );
    const b = readFileSync(
      join(
        import.meta.dir,
        "../../client-success-cockpit/src/lib/billingBalances.ts",
      ),
      "utf8",
    );
    expect(a === b).toBe(true);
  });
});

// --- the data calls (src/lib/billing.ts, both apps) ---------------------------

type Call = { fn: string; args: unknown };
function fakeClient(answer: {
  data?: unknown;
  error?: { message: string } | null;
}) {
  const calls: Call[] = [];
  const client = {
    rpc: async (fn: string, args?: unknown) => {
      calls.push({ fn, args });
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  };
  return { client: client as never, calls };
}

describe("the data calls", () => {
  for (const [app, lib, source] of [
    ["CEO cockpit", mbBilling, "ceo"],
    ["client success cockpit", csBilling, "csm"],
  ] as const) {
    test(`${app}: the read builds the section, a refusal keeps the server's sentence`, async () => {
      const ok = fakeClient({ data: LIVE_2026_10_23 });
      const v = await lib.fetchPendingPayments(ok.client, NOW);
      expect(ok.calls).toEqual([
        { fn: "cockpit_billing_balances_read", args: undefined },
      ]);
      expect(v.figures.onboarding.usd).toBe(23752.82);
      const refused = fakeClient({
        error: {
          message:
            "Pending payments need a client success, finance or CEO seat. Ask an admin to add the role.",
        },
      });
      await expect(lib.fetchPendingPayments(refused.client)).rejects.toThrow(
        "Pending payments need a client success, finance or CEO seat. Ask an admin to add the role.",
      );
      await expect(
        lib.fetchPendingPayments(fakeClient({ data: null }).client),
      ).rejects.toBeInstanceOf(lib.PendingReadError);
    });

    test(`${app}: confirm, withdraw, link and unlink send exactly what the write reads`, async () => {
      const ok = fakeClient({
        data: {
          ok: true,
          sentence: "Confirmed by you · waiting for Tap",
          confirmation: { id: 41 },
        },
      });
      const out = await lib.confirmPaid(ok.client, {
        taskId: "z8xmdvj7hm",
        dealResponseId: "deal-1",
        part: "onboarding",
        partNo: 0,
        amount: 5750,
        currency: "USD",
        rail: "tap",
        paidOn: "2026-10-19",
        evidenceUrl: "",
        note: "Paid on the call",
      });
      expect(out).toEqual({
        sentence: "Confirmed by you · waiting for Tap",
        confirmationId: 41,
        repeated: false,
      });
      expect(ok.calls[0]).toEqual({
        fn: "cockpit_billing_balance_write",
        args: {
          p_action: "confirm",
          p_args: {
            taskId: "z8xmdvj7hm",
            dealResponseId: "deal-1",
            part: "onboarding",
            partNo: 0,
            amount: 5750,
            currency: "USD",
            rail: "tap",
            paidOn: "2026-10-19",
            evidenceUrl: null,
            note: "Paid on the call",
            source,
          },
        },
      });
      const w = fakeClient({ data: { ok: true, sentence: "Withdrawn." } });
      expect(
        await lib.withdrawConfirmation(w.client, {
          taskId: "z8xmdvj7hm",
          confirmationId: 41,
          reason: "Wrong client",
        }),
      ).toBe("Withdrawn.");
      expect(w.calls[0].args).toEqual({
        p_action: "withdraw",
        p_args: {
          taskId: "z8xmdvj7hm",
          confirmationId: 41,
          reason: "Wrong client",
          source,
        },
      });
      const l = fakeClient({
        data: { ok: true, sentence: "Linked to Arcturus Construction." },
      });
      expect(
        await lib.linkDealToCard(l.client, {
          dealResponseId: "deal-2",
          taskId: "86eyqx2f6",
        }),
      ).toBe("Linked to Arcturus Construction.");
      expect(l.calls[0].args).toEqual({
        p_action: "link",
        p_args: {
          dealResponseId: "deal-2",
          taskId: "86eyqx2f6",
          note: null,
          source,
        },
      });
      const u = fakeClient({
        data: { ok: true, sentence: "Unlinked from Arcturus Construction." },
      });
      expect(
        await lib.unlinkDeal(u.client, {
          dealResponseId: "deal-2",
          reason: "Wrong card",
        }),
      ).toBe("Unlinked from Arcturus Construction.");
      expect(u.calls[0].args).toEqual({
        p_action: "unlink",
        p_args: { dealResponseId: "deal-2", reason: "Wrong card", source },
      });
    });

    test(`${app}: a refused write throws the server's sentence and nothing else`, async () => {
      const refused = fakeClient({
        error: {
          message:
            "A transfer, cheque or cash never arrives on its own. Log it as a payment with its receipt instead.",
        },
      });
      const err = await lib
        .confirmPaid(refused.client, {
          taskId: "t",
          dealResponseId: "d",
          part: "onboarding",
          partNo: 0,
          amount: 10,
          currency: "USD",
          rail: "tap",
          paidOn: "2026-10-19",
        })
        .catch(e => e);
      expect(err).toBeInstanceOf(lib.BillingWriteError);
      expect(err.data).toEqual({
        code: "refused",
        message:
          "A transfer, cheque or cash never arrives on its own. Log it as a payment with its receipt instead.",
      });
      const silent = fakeClient({ data: null });
      await expect(
        lib.withdrawConfirmation(silent.client, {
          taskId: "t",
          confirmationId: 1,
          reason: "abc",
        }),
      ).rejects.toThrow(
        "The server did not confirm the change. Reload the section before you try again.",
      );
    });
  }
});
