import {
  FORMS,
  type FormEntry,
  type LinkKey,
  type OnboardingRow,
} from "@/lib/onboardingCore";

/**
 * The hidden fields a form carries, built from the client's record (docs/
 * csm-forms/KICKOFF.md 2.1 and 2.2). The client ID is always the record's
 * card ID; everything else comes from the client's newest completed
 * onboarding response, with the card's own Make-built link read only to
 * fill a gap or to undo the mirror's 4,000-character cut. The card link is
 * otherwise a cross-check: a difference is a note, never a block. No I/O and
 * no React, so scripts/form-prefill.test.ts pins it.
 */

/** Where every public form link points (the account's own Typeform host). */
export const TYPEFORM_HOST = "https://maharamedia.typeform.com";

/** The mirror keeps 4,000 characters of an answer (onboardingCore formEntry). */
export const MIRROR_CUT = 4000;

/** Above this, a link may be too long for a browser on the way in. */
export const LONG_LINK = 4000;

export type PrefillSource =
  | "record"
  | "onboarding form"
  | "card link"
  | "card name";

export interface Prefill {
  /** The hidden values that go into the form; empty values are left out. */
  values: Record<string, string>;
  /** Where each value came from. */
  from: Record<string, PrefillSource>;
  /** Plain sentences for the panel. */
  notes: string[];
  /** Said in the panel's "Onboarding answers" row when there are none. */
  noOnboarding: string | null;
  /** The length of the whole public link these values make. */
  linkChars: number;
  /** The newest completed onboarding response, when there is one. */
  onboarding: FormEntry | null;
  /** A link the CSM can send the client instead (no onboarding answers yet). */
  copy?: { label: string; value: string; done: string };
}

export interface HiddenSpec {
  key: string;
  /** The onboarding form's question ref, or null for the client ID. */
  ref: string | null;
  /** How the CSM reads it in the panel. */
  label: string;
}

/** The onboarding form's question refs (KFRCXPFx), as Make 13 maps them. */
export const ONB = {
  businessName: "514bfd3f-4ca1-469e-b9e7-87656503f65c",
  email: "7994f0d2-baeb-451b-983a-816290873a68",
  phone: "64f2fb80-b074-4017-b8b7-b7d549947e52",
  address: "e5caee43-e9b5-427d-8583-6982c5dd9be8",
  maps: "f7f9f2eb-1761-4c28-83ed-a53621c2cf88",
  instagram: "adecfe45-5d55-4319-98ff-3761e04bfc9b",
  website: "454a425f-2ac6-4d94-92db-cec08618600e",
  facebook: "575d17ed-e26d-4e55-87d3-7cb31cb71939",
  booking: "7a120dbb-0169-4bcc-9193-5c525a470d02",
  hours: "b7873d40-d154-42ac-bf24-cb3b667e84cc",
  consultants: "0a80a0a8-3a09-4907-a1d1-6c57e57d4c47",
  serviceFocus: "6271b610-6946-4056-bb08-d03ffc274141",
  consultationTypes: "b370341c-6ea3-43c9-bd8c-16e278a2d2d5",
  paymentOptions: "ee25f923-d5e1-4d1a-a95f-cd9c17abbe83",
  lastRevenue: "7ff5d37a-df7f-4002-8248-d0b4af6c28e8",
  goal90: "791b99b8-c7e9-40a4-96d6-868399e1ae97",
  goal12: "f4b96a9b-bd7c-4398-98b4-6a28a7d3595a",
  marketing: "bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6",
  challenges: "fcf43e6a-cc84-4ae7-9cef-2336069d0280",
  why: "7426c6c5-344f-44c9-9999-3b9daf3a06b8",
  notes: "41d2d5bb-b023-4fa4-906c-72aeef7a5e46",
  drive: "64d23c81-1784-4f07-8356-107af764fc95",
  /** Read by the side panel only, never sent as a hidden field. */
  services: "d976036f-6c2e-4d5d-999a-64cf9bb2ef02",
  areas: "fa017616-3fb5-4e64-9fbd-39cea6e26c47",
  facebookAccess: "ddf2767d-5725-4df2-b200-f0aab77a2db5",
  appointmentLength: "a20cfc1a-0228-413d-80ab-d97fc97574e0",
} as const;

