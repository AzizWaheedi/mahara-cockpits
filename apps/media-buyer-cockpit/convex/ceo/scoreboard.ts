import type {
  CallsPayload,
  ClientsPayload,
  DeliveryPayload,
  ExpensesPayload,
  GrowthDay,
  GrowthPayload,
  MoneyPayload,
  OrganicPayload,
} from "./payloads";

/**
 * Every number a goal can be scored against, in one catalogue.
 *
 * Aziz, 2026-09-22: "set goals and projections for how we're going to get
 * there through our front-end funnel numbers, all of them, until the AOV and
 * the total cash collected (new cash), and then the back-end for how much MRR
 * collection and what percent MRR we want to collect."
 *
 * A plan is a list of targets, and a target names the metric that scores it.
 * This is that list of names. Each entry says where the number comes from and
 * reads it for any run of days, so a plan for any period is marked against the
 * same numbers the rest of the cockpit shows — never a second definition, and
 * never a number retyped by hand into two places.
 *
 * Three honesty rules, kept here so every screen inherits them.
 *
 * 1. A metric that cannot be read for the window returns null, never zero. The
 *    screen then shows the target with no score rather than a fake miss.
 * 2. A metric the cockpit does not measure at all — Google reviews, video
 *    testimonials, SOPs written — is still in the catalogue with `manual`
 *    true, so it can be planned and typed, and the screen says a person
 *    filled it in.
 * 3. Month-shaped numbers (MRR collection, the P&L) say so with `monthOnly`.
 *    Asked for a window that is not a whole month they return null, because a
 *    fifth of a month's MRR collection is not a number anybody should read.
 */

export type Unit = "usd" | "count" | "rate" | "days" | "x" | "pts" | "text";

export type MetricDef = {
  key: string;
  label: string;
  group: GroupKey;
  unit: Unit;
  /** Whether a bigger number is better. */
  direction: "up" | "down";
  /** One sentence: where the number comes from and what it leaves out. */
  source: string;
  /** True when nothing in the cockpit measures it and the actual is typed. */
  manual?: boolean;
  /** True when it only means anything over a whole calendar month. */
  monthOnly?: boolean;
  /**
   * True when the number does not accumulate: a unit cost, an average, a
   * per-day rate or a headcount is the same size on day one as on day thirty.
   * Pacing one of those would compare a $10 cost per lead against $7.31
   * because three quarters of the month has gone, which is nonsense.
   */
  level?: boolean;
};

export type GroupKey =
  | "front_end"
  | "back_end"
  | "money"
  | "delivery"
  | "calls"
  | "content"
  | "creative"
  | "systems"
  | "team";

export const GROUPS: { key: GroupKey; label: string; blurb: string }[] = [
  {
    key: "front_end",
    label: "Front end",
    blurb: "Spend to signature: the ladder from an impression to a client.",
  },
  {
    key: "back_end",
    label: "Back end",
    blurb: "The book we already have: retainers, upsells, referrals, churn.",
  },
  {
    key: "money",
    label: "Money",
    blurb: "What was collected, what it cost, and what was left.",
  },
  {
    key: "delivery",
    label: "Client results",
    blurb: "The standard we hold ourselves to on a client's own account.",
  },
  {
    key: "calls",
    label: "Call centre",
    blurb: "Dials, talk time and booking.",
  },
  {
    key: "content",
    label: "Content",
    blurb: "What gets published and what it brings back.",
  },
  {
    key: "creative",
    label: "Creative",
    blurb: "Scripts, edits and the ads that come out of them.",
  },
  {
    key: "systems",
    label: "Systems",
    blurb: "Automation, onboarding and the fires that stop work.",
  },
  { key: "team", label: "Team", blurb: "Payroll, hiring and who we keep." },
];

// biome-ignore lint/suspicious/noExplicitAny: payloads are read defensively
type Any = Record<string, any>;

