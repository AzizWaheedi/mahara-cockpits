import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import {
  type ClientDataRow,
  clientDataFor,
  readClientData,
} from "./clientData";
import { CLIENTS_LIST, CONTENT_LIST, CREATIVE_LIST, VIDEO_LIST } from "./sync";
import { callTool, googleAccessToken, graph, unwrap } from "./tools";

/**
 * Feed the other two cockpits.
 *
 * The creative director's and the client success cockpits hold no integration
 * credentials of their own. Everything they show arrives through here: this
 * backend reads ClickUp, the sheets and Meta, shapes the rows, and pushes them
 * through each app's `/bridge` door. This replaces `sync_cockpit.py` and the
 * feed half of `csm_app_bridge.py`, which ran on Viktor's side.
 *
 * Runs every 30 minutes (crons.ts) and right after the morning sync.
 */

declare const process: { env: Record<string, string | undefined> };

const TRACKER = "1pBEyClUxPLc4-RdXR8gZ0MxsLkLLFkWJwkiVqVf2rro";
const DATABASE = "1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0";

// biome-ignore lint/suspicious/noExplicitAny: ClickUp payloads
type Any = any;

async function clickup(path: string): Promise<Any> {
  return unwrap(
    await callTool("pd_clickup_proxy_get", {
      url: `https://api.clickup.com/api/v2/${path}`,
    }),
  );
}

async function sheet(id: string, range: string): Promise<string[][]> {
  const res = unwrap(
    await callTool("pd_google_sheets_proxy_get", {
      url: `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`,
    }),
  );
  return (res?.values ?? []) as string[][];
}

