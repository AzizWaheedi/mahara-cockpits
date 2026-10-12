import {
  answerText,
  CALL_NAMES,
  isStale,
  SOURCE_NAMES,
  type SourceHealth,
  type Timeline,
  type TimelineCall,
  type TimelineForm,
} from "./csmCalls";

/**
 * The client page's "Before the call" brief: every source about one client,
 * cut down to short lines the CSM reads in a minute. Nothing here is
 * invented. Each line is a sentence or a bullet lifted from a source (the
 * call summary, the 1-1 form, the ClickUp card, Meta's activity log, the
 * team's EODs, the onboarding and kickoff forms) or a rule over those
 * sources, and it carries where it came from and when. Missing is never
 * zero: a source that is behind or empty says so.
 *
 * The rules were tuned on every client's live data on 12 Oct 2026 (three
 * reviews over 53 clients): stopped clients get why they stopped instead of
 * nags, an angry client or a change the client made themselves comes first,
 * an on/off switch is never a talking point, and a loose end the timeline
 * contradicts is dropped.
 */

type Row = Record<string, any>;

export type Digest = {
  kind: string;
  at: number | null;
  by?: string | null;
  summary?: string | null;
  nextSteps: string[];
  risks: string[];
  clientRequests: string[];
  dos: string[];
  donts: string[];
};

export type BriefLine = {
  /** A short label shown before the text, kept apart for Arabic answers. */
  label?: string;
  text: string;
  /** Where it came from, e.g. "Fathom", "1-1 form", "ClickUp card". */
  source: string;
  /** When, as a day ("11 Oct") already formatted for Kuwait. */
  day?: string;
  /** A line that needs attention, shown with the warning dot. */
  risk?: boolean;
  /** A link to the source itself, e.g. a recording. */
  href?: string;
};

export type Brief = {
  clientName: string;
  /** Live, onboarding, paused or stopped: decides what the brief says. */
  mode: "live" | "onboarding" | "paused" | "stopped";
  /** One sentence instead of the sections, for a stopped client with no records. */
  quiet?: string;
  lastCall?: { day: string; kind: string; ago: number };
  nextCall?: { when: string; kind: string };
  defcon?: { value: string; day: string; risk: boolean; old: boolean };
  priority?: string;
  /** Proactive: what to raise or check, most important first. */
  raise: BriefLine[];
  /** The last call's main points. */
  call: { lines: BriefLine[]; empty?: string; heading: string };
  /** What was agreed: ours and theirs, or the call's own steps by owner. */
  promises: {
    ours: BriefLine[];
    theirs: BriefLine[];
    /** Next steps from the call summary, labelled with who owns each. */
    steps: BriefLine[];
    open: BriefLine[];
    from?: string;
    empty?: string;
  };
  /** What happened since the last call. */
  since: {
    heading: string;
    changes: BriefLine[];
    notes: BriefLine[];
    team: BriefLine[];
    changeTotal: number;
    /** What the client wrote on WhatsApp in the window, newest first. */
    chats: BriefLine[];
    capped?: string;
    stale?: string;
    empty?: string;
  };
  /** Who they are, from the kickoff and onboarding forms. */
  who: BriefLine[];
  /** One plain sentence per source that is behind or never synced. */
  gaps: string[];
};

export type BriefInput = {
  now: number;
  client: Row;
  timeline: Timeline | null;
  digests: Digest[] | null;
  /** The constraint ranking for the client, when the numbers are loaded. */
  diagnosis?: {
    top?: { title: string; fixes?: string[] };
    watch?: { title: string; fixes?: string[] }[];
  } | null;
  /** Every other client's name, so a team roll-up keeps only this client's part. */
  otherClients?: string[];
  /** The team's Meta users; a change by anyone else was made by the client. */
  teamActors?: string[];
  /** The client's linked WhatsApp chats (cockpit_csm_client_whatsapp). */
  whatsapp?: {
    stale?: boolean;
    threads: WaThread[];
  } | null;
};

export type WaThread = {
  name: string;
  isGroup: boolean;
  archived: boolean;
  awaitingUs: boolean;
  lastInboundAt: number | null;
  messages: {
    direction: string;
    body: string | null;
    kind: string;
    speaker: string | null;
    at: number;
    today: boolean;
  }[];
};

const DAY = 86_400_000;
const KUWAIT = "Asia/Kuwait";

const asMs = (at?: string | number | null) =>
  at == null || at === ""
    ? Number.NaN
    : typeof at === "number"
      ? at
      : Date.parse(at);

export function kuwaitDay(at?: string | number | null): string {
  const t = asMs(at);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-GB", {
    timeZone: KUWAIT,
    day: "numeric",
    month: "short",
  });
}

/** "Sun 18 Oct, 12:00" in Kuwait time, the same in every browser. */
export function kuwaitWhen(at?: string | number | null): string {
  const t = asMs(at);
  if (!Number.isFinite(t)) return "";
  const part = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: KUWAIT,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(t))
      .map(p => [p.type, p.value]),
  );
  return `${part.weekday} ${part.day} ${part.month}, ${part.hour}:${part.minute}`;
}

/** "Sun 18 Oct" in Kuwait time. */
export function kuwaitWeekday(at?: string | number | null): string {
  return kuwaitWhen(at).replace(/, \d\d:\d\d$/, "");
}

