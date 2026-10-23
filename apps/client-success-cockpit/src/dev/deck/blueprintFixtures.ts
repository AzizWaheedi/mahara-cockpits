/**
 * The Brand Blueprint call's harness fixtures (docs/brand-blueprint/SPEC.md
 * 5.8). Every firm, answer and link here is made up for the harness; the
 * pictures are crops of Mahara's own renders. Nothing is read from or sent
 * to anywhere: saves stay in memory, a press "runs" after a second and a
 * half, a rehearsal returns a plan written here, and Drive's folder view is
 * never framed (the pack shows stand-in pictures, labelled).
 *
 * Fixtures: full (kickoff, onboarding, deck prep red lines, all five
 * packs, a launch media buyer, market research, a verified logo, a Brand
 * DNA doc with four colours), sparse (onboarding only, no packs), nokickoff,
 * two (the kickoff named two services), declined (starter ads declined),
 * nopack (as full, with no starter pack in Settings) and arabic (a firm
 * whose answers are typed in Arabic). Each firm prices in its own currency.
 * States (bp=): open, part1, sent, closed, locked.
 */

import type { OnboardingRow } from "@/lib/onboardingCore";
import * as B from "@/present/blueprintBrief";
import {
  type Answers,
  type BpPart,
  partAnswers,
} from "@/present/blueprintForm";
import type { Change, SaveResult } from "@/present/blueprintSaver";
import type {
  BlueprintBundle,
  BlueprintRow,
  PartStamp,
} from "@/present/blueprintSources";
import { sourcesSchema } from "@/present/sources";
import type { BlueprintIO, Loaded } from "@/present/useDeckModel";
import fitoutFeed from "./starter-fitout-feed.webp";
import fitoutReel from "./starter-fitout-reel.webp";
import interiorFeed from "./starter-interior-feed.webp";
import interiorReel from "./starter-interior-reel.webp";

export type BpFixture =
  | "full"
  | "sparse"
  | "nokickoff"
  | "two"
  | "declined"
  | "nopack"
  | "arabic";
export type BpState = "open" | "part1" | "sent" | "closed" | "locked";

export const BP_FIXTURES: BpFixture[] = [
  "full",
  "sparse",
  "nokickoff",
  "two",
  "declined",
  "nopack",
  "arabic",
];
export const BP_STATES: BpState[] = [
  "open",
  "part1",
  "sent",
  "closed",
  "locked",
];

/** The call: Thursday 22 October 2026, 10:00 in the Gulf. */
export const BP_CALL_AT = "2026-10-22T07:00:00Z";
export const BP_NOW = Date.parse("2026-10-22T07:40:00Z");

const LOGO = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><rect width="240" height="120" fill="none"/><path d="M30 92V28l52 64V28" fill="none" stroke="#1d2a3a" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><circle cx="82" cy="20" r="7" fill="#b8925a"/><text x="104" y="74" font-family="Georgia, serif" font-size="34" fill="#1d2a3a">Noor</text></svg>`,
)}`;

const folder = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const PACKS = {
  "design-build": folder("1FixturePackDesignBuild00"),
  interior: folder("1FixturePackInteriorDesign0"),
  architecture: folder("1FixturePackArchitecture00"),
  fitout: folder("1FixturePackFitoutRenovate"),
  construction: folder("1FixturePackConstruction00"),
};

/** A form answer under its Typeform ref (the maps' prefixes, padded) and title. */
const a = (ref: string, title: string, value: string) => ({
  ref,
  title,
  value,
});
const KREF = {
  service: "c0000001-0000-4000-8000-000000000007",
  consult: "c0000001-0000-4000-8000-000000000008",
  templated: "eb7ed18c-1111-4111-8111-111111111111",
  budget: "cf53482c-2222-4222-8222-222222222222",
  facebook: "6fcbd33c-3333-4333-8333-333333333333",
  platforms: "7d16afbb-4444-4444-8444-444444444444",
  adAccount: "e4b9dbd3-5555-4555-8555-555555555555",
  page: "940f494c-6666-4666-8666-666666666666",
  funded: "8bee68fc-7777-4777-8777-777777777777",
  content: "3418ef58-8888-4888-8888-888888888888",
};
const OREF = {
  numberOne: "6271b610-1111-4111-8111-111111111111",
  ideal: "6c819933-2222-4222-8222-222222222222",
  services: "d976036f-3333-4333-8333-333333333333",
  payment: "ee25f923-4444-4444-8444-444444444444",
  freeConsult: "ec89854f-5555-4555-8555-555555555555",
  appointments: "b370341c-6666-4666-8666-666666666666",
  drive: "64d23c81-7777-4777-8777-777777777777",
};

