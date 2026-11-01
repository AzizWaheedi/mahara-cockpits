/**
 * op recap.approve (docs/forms/STAGE2B-CONTRACT.md build 3, "The approval op"):
 * a reviewer says yes to the exact text a client's WhatsApp group will read.
 *
 * The row is read with the seat's own token (cockpit_client_message_read), so
 * its gate applies first; the text is checked by the same 14 rules a draft
 * passed (recapRules.ts), as the full text with Make's booking block; a
 * refusal names what to change, warnings ask once for Approve anyway; then the
 * service-only cockpit_client_message_approve stores that text with the sha256
 * of its exact UTF-8 bytes and the verified actor (never an id from the
 * browser), re-running the owner gate (3.1) inside the database. Nothing here
 * sends: hermes/client-messages sends an approved row, behind its own switch.
 *
 * op invite.approve (docs/forms/WAVE34-CONTRACT.md 3.9, 4.1.5): the same steps
 * for a form link message. Its text keeps {form_link} exactly once (the worker
 * puts the link there when it sends, so the stored text never holds a link),
 * passes the leads, money and guarantee checks the recap path uses, and is at
 * most 1,000 characters. Each op refuses the other's kind.
 */
import { DoorError, type OpCtx } from "./door.ts";
import { sha256 } from "./drafts.ts";
import { checkRecap, GUARANTEE, LEADS, MONEY, splitRecap, WARRANTY } from "./recapRules.ts";

/** The longest text one WhatsApp message takes, as the message row stores it (3.5). */
export const MESSAGE_MAX = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SAY_MESSAGES = {
  open: "Open the recap from the client page.",
  notDraft:
    "This recap is not waiting for approval any more. Reload the page to see where it is.",
  tooLong:
    "The recap is longer than 4,096 characters, which one WhatsApp message cannot take. Shorten it, then approve again.",
  noText: "Write the recap before you approve it.",
  /** recap.approve on a form link, and invite.approve on a recap (4.1.5). */
  notRecap: "Approve a form link from Send a form.",
  inviteOpen: "Open the form link from the client page.",
  notInvite: "Approve recaps from the Messages card.",
  inviteNotDraft: "This message is not waiting for approval any more. Reload the page to see where it is.",
  inviteNoText: "Write the message before you approve it.",
  inviteTooLong: "The message is longer than 1,000 characters. Shorten it, then approve again.",
  inviteLink: "Keep {form_link} in the message exactly once: the link goes there when it sends.",
  inviteLeads:
    "Client messages never quote leads or cost per lead. Say how the campaign is doing, or count appointments for clients we book for.",
  inviteMoney: "A form link message carries no amounts. Remove the number and the currency, then approve again.",
  inviteGuarantee: "Client forms never promise results. Remove the guarantee wording.",
} as const;
/** The longest form link message (3.9). */
export const INVITE_MAX = 1000;
export const FORM_LINK = "{form_link}";

/** The checks' sentence for a reviewer: an edited text is put right by editing it, not by drafting again. */
export const forReviewer = (sentence: string) =>
  sentence.replace(/\s*Draft again\.$/, " Edit the text, then approve again.");

export type ApproveAnswer =
  | { message: Record<string, unknown>; warnings: string[] }
  | { needsConfirm: true; warnings: string[] };

