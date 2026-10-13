/**
 * One client's call centre, read the same way in the client success cockpit
 * and the media buyer cockpit (Aziz, 2026-10-13): "dials, dials per ad, dials
 * per campaign ... How much time have the leads been caught in? ... is this a
 * call center issue or is it not?"
 *
 * The numbers come from public.cockpit_client_calls (migration
 * 20261013180000): the dialer's own report for the headline, then campaigns,
 * ads, waiting leads and lost reasons worked out with the dialer's link rule.
 * This file holds the shape of that answer, the one verdict both cockpits
 * show, and how its numbers read.
 *
 * The media buyer cockpit holds this same file, byte for byte, at
 * apps/media-buyer-cockpit/src/lib/callCentre.ts (an app cannot import from
 * another); scripts/check-shared.sh stops the two drifting. It imports only
 * zod and the gates in kpi.ts, which are identical in both apps.
 *
 * Missing is never zero: a count the database did not send fails the read,
 * and a rate with nothing under it is null and reads "Not measured".
 */
import { z } from "zod";
import {
  BOOKING_RATE_GATE,
  CONVERSATION_GATE,
  FIRST_CALL_MINUTES,
  FOLLOW_UP_ATTEMPTS,
  REACHED_GATE,
} from "./kpi.ts";

// ---------------------------------------------------------------------------
// The read.

const count = z.number().int().nonnegative();
const maybeNumber = z
  .number()
  .nullable()
  .optional()
  .transform(v => v ?? null);
const maybeText = z
  .string()
  .nullable()
  .optional()
  .transform(v => v ?? null);

/** One campaign, one ad, or the client as a whole, over the period's leads. */
const RowSchema = z.object({
  id: maybeText,
  name: maybeText,
  campaignId: maybeText,
  campaignName: maybeText,
  leads: count,
  called: count,
  dials: count,
  reached: count,
  talked30: count,
  talked120: count,
  booked: count,
  confirmed: count,
  medianFirstCallSeconds: maybeNumber,
});

/** The client's row in public.mahara_call_center_report, as it is. */
const OfficialSchema = z.object({
  leads: count,
  leadsDialed: count,
  leadsContacted: count,
  noVerifiedDial: count,
  /** Verified Maqsam calls: what this page calls dials. */
  providerDials: count,
  connections: count,
  /** Outcomes the agents saved, the dialer's own "dials". */
  dials: count,
  talkSeconds: maybeNumber,
  connectionRate: maybeNumber,
  medianSpeedSeconds: maybeNumber,
  avgSpeedSeconds: maybeNumber,
  speedSamples: count,
  withinTwoMinutes: count,
  confirmedBookings: count,
  provisionalBookings: count,
  unclassifiedBookings: count,
  shows: count,
  noShow: count,
  showRate: maybeNumber,
  closed: count,
});

const PersonSchema = z.object({ email: z.string(), name: z.string() });

const SpeedPartSchema = z.object({
  leads: count,
  called: count,
  withinFiveMinutes: count,
  withinThirtyMinutes: count,
  medianClockSeconds: maybeNumber,
});