/** The kickoff's 23 hidden fields (tG7dnxBn), in the form's own order. */
export const KICKOFF_HIDDEN: readonly HiddenSpec[] = [
  { key: "onboarding_client_id", ref: null, label: "Client ID" },
  { key: "legal_name", ref: ONB.businessName, label: "Business name" },
  { key: "email", ref: ONB.email, label: "Email" },
  { key: "phone", ref: ONB.phone, label: "Phone" },
  { key: "address", ref: ONB.address, label: "Address" },
  { key: "maps_link", ref: ONB.maps, label: "Google Maps link" },
  { key: "instagram", ref: ONB.instagram, label: "Instagram" },
  { key: "website", ref: ONB.website, label: "Website" },
  { key: "facebook", ref: ONB.facebook, label: "Facebook page" },
  { key: "booking_platform", ref: ONB.booking, label: "Booking software" },
  { key: "hours", ref: ONB.hours, label: "Business hours" },
  {
    key: "consultants",
    ref: ONB.consultants,
    label: "Who gives consultations",
  },
  {
    key: "service_focus",
    ref: ONB.serviceFocus,
    label: "Service to grow first",
  },
  {
    key: "consultation_types",
    ref: ONB.consultationTypes,
    label: "Appointment types",
  },
  { key: "payment_options", ref: ONB.paymentOptions, label: "Payment options" },
  { key: "last_revenue", ref: ONB.lastRevenue, label: "Revenue last year" },
  { key: "goal_90d", ref: ONB.goal90, label: "90-day goal" },
  { key: "goal_12_24", ref: ONB.goal12, label: "12 to 24-month goal" },
  { key: "marketing_tried", ref: ONB.marketing, label: "Marketing tried" },
  { key: "challenges", ref: ONB.challenges, label: "Top challenges" },
  { key: "why_joined", ref: ONB.why, label: "Why they joined" },
  { key: "client_notes", ref: ONB.notes, label: "Anything else" },
  { key: "content_drive", ref: ONB.drive, label: "Content Drive link" },
];

/** The newest completed onboarding response on record, or null. */
export function completedOnboarding(
  row: Pick<OnboardingRow, "forms">,
): FormEntry | null {
  const e = row.forms?.onboarding;
  if (!e || e.form_id !== FORMS.onboarding || !e.submitted_at) return null;
  return e;
}

/** One answer as the mirror stores it, or null when the client left it blank. */
export function answerOf(
  entry: FormEntry | null | undefined,
  ref: string,
): string | null {
  const a = entry?.answers.find(x => x.ref === ref);
  return a && a.value.trim() !== "" ? a.value : null;
}

/** A public form link: its form ID and the hidden values in its hash. */
export function parseFormLink(
  url: string | null | undefined,
): { formId: string; hidden: Record<string, string> } | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !/(^|\.)typeform\.com$/i.test(u.hostname))
    return null;
  const m = /^\/to\/([A-Za-z0-9]+)\/?$/.exec(u.pathname);
  if (!m) return null;
  const hidden: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(u.hash.replace(/^#/, "")))
    hidden[k] = v;
  return { formId: m[1], hidden };
}

export interface CardLink {
  /** True only for this form's link, carrying this card's ID. */
  usable: boolean;
  values: Record<string, string>;
  /** Why a link on the card is not used; null when it is, or there is none. */
  problem: string | null;
}

/** The card's own Make-built link for this form, read only when it is this card's. */
export function readCardLink(
  row: Pick<OnboardingRow, "links" | "clickup_task_id">,
  opts: { linkKey: LinkKey; formId: string; idField: string; title: string },
): CardLink {
  const raw = row.links?.[opts.linkKey];
  if (!raw) return { usable: false, values: {}, problem: null };
  const name = opts.title.toLowerCase();
  const parsed = parseFormLink(raw);
  if (!parsed || parsed.formId !== opts.formId)
    return {
      usable: false,
      values: {},
      problem: `The card's ${name} link is for another form, so it is not used.`,
    };
  if (parsed.hidden[opts.idField] !== row.clickup_task_id)
    return {
      usable: false,
      values: {},
      problem: `The card's ${name} link carries another card's ID, so it is out of date and not used.`,
    };
  return { usable: true, values: parsed.hidden, problem: null };
}

const norm = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*,[ \t]*/g, ", ")
    .trim();

/**
 * Two values the same once Make's "," joins read as the mirror's ", " and a
 * blank reads as "0" (Make writes a blank for a revenue of 0).
 */
export function sameValue(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const x = norm(a ?? "");
  const y = norm(b ?? "");
  if (x === y) return true;
  const zero = (v: string) => v === "" || v === "0";
  return zero(x) && zero(y);
}

