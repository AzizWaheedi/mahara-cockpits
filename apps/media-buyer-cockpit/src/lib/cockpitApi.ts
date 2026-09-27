import { useEffect, useMemo, useRef, useState } from "react";
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
import {ManualPaymentError,manualPaymentList,manualPaymentInfo,manualPaymentClients,addManualPayment,changeManualPayment,manualPaymentHistory} from "./ceoManualPaymentsClient";
import {readPeople,readPeopleRoles,savePerson,setPersonActive,unavailablePeopleDirectory} from "./ceoPeopleClient";
import { callCenterRange, parseCallCenterReport } from "../types/ceo/callCenterContract";
import { readMediaStats } from "./mediaStatsClient";
import { mediaAction } from "./mediaActionsClient";
import { ceoAction } from "./ceoActionsClient";
import { listCreativeRequests, reviewCreativeRequest, creativeProviderAction } from "./creativeActionsClient";
import { api as ideationApi } from "./ideation";
import { api as swipeApi } from "./swipe";
import { campaignBuildAction } from "./campaignBuildsClient";
import { runWinnerSave } from "./winnerSavesClient";
import {
  type TeamUserContext,
  fetchTeamOverview,
  fetchMeetingPage,
  saveMeeting,
  setPart,
  addSitting,
  saveDoc,
  saveNotes,
  addItem,
  editItem,
  closeItem,
  moveItem,
  saveBlock,
  deleteBlock,
  moveBlock,
  saveWheel,
  deleteWheel,
  saveWheelOption,
  deleteWheelOption,
  moveWheelOption,
  setPrizeAmount,
  spin,
  setGoalHit,
  saveCreativeRow,
  deleteCreativeRow,
  openCreativeRequests,
  setSeries,
  moveSitting,
  cancelSitting,
  endMeeting,
  setEmail,
  putOnCalendar,
  takeOver,
  retryCalendar,
} from "./team";

async function getTeamUserContext(client: any): Promise<TeamUserContext> {
  const { data: auth } = await client.auth.getUser();
  const email = auth?.user?.email?.toLowerCase().trim() ?? "";
  const isCeo = ["aziz@maharamedia.com", "awaheedi2008@gmail.com"].includes(email);
  let isAdmin = false;
  if (auth?.user?.id) {
    const { data: member } = await client
      .from("cockpit_members")
      .select("roles")
      .eq("auth_user_id", auth.user.id)
      .maybeSingle();
    const roles: string[] = member?.roles ?? [];
    isAdmin = roles.includes("admin");
  }
  return { email, isCeo, isAdmin };
}

