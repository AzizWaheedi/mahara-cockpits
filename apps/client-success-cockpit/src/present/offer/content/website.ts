/**
 * The website deck's words: the canvas (titles, one line per stop, and the
 * variants a client's data picks) and the talk track in the notes window, in
 * English, Kuwaiti and Saudi (docs/upsell-studio/CONTENT.md).
 *
 * Written from the CEO's upsells doc (Website, steps 1 to 4), with what the
 * plan cuts left out: no lead, no call centre, no appointment, no "more
 * people turn up, and more of them sign", no money word on the canvas and no
 * price on it outside the bill. The bill's figures, the client's own words,
 * their capture and their project value come from their data; this file
 * only labels them.
 *
 * The canvas is white Gulf Arabic, the client in the plural, with no
 * dialect-only words. The spoken lines are Kuwaiti (sayKw) and Saudi
 * (saySa), written fresh under mahara-context's aziz-kuwaiti-voice, never
 * translated. Every line here goes through cockpit_client_copy_problems in
 * apps/media-buyer-cockpit/scripts/upsell-copy-supabase.test.ts.
 */
import type { OfferDeckCopy } from "./types";

/** The five slides in their order, then the three a key opens (H, P, V). */
export const WEBSITE_SLIDES = [
  "saw",
  "matters",
  "get",
  "investment",
  "next",
] as const;
export const WEBSITE_KEY_SLIDES = {
  runs: "h",
  proof: "p",
  video: "v",
} as const;
export type WebsiteSlideId =
  | (typeof WEBSITE_SLIDES)[number]
  | keyof typeof WEBSITE_KEY_SLIDES;

/**
 * The website's catalog keys (20261026x): one get line per stop on slide
 * 3, and the three things we need from the client.
 */
export const WEBSITE_GET_KEYS = [
  "pages",
  "portfolio",
  "whatsapp",
  "form",
  "tracking",
  "care",
] as const;
export const WEBSITE_NEED_KEYS = ["logo", "photos", "services"] as const;

/** Each slide's stops, in the order a press reveals them. */
export const WEBSITE_STOPS: Record<WebsiteSlideId, readonly string[]> = {
  saw: ["capture", "cloud", "ask"],
  matters: ["words", "tie"],
  get: ["drawn", ...WEBSITE_GET_KEYS, "need"],
  investment: ["bill", "beside", "ask"],
  next: ["commit", "close"],
  runs: ["steps"],
  proof: ["quote"],
  video: ["play"],
};

