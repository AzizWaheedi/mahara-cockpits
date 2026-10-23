/**
 * Three made-up clients for the deck harness and the screenshot runs: every
 * name, answer and picture here is invented for the harness (the pictures
 * are crops of Mahara's own renders), never another client's material.
 *
 * - full: Saudi, an interior design firm (the kickoff advertises Interior
 *   design), a logo, the onboarding and kickoff forms filed, services,
 *   access answers, a starter pack with two starter ads, Do's & Don'ts, the
 *   Blueprint booked.
 * - sparse: no logo, no forms, no country, no service model, no CSM name,
 *   nothing booked; its name reads as design and build, so the example ads
 *   show that service's pictures.
 * - dwy: done with you, in the UAE, a construction firm (Construction only),
 *   answers written in Arabic, one service that fits none of the five (so
 *   slide 4 shows "Other"), one goal held back (it counts appointments),
 *   templated ads declined.
 * - starter (the launch deck): Kuwait, a fit-out and renovation firm, only
 *   starter ads, already live, the ad opening a WhatsApp chat, no Instagram
 *   handle, no consultant's name, no Do's & Don'ts.
 *
 * Each fixture advertises a different main service (DESIGN 22.14), so every
 * service's example pictures are seen; none names a sub-trade (kitchens,
 * bathrooms) as the service.
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
import siteTall from "./custom-hall-tall.webp";
import siteFeed from "./custom-site.webp";
import square from "./custom-square.webp";
import dwyVilla from "./dwy-villa.webp";
import fitoutFeedPic from "./starter-fitout-feed.webp";
import fitoutReelPic from "./starter-fitout-reel.webp";
import feedPic from "./starter-interior-feed.webp";
import reelPic from "./starter-interior-reel.webp";

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
  /** The poster the migration seeds for this row (VIDEOS.md 9). */
  posterUrl: string | null = null,
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
    // The video slots are the CSM decks' only.
    deck: deck as VideoRow["deck"],
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
    ...(posterUrl ? { posterUrl } : {}),
  };
}

/**
 * The posters 20261020160200_csm_deck_video_posters.sql seeds for the six
 * rows, so the harness shows prep and the notes as production will (the
 * fixer's round: the Loom rows fell back to the designed card).
 */
const SEED_POSTER = {
  welcome:
    "https://embed-ssl.wistia.com/deliveries/c3cdb9067a8a3c9ae21dede3cf45611b739ee3f1.jpg?image_crop_resized=960x540",
  meta: "https://cdn.loom.com/sessions/thumbnails/e2d83bffee614d9aa035d898d37d8989-b17bc3f4ce782f9b.jpg",
  whatsapp:
    "https://cdn.loom.com/sessions/thumbnails/4ddc5519935f4ba8bdc7ac6f3667a701-1ddb7d7f640afcbd.jpg",
  portalEn:
    "https://embed-ssl.wistia.com/deliveries/02b381c067d9a4e711551bdc4923c80a0b28e6f6.jpg?image_crop_resized=960x540",
  portalAr:
    "https://embed-ssl.wistia.com/deliveries/234d6305c6581a586700670201e21c8f488eaa5f.jpg?image_crop_resized=960x540",
  calendar:
    "https://cdn.loom.com/sessions/thumbnails/6aa67297dfcf421887f8961d3c1c7768-a2384fa2a097cc77.jpg",
} as const;

