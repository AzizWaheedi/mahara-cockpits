import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { allowedClients } from "./roles";

/**
 * The client database.
 *
 * Aziz, 2026-09-07: the creative director should be able to click a client and
 * see the Brand DNA and Offer Cheat Sheet he already made, everything open for
 * them, and what is live on their ad account right now. Then, when he sits
 * down to script, he should see the ads that actually worked for OTHER clients
 * in the same service line.
 *
 * Two rules run through this whole file:
 *  - the client comes from ClickUp TAGS, never from a guessed title
 *  - the stage shown is the raw ClickUp status, never a derived label
 */

/** Statuses that mean the client is live or about to be. */
const LIVE_STATUSES = new Set([
  "active",
  "launch booked",
  "ready for launch🚀",
  "ready for launch",
  "onboarding booked",
]);

/** Pre-launch: work is owed before the account can go live. */
const PRELAUNCH_STATUSES = new Set([
  "launch booked",
  "ready for launch🚀",
  "ready for launch",
  "onboarding booked",
]);

const DONE = new Set(["complete", "cancelled", "closed", "done", "live 🚀"]);

function isOpen(status: string): boolean {
  return !DONE.has((status || "").toLowerCase());
}

export function isLive(status?: string): boolean {
  return LIVE_STATUSES.has((status || "").toLowerCase());
}

export function isPrelaunch(status?: string): boolean {
  return PRELAUNCH_STATUSES.has((status || "").toLowerCase());
}

/**
 * Normalise a name without destroying Arabic.
 *
 * Stripping to [a-z0-9] flattens every Arabic client name to an empty string,
 * and empty strings match each other, which silently attributed Arabic
 * campaigns to the wrong client. Keep letters and digits in any script.
 * [2026-09-07]
 */
