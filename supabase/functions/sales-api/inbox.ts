// Messages page actions (Aziz, 2026-10-29: "a messages section for every
// single person"): who a conversation is with, and marking it read.
//
// inbox.assign: the lead's owner in HighLevel (the contact's assignedTo, the
//   same field setOwner writes when an intro or demo is booked). A manager
//   moves anyone's lead; a rep takes an unassigned lead or lets go of their
//   own. Read live from HighLevel first, so a lead someone else just took is
//   never taken from them by a stale screen.
// inbox.seen: HighLevel's unread count to 0, the way opening a conversation
//   in HighLevel does; only when there was something unread.
// Each change leaves an audit row.

import { cleanText, type Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";

type Row = Record<string, unknown>;

export interface InboxDeps {
  svc: (path: string, init?: { method?: string; body?: unknown; prefer?: string }) => Promise<Row[]>;
  ghl: (method: string, path: string, body?: unknown, version?: string) => Promise<Row>;
  audit: (
    who: Who,
    action: string,
    entityType: string,
    entityId: string | null,
    before: unknown,
    after: unknown,
    metadata?: Row,
  ) => Promise<void>;
}

const enc = encodeURIComponent;

/** May this seat move the lead from `from` to `to`? Null when yes, else the words why not. */
export function assignRefusal(who: Who, from: string | null, to: string | null): string | null {
  if (who.manager || who.ceo) return null;
  const me = who.ghl_user_id ?? null;
  if (!me) return "Your seat is not linked to a HighLevel user yet, so you cannot take leads. Ask a manager.";
  if (to === me && (from === null || from === me)) return null;
  if (to === null && from === me) return null;
  if (to !== null && to !== me) return "Only a manager can give a lead to someone else.";
  return "This lead is someone else's. Only a manager can move it.";
}

export function makeInbox(deps: InboxDeps) {
  const { svc, ghl, audit } = deps;

  async function assign(who: Who, b: Row): Promise<Row> {
    const contactId = cleanText(b.contact_id, 80);
    if (!contactId) throw new ApiRefusal("Which lead?");
    const to = b.user_id === null || b.user_id === "" ? null : cleanText(b.user_id, 80) || null;
    if (to) {
      const seat = await svc(
        `cockpit_sales_people?ghl_user_id=eq.${enc(to)}&active=is.true&select=name&limit=1`,
      );
      if (!seat.length) throw new ApiRefusal("That person has no active sales seat linked to HighLevel.");
    }
    const lead = (await svc(`cockpit_sales_leads?contact_id=eq.${enc(contactId)}&select=contact_id,name`))[0];
    if (!lead) throw new ApiRefusal("That lead is not in the cockpit yet. Try again in a few minutes.", 404);
    const live = ((await ghl("GET", `/contacts/${enc(contactId)}`, undefined, "2021-07-28")).contact ?? null) as Row | null;
    if (!live || typeof live !== "object") throw new Error("HighLevel answered the contact read without a contact");
    const from = live.assignedTo ? String(live.assignedTo) : null;
    if (from === to) return { contact_id: contactId, assigned_to: to, unchanged: true };
    const no = assignRefusal(who, from, to);
    if (no) throw new ApiRefusal(no, 403);
    await ghl("PUT", `/contacts/${enc(contactId)}`, { assignedTo: to }, "2021-07-28");
    const after = ((await ghl("GET", `/contacts/${enc(contactId)}`, undefined, "2021-07-28")).contact ?? {}) as Row;
    const now = after.assignedTo ? String(after.assignedTo) : null;
    if (now !== to) throw new ApiRefusal("HighLevel did not keep the change. Try again.", 502);
    await svc(`cockpit_sales_leads?contact_id=eq.${enc(contactId)}`, {
      method: "PATCH",
      body: { assigned_to: to },
      prefer: "return=minimal",
    });
    await svc(`cockpit_sales_conversations?contact_id=eq.${enc(contactId)}`, {
      method: "PATCH",
      body: { assigned_to: to },
      prefer: "return=minimal",
    });
    await audit(who, "inbox.assign", "cockpit_sales_leads", contactId, { assigned_to: from }, { assigned_to: to }, {
      lead: lead.name ?? null,
    });
    return { contact_id: contactId, assigned_to: to };
  }

  async function seen(who: Who, b: Row): Promise<Row> {
    const id = cleanText(b.conversation_id, 80);
    if (!id) throw new ApiRefusal("Which conversation?");
    const row = (await svc(
      `cockpit_sales_conversations?conversation_id=eq.${enc(id)}&select=conversation_id,contact_id,unread`,
    ))[0];
    if (!row) throw new ApiRefusal("That conversation is not in the cockpit.", 404);
    if (!Number(row.unread)) return { conversation_id: id, unread: 0, unchanged: true };
    await ghl("PUT", `/conversations/${enc(id)}`, { unreadCount: 0 }, "2021-04-15");
    await svc(`cockpit_sales_conversations?conversation_id=eq.${enc(id)}`, {
      method: "PATCH",
      body: { unread: 0 },
      prefer: "return=minimal",
    });
    await audit(who, "inbox.seen", "cockpit_sales_conversations", id, { unread: row.unread }, { unread: 0 }, {
      contact_id: row.contact_id,
    });
    return { conversation_id: id, unread: 0 };
  }

  return {
    actions: {
      "inbox.assign": assign,
      "inbox.seen": seen,
    } as Record<string, (who: Who, b: Row) => Promise<Row>>,
  };
}
