import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { authenticatedAction } from "../functions";
import { graph, graphPost } from "../tools";
import {
  ACT,
  type Any,
  bodyOf,
  cents,
  checkName,
  cleanPromoted,
  cleanTargeting,
  headlineOf,
  type Idea,
  isMetaId,
  type Kind,
  ownAd,
  ownAdset,
  ownCampaign,
  usdOf,
  writeCopy,
} from "./adMeta";
import { kuwaitDay } from "./time";

/**
 * Everything Ads Manager can do to Mahara's own account, from the Ads tab.
 *
 * Aziz, 2026-09-22: "I should be able to do literally everything I can do on
 * Meta itself. I should be able to add an ad set to a campaign. I should be
 * able to add ads to an ad set, not just launch a new campaign... It produces,
 * for each ad, 3 to 5 diverse ad copies for approval... I can change the
 * budget."
 *
 * The rules are the ones the launch flow already lives by, and they are not
 * negotiable per action:
 *   — only the CEO role may press any of this (`b2bControl.gate`);
 *   — every object is re-read from Meta and refused unless it is on account
 *     746108264865897, because a Meta id is global and a pasted client id
 *     would otherwise go straight through;
 *   — anything created is created PAUSED, so a mistake costs nothing and the
 *     switch that turns it on is the one on the row, which re-reads Meta;
 *   — every write leaves an audit row naming the object and who did it;
 *   — copy is generated for approval and never published by the model. A
 *     variant becomes an ad only when it is passed back in, one call later.
 */

type Level = "campaign" | "adset" | "ad";

export const record = internalMutation({
  args: {
    action: v.string(),
    metaId: v.string(),
    what: v.string(),
    before: v.any(),
    after: v.any(),
    by: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("ceoAudit", {
      action: a.action,
      table: "meta",
      rowId: a.metaId,
      what: a.what,
      before: a.before,
      after: a.after,
      by: a.by,
      at: Date.now(),
    });
    return null;
  },
});

/** The campaign kind the way `b2b_campaign_type` reads it: from the name. */
function kindOfName(name: string): Kind | "unknown" {
  if (/retarget|remarket|hammer them/i.test(name)) return "retargeting";
  if (/hiring|recruit/i.test(name)) return "unknown";
  return "lead_gen";
}

async function read(level: Level, id: string): Promise<Any> {
  return level === "campaign"
    ? ownCampaign(id)
    : level === "adset"
      ? ownAdset(id)
      : ownAd(id);
}

/** A short, readable summary of who an audience is. */
function audienceOf(t: Any | undefined): {
  countries: string[];
  ageMin: number | null;
  ageMax: number | null;
  genders: string;
  custom: number;
  excluded: number;
  detailed: number;
} {
  const g = t?.geo_locations ?? {};
  const genders = Array.isArray(t?.genders)
    ? t.genders.includes(1) && t.genders.includes(2)
      ? "everyone"
      : t.genders.includes(1)
        ? "men"
        : t.genders.includes(2)
          ? "women"
          : "everyone"
    : "everyone";
  const flex = Array.isArray(t?.flexible_spec) ? t.flexible_spec : [];
  const detailed = flex.reduce(
    (n: number, f: Any) =>
      n +
      Object.values(f ?? {}).reduce(
        (m: number, v) => m + (Array.isArray(v) ? v.length : 0),
        0,
      ),
    0,
  );
  return {
    countries: Array.isArray(g.countries) ? g.countries.map(String) : [],
    ageMin: t?.age_min ? Number(t.age_min) : null,
    ageMax: t?.age_max ? Number(t.age_max) : null,
    genders,
    custom: Array.isArray(t?.custom_audiences) ? t.custom_audiences.length : 0,
    excluded: Array.isArray(t?.excluded_custom_audiences)
      ? t.excluded_custom_audiences.length
      : 0,
    detailed,
  };
}

/**
 * What one object looks like on Meta right now, for the edit panel. Read live
 * rather than from the stored payload, because a budget typed here has to
 * start from the number Meta is actually spending, not yesterday's snapshot.
 */
