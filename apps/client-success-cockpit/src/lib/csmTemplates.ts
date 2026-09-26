/**
 * The CSM's message library — English and Arabic for every stage.
 *
 * The wording is lifted from the company's Client Communication SOP
 * (doc 10wQorQfSebiX3Lmh0jXkEUkp3I_xMP68p4b1q-oUxcY), not invented here, so what the
 * client receives is what the SOP already approved. Placeholders (NAME, DATE, AMOUNT)
 * are filled from live ClickUp data where we have it.
 *
 * Two separate clocks, on his instruction (2026-09-03), matching the SOP's target metrics:
 *   - MESSAGES run on `lastPoc`: every working day while onboarding and through launch
 *     week, every 2 days while ramping (day 8–30), then 3× a week once fully ramped.
 *   - CHECK-IN CALLS run on `lastCall`: weekly through the first month live, then every 2 weeks.
 * A client can be current on calls and still owe a message, so the two never collapse
 * into one "last touched" number.
 */

import { shortDay } from "./format";

// biome-ignore lint/suspicious/noExplicitAny: snapshot rows are untyped by design
export type Client = any;

/** Paused clients get exactly three nudges, then they are churn. Company rule, 2026-09-03. */
export const PAUSE_NUDGE_DAYS = [3, 7, 14];
export const PAUSE_IS_CHURN_DAYS = 14;

/** "Stopped" in ClickUp means already churned — no touchpoints, no drafts, no noise. */
export function isChurned(c: Client): boolean {
  return /stop|cancel|churn|offboard/i.test(String(c.stage ?? ""));
}

export const LINKS = {
  onboardingCall:
    "https://api.leadconnectorhq.com/widget/booking/z1Ne59rohCCj87KhcXoi",
  checkInCall:
    "https://api.leadconnectorhq.com/widget/booking/SHjlq0UjeR11maltYNyh",
  callSummaryForm: "https://maharamedia.typeform.com/to/fRokTITH",
  kickoffForm: "https://maharamedia.typeform.com/to/BbJy6xg4",
  calculator: "http://calculator.maharamedia.com",
  review: "https://g.page/r/CeRMcUwFPpe7EAI/review",
  referralDoc:
    "https://docs.google.com/document/d/15gPXbB98N9TtNqbTa0Ro7O2odcio8XuW0rL-S_qfHcs/edit",
  content: "https://content.maharamedia.com/",
  ticketingForm:
    "https://forms.clickup.com/90182518398/f/2kzmr1ky-1178/R1O1N5QXYLUTJOWQ3E",
  // Run this on any save call: money, results, or the team? Then reset expectations.
  resetCall:
    "https://www.skool.com/maharamedia-8165/classroom/68fc87a8?md=181f7ebf64164828bd0faec51925059c",
  brandBlueprintCall:
    "https://api.leadconnectorhq.com/widget/booking/x84ET6KnA8odlsjYiVLq",
  launchCall:
    "https://api.leadconnectorhq.com/widget/booking/5E1EVxLJbGiDM3iYl2kL",
  onboardingFramework:
    "https://docs.google.com/document/d/1JN4oTUozLTl_kA8SScgsYZulIXSrDcU-4z1h_2xfOGo/edit",
  launchFramework:
    "https://docs.google.com/document/d/1kTq3cEnjh4-gR7ESmVa-OeAxaETvT3pelVLNG_W7LYs/edit",
};

export type Lang = "en" | "ar";

import { SPINE, spineFor, spineMessage } from "./csmOnboardingSpine";

/** How often this client is owed a message, and how often a call. */
export function cadence(c: Client): {
  stage: string;
  everyDays: number;
  label: string;
  callEvery: number;
  callLabel: string;
  messageOverdue: boolean;
  callOverdue: boolean;
  daysLate: number;
} {
  const live = c.liveDays;
  let stage = "Fully ramped";
  let everyDays = 3; // 3 messages a week, the SOP floor
  if (c.bucket === "onboarding" || live == null) {
    stage = "Onboarding";
    everyDays = 1;
  } else if (live <= 7) {
    stage = "Launch week";
    everyDays = 1;
  } else if (live <= 30) {
    stage = "Ramping";
    everyDays = 2;
  }
  const silent = c.silentDays ?? 99;
  const called = c.callDays ?? 99;
  // The company rule: a check-in call every week through the first month, then every 2 weeks.
  const CALL_EVERY = live == null || live <= 30 ? 7 : 14;
  return {
    stage,
    everyDays,
    label:
      everyDays === 1
        ? "every working day"
        : everyDays === 2
          ? "every 2 days"
          : "3× a week",
    callEvery: CALL_EVERY,
    callLabel: CALL_EVERY === 7 ? "weekly" : "every 2 weeks",
    messageOverdue: silent >= everyDays,
    callOverdue: called >= CALL_EVERY,
    daysLate: Math.max(0, silent - everyDays),
  };
}

