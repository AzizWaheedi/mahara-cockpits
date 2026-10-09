// Do's & Don'ts tidy: the native port of convex/dosDonts.ts tidyClient /
// tidyAll. Every client card on Clients - Mahara whose Do's & Don'ts field is
// not in the clean DO / DON'T format is rewritten into it. Lines that are
// notes, not rules, go to a task comment first (never twice), and the field is
// only rewritten if nobody edited it in ClickUp meanwhile.
//
// Why it is kept: the native producers (hermes/cockpit-sync) clean the text
// for display only. Without this job the cards themselves stay messy and every
// reader has to clean them again.

import { CLIENTS_LIST, cleanDosDonts, DOS_DONTS_FIELD, NOTES_MARK, type Row } from "./rules.ts";
import type { Provider } from "./queue.ts";

export type DosDontsCandidate = { taskId: string; taskName: string; before: string; text: string; notes: string[] };

const valueOf = (task: Row): string => {
  const cf = (task.custom_fields ?? []).find((f: Row) => f.id === DOS_DONTS_FIELD);
  return typeof cf?.value === "string" ? cf.value : "";
};

/** Cards that need the clean format (convex/dosDonts.ts tidyAll filter). */
export function dosDontsCandidates(tasks: Row[]): DosDontsCandidate[] {
  const out: DosDontsCandidate[] = [];
  for (const t of tasks) {
    const before = valueOf(t);
    if (!before.trim()) continue;
    const clean = cleanDosDonts(before);
    if (clean.text === before.trim() && !clean.notes.length) continue;
    out.push({ taskId: String(t.id), taskName: String(t.name ?? ""), before, text: clean.text, notes: clean.notes });
  }
  return out;
}

export const notesComment = (notes: string[]) => `${NOTES_MARK}:\n${notes.map(n => `- ${n}`).join("\n")}`;

async function notesPosted(provider: Provider, taskId: string, notes: string[]) {
  const comments: Row[] = (await provider.call("clickup", "GET", `task/${taskId}/comment`)).comments ?? [];
  return comments.some(c => notes.every(n => String(c.comment_text ?? "").includes(n)));
}

async function currentValue(provider: Provider, taskId: string) {
  return valueOf(await provider.call("clickup", "GET", `task/${taskId}`));
}

export type DosDontsResult = { taskId: string; taskName: string; field: string; old: unknown; new: unknown; status: string; note?: string };

/** What would be written to one card. Reads only. */
export async function planDosDonts(c: DosDontsCandidate, provider: Provider): Promise<DosDontsResult[]> {
  const out: DosDontsResult[] = [];
  if (c.notes.length) {
    const posted = await notesPosted(provider, c.taskId, c.notes);
    out.push({ taskId: c.taskId, taskName: c.taskName, field: "comment", old: null, new: notesComment(c.notes), status: posted ? "unchanged" : "planned", note: posted ? "These notes are already in a comment." : undefined });
  }
  out.push({ taskId: c.taskId, taskName: c.taskName, field: "Do's & Don'ts", old: c.before, new: c.text || null, status: "planned", note: c.text ? undefined : "The field would be cleared: it holds notes only." });
  return out;
}

/** Put one card into the clean format (convex/dosDonts.ts tidy). */
export async function tidyCard(taskId: string, taskName: string, provider: Provider): Promise<DosDontsResult[]> {
  const before = await currentValue(provider, taskId);
  const { text, notes } = cleanDosDonts(before);
  if (text === before.trim() && !notes.length) return [{ taskId, taskName, field: "Do's & Don'ts", old: before, new: before, status: "unchanged" }];
  const out: DosDontsResult[] = [];
  if (notes.length) {
    if (await notesPosted(provider, taskId, notes)) out.push({ taskId, taskName, field: "comment", old: null, new: notesComment(notes), status: "unchanged" });
    else {
      await provider.call("clickup", "POST", `task/${taskId}/comment`, { comment_text: notesComment(notes), notify_all: false });
      out.push({ taskId, taskName, field: "comment", old: null, new: notesComment(notes), status: "written" });
    }
  }
  if ((await currentValue(provider, taskId)).trim() !== before.trim()) {
    out.push({ taskId, taskName, field: "Do's & Don'ts", old: before, new: text || null, status: "skipped", note: "Edited in ClickUp meanwhile, so it was left as it is." });
    return out;
  }
  if (text) await provider.call("clickup", "POST", `task/${taskId}/field/${DOS_DONTS_FIELD}`, { value: text });
  else await provider.call("clickup", "DELETE", `task/${taskId}/field/${DOS_DONTS_FIELD}`);
  out.push({ taskId, taskName, field: "Do's & Don'ts", old: before, new: text || null, status: "written" });
  return out;
}

export const DOS_DONTS_LIST = CLIENTS_LIST;
