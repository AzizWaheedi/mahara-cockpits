import {
  BookOpen,
  ChartNoAxesCombined,
  Clapperboard,
  Gauge,
  Handshake,
  HeartHandshake,
  type LucideIcon,
  Megaphone,
  Palette,
  ShieldCheck,
  Ticket,
  UsersRound,
} from "lucide-react";

/**
 * One icon per cockpit, the same in every switcher, menu and front door, so a
 * cockpit is recognised by its mark rather than a row of identical arrows.
 * The same file sits in each of the five apps.
 */
export const COCKPIT_ICON: Record<string, LucideIcon> = {
  ceo: Gauge,
  media_buyer: Megaphone,
  csm: HeartHandshake,
  creative: Palette,
  editor: Clapperboard,
  sales: Handshake,
  admin: ShieldCheck,
  team: UsersRound,
  /** Client performance, the portal's board for every seat (2026-10-16). */
  performance: ChartNoAxesCombined,
  /** Ask a team: the portal's Requests page (2026-10-26). */
  requests: Ticket,
  sop: BookOpen,
};

/**
 * Each cockpit's SOP: one page each in the team's ClickUp doc "Cockpit SOPs"
 * (written 2026-10-06, after the simplification audit). Every sidebar links
 * its own at the foot, and the search box finds it. Signed-in ClickUp members
 * only: the doc is not shared outside the workspace.
 */
const SOP_DOC = "https://app.clickup.com/90182518398/docs/2kzmr1ky-7418";
export const COCKPIT_SOP: Record<string, string> = {
  start: `${SOP_DOC}/2kzmr1ky-3398`,
  csm: `${SOP_DOC}/2kzmr1ky-3418`,
  media_buyer: `${SOP_DOC}/2kzmr1ky-3438`,
  creative: `${SOP_DOC}/2kzmr1ky-3458`,
  editor: `${SOP_DOC}/2kzmr1ky-3478`,
  sales: `${SOP_DOC}/2kzmr1ky-3498`,
};

/**
 * Each cockpit's demo video and its two SOPs in Google Docs: the simple one
 * (the day step by step, with a picture of every step) and the in-depth one
 * (every screen). In the Drive folder "Cockpit SOPs" (2026-10-07), open to
 * maharamedia.com accounts. A re-recording replaces each file in place, so
 * these addresses stay the same.
 *
 * `howTo` holds a cockpit's silent how-to videos, one call or task each, in
 * "Cockpit SOPs / Team how-to videos (October 2026)": client success has the
 * onboarding call, the launch call (2026-10-24) and Money → Offers
 * (2026-11-01); the creative director has the Brand Blueprint call.
 * Client success also has four on logging (2026-11-02): money in, client
 * changes, wins, and what to log after a call.
 *
 * `sops` holds a cockpit's SOPs for one job rather than the whole day:
 * client success has "Logging money and client changes" (2026-11-02).
 */
