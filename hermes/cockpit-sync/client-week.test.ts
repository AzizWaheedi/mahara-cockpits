import { describe, expect, test } from "bun:test";
import {
  accountsNotRead,
  BOOKINGS_WHY,
  type BookingEvent,
  type ClientWeeks,
  COST_PER_BOOKING_WHY,
  campaignAccounts,
  clientWeekFor,
  clientWeeks,
  ghlBookingEvents,
  normalize,
  resolveAccountId,
  type WeekGrain,
  weeksOrNone,
} from "./calculator";
import { clientWeekOf } from "./csmProducer";
import { adLeadsByClient, adLeadsFor } from "./csmProfileCalculations";
import { type Reads, withNativeContext } from "./runtime";

// Each client's 7 days (ads7d), cost per booking build 2 (2026-10-22). The
// figures are the live rows of 14 to 20 Oct as the media sync published them
// on 22 Oct, with the call-back and qualification-calendar bookings already
// out (033b93a7).

const since7 = "2026-10-14",
  until7 = "2026-10-20";
const now = Date.parse("2026-10-22T09:00:00Z");
const day = (
  campaignName: string,
  client: string,
  date: string,
  spend: number,
  leads: number,
  metaAdId?: string,
  accountId?: string,
): WeekGrain => ({
  campaignName,
  client,
  date,
  spend,
  leads,
  metaAdId,
  accountId,
  adSetName: "Set",
  adName: metaAdId ?? "Ad",
});
const booking = (
  eventId: string,
  date: string,
  startTime: string,
  status = "confirmed",
): BookingEvent => ({ eventId, date, startTime, status });
const placed = (client: string, campaignName: string, date: string) => ({
  client,
  campaignName,
  date,
});

const ATLANTIS = "Atlantis Contracting";
const atlantis = {
  grain: [
    day(
      "Atlantis-mahara-7\\10",
      ATLANTIS,
      "2026-10-15",
      46.17,
      0,
      "a1",
      "290802986",
    ),
    day(
      "Atlantis-mahara-7\\10",
      ATLANTIS,
      "2026-10-16",
      51.72,
      2,
      "a1",
      "290802986",
    ),
    day(
      "Atlantis-mahara-7\\10",
      ATLANTIS,
      "2026-10-17",
      24.93,
      0,
      "a1",
      "290802986",
    ),
    day(
      "Atlantis-mahara-19\\10",
      ATLANTIS,
      "2026-10-19",
      15.38,
      2,
      "a2",
      "290802986",
    ),
    day(
      "Atlantis-mahara-19\\10",
      ATLANTIS,
      "2026-10-20",
      36.33,
      1,
      "a2",
      "290802986",
    ),
    // 21 Oct is after the last day the spend reaches.
    day(
      "Atlantis-mahara-19\\10",
      ATLANTIS,
      "2026-10-21",
      34.54,
      3,
      "a2",
      "290802986",
    ),
    // 13\9 stopped on 10 Oct and spent nothing in the window.
    day(
      "Atlantis-mahara-13\\9",
      ATLANTIS,
      "2026-10-10",
      18.2,
      1,
      "a3",
      "290802986",
    ),
  ],
  events: [
    booking("tfBWkeNB8MUcUqVwKe8p", "2026-10-18", "2026-10-19T15:00:00+03:00"),
    booking("3Mv7irn3ZVGPO6OtwjAe", "2026-10-20", "2026-10-20T15:00:00+03:00"),
    booking("PXPcJFIUeR8IdEfmDu76", "2026-10-20", "2026-10-20T13:00:00+03:00"),
    // Bought by the stopped 13\9: still the client's booking.
    booking("09f9iAy7nJZyhleRzHTU", "2026-10-20", "2026-10-24T15:00:00+03:00"),
    // Made on 21 Oct, after the spend stops: not paired with this week's spend (R1).
    booking("VXrYEMAikqsc0JwMiuiX", "2026-10-21", "2026-10-24T12:30:00+03:00"),
  ],
  placed: [
    placed(ATLANTIS, "Atlantis-mahara-7\\10", "2026-10-18"),
    placed(ATLANTIS, "Atlantis-mahara-7\\10", "2026-10-20"),
    placed(ATLANTIS, "Atlantis-mahara-7\\10", "2026-10-20"),
    placed(ATLANTIS, "Atlantis-mahara-13\\9", "2026-10-20"),
    placed(ATLANTIS, "Atlantis-mahara-7\\10", "2026-10-21"),
  ],
};
const live = new Set([
  "Atlantis-mahara-7\\10",
  "Atlantis-mahara-19\\10",
  "Shades|mahara|17\\10",
  "Safad | MAHARA | 16-8",
]);
const mahara = new Set([
  ...live,
  "Atlantis-mahara-13\\9",
  "Shades|mahara|14\\10",
]);
const week = (over: Partial<Parameters<typeof clientWeeks>[0]> = {}) =>
  clientWeeks({
    since7,
    until7,
    now,
    grain: atlantis.grain,
    clients: [
      { name: ATLANTIS, accounts: ["290802986"], dwy: false, ghl: true },
    ],
    mahara,
    live,
    events: new Map([[normalize(ATLANTIS), atlantis.events]]),
    placed: atlantis.placed,
    ...over,
  });

