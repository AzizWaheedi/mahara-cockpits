/**
 * A client's page counts the client, not the campaigns still listed (R8,
 * the cost per booking build of 22 Oct 2026). The totals come from
 * `cockpit_media_client_range` (20261022x): Mahara's campaigns on the
 * client's ad accounts, stopped ones included, with the Client Performance
 * board's confirmed bookings for the same days. The figures below are the
 * audit's for 1 to 20 Oct (docs/client-performance/CPB-AUDIT-20261021.md
 * section 1), read again from the live media data on 22 Oct: Khalida's
 * listed campaigns read $91.62 where the client spent $191.53, and ARCWANI
 * and Liwan, every campaign stopped, could not be opened.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountKey,
  adAccountsParam,
  campaignsNotListed,
  clientCpb,
  clientPagePlan,
  clientRangeNotes,
  clientRowFor,
  clientsWithoutCampaigns,
  countedLine,
  countedSpan,
  countedTo,
  countsDays,
  nameKey,
  parseAdAccounts,
  parseClientRange,
  readClientRange,
  unlinkedSpend,
} from "../src/lib/clientRange";
import { cpbDisplay } from "../src/lib/costTone";

const KHALIDA = "شركة منشآت خالدة للاستشارات الهندسية";

/** One client row as the function returns it (contract section 2.5). */
const row = (over: Record<string, unknown>) => ({
  clickupId: "86ex0000",
  locationId: "loc",
  name: "Client",
  serviceMode: "DFY",
  status: "Active",
  accounts: [],
  spend: 0,
  leads: 0,
  offBoardSpend: 0,
  excludedSpend: 0,
  campaigns: [],
  bookings: 0,
  days: 20,
  storedDays: 20,
  mediaBookings: 0,
  costPerBooking: null,
  why: null,
  ...over,
});

/** 1 to 20 Oct as read on 21 Oct (D0a not listed). */
const mtd = {
  from: "2026-10-01",
  to: "2026-10-21",
  through: "2026-10-20",
  throughSource: "media sync",
  clients: [
    row({
      clickupId: "86ey2em6q",
      name: KHALIDA,
      accounts: ["1275190574533155", "1839126900588107"],
      spend: 191.53,
      leads: 8,
      bookings: 1,
      mediaBookings: 1,
      costPerBooking: 191.53,
      campaigns: [
        {
          campaignName: "‎‎منشاءت الخالده-mahara‎ – 14\\10‎",
          spend: 80.27,
          leads: 6,
          bookings: 1,
          live: true,
        },
        {
          campaignName: "monshaat-mahara-20\\10",
          spend: 11.35,
          leads: 0,
          bookings: 0,
          live: true,
        },
        {
          campaignName: "منشاءت الخالده-mahara",
          spend: 58.34,
          leads: 0,
          bookings: 0,
          live: false,
        },
        {
          campaignName: "‎منشاءت الخالده-mahara‎ – 4\\10",
          spend: 41.57,
          leads: 2,
          bookings: 0,
          live: false,
        },
      ],
    }),
    row({
      clickupId: "86eynfnv5",
      name: "Castello Industries",
      accounts: ["1557828282750961", "2140901837311419"],
      spend: 667.65,
      leads: 66,
      bookings: 2,
      mediaBookings: 2,
      costPerBooking: 333.83,
      campaigns: [
        {
          campaignName: "CASTELLO-MAHARA-6\\10",
          spend: 537.98,
          leads: 59,
          bookings: 1,
          live: true,
        },
        {
          campaignName: "CASTELLO-MAHARA-28\\9",
          spend: 86.55,
          leads: 1,
          bookings: 0,
          live: false,
        },
        {
          campaignName: "CASTELLO-MAHARA-19\\10",
          spend: 43.12,
          leads: 6,
          bookings: 0,
          live: true,
        },
      ],
    }),
    row({
      clickupId: "86ey8w5m1",
      name: "ARCWANI",
      accounts: ["1034584029438250"],
      spend: 151.4,
      leads: 6,
      bookings: 1,
      mediaBookings: 1,
      costPerBooking: 151.4,
      campaigns: [
        {
          campaignName: "ARCWANI-MAHARA-29\\8",
          spend: 151.4,
          leads: 6,
          bookings: 1,
          live: false,
        },
      ],
    }),
    row({
      clickupId: "86ewvnqj5",
      name: "Liwan Limited Construction and Finishing Of Buildings",
      accounts: ["1938709086836136"],
      spend: 194.58,
      leads: 8,
      bookings: 1,
      mediaBookings: 1,
      costPerBooking: 194.58,
    }),
    row({
      clickupId: "86ex4m5ux",
      name: "نهوض نجد",
      serviceMode: "DWY",
      accounts: ["1326793265986543"],
      spend: 533.33,
      leads: 41,
      bookings: null,
      mediaBookings: null,
      why: "Done with you: the client books its own meetings.",
    }),
    row({
      clickupId: "z8xmdvfpyw",
      name: "Shades Interior Design & General Contracting",
      accounts: ["762687672022667"],
      spend: 203.64,
      leads: 24,
      offBoardSpend: 90.07,
      bookings: 4,
      mediaBookings: 4,
      costPerBooking: 50.91,
    }),
    row({
      clickupId: "86ewvnqgz",
      name: "SAFAD Consultant Engineering",
      accounts: ["774492648699300"],
      spend: 308.69,
      leads: 27,
      offBoardSpend: 375.1,
      bookings: 3,
      mediaBookings: 3,
      costPerBooking: 102.9,
    }),
    row({
      clickupId: "86eyjkdc8",
      name: "Atlantis Contracting",
      accounts: ["290802986"],
      spend: 559.78,
      leads: 24,
      bookings: 5,
      mediaBookings: 5,
      costPerBooking: 111.96,
    }),
  ],
  unmatched: [],
};

