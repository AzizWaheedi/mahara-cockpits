import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import {
  allowedClients,
  assertRole,
  inScope,
  rowInScope,
  userEmail,
} from "./roles";

/**
 * The creative director's cockpit.
 *
 * Same philosophy as the media buyer's screen: this is not a task list with a
 * nicer font. It answers "what is actually stuck, and what is about to hurt a
 * client" — and it is honest about the places where the board itself cannot
 * answer that because the data was never entered.
 */

const DAY = 86_400_000;

/** How long a script request can sit before it is a problem, in days. */
const SCRIPT_STALE_DAYS = 3;
/** Exposure level that prompts a performance review, never a verdict. */
const FATIGUE_FREQUENCY = 2.5;
/** A winning ad worth cloning for other clients. */
const WINNER_CPL = 15;
const WINNER_MIN_SPEND = 100;

/** Kuwait is GMT+3 and has no DST, so the working day is a fixed offset. */
const KUWAIT_OFFSET = 3 * 3600_000;

export function dayKey(now: number): string {
  return new Date(now + KUWAIT_OFFSET).toISOString().slice(0, 10);
}

/**
 * The fixed shape of his day. Same order as the media buyer's: clear
 * communication first so nobody is blocked waiting on him, then produce.
 */
const CHECKLIST: {
  key: string;
  label: string;
  detail?: string;
  phase: "sod" | "mid";
  href?: string;
}[] = [
  {
    key: "clickup_comments",
    label: "Clear ClickUp comments on the creative board",
    detail: "Anything a client or the media buyer asked you yesterday.",
    phase: "sod",
    href: "/tasks",
  },
  {
    key: "whatsapp_sprint",
    label: "WhatsApp sprint",
    detail: "Client groups — answer anything creative-related.",
    phase: "sod",
  },
  {
    key: "slack_sprint",
    label: "Slack sprint",
    detail: "Editors, media buyer, CSM.",
    phase: "sod",
  },
  {
    key: "editors_standup",
    label: "Check where every editor is",
    detail: "Anything overdue gets chased before you start your own work.",
    phase: "sod",
    href: "/editors",
  },
  {
    key: "creative_runway",
    label: "Check the next creative batch and client approvals",
    detail:
      "Keep one video and two image concepts moving per two-week sprint. Check script approval, production and each asset's client approval in the existing tasks.",
    phase: "sod",
    href: "/work",
  },
  {
    key: "brand_dna",
    label: "Move the oldest Brand DNA forward",
    detail: "Nothing else can be produced for a client until this is locked.",
    phase: "mid",
    href: "/tasks",
  },
  {
    key: "scripts",
    label: "Write the scripts that are due",
    detail: "Oldest first. Anything past 3 days is blocking a launch.",
    phase: "mid",
    href: "/tasks",
  },
  {
    key: "replace_fatigued",
    label: "Review creative response and prepare a challenger",
    detail:
      "Frequency is a review cue. Check qualified results and keep a current winner live until a replacement is approved and delivering.",
    phase: "mid",
    href: "/what-works",
  },
  {
    key: "social_calendar",
    label: "Plan next week's scripts on the calendar",
    detail:
      "A paying client with nothing being written for them is a churn risk.",
    phase: "mid",
    href: "/work",
  },
  {
    key: "touchpoints",
    label: "Client touchpoints",
    detail: "Use the client communication SOP.",
    phase: "mid",
    href: "/touchpoints",
  },
];

const DONE = new Set(["complete", "cancelled", "closed", "done", "live 🚀"]);

/**
 * The video pipeline, in order. `client review` is his handoff: he sends it to
 * the client, and only when they pass it does he move it on and tell the media
 * buyer. Those are the two stages that stall, so they are called out by name.
 * [aziz, 2026-09-06]
 */
const VIDEO_STAGES = [
  "new video request",
  "planning",
  "in progress",
  "internal review",
  "internal approved",
  "client review",
  "client approved",
  "update required",
  "on hold",
  "live 🚀",
];
/** Stages where the ball is in HIS court, not an editor's or the client's. */
const HIS_MOVE = new Set([
  "client review",
  "internal review",
  "internal approved",
  "client approved",
  "update required",
]);

/** Creative director touchpoint floor: 1 to 2 per active client per week.
 *  Deliberately lighter than the CSM's WhatsApp cadence, the creative side
 *  only messages when there is something to show. [aziz, 2026-09-07] */
export const TOUCHPOINTS_PER_WEEK = 2;

/**
 * The Brand Blueprint Typeform was only added on 2026-09-05. Clients onboarded
 * before then filled nothing, so their blank blueprint is history, not a gap.
 * [aziz, 2026-09-07]
 */
const BLUEPRINT_FORM_LIVE = Date.UTC(2026, 8, 5);

function isOpen(status: string): boolean {
  return !DONE.has(status.toLowerCase());
}

export const snapshot = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "creative");
    return await buildSnapshot(ctx, await allowedClients(ctx));
  },
});

/**
 * The start-of-day screen. `scope` is the client list the portal set for the
 * person (null means everyone); the smoke check passes null.
 */