describe("a client's 7 days", () => {
  test("Atlantis 14 to 20 Oct counts the booking its stopped campaign bought: $174.53 / 4 = $43.63", () => {
    const w = week().get(normalize(ATLANTIS));
    expect(w).toMatchObject({
      from: since7,
      through: until7,
      accounts: ["290802986"],
      spend: 174.53,
      leads: 5,
      offBoardSpend: 0,
      bookings: 4,
      costPerBooking: 43.63,
      source: "media sync",
    });
    expect(w?.bookingsWhy).toBeUndefined();
    // Every campaign that spent or booked, the stopped one with its booking and no spend.
    expect(w?.campaigns).toEqual([
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
    ]);
    expect(w?.campaigns.reduce((s, c) => s + c.spend, 0)).toBeCloseTo(
      w?.spend ?? 0,
      2,
    );
  });

  test("bookings read but never placed on campaigns: the client's count stands, each campaign's is null, never 0", () => {
    // A client tied to its rows only by the account's id is asked for its
    // bookings after placeBookings has run (calculator.ts, syncOnce).
    const w = week({ placedClients: new Set<string>() }).get(
      normalize(ATLANTIS),
    );
    expect(w).toMatchObject({ bookings: 4, costPerBooking: 43.63 });
    expect(w?.campaigns.map(c => [c.campaignName, c.bookings])).toEqual([
      ["Atlantis-mahara-7\\10", null],
      ["Atlantis-mahara-19\\10", null],
    ]);
    const placedToo = week({
      placedClients: new Set([normalize(ATLANTIS)]),
    }).get(normalize(ATLANTIS));
    expect(placedToo?.campaigns.map(c => c.bookings)).toEqual([3, 0, 1]);
  });

  test("show counts read the marked meetings only, and due counts the meetings already past", () => {
    const w = week().get(normalize(ATLANTIS));
    // Nothing marked yet: 0 of 0, so a screen says "not marked yet", never "0% show".
    expect([w?.showed, w?.noShows, w?.due]).toEqual([0, 0, 3]);
    const SHADES = "Shades Interior Design & General Contracting";
    const shades = clientWeeks({
      since7,
      until7,
      now,
      grain: [
        day(
          "Shades|mahara|17\\10",
          SHADES,
          "2026-10-18",
          44.67,
          6,
          "s2",
          "762687672022667",
        ),
      ],
      clients: [
        { name: SHADES, accounts: ["762687672022667"], dwy: false, ghl: true },
      ],
      mahara,
      live,
      events: new Map([
        [
          normalize(SHADES),
          [
            booking(
              "A5kG3rtyxVjHCvBVqSL8",
              "2026-10-18",
              "2026-10-19T13:30:00+03:00",
              "noshow",
            ),
            booking(
              "lMuPZRxMeWgDOdqWGAXd",
              "2026-10-19",
              "2026-10-21T11:00:00+03:00",
              "showed",
            ),
            booking(
              "KByGZVF3Yx5ladI4b3LS",
              "2026-10-20",
              "2026-10-21T14:00:00+03:00",
            ),
            booking(
              "q08FfmezYszYWFAETBch",
              "2026-10-20",
              "2026-10-23T16:00:00+03:00",
            ),
          ],
        ],
      ]),
      placed: [],
    }).get(normalize(SHADES));
    // 1 showed of 2 marked: 50%, the board's client rule.
    expect([
      shades?.bookings,
      shades?.showed,
      shades?.noShows,
      shades?.due,
    ]).toEqual([4, 1, 1, 3]);
  });

  test("one Meta ad on one day counts once: the Shades rename repeated $70.00", () => {
    const SHADES = "Shades";
    const rows = [
      day(
        "Shades|mahara|14\\10",
        SHADES,
        "2026-10-14",
        9.94,
        1,
        "120250793408950703",
        "762687672022667",
      ),
      day(
        "Shades|mahara|17\\10",
        SHADES,
        "2026-10-14",
        9.94,
        1,
        "120250793408950703",
        "762687672022667",
      ),
      day(
        "Shades|mahara|14\\10",
        SHADES,
        "2026-10-16",
        23.12,
        1,
        "120250793408950703",
        "762687672022667",
      ),
      day(
        "Shades|mahara|17\\10",
        SHADES,
        "2026-10-16",
        23.37,
        1,
        "120250793408950703",
        "762687672022667",
      ),
      day(
        "Shades|mahara|17\\10",
        SHADES,
        "2026-10-18",
        44.67,
        6,
        "120250846587690703",
        "762687672022667",
      ),
    ];
    const w = clientWeeks({
      since7,
      until7,
      now,
      grain: rows,
      clients: [{ name: SHADES, accounts: [], dwy: false, ghl: true }],
      mahara,
      live,
      events: new Map([[normalize(SHADES), []]]),
      placed: [],
    }).get(normalize(SHADES));
    // The live campaign's read wins: 9.94 + 23.37 + 44.67.
    expect(w?.spend).toBe(77.98);
    expect(w?.campaigns.map(c => c.campaignName)).toEqual([
      "Shades|mahara|17\\10",
    ]);
    expect(w?.costPerBooking).toBeNull();
    expect(w?.bookings).toBe(0);
  });

  test("spend off the board is named apart, never in the cost: SAFAD $15.71 / 2 = $7.86", () => {
    const SAFAD = "SAFAD Consultant Engineering";
    const w = clientWeeks({
      since7,
      until7,
      now,
      grain: [
        day(
          "Safad | MAHARA | 16-8",
          SAFAD,
          "2026-10-14",
          9.93,
          2,
          "s1",
          "774492648699300",
        ),
        day(
          "Safad | MAHARA | 16-8",
          SAFAD,
          "2026-10-19",
          5.78,
          1,
          "s1",
          "774492648699300",
        ),
        // An outsider's campaign on the client's account, no card on the board.
        day(
          "New Engagement Campaign",
          SAFAD,
          "2026-10-14",
          300.0,
          0,
          "x1",
          "774492648699300",
        ),
        day(
          "New Engagement Campaign",
          SAFAD,
          "2026-10-15",
          75.09,
          0,
          "x1",
          "774492648699300",
        ),
      ],
      clients: [
        { name: SAFAD, accounts: ["774492648699300"], dwy: false, ghl: true },
      ],
      mahara,
      live,
      events: new Map([
        [
          normalize(SAFAD),
          [
            booking(
              "NWlahmUkkeg9gqpMPKVm",
              "2026-10-15",
              "2026-10-16T12:00:00+03:00",
              "noshow",
            ),
            booking(
              "MxRYJYyO64JjX7lL7kMc",
              "2026-10-20",
              "2026-10-22T12:00:00+03:00",
            ),
          ],
        ],
      ]),
      placed: [
        placed(SAFAD, "Safad | MAHARA | 16-8", "2026-10-15"),
        placed(SAFAD, "Safad | MAHARA | 16-8", "2026-10-20"),
      ],
    }).get(normalize(SAFAD));
    expect(w).toMatchObject({
      spend: 15.71,
      offBoardSpend: 375.09,
      leads: 3,
      bookings: 2,
      costPerBooking: 7.86,
    });
    expect(w?.campaigns.map(c => c.campaignName)).toEqual([
      "Safad | MAHARA | 16-8",
    ]);
  });

  test("SAFAD's outsider ads are on the compromise list (20261023p): left out, never off board: $15.71 / 2 = $7.86", () => {
    // The real ids (CEO, 23 Oct 2026, D0a): Mercedes Garcia's ad 120254791600360066 spent
    // $228.26 on 14 Oct and $146.83 on 15 Oct under "New Engagement Campaign"; Lucas J Ortiz's
    // ad 120254896955290066 has no spend. Once listed, the $375.09 is not "off board": it
    // leaves the week, as every listed ad does.
    const SAFAD = "SAFAD Consultant Engineering";
    const w = clientWeeks({
      since7,
      until7,
      now,
      grain: [
        day(
          "Safad | MAHARA | 16-8",
          SAFAD,
          "2026-10-14",
          9.93,
          2,
          "s1",
          "774492648699300",
        ),
        day(
          "Safad | MAHARA | 16-8",
          SAFAD,
          "2026-10-19",
          5.78,
          1,
          "s1",
          "774492648699300",
        ),
        day(
          "New Engagement Campaign",
          SAFAD,
          "2026-10-14",
          228.26,
          0,
          "120254791600360066",
          "774492648699300",
        ),
        day(
          "New Engagement Campaign",
          SAFAD,
          "2026-10-15",
          146.83,
          0,
          "120254791600360066",
          "774492648699300",
        ),
        day(
          "New Engagement Campaign",
          SAFAD,
          "2026-10-20",
          0,
          0,
          "120254896955290066",
          "774492648699300",
        ),
      ],
      clients: [
        { name: SAFAD, accounts: ["774492648699300"], dwy: false, ghl: true },
      ],
      mahara,
      live,
      events: new Map([
        [
          normalize(SAFAD),
          [
            booking(
              "NWlahmUkkeg9gqpMPKVm",
              "2026-10-15",
              "2026-10-16T12:00:00+03:00",
              "noshow",
            ),
            booking(
              "MxRYJYyO64JjX7lL7kMc",
              "2026-10-20",
              "2026-10-22T12:00:00+03:00",
            ),
          ],
        ],
      ]),
      placed: [
        placed(SAFAD, "Safad | MAHARA | 16-8", "2026-10-15"),
        placed(SAFAD, "Safad | MAHARA | 16-8", "2026-10-20"),
      ],
    }).get(normalize(SAFAD));
    expect(w).toMatchObject({
      spend: 15.71,
      offBoardSpend: 0,
      leads: 3,
      bookings: 2,
      costPerBooking: 7.86,
    });
    expect(w?.campaigns.map(c => c.campaignName)).toEqual([
      "Safad | MAHARA | 16-8",
    ]);
  });

  test("ads on the compromise list never count, even under a Mahara campaign", () => {
    const KHALIDA = "Khalida";
    const w = clientWeeks({
      since7,
      until7,
      now,
      grain: [
        day(
          "khalida-14\\10",
          KHALIDA,
          "2026-10-15",
          80.27,
          6,
          "k1",
          "1275190574533155",
        ),
        day(
          "khalida-14\\10",
          KHALIDA,
          "2026-10-15",
          70.99,
          0,
          "120247012327250088",
          "1275190574533155",
        ),
      ],
      clients: [
        {
          name: KHALIDA,
          accounts: ["1275190574533155", "1839126900588107"],
          dwy: false,
          ghl: true,
        },
      ],
      mahara: new Set(["khalida-14\\10"]),
      live: new Set(["khalida-14\\10"]),
      events: new Map([
        [
          normalize(KHALIDA),
          [booking("k", "2026-10-17", "2026-10-18T10:00:00+03:00")],
        ],
      ]),
      placed: [],
    }).get(normalize(KHALIDA));
    expect(w).toMatchObject({
      spend: 80.27,
      bookings: 1,
      costPerBooking: 80.27,
      accounts: ["1275190574533155", "1839126900588107"],
    });
  });

  test("bookings that cannot be known read null with the reason, never 0", () => {
    const name = "Client";
    const grain = [day("c", name, "2026-10-15", 50, 5, "c1", "111111")];
    const base = {
      since7,
      until7,
      now,
      grain,
      mahara: new Set(["c"]),
      live: new Set(["c"]),
      placed: [],
    };
    const one = (
      client: { dwy: boolean; ghl: boolean },
      events: Map<string, BookingEvent[] | undefined>,
      eventsWhy?: Map<string, string>,
    ) =>
      clientWeeks({
        ...base,
        clients: [{ name, accounts: ["111111"], ...client }],
        events,
        eventsWhy,
      }).get(normalize(name));
    const cases = [
      [one({ dwy: true, ghl: true }, new Map()), BOOKINGS_WHY.dwy],
      [one({ dwy: false, ghl: false }, new Map()), BOOKINGS_WHY.noGhl],
      [one({ dwy: false, ghl: true }, new Map()), BOOKINGS_WHY.notAsked],
      [
        one({ dwy: false, ghl: true }, new Map([[normalize(name), undefined]])),
        BOOKINGS_WHY.readFailed,
      ],
      [
        one(
          { dwy: false, ghl: true },
          new Map([[normalize(name), undefined]]),
          new Map([[normalize(name), BOOKINGS_WHY.noCalendar]]),
        ),
        BOOKINGS_WHY.noCalendar,
      ],
    ] as const;
    for (const [w, why] of cases) {
      expect(w).toMatchObject({
        spend: 50,
        leads: 5,
        bookings: null,
        bookingsWhy: why,
        costPerBooking: null,
        showed: null,
        noShows: null,
        due: null,
      });
      expect(w?.campaigns[0].bookings).toBeNull();
    }
  });

  test("a client with no ad account gets no week; one with an account and no spend reads $0 spend, never a cost", () => {
    const out = clientWeeks({
      since7,
      until7,
      now,
      grain: [],
      mahara,
      live,
      placed: [],
      clients: [
        { name: "No account", accounts: [], dwy: false, ghl: true },
        {
          name: "ARCWANI",
          accounts: ["1034584029438250"],
          dwy: false,
          ghl: true,
        },
      ],
      events: new Map([[normalize("ARCWANI"), []]]),
    });
    expect(out.has(normalize("No account"))).toBe(false);
    expect(out.get(normalize("ARCWANI"))).toMatchObject({
      spend: 0,
      bookings: 0,
      costPerBooking: null,
      campaigns: [],
    });
  });

  test("the week is found by the ClickUp card first, then by the client's name", () => {
    const byName = week();
    const w = byName.get(normalize(ATLANTIS));
    if (!w) throw new Error("Atlantis has a week");
    const weeks: ClientWeeks = {
      byTask: new Map([["86eyjkdc8", w]]),
      byName,
      campaignAccount: new Map(),
      accountClient: new Map(),
      mahara,
    };
    expect(clientWeekFor(weeks, "86eyjkdc8", "Another name")).toBe(w);
    expect(clientWeekFor(weeks, undefined, "Atlantis Contracting")).toBe(w);
    expect(clientWeekFor(weeks, "other-card", "Nobody")).toBeUndefined();
    expect(clientWeekFor(undefined, "86eyjkdc8", ATLANTIS)).toBeUndefined();
    // The profile carries it as ads7d, or no key at all.
    expect(clientWeekOf(weeks, "86eyjkdc8", "x")).toEqual({ ads7d: w });
    expect(clientWeekOf(undefined, "86eyjkdc8", "x")).toEqual({});
  });
});

