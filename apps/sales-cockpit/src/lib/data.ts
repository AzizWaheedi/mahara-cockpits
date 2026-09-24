import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type {
  BoardRow,
  CalendarRow,
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
  SalesLink,
  ScoreRow,
  TeamMember,
  WindowKey,
  WorkerStatus,
  WorkRequest,
} from "./types";

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
    () => {
      let q = supabase
        .from("cockpit_sales_calendar")
        .select("*")
        .gte("start_at", fromIso)
        .lt("start_at", toIso)
        .order("start_at", { ascending: true })
        .limit(1000);
      if (ghlUserId) q = q.eq("assigned_user_id", ghlUserId);
      return q;
    },
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

/** The pipeline's stages, from the leads that sit in them. */
export function useStages(): Loaded<
  { stage_id: string; stage_name: string }[]
> {
  return useQuery(
    () =>
      supabase
        .from("cockpit_sales_leads")
        .select("stage_id,stage_name")
        .not("stage_id", "is", null)
        .gte(
          "lead_created_at",
          new Date(Date.now() - 365 * 86_400_000).toISOString(),
        )
        .limit(5000),
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
  return useQuery<Dial[]>(() => {
    let q = supabase
      .from("cockpit_sales_dials")
      .select("*")
      .gte("occurred_at", fromIso)
      .lt("occurred_at", toIso)
      .order("occurred_at", { ascending: false })
      .limit(5000);
    if (agentEmail) q = q.eq("agent_email", agentEmail);
    return q;
  }, [fromIso, toIso, agentEmail]);
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