const DRIVE_FILE = "https://drive.google.com/file/d";
const GOOGLE_DOC = "https://docs.google.com/document/d";
export const COCKPIT_GUIDES = {
  csm: {
    video: `${DRIVE_FILE}/1RUlOhQZUtFExNiu-nKtY9bYLSEihwnDS/view`,
    simple: `${GOOGLE_DOC}/1BpbtA5i2kwuIxKZsomRLLXrhxNXh5S34ThFmghj6RoI/edit`,
    deep: `${GOOGLE_DOC}/1_9lZfD4KSHV54NPhIPU0rkfLvFIxMFiexiAwz8q2xz8/edit`,
    howTo: {
      onboarding: `${DRIVE_FILE}/1AuD8qBlwRJHdUHF_teerPlLJI856WgTG/view`,
      launch: `${DRIVE_FILE}/1A-4eHbzNXXA2DiH5bZJzfn19LlgGKYdJ/view`,
      offers: `${DRIVE_FILE}/1fJ2aj62n1uCkxj5HO17Uxd9nqw97xuC2/view`,
      money: `${DRIVE_FILE}/1sHrEtNJt2IODfNEaQrvw_iU_JXfpay0P/view`,
      changes: `${DRIVE_FILE}/1C3fC2NZVEpkSQrrI3dAFlJC1FpR803Sp/view`,
      wins: `${DRIVE_FILE}/11W5a_cezr5tXb5GWQ5klazXRusCEVzbY/view`,
      afterCall: `${DRIVE_FILE}/1eeSzAnU96tHJ5M4LW8FJSuXJVwwFxO8-/view`,
    },
    sops: {
      logging: `${GOOGLE_DOC}/1MvTFAMcZs_v7ZnGmwbU1lRSwkVk2oTYB1lIJc_3mPO4/edit`,
    },
  },
  media_buyer: {
    video: `${DRIVE_FILE}/181jbsAfHy4vghtfGQ2gOZk7StWojCvHC/view`,
    simple: `${GOOGLE_DOC}/18VAlBnLiqhKhPJksYsFP7rJ-XtzKM4D74n6sVIzNvXM/edit`,
    deep: `${GOOGLE_DOC}/1QJR7cZhmHuRp4unjO_HVPUy5TZTWGBImLFC00gb4ho0/edit`,
  },
  creative: {
    video: `${DRIVE_FILE}/1ivCH-Ubog1R4Y-zS7B-S4xe2iLFSwF9m/view`,
    simple: `${GOOGLE_DOC}/19JKDh3TJGlxT1yLZP-LSP3a5hP5iYYK7EvHzTmSrF3M/edit`,
    deep: `${GOOGLE_DOC}/1Z1cusU9lNQh8u5i1to3kmmB3ZB7eZGa0osLFSuRnigw/edit`,
    howTo: {
      blueprint: `${DRIVE_FILE}/11Lry1EYCxCxlfc96QESOSTuH5KVI6coi/view`,
    },
  },
  editor: {
    video: `${DRIVE_FILE}/1ubzMoMQPvOPbmjL9BWrhqMM1LY-xhnH6/view`,
    simple: `${GOOGLE_DOC}/1oZcNy_6RPsBe2YEJMLVkSqC3HoF9uvifZVjTbtYA8rg/edit`,
    deep: `${GOOGLE_DOC}/1KPWm5mXCbEgvXfy__1j7avGIx5q59euD8GLCdcVYD_w/edit`,
  },
  sales: {
    video: `${DRIVE_FILE}/1swnauUROiAJXiJ3f-DeAHift7iHz-553/view`,
    simple: `${GOOGLE_DOC}/1-tpPls6rTKLaGMw4svWeAD6DdgRvTgBxSGEEUFE_qV4/edit`,
    deep: `${GOOGLE_DOC}/1tDDpvBjwmWiomypTpBmh5-qLMzkhYH94dsV6aJbXgyI/edit`,
  },
} satisfies Record<
  string,
  {
    video: string;
    simple: string;
    deep: string;
    howTo?: Record<string, string>;
    sops?: Record<string, string>;
  }
>;

/**
 * SOPs for every seat, not one cockpit. Raising a ticket is the same from
 * every cockpit (Ask a team), so it is one SOP and one video for the whole
 * team (Aziz, 2026-11-02), listed on every cockpit's links or guide page and
 * on Requests itself. Same Drive folders as COCKPIT_GUIDES.
 */
export const TEAM_GUIDES = {
  ticket: {
    doc: `${GOOGLE_DOC}/15QeUvilPP-3d6wEfJIwj3YJaxeAYIgtVHpMchPoMZ-c/edit`,
    video: `${DRIVE_FILE}/1Ht7-NW7Eej8UwLNLqGFAZgs7Xny8JOzP/view`,
  },
} as const;

/**
 * The same videos, played inside the cockpit rather than from ClickUp or a
 * Drive tab (Aziz, 2026-11-02: "embed them into the cockpit"). Each one shows
 * where its work happens: Offers holds the pitch video, a call's prep holds
 * that call's, and each cockpit's links or guide page holds its demo. The
 * lengths are Drive's own (GOOGLEDRIVE_GET_FILE_METADATA) or the ClickUp
 * "Cockpit SOPs" doc's, which read them from Drive.
 *
 * They play from Wistia, folder "Cockpit SOP videos" (`nstot7gi7y`): each
 * media is its Drive file byte for byte, copied on 2026-11-02. Drive's own
 * player needs a Google sign-in the frame cannot show (and Safari blocks
 * it), so a re-recorded Drive file needs its Wistia media replaced too.
 */
export type SopVideoInfo = {
  key: string;
  /** The Wistia media that plays it. */
  wistia: string;
  title: string;
  url: string;
  length: string;
  note: string;
};