describe("the CSM history by the client's ad accounts (R8)", () => {
  const at = Date.parse("2026-10-21T09:00:00Z");
  const row = (
    campaignName: string,
    date: string,
    spend: number,
    leads: number,
    metaAdId: string,
    accountId?: string,
  ) => ({
    campaignName,
    date,
    spend,
    leads,
    metaAdId,
    adName: metaAdId,
    adSetName: "Set",
    ...(accountId ? { accountId } : {}),
  });
  const owners = {
    campaignAccount: new Map([
      ["ARCWANI-MAHARA-29\\8", "1034584029438250"],
      ["CASTELLO-MAHARA-28\\9", "2140901837311419"],
      ["Shades AI Video Engagement", "762687672022667"],
    ]),
    accountClient: new Map([
      ["1034584029438250", "ARCWANI"],
      ["2140901837311419", "Castello Industries"],
      ["762687672022667", "Shades"],
    ]),
    mahara: new Set([
      "ARCWANI-MAHARA-29\\8",
      "CASTELLO-MAHARA-28\\9",
      "CASTELLO-MAHARA-6\\10",
      "Shades|mahara|17\\10",
      "Shades|mahara|14\\10",
    ]),
  };
  const listed = [
    {
      campaignName: "CASTELLO-MAHARA-6\\10",
      clientName: "Castello Industries",
    },
    { campaignName: "Shades|mahara|17\\10", clientName: "Shades" },
  ];
  const history = [
    row("ARCWANI-MAHARA-29\\8", "2026-10-03", 20.2, 3, "w1"),
    row("CASTELLO-MAHARA-28\\9", "2026-10-03", 27.31, 2, "c1"),
    row("CASTELLO-MAHARA-6\\10", "2026-10-07", 40, 4, "c2", "2140901837311419"),
    row("Shades|mahara|14\\10", "2026-10-14", 9.94, 1, "sh1"),
    row(
      "Shades|mahara|17\\10",
      "2026-10-14",
      9.94,
      1,
      "sh1",
      "762687672022667",
    ),
    // The client's own pre-launch campaign: not Mahara's.
    row(
      "Shades AI Video Engagement",
      "2026-10-03",
      90.07,
      0,
      "own1",
      "762687672022667",
    ),
    // On the compromise list.
    row(
      "CASTELLO-MAHARA-6\\10",
      "2026-10-07",
      58.57,
      0,
      "120250765528850269",
      "2140901837311419",
    ),
  ];
  test("a stopped campaign's days stay the client's; the client's own, outsiders' and repeats stay out", () => {
    const all = Object.fromEntries(
      adLeadsByClient(listed, history, at, owners).map(r => [r.key, r]),
    );
    expect(adLeadsFor("ARCWANI", all)?.daily).toEqual([
      { date: "2026-10-03", leads: 3, spend: 20.2 },
    ]);
    expect(adLeadsFor("Castello Industries", all)?.daily).toEqual([
      { date: "2026-10-03", leads: 2, spend: 27.31 },
      { date: "2026-10-07", leads: 4, spend: 40 },
    ]);
    expect(adLeadsFor("Shades", all)?.daily).toEqual([
      { date: "2026-10-14", leads: 1, spend: 9.94 },
    ]);
    expect(adLeadsFor("Shades", all)?.spendMonth).toBe(9.94);
  });
  test("a campaign stopped before the 30 days finds its client by the account cockpit_campaigns stored", () => {
    // A campaign that last spent before this run's 30 days: no row of this
    // run names its account, and its stored rows carry no accountId (they
    // predate it). The account id here is made up.
    const accounts = campaignAccounts(
      [
        {
          campaignName: "CASTELLO-MAHARA-6\\10",
          accountId: "act_2140901837311419",
        },
        { campaignName: "CASTELLO-MAHARA-6\\10", accountId: undefined },
      ],
      new Map<string, string | undefined>([
        ["Liwan |MAHARA|10\\9", "1462315881698960"],
        // This run's rows win over the stored account.
        ["CASTELLO-MAHARA-6\\10", "999"],
        ["Never stored an account", undefined],
      ]),
    );
    expect([...accounts]).toEqual([
      ["CASTELLO-MAHARA-6\\10", "2140901837311419"],
      ["Liwan |MAHARA|10\\9", "1462315881698960"],
    ]);
    const all = Object.fromEntries(
      adLeadsByClient(
        [],
        [row("Liwan |MAHARA|10\\9", "2026-09-20", 31.4, 2, "l1")],
        at,
        {
          campaignAccount: accounts,
          accountClient: new Map([["1462315881698960", "Liwan"]]),
          mahara: new Set(["Liwan |MAHARA|10\\9"]),
        },
      ).map(r => [r.key, r]),
    );
    expect(adLeadsFor("Liwan", all)?.daily).toEqual([
      { date: "2026-09-20", leads: 2, spend: 31.4 },
    ]);
    expect(adLeadsFor("Liwan", all)?.lastMonth).toBe(2);
  });
  test("without the sync's accounts the listed campaigns decide, as before", () => {
    const all = Object.fromEntries(
      adLeadsByClient(listed, history, at).map(r => [r.key, r]),
    );
    expect(adLeadsFor("ARCWANI", all)).toBeUndefined();
    expect(adLeadsFor("Castello Industries", all)?.daily).toEqual([
      { date: "2026-10-07", leads: 4, spend: 40 },
    ]);
  });
});

