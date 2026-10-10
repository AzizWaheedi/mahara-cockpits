import {
  type Funnel,
  gapFor,
  sayMany,
  sayMoney,
  sayPct,
  stepWords,
  TOKEN_ALIASES,
  TOKEN_LABELS,
} from "./funnel";

/**
 * The call scripts as the cockpit stores them (cockpit_sales_scripts, from
 * hermes/sales-desk/scripts_import). One document per script and language:
 * stages with their goal and time, the blocks in order, and the checklist a
 * stage must meet before moving on; the objection and FAQ playbooks; and the
 * capture fields each stage fills in on the lead.
 */

export type BlockType = "say" | "adapt" | "note" | "step" | "list";

export interface Block {
  type: BlockType;
  text?: string;
  items?: string[];
  branch?: string | null;
  /**
   * When the branch applies, for the ones the cockpit can tell from the
   * notes: "leak:booking" opens by itself when booking is where the
   * prospect's funnel leaks the most (lib/funnel.ts).
   */
  when?: string | null;
}

export interface Stage {
  no: number;
  title: string;
  goal: string | null;
  minutes: number | null;
  blocks: Block[];
  checklist: string[];
}

export interface Capture {
  stage: number;
  /**
   * The block in its stage the field sits under: the line that asks for it
   * (scripts_import/captures.json, kept per language by load.py). A field
   * with none goes to the end of its stage, under "Answers for this part".
   */
  after?: number;
  key: string;
  label: string;
  /** money is an amount in the prospect's own currency ("85k" reads as 85,000). */
  type: "text" | "number" | "choice" | "money";
  options?: string[];
}

export interface PlaybookEntry {
  title: string;
  blocks: Block[];
}

export interface ScriptDoc {
  key: "intro" | "demo";
  lang: "en" | "ar";
  title: string | null;
  intro?: Block[];
  sections?: { title: string; blocks: Block[] }[];
  stages: Stage[];
  objections: PlaybookEntry[];
  faqs: PlaybookEntry[];
  captures: Capture[];
}

export interface ScriptRow {
  id: string;
  key: "intro" | "demo";
  lang: "en" | "ar";
  version: number;
  title: string | null;
  doc: ScriptDoc;
  imported_at: string;
}

/** What the placeholders in the scripts stand for on this call. */
export interface Fill {
  name?: string | null;
  yourName?: string | null;
  city?: string | null;
  closer?: string | null;
  date?: string | null;
  problem?: string | null;
  revenue?: string | null;
  goal?: string | null;
  tried?: string | null;
  desired?: string | null;
  gap?: string | null;
  /**
   * The numbers placeholders ([GAP YEAR], [CLOSE RATE], $[V] …) as the
   * funnel math says them in the script's language (funnelTokens).
   */
  tokens?: Record<string, string>;
  /** The first two free demo times, said for "__ or __" (the booking block reads them). */
  slots?: string[] | null;
  /** The demo's booked time with its zone, for [TIME + TIMEZONE]. */
  booked?: string | null;
}

// The scripts' own placeholders, English and Arabic, and what fills each.
// Anything else in brackets ([X], [calculate]) is for the rep to work out on
// the call and stays as written.
const PLACEHOLDERS: [RegExp, keyof Fill][] = [
  [/\[(YOUR NAME|اسمك)\]/gi, "yourName"],
  [/\[(CLOSER NAME|اسم الكلوزر|اسم المستشار)\]/gi, "closer"],
  [/\[(NAME|الاسم)\]/gi, "name"],
  [
    /\[(CITY|المدينة|their city or region|their region|مدينتهم أو منطقتهم|منطقتهم)\]/gi,
    "city",
  ],
  [/\[(DATE|التاريخ)\]/gi, "date"],
  [/\[(TIME \+ TIMEZONE|الوقت)\]/gi, "booked"],
  [/\[(PROBLEM|المشكلة)\]/gi, "problem"],
  [/\$?\[(REVENUE|الإيرادات)\]/gi, "revenue"],
  [/\[(GOAL|هدفهم)\]/gi, "goal"],
  [/\[(WHAT THEY TRIED|اللي جربته)\]/gi, "tried"],
  [/\[(their desired state|desired state|وضعهم المطلوب)\]/gi, "desired"],
  [/\$?\[(gap|الفجوة|فجوتهم)\]/gi, "gap"],
];

