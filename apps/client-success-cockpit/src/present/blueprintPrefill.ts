/**
 * What the Brand Blueprint already knows before the call (docs/brand-
 * blueprint/SPEC.md 1.5): the kickoff, the onboarding form, the client
 * card and the onboarding deck's prep, read per question. Pure. Each
 * suggestion carries its source and date and a kind: P prefilled (confirm
 * with one tap), S a summary of the client's own words (accept or type
 * over), D a seeded default the creative director confirms. A suggestion is
 * never an answer: only what is confirmed is saved, and only a saved answer
 * reaches a slide.
 *
 * The forms are read by their question refs (Typeform's prefixes, as the
 * maps list them) and, where an older answer was filed under its title
 * only, by the question's words.
 */

import {
  type Answers,
  type BpKey,
  type BpService,
  isDriveFolder,
} from "./blueprintForm";
import { type MainKey, serviceOfText } from "./services";

export interface FormLike {
  submitted_at?: string | null;
  answers?: {
    ref?: string | null;
    title?: string | null;
    value?: string | null;
  }[];
}

export interface PrefillInput {
  forms: { onboarding?: FormLike | null; kickoff?: FormLike | null } | null;
  /** handover.daily_budget from the card (USD a day). */
  cardBudget?: number | null;
  /** The onboarding deck's prep (service_focus, service_chosen_at, red_lines). */
  onboardingPrep: Record<string, unknown>;
  /** The card's Do's & Don'ts, split as the decks split them. */
  dosDonts: { do: string[]; dont: string[] };
  /** The creative card's fields (labels). */
  card: { templatedAds?: string | null; canSelfRecord?: string | null } | null;
  /** The starter packs in Settings, by service. */
  packs: Partial<Record<string, string | null>>;
  lang: "en" | "ar";
}

export type PrefillKind = "P" | "S" | "D";
export interface Prefill {
  value: unknown;
  /** The source as the save records it (`from`). */
  from: string;
  /** The source as the notes and prep say it. */
  source: string;
  /** When the source was filled (an ISO date), when known. */
  date: string | null;
  kind: PrefillKind;
  /** A summary's whole text, for "Show all". */
  full?: string;
  /** A line for the creative director (a budget to confirm in dollars). */
  note?: string;
}

export interface PrefillOut {
  values: Partial<Record<BpKey, Prefill>>;
  /** The kickoff named two services: slide 4 asks which goes first. */
  twoServices: MainKey[] | null;
  /** A kickoff is on record. */
  kickoff: boolean;
  /** Notes for the creative director (said in the notes window and prep). */
  notes: string[];
  /** The free first step's suggestion for 3.1 (S), shown in notes 9. */
  firstStep: string | null;
  /** The client's content links (2.16), opened from notes 12. */
  contentLinks: string[];
}

// ------------------------------------------------------------- reading

/** A form's question refs, by the prefixes in docs/brand-blueprint/form-map.md. */
const REF = {
  kickoff: {
    service: (r: string) => /^c0000001/.test(r) && /0007$/.test(r),
    consult: (r: string) => /^c0000001/.test(r) && /0008$/.test(r),
    templated: (r: string) => r.startsWith("eb7ed18c"),
    budget: (r: string) => r.startsWith("cf53482c"),
    facebook: (r: string) => r.startsWith("6fcbd33c"),
    platforms: (r: string) => r.startsWith("7d16afbb"),
    adAccount: (r: string) => r.startsWith("e4b9dbd3"),
    page: (r: string) => r.startsWith("940f494c"),
    funded: (r: string) => r.startsWith("8bee68fc"),
    content: (r: string) => r.startsWith("3418ef58"),
  },
  onboarding: {
    numberOne: (r: string) => r.startsWith("6271b610"),
    ideal: (r: string) => r.startsWith("6c819933"),
    services: (r: string) => r.startsWith("d976036f"),
    payment: (r: string) => r.startsWith("ee25f923"),
    freeConsult: (r: string) => r.startsWith("ec89854f"),
    appointments: (r: string) => r.startsWith("b370341c"),
    drive: (r: string) => r.startsWith("64d23c81"),
  },
};

