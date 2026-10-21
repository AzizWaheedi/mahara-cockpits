// A closer links one of their sales calls to a lead by hand (Muhammed,
// 2026-10-21): rule 1 of hermes/sales-desk/desk/recordings.py, written as
// matched_by "hand", which the desk never changes. محسن's demo (20 Oct) was
// held in a room opened an hour after the booking, so no rule placed it, and
// the proposal writer found no call to draft from.
//
// Only a video call of the last LINK_DAYS days that no lead has yet. A phone
// call, or one hidden from sales (internal, client service, a second copy), is
// never linked: a wrong link would draft one prospect's proposal from
// another's call. A closer links only the calls they recorded; a manager links
// anyone's.

import { cleanText, type Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";

type Row = Record<string, unknown>;

export interface CallLinksDeps {
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
  now?: () => number;
}

/** How far back a call can be linked from the lead's page. */
export const LINK_DAYS = 3;
/** A booking this close to the call is the call's, so its kind (intro or demo) is known. */
const BOOKING_WITHIN_MS = 3 * 3600_000;
const enc = encodeURIComponent;

export function isPhone(r: Row): boolean {
  return r.source === "maqsam" || r.kind === "phone" || String(r.recording_id ?? "").startsWith("maqsam:");
}

export function makeCallLinks(d: CallLinksDeps): {
  actions: Record<string, (who: Who, b: Row) => Promise<Row>>;
} {
  const now = d.now ?? (() => Date.now());

  async function link(who: Who, b: Row): Promise<Row> {
    if (!who.manager && !["closer", "both"].includes(String(who.role)))
      throw new ApiRefusal("Calls are linked by closers and managers.", 403);
    const id = cleanText(b.recording_id, 40);
    const contact = cleanText(b.contact_id, 80);
    if (!id) throw new ApiRefusal("Which call?");
    if (!contact) throw new ApiRefusal("Which lead?");
    await d.cockpitLead(contact);
    const rec = (
      await d.svc(
        `cockpit_sales_recordings?recording_id=eq.${enc(id)}&select=recording_id,title,started_at,recorded_by,contact_id,appointment_id,matched_by,source,kind,hidden_reason`,
      )
    )[0];
    if (!rec) throw new ApiRefusal("That call is not in the cockpit.", 404);
    if (isPhone(rec)) throw new ApiRefusal("That is a phone call. Link the demo's video call.");
    if (rec.hidden_reason)
      throw new ApiRefusal("That call is hidden from sales (a team meeting, a client call or a second copy). Pick another.");
    if (rec.contact_id)
      throw new ApiRefusal(
        rec.contact_id === contact
          ? "That call is already this lead's."
          : "That call is already another lead's. Ask a manager to move it.",
        409,
      );
    const started = Date.parse(String(rec.started_at ?? ""));
    if (!Number.isFinite(started) || now() - started > LINK_DAYS * 86_400_000)
      throw new ApiRefusal(`Only calls from the last ${LINK_DAYS} days can be linked here. Ask a manager.`);
    const mine = [who.fathom_email, who.email].filter(Boolean).map(e => String(e).toLowerCase());
    if (!who.manager && !mine.includes(String(rec.recorded_by ?? "").toLowerCase()))
      throw new ApiRefusal("You can link only calls you recorded. Ask a manager to link this one.", 403);

    const lo = new Date(started - BOOKING_WITHIN_MS).toISOString();
    const hi = new Date(started + BOOKING_WITHIN_MS).toISOString();
    const bookings = await d.svc(
      `cockpit_sales_appointments?contact_id=eq.${enc(contact)}&call_type=in.(intro,demo)` +
        `&start_at=gte.${enc(lo)}&start_at=lte.${enc(hi)}&select=appointment_id,start_at`,
    );
    const gap = (r: Row) => Math.abs(Date.parse(String(r.start_at)) - started);
    const booking = [...bookings].sort((a, b) => gap(a) - gap(b))[0];
    const patch: Row = {
      contact_id: contact,
      appointment_id: booking ? String(booking.appointment_id) : null,
      matched_by: "hand",
    };
    // Only while no lead has it, so two people linking at once cannot both win.
    const out = await d.svc(`cockpit_sales_recordings?recording_id=eq.${enc(id)}&contact_id=is.null`, {
      method: "PATCH",
      body: patch,
      prefer: "return=representation",
    });
    if (!out.length) throw new ApiRefusal("Someone linked that call a moment ago. Reload the page.", 409);
    await d.audit(
      who,
      "recording.link",
      "cockpit_sales_recordings",
      id,
      { contact_id: null, appointment_id: rec.appointment_id ?? null, matched_by: rec.matched_by ?? null },
      patch,
      { title: rec.title ?? null, recorded_by: rec.recorded_by ?? null },
    );
    return { recording: out[0] };
  }

  return { actions: { "recording.link": link } };
}
