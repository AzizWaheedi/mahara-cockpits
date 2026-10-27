# Arabic for approval: the upsell studio

Every new Arabic line the upsell studio adds, beside its English, for the CEO's one-batch approval. Nothing here reaches a client until it is approved. Written 26 Oct 2026 under mahara-context's `aziz-kuwaiti-voice` (SKILL.md and references/master-context.md), fresh, never translated, and checked line by line by the client copy check (`cockpit_client_copy_problems`).

Generated from the files that hold the words, so this sheet and the build cannot drift: `supabase/migrations/20261026x_upsell_catalog_copy.sql` (sections 1 to 7), `apps/client-success-cockpit/src/present/offer/content/website.ts`, `shared.ts` and `websiteVideo.ts`, and `sites/offer/strings.js`. `scripts/offer-copy.test.ts` fails if any Arabic line in those files is missing here.

## How to approve

- Reply "approved", or give the row numbers to change and the words you want. Your words replace ours as written.
- On screen and on the page the Arabic is white Gulf: the client in the plural, no Kuwaiti-only or Saudi-only words, Arabic-Indic digits. Spoken lines in the notes are Kuwaiti or Saudi; the deck picks one by the client's country (Saudi for Saudi clients, Kuwaiti for everyone else).
- `{name}`, `{date}`, `{city}`, `{build}`, `{care}`, `{final}`, `{project}`, `{video}`, `{next}` and `{url}` are filled from the client's data.
- Lines in the notes that start with English in brackets, like (capture), tell the account manager when to say them. They are never said.

## Choices to confirm

1. **"Your account manager" in Arabic is فريق نجاح العملاء** (the client success team). The Arabic title for one person is gendered and no seat records a gender, so the CS decks already say it this way (docs/csm-decks/CONTENT-AR.md decision 8). The sales deck says مدير حسابك; say if you want that instead. For the same reason the page's "Prepared by" line is من إعداد {name}، فريق نجاح العملاء, a noun, not a verb like جهّزه that would make the account manager a man.
2. **Cameraman day uses مصور.** The voice skill says not to mention a cameraman yet. The plan (default 12) lifts that for this one offer before any Arabic is written for it. Approving this sheet is that change; the skill's line in mahara-context still needs the same edit.
3. **The proposal is عرض سعر**, never العرض alone, because العرض is the client's own offer in our decks (CONTENT-AR decision 12). The page opens with عرض سعر إلى {name}.
4. **No GEO or UGC on screen.** SEO and GEO is قوقل والبحث بالذكاء الاصطناعي; UGC is فيديوهات بمقدّم. The words GEO, UGC, VSL and "care plan" never stand alone on a client's screen.
5. **"Example, drawn for {name}" drops the name in Arabic:** مثال، رسمناه لكم. A name after لـ breaks badly when it is Latin or starts with شركة.
6. **The video's narration is the script v1** (hw-notes/upsell-studio/video/website-script.md) **with its two booking lines rewritten in both languages**, because one cut goes to every client and done-with-you clients never hear an appointment line. The gap line now says إذا بيتواصل معكم (was إذا بيحضر الموعد), and the link line says وترسلون الرابط قبل أول اجتماع (was والرابط يوصل مع تأكيد الموعد). The two English lines need voicing again; until then the English draft still says the old ones. On screen, the film says what the deck says: اللي نحتاجه منكم for what we need from you (the film still has المطلوب منكم), and مشروعكم المعتاد for your typical project, now the deck's word too. Section 12 lists every word the film puts on screen. The Arabic voice waits for the ElevenLabs plan (PLAN amendment 7).
7. **The demo firm's own site speaks to its customer in the singular** (تواصل معنا، راسلنا على الواتساب), as a real firm's site would. Everything we say to the client is plural.
8. **The example ad in the film keeps the platform's own words**, مُموَّل and معرفة المزيد, as a real feed post shows them, tagged إعلان للتوضيح. They are the only Arabic on the sheet with diacritics.

## 1 to 7. The seven offers (the catalog)

The proposal page, the Offers tab, the picker and the deck read these. `why` is the proposal's "Why this, for you": the account manager picks one and may edit it. Prices are not here: they are set on Money > Offers.

### 1. Website

| # | Where | English | Arabic |
|---|---|---|---|
| 1 | name | Website | الموقع الإلكتروني |
| 2 | deckTitle | Your website | موقعكم الإلكتروني |
| 3 | line | A site in Arabic and English with your projects, WhatsApp, an enquiry form and tracking, with care each month. | موقع بالعربي والإنجليزي، فيه مشاريعكم وزر واتساب ونموذج استفسار وتتبع، مع عناية كل شهر. |
| 4 | bill line: build | Website, in Arabic and English | الموقع، بالعربي والإنجليزي |
| 5 | bill line: care | Care plan: hosting, backups and an hour of edits a month | العناية الشهرية: استضافة، ونسخ احتياطي، وساعة تعديلات بالشهر |
| 6 | terms | The build is paid in full. The care plan comes with the site and starts the month it goes live. | البناء دفعة وحدة كاملة. والعناية الشهرية تجي مع الموقع، وتبدي من الشهر اللي ينطلق فيه. |
| 7 | timing | Live two weeks after we have your content. | ينطلق بعد أسبوعين من وصول المحتوى منكم. |
| 8 | get: pages | Up to six pages, in Arabic and English | لغاية ٦ صفحات، بالعربي والإنجليزي |
| 9 | get: portfolio | Your projects, each shown properly with its photos | مشاريعكم معروضة صح، كل مشروع بصوره |
| 10 | get: whatsapp | A WhatsApp button, one tap from any page | زر واتساب، بضغطة من أي صفحة |
| 11 | get: form | An enquiry form that comes straight to you | نموذج استفسار يوصلكم مباشرة |
| 12 | get: tracking | Tracking tied to your ads, so we can see what the site does for them | تتبع مربوط بإعلاناتكم، عشان نشوف أثر الموقع عليها |
| 13 | get: care | Care each month: hosting, backups and an hour of edits | عناية كل شهر: استضافة، ونسخ احتياطي، وساعة تعديلات |
| 14 | need: logo | Your logo | شعاركم |
| 15 | need: photos | Photos of your projects | صور مشاريعكم |
| 16 | need: services | Your list of services | قائمة خدماتكم |
| 17 | steps: content | You send your logo, project photos and list of services. | ترسلون لنا الشعار وصور المشاريع وقائمة الخدمات. |
| 18 | steps: build | We build the site in Arabic and English and show you the draft. | نبني الموقع بالعربي والإنجليزي، ونوريكم المسودة. |
| 19 | steps: live | Two weeks after we have your content, it goes live. | بعد أسبوعين من وصول المحتوى، ينطلق الموقع. |
| 20 | steps: care | From then on, the care plan keeps it hosted, backed up and up to date. | وبعدها العناية الشهرية تخليه مستضاف ومحفوظ ومحدّث. |
| 21 | why: no_site (label) | No site comes up | ما يطلع لكم موقع |
| 22 | why: no_site | When someone sees your ad, they look up your name before they get in touch. Right now there's no site for them to find, so they don't see your work. | اللي يشوف إعلانكم يدور على اسمكم قبل لا يتواصل معكم. والحين ما فيه موقع يلقاه، فما يشوف شغلكم. |
| 23 | why: broken (label) | The site doesn't open | الموقع ما يفتح |
| 24 | why: broken | The address we have for your site doesn't open a working page today. Anyone who looks you up between the ad and the first meeting lands on that page. | الرابط اللي عندنا لموقعكم ما يفتح صفحة شغالة اليوم. وأي أحد يدور عليكم بين الإعلان وأول اجتماع، يوصل لهذي الصفحة. |
| 25 | why: thin (label) | The site doesn't show your work | الموقع ما يعرض شغلكم |
| 26 | why: thin | Your site is up, but it doesn't show your projects the way your ads do. Someone who liked the ad looks you up expecting to see more of the same. | موقعكم شغال، بس ما يعرض مشاريعكم مثل ما تعرضها إعلاناتكم. واللي عجبه الإعلان يدور عليكم ويتوقع يشوف نفس المستوى. |
| 27 | button | Yes, let's start | خلونا نبدي |
| 28 | cta | Yes, let's start the website. | تمام، خلونا نبدي بالموقع. |
| 29 | close | Want me to start it this week? | نبدي فيه هالأسبوع؟ |

