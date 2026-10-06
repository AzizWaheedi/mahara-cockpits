import { describe, expect, test } from "bun:test";
import {
  creativeMonthStats,
  parseReportTab,
  readClientSheetReport,
  selectReportRows,
} from "../convex/clientSheetReport";
import type { SheetCache } from "../convex/sheetCache";

const today = { y: 2026, m: 10, d: 6 };
const header = [
  "Name",
  "Date Added",
  "App Date",
  "Phone Number",
  "Caller",
  "Confirmed ? (Y/N/C)",
  "Deposit (Y/N)",
  "Mahara Notes",
  "Type Of Consultaion",
  "Show (Y/N)",
  "Quotation Given (Y/N)",
  "Closed (Y/N/P)",
  "Customer Satisfaction Score",
  "Total Customer Revenue (Only Input If Closed)",
  "Notes: Reason for not converting",
  "",
  "Ad",
  "Lead Source",
];
const legacy = [...header.slice(0, 13), "", "Ad", "Lead Source"];
function row(overrides: Record<number, unknown> = {}) {
  return Object.assign(Array(18).fill(""), {
    0: "Fictional lead",
    1: "9/1/2026",
    2: "Tue 1 4:00 PM",
    9: "Y",
    10: "Y",
    11: "Y",
    14: "Feedback is not an ad",
    15: "More feedback",
    16: "Verified ad",
    17: "Meta",
    ...overrides,
  });
}

describe("client reporting sheets shared by CSM and creative", () => {
  test("monthly outcomes replace a populated stale legacy month once", () => {
    const rows = selectReportRows(
      [
        {
          title: "Appointments",
          rows: [
            legacy,
            row({ 2: "9/1/2026", 9: "N", 11: "N" }),
            row({ 1: "8/1/2026", 2: "8/1/2026", 14: "Legacy ad" }),
          ],
        },
        { title: "Sep 26", rows: [header, row()] },
      ],
      today,
    );
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.month === "2026-09")).toMatchObject({
      show: "Y",
      closed: "Y",
      ad: "Verified ad",
      source: "Meta",
    });
    expect(rows.find(r => r.month === "2026-08")?.ad).toBe("Legacy ad");
  });

  test("an empty verified month supersedes its stale legacy copy", () => {
    expect(
      selectReportRows(
        [
          { title: "Appointments", rows: [legacy, row({ 2: "9/1/2026" })] },
          { title: "Sep 26", rows: [header] },
        ],
        today,
      ),
    ).toEqual([]);
  });

  test("headers map shifted templates and never treat feedback as attribution", () => {
    const shifted = [...header.slice(0, 10), ...header.slice(11)];
    const [r] = parseReportTab(
      {
        title: "Sep 26",
        rows: [shifted, [...row().slice(0, 10), ...row().slice(11)]],
      },
      today,
    );
    expect(r).toMatchObject({
      show: "Y",
      quote: "",
      closed: "Y",
      ad: "Verified ad",
      source: "Meta",
    });
    const noAd = parseReportTab(
      { title: "Sep 26", rows: [header.slice(0, 16), row().slice(0, 16)] },
      today,
    )[0];
    expect(noAd.ad).toBe("");
    expect(noAd.source).toBe("");
  });

  test("blank added dates keep outcomes dated by their monthly appointment", () => {
    const [r] = parseReportTab(
      { title: "Sep 26", rows: [header, row({ 1: "", 2: "Tue 1 4:00 PM" })] },
      today,
    );
    expect(r).toMatchObject({
      added: "2026-09-01",
      appAt: "2026-09-01",
      month: "2026-09",
      appPast: true,
    });
  });

  test("creative counts row 2 and only bookings; pending is not a decided show", () => {
    const rows = parseReportTab(
      {
        title: "Oct 26",
        rows: [
          header,
          row({ 1: "", 2: "Thu 1 4:00 PM" }),
          row({ 2: "", 9: "" }),
          row({ 2: "Mon 5 4:00 PM", 9: "P" }),
          row({ 2: "Sat 10 4:00 PM" }),
        ],
      },
      today,
    );
    expect(creativeMonthStats(rows, "Oct 26", today)).toMatchObject({
      booked: 3,
      due: 1,
      shows: 1,
    });
  });

  test("metadata bounds include row 601 and Q:R and retain the source cache timestamp", async () => {
    const values: unknown[][] = [
      header,
      row(),
      ...Array.from({ length: 598 }, () => []),
      row({ 0: "Second fictional lead" }),
    ];
    const seen: string[] = [],
      fresh: SheetCache = new Map();
    const get = async (url: string) => {
      seen.push(url);
      return url.includes("batchGet")
        ? { valueRanges: [{ values }] }
        : {
            sheets: [
              {
                properties: {
                  title: "Sep 26",
                  gridProperties: { rowCount: 1127, columnCount: 35 },
                },
              },
            ],
          };
    };
    const result = await readClientSheetReport(
      "fixture-sheet",
      today,
      get,
      undefined,
      fresh,
    );
    expect(result.rows).toHaveLength(2);
    expect(new URL(seen[1]).searchParams.getAll("ranges")).toEqual([
      "'Sep 26'!A1:R1127",
    ]);
    const cached = await readClientSheetReport(
      "fixture-sheet",
      today,
      async () => {
        throw Error("cache should avoid provider");
      },
      fresh,
    );
    expect(cached.sourceReadAt).toBe(result.sourceReadAt);
    expect(cached.rows).toEqual(result.rows);
  });

  test("partial responses and changed headers fail before refreshing cached success", async () => {
    const fresh: SheetCache = new Map();
    const meta = {
      sheets: [
        {
          properties: {
            title: "Sep 26",
            gridProperties: { rowCount: 1000, columnCount: 35 },
          },
        },
      ],
    };
    await expect(
      readClientSheetReport(
        "fixture-sheet",
        today,
        async url => (url.includes("batchGet") ? { valueRanges: [] } : meta),
        undefined,
        fresh,
      ),
    ).rejects.toThrow("incomplete");
    await expect(
      readClientSheetReport(
        "fixture-sheet",
        today,
        async url =>
          url.includes("batchGet")
            ? { valueRanges: [{ values: [["Wrong header"]] }] }
            : meta,
        undefined,
        fresh,
      ),
    ).rejects.toThrow("headers changed");
    expect(fresh.size).toBe(0);
  });

  test("oversized sheets fail visibly instead of silently truncating", async () => {
    await expect(
      readClientSheetReport("fixture-sheet", today, async () => ({
        sheets: [
          {
            properties: {
              title: "Appointments",
              gridProperties: { rowCount: 40001, columnCount: 26 },
            },
          },
        ],
      })),
    ).rejects.toThrow("bounds");
  });
});
