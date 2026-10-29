/**
 * The call's transcript as the drafts read it (docs/forms/STAGE2-CONTRACT.md 6.5).
 * Fathom's lines come back from the stored text (the worker's `[timestamp] Speaker:
 * text` format, fathomRules.ts transcriptText) or from Fathom itself in the same
 * format. Each line is labelled CSM (the recorder), Team (another active staff
 * member) or Client, so no name reaches a model, and numbered `L{n}` for the
 * models to cite. A cited line is turned back into its own words and its time
 * here, never by the model.
 */
import { hhmmssToSeconds } from "../../../hermes/csm-calls/fathomRules.ts";

export type Speaker = "CSM" | "Team" | "Client";
export type Entry = { stamp: string; at: number | null; speaker: string; text: string };
export type Line = Entry & { n: number; label: Speaker };
export type Staff = { name: string | null; email: string | null; role?: string | null };

/** At most this many lines go to a model (6.5). */
export const MAX_LINES = 3000;
const QUOTE_MAX = 200;
const ENTRY = /^\[([^\]]*)\]\s?([^:]*?):\s?(.*)$/;

/** Pause, cancel, stop or refund talk, in English and in Arabic as the clients say it. */
export const RISK_TALK =
  /\b(?:pause[ds]?|pausing|cancel(?:s|led|ling|lation)?|stop(?:s|ped|ping)?|refunds?)\b|إيقاف|ايقاف|نوقف|أوقف|اوقف|يوقف|توقف|نلغي|ألغي|الغي|إلغاء|الغاء|كنسل|استرجاع|استرداد|ريفند/i;

/** The transcript text, one entry per `[timestamp] Speaker: text` line; any other line belongs to the entry above it. */
export function parseTranscript(text: string | null | undefined): Entry[] {
  const out: Entry[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = ENTRY.exec(line);
    if (m) {
      const at = hhmmssToSeconds(m[1]);
      out.push({ stamp: at === null ? m[1].trim() : clock(at), at, speaker: m[2].trim() || "Speaker", text: m[3].trim() });
    } else if (out.length) out[out.length - 1].text = `${out[out.length - 1].text} ${line}`.trim();
  }
  return out;
}

const email = (s: unknown) => String(s ?? "").trim().toLowerCase();
const nameWords = (s: unknown) =>
  String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * The same person by name: two full names agree on their first two words; a lone
 * name agrees, letter for letter, with the other's first name.
 */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = nameWords(a);
  const y = nameWords(b);
  if (!x.length || !y.length) return false;
  if (x.length >= 2 && y.length >= 2) return x[0] === y[0] && x[1] === y[1];
  return x[0].length >= 2 && x[0] === y[0];
}

/**
 * Each entry with its number and its side: CSM when the speaker is the recorder
 * (the recorder's name on the staff list, else Fathom's), Team for any other
 * active staff member, Client for everyone else. At most MAX_LINES.
 */
export function labelLines(
  entries: Entry[],
  who: { recorderEmail: string | null; recorderName: string | null; staff: Staff[] },
): Line[] {
  const rec = email(who.recorderEmail);
  const recorder = (who.staff ?? []).find(s => rec && email(s.email) === rec)?.name ?? who.recorderName ?? null;
  const team = (who.staff ?? []).filter(s => s?.name && !(rec && email(s.email) === rec)).map(s => String(s.name));
  const seen = new Map<string, Speaker>();
  const labelOf = (speaker: string): Speaker => {
    const known = seen.get(speaker);
    if (known) return known;
    const label: Speaker = recorder && sameName(speaker, recorder) ? "CSM" : team.some(n => sameName(speaker, n)) ? "Team" : "Client";
    seen.set(speaker, label);
    return label;
  };
  return entries.slice(0, MAX_LINES).map((e, i) => ({ ...e, n: i + 1, label: labelOf(e.speaker) }));
}

/** The lines as a model reads them: `L{n} [HH:MM:SS] {CSM|Team|Client}: {text}`. */
export function numbered(lines: Line[]): string {
  return lines.map(l => `L${l.n} [${l.stamp}] ${l.label}: ${l.text}`).join("\n");
}

/** An assignee's side from the transcript: a Client speaker's name is theirs, a CSM or Team speaker's ours, else unknown. */
export function sideOfNameFrom(lines: Line[]): (name: string) => "we" | "they" | null {
  const speakers = new Map<string, Speaker>();
  for (const l of lines) if (!speakers.has(l.speaker) && l.speaker !== "Speaker") speakers.set(l.speaker, l.label);
  return name => {
    for (const [speaker, label] of speakers) if (sameName(name, speaker)) return label === "Client" ? "they" : "we";
    return null;
  };
}

/** The line a model cited, or undefined when there is no such line. */
export function lineAt(lines: Line[], n: unknown): Line | undefined {
  const i = typeof n === "number" && Number.isInteger(n) ? n : typeof n === "string" && /^L?\d+$/i.test(n.trim()) ? Number(n.trim().replace(/^L/i, "")) : NaN;
  const line = Number.isInteger(i) && i >= 1 ? lines[i - 1] : undefined;
  return line && line.n === i ? line : undefined;
}

/** A line's own words as the quote, cut at a word to 200 characters. */
export function quoteOf(line: Line): string {
  return cut(line.text, QUOTE_MAX);
}

/** The first Client line with pause, cancel, stop or refund talk. */
export function riskTalk(lines: Line[]): Line | undefined {
  return lines.find(l => l.label === "Client" && RISK_TALK.test(l.text));
}

/** Seconds as HH:MM:SS. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}

/** One line of text, cut at a word to the limit when longer (never inside a character). */
export function cut(s: unknown, limit: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= limit) return t;
  let out = "";
  for (const ch of t) {
    if (out.length + ch.length > limit) break;
    out += ch;
  }
  const space = out.lastIndexOf(" ");
  return (space >= out.length - 60 && space > 0 ? out.slice(0, space) : out).trim();
}

/** A block of text with its line breaks kept (at most one blank line in a row), cut at a word to the limit. */
export function cutBlock(s: unknown, limit: number): string {
  const t = String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(l => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length <= limit) return t;
  let out = "";
  for (const ch of t) {
    if (out.length + ch.length > limit) break;
    out += ch;
  }
  const at = Math.max(out.lastIndexOf(" "), out.lastIndexOf("\n"));
  return (at >= out.length - 60 && at > 0 ? out.slice(0, at) : out).trim();
}
