import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * One client profile per client, the way every screen reads them.
 *
 * The media buyer's push writes its batches before it deletes the previous
 * set (csmSync.commitProfiles), so for the minute a push takes, every ten
 * minutes, and until the next run after a push that failed halfway, each
 * client has an old row and a new one. A client with two ClickUp cards under
 * one name (North Gulf Systems) has two rows for good. Until 2026-09-27 a
 * dev deployment pushed as well. Aziz, 2026-09-27: "a lot of duplicate
 * clients in the client performance section. Make sure it doesn't happen."
 *
 * The newest push wins. Within one push, the card with a report sheet wins,
 * then the later write.
 */

type Profile = Doc<"clientProfiles">;

/** "North Gulf Systems " and "north gulf  systems" are one client. */
export function clientKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** When the push that wrote this row started: syncId is `${day}-${ms}`. */
function pushedAt(p: Profile): number {
  const ms = Number(
    String(p.syncId ?? "")
      .split("-")
      .pop(),
  );
  return Number.isFinite(ms) && ms > 0 ? ms : (p.syncedAt ?? 0);
}

const hasSheet = (p: Profile) =>
  Boolean((p.links as Record<string, string> | undefined)?.sheet);

/** Whether `a` should be shown instead of `b` for the same client. */
function better(a: Profile, b: Profile): boolean {
  const pa = pushedAt(a);
  const pb = pushedAt(b);
  if (pa !== pb) return pa > pb;
  if (hasSheet(a) !== hasSheet(b)) return hasSheet(a);
  return a._creationTime > b._creationTime;
}

export function onePerClient<T extends Profile>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const key = clientKey(r.clientName);
    const held = best.get(key);
    if (!held || better(r, held)) best.set(key, r);
  }
  return [...best.values()];
}

/** Every client's profile, one each. */
export async function currentProfiles(ctx: QueryCtx): Promise<Profile[]> {
  return onePerClient(await ctx.db.query("clientProfiles").collect());
}

/** One client's profile: the row the overview shows for them. */
export async function currentProfile(
  ctx: QueryCtx,
  clientName: string,
): Promise<Profile | null> {
  const rows = await ctx.db
    .query("clientProfiles")
    .withIndex("by_client", q => q.eq("clientName", clientName))
    .collect();
  return onePerClient(rows)[0] ?? null;
}
