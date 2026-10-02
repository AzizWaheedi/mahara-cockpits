import type { Contract } from "./contracts";
import type { Lead, Recording } from "./types";

/**
 * The New Client Form on a lead's page (Aziz, 2026-10-02: "as easy as
 * possible for the closer to fill ... so that it triggers the same make
 * scenario it already triggers, but in the cockpit itself").
 *
 * The form is Typeform's own, embedded: Typeform stores the response, B2B
 * reads closed_deals from what it stored, and its webhook starts Make's
 * onboarding, so nothing may imitate it. Typeform fills only hidden fields
 * in advance, never a visible answer, so the page lists what the cockpit
 * already knows beside the form, in the form's own order, ready to copy.
 *
 * The questions come from the setting `client_form`, which the sales desk
 * copies from Typeform every ten minutes. An answer is matched by the
 * question's ref, which Typeform keeps when a title is edited; a question
 * the cockpit has no answer for is listed for the closer to type.
 */

export const CLIENT_FORM_ID = "BTzMwXiw";
export const CLIENT_FORM_URL = `https://maharamedia.typeform.com/to/${CLIENT_FORM_ID}`;

export interface FormQuestion {
  ref: string;
  title: string;
  type: string;
  required: boolean;
  choices?: string[];
  description?: string;
}

export interface ClientFormSetting {
  form_id?: string;
  title?: string;
  url?: string;
  hidden?: string[];
  screens?: { title: string; questions: FormQuestion[] }[];
  form_updated_at?: string | null;
  synced_at?: string;
}

/** A New Client Form sent from a lead's page (cockpit_sales_client_forms). */
export interface ClientFormSent {
  response_id: string;
  contact_id: string;
  form_id: string;
  hidden: { contact_id?: string; closer?: string; setter?: string };
  sent_by: string;
  sent_by_name: string | null;
  sent_at: string;
}

/** The questions' refs, as Typeform holds them (read 2026-10-02). */
export const REF = {
  closer: "a86cbf90-2154-44d9-84e3-b4a20f8e96a2",
  firstName: "01247377-41fd-430d-bafd-c7223cfb911f",
  lastName: "a5171940-e34f-4c12-9bc5-2c984ded20a8",
  phone: "95a3901f-4130-454e-8e45-14c9a99dd096",
  rawPhone: "f322053a-3b86-4e8c-8596-93d31a096679",
  email: "a6ea04df-7b41-4a9f-b92b-8b5347a585be",
  business: "a1be4eee-8219-4228-8423-8cbf64919c5f",
  country: "528abff2-39be-4200-aa5f-a6f8521fc204",
  timezone: "4ce5d27f-85a3-4af0-a327-ead29b036c1a",
  leadSource: "0c1f4a00-f77a-44f4-b598-945c9ab406a3",
  payment: "20848f32-80ed-4693-b064-ed4e10558b94",
  agreement: "3781537c-925c-4331-900c-e576a3f47a0d",
  adSpend: "e813c776-0584-4147-8c2c-dbe72d4818e2",
  fathom: "52ca9be9-8f56-4bb8-a130-dc1754e7d84d",
  transcript: "c62ae38e-71a1-4ba1-a7a5-023e378eb083",
} as const;

/** What the closer does with one question. */
export type Fill =
  /** Copy this and paste it in. */
  | { kind: "copy"; value: string }
  /** A choice: pick this option in the form. */
  | { kind: "pick"; value: string }
  /** The call's transcript, read from storage when copied. */
  | { kind: "transcript"; path: string; chars: number | null }
  /** Nothing the cockpit knows: the closer types it, with a hint when there is one. */
  | { kind: "type"; hint?: string };

export interface RailRow {
  ref: string;
  label: string;
  required: boolean;
  fill: Fill;
}

export interface RailScreen {
  title: string;
  rows: RailRow[];
}

