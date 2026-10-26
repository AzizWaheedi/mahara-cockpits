import type { SupabaseClient } from "@supabase/supabase-js";
import { fold } from "./search";

/**
 * The CSM's end of day, read over its own working day (Muhammed, 26 October
 * 2026): the counts and the call summary draft follow the EOD's day, 04:00 to
 * 04:00 Kuwait (cockpit_eod_working_day, 20260927e), not the calendar day the
 * Today tab uses. A call logged at 01:30 belongs to the evening before.
 *
 * The draft is one line per client called: the CSM's own note, else the first
 * sentence of the Fathom summary of a call they hosted that day, else "Call
 * held, no note". Nothing is rewritten and nothing is sent.
 */

export type EodDecision = {
  subject: string;
  action: string;
  kind?: string;
  reason?: string;
  loggedAt?: string;
  clickupTaskId?: string;
  clickupTaskUrl?: string;
};
/** A Fathom recording the CSM hosted, from cockpit_csm_eod_calls. */
export type EodCall = {
  id: number;
  taskId: string;
  clientName?: string | null;
  startsAt: string;
  summary?: string | null;
};
export type CallDraft = {
  text: string;
  lines: number;
  /** Lines from the CSM's own notes, from Fathom, and with neither. */
  fromNotes: number;
  fromFathom: number;
  noNote: number;
};

const HOUR = 3_600_000;
/** Kuwait is UTC+3 all year; the EOD day turns at 04:00 there. */
const KUWAIT = 3 * HOUR;
const TURN = 4 * HOUR;

/** The EOD working day an instant belongs to. */
export function eodWorkingDay(at: number = Date.now()): string {
  return new Date(at + KUWAIT - TURN).toISOString().slice(0, 10);
}

/** The instants an EOD day covers: 04:00 Kuwait to 04:00 the next morning. */
export function eodWindow(day: string): { from: string; to: string } {
  const start = Date.parse(`${day}T04:00:00+03:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(start))
    throw new Error(`Not an EOD day: ${day}`);
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + 24 * HOUR).toISOString(),
  };
}

const inWindow = (iso: string | undefined, w: { from: string; to: string }) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) && t >= Date.parse(w.from) && t < Date.parse(w.to);
};

/** The decisions logged on an EOD day. A row with no time is left out. */
export function onEodDay<T extends { loggedAt?: string }>(
  day: string,
  rows: T[],
): T[] {
  const w = eodWindow(day);
  return rows.filter(r => inWindow(r.loggedAt, w));
}

/** A call is a call logged ("Held a call"), not a booking that mentions one. */
export const isLoggedCall = (d: { action?: string }) =>
  /^held a call/i.test(d.action ?? "");

/** The numbers the EOD form shows and files, over one EOD day. */
export const eodCounts = (day: string, decisions: EodDecision[]) =>
  countDecisions(onEodDay(day, decisions));

/** The EOD numbers over rows already read for the day. */
export function countDecisions(ds: EodDecision[]) {
  return {
    handled: new Set(ds.map(d => d.subject)).size,
    calls: ds.filter(isLoggedCall).length,
    signups: ds.filter(d => /signup|welcome|onboarding/i.test(d.action)).length,
    hot: ds.filter(d => /upsell|referral|review/i.test(d.action)).length,
    /** The upsell part of "hot", for the Upsells answer. */
    upsells: ds.filter(d => /upsell/i.test(d.action)).length,
    // "ticket" is what the native page saves; "rerouted" is the Convex history.
    // A ticket counts once ClickUp has it, the same rule as the ticket list.
    tickets: ds.filter(
      d => (d.kind === "ticket" || d.kind === "rerouted") && d.clickupTaskUrl,
    ).length,
    left: ds.filter(d => d.kind === "left").length,
  };
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The first sentence of a Fathom summary, as plain text: headings skipped,
 * links keep their words, bold and bullets dropped, cut at a word near `max`.
 */
export function firstSentence(
  summary: string | null | undefined,
  max = 160,
): string {
  for (const raw of String(summary ?? "").split(/\r?\n/)) {
    if (/^\s*#{1,6}\s/.test(raw)) continue;
    const line = oneLine(
      raw
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[*`]+/g, "")
        .replace(/^\s*(?:[-+•]|\d+[.)])\s+/, "")
        .replace(/^\s*>\s*/, ""),
    );
    if (!line) continue;
    // A full stop inside "11.29" is not the end of a sentence.
    const sentence = line.match(/^.*?[.!?؟](?=\s|$)/)?.[0] ?? line;
    if (sentence.length <= max) return sentence;
    const cut = sentence.slice(0, max - 1);
    const space = cut.lastIndexOf(" ");
    return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
  return "";
}

