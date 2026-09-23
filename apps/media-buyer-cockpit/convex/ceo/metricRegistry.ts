import type {
  CallsPayload,
  ClientsPayload,
  DeliveryPayload,
  FunnelWindow,
  GrowthPayload,
  MachinePayload,
  MoneyPayload,
  OrganicPayload,
  TeamPayload,
} from "./payloads";

/**
 * Every CEO cockpit number, named and defined once, so it can be written to
 * Supabase in a shape any reader (a person, an LLM, a sheet) understands
 * (Aziz, 2026-09-21: "all these sources of truth should pull into Supabase
 * ... formatted really cleanly in a table that any LLM would be able to
 * understand"). Two tables in Creative Triage: cockpit_metric_definitions
 * (one row per metric: plain definition, source, what it leaves out, unit)
 * and cockpit_metric_values (one row per metric, scope, window and day).
 *
 * The extractors below read the prepared payloads the screens read, so the
 * table always says exactly what the cockpit says.
 */

export type Unit = "usd" | "count" | "share" | "minutes" | "days" | "ratio";

export type MetricDefinition = {
  metric: string;
  section: string;
  label: string;
  definition: string;
  source: string;
  leavesOut?: string;
  unit: Unit;
};

export type MetricValue = {
  metric: string;
  /** "company", "client:<clickup task id>", "person:<first name>", "rail:<name>". */
  scope: string;
  /** today, yesterday, last7, mtd, lastMonth, last30, last90, 12m, all, snapshot. */
  window: string;
  value: number | null;
  windowFrom?: string | null;
  windowTo?: string | null;
};

const d = (
  metric: string,
  section: string,
  label: string,
  definition: string,
  source: string,
  unit: Unit,
  leavesOut?: string,
): MetricDefinition => ({
  metric,
  section,
  label,
  definition,
  source,
  unit,
  leavesOut,
});

const B2B =
  "B2B GoHighLevel and Meta through the B2B Supabase database (flwboeijllbtrufxkhts)";
const TRIAGE = "Creative Triage Supabase (bldgtotkfmhoxmlzowdx)";
const CLICKUP = "ClickUp, the Clients - Mahara list, synced into the cockpit";

