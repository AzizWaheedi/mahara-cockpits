import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";

// biome-ignore lint/suspicious/noExplicitAny: generic client success rows
type Any = any;

export function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export interface UseCsmSnapshotResult {
  snap: Any | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  toggleCheck: (args: { id: string | number; done: boolean; expectedCurrent?: boolean }) => Promise<void>;
  act: (args: {
    clientName: string;
    action: string;
    details?: string;
    kind?: string;
    amount?: number;
  }) => Promise<void>;
  submitEod: (args: { energy?: string; answers?: Any; computed?: Any }) => Promise<void>;
  addPlanItems: (args: {
    items: Array<{
      text: string;
      reason?: string;
      clientName?: string;
      listName?: string;
      dueDate?: string;
    }>;
  }) => Promise<void>;
  updateProfile: (args: {
    clientName: string;
    stage?: string;
    health?: string;
    service?: string;
    overview?: Any;
    kpi?: Any;
    notes?: Any;
  }) => Promise<void>;
  reportIssue: (args: { title: string; description: string; category?: string }) => Promise<void>;
}

export function useCsmSnapshot(
  client: SupabaseClient | null,
  allowedClients?: string[] | null,
): UseCsmSnapshotResult {
  const [snap, setSnap] = useState<Any | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSnapshot = useCallback(async () => {
    if (!client) {
      setLoading(false);
      return;
    }
    const day = kuwaitToday();
    const month = day.slice(0, 7);
    try {
      setLoading(true);

      // 1. Fetch client profiles
      const { data: profileRows, error: pErr } = await client
        .from("cockpit_client_profiles")
        .select("*")
        .order("client_name", { ascending: true });
      if (pErr) throw pErr;

      // 2. Fetch daily checks
      const { data: checkRows, error: chErr } = await client
        .from("cockpit_daily_checks")
        .select("*")
        .eq("role", "csm")
        .eq("day", day)
        .eq("source_deleted", false)
        .order("display_order", { ascending: true });
      if (chErr) throw chErr;

      // 3. Fetch decisions
      const { data: decisionRows, error: dErr } = await client
        .from("cockpit_decisions")
        .select("*")
        .eq("role", "csm")
        .eq("day", day);
      if (dErr) throw dErr;

      // 4. Fetch plan items
      const { data: planRows, error: plErr } = await client
        .from("cockpit_plan_items")
        .select("*")
        .eq("role", "csm")
        .eq("day", day);
      if (plErr) throw plErr;

      // 5. Fetch EOD report
      const { data: eodRow } = await client
        .from("cockpit_eod_reports")
        .select("*")
        .eq("role", "csm")
        .eq("day", day)
        .maybeSingle();

      const scopeSet =
        allowedClients && allowedClients.length > 0
          ? new Set(allowedClients.map(c => c.toLowerCase()))
          : null;

      // Normalize client profiles
      const clients = (profileRows ?? [])
        .map(p => {
          const raw = (p.overview as Any) ?? {};
          const name = p.client_name || raw.name || "";
          return {
            ...raw,
            _id: p.source_id || String(p.id),
            id: p.id,
            name,
            stage: p.stage || raw.stage || "Active",
            level: p.health || raw.level || "neutral",
            service: p.service || raw.service,
            kpi: p.kpi ?? raw.kpi ?? {},
            notes: p.notes ?? raw.notes ?? [],
            loose: Array.isArray(raw.loose) ? raw.loose : [],
            hot: Array.isArray(raw.hot) ? raw.hot : [],
            hotBlocked: false,
            rank: Number(raw.rank ?? 50),
            bucket: raw.bucket || "management",
            paying: Boolean(raw.paying ?? true),
            paymentDue: raw.paymentDue != null ? Number(raw.paymentDue) : null,
            newSignup: Boolean(raw.newSignup),
            pauseRequired: Boolean(raw.pauseRequired),
          };
        })
        .filter(c => !scopeSet || scopeSet.has(c.name.toLowerCase()));

      // Normalize checks
      const checks = (checkRows ?? []).map(ch => ({
        _id: String(ch.id),
        id: ch.id,
        key: ch.check_key,
        label: ch.label,
        detail: ch.detail,
        phase: ch.phase,
        block: ch.block,
        displayOrder: ch.display_order,
        href: ch.href,
        done: Boolean(ch.done),
        doneAt: ch.done_at,
      }));

      // Normalize decisions
      const decisions = (decisionRows ?? []).map(d => ({
        _id: String(d.id),
        id: d.id,
        subject: d.subject,
        action: d.action,
        evidence: d.evidence,
        kind: d.kind,
        reroutedTo: d.rerouted_to,
        amount: d.amount ? Number(d.amount) : undefined,
        day: d.day,
      }));

      // Normalize plan items
      const plan = (planRows ?? []).map(pl => ({
        _id: String(pl.id),
        id: pl.id,
        text: pl.text,
        reason: pl.reason,
        clientName: pl.client_name,
        listName: pl.list_name,
        dueDate: pl.due_date,
      }));

      const builtSnap: Any = {
        day,
        month,
        appointments: [],
        todaysCalls: [],
        prefs: [],
        hotRows: [],
        kpis: [],
        churn: null,
        money: null,
        clients,
        tasks: [],
        checks,
        decisions,
        plan,
        eod: eodRow ?? null,
        lastSyncAt: Date.now(),
        syncHealth: { ok: true, at: Date.now(), profiles: clients.length, errors: [] },
        totals: {
          clients: clients.length,
          dueToday: clients.filter(c => c.rank < 40 && c.level !== "green").length,
          newSignups: clients.filter(c => c.newSignup).length,
          pauses: clients.filter(c => c.pauseRequired).length,
          onboarding: clients.filter(c => c.bucket === "onboarding").length,
          managed: clients.filter(c => c.bucket === "management").length,
          pastDue: clients.filter(c => (c.paymentDue ?? -99) >= 1).length,
          hot: clients.filter(c => (c.hot ?? []).length > 0).length,
          loose: clients.reduce((s, c) => s + (c.loose ?? []).length, 0),
          healthy: clients.filter(c => c.level === "green").length,
        },
      };

      setSnap(builtSnap);
      setError(null);
    } catch (err: unknown) {
      console.error("Failed to load CSM snapshot from Supabase:", err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, allowedClients]);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  const toggleCheck = useCallback(
    async (args: { id: string | number; done: boolean; expectedCurrent?: boolean }) => {
      if (!client) return;
      const numId = Number(args.id);
      const { error: rpcErr } = await client.rpc("cockpit_set_daily_check", {
        p_id: numId,
        p_expected_done: args.expectedCurrent ?? !args.done,
        p_done: args.done,
      });
      if (rpcErr) throw rpcErr;
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const act = useCallback(
    async (args: {
      clientName: string;
      action: string;
      details?: string;
      kind?: string;
      amount?: number;
    }) => {
      if (!client) return;
      const day = kuwaitToday();
      const { error: rpcErr } = await client.rpc("cockpit_log_decision", {
        p_role: "csm",
        p_day: day,
        p_subject: args.clientName,
        p_action: args.action,
        p_evidence: args.details ?? null,
        p_kind: args.kind ?? null,
        p_rerouted_to: null,
        p_amount: args.amount ?? null,
        p_metadata: {},
      });
      if (rpcErr) throw rpcErr;
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const submitEod = useCallback(
    async (args: { energy?: string; answers?: Any; computed?: Any }) => {
      if (!client) return;
      const day = kuwaitToday();
      const { error: rpcErr } = await client.rpc("cockpit_save_eod", {
        p_role: "csm",
        p_day: day,
        p_energy: args.energy ?? null,
        p_answers: args.answers ?? {},
        p_computed: args.computed ?? {},
      });
      if (rpcErr) throw rpcErr;
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const addPlanItems = useCallback(
    async (args: {
      items: Array<{
        text: string;
        reason?: string;
        clientName?: string;
        listName?: string;
        dueDate?: string;
      }>;
    }) => {
      if (!client) return;
      const day = kuwaitToday();
      for (const item of args.items) {
        const { error: rpcErr } = await client.rpc("cockpit_add_plan_item", {
          p_role: "csm",
          p_day: day,
          p_text: item.text,
          p_reason: item.reason ?? null,
          p_client_name: item.clientName ?? null,
          p_list_name: item.listName ?? null,
          p_due_date: item.dueDate ?? null,
        });
        if (rpcErr) throw rpcErr;
      }
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const updateProfile = useCallback(
    async (args: {
      clientName: string;
      stage?: string;
      health?: string;
      service?: string;
      overview?: Any;
      kpi?: Any;
      notes?: Any;
    }) => {
      if (!client) return;
      const { error: rpcErr } = await client.rpc("cockpit_update_client_profile", {
        p_client_name: args.clientName,
        p_stage: args.stage ?? null,
        p_health: args.health ?? null,
        p_service: args.service ?? null,
        p_kpi: args.kpi ?? null,
        p_notes: args.notes ?? null,
        p_overview: args.overview ?? null,
      });
      if (rpcErr) throw rpcErr;
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const reportIssue = useCallback(
    async (args: { title: string; description: string; category?: string }) => {
      if (!client) return;
      const { error: rpcErr } = await client.rpc("cockpit_submit_issue_report", {
        p_role: "csm",
        p_title: args.title,
        p_description: args.description,
        p_category: args.category ?? "feedback",
        p_metadata: {},
      });
      if (rpcErr) throw rpcErr;
    },
    [client],
  );

  return {
    snap,
    loading,
    error,
    refetch: fetchSnapshot,
    toggleCheck,
    act,
    submitEod,
    addPlanItems,
    updateProfile,
    reportIssue,
  };
}
