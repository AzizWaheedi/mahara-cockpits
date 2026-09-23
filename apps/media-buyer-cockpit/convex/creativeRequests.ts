import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalQuery } from "./_generated/server";
import { kuwaitDay, shiftDay, windowResult } from "./changeResultsCore";
import { authenticatedAction } from "./functions";
import { refusal } from "./gate";
import { callTool, creativeRequestRest, unwrap } from "./tools";
import { DEPARTMENT_LIST } from "./writeback";

type RequestRow = {
  id: string;
  campaign_name: string;
  client_name: string;
  source_meta_ad_id: string | null;
  source_ad_name: string | null;
  request_reason?: string | null;
  already_open?: boolean;
  status: string;
  script_task_id?: string | null;
  script_task_url?: string | null;
  editor_task_id?: string | null;
  editor_task_url?: string | null;
  asset_url?: string | null;
  launched_meta_ad_id?: string | null;
  launched_at?: string | null;
  created_at?: string;
  launch_time_source?: string | null;
  verdict?: string | null;
  feedback_posted_at?: string | null;
  feedback_error?: string | null;
  last_error?: string | null;
};

function query(filters: Record<string, string>): string {
  const params = new URLSearchParams({ select: "*", ...filters });
  return `cockpit_creative_requests?${params.toString()}`;
}

async function one(id: string): Promise<RequestRow | null> {
  const rows = await creativeRequestRest<RequestRow[]>(
    query({ id: `eq.${id}`, limit: "1" }),
  );
  return rows[0] ?? null;
}

async function patch(
  id: string,
  body: Record<string, unknown>,
): Promise<RequestRow> {
  const rows = await creativeRequestRest<RequestRow[]>(
    query({ id: `eq.${id}` }),
    {
      method: "PATCH",
      body: { ...body, updated_at: new Date().toISOString() },
      prefer: "return=representation",
    },
  );
  if (!rows[0]) throw new Error("Could not read the updated creative request.");
  return rows[0];
}

/** Retry-safe task comments; a task is checked before its result is posted. */
type ReviewMetrics = {
  before: ReturnType<typeof windowResult> | null;
  after: ReturnType<typeof windowResult>;
};