/** Put the lead's details into a line. A placeholder with no value stays as it is. */
export function personalise(text: string, fill: Fill): string {
  return fillLine(text, fill, false);
}

// Around a value the notes filled in, and around a numbers placeholder the
// notes cannot fill yet, for the script view to set them apart.
export const FILLED_OPEN = "\uE000";
export const FILLED_CLOSE = "\uE001";
export const BLANK_OPEN = "\uE002";
export const BLANK_CLOSE = "\uE003";

/** The same, with what the notes filled in and what they still need marked. */
export function personaliseMarked(text: string, fill: Fill): string {
  return fillLine(text, fill, true);
}

/** The two times a line offers ("__ or __", "__ ولا __"). */
const TWO_TIMES = /__\s*(or|ولا)\s*__/g;

/**
 * What a dashed blank says when it is not one of the numbers: the words in
 * its brackets in sentence case, and the two times not read yet.
 */
export const BLANK_LABELS: Record<string, { en: string; ar: string }> = {
  "TWO TIMES": { en: "Two free times", ar: "وقتين فاضيين" },
  // The lead's details not known yet, in an Arabic line: the Arabic docs'
  // own words for them ([الوقت], [التاريخ], [اسم الكلوزر] …).
  "Time + timezone": { en: "Time + timezone", ar: "الوقت" },
  Date: { en: "Date", ar: "التاريخ" },
  "Closer name": { en: "Closer name", ar: "اسم الكلوزر" },
  Name: { en: "Name", ar: "الاسم" },
  "Your name": { en: "Your name", ar: "اسمك" },
};

