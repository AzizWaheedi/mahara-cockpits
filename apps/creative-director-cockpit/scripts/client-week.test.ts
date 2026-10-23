import { describe, expect, test } from "bun:test";
import {
  clientPerformance,
  cplTitle,
  DWY_WHY,
  dayRange,
  NO_GHL_WHY,
  NO_SHOWS_YET,
  NO_SPEND_WHY,
  performanceView,
  pickClientWeek,
  readClientWeek,
  showRateOf,
  weekContextLines,
} from "../src/lib/clientWeek";
import {
  buildContextPack,
  buildSnapshot,
  snapshotContext,
} from "../src/lib/creativeSourceModels";

// Atlantis, 14 to 20 Oct, as the media sync would publish it (build 2
// contract section 2.1; R8 and R20). The totals are the audit's; the split by
// campaign and the meetings due are the live reads of 23 Oct 00:40 Kuwait
// (cockpit_media_daily_stats, cockpit_media_booking_events): the 4th booking
// sits on 13\9, a stopped campaign with no spend that week, and one of the
// four meetings had not come due yet.
function week(over: Record<string, unknown> = {}) {
  return {
    from: "2026-10-14",
    through: "2026-10-20",
    accounts: ["290802986"],
    spend: 174.53,
    leads: 5,
    offBoardSpend: 0,
    bookings: 4,
    costPerBooking: 43.63,
    showed: 0,
    noShows: 0,
    due: 3,
    campaigns: [
      {
        campaignName: "Atlantis-mahara-7\\10",
        spend: 122.82,
        leads: 2,
        bookings: 3,
        live: true,
      },
      {
        campaignName: "Atlantis-mahara-19\\10",
        spend: 51.71,
        leads: 3,
        bookings: 0,
        live: true,
      },
      {
        campaignName: "Atlantis-mahara-13\\9",
        spend: 0,
        leads: 0,
        bookings: 1,
        live: false,
      },
    ],
    source: "media sync",
    ...over,
  };
}
const shades = week({
  accounts: ["act_762687672022667"],
  spend: 203.63,
  leads: 24,
  bookings: 4,
  showed: 1,
  noShows: 1,
  due: 4,
  campaigns: [
    {
      campaignName: "Shades|mahara|17\\10",
      spend: 203.63,
      leads: 24,
      bookings: 4,
      live: true,
    },
  ],
});
const none = { ads: [], campaigns: [] };
const texts = (p: ReturnType<typeof clientPerformance>) =>
  performanceView(p).lines.map(l => l.text);

