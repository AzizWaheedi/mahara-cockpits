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
 */

import type { OnboardingRow } from "@/lib/onboardingCore";
import type { Overrides } from "@/present/deckData";
import { type LaunchAd, sourcesSchema } from "@/present/sources";
import type { Loaded } from "@/present/useDeckModel";
import feedPic from "./starter-feed.webp";
import reelPic from "./starter-reel.webp";

export type FixtureKey = "full" | "sparse" | "dwy";

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

function full(): Loaded {
  const taskId = "fixture-full";
  const kit = row(taskId, "Noor Studio Interiors", {
    signup_on: "2026-10-12",
    onboarding_call_on: "2026-10-19",
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
      stage: "Onboarding Booked",
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
      text: "DO's:\n- Show finished kitchens in daylight\nDON'Ts:\n- Never show prices in an ad\n- No before-and-after of client homes\nNOTES:\n- Owner prefers calls after 4",
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
      next: { blueprint: { startsAt: "2026-10-22T13:00:00Z" } },
      last: {},
    },
    launchAds: [],
    notes: [],
  });
  const prep: { onboarding: Overrides; launch: Overrides } = {
    onboarding: { starter_pack: true },
    launch: {},
  };
  return {
    sources,
    kit,
    ads: [
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
  };
}

function sparse(): Loaded {
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
    problems: [],
  };
}

function dwy(): Loaded {
  const taskId = "fixture-dwy";
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
      stage: "Brand Blueprint Booked",
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
    ads: [],
    prep: {
      onboarding: {
        service_focus: "مطابخ حسب الطلب",
        red_lines: ["لا تذكرون الأسعار في الإعلان"],
        access: { meta_access: "done" },
      },
      launch: {},
    },
    problems: [],
  };
}

export const FIXTURES: Record<FixtureKey, () => Loaded> = { full, sparse, dwy };
