import { getFunctionName } from "convex/server";
import { useCallback, useSyncExternalStore } from "react";
import source from "./fixtures.json";

export const data: Record<string, any> = structuredClone(source);
let revision = 0;
let mode = "normal";
let receipts = 0;
const listeners = new Set<() => void>();
function notify() {
  revision++;
  for (const fn of listeners) fn();
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export function usePreviewState() {
  useSyncExternalStore(subscribe, () => revision);
  return {
    mode,
    receipts,
    change: (next: string) => {
      mode = next;
      notify();
    },
  };
}
function read(name: string, args: any) {
  if (name === "roles:me" || name === "auth:currentUser") return data[name];
  if (mode === "loading") return undefined;
  if (mode === "page-error" && name === "csm:snapshot")
    throw new Error(
      "Fictional read failure. Change the preview scenario to recover.",
    );
  if (name === "csm:syncStatus")
    return {
      at: mode === "stale" ? Date.now() - 4 * 3600000 : Date.now(),
      ok: mode !== "stale",
      errors: [],
      clients: 3,
    };
  if (name === "csm:clientProfile")
    return data[`profile:${args.clientName}`] ?? null;
  if (name === "csm:snapshot" && mode === "empty")
    return {
      ...data[name],
      clients: [],
      tasks: [],
      checks: [],
      decisions: [],
      totals: Object.fromEntries(
        Object.keys(data[name].totals).map(k => [k, 0]),
      ),
    };
  if (
    name === "hermes:thread" ||
    name === "csm:myAsks" ||
    name === "csm:tasksAdded" ||
    name === "previews:stillUrls"
  )
    return [];
  return data[name];
}
export function useQuery(ref: any, args: any = {}) {
  useSyncExternalStore(subscribe, () => revision);
  return args === "skip" ? undefined : read(getFunctionName(ref), args);
}
async function invoke(name: string, args: any) {
  await new Promise(r => setTimeout(r, 300));
  if (mode === "action-error")
    throw new Error(
      "Fictional connection failure. Your changes have not been saved.",
    );
  if (name === "wa:inbox")
    return mode === "empty" ? { threads: [] } : data[name];
  if (name === "churn:thisMonth") return null;
  if (["billing:sheet", "churn:page"].includes(name)) return data[name];
  if (name === "review:clients")
    return data["csm:snapshot"].clients.map((c: any) => ({
      name: c.name,
      task_id: c.taskId,
    }));
  if (name === "review:sent") return [];
  if (name === "checkIns:prepare")
    return {
      contact: { id: "demo-contact", name: "Example Owner" },
      calendar: {
        id: "demo-calendar",
        name: "Client check-in",
        minutes: 30,
        timezone: "Asia/Kuwait",
      },
      slots:
        mode === "no-slots"
          ? []
          : [
              `${args.day}T13:00:00+03:00`,
              `${args.day}T14:00:00+03:00`,
              `${args.day}T15:00:00+03:00`,
            ],
      day: args.day,
    };
  if (name === "checkIns:book") {
    const client = data["csm:snapshot"].clients.find(
      (c: any) => c.taskId === args.taskId,
    );
    if (client) {
      client.nextCallAt = args.startTime;
      client.nextPoc = args.startTime.slice(0, 10);
    }
    receipts++;
    notify();
    return { appointmentId: "preview-appointment", startTime: args.startTime };
  }
  if (name === "csm:act") {
    const c = data["csm:snapshot"].clients.find(
      (c: any) => c.taskId === args.taskId,
    );
    data["csm:snapshot"].decisions.push({
      subject: c.name,
      action: args.action,
      kind: "approved",
    });
  } else if (name === "csm:toggleCheck") {
    const c = data["csm:snapshot"].checks.find((c: any) => c._id === args.id);
    if (c) c.done = args.done;
  } else if (name === "csm:submitEod")
    data["csm:snapshot"].eod = {
      ...args,
      at: Date.now(),
      email: "csm@example.test",
    };
  else if (name === "comms:linkCalendar")
    data["comms:overview"].myCalendar = {
      calendarId: args.calendarId,
      status: "pending",
    };
  else if (name === "comms:unlinkCalendar")
    data["comms:overview"].myCalendar = null;
  else if (name === "csm:saveMoneyGoals") data["csm:snapshot"].money = args;
  else if (name === "csm:saveHotRow") {
    const rows = data["csm:snapshot"].hotRows;
    const old = rows.find((r: any) => r.key === args.key);
    if (old) Object.assign(old, args);
    else rows.push(args);
  } else if (name === "wa:send") {
    receipts++;
    notify();
    return { sent: false, status: "accepted", messageId: "demo-message" };
  } else if (name === "wa:archive")
    data["wa:inbox"].threads = data["wa:inbox"].threads.filter(
      (t: any) => t.id !== args.threadId,
    );
  else if (name === "gaps:queue") {
    const row = data["gaps:list"].rows.find(
      (r: any) => r.taskId === args.taskId,
    );
    const gap = row?.gaps.find((g: any) => g.label === args.label);
    if (gap) gap.queued = true;
  } else if (
    ![
      "csm:reportIssue",
      "csm:setClientLanguage",
      "csm:addPlanItems",
      "csm:addTask",
      "csm:requestReportDoc",
      "hermes:send",
      "hermes:clear",
    ].includes(name)
  )
    throw new Error(
      `This preview does not simulate ${name}. No request was sent.`,
    );
  receipts++;
  notify();
  return null;
}
export function useAction(ref: any) {
  const name = getFunctionName(ref);
  return useCallback((args: any = {}) => invoke(name, args), [name]);
}
export const useMutation = useAction;
export const useConvexAuth = () => ({
  isLoading: false,
  isAuthenticated: true,
});
export const useConvex = () => ({ query: () => Promise.resolve(null) });