export interface FormContext {
  lead: Lead;
  /** The closer the hidden field names: the demo's rep, or whoever is signed in. */
  closer: string;
  contracts: Contract[];
  recordings: Recording[];
}

/** The hidden fields the embedded form carries: the lead, the closer, the setter. */
export function hiddenFields(
  lead: Lead,
  closer: string,
  setter: string,
): Record<string, string> {
  return { contact_id: lead.contact_id, closer, setter };
}

/** The form in a new tab with the same hidden fields, for when the embed cannot load. */
export function formLink(
  setting: ClientFormSetting | null,
  hidden: Record<string, string>,
): string {
  const base = setting?.url || CLIENT_FORM_URL;
  return `${base}#${new URLSearchParams(hidden).toString()}`;
}

/** A question's title without the instructions some carry, for a short label. */
export function shortLabel(title: string): string {
  return title
    .replace(/\s*-\s*DO NOT include the \$ symbol.*$/i, "")
    .replace(/\s*\((?:IGNORE IF PIF|For internal team|No\+[^)]*)\)\s*/gi, " ")
    .replace(/\s*\(Saudi is the same as Kuwait\)/i, "")
    .replace(/\s+-\s+Describe what this client.*$/i, "")
    .replace(/\s+-\s+and are there any delays.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** First and last name, split at the first space; one word is a first name. */
export function splitName(name: string | null): {
  first: string;
  last: string;
} {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

/** The number as the form's raw field wants it: digits only, no plus or leading zeros of an international prefix. */
export function rawPhone(phone: string | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.startsWith("00") ? digits.slice(2) : digits;
}

const DIAL: Record<string, string> = {
  "965": "KW",
  "966": "SA",
  "971": "AE",
  "973": "BH",
  "974": "QA",
  "968": "OM",
};

/** The country as the form lists it (KW, SA, AE, BH, QA, OM), from the lead's country or else the number. */
export function countryCode(lead: Lead): string | null {
  const c = (lead.country ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(c)) return c;
  const d = rawPhone(lead.phone);
  for (const [prefix, code] of Object.entries(DIAL))
    if (d.startsWith(prefix)) return code;
  return null;
}

/** The form's time zone choice for a country: Saudi reads as Kuwait, as the question says. */
export function timezoneFor(
  code: string | null,
  choices: string[],
): string | null {
  const want: Record<string, string> = {
    KW: "Kuwait",
    SA: "Kuwait",
    BH: "Bahrain",
    QA: "Qatar",
    AE: "UAE",
    OM: "UAE",
  };
  const word = code ? want[code] : null;
  if (!word) return null;
  return (
    choices.find(c => c.toLowerCase().startsWith(word.toLowerCase())) ?? null
  );
}

/** Where the lead came from, in the form's words, or null when the cockpit can't tell. */
export function leadSourceFor(lead: Lead, choices: string[]): string | null {
  const text = [lead.source, lead.utm_source, lead.booking_channel]
    .map(v => (v ?? "").toLowerCase())
    .join(" ");
  const pick = (label: string) =>
    choices.find(c => c.toLowerCase() === label.toLowerCase()) ?? null;
  if (/reactivation/.test(text)) return pick("Reactivation Campaign");
  if (/tiktok/.test(text)) return pick("TikTok ads");
  if (/referr/.test(text)) return pick("Referral");
  if (/\bemail\b/.test(text)) return pick("Email");
  if (
    lead.ad_id ||
    /\b(fb|ig|facebook|instagram|meta)\b|roasform|\bads?\b/.test(text)
  )
    return pick("Meta ads");
  return null;
}

/** The newest contract that went out to the lead, if any. */
export function sentContract(contracts: Contract[]): Contract | null {
  return (
    contracts.find(c => ["sent", "viewed", "completed"].includes(c.status)) ??
    null
  );
}

/** The sales call to point the client success team at: the newest Fathom recording with a link. */
export function salesRecording(recordings: Recording[]): Recording | null {
  return (
    [...recordings]
      .filter(r => r.share_url && (r.kind === "sales" || !r.kind))
      .sort(
        (a, b) =>
          Date.parse(String(b.started_at ?? "")) -
          Date.parse(String(a.started_at ?? "")),
      )[0] ?? null
  );
}

function choice(q: FormQuestion, value: string | null | undefined): Fill {
  const v = (value ?? "").trim();
  if (v && (q.choices ?? []).includes(v)) return { kind: "pick", value: v };
  return { kind: "type" };
}

function copy(value: string | null | undefined, hint?: string): Fill {
  const v = (value ?? "").trim();
  return v ? { kind: "copy", value: v } : { kind: "type", hint };
}

/** What the cockpit knows for one question, by its ref. */
export function fillFor(q: FormQuestion, ctx: FormContext): Fill {
  const { lead } = ctx;
  const name = splitName(lead.name);
  const contract = ctx.contracts[0] ?? null;
  const sent = sentContract(ctx.contracts);
  const call = salesRecording(ctx.recordings);
  switch (q.ref) {
    case REF.closer: {
      const f = choice(q, ctx.closer);
      return f.kind === "pick" ? f : { kind: "type", hint: "Pick your name." };
    }
    case REF.firstName:
      return copy(name.first);
    case REF.lastName:
      return copy(
        name.last,
        "The cockpit has one name only; ask for the family name.",
      );
    case REF.phone:
      return copy(lead.phone);
    case REF.rawPhone:
      return copy(rawPhone(lead.phone));
    case REF.email:
      return copy(lead.email);
    case REF.business:
      return copy(contract?.fields.company_name || lead.company);
    case REF.country:
      return choice(q, countryCode(lead));
    case REF.timezone: {
      const tz = timezoneFor(countryCode(lead), q.choices ?? []);
      return tz ? { kind: "pick", value: tz } : { kind: "type" };
    }
    case REF.leadSource: {
      const s = leadSourceFor(lead, q.choices ?? []);
      return s ? { kind: "pick", value: s } : { kind: "type" };
    }
    case REF.payment: {
      const f = choice(q, contract?.fields.payment_structure);
      return f.kind === "pick"
        ? f
        : {
            kind: "type",
            hint: contract?.fields.payment_structure ?? undefined,
          };
    }
    case REF.agreement:
      return sent
        ? choice(q, "NA - Already Sent")
        : {
            kind: "type",
            hint: "Send the contract from the Contract card first, then pick NA - Already Sent.",
          };
    case REF.adSpend:
      return copy(
        contract?.fields.daily_ad_spend != null
          ? String(contract.fields.daily_ad_spend)
          : null,
      );
    case REF.fathom:
      return copy(
        call?.share_url,
        "No recorded sales call is linked to this lead yet.",
      );
    case REF.transcript:
      return call?.transcript_path
        ? {
            kind: "transcript",
            path: call.transcript_path,
            chars: call.transcript_chars ?? null,
          }
        : { kind: "type", hint: "No transcript came with the call." };
    default:
      return { kind: "type" };
  }
}

/** The list beside the form: its screens and questions in order, each with what the cockpit knows. */
export function railFor(
  setting: ClientFormSetting | null,
  ctx: FormContext,
): RailScreen[] {
  return (setting?.screens ?? []).map(s => ({
    title: s.title,
    rows: s.questions.map(q => ({
      ref: q.ref,
      label: shortLabel(q.title),
      required: q.required,
      fill: fillFor(q, ctx),
    })),
  }));
}

/** How many answers the cockpit has ready, of how many questions. */
export function readyCount(rail: RailScreen[]): {
  ready: number;
  total: number;
} {
  const rows = rail.flatMap(s => s.rows);
  return {
    ready: rows.filter(r => r.fill.kind !== "type").length,
    total: rows.length,
  };
}
