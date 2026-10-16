/**
 * EOD Radar's rules (pure, for the tests). The old radar's, kept: Saturday to
 * Thursday, Friday off; late after 22:00 Kuwait on the EOD day; missed only
 * after 23:00, and only when every EOD channel was read and the person can be
 * found; "lazy" is a quality note, never a strike.
 *
 * The EOD day of a post: its Date line when that is a real day no later than
 * the post's working day and at most 14 days before it, else the working day
 * of the post (Kuwait time minus 4 hours, cockpit_eod_working_day's rule).
 * A post whose day is a Friday counts for the Thursday before it.
 *
 * Who a post credits, in order:
 *   1. the cockpit outbox row Slack has under that ts (cockpit_outbox): its
 *      person, its day, and the earlier of filing and posting. Matched by the
 *      ts alone: the CSM's outbox rows name their channel ("#eods-csms"), not
 *      its id, so a channel check would miss them;
 *   2. the "Submitted by: <@id>" line (submitted_by), unless the Name line
 *      names someone else on the radar, when the Name line wins (Make fills
 *      Submitted by from the name, and its fallback id can be a person who
 *      has left: Rasem's 10 Oct EOD carries Saleh's id);
 *   3. the Name line (name_line), see match.ts;
 *   4. the person who posted it themselves (poster): a form (a Date, Name or
 *      Submitted by line) in any EOD channel, a plain message only in their
 *      own (a manager's note in another team's channel is not their EOD).
 * Test submissions credit nobody.
 */
import { type Person, matchName } from "./match.ts";
import { dateCandidates, type Post } from "./parse.ts";

export const KUWAIT_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** The Kuwait calendar day of an instant. */
export function kuwaitDayOf(ms: number): string {
  return new Date(ms + KUWAIT_MS).toISOString().slice(0, 10);
}