/** POST to one of the other cockpits' doors. */
async function bridge(
  app: "creative" | "csm",
  fn: string,
  args: Record<string, unknown>,
) {
  const url =
    process.env[app === "creative" ? "CREATIVE_BRIDGE_URL" : "CSM_BRIDGE_URL"];
  const token =
    process.env[
      app === "creative" ? "CREATIVE_BRIDGE_TOKEN" : "CSM_BRIDGE_TOKEN"
    ];
  if (!url || !token)
    throw new Error(`${app} bridge not configured (URL/TOKEN env)`);
  const res = await fetch(`${url}/bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fn, args: stripNulls(args) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    throw new Error(
      `${app}:${fn} → HTTP ${res.status} ${String(body?.error ?? "").slice(0, 200)}`,
    );
  }
  return body.data;
}

/** Convex optional fields reject an explicit null: drop them at any depth. */
function stripNulls(value: Any): Any {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

// --- Client roster (Clients - Mahara) ---------------------------------------

/**
 * Normalise a client name WITHOUT destroying Arabic: keep any letter or digit
 * in any script and only drop punctuation. [2026-09-07]
 */
function normClient(x: string): string {
  return String(x ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Words that are not a client: matching on them alone attributes half the
// account to whoever happens to be listed first.
const GENERIC_ALIAS = new Set([
  "شركة",
  "مؤسسة",
  "مكتب",
  "شركه",
  "company",
  "the",
  "al",
  "abu",
  "group",
  "construction",
  "contracting",
  "design",
  "industries",
  "mahara",
]);

/** Aliases a tag or campaign name might use for this client. */
function aliasSet(name: string): string[] {
  const n = normClient(name);
  const out = new Set([n]);
  for (const junk of [
    " company",
    " co",
    " w l l",
    " wll",
    " llc",
    " limited",
    " group",
    " contracting",
    " construction",
    " industries",
  ]) {
    if (n.endsWith(junk)) out.add(n.slice(0, -junk.length).trim());
  }
  const parts = n.split(" ");
  if (parts.length > 1 && !GENERIC_ALIAS.has(parts[0])) out.add(parts[0]);
  // Arabic firms are usually "شركة X": the distinguishing word is the second.
  if (parts.length > 1 && GENERIC_ALIAS.has(parts[0]))
    out.add(parts.slice(1).join(" "));
  return [...out].filter(a => a.length > 2 && !GENERIC_ALIAS.has(a)).sort();
}

const CLIENT_FIELDS: Record<string, string> = {
  brandDnaDoc: "🧬 Brand DNA",
  offerCheatSheet: "📈 Offer Cheat Sheet",
  blueprintFormLink: "🧬 Brand Blueprint Form Link",
  // Two Drive fields exist on the board and clients use one or the other.
  driveFolder: "Drive Folder",
  driveLink: "Drive Link",
  sheetLink: "Sheet Link",
  clientHistoryDoc: "Client History Document",
  marketResearchDoc: "Market Research doc",
};

const NOT_A_CLIENT = [
  "videos",
  "footage",
  "launch",
  "access",
  "scripts",
  "dropbox",
  "ad account",
  "ads manager",
];

/** Custom fields by name, dropdown indices resolved to their labels. */
function fieldsOf(t: Any): Record<string, Any> {
  const out: Record<string, Any> = {};
  for (const c of t.custom_fields ?? []) {
    let v = c.value;
    if (
      v === null ||
      v === undefined ||
      v === "" ||
      (Array.isArray(v) && v.length === 0)
    )
      continue;
    if (c.type === "drop_down") {
      const opts = c.type_config?.options ?? [];
      if (typeof v === "number" && v < opts.length) v = opts[v]?.name;
    } else if (c.type === "users") {
      v = (v as Any[])
        .filter(u => u && typeof u === "object")
        .map(u => u.username);
    }
    out[c.name] = v;
  }
  return out;
}

async function gatherClients(): Promise<Any[]> {
  const data = await clickup(`list/${CLIENTS_LIST}/task?include_closed=true`);
  const rows: Any[] = [];
  for (const t of data?.tasks ?? []) {
    const name = String(t.name ?? "").trim();
    const low = name.toLowerCase();
    if (!name || (NOT_A_CLIENT.some(k => low.includes(k)) && name.length > 25))
      continue;
    const f = fieldsOf(t);
    const status = f["Client Status"];
    // No Client Status at all = a checklist row, not a company.
    if (!status) continue;
    const row: Record<string, unknown> = {
      taskId: t.id,
      name,
      url: t.url,
      clientStatus: status,
      happiness: f["Client Happiness"],
      service: f.Service,
      consultationTypes: (f["Consultation Types"] ?? []).filter(
        (c: unknown) => typeof c === "string",
      ),
      aliases: aliasSet(name),
      launchDate: f["Launch Date"] ? Number(f["Launch Date"]) : undefined,
      onboardingCallDate: f["Onboarding Call Date"]
        ? Number(f["Onboarding Call Date"])
        : undefined,
      phone: f["Phone Number"],
      // The Offer Creation dropdown is the only human sign-off on the board.
      offerCreationStatus: f["Offer Creation"],
    };
    for (const [key, label] of Object.entries(CLIENT_FIELDS)) {
      const val = f[label];
      row[key] = typeof val === "string" ? val : undefined;
    }
    rows.push(row);
  }
  return rows;
}

// --- Drive: what is inside each client's folder ----------------------------------

const DRIVE_SCAN_MAX_AGE_H = 6;

function folderId(url: unknown): string | undefined {
  return /\/folders\/([A-Za-z0-9_-]{10,})/.exec(String(url ?? ""))?.[1];
}

/** The subfolders inside one client's Drive folder (footage, scripts, ...). */
async function scanClientDrive(fid: string, token: string) {
  const q = encodeURIComponent(
    `'${fid}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = await res.json();
  if (!res.ok)
    throw new Error(json?.error?.message ?? `Drive HTTP ${res.status}`);
  return ((json.files ?? []) as Any[]).map(f => ({
    name: String(f.name),
    id: String(f.id),
    url: `https://drive.google.com/drive/folders/${f.id}`,
  }));
}

/**
 * Fill driveSubfolders / driveFootage / driveScripts on the roster. Rescanned at
 * most every few hours; anything already cached in the cockpit is reused.
 */
async function attachDriveSubfolders(roster: Any[]) {
  let cache = new Map<string, Any>();
  try {
    const rows: Any[] = (await bridge("creative", "driveCache", {})) ?? [];
    cache = new Map(rows.map(c => [c.name, c]));
  } catch (e) {
    console.warn(
      `drive cache read failed, doing a full scan: ${String(e).slice(0, 120)}`,
    );
  }
  const now = Date.now();
  let token: string | undefined;
  let scanned = 0;
  let dataRows: ClientDataRow[] = [];
  try {
    dataRows = await readClientData();
  } catch (e) {
    console.warn(
      `Client Data unreadable, card links only: ${String(e).slice(0, 120)}`,
    );
  }
  for (const c of roster) {
    const fid =
      folderId(c.driveFolder) ??
      folderId(c.driveLink) ??
      folderId(clientDataFor(dataRows, c.name, c.taskId)?.driveLink);
    if (!fid) continue;
    const old = cache.get(c.name) ?? {};
    const fresh =
      old.driveFolderId === fid &&
      old.driveScannedAt &&
      now - old.driveScannedAt < DRIVE_SCAN_MAX_AGE_H * 3600_000;
    let subs: Any[];
    if (fresh) {
      subs = old.driveSubfolders ?? [];
      c.driveScannedAt = old.driveScannedAt;
    } else {
      try {
        token ??= await googleAccessToken();
        subs = await scanClientDrive(fid, token);
        scanned++;
      } catch (e) {
        console.warn(`drive scan ${c.name}: ${String(e).slice(0, 120)}`);
        subs = old.driveSubfolders ?? [];
      }
      c.driveScannedAt = now;
    }
    c.driveFolderId = fid;
    c.driveSubfolders = subs;
    for (const sub of subs) {
      const n = String(sub.name).toLowerCase();
      if ((n.includes("footage") || n.includes("raw video")) && !c.driveFootage)
        c.driveFootage = sub.url;
      if (n.includes("script") && !c.driveScripts) c.driveScripts = sub.url;
    }
  }
  console.log(
    `drive: ${scanned} folder(s) rescanned, ${roster.filter(r => r.driveScripts).length} with a scripts folder, ${roster.filter(r => r.driveFootage).length} with footage`,
  );
}

// --- Stat sheets: this month's booked / showed / quoted / closed --------------

const MONTH_TABS = [
  "Jan 26",
  "Feb 26",
  "Mar 26",
  "Apr 26",
  "May 26",
  "Jun 26",
  "Jul 26",
  "Aug 26",
  "Sep 26",
  "Oct 26",
  "Nov 26",
  "Dec 26",
];

function sheetIdOf(link: unknown): string | undefined {
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(String(link ?? ""));
  return m?.[1];
}

const yes = (cell: unknown) =>
  String(cell ?? "")
    .trim()
    .toUpperCase()
    .startsWith("Y");

/** Columns are fixed by the template: Name(0) … Show(9) Quotation(10) Closed(11). */
async function readStatSheet(sheetId: string, tab: string) {
  let rows: string[][];
  try {
    rows = await sheet(sheetId, `'${tab}'!A3:L400`);
  } catch {
    return undefined; // an empty or missing tab is not an error
  }
  let booked = 0,
    shows = 0,
    quotes = 0,
    closes = 0;
  for (const r of rows) {
    if (!String(r[0] ?? "").trim()) continue;
    booked++;
    if (yes(r[9])) shows++;
    if (yes(r[10])) quotes++;
    if (yes(r[11])) closes++;
  }
  return booked ? { tab, booked, shows, quotes, closes } : undefined;
}

async function attachStatSheets(roster: Any[]) {
  const tab = MONTH_TABS[new Date(Date.now() + 3 * 3600_000).getUTCMonth()];
  const now = Date.now();
  let read = 0;
  for (const row of roster) {
    const sid = sheetIdOf(row.sheetLink);
    if (!sid) continue;
    const stats = await readStatSheet(sid, tab);
    read++;
    if (stats) row.stats = stats;
    row.statsScannedAt = now;
  }
  console.log(
    `stat sheets: ${read} read, ${roster.filter(r => r.stats).length} with appointments in ${tab}`,
  );
}

// --- The creative director's three boards ------------------------------------

function buildIndex(clients: Any[]): Map<string, Any> {
  const idx = new Map<string, Any>();
  for (const c of clients) {
    for (const a of [normClient(c.name), ...(c.aliases ?? [])])
      if (!idx.has(a)) idx.set(a, c);
  }
  return idx;
}

/** (client names, raw tags). Tags win; the title is the last resort. */
function resolve(
  tags: string[],
  index: Map<string, Any>,
  fallbackTitle?: string,
): [string[], string[]] {
  let names: string[] = [];
  const raw: string[] = [];
  for (const tag of tags) {
    raw.push(tag);
    const hit = index.get(normClient(tag));
    names.push(hit ? hit.name : tag);
  }
  if (names.length === 0 && fallbackTitle) {
    const hit = index.get(normClient(fallbackTitle));
    names = [hit ? hit.name : fallbackTitle];
  }
  return [[...new Set(names)], raw];
}

/**
 * Pull the client out of a ClickUp task title ("<Client> - Brand DNA"). Split
 * on whichever separator comes FIRST.
 */
function clientFromName(name: string): string | undefined {
  const cuts = [" - ", " — ", " · "]
    .map(sep => name.indexOf(sep))
    .filter(i => i >= 0);
  if (cuts.length === 0) return undefined;
  const head = name.slice(0, Math.min(...cuts)).trim();
  return head && !/^\d/.test(head) ? head : undefined;
}

function kindOf(name: string): string {
  const low = name.toLowerCase();
  if (low.includes("brand dna")) return "brandDNA";
  if (low.includes("script request")) return "script";
  if (low.includes("creative onboarding")) return "onboarding";
  if (low.includes("website")) return "website";
  return "other";
}

// The content calendar list was built as a demo and never became real work.
const DEMO_POSTS = ["rm decor", "rmd core", "template"];
function isDemoPost(name: string): boolean {
  const n = String(name ?? "")
    .trim()
    .toLowerCase();
  return !n || n.length < 3 || DEMO_POSTS.some(d => n.startsWith(d));
}

const num = (x: unknown) =>
  x === undefined || x === null || x === "" ? undefined : Number(x);

async function gatherCreative(clients: Any[]) {
  const index = buildIndex(clients);
  const statusByClient = new Map<string, string | undefined>(
    clients.map(c => [c.name, c.clientStatus]),
  );
  const [board, video, content] = await Promise.all([
    clickup(`list/${CREATIVE_LIST}/task?include_closed=true&subtasks=true`),
    clickup(`list/${VIDEO_LIST}/task?include_closed=true&subtasks=true`),
    clickup(`list/${CONTENT_LIST}/task?include_closed=true&subtasks=true`),
  ]);
  const tagNames = (t: Any) =>
    ((t.tags ?? []) as Any[]).map(x => String(x.name ?? ""));

  const tasks = ((board?.tasks ?? []) as Any[]).map(t => {
    const name = String(t.name ?? "");
    const f = fieldsOf(t);
    // Brand DNA rows are the one place the client lives in the title.
    const titleClient = name.includes(" - ") ? clientFromName(name) : undefined;
    const [resolved, rawTags] = resolve(tagNames(t), index, titleClient);
    return {
      taskId: t.id,
      name,
      url: t.url,
      status: String(t.status?.status ?? ""),
      // A task with a parent is a step of the onboarding sequence.
      kind: t.parent ? "onboardingStep" : kindOf(name),
      client: resolved[0],
      clients: resolved.length ? resolved : undefined,
      tags: rawTags.length ? rawTags : undefined,
      clientStatus: resolved[0] ? statusByClient.get(resolved[0]) : undefined,
      parentId: t.parent ?? undefined,
      assignees: ((t.assignees ?? []) as Any[]).map(a =>
        String(a.username ?? ""),
      ),
      dueDate: num(t.due_date),
      createdAt: Number(t.date_created ?? 0),
      updatedAt: Number(t.date_updated ?? 0),
      notes: f["Additional Notes"]
        ? String(f["Additional Notes"]).slice(0, 400)
        : undefined,
    };
  });

  const videos = ((video?.tasks ?? []) as Any[]).map(t => {
    const f = fieldsOf(t);
    const [resolved, rawTags] = resolve(
      tagNames(t),
      index,
      clientFromName(String(t.name ?? "")),
    );
    return {
      taskId: t.id,
      name: String(t.name ?? ""),
      url: t.url,
      status: String(t.status?.status ?? ""),
      client: resolved[0],
      clients: resolved.length ? resolved : undefined,
      tags: rawTags.length ? rawTags : undefined,
      clientStatus: resolved[0] ? statusByClient.get(resolved[0]) : undefined,
      editors: ((f["Assigned Editor"] ?? []) as Any[])
        .filter(Boolean)
        .map(String),
      dueDate: num(t.due_date),
      createdAt: Number(t.date_created ?? 0),
      editedLink: f["Edited Video Link"],
      rawLink: f["Raw Video Link"],
    };
  });

  const posts = ((content?.tasks ?? []) as Any[])
    .filter(t => !isDemoPost(String(t.name ?? "")))
    .map(t => {
      const f = fieldsOf(t);
      return {
        taskId: t.id,
        name: String(t.name ?? ""),
        url: t.url,
        status: String(t.status?.status ?? ""),
        client: clientFromName(String(t.name ?? "")),
        publishDate: num(t.due_date),
        designers: ((f.Designer ?? []) as Any[]).map(String),
        liveLink: f["Live Post Link"],
        designLink: f["Design Link"],
      };
    });

  return { tasks, videos, posts };
}

// --- Funnels: one row per destination per ad account ---------------------------

const GATE_HINTS = [
  "project",
  "مشروع",
  "budget",
  "ميزاني",
  "when",
  "متى",
  "timeline",
  "size",
  "مساحة",
  "type",
  "نوع",
  "stage",
  "مرحل",
  "own",
  "تملك",
  "location",
  "منطق",
  "service",
  "خدم",
];
const CONTACT_TYPES = new Set([
  "FULL_NAME",
  "FIRST_NAME",
  "LAST_NAME",
  "PHONE",
  "EMAIL",
  "CITY",
  "STATE",
  "COUNTRY",
  "ZIP",
  "STREET_ADDRESS",
  "COMPANY_NAME",
]);
// Mahara's own lead gen account is B2B and plays by different rules: excluded.
const OWN_ACCOUNTS = new Set(["maharamedia", "mahara media"]);

/** Pull the destination out of a creative, whatever shape Meta used. */
function destination(ad: Any) {
  const found: { formId?: string; url?: string } = {};
  const scan = (node: Any) => {
    if (Array.isArray(node)) for (const v of node) scan(v);
    else if (node && typeof node === "object") {
      if (node.lead_gen_form_id) found.formId = String(node.lead_gen_form_id);
      for (const key of ["link", "link_url", "website_url"]) {
        const val = node[key];
        if (typeof val === "string" && val.startsWith("http") && !found.url)
          found.url = val;
      }
      for (const v of Object.values(node)) scan(v);
    }
  };
  scan(ad.creative ?? {});
  const url = found.url ?? "";
  const dtype = String(ad.adset?.destination_type ?? "");
  const kind = found.formId
    ? "Instant form"
    : url.includes("whatsapp") || dtype === "WHATSAPP"
      ? "WhatsApp"
      : url.includes("instagram.com") && !url.includes("direct")
        ? "Instagram"
        : url.includes("fb.me") || url.includes("facebook.com")
          ? "Facebook"
          : url
            ? "Landing page"
            : ["ON_POST", "ON_VIDEO", "ON_PAGE"].includes(dtype)
              ? "Stays on the post"
              : "Unknown";
  return { kind, url: found.url, formId: found.formId };
}

async function gatherFunnels(): Promise<Any[]> {
  const rows = await sheet(TRACKER, "'data_fb'!A3:Y11005");
  const since = new Date(Date.now() - 30 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const ads = new Map<string, Any>();
  for (const r of rows) {
    if (r.length < 19 || !r[0] || r[0] < since || !r[16]) continue;
    if (
      OWN_ACCOUNTS.has(
        String(r[1] ?? "")
          .trim()
          .toLowerCase(),
      )
    )
      continue;
    const a = ads.get(r[16]) ?? {
      account: r[1],
      adName: r[17],
      status: r[18],
      spend: 0,
      leads: 0,
    };
    a.spend += Number(r[4] || 0) || 0;
    a.leads += Number(r[5] || 0) || 0;
    ads.set(r[16], a);
  }
  const live = [...ads.entries()]
    .filter(([, v]) => ["ACTIVE", "WITH_ISSUES"].includes(v.status))
    .map(([k]) => k);
  if (live.length === 0) {
    console.log("funnels: no live ads in the window");
    return [];
  }
  const fields =
    "name,effective_status,creative{object_story_spec,asset_feed_spec,link_url,effective_object_story_id},adset{destination_type,name}";
  const meta: Record<string, Any> = {};
  for (let i = 0; i < live.length; i += 40) {
    try {
      Object.assign(
        meta,
        await graph<Record<string, Any>>("", {
          ids: live.slice(i, i + 40).join(","),
          fields,
        }),
      );
    } catch (e) {
      console.warn(
        `funnels: ad batch failed, skipped — ${String(e).slice(0, 120)}`,
      );
    }
  }
  const groups = new Map<string, Any>();
  const formIds = new Set<string>();
  for (const [adId, ad] of Object.entries(meta)) {
    const row = ads.get(adId);
    if (!row) continue;
    const d = destination(ad);
    const key = `${row.account}|${d.formId ?? d.url ?? d.kind}`;
    const g = groups.get(key) ?? {
      account: row.account,
      kind: d.kind,
      url: d.url,
      formId: d.formId,
      spend: 0,
      leads: 0,
      ads: [],
    };
    g.spend += row.spend;
    g.leads += row.leads;
    g.ads.push({
      adId,
      adName: row.adName,
      status: ad.effective_status ?? row.status,
    });
    groups.set(key, g);
    if (d.formId) formIds.add(d.formId);
  }
  const forms: Record<string, Any> = {};
  const fl = [...formIds].sort();
  for (let i = 0; i < fl.length; i += 40) {
    try {
      Object.assign(
        forms,
        await graph<Record<string, Any>>("", {
          ids: fl.slice(i, i + 40).join(","),
          fields:
            "name,status,leads_count,questions,question_page_custom_headline,follow_up_action_url",
        }),
      );
    } catch (e) {
      console.warn(
        `funnels: form batch failed, skipped — ${String(e).slice(0, 120)}`,
      );
    }
  }
  const out: Any[] = [];
  for (const g of groups.values()) {
    const form = forms[g.formId ?? ""] ?? {};
    const questions = ((form.questions ?? []) as Any[]).map(q => {
      const label = String(q.label ?? q.key ?? "");
      const qtype = String(q.type ?? "");
      const low = label.toLowerCase();
      return {
        label,
        type: qtype,
        options: ((q.options ?? []) as Any[]).map(o =>
          String(o.value ?? o.key ?? ""),
        ),
        isGate:
          !CONTACT_TYPES.has(qtype) && GATE_HINTS.some(h => low.includes(h)),
      };
    });
    out.push({
      account: g.account,
      kind: g.kind,
      url: g.url,
      formId: g.formId,
      formName: form.name,
      formStatus: form.status,
      headline: form.question_page_custom_headline,
      followUpUrl: form.follow_up_action_url,
      leadsAllTime: Number(form.leads_count ?? 0) || undefined,
      questions,
      gates: questions.filter(q => q.isGate).length,
      spend: Math.round(g.spend * 100) / 100,
      leads: g.leads,
      cpl: g.leads ? Math.round((g.spend / g.leads) * 100) / 100 : undefined,
      ads: g.ads.sort((a: Any, b: Any) =>
        String(a.adName).localeCompare(String(b.adName)),
      ),
    });
  }
  out.sort(
    (a, b) =>
      b.spend - a.spend || String(a.account).localeCompare(String(b.account)),
  );
  return out;
}

// --- Client Data overlay for the CSM feed --------------------------------------

function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Service Mode and report sheet links off the Client Data tab, keyed by name. */
async function clientDataOverlay() {
  const rows = await sheet(DATABASE, "'Client Data'!A1:S200");
  const head = rows[0] ?? [];
  const col = (n: string) => head.indexOf(n);
  const modes = new Map<string, string>();
  const sheets = new Map<string, string>();
  for (const r of rows.slice(1)) {
    const name = r[col("Client Name")];
    if (!name) continue;
    const mode = String(r[col("Service Mode")] ?? "").trim();
    const link = String(r[col("Sheet Link")] ?? "").trim();
    if (mode) modes.set(norm(name), mode);
    if (link.startsWith("http")) sheets.set(norm(name), link);
  }
  return { modes, sheets };
}

// --- The runs -------------------------------------------------------------------

/** Everything the creative director's cockpit shows. */
export const feedCreative = internalAction({
  args: { withStats: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, { withStats }): Promise<unknown> => {
    const report: Record<string, unknown> = {};
    const fail = (step: string, e: unknown) => {
      report[step] = `FAILED ${String(e).slice(0, 200)}`;
      console.error(`creative feed ${step}: ${String(e).slice(0, 300)}`);
    };

    let roster: Any[] = [];
    try {
      roster = await gatherClients();
      await attachDriveSubfolders(roster);
      // Stat sheets are filled by hand through the day: read on the full run only.
      if (withStats) await attachStatSheets(roster);
      report.clients = roster.length
        ? await bridge("creative", "storeClients", { clients: roster })
        : "empty, kept";
    } catch (e) {
      fail("clients", e);
    }

    try {
      const cre = await gatherCreative(roster);
      report.boards = await bridge("creative", "storeCreative", cre);
    } catch (e) {
      fail("boards", e);
    }

    // Read back the scoped rows the media buyer's sync stored, rather than
    // recomputing them: one source of truth for what a campaign earned.
    try {
      const ads: Any = await ctx.runQuery(
        internal.sync.exportAdPerformance,
        {},
      );
      report.performance = ads?.ads?.length
        ? await bridge("creative", "storeAdPerformance", {
            ads: ads.ads,
            campaigns: ads.campaigns ?? [],
            tree: ads.tree ?? [],
          })
        : "no ads in scope, skipped";
    } catch (e) {
      fail("performance", e);
    }

    try {
      const rows = await gatherFunnels();
      report.funnels = rows.length
        ? await bridge("creative", "storeFunnels", { rows })
        : "none live, kept";
    } catch (e) {
      fail("funnels", e);
    }

    // The creative director's "What works" page IS the media buyer's page:
    // same rows, one definition of a proven play in the company.
    try {
      const plays: Any[] = await ctx.runQuery(internal.fanout.rawPlays, {});
      report.plays = plays.length
        ? await bridge("creative", "storePlays", { plays })
        : "none, kept";
    } catch (e) {
      fail("plays", e);
    }
    try {
      const won: Any[] = await ctx.runQuery(internal.fanout.winnerRows, {});
      report.winners = won.length
        ? await bridge("creative", "storeWinners", { rows: won })
        : "none, kept";
    } catch (e) {
      fail("winners", e);
    }
    console.log(`creative feed: ${JSON.stringify(report)}`);
    return report;
  },
});

/** Everything the client success cockpit shows. */
export const feedCsm = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<{ clients: number; errors: string[] }> => {
    const errors: string[] = [];
    let clients = 0;
    try {
      const payload: Any = await ctx.runAction(
        internal.csmSync.buildCsmSnapshot,
        {},
      );
      if (!payload || !Array.isArray(payload.clients))
        throw new Error("no snapshot built");
      // Client Data overlay: the sheet's Service Mode wins over the ClickUp
      // field, and missing report sheets are filled from the database.
      try {
        const { modes, sheets } = await clientDataOverlay();
        for (const c of payload.clients) {
          const key = norm(c.name);
          const mode = modes.get(key);
          if (mode)
            c.service = /dwy|done with/i.test(mode)
              ? "DWY"
              : (c.service ?? mode);
          if (mode) c.dwy = /dwy|done with/i.test(mode);
          if (!c.sheetLink && sheets.get(key)) c.sheetLink = sheets.get(key);
        }
      } catch (e) {
        errors.push(`client data overlay: ${String(e).slice(0, 200)}`);
      }
      await bridge("csm", "store", {
        clients: payload.clients,
        tasks: payload.tasks,
        checks: payload.checks,
      });
      clients = payload.clients.length;
    } catch (e) {
      errors.push(`client feed: ${String(e).slice(0, 200)}`);
      console.error(`csm feed: ${String(e).slice(0, 300)}`);
    }
    // The client cards: sheet numbers, lost leads, ads, calls. Its own action so a
    // slow sheet never delays the roster above.
    let profiles = 0;
    try {
      const out: Any = await ctx.runAction(internal.csmProfiles.push, {});
      profiles = out.profiles;
      errors.push(...(out.errors ?? []));
    } catch (e) {
      errors.push(`client profiles: ${String(e).slice(0, 200)}`);
      console.error(`csm profiles: ${String(e).slice(0, 300)}`);
    }
    try {
      await bridge("csm", "recordHealth", {
        ok: errors.length === 0,
        clients,
        profiles,
        errors,
      });
    } catch (e) {
      console.error(`csm health: ${String(e).slice(0, 200)}`);
    }
    console.log(`csm feed: ${clients} clients, ${errors.length} error(s)`);
    return { clients, errors };
  },
});

