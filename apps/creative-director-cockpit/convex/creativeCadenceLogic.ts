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
    "2. Brief one materially new video concept and two distinct still-image concepts using the approved Brand DNA, offer and real project proof. Reuse an open creative request rather than opening a duplicate.",
    "3. For a filmed video, link the exact ClickUp script task and final script or document. Review the offer, hook, CTA and dialect; record the client's script approval before filming. A completed script-request card alone is not proof of a finished or approved script.",
    "4. Link the production tasks and preview URLs for the video and both stills here. Review internally first. In the Video Pipeline, internal review, internal approved, client review and client approved are distinct stages. Record who approved each asset, when and where; a preview sent to the client is not approval.",
    "5. Hand only client-approved assets to the media buyer for the planned launch. Keep a performing winner live while testing the challenger. The buyer records the launch and qualified results in the existing Changes & Results flow.",
    "6. Review delivery and qualified outcomes with the media buyer before replacing anything. If approval is late, flag the blocker and move the launch window; never count an unapproved edit as reserve. This card tracks the batch and does not replace script, production or approval tasks.",
    `Cadence key: ${key}`,
  ].join("\n\n");
}
