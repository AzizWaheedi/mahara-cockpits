/**
 * The prompt file of a set (prompts.website.json): the drawing model, the
 * prompts of every variant, and the picks made from them by eye.
 */
import { readFileSync } from "node:fs";
import { PROMPTS, SLOTS, type Slot } from "./paths";

export interface Variant {
  slot: Slot;
  prompt: string;
}

/** A variant chosen for a slot, and how it is cut. */
export interface Pick {
  /** The variant id, as in `variants`. */
  from: string;
  /** x, y, w, h as shares of the drawn picture (0..1). */
  crop: [number, number, number, number];
  /** Mirror left to right (only pictures with no writing in them). */
  flip?: boolean;
  /** CSS object-position that keeps the subject in frame on a narrow page. */
  focus: string;
  /** The side with room for words. */
  quiet: "left" | "right" | "top" | "bottom";
  /** Luma grain added at export, 0..10 (ffmpeg noise strength). */
  grain: number;
  /** Why this one, in a sentence. */
  why: string;
}

export interface PromptFile {
  note: string;
  model: string;
  body: { resolution: string; quality: string; aspect_ratio: string };
  cap: number;
  closing: string;
  variants: Record<string, Variant>;
  picks: Partial<Record<Slot, Pick>>;
}

export function loadPrompts(path = PROMPTS): PromptFile {
  const f = JSON.parse(readFileSync(path, "utf8")) as PromptFile;
  const problems = promptFileProblems(f);
  if (problems.length) {
    throw new Error(`${path} needs fixing: ${problems.join("; ")}`);
  }
  return f;
}

/** Plain sentences for everything wrong with a prompt file. */
export function promptFileProblems(f: PromptFile): string[] {
  const out: string[] = [];
  if (typeof f.model !== "string" || !f.model) out.push("model is missing");
  if (!(Number.isInteger(f.cap) && f.cap >= 1 && f.cap <= 12)) {
    out.push("cap must be a whole number from 1 to 12");
  }
  if (typeof f.closing !== "string" || f.closing.length < 20) {
    out.push("closing is missing");
  }
  const ids = Object.keys(f.variants ?? {});
  if (ids.length === 0) out.push("there are no variants");
  if (ids.length > f.cap) {
    out.push(`${ids.length} variants is more than the cap of ${f.cap}`);
  }
  for (const id of ids) {
    const v = f.variants[id];
    if (!/^[a-z]+-[a-z]$/.test(id)) out.push(`variant id ${id} is not <slot>-<letter>`);
    if (!SLOTS.includes(v.slot)) out.push(`${id} names no known slot`);
    if (!id.startsWith(`${v.slot}-`)) out.push(`${id} does not start with its slot`);
    if (typeof v.prompt !== "string" || v.prompt.length < 80) {
      out.push(`${id} has no real prompt`);
    }
  }
  for (const [slot, p] of Object.entries(f.picks ?? {}) as [Slot, Pick][]) {
    if (!SLOTS.includes(slot)) out.push(`pick ${slot} is not a slot`);
    const v = f.variants[p.from];
    if (!v) out.push(`pick ${slot} comes from ${p.from}, which is not a variant`);
    else if (v.slot !== slot) out.push(`pick ${slot} comes from a ${v.slot} variant`);
    const [x, y, w, h] = p.crop ?? [];
    const okCrop =
      [x, y, w, h].every(n => typeof n === "number" && n >= 0 && n <= 1) &&
      x + w <= 1.000001 &&
      y + h <= 1.000001 &&
      w >= 0.5 &&
      h >= 0.5;
    if (!okCrop) out.push(`pick ${slot} has a crop outside the picture`);
    if (!/^\d{1,3}% \d{1,3}%$/.test(p.focus ?? "")) {
      out.push(`pick ${slot} focus is not "<x>% <y>%"`);
    }
    if (!["left", "right", "top", "bottom"].includes(p.quiet)) {
      out.push(`pick ${slot} quiet side is not left, right, top or bottom`);
    }
    if (!(typeof p.grain === "number" && p.grain >= 0 && p.grain <= 10)) {
      out.push(`pick ${slot} grain is not 0..10`);
    }
    if (typeof p.why !== "string" || p.why.length < 10) {
      out.push(`pick ${slot} does not say why`);
    }
  }
  return out;
}

export const fullPrompt = (f: PromptFile, id: string) =>
  `${f.variants[id].prompt} ${f.closing}`;