describe("readClientWeek", () => {
  test("reads the published week and recomputes cost per booking to the cent", () => {
    const w = readClientWeek(week());
    expect(w).not.toBeNull();
    expect(w?.costPerBooking).toBe(43.63);
    expect(w?.bookings).toBe(4);
    expect(w?.campaigns).toHaveLength(3);
    expect(w?.costPerBookingWhy).toBeNull();
    expect(readClientWeek(shades)?.accounts).toEqual(["762687672022667"]);
  });
  test("anything malformed reads as not published, never as zero", () => {
    expect(readClientWeek(undefined)).toBeNull();
    expect(readClientWeek(null)).toBeNull();
    expect(readClientWeek([])).toBeNull();
    expect(readClientWeek(week({ source: "media data" }))).toBeNull();
    expect(readClientWeek(week({ from: "14 Oct" }))).toBeNull();
    expect(readClientWeek(week({ from: "2026-10-21" }))).toBeNull();
    expect(readClientWeek(week({ spend: -1 }))).toBeNull();
    expect(readClientWeek(week({ spend: "174.53" }))).toBeNull();
    expect(readClientWeek(week({ leads: 2.5 }))).toBeNull();
    expect(readClientWeek(week({ bookings: undefined }))).toBeNull();
    expect(readClientWeek(week({ bookings: -2 }))).toBeNull();
  });
  test("bookings not read carry the reason, and no show counts", () => {
    const w = readClientWeek(
      week({
        bookings: null,
        bookingsWhy: "Done with you: the client books its own meetings.",
        showed: 3,
      }),
    );
    expect(w?.bookings).toBeNull();
    expect(w?.costPerBooking).toBeNull();
    expect(w?.showed).toBeNull();
    expect(w?.bookingsWhy).toBe(
      "Done with you: the client books its own meetings.",
    );
    expect(readClientWeek(week({ bookings: null }))?.bookingsWhy).toBe(
      "The media sync did not read this client's bookings.",
    );
  });
  test("show counts that are not counts of those bookings give no rate", () => {
    const over = readClientWeek(week({ showed: 3, noShows: 2 }));
    expect(over?.showed).toBeNull();
    expect(over?.marksWhy).toBe("the show counts do not match the bookings");
    expect(readClientWeek(week({ due: 5 }))?.marksWhy).toBe(
      "the show counts do not match the bookings",
    );
    const missing = readClientWeek(week({ noShows: undefined }));
    expect(missing?.marksWhy).toBe("the show counts were not published");
    expect(missing?.due).toBeNull();
    expect(readClientWeek(week())?.marksWhy).toBeNull();
  });
  test("the media sync's cost per booking is kept when it agrees within a cent", () => {
    const tie = readClientWeek(
      week({ spend: 162.47, bookings: 2, costPerBooking: 81.23, due: 2 }),
    );
    expect(tie?.costPerBooking).toBe(81.23);
    expect(readClientWeek(week({ costPerBooking: 99 }))?.costPerBooking).toBe(
      43.63,
    );
    expect(
      readClientWeek(week({ costPerBooking: undefined }))?.costPerBooking,
    ).toBe(43.63);
  });
  test("no booking gives no cost per booking", () => {
    expect(readClientWeek(week({ bookings: 0 }))?.costPerBooking).toBeNull();
    expect(readClientWeek(week({ bookings: 0 }))?.costPerBookingWhy).toBeNull();
  });
  test("bookings on days Mahara spent nothing give no cost per booking, never $0.00", () => {
    const given =
      "Mahara's campaigns spent nothing on these days, so there is no cost per booking: these bookings came from earlier spend or from campaigns that are not Mahara's.";
    const w = readClientWeek(
      week({
        spend: 0,
        leads: 0,
        bookings: 2,
        due: 2,
        costPerBooking: null,
        costPerBookingWhy: given,
      }),
    );
    expect(w?.costPerBooking).toBeNull();
    expect(w?.costPerBookingWhy).toBe(given);
    // An older or partial publish that says 0 or gives no reason.
    const bare = readClientWeek(
      week({ spend: 0, leads: 0, bookings: 2, due: 2, costPerBooking: 0 }),
    );
    expect(bare?.costPerBooking).toBeNull();
    expect(bare?.costPerBookingWhy).toBe(NO_SPEND_WHY);
  });
});

describe("show rate", () => {
  test("showed over marked meetings, never over every booking", () => {
    expect(showRateOf(1, 1)).toBe(0.5);
    expect(showRateOf(0, 1)).toBe(0);
    expect(showRateOf(2, 0)).toBe(1);
  });
  test("nothing marked is no rate, not 0%", () => {
    expect(showRateOf(0, 0)).toBeNull();
    expect(showRateOf(null, 0)).toBeNull();
    expect(showRateOf(1, null)).toBeNull();
  });
});

