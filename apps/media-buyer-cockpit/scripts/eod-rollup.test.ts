/**
 * The end of day report counts each client once, on the client's own 7 days
 * (R16, the cost per booking build of 22 Oct 2026). The figures are 14 to 20
 * Oct, read from the live media data and the Client Performance board on
 * 22 Oct (read only): Mahara's campaigns on each client's ad accounts,
 * stopped ones included, against the board's confirmed bookings. The audit
 * (docs/client-performance/CPB-AUDIT-20261021.md) has the same figures.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bookingsLine,
  type ClientWeekCampaign,
  cleanName,
  clientFigures,
  decisionEvidence,
  EVIDENCE_FIT,
  eodTotals,
  figureFor,
  outOfKpiLines,
  overCplGate,
  readClientWeek,
  sourceLine,
  weekIsDwy,
  worstCampaign,
} from "../src/lib/eodRollup";

const KHALIDA = "شركة منشآت خالدة للاستشارات الهندسية";
const KHALIDA_14 = "‎‎منشاءت الخالده-mahara‎ – 14\\10‎";
const NAHOUD = "نهوض نجد";

type C = [string, number, number, number | null, boolean?];

/** One client: its card name, account, and its campaigns in the window. */
const CLIENTS: {
  name: string;
  account: string;
  dwy?: boolean;
  bookings: number | null;
  offBoardSpend?: number;
  campaigns: C[];
  fix?: string;
}[] = [
  {
    name: "Alkhalil",
    account: "1649852845764859",
    bookings: 0,
    campaigns: [["ALKHALIL- MAHRA-15\\9", 233.36, 17, 0]],
    fix: "Cut the ad with the worst cost per booking",
  },
  {
    name: "Arcturus Construction",
    account: "3658852461068269",
    bookings: 4,
    campaigns: [["Arcturus-Mahara-3\\9", 242.48, 39, 4]],
  },
  {
    name: "Ardon",
    account: "718146936708597",
    bookings: 5,
    campaigns: [["Ardon_mahar-22\\9", 201.9, 11, 5]],
  },
  {
    name: "Atlantis Contracting",
    account: "290802986",
    bookings: 4,
    campaigns: [
      ["Atlantis-mahara-19\\10", 51.71, 3, 0],
      ["Atlantis-mahara-7\\10", 122.82, 2, 3],
      // Stopped: no spend in the window, and the booking 09f9iAy7 of 20 Oct.
      ["Atlantis-mahara-13\\9", 0, 0, 1, false],
    ],
  },
  {
    name: "Castello Industries",
    account: "2140901837311419",
    bookings: 1,
    campaigns: [
      ["CASTELLO-MAHARA-6\\10", 225.36, 14, 1],
      ["CASTELLO-MAHARA-19\\10", 43.12, 6, 0],
    ],
    fix: "Check the client's Calls section",
  },
  {
    name: "City Wood",
    account: "927741509922733",
    bookings: 3,
    campaigns: [["city wood-mahara-12\\9", 354.0, 32, 3]],
  },
  {
    name: "Marble and more",
    account: "2631767157271939",
    bookings: 4,
    campaigns: [["Marble|MAHARA|13\\10", 204.23, 20, 4]],
  },
  {
    name: "mergestudio.kw",
    account: "1200680597801129",
    bookings: 8,
    campaigns: [
      ["Merge Studio | Instant Form | Leads | Oct2026 | MHM™", 134.69, 14, 8],
    ],
  },
  {
    name: "Ocean Home",
    account: "568262692064148",
    bookings: 9,
    campaigns: [["ocean home-mahara-9\\9", 235.87, 27, 9]],
  },
  {
    name: "SAFAD Consultant Engineering",
    account: "774492648699300",
    bookings: 2,
    offBoardSpend: 375.09,
    campaigns: [["Safad | MAHARA | 16-8", 15.71, 3, 2]],
  },
  {
    name: "Shades Interior Design & General Contracting",
    account: "762687672022667",
    bookings: 4,
    campaigns: [["Shades|mahara|17\\10", 203.63, 24, 4]],
  },
  {
    name: "شركة العلا",
    account: "1066476902802166",
    bookings: 4,
    campaigns: [["Ola|mahara|13\\9", 153.13, 14, 4]],
  },
  {
    name: KHALIDA,
    account: "1275190574533155",
    bookings: 1,
    campaigns: [
      [KHALIDA_14, 80.27, 6, 1],
      ["monshaat-mahara-20\\10", 11.35, 0, 0],
    ],
  },
  {
    name: "مدانة العمرانية لﻺستشارات",
    account: "2513187079184888",
    bookings: 0,
    campaigns: [["madana-mahara-20\\10", 11.09, 0, 0]],
  },
  {
    name: NAHOUD,
    account: "1326793265986543",
    dwy: true,
    bookings: null,
    campaigns: [
      [`${NAHOUD} للمقاولات | Leads | Sep2026 | MHM™`, 192.33, 16, null],
    ],
  },
];

