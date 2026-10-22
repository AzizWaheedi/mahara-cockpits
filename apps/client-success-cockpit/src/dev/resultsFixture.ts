/**
 * Invented answers in the shapes of cockpit_gap_read, cockpit_gap_client_read, cockpit_csm_calls_read,
 * cockpit_speed_read and cockpit_morning_uncalled_read (supabase/migrations/20261021i_results_speed_reads.sql),
 * for the screen tests and the layout harness. Every client, lead and number below is made up.
 * The same file sits in the media buyer and client success cockpits (results-screens.test.ts keeps them equal).
 */
import type {
  CallList,
  CallRow,
  GapClient,
  GapReport,
  GapRow,
  Morning,
  Speed,
  SpeedCell,
  UncalledLead,
} from "../lib/resultsReads";

export type ResultsScenario =
  | "default"
  | "empty"
  | "few"
  | "unread"
  | "allcalled";

const day = (n: number, base = new Date()) =>
  new Date(base.getTime() + 3 * 3600e3 - n * 86400e3)
    .toISOString()
    .slice(0, 10);

/** A small repeatable pseudo-random run, so a fixture reads the same every time. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const NAMES = [
  "Harbor Kitchens",
  "Dune Interiors",
  "Liwan Limited",
  "مطابخ الريم",
  "Atlas Renovation",
  "Orbit Glass",
  "Falcon Dental",
  "Pearl Fitness",
  "Cedar Clinic",
  "Nova Optics",
  "Sable Studio",
  "Tidal Pools",
  "Amber Lighting",
  "Kite Academy",
];
const loc = (i: number) => `locFixResults${String(i + 1).padStart(2, "0")}`;
const LEADS = [
  "Omar",
  "Sara",
  "Yousef",
  "Maha",
  "Khaled",
  "Noor",
  "Fahad",
  "Dana",
  "Hessa",
  "Talal",
  "Rana",
  "Bader",
  "ريم",
  "سلمان",
];

// ---------------------------------------------------------------------------
// The gap report

type Spec = [
  meetings: number,
  noResult: number,
  blank: number,
  missing: number,
  unclear: number,
  confirmed: number,
];
const GAP_SPECS: Spec[] = [
  [14, 9, 8, 0, 0, 5],
  [12, 7, 6, 0, 0, 1],
  [11, 5, 2, 0, 1, 3],
  [9, 4, 3, 1, 0, 1],
  [8, 2, 2, 0, 0, 0],
  [5, 0, 0, 0, 0, 0],
  [10, 6, 4, 2, 0, 2],
  [7, 3, 3, 0, 0, 1],
  [6, 3, 1, 1, 1, 2],
  [9, 1, 1, 0, 0, 0],
  [13, 8, 7, 0, 0, 4],
  [4, 1, 1, 0, 0, 0],
  [8, 4, 4, 0, 0, 2],
  [6, 0, 0, 0, 0, 0],
];
const GAP_ORDER = [2, 0, 4, 3, 1, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export function gapFixture(
  from: string,
  to: string,
  scenario: ResultsScenario = "default",
): GapReport {
  const take =
    scenario === "few" ? 3 : scenario === "empty" ? 0 : GAP_SPECS.length;
  const rows: GapRow[] = GAP_ORDER.slice(0, take)
    .map(i => {
      const [meetings, noResult, blank, missing, unclear, confirmed] =
        GAP_SPECS[i];
      return {
        locationId: loc(i),
        clientName: NAMES[i],
        serviceMode: "DFY",
        meetings,
        withResult: meetings - noResult,
        noResult,
        share: Math.round((noResult / meetings) * 10000) / 10000,
        crmConfirmed: confirmed,
        sheetBlank: blank,
        sheetMissing: missing,
        sheetUnclear: unclear,
        confirmedAndBlank: Math.min(confirmed, blank),
        oldestDays: noResult ? 12 : null,
        sheetReadOk: !(scenario === "unread" && i === 4),
        sheetCheckedAt: `${day(0)}T07:30:00Z`,
        sheetError:
          scenario === "unread" && i === 4
            ? "The sheet could not be opened."
            : null,
        matchesBoard: i !== 3,
        note: null,
      };
    })
    .sort(
      (a, b) =>
        b.noResult - a.noResult ||
        b.meetings - a.meetings ||
        a.clientName.localeCompare(b.clientName),
    );
  const sum = (k: "meetings" | "noResult" | "sheetBlank" | "crmConfirmed") =>
    rows.reduce((a, r) => a + r[k], 0);
  return {
    from,
    to,
    computedAt: new Date().toISOString(),
    rows,
    quietClients: scenario === "empty" ? 12 : 3,
    totals: {
      meetings: sum("meetings"),
      noResult: sum("noResult"),
      sheetBlank: sum("sheetBlank"),
      crmConfirmed: sum("crmConfirmed"),
      share:
        sum("meetings") > 0
          ? Math.round((sum("noResult") / sum("meetings")) * 10000) / 10000
          : null,
    },
    notes:
      scenario === "unread"
        ? [
            "The dialer could not read some clients' sheets on its last pass, so their no-result count may be too high.",
          ]
        : [],
  };
}

export function gapClientFixture(
  location: string,
  from: string,
  to: string,
): GapClient | null {
  const i = GAP_ORDER.find(n => loc(n) === location);
  if (i === undefined) return null;
  const [, noResult, blank, missing, unclear, confirmed] = GAP_SPECS[i];
  const rnd = lcg(i + 7);
  const meetings = Array.from({ length: noResult }, (_, k) => {
    const ago = 1 + Math.floor(((k + 1) * 12) / (noResult + 1));
    const state =
      k < blank
        ? "blank"
        : k < blank + missing
          ? "missing"
          : k < blank + missing + unclear
            ? "unclear"
            : "blank";
    return {
      id: `${location}-m${k + 1}`,
      contactId: `${location}c${k + 1}`,
      firstName: LEADS[Math.floor(rnd() * LEADS.length)],
      meetingAt: `${day(ago)}T${String(9 + (k % 8)).padStart(2, "0")}:00:00Z`,
      day: day(ago),
      calendar: k % 3 === 0 ? "online" : "main",
      crmStatus: k < confirmed ? "confirmed" : "new",
      crmConfirmed: k < confirmed,
      sheetState: state,
      daysSince: ago,
      contactUrl: `https://app.gohighlevel.com/v2/location/${location}/contacts/detail/${location}c${k + 1}`,
    };
  }).sort((a, b) => a.meetingAt.localeCompare(b.meetingAt));
  return {
    locationId: location,
    clientName: NAMES[i],
    from,
    to,
    computedAt: new Date().toISOString(),
    meetings,
  };
}

// ---------------------------------------------------------------------------
// The CSM call list

const CALL_SPECS: [name: string, missing: number][] = [
  ["Liwan Limited", 6],
  ["Harbor Kitchens", 5],
  ["Atlas Renovation", 4],
  ["Dune Interiors", 4],
  ["Orbit Glass", 3],
  ["Falcon Dental", 2],
  ["Pearl Fitness", 1],
];

export function callListFixture(
  scenario: ResultsScenario = "default",
): CallList {
  const rows: CallRow[] =
    scenario === "empty"
      ? []
      : CALL_SPECS.map(([name, missing], k) => {
          const called = scenario === "allcalled" ? k < 5 : k === 1;
          const rnd = lcg(k + 3);
          return {
            locationId: `locFixCall${String(k + 1).padStart(2, "0")}`,
            clientName: name,
            rank: k + 1,
            status: k < 5 ? "call" : "queued",
            missing,
            missingShow: missing - (k % 2),
            missingClosed: k % 2,
            oldestMeeting: day(24 + k),
            inFirstChase: 2,
            meetings: Array.from({ length: missing }, (_, m) => ({
              name: LEADS[Math.floor(rnd() * LEADS.length)],
              day: day(22 + k + m),
              cell: m % 4 === 3 ? "Closed" : "Show",
              runs: 2,
            })),
            sheetCheckedAt: `${day(0)}T07:30:00Z`,
            sheetError: null,
            calledAt: called ? `${day(0)}T10:05:00Z` : null,
            calledBy: called ? "sara@example.test" : null,
            calledByName: called ? "Sara Najjar" : null,
          };
        });
  return {
    week: "2026-W43",
    cap: 5,
    computedAt: new Date().toISOString(),
    runsBasis: "scheduled_runs",
    rows,
    notes: [
      "Counted by Thursday messages that were due, not by messages sent: the sent list lives in Make.",
    ],
  };
}

// ---------------------------------------------------------------------------
// The speed chart

const BAND_RATE: Record<string, number> = {
  up_to_30m: 0.27,
  "30m_to_4h": 0.24,
  "4h_to_24h": 0.22,
  over_24h: 0.19,
  no_call: 0.17,
  clock_unknown: 0.2,
};
const BAND_SHARE: [string, number][] = [
  ["up_to_30m", 0.06],
  ["30m_to_4h", 0.1],
  ["4h_to_24h", 0.31],
  ["over_24h", 0.24],
  ["no_call", 0.29],
];
const HOUR_WEIGHT = [
  1, 1, 0, 0, 0, 1, 2, 3, 5, 6, 6, 6, 5, 5, 6, 6, 6, 7, 8, 9, 9, 8, 5, 3,
];

export function speedFixture(
  from: string,
  to: string,
  clock: "clock" | "working" = "clock",
  scenario: ResultsScenario = "default",
): Speed {
  const rnd = lcg(clock === "clock" ? 11 : 12);
  const cells: SpeedCell[] = [];
  const total = scenario === "few" ? 90 : scenario === "empty" ? 0 : 1365;
  const weight = HOUR_WEIGHT.reduce((a, b) => a + b, 0);
  for (let h = 0; h < 24; h++) {
    for (const [country, share] of [
      ["KW", 0.7],
      ["SA", 0.2],
      ["AE", 0.1],
    ] as [string, number][]) {
      for (const [band, bandShare] of BAND_SHARE) {
        const shift = clock === "working" && band === "up_to_30m" ? 0.04 : 0;
        const n = Math.round(
          total *
            (HOUR_WEIGHT[h] / weight) *
            share *
            (bandShare + shift) *
            (0.85 + rnd() * 0.3),
        );
        if (n <= 0) continue;
        const booked = Math.round(n * BAND_RATE[band] * (0.85 + rnd() * 0.3));
        cells.push([h, country, band, n, booked, booked]);
      }
    }
  }
  return {
    from,
    to,
    clock,
    settleDays: 3,
    windowTo: day(3),
    computedAt: new Date().toISOString(),
    cells,
    note: "Correlation only: lead mix by client and hour can differ between bands, so a faster call is not shown to cause a booking.",
  };
}

// ---------------------------------------------------------------------------
// The morning list

export function morningFixture(
  location: string | null = null,
  scenario: ResultsScenario = "default",
): Morning {
  const rnd = lcg(5);
  const leads: UncalledLead[] = [];
  const groupCount: Record<UncalledLead["group"], number> = {
    never_called: scenario === "empty" ? 0 : 18,
    outcome_only: scenario === "empty" ? 0 : 7,
    phone_only: scenario === "empty" ? 0 : 11,
  };
  let n = 0;
  for (const group of ["never_called", "outcome_only", "phone_only"] as const) {
    for (let k = 0; k < groupCount[group]; k++, n++) {
      const c = Math.floor(rnd() * 6);
      leads.push({
        locationId: loc(c),
        clientName: NAMES[c],
        contactId: `${loc(c)}u${n}`,
        firstName: LEADS[Math.floor(rnd() * LEADS.length)],
        createdAt: new Date(
          Date.now() - (2 + rnd() * 70) * 3600e3,
        ).toISOString(),
        hoursWaiting: Math.round((2 + rnd() * 70) * 10) / 10,
        paid: rnd() > 0.35,
        group,
        callEvidence: group === "phone_only" ? "unique_phone_match" : null,
        lastCallAt:
          group === "phone_only"
            ? new Date(Date.now() - 20 * 3600e3).toISOString()
            : null,
        lastAttemptAt:
          group === "outcome_only"
            ? new Date(Date.now() - 22 * 3600e3).toISOString()
            : null,
        lastOutcome:
          group === "outcome_only"
            ? ["NO ANSWER", "CALLBACK", "WRONG NUMBER"][k % 3]
            : null,
        phoneLast4: String(1000 + Math.floor(rnd() * 8999)),
        contactUrl: `https://app.gohighlevel.com/v2/location/${loc(c)}/contacts/detail/${loc(c)}u${n}`,
      });
    }
  }
  const mine = location ? leads.filter(l => l.locationId === location) : leads;
  const count = (g: UncalledLead["group"]) =>
    mine.filter(l => l.group === g).length;
  const clients = NAMES.slice(0, 6)
    .map((name, c) => {
      const own = mine.filter(l => l.locationId === loc(c));
      const g = (k: UncalledLead["group"]) =>
        own.filter(l => l.group === k).length;
      return {
        locationId: loc(c),
        clientName: name,
        callable: own.length + 12,
        exact: 12,
        phoneOnly: g("phone_only"),
        outcomeOnly: g("outcome_only"),
        neverCalled: g("never_called"),
        noCallLinked: own.length,
        uncalledPaid: own.filter(l => l.paid).length,
        boardCallable: own.length + 12,
        boardVerified: 12 + g("phone_only"),
        boardOutcomeOnly: g("outcome_only"),
        boardUntouched: g("never_called"),
        boardComputedAt: new Date(Date.now() - 12 * 60e3).toISOString(),
        matchesBoard: c !== 3,
      };
    })
    .filter(c => !location || c.locationId === location);
  return {
    asOf: new Date().toISOString(),
    clients,
    leads: mine,
    totals: {
      callable: clients.reduce((a, c) => a + c.callable, 0),
      exact: clients.reduce((a, c) => a + c.exact, 0),
      phoneOnly: count("phone_only"),
      outcomeOnly: count("outcome_only"),
      neverCalled: count("never_called"),
      noCallLinked: mine.length,
      uncalledPaid: mine.filter(l => l.paid).length,
      matchesBoard: clients.every(c => c.matchesBoard !== false),
      clientsWithoutBoardRow: 0,
    },
  };
}
