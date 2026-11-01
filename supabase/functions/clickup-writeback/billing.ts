// Billing edits from the cockpits, written to the client's card on Clients - Mahara.
//
// cockpit_billing_write (and since waves 1-2 the churn confirm, the money acts
// and the cockpit's own daily step) saves an edit as a cockpit_billing_events
// row and, in the same transaction, queues one 'billing' item carrying every
// field the edit changes and the comment it posts (migrations
// 20261009j_billing_clickup_writeback.sql and 20261101m_billing_rails.sql).
// This file turns that item into ClickUp writes, in the order the item lists
// them and in these formats:
//   dropdown  POST {value: <option id>}, the option looked up by name on the list
//   date      POST {value: <ms of 09:00 UTC, noon Kuwait>, value_options: {time: false}}
//   number    POST {value: <number>} (MRR and LTV are currency fields; they take a number)
//   checkbox  POST {value: true|false}
//   clear     DELETE on the field value (Paused On and Resume On on a resume)
//   note      the comment "Billing note (<email>): <text>"
//   comment   the event's own comment (payload.comment, 20261101m), posted as is
//
// ClickUp stays the record. Each field is checked against the card first: a
// field that already shows the value is not written again, and a field
// ClickUp changed after the cockpit edit (to something other than what the
// edit replaced) is left as ClickUp has it.
//
// Two fields are allowed to be missing without failing the item (contract
// 3.3): the will-not-continue checkbox, whose id is known only by its prefix
// 9cfdb353 and is resolved from the run's read of the list, and a Churn
// Reason the card's list does not offer. Each skips its own step with a
// sentence and the rest of the item runs.

import { dropdownLabel, optionId } from "./kpi.ts";
import type { QueueItem, Step } from "./queue.ts";
import { refLine, type Row } from "./rules.ts";

export type Format = "dropdown" | "date" | "number" | "checkbox";
export type BillingStep = Extract<Step, { type: "billing_field" }>;

/**
 * The card fields a billing event writes (contract 3.3; the first seven are billingCore.ts F).
 * byPrefix: the full id is not in the repo, so `id` is its prefix, resolved per run from the list's
 * own field read; exactly one field of the right type must match (W7).
 */
export const BILLING_FIELDS: Record<string, { id: string; name: string; format: Format; byPrefix?: true }> = {
  status: { id: "9368ca9e-3549-4320-84ff-9abd0a2901cb", name: "Client Status", format: "dropdown" },
  method: { id: "665e5754-b9c6-4776-9386-111ad221dead", name: "Payment Method", format: "dropdown" },
  plan: { id: "17d17129-43c4-441b-a55c-6eca83b9f776", name: "Payment Plan", format: "dropdown" },
  nextAmount: { id: "f071ee8f-b7ce-49e8-899b-6bef649d86ba", name: "Next Payment Amount", format: "number" },
  nextDate: { id: "669ae046-bf82-4b59-80d5-bf25d6b57ef3", name: "Next Payment Date", format: "date" },
  pausedOn: { id: "930c49eb-9374-410c-801f-9aa81fff4944", name: "Paused On", format: "date" },
  extension: { id: "8cb9d308-5df5-4ea1-b83d-32b5b7eea778", name: "Current extension (weeks)", format: "number" },
  resumeOn: { id: "d3c46259-3017-4429-a52a-c609a40f348b", name: "Resume On", format: "date" },
  churnDate: { id: "42429a6e-5cba-4a3b-964d-2b493315421b", name: "Churn Date", format: "date" },
  churnReason: { id: "796f25e7-7e63-4d08-9ec4-41c58a5b57ca", name: "Churn Reason", format: "dropdown" },
  churnType: { id: "a121f39a-f8a4-41f5-905e-a735ee729071", name: "Churn Type", format: "dropdown" },
  mrr: { id: "48eb6023-8944-4404-9e30-b01fc8a38256", name: "MRR", format: "number" },
  ltv: { id: "11d70e58-20e7-4ff0-85c6-51de42f044d2", name: "LTV", format: "number" },
  willNotContinue: { id: "9cfdb353", name: "Will not continue if billed on schedule", format: "checkbox", byPrefix: true },
};

/** The fields the Convex billing writer knew; the rest are waves 1-2 (20261101m). */
export const CONVEX_BILLING_KEYS = ["status", "method", "plan", "nextAmount", "nextDate", "pausedOn", "extension"] as const;

