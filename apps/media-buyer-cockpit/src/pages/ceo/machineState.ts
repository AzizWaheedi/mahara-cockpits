import type { StatusTone } from "@/components/ceo/StatusChip";
import type { MachinePayload } from "../../../convex/ceo/payloads";

/**
 * Health rules for the machine payload, shared by the Machine tab and the
 * Today strip so both read the same state from the same numbers.
 */

export type MachineState = { tone: StatusTone; label: string };

type Job = MachinePayload["jobs"][number];
type Feed = MachinePayload["feeds"][number];

/** Minutes between cockpit sync runs; the sync runs every 10 minutes by day. */
export function syncEvery(m: MachinePayload): number {
  return m.jobs.find(j => j.job === "sync")?.everyMin ?? 10;
}

/** Cockpit sync: on time within two runs, slow up to the overdue rule, then stalled. */
export function syncState(
  ageMin: number | null,
  everyMin: number,
): MachineState {
  if (ageMin === null || !Number.isFinite(ageMin))
    return { tone: "neutral", label: "No run yet" };
  if (ageMin <= 2 * everyMin) return { tone: "good", label: "On time" };
  if (ageMin <= Math.max(3 * everyMin, 45))
    return { tone: "warning", label: "Slow" };
  return { tone: "serious", label: "Stalled" };
}

// The same overdue rule as the backend's health.staleJobs: three runs, and never under 45 minutes.
export const jobOverdue = (j: Job, now: number) =>
  now - j.at > Math.max(3 * j.everyMin, 45) * 60_000;

export function jobState(j: Job, now: number): MachineState {
  if (!j.ok) return { tone: "critical", label: "Failing" };
  if (jobOverdue(j, now)) return { tone: "warning", label: "Overdue" };
  return { tone: "good", label: "Running" };
}

export function feedState(f: Feed): MachineState {
  if (f.ok) return { tone: "good", label: "Healthy" };
  // "Missed its scheduled runs" is the backend's wording for a feed that is only late.
  if (f.error && /missed its scheduled runs/i.test(f.error))
    return { tone: "warning", label: "Late" };
  return { tone: "serious", label: "Failing" };
}