export const CallCentreSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  timezone: z.string(),
  from: z.string(),
  to: z.string(),
  client: z.object({
    locationId: z.string(),
    name: z.string(),
    clickupId: maybeText,
    status: maybeText,
    /** "DFY" (we call), "DWY" (the client calls) or not set. */
    serviceMode: maybeText,
    country: maybeText,
    dialerActive: z.boolean(),
  }),
  official: OfficialSchema.nullable(),
  officialCoverage: z
    .object({
      leadSyncAt: maybeText,
      callSyncAt: maybeText,
      appointmentSyncAt: maybeText,
      sheetSyncAt: maybeText,
    })
    .nullable()
    .optional()
    .transform(v => v ?? null),
  callers: z.object({
    assigned: z.array(PersonSchema),
    otherAccess: z.array(PersonSchema.extend({ why: z.string() })),
    dialled: z.array(PersonSchema.extend({ dials: count })),
  }),
  /** The period's leads, with every verified call made to them so far. */
  cohort: z.object({
    leads: count,
    called: count,
    dials: count,
    reached: count,
    talked30: count,
    talked120: count,
    booked: count,
    confirmed: count,
  }),
  /** Verified calls made in the period, whoever the lead. */
  window: z.object({
    dials: count,
    reached: count,
    talked30: count,
    talked120: count,
    talkSeconds: z.number(),
  }),
  notCalled: z.object({
    total: count,
    noPhone: count,
    unreadablePhone: count,
    dialledUnderAnotherLead: count,
    neverDialled: count,
    neverDialledOutsideDialerCountries: count,
    neverDialledWithSavedOutcome: count,
  }),
  speed: z.object({
    hoursSource: z.enum(["schedule", "default"]),
    leads: count,
    medianClockSeconds: maybeNumber,
    withinFiveMinutes: count,
    inHours: SpeedPartSchema,
    outOfHours: SpeedPartSchema,
  }),
  /** Leads called but not reached in their first 72 hours. */
  followUp: z.object({ leads: count, calls: count, threePlus: count }),
  messages: z.object({ handled: count, outcomesWithoutCall: count }),
  byAd: z.array(RowSchema),
  byCampaign: z.array(RowSchema),
  clientAverage: RowSchema.nullable(),
  waiting: z.object({
    callable: count,
    touched: count,
    untouched: z.object({
      count,
      oldestAt: maybeText,
      oldestWorkSeconds: maybeNumber,
    }),
    stages: z.array(
      z.object({
        stage: z.string(),
        position: maybeNumber,
        count,
        medianDays: maybeNumber,
        oldestDays: maybeNumber,
        overSevenDays: count,
      }),
    ),
    callbacks: z.object({
      count,
      overThreeDays: count,
      oldestTouchAt: maybeText,
      scheduled: count,
      overdue: count,
    }),
    missedInbound: z.object({
      count,
      callers: count,
      withinFifteenMinutes: count,
      withinTwoHours: count,
      withinDay: count,
      never: count,
      oldestNeverAt: maybeText,
    }),
  }),
  lost: z.object({
    total: count,
    reasons: z.array(z.object({ key: z.string(), count })),
    otherNotes: z.object({ total: count, sorted: count }),
    unreachable: z.object({
      leads: count,
      calls: count,
      noCall: count,
      fourPlus: count,
      connected: count,
    }),
    latest: z.array(
      z.object({
        at: z.string(),
        day: z.string(),
        firstName: maybeText,
        adId: maybeText,
        adName: maybeText,
        reason: maybeText,
        key: z.string(),
        note: maybeText,
        agent: maybeText,
        calls: count,
        longestSeconds: maybeNumber,
        longestCallId: maybeText,
      }),
    ),
  }),
  coverage: z.object({
    unlinkedCalls: count,
    leadsWithoutPhone: count,
    leadsWithUnreadablePhone: count,
    leadsWithoutAdId: count,
    metaLeadsWithoutAdId: count,
    leadsOnlyInGhl: count,
    newestCallAt: maybeText,
    newestClientCallAt: maybeText,
    newestAttemptAt: maybeText,
    newestClientAttemptAt: maybeText,
    leadSyncAt: maybeText,
  }),
  notes: z.array(z.string()),
});

export type CallCentre = z.output<typeof CallCentreSchema>;
export type CallRow = z.output<typeof RowSchema>;

/** The RPC's answer, or one plain sentence when it cannot be read. */
export function parseCallCentre(raw: unknown): CallCentre {
  const parsed = CallCentreSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      "The call centre numbers came back in a shape this page cannot read. Refresh the page; if it stays, tell the CEO.",
    );
  return parsed.data;
}

// ---------------------------------------------------------------------------
// The numbers, as rates.

