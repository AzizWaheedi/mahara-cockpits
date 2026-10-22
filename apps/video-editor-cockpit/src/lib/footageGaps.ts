import { holder } from "./stages";
import type { Job } from "./types";

/**
 * Why a job's footage is not on the Footage wall, worded as what fixes it.
 *
 * The wall shows only clips the desk has read. On 2026-10-22 it held 9 of
 * the 23 clients on the board, and nothing said where the other 14 were.
 * The reasons come from what the worker wrote on the job: its state, the
 * warnings in `error`, and the sentences in `missing`.
 */
export type GapKind =
  | "waiting"
  | "no-link"
  | "not-drive"
  | "not-video"
  | "cannot-open"
  | "empty"
  | "other";

export interface Gap {
  kind: GapKind;
  title: string;
  fix: string;
}

const GAPS: Record<GapKind, Omit<Gap, "kind">> = {
  waiting: {
    title: "Waiting for the desk",
    fix: "The desk reads new and changed jobs every half hour.",
  },
  "no-link": {
    title: "No footage link on the card",
    fix: "Add the Client Footage Folder or the Raw Video Link in ClickUp.",
  },
  "not-drive": {
    title: "The link is not Google Drive",
    fix: "Put the footage in a Drive folder and paste that link on the card.",
  },
  "not-video": {
    title: "The link opens a file that is not footage",
    fix: "Paste the link to the footage folder, not a document or a picture.",
  },
  "cannot-open": {
    title: "The desk cannot open the link",
    fix: "Share the folder with the desk, or check that it still exists.",
  },
  empty: {
    title: "The folder has no video the desk can see",
    fix: "Upload the footage, or share the folder with the desk. The desk looks again every day.",
  },
  other: {
    title: "Not read yet",
    fix: "Open the job to see what is missing.",
  },
};

/** Groups in the order a person works through them. */
export const GAP_ORDER: GapKind[] = [
  "no-link",
  "not-drive",
  "not-video",
  "cannot-open",
  "empty",
  "waiting",
  "other",
];

export function gapOf(job: Job): Gap {
  const kind = kindOf(job);
  return { kind, ...GAPS[kind] };
}

function kindOf(job: Job): GapKind {
  // A job sent back to be read still carries its last warnings.
  if (job.state === "new" || job.state === "stale" || job.state === null)
    return "waiting";
  if (!job.footage_url && !job.raw_url) return "no-link";
  const said = `${job.error ?? ""} ${(job.missing ?? []).join(" ")}`;
  if (/no usable Drive link|not a Google Drive link/i.test(said))
    return "not-drive";
  if (/not a folder and not a video/i.test(said)) return "not-video";
  if (/could not be opened/i.test(said)) return "cannot-open";
  if (/no video in it/i.test(said)) return "empty";
  return "other";
}

/**
 * Open jobs whose footage the desk has not read. A job counts as read when
 * the wall holds one of its clips, or the desk found files for it (the wall
 * keeps the newest clips only, so an older job may be read and not shown).
 */
export function jobsWithoutFootage(
  jobs: Job[],
  readTaskIds: Set<string>,
): Job[] {
  return jobs.filter(
    j =>
      j.state !== "gone" &&
      holder(j.status) !== "finished" &&
      !readTaskIds.has(j.task_id) &&
      !(j.files && j.files > 0),
  );
}
