/**
 * Three made-up clients for the deck harness and the screenshot runs: every
 * name, answer and picture here is invented for the harness (the pictures
 * are crops of Mahara's own renders), never another client's material.
 *
 * - full: Saudi, a logo, the onboarding and kickoff forms filed, services,
 *   access answers, a starter pack with two starter ads, Do's & Don'ts, the
 *   Blueprint booked.
 * - sparse: no logo, no forms, no country, no service model, no CSM name,
 *   nothing booked.
 * - dwy: done with you, in the UAE, answers written in Arabic, one goal
 *   held back (it counts appointments), templated ads declined.
 * - starter (the launch deck): Kuwait, only starter ads, already live, the
 *   ad opening a WhatsApp chat, no Instagram handle, no consultant's name,
 *   no Do's & Don'ts.
 *
 * Asked for the launch deck, each client is a week further on: the launch
 * call is booked, their creatives are in the tray, a form is confirmed.
 */

import type { OnboardingRow } from "@/lib/onboardingCore";
import type { Overrides } from "@/present/deckData";
import type {
  DeckKind,
  DeckVideos,
  VideoLang,
  VideoProvider,
  VideoRow,
} from "@/present/sources";
import { type LaunchAd, sourcesSchema } from "@/present/sources";
import type { Loaded } from "@/present/useDeckModel";
import { deckSlots, slotId } from "@/present/videos";
import siteFeed from "./custom-site.webp";
import siteTall from "./custom-site-tall.webp";
import square from "./custom-square.webp";
import feedPic from "./starter-feed.webp";
import reelPic from "./starter-reel.webp";

export type FixtureKey = "full" | "sparse" | "dwy" | "starter";

const LOGO = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="none"/><path d="M60 150V58l80 92V58" fill="none" stroke="#1d2a3a" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><circle cx="140" cy="44" r="9" fill="#b8925a"/></svg>`,
)}`;

const answer = (title: string, value: string) => ({ ref: title, title, value });

function row(
  taskId: string,
  name: string,
  extra: Partial<OnboardingRow>,
): OnboardingRow {
  return {
    clickup_task_id: taskId,
    client_name: name,
    clickup_status: "onboarding booked",
    client_status: null,
    in_onboarding: true,
    csm: null,
    signup_on: null,
    onboarding_call_on: null,
    launch_on: null,
    links: {},
    handover: {},
    sales_transcript: null,
    card_updated_at: null,
    seen_at: "2026-10-19T06:00:00Z",
    synced_at: "2026-10-19T06:00:00Z",
    ...extra,
  };
}

function ad(
  id: string,
  kind: LaunchAd["kind"],
  url: string,
  w: number,
  h: number,
  extra: Partial<LaunchAd> = {},
): LaunchAd {
  return {
    id,
    taskId: "fixture",
    kind,
    status: "ready",
    path: `fixture/${id}.webp`,
    mime: "image/webp",
    bytes: 100_000,
    width: w,
    height: h,
    seconds: null,
    posterPath: null,
    posterMime: null,
    fileName: `${id}.webp`,
    placement: null,
    primaryText: null,
    headline: null,
    cta: null,
    language: null,
    hidden: false,
    createdAt: "2026-10-18T10:00:00Z",
    url,
    posterUrl: null,
    ...extra,
  };
}

/**
 * One video row as the server returns it (VIDEOS.md 4). The links are
 * Mahara's own recordings, the six the migration seeds; `testing` carries a
 * made-up Loom id, harness only, so slide 3's control shows in the shots.
 */