export const WEBSITE_DECK: OfferDeckCopy<WebsiteSlideId> = {
  name: { en: "Website", ar: "الموقع" },
  tab: { en: "{name}: your website", ar: "{name}: موقعكم" },
  slides: {
    saw: {
      title: { en: "What we saw", ar: "اللي شفناه" },
      stops: {
        capture: {
          en: "We looked you up the way a customer would",
          ar: "دورنا عليكم مثل ما يدور العميل",
        },
        cloud: {
          en: "What a customer finds today",
          ar: "اللي يلقاه العميل اليوم",
        },
        ask: { en: "Do you have a site?", ar: "عندكم موقع؟" },
      },
      lines: {
        // The note on the cloud, picked by what the capture shows.
        cloud_none: {
          en: "No site of yours comes up",
          ar: "ما يطلع لكم موقع",
        },
        cloud_broken: { en: "The page doesn't open", ar: "الصفحة ما تفتح" },
        cloud_thin: {
          en: "Your projects don't show here",
          ar: "مشاريعكم ما تبين هنا",
        },
        // The ask when the capture is their own site.
        ask_site: {
          en: "Is this the site you send customers to?",
          ar: "هذا الموقع اللي ترسلونه لعملائكم؟",
        },
      },
      notes: {
        say: [
          "(capture) Quick thing before we get into the numbers.",
          "(capture) I looked you up earlier, the way a customer would after seeing your ad.",
          "(cloud) This is what came up.",
          "(ask) Do you have a site?",
          "(Then stop talking. Don't fill the silence. Their answer picks the branch below.)",
        ],
        sayKw: [
          "(capture) شي بسيط قبل ما ندخل بالأرقام.",
          "(capture) دورت عليكم قبل شوي، مثل ما يدور أي عميل بعد ما يشوف إعلانكم.",
          "(cloud) وهذا اللي طلع لي.",
          "(ask) عندكم موقع؟",
        ],
        saySa: [
          "(capture) شي بسيط قبل ما ندخل في الأرقام.",
          "(capture) دورت عليكم قبل شوي، مثل ما يدور أي عميل بعد ما يشوف إعلانكم.",
          "(cloud) وهذا اللي طلع لي.",
          "(ask) عندكم موقع؟",
        ],
      },
    },
    matters: {
      title: { en: "Why it matters for you", ar: "ليش يهمكم هذا" },
      stops: {
        words: { en: "In your words", ar: "بكلامكم" },
        tie: {
          en: "A customer who sees your ad looks you up before they call",
          ar: "العميل اللي يشوف إعلانكم يدور عليكم قبل لا يتواصل معكم",
        },
      },
      lines: {
        // The label above their own words, by which answer prep picked.
        goal90: { en: "Your goal for 90 days", ar: "هدفكم خلال ٩٠ يوم" },
        goal12_24: {
          en: "Your goal for the next 1 to 2 years",
          ar: "هدفكم خلال سنة إلى سنتين",
        },
        challenges: { en: "What's in the way", ar: "اللي واقف بطريقكم" },
        why: { en: "Why you joined us", ar: "ليش بديتوا معنا" },
        typed: { en: "What you told us", ar: "اللي قلتوه لنا" },
        // No answer on file: the slide asks instead of quoting.
        words_empty: {
          en: "What would you want a customer to see before they call you?",
          ar: "أي شي تبون العميل يشوفه قبل لا يتواصل معكم؟",
        },
      },
      notes: {
        say: [
          "(words) This is what you told us when we started.",
          "(Read their words back exactly as they wrote them, then pause.)",
          "(tie) Here's why the site matters right now.",
          "Everyone who sees your ad looks you up first.",
          "What they find in the next thirty seconds decides whether they get in touch, or quietly go cold.",
          "(No site) Right now they find nothing.",
          "(Site that doesn't open) Right now they find the page we just opened.",
          "(Thin site) Right now they find a site that doesn't show your work.",
          "(If they doubt it, give one fact from the list below with its source. Facts stay in the notes, never on the screen.)",
        ],
        sayKw: [
          "(words) هذا اللي قلتوه لنا لما بدينا الشغل.",
          "(tie) وليش الموقع مهم الحين.",
          "أي أحد يشوف إعلانكم، أول شي يسويه يدور عليكم.",
          "واللي يلقاه بأول ثلاثين ثانية، هو اللي يقرر إذا بيتواصل معكم ولا بيختفي بهدوء.",
          "(No site) والحين ما يلقى شي.",
          "(Site that doesn't open) والحين يلقى الصفحة اللي فتحناها قبل شوي.",
          "(Thin site) والحين يلقى موقع ما يوري شغلكم.",
        ],
        saySa: [
          "(words) هذا اللي قلتوه لنا لما بدينا الشغل.",
          "(tie) وليش الموقع مهم الحين.",
          "أي أحد يشوف إعلانكم، أول شي يسويه يدور عليكم.",
          "واللي يلقاه في أول ثلاثين ثانية، هو اللي يحدد إذا بيتواصل معكم ولا بيختفي بهدوء.",
          "(No site) والحين ما يلقى شي.",
          "(Site that doesn't open) والحين يلقى الصفحة اللي فتحناها قبل شوي.",
          "(Thin site) والحين يلقى موقع ما يعرض شغلكم.",
        ],
      },
    },
    get: {
      title: { en: "What you get", ar: "اللي نبنيه لكم" },
      stops: {
        drawn: {
          en: "A first sketch, with your logo and your projects",
          ar: "تصور أولي، بشعاركم ومشاريعكم",
        },
        pages: {
          en: "Up to six pages, Arabic and English",
          ar: "لغاية ٦ صفحات، بالعربي والإنجليزي",
        },
        portfolio: {
          en: "Your projects, each with its photos",
          ar: "مشاريعكم، كل مشروع بصوره",
        },
        whatsapp: {
          en: "WhatsApp, one tap from any page",
          ar: "واتساب، بضغطة من أي صفحة",
        },
        form: {
          en: "An enquiry form, straight to you",
          ar: "نموذج استفسار يوصلكم مباشرة",
        },
        tracking: {
          en: "Tracking, tied to your ads",
          ar: "تتبع مربوط بإعلاناتكم",
        },
        care: {
          en: "Care: hosting, backups, an hour of edits a month",
          ar: "العناية: استضافة، ونسخ احتياطي، وساعة تعديلات بالشهر",
        },
        need: { en: "What we need from you", ar: "اللي نحتاجه منكم" },
      },
      lines: {
        // The first stop when prep has no logo or no example stills: the
        // sketch then carries neither, so the line claims neither.
        drawn_plain: {
          en: "A first sketch, drawn for you",
          ar: "تصور أولي، رسمناه لكم",
        },
        // The drawn site's own words. It speaks to their customer, so the
        // Arabic is singular here (one buyer), as their real site would be.
        sketch_home: { en: "Home", ar: "الرئيسية" },
        sketch_projects: { en: "Projects", ar: "المشاريع" },
        sketch_services: { en: "Services", ar: "الخدمات" },
        sketch_about: { en: "About", ar: "من نحن" },
        sketch_contact: { en: "Contact", ar: "تواصل معنا" },
        sketch_whatsapp: {
          en: "Message us on WhatsApp",
          ar: "راسلنا على الواتساب",
        },
        sketch_enquire: { en: "Send an enquiry", ar: "أرسل استفسارك" },
      },
      notes: {
        say: [
          "(drawn) This is a first sketch, drawn for you with your logo and your own project photos.",
          "(drawn, no logo or no photos on file) This is a first sketch, drawn for you.",
          "(One press, one part. Point at each one on the sketch.)",
          "(pages) Up to six pages, in Arabic and English.",
          "(portfolio) Your projects, shown properly, each with its own photos.",
          "(whatsapp) A WhatsApp button, so they reach you from any page.",
          "(form) An enquiry form that comes straight to you.",
          "(tracking) And tracking, so we can see exactly what the site does for your ads.",
          "(care) Then the care plan: hosting, backups and an hour of edits a month.",
          "(need) From you, three things: your logo, photos of your projects and your list of services.",
        ],
        sayKw: [
          "(drawn) هذا تصور أولي، رسمناه لكم بشعاركم وصور مشاريعكم.",
          "(drawn, no logo or no photos on file) هذا تصور أولي، رسمناه لكم.",
          "(pages) لين ست صفحات، بالعربي والإنجليزي.",
          "(portfolio) ومشاريعكم معروضة صح، كل مشروع بصوره.",
          "(whatsapp) وزر واتساب، يوصلون لكم منه من أي صفحة.",
          "(form) ونموذج استفسار يوصلكم على طول.",
          "(tracking) وتتبع، نشوف منه بالضبط شنو يسوي الموقع للإعلانات.",
          "(care) وبعدها العناية الشهرية: استضافة، ونسخ احتياطي، وساعة تعديلات بالشهر.",
          "(need) ومنكم ثلاث أشياء بس: الشعار، وصور المشاريع، وقائمة الخدمات.",
        ],
        saySa: [
          "(drawn) هذا تصور أولي، رسمناه لكم بشعاركم وصور مشاريعكم.",
          "(drawn, no logo or no photos on file) هذا تصور أولي، رسمناه لكم.",
          "(pages) لين ست صفحات، بالعربي والإنجليزي.",
          "(portfolio) ومشاريعكم معروضة صح، كل مشروع بصوره.",
          "(whatsapp) وزر واتساب، يوصلون لكم منه من أي صفحة.",
          "(form) ونموذج استفسار يوصلكم على طول.",
          "(tracking) وتتبع، نشوف منه بالضبط وش يسوي الموقع للإعلانات.",
          "(care) وبعدها العناية الشهرية: استضافة، ونسخ احتياطي، وساعة تعديلات في الشهر.",
          "(need) ومنكم ثلاث أشياء بس: الشعار، وصور المشاريع، وقائمة الخدمات.",
        ],
      },
    },
    investment: {
      title: { en: "The investment", ar: "الاستثمار" },
      stops: {
        bill: {
          en: "Built once, then cared for monthly",
          ar: "بناء مرة وحدة، وعناية شهرية",
        },
        beside: {
          en: "Next to one of your projects",
          ar: "جنب واحد من مشاريعكم",
        },
        ask: {
          en: "How many projects would pay for this?",
          ar: "كم مشروع يغطي هذا؟",
        },
      },
      lines: {
        // Under "This, first year": what it adds up.
        first_year: {
          en: "The build, plus 12 months of care",
          ar: "البناء، مع ١٢ شهر عناية",
        },
        // No project value on file: the CSM types it in live.
        project_ask: {
          en: "What's a typical project worth to you?",
          ar: "كم قيمة المشروع المعتاد عندكم؟",
        },
      },
      notes: {
        say: [
          "(bill) It's {build} to build it, then {care} a month for hosting, backups and your edits.",
          "(bill) Paid in full, and it goes live two weeks after we have your content.",
          "(beside, from your answer) You told us a typical project is worth about {project}.",
          "(beside, from your sheet) Going by your sheet, your signed projects come to about {project} each.",
          "(beside, no figure on file) What's a typical project worth to you?",
          "(Type their answer in live. It shows as Your figure.)",
          "(ask) How many projects would pay for this?",
          "(Then stop. Let them work it out. Don't do the maths for them, and don't name a lower number here.)",
        ],
        sayKw: [
          "(bill) تكلفة البناء {build}، وبعدها {care} بالشهر للاستضافة والنسخ الاحتياطي والتعديلات.",
          "(bill) دفعة وحدة كاملة، وينطلق بعد أسبوعين من ما يوصلنا المحتوى منكم.",
          "(beside, from your answer) قلتوا لنا إن المشروع المعتاد عندكم قيمته تقريباً {project}.",
          "(beside, from your sheet) حسب جدول المتابعة، المشاريع اللي وقعتوها قيمتها تقريباً {project} للمشروع.",
          "(beside, no figure on file) كم قيمة المشروع المعتاد عندكم؟",
          "(ask) كم مشروع يغطي هذا؟",
        ],
        saySa: [
          "(bill) تكلفة البناء {build}، وبعدها {care} في الشهر للاستضافة والنسخ الاحتياطي والتعديلات.",
          "(bill) دفعة وحدة كاملة، وينطلق بعد أسبوعين من وصول المحتوى منكم.",
          "(beside, from your answer) قلتوا لنا إن المشروع العادي عندكم قيمته تقريباً {project}.",
          "(beside, from your sheet) حسب جدول المتابعة، المشاريع اللي وقعتوها قيمتها تقريباً {project} للمشروع.",
          "(beside, no figure on file) كم قيمة المشروع العادي عندكم؟",
          "(ask) كم مشروع يغطي هذا؟",
        ],
      },
    },
    next: {
      title: { en: "Next step", ar: "الخطوة الجاية" },
      stops: {
        commit: {
          en: "Counted from your payment and your content",
          ar: "ينحسب من الدفع ووصول المحتوى منكم",
        },
        close: {
          en: "Want me to start it this week?",
          ar: "نبدي فيه هالأسبوع؟",
        },
      },
      lines: {
        plan: {
          en: "A plan for the work, not a promise of results",
          ar: "خطة للشغل، مو وعد بنتائج",
        },
      },
      notes: {
        say: [
          "(commit) Here's what we commit to: the pages, the care plan, and the timing, counted from your payment and your content.",
          "(commit) That's a plan for the work. It's not a promise of results.",
          "(close) Want me to start it this week?",
          "(Ask for the card on the call. Copy the payment link from these notes and send it while you're still talking.)",
        ],
        sayKw: [
          "(commit) هذا اللي نلتزم فيه: الصفحات، والعناية الشهرية، والوقت ينحسب من الدفع ووصول المحتوى منكم.",
          "(commit) وهذي خطة للشغل، مو وعد بنتائج.",
          "(close) نبدي فيه هالأسبوع؟",
        ],
        saySa: [
          "(commit) هذا اللي نلتزم فيه: الصفحات، والعناية الشهرية، والوقت يتحسب من الدفع ووصول المحتوى منكم.",
          "(commit) وهذي خطة للشغل، مو وعد بنتائج.",
          "(close) نبدأ فيه هالأسبوع؟",
        ],
        push: [
          "Of course. What would you need to know before you decide?",
          "(If it's the price, use the price steps below. Hold full price first.)",
        ],
        pushKw: ["أكيد. شنو تحتاجون تعرفون قبل لا تقررون؟"],
        pushSa: ["أكيد. وش تحتاجون تعرفون قبل ما تقررون؟"],
      },
    },
    runs: {
      title: { en: "How it runs", ar: "كيف يمشي الشغل" },
      stops: {
        steps: {
          en: "From your payment to a live site",
          ar: "من الدفع إلى إطلاق الموقع",
        },
      },
      lines: {
        us: { en: "Our team", ar: "فريقنا" },
        you: { en: "You", ar: "أنتم" },
      },
      notes: {
        say: [
          "(Show this only if they ask how it works.)",
          "(steps) It runs from your payment and your content, not from today.",
          "You send your logo, photos and list of services. We build it in Arabic and English and show you the draft.",
          "Two weeks after we have your content, it's live. Then the care plan keeps it hosted, backed up and up to date.",
        ],
        sayKw: [
          "(steps) الوقت ينحسب من الدفع ووصول المحتوى، مو من اليوم.",
          "ترسلون لنا الشعار والصور وقائمة الخدمات. نبنيه بالعربي والإنجليزي، ونوريكم المسودة.",
          "وبعد أسبوعين من ما يوصلنا المحتوى، ينطلق. وبعدها العناية الشهرية تخليه شغال ومحفوظ ومحدّث.",
        ],
        saySa: [
          "(steps) الوقت يتحسب من الدفع ووصول المحتوى، مو من اليوم.",
          "ترسلون لنا الشعار والصور وقائمة الخدمات. نبنيه بالعربي والإنجليزي، ونوريكم المسودة.",
          "وبعد أسبوعين من وصول المحتوى، ينطلق. وبعدها العناية الشهرية تخليه شغال ومحفوظ ومحدّث.",
        ],
      },
    },
    proof: {
      title: { en: "Firms we work with", ar: "شركات نشتغل معها" },
      stops: {
        quote: { en: "In their own words", ar: "بكلامهم" },
      },
      notes: {
        say: [
          "(quote) This one is from our main programme, not a website we built. I'll let them say it.",
          "(Play or read it, then stop. Don't narrate their numbers.)",
        ],
        sayKw: [
          "(quote) هذا من برنامجنا الأساسي، مو موقع إحنا بنيناه. بخليهم يتكلمون عن نفسهم.",
        ],
        saySa: [
          "(quote) هذا من برنامجنا الأساسي، مو موقع إحنا بنيناه. بخليهم يتكلمون عن تجربتهم.",
        ],
      },
    },
    video: {
      title: {
        en: "The website, in one minute",
        ar: "الموقع بدقيقة وحدة",
      },
      stops: {
        play: { en: "Watch", ar: "شوفوا" },
      },
      notes: {
        say: [
          "(play) This is a minute on how it works. I'll send it to you after the call as well.",
        ],
        sayKw: [
          "(play) هذا فيديو دقيقة يشرح كيف يمشي الشغل. وبرسله لكم بعد المكالمة كمان.",
        ],
        saySa: [
          "(play) هذا فيديو دقيقة يشرح كيف يمشي الشغل. وبأرسله لكم بعد المكالمة كمان.",
        ],
      },
    },
  },

  // Slide 1's question, answered three ways (the doc's step 1).
  branches: {
    no_site: {
      say: [
        "Is there a reason? I'm asking because most owners at your level already know they need one, so usually something got in the way.",
        "(Wait again. You'll hear one of three answers: too busy, burned before, or it's expensive. Each is under Objections.)",
      ],
      sayKw: [
        "فيه سبب؟ أسأل لأن أغلب أصحاب الشركات بمستواكم يعرفون إنهم يحتاجونه، فعادةً يكون فيه شي عاقكم.",
      ],
      saySa: [
        "فيه سبب؟ أسأل لأن أغلب أصحاب الشركات اللي بمستواكم عارفين إنهم يحتاجونه، فعادةً يكون فيه شي أخّركم.",
      ],
    },
    broken: {
      say: [
        "Can you send me the link you give people? Let's open it together.",
        "(Open it on the shared screen and let them see what loads.)",
        "This is what someone sees when they look you up after the ad.",
        "Did you know it was showing this?",
      ],
      sayKw: [
        "ممكن ترسلون لي الرابط اللي تعطونه الناس؟ خلونا نفتحه سوا.",
        "هذا اللي يشوفه أي أحد يدور عليكم بعد ما يشوف الإعلان.",
        "كنتوا تدرون إنه يطلع جذي؟",
      ],
      saySa: [
        "ممكن ترسلون لي الرابط اللي تعطونه للناس؟ خلونا نفتحه سوا.",
        "هذا اللي يشوفه أي أحد يدور عليكم بعد ما يشوف الإعلان.",
        "كنتوا تدرون إنه يطلع كذا؟",
      ],
    },
    working_on_it: {
      say: [
        "Good to hear. How long has it been in the works?",
        "(Let them answer. If it's been months, the real question is what's holding it up.)",
        "Is there a reason it's taken this long? Usually something got in the way.",
      ],
      sayKw: [
        "حلو. من متى وأنتم تشتغلون عليه؟",
        "وشنو اللي مأخره؟ عادةً يكون فيه شي عاقه.",
      ],
      saySa: [
        "حلو. من متى وأنتم شغالين عليه؟",
        "ووش اللي مأخره؟ عادةً يكون فيه شي معطله.",
      ],
    },
  },

  // Why they don't have one yet (the doc's step 2). Answer, then go on to
  // slide 2.
  objections: {
    busy: {
      say: [
        "Fair enough. That's exactly why we do it, rather than you managing it.",
        "You send us three things, and the rest is on us.",
        "(No real objection here, just no urgency. Press on to Why it matters for you.)",
      ],
      sayKw: [
        "عادي، وهذا بالضبط ليش إحنا نسويه بدال ما تديرونه أنتم.",
        "ترسلون لنا ثلاث أشياء، والباقي علينا.",
      ],
      saySa: [
        "طبيعي، وهذا بالضبط ليش إحنا نسويه بدال ما تتابعونه أنتم.",
        "ترسلون لنا ثلاث أشياء، والباقي علينا.",
      ],
    },
    burned: {
      say: [
        "That happens a lot, and I understand why you'd be careful.",
        "Here's the difference. The timing is written down: live two weeks after we have your content, and you see it before it goes live.",
        "And it sits with me. If anything runs late, you message me and I chase it.",
        "(Expect resistance on trust, not price. Don't rush this one.)",
      ],
      sayKw: [
        "هذا يصير وايد، وأفهم ليش صرتوا حذرين.",
        "الفرق إن الوقت واضح ومكتوب: ينطلق بعد أسبوعين من ما يوصلنا المحتوى منكم، وتشوفونه قبل لا ينزل.",
        "وأنا معاكم فيه. إذا تأخر أي شي، ترسلون لي وأنا ألحقه.",
      ],
      saySa: [
        "هذا يصير كثير، وأفهم ليش صرتوا حذرين.",
        "الفرق إن الوقت واضح ومكتوب: ينطلق بعد أسبوعين من وصول المحتوى منكم، وتشوفونه قبل ما ينزل.",
        "وأنا معكم فيه. إذا تأخر أي شي، ترسلون لي وأنا أتابعه.",
      ],
    },
    expensive: {
      say: [
        "Fair question. Let's not look at it on its own. Let's put it next to one of your projects.",
        "(It's usually about not seeing the return. Press on to The investment and stop on its second step.)",
      ],
      sayKw: [
        "سؤال في محله. خلونا ما نشوفه لحاله، نحطه جنب مشروع من مشاريعكم.",
      ],
      saySa: [
        "سؤال في محله. خلونا ما نشوفه لحاله، نحطه جنب مشروع من مشاريعكم.",
      ],
    },
  },

  // The price on the call. The canvas shows the opening price and nothing
  // else; a lower number is said, never shown.
  price: {
    hold: {
      say: [
        "I hear you. The build is paid in full. The care plan is paid monthly.",
        "Let's look at it next to one of your projects again, the way we just did.",
        "(Tap Held full price in these notes before you say any lower number.)",
      ],
      sayKw: [
        "أفهمكم. البناء دفعة وحدة كاملة. والعناية دفعها شهري.",
        "خلونا نرجع نشوفه جنب مشروع من مشاريعكم، مثل ما سوينا قبل شوي.",
      ],
      saySa: [
        "أفهمكم. البناء دفعة وحدة كاملة. والعناية دفعها شهري.",
        "خلونا نرجع نشوفه جنب مشروع من مشاريعكم، مثل ما سوينا قبل شوي.",
      ],
    },
    lower: {
      say: [
        "(Only after Held full price, with the reason typed in these notes. Say it out loud. It never goes on the screen.)",
        "If I make the build {final}, can we start it this week?",
        "I'll send you the new payment link now.",
      ],
      sayKw: [
        "إذا خليت البناء {final}، نبدي فيه هالأسبوع؟",
        "برسل لكم رابط الدفع الجديد الحين.",
      ],
      saySa: [
        "إذا خليت البناء {final}، نبدأ فيه هالأسبوع؟",
        "بأرسل لكم رابط الدفع الجديد الحين.",
      ],
    },
    split: {
      say: [
        "(The website has no split. If they ask to pay in parts, hold full price.)",
        "The build is paid in full. The care is the monthly part, so that side is already spread out.",
      ],
      sayKw: ["البناء دفعة وحدة كاملة. والعناية هي الجزء الشهري أصلاً."],
      saySa: ["البناء دفعة وحدة كاملة. والعناية هي الجزء الشهري أصلاً."],
    },
  },

  // The CSM sends this from their own WhatsApp after the call. {name} is
  // the CSM's first name, signing off; {next} is the step you agreed.
  whatsapp: {
    en: "Hi, thanks for your time today. Here's the one-minute video on the website, to watch again or send to your partners: {video}\nNext step: {next}\n{name}",
    kw: "هلا والله، شكراً على وقتكم اليوم. هذا فيديو الموقع، دقيقة وحدة، ترجعون له أو ترسلونه لشركائكم: {video}\nالخطوة الجاية: {next}\n{name}",
    sa: "هلا والله، شكراً على وقتكم اليوم. هذا فيديو الموقع، دقيقة وحدة، ترجعون له أو ترسلونه لشركائكم: {video}\nالخطوة اللي بعدها: {next}\n{name}",
  },

  // For the notes only, when a client doubts that a site matters. None is
  // a Gulf figure, so each says where it was measured. Each was checked
  // against a second source on 26 Oct 2026 (docs/upsell-studio/CONTENT.md);
  // the plan's BrightLocal 2026 figure could not be, so it is left out.
  facts: [
    {
      text: "When people judged whether a site could be trusted, 46.1% of their comments were about its design and look.",
      source:
        "B.J. Fogg and others, Stanford Persuasive Technology Lab with Consumer WebWatch, How Do People Evaluate a Web Site's Credibility? (2,684 people, US)",
      year: 2002,
      country: "any",
    },
    {
      text: "People judge how appealing a web page looks within about 50 milliseconds.",
      source:
        "Lindgaard and others, Carleton University, Behaviour & Information Technology, reported by Nature (lab study, Canada)",
      year: 2006,
      country: "any",
    },
    {
      text: "76% of online shoppers prefer to buy when the product information is in their own language.",
      source:
        "CSA Research with Kantar, Can't Read, Won't Buy: B2C (8,709 shoppers, 29 countries)",
      year: 2020,
      country: "any",
    },
  ],
};
