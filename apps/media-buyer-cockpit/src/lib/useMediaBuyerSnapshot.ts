import {readPersonalEod,savePersonalEod} from "./personalEod";
import {useRef} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";

// biome-ignore lint/suspicious/noExplicitAny: generic cockpit rows
type Any = any;

export function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export interface UseMediaBuyerSnapshotResult {
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
  decide: (args: {
    subject: string;
    action: string;
    evidence?: string;
    kind?: string;
    reason?: string;
    metricAtDecision?: number;
    reroutedTo?: string;
    amount?: number;
    metadata?: Record<string, any>;
    [key: string]: any;
  }) => Promise<void>;
  removeDecision: (args: { id: string | number }) => Promise<void>;
  saveEod: (args: {
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
  sendFeedback: (args: {
    title: string;
    description: string;
    category?: string;
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

export async function executeDecide(
  client: SupabaseClient | null,
  args: {
    subject: string;
    action: string;
    evidence?: string;
    kind?: string;
    reason?: string;
    metricAtDecision?: number;
    reroutedTo?: string;
    amount?: number;
    metadata?: Record<string, any>;
    [key: string]: any;
  },
) {
  if (!client) {
    throw new Error("Supabase client is required");
  }
  if (!args || !args.subject?.trim() || !args.action?.trim()) {
    throw new Error("Subject and action cannot be empty");
  }
  const day = kuwaitToday();
  const metadata: Record<string, any> = {
    ...(args.metadata ?? {}),
  };
  if (args.reroutedTo !== undefined && args.reroutedTo !== null) {
    metadata.reroutedTo = args.reroutedTo;
  }
  if (args.amount !== undefined && args.amount !== null) {
    metadata.amount = Number(args.amount);
  }
  for (const [key, val] of Object.entries(args)) {
    if (
      ![
        "subject",
        "action",
        "evidence",
        "kind",
        "reason",
        "metricAtDecision",
        "reroutedTo",
        "amount",
        "metadata",
      ].includes(key) &&
      val !== undefined
    ) {
      metadata[key] = val;
    }
  }

  const { data, error: rpcErr } = await client.rpc("cockpit_log_decision", {
    p_role: "media_buyer",
    p_day: day,
    p_subject: args.subject.trim(),
    p_action: args.action.trim(),
    p_kind: args.kind ?? "decision",
    p_evidence: args.evidence ?? null,
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

export function useMediaBuyerSnapshot(
  client: SupabaseClient | null,
  allowedClients?: string[] | null,
): UseMediaBuyerSnapshotResult {
  const [snap, setSnap] = useState<Any | undefined>(undefined);
  // Keep the chosen report day stable while someone is writing across midnight.
  const reportDay = useRef<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSnapshot = useCallback(async () => {
    if (!client) {
      setLoading(false);
      return;
    }
    const day = kuwaitToday();
    try {
      setLoading(true);

      // 1. Fetch campaigns
      const { data: campaignRows, error: cErr } = await client
        .from("cockpit_campaigns")
        .select("*")
        .order("rank", { ascending: true });
      if (cErr) throw cErr;

      // 2. Fetch ads
      const { data: adRows, error: aErr } = await client
        .from("cockpit_ads")
        .select("*");
      if (aErr) throw aErr;

      // 3. Fetch daily checks
      const checkRows = await fetchDailyChecksRpc(client, "media_buyer", day);

      // 4. Fetch decisions
      const { data: decisionRows, error: dErr } = await client
        .from("cockpit_decisions")
        .select("*")
        .eq("role", "media_buyer")
        .eq("day", day);
      if (dErr) throw dErr;

      // 5. Fetch plan items
      const { data: planRows, error: pErr } = await client
        .from("cockpit_plan_items")
        .select("*")
        .eq("role", "media_buyer")
        .eq("day", day);
      if (pErr) throw pErr;

      // 6. Fetch EOD report
      const eodContext = await readPersonalEod(client,"media_buyer",reportDay.current);
      const eodRow = eodContext.report;
      reportDay.current = eodContext.day;

      const scopeSet =
        allowedClients && allowedClients.length > 0
          ? new Set(allowedClients.map(c => c.toLowerCase()))
          : null;

      // Normalize campaigns
      const campaigns = (campaignRows ?? [])
        .map(c => {
          const raw = (c.raw_data as Any) ?? {};
          const clientName = c.client_name || raw.clientName || "";
          const spend7d = Number(c.spend_7d ?? raw.spend7d ?? 0);
          const leads7d = Number(c.leads_7d ?? raw.leads7d ?? 0);
          const spendToday = Number(c.spend_today ?? raw.spendToday ?? 0);
          const leadsToday = Number(c.leads_today ?? raw.leadsToday ?? 0);
          const cpl =
            c.cpl != null
              ? Number(c.cpl)
              : leads7d > 0
                ? spend7d / leads7d
                : undefined;

          return {
            ...raw,
            _id: c.source_id || String(c.id),
            id: c.id,
            clientName,
            campaignName: raw.campaignName || clientName,
            metaAccountId: c.meta_account_id || raw.metaAccountId,
            metaCampaignId: c.meta_campaign_id || raw.metaCampaignId,
            taskId: c.task_id || raw.taskId,
            taskUrl: c.task_url || raw.taskUrl,
            serviceMode: c.service_mode || raw.serviceMode,
            verdict: c.verdict || raw.verdict || "hold",
            reason: c.reason || raw.reason || "",
            rank: Number(c.rank ?? raw.rank ?? 0),
            spend7d,
            leads7d,
            spendToday,
            leadsToday,
            cpl,
            frequency: Number(c.frequency ?? raw.frequency ?? 0),
            linkCtr: Number(c.link_ctr ?? raw.linkCtr ?? 0),
            optInRate: Number(c.opt_in_rate ?? raw.optInRate ?? 0),
            bookings7d: Number(raw.bookings7d ?? 0),
            costPerBooking:
              raw.costPerBooking != null
                ? Number(raw.costPerBooking)
                : undefined,
            daysLive: Number(raw.daysLive ?? 0),
            dayRate: Number(raw.dayRate ?? 0),
            daysSinceTouch: Number(raw.daysSinceTouch ?? 0),
          };
        })
        .filter(c => !scopeSet || scopeSet.has(c.clientName.toLowerCase()));

      const campaignNames = new Set(campaigns.map(c => c.campaignName));

      // Normalize ads
      const ads = (adRows ?? [])
        .map(a => {
          const raw = (a.raw_data as Any) ?? {};
          return {
            ...raw,
            _id: a.source_id || String(a.id),
            id: a.id,
            campaignName: a.campaign_name || raw.campaignName,
            adName: a.ad_name || raw.adName || raw.name,
            verdict: a.verdict || raw.verdict,
            reason: a.reason || raw.reason,
            spend: Number(a.spend ?? raw.spend ?? 0),
            leads: Number(a.leads ?? raw.leads ?? 0),
            frequency: Number(a.frequency ?? raw.frequency ?? 0),
            stillUrl: a.still_url || raw.stillUrl,
            thumbnailUrl: a.thumbnail_url || raw.thumbnailUrl,
          };
        })
        .filter(a => !scopeSet || campaignNames.has(a.campaignName));

      // Normalize checks
      const checks = normalizeChecks(checkRows);

      // Normalize decisions
      const decisions = normalizeDecisions(decisionRows);

      // Normalize plan items
      const plan = (planRows ?? []).map(p => ({
        _id: String(p.id),
        id: p.id,
        text: p.text,
        reason: p.reason,
        clientName: p.client_name,
        listName: p.list_name,
        dueDate: p.due_date,
      }));

      // Calculate totals
      const spend7d = campaigns.reduce((sum, c) => sum + (c.spend7d || 0), 0);
      const leads7d = campaigns.reduce((sum, c) => sum + (c.leads7d || 0), 0);
      const spendToday = campaigns.reduce(
        (sum, c) => sum + (c.spendToday || 0),
        0,
      );
      const leadsToday = campaigns.reduce(
        (sum, c) => sum + (c.leadsToday || 0),
        0,
      );
      const cpl = leads7d > 0 ? spend7d / leads7d : 0;
      const cplToday = leadsToday > 0 ? spendToday / leadsToday : 0;

      const builtSnap: Any = {
        campaigns,
        ads,
        checks,
        decisions,
        plan,
        inbox: [],
        metaTree: [],
        clientLinks: [],
        clientUpdates: [],
        totals: {
          spend7d,
          leads7d,
          cpl,
          spendToday,
          leadsToday,
          cplToday,
        },
        eodSubmitted: Boolean(eodRow?.submitted_at),
        eod: eodRow ?? null,
        eodOwner: eodContext.owner,
        eodDay: eodContext.day,
        lastSyncAt: Date.now(),
        syncProblems: [],
      };

      setSnap(builtSnap);
      setError(null);
    } catch (err: unknown) {
      console.error("Failed to load media buyer snapshot from Supabase:", err);
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

  const decide = useCallback(
    async (args: {
      subject: string;
      action: string;
      evidence?: string;
      kind?: string;
      reason?: string;
      metricAtDecision?: number;
      reroutedTo?: string;
      amount?: number;
      metadata?: Record<string, any>;
      [key: string]: any;
    }) => {
      await executeDecide(client, args);
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const removeDecision = useCallback(
    async (args: { id: string | number }) => {
      if (!client) {
        throw new Error("Supabase client is required");
      }
      const numId = Number(args.id);
      if (Number.isNaN(numId) || numId <= 0) {
        throw new Error("Invalid decision id");
      }
      const { error: rpcErr } = await client.rpc("cockpit_remove_decision", {
        p_id: numId,
      });
      if (rpcErr) throw rpcErr;
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const saveEod = useCallback(
    async (args: {
      energy?: string;
      answers?: Any;
      computed?: Any;
      body?: string;
      [key: string]: any;
    }) => {
      if (!client) {
        throw new Error("Supabase client is required");
      }
      await savePersonalEod(client,"media_buyer",{owner:snap?.eodOwner??"",day:snap?.eodDay??""},{...args,submit:args.submit ?? false});
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
          p_role: "media_buyer",
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

  const sendFeedback = useCallback(
    async (args: {
      title?: string;
      description?: string;
      message?: string;
      category?: string;
      [key: string]: any;
    }) => {
      if (!client) {
        throw new Error("Supabase client is required");
      }
      const { error: rpcErr } = await client.rpc(
        "cockpit_submit_issue_report",
        {
          p_role: "media_buyer",
          p_title: args.title || "Feedback",
          p_description: args.description || args.message || "",
          p_category: args.category ?? "feedback",
          p_metadata: {},
        },
      );
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
    decide,
    removeDecision,
    saveEod,
    addPlanItems,
    sendFeedback,
  };
}
