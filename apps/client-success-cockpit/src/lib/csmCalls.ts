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
  /** The next call's meeting link (https only); undefined from an older summary. */
  nextCallJoinUrl?: string | null;
  /**
   * The booking to join (docs/forms/STAGE2-CONTRACT.md 2.2, 8.3): the
   * earliest booked or confirmed one that has not ended, so a call in
   * progress keeps its Join after nextCallAt has moved on. Before any call
   * starts it is the next call. Undefined from an older summary.
   */
  joinCallAt?: string | null;
  /** Its end; null when the booking gives none (the header then allows an hour). */
  joinCallEndsAt?: string | null;
  /** Its meeting link (https only). */
  joinCallUrl?: string | null;
  lastCall?: string | null;
  lastCallKind?: string | null;
  lastCallSource?: string | null;
  /** The newest check-in form in the store (docs/forms/STAGE2-CONTRACT.md 2.2). */
  lastNoteAt?: string | null;
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

/**
 * The header's Join (docs/forms/STAGE2-CONTRACT.md 8.3, Y24): the summary's
 * booking to join, from 15 minutes before its start until its end (an hour
 * when the booking gives none). It is read apart from the next call, which
 * drops a booking at its start, so a CSM late to her call still has it.
 * Beside the next call it reads "Join"; once that call has started and the
 * next call line names a later booking, or none, it names its own start.
 * Null when there is nothing to join now.
 */
export function joinLink(
  c: {
    joinCallAt?: string | null;
    joinCallUrl?: string | null;
    joinCallEndsAt?: string | null;
    nextCallAt?: string | null;
  },
  now: number,
): { href: string; label: string } | null {
  if (!c.joinCallAt || !c.joinCallUrl) return null;
  const start = Date.parse(c.joinCallAt);
  if (!Number.isFinite(start)) return null;
  const end = Date.parse(String(c.joinCallEndsAt ?? "")) || start + 3_600_000;
  if (now < start - 15 * 60_000 || now > end) return null;
  const isNext =
    Boolean(c.nextCallAt) && Date.parse(String(c.nextCallAt)) === start;
  const hhmm = new Date(start + 3 * 3_600_000).toISOString().slice(11, 16);
  return {
    href: c.joinCallUrl,
    label:
      isNext || now < start ? "Join" : `Join the call that started at ${hhmm}`,
  };
}

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

/** Calls with a form of their own: their notes are not 1-1 notes. */
const OWN_FORMS = new Set(["onboarding", "blueprint"]);

/**
 * The client row with the store's next and last call. The store wins over the
 * board's own field when it is newer; call days follow, so the cadence flags
 * (call due, notes missing) use the real last call. The last note is the
 * newer of the card's and the store's, and notes are missing when the last
 * call is newer than it, unless that call has a form of its own (onboarding,
 * Blueprint) or was the 1-1 form itself.
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
  // Undefined while the summary does not carry it yet: unknown, not "no link".
  if (s.nextCallJoinUrl !== undefined)
    out.nextCallJoinUrl = s.nextCallAt ? (s.nextCallJoinUrl ?? null) : null;
  // The call to join may have started, so it is read on its own, not from
  // nextCallAt (which drops a booking at its start).
  if (s.joinCallAt !== undefined) {
    out.joinCallAt = s.joinCallAt ?? null;
    out.joinCallEndsAt = s.joinCallAt ? (s.joinCallEndsAt ?? null) : null;
    out.joinCallUrl = s.joinCallAt ? (s.joinCallUrl ?? null) : null;
  }
  const last = kuwaitDayOf(s.lastCall);
  const board = c.lastCall ? String(c.lastCall).slice(0, 10) : "";
  if (last && (!board || board <= last)) {
    // The same day is the same call: the store knows its kind and source.
    out.lastCallAt = s.lastCall;
    out.lastCallKind = s.lastCallKind ?? null;
    out.lastCallSource = s.lastCallSource;
  }
  if (last && (!board || board < last)) {
    out.lastCall = last;
    out.callDays = Math.max(
      0,
      Math.round(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) /
          86_400_000,
      ),
    );
  }
  const note = kuwaitDayOf(s.lastNoteAt);
  if (note && (!c.lastNoteOn || String(c.lastNoteOn).slice(0, 10) < note))
    out.lastNoteOn = note;
  // The 1-1 form is the record of the call: a call newer than the newest note means notes are missing.
  const lastDay = out.lastCall ? String(out.lastCall).slice(0, 10) : "";
  out.noteMissing = Boolean(
    lastDay &&
      (!out.lastNoteOn || String(out.lastNoteOn).slice(0, 10) < lastDay) &&
      !OWN_FORMS.has(String(out.lastCallKind ?? "")) &&
      out.lastCallSource !== "checkin_form",
  );
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
  /** An impromptu recording with no client yet (docs/forms/STAGE2-CONTRACT.md 2.2). */
  candidate: boolean;
};
export async function readUnmatched(
  client: SupabaseClient,
): Promise<Unmatched[]> {
  const { data, error } = await client.rpc("cockpit_csm_unmatched_list");
  if (error) throw Error(error.message);
  return ((data ?? []) as Unmatched[]).map(u => ({
    ...u,
    candidate: u.candidate === true,
  }));
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

/** Why an impromptu recording is not a 1-1 call (cockpit_csm_candidate_settle). */
export type SettleReason =
  | "part_of_call"
  | "onboarding"
  | "blueprint"
  | "not_client";

/**
 * "Not a 1-1 call": sets an impromptu recording aside from the queue. It
 * stays on no client; `sameAs` (the other half of a call recorded twice) is
 * kept in the audit row only.
 */
export async function settleCandidate(
  client: SupabaseClient,
  id: number,
  reason: SettleReason,
  sameAs: string | null = null,
) {
  const { data, error } = await client.rpc("cockpit_csm_candidate_settle", {
    p_unmatched_id: id,
    p_reason: reason,
    p_same_as: sameAs,
  });
  if (error) throw Error(error.message);
  return data as { ok: boolean; callId?: number; reason?: string };
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
