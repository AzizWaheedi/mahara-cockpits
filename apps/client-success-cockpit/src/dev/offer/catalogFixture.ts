// Fictional harness uses the approved catalogue wording, no live reads.
import type { CatalogCopy } from "../../present/offer/sources";
export const WEBSITE_COPY: { en: CatalogCopy; ar: CatalogCopy } = {
  en: {
    name: "Website",
    deckTitle: "Your website",
    line: "A site in Arabic and English with your projects, WhatsApp, an enquiry form and tracking, with care each month.",
    parts: {
      build: "Website, in Arabic and English",
      care: "Care plan: hosting, backups and an hour of edits a month",
    },
    terms:
      "The build is paid in full. The care plan comes with the site and starts the month it goes live.",
    timing: "Live two weeks after we have your content.",
    get: [
      {
        key: "pages",
        text: "Up to six pages, in Arabic and English",
      },
      {
        key: "portfolio",
        text: "Your projects, each shown properly with its photos",
      },
      {
        key: "whatsapp",
        text: "A WhatsApp button, one tap from any page",
      },
      {
        key: "form",
        text: "An enquiry form that comes straight to you",
      },
      {
        key: "tracking",
        text: "Tracking tied to your ads, so we can see what the site does for them",
      },
      {
        key: "care",
        text: "Care each month: hosting, backups and an hour of edits",
      },
    ],
    need: [
      {
        key: "logo",
        text: "Your logo",
      },
      {
        key: "photos",
        text: "Photos of your projects",
      },
      {
        key: "services",
        text: "Your list of services",
      },
    ],
    steps: [
      {
        key: "content",
        text: "You send your logo, project photos and list of services.",
      },
      {
        key: "build",
        text: "We build the site in Arabic and English and show you the draft.",
      },
      {
        key: "live",
        text: "Two weeks after we have your content, it goes live.",
      },
      {
        key: "care",
        text: "From then on, the care plan keeps it hosted, backed up and up to date.",
      },
    ],
    why: [
      {
        key: "no_site",
        label: "No site comes up",
        text: "When someone sees your ad, they look up your name before they get in touch. Right now there's no site for them to find, so they don't see your work.",
      },
      {
        key: "broken",
        label: "The site doesn't open",
        text: "The address we have for your site doesn't open a working page today. Anyone who looks you up between the ad and the first meeting lands on that page.",
      },
      {
        key: "thin",
        label: "The site doesn't show your work",
        text: "Your site is up, but it doesn't show your projects the way your ads do. Someone who liked the ad looks you up expecting to see more of the same.",
      },
    ],
    button: "Yes, let's start",
    cta: "Yes, let's start the website.",
    close: "Want me to start it this week?",
    work: [],
  },
  ar: {
    name: "الموقع الإلكتروني",
    deckTitle: "موقعكم الإلكتروني",
    line: "موقع بالعربي والإنجليزي، فيه مشاريعكم وزر واتساب ونموذج استفسار وتتبع، مع عناية كل شهر.",
    parts: {
      build: "الموقع، بالعربي والإنجليزي",
      care: "العناية الشهرية: استضافة، ونسخ احتياطي، وساعة تعديلات بالشهر",
    },
    terms:
      "البناء دفعة وحدة كاملة. والعناية الشهرية تجي مع الموقع، وتبدي من الشهر اللي ينطلق فيه.",
    timing: "ينطلق بعد أسبوعين من وصول المحتوى منكم.",
    get: [
      {
        key: "pages",
        text: "لغاية ٦ صفحات، بالعربي والإنجليزي",
      },
      {
        key: "portfolio",
        text: "مشاريعكم معروضة صح، كل مشروع بصوره",
      },
      {
        key: "whatsapp",
        text: "زر واتساب، بضغطة من أي صفحة",
      },
      {
        key: "form",
        text: "نموذج استفسار يوصلكم مباشرة",
      },
      {
        key: "tracking",
        text: "تتبع مربوط بإعلاناتكم، عشان نشوف أثر الموقع عليها",
      },
      {
        key: "care",
        text: "عناية كل شهر: استضافة، ونسخ احتياطي، وساعة تعديلات",
      },
    ],
    need: [
      {
        key: "logo",
        text: "شعاركم",
      },
      {
        key: "photos",
        text: "صور مشاريعكم",
      },
      {
        key: "services",
        text: "قائمة خدماتكم",
      },
    ],
    steps: [
      {
        key: "content",
        text: "ترسلون لنا الشعار وصور المشاريع وقائمة الخدمات.",
      },
      {
        key: "build",
        text: "نبني الموقع بالعربي والإنجليزي، ونوريكم المسودة.",
      },
      {
        key: "live",
        text: "بعد أسبوعين من وصول المحتوى، ينطلق الموقع.",
      },
      {
        key: "care",
        text: "وبعدها العناية الشهرية تخليه مستضاف ومحفوظ ومحدّث.",
      },
    ],
    why: [
      {
        key: "no_site",
        label: "ما يطلع لكم موقع",
        text: "اللي يشوف إعلانكم يدور على اسمكم قبل لا يتواصل معكم. والحين ما فيه موقع يلقاه، فما يشوف شغلكم.",
      },
      {
        key: "broken",
        label: "الموقع ما يفتح",
        text: "الرابط اللي عندنا لموقعكم ما يفتح صفحة شغالة اليوم. وأي أحد يدور عليكم بين الإعلان وأول اجتماع، يوصل لهذي الصفحة.",
      },
      {
        key: "thin",
        label: "الموقع ما يعرض شغلكم",
        text: "موقعكم شغال، بس ما يعرض مشاريعكم مثل ما تعرضها إعلاناتكم. واللي عجبه الإعلان يدور عليكم ويتوقع يشوف نفس المستوى.",
      },
    ],
    button: "خلونا نبدي",
    cta: "تمام، خلونا نبدي بالموقع.",
    close: "نبدي فيه هالأسبوع؟",
    work: [],
  },
};
