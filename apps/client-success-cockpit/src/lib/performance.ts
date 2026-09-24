import type { SupabaseClient } from "@supabase/supabase-js";

// biome-ignore lint/suspicious/noExplicitAny: generic profile payloads
type Any = any;

function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function fetchPerformanceOverview(
  client: SupabaseClient,
  allowedClients?: string[] | null,
): Promise<Any> {
  const { data: rows, error } = await client
    .from("cockpit_client_profiles")
    .select("*")
    .order("client_name", { ascending: true });

  if (error) throw error;

  const scopeSet =
    allowedClients && allowedClients.length > 0
      ? new Set(allowedClients.map(c => c.toLowerCase()))
      : null;

  const filtered = (rows ?? []).filter(
    r => !scopeSet || scopeSet.has((r.client_name || "").toLowerCase()),
  );

  const groupOf = (r: Any): string => {
    const stage = String(r.stage || "");
    if (/onboarding|contact|booked|launch|ghosted|blueprint/i.test(stage))
      return "onboarding";
    if (/pause|freeze|hold/i.test(stage)) return "paused";
    if (/stop|cancel|churn|offboard|lost/i.test(stage)) return "churned";
    return "active";
  };

  const clients = filtered.map(r => {
    const raw = (r.overview as Any) ?? {};
    const kpi = (r.kpi as Any) ?? {};
    return {
      _id: String(r.id),
      id: r.id,
      clientName: r.client_name,
      stage: r.stage || "Active",
      group: groupOf(r),
      happiness: r.health || raw.level || "neutral",
      kpi,
      notes: r.notes ?? raw.notes ?? [],
      overview: raw,
    };
  });

  return {
    asOf: Date.now(),
    totals: {
      all: clients.length,
      active: clients.filter(c => c.group === "active").length,
      onboarding: clients.filter(c => c.group === "onboarding").length,
      paused: clients.filter(c => c.group === "paused").length,
      churned: clients.filter(c => c.group === "churned").length,
    },
    clients,
    trends: {
      days: [],
      weeks: [],
    },
  };
}

export async function fetchClientProfile(
  client: SupabaseClient,
  clientName: string,
): Promise<Any> {
  const { data: p, error } = await client
    .from("cockpit_client_profiles")
    .select("*")
    .eq("client_name", clientName)
    .maybeSingle();

  if (error) throw error;
  if (!p) return null;

  const raw = (p.overview as Any) ?? {};
  return {
    ...raw,
    _id: String(p.id),
    id: p.id,
    clientName: p.client_name,
    stage: p.stage || raw.stage || "Active",
    happiness: p.health || raw.happiness || "neutral",
    service: p.service || raw.service,
    kpi: p.kpi ?? raw.kpi ?? {},
    notes: p.notes ?? raw.notes ?? [],
    liveDays: raw.liveDays ?? 30,
    pocDays: raw.pocDays ?? 0,
    callDays: raw.callDays ?? 0,
    reportDays: raw.reportDays ?? 0,
    reports: [],
    language: raw.language ?? "ar",
  };
}

export async function fetchTasksAdded(
  client: SupabaseClient,
  taskId: string,
): Promise<Any[]> {
  const { data } = await client
    .from("cockpit_plan_items")
    .select("*")
    .eq("role", "csm")
    .ilike("reason", `%${taskId}%`)
    .order("created_at", { ascending: false });

  return (data ?? []).map(d => ({
    _id: String(d.id),
    id: d.id,
    action: d.text,
    evidence: d.reason,
    clientName: d.client_name,
    createdAt: d.created_at,
  }));
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
  const day = kuwaitToday();
  const { data, error } = await client
    .from("cockpit_plan_items")
    .insert({
      role: "csm",
      day,
      text: args.title.trim().slice(0, 140),
      reason: `Task ${args.taskId}: ${args.note ?? ""}`.trim(),
      client_name: args.clientName,
      list_name: args.department || "csm",
      due_date: args.due ? new Date(args.due).toISOString().slice(0, 10) : null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return String(data.id);
}

export async function requestReportDoc(
  client: SupabaseClient,
  args: {
    clientName: string;
    month?: string;
    language?: string;
    note?: string;
    extras?: string[];
  },
): Promise<Any> {
  const day = kuwaitToday();
  const id = `rep-${Date.now()}`;
  await client.from("cockpit_decisions").insert({
    role: "csm",
    day,
    subject: args.clientName,
    action: "request_report_doc",
    evidence: `Report requested for ${args.month || day.slice(0, 7)}: ${args.note || ""}`.trim(),
    kind: "report",
    metadata: { ...args, reportId: id },
  });

  return { status: "queued", id };
}