const round = (n: number) => Math.round(n * 100) / 100;

/** The snapshot's campaign rows: the ones still listed, with per-campaign counts. */
function listed(): Record<string, unknown>[] {
  return CLIENTS.flatMap(c =>
    c.campaigns
      .filter(([, , , , live]) => live !== false)
      .map(([campaignName, spend, leads, bookings]) => ({
        campaignName,
        clientName: c.name,
        metaAccountId: c.account,
        serviceMode: c.dwy ? "DWY" : "DFY",
        spend7d: spend,
        leads7d: leads,
        bookings7d: bookings === null ? undefined : bookings,
        cpl: leads > 0 ? spend / leads : undefined,
        findings: c.fix ? [{ fixes: [c.fix] }] : [],
      })),
  );
}

/** The client cards, each with the media sync's `ads7d` (contract 2.1). */
function links(withWeek = true): Record<string, unknown>[] {
  return CLIENTS.map(c => {
    const campaigns: ClientWeekCampaign[] = c.campaigns.map(
      ([campaignName, spend, leads, bookings, live]) => ({
        campaignName,
        spend,
        leads,
        bookings,
        live: live !== false,
      }),
    );
    const spend = round(campaigns.reduce((t, x) => t + x.spend, 0));
    const leads = campaigns.reduce((t, x) => t + x.leads, 0);
    return {
      name: c.name === "Ocean Home" ? "ocean home" : c.name,
      aliases: [c.name.toLowerCase()],
      ...(withWeek
        ? {
            ads7d: {
              from: "2026-10-14",
              through: "2026-10-20",
              accounts: [c.account],
              spend,
              leads,
              offBoardSpend: c.offBoardSpend ?? 0,
              bookings: c.bookings,
              ...(c.bookings === null
                ? {
                    bookingsWhy:
                      "Done with you: the client books its own meetings.",
                  }
                : {}),
              costPerBooking:
                c.bookings && c.bookings > 0 ? round(spend / c.bookings) : null,
              showed: null,
              noShows: null,
              due: null,
              campaigns,
              source: "media sync",
            },
          }
        : {}),
    };
  });
}

describe("the 7-day totals, 14 to 20 Oct", () => {
  const figures = clientFigures(listed(), links());

  test("49 bookings at $55.45: $2,717.05 of Mahara's spend over them", () => {
    const t = eodTotals(figures);
    expect(round(t.spend)).toBe(2717.05);
    expect(t.bookings).toBe(49);
    expect(round(t.costPerBooking ?? 0)).toBe(55.45);
    expect(bookingsLine(t)).toBe("Bookings (7d): 49 · cost per booking $55.45");
    expect(t.notRead).toEqual({ clients: 0, spend: 0 });
    expect(figures).toHaveLength(15);
  });

  test("the source line names the window and what is left out", () => {
    const line = sourceLine(eodTotals(figures));
    expect(line).toBe(
      "Source: the media sync's client figures, 14 Oct to 20 Oct. Mahara's campaigns only, stopped ones included, and $375 on the same ad accounts outside them is left out.",
    );
  });

  test("Atlantis counts its stopped campaign's booking: $43.63, not $58.18", () => {
    const a = figureFor(figures, "Atlantis Contracting");
    expect(a?.bookings).toBe(4);
    expect(round((a?.spend ?? 0) / (a?.bookings ?? 1))).toBe(43.63);
  });

  test("a client whose bookings were not read is left out of the cost and said so", () => {
    const unread = links().map(l =>
      l.name === "City Wood"
        ? {
            ...l,
            ads7d: {
              ...(l.ads7d as Record<string, unknown>),
              bookings: null,
              bookingsWhy: "The GoHighLevel read failed.",
            },
          }
        : l,
    );
    const t = eodTotals(clientFigures(listed(), unread));
    expect(t.bookings).toBe(46);
    expect(t.notRead).toEqual({ clients: 1, spend: 354 });
    expect(round(t.costPerBooking ?? 0)).toBe(round((2717.05 - 354) / 46));
    expect(bookingsLine(t)).toBe(
      "Bookings (7d): 46 · cost per booking $51.37 ($354 of one client's spend is left out of the cost: their bookings were not read)",
    );
  });
});

