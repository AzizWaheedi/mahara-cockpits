// The hot list's rules, kept apart from index.ts so bun can test them
// (bun test supabase/functions/sales-api).
//
// Aziz, 2026-09-27: the hot list works like his sheet (Name, Lead Type,
// Status, Last objection, Amount, Last FU, Next FU, Notes), edited a cell at
// a time. So a save changes only the fields it names: a cell edit sends one,
// and two edits made one after the other never overwrite each other.

import { cleanText } from "./lib.ts";

type Row = Record<string, unknown>;

export const HOT_HEATS = ["red_hot", "hot", "warm"] as const;
export const HOT_STATUSES = ["nurturing", "closed", "lost"] as const;
export const HOT_HOWS = ["call", "whatsapp", "email", "meeting"] as const;
export const HOT_CURRENCIES = ["USD", "KWD", "SAR", "AED", "QAR", "BHD", "OMR"] as const;

const DAY = 86_400_000;
/** How far ahead a next follow-up may be planned: a year, so "after Ramadan" fits. */
export const NEXT_AHEAD_DAYS = 366;
/** How far back a follow-up may be marked by hand. */
export const LAST_BACK_DAYS = 366;
/** The largest deal value the list takes, in any of its currencies. */
export const AMOUNT_MAX = 10_000_000;

/** The body named the field (null and "" included: they clear it). */
const sent = (b: Row, k: string) => Object.hasOwn(b, k) && b[k] !== undefined;
const blank = (v: unknown) => v === null || (typeof v === "string" && v.trim() === "");
const oneOf = (list: readonly string[], v: unknown): v is string => typeof v === "string" && list.includes(v);

/**
 * What one save changes: only the fields the body names, each cleaned and
 * checked, or the sentence that says why it cannot be saved. A field sent as
 * null or "" is cleared where it may be blank. Fields the hot row does not
 * have are ignored.
 */
export function hotPatch(
  b: Row,
  now: number,
  who: { email: string; manager: boolean },
): { ok: true; patch: Row } | { ok: false; error: string } {
  const patch: Row = {};
  if (sent(b, "heat")) {
    if (!blank(b.heat) && !oneOf(HOT_HEATS, b.heat)) return { ok: false, error: "The type is red hot, hot or warm." };
    patch.heat = blank(b.heat) ? null : b.heat;
  }
  if (sent(b, "status")) {
    if (!oneOf(HOT_STATUSES, b.status)) return { ok: false, error: "The status is nurturing, closed or lost." };
    patch.status = b.status;
  }
  if (sent(b, "amount")) {
    if (blank(b.amount)) patch.amount = null;
    else {
      const n = typeof b.amount === "number" ? b.amount : Number(String(b.amount).replace(/[,\s]/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > AMOUNT_MAX)
        return { ok: false, error: "The amount is a number from 0 to 10,000,000." };
      patch.amount = Math.round(n * 100) / 100;
    }
  }
  if (sent(b, "amount_currency")) {
    const c = cleanText(b.amount_currency, 3).toUpperCase();
    if (!oneOf(HOT_CURRENCIES, c)) return { ok: false, error: "Amounts are in USD, KWD, SAR, AED, QAR, BHD or OMR." };
    patch.amount_currency = c;
  }
  if (sent(b, "last_objection")) patch.last_objection = cleanText(b.last_objection, 500) || null;
  if (sent(b, "note")) patch.note = cleanText(b.note, 4000) || null;
  if (sent(b, "next_at")) {
    if (blank(b.next_at)) patch.next_at = null;
    else {
      const t = Date.parse(String(b.next_at));
      if (!Number.isFinite(t) || t < now - DAY || t > now + NEXT_AHEAD_DAYS * DAY)
        return { ok: false, error: "Pick a next follow-up from yesterday up to a year ahead." };
      patch.next_at = new Date(t).toISOString();
    }
  }
  if (sent(b, "next_how")) {
    const how = cleanText(b.next_how, 10);
    if (how && !oneOf(HOT_HOWS, how)) return { ok: false, error: "Follow up by call, WhatsApp, email or a meeting." };
    patch.next_how = how || null;
  }
  if (sent(b, "last_fu_at")) {
    if (blank(b.last_fu_at)) patch.last_fu_at = null;
    else {
      const t = Date.parse(String(b.last_fu_at));
      if (!Number.isFinite(t)) return { ok: false, error: "Pick when you last followed up." };
      // A few minutes of grace for a phone whose clock runs ahead.
      if (t > now + 5 * 60_000) return { ok: false, error: "The last follow-up cannot be in the future." };
      if (t < now - LAST_BACK_DAYS * DAY) return { ok: false, error: "Pick a last follow-up within the past year." };
      patch.last_fu_at = new Date(t).toISOString();
    }
  }
  if (sent(b, "owner_email")) {
    const email = cleanText(b.owner_email, 200).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Give it to a seat, by its email address." };
    if (!who.manager && email !== who.email.toLowerCase())
      return { ok: false, error: "Only a manager can give a hot lead to someone else." };
    patch.owner_email = email;
  }
  return { ok: true, patch };
}

/**
 * A lead put on the list, or back on it after it came off: every field
 * starts blank (nurturing, hot, no amount, no dates), whatever the old row
 * said, and whoever puts it there owns it. The save's own fields go on top.
 */
export function hotFresh(contactId: string, email: string, at: string): Row {
  return {
    contact_id: contactId,
    owner_email: email,
    next_at: null,
    next_how: null,
    last_objection: null,
    note: null,
    heat: "hot",
    status: "nurturing",
    amount: null,
    amount_currency: "USD",
    last_fu_at: null,
    added_by: email,
    added_at: at,
    updated_at: at,
    removed_at: null,
    removed_why: null,
  };
}

/**
 * Whether a hot row still counts as hot for the dialer and the board: on the
 * list and still being worked. A closed or lost row stays on the list for
 * the record and counts no longer. A row read before the status column
 * existed has no status, and is still being worked.
 */
export function stillHot(r: Row): boolean {
  return !r.removed_at && (r.status === null || r.status === undefined || r.status === "nurturing");
}
