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
  toggleCheck: (args: { id: string | number; done: boolean; expectedCurrent?: boolean }) => Promise<void>;
  decide: (args: {
    subject: string;
    action: string;
    evidence?: string;
    kind?: string;
    reroutedTo?: string;
    amount?: number;
  }) => Promise<void>;
  removeDecision: (args: { id: string | number }) => Promise<void>;
  saveEod: (args: { energy?: string; answers?: Any; computed?: Any }) => Promise<void>;
  addPlanItems: (args: {
    items: Array<{
      text: string;
      reason?: string;
      clientName?: string;
      listName?: string;
      dueDate?: string;
    }>;
  }) => Promise<void>;
  sendFeedback: (args: { title: string; description: string; category?: string }) => Promise<void>;
}

export function useMediaBuyerSnapshot(
  client: SupabaseClient | null,
  allowedClients?: string[] | null,
): UseMediaBuyerSnapshotResult {
  const [snap, setSnap] = useState<Any | undefined>(undefined);
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
      const { data: checkRows, error: chErr } = await client
        .from("cockpit_daily_checks")
        .select("*")
        .eq("role", "media_buyer")
        .eq("day", day)
        .eq("source_deleted", false)
        .order("display_order", { ascending: true });
      if (chErr) throw chErr;

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
      const { data: eodRow } = await client
        .from("cockpit_eod_reports")
        .select("*")
        .eq("role", "media_buyer")
        .eq("day", day)
        .maybeSingle();

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
            costPerBooking: raw.costPerBooking != null ? Number(raw.costPerBooking) : undefined,
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
      const spendToday = campaigns.reduce((sum, c) => sum + (c.spendToday || 0), 0);
      const leadsToday = campaigns.reduce((sum, c) => sum + (c.leadsToday || 0), 0);
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
    async (args: { id: string | number; done?: boolean; expectedCurrent?: boolean; [key: string]: any }) => {
      if (!client) return;
      const numId = Number(args.id);
      const done = args.done ?? true;
      const { error: rpcErr } = await client.rpc("cockpit_set_daily_check", {
        p_id: numId,
        p_expected_done: args.expectedCurrent ?? !done,
        p_done: done,
      });
      if (rpcErr) throw rpcErr;
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
      reroutedTo?: string;
      amount?: number;
      [key: string]: any;
    }) => {
      if (!client) return;
      const day = kuwaitToday();
      const { error: rpcErr } = await client.rpc("cockpit_log_decision", {
        p_role: "media_buyer",
        p_day: day,
        p_subject: args.subject,
        p_action: args.action,
        p_evidence: args.evidence ?? null,
        p_kind: args.kind ?? null,
        p_rerouted_to: args.reroutedTo ?? null,
        p_amount: args.amount ?? null,
        p_metadata: {},
      });
      if (rpcErr) throw rpcErr;
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const removeDecision = useCallback(
    async (args: { id: string | number }) => {
      if (!client) return;
      const numId = Number(args.id);
      const { error: rpcErr } = await client.rpc("cockpit_remove_decision", {
        p_id: numId,
      });
      if (rpcErr) throw rpcErr;
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const saveEod = useCallback(
    async (args: { energy?: string; answers?: Any; computed?: Any; body?: string; [key: string]: any }) => {
      if (!client) return;
      const day = kuwaitToday();
      const { error: rpcErr } = await client.rpc("cockpit_save_eod", {
        p_role: "media_buyer",
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
    async (args: { title?: string; description?: string; message?: string; category?: string; [key: string]: any }) => {
      if (!client) return;
      const { error: rpcErr } = await client.rpc("cockpit_submit_issue_report", {
        p_role: "media_buyer",
        p_title: args.title || "Feedback",
        p_description: args.description || args.message || "",
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
    decide,
    removeDecision,
    saveEod,
    addPlanItems,
    sendFeedback,
  };
}
