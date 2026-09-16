import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { creativeCopyParts, readCreativeCopy, stillKeyFor } from "./metaMedia";
import { allAdAccounts, callTool, graph, unwrap } from "./tools";

/**
 * Mine every Mahara ad account into the GCC winning-data database.
 *
 * This is `viktor-side-scripts/collect_market_plays.py`, moved into the app so
 * it runs on its own schedule instead of from a sandbox. It walks every ad
 * account, reads each ad set's TARGETING alongside its actual SPEND AND LEADS,
 * joins it to the client's city and service line, and stores one row per ad
 * set in `marketPlays`. The "What works" page reads it as a playbook.
 *
 * Client labels come from Aziz's hand-filled label sheet. If that sheet is not
 * shared with the service account, the Meta business's own account list is
 * used instead, enriched from Client Data where a name matches, so the
 * playbook still fills up (without cities until the sheet is shared).
 *
 * Service lines are assigned by keyword (English and Arabic) from the sheet's
 * service text and the client name, since there is no model on this
 * deployment. `SERVICE_LINE_OVERRIDES` wins over the keywords.
 */

// Client -> country / city / service line. Aziz filled the city column by hand.
const LABELS = "10vGT2Jw43eCsSi5UfGY6O35_6pq-rjaEDi-fN86yZ-A";
const DATABASE = "1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0";

// Aziz, 2026-09-05: the MaharaMedia account is his own lead gen, not a client.
const SKIP_ACCOUNTS = new Set(["maharamedia"]);

/**
 * Exact client / ad-account name (lower-cased) -> service line. Beats the
 * keywords. Filled by hand from the Meta account list on 2026-09-09; names the
 * keywords cannot read (brand names, transliterations) live here.
 */
const SERVICE_LINE_OVERRIDES: Record<string, string> = {
  "art vision": "Interior design",
  "evan home": "Interior design",
  "ocean home": "Interior design",
  "olivar design": "Interior design",
  "the last step": "Fit-out and finishing",
  "castello industries": "Construction and contracting",
  "castello add": "Construction and contracting",
  "arcturus world ad account": "Construction and contracting",
  "grandiocity projects": "Construction and contracting",
  phoenix: "Construction and contracting",
  "phoenix building": "Construction and contracting",
  "ngcc kw": "Construction and contracting",
  "bayt al imarah": "Architecture and engineering",
  arcwani: "Architecture and engineering",
  "safad consulting": "Architecture and engineering",
  "منشآت خالدة": "Architecture and engineering",
  "تحديث المباني": "Maintenance and renovation",
  "تحديث المباني - mahara media": "Maintenance and renovation",
};

/** Order matters: the specific lines come before the catch-alls. */
const SERVICE_KEYWORDS: [string, RegExp][] = [
  ["Kitchens and joinery", /kitchen|joinery|cabinet|wood|مطابخ|مطبخ|خشب|نجار/i],
  [
    "Landscaping and outdoor",
    /landscap|garden|outdoor|pool|حدائق|حديقة|تنسيق|مسابح/i,
  ],
  [
    "Maintenance and renovation",
    /maintenance|renovat|repair|صيانة|ترميم|تجديد/i,
  ],
  [
    "Real estate and development",
    /real estate|realestate|property|properties|develop|عقار|تطوير/i,
  ],
  [
    "Furniture and home retail",
    /furniture|home retail|sofa|أثاث|اثاث|مفروشات/i,
  ],
  ["Fit-out and finishing", /fit-?out|finishing|تشطيب/i],
  [
    "Architecture and engineering",
    /architect|engineer|consult|هندس|استشار|معمار/i,
  ],
  [
    "Construction and contracting",
    /construct|contract|build|مقاول|بناء|انشاء|إنشاء|منشآت|منشاءت|عمران/i,
  ],
  ["Interior design", /interior|design|decor|ديكور|تصميم/i],
];

export function classifyServiceLine(
  client: string,
  serviceText: string,
): string {
  const override = SERVICE_LINE_OVERRIDES[client.trim().toLowerCase()];
  if (override) return override;
  for (const text of [serviceText, client]) {
    if (!text || text.trim().length < 3) continue;
    for (const [line, re] of SERVICE_KEYWORDS) if (re.test(text)) return line;
  }
  return "Unknown";
}

