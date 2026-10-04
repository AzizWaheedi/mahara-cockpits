// Pure rules for replyDrafts.ts, kept free of Convex imports so they can be unit tested.

/**
 * Whether a waiting thread already has what it needs. A draft Hermes declined
 * ("declined": a family chat, a promo, a voice note with no transcript) is
 * final for that message, exactly like "done": asking again every 30 minutes
 * only fails again. That loop was ~100 failed Ask AI jobs a day (4 Oct 2026).
 * A new client message has a new lastAt, so it is always drafted.
 */
export function shouldSkipDraft(
  existing: { lastAt: number; status: string; at: number } | null | undefined,
  lastAt: number,
  now: number,
): boolean {
  if (!existing || existing.lastAt !== Number(lastAt)) return false;
  if (existing.status === "done" || existing.status === "declined") return true;
  return now - existing.at < 30 * 60_000;
}
