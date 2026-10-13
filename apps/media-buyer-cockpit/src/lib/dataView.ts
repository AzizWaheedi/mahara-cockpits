/**
 * The data view's plain-word rules: row schemas, the one-line verdict per
 * row, the person's story, every Master Dashboard column and the CSV.
 * Pure functions, so `scripts/data-view.test.ts` covers them without a
 * browser. The page is `src/pages/data/DataViewPage.tsx`; the SQL is
 * `supabase/migrations/20261011b_cockpit_data_view.sql`.
 */
import { z } from "zod";

const str = z.string().nullable();
const num = z.number().nullable();

export const COCKPIT_STATES = [
  "counted",
  "twice",
  "by_day",
  "missing",
  "missing_old",
  "other_booking",
  "not_tracked",
  "not_ad",
] as const;
export type CockpitState = (typeof COCKPIT_STATES)[number];

export const leadRowSchema = z.object({
  id: z.string(),
  location_id: z.string(),
  client: z.string(),
  created_at: z.string(),
  synced_at: str,
  channel: str,
  source: str,
  ad_id: str,
  adset_id: str,
  campaign_id: str,
  ad_name: str,
  adset_name: str,
  campaign_name: str,
  utm_campaign: str,
  name: str,
  phone: str,
  email: str,
  deleted: z.boolean(),
  deleted_at: str,
  utm_source: str,
  utm_content: str,
  utm_medium: str,
  first_url: str,
  meeting_id: str,
  meeting_start: str,
  meeting_status: str,
  meeting_source: str,
  meetings: z.number(),
});
export type LeadRow = z.infer<typeof leadRowSchema>;

export const apptRowSchema = z.object({
  id: z.string(),
  contact_id: str,
  location_id: z.string(),
  client: z.string(),
  booked_at: z.string(),
  start_at: z.string(),
  status: str,
  ghl_source: str,
  calendar: str,
  name: str,
  phone: str,
  lead_found: z.boolean(),
  lead_channel: str,
  lead_source: str,
  lead_ad_name: str,
  lead_campaign_name: str,
  updated_at: str,
  deal: str,
  quotation: z.boolean().nullable(),
  project_value: num,
  currency: str,
  feedback: str,
  lead_quality: num,
  not_closed_reason: str,
  outcome_at: str,
  cockpit: z.enum(COCKPIT_STATES),
  cockpit_at: str,
  // How the media sync attributed a counted booking (2026-10-12): "ad",
  // "unknown_ad" or "none". Absent before migration 20261012h.
  cockpit_attribution: str.optional(),
  // The booking's notes and call agent (2026-10-13), from
  // portal_data.appointments; the number is the Agent Data tab's code for
  // that agent. Absent before migration 20261013a.
  notes: str.optional(),
  agent: str.optional(),
  agent_number: str.optional(),
});
export type ApptRow = z.infer<typeof apptRowSchema>;

export type Kind = "leads" | "appointments";

export const rowsPageSchema = z.object({
  kind: z.enum(["leads", "appointments"]),
  total: z.number(),
  rows: z.array(z.unknown()),
  next_cursor: str,
});

const sync = z.object({
  newest: str,
  oldest: str,
  locations: z.number(),
  ok: z.number(),
  failing: z.array(
    z.object({
      location_id: z.string(),
      status: str,
      error: str.optional(),
      at: str,
    }),
  ),
});
export const perClientSchema = z.object({
  location_id: z.string(),
  client: z.string(),
  leads: z.number(),
  meta_leads: z.number(),
  no_ad: z.number(),
  deleted: z.number(),
  meta_tracked: z.boolean(),
  meta_reported: num,
  meta_received: z.number(),
  never_reached: z.number(),
  appts: z.number(),
  counted: z.number(),
  not_counted: z.number(),
  twice: z.number(),
  not_tracked: z.number(),
  calendar: z.number(),
  no_result: z.number(),
  passed: z.number(),
  recorded: z.number(),
  showed: z.number(),
  upcoming: z.number(),
  cancelled: z.number(),
  won: z.number(),
});
export type PerClient = z.infer<typeof perClientSchema>;

