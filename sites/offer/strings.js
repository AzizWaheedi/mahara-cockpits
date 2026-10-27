/**
 * The offer page's own words, in English and in white Gulf Arabic (the
 * client in the plural). Everything else on the page comes from the
 * proposal itself: the title, the lines, the bill and the button
 * (CONTRACT.md 5.6 and 5.7, docs/upsell-studio/CONTENT.md).
 *
 * `{slot}` marks a value the page fills: {name} (the client's name in
 * proposalFor, the account manager's first name in preparedBy), {date},
 * {city} and {url}. `states` are the page's whole-page answers: loading,
 * the door's states for a proposal (expired, archived, unknown, busy,
 * error), and videoGone for a video link that has ended (the door's
 * ?gone=1; its ?busy=1 and ?error=1 read busy and error).
 *
 * The page says "your account manager", never CSM, and never shows a lead,
 * a budget, a list price or a discount. The Arabic names the team (فريق
 * نجاح العملاء), since the Arabic title for one person is gendered, and
 * preparedBy uses the noun من إعداد rather than a verb for the same reason.
 * It was written under mahara-context's aziz-kuwaiti-voice and waits for
 * the CEO's one-batch approval (docs/upsell-studio/ARABIC-FOR-APPROVAL.md).
 *
 * The offer page, the cockpit's live preview and the copy tests all import
 * this one file, so the words cannot drift between them.
 */
export const STRINGS = {
  en: {
    proposalFor: "A proposal for {name}",
    preparedBy: "Prepared by {name}, your account manager",
    validUntil: "Valid until {date}",
    found: "What we found",
    why: "Why this, for you",
    get: "What you get",
    work: "Work we've done",
    runs: "How it runs",
    investment: "Investment",
    dollars: "dollars",
    split: "Or in two payments",
    paidInFull: "Paid in full",
    oneTime: "One time",
    monthly: "Monthly",
    perDay: "Per day",
    per90: "For 90 days",
    example: "Example",
    captured: "Captured {date}",
    searchedAs: "Searched as {city}",
    play: "Play the video",
    playNote: "The video loads from its own site when you press play.",
    printLink: "Open this proposal online: {url}",
    states: {
      loading: "Opening your proposal",
      expired:
        "This proposal has expired. Message your account manager for a new one.",
      archived:
        "This proposal is no longer active. Message your account manager.",
      unknown:
        "We couldn't find this proposal. Check the link, or message your account manager.",
      busy: "This page is busy right now. Try again in a minute.",
      // A closed video link lands here as well as a proposal, so the line
      // names the page, not the proposal.
      error:
        "This page didn't load. Refresh it, or message your account manager.",
      // A video link (offer.maharamedia.com/v/...) that has ended: the door
      // sends it to the front page with ?gone=1 (docs/upsell-studio/EDGE.md).
      videoGone:
        "This video link has ended. Message your account manager for a new one.",
    },
    messageUs: "To go ahead, message your account manager on WhatsApp.",
  },
  ar: {
    proposalFor: "عرض سعر إلى {name}",
    preparedBy: "من إعداد {name}، فريق نجاح العملاء",
    validUntil: "صالح حتى {date}",
    found: "اللي لقيناه",
    why: "ليش هذا يناسبكم",
    get: "اللي نسويه لكم",
    work: "من شغلنا",
    runs: "كيف يمشي الشغل",
    investment: "الاستثمار",
    dollars: "دولار",
    split: "أو على دفعتين",
    paidInFull: "دفعة وحدة كاملة",
    oneTime: "دفعة وحدة",
    monthly: "شهرياً",
    perDay: "باليوم",
    per90: "لمدة ٩٠ يوم",
    example: "مثال",
    captured: "لقطة بتاريخ {date}",
    searchedAs: "البحث من {city}",
    play: "شغّلوا الفيديو",
    playNote: "الفيديو يتحمّل من موقعه لما تضغطون تشغيل.",
    printLink: "افتحوا عرض السعر أونلاين: {url}",
    states: {
      loading: "نفتح عرض السعر",
      expired:
        "انتهت مدة عرض السعر هذا. راسلوا فريق نجاح العملاء، ويرسلون لكم عرض جديد.",
      archived: "أوقفنا عرض السعر هذا. راسلوا فريق نجاح العملاء.",
      unknown:
        "ما لقينا عرض السعر هذا. تأكدوا من الرابط، أو راسلوا فريق نجاح العملاء.",
      busy: "الصفحة عليها ضغط الحين. حاولوا بعد دقيقة.",
      error: "ما قدرنا نفتح الصفحة. حدّثوها، أو راسلوا فريق نجاح العملاء.",
      videoGone:
        "رابط الفيديو هذا ما عاد يشتغل. راسلوا فريق نجاح العملاء، ويرسلون لكم رابط جديد.",
    },
    messageUs: "عشان نبدي، راسلوا فريق نجاح العملاء على الواتساب.",
  },
};
