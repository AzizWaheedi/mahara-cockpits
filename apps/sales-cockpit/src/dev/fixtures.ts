/**
 * Made-up data for the layout harness, shaped exactly like the sales
 * tables. Nothing here is a real lead: the names, numbers and messages are
 * invented, and times are built around "now" so the day line has a past, a
 * present and a future whenever the harness is opened.
 */

type Row = Record<string, unknown>;

const H = 3_600_000;
const D = 24 * H;

/** A time today in Kuwait (UTC+3) at hh:mm, as ISO. */
function kw(hh: number, mm = 0, dayOffset = 0): string {
  const now = new Date(Date.now() + 3 * H);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate() + dayOffset;
  return new Date(Date.UTC(y, m, d, hh - 3, mm)).toISOString();
}

export const ME = {
  signed_in: true,
  email: "aziz@maharamedia.com",
  seat: true,
  manager: true,
  ceo: true,
  name: "Aziz Waheedi",
  role: "manager",
  active: true,
  via_portal: true,
  ghl_user_id: "u-aziz",
  b2b_rep_id: "rep-aziz",
  maqsam_email: null,
  fathom_email: null,
  slack_user_id: null,
};

const TEAM = [
  {
    email: "aziz@maharamedia.com",
    name: "Aziz Waheedi",
    role: "manager",
    ghl_user_id: "u-aziz",
    b2b_rep_id: "rep-aziz",
  },
  {
    email: "sara@example.com",
    name: "Sara Khalil",
    role: "setter",
    ghl_user_id: "u-sara",
    b2b_rep_id: "rep-sara",
  },
  {
    email: "omar@example.com",
    name: "Omar Haddad",
    role: "closer",
    ghl_user_id: "u-omar",
    b2b_rep_id: "rep-omar",
  },
  {
    email: "noor@example.com",
    name: "Noor Ali",
    role: "setter",
    ghl_user_id: "u-noor",
    b2b_rep_id: "rep-noor",
  },
];

const NAMES = [
  ["Faisal Al Mutairi", "Al Mutairi Contracting", "SA"],
  ["شركة الريم للتصميم الداخلي", "الريم للتصميم", "KW"],
  ["Khalid Al Shammari", "Shammari Finishing", "SA"],
  ["Mona Al Harbi", "Harbi Interiors", "AE"],
  ["عبدالله العنزي", "العنزي للمقاولات", "KW"],
  ["Yousef Al Qahtani", "Qahtani Build", "SA"],
  ["Huda Al Rashid", "Rashid Landscapes", "QA"],
  ["سالم الدوسري", "الدوسري للألمنيوم", "SA"],
  ["Tariq Mansour", "Mansour MEP", "AE"],
  ["Layla Al Sabah", "Sabah Design Studio", "KW"],
];

const REVENUE = [
  "أقل من $100,000",
  "$100K - $250k",
  "$250K - $500k",
  "$500K - $1M",
];
const READY = ["$4K - $8K", "$8K - $12K", "$12K+", "مو جاهز حالياً"];
const CHALLENGE = [
  "ما يوصلنا عملاء كفاية",
  "العملاء اللي يوصلون مو جديين",
  "ما نقدر نسكّر المشاريع",
];