export const inspect = authenticatedAction({
  args: {
    metaId: v.string(),
    level: v.union(v.literal("campaign"), v.literal("adset"), v.literal("ad")),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<Any> => {
    await ctx.runQuery(internal.ceo.b2bControl.gate, { userId: ctx.userId });
    const o = await read(a.level, a.metaId);
    if (a.level === "campaign")
      return {
        level: "campaign",
        id: String(o.id),
        name: String(o.name ?? ""),
        status: String(o.status ?? ""),
        effectiveStatus: String(o.effective_status ?? ""),
        objective: String(o.objective ?? ""),
        kind: kindOfName(String(o.name ?? "")),
        dailyBudgetUsd: usdOf(o.daily_budget),
        lifetimeBudgetUsd: usdOf(o.lifetime_budget),
        /** True when the campaign holds the budget, so its ad sets must not. */
        budgetIsHere: Boolean(o.daily_budget || o.lifetime_budget),
        bidStrategy: o.bid_strategy ? String(o.bid_strategy) : null,
      };
    if (a.level === "adset")
      return {
        level: "adset",
        id: String(o.id),
        name: String(o.name ?? ""),
        status: String(o.status ?? ""),
        effectiveStatus: String(o.effective_status ?? ""),
        campaignId: String(o.campaign_id ?? ""),
        campaignName: String(o.campaign?.name ?? ""),
        objective: String(o.campaign?.objective ?? ""),
        dailyBudgetUsd: usdOf(o.daily_budget),
        lifetimeBudgetUsd: usdOf(o.lifetime_budget),
        budgetIsOnCampaign: Boolean(
          o.campaign?.daily_budget || o.campaign?.lifetime_budget,
        ),
        bidStrategy: o.bid_strategy ? String(o.bid_strategy) : null,
        bidAmountUsd: usdOf(o.bid_amount),
        optimizationGoal: o.optimization_goal
          ? String(o.optimization_goal)
          : null,
        billingEvent: o.billing_event ? String(o.billing_event) : null,
        startTime: o.start_time ? String(o.start_time) : null,
        endTime: o.end_time ? String(o.end_time) : null,
        audience: audienceOf(o.targeting),
        pixelEvent: o.promoted_object?.custom_event_type
          ? String(o.promoted_object.custom_event_type)
          : null,
      };
    return {
      level: "ad",
      id: String(o.id),
      name: String(o.name ?? ""),
      status: String(o.status ?? ""),
      effectiveStatus: String(o.effective_status ?? ""),
      adsetId: String(o.adset_id ?? ""),
      campaignId: String(o.campaign_id ?? ""),
      headline: headlineOf(o),
      primaryText: bodyOf(o),
      creativeId: o.creative?.id ? String(o.creative.id) : null,
      canCarryCopy: Boolean(
        o.creative?.object_story_spec?.video_data ||
          o.creative?.object_story_spec?.link_data,
      ),
    };
  },
});

/** Rename a campaign, ad set or ad. The campaign name is load-bearing. */
export const rename = authenticatedAction({
  args: {
    metaId: v.string(),
    level: v.union(v.literal("campaign"), v.literal("adset"), v.literal("ad")),
    name: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<Any> => {
    const by: string = await ctx.runQuery(internal.ceo.b2bControl.gate, {
      userId: ctx.userId,
    });
    const o = await read(a.level, a.metaId);
    const name = a.name.trim();
    if (!name) throw new Error("A name cannot be empty.");
    if (name.length > 200) throw new Error("That name is too long for Meta.");
    if (a.level === "campaign") checkName(kindOfName(String(o.name)), name);
    await graphPost(a.metaId, { name });
    await ctx.runMutation(internal.ceo.b2bManage.record, {
      action: "b2bAds.rename",
      metaId: a.metaId,
      what: `Renamed the ${a.level} "${String(o.name ?? "")}" to "${name}"`,
      before: { name: String(o.name ?? "") },
      after: { name },
      by,
    });
    return { ok: true, name };
  },
});

/**
 * Change a budget. Meta keeps the budget in exactly one place per campaign:
 * on the campaign when it shares across ad sets, otherwise on each ad set.
 * Writing to the wrong one is refused here with the reason, rather than left
 * to a Graph error nobody can read.
 */
export const setBudget = authenticatedAction({
  args: {
    metaId: v.string(),
    level: v.union(v.literal("campaign"), v.literal("adset")),
    dailyUsd: v.optional(v.number()),
    lifetimeUsd: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (
    ctx,
    a,
  ): Promise<{ ok: boolean; warning?: string; dailyUsd?: number | null }> => {
    const by: string = await ctx.runQuery(internal.ceo.b2bControl.gate, {
      userId: ctx.userId,
    });
    if (a.dailyUsd === undefined && a.lifetimeUsd === undefined)
      throw new Error("Say which budget to set: daily or lifetime.");
    if (a.dailyUsd !== undefined && a.lifetimeUsd !== undefined)
      throw new Error(
        "A budget is daily or lifetime, never both. Meta keeps one.",
      );
    const amount = a.dailyUsd ?? a.lifetimeUsd ?? 0;
    if (!(amount >= 1))
      throw new Error("A budget of less than $1 will be refused by Meta.");
    if (amount > 5000)
      throw new Error(
        `$${amount} a day is far outside anything this account has spent. Set it in Ads Manager if that is really the intent.`,
      );

    const o = await read(a.level, a.metaId);
    if (a.level === "adset") {
      if (o.campaign?.daily_budget || o.campaign?.lifetime_budget)
        throw new Error(
          `"${String(o.campaign?.name ?? "The campaign")}" holds the budget for all its ad sets, so this ad set cannot have its own. Change the campaign budget instead.`,
        );
    } else if (!(o.daily_budget || o.lifetime_budget)) {
      throw new Error(
        "This campaign lets each ad set hold its own budget, so there is no campaign budget to change. Change the ad set's.",
      );
    }
    const before = usdOf(o.daily_budget) ?? usdOf(o.lifetime_budget);
    const field = a.dailyUsd !== undefined ? "daily_budget" : "lifetime_budget";
    await graphPost(a.metaId, { [field]: cents(amount) });

    // Meta restarts the learning phase on a big budget move, and the first
    // days after it are not comparable with the ones before.
    const warning =
      before && before > 0 && Math.abs(amount - before) / before > 0.2
        ? `That is a ${amount > before ? "rise" : "cut"} of ${Math.round((Math.abs(amount - before) / before) * 100)}%. Meta restarts the learning phase over about 20%, so the next few days will cost more per result before they settle.`
        : undefined;
    await ctx.runMutation(internal.ceo.b2bManage.record, {
      action: "b2bAds.budget",
      metaId: a.metaId,
      what: `Set the ${a.dailyUsd !== undefined ? "daily" : "lifetime"} budget on ${a.level} "${String(o.name ?? "")}" to $${amount}${before ? ` from $${before}` : ""}`,
      before: { budgetUsd: before },
      after: { budgetUsd: amount, field },
      by,
    });
    return { ok: true, warning, dailyUsd: a.dailyUsd ?? null };
  },
});

/** When an ad set starts and stops delivering. */
export const setSchedule = authenticatedAction({
  args: {
    adsetId: v.string(),
    /** ISO 8601, or empty to clear the end date. */
    endTime: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: boolean }> => {
    const by: string = await ctx.runQuery(internal.ceo.b2bControl.gate, {
      userId: ctx.userId,
    });
    const o = await ownAdset(a.adsetId);
    const end = a.endTime.trim();
    if (end && Number.isNaN(Date.parse(end)))
      throw new Error("That end date is not a date Meta will accept.");
    if (end && Date.parse(end) < Date.now())
      throw new Error("An end date in the past would stop the ad set at once.");
    await graphPost(a.adsetId, end ? { end_time: end } : { end_time: "" });
    await ctx.runMutation(internal.ceo.b2bManage.record, {
      action: "b2bAds.schedule",
      metaId: a.adsetId,
      what: end
        ? `Set "${String(o.name ?? "")}" to stop on ${end.slice(0, 10)}`
        : `Removed the end date on "${String(o.name ?? "")}"`,
      before: { endTime: o.end_time ?? null },
      after: { endTime: end || null },
      by,
    });
    return { ok: true };
  },
});

/**
 * Narrow or widen an existing audience: the countries it buys and the ages it
 * buys them at. Everything else about the targeting is left exactly as Meta
 * has it, because an audience rewritten from a form is an audience nobody
 * chose. Meta restarts the learning phase on a targeting change, so the
 * answer says so.
 */
export const setAudience = authenticatedAction({
  args: {
    adsetId: v.string(),
    countries: v.array(v.string()),
    ageMin: v.optional(v.number()),
    ageMax: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: boolean; note: string }> => {
    const by: string = await ctx.runQuery(internal.ceo.b2bControl.gate, {
      userId: ctx.userId,
    });
    const o = await ownAdset(a.adsetId);
    const targeting = cleanTargeting(o.targeting);
    const before = JSON.stringify({
      countries: targeting.geo_locations?.countries ?? null,
      ageMin: targeting.age_min ?? null,
      ageMax: targeting.age_max ?? null,
    });
    const countries = a.countries
      .map(c => c.trim().toUpperCase().slice(0, 2))
      .filter(c => /^[A-Z]{2}$/.test(c));
    if (countries.length)
      targeting.geo_locations = {
        ...(targeting.geo_locations ?? {}),
        countries,
      };
    if (a.ageMin) targeting.age_min = Math.max(18, Math.round(a.ageMin));
    if (a.ageMax) targeting.age_max = Math.min(65, Math.round(a.ageMax));
    if (
      targeting.age_min &&
      targeting.age_max &&
      targeting.age_min > targeting.age_max
    )
      throw new Error("The youngest age has to be below the oldest.");
    await graphPost(a.adsetId, { targeting: JSON.stringify(targeting) });
    const note = `Audience changed on "${String(o.name ?? "")}": ${countries.length ? countries.join(", ") : "countries unchanged"}${targeting.age_min || targeting.age_max ? `, ${targeting.age_min ?? 18} to ${targeting.age_max ?? 65}` : ""}. Meta restarts the learning phase after a targeting change, so the next few days cost more per result before they settle.`;
    await ctx.runMutation(internal.ceo.b2bManage.record, {
      action: "b2bAds.audience",
      metaId: a.adsetId,
      what: note,
      before: JSON.parse(before),
      after: {
        countries: targeting.geo_locations?.countries ?? null,
        ageMin: targeting.age_min ?? null,
        ageMax: targeting.age_max ?? null,
      },
      by,
    });
    return { ok: true, note };
  },
});

/**
 * Add an ad set to a campaign that already exists.
 *
 * The settings come from an ad set that is already working: targeting,
 * optimisation goal, billing event and pixel event are copied whole, because
 * typing an audience by hand is how a campaign quietly starts buying the
 * wrong people. The only things asked for are the name, the budget, and
 * optionally a narrower country or age.
 */
export const createAdset = authenticatedAction({
  args: {
    campaignId: v.string(),
    name: v.string(),
    dailyBudgetUsd: v.number(),
    /** The ad set whose audience and optimisation to copy. */
    copyFromAdsetId: v.string(),
    countries: v.optional(v.array(v.string())),
    ageMin: v.optional(v.number()),
    ageMax: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (
    ctx,
    a,
  ): Promise<{ id: string; name: string; note: string }> => {
    const by: string = await ctx.runQuery(internal.ceo.b2bControl.gate, {
      userId: ctx.userId,
    });
    const campaign = await ownCampaign(a.campaignId);
    const source = await ownAdset(a.copyFromAdsetId);
    if (String(source.campaign_id ?? "") !== String(campaign.id))
      // Copying across campaigns is allowed and often right, but say so.
      void 0;
    const name = a.name.trim();
    if (name.length < 3) throw new Error("Give the ad set a name.");
    const onCampaign = Boolean(
      campaign.daily_budget || campaign.lifetime_budget,
    );
    if (!onCampaign && !(a.dailyBudgetUsd >= 1))
      throw new Error("The daily budget must be at least $1.");

    const targeting = cleanTargeting(source.targeting);
    if (a.countries?.length)
      targeting.geo_locations = {
        ...(targeting.geo_locations ?? {}),
        countries: a.countries.map(c => c.toUpperCase().slice(0, 2)),
      };
    if (a.ageMin) targeting.age_min = Math.max(18, Math.round(a.ageMin));
    if (a.ageMax) targeting.age_max = Math.min(65, Math.round(a.ageMax));
    const promoted = cleanPromoted(source.promoted_object);

    const made: Any = await graphPost(`${ACT}/adsets`, {
      campaign_id: String(campaign.id),
      name,
      status: "PAUSED",
      // A campaign that shares its budget owns the bid strategy as well, and
      // Meta refuses both on the ad set (the live account's one lead-gen
      // campaign is on campaign budget optimisation, so this is the normal
      // path, not the edge case).
      ...(onCampaign
        ? {}
        : {
            daily_budget: cents(a.dailyBudgetUsd),
            bid_strategy: String(
              source.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP",
            ),
          }),
      targeting: JSON.stringify(targeting),
      optimization_goal: String(
        source.optimization_goal ?? "OFFSITE_CONVERSIONS",
      ),
      billing_event: String(source.billing_event ?? "IMPRESSIONS"),
      ...(promoted ? { promoted_object: JSON.stringify(promoted) } : {}),
    });
    const id = String(made?.id ?? "");
    if (!id) throw new Error("Meta did not return an ad set id.");
    const note = `Paused, on "${String(campaign.name ?? "")}". Audience, optimisation and pixel event copied from "${String(source.name ?? "")}"${onCampaign ? `. The campaign holds the budget, so this ad set has none of its own` : `, at $${a.dailyBudgetUsd} a day`}. Add ads to it, then switch it on.`;
    await ctx.runMutation(internal.ceo.b2bManage.record, {
      action: "b2bAds.createAdset",
      metaId: id,
      what: `Added the ad set "${name}" to "${String(campaign.name ?? "")}", paused`,
      before: { copiedFrom: String(source.id) },
      after: {
        id,
        dailyBudgetUsd: onCampaign ? null : a.dailyBudgetUsd,
        countries: targeting.geo_locations?.countries ?? null,
      },
      by,
    });
    return { id, name, note };
  },
});

/** Duplicate an ad set, with or without its ads, paused. */
export const duplicateAdset = authenticatedAction({
  args: {
    adsetId: v.string(),
    name: v.optional(v.string()),
    withAds: v.boolean(),
  },
  returns: v.any(),
  handler: async (
    ctx,
    a,
  ): Promise<{ id: string; name: string; ads: number; note: string }> => {
    const by: string = await ctx.runQuery(internal.ceo.b2bControl.gate, {
      userId: ctx.userId,
    });
    const source = await ownAdset(a.adsetId);
    const name =
      a.name?.trim() ||
      `${String(source.name ?? "Ad set")} | copy ${kuwaitDay()}`;
    const onCampaign = Boolean(
      source.campaign?.daily_budget || source.campaign?.lifetime_budget,
    );
    const promoted = cleanPromoted(source.promoted_object);
    const made: Any = await graphPost(`${ACT}/adsets`, {
      campaign_id: String(source.campaign_id),
      name,
      status: "PAUSED",
      ...(onCampaign
        ? {}
        : {
            ...(source.daily_budget
              ? { daily_budget: String(source.daily_budget) }
              : source.lifetime_budget
                ? { lifetime_budget: String(source.lifetime_budget) }
                : {}),
            bid_strategy: String(
              source.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP",
            ),
          }),
      targeting: JSON.stringify(cleanTargeting(source.targeting)),
      optimization_goal: String(
        source.optimization_goal ?? "OFFSITE_CONVERSIONS",
      ),
      billing_event: String(source.billing_event ?? "IMPRESSIONS"),
      ...(promoted ? { promoted_object: JSON.stringify(promoted) } : {}),
    });
    const id = String(made?.id ?? "");
    if (!id) throw new Error("Meta did not return an ad set id.");

    let copied = 0;
    const problems: string[] = [];
    if (a.withAds) {
      const list: Any = await graph(`${a.adsetId}/ads`, {
        fields: "id,name,creative{id}",
        limit: 50,
      });
      for (const ad of (list?.data ?? []) as Any[]) {
        const creativeId = String(ad?.creative?.id ?? "");
        if (!creativeId) continue;
        try {
          await graphPost(`${ACT}/ads`, {
            name: String(ad.name ?? ad.id),
            adset_id: id,
            status: "PAUSED",
            creative: JSON.stringify({ creative_id: creativeId }),
          });
          copied += 1;
        } catch (e) {
          problems.push(
            `${ad?.name ?? ad?.id}: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`,
          );
        }
      }
    }
    const note = `Paused copy of "${String(source.name ?? "")}"${a.withAds ? ` with ${copied} ${copied === 1 ? "ad" : "ads"}` : " with no ads yet"}.${problems.length ? ` ${problems.length} did not copy: ${problems.join("; ").slice(0, 300)}` : ""}`;
    await ctx.runMutation(internal.ceo.b2bManage.record, {
      action: "b2bAds.duplicateAdset",
      metaId: id,
      what: `Duplicated the ad set "${String(source.name ?? "")}" as "${name}", paused`,
      before: { from: a.adsetId },
      after: { id, ads: copied, problems },
      by,
    });
    return { id, name, ads: copied, note };
  },
});

/**
 * Three to five diverse angles for approval. Nothing is written to Meta: the
 * answer comes back, a person reads it, and only the ones ticked are passed
 * to `createAds`.
 */
export const copyIdeas = authenticatedAction({
  args: {
    /** The ad set the copy is for; its campaign decides cold or warm. */
    adsetId: v.string(),
    brief: v.string(),
    language: v.union(v.literal("ar"), v.literal("en")),
    count: v.optional(v.number()),
    /** Ads whose text sets the territory. Defaults to the ad set's own. */
    fromAdIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ kind: Kind; ideas: Idea[] }> => {
    await ctx.runQuery(internal.ceo.b2bControl.gate, { userId: ctx.userId });
    const brief = a.brief.trim();
    if (brief.length < 12)
      throw new Error(
        "Write a brief first: who it is for and what it promises.",
      );
    const adset = await ownAdset(a.adsetId);
    const kindGuess = kindOfName(String(adset.campaign?.name ?? ""));
    const kind: Kind = kindGuess === "retargeting" ? "retargeting" : "lead_gen";

    let ids = (a.fromAdIds ?? []).filter(isMetaId).slice(0, 4);
    if (!ids.length) {
      const list: Any = await graph(`${a.adsetId}/ads`, {
        fields: "id,name",
        limit: 4,
      });
      ids = ((list?.data ?? []) as Any[]).map(x => String(x.id));
    }
    const winners: { name: string; body: string }[] = [];
    for (const id of ids) {
      try {
        const ad = await ownAd(id);
        const body = bodyOf(ad);
        if (body) winners.push({ name: String(ad.name ?? id), body });
      } catch {
        // An ad that cannot be read is simply not part of the territory.
      }
    }
    const ideas = await writeCopy(kind, brief, a.language, winners, a.count);
    if (!ideas.length)
      throw new Error(
        "No model returned usable copy. Check that a model key is set on the deployment.",
      );
    return { kind, ideas };
  },
});

/**
 * Add ads to an ad set that already exists: winners cloned as they are, and
 * approved copy riding one ad's video or image. Everything lands PAUSED.
 */
export const createAds = authenticatedAction({
  args: {
    adsetId: v.string(),
    /** Existing ads to clone into this ad set, creative and all. */
    cloneAdIds: v.optional(v.array(v.string())),
    /** Approved copy. Each becomes one ad riding `mediaFromAdId`. */
    variants: v.optional(
      v.array(
        v.object({
          headline: v.string(),
          primaryText: v.string(),
          angle: v.optional(v.string()),
        }),
      ),
    ),
    /** Whose video or image the new copy rides. */
    mediaFromAdId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (
    ctx,
    a,
  ): Promise<{ made: number; ids: string[]; problems: string[] }> => {
    const by: string = await ctx.runQuery(internal.ceo.b2bControl.gate, {
      userId: ctx.userId,
    });
    const adset = await ownAdset(a.adsetId);
    const clones = (a.cloneAdIds ?? []).filter(isMetaId).slice(0, 10);
    const variants = (a.variants ?? [])
      .map(x => ({
        headline: x.headline.trim(),
        primaryText: x.primaryText.trim(),
        angle: (x.angle ?? "").trim(),
      }))
      .filter(x => x.headline && x.primaryText)
      .slice(0, 5);
    if (!clones.length && !variants.length)
      throw new Error("Tick an ad to clone or approve some copy first.");

    const ids: string[] = [];
    const problems: string[] = [];

    for (const adId of clones) {
      try {
        const ad = await ownAd(adId);
        const creativeId = String(ad?.creative?.id ?? "");
        if (!creativeId) {
          problems.push(`${ad?.name ?? adId}: no creative to reuse`);
          continue;
        }
        const made: Any = await graphPost(`${ACT}/ads`, {
          name: `${String(ad.name ?? adId)} | copy`,
          adset_id: a.adsetId,
          status: "PAUSED",
          creative: JSON.stringify({ creative_id: creativeId }),
        });
        if (made?.id) ids.push(String(made.id));
      } catch (e) {
        problems.push(
          `${adId}: ${String(e instanceof Error ? e.message : e).slice(0, 180)}`,
        );
      }
    }

    if (variants.length) {
      // The new copy has to ride something. Prefer the ad that was asked for,
      // then the first ad in this set that has a rebuildable creative.
      let media: Any | null = null;
      const candidates = [
        ...(a.mediaFromAdId && isMetaId(a.mediaFromAdId)
          ? [a.mediaFromAdId]
          : []),
        ...clones,
      ];
      if (!candidates.length) {
        const list: Any = await graph(`${a.adsetId}/ads`, {
          fields: "id",
          limit: 10,
        });
        candidates.push(
          ...((list?.data ?? []) as Any[]).map(x => String(x.id)),
        );
      }
      for (const id of candidates) {
        try {
          const ad = await ownAd(id);
          const oss = ad?.creative?.object_story_spec;
          if (oss?.video_data || oss?.link_data) {
            media = ad;
            break;
          }
        } catch {
          // keep looking
        }
      }
      if (!media) {
        problems.push(
          `The ${variants.length} approved ${variants.length === 1 ? "angle" : "angles"} were not attached: no ad here has a video or image creative for them to ride. Clone a winner into this ad set first, or pick the ad to take the media from.`,
        );
      } else {
        const base: Any = media.creative.object_story_spec;
        for (const [i, variant] of variants.entries()) {
          const spec: Any = JSON.parse(JSON.stringify(base));
          if (spec.video_data) {
            spec.video_data.message = variant.primaryText;
            spec.video_data.title = variant.headline;
            if (spec.video_data.image_hash) delete spec.video_data.image_url;
          } else if (spec.link_data) {
            spec.link_data.message = variant.primaryText;
            spec.link_data.name = variant.headline;
          }
          const label = `${variant.angle || `Angle ${i + 1}`} | ${variant.headline.slice(0, 40)}`;
          try {
            // No degrees_of_freedom_spec: Meta refuses the old standard
            // enhancements flag outright (#3858504) and applies its defaults.
            const creative: Any = await graphPost(`${ACT}/adcreatives`, {
              name: label,
              object_story_spec: JSON.stringify(spec),
            });
            const made: Any = await graphPost(`${ACT}/ads`, {
              name: label,
              adset_id: a.adsetId,
              status: "PAUSED",
              creative: JSON.stringify({ creative_id: String(creative.id) }),
            });
            if (made?.id) ids.push(String(made.id));
          } catch (e) {
            problems.push(
              `${label}: ${String(e instanceof Error ? e.message : e).slice(0, 180)}`,
            );
          }
        }
      }
    }

    await ctx.runMutation(internal.ceo.b2bManage.record, {
      action: "b2bAds.createAds",
      metaId: a.adsetId,
      what: `Added ${ids.length} paused ${ids.length === 1 ? "ad" : "ads"} to "${String(adset.name ?? "")}" (${clones.length} cloned, ${variants.length} new ${variants.length === 1 ? "angle" : "angles"})${problems.length ? `, ${problems.length} refused` : ""}`,
      before: { adsetId: a.adsetId },
      after: { ids, problems },
      by,
    });
    return { made: ids.length, ids, problems };
  },
});