/** n out of d as a percent, or null when there is nothing under it. */
export function rate(
  n: number | null | undefined,
  d: number | null | undefined,
): number | null {
  if (n === null || n === undefined || d === null || d === undefined)
    return null;
  return d > 0 ? (n / d) * 100 : null;
}

function ratio(
  n: number | null | undefined,
  d: number | null | undefined,
): number | null {
  if (n === null || n === undefined || d === null || d === undefined)
    return null;
  return d > 0 ? n / d : null;
}

export type CallCentreSummary = {
  leads: number | null;
  called: number | null;
  calledRate: number | null;
  /** Verified Maqsam calls made in the period: the official dials. */
  dials: number | null;
  /** Verified calls to the period's leads, per lead. */
  dialsPerLead: number | null;
  /** Outcomes saved with no Maqsam call: never counted as dials. */
  outcomesWithoutCall: number;
  /** Official: connected calls per dial. Includes voicemail. */
  reachedPerDial: number | null;
  reachedPerLeadCalled: number | null;
  talked30PerDial: number | null;
  talked120PerDial: number | null;
  talked30PerLeadCalled: number | null;
  talked120PerLeadCalled: number | null;
  confirmed: number | null;
  provisional: number | null;
  /** Confirmed bookings per lead, the main booking rate. */
  bookedRate: number | null;
  shows: number | null;
  showRate: number | null;
  firstCallWorkSeconds: number | null;
  firstCallClockSeconds: number | null;
  withinFiveRate: number | null;
  /** Share of callable leads older than one working hour that were touched. */
  touchedRate: number | null;
  untouched: number;
  /** Verified calls in 72 hours, per lead called and not reached. */
  followUpCalls: number | null;
  followUpLeads: number;
};

export function summarize(data: CallCentre): CallCentreSummary {
  const o = data.official;
  const dials = o ? o.providerDials : null;
  return {
    leads: o ? o.leads : null,
    called: o ? o.leadsDialed : null,
    calledRate: o ? rate(o.leadsDialed, o.leads) : null,
    dials,
    dialsPerLead: ratio(data.cohort.dials, data.cohort.leads),
    outcomesWithoutCall: data.messages.outcomesWithoutCall,
    reachedPerDial:
      o && o.connectionRate !== null ? o.connectionRate * 100 : null,
    reachedPerLeadCalled: o ? rate(o.leadsContacted, o.leadsDialed) : null,
    talked30PerDial: rate(data.window.talked30, dials),
    talked120PerDial: rate(data.window.talked120, dials),
    talked30PerLeadCalled: rate(data.cohort.talked30, data.cohort.called),
    talked120PerLeadCalled: rate(data.cohort.talked120, data.cohort.called),
    confirmed: o ? o.confirmedBookings : null,
    provisional: o ? o.provisionalBookings : null,
    bookedRate: o ? rate(o.confirmedBookings, o.leads) : null,
    shows: o ? o.shows : null,
    showRate: o && o.showRate !== null ? o.showRate * 100 : null,
    firstCallWorkSeconds: o ? o.medianSpeedSeconds : null,
    firstCallClockSeconds: data.speed.medianClockSeconds,
    withinFiveRate: rate(data.speed.withinFiveMinutes, data.speed.leads),
    touchedRate: rate(data.waiting.touched, data.waiting.callable),
    untouched: data.waiting.untouched.count,
    followUpCalls: ratio(data.followUp.calls, data.followUp.leads),
    followUpLeads: data.followUp.leads,
  };
}

// ---------------------------------------------------------------------------
// The verdict: is this a call centre issue or not?

/**
 * The verdict's own lines, beside the gates in kpi.ts (Aziz's brief,
 * 2026-10-13, from the constraints checklist and the call centre research).
 */