export const WILL_NOT_CONTINUE_MISSING =
  "The will-not-continue checkbox (9cfdb353) is not on Clients - Mahara, so it was not written.";
/** A Churn Reason the card's list lacks: that one field is left empty (20261101m writes the same words in the comment). */
export const churnReasonMissing = (name: unknown) =>
  `"${String(name)}" is not an option on Churn Reason, so the field is left empty.`;

/** The churn register's reasons (cockpit_churn_departures reason CHECK, churnCore.ts REASONS). */
export const REGISTER_REASONS = [
  "Cancelled",
  "Refund",
  "Chargeback",
  "Non-payment 14+ days",
  "Paused past 14 days",
  "Ghosted",
  "Completed term, did not renew",
  "Other",
] as const;

/** The two Churn Type options of the card (contract 3.5). */
export const CHURN_TYPE_OPTIONS = ["Mid-programme loss (counts as churn)", "Completed term (does NOT count as churn)"] as const;

/**
 * The card's Churn Reason option for a register reason, given the option names the list offers: the twin of
 * cockpit_churn_reason_card (20261101m; billing-rails-supabase.test.ts keeps them equal). "Completed term" is the
 * card's "Completed term, did not renew"; Other is never written; any other reason is the option of the same name
 * when the list has it, else null.
 */
export function churnReasonCard(reason: string | null | undefined, options: readonly string[]): string | null {
  const r = String(reason ?? "").trim();
  if (!r || r.toLowerCase() === "other") return null;
  const target = ["completed term", "completed term, did not renew"].includes(r.toLowerCase()) ? "Completed term, did not renew" : r;
  return options.find(o => o.trim().toLowerCase() === target.toLowerCase()) ?? null;
}

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
        : f.format === "checkbox" ? typeof value === "boolean" || value === "true" || value === "false"
        : value !== "" && typeof value !== "boolean" && Number.isFinite(Number(value))));
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
      ...(f.byPrefix ? { byPrefix: true as const } : {}),
      at,
    });
  }
  const note = String(p.note ?? "").trim();
  if (note) steps.push({ key: "comment", type: "comment", taskId, text: `${billingNote(String(p.by ?? ""), note)}\n\n${refLine(item.id)}` });
  // The event's own comment (20261101m), after the fields; posted as written, with the reference line.
  const comment = String(p.comment ?? "").trim();
  if (comment) steps.push({ key: "billing_comment", type: "comment", taskId, text: `${comment}\n\n${refLine(item.id, note ? "c" : "")}` });
  if (!steps.length) return { skip: "This billing change writes nothing on the card." };
  return { steps };
}

/**
 * The field id one step writes on this run. A byPrefix step needs exactly one field of the list starting with its
 * prefix, of its format; otherwise the step is skipped with the sentence and the rest of the item runs.
 */
export function resolveField(step: BillingStep, listFields: Row[]): { fieldId: string } | { missing: string } {
  if (!step.byPrefix) return { fieldId: step.fieldId };
  const hits = listFields.filter(f => String(f?.id ?? "").startsWith(step.fieldId));
  if (hits.length !== 1 || String(hits[0].type ?? "") !== step.format) return { missing: WILL_NOT_CONTINUE_MISSING };
  return { fieldId: String(hits[0].id) };
}

/** A soft field whose value the list cannot take: skipped with its sentence instead of failing the item. */
export function softMissing(step: BillingStep, listFields: Row[]): string | null {
  if (step.key !== "churnReason" || step.value === null) return null;
  return optionId(listFields, step.fieldId, String(step.value)) ? null : churnReasonMissing(step.value);
}

const kuwaitDay = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(0, 10);

/** What the card shows in that field now, in the queue's terms: an option name, a Kuwait day or a number. */
export function cardValue(card: Row, fieldId: string, format: Format, listFields: Row[]): string | number | null {
  const cf = ((card?.custom_fields ?? []) as Row[]).find(f => String(f?.id) === fieldId);
  const v = cf?.value;
  if (v === undefined || v === null || v === "") return null;
  // ClickUp hands a checkbox back as true or "true" when ticked; any other value set reads as not ticked.
  if (format === "checkbox") return v === true || v === "true" ? "true" : "false";
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
  if (step.format === "checkbox") return { method: "POST", body: { value: step.value === "true" } };
  return { method: "POST", body: { value: Number(step.value) } };
}

// --- the database calls of the billing lane (20261101m; both service_role only) -------------------------