describe("the read's shape", () => {
  test("parses the contract's shape and keeps null as null", () => {
    const read = parseClientRange(mtd);
    expect(read.through).toBe("2026-10-20");
    expect(read.clients).toHaveLength(8);
    const dwy = read.clients.find(c => c.serviceMode === "DWY");
    expect(dwy?.bookings).toBeNull();
    expect(dwy?.mediaBookings).toBeNull();
    expect(dwy?.costPerBooking).toBeNull();
    // A numeric string from Postgres reads as its number; garbage is null.
    const odd = parseClientRange({
      ...mtd,
      clients: [row({ spend: "12.50", leads: "x", accounts: ["act_123"] })],
    });
    expect(odd.clients[0].spend).toBe(12.5);
    expect(odd.clients[0].leads).toBeNull();
    expect(odd.clients[0].accounts).toEqual(["123"]);
  });

  test("a wrong shape is an error, never an empty client list", () => {
    expect(() => parseClientRange(null)).toThrow("cannot read");
    expect(() => parseClientRange({ clients: {} })).toThrow("cannot read");
    expect(() => parseClientRange({ ...mtd, from: "1 Oct" })).toThrow(
      "cannot read",
    );
  });

  test("the call sends digits-only accounts, or null for every client", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: mtd, error: null };
      },
    } as unknown as SupabaseClient;
    await readClientRange(client, {
      start: "2026-10-01",
      end: "2026-10-21",
      accounts: ["act_1275190574533155", "1839126900588107", ""],
    });
    await readClientRange(client, { start: "2026-10-01", end: "2026-10-21" });
    expect(calls[0]).toEqual({
      name: "cockpit_media_client_range",
      args: {
        p_start: "2026-10-01",
        p_end: "2026-10-21",
        p_accounts: ["1275190574533155", "1839126900588107"],
      },
    });
    expect(calls[1].args.p_accounts).toBeNull();
    const failing = {
      rpc: async () => ({
        data: null,
        error: { message: "Verified media-buyer access required" },
      }),
    } as unknown as SupabaseClient;
    await expect(
      readClientRange(failing, { start: "2026-10-01", end: "2026-10-21" }),
    ).rejects.toThrow("Verified media-buyer access required");
  });
});