describe("pickClientWeek", () => {
  const atlantis = { name: "Atlantis Contracting", ads7d: week() };
  const shadesRow = { name: "Shades", ads7d: shades };
  const board = [atlantis, shadesRow];
  const A = "Atlantis Contracting";
  test("a profile with campaigns takes the week on its campaigns' accounts", () => {
    expect(pickClientWeek(A, atlantis, board, ["act_290802986"])?.spend).toBe(
      174.53,
    );
    expect(
      pickClientWeek("atlantis", atlantis, board, ["290802986", ""])?.spend,
    ).toBe(174.53);
  });
  test("a name match on another client's accounts is not shown", () => {
    // The Atlantis card has a week, but this profile's campaign sits on
    // Shades' account: the name and the account disagree, so no week at all,
    // never Shades' $203.63 on the Atlantis row.
    expect(pickClientWeek(A, atlantis, board, ["762687672022667"])).toBeNull();
    expect(pickClientWeek(A, atlantis, board, ["111"])).toBeNull();
    const twice = [shadesRow, { name: "Copy", ads7d: shades }];
    expect(
      pickClientWeek("Shades", undefined, twice, ["762687672022667"]),
    ).toBeNull();
  });
  test("a card with no week of its own takes the one card on the account", () => {
    // A second card for the same client (North Gulf had two), or a name
    // that reaches no card: the account decides, when one card holds it.
    const bare = { name: "Atlantis Contracting" };
    expect(
      pickClientWeek(A, bare, [bare, ...board], ["290802986"])?.spend,
    ).toBe(174.53);
    expect(
      pickClientWeek("Atlantis Contracting Co", undefined, board, ["290802986"])
        ?.spend,
    ).toBe(174.53);
  });
  test("a profile with no campaign takes a week only by its exact name", () => {
    expect(pickClientWeek(A, atlantis, board, [])?.spend).toBe(174.53);
    expect(
      pickClientWeek("atlantis  contracting", undefined, board, [undefined])
        ?.spend,
    ).toBe(174.53);
    // Task and video names that only reach the card through an alias.
    expect(
      pickClientWeek("ATLANTIS PREMIUM PROJECTS", atlantis, board, []),
    ).toBeNull();
    expect(
      pickClientWeek("Shades For General Contracting", shadesRow, board, []),
    ).toBeNull();
    expect(pickClientWeek("", undefined, board, [])).toBeNull();
  });
});

