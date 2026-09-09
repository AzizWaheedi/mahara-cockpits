/**
 * The hot list — client success as sales.
 *
 * Columns mirror the company's CSM Hot List sheet
 * (1V5AoU2aZijimUrS8cWfRifwmmRbVP5DPmyqfl8_gDSw, tab HOT LIST):
 *   Name · Lead Type · Status · Type · Contact URL · Last Objection · Amount ·
 *   Last FU · Next FU · Notes
 * so a row here reads the same as a row there, and the sheet can be retired rather
 * than kept in parallel.
 *
 * Every opportunity carries an opening ask and an objection-handling line, in English
 * and Arabic, drawn from the Client Communication SOP. Pitch wording is ours; the
 * commercial terms are his: referral pays $1,000 per closed construction or design firm.
 */

import { type Client, type Lang, LINKS, humaniseDeep } from "./csmTemplates";

export type Opportunity = {
  /** Stable per client + kind, so her edits and follow-up dates stick. */
  key: string;
  client: Client;
  name: string;
  /**
   * Hot List "Type" column. Must be one of the values his sheet's dropdown allows:
   * Upsell - SMM / Service / SEO + GEO / Closer Placement / UGC Package / Website /
   * BE Program, Referral, Review. Anything more specific belongs in `why`.
   */
  type: string;
  /** Hot List "Lead Type" column: how warm this is. */
  leadType: "Hot" | "Warm" | "On Hold";
  /** Why they qualify — evidence, not a hunch. */
  why: string;
  /** Indicative value, in USD. Blank when we genuinely don't know. */
  amount?: string;
  /** The ask, ready to send. */
  pitch: (lang: Lang) => string;
  /** The objection she'll actually hit, and the answer. */
  objection: { likely: string; answer: (lang: Lang) => string };
};

const first = (name: string) => (name ?? "").split(/[\s—–-]/)[0] || name || "";

/** Stopped, paused, cancelled and ghosted clients get win-back only, never an upsell. */
function active(c: Client): boolean {
  return !/pause|stop|cancel|ghost/i.test(String(c.stage));
}

/** Their own happiness rating in ClickUp — the only honest signal for an ask. */
function happyClient(c: Client): boolean {
  return /very happy|happy/i.test(String(c.happiness ?? ""));
}

/**
 * Ask for the review and the referral only when the relationship has earned it: active,
 * live over a month, happy on the record, and no money problem open. Asking a struggling
 * client for a referral is how you lose both.
 */
function earned(c: Client): boolean {
  return (
    active(c) &&
    !c.pauseRequired &&
    (c.liveDays ?? 0) > 30 &&
    c.level !== "red" &&
    happyClient(c)
  );
}

export function opportunitiesFor(c: Client): Opportunity[] {
  return humaniseDeep(opportunitiesRaw(c));
}