### 2. Second campaign

| # | Where | English | Arabic |
|---|---|---|---|
| 30 | name | Second campaign | حملة ثانية |
| 31 | deckTitle | Your second campaign | حملتكم الثانية |
| 32 | line | A full campaign for a second service you offer, with its own ads, form and words. | حملة كاملة لخدمة ثانية عندكم، بإعلاناتها ونموذجها وكلامها. |
| 33 | bill line: monthly | Second campaign: its own ads, form and words | الحملة الثانية: إعلاناتها ونموذجها وكلامها |
| 34 | terms | Monthly, on top of your current plan. | شهرياً، فوق باقتكم الحالية. |
| 35 | timing | Starts once you approve its ads and form. | تنطلق أول ما توافقون على إعلاناتها ونموذجها. |
| 36 | get: ads | Its own ads, made for the second service | إعلانات خاصة فيها، مصممة للخدمة الثانية |
| 37 | get: form | Its own enquiry form and questions | نموذج استفسار وأسئلة خاصة فيها |
| 38 | get: words | Words written for that service | كلام مكتوب لهذي الخدمة بالذات |
| 39 | get: same | Everything your first campaign already has | كل اللي موجود بحملتكم الأولى |
| 40 | need: amount | A daily amount for the new service's ads, paid to Meta from your card | مبلغ يومي لإعلانات الخدمة الجديدة، تدفعونه لميتا من بطاقتكم |
| 41 | need: photos | Photos of the service you want to grow | صور من الخدمة اللي تبون تكبرونها |
| 42 | steps: agree | We agree the second service and how to present it. | نتفق معكم على الخدمة الثانية وطريقة عرضها. |
| 43 | steps: make | We write its words and make its ads and form. | نكتب كلامها، ونسوي إعلاناتها ونموذجها. |
| 44 | steps: approve | You approve them, and it runs beside your first campaign. | توافقون عليها، وتمشي جنب حملتكم الأولى. |
| 45 | why: listed (label) | You listed this service | الخدمة مذكورة عندكم |
| 46 | why: listed | You told us at onboarding that you offer more than the service we advertise. Right now none of your ads talk about the others. | ذكرتوا لنا بنموذج التعريف إن عندكم خدمات غير اللي نعلن عنها. والحين ولا إعلان من إعلاناتكم يتكلم عنها. |
| 47 | why: site (label) | It's on your site | موجودة بموقعكم |
| 48 | why: site | Your own site lists a service we don't advertise for you yet. People looking for that service don't see it in your ads. | موقعكم نفسه فيه خدمة ما نعلن عنها للحين. واللي يدور على هذي الخدمة ما يشوفها بإعلاناتكم. |
| 49 | why: asked (label) | You asked about it | سألتوا عنها |
| 50 | why: asked | You asked about advertising another service. This runs it as its own campaign, with its own ads, form and words. | سألتوا عن إعلانات لخدمة ثانية. وهذي تمشيها كحملة مستقلة، بإعلاناتها ونموذجها وكلامها. |
| 51 | button | Yes, let's set it up | خلونا نجهزها |
| 52 | cta | Yes, let's set up the second campaign. | تمام، خلونا نجهز الحملة الثانية. |
| 53 | close | Want me to set it up? | نجهزها لكم؟ |

### 3. SEO and GEO

| # | Where | English | Arabic |
|---|---|---|---|
| 54 | name | Google and AI search | قوقل والبحث بالذكاء الاصطناعي |
| 55 | deckTitle | Google and AI answers | قوقل وإجابات الذكاء الاصطناعي |
| 56 | line | Your site, Google profile and listings set up for search, and pages written for AI answers to quote, over 90 days. | نجهز موقعكم وملفكم على قوقل وقوائمكم للبحث، ونكتب صفحات تقدر إجابات الذكاء الاصطناعي تقتبس منها، لمدة ٩٠ يوم. |
| 57 | bill line: program | Google and AI search, 90 days | قوقل والبحث بالذكاء الاصطناعي، لمدة ٩٠ يوم |
| 58 | terms | One price for the 90 days. The pages, profile and listings stay yours afterwards. If we build you a site, its monthly care starts on day 91. | سعر واحد لمدة ٩٠ يوم. والصفحات والملف والقوائم تبقى لكم بعدها. وإذا بنينا لكم موقع، تبدي عنايته الشهرية من اليوم ٩١. |
| 59 | timing | Runs 90 days from payment. | يمشي ٩٠ يوم من الدفع. |
| 60 | get: onpage | Your site's pages set up for search | صفحات موقعكم مجهزة للبحث |
| 61 | get: profile | Your Google Business Profile, set up and kept current | ملف نشاطكم على قوقل، مجهز ومحدّث |
| 62 | get: citations | Your firm listed in the directories Google reads | شركتكم مسجلة بالأدلة اللي يقرأ منها قوقل |
| 63 | get: schema | Structured data, so search engines read your services correctly | بيانات منظمة، عشان محركات البحث تقرأ خدماتكم صح |
| 64 | get: pages | Service and FAQ pages written so AI answers can quote them | صفحات للخدمات والأسئلة الشائعة، مكتوبة بطريقة تقدر إجابات الذكاء الاصطناعي تقتبس منها |
| 65 | get: report | A monthly report on where you show in Google and in AI answers | تقرير شهري: وين تطلعون في قوقل وفي إجابات الذكاء الاصطناعي |
| 66 | get: site | If you have no site, we build one into it | وإذا ما عندكم موقع، نبنيه لكم ضمنها |
| 67 | need: site | Access to your site | صلاحية الدخول لموقعكم |
| 68 | need: profile | Access to your Google profile | صلاحية الدخول لملفكم على قوقل |
| 69 | steps: check | We check where you show today, searched from your city. | نشوف وين تطلعون اليوم، بالبحث من مدينتكم. |
| 70 | steps: fix | We set up your site's pages, your Google profile and your listings. | نجهز صفحات موقعكم، وملفكم على قوقل، وقوائمكم. |
| 71 | steps: write | We write service and FAQ pages for AI answers to quote. | نكتب صفحات الخدمات والأسئلة الشائعة، عشان تقتبس منها إجابات الذكاء الاصطناعي. |
| 72 | steps: report | Each month, you get a report on where you show. | كل شهر يوصلكم تقرير: وين تطلعون. |
| 73 | steps: keep | After 90 days, everything we built stays yours. | وبعد ٩٠ يوم، كل اللي بنيناه يبقى لكم. |
| 74 | why: not_found (label) | You don't come up for your service | ما تطلعون لما أحد يدور على خدمتكم |
| 75 | why: not_found | We searched for your service in your city and didn't find you. Most people who need a firm like yours search for the service, not your name. | دورنا على خدمتكم في مدينتكم وما لقيناكم. وأغلب اللي يحتاجون شركة مثلكم يدورون على الخدمة، مو على اسمكم. |
| 76 | why: ai_answer (label) | AI answers don't mention you | إجابات الذكاء الاصطناعي ما تذكركم |
| 77 | why: ai_answer | We asked an AI assistant for firms like yours in your city, and you weren't in its answer. Google now shows its own AI answer above the links, in Arabic too. | سألنا مساعد ذكاء اصطناعي عن شركات مثلكم في مدينتكم، وما كنتوا بإجابته. وقوقل صار يعرض إجابته بالذكاء الاصطناعي فوق الروابط، وبالعربي بعد. |
| 78 | why: name_only (label) | You come up only for your name | تطلعون باسمكم بس |
| 79 | why: name_only | Your own name comes up, which is good. But people search your name once they already know you. Everyone else searches for what you do. | اسمكم يطلع، وهذا زين. بس الناس تدور باسمكم إذا كانوا يعرفونكم أصلاً. والباقي يدورون على الخدمة نفسها. |
| 80 | button | Yes, let's start | خلونا نبدي |
| 81 | cta | Yes, let's start on Google and AI search. | تمام، خلونا نبدي بشغل قوقل والذكاء الاصطناعي. |
| 82 | close | Shall we start it this month? | نبدي فيه هالشهر؟ |