/** The public link with these hidden values. Never joined by hand: a phone's + goes out as %2B. */
export function formLink(formId: string, values: Record<string, string>) {
  const hash = new URLSearchParams(
    Object.entries(values).filter(([, v]) => v !== ""),
  ).toString();
  return `${TYPEFORM_HOST}/to/${formId}${hash ? `#${hash}` : ""}`;
}

/** The hidden object in one canonical text: keys sorted, values as sent. */
export function canonicalHidden(values: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(values)
      .sort()
      .map(k => [k, values[k]]),
  );
}

/** SHA-256 of the canonical hidden object, as lowercase hex. */
export async function hiddenSha256(
  values: Record<string, string>,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalHidden(values));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The hidden fields for one form, from the record (rules 1 to 6 of
 * KICKOFF.md 2.2). `nameKey` is the field that falls back to the card name,
 * so Make's task names and the Blueprint link are never blank.
 */
export function buildHidden(
  row: OnboardingRow,
  opts: {
    spec: readonly HiddenSpec[];
    formId: string;
    idField: string;
    linkKey: LinkKey;
    title: string;
    nameKey?: string;
    /** The client's own onboarding form link, offered when they have not filled it. */
    onboardingLink?: string;
  },
): Prefill {
  const values: Record<string, string> = {};
  const from: Record<string, PrefillSource> = {};
  const notes: string[] = [];
  const put = (key: string, value: string | null, source: PrefillSource) => {
    if (value === null || value === "") return;
    values[key] = value;
    from[key] = source;
  };

  // 1. The ID is the record's, whatever any link says.
  put(opts.idField, row.clickup_task_id, "record");

  const onboarding = completedOnboarding(row);
  const link = readCardLink(row, opts);
  if (link.problem) notes.push(link.problem);

  let copy: Prefill["copy"];
  let noOnboarding: string | null = null;
  if (!onboarding) {
    // 5. No onboarding response: the ID and the name from the card only.
    if (opts.nameKey) put(opts.nameKey, row.client_name.trim(), "card name");
    noOnboarding = `${row.client_name} has not filled the onboarding form, so the ${opts.title.toLowerCase()} opens with their name and card only.`;
    if (opts.onboardingLink)
      copy = {
        label: "Copy their onboarding link",
        value: opts.onboardingLink,
        done: "Their onboarding link copied. Send it from WhatsApp.",
      };
  } else {
    for (const s of opts.spec) {
      if (s.key === opts.idField || !s.ref) continue;
      const mine = answerOf(onboarding, s.ref);
      const theirs = link.usable ? link.values[s.key] || null : null;
      if (mine !== null) {
        // 3. The mirror's cut: the card's longer value, when it starts with ours.
        const cut =
          mine.length === MIRROR_CUT &&
          theirs !== null &&
          theirs.length > mine.length &&
          theirs.startsWith(mine);
        put(s.key, cut ? theirs : mine, cut ? "card link" : "onboarding form");
        // Cut by the mirror, and no card link to undo it: said, not hidden.
        if (mine.length === MIRROR_CUT && !cut)
          notes.push(
            `Their "${s.label}" answer is longer than the cockpit keeps, so the form carries its first ${MIRROR_CUT.toLocaleString("en-US")} characters.`,
          );
      } else if (theirs !== null) {
        put(s.key, theirs, "card link");
      } else if (s.key === opts.nameKey) {
        put(s.key, row.client_name.trim(), "card name");
      }
    }
    // 4. The cross-check: a note, never a block.
    if (link.usable) {
      const differ = opts.spec.filter(
        s =>
          s.key !== opts.idField &&
          !sameValue(values[s.key], link.values[s.key]),
      ).length;
      if (differ)
        notes.push(
          `The card's ${opts.title.toLowerCase()} link differs on ${differ} field${differ === 1 ? "" : "s"}. The form uses their onboarding answers.`,
        );
    }
  }

  // 6. Length: nothing is cut, but a long link is said.
  const linkChars = formLink(opts.formId, values).length;
  if (linkChars > LONG_LINK)
    notes.push(
      "Their answers are long. If the form opens empty, use Open in Typeform.",
    );
  return { values, from, notes, noOnboarding, linkChars, onboarding, copy };
}

/** True when two hidden objects carry the same values. */
export function sameHidden(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  return canonicalHidden(a) === canonicalHidden(b);
}