export const LEADS: Row[] = Array.from({ length: 24 }, (_, i) => {
  const [name, company, country] = NAMES[i % NAMES.length];
  return {
    contact_id: `lead-${i + 1}`,
    name: i < NAMES.length ? name : `${name.split(" ")[0]} ${i}`,
    email: `lead${i + 1}@example.com`,
    phone: `+9665${String(50000000 + i * 7919).slice(0, 8)}`,
    phone8: String(50000000 + i * 7919).slice(0, 8),
    company,
    country,
    source: "ROASForm",
    tags:
      i % 3 === 0
        ? ["roas-qualified"]
        : i % 3 === 1
          ? ["roas-unqualified"]
          : ["roas-unprepared"],
    lead_class:
      i % 3 === 0 ? "qualified" : i % 3 === 1 ? "unqualified" : "unprepared",
    is_lead: true,
    contact_type: "lead",
    dnd: i === 5,
    assigned_to: i % 2 ? "u-sara" : "u-omar",
    ad_id: `1202${String(i).padStart(10, "0")}`,
    adset_id: null,
    campaign_id: null,
    ad_name: `Summer Ad ${1 + (i % 3)} Hook ${1 + (i % 2)}`,
    adset_name: "Premium Projects Program | Summer Ads",
    campaign_name: "MaharaMedia | Lead Gen",
    utm_source: "fb",
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    booking_channel: i % 2 ? "Setter" : "Self",
    revenue: REVENUE[i % REVENUE.length],
    readiness: READY[i % READY.length],
    revenue_goal: "$500k-$1M",
    decision_maker:
      i % 2 ? "نعم، أنا صاحب القرار الوحيد" : "لا معاي شريك/شركاء",
    challenge: CHALLENGE[i % CHALLENGE.length],
    services: "Yes",
    grade: String(1 + (i % 4)),
    setter_name: i % 2 ? "Sara Khalil" : null,
    lead_stage: null,
    opportunity_id: `opp-${i}`,
    pipeline_id: "96oywOezX39jQzXP3Mg0",
    pipeline_name: "Sales Pipeline (2-Call)",
    stage_id: ["s-new", "s-intro", "s-demo", "s-nurture"][i % 4],
    stage_name: [
      "🚨New Lead",
      "Intro Call CONFIRMED",
      "Demo Booked (Qualified)",
      "⏳Short Term Nurture",
    ][i % 4],
    opp_status: "open",
    monetary_value: null,
    opp_updated_at: null,
    lead_created_at: new Date(
      Date.now() - (i < 6 ? i * 5 * H + 20 * 60_000 : i * D),
    ).toISOString(),
    lead_updated_at: null,
    mirrored_at: new Date(Date.now() - 90_000).toISOString(),
  };
});

function appt(
  id: string,
  lead: number,
  type: string,
  start: string,
  rep: string,
  status: string,
  mark?: { status: string; crm: string; by: string },
): Row {
  const l = LEADS[lead];
  const repName = TEAM.find(t => t.ghl_user_id === rep)?.name ?? null;
  const past = Date.parse(start) < Date.now();
  return {
    appointment_id: id,
    contact_id: l.contact_id,
    contact_name: l.name,
    calendar_id:
      type === "demo" ? "jQqXS1YuFnmGZKLkrE62" : "dsqmJ393Dwl9fDSbIVOI",
    call_type: type,
    start_at: start,
    booked_at: new Date(Date.parse(start) - 2 * D).toISOString(),
    crm_status: status,
    assigned_user_id: rep,
    assigned_user_name: repName,
    ad_id: null,
    origin: "b2b",
    mirrored_at: new Date().toISOString(),
    mark_id: mark ? 1 : null,
    marked_status: mark?.status ?? null,
    mark_reason: null,
    mark_note: null,
    marked_by: mark?.by ?? null,
    marked_at: mark ? new Date().toISOString() : null,
    mark_crm: mark?.crm ?? null,
    mark_crm_error:
      mark?.crm === "failed" ? "HighLevel said 422: the slot was moved" : null,
    status: mark?.status ?? status,
    needs_mark:
      past &&
      !mark &&
      ["intro", "demo"].includes(type) &&
      ["new", "confirmed"].includes(status),
  };
}

export const APPOINTMENTS: Row[] = [
  appt("a1", 0, "intro", kw(11, 30), "u-sara", "showed"),
  appt("a2", 1, "intro", kw(13, 0), "u-sara", "confirmed"),
  appt("a3", 2, "demo", kw(14, 0), "u-omar", "confirmed", {
    status: "showed",
    crm: "written",
    by: "omar@example.com",
  }),
  appt("a4", 3, "intro", kw(16, 15), "u-noor", "confirmed"),
  appt("a5", 4, "demo", kw(18, 0), "u-omar", "confirmed"),
  appt("a6", 5, "intro", kw(19, 30), "u-sara", "confirmed"),
  appt("a7", 6, "demo", kw(20, 45), "u-omar", "confirmed"),
  appt("a8", 7, "intro", kw(21, 0, -1), "u-noor", "confirmed"),
  appt("a9", 8, "demo", kw(19, 0, -1), "u-omar", "confirmed", {
    status: "noshow",
    crm: "failed",
    by: "omar@example.com",
  }),
  appt("a10", 9, "intro", kw(12, 0, 1), "u-sara", "confirmed"),
  appt("a11", 10, "demo", kw(17, 30, 1), "u-omar", "confirmed"),
  appt("a12", 11, "callback", kw(15, 0), "u-sara", "confirmed"),
];