describe("why a client's bookings could not be read", () => {
  const inNative = <T>(
    fetch: (url: string) => Promise<Response>,
    fn: () => Promise<T>,
  ) => {
    const reads: Reads = {
      graph: async () => ({}),
      tool: async () => null,
      fetch,
      log: () => {},
    };
    return withNativeContext(reads, { receipts: [] }, fn);
  };
  test("a refused calendar list is a failed read; no booking calendar is said apart", async () => {
    const told: string[] = [];
    expect(
      await inNative(
        async () => new Response("", { status: 401 }),
        () =>
          ghlBookingEvents("loc", "pit-x", undefined, why => told.push(why)),
      ),
    ).toBeUndefined();
    expect(
      await inNative(
        async () =>
          Response.json({
            calendars: [
              { id: "q", name: "Project Review & Qualification Call" },
            ],
          }),
        () =>
          ghlBookingEvents("loc", "pit-x", undefined, why => told.push(why)),
      ),
    ).toBeUndefined();
    expect(
      await inNative(
        async () => {
          throw new Error("socket");
        },
        () =>
          ghlBookingEvents("loc", "pit-x", undefined, why => told.push(why)),
      ),
    ).toBeUndefined();
    expect(told).toEqual(["read", "calendar", "read"]);
  });
});