type Template = {
  id: string;
  /** Shown as the tab label when she picks a different angle. */
  title: string;
  /** Why this client is being messaged today. */
  why: (c: Client) => string;
  /** Short phrase written into the ClickUp log. */
  short: string;
  en: (c: Client) => string;
  ar: (c: Client) => string;
  /** True when this template applies to this client right now. */
  when: (c: Client) => boolean;
};

const first = (name: string) => (name ?? "").split(/[\s—–-]/)[0] || name || "";

/** Ordered most urgent first — money and silence outrank routine updates. */
const TEMPLATES: Template[] = [
  {
    id: "past_due",
    title: "Invoice past due",
    short: "chased the past-due invoice",
    when: c => !!c.pauseRequired,
    why: c => `Invoice ${c.paymentDue} days past due, no extension logged`,
    en: c =>
      `Hey ${first(c.name)}, quick one on the invoice, it's ${c.paymentDue} days past due, so the account is at risk of the ads being switched off. Can we get it settled today?\n\nThe sooner it's sorted the sooner we avoid a gap, because every time ads get switched off we have to rebuild momentum from scratch. If you need a few days, tell me and I'll arrange it from our side.`,
    ar: c =>
      `السلام عليكم ${first(c.name)}، بخصوص الفاتورة, صار لها ${c.paymentDue} يوم مستحقة، والحساب معرّض إن الإعلانات توقف. نقدر نظبطها اليوم؟\n\nكل ما ظبطناها بسرعة، تجنبنا التوقف، لأن كل ما توقف الإعلانات نرجع نبني الزخم من الصفر. وإذا تحتاج كم يوم خبرني وأرتبها من طرفنا.`,
  },
  {
    id: "pause_filed",
    title: "Pausing, tell the client",
    short: "told the client the pause is being filed",
    when: c => !!c.pauseRequired,
    why: () =>
      "A pause is being filed for them, never let them find out from the ads stopping",
    en: c =>
      `Hey ${first(c.name)}, I'd rather tell you this directly than let you notice it: while the invoice is outstanding we have to pause the campaign, so I'm filing that today.\n\nNothing gets deleted and nothing has to be rebuilt, the moment it's settled I switch it back on the same day. If the timing is the problem rather than the amount, tell me and I'll arrange it from our side instead.`,
    ar: c =>
      `السلام عليكم ${first(c.name)}، أفضل أقول لك بشكل مباشر بدال ما تلاحظها بنفسك: طالما الفاتورة غير مسددة لازم نوقف الحملة، فأنا مسجّل الطلب اليوم.\n\nما ينحذف شي وما نحتاج نبني من جديد, أول ما تتسدد أرجعها بنفس اليوم. وإذا المشكلة بالتوقيت مو بالمبلغ، خبرني وأرتبها من طرفنا.`,
  },
  {
    id: "welcome",
    title: "New signup, welcome",
    short: "ran the welcome call and sent the onboarding call link",
    when: c => c.stage === "Needs Contacting" || c.newSignup,
    why: () =>
      "New signup. Welcome call today, then the onboarding call gets booked",
    en: c =>
      `Hey ${first(c.name)}! This is the Mahara team, welcome aboard, glad to have you.\n\nI'll give you a quick welcome call today to introduce myself, then the next step is your onboarding call, 60 minutes. Please join from a computer and logged into the Facebook account you use for the business, so we can set everything up on the call itself.\n\nPick the time that suits you here: ${LINKS.onboardingCall}`,
    ar: c =>
      `هلا ${first(c.name)}! معك فريق مهارة، مبروك انضمامك ونسعد بوجودك معنا.\n\nبأتواصل معك اليوم بمكالمة ترحيب سريعة أعرفك على نفسي، وبعدها خطوتنا مكالمة الانضمام، ٦٠ دقيقة. يفضل تكون من الكمبيوتر ومسجّل دخول على حساب فيسبوك الخاص بالشركة، عشان نجهز كل شي بنفس المكالمة.\n\nاختر الوقت المناسب لك من هنا: ${LINKS.onboardingCall}`,
  },
  {
    id: "onboarding_book",
    title: "Onboarding, book the call",
    short: "chased the onboarding call booking",
    when: c => c.bucket === "onboarding" && !c.launchDate,
    why: c =>
      `In onboarding (${c.stage}), message every working day until the call is booked and the kickoff form is in`,
    en: c =>
      `Hey ${first(c.name)}, following up so we can get you launched quickly. Two things left on our side:\n\n1. Your onboarding call in the calendar: ${LINKS.onboardingCall}\n2. The kickoff form filled in: ${LINKS.kickoffForm}\n\nWant me to walk you through either one right now?`,
    ar: c =>
      `هلا ${first(c.name)}، متابعة بسيطة حتى نطلق حملتك بأسرع وقت. باقي علينا شيئين:\n\n١. موعد مكالمة الانضمام: ${LINKS.onboardingCall}\n٢. تعبئة نموذج البداية: ${LINKS.kickoffForm}\n\nتحب أساعدك بأي واحد منهم الآن؟`,
  },
  {
    id: "onboarding_access",
    title: "Onboarding, access & assets",
    short: "chased the access and assets needed to launch",
    when: c => c.bucket === "onboarding",
    why: c =>
      `In onboarding (${c.stage}), launch is waiting on access or assets, message daily`,
    en: c =>
      `Hey ${first(c.name)}, we're close to launching. What's holding it is the Facebook access and the raw material.\n\nUpload everything you take on site, finished projects, work in progress, your team, all of it. Don't filter it, we'll do that. Send whatever you have and the team builds around it today; no need to wait until it's perfect.`,
    ar: c =>
      `هلا ${first(c.name)}، قربنا على الإطلاق. اللي باقي علينا الوصول لحساب فيسبوك والمواد الخام.\n\nحمّل كل شي تصوره بالمواقع, المشاريع المخلصة، الشغل اللي تحت التنفيذ، فريقك، كل شي. لا تفلتر، إحنا نفلتر. أرسل اللي متوفر والفريق يبني عليه اليوم، ما نحتاج ننتظر حتى يكتمل كل شي.`,
  },
  {
    id: "launch_day",
    title: "Ads are live",
    short: "told them the campaign is live",
    when: c => (c.liveDays ?? 99) <= 1,
    why: () => "Live today, the launch message from the SOP",
    en: c =>
      `Hey ${first(c.name)}! Our team has finalised the buildout and your ads are going live shortly. Before they do, a few quick things.\n\n**Our check-in calls:** you and I will have a call every two weeks covering the numbers, the leads, and what's actually closing. 20 to 30 minutes on Zoom, be somewhere quiet with a laptop, not in the car.\n\n**Tracking your return:** keep the tracking sheet updated day to day. If it isn't filled in we're optimising blind, and that directly limits what we can get out of the money you're spending.\n\n**Keep sending us content:** your Drive folder is pinned at the top of the group. The clients whose ads keep performing month after month are the ones who keep the folder full.\n\n**Addressing the elephant:** at any point, if you have concerns, doubts or confusion, tell me. After working with 70+ firms, the most successful ones overcommunicate the highs and the lows.\n\n**Month one is always the slowest:** we're gathering data and finding what your market responds to. If you don't see a flood in week one, that's normal, not a problem.\n\nNow let's get you some projects.`,
    ar: c =>
      `هلا ${first(c.name)}! الفريق خلص البناء وإعلاناتك بتنزل قريب. قبل ما تشتغل، كم نقطة سريعة.\n\n**مكالماتنا:** أنا وأنت بيكون بينا مكالمة كل أسبوعين نراجع فيها الأرقام والليدز وشنو اللي يتقفل فعلاً. من ٢٠ إلى ٣٠ دقيقة على زوم، وكون بمكان هادي وعندك لابتوب مو وأنت بالسيارة.\n\n**متابعة العائد:** مهم جداً تحدث شيت المتابعة يوم بيوم. إذا ما تعبى، إحنا نحسّن وإحنا عميان، وهذا يحد مباشرة من قد إيش نقدر نطلع من الفلوس اللي تصرفها.\n\n**استمر ترسل لنا محتوى:** فولدر الدرايف مثبت فوق بالقروب. العملاء اللي إعلاناتهم تستمر تشتغل شهر ورا شهر هم اللي يخلون الفولدر مليان.\n\n**نتكلم بصراحة:** بأي وقت إذا عندك ملاحظة أو شك أو شي مو واضح، قل لي. بعد ما اشتغلنا مع أكثر من ٧٠ شركة، أنجح الناس هم اللي يتواصلون بكثرة بالزين وبالشين.\n\n**الشهر الأول دايم هو الأبطأ:** نجمع بيانات ونشوف السوق يتفاعل مع شنو، وبعدها يتحسن. إذا ما شفت انهيال بالأسبوع الأول، هذا طبيعي مو مشكلة.\n\nيلا نجيب لك مشاريع.`,
  },
  {
    id: "launch_week",
    title: "Launch week, daily",
    short: "sent the launch-week daily update",
    when: c => (c.liveDays ?? 99) <= 7,
    why: c =>
      `Launch week (day ${c.liveDays}), daily message, review call at day 7`,
    en: c =>
      `Morning ${first(c.name)}, quick update on week one.\n\nTwo things I need from you so I can tune it: are the enquiries reaching the right person, and are they the type of project you actually want? Speed to lead is the single biggest driver at this stage, someone who fills a form at 5pm hasn't decided to hire anyone yet, so whoever calls first usually wins.\n\nTell me either way and I'll adjust today.`,
    ar: c =>
      `صباح الخير ${first(c.name)}، تحديث سريع على الأسبوع الأول.\n\nشيئين أحتاجهم منك عشان أظبط الحملة: هل الاستفسارات توصل للشخص الصح؟ وهل نوع المشاريع هي اللي تبيها فعلاً؟ سرعة الرد على الليد أكبر عامل بهالمرحلة, اللي يعبي الفورم الساعة ٥ ما قرر يوظف أحد لين الحين، فاللي يتصل أول عادة يكسب.\n\nخبرني بأي حال وأعدّلها اليوم.`,
  },
  {
    id: "call_due",
    title: "No call in 2+ weeks",
    short: "asked for the check-in call",
    when: c => cadence(c).callOverdue,
    why: c =>
      `${c.callDays ?? "?"} days since the last check-in call, the cadence is ${cadence(c).callLabel}`,
    en: c =>
      `Hey ${first(c.name)}, hope things are going well on your end.\n\nIt's been a couple of weeks since we properly connected and I've got some updates I want to run you through, plus I want to make sure we're both looking at the same numbers.\n\nDo you have time this week for a quick call? Or if it's easier, I can send you a video report instead: ${LINKS.checkInCall}`,
    ar: c =>
      `السلام عليكم ${first(c.name)}، عساكم بخير.\n\nصار لنا كم أسبوع ما تكلمنا بشكل صحيح، وعندي كم تحديث أبي أمر عليها معاك، وأبي كمان أتأكد إن الأرقام واضحة عند الطرفين.\n\nعندك وقت هالأسبوع لمكالمة سريعة؟ ولا إذا أسهل لك أقدر أرسل لك تقرير فيديو بداله: ${LINKS.checkInCall}`,
  },
  {
    id: "no_stats",
    title: "Tracking sheet empty",
    short: "chased the tracking sheet",
    when: c => !c.sheetLink || (c.silentDays ?? 0) >= 5,
    why: () =>
      "Optimising blind, no show rate or close rate coming back from them",
    en: c =>
      `Hey ${first(c.name)}, the team and I just went to run over the numbers and noticed we don't have anything from you on how the appointments have gone:\n\n• Show rate\n• Close rate\n• Notes on who did and didn't convert, and why\n\nThis one matters more than it looks. Without it we're optimising blind, and we can't adjust the ads or how we handle your leads based on what's actually happening in the room.\n\nCan you update it before the end of the day?`,
    ar: c =>
      `السلام عليكم ${first(c.name)}، أنا والفريق كنا بنراجع الأرقام ولاحظنا ما عندنا شي منك عن كيف راحت المواعيد:\n\n• كم واحد حضر\n• كم واحد سكرت معاه\n• ملاحظات عن مين سكر ومين لا وليش\n\nهالنقطة أهم مما تبين. بدونها إحنا نحسّن وإحنا عميان، وما نقدر نعدل على الإعلانات ولا على طريقة تعاملنا مع الليدز بناء على اللي يصير فعلياً بالاجتماع.\n\nتقدر تحدثها اليوم قبل نهاية الدوام؟`,
  },
  {
    id: "silence",
    title: "Been quiet too long",
    short: "broke the silence",
    when: c => (c.silentDays ?? 0) >= 5,
    why: c => `No proactive message for ${c.silentDays} days`,
    en: c =>
      `Hey ${first(c.name)}, checking in on you and on the campaign.\n\nWhere are you standing on the enquiries that came through, has anything turned into a site visit or a quote yet? If it's gone quiet on your side tell me and I'll go through the account today.`,
    ar: c =>
      `السلام عليكم ${first(c.name)}، أطمئن عليك وعلى الحملة.\n\nوين وصلتم بالاستفسارات اللي وصلتكم, طلع منها زيارة موقع أو عرض سعر؟ وإذا صار عندك هدوء من ناحيتك خبرني وأراجع الحساب اليوم.`,
  },
  {
    id: "cookie",
    title: "Ramping, small win",
    short: "sent a small win",
    when: c => (c.liveDays ?? 99) <= 30,
    why: c =>
      `Ramping (day ${c.liveDays}), message every 2 days, at least one win a week`,
    en: c =>
      `Morning ${first(c.name)}. We're launching some new video angles the team just finished ideating, scripting, filming and editing. We ran them as beta tests on other accounts first and they've been performing well, so we want to roll them out for you now.\n\nHave a look: ${LINKS.content}\n\nWe're still tightening the targeting while the campaign learns, so cost per enquiry moves week to week, normal at this stage. What I care about from you: how many of these turned into site visits or quotes?`,
    ar: c =>
      `صباح الخير ${first(c.name)}. بننزل زوايا فيديو جديدة الفريق خلص من التفكير فيها وكتابتها وتصويرها ومونتاجها. جربناها أول على حسابات ثانية وأدت زين، فنبي ننزلها لكم الحين.\n\nشوفها: ${LINKS.content}\n\nولا زلنا نضبط الاستهداف والحملة بمرحلة التعلّم، فتكلفة الاستفسار تتحرك من أسبوع لأسبوع وهذا طبيعي بهالمرحلة. واللي يهمني منك: كم واحد منهم تحوّل لزيارة موقع أو عرض سعر؟`,
  },
  {
    id: "not_closing",
    title: "Leads not closing",
    short: "opened the sales-process conversation",
    when: c => c.level === "red" || /red|defcon\s*[12]/i.test(String(c.defcon)),
    why: () =>
      "Flagged red, the constraint is usually the sales process, not the leads",
    en: c =>
      `Hey ${first(c.name)}, our team went in and audited the numbers, and the biggest constraint right now is that the leads coming in aren't converting, or the projects they are converting on are too small.\n\nFirst thing I want to do is go deep on your sales process on our next call and find where it's falling short. In our experience it's a sales issue about 85% of the time and a marketing issue about 15%, which is the part we tweak on our end.\n\nBest case, we review one of your actual sales calls together, that tells us more in twenty minutes than any amount of guessing at the numbers. If your meetings are online, install https://fathom.video and it records and transcribes automatically.\n\nCan we get on a call? ${LINKS.checkInCall}`,
    ar: c =>
      `السلام عليكم ${first(c.name)}، فريقنا راجع الأرقام، وأكبر عائق حالياً إن الليدز اللي توصل ما تتحول، أو المشاريع اللي تتقفل صغيرة على اللي تبيه.\n\nأول شي أبي أسويه إننا نغوص بعملية البيع عندك بالمكالمة الجاية ونشوف وين الخلل. من خبرتنا ٨٥٪ من الحالات تكون مشكلة بيع و١٥٪ مشكلة تسويق، وهذا الجزء اللي نعدله من طرفنا.\n\nوأفضل شي إننا نراجع وحدة من مكالماتك البيعية سوا. هذي تعطينا بعشرين دقيقة أكثر من أي تخمين بالأرقام. وإذا اجتماعاتك أونلاين نزل https://fathom.video ويسجل ويفرغ الكلام تلقائياً.\n\nنقدر نتكلم؟ ${LINKS.checkInCall}`,
  },
  {
    id: "paused",
    title: "Paused, keep warm",
    short: "kept the paused client warm",
    // Paused clients used to flood the board every single day. Three nudges only —
    // day 3, day 7, day 14 — and at 14 days they are counted as churned anyway.
    // "Stopped" in ClickUp already means churned, so it is never messaged here.
    when: c => PAUSE_NUDGE_DAYS.includes(c.pausedDays ?? -1),
    why: c =>
      `Paused ${c.pausedDays} day(s), nudge ${
        PAUSE_NUDGE_DAYS.indexOf(c.pausedDays) + 1
      } of 3. At ${PAUSE_IS_CHURN_DAYS} days paused they count as churned.`,
    en: c =>
      `Hey ${first(c.name)}, your campaign is paused at the moment so nothing is being spent.\n\nWhenever you're ready to open the tap again just say the word and I'll have it live the same day, everything we built is still in place. What would need to be true for you to restart?`,
    ar: c =>
      `السلام عليكم ${first(c.name)}، حملتك متوقفة حالياً فما فيه أي صرف.\n\nوقت ما تكون جاهز نرجع نشغلها خبرني وأرجعها بنفس اليوم, كل اللي بنيناه لا زال موجود. شنو اللي لازم يصير عشان ترجع تشغلها؟`,
  },
  {
    id: "monthly_report",
    title: "Monthly report",
    short: "sent the monthly report",
    when: c => !!c.reportDue,
    why: c =>
      c.lastReport
        ? `No report sent in ${c.reportDays} days, the monthly report is overdue`
        : "No monthly report has ever been sent to this client",
    en: c =>
      `Hi ${first(c.name)}, your monthly report is ready, numbers, what we changed and what we are doing next month are all in here: ${c.sheetLink ?? "[report link]"}\n\nTwo things worth your eye: the leads that came in, and any appointment still missing an outcome. If you fill those in, next month's report gets sharper for both of us.\n\nHappy to walk you through it on a quick call if you would rather hear it than read it.`,
    ar: c =>
      `السلام عليكم ${first(c.name)}، تقريركم الشهري جاهز, الأرقام، والتعديلات اللي سويناها، وخطتنا للشهر الجديد، كلها هنا: ${c.sheetLink ?? "[رابط التقرير]"}\n\nأمرين يستاهلون نظرتكم: العملاء المحتملين اللي وصلوا، وأي موعد مازال بدون نتيجة مسجلة. إذا عبيتوها، تقرير الشهر الجاي يصير أدق لنا ولكم.\n\nوإذا تفضلون أشرحه لكم على مكالمة قصيرة، جاهز.`,
  },
  {
    id: "routine",
    title: "Routine update",
    short: "sent the routine update",
    when: () => true,
    why: c => c.todo || "Routine touchpoint, keep the cadence unbroken",
    en: c =>
      `Hey ${first(c.name)}, quick update from our side, the campaign is running and I'm watching it daily.\n\nAnything you want more of, or any type of project you'd rather stop getting, tell me and I'll steer it that way.`,
    ar: c =>
      `هلا ${first(c.name)}، تحديث سريع من طرفنا, الحملة شغالة وأنا أتابعها يومياً.\n\nأي شي تبي منه أكثر، أو نوع مشاريع ما تبي يوصلك، خبرني وأوجّهها بهذا الاتجاه.`,
  },
];

