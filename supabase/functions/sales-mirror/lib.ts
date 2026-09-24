// The parts of the sales mirror that do not need the network: the B2B
// queries, the Kuwait-day windows, and the HighLevel row shapes. Kept apart
// from index.ts so they can be tested without the Supabase runtime
// (bun test supabase/functions/sales-mirror).

export const B2B_REF = "flwboeijllbtrufxkhts";
export const SALES_LOCATION = "7NI8yyJtwsh2OOWA5Icr";

/** Kuwait is UTC+3 all year. B2B counts days in Riyadh, the same offset. */
const KUWAIT_OFFSET_MS = 3 * 3600 * 1000;
const DAY_MS = 86_400_000;

/**
 * The qualification form's answers, by HighLevel custom field id
 * (read from the sub-account on 2026-09-24; the filled ones on 90 days of
 * leads). The column on the left is the column in cockpit_sales_leads.
 */
export const LEAD_FIELDS: Record<string, string> = {
  revenue: "IvdTSSuctezX9DTHo42K",
  readiness: "VEb2CDJlh1Rbafua8i4G",
  revenue_goal: "ev2TXiHEz8xbwhPPP7Fr",
  decision_maker: "W7cBKCA5vQ1bT5kRhsNH",
  challenge: "gCiKGMsmvcVahioFzlm8",
  services: "3ZVhawy8VqssupOaMnZd",
  grade: "vtaMjw0lNImT9SeanvVq",
  setter_name: "cVTAGK0mfOhcX4fzdcw6",
  lead_stage: "CUbeUYgdZSVenFSqCoNq",
  booking_channel: "JFOFg6imqqVynXgkNR72",
  utm_source: "QdGB2N0Ey6CyeAnpjvPf",
  utm_medium: "x3i6K6KxR50K3kB5Z6RV",
  utm_campaign: "lQoqO78ByCKGm68ZWijy",
  utm_content: "qjne5hco4pZ3fCdPlGrk",
  utm_term: "4UBUcsfFYwhuHCAbRbwR",
  ad_name: "md1dQyq9T6TTCAXroKmr",
  adset_name: "sttv13MAJwkc7KqRLnpY",
  campaign_name: "D2uX1QBh6E67ZKb6DchG",
};

/** A SQL string literal. Every value we put in a query is our own, but quote it anyway. */
export function lit(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** An ISO timestamp we built, checked before it goes into SQL. */
export function ts(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}[T ][0-9:.]+(Z|[+-]\d{2}(:?\d{2})?)?$/.test(iso))
    throw new Error(`not a timestamp: ${iso.slice(0, 40)}`);
  return `${lit(iso)}::timestamptz`;
}

export function day(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`not a day: ${d}`);
  return `${lit(d)}::date`;
}

/** The last eight digits of a phone, which is how a Maqsam call finds its lead. */
export function phone8(phone: unknown): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : null;
}

/** The lead rule of 2026-09-21: a contact with both tags is qualified. */
export function leadClass(tags: unknown): string | null {
  const t = Array.isArray(tags) ? tags.map(x => String(x).toLowerCase()) : [];
  if (t.includes("roas-qualified")) return "qualified";
  if (t.includes("roas-unqualified")) return "unqualified";
  if (t.includes("roas-unprepared")) return "unprepared";
  return null;
}

const PHONE8_SQL = (col: string) =>
  `right(regexp_replace(coalesce(${col}, ''), '\\D', '', 'g'), 8)`;

/**
 * Leads, one page. `since` reads only contacts HighLevel changed after it
 * (B2B rewrites synced_at on every row every sync, so the contact's own
 * update time is the watermark). `after` pages by contact id.
 */
