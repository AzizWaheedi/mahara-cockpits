/** Original read calculations; inputs are exclusively server-scoped verified snapshots. */
import {
  compareChange,
  kuwaitDay,
  shiftDay,
  windowResult,
} from "./changeResultsCore";

const CPL_GATE = 15,
  MIN_SPEND = 100;
const MEANINGFUL =
  /budget|targeting|bid strategy|optimisation goal|optimization goal|created|ad updated|campaign status updated|ad set status updated/i;
const HOUSEKEEPING =
  /name updated|finishes ad review|billed|delivered|balance/i;
type QueryCtx = any;
function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
export async function buildSnapshot(
  ctx: QueryCtx,
  smoke: boolean,
): Promise<any> {
  void smoke;
  // Client access set in the portal: an empty list means every client.
  const scope = null as Set<string> | null;
  const day = kuwaitToday();
  const campaigns = (
    await ctx.db.query("campaigns").withIndex("by_rank").collect()
  ).filter(
    (c: any) =>
      !scope ||
      scope.has(String(c.clientName ?? c.accountName ?? "").toLowerCase()),
  );
  // The same access trims everything keyed by campaign, otherwise a member
  // limited to one client still gets every other client's ads, previews and
  // change log in the payload.
  const names = new Set(campaigns.map((c: any) => c.campaignName));
  const mine = (row: { campaignName: string }) =>
    !scope || names.has(row.campaignName);
  const ads = (await ctx.db.query("ads").collect()).filter(mine);
  const metaTree = (await ctx.db.query("metaTree").collect()).filter(mine);
  const adChanges = (await ctx.db.query("adChanges").collect()).filter(mine);
  const checks = await ctx.db
    .query("checks")
    .withIndex("by_role_day", (q: any) =>
      q.eq("role", "media_buyer").eq("day", day),
    )
    .collect();
  const decisions = (
    await ctx.db
      .query("decisions")
      .withIndex("by_day", (q: any) => q.eq("day", day))
      .collect()
  ).filter(
    (d: any) =>
      !scope || names.has(d.subject) || scope.has(d.subject.toLowerCase()),
  );
  const plan = await ctx.db
    .query("planItems")
    .withIndex("by_role_day", (q: any) =>
      q.eq("role", "media_buyer").eq("day", day),
    )
    .collect();
  const inbox = await ctx.db.query("inbox").collect();
  const clientLinks = await ctx.db.query("clientLinks").collect();
  // What the latest client card comments said (commentWatch), newest first.
  const clientUpdates = (
    await ctx.db
      .query("clientComments")
      .withIndex("by_status", (q: any) =>
        q.eq("status", "done").gte("at", Date.now() - 45 * 86400000),
      )
      .collect()
  )
    .filter((r: any) => !scope || scope.has(r.clientName.toLowerCase()))
    .sort((a: any, b: any) => b.at - a.at)
    // The media buyer sees only what changes the campaigns: no summary, no
    // contract, payment or revenue lines. [Aziz, 2026-09-14]
    .map((r: any) => ({
      taskId: r.taskId,
      clientName: r.clientName,
      at: r.at,
      kind: r.kind,
      forAds: (Array.isArray(r.digest?.forAds) ? r.digest.forAds : [])
        .map(String)
        .filter(
          (x: string) =>
            !/contract|payment|paid|deposit|invoice|revenue|signed|\bfees?\b/i.test(
              x,
            ),
        ),
    }))
    .filter((u: any) => u.forAds.length);
  const boardCards = (await ctx.db.query("boardCards").collect()).filter(
    (c: any) => !scope || scope.has(String(c.tag ?? "").toLowerCase()),
  );
  const offBoardCampaigns = (
    await ctx.db.query("offBoardCampaigns").collect()
  ).filter(
    (c: any) =>
      !scope || scope.has(String(c.clientName ?? c.accountName).toLowerCase()),
  );
  const manualChanges = (await ctx.db.query("manualChanges").collect()).filter(
    mine,
  );
  const members = await ctx.db.query("clickupMembers").collect();
  const prefs = await ctx.db.query("clientPrefs").collect();
  const eod = await ctx.db
    .query("eodReports")
    .withIndex("by_role_day", (q: any) =>
      q.eq("role", "media_buyer").eq("day", day),
    )
    .first();
  const lastRun = await ctx.db
    .query("syncRuns")
    .withIndex("by_at")
    .order("desc")
    .first();
  const spend7d = campaigns.reduce((s: any, c: any) => s + c.spend7d, 0);
  const leads7d = campaigns.reduce((s: any, c: any) => s + c.leads7d, 0);
  const clientCampaigns = campaigns.filter((c: any) => !c.internal);
  const clientSpend = clientCampaigns.reduce(
    (s: any, c: any) => s + c.spend7d,
    0,
  );
  const clientLeads = clientCampaigns.reduce(
    (s: any, c: any) => s + c.leads7d,
    0,
  );
  return {
    day,
    campaigns,
    ads,
    metaTree,
    adChanges,
    manualChanges,
    offBoardCampaigns,
    clientLinks,
    clientUpdates,
    boardCards,
    members,
    inbox,
    prefs,
    eod,
    checks: checks.sort((a: any, b: any) => (a.order ?? 99) - (b.order ?? 99)),
    feedback: await ctx.db
      .query("feedback")
      .withIndex("by_role", (q: any) => q.eq("role", "media_buyer"))
      .order("desc")
      .take(20),
    decisions,
    plan,
    lastSyncAt: lastRun?.at ?? null,
    syncProblems: lastRun?.problems ?? [],
    syncHealth: lastRun?.health ?? null,
    totals: {
      spend7d,
      leads7d,
      clientSpend,
      clientLeads,
      blendedCpl: clientLeads > 0 ? clientSpend / clientLeads : null,
      overGate: clientCampaigns.filter(
        (c: any) => c.cpl !== undefined && c.cpl > CPL_GATE,
      ).length,
      underFloor: clientCampaigns.filter(
        (c: any) => c.dayRate < 30 && c.spend7d > 0,
      ).length,
      offBoard: clientCampaigns.filter((c: any) => !c.onBoard).length,
    },
  };
}
export const buildOnboardings = async (ctx: any) => {
  const visible = (_row: any) => true;
  // Steps that are ad-account work Viktor can genuinely execute. Anything
  // involving access, billing or a human decision stays hers.
  const CAN_DO = [
    "create leads campaign",
    "create ad set",
    "build ads",
    "create lead form",
    "select the correct lead form",
    "add url parameters",
    "duplicate ads",
  ];
  const rows = (await ctx.db.query("onboardings").collect()).filter((r: any) =>
    visible({ clientName: r.client }),
  );
  return rows.map((r: any) => {
    let done = 0;
    let total = 0;
    const groups = r.groups.map((g: any) => ({
      name: g.name,
      items: g.items.map((i: any) => {
        total++;
        if (i.done) done++;
        const low = i.name.toLowerCase();
        return {
          name: i.name,
          done: i.done,
          viktorCanDo: CAN_DO.some((c: any) => low.includes(c)),
        };
      }),
    }));
    return {
      taskId: r.taskId,
      taskUrl: r.taskUrl,
      client: r.client,
      status: r.status,
      accountId: r.accountId,
      accountName: r.accountName,
      accountIdSource: r.accountIdSource,
      done,
      total,
      groups,
    };
  });
};
export const buildLaunchWatch = async (ctx: any) => {
  const visible = (_row: any) => true;
  const rows = (await ctx.db.query("launchWatch").collect()).filter((r: any) =>
    visible({ clientName: r.client }),
  );
  return rows.sort(
    (a: any, b: any) =>
      b.issues.length - a.issues.length || a.client.localeCompare(b.client),
  );
};
export const buildTrackingIssues = async (ctx: any) => {
  const visible = (_row: any) => true;
  const all = await ctx.db.query("trackingIssues").collect();
  const byClient = new Map<
    string,
    {
      adName: string;
      issue: string;
    }[]
  >();
  for (const r of all) {
    if (!visible({ clientName: r.client })) continue;
    const list = byClient.get(r.client) ?? [];
    list.push({ adName: r.adName, issue: r.issue });
    byClient.set(r.client, list);
  }
  return [...byClient]
    .map(([client, ads]: any) => ({ client, count: ads.length, ads }))
    .sort((a: any, b: any) => b.count - a.count);
};
export const buildMarketForClient = async (ctx: any, { client }: any) => {
  const all = await ctx.db.query("marketPlays").collect();
  const mine = all.filter((p: any) => p.client === client);
  const city = mine[0]?.city ?? undefined;
  const serviceLine = mine[0]?.serviceLine ?? undefined;
  if (!serviceLine) return { city, serviceLine, running: [], suggestions: [] };
  // What this client already runs, so we never suggest their own setup back.
  const running = [
    ...new Set(
      mine.map((p: any) =>
        p.interests.length ? p.interests.sort().join("|") : p.playType,
      ),
    ),
  ];
  const groups = new Map<
    string,
    {
      city: string;
      playType: string;
      interests: string[];
      spend: number;
      leads: number;
      clients: Set<string>;
    }
  >();
  for (const p of all) {
    if (p.serviceLine !== serviceLine) continue;
    if (p.client === client) continue;
    const stack = [...p.interests].sort();
    const sig = stack.length ? stack.join("|") : p.playType;
    if (running.includes(sig)) continue;
    const key = `${p.city}::${p.playType}::${sig}`;
    const g = groups.get(key) ?? {
      city: p.city ?? "Unknown",
      playType: p.playType,
      interests: stack,
      spend: 0,
      leads: 0,
      clients: new Set<string>(),
    };
    g.spend += p.spend;
    g.leads += p.leads;
    g.clients.add(p.client);
    groups.set(key, g);
  }
  const suggestions = [...groups.values()]
    .filter((g: any) => g.spend >= MIN_SPEND && g.leads > 0)
    .map((g: any) => ({
      city: g.city,
      playType: g.playType,
      interests: g.interests,
      cpl: Number((g.spend / g.leads).toFixed(2)),
      clients: g.clients.size,
    }))
    .filter((g: any) => g.cpl <= CPL_GATE)
    .sort((a: any, b: any) => a.cpl - b.cpl)
    .slice(0, 3);
  return { city, serviceLine, running, suggestions };
};
export const buildChangeResults = async (ctx: any, { campaignName }: any) => {
  const cutoff =
    Date.parse(`${shiftDay(kuwaitDay(Date.now()), -14)}T00:00:00Z`) -
    3 * 3600000;
  const [meta, manual, daily, bookings] = await Promise.all([
    ctx.db
      .query("adChanges")
      .withIndex("by_campaign", (q: any) => q.eq("campaignName", campaignName))
      .collect(),
    ctx.db
      .query("manualChanges")
      .withIndex("by_campaign", (q: any) => q.eq("campaignName", campaignName))
      .collect(),
    ctx.db
      .query("dailyStats")
      .withIndex("by_campaign_date", (q: any) =>
        q
          .eq("campaignName", campaignName)
          .gte("date", shiftDay(kuwaitDay(Date.now()), -18)),
      )
      .collect(),
    ctx.db
      .query("bookingEvents")
      .withIndex("by_campaign_date", (q: any) =>
        q
          .eq("campaignName", campaignName)
          .gte("date", shiftDay(kuwaitDay(Date.now()), -18)),
      )
      .collect(),
  ]);
  const changes = [
    ...meta
      .filter(
        (row: any) =>
          row.at >= cutoff &&
          row.actor &&
          row.actor !== "Meta" &&
          MEANINGFUL.test(row.eventType) &&
          !HOUSEKEEPING.test(row.eventType),
      )
      .map((row: any) => ({
        id: `meta:${row.activityHash ?? row._id}`,
        source: "Meta" as const,
        at: row.at,
        actor: row.actor ?? "Unknown",
        label: row.objectName
          ? `${row.eventType} · ${row.objectName}`
          : row.eventType,
      })),
    ...manual
      .filter((row: any) => row.at >= cutoff)
      .map((row: any) => ({
        id: `manual:${row._id}`,
        source: "Buyer note" as const,
        at: row.at,
        actor: row.by,
        label: row.adName ? `${row.what} · ${row.adName}` : row.what,
      })),
  ].sort((a: any, b: any) => b.at - a.at);
  const at = changes.map((row: any) => ({ id: row.id, at: row.at }));
  return {
    changes: changes.slice(0, 15).map((row: any) => ({
      ...row,
      result: compareChange(row, at, daily, bookings, Date.now()),
    })),
    periodDays: 14,
    source:
      "Meta activity and buyer notes; spend and leads from the daily ad feed; matched bookings from GHL.",
  };
};
export const buildCreativeLaunchResult = async (ctx: any, args: any) => {
  if (
    !Number.isFinite(args.launchedAt) ||
    args.launchedAt > Date.now() + 86400000
  )
    throw new Error("The launch date is invalid.");
  const day = kuwaitDay(args.launchedAt);
  const from = shiftDay(day, -3);
  const to = shiftDay(day, 3);
  const [daily, bookings, meta, manual] = await Promise.all([
    ctx.db
      .query("dailyStats")
      .withIndex("by_campaign_date", (q: any) =>
        q
          .eq("campaignName", args.campaignName)
          .gte("date", from)
          .lte("date", to),
      )
      .collect(),
    ctx.db
      .query("bookingEvents")
      .withIndex("by_campaign_date", (q: any) =>
        q
          .eq("campaignName", args.campaignName)
          .gte("date", from)
          .lte("date", to),
      )
      .collect(),
    ctx.db
      .query("adChanges")
      .withIndex("by_campaign", (q: any) =>
        q.eq("campaignName", args.campaignName),
      )
      .collect(),
    ctx.db
      .query("manualChanges")
      .withIndex("by_campaign", (q: any) =>
        q.eq("campaignName", args.campaignName),
      )
      .collect(),
  ]);
  const otherChanges = [
    ...meta
      .filter(
        (row: any) =>
          row.objectId !== args.launchedAdId &&
          row.actor &&
          row.actor !== "Meta" &&
          MEANINGFUL.test(row.eventType) &&
          !HOUSEKEEPING.test(row.eventType),
      )
      .map((row: any) => ({ id: `meta:${row._id}`, at: row.at })),
    ...manual.map((row: any) => ({ id: `manual:${row._id}`, at: row.at })),
  ];
  const campaign = compareChange(
    { id: "creative-launch", at: args.launchedAt },
    otherChanges,
    daily,
    bookings,
    Date.now(),
  );
  return {
    campaign,
    sourceBefore: args.sourceAdId
      ? windowResult(
          campaign.before.from,
          campaign.before.to,
          daily.filter((row: any) => row.metaAdId === args.sourceAdId),
          bookings.filter((row: any) => row.adId === args.sourceAdId),
        )
      : null,
    replacementAfter: windowResult(
      campaign.after.from,
      campaign.after.to,
      daily.filter((row: any) => row.metaAdId === args.launchedAdId),
      bookings.filter((row: any) => row.adId === args.launchedAdId),
    ),
  };
};
