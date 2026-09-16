import { useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { useMemo } from "react";
import { api } from "../../../convex/_generated/api";
import type { TeamPerson, TeamStatus } from "../../../convex/ceo/payloads";

/**
 * The team switch's live layer (2026-09-16), shared by every tab that counts
 * EODs (Management and Today), so a person set to Paused or Left leaves the
 * counts on both the moment the change is saved, not only after the team
 * section is recomputed.
 */

export type LiveStatus = FunctionReturnType<
  typeof api.ceo.teamStatus.list
>[number];

/** A missing status reads as active (payloads stored before the switch). */
export const statusOf = (p: TeamPerson): TeamStatus => p.status ?? "active";

/** The sentence a refusal carries, never a stack trace. */
export function saveError(
  e: unknown,
  fallback = "The server did not accept the change.",
): string {
  if (e instanceof ConvexError) return String(e.data);
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const m = /Uncaught (?:ConvexError|Error): ([^\n]+)/.exec(msg);
  if (m) return m[1].trim();
  if (/network|fetch|connection|websocket/i.test(msg))
    return "The connection dropped before the change was saved.";
  return fallback;
}

/**
 * The live status rows. Read without throwing, so a missing or failing
 * query switches the control off instead of breaking the tab.
 */
export function useLiveStatuses(): {
  rows: LiveStatus[] | null;
  error: string | null;
} {
  const queries = useMemo(
    () => ({ list: { query: api.ceo.teamStatus.list, args: {} } }),
    [],
  );
  const res = useQueries(queries).list as LiveStatus[] | Error | undefined;
  if (res instanceof Error)
    return { rows: null, error: saveError(res, "The query failed.") };
  return { rows: res ?? null, error: null };
}

export type Roster = {
  /** Active today: every EOD count reads only these. */
  active: TeamPerson[];
  /** Paused and left, paused first, then the newest start first. */
  inactive: TeamPerson[];
  /** People whose status changed after the stored numbers were computed. */
  updating: Set<string>;
  /** Who set each status, a name. */
  setBy: Map<string, string>;
};

function byInactiveOrder(a: TeamPerson, b: TeamPerson): number {
  const rank = (p: TeamPerson) => (statusOf(p) === "paused" ? 0 : 1);
  return (
    rank(a) - rank(b) ||
    (b.statusSince ?? "").localeCompare(a.statusSince ?? "") ||
    a.name.localeCompare(b.name)
  );
}

/**
 * The stored people with the live statuses laid over them, so a switch shows
 * the moment it is saved. A person whose live status differs from the stored
 * one is placed by the live status and marked updating until the team section
 * is recomputed; everyone else stays where the backend put them. The backend
 * applies the same rule (off from `since` on), so the counts built from
 * `active` match what the refresh will show.
 */
export function buildRoster(
  people: TeamPerson[],
  inactive: TeamPerson[],
  live: LiveStatus[] | null,
  today: string,
): Roster {
  const updating = new Set<string>();
  const setBy = new Map<string, string>();
  if (!live) return { active: people, inactive, updating, setBy };
  const byKey = new Map(live.map(r => [r.personKey, r]));
  for (const r of live) setBy.set(r.personKey, r.setBy);

  const active: TeamPerson[] = [];
  const off: TeamPerson[] = [];
  const place = (p: TeamPerson, storedApart: boolean) => {
    const r = byKey.get(p.key);
    const status = r?.status ?? "active";
    const since = r?.since ?? null;
    const setAt = r?.setAt ?? null;
    const same =
      statusOf(p) === status &&
      (p.statusSince ?? null) === since &&
      (p.statusSetAt ?? null) === setAt;
    if (same) {
      (storedApart ? off : active).push(p);
      return;
    }
    updating.add(p.key);
    const next: TeamPerson = {
      ...p,
      status,
      statusSince: since,
      statusNote: r?.note ?? null,
      statusSetAt: setAt,
    };
    // A status dated ahead leaves today as it was: a paused person given a
    // leaving date ahead is still off today, and an active person with a
    // pause ahead still owes EODs. The one exception is moving the start of
    // the status already in force to a later day, which is a correction:
    // the days before the new start are due again (the backend replays it
    // the same way), so the person is back on the active list until then.
    const movedAhead =
      storedApart &&
      statusOf(p) === status &&
      p.statusSince != null &&
      p.statusSince <= today;
    const offToday =
      since !== null && since > today
        ? storedApart && !movedAhead
        : status !== "active" && since !== null;
    (offToday ? off : active).push(next);
  };
  for (const p of people) place(p, false);
  for (const p of inactive) place(p, true);
  return { active, inactive: off.sort(byInactiveOrder), updating, setBy };
}
