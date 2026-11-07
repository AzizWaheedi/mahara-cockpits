import type { Job } from "./types";

/** ClickUp Urgent means the editors should work this video first. */
export const isPriorityVideo = (job: Pick<Job, "priority">): boolean =>
  job.priority === "urgent";

/** Keep the existing due-date order within each priority level. */
export function priorityFirst(
  a: Pick<Job, "priority">,
  b: Pick<Job, "priority">,
): number {
  return Number(isPriorityVideo(b)) - Number(isPriorityVideo(a));
}
