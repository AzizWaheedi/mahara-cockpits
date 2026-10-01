/**
 * Contracts made in HighLevel's Documents & Contracts from the main
 * templates (sales-api contracts.ts). A contract moves Draft, Sent, Opened,
 * Signed; the cockpit reads that back from HighLevel.
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
}

export interface Contract {
  document_id: string;
  contact_id: string;
  template_id: string;
  template_name: string;
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
}

/** Every column a seat may read (the signing link is the server's). */
export const CONTRACT_COLUMNS =
  "document_id,contact_id,template_id,template_name,name,status,fields,created_by,sent_by,sent_via,sent_at,viewed_at,signed_at,revision,ghl_updated_at,created_at,updated_at,checked_at";

export const STEPS = ["Draft", "Sent", "Opened", "Signed"] as const;

/** How far along the contract is: 0 draft, 1 sent, 2 opened, 3 signed. */
export function stepOf(
  c: Pick<Contract, "status" | "signed_at" | "viewed_at">,
): number {
  const s = c.status.toLowerCase();
  if (s === "completed" || s === "accepted" || c.signed_at) return 3;
  if (s === "viewed" || c.viewed_at) return 2;
  if (s === "sent") return 1;
  return 0;
}

/** When each step was reached, as far as the cockpit knows. */
export function stepTimes(c: Contract): (string | null)[] {
  return [c.created_at, c.sent_at, c.viewed_at, c.signed_at];
}

/** Still waiting on someone: a draft not sent, or a sent contract not signed. */
export function isOpen(
  c: Pick<Contract, "status" | "signed_at" | "viewed_at">,
): boolean {
  return (
    stepOf(c) < 3 &&
    !["declined", "expired", "voided"].includes(c.status.toLowerCase())
  );
}

/** The words a rep puts in WhatsApp with the signing link. */
export function shareLine(link: string, language: "ar" | "en"): string {
  return language === "ar"
    ? `هذا العقد.. تقدر تراجعه وتوقّعه من هالرابط: ${link}`
    : `Here is the contract. You can review and sign it here: ${link}`;
}

/** Whether a template needs this field filled. */
export const uses = (
  t: ContractTemplate | null | undefined,
  f: ContractField,
) => Boolean(t?.fields.includes(f));