async function shareFeedback(
  ctx: ActionCtx,
  row: RequestRow,
): Promise<RequestRow> {
  if (!row.verdict || !row.launched_meta_ad_id) return row;
  const targets = [
    ...new Set(
      [row.script_task_id, row.editor_task_id].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  ];
  if (targets.length === 0)
    return await patch(row.id, {
      feedback_error: "No linked ClickUp task to share the result with.",
      last_actor: "system",
    });
  const marker = `Creative request ${row.id}`;
  const metrics: ReviewMetrics | null = row.launched_at
    ? await ctx.runQuery(internal.creativeRequests.reviewMetrics, {
        campaignName: row.campaign_name,
        sourceAdId: row.source_meta_ad_id ?? undefined,
        launchedAdId: row.launched_meta_ad_id,
        launchedAt: Date.parse(row.launched_at),
      })
    : null;
  const describe = (label: string, period: ReturnType<typeof windowResult>) =>
    period.daysWithData === 0
      ? `${label}: ad data unavailable for ${period.from} to ${period.to}.`
      : `${label} (${period.from} to ${period.to}): $${period.spend.toFixed(2)} spend, ${period.leads} leads, ${period.cpl === null ? "CPL unavailable" : `$${period.cpl.toFixed(2)} CPL`}, ${period.attributedBookings} bookings matched to this ad. ${period.daysWithData} of 3 days had ad records.`;
  const text = [
    marker,
    "Buyer reviewed the new creative.",
    row.source_meta_ad_id
      ? `Original ad: ${row.source_ad_name} (${row.source_meta_ad_id})`
      : "Requested for the campaign without an original ad.",
    `Launched ad: ${row.launched_meta_ad_id}`,
    `Assessment: ${row.verdict.replaceAll("_", " ")}`,
    metrics?.before
      ? describe("Original ad before", metrics.before)
      : "No original ad was linked for comparison.",
    metrics
      ? describe("Replacement ad after", metrics.after)
      : "Replacement ad result unavailable.",
    "These ads ran in different periods. Other changes may have affected the result; matched bookings exclude those without an ad link.",
  ].join("\n");
  try {
    for (const taskId of targets) {
      const current = unwrap(
        await callTool("pd_clickup_proxy_get", {
          url: `https://api.clickup.com/api/v2/task/${taskId}/comment`,
        }),
      ) as { comments?: { text?: string; comment_text?: string }[] } | null;
      if (
        (current?.comments ?? []).some(comment =>
          String(comment.text ?? comment.comment_text ?? "").includes(marker),
        )
      )
        continue;
      await callTool("pd_clickup_proxy_post", {
        url: `https://api.clickup.com/api/v2/task/${taskId}/comment`,
        json_body: { comment_text: text, notify_all: false },
      });
    }
    return await patch(row.id, {
      feedback_posted_at: new Date().toISOString(),
      feedback_error: null,
      last_actor: "system",
    });
  } catch (error) {
    return await patch(row.id, {
      feedback_error:
        `Result saved, but ClickUp feedback is pending: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          250,
        ),
      last_actor: "system",
    });
  }
}

export const sourceAd = internalQuery({
  args: { campaignName: v.string(), adId: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { campaignName, adId }) => {
    const campaign = await ctx.db
      .query("campaigns")
      .filter(q => q.eq(q.field("campaignName"), campaignName))
      .first();
    if (!campaign) return null;
    const ad = adId
      ? await ctx.db
          .query("metaTree")
          .withIndex("by_meta", q => q.eq("metaId", adId))
          .first()
      : null;
    if (adId && (!ad || ad.kind !== "ad" || ad.campaignName !== campaignName))
      return null;
    const performance = adId
      ? (
          await ctx.db
            .query("ads")
            .withIndex("by_campaign", q => q.eq("campaignName", campaignName))
            .collect()
        ).find(row => row.metaAdId === adId)
      : null;
    return {
      campaignName,
      clientName: campaign.clientName ?? campaign.accountName,
      clientTag: campaign.clientTag,
      accountId: campaign.metaAccountId,
      adName: ad?.name ?? null,
      reason: campaign.reason,
      cpl: campaign.cpl,
      spend7d: campaign.spend7d,
      adSpend7d: performance?.spend,
      adLeads7d: performance?.leads,
      adCpl7d: performance?.cpl,
      adReason: performance?.reason,
      adDataAt: performance?.syncedAt,
    };
  },
});

export const launchContext = internalQuery({
  args: { campaignName: v.string(), adId: v.string() },
  returns: v.any(),
  handler: async (ctx, { campaignName, adId }) => {
    const ad = await ctx.db
      .query("metaTree")
      .withIndex("by_meta", q => q.eq("metaId", adId))
      .first();
    if (!ad || ad.kind !== "ad" || ad.campaignName !== campaignName)
      return null;
    return { adName: ad.name };
  },
});

export const reviewMetrics = internalQuery({
  args: {
    campaignName: v.string(),
    sourceAdId: v.optional(v.string()),
    launchedAdId: v.string(),
    launchedAt: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<ReviewMetrics> => {
    const day = kuwaitDay(args.launchedAt);
    const beforeFrom = shiftDay(day, -3);
    const beforeTo = shiftDay(day, -1);
    const afterFrom = shiftDay(day, 1);
    const afterTo = shiftDay(day, 3);
    const [daily, bookings] = await Promise.all([
      ctx.db
        .query("dailyStats")
        .withIndex("by_campaign_date", q =>
          q
            .eq("campaignName", args.campaignName)
            .gte("date", beforeFrom)
            .lte("date", afterTo),
        )
        .collect(),
      ctx.db
        .query("bookingEvents")
        .withIndex("by_campaign_date", q =>
          q
            .eq("campaignName", args.campaignName)
            .gte("date", beforeFrom)
            .lte("date", afterTo),
        )
        .collect(),
    ]);
    return {
      before: args.sourceAdId
        ? windowResult(
            beforeFrom,
            beforeTo,
            daily.filter(row => row.metaAdId === args.sourceAdId),
            bookings.filter(row => row.adId === args.sourceAdId),
          )
        : null,
      after: windowResult(
        afterFrom,
        afterTo,
        daily.filter(row => row.metaAdId === args.launchedAdId),
        bookings.filter(row => row.adId === args.launchedAdId),
      ),
    };
  },
});

export const list = authenticatedAction({
  args: { campaignName: v.string() },
  returns: v.any(),
  handler: async (ctx, { campaignName }) => {
    const no = await refusal(ctx, "media_buyer", { campaignName });
    if (no) throw new Error(no);
    return await creativeRequestRest<RequestRow[]>(
      query({
        campaign_name: `eq.${campaignName}`,
        order: "created_at.desc",
        limit: "30",
      }),
    );
  },
});

/** One buyer request opens one trace and one task on the director's board. */
export const request = authenticatedAction({
  args: {
    campaignName: v.string(),
    sourceAdId: v.optional(v.string()),
    reason: v.union(
      v.literal("more_ads"),
      v.literal("new_angle"),
      v.literal("fatigue"),
      v.literal("edit_visuals"),
    ),
    note: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const no = await refusal(ctx, "media_buyer", {
      campaignName: args.campaignName,
    });
    if (no) throw new Error(no);
    const source = await ctx.runQuery(internal.creativeRequests.sourceAd, {
      campaignName: args.campaignName,
      adId: args.sourceAdId,
    });
    if (!source?.accountId)
      throw new Error(
        "This campaign or ad is not available in the synced Meta account.",
      );
    const reasonLabel = {
      more_ads: "More ads to test",
      new_angle: "New message, angle, or hook",
      fatigue: "Refresh a fatigued ad",
      edit_visuals: "Improve the edit or visuals",
    }[args.reason];
    const note = args.note?.trim().slice(0, 500) || null;
    const existing = await creativeRequestRest<RequestRow[]>(
      query({
        campaign_name: `eq.${args.campaignName}`,
        source_meta_ad_id: args.sourceAdId
          ? `eq.${args.sourceAdId}`
          : "is.null",
        ...(args.sourceAdId ? {} : { request_reason: `eq.${args.reason}` }),
        status: "not.in.(reviewed,cancelled)",
        limit: "1",
      }),
    );
    if (existing[0]) return { ...existing[0], already_open: true };

    const by = await ctx.runQuery(internal.creativeRequests.userEmail, {
      userId: ctx.userId,
    });
    const evidence = [
      source.adReason ?? source.reason ?? "Buyer requested new creative.",
      args.sourceAdId
        ? source.adSpend7d != null
          ? `Affected ad, last 7 days: $${Number(source.adSpend7d).toFixed(2)} spend, ${source.adLeads7d == null ? "leads unavailable" : `${source.adLeads7d} leads`}, ${source.adCpl7d == null ? "CPL unavailable" : `$${Number(source.adCpl7d).toFixed(2)} CPL`}.`
          : "Affected ad performance was not available at request time."
        : `Campaign, last 7 days: ${source.spend7d == null ? "spend unavailable" : `$${Number(source.spend7d).toFixed(2)} spend`}; ${source.cpl == null ? "CPL unavailable" : `$${Number(source.cpl).toFixed(2)} CPL`}.`,
    ].join(" ");
    let inserted: RequestRow[];
    try {
      inserted = await creativeRequestRest<RequestRow[]>(
        "cockpit_creative_requests",
        {
          method: "POST",
          body: {
            campaign_name: args.campaignName,
            client_name: source.clientName,
            client_tag: source.clientTag,
            meta_account_id: String(source.accountId).replace(/^act_/, ""),
            source_meta_ad_id: args.sourceAdId ?? null,
            source_ad_name: source.adName,
            request_reason: args.reason,
            requested_by: by,
            evidence,
            note,
            last_actor: by,
          },
          prefer: "return=representation",
        },
      );
    } catch (error) {
      // A simultaneous click may have won the unique open-request slot.
      const concurrent = await creativeRequestRest<RequestRow[]>(
        query({
          campaign_name: `eq.${args.campaignName}`,
          source_meta_ad_id: args.sourceAdId
            ? `eq.${args.sourceAdId}`
            : "is.null",
          ...(args.sourceAdId ? {} : { request_reason: `eq.${args.reason}` }),
          status: "not.in.(reviewed,cancelled)",
          limit: "1",
        }),
      );
      if (concurrent[0]) return { ...concurrent[0], already_open: true };
      throw error;
    }
    const row = inserted[0];
    if (!row) throw new Error("Creative request was not saved.");
    try {
      const created = unwrap(
        await callTool("pd_clickup_proxy_post", {
          url: `https://api.clickup.com/api/v2/list/${DEPARTMENT_LIST.creative.id}/task`,
          json_body: {
            name: `Creative Request — ${source.clientName} — ${reasonLabel}`.slice(
              0,
              180,
            ),
            markdown_description: [
              "Requested from the Media Buyer Cockpit.",
              `Client: ${source.clientName}`,
              `Campaign: ${args.campaignName}`,
              `Reason: ${reasonLabel}`,
              args.sourceAdId
                ? `Affected ad: ${source.adName} (${args.sourceAdId})`
                : "Campaign request: no specific ad selected.",
              `Why: ${evidence}`,
              note ? `Buyer note: ${note}` : "",
              `Creative request: ${row.id}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
            tags: source.clientTag ? [source.clientTag] : [],
          },
        }),
      ) as { id?: string; url?: string } | null;
      if (!created?.id)
        throw new Error("ClickUp did not confirm the creative task.");
      return await patch(row.id, {
        script_task_id: created.id,
        script_task_url:
          created.url ?? `https://app.clickup.com/t/${created.id}`,
        last_error: null,
        last_actor: "system",
      });
    } catch (error) {
      await patch(row.id, {
        last_error:
          `ClickUp task not confirmed: ${error instanceof Error ? error.message : String(error)}`.slice(
            0,
            250,
          ),
        last_actor: "system",
      });
      // The row remains visible; a repeated click cannot create a second task.
      throw new Error(
        "The request was saved, but the creative task was not confirmed. Check ClickUp before trying again.",
      );
    }
  },
});

export const userEmail = internalQuery({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const email = user?.email?.trim().toLowerCase();
    if (!email) throw new Error("Sign in first.");
    return email;
  },
});

