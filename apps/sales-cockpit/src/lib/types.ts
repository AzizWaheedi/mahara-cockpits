/** Rows as the sales tables and views return them (supabase/migrations/20260924*_sales_*.sql). */

export type SalesRole = "setter" | "closer" | "both" | "manager";

export interface Me {
  signed_in: boolean;
  email?: string;
  seat?: boolean;
  manager?: boolean;
  ceo?: boolean;
  name?: string | null;
  role?: SalesRole | null;
  active?: boolean | null;
  via_portal?: boolean | null;
  ghl_user_id?: string | null;
  b2b_rep_id?: string | null;
  maqsam_email?: string | null;
  /** "seat" when the seat names it, "b2b" when it comes from B2B's rep directory. */
  maqsam_from?: "seat" | "b2b" | null;
  fathom_email?: string | null;
  fathom_from?: "seat" | "b2b" | null;
  slack_user_id?: string | null;
}

export interface Lead {
  contact_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  phone8: string | null;
  company: string | null;
  country: string | null;
  source: string | null;
  tags: string[];
  lead_class: "qualified" | "unqualified" | "unprepared" | null;
  is_lead: boolean | null;
  contact_type: string | null;
  dnd: boolean | null;
  assigned_to: string | null;
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  booking_channel: string | null;
  revenue: string | null;
  readiness: string | null;
  revenue_goal: string | null;
  decision_maker: string | null;
  challenge: string | null;
  services: string | null;
  grade: string | null;
  setter_name: string | null;
  lead_stage: string | null;
  opportunity_id: string | null;
  pipeline_id: string | null;
  pipeline_name: string | null;
  stage_id: string | null;
  stage_name: string | null;
  opp_status: string | null;
  monetary_value: number | null;
  opp_updated_at: string | null;
  lead_created_at: string | null;
  lead_updated_at: string | null;
  mirrored_at: string;
}

export type CallType = "intro" | "demo" | "follow_up" | "callback";
export type MarkStatus = "showed" | "noshow" | "cancelled" | "invalid";

/** cockpit_sales_calendar: an appointment with the rep's current mark. */
export interface CalendarRow {
  appointment_id: string;
  contact_id: string | null;
  contact_name: string | null;
  calendar_id: string | null;
  call_type: CallType | null;
  start_at: string | null;
  booked_at: string | null;
  crm_status: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  ad_id: string | null;
  origin: "b2b" | "ghl";
  mirrored_at: string;
  mark_id: number | null;
  marked_status: MarkStatus | null;
  mark_reason: string | null;
  mark_note: string | null;
  marked_by: string | null;
  marked_at: string | null;
  mark_crm: "off" | "pending" | "written" | "skipped" | "failed" | null;
  mark_crm_error: string | null;
  /** The mark when there is one, else HighLevel's status. */
  status: string | null;
  needs_mark: boolean;
}

export interface Dial {
  call_id: string;
  occurred_at: string | null;
  agent_email: string | null;
  agent_name: string | null;
  sales_rep_id: string | null;
  direction: "inbound" | "outbound" | null;
  state: string | null;
  duration_s: number | null;
  ringing_s: number | null;
  handling_s: number | null;
  lead_phone8: string | null;
  contact_id: string | null;
  sentiment: string | null;
  summary_en: string | null;
  summary_ar: string | null;
  has_transcript: boolean | null;
  tags: string[];
}

export interface Deal {
  response_id: string;
  submitted_at: string | null;
  closer: string | null;
  /** From the New Client Form's hidden field when the cockpit filled it. */
  setter: string | null;
  contact_id: string | null;
  /** form: the form said which lead (exact). matched: B2B matched by email or phone. */
  contact_from: "form" | "matched" | null;
  client_name: string | null;
  business_name: string | null;
  email: string | null;
  phone8: string | null;
  country: string | null;
  payment_structure: string | null;
  agreement_type: string | null;
  cash_collected: number | string | null;
  contracted_revenue: number | string | null;
  new_mrr: number | string | null;
  daily_ad_spend: number | string | null;
  csm: string | null;
  fathom_link: string | null;
  lead_source: string | null;
  ad_id: string | null;
  voided: boolean;
}

