// After the call (Aziz, 2026-10-29): "If they mark an intro as shown and they
// didn't convert to a demo ... why that intro did not turn into a demo. There
// has to be a specific reason." And "after they mark anybody, whether it be
// intros or demos ... rate the lead quality from 1 to 10 (so I can also get
// the qualitative metrics from the setter and the closer)."
//
// call.outcome saves either answer, or both, on an intro or demo that was
// held: the rep who hosted it or a manager, as for a mark (lib.ts refuseMark).
// Only the fields sent change; every change leaves an audit row. Nothing goes
// to HighLevel. What a held call still needs is outcomeMissing (dayReview.ts),
// the same rule as cockpit_sales_outcome_missing (20261029a).

import { cleanText, type Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";

type Row = Record<string, unknown>;

export interface CallOutcomesDeps {
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
  now?: () => number;
}

/** Why a held intro booked no demo: the setter gate first, then "not now". */
export const NO_DEMO_REASONS = [
  "signed",
  "no_budget",
  "too_small",
  "not_decision_maker",
  "not_a_fit",
  "no_need",
  "not_ready",
  "has_agency",
  "price_only",
  "thinking",
  "other",
] as const;
export type NoDemoReason = (typeof NO_DEMO_REASONS)[number];

/** A call counts as held for these answers: marked so, or confirmed once its time has passed (B2B's show rule). */
export function heldForOutcome(status: unknown, startAt: unknown, nowMs: number): boolean {
  const s = String(status ?? "");
  if (["showed", "completed", "invalid"].includes(s)) return true;
  const start = Date.parse(String(startAt ?? ""));
  return s === "confirmed" && Number.isFinite(start) && start <= nowMs;
}

/** A whole number from 1 to 10, or a refusal; undefined when it was not sent. */
export function readQuality(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new ApiRefusal("Rate the lead with a whole number from 1 to 10.");
  return n;
}

export function readReason(v: unknown): NoDemoReason | undefined {
  if (v === undefined) return undefined;
  const r = cleanText(v, 40);
  if (!(NO_DEMO_REASONS as readonly string[]).includes(r)) throw new ApiRefusal("Choose why the intro booked no demo.");
  return r as NoDemoReason;
}

export function makeCallOutcomes(d: CallOutcomesDeps): {
  actions: Record<string, (who: Who, b: Row) => Promise<Row>>;
} {
  const now = d.now ?? (() => Date.now());
  const enc = encodeURIComponent;

  async function save(who: Who, b: Row): Promise<Row> {
    const id = cleanText(b.appointment_id, 80);
    if (!id) throw new ApiRefusal("Which call?");
    const quality = readQuality(b.lead_quality);
    const reason = readReason(b.no_demo_reason);
    const note = b.no_demo_note === undefined ? undefined : cleanText(b.no_demo_note, 500) || null;
    if (quality === undefined && reason === undefined && note === undefined)
      throw new ApiRefusal("Rate the lead, or choose why no demo was booked.");

    const call = (
      await d.svc(
        `cockpit_sales_calendar?appointment_id=eq.${enc(id)}&select=appointment_id,contact_id,call_type,start_at,status,assigned_user_id`,
      )
    )[0];
    if (!call) throw new ApiRefusal("That call is not in the cockpit. It may have been deleted in HighLevel.", 404);
    const type = String(call.call_type ?? "");
    if (type !== "intro" && type !== "demo") throw new ApiRefusal("Only intros and demos are rated.");
    if (!who.manager) {
      if (!who.ghl_user_id)
        throw new ApiRefusal("Your seat is not linked to your HighLevel user yet. Ask Aziz to link it on the Team page.", 403);
      if (call.assigned_user_id !== who.ghl_user_id)
        throw new ApiRefusal("This call is booked with another rep. Only they or a manager can rate it.", 403);
    }
    if (!heldForOutcome(call.status, call.start_at, now()))
      throw new ApiRefusal(
        Date.parse(String(call.start_at ?? "")) > now()
          ? "This call has not happened yet. Rate the lead once you have spoken."
          : "This call is not marked held. Mark it Showed first, then rate the lead.",
        409,
      );
    if ((reason !== undefined || note !== undefined) && type !== "intro")
      throw new ApiRefusal("Only an intro is asked why it booked no demo.");

    const before = (
      await d.svc(`cockpit_sales_call_outcomes?appointment_id=eq.${enc(id)}&select=*`)
    )[0] ?? null;
    const reasonAfter = reason ?? (before?.no_demo_reason as string | null | undefined) ?? null;
    const noteAfter = note !== undefined ? note : ((before?.no_demo_note as string | null | undefined) ?? null);
    if (reasonAfter === "other" && String(noteAfter ?? "").trim().length < 3)
      throw new ApiRefusal("Say in a few words why, for Other.");

    const at = new Date(now()).toISOString();
    const body: Row = {
      appointment_id: id,
      contact_id: call.contact_id ?? null,
      call_type: type,
      start_at: call.start_at ?? null,
      updated_at: at,
    };
    if (quality !== undefined) {
      body.lead_quality = quality;
      body.quality_by = who.email ?? null;
      body.quality_role = who.role ?? (who.manager ? "manager" : null);
      body.quality_at = at;
    }
    if (reason !== undefined || note !== undefined) {
      body.no_demo_reason = reasonAfter;
      // Another reason clears the words typed for Other.
      body.no_demo_note = reasonAfter === "other" ? noteAfter : null;
      body.reason_by = who.email ?? null;
      body.reason_at = at;
    }
    const out = await d.svc("cockpit_sales_call_outcomes?on_conflict=appointment_id", {
      method: "POST",
      body,
      prefer: "resolution=merge-duplicates,return=representation",
    });
    const row = out[0] ?? { ...(before ?? {}), ...body };
    await d.audit(who, "call.outcome", "cockpit_sales_call_outcomes", id, before, row, {
      call_type: type,
      contact_id: call.contact_id ?? null,
      ...(who.manager && call.assigned_user_id !== who.ghl_user_id ? { by_manager: true } : {}),
    });
    return { outcome: row };
  }

  return { actions: { "call.outcome": save } };
}