// The review of build 2 (22 Oct 2026): each fault below once published a
// wrong client figure as a known one.
describe("a short read is never a known count", () => {
  const inNative = <T>(
    fetch: (url: string) => Promise<Response>,
    fn: () => Promise<T>,
  ) => {
    const reads: Reads = {
      graph: async () => ({}),
      tool: async () => null,
      fetch,
      log: () => {},
    };
    return withNativeContext(reads, { receipts: [] }, fn);
  };
  const ghl =
    (pastStatus: number, events: Record<string, unknown>[]) =>
    async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/calendars/")
        return Response.json({
          calendars: [{ id: "main", name: "Main Appointment Calendar" }],
        });
      if (u.pathname === "/calendars/events") {
        const past = Number(u.searchParams.get("startTime")) < Date.now() - 1;
        if (past && pastStatus !== 200)
          return new Response("", { status: pastStatus });
        return Response.json({ events: past ? events : [] });
      }
      if (u.pathname === "/opportunities/search")
        return Response.json({ opportunities: [] });
      return new Response("", { status: 404 });
    };
  const made = (id: string, appointmentStatus: string) => ({
    id,
    contactId: `c-${id}`,
    startTime: new Date(Date.now() - 86400000).toISOString(),
    dateAdded: "2026-10-18T09:00:00Z",
    appointmentStatus,
  });

  test("one refused events request makes the client's bookings unknown, not fewer: Ocean's 9 never read as 0 on $235.87", async () => {
    const told: string[] = [];
    const nine = Array.from({ length: 9 }, (_, i) =>
      made(`o${i}`, "confirmed"),
    );
    expect(
      await inNative(ghl(500, nine), () =>
        ghlBookingEvents("loc", "pit-x", undefined, why => told.push(why)),
      ),
    ).toBeUndefined();
    expect(
      await inNative(ghl(429, nine), () =>
        ghlBookingEvents("loc", "pit-x", undefined, why => told.push(why)),
      ),
    ).toBeUndefined();
    expect(told).toEqual(["read", "read"]);
    // Both asks answered: all nine count.
    const read = await inNative(ghl(200, nine), () =>
      ghlBookingEvents("loc", "pit-x"),
    );
    expect(read?.length).toBe(9);
    // The week then says why, never 0 on the spend.
    const w = clientWeeks({
      since7,
      until7,
      now,
      grain: [day("Ocean-mahara", "Ocean", "2026-10-15", 235.87, 20, "o1")],
      clients: [{ name: "Ocean", accounts: ["111"], dwy: false, ghl: true }],
      mahara: new Set(["Ocean-mahara"]),
      live: new Set(["Ocean-mahara"]),
      events: new Map([[normalize("Ocean"), undefined]]),
      eventsWhy: new Map([[normalize("Ocean"), BOOKINGS_WHY.readFailed]]),
      placed: [],
    }).get(normalize("Ocean"));
    expect(w).toMatchObject({
      spend: 235.87,
      bookings: null,
      bookingsWhy: BOOKINGS_WHY.readFailed,
      costPerBooking: null,
    });
  });

  test("cancelled and invalid bookings never count, as on the board", async () => {
    const read = await inNative(
      ghl(200, [
        made("kept", "confirmed"),
        made("showed", "showed"),
        made("gone", "cancelled"),
        made("bad", "invalid"),
        made("bad2", "Invalid"),
      ]),
      () => ghlBookingEvents("loc", "pit-x"),
    );
    expect(read?.map(e => e.eventId).sort()).toEqual(["kept", "showed"]);
  });
});