export const DIALS: Row[] = [
  {
    call_id: "d1",
    occurred_at: new Date(Date.now() - 26 * H).toISOString(),
    agent_email: "sara@example.com",
    agent_name: "Sara Khalil",
    sales_rep_id: "rep-sara",
    direction: "outbound",
    state: "completed",
    duration_s: 412,
    ringing_s: 6,
    handling_s: null,
    lead_phone8: LEADS[4].phone8,
    contact_id: LEADS[4].contact_id,
    sentiment: "positive",
    summary_en:
      "The lead runs a contracting company in Kuwait and wants more villa projects. Revenue is steady, margins around 20%, and he decides with his brother. Intro booked into a demo for tomorrow.",
    summary_ar:
      "العميل عنده شركة مقاولات في الكويت ويبي مشاريع فلل أكثر. قرار الشراء مع أخوه.",
    has_transcript: true,
    tags: ["Intro"],
  },
  {
    call_id: "d2",
    occurred_at: new Date(Date.now() - 50 * H).toISOString(),
    agent_email: "sara@example.com",
    agent_name: "Sara Khalil",
    sales_rep_id: "rep-sara",
    direction: "outbound",
    state: "no_answer",
    duration_s: 0,
    ringing_s: 30,
    handling_s: null,
    lead_phone8: LEADS[4].phone8,
    contact_id: LEADS[4].contact_id,
    sentiment: null,
    summary_en: null,
    summary_ar: null,
    has_transcript: false,
    tags: [],
  },
];

export const DEALS: Row[] = [
  {
    response_id: "r1",
    submitted_at: new Date(Date.now() - 3 * D).toISOString(),
    closer: "Omar Haddad",
    setter: "Sara Khalil",
    contact_id: LEADS[12].contact_id,
    contact_from: "form",
    client_name: LEADS[12].name,
    business_name: LEADS[12].company,
    email: null,
    phone8: null,
    country: "SA",
    payment_structure: "Split",
    agreement_type: null,
    cash_collected: 2000,
    contracted_revenue: 6000,
    new_mrr: null,
    daily_ad_spend: 40,
    csm: null,
    fathom_link: null,
    lead_source: "Meta ads",
    ad_id: null,
    voided: false,
  },
  {
    response_id: "r2",
    submitted_at: new Date(Date.now() - 6 * D).toISOString(),
    closer: "Omar Haddad",
    setter: null,
    contact_id: LEADS[13].contact_id,
    contact_from: "matched",
    client_name: LEADS[13].name,
    business_name: LEADS[13].company,
    email: null,
    phone8: null,
    country: "KW",
    payment_structure: "Paid in full",
    agreement_type: null,
    cash_collected: 6000,
    contracted_revenue: 6000,
    new_mrr: null,
    daily_ad_spend: 50,
    csm: null,
    fathom_link: null,
    lead_source: "Meta ads",
    ad_id: null,
    voided: false,
  },
];

function card(name: string, role: string, key: string, n: number): Row {
  const scheduled = 8 * n;
  const due = 7 * n;
  const shown = 5 * n;
  const qualified = 4 * n;
  const demosDue = role === "setter" ? 0 : 4 * n;
  const demosShown = role === "setter" ? 0 : 3 * n;
  const closes = role === "setter" ? 0 : n;
  return {
    person_key: key,
    display_name: name,
    role,
    is_known: true,
    calls_scheduled: scheduled,
    calls_due: due,
    calls_shown: shown,
    calls_qualified: qualified,
    demos_scheduled: demosDue + 1,
    demos_due: demosDue,
    demos_shown: demosShown,
    demos_qualified: demosShown,
    disqualified_count: shown - qualified,
    noshow_count: due - shown,
    cancelled_count: 1,
    show_rate: Math.round((1000 * shown) / due) / 10,
    noshow_rate: Math.round((1000 * (due - shown)) / due) / 10,
    disqualified_rate: Math.round((1000 * (shown - qualified)) / shown) / 10,
    closes,
    revenue: closes * 6000,
    cash_collected: closes * 2000,
    new_mrr: 0,
    close_rate: demosShown
      ? Math.round((1000 * closes) / demosShown) / 10
      : null,
    avg_deal: closes ? 6000 : null,
  };
}