// biome-ignore lint/suspicious/noExplicitAny: the screen's own shape
export async function buildSnapshot(
  ctx: QueryCtx,
  scope: Set<string> | null,
): Promise<any> {
  const now = Date.now();
  const tasks = (await ctx.db.query("creativeTasks").collect()).filter(t =>
    rowInScope(scope, t),
  );
  const videos = (await ctx.db.query("videoJobs").collect()).filter(j =>
    rowInScope(scope, j),
  );
  const posts = (await ctx.db.query("contentPosts").collect()).filter(p =>
    inScope(scope, p.client),
  );

  const openTasks = tasks.filter(t => isOpen(t.status));

  // The client board is the judge of whether a Brand DNA actually exists.
  // Aziz, 2026-09-07: "we already made the brand dna". Most of these ClickUp
  // tasks are stale rows left open after the doc was written, so an open task
  // on its own is not work. A task with no doc on the client record is.
  const clientBoard = (await ctx.db.query("clients").collect()).filter(c =>
    inScope(scope, c.name),
  );
  /**
   * Task titles and board names never match exactly ("Castello industries
   * w.l.l" against "Castello Industries", "Alkhalil Group" against
   * "Alkhalil"), so match on the aliases the sync already computed and fall
   * back to a containment test both ways. Unicode-safe, because half the
   * roster is Arabic.
   */
  const nrm = (x?: string) =>
    (x || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  function docsFor(raw: string):
    | {
        brand?: string;
        offer?: string;
        matchedTo?: string;
        onboardedAt?: number;
        offerStatus?: string;
      }
    | undefined {
    const key = nrm(raw);
    if (!key) return undefined;
    const hit =
      clientBoard.find(c => nrm(c.name) === key) ??
      clientBoard.find(c =>
        (c.aliases ?? []).some(a => a.length > 2 && key.includes(nrm(a))),
      ) ??
      clientBoard.find(c => {
        const n = nrm(c.name);
        return n.length > 4 && (key.includes(n) || n.includes(key));
      });
    return hit
      ? {
          brand: hit.brandDnaDoc,
          offer: hit.offerCheatSheet,
          matchedTo: hit.name,
          onboardedAt: hit.onboardingCallDate ?? hit.launchDate,
          offerStatus: hit.offerCreationStatus,
        }
      : undefined;
  }

  // --- Client creative journeys -------------------------------------------
  // The six-step onboarding sequence lives as subtasks under a "<Client> -
  // Creative Onboarding" parent. Show where each client actually stands,
  // because "6 tasks to do" tells him nothing about which client is waiting.
  const parents = tasks.filter(t => t.kind === "onboarding" && !t.parentId);
  const journeys = parents.map(p => {
    const steps = tasks
      .filter(t => t.parentId === p.taskId)
      .sort((a, b) => a.name.localeCompare(b.name));
    const done = steps.filter(s => !isOpen(s.status)).length;
    const current = steps.find(s => isOpen(s.status));
    return {
      taskId: p.taskId,
      url: p.url,
      client: p.client ?? p.name,
      status: p.status,
      done,
      total: steps.length,
      currentStep: current?.name ?? null,
      currentStepUrl: current?.url ?? null,
      ageDays: Math.floor((now - p.createdAt) / DAY),
      steps: steps.map(s => ({
        name: s.name,
        status: s.status,
        open: isOpen(s.status),
        url: s.url,
      })),
    };
  });

  /**
   * The offer sign-off lives on the creative board, not the client board.
   * Aziz, 2026-09-08: "offer cheat sheet finished should also be on the
   * creative board, not as done." That is step 3 of the creative onboarding
   * checklist, "3 · Lock The Brand DNA And The Offer": while that subtask is
   * open the offer is not finished, whatever the cheat sheet link or the
   * client-board dropdown says.
   */
  const offerStepByClient = new Map<
    string,
    { open: boolean; status: string; url?: string }
  >();
  for (const j of journeys) {
    const step = j.steps.find(st => /offer/i.test(st.name));
    if (!step) continue;
    offerStepByClient.set(nrm(j.client), {
      open: step.open,
      status: step.status,
      url: step.url,
    });
  }

  // --- Brand DNA queue ----------------------------------------------------
  // Every client needs this locked before anything else can be produced, so
  // it is the true front of the creative queue.
  const brandRaw = openTasks.filter(t => t.kind === "brandDNA" && !t.parentId);
  const seen = new Map<string, number>();
  for (const t of brandRaw) {
    const key = (t.client ?? t.name).toLowerCase().trim();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const brandDNA = brandRaw
    .map(t => {
      const key = (t.client ?? t.name).toLowerCase().trim();
      const docs = docsFor(t.client ?? t.name);
      return {
        taskId: t.taskId,
        url: t.url,
        client: t.client ?? t.name,
        status: t.status,
        ageDays: Math.floor((now - t.createdAt) / DAY),
        duplicate: (seen.get(key) ?? 0) > 1,
        /**
         * A link on the client row only means the template was generated,
         * usually automatically, with whatever the AI could find. It is not
         * a finished Brand DNA. The open task is the truth, so this is shown
         * as a starting point to open, never as proof of completion.
         * [aziz, 2026-09-08]
         */
        docOnFile: Boolean(docs?.brand),
        matchedTo: docs?.matchedTo ?? null,
        docUrl: docs?.brand ?? null,
        offerOnFile: Boolean(docs?.offer),
        offerStatus: docs?.offerStatus ?? null,
      };
    })
    // Oldest first. Every open row is real work, whether or not a draft doc
    // already exists.
    .sort((a, b) => b.ageDays - a.ageDays);
  const brandDnaReal = brandDNA.length;

  // --- Script requests ----------------------------------------------------
  // These come in with no client on them at all, which is the single biggest
  // reason work sits here: nobody can tell whose it is or what it blocks.
  const scripts = openTasks
    .filter(t => t.kind === "script")
    .map(t => ({
      taskId: t.taskId,
      url: t.url,
      status: t.status,
      client: t.client,
      notes: t.notes,
      dueDate: t.dueDate,
      ageDays: Math.floor((now - t.createdAt) / DAY),
      unidentified: !t.client && !t.notes,
    }))
    .sort((a, b) => b.ageDays - a.ageDays);

  // --- Editors / video pipeline -------------------------------------------
  const openVideos = videos.filter(v2 => isOpen(v2.status));
  const byEditor = new Map<
    string,
    { editor: string; open: number; overdue: number; nextDue: number | null }
  >();
  for (const job of openVideos) {
    const names = job.editors.length ? job.editors : ["Unassigned"];
    for (const name of names) {
      const row = byEditor.get(name) ?? {
        editor: name,
        open: 0,
        overdue: 0,
        nextDue: null,
      };
      row.open += 1;
      if (job.dueDate && job.dueDate < now) row.overdue += 1;
      if (job.dueDate && (row.nextDue === null || job.dueDate < row.nextDue)) {
        row.nextDue = job.dueDate;
      }
      byEditor.set(name, row);
    }
  }
  const editors = [...byEditor.values()].sort((a, b) => b.overdue - a.overdue);

  const videoJobs = openVideos
    .map(j => ({
      taskId: j.taskId,
      url: j.url,
      name: j.name,
      client: j.client,
      status: j.status,
      editors: j.editors,
      dueDate: j.dueDate,
      overdueDays:
        j.dueDate && j.dueDate < now ? Math.floor((now - j.dueDate) / DAY) : 0,
      editedLink: j.editedLink,
      /** Unnamed jobs cannot be chased: nobody knows which client they serve. */
      unidentified: /^(new|edit) video request/i.test(j.name.trim()),
      stage: j.status.toLowerCase(),
      stageIndex: VIDEO_STAGES.indexOf(j.status.toLowerCase()),
      /** True when he is the blocker, not an editor and not the client. */
      hisMove: HIS_MOVE.has(j.status.toLowerCase()),
    }))
    .sort((a, b) => b.overdueDays - a.overdueDays);

  // --- Social calendar ----------------------------------------------------
  // Coverage is the question that matters: which clients have nothing
  // scheduled from here on. A client paying for social with an empty
  // calendar is a churn risk long before they complain.
  const upcoming = posts.filter(
    p => isOpen(p.status) && p.publishDate && p.publishDate >= now - DAY,
  );
  const clientsWithPlan = new Set(
    upcoming.map(p => (p.client ?? "").toLowerCase()).filter(Boolean),
  );
  const allSocialClients = new Set(
    posts.map(p => (p.client ?? "").toLowerCase()).filter(Boolean),
  );
  const uncovered = [...allSocialClients]
    .filter(c => !clientsWithPlan.has(c))
    .map(c => {
      const any = posts.find(p => (p.client ?? "").toLowerCase() === c);
      const dates = posts
        .filter(p => (p.client ?? "").toLowerCase() === c && p.publishDate)
        .map(p => p.publishDate as number);
      return {
        client: any?.client ?? c,
        lastPlanned: dates.length ? Math.max(...dates) : null,
      };
    });

  const overduePosts = posts
    .filter(p => isOpen(p.status) && p.publishDate && p.publishDate < now)
    .map(p => ({
      taskId: p.taskId,
      url: p.url,
      name: p.name,
      client: p.client,
      status: p.status,
      publishDate: p.publishDate,
      lateDays: Math.floor((now - (p.publishDate as number)) / DAY),
    }))
    .sort((a, b) => b.lateDays - a.lateDays);

  // --- Creative performance ----------------------------------------------
  // What he actually needs from the ad account: what to replace, and what to
  // make more of. Joined from the media buyer's synced ad rows.
  const campaigns = (await ctx.db.query("campaigns").collect()).filter(c =>
    inScope(scope, c.clientName ?? c.accountName),
  );
  const scopedCampaigns = new Set(campaigns.map(c => c.campaignName));
  // Ads carry no client of their own: the campaign is the join.
  const ads = (await ctx.db.query("ads").collect()).filter(
    a => !scope || scopedCampaigns.has(a.campaignName),
  );
  const clientOf = new Map(
    campaigns.map(c => [c.campaignName, c.clientName ?? c.accountName]),
  );

  const tree = await ctx.db.query("metaTree").collect();
  const activeAdIds = new Set(
    tree
      .filter(
        n => n.kind === "ad" && (n.effectiveStatus ?? n.status) === "ACTIVE",
      )
      .map(n => n.metaId),
  );
  const activeAdNames = new Set(
    tree
      .filter(
        n => n.kind === "ad" && (n.effectiveStatus ?? n.status) === "ACTIVE",
      )
      .map(n => `${n.campaignName}:${n.name}`),
  );
  // Frequency watch. Showing an empty "fatiguing" box would be useless, so
  // this is the leaderboard with the gate marked: he can see what is
  // trending towards burnout before it crosses.
  const withFreq = ads.filter(
    a =>
      a.frequency !== undefined &&
      a.spend > 0 &&
      ((a.metaAdId && activeAdIds.has(a.metaAdId)) ||
        activeAdNames.has(`${a.campaignName}:${a.adName}`)),
  );
  const fatiguing = withFreq
    .map(a => ({
      adName: a.adName,
      client: clientOf.get(a.campaignName) ?? a.campaignName,
      frequency: a.frequency ?? 0,
      cpl: a.cpl,
      spend: a.spend,
      burning: (a.frequency ?? 0) >= FATIGUE_FREQUENCY,
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 8);

  const winners = ads
    .filter(
      a =>
        a.spend >= WINNER_MIN_SPEND &&
        a.cpl !== undefined &&
        a.cpl <= WINNER_CPL &&
        a.leads > 0,
    )
    .map(a => ({
      adName: a.adName,
      client: clientOf.get(a.campaignName) ?? a.campaignName,
      cpl: a.cpl ?? 0,
      leads: a.leads,
      spend: a.spend,
    }))
    .sort((a, b) => a.cpl - b.cpl)
    .slice(0, 12);

  // --- Client profiles ----------------------------------------------------
  // The creative view of one client, the way the CSM screen does it: where
  // their branding stands, what is written, what is being edited, what is
  // late, and how their creative is actually performing. Built from every
  // source at once so he never has to open four boards to answer "how is
  // this client doing".
  const clientKeys = new Map<string, string>();
  const remember = (raw?: string | null) => {
    const name = (raw ?? "").trim();
    if (!name) return;
    const k = name.toLowerCase();
    if (!clientKeys.has(k)) clientKeys.set(k, name);
  };
  for (const t of tasks) remember(t.client);
  for (const j of videos) remember(j.client);
  for (const pp of posts) remember(pp.client);
  for (const c of campaigns) remember(c.clientName ?? c.accountName);

  const blueprintRows = (await ctx.db.query("blueprints").collect()).filter(b =>
    inScope(scope, b.client),
  );
  // The Typeform read is not ported yet (HOSTING.md, "still pending"), so an
  // empty table means "not tracked", not "nobody submitted". Only score the
  // form once rows exist; until then it is neither open nor done.
  const blueprintsTracked = blueprintRows.length > 0;
  const blueprintByClient = new Map<string, (typeof blueprintRows)[number]>();
  for (const b of blueprintRows) {
    if (!b.client) continue;
    const k = b.client.toLowerCase().trim();
    const prev = blueprintByClient.get(k);
    if (!prev || b.submittedAt > prev.submittedAt) blueprintByClient.set(k, b);
  }

  // Show data comes from the client reporting sheets, not GHL, and that pipe
  // is not connected yet: every campaign reports 0 shows against 42 bookings.
  // Rendering "0% show rate" would read as "nobody turns up" when the truth is
  // "we do not know". Flag it as missing instead of printing a false zero.
  // [meta+ghl, 2026-09-06]
  const showDataAvailable = campaigns.some(c => (c.showed7d ?? 0) > 0);

  const touchRows = (await ctx.db.query("touchLog").collect()).filter(r =>
    inScope(scope, r.client),
  );
  const lastTouchByClient = new Map<string, number>();
  for (const r of touchRows) {
    const k = r.client.toLowerCase();
    const prev = lastTouchByClient.get(k);
    if (prev === undefined || r.at > prev) lastTouchByClient.set(k, r.at);
  }

  const clients = [...clientKeys.entries()]
    .map(([key, name]) => {
      const mine = (c?: string | null) => (c ?? "").toLowerCase() === key;
      const brand = brandDNA.filter(b => mine(b.client));
      const myScripts = scripts.filter(sc => mine(sc.client));
      const myVideos = videoJobs.filter(j => mine(j.client));
      const myPosts = posts.filter(pp => mine(pp.client));
      const late = overduePosts.filter(pp => mine(pp.client));
      const myAds = ads.filter(
        a => (clientOf.get(a.campaignName) ?? "").toLowerCase() === key,
      );
      const spend = myAds.reduce((n, a) => n + a.spend, 0);
      const leads = myAds.reduce((n, a) => n + a.leads, 0);
      const burning = myAds.filter(
        a =>
          (a.frequency ?? 0) >= FATIGUE_FREQUENCY &&
          ((a.metaAdId && activeAdIds.has(a.metaAdId)) ||
            activeAdNames.has(`${a.campaignName}:${a.adName}`)),
      ).length;
      const journey = journeys.find(j => mine(j.client));
      const myCampaigns = campaigns.filter(
        c => (c.clientName ?? c.accountName ?? "").toLowerCase() === key,
      );
      const campaignNames = new Set(myCampaigns.map(c => c.campaignName));
      const liveAds = tree.filter(
        t =>
          t.kind === "ad" &&
          campaignNames.has(t.campaignName) &&
          (t.effectiveStatus ?? t.status) === "ACTIVE",
      );
      const blueprint = blueprintByClient.get(key);
      /**
       * The Brand Blueprint Typeform went live on 2026-09-05, so a client
       * onboarded before that date was never asked to fill it and an empty
       * form is not a gap. Only expect one from clients who joined on or
       * after the cutoff. [aziz, 2026-09-07]
       */
      const boardDocs = docsFor(name);
      const onboardedAt = boardDocs?.onboardedAt;
      const blueprintExpected =
        blueprintsTracked &&
        onboardedAt !== undefined &&
        onboardedAt >= BLUEPRINT_FORM_LIVE;
      /**
       * Creative onboarding is finished when the work is finished, not when
       * a field holds a link. Aziz, 2026-09-08: the Brand DNA and Offer
       * Cheat Sheet docs get generated from the template with whatever the
       * AI could find, so the link fills itself. Three human sign-offs
       * decide it instead:
       *   1. the Brand DNA task on the creative board is closed,
       *   2. the Offer Creation dropdown on the client board reads "Done",
       *   3. the Brand Blueprint form has been submitted.
       * Anything short of all three is unfinished, however full the fields
       * look.
       */
      const offerStep = offerStepByClient.get(nrm(name));
      const offerStatus = boardDocs?.offerStatus ?? null;
      const brandDnaSteps = {
        brandDna: {
          done: brand.length === 0,
          label: "Brand DNA finished and the task closed",
          note:
            brand.length === 0
              ? "no open Brand DNA task"
              : boardDocs?.brand
                ? "a draft doc exists, finish it and close the task"
                : "no doc started yet",
          doc: boardDocs?.brand ?? null,
        },
        offer: {
          // The creative board decides this. The client-board dropdown is
          // only quoted underneath when it happens to be set.
          done: offerStep !== undefined && !offerStep.open,
          label: "Offer cheat sheet finished",
          note: offerStep
            ? offerStep.open
              ? `"Lock The Brand DNA And The Offer" is ${offerStep.status} on the creative board`
              : `signed off on the creative board (${offerStep.status})`
            : "no creative onboarding checklist on the board for them yet",
          doc: offerStep?.url ?? boardDocs?.offer ?? null,
        },
        blueprint: {
          done: Boolean(blueprint),
          tracked: blueprintsTracked,
          label: "Brand Blueprint form submitted",
          note: blueprint
            ? "submitted"
            : !blueprintsTracked
              ? "not tracked in the cockpit yet, check Typeform"
              : blueprintExpected
                ? "still waiting on the form"
                : "onboarded before the form existed, so nothing is expected",
          doc: null as string | null,
        },
      };
      const onboardingSteps = [
        brandDnaSteps.brandDna,
        brandDnaSteps.offer,
        brandDnaSteps.blueprint,
      ];
      const onboardingOpen =
        onboardingSteps.filter(st => !st.done && st !== brandDnaSteps.blueprint)
          .length + (blueprintExpected && !blueprint ? 1 : 0);
      const touchesThisWeek = touchRows.filter(
        r => r.client.toLowerCase() === key && r.at >= now - 7 * DAY,
      ).length;
      const sum = (
        f: (c: (typeof myCampaigns)[number]) => number | undefined,
      ) => myCampaigns.reduce((n, c) => n + (f(c) ?? 0), 0);
      const bookings = sum(c => c.bookings7d);
      const showed = sum(c => c.showed7d);
      return {
        client: name,
        // Creative onboarding is "done" only when the Brand Blueprint form
        // exists for them. A closed ClickUp task proves nothing.
        blueprintDone: Boolean(blueprint),
        blueprintExpected,
        offerStatus,
        onboardingSteps,
        onboardingOpen,
        onboardingComplete: onboardingOpen === 0,
        blueprintAt: blueprint?.submittedAt ?? null,
        brandDnaStatus: blueprint?.brandDnaStatus ?? null,
        brandDnaDoc: blueprint?.brandDnaDoc ?? null,
        offerSheet: blueprint?.offerSheet ?? null,
        stillMissing: blueprint?.stillMissing ?? null,
        approvalNeeded: blueprint?.approvalNeeded ?? null,
        campaigns: myCampaigns.map(c => ({
          campaignName: c.campaignName,
          spend7d: c.spend7d,
          leads7d: c.leads7d,
          cpl: c.cpl,
          boardAdStatus: c.boardAdStatus,
          metaAccountId: c.metaAccountId,
          metaCampaignId: c.metaCampaignId,
        })),
        // No preview links: the page shows the saved still and fetches a
        // live preview when an ad is opened.
        liveAds: liveAds.map(a => ({
          metaId: a.metaId,
          name: a.name,
          thumbUrl: a.thumbUrl,
          campaignName: a.campaignName,
          accountId:
            a.accountId ??
            myCampaigns.find(c => c.campaignName === a.campaignName)
              ?.metaAccountId,
          stillKey: a.stillKey,
          stillUrl: a.stillUrl,
          stillTinyUrl: a.stillTinyUrl,
        })),
        bookings7d: bookings,
        showed7d: showDataAvailable ? showed : null,
        showRate: showDataAvailable && bookings > 0 ? showed / bookings : null,
        costPerBooking:
          bookings > 0 ? sum(c => c.spend7d) / bookings : undefined,
        touchesThisWeek,
        touchesOwed: Math.max(0, TOUCHPOINTS_PER_WEEK - touchesThisWeek),
        videos: myVideos.map(v2 => ({
          taskId: v2.taskId,
          url: v2.url,
          name: v2.name,
          stage: v2.stage,
          hisMove: v2.hisMove,
          editors: v2.editors,
          overdueDays: v2.overdueDays,
        })),
        scripts: myScripts.map(sc => ({
          taskId: sc.taskId,
          url: sc.url,
          status: sc.status,
          ageDays: sc.ageDays,
        })),
        brandDnaOpen: brand.length,
        brandDnaOldestDays: brand.length
          ? Math.max(...brand.map(b => b.ageDays))
          : 0,
        journeyDone: journey?.done ?? null,
        journeyTotal: journey?.total ?? null,
        journeyStep: journey?.currentStep ?? null,
        scriptsOpen: myScripts.length,
        scriptsStale: myScripts.filter(sc => sc.ageDays >= SCRIPT_STALE_DAYS)
          .length,
        videosOpen: myVideos.length,
        videosOverdue: myVideos.filter(j => j.overdueDays > 0).length,
        videosWithEditor: myVideos.filter(j => j.editors.length > 0).length,
        videosDelivered: myVideos.filter(j => Boolean(j.editedLink)).length,
        postsPlannedAhead: myPosts.filter(
          pp => isOpen(pp.status) && pp.publishDate && pp.publishDate >= now,
        ).length,
        postsLate: late.length,
        ads: myAds.length,
        spend,
        leads,
        cpl: leads > 0 ? spend / leads : undefined,
        burningAds: burning,
        lastTouch: lastTouchByClient.get(key) ?? null,
      };
    })
    // Rank by how much is wrong, so the worst client is the first thing he sees.
    .map(c => ({
      ...c,
      heat:
        c.brandDnaOldestDays +
        c.scriptsStale * 5 +
        c.videosOverdue * 5 +
        c.postsLate * 2,
    }))
    .sort((a, b) => b.heat - a.heat);

  // --- Touchpoints owed ---------------------------------------------------
  // A touchpoint is owed when something on the creative side changed for that
  // client, or went wrong, and they have not heard from him today. Each one
  // carries the reason, so the message writes itself from the SOP.
  const today = dayKey(now);
  const touchedToday = new Set(
    touchRows.filter(r => r.day === today).map(r => r.client.toLowerCase()),
  );
  const touchpoints = clients
    .flatMap(c => {
      const reasons: string[] = [];
      if (c.postsLate > 0) {
        reasons.push(
          `${c.postsLate} post${c.postsLate > 1 ? "s are" : " is"} past its publish date.`,
        );
      }
      if (c.brandDnaOpen > 0 && c.brandDnaOldestDays >= 7) {
        reasons.push(
          `Brand DNA has been open ${c.brandDnaOldestDays} days — they are probably waiting on you, or you on them.`,
        );
      }
      if (c.touchesOwed > 0 && c.touchesThisWeek === 0) {
        reasons.push(
          `No touchpoint this week — your floor is 1 to 2 per active client.`,
        );
      }
      const inClientReview = c.videos.filter(
        (v2: { stage: string }) => v2.stage === "client review",
      ).length;
      if (inClientReview > 0) {
        reasons.push(
          `${inClientReview} video${inClientReview > 1 ? "s are" : " is"} in client review — send it to them, then move the stage and tell the media buyer.`,
        );
      }
      if (!c.onboardingComplete && c.campaigns.length > 0) {
        const missing = c.onboardingSteps
          .filter((st: { done: boolean; label: string }) => !st.done)
          .filter(
            (st: { label: string }) =>
              c.blueprintExpected ||
              st.label !== "Brand Blueprint form submitted",
          )
          .map((st: { label: string }) => st.label.toLowerCase());
        if (missing.length > 0) {
          reasons.push(
            `Running ads before the branding is signed off, still open: ${missing.join(", ")}.`,
          );
        }
      }
      if (c.journeyStep) {
        reasons.push(
          `Creative onboarding is at "${c.journeyStep}" (${c.journeyDone}/${c.journeyTotal}).`,
        );
      }
      if (c.postsPlannedAhead === 0 && c.postsLate === 0 && c.ads === 0) {
        return [];
      }
      if (!reasons.length) return [];
      /**
       * The template that fits why they are owed a message, so the
       * recommended wording sits on the row itself instead of on a separate
       * page. He can still switch to any other template in the drawer.
       * [aziz, 2026-09-08]
       */
      const templateId =
        inClientReview > 0
          ? "ads-approval"
          : c.postsLate > 0
            ? "content-folder"
            : c.brandDnaOpen > 0
              ? "filming-guidance"
              : "idea-you-saw";
      return [
        {
          client: c.client,
          reasons,
          templateId,
          done: touchedToday.has(c.client.toLowerCase()),
          lastTouch: c.lastTouch,
        },
      ];
    })
    .slice(0, 12);

  // --- The day ------------------------------------------------------------
  const storedChecks = await ctx.db
    .query("checks")
    .withIndex("by_day", q => q.eq("day", today))
    .collect();
  const doneKeys = new Map(storedChecks.map(c => [c.key, c]));
  const checks = CHECKLIST.map((c, i) => ({
    ...c,
    order: i,
    done: doneKeys.get(c.key)?.done ?? false,
    doneAt: doneKeys.get(c.key)?.doneAt ?? null,
  }));

  const plan = await ctx.db
    .query("planItems")
    .withIndex("by_day", q => q.eq("day", today))
    .collect();
  const eod = await ctx.db
    .query("eodReports")
    .withIndex("by_day", q => q.eq("day", today))
    .unique();

  return {
    day: today,
    checks,
    plan,
    eod,
    clients,
    touchpoints,
    syncedAt: tasks[0]?.syncedAt ?? null,
    journeys: journeys.sort((a, b) => b.ageDays - a.ageDays),
    brandDNA,
    scripts,
    staleScripts: scripts.filter(s => s.ageDays >= SCRIPT_STALE_DAYS).length,
    editors,
    videoJobs,
    uncovered,
    overduePosts,
    plannedAhead: upcoming.length,
    fatiguing,
    fatigueGate: FATIGUE_FREQUENCY,
    anyBurning: fatiguing.some(a => a.burning),
    winners,
    videoStages: VIDEO_STAGES.map(st => ({
      stage: st,
      count: videoJobs.filter(j => j.stage === st).length,
    })),
    awaitingHisMove: videoJobs.filter(j => j.hisMove).length,
    blueprintsOnFile: blueprintRows.length,
    blueprintsTracked,
    showDataAvailable,
    touchpointsPerWeek: TOUCHPOINTS_PER_WEEK,
    counts: {
      openTasks: openTasks.length,
      brandDNA: brandDnaReal,
      brandDnaStaleTasks: brandDNA.length - brandDnaReal,
      scripts: scripts.length,
      videos: videoJobs.length,
      overdueVideos: videoJobs.filter(j => j.overdueDays > 0).length,
    },
  };
}

/** Tick or untick one item of the day's checklist. */
export const toggleCheck = authenticatedMutation({
  args: { key: v.string(), done: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { key, done }) => {
    await assertRole(ctx, "creative");
    const spec = CHECKLIST.find(c => c.key === key);
    if (!spec) throw new Error(`Unknown check: ${key}`);
    const day = dayKey(Date.now());
    const existing = await ctx.db
      .query("checks")
      .withIndex("by_day", q => q.eq("day", day))
      .collect();
    const row = existing.find(c => c.key === key);
    if (row) {
      await ctx.db.patch(row._id, {
        done,
        doneAt: done ? Date.now() : undefined,
      });
    } else {
      await ctx.db.insert("checks", {
        day,
        key,
        label: spec.label,
        detail: spec.detail,
        phase: spec.phase,
        href: spec.href,
        done,
        doneAt: done ? Date.now() : undefined,
      });
    }
    return null;
  },
});

/** Record that he actually spoke to a client, so the nag stops. */
export const logTouch = authenticatedMutation({
  args: {
    client: v.string(),
    kind: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { client, kind, note }) => {
    await assertRole(ctx, "creative");
    if (!inScope(await allowedClients(ctx), client))
      throw new Error("That client is not on your list.");
    await ctx.db.insert("touchLog", {
      day: dayKey(Date.now()),
      client,
      kind: kind ?? "touchpoint",
      note,
      at: Date.now(),
    });
    return null;
  },
});

/** Tomorrow's list, written today. */
export const addPlanItem = authenticatedMutation({
  args: {
    text: v.string(),
    reason: v.optional(v.string()),
    clientName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { text, reason, clientName }) => {
    await assertRole(ctx, "creative");
    if (text.trim().length < 3) throw new Error("Write a real line.");
    await ctx.db.insert("planItems", {
      day: dayKey(Date.now()),
      text: text.trim(),
      reason,
      clientName,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const removePlanItem = authenticatedMutation({
  args: { id: v.id("planItems") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "creative");
    await ctx.db.delete(id);
    return null;
  },
});

/**
 * Save the EOD. `computed` is what the cockpit already knows from the day's
 * data, so he is never retyping numbers the system can see for itself.
 */
export const saveEod = authenticatedMutation({
  args: {
    answers: v.any(),
    computed: v.any(),
    energy: v.optional(v.string()),
    stress: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "creative");
    const day = dayKey(Date.now());
    const existing = await ctx.db
      .query("eodReports")
      .withIndex("by_day", q => q.eq("day", day))
      .unique();
    const row = {
      day,
      ...args,
      email: args.email ?? (await userEmail(ctx)),
      at: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("eodReports", row);

    // And out to Slack and the EOD sheet. Saving it here was never
    // enough: the tracking sheet is built from what EOD Radar sees in
    // the channels, so an EOD that stays in Convex is one nobody filed.
    await ctx.scheduler.runAfter(0, internal.eodOut.send, {
      day,
      answers: args.answers,
      computed: args.computed,
      email: row.email,
    });
    return null;
  },
});

/* ---------------------------------------------------------------------------
 * Scripting calendar
 *
 * Aziz, 2026-09-08: a place to plan and see writing work by day, so the answer
 * to "what am I writing today" is one screen, and proactive scripts for a
 * client can be booked into a day instead of living in someone's head.
 *
 * Everything here is real ClickUp work with a real due date. Nothing is
 * invented: a day with nothing on it shows nothing, and the suggestions are
 * labelled as suggestions until they are actually planned onto the board.
 * ------------------------------------------------------------------------ */

/** Kuwait-local YYYY-MM-DD for a timestamp. */
function dKey(ts: number): string {
  return new Date(ts + KUWAIT_OFFSET).toISOString().slice(0, 10);
}

/** Days back and forward the calendar shows. */
const CAL_BACK = 7;
const CAL_FORWARD = 20;

export const calendar = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "creative");
    return await buildCalendar(ctx, await allowedClients(ctx));
  },
});

// biome-ignore lint/suspicious/noExplicitAny: the screen's own shape
export async function buildCalendar(
  ctx: QueryCtx,
  scope: Set<string> | null,
): Promise<any> {
  const now = Date.now();
  const today = dKey(now);
  const tasks = (await ctx.db.query("creativeTasks").collect()).filter(t =>
    rowInScope(scope, t),
  );
  const videos = (await ctx.db.query("videoJobs").collect()).filter(j =>
    rowInScope(scope, j),
  );
  const posts = (await ctx.db.query("contentPosts").collect()).filter(p =>
    inScope(scope, p.client),
  );
  const clientRows = (await ctx.db.query("clients").collect()).filter(c =>
    inScope(scope, c.name),
  );

  type Item = {
    id: string;
    day: string | null;
    client: string | null;
    kind:
      | "script"
      | "video"
      | "post"
      | "brandDNA"
      | "onboarding"
      | "creativeBatch";
    title: string;
    status: string;
    open: boolean;
    overdue: boolean;
    url?: string;
    taskId?: string;
    canSchedule: boolean;
    canComplete: boolean;
  };

  const items: Item[] = [];

  for (const t of tasks) {
    const kind =
      t.kind === "brandDNA"
        ? "brandDNA"
        : t.kind === "creativeBatch"
          ? "creativeBatch"
          : t.kind === "script"
            ? "script"
            : t.kind === "onboarding"
              ? "onboarding"
              : null;
    // Aziz, 2026-09-10: onboarding shows as the one parent task, never the
    // checklist of subtasks under it.
    if (!kind) continue;
    const open = isOpen(t.status);
    // Closed work with no date is history, not a plan. Keep it out.
    if (!open && !t.dueDate) continue;
    const day = t.dueDate ? dKey(t.dueDate) : null;
    items.push({
      id: `t-${t.taskId}`,
      day,
      client: t.client ?? null,
      kind: kind as Item["kind"],
      title: t.name,
      status: t.status,
      open,
      overdue: open && !!day && day < today,
      url: t.url,
      taskId: t.taskId,
      canSchedule: true,
      canComplete: open,
    });
  }

  for (const v2 of videos) {
    const open = isOpen(v2.status);
    if (!open && !v2.dueDate) continue;
    const day = v2.dueDate ? dKey(v2.dueDate) : null;
    items.push({
      id: `v-${v2.taskId}`,
      day,
      client: v2.client ?? null,
      kind: "video",
      title: v2.name,
      status: v2.status,
      open,
      overdue: open && !!day && day < today,
      url: v2.url,
      taskId: v2.taskId,
      canSchedule: true,
      canComplete: open,
    });
  }

  for (const p of posts) {
    if (!p.publishDate) continue;
    const day = dKey(p.publishDate);
    const open = isOpen(p.status);
    items.push({
      id: `p-${p.taskId}`,
      day,
      client: p.client ?? null,
      kind: "post",
      title: p.name,
      status: p.status,
      open,
      overdue: open && day < today,
      url: p.url,
      taskId: p.taskId,
      canSchedule: true,
      canComplete: false,
    });
  }

  // --- The grid -----------------------------------------------------------
  const start = new Date(now + KUWAIT_OFFSET);
  start.setUTCDate(start.getUTCDate() - CAL_BACK);
  const days: {
    day: string;
    label: string;
    weekday: string;
    isToday: boolean;
    isPast: boolean;
    isFriday: boolean;
    items: Item[];
  }[] = [];
  for (let i = 0; i <= CAL_BACK + CAL_FORWARD; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    days.push({
      day: key,
      label: d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
      weekday: d.toLocaleDateString("en-GB", {
        weekday: "short",
        timeZone: "UTC",
      }),
      isToday: key === today,
      isPast: key < today,
      // Friday is off in Kuwait, so nothing should be planned into it.
      isFriday: d.getUTCDay() === 5,
      items: items
        .filter(it => it.day === key)
        .sort((a, b) => a.kind.localeCompare(b.kind)),
    });
  }

  // Anything overdue from before the window still has to be seen.
  const olderOverdue = items.filter(it => it.overdue && it.day! < days[0].day);

  // --- Undated work -------------------------------------------------------
  const unplanned = items
    .filter(it => it.open && !it.day)
    .sort((a, b) => (a.client ?? "").localeCompare(b.client ?? ""));

  // --- Proactive suggestions ---------------------------------------------
  // A live client with no open script work, or with creative due for review, is
  // a client nobody is writing for right now.
  const openScriptClients = new Set(
    items
      .filter(
        it =>
          it.open &&
          (it.kind === "script" ||
            it.kind === "video" ||
            it.kind === "creativeBatch"),
      )
      .map(it => (it.client ?? "").toLowerCase()),
  );
  // Ads carry no client of their own: the campaign is what maps an ad back
  // to a client, same join the rest of the cockpit uses.
  const campaigns = (await ctx.db.query("campaigns").collect()).filter(c =>
    inScope(scope, c.clientName ?? c.clientTag),
  );
  const scopedCampaigns = new Set(campaigns.map(c => c.campaignName));
  const ads = (await ctx.db.query("ads").collect()).filter(
    a => !scope || scopedCampaigns.has(a.campaignName),
  );
  const clientByCampaign = new Map(
    campaigns.map(c => [c.campaignName, c.clientName ?? c.clientTag ?? null]),
  );
  const burning = new Map<string, number>();
  for (const a of ads) {
    const owner = clientByCampaign.get(a.campaignName);
    if (!owner) continue;
    if ((a.frequency ?? 0) >= FATIGUE_FREQUENCY) {
      burning.set(owner, (burning.get(owner) ?? 0) + 1);
    }
  }
  const suggestions = clientRows
    .filter(c => (c.clientStatus ?? "").toLowerCase() !== "cancelled")
    .map(c => {
      const nothingPlanned = !openScriptClients.has(c.name.toLowerCase());
      const burn = burning.get(c.name) ?? 0;
      const why = burn
        ? `${burn} creative at the frequency review cue; check response and approved backup`
        : nothingPlanned
          ? "nothing being written for them right now"
          : null;
      return why
        ? {
            client: c.name,
            why,
            priority: burn ? 1 : 2,
            driveScripts: c.driveScripts ?? null,
            driveFootage: c.driveFootage ?? null,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a!.priority - b!.priority)
    .slice(0, 12);

  return {
    today,
    days,
    olderOverdue,
    unplanned,
    suggestions,
    clients: clientRows
      .map(c => ({
        name: c.name,
        driveFolder: c.driveLink ?? c.driveFolder ?? null,
        driveScripts: c.driveScripts ?? null,
        driveFootage: c.driveFootage ?? null,
        driveSubfolders: c.driveSubfolders ?? [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    counts: {
      planned: items.filter(it => it.open && it.day).length,
      unplanned: unplanned.length,
      overdue: items.filter(it => it.overdue).length,
    },
  };
}

/* ---------------------------------------------------------------------------
 * What to script next
 *
 * Aziz, 2026-09-08: scripting is not only ads. It is landing pages, the
 * questions on the form, VSLs and thank you pages too. So this is one ranked
 * queue of what deserves writing next and why, evidence attached.
 *
 * Every row is triggered by something real: creative past the fatigue gate, a
 * client with nothing live, a form that filters nobody, an ad that lands
 * nowhere, an opt in with no follow up page. Nothing here is a generic
 * reminder, and each row says what it is reacting to so it can be argued with.
 * ------------------------------------------------------------------------ */

export const scriptQueue = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "creative");
    return await buildScriptQueue(ctx, await allowedClients(ctx));
  },
});

// biome-ignore lint/suspicious/noExplicitAny: the screen's own shape
export async function buildScriptQueue(
  ctx: QueryCtx,
  scope: Set<string> | null,
): Promise<any> {
  // Only clients who are actually paying or actually about to launch belong
  // in a writing queue. Stopped, paused and "sales team to contact" rows are
  // not the creative director's problem, and putting them here would bury the
  // real work under 40 rows of noise. Statuses are verbatim ClickUp values.
  const LIVE = new Set(["active"]);
  const PRE_LAUNCH = new Set([
    "launch booked",
    "ready for launch",
    "onboarding booked",
  ]);
  const statusKey = (s2?: string | null) =>
    (s2 ?? "")
      .toLowerCase()
      .replace(/[^a-z ]/g, "")
      .trim();
  const clientRows = (await ctx.db.query("clients").collect()).filter(c => {
    const k = statusKey(c.clientStatus);
    return inScope(scope, c.name) && (LIVE.has(k) || PRE_LAUNCH.has(k));
  });
  const campaigns = await ctx.db.query("campaigns").collect();
  const ads = await ctx.db.query("ads").collect();
  const tree = await ctx.db.query("metaTree").collect();
  const funnels = await ctx.db.query("funnels").collect();
  const tasks = await ctx.db.query("creativeTasks").collect();
  const videos = await ctx.db.query("videoJobs").collect();

  const key = (s?: string | null) => (s ?? "").trim().toLowerCase();

  type Row = {
    client: string;
    type:
      | "Ad creative"
      | "Landing page"
      | "Funnel questions"
      | "Follow up page"
      | "Launch scripts";
    why: string;
    evidence: string;
    priority: number;
    /**
     * Aziz, 2026-09-08: funnel questions, landing pages, follow up pages and
     * VSLs are not routine writing. We only switch a client onto them when
     * the funnel needs it. They stay out of the main list and sit behind
     * "only when it is needed" so the day stays about ads and launches.
     */
    optional?: boolean;
    href?: string;
    suggestedTitle: string;
  };
  const out: Row[] = [];

  for (const c of clientRows) {
    const mine = (t: { clients?: string[]; client?: string }) =>
      (t.clients ?? (t.client ? [t.client] : [])).some(
        n => key(n) === key(c.name),
      );
    const myCampaigns = campaigns.filter(
      k =>
        key(k.clientName) === key(c.name) ||
        c.aliases.some(a => a.length > 2 && key(k.campaignName).includes(a)),
    );
    const names = new Set(myCampaigns.map(k => k.campaignName));
    const myAds = ads.filter(a => names.has(a.campaignName));
    const liveAdNames = new Set(
      tree
        .filter(
          n =>
            n.kind === "ad" &&
            names.has(n.campaignName) &&
            (n.effectiveStatus || n.status || "").toUpperCase() === "ACTIVE",
        )
        .map(n => n.name),
    );
    const accounts = new Set(myCampaigns.map(k => key(k.accountName)));
    const myFunnels = funnels.filter(f => accounts.has(key(f.account)));
    const openScripts = tasks.filter(
      t => mine(t) && t.kind === "script" && isOpen(t.status),
    );
    const openBatches = tasks.filter(
      t => mine(t) && t.kind === "creativeBatch" && isOpen(t.status),
    );
    const openVideos = videos.filter(t => mine(t) && isOpen(t.status));
    const live = LIVE.has(statusKey(c.clientStatus));

    // 1. Creative burning out. The highest priority because the money is
    //    already being spent against an audience that has seen it enough.
    const burning = myAds.filter(
      a => liveAdNames.has(a.adName) && (a.frequency ?? 0) >= FATIGUE_FREQUENCY,
    );
    if (burning.length) {
      out.push({
        client: c.name,
        type: "Ad creative",
        why: "Review live creative response and keep an approved challenger ready",
        evidence: `${burning.length} live ad${burning.length === 1 ? "" : "s"} at or past the ${FATIGUE_FREQUENCY} frequency review cue: ${burning.map(a => a.adName).join(", ")}`,
        priority: 1,
        suggestedTitle: "Replacement ad scripts",
      });
    }

    // 2. Paying, spending, and nothing is live.
    if (live && liveAdNames.size === 0 && myCampaigns.length > 0) {
      out.push({
        client: c.name,
        type: "Ad creative",
        why: "They have campaigns but nothing running, so there is nothing to optimise",
        evidence: `${myCampaigns.length} campaign${myCampaigns.length === 1 ? "" : "s"} on the board, 0 ads live right now`,
        priority: 1,
        suggestedTitle: "New ad scripts",
      });
    }

    // 3. The form filters nobody. This is the cheapest lever on lead quality
    //    there is, and it is writing, not media buying.
    for (const f of myFunnels) {
      if (f.kind === "Instant form" && f.gates === 0 && f.spend > 0) {
        out.push({
          client: c.name,
          type: "Funnel questions",
          why: "Their lead form asks nothing that filters, so the setter gets everyone",
          evidence: `${f.formName || "instant form"}: ${f.questions.length} question${f.questions.length === 1 ? "" : "s"}, none of them filtering, ${money0(f.spend)} spent in 30 days at ${money0(f.cpl)} per lead`,
          priority: 3,
          optional: true,
          href: "/funnels",
          suggestedTitle: "Qualifying questions for the lead form",
        });
      }
      // 4. The ad lands nowhere it can sell.
      if (f.kind === "Stays on the post" && f.spend > 0) {
        out.push({
          client: c.name,
          type: "Landing page",
          why: "Money is going to an ad that sends people nowhere",
          evidence: `${money0(f.spend)} in 30 days on ads with no destination to script`,
          priority: 3,
          optional: true,
          href: "/funnels",
          suggestedTitle: "Landing page copy",
        });
      }
      // 5. Opt in, then silence. Only ever a suggestion: Aziz, 2026-09-08, a
      //    client is switched onto a follow up page or a VSL when the funnel
      //    actually needs it, not as routine work.
      if (f.kind === "Instant form" && !f.followUpUrl && f.leads > 0) {
        out.push({
          client: c.name,
          type: "Follow up page",
          why: "People opt in and get no follow up page or video, which is where show rate is won",
          evidence: `${f.leads} leads in 30 days through ${f.formName || "the form"} with nothing after the opt in`,
          priority: 4,
          optional: true,
          href: "/funnels",
          suggestedTitle: "Thank you page and VSL script",
        });
      }
    }

    // 6. Onboarding clients with nothing written yet.
    const onboarding = PRE_LAUNCH.has(statusKey(c.clientStatus));
    if (onboarding && openScripts.length === 0 && myAds.length === 0) {
      out.push({
        client: c.name,
        type: "Launch scripts",
        why: "Not launched yet and no scripts written, so launch waits on writing",
        evidence: `Client status is ${c.clientStatus}, 0 script requests open, 0 ads ever run`,
        priority: 2,
        suggestedTitle: "Launch scripts",
      });
    }

    // 7. Live, paying, and nobody is writing anything for them at all.
    if (
      live &&
      openScripts.length === 0 &&
      openVideos.length === 0 &&
      openBatches.length === 0
    ) {
      out.push({
        client: c.name,
        type: "Ad creative",
        why: "Active client with nothing being written or edited for them",
        evidence:
          "0 open script requests, 0 videos in the pipeline, 0 creative batches",
        priority: 3,
        suggestedTitle: "Fresh angles",
      });
    }
  }

  out.sort(
    (a, b) => a.priority - b.priority || a.client.localeCompare(b.client),
  );

  const main = out.filter(r => !r.optional);
  const optional = out.filter(r => r.optional);
  const byType: Record<string, number> = {};
  for (const r of main) byType[r.type] = (byType[r.type] ?? 0) + 1;

  return {
    rows: main,
    optional,
    byType,
    total: main.length,
    optionalTotal: optional.length,
  };
}

function money0(n?: number | null): string {
  return n === null || n === undefined ? "n/a" : `$${Math.round(n)}`;
}