/** "STRENGTHS" → "Strengths"; words already in mixed case keep it. */
export function sentenceCase(words: string): string {
  const t = words.trim().replace(/\s+/g, " ");
  const shouty = !/[a-z]/.test(t);
  const base = shouty ? t.toLowerCase() : t;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function fillLine(text: string, fill: Fill, mark: boolean): string {
  const wrap = (v: string) => (mark ? `${FILLED_OPEN}${v}${FILLED_CLOSE}` : v);
  let out = text;
  for (const [re, key] of PLACEHOLDERS) {
    const v = fill[key];
    if (typeof v === "string" && v.trim())
      out = out.replace(re, () => wrap(v.trim()));
  }
  const two = (fill.slots ?? []).filter(t => t?.trim());
  out = out.replace(TWO_TIMES, (whole, or: string) => {
    if (two.length >= 2) return `${wrap(two[0])} ${or} ${wrap(two[1])}`;
    return mark ? `${BLANK_OPEN}TWO TIMES${BLANK_CLOSE}` : whole;
  });
  const tokens = fill.tokens ?? {};
  return out.replace(/\$?\[([^[\]\n]{1,120})\]/g, (whole, inner: string) => {
    const name = inner.trim().toUpperCase();
    const key = TOKEN_ALIASES[name] ?? TOKEN_ALIASES[inner.trim()] ?? name;
    const v = tokens[key];
    if (v) return wrap(v);
    if (!mark) return whole;
    if (key in TOKEN_LABELS) return `${BLANK_OPEN}${key}${BLANK_CLOSE}`;
    // Anything else in brackets ([STRENGTHS], [X], [CLOSER NAME] with no
    // closer yet) is for the rep to fill in on the call: a dashed blank
    // with its words, never a raw bracket read out loud. A count ("[2-3]")
    // and another way to say it ("[or our system]") are the doc's own
    // asides and stay as written.
    if (/^\s*([0-9٠-٩]|or\s|أو\s)/i.test(inner)) return whole;
    const words = sentenceCase(inner);
    return words ? `${BLANK_OPEN}${words}${BLANK_CLOSE}` : whole;
  });
}

export type LinePart =
  | { kind: "text"; text: string }
  | { kind: "filled"; text: string }
  | { kind: "blank"; token: string };

/** A marked line in pieces; a mark cut off by the bullet view closes at the end. */
export function lineParts(marked: string): LinePart[] {
  const parts: LinePart[] = [];
  let i = 0;
  let text = "";
  const flush = () => {
    if (text) parts.push({ kind: "text", text });
    text = "";
  };
  while (i < marked.length) {
    const ch = marked[i];
    if (ch === FILLED_OPEN || ch === BLANK_OPEN) {
      const close = ch === FILLED_OPEN ? FILLED_CLOSE : BLANK_CLOSE;
      const end = marked.indexOf(close, i + 1);
      const inner = marked.slice(i + 1, end < 0 ? marked.length : end);
      flush();
      if (ch === FILLED_OPEN) parts.push({ kind: "filled", text: inner });
      else parts.push({ kind: "blank", token: inner });
      i = end < 0 ? marked.length : end + 1;
      continue;
    }
    if (ch !== FILLED_CLOSE && ch !== BLANK_CLOSE) text += ch;
    i += 1;
  }
  flush();
  return parts;
}

/** The first sentence, for the bullet view. */
export function firstSentence(text: string, max = 110): string {
  const t = text.trim();
  const m = t.match(/^(.+?[.?!؟…])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * The blocks of a stage grouped: the main path, then each branch in order.
 * Each group keeps where it starts in the stage, so a field anchored to a
 * block (Capture.after) finds its line inside a branch too.
 */
export function groupBlocks(
  blocks: Block[],
): { branch: string | null; blocks: Block[]; start: number }[] {
  const out: { branch: string | null; blocks: Block[]; start: number }[] = [];
  blocks.forEach((b, i) => {
    const key = b.branch ?? null;
    const last = out[out.length - 1];
    if (last && last.branch === key) last.blocks.push(b);
    else out.push({ branch: key, blocks: [b], start: i });
  });
  return out;
}

/**
 * A stage's fields: the ones that sit under their line (by block index)
 * and the rest, for the end of the stage. An anchor past the stage's end or
 * on a step heading goes to the rest, as load.py drops it.
 */
export function inlineCaptures(
  stage: Stage,
  captures: Capture[],
  skip: readonly string[] = [],
): { at: Record<number, Capture[]>; rest: Capture[] } {
  const at: Record<number, Capture[]> = {};
  const rest: Capture[] = [];
  for (const c of captures) {
    if (c.stage !== stage.no || skip.includes(c.key)) continue;
    const i = c.after;
    const ok =
      typeof i === "number" &&
      Number.isInteger(i) &&
      i >= 0 &&
      i < stage.blocks.length &&
      stage.blocks[i]?.type !== "step";
    if (ok) {
      at[i] = at[i] ?? [];
      at[i].push(c);
    } else rest.push(c);
  }
  return { at, rest };
}

/** Fields the setter captured that the closer's script also asks for. */
export const CARRY_OVER: Record<string, string> = {
  decision_maker: "decision_maker",
  pain: "pain",
  focus_project: "project_types",
  project_value: "project_value",
  margin: "margin",
  revenue_12m: "revenue_12m",
  projects_closed_12m: "projects_closed_12m",
  ad_spend_month: "ad_spend_month",
  ad_leads_month: "ad_leads_month",
  years_in_business: "years_in_business",
  goal: "desired_state",
  partner_on_demo: "partner_joining",
  currency: "currency",
};

/**
 * A readable summary of captured answers, stored as the note's text. With a
 * currency, a money answer typed without one says it ("85k KWD"), so the
 * lead page and the closer read the amount as the rep heard it.
 */
export function summarise(
  captures: Capture[],
  values: Record<string, string>,
  currency?: string | null,
): string {
  return captures
    .filter(c => values[c.key]?.trim())
    .map(c => {
      const v = values[c.key].trim();
      const named =
        /\b(USD|KWD|SAR|AED|QAR|BHD|OMR|dollars?|dinars?|riyals?|dirhams?)\b|[$€£]|دينار|ريال|درهم|دولار/i.test(
          v,
        );
      return `${c.label}: ${c.type === "money" && currency && !named ? `${v} ${currency}` : v}`;
    })
    .join("\n");
}

/**
 * The numbers, said for the team in the call's saved notes. The intro's are
 * too few to name the one thing; the demo names it.
 */
export function numbersSummary(f: Funnel, script: "intro" | "demo"): string {
  const m = (n: number) => sayMoney(n, f.currency, "en");
  const g = f.given;
  const parts: string[] = [];
  if (g.spend != null) parts.push(`ad spend ${m(g.spend)} a month`);
  if (f.costs.perLead != null)
    parts.push(
      `${m(f.costs.perLead)} an inquiry${f.costs.perLeadAllSources ? " (all sources)" : ""}, ours ${m(f.ours.perLead)}`,
    );
  if (g.leads != null) parts.push(`${g.leads} inquiries a month`);
  const names: Record<string, string> = {
    booking: "booked",
    show: "held",
    close: "signed",
  };
  for (const st of f.steps)
    if (st.key !== "ads" && st.theirs != null && st.standing !== "impossible")
      parts.push(
        `${names[st.key]} ${sayPct(st.theirs, "en")}, ours ${sayPct(st.ours, "en")}`,
      );
  if (f.rates.quoteWin != null && f.rates.quoteWin <= 1)
    parts.push(`wins ${sayPct(f.rates.quoteWin, "en")} of quotes`);
  const lines: string[] = [];
  if (parts.length) lines.push(`Their numbers: ${parts.join("; ")}.`);
  const gap = script === "demo" ? gapFor(f) : null;
  if (f.leak && gap?.projectsYear != null && gap.projectsYear >= 0.5)
    lines.push(
      `The one thing: ${stepWords(f.leak, "en")}, ${sayMany(gap.projectsYear, "project", "en", f.leak !== "referrals")} a year${
        gap.moneyYear != null ? `, ${m(gap.moneyYear)} a year` : ""
      }.`,
    );
  return lines.join("\n");
}

/** The same numbers kept on the note, for anyone who adds them up later. */
export function numbersFields(f: Funnel) {
  const gap = gapFor(f);
  const round = (n: number | null | undefined, places: number) =>
    n == null ? null : Math.round(n * 10 ** places) / 10 ** places;
  return {
    currency: f.currency,
    leak: f.leak,
    gap_projects_year: round(gap?.projectsYear, 1),
    gap_money_year: round(gap?.moneyYear, 0),
    rates: f.rates,
    costs: f.costs,
    ours: f.ours,
    problems: f.problems,
  };
}

/** The answer the intro's last part writes as its notes: the setter's line for the closer. */
export const CLOSER_KEY = "for_the_closer";

/**
 * The call's notes as the lead page, the closer and the desk read them: the
 * first line names the call (FromIntro strips it, every reader keys on it),
 * the setter's line for the closer next, then the answers, the numbers, and
 * the notes on each part in the script's order.
 */
export function scriptNoteBody(p: {
  key: "intro" | "demo";
  captures: Capture[];
  values: Record<string, string>;
  numbers: string;
  notes: Record<string, string>;
  stages: Pick<Stage, "no" | "title">[];
  /** The prospect's currency, said after a money answer typed without one. */
  currency?: string | null;
}): string {
  const out: string[] = [p.key === "intro" ? "Intro call notes" : "Demo notes"];
  const closer = (p.values[CLOSER_KEY] ?? "").trim();
  if (p.key === "intro" && closer) out.push(`For the closer: ${closer}`);
  const answers = summarise(
    p.captures.filter(c => c.key !== CLOSER_KEY),
    p.values,
    p.currency,
  );
  if (answers) out.push("", "Answers", answers);
  if (p.numbers.trim()) out.push("", p.numbers.trim());
  const parts = p.stages
    .filter(s => (p.notes[String(s.no)] ?? "").trim())
    .map(s => `${s.no}. ${s.title}: ${(p.notes[String(s.no)] ?? "").trim()}`);
  if (parts.length) out.push("", "Notes by part", ...parts);
  return out.join("\n");
}

/** The number strip's slots, in the order the call asks for them. */
export const LEDGER_SLOTS: Record<"intro" | "demo", string[]> = {
  intro: [
    "project_value",
    "projects_closed_12m",
    "quotes_12m",
    "revenue_12m",
    "ad_spend_month",
    "ad_leads_month",
  ],
  demo: [
    "project_value",
    "revenue_12m",
    "ad_spend_month",
    "ad_leads_month",
    "leads_month",
    "booked_month",
    "showed_month",
    "closed_month",
  ],
};

/** Short names for the slots: a phone fits four or five of them. */
export const LEDGER_LABELS: Record<string, string> = {
  project_value: "Project value",
  projects_closed_12m: "Closed, 12 mo",
  quotes_12m: "Quotes, 12 mo",
  revenue_12m: "Revenue, 12 mo",
  ad_spend_month: "Ad spend / mo",
  ad_leads_month: "Ad inquiries / mo",
  leads_month: "Inquiries / mo",
  booked_month: "Booked / mo",
  showed_month: "Held / mo",
  closed_month: "Signed / mo",
};

/** The demo's funnel, in its real order: the slots joined by chevrons. */
export const LEDGER_FUNNEL = [
  "leads_month",
  "booked_month",
  "showed_month",
  "closed_month",
];