const MEDIA_READS = new Set(["board.adStatusOptions", "board.advertisingCityOptions", "ceo.b2bManage.inspect", "ceo.b2bLaunch.list"]);
const MEDIA_WRITES = new Set([
  "control.setStatus", "ceo.b2bControl.setStatus", "edit.setAdSetBudget", "edit.duplicateAdSet",
  "board.setAdStatus", "board.setAdvertisingCities", "board.renameCard", "board.addToBoard",
  "edit.newAdsFromExisting", "edit.addCreativeToCampaign", "ceo.b2bManage.rename",
  "ceo.b2bManage.setBudget", "ceo.b2bManage.setSchedule", "ceo.b2bManage.setAudience",
  "ceo.b2bManage.createAdset", "ceo.b2bManage.duplicateAdset", "ceo.b2bManage.createAds", "ceo.ltv.apply",
  "execute.runAction", "cockpit.askForDetail", "edit.askViktorFor", "board.dismissOffBoard",
  "ceo.b2bManage.copyIdeas", "ceo.b2bLaunch.build", "ceo.b2bLaunch.save", "ceo.b2bLaunch.discard", "ceo.b2bLaunch.launch",
]);
const DATA_CHANGED = "cockpit-data-changed";
const refreshWrappers = new WeakMap<(...args: any[]) => any, (...args: any[]) => any>();
const READ_VERBS = new Set(["get", "list", "detail", "counts", "preview", "inspect", "page", "templates", "history", "overview", "fileUrl", "formInfo", "clientOptions", "catalogue", "board", "read", "requestsList", "watchlistList"]);
function refreshAfter<T extends (...args: any[]) => any>(fn: T): T {
  const prior = refreshWrappers.get(fn);
  if (prior) return prior as T;
  const wrapped = async (...args: any[]) => {
    const result = await fn(...args);
    const endpoint = (fn as any).__endpoint as string | undefined;
    if (!READ_VERBS.has(endpoint?.split(".").at(-1) ?? "") && typeof window !== "undefined") {
      window.dispatchEvent(new Event(DATA_CHANGED));
    }
    return result;
  };
  refreshWrappers.set(fn, wrapped);
  return wrapped as T;
}

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
  const [error, setError] = useState<Error | null>(null);
  const { session } = useCockpitAuth();
  const owner = session?.user.id ?? null;
  const previous = useRef<{ query: any; args: string | undefined; owner: string | null } | null>(null);

  const argsJson = JSON.stringify(args);

  useEffect(() => {
    const changed = previous.current?.query !== queryFn || previous.current?.args !== argsJson || previous.current?.owner !== owner;
    previous.current = { query: queryFn, args: argsJson, owner };
    if (changed) { setError(null); setData(undefined); }
    if (args === "skip" || !queryFn || !owner) return;
    let active = true;
    let generation = 0;
    const load = () => {
      const run = ++generation;
      Promise.resolve().then(() => typeof queryFn === "function" ? queryFn(args) : queryFn)
        .then(res => { if (active && run === generation) { setData(res); setError(null); } })
        .catch(err => { if (active && run === generation) setError(err instanceof Error ? err : new Error(String(err))); });
    };
    load();
    const poll = setInterval(() => { if (typeof document === "undefined" || !document.hidden) load(); }, 30_000);
    if (typeof window !== "undefined") window.addEventListener(DATA_CHANGED, load);
    return () => {
      active = false;
      clearInterval(poll);
      if (typeof window !== "undefined") window.removeEventListener(DATA_CHANGED, load);
    };
  }, [queryFn, argsJson, owner]);

  if (error) throw error;
  return data as T;
}

export function useMutation<T extends (...args: any[]) => any>(
  mutationFn: T,
): T {
  return refreshAfter(mutationFn);
}

export function useAction<T extends (...args: any[]) => any>(actionFn: T): T {
  return refreshAfter(actionFn);
}

export function useQueries(queries: any[] | Record<string, any>): any {
  const isArray = Array.isArray(queries);
  const current = useRef(queries);
  current.current = queries;
  const queriesJson = JSON.stringify(queries);
  const load = useMemo(() => async () => {
    const values = current.current;
    const read = async (q: any) => {
      if (!q || q.args === "skip") return undefined;
      if (typeof q.query !== "function") throw new Error("A callable query is required.");
      return q.query(q.args);
    };
    if (Array.isArray(values)) return Promise.all(values.map(read));
    return Object.fromEntries(await Promise.all(Object.entries(values ?? {}).map(async ([key,q]) => [key,await read(q)])));
  }, [queriesJson, isArray]);
  const result = useQuery(load);
  return result ?? (isArray ? queries.map(() => undefined) : Object.fromEntries(Object.keys(queries ?? {}).map(key => [key,undefined])));
}

