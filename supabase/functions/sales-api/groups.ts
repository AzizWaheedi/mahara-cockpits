// The WhatsApp group for a booked demo (2026-10-10). The setter makes the
// group from her own phone (the CEO, 2026-10-02: "for whatsapp groups
// personal phone should be fine of the setter"); the cockpit helps with the
// words and keeps a record. It never posts anything anywhere.
//
// group.made saves one row per lead (made again, the row is updated), an
// audit row, and a HighLevel note that says the group was made, without the
// invite link. A HighLevel failure is kept on the row (crm_note) and the
// save still stands. No switch: nothing goes to anyone.

import { cleanText, redact, type Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { CLIENT_REFUSAL, isClient } from "./clients.ts";
import { kuwaitWords } from "./dialer.ts";

type Row = Record<string, unknown>;

export interface GroupsDeps {
  svc: (path: string, init?: { method?: string; body?: unknown; prefer?: string }) => Promise<Row[]>;
  audit: (
    who: Who,
    action: string,
    entityType: string,
    entityId: string | null,
    before: unknown,
    after: unknown,
    metadata?: Row,
  ) => Promise<void>;
  ghl: (method: string, path: string, body?: unknown, version?: string) => Promise<Row>;
  now?: () => number;
}

const GROUPS = "cockpit_sales_groups";
const enc = encodeURIComponent;
/** The table's own check (20261010s): the invite link WhatsApp's "Invite via link" copies. */
export const INVITE_RE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,64}$/;
export const BAD_INVITE = "Paste the group's invite link: it starts with https://chat.whatsapp.com/";

/**
 * The invite link as the table keeps it. WhatsApp's "Copy link" can add a
 * tracking query (?mode=...) or come without the scheme; both are the same
 * invite. Null for nothing pasted, undefined for something that is not an
 * invite link.
 */
export function cleanInvite(v: unknown): string | null | undefined {
  let s = String(v ?? "").trim();
  if (!s) return null;
  if (/^chat\.whatsapp\.com\//i.test(s)) s = `https://${s}`;
  s = s.replace(/^http:\/\//i, "https://").replace(/[?#].*$/, "").replace(/\/+$/, "");
  s = s.replace(/^https:\/\/chat\.whatsapp\.com\//i, "https://chat.whatsapp.com/");
  return INVITE_RE.test(s) ? s : undefined;
}

/** The HighLevel note: who made the group and when, never the link. */
export function groupNote(by: string, atMs: number): string {
  return `WhatsApp group made by ${by} on ${kuwaitWords(atMs)} (Kuwait time).`;
}

export function makeGroups(d: GroupsDeps) {
  const now = d.now ?? (() => Date.now());

  async function groupMade(who: Who, b: Row): Promise<Row> {
    const contactId = cleanText(b.contact_id, 80);
    if (!contactId) throw new ApiRefusal("Which lead?", 400);
    let lead: Row | undefined;
    try {
      lead = (await d.svc(`cockpit_sales_leads?contact_id=eq.${enc(contactId)}&select=contact_id,name,company,phone,tags`))[0];
    } catch {
      throw new ApiRefusal("The cockpit could not read the lead. Try again in a minute.", 503);
    }
    if (!lead) throw new ApiRefusal("That lead is not in the cockpit.", 404);
    if (isClient(lead)) throw new ApiRefusal(CLIENT_REFUSAL, 409, { code: "client" });
    const invite = cleanInvite(b.invite_link);
    if (invite === undefined) throw new ApiRefusal(BAD_INVITE, 400, { code: "bad_invite" });
    const name = cleanText(b.name, 100) || null;
    const appointmentId = cleanText(b.appointment_id, 80) || null;

    const before = (await d.svc(`${GROUPS}?contact_id=eq.${enc(contactId)}&select=*`))[0] ?? null;
    const at = new Date(now()).toISOString();
    // made_by stays the setter who made it (made_at is the insert's), so
    // "Group made at 14:10 by Tahreer" is still true after another press.
    const body: Row = { contact_id: contactId, made_by: String(before?.made_by ?? who.email ?? ""), updated_at: at };
    // A press without a link or a name never wipes the ones already kept.
    if (invite) body.invite_link = invite;
    if (name) body.name = name;
    if (appointmentId) body.appointment_id = appointmentId;
    const saved = (
      await d.svc(`${GROUPS}?on_conflict=contact_id`, {
        method: "POST",
        body,
        prefer: "resolution=merge-duplicates,return=representation",
      })
    )[0];
    if (!saved) throw new ApiRefusal("The group was not saved. Try again.", 503);
    await d.audit(who, "group.made", GROUPS, String(saved.id ?? contactId), before, {
      id: saved.id,
      name: saved.name ?? null,
      has_invite: Boolean(saved.invite_link),
      appointment_id: saved.appointment_id ?? null,
    }, { contact_id: contactId });

    // The HighLevel note, once: a second press (the invite sent again) adds none.
    let group = saved;
    if (before?.crm_note !== "written") {
      let crm: string;
      try {
        await d.ghl(
          "POST",
          `/contacts/${enc(contactId)}/notes`,
          {
            body: groupNote(String(who.name ?? who.email ?? "the setter"), now()),
            ...(who.ghl_user_id ? { userId: who.ghl_user_id } : {}),
          },
          "2021-07-28",
        );
        crm = "written";
      } catch (e) {
        crm = `failed: ${redact(String((e as Error)?.message ?? e)).slice(0, 200)}`;
      }
      try {
        const back = (
          await d.svc(`${GROUPS}?id=eq.${enc(String(saved.id))}`, {
            method: "PATCH",
            body: { crm_note: crm },
            prefer: "return=representation",
          })
        )[0];
        group = back ?? { ...saved, crm_note: crm };
      } catch (e) {
        console.error("group crm_note", redact(String((e as Error)?.message ?? e)));
        group = { ...saved, crm_note: crm };
      }
    }
    return { group };
  }

  return {
    actions: { "group.made": groupMade } as Record<string, (who: Who, b: Row) => Promise<Row>>,
  };
}
