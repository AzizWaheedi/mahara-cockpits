import { useCallback, useEffect, useRef, useState } from "react";
import type { CallRow, LeadRow } from "./calls";
import type { GoalRow } from "./goals";
import { supabase } from "./supabase";
import type {
  BoardRow,
  CalendarRow,
  CoachReview,
  Deal,
  Dial,
  InboxRow,
  Lead,
  Me,
  MirrorRun,
  Note,
  Person,
  Proposal,
  Recording,
  Rep,
  Review,
  ReviewAsk,
  SalesLink,
  ScoreRow,
  TeamMember,
  WindowKey,
  WorkerStatus,
  WorkRequest,
} from "./types";
import type { Snippet, TemplateRoute } from "./whatsapp";

/** One shape for every read: what came back, whether it is still loading,
 * and why it failed. A screen that cannot say "this failed" lies quietly. */
export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

type Result<T> = PromiseLike<{
  data: T | null;
  error: { message: string } | null;
}>;

/**
 * Run a read, again whenever its inputs change, and again every `everyMs`
 * while the tab is visible. A reload keeps the old rows on screen until the
 * new ones arrive, so a refresh never blanks a list someone is working in.
 */
export function useQuery<T>(
  run: () => Result<T>,
  deps: unknown[],
  everyMs = 0,
): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are the caller's
  const fetcher = useCallback(run, [...deps, tick]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.resolve(fetcher()).then(
      ({ data: rows, error: err }) => {
        if (!alive) return;
        setError(err ? err.message : null);
        if (!err) setData(rows ?? null);
        setLoading(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(String((e as Error)?.message ?? e));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [fetcher]);

  useEffect(() => {
    if (!everyMs) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick(n => n + 1);
    }, everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);

  // Stable, so a caller can put it in an effect's dependencies.
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { data, error, loading, reload };
}

/**
 * Every row of a read, a thousand at a time. The API answers at most 1,000
 * rows per request, so a larger read without this comes back short and
 * says nothing. `make` builds the query for one range.
 */
export async function readAll<T>(
  make: (from: number, to: number) => Result<T[]>,
  cap = 20_000,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) return { data: null, error };
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}

const none = <T>(): Result<T> => Promise.resolve({ data: null, error: null });

/** The current minute, ticking, for anything drawn against "now". */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}

