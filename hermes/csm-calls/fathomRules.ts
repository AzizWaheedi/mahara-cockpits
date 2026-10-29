/**
 * The Fathom intake's pure rules (docs/forms/STAGE2-CONTRACT.md 4.2): what a
 * meeting is (client, candidate, internal or sales), the meeting and call rows
 * the worker (bun), the pull on open and the webhook (Deno) store for it, its
 * action items and its transcript as text. No I/O here, so every rule has a
 * test (fathomRules.test.ts). The one import is callMatch.ts's room rule, with
 * its extension: an Edge Function bundles this file.
 *
 * The class rule is written once more in SQL (cockpit_fathom_class, migration
 * 20261027g_fathom_intake.sql) for the backfill and the privacy trigger. It
 * reads the stored row, whose starts_at, ends_at and summary are the ones
 * meetingRow writes, so the two agree on every row this file wrote.
 * An internal or sales meeting keeps metadata only: its row never holds a
 * summary, action items, highlights or a transcript, and it gets no call row.
 */
import { normalizeRoom } from "./callMatch.ts";

export type FathomMeeting = Record<string, any>; // the API's Meeting object
export type MeetingClass = "client" | "candidate" | "internal" | "sales";
export const CS_TEAM = "Customer Success";
export const CANDIDATE_MIN_SECONDS = 300;
export type ActionItem = { description: string; assigneeEmail: string | null; assigneeName: string | null;
  assigneeTeam: string | null; seconds: number | null; playbackUrl: string | null; completed: boolean };

/** The keys that carry a meeting's content: an internal or sales row keeps none of them. */
const CONTENT_KEYS = ["default_summary", "action_items", "highlights"];