/** Every template that applies, most urgent first — she picks the angle. */
/**
 * Strip the tells that make a message look machine-written.
 *
 * The company rule: no em dashes in anything a client reads. A dash between two clauses becomes
 * a comma, or a full stop when a new sentence clearly starts, so the sentence still breathes
 * the way a person would write it. Applied at the single point every client message passes
 * through, so a new template cannot smuggle one back in.
 */
export function humanise(text: string): string {
  return (
    text
      // Arabic has no capital letters, so only a following capital in Latin script means a
      // new sentence started; in Arabic a dash is always a comma's job.
      .replace(/\s*[\u2014\u2013]\s*(?=[A-Z])/g, ". ")
      // Arabic sentences take the Arabic comma, not the Latin one.
      .replace(/([\u0600-\u06FF])\s*[\u2014\u2013]\s*/g, "$1، ")
      .replace(/\s*[\u2014\u2013]\s*/g, ", ")
      .replace(/\.\s*\./g, ".")
      .replace(/,\s*,/g, ",")
      .replace(/،\s*،/g, "،")
      .replace(/\s+([,.،])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
  );
}

/**
 * The same cleanup applied to any object shown on screen, not just to messages.
 *
 * Diagnosis steps, hot list reasons and screen labels are read by the team, and The company rule
 * covers them too. Doing it at the boundary means a new label written with a dash is fixed
 * on sight rather than caught in review.
 */
export function humaniseDeep<T>(value: T): T {
  if (typeof value === "string") return humanise(value) as unknown as T;
  if (Array.isArray(value)) return value.map(humaniseDeep) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = humaniseDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

export function draftsFor(
  c: Client,
  lang: Lang,
): {
  id: string;
  title: string;
  why: string;
  short: string;
  message: string;
}[] {
  // Churned clients ("Stopped") are gone — they do not belong on a touchpoint list.
  if (isChurned(c)) return [];
  const hits = TEMPLATES.filter(t => t.when(c));
  const list = hits.length ? hits : [TEMPLATES[TEMPLATES.length - 1]];
  const generic = list.map(t => ({
    id: t.id,
    title: t.title,
    why: t.why(c),
    short: t.short,
    message: humanise(lang === "ar" ? t.ar(c) : t.en(c)),
  }));

  // A client inside their first 14 days gets the SOP's spine first: the exact message for
  // the day they are on, then any day that fell through while they were silent. Only after
  // that do the general templates appear, because during onboarding the spine outranks
  // everything else.
  const { day, dayIndex, missed } = spineFor(c);
  const spine = [
    ...(day ? [day] : []),
    ...missed.filter(m => m.day !== day?.day),
  ].map(entry => ({
    id: `spine_${entry.day}`,
    title:
      entry.day === dayIndex
        ? `Day ${entry.day}: ${entry.label}`
        : `Day ${entry.day} (missed): ${entry.label}`,
    why:
      entry.day === dayIndex
        ? `Day ${entry.day} of the 14 day onboarding spine. The SOP is one message a day, every day, until the review on day 14.`
        : `Day ${entry.day} never went out. Send it now rather than skipping it, the spine is what makes them feel started.`,
    short: `Onboarding day ${entry.day}: ${entry.label}`,
    message: humanise(spineMessage(entry, lang, String(c.name ?? ""))),
  }));

  // Past day 14 but still not launched: the spine has run out and speed to launch is the
  // real problem, so say that instead of offering a day 15 message that does not exist.
  const stalled =
    c.bucket === "onboarding" && (c.signupDays ?? 0) > 14 && !spine.length
      ? [
          {
            id: "spine_overrun",
            title: `Onboarding is ${c.signupDays} days old`,
            why: `The SOP launches inside 7 days of signup. This client signed ${c.signupDays} days ago and is still in ${c.stage}. The spine has run out, so the honest move is a straight update on what is blocking launch.`,
            short: "Launch overdue update",
            message: humanise(
              spineMessage(SPINE[5], lang, String(c.name ?? "")),
            ),
          },
        ]
      : [];

  return [...spine, ...stalled, ...generic];
}

/** Guess from the client's own name; her saved choice always wins over this. */
export function guessLang(name: string): Lang {
  return /[\u0600-\u06FF]/.test(name ?? "") ? "ar" : "en";
}

/**
 * Which call is next in the journey, with the booking link and a covering message.
 *
 * The journey is fixed and each stage has exactly one next call:
 *   Needs Contacting     welcome call, done by the CSM the moment they sign, then the
 *                        onboarding call is booked. There is no booking link for the
 *                        welcome call, he picks up the phone.
 *   Onboarding Booked    run the onboarding call, and the brand blueprint call is booked
 *                        on it, with the creative strategist. Not the launch call.
 *   Brand Blueprint      after the blueprint, the launch call gets booked.
 *   Launch Booked        run the launch call, then mark them ready for launch.
 *   Ready For Launch     no call. Confirm live with the media buyer and tell the client.
 *   Active               the check-in call.
 */
export function nextCall(
  c: Client,
  lang: Lang,
): {
  label: string;
  url: string;
  message: string;
  doNow: string;
  framework?: string;
} {
  const n = first(c.name);
  const stage = String(c.stage ?? "");
  const ar = lang === "ar";

  if (stage === "Needs Contacting" || (c.newSignup && !stage))
    return {
      label: "Welcome call",
      url: "",
      doNow:
        "Call them today to welcome them, then send the onboarding call link on the call itself.",
      framework: LINKS.onboardingFramework,
      message: ar
        ? `هلا ${n}! معك فريق مهارة، مبروك انضمامك. أحاول أتواصل معك اليوم بمكالمة ترحيب سريعة، وبعدها نثبّت مكالمة الانضمام (٦٠ دقيقة) من هنا: ${LINKS.onboardingCall}`
        : `Hey ${n}! This is the Mahara team, welcome aboard. I'll give you a quick welcome call today, and after that we lock in your onboarding call (60 min) here: ${LINKS.onboardingCall}`,
    };

  if (/onboarding booked/i.test(stage))
    return {
      label: "Onboarding call",
      url: LINKS.onboardingCall,
      doNow:
        "Run the onboarding call from the framework, and book the brand blueprint call with the creative strategist on the call itself.",
      framework: LINKS.onboardingFramework,
      message: ar
        ? `هلا ${n}، تأكيد لموعد مكالمة الانضمام (٦٠ دقيقة). يفضل تكون من الكمبيوتر ومسجّل دخول على حساب فيسبوك الخاص بالشركة حتى نجهز كل شي بنفس المكالمة. لو تحتاج تعدّل الوقت: ${LINKS.onboardingCall}`
        : `Hey ${n}, confirming your onboarding call (60 min). Best from a computer and logged into the business Facebook account so we can set everything up on the call itself. If you need to move it: ${LINKS.onboardingCall}`,
    };

  if (/blueprint/i.test(stage))
    return {
      label: "Brand blueprint call",
      url: LINKS.brandBlueprintCall,
      doNow:
        "The blueprint is the creative strategist's call. Make sure it happens, then book the launch call straight after it.",
      message: ar
        ? `هلا ${n}، خطوتنا القادمة مكالمة الهوية والتصاميم مع مسؤول الإبداع عندنا. اختر وقتك من هنا: ${LINKS.brandBlueprintCall}`
        : `Hey ${n}, next step is your brand blueprint call with our creative strategist. Pick your time here: ${LINKS.brandBlueprintCall}`,
    };

  if (/launch booked/i.test(stage))
    return {
      label: "Launch call",
      url: LINKS.launchCall,
      doNow:
        "Run the launch call from the framework, then mark them ready for launch.",
      framework: LINKS.launchFramework,
      message: ar
        ? `هلا ${n}، جاهزين لمكالمة الإطلاق. بنراجع فيها كل شي قبل تشغيل الحملة. الوقت من هنا: ${LINKS.launchCall}`
        : `Hey ${n}, we're ready for your launch call. We go through everything before the campaign switches on. Time here: ${LINKS.launchCall}`,
    };

  if (/ready for launch/i.test(stage))
    return {
      label: "No call, get them live",
      url: "",
      doNow:
        "Confirm with the media buyer that the campaign is live, then tell the client it is live yourself.",
      message: ar
        ? `هلا ${n}، حملتك صارت شغّالة رسمياً. أول ليد يوصلك بنرسله لك على طول، وأي سؤال أنا موجود.`
        : `Hey ${n}, your campaign is officially live. The moment the first enquiry lands we send it straight to you, and I'm here for anything in between.`,
    };

  return {
    label: "Client check-in call",
    url: LINKS.checkInCall,
    doNow: "Book the check-in call and bring a solution to it, not a report.",
    message: ar
      ? `السلام عليكم ${n}، تقدر تحجز لنا مكالمة من هنا: ${LINKS.checkInCall}`
      : `Hey ${n}, you can pen us in for a call here: ${LINKS.checkInCall}`,
  };
}

/**
 * The next point of contact, as ClickUp knows it (`Next POC`). The definition: this is
 * the next CALL, not the next message. Messages are tracked automatically off `Last POC`
 * and the cadence, so nothing about them is typed in by hand. Every client must always have
 * a booked next call, because a client with no next call is how churn starts. Missing or
 * already past both count as unbooked.
 */
export function nextPocState(
  c: Client,
  today: string,
): {
  date: string | null;
  missing: boolean;
  past: boolean;
  suggested: string;
  label: string;
} {
  // A real booking in the client calendar beats the ClickUp field. If the call is on the
  // calendar, the touchpoint is booked, whatever the board says.
  const bookedAt = (c as { nextCallAt?: string }).nextCallAt ?? null;
  const booked =
    bookedAt && bookedAt.slice(0, 10) >= today ? bookedAt.slice(0, 10) : null;
  const date = booked ?? (c.nextPoc as string | undefined) ?? null;
  const past = !!date && date < today;
  const missing = !date;
  // The suggestion is a CALL date, so it follows the call cadence: weekly through the first
  // month live, every 2 weeks after that.
  const days = cadence(c).callEvery;
  // Guard the date maths: a missing or malformed day must never throw inside a render.
  const base = new Date(`${today ?? ""}T09:00:00Z`);
  const anchor = Number.isNaN(base.getTime()) ? new Date() : base;
  anchor.setUTCDate(anchor.getUTCDate() + days);
  const suggested = anchor.toISOString().slice(0, 10);
  return {
    date,
    missing,
    past,
    suggested,
    // Display only: the ISO day above is what gets saved and compared.
    label: booked
      ? `Next call ${shortDay(booked)}, booked in the calendar`
      : missing
        ? "No next call booked"
        : past
          ? `Next call ${shortDay(date)} has passed, rebook it`
          : `Next call ${shortDay(date)}`,
  };
}

/**
 * Done with you or done for you, straight off ClickUp's Service field.
 *
 * DWY means the client books their own appointments, so we are accountable for leads and
 * cost per lead and nothing downstream: no report sheet, no booking, show or close rates.
 * DFY means we run the whole funnel and every number counts.
 */
export function serviceModel(service?: string | null): {
  code: "DWY" | "DFY" | null;
  dwy: boolean;
  label: string;
  kpi: string;
} {
  const raw = String(service ?? "");
  if (/dwy|done with/i.test(raw))
    return {
      code: "DWY",
      dwy: true,
      label: "DWY, they book their own",
      kpi: "Leads and cost per lead only. No sheet, no booking or close rates.",
    };
  if (/dfy|done for/i.test(raw))
    return {
      code: "DFY",
      dwy: false,
      label: "DFY, we run the funnel",
      kpi: "Leads, cost per lead, bookings, attendance and closes.",
    };
  return {
    code: null,
    dwy: false,
    label: "Service not set",
    kpi: "Set DFY or DWY, otherwise we do not know which numbers we owe them.",
  };
}
