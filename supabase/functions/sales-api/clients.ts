// Mahara's active clients. Two marks make a contact one (2026-10-11): the
// client tag in HighLevel (Aziz, 2026-09-27: "if they have a client tag, it
// means they are an active client ... They shouldn't be in any sales
// process"), or a signed deal from the New Client Form that B2B has not
// voided. Either one keeps them out of the dialer's queue, the follow-ups,
// the hot list, the WhatsApp group kit, the Zoom link and the video rooms.
//
// The pipeline keeps them (the CEO, 2026-10-11: signing a client must not
// remove it from the sales tool, it goes to Closed): the board places them
// in their pipeline's Closed column with the signed date, the value and who
// closed it, and refuses to move them (board.ts). A person who opens one
// still sees them, with the reason said, and can reach them by hand.
//
// 20 of 53 deals had no contact id on 2026-10-11; those clients are known
// here only by the tag.
//
// Kept apart from index.ts so bun can test it (bun test supabase/functions).

type Row = Record<string, unknown>;

/** Tagged client in HighLevel, as the lead copy holds its tags. */
export function isClient(lead: Row | null | undefined): boolean {
  const tags = lead?.tags;
  return Array.isArray(tags) && tags.some(t => String(t).trim().toLowerCase() === "client");
}

/** Why a sales action on an active client is refused (the client tag). */
export const CLIENT_REFUSAL =
  "This is an active client (tagged client in HighLevel), so it stays out of the sales lists and follow-ups. Client success looks after them.";

/** Why a sales action on a signed client without the tag is refused (a deal). */
export const SIGNED_REFUSAL =
  "This is an active client (signed on the New Client Form), so it stays out of the sales lists and follow-ups. Client success looks after them.";

/** Why an open follow-up draft for an active client was closed (the client tag). */
export const CLIENT_DRAFT_CLOSED =
  "An active client (tagged client in HighLevel): kept out of sales follow-ups.";

/** Why an open follow-up draft for a signed client without the tag was closed (a deal). */
export const SIGNED_DRAFT_CLOSED =
  "An active client (signed on the New Client Form): kept out of sales follow-ups.";

/** What the cockpit knows about a contact being a client. */
export interface ClientFacts {
  /** Tagged client, or a deal that is not voided. */
  client: boolean;
  /** The tag first (HighLevel's own word), else the deal; null when not a client. */
  why: "tag" | "deal" | null;
  /** The newest live deal's submitted_at, or null (no deal, or a tag only). */
  signed_at: string | null;
  /** That deal's closer and setter, as the form names them. */
  closer: string | null;
  setter: string | null;
  /** That deal's contracted_revenue, or null when the form left it out. */
  value: number | null;
}

/** The deal columns clientFacts reads. */
export const DEAL_COLS = "contact_id,submitted_at,closer,setter,contracted_revenue,voided";

const NOT_A_CLIENT: ClientFacts = {
  client: false,
  why: null,
  signed_at: null,
  closer: null,
  setter: null,
  value: null,
};

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

const amount = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const when = (v: unknown): number => {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/**
 * The facts for one lead from its tags and its deals. `deals` are the lead's
 * rows of cockpit_sales_deals (DEAL_COLS); a voided deal never counts, and a
 * deal that names another contact is not this lead's. The newest live deal
 * gives the date, the value and who closed it.
 */
export function clientFacts(lead: Row | null | undefined, deals: readonly Row[] | null | undefined): ClientFacts {
  const id = lead?.contact_id === null || lead?.contact_id === undefined ? null : String(lead.contact_id);
  const live = (deals ?? []).filter(
    d => d && d.voided !== true && !(id && d.contact_id && String(d.contact_id) !== id),
  );
  const tagged = isClient(lead);
  if (!tagged && !live.length) return { ...NOT_A_CLIENT };
  const newest = [...live].sort((a, b) => when(b.submitted_at) - when(a.submitted_at))[0];
  const at = newest ? when(newest.submitted_at) : Number.NEGATIVE_INFINITY;
  return {
    client: true,
    why: tagged ? "tag" : "deal",
    signed_at: newest && Number.isFinite(at) ? new Date(at).toISOString() : null,
    closer: newest ? text(newest.closer) : null,
    setter: newest ? text(newest.setter) : null,
    value: newest ? amount(newest.contracted_revenue) : null,
  };
}

/**
 * The facts for one contact, read from the cockpit copy: its tags (unless
 * the caller already holds the lead row) and its live deals. A failed read
 * throws, so a gate never takes "could not read" for "not a client".
 */
export async function readClient(
  svc: (path: string) => Promise<Row[]>,
  contactId: string,
  lead?: Row | null,
): Promise<ClientFacts> {
  const id = encodeURIComponent(contactId);
  const [row, deals] = await Promise.all([
    lead !== undefined
      ? Promise.resolve(lead)
      : svc(`cockpit_sales_leads?contact_id=eq.${id}&select=contact_id,tags`).then(r => r[0] ?? null),
    svc(`cockpit_sales_deals?contact_id=eq.${id}&voided=eq.false&select=${DEAL_COLS}&order=submitted_at.desc&limit=20`),
  ]);
  return clientFacts(row ? { ...row, contact_id: row.contact_id ?? contactId } : { contact_id: contactId }, deals);
}

/**
 * The mark a caller puts on a contact read from HighLevel when the cockpit
 * holds a live deal for it: HighLevel's contact carries the tag but not the
 * deal, and the video rooms' rules (roomlogic.ts) are pure, so they read the
 * deal from this mark (markSigned) instead of the database.
 */
export const SIGNED_MARK = "cockpit_signed";

/** Tagged client, or marked signed by a deal (markSigned). */
export function isActiveClient(row: Row | null | undefined): boolean {
  return isClient(row) || row?.[SIGNED_MARK] === true;
}

/** The contact with the signed mark, when the facts say a deal makes it a client. */
export function markSigned<T extends Row>(contact: T, facts: Pick<ClientFacts, "client" | "signed_at" | "why">): T {
  const byDeal = facts.client && (facts.why === "deal" || facts.signed_at !== null);
  return byDeal ? { ...contact, [SIGNED_MARK]: true } : contact;
}

/** The refusal for a client, in the words of why they are one. */
export function clientRefusal(f: Pick<ClientFacts, "why">): string {
  return f.why === "deal" ? SIGNED_REFUSAL : CLIENT_REFUSAL;
}

/** Why a follow-up draft for a client was closed, in the words of why they are one. */
export function clientDraftClosed(f: Pick<ClientFacts, "why">): string {
  return f.why === "deal" ? SIGNED_DRAFT_CLOSED : CLIENT_DRAFT_CLOSED;
}