describe("performanceView with the client's week (14 to 20 Oct)", () => {
  test("Atlantis reads $43.63 over 4, the stopped campaign's booking counted", () => {
    const p = clientPerformance(readClientWeek(week()), none);
    expect(p.costPerBooking).toBe(43.63);
    expect(p.stoppedCampaigns).toBe(1);
    const v = performanceView(p);
    expect(v.label).toBe("Performance, 14 to 20 Oct");
    expect(texts(p)).toEqual([
      "5 leads at $34.91 a lead",
      "4 booked · $43.63 per booking",
      "Show rate not marked in GoHighLevel yet, 3 meetings came due",
      "$174.53 on Mahara's campaigns only, 1 stopped or idle campaign included.",
    ]);
    expect(v.lines.at(-1)?.note).toBe(true);
    expect(v.lines.at(-1)?.title).toContain("Client Performance board");
  });
  test("Shades reads 50% show, 1 of 2 marked, not 17%", () => {
    const p = clientPerformance(readClientWeek(shades), none);
    expect(p.showRate).toBe(0.5);
    expect(texts(p)).toContain(
      "50% show (1 of 2 marked), meetings booked 14 to 20 Oct",
    );
    expect(texts(p)).toContain("4 booked · $50.91 per booking");
  });
  test("the show rate names its basis and how the board differs", () => {
    // Shades on the board, 14 to 20 Oct by meeting day: 0 shows, 2 no-shows.
    // Here: the meetings booked on those days, GoHighLevel's marks only.
    const line = performanceView(
      clientPerformance(readClientWeek(shades), none),
    ).lines.find(l => l.text.includes("% show"));
    expect(line?.text).toContain("meetings booked 14 to 20 Oct");
    expect(line?.title).toContain("meetings booked on these days");
    expect(line?.title).toContain("by meeting day");
    expect(line?.title).toContain("client's sheet");
  });
  test("not marked in GoHighLevel never claims nobody marked them", () => {
    // Arcturus 14 to 20 Oct: four bookings, all "confirmed" in GoHighLevel,
    // three of them marked attended on the client's sheet. The media sync
    // counts the status only, so the line must say whose marks it read.
    const arcturus = clientPerformance(
      readClientWeek(
        week({
          accounts: ["3658852461068269"],
          spend: 242.48,
          leads: 39,
          bookings: 4,
          costPerBooking: 60.62,
          showed: 0,
          noShows: 0,
          due: 4,
          campaigns: [],
        }),
      ),
      none,
    );
    expect(arcturus.showWhy).toBe("not marked in GoHighLevel yet");
    const line = performanceView(arcturus).lines.find(l =>
      l.text.startsWith("Show rate"),
    );
    expect(line?.text).toBe(
      "Show rate not marked in GoHighLevel yet, 4 meetings came due",
    );
    expect(line?.title).not.toMatch(/^Nobody marked/);
    expect(line?.title).toContain("client's sheet");
    expect(line?.title).toContain("It is not 0%");
  });
  test("nothing marked never reads 0% show", () => {
    for (const due of [0, 3, null]) {
      const t = texts(clientPerformance(readClientWeek(week({ due })), none));
      expect(t.join(" ")).not.toMatch(/\d+% show/);
      expect(t.join(" ")).toContain("Show rate not marked in GoHighLevel yet");
    }
    expect(
      texts(clientPerformance(readClientWeek(week({ due: 0 })), none)),
    ).toContain(
      "Show rate not marked in GoHighLevel yet, no meeting has come due",
    );
  });
  test("show counts that do not add up read n/a with the reason", () => {
    const t = texts(
      clientPerformance(readClientWeek(week({ showed: 3, noShows: 2 })), none),
    );
    expect(t).toContain(
      "Show rate n/a: the show counts do not match the bookings.",
    );
    expect(t.join(" ")).not.toMatch(/\d+% show/);
    expect(
      weekContextLines(readClientWeek(week({ noShows: null }))!),
    ).toContain("- Show rate: n/a, the show counts were not published");
  });
  test("a marked no-show is a real 0%", () => {
    const t = texts(
      clientPerformance(
        readClientWeek(week({ bookings: 2, noShows: 1, due: 2, spend: 15.71 })),
        none,
      ),
    );
    expect(t).toContain(
      "0% show (0 of 1 marked), meetings booked 14 to 20 Oct",
    );
    expect(t).toContain("2 booked · $7.86 per booking");
  });
  test("no booking after spend names the spend", () => {
    const t = texts(
      clientPerformance(
        readClientWeek(
          week({
            spend: 233.36,
            leads: 17,
            bookings: 0,
            due: 0,
            campaigns: [],
          }),
        ),
        none,
      ),
    );
    expect(t).toContain("No booking yet on $233.36");
    expect(t.join(" ")).not.toContain("show");
  });
  test("bookings not read say why and give no cost per booking", () => {
    const p = clientPerformance(
      readClientWeek(
        week({
          bookings: null,
          bookingsWhy: "Done with you: the client books its own meetings.",
        }),
      ),
      none,
    );
    expect(p.costPerBooking).toBeNull();
    expect(texts(p)).toContain(
      "Bookings n/a: Done with you: the client books its own meetings.",
    );
    expect(texts(p).join(" ")).not.toContain("per booking");
  });
  test("spend on campaigns off the board is named as left out", () => {
    const t = texts(
      clientPerformance(readClientWeek(week({ offBoardSpend: 90.07 })), none),
    );
    expect(t.at(-1)).toBe(
      "$174.53 on Mahara's campaigns only, 1 stopped or idle campaign included. $90.07 on campaigns off the board left out.",
    );
  });
  test("bookings on days with no spend never read $0.00 per booking", () => {
    const p = clientPerformance(
      readClientWeek(week({ spend: 0, leads: 0, bookings: 2, due: 2 })),
      none,
    );
    expect(p.costPerBooking).toBeNull();
    const t = texts(p);
    expect(t[0]).toBe("No spend on these days");
    expect(t).toContain("2 booked, with no spend on these days");
    expect(t.join(" ")).not.toContain("$0.00");
    expect(
      performanceView(p).lines.find(l => l.text.startsWith("2 booked"))?.title,
    ).toBe(NO_SPEND_WHY);
    expect(
      weekContextLines(
        readClientWeek(week({ spend: 0, leads: 0, bookings: 2, due: 2 }))!,
      ),
    ).toContain("- Cost per booked call: n/a, no spend on these days");
  });
  test("the note says bookings count whatever campaign they came from", () => {
    const note = performanceView(
      clientPerformance(readClientWeek(week()), none),
    ).lines.at(-1);
    expect(note?.title).toContain("whatever campaign it came from or none");
    expect(note?.title).toContain("Mahara's spend");
    expect(note?.title).toContain("under $0.50 of spend");
  });
  test("a client with an account and no spend says so", () => {
    const t = texts(
      clientPerformance(
        readClientWeek(
          week({ spend: 0, leads: 0, bookings: 0, due: 0, campaigns: [] }),
        ),
        none,
      ),
    );
    expect(t[0]).toBe("No spend on these days");
    expect(t).toContain("No booking");
    // ARCWANI, Liwan, Joe and Sera on 14 to 20 Oct: no "$0.00" anywhere.
    expect(t.at(-1)).toBe("Mahara's campaigns only.");
    expect(t.join(" ")).not.toContain("$0.00");
  });
});

