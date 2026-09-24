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
  key: string;
  label: string;
  type: "text" | "number" | "choice";
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
  [/\[(PROBLEM|المشكلة)\]/gi, "problem"],
  [/\[(REVENUE|الإيرادات)\]/gi, "revenue"],
  [/\[(GOAL|هدفهم)\]/gi, "goal"],
  [/\[(WHAT THEY TRIED|اللي جربته)\]/gi, "tried"],
  [/\[(their desired state|desired state|وضعهم المطلوب)\]/gi, "desired"],
  [/\[(gap|الفجوة|فجوتهم)\]/gi, "gap"],
];

/** Put the lead's details into a line. A placeholder with no value stays as it is. */
export function personalise(text: string, fill: Fill): string {
  let out = text;
  for (const [re, key] of PLACEHOLDERS) {
    const v = fill[key];
    if (v && String(v).trim()) out = out.replace(re, String(v).trim());
  }
  return out;
}

/** The first sentence, for the bullet view. */
export function firstSentence(text: string, max = 110): string {
  const t = text.trim();
  const m = t.match(/^(.+?[.?!؟…])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** The blocks of a stage grouped: the main path, then each branch in order. */
export function groupBlocks(
  blocks: Block[],
): { branch: string | null; blocks: Block[] }[] {
  const out: { branch: string | null; blocks: Block[] }[] = [];
  for (const b of blocks) {
    const key = b.branch ?? null;
    const last = out[out.length - 1];
    if (last && last.branch === key) last.blocks.push(b);
    else out.push({ branch: key, blocks: [b] });
  }
  return out;
}

/** Fields the setter captured that the closer's script also asks for. */
export const CARRY_OVER: Record<string, string> = {
  decision_maker: "decision_maker",
  pain: "pain",
  focus_project: "project_types",
  project_value: "project_value",
  margin: "margin",
  revenue_12m: "revenue_12m",
  partner_on_demo: "partner_joining",
};

/** A readable summary of captured answers, stored as the note's text. */
export function summarise(
  captures: Capture[],
  values: Record<string, string>,
): string {
  return captures
    .filter(c => values[c.key]?.trim())
    .map(c => `${c.label}: ${values[c.key].trim()}`)
    .join("\n");
}
