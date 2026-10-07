// Pure roster rules from client-success csmSync; no Convex server runtime.
/**
 * States that mean "this client is paying us this month". Anything else is not counted
 * in the churn denominator. Stopped/Cancelled/Paused are the exits.
 */
const LOST_MARKERS = ["stop", "cancel", "churn", "lost", "offboard"];
/** A pause turns into churn at this many days. Company rule, 2026-09-03. */
export const PAUSE_IS_CHURN_DAYS = 14;

const PAUSE_MARKERS = ["pause", "freeze", "hold"];

export function payingState(status: string): boolean {
  const s = (status || "").toLowerCase();
  if (LOST_MARKERS.some(m => s.includes(m))) return false;
  if (PAUSE_MARKERS.some(m => s.includes(m))) return false;
  return s.trim().length > 0;
}

export function stateOf(status: string): "paying" | "paused" | "lost" {
  const s = (status || "").toLowerCase();
  if (LOST_MARKERS.some(m => s.includes(m))) return "lost";
  if (PAUSE_MARKERS.some(m => s.includes(m))) return "paused";
  return "paying";
}

export type RosterRow = {
  key: string;
  name: string;
  status: string;
  paying: boolean;
};

export type RosterEvent = {
  key: string;
  name: string;
  from: string;
  to: string;
  kind: string;
};

/**
 * What changed between two rosters. Pure, so the rule can be checked without a
 * database: see scripts/roster-diff.test.ts.
 *
 * A client that appears is new, one that vanishes from the board is removed
 * (and counts as lost if it was paying), and one whose paying state changed is
 * lost, regained or paused. A status edit that does not cross a paying
 * boundary is not an event: moving between two onboarding stages is work in
 * progress, not a churn signal.
 */
export function rosterDiff(
  before: RosterRow[],
  now: RosterRow[],
): RosterEvent[] {
  const was = new Map(before.map(r => [r.key, r]));
  const out: RosterEvent[] = [];
  for (const row of now) {
    const prev = was.get(row.key);
    if (!prev) {
      out.push({
        key: row.key,
        name: row.name,
        from: "-",
        to: row.status,
        kind: row.paying ? "new" : "new_inactive",
      });
      continue;
    }
    const a = stateOf(prev.status);
    const b = stateOf(row.status);
    if (a === b) continue;
    out.push({
      key: row.key,
      name: row.name,
      from: prev.status,
      to: row.status,
      kind: b === "paying" ? "regained" : b === "lost" ? "lost" : "paused",
    });
  }
  for (const [key, prev] of was) {
    if (now.some(r => r.key === key)) continue;
    out.push({
      key,
      name: prev.name,
      from: prev.status,
      to: "removed from the board",
      kind: prev.paying ? "lost" : "removed",
    });
  }
  return out;
}

/** A derived event's identity, used to reconcile today's rows against the diff. */
export const rosterEventId = (e: {
  key: string;
  from: string;
  to: string;
  kind: string;
}) => `${e.key}|${e.from}|${e.to}|${e.kind}`;

/**
 * The event kinds this diff owns. The end-of-day form writes its own kinds
 * (offboarded, extension, paused_by_csm) into the same table, and reconciling
 * must never touch those: they are a person's report, not a derived row.
 */
export const ROSTER_KINDS: Record<string, true> = {
  new: true, new_inactive: true, regained: true, lost: true, paused: true, removed: true,
};