describe("performanceView before the media sync publishes the week", () => {
  // The live rows on 21 Oct: Atlantis 7\10 alone, the 13\9 booking missing.
  const liveAtlantis = {
    ads: [{ spend: 174.54, leads: 5 }],
    campaigns: [{ spend7d: 174.54, bookings7d: 3, showed7d: 0 }],
  };
  test("keeps today's sums and says they are live campaigns only", () => {
    const p = clientPerformance(null, liveAtlantis);
    expect(p.source).toBe("live campaigns");
    const v = performanceView(p);
    expect(v.label).toBe("Performance, last 7d");
    expect(texts(p)).toEqual([
      "5 leads at $34.91 a lead",
      "3 booked · $58.18 per booking",
      NO_SHOWS_YET,
      "Live campaigns only: stopped or idle campaigns are left out until the media sync publishes the client's week.",
    ]);
    expect(v.lines.at(-1)?.title).toContain("$0.50 or more");
  });
  test("no-shows unknown is one sentence, never 'no show marked yet'", () => {
    // Marble on 23 Oct: live rows say 0 showed, GoHighLevel holds 2 no-shows.
    const marble = clientPerformance(null, {
      ads: [{ spend: 184.56, leads: 20 }],
      campaigns: [{ spend7d: 184.56, bookings7d: 5, showed7d: 0 }],
    });
    expect(marble.showWhy).toBe(NO_SHOWS_YET);
    const t = texts(marble);
    expect(t).toContain(NO_SHOWS_YET);
    expect(t.join(" ")).not.toMatch(/no show marked/i);
    expect(t.join(" ")).not.toMatch(/%/);
  });
  test("no show rate from showed over all bookings (Shades was 17%)", () => {
    const p = clientPerformance(null, {
      ads: [{ spend: 230.25, leads: 27 }],
      campaigns: [{ spend7d: 230.25, bookings7d: 6, showed7d: 1 }],
    });
    expect(p.showRate).toBeNull();
    expect(texts(p).join(" ")).not.toMatch(/%/);
    expect(texts(p)).toContain(NO_SHOWS_YET);
  });
  test("live bookings on campaigns that spent nothing never read $0.00 per booking", () => {
    const p = clientPerformance(null, {
      ads: [{ spend: 0, leads: 0 }],
      campaigns: [{ spend7d: 0, bookings7d: 1, showed7d: 0 }],
    });
    expect(p.costPerBooking).toBeNull();
    expect(p.costPerBookingWhy).toBe(NO_SPEND_WHY);
    expect(texts(p)).toContain("1 booked, with no spend on these days");
    expect(texts(p).join(" ")).not.toContain("$0.00");
  });
  test("campaigns without a booking count read n/a, not 0 booked", () => {
    const p = clientPerformance(null, {
      ads: [{ spend: 198.96, leads: 14 }],
      campaigns: [{ spend7d: 198.96 }],
    });
    expect(p.bookings).toBeNull();
    expect(texts(p)).toContain(
      "Bookings n/a: these campaigns carry no booking count.",
    );
  });
  test("a campaign with no booking count makes the total n/a, never a partial sum", () => {
    // $100 with 2 bookings plus $80 with no count must not read $90.00 a booking.
    const p = clientPerformance(null, {
      ads: [{ spend: 180, leads: 9 }],
      campaigns: [
        { spend7d: 100, bookings7d: 2, showed7d: 0 },
        { spend7d: 80 },
      ],
    });
    expect(p.bookings).toBeNull();
    expect(p.costPerBooking).toBeNull();
    expect(texts(p)).toContain(
      "Bookings n/a: 1 of the 2 live campaigns carries no booking count, so the client's total is not known.",
    );
    expect(texts(p).join(" ")).not.toContain("per booking");
    expect(texts(p).join(" ")).not.toContain("$90.00");
  });
  test("done with you and no GoHighLevel give the media sync's reason", () => {
    // نهوض نجد before the media sync's week: DWY, no booking count.
    const dwy = clientPerformance(null, {
      ads: [{ spend: 198.96, leads: 14 }],
      campaigns: [{ spend7d: 198.96, serviceMode: "DWY", hasGhl: true }],
    });
    expect(texts(dwy)).toContain(`Bookings n/a: ${DWY_WHY}`);
    const noGhl = clientPerformance(null, {
      ads: [{ spend: 50, leads: 2 }],
      campaigns: [{ spend7d: 50, serviceMode: "DFY", hasGhl: false }],
    });
    expect(texts(noGhl)).toContain(`Bookings n/a: ${NO_GHL_WHY}`);
  });
  test("no ad on our boards", () => {
    const v = performanceView(clientPerformance(null, none));
    expect(v.lines.map(l => l.text)).toEqual(["No ads on our boards"]);
    expect(v.lines[0].title).toContain("not known here");
    expect(v.lines[0].title).toContain("It is not $0");
  });
});

