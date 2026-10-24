/**
 * End of day: the changes Mahara's people made in Ads Manager, read from
 * Meta's activity log (cockpit_media_eod_changes). Until 24 Oct 2026 the
 * report listed only decisions logged in the cockpit, so a day of work in
 * Ads Manager read "No changes logged today".
 */
export type MetaChange = {
  at: number;
  client: string;
  actor: string;
  eventType: string;
  objectType?: string;
  objectName?: string;
};

/** Media-buying work. Meta's own housekeeping and account admin stay out. */
const WORK =
  /budget|targeting|bid strategy|performance goal|optimi[sz]ation goal|created|ad updated|status updated/i;
const NOT_WORK =
  /name updated|finishes ad review|billed|delivered|balance|spending limit|person (added|removed)|library/i;
/** A cockpit decision that wrote to Meta shows up in the log within minutes. */
const SAME_WRITE_MS = 10 * 60_000;

export const isWork = (c: MetaChange) =>
  WORK.test(c.eventType) && !NOT_WORK.test(c.eventType);

/**
 * One line per client: "• Alpha - in Ads Manager: ad set budget updated,
 * ad created (2) - Nada Al Saed". Changes within ten minutes of a decision
 * logged on that client's campaign are the decision's own write, already
 * listed above them.
 */
export function eodChangeLines(
  changes: MetaChange[],
  decided: { client: string; at: number }[],
): string[] {
  const byClient = new Map<string, MetaChange[]>();
  for (const c of changes) {
    if (!isWork(c)) continue;
    if (
      decided.some(
        d => d.client === c.client && Math.abs(d.at - c.at) <= SAME_WRITE_MS,
      )
    )
      continue;
    byClient.set(c.client, [...(byClient.get(c.client) ?? []), c]);
  }
  return [...byClient].map(([client, list]) => {
    const counts = new Map<string, number>();
    for (const c of list) {
      const what = c.eventType.toLowerCase();
      counts.set(what, (counts.get(what) ?? 0) + 1);
    }
    const what = [...counts]
      .map(([label, n]) => (n > 1 ? `${label} (${n})` : label))
      .join(", ");
    const who = [...new Set(list.map(c => c.actor))].join(", ");
    return `• ${client} - in Ads Manager: ${what} - ${who}`;
  });
}

/** The evidence under two EOD questions, counted from the same log. */
export function eodTaskEvidence(changes: MetaChange[] | null): {
  creativesUploaded: string;
  launchedPaused: string;
} {
  if (changes === null) {
    const none = "Meta's log could not be read. Answer from what you did.";
    return { creativesUploaded: none, launchedPaused: none };
  }
  const work = changes.filter(isWork);
  const created = work.filter(c => /^ad created$/i.test(c.eventType)).length;
  const switched = work.filter(c => /status updated/i.test(c.eventType)).length;
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  return {
    creativesUploaded: created
      ? `Meta's log today: ${plural(created, "ad created", "ads created")}.`
      : "Meta's log shows no new ad today.",
    launchedPaused:
      created || switched
        ? `Meta's log today: ${[
            created ? plural(created, "ad created", "ads created") : "",
            switched ? plural(switched, "status change", "status changes") : "",
          ]
            .filter(Boolean)
            .join(", ")}.`
        : "Meta's log shows no launch or pause today.",
  };
}
