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

// The client's own 7 days from the media sync (`ads7d` on the profile, the
// cost per booking build of 22 Oct 2026, R8): Mahara's campaigns on its ad
// accounts, stopped ones included, against the confirmed bookings made on
// the same days. Atlantis 14 to 20 Oct: the listed campaigns 19\10 ($51.71,
// none) and 7\10 ($122.82, 3) read $58.18 a booking; its fourth booking came
// from 13\9, a stopped campaign, so the client's figure is $43.63.
describe("the client's own 7 days", () => {
  const atlantisAds = [
    { spend7d: 51.71, leads7d: 3, bookings7d: 0 },
    { spend7d: 122.82, leads7d: 2, bookings7d: 3 },
  ];
  const week = {
    from: "2026-10-14",
    through: "2026-10-20",
    accounts: ["290802986"],
    spend: 174.53,
    leads: 5,
    offBoardSpend: 0,
    bookings: 4,
    costPerBooking: 43.63,
    showed: null,
    noShows: null,
    due: null,
    campaigns: [],
    source: "media sync",
  };

  test("Atlantis: bookings at $43.63 make its $34.91 a lead a watch", () => {
    const d = diagnose({ ...profile(atlantisAds), ads7d: week });
    expect(d.healthy).toBe(true);
    expect(d.watch.map(w => w.title)).toEqual([
      "Cost per lead is $34.91, over the $15 gate, but bookings still cost $43.63, under the $60 gate",
    ]);
    expect(d.watch[0].evidence).toBe(
      "$175 spent from 14 Oct to 20 Oct on Mahara's campaigns (stopped ones included) for 5 leads and 4 bookings.",
    );
    // Without the client's figure, the listed campaigns read $58.18: still
    // under $60, but not the client's number.
    const listed = diagnose(profile(atlantisAds));
    expect(listed.watch[0]?.title).toContain("bookings still cost $58.18");
  });

  test("the client's figure over the gate names its window", () => {
    // Castello 14 to 20 Oct: $268.48 for 1 booking, 20 leads.
    const c = all({
      ...profile([{ spend7d: 225.36, leads7d: 14, bookings7d: 1 }]),
      ads7d: { ...week, spend: 268.48, leads: 20, bookings: 1 },
    }).find(x => x.id === "cpb_high");
    expect(c?.title).toBe("Cost per booking is $268.48 against a $60 gate");
    expect(c?.evidence).toBe(
      "$268 spent from 14 Oct to 20 Oct on Mahara's campaigns (stopped ones included) for 1 booking from 20 leads.",
    );
  });

  test("no booking on the client's figure is over the gate; unknown is not zero", () => {
    // Alkhalil 14 to 20 Oct: $233.36, 17 leads, no booking.
    const none = all({
      ...profile([{ spend7d: 233.36, leads7d: 17, bookings7d: 0 }]),
      ads7d: { ...week, spend: 233.36, leads: 17, bookings: 0 },
    }).find(x => x.id === "cpb_high");
    expect(none?.title).toBe(
      "No bookings from $233 spent from 14 Oct to 20 Oct on Mahara's campaigns (stopped ones included), against a $60 gate",
    );
    // Bookings not read: the campaigns' counts are not used instead, and
    // the cost per lead decides.
    const unread = all({
      ...profile([{ spend7d: 210, leads7d: 9, bookings7d: 4 }]),
      ads7d: { ...week, spend: 210, leads: 9, bookings: null },
    });
    expect(unread.map(x => x.id)).toEqual(["cpl_high"]);
    expect(unread[0].evidence).toBe(
      "$210 spent from 14 Oct to 20 Oct on Mahara's campaigns (stopped ones included) for 9 leads. No cost per booking to weigh it against, so the cost per lead decides.",
    );
  });

  test("done with you: the basis names the client's own window", () => {
    // نهوض نجد books its own meetings: lead volume and cost per lead only.
    const dwy = {
      ...profile([{ spend7d: 150.2, leads7d: 9 }]),
      service: "Done With You",
    };
    expect(diagnose(dwy).basis).toStartWith("9 leads in the last 7 days");
    expect(
      diagnose({
        ...dwy,
        ads7d: { ...week, spend: 192.33, leads: 12, bookings: null },
      }).basis,
    ).toStartWith(
      "12 leads from 14 Oct to 20 Oct on Mahara's campaigns (stopped ones included) · cost per lead $16.03",
    );
  });

  test("an ads7d not in the published shape is not used", () => {
    for (const bad of [
      { ...week, through: "20 Oct" },
      { ...week, spend: "174.53" },
      { ...week, bookings: "4" },
      null,
    ]) {
      const d = diagnose({ ...profile(atlantisAds), ads7d: bad });
      expect(d.watch[0]?.title).toContain("bookings still cost $58.18");
    }
  });
});

