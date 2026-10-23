/**
 * Everything the Brand Blueprint call deck says, in English and in the
 * client-facing Gulf Arabic (docs/brand-blueprint/SPEC.md 5.2 and 5.6).
 * The creative director presents it; the client watches their brand land on
 * one wall: their words, their look, their offer.
 *
 * The copy rules of the client decks hold here too, pinned by
 * scripts/blueprint-copy.test.ts: sentence case; no exclamation marks; no em
 * dashes; plain quotes; no promise of results; no leads, cost per lead or ad
 * money on any slide; the five main services by their kickoff names;
 * anything that is not the client's own is labelled (Example, Example
 * wording, Starter ads from our templates); roles, never names. Arabic:
 * white Gulf on the slides, the client in the plural, Arabic-Indic digits,
 * no middle dot, no dialect-only words; the spoken lines (sayAr) may speak
 * Kuwaiti. `{slot}` marks a value filled from the client's data.
 */

import type { L, SlideNotes } from "./content";

export const BP = {
  deckName: { en: "Brand Blueprint", ar: "بناء الهوية والعرض" },

  /** The three frames on the wall: the call's one drawing, filled as it goes. */
  frames: {
    words: {
      name: { en: "Your words", ar: "كلامكم" },
      hint: {
        en: "How you describe your work, in your own words",
        ar: "كيف توصفون شغلكم، بكلامكم",
      },
    },
    look: {
      name: { en: "Your look", ar: "هويتكم البصرية" },
      hint: {
        en: "Materials, colours and type",
        ar: "الخامات والألوان والخطوط",
      },
    },
    offer: {
      name: { en: "Your offer", ar: "عرضكم" },
      hint: { en: "What your ads offer", ar: "العرض اللي تقدمه إعلاناتكم" },
    },
  },

  /** The three parts of the form, as the slides and the run sheet name them. */
  parts: {
    1: { en: "Starter ads", ar: "إعلانات البداية" },
    2: { en: "Brand and money", ar: "الهوية والأرقام" },
    3: { en: "Your offer", ar: "عرضكم" },
  },
  partOf: { en: "Part {n} of 3", ar: "الجزء {n} من ٣" },

  /** Where an answer came from, printed beside it on the paper. */
  source: {
    kickoff: { en: "From your kickoff form", ar: "من نموذج بداية الشغل" },
    /** What the onboarding deck recorded on the onboarding call (its prep). */
    deck: { en: "From your onboarding call", ar: "من مكالمة التعريف" },
    onboarding: {
      en: "From your onboarding form",
      ar: "من نموذج التعريف بالنشاط",
    },
    call: { en: "Said on this call", ar: "قلتوه بهالمكالمة" },
    now: { en: "Just now", ar: "انكتب الحين" },
    dna: { en: "From your Brand DNA doc", ar: "من ملف هويتكم" },
  },

  tag: {
    example: { en: "Example", ar: "مثال" },
    exampleWording: { en: "Example wording", ar: "صياغة للتوضيح" },
    /** Over each phone on slide 5's first stop: an example of a starter ad. */
    exampleAd: { en: "Example ad", ar: "إعلان للتوضيح" },
    starter: {
      en: "Starter ads, from our templates",
      ar: "إعلانات البداية، من قوالبنا",
    },
    /** The struck line on slide 6 when it is their own earlier line. */
    before: { en: "Your words before", ar: "كلامكم من قبل" },
  },

  legend: { en: "Amber cards are yours to do", ar: "البطاقات الصفرا عليكم" },

  /**
   * The wall's one way of saying "not answered yet" (score round 2 of the
   * design pass: bare underlines, grey options and placeholder sentences
   * read as a web form): a pencil note in the presenter's hand, with a
   * pencil tick, on blank paper. Never a placeholder in grey.
   */
  prompt: {
    together: { en: "We write this together", ar: "نكتبها مع بعض" },
    now: { en: "We write this now", ar: "نكتبها الحين" },
    pick: { en: "We pick it now", ar: "نختارها الحين" },
    add: { en: "We add these together", ar: "نضيفها مع بعض" },
  },
  /** The wall map's name, once, on slide 2 (score round 2: an unnamed glyph). */
  mapName: { en: "Your wall", ar: "جداركم" },

  // ------------------------------------------------------------ 1 cover
  cover: {
    dateline: {
      en: "Brand Blueprint call · {date} · 45 minutes",
      ar: "مكالمة بناء الهوية والعرض، {date}، ٤٥ دقيقة",
    },
    lead: {
      en: "Today we put your brand on one wall: how you talk, how you look, and what your ads offer.",
      ar: "اليوم نجمع هويتكم على جدار واحد: كيف تتكلمون، وكيف تظهرون، والعرض اللي تقدمه إعلاناتكم.",
    },
    byline: { en: "With our creative director", ar: "مع المدير الإبداعي" },
    /**
     * The byline when the record names the presenter (their first name
     * only). The Arabic puts the name with the team, never beside a
     * gendered role, since the record does not say whether the presenter
     * is a man or a woman (score round 2: "مع Sara، المدير الإبداعي").
     */
    bylineNamed: {
      en: "With {name}, our creative director",
      ar: "مع {name}، من فريقنا الإبداعي",
    },
    sticky: {
      en: "Have your price list near you. We'll ask for real numbers.",
      ar: "خلوا قائمة أسعاركم قريبة منكم. بنسألكم عن أرقام حقيقية.",
    },
    logo: { en: "Your logo", ar: "شعاركم" },
    /** The cover's photo print: theirs from the record, else an example render. */
    photoOwn: { en: "From your photos", ar: "من صوركم" },
    photoExample: { en: "Example photo", ar: "صورة للتوضيح" },
  },

  // ------------------------------------------------------------ 2 so far
  soFar: {
    sub: {
      en: "From your onboarding form and your kickoff form",
      ar: "من نموذج التعريف بالنشاط ونموذج بداية الشغل",
    },
    subForm: {
      en: "From your onboarding form",
      ar: "من نموذج التعريف بالنشاط",
    },
    goal: {
      en: "Your goal for the next 90 days",
      ar: "هدفكم لأول ٩٠ يوم",
    },
    clients: {
      en: "The clients you want more of",
      ar: "العملاء اللي تبون منهم أكثر",
    },
    never: { en: "Never in an ad", ar: "ما ينحط بأي إعلان" },
    addLine: { en: "Add a line", ar: "أضيفوا سطر" },
    /** The lit service, as one chip (the fan is slide 4's). */
    service: {
      en: "The service we start with",
      ar: "الخدمة اللي نبدي فيها",
    },
    noService: {
      en: "We pick it together in a minute.",
      ar: "نختارها مع بعض بعد شوي.",
    },
    sticky: {
      en: "Anything wrong? Say it now. It saves as we talk.",
      ar: "فيه شي غلط؟ قولوه الحين، ينحفظ وإحنا نتكلم.",
    },
    noGoal: {
      en: "We'll write your 90-day goal together.",
      ar: "بنكتب هدفكم لأول ٩٠ يوم مع بعض.",
    },
    /**
     * Nothing on file for the clients they want or their red lines: one
     * sticky in place of two blank cards (score round 1 of the design pass).
     */
    together: {
      en: "The clients you want more of, and what never goes in an ad: we write them together now.",
      ar: "العملاء اللي تبون منهم أكثر، واللي ما ينحط بأي إعلان: نكتبها مع بعض الحين.",
    },
  },

  // ------------------------------------------------------------ 3 run sheet
  today: {
    sheet: { en: "Run sheet · {date}", ar: "جدول المكالمة، {date}" },
    min: { en: "Min", ar: "الدقيقة" },
    start: { en: "Start", ar: "البداية" },
    rows: [
      { at: 0, en: "What you've told us", ar: "اللي قلتوه لنا" },
      {
        at: 3,
        en: "One service, and your first ads",
        ar: "خدمة وحدة، وإعلانات البداية",
      },
      {
        at: 10,
        en: "What you're best at, and your numbers",
        ar: "اللي تتميزون فيه، وأرقامكم",
      },
      { at: 21, en: "Who you're up against", ar: "مين تنافسون بالسوق" },
      { at: 24, en: "Your offer", ar: "عرضكم" },
      {
        at: 33,
        en: "How ads work, and your brand",
        ar: "كيف تشتغل الإعلانات، وهويتكم",
      },
      {
        at: 38,
        en: "What we need, and the read-back",
        ar: "اللي نحتاجه، ونراجع كل شي",
      },
      { at: 42, en: "What happens next", ar: "الخطوات الجاية" },
    ],
    /** The sheet's last row, after the call: part 3, under its own dashed bracket. */
    after: {
      en: "Your offer, locked with you",
      ar: "عرضكم، نثبته معكم",
    },
    afterMin: { en: "After", ar: "بعدها" },
    brackets: {
      1: {
        en: "Part 1 · Starter ads · sent by minute 10",
        ar: "الجزء الأول، إعلانات البداية، ينرسل قبل الدقيقة ١٠",
      },
      2: {
        en: "Part 2 · Brand and money",
        ar: "الجزء الثاني، الهوية والأرقام",
      },
      // Two deliberate lines under the part (score round 3: "in" was left
      // alone on its own line).
      3: {
        en: "Part 3 · After the call · in 1 to 2 days",
        ar: "الجزء الثالث، بعد المكالمة، خلال يوم أو يومين",
      },
    },
    rulesHead: { en: "Three rules for today", ar: "ثلاث قواعد لليوم" },
    rules: [
      {
        en: "We'll push back when something won't sell.",
        ar: "بنقول لكم بصراحة إذا شفنا شي ما يبيع.",
      },
      { en: "Be specific on money.", ar: "خلونا دقيقين بالأرقام." },
      // No quotation marks at 40 px (score round 2); the copy rules keep
      // quotes plain, so the line says it without any.
      {
        en: "It's fine to say you don't know.",
        ar: "عادي تقولون ما نعرف.",
      },
    ],
  },

  // ------------------------------------------------------------ 4 one service
  oneService: {
    line: {
      en: "One service per campaign. The others wait their turn.",
      ar: "خدمة وحدة لكل حملة، والباقي ياخذ دوره بعدين.",
    },
    parked: { en: "Parked for later", ar: "نرجع لها بعدين" },
    /** Under the tag's head: the services they offer that are not one of the five. */
    theirs: { en: "Also on your list", ar: "وبعد عندكم" },
    parkedNone: {
      en: "Nothing else on file yet.",
      ar: "ما فيه شي ثاني مسجل للحين.",
    },
    two: { en: "Which one goes first?", ar: "أي وحدة نبدي فيها؟" },
    none: {
      en: "Which service do we start with?",
      ar: "أي خدمة نبدي فيها؟",
    },
  },

  // ------------------------------------------------------------ 5 first ads
  firstAds: {
    line: {
      en: "Your own ads follow, made from your photos and your words.",
      ar: "وبعدها إعلاناتكم الخاصة، من صوركم وكلامكم.",
    },
    /** Stop 1's start column: what the starter pack is, in three short lines. */
    pack: [
      // {service}: the lit service, mid-sentence in English ("interior
      // design") and by its name in Arabic ("تصميم داخلي").
      {
        en: "Ready-made ads for {service}, from our templates.",
        ar: "إعلانات {service} جاهزة، من قوالبنا.",
      },
      {
        en: "You see them, and say yes, before they run.",
        ar: "تشوفونها وتوافقون عليها قبل لا تنزل.",
      },
      {
        en: "They run while we make yours, from your photos and your words.",
        ar: "تشتغل لين نجهز إعلاناتكم الخاصة، من صوركم وكلامكم.",
      },
    ],
    /** The first line when no service is lit yet. */
    packAny: {
      en: "Ready-made ads for your service, from our templates.",
      ar: "إعلانات جاهزة لخدمتكم، من قوالبنا.",
    },
    open: { en: "Open the pack", ar: "افتحوا الملف" },
    /** Under the Stories and Reels phone: short, so it keeps one line. */
    reels: { en: "Stories and Reels", ar: "ستوري وريلز" },
    /**
     * The example ads' caption when the record has no selling line of
     * theirs: ours, so the phones' "Example ad" tag covers it. {service} as
     * in the pack's first line.
     */
    caption: {
      en: "{service}, from the first call to the handover.",
      ar: "{service}، من أول مكالمة لين التسليم.",
    },
    packFor: {
      en: "The starter pack for {service}",
      ar: "ملف إعلانات البداية، {service}",
    },
    /** Slide 5's title when they start with their own ads (starter = no). */
    titleOwn: {
      en: "Your own ads, made from your shots",
      ar: "إعلاناتكم الخاصة، من لقطاتكم",
    },
    /** Slide 5 stop 1 with no pack link yet: a quiet print, never a dead button. */
    packSoon: {
      en: "Your starter pack opens here, from our media team's templates.",
      ar: "ملف إعلانات البداية ينفتح هنا، من قوالب فريق الإعلانات.",
    },
    sheetLead: {
      en: "Most of it came from your kickoff form. You check it, we type it, and your first ads go to our media team.",
      ar: "أغلبه من نموذج بداية الشغل. أنتم تراجعونه، وإحنا نكتبه، وأول إعلاناتكم تروح لفريق الإعلانات.",
    },
    sheetLeadNew: {
      en: "We fill it in together now. You check it, we type it, and your first ads go to our media team.",
      ar: "نعبيه مع بعض الحين. أنتم تراجعونه، وإحنا نكتبه، وأول إعلاناتكم تروح لفريق الإعلانات.",
    },
    sheetTitle: {
      en: "Part 1, filled in together",
      ar: "الجزء الأول، نعبيه مع بعض",
    },
    service: {
      en: "The one service this campaign sells",
      ar: "الخدمة اللي نعلن عنها",
    },
    serviceRest: {
      en: "The others wait their turn",
      ar: "الباقي ياخذ دوره بعدين",
    },
    starter: {
      en: "Start with our starter ads while we make yours?",
      ar: "نبدي بإعلانات البداية لين نجهز إعلاناتكم الخاصة؟",
    },
    starterNote: {
      en: "Live once your ad account is ready",
      ar: "تنزل أول ما يجهز حسابكم الإعلاني",
    },
    yes: { en: "Yes", ar: "نعم" },
    no: { en: "No", ar: "لا" },
    approval: {
      en: "Have you approved the starter ads?",
      ar: "وافقتوا على إعلانات البداية؟",
    },
    /** One of three, drawn as a segmented control like Yes / No. */
    approvals: {
      on_call: {
        en: "Approved on this call",
        ar: "وافقنا عليها بهالمكالمة",
      },
      before: { en: "Approved before the call", ar: "وافقنا عليها من قبل" },
      wants_changes: { en: "We want changes", ar: "نبي تعديلات" },
    },
    redLines: { en: "Red lines for any ad", ar: "الخطوط الحمراء بأي إعلان" },
    /** The sheet's fold, by how many answers it keeps (none: no fold). */
    fold: {
      one: {
        en: "Kept in our notes, off this screen: 1 answer for our media team",
        ar: "محفوظة بملاحظاتنا، مو على الشاشة: جواب واحد لفريق الإعلانات",
      },
      two: {
        en: "Kept in our notes, off this screen: 2 answers for our media team",
        ar: "محفوظة بملاحظاتنا، مو على الشاشة: جوابين لفريق الإعلانات",
      },
      many: {
        en: "Kept in our notes, off this screen: {n} answers for our media team",
        ar: "محفوظة بملاحظاتنا، مو على الشاشة: {n} أجوبة لفريق الإعلانات",
      },
    },
    stamp: {
      title: { en: "Part 1 done", ar: "الجزء الأول تم" },
      line: {
        en: "On its way to our media team at {time}",
        ar: "انرسل لفريق الإعلانات الساعة {time}",
      },
    },
    /** One grey helper line under the red lines, until the stamp lands. */
    signoff: {
      en: "Our media team gets this when we send it.",
      ar: "يوصل لفريق الإعلانات أول ما نرسله.",
    },
    partsDone: {
      1: { en: "Sent to our media team", ar: "انرسل لفريق الإعلانات" },
      2: { en: "Done on this call", ar: "خلصناه بهالمكالمة" },
      3: {
        en: "Locked with you in 1 to 2 days",
        ar: "نثبته معكم خلال يوم أو يومين",
      },
    },
    partsNow: {
      1: { en: "Being filled in now", ar: "نعبيه الحين" },
    },
    /** A part still to come, as the sheet lists it. */
    partsNext: {
      2: { en: "The rest of this call", ar: "باقي هالمكالمة" },
    },
    ownFirst: {
      en: "Your own ads first",
      ar: "إعلاناتكم الخاصة أول",
    },
    ownFirstLine: {
      en: "No starter ads: we build your account while your own ads are made, from the four shots you send us.",
      ar: "بدون إعلانات البداية: نجهز حسابكم وإحنا نسوي إعلاناتكم الخاصة، من الأربع لقطات اللي بترسلونها.",
    },
  },

  // ------------------------------------------------------------ 6 best at
  bestAt: {
    struck: {
      en: "Quality work, delivered on time.",
      ar: "شغل بجودة عالية، وتسليم بالوقت.",
    },
    method: {
      en: "How a project runs with you, first call to handover",
      ar: "كيف يمشي المشروع معكم، من أول مكالمة لين التسليم",
    },
    clients: {
      en: "The clients you want more of",
      ar: "العملاء اللي تبون منهم أكثر",
    },
    notFor: { en: "Who you don't want", ar: "العملاء اللي ما تبونهم" },
    cityCant: {
      en: "What most firms in your city can't do",
      ar: "اللي أغلب الشركات بمدينتكم ما تقدر تسويه",
    },
  },

  // ------------------------------------------------------------ 7 pricing
  pricing: {
    marks: {
      minimum: {
        en: "The smallest project you take",
        ar: "أصغر مشروع تقبلونه",
      },
      most: { en: "Where most projects land", ar: "قيمة أغلب المشاريع" },
      anchor: {
        en: "Where your ads point",
        ar: "القيمة اللي تركز عليها إعلاناتكم",
      },
    },
    pricing: {
      en: "How you price, and where most projects land",
      ar: "كيف تسعرون، وقيمة أغلب مشاريعكم",
    },
    terms: {
      en: "How you're paid",
      ar: "الدفعة الأولى وطريقة الدفع",
    },
    filter: {
      en: "Our projects start from {minimum}. Is that within what you had in mind?",
      ar: "مشاريعنا تبدي من {minimum}. هذا ضمن اللي في بالكم؟",
    },
    filterHead: {
      en: "How our callers check it, when someone enquires",
      ar: "كيف يتأكد فريق الاتصال، لما أحد يستفسر",
    },
    /**
     * How they are paid, not said yet: a pencilled example of a split on
     * blank paper, tagged Example (score round 2 of the design pass: two
     * bare underlines read as a form field).
     */
    termsEg: { en: "30 / 40 / 30?", ar: "٣٠ / ٤٠ / ٣٠؟" },
    amount: { en: "Amount", ar: "المبلغ" },
    /** An empty amount's placeholder, in their currency (an example, so marked e.g.). */
    eg: { en: "e.g. {amount}", ar: "مثلاً {amount}" },
    /** The flags on the tape, over each mark placed by its value. */
    flags: {
      minimum: { en: "Smallest", ar: "الأصغر" },
      most: { en: "Most projects", ar: "أغلب المشاريع" },
      /** A band too narrow for its two numbers: they go on its flag. */
      mostRange: {
        en: "Most projects: {lo} to {hi}",
        ar: "أغلب المشاريع: {lo} إلى {hi}",
      },
      anchor: { en: "Your ads", ar: "إعلاناتكم" },
    },
  },

  // ------------------------------------------------------------ 8 competitors
  competitors: {
    head: {
      en: "The names you come up against",
      ar: "الأسماء اللي تنافسونها",
    },
    /** The slide's sub: the question itself. */
    ask: {
      en: "Who do you actually lose projects to, and why?",
      ar: "مين اللي فعلاً تخسرون مشاريع قدامه، وليش؟",
    },
    lose: { en: "We lose to them", ar: "نخسر قدامهم" },
    add: { en: "Add a name", ar: "أضيفوا اسم" },
    /** Under each name on its clipping: what they are known for, in the client's words. */
    note: { en: "What they're known for", ar: "اللي يتميزون فيه" },
    /**
     * Example clippings until the first name is typed: ours, so each is
     * tagged Example (score round 3: dashed chips read as a web form).
     */
    ghosts: [
      {
        name: {
          en: "The studio you lose to most",
          ar: "الاستوديو اللي تخسرون قدامه أكثر",
        },
        note: { en: "Quick quotes", ar: "عروض أسعار سريعة" },
      },
      {
        name: {
          en: "A firm that wins on price",
          ar: "شركة تكسب بالسعر",
        },
        note: { en: "Lower prices", ar: "أسعار أقل" },
      },
      {
        name: {
          en: "A name clients compare you with",
          ar: "اسم يقارنكم فيه العملاء",
        },
        note: { en: "A big showroom", ar: "معرض كبير" },
      },
      // Five across the wall: the row's free places hold examples while
      // the call is on (score round 1 of the design pass).
      {
        name: {
          en: "The big firm in your city",
          ar: "الشركة الكبيرة بمدينتكم",
        },
        note: { en: "A known name", ar: "اسم معروف" },
      },
      {
        name: { en: "A designer known online", ar: "مصمم معروف أونلاين" },
        note: { en: "Striking renders", ar: "تصاميم تلفت النظر" },
      },
    ],
    /** More names than the wall shows: the rest are counted. */
    more: { en: "and {n} more", ar: "وغيرهم ({n})" },
    whyUs: {
      en: "Why people pick you instead",
      ar: "ليش العملاء يختارونكم بدالهم",
    },
  },

  // ------------------------------------------------------------ 9 offer
  offer: {
    lead: {
      en: "We start from a draft in your offer sheet. You correct it, and we lock it with you.",
      ar: "نبدي من مسودة بملف العرض. أنتم تعدلونها، وبعدها نثبت العرض معكم.",
    },
    /**
     * Stop 2, while the sheet is shared from its own window: the lead's
     * second line (score round 1 of the design pass: the paper card for
     * the sheet was an empty ruled card, with a presenter's instruction).
     */
    sheetLead: {
      en: "Now we open your offer sheet together. It locks in 1 to 2 days, with you.",
      ar: "الحين نفتح ملف العرض مع بعض، ونثبته معكم خلال يوم أو يومين.",
    },
    lines: [
      { en: "The pattern", ar: "الفكرة" },
      { en: "Its name", ar: "اسمه" },
      { en: "Two or three bonuses", ar: "إضافتين أو ثلاث مع العرض" },
      {
        en: "The price your ads point to",
        ar: "السعر اللي تركز عليه إعلاناتكم",
      },
      {
        en: "The free first step, and who gives it",
        ar: "الخطوة الأولى المجانية، ومين يقدمها",
      },
    ],
    foot: {
      en: "Draft · locks in 1 to 2 days",
      ar: "مسودة، ونثبت العرض معكم خلال يوم أو يومين",
    },
    /** A tag line not on the record yet: it is written in the offer sheet. */
    inSheet: { en: "In your offer sheet", ar: "بملف العرض" },
    /**
     * The tag's foot names the offer sheet once for every open ring (score
     * round 2: "In your offer sheet" five times over).
     */
    restInSheet: {
      en: "The rest is in your offer sheet.",
      ar: "الباقي بملف العرض.",
    },
    nowIn: { en: "Now in your offer sheet", ar: "الحين بملف العرض" },
    sheet: { en: "Your offer sheet", ar: "ملف العرض" },
    /** Stop 2's paper card, while the sheet is shared from its own window. */
    sheetOpen: {
      en: "Open in its own window",
      ar: "مفتوح بالنافذة الثانية",
    },
    sheetTitle: { en: "{name} · offer sheet", ar: "ملف العرض، {name}" },
  },

  // ------------------------------------------------------------ 10 how ads work
  howAds: {
    friend: {
      en: "Someone referred to you",
      ar: "شخص جاكم بتوصية",
    },
    ad: { en: "Someone who saw your ad", ar: "شخص شاف إعلانكم" },
    friendWhy: {
      en: "They trust you before they call.",
      ar: "يثق فيكم قبل لا يتصل.",
    },
    adWhy: {
      en: "They meet you for the first time.",
      ar: "يتعرف عليكم لأول مرة.",
    },
    /** Where the two roads meet. */
    client: { en: "The same client", ar: "نفس العميل" },
    same: {
      en: "Same person, same money. The only difference is trust.",
      ar: "نفس الشخص، ونفس المبلغ اللي بيدفعه. الفرق الوحيد هو الثقة.",
    },
    learn: {
      en: "Your ads learn for 30 to 60 days. Volume beats luck.",
      // Said as people say it (score round 1 of the design pass: "الكمية
      // تغلب الحظ" read as a translation of "Volume beats luck").
      ar: "أول ٣٠ إلى ٦٠ يوم نكتشف اللي يشتغل بإعلاناتكم. كثرة الإعلانات هي اللي تعلمنا، مو الحظ.",
    },
    learnStart: { en: "Day 1", ar: "أول يوم" },
    learnEnd: { en: "Day 60", ar: "يوم ٦٠" },
    approveHead: {
      en: "How you approve your own ads",
      ar: "كيف توافقون على إعلاناتكم الخاصة",
    },
    approvals: {
      every: {
        // One line each (score round 2: the middle title wrapped).
        title: { en: "Every video", ar: "كل فيديو" },
        line: {
          en: "You see each one before it runs.",
          ar: "تشوفون الفيديو قبل لا ينزل.",
        },
      },
      first_batch: {
        title: { en: "The first batch", ar: "أول مجموعة" },
        line: {
          en: "You approve the first round. The next ones go live as we make them.",
          ar: "توافقون على أول مجموعة، واللي بعدها تنزل أول ما تجهز.",
        },
      },
      run_then_show: {
        title: { en: "Run, then show you", ar: "نشغلها ونوريكم" },
        line: {
          en: "They go live, and you see them in the group.",
          ar: "تنزل، وتشوفونها بالقروب.",
        },
      },
    },
  },

  // ------------------------------------------------------------ 11 brand
  brand: {
    board: { en: "Your look, on one board", ar: "هويتكم بلوحة وحدة" },
    logoMissing: {
      en: "Your logo files: in your Brand DNA doc",
      ar: "ملفات الشعار: بملف هويتكم",
    },
    colours: { en: "Your colours", ar: "ألوانكم" },
    coloursMissing: {
      en: "Colours: confirm in your Brand DNA doc",
      ar: "الألوان: نتأكد منها بملف هويتكم",
    },
    /** No colours on record: one paper card instead of empty swatches. */
    dnaOpen: {
      en: "We open your Brand DNA doc together",
      ar: "نفتح ملف هويتكم مع بعض",
    },
    dnaLine: {
      en: "Your logo files, colours and type are kept there.",
      ar: "ملفات الشعار والألوان والخطوط محفوظة فيه.",
    },
    /** With no colours on record: what the doc is opened for, one ruled row each. */
    dnaLook: [
      { en: "Your logo files", ar: "ملفات الشعار" },
      { en: "Your colours", ar: "ألوانكم" },
      { en: "Your type", ar: "خطوطكم" },
    ],
    dnaTitle: { en: "{name} · Brand DNA", ar: "ملف الهوية، {name}" },
    /** Slide 11's page for the doc, beside their logo: its name, short. */
    dnaDoc: { en: "Your Brand DNA doc", ar: "ملف هويتكم" },
    /** The material board: their photos' materials, else examples of their service's. */
    materials: {
      en: "Materials from your projects",
      ar: "خامات من مشاريعكم",
    },
    materialsExample: { en: "Example materials", ar: "خامات للتوضيح" },
    /** The type specimen, set in the deck's own faces, so always an example. */
    pairing: { en: "Example pairing", ar: "خطوط للتوضيح" },
    /**
     * The specimen set as their Brand DNA doc describes their type (a serif
     * for the wordmark, Geist for text: score round 2 of the design pass,
     * an example grotesque beside a doc that names a serif contradicted it).
     */
    pairingDoc: { en: "Set as your doc describes", ar: "على وصف ملف هويتكم" },
    /** What their Brand DNA doc says about type, under the specimen. */
    typeIn: { en: "In your doc: {type}", ar: "بملف هويتكم: {type}" },
    /** The label over their doc's own words about type, on a line of its own. */
    typeHead: { en: "In your doc", ar: "بملف هويتكم" },
    paletteExample: { en: "Example palette", ar: "ألوان للتوضيح" },
    /**
     * Never in your ads: the red lines agreed at the start, said once
     * (score round 3: the same three lines a third time).
     */
    redFrom: {
      one: {
        en: "Your red line, from the start of this call",
        ar: "خطكم الأحمر، من بداية المكالمة",
      },
      many: {
        en: "Your {n} red lines, from the start of this call",
        ar: "خطوطكم الحمراء ({n})، من بداية المكالمة",
      },
    },
    always: { en: "In your ads", ar: "لازم يكون بإعلاناتكم" },
    never: { en: "Never in your ads", ar: "ممنوع بإعلاناتكم" },
    neverShow: {
      en: "Projects and names we never show",
      ar: "مشاريع وأسماء ما تنعرض",
    },
    add: { en: "Add a line", ar: "أضيفوا سطر" },
  },

  // ------------------------------------------------------------ 12 content
  content: {
    shots: [
      { en: "You, talking to camera", ar: "أنتم تتكلمون للكاميرا" },
      { en: "Your site or workshop", ar: "موقع العمل أو ورشتكم" },
      {
        en: "A finished project, walked through",
        ar: "جولة بمشروع خلصتوه",
      },
      { en: "Before and after", ar: "قبل وبعد" },
    ],
    due: { en: "By {day}", ar: "لين {day}" },
    dueHint: {
      en: "Four shots from you, in your Drive folder. A phone is fine.",
      ar: "أربع لقطات منكم، بمجلد الدرايف. والجوال يكفي.",
    },
    dueLater: {
      en: "We agree the day before we hang up.",
      ar: "نتفق على اليوم قبل لا نسكر.",
    },
    folder: { en: "Open your Drive folder", ar: "افتحوا مجلد الدرايف" },
    phone: { en: "Shot on a phone is fine.", ar: "التصوير بالجوال يكفي." },
    cameraHead: {
      en: "Will you be on camera?",
      ar: "بتطلعون بالفيديو؟",
    },
    camera: {
      yes_studio: {
        en: "Yes, with a camera crew or a studio",
        ar: "نعم، مع مصور أو في استوديو",
      },
      yes_phone: { en: "Yes, on our phone", ar: "نعم، بالجوال" },
      no: { en: "No", ar: "لا" },
      unsure: { en: "Not sure yet", ar: "مو متأكدين للحين" },
    },
  },

  // ------------------------------------------------------------ 13 read-back
  readBack: {
    table: {
      who: { en: "Who it's for", ar: "لمين" },
      what: { en: "What they get", ar: "اللي يحصلون عليه" },
      first: { en: "The first step, free", ar: "الخطوة الأولى، مجاناً" },
    },
    name: { en: "Your offer's name", ar: "اسم عرضكم" },
    /** The headline's placeholder, small, until a word is typed (score round 2). */
    namePlaceholder: {
      en: "The offer's name, typed together",
      ar: "اسم العرض، نكتبه مع بعض",
    },
    /** Two short ruled lines under the frames: the money, then the ads. */
    money: {
      en: "Projects from {minimum}. Your ads point near {anchor}.",
      ar: "مشاريعكم من {minimum}، وإعلاناتكم تركز على حدود {anchor}.",
    },
    moneyMin: {
      en: "Projects from {minimum}.",
      ar: "مشاريعكم من {minimum}.",
    },
    shots: {
      en: "You send us four shots by {day}.",
      ar: "ترسلون لنا أربع لقطات لين {day}.",
    },
    shotsSoon: {
      en: "You send us four shots within 72 hours.",
      ar: "ترسلون لنا أربع لقطات خلال ٧٢ ساعة.",
    },
    starter: {
      en: "Starter ads: live once your account is ready.",
      ar: "إعلانات البداية: تنطلق أول ما يجهز حسابكم.",
    },
    own: {
      en: "Your own ads: at your launch call.",
      ar: "إعلاناتكم الخاصة: بمكالمة الإطلاق.",
    },
    wordsEmpty: {
      en: "Your method, in one line",
      ar: "طريقتكم، بسطر واحد",
    },
    /** Their method still blank at the read-back: where it is written. */
    wordsSoon: {
      en: "Your method, in one line: we write it with you.",
      ar: "طريقتكم، بسطر واحد: نكتبها معكم.",
    },
    /** The offer still blank at the read-back: where it is finished (score round 3). */
    finish: {
      en: "We finish this in your offer sheet.",
      ar: "نكمله معكم بملف العرض.",
    },
  },

  // ------------------------------------------------------------ 14 next
  next: {
    today: { en: "Today", ar: "اليوم" },
    cards: {
      sent: {
        en: "Part 1 sent. Your starter ads are with our media team.",
        ar: "انرسل الجزء الأول، وإعلانات البداية عند فريق الإعلانات.",
      },
      sentNoStarter: {
        en: "Part 1 sent. Our media team sets up your account.",
        ar: "انرسل الجزء الأول، وفريق الإعلانات يجهز حسابكم.",
      },
      /** Part 1 not sent yet: never said as sent (it goes before we hang up). */
      unsent: {
        en: "Part 1: we send it before we hang up.",
        ar: "الجزء الأول: نرسله قبل لا نسكر.",
      },
      offer: {
        en: "Your offer, locked with you in your offer sheet.",
        ar: "عرضكم، نثبته معكم بملف العرض.",
      },
      shots: {
        en: "Your four shots, in your Drive folder.",
        ar: "أربع لقطات منكم، بمجلد الدرايف.",
      },
      live: {
        en: "Starter ads go live, once your account is ready.",
        ar: "إعلانات البداية تنطلق أول ما يجهز حسابكم.",
      },
      launch: {
        en: "Launch call: your own ads, your form and our questions.",
        ar: "مكالمة الإطلاق: إعلاناتكم الخاصة، ونموذج إعلانكم، وأسئلتنا.",
      },
      /**
       * Not booked yet: the card is headed "Launch call", so its line says
       * what the call is for, once (score round 2 of the design pass: "To
       * book" over the card said what the booking card under it says).
       */
      launchOpen: {
        en: "Your own ads, your form and our questions.",
        ar: "إعلاناتكم الخاصة، ونموذج إعلانكم، وأسئلتنا.",
      },
    },
    when: {
      ready: { en: "Once ready", ar: "أول ما يجهز" },
      tbd: { en: "To book", ar: "نحجزها" },
      launch: { en: "Launch call", ar: "مكالمة الإطلاق" },
      hours: { en: "72 hours from now", ar: "خلال ٧٢ ساعة" },
    },
    callHead: { en: "Your launch call", ar: "مكالمة الإطلاق" },
    book: { en: "We book it together now", ar: "نحجزها مع بعض الحين" },
    booked: { en: "Booked: {when}", ar: "محجوزة: {when}" },
    bookLine: {
      en: "We'll book it together before we hang up.",
      ar: "بنحجزها مع بعض قبل لا نسكر.",
    },
  },
} as const;

