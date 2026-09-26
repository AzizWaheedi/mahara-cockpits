import type { SupabaseClient } from "@supabase/supabase-js";

export type CockpitApp = "media-buyer" | "client-success" | "creative";
export type CockpitRole = "media_buyer" | "csm" | "creative" | "admin" | "ceo";
export type JobStatus = "queued" | "claimed" | "completed" | "failed";

export interface SubmitJobParams {
  app: CockpitApp;
  role: CockpitRole;
  prompt: string;
  clientName?: string | null;
  kind?: string;
  context?: Record<string, unknown>;
  idempotencyKey?: string | null;
}

export interface AskAiJobItem {
  id: string;
  status: JobStatus;
  phase: "pending" | "completed" | "failed";
  app: CockpitApp;
  role: CockpitRole;
  client_name: string | null;
  kind: string;
  prompt: string;
  result: Record<string, unknown> | string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ChatMessage {
  _id: string;
  role: "user" | "assistant";
  text: string;
  status: "sent" | "reading" | "answered" | "failed";
  at: number;
  jobId?: string;
  error?: string | null;
}

export function extractAnswerText(result: unknown): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    if (typeof r.reply === "string" && r.reply.trim()) return r.reply;
    if (typeof r.answer === "string" && r.answer.trim()) return r.answer;
    if (typeof r.text === "string" && r.text.trim()) return r.text;
    return "";
  }
  return "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function checkedJob(value: unknown): AskAiJobItem {
  const j = value as AskAiJobItem | null;
  if (!j || typeof j !== "object" || !UUID.test(j.id) ||
      !["queued","claimed","completed","failed"].includes(j.status) ||
      !["media-buyer","client-success","creative"].includes(j.app) ||
      typeof j.prompt !== "string" || !Number.isFinite(Date.parse(j.created_at)) ||
      (j.status === "completed" && !extractAnswerText(j.result).trim())) {
    throw new Error("The server returned an invalid conversation receipt.");
  }
  return j;
}

export async function submitAskAiJob(
  client: SupabaseClient,
  params: SubmitJobParams,
): Promise<{ jobId: string | null; error: Error | null }> {
  try {
    const { data, error } = await client.rpc("cockpit_submit_ask_ai_job", {
      p_app: params.app,
      p_role: params.role,
      p_prompt: params.prompt,
      p_client_name: params.clientName || null,
      p_kind: params.kind || "chat",
      p_context: params.context || {},
      p_idempotency_key: params.idempotencyKey || null,
    });
    if (error) {
      return { jobId: null, error: new Error(error.message) };
    }
    if (typeof data !== "string" || !UUID.test(data)) throw new Error("The request was not confirmed by the server.");
    return { jobId: data, error: null };
  } catch (err: any) {
    return { jobId: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export async function getAskAiJob(
  client: SupabaseClient,
  jobId: string,
): Promise<{ job: AskAiJobItem | null; error: Error | null }> {
  try {
    const { data, error } = await client.rpc("cockpit_get_ask_ai_job", {
      p_job_id: jobId,
    });
    if (error) {
      return { job: null, error: new Error(error.message) };
    }
    return { job: data === null ? null : checkedJob(data), error: null };
  } catch (err: any) {
    return { job: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export async function getAskAiThread(
  client: SupabaseClient,
  app: CockpitApp,
  limit = 50,
): Promise<{ thread: AskAiJobItem[]; error: Error | null }> {
  try {
    const { data, error } = await client.rpc("cockpit_get_ask_ai_thread", {
      p_app: app,
      p_limit: limit,
    });
    if (error) {
      return { thread: [], error: new Error(error.message) };
    }
    if (!Array.isArray(data)) throw new Error("The conversation history was not confirmed by the server.");
    return { thread: data.map(checkedJob), error: null };
  } catch (err: any) {
    return { thread: [], error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export async function clearAskAiThread(
  client: SupabaseClient,
  app: CockpitApp,
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { data, error } = await client.rpc("cockpit_clear_ask_ai_thread", {
      p_app: app,
    });
    if (error) {
      return { success: false, error: new Error(error.message) };
    }
    if (data !== true) throw new Error("The conversation clear was not confirmed by the server.");
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export function jobsToChatMessages(jobs: AskAiJobItem[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  // Server returns newest first, so reverse to chronological
  const chronological = [...jobs].reverse();
  for (const j of chronological) {
    const userMsgStatus: ChatMessage["status"] =
      j.status === "completed"
        ? "answered"
        : j.status === "failed"
          ? "failed"
          : j.status === "claimed"
            ? "reading"
            : "sent";

    messages.push({
      _id: `u_${j.id}`,
      role: "user",
      text: j.prompt,
      status: userMsgStatus,
      at: new Date(j.created_at).getTime(),
      jobId: j.id,
      error: j.error,
    });

    if (j.status === "completed" && j.result) {
      messages.push({
        _id: `a_${j.id}`,
        role: "assistant",
        text: extractAnswerText(j.result),
        status: "answered",
        at: j.completed_at ? new Date(j.completed_at).getTime() : Date.now(),
      });
    }
  }
  return messages;
}
