/**
 * Every link the Creative Director needs, in one place.
 *
 * Same shape as the CSM cockpit's key links, different contents. Every URL here
 * was pulled from a real source: the Brand Blueprint Call framework, the Client
 * Communication SOP, the ClickUp workspace itself, or the client journey docs.
 * Nothing is invented. If a link is not in one of those, it does not belong.
 *
 * Deliberately absent: the CSM's booking, billing, upsell and cancellation
 * forms. Aziz, 2026-09-07: the only forms needed are the video request form
 * and the ClickUp client ticketing form.
 */

export type LinkRow = { label: string; url: string; note?: string };
export type LinkGroup = { title: string; blurb: string; rows: LinkRow[] };

export const LINK_GROUPS: LinkGroup[] = [
  {
    title: "How this cockpit works",
    blurb:
      "Read this once. What every screen is for, how the day is meant to run, and what to do when something looks wrong.",
    rows: [
      {
        label: "Creative Director Cockpit, how to use it",
        url: "https://docs.google.com/document/d/1EnKh2hUdje2uL1Nv9h1_CYSkYasUf9SiAo1E2QaDHx0/edit",
        note: "The SOP for this dashboard",
      },
    ],
  },
  {
    title: "The Brand Blueprint call",
    blurb:
      "Your call, start to finish. Open the framework before every one, and walk in with 70 percent already filled.",
    rows: [
      {
        label: "Brand Blueprint call framework (the SOP)",
        url: "https://docs.google.com/document/d/1DUd5Euj4Ke7TNlY1MwAH-YB72-VED8JcILa84GvG528/edit",
        note: "Why the call exists, the 15 minute prep, and the run of the call",
      },
      {
        label: "Brand Blueprint booking link",
        url: "https://api.leadconnectorhq.com/widget/booking/x84ET6KnA8odlsjYiVLq",
        note: "Booked on the onboarding call. Send this if it needs rebooking",
      },
      {
        label: "Brand Blueprint form (client fills it before the call)",
        url: "https://maharamedia.typeform.com/to/oYZKtogO",
        note: "Read their answers as part of the prep, not on the call",
      },
    ],
  },
  {
    title: "The only two forms you fill",
    blurb: "If it is not in a form, it did not happen.",
    rows: [
      {
        label: "Video request form",
        url: "https://forms.clickup.com/90182518398/f/2kzmr1ky-1058/E1LP6F3OHFC3WACLU8",
        note: "Creates the task on the Video Pipeline. The client screen files this for you in one click",
      },
      {
        label: "Client ticketing form",
        url: "https://forms.clickup.com/90182518398/f/2kzmr1ky-1178/R1O1N5QXYLUTJOWQ3E",
        note: "Anything a client needs from tech, media or ads. One ticket each",
      },
    ],
  },
  {
    title: "What you write from",
    blurb: "The brand DNA and the offer come first, the script second.",
    rows: [
      {
        label: "Clients - Mahara (ClickUp)",
        url: "https://app.clickup.com/90182518398/v/li/901816559981",
        note: "Every client's Brand DNA and Offer Cheat Sheet live on the client row",
      },
      {
        label: "Content hub",
        url: "https://content.maharamedia.com/",
        note: "What to tell a client to record",
      },
      {
        label: "Client assets drive",
        url: "https://drive.google.com/drive/folders/1DTJUOos129Sl-dSp_zllja47cx_LexFW",
        note: "Raw photos and videos, per client. Each client screen links their own folder",
      },
    ],
  },
  {
    title: "Talking to clients",
    blurb: "The wording is already written. Use it.",
    rows: [
      {
        label: "Client Communication SOP",
        url: "https://docs.google.com/document/d/10wQorQfSebiX3Lmh0jXkEUkp3I_xMP68p4b1q-oUxcY/edit",
        note: "Every template in the Messages tab comes from here, verbatim",
      },
      {
        label: "Client Journey SOP (every stage, in order)",
        url: "https://docs.google.com/document/d/1K_vXVwgUNnroK1Y8ErkJ4pJn7q8e-1QkrEUw49HlLMo/edit",
        note: "Where the blueprint call sits in the journey, and who has the client before and after you",
      },
    ],
  },
  {
    title: "Boards",
    blurb: "Where the truth is written down. The dashboard reads these.",
    rows: [
      {
        label: "Video Pipeline (ClickUp)",
        url: "https://app.clickup.com/90182518398/v/li/901816720767",
      },
      {
        label: "Media / Creative (ClickUp)",
        url: "https://app.clickup.com/90182518398/v/li/901818016338",
        note: "Script requests and creative onboarding sequences",
      },
      {
        label: "Ads Managment (ClickUp)",
        url: "https://app.clickup.com/90182518398/v/li/901817774521",
        note: "What the media buyer is running with your creative",
      },
    ],
  },
];
