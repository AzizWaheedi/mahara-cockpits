import {readPersonalEod,savePersonalEod} from "./personalEod";
import {useRef} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import {
  type CsmMoneyPatch,
  csmPreferences,
  dismissCsmLooseEnds,
  readCsmState,
  saveCsmHotRow,
  saveCsmLanguage,
  saveCsmMoneyGoals,
  visibleLooseEnds,
} from "./csmStateClient";

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
  toggleCheck: (args: {
    id: string | number;
    done: boolean;
    expectedCurrent?: boolean;
    [key: string]: any;
  }) => Promise<void>;
  act: (args: {
    clientName?: string;
    subject?: string;
    clientId?: string;
    taskId?: string;
    action: string;
    details?: string;
    evidence?: string;
    kind?: string;
    reason?: string;
    metricAtDecision?: number;
    reroutedTo?: string;
    department?: string;
    amount?: number;
    metadata?: Record<string, any>;
    [key: string]: any;
  }) => Promise<void>;
  submitEod: (args: {
    energy?: string;
    answers?: Any;
    computed?: Any;
  }) => Promise<void>;
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
  reportIssue: (args: {
    title: string;
    description: string;
    category?: string;
  }) => Promise<void>;
  setClientLanguage: (args: {
    clientName: string;
    language: string;
  }) => Promise<void>;
  saveHotRow: (args: Any) => Promise<void>;
  clearLooseEnds: (args: { clientName?: string }) => Promise<Any>;
  saveMoneyGoals: (args: {
    month: string;
    target?: number | null;
    clients?: number | null;
    counts?: Any;
  }) => Promise<void>;
}

export async function fetchDailyChecksRpc(
  client: SupabaseClient | null,
  role: "media_buyer" | "csm",
  day: string,
) {
  if (!client) {
    throw new Error("Supabase client is required");
  }
  const { data, error } = await client.rpc("cockpit_get_daily_checks", {
    p_role: role,
    p_day: day,
  });
  if (error) {
    throw error;
  }
  return data;
}