describe("the client page's totals, 1 to 20 Oct", () => {
  const read = parseClientRange(mtd);

  test("Khalida: $191.53 for 1 booking, not the listed campaigns' $91.62", () => {
    const k = clientRowFor(read, {
      name: KHALIDA,
      accounts: ["1839126900588107", "1275190574533155"],
    });
    expect(k?.spend).toBe(191.53);
    expect(
      cpbDisplay(k?.spend, k?.bookings, { cost: k?.costPerBooking }).text,
    ).toBe("$192");
    // The two stopped campaigns are listed last with their numbers.
    const listed = ["‎‎منشاءت الخالده-mahara‎ – 14\\10‎", "monshaat-mahara-20\\10"];
    expect(campaignsNotListed(k, listed).map(c => c.spend)).toEqual([
      58.34, 41.57,
    ]);
  });

  test("Castello: $667.65 / 2 = $333.83, the stopped 28\\9 counted", () => {
    const c = clientRowFor(read, {
      name: "Castello Industries",
      accounts: ["2140901837311419"],
    });
    expect(c?.spend).toBe(667.65);
    expect(c?.bookings).toBe(2);
    expect(
      cpbDisplay(c?.spend, c?.bookings, { cost: c?.costPerBooking }).text,
    ).toBe("$334");
    expect(
      campaignsNotListed(c, [
        "CASTELLO-MAHARA-6\\10",
        "CASTELLO-MAHARA-19\\10",
      ]).map(x => x.campaignName),
    ).toEqual(["CASTELLO-MAHARA-28\\9"]);
  });

  test("Atlantis: $559.78 / 5 = $111.96; نهوض نجد: $533.33, bookings n/a", () => {
    const a = clientRowFor(read, {
      name: "Atlantis Contracting",
      accounts: ["290802986"],
    });
    expect(a?.spend).toBe(559.78);
    expect(a?.costPerBooking).toBe(111.96);
    const n = clientRowFor(read, {
      name: "نهوض نجد",
      accounts: ["1326793265986543"],
    });
    expect(n?.spend).toBe(533.33);
    expect(cpbDisplay(n?.spend, n?.bookings).text).toBe("n/a");
  });

  test("a row is found by a shared account even when the names differ", () => {
    const s = clientRowFor(read, {
      name: "Shades",
      accounts: ["act_762687672022667"],
    });
    expect(s?.clickupId).toBe("z8xmdvfpyw");
    // No account known: by name, any script, punctuation aside.
    expect(clientRowFor(read, { name: "arcwani" })?.spend).toBe(151.4);
    expect(clientRowFor(read, { name: "Nobody" })).toBeUndefined();
    expect(clientRowFor(undefined, { name: "ARCWANI" })).toBeUndefined();
    expect(nameKey("City Wood")).toBe(nameKey("city-wood"));
    expect(accountKey(" act_290802986 ")).toBe("290802986");
  });

  test("Shades and SAFAD say Mahara's campaigns only, with the rest named", () => {
    const shades = clientRowFor(read, {
      name: "Shades",
      accounts: ["762687672022667"],
    });
    expect(shades?.costPerBooking).toBe(50.91);
    const notes = clientRangeNotes(shades as NonNullable<typeof shades>).join(
      " ",
    );
    expect(notes).toContain(
      "Mahara's campaigns only, stopped ones included; the Client Performance board counts the whole ad account.",
    );
    expect(notes).toContain(
      "$90.07 spent on the same ad account outside Mahara's campaigns is left out.",
    );
    expect(notes).toContain("Bookings are the board's confirmed count");
    const safad = clientRowFor(read, {
      name: "SAFAD",
      accounts: ["774492648699300"],
    });
    expect(safad?.costPerBooking).toBe(102.9);
    expect(
      clientRangeNotes(safad as NonNullable<typeof safad>).join(" "),
    ).toContain(
      "$375 spent on the same ad account outside Mahara's campaigns is left out.",
    );
  });

  test("the second source is named only when it disagrees", () => {
    const base = parseClientRange({
      ...mtd,
      clients: [row({ bookings: 4, mediaBookings: 3, excludedSpend: 12.5 })],
    }).clients[0];
    const notes = clientRangeNotes(base).join(" ");
    expect(notes).toContain(
      "The media sync counts 3 for these campaigns and days.",
    );
    expect(notes).toContain(
      "$12.50 on ads on the compromise list is left out.",
    );
    const same = parseClientRange({
      ...mtd,
      clients: [row({ bookings: 4, mediaBookings: 4 })],
    }).clients[0];
    expect(clientRangeNotes(same).join(" ")).not.toContain(
      "The media sync counts",
    );
    // Bookings not stored for some days: the reason is said, never 0.
    const gap = parseClientRange({
      ...mtd,
      clients: [
        row({
          bookings: null,
          why: "Bookings are not stored for 2 of the 20 days.",
        }),
      ],
    }).clients[0];
    expect(clientRangeNotes(gap).join(" ")).toContain(
      "Bookings are not stored for 2 of the 20 days.",
    );
    expect(clientRangeNotes(gap).join(" ")).not.toContain(
      "board's confirmed count",
    );
    // Done with you: no booking figure on the page, so no booking reason.
    const dwy = read.clients.find(c => c.serviceMode === "DWY");
    expect(
      clientRangeNotes(dwy as NonNullable<typeof dwy>, {
        leadsOnly: true,
      }).join(" "),
    ).not.toContain("Done with you");
  });

  test("the page names the day the read stops on, when it is before the end", () => {
    expect(countedTo(read, "2026-10-21")).toBe("2026-10-20");
    expect(countedTo(read, "2026-10-20")).toBeUndefined();
    expect(countedTo(undefined, "2026-10-21")).toBeUndefined();
  });
});

