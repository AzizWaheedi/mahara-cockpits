/**
 * Every link the CSM needs, in one place.
 *
 * Sourced from the Client Journey SOP, the Client Exit Process doc and #csm-general —
 * never invented. If a link is not in one of those, it does not belong here.
 * The coaching logs are deliberately absent: those are leadership's own tools, not his.
 * So is the team's ClickUp ticketing form: a ticket goes from the client's page
 * ("Add a task", Ask a team), which files the same task with the client on it
 * (the simplification audit, approved 2026-10-06).
 * And the 1-1 call summary form: since 2026-11-01 the 1-1 notes are written
 * in the cockpit (Write 1-1 notes on the client's page), and the Typeform is closed.
 */

import {
  COCKPIT_GUIDES,
  COCKPIT_SOP,
  SOP_VIDEOS,
  type SopVideoInfo,
  TEAM_GUIDES,
} from "./cockpits";

export type LinkRow = {
  label: string;
  url: string;
  note?: string;
  /**
   * A client form that moves into the cockpit (WAVE34-CONTRACT.md 4.11): its
   * registry key, and the Typeform it replaces. Until the key is live the
   * row says so and keeps the old link below it; once live, the old link
   * goes.
   */
  form?: { key: string; oldUrl: string; waiting?: string };
  /** A how-to video: the Links page plays it in place (SopVideo). */
  video?: SopVideoInfo;
};
export type LinkGroup = { title: string; blurb: string; rows: LinkRow[] };

/** The client page, where Send a form and the staff doors live. */
const CLIENT_PAGE = "https://cockpit.maharamedia.com/client-success/clients";
/** Said on a form's row until its switch-on. */
export const NOT_LIVE_YET =
  "Opens with the portal forms (after the switch-on).";
/** The words above the old link while the Typeform still runs. */
export const OLD_FORM = "Old form, still live:";
/**
 * Log a win (WAVE56-CONTRACT.md 1.1, 5.1): its rows follow the wins door,
 * passed in the live list as this key, and keep the Four Rs Typeform as the
 * old form until it is open.
 */
export const WINS_DOOR = "door:wins";
export const WINS_WAITING = "Log a win opens after its switch-on.";

/** The live list with the wins door in it, when it is open. */
export function liveWithWins(
  live: readonly string[] | null,
  winsOpen: boolean,
): string[] | null {
  return winsOpen ? [...(live ?? []), WINS_DOOR] : live ? [...live] : null;
}

const SEND_NOTE =
  "Open the client, then Send a form. It goes to their portal, or by WhatsApp link.";

