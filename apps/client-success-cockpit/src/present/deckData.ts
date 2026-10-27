import type { OfferDeckKind } from "./offer/kinds";
import { parseDosDonts } from "@/components/DosDonts";
import {
  type Answered,
  formAnswer,
  formAnswers,
  GOALS,
  KICKOFF,
  NAME_OPEN,
  SETUP,
  SETUP_DONE,
} from "@/lib/clientBrief";
import { serviceModel } from "@/lib/csmTemplates";
import type { FormEntry, OnboardingRow } from "@/lib/onboardingCore";
import {
  challengeLines,
  cleanAnswer,
  cut,
  EMPTY,
  type Held,
  heldReason,
  serviceChips,
} from "./clean";
import { type L, type Lang, LINKS, O } from "./content";
import { dayOf, gulfToday } from "./dates";
import { examplePick, type ServiceExample } from "./examples";
import {
  type LaunchBlueprint,
  type LaunchData,
  launchData,
} from "./launchData";
import {
  isMain,
  resolveService,
  type ServiceKey,
  type ServicePick,
  type ServiceRow,
  type ServiceSource,
  serviceNames,
  serviceRows,
} from "./services";
import type { DeckKind, DeckSources, DeckVideos, LaunchAd } from "./sources";
import type { VideoRead } from "./videos";

/**
 * One client's deck, every slot filled from its data with the fallbacks in
 * docs/csm-decks/CONTENT.md (the data map) and DESIGN.md section 14. Pure:
 * the same inputs give the same deck, so the fallbacks are tested
 * (scripts/deck-fallbacks.test.ts). Missing is never zero: an unknown
 * access status reads "Not checked yet", an unbooked call shows no date, a
 * client with no logo gets a monogram.
 */

export type Overrides = Record<string, unknown>;
export type AccessStatus = "done" | "todo" | "unchecked";
export type GoalKey = "goal90" | "goal12_24" | "challenges" | "why";
export type CallKind = "blueprint" | "launch" | "checkin" | "onboarding";
export type Templated = "approved" | "pending" | "declined";

/**
 * A form's value said mid-sentence: a value in Title Case ("Wants To See
 * Them First") is lowered after its first letter; one with a capital that
 * is not a word's first (a brand, an acronym such as "OS") stays as typed.
 */
