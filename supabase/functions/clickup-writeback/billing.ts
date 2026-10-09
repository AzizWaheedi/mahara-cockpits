// Billing edits from the cockpits, written to the client's card on Clients - Mahara.
//
// cockpit_billing_write saves an edit on the mirror and, in the same
// transaction, queues one 'billing' item carrying every field the edit changes
// (migration 20261009j_billing_clickup_writeback.sql). This file turns that
// item into the ClickUp writes billingCore.applyEdit made under Convex
// (apps/media-buyer-cockpit/convex/billingCore.ts), in the same order and the
// same formats:
//   dropdown  POST {value: <option id>}, the option looked up by name on the list
//   date      POST {value: <ms of 09:00 UTC, noon Kuwait>, value_options: {time: false}}
//   number    POST {value: <number>}
//   clear     DELETE on the field value (Paused On, on a resume)
//   note      the comment "Billing note (<email>): <text>"
//
// ClickUp stays the record. Each field is checked against the card first: a
// field that already shows the value is not written again, and a field
// ClickUp changed after the cockpit edit (to something other than what the
// edit replaced) is left as ClickUp has it.

import { dropdownLabel, optionId } from "./kpi.ts";
import type { QueueItem, Step } from "./queue.ts";
import { refLine, type Row } from "./rules.ts";

export type Format = "dropdown" | "date" | "number";
export type BillingStep = Extract<Step, { type: "billing_field" }>;

/** billingCore.ts F: the card fields a billing edit writes, keyed as there. */
export const BILLING_FIELDS: Record<string, { id: string; name: string; format: Format }> = {
  status: { id: "9368ca9e-3549-4320-84ff-9abd0a2901cb", name: "Client Status", format: "dropdown" },
  method: { id: "665e5754-b9c6-4776-9386-111ad221dead", name: "Payment Method", format: "dropdown" },
  plan: { id: "17d17129-43c4-441b-a55c-6eca83b9f776", name: "Payment Plan", format: "dropdown" },
  nextAmount: { id: "f071ee8f-b7ce-49e8-899b-6bef649d86ba", name: "Next Payment Amount", format: "number" },
  nextDate: { id: "669ae046-bf82-4b59-80d5-bf25d6b57ef3", name: "Next Payment Date", format: "date" },
  pausedOn: { id: "930c49eb-9374-410c-801f-9aa81fff4944", name: "Paused On", format: "date" },
  extension: { id: "8cb9d308-5df5-4ea1-b83d-32b5b7eea778", name: "Extension (weeks)", format: "number" },
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** billingCore.applyEdit's note comment. */
export const billingNote = (by: string, text: string) => `Billing note (${by}): ${text}`;

/** The writes one queued billing edit makes on the card, in Convex's order. */
export function billingSteps(item: QueueItem): { steps: Step[] } | { skip: string } {
  const p = item.payload ?? {};
  const taskId = String(p.taskId ?? "");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(taskId)) return { skip: "This billing change has no ClickUp card id, so it stays in the cockpit." };
  const at = Number(p.at) || Date.parse(item.created_at);
  const steps: Step[] = [];
  for (const w of (Array.isArray(p.writes) ? p.writes : []) as Row[]) {
    const f = BILLING_FIELDS[String(w?.field)];
    const value = w?.value ?? null;
    const fits =
      f &&
      (value === null ||
        (f.format === "dropdown" ? typeof value === "string" && value.trim() !== ""
        : f.format === "date" ? DAY.test(String(value))
        : Number.isFinite(Number(value))));
    if (!fits) return { skip: `This billing change carries a value ClickUp cannot take (${String(w?.field)}), so nothing was written.` };
    steps.push({
      key: String(w.field),
      type: "billing_field",
      taskId,
      fieldId: f.id,
      field: f.name,
      format: f.format,
      value: value === null ? null : f.format === "number" ? Number(value) : String(value),
      ...("old" in w ? { old: w.old ?? null } : {}),
      at,
    });
  }
  const note = String(p.note ?? "").trim();
  if (note) steps.push({ key: "comment", type: "comment", taskId, text: `${billingNote(String(p.by ?? ""), note)}\n\n${refLine(item.id)}` });
  if (!steps.length) return { skip: "This billing change writes nothing on the card." };
  return { steps };
}

const kuwaitDay = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);

/** What the card shows in that field now, in the queue's terms: an option name, a Kuwait day or a number. */
export function cardValue(card: Row, fieldId: string, format: Format, listFields: Row[]): string | number | null {
  const cf = ((card?.custom_fields ?? []) as Row[]).find(f => String(f?.id) === fieldId);
  const v = cf?.value;
  if (v === undefined || v === null || v === "") return null;
  if (format === "dropdown") {
    const own = dropdownLabel(cf);
    if (own) return String(own);
    const opts = (listFields.find(f => f.id === fieldId)?.type_config?.options ?? []) as Row[];
    const hit = opts.find(o => String(o.id) === String(v)) ?? opts.find(o => String(o.orderindex) === String(v));
    return hit ? String(hit.name) : String(v);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return format === "date" ? (n > 0 ? kuwaitDay(n) : null) : n;
}

/** PostgREST and ClickUp hand numbers back as numbers or strings; compare them as values. */
const norm = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s;
};
export const sameValue = (a: unknown, b: unknown) => norm(a) === norm(b);

export type Verdict = "write" | "unchanged" | "stale";
export const VERDICT_NOTE: Record<Exclude<Verdict, "write">, string> = {
  unchanged: "ClickUp already shows this value, so nothing is written.",
  stale: "ClickUp changed this card after the cockpit edit, so ClickUp's value stays.",
};

/**
 * Whether to write the field. `ownWrites` says an earlier attempt of this item
 * already wrote to the card, so the card's newer date_updated is our own.
 */
export function billingVerdict(step: BillingStep, card: Row, now: unknown, ownWrites: boolean): Verdict {
  if (sameValue(now, step.value)) return "unchanged";
  const changedAfter = !ownWrites && Number(card?.date_updated) > step.at;
  if (changedAfter && !("old" in step && sameValue(now, step.old))) return "stale";
  return "write";
}

/** The ClickUp request for one field, as billingCore.setValue and setDropdown sent it. */
export function billingRequest(step: BillingStep, listFields: Row[]): { method: "POST" | "DELETE"; body?: Row } {
  if (step.value === null) return { method: "DELETE" };
  if (step.format === "dropdown") {
    const id = optionId(listFields, step.fieldId, String(step.value));
    if (!id) throw new Error(`"${step.value}" is not an option on that ClickUp field.`);
    return { method: "POST", body: { value: id } };
  }
  if (step.format === "date") return { method: "POST", body: { value: Date.parse(`${step.value}T09:00:00Z`), value_options: { time: false } } };
  return { method: "POST", body: { value: Number(step.value) } };
}