export function scorecards(): Row[] {
  const out: Row[] = [];
  const windows: [string, number][] = [
    ["today", 1],
    ["week", 2],
    ["month", 4],
    ["last_month", 5],
    ["d30", 4],
    ["d90", 12],
  ];
  for (const [w, n] of windows) {
    for (const t of TEAM) {
      out.push({
        window_key: w,
        person_key: t.b2b_rep_id,
        from_day: new Date(Date.now() - 6 * D).toISOString().slice(0, 10),
        to_day: new Date().toISOString().slice(0, 10),
        display_name: t.name,
        role: t.role === "closer" ? "rep" : t.role,
        is_known: true,
        row: card(
          t.name,
          t.role === "closer" ? "rep" : t.role,
          t.b2b_rep_id,
          n,
        ),
        computed_at: new Date().toISOString(),
      });
    }
  }
  return out;
}

export function board(): Row[] {
  return scorecards().map(s => {
    const r = s.row as Record<string, number>;
    return {
      window_key: s.window_key,
      person_key: s.person_key,
      display_name: s.display_name,
      role: s.role,
      from_day: s.from_day,
      to_day: s.to_day,
      show_rate: r.show_rate,
      noshow_rate: r.noshow_rate,
      disqualified_rate: r.disqualified_rate,
      qualified_rate: r.calls_shown
        ? Math.round((1000 * r.calls_qualified) / r.calls_shown) / 10
        : null,
      qualified_close_rate: r.close_rate,
      close_rate: r.demos_shown
        ? Math.round((1000 * r.closes) / r.demos_shown) / 10
        : null,
      has_calls: r.calls_due > 0,
      computed_at: s.computed_at,
    };
  });
}

export const PEOPLE: Row[] = TEAM.map(t => ({
  ...t,
  active: true,
  via_portal: true,
  maqsam_email: t.role === "setter" ? t.email : null,
  fathom_email: t.role === "closer" ? t.email : null,
  slack_user_id: null,
  goals:
    t.role === "setter"
      ? { weekly: { booked: 25, shown: 15 } }
      : { weekly: { closes: 3, cash: 6000 } },
  pay:
    t.role === "closer"
      ? { cash_rate: 0.1, pif_bonus: 250, currency: "USD" }
      : {},
  added_at: new Date(Date.now() - 20 * D).toISOString(),
  updated_at: new Date().toISOString(),
  updated_by: "aziz@maharamedia.com",
}));

export const REPS: Row[] = TEAM.map(t => ({
  id: t.b2b_rep_id,
  display_name: t.name,
  role: t.role === "closer" ? "rep" : t.role,
  ghl_user_id: t.ghl_user_id,
  closer_aliases: [t.name.split(" ")[0]],
  is_active: true,
  maqsam_email: null,
  fathom_email: null,
}));

export const INBOX: Row[] = [
  {
    conversation_id: "c1",
    contact_id: LEADS[1].contact_id,
    contact_name: LEADS[1].name,
    last_message_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    last_direction: "inbound",
    last_type: "TYPE_WHATSAPP",
    last_body: "هلا، نقدر نأجل المكالمة لبكرة العصر؟",
    unread: 1,
    inbound_whatsapp_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    assigned_to: "u-sara",
    mirrored_at: new Date().toISOString(),
  },
  {
    conversation_id: "c2",
    contact_id: LEADS[6].contact_id,
    contact_name: LEADS[6].name,
    last_message_at: new Date(Date.now() - 3 * H).toISOString(),
    last_direction: "inbound",
    last_type: "TYPE_EMAIL",
    last_body: "Thanks, can you send the deck before the call?",
    unread: 0,
    inbound_whatsapp_at: null,
    assigned_to: "u-omar",
    mirrored_at: new Date().toISOString(),
  },
];

export const LINKS: Row[] = [
  {
    id: "k1",
    label: "Pitch deck",
    url: "https://pitch.com/v/maharamedia-startup-deck-2aba8c",
    kind: "deck",
    note: "The 48-slide Gulf Arabic deck for the demo.",
    sort: 10,
    active: true,
    updated_by: null,
    updated_at: new Date().toISOString(),
  },
  {
    id: "k2",
    label: "New client form",
    url: "https://maharamedia.typeform.com/to/BTzMwXiw",
    kind: "form",
    note: "Fill it the moment a client signs.",
    sort: 20,
    active: true,
    updated_by: null,
    updated_at: new Date().toISOString(),
  },
  {
    id: "k3",
    label: "ROI calculator",
    url: "https://calculator.maharamedia.com",
    kind: "calculator",
    note: "Walk their numbers before the price.",
    sort: 30,
    active: true,
    updated_by: null,
    updated_at: new Date().toISOString(),
  },
];

