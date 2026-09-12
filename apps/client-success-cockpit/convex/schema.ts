import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const schema = defineSchema({
  ...authTables,

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
  }).index("by_rank", ["rank"]),

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
    stage: v.optional(v.string()),
    happiness: v.optional(v.string()),
    launchDate: v.optional(v.string()),
    liveDays: v.optional(v.number()),
    performance: v.optional(v.any()),
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
    syncedAt: v.number(),
  }).index("by_start", ["start"]),
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
