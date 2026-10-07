/**
 * The onboarding to launch spine, day 0 to day 14.
 *
 * Wording is lifted from Mahara's own SOP, "Onboarding To Launch Messaging - Client
 * Success Manager" (1HDLVQAcAcA-QjSp5asIt2RfHUy6izCGqcwPzIO5SLQ0), in English and Arabic.
 * The SOP's rules, not mine:
 *   - the CSM sends a message every single day for the first 14 days, no exceptions
 *   - never "just checking in" on its own, every message carries a number, a finished step
 *     or a decision
 *   - launch inside 7 days of signup, first appointment inside 7 days of launch
 *   - never two team messages in one day, the CSM's daily message has priority
 *
 * Placeholders in square brackets are deliberate. The CSM fills them, because inventing a
 * number for a client is worse than asking her to type it.
 */

export type SpineDay = {
  day: number;
  /** What this day is for, in her words not the client's. */
  label: string;
  en: string;
  ar: string;
};

export const SPINE: SpineDay[] = [
  {
    day: 0,
    label: "Introduce yourself",
    en: `Hey NAME, welcome aboard. I'm [name] and I'm your point of contact from here on.

Quick version of what happens next: we get on an onboarding call, then a brand blueprint call where we build your offer and messaging properly, then we launch. I'll be in this group every day keeping you updated on where we are.

Anything you need, ask here and I'll sort it or get the right person on it.`,
    ar: `مرحبتين NAME، حياك الله معنا. أنا [الاسم] وأنا نقطة التواصل معك من الحين ورايح.

باختصار اللي جاي: نسوي مكالمة تعريفية، بعدها مكالمة نبني فيها عرضك ورسالتك بشكل صحيح، وبعدها ننطلق. وبكون معك بهالقروب كل يوم أحدثك وين وصلنا.

أي شي تحتاجه اكتبه هني وأنا أرتبه لك أو أجيب لك الشخص المناسب.`,
  },
  {
    day: 1,
    label: "Onboarding call confirmed",
    en: `Hey NAME, your onboarding call is confirmed for DATE/TIME.

Nothing to prepare, but it helps if you can think about which service you most want more of, and roughly what a good project is worth to you. We'll cover the rest on the call.`,
    ar: `هلا NAME، مكالمتك التعريفية مثبتة بتاريخ DATE/TIME.

ما تحتاج تجهز شي، بس يساعد إذا تفكر بأي خدمة تبي منها أكثر، وكم تقريباً يساوي لك المشروع الزين. والباقي نغطيه بالمكالمة.`,
  },
  {
    day: 2,
    label: "After the onboarding call",
    en: `Hey NAME, good call earlier. Here's where we are.

[what was agreed] is now with the team. I've briefed [who] and they're starting on [what] today.

What I need from you: [the one thing]. Everything else is on us.`,
    ar: `هلا NAME، المكالمة كانت زينة. هذا وين وصلنا.

[اللي اتفقنا عليه] صار مع الفريق. برفت [مين] وبيبدون على [شنو] اليوم.

واللي أحتاجه منك: [الشي الوحيد]. والباقي علينا.`,
  },
  {
    day: 3,
    label: "Backend sorted",
    en: `Hey NAME, quick update from behind the scenes. Your contract and payment are sorted, and I've briefed the call centre on your services and pricing so they can speak properly to your leads when they start coming in.`,
    ar: `هلا NAME، تحديث سريع من ورا الكواليس. العقد والدفع تمام، وبرفت الكول سنتر على خدماتك وأسعارك عشان يقدرون يتكلمون بشكل صحيح مع الليدز أول ما يبدون يوصلون.`,
  },
  {
    day: 4,
    label: "Content chase",
    en: `Hey NAME, one thing I need from you and it's the one that matters most for your ads.

Your Drive folder is pinned at the top of the group. Anything you have works: photos of finished projects, work in progress, your team on site. Don't filter it, we'll do that.

The clients whose ads keep performing month after month are the ones who keep that folder full.`,
    ar: `هلا NAME، شي واحد أحتاجه منك وهو أهم شي لإعلاناتك.

فولدر الدرايف مثبت فوق بالقروب. أي شي عندك يفيد: صور مشاريع مخلصة، شغل قيد التنفيذ، فريقك بالموقع. لا تفلتر، إحنا نفلتر.

العملاء اللي إعلاناتهم تستمر تشتغل شهر ورا شهر هم اللي يخلون الفولدر مليان.`,
  },
  {
    day: 5,
    label: "Where we are",
    en: `Hey NAME, quick status. Done so far: [list]. Still to go before launch: [list].

On track for DATE. I'll tell you straight away if that changes.`,
    ar: `هلا NAME، تحديث سريع للوضع. اللي خلص: [القائمة]. واللي باقي قبل الإطلاق: [القائمة].

ماشين على تاريخ DATE. وإذا تغير شي بقول لك على طول.`,
  },
  {
    day: 6,
    label: "Launch call confirmed",
    en: `Hey NAME, your launch call is confirmed for DATE/TIME. We'll walk through what's going live, what happens with the leads, and what the first few weeks look like.`,
    ar: `هلا NAME، مكالمة الإطلاق مثبتة بتاريخ DATE/TIME. بنمر على اللي بينزل، وشنو يصير مع الليدز، وكيف بتكون أول أسابيع.`,
  },
  {
    day: 7,
    label: "Everything ready",
    en: `Hey NAME, everything is ready. Ads are built, systems tested, call centre briefed. We go live tomorrow.`,
    ar: `هلا NAME، كل شي جاهز. الإعلانات مبنية، والأنظمة مجربة، والكول سنتر مبرف. بننطلق بكرة.`,
  },
  {
    day: 8,
    label: "Live",
    en: `Hey NAME, your ads are live.

One thing to keep in mind: the first few weeks are always the slowest. The platform needs time to learn who responds to you, and we need data before we can optimise anything. It gets better from there, so if week one feels quiet, that's normal, not a problem.

Our team is watching performance every day, and the call centre handles every lead that comes in seven days a week.`,
    ar: `هلا NAME، إعلاناتك نزلت.

وشي تحطه ببالك: أول أسابيع دايم هي الأبطأ. المنصة تحتاج وقت تتعلم مين يتفاعل معك، وإحنا نحتاج بيانات قبل ما نقدر نحسن أي شي. وبعدها تتحسن، فإذا حسيت الأسبوع الأول هادي، هذا طبيعي مو مشكلة.

فريقنا يتابع الأداء يومياً، والكول سنتر يتعامل مع كل ليد يوصل، سبعة أيام بالأسبوع.`,
  },
  {
    day: 9,
    label: "First leads",
    en: `Hey NAME, we've had X leads come through already and the call centre is contacting them now. Early, but it's a good sign the targeting is landing.`,
    ar: `هلا NAME، وصلنا X ليد لين الحين والكول سنتر يتواصل معهم. بدري، بس مؤشر زين إن الاستهداف مضبوط.`,
  },
  {
    day: 10,
    label: "First 48 hours",
    en: `Hey NAME, first 48 hours: X leads, Y contacted, Z appointments booked. Cost per lead is at $X.

[One line on what that means and what we're adjusting.]`,
    ar: `هلا NAME، أول ٤٨ ساعة: X ليد، تواصلنا مع Y، وتحجز Z موعد. وتكلفة الليد $X.

[سطر عن معنى الأرقام وشنو نعدل.]`,
  },
  {
    day: 11,
    label: "Lead quality check",
    en: `Hey NAME, what's your read on the leads so far? I'd rather adjust the targeting in week one than find out in week four that we've been bringing you the wrong people.

Anything your team is noticing, tell me straight.`,
    ar: `هلا NAME، شنو انطباعك عن الليدز لين الحين؟ أفضل نعدل الاستهداف بالأسبوع الأول بدل ما نكتشف بالأسبوع الرابع إننا نجيب لك ناس غلط.

أي شي فريقك يلاحظه، قل لي بصراحة.`,
  },
  {
    day: 12,
    label: "Sales targets",
    en: `Hey NAME, I want to set targets so we both know what good looks like.

Your goal is X projects a month. At your close rate that means roughly Y appointments, which at our current cost per lead means Z leads a month. That's the number I'm managing against.`,
    ar: `هلا NAME، أبي نحط أهداف عشان نعرف إحنا وأنت شنو يعتبر نجاح.

هدفك X مشروع بالشهر. وبنسبة الإقفال عندك يعني تقريباً Y موعد، وبتكلفة الليد الحالية يعني Z ليد بالشهر. وهذا الرقم اللي أشتغل عليه.`,
  },
  {
    day: 13,
    label: "Anything blocking you",
    en: `Hey NAME, anything on your side slowing this down? Team capacity, someone not picking up leads fast enough, anything at all.

Ask now while we're early. Small things fixed in week two save months later.`,
    ar: `هلا NAME، فيه شي من طرفك يبطئ الشغل؟ طاقة الفريق، أو أحد ما يرد على الليدز بسرعة، أي شي.

اسأل الحين وإحنا بالبداية. الأشياء الصغيرة اللي تنحل بالأسبوع الثاني توفر شهور بعدين.`,
  },
  {
    day: 14,
    label: "Week one review",
    en: `Hey NAME, two weeks in. Here's the picture: [numbers].

What's working: [x]. What we're changing this week: [y].

Your check-in call is booked for DATE. From here we move to our regular rhythm, which is a call every two weeks and updates in this group as things happen.`,
    ar: `هلا NAME، صار لنا أسبوعين. هذي الصورة: [الأرقام].

اللي شغال: [x]. واللي بنغيره هالأسبوع: [y].

مكالمة المتابعة عندك محجوزة بتاريخ DATE. ومن هني ننتقل للإيقاع المعتاد، مكالمة كل أسبوعين وتحديثات بالقروب أول بأول.`,
  },
];