export const PROPOSALS: Row[] = [
  {
    id: "p1",
    request_id: "q1",
    contact_id: LEADS[2].contact_id,
    appointment_id: "a3",
    recording_id: null,
    lang: "ar",
    variant: "general",
    status: "needs_input",
    deal: {
      headline: "مشاريعكم القادمة FILL",
      investment: {
        rows: [{ label: "البرنامج", amount: "FILL" }],
        total: 6000,
      },
    },
    validation: {
      ok: true,
      errors: [],
      warnings: [
        "The client did not say a net margin, so the return is shown as break-even.",
      ],
      fills: ["headline", "investment.rows.0.amount"],
    },
    fill_count: 2,
    html_path: "proposals/p1/v1.html",
    pdf_path: null,
    model: "openai:gpt-5",
    created_by: "omar@example.com",
    created_at: new Date(Date.now() - 2 * H).toISOString(),
    updated_at: new Date(Date.now() - 100 * 60_000).toISOString(),
    sent_at: null,
    sent_by: null,
    error: null,
  },
];

export const MIRROR_RUN: Row = {
  id: 1,
  started_at: new Date(Date.now() - 100_000).toISOString(),
  finished_at: new Date(Date.now() - 92_000).toISOString(),
  mode: "scheduled",
  ok: true,
  counts: {
    reps: 9,
    deals: 50,
    leads: { n: 7, full: false, dropped: 0 },
    appointments: { n: 12, full: false, dropped: 0 },
    dials: 0,
    inbox: { n: 100 },
  },
  error: null,
};

export const TEAM_ROWS = TEAM.map(t => ({
  ...t,
  active: true,
  via_portal: true,
}));

// ---------------------------------------------------------------------------
// The dialer: what each queue holds, the saves HighLevel has not taken yet,
// a lead's conversation, and the ready-made messages. The harness keeps the
// state (open call, saved leads) and filters these.
// ---------------------------------------------------------------------------

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** "14:30" on the Kuwait clock. */
function kwClock(ms: number): string {
  return new Date(ms + 3 * H).toISOString().slice(11, 16);
}

/** One queue item for LEADS[i], as sales-api shapes it. */
export function queueItem(i: number, over: Row): Row {
  const l = LEADS[i];
  return {
    contact_id: l.contact_id,
    name: l.name,
    phone: l.phone,
    stage: l.stage_name,
    lead_class: l.lead_class,
    tier: 3,
    why: "Never called",
    created_at: l.lead_created_at,
    last_dial_at: null,
    due_at: null,
    inbound_at: null,
    callback_at: null,
    demo_at: null,
    step: 0,
    last_outcome: null,
    kind: "lead",
    heat: 0,
    hot_reasons: [],
    hot: false,
    misses: 0,
    stage_role: null,
    inbound_call_at: null,
    appointment: null,
    ...over,
  };
}

/**
 * The queue as sales-api ranks it, one of each kind of work: a new lead, a
 * missed call, a call-back five minutes early, an intro starting, a
 * confirmation, replies, retries (one on do not disturb) and the long tail.
 * `start` is when the harness opened, so the times hold still.
 */
