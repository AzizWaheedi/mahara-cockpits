/**
 * The pure rules of the client messages sender (docs/forms/STAGE2B-CONTRACT.md
 * 4.3, 3b): where a card's WhatsApp group is, whether the card agrees, how a
 * sent text is matched again, and the wait before a send. No I/O here.
 *
 * Client Data is read by two header names only, `clickup id` and `wa group
 * id`; no other column is read and no row is ever logged. A group id is a
 * WhatsApp group JID (digits, an optional -digits, @g.us); anything else is
 * no group.
 */
import { createHash } from "node:crypto";

/** A WhatsApp group id, as the guard's transport checks it before any send. */
export const GROUP_JID = /^\d+(?:-\d+)?@g\.us$/;
/** The card's custom field that holds its WhatsApp group (the guard reads the same field). */
export const CARD_GROUP_FIELD = "b1d54dfb-19e9-4c0f-88a3-4f6145f53265";
/** Client Data's WA GROUP ID column, where the team keeps it: F. */
export const GROUP_COLUMN = 5;

const header = (v: unknown) =>
  String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
const cell = (v: unknown) => String(v ?? "").trim();

/** Where the two columns are in the header row; -1 when a name is missing. */
export function columnsOf(values: unknown[][]): {
  task: number;
  group: number;
} {
  const head = Array.isArray(values?.[0]) ? values[0].map(header) : [];
  return {
    task: head.indexOf("clickup id"),
    group: head.indexOf("wa group id"),
  };
}

export type GroupFound =
  | { ok: true; group: string }
  | { ok: false; why: "no_columns" | "none" | "many" | "invalid" };

/** The card's group on Client Data: exactly one row for the card, with a valid group id. */
export function groupOf(values: unknown[][], taskId: string): GroupFound {
  const { task, group } = columnsOf(values);
  if (task < 0 || group < 0) return { ok: false, why: "no_columns" };
  const want = cell(taskId);
  const rows = (Array.isArray(values) ? values.slice(1) : []).filter(
    r => Array.isArray(r) && cell(r[task]) === want && want !== "",
  );
  if (rows.length === 0) return { ok: false, why: "none" };
  if (rows.length > 1) return { ok: false, why: "many" };
  const jid = cell(rows[0][group]);
  if (!jid) return { ok: false, why: "none" };
  if (!GROUP_JID.test(jid)) return { ok: false, why: "invalid" };
  return { ok: true, group: jid };
}

/** Whether Client Data still keeps the group in column F (the tech lead checks a moved sheet first). */
export function sheetShape(values: unknown[][]): {
  ok: boolean;
  column: string | null;
} {
  const { task, group } = columnsOf(values);
  const column = group < 0 ? null : columnLetter(group);
  return { ok: task >= 0 && group === GROUP_COLUMN, column };
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** The group the ClickUp card holds in its custom field, or null when empty. */
export function cardGroup(task: unknown): string | null {
  const fields = (task as { custom_fields?: unknown })?.custom_fields;
  if (!Array.isArray(fields)) return null;
  const f = fields.find(
    x => (x as { id?: unknown })?.id === CARD_GROUP_FIELD,
  ) as { value?: unknown } | undefined;
  const v = typeof f?.value === "string" ? f.value.trim() : "";
  return v || null;
}

export type Verdict = "same" | "empty" | "differs";

/** Client Data against the card: an empty card field or the same group passes; a different one is refused. */
export function groupVerdict(sheet: string, card: string | null): Verdict {
  if (!card) return "empty";
  return card.trim() === sheet.trim() ? "same" : "differs";
}

/** The text as WhatsApp may hand it back: one line ending, no trailing spaces, the same Unicode form. */
export function normalise(text: string): string {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(l => l.replace(/[ \t ]+$/u, ""))
    .join("\n")
    .trim();
}

/** sha256 of the exact UTF-8 bytes, hex. */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The wait between the claim and the send: uniform from 30 to 120 seconds. */
export function jitterMs(random: () => number = Math.random): number {
  const r = Math.min(Math.max(random(), 0), 0.999999999);
  return 30_000 + Math.floor(r * 90_001);
}

/** The last four digits of a number or an id, never more. */
export function last4(v: unknown): string | null {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}
