import type { SupabaseClient } from "@supabase/supabase-js";
import type { Digest } from "./clientBrief";
import { executeCsmAction } from "./csmActionClient";
import type { CardChange } from "./reportPeriod";

/**
 * The CSM call store (hermes/csm-calls, migration 20261011c): every call,
 * call form and media buyer change per client, read through two gated RPCs.
 * Missing is never zero: each read says when a source is stale and why.
 */
type Row = Record<string, any>;

export type CallSummary = {
  nextCallAt?: string | null;
  nextCallKind?: string | null;
  nextCallStatus?: string | null;
  lastCall?: string | null;
  lastCallKind?: string | null;
  lastCallSource?: string | null;
};
export type SourceHealth = {
  key: string;
  ok: boolean;
  lastOkAt?: string | null;
  lastRunAt?: string | null;
  note?: string | null;
  detail?: Row | null;
};
export type TimelineCall = {
  id: number;
  source: string;
  kind: string;
  title?: string;
  startsAt?: string;
  endsAt?: string;
  status: string;
  providerStatus?: string;
  upcoming: boolean;
  host?: string;
  joinUrl?: string;
  recordingUrl?: string;
  summary?: string;
  transcript?: string;
  transcriptPath?: string;
  brief?: string;
  matchMethod?: string;
  form?: { token: string; submittedAt: string; answers: FormAnswer[] } | null;
};
export type FormAnswer = {
  ref?: string;
  type?: string;
  title?: string | null;
  value: unknown;
};
export type TimelineForm = {
  token: string;
  formId: string;
  kind: string;
  submittedAt: string;
  answers: FormAnswer[];
  recordingUrl?: string | null;
  linkedCallId?: number | null;
};
export type TimelineEod = {
  day: string;
  at: string;
  author?: string | null;
  role?: string | null;
  where?: string | null;
  link?: string | null;
  excerpt: string;
  source: "cockpit" | "sheet" | "slack";
};
export type Timeline = {
  taskId: string;
  clientName: string;
  calls: TimelineCall[];
  forms: TimelineForm[];
  changes: (CardChange & { actor?: string; source?: string; link?: string })[];
  /** Team EOD passages that name this client (older reads have none: undefined, not zero). */
  eods?: TimelineEod[];
  health: SourceHealth[];
  unmatchedCount: number;
};

/** Kuwait calendar day of an instant. */
export const kuwaitDayOf = (iso?: string | null) =>
  iso && Number.isFinite(Date.parse(iso))
    ? new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10)
    : undefined;

const LIMITS: Record<string, number> = {
  "csm-ghl-calls": 45,
  "csm-checkin-form": 45,
  "csm-forms-history": 45,
  "csm-fathom": 45,
  "csm-meta-activities": 45,
  "csm-media-changes": 45,
  "csm-eod-mentions": 45,
  "csm-reconcile": 26 * 60,
};
export const SOURCE_NAMES: Record<string, string> = {
  "csm-ghl-calls": "GoHighLevel calls",
  "csm-checkin-form": "the 1-1 call notes form",
  "csm-forms-history": "the onboarding, kickoff and Blueprint forms",
  "csm-fathom": "Fathom recordings",
  "csm-meta-activities": "Meta's activity log",
  "csm-media-changes": "media buyer changes",
  "csm-eod-mentions": "team EODs",
  "csm-reconcile": "the daily check",
};

/** A source is stale when it failed or has not succeeded within its limit. */
export function isStale(h: SourceHealth | undefined, now = Date.now()) {
  if (!h) return true;
  const ok = Date.parse(h.lastOkAt ?? "");
  return (
    !h.ok || !Number.isFinite(ok) || now - ok > (LIMITS[h.key] ?? 45) * 60_000
  );
}

/** One plain sentence per stale source, for the cards that depend on it. */
export function staleSentence(
  h: SourceHealth | undefined,
  key: string,
  now = Date.now(),
) {
  if (!isStale(h, now)) return null;
  const name = SOURCE_NAMES[key] ?? key;
  // "Fathom recordings have", "Meta's activity log has".
  const has = /s$/.test(name) ? "have" : "has";
  if (!h) return `${capital(name)} ${has} not synced yet.`;
  const since = h.lastOkAt
    ? `not updated since ${shortStamp(h.lastOkAt)}`
    : "never updated";
  const why = String(h.note ?? "").replace(
    /^Failed, last good rows kept\.\s*/,
    "",
  );
  return `${capital(name)} ${has} ${since}${why ? `: ${why}` : "."}`;
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shortStamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Kuwait",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Next and last call per client, for the list and header. Null when the read failed. */
export async function readCallsSummary(client: SupabaseClient) {
  const { data, error } = await client.rpc("cockpit_csm_calls_summary");
  if (error) return { error: error.message } as const;
  return {
    clients: (data?.clients ?? {}) as Record<string, CallSummary>,
    health: Object.entries((data?.health ?? {}) as Record<string, Row>).map(
      ([key, v]) => ({ key, ...v }) as SourceHealth,
    ),
  } as const;
}

/**
 * The client row with the store's next and last call. The store wins over the
 * board's own field when it is newer; call days follow, so the cadence flags
 * (call due, notes missing) use the real last call.
 */
export function withCallSummary<T extends Row>(
  c: T,
  s: CallSummary | undefined,
  today: string,
): T {
  if (!s) return c;
  const out: Row = { ...c };
  // The store read succeeded: no valid booking clears an older board date (cancelled or gone).
  out.nextCallAt = s.nextCallAt ?? null;
  out.nextCallKind = s.nextCallAt ? s.nextCallKind : null;
  const last = kuwaitDayOf(s.lastCall);
  if (last && (!c.lastCall || String(c.lastCall).slice(0, 10) < last)) {
    out.lastCall = last;
    out.lastCallSource = s.lastCallSource;
    out.callDays = Math.max(
      0,
      Math.round(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) /
          86_400_000,
      ),
    );
    // The 1-1 form is the record of the call: a call newer than the newest note means notes are missing.
    out.noteMissing = Boolean(
      out.lastCall &&
        (!c.lastNoteOn || String(c.lastNoteOn).slice(0, 10) < last) &&
        s.lastCallSource !== "checkin_form",
    );
  }
  return out as T;
}

