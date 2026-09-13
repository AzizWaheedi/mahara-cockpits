import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { googleAccessToken } from "./tools";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Sheets read with the service account; waits and retries on 429 / 5xx. */
async function sheetsJson(
  url: string,
): Promise<{ ok: boolean; status: number; data: Any }> {
  const token = await googleAccessToken();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await wait((attempt + 1) * 15_000);
      continue;
    }
    return {
      ok: res.ok,
      status: res.status,
      data: await res.json().catch(() => ({})),
    };
  }
}

// biome-ignore lint/suspicious/noExplicitAny: sheet payloads
type Any = any;

/** One read per two minutes per isolate; every feed in a run reads this tab. */
let memo: { at: number; rows: ClientDataRow[] } | undefined;

/**
 * The Client Data tab of the database sheet: one row per client with every
 * integration id we need. This is the source of truth for ids and links;
 * the ClickUp client card stays the source of truth for the relationship
 * (stage, CSM, happiness, dates, service). [Aziz, 2026-09-10]
 *
 * Columns, by header name: Status | Client Name | Clickup ID | GHL ID |
 * GHL API | WA GROUP ID | Report Document ID | Google Drive Link | Sheet Link |
 * Ad Account - Snap | Ad Account - Meta | Ad Account - TikTok
 */
export const DATABASE_SHEET = "1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0";

export type ClientDataRow = {
  /** 1-based sheet row, for writes. */
  rowNumber: number;
  status: string;
  name: string;
  clickupId: string;
  ghlLocationId: string;
  ghlToken: string;
  waGroupId: string;
  reportDocId: string;
  driveLink: string;
  sheetLink: string;
  adAccountSnap: string;
  adAccountMeta: string;
  adAccountTiktok: string;
};

export function normTight(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export const HEADERS = {
  status: "Status",
  name: "Client Name",
  clickupId: "Clickup ID",
  ghlLocationId: "GHL ID",
  ghlToken: "GHL API",
  waGroupId: "WA GROUP ID",
  reportDocId: "Report Document ID",
  driveLink: "Google Drive Link",
  sheetLink: "Sheet Link",
  adAccountSnap: "Ad Account - Snap",
  adAccountMeta: "Ad Account - Meta",
  adAccountTiktok: "Ad Account - TikTok",
} as const;

/**
 * Columns are found by header name, so the tab can be reordered or widened
 * without breaking anything. A renamed header is reported, not ignored.
 */
/** Header row and the 0-based column of each known header (-1 when absent). */
export async function clientDataHeader(): Promise<{
  head: string[];
  col: Record<keyof typeof HEADERS, number>;
}> {
  const res = await sheetsJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${DATABASE_SHEET}/values/${encodeURIComponent("Client Data!A1:Z1")}`,
  );
  const data = res.data;
  const head = ((data?.values ?? [[]])[0] as string[]).map(h =>
    String(h ?? "").trim(),
  );
  const lower = head.map(h => h.toLowerCase());
  const col = {} as Record<keyof typeof HEADERS, number>;
  for (const [key, label] of Object.entries(HEADERS))
    col[key as keyof typeof HEADERS] = lower.indexOf(label.toLowerCase());
  return { head, col };
}

/**
 * The Client Data tab, with a fallback: every good read is kept in
 * `docCache` (docId "clientData"), and a read that fails (quota, a share
 * revoked, Google down) serves the last good copy instead of throwing, so a
 * sheet hiccup never empties the cockpits. Pass `ctx` from an action to get
 * the fallback; without it the read behaves as before.
 */
export async function readClientData(
  // biome-ignore lint/suspicious/noExplicitAny: action ctx, optional
  ctx?: any,
): Promise<ClientDataRow[]> {
  if (memo && Date.now() - memo.at < 120_000) return memo.rows;
  const res = await sheetsJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${DATABASE_SHEET}/values/${encodeURIComponent("Client Data!A1:Z500")}`,
  );
  const data = res.data;
  if (!res.ok) {
    const message = `Client Data: ${data?.error?.message ?? res.status}`.slice(
      0,
      200,
    );
    if (ctx) {
      const copy = await ctx.runQuery(internal.clientData.lastCopy, {});
      if (copy) {
        console.warn(
          `${message}; using the copy from ${new Date(copy.at).toISOString()}`,
        );
        memo = { at: Date.now(), rows: copy.rows };
        return copy.rows;
      }
    }
    throw new Error(message);
  }
  const values = (data?.values ?? []) as string[][];
  const head = (values[0] ?? []).map(h =>
    String(h ?? "")
      .trim()
      .toLowerCase(),
  );
  const col: Record<keyof typeof HEADERS, number> = {} as Record<
    keyof typeof HEADERS,
    number
  >;
  const missing: string[] = [];
  for (const [key, label] of Object.entries(HEADERS)) {
    const i = head.indexOf(label.toLowerCase());
    if (i === -1) missing.push(label);
    col[key as keyof typeof HEADERS] = i;
  }
  if (missing.includes(HEADERS.name) || missing.includes(HEADERS.clickupId))
    throw new Error(`Client Data: header(s) renamed: ${missing.join(", ")}`);
  if (missing.length)
    console.warn(`Client Data: header(s) not found: ${missing.join(", ")}`);
  const rows: ClientDataRow[] = [];
  for (const [i, r] of values.slice(1).entries()) {
    const cell = (k: keyof typeof HEADERS) =>
      col[k] === -1 ? "" : String(r[col[k]] ?? "").trim();
    const name = cell("name");
    if (!name) continue;
    rows.push({
      rowNumber: i + 2,
      status: cell("status"),
      name,
      clickupId: cell("clickupId"),
      ghlLocationId: cell("ghlLocationId"),
      ghlToken: cell("ghlToken"),
      waGroupId: cell("waGroupId"),
      reportDocId: cell("reportDocId"),
      driveLink: cell("driveLink"),
      sheetLink: cell("sheetLink"),
      adAccountSnap: cell("adAccountSnap"),
      adAccountMeta: cell("adAccountMeta"),
      adAccountTiktok: cell("adAccountTiktok"),
    });
  }
  memo = { at: Date.now(), rows };
  if (ctx)
    await ctx
      .runMutation(internal.clientData.saveCopy, { rows })
      .catch(() => undefined);
  return rows;
}