interface Firm {
  taskId: string;
  name: string;
  nameAr: string | null;
  country: string;
  city: string;
  service: string;
  kickoffService: string | null;
  templated: string;
  budget: string;
  facebook: string;
  goal: string;
  ideal: string;
  services: string;
  /** Their services as onboarding prep lists them (slide 4's parked card). */
  list: string[];
  payment: string;
  freeConsult: string;
  appointments: string;
  logo: boolean;
  dna: string | null;
  dosDonts: string | null;
  redLines: string[];
  redLinesAr: string[];
  packs: boolean;
  kickoff: boolean;
  /** Their currency, and the smallest project and the ads' anchor in it. */
  money: { currency: string; minimum: number; anchor: number };
  /** The call's answers in their own words, over the harness's English. */
  words?: Answers;
}

const FIRMS: Record<BpFixture, Firm> = {
  full: {
    taskId: "fixture-bp-full",
    name: "Noor Studio Interiors",
    nameAr: "استوديو نور للتصميم الداخلي",
    country: "SA",
    city: "Riyadh",
    service: "Interior design",
    kickoffService: "Interior design",
    templated: "Wants To See Them First",
    budget: "$40 a day to start",
    facebook: "Access Confirmed",
    goal: "Steady whole-villa interiors in north Riyadh, from families who found us, not people chasing the lowest price.",
    ideal:
      "Families who have just finished the shell of their villa and want one studio to design every room, choose every material and manage the fit-out, with a fixed design fee agreed before we start.",
    services:
      "Villa interiors from 25,000 SAR for the design, majlis and reception design, kitchens and wardrobes, full fit-out supervision. Most whole-villa projects land between 180,000 and 260,000 SAR.",
    list: [
      "Villa interiors",
      "Majlis and reception design",
      "Full fit-out supervision",
      "Landscape and pools",
    ],
    payment:
      "30 percent when the design is signed, 40 percent at the material order, 30 percent at handover.",
    freeConsult: "Yes, the first showroom visit is free",
    appointments: "At our showroom, At the client's home",
    logo: true,
    dna: "Brand DNA\nVoice: calm, exact, warm.\nColours\n- Sand D9C8AD\n- Oak 8A6A4A\n- Brass B8914F\n- Night 1F2532\nType: a serif for the wordmark, Geist for text.",
    dosDonts:
      "DO's:\n- Show our real projects, never stock photos\n- Name the designer on site\nDON'Ts:\n- Never show prices in an ad\n- No before-and-after of client homes",
    redLines: [
      "No discount or limited-offer talk",
      "No faces of clients' families",
      "Nothing still on site",
    ],
    redLinesAr: [
      "بدون خصومات أو عروض محدودة",
      "لا تطلع وجوه عائلات العملاء",
      "بدون لقطات من مواقع شغالة",
    ],
    packs: true,
    kickoff: true,
    money: { currency: "SAR", minimum: 60000, anchor: 220000 },
  },
  sparse: {
    taskId: "fixture-bp-sparse",
    name: "Sahel Fit-out Co.",
    nameAr: null,
    country: "KW",
    city: "Kuwait City",
    service: "Fit-out and renovation",
    kickoffService: "Fit out and renovation",
    templated: "",
    budget: "",
    facebook: "",
    goal: "Fill the second site team with apartment renovations in Salmiya and Hawalli.",
    ideal: "Apartment owners renovating before they move in.",
    services: "Apartment renovation, kitchens, bathrooms, gypsum and lighting.",
    list: ["Apartment renovation", "Gypsum and lighting"],
    payment: "",
    freeConsult: "",
    appointments: "",
    logo: false,
    dna: null,
    dosDonts: null,
    redLines: [],
    redLinesAr: [],
    packs: false,
    kickoff: false,
    money: { currency: "KWD", minimum: 3000, anchor: 12000 },
  },
  nokickoff: {
    taskId: "fixture-bp-nokickoff",
    name: "Bayt Lumen Architects",
    nameAr: "بيت لومن للعمارة",
    country: "AE",
    city: "Dubai",
    service: "Architectural design",
    kickoffService: null,
    templated: "",
    budget: "",
    facebook: "",
    goal: "Private villa designs in Dubai Hills and Al Barari, signed from the first meeting.",
    ideal:
      "Owners of a plot who want an architect they can trust from the first sketch to the permit.",
    services: "Villa architecture, permit drawings, interior concept.",
    list: ["Villa architecture", "Permit drawings", "Interior concept"],
    payment: "A design fee in three stages.",
    freeConsult: "A first call is free",
    appointments: "Online, At our studio",
    logo: false,
    dna: null,
    dosDonts: null,
    redLines: [],
    redLinesAr: [],
    packs: true,
    kickoff: false,
    money: { currency: "AED", minimum: 150000, anchor: 600000 },
  },
  two: {
    taskId: "fixture-bp-two",
    name: "Al Rawdah Design and Build",
    nameAr: "الروضة للتصميم والتنفيذ",
    country: "QA",
    city: "Doha",
    service: "Design and build",
    kickoffService: "Design and build, Construction only",
    templated: "Approved",
    budget: "50 to 60 dollars",
    facebook: "Using Ours",
    goal: "Two villa builds a quarter in Al Wakrah, with the design done in-house.",
    ideal:
      "Families building their first villa who want one firm from the drawing to the keys.",
    services:
      "Design and build villas, construction only for drawings from other offices.",
    list: ["Villa design and build", "Construction only"],
    payment: "10 percent at signing, then by stage.",
    freeConsult: "Yes, a site meeting",
    appointments: "On site, At our office",
    logo: false,
    dna: null,
    dosDonts: null,
    redLines: ["No photos of unfinished sites"],
    redLinesAr: ["بدون صور مواقع ما خلصت"],
    packs: true,
    kickoff: true,
    money: { currency: "QAR", minimum: 400000, anchor: 1200000 },
  },
  declined: {
    taskId: "fixture-bp-declined",
    name: "Qasr Build Group",
    nameAr: "مجموعة قصر للبناء",
    country: "BH",
    city: "Manama",
    service: "Construction",
    kickoffService: "Construction only",
    templated: "Declined",
    budget: "BHD 20 a day",
    facebook: "Access Confirmed",
    goal: "Steady villa construction in Saar and Janabiya, for owners who already have drawings.",
    ideal:
      "Owners with approved drawings who want a builder that keeps to the schedule.",
    services: "Villa construction, extensions, structural repairs.",
    list: ["Villa construction", "Extensions", "Structural repairs"],
    payment: "Stage payments by the engineer's sign-off.",
    freeConsult: "",
    appointments: "On site",
    logo: false,
    dna: null,
    dosDonts: "DON'Ts:\n- No crane or helmet stock photos",
    redLines: [],
    redLinesAr: [],
    packs: true,
    kickoff: true,
    money: { currency: "BHD", minimum: 30000, anchor: 90000 },
  },
  nopack: {
    taskId: "fixture-bp-nopack",
    name: "Noor Studio Interiors",
    nameAr: "استوديو نور للتصميم الداخلي",
    country: "SA",
    city: "Riyadh",
    service: "Interior design",
    kickoffService: "Interior design",
    templated: "Wants To See Them First",
    budget: "$40 a day to start",
    facebook: "Access Confirmed",
    goal: "Steady whole-villa interiors in north Riyadh, from families who found us.",
    ideal:
      "Families who have just finished the shell of their villa and want one studio for every room.",
    services: "Villa interiors, majlis and reception design.",
    list: ["Villa interiors", "Majlis and reception design"],
    payment: "30 percent at signing, then by stage.",
    freeConsult: "Yes, the first showroom visit is free",
    appointments: "At our showroom",
    logo: true,
    dna: null,
    dosDonts: null,
    redLines: ["No discount or limited-offer talk"],
    redLinesAr: ["بدون خصومات أو عروض محدودة"],
    packs: false,
    kickoff: true,
    money: { currency: "SAR", minimum: 60000, anchor: 220000 },
  },
  arabic: {
    taskId: "fixture-bp-arabic",
    name: "Dar Al Khaleej Interiors",
    nameAr: "دار الخليج للتصميم الداخلي",
    country: "KW",
    city: "Kuwait City",
    service: "Interior design",
    kickoffService: "Interior design",
    templated: "Approved",
    budget: "$30 a day",
    facebook: "Access Confirmed",
    goal: "مشاريع تصميم داخلي لبيوت كاملة بمنطقة صباح الأحمد، من عائلات تدور على جودة مو أرخص سعر.",
    ideal:
      "عائلات خلصوا بناء بيتهم ويبون جهة وحدة تصمم كل غرفة وتختار الخامات وتتابع التنفيذ لين التسليم.",
    services:
      "تصميم داخلي للبيوت، تصميم الدواوين والمجالس، متابعة التنفيذ. أغلب المشاريع بين ١٥ و٢٥ ألف دينار.",
    list: ["تصميم داخلي للبيوت", "تصميم الدواوين", "متابعة التنفيذ"],
    payment: "٣٠٪ عند توقيع التصميم، ٤٠٪ عند طلب الخامات، ٣٠٪ عند التسليم.",
    freeConsult: "نعم، أول زيارة للمعرض مجانية",
    appointments: "At our showroom, At the client's home",
    logo: false,
    dna: null,
    dosDonts: null,
    redLines: ["بدون خصومات", "لا تطلع وجوه العائلات"],
    redLinesAr: ["بدون خصومات", "لا تطلع وجوه العائلات"],
    packs: true,
    kickoff: true,
    money: { currency: "KWD", minimum: 8000, anchor: 22000 },
    words: {
      method:
        "نرسم كل غرفة ثلاثي الأبعاد قبل لا تشترون أي شي، وتشوفون السعر كامل بند بند، ومصمم واحد يتابع معاكم لين التسليم.",
      not_for: "اللي يبون غرفة وحدة بأرخص سعر، أو يشترون كل قطعة بروحهم.",
      city_cant: "أغلب الشركات هني تصمم وتمشي. إحنا نبقى بالموقع لين آخر قطعة.",
      pricing:
        "رسوم تصميم ثابتة، والتنفيذ بالتكلفة مع رسومنا. أغلب البيوت بين ١٥ و٢٥ ألف دينار.",
      terms: "٣٠٪ بالتوقيع، ٤٠٪ بطلب الخامات، ٣٠٪ بالتسليم.",
      competitors: [
        { name: "استوديو الخطوط", lose: true },
        { name: "بيت الرمال للتصميم", lose: false },
        { name: "معارض الأثاث", lose: false },
      ],
      why_us:
        "نوريكم البيت كامل مرسوم ومسعر قبل التوقيع، فما يتغير شي بنص الشغل.",
      rules: {
        always: ["مشاريعنا الحقيقية", "اسم المصمم"],
        never: ["خصومات أو عروض محدودة"],
        neverShow: ["بيت العائلة بالعديلية"],
      },
      offer: {
        name: "خطة البيت الكامل",
        what: "كل غرفة مرسومة ثلاثي الأبعاد ومسعرة بند بند",
        firstStep: "زيارة تصميم مجانية مع المصمم المسؤول",
      },
    },
  },
};

