/**
 * Every link the CSM needs, in one place.
 *
 * Sourced from the Client Journey SOP, the Client Exit Process doc and #csm-general —
 * never invented. If a link is not in one of those, it does not belong here.
 * The coaching logs are deliberately absent: those are leadership's own tools, not his.
 */

export type LinkRow = { label: string; url: string; note?: string };
export type LinkGroup = { title: string; blurb: string; rows: LinkRow[] };

export const LINK_GROUPS: LinkGroup[] = [
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
    title: "Forms to fill in",
    blurb: "If it is not in a form, it did not happen.",
    rows: [
      {
        label: "1-1 call summary form",
        url: "https://maharamedia.typeform.com/to/fRokTITH",
        note: "After every client call, same day",
      },
      {
        label: "Client ticketing form",
        url: "https://forms.clickup.com/90182518398/f/2kzmr1ky-1178/R1O1N5QXYLUTJOWQ3E",
        note: "Any work a client needs from tech, media or ads, one ticket each",
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
        note: "Before you ever send a cancellation form",
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
        label: "Onboarding experience survey",
        url: "https://maharamedia.typeform.com/to/KbcbPA73",
        note: "Send once onboarding is done",
      },
      {
        label: "NPS survey",
        url: "https://maharamedia.typeform.com/to/fuPgs85S",
      },
      {
        label: "Card details form",
        url: "https://maharamedia.typeform.com/to/Uju17Z13",
        note: "Send it when they need to change the card the ads bill to",
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
        note: "Every message template in the touchpoints tab comes from here",
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
      "Refer, resell, renew, review. Fill the form the same day it happens, no form, no commission.",
    rows: [
      {
        label: "Google review link (send to happy clients)",
        url: "https://g.page/r/CeRMcUwFPpe7EAI/review",
        note: "Then log it in the client review form",
      },
      {
        label: "Client review form (review or video testimonial)",
        url: "https://maharamedia.typeform.com/to/ETEynRgb",
      },
      {
        label: "Referral form",
        url: "https://maharamedia.typeform.com/to/bAmbMKM2",
      },
      {
        label: "Referral programme, how it works",
        url: "https://docs.google.com/document/d/15gPXbB98N9TtNqbTa0Ro7O2odcio8XuW0rL-S_qfHcs/edit",
        note: "Send or explain this before asking for the referral",
      },
      {
        label: "Website upsell form",
        url: "https://maharamedia.typeform.com/to/VP3zmaj2",
      },
      {
        label: "Social media management upsell form",
        url: "https://maharamedia.typeform.com/to/IVHO9BMC",
      },
      {
        label: "Backend program upsell form",
        url: "https://maharamedia.typeform.com/to/cKItPZVI",
      },
    ],
  },
  {
    title: "Changing a client's plan, pause, extend, reactivate, cancel",
    blurb:
      "One form per change. Never agree to any of these over WhatsApp, get them on a call first.",
    rows: [
      {
        label: "Pause request form",
        url: "https://maharamedia.typeform.com/to/CTUjv6l3",
        note: "Client wants to freeze. A freeze over 14 days counts as churn",
      },
      {
        label: "Client extension form",
        url: "https://maharamedia.typeform.com/to/gqBcyK6g",
        note: "Only with a real reason, each extension costs you $50",
      },
      {
        label: "Card declined, reactivate their ads",
        url: "https://maharamedia.typeform.com/to/ecJQ5Z5C",
        note: "Use when a client's card fails and the ads stop. Admin only, not an earner",
      },
      {
        label: "Contract termination survey (cancellation form)",
        url: "https://maharamedia.typeform.com/to/knIe4eF3",
        note: "After the exit call only, never instead of it",
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
        label: "Churn tracker 2026",
        url: "https://docs.google.com/spreadsheets/d/1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU/edit",
      },
      {
        label: "Master Dashboard - Mahara",
        url: "https://docs.google.com/spreadsheets/d/1pBEyClUxPLc4-RdXR8gZ0MxsLkLLFkWJwkiVqVf2rro/edit",
        note: "Every client's spend and cost per lead in one sheet",
      },
    ],
  },
];