describe("Meta's fill failed: a client whose account was not read gets no week", () => {
  test("only the accounts the fill would have read are unknown", () => {
    const grain = [
      { accountId: "290802986", date: "2026-10-20" },
      { accountId: "762687672022667", date: "2026-10-12" },
      { accountId: undefined, date: "2026-10-20" },
    ];
    // Sheet up to date (ends 20 Oct, read 22 Oct): Atlantis's rows reach the
    // day before yesterday; Shades' stopped on 12 Oct and City Wood's account
    // is read from Meta only, so neither is known this run.
    expect([
      ...accountsNotRead(
        grain,
        ["290802986", "762687672022667", "1185571679865085"],
        "2026-10-20",
        "2026-10-20",
      ),
    ]).toEqual(["762687672022667", "1185571679865085"]);
    // The whole sheet two days behind: the window ends on its last day, and an
    // account with a row on that day is read.
    expect([
      ...accountsNotRead(grain, ["290802986"], "2026-10-20", "2026-10-21"),
    ]).toEqual([]);
  });

  test("City Wood read from Meta only: no week instead of $0 and a false reason; Atlantis keeps its week", () => {
    const CITY = "City Wood";
    const out = week({
      clients: [
        { name: ATLANTIS, accounts: ["290802986"], dwy: false, ghl: true },
        { name: CITY, accounts: ["1185571679865085"], dwy: false, ghl: true },
      ],
      unread: new Set(["1185571679865085"]),
    });
    expect(out.has(normalize(CITY))).toBe(false);
    expect(out.get(normalize(ATLANTIS))).toMatchObject({
      spend: 174.53,
      bookings: 4,
      costPerBooking: 43.63,
    });
    // The same week with the fill read: City Wood spent nothing in the rows
    // given here, and reads $0 with no cost, never a fake one.
    const read = week({
      clients: [
        { name: CITY, accounts: ["1185571679865085"], dwy: false, ghl: true },
      ],
      events: new Map(),
    }).get(normalize(CITY));
    expect(read).toMatchObject({
      spend: 0,
      bookings: null,
      bookingsWhy: BOOKINGS_WHY.notAsked,
    });
  });
});

