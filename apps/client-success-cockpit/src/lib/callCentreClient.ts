import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { type CallCentre, NO_CALLER, parseCallCentre } from "./callCentre";
import { fetchCallRecording, type RecordingResult } from "./callRecording";
import { dayLabel, kuwaitDay, shiftDay } from "./reportPeriod";

/**
 * The client page's call centre reads (Aziz, 2026-10-13: "for both the client
 * success cockpit and ... the media buyer, that we can also look at the call
 * center metrics ... The CSM needs to be able to see the assigned caller for
 * each client easily").
 *
 * - cockpit_client_calls(key, from, to): one client's calls, about 4.5 s on
 *   live data, so each answer is kept in memory for the session, per seat,
 *   client and dates; the same view opened twice reads once.
 * - cockpit_client_callers(): every visible client's assigned callers in one
 *   cheap read, for the client list and the client page header.
 * - the recording of one call, through the Edge Function, as a blob the page
 *   plays (lib/callRecording.ts).
 *
 * Both functions hold their own gate (the CEO, client success or a media
 * buyer, and the client must be on the seat); their refusals are plain
 * sentences and are shown as they are.
 */

// ---------------------------------------------------------------------------
// The dates.

/** The read takes at most 93 days, ending no later than today. */
export const MAX_CALL_DAYS = 93;
/** Without a period from the page, the last 30 days. */
export const DEFAULT_CALL_DAYS = 30;

export type CallRange = {
  from: string;
  to: string;
  /** The page's period was longer than 93 days, so its start moved. */
  clamped: boolean;
};

/**
 * The page's reporting period as the call read can take it: never past
 * today, at most 93 days, its last 93 days when longer.
 */
export function callRange(
  period?: { from: string; to: string } | null,
  today = kuwaitDay(),
): CallRange {
  if (!period)
    return {
      from: shiftDay(today, -(DEFAULT_CALL_DAYS - 1)),
      to: today,
      clamped: false,
    };
  const to = period.to > today ? today : period.to;
  const earliest = shiftDay(to, -(MAX_CALL_DAYS - 1));
  const start = period.from > to ? to : period.from;
  return start < earliest
    ? { from: earliest, to, clamped: true }
    : { from: start, to, clamped: false };
}

/** "14 Sep to 13 Oct", or "13 Oct" for one day. */
export function rangeLabel(r: { from: string; to: string }): string {
  return r.from === r.to
    ? dayLabel(r.from)
    : `${dayLabel(r.from)} to ${dayLabel(r.to)}`;
}

// ---------------------------------------------------------------------------
// One client's calls.

type DbError = { message?: string; code?: string } | null | undefined;

const RETRY = "Try again in a minute; if it stays, tell the CEO.";

/**
 * A failed read in plain words. The function's own refusals (not on your
 * seat, wrong dates, no such client) are already sentences and are kept.
 */
export function callReadProblem(
  error: DbError,
  what = "The call numbers",
): string {
  const message = String(error?.message ?? "").trim();
  if (error?.code === "57014" || /statement timeout/i.test(message))
    return "The dialer took too long to answer. Try again in a minute.";
  if ((error?.code === "42501" || error?.code === "22023") && message)
    return message;
  if (
    error?.code === "PGRST202" ||
    /could not find the function/i.test(message)
  )
    return `The call centre read is not on the database yet. ${RETRY}`;
  if (/failed to fetch|networkerror|load failed|network/i.test(message))
    return `${what} could not be reached. Check your connection and try again.`;
  return message
    ? `${what} could not be read (${message.replace(/\.$/, "")}). ${RETRY}`
    : `${what} could not be read. ${RETRY}`;
}

type Entry = { promise: Promise<CallCentre>; data?: CallCentre };
const calls = new Map<string, Entry>();

const callsKey = (actor: string, key: string, from: string, to: string) =>
  `${actor}|${key}|${from}|${to}`;

/** The answer already read this session, if any. */
export function cachedClientCalls(
  actor: string,
  key: string,
  from: string,
  to: string,
): CallCentre | undefined {
  return calls.get(callsKey(actor, key, from, to))?.data;
}

/**
 * The dialer's report failed inside the read (the function catches it, sets
 * the headline to null and says so in a note), as opposed to having no row
 * for the client. The note is the function's own words (migration
 * 20261013180000, "did not answer").
 */
export function reportDidNotAnswer(data: CallCentre): boolean {
  return (
    data.official === null &&
    data.notes.some(n => /report did not answer/i.test(n))
  );
}

/**
 * One client's calls for the dates. A read in flight or done is shared;
 * `fresh` reads again. A failed read is forgotten, so Try again asks anew,
 * and so is an answer without the dialer's headline (the report did not
 * answer, or has no row yet): the next open reads again instead of showing
 * a missing headline for the rest of the session.
 */
export function readClientCalls(
  client: SupabaseClient,
  actor: string,
  key: string,
  from: string,
  to: string,
  fresh = false,
): Promise<CallCentre> {
  const id = callsKey(actor, key, from, to);
  const hit = calls.get(id);
  if (hit && !fresh) return hit.promise;
  const promise = (async () => {
    const { data, error } = await client.rpc("cockpit_client_calls", {
      p_key: key,
      p_from: from,
      p_to: to,
    });
    if (error) throw new Error(callReadProblem(error));
    return parseCallCentre(data);
  })();
  const entry: Entry = { promise };
  calls.set(id, entry);
  const forget = () => {
    if (calls.get(id) === entry) calls.delete(id);
  };
  promise.then(data => {
    if (data.official) entry.data = data;
    else forget();
  }, forget);
  return promise;
}