/** The 14 slides' titles (SPEC 5.2). */
export const BP_TITLES = {
  cover: { en: "Brand Blueprint call", ar: "مكالمة بناء الهوية والعرض" },
  "so-far": { en: "What you've told us", ar: "اللي قلتوه لنا" },
  today: { en: "The next 45 minutes", ar: "٤٥ دقيقة، خطوة بخطوة" },
  "one-service": { en: "One service. One offer.", ar: "خدمة وحدة. عرض واحد." },
  "first-ads": {
    en: "Your first ads, while we make yours",
    ar: "إعلانات البداية، لين نجهز إعلاناتكم الخاصة",
  },
  "best-at": {
    en: "What you're actually best at",
    ar: "اللي تتميزون فيه فعلاً",
  },
  pricing: { en: "Your projects, in numbers", ar: "مشاريعكم بالأرقام" },
  competitors: { en: "Who you're up against", ar: "مين تنافسون بالسوق" },
  offer: { en: "Let's build your offer", ar: "خلونا نبني عرضكم" },
  "how-ads-work": {
    en: "How paid ads work",
    ar: "كيف تشتغل الإعلانات المدفوعة",
  },
  brand: { en: "Your brand, on one page", ar: "هويتكم بصفحة وحدة" },
  content: {
    en: "What we need in 72 hours",
    ar: "اللي نحتاجه منكم خلال ٧٢ ساعة",
  },
  "read-back": { en: "Here's what we're building", ar: "هذا اللي بنبنيه لكم" },
  next: { en: "What happens next", ar: "الخطوات الجاية" },
} as const satisfies Record<string, L>;

