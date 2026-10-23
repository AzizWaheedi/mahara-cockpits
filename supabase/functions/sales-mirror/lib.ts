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

/**
 * Intro and demo appointments that start inside a window. Since 2026-10-11
 * also the call's Zoom link (HighLevel's address, only a zoom.us link: an
 * intro's address is often the lead's phone) and HighLevel's own reschedule
 * stamp (the closer's end of day counts it). Both come out of raw_payload
 * guarded, so an odd value is null and never fails the read.
 */
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
  c.ad_id,
  case when btrim(c.raw_payload->>'address') ~* '^https://[a-z0-9.-]*zoom\\.us/'
       then left(btrim(c.raw_payload->>'address'), 500) end as meet_url,
  case when c.raw_payload->>'rescheduledAt' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})$'
       then (c.raw_payload->>'rescheduledAt')::timestamptz end as crm_rescheduled_at
from public.calls as c
where c.start_at >= ${ts(fromIso)} and c.start_at < ${ts(toIso)}
  and c.ghl_appointment_id is not null`;
}

/**
 * Maqsam calls B2B stored after the watermark, in (synced_at, call id)
 * order. `after` is the last row of the page before, so a page never repeats
 * or skips a call, however many B2B stamped with one sync time. `after.at`
 * is B2B's own text for the time, microseconds kept.
 */
export function dialsSql(opts: {
  since: string;
  after?: { at: string; id: string } | null;
  limit: number;
}): string {
  const where = opts.after
    ? `(m.synced_at, m.maqsam_call_id) > (${ts(opts.after.at)}, ${lit(opts.after.id)})`
    : `m.synced_at > ${ts(opts.since)}`;
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
  nullif(regexp_replace(coalesce(m.lead_phone, ''), '\\D', '', 'g'), '') as lead_digits,
  m.sentiment,
  m.summary_en,
  m.summary_ar,
  (coalesce(m.transcript_turns, 0) > 0) as has_transcript,
  coalesce(m.call_tags, '{}') || coalesce(m.auto_tags, '{}') as tags,
  m.synced_at
from public.maqsam_calls as m
where ${where}
order by m.synced_at, m.maqsam_call_id
limit ${Math.max(1, Math.min(5000, Math.floor(opts.limit)))}`;
}

/**
 * Whether rows about to be dropped look like B2B answering oddly rather than
 * rows B2B really deleted: nothing read, or more gone than a fifth of what
 * was read (at least five). A real clear-out that size waits for a person.
 */
export function dropLooksWrong(read: number, gone: number): boolean {
  return read <= 0 || gone > Math.max(5, Math.ceil(read * 0.2));
}

/**
 * When B2B last read each of its own sources, and whether that worked
 * (Fathom has failed since 12 September, Wistia since 9 August), so the
 * cockpit can say a recording is missing because B2B stopped reading, not
 * because the call never happened. The account-level rows are the live ones.
 */
export function sourcesSql(): string {
  return `select source, last_synced_at, last_sync_status,
  left(last_error, 300) as last_error
from public.sync_state
where account_id is not null
order by source`;
}

/**
 * Two New Client Form answers B2B keeps only inside the form's raw_payload
 * (closed_deals has no column for them), read by the question's Typeform ref.
 * The column on the left is the column in cockpit_sales_deals (migration
 * 20261023x adds both). Deploy this mirror after it is applied; deployed
 * first, the deals step finds the columns missing and copies the deals
 * without them (index.ts dealAnswersStored), so the deal copy never stops.
 * Asked from 29 Aug 2026, so older forms read null. B2B lets a person
 * correct a deal's money after signing (DEAL_MONEY_EDIT_FIELDS), and that
 * correction rewrites the column, never raw_payload, so the typed answers
 * would no longer agree with the corrected plan or contract: on a deal with
 * such a correction both read null and the rule falls back to the plan
 * (b2b_apply_record_edits and b2b_editable_field read 2026-10-23; that day
 * no deal had one, the only edit was a closer's name). Billing's pending
 * payments read them (2026-10-23). Question titles as on Typeform
 * BTzMwXiw, read 2026-10-23.
 */
export const DEAL_ANSWERS = {
  /** "Cash To Be Collected On Onboarding" (USD; 0 = nothing left to collect on the call). */
  cash_at_onboarding: "b37f4cfe-82ab-4da7-b1f8-aaabe2afbf9b",
  /** "Second Payment Amount After Initial Payment (0 IF PAID IN FULL)" (USD). The rule applies it to each later part; the form asks only for the second. */
  second_payment: "ea6fccbd-d27e-4b57-8cfb-d3fa527f362f",
} as const;

