/**
 * Client contracts in HighLevel's Documents & Contracts (sales-api
 * contracts.ts): the ones made from a lead's page, and the ones made in
 * HighLevel itself, copied in by the sync. A contract moves Draft, Sent,
 * Opened, Signed; the cockpit reads that back from HighLevel.
 */

export type ContractField =
  | "company_name"
  | "payment_structure"
  | "daily_ad_spend";

export interface ContractTemplate {
  id: string;
  name: string;
  fields: ContractField[];
}

export interface ContractSetting {
  templates?: ContractTemplate[];
  fields?: {
    daily_ad_spend?: { id?: string };
    payment_structure?: { id?: string; options?: string[] };
  };
  link_base?: string;
  editor_url?: string;
  /** How a staff contract is told apart, so it never shows here. */
  staff?: { names?: string[]; words?: string[] };
  /** The templates HighLevel's WhatsApp workflow sends the client a link for, once sent. */
  whatsapp?: { template_ids?: string[]; template?: string; workflow?: string };
}

export interface Contract {
  document_id: string;
  contact_id: string;
  /** Unknown for a contract made in HighLevel. */
  template_id: string | null;
  template_name: string | null;
  name: string | null;
  status: string;
  fields: {
    company_name?: string;
    payment_structure?: string;
    daily_ad_spend?: number;
  };
  created_by: string;
  sent_by: string | null;
  sent_via: "email" | "link" | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  revision: number | null;
  ghl_updated_at: string | null;
  created_at: string;
  updated_at: string;
  checked_at: string | null;
  /** cockpit: made from a lead's page. highlevel: made in HighLevel. */
  source: "cockpit" | "highlevel";
}

/** Every column a seat may read (the signing link is the server's). */
export const CONTRACT_COLUMNS =
  "document_id,contact_id,template_id,template_name,name,status,fields,created_by,sent_by,sent_via,sent_at,viewed_at,signed_at,revision,ghl_updated_at,created_at,updated_at,checked_at,source";

/** The Contracts page lists contracts waiting this long, and drafts this new; older ones stay on each lead's page. */
export const WAITING_DAYS = 60;
export const DRAFT_DAYS = 30;

export const STEPS = ["Draft", "Sent", "Opened", "Signed"] as const;

type Progress = Pick<Contract, "status" | "signed_at" | "viewed_at"> &
  Partial<Pick<Contract, "sent_at">>;

/** How far along the contract is: 0 draft, 1 sent, 2 opened, 3 signed. */
export function stepOf(c: Progress): number {
  const s = c.status.toLowerCase();
  if (s === "completed" || s === "accepted" || c.signed_at) return 3;
  if (s === "viewed" || c.viewed_at) return 2;
  if (s === "sent" || c.sent_at) return 1;
  return 0;
}

/** When each step was reached, as far as the cockpit knows. */
export function stepTimes(c: Contract): (string | null)[] {
  return [c.created_at, c.sent_at, c.viewed_at, c.signed_at];
}

/** Ended without a signature: declined, expired or voided in HighLevel, or deleted there. */
const ENDED = ["declined", "expired", "voided", "deleted"];

/** Still waiting on someone: a draft not sent, or a sent contract not signed. */
export function isOpen(c: Progress): boolean {
  return stepOf(c) < 3 && !ENDED.includes(c.status.toLowerCase());
}

/** What happened to a contract that ended without a signature, and what to do next. */
export function endedNote(c: Progress): string | null {
  if (isOpen(c) || stepOf(c) === 3) return null;
  const s = c.status.toLowerCase();
  return s === "deleted"
    ? "Deleted in HighLevel. Make a new contract if they still want to sign."
    : `HighLevel marks it ${s}. Make a new contract if they still want to sign.`;
}

/** The words a rep puts in WhatsApp with the signing link. */
export function shareLine(link: string, language: "ar" | "en"): string {
  return language === "ar"
    ? `هذا العقد.. تقدر تراجعه وتوقّعه من هالرابط: ${link}`
    : `Here is the contract. You can review and sign it here: ${link}`;
}

/** The template it came from, or where it was made when that is all the cockpit knows. */
export function madeFrom(
  c: Pick<Contract, "template_name" | "source">,
): string {
  return (
    c.template_name ??
    (c.source === "highlevel" ? "Made in HighLevel" : "Contract")
  );
}

/** How it went out, for the line under a contract. */
export function sentHow(c: Pick<Contract, "sent_via">): string {
  return c.sent_via === "link"
    ? "as a link"
    : c.sent_via === "email"
      ? "by email"
      : "from HighLevel";
}

/** Who took the step: the name before the @, or HighLevel when no seat did. */
export function byWhom(email: string | null | undefined): string {
  return !email || email === "HighLevel"
    ? "in HighLevel"
    : `by ${email.split("@")[0]}`;
}

/** Whether a template needs this field filled. */
export const uses = (
  t: ContractTemplate | null | undefined,
  f: ContractField,
) => Boolean(t?.fields.includes(f));
