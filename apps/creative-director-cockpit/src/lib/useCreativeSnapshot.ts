import {buildSnapshot,snapshotContext} from "./creativeSourceModels";
import {logClientTouch} from "./clients";
import {readPersonalEod,savePersonalEod} from "./personalEod";
import {useRef} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";

// biome-ignore lint/suspicious/noExplicitAny: generic creative director rows
type Any = any;

export function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

const DEFAULT_CREATIVE_CHECKS = [
  {
    key: "clickup_comments",
    label: "Clear ClickUp comments on the creative board",
    detail: "Anything a client or the media buyer asked you yesterday.",
    phase: "sod",
    href: "/tasks",
  },
  {
    key: "whatsapp_sprint",
    label: "WhatsApp sprint",
    detail: "Client groups — answer anything creative-related.",
    phase: "sod",
  },
  {
    key: "slack_sprint",
    label: "Slack sprint",
    detail: "Editors, media buyer, CSM.",
    phase: "sod",
  },
  {
    key: "editors_standup",
    label: "Check where every editor is",
    detail: "Anything overdue gets chased before you start your own work.",
    phase: "sod",
    href: "/editors",
  },
  {
    key: "brand_dna",
    label: "Move the oldest Brand DNA forward",
    detail: "Nothing else can be produced for a client until this is locked.",
    phase: "mid",
    href: "/tasks",
  },
  {
    key: "scripts",
    label: "Write the scripts that are due",
    detail: "Oldest first. Anything past 3 days is blocking a launch.",
    phase: "mid",
    href: "/tasks",
  },
  {
    key: "replace_fatigued",
    label: "Replace the creatives that are burning out",
    detail: "Frequency over the gate means the audience has seen it enough.",
    phase: "mid",
    href: "/what-works",
  },
  {
    key: "social_calendar",
    label: "Plan next week's scripts on the calendar",
    detail: "Keep every client 2 weeks ahead so no editor runs out of work.",
    phase: "mid",
    href: "/calendar",
  },
];

export interface UseCreativeSnapshotResult {
  snap: Any | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  toggleCheck: (args: { key: string; done: boolean }) => Promise<void>;
  logTouch: (args: { client?: string; clientName?: string; action?: string; note?: string; kind?: string }) => Promise<void>;
  saveEod: (args: { energy?: string; stress?: string; submit?: boolean; body?: string; answers?: Any; computed?: Any }) => Promise<void>;
  addPlanItem: (args: { text: string; clientName?: string; dueDate?: string }) => Promise<void>;
  removePlanItem: (args: { id: string | number }) => Promise<void>;
}

