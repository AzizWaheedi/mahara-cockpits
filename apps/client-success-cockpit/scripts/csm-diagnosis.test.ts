import { describe, expect, test } from "bun:test";
import { diagnose } from "../src/lib/csmDiagnosis";

// Muhammed, 2026-10-13: cost per lead and cost per booking are read together.
// A client whose leads cost more than the gate but book within the line is
// not raised to the media buyer for cost per lead alone. Aziz, 2026-10-13: the
// CSM's line is $60 a booking.

const profile = (ads: Record<string, unknown>[]) => ({
  clientName: "Ocean Home",
  stage: "Live",
  links: { sheet: "https://docs.google.com/spreadsheets/d/x" },
  performance: { month: {}, lastMonth: {} },
  ads: ads.map(a => ({
    adsets: [{ ads: [{ status: "ACTIVE" }] }],
    ...a,
  })),
});

const all = (p: unknown) => {
  const d = diagnose(p);
  return [...(d.top ? [d.top] : []), ...d.rest];
};
const ids = (p: unknown) => all(p).map(c => c.id);
const cplHigh = (ads: Record<string, unknown>[]) =>
  all(profile(ads)).find(c => c.id === "cpl_high");

describe("cost per lead finding", () => {
  test("dear leads that book within the line are not raised", () => {
    expect(
      ids(profile([{ spend7d: 210, leads7d: 9, bookings7d: 4 }])),
    ).not.toContain("cpl_high");
  });

  test("dear leads that book over the line are raised, with the bookings", () => {
    const ads = [{ spend7d: 210, leads7d: 9, bookings7d: 1 }];
    expect(cplHigh(ads)?.evidence).toContain("each booking costs $210.00");
    expect(ids(profile(ads))).toContain("cpb_high");
  });

  test("dear leads with no booking are raised and say so", () => {
    expect(
      cplHigh([{ spend7d: 210, leads7d: 9, bookings7d: 0 }])?.evidence,
    ).toContain("and no booking");
  });

  test("unknown bookings are not zero: the cost per lead rule stands", () => {
    expect(cplHigh([{ spend7d: 210, leads7d: 9 }])?.evidence).toBe(
      "$210 spent in the last 7 days for 9 leads. No cost per booking to weigh it against, so the cost per lead decides.",
    );
  });
});
