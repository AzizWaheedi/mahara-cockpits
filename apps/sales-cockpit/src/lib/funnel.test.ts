import { describe, expect, test } from "bun:test";
import {
  closePlusTen,
  funnel,
  funnelTokens,
  type Given,
  gapFor,
  payback,
  readGiven,
  readNumber,
  sayMany,
  sayMoney,
  sayPct,
  strengths,
  wholeFunnel,
} from "./funnel";

const given = (over: Partial<Given>): Given => ({
  spend: null,
  adLeads: null,
  leads: null,
  booked: null,
  showed: null,
  closed: null,
  aov: null,
  closed12: null,
  quotes12: null,
  revenue12: null,
  good: null,
  slow: null,
  slowMonths: null,
  years: null,
  hours: null,
  ...over,
});

describe("reading what the rep typed", () => {
  test("shorthand, commas, ranges and Arabic numerals", () => {
    expect(readNumber("85k")).toBe(85_000);
    expect(readNumber("1.2m")).toBe(1_200_000);
    expect(readNumber("1.2 million")).toBe(1_200_000);
    expect(readNumber("$4,500")).toBe(4_500);
    expect(readNumber("1,200,000")).toBe(1_200_000);
    expect(readNumber("50-80k")).toBe(65_000);
    expect(readNumber("3 or 4")).toBe(3.5);
    expect(readNumber("between 10 and 15")).toBe(12.5);
    expect(readNumber("about 20 a month")).toBe(20);
    expect(readNumber("٨٥ ألف")).toBe(85_000);
    expect(readNumber("١٫٥ مليون")).toBe(1_500_000);
    expect(readNumber("٣ الى ٥")).toBe(4);
    expect(readNumber("١٢٠٠ دينار")).toBe(1_200);
  });

  test("a blank is missing, never zero; a spoken zero is zero", () => {
    expect(readNumber("")).toBeNull();
    expect(readNumber("   ")).toBeNull();
    expect(readNumber(undefined)).toBeNull();
    expect(readNumber("not sure")).toBeNull();
    expect(readNumber("none")).toBe(0);
    expect(readNumber("ماكو")).toBe(0);
    expect(readNumber("0")).toBe(0);
  });

  test("reads the captures by their script keys", () => {
    const g = readGiven({
      ad_spend_month: "1.2k",
      leads_month: "50",
      project_value: "٨٥ ألف",
      slow_months: "",
    });
    expect(g.spend).toBe(1_200);
    expect(g.leads).toBe(50);
    expect(g.aov).toBe(85_000);
    expect(g.slowMonths).toBeNull();
    expect(g.booked).toBeNull();
  });
});