/** The row for a client: by ClickUp task id first, then exact name, then a name prefix. */
export function clientDataFor(
  rows: ClientDataRow[],
  name: string,
  taskId?: string,
): ClientDataRow | undefined {
  if (taskId) {
    const hit = rows.find(r => r.clickupId === taskId);
    if (hit) return hit;
  }
  const key = normTight(name);
  if (!key) return undefined;
  const exact = rows.find(r => normTight(r.name) === key);
  if (exact) return exact;
  return rows.find(r => {
    const k = normTight(r.name);
    return k.length >= 5 && (k.startsWith(key) || key.startsWith(k));
  });
}

/** A stat-sheet URL from whichever column has it. */
export function statSheetUrl(row?: ClientDataRow): string | undefined {
  if (!row) return undefined;
  if (row.sheetLink) return row.sheetLink;
  if (row.reportDocId)
    return `https://docs.google.com/spreadsheets/d/${row.reportDocId}/edit`;
  return undefined;
}

export const lastCopy = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const row = await ctx.db
      .query("docCache")
      .withIndex("by_doc", q => q.eq("docId", "clientData"))
      .unique();
    if (!row) return null;
    try {
      return { at: row.at, rows: JSON.parse(row.text) };
    } catch {
      return null;
    }
  },
});

export const saveCopy = internalMutation({
  args: { rows: v.any() },
  returns: v.null(),
  handler: async (ctx, { rows }) => {
    const row = await ctx.db
      .query("docCache")
      .withIndex("by_doc", q => q.eq("docId", "clientData"))
      .unique();
    const doc = {
      docId: "clientData",
      title: "Client Data (last good read)",
      text: JSON.stringify(rows),
      at: Date.now(),
    };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert("docCache", doc);
    return null;
  },
});