/** The cockpit_sales_deals columns DEAL_ANSWERS fills (added by 20261023x). */
export const DEAL_ANSWER_COLUMNS = Object.keys(DEAL_ANSWERS) as (keyof typeof DEAL_ANSWERS)[];

/**
 * A Triage (PostgREST) refusal that says one of those columns is not there
 * yet: 42703 on a select, PGRST204 on a write. A mirror deployed before
 * 20261023x is applied keeps copying deals without the two answers instead
 * of failing every deals step (the deal copy feeds the sales cockpit, the
 * CEO's sales numbers and payroll attribution, not only billing).
 */
export function missingDealAnswerColumn(error: string): boolean {
  if (!/42703|PGRST204|does not exist|Could not find the/i.test(error)) return false;
  return DEAL_ANSWER_COLUMNS.some(c => error.includes(c));
}

/** A deal row without the two answers, for a Triage that has no columns for them yet. */
export function withoutDealAnswers<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row };
  for (const c of DEAL_ANSWER_COLUMNS) delete out[c];
  return out;
}

/**
 * The money fields of a deal B2B lets a person correct after signing
 * (b2b_editable_field, read 2026-10-23). It also allows names, the closer,
 * the CSM, the lead source, the agreement, the ad spend and the signing day;
 * none of those changes what the client owes.
 */
export const DEAL_MONEY_EDIT_FIELDS = [
  "payment_structure",
  "cash_collected",
  "contracted_revenue",
  "new_mrr",
] as const;

/** A money field corrected in B2B after signing: the form's typed answers may no longer agree, so they read null (the rule falls back to the plan). */
const MONEY_EDITED_SQL = `exists (
    select 1 from public.record_edits as e
     where e.entity = 'closed_deal' and e.record_id = d.response_id
       and e.field in (${DEAL_MONEY_EDIT_FIELDS.map(lit).join(", ")}))`;

/**
 * One number answer of the form by its ref. Every answer on B2B is of type
 * number today (11 and 10 forms, 29 Aug to 17 Oct); anything else, a
 * negative number, a missing answer or a payload with no answer list reads
 * null (missing, never zero) and never fails the read. A 0 typed on the
 * form stays 0.
 */