export function leadsSql(opts: {
  since?: string | null;
  after?: string | null;
  limit: number;
}): string {
  const where: string[] = [];
  if (opts.since)
    where.push(
      `greatest(l.lead_updated_at, l.opp_updated_at, l.lead_created_at) > ${ts(opts.since)}`,
    );
  if (opts.after) where.push(`l.contact_id > ${lit(opts.after)}`);
  const fields = Object.entries(LEAD_FIELDS)
    .map(([col, id]) => `nullif(btrim(cf ->> ${lit(id)}), '') as ${col}`)
    .join(",\n  ");
  return `select
  l.contact_id,
  l.name,
  l.email,
  l.phone,
  nullif(${PHONE8_SQL("l.phone")}, '') as phone8,
  l.company_name as company,
  nullif(l.raw_contact ->> 'country', '') as country,
  l.source,
  coalesce(l.tags, '{}') as tags,
  l.is_lead,
  l.contact_type,
  (l.raw_contact ->> 'dnd')::boolean as dnd,
  l.assigned_to,
  l.ad_id,
  l.adset_id,
  l.campaign_id,
  ${fields},
  l.primary_opportunity_id as opportunity_id,
  l.pipeline_id,
  l.pipeline_name,
  l.stage_id,
  l.stage_name,
  l.opp_status,
  l.monetary_value,
  l.opp_updated_at,
  l.lead_created_at,
  l.lead_updated_at,
  greatest(l.lead_updated_at, l.opp_updated_at, l.lead_created_at) as changed_at
from public.leads as l
cross join lateral (
  select coalesce(jsonb_object_agg(f ->> 'id', f -> 'value'), '{}'::jsonb) as cf
    from jsonb_array_elements(
      case when jsonb_typeof(l.raw_contact -> 'customFields') = 'array'
           then l.raw_contact -> 'customFields' else '[]'::jsonb end
    ) as f
) as x
${where.length ? `where ${where.join(" and ")}` : ""}
order by l.contact_id
limit ${Math.max(1, Math.min(2000, Math.floor(opts.limit)))}`;
}

/** Intro and demo appointments that start inside a window. */
export function callsSql(fromIso: string, toIso: string): string {
  return `select
  c.ghl_appointment_id as appointment_id,
  c.contact_id,
  c.contact_name,
  c.calendar_id,
  c.call_type,
  c.start_at,
  c.booked_at,
  c.status,
  c.assigned_user_id,
  c.assigned_user_name,
  c.ad_id
from public.calls as c
where c.start_at >= ${ts(fromIso)} and c.start_at < ${ts(toIso)}
  and c.ghl_appointment_id is not null`;
}

/** Maqsam calls B2B stored after the watermark. */
export function dialsSql(since: string, limit: number): string {
  return `select
  m.maqsam_call_id as call_id,
  m.occurred_at,
  m.agent_email,
  m.agent_name,
  m.sales_rep_id,
  m.direction,
  m.state,
  m.duration_seconds as duration_s,
  m.ringing_time as ringing_s,
  m.handling_time as handling_s,
  nullif(${PHONE8_SQL("m.lead_phone")}, '') as lead_phone8,
  m.sentiment,
  m.summary_en,
  m.summary_ar,
  (coalesce(m.transcript_turns, 0) > 0) as has_transcript,
  coalesce(m.call_tags, '{}') || coalesce(m.auto_tags, '{}') as tags,
  m.synced_at
from public.maqsam_calls as m
where m.synced_at > ${ts(since)}
order by m.synced_at, m.maqsam_call_id
limit ${Math.max(1, Math.min(5000, Math.floor(limit)))}`;
}

/** Every signed deal, with B2B's own void flag. */
export function dealsSql(): string {
  return `select
  d.response_id,
  d.submitted_at,
  d.closer,
  -- The form's own hidden contact_id when the cockpit filled it (exact),
  -- else B2B's match by email and phone.
  coalesce(nullif(btrim(d.raw_payload #>> '{hidden,contact_id}'), ''), d.contact_id) as contact_id,
  case
    when nullif(btrim(d.raw_payload #>> '{hidden,contact_id}'), '') is not null then 'form'
    when d.contact_id is not null then 'matched'
  end as contact_from,
  nullif(btrim(d.raw_payload #>> '{hidden,setter}'), '') as setter,
  nullif(btrim(concat_ws(' ', d.client_first_name, d.client_last_name)), '') as client_name,
  d.business_name,
  d.email,
  nullif(${PHONE8_SQL("coalesce(d.phone_normalized, d.phone)")}, '') as phone8,
  d.country,
  d.payment_structure,
  d.agreement_type,
  d.cash_collected,
  d.contracted_revenue,
  d.new_mrr,
  d.daily_ad_spend,
  d.csm,
  d.fathom_link,
  d.lead_source,
  d.ad_id,
  exists (
    select 1 from public.record_voids as v
     where v.entity = 'closed_deal' and v.record_id = d.response_id
  ) as voided
from public.closed_deals as d`;
}

export function repsSql(): string {
  return `select id, display_name, role, ghl_user_id,
  coalesce(closer_aliases, '{}') as closer_aliases, is_active, maqsam_email, fathom_email
from public.sales_reps`;
}

export function scorecardSql(from: string, to: string): string {
  return `select public.b2b_rep_scorecard(${day(from)}, ${day(to)}) as payload`;
}