describe("the one thing", () => {
  // A Kuwaiti fit-out company: 1,200 KWD of ads for 40 inquiries, 50 in all,
  // 9 meetings booked, 7 held, 2 signed, 85,000 KWD a project.
  const f = funnel(
    given({
      spend: 1_200,
      adLeads: 40,
      leads: 50,
      booked: 9,
      showed: 7,
      closed: 2,
      aov: 85_000,
    }),
    "KWD",
  );

  test("their rates and costs beside ours, in their currency", () => {
    expect(f.rates.booking).toBeCloseTo(0.18, 5);
    expect(f.rates.show).toBeCloseTo(7 / 9, 5);
    expect(f.rates.close).toBeCloseTo(2 / 7, 5);
    expect(f.costs.perLead).toBe(30);
    expect(f.costs.perLeadAllSources).toBe(false);
    expect(f.ours.perLead).toBeCloseTo(15 * 0.3085, 5);
    expect(f.ours.program).toBeCloseTo(6_000 * 0.3085, 5);
    expect(f.problems).toEqual([]);
  });

  test("a step inside the funnel leads, even when the ads cost more", () => {
    const ads = f.steps.find(s => s.key === "ads");
    expect(ads?.standing).toBe("behind");
    expect(f.leak).toBe("booking");
    const gap = gapFor(f);
    // 12.5 meetings at a quarter of 50, 3.5 more, signing 2 of every 9.
    expect(gap?.unitsMonth).toBeCloseTo(3.5, 5);
    expect(gap?.projectsYear).toBeCloseTo(3.5 * (2 / 9) * 12, 5);
    // 9.33 projects is said as 9, and the money is 9 of them.
    expect(gap?.moneyYear).toBe(9 * 85_000);
    expect(gap?.usesOurs).toBe(false);
    expect(gap?.big).toBe(false);
  });

  test("the lines fill in, in English", () => {
    const t = funnelTokens(f, "en");
    expect(t["BOOKING RATE"]).toBe("18%");
    expect(t["OUR BOOKING RATE"]).toBe("25%");
    expect(t["EXTRA MEETINGS"]).toBe("4 more meetings");
    expect(t["EXTRA PROJECTS A YEAR"]).toBe("9 more projects");
    expect(t["LOST PROJECTS A YEAR"]).toBe("9 projects");
    expect(t["GAP YEAR"]).toBe("765,000 KWD");
    expect(t["GAP MONTH"]).toBe("64,000 KWD");
    expect(t["PROJECT VALUE"]).toBe("85,000 KWD");
    expect(t.CPL).toBe("30 KWD");
    expect(t["OUR CPL"]).toBe("4.6 KWD");
    expect(t["WEAK STEP"]).toBe("the step from inquiry to meeting");
    expect(t["STRONG STEPS"]).toBe(
      "78% of your meetings actually happen and you sign 29% of the people you meet",
    );
    expect(t.PAYBACK).toBe(
      "a single extra project at your average of 85,000 KWD more than covers the investment",
    );
  });

  test("and in Arabic", () => {
    const t = funnelTokens(f, "ar");
    expect(t["BOOKING RATE"]).toBe("١٨٪");
    expect(t["EXTRA PROJECTS A YEAR"]).toBe("٩ مشاريع زيادة");
    expect(t["GAP YEAR"]).toBe("٧٦٥ ألف دينار");
    expect(t["OUR CPL"]).toBe("٤٫٦ دينار");
    expect(t["WEAK STEP"]).toBe("الخطوة من الاستفسار للموعد");
  });

  test("a branch the rep opens speaks for its own step", () => {
    const t = funnelTokens(f, "en", "ads");
    // 1,200 at 4.63 is 259 inquiries, 219 more, at 2 signed of 50.
    expect(t["WEAK STEP"]).toBe("the cost of each inquiry");
    expect(t["LEADS AT OUR CPL"]).toBe("259 inquiries");
    const gap = gapFor(f, "ads");
    expect(gap?.projectsYear).toBeCloseTo(
      (1_200 / (15 * 0.3085) - 40) * (2 / 50) * 12,
      5,
    );
    expect(gap?.big).toBe(true);
    // A step at or better than ours has no gap to tell.
    expect(gapFor(f, "show")).toBeNull();
  });

  test("closing ten points better, for the pitch", () => {
    const plus = closePlusTen(f);
    expect(plus?.rate).toBeCloseTo(2 / 7 + 0.1, 5);
    expect(plus?.moneyYear).toBeCloseTo(7 * 0.1 * 12 * 85_000, 3);
  });

  test("every step inside the funnel at ours at once, never the ad budget", () => {
    const all = wholeFunnel(f);
    // Booking to a quarter; show-up and closing already beat ours.
    const signed = 50 * 0.25 * (7 / 9) * (2 / 7);
    expect(all?.projectsYear).toBeCloseTo((signed - 2) * 12, 5);
    expect(all?.projectsYear).toBeCloseTo(gapFor(f)?.projectsYear ?? 0, 5);
    // Two steps behind: more than either alone.
    const two = funnel(
      given({ leads: 100, booked: 10, showed: 6, closed: 1, aov: 1_000 }),
      "USD",
    );
    const both = wholeFunnel(two)?.projectsYear ?? 0;
    expect(both).toBeCloseTo((100 * 0.25 * 0.6 * 0.2 - 1) * 12, 5);
    expect(both).toBeGreaterThan(gapFor(two)?.projectsYear ?? 0);
  });
});