export const DEFINITIONS: MetricDefinition[] = [
  // --- growth (Mahara's own funnel) ---
  d(
    "growth.spend",
    "growth",
    "Lead-gen ad spend",
    "Meta spend on Mahara's own campaigns whose name does not say hiring, recruit, hammer them, retarget or remarket, by the ad account's reporting day.",
    B2B,
    "usd",
    "Retargeting spend, kept apart as growth.spend_retargeting.",
  ),
  d(
    "growth.spend_retargeting",
    "growth",
    "Retargeting spend",
    "Meta spend on campaigns whose name says hammer them, retarget or remarket.",
    B2B,
    "usd",
  ),
  d(
    "growth.leads",
    "growth",
    "Leads",
    "GoHighLevel contacts tagged roas-qualified or roas-unqualified, by the day the contact was created (Riyadh). A contact with both is qualified.",
    B2B,
    "count",
    "Contacts tagged roas-unprepared (not ready) and contacts with no ROAS tag: shown apart, never counted.",
  ),
  d(
    "growth.leads_qualified",
    "growth",
    "Qualified leads",
    "Contacts tagged roas-qualified, by creation day.",
    B2B,
    "count",
  ),
  d(
    "growth.leads_unqualified",
    "growth",
    "Unqualified leads",
    "Contacts tagged roas-unqualified and not roas-qualified, by creation day.",
    B2B,
    "count",
  ),
  d(
    "growth.leads_not_ready",
    "growth",
    "Not ready",
    "Contacts tagged roas-unprepared and neither of the lead tags.",
    B2B,
    "count",
  ),
  d(
    "growth.leads_untagged",
    "growth",
    "Not yet tagged",
    "Contacts with none of the three ROAS tags.",
    B2B,
    "count",
  ),
  d(
    "growth.leads_ads",
    "growth",
    "Leads from ads",
    "Leads whose contact carries an ad id, or whose GoHighLevel attribution carries one.",
    B2B,
    "count",
  ),
  d(
    "growth.leads_organic",
    "growth",
    "Organic leads",
    "Leads with no ad id whose source, tags or attribution medium say inbound WhatsApp, Instagram DM, YouTube, referral or organic.",
    B2B,
    "count",
    "GoHighLevel first-touch attribution is empty on most contacts.",
  ),
  d(
    "growth.leads_assumed_ads",
    "growth",
    "Leads assumed from ads",
    "Leads with no ad id and nothing that says organic, counted as ads and labelled assumed.",
    B2B,
    "count",
  ),
  d(
    "growth.cpl",
    "growth",
    "Cost per lead",
    "Lead-gen ad spend over leads.",
    B2B,
    "usd",
  ),
  d(
    "growth.speed_to_lead_median_min",
    "growth",
    "Speed to lead, median minutes",
    "Minutes from a lead's creation to the first Maqsam call with it made by a sales rep on the roster, median over the leads that were called.",
    B2B,
    "minutes",
    "Leads never called; calls by call-centre agents; WhatsApp first touches.",
  ),
  d(
    "growth.speed_to_lead_called",
    "growth",
    "Leads called",
    "Leads in the window with a sales rep's Maqsam call after creation.",
    B2B,
    "count",
  ),
  d(
    "growth.speed_to_lead_never_called",
    "growth",
    "Leads never called",
    "Leads in the window with no sales rep's Maqsam call.",
    B2B,
    "count",
  ),
  d(
    "growth.speed_to_lead_within_5_share",
    "growth",
    "Called within 5 minutes",
    "Of the leads called, the share whose first call came within 5 minutes.",
    B2B,
    "share",
  ),
  d(
    "growth.lead_to_booked_rate",
    "growth",
    "Lead to booked call",
    "Leads created in the window with at least one intro or demo ever booked against their contact, over leads. Per lead, never per booking.",
    B2B,
    "share",
  ),
  d(
    "growth.intros_booked",
    "growth",
    "Intro calls booked",
    "Intro appointments on a rep's calendar, by the day they were booked.",
    B2B,
    "count",
  ),
  d(
    "growth.intros_due",
    "growth",
    "Intro calls due",
    "Intro appointments whose time has passed, by call day, cancelled and no-show included.",
    B2B,
    "count",
  ),
  d(
    "growth.intros_shown",
    "growth",
    "Intro calls shown",
    "Intro appointments marked showed, or confirmed or invalid once past, by call day.",
    B2B,
    "count",
  ),
  d(
    "growth.intro_show_rate",
    "growth",
    "Intro show rate",
    "Intro calls shown over intro calls due.",
    B2B,
    "share",
  ),
  d(
    "growth.demos_booked",
    "growth",
    "Demos booked",
    "Demo appointments by the day they were booked.",
    B2B,
    "count",
  ),
  d(
    "growth.demos_due",
    "growth",
    "Demos due",
    "Demos whose time has passed, by call day.",
    B2B,
    "count",
  ),
  d(
    "growth.demos_shown",
    "growth",
    "Demos shown",
    "Demos marked showed, or confirmed or invalid once past, by call day.",
    B2B,
    "count",
  ),
  d(
    "growth.demo_show_rate",
    "growth",
    "Demo show rate",
    "Demos shown over demos due.",
    B2B,
    "share",
  ),
  d(
    "growth.intro_cancel_rate",
    "growth",
    "Intro cancel rate",
    "Intro calls with status cancelled over intro calls scheduled in the window, by call day.",
    B2B,
    "share",
  ),
  d(
    "growth.demo_cancel_rate",
    "growth",
    "Demo cancel rate",
    "Demos with status cancelled over demos scheduled, by call day.",
    B2B,
    "share",
  ),
  d(
    "growth.cancel_rate",
    "growth",
    "Cancel rate",
    "Cancelled intro and demo calls over all scheduled, by call day.",
    B2B,
    "share",
  ),
  d(
    "growth.closes",
    "growth",
    "Closes",
    "Deals signed on the closer's New Client Form, by the day the form was submitted.",
    B2B,
    "count",
  ),
  d(
    "growth.close_rate",
    "growth",
    "Close rate",
    "Signed over every demo shown in the window (the dashboard's close_rate_all).",
    B2B,
    "share",
    "Can pass 100%: a deal is dated by its form day.",
  ),
  d(
    "growth.qualified_close_rate",
    "growth",
    "Qualified close rate",
    "Signed over demos qualified (shown minus invalid).",
    B2B,
    "share",
  ),
  d(
    "growth.contracted",
    "growth",
    "Contracted",
    "Contract value typed on the closer form, by form day.",
    B2B,
    "usd",
    "Typed, not paid.",
  ),
  d(
    "growth.front_end_cash",
    "growth",
    "Front-end cash",
    "The deposit typed on the closer form for deals signed in the window, plus kickoff cash once the kickoff form is read.",
    B2B,
    "usd",
    "Kickoff cash is not read yet, so this is the deposit alone.",
  ),
  d(
    "growth.front_end_cash_confirmed_share",
    "growth",
    "Front-end cash confirmed",
    "Share of the deposits a Whop payment or a bank transfer on record backs.",
    B2B,
    "share",
    "Tap is not checked here.",
  ),
  d(
    "growth.roas_cash",
    "growth",
    "Front-end ROAS",
    "Front-end cash over lead-gen spend.",
    B2B,
    "ratio",
  ),
  d(
    "growth.roas_contracted",
    "growth",
    "Contracted ROAS",
    "Contracted over lead-gen spend.",
    B2B,
    "ratio",
  ),
  d(
    "growth.cost_per_demo_shown",
    "growth",
    "Cost per demo shown",
    "Lead-gen spend over demos shown.",
    B2B,
    "usd",
  ),
  d(
    "growth.cac",
    "growth",
    "Cost to acquire a customer",
    "Lead-gen spend over deals signed.",
    B2B,
    "usd",
  ),
  // --- money ---
  d(
    "money.cash",
    "money",
    "Cash collected",
    "Money in on every connected rail: Whop net of refunds by charge day, Tap charges no settlement covers, client payments on the uploaded bank statements, and hand-logged payments no statement line covers.",
    "Whop (B2B database), Tap API, bank statements uploaded on the Money tab, the cockpit's own log",
    "usd",
    "Processor fees; anything not on a connected rail.",
  ),
  d(
    "money.cash_whop",
    "money",
    "Cash on Whop",
    "Paid Whop payments net of refunds, by the Kuwait day of the charge.",
    "whop_payments in the B2B database",
    "usd",
  ),
  d(
    "money.cash_tap",
    "money",
    "Cash on Tap",
    "Captured live Tap charges, converted at the cockpit's fixed rates, minus the charges a bank settlement line covers.",
    "Tap API",
    "usd",
    "Absent until the live key is set on the deployment.",
  ),
  d(
    "money.cash_bank",
    "money",
    "Cash on the bank statements",
    "Client payments on the uploaded statements; Whop payouts, Tap settlements and Mahara's own transfers are never in it.",
    "cockpit_bank_lines (Creative Triage), from the CBK Online CSV export",
    "usd",
  ),
  d(
    "money.cash_manual",
    "money",
    "Cash logged by hand",
    "Payments logged on the Money tab that no Tap charge or statement line covers.",
    "ceoManualPayments",
    "usd",
  ),
  d(
    "money.refunds",
    "money",
    "Refunds",
    "Whop refunds by refund day plus refunds logged by hand.",
    "whop_payments and the cockpit's own log",
    "usd",
  ),
  d(
    "money.deals",
    "money",
    "Deals signed",
    "Closer-form deals by form day.",
    B2B,
    "count",
  ),
  d(
    "money.contracted",
    "money",
    "Contracted",
    "Closer-form contract value by form day.",
    B2B,
    "usd",
  ),
  d(
    "money.front_end_cash",
    "money",
    "Front-end cash (rails)",
    "Payments in tied to a deal inside its front-end window: the deposit (closer) and the rest of the cash (CSM).",
    "Attribution over every rail",
    "usd",
  ),
  d(
    "money.back_end_cash",
    "money",
    "Back-end cash",
    "Payments in matched to an existing client after its front-end window.",
    "Attribution over every rail",
    "usd",
  ),
  d(
    "money.unattributed_cash",
    "money",
    "Cash not attributed",
    "Payments in that match no deal and no client.",
    "Attribution over every rail",
    "usd",
  ),
  d(
    "money.projected_mrr",
    "money",
    "Projected MRR",
    "The MRR field added up over active cards on a recurring plan.",
    CLICKUP,
    "usd",
    "Typed by hand on the cards.",
  ),
  d(
    "money.collected_from_recurring",
    "money",
    "Collected from recurring clients",
    "Cash attributed this month to the clients behind projected MRR, every rail.",
    "Attribution over every rail",
    "usd",
  ),
  d(
    "money.collection_rate",
    "money",
    "Collection rate",
    "Collected from recurring clients over projected MRR.",
    "Attribution and ClickUp",
    "share",
  ),
  d(
    "money.average_retainer",
    "money",
    "Average retainer",
    "Mean MRR over active cards on a recurring plan.",
    CLICKUP,
    "usd",
  ),
  d(
    "money.bank_statement_age_days",
    "money",
    "Days since the last statement",
    "Days from the newest uploaded statement's last day to today.",
    "cockpit_statements",
    "days",
    "Null when nothing was uploaded.",
  ),
  // --- delivery (clients) ---
  d(
    "delivery.spend",
    "delivery",
    "Client ad spend",
    "Every client Meta account's spend by reporting day, converted with the fixed rate table.",
    TRIAGE,
    "usd",
    "Mahara's own accounts; currencies with no rate.",
  ),
  d(
    "delivery.leads",
    "delivery",
    "Client platform leads",
    "Leads Meta reports per client account per day.",
    TRIAGE,
    "count",
  ),
  d(
    "delivery.bookings",
    "delivery",
    "Client bookings",
    "Appointments on a client's provisional, online and main calendars, by the day the meeting is for, future ones excluded.",
    TRIAGE,
    "count",
  ),
  d(
    "delivery.bookings_confirmed",
    "delivery",
    "Confirmed bookings",
    "Appointments on the online and main calendars.",
    TRIAGE,
    "count",
  ),
  d(
    "delivery.bookings_provisional",
    "delivery",
    "Provisional bookings",
    "Appointments on the provisional calendar.",
    TRIAGE,
    "count",
    "That calendar has produced no rows yet.",
  ),
  d(
    "delivery.cpl",
    "delivery",
    "Client cost per lead",
    "Client spend over platform leads.",
    TRIAGE,
    "usd",
  ),
  d(
    "delivery.cpb",
    "delivery",
    "Client cost per booking",
    "Client spend over bookings.",
    TRIAGE,
    "usd",
  ),
  d(
    "delivery.cpb_confirmed",
    "delivery",
    "Cost per confirmed booking",
    "Client spend over confirmed bookings.",
    TRIAGE,
    "usd",
  ),
  d(
    "delivery.book_rate",
    "delivery",
    "Lead to booking",
    "Bookings over platform leads, last 30 days.",
    TRIAGE,
    "share",
  ),
  d(
    "delivery.book_rate_confirmed",
    "delivery",
    "Lead to confirmed booking",
    "Confirmed bookings over platform leads, last 30 days.",
    TRIAGE,
    "share",
  ),
  d(
    "delivery.show_rate",
    "delivery",
    "Client show rate",
    "Showed over showed plus no-show on meetings whose day has passed, last 30 days.",
    TRIAGE,
    "share",
    "Meetings nobody updated.",
  ),
  d(
    "delivery.close_rate",
    "delivery",
    "Client close rate",
    "Deals marked won by the client in Mahara OS outcomes over shown appointments, last 30 days.",
    "portal_data.appointment_outcomes in Creative Triage",
    "share",
    "Outcomes start on 2026-09-18.",
  ),
  d(
    "delivery.no_outcome",
    "delivery",
    "Appointments with no outcome",
    "Past appointments with no outcome in Mahara OS, last 30 days.",
    TRIAGE,
    "count",
  ),
  // --- calls (the clients' dialer) ---
  d(
    "calls.dials",
    "calls",
    "Dials",
    "Outbound calls with one agent on the Maqsam accounts the dialer imports.",
    "mahara_reporting.facts in Creative Triage",
    "count",
  ),
  d(
    "calls.connected",
    "calls",
    "Connected",
    "Outbound calls completed with talk time.",
    "mahara_reporting.facts",
    "count",
    "Can include voicemail.",
  ),
  d(
    "calls.connect_rate",
    "calls",
    "Connect rate",
    "Connected over dials.",
    "mahara_reporting.facts",
    "share",
  ),
  d(
    "calls.talk_minutes",
    "calls",
    "Talk minutes",
    "Minutes of talk on connected calls.",
    "mahara_reporting.facts",
    "minutes",
  ),
  d(
    "calls.speed_to_lead_median_min",
    "calls",
    "Speed to lead, clients, median minutes",
    "Minutes from a DFY client's lead creation to the first outbound dial to its phone, median over called leads.",
    "mahara_reporting.facts and client_leads",
    "minutes",
    "Only since 2026-09-12.",
  ),
  d(
    "calls.speed_to_lead_working_median_min",
    "calls",
    "Speed to lead on working hours, median minutes",
    "The same on the working clock: the clock starts at the later of creation and the next working window, working minutes only.",
    "cockpit_settings working hours",
    "minutes",
  ),
  // --- clients ---
  d(
    "clients.active",
    "clients",
    "Active clients",
    "Cards in an active stage.",
    CLICKUP,
    "count",
  ),
  d(
    "clients.onboarding",
    "clients",
    "Onboarding clients",
    "Cards in an onboarding stage.",
    CLICKUP,
    "count",
  ),
  d(
    "clients.paused",
    "clients",
    "Paused clients",
    "Cards whose stage says pause, freeze or hold.",
    CLICKUP,
    "count",
  ),
  d(
    "clients.churned",
    "clients",
    "Churned clients",
    "Cards whose stage says stopped, cancelled, churned, offboarded or lost.",
    CLICKUP,
    "count",
  ),
  d(
    "clients.high_risk",
    "clients",
    "High-risk clients",
    "Active or onboarding clients with a risk score of 5 or more.",
    "The cockpit's risk rule",
    "count",
  ),
  d(
    "clients.churn_rate",
    "clients",
    "Churn this month",
    "Launched clients that stopped this month over launched clients at the start of the month.",
    CLICKUP,
    "share",
    "Withheld when the month's history is incomplete.",
  ),
  d(
    "clients.average_days_to_launch",
    "clients",
    "Days to first launch",
    "Days from the ClickUp card's creation to its Launch Date, mean over launched clients.",
    CLICKUP,
    "days",
  ),
  d(
    "clients.extension_weeks",
    "clients",
    "Extension weeks granted",
    "Weeks granted through the Client Extension Form in the window.",
    "Typeform gqBcyK6g",
    "count",
  ),
  d(
    "clients.average_retainer",
    "clients",
    "Average retainer",
    "Mean MRR over active cards on a recurring plan.",
    CLICKUP,
    "usd",
  ),
  d(
    "clients.ltv",
    "clients",
    "Client LTV",
    "The LTV field on the client card, in USD.",
    CLICKUP,
    "usd",
    "Typed; the LTV write updates it from attributed payments.",
  ),
  d(
    "clients.mrr",
    "clients",
    "Client MRR",
    "The MRR field on the client card, in USD.",
    CLICKUP,
    "usd",
  ),
  // --- team ---
  d(
    "team.payroll_month",
    "team",
    "Payroll a month",
    "Monthly cost over active people, converted with the fixed rate table.",
    "cockpit_people",
    "usd",
    "A floor while anyone is uncosted.",
  ),
  d(
    "team.people_active",
    "team",
    "Active people",
    "People on the roster marked active.",
    "cockpit_people",
    "count",
  ),
  // --- organic ---
  d(
    "organic.instagram_followers",
    "organic",
    "Instagram followers",
    "The account's follower count.",
    "Meta Graph API",
    "count",
  ),
  d(
    "organic.instagram_reach_28d",
    "organic",
    "Instagram reach, 28 days",
    "Accounts reached over 28 days.",
    "Meta Graph API",
    "count",
  ),
  d(
    "organic.youtube_subscribers",
    "organic",
    "YouTube subscribers",
    "The channel's subscriber count.",
    "YouTube Data API",
    "count",
  ),
  // --- machine ---
  d(
    "machine.failing_checks",
    "machine",
    "Failing checks",
    "Sources with three failures in a row in the health ledger.",
    "The cockpit's health ledger",
    "count",
  ),
];