function kit(f: Firm): OnboardingRow {
  const onboarding = {
    form_id: "KFRCXPFx",
    response_id: `${f.taskId}-o`,
    submitted_at: "2026-10-13T15:20:00Z",
    answers: [
      a("b0000001", "Business Name", f.name),
      a(
        OREF.services,
        "What services do you offer, and their PRICE?",
        f.services,
      ),
      a(OREF.numberOne, "What is your #1 service you want to grow?", f.service),
      a("g0000090", "What is your goal for the next 90 Days?", f.goal),
      a(OREF.ideal, "Please describe your ideal project in detail", f.ideal),
      ...(f.payment
        ? [a(OREF.payment, "What payment options do you offer?", f.payment)]
        : []),
      ...(f.freeConsult
        ? [
            a(
              OREF.freeConsult,
              "Do you offer free consultations?",
              f.freeConsult,
            ),
          ]
        : []),
      ...(f.appointments
        ? [
            a(
              OREF.appointments,
              "What types of appointments do you offer?",
              f.appointments,
            ),
          ]
        : []),
      a(
        OREF.drive,
        "Google Drive link to your photos and videos",
        folder(`1FixtureContent${f.taskId.slice(-4)}00`),
      ),
      a("s0000001", "What are your service areas?", f.city),
    ],
  };
  const kickoff = f.kickoff
    ? {
        form_id: "tG7dnxBn",
        response_id: `${f.taskId}-k`,
        submitted_at: "2026-10-16T08:10:00Z",
        answers: [
          ...(f.kickoffService
            ? [
                a(
                  KREF.service,
                  "Which service are we advertising?",
                  f.kickoffService,
                ),
              ]
            : []),
          a(
            KREF.platforms,
            "Which platforms will we advertise on?",
            "Meta (Facebook/Instagram)",
          ),
          ...(f.budget
            ? [
                a(
                  KREF.budget,
                  "What is your daily budget for the ads?",
                  f.budget,
                ),
              ]
            : []),
          ...(f.templated
            ? [a(KREF.templated, "Templated Ads Status", f.templated)]
            : []),
          ...(f.facebook
            ? [a(KREF.facebook, "Facebook Access Status", f.facebook)]
            : []),
          a(KREF.adAccount, "Ad account name", `${f.name} Ads`),
          a(
            KREF.page,
            "What is the name of the Facebook page?",
            f.name.split(" ").slice(0, 2).join(" "),
          ),
          a(KREF.funded, "Card linked with funds?", "Yes"),
          a(KREF.consult, "Consultation types", f.appointments || "On site"),
          a(
            KREF.content,
            "Content links",
            folder(`1FixtureReels${f.taskId.slice(-4)}000`),
          ),
        ],
      }
    : undefined;
  return {
    clickup_task_id: f.taskId,
    client_name: f.name,
    clickup_status: "blueprint booked",
    client_status: "Brand Blueprint Booked",
    in_onboarding: true,
    csm: "The CSM",
    signup_on: "2026-10-10",
    onboarding_call_on: "2026-10-16",
    launch_on: null,
    links: {
      drive_folder: folder(`1FixtureDrive${f.taskId.slice(-4)}0000`),
      ...(f.dna
        ? { brand_dna: "https://docs.google.com/document/d/fixture-brand-dna" }
        : {}),
      offer_sheet: "https://docs.google.com/document/d/fixture-offer-sheet",
      ...(f.packs
        ? {
            market_research:
              "https://docs.google.com/document/d/fixture-research",
          }
        : {}),
    },
    handover: { daily_budget: f.budget ? 45 : undefined },
    sales_transcript: null,
    forms: { onboarding, ...(kickoff ? { kickoff } : {}) },
    card_updated_at: null,
    seen_at: "2026-10-22T06:00:00Z",
    synced_at: "2026-10-22T06:00:00Z",
  };
}