export const summarySchema = z.object({
  location_id: str,
  days: z.number(),
  from_day: z.string(),
  to_day: z.string(),
  clients: z.array(
    z.object({
      location_id: z.string(),
      name: z.string(),
      status: str,
      clickup_id: str.optional(),
    }),
  ),
  freshness: z.object({
    now: z.string(),
    leads: sync,
    appointments: sync,
    meta_last_day: str,
    bookings_last_day: str,
    bookings_imported_at: str,
    outcomes_last_at: str,
  }),
  leads: z.object({
    all: z.number(),
    meta: z.number(),
    other: z.number(),
    booked: z.number(),
    no_ad: z.number(),
    deleted: z.number(),
  }),
  appointments: z.object({
    all: z.number(),
    upcoming: z.number(),
    showed: z.number(),
    not_counted: z.number(),
    no_result: z.number(),
    calendar: z.number(),
    calendar_counted: z.number(),
    twice: z.number(),
    not_tracked: z.number(),
    other_booking: z.number(),
    counted: z.number(),
    by_day: z.number(),
    meta_leads: z.number(),
  }),
  lineage: z.object({
    meta_reported: z.number(),
    meta_received: z.number(),
    meta_received_untracked: z.number(),
    tracked_clients: z.number(),
    never_reached: z.number(),
    with_ad: z.number(),
    appts: z.number(),
    cockpit_rows: z.number(),
    passed: z.number(),
    recorded: z.number(),
    compare_to: z.string(),
  }),
  per_client: z.array(perClientSchema),
  gap_days: z.array(
    z.object({
      location_id: z.string(),
      client: z.string(),
      day: z.string(),
      meta: z.number(),
      ghl: z.number(),
    }),
  ),
  meta_unmapped: z
    .object({ leads: z.number(), campaigns: z.array(z.string()) })
    .nullable(),
});
export type Summary = z.infer<typeof summarySchema>;

export const recordSchema = z.object({
  id: z.string(),
  contact_id: str,
  location_id: z.string(),
  lead: leadRowSchema.nullable(),
  appointments: z.array(apptRowSchema),
  raw: z.record(z.string(), z.unknown()),
  sync: z.object({
    leads_synced_at: str,
    appointments_synced_at: str,
  }),
});
export type RecordData = z.infer<typeof recordSchema>;

/* ---------- Time, always Riyadh ---------- */

const TZ = "Asia/Riyadh";
export const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};
/** 2026-10-11 */
export const ymd = (t: number) =>
  new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });
/** 2026-10-11 15:40:00, the sheet's own format. */
export const fmtFull = (t: number) =>
  `${ymd(t)} ${new Date(t).toLocaleTimeString("en-GB", { timeZone: TZ, hour12: false })}`;
/** Sun 11 Oct 15:40 */
export const fmtDT = (t: number) =>
  new Date(t)
    .toLocaleString("en-GB", {
      timeZone: TZ,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "");
/** Sun 11 Oct */
export const fmtDay = (t: number) =>
  new Date(t)
    .toLocaleDateString("en-GB", {
      timeZone: TZ,
      weekday: "short",
      day: "numeric",
      month: "short",
    })
    .replace(",", "");
/** A day string (2026-10-11) as "Sun 11 Oct", read at Riyadh noon. */
export const fmtDayString = (day: string) =>
  fmtDay(Date.parse(`${day}T12:00:00+03:00`));
/** 3:30 PM */
export const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  });
/** "4 min ago", "in 2 days" */
export function rel(t: number, now: number): string {
  const m = Math.round((t - now) / 60e3);
  const a = Math.abs(m);
  const d = Math.round(a / 1440);
  const s =
    a < 1
      ? "now"
      : a < 60
        ? `${a} min`
        : a < 1440
          ? `${Math.round(a / 60)} h`
          : `${d} day${d === 1 ? "" : "s"}`;
  if (s === "now") return "just now";
  return m < 0 ? `${s} ago` : `in ${s}`;
}
/** "12 min later" */
export function after(a: number, b: number): string {
  const m = Math.round((b - a) / 60e3);
  if (m < 0) return "before it";
  if (m < 60) return `${m} min later`;
  if (m < 1440) return `${Math.round(m / 60)} h later`;
  return `${Math.round(m / 1440)} days later`;
}
export const fmtN = (n: number) => n.toLocaleString("en-US");

/* ---------- Plain words for system values ---------- */

