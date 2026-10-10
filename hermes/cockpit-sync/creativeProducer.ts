// Pure source shaping ported from media buyer fanout; no legacy service runtime.
import {type Row, callTool, graph, unwrap, recordLog, assertNativeFence} from './runtime';
import {CLIENTS_LIST, CREATIVE_LIST, VIDEO_LIST, CONTENT_LIST} from './calculator';
import {latestUpdates} from './clientUpdates';
import {withoutExcludedAds} from './excludedAds';
const TRACKER = '1pBEyClUxPLc4-RdXR8gZ0MxsLkLLFkWJwkiVqVf2rro';
async function clickup(path: string): Promise<Row> { const data = unwrap(await callTool('pd_clickup_proxy_get', {url: `https://api.clickup.com/api/v2/${path}`})); if (!Array.isArray(data.tasks)) throw new Error('ClickUp did not return a complete task collection'); return data; }
async function sheet(id: string, range: string): Promise<string[][]> { const data = unwrap(await callTool('pd_google_sheets_proxy_get', {url: `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`})); if (!Array.isArray(data.values)) throw new Error('Tracker sheet is unavailable'); return data.values; }
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
const GENERIC_ALIAS: Record<string,true> = {
  "شركة":true,"مؤسسة":true,"مكتب":true,"شركه":true,
  company:true,the:true,al:true,abu:true,group:true,construction:true,
  contracting:true,design:true,industries:true,mahara:true,
};

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
  if (parts.length > 1 && !Object.hasOwn(GENERIC_ALIAS,parts[0])) out.add(parts[0]);
  // Arabic firms are usually "شركة X": the distinguishing word is the second.
  if (parts.length > 1 && Object.hasOwn(GENERIC_ALIAS,parts[0]))
    out.add(parts.slice(1).join(" "));
  return [...out].filter(a => a.length > 2 && !Object.hasOwn(GENERIC_ALIAS,a)).sort();
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
  // One list per client, read by all three cockpits and by Hermes.
  dosDonts: "Do's & Don'ts",
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
function fieldsOf(t: Row): Record<string, Row> {
  const out: Record<string, Row> = {};
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
      v = (v as Row[])
        .filter(u => u && typeof u === "object")
        .map(u => u.username);
    }
    out[c.name] = v;
  }
  return out;
}

async function gatherClients(): Promise<Row[]> {
  const data = await clickup(`list/${CLIENTS_LIST}/task?include_closed=true`);
  const rows: Row[] = [];
  for (const t of data?.tasks ?? []) {
    const name = String(t.name ?? "").trim();
    const low = name.toLowerCase();
    // Aziz, 2026-09-10: "ignore the Ziad playing account completely."
    if (/playing account/i.test(name)) continue;
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

function buildIndex(clients: Row[]): Map<string, Row> {
  const idx = new Map<string, Row>();
  for (const c of clients) {
    for (const a of [normClient(c.name), ...(c.aliases ?? [])])
      if (!idx.has(a)) idx.set(a, c);
  }
  return idx;
}

/** (client names, raw tags). Tags win; the title is the last resort. */
function resolve(
  tags: string[],
  index: Map<string, Row>,
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
  // The director triages creative requests in the existing script work queue.
  if (low.includes("script request") || low.includes("creative request"))
    return "script";
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

async function gatherCreative(clients: Row[]) {
  const index = buildIndex(clients);
  const statusByClient = new Map<string, string | undefined>(
    clients.map(c => [c.name, c.clientStatus]),
  );
  const [board, video, content] = await Promise.all([
    clickup(`list/${CREATIVE_LIST}/task?include_closed=true&subtasks=true`),
    clickup(`list/${VIDEO_LIST}/task?include_closed=true&subtasks=true`),
    clickup(`list/${CONTENT_LIST}/task?include_closed=true&subtasks=true`),
  ]);
  const tagNames = (t: Row) =>
    ((t.tags ?? []) as Row[]).map(x => String(x.name ?? ""));

  const tasks = ((board?.tasks ?? []) as Row[]).map(t => {
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
      assignees: ((t.assignees ?? []) as Row[]).map(a =>
        String(a.username ?? ""),
      ),
      dueDate: num(t.due_date),
      createdAt: Number(t.date_created ?? 0),
      updatedAt: Number(t.date_updated ?? 0),
      notes: f["Additional Notes"]
        ? String(f["Additional Notes"]).slice(0, 400)
        : undefined,
      // The script itself: the task's description, for the creative cockpit's
      // "Scripts we made" page (Aziz, 2026-09-18). Script tasks only.
      script:
        kindOf(name) === "script" && !t.parent
          ? String(t.description ?? t.text_content ?? "")
              .trim()
              .slice(0, 12000) || undefined
          : undefined,
    };
  });

  const videos = ((video?.tasks ?? []) as Row[]).map(t => {
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
      editors: ((f["Assigned Editor"] ?? []) as Row[])
        .filter(Boolean)
        .map(String),
      dueDate: num(t.due_date),
      createdAt: Number(t.date_created ?? 0),
      editedLink: f["Edited Video Link"],
      rawLink: f["Raw Video Link"],
    };
  });

  const posts = ((content?.tasks ?? []) as Row[])
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
        designers: ((f.Designer ?? []) as Row[]).map(String),
        liveLink: f["Live Post Link"],
        designLink: f["Design Link"],
      };
    });

  const requestLinks = ((video?.tasks ?? []) as Row[]).flatMap(t => {
    const brief = String(t.description ?? t.text_content ?? "");
    const scriptTaskId = brief.match(
      /Script task:\s*https?:\/\/app\.clickup\.com\/t\/([\w-]+)/i,
    )?.[1];
    if (!scriptTaskId) return [];
    const f = fieldsOf(t);
    return [
      {
        scriptTaskId,
        editorTaskId: String(t.id),
        editorTaskUrl: String(t.url ?? `https://app.clickup.com/t/${t.id}`),
        assetUrl:
          typeof f["Edited Video Link"] === "string"
            ? f["Edited Video Link"]
            : null,
      },
    ];
  });
  return { tasks, videos, posts, requestLinks };
}

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
const CONTACT_TYPES: Record<string,true> = {
  FULL_NAME:true,FIRST_NAME:true,LAST_NAME:true,PHONE:true,EMAIL:true,CITY:true,
  STATE:true,COUNTRY:true,ZIP:true,STREET_ADDRESS:true,COMPANY_NAME:true,
};
// Mahara's own lead gen account is B2B and plays by different rules: excluded.
const OWN_ACCOUNTS: Record<string,true> = {maharamedia:true,"mahara media":true};