export function sentenceCase(value: string): string {
  const words = value.trim().split(/\s+/);
  const title =
    words.length > 1 && words.every(w => /^[A-Z][a-z'’]*[.,]?$/.test(w));
  if (!title) return value.trim();
  const lowered = words.map(w => w.toLowerCase()).join(" ");
  return lowered[0].toUpperCase() + lowered.slice(1);
}

export interface Goal {
  key: GoalKey;
  label: L;
  /** The words shown (challenges: up to three lines). */
  lines: string[];
  /** What the form said, cleaned, before any prep edit. */
  form: string;
  from: "prep" | "form" | "none";
  /** Held back from the canvas until the CSM edits it (copy rule 10). */
  held: Held | null;
}

export interface AccessTick {
  key: string;
  label: L;
  status: AccessStatus;
  from: "prep" | "kickoff" | "none";
  /** The kickoff form's own answer, for the notes window. */
  answer: string | null;
}

export interface AccessRow {
  key: "meta" | "os" | "crm" | "content" | "past" | "academy" | "phones";
  name: L;
  line: L;
  ticks: AccessTick[];
  status: AccessStatus;
}

export interface DeckInput {
  taskId: string;
  deck: DeckKind;
  lang: Lang;
  sources: DeckSources | null;
  /** The client's row from cockpit_csm_onboarding_read (forms, links, dates). */
  kit: OnboardingRow | null;
  /** This deck's prep overrides, and the other deck's (red lines carry over). */
  prep: {
    onboarding: Overrides;
    launch: Overrides;
    blueprint?: Overrides;
  } & Partial<Record<OfferDeckKind, Overrides>>;
  /** This client's ready uploads, with signed links when they were signed. */
  ads: LaunchAd[];
  /** The signed-in seat's name, when the server has no first name for it. */
  presenterName?: string | null;
  /** Calls booked from the notes window in this session, before they read back. */
  booked?: Partial<Record<CallKind, string>>;
  /** When the kickoff was sent from the deck's last slide in this call (its submit). */
  kickoffSent?: string | null;
  /** The public link of an object in a public bucket (the verified logos). */
  publicUrl?: (bucket: string, path: string) => string;
  /** This deck's video slots as read (null: not read), and why not. */
  videos?: DeckVideos | null;
  videosProblem?: string | null;
  /** The launch deck's Brand Blueprint, read beside its sources (SPEC 6.2). */
  blueprint?: LaunchBlueprint | null;
  now: Date;
}

export interface DeckData {
  taskId: string;
  deck: DeckKind;
  lang: Lang;
  /** The client's name in the language on screen. */
  name: string;
  nameEn: string;
  /** The Arabic name from HighLevel, when there is one. */
  nameAr: string | null;
  initials: string;
  logo: { url: string; from: "verified" | "upload" } | null;
  country: string | null;
  uae: boolean;
  timeZone: string;
  mode: {
    dwy: boolean;
    known: boolean;
    from: "prep" | "card" | "highlevel" | "none";
  };
  csmFirst: string | null;
  onboardingDay: string;
  onboardingDayFrom: "kit" | "today";
  goLive: string | null;
  next: Partial<Record<CallKind, string>>;
  last: Partial<Record<CallKind, string>>;
  goals: Goal[];
  services: string[];
  servicesFrom: "prep" | "form" | "kickoff" | "none";
  numberOne: string | null;
  /**
   * The client's main service as this deck reads it (DESIGN 22.14): the
   * onboarding deck asks slide 4's choice, then prep, the kickoff and the
   * forms; the launch deck asks the kickoff first.
   */
  service: ServicePick;
  /** Slide 4's rows: the five main services (and "Other"), the client's own words under each. */
  serviceRows: ServiceRow[];
  /** The service as a label in the deck's language ("Interior design"). */
  serviceFocus: string | null;
  /** The same, said inside a sentence ("interior design", التصميم الداخلي). */
  serviceMid: string | null;
  serviceFocusFrom: "prep" | "kickoff" | "form" | "none";
  /**
   * The service the client chose on slide 4 ("Launch with this" stamps
   * `service_chosen_at`; Undo clears it). A service typed in prep with no
   * stamp is only the proposal (DESIGN 22.2.0).
   */
  serviceChosen: string | null;
  serviceChosenAt: string | null;
  /** The example ad's pictures while they have no creative (DESIGN 22.14). */
  example: ServiceExample;
  /** The client's own words inside an example phone: never written for them. */
  exampleWords: { primary: string | null; headline: string | null };
  /** The call's checklist, each item done from data, never from a press (DESIGN 22.2.0). */
  today: { service: boolean; access: boolean; blueprint: boolean };
  /**
   * The Blueprint call is booked or held (not only ticked by the kickoff's
   * Submit): the checklist's third item names the call only then, and
   * "Kickoff sent" before it.
   */
  blueprintBooked: boolean;
  templated: Templated;
  templatedAnswer: string | null;
  /**
   * A ready starter pack for the service this deck is on (finder round 2):
   * prep ticks it for one main service, so a different choice on slide 4
   * leaves O7 without the pack's line and its stop.
   */
  starterPack: boolean;
  /** The service prep ticked the pack for; null when none is ticked. */
  starterPackFor: ServiceKey | null;
  starterAds: LaunchAd[];
  redLines: string[];
  dosDonts: { do: string[]; dont: string[] };
  /** The Arabic of each card line, typed in prep (`dos_donts_ar`, DESIGN 22.6.2). */
  dosDontsAr: Record<string, string>;
  kickoffFiled: boolean;
  /**
   * The kickoff (the deck's last slide, 2026-10-22): when it went in, and
   * how the deck knows. "call": its Submit on this call's last slide;
   * "record": the kickoff on the client's record. `entry` is what was
   * filled, when the record has it; `prefilled` says the onboarding form
   * is on record, so the form opens with their details read back.
   */
  kickoff: {
    sentAt: string | null;
    from: "call" | "record" | null;
    entry: FormEntry | null;
    prefilled: boolean;
  };
  access: AccessRow[];
  links: {
    drive: string | null;
    leadsie: string;
    academy: string;
    portal: string;
    portalInstall: string;
  };
  roadNow: number;
  roadDays: (string | null)[];
  pageName: string;
  pageNameFrom: "prep" | "kickoff" | "client";
  callers: string[] | null;
  stage: string | null;
  /** Facts only the CSM sees (the notes window and prep). */
  notes: string[];
  presentedAt: string | null;
  /** This deck's video slots as read: null when not read, with the reason. */
  videos: VideoRead;
  /** The launch deck's own slots (launchData.ts). */
  launch: LaunchData;
}

// ------------------------------------------------------------- the forms

const pattern = (list: [RegExp, string][], label: string): RegExp => {
  const hit = list.find(([, l]) => l === label);
  if (!hit) throw Error(`No form pattern named ${label}`);
  return hit[0];
};
const setup = (topic: string, name = false) =>
  SETUP.filter(s => s.topic === topic && Boolean(s.name) === name).map(
    s => s.re,
  );

/** The onboarding form's questions the decks read (KFRCXPFx). */
export const FORM = {
  goal90: pattern(GOALS, "90-day revenue goal"),
  goal12_24: pattern(GOALS, "12 to 24-month revenue goal"),
  challenges: pattern(GOALS, "Top challenges"),
  why: pattern(GOALS, "Why they joined"),
  numberOne: pattern(GOALS, "Wants to grow"),
  services: /what services do you offer/i,
  consultTypes: /types of appointments/i,
  engineers: /who are the engineers/i,
  freeConsult: /free consultations/i,
  instagram: /instagram url/i,
  areas: /service areas/i,
  hours: /business hours/i,
  businessName: /^business name$/i,
};

/** The kickoff form's questions the decks read (tG7dnxBn). */
export const KICK = {
  advertised: pattern(KICKOFF, "Advertising"),
  platforms: pattern(KICKOFF, "Platforms"),
  preExisting: pattern(KICKOFF, "Has leads from before"),
  pastNotes: /link or notes for those leads/i,
  pageName: setup("facebook", true).find(re =>
    re.test("name of the facebook page"),
  ) as RegExp,
  templated: setup("templated")[0],
  card: setup("card")[0],
  facebook: setup("facebook")[0],
  calendar: setup("calendar")[0],
  os: setup("os")[0],
  whatsappSynced: SETUP.find(s => s.label === "WhatsApp sync to Mahara OS")
    ?.re as RegExp,
  academy: /premium projects academy confirmed|training course access/i,
};

const answer = (form: Answered | undefined | null, re: RegExp) => {
  const v = formAnswer(form, re);
  return v && !EMPTY.test(v.trim()) ? v : "";
};

// ------------------------------------------------------------- helpers

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    : [];
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const ARABIC = /[؀-ۿ]/;

/** Arabic first when the deck is Arabic and an Arabic twin was typed in prep. */
function twin(prep: Overrides, key: string, lang: Lang): string | null {
  return (lang === "ar" ? str(prep[`${key}_ar`]) : null) ?? str(prep[key]);
}

const GENERIC_EN =
  /^(the|co|co\.|company|group|est|est\.|llc|wll|w\.l\.l|and|&|for|of)$/i;
const GENERIC_AR = /^(شركة|مؤسسة|مكتب|مجموعة|و)$/;

/**
 * A monogram's letters (DESIGN 7.7): generic words skipped (The, Company,
 * Group; شركة، مؤسسة، مكتب، مجموعة and the ال prefix), two initials for two
 * Latin words, the first letter of the first word for an Arabic name.
 */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s&.]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (ARABIC.test(name)) {
    const w =
      words.find(x => ARABIC.test(x) && !GENERIC_AR.test(x)) ?? words[0] ?? "";
    return w.replace(/^ال(?=\p{L}{2})/u, "").charAt(0);
  }
  const kept = words.filter(w => !GENERIC_EN.test(w));
  const use = kept.length ? kept : words;
  return use
    .slice(0, 2)
    .map(w => w.charAt(0).toUpperCase())
    .join("");
}

