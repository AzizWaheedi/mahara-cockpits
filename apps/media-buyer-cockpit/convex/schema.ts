import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const schema = defineSchema({
  ...authTables,

  /** One row per campaign: the Ads Managment task joined to live spend. */
  campaigns: defineTable({
    campaignName: v.string(),
    accountName: v.string(),
    /** Why Meta would refuse edits on this account right now (unsettled balance, disabled), if it would. */
    accountIssue: v.optional(v.string()),
    clientName: v.optional(v.string()),
    taskId: v.optional(v.string()),
    taskUrl: v.optional(v.string()),
    adStatus: v.optional(v.string()),
    onBoard: v.boolean(),
    internal: v.optional(v.boolean()),
    currency: v.optional(v.string()),
    spend7d: v.number(),
    spendToday: v.optional(v.number()),
    leadsToday: v.optional(v.number()),
    dataThrough: v.optional(v.string()),
    /**
     * Why this client's leads died, from their GHL sub-account. The reason is the
     * stage name in the Lost Leads pipeline; `notes` carries the real reason for
     * the many that land in "Other". `byAd` keys are Meta ad ids.
     */
    lost: v.optional(
      v.object({
        total: v.number(),
        reasons: v.array(v.object({ reason: v.string(), count: v.number() })),
        notes: v.array(
          v.object({
            note: v.string(),
            reason: v.string(),
            adId: v.optional(v.string()),
            at: v.string(),
          }),
        ),
        byAd: v.record(v.string(), v.number()),
      }),
    ),
    leads7d: v.number(),
    cpl: v.optional(v.number()),
    impressions7d: v.number(),
    linkClicks7d: v.number(),
    linkCtr: v.optional(v.number()),
    cpm: v.optional(v.number()),
    optInRate: v.optional(v.number()),
    frequency: v.optional(v.number()),
    dayRate: v.number(),
    medianDayRate: v.optional(v.number()),
    contractedBudget: v.optional(v.number()),
    /**
     * Where Meta holds the budget: "campaign" (CBO, Advantage campaign budget)
     * or "adset" (ABO). Budget edits must go to that level, or Meta refuses.
     */
    budgetLevel: v.optional(v.string()),
    /** The daily budget set on Meta: the campaign's for CBO, the delivering ad sets' total for ABO. */
    budgetDaily: v.optional(v.number()),
    /** A lifetime budget, when the campaign or its ad sets use one instead. */
    budgetLifetime: v.optional(v.number()),
    firstSpend: v.optional(v.string()),
    daysLive: v.optional(v.number()),
    staleTaskName: v.optional(v.string()),
    // biome-ignore lint/suspicious/noExplicitAny: legacy rows, dropped on next sync
    diagnosis: v.optional(v.any()),
    /** Every constraint that fits, ranked; the first is today's call. */
    findings: v.optional(
      v.array(
        v.object({
          constraint: v.string(),
          evidence: v.string(),
          fixes: v.array(v.string()),
          severity: v.optional(v.string()),
        }),
      ),
    ),
    daysSinceTouch: v.optional(v.number()),
    lastChangeAt: v.optional(v.number()),
    clientTag: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    serviceType: v.optional(v.string()),
    /** DFY = we book for them. DWY = leads only, judged on CPL alone. */
    serviceMode: v.optional(v.string()),
    priority: v.optional(v.string()),
    boardAdStatus: v.optional(v.string()),
    /** The card's Advertising Cities labels on the Ads Management board. */
    advertisingCities: v.optional(v.array(v.string())),
    cplStatus: v.optional(v.string()),
    cpbStatus: v.optional(v.string()),
    showed7d: v.optional(v.number()),
    costPerBooking: v.optional(v.number()),
    bookingRate: v.optional(v.number()),
    showRate: v.optional(v.number()),
    hasGhl: v.optional(v.boolean()),
    metaAccountId: v.optional(v.string()),
    metaCampaignId: v.optional(v.string()),
    bookings7d: v.optional(v.number()),
    verdict: v.string(),
    reason: v.string(),
    rank: v.number(),
    syncedAt: v.number(),
  }).index("by_rank", ["rank"]),

  /**
   * One row per date x ad, last 30 days. The 7-day numbers on `campaigns` and
   * `ads` are a fixed window; this is the raw grain underneath them, so the
   * cockpit can answer "today", "yesterday" or any custom range at campaign,
   * ad set and ad level without another sync. [aziz, 2026-09-07]
   */
  dailyStats: defineTable({
    date: v.string(), // YYYY-MM-DD, Kuwait
    campaignName: v.string(),
    adSetName: v.optional(v.string()),
    adName: v.string(),
    metaAdId: v.optional(v.string()),
    spend: v.number(),
    leads: v.number(),
    impressions: v.number(),
    linkClicks: v.number(),
    frequency: v.optional(v.number()),
  }).index("by_campaign_date", ["campaignName", "date"]),

  /**
   * One row per booked appointment, with the Meta ad that bought it.
   * Calendar events carry the booking; the contact's opportunity carries
   * `utmAdId`, and the two join on contactId (95% hit rate across clients).
   * This is what makes cost per booking real at ad set and ad level rather
   * than only per campaign. [aziz, 2026-09-07]
   */
  bookingEvents: defineTable({
    campaignName: v.string(),
    client: v.optional(v.string()),
    /** The day the booking was MADE — what cost per booking divides by. */
    date: v.string(), // YYYY-MM-DD, Kuwait
    /** The day of the appointment itself, which may be in the future. */
    appointmentDate: v.optional(v.string()),
    status: v.string(), // confirmed | showed | noshow | ...
    adId: v.optional(v.string()),
    syncedAt: v.number(),
  }).index("by_campaign_date", ["campaignName", "date"]),

  /** One row per ad, last 7 days, for the expanded view. */
  ads: defineTable({
    campaignName: v.string(),
    adName: v.string(),
    spend: v.number(),
    leads: v.number(),
    cpl: v.optional(v.number()),
    linkCtr: v.optional(v.number()),
    cpm: v.optional(v.number()),
    optInRate: v.optional(v.number()),
    frequency: v.optional(v.number()),
    thumbnailUrl: v.optional(v.string()),
    // Meta's rendered preview iframe, so she can watch the actual ad.
    previewSrc: v.optional(v.string()),
    metaAdId: v.optional(v.string()),
    verdict: v.string(),
    reason: v.string(),
    syncedAt: v.number(),
  }).index("by_campaign", ["campaignName"]),

  /**
   * The live Meta structure under a campaign: ad sets and ads, with Meta's own
   * preview iframe. Ads Manager itself sends X-Frame-Options: DENY and can never
   * be embedded — this is the part Meta does allow us to render in place.
   */
  metaTree: defineTable({
    campaignName: v.string(),
    kind: v.string(), // adset | ad
    metaId: v.string(),
    name: v.string(),
    status: v.string(),
    effectiveStatus: v.optional(v.string()),
    adsetId: v.optional(v.string()),
    dailyBudget: v.optional(v.number()),
    previewSrc: v.optional(v.string()),
    /** When the preview link was fetched; Meta signs them and they expire after about a day. */
    previewAt: v.optional(v.number()),
    /** Still image fallback when Meta will not render the preview iframe. */
    thumbUrl: v.optional(v.string()),
    syncedAt: v.number(),
  }).index("by_campaign", ["campaignName"]),

  /**
   * Meta change history from the Creative Triage database — who changed what in an
   * ad account. This is the audit trail a CSM needs before a check-in call.
   */
  adChanges: defineTable({
    campaignName: v.string(),
    at: v.number(),
    actor: v.optional(v.string()),
    eventType: v.string(),
    objectName: v.optional(v.string()),
    objectType: v.optional(v.string()),
  }).index("by_campaign", ["campaignName"]),

  /** Decisions taken — this is the ledger that makes the system self-correcting. */
  decisions: defineTable({
    day: v.string(),
    role: v.string(),
    subject: v.string(),
    action: v.string(),
    kind: v.string(), // approved | alternative | rerouted | left
    reason: v.optional(v.string()),
    snooze: v.optional(v.string()),
    reroutedTo: v.optional(v.string()),
    evidence: v.string(),
    metricAtDecision: v.optional(v.number()),
    metricAfter7d: v.optional(v.number()),
    clickupTaskId: v.optional(v.string()),
    clickupTaskUrl: v.optional(v.string()),
    byEmail: v.optional(v.string()),
    loggedAt: v.optional(v.number()),
    logError: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_day", ["day"])
    .index("by_subject", ["subject"]),

  /** Start of day checklist, one row per role per day. */
  /** Her own ClickUp work: assigned tasks and comments that tag her. */
  inbox: defineTable({
    kind: v.string(),
    taskId: v.string(),
    title: v.string(),
    url: v.optional(v.string()),
    status: v.optional(v.string()),
    listName: v.optional(v.string()),
    reason: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    overdue: v.optional(v.boolean()),
    body: v.optional(v.string()),
    author: v.optional(v.string()),
    at: v.number(),
  }).index("by_kind", ["kind"]),

  /** Per-client settings the media buyer owns. Sticky, not guessed every sync. */
  clientPrefs: defineTable({
    clientName: v.string(),
    language: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_client", ["clientName"]),

  checks: defineTable({
    role: v.string(),
    day: v.string(),
    key: v.string(),
    label: v.string(),
    detail: v.optional(v.string()),
    /** "sod" = clear the decks first thing, "mid" = the account work itself. */
    phase: v.optional(v.string()),
    /** CSM day blocks: sprint_am | work_am | sprint_midday | work_pm | sprint_pm. */
    block: v.optional(v.string()),
    order: v.optional(v.number()),
    href: v.optional(v.string()),
    done: v.boolean(),
    doneAt: v.optional(v.number()),
  }).index("by_role_day", ["role", "day"]),

  /** Plan Tomorrow Today items, which also become the EOD report. */
  /** Changes she made by hand that Meta's activity log cannot see. */
  manualChanges: defineTable({
    campaignName: v.string(),
    adName: v.optional(v.string()),
    what: v.string(),
    by: v.string(),
    at: v.number(),
    clickupTaskId: v.optional(v.string()),
  }).index("by_campaign", ["campaignName"]),

  /** ClickUp people she can hand a task to, refreshed on every sync. */
  clickupMembers: defineTable({
    userId: v.number(),
    username: v.string(),
    email: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  planItems: defineTable({
    role: v.string(),
    day: v.string(),
    text: v.string(),
    listName: v.optional(v.string()),
    reason: v.optional(v.string()),
    listId: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    clientName: v.optional(v.string()),
    confirmed: v.boolean(),
    clickupTaskId: v.optional(v.string()),
    clickupTaskUrl: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_role_day", ["role", "day"]),

  /** One row per client, rebuilt each morning from Clients - Mahara. */
  clients: defineTable({
    taskId: v.string(),
    taskUrl: v.optional(v.string()),
    name: v.string(),
    stage: v.string(),
    stageRank: v.number(),
    csmAssigned: v.optional(v.string()),
    lastPoc: v.optional(v.string()),
    lastCall: v.optional(v.string()),
    nextPoc: v.optional(v.string()),
    launchDate: v.optional(v.string()),
    liveDays: v.optional(v.number()),
    paymentDate: v.optional(v.string()),
    paymentDue: v.optional(v.number()),
    extendedUntil: v.optional(v.string()),
    happiness: v.optional(v.string()),
    commsLevel: v.optional(v.string()),
    contract: v.optional(v.string()),
    service: v.optional(v.string()),
    dwy: v.optional(v.boolean()),
    signupDays: v.optional(v.number()),
    sheetLink: v.optional(v.string()),
    lastReport: v.optional(v.string()),
    reportDays: v.optional(v.number()),
    reportTracked: v.optional(v.boolean()),
    reportDue: v.optional(v.boolean()),
    silentDays: v.optional(v.number()),
    callDays: v.optional(v.number()),
    todo: v.string(),
    level: v.string(),
    rank: v.number(),
    hot: v.array(v.object({ kind: v.string(), why: v.string() })),
    loose: v.array(v.string()),
    changes: v.array(v.any()),
    lastNoteOn: v.optional(v.string()),
    noteMissing: v.optional(v.boolean()),
    defcon: v.optional(v.string()),
    callPriority: v.optional(v.string()),
    commitments: v.optional(
      v.array(v.object({ text: v.string(), source: v.string() })),
    ),
    newSignup: v.boolean(),
    bucket: v.optional(v.string()),
    salesHandoff: v.optional(v.boolean()),
    pauseRequired: v.optional(v.boolean()),
    onboarding: v.boolean(),
    syncedAt: v.number(),
  }).index("by_rank", ["rank"]),

  /** Open Client Success board tasks: due today, overdue or undated. */
  csTasks: defineTable({
    taskId: v.string(),
    taskUrl: v.optional(v.string()),
    name: v.string(),
    status: v.string(),
    dueDate: v.optional(v.string()),
    overdueDays: v.optional(v.number()),
    assignee: v.optional(v.string()),
    syncedAt: v.number(),
  }),

  /** Commitments made to clients on calls or in WhatsApp, with a clock on them. */
  promises: defineTable({
    clientName: v.string(),
    text: v.string(),
    source: v.string(),
    madeOn: v.string(),
    dueDate: v.optional(v.string()),
    clearedAt: v.optional(v.number()),
    clickupTaskId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_client", ["clientName"]),

  /** The CSM's end-of-day, mirroring the Account Manager EOD Typeform fields. */
  eodReports: defineTable({
    role: v.string(),
    day: v.string(),
    email: v.optional(v.string()),
    energy: v.optional(v.string()),
    stress: v.optional(v.string()),
    computed: v.any(),
    answers: v.any(),
    at: v.number(),
    /** Set once it has gone to the sheet and #media-eods. Guards double-posting. */
    submittedAt: v.optional(v.number()),
    slackTs: v.optional(v.string()),
    /** Why the last post attempt failed, and how many have been made, so the cockpit can say "still posting" and retry. */
    error: v.optional(v.string()),
    attempts: v.optional(v.number()),
    /** When a post run claimed the row. A second run inside a minute of it backs off, so a retry and a resubmit never both post. */
    postingAt: v.optional(v.number()),
  }).index("by_role_day", ["role", "day"]),

  /**
   * A campaign she asked Viktor to build. It is assembled from the account's own
   * best-performing ad set, reviewed by her in the cockpit, and only then launched
   * (always paused, so nothing spends before a human looks at it).
   */
  /**
   * Staging area for sync input fetched OUTSIDE the app.
   *
   * The Space's own tool endpoint is down platform-side, so the Viktor sandbox
   * (where the same tools work) fetches the sheets and ClickUp boards and drops
   * them here in chunks, then runs the sync. Stored as string chunks because a
   * single payload exceeds the argument size limit.
   */
  syncInput: defineTable({
    part: v.number(),
    data: v.string(),
    at: v.number(),
  }).index("by_part", ["part"]),

  /**
   * Writes that could not reach the tool endpoint.
   *
   * While the Spaces tool endpoint is down, a ClickUp comment or a Slack post
   * would simply be lost when she clicks. Queue it instead and let the sandbox
   * bridge drain it, so nothing silently disappears.
   */
  /**
   * Per-campaign conversation between the media buyer and Viktor.
   *
   * Aziz, 2026-09-06: she should be able to ask about a campaign right where
   * the recommendation is, instead of leaving the cockpit to write a Slack
   * message with no context.
   *
   * In-app AI answering is blocked by the tool-gateway outage, so a question
   * is relayed to Slack with the campaign's numbers attached and the answer is
   * written back here. `pending` is what drives the "waiting for Viktor" state.
   */
  campaignChat: defineTable({
    campaignId: v.string(),
    campaignName: v.string(),
    client: v.optional(v.string()),
    /** "her" for the media buyer's question, "viktor" for the answer. */
    author: v.string(),
    authorName: v.optional(v.string()),
    text: v.string(),
    /** Snapshot of the numbers at the moment she asked, so answers stay honest. */
    context: v.optional(v.string()),
    pending: v.boolean(),
    /**
     * Where the message has got to: queued (written, not yet relayed) ->
     * sent (Viktor has it) -> answered. `failed` when the relay gave up.
     * Without this the box swallows a question and she cannot tell whether
     * anything is happening. [aziz, 2026-09-07]
     */
    status: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    /** question | request | action | note — actions are logged automatically. */
    kind: v.optional(v.string()),
    /** For an action: did it actually work, and what did it change. */
    ok: v.optional(v.boolean()),
    at: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_pending", ["pending"]),

  outbox: defineTable({
    role: v.string(),
    args: v.any(),
    at: v.number(),
    tries: v.number(),
    lastError: v.optional(v.string()),
    doneAt: v.optional(v.number()),
  }).index("by_done", ["doneAt"]),

  /**
   * The GCC winning-data database.
   *
   * One row per ad set we have ever run, with what was TARGETED alongside what
   * it RETURNED. This is what lets the cockpit say "broad in Riyadh at $11 a
   * lead beat interest stacks for interior design, so try it in Manama"
   * instead of every client starting from zero.
   */
  marketPlays: defineTable({
    client: v.string(),
    accountId: v.string(),
    country: v.optional(v.string()),
    city: v.optional(v.string()),
    serviceLine: v.optional(v.string()),
    adsetId: v.string(),
    adsetName: v.string(),
    /** broad | interests | lookalike | custom — the shape of the play. */
    playType: v.string(),
    interests: v.array(v.string()),
    ageMin: v.optional(v.number()),
    ageMax: v.optional(v.number()),
    optimizationGoal: v.optional(v.string()),
    spend: v.number(),
    leads: v.number(),
    cpl: v.optional(v.number()),
    /**
     * The creative side of the play, not just the targeting.
     *
     * Aziz's point: knowing an interest stack worked in Riyadh is only half the
     * lesson — we also need what kind of ad and what kind of copy carried it,
     * so a winning combination can be reused for another client in another
     * city. [aziz, 2026-09-06]
     */
    formats: v.optional(v.array(v.string())),
    ctas: v.optional(v.array(v.string())),
    /** Traits of the copy, not the copy itself: question hook, price, etc. */
    copyTraits: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
    creatives: v.optional(
      v.array(
        v.object({
          adId: v.string(),
          adName: v.string(),
          format: v.string(),
          cta: v.optional(v.string()),
          headline: v.optional(v.string()),
          body: v.optional(v.string()),
          /** Set for video ads, so the script can be transcribed later. */
          videoId: v.optional(v.string()),
          /**
           * The script of the video, read off the video itself — spoken
           * voiceover where there is one, on-screen text where there is not.
           * Roughly half of Mahara's video ads are silent text-on-screen, so
           * audio transcription alone would have missed them. This is the part
           * that actually transfers between clients: a hook that works in
           * Riyadh interior design will work in Manama interior design.
           */
          transcript: v.optional(v.string()),
          /** The opening line — the hook, isolated for comparison. */
          hook: v.optional(v.string()),
          /** voiceover | text on screen | both | silent */
          voice: v.optional(v.string()),
          /** Meta's rendered preview iframe — the ad itself, watchable. */
          previewSrc: v.optional(v.string()),
          /** Still image fallback, which loads instantly in a list. */
          thumbUrl: v.optional(v.string()),
          spend: v.number(),
          leads: v.number(),
          cpl: v.optional(v.number()),
        }),
      ),
    ),
    windowDays: v.number(),
    syncedAt: v.number(),
  })
    .index("by_adset", ["adsetId"])
    .index("by_service", ["serviceLine"]),

  /**
   * Winning ads, kept forever.
   *
   * `marketPlays` only holds what Meta still reports in the collector window,
   * so a winner that gets switched off eventually disappears from it — losing
   * the copy, the script and the preview of the best ads we have ever run.
   * This table is the permanent record: written every collector pass, never
   * deleted, and it carries the window in which the ad was actually winning
   * (`wonFrom`/`wonTo`, read off the daily grain) plus whether it is still
   * live today. [aziz, 2026-09-07]
   */
  winnersArchive: defineTable({
    adId: v.string(),
    adName: v.string(),
    client: v.string(),
    serviceLine: v.optional(v.string()),
    city: v.optional(v.string()),
    country: v.optional(v.string()),
    language: v.optional(v.string()),
    format: v.string(),
    cta: v.optional(v.string()),
    headline: v.optional(v.string()),
    body: v.optional(v.string()),
    transcript: v.optional(v.string()),
    hook: v.optional(v.string()),
    voice: v.optional(v.string()),
    previewSrc: v.optional(v.string()),
    thumbUrl: v.optional(v.string()),
    playType: v.optional(v.string()),
    interests: v.optional(v.array(v.string())),
    copyTraits: v.optional(v.array(v.string())),
    adsetName: v.optional(v.string()),
    campaignName: v.optional(v.string()),
    /** Best numbers ever recorded for this ad in a collector window. */
    spend: v.number(),
    leads: v.number(),
    cpl: v.number(),
    /** The window it won in, from the daily grain where we have it. */
    wonFrom: v.optional(v.string()),
    wonTo: v.optional(v.string()),
    /** First and last time this ad qualified as a winner. */
    firstArchivedAt: v.number(),
    lastSeenAt: v.number(),
    /** Still running in Meta as of the last sync. */
    stillLive: v.optional(v.boolean()),
    retiredOn: v.optional(v.string()),
  })
    .index("by_ad", ["adId"])
    .index("by_service", ["serviceLine"])
    .index("by_cpl", ["cpl"]),

  onboardings: defineTable({
    taskId: v.string(),
    taskUrl: v.optional(v.string()),
    client: v.string(),
    status: v.string(),
    /** Absent when Client Data has no numeric Meta account id for them. */
    accountId: v.optional(v.string()),
    /** The ad account NAME from Client Data, which is what the sheet holds. */
    accountName: v.optional(v.string()),
    /** sheet | meta — where the id above came from, so a wrong one is traceable. */
    accountIdSource: v.optional(v.string()),
    groups: v.array(
      v.object({
        name: v.string(),
        items: v.array(v.object({ name: v.string(), done: v.boolean() })),
      }),
    ),
    syncedAt: v.number(),
  }).index("by_task", ["taskId"]),

  /**
   * Tracking faults found on live ads.
   *
   * A lead with no UTM cannot be attributed to the ad that produced it, so the
   * cost per lead on that ad is fiction. This is checked against Meta directly.
   */
  /**
   * Every client the sheet says is Launching, checked against reality on every
   * sync: does a launch task exist, does their ad account resolve in Meta, has
   * it spent yet, and is the sheet status now stale. A launch used to stall
   * silently because nothing compared the three systems. [aziz, 2026-09-07]
   */
  launchWatch: defineTable({
    client: v.string(),
    sheetStatus: v.string(),
    accountName: v.optional(v.string()),
    accountId: v.optional(v.string()),
    hasTask: v.boolean(),
    taskUrl: v.optional(v.string()),
    spend7d: v.number(),
    issues: v.array(v.string()),
    syncedAt: v.number(),
  }).index("by_client", ["client"]),

  /**
   * Work handed to Viktor from inside the cockpit: copy to write, a creative
   * to pull off Drive and load into Meta, or a whole launch to set up.
   *
   * The space cannot call an AI model itself — that path goes through the
   * Viktor tool gateway and is the one dependency that has actually gone down
   * on us. A request row survives that: it queues, Viktor's worker picks it up
   * out of band, and the answer lands back in the same panel. [aziz, 2026-09-07]
   */
  assistRequests: defineTable({
    /** copy | creative | launch */
    kind: v.string(),
    campaignName: v.optional(v.string()),
    client: v.optional(v.string()),
    /** What she typed: the brief, the offer, what she wants done. */
    brief: v.optional(v.string()),
    language: v.optional(v.string()),
    /** Google Drive links to creatives — no uploads, she pastes a link. */
    driveLinks: v.optional(v.array(v.string())),
    /** queued -> working -> ready | failed */
    status: v.string(),
    requestedBy: v.optional(v.string()),
    requestedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    /** Copy options, ready to drop into the ad builder. */
    variants: v.optional(
      v.array(
        v.object({
          headline: v.string(),
          message: v.string(),
          description: v.optional(v.string()),
          angle: v.optional(v.string()),
        }),
      ),
    ),
    /** Creatives resolved from Drive and uploaded into the ad account. */
    media: v.optional(
      v.array(
        v.object({
          name: v.string(),
          link: v.string(),
          kind: v.optional(v.string()),
          imageHash: v.optional(v.string()),
          videoId: v.optional(v.string()),
          thumbUrl: v.optional(v.string()),
          error: v.optional(v.string()),
        }),
      ),
    ),
    /** Viktor writing back in plain words: what he did, what he still needs. */
    note: v.optional(v.string()),
    /** Steps done / still open, for the launch checklist. */
    steps: v.optional(
      v.array(
        v.object({
          label: v.string(),
          state: v.string(),
          detail: v.optional(v.string()),
        }),
      ),
    ),
    error: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_campaign", ["campaignName"])
    .index("by_client", ["client"]),

  trackingIssues: defineTable({
    client: v.string(),
    accountId: v.string(),
    adId: v.string(),
    adName: v.string(),
    issue: v.string(),
    detail: v.optional(v.string()),
    foundAt: v.number(),
  }).index("by_client", ["client"]),

  campaignDrafts: defineTable({
    clientTag: v.string(),
    clientName: v.string(),
    accountId: v.string(),
    kind: v.union(v.literal("campaign"), v.literal("refresh")),
    brief: v.string(),
    /** Set when the service line isn't one of ours — she types what they sell. */
    serviceOther: v.optional(v.string()),
    /** Brand DNA / offer creation cheat sheet, pasted or linked, as build input. */
    contextDocs: v.optional(v.string()),
    creativeLinks: v.array(v.string()),
    dailyBudget: v.number(),
    language: v.string(),
    /** The ad set we copied settings from — targeting, placements, pixel, lead form. */
    sourceAdSetId: v.optional(v.string()),
    sourceAdSetName: v.optional(v.string()),
    sourceReason: v.optional(v.string()),
    targeting: v.optional(v.any()),
    optimizationGoal: v.optional(v.string()),
    billingEvent: v.optional(v.string()),
    promotedObject: v.optional(v.any()),
    /** Headline + body pairs she can edit before launch. */
    variants: v.array(
      v.object({
        headline: v.string(),
        primaryText: v.string(),
        description: v.optional(v.string()),
        approved: v.optional(v.boolean()),
      }),
    ),
    status: v.union(
      v.literal("building"),
      v.literal("ready"),
      v.literal("launching"),
      v.literal("launched"),
      v.literal("failed"),
    ),
    note: v.optional(v.string()),
    error: v.optional(v.string()),
    metaCampaignId: v.optional(v.string()),
    metaAdSetId: v.optional(v.string()),
    metaAdIds: v.optional(v.array(v.string())),
    clickupCommented: v.optional(v.boolean()),
    by: v.string(),
    at: v.number(),
    launchedAt: v.optional(v.number()),
  })
    .index("by_client", ["clientTag"])
    .index("by_status", ["status"]),

  /** "Something's wrong with this screen" — reported from the cockpit itself. */
  feedback: defineTable({
    role: v.string(),
    page: v.string(),
    text: v.string(),
    email: v.optional(v.string()),
    day: v.string(),
    clickupTaskUrl: v.optional(v.string()),
    /** Chat box messages are forwarded to Viktor in Slack and answered there. */
    delivered: v.optional(v.boolean()),
    reply: v.optional(v.string()),
    replyAt: v.optional(v.number()),
    at: v.number(),
  })
    .index("by_at", ["at"])
    .index("by_role", ["role"]),

  usage: defineTable({
    email: v.optional(v.string()),
    role: v.string(),
    event: v.string(),
    detail: v.optional(v.string()),
    at: v.number(),
  }).index("by_at", ["at"]),

  // Raw HTTP bodies fetched by Viktor's bridge and pushed in, so the CSM snapshot can be
  // built without calling the Space tool gateway (which returns HTTP 500 platform-side).
  // Chunked because Convex args come through argv, which caps at ~128KB per string.
  /**
   * Work that needs a model, handed to the outside "Ask AI" worker (Hermes)
   * through the /askai HTTP door. One row per question; the answer is applied
   * to the row it belongs to (assist request, campaign draft) on completion.
   */
  aiJobs: defineTable({
    /** assist_copy | draft_copy */
    kind: v.string(),
    /** The row the answer belongs to. */
    refId: v.string(),
    prompt: v.string(),
    /** JSON schema the answer must match. */
    schema: v.any(),
    /** queued -> done | failed */
    status: v.string(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    tries: v.number(),
    createdAt: v.number(),
    claimedAt: v.optional(v.number()),
    doneAt: v.optional(v.number()),
  }).index("by_status", ["status"]),
  rawFetch: defineTable({
    url: v.string(),
    part: v.number(),
    text: v.string(),
    at: v.number(),
  }).index("by_url", ["url", "part"]),

  syncRuns: defineTable({
    at: v.number(),
    ok: v.boolean(),
    role: v.optional(v.string()),
    campaigns: v.number(),
    ads: v.number(),
    offBoard: v.number(),
    message: v.optional(v.string()),
    /** Coverage counters + the invariants that failed, so a silent
     *  degradation shows up on the dashboard instead of waiting to be noticed. */
    health: v.optional(v.any()),
    problems: v.optional(v.array(v.string())),
  }).index("by_at", ["at"]),
  /**
   * Recorded calls that mention a client, kept here so they survive profile
   * rebuilds. Filled from the Fathom API when FATHOM_API_KEY is set and from
   * one-off backfills when it is not. Upserted on (clientName, url).
   */
  fathomCache: defineTable({
    clientName: v.string(),
    title: v.string(),
    at: v.string(),
    url: v.string(),
    host: v.optional(v.string()),
    summary: v.optional(v.string()),
    /** "client" = a call with the client; "mention" = a team meeting that discussed them. */
    kind: v.string(),
    source: v.string(),
    addedAt: v.number(),
  }).index("by_client", ["clientName"]),
  /** Smoke-check failures already sent to Slack, so a broken screen is reported once, not every 15 minutes. */
  /**
   * Campaigns spending on an ad account with no card on the Ads Management
   * board. Replaced every sync; the media buyer adds a card from the cockpit.
   */
  offBoardCampaigns: defineTable({
    campaignName: v.string(),
    accountName: v.string(),
    accountId: v.optional(v.string()),
    clientName: v.optional(v.string()),
    spend7d: v.number(),
    leads7d: v.number(),
    syncedAt: v.number(),
  }).index("by_campaign", ["campaignName"]),
  /**
   * Comments on client cards (Clients - Mahara) the comment watch has read, and
   * the Hermes digest of the ones worth reading. See commentWatch.ts.
   */
  clientComments: defineTable({
    taskId: v.string(),
    clientName: v.string(),
    commentId: v.string(),
    at: v.number(),
    by: v.optional(v.string()),
    /** call | kickoff | brief | note | skip */
    kind: v.string(),
    /** skipped | queued | done | failed */
    status: v.string(),
    jobId: v.optional(v.id("aiJobs")),
    digest: v.optional(v.any()),
    rulesAdded: v.optional(v.number()),
    appliedAt: v.optional(v.number()),
    syncedAt: v.number(),
  })
    .index("by_comment", ["commentId"])
    .index("by_status", ["status", "at"])
    .index("by_task", ["taskId", "at"]),
  /** Each client's Drive folder, Brand DNA and offer sheet, from the ClickUp client list. */
  clientLinks: defineTable({
    name: v.string(),
    aliases: v.array(v.string()),
    url: v.optional(v.string()),
    driveLink: v.optional(v.string()),
    brandDnaDoc: v.optional(v.string()),
    offerCheatSheet: v.optional(v.string()),
    /** The "Do's & Don'ts" field on the client card, verbatim. */
    dosDonts: v.optional(v.string()),
    syncedAt: v.number(),
  }).index("by_name", ["name"]),
  /** Every card on the Ads Management board, live or not, for the board view. */
  boardCards: defineTable({
    taskId: v.string(),
    name: v.string(),
    url: v.optional(v.string()),
    adStatus: v.optional(v.string()),
    advertisingCities: v.optional(v.array(v.string())),
    tag: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
    syncedAt: v.number(),
  }).index("by_task", ["taskId"]),
  /** Campaigns the media buyer marked "not our campaign": never listed as missing a card again. */
  offBoardDismissals: defineTable({
    campaignName: v.string(),
    by: v.optional(v.string()),
    at: v.number(),
  }).index("by_campaign", ["campaignName"]),
  alerts: defineTable({
    signature: v.string(),
    text: v.string(),
    at: v.number(),
  }).index("by_signature", ["signature"]),
  /** A person's own Google Calendar, shared with the service account. */
  calendarLinks: defineTable({
    owner: v.string(),
    calendarId: v.string(),
    status: v.string(),
    note: v.optional(v.string()),
    events: v.optional(v.number()),
    checkedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_owner", ["owner"]),
  /** Shared client calendars plus every linked personal calendar, a week back and three ahead. */
  calendarEvents: defineTable({
    eventId: v.string(),
    calendarId: v.string(),
    title: v.string(),
    start: v.string(),
    end: v.string(),
    allDay: v.boolean(),
    location: v.optional(v.string()),
    meetLink: v.optional(v.string()),
    attendees: v.array(v.string()),
    description: v.optional(v.string()),
    htmlLink: v.optional(v.string()),
    clientName: v.optional(v.string()),
    owner: v.optional(v.string()),
    kind: v.optional(v.string()),
    syncedAt: v.number(),
  }).index("by_start", ["start"]),
  /**
   * The team directory for the portal: who may open which cockpit and, if
   * limited, which clients they see. Empty `clients` means every client.
   */
  members: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    /** admin | media_buyer | csm | creative */
    roles: v.array(v.string()),
    clients: v.array(v.string()),
    note: v.optional(v.string()),
    addedBy: v.optional(v.string()),
    addedAt: v.number(),
    updatedAt: v.optional(v.number()),
    lastSeenAt: v.optional(v.number()),
    lastCockpit: v.optional(v.string()),
  }).index("by_email", ["email"]),
  /** Who came in through a portal pass (the members table is the source of truth here). */
  portalMembers: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    roles: v.array(v.string()),
    clients: v.array(v.string()),
    at: v.number(),
  }).index("by_email", ["email"]),
  /** One row per outside system: ok, failure streak, last error (see health.ts). */
  sourceHealth: defineTable({
    source: v.string(),
    ok: v.boolean(),
    streak: v.number(),
    at: v.number(),
    lastOkAt: v.optional(v.number()),
    lastFailAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    alertedAt: v.optional(v.number()),
  }).index("by_source", ["source"]),
  /** One row per scheduled job: last run, outcome, failure streak (see health.ts runJob). */
  cronRuns: defineTable({
    job: v.string(),
    ok: v.boolean(),
    at: v.number(),
    ms: v.number(),
    error: v.optional(v.string()),
    streak: v.number(),
    everyMin: v.number(),
  }).index("by_job", ["job"]),
  /** The last smoke check per cockpit, for the admin view. */
  cockpitHealth: defineTable({
    app: v.string(),
    ok: v.boolean(),
    checks: v.array(v.any()),
    at: v.number(),
  }).index("by_app", ["app"]),
  /** The chat with Hermes: one thread per signed-in person. */
  hermesChat: defineTable({
    thread: v.string(),
    role: v.string(),
    text: v.string(),
    clientName: v.optional(v.string()),
    page: v.optional(v.string()),
    context: v.optional(v.string()),
    /** queued → sent → answered | failed (user messages); answered (assistant). */
    status: v.string(),
    error: v.optional(v.string()),
    jobId: v.optional(v.string()),
    at: v.number(),
  }).index("by_thread", ["thread"]),
  /** Chat messages relayed to Hermes and which job carries them. */
  chatRelay: defineTable({
    app: v.string(),
    messageId: v.string(),
    jobId: v.string(),
    at: v.number(),
    readingAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
  }),
  /** Every Meta call Hermes makes through /askai/meta, with its outcome. */
  agentActions: defineTable({
    at: v.number(),
    method: v.string(),
    path: v.string(),
    params: v.optional(v.any()),
    ok: v.boolean(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    jobId: v.optional(v.string()),
    note: v.optional(v.string()),
    campaignName: v.optional(v.string()),
  }),
  /** Hermes's client-focused call briefs, keyed by the set of calls they cover. */
  callBriefs: defineTable({
    clientName: v.string(),
    key: v.string(),
    jobId: v.optional(v.string()),
    status: v.string(),
    overall: v.optional(v.string()),
    perCall: v.optional(v.array(v.any())),
    at: v.number(),
  }),
  /** Google Docs read for prompts (the Client Communication SOP), refreshed daily. */
  docCache: defineTable({
    docId: v.string(),
    title: v.optional(v.string()),
    text: v.string(),
    at: v.number(),
  }).index("by_doc", ["docId"]),
  /** Hermes's recommended WhatsApp replies, one per thread per last message. */
  replyDrafts: defineTable({
    chatId: v.string(),
    lastAt: v.number(),
    jobId: v.optional(v.string()),
    status: v.string(),
    draft: v.optional(v.string()),
    at: v.number(),
  }).index("by_chat", ["chatId"]),
});

export default schema;