/** Pull the destination out of a creative, whatever shape Meta used. */
function destination(ad: Row) {
  const found: { formId?: string; url?: string } = {};
  const scan = (node: Row) => {
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

export async function gatherFunnels(prior:Row[]=[]): Promise<Row[]> {
  const rows = withoutExcludedAds(await sheet(TRACKER, "'data_fb'!A3:Y11005"));
  const since = new Date(Date.now() - 30 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const ads = new Map<string, Row>();
  for (const r of rows) {
    if (r.length < 19 || !r[0] || r[0] < since || !r[16]) continue;
    if (Object.hasOwn(OWN_ACCOUNTS,String(r[1] ?? "").trim().toLowerCase())) continue;
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
    recordLog("log","funnels: no live ads in the window");
    return [];
  }
  const fields =
    "name,effective_status,creative{object_story_spec,asset_feed_spec,link_url,effective_object_story_id},adset{destination_type,name}";
  const meta: Record<string, Row> = {};
  for (let i = 0; i < live.length; i += 40) {
    try {
      Object.assign(
        meta,
        await graph<Record<string, Row>>("", {
          ids: live.slice(i, i + 40).join(","),
          fields,
        }),
      );
    } catch (e) {
      recordLog("error",
        `funnels: ad batch failed, skipped — ${String(e).slice(0, 120)}`,
      );
    }
  }
  const groups = new Map<string, Row>();
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
  const forms: Record<string, Row> = {};
  const fl = [...formIds].sort();
  for (let i = 0; i < fl.length; i += 40) {
    try {
      Object.assign(
        forms,
        await graph<Record<string, Row>>("", {
          ids: fl.slice(i, i + 40).join(","),
          nativeFormMetadata: true,
          fields:
            "name,status,leads_count,questions,question_page_custom_headline,follow_up_action_url",
        }),
      );
    } catch (e) {
      recordLog("error",
        `funnels: form batch failed, skipped — ${String(e).slice(0, 120)}`,
      );
    }
  }
  const out: Row[] = [];
  for (const g of groups.values()) {
    const form = forms[g.formId ?? ""] ?? {};
    const unavailable=form.nativeMetadataUnavailable===true;
    const old=unavailable?prior.find(r=>r.account===g.account&&r.formId===g.formId):undefined;
    const questions = unavailable?structuredClone(old?.questions??[]):((form.questions ?? []) as Row[]).map(q => {
      const label = String(q.label ?? q.key ?? "");
      const qtype = String(q.type ?? "");
      const low = label.toLowerCase();
      return {
        label,
        type: qtype,
        options: ((q.options ?? []) as Row[]).map(o =>
          String(o.value ?? o.key ?? ""),
        ),
        isGate:
          !Object.hasOwn(CONTACT_TYPES,qtype) && GATE_HINTS.some(h => low.includes(h)),
      };
    });
    out.push({
      account: g.account,
      kind: g.kind,
      url: g.url,
      formId: g.formId,
      formName: unavailable?old?.formName:form.name,
      formStatus: unavailable?old?.formStatus:form.status,
      headline: unavailable?old?.headline:form.question_page_custom_headline,
      followUpUrl: unavailable?old?.followUpUrl:form.follow_up_action_url,
      leadsAllTime: unavailable?old?.leadsAllTime:Number(form.leads_count ?? 0) || undefined,
      questions,
      gates: unavailable?old?.gates:questions.filter((q:Row) => q.isGate).length,
      formCheckedAt: unavailable?old?.formCheckedAt:g.formId?Date.now():undefined,
      staleReason: unavailable?'Form metadata is unavailable. Stored questions are retained. Check Meta access before using them.':undefined,
      spend: Math.round(g.spend * 100) / 100,
      leads: g.leads,
      cpl: g.leads ? Math.round((g.spend / g.leads) * 100) / 100 : undefined,
      ads: g.ads.sort((a: Row, b: Row) =>
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

export async function collectCreative(state: Row, tables: Record<string, Row[]>, csm: Record<string, Row[]>) {
  await assertNativeFence();
  const clients = await gatherClients();
  const previous = new Map<string, Row>((state.creative?.clients ?? []).map((row: Row) => [row.taskId, row]));
  for (const client of clients) {
    const old = previous.get(client.taskId);
    const profile = (csm.clientProfiles ?? []).find(row => normClient(row.clientName ?? row.name ?? row.client) === normClient(client.name));
    if (profile) {
      if(Array.isArray(profile.adLeads?.daily)){
        const since=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
        client.daily=profile.adLeads.daily.filter((row:Row)=>row.date>=since).map((row:Row)=>({date:row.date,leads:row.leads,spend:row.spend}));
      }
      if(profile.performance?.sheetId){client.stats=profile.performance.creativeStats;client.statsScannedAt=profile.performanceRetained ? profile.performanceSyncedAt : profile.performanceSyncedAt ?? profile.syncedAt;}
      client.driveLink ??= profile.links?.drive;
      client.sheetLink ??= profile.links?.sheet;
    }
    const folder = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(String(client.driveFolder ?? client.driveLink ?? ''))?.[1];
    if (folder) {
      if (old?.driveFolderId === folder && Date.now() - Number(old.driveScannedAt) < 6 * 3600000) {
        for (const key of ['driveFolderId', 'driveScannedAt', 'driveSubfolders', 'driveFootage', 'driveScripts']) client[key] = old[key];
      } else {
        const subs: Row[] = [];
        let token: string | undefined;
        do {
          const params = new URLSearchParams({q: `'${folder}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, fields: 'nextPageToken,files(id,name)', pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true'});
          if (token) params.set('pageToken', token);
          const result = unwrap(await callTool('native_google_drive_get', {url: `https://www.googleapis.com/drive/v3/files?${params}`}));
          if (!Array.isArray(result.files)) throw new Error('Drive did not return a folder collection');
          subs.push(...result.files.map((file: Row) => ({id: String(file.id), name: String(file.name), url: `https://drive.google.com/drive/folders/${file.id}`})));
          token = result.nextPageToken;
          if (subs.length > 10000) throw new Error('Drive folder pagination exceeded limit');
        } while (token);
        Object.assign(client, {driveFolderId: folder, driveScannedAt: Date.now(), driveSubfolders: subs});
        client.driveFootage = subs.find(row => /footage|raw video/i.test(row.name))?.url;
        client.driveScripts = subs.find(row => /script/i.test(row.name))?.url;
      }
    }
    client.updates = latestUpdates(state.media?.clientComments, client.taskId, Date.now());
  }
  const creative = await gatherCreative(clients);
  tables.clientLinks = clients.map(row => ({name: row.name, taskId: row.taskId, aliases: row.aliases, url: row.url, driveLink: row.driveLink ?? row.driveFolder, brandDnaDoc: row.brandDnaDoc, offerCheatSheet: row.offerCheatSheet, dosDonts: row.dosDonts}));
  return {clients, creativeTasks: creative.tasks, videoJobs: creative.videos, contentPosts: creative.posts, campaigns: tables.campaigns, ads: tables.ads, metaTree: tables.metaTree, funnels: await gatherFunnels(state.creative?.funnels??[]), winnersArchive: tables.winnersArchive, marketPlays: tables.marketPlays};
}