/** The lead's source field in words. Unknown values stay as GHL wrote them. */
export function plainSource(source: string | null, channel: string | null) {
  if (!source)
    return channel === "Meta"
      ? "Facebook (no source given)"
      : "Source not recorded";
  const known: Record<string, string> = {
    "Facebook Ads": "Facebook ad",
    Facebook: "Facebook",
    ROASForm: "ROAS form",
    Calendly: "Calendly",
    "Tiktok Ads": "TikTok ad",
    Organic: "Organic",
  };
  return known[source] ?? source;
}

/** How the booking was made, from appointments.ghl_source. */
export function plainMade(source: string | null): string {
  const known: Record<string, string> = {
    booking_widget: "Booked on the booking page",
    third_party: "Booked through another tool",
    google_calendar: "Copied from Google Calendar",
    calendar_page: "Added in the GHL calendar",
    conversations_ai: "Booked by the AI assistant",
    contactdetails_page: "Added on the contact page",
    opportunity_page: "Added on the opportunity page",
  };
  return source ? (known[source] ?? source) : "Booking method not recorded";
}

export type Tone = "ok" | "warn" | "bad" | "info" | "grey";

/** What happened at the meeting, in words, with its tone. */
export function result(
  a: Pick<ApptRow, "status" | "start_at">,
  now: number,
): [string, Tone] {
  const start = ms(a.start_at) ?? 0;
  if (a.status === "cancelled") return ["Cancelled", "grey"];
  if (a.status === "showed") return ["Showed up", "ok"];
  if (a.status === "noshow") return ["No-show", "bad"];
  if (start >= now) return ["Upcoming", "grey"];
  if (a.status === "confirmed") return ["Result not recorded", "warn"];
  return [a.status ? `Status: ${a.status}` : "No status", "grey"];
}

export const dealWord = (deal: string | null) =>
  deal ? deal.charAt(0).toUpperCase() + deal.slice(1) : null;

/* ---------- One verdict per row ---------- */

export type Issue = { tone: Tone; label: string; why: string };

export function leadIssues(l: LeadRow): Issue[] {
  const out: Issue[] = [];
  if (l.deleted)
    out.push({
      tone: "grey",
      label: "Deleted in GHL",
      why: "Someone deleted this contact in GHL. It is left out of every count.",
    });
  if (l.channel === "Meta" && !l.ad_id)
    out.push({
      tone: "warn",
      label: "Ad unknown",
      why: "GHL did not receive the ad id, so this lead cannot be tied to an ad. Cost per lead by ad leaves it out.",
    });
  return out;
}

export function isNoResult(a: ApptRow, now: number) {
  return (
    (ms(a.start_at) ?? 0) < now &&
    a.status === "confirmed" &&
    a.ghl_source !== "google_calendar"
  );
}

export function apptIssues(a: ApptRow, now: number): Issue[] {
  const out: Issue[] = [];
  const counted = ["counted", "twice", "by_day"].includes(a.cockpit);
  if (a.ghl_source === "google_calendar")
    out.push({
      tone: "warn",
      label: "Calendar event, not a lead",
      why: counted
        ? "Google Calendar two-way sync copied this into GHL, and the cockpit counts it as a booking."
        : "Google Calendar two-way sync copied this into GHL. The cockpit does not count it.",
    });
  if (a.cockpit === "missing")
    out.push({
      tone: "bad",
      label: "Cockpit did not count it",
      why: "This Facebook lead booked in GHL, but the cockpit bookings card has no booking with this appointment id.",
    });
  if (a.cockpit === "missing_old")
    out.push({
      tone: "bad",
      label: "Cockpit did not count it",
      why: "Before 8 Sep the cockpit stored bookings without ids. It has no booking for this client on this day.",
    });
  // Muhammed, 2026-10-12: a booking counted without an ad must say so.
  if (counted && a.cockpit_attribution === "none")
    out.push({
      tone: "warn",
      label: "Counted, no ad on the lead",
      why: "GHL has no ad for this lead, so the cockpit counts the booking under the client's current campaign without an ad.",
    });
  if (counted && a.cockpit_attribution === "unknown_ad")
    out.push({
      tone: "warn",
      label: "Counted, ad not found",
      why: "The lead names an ad the cockpit has no record of, so the booking counts under the client's current campaign without an ad.",
    });
  if (a.cockpit === "twice")
    out.push({
      tone: "bad",
      label: "Counted twice",
      why: "The cockpit has this booking twice: once from the old system and once from the new sync (8 to 27 Sep).",
    });
  if (isNoResult(a, now))
    out.push({
      tone: "warn",
      label: "Result not recorded",
      why: 'The meeting time passed, and nobody marked "showed" or "no-show" in GHL.',
    });
  if (a.cockpit === "not_tracked")
    out.push({
      tone: "grey",
      label: "Client not in the cockpit",
      why: "This client has no campaign and no bookings in the media buyer cockpit, so nothing there counts it.",
    });
  if (a.cockpit === "other_booking")
    out.push({
      tone: "grey",
      label: "Other booking counted",
      why: "The cockpit counted another booking by this person, usually the first one before a reschedule.",
    });
  return out;
}