export function dialItems(as: "setter" | "closer", start: number): Row[] {
  const now = start;
  if (as === "closer")
    return [
      queueItem(10, {
        tier: 0,
        kind: "confirm",
        why: `Confirm the demo today at ${kwClock(now + 2 * H)}`,
        appointment: {
          id: "a-demo-1",
          type: "demo",
          start_at: iso(now + 2 * H),
          booked_at: iso(now - 2 * D),
          assigned_user_id: "u-aziz",
          confirmed: false,
        },
      }),
      queueItem(2, {
        tier: 1,
        why: "Showed, not signed yet",
        demo_at: iso(now - D),
        last_dial_at: iso(now - D),
      }),
      queueItem(11, {
        tier: 1,
        why: "Hot lead: follow up as planned",
        hot: true,
        heat: 82,
        hot_reasons: ["Asked for the price", "Opened the deck twice"],
      }),
      queueItem(12, {
        tier: 1,
        why: "Wrote back today",
        inbound_at: iso(now - 40 * MIN),
        last_dial_at: iso(now - 2 * D),
      }),
      queueItem(13, {
        tier: 2,
        why: "Missed the demo, rebook it",
        last_dial_at: iso(now - 3 * D),
      }),
    ];
  const tail = [9, 14, 15, 16, 17, 18, 19].map(i =>
    queueItem(i, { tier: 3, why: "Never called" }),
  );
  return [
    queueItem(0, {
      tier: 0,
      why: "New lead, call now",
      created_at: iso(now - 40_000),
    }),
    queueItem(1, {
      tier: 0,
      why: "Called us, missed it",
      inbound_call_at: iso(now - 90_000),
      last_dial_at: iso(now - 3 * D),
      step: 1,
      last_outcome: "no_answer",
    }),
    queueItem(2, {
      tier: 0,
      why: `Call back at ${kwClock(now + 4 * MIN)}, as agreed`,
      callback_at: iso(now + 4 * MIN),
      last_dial_at: iso(now - 2 * H),
      last_outcome: "callback",
    }),
    queueItem(3, {
      tier: 0,
      kind: "intro",
      why: `Intro call now, booked for ${kwClock(now + 3 * MIN)}`,
      appointment: {
        id: "a-intro-1",
        type: "intro",
        start_at: iso(now + 3 * MIN),
        booked_at: iso(now - 2 * D),
        assigned_user_id: "u-aziz",
        confirmed: true,
      },
    }),
    queueItem(4, {
      tier: 1,
      kind: "confirm",
      why: `Confirm the demo tomorrow at ${kwClock(now + D + 2 * H)}`,
      appointment: {
        id: "a-demo-2",
        type: "demo",
        start_at: iso(now + D + 2 * H),
        booked_at: iso(now - 3 * D),
        assigned_user_id: "u-omar",
        confirmed: false,
      },
    }),
    queueItem(6, {
      tier: 1,
      why: "Called us, missed it",
      inbound_call_at: iso(now - 3 * H),
    }),
    queueItem(7, {
      tier: 1,
      why: "Wrote back today",
      inbound_at: iso(now - 2 * H),
      last_dial_at: iso(now - D),
    }),
    // LEADS[5] is on do not disturb: the dialer shows it and will not call.
    queueItem(5, {
      tier: 2,
      why: "Next try is due",
      step: 1,
      last_dial_at: iso(now - D),
      last_outcome: "no_answer",
    }),
    queueItem(8, {
      tier: 2,
      why: "Missed the intro, rebook it",
      last_dial_at: iso(now - 2 * D),
    }),
    ...tail,
  ];
}

/** Saves HighLevel has not taken: one it refused, one still waiting. */
export function savedWork(start: number): Row[] {
  return [
    {
      attempt_id: "att-old-1",
      contact_id: LEADS[20].contact_id,
      name: LEADS[20].name,
      outcome: "callback",
      saved_at: iso(start - 25 * MIN),
      crm_note: "failed",
      error: "HighLevel said 422: this contact was merged into another",
    },
    {
      attempt_id: "att-old-2",
      contact_id: LEADS[21].contact_id,
      name: LEADS[21].name,
      outcome: "not_interested",
      saved_at: iso(start - 6 * MIN),
      crm_note: "pending",
      error: null,
    },
  ];
}

/**
 * One lead's conversation as convo.read returns it. Odd-numbered leads
 * wrote on WhatsApp two hours ago (the free window is open); the others
 * last wrote yesterday, so only a template goes. The missed-call lead has
 * the call in the thread.
 */