function video(
  deck: DeckKind,
  slotKey: string,
  lang: VideoLang,
  provider: VideoProvider,
  id: string,
  seconds: number | null,
  title: string | null = null,
): VideoRow {
  const links: Record<VideoProvider, [string, string]> = {
    wistia: [
      `https://fast.wistia.net/embed/iframe/${id}`,
      `https://fast.wistia.net/embed/iframe/${id}?seo=false`,
    ],
    loom: [
      `https://www.loom.com/share/${id}`,
      `https://www.loom.com/embed/${id}?hideEmbedTopBar=true`,
    ],
    youtube: [
      `https://www.youtube.com/watch?v=${id}`,
      `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&enablejsapi=1`,
    ],
    vimeo: [
      `https://vimeo.com/${id}`,
      `https://player.vimeo.com/video/${id}?dnt=1`,
    ],
    drive: [
      `https://drive.google.com/file/d/${id}/view`,
      `https://drive.google.com/file/d/${id}/preview`,
    ],
  };
  return {
    deck,
    slotKey,
    lang,
    provider,
    url: links[provider][0],
    embedUrl: links[provider][1],
    title,
    durationSeconds: seconds,
    revision: 1,
    updatedBy: "migration 20261020120000_csm_deck_videos",
    updatedAt: "2026-10-20T12:00:00+00:00",
  };
}

/** The six seeds (VIDEOS.md 6), and the slots the server knows. */
export function seededVideos(
  deck: DeckKind,
  extra: VideoRow[] = [],
): DeckVideos {
  const seeds = [
    video("onboarding", "welcome", "any", "wistia", "up0z6n691k", 148),
    video(
      "onboarding",
      "meta-access",
      "any",
      "loom",
      "e2d83bffee614d9aa035d898d37d8989",
      94,
    ),
    video(
      "onboarding",
      "whatsapp-calendar",
      "any",
      "loom",
      "4ddc5519935f4ba8bdc7ac6f3667a701",
      231,
    ),
    video("launch", "portal-guide", "en", "wistia", "lxlse6ckhf", 277),
    video("launch", "portal-guide", "ar", "wistia", "hyuxh7skjv", 285),
    video(
      "launch",
      "calendar-hours",
      "any",
      "loom",
      "6aa67297dfcf421887f8961d3c1c7768",
      11,
    ),
  ];
  return {
    rows: [...seeds, ...extra].filter(r => r.deck === deck),
    refused: [],
    slots: deckSlots(deck).map(slotId),
  };
}

/** Slide 4's slot, recorded for the harness (a made-up Loom id). */
const TESTING = (deck: DeckKind) =>
  video(
    deck,
    "testing",
    "any",
    "loom",
    "0f0e0d0c0b0a09080706050403020100",
    160,
  );

