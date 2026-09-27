import { useEffect, useState } from "react";
import { useCockpitAuth } from "../auth/SupabaseAuthProvider";
import { loadSupabaseAccess } from "../auth/supabaseAccess";
import {
  copyGoalPlan,
  goalCatalogue,
  readGoalsBoard,
  removeGoalTarget,
  saveGoalPlan,
  saveGoalTargets,
} from "./ceoGoalsClient";
import { supabase } from "./supabase";
import {readPeople,readPeopleRoles,savePerson,setPersonActive,unavailablePeopleDirectory} from "./ceoPeopleClient";

export class ConvexError extends Error {
  data: any;
  constructor(data: any) {
    super(typeof data === "string" ? data : JSON.stringify(data));
    this.data = data;
  }
}

export class ConvexReactClient {
  constructor(_url?: string) {}
}

export function useConvexAuth() {
  const { isAuthenticated, ready } = useCockpitAuth();
  return { isAuthenticated, isLoading: !ready };
}

export type Id<_T extends string = string> = string;
export type FunctionReturnType<F extends (...args: any) => any = any> =
  F extends (...args: any) => infer R ? Awaited<R> : any;

// biome-ignore lint/suspicious/noExplicitAny: universal query runner
export function useQuery<T = any>(queryFn: any, args?: any): T {
  const [data, setData] = useState<any>(undefined);

  const argsJson = JSON.stringify(args);

  useEffect(() => {
    if (args === "skip" || !queryFn) return;
    let active = true;
    Promise.resolve(typeof queryFn === "function" ? queryFn(args) : queryFn)
      .then(res => {
        if (active) setData(res);
      })
      .catch(err => {
        console.error("useQuery error:", err);
        if (active) setData(undefined);
      });
    return () => {
      active = false;
    };
  }, [queryFn, argsJson]);

  return data as T;
}

export function useMutation<T extends (...args: any[]) => any>(
  mutationFn: T,
): T {
  return mutationFn;
}

export function useAction<T extends (...args: any[]) => any>(actionFn: T): T {
  return actionFn;
}

