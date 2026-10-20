import type { Job } from "./types";

/**
 * The Video Pipeline's statuses in ClickUp's own order (list 901816720767,
 * read 2026-10-20), and who each one waits on.
 *
 * The desk's `state` says whether the footage is read; it does not say whose
 * turn it is. Grouping by `state` alone put cards in client review and
 * client approved under "Ready to start", and counted them as late, so the
 * first screen said 41 jobs were late when most were with a reviewer.
 */
export const STAGES = [
  "new video request",
  "planning",
  "in progress",
  "internal review",
  "internal approved",
  "client review",
  "client approved",
  "update required",
  "on hold",
  "live",
  "cancelled",
];

/** "live 🚀" -> "live": the board's word, lower case, without its emoji. */
export function stageOf(status: string | null | undefined): string {
  return (status ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const IN_REVIEW = new Set([
  "internal review",
  "internal approved",
  "client review",
  "client approved",
]);
// ClickUp types "live 🚀" as done and "cancelled" as closed.
const FINISHED = new Set(["live", "cancelled", "complete", "closed", "done"]);

/** Whose turn it is. A status the board adds later counts as the editor's,
 * so new work shows up instead of disappearing. */
export type Holder = "editor" | "review" | "hold" | "finished";

export function holder(status: string | null | undefined): Holder {
  const s = stageOf(status);
  if (FINISHED.has(s)) return "finished";
  if (IN_REVIEW.has(s)) return "review";
  if (s === "on hold") return "hold";
  return "editor";
}

/** The job is the editor's to do: on the board, and not handed in yet. */
export function onEditor(job: Job): boolean {
  return (
    job.state !== "gone" &&
    job.state !== "delivered" &&
    holder(job.status) === "editor"
  );
}

/** Position on the board; a status ClickUp adds later goes at the end. */
export function stageRank(status: string | null | undefined): number {
  const i = STAGES.indexOf(stageOf(status));
  return i < 0 ? STAGES.length : i;
}

/** "client review" -> "Client review". */
export function stageLabel(status: string | null | undefined): string {
  const s = (status ?? "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "No status";
}