export type Payloads = {
  growth?: GrowthPayload | null;
  money?: MoneyPayload | null;
  clients?: ClientsPayload | null;
  delivery?: DeliveryPayload | null;
  calls?: CallsPayload | null;
  organic?: OrganicPayload | null;
  expenses?: ExpensesPayload | null;
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const div = (a: number | null, b: number | null) =>
  a !== null && b !== null && b > 0 ? r2(a / b) : null;

/** The days of the growth series inside the window. */
function days(p: Payloads, from: string, to: string): GrowthDay[] {
  return (p.growth?.daily ?? []).filter(d => d.date >= from && d.date <= to);
}

function sum(
  p: Payloads,
  from: string,
  to: string,
  pick: (d: GrowthDay) => number | undefined,
): number | null {
  const rows = days(p, from, to);
  if (!rows.length) return null;
  return r2(rows.reduce((t, d) => t + (pick(d) ?? 0), 0));
}

/** Money in the window by side and kind, from the attributed payment list. */
function cash(
  p: Payloads,
  from: string,
  to: string,
  keep: (t: Any) => boolean,
): number | null {
  const tx = (p.money as Any)?.attribution?.transactions as Any[] | undefined;
  if (!tx) return null;
  const rows = tx.filter(
    t => t.day >= from && t.day <= to && t.direction === "in" && keep(t),
  );
  return r2(rows.reduce((n, t) => n + Number(t.usd ?? 0), 0));
}

function out(p: Payloads, from: string, to: string): number | null {
  const tx = (p.money as Any)?.attribution?.transactions as Any[] | undefined;
  if (!tx) return null;
  const rows = tx.filter(
    t => t.day >= from && t.day <= to && t.direction === "out",
  );
  return r2(rows.reduce((n, t) => n + Number(t.usd ?? 0), 0));
}

/**
 * The month a window belongs to, or null when it is not one month's worth.
 *
 * A window from the first of a month to any day inside it is that month: the
 * book's own numbers are month to date, so a plan can be scored against them
 * on the nineteenth and not only on the last day. A window that starts
 * mid-month or crosses into another one is not a month, and every month-only
 * metric returns null rather than a share of something that does not divide.
 */
function monthOf(from: string, to: string): string | null {
  if (from.slice(0, 7) !== to.slice(0, 7)) return null;
  return from.endsWith("-01") ? from.slice(0, 7) : null;
}

type Reader = (p: Payloads, from: string, to: string) => number | null;

/**
 * The catalogue. Order inside a group is the order the plan shows, and for
 * the front end that order is the funnel itself, because the screen draws it
 * as a ladder and a rung out of order would be a lie about the business.
 */
const READERS: Record<string, Reader> = {
  // --- front end, in funnel order ---
  spend: (p, f, t) => sum(p, f, t, d => d.spend),
  spendRetargeting: (p, f, t) => sum(p, f, t, d => d.spendRetargeting),
  leads: (p, f, t) => sum(p, f, t, d => d.leads),
  cpl: (p, f, t) =>
    div(
      sum(p, f, t, d => d.spend),
      sum(p, f, t, d => d.leads),
    ),
  bookableLeads: (p, f, t) => sum(p, f, t, d => d.qualified),
  costPerBookableLead: (p, f, t) =>
    div(
      sum(p, f, t, d => d.spend),
      sum(p, f, t, d => d.qualified),
    ),
  leadToBooked: (p, f, t) =>
    div(
      sum(p, f, t, d => d.bookedLeads),
      sum(p, f, t, d => d.leads),
    ),
  introsBooked: (p, f, t) => sum(p, f, t, d => d.introsBooked),
  costPerIntroBooked: (p, f, t) =>
    div(
      sum(p, f, t, d => d.spend),
      sum(p, f, t, d => d.introsBooked),
    ),
  introShowRate: (p, f, t) =>
    div(
      sum(p, f, t, d => d.introsShown),
      sum(p, f, t, d => d.introsDue),
    ),
  introsShown: (p, f, t) => sum(p, f, t, d => d.introsShown),
  costPerIntroShown: (p, f, t) =>
    div(
      sum(p, f, t, d => d.spend),
      sum(p, f, t, d => d.introsShown),
    ),
  demosBooked: (p, f, t) => sum(p, f, t, d => d.demosBooked),
  costPerDemoBooked: (p, f, t) =>
    div(
      sum(p, f, t, d => d.spend),
      sum(p, f, t, d => d.demosBooked),
    ),
  demoShowRate: (p, f, t) =>
    div(
      sum(p, f, t, d => d.demosShown),
      sum(p, f, t, d => d.demosDue),
    ),
  demosShown: (p, f, t) => sum(p, f, t, d => d.demosShown),
  costPerDemoShown: (p, f, t) =>
    div(
      sum(p, f, t, d => d.spend),
      sum(p, f, t, d => d.demosShown),
    ),
  demosQualified: (p, f, t) => sum(p, f, t, d => d.demosQualified),
  closeRate: (p, f, t) =>
    div(
      sum(p, f, t, d => d.closes),
      sum(p, f, t, d => d.demosShown),
    ),
  closes: (p, f, t) => sum(p, f, t, d => d.closes),
  cac: (p, f, t) =>
    div(
      sum(p, f, t, d => d.spend),
      sum(p, f, t, d => d.closes),
    ),
  contracted: (p, f, t) => sum(p, f, t, d => d.contracted),
  aov: (p, f, t) =>
    div(
      sum(p, f, t, d => d.contracted),
      sum(p, f, t, d => d.closes),
    ),
  newCash: (p, f, t) => cash(p, f, t, x => x.side === "front_end"),
  roasContracted: (p, f, t) =>
    div(
      sum(p, f, t, d => d.contracted),
      sum(p, f, t, d => d.spend),
    ),

  // --- back end ---
  backEndCash: (p, f, t) => cash(p, f, t, x => x.side === "back_end"),
  mrrProjected: (p, f, t) => {
    const m = monthOf(f, t);
    const book = (p.money as Any)?.book;
    return m && book?.month === m ? r2(Number(book.projectedMrr ?? 0)) : null;
  },
  mrrCollected: (p, f, t) => {
    const m = monthOf(f, t);
    const book = (p.money as Any)?.book;
    return m && book?.month === m ? r2(Number(book.collected ?? 0)) : null;
  },
  mrrCollectionRate: (p, f, t) => {
    const m = monthOf(f, t);
    const book = (p.money as Any)?.book;
    return m && book?.month === m && book.collectionRate !== null
      ? r2(Number(book.collectionRate))
      : null;
  },
  averageRetainer: (p, f, t) => {
    const m = monthOf(f, t);
    const book = (p.money as Any)?.book;
    return m && book?.month === m && book.averageRetainer !== null
      ? r2(Number(book.averageRetainer))
      : null;
  },
  activeClients: p => {
    const groups = (p.money as Any)?.mrr?.groups as Any[] | undefined;
    const active = groups?.find(g => g.group === "active");
    return active ? Number(active.cards ?? 0) : null;
  },

  // --- money ---
  totalCash: (p, f, t) => cash(p, f, t, () => true),
  moneyOut: (p, f, t) => out(p, f, t),
  profit: (p, f, t) => {
    const inn = cash(p, f, t, () => true);
    const o = out(p, f, t);
    return inn !== null && o !== null ? r2(inn - o) : null;
  },
  margin: (p, f, t) => {
    const inn = cash(p, f, t, () => true);
    const o = out(p, f, t);
    return inn !== null && o !== null && inn > 0 ? r2((inn - o) / inn) : null;
  },

  // --- client results ---
  clientSpend: (p, f, t) => {
    const rows = (p.delivery?.daily ?? []).filter(
      d => d.date >= f && d.date <= t,
    );
    return rows.length ? r2(rows.reduce((n, d) => n + d.spend, 0)) : null;
  },
  clientLeads: (p, f, t) => {
    const rows = (p.delivery?.daily ?? []).filter(
      d => d.date >= f && d.date <= t,
    );
    return rows.length ? rows.reduce((n, d) => n + d.leads, 0) : null;
  },
  clientBookings: (p, f, t) => {
    const rows = (p.delivery?.daily ?? []).filter(
      d => d.date >= f && d.date <= t,
    );
    return rows.length ? rows.reduce((n, d) => n + d.bookings, 0) : null;
  },
  clientCpl: (p, f, t) =>
    div(READERS.clientSpend(p, f, t), READERS.clientLeads(p, f, t)),
  clientCpb: (p, f, t) =>
    div(READERS.clientSpend(p, f, t), READERS.clientBookings(p, f, t)),

  // --- content ---
  contentPosts: (p, f, t) => {
    const b = (p.organic as Any)?.business;
    if (!b || b.from !== f || b.to !== t) return null;
    const n = (b.platforms as Any[]).reduce(
      (x, q) => x + (q.posts ?? 0),
      0 as number,
    );
    return n;
  },
  contentContacts: (p, f, t) => {
    const b = (p.organic as Any)?.business;
    if (!b || b.from !== f || b.to !== t) return null;
    return (b.platforms as Any[])
      .filter(q => q.platform !== "Reactivation" && q.platform !== "Not named")
      .reduce((x, q) => x + (q.contacts ?? 0), 0 as number);
  },
};

/** What each key is, in the order the plan shows it. */
export const METRICS: MetricDef[] = [
  // Front end, in funnel order.
  m(
    "spend",
    "Ad spend",
    "front_end",
    "usd",
    "up",
    "Lead-gen spend on Mahara's own account, by Meta day. Retargeting is beside it, never inside a cost per lead.",
  ),
  m(
    "spendRetargeting",
    "Retargeting spend",
    "front_end",
    "usd",
    "up",
    "Retargeting spend on Mahara's own account, kept apart from lead gen.",
  ),
  m(
    "leads",
    "Leads",
    "front_end",
    "count",
    "up",
    "Contacts tagged roas-qualified or roas-unqualified, by the day they were created.",
  ),
  m(
    "cpl",
    "Cost per lead",
    "front_end",
    "usd",
    "down",
    "Lead-gen spend over those leads.",
    { level: true },
  ),
  m(
    "bookableLeads",
    "Bookable leads",
    "front_end",
    "count",
    "up",
    "Leads tagged roas-qualified: the ones worth a booking attempt.",
  ),
  m(
    "costPerBookableLead",
    "Cost per bookable lead",
    "front_end",
    "usd",
    "down",
    "Lead-gen spend over qualified leads.",
    { level: true },
  ),
  m(
    "leadToBooked",
    "Lead to booking",
    "front_end",
    "rate",
    "up",
    "Leads that ever booked an intro or a demo, over leads.",
  ),
  m(
    "introsBooked",
    "Intros booked",
    "front_end",
    "count",
    "up",
    "Intro calls booked, by the day they were booked.",
  ),
  m(
    "costPerIntroBooked",
    "Cost per intro booked",
    "front_end",
    "usd",
    "down",
    "Lead-gen spend over intros booked.",
    { level: true },
  ),
  m(
    "introShowRate",
    "Intro show rate",
    "front_end",
    "rate",
    "up",
    "Intros shown over intros whose time has passed. Confirmed or showed counts as shown.",
  ),
  m(
    "introsShown",
    "Intros shown",
    "front_end",
    "count",
    "up",
    "Intro calls held.",
  ),
  m(
    "costPerIntroShown",
    "Cost per intro shown",
    "front_end",
    "usd",
    "down",
    "Lead-gen spend over intros shown.",
    { level: true },
  ),
  m(
    "demosBooked",
    "Demos booked",
    "front_end",
    "count",
    "up",
    "Demo calls booked, by the day they were booked.",
  ),
  m(
    "costPerDemoBooked",
    "Cost per demo booked",
    "front_end",
    "usd",
    "down",
    "Lead-gen spend over demos booked.",
    { level: true },
  ),
  m(
    "demoShowRate",
    "Demo show rate",
    "front_end",
    "rate",
    "up",
    "Demos shown over demos whose time has passed.",
  ),
  m("demosShown", "Live demos", "front_end", "count", "up", "Demo calls held."),
  m(
    "costPerDemoShown",
    "Cost per live demo",
    "front_end",
    "usd",
    "down",
    "Lead-gen spend over demos shown.",
    { level: true },
  ),
  m(
    "demosQualified",
    "Qualified demos",
    "front_end",
    "count",
    "up",
    "Demos shown that were a real fit.",
  ),
  m(
    "closeRate",
    "Close rate",
    "front_end",
    "rate",
    "up",
    "Signed deals over demos shown.",
  ),
  m(
    "closes",
    "Clients signed",
    "front_end",
    "count",
    "up",
    "Closer-form submissions, by the day the form was filled.",
  ),
  m(
    "cac",
    "Cost per acquisition",
    "front_end",
    "usd",
    "down",
    "Lead-gen spend over clients signed.",
    { level: true },
  ),
  m(
    "contracted",
    "Contracted revenue",
    "front_end",
    "usd",
    "up",
    "Contract value typed on the closer form.",
  ),
  m(
    "aov",
    "Average order value",
    "front_end",
    "usd",
    "up",
    "Contracted revenue over clients signed.",
    { level: true },
  ),
  m(
    "newCash",
    "New-client cash",
    "front_end",
    "usd",
    "up",
    "Payments attributed to the front end: deposits at signing and the rest of the cash inside the front-end window.",
  ),
  m(
    "roasContracted",
    "Contracted ROAS",
    "front_end",
    "x",
    "up",
    "Contracted revenue over lead-gen spend.",
  ),

  // Back end.
  m(
    "backEndCash",
    "Back-end cash",
    "back_end",
    "usd",
    "up",
    "Payments matched to an existing client after its front-end window.",
  ),
  m(
    "mrrProjected",
    "MRR due",
    "back_end",
    "usd",
    "up",
    "The MRR field on active ClickUp cards on a recurring plan. A number somebody typed on a card, not measured revenue.",
    { monthOnly: true },
  ),
  m(
    "mrrCollected",
    "MRR collected",
    "back_end",
    "usd",
    "up",
    "Cash attributed to those same clients in the month, every rail.",
    { monthOnly: true },
  ),
  m(
    "mrrCollectionRate",
    "MRR collection rate",
    "back_end",
    "rate",
    "up",
    "Collected over due, on the clients the book says are recurring.",
    { monthOnly: true },
  ),
  m(
    "averageRetainer",
    "Average retainer",
    "back_end",
    "usd",
    "up",
    "Mean MRR over active cards on a recurring plan.",
    { monthOnly: true, level: true },
  ),
  m(
    "activeClients",
    "Active clients",
    "back_end",
    "count",
    "up",
    "ClickUp cards in an active stage. Counted now, not over the window.",
    { level: true },
  ),
  m(
    "upsellCash",
    "Upsell cash",
    "back_end",
    "usd",
    "up",
    "Upsells closed on the existing book. Nothing in the cockpit separates an upsell payment from a retainer yet, so this is typed.",
    { manual: true },
  ),
  m(
    "upsellRate",
    "Upsell rate",
    "back_end",
    "rate",
    "up",
    "Upsells over active clients, typed.",
    { manual: true },
  ),
  m(
    "referrals",
    "Referral deals",
    "back_end",
    "count",
    "up",
    "Deals that came from an existing client, typed.",
    { manual: true },
  ),
  m(
    "churnRate",
    "Churn",
    "back_end",
    "rate",
    "down",
    "Clients lost over clients held. Typed until the cockpit reads a leaving date on every card.",
    { manual: true },
  ),
  m("testimonials", "Video testimonials", "back_end", "count", "up", "Typed."),
  m("googleReviews", "Google reviews", "back_end", "count", "up", "Typed."),
  m(
    "caseStudies",
    "Case studies recorded",
    "back_end",
    "count",
    "up",
    "Typed.",
  ),

  // Money.
  m(
    "totalCash",
    "Total cash collected",
    "money",
    "usd",
    "up",
    "Every payment in, on every rail, in the window.",
  ),
  m(
    "moneyOut",
    "Money out",
    "money",
    "usd",
    "down",
    "Refunds and the bank statement's expenses in the window.",
  ),
  m(
    "profit",
    "Profit",
    "money",
    "usd",
    "up",
    "Cash in less money out. Payroll paid outside the statement is not in it.",
  ),
  m("margin", "Margin", "money", "rate", "up", "Profit over cash in."),
  m(
    "labour",
    "Payroll",
    "money",
    "usd",
    "down",
    "What the team costs this period. Typed until every payment runs through one rail.",
    { manual: true },
  ),
  m(
    "overhead",
    "Software and overhead",
    "money",
    "usd",
    "down",
    "Typed from the plan; the statement's own total is on the Money tab.",
    { manual: true },
  ),
  m(
    "processingFees",
    "Payment processing fees",
    "money",
    "usd",
    "down",
    "Typed.",
    { manual: true },
  ),

  // Client results.
  m(
    "clientSpend",
    "Client ad spend",
    "delivery",
    "usd",
    "up",
    "Money spent on client ad accounts. Never added to Mahara's own.",
  ),
  m(
    "clientLeads",
    "Client leads",
    "delivery",
    "count",
    "up",
    "Leads on client ad accounts.",
  ),
  m(
    "clientCpl",
    "Client cost per lead",
    "delivery",
    "usd",
    "down",
    "Client ad spend over client leads: the standard we sell.",
    { level: true },
  ),
  m(
    "clientBookings",
    "Client bookings",
    "delivery",
    "count",
    "up",
    "Bookings on client calendars, by the day they are for.",
  ),
  m(
    "clientCpb",
    "Client cost per booking",
    "delivery",
    "usd",
    "down",
    "Client ad spend over client bookings.",
    { level: true },
  ),
  m(
    "clientLeadToBooking",
    "Client lead to booking",
    "delivery",
    "rate",
    "up",
    "Bookings over leads on a client's own account. Typed until every client's calendar is read.",
    { manual: true },
  ),
  m(
    "clientShowRate",
    "Client booking to show",
    "delivery",
    "rate",
    "up",
    "Typed until every client marks attendance.",
    { manual: true },
  ),
  m(
    "clientCloseRate",
    "Client show to close",
    "delivery",
    "rate",
    "up",
    "Typed: only the client knows which meetings became projects.",
    { manual: true },
  ),
  m(
    "timeToLaunch",
    "Days to launch a new client",
    "delivery",
    "days",
    "down",
    "Typed.",
    { manual: true, level: true },
  ),
  m(
    "trackingIntact",
    "Accounts with tracking intact",
    "delivery",
    "rate",
    "up",
    "Typed.",
    { manual: true },
  ),

  // Call centre.
  m(
    "dialsPerDay",
    "Dials per agent per day",
    "calls",
    "count",
    "up",
    "Typed from the dialler's own report.",
    { manual: true, level: true },
  ),
  m(
    "talkMinutes",
    "Talk minutes per agent per day",
    "calls",
    "count",
    "up",
    "Typed.",
    { manual: true, level: true },
  ),
  m(
    "callGapMinutes",
    "Gap between calls",
    "calls",
    "count",
    "down",
    "Typed; the Calls tab measures it live over working hours.",
    { manual: true, level: true },
  ),
  m("agents", "Agents on the floor", "calls", "count", "up", "Typed.", {
    manual: true,
    level: true,
  }),

  // Content.
  m(
    "contentPosts",
    "Posts published",
    "content",
    "count",
    "up",
    "Reels and videos in the asset library, by publish date.",
  ),
  m(
    "contentContacts",
    "Contacts from content",
    "content",
    "count",
    "up",
    "Contacts that arrived with no evidence of a paid ad, by platform.",
  ),
  m("youtubeVideos", "YouTube videos", "content", "count", "up", "Typed.", {
    manual: true,
  }),
  m("reels", "Reels", "content", "count", "up", "Typed.", { manual: true }),
  m("studioDays", "Studio recording days", "content", "count", "up", "Typed.", {
    manual: true,
  }),

  // Creative.
  m(
    "scriptsPerDay",
    "Client ad scripts a day",
    "creative",
    "count",
    "up",
    "Typed.",
    { manual: true, level: true },
  ),
  m(
    "editsPerDay",
    "Finished videos a day",
    "creative",
    "count",
    "up",
    "Typed.",
    { manual: true, level: true },
  ),
  m(
    "newAdsLaunched",
    "New Mahara ads launched",
    "creative",
    "count",
    "up",
    "Typed.",
    { manual: true },
  ),
  m(
    "templatedClientAds",
    "Templated client ads produced",
    "creative",
    "count",
    "up",
    "Typed.",
    { manual: true },
  ),

  // Systems.
  m("sopsWritten", "SOPs written", "systems", "count", "up", "Typed.", {
    manual: true,
  }),
  m(
    "automationsFixed",
    "Automations fixed",
    "systems",
    "count",
    "up",
    "Typed.",
    { manual: true },
  ),
  m("rndTests", "R&D tests run", "systems", "count", "up", "Typed.", {
    manual: true,
  }),

  // Team.
  m(
    "hires",
    "People hired",
    "team",
    "count",
    "up",
    "Typed; the Recruiting tab holds the funnel.",
    { manual: true },
  ),
  m(
    "payrollFixedShare",
    "Share of payroll that is fixed",
    "team",
    "rate",
    "down",
    "Typed.",
    { manual: true },
  ),
  m(
    "scorecardsDone",
    "Scorecards reviewed",
    "team",
    "count",
    "up",
    "Counted from the scorecards marked final for the month, on the Team tab.",
  ),
];

function m(
  key: string,
  label: string,
  group: GroupKey,
  unit: Unit,
  direction: "up" | "down",
  source: string,
  extra: { manual?: boolean; monthOnly?: boolean; level?: boolean } = {},
): MetricDef {
  return { key, label, group, unit, direction, source, ...extra };
}

export const METRIC_BY_KEY: Record<string, MetricDef> = Object.fromEntries(
  METRICS.map(x => [x.key, x]),
);

/**
 * Read every measurable metric for a window. A key with no reader, or one
 * whose source could not answer, is absent rather than zero.
 */
export function scoreboard(
  p: Payloads,
  from: string,
  to: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of METRICS) {
    if (def.manual) continue;
    const read = READERS[def.key];
    if (!read) continue;
    try {
      const v = read(p, from, to);
      if (v !== null && Number.isFinite(v)) out[def.key] = v;
    } catch {
      // A payload shaped differently from what a reader expects is a missing
      // number, not a broken screen.
    }
  }
  return out;
}

/** The first and last day the growth series covers, for the date pickers. */
export function seriesBounds(p: Payloads): {
  first: string | null;
  last: string | null;
} {
  const d = p.growth?.daily ?? [];
  return {
    first: d[0]?.date ?? null,
    last: d[d.length - 1]?.date ?? null,
  };
}