const COUNTRY_WORDS: [RegExp, string][] = [
  [
    /riyadh|jeddah|jedda|dammam|khobar|mecca|makkah|medina|madinah|qassim|abha|tabuk|saudi|ksa|الرياض|جدة|الدمام|الخبر|مكة|المدينة|القصيم|أبها|تبوك|السعودية/i,
    "SA",
  ],
  [
    /dubai|abu dhabi|sharjah|ajman|al ain|uae|emirates|دبي|أبوظبي|ابوظبي|الشارقة|عجمان|العين|الإمارات/i,
    "AE",
  ],
  [
    /kuwait|salmiya|hawalli|jahra|ahmadi|farwaniya|الكويت|السالمية|حولي|الجهراء|الأحمدي|الفروانية/i,
    "KW",
  ],
  [/doha|qatar|الدوحة|قطر/i, "QA"],
  [/manama|bahrain|المنامة|البحرين/i, "BH"],
  [/muscat|oman|مسقط|عمان/i, "OM"],
];

/** The country from the service areas answer, when HighLevel has none. */
export function countryFromAreas(text: string): string | null {
  for (const [re, code] of COUNTRY_WORDS) if (re.test(text)) return code;
  return null;
}

/** A setup answer read as a status: done, still to do, or not filed. */
function setupStatus(value: string | null | undefined): AccessStatus {
  if (!value?.trim()) return "unchecked";
  return SETUP_DONE.test(value.trim()) ? "done" : "todo";
}