const r = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) ? x : null;

function growthWindow(w: FunnelWindow, window: string): MetricValue[] {
  const v = (metric: string, value: unknown): MetricValue => ({
    metric,
    scope: "company",
    window,
    value: r(value),
    windowFrom: w.from,
    windowTo: w.to,
  });
  return [
    v("growth.spend", w.spend),
    v("growth.spend_retargeting", w.raw?.spend_retargeting),
    v("growth.leads", w.leads),
    v("growth.leads_qualified", w.leadClasses?.qualified),
    v("growth.leads_unqualified", w.leadClasses?.unqualified),
    v("growth.leads_not_ready", w.leadClasses?.notReady),
    v("growth.leads_untagged", w.leadClasses?.untagged),
    v("growth.leads_ads", w.sources?.ads),
    v("growth.leads_organic", w.sources?.organic),
    v("growth.leads_assumed_ads", w.sources?.assumedAds),
    v("growth.cpl", w.cpl),
    v("growth.speed_to_lead_median_min", w.speedToLead?.medianMin),
    v("growth.speed_to_lead_called", w.speedToLead?.called),
    v("growth.speed_to_lead_never_called", w.speedToLead?.neverCalled),
    v("growth.speed_to_lead_within_5_share", w.speedToLead?.within5Share),
    v("growth.lead_to_booked_rate", w.leadToBooked?.rate),
    v("growth.intros_booked", w.introsBooked),
    v("growth.intros_due", w.introsDue),
    v("growth.intros_shown", w.introsShown),
    v("growth.intro_show_rate", w.introShowRate),
    v("growth.demos_booked", w.demosBooked),
    v("growth.demos_due", w.demosDue),
    v("growth.demos_shown", w.demosShown),
    v("growth.demo_show_rate", w.demoShowRate),
    v("growth.intro_cancel_rate", w.cancel?.intro),
    v("growth.demo_cancel_rate", w.cancel?.demo),
    v("growth.cancel_rate", w.cancel?.total),
    v("growth.closes", w.closes),
    v("growth.close_rate", w.closeRate),
    v("growth.qualified_close_rate", w.qualifiedCloseRate),
    v("growth.contracted", w.contracted),
    v("growth.front_end_cash", w.frontEndCash?.total),
    v("growth.front_end_cash_confirmed_share", w.frontEndCash?.confirmedShare),
    v("growth.roas_cash", w.roasCash),
    v("growth.roas_contracted", w.roasContracted),
    v("growth.cost_per_demo_shown", w.costPerDemo),
    v("growth.cac", w.cac),
  ];
}