/** The record for a state of the call, in the order the call fills it. */
function answersFor(f: Firm, key: BpFixture, state: BpState): Answers {
  if (state === "open") return {};
  const service =
    key === "two"
      ? undefined
      : (
          {
            full: "interior",
            sparse: "fitout",
            nokickoff: "architecture",
            declined: "construction",
            nopack: "interior",
            arabic: "interior",
          } as const
        )[key];
  const starter = key === "declined" ? "no" : "yes";
  const part1: Answers = {
    ...(service ? { service } : {}),
    starter,
    ...(starter === "yes" && f.packs && service
      ? { pack_url: PACKS[service] }
      : {}),
    ...(f.budget && !/to|BHD/i.test(f.budget)
      ? { daily_budget: { usd: 40, said: f.budget } }
      : {}),
    ...(starter === "yes" ? { destination: "lead_form" } : {}),
    ...(f.facebook
      ? { identity: /ours/i.test(f.facebook) ? "our_page" : "their_page" }
      : {}),
    ...(f.redLines.length ? { red_lines: f.redLines } : {}),
    best_client: f.ideal,
  };
  if (state === "part1") return part1;
  const sent: Answers = {
    ...part1,
    service: service ?? "design-build",
    capacity: "yes",
    pack_url:
      starter === "yes" ? (part1.pack_url ?? PACKS.interior) : undefined,
    pack_approval: starter === "yes" ? "on_call" : undefined,
    daily_budget: part1.daily_budget ?? { usd: 40 },
    destination: part1.destination ?? "landing_page",
    identity: part1.identity ?? "their_page",
    method:
      "We draw every room in 3D before you buy a single thing. You see the full price, line by line, before we start, and one designer stays with you to the handover.",
    not_for:
      "People who want one room done cheaply, or who shop each item themselves.",
    city_cant:
      "Most firms here design and leave. We stay on site until the last cushion is in place.",
    pricing:
      "A fixed design fee, then the fit-out at cost plus our fee. Most whole-villa projects land between 180,000 and 260,000.",
    minimum: { amount: f.money.minimum, currency: f.money.currency },
    anchor: { amount: f.money.anchor, currency: f.money.currency },
    terms: "30 percent at signing, 40 at the material order, 30 at handover.",
    competitors: [
      { name: "Lines and Light Studio", lose: true },
      { name: "Dune House Interiors", lose: false },
      { name: "Atelier Wadi", lose: true },
      { name: "The furniture showrooms' free design", lose: false },
    ],
    why_us:
      "We show the whole villa drawn and priced before anyone signs, so nothing changes halfway.",
    approval: "first_batch",
    rules: {
      always: ["Our real projects", "The designer's name"],
      never: ["Discounts or limited offers", "Prices in the ad"],
      neverShow: ["The Al Malqa villa", "Clients' faces"],
    },
    camera: "yes_phone",
    ...(f.words ?? {}),
  };
  for (const k of Object.keys(sent)) if (sent[k] === undefined) delete sent[k];
  if (state === "sent") return sent;
  const closed: Answers = {
    ...sent,
    dna_status: f.dna ? "small_gaps" : "big_gaps",
    dna_missing: "The tone section is blank, and no logo files in the doc.",
    content_rating: "usable",
    shot_list: true,
    shot_list_due: "2026-10-25T07:00:00Z",
    events: "A home show at the end of November.",
    readback_yes: true,
    csm_signals: "They may add a second designer in January.",
    offer: {
      name: "The Whole Villa Plan",
      what: "Every room drawn in 3D and priced line by line",
      firstStep: "A free design visit with your lead designer",
    },
    ...(f.words?.offer ? { offer: f.words.offer } : {}),
  };
  if (state === "closed") return closed;
  return {
    ...closed,
    scripts_status: "in_progress",
    scripts_date: "2026-10-27",
  };
}

