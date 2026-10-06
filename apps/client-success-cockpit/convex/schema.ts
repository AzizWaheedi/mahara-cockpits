import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const schema = defineSchema({
  ...authTables,

  // Durable booking receipts prevent a double click or uncertain provider response
  // from creating another invitation. Unknown attempts require reconciliation.
  checkInBookings: defineTable({
    key: v.string(),
    taskId: v.string(),
    clientName: v.string(),
    contactId: v.string(),
    startTime: v.string(),
    userId: v.id("users"),
    status: v.string(),
    appointmentId: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

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
    // Next booked call from the client GHL calendars, ISO with the Kuwait offset.
    nextCallAt: v.optional(v.string()),
    nextCallKind: v.optional(v.string()),
    launchDate: v.optional(v.string()),
    liveDays: v.optional(v.number()),
    paymentDate: v.optional(v.string()),
    paymentDue: v.optional(v.number()),
    extendedUntil: v.optional(v.string()),
    happiness: v.optional(v.string()),
    commsLevel: v.optional(v.string()),
    contract: v.optional(v.string()),
    sheetLink: v.optional(v.string()),
    // True when the sheet came from the DATABASE - MAHARA tab, not the ClickUp field.
    sheetFromDatabase: v.optional(v.boolean()),
    // "DFY" or "DWY" from ClickUp's Service field. DWY clients book their own
    // appointments, so cost per lead is the only outcome we own for them.
    service: v.optional(v.string()),
    dwy: v.optional(v.boolean()),
    // Monthly client report, from the ClickUp "Last report sent" field. `reportTracked`
    // is false while that field does not exist, so the UI can say "unknown" instead of
    // wrongly claiming no report was ever sent.
    lastReport: v.optional(v.string()),
    reportDays: v.optional(v.number()),
    reportTracked: v.optional(v.boolean()),
    reportDue: v.optional(v.boolean()),
    /**
     * The contract's end, from the ClickUp "Contract end date" field (a Date
     * field on Clients - Mahara, resolved by name). `renewalTracked` is false
     * while that field does not exist, so the renewal window can say "unknown"
     * instead of pretending nobody renews. Never worked out from the signup.
     */
    renewalDate: v.optional(v.string()),
    renewalTracked: v.optional(v.boolean()),
    /** The media buyer's first-win rule (Active and live 14 days), sent with the row. */
    firstWin: v.optional(v.boolean()),
    silentDays: v.optional(v.number()),
    /** Days since the client record was created: day 0 of the onboarding spine. */
    signupDays: v.optional(v.number()),
    callDays: v.optional(v.number()),
    todo: v.string(),
    level: v.string(),
    rank: v.number(),
    hot: v.array(v.object({ kind: v.string(), why: v.string() })),
    pausedSince: v.optional(v.string()),
    pausedDays: v.optional(v.number()),
    loose: v.array(v.string()),
    changes: v.array(v.any()),
    /**
     * What the team did for this client this week (media buyer fanout.ts,
     * weekOfWork): ad changes a client can be told, how the campaign is
     * doing, videos finished / with the client / being made, and Client
     * Success board tasks finished. Feeds "What we did this week".
     */
    work: v.optional(v.any()),
    campaignLinks: v.optional(v.array(v.any())),
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
  })
    .index("by_rank", ["rank"])
    // Rows are replaced on every sync, so the ClickUp id is the stable handle.
    .index("by_taskId", ["taskId"]),

  /**
   * Her per-client choices that must survive a sync: which language she writes to
   * this client in, and the state of each hot-list opportunity. Keyed by name/opportunity
   * key rather than document id, because the client rows are replaced on every sync.
   */
  /**
   * One row per client: the numbers off their own performance sheet, the appointments
   * nobody updated, their live Meta structure, and every link the CSM needs. Written
   * whole by the bridge on each sync — never edited in the app, so it is always the
   * source's answer, not ours.
   */
  clientProfiles: defineTable({
    clientName: v.string(),
    taskId: v.optional(v.string()),
    links: v.any(),
    ghlName: v.optional(v.string()),
    service: v.optional(v.string()),
    adsPlatform: v.optional(v.string()),
    profileText: v.optional(v.string()),
    /** The "Do's & Don'ts" field on the ClickUp client card, verbatim. */
    dosDonts: v.optional(v.string()),
    /** Digests of the newest comments on the client's ClickUp card (call summaries, handoffs, notes). */
    updates: v.optional(v.any()),
    stage: v.optional(v.string()),
    happiness: v.optional(v.string()),
    launchDate: v.optional(v.string()),
    liveDays: v.optional(v.number()),
    performance: v.optional(v.any()),
    /**
     * Campaigns, then ad sets, then ads. Each ad carries name, status, metaId,
     * accountId and, when the media buyer has one, stillKey, stillUrl,
     * stillTinyUrl and thumbUrl. Preview links are no longer stored: they are
     * fetched from the media buyer when someone opens an ad.
     */
    ads: v.optional(v.array(v.any())),
    adsAccess: v.optional(v.string()),
    live: v.optional(v.any()),
    /** Lost leads read from the client's own GHL sub-account: reason, notes, source ad. */
    lost: v.optional(v.any()),
    // This week's report reminder waiting on the CSM's approval in #csm-general.
    reportNudge: v.optional(v.any()),
    /** Recent recorded calls with this client (Fathom), newest first. */
    calls: v.optional(v.any()),
    /** Leads from Meta per month, the number the client is judged on. */
    adLeads: v.optional(v.any()),
    /** Provisionally booked appointments from the sub-account's "Not Confirmed" calendar. */
    provisional: v.optional(v.any()),
    /** One paragraph from Hermes on where things stand with this client across recorded calls. */
    callsBrief: v.optional(v.string()),
    /** What is missing for this client and where to put it, computed by the media buyer backend. */
    gaps: v.optional(v.array(v.any())),
    syncedAt: v.number(),
    /**
     * Which sync wrote this row. A push happens in batches, so the old set is only deleted
     * once the new one is fully in (`commitProfiles`). Clearing first cost the CSM 28 of 46
     * clients when a mid-push failure left the table truncated. [2026-09-07]
     */
    syncId: v.optional(v.string()),
  })
    .index("by_client", ["clientName"])
    .index("by_syncId", ["syncId"]),

  /**
   * This cockpit's own copy of each saved ad still, so pictures keep showing
   * while the media buyer's backend is down. Copied once from the media
   * buyer's file storage through the bridge (storeStills), in the order the
   * media buyer saved them. `settled` rows (copied, or failed three times)
   * move the watermark: the media buyer sends everything saved after the
   * highest settled sourceSavedAt.
   */
  adStills: defineTable({
    key: v.string(),
    status: v.union(v.literal("copied"), v.literal("failed")),
    storageId: v.optional(v.id("_storage")),
    url: v.optional(v.string()),
    tinyStorageId: v.optional(v.id("_storage")),
    tinyUrl: v.optional(v.string()),
    /** The media buyer's savedAt for this still. */
    sourceSavedAt: v.number(),
    /** The media buyer's copy it came from. */
    sourceUrl: v.optional(v.string()),
    settled: v.boolean(),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    copiedAt: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_settled", ["settled", "sourceSavedAt"]),

  /**
   * Report documents and questions the CSM asked, both drained by Viktor's bridge.
   *
   * The app cannot reach Google or an LLM itself (the in-app tool gateway returns 500),
   * so a request is written here, Viktor's scheduled job performs it, and the answer or
   * the document link is written back. The UI always shows which state a row is in — it
   * never pretends a document exists before it does.
   */
  reportDocs: defineTable({
    clientName: v.string(),
    month: v.string(),
    language: v.optional(v.string()),
    note: v.optional(v.string()),
    /** Optional sections the CSM ticked on top of the standard template. */
    extras: v.optional(v.array(v.string())),
    requestedBy: v.string(),
    requestedAt: v.number(),
    docUrl: v.optional(v.string()),
    builtAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_client", ["clientName"])
    .index("by_builtAt", ["builtAt"]),

  asks: defineTable({
    clientName: v.optional(v.string()),
    question: v.string(),
    askedBy: v.string(),
    askedAt: v.number(),
    answer: v.optional(v.string()),
    answeredAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_askedAt", ["askedAt"])
    .index("by_answeredAt", ["answeredAt"]),

  /**
   * Loose ends the CSM has consciously written off.
   *
   * The board carried 48 of them from a period with no system, which buries the ones that
   * matter. Clearing is allowed — except anything about money: an unpaid invoice or an
   * unfiled pause is not a housekeeping item and can never be dismissed.
   */
  looseDismissed: defineTable({
    key: v.string(), // `${clientName}|${text}`
    clientName: v.string(),
    text: v.string(),
    at: v.number(),
    by: v.optional(v.string()),
  }).index("by_key", ["key"]),

  clientPrefs: defineTable({
    clientName: v.string(),
    language: v.optional(v.string()), // en | ar
  }).index("by_client", ["clientName"]),

  // Client calls booked in Mahara's client-facing GHL sub-account. This is the record of
  // what the CSM actually has today and when the next call with a client is, so nobody has
  // to report their own schedule.
  appointments: defineTable({
    apptId: v.string(),
    calendar: v.string(),
    title: v.string(),
    kind: v.string(), // welcome | onboarding | blueprint | launch | checkin | other
    startTime: v.string(), // ISO with Kuwait offset, as GHL returns it
    day: v.string(), // YYYY-MM-DD in Kuwait
    status: v.string(),
    contactName: v.optional(v.string()),
    clientName: v.optional(v.string()), // matched ClickUp client, when we are sure
    joinUrl: v.optional(v.string()),
  })
    .index("by_day", ["day"])
    .index("by_client", ["clientName"])
    .index("by_apptId", ["apptId"]),

  hotList: defineTable({
    key: v.string(), // `${taskId}:${kind}`
    clientName: v.string(),
    type: v.string(),
    leadType: v.optional(v.string()), // Hot | Warm | On Hold
    status: v.optional(v.string()),
    lastObjection: v.optional(v.string()),
    contactUrl: v.optional(v.string()),
    amount: v.optional(v.string()),
    /** Rows the CSM added by hand, and rows he deleted, both stay his. */
    manual: v.optional(v.boolean()),
    hidden: v.optional(v.boolean()),
    lastFu: v.optional(v.string()),
    nextFu: v.optional(v.string()),
    notes: v.optional(v.string()),
    /** When this row's win was announced to the team, so it is announced once. */
    celebratedAt: v.optional(v.number()),
    at: v.number(),
  }).index("by_key", ["key"]),

  /**
   * Churn and revenue KPIs lifted from the Churn Tracker sheet. The app never
   * invents churn: it shows his number, the month it belongs to, and where it came from.
   */
  kpi: defineTable({
    key: v.string(),
    month: v.optional(v.string()),
    label: v.string(),
    value: v.optional(v.string()),
    numeric: v.optional(v.number()),
    source: v.string(),
    note: v.optional(v.string()),
    at: v.number(),
  }).index("by_key", ["key"]),

  /**
   * The churn engine I own, instead of a hand-filled sheet.
   *
   * `rosterDays` is one row per day: exactly which clients existed and what state each
   * was in. `churnEvents` is written when a client first crosses out of a paying state,
   * so churn becomes a list of named clients with dates — auditable, not a formula in a
   * cell somebody forgot to fill.
   */
  rosterDays: defineTable({
    day: v.string(), // YYYY-MM-DD, Kuwait
    month: v.string(), // YYYY-MM
    clients: v.array(
      v.object({
        key: v.string(),
        name: v.string(),
        status: v.string(),
        paying: v.boolean(),
      }),
    ),
    paying: v.number(),
    total: v.number(),
    at: v.number(),
  })
    .index("by_day", ["day"])
    .index("by_month", ["month"]),

  churnEvents: defineTable({
    day: v.string(),
    month: v.string(),
    key: v.string(),
    name: v.string(),
    from: v.string(),
    to: v.string(),
    /** lost = counts against churn · regained = came back · new = joined mid-month */
    kind: v.string(),
    at: v.number(),
  })
    .index("by_month", ["month"])
    .index("by_key", ["key"]),

  /** The CSM's own income plan — his target and what he has closed this month. */
  moneyGoals: defineTable({
    month: v.string(),
    byEmail: v.string(),
    target: v.optional(v.number()),
    clients: v.optional(v.number()),
    counts: v.optional(v.any()),
    at: v.number(),
  }).index("by_month_email", ["month", "byEmail"]),

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

  checks: defineTable({
    role: v.string(),
    day: v.string(),
    key: v.string(),
    // Which part of the day this belongs to: sprint_am | work_am | sprint_midday |
    // work_pm | sprint_pm. The screen groups by it so the three WhatsApp sprints stay
    // visually separate from the work between them.
    block: v.optional(v.string()),
    label: v.string(),
    detail: v.optional(v.string()),
    done: v.boolean(),
    doneAt: v.optional(v.number()),
  }).index("by_role_day", ["role", "day"]),

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

  eodReports: defineTable({
    role: v.string(),
    day: v.string(),
    email: v.optional(v.string()),
    energy: v.optional(v.string()),
    stress: v.optional(v.string()),
    computed: v.any(),
    answers: v.any(),
    at: v.number(),
    /** Set once the bridge has pushed this EOD to the sheet and the EOD channel. */
    exportedAt: v.optional(v.number()),
    exportError: v.optional(v.string()),
  })
    .index("by_role_day", ["role", "day"])
    .index("by_exportedAt", ["exportedAt"]),

  feedback: defineTable({
    role: v.string(),
    page: v.string(),
    text: v.string(),
    email: v.optional(v.string()),
    day: v.string(),
    clickupTaskUrl: v.optional(v.string()),
    at: v.number(),
  }).index("by_at", ["at"]),

  /**
   * Writebacks waiting to reach ClickUp. The app records intent here; a scheduled
   * Viktor job drains it. Means a broken connection delays a write, never loses one.
   */
  outbox: defineTable({
    kind: v.string(),
    clientTaskId: v.string(),
    clientName: v.string(),
    action: v.string(),
    evidence: v.string(),
    note: v.optional(v.string()),
    snooze: v.optional(v.string()),
    value: v.optional(v.string()),
    department: v.optional(v.string()),
    /** ClickUp due date, ms since epoch. */
    due: v.optional(v.number()),
    decisionId: v.optional(v.id("decisions")),
    planItemId: v.optional(v.id("planItems")),
    feedbackId: v.optional(v.id("feedback")),
    sentAt: v.optional(v.number()),
    error: v.optional(v.string()),
    resultUrl: v.optional(v.string()),
    createdAt: v.number(),
    /** Claimed by a drain; a claim older than ten minutes is up for grabs again. */
    claimedAt: v.optional(v.number()),
    attempts: v.optional(v.number()),
    nextTryAt: v.optional(v.number()),
    /** Five failures: no more retries, the error stays for a person to read. */
    gaveUpAt: v.optional(v.number()),
  }).index("by_sentAt", ["sentAt"]),

  usage: defineTable({
    email: v.optional(v.string()),
    role: v.string(),
    event: v.string(),
    detail: v.optional(v.string()),
    at: v.number(),
  }).index("by_at", ["at"]),

  syncRuns: defineTable({
    at: v.number(),
    ok: v.boolean(),
    role: v.optional(v.string()),
    campaigns: v.number(),
    ads: v.number(),
    offBoard: v.number(),
    message: v.optional(v.string()),
    // Set by the bridge at the end of every run so the app can tell the CSM the truth
    // when a feed breaks, instead of quietly showing yesterday's numbers.
    kind: v.optional(v.string()),
    profiles: v.optional(v.number()),
    errors: v.optional(v.array(v.string())),
  })
    .index("by_at", ["at"])
    .index("by_kind_at", ["kind", "at"]),
  /** Calendar events for this role, a week back and three weeks ahead. */
  /** What the portal said about this person at their last sign-in through it. */
  portalMembers: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    roles: v.array(v.string()),
    clients: v.array(v.string()),
    /**
     * The portal's own CEO flag, carried in its signed pass. Never written
     * from a member list or a role: only a pass the portal signed sets it.
     */
    isCeo: v.optional(v.boolean()),
    at: v.number(),
    /** Removed in the portal: the row stays, with no roles, so the static allowlist cannot let them back in. */
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
  /**
   * The week's projection per metric: blood (the floor) and stretch, set by
   * the CSM for a Kuwait week that starts on Sunday. `actual` is only ever a
   * number typed in by hand for a metric whose source cannot answer; the
   * screen fills the actual from the source whenever it can, and never
   * writes a zero for a missing one. One row per week, person and metric.
   */
  projections: defineTable({
    weekStart: v.string(),
    byEmail: v.string(),
    metric: v.string(), // resell | renewal | cash | review | referral
    blood: v.number(),
    stretch: v.number(),
    actual: v.optional(v.number()),
    missReason: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_week_email_metric", ["weekStart", "byEmail", "metric"])
    .index("by_week", ["weekStart"]),

  /**
   * One client's renewal, planned: where they are, the angle, the objection
   * and its answer, the offer, the proactive call and the outcome. One row
   * per client per renewal date, kept for good: rows are never deleted, so
   * last cycle's plan and its recording stay in the gold-standard library.
   */
  renewalPlans: defineTable({
    taskId: v.string(),
    clientName: v.string(),
    renewalDate: v.string(),
    onboardedOn: v.optional(v.string()),
    /** What the client has paid so far, from the billing ledger when it can say. */
    paidAmount: v.optional(v.number()),
    paidSource: v.optional(v.string()),
    likelihood: v.optional(v.string()), // high | medium | low
    /** Prefilled from the sources, one fact per line with where it came from. */
    whereTheyAre: v.optional(
      v.array(
        v.object({ label: v.string(), value: v.string(), source: v.string() }),
      ),
    ),
    angle: v.optional(v.string()),
    objection: v.optional(v.string()),
    objectionAnswer: v.optional(v.string()),
    offer: v.optional(
      v.object({
        price: v.optional(v.number()),
        deliverables: v.optional(v.string()),
        durationMonths: v.optional(v.number()),
      }),
    ),
    /** When the proactive call is, ISO with the Kuwait offset, or a day. */
    callBookedFor: v.optional(v.string()),
    /** The GoHighLevel appointment "Book call" made, when it was booked from here. */
    ghlAppointmentId: v.optional(v.string()),
    status: v.string(), // planned | call_booked | renewed | resold | not_this_cycle | lost
    notThisCycleReason: v.optional(v.string()),
    outcomeNote: v.optional(v.string()),
    callRecordingUrl: v.optional(v.string()),
    goldStandard: v.optional(v.boolean()),
    goldBy: v.optional(v.string()),
    /** When a renewed or re-sold outcome was announced, so it is announced once. */
    celebratedAt: v.optional(v.number()),
    updatedBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_task_date", ["taskId", "renewalDate"])
    .index("by_gold", ["goldStandard"]),

  /**
   * The billing ledger as this cockpit last read it from Supabase
   * (cockpit_client_payments and cockpit_billing_accounts), every half hour.
   * Cash actuals and "paid so far" come from here; `fetchedAt` and `error`
   * say how fresh it is, so a stale ledger reads as missing, never as zero.
   */
  billingFeed: defineTable({
    key: v.string(), // "ledger"
    payments: v.array(
      v.object({
        id: v.string(),
        taskId: v.optional(v.string()),
        clientName: v.string(),
        day: v.string(),
        usd: v.number(),
        side: v.optional(v.string()),
        kind: v.optional(v.string()),
      }),
    ),
    accounts: v.array(
      v.object({
        taskId: v.string(),
        clientName: v.string(),
        ltvUsd: v.optional(v.number()),
        plan: v.optional(v.string()),
      }),
    ),
    /** When the CEO cockpit last mirrored the accounts, per Supabase. */
    ledgerSyncedAt: v.optional(v.number()),
    fetchedAt: v.number(),
    okAt: v.optional(v.number()),
    error: v.optional(v.string()),
    failures: v.optional(v.number()),
  }).index("by_key", ["key"]),

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
  })
    .index("by_thread", ["thread"])
    // The relay polls for queued rows every 20 seconds; a full scan would stop fitting.
    .index("by_status", ["status"]),
});

export default schema;
