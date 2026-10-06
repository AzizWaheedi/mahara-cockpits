import type { SheetCache } from "./sheetCache";

/** The reporting tabs are authoritative for outcomes entered through Mahara OS.
 * The hidden Appointments tab has a different column layout and is only a
 * fallback for months without their own reporting tab. Never add both copies.
 */
export type ReportRow = {
  name: string;
  added?: string;
  month?: string;
  ageDays?: number;
  appDate: string;
  appAt?: string;
  appPast?: boolean;
  appDaysAgo?: number;
  caller: string;
  confirmed: string;
  deposit: string;
  type: string;
  show: string;
  quote: string;
  closed: string;
  csat: string;
  ad: string;
  source: string;
};

export type ReportTab = { title: string; rows: unknown[][] };
type ReadJson = (url: string) => Promise<any>;
const MONTH_TAB = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2})$/;
const headerKey = (v: unknown) =>
  String(v ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function tabDay(title: string): Day | undefined {
  const m = MONTH_TAB.exec(title);
  return m
    ? { y: 2000 + Number(m[2]), m: MONTHS.indexOf(m[1]) + 1, d: 1 }
    : undefined;
}

export function parseReportTab(tab: ReportTab, today: Day): ReportRow[] {
  const header = (tab.rows[0] ?? []).map(headerKey);
  const find = (test: (key: string) => boolean) => header.findIndex(test);
  const col = {
    name: find(k => k === "name"),
    added: find(k => k === "date added"),
    appDate: find(k => k === "app date" || k === "appointment date"),
    caller: find(k => k === "caller"),
    confirmed: find(k => k.startsWith("confirmed")),
    deposit: find(k => k.startsWith("deposit")),
    type: find(k => k.startsWith("type")),
    show: find(k => /^show\b|^attend/.test(k)),
    quote: find(k => k.includes("quotation")),
    closed: find(k => k.startsWith("closed")),
    csat: find(k => k.includes("satisfaction")),
    ad: find(k => k === "ad" || k === "ad name"),
    source: find(k => k === "lead source" || k === "source"),
  };
  if ([col.name, col.appDate, col.show, col.closed].some(i => i < 0))
    throw new Error(`Reporting headers changed on ${tab.title}`);
  const month = tabDay(tab.title);
  return tab.rows.slice(1).flatMap(r => {
    const cell = (k: keyof typeof col) =>
      col[k] < 0 ? "" : String(r[col[k]] ?? "").trim();
    if (!cell("name") || headerKey(cell("name")) === "name") return [];
    const added = parseAdded(cell("added"), month ?? today);
    const label = cell("appDate");
    const weekday = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\b/i.exec(
      label,
    );
    const appt =
      month && weekday
        ? valid(month.y, month.m, Number(weekday[1]))
        : parseAppt(label, month ?? today, added);
    const dated = added ?? appt;
    return [
      {
        name: cell("name"),
        added: dated ? iso(dated) : undefined,
        month: month
          ? ym(month)
          : appt
            ? ym(appt)
            : dated
              ? ym(dated)
              : undefined,
        ageDays: dated ? daysBetween(today, dated) : undefined,
        appDate: label,
        appAt: appt ? iso(appt) : undefined,
        appPast: appt ? daysBetween(appt, today) < 0 : undefined,
        appDaysAgo: appt ? daysBetween(today, appt) : undefined,
        caller: cell("caller"),
        confirmed: cell("confirmed"),
        deposit: cell("deposit"),
        type: cell("type"),
        show: cell("show"),
        quote: cell("quote"),
        closed: cell("closed"),
        csat: cell("csat"),
        ad: cell("ad"),
        source: cell("source"),
      },
    ];
  });
}

export function selectReportRows(tabs: ReportTab[], today: Day) {
  // Parse every selected tab first. A malformed monthly tab must not silently
  // fall back to a stale legacy copy or erase last-known-good metrics.
  const parsed = tabs.map(tab => ({
    title: tab.title,
    rows: parseReportTab(tab, today),
  }));
  const months = new Set(
    parsed.flatMap(t => {
      const d = tabDay(t.title);
      return d ? [ym(d)] : [];
    }),
  );
  return parsed.flatMap(t =>
    t.title === "Appointments"
      ? t.rows.filter(r => !r.month || !months.has(r.month))
      : t.rows,
  );
}

export function creativeMonthStats(
  rows: ReportRow[],
  title: string,
  today: Day,
) {
  const month = tabDay(title);
  const selected = rows.filter(
    r => r.month === (month ? ym(month) : "") && r.appDate,
  );
  const due = selected.filter(
    r =>
      r.show &&
      (yes(r.show) || no(r.show)) &&
      (!r.appAt || r.appAt <= iso(today)),
  );
  return {
    tab: title,
    booked: selected.length,
    due: due.length,
    shows: due.filter(r => yes(r.show)).length,
    quotes: selected.filter(r => yes(r.quote)).length,
    closes: selected.filter(r => yes(r.closed)).length,
  };
}

/** One bounded metadata-driven read, shared by CSM and creative and cached
 * with its original read time. Missing ranges/API errors remain errors.
 */
export async function readClientSheetReport(
  sid: string,
  today: Day,
  get: ReadJson,
  cache?: SheetCache,
  fresh?: SheetCache,
) {
  const key = `sheet:report-v2:${sid}`;
  const hit = fresh?.get(key) ?? cache?.get(key);
  let tabs: ReportTab[], sourceReadAt: number;
  if (hit) {
    tabs = hit.data as ReportTab[];
    sourceReadAt = hit.at;
  } else {
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${sid}`;
    const metadata = await get(
      `${base}?fields=sheets(properties(title,gridProperties))`,
    );
    if (metadata?.error || !Array.isArray(metadata?.sheets))
      throw new Error("Reporting sheet metadata unreadable");
    const selected = metadata.sheets
      .map((s: any) => s.properties)
      .filter(
        (p: any) => p.title === "Appointments" || MONTH_TAB.test(p.title),
      );
    const total = selected.reduce(
      (sum: number, p: any) => sum + Number(p.gridProperties?.rowCount ?? NaN),
      0,
    );
    if (
      !selected.length ||
      selected.length > 60 ||
      !Number.isFinite(total) ||
      total > 40000 ||
      selected.some(
        (p: any) =>
          !Number.isInteger(p.gridProperties?.rowCount) ||
          p.gridProperties.rowCount < 1 ||
          !Number.isInteger(p.gridProperties?.columnCount) ||
          p.gridProperties.columnCount < 12,
      )
    )
      throw new Error("Reporting sheet bounds need review");
    const qs = new URLSearchParams();
    for (const p of selected) {
      const end = String.fromCharCode(
        64 + Math.min(18, p.gridProperties.columnCount),
      );
      qs.append("ranges", `'${p.title}'!A1:${end}${p.gridProperties.rowCount}`);
    }
    const data = await get(`${base}/values:batchGet?${qs}`);
    if (
      data?.error ||
      !Array.isArray(data?.valueRanges) ||
      data.valueRanges.length !== selected.length
    )
      throw new Error("Reporting sheet ranges incomplete");
    tabs = selected.map((p: any, i: number) => ({
      title: p.title,
      rows: data.valueRanges[i]?.values ?? [],
    }));
    // Validate before a response can enter the cache.
    selectReportRows(tabs, today);
    sourceReadAt = Date.now();
    // Convex documents have a bounded size. Large histories remain readable;
    // they simply do not enter the single-document Sheets cache.
    if (new TextEncoder().encode(JSON.stringify(tabs)).byteLength < 700_000)
      fresh?.set(key, { at: sourceReadAt, data: tabs });
  }
  return {
    rows: selectReportRows(tabs, today),
    tabTitles: tabs.map(t => t.title),
    sourceReadAt,
    source: tabs.some(t => MONTH_TAB.test(t.title))
      ? "month tabs (legacy months where needed)"
      : "Appointments tab",
  };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export type Day = { y: number; m: number; d: number };
export function kuwaitToday(): Day {
  const t = new Date(Date.now() + 3 * 3600_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
export function toDate(x: Day): Date {
  return new Date(Date.UTC(x.y, x.m - 1, x.d));
}
export function daysBetween(a: Day, b: Day): number {
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400_000);
}
function valid(y: number, m: number, d: number): Day | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() + 1 === m && t.getUTCDate() === d
    ? { y, m, d }
    : undefined;
}
export const iso = (x: Day) =>
  `${x.y}-${String(x.m).padStart(2, "0")}-${String(x.d).padStart(2, "0")}`;
export const ym = (x: Day) => `${x.y}-${String(x.m).padStart(2, "0")}`;
export const tabOf = (x: Day) => `${MONTHS[x.m - 1]} ${String(x.y).slice(2)}`;
export const yes = (c: unknown) =>
  String(c ?? "")
    .trim()
    .toUpperCase()
    .startsWith("Y");
export const no = (c: unknown) =>
  String(c ?? "")
    .trim()
    .toUpperCase()
    .startsWith("N");
export const money = (c: unknown) =>
  Number(String(c ?? "").replace(/[^0-9.-]/g, "")) || 0;

/**
 * "Date Added", which the team fills two different ways: `8/19/2026`
 * (month/day/year) and hand-typed `28/06` (day/month, year implied).
 */
export function parseAdded(cell: unknown, today: Day): Day | undefined {
  const text = String(cell ?? "").trim();
  if (!text) return undefined;
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(text);
  if (isoDate)
    return valid(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
  const nums = text
    .split(/[/\-.]/)
    .filter(p => p !== "")
    .map(Number);
  if (nums.some(Number.isNaN)) return undefined;
  if (nums.length >= 3) {
    const [a, b, c] = nums;
    const year = c > 99 ? c : 2000 + c;
    const [month, day] = a <= 12 ? [a, b] : [b, a];
    return valid(year, month, day);
  }
  if (nums.length === 2) {
    let [day, month] = nums;
    if (month > 12 && day <= 12) [day, month] = [month, day];
    const d = valid(today.y, month, day);
    if (!d) return undefined;
    return daysBetween(d, today) > 30 ? valid(today.y - 1, month, day) : d;
  }
  return undefined;
}

/** The appointment date column: `9/12/2026`, `12/9`, or `Wed 12 5:00 PM`. */
export function parseAppt(
  cell: unknown,
  today: Day,
  added?: Day,
): Day | undefined {
  const text = String(cell ?? "").trim();
  if (!text) return undefined;
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(text);
  if (isoDate)
    return valid(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
  const nums = text
    .split(/[/\-.]/)
    .map(p => p.trim())
    .filter(p => /^\d+$/.test(p))
    .map(Number);
  const dated = text.includes("/") || text.includes("-");
  if (nums.length >= 3 && dated) {
    const [a, b, c] = nums;
    if (a > 99) return valid(a, b, c);
    const year = c > 99 ? c : 2000 + c;
    const [month, day] = a <= 12 ? [a, b] : [b, a];
    return valid(year, month, day);
  }
  if (nums.length === 2 && dated) {
    let [day, month] = nums;
    if (month > 12 && day <= 12) [day, month] = [month, day];
    const d = valid(today.y, month, day);
    if (!d) return undefined;
    return daysBetween(d, today) > 180 ? valid(today.y - 1, month, day) : d;
  }
  // Free text: the day of the month, anchored to when the lead came in.
  if (added) {
    const dayNums = [
      ...text.replace(/\d{1,2}:\d{2}/g, " ").matchAll(/\b(\d{1,2})\b/g),
    ].map(m => Number(m[1]));
    for (const day of dayNums) {
      if (day < 1 || day > 31) continue;
      for (const shift of [0, 1]) {
        let month = added.m + shift;
        let year = added.y;
        if (month > 12) {
          month -= 12;
          year += 1;
        }
        const d = valid(year, month, day);
        if (d && daysBetween(d, added) >= 0) return d;
      }
      return undefined;
    }
  }
  return undefined;
}