function full(deck: DeckKind = "onboarding"): Loaded {
  const taskId = "fixture-full";
  const launch = deck === "launch";
  const kit = row(taskId, "Noor Studio Interiors", {
    signup_on: "2026-10-12",
    onboarding_call_on: "2026-10-19",
    launch_on: launch ? "2026-10-26" : null,
    links: { drive_folder: "https://drive.google.com/drive/folders/fixture" },
    forms: {
      onboarding: {
        form_id: "KFRCXPFx",
        response_id: "r1",
        submitted_at: "2026-10-14T15:20:00Z",
        answers: [
          answer("Business Name", "Noor Studio Interiors"),
          answer(
            "What services do you offer, and their prices?",
            "Kitchens - from 25,000 SAR\nBathrooms\nFull villa fit-out\nInterior design (consultation 1,500 SAR)",
          ),
          answer("What is your #1 service you want to grow?", "Kitchens"),
          answer(
            "What is your goal for the next 90 Days?",
            "Two to three kitchen projects signed every month, mostly in north Riyadh.",
          ),
          answer(
            "Where do you want the business to be in 12-24 months?",
            "A second showroom in Jeddah, and a team that runs the projects without me on site daily.",
          ),
          answer(
            "What are your TOP 3 challenges right now?",
            "1. Most enquiries come from people who only want a price.\n2. Referrals dried up after summer.\n3. We lose time on site visits that go nowhere.",
          ),
          answer(
            "What motivated you to join Mahara?",
            "We saw the system work for a friend's firm, and we want steady projects, not luck.",
          ),
          answer(
            "What types of appointments do you offer?",
            "At our showroom, At the client's home",
          ),
          answer("What are your service areas?", "Riyadh, north and east"),
          answer(
            "What is your Instagram URL?",
            "https://instagram.com/noorstudio.sa",
          ),
          answer("Who are the engineers or designers?", "Eng. Khalid"),
          answer(
            "Do you offer free consultations?",
            "Yes, the first showroom visit is free",
          ),
          answer(
            "What are your business hours?",
            "Saturday to Thursday, 10am to 8pm",
          ),
        ],
      },
      kickoff: {
        form_id: "tG7dnxBn",
        response_id: "k1",
        submitted_at: "2026-10-19T08:10:00Z",
        answers: [
          answer("Which service are we advertising?", "Kitchens"),
          answer(
            "Which platforms will we advertise on?",
            "Instagram, Facebook",
          ),
          answer("What is the name of the Facebook page?", "Noor Studio"),
          answer("Templated Ads Status", "Wants To See Them First"),
          answer("Card linked to the account?", "Yes"),
          answer("Facebook access", "Access confirmed"),
          answer("Google Calendar Integration", "Not yet"),
          answer("Mahara OS access", "Logged in"),
          answer("WhatsApp synced to Mahara OS", "No"),
          answer("Do they have pre-existing leads?", "Yes"),
          answer("Link or notes for those leads", "Sheet shared in the group"),
        ],
      },
    },
  });
  const sources = sourcesSchema.parse({
    taskId,
    clientName: "Noor Studio Interiors",
    presenter: { email: "sara@example.com", firstName: "Sara" },
    client: {
      stage: launch ? "Launch Booked" : "Onboarding Booked",
      service: "DFY",
      launchDate: null,
      bucket: "onboarding",
    },
    logo: {
      bucket: "cockpit-client-logos",
      path: LOGO,
      verifiedAt: "2026-10-01",
    },
    ghl: {
      name: "استوديو نور للتصميم الداخلي",
      country: "SA",
      city: "Riyadh",
      language: "ar",
      serviceMode: "DFY",
    },
    dosDonts: {
      text: "DO's:\n- Show our real projects, never stock photos\nDON'Ts:\n- Never show prices in an ad\n- No before-and-after of client homes\nNOTES:\n- Owner prefers calls after 4",
      source: "card",
    },
    kit: {
      onboardingCallOn: "2026-10-19",
      launchOn: null,
      signupOn: "2026-10-12",
      links: { driveFolder: "https://drive.google.com/drive/folders/fixture" },
    },
    callers: [{ firstName: "Huda" }],
    calls: {
      next: launch
        ? { launch: { startsAt: "2026-10-22T13:00:00Z" } }
        : { blueprint: { startsAt: "2026-10-22T13:00:00Z" } },
      last: launch ? { blueprint: { startsAt: "2026-10-21T10:00:00Z" } } : {},
    },
    meta: launch
      ? {
          campaigns: [],
          funnels: [
            {
              sourceId: "native:fixture-form",
              formId: "9100000001",
              formName: "Kitchens, showroom visit",
              kind: "Instant form",
              headline: "Book a visit to our Riyadh showroom",
              questions: [
                {
                  type: "CUSTOM",
                  label: "Which do you need?",
                  options: [
                    "A new kitchen",
                    "Renovating my kitchen",
                    "Wardrobes",
                  ],
                  isGate: false,
                },
                {
                  type: "CUSTOM",
                  label: "When would you like to start?",
                  options: ["Within a month", "In 1 to 3 months", "Later"],
                  isGate: true,
                },
                {
                  type: "CUSTOM",
                  label: "Where is your home?",
                  options: ["North Riyadh", "East Riyadh", "Outside Riyadh"],
                  isGate: true,
                },
                { type: "FULL_NAME", label: "Full name" },
                { type: "PHONE", label: "Phone number" },
              ],
              adIds: [],
            },
          ],
          ads: [
            {
              id: "120200000000001",
              name: "Kitchen site, square",
              still: { url: square },
            },
          ],
        }
      : null,
    launchAds: [],
    notes: [],
  });
  const prep: { onboarding: Overrides; launch: Overrides } = {
    onboarding: launch
      ? {
          starter_pack: true,
          service_focus: "Kitchens",
          service_focus_ar: "المطابخ",
          red_lines: ["No photos of the owner", "No music with lyrics"],
          red_lines_ar: ["لا تحطون صور المالك", "بدون موسيقى فيها كلمات"],
        }
      : {
          starter_pack: true,
          // Three typed live on O7: the plant's tightest fit (DESIGN 9.7).
          red_lines: [
            "No photos of the owner",
            "No music with lyrics",
            "Never show prices in an ad",
          ],
        },
    launch: launch
      ? {
          // Five red lines and the stamp: slide 3's tightest stop (DESIGN
          // 21.1), stamped on the launch call's own day (the cover's date).
          creative_agreed_at: "2026-10-19T10:20:00Z",
          // The services in Arabic, so the Arabic queue card names each
          // row's own (score round 2), never the first one three times.
          services_ar: [
            "المطابخ",
            "الحمامات",
            "تشطيب فيلا كاملة",
            "التصميم الداخلي",
          ],
          form_confirmed: "9100000001",
          their_pick: "custom-site",
          cover_creative: "custom-site",
          pain: "design",
          selling_point: "we draw your kitchen in 3D before any work starts",
          selling_point_ar: "نرسم لك المطبخ ثلاثي الأبعاد قبل لا نبدي أي شغل",
          engineer_ar: "المهندس خالد",
          call_guide_checked: true,
        }
      : {},
  };
  const custom = launch
    ? [
        ad("custom-site", "custom", siteFeed, 720, 900, {
          primaryText:
            "Built right, shown honestly: this is one of our sites in north Riyadh this week.",
          headline: "See a site in progress",
          cta: "GET_QUOTE",
          language: "en",
          fileName: "site-north-riyadh.webp",
        }),
        ad("custom-tall", "custom", siteTall, 540, 960, {
          primaryText: "A minute on site with our team.",
          cta: "LEARN_MORE",
          language: "en",
          fileName: "site-walk.webp",
        }),
        ad("custom-square", "custom", square, 800, 800, {
          primaryText:
            "مطبخك يتصمم على طريقة طبخ عائلتك. احجز زيارة لمعرضنا في الرياض.",
          headline: "مطابخ نور ستوديو",
          cta: "BOOK_NOW",
          language: "ar",
          fileName: "villa-ar.webp",
        }),
      ]
    : [];
  return {
    sources,
    kit,
    ads: [
      ...custom,
      ad("starter-feed", "starter", feedPic, 864, 1080, {
        primaryText:
          "Your kitchen, designed around how your family cooks. Book a visit to our Riyadh showroom.",
        headline: "Kitchens by Noor Studio",
        cta: "BOOK_NOW",
        language: "en",
      }),
      ad("starter-reel", "starter", reelPic, 608, 1080, {
        primaryText: "From the first drawing to the last cabinet.",
        cta: "LEARN_MORE",
        language: "en",
      }),
    ],
    prep,
    problems: [],
    videos: seededVideos(deck, [TESTING(deck)]),
  };
}