describe("bookings with no Mahara spend have no cost per booking", () => {
  test("Marble 29 Sep to 5 Oct: 2 bookings on $0 of Mahara's spend reads null with the reason, never $0.00", () => {
    const MARBLE = "Marble";
    const w = clientWeeks({
      since7: "2026-09-29",
      until7: "2026-10-05",
      now: Date.parse("2026-10-07T09:00:00Z"),
      grain: [
        // The client's own campaign, no card: off the board, not Mahara's.
        day("Marble own", MARBLE, "2026-10-01", 90.07, 0, "m9", "555"),
      ],
      clients: [{ name: MARBLE, accounts: ["555"], dwy: false, ghl: true }],
      mahara: new Set(["Marble-mahara-1\\9"]),
      live: new Set<string>(),
      events: new Map([
        [
          normalize(MARBLE),
          [
            booking("m1", "2026-09-30", "2026-10-01T10:00:00+03:00"),
            booking("m2", "2026-10-02", "2026-10-03T10:00:00+03:00"),
          ],
        ],
      ]),
      placed: [],
    }).get(normalize(MARBLE));
    expect(w).toMatchObject({
      spend: 0,
      offBoardSpend: 90.07,
      bookings: 2,
      costPerBooking: null,
      costPerBookingWhy: COST_PER_BOOKING_WHY.noSpend,
    });
    // With spend the figure is the cost, and no reason rides along.
    const a = week().get(normalize(ATLANTIS));
    expect(a?.costPerBooking).toBe(43.63);
    expect(a?.costPerBookingWhy).toBeUndefined();
  });
});

