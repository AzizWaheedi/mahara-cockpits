// Contracts through HighLevel's Documents & Contracts, kept apart from
// index.ts so bun can test them (bun test supabase/functions).
//
// Aziz, 2026-10-01: an easy way for the sales people to send and edit
// contracts to clients using the main contract templates, sent from
// HighLevel as today. The main templates fill themselves from contact fields
// ({{contact.company_name}}, {{contact.payment_structure_for_program}},
// {{contact.daily_ad_spend}}), so the cockpit writes those fields, makes the
// document as a draft (still editable in HighLevel), and sends it when the
// rep says so (after that HighLevel locks it).
//
// Aziz, later the same day: "Make it do those things". Contracts made in
// HighLevel directly are copied in as well (contract.sync), staff contracts
// left out, and the cockpit keeps HighLevel's own Contract Status and
// Contract URL contact fields in step with each lead's latest contract.

type Row = Record<string, unknown>;

export type ContractField = "company_name" | "payment_structure" | "daily_ad_spend";
export const CONTRACT_FIELDS: readonly ContractField[] = ["company_name", "payment_structure", "daily_ad_spend"];

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
    contract_status?: { id?: string; options?: string[] };
    contract_url?: { id?: string };
  };
  link_base?: string;
  editor_url?: string;
  /** How a staff contract is told apart: by its template's name, or a role word in its name. */
  staff?: { names?: string[]; words?: string[] };
  /** Keep HighLevel's Contract Status and Contract URL in step (off only when false). */
  write_fields?: boolean;
}

export interface ContractTerms {
  company_name: string;
  payment_structure?: string;
  daily_ad_spend?: number;
}

/** The largest daily ad spend a contract takes, in dollars. */
export const AD_SPEND_MAX = 100_000;

const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * What the rep filled in, checked against what the template uses: the
 * company name always, the payment structure and the daily ad spend when the
 * template prints them. Fields the template does not use are left out.
 */
export function contractTerms(
  b: Row,
  template: ContractTemplate,
  setting: ContractSetting,
): { ok: true; terms: ContractTerms } | { ok: false; error: string } {
  const company = text(b.company_name, 150);
  if (company.length < 2) return { ok: false, error: "Write the client's company name as it should appear on the contract." };
  const terms: ContractTerms = { company_name: company };
  if (template.fields.includes("payment_structure")) {
    const options = setting.fields?.payment_structure?.options ?? [];
    const pick = text(b.payment_structure, 100);
    if (!options.includes(pick))
      return { ok: false, error: `Pick how the client pays: ${options.join(", ")}.` };
    terms.payment_structure = pick;
  }
  if (template.fields.includes("daily_ad_spend")) {
    const raw = String(b.daily_ad_spend ?? "").replace(/[,\s$]/g, "");
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0 || n > AD_SPEND_MAX)
      return { ok: false, error: "Write the daily ad spend in dollars, for example 40." };
    terms.daily_ad_spend = Math.round(n * 100) / 100;
  }
  return { ok: true, terms };
}

/**
 * The contact update that fills the template: HighLevel's company name and
 * the custom fields the template prints. A field the setting has no id for
 * is refused rather than skipped, so a contract never goes out half-filled.
 */
export function contactFill(
  terms: ContractTerms,
  setting: ContractSetting,
): { ok: true; body: Row } | { ok: false; error: string } {
  const customFields: Row[] = [];
  if (terms.payment_structure !== undefined) {
    const id = setting.fields?.payment_structure?.id;
    if (!id) return { ok: false, error: "The payment structure field is not set up. A manager sets it on the Contracts page." };
    customFields.push({ id, field_value: terms.payment_structure });
  }
  if (terms.daily_ad_spend !== undefined) {
    const id = setting.fields?.daily_ad_spend?.id;
    if (!id) return { ok: false, error: "The daily ad spend field is not set up. A manager sets it on the Contracts page." };
    customFields.push({ id, field_value: terms.daily_ad_spend });
  }
  return { ok: true, body: { companyName: terms.company_name, ...(customFields.length ? { customFields } : {}) } };
}

/** The contract's name as the team names them: "Company X Mahara Media", in Arabic when the company's name is. */
export function contractName(company: string): string {
  const c = text(company, 150);
  return /[؀-ۿ]/.test(c) ? `${c} X مهارة ميديا` : `${c} X Mahara Media`;
}