/** The six seeds (VIDEOS.md 6), and the slots the server knows. */
export function seededVideos(
  deck: DeckKind,
  extra: VideoRow[] = [],
): DeckVideos {
  const seeds = [
    video(
      "onboarding",
      "welcome",
      "any",
      "wistia",
      "up0z6n691k",
      148,
      null,
      SEED_POSTER.welcome,
    ),
    video(
      "onboarding",
      "meta-access",
      "any",
      "loom",
      "e2d83bffee614d9aa035d898d37d8989",
      94,
      null,
      SEED_POSTER.meta,
    ),
    video(
      "onboarding",
      "whatsapp-calendar",
      "any",
      "loom",
      "4ddc5519935f4ba8bdc7ac6f3667a701",
      231,
      null,
      SEED_POSTER.whatsapp,
    ),
    video(
      "launch",
      "portal-guide",
      "en",
      "wistia",
      "lxlse6ckhf",
      277,
      null,
      SEED_POSTER.portalEn,
    ),
    video(
      "launch",
      "portal-guide",
      "ar",
      "wistia",
      "hyuxh7skjv",
      285,
      null,
      SEED_POSTER.portalAr,
    ),
    video(
      "launch",
      "calendar-hours",
      "any",
      "loom",
      "6aa67297dfcf421887f8961d3c1c7768",
      11,
      null,
      SEED_POSTER.calendar,
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
            "Villa interiors - from 25,000 SAR\nKitchens and wardrobes\nMajlis design\nFull villa fit-out\nInterior design (consultation 1,500 SAR)",
          ),
          answer(
            "What is your #1 service you want to grow?",
            "Villa interiors",
          ),
          answer(
            "What is your goal for the next 90 Days?",
            "Two to three villa interior projects signed every month, mostly in north Riyadh.",
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
          answer("Which service are we advertising?", "Interior design"),
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
              formName: "Interiors, showroom visit",
              kind: "Instant form",
              headline: "Book a visit to our Riyadh showroom",
              questions: [
                {
                  type: "CUSTOM",
                  label: "Which do you need?",
                  options: [
                    "A whole villa interior",
                    "One room or a majlis",
                    "A design consultation",
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
              name: "Family majlis, square",
              still: { url: square },
            },
          ],
        }
      : null,
    launchAds: [],
    notes: [],
  });
  // Their services in Arabic, typed in prep (onboarding side): the Arabic
  // decks' slide 4 lines and queue card name each in Arabic, one script
  // per card (score round 1: O4 read "Villa interiors" under تصميم داخلي).
  const servicesAr = [
    "تصميم داخلي للفلل",
    "المطابخ والخزائن",
    "تصميم المجالس",
    "تشطيب فيلا كاملة",
  ];
  const prep: { onboarding: Overrides; launch: Overrides } = {
    onboarding: launch
      ? {
          starter_pack: true,
          service_focus: "Interior design",
          service_focus_ar: "تصميم داخلي",
          services_ar: servicesAr,
          red_lines: ["No photos of the owner", "No music with lyrics"],
          red_lines_ar: ["لا تحطون صور المالك", "بدون موسيقى فيها كلمات"],
        }
      : {
          // Ticked in prep for interior design (fixer round 2: the pack
          // names its service, so another choice on slide 4 drops it).
          starter_pack: "interior",
          services_ar: servicesAr,
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
          form_confirmed: "9100000001",
          their_pick: "custom-site",
          cover_creative: "custom-site",
          pain: "design",
          selling_point: "we design every room in 3D before any work starts",
          selling_point_ar:
            "نوريكم كل غرفة بشكل ثلاثي الأبعاد قبل لا نبدي أي شغل",
          engineer_ar: "المهندس خالد",
          call_guide_checked: true,
        }
      : {},
  };
  // The tray as the server reads it, oldest first (created_at): the hand
  // upload and the starter templates, then yesterday's Drive paste, then
  // today's, each made just after its link was pasted. Prep lists it
  // newest first, so today's paste is on top.
  const custom = launch
    ? [
        ad("custom-site", "custom", siteFeed, 720, 900, {
          createdAt: "2026-10-17T12:00:00Z",
          primaryText:
            "A dining room we finished in north Riyadh this month, from the first drawing to the last chair.",
          headline: "See a finished home",
          cta: "GET_QUOTE",
          language: "en",
          fileName: "dining-north-riyadh.webp",
          source: "upload",
        }),
        // Two came in from Drive links (prep's tray says who pasted them, and when).
        ad("custom-tall", "custom", siteTall, 540, 960, {
          primaryText: "A minute inside a home we finished.",
          cta: "LEARN_MORE",
          language: "en",
          fileName: "home-walk.webp",
          source: "drive",
          importedBy: "Sara",
          importedAt: "2026-10-19T07:15:00Z",
          createdAt: "2026-10-19T07:20:00Z",
        }),
        // Their own majlis at night, from Drive: never a kitchen (score
        // round 1), and none of the eighteen example scenes, so their own
        // ad never looks like the example beside it (score round 2: it was
        // a mirrored crop of the example living room).
        ad("custom-square", "custom", square, 800, 800, {
          primaryText:
            "بيتكم يتصمم على طريقة عيشة عائلتكم. احجزوا موعدكم في معرضنا بالرياض.",
          headline: "تصاميم نور ستوديو",
          cta: "BOOK_NOW",
          language: "ar",
          fileName: "interior-ar.webp",
          source: "drive",
          importedBy: "Noura",
          importedAt: "2026-10-18T16:40:00Z",
          createdAt: "2026-10-18T16:45:00Z",
        }),
      ]
    : [];
  return {
    sources,
    kit,
    ads: [
      ...custom,
      // Interior design's templates, cut from Mahara's own sales-deck
      // pictures (the studio table's materials tray under a room's render;
      // the sales deck's lit majlis, its sofa and screen, for the reel:
      // final score round 1 read the villa model as architecture), none
      // of the eighteen example scenes: score
      // round 2 of the five services found the old ones were crops of the
      // example majlis and bedroom, shown as "Example ads" on O7 stop 1 and
      // as their starters on stop 2. Never a kitchen (CEO, 2026-10-21).
      ad("starter-feed", "starter", feedPic, 864, 1080, {
        primaryText:
          "Your home's interior, designed around how your family lives. Book a visit to our Riyadh showroom.",
        headline: "Interiors by Noor Studio",
        cta: "BOOK_NOW",
        language: "en",
        createdAt: "2026-10-17T12:05:00Z",
      }),
      ad("starter-reel", "starter", reelPic, 608, 1080, {
        primaryText: "From the first drawing to the last detail.",
        cta: "LEARN_MORE",
        language: "en",
        createdAt: "2026-10-17T12:06:00Z",
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
    clientName: "Atlas Design & Build Contracting",
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
    kit: row(taskId, "Atlas Design & Build Contracting", {
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
  const kit = row(taskId, "Saha Construction", {
    signup_on: "2026-10-09",
    links: {},
    forms: {
      onboarding: {
        form_id: "KFRCXPFx",
        response_id: "r3",
        submitted_at: "2026-10-11T12:00:00Z",
        answers: [
          answer("Business Name", "Saha Construction"),
          answer(
            "What services do you offer, and their prices?",
            "بناء فلل سكنية، عظم وتشطيب، تأجير معدات",
          ),
          answer("What is your #1 service you want to grow?", "بناء فلل سكنية"),
          answer(
            "What is your goal for the next 90 Days?",
            "نبي نوقع عقدين بناء فلل كل شهر في دبي والشارقة.",
          ),
          answer(
            "Where do you want the business to be in 12-24 months?",
            "20 appointments a month and a full sales team.",
          ),
          answer(
            "What are your TOP 3 challenges right now?",
            "الاستفسارات كثيرة بس أغلبها أسعار. ما عندنا وقت نتابع كل واحد. المكتب بعيد عن أغلب العملاء.",
          ),
          answer("What are your service areas?", "Dubai, Sharjah"),
          answer(
            "What types of appointments do you offer?",
            "في المكتب، أونلاين",
          ),
          answer("Do you offer free consultations?", "نعم"),
        ],
      },
      kickoff: {
        form_id: "tG7dnxBn",
        response_id: "k3",
        submitted_at: "2026-10-16T10:00:00Z",
        answers: [
          answer("Which service are we advertising?", "Construction only"),
          answer("Templated Ads Status", "Declined"),
          answer("Facebook access", "Access confirmed"),
          answer("Card linked to the account?", "No"),
        ],
      },
    },
  });
  const sources = sourcesSchema.parse({
    taskId,
    clientName: "Saha Construction",
    presenter: { email: "omar@example.com", firstName: "Omar" },
    client: {
      stage: launch ? "Launch Booked" : "Brand Blueprint Booked",
      service: "DWY",
      launchDate: null,
      bucket: "onboarding",
    },
    logo: null,
    ghl: {
      name: "ساحة للإنشاءات",
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
          // A villa they built (a closer, mirrored frame of the example
          // villa): a construction firm's own ad, never a kitchen, now the
          // cover shows their first ad (DESIGN 22.15).
          ad("dwy-square", "custom", dwyVilla, 800, 800, {
            primaryText: "فيلتكم من الأساس إلى التسليم.",
            cta: "SEND_WHATSAPP_MESSAGE",
            language: "ar",
            fileName: "villa-ar.webp",
          }),
        ]
      : [],
    prep: {
      onboarding: {
        // Typed in prep in their words: slide 4 reads it as Construction.
        service_focus: "بناء الفلل",
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
function starter(deck: DeckKind = "launch"): Loaded {
  const taskId = "fixture-starter";
  const kit = row(taskId, "Al Reem Fit-Out & Renovation Co.", {
    signup_on: "2026-10-01",
    onboarding_call_on: "2026-10-05",
    launch_on: "2026-10-15",
    forms: {
      onboarding: {
        form_id: "KFRCXPFx",
        response_id: "r4",
        submitted_at: "2026-10-03T09:00:00Z",
        answers: [
          answer("Business Name", "Al Reem Fit-Out & Renovation Co."),
          answer(
            "What services do you offer, and their prices?",
            "Villa fit-out, Shop and office fit-out, Kitchen renovation",
          ),
          answer("What is your #1 service you want to grow?", "Villa fit-out"),
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
          answer("Which service are we advertising?", "Fit out and renovation"),
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
    clientName: "Al Reem Fit-Out & Renovation Co.",
    presenter: { email: "sara@example.com", firstName: "Sara" },
    client: {
      // Opened for the onboarding call, the card is at that call's stage
      // (final score round 1: at Ready For Launch, O5 showed the Blueprint
      // done while O7 still booked it).
      stage: deck === "onboarding" ? "Onboarding Booked" : "Ready For Launch",
      service: "DFY",
      launchDate: "2026-10-15",
      bucket: "launch",
    },
    logo: null,
    ghl: {
      name: "الريم للتشطيب والترميم",
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
          formName: "WhatsApp, renovation",
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
      // Fit-out pictures and words: the starter templates of the service
      // the kickoff advertises: an office desk under the Kuwait Towers, and
      // rolled drawings and a contract on a stone desk (the studio table's
      // far end; full's templates are its other two parts). None of the
      // eighteen example scenes (score round 2: the boutique and the
      // restaurant were also this client's example ad and the strip's lit
      // tiles, one picture shown four times).
      ad("starter-feed", "starter", fitoutFeedPic, 864, 1080, {
        primaryText:
          "نشطّب ونرمّم المحلات والمطاعم والمكاتب، من المخطط لين التسليم.",
        cta: "SEND_WHATSAPP_MESSAGE",
        language: "ar",
      }),
      ad("starter-reel", "starter", fitoutReelPic, 608, 1080, {
        primaryText: "من أول معاينة للموقع لين آخر لمسة.",
        cta: "SEND_WHATSAPP_MESSAGE",
        language: "ar",
      }),
    ],
    prep: {
      onboarding: {
        starter_pack: true,
        // Their services in Arabic, typed in prep: the Arabic decks' slide 4
        // and queue card name each in Arabic (final score round 1: O4 read
        // "+٢ Villa fit-out" and L2's call rows lost their service).
        services_ar: ["تشطيب فلل", "تشطيب محلات ومكاتب", "ترميم مطابخ"],
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