type ClientLabel = {
  client: string;
  accountId: string;
  country?: string;
  city?: string;
  serviceText: string;
};

function normalize(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

async function sheetValues(id: string, range: string): Promise<string[][]> {
  const res = unwrap(
    await callTool("pd_google_sheets_proxy_get", {
      url: `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`,
    }),
  );
  return (res?.values ?? []) as string[][];
}

/** The label sheet, as the Python did it: header lookup by prefix. */
async function loadLabelSheet(): Promise<ClientLabel[]> {
  const values = await sheetValues(LABELS, "A1:Z200");
  if (values.length === 0) return [];
  const head = values[0].map(h => String(h).trim().toLowerCase());
  const cell = (row: string[], name: string) => {
    const i = head.findIndex(h => h.startsWith(name));
    return i >= 0 ? String(row[i] ?? "").trim() : "";
  };
  const out: ClientLabel[] = [];
  for (const row of values.slice(1)) {
    const client = cell(row, "client");
    const acct = cell(row, "ad account").replace(/^act_/, "");
    if (!client || !acct || SKIP_ACCOUNTS.has(normalize(client))) continue;
    out.push({
      client,
      accountId: acct,
      country: cell(row, "country") || undefined,
      city: cell(row, "city") || undefined,
      serviceText: cell(row, "service"),
    });
  }
  return out;
}

/** Fallback: every account the business can reach, labelled from Client Data. */
async function loadFromMeta(): Promise<ClientLabel[]> {
  const accounts = await allAdAccounts();
  const byName = new Map<
    string,
    { country?: string; city?: string; service: string }
  >();
  try {
    const rows = await sheetValues(DATABASE, "'Client Data'!A1:S200");
    const head = rows[0] ?? [];
    const col = (n: string) => head.indexOf(n);
    for (const r of rows.slice(1)) {
      const name = r[col("Client Name")];
      if (!name) continue;
      byName.set(normalize(name), {
        country: r[col("Country")] || undefined,
        city: r[col("City")] || undefined,
        service: String(r[col("Service")] ?? ""),
      });
    }
  } catch (e) {
    console.warn(
      `Client Data unreadable, labelling from account names only: ${String(e).slice(0, 120)}`,
    );
  }
  const out: ClientLabel[] = [];
  for (const a of accounts) {
    const name = String(a.name ?? "").trim();
    if (!name || SKIP_ACCOUNTS.has(normalize(name))) continue;
    // Account names rarely equal client names exactly; take the best prefix match.
    const key = normalize(name);
    let hit = byName.get(key);
    if (!hit) {
      for (const [k, v] of byName) {
        if (k.length >= 5 && (key.includes(k) || k.includes(key))) {
          hit = v;
          break;
        }
      }
    }
    out.push({
      client: name,
      accountId: a.account_id,
      country: hit?.country,
      city: hit?.city,
      serviceText: hit?.service ?? "",
    });
  }
  return out;
}

// --- creative side of a play -------------------------------------------------

// Format, call to action and copy parsing live in metaMedia.ts
// (readCreativeCopy), shared with previews.adDetails.

/**
 * Describe the copy rather than storing a wall of it. What matters for
 * pattern-matching across clients is the shape of the copy, not the sentences.
 */
function copyTraits(
  body: string | undefined,
  headline: string | undefined,
): [string[], string | undefined] {
  const text = [headline, body].filter(Boolean).join(" ").trim();
  if (!text) return [[], undefined];
  const traits: string[] = [];
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const language = arabic > text.length * 0.2 ? "ar" : "en";
  if (text.includes("?") || text.includes("؟")) traits.push("question hook");
  if (/\d/.test(text)) traits.push("names a number");
  if (/(%|\bfree\b|مجان)/i.test(text)) traits.push("free or discount offer");
  if (/(\bnow\b|\btoday\b|الحين|اليوم)/i.test(text)) traits.push("urgency");
  const words = text.split(/\s+/).length;
  traits.push(
    words < 25 ? "short copy" : words > 70 ? "long copy" : "medium copy",
  );
  if (text.split("\n").filter(l => l.trim()).length >= 4)
    traits.push("list layout");
  return [traits, language];
}

// biome-ignore lint/suspicious/noExplicitAny: Meta payload
function leadsOf(insights: any): { spend: number; leads: number } {
  const first = insights?.data?.[0] ?? {};
  const spend = Number(first.spend ?? 0);
  let leads = 0;
  for (const a of first.actions ?? []) {
    if (String(a.action_type ?? "").includes("lead")) {
      leads = Math.max(leads, Math.floor(Number(a.value ?? 0)));
    }
  }
  return { spend, leads };
}

// biome-ignore lint/suspicious/noExplicitAny: Meta payload
function readCreatives(ads: any[]) {
  const out: Record<string, unknown>[] = [];
  const formats = new Set<string>();
  const ctas = new Set<string>();
  const traits = new Set<string>();
  const langs = new Set<string>();
  for (const ad of ads) {
    const cr = ad.creative ?? {};
    const spec = cr.object_story_spec ?? {};
    // Traits read the whole copy; the stored copy is cut (headline 120,
    // body 300: enough to recognise the angle, not a full transcript).
    const full = creativeCopyParts(spec);
    const copy = readCreativeCopy(cr);
    const [t, lang] = copyTraits(full.body, full.headline);
    const { spend, leads } = leadsOf(ad.insights);
    formats.add(copy.format);
    if (copy.cta) ctas.add(copy.cta);
    for (const x of t) traits.add(x);
    if (lang) langs.add(lang);
    const creativeId = cr.id ? String(cr.id) : undefined;
    out.push({
      adId: String(ad.id),
      adName: String(ad.name ?? ""),
      format: copy.format,
      cta: copy.cta,
      videoId: copy.videoId,
      // A short-lived Meta link: shown only until it expires. The lasting
      // picture is the saved still under stillKey (previews.ts).
      thumbUrl:
        cr.image_url ||
        cr.thumbnail_url ||
        spec.video_data?.image_url ||
        spec.link_data?.picture ||
        undefined,
      creativeId,
      stillKey: stillKeyFor(creativeId, String(ad.id)),
      headline: copy.headline,
      body: copy.body,
      spend: Math.round(spend * 100) / 100,
      leads,
      cpl: leads ? Math.round((spend / leads) * 100) / 100 : undefined,
    });
  }
  formats.delete("unknown");
  return {
    creatives: out,
    formats: [...formats].sort(),
    ctas: [...ctas].sort(),
    copyTraits: [...traits].sort(),
    language:
      langs.size === 0 ? undefined : langs.size === 1 ? [...langs][0] : "mixed",
  };
}

/** Turn one ad set's targeting into a comparable "play". */
// biome-ignore lint/suspicious/noExplicitAny: Meta payload
function readPlay(adset: any) {
  const t = adset.targeting ?? {};
  const names = new Set<string>();
  for (const spec of t.flexible_spec ?? [])
    for (const i of spec.interests ?? []) if (i.name) names.add(i.name);
  for (const i of t.interests ?? []) if (i.name) names.add(i.name);
  const interests = [...names].sort();
  const playType = t.custom_audiences?.length
    ? "lookalike"
    : interests.length
      ? "interests"
      : "broad";
  const { spend, leads } = leadsOf(adset.insights);
  return {
    adsetId: String(adset.id),
    adsetName: String(adset.name ?? ""),
    playType,
    interests,
    ageMin: t.age_min ?? undefined,
    ageMax: t.age_max ?? undefined,
    optimizationGoal: adset.optimization_goal ?? undefined,
    spend: Math.round(spend * 100) / 100,
    leads,
    cpl: leads ? Math.round((spend / leads) * 100) / 100 : undefined,
  };
}

/** Convex optional fields reject explicit null; drop them at any depth. */
// biome-ignore lint/suspicious/noExplicitAny: recursive cleanup
function stripNulls(value: any): any {
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

/**
 * Kick off a full collection: label every account, then read each one in its
 * own scheduled run so a slow account cannot stall the rest.
 */
export const collectPlays = internalAction({
  args: { days: v.optional(v.number()) },
  returns: v.object({
    accounts: v.number(),
    source: v.string(),
    serviceLines: v.any(),
  }),
  handler: async (ctx, { days }) => {
    const windowDays = days ?? 90;
    const preset = windowDays <= 30 ? "last_30d" : "last_90d";

    let clients: ClientLabel[] = [];
    let source = "label sheet";
    try {
      clients = await loadLabelSheet();
    } catch (e) {
      console.warn(`label sheet unreadable: ${String(e).slice(0, 160)}`);
    }
    if (clients.length === 0) {
      source = "Meta business accounts + Client Data";
      clients = await loadFromMeta();
    }
    if (clients.length === 0) {
      throw new Error("no client accounts to collect from — refusing to run");
    }

    const counts: Record<string, number> = {};
    let i = 0;
    for (const c of clients) {
      const serviceLine = classifyServiceLine(c.client, c.serviceText);
      counts[serviceLine] = (counts[serviceLine] ?? 0) + 1;
      // Spaced out so ~50 accounts do not hit Meta's rate limit at once.
      await ctx.scheduler.runAfter(
        i * 3000,
        internal.marketCollect.collectAccount,
        {
          client: c.client,
          accountId: c.accountId,
          country: c.country,
          city: c.city,
          serviceLine,
          preset,
          windowDays,
        },
      );
      i++;
    }
    // The winners archive reads the fresh plays. Run it once the last account
    // has had a fair chance to land; runSync repeats it every morning anyway.
    await ctx.scheduler.runAfter(
      clients.length * 3000 + 120_000,
      internal.market.archiveWinners,
      {},
    );
    console.log(
      `market plays: ${clients.length} accounts from ${source}; service lines ${JSON.stringify(counts)}`,
    );
    return { accounts: clients.length, source, serviceLines: counts };
  },
});

/** One ad account: every ad set with spend, with its creatives, into marketPlays. */
export const collectAccount = internalAction({
  args: {
    client: v.string(),
    accountId: v.string(),
    country: v.optional(v.string()),
    city: v.optional(v.string()),
    serviceLine: v.string(),
    preset: v.string(),
    windowDays: v.number(),
  },
  returns: v.object({ adsets: v.number(), stored: v.number() }),
  handler: async (ctx, a) => {
    const targeting =
      "targeting{flexible_spec,interests,custom_audiences,age_min,age_max}";
    const base = `id,name,optimization_goal,${targeting},insights.date_preset(${a.preset}){spend,actions}`;
    const rich =
      `id,name,optimization_goal,${targeting},` +
      `ads.limit(25){id,name,creative{id,object_story_spec,thumbnail_url,image_url},insights.date_preset(${a.preset}){spend,actions}},` +
      `insights.date_preset(${a.preset}){spend,actions}`;

    // The creative expansion makes this request much heavier, and Meta refuses
    // it outright on accounts with a lot of history. Fall back to targeting-only
    // rather than losing the account entirely. [meta, 2026-09-06]
    // biome-ignore lint/suspicious/noExplicitAny: Meta payload
    let res: any = null;
    let lastError = "";
    for (const [fields, limit, label] of [
      [rich, 200, "full"],
      [rich, 50, "full/small"],
      [base, 200, "targeting only"],
    ] as const) {
      try {
        res = await graph(`act_${a.accountId}/adsets`, { fields, limit });
        if (label !== "full") console.log(`${a.client}: fell back to ${label}`);
        break;
      } catch (e) {
        lastError = String(e).slice(0, 160);
      }
    }
    if (!res) {
      console.warn(`${a.client} (act_${a.accountId}) unreadable: ${lastError}`);
      return { adsets: 0, stored: 0 };
    }

    const rows: Record<string, unknown>[] = [];
    for (const adset of res.data ?? []) {
      const play = readPlay(adset);
      // No spend means no evidence. Storing it would dilute every average.
      if (play.spend <= 0) continue;
      const creative = readCreatives(adset.ads?.data ?? []);
      rows.push({
        ...play,
        ...creative,
        client: a.client,
        accountId: a.accountId,
        country: a.country,
        city: a.city,
        serviceLine: a.serviceLine,
      });
    }

    // No preview links are stored: Meta's expire within a day. The preview is
    // fetched when someone opens the ad, and winners get a saved still from
    // the winners pass (previews.ts). [2026-09-16]

    let stored = 0;
    if (rows.length > 0) {
      const out = await ctx.runMutation(internal.market.store, {
        rows: rows.map(stripNulls),
        windowDays: a.windowDays,
      });
      stored = out.written;
    }
    console.log(
      `${a.client}: ${(res.data ?? []).length} ad sets, ${stored} with spend stored`,
    );
    return { adsets: (res.data ?? []).length, stored };
  },
});