test("the CPL chip names its window and what it counts", () => {
  expect(cplTitle(clientPerformance(readClientWeek(week()), none))).toBe(
    "Cost per lead, 14 to 20 Oct: Mahara's campaigns only, from the media sync.",
  );
  expect(
    cplTitle(
      clientPerformance(null, {
        ads: [{ spend: 10, leads: 1 }],
        campaigns: [],
      }),
    ),
  ).toBe("Cost per lead, last 7 days: live campaigns only.");
});

test("dayRange names the window in plain words", () => {
  expect(dayRange("2026-10-14", "2026-10-20")).toBe("14 to 20 Oct");
  expect(dayRange("2026-09-28", "2026-10-04")).toBe("28 Sep to 4 Oct");
  expect(dayRange("2026-10-20", "2026-10-20")).toBe("20 Oct");
});

test("weekContextLines gives the writer the client's own week", () => {
  const lines = weekContextLines(readClientWeek(shades)!);
  expect(lines[0]).toBe(
    "Client total, 14 to 20 Oct (media sync; Mahara's campaigns only, stopped or idle ones included):",
  );
  expect(lines).toContain("- Cost per booked call: $50.91");
  expect(lines).toContain(
    "- Show rate: 50% (1 of 2 marked in GoHighLevel, of the meetings booked on these days)",
  );
  expect(weekContextLines(readClientWeek(week())!)).toContain(
    "- Show rate: not marked in GoHighLevel yet",
  );
  const dwy = weekContextLines(
    readClientWeek(week({ bookings: null, offBoardSpend: 12.5 }))!,
  );
  expect(dwy).toContain(
    "- Booked calls: n/a, The media sync did not read this client's bookings.",
  );
  expect(dwy).toContain("- Cost per booked call: n/a");
  expect(dwy).toContain("- Show rate: n/a, bookings were not read");
  expect(dwy).toContain("- Left out: $12.50 on campaigns off the board");
});