function norm(x?: string): string {
  return (x || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The roster, with the counts he actually acts on.
 *
 * Pre-launch clients are surfaced first because they are the ones waiting on
 * him: every one of them already has a Brand DNA doc and an Offer Cheat Sheet,
 * so his next move is scripts and creative, not discovery.
 */
export const roster = query({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    // Client access set in the portal: an empty list means every client.
    const scope = await allowedClients(ctx).catch(() => null);
    const clients = (await ctx.db.query("clients").collect()).filter(
      c => !scope || scope.has(String(c.name).toLowerCase()),
    );
    const tasks = await ctx.db.query("creativeTasks").collect();
    const videos = await ctx.db.query("videoJobs").collect();
    const campaigns = await ctx.db.query("campaigns").collect();

    const openTasks = tasks.filter(t => isOpen(t.status));
    const openVideos = videos.filter(t => isOpen(t.status));

    const rows = clients
      .filter(c => isLive(c.clientStatus))
      .map(c => {
        const mine = (t: { clients?: string[]; client?: string }) =>
          (t.clients ?? (t.client ? [t.client] : [])).includes(c.name);
        const scripts = openTasks.filter(t => t.kind === "script" && mine(t));
        const vids = openVideos.filter(mine);
        const camps = campaigns.filter(
          k =>
            norm(k.clientName) === norm(c.name) ||
            c.aliases.some(
              a => a.length > 2 && norm(k.campaignName).includes(a),
            ),
        );
        return {
          taskId: c.taskId,
          name: c.name,
          url: c.url,
          clientStatus: c.clientStatus,
          happiness: c.happiness,
          service: c.service,
          launchDate: c.launchDate,
          prelaunch: isPrelaunch(c.clientStatus),
          docs: {
            brandDna: c.brandDnaDoc,
            offerCheatSheet: c.offerCheatSheet,
            blueprintForm: c.blueprintFormLink,
            drive: c.driveLink ?? c.driveFolder,
            history: c.clientHistoryDoc,
            research: c.marketResearchDoc,
          },
          docsReady: Boolean(c.brandDnaDoc && c.offerCheatSheet),
          openScripts: scripts.length,
          openVideos: vids.length,
          /** Stages where the ball is his, not an editor's. */
          hisMove: vids.filter(x =>
            ["client review", "internal review", "update required"].includes(
              (x.status || "").toLowerCase(),
            ),
          ).length,
          liveCampaigns: camps.length,
        };
      })
      .sort((a, b) => {
        if (a.prelaunch !== b.prelaunch) return a.prelaunch ? -1 : 1;
        return b.openScripts + b.hisMove - (a.openScripts + a.hisMove);
      });

    const toContact = rows.filter(r => r.prelaunch);
    return {
      clients: rows,
      counts: {
        live: rows.length,
        toContact: toContact.length,
        docsMissing: rows.filter(r => !r.docsReady).length,
      },
      toContact: toContact.map(r => r.name),
      syncedAt: clients[0]?.syncedAt ?? null,
    };
  },
});

const DAY = 86_400_000;

/**
 * What this client is owed, and a message he can actually send.
 *
 * The Client Communication SOP sets the floor: at least three touchpoints a
 * week in the client's WhatsApp group, small wins included, and a call rather
 * than a text when there is a real concern. It has no creative director script
 * block written yet, so these drafts follow the SOP's rules and tone instead of
 * inventing a template that does not exist. Arabic and English, no em dashes,
 * because most of these groups run in Arabic. [sop, 2026-09-07]
 */
function touchpoint(
  client: { name: string; clientStatus?: string; launchDate?: number | null },
  // biome-ignore lint/suspicious/noExplicitAny: table rows
  tasks: any[],
  // biome-ignore lint/suspicious/noExplicitAny: table rows
  videos: any[],
  // biome-ignore lint/suspicious/noExplicitAny: table rows
  touches: any[],
) {
  const now = Date.now();
  const last = touches[0]?.at ?? null;
  const daysSince = last ? Math.floor((now - last) / DAY) : null;
  const thisWeek = touches.filter(t => now - t.at < 7 * DAY).length;

  const waiting = videos.filter(v2 =>
    ["client review", "update required"].includes(
      (v2.status || "").toLowerCase(),
    ),
  );
  const inProduction = videos.filter(v2 =>
    ["planning", "in progress", "internal review"].includes(
      (v2.status || "").toLowerCase(),
    ),
  );
  const openScripts = tasks.filter(
    t => t.kind === "script" && isOpen(t.status),
  );

  const reasons: string[] = [];
  if (waiting.length) {
    reasons.push(
      `${waiting.length} video${waiting.length > 1 ? "s" : ""} sitting in client review, their approval is the blocker`,
    );
  }
  if (isPrelaunch(client.clientStatus)) {
    reasons.push(
      `Pre-launch (${client.clientStatus}), they need to know what is being built this week`,
    );
  }
  if (inProduction.length) {
    reasons.push(`${inProduction.length} in production, worth a progress note`);
  }
  if (thisWeek < 3) {
    reasons.push(
      `${thisWeek} of 3 touchpoints this week, the SOP floor is 3 in the group`,
    );
  }

  const first = client.name.split(" ")[0];
  const drafts: { label: string; en: string; ar: string }[] = [];

  if (waiting.length) {
    const names = waiting.map(v2 => v2.name).join(", ");
    drafts.push({
      label: "Chase an approval",
      en: `Hi ${first}, the cut is with you for review (${names}). Have a look when you get a minute and tell me what you want changed, no detail is too small. Once you approve it we can get it live.`,
      ar: `هلا ${first}، النسخة عندك للمراجعة (${names}). شوفها لما يناسبك وقول لي شنو تبي نعدل، ولا تستحي بأي تفصيلة صغيرة. أول ما توافق عليها ننزلها ونشغلها.`,
    });
  }
  if (inProduction.length) {
    drafts.push({
      label: "Progress note (a cookie)",
      en: `Hi ${first}, quick update from our side. We are ${inProduction.length > 1 ? "working on" : "working on"} ${inProduction.length} new piece${inProduction.length > 1 ? "s" : ""} for you this week, built off the offer and the angles we agreed in your brand session. I will send the first one over for your eyes before anything goes live.`,
      ar: `هلا ${first}، تحديث سريع من عندنا. نشتغل هالأسبوع على ${inProduction.length} مادة جديدة لك، مبنية على العرض والزوايا اللي اتفقنا عليها في جلسة الهوية. أول ما تخلص أول واحدة أرسلها لك تشوفها قبل ما ننزل أي شي.`,
    });
  }
  if (isPrelaunch(client.clientStatus)) {
    drafts.push({
      label: "Pre-launch check-in",
      en: `Hi ${first}, your brand direction and offer are locked in on our side. We are producing the first set of ads now. If you have any recent project photos or site videos, send them into the group, real footage from your own projects always outperforms anything else.`,
      ar: `هلا ${first}، اتجاه الهوية والعرض مثبتين عندنا. الحين نجهز أول مجموعة إعلانات. إذا عندك صور أو فيديوهات حديثة من مشاريعك، أرسلها في القروب، المواد الحقيقية من مشاريعك دايم تجيب نتيجة أقوى من أي شي غيرها.`,
    });
  }
  if (openScripts.length) {
    drafts.push({
      label: "Ask for the input a script needs",
      en: `Hi ${first}, I am writing the next script for you. One question so it lands right: which project are you most proud of finishing recently, and what did the client say when you handed it over? I want to build the ad around that.`,
      ar: `هلا ${first}، أكتب لك السكربت الجاي. سؤال واحد بس عشان يطلع صح: شنو أكثر مشروع تفتخر فيه خلصتوه مؤخراً، وشنو قال العميل يوم استلمه؟ أبي أبني الإعلان على هالشي.`,
    });
  }

  return {
    lastTouchAt: last,
    daysSince,
    thisWeek,
    owed: reasons.length > 0 && (thisWeek < 3 || waiting.length > 0),
    reasons,
    drafts,
  };
}

/** Everything about one client, on one screen. */
export const detail = query({
  args: { name: v.string() },
  returns: v.any(),
  handler: async (ctx, { name }) => {
    const client = (await ctx.db.query("clients").collect()).find(
      c => c.name === name || norm(c.name) === norm(name),
    );
    if (!client) return null;

    const mine = (t: { clients?: string[]; client?: string }) =>
      (t.clients ?? (t.client ? [t.client] : [])).some(
        n => norm(n) === norm(client.name),
      );

    const tasks = (await ctx.db.query("creativeTasks").collect()).filter(mine);
    const videos = (await ctx.db.query("videoJobs").collect()).filter(mine);
    const posts = (await ctx.db.query("contentPosts").collect()).filter(mine);

    const touches = (await ctx.db.query("touchLog").collect())
      .filter(t => norm(t.client) === norm(client.name))
      .sort((a, b) => b.at - a.at);

    const campaigns = (await ctx.db.query("campaigns").collect()).filter(
      k =>
        norm(k.clientName) === norm(client.name) ||
        client.aliases.some(
          a => a.length > 2 && norm(k.campaignName).includes(a),
        ),
    );
    const campaignNames = new Set(campaigns.map(k => k.campaignName));
    const tree = (await ctx.db.query("metaTree").collect()).filter(n =>
      campaignNames.has(n.campaignName),
    );
    const ads = (await ctx.db.query("ads").collect()).filter(a =>
      campaignNames.has(a.campaignName),
    );

    const liveAds = tree.filter(
      n =>
        n.kind === "ad" &&
        (n.effectiveStatus || n.status || "").toUpperCase() === "ACTIVE",
    );

    return {
      /**
       * This month off their own stat sheet. Aziz, 2026-09-08: cost per lead is
       * not enough, the writing has to be judged against what happens after the
       * lead. Rates are computed here so there is one definition of each:
       * booking rate is appointments against leads Meta reported in 30 days,
       * show rate is shows against appointments, quotation rate is quotations
       * against shows, close rate is closes against quotations.
       */
      stats: (() => {
        const s2 = client.stats;
        if (!s2) return null;
        const leads30 = ads.reduce((n, a) => n + a.leads, 0);
        const pct = (a: number, b: number) =>
          b > 0 ? Math.round((a / b) * 100) : null;
        return {
          month: s2.tab,
          booked: s2.booked,
          shows: s2.shows,
          quotes: s2.quotes,
          closes: s2.closes,
          leads30,
          bookingRate: pct(s2.booked, leads30),
          showRate: pct(s2.shows, s2.booked),
          quotationRate: pct(s2.quotes, s2.shows),
          closeRate: pct(s2.closes, s2.quotes),
          scannedAt: client.statsScannedAt ?? null,
        };
      })(),
      client: {
        name: client.name,
        url: client.url,
        clientStatus: client.clientStatus,
        happiness: client.happiness,
        service: client.service,
        launchDate: client.launchDate,
        phone: client.phone,
        docs: {
          brandDna: client.brandDnaDoc,
          offerCheatSheet: client.offerCheatSheet,
          blueprintForm: client.blueprintFormLink,
          drive: client.driveLink ?? client.driveFolder,
          sheet: client.sheetLink,
          history: client.clientHistoryDoc,
          research: client.marketResearchDoc,
        },
      },
      // Raw ClickUp status on every row. No derived stages.
      tasks: tasks
        .filter(t => isOpen(t.status))
        .map(t => ({
          taskId: t.taskId,
          name: t.name,
          kind: t.kind,
          status: t.status,
          url: t.url,
          createdAt: t.createdAt,
          dueDate: t.dueDate,
          assignees: t.assignees,
          otherClients: (t.clients ?? []).filter(
            n => norm(n) !== norm(client.name),
          ),
        })),
      videos: videos.map(v2 => ({
        taskId: v2.taskId,
        name: v2.name,
        status: v2.status,
        url: v2.url,
        editors: v2.editors,
        dueDate: v2.dueDate,
        editedLink: v2.editedLink,
        rawLink: v2.rawLink,
        open: isOpen(v2.status),
      })),
      posts: posts.filter(p => isOpen(p.status)).length,
      /** Everything we have ever made for them, closed rows included. */
      allTasks: tasks
        .map(t => ({
          taskId: t.taskId,
          name: t.name,
          kind: t.kind,
          status: t.status,
          url: t.url,
          createdAt: t.createdAt,
          dueDate: t.dueDate,
          assignees: t.assignees,
          open: isOpen(t.status),
        }))
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
      touch: touchpoint(client, tasks, videos, touches),
      /**
       * The service line to read winning ads from. The client board's Service
       * field is a package name ("DFY") on most records, so take the service
       * their own campaigns are tagged with and fall back to the field.
       */
      serviceLine:
        campaigns.map(k => k.serviceType).find(Boolean) ??
        client.service ??
        null,
      campaigns: campaigns.map(k => ({
        campaignName: k.campaignName,
        serviceType: k.serviceType,
        spend7d: k.spend7d,
        leads7d: k.leads7d,
        bookings7d: k.bookings7d,
        costPerBooking: k.costPerBooking,
        boardAdStatus: k.boardAdStatus,
      })),
      /** What is running right now, and what has run before. */
      liveNow: liveAds.map(n => ({
        metaId: n.metaId,
        name: n.name,
        campaignName: n.campaignName,
        previewSrc: n.previewSrc,
        thumbUrl: n.thumbUrl,
      })),
      history: ads
        .map(a => ({
          adName: a.adName,
          campaignName: a.campaignName,
          spend: a.spend,
          leads: a.leads,
          cpl: a.cpl,
          ctr: a.ctr,
          thumbnailUrl: a.thumbnailUrl,
          previewSrc: a.previewSrc,
        }))
        .sort((a, b) => b.spend - a.spend),
    };
  },
});

/**
 * The scripting database: what worked for OTHER clients in the same service.
 *
 * Ranked on cost per booked call where the campaign has it, because that is the
 * only number Aziz judges paid media on. CPL is shown but never sorted on.
 */
export const winners = query({
  args: {
    service: v.optional(v.string()),
    excludeClient: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { service, excludeClient }) => {
    const campaigns = await ctx.db.query("campaigns").collect();
    const ads = await ctx.db.query("ads").collect();

    const wanted = campaigns.filter(k => {
      if (service && norm(k.serviceType) !== norm(service)) return false;
      if (excludeClient && norm(k.clientName) === norm(excludeClient))
        return false;
      return true;
    });
    const byCampaign = new Map(wanted.map(k => [k.campaignName, k]));

    const rows = ads
      .filter(a => byCampaign.has(a.campaignName) && a.spend >= 50)
      .map(a => {
        const k = byCampaign.get(a.campaignName)!;
        return {
          adName: a.adName,
          campaignName: a.campaignName,
          client: k.clientName,
          serviceType: k.serviceType,
          spend: a.spend,
          leads: a.leads,
          cpl: a.cpl,
          ctr: a.ctr,
          costPerBooking: k.costPerBooking,
          thumbnailUrl: a.thumbnailUrl,
          previewSrc: a.previewSrc,
          metaAdId: a.metaAdId,
        };
      })
      .sort((a, b) => {
        const ax = a.costPerBooking ?? Number.POSITIVE_INFINITY;
        const bx = b.costPerBooking ?? Number.POSITIVE_INFINITY;
        if (ax !== bx) return ax - bx;
        return (a.cpl ?? 1e9) - (b.cpl ?? 1e9);
      });

    const services = Array.from(
      new Set(campaigns.map(k => k.serviceType).filter(Boolean) as string[]),
    ).sort();

    return { rows, services };
  },
});

/**
 * Write-back, via an outbox.
 *
 * This deployment holds no ClickUp credentials on purpose, so nothing here
 * touches ClickUp directly. He queues an intent, the sandbox bridge drains it
 * on the next sync and reports back. Worst case an action is late, never
 * silently lost.
 */
export const queueAction = mutation({
  args: {
    kind: v.string(),
    taskId: v.optional(v.string()),
    payload: v.any(),
  },
  returns: v.id("creativeOutbox"),
  handler: async (ctx, { kind, taskId, payload }) => {
    if (
      ![
        "comment",
        "complete",
        "videoRequest",
        // Planning: put a dated script request on the creative board, or move
        // an existing card to another day. [aziz, 2026-09-08]
        "planScript",
        "schedule",
      ].includes(kind)
    ) {
      throw new Error(`unsupported outbox action: ${kind}`);
    }
    return await ctx.db.insert("creativeOutbox", {
      kind,
      taskId,
      payload,
      state: "pending",
      createdAt: Date.now(),
    });
  },
});

/**
 * What the sync already knows about each client's Drive folder.
 *
 * Listing 35 Drive folders on every 15 minute run is wasteful and slow, so the
 * bridge reads this first and only rescans a folder that is new or stale.
 */
export const driveCache = query({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    (await ctx.db.query("clients").collect()).map(c => ({
      name: c.name,
      driveFolderId: c.driveFolderId ?? null,
      driveSubfolders: c.driveSubfolders ?? [],
      driveScannedAt: c.driveScannedAt ?? null,
    })),
});

export const outbox = query({
  args: {},
  returns: v.any(),
  handler: async ctx =>
    (await ctx.db.query("creativeOutbox").collect())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 40),
});