/** The stored row's start and end (cockpit_fathom_meetings starts_at and ends_at). */
const startOf = (m: FathomMeeting) => m?.recording_start_time ?? m?.scheduled_start_time ?? m?.created_at ?? null;
const endOf = (m: FathomMeeting) => m?.recording_end_time ?? m?.scheduled_end_time ?? null;
const recorderEmail = (m: FathomMeeting) => String(m?.recorded_by?.email ?? "").toLowerCase();
/** A trimmed string, or null for a blank one or anything that is not a string. */
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The recording's length in whole seconds, from the times its stored row keeps
 * (the recording's, else the scheduled ones), or null when one is missing or
 * the end comes before the start.
 */
export function durationSeconds(m: FathomMeeting): number | null {
  const start = Date.parse(String(startOf(m) ?? ""));
  const end = Date.parse(String(endOf(m) ?? ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 1000);
}

/** Fathom's "HH:MM:SS" (or "MM:SS"; a fraction is dropped) as seconds, else null. */
export function hhmmssToSeconds(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const t = /^(?:(\d{1,3}):)?([0-5]?\d):([0-5]\d)(?:\.\d+)?$/.exec(s.trim());
  return t ? Number(t[1] ?? 0) * 3600 + Number(t[2]) * 60 + Number(t[3]) : null;
}

/**
 * What a meeting is, in this order:
 * - sales: in the sales desk's index (salesIds holds its rows not marked
 *   `client service`) and not recorded by Customer Success. The vault indexes
 *   the CSM's own calls, so the recorder's team comes first;
 * - client: a calendar invitee is external (the worker's rule before 2a);
 * - candidate: Fathom flags it one_or_more_external, Customer Success recorded
 *   it, it is shared with a team, and it lasts 5 minutes or has a summary. These
 *   are the CSM's impromptu client calls, whose one calendar invitee is the CSM;
 * - internal: anything else.
 */
export function classifyMeeting(m: FathomMeeting, salesIds: ReadonlySet<string>): MeetingClass {
  const team = m?.recorded_by?.team;
  if (team !== CS_TEAM && salesIds?.has(String(m?.recording_id ?? ""))) return "sales";
  if (isExternal(m)) return "client";
  if (
    m?.calendar_invitees_domains_type === "one_or_more_external" &&
    team === CS_TEAM &&
    m?.shared_with !== "no_teams" &&
    ((durationSeconds(m) ?? 0) >= CANDIDATE_MIN_SECONDS || summaryOf(m) !== null)
  )
    return "candidate";
  return "internal";
}

/**
 * The cockpit_fathom_meetings row: the worker's columns (sources.ts before 2a)
 * plus class, room and recorder_team. It always carries summary and the whole
 * raw, because makeDb.upsert never writes an omitted column and an old summary
 * would stay: for internal and sales, summary is null and raw keeps no
 * default_summary, action_items or highlights. raw never keeps the transcript.
 */
export function meetingRow(m: FathomMeeting, cls: MeetingClass, nowIso: string): Record<string, unknown> {
  const content = cls === "client" || cls === "candidate";
  const email = recorderEmail(m);
  return {
    recording_id: String(m?.recording_id),
    title: m?.title ?? m?.meeting_title ?? null,
    starts_at: startOf(m),
    ends_at: endOf(m),
    recorded_by_email: email || null,
    recorded_by_name: m?.recorded_by?.name ?? null,
    external: isExternal(m),
    invitees: m?.calendar_invitees ?? [],
    url: m?.url ?? null,
    share_url: m?.share_url ?? null,
    summary: content ? summaryOf(m) : null,
    raw: without(m, content ? ["transcript"] : ["transcript", ...CONTENT_KEYS]),
    updated_at: nowIso,
    class: cls,
    room: normalizeRoom(m?.meeting_url),
    recorder_team: m?.recorded_by?.team ?? null,
  };
}

/**
 * The cockpit_csm_calls row of a client or candidate recording before it is
 * matched: the worker's columns with no client yet (task_id, client_name,
 * match_method, match_confidence and linked_call_id null), kind from the title,
 * candidate for a candidate meeting, its room and no hints. The caller sets the
 * match block from exactMatch or matchMeeting (a booking the match names gives
 * linked_call_id and kind, contract 3.6), candidate false once a client is
 * set, the hints and raw_hash.
 */
export function callRowBase(m: FathomMeeting, cls: "client" | "candidate", nowIso: string): Record<string, unknown> {
  const email = recorderEmail(m);
  const title = m?.title ?? m?.meeting_title;
  return {
    source: "fathom",
    source_id: String(m?.recording_id),
    task_id: null,
    client_name: null,
    match_method: null,
    match_confidence: null,
    kind: titleKind(title),
    title: String(title ?? "Recorded call").slice(0, 300),
    starts_at: startOf(m),
    ends_at: m?.recording_end_time ?? null,
    status: "held",
    provider_status: "recorded",
    host_email: email || null,
    host_name: m?.recorded_by?.name ?? null,
    recording_url: m?.url ?? m?.share_url ?? null,
    summary: summaryOf(m),
    external_invitees: invitees(m)
      .filter(i => i?.is_external === true)
      .map(i => ({ email: i.email, name: i.name })),
    linked_call_id: null,
    candidate: cls === "candidate",
    room: normalizeRoom(m?.meeting_url),
    hints: [],
    updated_at: nowIso,
  };
}

/** Fathom's action items in one shape and in Fathom's order (no list, no items). */
export function actionItems(m: FathomMeeting): ActionItem[] {
  const list: unknown[] = Array.isArray(m?.action_items) ? m.action_items : [];
  const out: ActionItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const a = entry as FathomMeeting;
    const who: FathomMeeting = a.assignee && typeof a.assignee === "object" ? a.assignee : {};
    out.push({
      description: text(a.description) ?? "",
      assigneeEmail: text(who.email)?.toLowerCase() ?? null,
      assigneeName: text(who.name),
      assigneeTeam: text(who.team),
      seconds: hhmmssToSeconds(a.recording_timestamp),
      playbackUrl: text(a.recording_playback_url),
      completed: a.completed === true,
    });
  }
  return out;
}

/** The transcript as text, one `[timestamp] Speaker: text` line per entry (the worker's format before 2a). */
export function transcriptText(lines: unknown): string | undefined {
  if (!Array.isArray(lines) || !lines.length) return undefined;
  return lines
    .map((l: FathomMeeting) => `[${l?.timestamp ?? ""}] ${l?.speaker?.display_name ?? "Speaker"}: ${l?.text ?? ""}`)
    .join("\n");
}

/** Who spoke, by Fathom's display names: each name once (its first spelling), in order of first speech. */
export function speakers(lines: unknown): string[] {
  if (!Array.isArray(lines)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const raw = l?.speaker?.display_name;
    const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

// ---------------------------------------------------------------- internals

/** Fathom's summary text, or null when there is none (a blank one counts as none). */
function summaryOf(m: FathomMeeting): string | null {
  const s = m?.default_summary?.markdown_formatted;
  return typeof s === "string" && s.trim() ? s : null;
}

function invitees(m: FathomMeeting): FathomMeeting[] {
  return Array.isArray(m?.calendar_invitees) ? m.calendar_invitees : [];
}

/** Whether a calendar invitee is outside Mahara (Fathom's own flag on the invitee). */
function isExternal(m: FathomMeeting): boolean {
  return invitees(m).some(i => i?.is_external === true);
}

/** A copy of the meeting without the given keys. */
function without(m: FathomMeeting, keys: string[]): FathomMeeting {
  const out: FathomMeeting = {};
  for (const [k, v] of Object.entries(m ?? {})) if (!keys.includes(k)) out[k] = v;
  return out;
}

/** As match.ts titleKind (this file imports only callMatch.ts); fathomRules.test.ts holds the two equal. */
function titleKind(title: unknown): "onboarding" | "blueprint" | "launch" | "checkin" | "other" {
  const t = String(title ?? "").toLowerCase();
  if (/blueprint/.test(t)) return "blueprint";
  if (/launch/.test(t)) return "launch";
  if (/onboarding|kick.?off/.test(t)) return "onboarding";
  if (/check.?in|1-1|1:1|success/.test(t)) return "checkin";
  return "other";
}