/** The Kuwait calendar day as YYYY-MM-DD, for grouping. */
function dayKey(at?: string | number | null): string {
  const t = asMs(at);
  if (!Number.isFinite(t)) return "";
  return new Date(t + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** One readable line from markdown or a pasted note. */
export function clean(text: unknown): string {
  return String(text ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/^\s*(?:[-*•▪◦]|\d+[.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const norm = (s: string) =>
  clean(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** A WhatsApp message as one readable line: a voice note says so. */
function waText(m: { body: string | null; kind: string }, max = 0) {
  const t = clean(m.body ?? "");
  if (!t) return m.kind === "audio" ? "A voice note." : `A ${m.kind}.`;
  return max && t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

const firstSentence = (s: string) => {
  const m = /^(.{20,}?[.!?؟])(\s|$)/u.exec(s);
  return m ? m[1] : s;
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

const times = (n: number) =>
  n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;

export type Step = { owner?: string; text: string };

/**
 * A Fathom summary's sections by heading. Every stored summary uses the
 * same headings, in Arabic or English: purpose, key takeaways, topics,
 * next steps. Next steps are often grouped under an owner ("Abdullah:"),
 * and each step keeps its owner.
 */
export function summarySections(summary?: string | null): {
  takeaways: string[];
  nextSteps: Step[];
} {
  const raw = { takeaways: [] as string[], nextSteps: [] as string[] };
  if (!summary) return { takeaways: [], nextSteps: [] };
  let current: keyof typeof raw | null = null;
  for (const text of summary.split(/\r?\n/)) {
    const line = text.trimEnd();
    const head = /^\s*#{1,6}\s*(.+)$/.exec(line);
    if (head) {
      const h = head[1];
      current = /key takeaways|key points|أبرز النقاط|النقاط الرئيسية/i.test(h)
        ? "takeaways"
        : /next steps|action items|الخطوات التالية|الخطوات القادمة/i.test(h)
          ? "nextSteps"
          : null;
      continue;
    }
    if (current && line.trim()) raw[current].push(line);
  }
  const indentOf = (l: string) => /^\s*/.exec(l)?.[0].length ?? 0;
  const isBullet = (l: string) => /^\s*(?:[-*•]|\d+[.)])\s/.test(l);
  // Fathom indents its bullets; keep the outermost level of each section.
  const takeLines = (lines: string[]) => {
    const bullets = lines.filter(isBullet);
    if (!bullets.length) return lines.map(clean).filter(t => t.length >= 3);
    const indent = Math.min(...bullets.map(indentOf));
    return bullets
      .filter(l => indentOf(l) === indent)
      .map(clean)
      .filter(t => t.length >= 3);
  };
  const steps: Step[] = [];
  const bullets = raw.nextSteps.filter(isBullet);
  if (bullets.length) {
    const indent = Math.min(...bullets.map(indentOf));
    let owner: string | undefined;
    for (const l of bullets) {
      const t = clean(l);
      if (indentOf(l) === indent) {
        // "Abdullah:" alone is an owner heading; "Abdullah: send it" is a step.
        const header = /^(.{1,40}?)\s*[:：]$/.exec(t);
        if (header) {
          owner = header[1];
          continue;
        }
        owner = undefined;
        const inline = /^([^:：]{1,30})[:：]\s+(.{3,})$/.exec(t);
        if (inline) steps.push({ owner: inline[1], text: inline[2] });
        else if (t.length >= 3) steps.push({ text: t });
      } else if (owner && t.length >= 3) steps.push({ owner, text: t });
    }
  } else
    for (const l of raw.nextSteps)
      if (clean(l).length >= 3) steps.push({ text: clean(l) });
  return { takeaways: takeLines(raw.takeaways), nextSteps: steps };
}

type Answered = { answers?: { title?: string | null; value: unknown }[] };

function formAnswer(form: Answered | undefined | null, re: RegExp) {
  if (!form) return "";
  for (const a of form.answers ?? [])
    if (re.test(String(a.title ?? ""))) return answerText(a.value).trim();
  return "";
}

/** A call that happened, by Aziz's rule: confirmed counts as held once past. */
function happened(c: TimelineCall, now: number) {
  if (c.upcoming) return false;
  if (["cancelled", "no_show", "gone"].includes(c.status)) return false;
  // A past booking nobody marked is not a held call; the brief asks about it.
  if (c.status === "booked" && c.source === "ghl_appointment") return false;
  const t = asMs(c.endsAt ?? c.startsAt);
  if (!Number.isFinite(t) || t > now) return false;
  return (
    c.status === "held" ||
    c.status === "showed" ||
    c.status === "confirmed" ||
    ["fathom", "checkin_form", "manual", "imported", "zoom"].includes(c.source)
  );
}

/** The call's kind: a booking or recording says it, the 1-1 form only defaults it. */
function kindOf(rows: TimelineCall[]): string {
  const real = rows.filter(r => r.source !== "checkin_form");
  for (const r of real.length ? real : rows) {
    const t = String(r.title ?? "");
    if (/launch/i.test(t)) return "launch";
    if (/blueprint/i.test(t)) return "blueprint";
    if (/onboarding|kick ?off/i.test(t)) return "onboarding";
    if (r.kind && r.kind !== "other") return r.kind;
  }
  return rows[0]?.kind ?? "other";
}

function modeOf(stage: unknown): Brief["mode"] {
  const s = String(stage ?? "");
  if (/stopped|cancel|churn|lost/i.test(s)) return "stopped";
  if (/paused/i.test(s)) return "paused";
  if (/contacting|onboarding|blueprint|launch|kickoff/i.test(s))
    return "onboarding";
  return "live";
}

const OWNER_OURS =
  /^(mahara(?: ?media)?|مهارة|we|our team|csm|media buyer|tech|call cent(?:er|re)|creative|ads)\s*[:：-]\s*/i;
const OWNER_THEIRS = /^(client|the client|العميل|your side|you)\s*[:：-]\s*/i;
const BOTH = /^(both|everyone|all|كلاهما|الجميع)$/i;

/**
 * Meta's change kinds, most significant first. Library image events come
 * with creating an ad and on/off switches are housekeeping: both are
 * counted for the record, never offered as a talking point.
 */
const KINDS: { re: RegExp; one: string; many: string; rank: number }[] = [
  {
    re: /^create_campaign/,
    one: "new campaign",
    many: "new campaigns",
    rank: 1,
  },
  { re: /^create_ad_set$/, one: "new ad set", many: "new ad sets", rank: 1 },
  { re: /^create_ad$/, one: "new ad", many: "new ads", rank: 1 },
  {
    re: /budget(?!_scheduling)|spend_limit/,
    one: "budget change",
    many: "budget changes",
    rank: 2,
  },
  { re: /target/, one: "targeting change", many: "targeting changes", rank: 3 },
  {
    re: /optimization_goal/,
    one: "goal change",
    many: "goal changes",
    rank: 3,
  },
  { re: /bid_strategy/, one: "bid change", many: "bid changes", rank: 3 },
  { re: /^update_ad_creative$/, one: "ad edited", many: "ads edited", rank: 4 },
  { re: /duration/, one: "schedule change", many: "schedule changes", rank: 4 },
  { re: /run_status/, one: "on/off switch", many: "on/off switches", rank: 9 },
];
const IGNORED =
  /images|name$|friendly_name|budget_scheduling|user_(?:to|from)_role|flex_toggle/;
const NOTE_SOURCES = new Set([
  "decision",
  "media_action",
  "campaign_message",
  "native_manual",
  "legacy_manual",
]);

/** Card comments the cockpit itself wrote when a status changed: not news. */
const MECHANICAL =
  /\b(happiness|stage|service)( status)? (was )?(set|changed|moved) to\b|\bmarked (happy|neutral|at risk|very happy)\b/i;
/** Stock clauses that narrate the comment rather than say what happened. */
const NARRATION =
  /\bthe comment\b|notification delivery|tracked separately|no payment attempt or campaign change was made|last four digits/i;
/** Answers that say nothing. */
const EMPTY_ANSWER =
  /^(no|none|nothing|n\/a|na|-|\.|لا|لا يوجد|لايوجد|لا شيء|شكرا|شكراً|بالتوفيق|thanks|thank you|good luck)[.!]?$/i;
/** Words that say why a client stopped, paused or might come back. */
const STOP_WORDS =
  /\b(lost|churn\w*|paus\w*|stopp\w*|cancel\w*|refund\w*|payment|paid|referr\w*|off-?board\w*|not renew\w*|ended)\b|توقف|إيقاف|ايقاف|ألغ|الغاء|إلغاء|استرداد|إحالة|تجديد/i;
/** A takeaway about money or a disagreement is always raised. */
const MONEY_WORDS =
  /\b(invoice|billing|contract|dispute|complain\w*|refund|overcharg\w*|postpon\w*)\b|فاتورة|الفوترة|العقد|خلاف|شكوى|استرداد|تأجيل الدفع|الدفعة/i;
/** A client who is upset: raised before anything else. */
const ESCALATION =
  /\b(angry|upset|frustrat\w*|furious|complain\w*|threat\w* to (?:leave|cancel)|wants? to cancel|cancel the contract|refund|unhappy|disappointed)\b|زعلان|غاضب|منزعج|مستاء|إلغاء العقد|استرجاع/i;
/** A problem named on the last call, to follow up. */
const PROBLEM =
  /\b(none qualified|not qualified|no(?:t a single)? (?:lead|booking|show)|0%|poor|weak|problem|issue|blocked|low quality|didn'?t show)\b|مشكلة|سيئة|ضعيف|ضعف|لا أحد|غير مؤهل/i;
/** A takeaway that only states the next meeting's time; the strip carries the booking. */
const MEETING_TIME =
  /(next|upcoming|following) (meeting|call)|^next steps?:.*\b(meeting|call)\b|الاجتماع (القادم|التالي)|موعد الاجتماع|^الخطوة التالية:\s*اجتماع/i;
/** An EOD line that is a KPI roll-up rather than something that happened. */
const KPI_LINE = /\bcpl\b|cost per|out of kpi|account summary|cpb\b|\$\d/i;
/** An EOD line that records contact or an event with the client. */
const EVENT_LINE =
  /\b(call|meeting|met|spoke|delivered|sent|paid|payment|invoice|complain\w*|cancel\w*|launch\w*|win|won|closed|visit)\b|اجتماع|مكالمة|اتصال|زيارة|دفع/i;

const ROLE: Record<string, string> = {
  csms: "account manager",
  csm: "account manager",
  tech: "systems manager",
  media: "media buyer",
};
const LABEL_PREFIX =
  /^\s*(?:-\s*)?(?:call summary|account summary|day summary|summary|out ?of ?kpi|clients? lost|wins?|notes?|roll ?up|update)\s*:\s*/i;
const STOP_NAME_WORDS =
  /^(the|and|company|co|group|design|designs|contracting|construction|consult\w*|engineering|general|limited|ltd|projects?|interior|for|of|شركة|شركه|للاستشارات|الهندسية|للمقاولات)$/i;

/** The client's name as it appears in free text. */
function nameRe(name: string): RegExp | null {
  const words = name
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_NAME_WORDS.test(w));
  if (!words.length) return null;
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // One word that is also an ordinary word (Render, Overview) must match as written.
  if (words.length === 1)
    return new RegExp(
      `(^|[^\\p{L}])${esc(words[0])}([^\\p{L}]|$)`,
      /^[A-Z]/.test(words[0]) ? "u" : "iu",
    );
  return new RegExp(
    `(^|[^\\p{L}])${words.slice(0, 2).map(esc).join("\\s+")}([^\\p{L}]|$)`,
    "iu",
  );
}

/**
 * An EOD passage, cut to what is about this client: label prefixes and the
 * cockpit's generic advice after "→" go, a sentence repeated in the line
 * goes, and when the line names other clients only this client's part stays.
 */
function eodText(
  excerpt: string,
  mine: RegExp[],
  others: RegExp[],
): string | null {
  const parts = excerpt
    .split(/\r?\n|(?<=[.;؛])\s+|\s+•\s+|\s+·\s+/)
    .map(p =>
      p
        .replace(LABEL_PREFIX, "")
        .replace(/\s*→.*$/, "")
        .trim(),
    )
    .filter(p => p.length >= 3);
  const isMine = (p: string) => mine.some(re => re.test(p));
  const namesOthers = (p: string) => others.some(re => re.test(p));
  // About another client, not this one: attached here by a loose name match.
  if (!isMine(excerpt) && namesOthers(excerpt)) return null;
  const rollUp = others.filter(re => re.test(excerpt)).length >= 2;
  const kept = rollUp ? parts.filter(p => isMine(p) && !namesOthers(p)) : parts;
  const seen = new Set<string>();
  const out = kept.filter(p => {
    const k = norm(p);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return out.length ? clean(out.join(". ").replace(/\.\./g, ".")) : null;
}

/** 1-1 notes, split into lines: by newline and by inline " - " lists. */
function noteLines(text: string): string[] {
  return text
    .split(/\r?\n|\s+-\s+(?=\S)|\s+•\s+|(?<=\.)\s+(?=\d+[.)]\s)/)
    .map(clean)
    .filter(t => t.length >= 3 && !/[:：]$/.test(t));
}

const GOALS: [RegExp, string][] = [
  [/#1 service/i, "Wants to grow"],
  [/ideal project/i, "Ideal project"],
  [/TOP 3 challenges/i, "Top challenges"],
  [/90 Days/i, "90-day revenue goal"],
  [/12-24 months/i, "12 to 24-month revenue goal"],
  [/motivated you to join/i, "Why they joined"],
  [/additional information we should know/i, "Also told us"],
];
const KICKOFF: [RegExp, string][] = [
  [/which service are we advertising/i, "Advertising"],
  [/platforms will we advertise/i, "Platforms"],
  [/daily budget/i, "Daily ad budget"],
  [/close rate on cold leads/i, "Their close rate on cold leads"],
  [/pre-existing leads/i, "Has leads from before"],
  [/anything to add/i, "Kickoff notes"],
];
/** Kickoff setup items that block a launch while they are not done. */
const SETUP: [RegExp, string][] = [
  [/card linked to the account/i, "a card with funds on the ad account"],
  [/facebook access/i, "Facebook access"],
  [/google calendar integration (complete|status)/i, "Google Calendar"],
  [/mahara os access/i, "Mahara OS access"],
  [/whatsapp (status|synced)/i, "the WhatsApp group"],
  [/templated ads status/i, "templated ads approval"],
  [/name of the ad account/i, "the ad account name"],
  [/name of the facebook page/i, "the Facebook page name"],
];
const NOT_DONE = /^(no|false|pending|not\b|n\/a|waiting|in progress|لا)/i;
const MONEY_GOAL = /revenue goal/i;
const CURRENCY =
  /\b(kwd|kd|sar|sr|aed|qar|usd|bhd|omr|\$|dollars?|riyals?|dinars?|dirhams?)\b|دينار|ريال|درهم|دولار/i;

/** Damaged text: most of its Arabic words are one or two letters long. */
function damaged(s: string): boolean {
  const words = s.match(/[\u0600-\u06FF]+/g) ?? [];
  if (words.length < 6) return false;
  return words.filter(w => w.length <= 2).length / words.length > 0.4;
}

export function buildBrief(input: BriefInput): Brief {
  const { now, client: c, timeline, digests, diagnosis } = input;
  const calls = timeline?.calls ?? [];
  const forms = timeline?.forms ?? [];
  const health = timeline?.health ?? [];
  const H = (k: string): SourceHealth | undefined =>
    health.find(h => h.key === k);
  const mode = modeOf(c.stage);
  const name = String(c.name ?? timeline?.clientName ?? "");
  const newestOf = (kind: string) =>
    forms
      .filter(f => f.kind === kind)
      .sort((a, b) => asMs(b.submittedAt) - asMs(a.submittedAt))[0];
  const onboarding = newestOf("onboarding");
  const kickoff = newestOf("kickoff");
  // The client's names: the card, and the English business name they gave us.
  const mine = [name, formAnswer(onboarding, /business name/i)]
    .map(n => nameRe(n))
    .filter((r): r is RegExp => Boolean(r));
  const others = (input.otherClients ?? [])
    .filter(o => o && norm(o) !== norm(name))
    .map(nameRe)
    .filter((r): r is RegExp => Boolean(r));
  const team = new Set((input.teamActors ?? []).map(a => norm(a)));
  // What they wrote on WhatsApp, newest first, with who wrote it.
  const waThreads = input.whatsapp?.threads ?? [];
  const waInbound = waThreads
    .flatMap(t =>
      t.messages
        .filter(m => m.direction === "inbound")
        .map(m => ({
          m,
          t,
          who: t.isGroup ? `${m.speaker ?? "Someone"} in ${t.name}` : t.name,
        })),
    )
    .sort((a, b) => b.m.at - a.m.at);

  // ---- The last call: the newest day a call happened. All rows that day
  // (the booking, the recording, the 1-1 form, a logged call) are one call.
  const past = calls
    .filter(x => happened(x, now))
    .sort((a, b) => asMs(b.startsAt) - asMs(a.startsAt));
  const byDayRows = (key: string) =>
    past.filter(x => dayKey(x.startsAt) === key);
  const checkinForms = forms
    .filter(f => f.kind === "checkin")
    .sort((a, b) => asMs(b.submittedAt) - asMs(a.submittedAt));
  const formFor = (rows: TimelineCall[], key: string) =>
    checkinForms.find(
      f =>
        dayKey(f.submittedAt) === key ||
        rows.some(x => x.id === f.linkedCallId),
    ) ??
    rows.find(x => x.form)?.form ??
    undefined;
  const hasNotes = (rows: TimelineCall[], key: string) =>
    rows.some(x => x.summary || x.brief) ||
    Boolean(
      formAnswer(formFor(rows, key), /^client notes|additional notes/i) ||
        noteLines(formAnswer(formFor(rows, key), /^client notes/i)).length,
    );
  const lastKey = past.length ? dayKey(past[0].startsAt) : "";
  const lastRows = byDayRows(lastKey);
  const lastTime = past.length ? asMs(past[0].startsAt) : Number.NaN;
  // When the newest call has no notes, the newest call that has them speaks for it.
  let notedKey = lastKey;
  if (past.length && !hasNotes(lastRows, lastKey)) {
    const noted = past.find(x => {
      const k = dayKey(x.startsAt);
      return k !== lastKey && hasNotes(byDayRows(k), k);
    });
    if (noted) notedKey = dayKey(noted.startsAt);
  }
  const notedRows = byDayRows(notedKey);
  const notedForm = formFor(notedRows, notedKey);
  const lastForm = formFor(lastRows, lastKey);
  const upcoming = calls
    .filter(x => x.upcoming)
    .sort((a, b) => asMs(a.startsAt) - asMs(b.startsAt));

  const brief: Brief = {
    clientName: name,
    mode,
    raise: [],
    call: { lines: [], heading: "Last call" },
    promises: { ours: [], theirs: [], steps: [], open: [] },
    since: {
      heading: "Since the last call",
      changes: [],
      notes: [],
      team: [],
      changeTotal: 0,
      chats: [],
    },
    who: [],
    gaps: [],
  };

  if (past.length) {
    brief.lastCall = {
      day: kuwaitDay(past[0].startsAt),
      kind: CALL_NAMES[kindOf(lastRows)] ?? "Call",
      ago: Math.max(0, Math.floor((now - lastTime) / DAY)),
    };
    brief.call.heading = `Last call, ${kuwaitWeekday(past[0].startsAt)}`;
  }
  if (upcoming.length)
    brief.nextCall = {
      when: kuwaitWhen(upcoming[0].startsAt),
      kind: CALL_NAMES[kindOf([upcoming[0]])] ?? "Call",
    };

  // ---- DEFCON and priority from the newest 1-1 form. A form older than two
  // weeks, or older than the last call, is history, not today's mood.
  const newestForm = checkinForms[0];
  if (newestForm && now - asMs(newestForm.submittedAt) < 120 * DAY) {
    const defcon = formAnswer(newestForm, /defcon/i);
    const priority = formAnswer(newestForm, /priority/i);
    const old =
      now - asMs(newestForm.submittedAt) > 14 * DAY ||
      (Number.isFinite(lastTime) &&
        asMs(newestForm.submittedAt) < lastTime - DAY);
    if (defcon)
      brief.defcon = {
        value: defcon,
        day: kuwaitDay(newestForm.submittedAt),
        risk: /risk|unhappy|danger|angry|churn/i.test(defcon),
        old,
      };
    if (priority && !old) brief.priority = priority;
  }

  // ---- The last call's main points (or the newest call with notes).
  let callSteps: Step[] = [];
  const money: BriefLine[] = [];
  const problems: BriefLine[] = [];
  const notedDay = notedRows.length ? kuwaitDay(notedRows[0].startsAt) : "";
  if (past.length) {
    if (notedKey !== lastKey) {
      brief.call.heading = `Last call with notes, ${kuwaitWeekday(notedRows[0].startsAt)}`;
      brief.call.empty = `The ${brief.lastCall?.day} call has no recording or notes.`;
    }
    const withSummary = [...notedRows]
      .filter(x => x.summary)
      .sort((a, b) => (b.summary?.length ?? 0) - (a.summary?.length ?? 0))[0];
    const secs = summarySections(withSummary?.summary);
    const source = withSummary?.recordingUrl ? "Fathom" : "Call summary";
    const takeaways = secs.takeaways.filter(
      t => !(upcoming.length && MEETING_TIME.test(t)),
    );
    if (takeaways.length)
      brief.call.lines = takeaways.slice(0, 5).map(text => ({
        text,
        source,
        day: notedDay,
        href: withSummary?.recordingUrl,
      }));
    else {
      const brief1 = notedRows.find(x => x.brief)?.brief;
      if (brief1)
        brief.call.lines = [
          { text: clean(brief1), source: "AI brief", day: notedDay },
        ];
    }
    for (const t of takeaways) {
      if (MONEY_WORDS.test(t))
        money.push({ text: t, source, day: notedDay, risk: true });
      else if (PROBLEM.test(t))
        problems.push({ text: t, source, day: notedDay });
    }
    // The CSM's own notes: what was said, and to-dos by side.
    for (const t of noteLines(
      formAnswer(notedForm, /^client notes/i) +
        "\n" +
        formAnswer(notedForm, /additional notes/i),
    )) {
      if (OWNER_THEIRS.test(t))
        callSteps.push({ owner: "Client", text: t.replace(OWNER_THEIRS, "") });
      else if (OWNER_OURS.test(t))
        callSteps.push({ owner: "Mahara", text: t.replace(OWNER_OURS, "") });
      else if (
        brief.call.lines.filter(l => l.source === "Your 1-1 notes").length < 3
      )
        brief.call.lines.push({
          text: t,
          source: "Your 1-1 notes",
          day: notedDay,
        });
    }
    const recorded = notedForm?.answers?.find(a =>
      /recording/i.test(String(a.title ?? "")),
    );
    const formRec =
      (notedForm as Row | undefined)?.recordingUrl ??
      (recorded ? answerText(recorded.value) : "");
    if (!brief.call.lines.length) {
      if (/^https?:\/\//.test(String(formRec)))
        brief.call.lines.push({
          text: "Recording linked in the 1-1 form; no summary was pulled from it.",
          source: "1-1 form",
          day: notedDay,
          href: String(formRec),
        });
      else {
        const confirmedOnly =
          lastRows.length > 0 &&
          lastRows.every(r => r.source === "ghl_appointment") &&
          !lastForm;
        brief.call.empty = confirmedOnly
          ? `The ${brief.lastCall?.day} call is confirmed in GoHighLevel, with no recording or notes.`
          : lastForm
            ? `No recording for the ${brief.lastCall?.day} call, and its 1-1 form has no notes.`
            : `No recording or 1-1 notes for the ${brief.lastCall?.day} call.`;
      }
    }
    callSteps = [...secs.nextSteps, ...callSteps];
  } else {
    // No call row: the team's EODs may still record a meeting.
    // A meeting the team's EOD records, in a sentence that names the client.
    const met = (timeline?.eods ?? [])
      .flatMap(e =>
        (eodText(String(e.excerpt ?? ""), mine, others) ?? "")
          .split(/(?<=[.!?؟])\s+|\s+-\s+/)
          .map(text => ({ e, text })),
      )
      .find(
        x =>
          /\b(call|meeting|met|spoke)\b|اجتماع|مكالمة/i.test(x.text) &&
          mine.some(re => re.test(x.text)),
      );
    brief.call.empty = met
      ? `No recorded call. The team's EOD mentions one on ${kuwaitDay(met.e.at)}: ${clean(met.text)}`
      : mode === "stopped"
        ? "No call with them is on record since 1 Jun."
        : "No call with this client is on record since 1 Jun: not in GoHighLevel, Fathom or the 1-1 form.";
  }

  // ---- Promises: the card's digests since the last call (ours and theirs),
  // then the call's own next steps with their owners.
  const sinceLast = Number.isFinite(lastTime) ? lastTime - DAY : now - 14 * DAY;
  const pushStep = (
    list: BriefLine[],
    text: string,
    source: string,
    day: string,
    label?: string,
  ) => {
    if (text.length < 3) return;
    const all = [
      ...brief.promises.ours,
      ...brief.promises.theirs,
      ...brief.promises.steps,
    ];
    if (all.some(l => norm(l.text) === norm(text))) return;
    list.push({ text, source, day, label });
  };
  const stepDigests = (digests ?? [])
    .filter(d => (d.at ?? 0) >= sinceLast && d.nextSteps?.length)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const callDigest =
    stepDigests.find(d => d.kind === "call") ??
    (digests ?? []).find(
      d =>
        d.kind === "call" &&
        d.nextSteps?.length &&
        now - (d.at ?? 0) < 30 * DAY,
    );
  const digestsForSteps =
    callDigest && !stepDigests.includes(callDigest)
      ? [callDigest, ...stepDigests]
      : stepDigests;
  for (const d of digestsForSteps)
    for (const step of d.nextSteps) {
      const raw = String(step ?? "");
      const day = kuwaitDay(d.at);
      if (OWNER_THEIRS.test(raw))
        pushStep(
          brief.promises.theirs,
          clean(raw.replace(OWNER_THEIRS, "")),
          "ClickUp card",
          day,
        );
      else
        pushStep(
          brief.promises.ours,
          clean(raw.replace(OWNER_OURS, "")),
          "ClickUp card",
          day,
        );
    }
  if (callDigest)
    brief.promises.from = `From the ClickUp card, ${kuwaitDay(callDigest.at)}`;
  if (callSteps.length) {
    if (!brief.promises.from)
      brief.promises.from = `Next steps from the ${notedDay} call`;
    for (const s of callSteps) {
      const owner = s.owner?.trim();
      const source =
        s.owner === "Client" || s.owner === "Mahara"
          ? "Your 1-1 notes"
          : "Fathom";
      if (owner && (OWNER_OURS.test(`${owner}:`) || /^mahara/i.test(owner)))
        pushStep(brief.promises.ours, s.text, source, notedDay);
      else if (
        owner &&
        (OWNER_THEIRS.test(`${owner}:`) || mine.some(re => re.test(owner)))
      )
        pushStep(brief.promises.theirs, s.text, source, notedDay);
      else
        pushStep(
          brief.promises.steps,
          s.text,
          source,
          notedDay,
          owner && !BOTH.test(owner) ? owner : owner ? "Both" : undefined,
        );
    }
  }

  // ---- Loose ends from the card, dropped when the timeline says otherwise.
  const actionable: BriefLine[] = [];
  for (const l of (c.loose ?? []) as string[]) {
    let t = clean(l);
    if (past.length && /no contact ever logged/i.test(t)) continue;
    if (/nothing rebooked|no next touchpoint|next touchpoint .*passed/i.test(t))
      continue;
    if (past.length && /last poc is \d+\s*d/i.test(t)) continue;
    t = t
      .replace(/\bPOC\b/g, "contact")
      .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_, d: string) =>
        kuwaitDay(`${d}T09:00:00Z`),
      )
      .replace(/\bstale\b/gi, "old");
    if (/monthly report/i.test(t))
      actionable.push({
        text: "No monthly report has gone to them yet. Walk through this month's results on the call, then send the report.",
        source: "ClickUp card",
      });
    else brief.promises.open.push({ text: t, source: "Loose end" });
  }
  if (
    !brief.promises.ours.length &&
    !brief.promises.theirs.length &&
    !brief.promises.steps.length &&
    !brief.promises.open.length
  )
    brief.promises.empty = brief.lastCall
      ? `No next steps were written down after the ${notedDay || brief.lastCall.day} call. Add them to the ClickUp card after the next one.`
      : "No next steps on record yet.";

  // ---- Since the last call: ad changes, card notes, the team's EODs.
  // With no call on record, look back the full 45 days.
  const callStart = Number.isFinite(lastTime) ? lastTime : now - 45 * DAY;
  const windowStart = Math.max(callStart, now - 45 * DAY);
  const clamped = windowStart > callStart;
  brief.since.heading = brief.lastCall
    ? `Since the ${brief.lastCall.day} call${clamped ? " (last 45 days)" : ""}`
    : "In the last 45 days";
  const changes = ((timeline?.changes ?? []) as Row[])
    .slice()
    .sort((a, b) => asMs(b.at) - asMs(a.at));
  const oldest = changes.length
    ? asMs(changes[changes.length - 1].at)
    : Number.NaN;
  if (changes.length >= 40 && oldest > windowStart)
    brief.since.capped = `Showing the newest 40 changes, back to ${kuwaitDay(oldest)}.`;
  const newer = changes.filter(ch => asMs(ch.at) >= windowStart);
  const isTeam = (actor: unknown) => {
    const a = norm(String(actor ?? ""));
    return (
      !a ||
      team.has(a) ||
      /claude|media buyer|cockpit/.test(a) ||
      team.size === 0
    );
  };
  // Creation side effects: updates to an object within two minutes of its creation.
  const created = newer
    .filter(ch => /^create_/.test(String(ch.kind)))
    .map(ch => ({ at: asMs(ch.at), what: String(ch.evidence ?? "") }));
  const sideEffect = (ch: Row) =>
    /^update_/.test(String(ch.kind)) &&
    created.some(
      x =>
        Math.abs(x.at - asMs(ch.at)) < 120_000 &&
        (!x.what ||
          !ch.evidence ||
          x.what === String(ch.evidence) ||
          /ad_set|creative|target|bid|goal/.test(String(ch.kind))),
    );
  type DayGroup = {
    key: string;
    day: string;
    at: number;
    who: Set<string>;
    counts: Map<string, number>;
    rank: number;
  };
  const byDay = new Map<string, DayGroup>();
  const notes = new Map<string, BriefLine & { n: number }>();
  const clientMade: Row[] = [];
  for (const ch of newer) {
    const source = String(ch.source ?? "");
    const kind = String(ch.kind ?? "");
    if (NOTE_SOURCES.has(source)) {
      const action = clean(ch.action);
      // A code like "control setStatus" or "ceo.b2bControl.setStatus" says nothing.
      if (
        !action ||
        (/^[a-z]+[.\s][a-zA-Z.]+$/.test(action) && !/\s\w+\s/.test(action))
      )
        continue;
      const text =
        kind === "touch"
          ? "Sent the client an update"
          : source === "decision" && ch.evidence
            ? `${action} (${clean(ch.evidence).slice(0, 90)})`
            : action;
      const k = `${dayKey(ch.at)}|${norm(kind === "touch" ? "touch" : action)}`;
      const prev = notes.get(k);
      if (prev) prev.n += 1;
      else
        notes.set(k, {
          text,
          source:
            source === "decision" ? "Media buyer decision" : "Media buyer note",
          day: kuwaitDay(ch.at),
          n: 1,
        });
      continue;
    }
    if (IGNORED.test(kind) || sideEffect(ch)) continue;
    const def = KINDS.find(k => k.re.test(kind));
    if (!def) continue;
    if (!isTeam(ch.actor) && source === "meta_activity") clientMade.push(ch);
    const key = dayKey(ch.at);
    const g = byDay.get(key) ?? {
      key,
      day: kuwaitDay(ch.at),
      at: asMs(ch.at),
      who: new Set<string>(),
      counts: new Map<string, number>(),
      rank: 99,
    };
    if (ch.actor)
      g.who.add(
        /claude/i.test(String(ch.actor))
          ? "The cockpit"
          : String(ch.actor).split(" ")[0],
      );
    g.counts.set(def.one, (g.counts.get(def.one) ?? 0) + 1);
    g.rank = Math.min(g.rank, def.rank);
    byDay.set(key, g);
  }
  // A media buyer note on the same day already says what the count says.
  for (const n of notes.values()) {
    const g = [...byDay.values()].find(x => x.day === n.day);
    if (!g) continue;
    if (/budget|ميزاني/i.test(n.text)) g.counts.delete("budget change");
    if (/video|creative|ad\b|فيديو|اعلان|إعلان/i.test(n.text))
      g.counts.delete("new ad");
  }
  brief.since.changeTotal = newer.length;
  const words = (counts: Map<string, number>, withSwitches: boolean) =>
    KINDS.filter(k => withSwitches || k.rank < 9)
      .map(k => {
        const n = counts.get(k.one) ?? 0;
        return n ? `${n} ${n === 1 ? k.one : k.many}` : "";
      })
      .filter(Boolean)
      .join(", ");
  const groups = [...byDay.values()]
    .filter(g => words(g.counts, true))
    .sort((a, b) => b.at - a.at);
  const real = groups.filter(g => words(g.counts, false));
  const switchOnly = groups.filter(g => !words(g.counts, false));
  for (const g of real)
    brief.since.changes.push({
      text: `${[...g.who].join(" and ") || "The media buyer"}: ${words(g.counts, true)}`,
      source: "Meta",
      day: g.day,
    });
  if (switchOnly.length) {
    const n = switchOnly.reduce(
      (s, g) => s + (g.counts.get("on/off switch") ?? 0),
      0,
    );
    const who = [...new Set(switchOnly.flatMap(g => [...g.who]))];
    brief.since.changes.push({
      text: `Ads switched on or off ${times(n)}${who.length ? ` (${who.join(", ")})` : ""}`,
      source: "Meta",
      day:
        switchOnly.length === 1
          ? switchOnly[0].day
          : `${switchOnly[switchOnly.length - 1].day} to ${switchOnly[0].day}`,
    });
  }
  // What to tell the client, across the whole window, in their words.
  const total = new Map<string, number>();
  for (const g of real)
    for (const [k, v] of g.counts) total.set(k, (total.get(k) ?? 0) + v);
  const told: string[] = [];
  // Client words: campaigns and ads, never ad sets or switches.
  const camps = total.get("new campaign") ?? 0;
  const newAds = total.get("new ad") ?? 0;
  if (camps && newAds)
    told.push(
      `launched ${plural(camps, "new campaign")} with ${plural(newAds, "new ad")}`,
    );
  else if (camps) told.push(`launched ${plural(camps, "new campaign")}`);
  else if (newAds) told.push(`launched ${plural(newAds, "new ad")}`);
  else if (total.get("new ad set")) told.push("set up new audiences");
  if (total.get("budget change"))
    told.push(`adjusted the budget ${times(total.get("budget change") ?? 0)}`);
  if (
    total.get("targeting change") ||
    total.get("goal change") ||
    total.get("bid change")
  )
    told.push("refined who the ads reach");
  if (total.get("ad edited"))
    told.push(`updated ${plural(total.get("ad edited") ?? 0, "ad")}`);
  const span = real.length
    ? real.length === 1
      ? real[0].day
      : `${real[real.length - 1].day} to ${real[0].day}`
    : "";

  // Meta's log is behind only when it failed and this client's newest change is old.
  const metaHealth = H("csm-meta-activities");
  const metaRows = changes.filter(ch => ch.source === "meta_activity");
  const newestMeta = metaRows.length ? asMs(metaRows[0].at) : Number.NaN;
  if (
    mode !== "stopped" &&
    metaRows.length > 0 &&
    isStale(metaHealth, now) &&
    now - newestMeta > 2 * DAY
  )
    brief.since.stale = `Meta's change log has not fully updated since ${kuwaitWhen(metaHealth?.lastOkAt)}, so the newest ad changes may be missing.`;

  for (const n of [...notes.values()].sort((a, b) =>
    (b.day ?? "").localeCompare(a.day ?? ""),
  ))
    brief.since.notes.push({
      text: n.n > 1 ? `${n.text} (${n.n} campaigns)` : n.text,
      source: n.source,
      day: n.day,
    });

  // ---- Card notes since the call: the risk is raised once, not repeated here.
  const recent = (digests ?? []).filter(d => now - (d.at ?? 0) < 21 * DAY);
  const riskOrder = (r: string) =>
    /cannot run|can'?t run|paused|stopp|access|billing|card|balance|grace/i.test(
      r,
    )
      ? 0
      : 1;
  const risks = recent
    .flatMap(d => (d.risks ?? []).map(r => ({ r: String(r), d })))
    .filter(x => !/happiness/i.test(x.r) && !MECHANICAL.test(x.r))
    .filter(x => !brief.call.lines.some(l => sharedWords(l.text, x.r) >= 0.5))
    .sort(
      (a, b) =>
        riskOrder(a.r) - riskOrder(b.r) || (b.d.at ?? 0) - (a.d.at ?? 0),
    )
    // One line per topic: two billing notices from the same night are one risk.
    .filter((x, i, all) => {
      const topic = (y: { r: string }) =>
        riskOrder(y.r) === 0 ? "billing" : norm(y.r).slice(0, 30);
      return all.findIndex(y => topic(y) === topic(x)) === i;
    })
    .slice(0, 2);
  const usedDigests = new Set(risks.map(x => x.d));
  const seenTopics = new Map<string, number>();
  for (const d of (digests ?? [])
    .slice()
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))) {
    if (
      usedDigests.has(d) ||
      d.kind === "call" ||
      (d.at ?? 0) < windowStart ||
      !d.summary
    )
      continue;
    if (MECHANICAL.test(d.summary)) continue;
    // Keep the newest digest of a kind within three days (a repeated kickoff or billing note).
    const topic = `${d.kind}|${/billing|balance|grace|card/i.test(d.summary) ? "billing" : norm(d.summary).slice(0, 40)}`;
    const prevAt = seenTopics.get(topic);
    if (prevAt !== undefined && prevAt - (d.at ?? 0) < 3 * DAY) continue;
    seenTopics.set(topic, d.at ?? 0);
    const s = clean(
      d.summary
        .split(/(?<=[.!?؟])\s+/)
        .filter(x => !NARRATION.test(x))
        .join(" "),
    );
    if (s.length < 3) continue;
    brief.since.notes.push({
      text: firstSentence(s),
      source: "ClickUp card",
      day: kuwaitDay(d.at),
    });
  }
  brief.since.notes = brief.since.notes.slice(0, 6);

  // ---- The team's EODs in the same window, cut to this client, deduped,
  // events before KPI roll-ups, at most one KPI line.
  const seen = new Set<string>();
  let kpiLines = 0;
  const lastCallTakeaways = brief.call.lines.length > 0 && notedKey === lastKey;
  const team1: (BriefLine & { event: boolean; t: number })[] = [];
  for (const e of timeline?.eods ?? []) {
    if (/^date$/i.test(String(e.author ?? ""))) continue;
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(String(e.day ?? "")) &&
      Math.abs(Date.parse(`${e.day}T09:00:00Z`) - asMs(e.at)) < 3 * DAY;
    const t = valid ? Date.parse(`${e.day}T09:00:00Z`) : asMs(e.at);
    if (t < windowStart) continue;
    const role = ROLE[String(e.role ?? "").toLowerCase()] ?? e.role ?? "";
    // The account manager's own write-up of the last call repeats the call's points.
    if (
      lastCallTakeaways &&
      dayKey(t) === lastKey &&
      /account manager|csm/i.test(role)
    )
      continue;
    const text = eodText(String(e.excerpt ?? ""), mine, others);
    if (!text) continue;
    const key = `${dayKey(t)}|${norm(text).slice(0, 120)}`;
    const loose = norm(text).slice(0, 120);
    if (seen.has(key) || seen.has(loose)) continue;
    seen.add(key);
    seen.add(loose);
    const kpi = KPI_LINE.test(text) && !EVENT_LINE.test(text);
    if (kpi && kpiLines++ >= 1) continue;
    const auto = e.source === "cockpit" && kpi;
    const author = e.author ? e.author.split(" ")[0] : "";
    team1.push({
      // A KPI roll-up keeps its first figure; a second one is older noise.
      text: kpi ? (text.split(/(?<=\.)\s+/)[0] ?? text) : text,
      event: !kpi,
      t,
      source: auto
        ? "Media buyer cockpit (auto)"
        : [author && author.charAt(0).toUpperCase() + author.slice(1), role]
            .filter(Boolean)
            .join(", ") || "Team EOD",
      day: kuwaitDay(t),
    });
  }
  brief.since.team = team1
    .sort((a, b) => Number(b.event) - Number(a.event) || b.t - a.t)
    .map(({ event: _e, t: _t, ...l }) => l);

  // What they wrote on WhatsApp in the same window: the newest three.
  brief.since.chats = waInbound
    .filter(x => x.m.at >= windowStart)
    .slice(0, 3)
    .map(x => ({
      label: x.who,
      text: waText(x.m),
      source: "WhatsApp",
      day: kuwaitDay(x.m.at),
    }));

  if (
    !brief.since.changes.length &&
    !brief.since.notes.length &&
    !brief.since.team.length &&
    !brief.since.chats.length
  )
    brief.since.empty = brief.since.stale
      ? "No card notes or team mentions since then either."
      : "No ad changes, card notes or team mentions since then.";

  // ---- Who they are: the newest kickoff, then the onboarding form.
  const answer = (
    form: TimelineForm | undefined,
    list: [RegExp, string][],
    source: string,
  ) => {
    if (!form) return;
    for (const [re, label] of list) {
      let v = clean(formAnswer(form, re));
      if (
        !v ||
        v.length < 2 ||
        EMPTY_ANSWER.test(v) ||
        /^https?:\/\/\S+$/.test(v) ||
        damaged(v)
      )
        continue;
      if (
        label === "Wants to grow" &&
        /^\D{0,12}\d[\d,.\s]*(million|m|k)?\b/i.test(v)
      )
        continue;
      if (MONEY_GOAL.test(label) && /^[\d,.\s]+$/.test(v)) {
        const n = Number(v.replace(/[,\s]/g, ""));
        v =
          n < 1000
            ? `as written: ${v}`
            : `${n.toLocaleString("en-US")} (currency not stated)`;
      } else if (MONEY_GOAL.test(label) && !CURRENCY.test(v))
        v = `${v} (currency not stated)`;
      if (brief.who.some(l => l.label === label)) continue;
      brief.who.push({
        label,
        text: v,
        source,
        day: kuwaitDay(form.submittedAt),
      });
    }
  };
  answer(kickoff, KICKOFF, "Kickoff form");
  answer(onboarding, GOALS, "Onboarding form");

  // ---- Raise on this call: rules over the sources above.
  const raise: (BriefLine & { rank: number })[] = [];
  const add = (rank: number, line: BriefLine) => raise.push({ rank, ...line });

  if (/^\[internal/i.test(name)) {
    brief.quiet = "An internal test record, not a client.";
  } else if (mode === "stopped" || mode === "paused") {
    const word = mode === "stopped" ? "Stopped" : "Paused";
    // Why they stopped: the newest line anywhere that says so, at any age.
    const said = [
      ...(timeline?.eods ?? []).map(e => ({
        text: eodText(String(e.excerpt ?? ""), mine, others) ?? "",
        at: asMs(e.at),
        source: "Team EOD",
      })),
      ...(digests ?? []).map(d => ({
        text: clean(d.summary),
        at: d.at ?? 0,
        source: "ClickUp card",
      })),
    ]
      .filter(x => x.text && STOP_WORDS.test(x.text))
      .sort((a, b) => b.at - a.at);
    add(0, {
      risk: true,
      text: said[0]
        ? `${word}: ${firstSentence(said[0].text)}`
        : `${word}. No reason is on record; ask what would bring them back.`,
      source: said[0]?.source ?? "ClickUp stage",
      day: said[0] ? kuwaitDay(said[0].at) : undefined,
    });
    const money1 = said.find(
      (x, i) =>
        i > 0 && /invoice|paid|payment|pay|refund|فاتورة|دفع/i.test(x.text),
    );
    if (money1)
      add(1, {
        text: firstSentence(money1.text),
        source: money1.source,
        day: kuwaitDay(money1.at),
      });
    const wrote = waInbound.find(x => now - x.m.at < 30 * DAY);
    if (wrote)
      add(1.5, {
        text: `${wrote.who} wrote on WhatsApp on ${kuwaitDay(wrote.m.at)}: "${waText(wrote.m, 140).replace(/[.!?؟]+$/, "")}".`,
        source: "WhatsApp",
        day: kuwaitDay(wrote.m.at),
      });
    if (brief.defcon)
      add(2, {
        text: `Last mood on record: ${brief.defcon.value} on ${brief.defcon.day}.`,
        source: "1-1 form",
      });
    if (brief.lastCall)
      add(3, {
        text: `Last spoke on ${brief.lastCall.day} (${brief.lastCall.kind.toLowerCase()}).`,
        source: "Calls",
      });
    brief.raise = raise
      .sort((a, b) => a.rank - b.rank)
      .map(({ rank: _r, ...l }) => l);
    const nothing =
      !calls.length &&
      !forms.length &&
      !(timeline?.changes ?? []).length &&
      !(timeline?.eods ?? []).length &&
      !(digests ?? []).length &&
      !waInbound.length;
    if (nothing)
      brief.quiet = `${word}. Nothing on record since 1 Jun: no calls, forms, card notes or team mentions.`;
    // The newest two team mentions, at any age.
    const lastTeam = (timeline?.eods ?? [])
      .filter(e => !/^date$/i.test(String(e.author ?? "")))
      .map(e => ({ e, text: eodText(String(e.excerpt ?? ""), mine, others) }))
      .filter(x => x.text)
      .slice(0, 2)
      .map(x => ({
        text: x.text as string,
        source: "Team EOD",
        day: kuwaitDay(x.e.at),
      }));
    brief.since = {
      heading: "Last from the team",
      changes: [],
      notes: [],
      team: lastTeam,
      changeTotal: 0,
      chats: [],
    };
    if (!lastTeam.length) brief.since.empty = "No team mentions on record.";
    brief.promises = {
      ours: [],
      theirs: [],
      steps: [],
      open: [],
      empty: "No open promises: they are not a live client.",
    };
  } else {
    // An upset client first: anything since the last call that says so.
    const sinceStart = Number.isFinite(lastTime)
      ? lastTime - DAY
      : now - 14 * DAY;
    const upset = [
      ...(timeline?.eods ?? [])
        .filter(e => asMs(e.at) >= sinceStart)
        .map(e => ({
          text: eodText(String(e.excerpt ?? ""), mine, others) ?? "",
          at: asMs(e.at),
          source: "Team EOD",
        })),
      ...(digests ?? [])
        .filter(d => (d.at ?? 0) >= sinceStart)
        .map(d => ({
          text: clean(d.summary),
          at: d.at ?? 0,
          source: "ClickUp card",
        })),
      ...brief.call.lines
        .filter(l => l.source === "Your 1-1 notes")
        .map(l => ({ text: l.text, at: lastTime, source: "Your 1-1 notes" })),
      ...waInbound
        .filter(x => x.m.at >= sinceStart)
        .map(x => ({
          text: clean(x.m.body ?? ""),
          at: x.m.at,
          source: "WhatsApp",
        })),
    ]
      .flatMap(x =>
        x.text.split(/(?<=[.!?؟])\s+/).map(s => ({ ...x, text: s })),
      )
      .filter(x => ESCALATION.test(x.text))
      .sort((a, b) => b.at - a.at)[0];
    if (upset)
      add(-1, {
        risk: true,
        text: `${clean(upset.text).replace(/[.!؟?]*$/, ".")} Open with it, calmly, before anything else.`,
        source: upset.source,
        day: kuwaitDay(upset.at),
      });
    // A WhatsApp message waiting on our reply: answer it before the call.
    for (const t of waThreads.filter(x => x.awaitingUs && !x.archived)) {
      const last = waInbound.find(x => x.t === t);
      if (!last) continue;
      const since =
        kuwaitDay(last.m.at) === kuwaitDay(now)
          ? `${kuwaitWhen(last.m.at).split(", ").pop()} today`
          : kuwaitWhen(last.m.at);
      add(0.5, {
        risk: now - last.m.at >= DAY,
        text: last.m.body?.trim()
          ? `${last.who} is waiting on a WhatsApp reply since ${since}: "${waText(last.m, 140).replace(/[.!?؟]+$/, "")}". Answer it before the call.`
          : `${last.who} sent ${last.m.kind === "audio" ? "a voice note" : `a ${last.m.kind}`} on WhatsApp ${since.endsWith("today") ? "at" : "on"} ${since} and is waiting on a reply. Answer it before the call.`,
        source: "WhatsApp",
        day: kuwaitDay(last.m.at),
      });
    }
    if (brief.defcon?.risk && !brief.defcon.old)
      add(0, {
        risk: true,
        text: `Marked ${brief.defcon.value}${brief.priority ? `, priority ${brief.priority},` : ""} on ${brief.defcon.day}. Ask how they feel about the results before anything else.`,
        source: "1-1 form",
        day: brief.defcon.day,
      });
    // A change the client made to their own ads.
    if (clientMade.length) {
      const ch = clientMade[0];
      const what = /run_status/.test(String(ch.kind))
        ? "switched their ads on or off"
        : /budget|spend_limit/.test(String(ch.kind))
          ? "changed the budget"
          : "changed their ads";
      add(1, {
        risk: true,
        text: `Someone on their side (${clean(ch.actor)}) ${what} on ${kuwaitDay(ch.at)}. Ask why before anything else changes.`,
        source: "Meta",
        day: kuwaitDay(ch.at),
      });
    }
    // Calls: none booked, a booking that fell through, or one nobody marked.
    const pastBookings = calls
      .filter(
        x =>
          !x.upcoming &&
          x.source === "ghl_appointment" &&
          asMs(x.startsAt) <= now,
      )
      .sort((a, b) => asMs(b.startsAt) - asMs(a.startsAt));
    const unmarked = pastBookings.find(
      x => x.status === "booked" && now - asMs(x.startsAt) < 30 * DAY,
    );
    if (unmarked)
      add(2, {
        text: `Was the ${kuwaitDay(unmarked.startsAt)} ${(CALL_NAMES[kindOf([unmarked])] ?? "call").toLowerCase()} held? It is still "booked" in GoHighLevel; mark it.`,
        source: "GoHighLevel",
      });
    const lastBooking = pastBookings[0];
    if (!upcoming.length) {
      // A meeting we promised on the last call itself: "schedule next week's review".
      const promisedMeeting =
        notedKey === lastKey
          ? [...brief.promises.ours, ...brief.promises.steps].find(
              l =>
                /\b(schedule|book|set up|arrange)\b.*\b(meeting|call|review|check-?in)\b|(حجز|جدولة|ترتيب|تحديد موعد)\s+(اجتماع|مكالمة)/i.test(
                  l.text,
                ) && !/ad review/i.test(l.text),
            )
          : undefined;
      if (
        lastBooking &&
        ["cancelled", "no_show"].includes(lastBooking.status) &&
        asMs(lastBooking.startsAt) > (Number.isFinite(lastTime) ? lastTime : 0)
      )
        add(2, {
          risk: true,
          text: `Their ${kuwaitDay(lastBooking.startsAt)} ${(CALL_NAMES[kindOf([lastBooking])] ?? "call").toLowerCase()} was ${lastBooking.status === "no_show" ? "a no-show" : "cancelled"} and nothing is booked since. Book one.`,
          source: "GoHighLevel",
          day: kuwaitDay(lastBooking.startsAt),
        });
      else if (!past.length && mode === "live")
        add(2, {
          risk: true,
          text: "No call is on record and none is booked. Book one.",
          source: "Calls",
        });
      else if (
        mode === "live" &&
        brief.lastCall &&
        (brief.lastCall.ago > 14 || brief.defcon?.risk || promisedMeeting)
      )
        add(2, {
          risk: brief.lastCall.ago > 14 || Boolean(brief.defcon?.risk),
          text: promisedMeeting
            ? `No next call is booked. Book the one we promised: ${promisedMeeting.text}`
            : `No next call is booked${brief.lastCall.ago > 14 ? `, and the last was ${plural(brief.lastCall.ago, "day")} ago` : ""}. Book a check-in.`,
          source: "Calls",
        });
    }
    const byUpcomingDay = new Map<string, TimelineCall[]>();
    for (const u of upcoming)
      byUpcomingDay.set(dayKey(u.startsAt), [
        ...(byUpcomingDay.get(dayKey(u.startsAt)) ?? []),
        u,
      ]);
    for (const list of byUpcomingDay.values())
      if (list.length > 1)
        add(2, {
          risk: true,
          text: `${plural(list.length, "call")} are booked on ${kuwaitDay(list[0].startsAt)} (${list.map(x => kuwaitWhen(x.startsAt).slice(-5)).join(" and ")}). Keep one and cancel the other.`,
          source: "GoHighLevel",
        });
    if (Number(c.paymentDue ?? 0) >= 1)
      add(3, {
        risk: true,
        text: `Mahara's invoice is ${plural(Number(c.paymentDue), "day")} late. Check the Money tab before the call.`,
        source: "Billing",
      });
    else if (
      Number(c.paymentDue) >= -3 &&
      Number(c.paymentDue) <= 0 &&
      c.paymentDate
    )
      add(13, {
        text: `Their next payment is due ${kuwaitDay(`${String(c.paymentDate).slice(0, 10)}T09:00:00Z`)}.`,
        source: "Billing",
      });
    for (const m of money.slice(0, 1))
      add(3, {
        ...m,
        text: `From the ${m.day} call: ${m.text} Check it is settled.`,
      });
    for (const x of risks) {
      const meta = /\bmeta\b|ad account|facebook|grace period/i.test(
        `${x.r} ${x.d.summary ?? ""}`,
      );
      const step = (x.d.nextSteps ?? [])
        .map(String)
        .find(s => OWNER_OURS.test(s));
      add(4, {
        risk: true,
        text: `${meta && !/^meta/i.test(x.r) ? "Meta: " : ""}${clean(x.r)}${step ? ` Next: ${clean(step.replace(OWNER_OURS, ""))}` : ""}`,
        source: "ClickUp card",
        day: kuwaitDay(x.d.at),
      });
    }
    // Onboarding: the next step for their stage, and what still blocks a launch.
    if (mode === "onboarding") {
      const stage = String(c.stage ?? "");
      const blocker = (timeline?.eods ?? [])
        .filter(e => now - asMs(e.at) < 45 * DAY)
        .map(e => ({
          e,
          text: eodText(String(e.excerpt ?? ""), mine, others) ?? "",
        }))
        .flatMap(x =>
          x.text.split(/(?<=[.!?؟])\s+/).map(t => ({ ...x, text: t })),
        )
        .filter(x =>
          /didn'?t (?:respond|reply|answer|send)|no (?:response|reply|answer)|not respond\w*|waiting (?:for|on) (?:him|her|them|the client)|لم يرد|ما رد|لا يرد|بانتظار/i.test(
            x.text,
          ),
        )
        .sort((a, b) => asMs(b.e.at) - asMs(a.e.at))[0];
      if (blocker)
        add(1, {
          risk: true,
          text: `${clean(blocker.text).replace(/[.!؟?]*$/, ".")} Ask what they need to move forward.`,
          source: "Team EOD",
          day: kuwaitDay(blocker.e.at),
        });
      const quietDays = brief.lastCall ? brief.lastCall.ago : null;
      if (!upcoming.length && quietDays !== null && quietDays > 14)
        add(2, {
          risk: true,
          text: `Still onboarding and no call in ${plural(quietDays, "day")}, with none booked. Book their next step.`,
          source: "Calls",
        });
      const heldKinds = new Set(past.map(x => kindOf([x])));
      const upKinds = new Set(upcoming.map(x => kindOf([x])));
      if (/contacting/i.test(stage) && !upKinds.has("onboarding"))
        add(0, {
          risk: true,
          text: "Book their onboarding call.",
          source: "ClickUp stage",
        });
      if (
        heldKinds.has("blueprint") &&
        !upKinds.has("launch") &&
        !heldKinds.has("launch")
      )
        add(0, {
          risk: true,
          text: "The Brand Blueprint call is done and no launch call is booked. Book the launch call.",
          source: "Calls",
        });
      const launch = past.find(x => kindOf([x]) === "launch");
      if (
        /launch/i.test(stage) &&
        launch &&
        now - asMs(launch.startsAt) > 7 * DAY &&
        !metaRows.some(r => asMs(r.at) > asMs(launch.startsAt))
      )
        add(0, {
          risk: true,
          text: `Not live ${plural(Math.floor((now - asMs(launch.startsAt)) / DAY), "day")} after the launch call. Ask what is blocking it${brief.promises.ours[0] ? `, starting with: ${brief.promises.ours[0].text}` : "."}`,
          source: "Calls",
        });
      if (/launch booked/i.test(stage) && !upKinds.has("launch"))
        add(1, {
          risk: true,
          text: 'The card says "launch booked", but no launch call is booked in GoHighLevel. Book it, or fix the stage.',
          source: "ClickUp stage",
        });
      if (kickoff) {
        const open = SETUP.filter(([re]) => {
          const v = formAnswer(kickoff, re);
          return v && NOT_DONE.test(v);
        }).map(([, label]) => label);
        if (open.length)
          add(1, {
            risk: true,
            text: `Still open from the ${kuwaitDay(kickoff.submittedAt)} kickoff: ${open.join(", ")}.`,
            source: "Kickoff form",
            day: kuwaitDay(kickoff.submittedAt),
          });
      }
    }
    if (diagnosis?.top)
      add(5, {
        text: `${diagnosis.top.title}.${diagnosis.top.fixes?.[0] ? ` ${diagnosis.top.fixes[0]}` : ""}`,
        source: "Numbers",
      });
    for (const p of problems.slice(0, 1)) {
      const lead =
        /^([^:：]{3,60})[:：]/.exec(p.text)?.[1] ??
        firstSentence(p.text).slice(0, 80);
      add(6, {
        text: `Follow up on "${lead}" from the ${p.day} call: has it improved since?`,
        source: p.source,
        day: p.day,
      });
    }
    // A step already shown as a risk's "Next:" is not repeated.
    const inRisks = (t: string) =>
      risks.some(x =>
        (x.d.nextSteps ?? []).some(st => norm(String(st)).includes(norm(t))),
      );
    const ours = (
      brief.promises.ours.length ? brief.promises.ours : brief.promises.steps
    ).filter(l => !inRisks(l.text));
    const first = ours[0]
      ? `${ours[0].label ? `${ours[0].label}: ` : ""}${ours[0].text}`
      : "";
    if (ours.length)
      add(7, {
        text:
          ours.length === 1
            ? `Check our next step is done before the call: ${first}`
            : `Check our ${ours.length} next steps are done before the call, starting with: ${first}`,
        source: ours[0].source,
        day: ours[0].day,
      });
    // Their promise, unless it waits on one of ours (receipts we have to send first).
    const askable = brief.promises.theirs.find(
      t => !brief.promises.ours.some(o => sharedWords(o.text, t.text) >= 0.4),
    );
    if (askable)
      add(8, {
        text: `Ask if they did it: ${askable.text}`,
        source: askable.source,
        day: askable.day,
      });
    const ask = recent.flatMap(d =>
      (d.clientRequests ?? []).map(r => ({ r, d })),
    )[0];
    if (ask)
      add(9, {
        text: `They asked for: ${clean(ask.r)}`,
        source: "ClickUp card",
        day: kuwaitDay(ask.d.at),
      });
    if (
      told.length &&
      mode === "live" &&
      real.length &&
      now - real[0].at < 14 * DAY
    )
      add(10, {
        text: `Tell them what we changed on their ads (${span}): we ${told.join(", ")}.`,
        source: "Meta",
      });
    if (
      brief.lastCall &&
      brief.lastCall.ago >= 1 &&
      brief.lastCall.ago <= 7 &&
      kindOf(lastRows) === "checkin" &&
      !lastForm &&
      !checkinForms.some(f => asMs(f.submittedAt) >= lastTime - 3_600_000)
    )
      add(11, {
        text: `No 1-1 notes form after the ${brief.lastCall.day} check-in. Fill it in so the next call starts from it.`,
        source: "1-1 form",
      });
    if (mode === "live" && timeline && (timeline.changes ?? []).length === 0)
      add(12, {
        text: "No ad changes are recorded for them in 90 days. Check their ads are live and their ad account is linked.",
        source: "Meta",
      });
    for (const a of actionable) add(13, a);
    for (const w of diagnosis?.watch ?? [])
      add(14, {
        text: `Watch: ${w.title}.${w.fixes?.[0] ? ` ${w.fixes[0]}` : ""}`,
        source: "Numbers",
      });
    if (brief.defcon?.old && mode === "live")
      add(15, {
        text: `Their mood was last recorded on ${brief.defcon.day} (${brief.defcon.value}). Ask, and update the 1-1 form.`,
        source: "1-1 form",
      });
    brief.raise = raise
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 6)
      .map(({ rank: _rank, ...line }) => line);
  }

  // ---- Gaps: every source behind that feeds the brief, in one sentence each.
  for (const k of [
    "csm-ghl-calls",
    "csm-fathom",
    "csm-checkin-form",
    "csm-eod-mentions",
  ]) {
    const s = plainStale(H(k), k, now);
    if (s) brief.gaps.push(s);
  }
  if (
    (input.otherClients ?? []).filter(o => norm(o) === norm(name)).length >= 2
  )
    brief.gaps.push(
      "Another client card has the same name; some calls and forms may be on that card.",
    );
  if (!timeline) brief.gaps.push("The call history has not loaded yet.");
  if (digests === null)
    brief.gaps.push("The ClickUp card notes could not be read.");
  return brief;
}

/** Share of the shorter text's words that appear in the other. */
function sharedWords(a: string, b: string): number {
  const wa = new Set(
    norm(a)
      .split(" ")
      .filter(w => w.length > 3),
  );
  const wb = norm(b)
    .split(" ")
    .filter(w => w.length > 3);
  if (!wa.size || !wb.length) return 0;
  return wb.filter(w => wa.has(w)).length / Math.min(wa.size, wb.length);
}

/**
 * One plain sentence for a source that is behind, for the CSM: what is
 * behind and what that means, without the sync's technical note.
 */
function plainStale(h: SourceHealth | undefined, key: string, now: number) {
  if (!isStale(h, now)) return null;
  const name = SOURCE_NAMES[key] ?? key;
  const Name = name.charAt(0).toUpperCase() + name.slice(1);
  const has = /s$/.test(name) ? "have" : "has";
  if (!h?.lastOkAt)
    return `${Name} ${has} not synced yet, so this may be incomplete.`;
  return `${Name} ${has} not updated since ${kuwaitWhen(h.lastOkAt)}, so anything after that may be missing.`;
}