/** The EOD working day of an instant: Kuwait time minus 4 hours. */
export function workingDayOf(ms: number): string {
  return new Date(ms + KUWAIT_MS - 4 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export const isFriday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() === 5;

/** Epoch ms of a Kuwait wall-clock time ("22:00") on a day. */
export function kuwaitAt(day: string, hhmm: string): number {
  return Date.parse(`${day}T${hhmm}:00Z`) - KUWAIT_MS;
}

/** Every day from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Wed 14 Oct". */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** "21:47" in Kuwait, with the day when it is not `day`: "Thu 15 Oct, 00:07". */
export function whenLabel(ms: number, day: string): string {
  const t = new Date(ms + KUWAIT_MS);
  const hhmm = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
  return kuwaitDayOf(ms) === day ? hhmm : `${dayLabel(kuwaitDayOf(ms))}, ${hhmm}`;
}
/** "2 h 7 min", "45 min", "3 days 2 h". */
export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} ${d === 1 ? "day" : "days"} ${rh} h` : `${d} ${d === 1 ? "day" : "days"}`;
}

/** Friday's post is Thursday's EOD (Friday is off). */
const workingOrThursday = (day: string) => (isFriday(day) ? addDays(day, -1) : day);

export type EodDay = { day: string; from: "date_line" | "posted"; ignoredDate: string | null };

/** The EOD day of a post (see the file comment). */
export function eodDayOf(post: Pick<Post, "at" | "dateLine">): EodDay {
  const posted = workingDayOf(post.at);
  const oldest = addDays(posted, -14);
  const fit = dateCandidates(post.dateLine).find(d => d <= posted && d >= oldest);
  if (fit) return { day: workingOrThursday(fit), from: "date_line", ignoredDate: null };
  return { day: workingOrThursday(posted), from: "posted", ignoredDate: post.dateLine };
}

export type CreditedBy = "poster" | "submitted_by" | "name_line" | "cockpit_outbox";

export type OutboxRow = {
  id: number;
  role: string;
  day: string;
  person: string;
  slackId: string | null;
  channel: string;
  slackTs: string | null;
  /** When the person filed it in the cockpit, ISO. */
  createdAt: string;
};

export type Credit = {
  personId: number;
  day: string;
  /** The earliest filing or posting, epoch ms. */
  at: number;
  ts: string | null;
  channel: string | null;
  by: CreditedBy;
  words: number | null;
  quality: string | null;
  posts: number;
  note: string | null;
};

export type Unmatched = { channel: string; ts: string; name: string | null; reason: "ambiguous" | "unknown" };

const key = (personId: number, day: string) => `${personId}:${day}`;

const CHANNEL_ID = /^[CG][A-Z0-9]{8,12}$/;
const SLACK_TS = /^[0-9]{9,11}\.[0-9]{6}$/;
/** A Slack channel id, or null for anything else ("#eods-csms" is a name): the table takes ids only. */
export const channelIdOrNull = (c: string | null | undefined): string | null => (c && CHANNEL_ID.test(c) ? c : null);
/** A Slack ts, or null. */
const tsOrNull = (t: string | null | undefined): string | null => (t && SLACK_TS.test(t) ? t : null);

/** "media_buyer" -> "MEDIA BUYER", "sales_closer" -> "SALES CLOSER": the outbox role as a form header. */
const outboxHeader = (role: string) => role.replace(/_/g, " ").toUpperCase();

/** The person an outbox row is: its Slack id, else its name in its channel and role. */
export function outboxPerson(row: OutboxRow, people: Person[], bySlack: Map<string, Person>): Person | null {
  if (row.slackId && bySlack.has(row.slackId)) return bySlack.get(row.slackId) ?? null;
  const m = matchName(people, row.person.replace(/<[^>]*>/g, " "), { channel: row.channel, header: outboxHeader(row.role) });
  return m.kind === "one" ? m.person : null;
}

/** Keep the earliest filing for a person's day; count every post. */
function merge(credits: Map<string, Credit>, c: Credit) {
  const k = key(c.personId, c.day);
  const old = credits.get(k);
  if (!old) {
    credits.set(k, c);
    return;
  }
  const posts = old.posts + c.posts;
  credits.set(k, c.at < old.at ? { ...c, posts } : { ...old, posts });
}

/**
 * Every credit in the window, by person and day, and the EOD posts that named
 * nobody on the radar. Posts outside [from, to] by their EOD day are left out.
 */
export function creditPosts(input: { posts: Post[]; people: Person[]; outbox: OutboxRow[]; from: string; to: string }): {
  credits: Map<string, Credit>;
  unmatched: Unmatched[];
  tests: number;
} {
  const { posts, people, outbox, from, to } = input;
  const bySlack = new Map<string, Person>();
  for (const p of people) if (p.slackUserId) bySlack.set(p.slackUserId, p);
  // By ts alone; a row that names a channel id must name the post's channel too.
  const outboxByTs = new Map<string, OutboxRow>();
  for (const o of outbox) if (o.slackTs && !outboxByTs.has(o.slackTs)) outboxByTs.set(o.slackTs, o);
  const credits = new Map<string, Credit>();
  const unmatched: Unmatched[] = [];
  const usedOutbox = new Set<number>();
  let tests = 0;
  const inWindow = (d: string) => d >= from && d <= to;

  for (const post of posts) {
    if (post.test) {
      tests++;
      continue;
    }
    const byTs = outboxByTs.get(post.ts);
    const row = byTs && (!channelIdOrNull(byTs.channel) || byTs.channel === post.channel) ? byTs : undefined;
    if (row) {
      usedOutbox.add(row.id);
      const person = outboxPerson(row, people, bySlack);
      const filed = Date.parse(row.createdAt);
      if (person && inWindow(row.day))
        merge(credits, {
          personId: person.personId, day: row.day, at: Number.isFinite(filed) ? Math.min(filed, post.at) : post.at,
          ts: post.ts, channel: post.channel, by: "cockpit_outbox", words: post.words, quality: post.quality, posts: 1,
          note: Number.isFinite(filed) && filed < post.at - 60_000 ? `Filed in the cockpit ${whenLabel(filed, row.day)}; Slack had it ${whenLabel(post.at, row.day)}` : null,
        });
      continue;
    }
    if (!post.eodLike) continue;
    const sb = post.submittedBy ? (bySlack.get(post.submittedBy) ?? null) : null;
    const nameText = post.nameLine ?? post.submittedByText;
    const nl = matchName(people, nameText, { channel: post.channel, header: post.header });
    const po = post.poster ? (bySlack.get(post.poster) ?? null) : null;
    let person: Person | null = null;
    let by: CreditedBy = "poster";
    let note: string | null = null;
    if (sb && nl.kind === "one" && nl.person.personId !== sb.personId) {
      person = nl.person;
      by = "name_line";
      note = `Submitted by named ${sb.name}; credited to the Name line`;
    } else if (sb) {
      person = sb;
      by = "submitted_by";
    } else if (nl.kind === "one") {
      person = nl.person;
      by = "name_line";
    } else if (po && (post.form || post.channel === po.channel) && (nl.kind === "none" || nl.people.some(p => p.personId === po.personId))) {
      // Their own message: a name that fits nobody, or fits them among others, is still theirs.
      person = po;
      by = "poster";
      if (nl.kind === "none" && nameText) note = `Name line "${nameText.slice(0, 40)}" fits nobody; credited to who posted it`;
    }
    if (!person) {
      if (nameText || post.header)
        unmatched.push({ channel: post.channel, ts: post.ts, name: nameText ? nameText.slice(0, 60) : null, reason: nl.kind === "many" ? "ambiguous" : "unknown" });
      continue;
    }
    const d = eodDayOf(post);
    if (!inWindow(d.day)) continue;
    const ignored = d.ignoredDate ? `Date line ${d.ignoredDate} did not fit; counted for the day it was posted` : null;
    merge(credits, {
      personId: person.personId, day: d.day, at: post.at, ts: post.ts, channel: post.channel, by,
      words: post.words, quality: post.quality, posts: 1, note: [note, ignored].filter(Boolean).join(". ") || null,
    });
  }

  // A sent cockpit EOD Slack's history did not show (its channel was not read): the outbox alone credits it.
  for (const row of outbox) {
    if (usedOutbox.has(row.id) || !inWindow(row.day)) continue;
    const person = outboxPerson(row, people, bySlack);
    const filed = Date.parse(row.createdAt);
    if (!person || !Number.isFinite(filed)) continue;
    merge(credits, {
      personId: person.personId, day: row.day, at: filed, ts: tsOrNull(row.slackTs), channel: channelIdOrNull(row.channel), by: "cockpit_outbox",
      words: null, quality: null, posts: 1, note: "From the cockpit's sent EODs; the post itself was not read in Slack",
    });
  }
  return { credits, unmatched, tests };
}

export type OffReason = "friday" | "not_started" | "ended" | "paused" | "holiday";
export type DayInfo = { day: string; off: OffReason | null; offNote: string | null; leave: string | null };
export type Status = "on_time" | "late" | "missed" | "pending" | "leave" | "off" | "not_read";

export type Row = {
  personId: number;
  day: string;
  channel: string | null;
  status: Status;
  postedAt: string | null;
  slackTs: string | null;
  postedChannel: string | null;
  lateMinutes: number | null;
  creditedBy: CreditedBy | null;
  words: number | null;
  quality: string | null;
  note: string | null;
  posts: number;
};

export type Unread = { id: string; name: string; error: string };
export type Settings = { lateAt: string; closeoutAt: string };

const OFF_TEXT: Record<OffReason, string> = {
  friday: "Friday, no EOD due",
  not_started: "Before they joined the roster",
  ended: "After their last day",
  paused: "Paused on the roster",
  holiday: "Public holiday",
};

/** Why a refusal stops a read, in words a person can act on. */
export function unreadReason(error: string): string {
  if (error === "missing_scope") return "the Slack app needs the groups:history scope";
  if (error === "not_in_channel" || error === "channel_not_found") return "the bot is not in the channel";
  if (["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive"].includes(error)) return "the Slack token was refused";
  if (error === "no_token") return "SLACK_BOT_TOKEN is not set on eod-radar";
  if (error === "ratelimited") return "Slack asked the radar to slow down";
  if (error === "no_answer") return "Slack did not answer";
  return `Slack refused the read (${error.slice(0, 40)})`;
}

const channels = (unread: Unread[]) => unread.map(u => `#${u.name}`).join(", ");

/** One person's day: credited, off, on leave, pending, not read or missed. */
export function decideDay(a: { person: Person; info: DayInfo; credit: Credit | undefined; now: number; settings: Settings; unread: Unread[] }): Row {
  const { person, info, credit, now, settings, unread } = a;
  const base = {
    personId: person.personId, day: info.day, channel: channelIdOrNull(person.channel), postedAt: null, slackTs: null, postedChannel: null,
    lateMinutes: null, creditedBy: null, words: null, quality: null, posts: 0,
  };
  if (credit) {
    const cutoff = kuwaitAt(info.day, settings.lateAt);
    const late = credit.at > cutoff;
    const away = info.off ? `Filed on a day off (${OFF_TEXT[info.off].toLowerCase()})` : info.leave ? "Filed while on leave" : null;
    return {
      ...base, status: late ? "late" : "on_time", postedAt: new Date(credit.at).toISOString(), slackTs: tsOrNull(credit.ts),
      postedChannel: channelIdOrNull(credit.channel), lateMinutes: late ? Math.max(1, Math.ceil((credit.at - cutoff) / 60_000)) : null,
      creditedBy: credit.by, words: credit.words, quality: credit.quality, posts: credit.posts,
      note: [credit.note, away].filter(Boolean).join(". ").slice(0, 300) || null,
    };
  }
  if (info.off) return { ...base, status: "off", note: info.off === "holiday" && info.offNote ? `Public holiday: ${info.offNote}` : OFF_TEXT[info.off] };
  if (info.leave) return { ...base, status: "leave", note: `On leave: ${info.leave}`.slice(0, 300) };
  if (now < kuwaitAt(info.day, settings.closeoutAt))
    return { ...base, status: "pending", note: now < kuwaitAt(info.day, settings.lateAt) ? `Due by ${settings.lateAt}` : `Not in by ${settings.lateAt}; missed at ${settings.closeoutAt} if nothing comes` };
  if (unread.length)
    return { ...base, status: "not_read", note: `Could not read ${channels(unread)} (${unreadReason(unread[0].error)}), so this day is not counted`.slice(0, 300) };
  if (!person.slackUserId)
    return { ...base, status: "not_read", note: `No Slack id for ${person.name}, so only posts with their Name line can be found. Add their email on the roster` };
  return { ...base, status: "missed", note: `No EOD in #${person.channelName ?? "their channel"} or the other EOD channels by ${settings.closeoutAt}` };
}

/**
 * The closeout post for a day: "EOD Radar, Wed 14 Oct: 6 on time, 1 late,
 * 2 missed (Ali, Lama Harb), 1 on leave." plus a line for each kind of day
 * that could not be counted. Null when nobody owed an EOD that day.
 */
export function digestText(day: string, rows: Row[], people: Person[], unread: Unread[]): string | null {
  const today = rows.filter(r => r.day === day);
  const name = new Map(people.map(p => [p.personId, p.name]));
  const of = (s: Status) => today.filter(r => r.status === s);
  const owed = today.filter(r => r.status !== "off");
  if (!owed.length) return null;
  const missed = of("missed").map(r => name.get(r.personId) ?? `#${r.personId}`);
  const lines = [
    `EOD Radar, ${dayLabel(day)}: ${of("on_time").length} on time, ${of("late").length} late, ${missed.length} missed${missed.length ? ` (${missed.join(", ")})` : ""}, ${of("leave").length} on leave.`,
  ];
  const notRead = of("not_read");
  if (notRead.length && unread.length)
    lines.push(`Could not read ${channels(unread)} (${unreadReason(unread[0].error)}), so ${notRead.length} ${notRead.length === 1 ? "person is" : "people are"} not counted.`);
  else if (notRead.length)
    lines.push(`Not counted: ${notRead.map(r => name.get(r.personId) ?? `#${r.personId}`).join(", ")} (no Slack id on the roster).`);
  const pending = of("pending");
  if (pending.length) lines.push(`Still open: ${pending.map(r => name.get(r.personId) ?? `#${r.personId}`).join(", ")}.`);
  return lines.join("\n");
}
