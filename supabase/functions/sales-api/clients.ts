// Contacts tagged "client" in HighLevel are Mahara's active clients (Aziz,
// 2026-09-27: "if they have a client tag, it means they are an active
// client ... They shouldn't be in any sales process"). The dialer's queue,
// the pipeline board, the hot list and the follow-ups leave them out. A
// person who opens one still sees them, with the tag said, and can reach
// them by hand.
//
// Kept apart from index.ts so bun can test it (bun test supabase/functions).

type Row = Record<string, unknown>;

/** Tagged client in HighLevel, as the lead copy holds its tags. */
export function isClient(lead: Row | null | undefined): boolean {
  const tags = lead?.tags;
  return Array.isArray(tags) && tags.some(t => String(t).trim().toLowerCase() === "client");
}

/** Why a sales action on an active client is refused. */
export const CLIENT_REFUSAL =
  "This is an active client (tagged client in HighLevel), so it stays out of the sales lists and follow-ups. Client success looks after them.";

/** Why an open follow-up draft for an active client was closed. */
export const CLIENT_DRAFT_CLOSED =
  "An active client (tagged client in HighLevel): kept out of sales follow-ups.";
