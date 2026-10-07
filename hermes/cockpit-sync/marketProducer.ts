import {type Row, graph, allAdAccounts, callTool, unwrap, recordLog} from './runtime';
import {creativeCopyParts, readCreativeCopy, stillKeyFor} from './metaMedia';
const DATABASE = '1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0';
const SKIP_ACCOUNTS: Record<string,boolean> = {maharamedia:true};
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

type RegistryClient = {
  client: string;
  country?: string;
  city?: string;
  service: string;
};

/** Load canonical Client Data registry and label reachable Meta accounts. */
async function loadFromMeta(): Promise<ClientLabel[]> {
  const accounts = await allAdAccounts();
  const rows = await sheetValues(DATABASE, "'Client Data'!A1:S200");
  if (!rows || rows.length === 0) {
    throw new Error('Client Data registry is empty or unreadable');
  }
  const head = rows[0] ?? [];
  const col = (n: string) => head.indexOf(n);
  const clientNameCol = col("Client Name");
  if (clientNameCol < 0) {
    throw new Error('Valid Client Name header required in Client Data registry');
  }
  const metaAccountCol = col("Ad Account - Meta");
  const countryCol = col("Country");
  const cityCol = col("City");
  const serviceCol = col("Service");

  const byAccountId = new Map<string, RegistryClient>();
  const byName = new Map<string, RegistryClient | null>();
  let realClientCount = 0;

  for (const r of rows.slice(1)) {
    const rawClient = String(r[clientNameCol] ?? "").trim();
    if (!rawClient) continue;
    const norm = normalize(rawClient);
    if (!norm || Object.hasOwn(SKIP_ACCOUNTS, norm)) continue;
    realClientCount++;

    const entry: RegistryClient = {
      client: rawClient,
      country: countryCol >= 0 ? r[countryCol] || undefined : undefined,
      city: cityCol >= 0 ? r[cityCol] || undefined : undefined,
      service: serviceCol >= 0 ? String(r[serviceCol] ?? "") : "",
    };

    if (metaAccountCol >= 0) {
      const rawAcct = String(r[metaAccountCol] ?? "").trim();
      const acctId = rawAcct.replace(/^act_/, "").trim();
      if (acctId) {
        const existing = byAccountId.get(acctId);
        if (existing) {
          const isIdentical =
            existing.client === entry.client &&
            existing.country === entry.country &&
            existing.city === entry.city &&
            existing.service === entry.service;
          if (!isIdentical) {
            throw new Error(`Conflicting duplicate account-ID mapping in Client Data registry: ${acctId}`);
          }
        } else {
          byAccountId.set(acctId, entry);
        }
      }
    }

    const nameKey = norm;
    if (byName.has(nameKey)) {
      byName.set(nameKey, null);
    } else {
      byName.set(nameKey, entry);
    }
  }

  if (realClientCount === 0) {
    throw new Error('Client Data registry contains no valid client entries');
  }

  const out: ClientLabel[] = [];
  for (const a of accounts) {
    const name = String(a.name ?? "").trim();
    if (!name || Object.hasOwn(SKIP_ACCOUNTS, normalize(name))) continue;

    const accountId = String(a.account_id ?? "").replace(/^act_/, "").trim();
    const exactHit = accountId ? byAccountId.get(accountId) : undefined;

    if (exactHit) {
      out.push({
        client: exactHit.client,
        accountId,
        country: exactHit.country,
        city: exactHit.city,
        serviceText: exactHit.service,
      });
      continue;
    }

    // Old fixtures or entries lacking account-ID header retain existing name matching.
    const key = normalize(name);
    let hit: RegistryClient | undefined;
    if (byName.has(key)) {
      const direct = byName.get(key);
      if (direct === null) {
        recordLog(
          "warn",
          `Duplicate normalized client name for account ${name}; retaining explicit provider account identity`,
        );
      } else {
        hit = direct;
      }
    } else {
      const candidates: RegistryClient[] = [];
      for (const [k, v] of byName) {
        if (k.length >= 5 && (key.includes(k) || k.includes(key))) {
          if (v) candidates.push(v);
        }
      }
      if (candidates.length === 1) {
        hit = candidates[0];
      } else if (candidates.length > 1) {
        recordLog(
          "warn",
          `Ambiguous name match for account ${name}; retaining explicit provider account identity`,
        );
      }
    }

    out.push({
      client: hit ? hit.client : name,
      accountId,
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
function leadsOf(insights: Row): { spend: number; leads: number } {
  if (!Array.isArray(insights?.data) || insights.data.length > 1) throw new Error('Market insight window is missing or ambiguous');
  if (insights.data.length === 0) return {spend:0,leads:0};
  const first = insights.data[0], spend = Number(first.spend);
  if (first.spend == null || !Number.isFinite(spend) || spend < 0) throw new Error('Market spend is unavailable');
  let leads = 0;
  for (const a of first.actions ?? []) {
    if (String(a.action_type ?? "").includes("lead")) {
      const value=Number(a.value);
      if(a.value==null||!Number.isFinite(value)||value<0)throw new Error('Market lead count is unavailable');
      leads = Math.max(leads, Math.floor(value));
    }
  }
  return { spend, leads };
}

// biome-ignore lint/suspicious/noExplicitAny: Meta payload
function readCreatives(ads: Row[]) {
  const out: Record<string, unknown>[] = [];
  const formats = new Set<string>();
  const ctas = new Set<string>();
  const traits = new Set<string>();
  const langs = new Set<string>();
  for (const ad of ads) {
    if(!ad.id)throw new Error('Market creative identity missing');
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
function readPlay(adset: Row) {
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
export async function collectMarket(state: Row): Promise<Row[]> {
  const accounts = await loadFromMeta();
  const prior = new Map<string, Row>((state.media?.marketPlays ?? []).map((row: Row) => [String(row.adsetId), row]));
  const out: Row[] = [];
  for (const account of accounts) {
    const label = account;
    const response = await graph(`act_${account.accountId}/adsets`, {fields: 'id,name,optimization_goal,targeting{flexible_spec,interests,custom_audiences,age_min,age_max},insights.date_preset(last_30d){spend,actions}', limit: 100});
    if (!Array.isArray(response.data)) throw new Error('Market ad sets are unavailable');
    for (const adset of response.data) {
      if(!adset.id)throw new Error('Market ad set identity missing');
      const play = readPlay(adset);
      if (play.spend <= 0) continue;
      // Separate paginated edge avoids truncating nested ads.limit(25).
      const ads = await graph(`${adset.id}/ads`, {fields: 'id,name,creative{id,object_story_spec,thumbnail_url,image_url},insights.date_preset(last_30d){spend,actions}', limit: 100});
      if (!Array.isArray(ads.data)) throw new Error('Market creatives are unavailable');
      const creative = readCreatives(ads.data);
      const old = prior.get(play.adsetId);
      const saved = new Map<string, Row>((old?.creatives ?? []).map((row: Row) => [String(row.adId), row]));
      for (const row of creative.creatives) {
        const previous = saved.get(String(row.adId));
        for (const key of ['transcript', 'hook', 'voice']) if (previous?.[key] != null) row[key] = previous[key];
      }
      out.push({...play, ...creative, _id: old?._id, client: label.client, accountId: label.accountId, country: label.country, city: label.city, serviceLine: classifyServiceLine(label.client, label.serviceText), windowDays: 30, syncedAt: Date.now()});
    }
  }
  if (!accounts.length) throw new Error('No accessible market accounts; preserving prior evidence');
  return out;
}
