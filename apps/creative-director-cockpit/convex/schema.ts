import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const schema = defineSchema({
  ...authTables,

  /** The creative director's task board (Media/Creative). */
  creativeTasks: defineTable({
    taskId: v.string(),
    name: v.string(),
    url: v.optional(v.string()),
    status: v.string(),
    /** brandDNA | script | onboarding | website | other */
    kind: v.string(),
    /** Resolved from ClickUp TAGS first, title only as a fallback. */
    client: v.optional(v.string()),
    /** Every client on the task: one script request can serve several. */
    clients: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    /** Verbatim Client Status of the client, for live vs hygiene splitting. */
    clientStatus: v.optional(v.string()),
    parentId: v.optional(v.string()),
    assignees: v.array(v.string()),
    dueDate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    notes: v.optional(v.string()),
    syncedAt: v.number(),
  }).index("by_task", ["taskId"]),

  /** Video Pipeline — what the editors owe and when. */
  videoJobs: defineTable({
    taskId: v.string(),
    name: v.string(),
    /** Resolved from ClickUp TAGS. */
    client: v.optional(v.string()),
    clients: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    clientStatus: v.optional(v.string()),
    url: v.optional(v.string()),
    status: v.string(),
    editors: v.array(v.string()),
    dueDate: v.optional(v.number()),
    createdAt: v.number(),
    editedLink: v.optional(v.string()),
    rawLink: v.optional(v.string()),
    syncedAt: v.number(),
  }).index("by_task", ["taskId"]),

  /** Content Calendar — planned social posts per client. */
  contentPosts: defineTable({
    taskId: v.string(),
    name: v.string(),
    url: v.optional(v.string()),
    status: v.string(),
    client: v.optional(v.string()),
    publishDate: v.optional(v.number()),
    designers: v.array(v.string()),
    liveLink: v.optional(v.string()),
    designLink: v.optional(v.string()),
    syncedAt: v.number(),
  }).index("by_task", ["taskId"]),

  /**
   * Ad performance, mirrored in by the sync bridge. The creative director needs
   * it only to answer "what do I replace, and what do I make more of" -- this is
   * deliberately a read-only copy, not a second source of truth.
   */
  ads: defineTable({
    campaignName: v.string(),
    adName: v.string(),
    spend: v.number(),
    leads: v.number(),
    cpl: v.optional(v.number()),
    ctr: v.optional(v.number()),
    frequency: v.optional(v.number()),
    thumbnailUrl: v.optional(v.string()),
    previewSrc: v.optional(v.string()),
    metaAdId: v.optional(v.string()),
    syncedAt: v.number(),
  }).index("by_ad", ["campaignName", "adName"]),

  /** Just enough of the campaign to map an ad back to a client name. */
  campaigns: defineTable({
    campaignName: v.string(),
    accountName: v.string(),
    clientName: v.optional(v.string()),
    clientTag: v.optional(v.string()),
    serviceType: v.optional(v.string()),
    spend7d: v.optional(v.number()),
    leads7d: v.optional(v.number()),
    cpl: v.optional(v.number()),
    /** The client's real conversion numbers, same source as the CSM screen. */
    bookings7d: v.optional(v.number()),
    showed7d: v.optional(v.number()),
    costPerBooking: v.optional(v.number()),
    bookingRate: v.optional(v.number()),
    showRate: v.optional(v.number()),
    boardAdStatus: v.optional(v.string()),
    metaAccountId: v.optional(v.string()),
    metaCampaignId: v.optional(v.string()),
    syncedAt: v.number(),
  }).index("by_campaign", ["campaignName"]),

  /** Live Meta structure: what is actually running for a client right now. */
  metaTree: defineTable({
    campaignName: v.string(),
    kind: v.string(),
    metaId: v.string(),
    name: v.string(),
    status: v.optional(v.string()),
    effectiveStatus: v.optional(v.string()),
    adsetId: v.optional(v.string()),
    previewSrc: v.optional(v.string()),
    thumbUrl: v.optional(v.string()),
    syncedAt: v.number(),
  }).index("by_campaign", ["campaignName"]),

  /**
   * Brand Blueprint form submissions, the real signal that creative onboarding
   * is finished. A closed ClickUp task only proves someone ticked a box.
   */
  blueprints: defineTable({
    responseId: v.string(),
    client: v.optional(v.string()),
    submittedAt: v.number(),
    brandDnaStatus: v.optional(v.string()),
    brandDnaDoc: v.optional(v.string()),
    offerSheet: v.optional(v.string()),
    stillMissing: v.optional(v.string()),
    approvalNeeded: v.optional(v.string()),
    editor: v.optional(v.string()),
    launchCallDate: v.optional(v.string()),
    answers: v.optional(v.any()),
    syncedAt: v.number(),
  }).index("by_response", ["responseId"]),

  /**
   * The client roster from ClickUp's Clients - Mahara list. This is the spine:
   * every task, video job and ad resolves to a row here, and it carries the
   * Brand DNA and Offer Cheat Sheet links the creative director works from.
   */
  clients: defineTable({
    taskId: v.string(),
    name: v.string(),
    url: v.optional(v.string()),
    /** Verbatim Client Status from ClickUp. Never derived. */
    clientStatus: v.optional(v.string()),
    happiness: v.optional(v.string()),
    service: v.optional(v.string()),
    consultationTypes: v.array(v.string()),
    /** Lowercased aliases used to match ClickUp tags and Meta campaign names. */
    aliases: v.array(v.string()),
    brandDnaDoc: v.optional(v.string()),
    offerCheatSheet: v.optional(v.string()),
    /** The "Do's & Don'ts" field on the ClickUp client card, verbatim. */
    dosDonts: v.optional(v.string()),
    /** Digests of the newest comments on the client's ClickUp card (call summaries, handoffs, notes). */
    updates: v.optional(v.any()),
    blueprintFormLink: v.optional(v.string()),
    /**
     * Verbatim "Offer Creation" dropdown: Working on it / Done / Stuck. This,
     * not the presence of a cheat sheet link, is the sign-off that the offer
     * work is finished. [aziz, 2026-09-08]
     */
    offerCreationStatus: v.optional(v.string()),
    driveFolder: v.optional(v.string()),
    driveLink: v.optional(v.string()),
    /**
     * What is actually inside the client's Drive folder, scanned by the sync.
     * Aziz, 2026-09-08: every client folder gets a footage folder for the ads
     * we made and a scripts folder for the scripts written for them.
     */
    driveFolderId: v.optional(v.string()),
    driveSubfolders: v.optional(v.array(v.any())),
    driveFootage: v.optional(v.string()),
    driveScripts: v.optional(v.string()),
    driveScannedAt: v.optional(v.number()),
    /**
     * This month off the client's own stat sheet: appointments booked, how many
     * showed, how many got a quotation, how many closed. Raw counts only, the
     * rates are worked out where they are displayed. [aziz, 2026-09-08]
     */
    stats: v.optional(
      v.object({
        tab: v.string(),
        booked: v.number(),
        shows: v.number(),
        quotes: v.number(),
        closes: v.number(),
      }),
    ),
    statsScannedAt: v.optional(v.number()),
    sheetLink: v.optional(v.string()),
    clientHistoryDoc: v.optional(v.string()),
    marketResearchDoc: v.optional(v.string()),
    launchDate: v.optional(v.number()),
    onboardingCallDate: v.optional(v.number()),
    phone: v.optional(v.string()),
    ghlContactId: v.optional(v.string()),
    /** Leads and spend per day from the ads, last 90 days, for the trend charts. */
    daily: v.optional(
      v.array(
        v.object({ date: v.string(), leads: v.number(), spend: v.number() }),
      ),
    ),
    syncedAt: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_name", ["name"]),

  /**
   * Queued write-backs to ClickUp. This Space has no credentials, so the
   * sandbox bridge drains this on each sync and settles the row.
   */
  /**
   * Winning ads, mirrored from the media buyer cockpit.
   *
   * Same rows, same shape, same view he sees, so scripting works off the copy
   * and transcripts that already earned their keep. Read-only here: the media
   * buyer Space owns this data and the sandbox sync copies it across.
   */
  /**
   * Mirrored from the media buyer cockpit, not computed here.
   *
   * Aziz, 2026-09-07: "make the what works section the exact same as the media
   * buyer one." So the creative Space copies the cockpit's marketPlays rows and
   * runs the cockpit's own query file over them. One definition of what works
   * in the company, and the creative director sees exactly what the media buyer
   * sees.
   */
  /**
   * Where a client's leads actually come in: the instant form and its exact
   * questions, the landing page, the WhatsApp thread. Pulled from Meta by the
   * sandbox sync, joined to 30 day spend on Ad ID. He scripts the funnel, so
   * he needs the questions in front of him. [aziz, 2026-09-07]
   */
  funnels: defineTable({
    account: v.string(),
    kind: v.string(),
    url: v.optional(v.string()),
    formId: v.optional(v.string()),
    formName: v.optional(v.string()),
    formStatus: v.optional(v.string()),
    headline: v.optional(v.string()),
    followUpUrl: v.optional(v.string()),
    leadsAllTime: v.optional(v.number()),
    questions: v.array(
      v.object({
        label: v.string(),
        type: v.string(),
        options: v.array(v.string()),
        isGate: v.boolean(),
      }),
    ),
    gates: v.number(),
    spend: v.number(),
    leads: v.number(),
    cpl: v.optional(v.number()),
    ads: v.array(
      v.object({ adId: v.string(), adName: v.string(), status: v.string() }),
    ),
    syncedAt: v.number(),
  }).index("by_account", ["account"]),

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

  winnersArchive: defineTable({
    adId: v.string(),
    adName: v.string(),
    client: v.string(),
    serviceLine: v.optional(v.string()),
    city: v.optional(v.string()),
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
    spend: v.number(),
    leads: v.number(),
    cpl: v.number(),
    wonFrom: v.optional(v.string()),
    wonTo: v.optional(v.string()),
    stillLive: v.optional(v.boolean()),
    retiredOn: v.optional(v.string()),
    syncedAt: v.number(),
  })
    .index("by_ad", ["adId"])
    .index("by_service", ["serviceLine"]),

  creativeOutbox: defineTable({
    /** comment | complete | videoRequest */
    kind: v.string(),
    taskId: v.optional(v.string()),
    payload: v.any(),
    /** pending | sending | done | failed (failed only after the last retry) */
    state: v.string(),
    result: v.optional(v.string()),
    /** Who queued it (email), so the drain can log who sent what. */
    by: v.optional(v.string()),
    createdAt: v.number(),
    settledAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
    attempts: v.optional(v.number()),
    nextTryAt: v.optional(v.number()),
  }).index("by_state", ["state"]),

  /** Staging for large sync payloads, drained by sync:storeCreative. */
  syncInput: defineTable({
    kind: v.string(),
    chunk: v.number(),
    payload: v.string(),
    createdAt: v.number(),
  }).index("by_kind", ["kind"]),

  /**
   * The day structure, mirroring the media buyer's cockpit: a checklist for the
   * start of day and the middle-of-day sweep, the plan he writes for tomorrow,
   * his EOD report, and a log of the client touchpoints he actually made.
   */
  checks: defineTable({
    day: v.string(),
    key: v.string(),
    label: v.string(),
    detail: v.optional(v.string()),
    /** "sod" = clear the decks first, "mid" = the production work itself. */
    phase: v.optional(v.string()),
    order: v.optional(v.number()),
    href: v.optional(v.string()),
    done: v.boolean(),
    doneAt: v.optional(v.number()),
  }).index("by_day", ["day"]),

  planItems: defineTable({
    day: v.string(),
    text: v.string(),
    reason: v.optional(v.string()),
    clientName: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_day", ["day"]),

  eodReports: defineTable({
    day: v.string(),
    email: v.optional(v.string()),
    energy: v.optional(v.string()),
    stress: v.optional(v.string()),
    computed: v.any(),
    answers: v.any(),
    at: v.number(),
  }).index("by_day", ["day"]),

  /** One row per touchpoint he sent, so the cockpit stops nagging about it. */
  touchLog: defineTable({
    day: v.string(),
    client: v.string(),
    kind: v.string(),
    note: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_day", ["day"])
    .index("by_client", ["client"]),

  /** Per-user role, so this Space only ever serves the creative director. */
  roles: defineTable({
    email: v.string(),
    role: v.string(),
  }).index("by_email", ["email"]),
  /** Calendar events for this role, a week back and three weeks ahead. */
  /** What the portal said about this person at their last sign-in through it. */
  portalMembers: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    roles: v.array(v.string()),
    clients: v.array(v.string()),
    at: v.number(),
    /** Removed in the portal: the row stays with no roles so the fallback cannot readmit them. */
    revokedAt: v.optional(v.number()),
  }).index("by_email", ["email"]),
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
    /** Set on a person's own calendar events; shared client calendars have none. */
    owner: v.optional(v.string()),
    /** client | team | other */
    kind: v.optional(v.string()),
    syncedAt: v.number(),
  }).index("by_start", ["start"]),
  /** A person's own Google Calendar, shared with the cockpit's service account. */
  calendarLinks: defineTable({
    owner: v.string(),
    calendarId: v.string(),
    status: v.string(),
    note: v.optional(v.string()),
    events: v.optional(v.number()),
    checkedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_owner", ["owner"]),
  /** WhatsApp threads on this role's business number: groups and private chats. */
  waThreads: defineTable({
    chatId: v.string(),
    name: v.string(),
    isGroup: v.boolean(),
    clientName: v.optional(v.string()),
    lastAt: v.optional(v.number()),
    lastFromUs: v.optional(v.boolean()),
    waitingSince: v.optional(v.number()),
    silentDays: v.optional(v.number()),
    unread: v.optional(v.number()),
    /** ghl | whapi, and the GHL contact to reply to. */
    source: v.optional(v.string()),
    contactId: v.optional(v.string()),
    /** whatsapp | sms: the CRM sends the reply on the same channel. */
    channel: v.optional(v.string()),
    /** Hermes's recommended reply for the latest client message. */
    draft: v.optional(v.string()),
    draftAt: v.optional(v.number()),
    repliedAt: v.optional(v.number()),
    /** A reply is on its way; cleared when it lands or fails. */
    sendingAt: v.optional(v.number()),
    sendError: v.optional(v.string()),
    recent: v.array(v.any()),
    error: v.optional(v.string()),
    syncedAt: v.number(),
  }).index("by_lastAt", ["lastAt"]),
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
});

export default schema;