async function handleApiCall(endpoint: string, args: any = {}): Promise<any> {
  const [domain, sub, ...rest] = endpoint.split(".");
  const unavailable = (): never => {
    throw new Error(`This operation has not completed its Supabase migration (${endpoint}). No action was performed.`);
  };

  // 1. Roles
  if (domain === "roles" && sub === "me") {
    return loadSupabaseAccess(supabase);
  }
  if (domain === "stats" && ["range", "campaignTrend", "portfolioTrend", "coverage"].includes(sub)) {
    return readMediaStats(supabase, sub, args);
  }
  if (MEDIA_READS.has(endpoint)) return mediaAction(endpoint, args);
  if (MEDIA_WRITES.has(endpoint)) return mediaAction(endpoint, args, { apply: true });
  if (domain === "ideation" && Object.hasOwn(ideationApi.ideation, sub)) {
    return (ideationApi.ideation as Record<string, (args: any) => Promise<any>>)[sub](args);
  }
  if (domain === "foreplay" && Object.hasOwn(swipeApi.foreplay, sub)) {
    return (swipeApi.foreplay as Record<string, (args: any) => Promise<any>>)[sub](args);
  }
  if (domain === "winnerSaves") return runWinnerSave(supabase, sub, args);
  if (domain === "cockpit" && ["buildsFor", "requestBuild", "saveVariants", "launchBuild", "discardBuild"].includes(sub)) {
    return campaignBuildAction(supabase, sub, args);
  }
  if (domain === "cockpit" && sub === "setClientLanguage") {
    const { data, error } = await supabase.rpc("cockpit_media_preferences", { p_client: args.clientName, p_language: args.language });
    if (error) throw error;
    if (data?.ok !== true) throw new Error("The language preference was not saved.");
    return null;
  }
  if (domain === "creativeRequests" && sub === "list") return listCreativeRequests(supabase, args);
  if (domain === "creativeRequests" && sub === "review") return reviewCreativeRequest(supabase, args);
  if (domain === "creativeRequests" && ["request", "linkLaunch", "retryFeedback"].includes(sub)) {
    return creativeProviderAction(supabase, sub as "request" | "linkLaunch" | "retryFeedback", args, true);
  }
  if (domain === "ceo" && ["settings", "feedback", "profiles", "teamStatus", "bankImport", "bankPdf", "payers", "ltv"].includes(sub)) {
    return ceoAction(supabase, `${sub}.${rest.join(".")}`, args);
  }

  // 2. Control (status toggles)
  if (domain === "control" && sub === "setStatus") {
    // Updating a cached campaign is not a confirmed change in Meta.
    return unavailable();
  }

  // 3. Board
  if (domain === "board") {
    if (sub === "adStatusOptions") {
      return unavailable();
    }
    if (sub === "advertisingCityOptions") {
      return unavailable();
    }
    if (sub === "setAdStatus") {
      return unavailable();
    }
    return unavailable();
  }

  // 4. Cockpit queries & mutations
  if (domain === "cockpit") {
    if (sub === "onboardings") {
      const { data, error } = await supabase
        .from("cockpit_client_profiles")
        .select("*")
        .eq("stage", "onboarding");
      if (error) throw error;
      return (data || []).map(p => ({
        id: String(p.id),
        clientName: p.client_name,
        stage: p.stage,
        health: p.health,
      }));
    }
    if (sub === "winners") {
      const { data, error } = await supabase.from("winner_ads").select("*").limit(100);
      if (error) throw error;
      return data || [];
    }
    return unavailable();
  }

  // 5. Personal calendars
  if (domain === "personalCalendars") {
    if (sub === "mine") {
      return unavailable();
    }
    return unavailable();
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
      try {
        switch(rest.join(".")){
          case "list": return await manualPaymentList(supabase,args);
          case "formInfo": return await manualPaymentInfo(supabase);
          case "clientOptions": return await manualPaymentClients(supabase);
          case "add": return await addManualPayment(supabase,args);
          case "softDelete": return await changeManualPayment(supabase,args,true);
          case "restore": return await changeManualPayment(supabase,args,false);
          case "history": return await manualPaymentHistory(supabase,args);
          default: throw new Error("Unknown manual-payment operation.");
        }
      } catch(error) {
        throw new ConvexError(error instanceof ManualPaymentError ? error.data :
          {code:"refused",message:error instanceof Error?error.message:"The payment operation was not confirmed."});
      }
    }

    if (sub === "queries" && rest[0] === "callCenterReport") {
      const { from, to } = callCenterRange(args.from, args.to);
      const { data, error } = await supabase.rpc("cockpit_ceo_call_center_report", { p_from: from, p_to: to });
      if (error) throw error;
      return parseCallCenterReport(data, from, to);
    }
    if (sub === "queries" && rest[0] === "refreshNow") {
      return ceoAction(supabase, "queries.refreshNow", args);
    }
    if (sub === "frequency" && rest[0] === "forRange") {
      return unavailable();
    }
    if (sub === "windows") {
      return unavailable();
    }
    return unavailable();
  }
  // 7. Team & TeamCalendar
  if (domain === "team" || domain === "teamCalendar") {
    const u = await getTeamUserContext(supabase);
    const op = sub;
    if (domain === "team") {
      switch (op) {
        case "overview": return fetchTeamOverview(supabase, u);
        case "page": return fetchMeetingPage(supabase, u, args.id);
        case "saveMeeting": return saveMeeting(supabase, u, args);
        case "setPart": return setPart(supabase, u, args);
        case "addSitting": return addSitting(supabase, u, args);
        case "saveDoc": return saveDoc(supabase, u, args);
        case "saveNotes": return saveNotes(supabase, u, args);
        case "addItem": return addItem(supabase, u, args);
        case "editItem": return editItem(supabase, u, args);
        case "closeItem": return closeItem(supabase, u, args);
        case "moveItem": return moveItem(supabase, u, args);
        case "saveBlock": return saveBlock(supabase, u, args);
        case "deleteBlock": return deleteBlock(supabase, u, args);
        case "moveBlock": return moveBlock(supabase, u, args);
        case "saveWheel": return saveWheel(supabase, u, args);
        case "deleteWheel": return deleteWheel(supabase, u, args);
        case "saveWheelOption": return saveWheelOption(supabase, u, args);
        case "deleteWheelOption": return deleteWheelOption(supabase, u, args);
        case "moveWheelOption": return moveWheelOption(supabase, u, args);
        case "setPrizeAmount": return setPrizeAmount(supabase, u, args);
        case "spin": return spin(supabase, u, args);
        case "setGoalHit": return setGoalHit(supabase, u, args);
        case "saveCreativeRow": return saveCreativeRow(supabase, u, args);
        case "deleteCreativeRow": return deleteCreativeRow(supabase, u, args);
        case "openCreativeRequests": return openCreativeRequests(supabase, u);
        default: throw new Error(`Unknown team operation: ${op}`);
      }
    }
    if (domain === "teamCalendar") {
      switch (op) {
        case "setPart": return setPart(supabase, u, args);
        case "setEmail": return setEmail(supabase, u, args);
        case "setSeries": return setSeries(supabase, u, args);
        case "moveSitting": return moveSitting(supabase, u, args);
        case "cancelSitting": return cancelSitting(supabase, u, args);
        case "addSitting": return addSitting(supabase, u, args);
        case "endMeeting": return endMeeting(supabase, u, args);
        case "putOnCalendar": return putOnCalendar(supabase, u, args);
        case "takeOver": return takeOver(supabase, u, args);
        case "retryCalendar": return retryCalendar(supabase, u, args);
        default: throw new Error(`Unknown team calendar operation: ${op}`);
      }
    }
  }


  // Default fallback
  return unavailable();
}

const apiReferences = new Map<string, any>();
function createApiProxy(path: string[] = []): any {
  const key = path.join(".");
  if (apiReferences.has(key)) return apiReferences.get(key);
  const reference = new Proxy(() => {}, {
    get(_target, prop: string) {
      if (prop === "__endpoint") return key;
      if (prop === "toJSON") return () => key;
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