describe("clients with spend and no campaign running here", () => {
  const read = parseClientRange(mtd);
  // The board's Running list on 21 Oct: every client but ARCWANI and Liwan.
  const running = [
    { clientName: KHALIDA, metaAccountId: "1839126900588107" },
    { clientName: "Castello Industries", metaAccountId: "2140901837311419" },
    { clientName: "نهوض نجد", metaAccountId: "1326793265986543" },
    // A card name the board writes differently is matched by its account.
    { clientName: "Shades", metaAccountId: "act_762687672022667" },
    {
      clientName: "SAFAD Consultant Engineering",
      metaAccountId: "774492648699300",
    },
    { clientName: "Atlantis Contracting", metaAccountId: "290802986" },
  ];

  test("ARCWANI and Liwan are listed, biggest spend first, and nobody else", () => {
    const rows = clientsWithoutCampaigns(read, running);
    expect(rows.map(r => r.name)).toEqual([
      "Liwan Limited Construction and Finishing Of Buildings",
      "ARCWANI",
    ]);
    expect(rows.map(r => r.costPerBooking)).toEqual([194.58, 151.4]);
  });

  test("a client with nothing in the range is not listed; no read lists nobody", () => {
    const quiet = parseClientRange({
      ...mtd,
      clients: [row({ name: "Quiet", spend: 0, bookings: 0 })],
    });
    expect(clientsWithoutCampaigns(quiet, [])).toEqual([]);
    expect(clientsWithoutCampaigns(undefined, [])).toEqual([]);
    // Bookings with no spend in the range still list the client.
    const booked = parseClientRange({
      ...mtd,
      clients: [row({ name: "Booked only", spend: 0, bookings: 1 })],
    });
    expect(clientsWithoutCampaigns(booked, [])).toHaveLength(1);
  });
});