export const SOP_VIDEOS = {
  csm: {
    demo: {
      key: "csm-demo",
      wistia: "r4687x6rcf",
      title: "Watch the demo",
      url: COCKPIT_GUIDES.csm.video,
      length: "1:31",
      note: "The real cockpit, step by step",
    },
    onboarding: {
      key: "csm-onboarding",
      wistia: "w1ermr0af1",
      title: "Onboarding call: run the deck and the kickoff form",
      url: COCKPIT_GUIDES.csm.howTo.onboarding,
      length: "3:00",
      note: "Silent: prep, present with your notes, then submit the kickoff with the client so the Brand Blueprint is booked",
    },
    launch: {
      key: "csm-launch",
      wistia: "59u4ud4r2j",
      title: "Launch call: run the launch deck",
      url: COCKPIT_GUIDES.csm.howTo.launch,
      length: "3:02",
      note: "Silent: from prep to the client's green light",
    },
    offers: {
      key: "csm-offers",
      wistia: "7nqvimzoia",
      title: "Pitch an offer and send a proposal",
      url: COCKPIT_GUIDES.csm.howTo.offers,
      length: "2:46",
      note: "Silent: Money → Offers, step by step. Watch it before your first pitch",
    },
    money: {
      key: "csm-money",
      wistia: "uiuydjyh91",
      title: "Money in: log a payment and send an invoice",
      url: COCKPIT_GUIDES.csm.howTo.money,
      length: "2:58",
      note: "Silent: a bank transfer and its receipt, Confirm paid, the date, MRR and invoices",
    },
    changes: {
      key: "csm-changes",
      wistia: "he7a2xwwc9",
      title: "Give more time, pause, stop or bring back a client",
      url: COCKPIT_GUIDES.csm.howTo.changes,
      length: "2:57",
      note: "Silent: the buttons on the client's page. Stopping is one process, whatever they call it",
    },
    wins: {
      key: "csm-wins",
      wistia: "0hlqabl6im",
      title: "Log a review, referral, upsell or back-end programme",
      url: COCKPIT_GUIDES.csm.howTo.wins,
      length: "2:32",
      note: "Silent: Log a win with its proof, an upsell from offered to paid, and asking for a review",
    },
    afterCall: {
      key: "csm-after-call",
      wistia: "2dp8zflbpw",
      title: "What to log after a check-in call",
      url: COCKPIT_GUIDES.csm.howTo.afterCall,
      length: "2:45",
      note: "Silent: Write 1-1 notes, send the recap, and turn what you promised into tasks",
    },
  },
  media_buyer: {
    demo: {
      key: "media-buyer-demo",
      wistia: "vfud6aor8d",
      title: "Watch the demo",
      url: COCKPIT_GUIDES.media_buyer.video,
      length: "1:59",
      note: "The real cockpit, step by step",
    },
  },
  creative: {
    demo: {
      key: "creative-demo",
      wistia: "zlyzg8usv6",
      title: "Watch the demo",
      url: COCKPIT_GUIDES.creative.video,
      length: "2:10",
      note: "The real cockpit, step by step",
    },
    blueprint: {
      key: "creative-blueprint",
      wistia: "nsbse355za",
      title: "Brand Blueprint call: run it in this cockpit",
      url: COCKPIT_GUIDES.creative.howTo.blueprint,
      length: "3:00",
      note: "Silent. Watch it before your first Blueprint call",
    },
  },
  editor: {
    demo: {
      key: "editor-demo",
      wistia: "g5c3dindbp",
      title: "Watch the demo",
      url: COCKPIT_GUIDES.editor.video,
      length: "1:45",
      note: "The desk on real jobs, step by step",
    },
  },
  sales: {
    demo: {
      key: "sales-demo",
      wistia: "zrk219w6nb",
      title: "Watch the demo",
      url: COCKPIT_GUIDES.sales.video,
      length: "2:09",
      note: "The setter's and the closer's day, step by step",
    },
  },
  team: {
    ticket: {
      key: "team-ticket",
      wistia: "bw188pk09a",
      title: "Raise a ticket and work one",
      url: TEAM_GUIDES.ticket.video,
      length: "2:54",
      note: "Silent, for every seat: Ask a team, follow it, and work the tickets assigned to you",
    },
  },
} satisfies Record<string, Record<string, SopVideoInfo>>;

/** Wistia's public player for a media: it plays without a sign-in. */
export function wistiaPlayer(media: string): string {
  return `https://fast.wistia.net/embed/iframe/${media}`;
}