export function useCreativeSnapshot(
  client: SupabaseClient | null,
  allowedClients?: string[] | null,
): UseCreativeSnapshotResult {
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

      // 1. Fetch daily checks
      const { data: checkRows, error: chErr } = await client
        .from("cockpit_daily_checks")
        .select("*")
        .eq("role", "creative")
        .eq("day", day)
        .eq("source_deleted", false)
        .order("display_order", { ascending: true });
      if (chErr) throw chErr;

      // 2. Fetch decisions
      const { data: decisionRows, error: dErr } = await client
        .from("cockpit_decisions")
        .select("*")
        .eq("role", "creative")
        .eq("day", day);
      if (dErr) throw dErr;

      // 3. Fetch plan items
      const { data: planRows, error: plErr } = await client
        .from("cockpit_plan_items")
        .select("*")
        .eq("role", "creative")
        .eq("day", day);
      if (plErr) throw plErr;

      // 4. Fetch EOD report
      const eodContext = await readPersonalEod(client,"creative",reportDay.current);
      const eodRow = eodContext.report;
      reportDay.current = eodContext.day;

      const {data:source,error:sourceError}=await client.rpc("cockpit_creative_source_read");
      if(sourceError) throw sourceError;
      if(!source?.tables) throw new Error("Creative source data is unavailable.");

      const checksMap = new Map((checkRows ?? []).map(c => [c.check_key, c]));
      const checks = DEFAULT_CREATIVE_CHECKS.map((def, idx) => {
        const found = checksMap.get(def.key);
        return {
          _id: found ? String(found.id) : `def_${def.key}`,
          id: found?.id,
          key: def.key,
          label: def.label,
          detail: def.detail,
          phase: def.phase,
          href: def.href,
          done: Boolean(found?.done),
          doneAt: found?.done_at,
          displayOrder: idx + 1,
        };
      });

      const decisions = (decisionRows ?? []).map(d => ({
        _id: String(d.id),
        id: d.id,
        subject: d.subject,
        action: d.action,
        evidence: d.evidence,
        kind: d.kind,
        day: d.day,
      }));

      const plan = (planRows ?? []).map(pl => ({
        _id: String(pl.id),
        id: pl.id,
        text: pl.text,
        clientName: pl.client_name,
        dueDate: pl.due_date,
      }));

      const model = await buildSnapshot(snapshotContext({...source.tables,
        checks:(checkRows??[]).map(c=>({...c,key:c.check_key,doneAt:c.done_at?Date.parse(c.done_at):null})),
        planItems:(planRows??[]).map(p=>({...p,_id:String(p.id),client:p.client_name})),
        eodReports:eodRow?[{...eodRow,day}]:[],
      }),allowedClients?.length?new Set(allowedClients.map(n=>n.trim().toLowerCase())):null);
      const builtSnap:Any={...model,day,checks,decisions,plan,eod:eodRow??null,eodOwner:eodContext.owner,eodDay:eodContext.day,source:source.source,
        counts:{...model.counts,checksDone:checks.filter(c=>c.done).length,checksTotal:checks.length}};

      setSnap(builtSnap);
      setError(null);
    } catch (err: unknown) {
      console.error("Failed to load creative snapshot from Supabase:", err);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, allowedClients]);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  const toggleCheck = useCallback(
    async (args: { key: string; done: boolean }) => {
      if (!client) return;
      const day = kuwaitToday();
      // Ensure check row exists in cockpit_daily_checks
      const { data: existing, error: existingError } = await client
        .from("cockpit_daily_checks")
        .select("id")
        .eq("role", "creative")
        .eq("day", day)
        .eq("check_key", args.key)
        .maybeSingle();

      if(existingError) throw existingError;
      if (existing) {
        const {error:writeError}=await client.rpc("cockpit_set_daily_check", {
          p_id: existing.id,
          p_expected_done: !args.done,
          p_done: args.done,
        });
        if(writeError) throw writeError;
      } else {
        const def = DEFAULT_CREATIVE_CHECKS.find(c => c.key === args.key);
        const {error:writeError}=await client
          .from("cockpit_daily_checks")
          .insert({
            role: "creative",
            day,
            check_key: args.key,
            label: def?.label ?? args.key,
            detail: def?.detail,
            phase: def?.phase ?? "sod",
            done: args.done,
            done_at: args.done ? new Date().toISOString() : null,
            source_system: "supabase",
          });
        if(writeError) throw writeError;
      }
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const logTouch = useCallback(
    async (args: { client?: string; clientName?: string; action?: string; note?: string; kind?: string }) => {
      if (!client) return;
      await logClientTouch(client,{client:args.client??args.clientName,kind:args.kind??args.action,note:args.note});
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const saveEod = useCallback(
    async (args: { energy?: string; stress?: string; submit?: boolean; body?: string; answers?: Any; computed?: Any }) => {
      if (!client) throw new Error("Sign in before saving your EOD.");
      await savePersonalEod(client,"creative",{owner:snap?.eodOwner??"",day:snap?.eodDay??""},{...args,submit:args.submit ?? false});
      await fetchSnapshot();
    },
    [client, fetchSnapshot, snap?.eodOwner, snap?.eodDay],
  );

  const addPlanItem = useCallback(
    async (args: { text: string; clientName?: string; dueDate?: string }) => {
      if (!client) return;
      const day = kuwaitToday();
      const { error: rpcErr } = await client.rpc("cockpit_add_plan_item", {
        p_role: "creative",
        p_day: day,
        p_text: args.text,
        p_reason: null,
        p_client_name: args.clientName ?? null,
        p_list_name: null,
        p_due_date: args.dueDate ?? null,
      });
      if (rpcErr) throw rpcErr;
      await fetchSnapshot();
    },
    [client, fetchSnapshot],
  );

  const removePlanItem = useCallback(
    async (args: { id: string | number }) => {
      if (!client) return;
      const numId = Number(args.id);
      const { error: rpcErr } = await client.rpc("cockpit_remove_plan_item", {
        p_id: numId,
      });
      if (rpcErr) throw rpcErr;
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
    logTouch,
    saveEod,
    addPlanItem,
    removePlanItem,
  };
}