function answerNumberSql(ref: string): string {
  // The CASE guards the cast: Postgres may test WHERE conditions in any order.
  return `(select y.n from (
      select x.i,
             case when jsonb_typeof(x.a -> 'number') = 'number'
                  then (x.a ->> 'number')::numeric end as n
        from jsonb_array_elements(
          case when jsonb_typeof(d.raw_payload -> 'answers') = 'array'
               then d.raw_payload -> 'answers' else '[]'::jsonb end
        ) with ordinality as x(a, i)
       where x.a #>> '{field,ref}' = ${lit(ref)}
    ) as y
    where y.n >= 0
    order by y.i
    limit 1)`;
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
  case when not ${MONEY_EDITED_SQL} then ${answerNumberSql(DEAL_ANSWERS.cash_at_onboarding)} end as cash_at_onboarding,
  case when not ${MONEY_EDITED_SQL} then ${answerNumberSql(DEAL_ANSWERS.second_payment)} end as second_payment,
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

/** Deals B2B has voided, with what the scorecard attributes them by. */
export function voidedDealsSql(): string {
  return `select cd.response_id, cd.closer, cd.submitted_at,
  cd.contracted_revenue, cd.cash_collected, cd.new_mrr
from public.closed_deals as cd
where exists (
  select 1 from public.record_voids as v
   where v.entity = 'closed_deal' and v.record_id = cd.response_id
)`;
}

export interface VoidedDeal {
  response_id: string;
  closer: string | null;
  submitted_at: string;
  contracted_revenue: number | string | null;
  cash_collected: number | string | null;
  new_mrr: number | string | null;
}

const n0 = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Take voided deals out of B2B's scorecard rows for one window.
 *
 * B2B's b2b_rep_scorecard counts every row of closed_deals, voided or not
 * (August 2026: 12 closes and $6,500 there, 10 and $5,000 without the two
 * voids). Voids are attributed exactly as the scorecard attributes deals:
 * the Riyadh day the form was submitted, and the rep whose closer_aliases
 * hold the deal's closer name, else "unattributed". The row keeps B2B's own
 * figures under `b2b` and what was taken out under `voided`, so a page can
 * say how and why it differs from the CEO cockpit.
 */
export function applyVoids(
  rows: Record<string, unknown>[],
  voids: VoidedDeal[],
  reps: { id: string; closer_aliases: string[] | null }[],
  w: { from: string; to: string },
): Record<string, unknown>[] {
  const byPerson = new Map<string, { closes: number; revenue: number; cash: number; mrr: number }>();
  for (const d of voids) {
    const day = new Date(Date.parse(d.submitted_at) + 3 * 3_600_000).toISOString().slice(0, 10);
    if (!(day >= w.from && day <= w.to)) continue;
    const name = String(d.closer ?? "").trim().toLowerCase();
    const matches = reps.filter(r => (r.closer_aliases ?? []).some(a => String(a).trim().toLowerCase() === name));
    // The scorecard's left join counts a deal once per matching rep.
    for (const key of matches.length ? matches.map(r => r.id) : ["unattributed"]) {
      const t = byPerson.get(key) ?? { closes: 0, revenue: 0, cash: 0, mrr: 0 };
      t.closes += 1;
      t.revenue += n0(d.contracted_revenue);
      t.cash += n0(d.cash_collected);
      t.mrr += n0(d.new_mrr);
      byPerson.set(key, t);
    }
  }
  return rows.map(r => {
    const v = byPerson.get(String(r.person_key ?? ""));
    if (!v) return r;
    const closes = Math.max(0, n0(r.closes) - v.closes);
    const revenue = Math.max(0, n0(r.revenue) - v.revenue);
    const cash = Math.max(0, n0(r.cash_collected) - v.cash);
    const mrr = Math.max(0, n0(r.new_mrr) - v.mrr);
    const qualified = n0(r.demos_qualified);
    return {
      ...r,
      closes,
      revenue: Math.round(revenue * 100) / 100,
      cash_collected: Math.round(cash * 100) / 100,
      new_mrr: Math.round(mrr * 100) / 100,
      close_rate: qualified > 0 ? Math.round((1000 * closes) / qualified) / 10 : null,
      avg_deal: closes > 0 ? Math.round(revenue / closes) : null,
      b2b: {
        closes: r.closes ?? null,
        revenue: r.revenue ?? null,
        cash_collected: r.cash_collected ?? null,
        new_mrr: r.new_mrr ?? null,
        close_rate: r.close_rate ?? null,
        avg_deal: r.avg_deal ?? null,
      },
      voided: { closes: v.closes, revenue: v.revenue, cash_collected: v.cash, new_mrr: v.mrr },
    };
  });
}

export function repsSql(): string {
  return `select id, display_name, role, ghl_user_id,
  coalesce(closer_aliases, '{}') as closer_aliases, is_active, maqsam_email, fathom_email
from public.sales_reps`;
}

/**
 * The published sales assets, with B2B's own rule for what may be sent
 * worked out there (b2b_asset_shortlist's filter): link not broken, claims
 * not expired, and asset_sendable_age (no YouTube video from before 19 July,
 * Aziz's rule of 8 August). The page text (raw_content) stays in B2B.
 */
export function assetsSql(): string {
  return `select id, slug, title, asset_type, send_when,
  coalesce(stages, '{}') as stages, coalesce(objections, '{}') as objections,
  coalesce(industries, '{}') as industries, coalesce(personas, '{}') as personas,
  coalesce(proof_types, '{}') as proof_types, language, what_it_proves,
  paste_message_ar, paste_message_en, does_not_cover, usage_notes, url, thumbnail_url,
  duration_seconds, published_at, theme, coalesce(is_canonical, false) as is_canonical,
  claims_expire_at, link_ok, send_count, updated_at,
  (coalesce(link_ok, true)
    and (claims_expire_at is null or claims_expire_at >= (now() at time zone 'Asia/Riyadh')::date)
    and public.asset_sendable_age(asset_type, published_at)) as sendable
from public.assets
where status = 'published'`;
}

export function assetVocabSql(): string {
  return `select facet, value, label, description, sort_order from public.asset_vocab where is_active`;
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
 * One scorecard window per Kuwait month, newest first: the current month
 * up to today (key "m2026-09"), then `back` whole months before it. The
 * Goals page reads these for "past numbers" against each month's goal.
 */
export function monthWindows(
  nowMs: number,
  back = 11,
): { key: string; from: string; to: string; current: boolean }[] {
  const today = kuwaitDay(nowMs);
  const out: { key: string; from: string; to: string; current: boolean }[] = [];
  let start = `${today.slice(0, 8)}01`;
  let end = today;
  for (let i = 0; i <= back; i++) {
    out.push({ key: `m${start.slice(0, 7)}`, from: start, to: end, current: i === 0 });
    end = addDays(start, -1);
    start = `${end.slice(0, 8)}01`;
  }
  return out;
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
    meet_url: meetUrl(e.address),
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
    .replace(/((?:api_?key|access_token|token|secret)=)[^&\s"']+/gi, "$1[key]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [key]")
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

/**
 * A contact straight from HighLevel, as a lead row, for the minutes before
 * B2B's own sync has it (B2B reads HighLevel every 15 minutes; a new lead
 * should be called in two). Only inserted when the lead is not there yet:
 * B2B's fuller row always wins.
 */
export function ghlContactRow(c: Record<string, unknown>, at: string): Record<string, unknown> | null {
  const id = String(c.id ?? "");
  if (!id) return null;
  const cf = new Map<string, unknown>();
  for (const f of (Array.isArray(c.customFields) ? c.customFields : []) as Record<string, unknown>[])
    if (f?.id) cf.set(String(f.id), f.value);
  const field = (fid: string) => {
    const v = cf.get(fid);
    const t = Array.isArray(v) ? v.join(", ") : String(v ?? "").trim();
    return t || null;
  };
  const answers = Object.fromEntries(Object.entries(LEAD_FIELDS).map(([col, fid]) => [col, field(fid)]));
  const name =
    String(c.contactName ?? "").trim() ||
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
    null;
  const tags = Array.isArray(c.tags) ? c.tags.map(String) : [];
  const added = c.dateAdded ? new Date(String(c.dateAdded)) : null;
  const updated = c.dateUpdated ? new Date(String(c.dateUpdated)) : null;
  return {
    contact_id: id,
    name,
    email: c.email ? String(c.email) : null,
    phone: c.phone ? String(c.phone) : null,
    phone8: phone8(c.phone),
    company: c.companyName ? String(c.companyName) : null,
    country: c.country ? String(c.country) : null,
    source: c.source ? String(c.source) : null,
    tags,
    lead_class: leadClass(tags),
    is_lead: null,
    contact_type: c.type ? String(c.type) : null,
    dnd: typeof c.dnd === "boolean" ? c.dnd : null,
    assigned_to: c.assignedTo ? String(c.assignedTo) : null,
    ad_id: field("oNCqOSC5QOhkzEbP1BrZ"),
    adset_id: null,
    campaign_id: null,
    ...answers,
    opportunity_id: null,
    pipeline_id: null,
    pipeline_name: null,
    stage_id: null,
    stage_name: null,
    opp_status: null,
    monetary_value: null,
    opp_updated_at: null,
    lead_created_at: added && !Number.isNaN(added.getTime()) ? added.toISOString() : null,
    lead_updated_at: updated && !Number.isNaN(updated.getTime()) ? updated.toISOString() : null,
    mirrored_at: at,
  };
}

// ---------------------------------------------------------------------------
// A call rescheduled in the cockpit (2026-10-11). A copy of sales-api's
// reschedule.ts holdStart and meetUrl (an Edge Function cannot import from
// another), with the same tests in lib.test.ts: change both together.
// ---------------------------------------------------------------------------

const MINUTE = 60_000;

/** The Zoom join link in a HighLevel address, or null (an intro's address is often the lead's phone). */
export function meetUrl(address: unknown): string | null {
  const a = String(address ?? "").trim();
  return /^https:\/\/[a-z0-9.-]*zoom\.us\//i.test(a) ? a.slice(0, 500) : null;
}

function instant(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function sameTime(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) < MINUTE;
}

/** An open reschedule of a call (cockpit_sales_reschedules in state moved, neither caught nor released). */
export interface Hold {
  id: string;
  appointment_id: string;
  from_start: string;
  to_start: string;
  from_user_id?: string | null;
  to_user_id?: string | null;
  created_at: string;
}

export type HoldVerdict =
  | { kind: "none" }
  | { kind: "hold"; start_at: string; assigned_user_id: string | null; ids: string[]; since: number }
  | { kind: "caught"; ids: string[] }
  | { kind: "released"; ids: string[]; why: string };

/** When a hold lapses: the later of a day after the move or an hour after the new start. */
export function holdLapse(h: Hold): number {
  return Math.max((instant(h.created_at) ?? 0) + DAY_MS, (instant(h.to_start) ?? 0) + 60 * MINUTE);
}

/**
 * What the mirror does with B2B's row for a call the cockpit moved (D34):
 * while B2B shows a time the cockpit moved it away from, the cockpit's
 * newest time is kept (and its host, when the move changed it); B2B showing
 * the new time ends the hold (caught); any third time means someone moved it
 * again in HighLevel (released); a hold B2B never catches lapses at the later
 * of a day or an hour after the new start.
 */
export function holdStart(
  row: { start_at?: unknown; assigned_user_id?: unknown },
  holds: Hold[],
  now: number,
): HoldVerdict {
  if (!holds.length) return { kind: "none" };
  const ordered = [...holds].sort((a, b) => (instant(a.created_at) ?? 0) - (instant(b.created_at) ?? 0));
  const newest = ordered[ordered.length - 1] as Hold;
  const ids = ordered.map(h => h.id);
  const shown = instant(row.start_at);
  const to = instant(newest.to_start);
  if (sameTime(shown, to)) return { kind: "caught", ids };
  if (now > holdLapse(newest)) return { kind: "released", ids, why: "lapsed: B2B never showed the new time" };
  const old = ordered.some(h => sameTime(shown, instant(h.from_start)));
  if (!old) return { kind: "released", ids, why: "moved again in HighLevel" };
  const fromUser = newest.from_user_id ? String(newest.from_user_id) : null;
  const toUser = newest.to_user_id ? String(newest.to_user_id) : null;
  const hostMoved = toUser !== null && toUser !== fromUser;
  const shownUser = row.assigned_user_id ? String(row.assigned_user_id) : null;
  return {
    kind: "hold",
    start_at: new Date(to as number).toISOString(),
    assigned_user_id: hostMoved && (shownUser === null || shownUser === fromUser) ? toUser : null,
    ids,
    since: instant(newest.created_at) ?? now,
  };
}

/** Holds grouped by call. */
export function holdsByCall(rows: Record<string, unknown>[]): Map<string, Hold[]> {
  const out = new Map<string, Hold[]>();
  for (const r of rows) {
    const id = String(r.appointment_id ?? "");
    if (!id || !r.from_start || !r.to_start) continue;
    out.set(id, [
      ...(out.get(id) ?? []),
      {
        id: String(r.id),
        appointment_id: id,
        from_start: String(r.from_start),
        to_start: String(r.to_start),
        from_user_id: (r.from_user_id as string | null) ?? null,
        to_user_id: (r.to_user_id as string | null) ?? null,
        created_at: String(r.created_at ?? ""),
      },
    ]);
  }
  return out;
}

/** A hold older than this is said in the run's row: B2B is slow to carry a cockpit reschedule. */
export const HOLD_WARN_MS = 60 * MINUTE;

/**
 * Every row of a read through the holds: the rows to write (a held row with
 * the cockpit's time), the holds B2B caught, the ones released (and why),
 * and a warning for each hold still held after an hour.
 */
export function applyHolds(
  rows: Record<string, unknown>[],
  holds: Map<string, Hold[]>,
  now: number,
): {
  rows: Record<string, unknown>[];
  held: number;
  caught: string[];
  released: { ids: string[]; why: string }[];
  warnings: string[];
} {
  const caught: string[] = [];
  const released: { ids: string[]; why: string }[] = [];
  const warnings: string[] = [];
  let held = 0;
  const out = rows.map(r => {
    const id = String(r.appointment_id ?? "");
    const v = holdStart(r, holds.get(id) ?? [], now);
    if (v.kind === "caught") caught.push(...v.ids);
    else if (v.kind === "released") released.push({ ids: v.ids, why: v.why });
    else if (v.kind === "hold") {
      held++;
      if (now - v.since > HOLD_WARN_MS) warnings.push(`B2B has not carried the reschedule of ${id} yet`);
      return { ...r, start_at: v.start_at, ...(v.assigned_user_id ? { assigned_user_id: v.assigned_user_id } : {}) };
    }
    return r;
  });
  return { rows: out, held, caught, released, warnings };
}