export function extractGrowth(p: GrowthPayload): MetricValue[] {
  const out: MetricValue[] = [];
  for (const [key, w] of Object.entries(p.windows ?? {}))
    if (w) out.push(...growthWindow(w, key));
  return out;
}

export function extractMoney(p: MoneyPayload): MetricValue[] {
  const out: MetricValue[] = [];
  const v = (
    metric: string,
    window: string,
    value: unknown,
    scope = "company",
  ): void => {
    out.push({ metric, scope, window, value: r(value) });
  };
  const rails = p.rails;
  const railWindows = [
    "today",
    "yesterday",
    "mtd",
    "lastMonthToDate",
    "lastMonth",
  ] as const;
  if (rails) {
    for (const w of railWindows) {
      v("money.cash", w, rails.total?.[w]);
      v("money.cash_whop", w, rails.whop?.[w]);
      v("money.cash_tap", w, rails.tap?.[w]);
      v("money.cash_bank", w, rails.bank?.[w]);
      v("money.cash_manual", w, rails.manual?.[w]);
    }
  }
  v("money.refunds", "mtd", p.refunds?.mtd);
  v("money.refunds", "last90", p.refunds?.last90);
  v("money.deals", "mtd", p.deals?.mtd);
  v("money.deals", "lastMonth", p.deals?.lastMonth);
  v("money.contracted", "mtd", p.deals?.contractedMtd);
  v("money.contracted", "lastMonth", p.deals?.contractedLastMonth);
  if (p.attribution) {
    v("money.front_end_cash", "mtd", p.attribution.mtd?.frontEnd);
    v("money.back_end_cash", "mtd", p.attribution.mtd?.backEnd);
    v("money.unattributed_cash", "mtd", p.attribution.mtd?.unattributed);
    v("money.front_end_cash", "lastMonth", p.attribution.lastMonth?.frontEnd);
    v("money.back_end_cash", "lastMonth", p.attribution.lastMonth?.backEnd);
    v(
      "money.unattributed_cash",
      "lastMonth",
      p.attribution.lastMonth?.unattributed,
    );
    v("money.front_end_cash", "12m", p.attribution.totals?.frontEnd);
    v("money.back_end_cash", "12m", p.attribution.totals?.backEnd);
    v("money.unattributed_cash", "12m", p.attribution.totals?.unattributed);
    for (const person of p.attribution.byPerson ?? []) {
      v(
        "money.front_end_cash",
        "12m",
        person.frontEnd,
        `person:${person.name}`,
      );
      v("money.back_end_cash", "12m", person.backEnd, `person:${person.name}`);
    }
  }
  if (p.book) {
    v("money.projected_mrr", "mtd", p.book.projectedMrr);
    v("money.collected_from_recurring", "mtd", p.book.collected);
    v("money.collection_rate", "mtd", p.book.collectionRate);
    v("money.average_retainer", "snapshot", p.book.averageRetainer);
  }
  if (p.bank) v("money.bank_statement_age_days", "snapshot", p.bank.daysSince);
  return out;
}

