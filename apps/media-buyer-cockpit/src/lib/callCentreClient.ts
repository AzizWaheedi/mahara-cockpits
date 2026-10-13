/**
 * The media buyer's reads for one client's call centre (Aziz, 2026-10-13:
 * "dials, dials per ad, dials per campaign ... is this a call center issue or
 * is it not?"), shown in the Calls part of a client's page (/ads?account=).
 *
 * Three reads, all as the signed-in seat:
 *   cockpit_client_calls(key, from, to)  the client's call centre, about 4.5 s
 *   cockpit_client_callers()             every client's assigned callers, cheap
 *   cockpit-call-recording               one call's audio, on Play only
 *
 * The heavy read is cached per client and date range for the session, so a
 * second visit, the header's caller line and the section share one answer.
 * The shape, the verdict and the wording live in callCentre.ts (the same file
 * in the client success cockpit); nothing here works a number out again.
 */
import { useEffect, useSyncExternalStore } from "react";
import { z } from "zod";
import { count } from "@/components/ceo/format";
import {
  type CallCentre,
  type CallRow,
  NO_CALLER,
  parseCallCentre,
} from "./callCentre";
import { fetchCallRecording, type RecordingResult } from "./callRecording";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Which dates.

/** The read covers at most this many days, ending today at the latest. */
export const MAX_CALL_DAYS = 93;
/** With no range on the page, the calls show this many days. */
export const DEFAULT_CALL_DAYS = 30;

