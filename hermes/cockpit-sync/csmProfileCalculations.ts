import type {Row} from './runtime';
import type {ClientDataRow} from './csmProducer';
export const PROFILE_CF: Record<string,string> = {
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
  dosDonts: "0f06a523-64f9-4f20-90a1-f76cb6f85318",
};
const CSM_FIELD = "68ff84db-6c66-4e70-8e72-15d70828fda6";
const COL: Record<string,number> = {
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
export const MONTHS = [
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
export async function pool<T, R>(
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
export function valid(y: number, m: number, d: number): Day | undefined {
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
export function parseAdded(cell: unknown, today: Day): Day | undefined {
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
export function parseAppt(
  cell: unknown,
  today: Day,
  added?: Day,
): Day | undefined {
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

type Appt = Row;

/** Normalise the Appointments log into one record per lead. */
export function appointmentRows(rows: string[][], today: Day): Appt[] {
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
export function summarise(rows: Appt[]) {
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
export function staleRows(rows: Appt[], minAge = 2): Appt[] {
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
export function byAd(rows: Appt[]) {
  const seen = new Map<string, Row>();
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
export function normLoose(name: unknown): string {
  return String(name ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\b(company|co|llc|w\.l\.l|wll|group|designs?|design)\b/g, " ")
    .replace(/[^a-z0-9؀-ۿ]+/g, "");
}

const LIVE = /active/i;

export function adsForClient(client: string, campaigns: Row[], tree: Row[]) {
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
        // Ids and saved stills travel with each ad; the live preview is
        // fetched from the media buyer when the CSM opens one.
        adsets: adsets.map(a => ({
          name: a.name,
          metaId: a.metaId,
          status: a.effectiveStatus ?? a.status,
          ads: ads
            .filter(ad => ad.adsetId === a.metaId)
            .map(ad => ({
              name: ad.name,
              status: ad.effectiveStatus ?? ad.status,
              metaId: ad.metaId,
              accountId:
                ad.accountId ??
                (c.metaAccountId
                  ? String(c.metaAccountId).replace(/^act_/, "")
                  : undefined),
              stillKey: ad.stillKey,
              stillUrl: ad.stillUrl,
              stillTinyUrl: ad.stillTinyUrl,
              thumbUrl: ad.thumbUrl,
            })),
        })),
      };
    });
}

export function liveCounts(ads: Row[]) {
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

export function adsAccess(ads: Row[]): string {
  if (ads.length === 0) return "no_campaigns";
  if (!ads.some(c => c.adsets?.length)) return "no_access";
  return "ok";
}

// --- Lost leads, from the client's own GHL sub-account --------------------------

export function normTight(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, "");
}

/**
 * The client's Meta ad account, from what we can see. A matched campaign's
 * account first; else the Database sheet's "Ad Account - Meta" (an id or the
 * account's exact name); else a visible account whose name starts like the
 * client's. Aziz, 2026-09-12: "it should automatically be scanning the
 * database for their ad account", City Wood being the case in point.
 */
export function metaAccountFor(
  clientName: string,
  row: ClientDataRow | undefined,
  campaignAccountId: string | undefined,
  visible: { name: string; id: string }[],
): { id: string; visible: boolean } | undefined {
  if (campaignAccountId)
    return { id: String(campaignAccountId).replace("act_", ""), visible: true };
  const raw = String(row?.adAccountMeta ?? "").trim();
  const digits = raw.replace(/^act_/, "").match(/\d{6,}/)?.[0];
  if (digits && visible.some(a => a.id === digits))
    return { id: digits, visible: true };
  const wanted = raw && !digits ? normTight(raw) : "";
  const byName = wanted
    ? visible.find(a => normTight(a.name) === wanted)
    : undefined;
  if (byName) return { id: byName.id, visible: true };
  const n = normTight(clientName);
  const byPrefix = visible.find(a => {
    const k = normTight(a.name);
    return (
      k.length >= 5 && n.length >= 5 && (k.startsWith(n) || n.startsWith(k))
    );
  });
  if (byPrefix) return { id: byPrefix.id, visible: true };
  // On record but not shared with Mahara's business yet: link it, flag it.
  if (digits) return { id: digits, visible: false };
  return undefined;
}

export type GhlAccount = {
  name: string;
  clickupId: string;
  locationId: string;
  token: string;
};
export function accountFor(
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
export type Call = {
  title: string;
  at: string;
  host?: string;
  external: string[];
  url?: string;
  summary?: string;
};
export function callsFor(client: string, calls: Call[]): Call[] {
  const full = normTight(client);
  if (full.length < 4) return [];
  const first = normTight(client.split(/[\s\-_/(),]+/)[0] ?? "");
  const generic =
    /^(company|design|designs|group|contracting|engineering|general|trading|construction|interior|interiors|studio|the|al|شركة|مؤسسة)$/;
  const keys = [full];
  if (first.length >= 5 && !generic.test(first)) keys.push(first);
  return calls
    .filter(c => {
      const hay = normTight([c.title, ...c.external].join(" "));
      return keys.some(k => hay.includes(k));
    })
    .slice(0, 8);
}

type Gap = { gap: string; label: string; fix: string };

/**
 * What is missing for one client, and where to put it. Computed here because
 * this is the only place that sees the card, Client Data, Meta and GHL at once.
 * Pre-launch stages skip the things that only exist once ads run.
 */
export function gapsFor(x: {
  client: Row;
  row?: ClientDataRow;
  perf?: Row;
  acct?: Row;
  lost?: Row;
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

/** The ad-lead roll-up for one client, matched by name or first word. */
export function adLeadsFor(client: string, all: Record<string, Row>): Row | undefined {
  const key = normTight(client);
  if (all[key]) return all[key];
  const first = normTight(client.split(/[\s\-_/(),]+/)[0] ?? "");
  const hit = Object.keys(all).find(
    k =>
      k.length >= 5 &&
      (k.startsWith(key) ||
        key.startsWith(k) ||
        (first.length >= 5 && k.startsWith(first))),
  );
  return hit ? all[hit] : undefined;
}

/** API matches merged with cached profile calls, deduplicated by url or title+timestamp, newest first. */
export function mergeCalls(fresh: Call[], cached: Row[], client: string): Row[] {
  const callKey = (r: Row): string => {
    const u = typeof r.url === "string" ? r.url.trim() : "";
    if (u) return `url:${u}`;
    return `json:${JSON.stringify([String(r.title ?? "").trim(), String(r.at ?? "").trim()])}`;
  };

  const validCached = cached.filter(r => !r.clientName || r.clientName === client);

  const mergedMap = new Map<string, Row>();

  for (const c of validCached) {
    const k = callKey(c);
    mergedMap.set(k, { ...c, clientName: client });
  }

  for (const f of fresh) {
    const fRow: Row = { ...f, kind: "client" };
    if (fRow.clientName && fRow.clientName !== client) {
      continue;
    }
    const k = callKey(fRow);
    const existing = mergedMap.get(k);
    if (existing) {
      const refreshed: Row = { ...existing };
      for (const field of ["title", "at", "host", "external", "url", "summary", "kind"] as const) {
        if (fRow[field] !== undefined) {
          refreshed[field] = fRow[field];
        }
      }
      refreshed.clientName = client;
      mergedMap.set(k, refreshed);
    } else {
      mergedMap.set(k, { ...fRow, clientName: client });
    }
  }

  const out = Array.from(mergedMap.values());
  out.sort((a, b) => (String(a.at) < String(b.at) ? 1 : -1));
  return out;
}

// --- Inputs: the client rows off Clickup ------------------------------------------

export function cfById(task: Row): Record<string, Row> {
  return Object.fromEntries(
    (task.custom_fields ?? []).map((c: Row) => [c.id, c]),
  );
}
export function drop(field: Row): string | undefined {
  if (
    !field ||
    field.value === null ||
    field.value === undefined ||
    field.value === ""
  )
    return undefined;
  const options: Row[] = field.type_config?.options ?? [];
  return options.find(o => o.id === field.value || o.orderindex === field.value)
    ?.name;
}
export function isoDate(field: Row): string | undefined {
  const raw = field?.value;
  if (!raw) return undefined;
  const t = new Date(Number(raw));
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString().slice(0, 10);
}

const NEGATIVE = /^(don'?t|do not|never|avoid|no|not|stop|without)\b/i;
const TICK_DO = /^(✅|✓|✔️?|☑️?)\s*/u;
const TICK_DONT = /^(❌|✕|✖️?|⛔|🚫)\s*/u;
export function cleanDosDonts(raw: string): { text: string; notes: string[] } {
  const out = {
    do: [] as string[],
    dont: [] as string[],
    notes: [] as string[],
  };
  let current: "do" | "dont" | "notes" | undefined;
  const add = (
    section: "do" | "dont" | "notes" | undefined,
    raw: string,
    tick?: "do" | "dont",
  ) => {
    let item = raw
      .replace(/\s+/g, " ")
      .replace(/\.\s+\(/g, " (")
      .trim();
    if (!item) return;
    if (/^[a-z][a-z\s]/.test(item))
      item = item[0].toUpperCase() + item.slice(1);
    item = item.replace(/^dont\b/i, "Don't");
    const target: "do" | "dont" | "notes" = NEGATIVE.test(item)
      ? "dont"
      : (tick ?? section ?? "do");
    const key = item.toLowerCase();
    if (!out[target].some(x => x.toLowerCase() === key)) out[target].push(item);
  };
  for (const rawLine of String(raw ?? "")
    .replace(/\r/g, "")
    .split("\n")) {
    let line = rawLine
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/^[#>\s]+/, "")
      .replace(/^\*+|\*+$/g, "")
      .trim();
    const bulleted = /^(?:[-•*–—]|\d+[.)])\s+/.test(line);
    line = line
      .replace(/^(?:[-•*–—]|\d+[.)])\s+/, "")
      .replace(/^\*+|\*+$/g, "")
      .trim();
    let tick: "do" | "dont" | undefined;
    if (TICK_DO.test(line)) tick = "do";
    else if (TICK_DONT.test(line)) tick = "dont";
    line = line.replace(TICK_DO, "").replace(TICK_DONT, "").trim();
    if (!line || /^do'?s\s*(&|and)\s*don'?ts:?$/i.test(line)) continue;
    const head = bulleted
      ? null
      : /^(do'?s|do|don'?ts|don'?t|notes?)\s*(?::\s*(.*))?$/i.exec(line);
    if (head) {
      const h = head[1].toLowerCase();
      current = h.startsWith("don")
        ? "dont"
        : h.startsWith("note")
          ? "notes"
          : "do";
      if (head[2]?.trim()) add(current, head[2]);
      continue;
    }
    add(current, line, tick);
  }
  const block = (title: string, items: string[]) =>
    items.length ? `${title}\n${items.map(i => `- ${i}`).join("\n")}` : "";
  return {
    text: [block("DO", out.do), block("DON'T", out.dont)]
      .filter(Boolean)
      .join("\n\n"),
    notes: out.notes,
  };
}

export function adLeadsByClient(campaigns:Row[],dailyStats:Row[],at=Date.now()) {
    const byCampaign = new Map<string, string>();
    for (const c of campaigns) {
      const key = c.clientName
        ? normTight(c.clientName)
        : c.clientTag
          ? c.clientTag
          : (c.tags ?? [])[0];
      if (key) byCampaign.set(c.campaignName, key);
    }
    const now = new Date(at + 3 * 3600_000);
    const ym = (d: Date) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const thisMonth = ym(now);
    const lastMonth = ym(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    );
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400_000)
      .toISOString()
      .slice(0, 10);
    const out: Record<
      string,
      {
        month: number;
        lastMonth: number;
        last7d: number;
        allTime: number;
        spendMonth: number;
        spendAllTime: number;
        firstDay?: string;
        campaigns: string[];
        daily: Record<string, { leads: number; spend: number }>;
      }
    > = {};
    for (const d of dailyStats) {
      const key = byCampaign.get(d.campaignName);
      if (!key) continue;
      if (!out[key])
        out[key] = {
          month: 0,
          lastMonth: 0,
          last7d: 0,
          allTime: 0,
          spendMonth: 0,
          spendAllTime: 0,
          campaigns: [],
          daily: {},
        };
      const row = out[key];
      const leads = Number(d.leads ?? 0);
      const spend = Number(d.spend ?? 0);
      row.allTime += leads;
      row.spendAllTime += spend;
      if (d.date.startsWith(thisMonth)) {
        row.month += leads;
        row.spendMonth += spend;
      }
      if (d.date.startsWith(lastMonth)) row.lastMonth += leads;
      if (d.date >= sevenDaysAgo) row.last7d += leads;
      if (!row.firstDay || d.date < row.firstDay) row.firstDay = d.date;
      if (!row.campaigns.includes(d.campaignName))
        row.campaigns.push(d.campaignName);
      // The whole history, one row per day, so "all time" and custom spans
      // add up in the app without another Meta call.
      if (!row.daily[d.date]) row.daily[d.date] = { leads: 0, spend: 0 };
      row.daily[d.date].leads += leads;
      row.daily[d.date].spend += spend;
    }
    for (const r of Object.values(out)) {
      r.spendMonth = Math.round(r.spendMonth * 100) / 100;
      r.spendAllTime = Math.round(r.spendAllTime * 100) / 100;
    }
    // Arabic client names cannot be object keys in a Convex value; hand back
    // rows, with the daily grain as an array for the same reason.
    return Object.entries(out).map(([key, r]) => ({
      key,
      ...r,
      daily: Object.entries(r.daily)
        .map(([date, v]) => ({
          date,
          leads: v.leads,
          spend: Math.round(v.spend * 100) / 100,
        }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    }));
}