/** The same questions by their words, for answers filed under a title. */
const TITLE = {
  kickoff: {
    service: /which service are we advertising/i,
    templated: /templated ads status/i,
    budget: /daily budget/i,
    facebook: /^facebook access|facebook access status/i,
    platforms: /which platforms|platforms will we advertise/i,
    adAccount: /ad account/i,
    page: /name of the facebook page/i,
    funded: /card linked|card with funds|linked with funds/i,
    consult: /consultation types|types of consultation/i,
    content: /content links|existing content/i,
  },
  onboarding: {
    numberOne: /#1 service|service you want to grow|focus on scaling/i,
    ideal: /ideal project/i,
    services: /what services do you offer/i,
    payment: /payment options|installments|down payment/i,
    freeConsult: /free consultations?/i,
    appointments: /types of appointments/i,
    drive: /google drive|drive link|drive folder/i,
  },
};

const EMPTY = /^(?:-|n\/?a|none|no answer|null|undefined)$/i;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() && !EMPTY.test(v.trim()) ? v.trim() : null;

function read(
  form: FormLike | null | undefined,
  ref: (r: string) => boolean,
  title: RegExp,
): string | null {
  const answers = form?.answers ?? [];
  const byRef = answers.find(a => a.ref && ref(String(a.ref)));
  const hit = byRef ?? answers.find(a => title.test(String(a.title ?? "")));
  return str(hit?.value);
}

const dayOf = (form: FormLike | null | undefined) =>
  typeof form?.submitted_at === "string"
    ? form.submitted_at.slice(0, 10)
    : null;

// ------------------------------------------------------------- budget

const OTHER_CURRENCY =
  /\b(?:KWD|KD|SAR|SR|AED|QAR|BHD|OMR|EUR|GBP)\b|دينار|ريال|درهم|جنيه|يورو/i;
const RANGE =
  /\d\s*(?:-|–|to|إلى|الى|لين|لـ|ل)\s*\d|[٠-٩]\s*(?:-|–|إلى|الى|لين)\s*[٠-٩]/i;

/** Latin digits for Arabic-Indic and Persian ones. */
export function latinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * The kickoff's daily figure as dollars (SPEC 1.5): the first number in
 * the text ("$40 a day", "40 دولار", "٤٠"). A range or another currency
 * gives no number; the text is always kept as `said`.
 */
export function parseBudget(
  said: string | null,
): { usd: number | null; said: string } | null {
  const s = str(said);
  if (!s) return null;
  const latin = latinDigits(s).replace(/(\d),(?=\d{3}\b)/g, "$1");
  if (OTHER_CURRENCY.test(latin) || RANGE.test(latin))
    return { usd: null, said: s };
  const m = latin.match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : Number.NaN;
  return { usd: n >= 1 && n <= 100_000 ? n : null, said: s };
}

// ------------------------------------------------------------- summaries

/**
 * A summary of the client's words (SPEC 1.5): cut to about 160 characters
 * on a whole word, deterministic; Arabic is kept as typed.
 */
