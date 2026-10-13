import {
  answerText,
  CALL_NAMES,
  isStale,
  SOURCE_NAMES,
  type SourceHealth,
  type Timeline,
  type TimelineCall,
  type TimelineEod,
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
 * The rules were tuned on every client's live data on 12 Oct 2026 (two
 * rounds of review over 53 clients): one name matcher per client, an EOD
 * line counts only where a sentence names the client, stopped clients get
 * why they stopped instead of nags, every step has an owner (ours or
 * theirs), an angry client or a change the client made themselves comes
 * first, an on/off switch is never a talking point, and a loose end the
 * timeline contradicts is dropped.
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
  /** Who the CSM talks to: the name on their newest booking. */
  contact?: string;
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
    /** Next steps from the call summary that both sides own. */
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

/** Midnight (UTC) of the Kuwait calendar day, for whole-day sums. */
const dayStart = (at: number) => Date.parse(`${dayKey(at)}T00:00:00Z`);

/** One readable line from markdown or a pasted note. */
export function clean(text: unknown): string {
  return String(text ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\\([~*_$])/g, "$1")
    .replace(/^\s*(?:[-*•▪◦]|\d+[.)])\s+/, "")
    .replace(/^\s*-(?=\p{L})/u, "")
    .replace(/^\s*_\s+/, "")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const norm = (s: string) =>
  clean(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** WhatsApp @-mentions arrive as raw account numbers; show them as a mention. */
export function waMentions(text: string): string {
  return text.replace(/@\d{8,}/g, "@mention");
}

/** A WhatsApp message as one readable line: a voice note says so. */
function waText(m: { body: string | null; kind: string }, max = 0) {
  const t = clean(waMentions(m.body ?? ""));
  if (!t) return m.kind === "audio" ? "A voice note." : `A ${m.kind}.`;
  if (/^https?:\/\/\S+$/i.test(t)) {
    const host = t.replace(/^https?:\/\/(www\.)?/i, "").split(/[/?#]/)[0];
    return `A link (${host})`;
  }
  return max && t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

const firstSentence = (s: string) => {
  const m = /^(.{20,}?[.!?؟])(\s|$)/u.exec(s);
  return m ? m[1] : s;
};

/** Cut a quote at a word boundary, with an ellipsis when cut. */
const cut = (s: string, max: number) => {
  const t = clean(s);
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const at = head.lastIndexOf(" ");
  return `${(at > max * 0.6 ? head.slice(0, at) : head).replace(/[\s,،;:.-]+$/, "")}…`;
};

const capitalise = (s: string) =>
  /^[a-z]/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/** A line ends with a full stop unless it already ends with one. */
const stop = (s: string) => {
  const t = s.trim().replace(/[\s;؛,،:]+$/, "");
  return /[.!?؟…)"'”]$/.test(t) ? t : `${t}.`;
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

const times = (n: number) =>
  n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;

const daysAgo = (now: number, at: number) =>
  Math.max(0, Math.round((dayStart(now) - dayStart(at)) / DAY));

export type Step = { owner?: string; text: string };

/**
 * A Fathom summary's sections by heading. Every stored summary uses the
 * same headings, in Arabic or English: purpose, key takeaways, topics,
 * next steps. Next steps are often grouped under an owner ("Abdullah:"),
 * and each step keeps its owner. Topics are kept whole (every bullet) so a
 * "Problem:" bullet under them can be followed up.
 */
function summaryParts(summary?: string | null): {
  takeaways: string[];
  nextSteps: Step[];
  topics: string[];
} {
  const raw = {
    takeaways: [] as string[],
    nextSteps: [] as string[],
    topics: [] as string[],
  };
  if (!summary) return { takeaways: [], nextSteps: [], topics: [] };
  let current: keyof typeof raw | null = null;
  for (const text of summary.split(/\r?\n/)) {
    const line = text.trimEnd();
    const head = /^\s*(#{1,6})\s*(.+)$/.exec(line);
    if (head) {
      // A sub-heading inside the topics stays in the topics.
      if (head[1].length >= 3 && current === "topics") continue;
      const h = head[2];
      current = /key takeaways|key points|أبرز النقاط|النقاط الرئيسية/i.test(h)
        ? "takeaways"
        : /next steps|action items|الخطوات التالية|الخطوات القادمة/i.test(h)
          ? "nextSteps"
          : /topics|discussion|المواضيع|المحاور/i.test(h)
            ? "topics"
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
  return {
    takeaways: takeLines(raw.takeaways),
    nextSteps: steps,
    topics: raw.topics
      .filter(isBullet)
      .map(clean)
      .filter(t => t.length >= 3),
  };
}

export function summarySections(summary?: string | null): {
  takeaways: string[];
  nextSteps: Step[];
} {
  const { takeaways, nextSteps } = summaryParts(summary);
  return { takeaways, nextSteps };
}

type Answered = { answers?: { title?: string | null; value: unknown }[] };

function formAnswer(form: Answered | undefined | null, re: RegExp) {
  if (!form) return "";
  for (const a of form.answers ?? [])
    if (re.test(String(a.title ?? ""))) return answerText(a.value).trim();
  return "";
}

/** Every answer whose title matches: some forms repeat a title. */
function formAnswers(form: Answered | undefined | null, re: RegExp) {
  if (!form) return [];
  return (form.answers ?? [])
    .filter(a => re.test(String(a.title ?? "")))
    .map(a => answerText(a.value).trim())
    .filter(Boolean);
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

/** The call an onboarding stage waits on next. */
function expectedCall(stage: string, heldKinds: Set<string>) {
  if (heldKinds.has("launch")) return "next check-in";
  if (/launch/i.test(stage)) return "launch call";
  if (/blueprint/i.test(stage))
    return heldKinds.has("blueprint") ? "launch call" : "Brand Blueprint call";
  if (/contacting|onboarding|kick ?off/i.test(stage)) return "onboarding call";
  return "next call";
}

const OWNER_OURS =
  /^(mahara(?: ?media)?|مهارة|we|our team|csm|account manager|systems manager|media buyer|video editor|creative director|strategist|tech|call cent(?:er|re)|creative|ads|مركز الاتصال|فريق مهارة)(?:\s*\([^)]{1,30}\))?\s*[:：-]\s*/i;
const OWNER_THEIRS = /^(client|the client|العميل|your side|you)\s*[:：-]\s*/i;
const BOTH = /^(both|everyone|all|all parties|كلاهما|الجميع|الطرفان)$/i;

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
/** Kinds counted once per object (the evidence names the ad), not per event. */
const PER_OBJECT = new Set(["ad edited"]);
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
/** Words that say a client left, paused or will not continue: never billing words. */
const EXIT_WORDS =
  /\b(churn\w*|paus\w*|stopp\w*|cancel\w*|off-?board\w*|not renew\w*|ended|not continuing|no launch date|won'?t be chased|left us|terminat\w*)\b|توقف|إيقاف|ايقاف|ألغ|الغاء|إلغاء|انسحب/i;
/** "Stopped high-cost videos": an exit word about an ad, not the client. */
const AD_OBJECT =
  /^\s+(?:(?:the|a|an|their|all|two|three|some|high-cost|\d+|"[^"]*"|and)\s+){0,4}(?:\S+\s+)?(?:videos?|vids?|ads?|ad sets?|campaigns?|reels?|creatives?|google|tiktok|budget|search|posts?)\b|^\s*(?:\S+\s+)?(?:فيديو|إعلان|اعلان|حملة|الحملة|الإعلانات)/i;
/** A stop reason that gives its cause or the way back. */
const CAUSE =
  /\b(because|due to|since they|relaunch\w*|will restart|restart\w*|as they)\b|بسبب|لأن|لان/i;
/** Billing words: only ever a separate "Last billing note". */
const BILLING_WORDS =
  /\b(invoice\w*|payment|paid|pay|refund\w*|billing)\b|فاتورة|الفاتورة|دفع|الدفعة/i;
/** The newest line that hints at why, when nobody wrote a stop reason. */
const RENEWAL =
  /\brenew\w*|no (?:response|reply|answer|approval)|still no\b|didn'?t (?:repl\w*|respond\w*|answer\w*)|not respond\w*|no leads|no messages|complain\w*|unhappy|not happy|لم يرد|ما رد|شكوى/i;
/** A takeaway about money or a disagreement is always raised. */
const MONEY_WORDS =
  /\b(invoice|billing|contract|dispute|complain\w*|refund|overcharg\w*|postpon\w*)\b|فاتورة|الفوترة|العقد|خلاف|شكوى|استرداد|تأجيل الدفع|الدفعة/i;
/** A client who is upset: raised before anything else. */
const ESCALATION =
  /\b(angry|upset|frustrat\w*|furious|complain\w*|threat\w* to (?:leave|cancel)|wants? to cancel|cancel the contract|refund|unhappy|disappointed)\b|زعلان|غاضب|منزعج|مستاء|إلغاء العقد|استرجاع/i;
/** A problem named on the last call, to follow up. */
const PROBLEM =
  /\b(none qualified|not qualified|no(?:t a single)? (?:leads?|bookings?|shows?)|poor|weak|problem\w*|issues?|blocked|low quality|didn'?t show|concern\w*|worr\w*|unhappy with|not reflect\w*|bottleneck|constraint)\b|(?<![\d.])0\s?%|مشكل\w*|سيئة|ضعيف|ضعف|لا أحد|غير مؤهل|مخاوف|قلق|غير راض\w*|لا تعكس/i;
/** A topic bullet that names the problem itself. */
const PROBLEM_LABEL =
  /^(problems?|issues?|main (?:issue|problem)|root cause|bottleneck|primary bottleneck|المشكلة|المشكلات|المشاكل|السبب الجذري)\s*[:：]/i;
/** A takeaway that is something we offered them, not a problem. */
const OFFER =
  /فرصة|عرض|opportunit\w*|upsell|\boffer\b|package|proposal|حزمة|باقة/i;
/** A takeaway that states the plan, used when the summary has no next steps. */
const PLAN_LABEL =
  /^(?:the )?(plan|next steps?|action plan|الخطة|الخطوات التالية)\s*[:：]/i;
/** A takeaway that only states the next meeting's time; the strip carries the booking. */
const MEETING_TIME =
  /(next|upcoming|following) (meeting|call)|^next steps?:.*\b(meeting|call)\b|الاجتماع (القادم|التالي)|موعد الاجتماع|^الخطوة التالية:\s*اجتماع/i;
/** A step that only schedules, joins or attends a meeting. */
const MEETING_STEP =
  /\b(schedul\w*|book|join|attend|set up|arrange)\b.{0,60}\b(call|meeting|session|review|check-?in)\b|next check-?in is scheduled|^(?:follow-?up |next |review |strategy )?(?:call|meeting|check-?in)\s+(?:on|at|is)\b|(جدولة|حضور|حجز|الانضمام|عقد)\s+(?:\S+\s+){0,2}(مكالمة|اجتماع|جلسة)|الاجتماع للمتابعة/i;
/** A meeting with us that we promised to book (never a lead's appointment). */
const PROMISED_MEETING =
  /\b(schedul\w*|book|set up|arrange)\b.{0,40}\b(next|follow-?up|review|strategy|check-?in|our)\b.{0,20}\b(call|meeting|review|session)\b|\bnext (?:week'?s )?(?:strategy )?(?:call|meeting|review|check-?in)\b|(حجز|جدولة|ترتيب|تحديد موعد)\s+(اجتماع|مكالمة)/i;
const NOT_OUR_MEETING =
  /appointment|\blead|site visit|engineer|زيارة|العملاء المحتملين|موعد العميل/i;
/** An EOD line that is a KPI roll-up rather than something that happened. */
const KPI_LINE = /\bcpl\b|cost per|out of kpi|account summary|cpb\b|\$\d/i;
/** An EOD line that records contact, delivery or billing with the client. */
const EVENT_LINE =
  /\b(call|meeting|met|spoke|talked|delivered|sent|paid|payment|invoice\w*|complain\w*|cancel\w*|launch\w*|win|won|closed|visit|approv\w*|renew\w*|reply|replied|respond\w*|follow\w* up|checked|reminded|churn\w*|paus\w*|stopp\w*|completed|finali[sz]ed)\b|اجتماع|مكالمة|اتصال|زيارة|دفع/i;
/** Our own tooling work: never news for a stopped client. */
const TOOLING =
  /\b(sync\w*|backfill\w*|workbooks?|apps? scripts?|dry_run|deploy\w*|columns?|dashboard|formula\w*|webhook\w*|supabase|idempotent|repointed|migration|scenario|token|endpoint|pipeline|dialect|call data|chatbot)\b/i;
/** Plan and failure words: a line with them never records a held meeting. */
const NOT_HELD =
  /\b(will|shall|should|request\w*|postpon\w*|didn'?t attend|not done|no response|no reply|didn'?t (?:reply|respond|answer)|waiting|to discuss|booked|scheduled|planned|pending|tomorrow|tmrw|next week|hasn'?t|haven'?t)\b/i;
/** A contact attempt that got nothing back is not contact. */
const NO_CONTACT =
  /no (?:response|reply|answer|approval)|didn'?t (?:repl\w*|respond\w*|answer\w*)|hasn'?t (?:repl\w*|respond\w*)|waiting (?:for|on) (?:his |her |their |a )?(?:reply|response|answer)|request\w*|postpon\w*|didn'?t attend|not done|still no\b|\b(?:will|shall)\s+(?:do|have|be)\s+(?:on\s+)?(?:the\s+|a\s+)?(?:call|meeting)|meeting shall|\bwill do (?:the )?meeting|fixed (?:a )?meeting|\bdid (?:a |the )?plan\b|\bprepar\w*/i;
/** A meeting or call the team booked outside GoHighLevel. */
const BOOKED_MEETING =
  /\b(booked|scheduled|set up|arranged|fixed)\s+(?:a|the|our|another)?\s*(?:follow-?up\s+)?(?:meeting|call|check-?in|zoom)\b|(حجزنا|حجزت|تم حجز)\s+(?:اجتماع|موعد|مكالمة)/i;
/** A first-person plan in an EOD: what someone will do, not what happened. */
const PLAN_SENTENCE =
  /^(?:(?:tomorrow|tonight|next week|today\s*(?:\([^)]*\))?)\s*,?\s*(?:i|we)\s+(?:will|'ll|shall|plan|am going)|(?:i|we)\s+(?:will|'ll|shall|plan to|am going to)\b|i'?ll\b)/i;

const ROLE: Record<string, string> = {
  csms: "account manager",
  csm: "account manager",
  tech: "systems manager",
  media: "media buyer",
  csr: "client sales rep",
};
const CALL_CENTRE_ROLE = /client sales rep|call cent/i;
const ACCOUNT_ROLE = /account manager|csm/i;

/**
 * EOD labels. Some say nothing (strip them), some carry meaning (keep them
 * as a short prefix), some mark a plan (drop the line), and "Call Summary"
 * from the account manager is contact with the client.
 */
const EOD_LABEL =
  /^\s*(?:[-•]\s*)?(call summary|account summary|day summary|summary|out ?of ?kpi|clients? lost|wins?|notes?|roll ?up|update|videos? completed(?: today)?(?: \([^)]*\))?|scripts? completed|videos? briefed|in progress(?: \/ pending)?|videos in progress(?: \/ pending)?(?: \([^)]*\))?|pending|revisions? handled(?: today)?(?: \([^)]*\))?|tomorrow'?s (?:plan|top 3 priorities)|blockers?|recommendations?|new content ideas|daily expectations done)\s*(?::|\s+-\s+|\s+—\s+)\s*(?:-\s*)?/i;
const LABEL_SHOWN: [RegExp, string][] = [
  [/^wins?$/i, "Win"],
  [/^blockers?$/i, "Blocker"],
  [/^videos? completed/i, "Videos completed"],
  [/^scripts? completed/i, "Scripts completed"],
  [/^videos? briefed/i, "Videos briefed"],
  [/in progress|^pending$/i, "In progress"],
];
const LABEL_PLAN =
  /^(tomorrow'?s (?:plan|top 3 priorities)|new content ideas)$/i;

// ---- Client names --------------------------------------------------------

/** Words between name parts that a writer may drop or swap (Joe and Sera, Joe & Sera). */
const CONNECTOR = /^(and|&|w|و|of|the|for|n|x|\+|by)$/i;
/** Words in a legal name that say nothing about which client it is. */
const GENERIC =
  /^(company|companies|co|group|design|designs|contracting|contractors?|construction|consult\w*|engineering|engineers?|general|limited|ltd|llc|wll|inc|projects?|interior|industries|industry|trading|holding|office|bureau|buildings?|est|establishment|studio|kw|sa|com|شركة|شركه|مؤسسة|مكتب|للاستشارات|الهندسية|الهندسيه|للمقاولات|للتجارة)$/i;
/** Ordinary English words: alone, they match only as written or in a client position. */
const ORDINARY = new Set(
  `automation client internal lifecycle test about above active ad ads all alpha arch art arts best big black blue bold build builders building city classic clear core crown daily day decor deep depth design desert digital diamond dream east elite emerald excellence first five fine focus fresh future global gold golden grand green gulf home house ideal inverse key last life light line link luxury main marble mass master merge modern more mountain nest new next north ocean one open overview path peak perfect plan plus point premium prime pro professional pure quality red render rise rising road rock royal shades silver sky smart space square star step stone sun target tech technology the top touch tower trust union unique united urban value view vision west white wood world`.split(
    " ",
  ),
);

/** Consonant skeleton of a name, the same for عبد العزيز and Abdulaziz. */
const AR_LATIN: Record<string, string> = {
  ا: "a",
  أ: "a",
  إ: "a",
  آ: "a",
  ب: "b",
  ت: "t",
  ث: "th",
  ج: "j",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "z",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  غ: "gh",
  ف: "f",
  ق: "k",
  ك: "k",
  ک: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  و: "w",
  ي: "y",
  ی: "y",
  ى: "y",
};
function skeleton(s: string): string {
  return [...s.toLowerCase().replace(/[\u064B-\u0652\u0640]/g, "")]
    .map(ch => AR_LATIN[ch] ?? ch)
    .join("")
    .replace(/q/g, "k")
    .replace(/ph/g, "f")
    .replace(/[^a-z]/g, "")
    .replace(/[aeiouwy]/g, "")
    .replace(/(.)\1+/g, "$1");
}
/** A person's first name, with "Abdul Aziz" and "عبد العزيز" kept whole. */
function firstName(s: string): string {
  const t = clean(s)
    .replace(/[^\p{L}\s'-]/gu, " ")
    .trim()
    .split(/\s+/);
  if (t.length > 1 && /^(abd|abdul|abdel|abu|abo|عبد|أبو|ابو)$/i.test(t[0]))
    return `${t[0]}${t[1]}`;
  return t[0] ?? "";
}

/**
 * Whether a WhatsApp speaker is one of the team. The team post in client
 * groups from their own phones ("Rasem Abdel all", "Nada | MaharaMedia"), so
 * the inbox mirror files those as inbound. A name with Mahara in it is the
 * team; a full name is when its first two words are a team member's first two
 * (so "Ahmed Salama" is not a team "Ahmed"); a lone name is when it is, letter
 * for letter, one of a team member's names ("Sabry" for "Ahmed Sabry", "Aziz"
 * for "Abdulaziz"). Within one script a lone name is not matched by its
 * consonants ("Umar" and "Maria" share them); across scripts it is, so "دانيا"
 * is the team's Daniya.
 */
export function teamSpeaker(
  speaker: string | null | undefined,
  teamNames: string[],
): boolean {
  const s = clean(String(speaker ?? ""));
  if (!s) return false;
  if (/mahara|مهارة/i.test(s)) return true;
  const parts = (n: string) =>
    clean(n)
      .replace(/[^\p{L}\s]/gu, " ")
      .split(/\s+/)
      .map(skeleton)
      .filter(Boolean);
  const sp = parts(s);
  if (!sp.length) return false;
  const words = (n: string) =>
    clean(n)
      .toLowerCase()
      .replace(/[^\p{L}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
  if (sp.length === 1) {
    const w = words(s)[0] ?? "";
    if (w.length < 3) return false;
    const arabic = (x: string) => /[\u0600-\u06FF]/.test(x);
    return teamNames.some(n => {
      const tw = words(n);
      if (tw.some(t => t === w || t.replace(/^(abdul|abdel|abd|عبد|عبدال)/, "") === w))
        return true;
      // An Arabic spelling of an English first name, or the other way round.
      const first = tw[0] ?? "";
      return (
        arabic(w) !== arabic(first) &&
        sp[0].length >= 2 &&
        sp[0] === skeleton(first)
      );
    });
  }
  if (sp[0].length < 2) return false;
  return teamNames.some(n => {
    const tp = parts(n);
    return tp.length >= 2 && sp[0] === tp[0] && sp[1] === tp[1];
  });
}

/**
 * The client's newest message in a chat when nothing from us (a reply, or a
 * team member writing in the group) came after it: the chat is waiting on us.
 */
export function clientWaiting<
  M extends { direction: string; speaker: string | null; at: number },
>(messages: M[], teamNames: string[]): M | undefined {
  let client: M | undefined;
  let ours = Number.NEGATIVE_INFINITY;
  for (const m of messages) {
    const theirs =
      m.direction === "inbound" && !teamSpeaker(m.speaker, teamNames);
    if (theirs) {
      if (!client || m.at > client.at) client = m;
    } else if (m.at > ours) ours = m.at;
  }
  return client && client.at > ours ? client : undefined;
}

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isLatin = (w: string) => /^[A-Za-z]/.test(w);
const B = "(?<![\\p{L}\\p{N}])";
const A = "(?![\\p{L}\\p{N}])";
const GAP =
  "(?:\\s*(?:&|\\+|/|-|–)\\s*|\\s+(?:(?:and|w|of|the|n|x)\\s+)?|\\s*و\\s*)";

/** One word of a name: "Al-Khalil" for Alkhalil, "Tech" for Technology. */
function wordPattern(w: string, prefix: boolean, slip = false) {
  let p = esc(w);
  // One letter off after the first ("North Golf" for North Gulf).
  if (slip && isLatin(w) && w.length >= 4 && w.length <= 8)
    p = [...w]
      .map((_, i) =>
        i === 0 ? esc(w) : `${esc(w.slice(0, i))}[a-z]${esc(w.slice(i + 1))}`,
      )
      .join("|")
      .replace(/^/, "(?:")
      .concat(")");
  if (/^al[a-z]{3,}/i.test(w))
    p = `${esc(w.slice(0, 2))}[-\\s]?${esc(w.slice(2))}`;
  if (prefix && isLatin(w) && w.length >= 6) {
    let tail = "";
    for (const ch of [...w.slice(4)].reverse()) tail = `(?:${esc(ch)}${tail})?`;
    p = `${esc(w.slice(0, 4))}${tail}`;
  }
  return isLatin(w) ? `${p}(?:'?s)?` : p;
}

function nameWords(name: string) {
  return name
    .replace(/\.(?:kw|sa|co|com|ae|qa|net)\b/gi, " ")
    .replace(/[^\p{L}\p{N}&+]+/gu, " ")
    .split(/\s+/)
    .filter(w => w && !CONNECTOR.test(w));
}
const distinctWords = (name: string) =>
  nameWords(name).filter(w => !GENERIC.test(w) && w.length >= 2);

/** The first distinctive word, when it alone names one client (Liwan, Castello). */
function firstWordOf(name: string): string | null {
  const d = distinctWords(name);
  const w = d[0];
  if (!w || d.length < 2 || !isLatin(w) || w.length < 4) return null;
  if (ORDINARY.has(w.toLowerCase())) return null;
  return w.toLowerCase();
}

type Matcher = { res: RegExp[]; words: Set<string> };

/** Every way one name is written in free text, as regexes. */
function aliasPatterns(name: string, single: Set<string>): RegExp[] {
  const tokens = nameWords(name);
  const d = distinctWords(name);
  if (!d.length) return [];
  const out: RegExp[] = [];
  const gen = "(?:[\\p{L}]+)";
  if (d.length >= 2)
    out.push(
      new RegExp(
        `${B}${wordPattern(d[0], false)}${GAP}(?:${gen}${GAP}){0,2}?(?:${wordPattern(d[1], true)}|${wordPattern(d[1], false, true)})${A}`,
        "iu",
      ),
    );
  else {
    const w = d[0];
    if (w.length >= 3) {
      if (isLatin(w) && ORDINARY.has(w.toLowerCase())) {
        // An ordinary word (Render, Overview) matches as a name only as
        // written, in capitals, or where a name sits ("met with render").
        const title = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        const forms = [...new Set([w, title, w.toUpperCase()])]
          .map(esc)
          .join("|");
        out.push(new RegExp(`${B}(?:${forms})(?:'?s)?${A}`, "u"));
        out.push(
          new RegExp(
            `(?<=\\b(?:with|for|from|client|clients|called|contacted|met|reminded)\\s+)${esc(w)}${A}`,
            "iu",
          ),
        );
        out.push(
          new RegExp(
            `^\\s*${esc(w)}(?=\\s*[-–:]|\\s+(?:should|has|have|had|is|was|were|did|didn'?t|will|wants?|needs?|replied|sent|said|asked|agreed|paid|approved|signed)\\b)`,
            "iu",
          ),
        );
      } else out.push(new RegExp(`${B}${wordPattern(w, false)}${A}`, "iu"));
    }
    // "Mass Design", "JG design": the name with its first generic word.
    if (tokens.length >= 2)
      out.push(
        new RegExp(
          `${B}${wordPattern(tokens[0], false)}${GAP}${wordPattern(tokens[1], false)}${A}`,
          "iu",
        ),
      );
  }
  const first = firstWordOf(name);
  if (first && single.has(first))
    out.push(new RegExp(`${B}${wordPattern(first, false)}${A}`, "iu"));
  return out;
}

const names = (m: Matcher, s: string) => m.res.some(r => r.test(s));
/** The earliest place a name starts in the text, or -1. */
function nameIndex(m: Matcher, s: string) {
  let at = -1;
  for (const r of m.res) {
    const x = r.exec(s);
    if (x && (at < 0 || x.index < at)) at = x.index;
  }
  return at;
}
/** How long the name is when the text starts with it, else 0. */
function nameLength(m: Matcher, s: string) {
  for (const r of m.res) {
    const x = r.exec(s);
    if (x && x.index === 0) return x[0].length;
  }
  return 0;
}
/** Remove the client's own name and the dash after it from the start of a line. */
function stripOwnName(m: Matcher, s: string) {
  for (const r of m.res) {
    const x = r.exec(s);
    if (!x || x.index > 2) continue;
    const rest = s.slice(x.index + x[0].length);
    // "Liwan Limited Construction ... — cost per booking": the rest of the name, then the dash.
    const sep = /^((?:\s+[\p{L}&.]+){0,6}?)\s*(?:—|–|-|:)\s*/u.exec(rest);
    if (
      sep?.[1]
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .every(w => m.words.has(w.toLowerCase()))
    )
      return capitalise(rest.slice(sep[0].length));
  }
  return s;
}

/** A short name from a call title: "QA Tech Launch Call 🚀", "Aziz X Fadi (Castello)". */
function titleName(title: string): string {
  const paren = /\(([^)]+)\)/.exec(title)?.[1];
  let t = paren ?? title;
  t = t.split(/,/)[0];
  t = t
    .split(/\s+(?:x|and|&|with)\s+/i)
    .filter(p => !/mahara|aziz|waheedi/i.test(p))
    .join(" ");
  t = t
    .replace(
      /\b(official|impromptu|zoom|onboarding|launch|check ?in|brand blueprint|blueprint|kick ?off|call|meeting|session)\b/gi,
      " ",
    )
    .replace(/[^\p{L}\p{N}.\s&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^[A-Za-z]/.test(t) && distinctWords(t).length ? t : "";
}

/** The person on a booking: "Abdullah Alaidaros - Check In". */
function bookingName(title: string): string {
  const m =
    /^(.+?)\s*[-–]\s*(?:check ?in|onboarding|launch|brand blueprint|blueprint|kick ?off|strategy|review|follow ?up)\b/i.exec(
      title,
    );
  if (!m) return "";
  return m[1]
    .replace(/[^\p{L}\s'.-]/gu, " ")
    .replace(/\s+\.(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.-]+$/, "")
    .trim();
}

// ---- Team EODs ------------------------------------------------------------

type EodUnit = {
  text: string;
  /** The text without its label prefix ("Blocker:"), for quoting as a reason. */
  bare: string;
  /** An account manager's "Call Summary" or a held meeting: contact with the client. */
  contact: boolean;
  held: boolean;
  booked: boolean;
  exitLabel: boolean;
  callCentre: boolean;
};

/**
 * An EOD passage, cut to the sentences and list items that name this
 * client. A label that says nothing goes, a label that means something
 * stays as a short prefix, plans and the cockpit's advice after "→" go,
 * and a line that is only the client's name says nothing and goes too.
 */
function eodParts(
  excerpt: string,
  me: Matcher,
  others: Matcher[],
  role: string,
): EodUnit[] {
  const out: EodUnit[] = [];
  const lines = excerpt.split(/\r?\n/);
  const callCentre = CALL_CENTRE_ROLE.test(role);
  lines.forEach((raw, li) => {
    let line = raw.replace(/&amp;/g, "&").trim();
    let label = "";
    for (let i = 0; i < 2; i++) {
      const m = EOD_LABEL.exec(line);
      if (!m) break;
      label = label || m[1].toLowerCase();
      line = line.slice(m[0].length);
    }
    if (LABEL_PLAN.test(label)) return;
    const shown = LABEL_SHOWN.find(([re]) => re.test(label))?.[1];
    const listy =
      /^\s*-\s/.test(line) || (line.match(/\s[-–]\s/g)?.length ?? 0) >= 2;
    const pieces = line
      .split(listy ? /\s+[-–]\s+|^\s*-\s+/ : /(?!)/)
      .flatMap(p => p.split(/\s+•\s+|\s+·\s+|(?<=[.!?؟;؛])\s+(?=\S)/));
    pieces.forEach((p0, pi) => {
      let p = p0
        .replace(/\s*→.*$/, "")
        .replace(/^\s*[-•_*]+\s*/, "")
        .trim();
      if (p.length < 3) return;
      if (!names(me, p)) return;
      if (PLAN_SENTENCE.test(p)) return;
      // Starts mid-sentence: a cut-off bracket from the line before.
      if ((p.match(/\)/g)?.length ?? 0) > (p.match(/\(/g)?.length ?? 0)) return;
      // A list of many clients says little about this one.
      if (others.filter(o => names(o, p)).length >= 2) return;
      const exitLabel = /clients? lost/i.test(label);
      // Call centre wins are meetings booked for the client's leads.
      if (callCentre && /^wins?$/.test(label) && /meeting/i.test(p)) {
        out.push({
          text: "Call centre booked a meeting for one of their leads",
          bare: "Call centre booked a meeting for one of their leads",
          contact: false,
          held: false,
          booked: false,
          exitLabel: false,
          callCentre: true,
        });
        return;
      }
      p = stripOwnName(me, p).replace(
        /\(\s*(?:new\s+)?client:\s*([^)]*)\)/gi,
        (m, inner: string) => (names(me, inner) ? " " : m),
      );
      // "Client: Safad" only repeats the name.
      const tag = /\b(?:new\s+)?client:\s*/gi;
      for (let m = tag.exec(p); m; m = tag.exec(p)) {
        const len = nameLength(me, p.slice(m.index + m[0].length));
        if (!len) continue;
        p = `${p.slice(0, m.index)} ${p.slice(m.index + m[0].length + len)}`;
        tag.lastIndex = m.index + 1;
      }
      p = p
        .replace(/\(\s*\)/g, " ")
        .replace(/\s+[—–]\s+/g, ", ")
        .replace(/\s+/g, " ")
        .trim();
      // "2 Videos Completed and delivered": the count reads as it is.
      if (shown && /completed|briefed/i.test(shown))
        p = p.replace(
          /^(\d+)\s+(videos?|vids?|reels?|scripts?)\b/i,
          (_m, n: string, w: string) => `${n} ${w.toLowerCase()}`,
        );
      // Only the name (and a label word or two) left: nothing to say.
      const rest = me.res
        .reduce(
          (s, r) => s.replace(new RegExp(r.source, `${r.flags}g`), " "),
          p,
        )
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (rest.length <= 3 && !EXIT_WORDS.test(p) && !exitLabel) return;
      const last = li === lines.length - 1 && pi === pieces.length - 1;
      const open =
        (p.match(/\(/g)?.length ?? 0) > (p.match(/\)/g)?.length ?? 0);
      if (
        last &&
        (open ||
          /(?:\b(?:since|on|to|the|a|an|and|of|for|with|in|at|by|from|that|which|is|are|was|were|not|but|or|as|into|until|then)|[,(:])\s*$/i.test(
            p,
          ))
      )
        p = `${p.replace(/[\s,;:(]+$/, "")}…`;
      p = p.replace(/[;؛]$/, "");
      const isContact = ACCOUNT_ROLE.test(role) && /call summary/.test(label);
      const held = heldMeeting(me, p);
      out.push({
        text: shown ? `${shown}: ${p}` : capitalise(p),
        bare: capitalise(p),
        // A Call Summary is contact when it is about them (named near the start).
        contact:
          held || (isContact && !NO_CONTACT.test(p) && nameIndex(me, p) <= 45),
        held,
        booked: !callCentre && BOOKED_MEETING.test(p),
        exitLabel,
        callCentre: false,
      });
    });
  });
  return out;
}

/** Joined parts: no ";." and no full stop after one that has it. */
const joinParts = (parts: string[]) =>
  parts
    .map((p, i) => (i < parts.length - 1 ? stop(p) : p))
    .join(" ")
    .trim();

/**
 * A meeting that happened: a held verb with the client's name right after
 * it ("met with render", "call with olivar designs"), and no plan or
 * failure word ("will", "postponed", "no response"). "Call data" and the
 * call centre are not meetings.
 */
function heldMeeting(me: Matcher, s: string): boolean {
  // "Laith launch call done": the name, then the call, then done.
  const done =
    /\b(?:launch |onboarding |check-?in |kick-?off |blueprint )?(?:call|meeting)\s+(?:was\s+|is\s+)?(?:done|held|completed|happened)\b/i.exec(
      s,
    );
  if (done) {
    const at = nameIndex(me, s);
    if (at >= 0 && at < done.index && done.index - at <= 40) return true;
  }
  if (NOT_HELD.test(s)) return false;
  const verb =
    /\b(?:met(?: with)?|meeting with|(?:small |quick |short )?calls? with|spoke (?:with|to)|talked (?:with|to)|had (?:a|an|the|our)? ?(?:call|meeting|zoom) with|jumped on (?:a|the)? ?(?:call|meeting) with|zoom with)\s+(?:the client\s+|client\s+|someone from\s+|the team (?:at|of|from)\s+)?|اجتماع مع\s+|مكالمة مع\s+|تواصلت مع\s+/gi;
  for (const m of s.matchAll(verb)) {
    if (nameIndex(me, s.slice(m.index ?? 0)) === m[0].length) return true;
  }
  return false;
}

// ---- Forms -----------------------------------------------------------------

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
const SETUP: { re: RegExp; label: string; topic: string; name?: boolean }[] = [
  {
    re: /card linked to the account/i,
    label: "a card with funds on the ad account",
    topic: "card",
  },
  { re: /facebook access/i, label: "Facebook access", topic: "facebook" },
  {
    re: /google calendar integration|booking platform & google calendar/i,
    label: "Google Calendar",
    topic: "calendar",
  },
  { re: /mahara os access/i, label: "Mahara OS access", topic: "os" },
  { re: /^whatsapp status/i, label: "the WhatsApp group", topic: "whatsapp" },
  {
    re: /whatsapp synced/i,
    label: "WhatsApp sync to Mahara OS",
    topic: "whatsapp",
  },
  {
    re: /templated ads status/i,
    label: "templated ads approval",
    topic: "templated",
  },
  {
    re: /name of the ad account/i,
    label: "the ad account name",
    topic: "facebook",
    name: true,
  },
  {
    re: /name of the facebook page/i,
    label: "the Facebook page name",
    topic: "facebook",
    name: true,
  },
];
/** A setup answer that says it is done; anything else is still open. */
const SETUP_DONE =
  /^(true|yes|done|integrated|confirmed|access confirmed|logged in|approved|signed|complete[d]?|connected|added|ready)\b/i;
/** A name answer that is not a name yet. */
const NAME_OPEN =
  /^(pending|n\/?a|na|tbd|unknown|waiting|not yet|no|-|false)\b/i;
/** Which setup item a client step is about. */
const SETUP_TOPIC: [RegExp, string][] = [
  [/\bcard\b|payment method|funds|بطاقة|طريقة دفع|وسيلة دفع/i, "card"],
  [/calendar|تقويم/i, "calendar"],
  [/facebook|business manager|meta access|حساب meta|حساب ميتا/i, "facebook"],
  [/whatsapp|واتساب/i, "whatsapp"],
  [/templated|template ads|الإعلانات التجريبية|إعلانات تجريبية/i, "templated"],
];
/** Words in a 1-1 note that say something is broken. */
const NOTE_BLOCKER =
  /glitch\w*|not connecting|isn'?t connecting|isn'?t working|not working|blocked|error|broken|لا يعمل|مشكلة تقنية/i;
const MONEY_GOAL = /revenue goal/i;
const CURRENCY =
  /\b(kwd|kd|sar|sr|aed|qar|usd|bhd|omr|dollars?|riyals?|dinars?|dirhams?)\b|\$|دينار|ريال|درهم|دولار/i;

/** The currency a text names, as a code where it is clear. */
function currencyOf(s: string): string | null {
  if (/ريال سعودي|saudi riyal|\bsar\b|\bsr\b/i.test(s)) return "SAR";
  if (/دينار كويتي|kuwaiti dinar|\bkwd\b|\bkd\b/i.test(s)) return "KWD";
  if (/ريال قطري|qatari riyal|\bqar\b/i.test(s)) return "QAR";
  if (/درهم|\baed\b|dirham/i.test(s)) return "AED";
  if (/دولار|\busd\b|\$|dollar/i.test(s)) return "USD";
  if (/بحريني|\bbhd\b/i.test(s)) return "BHD";
  if (/عماني|\bomr\b/i.test(s)) return "OMR";
  if (/ريال|riyal/i.test(s)) return "riyals";
  if (/دينار|dinar/i.test(s)) return "dinars";
  return null;
}

/** Damaged text: most of its Arabic words are one or two letters long. */
function damaged(s: string): boolean {
  const words = s.match(/[\u0600-\u06FF]+/g) ?? [];
  if (words.filter(w => w.length === 1 && w !== "و").length >= 2) return true;
  if (words.length < 6) return false;
  return words.filter(w => w.length <= 2).length / words.length > 0.4;
}

/** 1-1 notes, split into lines: by newline and by inline " - " lists. */
function noteLines(text: string): string[] {
  const parts = text
    .split(/\r?\n|\s+-\s+(?=\S)|\s+•\s+|(?<=\.)\s+(?=\d+[.)]\s)/)
    .map(clean)
    .filter(t => t.length >= 3 && !/[:：]$/.test(t));
  // A fragment of a word or two means nothing alone: join it to the next.
  const out: string[] = [];
  let carry = "";
  for (const p of parts) {
    const t = carry ? `${carry} - ${p}` : p;
    if (t.split(/\s+/).length < 4) carry = t;
    else {
      out.push(t);
      carry = "";
    }
  }
  if (carry) {
    if (out.length) out[out.length - 1] = `${out[out.length - 1]} - ${carry}`;
    else out.push(carry);
  }
  return out;
}

/** Content words, roughly stemmed, for comparing two lines. */
const CONTENT_STOP = new Set(
  "the and with from that this have will their they them into about before after client clients mahara maharamedia need needs also then than when were been your what which there these those على إلى الى من في مع التي الذي بعد قبل لدى عند حول".split(
    " ",
  ),
);
function stem(w: string) {
  if (!/^[a-z]/.test(w)) return w.replace(/^ال(?=\S{3,})/, "");
  if (w.length > 5 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  let t = w;
  for (const suf of ["ances", "ance", "ing", "ed", "es", "s", "e"])
    if (t.length - suf.length >= 4 && t.endsWith(suf)) {
      t = t.slice(0, -suf.length);
      break;
    }
  return t;
}
function contentWords(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter(w => w.length > 3 && !CONTENT_STOP.has(w))
    .map(stem);
}
/** Share of the shorter text's words that appear in the other. */
function sharedWords(a: string, b: string): number {
  const wa = new Set(contentWords(a));
  const wb = [...new Set(contentWords(b))];
  if (!wa.size || !wb.length) return 0;
  return wb.filter(w => wa.has(w)).length / Math.min(wa.size, wb.length);
}
/** Share of a's own words that appear in b. */
function overlapOf(a: string, b: string): number {
  const wa = [...new Set(contentWords(a))];
  const wb = new Set(contentWords(b));
  if (!wa.length) return 0;
  return wa.filter(w => wb.has(w)).length / wa.length;
}

/** A step where we hand something over. */
const DELIVER =
  /^(?:\S+:\s*)?(send|share|provide|prepare|deliver|create|write|build|make|draft|set up|إرسال|ارسال|تقديم|مشاركة|إعداد|اعداد|إنشاء|انشاء|كتابة)\b/i;
/** What a deliverable is called, in English and Arabic, for "done since" checks. */
const DELIVERABLES: [string, RegExp][] = [
  ["video", /video|\bvids?\b|reels?|فيديو|مقطع|ريلز/i],
  ["script", /scripts?|نصوص|نص |سكربت/i],
  ["landing page", /landing page|صفحة هبوط|صفحة الهبوط/i],
  ["website", /website|الموقع الإلكتروني|موقع/i],
  ["logo", /\blogo|شعار/i],
];
const DONE_WORDS =
  /\b(completed?|delivered|finali[sz]ed|done|finished|sent|ready)\b/i;

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  يناير: 0,
  feb: 1,
  february: 1,
  فبراير: 1,
  mar: 2,
  march: 2,
  مارس: 2,
  apr: 3,
  april: 3,
  أبريل: 3,
  ابريل: 3,
  may: 4,
  مايو: 4,
  jun: 5,
  june: 5,
  يونيو: 5,
  jul: 6,
  july: 6,
  يوليو: 6,
  aug: 7,
  august: 7,
  أغسطس: 7,
  اغسطس: 7,
  sep: 8,
  sept: 8,
  september: 8,
  سبتمبر: 8,
  oct: 9,
  october: 9,
  أكتوبر: 9,
  اكتوبر: 9,
  nov: 10,
  november: 10,
  نوفمبر: 10,
  dec: 11,
  december: 11,
  ديسمبر: 11,
};
const WEEKDAYS: [RegExp, number][] = [
  [/\bsun(?:day)?\b|الأحد|الاحد/i, 0],
  [/\bmon(?:day)?\b|الاثنين|الإثنين/i, 1],
  [/\btue(?:s|sday)?\b|الثلاثاء/i, 2],
  [/\bwed(?:nesday)?\b|الأربعاء|الاربعاء/i, 3],
  [/\bthu(?:rs|rsday)?\b|الخميس/i, 4],
  [/\bfri(?:day)?\b|الجمعة/i, 5],
  [/\bsat(?:urday)?\b|السبت/i, 6],
];
/**
 * The day a step or risk names, counted from the day it was written: a
 * date ("28 Sep", "September 28th", "28 سبتمبر"), a weekday (the next one),
 * tomorrow or next week. Midnight UTC of that Kuwait day, or null.
 */
function namedDay(text: string, from: number): number | null {
  const base = dayStart(from);
  const year = new Date(base).getUTCFullYear();
  const at = (d: number, m: number) => {
    let t = Date.UTC(year, m, d);
    if (t < base - 180 * DAY) t = Date.UTC(year + 1, m, d);
    return t;
  };
  for (const m of text.matchAll(
    /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+|[\u0600-\u06FF]+)|([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/g,
  )) {
    const month = MONTHS[(m[2] ?? m[3] ?? "").toLowerCase()];
    const d = Number(m[1] ?? m[4]);
    if (month !== undefined && d >= 1 && d <= 31) return at(d, month);
  }
  const by =
    /\b(?:by|on|this|next|until|before)\s+((?:sun|mon|tue|wed|thu|fri|sat)\w*)|يوم\s+(\S+)/i.exec(
      text,
    );
  if (by) {
    const word = by[1] ?? by[2];
    const wd = WEEKDAYS.find(([re]) => re.test(word))?.[1];
    if (wd !== undefined) {
      const today = new Date(base).getUTCDay();
      return base + ((wd - today + 7) % 7 || 7) * DAY;
    }
  }
  if (/\btomorrow\b|غد[اًا]?|غدًا|بكرة/i.test(text)) return base + DAY;
  if (/\bnext week\b|الأسبوع (?:القادم|المقبل)/i.test(text))
    return base + 7 * DAY;
  return null;
}

export function buildBrief(input: BriefInput): Brief {
  const { now, client: c, timeline, digests, diagnosis } = input;
  const calls = timeline?.calls ?? [];
  const forms = timeline?.forms ?? [];
  const health = timeline?.health ?? [];
  const H = (k: string): SourceHealth | undefined =>
    health.find(h => h.key === k);
  const mode = modeOf(c.stage);
  const stage = String(c.stage ?? "");
  const name = String(c.name ?? timeline?.clientName ?? "");
  const newestOf = (kind: string) =>
    forms
      .filter(f => f.kind === kind)
      .sort((a, b) => asMs(b.submittedAt) - asMs(a.submittedAt))[0];
  const onboarding = newestOf("onboarding");
  const kickoff = newestOf("kickoff");

  // ---- Names: one matcher for this client, one for every other client.
  const otherNames = [
    ...new Map(
      (input.otherClients ?? [])
        .filter(o => o && norm(o) !== norm(name))
        .map(o => [norm(o), o] as const),
    ).values(),
  ];
  const firstCount = new Map<string, number>();
  for (const n of [name, ...otherNames]) {
    const f = firstWordOf(n);
    if (f) firstCount.set(f, (firstCount.get(f) ?? 0) + 1);
  }
  const single = new Set(
    [...firstCount].filter(([, n]) => n === 1).map(([w]) => w),
  );
  const businessNames = forms
    .filter(f => f.kind === "onboarding")
    .map(f => formAnswer(f, /business name/i))
    .filter(Boolean);
  const titleNames = calls
    .filter(x => ["fathom", "imported", "zoom"].includes(x.source))
    .map(x => titleName(String(x.title ?? "")))
    .filter(Boolean);
  const aliases = [
    ...new Map(
      [name, ...businessNames, ...titleNames].map(n => [norm(n), n] as const),
    ).values(),
  ];
  // A first word another client starts with never names this one alone.
  const otherFirsts = new Set(
    otherNames.map(firstWordOf).filter((w): w is string => Boolean(w)),
  );
  const ownSingle = new Set(single);
  for (const n of aliases) {
    const f = firstWordOf(n);
    if (f && !otherFirsts.has(f)) ownSingle.add(f);
  }
  const wordsOf = (list: string[]) =>
    new Set(
      list.flatMap(n =>
        n
          .toLowerCase()
          .split(/[^\p{L}\p{N}&]+/u)
          .filter(Boolean),
      ),
    );
  const me: Matcher = {
    res: aliases.flatMap(n => aliasPatterns(n, ownSingle)),
    words: wordsOf(aliases),
  };
  const others: Matcher[] = otherNames
    .map(o => ({ res: aliasPatterns(o, single), words: wordsOf([o]) }))
    .filter(m => m.res.length);

  // ---- The team: Meta users and EOD authors, by first name and full name.
  const teamNames = [
    ...(input.teamActors ?? []),
    ...(timeline?.eods ?? []).map(e => String(e.author ?? "")),
  ].filter(
    n =>
      n && !/^(date|none|info\b|media buyer|the media buyer|claude)/i.test(n),
  );
  const teamFirst = new Set(
    teamNames.map(n => skeleton(firstName(n))).filter(s => s.length >= 2),
  );
  const teamFull = new Set(
    teamNames
      .filter(n => clean(n).split(/\s+/).length >= 2)
      .map(n => skeleton(clean(n))),
  );
  const team = new Set((input.teamActors ?? []).map(a => norm(a)));

  // ---- Who the CSM talks to: the person on the newest booking.
  const bookings = calls
    .filter(x => x.source === "ghl_appointment" && x.title)
    .sort((a, b) => asMs(b.startsAt) - asMs(a.startsAt));
  let contact: string | undefined;
  for (const x of bookings) {
    const n = bookingName(String(x.title));
    if (n && /\p{L}{2,}/u.test(n) && !names(me, n)) {
      contact = n;
      break;
    }
  }
  const engineers = formAnswers(onboarding, /engineers?|المهندسين/i)
    .join(" ")
    .split(/[,،\n/]|\s-\s|\sو\s/)
    .map(s => firstName(s))
    .filter(s => s.length >= 3);
  const theirFirst = new Set(
    [contact ?? "", ...engineers]
      .map(n => skeleton(firstName(n)))
      .filter(s => s.length >= 2),
  );
  /** Whose step it is: ours, theirs, or both. */
  const ownerSide = (owner: string): "ours" | "theirs" | "both" => {
    const o = clean(owner);
    if (BOTH.test(o)) return "both";
    if (OWNER_OURS.test(`${o}:`) || /^(mahara|مهارة)/i.test(o)) return "ours";
    if (OWNER_THEIRS.test(`${o}:`) || names(me, o)) return "theirs";
    const parts = o.split(/\s+/);
    const joined = /^(abd|abdul|abdel|abu|abo|عبد|أبو|ابو)$/i.test(parts[0]);
    // A full name must be a team member's full name; a first name alone, a first name.
    if (parts.length - (joined ? 1 : 0) >= 2)
      return teamFull.has(skeleton(o)) ? "ours" : "theirs";
    if (theirFirst.has(skeleton(firstName(o)))) return "theirs";
    return teamFirst.has(skeleton(firstName(o))) ? "ours" : "theirs";
  };

  // What they wrote on WhatsApp, newest first, with who wrote it.
  // A team member writing in a client group is us, not the client.
  const waTeam = [...teamNames, ...(input.teamActors ?? [])];
  const waThreads = input.whatsapp?.threads ?? [];
  const waInbound = waThreads
    .flatMap(t =>
      t.messages
        .filter(
          m => m.direction === "inbound" && !teamSpeaker(m.speaker, waTeam),
        )
        .map(m => ({
          m,
          t,
          who: t.isGroup ? `${m.speaker ?? "Someone"} in ${t.name}` : t.name,
        })),
    )
    .sort((a, b) => b.m.at - a.m.at);

  // ---- The team's EODs, read once: cut to this client, newest first.
  type EodRow = {
    e: TimelineEod;
    t: number;
    key: string;
    role: string;
    source: string;
    units: EodUnit[];
    text: string;
    auto: boolean;
  };
  const eodSeen = new Set<string>();
  const eods: EodRow[] = (timeline?.eods ?? [])
    .filter(e => !/^date$/i.test(String(e.author ?? "")))
    .map(e => {
      const valid =
        /^\d{4}-\d{2}-\d{2}$/.test(String(e.day ?? "")) &&
        Math.abs(Date.parse(`${e.day}T09:00:00Z`) - asMs(e.at)) < 3 * DAY;
      const t = valid ? Date.parse(`${e.day}T09:00:00Z`) : asMs(e.at);
      const role = ROLE[String(e.role ?? "").toLowerCase()] ?? e.role ?? "";
      const units = eodParts(String(e.excerpt ?? ""), me, others, role);
      const author = e.author ? String(e.author).split(" ")[0] : "";
      const text = joinParts(units.map(u => u.text));
      const kpi =
        units.length > 0 &&
        units.every(u => KPI_LINE.test(u.text) && !EVENT_LINE.test(u.text));
      return {
        e,
        t,
        key: valid ? String(e.day) : dayKey(e.at),
        role,
        units,
        text,
        auto: e.source === "cockpit" && kpi,
        source:
          e.source === "cockpit" && kpi
            ? "Media buyer cockpit (auto)"
            : [author && capitalise(author.toLowerCase()), role]
                .filter(Boolean)
                .join(", ") || "Team EOD",
      };
    })
    .filter(r => {
      if (!r.units.length) return false;
      const k = `${r.key}|${norm(r.text).slice(0, 120)}`;
      if (eodSeen.has(k)) return false;
      eodSeen.add(k);
      return true;
    })
    .sort((a, b) => b.t - a.t || asMs(b.e.at) - asMs(a.e.at));
  const eodUnits = eods.flatMap(r => r.units.map(u => ({ ...u, r })));
  /** The newest EOD contact with the client (a held meeting or a Call Summary). */
  const eodContact = eodUnits.find(u => u.contact && !u.callCentre);
  const eodHeld = eodUnits.find(u => u.held && !u.callCentre);

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
  const notedTime = notedRows.length ? asMs(notedRows[0].startsAt) : lastTime;
  const lastForm = formFor(lastRows, lastKey);
  const upcoming = calls
    .filter(x => x.upcoming)
    .sort((a, b) => asMs(a.startsAt) - asMs(b.startsAt));
  const heldKinds = new Set(past.map(x => kindOf([x])));
  /** Last contact of any kind: the newer of the last held call and the EOD record. */
  const contactTime = Math.max(
    Number.isFinite(lastTime) ? lastTime : 0,
    eodContact ? eodContact.r.t : 0,
  );
  const eodNewer =
    eodContact &&
    (!Number.isFinite(lastTime) ||
      dayStart(eodContact.r.t) > dayStart(lastTime))
      ? eodContact
      : undefined;
  /** A later meeting after the noted call: a held call or a held EOD meeting. */
  const laterMeeting =
    (Number.isFinite(lastTime) && lastKey !== notedKey) ||
    eodUnits.some(
      u =>
        u.held &&
        Number.isFinite(notedTime) &&
        dayStart(u.r.t) > dayStart(notedTime),
    );

  const brief: Brief = {
    clientName: name,
    mode,
    contact,
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
  const problems: (BriefLine & { lead: string; cause?: string })[] = [];
  const offers: (BriefLine & { lead: string })[] = [];
  const planSteps: { side: "ours" | "theirs"; text: string }[] = [];
  const notedDay = notedRows.length ? kuwaitDay(notedRows[0].startsAt) : "";
  const notedRec =
    notedRows.find(x => /^https?:\/\//.test(String(x.recordingUrl ?? "")))
      ?.recordingUrl ??
    ((notedForm as Row | undefined)?.recordingUrl as string | undefined) ??
    (answerText(
      notedForm?.answers?.find(a => /recording/i.test(String(a.title ?? "")))
        ?.value,
    ) ||
      undefined);
  const recHref = /^https?:\/\//.test(String(notedRec ?? ""))
    ? String(notedRec)
    : undefined;
  // A card digest of the call on that day carries the steps (one list, not two).
  const cardCall = (digests ?? [])
    .filter(
      d =>
        d.kind === "call" &&
        d.nextSteps?.length &&
        notedKey &&
        dayKey(d.at) === notedKey,
    )
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
  if (past.length) {
    if (notedKey !== lastKey) {
      brief.call.heading = `Last call with notes, ${kuwaitWeekday(notedRows[0].startsAt)}`;
      brief.call.empty = `The ${brief.lastCall?.day} call has no recording or notes.`;
    }
    const withSummary = [...notedRows]
      .filter(x => x.summary)
      .sort((a, b) => (b.summary?.length ?? 0) - (a.summary?.length ?? 0))[0];
    const secs = summaryParts(withSummary?.summary);
    const source = withSummary?.recordingUrl ? "Fathom" : "Call summary";
    const takeaways = secs.takeaways.filter(
      t => !(upcoming.length && MEETING_TIME.test(t)),
    );
    const labelOf = (t: string) => /^([^:：]{2,60})[:：]/.exec(t)?.[1] ?? "";
    for (const t of takeaways) {
      const label = labelOf(t);
      if (PLAN_LABEL.test(t)) {
        // "The plan: Mahara will retarget, Ardon will send content."
        const body = t.replace(/^[^:：]+[:：]\s*/, "");
        for (const clause of body.split(/[،,;؛]\s*(?:و(?=\S))?|\.\s+/)) {
          const cl = clause.trim().replace(/[.]$/, "");
          if (cl.length < 6) continue;
          if (/mahara|مهارة/i.test(cl))
            planSteps.push({ side: "ours", text: cl });
          else if (names(me, cl)) planSteps.push({ side: "theirs", text: cl });
        }
      }
      if (label && OFFER.test(label)) {
        offers.push({ text: t, lead: label, source, day: notedDay });
        continue;
      }
      if (MONEY_WORDS.test(t))
        money.push({ text: t, source, day: notedDay, risk: true });
      else if (PROBLEM.test(t))
        problems.push({ text: t, lead: problemLead(t), source, day: notedDay });
    }
    // A bullet labelled "Problem" (topics or takeaways) is the call's problem: it comes first.
    const labelled = [...takeaways, ...secs.topics].filter(
      t => PROBLEM_LABEL.test(t) && !/^(root cause|السبب الجذري)/i.test(t),
    );
    const cause = [...secs.topics, ...takeaways].find(t =>
      /^(root cause|السبب الجذري)\s*[:：]/i.test(t),
    );
    problems.unshift(
      ...labelled
        .filter((t, i, all) => all.indexOf(t) === i)
        .map(t => ({
          text: t,
          lead: problemLead(t),
          cause: cause ? problemLead(cause) : undefined,
          source,
          day: notedDay,
        })),
    );
    for (let i = problems.length - 1; i > 0; i--)
      if (problems.findIndex(p => p.text === problems[i].text) < i)
        problems.splice(i, 1);

    // The CSM's own notes: the recap of the call, and to-dos by side.
    const recap: string[] = [];
    for (const t of noteLines(
      `${formAnswers(notedForm, /^client notes/i).join("\n")}\n${formAnswers(notedForm, /additional notes/i).join("\n")}`,
    )) {
      if (
        OWNER_THEIRS.test(t) ||
        /^(?:\d+[.)]\s*)?(you need to|please|connect your|give us|share your|upload your|scan)\b/i.test(
          t,
        )
      )
        callSteps.push({
          owner: "Client",
          text: capitalise(t.replace(OWNER_THEIRS, "")),
        });
      else if (
        OWNER_OURS.test(t) ||
        /^(?:\d+[.)]\s*)?(send|book|share|add|follow up|we need to|we will|we'll)\b/i.test(
          t,
        )
      )
        callSteps.push({
          owner: "Mahara",
          text: capitalise(t.replace(OWNER_OURS, "")),
        });
      else recap.push(t);
    }
    // One source per call: the CSM's recap first, then Fathom's points it
    // does not cover (in the same language; the recap speaks for the call).
    const recapLines = recap
      .map((text, i) => ({ text, i }))
      .sort((a, b) => b.text.length - a.text.length)
      .slice(0, recap.length >= 2 ? 4 : 3)
      .sort((a, b) => a.i - b.i)
      .map(({ text }) => ({
        text,
        source: "Your 1-1 notes",
        day: notedDay,
        href: recHref,
      }));
    const arabic = (s: string) => /[\u0600-\u06FF]/.test(s);
    const recapArabic = recapLines.some(l => arabic(l.text));
    const fathomLines = takeaways
      .filter(
        t =>
          recapLines.length < 2 ||
          (arabic(t) === recapArabic &&
            !recapLines.some(l => sharedWords(l.text, t) >= 0.3)),
      )
      .slice(0, recapLines.length >= 2 ? 2 : 5)
      .map(text => ({
        text,
        source,
        day: notedDay,
        href: withSummary?.recordingUrl,
      }));
    brief.call.lines =
      recapLines.length >= 2
        ? [...recapLines, ...fathomLines]
        : [...fathomLines, ...recapLines];
    if (!brief.call.lines.length) {
      const brief1 = notedRows.find(x => x.brief)?.brief;
      if (brief1)
        brief.call.lines = [
          {
            text: clean(brief1),
            source: "AI brief",
            day: notedDay,
            href: recHref,
          },
        ];
    }
    if (!brief.call.lines.length) {
      if (recHref)
        brief.call.lines.push({
          text: "Recording on Fathom; no summary was pulled from it.",
          source: "Fathom",
          day: notedDay,
          href: recHref,
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
    // The card's digest of that call carries its steps; otherwise Fathom's.
    callSteps = [...(cardCall ? [] : secs.nextSteps), ...callSteps];
    if (!secs.nextSteps.length && !cardCall)
      for (const p of planSteps)
        callSteps.push({
          owner: p.side === "ours" ? "MaharaMedia" : "the client",
          text: p.text,
        });
  } else {
    // No call row: the team's EODs may still record a meeting or contact.
    // A held meeting first ("call with olivar designs"), else the newest contact.
    const met = eodHeld ?? eodContact;
    const newerContact =
      eodContact && met && eodContact !== met && eodContact.r.t > met.r.t
        ? ` Newer contact in the EODs: ${kuwaitDay(eodContact.r.t)}.`
        : "";
    brief.call.empty = met
      ? met.held
        ? `No call in the call history. The team's EOD records one on ${kuwaitDay(met.r.t)}: ${stop(met.text)}${newerContact}`
        : `No call in the call history. The ${met.r.role || "team"}'s EOD logs contact on ${kuwaitDay(met.r.t)}: ${stop(met.text)}`
      : mode === "stopped" || mode === "paused"
        ? "No call with them is on record since 1 Jun."
        : "No call with this client is on record since 1 Jun: not in GoHighLevel, Fathom or the 1-1 form.";
  }
  const usedEod = new Set<string>();
  const callFallback = past.length ? undefined : (eodHeld ?? eodContact);
  if (callFallback) {
    usedEod.add(norm(callFallback.text));
    usedEod.add(norm(callFallback.bare));
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
    if (
      all.some(
        l => norm(l.text) === norm(text) || sharedWords(l.text, text) >= 0.6,
      )
    )
      return;
    list.push({ text, source, day, label });
  };
  /** A step that only schedules or attends a meeting that a later call or its date has passed. */
  const meetingDone = (text: string, from: number) => {
    if (!MEETING_STEP.test(text)) return false;
    if (
      laterMeeting ||
      (Number.isFinite(lastTime) && dayStart(lastTime) > dayStart(from))
    )
      return true;
    const d = namedDay(text, from);
    return d !== null && d < dayStart(now);
  };
  const billingStep = (s: string) =>
    /payment|invoice|billing|دفع|فاتورة/i.test(s);
  const recentDigests = (digests ?? [])
    .filter(d => (d.at ?? 0) >= sinceLast && d.nextSteps?.length)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const callDigest =
    cardCall ??
    recentDigests.find(d => d.kind === "call") ??
    (digests ?? []).find(
      d =>
        d.kind === "call" &&
        d.nextSteps?.length &&
        now - (d.at ?? 0) < 30 * DAY,
    );
  // A billing step from the last 30 days stays open until a later card note closes it.
  const closedLater = (step: string, at: number) =>
    (digests ?? []).some(
      d =>
        (d.at ?? 0) > at &&
        /\b(paid|logged|set|agreed|done|completed|received)\b/i.test(
          d.summary ?? "",
        ) &&
        overlapOf(step, d.summary ?? "") >= 0.4,
    );
  const olderBilling = (digests ?? []).filter(
    d =>
      (d.at ?? 0) < sinceLast &&
      now - (d.at ?? 0) < 30 * DAY &&
      d.nextSteps?.some(s => billingStep(s) && !closedLater(s, d.at ?? 0)),
  );
  const digestsForSteps = [
    ...new Set([
      ...(callDigest ? [callDigest] : []),
      ...recentDigests,
      ...olderBilling,
    ]),
  ];
  for (const d of digestsForSteps)
    for (const step of d.nextSteps) {
      const raw = String(step ?? "");
      if (!recentDigests.includes(d) && d !== callDigest && !billingStep(raw))
        continue;
      const day = kuwaitDay(d.at);
      if (meetingDone(clean(raw), d.at ?? now)) continue;
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
  /** The steps' call is old and later calls happened: kept, not raised. */
  const staleSteps =
    Number.isFinite(notedTime) && now - notedTime > 30 * DAY && laterMeeting;
  if (callSteps.length) {
    if (!brief.promises.from)
      brief.promises.from = `Next steps from the ${notedDay} call${staleSteps ? ` (${plural(daysAgo(now, notedTime), "day")} ago)` : ""}`;
    for (const s of callSteps) {
      if (meetingDone(s.text, notedTime)) continue;
      const owner = s.owner?.trim();
      const source =
        s.owner === "Client" || s.owner === "Mahara"
          ? "Your 1-1 notes"
          : "Fathom";
      const side = owner ? ownerSide(owner) : "both";
      if (side === "ours")
        pushStep(brief.promises.ours, s.text, source, notedDay);
      else if (side === "theirs")
        pushStep(brief.promises.theirs, s.text, source, notedDay);
      else
        pushStep(
          brief.promises.steps,
          s.text,
          source,
          notedDay,
          owner ? "Both" : undefined,
        );
    }
  }

  // ---- Loose ends from the card, dropped when the timeline says otherwise.
  const actionable: BriefLine[] = [];
  let rebookLoose: BriefLine | undefined;
  for (const l of (c.loose ?? []) as string[]) {
    let t = clean(l);
    if (past.length && /no contact ever logged/i.test(t)) continue;
    if (
      /nothing rebooked|no next touchpoint|next touchpoint .*passed/i.test(t)
    ) {
      rebookLoose = {
        text: `${t.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_, d: string) => kuwaitDay(`${d}T09:00:00Z`))}. Book one.`,
        source: "ClickUp card",
      };
      continue;
    }
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
  const windowKey = dayKey(windowStart);
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
  // Creation side effects: updates to an object within two minutes of its
  // creation, or the same object edited on the day it was made.
  const created = newer
    .filter(ch => /^create_/.test(String(ch.kind)))
    .map(ch => ({
      at: asMs(ch.at),
      what: String(ch.evidence ?? ""),
      day: dayKey(ch.at),
    }));
  const sideEffect = (ch: Row) =>
    /^update_/.test(String(ch.kind)) &&
    created.some(
      x =>
        (Math.abs(x.at - asMs(ch.at)) < 120_000 &&
          (!x.what ||
            !ch.evidence ||
            x.what === String(ch.evidence) ||
            /ad_set|creative|target|bid|goal/.test(String(ch.kind)))) ||
        (Boolean(x.what) &&
          x.what === String(ch.evidence ?? "") &&
          x.day === dayKey(ch.at)),
    );
  type DayGroup = {
    key: string;
    day: string;
    at: number;
    who: Set<string>;
    counts: Map<string, number>;
    objects: Map<string, Set<string>>;
    rank: number;
  };
  const byDay = new Map<string, DayGroup>();
  const notes = new Map<string, BriefLine & { ev: Set<string> }>();
  const clientMade: Row[] = [];
  const budgetNotes: { at: number; text: string }[] = [];
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
      if (/daily budget/i.test(action))
        budgetNotes.push({ at: asMs(ch.at), text: action });
      // One CPL figure per brief: a decision judged one ad set, so its number goes.
      const evidence = clean(ch.evidence ?? "")
        .replace(
          /\bCPL \$[\d.,]+ is (under|over)/i,
          "that ad set's cost per lead is $1",
        )
        .slice(0, 90);
      const text =
        kind === "touch"
          ? "Sent the client an update"
          : source === "decision" && evidence
            ? `${action} (${evidence})`
            : action;
      const k = `${dayKey(ch.at)}|${norm(kind === "touch" ? "touch" : action)}`;
      const prev = notes.get(k);
      if (prev) prev.ev.add(norm(String(ch.evidence ?? "")));
      else
        notes.set(k, {
          text,
          source:
            source === "decision" ? "Media buyer decision" : "Media buyer note",
          day: kuwaitDay(ch.at),
          ev: new Set([norm(String(ch.evidence ?? ""))]),
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
      objects: new Map<string, Set<string>>(),
      rank: 99,
    };
    if (ch.actor)
      g.who.add(
        /claude/i.test(String(ch.actor))
          ? "The cockpit"
          : String(ch.actor).split(" ")[0],
      );
    // New and edited ads count once per ad, not once per event.
    const ev = String(ch.evidence ?? "");
    if (PER_OBJECT.has(def.one) && ev) {
      const set = g.objects.get(def.one) ?? new Set<string>();
      if (set.has(ev)) continue;
      set.add(ev);
      g.objects.set(def.one, set);
    }
    g.counts.set(def.one, (g.counts.get(def.one) ?? 0) + 1);
    g.rank = Math.min(g.rank, def.rank);
    byDay.set(key, g);
  }
  // What to tell the client: the totals before any note trims a day's line.
  const words = (counts: Map<string, number>, withSwitches: boolean) =>
    KINDS.filter(k => withSwitches || k.rank < 9)
      .map(k => {
        const n = counts.get(k.one) ?? 0;
        return n ? `${n} ${n === 1 ? k.one : k.many}` : "";
      })
      .filter(Boolean)
      .join(", ");
  const realAll = [...byDay.values()]
    .filter(g => words(g.counts, false))
    .sort((a, b) => b.at - a.at);
  const total = new Map<string, number>();
  const seenObjects = new Map<string, Set<string>>();
  for (const g of realAll)
    for (const [k, v] of g.counts) {
      const objs = g.objects.get(k);
      if (objs?.size) {
        const seen = seenObjects.get(k) ?? new Set<string>();
        const fresh =
          [...objs].filter(o => !seen.has(o)).length + (v - objs.size);
        for (const o of objs) seen.add(o);
        seenObjects.set(k, seen);
        total.set(k, (total.get(k) ?? 0) + fresh);
      } else total.set(k, (total.get(k) ?? 0) + v);
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
  if (total.get("budget change")) {
    const note = budgetNotes.sort((a, b) => b.at - a.at)[0];
    const to = note ? /\$\s?([\d,.]+)/.exec(note.text)?.[1] : undefined;
    told.push(
      to
        ? `set the daily budget to $${to}`
        : `adjusted the budget ${times(total.get("budget change") ?? 0)}`,
    );
  }
  if (
    total.get("targeting change") ||
    total.get("goal change") ||
    total.get("bid change")
  )
    told.push("refined who the ads reach");
  if (total.get("ad edited"))
    told.push(`updated ${plural(total.get("ad edited") ?? 0, "ad")}`);
  const span = realAll.length
    ? realAll.length === 1
      ? realAll[0].day
      : `${realAll[realAll.length - 1].day} to ${realAll[0].day}`
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
      text: n.ev.size > 1 ? `${n.text} (${n.ev.size} campaigns)` : n.text,
      source: n.source,
      day: n.day,
    });

  // ---- Card notes since the call: the risk is raised once, not repeated here.
  const recent = (digests ?? []).filter(d => now - (d.at ?? 0) < 21 * DAY);
  const riskOrder = (r: string) =>
    /cannot run|can'?t run|paused|stopp|access|billing|card|balance|grace|restrict/i.test(
      r,
    )
      ? 0
      : 1;
  const topicOf = (y: { r: string }) =>
    riskOrder(y.r) === 0 &&
    /billing|card|balance|grace|restrict|payment/i.test(y.r)
      ? "billing"
      : norm(y.r).slice(0, 30);
  /** A pending action or a dated event: worth raising. Otherwise it describes the business. */
  const PENDING =
    /\b(pending|requested|waiting|not (?:yet )?(?:been )?(?:provided|connected|linked|shared|signed|given|received|sent|done|set)|ha(?:s|ve) not|hasn'?t|haven'?t|missing|until|blocked|cannot|can'?t|remains?|inconsistent|unsettled|grace|restrict\w*|overdue|by (?:sun|mon|tue|wed|thu|fri|sat)\w*)\b|^no\b.*\b(provided|shared|given|sent)\b/i;
  const businessRisks: BriefLine[] = [];
  const risks = recent
    .flatMap(d => (d.risks ?? []).map(r => ({ r: String(r), d })))
    .filter(x => !/happiness/i.test(x.r) && !MECHANICAL.test(x.r))
    .filter(x => !brief.call.lines.some(l => sharedWords(l.text, x.r) >= 0.5))
    .filter(x => {
      if (/kickoff|onboarding/i.test(x.d.kind) && !PENDING.test(x.r)) {
        if (!businessRisks.some(b => sharedWords(b.text, x.r) >= 0.5))
          businessRisks.push({
            label: "From the kickoff",
            text: clean(x.r),
            source: "ClickUp card",
            day: kuwaitDay(x.d.at),
          });
        return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        riskOrder(a.r) - riskOrder(b.r) ||
        // Within billing, the call's client-facing risk before Meta's notice.
        (riskOrder(a.r) === 0
          ? Number(b.d.kind === "call") - Number(a.d.kind === "call")
          : 0) ||
        (b.d.at ?? 0) - (a.d.at ?? 0),
    )
    // One line per topic: two billing notices from the same night are one risk.
    .filter((x, i, all) => all.findIndex(y => topicOf(y) === topicOf(x)) === i)
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

  // ---- The team's EODs in the same window: this client's sentences, the
  // newest events first, one KPI line (the trend of one metric).
  const lastCallTakeaways = brief.call.lines.length > 0 && notedKey === lastKey;
  const inWindow = eods.filter(
    r =>
      r.key >= windowKey &&
      // The account manager's own write-up of the last call repeats the call's points.
      !(
        lastCallTakeaways &&
        r.key === lastKey &&
        /account manager|csm/i.test(r.role)
      ),
  );
  const kpiLine = kpiTrend(inWindow.filter(r => r.auto));
  const team1: (BriefLine & { score: number; t: number })[] = [];
  const seenTeam = new Set<string>();
  for (const r of inWindow) {
    if (r.auto) continue;
    const parts = r.units.filter(
      u => !(KPI_LINE.test(u.text) && !EVENT_LINE.test(u.text)),
    );
    if (!parts.length) continue;
    const text = joinParts(parts.map(u => u.text));
    const k = norm(text).slice(0, 120);
    if (seenTeam.has(k) || usedEod.has(norm(text))) continue;
    seenTeam.add(k);
    team1.push({
      text,
      score: now - r.t <= 14 * DAY ? 0 : 2,
      t: r.t,
      source: r.source,
      day: kuwaitDay(r.t),
    });
  }
  if (kpiLine) team1.push({ ...kpiLine, score: 1, t: 0 });
  brief.since.team = team1
    .sort((a, b) => a.score - b.score || b.t - a.t)
    .map(({ score: _s, t: _t, ...l }) => l);

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
  const summaries = past
    .filter(x => x.summary)
    .sort(
      (a, b) =>
        Number(/onboarding|kick/i.test(kindOf([b]))) -
          Number(/onboarding|kick/i.test(kindOf([a]))) ||
        asMs(b.startsAt) - asMs(a.startsAt),
    );
  /** Where a goal's currency is written, when the form left it out. */
  const goalCurrency = (() => {
    for (const x of summaries)
      for (const line of String(x.summary).split(/\r?\n/)) {
        const t = clean(line);
        if (/goal|هدف|الهدف|revenue|إيرادات|الإيرادات/i.test(t)) {
          const cur = currencyOf(t);
          if (cur) return { cur, from: `the ${kuwaitDay(x.startsAt)} call` };
        }
      }
    for (const a of onboarding?.answers ?? []) {
      if (
        /revenue goal|goal revenue|budget|ads?\b/i.test(String(a.title ?? ""))
      )
        continue;
      const cur = currencyOf(answerText(a.value));
      if (cur) return { cur, from: "another answer on their onboarding form" };
    }
    return null;
  })();
  const kickoffGoals = new Map<string, string>();
  const answer = (
    form: TimelineForm | undefined,
    list: [RegExp, string][],
    source: string,
  ) => {
    if (!form) return;
    for (const [re, label] of list) {
      // Some titles repeat ("Anything to add?"): read every answer, keep the fullest.
      const all = formAnswers(form, re)
        .map(clean)
        .filter(
          v =>
            v.length >= 2 &&
            !EMPTY_ANSWER.test(v) &&
            !damaged(v) &&
            !/^https?:\/\/\S+$/.test(v) &&
            // A link or a place alone is not a kickoff note.
            (label !== "Kickoff notes" ||
              (!/google maps|maps\.app|share\.google|goo\.gl/i.test(v) &&
                v
                  .replace(/https?:\/\/\S+|\S+@\S+/g, " ")
                  .split(/\s+/)
                  .filter(w => w.length > 1).length >= 4)),
        );
      if (label === "Kickoff notes")
        for (const v of all)
          for (const m of v.matchAll(
            /(90[-\s]?day|12[-\s]?(?:to|-)?\s?24[-\s]?month)[^:\n]{0,30}:\s*([\d][\d,.]*(?:\s*(?:k|m|million)(?![a-z]))?)\s*([A-Za-z]{2,3}|\$|دينار|ريال)?/gi,
          ))
            kickoffGoals.set(
              /^90/.test(m[1])
                ? "90-day revenue goal"
                : "12 to 24-month revenue goal",
              `${m[2].trim()}${m[3] ? ` ${m[3].toUpperCase()}` : ""}`,
            );
      const fullest = all.sort((a, b) => b.length - a.length);
      let v =
        label === "Kickoff notes" ? fullest.join(" | ") : (fullest[0] ?? "");
      if (!v) continue;
      if (
        label === "Wants to grow" &&
        /^\D{0,12}\d[\d,.\s]*(million|m|k)?\b/i.test(v)
      )
        continue;
      if (MONEY_GOAL.test(label)) {
        const fromKickoff = kickoffGoals.get(label);
        if (fromKickoff && currencyOf(fromKickoff)) {
          const n = Number(fromKickoff.replace(/[^\d.]/g, ""));
          v = `${Number.isFinite(n) && n >= 1000 ? n.toLocaleString("en-US") : fromKickoff.replace(/\s*\S+$/, "")} ${currencyOf(fromKickoff)} (from the kickoff notes)`;
        } else if (/^[\d,.\s]+$/.test(v)) {
          const n = Number(v.replace(/[,\s]/g, ""));
          v =
            n < 1000
              ? `as written: ${v}`
              : `${n.toLocaleString("en-US")} ${goalCurrency ? `(${goalCurrency.cur}, from ${goalCurrency.from})` : "(currency not stated)"}`;
        } else if (!CURRENCY.test(v))
          v = `${v} ${goalCurrency ? `(${goalCurrency.cur}, from ${goalCurrency.from})` : "(currency not stated)"}`;
      }
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
  // Goals the kickoff notes give when the onboarding form has none.
  for (const [label, v] of kickoffGoals)
    if (!brief.who.some(l => l.label === label) && currencyOf(v)) {
      const n = Number(v.replace(/[^\d.]/g, ""));
      brief.who.push({
        label,
        text: `${Number.isFinite(n) && n >= 1000 ? n.toLocaleString("en-US") : v.replace(/\s*\S+$/, "")} ${currencyOf(v)} (from the kickoff notes)`,
        source: "Kickoff form",
        day: kuwaitDay(kickoff?.submittedAt),
      });
    }
  // No "wants to grow": say what they do and where, from the same form.
  if (onboarding && !brief.who.some(l => l.label === "Wants to grow")) {
    const services = clean(
      formAnswer(onboarding, /what services do you offer/i),
    );
    const first = services
      .replace(/^\s*\d+[.)-]\s*/, "")
      .split(/(?<=[.!?؟])\s+|\n|\s\d+[.)-]\s|\s-\s/)
      .map(s => s.trim())
      .find(s => s.length >= 3);
    const where = clean(formAnswer(onboarding, /service areas/i));
    const at = brief.who.findIndex(l => l.source === "Onboarding form");
    const add: (BriefLine | null)[] = [
      first && !damaged(first)
        ? {
            label: "What they do",
            text: cut(first, 120),
            source: "Onboarding form",
            day: kuwaitDay(onboarding.submittedAt),
          }
        : null,
      where && !EMPTY_ANSWER.test(where) && !damaged(where)
        ? {
            label: "Where",
            text: cut(where, 120),
            source: "Onboarding form",
            day: kuwaitDay(onboarding.submittedAt),
          }
        : null,
    ];
    brief.who.splice(
      at < 0 ? brief.who.length : at,
      0,
      ...add.filter((x): x is BriefLine => Boolean(x)),
    );
  }
  brief.who.push(...businessRisks);

  // ---- Kickoff setup: every answer under a setup title is open unless it says done.
  const onboardingMode = mode === "onboarding";
  const setupOpen = kickoff
    ? SETUP.filter(item =>
        formAnswers(kickoff, item.re).some(v =>
          item.name ? NAME_OPEN.test(v) : !SETUP_DONE.test(v),
        ),
      )
    : [];
  const openTopics = new Set(onboardingMode ? setupOpen.map(o => o.topic) : []);
  const setupTopicOf = (t: string) =>
    SETUP_TOPIC.find(([re, topic]) => openTopics.has(topic) && re.test(t))?.[1];

  // ---- Raise on this call: rules over the sources above.
  type Cand = BriefLine & { rank: number; core?: string };
  const raise: Cand[] = [];
  const add = (rank: number, line: BriefLine, core?: string) =>
    raise.push({ rank, ...line, core });
  /** Steps already quoted by a higher line are not raised again. */
  const quoted = new Set<string>();

  if (/^\[internal/i.test(name)) {
    brief.quiet = "An internal test record, not a client.";
  } else if (mode === "stopped" || mode === "paused") {
    const word = mode === "stopped" ? "Stopped" : "Paused";
    // Every sentence on record that names them, newest first, said once.
    type Said = {
      text: string;
      full: string;
      at: number;
      source: string;
      exit: boolean;
      r?: EodRow;
    };
    const seenSaid = new Set<string>();
    const said: Said[] = [
      ...eodUnits
        .filter(u => !u.callCentre)
        .map(u => ({
          text: u.bare,
          full: u.text,
          at: u.r.t,
          source: u.r.source,
          exit: u.exitLabel,
          r: u.r,
        })),
      ...(digests ?? []).flatMap(d =>
        clean(d.summary)
          .split(/(?<=[.!?؟])\s+/)
          .filter(
            s => s.length >= 3 && !NARRATION.test(s) && !MECHANICAL.test(s),
          )
          .map(text => ({
            text,
            full: text,
            at: d.at ?? 0,
            source: "ClickUp card",
            exit: false,
          })),
      ),
    ]
      .filter(x => {
        const k = norm(x.text);
        if (!k || seenSaid.has(k)) return false;
        seenSaid.add(k);
        return true;
      })
      .sort((a, b) => b.at - a.at);
    const used = new Set<string>(usedEod);
    /** An exit word about the client, not "stopped high-cost videos". */
    const isExit = (t: string) => {
      const m = EXIT_WORDS.exec(t);
      if (!m) return false;
      if (!AD_OBJECT.test(t.slice(m.index + m[0].length))) return true;
      const at = nameIndex(me, t);
      return at >= 0 && at < m.index && CAUSE.test(t);
    };
    const exits = said.filter(x => x.exit || isExit(x.text));
    // Why: a line that gives the cause or the way back, else the newest exit line.
    const why = exits.find(x => CAUSE.test(x.text)) ?? exits[0];
    if (why) {
      used.add(norm(why.text));
      add(0, {
        risk: true,
        text: `${word}: ${stop(why.text)}`,
        source: why.source,
        day: kuwaitDay(why.at),
      });
      if (exits[0] && exits[0] !== why) {
        used.add(norm(exits[0].text));
        add(0.2, {
          text: `Latest: ${stop(exits[0].text)}`,
          source: exits[0].source,
          day: kuwaitDay(exits[0].at),
        });
      }
    } else {
      const hint = said.find(x => RENEWAL.test(x.text));
      if (hint) used.add(norm(hint.text));
      add(0, {
        risk: true,
        text: hint
          ? `${word}. No stop reason is on record. Last on record: ${stop(hint.text)}`
          : `${word}. No reason is on record; ask what would bring them back.`,
        source: hint?.source ?? "ClickUp stage",
        day: hint ? kuwaitDay(hint.at) : undefined,
      });
    }
    const billing = said.find(
      x => BILLING_WORDS.test(x.text) && !used.has(norm(x.text)),
    );
    if (billing) {
      used.add(norm(billing.text));
      add(1, {
        text: `Last billing note: ${stop(billing.text)}`,
        source: billing.source,
        day: kuwaitDay(billing.at),
      });
    }
    // The newest thing that happened at all: an EOD, a change or a card note.
    const activities = [
      ...said.map(x => ({
        at: x.at,
        text: x.full,
        bare: x.text,
        source: x.source,
      })),
      ...((timeline?.changes ?? []) as Row[])
        .filter(ch => clean(ch.action))
        .map(ch => ({
          at: asMs(ch.at),
          text: `${clean(ch.action).replace(/\s*[—–]\s*/g, ": ")}${ch.source !== "meta_activity" && ch.evidence ? ` (${clean(ch.evidence).slice(0, 80)})` : ""}`,
          bare: "",
          source: ch.source === "meta_activity" ? "Meta" : "Media buyer",
        })),
    ]
      .filter(x => !TOOLING.test(x.text))
      .sort((a, b) => b.at - a.at);
    const activity = activities[0];
    if (
      activity &&
      !used.has(norm(activity.text)) &&
      !used.has(norm(activity.bare))
    ) {
      used.add(norm(activity.text));
      used.add(norm(activity.bare));
      add(1.2, {
        text: `Last activity on record, ${kuwaitDay(activity.at)}: ${stop(activity.text)}`,
        source: activity.source,
        day: kuwaitDay(activity.at),
      });
    }
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
    if (eodNewer && !usedEod.has(norm(eodNewer.text))) {
      add(3, {
        text: used.has(norm(eodNewer.text))
          ? `Last contact on record: ${kuwaitDay(eodNewer.r.t)} (${eodNewer.r.role || "team"} EOD).${brief.lastCall ? ` Last call on record ${brief.lastCall.day}.` : ""}`
          : `Last contact on record, ${kuwaitDay(eodNewer.r.t)}: ${stop(eodNewer.text)}${brief.lastCall ? ` Last call on record ${brief.lastCall.day}.` : ""}`,
        source: eodNewer.r.source,
        day: kuwaitDay(eodNewer.r.t),
      });
      used.add(norm(eodNewer.text));
    } else if (brief.lastCall)
      add(3, {
        text: `Last spoke on ${brief.lastCall.day} (${brief.lastCall.kind.toLowerCase()}).`,
        source: "Calls",
      });
    if (why && callFallback && norm(callFallback.bare) === norm(why.text))
      brief.call.empty = `No call in the call history. The ${callFallback.r.role || "team"}'s EOD logs contact on ${kuwaitDay(callFallback.r.t)} (the line above).`;
    brief.raise = raise
      .sort((a, b) => a.rank - b.rank)
      .map(({ rank: _r, core: _c, ...l }) => l);
    const nothing =
      !calls.length &&
      !forms.length &&
      !(timeline?.changes ?? []).length &&
      !(timeline?.eods ?? []).length &&
      !(digests ?? []).length &&
      !waInbound.length;
    if (nothing)
      brief.quiet = `${word}. Nothing on record since 1 Jun: no calls, forms, card notes or team mentions.`;
    // The newest two team lines that record contact, delivery or billing,
    // at any age, never our tooling and never a line used above.
    const lastTeam: BriefLine[] = [];
    let kpiShown = false;
    for (const r of eods) {
      if (lastTeam.length >= 2) break;
      const parts = r.units.filter(
        u =>
          !u.callCentre &&
          !used.has(norm(u.text)) &&
          !used.has(norm(u.bare)) &&
          !TOOLING.test(u.text),
      );
      const kpi =
        parts.length > 0 &&
        parts.every(u => KPI_LINE.test(u.text) && !EVENT_LINE.test(u.text));
      const events = parts.filter(u => EVENT_LINE.test(u.text) || u.contact);
      if (kpi && !kpiShown) {
        kpiShown = true;
        lastTeam.push({
          text: joinParts(parts.slice(0, 1).map(u => u.text)),
          source: r.auto ? "Media buyer cockpit (auto)" : r.source,
          day: kuwaitDay(r.t),
        });
        continue;
      }
      if (!events.length) continue;
      lastTeam.push({
        text: joinParts(events.map(u => u.text)),
        source: r.source,
        day: kuwaitDay(r.t),
      });
    }
    brief.since = {
      heading: "Last from the team",
      changes: [],
      notes: [],
      team: lastTeam,
      changeTotal: 0,
      chats: [],
    };
    if (!lastTeam.length)
      brief.since.empty = used.size
        ? "No other team mentions on record."
        : "No team mentions on record.";
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
      ...eodUnits
        .filter(u => u.r.t >= dayStart(sinceStart))
        .map(u => ({ text: u.text, at: u.r.t, source: u.r.source })),
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
    const moodRisk = brief.defcon?.risk && !brief.defcon.old;
    if (upset)
      add(
        -1,
        {
          risk: true,
          text: `${clean(upset.text).replace(/[.!؟?]*$/, ".")}${moodRisk ? ` Marked ${brief.defcon?.value}${brief.priority ? `, priority ${brief.priority},` : ""} on ${brief.defcon?.day}.` : ""} Open with it, calmly, before anything else.`,
          source: upset.source,
          day: kuwaitDay(upset.at),
        },
        upset.text,
      );
    // A WhatsApp message waiting on our reply: answer it before the call.
    // The mirror's flag, checked against the messages: a team member writing
    // in the group counts as ours, though the mirror files it as inbound.
    for (const t of waThreads.filter(x => x.awaitingUs && !x.archived)) {
      const waiting = clientWaiting(t.messages, waTeam);
      const last = waiting && waInbound.find(x => x.m === waiting);
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
    if (moodRisk && !upset)
      add(0, {
        risk: true,
        text: `Marked ${brief.defcon?.value}${brief.priority ? `, priority ${brief.priority},` : ""} on ${brief.defcon?.day}. Ask how they feel about the results before anything else.`,
        source: "1-1 form",
        day: brief.defcon?.day,
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
    const quietDays = contactTime ? daysAgo(now, contactTime) : null;
    /** "Last call on record 29 Jul; the team met them on 13 Sep (EOD)." */
    const lastWords = eodNewer
      ? `${brief.lastCall ? `Last call on record ${brief.lastCall.day}` : "No call on record"}; the ${eodNewer.r.role || "team"}'s EOD ${eodNewer.held ? "records a meeting" : "logs contact"} on ${kuwaitDay(eodNewer.r.t)}`
      : "";
    // A meeting the team booked outside GoHighLevel since the last call.
    const eodBooked = eodUnits.find(
      u =>
        u.booked &&
        u.r.t >=
          dayStart(Number.isFinite(lastTime) ? lastTime : now - 14 * DAY),
    );
    const cardBooked = (digests ?? []).find(
      d =>
        (d.at ?? 0) >=
          (Number.isFinite(lastTime) ? lastTime : now - 14 * DAY) &&
        BOOKED_MEETING.test(d.summary ?? ""),
    );
    let callRule = false;
    if (!upcoming.length) {
      // A meeting we promised on the last call itself: "schedule next week's review".
      const promisedMeeting =
        notedKey === lastKey
          ? [...brief.promises.ours, ...brief.promises.steps].find(
              l =>
                PROMISED_MEETING.test(l.text) &&
                !NOT_OUR_MEETING.test(l.text) &&
                !/ad review/i.test(l.text),
            )
          : undefined;
      const ago = quietDays ?? brief.lastCall?.ago ?? 0;
      if (eodBooked || cardBooked) {
        callRule = true;
        const quote = eodBooked
          ? cut(
              eodBooked.text.slice(
                Math.max(0, eodBooked.text.search(BOOKED_MEETING)),
              ),
              90,
            )
          : cut(firstSentence(clean(cardBooked?.summary)), 90);
        add(2, {
          text: `No call is booked in GoHighLevel, but the team's ${eodBooked ? "EOD" : "card note"} on ${kuwaitDay(eodBooked ? eodBooked.r.t : cardBooked?.at)} says one is: "${quote.replace(/[.]$/, "")}". Add it to GoHighLevel.`,
          source: eodBooked ? eodBooked.r.source : "ClickUp card",
          day: kuwaitDay(eodBooked ? eodBooked.r.t : cardBooked?.at),
        });
      } else if (
        lastBooking &&
        ["cancelled", "no_show"].includes(lastBooking.status) &&
        asMs(lastBooking.startsAt) > (Number.isFinite(lastTime) ? lastTime : 0)
      ) {
        callRule = true;
        add(2, {
          risk: true,
          text: `Their ${kuwaitDay(lastBooking.startsAt)} ${(CALL_NAMES[kindOf([lastBooking])] ?? "call").toLowerCase()} was ${lastBooking.status === "no_show" ? "a no-show" : "cancelled"} and nothing is booked since. Book one.`,
          source: "GoHighLevel",
          day: kuwaitDay(lastBooking.startsAt),
        });
      } else if (!past.length && !eodContact && mode === "live") {
        callRule = true;
        add(2, {
          risk: true,
          text: "No call is on record and none is booked. Book one.",
          source: "Calls",
        });
      } else if (
        mode === "live" &&
        (brief.lastCall || eodContact) &&
        (ago >= 10 || brief.defcon?.risk || promisedMeeting)
      ) {
        callRule = true;
        add(2, {
          risk: ago > 14 || Boolean(brief.defcon?.risk),
          text: promisedMeeting
            ? `No next call is booked. Book the one we promised: ${promisedMeeting.text}`
            : eodNewer
              ? `No next call is booked. ${lastWords}, ${plural(ago, "day")} ago. Book a check-in.`
              : `No next call is booked${ago >= 10 ? `, and the last was ${plural(ago, "day")} ago` : ""}. Book a check-in.`,
          source: "Calls",
        });
        if (promisedMeeting) quoted.add(norm(promisedMeeting.text));
      }
    }
    if (!callRule && !upcoming.length && rebookLoose && mode === "live")
      add(13, rebookLoose);
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
    for (const m of money.slice(0, 1)) {
      // What happened since: an invoice or payment line that names them.
      const later = [
        ...eodUnits
          .filter(
            u => u.r.t >= dayStart(notedTime) && BILLING_WORDS.test(u.text),
          )
          .map(u => ({ text: u.text, at: u.r.t, source: u.r.source })),
        ...(digests ?? [])
          .filter(
            d => (d.at ?? 0) > notedTime && BILLING_WORDS.test(d.summary ?? ""),
          )
          .map(d => ({
            text: firstSentence(clean(d.summary)),
            at: d.at ?? 0,
            source: "ClickUp card",
          })),
      ].sort((a, b) => b.at - a.at)[0];
      add(
        3,
        {
          ...m,
          text: later
            ? `From the ${m.day} call: ${stop(m.text)} Since then: ${stop(cut(later.text, 160))} (${later.source}, ${kuwaitDay(later.at)}) Check it was paid.`
            : `From the ${m.day} call: ${stop(m.text)} Check it is settled.`,
        },
        m.text,
      );
    }
    // Card risks, each with the step that answers it (ours or theirs).
    const usedStep = new Set<string>();
    for (const x of risks) {
      // The kickoff line already says it (Facebook access, the calendar).
      if (setupTopicOf(x.r)) continue;
      const meta =
        /ad account|billing|balance|grace period|policy|restrict/i.test(x.r) &&
        !/\bmeta\b|facebook/i.test(x.r);
      const sameTopic = (digests ?? []).filter(
        d =>
          d === x.d ||
          (d.risks ?? []).some(
            r => topicOf({ r }) === topicOf(x) && topicOf(x) === "billing",
          ),
      );
      const candidates = sameTopic.flatMap(d =>
        (d.nextSteps ?? []).map(s => ({
          raw: String(s),
          text: clean(
            String(s).replace(OWNER_OURS, "").replace(OWNER_THEIRS, ""),
          ),
          theirs: OWNER_THEIRS.test(String(s)),
        })),
      );
      if (topicOf(x) === "billing")
        for (const cnd of candidates)
          if (/billing|balance|card|grace|payment|restrict/i.test(cnd.text))
            quoted.add(norm(cnd.text));
      const best = candidates
        .filter(s => !usedStep.has(norm(s.text)) && !MEETING_STEP.test(s.text))
        .map(s => ({ ...s, score: overlapOf(s.text, x.r) }))
        .filter(s => s.score >= 0.3)
        .sort((a, b) => b.score - a.score)[0];
      if (best) {
        usedStep.add(norm(best.text));
        quoted.add(norm(best.text));
      }
      // A figure the card note states that the risk left out.
      const figure =
        /payment|invoice|fee|deposit|budget|price|cost|دفع/i.test(x.r) &&
        !/\d/.test(x.r)
          ? /(?:USD|SAR|KWD|AED|QAR|\$)\s?[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s?(?:USD|SAR|KWD|AED|QAR)/.exec(
              x.d.summary ?? "",
            )?.[0]
          : undefined;
      const due = namedDay(x.r, x.d.at ?? now);
      const passed =
        due !== null &&
        due < dayStart(now) &&
        /\b(by|on|until)\s+\w+day\b/i.test(x.r)
          ? ` (that was ${kuwaitWeekday(due + 9 * 3_600_000)}: check it was done)`
          : "";
      const riskText = `${meta ? "Meta: " : ""}${clean(x.r).replace(/[.]$/, "")}${figure ? ` (${figure}${/special offer/i.test(x.d.summary ?? "") ? ", special offer" : ""})` : ""}${passed}.`;
      add(
        4,
        {
          risk: true,
          text: `${riskText}${best ? (best.theirs ? ` Ask if they did it: ${best.text}` : ` Next: ${best.text}`) : ""}`,
          source: "ClickUp card",
          day: kuwaitDay(x.d.at),
        },
        `${x.r} ${best?.text ?? ""}`,
      );
    }
    // Onboarding: the next step for their stage, and what still blocks a launch.
    if (onboardingMode) {
      const blocker = eodUnits
        .filter(u => now - u.r.t < 45 * DAY)
        .filter(u =>
          /didn'?t (?:respond|reply|answer|send)|no (?:response|reply|answer)|not respond\w*|waiting (?:for|on) (?:him|her|them|the client)|لم يرد|ما رد|لا يرد|بانتظار/i.test(
            u.text,
          ),
        )[0];
      if (blocker) {
        const age = daysAgo(now, blocker.r.t);
        add(1, {
          risk: true,
          text:
            age > 14
              ? `${kuwaitDay(blocker.r.t)}, ${plural(age, "day")} ago: ${stop(blocker.text)} Check this is resolved.`
              : `${stop(blocker.text)} Ask what they need to move forward.`,
          source: blocker.r.source,
          day: kuwaitDay(blocker.r.t),
        });
      }
      const upKinds = new Set(upcoming.map(x => kindOf([x])));
      const next = expectedCall(stage, heldKinds);
      const quiet =
        !upcoming.length && quietDays !== null && quietDays > 14
          ? eodNewer
            ? `${lastWords}. Nothing is booked: book their ${next}.`
            : `Nothing is booked and the last call was ${plural(quietDays, "day")} ago: book their ${next}.`
          : "";
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
      let notLive = false;
      if (
        /launch/i.test(stage) &&
        launch &&
        now - asMs(launch.startsAt) > 7 * DAY &&
        !metaRows.some(r => asMs(r.at) > asMs(launch.startsAt))
      ) {
        notLive = true;
        // Our deliverable done since? Then the next move is theirs.
        const ours0 = brief.promises.ours.find(o => !quoted.has(norm(o.text)));
        const deliverable = ours0
          ? DELIVERABLES.find(([, re]) => re.test(ours0.text))
          : undefined;
        const done = deliverable
          ? eodUnits.find(
              u =>
                u.r.t >= dayStart(asMs(launch.startsAt)) &&
                deliverable[1].test(u.text) &&
                DONE_WORDS.test(u.text),
            )
          : undefined;
        const theirMatch = deliverable
          ? brief.promises.theirs.find(t => deliverable[1].test(t.text))
          : undefined;
        let tail: string;
        if (done && deliverable) {
          if (ours0) quoted.add(norm(ours0.text));
          if (theirMatch) quoted.add(norm(theirMatch.text));
          tail = ` The ${deliverable[0]} was done by ${kuwaitDay(done.r.t)} (${done.r.source}).${theirMatch ? ` Ask if they did their part: ${theirMatch.text}` : " Ask what is blocking it on their side."}`;
        } else if (ours0) {
          quoted.add(norm(ours0.text));
          tail = ` Ask what is blocking it, starting with: ${ours0.text}`;
        } else tail = " Ask what is blocking it.";
        add(0, {
          risk: true,
          text: `Not live ${plural(Math.floor((now - asMs(launch.startsAt)) / DAY), "day")} after the launch call.${tail}${quiet ? ` ${quiet}` : ""}`,
          source: "Calls",
        });
      }
      if (quiet && !notLive)
        add(2, {
          risk: true,
          text: `Still onboarding. ${quiet}`,
          source: "Calls",
        });
      if (/launch booked/i.test(stage) && !upKinds.has("launch"))
        add(1, {
          risk: true,
          text: 'The card says "launch booked", but no launch call is booked in GoHighLevel. Book it, or fix the stage.',
          source: "ClickUp stage",
        });
    }
    if (
      kickoff &&
      (onboardingMode || now - asMs(kickoff.submittedAt) < 30 * DAY)
    ) {
      const labels = [...new Set(setupOpen.map(o => o.label))];
      const noteBlock = checkinForms
        .filter(f => asMs(f.submittedAt) >= asMs(kickoff.submittedAt) - DAY)
        .flatMap(f => formAnswers(f, /additional notes/i))
        .flatMap(t => t.split(/(?<=[.!?؟])\s+/))
        .filter(t => NOTE_BLOCKER.test(t))
        .slice(0, 2)
        .map(clean);
      if ((labels.length || noteBlock.length) && onboardingMode)
        add(
          1,
          {
            risk: true,
            text: `${labels.length ? `Still open from the ${kuwaitDay(kickoff.submittedAt)} kickoff: ${labels.join(", ")}.` : ""}${noteBlock.length ? `${labels.length ? " " : ""}Your 1-1 notes add: "${noteBlock.join(" ")}"` : ""}`,
            source: "Kickoff form",
            day: kuwaitDay(kickoff.submittedAt),
          },
          labels.join(", "),
        );
      const hasOld = formAnswer(kickoff, /pre-existing leads/i);
      const reach = formAnswer(kickoff, /reach out to those leads/i);
      const list = formAnswer(kickoff, /link or notes for those leads/i);
      if (
        /^(true|yes)/i.test(hasOld) &&
        /^(true|yes)/i.test(reach) &&
        (!list || /^(n\/?a|na|pending|no|none|-|tbd)\b/i.test(clean(list)))
      )
        add(1.2, {
          text: "Ask for their old leads list: at the kickoff they said they have old leads and want us to contact them, but no list was shared.",
          source: "Kickoff form",
          day: kuwaitDay(kickoff.submittedAt),
        });
    }
    if (diagnosis?.top)
      add(5, {
        text: `${diagnosis.top.title}.${diagnosis.top.fixes?.[0] ? ` ${diagnosis.top.fixes[0]}` : ""}`,
        source: "Numbers",
      });
    // Ready for a testimonial, by their own 1-1 mood.
    const testimonial = brief.defcon && /testimonial/i.test(brief.defcon.value);
    if (testimonial)
      add(5.5, {
        text: `They were marked ready for a testimonial on ${brief.defcon?.day}. Ask for it.`,
        source: "1-1 form",
      });
    // The problem from the call: dropped when Meta shows the launch happened,
    // or when the card raised the same worry since.
    const metaAfter = (from: number) =>
      metaRows
        .filter(r => asMs(r.at) > from && /^create_/.test(String(r.kind)))
        .sort((a, b) => asMs(a.at) - asMs(b.at))[0];
    const cardRiskSince = risks.some(
      x => (x.d.at ?? 0) >= dayStart(notedTime) && topicOf(x) !== "billing",
    );
    for (const p of problems.slice(0, 1)) {
      const launched =
        /launch|paused|blocked|pending|متوقف|إيقاف|معلق/i.test(p.text) &&
        metaAfter(notedTime);
      if (launched) {
        add(10.5, {
          text: `Launched ${kuwaitDay(launched.at)}, after the block noted on the ${p.day} call.`,
          source: "Meta",
          day: kuwaitDay(launched.at),
        });
        continue;
      }
      if (cardRiskSince || staleSteps) continue;
      add(
        6,
        {
          text: `Follow up on "${p.lead}" from the ${p.day} call${p.cause ? ` (root cause noted: "${p.cause}")` : ""}: has it improved since?`,
          source: p.source,
          day: p.day,
        },
        p.lead,
      );
    }
    // An offer from the call: did they decide?
    for (const o of offers.slice(0, 1)) {
      if (staleSteps) break;
      const token = contentWords(o.lead).find(w => w.length >= 3) ?? "";
      const theirStep = brief.promises.theirs.find(
        t =>
          (token && norm(t.text).includes(token)) ||
          overlapOf(o.lead, t.text) >= 0.3,
      );
      if (theirStep) quoted.add(norm(theirStep.text));
      add(
        6,
        {
          text: `Open offer from the ${o.day} call: "${o.lead}". Did they decide?${theirStep ? ` Their step: ${theirStep.text}` : ""}`,
          source: o.source,
          day: o.day,
        },
        o.lead,
      );
    }
    // A promised ad change with nothing in Meta since.
    const promisedChange = planSteps.find(
      p => p.side === "ours" && /target|retarget|استهداف/i.test(p.text),
    );
    if (
      promisedChange &&
      !metaRows.some(
        r => asMs(r.at) > notedTime && /target|create_/.test(String(r.kind)),
      )
    )
      add(
        6.5,
        {
          risk: true,
          text: `Promised on the ${notedDay} call: "${promisedChange.text}". No targeting change is logged in Meta since. Check it was done.`,
          source: "Fathom",
          day: notedDay,
        },
        promisedChange.text,
      );
    // Our steps: only ours, not already quoted above, and not from an old call.
    const ours = brief.promises.ours.filter(
      l =>
        !quoted.has(norm(l.text)) &&
        !(staleSteps && l.source !== "ClickUp card"),
    );
    if (ours.length)
      add(
        7,
        {
          text:
            ours.length === 1
              ? `Check our next step is done before the call: ${ours[0].text}`
              : `Check our ${ours.length} next steps are done before the call, starting with: ${ours[0].text}`,
          source: ours[0].source,
          day: ours[0].day,
        },
        ours[0].text,
      );
    // Their promise, unless it waits on one of ours, repeats a setup item
    // already raised, or only attends a meeting.
    const dependsOnUs = (t: string) =>
      /^(confirm|review|approve|give (?:\w+ )?feedback|provide (?:\w+ )?feedback|share feedback|check|test|تأكيد|مراجعة|الموافقة|اعتماد|تقديم ملاحظات|تقييم)/i.test(
        t,
      ) ||
      // Something we deliver first: "Send Walid the receipts" before "Confirm receipt".
      brief.promises.ours.some(o => {
        if (!DELIVER.test(o.text)) return false;
        const mine6 = new Set(contentWords(o.text).filter(w => w.length >= 6));
        return contentWords(t).some(w => w.length >= 6 && mine6.has(w));
      });
    const askable = brief.promises.theirs.find(
      t =>
        !quoted.has(norm(t.text)) &&
        !dependsOnUs(t.text) &&
        !MEETING_STEP.test(t.text) &&
        !/^(notify|inform|let us know|tell us)\b.*\b(if|when|whenever|any)\b/i.test(
          t.text,
        ) &&
        !setupTopicOf(t.text) &&
        !(staleSteps && t.source !== "ClickUp card"),
    );
    const askMore = brief.promises.theirs.filter(
      t =>
        t !== askable &&
        !quoted.has(norm(t.text)) &&
        !(staleSteps && t.source !== "ClickUp card"),
    ).length;
    if (askable)
      add(
        8,
        {
          text: `Ask if they did it: ${askable.text}${askMore ? ` (and ${plural(askMore, "more step")} of theirs)` : ""}`,
          source: askable.source,
          day: askable.day,
        },
        askable.text,
      );
    // A request a line above already raises is not asked again: "Have Mahara
    // contact pre-existing leads" is the kickoff's old leads list. Two of its
    // words at least, so "More leads" is not covered by every line on leads.
    const raised = (r: string) => {
      const size = new Set(contentWords(r)).size;
      return raise.some(l => {
        const o = overlapOf(r, l.text);
        return o >= 0.5 && Math.round(o * size) >= 2;
      });
    };
    const ask = recent
      .flatMap(d => (d.clientRequests ?? []).map(r => ({ r: String(r), d })))
      .filter(
        x =>
          !(
            /kickoff|onboarding/i.test(x.d.kind) &&
            /^(focus on|grow|attract|organi[sz]e|help|increase|get more|bring)\b/i.test(
              x.r,
            )
          ) &&
          !brief.promises.ours.some(o => sharedWords(o.text, x.r) >= 0.5) &&
          !raised(x.r),
      )[0];
    if (ask)
      add(
        9,
        {
          text: `They asked for: ${clean(ask.r)}`,
          source: "ClickUp card",
          day: kuwaitDay(ask.d.at),
        },
        ask.r,
      );
    if (
      told.length &&
      mode === "live" &&
      realAll.length &&
      now - realAll[0].at < 14 * DAY
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
    if (mode === "live" && timeline && metaRows.length === 0) {
      // A Meta risk already raised carries it; otherwise its own line.
      const metaRisk = raise.find(
        l =>
          l.source === "ClickUp card" &&
          /\bmeta\b|ad account|billing|balance|restrict/i.test(l.text),
      );
      if (metaRisk)
        metaRisk.text = `${metaRisk.text} Meta's log also shows no ad changes in 90 days: check their ad account is linked.`;
      else
        add(12, {
          text: "No ad changes are recorded for them in 90 days. Check their ads are live and their ad account is linked.",
          source: "Meta",
        });
    }
    for (const a of actionable) add(13, a);
    for (const w of diagnosis?.watch ?? [])
      add(14, {
        text: `Watch: ${w.title}.${w.fixes?.[0] ? ` ${w.fixes[0]}` : ""}`,
        source: "Numbers",
      });
    if (brief.defcon?.old && mode === "live" && !testimonial)
      add(15, {
        text: `Their mood was last recorded on ${brief.defcon.day} (${brief.defcon.value}). Ask, and update the 1-1 form.`,
        source: "1-1 form",
      });
    // Ranked, said once, at most six; only the first says "before anything else".
    const kept: Cand[] = [];
    for (const l of raise.sort((a, b) => a.rank - b.rank)) {
      if (
        l.core &&
        kept.some(k => k.core && sharedWords(k.core, l.core ?? "") >= 0.5)
      )
        continue;
      kept.push(l);
    }
    let first = true;
    brief.raise = kept.slice(0, 6).map(({ rank: _r, core: _c, ...line }) => {
      if (!/before anything else/.test(line.text)) return line;
      if (first) {
        first = false;
        return line;
      }
      return {
        ...line,
        text: line.text
          .replace(/,?\s*before anything else changes\./, ".")
          .replace(/,?\s*before anything else\./, "."),
      };
    });
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

/** What to quote for a problem: its heading when that is the problem, else the clause. */
function problemLead(t: string): string {
  const head = /^([^:：]{3,60})[:：]\s*(.*)$/.exec(t);
  // "Problem:" and "Root cause:" only label the problem; quote what follows.
  const generic =
    head &&
    /^(problems?|issues?|main (?:issue|problem)|root cause|(?:primary |main )?bottleneck|challenge|المشكلة|المشكلات|المشاكل|السبب الجذري|السبب)$/i.test(
      head[1].trim(),
    );
  if (head && !generic && PROBLEM.test(head[1])) return head[1].trim();
  const body = head ? head[2] : t;
  const sentences = body.split(/(?<=[.!?؟;؛])\s+/);
  let clause = generic
    ? sentences[0]
    : (body.split(/(?<=[.!?؟;؛])\s+|(?<=[،,])\s+/).find(s => PROBLEM.test(s)) ??
      body);
  // A clause cut inside brackets reads as a fragment: use its sentence.
  if ((clause.match(/\(/g)?.length ?? 0) !== (clause.match(/\)/g)?.length ?? 0))
    clause = sentences.find(s => s.includes(clause)) ?? clause;
  return cut(clause.replace(/[.،,;]+$/, ""), 80);
}

/**
 * The KPI line from the cockpit's own roll-ups: one metric (cost per
 * booking when there is one), first and newest in the window, with every
 * figure the newest roll-up gives for this client.
 */
function kpiTrend(rows: { t: number; units: EodUnit[] }[]): BriefLine | null {
  const points = rows
    .map(r => {
      const text = r.units.map(u => u.text).join(" ");
      const all = [
        ...text.matchAll(/(cost per booking|cpb|cpl)\s*\$?\s*([\d,.]+)/gi),
      ].map(m => ({
        metric: /cpl/i.test(m[1]) ? "Cost per lead" : "Cost per booking",
        value: m[2].replace(/[.,]$/, ""),
      }));
      return { t: r.t, all };
    })
    .filter(p => p.all.length);
  if (!points.length) return null;
  const metric = points.some(p =>
    p.all.some(x => x.metric === "Cost per booking"),
  )
    ? "Cost per booking"
    : "Cost per lead";
  const series = points
    .map(p => ({
      t: p.t,
      values: [
        ...new Set(p.all.filter(x => x.metric === metric).map(x => x.value)),
      ],
    }))
    .filter(p => p.values.length)
    .sort((a, b) => a.t - b.t);
  if (!series.length) return null;
  const fmt = (p: { t: number; values: string[] }) =>
    `$${p.values.join(" and $")} (${kuwaitDay(p.t)}${p.values.length > 1 ? ", two figures" : ""})`;
  const chosen =
    series.length <= 3 ? series : [series[0], series[series.length - 1]];
  return {
    text: `${metric}: ${chosen.map(fmt).join(" → ")}`,
    source: "Media buyer cockpit (auto)",
    day: kuwaitDay(series[series.length - 1].t),
  };
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