// The dashboard model over source rows: clients carry ads7d, campaigns and
// ads are the live media rows.
function tables(clients: any[], campaigns: any[], ads: any[]) {
  return {
    clients,
    creativeTasks: [],
    videoJobs: [],
    contentPosts: [],
    touchLog: [],
    campaigns,
    ads,
    metaTree: [],
    funnels: [],
    winnersArchive: [],
    marketPlays: [],
    blueprints: [],
    checks: [],
    planItems: [],
    eodReports: [],
  };
}
const atlantisCampaign = {
  campaignName: "Atlantis-mahara-7\\10",
  clientName: "Atlantis Contracting",
  metaAccountId: "290802986",
  spend7d: 174.54,
  leads7d: 5,
  bookings7d: 3,
  showed7d: 0,
};
const atlantisAd = {
  campaignName: "Atlantis-mahara-7\\10",
  adName: "ad-1",
  spend: 174.54,
  leads: 5,
};

describe("buildSnapshot client profiles", () => {
  test("a client card with ads7d gives the client's figure", async () => {
    const snap = await buildSnapshot(
      snapshotContext(
        tables(
          [
            {
              name: "Atlantis Contracting",
              aliases: ["atlantis"],
              taskId: "86eyjkdc8",
              ads7d: week(),
            },
          ],
          [atlantisCampaign],
          [atlantisAd],
        ),
      ),
      null,
    );
    const row = snap.clients.find(
      (c: any) => c.client === "Atlantis Contracting",
    );
    expect(row.performance.source).toBe("media sync");
    expect(row.bookings7d).toBe(4);
    expect(row.costPerBooking).toBe(43.63);
    expect(row.spend).toBe(174.53);
    expect(row.cpl).toBe(34.91);
    expect(row.showRate).toBeNull();
    expect(row.ads).toBe(1);
    expect("showDataAvailable" in snap).toBe(false);
  });
  test("without ads7d the live rows are summed as before, per client", async () => {
    const snap = await buildSnapshot(
      snapshotContext(
        tables(
          [{ name: "Atlantis Contracting", aliases: ["atlantis"] }],
          [
            atlantisCampaign,
            {
              campaignName: "Shades|mahara|17\\10",
              clientName: "Shades",
              metaAccountId: "762687672022667",
              spend7d: 230.25,
              bookings7d: 6,
              showed7d: 1,
            },
          ],
          [atlantisAd],
        ),
      ),
      null,
    );
    const row = snap.clients.find(
      (c: any) => c.client === "Atlantis Contracting",
    );
    expect(row.performance.source).toBe("live campaigns");
    expect(row.costPerBooking).toBeCloseTo(58.18, 2);
    // Shades marking a show no longer switches a show count on for Atlantis.
    expect(row.showed7d).toBe(0);
    expect(row.showRate).toBeNull();
  });
  test("a task naming the client differently does not copy its money", async () => {
    const snap = await buildSnapshot(
      snapshotContext({
        ...tables(
          [
            {
              name: "Atlantis Contracting",
              aliases: ["atlantis"],
              ads7d: week(),
            },
          ],
          [atlantisCampaign],
          [atlantisAd],
        ),
        creativeTasks: [
          {
            taskId: "t1",
            kind: "script",
            name: "Script",
            client: "ATLANTIS PREMIUM PROJECTS",
            clients: ["ATLANTIS PREMIUM PROJECTS"],
            status: "new",
            assignees: [],
            createdAt: 1,
          },
        ],
      }),
      null,
    );
    const alias = snap.clients.find(
      (c: any) => c.client === "ATLANTIS PREMIUM PROJECTS",
    );
    expect(alias.performance.source).toBe("live campaigns");
    expect(alias.performance.hasNumbers).toBe(false);
    const own = snap.clients.find(
      (c: any) => c.client === "Atlantis Contracting",
    );
    expect(own.performance.source).toBe("media sync");
  });
  test("a card whose week is on other accounts is not shown on this client", async () => {
    const snap = await buildSnapshot(
      snapshotContext(
        tables(
          [
            {
              name: "Atlantis Contracting",
              aliases: ["atlantis"],
              ads7d: week({ accounts: ["111"] }),
            },
          ],
          [atlantisCampaign],
          [atlantisAd],
        ),
      ),
      null,
    );
    const row = snap.clients.find(
      (c: any) => c.client === "Atlantis Contracting",
    );
    expect(row.performance.source).toBe("live campaigns");
  });
});