export function conversation(contactId: string, now: number): Row {
  const i = Math.max(
    0,
    LEADS.findIndex(l => l.contact_id === contactId),
  );
  const l = LEADS[i];
  const wrote = i % 2 === 1 ? now - 2 * H : now - 30 * H;
  const thread: Row[] = [
    {
      id: `${contactId}-m1`,
      conversation_id: `conv-${contactId}`,
      direction: "outbound",
      channel: "whatsapp",
      type: "TYPE_WHATSAPP",
      status: "read",
      at: iso(wrote - 3 * H),
      body: "Hi, this is Mahara Media. When is a good time for a short call?",
      subject: null,
      attachments: [],
      error: null,
      source: "workflow",
    },
    {
      id: `${contactId}-m2`,
      conversation_id: `conv-${contactId}`,
      direction: "inbound",
      channel: "whatsapp",
      type: "TYPE_WHATSAPP",
      status: "delivered",
      at: iso(wrote),
      body: i % 2 ? "تمام، موجود." : "Sure, call me in the evening.",
      subject: null,
      attachments: [],
      error: null,
      source: null,
    },
  ];
  if (i === 1)
    thread.push({
      id: `${contactId}-call`,
      conversation_id: `conv-${contactId}`,
      direction: "inbound",
      channel: "call",
      type: "TYPE_CALL",
      status: "no-answer",
      at: iso(now - 90_000),
      body: null,
      subject: null,
      attachments: [],
      error: null,
      source: null,
    });
  return {
    contact: {
      name: l.name,
      email: l.email,
      phone: l.phone,
      tags: l.tags,
      dnd: l.dnd,
      assigned_to: l.assigned_to,
    },
    channels: {
      whatsapp: {
        on: true,
        dnd: Boolean(l.dnd),
        reachable: true,
        window: {
          open: now - wrote < 24 * H,
          closes_at: iso(wrote + 24 * H),
          last_inbound_at: iso(wrote),
        },
      },
      email: { on: true, dnd: Boolean(l.dnd), reachable: true },
      sms: { on: true, dnd: Boolean(l.dnd), reachable: true },
    },
    thread,
    cursors: {},
    sends: [],
    read_at: iso(now),
  };
}

/** The team's ready-made messages the dialer puts in the box (English only here). */
export const SNIPPETS: Row[] = [
  {
    id: "sn-missed",
    moment: "missed_call",
    language: "en",
    body: "Hi {name}, it's {rep} from Mahara Media. I just tried to call you. When suits you to talk?",
    sort: 10,
    deleted_at: null,
  },
  {
    id: "sn-confirm",
    moment: "confirm",
    language: "en",
    body: "Hi {name}, it's {rep} from Mahara Media. Can you confirm our call {day} at {time}?",
    sort: 10,
    deleted_at: null,
  },
];

/** One approved WhatsApp template with its HighLevel workflow, so templates are live. */
export const WA_TEMPLATES: Row[] = [
  {
    key: "follow_up_en",
    name: "Follow up",
    language: "en",
    purpose: "A line to a lead outside the 24 hours",
    preview: "Hi {{first_name}}, {{line}}",
    variables: ["first_name", "line"],
    workflow_id: "wf-follow-up",
    active: true,
    segments: [],
    sort: 10,
    updated_by: "aziz@maharamedia.com",
    updated_at: new Date().toISOString(),
  },
];

export const SETTINGS: Row[] = [
  { key: "crm_writes", value: { dispositions: true, backlog_days: 7 } },
  {
    key: "offer",
    value: {
      payments: [
        { key: "pif", label: "Paid in full" },
        { key: "plan_3", label: "Deposit, then three payments" },
      ],
      guarantee: {
        label: "Include the guarantee (30 qualified appointments in 90 days)",
      },
    },
  },
];

// ---------------------------------------------------------------------------
// The hot list: rows as cockpit_sales_hot keeps them (the harness changes
// them as hot.save does), and what the sheet reads as a lead's last
// follow-up besides a mark by hand: an outbound call, a WhatsApp from us.
// One of each: overdue, due today, later, none set; closed and lost; a row
// from before the sheet's columns; the owner's, the team's.
// ---------------------------------------------------------------------------

/** A lead put on the list: every field blank, as sales-api's hotFresh. */
export function hotFresh(contactId: string, owner: string, at: string): Row {
  return {
    contact_id: contactId,
    owner_email: owner,
    next_at: null,
    next_how: null,
    last_objection: null,
    note: null,
    heat: "hot",
    status: "nurturing",
    amount: null,
    amount_currency: "USD",
    last_fu_at: null,
    added_by: owner,
    added_at: at,
    updated_at: at,
    removed_at: null,
    removed_why: null,
  };
}

function hotRow(i: number, owner: string, over: Row): Row {
  return {
    ...hotFresh(String(LEADS[i].contact_id), owner, iso(Date.now() - 6 * D)),
    updated_at: iso(Date.now() - 2 * H),
    ...over,
  };
}