export function summary(text: string, max = 160): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : s.slice(0, max)).replace(/[,.;:،\s]+$/, "")}…`;
}

/** A form's lines, one item each ("1. Villa interiors", "- Kitchens"). */
function itemLines(text: string): string[] {
  return text
    .split(/\n+|;\s*/)
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

// ------------------------------------------------------------- mappings

/** Templated Ads Status (the kickoff's and the card's) to 1.3 and 1.5. */
function templated(v: string | null): "approved" | "declined" | "see" | null {
  if (!v) return null;
  if (/declin/i.test(v)) return "declined";
  if (/see them first|wants to see/i.test(v)) return "see";
  if (/^approved\b/i.test(v)) return "approved";
  return null;
}

/** Facebook Access Status to 1.8. */
function identityOf(v: string | null): "their_page" | "our_page" | null {
  if (!v) return null;
  if (/using ours|our page|ours\b/i.test(v)) return "our_page";
  if (/access confirmed|their page/i.test(v)) return "their_page";
  return null;
}

/** Can Self-Record? (the card's four) to 2.15. */
function cameraOf(v: string | null | undefined): string | null {
  const s = str(v);
  if (!s) return null;
  if (/studio|cameraman/i.test(s)) return "yes_studio";
  if (/phone/i.test(s)) return "yes_phone";
  if (/^unsure|not sure/i.test(s)) return "unsure";
  if (/^no\b/i.test(s)) return "no";
  return null;
}

/** The kickoff's service answer, split into the five (multi-select). */
export function servicesOf(text: string | null): MainKey[] {
  if (!text) return [];
  const out: MainKey[] = [];
  for (const part of text.split(/,|\n|،| and (?=[A-Z])/)) {
    const k = serviceOfText(part);
    if (k && !out.includes(k)) out.push(k);
  }
  if (!out.length) {
    const k = serviceOfText(text);
    if (k) out.push(k);
  }
  return out;
}

// ------------------------------------------------------------- the prefill

const LABEL = {
  kickoff: "The kickoff",
  onboarding: "The onboarding form",
  deck: "The onboarding deck",
  card: "The client card",
  settings: "Settings",
  default: "Starter first: confirm with them",
};

export function blueprintPrefill(input: PrefillInput): PrefillOut {
  const kick = input.forms?.kickoff ?? null;
  const form = input.forms?.onboarding ?? null;
  const kDay = dayOf(kick);
  const oDay = dayOf(form);
  const values: Partial<Record<BpKey, Prefill>> = {};
  const notes: string[] = [];
  const K = (key: keyof typeof REF.kickoff) =>
    read(kick, REF.kickoff[key], TITLE.kickoff[key]);
  const O = (key: keyof typeof REF.onboarding) =>
    read(form, REF.onboarding[key], TITLE.onboarding[key]);
  const put = (
    key: BpKey,
    value: unknown,
    from: string,
    source: string,
    date: string | null,
    kind: PrefillKind,
    extra: Partial<Prefill> = {},
  ) => {
    values[key] = { value, from, source, date, kind, ...extra };
  };

  // 1.1 The service: the kickoff, then the onboarding deck's choice, then
  // the onboarding form's #1 service.
  let twoServices: MainKey[] | null = null;
  const kickServices = servicesOf(K("service"));
  if (kickServices.length === 1)
    put("service", kickServices[0], "kickoff", LABEL.kickoff, kDay, "P");
  else if (kickServices.length > 1) twoServices = kickServices.slice(0, 2);
  else {
    const prep = input.onboardingPrep;
    const chosen = str(prep.service_chosen_at);
    const focus = serviceOfText(str(prep.service_focus));
    const one = serviceOfText(O("numberOne"));
    if (focus && chosen)
      put(
        "service",
        focus,
        "deck.service",
        LABEL.deck,
        chosen.slice(0, 10),
        "P",
      );
    else if (one)
      put("service", one, "onboarding.service", LABEL.onboarding, oDay, "P");
  }

  // 1.3 and 1.5: Templated Ads Status.
  const status = templated(K("templated") ?? str(input.card?.templatedAds));
  if (status === "approved") {
    put("starter", "yes", "kickoff.templated", LABEL.kickoff, kDay, "P");
    put(
      "pack_approval",
      "before",
      "kickoff.templated",
      LABEL.kickoff,
      kDay,
      "D",
    );
  } else if (status === "declined")
    put("starter", "no", "kickoff.templated", LABEL.kickoff, kDay, "P");
  else put("starter", "yes", "default", LABEL.default, null, "D");
  const starter = values.starter?.value;

  // 1.4 The pack for the service, from Settings.
  const service = (values.service?.value as BpService | undefined) ?? null;
  const pack = service ? str(input.packs[service]) : null;
  if (pack && isDriveFolder(pack))
    put("pack_url", pack, "settings.pack", LABEL.settings, null, "P");

  // 1.6 The daily figure: the kickoff's words, then the card's.
  const said = parseBudget(K("budget"));
  if (said?.usd)
    put(
      "daily_budget",
      { usd: said.usd, said: said.said },
      "kickoff",
      LABEL.kickoff,
      kDay,
      "P",
    );
  else if (input.cardBudget && input.cardBudget >= 1)
    put(
      "daily_budget",
      { usd: input.cardBudget, ...(said ? { said: said.said } : {}) },
      "card.budget",
      LABEL.card,
      null,
      "P",
      said
        ? { note: `The kickoff said ${said.said}: confirm it in dollars.` }
        : {},
    );
  if (said && !said.usd)
    notes.push(`The kickoff said ${said.said}: confirm it in dollars.`);

  // 1.7 Lead form when starter = yes.
  if (starter === "yes")
    put(
      "destination",
      "lead_form",
      "default",
      "Starter ads send people to a lead form",
      null,
      "D",
    );

  // 1.8 Publishing identity.
  const identity = identityOf(K("facebook"));
  if (identity)
    put("identity", identity, "kickoff.facebook", LABEL.kickoff, kDay, "P");

  // 1.9 Red lines: the onboarding deck's, else the card's DON'T lines.
  const prepLines = (
    input.lang === "ar" && Array.isArray(input.onboardingPrep.red_lines_ar)
      ? input.onboardingPrep.red_lines_ar
      : input.onboardingPrep.red_lines
  ) as unknown;
  const deckLines = Array.isArray(prepLines)
    ? prepLines.filter((x): x is string => typeof x === "string" && !!x.trim())
    : [];
  const red = (deckLines.length ? deckLines : input.dosDonts.dont).slice(0, 12);
  if (red.length)
    put(
      "red_lines",
      red,
      deckLines.length ? "deck.red_lines" : "card.dosdonts",
      deckLines.length ? "Your onboarding call" : LABEL.card,
      null,
      "S",
    );

  // 2.1, 2.5, 2.8: the onboarding form's own words, summarised.
  const sum = (key: BpKey, text: string | null, from: string) => {
    if (!text) return;
    const short = summary(text);
    put(
      key,
      short,
      from,
      LABEL.onboarding,
      oDay,
      "S",
      short !== text ? { full: text } : {},
    );
  };
  sum("best_client", O("ideal"), "onboarding.ideal");
  sum("pricing", O("services"), "onboarding.services");
  sum("terms", O("payment"), "onboarding.payment");

  // 2.12 Approval: first batch when the kickoff wanted to see them first.
  if (status === "see")
    put(
      "approval",
      "first_batch",
      "kickoff.templated",
      LABEL.kickoff,
      kDay,
      "D",
    );

  // 2.14 Rules: the red lines under never, the card's DO lines under always.
  const always = input.dosDonts.do.slice(0, 12);
  if (red.length || always.length)
    put(
      "rules",
      {
        ...(always.length ? { always } : {}),
        ...(red.length ? { never: red } : {}),
      },
      "card.dosdonts",
      "The red lines and the card's Do's",
      null,
      "S",
    );

  // 2.15 Camera: the card's Can Self-Record?.
  const camera = cameraOf(input.card?.canSelfRecord);
  if (camera) put("camera", camera, "card.self_record", LABEL.card, null, "D");

  // 3.1's free first step, a suggestion in notes 9.
  const free = O("freeConsult");
  const appts = O("appointments");
  const firstStep =
    [free, appts ? `Appointments: ${appts}` : null]
      .filter(Boolean)
      .join(". ") || null;

  const contentLinks = [K("content"), O("drive")]
    .flatMap(v => (v ? (v.match(/https?:\/\/\S+/g) ?? []) : []))
    .slice(0, 6);

  if (!kick)
    notes.push("No kickoff on record: ask the service and the budget.");
  if (twoServices)
    notes.push(
      "The kickoff named two services: ask which one goes first on slide 4.",
    );

  return {
    values,
    twoServices,
    kickoff: Boolean(kick),
    notes,
    firstStep,
    contentLinks,
  };
}

/** Every P and D suggestion, for prep's "Confirm part 1" (ticked by default). */
export function part1Suggestions(
  p: PrefillOut,
  answers: Answers,
): { key: BpKey; prefill: Prefill }[] {
  const keys: BpKey[] = [
    "service",
    "starter",
    "pack_url",
    "pack_approval",
    "daily_budget",
    "destination",
    "identity",
    "red_lines",
  ];
  return keys
    .map(key => ({ key, prefill: p.values[key] }))
    .filter(
      (x): x is { key: BpKey; prefill: Prefill } =>
        Boolean(x.prefill) && answers[x.key] === undefined,
    );
}

/** The kickoff facts the brief carries (SPEC 1.2 AUTO), for "What media gets". */
export function kickoffFacts(forms: PrefillInput["forms"]) {
  const kick = forms?.kickoff ?? null;
  const K = (key: keyof typeof REF.kickoff) =>
    read(kick, REF.kickoff[key], TITLE.kickoff[key]);
  return {
    budgetSaid: K("budget"),
    platforms: K("platforms"),
    adAccount: K("adAccount"),
    pageName: K("page"),
    cardFunded: K("funded"),
    consultTypes: K("consult"),
    templatedStatus: K("templated"),
    facebookAccess: K("facebook"),
  };
}

export { itemLines };