export function extractDelivery(p: DeliveryPayload): MetricValue[] {
  const out: MetricValue[] = [];
  const v = (
    metric: string,
    window: string,
    value: unknown,
    scope = "company",
  ): void => {
    out.push({ metric, scope, window, value: r(value) });
  };
  for (const w of ["yesterday", "last7", "prevLast7", "mtd"] as const) {
    const x = p[w];
    if (!x) continue;
    v("delivery.spend", w, x.spend);
    v("delivery.leads", w, x.leads);
    v("delivery.bookings", w, x.bookings);
    v("delivery.bookings_confirmed", w, x.confirmed);
    v("delivery.bookings_provisional", w, x.provisional);
    v("delivery.cpl", w, x.cpl);
    v("delivery.cpb", w, x.cpb);
    v("delivery.cpb_confirmed", w, x.cpbConfirmed);
  }
  for (const c of p.clients ?? []) {
    if (!c.clickupTaskId) continue;
    const scope = `client:${c.clickupTaskId}`;
    v("delivery.spend", "last7", c.spend7d, scope);
    v("delivery.leads", "last7", c.leads7d, scope);
    v("delivery.bookings", "last7", c.bookings7d, scope);
    v("delivery.bookings_confirmed", "last7", c.confirmed7d, scope);
    v("delivery.cpl", "last7", c.cpl7d, scope);
    v("delivery.cpb", "last7", c.cpb7d, scope);
    v("delivery.cpb_confirmed", "last7", c.cpbConfirmed7d, scope);
    const rt = c.rates30;
    if (rt) {
      v("delivery.book_rate", "last30", rt.bookRate, scope);
      v("delivery.book_rate_confirmed", "last30", rt.bookRateConfirmed, scope);
      v("delivery.show_rate", "last30", rt.showRate, scope);
      v("delivery.close_rate", "last30", rt.closeRate, scope);
      v("delivery.no_outcome", "last30", rt.noOutcome, scope);
    }
  }
  return out;
}