/** A Kuwait calendar day, as YYYY-MM-DD. */
export function kuwaitDay(ms: number): string {
  return new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The scorecard windows a rep looks at. The week starts on Saturday, as the
 * CEO cockpit's pace does (the working week is Saturday to Thursday).
 */
export function scorecardWindows(
  nowMs: number,
): { key: string; from: string; to: string }[] {
  const today = kuwaitDay(nowMs);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  const sinceSaturday = (dow + 1) % 7;
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 8)}01`;
  return [
    { key: "today", from: today, to: today },
    { key: "week", from: addDays(today, -sinceSaturday), to: today },
    { key: "month", from: monthStart, to: today },
    { key: "last_month", from: lastMonthStart, to: lastMonthEnd },
    { key: "d30", from: addDays(today, -29), to: today },
    { key: "d90", from: addDays(today, -89), to: today },
  ];
}

/**
 * B2B's scorecard for one window, one row per person, so a rep can be
 * allowed to read their own row and not the others (the rates board is a
 * view over these rows with the counts left out).
 */
export function scorecardRows(
  w: { key: string; from: string; to: string },
  list: unknown,
  at: string,
): Record<string, unknown>[] {
  const arr = Array.isArray(list) ? list : [];
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const item of arr) {
    const r = (item ?? {}) as Record<string, unknown>;
    const key = String(r.person_key ?? r.display_name ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      window_key: w.key,
      person_key: key,
      from_day: w.from,
      to_day: w.to,
      display_name: r.display_name ?? null,
      role: r.role ?? null,
      is_known: r.is_known ?? null,
      row: r,
      computed_at: at,
    });
  }
  return out;
}

export interface CalendarInfo {
  type: string;
  label?: string;
}

/** A HighLevel calendar event as a cockpit appointment row. */
export function ghlEventRow(
  e: Record<string, unknown>,
  calendars: Record<string, CalendarInfo>,
  at: string,
): Record<string, unknown> | null {
  const id = String(e.id ?? "");
  const calendarId = String(e.calendarId ?? "");
  // HighLevel keeps deleted events in the list with deleted: true.
  if (!id || !calendarId || e.deleted === true) return null;
  const start = e.startTime ? new Date(String(e.startTime)) : null;
  const added = e.dateAdded ? new Date(String(e.dateAdded)) : null;
  return {
    appointment_id: id,
    contact_id: e.contactId ? String(e.contactId) : null,
    contact_name: e.title ? String(e.title).slice(0, 200) : null,
    calendar_id: calendarId,
    call_type: calendars[calendarId]?.type ?? null,
    start_at: start && !Number.isNaN(start.getTime()) ? start.toISOString() : null,
    booked_at: added && !Number.isNaN(added.getTime()) ? added.toISOString() : null,
    status: e.appointmentStatus ? String(e.appointmentStatus) : null,
    assigned_user_id: e.assignedUserId ? String(e.assignedUserId) : null,
    assigned_user_name: null,
    ad_id: null,
    origin: "ghl",
    mirrored_at: at,
  };
}

/** Drop the helper column and stamp the copy time. */
export function leadRow(
  r: Record<string, unknown>,
  at: string,
): Record<string, unknown> {
  const { changed_at: _changed, ...rest } = r;
  return {
    ...rest,
    tags: Array.isArray(rest.tags) ? rest.tags : [],
    lead_class: leadClass(rest.tags),
    mirrored_at: at,
  };
}

/** Never let a key into a log line or an error saved in a table. */
export function redact(s: string): string {
  return String(s)
    .replace(/sbp_[A-Za-z0-9]+/g, "[key]")
    .replace(/pit-[A-Za-z0-9-]+/g, "[key]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .slice(0, 400);
}

/** A HighLevel conversation (search result) as a cockpit inbox row. */
export function inboxRow(c: Record<string, unknown>, at: string): Record<string, unknown> | null {
  const id = String(c.id ?? "");
  if (!id) return null;
  const ms = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
  };
  const body = String(c.lastMessageBody ?? "").replace(/\s+/g, " ").trim();
  return {
    conversation_id: id,
    contact_id: c.contactId ? String(c.contactId) : null,
    contact_name: c.fullName ? String(c.fullName).slice(0, 200) : c.contactName ? String(c.contactName).slice(0, 200) : null,
    last_message_at: ms(c.lastMessageDate),
    last_direction: c.lastMessageDirection ? String(c.lastMessageDirection) : null,
    last_type: c.lastMessageType ? String(c.lastMessageType) : null,
    last_body: body ? body.slice(0, 300) : null,
    unread: Number.isFinite(Number(c.unreadCount)) ? Number(c.unreadCount) : null,
    inbound_whatsapp_at: ms(c.lastInboundWhatsappMessageDate),
    assigned_to: c.assignedTo ? String(c.assignedTo) : null,
    mirrored_at: at,
  };
}