// Decision 4 (Aziz, 23 Oct 2026): "Depends on how much spend if 2x target cpl
// then yes bad if below that then not enough data". No lead on 2 x the $15
// gate or more is the ads' constraint, done for you and done with you alike;
// under it nothing is raised.
describe("spend with no leads", () => {
  const noLeads = (p: unknown) => all(p).find(c => c.id === "no_leads");

  test("Madana, 14 to 20 Oct: $11.09 and no lead is too few, healthy", () => {
    const d = diagnose(
      profile([{ spend7d: 11.09, leads7d: 0, bookings7d: 0 }]),
    );
    expect(d.healthy).toBe(true);
    expect(
      noLeads(profile([{ spend7d: 29.99, leads7d: 0, bookings7d: 0 }])),
    ).toBeUndefined();
    // $29.994 reads $29.99.
    expect(
      noLeads(profile([{ spend7d: 29.994, leads7d: 0, bookings7d: 0 }])),
    ).toBeUndefined();
  });

  test("$30.00 with no lead is raised for the media buyer", () => {
    const c = noLeads(profile([{ spend7d: 30, leads7d: 0, bookings7d: 0 }]));
    expect(c?.title).toBe("No leads from $30.00 spent in the last 7 days");
    expect(c?.evidence).toBe(
      "$30.00 spent in the last 7 days and no lead came in: $30.00 or more with no lead is out of KPI (2 x the $15 cost per lead gate).",
    );
    expect(c?.diagnosis).toContain("it is the ads, not the calls");
    expect(c?.fixes).toEqual([
      "Submit a test lead through the form and check it arrives in the CRM.",
      "Check the lead form and the pixel on the ad account are still connected.",
      "Raise a ticket to the media buyer with the spend and the dates.",
    ]);
    expect(c?.owner).toBe("Media buyer");
    expect(c?.layer).toBe("micro");
    const d = diagnose(profile([{ spend7d: 30, leads7d: 0, bookings7d: 0 }]));
    expect(d.healthy).toBe(false);
    expect(d.top?.id).toBe("no_leads");
  });

  test("$45 with no lead is raised, done for you and done with you", () => {
    for (const service of ["DFY", "Done With You", "DWY"]) {
      const c = noLeads({
        ...profile([{ spend7d: 45, leads7d: 0, bookings7d: 0 }]),
        service,
      });
      expect([service, c?.title]).toEqual([
        service,
        "No leads from $45.00 spent in the last 7 days",
      ]);
    }
    // The done-with-you client is judged on it, not left healthy.
    const dwy = diagnose({
      ...profile([{ spend7d: 45, leads7d: 0 }]),
      service: "DWY",
    });
    expect(dwy.healthy).toBe(false);
    expect(dwy.top?.id).toBe("no_leads");
  });

  test("the client's own 7 days name their window", () => {
    const c = noLeads({
      ...profile([{ spend7d: 10, leads7d: 0, bookings7d: 0 }]),
      ads7d: {
        from: "2026-10-16",
        through: "2026-10-22",
        spend: 74.31,
        leads: 0,
        bookings: null,
      },
    });
    expect(c?.title).toBe(
      "No leads from $74.31 spent from 16 Oct to 22 Oct on Mahara's campaigns (stopped ones included)",
    );
  });

  test("a cost per booking finding on the same spend says it once", () => {
    // $100, no lead and no booking: cost per booking over $60 already names
    // the ads, so no second finding.
    const ids = all(profile([{ spend7d: 100, leads7d: 0, bookings7d: 0 }])).map(
      c => c.id,
    );
    expect(ids).toEqual(["cpb_high"]);
  });

  test("no lead, but earlier leads book within $60: a watch, never the constraint", () => {
    // The golden rule (contract 1.4.7): $45 and no lead, 2 bookings at
    // $22.50 each. kpi.ts belowKpi holds it in, and so does this.
    const held = profile([{ spend7d: 45, leads7d: 0, bookings7d: 2 }]);
    const d = diagnose(held);
    expect(noLeads(held)).toBeUndefined();
    expect(all(held)).toEqual([]);
    expect(d.healthy).toBe(true);
    expect(d.watch.map(c => c.id)).toEqual(["no_leads_watch"]);
    expect(d.watch[0].title).toBe(
      "No leads from $45.00 spent in the last 7 days, but bookings still cost $22.50, under the $60 gate",
    );
    expect(d.watch[0].owner).toBe("Media buyer");
    expect(d.headline).toContain("Nothing needs fixing first");
    // Exactly $60 a booking still holds.
    expect(
      diagnose(profile([{ spend7d: 60, leads7d: 0, bookings7d: 1 }])).healthy,
    ).toBe(true);
  });

  test("no lead and $70 a booking: the cost per booking is raised, once", () => {
    const dear = profile([{ spend7d: 70, leads7d: 0, bookings7d: 1 }]);
    expect(ids(dear)).toEqual(["cpb_high"]);
    expect(diagnose(dear).watch).toEqual([]);
    expect(diagnose(dear).healthy).toBe(false);
  });

  test("done with you has no booking cost to hold it: still raised", () => {
    const own = {
      ...profile([{ spend7d: 45, leads7d: 0, bookings7d: 2 }]),
      service: "DWY",
    };
    expect(noLeads(own)?.title).toBe(
      "No leads from $45.00 spent in the last 7 days",
    );
    expect(diagnose(own).watch).toEqual([]);
  });

  test("leads not counted are not zero: nothing is raised", () => {
    expect(noLeads(profile([{ spend7d: 45 }]))).toBeUndefined();
    expect(
      noLeads(
        profile([{ spend7d: 40, leads7d: 0, bookings7d: 0 }, { spend7d: 5 }]),
      ),
    ).toBeUndefined();
  });
});