/** The sentence for the cockpit's view of one appointment. */
export function cockpitWords(a: ApptRow): string {
  switch (a.cockpit) {
    case "counted":
      return "Counted in the cockpit bookings card";
    case "twice":
      return "Counted twice in the cockpit bookings card";
    case "by_day":
      return "Counted in the cockpit (matched by day)";
    case "missing":
    case "missing_old":
      return "Not counted in the cockpit bookings card";
    case "other_booking":
      return "Not counted itself; their other booking was";
    case "not_tracked":
      return "Client not in the cockpit";
    default:
      return "Not a Facebook lead, so the cockpit does not count it";
  }
}

/* ---------- Every Master Dashboard column, in the sheet's order ---------- */

export type SheetColumn<T> = {
  group: string;
  label: string;
  width: number;
  /** null: the field is not synced to the database yet. */
  get: ((row: T) => string | null) | null;
  source: string;
  /** For a column that is not synced: where the value lives and why the
   *  database does not have it. */
  why?: string;
  /** What a — means here, when it is not "GHL has no value". */
  empty?: string;
  cls?: "m" | "id" | "num";
};

const PORTAL_EMPTY =
  "— means the client portal has not captured this booking yet, or the booking has none.";

const LAST_TOUCH_WHY =
  "GHL keeps the last touch on the contact. The lead sync stores only the first touch, so this column is empty here.";

const v = (s: string | null | undefined) =>
  s === null || s === undefined || s === "" ? null : s;
const t = (iso: string | null, f: (n: number) => string) => {
  const n = ms(iso);
  return n === null ? null : f(n);
};
export const ghlContactUrl = (location: string, contact: string) =>
  `https://app.gohighlevel.com/v2/location/${encodeURIComponent(location)}/contacts/detail/${encodeURIComponent(contact)}`;

