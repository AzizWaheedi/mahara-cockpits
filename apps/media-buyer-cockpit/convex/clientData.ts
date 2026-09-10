import { googleAccessToken } from "./tools";

/**
 * The Client Data tab of the database sheet: one row per client with every
 * integration id we need. This is the source of truth for ids and links;
 * the ClickUp client card stays the source of truth for the relationship
 * (stage, CSM, happiness, dates, service). [Aziz, 2026-09-10]
 *
 * Columns (A→L): Status | Client Name | Clickup ID | GHL ID | GHL API |
 * WA GROUP ID | Report Document ID | Google Drive Link | Sheet Link |
 * Ad Account - Snap | Ad Account - Meta | Ad Account - TikTok
 */
export const DATABASE_SHEET = "1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0";

export type ClientDataRow = {
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

export async function readClientData(): Promise<ClientDataRow[]> {
  const token = await googleAccessToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${DATABASE_SHEET}/values/${encodeURIComponent("Client Data!A1:L300")}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      `Client Data: ${data?.error?.message ?? res.status}`.slice(0, 200),
    );
  const rows: ClientDataRow[] = [];
  for (const r of ((data?.values ?? []) as string[][]).slice(1)) {
    const cell = (i: number) => String(r[i] ?? "").trim();
    const name = cell(1);
    if (!name) continue;
    rows.push({
      status: cell(0),
      name,
      clickupId: cell(2),
      ghlLocationId: cell(3),
      ghlToken: cell(4),
      waGroupId: cell(5),
      reportDocId: cell(6),
      driveLink: cell(7),
      sheetLink: cell(8),
      adAccountSnap: cell(9),
      adAccountMeta: cell(10),
      adAccountTiktok: cell(11),
    });
  }
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
