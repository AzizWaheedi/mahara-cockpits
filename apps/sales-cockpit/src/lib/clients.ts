/**
 * Mahara's active clients (Aziz, 2026-09-27: "They shouldn't be in any sales
 * process"). Two marks make a contact one: the client tag in HighLevel, or a
 * signed deal from the New Client Form that is not voided (2026-10-11). The
 * server keeps them out of the dialer's queue, the follow-ups, the hot list,
 * the group kit, the Zoom link and the video rooms (sales-api clients.ts),
 * and the pipeline keeps them in its Closed column (the CEO, 2026-10-11).
 * Here a client still opens, labelled.
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

/**
 * Tagged client, or a deal of this lead that is not voided: the lead page's
 * rule for "an active client", the same as the server's. `deals` are the
 * lead's own (useLeadActivity's), and one that names another contact is not
 * counted.
 */
export function isSignedClient(
  lead:
    | { contact_id?: string | null; tags?: readonly string[] | null }
    | null
    | undefined,
  deals:
    | readonly { contact_id?: string | null; voided?: boolean | null }[]
    | null
    | undefined,
): boolean {
  if (isClient(lead)) return true;
  const id = lead?.contact_id ?? null;
  return (deals ?? []).some(
    d =>
      Boolean(d) &&
      d.voided !== true &&
      !(id && d.contact_id && d.contact_id !== id),
  );
}

/** What the label says when it is pointed at. */
export const CLIENT_NOTE =
  "An active client. They sit in Closed on the pipeline and stay out of the dialer, the follow-ups and the hot list. Client success looks after them.";