export function billingDb(rpc: (name: string, params?: Row) => Promise<any>) {
  return {
    /** Held billing edits: {held, heldOpenKind, byKind}, heldOpenKind counting the kinds the switch opens (W20). */
    held: (openKinds: string[]) => rpc("cockpit_billing_writeback_held", { p_kinds: openKinds }) as Promise<Row | null>,
    /** Stores one read of a list's fields as the field map (W7); returns how many fields were stored. */
    putFields: (listId: string, fields: Row[]) => rpc("cockpit_clickup_fields_put", { p_list: listId, p_fields: fields }),
  };
}

// --- the billing doctor (job billing_doctor, contract 4.1 step 2) ----------------------------------------

const optionNames = (f: Row | undefined): string[] =>
  ((f?.type_config?.options ?? []) as Row[]).map(o => String(o?.name ?? "").trim()).filter(Boolean);
const fieldTypes: Partial<Record<Format, string[]>> = {
  dropdown: ["drop_down"],
  date: ["date"],
  number: ["number", "currency"],
  checkbox: ["checkbox"],
};

export type BillingDoctor = {
  /** One plain sentence per thing on the list the billing writes rely on and do not find. */
  gaps: string[];
  churnReasonOptions: string[];
  /** Each register reason but Other, and the card option it is written as (null: left empty). */
  reasonMap: Record<string, string | null>;
  willNotContinue: string | null;
};

/** What the billing writes need from the Clients - Mahara fields, read once (GET list/{id}/field). Reads only. */
export function billingDoctorChecks(fields: Row[]): BillingDoctor {
  const gaps: string[] = [];
  const byId = new Map(fields.map(f => [String(f?.id ?? ""), f]));
  for (const [key, f] of Object.entries(BILLING_FIELDS)) {
    if (f.byPrefix) continue;
    const found = byId.get(f.id);
    if (!found) gaps.push(`${f.name} (${f.id.slice(0, 8)}) is not on Clients - Mahara, so ${key} edits cannot be written.`);
    else if (!(fieldTypes[f.format] ?? []).includes(String(found.type ?? "")))
      gaps.push(`${f.name} (${f.id.slice(0, 8)}) is a ${String(found.type ?? "field of no type")} field, not ${f.format === "number" ? "a number or currency" : `a ${f.format}`} field.`);
  }
  const status = optionNames(byId.get(BILLING_FIELDS.status.id));
  for (const want of ["Active", "Paused", "Stopped"])
    if (byId.has(BILLING_FIELDS.status.id) && !status.includes(want)) gaps.push(`Client Status has no "${want}" option.`);
  const types = optionNames(byId.get(BILLING_FIELDS.churnType.id));
  for (const want of CHURN_TYPE_OPTIONS)
    if (byId.has(BILLING_FIELDS.churnType.id) && !types.includes(want)) gaps.push(`Churn Type has no "${want}" option.`);
  const churnReasonOptions = optionNames(byId.get(BILLING_FIELDS.churnReason.id));
  const reasonMap: Record<string, string | null> = {};
  const unmapped: string[] = [];
  for (const reason of REGISTER_REASONS) {
    if (reason === "Other") continue;
    reasonMap[reason] = churnReasonCard(reason, churnReasonOptions);
    if (!reasonMap[reason]) unmapped.push(reason);
  }
  // Never fatal: a churn with such a reason leaves the one field empty and says so in its comment.
  if (byId.has(BILLING_FIELDS.churnReason.id) && unmapped.length)
    gaps.push(`Churn Reason has no option for ${unmapped.map(r => `"${r}"`).join(", ")}, so a churn with ${unmapped.length === 1 ? "that reason" : "those reasons"} leaves the field empty.`);
  const prefix = BILLING_FIELDS.willNotContinue.id;
  const hits = fields.filter(f => String(f?.id ?? "").startsWith(prefix));
  let willNotContinue: string | null = null;
  if (hits.length === 0) gaps.push(WILL_NOT_CONTINUE_MISSING);
  else if (hits.length > 1) gaps.push(`${hits.length} fields on Clients - Mahara start with ${prefix}, so the will-not-continue checkbox is not written until one is left.`);
  else if (String(hits[0].type ?? "") !== "checkbox") gaps.push(`The field starting ${prefix} is a ${String(hits[0].type ?? "field of no type")} field, not a checkbox, so it is not written.`);
  else willNotContinue = String(hits[0].id);
  return { gaps, churnReasonOptions, reasonMap, willNotContinue };
}