export async function readClientTimeline(
  client: SupabaseClient,
  taskId: string,
): Promise<Timeline> {
  const { data, error } = await client.rpc("cockpit_csm_client_timeline", {
    p_task_id: taskId,
  });
  if (error) throw Error(error.message);
  if (
    !data ||
    !Array.isArray(data.calls) ||
    !Array.isArray(data.forms) ||
    !Array.isArray(data.changes)
  )
    throw Error("The call history read was incomplete");
  return data as Timeline;
}

/**
 * The client's ClickUp card digests (newest twelve, 90 days) and the team's
 * Meta users, for the brief.
 */
export async function readClientDigests(
  client: SupabaseClient,
  taskId: string,
): Promise<{ digests: Digest[]; teamActors: string[] }> {
  const { data, error } = await client.rpc("cockpit_csm_client_digests", {
    p_task_id: taskId,
  });
  if (error) throw Error(error.message);
  if (!data || !Array.isArray(data.digests))
    throw Error("The ClickUp card notes read was incomplete");
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  return {
    digests: (data.digests as Row[]).map(d => ({
      kind: String(d.kind ?? ""),
      at: Number.isFinite(Number(d.at)) ? Number(d.at) : null,
      by: d.by ?? null,
      summary: d.summary ?? null,
      nextSteps: list(d.nextSteps),
      risks: list(d.risks),
      clientRequests: list(d.clientRequests),
      dos: list(d.dos),
      donts: list(d.donts),
    })),
    teamActors: list(data.teamActors),
  };
}

export type Unmatched = {
  id: number;
  kind: "call" | "form";
  title?: string;
  at?: string;
  reason: string;
  hint?: string;
  host?: string;
};
export async function readUnmatched(
  client: SupabaseClient,
): Promise<Unmatched[]> {
  const { data, error } = await client.rpc("cockpit_csm_unmatched_list");
  if (error) throw Error(error.message);
  return (data ?? []) as Unmatched[];
}
export async function matchUnmatched(
  client: SupabaseClient,
  id: number,
  taskId: string,
) {
  const { data, error } = await client.rpc("cockpit_csm_manual_match", {
    p_unmatched_id: id,
    p_task_id: taskId,
  });
  if (error) throw Error(error.message);
  return data as { ok: boolean; clientName?: string };
}

/** Fetch a short-lived signed link only after the call belongs to this member's client. */
export async function readTranscript(
  client: SupabaseClient,
  taskId: string,
  callId: number,
): Promise<string> {
  const { data, error } = await client.functions.invoke("cockpit-csm-api", {
    body: { operation: "calls.transcript", args: { taskId, callId } },
  });
  if (error || data?.error || !data?.url)
    throw Error(data?.error ?? error?.message ?? "Transcript is unavailable");
  const response = await fetch(data.url);
  if (!response.ok) throw Error("Private transcript could not be opened");
  return response.text();
}

/**
 * "Log a call" writes the sources of truth: ClickUp's Last POC and Last
 * Check-in Call through cockpit-csm-api (read back there), then the store's
 * manual call row. The returned text is what really happened.
 */
export async function logCall(
  client: SupabaseClient,
  c: { taskId: string; _id?: string; name: string },
  note: string,
): Promise<string> {
  const requestId = crypto.randomUUID();
  await executeCsmAction(client, "act", {
    clientId: c._id,
    taskId: c.taskId,
    action: "Held a call",
    kind: "call",
    ...(note.trim() ? { note: note.trim() } : {}),
  });
  const { error } = await client.rpc("cockpit_csm_log_manual_call", {
    p_task_id: c.taskId,
    p_note: note,
    p_request_id: requestId,
  });
  if (error)
    return `ClickUp updated, but the call history did not save: ${error.message}`;
  return "Saved, ClickUp updated";
}

/** A Typeform answer as one line of text. */
export function answerText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return v.map(answerText).filter(Boolean).join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export const FORM_NAMES: Record<string, string> = {
  checkin: "1-1 call notes",
  onboarding: "Onboarding form",
  kickoff: "Kickoff form",
  kickoff_old: "Kickoff form (retired)",
  blueprint: "Brand Blueprint form",
};
export const CALL_NAMES: Record<string, string> = {
  onboarding: "Onboarding call",
  blueprint: "Brand Blueprint call",
  launch: "Launch call",
  checkin: "Check-in call",
  other: "Call",
};