export function normalizeChecks(checkRows: Any[] | null | undefined) {
  return (checkRows ?? []).map(ch => ({
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
}

export function normalizeDecisions(decisionRows: Any[] | null | undefined) {
  return (decisionRows ?? []).map(d => {
    const hasMeta =
      d.metadata !== undefined &&
      d.metadata !== null &&
      typeof d.metadata === "object";
    const meta = hasMeta ? (d.metadata as Record<string, any>) : null;

    // Reason: prefer persisted column d.reason, then meta.reason
    const reason =
      d.reason !== undefined && d.reason !== null && d.reason !== ""
        ? d.reason
        : meta?.reason !== undefined &&
            meta?.reason !== null &&
            meta?.reason !== ""
          ? meta.reason
          : undefined;

    // ReroutedTo: prefer meta.reroutedTo / meta.rerouted_to, then legacy provenance d.rerouted_to / d.reroutedTo
    // Never invent a rerouting destination from unrelated department
    const metaRerouted =
      meta?.reroutedTo !== undefined &&
      meta?.reroutedTo !== null &&
      String(meta.reroutedTo).trim() !== ""
        ? String(meta.reroutedTo).trim()
        : meta?.rerouted_to !== undefined &&
            meta?.rerouted_to !== null &&
            String(meta.rerouted_to).trim() !== ""
          ? String(meta.rerouted_to).trim()
          : undefined;

    const legacyRerouted =
      d.rerouted_to !== undefined &&
      d.rerouted_to !== null &&
      String(d.rerouted_to).trim() !== ""
        ? String(d.rerouted_to).trim()
        : d.reroutedTo !== undefined &&
            d.reroutedTo !== null &&
            String(d.reroutedTo).trim() !== ""
          ? String(d.reroutedTo).trim()
          : undefined;

    const reroutedTo = metaRerouted ?? legacyRerouted;

    // Amount: preserve zero!
    // Genuine absent/null metadata cannot overwrite legacy provenance
    const metaAmount =
      meta?.amount !== undefined &&
      meta?.amount !== null &&
      meta?.amount !== "" &&
      !Number.isNaN(Number(meta.amount))
        ? Number(meta.amount)
        : undefined;

    const legacyAmount =
      d.amount !== undefined &&
      d.amount !== null &&
      d.amount !== "" &&
      !Number.isNaN(Number(d.amount))
        ? Number(d.amount)
        : undefined;

    const amount = metaAmount !== undefined ? metaAmount : legacyAmount;

    // Metric at decision: preserve numeric including 0
    const rawMetric =
      d.metric_at_decision !== undefined &&
      d.metric_at_decision !== null &&
      !Number.isNaN(Number(d.metric_at_decision))
        ? Number(d.metric_at_decision)
        : d.metricAtDecision !== undefined &&
            d.metricAtDecision !== null &&
            !Number.isNaN(Number(d.metricAtDecision))
          ? Number(d.metricAtDecision)
          : meta?.metricAtDecision !== undefined &&
              meta?.metricAtDecision !== null &&
              !Number.isNaN(Number(meta.metricAtDecision))
            ? Number(meta.metricAtDecision)
            : undefined;

    return {
      _id: String(d.id),
      id: d.id,
      subject: d.subject,
      action: d.action,
      evidence: d.evidence,
      kind: d.kind,
      reason,
      reroutedTo,
      amount,
      metricAtDecision: rawMetric,
      day: d.day,
    };
  });
}

export async function executeToggleCheck(
  client: SupabaseClient | null,
  args: {
    id: string | number;
    done: boolean;
    expectedCurrent?: boolean;
    [key: string]: any;
  },
) {
  if (!client) {
    throw new Error("Supabase client is required");
  }
  if (!args || args.id === undefined || args.id === null) {
    throw new Error("Missing checklist item id");
  }
  const numId = typeof args.id === "number" ? args.id : Number(args.id);
  if (!Number.isInteger(numId) || numId <= 0) {
    throw new Error("Invalid checklist item id");
  }
  if (typeof args.done !== "boolean") {
    throw new Error("Missing or invalid 'done' boolean");
  }
  if (
    args.expectedCurrent !== undefined &&
    typeof args.expectedCurrent !== "boolean"
  ) {
    throw new Error("Invalid 'expectedCurrent' boolean");
  }

  const expectedDone =
    typeof args.expectedCurrent === "boolean"
      ? args.expectedCurrent
      : !args.done;

  const { error: rpcErr } = await client.rpc("cockpit_set_daily_check", {
    p_id: numId,
    p_expected_done: expectedDone,
    p_done: args.done,
  });
  if (rpcErr) {
    throw rpcErr;
  }
}

export async function executeAct(
  client: SupabaseClient | null,
  args: {
    clientName?: string;
    subject?: string;
    clientId?: string;
    taskId?: string;
    action: string;
    details?: string;
    evidence?: string;
    kind?: string;
    reason?: string;
    metricAtDecision?: number;
    reroutedTo?: string;
    department?: string;
    amount?: number;
    metadata?: Record<string, any>;
    [key: string]: any;
  },
) {
  if (!client) {
    throw new Error("Supabase client is required");
  }
  const subject = (
    args.clientName ??
    args.subject ??
    args.clientId ??
    args.taskId ??
    ""
  ).trim();
  if (!args || !subject || !args.action?.trim()) {
    throw new Error("Subject and action cannot be empty");
  }
  const day = kuwaitToday();
  const reroutedTo =
    args.reroutedTo !== undefined && args.reroutedTo !== null
      ? args.reroutedTo
      : (args.kind === "ticket" || args.kind === "rerouted") && args.department
        ? args.department
        : undefined;

  const metadata: Record<string, any> = {
    ...(args.metadata ?? {}),
  };
  if (reroutedTo !== undefined && reroutedTo !== null) {
    metadata.reroutedTo = reroutedTo;
  }
  if (args.amount !== undefined && args.amount !== null) {
    metadata.amount = Number(args.amount);
  }
  for (const [key, val] of Object.entries(args)) {
    if (
      ![
        "clientName",
        "subject",
        "clientId",
        "taskId",
        "action",
        "details",
        "evidence",
        "kind",
        "reason",
        "metricAtDecision",
        "reroutedTo",
        "department",
        "amount",
        "metadata",
      ].includes(key) &&
      val !== undefined
    ) {
      metadata[key] = val;
    }
  }

  const { data, error: rpcErr } = await client.rpc("cockpit_log_decision", {
    p_role: "csm",
    p_day: day,
    p_subject: subject,
    p_action: args.action.trim(),
    p_kind: args.kind ?? "decision",
    p_evidence: args.details ?? args.evidence ?? null,
    p_reason: args.reason ?? null,
    p_metric_at_decision:
      args.metricAtDecision !== undefined &&
      args.metricAtDecision !== null &&
      !Number.isNaN(Number(args.metricAtDecision))
        ? Number(args.metricAtDecision)
        : null,
    p_metadata: metadata,
  });
  if (rpcErr) {
    throw rpcErr;
  }
  return data;
}

export function useCsmSnapshot(
  client: SupabaseClient | null,
  allowedClients?: string[] | null,
): UseCsmSnapshotResult {
  const [snap, setSnap] = useState<Any | undefined>(undefined);
  // Keep the chosen report day stable while someone is writing across midnight.
  const reportDay = useRef<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSnapshot = useCallback(async () => {
    if (!client) {
      setLoading(false);
      setError(new Error("Client-success sign-in is required"));
      return;
    }
    try {
      setLoading(true);

      const staffState = await readCsmState(client);
      const day = staffState.day;
      const month = staffState.month;
      const profileRows = staffState.profiles;

      const [checkRows, decisionsResult, planResult, eodResult] =
        await Promise.all([
          fetchDailyChecksRpc(client, "csm", day),
          client
            .from("cockpit_decisions")
            .select("*")
            .eq("role", "csm")
            .eq("day", day),
          client
            .from("cockpit_plan_items")
            .select("*")
            .eq("role", "csm")
            .eq("day", day),
          readPersonalEod(client,"csm",reportDay.current),
        ]);
      if (decisionsResult.error) throw decisionsResult.error;
      if (planResult.error) throw planResult.error;
      const decisionRows = decisionsResult.data;
      const planRows = planResult.data;
      const eodContext = eodResult;
      const eodRow = eodContext.report;
      reportDay.current = eodContext.day;

      // Normalize client profiles
      const clients = (profileRows ?? []).map(p => {
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
          loose: visibleLooseEnds(staffState, name, raw.loose),
          hot: Array.isArray(raw.hot) ? raw.hot : [],
          hotBlocked: false,
          rank: Number(raw.rank ?? 50),
          bucket: raw.bucket || "management",
          paying: Boolean(raw.paying ?? true),
          paymentDue: raw.paymentDue != null ? Number(raw.paymentDue) : null,
          newSignup: Boolean(raw.newSignup),
          pauseRequired: Boolean(raw.pauseRequired),
        };
      });

      // Normalize checks
      const checks = normalizeChecks(checkRows);

      // Normalize decisions
      const decisions = normalizeDecisions(decisionRows);

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
        prefs: csmPreferences(staffState),
        hotRows: staffState.hotRows,
        kpis: [],
        churn: null,
        money: staffState.money,
        clients,
        tasks: [],
        checks,
        decisions,
        plan,
        eod: eodRow ?? null,
        eodOwner: eodContext.owner,
        eodDay: eodContext.day,
        lastSyncAt: null,
        syncHealth: {
          ok: null,
          at: null,
          profiles: clients.length,
          errors: ["Client refresh status is not yet connected."],
        },
        totals: {
          clients: clients.length,
          dueToday: clients.filter(c => c.rank < 40 && c.level !== "green")
            .length,
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
    async (args: {
      id: string | number;
      done: boolean;
      expectedCurrent?: boolean;
      [key: string]: any;
    }) => {
      await executeToggleCheck(client, args);
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const act = useCallback(
    async (args: {
      clientName?: string;
      subject?: string;
      clientId?: string;
      taskId?: string;
      action: string;
      details?: string;
      evidence?: string;
      kind?: string;
      reason?: string;
      metricAtDecision?: number;
      reroutedTo?: string;
      department?: string;
      amount?: number;
      metadata?: Record<string, any>;
      [key: string]: any;
    }) => {
      await executeAct(client, args);
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const submitEod = useCallback(
    async (args: { energy?: string; stress?: string; submit?: boolean; body?: string; answers?: Any; computed?: Any }) => {
      if (!client) {
        throw new Error("Supabase client is required");
      }
      await savePersonalEod(client,"csm",{owner:snap?.eodOwner??"",day:snap?.eodDay??""},{...args,submit:true});
      await fetchSnapshot();
    },
    [client, fetchSnapshot, snap?.eodOwner, snap?.eodDay],
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
      if (!client) {
        throw new Error("Supabase client is required");
      }
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
      if (!client) {
        throw new Error("Supabase client is required");
      }
      const { error: rpcErr } = await client.rpc(
        "cockpit_update_client_profile",
        {
          p_client_name: args.clientName,
          p_stage: args.stage ?? null,
          p_health: args.health ?? null,
          p_service: args.service ?? null,
          p_kpi: args.kpi ?? null,
          p_notes: args.notes ?? null,
          p_overview: args.overview ?? null,
        },
      );
      if (rpcErr) throw rpcErr;
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const reportIssue = useCallback(
    async (args: { title: string; description: string; category?: string }) => {
      if (!client) {
        throw new Error("Supabase client is required");
      }
      const { error: rpcErr } = await client.rpc(
        "cockpit_submit_issue_report",
        {
          p_role: "csm",
          p_title: args.title,
          p_description: args.description,
          p_category: args.category ?? "feedback",
          p_metadata: {},
        },
      );
      if (rpcErr) throw rpcErr;
    },
    [client],
  );

  const setClientLanguage = useCallback(
    async (args: { clientName: string; language: string }) => {
      await saveCsmLanguage(client, args);
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const saveHotRow = useCallback(
    async (args: Any) => {
      await saveCsmHotRow(client, args);
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const clearLooseEnds = useCallback(
    async (args: { clientName?: string }) => {
      const result = await dismissCsmLooseEnds(client, args);
      await fetchSnapshot();
      return result;
    },
    [client, fetchSnapshot],
  );

  const saveMoneyGoals = useCallback(
    async (args: CsmMoneyPatch) => {
      await saveCsmMoneyGoals(client, args);
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
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
    setClientLanguage,
    saveHotRow,
    clearLooseEnds,
    saveMoneyGoals,
  };
}
