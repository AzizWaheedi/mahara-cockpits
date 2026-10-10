// The call's notes as the rep types them (sales simplify, 2026-10-10): the
// script screen saves while the call goes, a few seconds after typing stops,
// into one cockpit_sales_notes row per call. The call is named by an id the
// rep's device makes (call_id), so a save sent again, or sent twice at once,
// lands on the same row and never makes a second one. note.add stays as it
// is: it is insert-only and other screens use it.
//
// Also the demo calendar's public booking page (book.slots' booking_url), so
// the setter can send it when a time cannot be booked on the call.

import { cleanText, type Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";

type Row = Record<string, unknown>;

export interface ScriptNotesDeps {
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
  cockpitLead: (contactId: string) => Promise<Row>;
}

/** The most a save may carry: the note's text, its fields, and one part's notes. */
export const SCRIPT_NOTE_LIMITS = { body: 20_000, fields: 30_000, part: 4_000 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOO_LONG = "These notes are too long to save. Shorten the longest part's notes.";
const enc = encodeURIComponent;

/** How many answers and parts' notes a save carries, for its audit row. */
function counts(fields: Row): { filled: number; notes_parts: number } {
  const values = fields.values && typeof fields.values === "object" ? (fields.values as Row) : {};
  const notes = fields.notes && typeof fields.notes === "object" ? (fields.notes as Row) : {};
  const some = (v: unknown) => typeof v === "string" && v.trim() !== "";
  return {
    filled: Object.values(values).filter(some).length,
    notes_parts: Object.values(notes).filter(some).length,
  };
}

export function makeScriptNotes(d: ScriptNotesDeps): {
  actions: Record<string, (who: Who, b: Row) => Promise<Row>>;
} {
  async function save(who: Who, b: Row): Promise<Row> {
    const contact = cleanText(b.contact_id, 80);
    if (!contact) throw new ApiRefusal("Which lead?");
    const callId = cleanText(b.call_id, 40).toLowerCase();
    if (!UUID.test(callId)) throw new ApiRefusal("This call has no id. Open the script again.");
    const script = b.script === "demo" ? "demo" : b.script === "intro" ? "intro" : null;
    if (!script) throw new ApiRefusal("Which script, the intro or the demo?");
    const rawBody = String(b.body ?? "").replace(/\u0000/g, "");
    if (rawBody.length > SCRIPT_NOTE_LIMITS.body) throw new ApiRefusal(TOO_LONG);
    const body = rawBody.trim();
    if (!body) throw new ApiRefusal("Write something before saving the call's notes.");
    const given = b.fields;
    if (given !== undefined && (given === null || typeof given !== "object" || Array.isArray(given)))
      throw new ApiRefusal("The call's answers could not be read. Open the script again.");
    const fields: Row = { ...((given as Row | undefined) ?? {}) };
    const notes = fields.notes;
    if (notes !== undefined && (notes === null || typeof notes !== "object" || Array.isArray(notes)))
      throw new ApiRefusal("The parts' notes could not be read. Open the script again.");
    for (const v of Object.values((notes as Row | undefined) ?? {}))
      if (typeof v === "string" && v.length > SCRIPT_NOTE_LIMITS.part) throw new ApiRefusal(TOO_LONG);
    // What the row says it is: never what a body claims against the call's own fields.
    fields.script = script;
    fields.lang = b.lang === "en" ? "en" : "ar";
    if (b.version !== undefined && b.version !== null) fields.version = b.version;
    fields.final = b.final === true || fields.final === true;
    if (JSON.stringify(fields).length > SCRIPT_NOTE_LIMITS.fields) throw new ApiRefusal(TOO_LONG);
    await d.cockpitLead(contact);
    const appointment = cleanText(b.appointment_id, 80) || null;
    const now = new Date().toISOString();

    const read = async () =>
      (
        await d.svc(
          `cockpit_sales_notes?contact_id=eq.${enc(contact)}&call_id=eq.${enc(callId)}&kind=eq.script&select=id,author,deleted_at,appointment_id&limit=1`,
        )
      )[0] ?? null;

    const update = async (row: Row): Promise<Row> => {
      if (row.deleted_at)
        throw new ApiRefusal("These call notes were deleted. Saving again starts them as a new call.", 409, {
          code: "deleted",
        });
      if (row.author !== who.email && !who.manager)
        throw new ApiRefusal("These are another rep's call notes. Start your own call to write yours.", 403);
      const patch: Row = { body, fields, updated_at: now };
      if (appointment) patch.appointment_id = appointment;
      const out = await d.svc(`cockpit_sales_notes?id=eq.${enc(String(row.id))}&kind=eq.script`, {
        method: "PATCH",
        body: patch,
        prefer: "return=representation",
      });
      return out[0] ?? { ...row, ...patch };
    };

    let row = await read();
    let saved: Row;
    let made = false;
    if (row) saved = await update(row);
    else {
      try {
        saved = (
          await d.svc("cockpit_sales_notes", {
            method: "POST",
            body: {
              contact_id: contact,
              appointment_id: appointment,
              kind: "script",
              call_id: callId,
              body,
              fields,
              author: who.email,
            },
            prefer: "return=representation",
          })
        )[0];
        made = true;
      } catch (e) {
        // Two saves of one call at once: the first made the row, this one updates it.
        if (!/23505|duplicate/i.test(String((e as Error)?.message ?? e))) throw e;
        row = await read();
        if (!row) throw e;
        saved = await update(row);
      }
    }
    const c = counts(fields);
    await d.audit(
      who,
      "script.save",
      "cockpit_sales_notes",
      String(saved?.id ?? ""),
      null,
      {
        id: saved?.id ?? null,
        stage_reached: fields.stage_reached ?? null,
        filled: c.filled,
        notes_parts: c.notes_parts,
        body_chars: body.length,
      },
      { call_id: callId, final: fields.final, made },
    );
    return { note: { id: saved?.id ?? null, updated_at: saved?.updated_at ?? now } };
  }

  return { actions: { "script.save": save } };
}

/**
 * The calendar's public booking page, for a lead to pick a time on their
 * own: HighLevel's widget by the calendar's slug when it has one, else by
 * its id. Nothing about the lead goes in it. None when the calendar is
 * switched off in HighLevel.
 */
export function bookingUrl(calendarId: string, cal: Row): string | null {
  if (!cal || cal.isActive === false) return null;
  const slug = typeof cal.widgetSlug === "string" ? cal.widgetSlug.trim() : "";
  if (/^[A-Za-z0-9_-]{1,120}$/.test(slug)) return `https://api.leadconnectorhq.com/widget/bookings/${slug}`;
  const id = String(calendarId ?? "").trim();
  if (/^[A-Za-z0-9_-]{1,80}$/.test(id)) return `https://api.leadconnectorhq.com/widget/booking/${id}`;
  return null;
}
