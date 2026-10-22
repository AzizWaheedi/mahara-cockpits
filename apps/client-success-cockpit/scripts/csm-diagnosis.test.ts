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

// The call centre review, 2026-10-13: for a done-for-you client our call
// centre calls the leads, so cheap leads that do not book are never put on
// "speed to lead on the client's side"; the first fix is the client's calls.
describe("cheap leads that do not book", () => {
  const CALLS =
    "Check the client's Calls section: first call time, dials per lead and why leads were lost.";
  const cpbHigh = (
    service: string | undefined,
    ads: Record<string, unknown>[],
  ) => all({ ...profile(ads), service }).find(c => c.id === "cpb_high");

  test("done for you: the call centre owns it and its calls come first", () => {
    for (const service of ["DFY", undefined]) {
      const c = cpbHigh(service, [
        { spend7d: 130, leads7d: 10, bookings7d: 2 },
      ]);
      expect(c?.owner).toBe("Call centre");
      expect(c?.diagnosis).toContain(
        "That is usually how fast and how often our call centre calls the leads, not the ads.",
      );
      expect(c?.diagnosis).not.toContain("client's side");
      expect(c?.fixes[0]).toBe(CALLS);
      expect(c?.fixes[1]).toContain("Raise a ticket to the media buyer");
    }
  });

  test("dear leads stay the media buyer's, with the calls check second", () => {
    const c = cpbHigh("DFY", [{ spend7d: 210, leads7d: 9, bookings7d: 1 }]);
    expect(c?.owner).toBe("Media buyer");
    expect(c?.fixes[0]).toContain("Raise a ticket to the media buyer");
    expect(c?.fixes[1]).toBe(CALLS);
  });

  test("done with you: they book their own, so bookings are not judged", () => {
    expect(
      cpbHigh("DWY", [{ spend7d: 130, leads7d: 10, bookings7d: 2 }]),
    ).toBeUndefined();
  });
});

// R18 (2026-10-21): cost per booking was only judged on 5 leads or more,
// against the file's own rule. It already holds more than a booking's worth
// of spend, so it is judged on any volume; the cost per lead keeps its floor.
describe("cost per booking under 5 leads", () => {
  const find = (ads: Record<string, unknown>[], id: string) =>
    all(profile(ads)).find(c => c.id === id);

  test("Castello, 7 days to 3 Oct: $188.98 for 3 leads and 1 booking", () => {
    const ads = [{ spend7d: 188.98, leads7d: 3, bookings7d: 1 }];
    const c = find(ads, "cpb_high");
    expect(c?.title).toBe("Cost per booking is $188.98 against a $60 gate");
    expect(c?.evidence).toBe(
      "$189 spent in the last 7 days for 1 booking from 3 leads.",
    );
    // $62.99 a lead, but on 3 leads the cost per lead is not raised.
    expect(ids(profile(ads))).toEqual(["cpb_high"]);
    expect(c?.owner).toBe("Media buyer");
  });

  test("Khalida, 7 days to 1 Oct: $192.52 for 4 leads and none booked", () => {
    const c = find(
      [{ spend7d: 192.52, leads7d: 4, bookings7d: 0 }],
      "cpb_high",
    );
    expect(c?.title).toBe(
      "No bookings from $193 spent in the last 7 days, against a $60 gate",
    );
    expect(c?.diagnosis).toContain("none of them booked");
  });

  test("spend with no leads at all is the ads, and there are no calls to check", () => {
    const c = find([{ spend7d: 100, leads7d: 0, bookings7d: 0 }], "cpb_high");
    expect(c?.diagnosis).toBe(
      "The week's spend brought no leads at all, so it is the ads, not the calls.",
    );
    expect(c?.owner).toBe("Media buyer");
    expect(c?.fixes[0]).toContain("Raise a ticket to the media buyer");
    expect(c?.fixes.join(" ")).not.toContain("Calls section");
  });

  test("within the line, or under a booking's worth spent, nothing is raised", () => {
    // SAFAD on 21 Oct: $15.71 for 3 leads and 2 bookings.
    expect(
      diagnose(profile([{ spend7d: 15.71, leads7d: 3, bookings7d: 2 }]))
        .healthy,
    ).toBe(true);
    // Madana on 21 Oct: $11.09, no leads, nothing booked.
    expect(
      diagnose(profile([{ spend7d: 11.09, leads7d: 0, bookings7d: 0 }]))
        .healthy,
    ).toBe(true);
    // $25 a lead on 4 leads with bookings at $50: no cost per lead watch or
    // finding under 5 leads.
    const d = diagnose(profile([{ spend7d: 100, leads7d: 4, bookings7d: 2 }]));
    expect(d.healthy).toBe(true);
    expect(d.watch).toEqual([]);
    // Bookings unknown under 5 leads: nothing judged, as before.
    expect(diagnose(profile([{ spend7d: 190, leads7d: 3 }])).healthy).toBe(
      true,
    );
  });
});