/** The SOP's milestone message, sent the moment the first appointment lands. */
export const FIRST_BOOKING = {
  label: "First booking",
  en: `Hey NAME, first appointment just came in. That's the system working. More to come, let's keep the momentum.`,
  ar: `هلا NAME، أول موعد وصل. النظام شغال. وجاي أكثر، خلنا نحافظ على الزخم.`,
};

/**
 * Which day of the spine this client is on, and which days were missed.
 *
 * `dayIndex` counts from the signup date when we have one, otherwise from the launch date,
 * which is the only other dated anchor ClickUp gives us. Past days are only called missed
 * when nothing was logged since, because a client who is being messaged daily should never
 * be nagged by their own dashboard.
 */
export function spineFor(
  c: {
    liveDays?: number | null;
    signupDays?: number | null;
    silentDays?: number | null;
    bucket?: string;
  },
  today = new Date(),
): { day: SpineDay | null; dayIndex: number | null; missed: SpineDay[] } {
  void today;
  const since =
    c.signupDays != null
      ? c.signupDays
      : c.liveDays != null
        ? c.liveDays + 7 // launch is day 8 of the spine, so signup was roughly a week before
        : null;
  if (since == null || since > 14)
    return { day: null, dayIndex: null, missed: [] };
  const dayIndex = Math.max(0, Math.min(14, Math.round(since)));
  const day = SPINE.find(s => s.day === dayIndex) ?? null;
  // Silence longer than a day means the daily spine broke; name the days that fell through.
  const silent = c.silentDays ?? 0;
  const missed =
    silent > 1
      ? SPINE.filter(
          s => s.day < dayIndex && s.day >= dayIndex - Math.min(silent, 5),
        )
      : [];
  return { day, dayIndex, missed };
}

/** Fill the client's first name into whichever language she picked. */
export function spineMessage(
  entry: SpineDay,
  lang: "en" | "ar",
  name: string,
): string {
  const firstName = (name ?? "").split(/[\s-]/)[0] || name || "";
  return (lang === "ar" ? entry.ar : entry.en).replace(/NAME/g, firstName);
}