describe("other shapes of funnel", () => {
  test("closing leaks, in dollars, with no ads", () => {
    const f = funnel(
      given({ leads: 100, booked: 30, showed: 20, closed: 2, aov: 20_000 }),
      "USD",
    );
    expect(f.leak).toBe("close");
    const t = funnelTokens(f, "en");
    expect(t["CLOSE RATE"]).toBe("10%");
    expect(t["EXTRA PROJECTS A YEAR"]).toBe("24 more projects");
    expect(t["GAP YEAR"]).toBe("$480,000");
    expect(t["AD SPEND"]).toBeUndefined();
    expect(t.CPL).toBeUndefined();
  });

  test("numbers that cannot all be true are flagged and never the leak", () => {
    const f = funnel(
      given({ leads: 50, booked: 60, showed: 30, closed: 3 }),
      "USD",
    );
    expect(f.problems).toContain("booked_over_leads");
    expect(f.steps.find(s => s.key === "booking")?.standing).toBe("impossible");
    expect(f.leak).not.toBe("booking");
    expect(funnelTokens(f, "en")["BOOKING RATE"]).toBeUndefined();
  });

  test("a funnel at our numbers everywhere is told as volume", () => {
    const f = funnel(
      given({ leads: 40, booked: 12, showed: 9, closed: 3, aov: 30_000 }),
      "SAR",
    );
    expect(f.steps.every(s => s.standing !== "behind")).toBe(true);
    expect(f.leak).toBe("volume");
    expect(gapFor(f)?.projectsYear).toBe(36);
    expect(funnelTokens(f, "ar")["GAP YEAR"]).toBe("١٫١ مليون ريال");
  });

  test("referrals only: the slow months", () => {
    const f = funnel(
      given({ good: 4, slow: 1, slowMonths: 5, aov: 10_000, years: 12 }),
      "KWD",
    );
    expect(f.leak).toBe("referrals");
    const t = funnelTokens(f, "en");
    expect(t["SLOW MONTHS"]).toBe("5 slow months");
    expect(t["PROJECTS LOST A SLOW MONTH"]).toBe("3 projects");
    expect(t["LOST PROJECTS A YEAR"]).toBe("15 projects");
    expect(t["GAP YEAR"]).toBe("150,000 KWD");
    expect(t["YEARS IN BUSINESS"]).toBe("12 years");
    expect(funnelTokens(f, "ar")["SLOW MONTHS"]).toBe("٥ شهور بطيئة");
  });

  test("signed a month from the last 12 months: their close rate is not guessed", () => {
    const f = funnel(
      given({ leads: 50, booked: 9, showed: 7, closed12: 24 }),
      "USD",
    );
    expect(f.closed).toBe(2);
    expect(f.closedFromYear).toBe(true);
    expect(f.rates.close).toBeNull();
    const booking = f.steps.find(s => s.key === "booking");
    // Held at their 7 of 9, signed at our fifth, and it says so.
    expect(booking?.usesOurs).toBe(true);
    expect(booking?.extraMonth).toBeCloseTo(3.5 * (7 / 9) * 0.2, 5);
  });

  test("nothing given, nothing claimed", () => {
    const f = funnel(given({}), "KWD");
    expect(f.leak).toBeNull();
    expect(gapFor(f)).toBeNull();
    const t = funnelTokens(f, "en");
    expect(t["GAP YEAR"]).toBeUndefined();
    expect(t["OUR BOOKING RATE"]).toBe("25%");
    expect(strengths(f, "en")).toBeNull();
    expect(payback(f, "en")).toBeNull();
  });

  test("the ads step is never worked out from our rates alone", () => {
    // The intro: ad spend and the inquiries it brings, and 12 months of
    // projects, but not how many inquiries sign.
    const f = funnel(
      given({
        spend: 9_000,
        adLeads: 40,
        closed12: 18,
        quotes12: 60,
        aov: 300_000,
      }),
      "SAR",
    );
    const ads = f.steps.find(s => s.key === "ads");
    expect(ads?.standing).toBe("behind");
    expect(ads?.extraUnits).toBeCloseTo(9_000 / 56.25 - 40, 5);
    expect(ads?.extraMonth).toBeNull();
    expect(f.leak).toBeNull();
    expect(funnelTokens(f, "en").CPL).toBe("225 SAR");
  });

  test("the quote win rate the setter asks for", () => {
    const f = funnel(given({ closed12: 18, quotes12: 60 }), "USD");
    expect(funnelTokens(f, "en")["QUOTE WIN RATE"]).toBe("30%");
  });
});

describe("saying numbers", () => {
  test("money", () => {
    expect(sayMoney(15, "USD", "en")).toBe("$15");
    expect(sayMoney(4.6275, "KWD", "en")).toBe("4.6 KWD");
    expect(sayMoney(1_851, "KWD", "en")).toBe("1,851 KWD");
    expect(sayMoney(85_432, "KWD", "en")).toBe("85,000 KWD");
    expect(sayMoney(1_190_000, "AED", "en")).toBe("1.2 million AED");
    expect(sayMoney(85_000, "KWD", "ar")).toBe("٨٥ ألف دينار");
    expect(sayMoney(2_500, "SAR", "ar")).toBe("٢٫٥ ألف ريال");
    expect(sayMoney(1_000, "USD", "ar")).toBe("ألف دولار");
    expect(sayMoney(450, "BHD", "ar")).toBe("٤٥٠ دينار");
    expect(sayMoney(6_000, "USD", "ar")).toBe("٦ آلاف دولار");
    expect(sayMoney(3_000_000, "SAR", "ar")).toBe("٣ ملايين ريال");
    expect(sayMoney(999_700, "KWD", "ar")).toBe("مليون دينار");
    expect(sayMoney(1_190_000, "KWD", "ar")).toBe("١٫٢ مليون دينار");
  });

  test("rates", () => {
    expect(sayPct(0.25, "en")).toBe("25%");
    expect(sayPct(0.045, "en")).toBe("4.5%");
    expect(sayPct(0.6, "ar")).toBe("٦٠٪");
  });

  test("things, counted properly", () => {
    expect(sayMany(1, "project", "en", true)).toBe("1 more project");
    expect(sayMany(1, "project", "ar", true)).toBe("مشروع واحد زيادة");
    expect(sayMany(2, "project", "ar", true)).toBe("مشروعين زيادة");
    expect(sayMany(3, "meeting", "ar", true)).toBe("٣ مواعيد زيادة");
    expect(sayMany(11, "project", "ar")).toBe("١١ مشروع");
    expect(sayMany(2, "slowMonth", "ar")).toBe("شهرين بطيئين");
    expect(sayMany(12, "year", "ar")).toBe("١٢ سنة");
  });
});
