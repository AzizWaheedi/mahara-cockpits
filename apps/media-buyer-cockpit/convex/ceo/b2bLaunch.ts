import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { authenticatedAction } from "../functions";
import { callTool, graph, graphPost, unwrap } from "../tools";
import { B2B, num, sql } from "./sb";
import { kuwaitDay } from "./time";

declare const process: { env: Record<string, string | undefined> };

/**
 * Launch a campaign on Mahara's own ad account from the Ads tab.
 *
 * The flow is the launch skill's: a brief becomes a draft, a person reads and
 * edits the draft, and only then is anything created on Meta, and created
 * PAUSED. The switch to turn it on is the one on the Ads tab, which re-reads
 * Meta rather than trusting the write.
 *
 * The kind is decided first and never inferred. A lead-gen campaign goes to a
 * cold audience and is judged on cost per lead; a retargeting campaign goes to
 * a warm one and is judged on the calls it books. They copy their settings
 * from different winners, their copy is briefed differently, and they are
 * named so that `b2b_campaign_type` files them apart ("Retargeting" in the
 * name). Mixing them up would put warm-audience spend under the lead-gen
 * totals and poison every cost per lead on the account.
 *
 * What gets created:
 *   campaign (paused) → one ad set (settings copied from the best ad set of
 *   the same kind: targeting, optimisation goal, pixel event, page) → the
 *   winning ads you ticked, cloned as they are → one ad per copy variant,
 *   riding the first winner's video with the new headline and primary text.
 *
 * Drafts live in Creative Triage's `cockpit_ad_drafts` (Supabase first; no
 * Convex table). Only account 746108264865897 is ever written to, and every
 * object a draft reuses is checked to belong to it before anything is made.
 */

const ACCOUNT = "746108264865897";
const ACT = `act_${ACCOUNT}`;
const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TABLE = "cockpit_ad_drafts";

type Any = Record<string, any>;

export type Kind = "lead_gen" | "retargeting";
export type Variant = { headline: string; primaryText: string };
export type Draft = {
  id: number;
  kind: Kind;
  name: string;
  brief: string;
  dailyBudgetUsd: number;
  sourceAdsetName: string | null;
  sourceReason: string | null;
  cloneAdIds: string[];
  variants: Variant[];
  status:
    | "building"
    | "ready"
    | "launching"
    | "launched"
    | "failed"
    | "discarded";
  error: string | null;
  metaCampaignId: string | null;
  metaAdsetId: string | null;
  metaAdIds: string[];
  createdAt: string;
};

const KIND_LABEL: Record<Kind, string> = {
  lead_gen: "Lead Gen",
  retargeting: "Retargeting",
};