export interface Note {
  id: string;
  contact_id: string;
  appointment_id: string | null;
  kind: "note" | "call" | "script" | "ai" | "handoff";
  body: string;
  fields: Record<string, unknown>;
  author: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type ProposalStatus =
  | "drafting"
  | "needs_input"
  | "ready"
  | "sent"
  | "failed"
  | "archived";

export interface Proposal {
  id: string;
  request_id: string | null;
  contact_id: string | null;
  appointment_id: string | null;
  recording_id: string | null;
  lang: "ar" | "en";
  variant: string | null;
  status: ProposalStatus;
  deal: Record<string, unknown> | null;
  validation: Record<string, unknown> | null;
  fill_count: number | null;
  html_path: string | null;
  pdf_path: string | null;
  model: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  sent_by: string | null;
  error: string | null;
}

export interface WorkRequest {
  id: string;
  kind: string;
  contact_id: string | null;
  appointment_id: string | null;
  params: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  requested_by: string;
  requested_at: string;
  claimed_at: string | null;
  attempts: number;
  finished_at: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
}

export interface Recording {
  recording_id: string;
  title: string | null;
  recorded_by: string | null;
  started_at: string | null;
  duration_s: number | null;
  share_url: string | null;
  contact_id: string | null;
  appointment_id: string | null;
  matched_by: string | null;
  indexed_at: string;
  /** fathom (the desk's look-back), vault (the Obsidian copy), drive. */
  source?: string | null;
  language?: string | null;
  people?: { name: string; email: string }[] | null;
  summary?: string | null;
  action_items?: string | null;
  /** In the private bucket sales-calls. */
  transcript_path?: string | null;
  transcript_chars?: number | null;
}

/** One of Vince's reviews: his archive, or one the desk wrote since. */
export interface Review {
  id: string;
  source_ref: string;
  source: "vince-archive" | "desk";
  recording_id: string | null;
  maqsam_call_id: string | null;
  contact_id: string | null;
  call_type: "intro" | "demo" | null;
  rep_name: string | null;
  rep_key: string | null;
  lead_name: string | null;
  call_at: string | null;
  reviewed_at: string;
  model: string | null;
  score: number | null;
  score_max: number | null;
  items: { name: string; score: number; max: number }[] | null;
  pros: string | null;
  feedback: string | null;
  body: string;
  joined_by: string | null;
}

export interface TeamMember {
  email: string;
  name: string | null;
  role: SalesRole;
  ghl_user_id: string | null;
  b2b_rep_id: string | null;
  active: boolean;
  via_portal: boolean;
}

export interface PayRule {
  cash_rate?: number;
  pif_bonus?: number;
  per_intro_shown?: number;
  per_demo_shown?: number;
  per_signed?: number;
  currency?: string;
  note?: string;
}

export interface Goals {
  weekly?: Partial<Record<GoalKey, number>>;
  monthly?: Partial<Record<GoalKey, number>>;
}
export type GoalKey =
  | "booked"
  | "shown"
  | "closes"
  | "cash"
  | "dials"
  | "conversations";

export interface Person extends TeamMember {
  maqsam_email: string | null;
  fathom_email: string | null;
  slack_user_id: string | null;
  goals: Goals;
  pay: PayRule;
  added_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface Rep {
  id: string;
  display_name: string | null;
  role: string | null;
  ghl_user_id: string | null;
  closer_aliases: string[];
  is_active: boolean | null;
  maqsam_email: string | null;
  fathom_email: string | null;
}

/** One person's row of B2B's b2b_rep_scorecard. */
export interface Scorecard {
  person_key: string;
  display_name: string | null;
  role: string | null;
  is_known: boolean | null;
  calls_scheduled: number;
  calls_due: number;
  calls_shown: number;
  calls_qualified: number;
  demos_scheduled: number;
  demos_due: number;
  demos_shown: number;
  demos_qualified: number;
  disqualified_count: number;
  noshow_count: number;
  cancelled_count: number;
  show_rate: number | null;
  noshow_rate: number | null;
  disqualified_rate: number | null;
  closes: number;
  revenue: number | null;
  cash_collected: number | null;
  new_mrr: number | null;
  close_rate: number | null;
  avg_deal: number | null;
}

export type WindowKey =
  | "today"
  | "week"
  | "month"
  | "last_month"
  | "d30"
  | "d90";

export interface ScoreRow {
  window_key: WindowKey;
  person_key: string;
  from_day: string;
  to_day: string;
  display_name: string | null;
  role: string | null;
  is_known: boolean | null;
  row: Scorecard;
  computed_at: string;
}

export interface BoardRow {
  window_key: WindowKey;
  person_key: string;
  display_name: string | null;
  role: string | null;
  from_day: string;
  to_day: string;
  show_rate: number | null;
  noshow_rate: number | null;
  disqualified_rate: number | null;
  qualified_rate: number | null;
  qualified_close_rate: number | null;
  close_rate: number | null;
  has_calls: boolean;
  computed_at: string;
}

export interface SalesLink {
  id: string;
  label: string;
  url: string;
  kind:
    | "deck"
    | "form"
    | "calculator"
    | "proof"
    | "library"
    | "script"
    | "other";
  note: string | null;
  sort: number;
  active: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface MirrorRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  mode: string | null;
  ok: boolean | null;
  counts: Record<string, unknown>;
  error: string | null;
}

export interface WorkerStatus {
  worker: string;
  job: string;
  ok: boolean;
  detail: string | null;
  at: string;
}

/** cockpit_sales_inbox: the newest conversations, for "who wrote back". */
export interface InboxRow {
  conversation_id: string;
  contact_id: string | null;
  contact_name: string | null;
  last_message_at: string | null;
  last_direction: "inbound" | "outbound" | null;
  last_type: string | null;
  last_body: string | null;
  unread: number | null;
  inbound_whatsapp_at: string | null;
  assigned_to: string | null;
  mirrored_at: string;
}
