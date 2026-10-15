/**
 * Reading one Slack message in an EOD channel (pure, for the tests).
 *
 * The shapes on 2026-10-15, all from the five EOD channels:
 *   Make (Admin Bot "info"):   "*VIDEO EDITOR EOD*\n*Date - 13-10-2026*\n\n*Name - Ali*\nSubmitted by: <@U0C69400F1U>"
 *   Make, CSR form:            "*CSR EOD:rocket:*\n*Date - 14-10-2026*\n\n*Name:* Daniya\nSubmitted by: <@U0ANNBCT3B3>"
 *   Make, unclosed bold:       "*SYSTEMS MANAGER EOD*\n*Date - 14-10-2026\n\n*Name - Muhammed Burhan*"
 *   The cockpit outbox:        "*SALES REP EOD*\n*Date - 2026-10-14*\n\n*Name - Ahmed Abushaiba*\nSubmitted by: <@U0B665Z7WCQ>"
 *   An outbox post with no id: "Submitted by: Ahmed Abushaiba (no Slack id on their cockpit seat)"
 *   A test:                    "Videos completed today ... - [TEST SUBMISSION] 0 - test only"
 *   A person's own message:    poster = their Slack id, no bot_id
 * Make splits a long EOD into two messages; the second has no header and no
 * name, so it credits nobody and is not counted.
 */

/** One message as conversations.history returns it: only the fields the radar reads. */
export type SlackMessage = {
  ts?: unknown;
  user?: unknown;
  bot_id?: unknown;
  subtype?: unknown;
  text?: unknown;
  thread_ts?: unknown;
};

export type Post = {
  channel: string;
  ts: string;
  /** When Slack received it, epoch ms. */
  at: number;
  /** The Slack id of a person who posted it themselves; null when a bot or an app posted it. */
  poster: string | null;
  /** The words before "EOD" on the first line, upper case ("VIDEO EDITOR", "CSR"), or null. */
  header: string | null;
  /** The Date line's value as written ("13-10-2026", "2026-10-14"), or null. */
  dateLine: string | null;
  /** The Name line's value ("Ali", "rasem abdel all"), or null. */
  nameLine: string | null;
  /** The Slack id in "Submitted by: <@U...>", or null. */
  submittedBy: string | null;
  /** "Submitted by: Ahmed Abushaiba (...)" with no id: the name, or null. */
  submittedByText: string | null;
  test: boolean;
  /** Looks like an EOD (a header, a Date, Name or Submitted by line, or 40 words or more). */
  eodLike: boolean;
  words: number;
  /** The old radar's "lazy" rule as a note (never a strike), or null. */
  quality: string | null;
};

/** Subtypes that are a person's or an app's message; every other subtype (joins, topic, pins) is not an EOD. */
const MESSAGE_SUBTYPES = new Set(["bot_message", "thread_broadcast", "file_share"]);
const SLACK_ID = /^[UW][A-Z0-9]{8,12}$/;
const TS = /^[0-9]{9,11}\.[0-9]{6}$/;