export type BpSlideId = keyof typeof BP_TITLES;

/** Each slide's start and length in minutes (SPEC 5.2): they add up to 45. */
export const BP_MINUTES: Record<BpSlideId, [number, number]> = {
  cover: [0, 1],
  "so-far": [1, 1],
  today: [2, 1],
  "one-service": [3, 3],
  "first-ads": [6, 4],
  "best-at": [10, 6],
  pricing: [16, 5],
  competitors: [21, 3],
  offer: [24, 9],
  "how-ads-work": [33, 3],
  brand: [36, 2],
  content: [38, 2],
  "read-back": [40, 2],
  next: [42, 3],
};

/** Stop names, for the notes window and the live region. */
export const BP_STOPS = {
  "one-service": [
    { en: "The five", ar: "الخدمات الخمس" },
    { en: "The others parked", ar: "الباقي ينطر دوره" },
  ],
  "first-ads": [
    { en: "The pack", ar: "ملف إعلانات البداية" },
    { en: "Part 1, filled in", ar: "الجزء الأول" },
  ],
  "best-at": [
    { en: "Your method", ar: "طريقتكم" },
    { en: "Who you want", ar: "العملاء اللي تبونهم" },
    { en: "What others can't do", ar: "اللي غيركم ما يقدر عليه" },
  ],
  pricing: [
    { en: "The tape", ar: "الأرقام" },
    { en: "Payment terms", ar: "طريقة الدفع" },
  ],
  competitors: [
    { en: "The names", ar: "الأسماء" },
    { en: "Why you", ar: "ليش أنتم" },
  ],
  offer: [
    { en: "The draft", ar: "المسودة" },
    { en: "The offer sheet", ar: "ملف العرض" },
  ],
  "how-ads-work": [
    { en: "Trust", ar: "الثقة" },
    { en: "The first weeks", ar: "أول الأسابيع" },
    { en: "How you approve", ar: "كيف توافقون" },
  ],
  content: [
    { en: "Four shots", ar: "أربع لقطات" },
    { en: "On camera", ar: "بالفيديو" },
  ],
  next: [
    { en: "After today", ar: "بعد اليوم" },
    { en: "The launch call", ar: "مكالمة الإطلاق" },
  ],
} as const satisfies Partial<Record<BpSlideId, readonly L[]>>;

