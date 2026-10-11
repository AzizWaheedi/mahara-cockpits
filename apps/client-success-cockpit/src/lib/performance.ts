import type { SupabaseClient } from "@supabase/supabase-js";
import { executeCsmAction } from "./csmActionClient";
import {
  currentCsmProfiles,
  readCsmClientProfile,
  readCsmPerformance,
  readCsmSources,
} from "./csmReadModel";
import { type ReportRequest, requestNativeReport } from "./reportClient";
import { periodNumbers } from "./reportPeriod";
export async function fetchPerformanceOverview(
  client: SupabaseClient,
  _allowedClients?: string[] | null,
) {
  return readCsmPerformance(client);
}
export async function fetchClientProfile(
  client: SupabaseClient,
  clientName: string,
) {
  return readCsmClientProfile(client, { clientName });
}
export async function fetchPerformancePeriod(
  client: SupabaseClient,
  from: string,
  to: string,
) {
  const { tables } = await readCsmSources(client);
  // One client without period data shows "-" on its own row; it no longer
  // replaces the whole list with an error.
  return currentCsmProfiles(tables.clientProfiles).map(row => {
    const appointments = row.performance?.appointments,
      adDays = row.adLeads?.daily;
    const figures: Record<string, unknown> = periodNumbers(
      Array.isArray(appointments) ? appointments : [],
      Array.isArray(adDays) ? adDays : [],
      from,
      to,
    );
    // No sheet rows read: the outcome counts are unknown, not zero.
    if (!Array.isArray(appointments))
      for (const k of [
        "sheetLeads",
        "booked",
        "shows",
        "noshows",
        "quotes",
        "closes",
        "unknownOutcome",
        "showRate",
        "closeRate",
      ])
        figures[k] = null;
    // No ad rows read: leads, spend and cost per lead are unknown. With no
    // sheet either, there is no lead count from anywhere.
    if (!Array.isArray(adDays)) {
      figures.spend = null;
      figures.cpl = null;
      if (!Array.isArray(appointments)) {
        figures.leads = null;
        figures.leadsFrom = null;
      }
    } else if (!Array.isArray(appointments) && figures.leadsFrom === "sheet") {
      figures.leads = null;
      figures.leadsFrom = null;
    }
    return { clientName: row.clientName, ...figures };
  });
}
export async function fetchTasksAdded(
  client: SupabaseClient,
  taskId: string,
): Promise<any[]> {
  const { data, error } = await client.rpc("cockpit_csm_tasks_added", {
    p_task_id: taskId,
  });
  if (error) throw Error(error.message);
  if (!Array.isArray(data)) throw Error("Task history was not confirmed");
  return data;
}
export async function addTask(
  client: SupabaseClient,
  _userEmail: string,
  args: {
    taskId: string;
    clientName: string;
    title: string;
    note?: string;
    department?: string;
    due?: number;
  },
): Promise<string> {
  const result = await executeCsmAction(client, "act", {
    taskId: args.taskId,
    kind: "ticket",
    action: args.title.trim().slice(0, 140),
    note: args.note,
    department: args.department || "client_success",
    due: args.due,
    taskOrigin: "client_profile",
  });
  return result.receiptId;
}
export async function requestReportDoc(
  client: SupabaseClient,
  userEmailOrArgs: string | ReportRequest,
  maybeArgs?: ReportRequest,
): Promise<{ status: string; id: string }> {
  const args =
    typeof userEmailOrArgs === "object"
      ? userEmailOrArgs
      : (maybeArgs ?? { clientName: "" });
  return requestNativeReport(client, args);
}
