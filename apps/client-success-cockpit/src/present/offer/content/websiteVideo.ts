/**
 * The website's one-minute video: five beats that tile 0 to 60 seconds,
 * each with the narrator's words and every word it puts on screen, plus
 * the CEO's closing line (CONTRACT.md section 8,
 * hw-notes/upsell-studio/video/website-script.md).
 *
 * The narration is the script v1 (tools/offer-video/film/lines.json) with
 * its two booking lines rewritten on 26 Oct: one cut goes to every client,
 * and done-with-you clients never hear an appointment or call-centre line
 * (PLAN, Done with you). The gap beat now says "get in touch", and the what
 * beat's last line says "Send the link before a first meeting". Change a
 * line here and the film's lines and the voice are made again (the
 * narration test pins them). ".." is a short pause, never read aloud (the
 * film writes it as a single ellipsis for the voice). The Arabic is
 * regional Gulf, written fresh under mahara-context's aziz-kuwaiti-voice,
 * and waits for the CEO's approval and the voice plan (PLAN amendment 7).
 *
 * The demo firm, Hosh Design & Build, is invented and tagged "Example" on
 * every frame it is in. No price, figure or result is said or shown.
 *
 * `labels` are every word the film puts on screen, as the v4 film sets them
 * (tools/offer-video/film/build.py COPY and v4a.py COPY4), so the CEO
 * approves the Arabic in one batch and the copy check reads every one.
 * Where the film and this file differ, this file is the approved word and
 * the film follows it (docs/upsell-studio/CONTENT.md, Needs from video).
 */
import { OFFER_CHROME } from "./shared";
import type { OfferVideoCopy } from "./types";

export const WEBSITE_VIDEO: OfferVideoCopy = {
  beats: [
    {
      id: "hook",
      start: 0,
      end: 5,
      vo: {
        en: "Someone sees your ad. Then they search your name.",
        ar: "أحد يشوف إعلانكم.. وأول شي يسويه؟ يدور على اسمكم.",
      },
      // The ad is drawn as a feed post, so it carries the platform's own two
      // words (Sponsored, Learn more) as the platform writes them.
      labels: {
        en: [
          "Example",
          "Example ad",
          "Hosh Design & Build",
          "Sponsored",
          "Learn more",
        ],
        ar: [
          "مثال",
          "إعلان للتوضيح",
          "حوش للتصميم والبناء",
          "مُموَّل",
          "معرفة المزيد",
        ],
      },
    },
    {
      id: "gap",
      start: 5,
      end: 15,
      vo: {
        en: "What they find in the next thirty seconds decides whether they get in touch, or quietly go cold. Too often, it's this.",
        ar: "واللي يلقاه بأول ثلاثين ثانية.. هو اللي يقرر إذا بيتواصل معكم، ولا بيختفي بهدوء. ومرات كثير.. هذا اللي يلقاه.",
      },
      // "30 seconds" is a dimension drawn on the error page, not a figure.
      labels: {
        en: [
          "Example",
          OFFER_CHROME.captured.en,
          "30 seconds",
          "The page doesn't open",
        ],
        ar: ["مثال", OFFER_CHROME.captured.ar, "٣٠ ثانية", "الصفحة ما تفتح"],
      },
    },
    {
      id: "what",
      start: 15,
      end: 35,
      vo: {
        en: "We build you a site. Up to six pages, in Arabic and English. Your projects, shown properly. WhatsApp, an enquiry form, and tracking. Send the link before a first meeting, so they see your work before they meet you.",
        ar: "نبني لكم موقع.. لين ست صفحات، بالعربي والإنجليزي. مشاريعكم معروضة مثل ما تستاهل.. وزر واتساب، وفورم للاستفسارات، وتتبع. وترسلون الرابط قبل أول اجتماع.. عشان يشوف شغلكم قبل لا يقابلكم.",
      },
      labels: {
        // The demo firm's own site speaks to its customer: one buyer,
        // singular in Arabic.
        en: [
          "Example",
          "Six pages",
          "Arabic and English",
          "Website, Arabic and English",
          "Home",
          "Projects",
          "A project",
          "Services",
          "About",
          "Contact",
          "WhatsApp",
          "Enquiry form",
          "Tracking, tied to your ads",
          "Care: hosting, backups, an hour of edits a month",
        ],
        ar: [
          "مثال",
          "ست صفحات",
          "بالعربي والإنجليزي",
          "موقع بالعربي والإنجليزي",
          "الرئيسية",
          "المشاريع",
          "صفحة مشروع",
          "الخدمات",
          "من نحن",
          "تواصل معنا",
          "واتساب",
          "نموذج الاستفسار",
          "تتبع مربوط بإعلاناتكم",
          "العناية: استضافة، ونسخ احتياطي، وساعة تعديلات بالشهر",
        ],
      },
    },
    {
      id: "need",
      start: 35,
      end: 45,
      vo: {
        en: "Three things from you. Your logo. Photos of your projects. Your list of services. It's live two weeks after we have them.",
        ar: "ومنكم ثلاث أشياء بس. شعاركم.. صور مشاريعكم.. وقائمة خدماتكم. وبعد أسبوعين من يوم توصلنا.. الموقع شغال.",
      },
      labels: {
        en: [
          "Example",
          OFFER_CHROME.weNeed.en,
          "Your logo",
          "Photos of your projects",
          "Your list of services",
          "2 weeks from your content",
        ],
        ar: [
          "مثال",
          OFFER_CHROME.weNeed.ar,
          "شعاركم",
          "صور مشاريعكم",
          "قائمة خدماتكم",
          "أسبوعين من وصول المحتوى",
        ],
      },
    },
    {
      id: "return",
      start: 45,
      end: 60,
      vo: {
        en: "How many projects would pay for this? Your account manager works it out with your numbers.",
        ar: "كم مشروع يكفي عشان يغطيه؟ ونحسبها معاكم.. بأرقامكم أنتم.",
      },
      // A drawn bill of quantities with no price column and no figures: the
      // deck's own labels, the empty return card ("This" alone, since the
      // film shows no year), and amber fields for the client's own numbers.
      labels: {
        en: [
          "Example",
          "Bill of quantities",
          OFFER_CHROME.item.en,
          OFFER_CHROME.description.en,
          "Quantity",
          OFFER_CHROME.typicalProject.en,
          "This",
          "your numbers",
        ],
        ar: [
          "مثال",
          "جدول الكميات",
          OFFER_CHROME.item.ar,
          OFFER_CHROME.description.ar,
          "الكمية",
          OFFER_CHROME.typicalProject.ar,
          "هذا",
          "أرقامكم",
        ],
      },
    },
  ],
  // The CEO's own words on his real clip (52 to 60 s), never a generated
  // voice or face. Until he records it, the narrator reads it on a still
  // card. The Arabic names the team, since the Arabic title for one person
  // is gendered (docs/csm-decks/CONTENT-AR.md decision 8).
  closing: {
    en: "Your account manager will walk you through it.",
    ar: "فريق نجاح العملاء بيمشي معاكم فيها.. خطوة خطوة.",
  },
  poster: {
    en: "Your website, in Arabic and English",
    ar: "موقعكم، بالعربي والإنجليزي",
  },
};