export const LINK_GROUPS: LinkGroup[] = [
  {
    title: "How this cockpit works",
    blurb:
      "Watch the demo once, then keep the simple SOP open beside you while you learn the day. Before your first onboarding call, launch call or pitch, watch its short video.",
    rows: [
      {
        label: "Watch the demo",
        url: COCKPIT_GUIDES.csm.video,
        video: SOP_VIDEOS.csm.demo,
        note: "Two minutes on the real cockpit, step by step",
      },
      {
        label: "The simple SOP",
        url: COCKPIT_GUIDES.csm.simple,
        note: "Your day step by step, with a picture of every step",
      },
      {
        label: "The in-depth SOP",
        url: COCKPIT_GUIDES.csm.deep,
        note: "Every screen, and how to use it",
      },
      {
        label: "Onboarding call: run the deck and the kickoff form (video)",
        url: COCKPIT_GUIDES.csm.howTo.onboarding,
        video: SOP_VIDEOS.csm.onboarding,
        note: "Three minutes, silent: prep, present with your notes, then submit the kickoff with the client so the Brand Blueprint is booked",
      },
      {
        label: "Launch call: run the launch deck (video)",
        url: COCKPIT_GUIDES.csm.howTo.launch,
        video: SOP_VIDEOS.csm.launch,
        note: "Three minutes, silent: from prep to the client's green light",
      },
      {
        label: "Offers: pitch an offer and send a proposal (video)",
        url: COCKPIT_GUIDES.csm.howTo.offers,
        video: SOP_VIDEOS.csm.offers,
        note: "Under three minutes, silent: Money → Offers, step by step. Watch it before your first pitch",
      },
      {
        label: "Client success cockpit, how to use it",
        url: COCKPIT_SOP.csm,
        note: "The SOP for this cockpit, in ClickUp",
      },
      {
        label: "Raise a ticket (the SOP for every team)",
        url: TEAM_GUIDES.ticket.doc,
        note: "Ask another team with Ask a team, follow it, and work the tickets assigned to you",
      },
      {
        label: "Raise a ticket and work one (video)",
        url: TEAM_GUIDES.ticket.video,
        video: SOP_VIDEOS.team.ticket,
        note: "Under three minutes, silent, for every seat",
      },
    ],
  },
  {
    // Aziz, 2026-11-02: one simple SOP for everything the CSM logs, with a
    // video per part. The old Typeforms it replaces are closed.
    title: "Log money and client changes",
    blurb:
      "Log it the same day: a payment, an invoice, more time, a pause, a client leaving or coming back, a win, and your 1-1 notes. The SOP opens with one table of where each one goes.",
    rows: [
      {
        label: "Logging money and client changes (the SOP)",
        url: COCKPIT_GUIDES.csm.sops.logging,
        note: "It happened → where you log it, then four parts with a picture of every step",
      },
      {
        label: "Money in: log a payment and send an invoice (video)",
        url: COCKPIT_GUIDES.csm.howTo.money,
        video: SOP_VIDEOS.csm.money,
      },
      {
        label: "Give more time, pause, stop or bring back a client (video)",
        url: COCKPIT_GUIDES.csm.howTo.changes,
        video: SOP_VIDEOS.csm.changes,
      },
      {
        label: "Log a review, referral, upsell or back-end programme (video)",
        url: COCKPIT_GUIDES.csm.howTo.wins,
        video: SOP_VIDEOS.csm.wins,
      },
      {
        label: "What to log after a check-in call (video)",
        url: COCKPIT_GUIDES.csm.howTo.afterCall,
        video: SOP_VIDEOS.csm.afterCall,
      },
    ],
  },
  {
    title: "Booking links",
    blurb: "Send these, never a manual time. The client picks the slot.",
    rows: [
      {
        label: "Onboarding call",
        url: "https://api.leadconnectorhq.com/widget/booking/z1Ne59rohCCj87KhcXoi",
        note: "Call #1, within 48h of signing",
      },
      {
        label: "Brand Blueprint call",
        url: "https://api.leadconnectorhq.com/widget/booking/x84ET6KnA8odlsjYiVLq",
        note: "Booked on the onboarding call, the creative strategist runs it",
      },
      {
        label: "Launch call",
        url: "https://api.leadconnectorhq.com/widget/booking/5E1EVxLJbGiDM3iYl2kL",
        note: "Book it once the Brand Blueprint is done",
      },
      {
        label: "Client check-in call",
        url: "https://api.leadconnectorhq.com/widget/booking/SHjlq0UjeR11maltYNyh",
        note: "The recurring one, weekly for their first month, then every 2 weeks",
      },
    ],
  },
  {
    title: "Call SOPs, the framework and the video, per call",
    blurb:
      "These are the Skool SOPs, each with the walkthrough video. Open the one for the call you are about to run and bring solutions to it.",
    rows: [
      {
        label: "New client SOP",
        url: "https://www.skool.com/maharamedia-8165/classroom/68fc87a8?md=5ea5012b03a74b119efd69263dc3558c",
        note: "First contact after they sign",
      },
      {
        label: "Onboarding call SOP",
        url: "https://www.skool.com/maharamedia-8165/classroom/68fc87a8?md=0fbe29a02002423aafcf3ca169be9e36",
        note: "Call #1. Ends by booking the Brand Blueprint call",
      },
      {
        label: "Launch call SOP",
        url: "https://www.skool.com/maharamedia-8165/classroom/68fc87a8?md=d2dc1422cced4771b8c3729539cff1c6",
        note: "Run it, then mark them Ready For Launch",
      },
      {
        label: "Check-in call SOP",
        url: "https://www.skool.com/maharamedia-8165/classroom/68fc87a8?md=7b7ac08b05a34acaba3a5177117d229e",
        note: "The recurring call, weekly for the first month, then every 2 weeks",
      },
      {
        label: "Offboarding / exit call SOP",
        url: "https://www.skool.com/maharamedia-8165/classroom/68fc87a8?md=00c398fc4e774d00ab0ed3f426cab1bd",
        note: "Before you press Client is leaving: the old cancellation form is closed",
      },
      {
        label:
          "Reset call SOP (Client Success Manager bootcamp, video + framework)",
        url: "https://www.skool.com/maharamedia-8165/classroom/68fc87a8?md=181f7ebf64164828bd0faec51925059c",
        note: "The save call, when they are unhappy or hinting at cancelling. Find out whether it is money, results or the team, then reset expectations",
      },
      {
        label: "Client Journey SOP (every stage, in order)",
        url: "https://docs.google.com/document/d/1K_vXVwgUNnroK1Y8ErkJ4pJn7q8e-1QkrEUw49HlLMo/edit",
      },
      {
        label: "Onboarding call framework (doc)",
        url: "https://docs.google.com/document/d/1JN4oTUozLTl_kA8SScgsYZulIXSrDcU-4z1h_2xfOGo/edit",
      },
      {
        label: "Launch call process & framework (doc)",
        url: "https://docs.google.com/document/d/1kTq3cEnjh4-gR7ESmVa-OeAxaETvT3pelVLNG_W7LYs/edit",
      },
    ],
  },
  {
    title: "Send these to the client",
    blurb: "The client fills these in, not you.",
    rows: [
      {
        label: "Onboarding survey (in the cockpit)",
        url: CLIENT_PAGE,
        note: SEND_NOTE,
        form: {
          key: "csat",
          oldUrl: "https://maharamedia.typeform.com/to/KbcbPA73",
        },
      },
      {
        label: "NPS survey (in the cockpit)",
        url: CLIENT_PAGE,
        note: SEND_NOTE,
        form: {
          key: "nps",
          oldUrl: "https://maharamedia.typeform.com/to/fuPgs85S",
        },
      },
    ],
  },
  {
    title: "Communication and content",
    blurb: "The wording is already written. Use it.",
    rows: [
      {
        label: "Client Communication SOP",
        url: "https://docs.google.com/document/d/10wQorQfSebiX3Lmh0jXkEUkp3I_xMP68p4b1q-oUxcY/edit",
        note: "Every message template on a client's page comes from here",
      },
      {
        label: "Content hub",
        url: "https://content.maharamedia.com/",
      },
      {
        label: "Projections calculator",
        url: "http://calculator.maharamedia.com",
        note: "Use it live on calls when they doubt the numbers",
      },
      {
        label: "Client assets drive",
        url: "https://drive.google.com/drive/folders/1DTJUOos129Sl-dSp_zllja47cx_LexFW",
        note: "Every client's assets and files live here",
      },
    ],
  },
  {
    title: "Money, the four Rs",
    blurb:
      "Refer, resell, renew, review. Log it with Log a win the same day it happens, with its proof: no proof, no commission.",
    rows: [
      {
        label: "Google review link (the same ask for every client)",
        url: "https://g.page/r/CeRMcUwFPpe7EAI/review",
        note: "Then log it with Log a win on the client's page",
      },
      {
        label: "Log a win: a Google review or a video testimonial",
        url: CLIENT_PAGE,
        note: "Open the client, then Log a win. Add the review, screenshot or video link.",
        form: {
          key: WINS_DOOR,
          oldUrl: "https://maharamedia.typeform.com/to/ETEynRgb",
          waiting: WINS_WAITING,
        },
      },
      {
        label: "Log a win: a referral",
        url: CLIENT_PAGE,
        note: "Open the client, then Log a win, and pick the referred client's signed deal.",
        form: {
          key: WINS_DOOR,
          oldUrl: "https://maharamedia.typeform.com/to/bAmbMKM2",
          waiting: WINS_WAITING,
        },
      },
      {
        label: "Referral programme, how it works",
        url: "https://docs.google.com/document/d/15gPXbB98N9TtNqbTa0Ro7O2odcio8XuW0rL-S_qfHcs/edit",
        note: "Send or explain this before asking for the referral",
      },
      {
        label: "Log a win: a website upsell",
        url: CLIENT_PAGE,
        note: "Open the client, then Log a win, or Mark as offered on the sent proposal.",
        form: {
          key: WINS_DOOR,
          oldUrl: "https://maharamedia.typeform.com/to/VP3zmaj2",
          waiting: WINS_WAITING,
        },
      },
      {
        label: "Log a win: a social media management upsell",
        url: CLIENT_PAGE,
        note: "Open the client, then Log a win, or Mark as offered on the sent proposal.",
        form: {
          key: WINS_DOOR,
          oldUrl: "https://maharamedia.typeform.com/to/IVHO9BMC",
          waiting: WINS_WAITING,
        },
      },
      {
        label: "Log a win: a back-end programme upsell",
        url: CLIENT_PAGE,
        note: "Open the client, then Log a win, or Mark as offered on the sent proposal.",
        form: {
          key: WINS_DOOR,
          oldUrl: "https://maharamedia.typeform.com/to/cKItPZVI",
          waiting: WINS_WAITING,
        },
      },
    ],
  },
  {
    title: "Changing a client's plan, pause, extend, cancel",
    blurb:
      "One form per change. Never agree to any of these over WhatsApp, get them on a call first.",
    rows: [
      {
        label: "Pause consent (in the cockpit)",
        url: CLIENT_PAGE,
        note: "Open the client, then Pause this client. The client signs the consent in their portal or by link.",
        form: {
          key: "pause_consent",
          oldUrl: "https://maharamedia.typeform.com/to/CTUjv6l3",
        },
      },
      {
        // The extension Typeform closes at the C1 window: Give more time on the
        // client's page writes the card itself (WAVE12-CONTRACT.md 4.7.4, Q7).
        label: "Give more time (in the cockpit)",
        url: "https://cockpit.maharamedia.com/client-success/clients",
        note: "Open the client, then Give more time. The ClickUp card updates itself.",
      },
      {
        label: "Exit survey (in the cockpit)",
        url: CLIENT_PAGE,
        note: "Open the client, then Client is leaving or Send a form.",
        form: {
          key: "exit_survey",
          oldUrl: "https://maharamedia.typeform.com/to/knIe4eF3",
        },
      },
      {
        label: "Client exit process",
        url: "https://docs.google.com/document/d/1tlZlMcasIXU23wMNjvqcrzx1qzKeCLlPyDLOPcGfoNc/edit",
        note: "Read this before you reply to a cancellation message",
      },
    ],
  },
  {
    title: "Boards and trackers",
    blurb: "Where the truth is written down.",
    rows: [
      {
        label: "Clients - Mahara (ClickUp)",
        url: "https://app.clickup.com/90182518398/v/li/901816559981",
      },
      {
        label: "Client Success (ClickUp)",
        url: "https://app.clickup.com/90182518398/v/li/901816723211",
      },
      {
        label: "Churn tracker",
        url: "https://cockpit.maharamedia.com/client-success/churn",
        note: "In this cockpit since 1 October 2026; the 2026 sheet's months are in it",
      },
      {
        label: "Master Dashboard - Mahara",
        url: "https://docs.google.com/spreadsheets/d/1pBEyClUxPLc4-RdXR8gZ0MxsLkLLFkWJwkiVqVf2rro/edit",
        note: "Every client's spend and cost per lead in one sheet",
      },
    ],
  },
];

/**
 * The Links rows as they stand today (4.11): a client form's row reads its
 * cockpit words once cockpit_form_client_live_list() lists it; until then
 * (or while the list cannot be read, `live` null) the row says it opens
 * with the portal forms and keeps the Typeform as the old form, still live.
 */
export function linkGroupsFor(
  live: readonly string[] | null,
  groups: LinkGroup[] = LINK_GROUPS,
): LinkGroup[] {
  return groups.map(g => ({
    ...g,
    rows: g.rows.map(r => {
      if (!r.form || live?.includes(r.form.key)) return r;
      return {
        ...r,
        note: `${r.note ?? ""} ${r.form.waiting ?? NOT_LIVE_YET}`.trim(),
      };
    }),
  }));
}

/** The old Typeform still to show under a row, or null once its form is live. */
export function oldFormOf(r: LinkRow, live: readonly string[] | null) {
  return r.form && !live?.includes(r.form.key) ? r.form.oldUrl : null;
}
