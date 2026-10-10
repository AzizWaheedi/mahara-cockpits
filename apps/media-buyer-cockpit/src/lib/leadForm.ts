/**
 * A Meta instant form as the cockpit edits it, and the two translations it
 * needs: from what the Graph API reads back, and into what a new form version
 * is created with. Shared by the browser (editor, preview, checks) and the
 * cockpit-media-api function (the same checks again before anything reaches
 * Meta), so a draft that passes here is the draft Meta is sent.
 *
 * Meta never edits a published form. A change is a new form on the Page,
 * then the campaign's ads are pointed at it; the old version is left as it
 * was, so switching back is always possible.
 */

export type QuestionOption = { key: string; value: string };

export type LeadFormQuestion = {
  /** Meta's field key; answers arrive under it, so keep it stable across versions. */
  key: string;
  /** FULL_NAME, PHONE, EMAIL, CUSTOM, ... (Meta's question types). */
  type: string;
  /** The question as the lead reads it. Custom questions only; Meta words the standard ones. */
  label?: string;
  /** Multiple choice answers. A custom question with none is a short answer. */
  options?: QuestionOption[];
};

export type LeadFormIntro = {
  title: string;
  style: "LIST_STYLE" | "PARAGRAPH_STYLE";
  /** Paragraph style uses the first item; list style shows each as a bullet. */
  content: string[];
  buttonText?: string;
};

export type ThankYouButton =
  | "VIEW_WEBSITE"
  | "CALL_BUSINESS"
  | "WHATSAPP"
  | "MESSAGE_BUSINESS"
  | "DOWNLOAD"
  | "NONE";

export type LeadFormThankYou = {
  title: string;
  body?: string;
  buttonType: ThankYouButton;
  buttonText?: string;
  websiteUrl?: string;
  phone?: string;
};

export type LeadFormSpec = {
  name: string;
  locale?: string;
  /** The line above the questions (question_page_custom_headline). */
  headline?: string;
  intro: LeadFormIntro | null;
  questions: LeadFormQuestion[];
  /** Meta's "Higher intent" form: a review screen the lead confirms before it submits. */
  higherIntent: boolean;
  /** The lead types a code Meta texts to their phone before the form submits. */
  smsVerify: boolean;
  privacy: { url: string; linkText?: string } | null;
  thankYou: LeadFormThankYou | null;
};

/** Question types Meta fills in from the person's profile before they type anything. */
export const AUTOFILLED = new Set([
  "FULL_NAME",
  "FIRST_NAME",
  "LAST_NAME",
  "EMAIL",
  "PHONE",
  "CITY",
  "STATE",
  "PROVINCE",
  "COUNTRY",
  "ZIP",
  "POST_CODE",
  "STREET_ADDRESS",
  "DOB",
  "GENDER",
  "JOB_TITLE",
  "COMPANY_NAME",
  "WORK_EMAIL",
  "WORK_PHONE_NUMBER",
  "WHATSAPP_NUMBER",
]);

/** The contact questions the editor offers, in the order a form usually asks them. */
export const CONTACT_TYPES: { type: string; label: string }[] = [
  { type: "FULL_NAME", label: "Full name" },
  { type: "PHONE", label: "Phone number" },
  { type: "EMAIL", label: "Email" },
  { type: "WHATSAPP_NUMBER", label: "WhatsApp number" },
  { type: "CITY", label: "City" },
  { type: "COMPANY_NAME", label: "Company name" },
  { type: "JOB_TITLE", label: "Job title" },
];

const TYPE_LABEL: Record<string, string> = {
  FULL_NAME: "Full name",
  FIRST_NAME: "First name",
  LAST_NAME: "Last name",
  EMAIL: "Email",
  PHONE: "Phone number",
  PHONE_OTP: "Phone number (verified by code)",
  WHATSAPP_NUMBER: "WhatsApp number",
  CITY: "City",
  STATE: "State",
  PROVINCE: "Province",
  COUNTRY: "Country",
  ZIP: "ZIP code",
  POST_CODE: "Post code",
  STREET_ADDRESS: "Street address",
  COMPANY_NAME: "Company name",
  JOB_TITLE: "Job title",
  WORK_EMAIL: "Work email",
  WORK_PHONE_NUMBER: "Work phone number",
  DOB: "Date of birth",
  GENDER: "Gender",
  DATE_TIME: "Pick a date and time",
};