export const LEAD_ALL: SheetColumn<LeadRow>[] = [
  {
    group: "Lead",
    label: "Lead Name",
    width: 160,
    get: r => v(r.name),
    source: "client_leads.contact_name",
  },
  {
    group: "Lead",
    label: "Lead ID",
    width: 190,
    get: r => r.id,
    source: "client_leads.ghl_contact_id",
    cls: "id",
  },
  {
    group: "Lead",
    label: "Created Date & Time",
    width: 180,
    get: r => t(r.created_at, fmtFull),
    source: "client_leads.created_at",
    cls: "m",
  },
  {
    group: "Lead",
    label: "Phone Number",
    width: 150,
    get: r => v(r.phone),
    source: "client_leads.contact_phone",
    cls: "m",
  },
  {
    group: "Lead",
    label: "Client Name",
    width: 170,
    get: r => r.client,
    source:
      "ghl_clients.client_name, else the cockpit's client list, else the GHL account name",
  },
  {
    group: "Lead",
    label: "Date",
    width: 110,
    get: r => t(r.created_at, ymd),
    source: "client_leads.created_at, as a Riyadh day",
    cls: "m",
  },
  {
    group: "Lead",
    label: "Source",
    width: 140,
    get: r => v(r.source),
    source: "client_leads.source_field",
  },
  {
    group: "Ad",
    label: "AD ID",
    width: 180,
    get: r => v(r.ad_id),
    source: "client_leads.ad_id",
    cls: "id",
  },
  {
    group: "Ad",
    label: "AD NAME",
    width: 200,
    get: r => v(r.ad_name),
    source: "cockpit_media_daily_stats, adName",
  },
  {
    group: "Ad",
    label: "ADSET ID",
    width: 180,
    get: r => v(r.adset_id),
    source: "client_leads.adset_id",
    cls: "id",
  },
  {
    group: "Ad",
    label: "ADSET NAME",
    width: 200,
    get: r => v(r.adset_name),
    source: "cockpit_media_daily_stats, adSetName",
  },
  {
    group: "Ad",
    label: "CAMPAIGN ID",
    width: 180,
    get: r => v(r.campaign_id),
    source: "client_leads.campaign_id",
    cls: "id",
  },
  {
    group: "Ad",
    label: "CAMPAIGN NAME",
    width: 240,
    get: r => v(r.campaign_name) ?? v(r.utm_campaign),
    source: "cockpit_media_daily_stats, campaignName (else utmCampaign)",
  },
  {
    group: "First touch",
    label: "FIRST_UTM_SOURCE",
    width: 190,
    get: r => v(r.utm_source),
    source: "client_leads.attribution_raw.utmSource",
  },
  {
    group: "First touch",
    label: "FIRST_UTM_CONTENT",
    width: 190,
    get: r => v(r.utm_content),
    source: "client_leads.attribution_raw.utmContent",
  },
  {
    group: "First touch",
    label: "FIRST_UTM_MEDIUM",
    width: 190,
    get: r => v(r.utm_medium),
    source: "client_leads.attribution_raw.utmMedium",
  },
  {
    group: "Last touch",
    label: "LAST_UTM_SOURCE",
    width: 180,
    get: null,
    source: "Not synced",
    why: LAST_TOUCH_WHY,
  },
  {
    group: "Last touch",
    label: "LAST_UTM_CONTENT",
    width: 190,
    get: null,
    source: "Not synced",
    why: LAST_TOUCH_WHY,
  },
  {
    group: "Last touch",
    label: "LAST_UTM_MEDIUM",
    width: 180,
    get: null,
    source: "Not synced",
    why: LAST_TOUCH_WHY,
  },
  {
    group: "Pages",
    label: "FIRST_URL",
    width: 220,
    get: r => v(r.first_url),
    source: "client_leads.attribution_raw.url",
    cls: "m",
  },
  {
    group: "Pages",
    label: "LAST_URL",
    width: 130,
    get: null,
    source: "Not synced",
    why: LAST_TOUCH_WHY,
  },
  {
    group: "Pages",
    label: "Platform",
    width: 110,
    get: r =>
      r.channel === "Meta"
        ? "facebook"
        : r.channel === "TikTok"
          ? "tiktok"
          : "other",
    source: "client_leads.channel",
  },
];

