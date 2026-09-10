import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  type ClientDataRow,
  clientDataFor,
  readClientData,
  statSheetUrl,
} from "./clientData";
import { CLIENTS_LIST } from "./sync";
import { allAdAccounts, callTool, unwrap } from "./tools";

/**
 * Per-client profiles for the client success cockpit.
 *
 * One profile = the numbers the client actually cares about (leads, appointments
 * booked, shows, closes), the rows on their sheet that nobody updated, their
 * lost leads with the reason, their live ads, their recent recorded calls, and
 * every link the CSM needs in one place. This is `csm_client_profiles.py` and
 * `csm_ghl_lost.py` moved into the app. Everything is read, never written.
 *
 * Sources:
 *   - the client's own performance sheet (Sheet Link on Clients - Mahara)
 *   - the client's own GHL sub-account, with the private token from Client Data
 *   - this backend's `campaigns` / `metaTree` tables
 *   - Fathom recordings (FATHOM_API_KEY), matched to the client by name
 */

declare const process: { env: Record<string, string | undefined> };

const DATABASE = "1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0";
const META_ADS_MANAGER =
  "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=";
const LC = "https://services.leadconnectorhq.com";

// Field ids on Clients - Mahara.
const PROFILE_CF = {
  sheet: "e6da13ae-6498-44a1-b7dd-9c6198500aa9",
  drive: "19e39b91-dd2f-4027-ba88-31bc6aae07c3",
  driveFolder: "ce6129a5-c8e5-41ba-ac50-8650c7556469",
  contract: "10b41484-c70d-4295-aab9-06a30443a3a2",
  profile: "7755485f-74a8-496c-85d8-562588e77944",
  status: "9368ca9e-3549-4320-84ff-9abd0a2901cb",
  happiness: "4e3924e3-4898-4e98-aca1-cc1ac3015b73",
  launch: "2e744484-f581-4c37-962a-023c4de23729",
  service: "fccfc09c-650e-4aed-b4cd-3f50beba05a3",
  platform: "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9",
};
const CSM_FIELD = "68ff84db-6c66-4e70-8e72-15d70828fda6";
const PROFILE_BATCH = 6;
const MAX_LOST = 40;
const MAX_NOTES = 15;
const NOTE_NOISE =
  /knowledge base link|form answers|applied before|^https?:\/\/|^\s*$/i;

// biome-ignore lint/suspicious/noExplicitAny: external payloads
type Any = any;

// Column layout of every client performance sheet tab. Fixed by the template.
const COL = {
  name: 0,
  added: 1,
  appDate: 2,
  phone: 3,
  caller: 4,
  confirmed: 5,
  deposit: 6,
  notes: 7,
  type: 8,
  show: 9,
  quote: 10,
  closed: 11,
  csat: 12,
  revenue: 13,
};
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

// --- small helpers ------------------------------------------------------------

async function clickup(path: string): Promise<Any> {
  return unwrap(
    await callTool("pd_clickup_proxy_get", {
      url: `https://api.clickup.com/api/v2/${path}`,
    }),
  );
}
async function sheetsGet(url: string): Promise<Any> {
  return unwrap(await callTool("pd_google_sheets_proxy_get", { url }));
}