describe("the clients out of KPI, one line each", () => {
  const lines = outOfKpiLines(clientFigures(listed(), links()));
  const of = (name: string) => lines.filter(l => l.startsWith(`• ${name} - `));

  test("each client once, on its own figure", () => {
    const names = lines.map(l => l.slice(2, l.indexOf(" - ")));
    expect(new Set(names).size).toBe(names.length);
    // Madana spent $11.09 with no lead yet: kpi.ts belowKpi lists spend
    // with no leads, as it did per campaign.
    expect(names).toEqual([
      "Alkhalil",
      "Arcturus Construction",
      "Castello Industries",
      "City Wood",
      KHALIDA,
      "مدانة العمرانية لﻺستشارات",
    ]);
  });

  test("Castello by its client figure, $268.48, naming 6\\10", () => {
    expect(of("Castello Industries")).toEqual([
      "• Castello Industries - cost per booking $268, CPL $13.42, worst campaign CASTELLO-MAHARA-6\\10 at $225 a booking → Check the client's Calls section",
    ]);
  });

  test("Khalida once at $91.62; Alkhalil no booking on $233; Atlantis not listed", () => {
    expect(of(KHALIDA)).toHaveLength(1);
    expect(of(KHALIDA)[0]).toContain("cost per booking $91.62");
    // The campaign name inside the line has no spaced dash and no direction
    // marks, so the CSM brief keeps the line whole.
    expect(of(KHALIDA)[0]).toContain(
      "worst campaign منشاءت الخالده-mahara-14\\10 at $80.27 a booking",
    );
    expect(of("Alkhalil")).toEqual([
      "• Alkhalil - no booking on $233, CPL $13.73 → Cut the ad with the worst cost per booking",
    ]);
    expect(of("Atlantis Contracting")).toEqual([]);
  });

  test("lines the client brief reads whole: the name first, one spaced hyphen, no em dash", () => {
    // clientBrief.ts: EOD_LABEL, KPI_LINE and the list split of eodParts.
    const KPI_LINE = /\bcpl\b|cost per|out of kpi|account summary|cpb\b|\$\d/i;
    for (const line of lines) {
      expect(line).not.toContain("—");
      expect(line.match(/\s[-–]\s/g)?.length).toBe(1);
      expect(KPI_LINE.test(line)).toBe(true);
    }
  });

  test("the CPL line names each client once", () => {
    // Ardon $18.35, Atlantis $34.91, Khalida $15.27 a lead.
    expect(overCplGate(clientFigures(listed(), links()))).toEqual([
      "Ardon",
      "Atlantis Contracting",
      KHALIDA,
    ]);
  });
});