### 4. Social media

| # | Where | English | Arabic |
|---|---|---|---|
| 83 | name | Social media | السوشال ميديا |
| 84 | deckTitle | Your social pages | صفحاتكم على السوشال ميديا |
| 85 | line | We run your pages from the footage you already send us: 20+ posts a month, 5 to 6 graphics a week and weekly stories. | ندير صفحاتكم من المواد اللي ترسلونها لنا أصلاً: أكثر من ٢٠ بوست بالشهر، و٥ إلى ٦ تصاميم بالأسبوع، وستوريات كل أسبوع. |
| 86 | bill line: monthly | Social media: posts, graphics and stories each month | السوشال ميديا: بوستات وتصاميم وستوريات كل شهر |
| 87 | terms | Monthly. Reels come only when you send footage for them. | شهرياً. والريلز تكون بس لما ترسلون لها مواد. |
| 88 | timing | Starts once we agree your first month's calendar with you. | تبدي أول ما نتفق معكم على جدول أول شهر. |
| 89 | get: posts | 20+ posts a month on your pages | أكثر من ٢٠ بوست بالشهر على صفحاتكم |
| 90 | get: graphics | 5 to 6 graphics a week, made from your project photos | ٥ إلى ٦ تصاميم بالأسبوع، من صور مشاريعكم |
| 91 | get: stories | Stories every week | ستوريات كل أسبوع |
| 92 | get: call | A monthly call and report | مكالمة وتقرير كل شهر |
| 93 | get: reels | Reels when you send footage for them: a bonus, never a promise | ريلز لما ترسلون لها مواد، زيادة منا وما نوعد فيها |
| 94 | need: footage | The footage you already send us for the ads | نفس المواد اللي ترسلونها لنا للإعلانات |
| 95 | steps: agree | We agree the look and your first month's calendar. | نتفق معكم على الشكل وجدول أول شهر. |
| 96 | steps: post | We post from the footage you already send us. | ننشر من المواد اللي ترسلونها لنا أصلاً. |
| 97 | steps: review | Each month, we go over it with you on a call, with a report. | وكل شهر نراجعها معكم بمكالمة، مع تقرير. |
| 98 | why: quiet (label) | Your page has gone quiet | صفحتكم هادية |
| 99 | why: quiet | Anyone who sees your ad can tap your page name and land on your page. Right now there isn't much there, while the footage you send us for the ads is good. | أي أحد يشوف إعلانكم يقدر يضغط على اسم صفحتكم ويوصل لها. والحين ما فيها شي كثير، مع إن المواد اللي ترسلونها لنا للإعلانات حلوة. |
| 100 | why: nobody (label) | Nobody runs your page | ما أحد يدير صفحتكم |
| 101 | why: nobody | You told us nobody handles your Instagram right now. We already have your footage for the ads, so the same material can work on your page too. | قلتوا لنا إن ما أحد يدير الإنستقرام عندكم حالياً. وموادكم عندنا أصلاً للإعلانات، فنفس المواد تقدر تشتغل على صفحتكم بعد. |
| 102 | why: footage (label) | Good footage, used once | مواد حلوة تنستخدم مرة وحدة |
| 103 | why: footage | The footage you send us is working in your ads and sitting unused on your page. Running your pages puts it to work in both places. | المواد اللي ترسلونها لنا شغالة بإعلاناتكم، وواقفة بصفحتكم. ولما ندير صفحاتكم، تشتغل بالمكانين. |
| 104 | button | Yes, let's start | خلونا نبدي |
| 105 | cta | Yes, let's start on our social pages. | تمام، خلونا نبدي بصفحاتنا على السوشال ميديا. |
| 106 | close | Shall we start on the 1st? | نبدي من أول الشهر؟ |
| 107 | platform: instagram | Instagram | إنستقرام |
| 108 | platform: tiktok | TikTok | تيك توك |
| 109 | platform: snapchat | Snapchat | سناب شات |
| 110 | platform: facebook | Facebook | فيسبوك |

### 5. Cameraman day

| # | Where | English | Arabic |
|---|---|---|---|
| 111 | name | Cameraman day | يوم تصوير |
| 112 | deckTitle | A day of filming | يوم تصوير |
| 113 | line | A cameraman on site for a full day: finished work, work in progress and your team. The footage is yours. | مصور بموقعكم يوم كامل: مشاريع منتهية، وشغل قيد التنفيذ، وفريقكم. والمواد تبقى لكم. |
| 114 | bill line: day | A cameraman on site for one day | مصور بالموقع ليوم واحد |
| 115 | terms | Paid in full, per day. | دفعة وحدة كاملة، باليوم. |
| 116 | timing | We book the day once you pick the site and the date. | نحجز اليوم أول ما تختارون الموقع والتاريخ. |
| 117 | get: site | A full day at a project, your office, or both | يوم كامل بمشروع، أو بمكتبكم، أو الاثنين |
| 118 | get: work | Finished projects and work in progress | مشاريع منتهية، وشغل قيد التنفيذ |
| 119 | get: team | Your team at work | فريقكم وهو يشتغل |
| 120 | get: owner | You on camera, only if you want to be | وأنتم قدام الكاميرا، بس إذا تبون |
| 121 | get: footage | All the footage, yours to keep | كل المواد تبقى لكم |
| 122 | get: aim | The aim is about three months of ads and posts from one day | الهدف: مواد تكفي إعلانات وبوستات لحوالي ٣ شهور من يوم واحد |
| 123 | need: site | A site worth filming | مشروع يستاهل التصوير |
| 124 | need: date | A date that suits you | تاريخ يناسبكم |
| 125 | steps: pick | You pick the site and the date. | تختارون الموقع والتاريخ. |
| 126 | steps: film | We send a cameraman for the day. | نرسل لكم مصور يوم كامل. |
| 127 | steps: use | The footage goes into your ads and posts over the months after. | والمواد تدخل بإعلاناتكم وبوستاتكم بالشهور اللي بعدها. |
| 128 | why: no_time (label) | No time to film | ما عندكم وقت تصورون |
| 129 | why: no_time | You told us there's no time to film, and that's true for most owners we work with. One day on site gives us material without asking you for footage every week. | قلتوا لنا إن ما عندكم وقت تصورون، وهذا حال أغلب أصحاب الشركات اللي نشتغل معهم. ويوم واحد بالموقع يعطينا مواد بدال ما نطلب منكم كل أسبوع. |
| 130 | why: fresh (label) | Your newest ad has been running a while | أحدث إعلان صار له فترة |
| 131 | why: fresh | Your newest ad has been running for a while. One day of filming gives us a stock of fresh footage for the ones after it. | أحدث إعلان عندكم صار له فترة شغال. ويوم تصوير واحد يعطينا مخزون مواد جديدة للإعلانات اللي بعده. |
| 132 | button | Yes, let's book the day | خلونا نحجز اليوم |
| 133 | cta | Yes, let's book a day of filming. | تمام، خلونا نحجز يوم تصوير. |
| 134 | close | Which site would be worth filming? | أي موقع يستاهل نصوره؟ |

### 6. UGC

