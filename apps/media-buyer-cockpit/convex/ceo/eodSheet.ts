import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { googleAccessToken } from "../tools";

/**
 * The EOD Reports sheet on Google Sheets, the one that pulls every team
 * member's end of day (Aziz, 2026-09-21: "it should be the end-of-day
 * spreadsheet that we have on Google Sheets"). Read with the service
 * account, which needs the sheet shared with it.
 */
export const EOD_SHEET_ID = "1K10In9fyYa_hN7X4z_HGcCuoxGBRZoF4q7Z0r2SalZE";

async function sheetsGet(path: string): Promise<Record<string, unknown>> {
  const token = await googleAccessToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${EOD_SHEET_ID}${path}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** Tab names and the first rows of each, to see the shape before reading it for real. */
export const peek = internalAction({
  args: { rows: v.optional(v.number()) },
  returns: v.any(),
  handler: async (_ctx, { rows = 4 }) => {
    const meta = await sheetsGet(
      "?fields=properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))",
    );
    const sheets =
      (meta.sheets as {
        properties: {
          title: string;
          gridProperties: { rowCount: number; columnCount: number };
        };
      }[]) ?? [];
    const out: Record<string, unknown> = {
      title: (meta.properties as { title: string })?.title,
      tabs: [],
    };
    const tabs: unknown[] = [];
    for (const s of sheets.slice(0, 12)) {
      const range = encodeURIComponent(`'${s.properties.title}'!A1:AZ${rows}`);
      let values: unknown[][] = [];
      try {
        const v = await sheetsGet(`/values/${range}`);
        values = (v.values as unknown[][]) ?? [];
      } catch (e) {
        values = [[String(e instanceof Error ? e.message : e).slice(0, 120)]];
      }
      tabs.push({
        title: s.properties.title,
        rows: s.properties.gridProperties?.rowCount,
        cols: s.properties.gridProperties?.columnCount,
        head: values.map(r =>
          r.map(c => String(c ?? "").slice(0, 40)).slice(0, 26),
        ),
      });
    }
    out.tabs = tabs;
    return out;
  },
});