describe("before the media sync publishes a client's 7 days", () => {
  test("the listed campaigns are summed, bookings added up, and the report says so", () => {
    const figures = clientFigures(listed(), links(false));
    const t = eodTotals(figures);
    // The stopped Atlantis campaign's booking is not in the listed rows.
    expect(t.bookings).toBe(48);
    expect(sourceLine(t)).toBe(
      "Source: the campaigns listed, last 7 days. A stopped campaign is left out with its spend and bookings.",
    );
    // Castello's two campaigns add up (1 + 0), never the larger of the two.
    const castello = figureFor(figures, "Castello Industries");
    expect(castello?.bookings).toBe(1);
    expect(castello?.source).toBe("campaigns listed");
    const line = outOfKpiLines(figures).find(l => l.startsWith("• Castello"));
    expect(line).toContain("(campaigns listed)");
    // Done with you stays unknown, never 0, and its spend stays in.
    expect(figureFor(figures, NAHOUD)?.bookings).toBeNull();
    expect(t.notRead.clients).toBe(0);
  });

  test("a published ads7d that is not in the shape is not published", () => {
    expect(readClientWeek(undefined)).toBeUndefined();
    expect(
      readClientWeek({
        from: "2026-10-14",
        through: "x",
        spend: 1,
        leads: 1,
        bookings: 0,
      }),
    ).toBeUndefined();
    expect(
      readClientWeek({
        from: "2026-10-14",
        through: "2026-10-20",
        spend: "1",
        leads: 1,
        bookings: 0,
      }),
    ).toBeUndefined();
    expect(
      readClientWeek({
        from: "2026-10-14",
        through: "2026-10-20",
        spend: 1,
        leads: 1,
        bookings: "2",
      }),
    ).toBeUndefined();
    expect(
      readClientWeek({
        from: "2026-10-14",
        through: "2026-10-20",
        spend: 1,
        leads: 1,
        bookings: null,
      })?.bookings,
    ).toBeNull();
  });

  test("a client card matched by its account, not its name, is counted once", () => {
    const cards = links().map(l =>
      l.name === "City Wood"
        ? { ...l, name: "CityWood Interiors", aliases: [] }
        : l,
    );
    const figures = clientFigures(listed(), cards);
    expect(
      figures.filter(f => f.week?.accounts.includes("927741509922733")),
    ).toHaveLength(1);
    expect(round(eodTotals(figures).spend)).toBe(2717.05);
  });

  test("a client card with spend and no campaign listed is still counted", () => {
    const cards = [
      ...links(),
      {
        name: "ARCWANI",
        aliases: ["arcwani"],
        ads7d: {
          from: "2026-10-14",
          through: "2026-10-20",
          accounts: ["1034584029438250"],
          spend: 20.2,
          leads: 1,
          offBoardSpend: 0,
          bookings: 1,
          costPerBooking: 20.2,
          showed: null,
          noShows: null,
          due: null,
          campaigns: [],
          source: "media sync",
        },
      },
      // Nothing in the window: not a client of this week.
      {
        name: "Quiet",
        aliases: [],
        ads7d: {
          from: "2026-10-14",
          through: "2026-10-20",
          accounts: ["1"],
          spend: 0,
          leads: 0,
          bookings: 0,
          campaigns: [],
        },
      },
    ];
    const t = eodTotals(clientFigures(listed(), cards));
    expect(t.bookings).toBe(50);
    expect(t.clients).toBe(16);
  });
});

// Review of build 2 (22 Oct): a done-with-you client found only by its
// client card (every campaign stopped) was read as "bookings not read".
describe("a done-with-you client with every campaign stopped", () => {
  test("its spend counts in the cost as a listed one's does, never as not read", () => {
    // نهوض نجد with both campaigns stopped: no listed row, only its card.
    const cards = links();
    const rows = listed().filter(r => r.clientName !== NAHOUD);
    const figures = clientFigures(rows, cards);
    const n = figureFor(figures, NAHOUD);
    expect(n?.dwy).toBe(true);
    expect(n?.bookings).toBeNull();
    const t = eodTotals(figures);
    // The same totals as with its campaigns listed: $2,717.05 / 49.
    expect(round(t.spend)).toBe(2717.05);
    expect(t.notRead).toEqual({ clients: 0, spend: 0 });
    expect(bookingsLine(t)).toBe("Bookings (7d): 49 · cost per booking $55.45");
    // Its out-of-KPI line, if any, judges the cost per lead only.
    for (const line of outOfKpiLines(figures))
      if (line.includes(NAHOUD)) expect(line).toContain("CPL");
  });

  test("done with you is the media sync's own sentence, with no booking count", () => {
    const week = readClientWeek(
      (links().find(l => l.name === NAHOUD) as Record<string, unknown>).ads7d,
    );
    expect(week && weekIsDwy(week)).toBe(true);
    const failed = readClientWeek({
      ...(week as object),
      bookingsWhy:
        "GoHighLevel could not be read this run, so the bookings are not known.",
    });
    expect(failed && weekIsDwy(failed)).toBe(false);
    const counted = readClientWeek({ ...(week as object), bookings: 3 });
    expect(counted && weekIsDwy(counted)).toBe(false);
  });
});

