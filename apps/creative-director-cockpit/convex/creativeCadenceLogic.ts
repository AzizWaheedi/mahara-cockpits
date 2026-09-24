/** The director briefs each batch on a Monday; the intended launch is two weeks later. */
const DAY = 86_400_000;
const KUWAIT_OFFSET = 3 * 60 * 60_000;
const FIRST_CYCLE = Date.parse("2026-09-28T00:00:00Z");

export function nextCreativeCycle(now: number): string {
  const localDay = new Date(now + KUWAIT_OFFSET).toISOString().slice(0, 10);
  const day = Date.parse(`${localDay}T00:00:00Z`);
  const cycles = Math.max(0, Math.ceil((day - FIRST_CYCLE) / (14 * DAY)));
  return new Date(FIRST_CYCLE + cycles * 14 * DAY).toISOString().slice(0, 10);
}

export function batchKey(clientTaskId: string, cycle: string): string {
  return `creative-batch:${clientTaskId}:${cycle}`;
}

export function batchTitle(clientName: string, cycle: string): string {
  return `Creative batch ${cycle} · ${clientName}`;
}

export function cycleDates(cycle: string): {
  approvalTarget: string;
  launch: string;
} {
  const later = (days: number) =>
    new Date(Date.parse(`${cycle}T00:00:00Z`) + days * DAY)
      .toISOString()
      .slice(0, 10);
  return { approvalTarget: later(7), launch: later(14) };
}

export function batchBrief(
  clientName: string,
  cycle: string,
  key: string,
): string {
  const { approvalTarget, launch } = cycleDates(cycle);
  return [
    `Two-week ad creative batch for ${clientName}.`,
    `Briefing date: ${cycle}. Client approval target: ${approvalTarget}. Intended first launch window: ${launch}.`,
    "1. Check current winner, qualified results and the approved reserve. Choose a new objection, proof, offer or visual angle; a crop is not a new concept.",
    "2. Brief one materially new video concept and two distinct still-image concepts. Use approved Brand DNA, offer and real project proof.",
    "3. Assign production, review the assets internally, then request client approval through the existing client process. Record each asset link and explicit approval.",
    "4. Hand an approved challenger to the media buyer for the planned launch. Keep a performing winner live while testing it.",
    "5. Review delivery and qualified outcomes with the media buyer before replacing anything. If approvals are late, escalate the blocker; never count an unapproved edit as reserve.",
    `Cadence key: ${key}`,
  ].join("\n\n");
}