/** Both feeds. Woken by the cron and after the morning sync. */
export const runFanout = internalAction({
  args: { withStats: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, { withStats }): Promise<unknown> => {
    const drains = await ctx.runAction(internal.outboxDrains.drainAll, {});
    const creative = await ctx.runAction(internal.fanout.feedCreative, {
      withStats,
    });
    const csm = await ctx.runAction(internal.fanout.feedCsm, {});
    let comms: unknown;
    try {
      comms = await ctx.runAction(internal.comms.feedComms, {});
    } catch (e) {
      comms = `FAILED ${String(e).slice(0, 200)}`;
    }
    return { drains, creative, csm, comms };
  },
});

// --- Read-side helpers for the mirrors (internal, so the door can be closed) ----

export const rawPlays = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    (await ctx.db.query("marketPlays").collect()).map(
      ({ _id, _creationTime, syncedAt, ...rest }) => rest,
    ),
});

const WINNER_KEEP = new Set([
  "adId",
  "adName",
  "client",
  "serviceLine",
  "city",
  "language",
  "format",
  "cta",
  "headline",
  "body",
  "transcript",
  "hook",
  "voice",
  "previewSrc",
  "thumbUrl",
  "playType",
  "interests",
  "copyTraits",
  "spend",
  "leads",
  "cpl",
  "wonFrom",
  "wonTo",
  "stillLive",
  "retiredOn",
]);

export const winnerRows = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    (await ctx.db.query("winnersArchive").collect())
      .sort((a: Any, b: Any) => (a.cpl ?? 0) - (b.cpl ?? 0))
      .slice(0, 500)
      .map((r: Any) =>
        Object.fromEntries(
          Object.entries(r).filter(
            ([k, v]) => WINNER_KEEP.has(k) && v !== null && v !== undefined,
          ),
        ),
      ),
});