export function extractCalls(p: CallsPayload): MetricValue[] {
  const out: MetricValue[] = [];
  const v = (
    metric: string,
    window: string,
    value: unknown,
    scope = "company",
  ): void => {
    out.push({ metric, scope, window, value: r(value) });
  };
  for (const w of ["today", "yesterday", "last7", "prevLast7"] as const) {
    const x = p[w];
    if (!x) continue;
    v("calls.dials", w, x.dials);
    v("calls.connected", w, x.connected);
    v("calls.connect_rate", w, x.connectRate);
    v("calls.talk_minutes", w, x.talkMinutes);
  }
  v("calls.speed_to_lead_median_min", "last7", p.speedToLead?.medianMinutes7d);
  v(
    "calls.speed_to_lead_working_median_min",
    "last7",
    p.speedToLead?.workingMedianMinutes7d,
  );
  for (const a of p.byAgent ?? []) {
    v("calls.dials", "last7", a.last7?.dials, `person:${a.agent}`);
    v("calls.connected", "last7", a.last7?.connected, `person:${a.agent}`);
  }
  for (const c of p.perClient7d ?? [])
    if (c.clickupTaskId)
      v("calls.dials", "last7", c.dials, `client:${c.clickupTaskId}`);
  return out;
}

export function extractClients(p: ClientsPayload): MetricValue[] {
  const out: MetricValue[] = [];
  const v = (
    metric: string,
    window: string,
    value: unknown,
    scope = "company",
  ): void => {
    out.push({ metric, scope, window, value: r(value) });
  };
  v("clients.active", "snapshot", p.counts?.active);
  v("clients.onboarding", "snapshot", p.counts?.onboarding);
  v("clients.paused", "snapshot", p.counts?.paused);
  v("clients.churned", "snapshot", p.counts?.churned);
  v(
    "clients.high_risk",
    "snapshot",
    (p.rows ?? []).filter(
      x =>
        x.risk?.level === "high" &&
        (x.bucket === "active" || x.bucket === "onboarding"),
    ).length,
  );
  v("clients.churn_rate", "mtd", p.churn?.rate);
  v("clients.average_days_to_launch", "all", p.launch?.averageDays);
  v("clients.extension_weeks", "mtd", p.extensions?.totalWeeks);
  v("clients.average_retainer", "snapshot", p.retainer?.averageUsd);
  for (const row of p.rows ?? []) {
    const scope = `client:${row.clickupTaskId}`;
    if (typeof row.ltvUsd === "number")
      v("clients.ltv", "snapshot", row.ltvUsd, scope);
    if (typeof row.mrrUsd === "number")
      v("clients.mrr", "snapshot", row.mrrUsd, scope);
  }
  return out;
}