| # | Where | English | Arabic |
|---|---|---|---|
| 135 | name | Presenter videos | فيديوهات بمقدّم |
| 136 | deckTitle | Videos with a presenter | فيديوهات بمقدّم يعرّف بشركتكم |
| 137 | line | Eight videos with a presenter speaking your dialect: five ads and three longer videos you keep. | ٨ فيديوهات بمقدّم يتكلم بلهجتكم: ٥ إعلانات، و٣ فيديوهات أطول تبقى لكم. |
| 138 | bill line: package | Eight videos with a presenter | ٨ فيديوهات بمقدّم |
| 139 | terms | One time, paid in full. | دفعة وحدة كاملة. |
| 140 | timing | We agree the dates once you approve the script. | نتفق على التواريخ أول ما توافقون على السكربت. |
| 141 | get: ads | Five ads with a presenter | ٥ إعلانات بمقدّم |
| 142 | get: main | One longer video that explains your offer from start to finish | فيديو أطول يشرح عرضكم من البداية للنهاية |
| 143 | get: followups | Two follow-up videos to send people after they enquire | فيديوين متابعة ترسلونهم للناس بعد ما يستفسرون |
| 144 | get: script | Scripts we write in your positioning | سكربتات نكتبها بأسلوبكم وعرضكم |
| 145 | get: presenter | A presenter in your dialect, presenting your firm, never posing as the owner | مقدّم يتكلم بلهجتكم ويقدم شركتكم، وما يمثل إنه صاحب الشركة |
| 146 | get: keep | The three longer videos are yours to keep | الثلاث فيديوهات الأطول تبقى لكم |
| 147 | need: call | One call to agree the script | مكالمة وحدة نتفق فيها على السكربت |
| 148 | steps: script | One call to agree the script. | مكالمة وحدة نتفق فيها على السكربت. |
| 149 | steps: film | We cast a presenter in your dialect and film. | نختار مقدّم بلهجتكم، ونصور. |
| 150 | steps: review | You review the eight videos. | تراجعون الفيديوهات الثمانية. |
| 151 | steps: use | The five ads run in your campaign. The three longer videos are yours to send. | الإعلانات الخمسة تمشي بحملتكم، والفيديوهات الثلاثة الأطول ترسلونها أنتم. |
| 152 | why: camera (label) | You'd rather not be on camera | ما تبون تطلعون قدام الكاميرا |
| 153 | why: camera | You told us you'd rather not be on camera, and plenty of owners feel the same. A presenter puts a person in front of your customers without it being you. | قلتوا لنا إنكم ما تبون تطلعون قدام الكاميرا، وكثير من أصحاب الشركات نفسكم. والمقدّم يحط شخص قدام عملائكم، من غير ما يكون أنتم. |
| 154 | why: face (label) | A face for the brand | وجه للشركة |
| 155 | why: face | Everything we run for you shows the work. These add a person who speaks for your firm in your dialect, so the brand has a face and a voice. | كل اللي نشغله لكم الحين يعرض الشغل. وهذي الفيديوهات تضيف شخص يتكلم عن شركتكم بلهجتكم، عشان يصير لشركتكم وجه وصوت. |
| 156 | why: explain (label) | Explaining the same basics | تشرحون نفس الأساسيات |
| 157 | why: explain | Your team explains the basics in every first meeting. The longer videos do that before the meeting, so the first conversation starts on the project. | فريقكم يشرح الأساسيات بكل اجتماع أول. والفيديوهات الأطول تشرحها قبل الاجتماع، فأول محادثة تبدي من المشروع نفسه. |
| 158 | button | Yes, let's start | خلونا نبدي |
| 159 | cta | Yes, let's start the presenter videos. | تمام، خلونا نبدي بفيديوهات المقدّم. |
| 160 | close | Want to test it? | تبون نختبرها؟ |

### 7. Closer placement

| # | Where | English | Arabic |
|---|---|---|---|
| 161 | name | Closer placement | توظيف مندوب مبيعات |
| 162 | deckTitle | A closer for your team | مندوب مبيعات لفريقكم |
| 163 | line | We recruit, train and manage a salesperson for your firm, working in your own tools. | نوظف لكم مندوب مبيعات وندربه وندير أداءه، ويشتغل على أدواتكم أنتم. |
| 164 | bill line: placement | Recruiting and training your closer | توظيف المندوب وتدريبه |
| 165 | bill line: management | Monthly management, call reviews and coaching | إدارة شهرية، ومراجعة المكالمات، والتدريب |
| 166 | terms | Placement paid in full, then monthly, three months minimum. If the hire doesn't work out within 90 days, we recruit a replacement at no cost. | التوظيف دفعة وحدة كاملة، وبعدها شهرياً، وأقل مدة ٣ شهور. وإذا المندوب ما ناسب خلال ٩٠ يوم، نوظف بديل بدون تكلفة. |
| 167 | timing | We start the search after payment. Month one is training and ramp-up. | نبدي البحث بعد الدفع. وأول شهر للتدريب والتجهيز. |
| 168 | get: recruit | We recruit a salesperson for you | نوظف لكم مندوب مبيعات |
| 169 | get: train | Trained on the framework our own team uses | ندربه على نفس الإطار اللي يشتغل عليه فريقنا |
| 170 | get: scripts | Scripts written for your services | سكربتات مكتوبة لخدماتكم |
| 171 | get: month_one | We run them through the first month with you | نمشيه معكم أول شهر |
| 172 | get: manage | Then monthly management, call reviews and coaching | وبعدها إدارة شهرية، ومراجعة المكالمات، والتدريب |
| 173 | get: tools | They work in your tools and on your phone line | يشتغل على أدواتكم وعلى خط التلفون عندكم |
| 174 | need: seat | A desk for them | مكان يشتغل فيه |
| 175 | need: phone | A phone line | خط تلفون |
| 176 | need: prices | Your price list | قائمة أسعاركم |
| 177 | steps: agree | We agree the role and the pay with you. | نتفق معكم على الدور والراتب. |
| 178 | steps: recruit | We recruit and interview. | نبحث ونسوي المقابلات. |
| 179 | steps: train | We train them and write the scripts. | ندربه ونكتب له السكربتات. |
| 180 | steps: month_one | Month one, we run them with you. | أول شهر، نمشيه معكم. |
| 181 | steps: manage | Then monthly reviews and coaching. | وبعدها مراجعة وتدريب كل شهر. |
| 182 | why: waiting (label) | Quotations waiting on a decision | عروض أسعار تنتظر قرار |
| 183 | why: waiting | Your quotations are waiting longer than your usual decision time. A closer's whole job is following them through. | عروض الأسعار عندكم تنتظر أطول من الوقت اللي تاخذه قراراتكم عادةً. وشغل المندوب كله إنه يتابعها لآخرها. |
| 184 | why: hours (label) | Your hours on sales | ساعاتكم على المبيعات |
| 185 | why: hours | You take every sales call yourself, and you're good at it. A closer takes the first calls, so your hours go back to the projects only you can win. | أنتم تاخذون كل مكالمة مبيعات بنفسكم، وأنتم زينين فيها. والمندوب ياخذ المكالمات الأولى، فترجع ساعاتكم للمشاريع اللي ما يقدر يفوز فيها غيركم. |
| 186 | why: nobody (label) | Nobody sells full time | ما أحد متفرغ للمبيعات |
| 187 | why: nobody | Right now sales sits with the owner or an engineer, on top of their real job. A closer does it as their only job. | المبيعات الحين عند صاحب الشركة أو مهندس، فوق شغله الأساسي. والمندوب يسويها كشغله الوحيد. |
| 188 | button | Yes, let's start the search | خلونا نبدي البحث |
| 189 | cta | Yes, let's start the search for a closer. | تمام، خلونا نبدي البحث عن مندوب مبيعات. |
| 190 | close | Shall we start the search this week? | نبدي البحث هالأسبوع؟ |

## 8. The website deck, on screen

White Gulf Arabic. Titles, one line per press, and the lines a client's data picks.