export const linkLaunch = authenticatedAction({
  args: {
    id: v.string(),
    campaignName: v.string(),
    launchedAdId: v.string(),
    launchedOn: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<RequestRow> => {
    const no = await refusal(ctx, "media_buyer", {
      campaignName: args.campaignName,
    });
    if (no) throw new Error(no);
    const row = await one(args.id);
    if (!row || row.campaign_name !== args.campaignName)
      throw new Error("Creative request not found for this campaign.");
    if (row.launched_meta_ad_id) {
      if (row.launched_meta_ad_id === args.launchedAdId) return row;
      throw new Error(
        "A different launched ad is already linked to this request.",
      );
    }
    if (row.source_meta_ad_id === args.launchedAdId)
      throw new Error("Select the replacement ad, not the original ad.");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(args.launchedOn) ||
      Number.isNaN(Date.parse(`${args.launchedOn}T00:00:00+03:00`)) ||
      kuwaitDay(Date.parse(`${args.launchedOn}T00:00:00+03:00`)) !==
        args.launchedOn ||
      args.launchedOn > kuwaitDay(Date.now()) ||
      (row.created_at &&
        args.launchedOn < kuwaitDay(Date.parse(row.created_at)))
    )
      throw new Error("Choose the day the replacement ad went live.");
    const launch: { adName: string } | null = await ctx.runQuery(
      internal.creativeRequests.launchContext,
      {
        campaignName: args.campaignName,
        adId: args.launchedAdId,
      },
    );
    if (!launch) throw new Error("That ad is not in this campaign.");
    const by: string = await ctx.runQuery(internal.creativeRequests.userEmail, {
      userId: ctx.userId,
    });
    return await patch(row.id, {
      launched_meta_ad_id: args.launchedAdId,
      launched_at: new Date(`${args.launchedOn}T00:00:00+03:00`).toISOString(),
      launch_time_source: "buyer_date",
      status: "launched",
      last_actor: by,
    });
  },
});