export type CallsState =
  | { status: "loading" }
  | { status: "ready"; data: CallCentre }
  | { status: "error"; message: string };

/**
 * The read as page state. Shows a kept answer at once; otherwise loading,
 * then the answer or one sentence of what went wrong. Never blocks the page.
 */
export function useClientCalls(
  client: SupabaseClient | null,
  actor: string,
  key: string | undefined,
  from: string,
  to: string,
): { state: CallsState; reload: () => void } {
  const [state, setState] = useState<CallsState>(() => {
    const kept = key ? cachedClientCalls(actor, key, from, to) : undefined;
    return kept ? { status: "ready", data: kept } : { status: "loading" };
  });
  const [round, setRound] = useState(0);
  const fresh = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: round asks for a fresh read
  useEffect(() => {
    if (!key) {
      setState({
        status: "error",
        message:
          "This client has no ClickUp card yet, so its calls cannot be matched. Link the card and reload.",
      });
      return;
    }
    if (!client) {
      setState({
        status: "error",
        message: "Sign in again to read this client's calls.",
      });
      return;
    }
    const again = fresh.current;
    fresh.current = false;
    const kept = again ? undefined : cachedClientCalls(actor, key, from, to);
    if (kept) {
      setState({ status: "ready", data: kept });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    readClientCalls(client, actor, key, from, to, again).then(
      data => {
        if (live) setState({ status: "ready", data });
      },
      error => {
        if (live)
          setState({
            status: "error",
            message:
              error instanceof Error && error.message
                ? error.message
                : callReadProblem(null),
          });
      },
    );
    return () => {
      live = false;
    };
  }, [client, actor, key, from, to, round]);
  const reload = useCallback(() => {
    fresh.current = true;
    setRound(n => n + 1);
  }, []);
  return { state, reload };
}

// ---------------------------------------------------------------------------
// One campaign or ad as rates.

/** Shared with the other cockpit in callCentre.ts. */
export { type RowRates, rowRates } from "./callCentre";

// ---------------------------------------------------------------------------
// Playing one call.

/**
 * One call's recording with the seat's own token. Fetched only when the
 * person presses Play; the Edge Function checks the seat and audits the play.
 */
export async function playCall(
  client: SupabaseClient | null,
  callId: string,
): Promise<RecordingResult> {
  if (!client)
    return { ok: false, message: "Your sign-in has expired. Reload the page." };
  const { data, error } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token)
    return { ok: false, message: "Your sign-in has expired. Reload the page." };
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? "");
  if (!url)
    return {
      ok: false,
      message:
        "This page does not know the database address, so calls cannot be played. Tell the CEO.",
    };
  return fetchCallRecording(url, token, callId);
}

// ---------------------------------------------------------------------------
// Every client's assigned callers.

const PersonSchema = z.object({ email: z.string(), name: z.string() });

const CallersSchema = z.object({
  clients: z.array(
    z.object({
      taskId: z.string().nullable().optional(),
      locationId: z.string(),
      clientName: z.string(),
      callers: z.array(PersonSchema),
    }),
  ),
  source: z.string(),
  generatedAt: z.string(),
});

export type Caller = z.output<typeof PersonSchema>;
/** The assigned callers by ClickUp task id; a client not listed has none. */
export type CallersByTask = Map<string, Caller[]>;

/** The read's answer by task id, one entry per person even across locations. */
export function callersByTask(raw: unknown): CallersByTask {
  const parsed = CallersSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      "The callers came back in a shape this page cannot read. Refresh the page; if it stays, tell the CEO.",
    );
  const out: CallersByTask = new Map();
  for (const c of parsed.data.clients) {
    const task = c.taskId?.trim();
    if (!task) continue;
    const list = out.get(task) ?? [];
    for (const p of c.callers)
      if (!list.some(x => x.email === p.email)) list.push(p);
    out.set(task, list);
  }
  return out;
}

/** "Lama Harb", "Lama Harb and Daniya Ziad", or that nobody is assigned. */
export function callerNames(list: Caller[] | undefined): string {
  const names = (list ?? []).map(c => c.name);
  if (!names.length) return NO_CALLER;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const callers = new Map<string, Promise<CallersByTask>>();

export function readClientCallers(
  client: SupabaseClient,
  actor: string,
): Promise<CallersByTask> {
  const hit = callers.get(actor);
  if (hit) return hit;
  const promise = (async () => {
    const { data, error } = await client.rpc("cockpit_client_callers");
    if (error) throw new Error(callReadProblem(error, "The callers"));
    return callersByTask(data);
  })();
  callers.set(actor, promise);
  promise.catch(() => {
    if (callers.get(actor) === promise) callers.delete(actor);
  });
  return promise;
}

export type CallersState = {
  /** undefined while the read is on its way or when it failed. */
  byTask?: CallersByTask;
  error: string | null;
};

/** Every client's callers, read once per seat and session. */
export function useClientCallers(
  client: SupabaseClient | null,
  actor: string,
): CallersState {
  const [state, setState] = useState<CallersState>({ error: null });
  useEffect(() => {
    if (!client || !actor) return;
    let live = true;
    readClientCallers(client, actor).then(
      byTask => {
        if (live) setState({ byTask, error: null });
      },
      error => {
        if (live)
          setState({
            error:
              error instanceof Error && error.message
                ? error.message
                : callReadProblem(null, "The callers"),
          });
      },
    );
    return () => {
      live = false;
    };
  }, [client, actor]);
  return state;
}

/** For tests and a seat change: forget every kept read. */
export function forgetCallReads(): void {
  calls.clear();
  callers.clear();
}