| # | Where | English | Arabic |
|---|---|---|---|
| 191 | deck name | Website | الموقع |
| 192 | browser tab | {name}: your website | {name}: موقعكم |
| 193 | saw: title | What we saw | اللي شفناه |
| 194 | saw: capture | We looked you up the way a customer would | دورنا عليكم مثل ما يدور العميل |
| 195 | saw: cloud | What a customer finds today | اللي يلقاه العميل اليوم |
| 196 | saw: ask | Do you have a site? | عندكم موقع؟ |
| 197 | saw: cloud_none | No site of yours comes up | ما يطلع لكم موقع |
| 198 | saw: cloud_broken | The page doesn't open | الصفحة ما تفتح |
| 199 | saw: cloud_thin | Your projects don't show here | مشاريعكم ما تبين هنا |
| 200 | saw: ask_site | Is this the site you send customers to? | هذا الموقع اللي ترسلونه لعملائكم؟ |
| 201 | matters: title | Why it matters for you | ليش يهمكم هذا |
| 202 | matters: words | In your words | بكلامكم |
| 203 | matters: tie | A customer who sees your ad looks you up before they call | العميل اللي يشوف إعلانكم يدور عليكم قبل لا يتواصل معكم |
| 204 | matters: goal90 | Your goal for 90 days | هدفكم خلال ٩٠ يوم |
| 205 | matters: goal12_24 | Your goal for the next 1 to 2 years | هدفكم خلال سنة إلى سنتين |
| 206 | matters: challenges | What's in the way | اللي واقف بطريقكم |
| 207 | matters: why | Why you joined us | ليش بديتوا معنا |
| 208 | matters: typed | What you told us | اللي قلتوه لنا |
| 209 | matters: words_empty | What would you want a customer to see before they call you? | أي شي تبون العميل يشوفه قبل لا يتواصل معكم؟ |
| 210 | get: title | What you get | اللي نبنيه لكم |
| 211 | get: drawn | A first sketch, with your logo and your projects | تصور أولي، بشعاركم ومشاريعكم |
| 212 | get: pages | Up to six pages, Arabic and English | لغاية ٦ صفحات، بالعربي والإنجليزي |
| 213 | get: portfolio | Your projects, each with its photos | مشاريعكم، كل مشروع بصوره |
| 214 | get: whatsapp | WhatsApp, one tap from any page | واتساب، بضغطة من أي صفحة |
| 215 | get: form | An enquiry form, straight to you | نموذج استفسار يوصلكم مباشرة |
| 216 | get: tracking | Tracking, tied to your ads | تتبع مربوط بإعلاناتكم |
| 217 | get: care | Care: hosting, backups, an hour of edits a month | العناية: استضافة، ونسخ احتياطي، وساعة تعديلات بالشهر |
| 218 | get: need | What we need from you | اللي نحتاجه منكم |
| 219 | get: drawn_plain | A first sketch, drawn for you | تصور أولي، رسمناه لكم |
| 220 | get: sketch_home | Home | الرئيسية |
| 221 | get: sketch_projects | Projects | المشاريع |
| 222 | get: sketch_services | Services | الخدمات |
| 223 | get: sketch_about | About | من نحن |
| 224 | get: sketch_contact | Contact | تواصل معنا |
| 225 | get: sketch_whatsapp | Message us on WhatsApp | راسلنا على الواتساب |
| 226 | get: sketch_enquire | Send an enquiry | أرسل استفسارك |
| 227 | investment: title | The investment | الاستثمار |
| 228 | investment: bill | Built once, then cared for monthly | بناء مرة وحدة، وعناية شهرية |
| 229 | investment: beside | Next to one of your projects | جنب واحد من مشاريعكم |
| 230 | investment: ask | How many projects would pay for this? | كم مشروع يغطي هذا؟ |
| 231 | investment: first_year | The build, plus 12 months of care | البناء، مع ١٢ شهر عناية |
| 232 | investment: project_ask | What's a typical project worth to you? | كم قيمة المشروع المعتاد عندكم؟ |
| 233 | next: title | Next step | الخطوة الجاية |
| 234 | next: commit | Counted from your payment and your content | ينحسب من الدفع ووصول المحتوى منكم |
| 235 | next: close | Want me to start it this week? | نبدي فيه هالأسبوع؟ |
| 236 | next: plan | A plan for the work, not a promise of results | خطة للشغل، مو وعد بنتائج |
| 237 | runs: title | How it runs | كيف يمشي الشغل |
| 238 | runs: steps | From your payment to a live site | من الدفع إلى إطلاق الموقع |
| 239 | runs: us | Our team | فريقنا |
| 240 | runs: you | You | أنتم |
| 241 | proof: title | Firms we work with | شركات نشتغل معها |
| 242 | proof: quote | In their own words | بكلامهم |
| 243 | video: title | The website, in one minute | الموقع بدقيقة وحدة |
| 244 | video: play | Watch | شوفوا |

## 9. Words every offer deck shares

| # | Where | English | Arabic |
|---|---|---|---|
| 245 | revA | Rev A | Rev A |
| 246 | revB | Rev B | Rev B |
| 247 | captured | Captured {date} | لقطة بتاريخ {date} |
| 248 | searchedAs | searched as {city} | البحث من {city} |
| 249 | example | Example, drawn for {name} | مثال، رسمناه لكم |
| 250 | yourFigure | Your figure | رقمكم |
| 251 | fromAnswer | Your answer, {date} | من جوابكم، {date} |
| 252 | fromSheet | From your sheet | من جدول المتابعة |
| 253 | item | Item | البند |
| 254 | description | Description | الوصف |
| 255 | terms | Terms | الدفع |
| 256 | dollars | Dollars | دولار |
| 257 | paidInFull | Paid in full. | دفعة وحدة كاملة. |
| 258 | typicalProject | Your typical project | مشروعكم المعتاد |
| 259 | thisFirstYear | This, first year | هذا، أول سنة |
| 260 | howMany | How many projects would pay for this? | كم مشروع يغطي هذا؟ |
| 261 | weNeed | What we need from you | اللي نحتاجه منكم |
| 262 | commitTitle | What we commit to | اللي نلتزم فيه |
| 263 | fromMainProgramme | From our main programme | من برنامجنا الأساسي |
| 264 | oneTime | One time | دفعة وحدة |
| 265 | monthly | Monthly | شهرياً |
| 266 | perDay | Per day | باليوم |
| 267 | per90 | For 90 days | لمدة ٩٠ يوم |

## 10. The website talk track (notes window only)

What the account manager says, slide by slide, then the three answers to the first question, the three objections and the price steps. Kuwaiti and Saudi are the same moments, each in its own words.

### Slide: What we saw

**English**