function partsFor(state: BpState, answers: Answers): Record<string, PartStamp> {
  const stamp = (at: string, part: BpPart): PartStamp => ({
    status: "done",
    firstAt: at,
    lastAt: at,
    presses: 1,
    firstBy: "Sara",
    lastBy: "Sara",
    sent: partAnswers(part, answers),
  });
  const out: Record<string, PartStamp> = {};
  if (state === "sent" || state === "closed" || state === "locked")
    out["1"] = stamp("2026-10-22T07:12:00Z", 1);
  if (state === "closed" || state === "locked")
    out["2"] = stamp("2026-10-22T07:44:00Z", 2);
  if (state === "locked") out["3"] = stamp("2026-10-24T08:30:00Z", 3);
  return out;
}

export function blueprintLoaded(
  key: BpFixture,
  state: BpState,
  opts: { rehearse: boolean },
): Loaded {
  const f = FIRMS[key] ?? FIRMS.full;
  const k = kit(f);
  const answers = answersFor(f, key, state);
  const launchBooked = state === "closed" || state === "locked";
  const sources = sourcesSchema.parse({
    taskId: f.taskId,
    clientName: f.name,
    presenter: { firstName: "Sara" },
    client: {
      stage: "Brand Blueprint Booked",
      service: "DFY",
      launchDate: null,
      bucket: "onboarding",
    },
    logo: f.logo
      ? { bucket: "cockpit-client-logos", path: LOGO, verifiedAt: "2026-10-12" }
      : null,
    ghl: {
      name: f.nameAr ?? f.name,
      country: f.country,
      city: f.city,
      language: key === "full" || key === "arabic" ? "ar" : "en",
      serviceMode: "DFY",
    },
    editor: {
      brandDna: f.dna,
      brandDnaUrl: f.dna
        ? "https://docs.google.com/document/d/fixture-brand-dna"
        : null,
      offerUrl: "https://docs.google.com/document/d/fixture-offer-sheet",
      driveUrl: folder(`1FixtureDrive${f.taskId.slice(-4)}0000`),
    },
    dosDonts: f.dosDonts ? { text: f.dosDonts, source: "card" } : null,
    kit: {
      onboardingCallOn: "2026-10-16",
      links: { driveFolder: folder(`1FixtureDrive${f.taskId.slice(-4)}0000`) },
    },
    calls: {
      next: launchBooked
        ? { launch: { startsAt: "2026-10-29T10:00:00Z" } }
        : {},
      last: { blueprint: { startsAt: BP_CALL_AT, status: "held" } },
    },
    prep: {
      onboarding: {
        deck: "onboarding",
        overrides: {
          ...(f.redLines.length
            ? { red_lines: f.redLines, red_lines_ar: f.redLinesAr }
            : {}),
          services: f.list,
        },
        revision: 3,
      },
    },
    launchAds: [],
    notes: f.kickoff
      ? []
      : ["No kickoff on record: ask the service and the budget."],
  });
  const row: BlueprintRow | null =
    state === "open"
      ? null
      : {
          taskId: f.taskId,
          clientName: f.name,
          answers,
          meta: Object.fromEntries(
            Object.keys(answers).map(x => [
              x,
              {
                by: "Sara",
                at: "2026-10-22T07:05:00Z",
                from:
                  f.kickoff &&
                  [
                    "service",
                    "starter",
                    "daily_budget",
                    "identity",
                    "destination",
                  ].includes(x)
                    ? "kickoff"
                    : x === "best_client"
                      ? "onboarding.ideal"
                      : x === "red_lines" && f.redLines.length
                        ? "deck.red_lines"
                        : null,
              },
            ]),
          ),
          parts: partsFor(state, answers),
          revision: 7,
          launchTaskId: state === "part1" ? null : "86fixturelaunch",
          outbox: null,
        };
  const doneRow = (n: string, kind: string, at: string) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    state: "done",
    error: null,
    result: kind === "1" ? { launchTaskId: "86fixturelaunch" } : {},
    createdAt: at,
    settledAt: at,
  });
  const bundle: BlueprintBundle = {
    can: { write: true, rehearse: opts.rehearse },
    card: {
      templatedAds: f.templated || null,
      canSelfRecord: key === "full" ? "Yes - phone only" : null,
      adApproval: null,
      offerCreation: null,
    },
    steps: {
      parentId: "86fixtureparent",
      parentName: `${f.name} - Creative Onboarding`,
      steps: {
        "2": {
          taskId: "86fixturestep2",
          parentId: "86fixtureparent",
          name: "2 · Brand Blueprint call",
          status: "to do",
        },
        "3": {
          taskId: "86fixturestep3",
          parentId: "86fixtureparent",
          name: "3 · Lock the offer and Brand DNA",
          status: "to do",
        },
        "4": {
          taskId: "86fixturestep4",
          parentId: "86fixtureparent",
          name: "4 · Select Templated Creatives So They Can Launch",
          status: "to do",
        },
      },
    },
    settings: {
      packs: f.packs ? PACKS : {},
      assignee:
        key === "full"
          ? { id: "48210001", label: "The launch media buyer" }
          : null,
      closeRoute: "card_only",
    },
    row,
    outbox: {
      "1": row?.parts["1"] ? doneRow("1", "1", "2026-10-22T07:12:20Z") : null,
      "2": row?.parts["2"] ? doneRow("2", "2", "2026-10-22T07:44:20Z") : null,
      "3": row?.parts["3"] ? doneRow("3", "3", "2026-10-24T08:30:20Z") : null,
    },
  };
  return {
    sources,
    kit: k,
    ads: [],
    prep: {
      onboarding: (sources.prep?.onboarding?.overrides ?? {}) as Record<
        string,
        unknown
      >,
      launch: {},
      blueprint: {},
    },
    problems: [],
    videos: null,
    videosProblem: null,
    blueprint: bundle,
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * The harness's stand-ins for the Blueprint's writes: an in-memory record
 * with the server's per-field rules (a key another session changed since
 * this browser saw it is a conflict), a press that queues after 300 ms and
 * runs after a second and a half, and a rehearsal's plan written here.
 */