type Group = {
  key: string;
  name: string;
  first: number;
  notes: string[];
  sentences: string[];
};

/**
 * The call summary draft for one EOD day. Several calls with one client make
 * one line; the CSM's notes win over Fathom for that client.
 */
export function buildCallDraft(
  day: string,
  decisions: EodDecision[],
  calls: EodCall[],
): CallDraft {
  const w = eodWindow(day);
  // Notes read in the order the calls happened.
  const logged = onEodDay(day, decisions)
    .filter(isLoggedCall)
    .sort(
      (a, b) => Date.parse(a.loggedAt ?? "") - Date.parse(b.loggedAt ?? ""),
    );
  const recorded = calls.filter(c => c.taskId && inWindow(c.startsAt, w));
  // A logged call names its client; Fathom knows the ClickUp id. Join on either.
  const taskByName = new Map<string, string>();
  for (const c of recorded)
    if (c.clientName) taskByName.set(fold(c.clientName), c.taskId);
  const groups = new Map<string, Group>();
  const groupFor = (taskId: string | undefined, name: string, at: number) => {
    const key = taskId || taskByName.get(fold(name)) || `name:${fold(name)}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, name, first: at, notes: [], sentences: [] };
      groups.set(key, g);
    }
    g.first = Math.min(g.first, at);
    return g;
  };
  for (const d of logged) {
    const name = oneLine(d.subject ?? "");
    if (!name) continue;
    const g = groupFor(d.clickupTaskId, name, Date.parse(d.loggedAt ?? ""));
    // The CSM's name for the client wins over Fathom's.
    g.name = name;
    const note = oneLine(d.reason ?? "");
    if (note && !g.notes.includes(note)) g.notes.push(note);
  }
  for (const c of recorded) {
    const g = groupFor(
      c.taskId,
      oneLine(c.clientName ?? "") || c.taskId,
      Date.parse(c.startsAt),
    );
    const sentence = firstSentence(c.summary);
    if (sentence && !g.sentences.includes(sentence)) g.sentences.push(sentence);
  }
  const draft: CallDraft = {
    text: "",
    lines: 0,
    fromNotes: 0,
    fromFathom: 0,
    noNote: 0,
  };
  const lines = [...groups.values()]
    .sort((a, b) => a.first - b.first)
    .map(g => {
      if (g.notes.length) {
        draft.fromNotes++;
        return `${g.name}: ${g.notes.join(" · ")}`;
      }
      if (g.sentences.length) {
        draft.fromFathom++;
        return `${g.name}: ${g.sentences.join(" · ")}`;
      }
      draft.noNote++;
      return `${g.name}: Call held, no note`;
    });
  draft.text = lines.join("\n");
  draft.lines = lines.length;
  return draft;
}

/** "Mon 26 Oct" for an EOD day. */
export const eodDayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** The CSM decisions logged on an EOD day, by when they were logged. */
export async function readEodDecisions(client: SupabaseClient, day: string) {
  const w = eodWindow(day);
  const { data, error } = await client
    .from("cockpit_decisions")
    .select("*")
    .eq("role", "csm")
    .gte("logged_at", w.from)
    .lt("logged_at", w.to);
  if (error) throw error;
  return data ?? [];
}

/** The Fathom recordings the signed-in CSM hosted on an EOD day. */
export async function readEodCalls(
  client: SupabaseClient,
  day: string,
): Promise<EodCall[]> {
  const { data, error } = await client.rpc("cockpit_csm_eod_calls", {
    p_day: day,
  });
  if (error) throw new Error(error.message);
  if (!data || data.day !== day || !Array.isArray(data.calls))
    throw new Error("The Fathom read did not confirm the day");
  return data.calls as EodCall[];
}