/** Drained by the sandbox bridge on each sync. */
export const outboxPending = query({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const rows = await ctx.db
      .query("creativeOutbox")
      .withIndex("by_state", q => q.eq("state", "pending"))
      .collect();
    return rows.map(r => ({
      id: r._id,
      kind: r.kind,
      taskId: r.taskId,
      payload: r.payload,
    }));
  },
});

export const outboxSettle = mutation({
  args: {
    id: v.id("creativeOutbox"),
    ok: v.boolean(),
    result: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ok, result }) => {
    await ctx.db.patch(id, {
      state: ok ? "done" : "failed",
      result,
      settledAt: Date.now(),
    });
    return null;
  },
});

/* ---------------------------------------------------------------------------
 * Extract client context
 *
 * Aziz, 2026-09-08: one download per client holding everything we have on them,
 * so scripting starts with full context, and handing the client to another LLM
 * does not mean re-explaining who they are.
 *
 * It is a plain markdown pack: identity and contact, their docs, their funnel
 * and its questions, their performance, every ad they have run with the copy and
 * transcript where we captured it, the targeting plays that worked, and the full
 * creative history off the board.
 *
 * Docs live in Google Docs and Drive, which this deployment cannot read, so the
 * pack carries the links and says so rather than pretending to include the text.
 * ------------------------------------------------------------------------ */