// The days the read counts (20261022x): from countedFrom, the first day the
// sources vouch for (24 Sep 2026, the day after the cockpit's campaign list
// was first imported), to the paired day. A range that counts no day has
// every figure null, and the page keeps the campaigns' own reads.
describe("the days counted and the cost the read could not set", () => {
  test("countedFrom is read; a row that counts no day is not the client's figure", () => {
    const ninety = parseClientRange({
      ...mtd,
      from: "2026-07-24",
      countedFrom: "2026-09-24",
      clients: [
        row({
          days: 27,
          why: "The cockpit's campaign list starts on 24 Sep 2026, so spend before it cannot be split into Mahara's campaigns and the client's own; these numbers count from 24 Sep 2026.",
        }),
      ],
    });
    expect(ninety.countedFrom).toBe("2026-09-24");
    expect(countsDays(ninety.clients[0])).toBe(true);
    // Today before the nightly pull: nothing counted, every figure null.
    const today = parseClientRange({
      ...mtd,
      from: "2026-10-21",
      to: "2026-10-21",
      countedFrom: null,
      clients: [
        row({
          spend: null,
          leads: null,
          bookings: null,
          days: null,
          storedDays: null,
          why: "Meta's numbers for these days are not in yet.",
        }),
      ],
    });
    expect(today.countedFrom).toBeNull();
    expect(countsDays(today.clients[0])).toBe(false);
    expect(countsDays(undefined)).toBe(false);
    // An older read without countedFrom still parses.
    expect(parseClientRange(mtd).countedFrom).toBeNull();
  });

  test("bookings and spend with no cost from the read read n/a with its reason", () => {
    const why =
      "Meta holds $133.82 on Mahara's campaigns for days the media data does not have; the spend shown leaves it out, so there is no cost per booking.";
    const short = parseClientRange({
      ...mtd,
      clients: [row({ spend: 58.4, bookings: 1, costPerBooking: null, why })],
    }).clients[0];
    const shown = clientCpb(short);
    expect(shown.text).toBe("n/a");
    expect(shown.tone).toBeUndefined();
    expect(shown.why).toBe(why);
    // The read's own figure, and no booking after spend, as the grid shows it.
    const khalida = parseClientRange({
      ...mtd,
      clients: [row({ spend: 191.53, bookings: 1, costPerBooking: 191.53 })],
    }).clients[0];
    expect(clientCpb(khalida).text).toBe("$192");
    const alkhalil = parseClientRange({
      ...mtd,
      clients: [row({ spend: 233.36, bookings: 0, costPerBooking: null })],
    }).clients[0];
    expect(clientCpb(alkhalil).text).toBe("None on $233");
    expect(clientCpb(alkhalil).noneOnSpend).toBe(true);
    // Bookings not known: n/a, never $0.
    const dwy = parseClientRange({
      ...mtd,
      clients: [row({ spend: 533.33, bookings: null, serviceMode: "DWY" })],
    }).clients[0];
    expect(clientCpb(dwy).text).toBe("n/a");
  });

  test("done with you keeps the days counted and drops only the booking sentences", () => {
    const dwy = parseClientRange({
      ...mtd,
      clients: [
        row({
          serviceMode: "DWY",
          bookings: null,
          mediaBookings: null,
          why: "The cockpit's campaign list starts on 24 Sep 2026, so spend before it cannot be split into Mahara's campaigns and the client's own; these numbers count from 24 Sep 2026. Done with you: the client books its own meetings.",
        }),
      ],
    }).clients[0];
    const notes = clientRangeNotes(dwy, { leadsOnly: true }).join(" ");
    expect(notes).toContain("these numbers count from 24 Sep 2026.");
    expect(notes).not.toContain("Done with you");
    expect(notes).not.toMatch(/\s{2}|—/);
    // Shown to a page with bookings, the whole reason stays.
    expect(clientRangeNotes(dwy).join(" ")).toContain(
      "Done with you: the client books its own meetings.",
    );
  });
});

