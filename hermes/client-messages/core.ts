/**
 * The pure rules of the client messages sender (docs/forms/STAGE2B-CONTRACT.md
 * 4.3, 3b): where a card's WhatsApp group is, whether the card agrees, how a
 * sent text is matched again, and the wait before a send. No I/O here.
 *
 * Client Data is read by three header names only, `clickup id`, `wa group
 * id` and `google drive link`; no other column is read and no row or link is
 * ever logged. A group id is a WhatsApp group JID (digits, an optional
 * -digits, @g.us); anything else is no group. The Google Drive Link is the
 * client's content folder, read from the same one row as the group, for the
 * phase 3 and phase 4 messages that end with it (docs/forms/WAVE56-CONTRACT.md
 * D-S4.0); it is one http(s) link or none.
 */
import { createHash } from "node:crypto";

/** A WhatsApp group id, as the guard's transport checks it before any send. */
export const GROUP_JID = /^\d+(?:-\d+)?@g\.us$/;
/** The card's custom field that holds its WhatsApp group: text, filled by hand, nothing writes it (docs/forms/maps/repo-forms.md F.5). Empty passes; a different group refuses. */
export const CARD_GROUP_FIELD = "b1d54dfb-19e9-4c0f-88a3-4f6145f53265";
/** Client Data's WA GROUP ID column, where the team keeps it: F. */
export const GROUP_COLUMN = 5;

const header = (v: unknown) =>
  String(v ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
const cell = (v: unknown) => String(v ?? "").trim();

/** Where the three columns are in the header row; -1 when a name is missing. */
export function columnsOf(values: unknown[][]): {
  task: number;
  group: number;
  folder: number;
} {
  const head = Array.isArray(values?.[0]) ? values[0].map(header) : [];
  return {
    task: head.indexOf("clickup id"),
    group: head.indexOf("wa group id"),
    folder: head.indexOf("google drive link"),
  };
}

/** The card's content folder link on its Client Data row, or why there is none to put in a message. */
export type Folder =
  | { ok: true; link: string }
  | { ok: false; why: "no_column" | "none" | "invalid" };

export type GroupFound =
  | { ok: true; group: string; folder: Folder }
  | { ok: false; why: "no_columns" | "none" | "many" | "invalid" };

/** One link a client can open: http or https, a host, no spaces (a cell with words around a link is no link). */
export function isFolderLink(v: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(v)) return false;
  try {
    return new URL(v).hostname !== "";
  } catch {
    return false;
  }
}

/**
 * The card's group on Client Data: exactly one row for the card, with a valid
 * group id, and that same row's Google Drive Link as its content folder.
 */
export function groupOf(values: unknown[][], taskId: string): GroupFound {
  const { task, group, folder } = columnsOf(values);
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
  const link = folder < 0 ? "" : cell(rows[0][folder]);
  return {
    ok: true,
    group: jid,
    folder:
      folder < 0
        ? { ok: false, why: "no_column" }
        : !link
          ? { ok: false, why: "none" }
          : isFolderLink(link)
            ? { ok: true, link }
            : { ok: false, why: "invalid" },
  };
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

/**
 * Whether ClickUp's answer really lists the card's fields. An empty group field
 * is known only from a card that lists its fields; a 200 with no list, or a
 * group field holding something that is no text, says nothing about the group.
 */
export function cardRead(task: unknown): boolean {
  const fields = (task as { custom_fields?: unknown } | null)?.custom_fields;
  if (!Array.isArray(fields)) return false;
  const value = (
    fields.find(x => (x as { id?: unknown })?.id === CARD_GROUP_FIELD) as
      | { value?: unknown }
      | undefined
  )?.value;
  return value === undefined || value === null || typeof value === "string";
}

export type Verdict = "same" | "empty" | "differs";

/** Client Data against the card: an empty card field or the same group passes; a different one is refused. */
export function groupVerdict(sheet: string, card: string | null): Verdict {
  if (!card) return "empty";
  return card.trim() === sheet.trim() ? "same" : "differs";
}

/** The card's verdict from ClickUp's answer: `unread` when the answer does not list its fields, which never passes. */
export function cardVerdict(sheet: string, task: unknown): Verdict | "unread" {
  return cardRead(task) ? groupVerdict(sheet, cardGroup(task)) : "unread";
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

/** A form link the worker put into a sent message (docs/forms/WAVE34-CONTRACT.md 3.6, 3.9). */
export const INVITE_LINK = /https:\/\/portal\.maharamedia\.com\/f#f1[A-Za-z0-9_-]{43}/g;
/** The placeholder the approved text keeps where the link goes at send. */
export const FORM_LINK = "{form_link}";

/**
 * A group message with any form link masked back to {form_link}, so a sent
 * form link matches its approved text by fingerprint (read-back and the
 * unknown reconcile) and no search ever needs the token (4.1.6).
 */
export function maskInviteLink(text: string): string {
  return String(text ?? "").replace(INVITE_LINK, FORM_LINK);
}

/** The placeholder a phase 3 or phase 4 text keeps where the client's content folder link goes at send. */
export const CONTENT_FOLDER = "{content_folder}";
/** The kinds whose text may carry it (Make 13 [48] and Make 12 [25] end with Client Data column H). */
export const FOLDER_KINDS: readonly string[] = ["phase3", "phase4"];

/** Whether a message needs the card's content folder link put in before it goes. */
export function needsFolder(kind: string, body: string): boolean {
  return FOLDER_KINDS.includes(kind) && String(body ?? "").includes(CONTENT_FOLDER);
}

/** The approved text with every {content_folder} replaced by the link, taken as plain text (a `$` in it stays). */
export function withFolder(body: string, link: string): string {
  return String(body ?? "").split(CONTENT_FOLDER).join(link);
}

/**
 * A group message with the exact folder link put in at send masked back to
 * {content_folder}, so a sent phase message matches its approved text by
 * fingerprint. No link, no change.
 */
export function maskFolder(text: string, link: string | null): string {
  const t = String(text ?? "");
  return link ? t.split(link).join(CONTENT_FOLDER) : t;
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
