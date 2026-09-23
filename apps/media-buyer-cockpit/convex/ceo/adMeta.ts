import { callTool, graph } from "../tools";

/**
 * The pieces of Meta that both the launch flow and the manage flow need.
 *
 * Everything here is about Mahara's own ad account and nothing else. The one
 * rule the whole file exists to keep is `ownAd`: a Meta id is global, so a
 * pasted client id would otherwise sail straight through into a write on
 * somebody else's account. Every read of an object we are about to reuse or
 * change goes through a check that it belongs to us.
 *
 * It has no Convex imports on purpose (no `_generated/api`), so any module can
 * use it without dragging an import cycle behind it.
 */

// biome-ignore lint/suspicious/noExplicitAny: Graph API payloads are untyped
export type Any = Record<string, any>;

declare const process: { env: Record<string, string | undefined> };

/** The only ad account this cockpit ever writes to. */
export const ACCOUNT = "746108264865897";
export const ACT = `act_${ACCOUNT}`;

export type Kind = "lead_gen" | "retargeting";
export type Variant = { headline: string; primaryText: string };

export const KIND_LABEL: Record<Kind, string> = {
  lead_gen: "Lead Gen",
  retargeting: "Retargeting",
};

/** "2026-09-19" → "19-9-26", the account's own date style. */
export function stamp(day: string): string {
  const [y, m, d] = day.split("-");
  return `${Number(d)}-${Number(m)}-${y.slice(2)}`;
}

export function isMetaId(id: string): boolean {
  return /^\d{5,}$/.test(id);
}

/** Read any object of ours, refusing anything that is not on our account. */
export async function ownObject(
  id: string,
  fields: string,
  what: string,
): Promise<Any> {
  if (!isMetaId(id)) throw new Error(`${id} is not a Meta id.`);
  const obj: Any = await graph(id, { fields: `account_id,${fields}` });
  if (String(obj?.account_id ?? "") !== ACCOUNT)
    throw new Error(
      `That ${what} is not on Mahara's own ad account, so this screen will not touch it.`,
    );
  return obj;
}

/** Read one of our ads with its creative. */
export async function ownAd(adId: string): Promise<Any> {
  return ownObject(
    adId,
    "id,name,status,effective_status,adset_id,campaign_id,creative{id,name,body,title,object_story_spec,asset_feed_spec}",
    "ad",
  );
}

export async function ownAdset(adsetId: string): Promise<Any> {
  return ownObject(
    adsetId,
    "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,bid_strategy,bid_amount,optimization_goal,billing_event,start_time,end_time,targeting,promoted_object,campaign{id,name,objective,daily_budget,lifetime_budget}",
    "ad set",
  );
}

export async function ownCampaign(campaignId: string): Promise<Any> {
  return ownObject(
    campaignId,
    "id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,is_skadnetwork_attribution",
    "campaign",
  );
}

/** The primary text on an ad, wherever Meta happens to be keeping it. */
export function bodyOf(ad: Any): string {
  const c = ad?.creative ?? {};
  const fromFeed = (c.asset_feed_spec?.bodies ?? [])
    .map((b: Any) => String(b?.text ?? ""))
    .filter(Boolean);
  const oss = c.object_story_spec ?? {};
  return String(
    c.body ??
      fromFeed[0] ??
      oss.video_data?.message ??
      oss.link_data?.message ??
      "",
  );
}

/** The headline on an ad, same idea. */
export function headlineOf(ad: Any): string {
  const c = ad?.creative ?? {};
  const fromFeed = (c.asset_feed_spec?.titles ?? [])
    .map((b: Any) => String(b?.text ?? ""))
    .filter(Boolean);
  const oss = c.object_story_spec ?? {};
  return String(
    c.title ??
      fromFeed[0] ??
      oss.video_data?.title ??
      oss.link_data?.name ??
      "",
  );
}

/**
 * Only the fields Meta accepts back on a create; the read echoes extra ones.
 *
 * Placements also need repairing, because Meta reads them back in a shape it
 * will not accept. The live lead-gen ad set carries `explore_home` without
 * `explore`, and a create built from it is refused with "To place ads in
 * Instagram Explore home, please also select Instagram Explore" (#2490392).
 * Every new ad set copied from a winner failed on it until 2026-09-22.
 */
const IMPLIED_POSITIONS: Record<string, [string, string][]> = {
  instagram_positions: [["explore_home", "explore"]],
  facebook_positions: [["facebook_reels_overlay", "facebook_reels"]],
};

export function cleanTargeting(t: Any | undefined): Any {
  if (!t || typeof t !== "object")
    return { geo_locations: { countries: ["KW"] } };
  const { age_range: _ageRange, ...rest } = t;
  for (const [field, rules] of Object.entries(IMPLIED_POSITIONS)) {
    const list = rest[field];
    if (!Array.isArray(list)) continue;
    const out = [...list.map(String)];
    for (const [needs, also] of rules)
      if (out.includes(needs) && !out.includes(also)) out.push(also);
    rest[field] = out;
  }
  return rest;
}