// Findings of the build 2 review (22 Oct): the page used the read's figures
// for a range it counts only part of, lost a client opened from the list
// when the range changed, called spend it could not know "No spend" or "no
// leads", and left spend on an account the board does not link out without
// a word. clientPagePlan decides whose figures the totals are and why.
describe("whose figures a client's page totals (clientPagePlan)", () => {
  const OCEAN = "Ocean Home";
  // "Last month" read in October: 1 to 30 Sep, counted from 24 Sep (the day
  // after the cockpit's campaign list was first imported).
  const september = parseClientRange({
    from: "2026-09-01",
    to: "2026-09-30",
    countedFrom: "2026-09-24",
    through: "2026-09-30",
    throughSource: "media data",
    clients: [
      row({
        name: OCEAN,
        accounts: ["1000000001"],
        spend: 289.34,
        leads: 30,
        bookings: 5,
        mediaBookings: 5,
        costPerBooking: 57.87,
        days: 7,
        storedDays: 7,
        why: "The cockpit's campaign list starts on 24 Sep 2026, so spend before it cannot be split into Mahara's campaigns and the client's own; these numbers count from 24 Sep 2026.",
      }),
    ],
    unmatched: [],
  });
  const plan = (over: Partial<Parameters<typeof clientPagePlan>[0]>) =>
    clientPagePlan({
      read: september,
      failed: false,
      name: OCEAN,
      accounts: ["1000000001"],
      listed: 1,
      start: "2026-09-01",
      end: "2026-09-30",
      ...over,
    });

  test("a range that starts before the read's first day keeps the campaigns listed over the whole range", () => {
    const p = plan({});
    // Not $289.34 / 5 for 24 to 30 Sep beside a campaign row of $858.71
    // and 17 bookings for the month: the totals are the campaigns listed.
    expect(p.whole).toBeUndefined();
    expect(p.row?.spend).toBe(289.34);
    expect(p.why).toBe(
      "The client's own numbers start on 24 Sep 2026, so over a range that starts earlier these totals are the campaigns listed here.",
    );
    // A range that starts on or after it is the client's own read.
    const late = plan({
      read: { ...september, from: "2026-09-24", countedFrom: "2026-09-24" },
      start: "2026-09-24",
    });
    expect(late.whole?.spend).toBe(289.34);
    expect(late.countedFrom).toBeUndefined();
    expect(late.why).toBe("");
  });

  test("with no campaign listed the read is all there is, with its first day named", () => {
    const p = plan({ listed: 0 });
    expect(p.whole?.spend).toBe(289.34);
    expect(p.countedFrom).toBe("2026-09-24");
    expect(p.countedTo).toBeUndefined();
    expect(
      countedLine("Spend, leads and bookings", p.countedFrom, "2026-09-29"),
    ).toBe(
      "Spend, leads and bookings are counted from 24 Sep 2026, the first day the client's own numbers cover, to 29 Sep, the last day every account's numbers are in.",
    );
    expect(countedLine("Spend and leads", p.countedFrom)).toBe(
      "Spend and leads are counted from 24 Sep 2026, the first day the client's own numbers cover.",
    );
    expect(countedLine("Spend and leads")).toBeUndefined();
    // The list on the board names the same days.
    expect(countedSpan(september, "2026-09-01", "2026-09-30")).toBe(
      "from 24 Sep 2026",
    );
    expect(countedSpan(parseClientRange(mtd), "2026-10-01", "2026-10-21")).toBe(
      "to 20 Oct",
    );
    expect(countedSpan(september, "2026-09-24", "2026-09-30")).toBeUndefined();
  });

  test("a client opened from the list keeps its accounts, and a missing row is never 'not on the list'", () => {
    // Liwan, opened on Month to date, then Last 7 days (15 to 21 Oct): read
    // by its account, the row comes back with its zeros.
    const week = parseClientRange({
      from: "2026-10-15",
      to: "2026-10-21",
      countedFrom: "2026-10-15",
      through: "2026-10-21",
      throughSource: "media sync",
      clients: [
        row({
          name: "Liwan Limited Construction and Finishing Of Buildings",
          accounts: ["1938709086836136"],
          days: 7,
          storedDays: 7,
        }),
      ],
      unmatched: [],
    });
    const liwan = clientPagePlan({
      read: week,
      failed: false,
      name: "Liwan Limited Construction and Finishing Of Buildings",
      accounts: parseAdAccounts("1938709086836136"),
      listed: 0,
      start: "2026-10-15",
      end: "2026-10-21",
    });
    expect(liwan.whole?.spend).toBe(0);
    expect(liwan.whole?.bookings).toBe(0);
    // Read with no account (the old page) the read lists only clients with
    // spend or a booking, so the row is missing: the page says what the read
    // lists, not that the client is off the board's list.
    const none = { ...week, clients: [] };
    const bare = clientPagePlan({
      read: none,
      failed: false,
      name: "Liwan Limited Construction and Finishing Of Buildings",
      accounts: [],
      listed: 0,
      start: "2026-10-15",
      end: "2026-10-21",
    });
    expect(bare.whole).toBeUndefined();
    expect(bare.why).toBe(
      "The client's own read lists a client only when Mahara's campaigns spent on its ad accounts or a booking is stored for these days, and it lists nothing for this one.",
    );
    expect(bare.why).not.toContain("not on the Client Performance board");
    // Accounts given and still no row: the accounts are not linked.
    expect(
      clientPagePlan({
        read: none,
        failed: false,
        name: "Liwan",
        accounts: ["1938709086836136"],
        listed: 0,
        start: "2026-10-15",
        end: "2026-10-21",
      }).why,
    ).toBe(
      "This client's ad accounts are not linked to a client on the Client Performance board, so its numbers cannot be read here.",
    );
    // The address keeps digits only, sorted, once each.
    expect(
      parseAdAccounts("act_1938709086836136,abc,123,1938709086836136"),
    ).toEqual(["1938709086836136"]);
    expect(parseAdAccounts(null)).toEqual([]);
    expect(adAccountsParam(["act_762687672022667", "290802986", ""])).toBe(
      "290802986,762687672022667",
    );
    expect(adAccountsParam([])).toBe("");
  });

  test("a failed read, a read on its way and a read that counts no day each say so", () => {
    expect(plan({ failed: true, read: undefined }).why).toBe(
      "The client's own numbers could not be read, so these totals are the campaigns listed here. Reload to try again.",
    );
    expect(plan({ failed: true, read: undefined, listed: 0 }).why).toBe(
      "The client's own numbers could not be read. Reload the page to try again.",
    );
    expect(plan({ read: undefined }).why).toBe(
      "These totals are the campaigns listed here.",
    );
    expect(plan({ read: undefined, listed: 0 }).why).toBe("");
    const today = parseClientRange({
      ...mtd,
      from: "2026-10-22",
      to: "2026-10-22",
      countedFrom: null,
      through: "2026-10-21",
      clients: [
        row({
          name: OCEAN,
          accounts: ["1000000001"],
          spend: null,
          leads: null,
          bookings: null,
          days: null,
          storedDays: null,
          why: "Meta's numbers for these days are not in yet.",
        }),
      ],
    });
    expect(
      plan({ read: today, start: "2026-10-22", end: "2026-10-22" }).why,
    ).toBe(
      "Meta's numbers for these days are not in yet. These totals are the campaigns listed here.",
    );
    expect(
      plan({ read: today, start: "2026-10-22", end: "2026-10-22", listed: 0 })
        .why,
    ).toBe("Meta's numbers for these days are not in yet.");
    // Campaigns listed whose accounts no board client links.
    expect(
      plan({ read: { ...september, clients: [] }, accounts: ["555555"] }).why,
    ).toBe(
      "This client's ad accounts are not linked to a client on the Client Performance board, so these totals are the campaigns listed here.",
    );
  });

  test("spend on the page's accounts that the board does not link is named", () => {
    const read = parseClientRange({
      ...mtd,
      clients: [
        row({
          name: "Moved",
          accounts: ["111111"],
          spend: 100,
          bookings: 2,
          costPerBooking: 50,
        }),
      ],
      unmatched: [
        { account: "999999", campaigns: ["Moved | Leads"], spend: 12.5 },
        { account: "888888", campaigns: ["Someone else"], spend: 40 },
      ],
    });
    const p = clientPagePlan({
      read,
      failed: false,
      name: "Moved",
      accounts: ["111111", "999999"],
      listed: 2,
      start: "2026-10-01",
      end: "2026-10-20",
    });
    expect(p.unlinked).toEqual({ spend: 12.5, accounts: ["999999"] });
    expect(
      clientRangeNotes(p.whole as NonNullable<typeof p.whole>, {
        unlinked: p.unlinked,
      }).join(" "),
    ).toContain(
      "$12.50 that Mahara's campaigns spent on ad account 999999 is left out: it is not linked to a client on the Client Performance board.",
    );
    // Accounts the page does not read, and the client's own, are not named.
    expect(unlinkedSpend(read, read.clients[0], ["111111"])).toBeUndefined();
    expect(
      unlinkedSpend(read, read.clients[0], ["999999", "888888"])?.accounts,
    ).toEqual(["888888", "999999"]);
  });

  test("spend not known reads n/a with the read's reason, never 'None yet'", () => {
    const why =
      "No Meta ad account is linked to this client, so its spend is not known.";
    const touch = parseClientRange({
      ...mtd,
      clients: [
        row({
          name: "Professional Touch",
          accounts: [],
          spend: null,
          leads: null,
          bookings: 2,
          why,
        }),
      ],
    }).clients[0];
    expect(clientCpb(touch)).toMatchObject({ text: "n/a", why });
    expect(clientCpb({ ...touch, bookings: 0 })).toMatchObject({
      text: "n/a",
      why,
    });
    // It is listed with the clients that have no campaign, apart from spend.
    expect(
      clientsWithoutCampaigns(
        parseClientRange({ ...mtd, clients: [touch] }),
        [],
      ).map(r => r.spend),
    ).toEqual([null]);
  });
});