268. (capture) Quick thing before we get into the numbers.
269. (capture) I looked you up earlier, the way a customer would after seeing your ad.
270. (cloud) This is what came up.
271. (ask) Do you have a site?
272. (Then stop talking. Don't fill the silence. Their answer picks the branch below.)

**Kuwaiti**

273. (capture) شي بسيط قبل ما ندخل بالأرقام.
274. (capture) دورت عليكم قبل شوي، مثل ما يدور أي عميل بعد ما يشوف إعلانكم.
275. (cloud) وهذا اللي طلع لي.
276. (ask) عندكم موقع؟

**Saudi**

277. (capture) شي بسيط قبل ما ندخل في الأرقام.
278. (capture) دورت عليكم قبل شوي، مثل ما يدور أي عميل بعد ما يشوف إعلانكم.
279. (cloud) وهذا اللي طلع لي.
280. (ask) عندكم موقع؟

### Slide: Why it matters for you

**English**

281. (words) This is what you told us when we started.
282. (Read their words back exactly as they wrote them, then pause.)
283. (tie) Here's why the site matters right now.
284. Everyone who sees your ad looks you up first.
285. What they find in the next thirty seconds decides whether they get in touch, or quietly go cold.
286. (No site) Right now they find nothing.
287. (Site that doesn't open) Right now they find the page we just opened.
288. (Thin site) Right now they find a site that doesn't show your work.
289. (If they doubt it, give one fact from the list below with its source. Facts stay in the notes, never on the screen.)

**Kuwaiti**

290. (words) هذا اللي قلتوه لنا لما بدينا الشغل.
291. (tie) وليش الموقع مهم الحين.
292. أي أحد يشوف إعلانكم، أول شي يسويه يدور عليكم.
293. واللي يلقاه بأول ثلاثين ثانية، هو اللي يقرر إذا بيتواصل معكم ولا بيختفي بهدوء.
294. (No site) والحين ما يلقى شي.
295. (Site that doesn't open) والحين يلقى الصفحة اللي فتحناها قبل شوي.
296. (Thin site) والحين يلقى موقع ما يوري شغلكم.

**Saudi**

297. (words) هذا اللي قلتوه لنا لما بدينا الشغل.
298. (tie) وليش الموقع مهم الحين.
299. أي أحد يشوف إعلانكم، أول شي يسويه يدور عليكم.
300. واللي يلقاه في أول ثلاثين ثانية، هو اللي يحدد إذا بيتواصل معكم ولا بيختفي بهدوء.
301. (No site) والحين ما يلقى شي.
302. (Site that doesn't open) والحين يلقى الصفحة اللي فتحناها قبل شوي.
303. (Thin site) والحين يلقى موقع ما يعرض شغلكم.

### Slide: What you get

**English**

304. (drawn) This is a first sketch, drawn for you with your logo and your own project photos.
305. (drawn, no logo or no photos on file) This is a first sketch, drawn for you.
306. (One press, one part. Point at each one on the sketch.)
307. (pages) Up to six pages, in Arabic and English.
308. (portfolio) Your projects, shown properly, each with its own photos.
309. (whatsapp) A WhatsApp button, so they reach you from any page.
310. (form) An enquiry form that comes straight to you.
311. (tracking) And tracking, so we can see exactly what the site does for your ads.
312. (care) Then the care plan: hosting, backups and an hour of edits a month.
313. (need) From you, three things: your logo, photos of your projects and your list of services.

**Kuwaiti**

314. (drawn) هذا تصور أولي، رسمناه لكم بشعاركم وصور مشاريعكم.
315. (drawn, no logo or no photos on file) هذا تصور أولي، رسمناه لكم.
316. (pages) لين ست صفحات، بالعربي والإنجليزي.
317. (portfolio) ومشاريعكم معروضة صح، كل مشروع بصوره.
318. (whatsapp) وزر واتساب، يوصلون لكم منه من أي صفحة.
319. (form) ونموذج استفسار يوصلكم على طول.
320. (tracking) وتتبع، نشوف منه بالضبط شنو يسوي الموقع للإعلانات.
321. (care) وبعدها العناية الشهرية: استضافة، ونسخ احتياطي، وساعة تعديلات بالشهر.
322. (need) ومنكم ثلاث أشياء بس: الشعار، وصور المشاريع، وقائمة الخدمات.

**Saudi**

323. (drawn) هذا تصور أولي، رسمناه لكم بشعاركم وصور مشاريعكم.
324. (drawn, no logo or no photos on file) هذا تصور أولي، رسمناه لكم.
325. (pages) لين ست صفحات، بالعربي والإنجليزي.
326. (portfolio) ومشاريعكم معروضة صح، كل مشروع بصوره.
327. (whatsapp) وزر واتساب، يوصلون لكم منه من أي صفحة.
328. (form) ونموذج استفسار يوصلكم على طول.
329. (tracking) وتتبع، نشوف منه بالضبط وش يسوي الموقع للإعلانات.
330. (care) وبعدها العناية الشهرية: استضافة، ونسخ احتياطي، وساعة تعديلات في الشهر.
331. (need) ومنكم ثلاث أشياء بس: الشعار، وصور المشاريع، وقائمة الخدمات.

### Slide: The investment

**English**

332. (bill) It's {build} to build it, then {care} a month for hosting, backups and your edits.
333. (bill) Paid in full, and it goes live two weeks after we have your content.
334. (beside, from your answer) You told us a typical project is worth about {project}.
335. (beside, from your sheet) Going by your sheet, your signed projects come to about {project} each.
336. (beside, no figure on file) What's a typical project worth to you?
337. (Type their answer in live. It shows as Your figure.)
338. (ask) How many projects would pay for this?
339. (Then stop. Let them work it out. Don't do the maths for them, and don't name a lower number here.)

**Kuwaiti**

340. (bill) تكلفة البناء {build}، وبعدها {care} بالشهر للاستضافة والنسخ الاحتياطي والتعديلات.
341. (bill) دفعة وحدة كاملة، وينطلق بعد أسبوعين من ما يوصلنا المحتوى منكم.
342. (beside, from your answer) قلتوا لنا إن المشروع المعتاد عندكم قيمته تقريباً {project}.
343. (beside, from your sheet) حسب جدول المتابعة، المشاريع اللي وقعتوها قيمتها تقريباً {project} للمشروع.
344. (beside, no figure on file) كم قيمة المشروع المعتاد عندكم؟
345. (ask) كم مشروع يغطي هذا؟

**Saudi**

346. (bill) تكلفة البناء {build}، وبعدها {care} في الشهر للاستضافة والنسخ الاحتياطي والتعديلات.
347. (bill) دفعة وحدة كاملة، وينطلق بعد أسبوعين من وصول المحتوى منكم.
348. (beside, from your answer) قلتوا لنا إن المشروع العادي عندكم قيمته تقريباً {project}.
349. (beside, from your sheet) حسب جدول المتابعة، المشاريع اللي وقعتوها قيمتها تقريباً {project} للمشروع.
350. (beside, no figure on file) كم قيمة المشروع العادي عندكم؟
351. (ask) كم مشروع يغطي هذا؟

### Slide: Next step

**English**

352. (commit) Here's what we commit to: the pages, the care plan, and the timing, counted from your payment and your content.
353. (commit) That's a plan for the work. It's not a promise of results.
354. (close) Want me to start it this week?
355. (Ask for the card on the call. Copy the payment link from these notes and send it while you're still talking.)

**Kuwaiti**

356. (commit) هذا اللي نلتزم فيه: الصفحات، والعناية الشهرية، والوقت ينحسب من الدفع ووصول المحتوى منكم.
357. (commit) وهذي خطة للشغل، مو وعد بنتائج.
358. (close) نبدي فيه هالأسبوع؟

**Saudi**

359. (commit) هذا اللي نلتزم فيه: الصفحات، والعناية الشهرية، والوقت يتحسب من الدفع ووصول المحتوى منكم.
360. (commit) وهذي خطة للشغل، مو وعد بنتائج.
361. (close) نبدأ فيه هالأسبوع؟

**If they push back, English**

362. Of course. What would you need to know before you decide?
363. (If it's the price, use the price steps below. Hold full price first.)

**If they push back, Kuwaiti**

364. أكيد. شنو تحتاجون تعرفون قبل لا تقررون؟

**If they push back, Saudi**

365. أكيد. وش تحتاجون تعرفون قبل ما تقررون؟

### Slide: How it runs

**English**

366. (Show this only if they ask how it works.)
367. (steps) It runs from your payment and your content, not from today.
368. You send your logo, photos and list of services. We build it in Arabic and English and show you the draft.
369. Two weeks after we have your content, it's live. Then the care plan keeps it hosted, backed up and up to date.

**Kuwaiti**

370. (steps) الوقت ينحسب من الدفع ووصول المحتوى، مو من اليوم.
371. ترسلون لنا الشعار والصور وقائمة الخدمات. نبنيه بالعربي والإنجليزي، ونوريكم المسودة.
372. وبعد أسبوعين من ما يوصلنا المحتوى، ينطلق. وبعدها العناية الشهرية تخليه شغال ومحفوظ ومحدّث.

**Saudi**

373. (steps) الوقت يتحسب من الدفع ووصول المحتوى، مو من اليوم.
374. ترسلون لنا الشعار والصور وقائمة الخدمات. نبنيه بالعربي والإنجليزي، ونوريكم المسودة.
375. وبعد أسبوعين من وصول المحتوى، ينطلق. وبعدها العناية الشهرية تخليه شغال ومحفوظ ومحدّث.

### Slide: Firms we work with

**English**

376. (quote) This one is from our main programme, not a website we built. I'll let them say it.
377. (Play or read it, then stop. Don't narrate their numbers.)

**Kuwaiti**

378. (quote) هذا من برنامجنا الأساسي، مو موقع إحنا بنيناه. بخليهم يتكلمون عن نفسهم.

**Saudi**

379. (quote) هذا من برنامجنا الأساسي، مو موقع إحنا بنيناه. بخليهم يتكلمون عن تجربتهم.

### Slide: The website, in one minute

**English**

380. (play) This is a minute on how it works. I'll send it to you after the call as well.

**Kuwaiti**

381. (play) هذا فيديو دقيقة يشرح كيف يمشي الشغل. وبرسله لكم بعد المكالمة كمان.

**Saudi**

382. (play) هذا فيديو دقيقة يشرح كيف يمشي الشغل. وبأرسله لكم بعد المكالمة كمان.

### Answer: no, we don't have one

**English**

383. Is there a reason? I'm asking because most owners at your level already know they need one, so usually something got in the way.
384. (Wait again. You'll hear one of three answers: too busy, burned before, or it's expensive. Each is under Objections.)

**Kuwaiti**

385. فيه سبب؟ أسأل لأن أغلب أصحاب الشركات بمستواكم يعرفون إنهم يحتاجونه، فعادةً يكون فيه شي عاقكم.

**Saudi**

386. فيه سبب؟ أسأل لأن أغلب أصحاب الشركات اللي بمستواكم عارفين إنهم يحتاجونه، فعادةً يكون فيه شي أخّركم.

### Answer: yes, and it's broken

**English**

387. Can you send me the link you give people? Let's open it together.
388. (Open it on the shared screen and let them see what loads.)
389. This is what someone sees when they look you up after the ad.
390. Did you know it was showing this?

**Kuwaiti**

391. ممكن ترسلون لي الرابط اللي تعطونه الناس؟ خلونا نفتحه سوا.
392. هذا اللي يشوفه أي أحد يدور عليكم بعد ما يشوف الإعلان.
393. كنتوا تدرون إنه يطلع جذي؟

**Saudi**

394. ممكن ترسلون لي الرابط اللي تعطونه للناس؟ خلونا نفتحه سوا.
395. هذا اللي يشوفه أي أحد يدور عليكم بعد ما يشوف الإعلان.
396. كنتوا تدرون إنه يطلع كذا؟

### Answer: we're working on it

**English**

397. Good to hear. How long has it been in the works?
398. (Let them answer. If it's been months, the real question is what's holding it up.)
399. Is there a reason it's taken this long? Usually something got in the way.

**Kuwaiti**

400. حلو. من متى وأنتم تشتغلون عليه؟
401. وشنو اللي مأخره؟ عادةً يكون فيه شي عاقه.

**Saudi**

402. حلو. من متى وأنتم شغالين عليه؟
403. ووش اللي مأخره؟ عادةً يكون فيه شي معطله.

### Objection: too busy

**English**

404. Fair enough. That's exactly why we do it, rather than you managing it.
405. You send us three things, and the rest is on us.
406. (No real objection here, just no urgency. Press on to Why it matters for you.)

**Kuwaiti**

407. عادي، وهذا بالضبط ليش إحنا نسويه بدال ما تديرونه أنتم.
408. ترسلون لنا ثلاث أشياء، والباقي علينا.

**Saudi**

409. طبيعي، وهذا بالضبط ليش إحنا نسويه بدال ما تتابعونه أنتم.
410. ترسلون لنا ثلاث أشياء، والباقي علينا.

### Objection: someone started it and disappeared

**English**

411. That happens a lot, and I understand why you'd be careful.
412. Here's the difference. The timing is written down: live two weeks after we have your content, and you see it before it goes live.
413. And it sits with me. If anything runs late, you message me and I chase it.
414. (Expect resistance on trust, not price. Don't rush this one.)

**Kuwaiti**

415. هذا يصير وايد، وأفهم ليش صرتوا حذرين.
416. الفرق إن الوقت واضح ومكتوب: ينطلق بعد أسبوعين من ما يوصلنا المحتوى منكم، وتشوفونه قبل لا ينزل.
417. وأنا معاكم فيه. إذا تأخر أي شي، ترسلون لي وأنا ألحقه.

**Saudi**

418. هذا يصير كثير، وأفهم ليش صرتوا حذرين.
419. الفرق إن الوقت واضح ومكتوب: ينطلق بعد أسبوعين من وصول المحتوى منكم، وتشوفونه قبل ما ينزل.
420. وأنا معكم فيه. إذا تأخر أي شي، ترسلون لي وأنا أتابعه.

### Objection: it's expensive

**English**

421. Fair question. Let's not look at it on its own. Let's put it next to one of your projects.
422. (It's usually about not seeing the return. Press on to The investment and stop on its second step.)

**Kuwaiti**

423. سؤال في محله. خلونا ما نشوفه لحاله، نحطه جنب مشروع من مشاريعكم.

**Saudi**

424. سؤال في محله. خلونا ما نشوفه لحاله، نحطه جنب مشروع من مشاريعكم.

### Price: hold full price

**English**

425. I hear you. The build is paid in full. The care plan is paid monthly.
426. Let's look at it next to one of your projects again, the way we just did.
427. (Tap Held full price in these notes before you say any lower number.)

**Kuwaiti**

428. أفهمكم. البناء دفعة وحدة كاملة. والعناية دفعها شهري.
429. خلونا نرجع نشوفه جنب مشروع من مشاريعكم، مثل ما سوينا قبل شوي.

**Saudi**

430. أفهمكم. البناء دفعة وحدة كاملة. والعناية دفعها شهري.
431. خلونا نرجع نشوفه جنب مشروع من مشاريعكم، مثل ما سوينا قبل شوي.

### Price: a lower number, said only

**English**

432. (Only after Held full price, with the reason typed in these notes. Say it out loud. It never goes on the screen.)
433. If I make the build {final}, can we start it this week?
434. I'll send you the new payment link now.

**Kuwaiti**

435. إذا خليت البناء {final}، نبدي فيه هالأسبوع؟
436. برسل لكم رابط الدفع الجديد الحين.

**Saudi**

437. إذا خليت البناء {final}، نبدأ فيه هالأسبوع؟
438. بأرسل لكم رابط الدفع الجديد الحين.

### Price: asked to split

**English**

439. (The website has no split. If they ask to pay in parts, hold full price.)
440. The build is paid in full. The care is the monthly part, so that side is already spread out.

**Kuwaiti**

441. البناء دفعة وحدة كاملة. والعناية هي الجزء الشهري أصلاً.

**Saudi**

442. البناء دفعة وحدة كاملة. والعناية هي الجزء الشهري أصلاً.

## 11. The WhatsApp message after the call

Sent from the account manager's own WhatsApp. `{name}` is their first name, signing off.

**English**

```
Hi, thanks for your time today. Here's the one-minute video on the website, to watch again or send to your partners: {video}
Next step: {next}
{name}
```

**Kuwaiti**

```
هلا والله، شكراً على وقتكم اليوم. هذا فيديو الموقع، دقيقة وحدة، ترجعون له أو ترسلونه لشركائكم: {video}
الخطوة الجاية: {next}
{name}
```

**Saudi**

```
هلا والله، شكراً على وقتكم اليوم. هذا فيديو الموقع، دقيقة وحدة، ترجعون له أو ترسلونه لشركائكم: {video}
الخطوة اللي بعدها: {next}
{name}
```

## 12. The website video

Regional Gulf narration (Kuwaiti voice), then the words on screen. ".." is a short pause.

### hook, 0 to 5 s

| # | Where | English | Arabic |
|---|---|---|---|
| 443 | narration | Someone sees your ad. Then they search your name. | أحد يشوف إعلانكم.. وأول شي يسويه؟ يدور على اسمكم. |
| 444 | on screen | Example | مثال |
| 445 | on screen | Example ad | إعلان للتوضيح |
| 446 | on screen | Hosh Design & Build | حوش للتصميم والبناء |
| 447 | on screen | Sponsored | مُموَّل |
| 448 | on screen | Learn more | معرفة المزيد |

### gap, 5 to 15 s

| # | Where | English | Arabic |
|---|---|---|---|
| 449 | narration | What they find in the next thirty seconds decides whether they get in touch, or quietly go cold. Too often, it's this. | واللي يلقاه بأول ثلاثين ثانية.. هو اللي يقرر إذا بيتواصل معكم، ولا بيختفي بهدوء. ومرات كثير.. هذا اللي يلقاه. |
| 450 | on screen | Example | مثال |
| 451 | on screen | Captured {date} | لقطة بتاريخ {date} |
| 452 | on screen | 30 seconds | ٣٠ ثانية |
| 453 | on screen | The page doesn't open | الصفحة ما تفتح |

### what, 15 to 35 s

| # | Where | English | Arabic |
|---|---|---|---|
| 454 | narration | We build you a site. Up to six pages, in Arabic and English. Your projects, shown properly. WhatsApp, an enquiry form, and tracking. Send the link before a first meeting, so they see your work before they meet you. | نبني لكم موقع.. لين ست صفحات، بالعربي والإنجليزي. مشاريعكم معروضة مثل ما تستاهل.. وزر واتساب، وفورم للاستفسارات، وتتبع. وترسلون الرابط قبل أول اجتماع.. عشان يشوف شغلكم قبل لا يقابلكم. |
| 455 | on screen | Example | مثال |
| 456 | on screen | Six pages | ست صفحات |
| 457 | on screen | Arabic and English | بالعربي والإنجليزي |
| 458 | on screen | Website, Arabic and English | موقع بالعربي والإنجليزي |
| 459 | on screen | Home | الرئيسية |
| 460 | on screen | Projects | المشاريع |
| 461 | on screen | A project | صفحة مشروع |
| 462 | on screen | Services | الخدمات |
| 463 | on screen | About | من نحن |
| 464 | on screen | Contact | تواصل معنا |
| 465 | on screen | WhatsApp | واتساب |
| 466 | on screen | Enquiry form | نموذج الاستفسار |
| 467 | on screen | Tracking, tied to your ads | تتبع مربوط بإعلاناتكم |
| 468 | on screen | Care: hosting, backups, an hour of edits a month | العناية: استضافة، ونسخ احتياطي، وساعة تعديلات بالشهر |

### need, 35 to 45 s

| # | Where | English | Arabic |
|---|---|---|---|
| 469 | narration | Three things from you. Your logo. Photos of your projects. Your list of services. It's live two weeks after we have them. | ومنكم ثلاث أشياء بس. شعاركم.. صور مشاريعكم.. وقائمة خدماتكم. وبعد أسبوعين من يوم توصلنا.. الموقع شغال. |
| 470 | on screen | Example | مثال |
| 471 | on screen | What we need from you | اللي نحتاجه منكم |
| 472 | on screen | Your logo | شعاركم |
| 473 | on screen | Photos of your projects | صور مشاريعكم |
| 474 | on screen | Your list of services | قائمة خدماتكم |
| 475 | on screen | 2 weeks from your content | أسبوعين من وصول المحتوى |

### return, 45 to 60 s

| # | Where | English | Arabic |
|---|---|---|---|
| 476 | narration | How many projects would pay for this? Your account manager works it out with your numbers. | كم مشروع يكفي عشان يغطيه؟ ونحسبها معاكم.. بأرقامكم أنتم. |
| 477 | on screen | Example | مثال |
| 478 | on screen | Bill of quantities | جدول الكميات |
| 479 | on screen | Item | البند |
| 480 | on screen | Description | الوصف |
| 481 | on screen | Quantity | الكمية |
| 482 | on screen | Your typical project | مشروعكم المعتاد |
| 483 | on screen | This | هذا |
| 484 | on screen | your numbers | أرقامكم |

### Closing, the CEO's own clip, and the poster

| # | Where | English | Arabic |
|---|---|---|---|
| 485 | closing | Your account manager will walk you through it. | فريق نجاح العملاء بيمشي معاكم فيها.. خطوة خطوة. |
| 486 | poster | Your website, in Arabic and English | موقعكم، بالعربي والإنجليزي |

## 13. The offer page

The client's proposal page (offer.maharamedia.com). Its title, lines and bill come from the catalog above.

| # | Where | English | Arabic |
|---|---|---|---|
| 487 | proposalFor | A proposal for {name} | عرض سعر إلى {name} |
| 488 | preparedBy | Prepared by {name}, your account manager | من إعداد {name}، فريق نجاح العملاء |
| 489 | validUntil | Valid until {date} | صالح حتى {date} |
| 490 | found | What we found | اللي لقيناه |
| 491 | why | Why this, for you | ليش هذا يناسبكم |
| 492 | get | What you get | اللي نسويه لكم |
| 493 | work | Work we've done | من شغلنا |
| 494 | runs | How it runs | كيف يمشي الشغل |
| 495 | investment | Investment | الاستثمار |
| 496 | dollars | dollars | دولار |
| 497 | split | Or in two payments | أو على دفعتين |
| 498 | paidInFull | Paid in full | دفعة وحدة كاملة |
| 499 | oneTime | One time | دفعة وحدة |
| 500 | monthly | Monthly | شهرياً |
| 501 | perDay | Per day | باليوم |
| 502 | per90 | For 90 days | لمدة ٩٠ يوم |
| 503 | example | Example | مثال |
| 504 | captured | Captured {date} | لقطة بتاريخ {date} |
| 505 | searchedAs | Searched as {city} | البحث من {city} |
| 506 | play | Play the video | شغّلوا الفيديو |
| 507 | playNote | The video loads from its own site when you press play. | الفيديو يتحمّل من موقعه لما تضغطون تشغيل. |
| 508 | printLink | Open this proposal online: {url} | افتحوا عرض السعر أونلاين: {url} |
| 509 | states: loading | Opening your proposal | نفتح عرض السعر |
| 510 | states: expired | This proposal has expired. Message your account manager for a new one. | انتهت مدة عرض السعر هذا. راسلوا فريق نجاح العملاء، ويرسلون لكم عرض جديد. |
| 511 | states: archived | This proposal is no longer active. Message your account manager. | أوقفنا عرض السعر هذا. راسلوا فريق نجاح العملاء. |
| 512 | states: unknown | We couldn't find this proposal. Check the link, or message your account manager. | ما لقينا عرض السعر هذا. تأكدوا من الرابط، أو راسلوا فريق نجاح العملاء. |
| 513 | states: busy | This page is busy right now. Try again in a minute. | الصفحة عليها ضغط الحين. حاولوا بعد دقيقة. |
| 514 | states: error | This page didn't load. Refresh it, or message your account manager. | ما قدرنا نفتح الصفحة. حدّثوها، أو راسلوا فريق نجاح العملاء. |
| 515 | states: videoGone | This video link has ended. Message your account manager for a new one. | رابط الفيديو هذا ما عاد يشتغل. راسلوا فريق نجاح العملاء، ويرسلون لكم رابط جديد. |
| 516 | messageUs | To go ahead, message your account manager on WhatsApp. | عشان نبدي، راسلوا فريق نجاح العملاء على الواتساب. |

516 numbered rows and lines.