function opportunitiesRaw(c: Client): Opportunity[] {
  const out: Opportunity[] = [];
  const n = first(c.name);
  const happy = happyClient(c);

  if (earned(c)) {
    out.push({
      key: `${c.taskId}:review`,
      client: c,
      name: c.name,
      type: "Review",
      leadType: "Hot",
      why: `Green for ${c.liveDays} days live, happiness ${c.happiness ?? "good"}, ask now while it's true`,
      pitch: lang =>
        lang === "ar"
          ? `السلام عليكم ${n}، عساكم بخير.\n\nحبيت أتواصل معك بسرعة، الأمور ماشية زين وإحنا على الطريق الصح. تقدر تكتب لنا تقييم سريع على قوقل؟ شي بسيط عن تجربتك مع الدعم والتواصل والنتائج.\n\nوعشان تكون بالمثل، يسعدني أسوي نفس الشي لك إذا عندك مكان التقييمات تفيدك فيه.\n\nمافي أي ضغط، بس مثل ما تعرف السمعة كل شي لشركات مثلنا. إذا تمام عندك، هذا اللينك: ${LINKS.review}`
          : `Hey ${n}, hope you're doing well.\n\nI wanted to reach out quickly since things are running smoothly and we're on the right track. Would you be open to leaving us a quick review on Google? Just something based on your experience with the support, the communication and the results.\n\nAnd to make it fair, I'd happily do the same for you if you have somewhere reviews help.\n\nNo pressure at all, but as you know reputation is everything for businesses like ours. If you're good with it, here's the link: ${LINKS.review}`,
      objection: {
        likely: "\u201cSure, send it later\u201d, then it never happens",
        answer: lang =>
          lang === "ar"
            ? `تمام، أرسل لك اللينك الحين عشان ما ينسى: ${LINKS.review}, ثلاث أسطر تكفي، وأنا أسوي لك نفس الشي.`
            : `Perfect, sending the link now so it doesn't get lost: ${LINKS.review}, three lines is plenty, and I'll do the same for you.`,
      },
    });
    out.push({
      key: `${c.taskId}:podcast`,
      client: c,
      name: c.name,
      type: "Upsell - Service", // podcast guest, the detail is in why
      leadType: "Warm",
      why: "Already happy and reviewing, the bigger ask lands best right after the small one",
      pitch: lang =>
        lang === "ar"
          ? `أدري إن هذا طلب أكبر، بس إحنا نطور جانب البودكاست عندنا، ونتكلم فيه عن النمو مع أصحاب شركات مقاولات وتصميم. ممكن تكون فرصة زينة إن اسمك يوصل لناس أكثر. تقدر تعطينا من ١٠ إلى ٢٠ دقيقة مكالمة مع عزيز؟`
          : `I know this is a bigger ask, but we're building out the podcast side of our business where we talk growth with other construction and design owners. Could be a good way to get your name out there too. Would you be open to a 10 to 20 minute call for it with our founder?`,
      objection: {
        likely: "\u201cI'm not good on camera\u201d",
        answer: lang =>
          lang === "ar"
            ? `ما فيه كاميرا لازمة, صوت بس إذا تفضل، و١٥ دقيقة بالكثير. والأسئلة توصلك قبل.`
            : `No camera needed, audio only if you prefer, and 15 minutes max. You'll get the questions beforehand.`,
      },
    });
  }

  if (earned(c)) {
    out.push({
      key: `${c.taskId}:referral`,
      client: c,
      name: c.name,
      type: "Referral",
      leadType: "Hot",
      why: `Live ${c.liveDays} days, green, no money open, the referral ask is owed`,
      amount: "$1,000 to them per closed firm",
      pitch: lang =>
        lang === "ar"
          ? `السلام عليكم ${n}، حبيت أذكرك إن عندنا برنامج إحالة. تاخذ ١٠٠٠ دولار عن كل شركة مقاولات أو تصميم ترشحها لنا وتشتغل معانا.\n\nفيه أحد يجي ببالك نقدر نتواصل معاه؟\n\nتفاصيل البرنامج: ${LINKS.referralDoc}`
          : `Hey ${n}, just wanted to remind you we have a referral programme. You get paid $1,000 for every construction or design business you send us that ends up working with us.\n\nAnyone come to mind we could connect with?\n\nHere's how it works: ${LINKS.referralDoc}`,
      objection: {
        likely: "\u201cI don't want to refer a competitor\u201d",
        answer: lang =>
          lang === "ar"
            ? `ما نبي أحد ينافسك بنفس السوق, نبي شركات بمدينة ثانية أو بخدمة مختلفة. وإذا حبيت، نتفق إننا ما نشتغل مع أحد يشتغل بنفس منطقتك.`
            : `We don't want anyone competing with you in your own market, different city or a different service line. If it helps, we'll agree not to take on anyone working your patch.`,
      },
    });
  }

  if (
    active(c) &&
    (c.liveDays ?? 0) > 45 &&
    c.level !== "red" &&
    !c.pauseRequired
  ) {
    out.push({
      key: `${c.taskId}:second_service`,
      client: c,
      name: c.name,
      type: "Upsell - Service",
      leadType: happy ? "Hot" : "Warm",
      why: `Live ${c.liveDays} days with one service running, a second front-end offer is the cheapest growth available to them`,
      amount: "Budget increase, no new retainer",
      pitch: lang =>
        lang === "ar"
          ? `السلام عليكم ${n}، عساكم بخير. أنا والفريق دخلنا على موقعكم وراجعنا اللي شغال عندنا الحين وكيف يتناسب مع اللي تقدرون تنفذونه فعلاً.\n\nأهم شي ندور عليه لما نبني عرض الواجهة، يعني أول لقاء:\n• تكلفة تنفيذ منخفضة، عشان نخلي نقطة الدخول واطية وتجيب حجم\n• إمكانية ترقية عالية، عشان أول شغلة تفتح الباب للشغلة الأكبر\n• بداية سريعة، ويفضل زيارة موقع أو استشارة خلال أيام\n• يدخل ضمن إحدى الزوايا المجربة عندنا\n\nوشي مهم: إحنا نبيع النتيجة مو الطريقة.\n\nتقدر تمر معاي على أسعارك بالخدمة الثانية عشان أشوف إذا تنفع نشغلها؟`
          : `Hey ${n}, hope you're well. The team and I went through your website and audited what's working best for us right now and how that fits what you can actually deliver.\n\nWhen we build a "first date" front-end offer we look for:\n• Low cost to deliver, so the entry point sits low enough to get volume\n• High upsell potential, so the first job leads naturally into the bigger one\n• Fast to start, ideally a site visit within days, because the longer the gap the more they cool off\n• Fits one of our proven angles\n\nOne thing up front: we sell the outcome, not the process.\n\nCan you run me through your price points on the second service so I can see if it works?`,
      objection: {
        likely: "\u201cLet's get the first one working properly first\u201d",
        answer: lang =>
          lang === "ar"
            ? `متفق، ما نلمس اللي شغال. الخدمة الثانية تنزل بميزانية صغيرة منفصلة عشان نجمع بيانات فقط, إذا ما أدت، نوقفها وما خسرنا شي من الأولى.`
            : `Agreed, we don't touch what's working. The second service runs on a small separate budget purely to gather data. If it doesn't perform we switch it off and the first campaign never felt it.`,
      },
    });
  }

  if (active(c) && (c.liveDays ?? 0) > 60 && c.level !== "red" && happy) {
    out.push({
      key: `${c.taskId}:budget`,
      client: c,
      name: c.name,
      type: "Upsell - Service", // raise budget
      leadType: "Warm",
      why: `${c.liveDays} days live and green, if cost per booked job holds, more budget is just more jobs`,
      amount: "Budget increase",
      pitch: lang =>
        lang === "ar"
          ? `السلام عليكم ${n}، الحملة مستقرة وتكلفة الموعد المحجوز عندنا بمستوى زين. بهالحالة، الميزانية الحالية هي اللي تحدد عدد المشاريع مو الأداء.\n\nقبل ما أقترح أي رقم: كم موعد بالأسبوع تقدر فريقك يستقبله بدون ما تنزل جودة المتابعة؟ أبني الزيادة على هالرقم مو على العكس.`
          : `Hey ${n}, the campaign is stable and cost per booked job is holding. At that point the budget is what's capping the number of projects, not the performance.\n\nBefore I suggest a number: how many appointments a week can your team handle without the follow-up quality dropping? I'll size the increase off that, not the other way round.`,
      objection: {
        likely: "\u201cCan we hold the budget where it is?\u201d",
        answer: lang =>
          lang === "ar"
            ? `أكيد. خلنا نجربها بزيادة صغيرة لأسبوعين ونشوف تكلفة الموعد ثابتة ولا لا, إذا ارتفعت، نرجع للرقم القديم بنفس اليوم.`
            : `Of course. Let's test a small increase for two weeks and watch cost per booked job, if it rises we go straight back to the old number the same day.`,
      },
    });
  }

  if (/pause|stop/i.test(String(c.stage))) {
    out.push({
      key: `${c.taskId}:relaunch`,
      client: c,
      name: c.name,
      type: "Upsell - Service", // win back relaunch
      leadType: "On Hold",
      why: `${c.stage}${c.extendedUntil ? ` (cover until ${c.extendedUntil})` : ""}, a paused client is the cheapest client to win back`,
      pitch: lang =>
        lang === "ar"
          ? `السلام عليكم ${n}، حسابك متوقف حالياً وما فيه أي صرف.\n\nكل اللي بنيناه لا زال موجود، فالرجعة تكون بنفس اليوم مو من الصفر. شنو اللي لازم يصير عشان ترجع تشغلها؟ إذا السبب الفلوس، خبرني وأشوف لك خيار يمشي.`
          : `Hey ${n}, your account is paused at the moment and nothing is being spent.\n\nEverything we built is still in place, so restarting is same-day, not from scratch. What would need to be true for you to switch it back on? If it's the cost, tell me and I'll find an option that works.`,
      objection: {
        likely: "\u201cIt didn't work last time\u201d",
        answer: lang =>
          lang === "ar"
            ? `عندك حق نسأل شنو بيكون مختلف. أرسل لك بنقطتين شنو بنغيره بالزاوية والاستهداف قبل ما نشغل أي دينار، وإذا ما اقتنعت ما نشغل.`
            : `Fair, you should ask what's different. I'll send you two specifics we'd change in the angle and the targeting before a dollar is spent, and if you're not convinced we don't switch it on.`,
      },
    });
  }

  return out;
}

/** Rank so the CSM works the list top-down: hot first, then oldest silence. */
export function rankOpportunities(list: Opportunity[]): Opportunity[] {
  const order = { Hot: 0, Warm: 1, "On Hold": 2 } as const;
  return [...list].sort(
    (a, b) =>
      order[a.leadType] - order[b.leadType] ||
      (b.client.silentDays ?? 0) - (a.client.silentDays ?? 0),
  );
}