export async function approveRecap(
  op: OpCtx,
  body: Record<string, unknown>,
): Promise<ApproveAnswer> {
  const id = String(body.messageId ?? "");
  if (!UUID.test(id)) throw new DoorError(SAY_MESSAGES.open, 400);
  if (typeof body.body !== "string")
    throw new DoorError(SAY_MESSAGES.noText, 400);
  // The exact text, byte for byte: what is checked, hashed and stored is what the group reads.
  const text = body.body;
  // (1) The row, through the seat's gate.
  const row = (await op.userRpc("cockpit_client_message_read", {
    p_id: id,
  })) as Record<string, unknown> | null;
  if (row?.kind === "form_invite") throw new DoorError(SAY_MESSAGES.notRecap, 400);
  if (row?.state !== "draft") throw new DoorError(SAY_MESSAGES.notDraft, 400);
  if ([...text].length > MESSAGE_MAX)
    throw new DoorError(SAY_MESSAGES.tooLong, 400);
  // (2) The message and Make's booking block. A text that does not end with a blank line and the block, as
  // the draft wrote it, is refused with the booking rule's own sentence (a doubled block is refused by it below).
  const [message, block] = splitRecap(text);
  if (block === null)
    throw new DoorError(
      forReviewer(
        checkRecap("", { skip: true, text: "" }).checks.find(
          c => c.rule === "booking",
        )?.note ?? "",
      ),
      400,
    );
  // (3) The 14 checks on the full text, the stored text being the same text.
  const teamToday = (await op.deps.rpc("cockpit_client_message_team_today", {
    p_task_id: String(row.taskId ?? ""),
  })) as boolean | null;
  const verdict = checkRecap(message, {
    text,
    stored: text,
    teamToday: typeof teamToday === "boolean" ? teamToday : null,
  });
  // (4) A refusal, in the reviewer's words.
  if (verdict.refusal) throw new DoorError(forReviewer(verdict.refusal), 400);
  // (5) Warnings are approved only once someone has read them.
  if (verdict.warnings.length && body.acceptWarnings !== true)
    return { needsConfirm: true, warnings: verdict.warnings };
  // (6) and (7): the fingerprint of the exact bytes, and the verified actor.
  const stored = (await op.deps.rpc("cockpit_client_message_approve", {
    p_id: id,
    p_body: text,
    p_body_sha256: await sha256(text),
    p_actor: op.actor.actorId,
    p_warnings: verdict.warnings,
  })) as Record<string, unknown>;
  return { message: stored, warnings: verdict.warnings };
}

/** The refusal for a form link's text, or null when it may be approved (3.9). */
export function inviteRefusal(text: string): string | null {
  if (!text.trim()) return SAY_MESSAGES.inviteNoText;
  if ([...text].length > INVITE_MAX) return SAY_MESSAGES.inviteTooLong;
  if (text.split(FORM_LINK).length !== 2) return SAY_MESSAGES.inviteLink;
  const words = text.replace(FORM_LINK, " ");
  if (LEADS.test(words)) return SAY_MESSAGES.inviteLeads;
  if (MONEY.test(words)) return SAY_MESSAGES.inviteMoney;
  // The database's client text rule refuses ضمان too (V18), so the op says it first.
  if (GUARANTEE.test(words) || WARRANTY.test(words)) return SAY_MESSAGES.inviteGuarantee;
  return null;
}

export async function approveInvite(
  op: OpCtx,
  body: Record<string, unknown>,
): Promise<ApproveAnswer> {
  const id = String(body.messageId ?? "");
  if (!UUID.test(id)) throw new DoorError(SAY_MESSAGES.inviteOpen, 400);
  if (typeof body.body !== "string") throw new DoorError(SAY_MESSAGES.inviteNoText, 400);
  const text = body.body;
  // (1) The row, through the seat's gate.
  const row = (await op.userRpc("cockpit_client_message_read", {
    p_id: id,
  })) as Record<string, unknown> | null;
  if (row?.kind !== "form_invite") throw new DoorError(SAY_MESSAGES.notInvite, 400);
  if (row.state !== "draft") throw new DoorError(SAY_MESSAGES.inviteNotDraft, 400);
  // (2) The text, as the database will check it again.
  const refusal = inviteRefusal(text);
  if (refusal) throw new DoorError(refusal, 400);
  // (3) The fingerprint of the exact bytes, and the verified actor.
  const stored = (await op.deps.rpc("cockpit_client_message_approve", {
    p_id: id,
    p_body: text,
    p_body_sha256: await sha256(text),
    p_actor: op.actor.actorId,
    p_warnings: [],
  })) as Record<string, unknown>;
  return { message: stored, warnings: [] };
}
