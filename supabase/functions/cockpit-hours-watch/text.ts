/**
 * Every sentence Hubstaff watch posts to Slack (SPEC.md "Slack"), and the
 * Kuwait clock it speaks in. Pure: no I/O. Times are wall clock in Kuwait
 * (UTC+3 all year, no daylight saving), durations read "35 min" or
 * "1 h 50 min". Plain text with Slack's own markup only (*bold*, <url|label>);
 * no emoji. Names and notes are escaped so a stray "<" or "&" can never turn
 * into a link or a mention.
 */

export const WATCH_URL = "https://cockpit.maharamedia.com/ceo?tab=management#hubstaff-watch";
const KUWAIT_MS = 3 * 3600_000;

const ms = (t: string | number | Date) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));

/** HH:MM in Kuwait. */
export function kuwaitTime(t: string | number | Date): string {
  return new Date(ms(t) + KUWAIT_MS).toISOString().slice(11, 16);
}

/** The Kuwait calendar day, YYYY-MM-DD. */
export function kuwaitDay(t: string | number | Date): string {
  return new Date(ms(t) + KUWAIT_MS).toISOString().slice(0, 10);
}

/** Minutes between two instants, rounded, never below zero. */
export function minutesBetween(from: string | number | Date, to: string | number | Date): number {
  return Math.max(0, Math.round((ms(to) - ms(from)) / 60_000));
}

/** "35 min", "2 h", "1 h 50 min". */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Slack's three control characters. */
export function slackEscape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** The role as the sentence says it: lower case, "call centre" spelt the house way. */
export function roleWords(role: string | null | undefined): string {
  const r = (role ?? "").trim().replace(/\s+/g, " ").replace(/call\s*cent(er|re)/i, "call centre").toLowerCase();
  return r || "no role set";
}

const who = (name: string, role: string | null | undefined) => `*${slackEscape(name.trim() || "Someone")}* (${slackEscape(roleWords(role))})`;
const link = (label: string) => `<${WATCH_URL}|${label}>`;
const noFullStop = (s: string) => s.trim().replace(/[.\s]+$/, "");
/** A percentage as a sentence says it: rounded down, so 9.7% under a 10% floor reads 9%. */
export const pctWords = (pct: number) => `${Math.max(0, Math.floor(pct + 1e-9))}%`;

// ------------------------------------------------------------------ opening

export function notTrackingText(p: { name: string; role: string | null; since: string; shiftStart: string; shiftEnd: string; now: string }): string {
  const into = duration(minutesBetween(p.shiftStart, p.now));
  return `${who(p.name, p.role)} has not had Hubstaff on since ${kuwaitTime(p.since)}, ${into} into the ${kuwaitTime(p.shiftStart)} to ${kuwaitTime(p.shiftEnd)} shift. ${link("Open Hubstaff watch")}`;
}

export function noAccountText(p: { name: string; role: string | null; invited: boolean }): string {
  const why = p.invited ? "invite not accepted" : "no account linked";
  return `${who(p.name, p.role)} is on shift but is not in Hubstaff yet (${why}). ${link("Open Hubstaff watch")}`;
}

export function notWorkText(p: { name: string; role: string | null; count: number; total: number; labels: string[] }): string {
  const labels = p.labels.map(l => slackEscape(noFullStop(l))).filter(Boolean);
  const what = labels.length ? ` (${labels.join(", ")})` : "";
  // One screenshot: "The last screenshot does not look like work"; more: "2 of the last 3 screenshots do not look like work".
  const lead = p.total <= 1 ? "The last screenshot does" : `${p.count} of the last ${p.total} screenshots ${p.count === 1 ? "does" : "do"}`;
  return `${who(p.name, p.role)}: ${lead} not look like work${what}. ${link("See the screenshots")}`;
}

export function idleText(p: { name: string; role: string | null; since: string; pct: number }): string {
  return `${who(p.name, p.role)}: Hubstaff has been running since ${kuwaitTime(p.since)} with ${pctWords(p.pct)} keyboard and mouse activity. ${link("Open Hubstaff watch")}`;
}

export function sourceText(note: string): string {
  return `Hubstaff watch cannot read Hubstaff: ${slackEscape(noFullStop(note) || "no answer")}. Nobody is being watched until it can. ${link("Open Hubstaff watch")}`;
}

// ---------------------------------------------------------------- resolving

export function backOnText(p: { at: string; since: string }): string {
  return `Back on Hubstaff at ${kuwaitTime(p.at)} (${duration(minutesBetween(p.since, p.at))} off).`;
}

export function shiftEndedOffText(p: { since: string; shiftEnd: string }): string {
  return `Shift ended. Hubstaff was off from ${kuwaitTime(p.since)} to ${kuwaitTime(p.shiftEnd)} (${duration(minutesBetween(p.since, p.shiftEnd))}).`;
}

/** The shift ended on an alert that is not about Hubstaff being off. */
export function shiftEndedText(p: { shiftEnd: string }): string {
  return `Shift ended at ${kuwaitTime(p.shiftEnd)}.`;
}

export function linkedText(p: { at: string }): string {
  return `Now in Hubstaff (linked by ${kuwaitTime(p.at)}).`;
}

export function workAgainText(p: { lastNotWorkAt: string }): string {
  return `No more screenshots off work since ${kuwaitTime(p.lastNotWorkAt)}.`;
}

export function activeAgainText(p: { floorPct: number; at: string }): string {
  return `Activity back above ${pctWords(p.floorPct)} at ${kuwaitTime(p.at)}.`;
}

/** The idle window holds under 10 minutes of keyboard-and-mouse time (the timer stopped, or phone time only). */
export function idleUnjudgedText(p: { at: string }): string {
  return `Too little time on the computer to judge activity at ${kuwaitTime(p.at)}.`;
}

export function sourceBackText(): string {
  return "Hubstaff can be read again.";
}

export function notWatchedText(): string {
  return "No longer watched: this person no longer has to track time.";
}