function sparse(_deck: DeckKind = "onboarding"): Loaded {
  const taskId = "fixture-sparse";
  const sources = sourcesSchema.parse({
    taskId,
    clientName: "Atlas Fit-Out & Renovation Contracting",
    presenter: { email: null, firstName: null },
    client: {
      stage: "Needs Contacting",
      service: null,
      launchDate: null,
      bucket: "onboarding",
    },
    logo: null,
    ghl: null,
    dosDonts: { text: null, source: "card" },
    kit: null,
    callers: null,
    calls: { next: {}, last: {} },
    launchAds: [],
    notes: [],
  });
  return {
    sources,
    kit: row(taskId, "Atlas Fit-Out & Renovation Contracting", {
      clickup_status: "needs contacting",
    }),
    ads: [],
    prep: { onboarding: {}, launch: {} },
    problems: ["The deck's videos are not live yet, so no video shows."],
    videos: null,
    videosProblem: "The deck's videos are not live yet, so no video shows.",
  };
}

function dwy(deck: DeckKind = "onboarding"): Loaded {
  const taskId = "fixture-dwy";
  const launch = deck === "launch";
  const kit = row(taskId, "Saha Kitchens", {
    signup_on: "2026-10-09",
    links: {},
    forms: {
      onboarding: {
        form_id: "KFRCXPFx",
        response_id: "r3",
        submitted_at: "2026-10-11T12:00:00Z",
        answers: [
          answer("Business Name", "Saha Kitchens"),
          answer(
            "What services do you offer, and their prices?",
            "مطابخ حسب الطلب، خزائن ملابس، تجديد مطابخ قديمة",
          ),
          answer(
            "What is your #1 service you want to grow?",
            "مطابخ حسب الطلب",
          ),
          answer(
            "What is your goal for the next 90 Days?",
            "نبي نوصل لمشروعين مطابخ كل شهر في دبي والشارقة.",
          ),
          answer(
            "Where do you want the business to be in 12-24 months?",
            "20 appointments a month and a full sales team.",
          ),
          answer(
            "What are your TOP 3 challenges right now?",
            "الاستفسارات كثيرة بس أغلبها أسعار. ما عندنا وقت نتابع كل واحد. المعرض بعيد عن أغلب العملاء.",
          ),
          answer("What are your service areas?", "Dubai, Sharjah"),
          answer(
            "What types of appointments do you offer?",
            "في المعرض، أونلاين",
          ),
          answer("Do you offer free consultations?", "نعم"),
        ],
      },
      kickoff: {
        form_id: "tG7dnxBn",
        response_id: "k3",
        submitted_at: "2026-10-16T10:00:00Z",
        answers: [
          answer("Which service are we advertising?", "Custom kitchens"),
          answer("Templated Ads Status", "Declined"),
          answer("Facebook access", "Access confirmed"),
          answer("Card linked to the account?", "No"),
        ],
      },
    },
  });
  const sources = sourcesSchema.parse({
    taskId,
    clientName: "Saha Kitchens",
    presenter: { email: "omar@example.com", firstName: "Omar" },
    client: {
      stage: launch ? "Launch Booked" : "Brand Blueprint Booked",
      service: "DWY",
      launchDate: null,
      bucket: "onboarding",
    },
    logo: null,
    ghl: {
      name: "مطابخ ساحة",
      country: "AE",
      city: "Dubai",
      language: "ar",
      serviceMode: "DWY",
    },
    dosDonts: null,
    kit: {
      onboardingCallOn: "2026-10-16",
      launchOn: null,
      signupOn: "2026-10-09",
      links: {},
    },
    callers: [],
    calls: {
      next: { blueprint: { startsAt: "2026-10-21T11:00:00Z" } },
      last: { onboarding: { startsAt: "2026-10-16T10:00:00Z" } },
    },
    launchAds: [],
    notes: [],
  });
  return {
    sources,
    kit,
    ads: launch
      ? [
          ad("dwy-square", "custom", square, 800, 800, {
            primaryText: "مطبخك على مقاسك، من التصميم إلى التركيب.",
            cta: "SEND_WHATSAPP_MESSAGE",
            language: "ar",
            fileName: "kitchen-ar.webp",
          }),
        ]
      : [],
    prep: {
      onboarding: {
        service_focus: "مطابخ حسب الطلب",
        red_lines: ["لا تذكرون الأسعار في الإعلان"],
        access: { meta_access: "done" },
        ...(launch ? { onboarding_presented_at: "2026-10-16T10:20:00Z" } : {}),
      },
      launch: launch ? { shown_slides: ["form"], go_live: "2026-10-27" } : {},
    },
    problems: [],
    videos: seededVideos(deck, [TESTING(deck)]),
  };
}