export function fakeBlueprintIO(loaded: Loaded, now: () => Date): BlueprintIO {
  const row = loaded.blueprint?.row;
  let answers: Answers = { ...(row?.answers ?? {}) };
  let revision = row?.revision ?? 0;
  const parts: Record<string, PartStamp> = { ...(row?.parts ?? {}) };
  const name = loaded.sources?.clientName ?? "The client";
  return {
    packStandIn: [interiorFeed, interiorReel, fitoutFeed, fitoutReel],
    save: async (changes: Record<string, Change>): Promise<SaveResult> => {
      await sleep(120);
      const applied: string[] = [];
      for (const [k, c] of Object.entries(changes)) {
        applied.push(k);
        const v = c.value;
        if (v === null || v === undefined) delete answers[k];
        else answers = { ...answers, [k]: v };
        if (k === "shot_list") {
          if (v === true)
            answers.shot_list_due = new Date(
              Date.parse(BP_CALL_AT) + 72 * 3_600_000,
            ).toISOString();
          else delete answers.shot_list_due;
        }
      }
      revision += 1;
      return {
        row: { answers: { ...answers }, revision, parts },
        applied,
        conflicts: [],
      };
    },
    partDone: async (part, requestId) => {
      await sleep(300);
      const key = String(part);
      const at = now().toISOString();
      const old = parts[key];
      parts[key] = {
        status: "done",
        firstAt: old?.firstAt ?? at,
        lastAt: at,
        presses: (old?.presses ?? 0) + 1,
        sent: answers,
      };
      return {
        id: requestId,
        state: "pending",
        part,
        firstAt: parts[key].firstAt,
        presses: parts[key].presses,
      };
    },
    run: async id => {
      await sleep(1500);
      return { id, state: "done", result: { launchTaskId: "86fixturelaunch" } };
    },
    rehearse: async part => {
      await sleep(1500);
      const due = B.kuwaitDay(B.launchDue(now()).ms);
      const lines =
        part === 1
          ? [
              `Would create "${B.launchName(name)}" on Marketing/ADs from template ${B.LAUNCH_TEMPLATE}.`,
              `Would tag it "${B.launchTag(name)}".`,
              `Would assign it to the launch media buyer, due ${due}.`,
              "Would comment the brief (14 lines).",
              "Would set Templated Ads Status: Wants To See Them First → Approved.",
              'Would complete "4 · Select Templated Creatives So They Can Launch".',
            ]
          : part === 2
            ? [
                "Would set Ad Approval Needed?: Yes.",
                "Would set Can Self-Record?: Yes - phone only.",
                "Would set the Onboarding Map to phase 5.",
                'Would complete "2 · Brand Blueprint call".',
                `Would comment on the launch task "${B.launchName(name)}" (9 lines).`,
                "Would comment on the client card for the CSM, with the phase 5 WhatsApp to paste.",
              ]
            : [
                "Would set Offer Creation: Done.",
                'Would comment on "3 · Lock the offer and Brand DNA": Brand DNA still missing.',
                `Would comment on the launch task "${B.launchName(name)}": offer locked.`,
              ];
      return { lines, missing: [] };
    },
  };
}