export const APPT_ALL: SheetColumn<ApptRow>[] = [
  {
    group: "Appointment",
    label: "Lead Name",
    width: 160,
    get: r => v(r.name),
    source: "appointments.contact_name",
  },
  {
    group: "Appointment",
    label: "Date Appointment Created",
    width: 220,
    get: r => t(r.booked_at, fmtFull),
    source: "appointments.booked_at",
    cls: "m",
  },
  {
    group: "Appointment",
    label: "Date Of Appointment",
    width: 190,
    get: r => t(r.start_at, ymd),
    source: "appointments.start_at, as a Riyadh day",
    cls: "m",
  },
  {
    group: "Appointment",
    label: "Project Name",
    width: 170,
    get: r => r.client,
    source:
      "ghl_clients.client_name, else the cockpit's client list, else the GHL account name",
  },
  {
    group: "Appointment",
    label: "Additional Notes",
    width: 260,
    get: r => v(r.notes),
    source: "portal_data.appointments.notes",
    empty: PORTAL_EMPTY,
  },
  {
    group: "Appointment",
    label: "Lead Phone Number",
    width: 180,
    get: r => v(r.phone),
    source: "appointments.contact_phone",
    cls: "m",
  },
  {
    group: "Appointment",
    label: "Calendar Name",
    width: 240,
    get: r => v(r.calendar),
    source: "ghl_calendars.name",
  },
  {
    group: "Appointment",
    label: "Requested Time",
    width: 160,
    get: r => t(r.start_at, fmtTime),
    source: "appointments.start_at",
    cls: "m",
  },
  {
    group: "Status",
    label: "Stage Booked",
    width: 150,
    get: r => v(r.status),
    source: "appointments.status",
  },
  {
    group: "Status",
    label: "Agent Number",
    width: 150,
    get: r => v(r.agent_number),
    source:
      "The Agent Data tab's code for the agent, kept in cockpit_call_agents",
    empty:
      "— means there is no agent, or the agent is not in cockpit_call_agents yet. Add them there.",
    cls: "num",
  },
  {
    group: "Status",
    label: "Contact Link",
    width: 260,
    get: r =>
      r.contact_id ? ghlContactUrl(r.location_id, r.contact_id) : null,
    source: "Built from the location id and contact id",
    cls: "m",
  },
  {
    group: "Status",
    label: "Showed?",
    width: 120,
    get: r =>
      r.status === "showed" ? "TRUE" : r.status === "noshow" ? "FALSE" : null,
    source: "appointments.status",
  },
  {
    group: "Status",
    label: "Confirmed?",
    width: 130,
    get: r => (r.status === "cancelled" ? "FALSE" : "TRUE"),
    source: "appointments.status",
  },
  {
    group: "Status",
    label: "Closed?",
    width: 110,
    get: r => (r.deal ? (r.deal === "won" ? "TRUE" : "FALSE") : null),
    source: "appointment_outcomes.deal",
  },
  {
    group: "Status",
    label: "Source",
    width: 160,
    get: r => v(r.ghl_source) ?? v(r.lead_source),
    source: "appointments.ghl_source, else the lead source",
  },
  {
    group: "Status",
    label: "Contact ID",
    width: 190,
    get: r => v(r.contact_id),
    source: "appointments.ghl_contact_id",
    cls: "id",
  },
  {
    group: "Status",
    label: "PRE-PAY",
    width: 110,
    get: null,
    source: "Not synced",
    why: "A GHL contact field. The appointment sync does not store it, so this column is empty here.",
  },
  {
    group: "Status",
    label: "Appointment ID",
    width: 190,
    get: r => r.id,
    source: "appointments.ghl_appointment_id",
    cls: "id",
  },
  {
    group: "Status",
    label: "Agent",
    width: 170,
    get: r => v(r.agent),
    source: "portal_data.appointments.assigned_agent",
    empty: PORTAL_EMPTY,
  },
  {
    group: "Status",
    label: "Platform",
    width: 110,
    get: r =>
      r.lead_channel === "Meta"
        ? "facebook"
        : r.lead_channel === "TikTok"
          ? "tiktok"
          : r.lead_channel
            ? "other"
            : null,
    source: "client_leads.channel",
  },
  {
    group: "Status",
    label: "Cancelled?",
    width: 130,
    get: r => (r.status === "cancelled" ? "Y" : null),
    source: "appointments.status",
  },
  {
    group: "Portal",
    label: "Project Value",
    width: 150,
    get: r =>
      r.project_value === null
        ? null
        : `${fmtN(r.project_value)}${r.currency ? ` ${r.currency}` : ""}`,
    source: "appointment_outcomes.project_value and currency",
    cls: "num",
  },
  {
    group: "Portal",
    label: "Client Feedback (Portal)",
    width: 260,
    get: r => v(r.feedback),
    source: "appointment_outcomes.feedback",
  },
  {
    group: "Portal",
    label: "Deal Status (Portal)",
    width: 170,
    get: r => dealWord(r.deal),
    source: "appointment_outcomes.deal",
  },
  {
    group: "Portal",
    label: "Quotation Given (Portal)",
    width: 200,
    get: r => (r.quotation === null ? null : r.quotation ? "Yes" : "No"),
    source: "appointment_outcomes.quotation",
  },
];

/* ---------- CSV: every sheet column, in sheet order ---------- */

const PHONE_LIKE = /^[+-]?[\d\s()./-]+$/;
/**
 * One CSV cell. Quotes when needed. A cell a spreadsheet would run as a
 * formula (=, @, or +/- that is not a phone number or a plain number) gets a
 * leading apostrophe, because lead names come from public forms.
 */
export function csvCell(value: string | null): string {
  let s = value ?? "";
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !PHONE_LIKE.test(s)))
    s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(columns: SheetColumn<T>[], rows: T[]): string {
  const head = columns
    .map(c => csvCell(c.get ? c.label : `${c.label} (not synced)`))
    .join(",");
  const body = rows.map(r =>
    columns.map(c => csvCell(c.get ? c.get(r) : null)).join(","),
  );
  // The byte-order mark makes Excel read Arabic names as UTF-8.
  return `﻿${[head, ...body].join("\r\n")}\r\n`;
}

