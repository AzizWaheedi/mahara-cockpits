/**
 * Contacts tagged "client" in HighLevel are Mahara's active clients (Aziz,
 * 2026-09-27: "They shouldn't be in any sales process"). The server keeps
 * them out of the dialer's queue, the pipeline board, the hot list and the
 * follow-ups (sales-api clients.ts); here a client still opens, labelled.
 */
export function isClient(
  lead: { tags?: readonly string[] | null } | null | undefined,
): boolean {
  const tags = lead?.tags;
  return (
    Array.isArray(tags) &&
    tags.some(t => String(t).trim().toLowerCase() === "client")
  );
}

/** What the label says when it is pointed at. */
export const CLIENT_NOTE =
  "Tagged client in HighLevel: an active client. Client success looks after them, so they stay out of the dialer, the follow-ups and the hot list.";