/** A client whose launch runs on starter ads alone, already live. */
function starter(_deck: DeckKind = "launch"): Loaded {
  const taskId = "fixture-starter";
  const kit = row(taskId, "Al Reem Kitchens & Wardrobes Co.", {
    signup_on: "2026-10-01",
    onboarding_call_on: "2026-10-05",
    launch_on: "2026-10-15",
    forms: {
      onboarding: {
        form_id: "KFRCXPFx",
        response_id: "r4",
        submitted_at: "2026-10-03T09:00:00Z",
        answers: [
          answer("Business Name", "Al Reem Kitchens & Wardrobes Co."),
          answer(
            "What services do you offer, and their prices?",
            "Kitchens, Wardrobes",
          ),
          answer("What is your #1 service you want to grow?", "Kitchens"),
          answer(
            "What are your service areas?",
            "Kuwait City, Hawalli, Salmiya",
          ),
          answer(
            "What types of appointments do you offer?",
            "Online video call",
          ),
          answer("Do you offer free consultations?", "No"),
          answer("What are your business hours?", "9am to 2pm"),
        ],
      },
      kickoff: {
        form_id: "tG7dnxBn",
        response_id: "k4",
        submitted_at: "2026-10-05T11:00:00Z",
        answers: [
          answer("Which service are we advertising?", "Kitchens"),
          answer("Templated Ads Status", "Approved"),
          answer("Card linked to the account?", "Yes"),
          answer("Facebook access", "Access confirmed"),
          answer("Google Calendar Integration", "Connected"),
          answer("Mahara OS access", "Logged in"),
        ],
      },
    },
  });
  const sources = sourcesSchema.parse({
    taskId,
    clientName: "Al Reem Kitchens & Wardrobes Co.",
    presenter: { email: "sara@example.com", firstName: "Sara" },
    client: {
      stage: "Ready For Launch",
      service: "DFY",
      launchDate: "2026-10-15",
      bucket: "launch",
    },
    logo: null,
    ghl: {
      name: "مطابخ الريم",
      country: "KW",
      city: "Kuwait City",
      language: "ar",
      serviceMode: "DFY",
    },
    dosDonts: { text: null, source: "card" },
    kit: {
      onboardingCallOn: "2026-10-05",
      launchOn: "2026-10-15",
      signupOn: "2026-10-01",
      links: {},
    },
    callers: [{ firstName: "Huda" }],
    calls: { next: {}, last: { launch: { startsAt: "2026-10-14T10:00:00Z" } } },
    meta: {
      campaigns: [],
      funnels: [
        {
          sourceId: "native:fixture-wa",
          formId: null,
          formName: "WhatsApp, kitchens",
          kind: "WhatsApp",
          questions: [],
          adIds: [],
        },
      ],
      ads: [],
    },
    launchAds: [],
    notes: [],
  });
  return {
    sources,
    kit,
    ads: [
      ad("starter-feed", "starter", feedPic, 864, 1080, {
        primaryText: "مطبخك يتصمم على طريقة طبخ عائلتك.",
        cta: "SEND_WHATSAPP_MESSAGE",
        language: "ar",
      }),
      ad("starter-reel", "starter", reelPic, 608, 1080, {
        primaryText: "من أول رسمة لآخر خزانة.",
        cta: "SEND_WHATSAPP_MESSAGE",
        language: "ar",
      }),
    ],
    prep: {
      onboarding: {
        starter_pack: true,
        onboarding_presented_at: "2026-10-05T11:30:00Z",
      },
      launch: { form_confirmed: "native:fixture-wa" },
    },
    problems: [],
    videos: { rows: [], refused: [], slots: deckSlots("launch").map(slotId) },
  };
}

export const FIXTURES: Record<FixtureKey, (deck?: DeckKind) => Loaded> = {
  full,
  sparse,
  dwy,
  starter,
};