async function rest(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<Any[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY)
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 220)}`);
  return text ? JSON.parse(text) : [];
}

function toDraft(r: Any): Draft {
  return {
    id: Number(r.id),
    kind: r.kind === "retargeting" ? "retargeting" : "lead_gen",
    name: String(r.name ?? ""),
    brief: String(r.brief ?? ""),
    dailyBudgetUsd: num(r.daily_budget_usd),
    sourceAdsetName: r.source_adset_name ? String(r.source_adset_name) : null,
    sourceReason: r.source_reason ? String(r.source_reason) : null,
    cloneAdIds: Array.isArray(r.clone_ad_ids) ? r.clone_ad_ids.map(String) : [],
    variants: Array.isArray(r.variants)
      ? r.variants.map((x: Any) => ({
          headline: String(x?.headline ?? ""),
          primaryText: String(x?.primaryText ?? ""),
        }))
      : [],
    status: r.status,
    error: r.error ? String(r.error) : null,
    metaCampaignId: r.meta_campaign_id ? String(r.meta_campaign_id) : null,
    metaAdsetId: r.meta_adset_id ? String(r.meta_adset_id) : null,
    metaAdIds: Array.isArray(r.meta_ad_ids) ? r.meta_ad_ids.map(String) : [],
    createdAt: String(r.created_at ?? ""),
  };
}

async function patch(id: number, body: Any): Promise<Draft> {
  const rows = await rest(`${TABLE}?id=eq.${id}`, {
    method: "PATCH",
    body,
    prefer: "return=representation",
  });
  if (!rows[0]) throw new Error(`Draft ${id} not found`);
  return toDraft(rows[0]);
}

/** "2026-09-19" → "19-9-26", the account's own date style. */
function stamp(day: string): string {
  const [y, m, d] = day.split("-");
  return `${Number(d)}-${Number(m)}-${y.slice(2)}`;
}

const isArabic = (s: string) => /[؀-ۿ]/.test(s);

/**
 * The best ad set of this kind in the last 90 days: most demos shown, then
 * CRM leads, then spend. Retargeting rarely earns last-touch attribution, so
 * it usually falls through to spend, and the reason says so.
 */
async function bestAdset(kind: Kind): Promise<Any | null> {
  const rows = await sql(
    B2B,
    `with ident as (
       select distinct on (adset_id) adset_id, adset_name, campaign_id, campaign_name
       from public.meta_ad_snapshots order by adset_id, date desc),
     spend as (
       select adset_id, sum(spend) as spend
       from public.meta_ad_snapshots where date >= current_date - 89 group by 1),
     map as (select distinct ad_id, adset_id from public.meta_ad_snapshots),
     leads as (
       select s.adset_id, count(*) as leads from public.leads l join map s on s.ad_id = l.ad_id
       where l.is_lead and l.lead_created_at >= now() - interval '90 days' group by 1),
     demos as (
       select s.adset_id,
              count(*) filter (where c.call_type='demo' and c.status in ('showed','confirmed','invalid')) as demos_shown
       from public.calls c join map s on s.ad_id = c.ad_id
       where c.booked_at >= now() - interval '90 days' group by 1)
     select i.adset_id, i.adset_name, i.campaign_id, i.campaign_name, sp.spend,
            coalesce(le.leads,0) as leads, coalesce(d.demos_shown,0) as demos_shown
     from ident i join spend sp using (adset_id)
     left join leads le using (adset_id) left join demos d using (adset_id)
     where sp.spend > 0 and public.b2b_campaign_type(i.campaign_name) = '${kind}'
     order by demos_shown desc, leads desc, sp.spend desc limit 1`,
  );
  return rows[0] ?? null;
}

/** Top ads of this kind in the last 90 days, for when no winner was ticked. */
async function topAds(kind: Kind, limit: number): Promise<string[]> {
  const rows = await sql(
    B2B,
    `with ident as (
       select distinct on (ad_id) ad_id, ad_name, campaign_name
       from public.meta_ad_snapshots order by ad_id, date desc),
     spend as (
       select ad_id, sum(spend) as spend from public.meta_ad_snapshots
       where date >= current_date - 89 group by 1),
     leads as (
       select ad_id, count(*) as leads from public.leads
       where is_lead and ad_id is not null and lead_created_at >= now() - interval '90 days' group by 1),
     demos as (
       select ad_id, count(*) filter (where call_type='demo' and status in ('showed','confirmed','invalid')) as demos_shown
       from public.calls where ad_id is not null and booked_at >= now() - interval '90 days' group by 1)
     select i.ad_id from ident i join spend sp using (ad_id)
     left join leads le using (ad_id) left join demos d using (ad_id)
     where sp.spend > 0 and public.b2b_campaign_type(i.campaign_name) = '${kind}'
     order by coalesce(d.demos_shown,0) desc, coalesce(le.leads,0) desc, sp.spend desc
     limit ${Math.max(1, Math.min(limit, 8))}`,
  );
  return rows.map(r => String(r.ad_id));
}

/** Only the fields Meta accepts back on a create; the read echoes extra ones. */
function cleanTargeting(t: Any | undefined): Any {
  if (!t || typeof t !== "object")
    return { geo_locations: { countries: ["KW"] } };
  const { age_range: _ageRange, ...rest } = t;
  return rest;
}

function cleanPromoted(p: Any | undefined): Any | undefined {
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

function copyPrompt(
  kind: Kind,
  brief: string,
  language: "ar" | "en",
  winners: { name: string; body: string }[],
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
    "Give 5 distinct angles — not 5 rewrites of the same sentence. Vary the hook: outcome, objection, proof, question, direct offer.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function writeCopy(
  kind: Kind,
  brief: string,
  language: "ar" | "en",
  winners: { name: string; body: string }[],
): Promise<Variant[]> {
  const raw: Any = await callTool("ai_structured_output", {
    prompt: copyPrompt(kind, brief, language, winners),
    intelligence_level: "smart",
    output_schema: {
      type: "object",
      properties: {
        variants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              headline: { type: "string" },
              primaryText: { type: "string" },
            },
            required: ["headline", "primaryText"],
          },
        },
      },
      required: ["variants"],
    },
  });
  const list = Array.isArray(raw?.variants) ? raw.variants : [];
  return list
    .map((x: Any) => ({
      headline: String(x?.headline ?? "").trim(),
      primaryText: String(x?.primaryText ?? "").trim(),
    }))
    .filter((x: Variant) => x.headline && x.primaryText)
    .slice(0, 5);
}

/** Read one of our ads with its creative, refusing anything not on our account. */
async function ownAd(adId: string): Promise<Any> {
  if (!/^\d{5,}$/.test(adId)) throw new Error(`${adId} is not a Meta ad id`);
  const ad: Any = await graph(adId, {
    fields:
      "id,name,account_id,creative{id,name,body,object_story_spec,asset_feed_spec}",
  });
  if (String(ad?.account_id ?? "") !== ACCOUNT)
    throw new Error(
      `Ad ${adId} is not on Mahara's own account, so it will not be reused.`,
    );
  return ad;
}