describe("the page reads the client, and falls back in words", () => {
  const source = (path: string) =>
    readFileSync(join(import.meta.dir, "..", path), "utf8");

  test("the client page reads the client's own totals through the plan and labels them", () => {
    const account = source("src/components/AccountView.tsx");
    expect(account).toContain(
      "useQueryState<ClientRangeRead>(api.stats.clientRange",
    );
    // Whose figures the totals are is clientPagePlan's call, tested above
    // on its own, with the campaigns the page lists.
    expect(account).toMatch(
      /clientPagePlan\(\{[\s\S]*?listed: campaigns\.length,[\s\S]*?\}\)/,
    );
    expect(account).toContain("const whole = plan.whole;");
    expect(account).toMatch(
      /clientRangeNotes\(whole, \{\s*leadsOnly,\s*unlinked: plan\.unlinked,?\s*\}\)/,
    );
    // A client with no campaign listed reads by the accounts it was opened with.
    expect(account).toContain(
      "listedAccounts.length > 0 ? listedAccounts : (accountIds ?? [])",
    );
    // With no campaign listed and no figure, the reason, never "No spend".
    expect(account).toContain("No numbers for this client in this range");
    // Spend not known (no ad account of its own) is never "No spend".
    expect(account).toContain(
      "This client's spend is not known for these days",
    );
    // Leads not known is not "No leads in this range".
    expect(account).toContain('"The leads for this range could not be read."');
    // A client with no campaign listed is not read as done with you.
    expect(account).toContain('clientRow?.serviceMode === "DWY"');
    expect(account).toContain("Not listed now");
  });

  test("the board lists the clients it has no row for, and the read is routed", () => {
    const page = source("src/pages/CockpitPage.tsx");
    expect(page).toMatch(/<ClientsNotListed[\s\S]*?campaigns=\{running\}/);
    // "Open" keeps the client's ad accounts in the address (?adAccounts=),
    // and the page reads by them.
    expect(page).toContain(
      "onOpen={(name, accounts) => setAccountView(name, accounts)}",
    );
    expect(page).toContain('next.set("adAccounts", ids)');
    expect(page).toContain("accountIds={accountIds}");
    const api = source("src/lib/cockpitApi.ts");
    expect(api).toContain('sub === "clientRange"');
    const list = source("src/components/ClientsNotListed.tsx");
    expect(list).toContain("could not be read. Reload the page to try again.");
  });
});