/**
 * What the creative director says, slide by slide, and the lines to say
 * when the call is in Arabic. The notes window only; never the canvas.
 */
export const BP_NOTES: Record<BpSlideId, SlideNotes> = {
  cover: {
    say: [
      "Join the call early. Introduce yourself as the creative director; the CSM is not on this call, by design.",
      'Frame it: "45 minutes. By the end, your brand is on one wall: your words, your look, and your offer."',
      "Prep check: part 1 confirmed in prep? The offer sheet open in its own window, with your draft in it?",
      "Ask them to keep their price list near them. You will ask for real numbers on slide 7.",
    ],
    sayAr: [
      "هلا والله. أنا المدير الإبداعي، واليوم المكالمة معاي أنا.",
      "عندنا ٤٥ دقيقة، وبآخرها بيكون كل شي على جدار واحد: كلامكم، وهويتكم، وعرضكم.",
      "خلوا قائمة الأسعار قريبة منكم، لأننا بنسألكم عن أرقام حقيقية.",
    ],
  },
  "so-far": {
    say: [
      "Read it back. Fix anything wrong on the slide now; it saves as you type.",
      "Correct the clients they want more of on the card itself, in their words.",
      "Add any red line they give you on the card. Each line saves as you press Enter.",
      "In your notes: confirm the service, the starter answer and the daily figure. Those stay off the screen.",
    ],
    sayAr: [
      "خلونا نمر بسرعة على اللي قلتوه لنا. إذا فيه شي غلط، قولوه الحين وأعدله جدامكم.",
      "هذولا العملاء اللي تبون منهم أكثر، صح؟",
      "وفيه شي ما تبونه يطلع بأي إعلان؟",
    ],
  },
  today: {
    say: [
      "Three minutes at most, then straight into their business.",
      "Point at the brackets: part 1 goes to the media team by minute 10, so their first ads are not waiting on the rest.",
      "Say the three rules plainly. The money rule matters on slide 7.",
    ],
    sayAr: [
      "هذا جدول المكالمة بالدقيقة. أول عشر دقايق نخلص إعلانات البداية، عشان ما تنطر باقي المكالمة.",
      "وثلاث قواعد: إذا شفنا شي ما يبيع بنقولكم، والأرقام نبيها دقيقة، وعادي تقولون ما نعرف.",
    ],
  },
  "one-service": {
    say: [
      "One service. Margin wins over capacity; a capacity risk goes to the CSM in writing, never into this conversation.",
      "Stop 1: tap the strip on the slide to set the service. Undo in your notes for 10 seconds.",
      "Two services on the kickoff: both strips glow amber. Ask which goes first; the other is parked.",
      "Stop 2: the other strips go to the parked tag, with the other services they offer.",
      "Capacity goes in your notes: yes, tight or no, with one line when it is tight.",
    ],
    sayAr: [
      "نبدي بخدمة وحدة. وحدة بس، عشان الإعلان يكون واضح والرسالة وحدة.",
      "الخدمات الثانية ما راحت، بس تنطر دورها.",
      "أي وحدة تربحكم أكثر، وتقدرون تاخذون منها مشاريع أكثر الحين؟",
    ],
  },
  "first-ads": {
    say: [
      "Stop 1: three example ads for their service, pinned as prints. Open the real pack from your notes, in its own window, and share it.",
      "Get their yes on the slide: one tap on the approval.",
      "Stop 2: the part 1 sheet. Confirm the daily figure, where the ad sends people and whose Page it runs from, in your notes.",
      "Press Send to media before you leave this slide. The stamp lands on the sheet when the press is saved.",
    ],
    sayAr: [
      "هذي إعلانات البداية، من قوالبنا. تشتغل لين نجهز إعلاناتكم الخاصة من صوركم وكلامكم.",
      "عاجبتكم؟ نعتمدها ونرسلها لفريق الإعلانات الحين؟",
      "تمام، الجزء الأول راح لفريق الإعلانات.",
    ],
  },
  "best-at": {
    say: [
      "A method, not an adjective. Type their words, not yours.",
      "Stop 1: the struck line is their own earlier line when the record has one, else an example of what everyone says. Ask how a project actually runs with them, from the first call to the handover. The clients they want more of sit beside it, from the onboarding form.",
      "If they stall on the method, offer the example: a fixed price before we start, one person in charge, and a weekly update until handover. The slide shows only their own words.",
      "Stop 2: who they don't want.",
      "Stop 3: what most firms in their city can't do. If they say quality, ask for the proof.",
    ],
    sayAr: [
      "هالجملة الكل يقولها. أبي أسمع منكم: كيف يمشي المشروع معاكم من أول مكالمة لين التسليم؟",
      "مثلاً: سعر ثابت قبل لا نبدي، وشخص واحد مسؤول، وتحديث أسبوعي لين التسليم.",
      "مين العملاء اللي تبون منهم أكثر؟ ومين اللي ما تبونهم؟",
      "شنو الشي اللي أغلب الشركات بمدينتكم ما تقدر تسويه؟",
    ],
  },
  pricing: {
    say: [
      "Specific numbers for the smallest project and where the ads point; a range only for where most projects land.",
      "Type the amounts in the two cards. The tape places each mark by its value, and the range typed under where most projects land shades the tape. The currency follows their country; change it in your notes.",
      "Stop 2: how they are paid. Then read the example line our callers use, and ask if it fits.",
      "Ask for a photo of a real quotation in their Drive folder.",
      "The margin goes in your notes only.",
    ],
    sayAr: [
      "خلونا نتكلم أرقام. شكثر أصغر مشروع تقبلونه؟",
      "وأغلب مشاريعكم بحدود شكثر؟",
      "وإعلاناتكم، تبونها تركز على مشاريع بأي حجم؟",
      "ولو تقدرون ترفعون صورة عرض سعر حقيقي بمجلد الدرايف، يساعدنا وايد.",
    ],
  },
  competitors: {
    say: [
      "Type each name as they say it; mark the ones they actually lose to.",
      "Who do they actually lose to, and why?",
      "The market research list is in your notes: offer a name only if they stall. Research is never their answer.",
      "Stop 2: why people pick them instead, in their words.",
    ],
    sayAr: [
      "مين تنافسون؟ ومين اللي فعلاً تخسرون جدامه؟",
      "وليش؟ شنو عندهم ما عندكم؟",
      "وليش الناس يختارونكم بدالهم؟",
    ],
  },
  offer: {
    say: [
      "Share the offer sheet window; start from your pre-written draft, so they correct it instead of facing a blank page.",
      "Walk the five lines on the tag: the pattern, its name, two or three bonuses, the price the ads point to, the free first step and who gives it. A line fills from the record (the name, the price, the first step) as it is typed; the rest live in the offer sheet.",
      "Type the draft's name, what they get and the first step in your notes; they read it back on slide 13.",
      "Stop 2: share the sheet's own window. Say it locks in 1 to 2 days, with them, in the offer sheet.",
    ],
    sayAr: [
      "الحين نبني عرضكم. كتبت لكم مسودة، وأبيكم تعدلونها معاي.",
      "شنو اسمه؟ وشنو ياخذ العميل؟ وشنو الخطوة الأولى المجانية، ومين يقدمها؟",
      "ونثبته معاكم خلال يوم أو يومين بملف العرض.",
    ],
  },
  "how-ads-work": {
    say: [
      "Hold the frame: volume beats luck. No promise of results.",
      "Stop 1: two roads to the same client. A referral trusts them already; someone from an ad meets them for the first time.",
      "Stop 2: the ads learn for 30 to 60 days. Leave them running.",
      "Stop 3: let them choose how they approve their custom ads. Tap their pick.",
    ],
    sayAr: [
      "نفس الشخص، بس مرة جاكم بتوصية، ومرة شاف إعلانكم. الفرق الوحيد الثقة.",
      "الإعلانات تتعلم من ٣٠ لين ٦٠ يوم. الكمية هي اللي تفرق، مو الحظ.",
      "كيف تبون توافقون على إعلاناتكم الخاصة؟",
    ],
  },
  brand: {
    say: [
      "If a Brand DNA section is blank, open their doc in its own window and say what is missing.",
      "The board: their logo and up to four colours read from their Brand DNA doc. With no colours on record, the card says you open the doc together.",
      "Beside it, three short lists: what must be in their ads, what must never be (their red lines from the onboarding call start it), and the projects and names never shown.",
      "Mark the Brand DNA doc's status in your notes.",
    ],
    sayAr: [
      "هذي هويتكم: الشعار والألوان من ملف هويتكم.",
      "شنو لازم يكون بإعلاناتكم؟ وشنو ممنوع؟",
      "وفيه مشاريع أو أسماء ما تبونها تنعرض؟",
    ],
  },
  content: {
    say: [
      "Four shots in 72 hours. If the 72 hours slip, the starter ads keep running and we swap theirs in.",
      "Tick the shot list in your notes: the due date lands on the sticky.",
      "Open their Drive folder in its own window; the link never shows on the slide.",
      "Stop 2: will they be on camera, and how? Tap their answer.",
    ],
    sayAr: [
      "نحتاج منكم أربع لقطات بس، خلال ٧٢ ساعة. والجوال يكفي.",
      "وإذا تأخرتوا، إعلانات البداية تكمل لين توصلنا لقطاتكم.",
      "بتطلعون بالفيديو؟ مع مصور ولا بالجوال؟",
    ],
  },
  "read-back": {
    say: [
      "Read it out loud, then wait for a yes. Tick it in your notes.",
      "Type the offer's name, what they get and the first step on the slide as you agree them.",
      "If they hesitate on a line, fix it now, on the wall.",
    ],
    sayAr: [
      "خلوني أقرا لكم كل شي مرة وحدة.",
      "هذا عرضكم، وهذي طريقتكم، وهذي هويتكم.",
      "تمام؟ نعتمده؟",
    ],
  },
  next: {
    say: [
      "Book the launch call now, in its own window. Check the booking in your notes.",
      "Stop 1: the string. Amber cards are theirs: the four shots. The first card says part 1 is sent only once Send to media went.",
      "Then press Close the call in your notes.",
      "Anything for the CSM (capacity, a second service, more ads) goes in your notes, never into this conversation.",
    ],
    sayAr: [
      "هذا اللي بيصير بعد اليوم. البطاقات الصفرا عليكم.",
      "خلونا نحجز مكالمة الإطلاق الحين.",
      "شكراً على وقتكم. نشوفكم بمكالمة الإطلاق.",
    ],
  },
};