/** How a question reads in the cockpit: its own words, or Meta's name for a standard one. */
export function questionLabel(q: LeadFormQuestion): string {
  if (q.label?.trim()) return q.label.trim();
  return TYPE_LABEL[q.type] ?? sentence(q.type);
}

function sentence(type: string): string {
  const s = type.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A custom question is the only kind that can filter a lead. */
export function isFiltering(q: LeadFormQuestion): boolean {
  return q.type === "CUSTOM";
}

export function filteringCount(spec: Pick<LeadFormSpec, "questions">): number {
  return spec.questions.filter(isFiltering).length;
}

/** How much effort the form asks before a lead counts, for the friction line. */
export function frictionSteps(spec: LeadFormSpec): string[] {
  const steps: string[] = [];
  if (spec.intro) steps.push("Greeting");
  const filtering = filteringCount(spec);
  if (filtering)
    steps.push(`${filtering} filtering question${filtering === 1 ? "" : "s"}`);
  if (spec.higherIntent) steps.push("Review step");
  if (spec.smsVerify) steps.push("SMS code");
  return steps;
}

// -- Reading what the Graph API returns ---------------------------------

type Raw = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function list(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  // Some edges wrap lists as { data: [...] }.
  if (v && typeof v === "object" && Array.isArray((v as Raw).data))
    return (v as Raw).data as unknown[];
  return [];
}

const BUTTONS = new Set<ThankYouButton>([
  "VIEW_WEBSITE",
  "CALL_BUSINESS",
  "WHATSAPP",
  "MESSAGE_BUSINESS",
  "DOWNLOAD",
  "NONE",
]);

/**
 * A form as the cockpit edits it, from a Graph API read of the form node
 * (fields: name, locale, questions, context_card, thank_you_page,
 * legal_content, privacy_policy_url, is_optimized_for_quality,
 * question_page_custom_headline). Anything Meta leaves out reads as off.
 */
export function fromMeta(raw: Raw): LeadFormSpec {
  const questions: LeadFormQuestion[] = list(raw.questions).map((q, i) => {
    const r = (q ?? {}) as Raw;
    const options = list(r.options)
      .map((o, j) => {
        const ro = (o ?? {}) as Raw;
        const value = str(ro.value) ?? str(ro.key) ?? "";
        return { key: str(ro.key) ?? `option_${j + 1}`, value };
      })
      .filter(o => o.value);
    return {
      key: str(r.key) ?? `question_${i + 1}`,
      type: str(r.type) ?? "CUSTOM",
      ...(str(r.label) ? { label: str(r.label) } : {}),
      ...(options.length ? { options } : {}),
    };
  });

  const card = raw.context_card as Raw | undefined;
  const intro: LeadFormIntro | null =
    card && (str(card.title) || list(card.content).length)
      ? {
          title: str(card.title) ?? "",
          style: card.style === "LIST_STYLE" ? "LIST_STYLE" : "PARAGRAPH_STYLE",
          content: list(card.content).map(c => String(c ?? "")),
          ...(str(card.button_text)
            ? { buttonText: str(card.button_text) }
            : {}),
        }
      : null;

  const ty = raw.thank_you_page as Raw | undefined;
  const buttonType = str(ty?.button_type) as ThankYouButton | undefined;
  const thankYou: LeadFormThankYou | null =
    ty && str(ty.title)
      ? {
          title: str(ty.title) ?? "",
          ...(str(ty.body) ? { body: str(ty.body) } : {}),
          buttonType:
            buttonType && BUTTONS.has(buttonType) ? buttonType : "NONE",
          ...(str(ty.button_text) ? { buttonText: str(ty.button_text) } : {}),
          ...(str(ty.website_url) ? { websiteUrl: str(ty.website_url) } : {}),
          ...(str(ty.business_phone_number)
            ? { phone: str(ty.business_phone_number) }
            : {}),
        }
      : null;

  const legal = raw.legal_content as Raw | undefined;
  const policy = legal?.privacy_policy as Raw | undefined;
  const privacyUrl = str(policy?.url) ?? str(raw.privacy_policy_url);

  return {
    name: str(raw.name) ?? "Instant form",
    ...(str(raw.locale) ? { locale: str(raw.locale) } : {}),
    ...(str(raw.question_page_custom_headline)
      ? { headline: str(raw.question_page_custom_headline) }
      : {}),
    intro,
    questions,
    higherIntent: raw.is_optimized_for_quality === true,
    smsVerify:
      raw.is_phone_sms_verify_enabled === true ||
      questions.some(q => q.type === "PHONE_OTP"),
    privacy: privacyUrl
      ? {
          url: privacyUrl,
          ...(str(policy?.link_text)
            ? { linkText: str(policy?.link_text) }
            : {}),
        }
      : null,
    thankYou,
  };
}

// -- Checks before publishing --------------------------------------------

export type Problem = { where: string; message: string };

const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

/**
 * Everything wrong with a draft, as sentences the editor shows next to the
 * field. Lengths Meta enforces itself are left to Meta, so a form Meta took
 * before is never refused here; this catches what would publish broken.
 */
export function problems(spec: LeadFormSpec): Problem[] {
  const out: Problem[] = [];
  if (!spec.name.trim())
    out.push({ where: "name", message: "Give the form a name." });
  if (!spec.questions.length)
    out.push({ where: "questions", message: "Ask at least one question." });
  if (!spec.questions.some(q => q.type !== "CUSTOM"))
    out.push({
      where: "questions",
      message:
        "Ask for at least one way to reach the lead: a name, a phone number or an email.",
    });
  const keys = new Set<string>();
  spec.questions.forEach((q, i) => {
    const where = `questions.${i}`;
    if (keys.has(q.key))
      out.push({ where, message: "Two questions share the same key." });
    keys.add(q.key);
    if (q.type === "CUSTOM") {
      if (!q.label?.trim()) out.push({ where, message: "Write the question." });
      if (q.options && q.options.length === 1)
        out.push({
          where,
          message:
            "A multiple choice question needs two answers or more. Remove the last answer to make it a short answer.",
        });
      if (q.options?.some(o => !o.value.trim()))
        out.push({ where, message: "Fill in or remove the empty answer." });
      const values = new Set<string>();
      for (const o of q.options ?? []) {
        const v = o.value.trim().toLowerCase();
        if (v && values.has(v))
          out.push({ where, message: "Two answers say the same thing." });
        values.add(v);
      }
    }
  });
  if (spec.smsVerify && !spec.questions.some(q => q.type === "PHONE"))
    out.push({
      where: "smsVerify",
      message: "SMS verification needs the phone number question.",
    });
  if (spec.intro) {
    if (!spec.intro.title.trim())
      out.push({ where: "intro", message: "Give the greeting a headline." });
    if (!spec.intro.content.some(c => c.trim()))
      out.push({ where: "intro", message: "Write at least one line." });
  }
  // Optional: the team's forms were made without one and Meta took them.
  // A link that is there must work, because Meta shows it on every form.
  if (spec.privacy?.url?.trim() && !URL_RE.test(spec.privacy.url.trim()))
    out.push({
      where: "privacy",
      message: "The privacy policy link has to start with https://.",
    });
  if (spec.thankYou) {
    const t = spec.thankYou;
    if (!t.title.trim())
      out.push({
        where: "thankYou",
        message: "Give the thank-you screen a headline.",
      });
    if (
      (t.buttonType === "VIEW_WEBSITE" || t.buttonType === "DOWNLOAD") &&
      !(t.websiteUrl && URL_RE.test(t.websiteUrl))
    )
      out.push({
        where: "thankYou",
        message: "The button needs a link starting with https://.",
      });
    if (
      (t.buttonType === "CALL_BUSINESS" || t.buttonType === "WHATSAPP") &&
      !/^\+?[0-9][0-9\s-]{6,}$/.test(t.phone ?? "")
    )
      out.push({
        where: "thankYou",
        message: "The button needs the client's number with its country code.",
      });
  }
  return out;
}

// -- Writing a new version -------------------------------------------------

/**
 * The body for POST /{page-id}/leadgen_forms, every object JSON-encoded the
 * way the Graph API takes form parameters. Question keys carry over, so the
 * client's sheets and the CRM keep receiving answers under the same names.
 */
export function toMetaCreate(spec: LeadFormSpec): Record<string, string> {
  const questions = spec.questions.map(q =>
    q.type === "CUSTOM"
      ? {
          type: "CUSTOM",
          key: q.key,
          label: (q.label ?? "").trim(),
          ...(q.options?.length
            ? {
                options: q.options.map(o => ({
                  key: o.key,
                  value: o.value.trim(),
                })),
              }
            : {}),
        }
      : { type: q.type, key: q.key },
  );
  const body: Record<string, string> = {
    name: spec.name.trim(),
    questions: JSON.stringify(questions),
    is_optimized_for_quality: String(spec.higherIntent),
    block_display_for_non_targeted_viewer: "true",
  };
  if (spec.smsVerify) body.is_phone_sms_verify_enabled = "true";
  if (spec.locale) body.locale = spec.locale;
  if (spec.headline?.trim())
    body.question_page_custom_headline = spec.headline.trim();
  if (spec.privacy?.url?.trim())
    body.privacy_policy = JSON.stringify({
      url: spec.privacy.url.trim(),
      ...(spec.privacy.linkText?.trim()
        ? { link_text: spec.privacy.linkText.trim() }
        : {}),
    });
  if (spec.intro)
    body.context_card = JSON.stringify({
      title: spec.intro.title.trim(),
      style: spec.intro.style,
      content: spec.intro.content.map(c => c.trim()).filter(Boolean),
      ...(spec.intro.buttonText?.trim()
        ? { button_text: spec.intro.buttonText.trim() }
        : {}),
    });
  if (spec.thankYou) {
    const t = spec.thankYou;
    body.thank_you_page = JSON.stringify({
      title: t.title.trim(),
      body: t.body?.trim() ?? "",
      button_type: t.buttonType,
      ...(t.buttonText?.trim() ? { button_text: t.buttonText.trim() } : {}),
      ...(t.buttonType === "VIEW_WEBSITE" || t.buttonType === "DOWNLOAD"
        ? { website_url: t.websiteUrl?.trim() }
        : {}),
      ...(t.buttonType === "CALL_BUSINESS" || t.buttonType === "WHATSAPP"
        ? { business_phone_number: t.phone?.replace(/[\s-]/g, "") }
        : {}),
    });
  }
  return body;
}

/**
 * A name for the next version that still reads as the same form in Ads
 * Manager, with the Kuwait time so two versions on one day never share a
 * name (Meta refuses a second form with a name already on the Page).
 */
export function versionName(base: string, at: Date, n: number): string {
  const stem = base.replace(/\s+·\s+v\d+.*$/, "").trim() || "Instant form";
  const kuwait = new Date(at.getTime() + 3 * 3600 * 1000).toISOString();
  return `${stem} · v${n} · ${kuwait.slice(0, 10)} ${kuwait.slice(11, 16)}`;
}

/** A fresh key for a question added in the cockpit, unique within the form. */
export function newKey(
  spec: Pick<LeadFormSpec, "questions">,
  stem = "question",
): string {
  const taken = new Set(spec.questions.map(q => q.key));
  for (let i = 1; ; i++) {
    const key = `${stem}_${i}`;
    if (!taken.has(key)) return key;
  }
}