export function useQueries(queries: any[] | Record<string, any>): any {
  const isArray = Array.isArray(queries);
  const [results, setResults] = useState<any>(() => {
    if (isArray) return queries.map(() => undefined);
    const init: Record<string, any> = {};
    for (const k of Object.keys(queries || {})) init[k] = undefined;
    return init;
  });

  const queriesJson = JSON.stringify(queries);

  useEffect(() => {
    let active = true;
    if (isArray) {
      Promise.all(
        queries.map(q => {
          if (!q || q.args === "skip") return Promise.resolve(undefined);
          return Promise.resolve(
            typeof q.query === "function" ? q.query(q.args) : q,
          );
        }),
      ).then(res => {
        if (active) setResults(res);
      });
    } else if (queries && typeof queries === "object") {
      const keys = Object.keys(queries);
      Promise.all(
        keys.map(k => {
          const q = (queries as Record<string, any>)[k];
          if (!q || q.args === "skip") return Promise.resolve([k, undefined]);
          return Promise.resolve(
            typeof q.query === "function" ? q.query(q.args) : q,
          ).then(res => [k, res]);
        }),
      ).then(entries => {
        if (active) {
          const obj: Record<string, any> = {};
          for (const [k, v] of entries) {
            obj[k] = v;
          }
          setResults(obj);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [queriesJson, isArray]);

  return results;
}

async function handleApiCall(endpoint: string, args: any = {}): Promise<any> {
  const [domain, sub, ...rest] = endpoint.split(".");

  // 1. Roles
  if (domain === "roles" && sub === "me") {
    return loadSupabaseAccess(supabase);
  }

  // 2. Control (status toggles)
  if (domain === "control" && sub === "setStatus") {
    const { campaignName, status } = args;
    if (campaignName && status) {
      await supabase
        .from("cockpit_campaigns")
        .update({ status })
        .ilike("campaign_name", campaignName);
    }
    return { ok: true };
  }

  // 3. Board
  if (domain === "board") {
    if (sub === "adStatusOptions") {
      return [
        "Active",
        "Paused",
        "Testing",
        "Scaling",
        "Dead Campaign",
        "Lost Client",
        "Review",
      ];
    }
    if (sub === "advertisingCityOptions") {
      return ["Kuwait", "Riyadh", "Dubai", "Jeddah", "Doha", "Abu Dhabi"];
    }
    if (sub === "setAdStatus") {
      await supabase
        .from("cockpit_campaigns")
        .update({ status: args.status })
        .ilike("campaign_name", args.campaignName);
      return { ok: true };
    }
    return { ok: true };
  }

  // 4. Cockpit queries & mutations
  if (domain === "cockpit") {
    if (sub === "onboardings") {
      const { data } = await supabase
        .from("cockpit_client_profiles")
        .select("*")
        .eq("stage", "onboarding");
      return (data || []).map(p => ({
        id: String(p.id),
        clientName: p.client_name,
        stage: p.stage,
        health: p.health,
      }));
    }
    if (sub === "winners") {
      const { data } = await supabase.from("winner_ads").select("*").limit(100);
      return data || [];
    }
    return { ok: true };
  }

  // 5. Personal calendars
  if (domain === "personalCalendars") {
    if (sub === "mine") {
      return { email: "media-buyer@maharamedia.com", configured: true };
    }
    return { ok: true };
  }

  // 6. CEO Features
  if (domain === "ceo") {
    if (sub === "goals") {
      switch (rest.join(".")) {
        case "board":
          return readGoalsBoard(supabase, args);
        case "savePlan":
          return saveGoalPlan(supabase, args);
        case "saveTargets":
          return saveGoalTargets(supabase, args);
        case "removeTarget":
          return removeGoalTarget(supabase, args);
        case "startFrom":
          return copyGoalPlan(supabase, args);
        case "catalogue":
          return goalCatalogue(supabase);
        default:
          throw new Error(`Unknown goals operation: ${rest.join(".")}`);
      }
    }
    if (sub === "people") {
      switch(rest.join(".")) {
        case "list": return readPeople(supabase);
        case "roles": return readPeopleRoles(supabase);
        case "save": return savePerson(supabase,args);
        case "setActive": return setPersonActive(supabase,args);
        case "workspace":
        case "importWorkspace": return unavailablePeopleDirectory(supabase);
        case "remove": throw new Error("Preserve the person's history: mark them as gone instead of deleting them.");
        default: throw new Error("Unknown people operation.");
      }
    }
    if (sub === "manualPayments") {
      if (rest[0] === "list") {
        const { data } = await supabase
          .from("cockpit_manual_payments")
          .select("*")
          .order("day", { ascending: false });
        return data || [];
      }
      if (rest[0] === "formInfo") {
        return { rails: ["bank_transfer", "cheque", "cash", "tap", "other"] };
      }
      if (rest[0] === "clientOptions") {
        const { data } = await supabase
          .from("cockpit_client_profiles")
          .select("client_name")
          .order("client_name");
        return (data || []).map(c => c.client_name);
      }
      return { ok: true };
    }
    if (sub === "queries" && rest[0] === "callCenterReport") {
      return { daily: [], total: 0 };
    }
    if (sub === "queries" && rest[0] === "refreshNow") {
      return { ok: true };
    }
    if (sub === "frequency" && rest[0] === "forRange") {
      return { freq: 1.0 };
    }
    if (sub === "windows") {
      return { rows: [], spend: 0, leads: 0 };
    }
    return { ok: true };
  }

  // Default fallback
  return { ok: true };
}

const apiReferences = new Map<string, any>();
function createApiProxy(path: string[] = []): any {
  const key = path.join(".");
  if (apiReferences.has(key)) return apiReferences.get(key);
  const reference = new Proxy(() => {}, {
    get(_target, prop: string) {
      if (prop === "then" || typeof prop !== "string") return undefined;
      return createApiProxy([...path, prop]);
    },
    apply(_target, _thisArg, args) {
      return handleApiCall(path.join("."), args[0]);
    },
  });
  apiReferences.set(key, reference);
  return reference;
}

export const api: any = createApiProxy();