/** HighLevel's statuses as the cockpit keeps them; anything new is kept as it came. */
export function contractStatus(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  return s || "draft";
}

/** A time HighLevel sent, as ISO, or null when it sent none. */
export const isoTime = (v: unknown): string | null => {
  const s = String(v ?? "");
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** The signer's own link, from the links HighLevel returns for each recipient. */
export function signingLink(links: unknown, contactId: string, base: string | undefined): string | null {
  if (!Array.isArray(links) || !base) return null;
  // A "users" link is the sender's own copy: never stored, never shared.
  const list = (links as Row[]).filter(l => !l.deleted && String(l.entityName ?? "") !== "users");
  const own = list.find(l => String(l.recipientId ?? "") === contactId)
    ?? list.find(l => String(l.entityName ?? "") === "contacts");
  const ref = own?.referenceId;
  return typeof ref === "string" && ref ? `${base}${ref}` : null;
}

/**
 * What a document in HighLevel's list says about one of our contracts: its
 * status, name and revision, and when the signer last opened and signed it.
 * Nothing about the signer beyond that is kept.
 */
export function contractPatch(doc: Row, contactId: string, now: string): Row {
  const recipients = Array.isArray(doc.recipients) ? (doc.recipients as Row[]) : [];
  const signer = recipients.find(r => String(r.id ?? "") === contactId) ?? recipients.find(r => r.isPrimary) ?? null;
  const status = contractStatus(doc.status);
  const patch: Row = {
    status,
    name: text(doc.name, 200) || null,
    revision: typeof doc.documentRevision === "number" ? doc.documentRevision : null,
    ghl_updated_at: isoTime(doc.updatedAt),
    checked_at: now,
  };
  const viewed = isoTime(signer?.lastViewedAt);
  if (viewed) patch.viewed_at = viewed;
  const signed = signer?.hasCompleted ? isoTime(signer?.signedDate) : null;
  if (signed) patch.signed_at = signed;
  return patch;
}

/**
 * Which of our contracts HighLevel no longer has. Its document list comes
 * newest change first and a document's last change only moves forward, so a
 * contract last seen changed after the oldest change read had to be on the
 * pages read: absent from them, it was deleted. When the whole list was
 * read, anything absent was. Without a change time on file, only a read of
 * the whole list can say a contract is gone.
 */
export function goneFrom(
  missing: { document_id: string; ghl_updated_at: string | null }[],
  floor: string | null,
  ended: boolean,
): string[] {
  const oldest = floor ? Date.parse(floor) : Number.NaN;
  return missing
    .filter(r => {
      if (ended) return true;
      const seen = r.ghl_updated_at ? Date.parse(r.ghl_updated_at) : Number.NaN;
      return Number.isFinite(seen) && Number.isFinite(oldest) && seen > oldest;
    })
    .map(r => r.document_id);
}

// ---------------------------------------------------------------------------
// Contracts made in HighLevel, and HighLevel's own contract fields
// ---------------------------------------------------------------------------

const norm = (v: unknown) => text(v, 200).toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The lead who signs a document: its primary contact recipient, else its first. */
export function signerOf(doc: Row): string | null {
  const people = (Array.isArray(doc.recipients) ? (doc.recipients as Row[]) : []).filter(
    r => String(r.entityName ?? "contacts") === "contacts" && typeof r.id === "string" && r.id,
  );
  const signer = people.find(r => r.isPrimary) ?? people[0];
  return signer ? String(signer.id) : null;
}

/**
 * Who a HighLevel document is for. "nobody": no lead signs it yet. "staff":
 * a team member's contract, named after one of the staff templates
 * ("Closer Contract") or for a role ("Media Buyer"); those never enter the
 * cockpit. Anything else a lead signs is a client contract.
 */
export function docKind(doc: Row, staff: ContractSetting["staff"]): "client" | "staff" | "nobody" {
  if (!signerOf(doc)) return "nobody";
  const name = norm(doc.name);
  for (const n of (staff?.names ?? []).map(norm).filter(Boolean)) {
    if (name === n) return "staff";
    if (name.startsWith(n) && /[^\p{L}\p{N}]/u.test(name[n.length] ?? "")) return "staff";
  }
  for (const w of (staff?.words ?? []).map(norm).filter(Boolean)) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}($|[^\\p{L}\\p{N}])`, "u").test(name)) return "staff";
  }
  return "client";
}

/** When HighLevel first sent it: the earliest link it made for the lead. */
export function sentAtOf(doc: Row): string | null {
  const times = (Array.isArray(doc.links) ? (doc.links as Row[]) : [])
    .filter(l => !l.deleted && String(l.entityName ?? "") === "contacts")
    .map(l => isoTime(l.createdAt))
    .filter((t): t is string => Boolean(t))
    .sort();
  return times[0] ?? null;
}

/** The HighLevel user who sent it, from the lead's link. */
export function senderOf(doc: Row): string | null {
  const link = (Array.isArray(doc.links) ? (doc.links as Row[]) : []).find(
    l => !l.deleted && String(l.entityName ?? "") === "contacts" && typeof l.createdBy === "string",
  );
  return link ? String(link.createdBy) : null;
}

/**
 * A contract made in HighLevel, as the cockpit keeps it: no terms (they were
 * filled in HighLevel), the template only when the name still is one, and
 * who sent it when that person has a seat.
 */
export function rowFromDoc(
  doc: Row,
  opts: { now: string; linkBase?: string; templateNames: string[]; senderEmail: string | null },
): Row | null {
  const contactId = signerOf(doc);
  const id = text(doc._id, 40);
  if (!contactId || !id) return null;
  const patch = contractPatch(doc, contactId, opts.now);
  const name = text(doc.name, 200);
  const status = String(patch.status);
  const sentAt = status === "draft" ? null : sentAtOf(doc);
  return {
    document_id: id,
    contact_id: contactId,
    template_id: null,
    template_name: opts.templateNames.find(t => norm(t) === norm(name)) ?? null,
    fields: {},
    client_link: status === "draft" ? null : signingLink(doc.links, contactId, opts.linkBase),
    created_by: opts.senderEmail ?? "HighLevel",
    sent_by: sentAt ? opts.senderEmail : null,
    sent_via: null,
    sent_at: sentAt,
    created_at: isoTime(doc.createdAt) ?? opts.now,
    updated_at: opts.now,
    source: "highlevel",
    ...patch,
  };
}

export interface FieldRow {
  document_id: string;
  status: string;
  client_link?: string | null;
  created_at: string;
  signed_at?: string | null;
}

/** HighLevel's Contract Status option for one contract, or null for a status it has no word for. */
export function contactStatusFor(c: Pick<FieldRow, "status" | "signed_at">): string | null {
  const s = c.status.toLowerCase();
  if (s === "completed" || s === "accepted" || c.signed_at) return "Signed";
  if (s === "viewed") return "Waiting On Client";
  if (s === "sent") return "Sent";
  if (s === "draft") return "Working on it";
  if (s === "declined" || s === "expired" || s === "voided") return "CANCELLED";
  return null;
}

/**
 * What a lead's Contract Status and Contract URL should say: the status of
 * their latest contract that still exists, and the signing link of the
 * latest one sent. With every contract deleted, "No Contract Yet" and no
 * link (written only over what the cockpit wrote before).
 */
export function contactFieldsFor(rows: FieldRow[]): { status: string | null; url: string; document_id: string | null } {
  const live = rows
    .filter(r => r.status.toLowerCase() !== "deleted")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (!live.length) return { status: "No Contract Yet", url: "", document_id: null };
  const latest = live[0];
  const linked = live.find(r => r.client_link);
  return { status: contactStatusFor(latest), url: linked?.client_link ?? "", document_id: latest.document_id };
}

/** The templates a manager may offer, cleaned: known fields only, no duplicates, at most 20. */
export function cleanTemplates(list: unknown): ContractTemplate[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: ContractTemplate[] = [];
  for (const t of list as Row[]) {
    const id = text(t?.id, 40);
    if (!/^[A-Za-z0-9]{10,40}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const fields = Array.isArray(t.fields)
      ? CONTRACT_FIELDS.filter(f => (t.fields as unknown[]).includes(f))
      : ["company_name" as const];
    if (!fields.includes("company_name")) fields.unshift("company_name");
    out.push({ id, name: text(t.name, 120) || "Contract", fields });
    if (out.length >= 20) break;
  }
  return out;
}