/** Run `fn` over `items` with at most `n` in flight. */
async function pool<T, R>(
  items: T[],
  n: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

type Day = { y: number; m: number; d: number };
function kuwaitToday(): Day {
  const t = new Date(Date.now() + 3 * 3600_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function toDate(x: Day): Date {
  return new Date(Date.UTC(x.y, x.m - 1, x.d));
}
function daysBetween(a: Day, b: Day): number {
  return Math.round((toDate(a).getTime() - toDate(b).getTime()) / 86400_000);
}
function valid(y: number, m: number, d: number): Day | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() + 1 === m && t.getUTCDate() === d
    ? { y, m, d }
    : undefined;
}
const iso = (x: Day) =>
  `${x.y}-${String(x.m).padStart(2, "0")}-${String(x.d).padStart(2, "0")}`;
const ym = (x: Day) => `${x.y}-${String(x.m).padStart(2, "0")}`;
const tabOf = (x: Day) => `${MONTHS[x.m - 1]} ${String(x.y).slice(2)}`;
const yes = (c: unknown) =>
  String(c ?? "")
    .trim()
    .toUpperCase()
    .startsWith("Y");
const no = (c: unknown) =>
  String(c ?? "")
    .trim()
    .toUpperCase()
    .startsWith("N");
const money = (c: unknown) =>
  Number(String(c ?? "").replace(/[^0-9.-]/g, "")) || 0;

/**
 * "Date Added", which the team fills two different ways: `8/19/2026`
 * (month/day/year) and hand-typed `28/06` (day/month, year implied).
 */
function parseAdded(cell: unknown, today: Day): Day | undefined {
  const text = String(cell ?? "").trim();
  if (!text) return undefined;
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
function parseAppt(cell: unknown, today: Day, added?: Day): Day | undefined {
  const text = String(cell ?? "").trim();
  if (!text) return undefined;
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

type Appt = Record<string, Any>;

/** Normalise the Appointments log into one record per lead. */
function appointmentRows(rows: string[][], today: Day): Appt[] {
  const out: Appt[] = [];
  for (const r of rows) {
    const cell = (k: keyof typeof COL) => String(r[COL[k]] ?? "");
    const name = cell("name").trim();
    if (!name || name.toLowerCase() === "name") continue;
    const added = parseAdded(cell("added"), today);
    const appt = parseAppt(cell("appDate"), today, added);
    out.push({
      name,
      added: added ? iso(added) : undefined,
      month: added ? ym(added) : undefined,
      ageDays: added ? daysBetween(today, added) : undefined,
      appDate: cell("appDate").trim(),
      appAt: appt ? iso(appt) : undefined,
      // undefined means the date could not be read, which is not the same as upcoming.
      appPast: appt ? daysBetween(appt, today) < 0 : undefined,
      appDaysAgo: appt ? daysBetween(today, appt) : undefined,
      caller: cell("caller").trim(),
      confirmed: cell("confirmed").trim(),
      deposit: cell("deposit").trim(),
      type: cell("type").trim(),
      show: cell("show").trim(),
      quote: cell("quote").trim(),
      closed: cell("closed").trim(),
      csat: cell("csat").trim(),
      ad: String(r[14] ?? "").trim(),
      source: String(r[15] ?? "").trim(),
    });
  }
  return out;
}

/** Counts for a set of rows. Blank is blank, never guessed as a no. */
function summarise(rows: Appt[]) {
  const booked = rows.filter(r => r.appDate).length;
  const upcoming = rows.filter(r => r.appDate && r.appPast === false).length;
  const awaiting = rows.filter(
    r =>
      r.appDate &&
      r.appPast !== false &&
      !String(r.show).trim() &&
      !String(r.closed).trim(),
  ).length;
  const shows = rows.filter(r => yes(r.show)).length;
  const noshows = rows.filter(r => no(r.show)).length;
  const closes = rows.filter(r => yes(r.closed)).length;
  const quotes = rows.filter(r => yes(r.quote)).length;
  const deposits = rows.filter(r => yes(r.deposit)).length;
  const scores = rows.map(r => money(r.csat)).filter(Boolean);
  const decided = shows + noshows;
  return {
    leads: rows.length,
    booked,
    shows,
    noshows,
    quotes,
    deposits,
    closes,
    unknownOutcome: awaiting,
    upcoming,
    showRate: decided ? Math.round((100 * shows) / decided) : undefined,
    closeRate: shows ? Math.round((100 * closes) / shows) : undefined,
    csat: scores.length
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) /
        10
      : undefined,
  };
}

/** Appointments the client never updated: the CSM's chase list. */
function staleRows(rows: Appt[], minAge = 2): Appt[] {
  const out: Appt[] = [];
  for (const r of rows) {
    if (r.appPast === false) continue;
    const age = r.appDaysAgo ?? r.ageDays;
    if (!r.appDate || age === undefined || age < minAge) continue;
    if (!r.show) out.push({ ...r, missing: "attended?" });
    else if (yes(r.show) && !r.closed) out.push({ ...r, missing: "closed?" });
  }
  return out.sort(
    (a, b) =>
      (b.appDaysAgo ?? b.ageDays ?? 0) - (a.appDaysAgo ?? a.ageDays ?? 0),
  );
}

/** Which ad each lead came from, and what that ad's leads actually did. */
function byAd(rows: Appt[]) {
  const seen = new Map<string, Any>();
  for (const r of rows) {
    const key = r.ad || r.source || "not tagged";
    const item = seen.get(key) ?? {
      ad: key,
      leads: 0,
      booked: 0,
      shows: 0,
      noshows: 0,
      closes: 0,
      unknown: 0,
    };
    item.leads++;
    if (r.appDate) item.booked++;
    if (no(r.show)) item.noshows++;
    if (yes(r.show)) item.shows++;
    if (yes(r.closed)) item.closes++;
    if (
      r.appPast !== false &&
      !String(r.show).trim() &&
      !String(r.closed).trim()
    )
      item.unknown++;
    seen.set(key, item);
  }
  const out = [...seen.values()].map(a => {
    const decided = a.leads - a.unknown;
    return {
      ...a,
      bookRate: a.leads ? Math.round((100 * a.booked) / a.leads) : undefined,
      showRate: decided ? Math.round((100 * a.shows) / decided) : undefined,
      closeRate: a.shows ? Math.round((100 * a.closes) / a.shows) : undefined,
    };
  });
  return out
    .sort(
      (a, b) => b.closes - a.closes || b.shows - a.shows || b.leads - a.leads,
    )
    .slice(0, 12);
}

function sheetId(url: unknown): string | undefined {
  return /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(String(url ?? ""))?.[1];
}

/**
 * Read one client's performance sheet. The `Appointments` tab is the master
 * log every caller fills; the month tabs are read as a fallback.
 */
async function sheetPerformance(url: unknown, today: Day): Promise<Any> {
  const sid = sheetId(url);
  if (!sid) return undefined;
  const first = { ...today, d: 1 };
  const prevDay = new Date(toDate(first).getTime() - 86400_000);
  const prev: Day = {
    y: prevDay.getUTCFullYear(),
    m: prevDay.getUTCMonth() + 1,
    d: 1,
  };
  const thisTab = tabOf(today);
  const lastTab = tabOf(prev);
  const wanted = ["Appointments", thisTab, lastTab];
  const qs = wanted
    .map(t => `ranges=${encodeURIComponent(`${t}!A1:P600`)}`)
    .join("&");
  let data: Any;
  try {
    data = await sheetsGet(
      `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values:batchGet?${qs}`,
    );
  } catch (e) {
    return { sheetId: sid, error: String(e).slice(0, 200) };
  }
  const grids: Any[] = data?.valueRanges ?? [];
  if (grids.length === 0)
    return {
      sheetId: sid,
      error: String(data?.error?.message ?? "sheet unreadable").slice(0, 300),
    };
  const raw: Record<string, string[][]> = {};
  wanted.forEach((t, i) => {
    raw[t] = grids[i]?.values ?? [];
  });
  let rows = appointmentRows(raw.Appointments ?? [], today);
  let source = "Appointments tab";
  if (rows.length === 0) {
    rows = appointmentRows(
      [...(raw[thisTab] ?? []), ...(raw[lastTab] ?? [])],
      today,
    );
    source = "month tabs";
  }
  const thisMonth = ym(today);
  const prevMonth = ym(prev);
  const stale = staleRows(rows);
  return {
    sheetId: sid,
    source,
    monthLabel: thisTab,
    lastMonthLabel: lastTab,
    month: summarise(rows.filter(r => r.month === thisMonth)),
    lastMonth: summarise(rows.filter(r => r.month === prevMonth)),
    allTime: summarise(rows),
    undated: rows.filter(r => !r.month).length,
    stale: stale.slice(0, 40),
    staleCount: stale.length,
    byAd: byAd(
      rows.filter(r => r.month === thisMonth || r.month === prevMonth),
    ),
    byAdAllTime: byAd(rows),
    recent: rows.slice(-60).reverse(),
  };
}

// --- Ads for the client, off this backend's own tables --------------------------

function normLoose(name: unknown): string {
  return String(name ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\b(company|co|llc|w\.l\.l|wll|group|designs?|design)\b/g, " ")
    .replace(/[^a-z0-9؀-ۿ]+/g, "");
}

const LIVE = /active/i;

function adsForClient(client: string, campaigns: Any[], tree: Any[]) {
  const target = normLoose(client);
  const mine = campaigns.filter(
    c =>
      normLoose(c.clientName ?? "") === target ||
      (target && normLoose(c.accountName ?? "").includes(target)),
  );
  return mine
    .sort((a, b) => (b.spend7d ?? 0) - (a.spend7d ?? 0))
    .map(c => {
      const nodes = tree.filter(t => t.campaignName === c.campaignName);
      const adsets = nodes.filter(t => t.kind === "adset");
      const ads = nodes.filter(t => t.kind === "ad");
      return {
        campaign: c.campaignName,
        account: c.accountName,
        accountId: c.metaAccountId,
        status: c.adStatus ?? c.boardAdStatus,
        spend7d: c.spend7d,
        leads7d: c.leads7d,
        cpl: c.cpl,
        bookings7d: c.bookings7d,
        showed7d: c.showed7d,
        costPerBooking: c.costPerBooking,
        taskUrl: c.taskUrl,
        adsets: adsets.map(a => ({
          name: a.name,
          status: a.effectiveStatus ?? a.status,
          ads: ads
            .filter(ad => ad.adsetId === a.metaId)
            .map(ad => ({
              name: ad.name,
              status: ad.effectiveStatus ?? ad.status,
              previewSrc: ad.previewSrc,
            })),
        })),
      };
    });
}

function liveCounts(ads: Any[]) {
  return {
    campaigns: ads.filter(c => LIVE.test(String(c.status ?? ""))).length,
    adsets: ads
      .flatMap(c => c.adsets)
      .filter(a => LIVE.test(String(a.status ?? ""))).length,
    ads: ads
      .flatMap(c => c.adsets)
      .flatMap(a => a.ads)
      .filter(a => LIVE.test(String(a.status ?? ""))).length,
  };
}

function adsAccess(ads: Any[]): string {
  if (ads.length === 0) return "no_campaigns";
  if (!ads.some(c => c.adsets?.length)) return "no_access";
  return "ok";
}

// --- Lost leads, from the client's own GHL sub-account --------------------------

function normTight(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, "");
}

type GhlAccount = {
  name: string;
  clickupId: string;
  locationId: string;
  token: string;
};

/** `{normalised client name | id:<clickupId>: account}` off Client Data columns A-E. */
async function ghlAccounts(): Promise<Map<string, GhlAccount>> {
  const out = new Map<string, GhlAccount>();
  // Agency-level tokens cannot read a sub-account's pipelines or calendars
  // (tested 2026-09-10: 401 on every location endpoint and on locationToken),
  // so each row needs its own sub-account private integration token.
  for (const r of await readClientData()) {
    const token = r.ghlToken;
    if (!token.startsWith("pit-") || !r.ghlLocationId) continue;
    const entry = {
      name: r.name,
      clickupId: r.clickupId,
      locationId: r.ghlLocationId,
      token,
    };
    out.set(normTight(r.name), entry);
    if (r.clickupId) out.set(`id:${r.clickupId}`, entry);
  }
  return out;
}

function accountFor(
  accounts: Map<string, GhlAccount>,
  client: string,
  taskId?: string,
): GhlAccount | undefined {
  if (taskId && accounts.has(`id:${taskId}`))
    return accounts.get(`id:${taskId}`);
  const key = normTight(client);
  if (accounts.has(key)) return accounts.get(key);
  for (const [k, v] of accounts) {
    if (k.startsWith("id:")) continue;
    if (key && (key.includes(k) || k.includes(key))) return v;
  }
  return undefined;
}

async function ghlGet(
  token: string,
  path: string,
  params: Record<string, string>,
): Promise<Any> {
  const res = await fetch(`${LC}/${path}?${new URLSearchParams(params)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  if (!res.ok)
    throw new Error(
      `${path} ${res.status}: ${(await res.text()).slice(0, 160)}`,
    );
  return res.json();
}

function adOf(opp: Any): string {
  for (const att of opp.attributions ?? []) {
    for (const key of ["utmContent", "utmTerm", "utmCampaign", "adSource"])
      if (att[key]) return String(att[key]);
  }
  return "";
}

/** Recent lost leads for one sub-account, grouped by reason (the stage name IS the reason). */
async function lostLeads(entry: GhlAccount): Promise<Any> {
  const pipelines: Any[] =
    (
      await ghlGet(entry.token, "opportunities/pipelines", {
        locationId: entry.locationId,
      })
    ).pipelines ?? [];
  const target = pipelines.find(
    p =>
      String(p.name ?? "")
        .toLowerCase()
        .includes("lost") &&
      !String(p.name ?? "")
        .toLowerCase()
        .includes("old"),
  );
  if (!target) return { reasons: [], leads: [], total: 0, pipeline: "" };
  const stageNames = new Map<string, string>(
    (target.stages ?? []).map((s: Any) => [s.id, String(s.name ?? "")]),
  );
  const found = await ghlGet(entry.token, "opportunities/search", {
    location_id: entry.locationId,
    pipeline_id: target.id,
    limit: String(MAX_LOST),
  });
  const opps: Any[] = [...(found.opportunities ?? [])].sort((a, b) =>
    String(b.lastStageChangeAt ?? b.updatedAt ?? "").localeCompare(
      String(a.lastStageChangeAt ?? a.updatedAt ?? ""),
    ),
  );
  const leads: Any[] = [];
  for (const [i, opp] of opps.entries()) {
    const contact = opp.contact ?? {};
    let note = "";
    if (i < MAX_NOTES && contact.id) {
      try {
        const notes: Any[] =
          (await ghlGet(entry.token, `contacts/${contact.id}/notes`, {}))
            .notes ?? [];
        const real = notes
          .map(n => String(n.bodyText ?? "").trim())
          .filter(t => !NOTE_NOISE.test(t));
        note = real.slice(0, 2).join(" · ").slice(0, 220);
      } catch {
        note = "";
      }
    }
    leads.push({
      name: opp.name || contact.name || "Unnamed",
      phone: contact.phone ?? "",
      reason: stageNames.get(opp.pipelineStageId) ?? "Not set",
      note,
      ad: adOf(opp),
      source: opp.source ?? "",
      movedAt: String(opp.lastStageChangeAt ?? "").slice(0, 10),
    });
  }
  const counts = new Map<string, number>();
  for (const l of leads) counts.set(l.reason, (counts.get(l.reason) ?? 0) + 1);
  return {
    pipeline: target.name ?? "",
    total: found.meta?.total ?? leads.length,
    reasons: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count })),
    leads,
  };
}

// --- Fathom: recent recorded calls, matched to the client by name ---------------

type Call = {
  title: string;
  at: string;
  host?: string;
  external: string[];
  url?: string;
  summary?: string;
};

async function fathomCalls(days: number): Promise<Call[]> {
  const key = process.env.FATHOM_API_KEY;
  if (!key) return [];
  const since = new Date(Date.now() - days * 86400_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const out: Call[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      created_after: since,
      include_summary: "true",
    });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(
      `https://api.fathom.ai/external/v1/meetings?${params}`,
      { headers: { "X-Api-Key": key } },
    );
    if (!res.ok)
      throw new Error(
        `Fathom ${res.status}: ${(await res.text()).slice(0, 160)}`,
      );
    const body = await res.json();
    for (const m of body.items ?? []) {
      out.push({
        title: String(m.title ?? ""),
        at: String(m.scheduled_start_time ?? m.created_at ?? ""),
        host: m.recorded_by?.name,
        external: ((m.calendar_invitees ?? []) as Any[])
          .filter(i => i.is_external)
          .map(i => String(i.name ?? i.email ?? "")),
        url: m.url ?? m.share_url,
        summary:
          String(m.default_summary?.markdown_formatted ?? "").slice(0, 1500) ||
          undefined,
      });
    }
    cursor = body.next_cursor ?? undefined;
    if (!cursor) break;
  }
  return out;
}

/** Only exact normalised containment counts; a wrong match is worse than none. */
function callsFor(client: string, calls: Call[]): Call[] {
  const key = normTight(client);
  if (key.length < 4) return [];
  return calls
    .filter(c => normTight([c.title, ...c.external].join(" ")).includes(key))
    .slice(0, 8);
}

type Gap = { gap: string; label: string; fix: string };

/**
 * What is missing for one client, and where to put it. Computed here because
 * this is the only place that sees the card, Client Data, Meta and GHL at once.
 * Pre-launch stages skip the things that only exist once ads run.
 */
function gapsFor(x: {
  client: Any;
  row?: ClientDataRow;
  perf: Any;
  acct: Any;
  lost: Any;
  accountId?: string;
  onBoard: boolean;
  visibleAccounts: { name: string; id: string }[];
  calls: number;
  clientDataOk: boolean;
}): Gap[] {
  const { client: c, row } = x;
  const gaps: Gap[] = [];
  const stage = String(c.stage ?? "");
  const live = /^active$/i.test(stage);
  const dead = /paused|stopped|cancel|churn|lost|ghost/i.test(stage);
  if (dead) return gaps;
  const add = (gap: string, label: string, fix: string) =>
    gaps.push({ gap, label, fix });
  // ClickUp card: relationship fields the CSM owns
  if (!c.service)
    add(
      "service",
      "Service not set on the card",
      "ClickUp client card → Service (DWY or DFY).",
    );
  // Client Data: ids and links. If the tab itself could not be read this run,
  // say nothing about rows rather than telling the CSM every client is missing.
  if (!x.clientDataOk) {
    // no row-level gaps this run
  } else if (!row) {
    add(
      "data_row",
      "No row on the Client Data tab",
      `Database sheet → Client Data: add a row with Clickup ID ${c.taskId}, GHL ID, GHL API token, WA GROUP ID, Sheet Link, Google Drive Link, Ad Account - Meta.`,
    );
  } else {
    if (row.clickupId !== c.taskId)
      add(
        "data_id",
        `Client Data row points at task ${row.clickupId || "(blank)"}, the card is ${c.taskId}`,
        "Database sheet → Client Data → Clickup ID: paste the card's task id so the match is exact.",
      );
    if (!row.ghlLocationId)
      add(
        "ghl_id",
        "GHL ID empty on Client Data",
        "Database sheet → Client Data → GHL ID: the sub-account location id.",
      );
    if (!row.ghlToken.startsWith("pit-"))
      add(
        "ghl_token",
        "GHL API token empty on Client Data",
        "In GHL switch into this sub-account → Settings → Private Integrations → New, scopes: contacts, opportunities, calendars, calendar events, locations (read). Paste the pit-… token into Client Data → GHL API.",
      );
    if (!/@g\.us$/.test(row.waGroupId))
      add(
        "wa_group",
        "WA GROUP ID empty on Client Data",
        "Database sheet → Client Data → WA GROUP ID: the client group's id (…@g.us).",
      );
    if (!row.driveLink)
      add(
        "drive",
        "Google Drive Link empty on Client Data",
        "Database sheet → Client Data → Google Drive Link: the client folder, shared with the service account.",
      );
    if (!row.adAccountMeta)
      add(
        "meta_name",
        "Ad Account - Meta empty on Client Data",
        "Database sheet → Client Data → Ad Account - Meta: the ad account name exactly as in Business Manager (or its id).",
      );
    if (live && !/active/i.test(row.status))
      add(
        "data_status",
        `Client Data Status is "${row.status}" but the card is Active`,
        "Database sheet → Client Data → Status: set to Active.",
      );
  }
  if (!c.sheetLink)
    add(
      "sheet",
      "No stat sheet anywhere",
      "Database sheet → Client Data → Sheet Link (or paste it on the card's Sheet Link field).",
    );
  else if (x.perf?.error && !x.perf?.staleReason)
    add(
      "sheet_read",
      "Stat sheet cannot be read",
      `Share the stat sheet with claude@studied-handler-508106-m5.iam.gserviceaccount.com as viewer. Last error: ${String(x.perf.error).slice(0, 100)}`,
    );
  if (row?.ghlToken.startsWith("pit-") && !x.acct)
    add(
      "ghl_match",
      "GHL row exists but did not match the card",
      "Database sheet → Client Data → Clickup ID must equal the card's task id.",
    );
  if (x.lost?.error)
    add(
      "ghl_read",
      "GHL token rejected",
      `Database sheet → Client Data → GHL API: replace the token. Last error: ${String(x.lost.error).slice(0, 100)}`,
    );
  // Meta
  const nt = normTight;
  const wanted = row?.adAccountMeta ? nt(row.adAccountMeta) : "";
  const visible =
    x.accountId ||
    x.visibleAccounts.find(
      a => wanted && (nt(a.name) === wanted || a.id === row?.adAccountMeta),
    ) ||
    x.visibleAccounts.find(a => {
      const k = nt(a.name);
      const n = nt(c.name);
      return (
        k.length >= 5 && n.length >= 5 && (k.startsWith(n) || n.startsWith(k))
      );
    });
  if (!visible)
    add(
      "meta_access",
      "No Meta ad account visible to Mahara",
      "Business Manager: have the client share their ad account with Mahara's business, then put its exact name in Client Data → Ad Account - Meta.",
    );
  if (live && !x.onBoard)
    add(
      "board",
      "No campaign card on the ads management board",
      "Fill the new-campaign form so the card exists: https://forms.clickup.com/90182518398/f/2kzmr1ky-3878/1BO7T0R9GQCL88NBHR",
    );
  return gaps;
}

/** API matches first, then remembered calls for this client, no duplicate links, newest first, 8 at most. */
function mergeCalls(fresh: Call[], cached: Any[], client: string): Any[] {
  const seen = new Set<string>();
  const out: Any[] = [];
  const rows = [
    ...fresh.map(c => ({ ...c, kind: "client" })),
    ...cached.filter(r => r.clientName === client),
  ];
  rows.sort((a, b) => (String(a.at) < String(b.at) ? 1 : -1));
  for (const r of rows) {
    const key = String(r.url ?? r.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.slice(0, 8);
}

// --- Inputs: the client rows off Clickup ------------------------------------------

function cfById(task: Any): Record<string, Any> {
  return Object.fromEntries(
    (task.custom_fields ?? []).map((c: Any) => [c.id, c]),
  );
}
function drop(field: Any): string | undefined {
  if (
    !field ||
    field.value === null ||
    field.value === undefined ||
    field.value === ""
  )
    return undefined;
  const options: Any[] = field.type_config?.options ?? [];
  return options.find(o => o.id === field.value || o.orderindex === field.value)
    ?.name;
}
function isoDate(field: Any): string | undefined {
  const raw = field?.value;
  if (!raw) return undefined;
  const t = new Date(Number(raw));
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString().slice(0, 10);
}

async function profileInputs(today: Day): Promise<Any[]> {
  const tasks: Any[] = [];
  for (let page = 0; page < 6; page++) {
    const d = await clickup(
      `list/${CLIENTS_LIST}/task?include_closed=true&page=${page}`,
    );
    const batch: Any[] = d?.tasks ?? [];
    tasks.push(...batch);
    if (batch.length < 100) break;
  }
  const out: Any[] = [];
  for (const t of tasks) {
    const cf = cfById(t);
    const stage = drop(cf[PROFILE_CF.status]);
    // Same client set the rest of the cockpit shows: no junk rows, no lost sales leads.
    if (!stage && !(cf[CSM_FIELD]?.value ?? []).length) continue;
    if (stage && stage.trim().toUpperCase() === "SALES TEAM TO CONTACT")
      continue;
    if (/playing account/i.test(t.name)) continue;
    const launch = isoDate(cf[PROFILE_CF.launch]);
    const liveDays = launch
      ? Math.round(
          (toDate(today).getTime() - new Date(launch).getTime()) / 86400_000,
        )
      : undefined;
    out.push({
      name: t.name,
      taskId: t.id,
      taskUrl: t.url,
      sheetLink: cf[PROFILE_CF.sheet]?.value,
      driveLink:
        cf[PROFILE_CF.drive]?.value ?? cf[PROFILE_CF.driveFolder]?.value,
      contractLink: cf[PROFILE_CF.contract]?.value,
      profileText: cf[PROFILE_CF.profile]?.value,
      stage,
      happiness: drop(cf[PROFILE_CF.happiness]),
      service: drop(cf[PROFILE_CF.service]),
      adsPlatform: drop(cf[PROFILE_CF.platform]),
      launchDate: launch,
      liveDays,
    });
  }
  return out;
}

async function bridge(fn: string, args: Record<string, unknown>): Promise<Any> {
  const url = process.env.CSM_BRIDGE_URL;
  const token = process.env.CSM_BRIDGE_TOKEN;
  if (!url || !token) throw new Error("csm bridge not configured");
  const res = await fetch(`${url}/bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fn, args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false)
    throw new Error(
      `csm:${fn} → HTTP ${res.status} ${String(body?.error ?? "").slice(0, 200)}`,
    );
  return body.data;
}

function stripNulls(value: Any): Any {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      if (v !== null && v !== undefined) out[k] = stripNulls(v);
    return out;
  }
  return value;
}

/**
 * Build every client profile and push it to the client success cockpit.
 *
 * Batches are written first and the old set is deleted only once they are all
 * in (`commitProfiles`), so a run that dies halfway leaves yesterday's full
 * board rather than a truncated one. When a client's sheet cannot be read, the
 * previously stored numbers are kept and marked stale.
 */
export const push = internalAction({
  args: {},
  returns: v.object({
    profiles: v.number(),
    withSheet: v.number(),
    withLost: v.number(),
    withCalls: v.number(),
    errors: v.array(v.string()),
  }),
  handler: async ctx => {
    const today = kuwaitToday();
    const errors: string[] = [];
    const clients = await profileInputs(today);
    // Client Data is the source of truth for ids and links. The card only has
    // to carry what the CSM owns; anything missing on the card is filled from
    // the sheet, and anything missing on both becomes a gap on the profile.
    let clientData: ClientDataRow[] = [];
    let clientDataOk = false;
    try {
      clientData = await readClientData();
      clientDataOk = clientData.length > 0;
    } catch (e) {
      errors.push(`Client Data: ${String(e).slice(0, 160)}`);
    }
    let visibleAccounts: { name: string; id: string }[] = [];
    try {
      visibleAccounts = (await allAdAccounts()).map(a => ({
        name: String(a.name ?? ""),
        id: String(a.account_id ?? ""),
      }));
    } catch (e) {
      errors.push(`Meta accounts: ${String(e).slice(0, 160)}`);
    }
    for (const c of clients) {
      const row = clientDataFor(clientData, c.name, c.taskId);
      c.data = row;
      c.sheetLink = c.sheetLink || statSheetUrl(row);
      c.driveLink = c.driveLink || row?.driveLink || undefined;
    }
    const campaigns: Any[] = await ctx.runQuery(
      internal.csmSync.campaignsForCsm,
      {},
    );
    const tree: Any[] = await ctx.runQuery(internal.csmSync.metaTreeForCsm, {});

    let accounts = new Map<string, GhlAccount>();
    try {
      accounts = await ghlAccounts();
    } catch (e) {
      errors.push(`GHL token sheet: ${String(e).slice(0, 160)}`);
    }
    let calls: Call[] = [];
    try {
      calls = await fathomCalls(30);
    } catch (e) {
      errors.push(`Fathom: ${String(e).slice(0, 160)}`);
    }
    // Calls the API found are remembered; calls a backfill added stay visible
    // for 90 days even with no key on this deployment.
    const cached: Any[] = await ctx.runQuery(internal.fathomCache.recent, {
      days: 90,
    });

    // Four in flight keeps a 47-client run under the Sheets per-minute read cap.
    const profiles = await pool(clients, 4, async c => {
      const perf = await sheetPerformance(c.sheetLink, today);
      const ads = adsForClient(c.name, campaigns, tree);
      const accountId = ads.find(a => a.accountId)?.accountId;
      let lost: Any;
      const acct = accountFor(accounts, c.name, c.taskId);
      if (acct) {
        try {
          lost = await lostLeads(acct);
        } catch (e) {
          lost = {
            error: String(e).slice(0, 200),
            reasons: [],
            leads: [],
            total: 0,
          };
        }
      }
      const links: Record<string, string> = {};
      for (const [k, val] of Object.entries({
        clickup: c.taskUrl,
        sheet: c.sheetLink,
        drive: c.driveLink,
        ghl: acct
          ? `https://app.maharamedia.com/v2/location/${acct.locationId}/dashboard`
          : undefined,
        adAccount: accountId
          ? `${META_ADS_MANAGER}${String(accountId).replace("act_", "")}`
          : undefined,
        contract: c.contractLink,
      })) {
        if (val) links[k] = String(val);
      }
      return {
        clientName: c.name,
        taskId: c.taskId,
        links,
        ghlName: acct?.name,
        stage: c.stage,
        happiness: c.happiness,
        launchDate: c.launchDate,
        liveDays: c.liveDays,
        service: c.service,
        adsPlatform: c.adsPlatform,
        profileText: c.profileText,
        performance: perf,
        ads,
        live: liveCounts(ads),
        adsAccess: adsAccess(ads),
        lost:
          lost && !lost.error && (lost.reasons.length || lost.leads.length)
            ? lost
            : lost?.error
              ? lost
              : undefined,
        calls: mergeCalls(callsFor(c.name, calls), cached, c.name),
        gapInputs: {
          client: c,
          row: c.data,
          acct,
          lost,
          accountId,
          onBoard: campaigns.some(
            (k: Any) =>
              k.clientName && normTight(k.clientName) === normTight(c.name),
          ),
          visibleAccounts,
          calls: mergeCalls(callsFor(c.name, calls), cached, c.name).length,
          clientDataOk,
        },
        syncedAt: Date.now(),
      };
    });

    // Keep last good numbers where today's read failed.
    let kept = 0;
    for (const p of profiles) {
      if (!(p.performance && p.performance.error)) continue;
      try {
        const previous = await bridge("profileFor", {
          clientName: p.clientName,
        });
        const old = previous?.performance;
        if (old && !old.error) {
          p.performance = {
            ...old,
            staleReason: p.performance.error,
            staleAt: iso(today),
          };
          kept++;
        }
      } catch {
        // no previous profile; the error stays visible on the card
      }
    }
    if (kept)
      console.log(
        `kept last good numbers for ${kept} clients (their sheet was unreadable)`,
      );

    // Gaps are judged after the keep step, so a sheet that was unreadable for
    // one run (quota, a blip) but has last good numbers is not a gap.
    for (const p of profiles as Any[]) {
      p.gaps = gapsFor({ ...p.gapInputs, perf: p.performance });
      p.gapInputs = undefined;
    }

    const syncId = `${iso(today)}-${Date.now()}`;
    for (let i = 0; i < profiles.length; i += PROFILE_BATCH) {
      await bridge("storeProfiles", {
        profiles: stripNulls(profiles.slice(i, i + PROFILE_BATCH)),
        syncId,
      });
    }
    const done = await bridge("commitProfiles", { syncId });
    console.log(
      `profiles: ${profiles.length} pushed, ${JSON.stringify(done)}; ${errors.length} error(s)`,
    );
    return {
      profiles: profiles.length,
      withSheet: profiles.filter(p => p.performance && !p.performance.error)
        .length,
      withLost: profiles.filter(p => p.lost && !p.lost.error).length,
      withCalls: profiles.filter(p => p.calls.length > 0).length,
      errors,
    };
  },
});