/**
 * A row's status from its ticks: done only when every tick is done; to do
 * when one is, or when some are done and the rest not checked (score round
 * 4: "Not checked yet" headed a card with two of its three ticked).
 */
export function rowStatus(ticks: AccessStatus[]): AccessStatus {
  if (ticks.length && ticks.every(s => s === "done")) return "done";
  if (ticks.some(s => s === "todo")) return "todo";
  if (ticks.some(s => s === "done")) return "todo";
  return "unchecked";
}

/** Which road stop is lit (0-based) from the card's stage (CONTENT O5). */
export function roadNowFor(stage: string | null | undefined): number {
  const s = String(stage ?? "");
  if (/launch booked|ready for launch/i.test(s)) return 4;
  if (/blueprint/i.test(s)) return 3;
  return 2;
}

const TEMPLATED = (v: string | null): Templated => {
  if (!v) return "pending";
  if (/declin/i.test(v)) return "declined";
  if (/^approved\b/i.test(v.trim())) return "approved";
  return "pending";
};

// ------------------------------------------------------------- the deck

export function deckData(input: DeckInput): DeckData {
  const { sources: s, kit, lang, now } = input;
  const prep = input.prep[input.deck] ?? {};
  const onboardingPrep = input.prep.onboarding ?? {};
  const form = kit?.forms?.onboarding ?? null;
  const kickoff = kit?.forms?.kickoff ?? null;
  const notes: string[] = [...(s?.notes ?? [])];

  // Name: the card's, else the form's business name.
  const nameEn =
    str(s?.clientName) ??
    str(kit?.client_name) ??
    str(answer(form, FORM.businessName)) ??
    "";
  const ghlName = str(s?.ghl?.name);
  const nameAr = ghlName && ARABIC.test(ghlName) ? ghlName : null;
  const name = lang === "ar" && nameAr ? nameAr : nameEn;

  // Country: HighLevel, else the service areas answer.
  const country =
    str(s?.ghl?.country)?.toUpperCase() ??
    countryFromAreas(answer(form, FORM.areas));
  const uae = country === "AE" || country === "OM";
  const timeZone = uae ? "Asia/Dubai" : "Asia/Riyadh";

  // Service model: prep, then the card, then HighLevel; unknown reads DFY.
  const prepModel =
    str(prep.service_model) ?? str(onboardingPrep.service_model);
  const card = serviceModel(s?.client?.service ?? null);
  const ghlMode = str(s?.ghl?.serviceMode);
  const mode: DeckData["mode"] = prepModel
    ? { dwy: prepModel === "DWY", known: true, from: "prep" }
    : card.code
      ? { dwy: card.dwy, known: true, from: "card" }
      : ghlMode && /^(DFY|DWY)$/.test(ghlMode)
        ? { dwy: ghlMode === "DWY", known: true, from: "highlevel" }
        : { dwy: false, known: false, from: "none" };
  // An unknown model is said once, by slide 3's prep line ("Service model
  // not set…"), not again here (the fixer's round: prep showed both).

  // The presenting CSM's first name (the covers only).
  const fromAuth = str(input.presenterName);
  const csmFirst =
    str(s?.presenter?.firstName) ??
    (fromAuth && !fromAuth.includes("@") ? fromAuth.split(/\s+/)[0] : null);

  // Logo: verified, else a prep upload; the monogram otherwise.
  const uploadLogo = input.ads
    .filter(a => a.kind === "logo" && a.status === "ready" && a.url)
    .at(-1);
  const logo =
    s?.logo && input.publicUrl
      ? {
          url: input.publicUrl(s.logo.bucket, s.logo.path),
          from: "verified" as const,
        }
      : uploadLogo?.url
        ? { url: uploadLogo.url, from: "upload" as const }
        : null;

  // Calls: booked here first, then what the calendar reads back.
  const next: Partial<Record<CallKind, string>> = {};
  const last: Partial<Record<CallKind, string>> = {};
  for (const k of [
    "blueprint",
    "launch",
    "checkin",
    "onboarding",
  ] as CallKind[]) {
    const n = input.booked?.[k] ?? s?.calls?.next?.[k]?.startsAt;
    if (n) next[k] = n;
    const l = s?.calls?.last?.[k]?.startsAt;
    if (l) last[k] = l;
  }

  const today = gulfToday(now);
  const kitDay = dayOf(s?.kit?.onboardingCallOn ?? kit?.onboarding_call_on);
  const goLive =
    dayOf(input.prep.launch?.go_live) ??
    dayOf(s?.kit?.launchOn ?? kit?.launch_on) ??
    dayOf(s?.client?.launchDate);

  // Goals: prep edits, else the form's answers, cleaned and checked.
  const goalPrep = (k: GoalKey) =>
    (lang === "ar" ? str(record(prep.goals_ar)[k]) : null) ??
    str(record(prep.goals)[k]);
  const goalSpec: [GoalKey, RegExp][] = [
    ["goal90", FORM.goal90],
    ["goal12_24", FORM.goal12_24],
    ["challenges", FORM.challenges],
    ["why", FORM.why],
  ];
  const goals: Goal[] = goalSpec.map(([key, re]) => {
    const raw = answer(form, re);
    const cleaned = cleanAnswer(raw);
    const edited = goalPrep(key);
    const label = O.goals[key];
    if (edited)
      return {
        key,
        label,
        lines: key === "challenges" ? challengeLines(edited) : [edited],
        form: cleaned,
        from: "prep",
        held: null,
      };
    if (!cleaned || EMPTY.test(cleaned))
      return { key, label, lines: [], form: "", from: "none", held: null };
    const held = heldReason(cleaned);
    return {
      key,
      label,
      lines: key === "challenges" ? challengeLines(raw) : [cut(cleaned, 120)],
      form: cleaned,
      from: "form",
      held,
    };
  });

  // Services: prep chips, else the form's list, else the kickoff's service.
  const advertised = str(cleanAnswer(answer(kickoff, KICK.advertised)));
  const numberOneRaw = cleanAnswer(answer(form, FORM.numberOne));
  const numberOne =
    numberOneRaw &&
    numberOneRaw.length <= 44 &&
    numberOneRaw.split(/\s+/).length <= 6
      ? numberOneRaw
      : null;
  // The Arabic deck names the client's services in Arabic wherever prep
  // has them (either deck's prep: the same client's words), so slide 4's
  // quiet lines and the queue card keep one script (score round 1: O4 read
  // "Villa interiors" under تصميم داخلي); the Latin words only when there
  // is no Arabic list.
  const servicesAr =
    lang === "ar"
      ? ([prep, onboardingPrep, input.prep.launch ?? {}]
          .map(p => list(p.services_ar))
          .find(l => l.length) ?? null)
      : null;
  // Prep's list is edited on the onboarding side: the launch deck reads it
  // there when its own prep has none.
  const prepServices =
    servicesAr ??
    [prep, onboardingPrep].map(p => list(p.services)).find(l => l.length) ??
    null;
  let services: string[];
  let servicesFrom: DeckData["servicesFrom"];
  if (prepServices) {
    services = prepServices;
    servicesFrom = "prep";
  } else {
    const chips = serviceChips(answer(form, FORM.services));
    if (
      numberOne &&
      !chips.some(c => c.toLowerCase() === numberOne.toLowerCase())
    )
      chips.unshift(numberOne);
    if (chips.length) {
      services = chips.slice(0, 6);
      servicesFrom = "form";
    } else if (advertised) {
      services = [advertised];
      servicesFrom = "kickoff";
    } else {
      services = [];
      servicesFrom = "none";
    }
  }

  // The main service (DESIGN 22.14). Slide 4's choice and prep's line
  // are one field (service_focus); the stamp says the client chose it.
  const chosenAt = str(onboardingPrep.service_chosen_at);
  const prepSource: ServiceSource = {
    from: chosenAt ? "chosen" : "prep",
    text: str(onboardingPrep.service_focus),
    ar: str(onboardingPrep.service_focus_ar),
    explicit: true,
  };
  const kickSource: ServiceSource = {
    from: "kickoff",
    text: advertised,
    explicit: true,
  };
  const formSources: ServiceSource[] = [
    numberOne,
    ...serviceChips(answer(form, FORM.services)),
    ...services,
  ].map(text => ({ from: "form", text, explicit: false }));
  const nameSource: ServiceSource = {
    from: "none",
    text: [nameEn, nameAr].filter(Boolean).join(" "),
    explicit: false,
  };
  // The onboarding deck: the choice, prep, the kickoff, the forms. The
  // launch deck: the kickoff first, then the choice, prep and the forms.
  const onboardingService = resolveService([
    prepSource,
    kickSource,
    ...formSources,
  ]);
  const launchService = resolveService([
    kickSource,
    prepSource,
    ...formSources,
  ]);
  // The Brand Blueprint reads it as the launch deck does (SPEC 5.1).
  const service =
    input.deck === "onboarding" ? onboardingService : launchService;
  const named = serviceNames(service);
  const serviceFocus = named.name[lang] ?? null;
  const serviceMid = named.mid[lang] ?? null;
  const serviceFocusFrom: DeckData["serviceFocusFrom"] =
    service.from === "chosen" ? "prep" : service.from;
  const chosenNamed = serviceNames(onboardingService);

  // Starter ads and approval.
  const templatedAnswer = str(answer(kickoff, KICK.templated));
  const templated = TEMPLATED(templatedAnswer);
  // The pack is made for one service. Prep saves its key ("other": the
  // service in their own words); a plain yes (saved before keys) means the
  // kickoff's service, or, with none on the kickoff, the deck's.
  const savedPack = onboardingPrep.starter_pack;
  const starterPackFor: ServiceKey | null =
    isMain(savedPack) || savedPack === "other"
      ? savedPack
      : savedPack === true
        ? (resolveService([kickSource]).key ?? service.key)
        : null;
  const starterPack = starterPackFor !== null && starterPackFor === service.key;
  const starterAds = input.ads.filter(
    a => a.kind === "starter" && a.status === "ready" && !a.hidden,
  );

  // Red lines typed on slide 7 (the client's words, as typed).
  const redLines =
    (lang === "ar" && list(onboardingPrep.red_lines_ar).length
      ? list(onboardingPrep.red_lines_ar)
      : null) ?? list(onboardingPrep.red_lines);
  const sections = s?.dosDonts?.text ? parseDosDonts(s.dosDonts.text) : [];
  const dosDonts = {
    do: sections.find(x => x.tone === "do")?.items ?? [],
    dont: sections.find(x => x.tone === "dont")?.items ?? [],
  };
  // Only the lines still on the card: a key whose line is gone is ignored
  // (and pruned on the next save in prep).
  const cardLines = new Set([...dosDonts.do, ...dosDonts.dont]);
  const dosDontsAr: Record<string, string> = {};
  for (const [k, v] of Object.entries(
    record(input.prep.launch?.dos_donts_ar),
  )) {
    const ar = str(v);
    if (ar && cardLines.has(k)) dosDontsAr[k] = ar;
  }

  // Access: the kickoff's setup answers, then the CSM's live ticks.
  const kickoffFiled = Boolean(kickoff);
  const access = record(onboardingPrep.access);
  const tick = (
    key: string,
    label: L,
    fromKickoff: () => string | null,
  ): AccessTick => {
    const set = access[key];
    const a = kickoffFiled ? fromKickoff() : null;
    if (set === "done" || set === "todo" || set === "unchecked")
      return { key, label, status: set, from: "prep", answer: a };
    if (!kickoffFiled)
      return { key, label, status: "unchecked", from: "none", answer: null };
    return {
      key,
      label,
      status: setupStatus(a),
      from: a ? "kickoff" : "none",
      answer: a,
    };
  };
  // A setup answer as filed: "No" is an answer here (not done), never empty.
  const kickAnswer = (re: RegExp | undefined) => () =>
    re ? str(formAnswer(kickoff, re)) : null;
  const pastAnswer = () => {
    const has = str(formAnswer(kickoff, KICK.preExisting));
    if (!has) return null;
    if (/^no\b/i.test(has)) return "Done (no list)";
    return str(answer(kickoff, KICK.pastNotes))
      ? "Done (sent)"
      : "Yes, not sent yet";
  };
  const calendarAnswer = () =>
    formAnswers(kickoff, KICK.calendar).find(v => SETUP_DONE.test(v.trim())) ??
    str(answer(kickoff, KICK.calendar));
  const W = O.week.rows;
  const row = (
    key: AccessRow["key"],
    def: { name: L; line: L; ticks: readonly { key: string; label: L }[] },
    read: Record<string, () => string | null>,
  ): AccessRow => {
    const ticks = def.ticks.map(t =>
      tick(t.key, t.label, read[t.key] ?? (() => null)),
    );
    return {
      key,
      name: def.name,
      line: def.line,
      ticks,
      status: rowStatus(ticks.map(t => t.status)),
    };
  };
  const osApproved = onboardingPrep.dwy_os_approved === true;
  const rows: AccessRow[] = [
    row("meta", W.meta, {
      meta_access: kickAnswer(KICK.facebook),
      meta_card: kickAnswer(KICK.card),
    }),
    mode.dwy && !osApproved
      ? row("crm", W.crm, {
          os_signin: kickAnswer(KICK.os),
          os_calendar: calendarAnswer,
        })
      : row("os", W.os, {
          os_signin: kickAnswer(KICK.os),
          os_whatsapp: kickAnswer(KICK.whatsappSynced),
          os_calendar: calendarAnswer,
        }),
    // Content reads "Not checked yet" until the CSM ticks it.
    row("content", W.content, {}),
    row("past", W.past, { past: pastAnswer }),
    row("academy", W.academy, { academy: kickAnswer(KICK.academy) }),
  ];
  if (mode.dwy) rows.push(row("phones", W.phones, {}));

  // Road: today's stop from the stage, and the real dates behind it.
  const stage = str(s?.client?.stage) ?? str(kit?.clickup_status);
  const roadNow = roadNowFor(stage);
  const formDay = dayOf(form?.submitted_at);
  const signed = dayOf(s?.kit?.signupOn ?? kit?.signup_on);
  const onboardingCall = kitDay ?? dayOf(last.onboarding);
  const roadDays: (string | null)[] = [
    signed,
    formDay,
    roadNow > 2 ? onboardingCall : null,
    next.blueprint ?? (roadNow > 3 ? (last.blueprint ?? null) : null),
    next.launch ?? null,
    null,
  ];

  // The example ad (DESIGN 22.14): prep's switch, else the pictures of
  // this deck's service, else of the client's name read as a service, else
  // interior design's. Its words are the client's own: their selling point
  // as the caption, the service as the Facebook headline.
  const launchPrep = input.prep.launch ?? {};
  const byName = service.key ? null : resolveService([nameSource]);
  const example = examplePick(
    onboardingPrep.example_theme,
    service.key ?? (byName?.key === "other" ? null : (byName?.key ?? null)),
    service.text,
  );
  // The Arabic deck's headline: the service's Arabic name, never a Latin one.
  const serviceAr =
    named.name.ar && ARABIC.test(named.name.ar) ? named.name.ar : null;
  const exampleWords =
    lang === "ar"
      ? {
          primary: str(launchPrep.selling_point_ar),
          headline: serviceAr,
        }
      : {
          primary:
            str(launchPrep.selling_point) ??
            (input.deck === "launch" ? (input.blueprint?.offer ?? null) : null),
          headline: named.name.en,
        };

  const kickPage = str(answer(kickoff, KICK.pageName));
  const pagePrep =
    twin(prep, "page_name", lang) ?? twin(onboardingPrep, "page_name", lang);
  const pageName =
    pagePrep ??
    (kickPage && !NAME_OPEN.test(kickPage) ? kickPage : null) ??
    name;
  const pageNameFrom: DeckData["pageNameFrom"] = pagePrep
    ? "prep"
    : kickPage && !NAME_OPEN.test(kickPage)
      ? "kickoff"
      : "client";

  const links = s?.kit?.links ?? {};
  const kitLinks = kit?.links ?? {};
  const drive =
    str(links.driveFolder) ??
    str(links.drive) ??
    str(kitLinks.drive_folder) ??
    str(kitLinks.drive) ??
    str(s?.editor?.driveUrl);

  const callers = s?.callers
    ? s.callers
        .map(c => str(c.firstName))
        .filter((x): x is string => Boolean(x))
    : null;
  if (callers)
    notes.push(
      callers.length
        ? `Callers on this account: ${callers.join(", ")}.`
        : "No caller is assigned to this account yet.",
    );
  if (templatedAnswer)
    // The form's raw value can arrive in Title Case ("Wants To See Them
    // First"): said in sentence case, as every line here is.
    notes.push(`Kickoff, templated ads: ${sentenceCase(templatedAnswer)}.`);
  else if (kickoffFiled)
    notes.push("Kickoff filed without a templated ads answer.");
  else
    notes.push(
      "The kickoff form is not filed yet, so every access row reads Not checked yet.",
    );
  for (const g of goals)
    if (g.held)
      notes.push(
        `Held back from slide 2: "${g.label.en}" ${g.held === "count" ? "counts enquiries or appointments" : "mentions a guarantee or a refund"}. Edit it in prep to show it.`,
      );

  const base: Omit<DeckData, "launch"> = {
    taskId: input.taskId,
    deck: input.deck,
    lang,
    name,
    nameEn,
    nameAr,
    initials: initials(name),
    logo,
    country,
    uae,
    timeZone,
    mode,
    csmFirst,
    onboardingDay: kitDay ?? today,
    onboardingDayFrom: kitDay ? "kit" : "today",
    goLive,
    next,
    last,
    goals,
    services,
    servicesFrom,
    numberOne,
    service,
    serviceRows: serviceRows(services, onboardingService),
    serviceFocus,
    serviceMid,
    serviceFocusFrom,
    serviceChosen:
      chosenAt && onboardingService.from === "chosen"
        ? (chosenNamed.name[lang] ?? null)
        : null,
    serviceChosenAt: chosenAt,
    example,
    exampleWords,
    today: {
      service: Boolean(chosenAt),
      // The setup done live on O6: Meta access and Mahara OS (done with
      // you, their CRM and their callers' phones), every step done.
      access: rows
        .filter(r => ["meta", "os", "crm", "phones"].includes(r.key))
        .every(r => r.status === "done"),
      // Booked, or held already (the stage past it, as O5's road shows):
      // O7's checklist never leaves it open beside a road that says Done.
      // Or the kickoff is sent: its submit is what books the Blueprint on
      // our side (Make 12, Brand Blueprint Booked), so the last slide's
      // Submit ticks it (2026-10-22).
      blueprint:
        Boolean(next.blueprint) ||
        roadNow > 3 ||
        Boolean(input.kickoffSent) ||
        kickoffFiled,
    },
    blueprintBooked: Boolean(next.blueprint) || roadNow > 3,
    templated,
    templatedAnswer,
    starterPack,
    starterPackFor,
    starterAds,
    redLines,
    dosDonts,
    dosDontsAr,
    kickoffFiled,
    kickoff: {
      sentAt: input.kickoffSent ?? kickoff?.submitted_at ?? null,
      from: input.kickoffSent ? "call" : kickoff ? "record" : null,
      entry: kickoff,
      prefilled: Boolean(form),
    },
    access: rows,
    links: {
      drive,
      leadsie: LINKS.leadsie,
      academy: LINKS.academy,
      portal: LINKS.portal,
      portalInstall: LINKS.portalInstall,
    },
    roadNow,
    roadDays,
    pageName,
    pageNameFrom,
    callers,
    stage,
    notes,
    presentedAt: str(onboardingPrep.onboarding_presented_at),
    videos: {
      videos: input.videos ?? null,
      problem: input.videos ? null : (input.videosProblem ?? null),
    },
  };
  return {
    ...base,
    launch: launchData({
      d: base,
      launchPrep: input.prep.launch ?? {},
      onboardingPrep,
      ads: input.ads,
      metaAds: s?.meta?.ads ?? [],
      funnels: s?.meta?.funnels ?? [],
      answers: {
        engineers: answer(form, FORM.engineers),
        // "No" is an answer here (the consultation is not free), never empty.
        freeConsult: str(formAnswer(form, FORM.freeConsult)) ?? "",
        consultTypes: answer(form, FORM.consultTypes),
        instagram:
          answer(form, FORM.instagram) || (str(s?.editor?.instagram) ?? ""),
        hours: answer(form, FORM.hours),
        areas: answer(form, FORM.areas),
      },
      advertised,
      service: launchService,
      today,
      blueprint: input.deck === "launch" ? (input.blueprint ?? null) : null,
      refs: {
        brandDna: str(s?.editor?.brandDnaUrl) ?? str(kit?.links?.brand_dna),
        offer: str(s?.editor?.offerUrl) ?? str(kit?.links?.offer_sheet),
        offerText: str(s?.editor?.offer),
        clickup: str(kit?.links?.clickup),
      },
    }),
  };
}

/** The goals a client sees: answered and not held back. */
export const shownGoals = (d: DeckData) =>
  d.goals.filter(g => g.lines.length && !g.held);