function bodyOf(ad: Any): string {
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

export const recordLaunch = internalMutation({
  args: {
    draftId: v.number(),
    campaignId: v.string(),
    what: v.string(),
    after: v.any(),
    by: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("ceoAudit", {
      action: "b2bAds.launch",
      table: "meta",
      rowId: a.campaignId,
      what: a.what,
      before: { draftId: a.draftId },
      after: a.after,
      by: a.by,
      at: Date.now(),
    });
    return null;
  },
});

export const list = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Draft[]> => {
    await ctx.runQuery(internal.ceo.b2bControl.gate, { userId: ctx.userId });
    const rows = await rest(
      `${TABLE}?select=*&status=neq.discarded&order=created_at.desc&limit=20`,
    );
    return rows.map(toDraft);
  },
});

export const build = authenticatedAction({
  args: {
    kind: v.union(v.literal("lead_gen"), v.literal("retargeting")),
    brief: v.string(),
    dailyBudgetUsd: v.number(),
    cloneAdIds: v.array(v.string()),
    language: v.optional(v.union(v.literal("ar"), v.literal("en"))),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<Draft> => {
    const by: string = await ctx.runQuery(internal.ceo.b2bControl.gate, {
      userId: ctx.userId,
    });
    const brief = a.brief.trim();
    if (brief.length < 12)
      throw new Error(
        "Write a brief first: who it is for and what it promises.",
      );
    if (!(a.dailyBudgetUsd >= 5))
      throw new Error("The daily budget must be at least $5.");
    const language = a.language ?? "ar";
    const name = `MaharaMedia | ${KIND_LABEL[a.kind]} | ${stamp(kuwaitDay())}`;

    const inserted = await rest(TABLE, {
      method: "POST",
      body: {
        kind: a.kind,
        name,
        brief,
        daily_budget_usd: a.dailyBudgetUsd,
        clone_ad_ids: a.cloneAdIds,
        status: "building",
        created_by: by,
      },
      prefer: "return=representation",
    });
    const id = Number(inserted[0]?.id);
    if (!id) throw new Error("Supabase did not return the draft id");

    try {
      // 1. Settings come from the best ad set of the SAME kind.
      const best = await bestAdset(a.kind);
      let targeting: Any | undefined;
      let optimizationGoal: string | undefined;
      let billingEvent: string | undefined;
      let promotedObject: Any | undefined;
      let objective: string | undefined;
      let sourceReason = "";
      if (best) {
        const full: Any = await graph(String(best.adset_id), {
          fields:
            "id,name,account_id,targeting,optimization_goal,billing_event,promoted_object,campaign{objective}",
        });
        if (String(full?.account_id ?? "") !== ACCOUNT)
          throw new Error("The winning ad set is not on Mahara's own account.");
        targeting = cleanTargeting(full?.targeting);
        optimizationGoal = full?.optimization_goal;
        billingEvent = full?.billing_event;
        promotedObject = cleanPromoted(full?.promoted_object);
        objective = full?.campaign?.objective;
        const why =
          num(best.demos_shown) > 0
            ? `${num(best.demos_shown)} demos shown in 90 days`
            : num(best.leads) > 0
              ? `${num(best.leads)} leads in 90 days`
              : `the most ${KIND_LABEL[a.kind].toLowerCase()} spend in 90 days, $${num(best.spend).toFixed(0)}, with no attributed calls`;
        sourceReason = `Settings copied from "${best.adset_name}" (${why}): audience, optimisation goal, pixel event and page.`;
      } else {
        sourceReason = `No ${KIND_LABEL[a.kind].toLowerCase()} ad set spent in the last 90 days, so the targeting is a plain Kuwait default. Check it before launching.`;
      }

      // 2. Creatives: the winners ticked, or the top two of the kind.
      let cloneIds = a.cloneAdIds.filter(x => /^\d{5,}$/.test(x)).slice(0, 8);
      let picked = false;
      if (!cloneIds.length) {
        cloneIds = await topAds(a.kind, 2);
        picked = cloneIds.length > 0;
      }
      const winners: { name: string; body: string }[] = [];
      const cloneNames: string[] = [];
      for (const adId of cloneIds) {
        const ad = await ownAd(adId);
        cloneNames.push(String(ad.name ?? adId));
        const body = bodyOf(ad);
        if (body) winners.push({ name: String(ad.name ?? adId), body });
      }
      if (cloneNames.length)
        sourceReason += ` Creatives reused${picked ? " (chosen for you: the top of the kind in 90 days)" : ""}: ${cloneNames.join("; ")}.`;

      // 3. Copy, briefed for the kind, in the territory of those winners. A
      // draft without copy is still a draft: the winners are reused as they
      // are and the angles can be typed by hand.
      let variants: Variant[] = [];
      try {
        variants = await writeCopy(a.kind, brief, language, winners);
      } catch (e) {
        sourceReason += ` Copy was not written (${String(e instanceof Error ? e.message : e).slice(0, 120)}); add your own angles below or launch the winners as they are.`;
      }

      return await patch(id, {
        status: "ready",
        source_adset_id: best ? String(best.adset_id) : null,
        source_adset_name: best ? String(best.adset_name) : null,
        source_campaign_id: best ? String(best.campaign_id) : null,
        source_reason: sourceReason,
        objective: objective ?? "OUTCOME_LEADS",
        optimization_goal: optimizationGoal ?? null,
        billing_event: billingEvent ?? null,
        targeting: targeting ?? null,
        promoted_object: promotedObject ?? null,
        clone_ad_ids: cloneIds,
        variants,
        error: null,
      });
    } catch (e) {
      return await patch(id, {
        status: "failed",
        error: String(e instanceof Error ? e.message : e).slice(0, 400),
      });
    }
  },
});

export const save = authenticatedAction({
  args: {
    id: v.number(),
    name: v.string(),
    dailyBudgetUsd: v.number(),
    variants: v.array(
      v.object({ headline: v.string(), primaryText: v.string() }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<Draft> => {
    await ctx.runQuery(internal.ceo.b2bControl.gate, { userId: ctx.userId });
    const [row] = await rest(`${TABLE}?id=eq.${a.id}&select=status,kind`);
    if (!row) throw new Error("Draft not found");
    if (row.status !== "ready" && row.status !== "failed")
      throw new Error(`A ${row.status} draft cannot be edited.`);
    const name = a.name.trim();
    if (!name) throw new Error("The campaign needs a name.");
    // The name is how the account files campaigns apart; a retargeting draft
    // must keep the word, or it will be counted as lead gen from day one.
    if (
      row.kind === "retargeting" &&
      !/retarget|remarket|hammer them/i.test(name)
    )
      throw new Error(
        'A retargeting campaign must keep "Retargeting" in its name, or it will be counted as lead gen.',
      );
    if (
      row.kind === "lead_gen" &&
      /retarget|remarket|hammer them|hiring|recruit/i.test(name)
    )
      throw new Error(
        "That name would file a lead-gen campaign as retargeting or hiring.",
      );
    if (!(a.dailyBudgetUsd >= 5))
      throw new Error("The daily budget must be at least $5.");
    const variants = a.variants
      .map(x => ({
        headline: x.headline.trim(),
        primaryText: x.primaryText.trim(),
      }))
      .filter(x => x.headline && x.primaryText);
    return await patch(a.id, {
      name,
      daily_budget_usd: a.dailyBudgetUsd,
      variants,
      status: "ready",
      error: null,
    });
  },
});

export const discard = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, { id }): Promise<Draft> => {
    await ctx.runQuery(internal.ceo.b2bControl.gate, { userId: ctx.userId });
    const [row] = await rest(`${TABLE}?id=eq.${id}&select=status`);
    if (!row) throw new Error("Draft not found");
    if (row.status === "launched")
      throw new Error(
        "That draft is already on Meta; switch the campaign off from the list instead.",
      );
    return await patch(id, { status: "discarded" });
  },
});

export const launch = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, { id }): Promise<Draft> => {
    const by: string = await ctx.runQuery(internal.ceo.b2bControl.gate, {
      userId: ctx.userId,
    });
    const [row] = await rest(`${TABLE}?id=eq.${id}&select=*`);
    if (!row) throw new Error("Draft not found");
    if (row.status !== "ready" && row.status !== "failed")
      throw new Error(`A ${row.status} draft cannot be launched.`);
    const draft = toDraft(row);
    if (
      draft.kind === "retargeting" &&
      !/retarget|remarket|hammer them/i.test(draft.name)
    )
      throw new Error(
        'A retargeting campaign must keep "Retargeting" in its name.',
      );
    await patch(id, { status: "launching", error: null });

    const problems: string[] = [];
    let campaignId = "";
    let adsetId = "";
    const adIds: string[] = [];
    try {
      // Everything reused is re-checked against the account before any write.
      const clones: Any[] = [];
      for (const adId of draft.cloneAdIds) clones.push(await ownAd(adId));

      const campaign = unwrap(
        await callTool("mcp_meta_ads_create_campaign", {
          ad_account_id: ACT,
          name: draft.name,
          objective: row.objective || "OUTCOME_LEADS",
          status: "PAUSED",
          special_ad_categories: [],
        }),
      );
      campaignId = String(campaign?.id ?? "");
      if (!campaignId) throw new Error("Meta did not return a campaign id");

      const promoted = cleanPromoted(row.promoted_object);
      const adSet = unwrap(
        await callTool("mcp_meta_ads_create_ad_set", {
          ad_account_id: ACT,
          campaign_id: campaignId,
          name: `${KIND_LABEL[draft.kind]} | ${draft.sourceAdsetName ? `from ${draft.sourceAdsetName}` : "fresh"} | ${stamp(kuwaitDay())}`,
          status: "PAUSED",
          daily_budget: String(Math.round(draft.dailyBudgetUsd * 100)),
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          targeting: cleanTargeting(row.targeting),
          optimization_goal: row.optimization_goal || "OFFSITE_CONVERSIONS",
          billing_event: row.billing_event || "IMPRESSIONS",
          ...(promoted ? { promoted_object: promoted } : {}),
        }),
      );
      adsetId = String(adSet?.id ?? "");
      if (!adsetId) throw new Error("Meta did not return an ad set id");

      // Winners, cloned as they are.
      for (const ad of clones) {
        const creativeId = String(ad?.creative?.id ?? "");
        if (!creativeId) {
          problems.push(`${ad?.name ?? ad?.id}: no creative to reuse`);
          continue;
        }
        try {
          const made: Any = await graphPost(`${ACT}/ads`, {
            name: `${String(ad.name ?? ad.id)} | relaunch`,
            adset_id: adsetId,
            status: "PAUSED",
            creative: JSON.stringify({ creative_id: creativeId }),
          });
          if (made?.id) adIds.push(String(made.id));
        } catch (e) {
          problems.push(
            `${ad?.name ?? ad?.id}: ${String(e instanceof Error ? e.message : e).slice(0, 220)}`,
          );
        }
      }

      // New copy rides the first winner that has a rebuildable creative.
      const media = clones.find(
        c =>
          c?.creative?.object_story_spec?.video_data ||
          c?.creative?.object_story_spec?.link_data,
      );
      if (draft.variants.length && media) {
        const base: Any = media.creative.object_story_spec;
        for (const [i, variant] of draft.variants.entries()) {
          const spec: Any = JSON.parse(JSON.stringify(base));
          if (spec.video_data) {
            spec.video_data.message = variant.primaryText;
            spec.video_data.title = variant.headline;
            if (spec.video_data.image_hash) delete spec.video_data.image_url;
          } else if (spec.link_data) {
            spec.link_data.message = variant.primaryText;
            spec.link_data.name = variant.headline;
          }
          const label = `Angle ${i + 1} | ${variant.headline.slice(0, 40)}`;
          try {
            // No degrees_of_freedom_spec: Meta refuses the old standard
            // enhancements flag outright (#3858504) and applies its defaults.
            const creative: Any = await graphPost(`${ACT}/adcreatives`, {
              name: label,
              object_story_spec: JSON.stringify(spec),
            });
            const made: Any = await graphPost(`${ACT}/ads`, {
              name: label,
              adset_id: adsetId,
              status: "PAUSED",
              creative: JSON.stringify({ creative_id: String(creative.id) }),
            });
            if (made?.id) adIds.push(String(made.id));
          } catch (e) {
            problems.push(
              `${label}: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`,
            );
          }
        }
      } else if (draft.variants.length) {
        problems.push(
          `The ${draft.variants.length} copy variants were not attached: none of the reused winners has a video or link creative to carry them. Paste them in Ads Manager.`,
        );
      }

      const what = `Launched "${draft.name}" paused on Mahara's own ad account: $${draft.dailyBudgetUsd}/day, ${adIds.length} ads (${clones.length} winners reused, ${draft.variants.length} copy variants)${problems.length ? `, ${problems.length} problems` : ""}.`;
      await ctx.runMutation(internal.ceo.b2bLaunch.recordLaunch, {
        draftId: id,
        campaignId,
        what,
        after: { campaignId, adsetId, adIds, problems },
        by,
      });
      return await patch(id, {
        status: "launched",
        meta_campaign_id: campaignId,
        meta_adset_id: adsetId,
        meta_ad_ids: adIds,
        error: problems.length ? problems.join(" · ").slice(0, 900) : null,
        launched_at: new Date().toISOString(),
      });
    } catch (e) {
      // A campaign or ad set that did get made is recorded, so a retry does
      // not build a second copy of it beside the first.
      return await patch(id, {
        status: "failed",
        meta_campaign_id: campaignId || null,
        meta_adset_id: adsetId || null,
        meta_ad_ids: adIds,
        error: [
          String(e instanceof Error ? e.message : e).slice(0, 400),
          ...problems,
        ]
          .join(" · ")
          .slice(0, 900),
      });
    }
  },
});