export const CALL_RULES = {
  /** Under this many leads in the period there is no verdict. */
  minLeads: 20,
  /** Callable leads older than one working hour that must be touched, in %. */
  touchedShare: 90,
  /** Median first call in working time, in minutes. Pickup drops after 30. */
  firstCallWorkMinutes: 30,
  /** Verified calls in 72 hours for a lead who did not answer. */
  followUpCalls: 3,
  /** Leads called and not reached needed before follow-up is judged. */
  followUpMinLeads: 5,
  /** Lost to distance, money or not a fit over this share points at targeting. */
  targetingShare: 30,
  /** Lost leads with a stated reason needed before that share is read. */
  targetingMinLost: 5,
  /** An ad is judged with at least this many leads. */
  adMinLeads: 10,
} as const;

export type VerdictKind =
  | "call_centre"
  | "lead_quality"
  | "on_track"
  | "not_enough"
  | "client_calls"
  | "no_data";

export type CallCentreVerdict = {
  kind: VerdictKind;
  label: string;
  /** One plain sentence of why, naming the numbers. */
  why: string;
  /** Every reason that held, most pressing first; the first is `why`. */
  reasons: string[];
  tone: "bad" | "watch" | "good" | "muted";
};

export const VERDICT_LABELS: Record<VerdictKind, string> = {
  call_centre: "Call centre",
  lead_quality: "Lead quality",
  on_track: "On track",
  not_enough: "Not enough leads yet",
  client_calls: "Leads only: the client calls them",
  no_data: "No call data yet",
};

/** The lost reasons that point at who the ads reach, not the calls. */
const TARGETING_KEYS = ["distance", "financial", "not_a_fit"];
/** Lost with no reason the lead gave: not counted in the targeting share. */
const NO_STATED_REASON = ["unreachable", "unclassified"];

/** Lost to distance, money or not a fit, as a % of leads lost for a stated reason. */
export function targetingShare(data: CallCentre): number | null {
  const stated = data.lost.reasons.filter(
    r => !NO_STATED_REASON.includes(r.key),
  );
  const total = stated.reduce((s, r) => s + r.count, 0);
  if (total < CALL_RULES.targetingMinLost) return null;
  const targeting = stated
    .filter(r => TARGETING_KEYS.includes(r.key))
    .reduce((s, r) => s + r.count, 0);
  return rate(targeting, total);
}

function verdict(kind: VerdictKind, reasons: string[]): CallCentreVerdict {
  const tone =
    kind === "call_centre"
      ? "bad"
      : kind === "lead_quality"
        ? "watch"
        : kind === "on_track"
          ? "good"
          : "muted";
  return { kind, label: VERDICT_LABELS[kind], why: reasons[0], reasons, tone };
}