function money(n?: number | null): string {
  return n === null || n === undefined
    ? "n/a"
    : `$${Math.round(n).toLocaleString()}`;
}

function dt(ts?: number | null): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "no date";
}

export const contextPack = query({
  args: { name: v.string() },
  returns: v.any(),
  handler: async (ctx, { name }) => {
    const client = (await ctx.db.query("clients").collect()).find(
      c => c.name === name || norm(c.name) === norm(name),
    );
    if (!client) return null;

    const mine = (t: { clients?: string[]; client?: string }) =>
      (t.clients ?? (t.client ? [t.client] : [])).some(
        n => norm(n) === norm(client.name),
      );

    const tasks = (await ctx.db.query("creativeTasks").collect()).filter(mine);
    const videos = (await ctx.db.query("videoJobs").collect()).filter(mine);
    const campaigns = (await ctx.db.query("campaigns").collect()).filter(
      k =>
        norm(k.clientName) === norm(client.name) ||
        client.aliases.some(
          a => a.length > 2 && norm(k.campaignName).includes(a),
        ),
    );
    const campaignNames = new Set(campaigns.map(k => k.campaignName));
    const ads = (await ctx.db.query("ads").collect())
      .filter(a => campaignNames.has(a.campaignName))
      .sort((a, b) => b.spend - a.spend);
    const tree = (await ctx.db.query("metaTree").collect()).filter(n =>
      campaignNames.has(n.campaignName),
    );
    const winners = (await ctx.db.query("winnersArchive").collect()).filter(
      w => norm(w.client) === norm(client.name),
    );
    const plays = (await ctx.db.query("marketPlays").collect())
      .filter(p => norm(p.client) === norm(client.name))
      .sort((a, b) => (a.cpl ?? 1e9) - (b.cpl ?? 1e9));
    const accountNames = new Set(campaigns.map(k => norm(k.accountName)));
    const funnels = (await ctx.db.query("funnels").collect()).filter(f =>
      accountNames.has(norm(f.account)),
    );
    const touches = (await ctx.db.query("touchLog").collect())
      .filter(t => norm(t.client) === norm(client.name))
      .sort((a, b) => b.at - a.at)
      .slice(0, 15);

    const serviceLine =
      campaigns.map(k => k.serviceType).find(Boolean) ?? client.service ?? null;
    const city =
      plays.map(p => p.city).find(Boolean) ??
      winners.map(w => w.city).find(Boolean) ??
      null;
    const country = plays.map(p => p.country).find(Boolean) ?? null;

    const L: string[] = [];
    const h = (t: string) => L.push("", `## ${t}`, "");
    const line = (k: string, v2?: string | number | null) =>
      L.push(
        `- ${k}: ${v2 === null || v2 === undefined || v2 === "" ? "not on file" : v2}`,
      );

    L.push(`# ${client.name}, full client context`);
    L.push("");
    L.push(
      `Pulled from the creative cockpit on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Every number here comes from ClickUp and Meta, nothing is estimated.`,
    );

    h("Who they are");
    line("Client status (verbatim from ClickUp)", client.clientStatus);
    line("Service line", serviceLine);
    line("Package on the client board", client.service);
    line("Launch date", client.launchDate ? dt(client.launchDate) : null);
    line("Phone", client.phone);
    line("City", city);
    line("Country", country);
    line("Happiness", client.happiness);
    line("Client board record", client.url);

    h("Their documents");
    L.push(
      "These are links. The text lives in Google Docs and Drive, so open them for the actual content.",
      "",
    );
    line("Brand DNA", client.brandDnaDoc);
    line("Offer cheat sheet", client.offerCheatSheet);
    line("Brand blueprint form", client.blueprintFormLink);
    line("Market research", client.marketResearchDoc);
    line("Client history", client.clientHistoryDoc);
    line("Drive folder", client.driveLink ?? client.driveFolder);
    line("Scripts folder", client.driveScripts);
    line("Footage folder", client.driveFootage);
    line("Reporting sheet", client.sheetLink);

    h("Their funnel and lead form");
    if (funnels.length === 0) {
      L.push("No funnel or lead form found on their ad account.");
    }
    for (const f of funnels) {
      L.push(`### ${f.formName || f.url || f.kind}`);
      line("Type", f.kind);
      line("Destination", f.url);
      line("Headline", f.headline);
      line("30 day spend", money(f.spend));
      line("30 day leads", f.leads);
      line("Cost per lead", money(f.cpl));
      if (f.questions.length) {
        L.push("", "Questions asked, in order:");
        f.questions.forEach((q, i) =>
          L.push(
            `${i + 1}. ${q.label}${q.isGate ? " (filters lead quality)" : ""}${
              q.options.length ? ` — options: ${q.options.join(" / ")}` : ""
            }`,
          ),
        );
      } else {
        L.push("", "This form asks nothing that filters lead quality.");
      }
      L.push("");
    }

    h("Their performance");
    if (campaigns.length === 0) L.push("No campaigns matched to them.");
    for (const k of campaigns) {
      L.push(`### ${k.campaignName}`);
      line("Service", k.serviceType);
      line("7 day spend", money(k.spend7d));
      line("7 day leads", k.leads7d);
      line("7 day booked calls", k.bookings7d);
      line("Cost per booked call", money(k.costPerBooking));
      line("Status on the ads board", k.boardAdStatus);
      L.push("");
    }

    h("Every ad they have run");
    L.push(
      "Sorted by spend. Cost per lead is what Meta reports, it says nothing about whether the lead was qualified.",
      "",
    );
    const liveIds = new Set(
      tree
        .filter(
          n =>
            n.kind === "ad" &&
            (n.effectiveStatus || n.status || "").toUpperCase() === "ACTIVE",
        )
        .map(n => n.name),
    );
    for (const a of ads) {
      L.push(
        `- ${liveIds.has(a.adName) ? "LIVE NOW" : "not live"} · ${a.adName} · ${a.campaignName} · spend ${money(a.spend)} · ${a.leads} leads · CPL ${money(a.cpl)} · CTR ${a.ctr ? `${a.ctr.toFixed(2)}%` : "n/a"}${a.previewSrc ? ` · preview ${a.previewSrc}` : ""}`,
      );
    }
    if (ads.length === 0) L.push("Nothing on file.");

    h("The copy and transcripts we captured");
    if (winners.length === 0) {
      L.push(
        "No ad of theirs has been captured into the winners archive yet, so we hold no transcript for them.",
      );
    }
    for (const w of winners) {
      L.push(`### ${w.adName}`);
      line("Format", w.format);
      line("Language", w.language);
      line("Hook", w.hook);
      line("Headline", w.headline);
      line("Call to action", w.cta);
      line("Spend", money(w.spend));
      line("Leads", w.leads);
      line("Cost per lead", money(w.cpl));
      line("Still live", w.stillLive ? "yes" : "no");
      if (w.body) L.push("", "Body copy:", "", w.body);
      if (w.transcript) L.push("", "Transcript:", "", w.transcript);
      L.push("");
    }

    h("The targeting that worked for them");
    if (plays.length === 0) L.push("No ad sets on file.");
    for (const p of plays.slice(0, 20)) {
      L.push(
        `- ${p.adsetName} · ${p.playType} · ${p.city ?? "no city"} · spend ${money(p.spend)} · ${p.leads} leads · CPL ${money(p.cpl)}${p.interests.length ? ` · interests: ${p.interests.join(", ")}` : ""}`,
      );
    }

    h("Everything we have made for them");
    const all = [...tasks]
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .map(
        t =>
          `- [${t.kind}] ${t.name} · status ${t.status} · created ${dt(t.createdAt)} · due ${dt(t.dueDate)}${t.url ? ` · ${t.url}` : ""}`,
      );
    L.push(...(all.length ? all : ["Nothing on the creative board."]));
    L.push("", "Videos:", "");
    const vids = videos
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .map(
        v2 =>
          `- ${v2.name} · status ${v2.status} · due ${dt(v2.dueDate)}${v2.editedLink ? ` · edited ${v2.editedLink}` : ""}${v2.rawLink ? ` · raw ${v2.rawLink}` : ""}`,
      );
    L.push(...(vids.length ? vids : ["Nothing in the video pipeline."]));

    h("Recent contact with them");
    if (touches.length === 0) L.push("No touchpoints logged yet.");
    for (const t of touches) {
      L.push(`- ${dt(t.at)} · ${t.note ?? "touchpoint logged"}`);
    }

    return {
      client: client.name,
      markdown: L.join("\n"),
      counts: {
        ads: ads.length,
        campaigns: campaigns.length,
        transcripts: winners.filter(w => w.transcript).length,
        tasks: tasks.length,
        videos: videos.length,
        funnels: funnels.length,
        plays: plays.length,
      },
    };
  },
});

/** What the sync already holds, so stat sheets are re-read every couple of
 *  hours instead of every 15 minutes. */
export const statCache = query({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const out: Record<string, unknown> = {};
    for (const c of await ctx.db.query("clients").collect()) {
      if (c.stats || c.statsScannedAt) {
        out[c.name] = { stats: c.stats, statsScannedAt: c.statsScannedAt };
      }
    }
    return out;
  },
});