/* ---------- The person's story, in sentences ---------- */

export type StoryStep = {
  tone: "" | "miss" | "wait";
  title: string;
  meta: string;
};

export function buildStory(rec: RecordData, now: number): StoryStep[] {
  const out: StoryStep[] = [];
  const lead = rec.lead;
  const created = ms(lead?.created_at);
  if (lead && created !== null) {
    out.push({
      tone: "",
      title:
        lead.channel === "Meta"
          ? `Filled a Facebook lead form${lead.ad_name ? ` from the ad "${lead.ad_name}"` : ""}`
          : `Came in by ${plainSource(lead.source, lead.channel)}`,
      meta: `${fmtDT(created)} · ${rel(created, now)}`,
    });
    const synced = ms(lead.synced_at);
    if (synced !== null)
      out.push({
        tone: "",
        title: "Copied into our database",
        meta: `Last copied ${rel(synced, now)}`,
      });
    if (lead.channel === "Meta" && !lead.ad_id)
      out.push({
        tone: "miss",
        title: "The ad could not be identified",
        meta: "GHL did not receive the ad id",
      });
    if (lead.deleted)
      out.push({
        tone: "miss",
        title: "Deleted in GHL",
        meta: lead.deleted_at
          ? fmtDT(ms(lead.deleted_at) ?? 0)
          : "Date not recorded",
      });
  } else {
    const a = rec.appointments[0];
    out.push({
      tone: "miss",
      title: "No lead record behind this booking",
      meta:
        a?.ghl_source === "google_calendar"
          ? "Google Calendar sync created it"
          : "The contact is not in the leads table",
    });
  }
  for (const a of rec.appointments) {
    const booked = ms(a.booked_at) ?? 0;
    const start = ms(a.start_at) ?? 0;
    out.push({
      tone: "",
      title: `Booked: ${a.calendar ?? "calendar not named"}`,
      meta: `${fmtDT(booked)}${created !== null ? ` · ${after(created, booked)}` : ""} · ${plainMade(a.ghl_source).toLowerCase()}`,
    });
    const counted = ["counted", "twice", "by_day"].includes(a.cockpit);
    const bad = ["missing", "missing_old", "twice"].includes(a.cockpit);
    const at = ms(a.cockpit_at);
    out.push({
      tone: bad ? "miss" : counted ? "" : "wait",
      title: cockpitWords(a),
      meta:
        counted && at !== null
          ? `Copied ${after(booked, at)}`
          : bad
            ? "The bookings card is off by this one"
            : "",
    });
    const [word] = result(a, now);
    out.push({
      tone:
        start >= now ? "wait" : word === "Result not recorded" ? "miss" : "",
      title:
        start >= now
          ? `Meeting ${rel(start, now)}`
          : `Meeting: ${word.toLowerCase()}`,
      meta: `${fmtDay(start)}, ${fmtTime(start)}`,
    });
    if (a.deal || a.feedback || a.project_value !== null)
      out.push({
        tone: "",
        title: `Client reported${a.deal ? `: deal ${a.deal}` : ""}${a.project_value !== null ? `, ${fmtN(a.project_value)}${a.currency ? ` ${a.currency}` : ""}` : ""}`,
        meta: a.feedback ? `"${a.feedback}"` : "No feedback written",
      });
  }
  if (lead && rec.appointments.length === 0)
    out.push({ tone: "wait", title: "Has not booked a meeting", meta: "" });
  return out;
}

/** IDs and the story only: safe to paste into a chat or a ticket. */
export function debugBundle(rec: RecordData, now: number) {
  const issues = [
    ...(rec.lead ? leadIssues(rec.lead) : []),
    ...rec.appointments.flatMap(a => apptIssues(a, now)),
  ];
  return {
    contact_id: rec.contact_id,
    location_id: rec.location_id,
    client: rec.lead?.client ?? rec.appointments[0]?.client ?? null,
    appointment_ids: rec.appointments.map(a => a.id),
    cockpit: rec.appointments.map(a => a.cockpit),
    problems: issues.map(i => i.label),
    story: buildStory(rec, now).map(s => s.title),
  };
}