export function callCentreVerdict(data: CallCentre): CallCentreVerdict {
  if (data.client.serviceMode?.toUpperCase() === "DWY")
    return verdict("client_calls", [
      "This is a done-with-you client: the client's own team calls these leads, so there is no call centre verdict.",
    ]);
  if (!data.official)
    return verdict("no_data", [
      "The dialer's report has no numbers for this client in these dates, so there is nothing to judge yet.",
    ]);
  const s = summarize(data);
  const leads = s.leads ?? 0;
  if (leads < CALL_RULES.minLeads)
    return verdict("not_enough", [
      `Only ${plural(leads, "lead")} in these dates. The verdict needs ${CALL_RULES.minLeads} or more.`,
    ]);

  const reasons: string[] = [];
  if (s.dials === 0)
    reasons.push(
      `No verified call was made for this client in these dates, with ${plural(leads, "lead")} in.`,
    );
  if (s.touchedRate !== null && s.touchedRate < CALL_RULES.touchedShare)
    reasons.push(
      `Only ${formatRate(s.touchedRate)} of leads older than a working hour were called or messaged (the line is ${CALL_RULES.touchedShare}%); ${plural(s.untouched, "lead")} still ${s.untouched === 1 ? "waits" : "wait"}.`,
    );
  const slowLine = CALL_RULES.firstCallWorkMinutes * 60;
  if (s.firstCallWorkSeconds !== null && s.firstCallWorkSeconds > slowLine)
    reasons.push(
      `The first call takes ${formatDuration(s.firstCallWorkSeconds)} of working time at the median (the line is ${CALL_RULES.firstCallWorkMinutes} min).`,
    );
  const thin =
    s.followUpCalls !== null &&
    s.followUpLeads >= CALL_RULES.followUpMinLeads &&
    s.followUpCalls < CALL_RULES.followUpCalls;
  if (thin)
    reasons.push(
      `Leads who did not answer got ${formatPerLead(s.followUpCalls)} calls in their first 3 days (the line is ${CALL_RULES.followUpCalls}; the checklist asks for ${FOLLOW_UP_ATTEMPTS}).`,
    );
  const reached = s.reachedPerDial;
  const talked = s.talked120PerDial;
  if (
    reached !== null &&
    talked !== null &&
    reached >= REACHED_GATE &&
    talked < CONVERSATION_GATE
  )
    reasons.push(
      `${formatRate(reached)} of dials are answered, but only ${formatRate(talked)} become a conversation over 2 minutes (the line is ${CONVERSATION_GATE}%).`,
    );
  if (reached !== null && reached < REACHED_GATE) {
    // The checklist's own pace: the first call in 5 minutes, 9 attempts.
    const slow =
      s.firstCallWorkSeconds !== null &&
      s.firstCallWorkSeconds > FIRST_CALL_MINUTES * 60;
    const shallow =
      s.followUpCalls !== null && s.followUpCalls < FOLLOW_UP_ATTEMPTS;
    reasons.push(
      slow || shallow
        ? `Only ${formatRate(reached)} of dials are answered (the line is ${REACHED_GATE}%), and ${
            slow
              ? `the first call takes ${formatDuration(s.firstCallWorkSeconds)} at the median (the checklist asks for ${FIRST_CALL_MINUTES} min)`
              : `unanswered leads get ${formatPerLead(s.followUpCalls)} calls in 3 days (the checklist asks for ${FOLLOW_UP_ATTEMPTS})`
          }.`
        : `Only ${formatRate(reached)} of dials are answered (the line is ${REACHED_GATE}%) though calls are fast and repeated: check the caller number for a spam flag or a wrong country code.`,
    );
  }
  if (reasons.length) return verdict("call_centre", reasons);

  const booked = s.bookedRate;
  if (booked !== null && booked >= BOOKING_RATE_GATE)
    return verdict("on_track", [
      `${formatRate(booked)} of leads booked a confirmed appointment (the line is ${BOOKING_RATE_GATE}%).`,
    ]);
  const quality = [
    `Calls are fast and repeated, ${formatRate(reached)} of dials are answered and ${formatRate(talked)} talk over 2 minutes, but only ${formatRate(booked)} of leads booked (the line is ${BOOKING_RATE_GATE}%): look at who the ads bring.`,
  ];
  const share = targetingShare(data);
  if (share !== null && share > CALL_RULES.targetingShare)
    quality.push(
      `${formatRate(share)} of leads lost for a stated reason were too far, short of money or not a fit (over ${CALL_RULES.targetingShare}% points at targeting).`,
    );
  return verdict("lead_quality", quality);
}

// ---------------------------------------------------------------------------
// One ad or campaign against the client's own average.

export type RowFlag = {
  kind: "too_few" | "not_called" | "below" | "above" | "even";
  why: string;
  /** Shown beside the judgement, never part of it: the call centre's share. */
  calledRate: number | null;
  clientCalledRate: number | null;
};

/**
 * An ad (or campaign) is judged on its leads that were called: reached and
 * booked per lead called, against the client's average. How many of its leads
 * were called is shown beside it, since that is the call centre's doing, not
 * the ad's (research C7: the called share differs ad to ad within a client).
 */