export function extractTeam(p: TeamPayload): MetricValue[] {
  const out: MetricValue[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: payroll shape varies by payload version
  const any = p as any;
  const payroll =
    any?.payroll?.monthlyUsd ?? any?.payroll?.totalUsd ?? any?.payrollMonthUsd;
  if (typeof payroll === "number")
    out.push({
      metric: "team.payroll_month",
      scope: "company",
      window: "snapshot",
      value: payroll,
    });
  const people = Array.isArray(any?.people)
    ? any.people.filter(
        (x: { status?: string }) => (x.status ?? "active") === "active",
      ).length
    : null;
  if (people !== null)
    out.push({
      metric: "team.people_active",
      scope: "company",
      window: "snapshot",
      value: people,
    });
  return out;
}

export function extractOrganic(p: OrganicPayload): MetricValue[] {
  // biome-ignore lint/suspicious/noExplicitAny: nested optional blocks
  const any = p as any;
  const out: MetricValue[] = [];
  const ig = any?.instagram;
  if (ig) {
    out.push({
      metric: "organic.instagram_followers",
      scope: "company",
      window: "snapshot",
      value: r(ig.followers),
    });
    out.push({
      metric: "organic.instagram_reach_28d",
      scope: "company",
      window: "last28",
      value: r(ig.reach28d ?? ig.reach),
    });
  }
  const yt = any?.youtube;
  if (yt)
    out.push({
      metric: "organic.youtube_subscribers",
      scope: "company",
      window: "snapshot",
      value: r(yt.subscribers),
    });
  return out;
}

export function extractMachine(p: MachinePayload): MetricValue[] {
  // biome-ignore lint/suspicious/noExplicitAny: nested optional blocks
  const any = p as any;
  const failing = Array.isArray(any?.failing)
    ? any.failing.length
    : r(any?.failingChecks);
  return failing === null || failing === undefined
    ? []
    : [
        {
          metric: "machine.failing_checks",
          scope: "company",
          window: "snapshot",
          value: Number(failing),
        },
      ];
}

/** Every value a section's payload yields, by section key. Unknown sections yield nothing. */
export function extract(key: string, payload: unknown): MetricValue[] {
  if (!payload || typeof payload !== "object") return [];
  try {
    switch (key) {
      case "growth":
        return extractGrowth(payload as GrowthPayload);
      case "money":
        return extractMoney(payload as MoneyPayload);
      case "delivery":
        return extractDelivery(payload as DeliveryPayload);
      case "calls":
        return extractCalls(payload as CallsPayload);
      case "clients":
        return extractClients(payload as ClientsPayload);
      case "team":
        return extractTeam(payload as TeamPayload);
      case "organic":
        return extractOrganic(payload as OrganicPayload);
      case "machine":
        return extractMachine(payload as MachinePayload);
      default:
        return [];
    }
  } catch {
    return [];
  }
}
