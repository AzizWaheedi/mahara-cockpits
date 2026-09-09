/**
 * The message templates, straight out of the Client Communication SOP.
 *
 * Google Doc 10wQorQfSebiX3Lmh0jXkEUkp3I_xMP68p4b1q-oUxcY, "Text Templates".
 * Only the ones a Creative Director actually sends are here: scripts, ads,
 * filming guidance, and the three conversations creative work always triggers
 * (endless revisions, "not brand aligned", "why can't I see the ads").
 *
 * Nothing here is written by Viktor. The wording is the SOP's wording, English
 * and Arabic, with NAME swapped for the client. The SOP's own "Creative
 * Director Temps" heading is an empty placeholder in the doc, so these were
 * taken from the body of the template library instead. If Aziz writes that
 * section, replace this file with it.
 */

export type Template = {
  id: string;
  label: string;
  /** When to send it. */
  when: string;
  /** SOP guidance that is for you, not for the client. */
  internal?: string;
  en: string;
  ar: string;
};

export const TEMPLATES: Template[] = [
  {
    id: "scripts-ready",
    label: "Scripts are ready for review",
    when: "The moment a script batch is done. Do not sit on it.",
    en: `Hey NAME, your scripts are done.
They're written off the brand DNA and the offer we built together on the blueprint call, so the messaging matches how you actually sell rather than being generic ad copy.
Have a read and tell me if anything is wrong or doesn't sound like you. Once you're happy we move to filming.`,
    ar: `هلا NAME، النصوص جاهزة.
مكتوبة على أساس هوية البراند والعرض اللي بنيناه سوا بمكالمة البلوبرنت، فالرسالة تتماشى مع طريقة بيعك الحقيقية مو نص إعلاني عام.
اقراها وقل لي إذا فيه شي غلط أو ما يشبه أسلوبك. وأول ما تكون مرتاح ننتقل للتصوير.`,
  },
  {
    id: "ads-approval",
    label: "New ads ready for approval",
    when: "A new batch is built and needs their sign off before launch.",
    internal:
      "Fill in the angle and the reason from their own numbers or from what is winning on another client in the same service. Never send it with the brackets still in.",
    en: `Hey NAME, the new ads are ready.
Here's what we're testing and why: we're going after [angle], because [reason based on their data or what's working elsewhere]. That's what we're testing, and the numbers will tell us within a week or two whether it lands.
Have a look. If something is factually wrong or genuinely off-brand, tell me and we fix it same day. If it's a preference call, I'd rather launch and let the data decide.
I'd like to get these live by DATE so we start collecting data.`,
    ar: `هلا NAME، الإعلانات الجديدة جاهزة.
هذا اللي نجربه وليش: رايحين على [الزاوية]، لأن [السبب حسب بياناتهم أو اللي شغال بمكان ثاني]. هذا اللي بنجربه، والأرقام بتقول لنا خلال أسبوع أو أسبوعين إذا نجح.
شوفها. إذا فيه شي فيه معلومة غلط أو فعلاً ما يمثل هويتك، قل لي ونعدله بنفس اليوم. وإذا الموضوع ذوق شخصي، أفضل ننزل وندع الأرقام تحكم.
أبي ننزلها بتاريخ DATE عشان نبدأ نجمع بيانات.`,
  },
  {
    id: "filming-guidance",
    label: "They are filming their own ads and want guidance",
    when: "Before their first shoot, and again whenever the footage comes back flat.",
    internal:
      "Attach the good and bad ad examples and the content list at content.maharamedia.com. The point of the message is energy and setting, not production quality.",
    en: `So there's a few key pillars to recording content that actually performs, and it's pretty different to what you'd normally post. Let me run you through it.
There are two parts to a video ad: the hook and the body.
The hook is the first 3-5 seconds and it's the most important part of the whole thing. Its only job is to stop the right person from scrolling. Someone who's been thinking about a villa renovation for six months needs to feel like you're talking directly to them, and everyone else should keep scrolling. That's a good hook.
The body is everything after it. What you do, who you do it for, what makes you different, and what happens if they get in touch.
A few things that matter more than people expect:
Record on site or in your office, in what you'd actually wear to meet a client. It should be obvious from the first second that you run a real firm. A finished project behind you, a site in progress, your workshop, all of that works better than a plain wall.
Energy and tonality carry the ad. I'll be straight with you: if the energy is flat, the ad doesn't perform, no matter how good the script is. It's the single most common reason a client's own footage doesn't work.
Use your phone in portrait or a proper camera, and prop it on a tripod. Handheld shakes and it reads as unserious.
Record all the hooks in one clip, then all the bodies in another. Don't stop after each one. If you fumble a line, pause for two seconds and say it again, the editors will cut it. Starting and stopping is what makes filming take an hour instead of ten minutes.
Have a look at the good examples before you shoot, and the bad ones too. The difference is usually energy, not production.`,
    ar: `السلام عليكم، فيه كم نقطة أساسية لتصوير محتوى يشتغل فعلاً، وهي مختلفة عن اللي تنشره عادة. خلني أمر معاك عليها.
الإعلان فيه جزئين: الهوك والبودي.
الهوك هو أول ٣ إلى ٥ ثواني وهو أهم شي بالفيديو كله. شغلته الوحيدة إنه يوقف الشخص الصح عن التصفح. الواحد اللي صار له ٦ أشهر يفكر بترميم فلته لازم يحس إنك تكلمه هو بالذات، والباقي يكملون تصفح. هذا الهوك الزين.
البودي هو كل اللي بعده. شنو تسوي، لمن تسوي، شنو يميزك، وشنو يصير إذا تواصل معاك.
كم شي أهم مما يتوقع الناس:
صور بالموقع أو بمكتبك، وبنفس اللبس اللي تقابل فيه عميل. لازم يبين من أول ثانية إنك تدير شركة حقيقية. مشروع مخلص وراك، أو موقع شغال، أو الورشة، كلها أفضل من جدار فاضي.
الطاقة وطريقة الإلقاء هي اللي تحمل الإعلان. بصراحة: إذا الطاقة باردة، الإعلان ما يشتغل، مهما كان النص حلو. وهذا أكثر سبب يخلي تصوير العميل ما ينجح.
استخدم جوالك بالوضع العمودي أو كاميرا احترافية، وحطها على ترايبود. التصوير باليد يهتز ويطلع شكله غير احترافي.
صور كل الهوكات بمقطع واحد، وبعدين كل البوديات بمقطع ثاني. لا توقف التسجيل بعد كل وحدة. إذا غلطت بجملة، اسكت ثانيتين وأعدها، والمونتاج بيقص. الوقوف والتشغيل هو اللي يخلي التصوير ياخذ ساعة بدل عشر دقايق.
شوف الأمثلة الزينة قبل ما تصور، وشوف الأمثلة السيئة كمان. الفرق عادة بالطاقة مو بجودة التصوير.`,
  },
  {
    id: "revision-loop",
    label: "They are picky and the creatives are stuck in revisions",
    when: "Round three of edits on the same batch, or a batch sitting unlaunched.",
    internal:
      "Put the real round number in. This is a nudge, not an ultimatum, and it only works if the batch really is being held up by preference and not by a mistake of ours.",
    en: `Hey NAME, I want to flag something before it costs you.
We're on round X of adjustments on this batch, and the ads still haven't gone live. I understand wanting them right, and I'd never push you to run something you're uncomfortable with. But the ads sitting in review aren't generating anything, and the delay is doing more damage than any imperfection in the creative would.
Here's how I'd suggest we work it: if something is genuinely off-brand or factually wrong, tell me and we fix it immediately. If it's a preference thing, let's launch it and let the numbers decide. The data will tell us more in a week than another round of edits will.
Can we get this batch live by DATE?`,
    ar: `السلام عليكم NAME، أبي أنبهك لشي قبل ما يكلفك.
إحنا بالجولة X من التعديلات على هالدفعة، والإعلانات لين الحين ما نزلت. أتفهم إنك تبيها مضبوطة، وأنا أبداً ما بضغط عليك تشغل شي مو مرتاح له. بس الإعلانات اللي واقفة بالمراجعة ما تجيب ولا ليد، والتأخير يضر أكثر من أي ملاحظة بسيطة على التصميم.
اقتراحي لطريقة الشغل: إذا فيه شي فعلاً ما يمثل هويتك أو فيه معلومة غلط، قل لي ونعدله على طول. أما إذا الموضوع ذوق شخصي، خلنا ننزله وندع الأرقام تحكم. البيانات بتقول لنا بأسبوع أكثر من جولة تعديلات ثانية.
نقدر ننزل هالدفعة بتاريخ DATE؟`,
  },
  {
    id: "not-brand-aligned",
    label: "They reject most ads as not brand aligned",
    when: "They are killing ads before the ads have any data.",
    en: `Hey NAME, thanks for raising it, and I want to give you a proper answer rather than just agreeing.
We completely understand how important it is that the ads align with your brand and how you want to be seen. At the same time our job is to bring you results, so what we're always trying to do is strike the right balance between the two.
There's something I want you to know, because it changes how this looks. Paid ads don't get posted to your page. They run in the feed of the people we target and never appear on your profile, so someone visiting your page won't see them. The ad that feels too direct isn't sitting next to your project photography, it's showing to a stranger who's never heard of you.
The other thing is volume. We can't find what works by running three ads. We need to test a lot of angles, kill what fails and scale what works. Every ad that gets rejected before it has data is an angle we never learn about, so we end up guessing instead of knowing.
So here's what I'd suggest. If there are specific ads you feel are an absolute no, tell me and I'll pull them. What I want to avoid is switching off ads that are performing, because that hits your results directly. Anything factually wrong or genuinely off-brand, that's changed same day.
And if the brand feel matters to you, and it should, the right fix is a proper organic content plan running alongside the ads. That's where the polish belongs. Happy to talk about that separately.
Let me know your thoughts, I want to make sure we're aligned on this going forward.`,
    ar: `السلام عليكم NAME، مشكور إنك طرحت الموضوع، وأبي أعطيك جواب واضح مو بس أوافقك.
إحنا نفهم تماماً قد إيش مهم إن الإعلانات تتماشى مع هويتك ومع الصورة اللي تبي تظهر فيها. وبنفس الوقت شغلتنا إننا نجيب لك نتائج، فاللي نحاول نسويه دايم هو نلقى التوازن الصح بين الاثنين.
وفيه شي أبي تعرفه لأنه يغير الصورة. الإعلانات المدفوعة ما تتنشر على صفحتك. تشتغل بخلاصة الأشخاص اللي نستهدفهم وما تظهر أبداً على حسابك، فاللي يدخل صفحتك ما بيشوفها. الإعلان اللي حاسه مباشر زيادة مو حاط جنب صور مشاريعك، هو معروض لشخص غريب ما سمع فيك من قبل.
والنقطة الثانية هي الكمية. ما نقدر نعرف اللي يشتغل بثلاثة إعلانات. لازم نجرب زوايا كثيرة، نوقف اللي يفشل ونكبر اللي ينجح. وكل إعلان يترفض قبل ما تطلع له أرقام هو زاوية ما عرفنا عنها شي، فنصير نخمن بدل ما نعرف.
فاقتراحي كذا. إذا فيه إعلانات معينة تشوفها مرفوضة تماماً، قل لي وأوقفها. اللي أبي أتجنبه هو إننا نطفي إعلانات تجيب نتائج، لأن هذا يأثر على نتائجك مباشرة. وأي شي فيه معلومة غلط أو فعلاً ما يمثل هويتك، يتغير بنفس اليوم.
وإذا الإحساس البراندي يهمك، وهو لازم يهمك، الحل الصح هو خطة محتوى عضوي تمشي جنب الإعلانات. هذا مكان الأناقة. ويسعدني نتكلم عنها بشكل منفصل.
عطني رأيك، أبي أتأكد إننا متفقين على هالنقطة للمستقبل.`,
  },
  {
    id: "cant-see-ads",
    label: "They ask why they cannot see the ads on their page",
    when: "They have scrolled their own profile looking for the ads.",
    en: `Hey NAME, good question, and it catches most people out.
Paid ads don't get posted to your page. They run directly in the feed of the audience we target and never appear on your profile grid, so you can scroll your own page all day and you won't find them. That's normal, not a fault.
Two reasons it works this way. First, it lets us run 10 or 15 versions at once without spamming your followers with the same message fifteen times. Second, your followers already know you. The ads are built for people who don't, so the messaging is deliberately different from what you'd post organically.
The other difference is that the ad has one job: get someone to click through to the form or the landing page and book. It isn't there to be admired, it's there to move a stranger from scrolling to booked.
If you want to see everything that's live, log in to business.facebook.com and open Ads Manager. Every active ad is there with its performance.`,
    ar: `السلام عليكم NAME، سؤال ممتاز، وأغلب الناس تلخبط فيه.
الإعلانات المدفوعة ما تتنشر على صفحتك. تشتغل مباشرة بخلاصة الجمهور اللي نستهدفه وما تظهر أبداً على حسابك، فتقدر تتصفح صفحتك طول اليوم وما بتلقاها. وهذا شي طبيعي مو خلل.
وفيه سببين لهالطريقة. أول شي، تخلينا نشغل ١٠ أو ١٥ نسخة بنفس الوقت بدون ما نزعج متابعينك بنفس الرسالة خمستعشر مرة. وثاني شي، متابعينك أصلاً يعرفونك. الإعلانات مبنية لناس ما يعرفونك، فالرسالة فيها مختلفة عن قصد عن اللي تنشره عادي.
والفرق الثاني إن الإعلان له شغلة وحدة: يخلي الشخص يضغط ويروح للفورم أو الصفحة ويحجز. مو موجود عشان يعجب الناس، موجود عشان ينقل شخص غريب من التصفح إلى الحجز.
وإذا تبي تشوف كل اللي شغال، ادخل على business.facebook.com وافتح مدير الإعلانات. كل إعلان فعال موجود هناك مع أرقام أدائه.`,
  },
  {
    id: "idea-you-saw",
    label: "Sending them an idea you actually saw",
    when: "Any week you owe them a touchpoint and have nothing to deliver yet.",
    internal:
      "The SOP calls this the highest value message you can send, and it takes 30 seconds. It proves you are thinking about their business when you are not being paid to. Send a real thing you actually saw, never a fabricated example, and never send it as a template.",
    en: `Hey NAME, I was scrolling earlier and this came up. Have a look: [LINK]
It's not our industry, but the way they [what makes it work, e.g. show the before and after in the first two seconds] would work really well for your projects. We could do the same thing with [specific project of theirs].
Worth trying?`,
    ar: `هلا NAME، كنت أتصفح قبل شوي وطلع لي هذا. شوفه: [الرابط]
مو من مجالنا، بس طريقتهم بـ [اللي يخليه ينجح، مثلاً إنهم يعرضون قبل وبعد بأول ثانيتين] بتشتغل زين على مشاريعك. نقدر نسوي نفس الشي مع [مشروع معين لهم].
تستاهل نجربها؟`,
  },
  {
    id: "content-folder",
    label: "Keep sending us content",
    when: "Their raw folder has gone quiet and the creative is going stale.",
    en: `Hey NAME, your Drive folder is pinned at the top of the group, one for raw photos and one for raw videos. Keep uploading everything you take on site, finished projects, your team, all of it. Don't filter it, we'll do that.
The clients whose ads keep performing month after month are the ones who keep the folder full, because that's what stops the creative going stale.`,
    ar: `هلا NAME، فولدر الدرايف مثبت فوق بالقروب، واحد للصور الخام وواحد للفيديوهات. حمّل كل شي تصوره بالمواقع، المشاريع المخلصة، فريقك، كل شي. لا تفلتر، إحنا نفلتر.
العملاء اللي إعلاناتهم تستمر تشتغل شهر ورا شهر هم اللي يخلون الفولدر مليان، لأن هذا اللي يمنع المحتوى إنه يبهت.`,
  },
  {
    id: "no-show",
    label: "They did not show to the blueprint call",
    when: "Five minutes after the call was meant to start.",
    internal:
      "Three separate messages, sent in order, not one block. Then leave the call.",
    en: `Hey NAME, you still good for now?
I've been on for 5 mins. Is everything okay? You're usually super punctual on our calls
Hey NAME, hopping off now so let me know when you get this.`,
    ar: `هلا NAME، لا زلنا على الموعد؟
صار لي ٥ دقايق على المكالمة، كل شي تمام عندك؟ عادة ما تتأخر
هلا NAME، بطلع الحين، رد علي إذا وصلتك الرسالة`,
  },
];

/** Swap the SOP's NAME placeholder for the client, nothing else. */
export function fill(text: string, clientName?: string): string {
  if (!clientName) return text;
  const first = clientName.split(/\s+/)[0];
  return text.replaceAll("NAME", first);
}