export type CallWindow = {
  from: string;
  to: string;
  /** Why the window is not the page's range, in plain words; null when it is. */
  why: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** Today in Kuwait, "YYYY-MM-DD": the day the dialer's report counts in. */
export function kuwaitToday(now: number = Date.now()): string {
  return new Date(now + 3 * 3600e3).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86400e3;
  return new Date(t).toISOString().slice(0, 10);
}

/** "14 Sep" for a "YYYY-MM-DD" day. */
export function dayLabel(day: string): string {
  if (!DAY.test(day)) return day;
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * The page's range as the call read can take it: inside the last 93 days,
 * ending today at the latest. With no range, or a range wholly older than
 * that, the last 30 days, and the reason is said.
 */
export function callWindow(
  range: { start?: string | null; end?: string | null } | null | undefined,
  today: string = kuwaitToday(),
): CallWindow {
  const fallback = (why: string | null): CallWindow => ({
    from: addDays(today, -(DEFAULT_CALL_DAYS - 1)),
    to: today,
    why,
  });
  const a = range?.start ?? "";
  const b = range?.end ?? "";
  if (!DAY.test(a) || !DAY.test(b)) return fallback(null);
  const earliest = addDays(today, -(MAX_CALL_DAYS - 1));
  const start = a <= b ? a : b;
  const end = a <= b ? b : a;
  if (start > today)
    return fallback(
      "The page's dates are after today, so the calls show the last 30 days.",
    );
  if (end < earliest)
    return fallback(
      `The call read goes back ${MAX_CALL_DAYS} days, so the calls show the last 30 days instead of these dates.`,
    );
  const from = start < earliest ? earliest : start;
  const to = end > today ? today : end;
  return {
    from,
    to,
    why:
      from !== start
        ? `Calls cover ${dayLabel(from)} to ${dayLabel(to)}: the call read goes back at most ${MAX_CALL_DAYS} days.`
        : null,
  };
}

// ---------------------------------------------------------------------------
// Which client.

/**
 * The key the read finds the client by: the Meta ad account its campaigns
 * run in (the one most of them use). The RPC maps an account to its client,
 * or, for a client with no account on file, through the account's campaigns.
 */
export function callCentreKey(
  campaigns: { metaAccountId?: unknown }[],
): string | null {
  const counts = new Map<string, number>();
  for (const c of campaigns) {
    const id =
      typeof c.metaAccountId === "string" ? c.metaAccountId.trim() : "";
    if (/^(act_)?\d{5,20}$/i.test(id))
      counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [id, n] of counts)
    if (best === null || n > (counts.get(best) ?? 0)) best = id;
  return best;
}

// ---------------------------------------------------------------------------
// The client's calls, cached for the session.

export type CallsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: CallCentre }
  | { status: "error"; message: string };

const IDLE: CallsState = { status: "idle" };
const calls = new Map<string, CallsState>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const callsId = (key: string, w: { from: string; to: string }) =>
  `${key}|${w.from}|${w.to}`;

const FAILED =
  "The call centre numbers did not load. Try again; if it keeps failing, tell the CEO.";

/** A refusal or failure from the database as one plain sentence. */
export function callsProblem(error: unknown): string {
  const e = (error ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof e.message === "string" ? e.message.trim() : "";
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "57014")
    return "The dialer took too long to answer. Try again in a minute; a shorter date range reads faster.";
  if (code === "PGRST202" || code === "42883")
    return "The call centre read is not on the database yet. Tell the CEO.";
  if (/jwt|token/i.test(message) && /expired|invalid/i.test(message))
    return "Your sign-in has expired. Reload the page.";
  if (/failed to fetch|network|load failed/i.test(message))
    return "The call centre numbers could not be reached. Check the connection and try again.";
  // The read's own refusals are written as sentences for this page
  // ("This client is not on your cockpit seat. Ask the CEO to add it.").
  if ((code === "42501" || code === "22023") && message) return message;
  if (/^[A-Z][^\n]{8,240}[.!]$/.test(message)) return message;
  return FAILED;
}

/** Starts the read unless it is cached or under way; `again` retries it. */
export function loadClientCalls(
  key: string,
  w: { from: string; to: string },
  again = false,
): void {
  const id = callsId(key, w);
  const current = calls.get(id);
  if (current && !again && current.status !== "error") return;
  if (current?.status === "loading") return;
  calls.set(id, { status: "loading" });
  emit();
  void (async () => {
    let next: CallsState;
    try {
      const { data, error } = await supabase.rpc("cockpit_client_calls", {
        p_key: key,
        p_from: w.from,
        p_to: w.to,
      });
      next = error
        ? { status: "error", message: callsProblem(error) }
        : { status: "ready", data: parseCallCentre(data) };
    } catch (e) {
      next = {
        status: "error",
        message:
          e instanceof Error && /shape this page cannot read/.test(e.message)
            ? e.message
            : callsProblem(e),
      };
    }
    calls.set(id, next);
    emit();
  })();
}

/** One client's calls over a window; starts the read when it is not cached. */
export function useClientCalls(
  key: string | null,
  w: { from: string; to: string },
): CallsState {
  const id = key ? callsId(key, w) : "";
  const state = useSyncExternalStore(
    subscribe,
    () => (id ? (calls.get(id) ?? IDLE) : IDLE),
    () => IDLE,
  );
  useEffect(() => {
    if (key) loadClientCalls(key, { from: w.from, to: w.to });
  }, [key, w.from, w.to]);
  return state;
}

/** No lead came in and no call was made: the Calls part shows an empty state. */
export function callsAreEmpty(data: CallCentre): boolean {
  const leads = data.official?.leads ?? data.cohort.leads;
  return leads === 0 && data.window.dials === 0;
}

/**
 * Whether the Calls part shows this client's lost leads, so the page's own
 * lost pipeline (LostLeads, GoHighLevel stages) steps aside: one lost
 * breakdown per client, never two with different totals back to back.
 *
 * The Calls part holds them for a client we call whose dialer read has lost
 * leads, and while that read is out (so the pipeline does not show and then
 * vanish). The pipeline stays for a done-with-you client, a client with no ad
 * account, a read that failed or came back empty, and a dialer with none
 * marked lost.
 */
export function callsHoldLost(
  state: CallsState,
  opts: { leadsOnly: boolean; hasKey: boolean },
): boolean {
  if (opts.leadsOnly || !opts.hasKey) return false;
  if (state.status === "idle" || state.status === "loading") return true;
  if (state.status === "error") return false;
  const data = state.data;
  if (data.client.serviceMode?.toUpperCase() === "DWY") return false;
  return !callsAreEmpty(data) && data.lost.total > 0;
}

// ---------------------------------------------------------------------------
// Every client's assigned callers, one cheap read for the session.

const CallersSchema = z.object({
  clients: z.array(
    z.object({
      taskId: z.string().nullable().optional(),
      locationId: z.string(),
      clientName: z.string(),
      callers: z.array(z.object({ email: z.string(), name: z.string() })),
    }),
  ),
});

export type ClientCallers = z.output<typeof CallersSchema>["clients"];

type CallersState =
  | { status: "idle" | "loading" | "error" }
  | { status: "ready"; clients: ClientCallers };

let callers: CallersState = { status: "idle" };

function loadClientCallers(): void {
  if (callers.status !== "idle") return;
  callers = { status: "loading" };
  emit();
  void (async () => {
    try {
      const { data, error } = await supabase.rpc("cockpit_client_callers");
      const parsed = error ? null : CallersSchema.safeParse(data);
      callers = parsed?.success
        ? { status: "ready", clients: parsed.data.clients }
        : { status: "error" };
    } catch {
      callers = { status: "error" };
    }
    emit();
  })();
}

export function useClientCallers(): CallersState {
  const state = useSyncExternalStore(
    subscribe,
    () => callers,
    () => callers,
  );
  useEffect(loadClientCallers, []);
  return state;
}

const norm = (s: string) =>
  s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * This client's callers from the cheap read, matched by the client's name
 * (the media buyer's client names are the dialer's, checked 2026-10-13).
 * Null when the name is not on the list, so the page waits for the full read.
 */
export function callersFor(
  clients: ClientCallers,
  clientName: string,
): string[] | null {
  const want = norm(clientName);
  const mine = clients.filter(c => norm(c.clientName) === want);
  if (!mine.length) return null;
  return [...new Set(mine.flatMap(c => c.callers.map(p => p.name)))];
}

/** Callers as one line: "Rana Saleh", "Rana Saleh and Dana Yousef". */
export function callerNames(names: string[]): string {
  if (!names.length) return NO_CALLER;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export type CallerState =
  | { status: "loading" }
  | { status: "unknown" }
  | { status: "ready"; names: string[] };

/**
 * The client's assigned callers: the full read's when it is in (it knows the
 * client by its location, so it wins), the cheap read's until then.
 */
export function useAssignedCallers(
  clientName: string,
  key: string | null,
  w: { from: string; to: string },
): CallerState {
  const full = useClientCalls(key, w);
  const list = useClientCallers();
  if (full.status === "ready")
    return {
      status: "ready",
      names: full.data.callers.assigned.map(c => c.name),
    };
  const quick =
    list.status === "ready" ? callersFor(list.clients, clientName) : null;
  if (quick) return { status: "ready", names: quick };
  const fullDone = full.status === "error" || full.status === "idle";
  const listDone = list.status === "ready" || list.status === "error";
  return fullDone && listDone ? { status: "unknown" } : { status: "loading" };
}

// ---------------------------------------------------------------------------
// One campaign or ad, as its row reads.

/** Shared with the other cockpit in callCentre.ts. */
export { type RowRates, rowRates } from "./callCentre";

/** Leads in the client average that sit in no row (no campaign or ad id). */
export function leadsOutsideRows(
  rows: CallRow[],
  average: CallRow | null,
): number {
  if (!average) return 0;
  const inRows = rows.reduce((s, r) => s + r.leads, 0);
  return Math.max(0, average.leads - inRows);
}

// ---------------------------------------------------------------------------
// Who is waiting now.

/**
 * "6 untouched after a working hour · 4 callbacks waiting, none overdue ·
 * 10 stuck over a week": what waits, in the words of the lines under it.
 * Empty when nothing does.
 */
export function waitingHeadline(n: {
  untouched: number;
  callbacks: number;
  overdue: number;
  notReturned: number;
  stuck: number;
}): string[] {
  return [
    n.untouched > 0 && `${count(n.untouched)} untouched after a working hour`,
    n.callbacks > 0 &&
      `${count(n.callbacks)} callback${n.callbacks === 1 ? "" : "s"} waiting, ${
        n.overdue > 0 ? `${count(n.overdue)} overdue` : "none overdue"
      }`,
    n.notReturned > 0 &&
      `${count(n.notReturned)} missed call${n.notReturned === 1 ? "" : "s"} not returned`,
    n.stuck > 0 && `${count(n.stuck)} stuck over a week`,
  ].filter((t): t is string => Boolean(t));
}

// ---------------------------------------------------------------------------
// One recording, fetched when the person presses Play.

export async function loadRecording(callId: string): Promise<RecordingResult> {
  let token: string | undefined;
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
  } catch {
    token = undefined;
  }
  if (!token)
    return { ok: false, message: "Your sign-in has expired. Reload the page." };
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url)
    return {
      ok: false,
      message:
        "This page has no database address, so calls cannot play. Tell the CEO.",
    };
  return fetchCallRecording(url, token, callId);
}

/** For tests: forget every cached read. */
export function resetCallCentreCache(): void {
  calls.clear();
  callers = { status: "idle" };
  emit();
}