/** Slack's three escapes put back. */
export function unescapeSlack(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** A line without its bold, italic and emoji marks: "*Date - 13-10-2026" -> "Date - 13-10-2026". */
function bare(line: string): string {
  return line
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const HEADER = /^(.*?)\bEOD\b/i;
const DATE = /^date\s*[-:–]\s*([0-9]{1,4}[-/.][0-9]{1,2}[-/.][0-9]{1,4}|[0-9]{8})\s*$/i;
const NAME = /^name\s*[-:–]\s*(.+?)\s*$/i;
const SUBMITTED_ID = /submitted\s*by\s*[-:]?\s*<@([UW][A-Z0-9]{8,12})(?:\|[^>]*)?>/i;
const SUBMITTED_TEXT = /^submitted\s*by\s*[-:]?\s*([^<(\n]{2,80})/i;
const TEST = /\[\s*test(\s+submission)?\s*\]|\btest\s+submission\b/i;
const META = /^(date|name|submitted\s*by)\b/i;

/** The words a person wrote: links as their label, mentions and marks out, the header and the Date, Name and Submitted by lines left out. */
export function countWords(lines: string[]): number {
  let n = 0;
  for (const raw of lines) {
    const line = bare(raw.replace(/<(?:https?:[^|>]*)\|([^>]*)>/g, "$1").replace(/<[^>]*>/g, " "));
    if (!line || META.test(line) || HEADER.test(line)) continue;
    for (const w of line.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(w)) n++;
  }
  return n;
}

const WBT = /\b(wins?|blockers?|tomorrow)\b/i;
const SEP = /[-:?–]/;
const BLANK = /^[\s.\-–—_*,:;!?]*$/;
/** A bold heading on its own ("*BLOCKERS*") or another bold question ("*Wins:* ."). */
const HEADING = /^\*[^*]+\*\s*:?\s*$|^\*[^*]+:\*/;

/**
 * Whether any wins, blockers or tomorrow question has an answer. A question
 * with a separator ("Wins From Today - --", "*Wins:* .") is answered on its
 * own line; a heading ("*BLOCKERS*", "*TOMORROW'S PLAN*") by the first line
 * under it that is not another heading. "." "-" "--" and "----" are blank.
 */
export function hasWinsBlockersOrPlan(lines: string[]): boolean {
  for (let i = 0; i < lines.length; i++) {
    const line = bare(lines[i]);
    const hit = WBT.exec(line);
    if (!hit) continue;
    const tail = line.slice(hit.index + hit[0].length);
    const sep = SEP.exec(tail);
    if (sep) {
      const answer = tail.slice(sep.index + 1).trim();
      if (answer && !BLANK.test(answer)) return true;
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) continue;
      if (!HEADING.test(next) && !BLANK.test(bare(next))) return true;
      break;
    }
  }
  return false;
}

/** "Under 50 words (40)", "No wins, blockers or plan for tomorrow", both, or null. */
export function qualityNote(lines: string[], words: number): string | null {
  const notes: string[] = [];
  if (words < 50) notes.push(`Under 50 words (${words})`);
  if (!hasWinsBlockersOrPlan(lines)) notes.push("No wins, blockers or plan for tomorrow");
  return notes.length ? notes.join("; ") : null;
}

/** One message read; null when it is not a message a person or an app wrote (a join, a pin, a thread reply). */
export function parsePost(channel: string, m: SlackMessage): Post | null {
  const ts = typeof m.ts === "string" && TS.test(m.ts) ? m.ts : null;
  if (!ts) return null;
  const subtype = typeof m.subtype === "string" ? m.subtype : null;
  if (subtype && !MESSAGE_SUBTYPES.has(subtype)) return null;
  if (typeof m.thread_ts === "string" && m.thread_ts !== ts && subtype !== "thread_broadcast") return null;
  const text = unescapeSlack(typeof m.text === "string" ? m.text : "");
  const lines = text.split("\n");
  const bot = typeof m.bot_id === "string" || subtype === "bot_message";
  const user = typeof m.user === "string" && SLACK_ID.test(m.user) ? m.user : null;

  let header: string | null = null;
  const first = lines.map(bare).find(l => l.length > 0) ?? "";
  const h = HEADER.exec(first);
  if (h) header = h[1].replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().toUpperCase() || null;

  let dateLine: string | null = null;
  let nameLine: string | null = null;
  let submittedByText: string | null = null;
  for (const raw of lines) {
    const line = bare(raw);
    if (!dateLine) dateLine = DATE.exec(line)?.[1] ?? null;
    if (!nameLine) {
      const n = NAME.exec(line)?.[1]?.trim();
      if (n && !/^<@/.test(n)) nameLine = n.slice(0, 80);
    }
    if (!submittedByText) {
      const s = SUBMITTED_TEXT.exec(line)?.[1]?.trim();
      if (s) submittedByText = s.slice(0, 80);
    }
  }
  const submittedBy = SUBMITTED_ID.exec(text)?.[1] ?? null;
  if (submittedBy) submittedByText = null;
  const words = countWords(lines);
  const eodLike = Boolean(header || dateLine || nameLine || submittedBy || submittedByText) || words >= 40;
  return {
    channel,
    ts,
    at: Math.round(Number(ts) * 1000),
    poster: bot ? null : user,
    header,
    dateLine,
    nameLine,
    submittedBy,
    submittedByText,
    test: TEST.test(text),
    eodLike,
    words,
    quality: eodLike ? qualityNote(lines, words) : null,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

function realDay(y: number, m: number, d: number): string | null {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * The days a Date line can mean, most likely first: "2026-10-14" is that day;
 * "13-10-2026" is day-month-year (seven forms, decision 2026-07-22), and when
 * both parts are 12 or under, month-day-year second (the setter's optional
 * month-first field); "13102026" is DDMMYYYY.
 */
export function dateCandidates(raw: string | null): string[] {
  if (!raw) return [];
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw);
  if (m) {
    const d = realDay(+m[1], +m[2], +m[3]);
    return d ? [d] : [];
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(raw) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(raw);
  if (!m) return [];
  const out = [realDay(+m[3], +m[2], +m[1]), realDay(+m[3], +m[1], +m[2])].filter((d): d is string => d !== null);
  return [...new Set(out)];
}