// A row from before the 2026-09-27 columns: no type, status, amount or mark.
const before = hotRow(1, "aziz@maharamedia.com", {
  next_how: "call",
  last_objection: "Needs to check the budget with finance",
});
for (const k of ["heat", "status", "amount", "amount_currency", "last_fu_at"])
  delete before[k];

export const HOT: Row[] = [
  hotRow(0, "aziz@maharamedia.com", {
    heat: "red_hot",
    amount: 6500,
    next_at: iso(Date.now() - 26 * H),
    last_fu_at: iso(Date.now() - 3 * D),
    last_objection: "Talking to his partner first",
    note: "Asked for the Riyadh villa case study.\nCall after 5, never mornings.",
  }),
  hotRow(2, "sara@example.com", {
    amount: 8000,
    next_at: iso(Date.now() + 90 * MIN),
    last_objection: "Wants to see the contract first",
  }),
  hotRow(4, "omar@example.com", {
    heat: "warm",
    amount: "12000.00",
    next_at: iso(Date.now() + 2 * D),
    last_objection: "بعد الصيف",
    note: "يبي يشوف شغلنا في الكويت",
  }),
  before,
  hotRow(9, "aziz@maharamedia.com", {
    amount: 1500,
    amount_currency: "KWD",
    next_at: iso(Date.now() + 6 * D),
    last_objection: "Budget opens next quarter",
  }),
  hotRow(11, "noor@example.com", {
    heat: "red_hot",
    amount: 9000,
    next_at: iso(Date.now() - 3 * H),
    last_objection: "Asked for a smaller first month",
  }),
  hotRow(6, "sara@example.com", {
    status: "closed",
    amount: 6000,
    next_at: iso(Date.now() - 5 * D),
    note: "Signed on the split plan.",
  }),
  hotRow(8, "omar@example.com", {
    heat: "warm",
    status: "lost",
    last_objection: "Went with another agency",
  }),
];

function outboundCall(
  id: string,
  lead: Row,
  ago: number,
  answered: boolean,
): Row {
  return {
    call_id: id,
    occurred_at: iso(Date.now() - ago),
    agent_email: "sara@example.com",
    agent_name: "Sara Khalil",
    sales_rep_id: "rep-sara",
    direction: "outbound",
    state: answered ? "completed" : "no_answer",
    duration_s: answered ? 140 : 0,
    ringing_s: answered ? 7 : 30,
    handling_s: null,
    lead_phone8: lead.phone8,
    contact_id: lead.contact_id,
    sentiment: null,
    summary_en: null,
    summary_ar: null,
    has_transcript: false,
    tags: [],
  };
}

/** Calls the hot list reads as follow-ups: older than a mark, the latest, and one not linked to its lead yet. */
export const HOT_DIALS: Row[] = [
  outboundCall("d-hot-1", LEADS[0], 5 * D, true),
  outboundCall("d-hot-2", LEADS[2], 2 * H, false),
  { ...outboundCall("d-hot-3", LEADS[11], D, true), contact_id: null },
];

/** A conversation whose last message is our WhatsApp. */
export const HOT_INBOX: Row[] = [
  {
    conversation_id: "c3",
    contact_id: LEADS[9].contact_id,
    contact_name: LEADS[9].name,
    last_message_at: iso(Date.now() - 20 * H),
    last_direction: "outbound",
    last_type: "TYPE_WHATSAPP",
    last_body: "Sent you the proposal. Tell me when you have read it.",
    unread: 0,
    inbound_whatsapp_at: iso(Date.now() - 3 * D),
    assigned_to: "u-sara",
    mirrored_at: new Date().toISOString(),
  },
];

/** WhatsApp messages sent from the cockpit (cockpit_sales_messages). */
export const MESSAGES: Row[] = [
  {
    id: "msg-hot-1",
    request_id: "req-hot-1",
    contact_id: LEADS[4].contact_id,
    channel: "whatsapp",
    subject: null,
    body: "هلا، أرسلت لك أمثلة من شغلنا في الكويت.",
    source: "rep",
    followup_id: null,
    sent_by: "omar@example.com",
    state: "read",
    ghl_message_id: null,
    ghl_conversation_id: null,
    provider_status: null,
    error: null,
    created_at: iso(Date.now() - 4 * H),
    updated_at: iso(Date.now() - 4 * H),
  },
];