export function rowFlag(row: CallRow, client: CallRow | null): RowFlag {
  const calledRate = rate(row.called, row.leads);
  const clientCalledRate = client ? rate(client.called, client.leads) : null;
  const base = { calledRate, clientCalledRate };
  if (row.leads < CALL_RULES.adMinLeads)
    return {
      ...base,
      kind: "too_few",
      why: `${plural(row.leads, "lead")}: too few to judge (${CALL_RULES.adMinLeads} or more).`,
    };
  if (row.called === 0)
    return {
      ...base,
      kind: "not_called",
      why: "None of its leads has a verified call yet.",
    };
  const reached = rate(row.reached, row.called);
  const booked = rate(row.booked, row.called);
  const clientReached = client ? rate(client.reached, client.called) : null;
  const clientBooked = client ? rate(client.booked, client.called) : null;
  if (reached !== null && clientReached !== null && reached < clientReached / 2)
    return {
      ...base,
      kind: "below",
      why: `Its leads answer less: ${formatRate(reached)} reached per lead called, against ${formatRate(clientReached)} for the client.`,
    };
  if (booked !== null && clientBooked !== null && booked < clientBooked / 2)
    return {
      ...base,
      kind: "below",
      why: `Its leads book less: ${formatRate(booked)} booked per lead called, against ${formatRate(clientBooked)} for the client.`,
    };
  if (
    booked !== null &&
    clientBooked !== null &&
    clientBooked > 0 &&
    booked >= clientBooked * 1.5
  )
    return {
      ...base,
      kind: "above",
      why: `Its leads book more: ${formatRate(booked)} booked per lead called, against ${formatRate(clientBooked)} for the client.`,
    };
  return {
    ...base,
    kind: "even",
    why: "In line with the client's average.",
  };
}

// ---------------------------------------------------------------------------
// Lost reasons.

/** The key cockpit_call_centre_lost_key gives each lost lead, in plain words. */
export const LOST_LABELS: Record<string, string> = {
  not_a_fit: "Not a fit, no project or budget",
  not_interested: "Not interested",
  not_ready: "Not ready yet",
  applied_by_mistake: "Applied by mistake",
  bad_number: "Bad number",
  went_elsewhere: "Went elsewhere",
  distance: "Too far away",
  financial: "Money",
  unrealistic: "Unrealistic expectations",
  setup_issue: "Setup issue",
  never_came_back: "Never came back",
  unreachable: "Could not be reached",
  unclassified: "Other, not sorted",
};

export function lostLabel(key: string): string {
  return LOST_LABELS[key] ?? LOST_LABELS.unclassified;
}

// ---------------------------------------------------------------------------
// The assigned caller (Aziz, 2026-10-13: "The CSM needs to be able to see the
// assigned caller for each client easily").

export const NO_CALLER = "No caller assigned in the dialer";

/** The client's callers in the dialer as one line: "Lama Harb and Daniya Ziad". */
export function assignedCallers(data: CallCentre): string {
  const names = data.callers.assigned.map(c => c.name);
  if (!names.length) return NO_CALLER;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------
// How the numbers read.

export const NOT_MEASURED = "Not measured";

/** "under a minute", "12 min", "3 h 12 min", "2 d 4 h". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds))
    return NOT_MEASURED;
  const s = Math.max(0, seconds);
  if (s < 60) return "under a minute";
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const m = minutes % 60;
    return m ? `${hours} h ${m} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days} d ${h} h` : `${days} d`;
}

/** A call's length: "45 s", "4 min 5 s", "12 min". */
export function formatCallLength(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds))
    return NOT_MEASURED;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} min ${rest} s` : `${m} min`;
}

/** A percent as it reads: "64%", "0.5%" under one, "Not measured" when null. */
export function formatRate(percent: number | null | undefined): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent))
    return NOT_MEASURED;
  if (percent > 0 && percent < 1) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

/** Calls per lead, one decimal: "1.4". */
export function formatPerLead(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return NOT_MEASURED;
  return value.toFixed(1);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