export function cleanPromoted(p: Any | undefined): Any | undefined {
  if (!p || typeof p !== "object") return undefined;
  const keep = [
    "pixel_id",
    "custom_event_type",
    "custom_event_str",
    "page_id",
    "application_id",
    "object_store_url",
    "product_set_id",
    "product_catalog_id",
    "event_id",
    "offer_id",
  ];
  const out: Any = {};
  for (const k of keep) if (p[k] !== undefined && p[k] !== null) out[k] = p[k];
  return Object.keys(out).length ? out : undefined;
}

/**
 * The name is how the account files a campaign apart, and `b2b_campaign_type`
 * reads nothing but the name. A retargeting campaign that loses the word is
 * counted as lead gen from that moment on and poisons every cost per lead.
 */
export function checkName(kind: Kind | "unknown", name: string): void {
  const n = name.trim();
  if (!n) throw new Error("The campaign needs a name.");
  if (kind === "retargeting" && !/retarget|remarket|hammer them/i.test(n))
    throw new Error(
      'A retargeting campaign must keep "Retargeting" in its name, or it will be counted as lead gen.',
    );
  if (
    kind === "lead_gen" &&
    /retarget|remarket|hammer them|hiring|recruit/i.test(n)
  )
    throw new Error(
      "That name would file a lead-gen campaign as retargeting or hiring.",
    );
}

/** Meta keeps money in minor units. Dollars in, cents out, never a fraction. */
export function cents(usd: number): string {
  return String(Math.round(usd * 100));
}

export function usdOf(minor: unknown): number | null {
  if (minor === null || minor === undefined || minor === "") return null;
  const n = Number(minor);
  return Number.isFinite(n) ? Math.round(n) / 100 : null;
}

// --- the copy writer -------------------------------------------------------

export function copyPrompt(
  kind: Kind,
  brief: string,
  language: "ar" | "en",
  winners: { name: string; body: string }[],
  count: number,
): string {
  const arabic = language === "ar";
  return [
    "Write Meta ad copy for Mahara Media, a Kuwait agency that runs done-for-you client acquisition for construction, design, fit-out and interior businesses across the Gulf: Meta ads, automated lead filtration and a trained sales team that books the meetings. The offer is the Premium Projects Program: six to thirteen high-value projects in ninety days or the work continues free.",
    kind === "lead_gen"
      ? "This is a LEAD GENERATION campaign to a cold audience of business owners who have not heard of Mahara. The ad sends them to the funnel page to watch a short video and book a call. Earn attention in the first line, name who it is for, make the promise concrete, and end with the one next step."
      : "This is a RETARGETING campaign to a warm audience: people who watched our videos, visited the funnel or engaged in the last ninety days. Do not introduce Mahara from scratch; they know the name. Move them to book the call now: answer the objection they are sitting on, show proof, make the next step feel small.",
    `Language: ${arabic ? "Arabic (Gulf, natural spoken register — not formal MSA, not translated-sounding)" : "English"}.`,
    `What the CEO asked for: ${brief}.`,
    winners.length
      ? `The current ${kind === "lead_gen" ? "lead-gen" : "retargeting"} winners on the account, with their primary text — stay in this territory and vary the hook, do not invent a new offer:\n${winners.map(w => `— ${w.name}:\n${w.body.slice(0, 500)}`).join("\n\n")}`
      : "",
    "",
    "Hard rules:",
    "- Never call the audience 'contractors' and never imply one-man teams. They are construction and design businesses, firms or companies.",
    "- Any money figure is in USD. Never dinar, riyal or dirham.",
    "- No emoji walls, no 'unlock', no 'revolutionise', no exclamation stacking.",
    "- Write like one person talking to another. Short sentences. Concrete, not aspirational.",
    "- Headline: under 40 characters. Primary text: 2 to 4 short lines.",
    "",
    `Give ${count} distinct angles — not ${count} rewrites of the same sentence. Vary the hook: outcome, objection, proof, question, direct offer. Each one also gets a two-or-three word label naming its angle.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type Idea = Variant & { angle: string };

/**
 * Three to five diverse angles for approval (Aziz, 2026-09-22). The model is
 * asked for strict JSON and the answer is parsed here, so the caller gets
 * variants or an error and never a sentence about JSON.
 */
export async function writeCopy(
  kind: Kind,
  brief: string,
  language: "ar" | "en",
  winners: { name: string; body: string }[],
  count = 5,
): Promise<Idea[]> {
  const want = Math.max(3, Math.min(Math.round(count) || 5, 5));
  const raw: Any = await callTool("ai_structured_output", {
    prompt: copyPrompt(kind, brief, language, winners, want),
    intelligence_level: "smart",
    output_schema: {
      type: "object",
      properties: {
        variants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              angle: { type: "string" },
              headline: { type: "string" },
              primaryText: { type: "string" },
            },
            required: ["angle", "headline", "primaryText"],
          },
        },
      },
      required: ["variants"],
    },
  });
  const list = Array.isArray(raw?.variants) ? raw.variants : [];
  return list
    .map((x: Any) => ({
      angle: String(x?.angle ?? "").trim(),
      headline: String(x?.headline ?? "").trim(),
      primaryText: String(x?.primaryText ?? "").trim(),
    }))
    .filter((x: Idea) => x.headline && x.primaryText)
    .slice(0, want);
}