describe("a daily row's ad account when two accounts share a name", () => {
  const visible = new Set([
    "1275190574533155",
    "1839126900588107",
    "718146936708597",
    "290802986",
  ]);
  const khalida = ["1275190574533155", "1839126900588107"];
  test("Khalida's two \"منشآت خالدة\": each row gets its campaign's own account, never the other's", () => {
    expect(
      resolveAccountId("منشآت خالدة", khalida, "act_1839126900588107", visible),
    ).toBe("1839126900588107");
    expect(
      resolveAccountId("منشآت خالدة", khalida, "1275190574533155", visible),
    ).toBe("1275190574533155");
    // The campaign's account is unknown, or another account: none, not a guess.
    expect(
      resolveAccountId("منشآت خالدة", khalida, undefined, visible),
    ).toBeUndefined();
    expect(
      resolveAccountId("منشآت خالدة", khalida, "290802986", visible),
    ).toBeUndefined();
  });
  test("one account under the name, an id written in the name, or a name Meta does not show", () => {
    expect(
      resolveAccountId("Atlantis", ["290802986"], "999999999", visible),
    ).toBe("290802986");
    expect(
      resolveAccountId("718146936708597, SAR", [], undefined, visible),
    ).toBe("718146936708597");
    expect(resolveAccountId("Gone account", [], "act_424242", visible)).toBe(
      "424242",
    );
    expect(
      resolveAccountId("Old 9876543210", [], "424242", new Set<string>()),
    ).toBe("9876543210");
    expect(resolveAccountId("", [], undefined, visible)).toBeUndefined();
  });
});

describe("the CSM history finds a client by its board card", () => {
  test("Atlantis-mahara-30\\8, stopped before cockpit_campaigns and accountId: its 12 to 14 Sep days are Atlantis's", () => {
    const at = Date.parse("2026-10-21T09:00:00Z");
    const cards = new Map([
      [normalize("Atlantis-mahara-30\\8"), ATLANTIS],
      [normalize("JOE&SERA|MHARA|11\\8"), "Joe and Sera Company"],
    ]);
    const owners = {
      campaignAccount: new Map<string, string>(),
      accountClient: new Map([["290802986", ATLANTIS]]),
      mahara: new Set(["Atlantis-mahara-7\\10"]),
      cardClient: (name: string) => cards.get(normalize(name)),
    };
    const row = (
      campaignName: string,
      date: string,
      spend: number,
      leads: number,
      accountId?: string,
    ) => ({
      campaignName,
      date,
      spend,
      leads,
      metaAdId: `${campaignName}-${date}`,
      ...(accountId ? { accountId } : {}),
    });
    const all = Object.fromEntries(
      adLeadsByClient(
        [],
        [
          row("Atlantis-mahara-30\\8", "2026-09-12", 30.0, 1),
          row("Atlantis-mahara-30\\8", "2026-09-13", 25.5, 0),
          row("Atlantis-mahara-30\\8", "2026-09-14", 21.23, 0),
          row("Atlantis-mahara-7\\10", "2026-10-15", 46.17, 0, "290802986"),
          row("JOE&SERA|MHARA|11\\8", "2026-08-20", 203.06, 11),
          // No card, no account, never Mahara's: stays out.
          row("Someone's own campaign", "2026-09-12", 50, 0),
        ],
        at,
        owners,
      ).map(r => [r.key, r]),
    );
    const a = adLeadsFor(ATLANTIS, all);
    expect(a?.daily.map((d: { spend: number }) => d.spend)).toEqual([
      30, 25.5, 21.23, 46.17,
    ]);
    expect(a?.lastMonth).toBe(1);
    expect(adLeadsFor("Joe and Sera Company", all)?.allTime).toBe(11);
    expect(
      Object.values(all).some((r: { campaigns: string[] }) =>
        r.campaigns.includes("Someone's own campaign"),
      ),
    ).toBe(false);
  });
});

describe("a fault in the 7 days never stops the publish", () => {
  test("a throw while building them publishes none, with an error line", async () => {
    const said: string[] = [];
    const reads: Reads = {
      graph: async () => ({}),
      tool: async () => null,
      fetch: async () => new Response(""),
      log: (level, args) => said.push(`${level}: ${args.join(" ")}`),
    };
    const out = await withNativeContext(reads, { receipts: [] }, () =>
      weeksOrNone(async () => {
        throw new Error("unexpected row");
      }),
    );
    expect(out).toBeUndefined();
    expect(said).toEqual([
      "error: client weeks failed, published without ads7d (readers fall back): Error: unexpected row",
    ]);
    const built = week();
    const weeks: ClientWeeks = {
      byTask: new Map(),
      byName: built,
      campaignAccount: new Map(),
      accountClient: new Map(),
      mahara,
    };
    expect(
      await withNativeContext(reads, { receipts: [] }, () =>
        weeksOrNone(async () => weeks),
      ),
    ).toBe(weeks);
  });
});