describe("a decision's evidence fits the client brief's cut", () => {
  const MERGE = "Merge Studio | Instant Form | Leads | Oct2026 | MHM™";
  const REASON =
    "$15.03 a booking (9 bookings) and $9.98 a lead, both inside the gates.";

  test("the campaign first, shortened so the reason's figures are never cut", () => {
    const e = decisionEvidence(MERGE, REASON) as string;
    expect(e).toBe(`Merge Studio…: ${REASON}`);
    // The brief keeps 90 characters of a decision's evidence: all of it.
    expect(e.length).toBeLessThanOrEqual(90);
    expect(e.slice(0, 90)).toContain("$9.98 a lead");
    // At 80 (the newest thing that happened) every figure is still whole.
    for (const figure of ["$15.03", "(9 bookings)", "$9.98"])
      expect(e.slice(0, 80)).toContain(figure);
  });

  test("a short pair is kept whole; Khalida's name loses its marks and spaced dash", () => {
    expect(
      decisionEvidence("Ardon_mahar-22\\9", "CPL $12.10 is under the gate."),
    ).toBe("Ardon_mahar-22\\9: CPL $12.10 is under the gate.");
    const k = decisionEvidence(
      KHALIDA_14,
      "No booking yet on $11.35.",
    ) as string;
    expect(k).toBe("منشاءت الخالده-mahara-14\\10: No booking yet on $11.35.");
    expect(k).not.toMatch(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]| – /);
    expect(k.length).toBeLessThanOrEqual(EVIDENCE_FIT);
    // No reason, no evidence.
    expect(decisionEvidence(MERGE, undefined)).toBeUndefined();
    expect(decisionEvidence(MERGE, "  ")).toBeUndefined();
  });
});

describe("worst campaign and names", () => {
  test("one campaign is not named; too early is not judged", () => {
    const one = clientFigures(listed(), links()).find(
      f => f.client === "City Wood",
    );
    expect(one && worstCampaign(one)).toBeUndefined();
    const atl = clientFigures(listed(), links()).find(
      f => f.client === "Atlantis Contracting",
    );
    // 19\10 has no booking on $51.71 (under $60): not judged; 7\10 is.
    expect(atl && worstCampaign(atl)?.name).toBe("Atlantis-mahara-7\\10");
  });

  test("cleanName drops direction marks and spaced dashes", () => {
    expect(cleanName(KHALIDA_14)).toBe("منشاءت الخالده-mahara-14\\10");
    expect(cleanName("Merge Studio | Leads")).toBe("Merge Studio | Leads");
  });
});

describe("the page uses the roll-up", () => {
  const page = readFileSync(
    join(import.meta.dir, "..", "src/pages/CockpitPage.tsx"),
    "utf8",
  );

  test("the report, the out-of-KPI list and the touchpoints read one figure per client", () => {
    expect(page).toContain("const totals = eodTotals(figures);");
    expect(page).toContain("bookingsLine(totals),");
    expect(page).toContain("sourceLine(totals),");
    expect(page).toContain("clientOutOfKpiLines(figures)");
    expect(page).toContain("const fig = figureFor(figures, client);");
    // Sum, never the largest campaign's count.
    expect(page).not.toMatch(
      /Math\.max\(0, \.\.\.list\.map\(x => Number\(x\.bookings7d/,
    );
    expect(page).toContain('"CLIENTS OUT OF KPI - METRIC AND NEXT ACTION"');
    expect(page).not.toContain("OUT OF KPI —");
  });

  test("a decision's evidence names its campaign first, through decisionEvidence", () => {
    expect(page).toContain(
      "evidence: decisionEvidence(String(c.campaignName), c.reason),",
    );
  });
});
