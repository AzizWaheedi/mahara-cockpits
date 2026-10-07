import type { SupabaseClient } from "@supabase/supabase-js";
import { executeCsmAction } from "./csmActionClient";
import {requestNativeReport,type ReportRequest} from './reportClient';
import {
  currentCsmProfiles,
  readCsmClientProfile,
  readCsmPerformance,
  readCsmSources,
} from "./csmReadModel";
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
  return currentCsmProfiles(tables.clientProfiles).map(row => {
    const appointments = row.performance?.appointments,
      adDays = row.adLeads?.daily;
    if (!Array.isArray(appointments) || !Array.isArray(adDays))
      throw Error(
        `Period data for ${row.clientName} is unavailable. Refresh its native source before using period totals.`,
      );
    return {
      clientName: row.clientName,
      ...periodNumbers(appointments, adDays, from, to),
    };
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
  return requestNativeReport(client,args);
}