test("buildSnapshot gives a done-with-you client the reason, not a count", async () => {
  const snap = await buildSnapshot(
    snapshotContext(
      tables(
        [{ name: "نهوض نجد" }],
        [
          {
            campaignName: "نهوض نجد للمقاولات | Leads | Sep2026 | MHM™",
            clientName: "نهوض نجد",
            metaAccountId: "1326793265986543",
            serviceMode: "DWY",
            hasGhl: true,
            spend7d: 198.96,
            leads7d: 14,
          },
        ],
        [
          {
            campaignName: "نهوض نجد للمقاولات | Leads | Sep2026 | MHM™",
            adName: "ad-1",
            spend: 198.96,
            leads: 14,
          },
        ],
      ),
    ),
    null,
  );
  const row = snap.clients.find((c: any) => c.client === "نهوض نجد");
  expect(row.bookings7d).toBeNull();
  expect(row.costPerBooking).toBeUndefined();
  expect(performanceView(row.performance).lines.map(l => l.text)).toContain(
    `Bookings n/a: ${DWY_WHY}`,
  );
});

describe("buildContextPack", () => {
  test("costs in the pack are to the cent, never $0 for $0.50", async () => {
    // SAFAD 14 to 20 Oct: $5.78 on its live campaign, 2 bookings ($2.89),
    // and an ad at $0.50 a lead.
    const ctx = snapshotContext(
      tables(
        [{ name: "SAFAD Consultant Engineering" }],
        [
          {
            campaignName: "SAFAD-mahara-1\\10",
            clientName: "SAFAD Consultant Engineering",
            metaAccountId: "774492648699300",
            spend7d: 5.78,
            leads7d: 3,
            bookings7d: 2,
            costPerBooking: 2.89,
          },
        ],
        [
          {
            campaignName: "SAFAD-mahara-1\\10",
            adName: "ad-1",
            spend: 0.5,
            leads: 1,
            cpl: 0.5,
          },
        ],
      ),
    );
    const pack = await buildContextPack(ctx, {
      name: "SAFAD Consultant Engineering",
    });
    expect(pack?.markdown).toContain("- Cost per booked call: $2.89");
    expect(pack?.markdown).toContain("- 7 day spend: $5.78");
    expect(pack?.markdown).toContain("CPL $0.50");
    expect(pack?.markdown).not.toContain("CPL $0 ");
    expect(pack?.markdown).not.toContain("call: $3\n");
  });
  test("puts the client's week above the per campaign blocks", async () => {
    const ctx = snapshotContext(
      tables(
        [
          {
            name: "Atlantis Contracting",
            aliases: ["atlantis"],
            ads7d: week(),
          },
        ],
        [atlantisCampaign],
        [atlantisAd],
      ),
    );
    const pack = await buildContextPack(ctx, { name: "Atlantis Contracting" });
    expect(pack?.markdown).toContain("Client total, 14 to 20 Oct");
    expect(pack?.markdown).toContain("- Cost per booked call: $43.63");
    expect(pack?.markdown).toContain("Per campaign, live campaigns only:");
  });
  test("without ads7d the pack is as before", async () => {
    const ctx = snapshotContext(
      tables(
        [{ name: "Atlantis Contracting", aliases: ["atlantis"] }],
        [atlantisCampaign],
        [atlantisAd],
      ),
    );
    const pack = await buildContextPack(ctx, { name: "Atlantis Contracting" });
    expect(pack?.markdown).not.toContain("Client total");
    expect(pack?.markdown).not.toContain("Per campaign, live campaigns only");
    expect(pack?.markdown).toContain("### Atlantis-mahara-7\\10");
  });
});