export function useMe(enabled: boolean): Loaded<Me> {
  return useQuery<Me>(
    () => (enabled ? supabase.rpc("cockpit_sales_whoami") : none<Me>()),
    [enabled],
  );
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

/** Appointments starting in [fromIso, toIso), optionally one rep's. */
export function useCalendar(
  fromIso: string,
  toIso: string,
  ghlUserId: string | null,
  everyMs = 60_000,
): Loaded<CalendarRow[]> {
  return useQuery<CalendarRow[]>(
    () =>
      readAll<CalendarRow>((from, to) => {
        let q = supabase
          .from("cockpit_sales_calendar")
          .select("*")
          .gte("start_at", fromIso)
          .lt("start_at", toIso)
          .order("start_at", { ascending: true })
          .order("appointment_id", { ascending: true })
          .range(from, to);
        if (ghlUserId) q = q.eq("assigned_user_id", ghlUserId);
        return q;
      }, 5000),
    [fromIso, toIso, ghlUserId],
    everyMs,
  );
}

/** Past calls still owed a mark, newest first (30 days; older is backlog). */
export function useOwed(
  ghlUserId: string | null,
  days = 30,
  everyMs = 60_000,
): Loaded<CalendarRow[]> {
  return useQuery<CalendarRow[]>(
    () => {
      let q = supabase
        .from("cockpit_sales_calendar")
        .select("*")
        .eq("needs_mark", true)
        .gte("start_at", new Date(Date.now() - days * 86_400_000).toISOString())
        .order("start_at", { ascending: false })
        .limit(300);
      if (ghlUserId) q = q.eq("assigned_user_id", ghlUserId);
      return q;
    },
    [ghlUserId, days],
    everyMs,
  );
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/** Leads created in the last `hours`, newest first. */
export function useNewLeads(hours = 48, everyMs = 60_000): Loaded<Lead[]> {
  return useQuery<Lead[]>(
    () =>
      supabase
        .from("cockpit_sales_leads")
        .select("*")
        .gte(
          "lead_created_at",
          new Date(Date.now() - hours * 3_600_000).toISOString(),
        )
        .order("lead_created_at", { ascending: false })
        .limit(100),
    [hours],
    everyMs,
  );
}

export interface LeadFilter {
  q: string;
  leadClass: string;
  stage: string;
  days: number;
  page: number;
}

export const PAGE = 50;

/** Strip what PostgREST's or() filter would read as syntax. */
function safeTerm(q: string): string {
  return q
    .replace(/[,()*%\\"]/g, " ")
    .trim()
    .slice(0, 80);
}

export function useLeads(f: LeadFilter): Loaded<Lead[]> {
  return useQuery<Lead[]>(() => {
    let q = supabase
      .from("cockpit_sales_leads")
      .select("*")
      .order("lead_created_at", { ascending: false, nullsFirst: false })
      .range(f.page * PAGE, f.page * PAGE + PAGE - 1);
    const term = safeTerm(f.q);
    if (term) {
      const digits = term.replace(/\D/g, "");
      const parts = [
        `name.ilike.*${term}*`,
        `email.ilike.*${term}*`,
        `company.ilike.*${term}*`,
      ];
      if (digits.length >= 6) parts.push(`phone8.like.*${digits.slice(-8)}*`);
      q = q.or(parts.join(","));
    }
    if (f.leadClass === "none") q = q.is("lead_class", null);
    else if (f.leadClass) q = q.eq("lead_class", f.leadClass);
    if (f.stage) q = q.eq("stage_id", f.stage);
    if (f.days > 0)
      q = q.gte(
        "lead_created_at",
        new Date(Date.now() - f.days * 86_400_000).toISOString(),
      );
    return q;
  }, [f.q, f.leadClass, f.stage, f.days, f.page]);
}

/**
 * Leads matching a name, email, company or the last digits of a phone, for
 * the dialer's search. Nothing is read under two characters.
 */
export function useLeadSearch(term: string): Loaded<Lead[]> {
  const t = safeTerm(term);
  return useQuery<Lead[]>(() => {
    if (t.length < 2) return none<Lead[]>();
    const digits = t.replace(/\D/g, "");
    const parts = [
      `name.ilike.*${t}*`,
      `email.ilike.*${t}*`,
      `company.ilike.*${t}*`,
    ];
    if (digits.length >= 4) parts.push(`phone8.like.*${digits.slice(-8)}*`);
    return supabase
      .from("cockpit_sales_leads")
      .select("*")
      .or(parts.join(","))
      .order("lead_created_at", { ascending: false, nullsFirst: false })
      .limit(20);
  }, [t]);
}

/** The pipeline's stages, from the leads that sit in them. */
export function useStages(): Loaded<
  { stage_id: string; stage_name: string; pipeline_name: string | null }[]
> {
  return useQuery(
    () =>
      readAll<{
        stage_id: string;
        stage_name: string;
        pipeline_name: string | null;
      }>(
        (from, to) =>
          supabase
            .from("cockpit_sales_leads")
            .select("stage_id,stage_name,pipeline_name")
            .not("stage_id", "is", null)
            .gte(
              "lead_created_at",
              new Date(Date.now() - 365 * 86_400_000).toISOString(),
            )
            .order("contact_id", { ascending: true })
            .range(from, to),
        10_000,
      ),
    [],
  );
}

export function useLead(contactId: string): Loaded<Lead> {
  return useQuery<Lead>(
    () =>
      supabase
        .from("cockpit_sales_leads")
        .select("*")
        .eq("contact_id", contactId)
        .maybeSingle(),
    [contactId],
  );
}

export interface LeadActivity {
  appointments: CalendarRow[];
  dials: Dial[];
  deals: Deal[];
  notes: Note[];
  proposals: Proposal[];
  requests: WorkRequest[];
  recordings: Recording[];
}

/** Everything that happened with one lead, read in one go. */
export function useLeadActivity(
  contactId: string,
  phone8: string | null,
): Loaded<LeadActivity> {
  return useQuery<LeadActivity>(async () => {
    const dialsQ = supabase
      .from("cockpit_sales_dials")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(200);
    const [appointments, dials, deals, notes, proposals, requests, recordings] =
      await Promise.all([
        supabase
          .from("cockpit_sales_calendar")
          .select("*")
          .eq("contact_id", contactId)
          .order("start_at", { ascending: false }),
        phone8
          ? dialsQ.or(`contact_id.eq.${contactId},lead_phone8.eq.${phone8}`)
          : dialsQ.eq("contact_id", contactId),
        supabase
          .from("cockpit_sales_deals")
          .select("*")
          .eq("contact_id", contactId)
          .order("submitted_at", { ascending: false }),
        supabase
          .from("cockpit_sales_notes")
          .select("*")
          .eq("contact_id", contactId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("cockpit_sales_proposals")
          .select("*")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false }),
        supabase
          .from("cockpit_sales_requests")
          .select("*")
          .eq("contact_id", contactId)
          .order("requested_at", { ascending: false })
          .limit(20),
        supabase
          .from("cockpit_sales_recordings")
          .select("*")
          .eq("contact_id", contactId)
          .order("started_at", { ascending: false }),
      ]);
    const failed = [
      appointments,
      dials,
      deals,
      notes,
      proposals,
      requests,
      recordings,
    ].find(r => r.error);
    if (failed?.error) return { data: null, error: failed.error };
    return {
      data: {
        appointments: (appointments.data ?? []) as CalendarRow[],
        dials: (dials.data ?? []) as Dial[],
        deals: (deals.data ?? []) as Deal[],
        notes: (notes.data ?? []) as Note[],
        proposals: (proposals.data ?? []) as Proposal[],
        requests: (requests.data ?? []) as WorkRequest[],
        recordings: (recordings.data ?? []) as Recording[],
      },
      error: null,
    };
  }, [contactId, phone8]);
}

/** Contacts by id, for lists of appointments that only carry the id. */
export function useLeadsById(ids: string[]): Loaded<Lead[]> {
  const key = [...new Set(ids)].sort().join(",");
  return useQuery<Lead[]>(
    () =>
      key
        ? supabase
            .from("cockpit_sales_leads")
            .select("*")
            .in("contact_id", key.split(","))
        : Promise.resolve({ data: [], error: null }),
    [key],
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Full scorecard rows: a rep gets their own, a manager everyone's. */
export function useScoreRows(windowKey: WindowKey): Loaded<ScoreRow[]> {
  return useQuery<ScoreRow[]>(
    () =>
      supabase
        .from("cockpit_sales_scorecards")
        .select("*")
        .eq("window_key", windowKey),
    [windowKey],
    120_000,
  );
}

/**
 * B2B's scorecard by Kuwait month (window keys "m2026-09" and back a year),
 * for one rep or, for a manager, everyone. Voided deals are already out.
 */
export function useMonthCards(
  rep: string | null,
  month?: string,
): Loaded<ScoreRow[]> {
  return useQuery<ScoreRow[]>(
    () => {
      let q = supabase
        .from("cockpit_sales_scorecards")
        .select("*")
        .like("window_key", month ? `m${month}` : "m2%");
      if (rep) q = q.eq("person_key", rep);
      return q.order("window_key", { ascending: false }).limit(1000);
    },
    [rep, month],
    300_000,
  );
}

/** Monthly goals and forecasts from `fromMonth` on: one rep's, or all a manager may read. */
export function useGoalRows(
  rep: string | null,
  fromMonth: string,
  toMonth?: string,
): Loaded<GoalRow[]> {
  return useQuery<GoalRow[]>(() => {
    let q = supabase
      .from("cockpit_sales_goals")
      .select("*")
      .gte("month", `${fromMonth}-01`);
    if (toMonth) q = q.lte("month", `${toMonth}-01`);
    if (rep) q = q.eq("person_key", rep);
    return q.order("month", { ascending: false }).limit(1000);
  }, [rep, fromMonth, toMonth]);
}

export interface DialMonth {
  agent_email: string;
  month: string;
  outbound: number;
  connected: number;
}

/** Outbound Maqsam dials per address per month: one address, or everyone's for one month. */
export function useDialMonths(
  email: string | null,
  month?: string,
): Loaded<DialMonth[]> {
  return useQuery<DialMonth[]>(
    () => {
      if (!email && !month) return none<DialMonth[]>();
      let q = supabase.from("cockpit_sales_dials_monthly").select("*");
      if (email) q = q.eq("agent_email", email.toLowerCase());
      if (month) q = q.eq("month", month);
      return q.limit(1000);
    },
    [email, month],
    300_000,
  );
}

// ---------------------------------------------------------------------------
// Recorded calls and Vince's reviews
// ---------------------------------------------------------------------------

/** The list columns: no summary or invitees, which only one call's page needs. */
const RECORDING_LIST =
  "recording_id,title,recorded_by,started_at,duration_s,share_url,contact_id,matched_by,source,language,transcript_path,transcript_chars,indexed_at,appointment_id";

export interface RecordingFilter {
  q: string;
  /** A rep's Fathom address, or "" for everyone. */
  by: string;
  page: number;
}

export function useRecordings(f: RecordingFilter): Loaded<Recording[]> {
  return useQuery<Recording[]>(() => {
    let q = supabase
      .from("cockpit_sales_recordings")
      .select(RECORDING_LIST)
      .order("started_at", { ascending: false, nullsFirst: false })
      .order("recording_id", { ascending: true })
      .range(f.page * PAGE, f.page * PAGE + PAGE - 1);
    if (f.by) q = q.eq("recorded_by", f.by);
    const text = f.q
      .trim()
      .replace(/[,()*]/g, " ")
      .trim();
    if (text) q = q.ilike("title", `%${text}%`);
    return q as unknown as Result<Recording[]>;
  }, [f.q, f.by, f.page]);
}

export function useRecording(id: string): Loaded<Recording> {
  return useQuery<Recording>(
    () =>
      id
        ? supabase
            .from("cockpit_sales_recordings")
            .select("*")
            .eq("recording_id", id)
            .maybeSingle()
        : none<Recording>(),
    [id],
  );
}

/** Reviews of these calls, or of this lead's calls, or by this rep; newest first. */
export function useReviews(by: {
  recordingIds?: string[];
  contactId?: string;
  repKey?: string;
  all?: boolean;
  limit?: number;
}): Loaded<Review[]> {
  const ids = (by.recordingIds ?? []).slice(0, 100);
  const key = `${ids.join(",")}|${by.contactId ?? ""}|${by.repKey ?? ""}|${by.all ? 1 : 0}|${by.limit ?? 50}`;
  return useQuery<Review[]>(() => {
    if (!ids.length && !by.contactId && !by.repKey && !by.all)
      return none<Review[]>();
    let q = supabase
      .from("cockpit_sales_reviews")
      .select("*")
      .order("call_at", { ascending: false, nullsFirst: false })
      .limit(by.limit ?? 50);
    if (ids.length) q = q.in("recording_id", ids);
    if (by.contactId) q = q.eq("contact_id", by.contactId);
    if (by.repKey) q = q.eq("rep_key", by.repKey);
    return q;
  }, [key]);
}

/** Open and recent asks for AI reviews of these calls. */
export function useReviewAsks(
  recordingIds: string[],
  everyMs = 0,
): Loaded<ReviewAsk[]> {
  const ids = recordingIds.slice(0, 100);
  return useQuery<ReviewAsk[]>(
    () =>
      ids.length
        ? supabase
            .from("cockpit_sales_review_asks")
            .select("*")
            .in("recording_id", ids)
            .order("requested_at", { ascending: false })
            .limit(200)
        : none<ReviewAsk[]>(),
    [ids.join(",")],
    everyMs,
  );
}

/** Aziz's reviews: of one call, or all of them, newest first. */
export function useCoachReviews(by: {
  recordingId?: string;
  all?: boolean;
}): Loaded<CoachReview[]> {
  return useQuery<CoachReview[]>(() => {
    if (!by.recordingId && !by.all) return none<CoachReview[]>();
    let q = supabase
      .from("cockpit_sales_coach_reviews")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (by.recordingId) q = q.eq("recording_id", by.recordingId);
    return q;
  }, [by.recordingId ?? "", by.all ? 1 : 0]);
}

/**
 * Speed to lead's inputs: the ROAS-tagged leads created in the window and
 * every outbound call a sales rep made from the window's start to a week
 * after its end (a lead's first call can come after the window closes).
 */
export function useSpeedToLead(
  fromIso: string,
  toIso: string,
): Loaded<{ leads: LeadRow[]; calls: CallRow[] }> {
  return useQuery<{ leads: LeadRow[]; calls: CallRow[] }>(async () => {
    const until = new Date(
      Math.min(Date.parse(toIso) + 7 * 86_400_000, Date.now() + 60_000),
    ).toISOString();
    const [leads, calls] = await Promise.all([
      readAll<LeadRow>((from, to) =>
        supabase
          .from("cockpit_sales_leads")
          .select("contact_id,phone8,lead_created_at")
          .gte("lead_created_at", fromIso)
          .lt("lead_created_at", toIso)
          .in("lead_class", ["qualified", "unqualified"])
          .order("contact_id")
          .range(from, to),
      ),
      readAll<CallRow>((from, to) =>
        supabase
          .from("cockpit_sales_dials")
          .select(
            "occurred_at,agent_email,direction,state,duration_s,ringing_s,lead_phone8,sales_rep_id",
          )
          .eq("direction", "outbound")
          .not("sales_rep_id", "is", null)
          .gte("occurred_at", fromIso)
          .lt("occurred_at", until)
          .order("call_id")
          .range(from, to),
      ),
    ]);
    if (leads.error || calls.error)
      return { data: null, error: leads.error ?? calls.error };
    return {
      data: { leads: leads.data ?? [], calls: calls.data ?? [] },
      error: null,
    };
  }, [fromIso, toIso]);
}

/** A call's transcript from the private bucket. */
export async function loadTranscript(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("sales-calls")
    .download(path);
  if (error || !data)
    throw new Error(error?.message ?? "the transcript file came back empty");
  return await data.text();
}

/**
 * Follow-up drafts waiting for this person, for the sidebar's count. A
 * manager also answers for drafts on leads whose rep has no seat yet.
 */
export function useFollowupsWaiting(
  email: string | null,
  manager = false,
): Loaded<{ id: string }[]> {
  return useQuery<{ id: string }[]>(
    () => {
      if (!email) return none<{ id: string }[]>();
      const q = supabase
        .from("cockpit_sales_followups")
        .select("id")
        .eq("status", "draft")
        .gt("expires_at", new Date().toISOString())
        .limit(100);
      return manager
        ? q.or(`owner_email.eq.${email},owner_email.is.null`)
        : q.eq("owner_email", email);
    },
    [email, manager],
    120_000,
  );
}

/** Rates only, everyone with a seat. */
export function useBoard(windowKey: WindowKey): Loaded<BoardRow[]> {
  return useQuery<BoardRow[]>(
    () =>
      supabase
        .from("cockpit_sales_board")
        .select("*")
        .eq("window_key", windowKey),
    [windowKey],
    120_000,
  );
}

/** Maqsam calls in a window, for dials and talk time. */
export function useDials(
  fromIso: string,
  toIso: string,
  agentEmail: string | null,
): Loaded<Dial[]> {
  return useQuery<Dial[]>(
    () =>
      readAll<Dial>((from, to) => {
        let q = supabase
          .from("cockpit_sales_dials")
          .select("*")
          .gte("occurred_at", fromIso)
          .lt("occurred_at", toIso)
          .order("occurred_at", { ascending: false })
          .order("call_id", { ascending: true })
          .range(from, to);
        if (agentEmail) q = q.eq("agent_email", agentEmail);
        return q;
      }, 5000),
    [fromIso, toIso, agentEmail],
  );
}

// ---------------------------------------------------------------------------
// Team, links, settings, health
// ---------------------------------------------------------------------------

export function useTeam(): Loaded<TeamMember[]> {
  return useQuery<TeamMember[]>(
    () => supabase.from("cockpit_sales_team").select("*").order("name"),
    [],
  );
}

/** Full seats with pay and goals: your own, or everyone's for a manager. */
export function usePeople(): Loaded<Person[]> {
  return useQuery<Person[]>(
    () => supabase.from("cockpit_sales_people").select("*").order("name"),
    [],
  );
}

export function useReps(): Loaded<Rep[]> {
  return useQuery<Rep[]>(
    () => supabase.from("cockpit_sales_reps").select("*").order("display_name"),
    [],
  );
}

export function useLinks(): Loaded<SalesLink[]> {
  return useQuery<SalesLink[]>(
    () =>
      supabase
        .from("cockpit_sales_links")
        .select("*")
        .order("sort", { ascending: true })
        .order("label", { ascending: true }),
    [],
  );
}

export function useSetting<T>(key: string): Loaded<T> {
  return useQuery<T>(async () => {
    const { data, error } = await supabase
      .from("cockpit_sales_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return { data: (data?.value as T) ?? null, error };
  }, [key]);
}

export function useMirrorRun(everyMs = 60_000): Loaded<MirrorRun> {
  return useQuery<MirrorRun>(
    () =>
      supabase
        .from("cockpit_sales_mirror_runs")
        .select("*")
        .not("finished_at", "is", null)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
    [],
    everyMs,
  );
}

export function useWorkerStatus(): Loaded<WorkerStatus[]> {
  return useQuery<WorkerStatus[]>(
    () => supabase.from("cockpit_sales_worker_status").select("*"),
    [],
    120_000,
  );
}

export function useProposals(mine: string | null): Loaded<Proposal[]> {
  return useQuery<Proposal[]>(
    () => {
      let q = supabase
        .from("cockpit_sales_proposals")
        .select("*")
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(200);
      if (mine) q = q.eq("created_by", mine);
      return q;
    },
    [mine],
    30_000,
  );
}

export function useProposal(id: string): Loaded<Proposal> {
  return useQuery<Proposal>(
    () =>
      supabase
        .from("cockpit_sales_proposals")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
    [id],
    20_000,
  );
}

/** The proposal's HTML from the private bucket, read with the rep's session. */
export function useProposalHtml(path: string | null): Loaded<string> {
  return useQuery<string>(async () => {
    if (!path) return { data: null, error: null };
    const { data, error } = await supabase.storage
      .from("sales-proposals")
      .download(path);
    if (error) return { data: null, error: { message: error.message } };
    return { data: await data.text(), error: null };
  }, [path]);
}

/** Keep the latest value of something in a ref, for timers that outlive renders. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Leads whose last message was theirs, in the last `hours`, newest first. */
export function useReplies(hours = 48, everyMs = 60_000): Loaded<InboxRow[]> {
  return useQuery<InboxRow[]>(
    () =>
      supabase
        .from("cockpit_sales_inbox")
        .select("*")
        .eq("last_direction", "inbound")
        .gte(
          "last_message_at",
          new Date(Date.now() - hours * 3_600_000).toISOString(),
        )
        .order("last_message_at", { ascending: false })
        .limit(50),
    [hours],
    everyMs,
  );
}

// ---------------------------------------------------------------------------
// WhatsApp: the ready-made messages and the template routes (lib/whatsapp.ts)
// ---------------------------------------------------------------------------

export function useSnippets() {
  return useQuery<Snippet[]>(
    () =>
      supabase
        .from("cockpit_sales_snippets")
        .select("id,moment,language,body,sort")
        .is("deleted_at", null)
        .order("moment")
        .order("sort"),
    [],
  );
}

export function useTemplates() {
  return useQuery<TemplateRoute[]>(
    () => supabase.from("cockpit_sales_wa_templates").select("*").order("sort"),
    [],
  );
}