export const review = authenticatedAction({
  args: {
    id: v.string(),
    campaignName: v.string(),
    verdict: v.union(
      v.literal("worked"),
      v.literal("needs_another_version"),
      v.literal("stop"),
    ),
    note: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const no = await refusal(ctx, "media_buyer", {
      campaignName: args.campaignName,
    });
    if (no) throw new Error(no);
    const row = await one(args.id);
    if (
      !row ||
      row.campaign_name !== args.campaignName ||
      !row.launched_meta_ad_id ||
      !row.launched_at ||
      !Number.isFinite(Date.parse(row.launched_at))
    )
      throw new Error("Link a launched ad before reviewing this request.");
    if (
      kuwaitDay(Date.now()) <=
      shiftDay(kuwaitDay(Date.parse(row.launched_at)), 3)
    )
      throw new Error(
        "Wait for three complete days after the launch before reviewing it.",
      );
    if (row.verdict) {
      if (row.verdict !== args.verdict)
        throw new Error("This request has already been reviewed.");
      return row.feedback_posted_at ? row : await shareFeedback(ctx, row);
    }
    const by = await ctx.runQuery(internal.creativeRequests.userEmail, {
      userId: ctx.userId,
    });
    const reviewed = await patch(row.id, {
      status: "reviewed",
      verdict: args.verdict,
      verdict_note: args.note?.trim().slice(0, 500) || null,
      reviewed_by: by,
      reviewed_at: new Date().toISOString(),
      last_actor: by,
    });
    return await shareFeedback(ctx, reviewed);
  },
});

export const retryFeedback = authenticatedAction({
  args: { id: v.string(), campaignName: v.string() },
  returns: v.any(),
  handler: async (ctx, { id, campaignName }) => {
    const no = await refusal(ctx, "media_buyer", { campaignName });
    if (no) throw new Error(no);
    const row = await one(id);
    if (!row || row.campaign_name !== campaignName || !row.verdict)
      throw new Error("Reviewed creative request not found.");
    return row.feedback_posted_at ? row : await shareFeedback(ctx, row);
  },
});
