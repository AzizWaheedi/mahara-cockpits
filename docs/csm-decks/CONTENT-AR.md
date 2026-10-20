# CSM decks: Arabic content

The Arabic for every on-screen string in `CONTENT.md`, slide by slide with the same ids, then the presenter lines the client success manager says out loud when the call is in Arabic. The example call itself is in `EXAMPLE-CALL.md`.

Written 2026-10-19 under `mahara-context/skills/aziz-kuwaiti-voice`, in the warm-professional client register for engineering, construction, fit-out and design firms, Saudi-safe. The register follows the client-facing Arabic Mahara already sends (`client-comms/csm-templates.md`, `onboarding-to-launch-csm.md`) and the Onboarding Map's own stop names. Revised the same day with `CONTENT.md` after the critique, and again on 2026-10-20 with the CEO's answers to its open questions 1 to 3 (see its Revision notes and [the section at the end](#ceo-answers-2026-10-20)).

## Decisions for the Arabic (made once, for both decks)

1. **We address the firm in the plural.** أنتم، عندكم، فريقكم، عملاؤكم. It reads as respect in Kuwait and in Saudi Arabia, and it covers a call with more than one partner on it. The journey's three lanes are عميلكم · فريقنا · أنتم. The customer (the client's buyer) is singular and generic: عميلكم، يشوف، نتصل عليه.
2. **Slide text is a white Gulf Arabic a Saudi engineering office reads as serious.** No ج/ي spelling swaps on slides. No Kuwaiti-only words (شنو، شلون، ماكو، وايد، عيل، هني، جذي، باجر، مال as a possessive). No Saudi-only words (وش، أبشر، إيش). Questions use كيف، ليش، متى، وين، أي. The example call is the only place that speaks a dialect, on purpose.
3. **Voice-skill rules kept:** تمام never طيب; بصراحة; نبدي and تبدي, not نبدأ; plain spoken verbs, never bookish ones (يحاكي، يجسد، يعكس); never مقاول for the client; loanwords in Arabic script where people say them (سكربت، كورس، لابتوب، زوم، فيد، ريلز، ستوري).
4. **Form:** no guillemets and no quote marks around Arabic words, no em dashes, no exclamation marks. ".." only inside spoken lines.
5. **Times:** on slides, ١٠ صباحاً and ٦ مساءً (how Gulf businesses write their hours). In spoken lines and in the call, الصبح، العصر، المسا.
6. **Numbers:** Arabic-Indic digits through `Fig`, never ٬, never a lone ٠, never a digit glued to بـ or لـ (write إلى ٦, not لـ٦). Small numbers inside speech are words (ست شهور، سنتين). The call clock and the WhatsApp confirmation's date and time stay in Latin digits (DESIGN 13.4, 7.6).
7. **Slots keep CONTENT's ids** in braces. Client and page names, handles and English words sit in `<bdi dir=auto>` (DESIGN 13.2). In the Arabic deck `{client.name}` is the Arabic name from `ghl_clients.client_name` when there is one.
8. **The presenting CSM's title is gendered in Arabic.** Store `csm.title_ar` on the seat, or a gender: مدير نجاح العملاء for a man, مديرة نجاح العملاء for a woman. With no name and no gender, the line reads فريق نجاح العملاء. Inside the O3 group, where the CSM is a role, the row reads نجاح العملاء.
9. **Meta's own Arabic labels** (مُموَّل and the button labels) are my best reading of Meta's Arabic interface. Check each against a live Arabic preview before shipping (DESIGN 17.2).
10. **The test is الاختبار on slides.** فترة التجربة reads as a trial or probation period, too close to the service itself being on trial, and نتعلم can sound like learning on the client's money. Slides say الاختبار، نختبر، نكتشف اللي يشتغل. نجرب stays in spoken lines only.
11. **The CEO's answers, 2026-10-20 (`CONTENT.md` copy rules 1, 5 and 6).** The call is خلال ٥ دقايق, always beside في أوقات الدوام with the hours, and the night line stays. دقايق is spelled as the sales deck spells it, so the client reads the same promise in both decks; it is the spoken Gulf spelling slides already use in رسايل, not a ج/ي swap. The check-in rhythm is كل أسبوع أو كل أسبوعين, never one of the two alone, with the reason على حسب باقتكم، وكم صار لكم معنا. باقة names our plan, because العرض on these decks is the client's own offer. The customer who came and is thinking it over is علينا وعليكم done for you, beside the no-show's علينا; done with you is unchanged.

## Shared vocabulary

Use these the same way in both decks, the notes and the prep view.

| English | Arabic | Note |
|---|---|---|
| onboarding call | مكالمة التعريف | the Onboarding Map's name |
| onboarding form | نموذج التعريف بالنشاط | the Onboarding Map's name |
| Brand Blueprint call | مكالمة بناء الهوية والعرض | map stop 4, with مكالمة |
| launch call | مكالمة الإطلاق | |
| check-in | مكالمة متابعة | |
| weekly or every two weeks | كل أسبوع أو كل أسبوعين | the check-in rhythm, never one alone (decision 11) |
| your plan (ours, with them) | باقتكم | never العرض, which is the client's offer |
| within 5 minutes during working hours | خلال ٥ دقايق في أوقات الدوام | decision 11 |
| go live / go-live | ننطلق / الإطلاق | |
| customer (the client's buyer) | عميلكم، العميل | never ليد |
| enquiry | استفسار | |
| appointment, meeting | موعد | never زيارة |
| your WhatsApp group | قروب الواتساب | |
| Mahara OS | Mahara OS | Latin, isolated |
| Meta | ميتا | |
| Facebook Page | صفحة فيسبوك | Facebook only here and in فيد فيسبوك |
| ad account | الحساب الإعلاني | |
| Drive folder | مجلد الدرايف | |
| Premium Projects Academy | أكاديمية المشاريع المميزة | as the sales deck |
| starter ads | إعلانات البداية | |
| your own ads | إعلاناتكم الخاصة | |
| the creative director | المدير الإبداعي | |
| the media buyer | مسؤول الإعلانات | |
| the systems team | فريق الأنظمة | |
| your callers, our calling team | فريق الاتصال | gender-neutral |
| client success manager | مدير نجاح العملاء / مديرة نجاح العملاء | decision 8 |
| call guide | دليل المكالمات | |
| outcome | النتيجة | |
| the test (slides) | الاختبار | decision 10 |
| we test (slides) | نختبر | spoken lines may say نجرب |
| red lines | الخطوط الحمراء | |
| Preview | معاينة | tag |
| Demo workspace | حساب تجريبي | tag |
| Example | مثال | tag |
| Example form | نموذج للتوضيح | tag |
| Example wording | صياغة للتوضيح | tag |
| Illustration | توضيح | tag |
| Starter, from our templates | إعلان بداية، من قوالبنا | tag |
| To give us | نحتاجه منكم | chip |
| To do · Done · Not checked yet | باقي · تم · ما تأكدنا للحين | status |
| Agreed to test this way | اتفقنا نختبر بهالطريقة | stamp |
| Sponsored | مُموَّل | Meta, check |

## Data-map fallbacks and values

| Slot | English fallback or value | Arabic |
|---|---|---|
| `csm.first` line | {csm.first} · Your client success manager | {csm.first} · مدير نجاح العملاء (or مديرة نجاح العملاء) |
| `csm.first` missing | Your client success manager | فريق نجاح العملاء |
| `next.*` missing | (nothing on the canvas until booked) | (لا شي على الشاشة) |
| `ads.*` missing | We're finishing your first ads | نشتغل على أول إعلاناتكم الحين |
| `funnel.*` missing | Example form | نموذج للتوضيح |
| `dosDonts` missing | No red lines written yet. Tell us now and we'll add them to your card. | ما عندنا خطوط حمراء مكتوبة للحين. قولوها لنا الحين، ونضيفها لملفكم. |
| `links.drive` missing | Your folder link is pinned in your WhatsApp group. | رابط المجلد مثبت فوق في قروب الواتساب. |
| UAE hours (and Oman) | 10 to 6 Saudi time (11 to 7 in the UAE) | من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات) |
| `form.consult_types`: office | at your office | في مكتبكم |
| `form.consult_types`: home | at their home | في بيت العميل |
| `form.consult_types`: online | online | أونلاين |
| `form.consult_types` missing | at your office, at their home, or online | في مكتبكم، أو في بيت العميل، أو أونلاين |
| `kickoff.platforms` names | Instagram, Facebook, Snapchat, TikTok, Google | إنستقرام، فيسبوك، سناب شات، تيك توك، قوقل |

**Prep fields in Arabic.** When the deck is shown in Arabic, these free-text prep fields need an Arabic value beside the English one, because the build cannot translate them: `service_focus` (and the service chips from the form, which clients often write in English), `goals` edits, `selling_point`, `project`, `red_lines`. The prep view should show an Arabic box for each and warn when it is empty. The client's own goal answers and red lines typed live show exactly as written, in whatever language.

---

# Onboarding deck

## O1 · `welcome`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `welcome.eyebrow` | Onboarding call · {onboarding.date} | مكالمة التعريف · {onboarding.date} |
| `welcome.title` | Welcome, {client.name} | حياكم الله، {client.name} |
| `welcome.agenda.lead` | Before we hang up, we'll: | قبل لا نسكر المكالمة: |
| `welcome.agenda.1` | Choose your launch service | نختار خدمة الإطلاق |
| `welcome.agenda.2` | Set up your access | نجهّز الصلاحيات |
| `welcome.agenda.3` | Book your Brand Blueprint call | نحجز مكالمة بناء الهوية والعرض |
| `welcome.footer` | {csm.first} · Your client success manager | {csm.first} · مدير نجاح العملاء (or مديرة نجاح العملاء) |

**Spoken lines (Arabic)**
- شكراً على وقتكم. أنا {csm.first}، وباقي الفريق بتتعرفون عليهم بأدوارهم بعد شوي.
- المكالمة تقريباً ٤٥ دقيقة. نمر على كم شريحة، وبعدها نجهّز أغلب الأشياء مع بعض، على المكالمة نفسها.
- مين معنا اليوم؟ ومين اللي يقرر بخصوص الإعلانات، ومين اللي يقابل العملاء؟
- للعلم، المكالمة مسجلة عشان الفريق يرجع لها.

## O2 · `goals`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `goals.eyebrow` | From your onboarding form | من نموذج التعريف بالنشاط |
| `goals.title` | Your goals, as you wrote them | أهدافكم مثل ما كتبتوها |
| `goals.card.goal90` | In 90 days | خلال ٩٠ يوم |
| `goals.card.goal12_24` | In 12 to 24 months | خلال سنة إلى سنتين |
| `goals.card.challenges` | What's in the way | اللي واقف بطريقكم |
| `goals.card.why` | Why you joined | ليش بديتوا معنا |
| `goals.foot` | We'll track them with you. They're targets, not a promise of results. | نتابعها معكم، وهي أهداف نشتغل عليها، مو وعد بنتائج. |
| `goals.empty` | What would make the next 90 days a win for you? | متى تقولون إن الثلاث شهور الجاية نجحت؟ |

The card bodies are the client's own answers, shown as written. No quote marks around them.

**Spoken lines (Arabic)**
- (If a goal is a number) بنحط الأهداف مع بعض أول ما توصل أول المواعيد.
- **Temp check:** فهمناكم صح؟ تبون تغيرون شي؟

## O3 · `team`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `team.title` | Your team, in your WhatsApp group | فريقكم، في قروب الواتساب |
| `team.line` | The people who run your ads and funnel, our call centre and your success manager are all in this one group. | اللي يشتغلون على إعلاناتكم ومسار العميل، وفريق الاتصال، ونجاح العملاء، كلهم معكم في قروب واحد. |
| `team.header` | Your WhatsApp group | قروب الواتساب |
| `team.csm.name` | Your client success manager | نجاح العملاء |
| `team.csm.line` | Your one point of contact, for anything. | نقطة تواصلكم معنا، لأي شي. |
| `team.cd.name` | The creative director | المدير الإبداعي |
| `team.cd.line` | Your brand, your scripts and your ads. | هويتكم، وسكربتاتكم، وإعلاناتكم. |
| `team.mb.name` | The media buyer | مسؤول الإعلانات |
| `team.mb.line` | Your campaigns. | حملاتكم. |
| `team.sys.name` | The systems team | فريق الأنظمة |
| `team.sys.line` | Mahara OS and your calendar. | Mahara OS وتقويمكم. |
| `team.caller.name` | Your caller | فريق الاتصال |
| `team.caller.line` | Questions from the calls: your hours, a holiday, a service detail. | أسئلة من المكالمات: أوقات دوامكم، أو إجازة، أو تفصيلة عن خدمة. |
| `team.foot` | We reply 10 to 6, Saturday to Thursday. If something worries you, we call you. | نرد من ١٠ صباحاً إلى ٦ مساءً، من السبت إلى الخميس. وإذا فيه شي شاغل بالكم، نتصل عليكم. |

**DWY**

| Key | English | Arabic |
|---|---|---|
| `team.line.dwy` | The people who run your ads and funnel and your success manager are all in this one group. | اللي يشتغلون على إعلاناتكم ومسار العميل، ونجاح العملاء، كلهم معكم في قروب واحد. |
| `team.alerts.name.dwy` | New-enquiry alerts | تنبيهات الاستفسارات الجديدة |
| `team.alerts.line.dwy` | New enquiries arrive here too, for your callers. | الاستفسارات الجديدة توصل هنا بعد، لفريق الاتصال عندكم. |

**Spoken lines (Arabic)**
- كل واحد بالقروب يكلمكم عن شي واحد. وأنا نقطة تواصلكم معنا، لأي شي ثاني.
- الجمعة إجازة، والرسايل اللي توصل بعد الساعة ٦ نرد عليها بأول يوم دوام بعدها.

## O4 · `one-service`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `one.title` | One service per campaign | خدمة وحدة لكل حملة |
| `one.line` | We launch with one service, so the ads, the form questions and the calls are all written for one kind of customer. | نبدي بخدمة وحدة، عشان كل إعلان وكل سؤال وكل مكالمة تكلم نوع واحد من العملاء. |
| `one.tag.number_one` | Your #1 | الأولى عندكم |
| `one.test.sell` | Easiest to sell | الأسهل بالبيع |
| `one.test.profit` | Most profit | الأكثر ربح |
| `one.test.deliver` | Least painful to deliver | الأريح بالتنفيذ |
| `one.result` | We'll launch with {prep.service_focus} | بنطلق أول حملة على {prep.service_focus} |
| `one.small` | Once it works, we can add the next one. | ولما تمشي زين، نضيف الخدمة اللي بعدها. |
| `one.launch` | Launch with this | نطلق فيها |

The chips are the client's services as the form holds them (decision on prep fields above).

**Spoken lines (Arabic)**
- أي خدمة فيها الأسهل بالبيع؟ وأي وحدة تجيب لكم أكثر ربح؟ وأي وحدة الأريح لكم بالتنفيذ؟
- الإعلانات وأسئلة النموذج وسكربت المكالمة، كلها تنكتب لنوع واحد من العملاء.
- وهالخدمة نفسها بتكون بمكالمة الإطلاق، وبمثال المكالمة اللي بنوريكم إياه.
- **Temp check:** مرتاحين نبدي بخدمة {prep.service_focus}؟

## O5 · `road`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `road.title` | The road to your first appointments | الطريق لأول مواعيدكم |
| `road.stop.1` | Contract signed | توقيع العقد |
| `road.stop.2` | Onboarding form | نموذج التعريف بالنشاط |
| `road.stop.3` | Onboarding call | مكالمة التعريف |
| `road.today` | Today | اليوم |
| `road.stop.4` | Brand and offer | بناء الهوية والعرض |
| `road.stop.5` | Launch call | مكالمة الإطلاق |
| `road.stop.5.time` | 20 to 30 minutes | من ٢٠ إلى ٣٠ دقيقة |
| `road.stop.5.line` | We walk you through everything that's going live. | نمر معكم على كل شي بينزل. |
| `road.stop.6` | First appointments | أول المواعيد |
| `road.stop.6.line` | After go-live | بعد الإطلاق |
| `road.footer` | Each call is booked at the end of the one before. | كل مكالمة نحجزها بآخر المكالمة اللي قبلها. |

The six stop names are the Onboarding Map's own, exactly. Stop 4 carries only its name and the booked date; O7 says what the call is.

**Spoken lines (Arabic)**
- (If they ask for a launch date) تاريخ الإطلاق نثبته لما تكتمل الصلاحيات والمحتوى والموافقات.
- ومع كل خطوة تخلص، يوصلكم الجزء اللي بعدها من هالطريق بقروب الواتساب.
- (DWY) من الخطوة الثانية إلى الخامسة توصلكم بالقروب، وخطوة أول المواعيد يمشيها فريقكم.

## O6 · `this-week`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `week.title` | What we need from you this week | اللي نحتاجه منكم هالأسبوع |
| `week.line` | Most of it we'll do together, right now. | وأغلبه بنسويه مع بعض، الحين. |
| `week.1.name` | Meta access | صلاحيات ميتا |
| `week.1.line` | Your Page and ad account, shared through one link. And a card on the ad account: your ad spend goes to Meta directly. | صفحتكم على فيسبوك وحسابكم الإعلاني، تشاركونها معنا برابط واحد. وبطاقة على الحساب الإعلاني: مصروف الإعلانات يروح لميتا مباشرة. |
| `week.1.ticks` | Access · Card | الصلاحيات · البطاقة |
| `week.2.name` | Mahara OS | Mahara OS |
| `week.2.line` | Sign in, then connect WhatsApp and Google Calendar, so bookings land in your real calendar. | سجلوا دخول، وبعدها اربطوا الواتساب وتقويم قوقل، عشان المواعيد تنزل بتقويمكم الحقيقي. |
| `week.2.ticks` | Signed in · WhatsApp · Calendar | تسجيل الدخول · واتساب · التقويم |
| `week.3.name` | Your content | محتواكم |
| `week.3.line` | Before your Blueprint call: photos and videos in your Drive folder. Finished projects, work in progress, your team on site. Don't filter. We will. | قبل مكالمة بناء الهوية: صور وفيديوهات بمجلد الدرايف. مشاريع خلصت، وشغل قيد التنفيذ، وفريقكم بالموقع. لا تفلترون، إحنا نفلتر. |
| `week.3.link` | (link to {links.drive}) | مجلد الدرايف |
| `week.4.name` | Past enquiries | الاستفسارات القديمة |
| `week.4.line` | Have a list of old enquiries? Send it, and we'll agree whether to call them. | عندكم قائمة باستفسارات قديمة؟ أرسلوها، ونتفق إذا ينتصل عليهم. |
| `week.5.name` | The Academy | الأكاديمية |
| `week.5.line` | Courses for you and your team: your offer, closing your projects, your team and operations. Join, and start with the onboarding course. | كورسات لكم ولفريقكم: العرض، وتوقيع المشاريع، والفريق والتشغيل. انضموا، وابدوا بكورس Onboarding. |
| `week.links` (copied into the group) | Meta access (one link): {url} · Your Drive folder: {url} · The Academy: {url} · Mahara OS: {url} · Install Mahara OS on your phone: {url} | صلاحيات ميتا (رابط واحد): {url} · مجلد الدرايف: {url} · الأكاديمية: {url} · Mahara OS: {url} · نزّلوا Mahara OS على جوالكم مثل أي تطبيق: {url} |
| `week.status.todo` | To do | باقي |
| `week.status.done` | Done | تم |
| `week.status.unknown` | Not checked yet | ما تأكدنا للحين |

The onboarding course keeps its own name, isolated in Latin: «كورس البداية» would point at a different course (The start).

**DWY**

| Key | English | Arabic |
|---|---|---|
| `week.2.name.dwy` | Your CRM | الـCRM عندكم |
| `week.2.line.dwy` | Sign in, and connect your calendar, so bookings land in your real calendar. | سجلوا دخول، واربطوا تقويمكم، عشان المواعيد تنزل بتقويمكم الحقيقي. |
| `week.2.ticks.dwy` | Signed in · Calendar | تسجيل الدخول · التقويم |
| `week.6.name.dwy` | Your callers' phones | جوالات فريق الاتصال عندكم |
| `week.6.line.dwy` | Install the LeadConnector app, sign in and turn on alerts. | نزّلوا تطبيق LeadConnector، وسجلوا دخول، وفعّلوا التنبيهات. |

**Spoken lines (Arabic)**
- خلنا نخلص صلاحيات ميتا وMahara OS الحين، مع بعض.
- كل ما رفعتوا محتوى أكثر قبل مكالمة بناء الهوية، طلعت أول إعلاناتكم أحسن.
- الاستفسارات القديمة نتفق عليها بمكالمة بناء الهوية أو بالقروب، إذا نتصل عليهم ولا لا.
- (For anything left open) هذي مين بيخلصها، ومتى؟

## O7 · `next`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `next.title` | What to expect, and what's next | اللي تتوقعونه، والخطوة الجاية |
| `next.ads.name` | Your first ads | أول إعلاناتكم |
| `next.ads.approved` | Starter ads go live first, from our ready templates for {prep.service_focus}. Your own ads, made from your content, follow. | أول شي تنزل إعلانات البداية، من قوالبنا الجاهزة لخدمة {prep.service_focus}. وبعدها إعلاناتكم الخاصة، اللي نسويها من محتواكم. |
| `next.ads.approved.nopack` | Starter ads go live first, from our ready templates. Your own ads, made from your content, follow. | أول شي تنزل إعلانات البداية، من قوالبنا الجاهزة. وبعدها إعلاناتكم الخاصة، اللي نسويها من محتواكم. |
| `next.ads.pending` | Starter ads can go live first, from our ready templates for {prep.service_focus}. Your own ads, made from your content, follow. | نقدر ننزل أول شي إعلانات البداية، من قوالبنا الجاهزة لخدمة {prep.service_focus}. وبعدها إعلاناتكم الخاصة، اللي نسويها من محتواكم. |
| `next.ads.pending.nopack` | Starter ads can go live first, from our ready templates. Your own ads, made from your content, follow. | نقدر ننزل أول شي إعلانات البداية، من قوالبنا الجاهزة. وبعدها إعلاناتكم الخاصة، اللي نسويها من محتواكم. |
| `next.ads.declined` | Your own ads, made from your content, go live first. | أول شي تنزل إعلاناتكم الخاصة، اللي نسويها من محتواكم. |
| `next.ads.approval` | Your first ads go live only once you've approved them. | أول إعلاناتكم ما تنزل إلا بعد موافقتكم. |
| `next.test.name` | The first weeks are a test | أول الأسابيع نختبر فيها الإعلانات |
| `next.test.line` | Your red lines stay fixed. Tell us now what we must never say or show. Everything else, we test. | خطوطكم الحمراء ثابتة. قولوا لنا الحين اللي ما نقوله ولا نوريه أبد، والباقي نختبره. |
| `next.test.input` | Your red lines, in your words | خطوطكم الحمراء، بكلامكم |
| `next.band` | Next: your Brand Blueprint call · 45 minutes with our creative director: your brand, your offer, your first ad scripts. | الخطوة الجاية: مكالمة بناء الهوية والعرض · ٤٥ دقيقة مع المدير الإبداعي: هويتكم، وعرضكم، وسكربتات أول إعلاناتكم. |
| `next.band.date` | {next.blueprint} | {next.blueprint} |
| `next.starter.title` | Your starter ads | إعلانات البداية |
| `next.starter.tag` | Starter, from our templates | إعلان بداية، من قوالبنا |
| `next.starter.line` | Our ready templates for {prep.service_focus}, under your Page name and logo. | قوالبنا الجاهزة لخدمة {prep.service_focus}، باسم صفحتكم وشعاركم. |
| `next.starter.line.nopack` | Our ready templates, under your Page name and logo. | قوالبنا الجاهزة، باسم صفحتكم وشعاركم. |

**Spoken lines (Arabic)**
- تبون تشوفون إعلانات البداية الحين؟
- فيه شي ما تبونا نقوله أو نوريه أبد؟ قولوه بكلامكم، وأنا أكتبه.
- خلنا نحجز مكالمة بناء الهوية والعرض الحين.
- **Temp check:** فيه شي مو واضح لكم قبل لا نحجز مكالمة بناء الهوية؟

---

# Launch deck

Order: L1 cover, L2 journey, L3 ads, L4 creative freedom, L5 form, L6 call, L7 portal, L8 your part, L9 first 90 days, L10 green light.

## L1 · `cover`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `cover.eyebrow` | Launch call · {today} | مكالمة الإطلاق · {today} |
| `cover.title` | {client.name} goes live | انطلاقة {client.name} |
| `cover.title.live` | {client.name} is live | انطلقنا مع {client.name} |
| `cover.date` | {go_live} | {go_live} |
| `cover.line` | Everything your customers will see, before they see it. | كل شي بيشوفه عملاؤكم، تشوفونه قبلهم. |
| `cover.line.live` | Everything your customers see, and what happens next. | كل شي يشوفه عملاؤكم، واللي يصير بعدها. |
| `cover.road` | Launch call · Today | مكالمة الإطلاق · اليوم |
| `cover.footer` | {csm.first} · Your client success manager | {csm.first} · مدير نجاح العملاء (or مديرة نجاح العملاء) |

Both Arabic titles put the verb before the name, so a company name never forces a gender on the verb. On the cover the teal word is انطلاقة (or انطلقنا).

**Spoken lines (Arabic)**
- تقريباً ٢٥ دقيقة. بنمر على اللي بينزل، وعلى اللي يصير لما أحد يستفسر، وعلى اللي نحتاجه منكم. وقفوني بأي وقت.
- إذا تقدرون، خلونا معكم هالدقايق كاملة.
- (Starter ads already running) إعلانات البداية شغالة من قبل، واليوم بوريكم الصورة كاملة.
- (Only if you did not run their onboarding call) أنا {csm.first}، من فريق نجاح العملاء، وباقي الفريق بتعرفونهم بأدوارهم.

## L2 · `journey` (signature)

**On screen**

| Key | English | Arabic |
|---|---|---|
| `journey.title` | Your customer's journey | رحلة عميلكم |
| `journey.line` | From your ad to your meeting, step by step. | من إعلانكم لين موعدكم، خطوة بخطوة. |

**Stops**

| # | Key | English row name | Arabic row name | English line | Arabic line |
|---|---|---|---|---|---|
| 1 | `journey.1` | Sees your ad | يشوف إعلانكم | They see your ad in their feed. | يشوف إعلانكم وهو يقلّب جواله. |
| 2 | `journey.2` | Answers your questions | يجاوب على أسئلتكم | A few short questions about their project, then your thank-you screen. | يجاوب على كم سؤال قصير عن مشروعه، وبعدها تطلع له صفحة الشكر. |
| 2 | `journey.2.whatsapp` | | | They message you on WhatsApp. The chat opens with their first message ready to send. | يراسلكم على الواتساب. المحادثة تفتح ورسالته الأولى جاهزة يرسلها. |
| 3 | `journey.3` | We call | نتصل عليه | We call new enquiries within 5 minutes during working hours, 10 to 6, Saturday to Thursday. Anything that comes in at night is called from 10 the next working morning. | نتصل على الاستفسارات الجديدة خلال ٥ دقايق في أوقات الدوام: من ١٠ صباحاً إلى ٦ مساءً، من السبت إلى الخميس. واللي يوصل بالليل، نتصل عليه من الساعة ١٠ صباح أول يوم دوام. |
| 3 | `journey.3.line.uae` | | | We call new enquiries within 5 minutes during working hours, 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday. Anything that comes in at night is called from 10 the next working morning. | نتصل على الاستفسارات الجديدة خلال ٥ دقايق في أوقات الدوام: من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات)، من السبت إلى الخميس. واللي يوصل بالليل، نتصل عليه من الساعة ١٠ صباح أول يوم دوام. |
| 3 | `journey.3.chip` | | | Up to 4 tries over 3 working days | لين ٤ محاولات خلال ٣ أيام دوام |
| 3 | `journey.3.notall` | | | Not every enquiry books. Some can't be reached, some aren't a fit. Our caller notes why, and we go through it with you at check-ins. | مو كل استفسار ينحجز له موعد. فيه ناس ما نقدر نوصل لهم، وفيه ناس ما يناسبونكم. وفريق الاتصال يكتب السبب، ونمر عليه معكم بمكالمات المتابعة. |
| 4 | `journey.4` | Booked, confirmed, reminded | ينحجز ويتأكد ونذكّره | The serious ones are booked in, confirmed on WhatsApp and reminded before the meeting. | الجادين نحجز لهم، ويوصلهم تأكيد على الواتساب، ونذكّرهم قبل الموعد. |
| 4 | `journey.4.video` | | | The serious ones are booked in, confirmed on WhatsApp with a short video about you, and reminded before the meeting. | الجادين نحجز لهم، ويوصلهم تأكيد على الواتساب ومعاه فيديو قصير يعرّف عنكم، ونذكّرهم قبل الموعد. |
| 5 | `journey.5` | Lands with you | يوصلكم | Once it's confirmed, it lands in your calendar and in Mahara OS, and you get a WhatsApp alert. | لما يتأكد الموعد، ينزل بتقويمكم وفي Mahara OS، ويوصلكم تنبيه على الواتساب. |
| 5 | `journey.5.nocal` | | | Connect Google Calendar in Mahara OS so bookings land there. | اربطوا تقويم قوقل في Mahara OS عشان المواعيد تنزل فيه. |
| 6 | `journey.6` | You meet | تقابلونه | You hold the meeting: {form.consult_types}. | تقابلونه: {form.consult_types}. |
| 6 | `journey.6.noshow` | | | Didn't show? Ours. We call to rebook. | ما حضر؟ علينا. نتصل عليه ونحجز له من جديد. |
| 6 | `journey.6.deciding` | | | Came, and thinking it over? Both of us. We call to follow up, and so do you: you know them best. Then mark it. | حضر وقاعد يفكر؟ علينا وعليكم. نتصل عليه ونتابع معه، وأنتم بعد تتابعونه، لأنكم تعرفونه أكثر. وبعدها سجلوا النتيجة. |
| 7 | `journey.7` | You mark it | تسجلون النتيجة | You mark how it went, in a few taps. | تسجلون كيف راح الموعد، بكم ضغطة. |

| Key | English | Arabic |
|---|---|---|
| `journey.lane.customer` | Your customer | عميلكم |
| `journey.lane.us` | Our team | فريقنا |
| `journey.lane.you` | You | أنتم |
| `journey.owner.customer` | Your customer | عميلكم |
| `journey.owner.us` | Our team does this | فريقنا يسويها |
| `journey.owner.you` | You do this | أنتم تسوونها |
| `journey.1.fallback` | Your ad goes here | إعلانكم هنا |
| `journey.tag.example` | Example | مثال |
| `journey.6.fallback` | at your office, at their home, or online | في مكتبكم، أو في بيت العميل، أو أونلاين |
| `journey.3.uae` | 10 to 6 Saudi time (11 to 7 in the UAE) | من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات) |

For stop 6, join two or three consultation types with أو (في مكتبكم أو أونلاين).

**DWY stops**

| # | Key | English row name | Arabic row name | English line | Arabic line |
|---|---|---|---|---|---|
| 3 | `journey.3.dwy` | Your team calls | فريقكم يتصل | A new-enquiry alert reaches your callers' phones and your WhatsApp group. Call within 5 minutes. Up to 4 tries over 3 working days. | تنبيه الاستفسار الجديد يوصل لجوالات فريق الاتصال عندكم وللقروب. اتصلوا خلال ٥ دقايق. لين ٤ محاولات خلال ٣ أيام دوام. |
| 4 | `journey.4.dwy` | Your team books | فريقكم يحجز | Book on the right calendar. The confirmation goes out by itself. | احجزوا على التقويم الصح، والتأكيد يطلع للعميل تلقائياً. |
| 5 | `journey.5.dwy` | Lands with you | يوصلكم | It lands in your calendar and your CRM, with your caller's notes. | الموعد ينزل بتقويمكم وفي الـCRM، ومعاه ملاحظات فريق الاتصال عندكم. |
| 6 | `journey.6.noshow.dwy` | | | Didn't show? The follow-up messages start by themselves. | ما حضر؟ رسايل المتابعة تبدي تلقائياً. |
| 6 | `journey.6.deciding.dwy` | | | Came, and thinking it over? Follow up, then move it to the right stage. | حضر وقاعد يفكر؟ تابعوه، وبعدها انقلوه للمرحلة الصح. |
| 7 | `journey.7.dwy` | You mark it | تسجلون النتيجة | Your team moves it to the right stage in the CRM, the same day. | فريقكم ينقله للمرحلة الصح في الـCRM، بنفس اليوم. |

**Spoken lines (Arabic)**
- (Stop 3) نتصل على الاستفسارات الجديدة خلال ٥ دقايق في أوقات الدوام، من ١٠ الصبح إلى ٦ المسا، من السبت إلى الخميس. واللي يوصل بالليل، نتصل عليه من الساعة ١٠ الصبح بأول يوم دوام. ونحاول معه لين ٤ مرات، خلال ٣ أيام دوام.
- (Stop 3, a UAE client, the hours) من ١٠ الصبح إلى ٦ المسا بتوقيت السعودية، يعني من ١١ الصبح إلى ٧ المسا بتوقيت الإمارات.
- (Stop 6) شوفوا هالخط: اللي ما يحضر، يرجع لنا، ونتصل عليه ونحجز له من جديد.
- (Stop 6, came and thinking it over) واللي حضر وقاعد يفكر، نتابعه إحنا وأنتم: فريق الاتصال عندنا يتصل عليه ويتابع معه، وأنتم بعد تتابعونه، لأنكم قابلتوه وتعرفونه أكثر. وبعدها سجلوا النتيجة.
- **Temp check:** فيه خطوة هنا تبونها تمشي بطريقة ثانية؟

## L3 · `ads`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `ads.eyebrow` | Your customer sees this | هذا اللي يشوفه عميلكم |
| `ads.title` | Your ads | إعلاناتكم |
| `ads.tag` | Preview | معاينة |
| `ads.line` | We can show any of your creatives in the phones, right now. | نقدر نوريكم أي تصميم من تصاميمكم على الجوالات، الحين. |
| `ads.line.empty` | How your ads will look on your customers' phones. | بهالشكل بتطلع إعلاناتكم على جوالات عملائكم. |
| `ads.frame.igfeed` | Instagram feed | فيد إنستقرام |
| `ads.frame.igstory` | Instagram Stories and Reels | ستوري وريلز إنستقرام |
| `ads.frame.fbfeed` | Facebook feed | فيد فيسبوك |
| `ads.sponsored` | Sponsored | مُموَّل |
| `ads.tray.title` | Your creatives | تصاميم إعلاناتكم |
| `ads.tray.uploaded` | Uploaded | المرفوعة |
| `ads.tray.meta` | From your Meta ads | من إعلاناتكم في ميتا |
| `ads.tag.starter` | Starter, from our templates | إعلان بداية، من قوالبنا |
| `ads.tag.starter.short` (tray thumbnail) | Template | قالب |
| `ads.foot.starter` | Previews of starter ads, from our templates. Meta fits each ad to the screen it shows on. | معاينات لإعلانات البداية، من قوالبنا. ميتا تضبط كل إعلان على الشاشة اللي يطلع فيها. |
| `ads.planned` | Planned next: {platforms} | الخطوة الجاية: {platforms} |
| `ads.empty` | We're finishing your first ads | نشتغل على أول إعلاناتكم الحين |
| `ads.meta.empty` | Nothing built in Meta yet. | ما انبنى شي في ميتا للحين. |

**Call-to-action labels inside the phones (Meta's Arabic, check against a live preview)**

| Meta value | English | Arabic |
|---|---|---|
| LEARN_MORE | Learn more | معرفة المزيد |
| GET_QUOTE | Get quote | الحصول على عرض أسعار |
| BOOK_NOW | Book now | احجز الآن |
| CONTACT_US | Contact us | اتصل بنا |
| SIGN_UP | Sign up | تسجيل |
| WHATSAPP_MESSAGE | Send WhatsApp message | إرسال رسالة واتساب |
| APPLY_NOW | Apply now | تقدّم الآن |

The three phones share one app language (DESIGN 7.1): the language most of the client's creatives are in, else the deck's. Each ad's own text keeps its own direction.

**Spoken lines (Arabic)**
- أي واحد فيها بيوقفكم وأنتم تقلّبون جوالكم؟
- خلوني أحط هذا مكانه الحين، وشوفوا كيف يطلع بالفيد.
- (A wrong fact) خلوني أكتبها، ونصلحها.
- (A preference) هذي نتكلم عنها بالشريحة الجاية.
- هذي معاينة بس، مو موافقة.

## L4 · `creative-freedom`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `test.title` | Your red lines are fixed. The rest, we test. | خطوطكم الحمراء ثابتة، والباقي نختبره. |
| `test.page.name` | Your page stays yours | صفحتكم تبقى لكم |
| `test.page.copy` | Ads show in the feed, marked Sponsored, to people who don't know you yet. They don't appear on your page. | الإعلانات الممولة تطلع بالفيد ومكتوب عليها مُموَّل، لناس ما يعرفونكم للحين. وما تطلع على صفحتكم. |
| `test.page.foot` | The polished work belongs in your page's own posts. | والشغل الفخم والمرتب مكانه حسابكم نفسه. |
| `test.page.leader` | Marked Sponsored | مكتوب عليه مُموَّل |
| `test.fixed.name` | Fixed: your red lines | الثابت: خطوطكم الحمراء |
| `test.fixed.always` | Always … | دايماً … |
| `test.fixed.never` | Never … | أبد ما … |
| `test.fixed.told` | You told us: {red line}. | قلتوا لنا: {red line}. |
| `test.fixed.copy` | We never cross these. You approve every fact, price and claim. Anything wrong or off-brand, we fix. | وهذي ما نتعداها أبد. وأنتم توافقون على كل معلومة، وكل سعر، وكل وعد نقوله عنكم. وأي شي غلط أو ما يشبه هويتكم، نصلحه. |
| `test.fixed.fallback` | No red lines written yet. Tell us now and we'll add them to your card. | ما عندنا خطوط حمراء مكتوبة للحين. قولوها لنا الحين، ونضيفها لملفكم. |
| `test.open.name` | Open: everything else we test | المفتوح: كل شي ثاني نختبره |
| `test.open.chips` | Angles · Hooks · Formats · Thumbnails · Who's on camera | الزوايا · البداية اللي تشد · طرق العرض · صورة الغلاف · مين يطلع بالفيديو |
| `test.open.pick` | Your pick runs too, beside the ones you'd skip. The numbers tell us which work. | اختياركم ينزل بعد، جنب اللي يمكن ما تختارونها. والأرقام هي اللي توضح لنا أي واحد يشتغل. |
| `test.open.pick.none` | The ones you'd pick run too, beside the ones you'd skip. The numbers tell us which work. | اللي تختارونها تنزل بعد، جنب اللي يمكن ما تختارونها. والأرقام هي اللي توضح لنا أي واحد يشتغل. |
| `test.open.approve` | You approve your ads in the group. | توافقون على إعلاناتكم بالقروب. |
| `test.footer` | Prefer something different later? Ask, and we'll launch it too. | تبون شي ثاني بعدين؟ اطلبوه، وننزله بعد. |
| `test.proof.name` | How a test runs | بهالشكل يمشي الاختبار |
| `test.proof.caption` | One campaign, 20 versions side by side. Some stay on, some go off. | حملة وحدة، فيها ٢٠ نسخة مع بعض. بعضها يكمل، وبعضها يوقف. |
| `test.proof.tag` | Illustration | توضيح |
| `test.stamp` | Agreed to test this way · {date} | اتفقنا نختبر بهالطريقة · {date} |

The red lines are the client's own Do's and Don'ts as written on their card, and anything typed on O7, shown as written. When a red line is in English, it stays in English inside the Arabic panel.

**Spoken lines (Arabic)**
- أنتم جيتونا عشان الأداء، وإحنا نفضّل نحمي الأداء على إننا نحمي شكل معين.
- فيه شي ثاني ما تبونا نقوله أو نوريه أبد؟
- أي تغيير تبونه، اطلبوه بالقروب، ونرد عليكم بالسبب.
- (If they want to wait for a perfect ad) الإعلان اللي ينتظر النسخة المثالية، ما يجيب شي وهو ينتظر.
- **Temp check:** متفقين نختبر بهالطريقة؟

## L5 · `form`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `form.eyebrow` | Your customer sees this | هذا اللي يشوفه عميلكم |
| `form.title` | Your form | نموذج إعلانكم |
| `form.line` | What they answer before we call. Questions marked 'Filters' screen out people who aren't a fit. | اللي يجاوب عليه العميل قبل لا نتصل. والأسئلة اللي عليها فلتر تطلّع اللي ما يناسبونكم. |
| `form.line.dwy` | What they answer before your team calls. Questions marked 'Filters' screen out people who aren't a fit. | اللي يجاوب عليه العميل قبل لا يتصل فريقكم. والأسئلة اللي عليها فلتر تطلّع اللي ما يناسبونكم. |
| `form.tag.gate` | Filters | فلتر |
| `form.label.page` | Your page | صفحتكم |
| `form.stop.1` | Opening | البداية |
| `form.stop.2` | The questions | الأسئلة |
| `form.stop.3` | The thank-you screen | صفحة الشكر |
| `form.stop.3.line` | Then your thank-you screen, and a welcome message. | وبعدها صفحة الشكر، ورسالة ترحيب. |
| `form.stop.3.video` | Then your thank-you screen, and a welcome message with a short video about you. | وبعدها صفحة الشكر، ورسالة ترحيب فيها فيديو قصير يعرّف عنكم. |
| `form.thanks.default` | Thank you. Our team will call you within 5 minutes during working hours. | شكراً لك. فريقنا بيتصل عليك خلال ٥ دقايق في أوقات الدوام. |
| `form.fallback` | We're finishing yours. (The "Example form" tag over the phone already says what it is.) | نشتغل على نموذجكم. |
| `form.whatsapp` | Your ad opens a WhatsApp chat. | إعلانكم يفتح محادثة واتساب. |
| `form.whatsapp.message` (Example wording) | Hi, I saw your ad. I'd like to know more about {service}. | السلام عليكم، شفت إعلانكم وأبي أعرف أكثر عن {service}. |
| `form.whatsapp.message.any` | Hi, I saw your ad and I'd like to know more. | السلام عليكم، شفت إعلانكم وأبي أعرف أكثر. |
| `form.whatsapp.next` | What happens next | اللي يصير بعدها |
| `form.whatsapp.next.1` | Their first message is ready in the chat. They tap send. | رسالته الأولى جاهزة بالمحادثة، ويضغط إرسال. |
| `form.whatsapp.next.2` | It arrives on your WhatsApp. | توصل على الواتساب عندكم. |
| `form.whatsapp.next.3` | Our team calls them within 5 minutes during working hours. | وفريقنا يتصل عليه خلال ٥ دقايق في أوقات الدوام. |
| `form.whatsapp.next.3.dwy` | Your team calls them. | وفريقكم يتصل عليه. |

**The example form** (drawn when no form is confirmed; it speaks to the customer, so it is singular)

| Part | English | Arabic |
|---|---|---|
| Greeting | Thanks for your interest. A few quick questions about your project. | شكراً على اهتمامك. كم سؤال سريع عن مشروعك. |
| Question 1 | Which service do you need? · {service} · Something else | أي خدمة تحتاج؟ · {service} · غيرها |
| Question 2 (Filters) | When would you like to start? · Within a month · In 1 to 3 months · Not sure yet | متى تبي تبدي؟ · خلال شهر · بعد شهر إلى ٣ شهور · للحين ما قررت |
| Question 3 | Is the project a home or a business? · Home · Business | المشروع بيت ولا محل تجاري؟ · بيت · تجاري |
| Contact fields | Full name · Phone number · Email · City · Filled in by Meta · Next | الاسم الكامل · رقم الهاتف · البريد الإلكتروني · المدينة · تعبّيه ميتا تلقائياً · التالي |

With no service known, question 1 is left out (a choice whose only option is "Something else" is not a question), and the form slide walks two questions. Journey stop 2 shows the questions screen from its top, the first question first.

The headline, questions and options of a confirmed form are the client's own, in the form's language.

**Spoken lines (Arabic)**
- هذا أول فلتر، والمكالمة هي الفلتر الثاني.
- أسماء الخدمات والمناطق والكلام هنا، كلها صحيحة؟
- (If they want more questions) كل سؤال زيادة يطيّر معه ناس زينين بعد. نضيف سؤال لما الاستفسارات توضح إننا نحتاجه.
- (If they ask about night) واللي يوصل بالليل، نتصل عليه من الساعة ١٠ الصبح بأول يوم دوام.

## L6 · `call`

The turns, slots, pain variants, budget bands and both dialects are in `EXAMPLE-CALL.md`. The strings around the call:

**On screen**

| Key | English | Arabic |
|---|---|---|
| `call.eyebrow` | Our team does this | هذا اللي يسويه فريقنا |
| `call.title` | How we'll speak to your customers | كيف نكلم عملاءكم |
| `call.tag` | Example written from our script | مثال مكتوب من سكربتنا |
| `call.line` | {client.name} · {prep.service_focus} | {client.name} · {prep.service_focus} |
| `call.label` | The customer in it is made up. | العميل في هالمكالمة مو حقيقي. |
| `call.stop.7` | After the call | بعد المكالمة |
| `call.stop.8` | What lands with you | اللي يوصلكم |
| `call.stage.1` | The opening | المقدمة |
| `call.stage.2` | Their goal | تحديد الهدف |
| `call.stage.3` | The details | التفاصيل |
| `call.stage.4` | What sets you apart | اللي يميزكم |
| `call.stage.5` | The booking | الحجز |
| `call.stage.6` | Locking it in | تثبيت الموعد |
| `call.card` | Calling for {Company} | نتصل باسم {Company} |
| `call.clock.on` | On the call | على المكالمة |
| `call.clock.end` | Call ended | انتهت المكالمة |
| `call.speaker.agent` | Our caller | فريقنا |
| `call.speaker.lead` | Customer | العميل |
| `call.legend` | Words in teal came from your files. | الكلمات الملونة من ملفاتكم. |
| `call.chip.missing` | To give us | نحتاجه منكم |
| `call.after.label` | Example wording | صياغة للتوضيح |
| `call.after.heading` | What we do before the meeting | اللي نسويه قبل الموعد |
| `call.after.1` | Booked: a WhatsApp confirmation | عند الحجز: تأكيد على الواتساب |
| `call.after.2` | The day before: a reminder | قبلها بيوم: تذكير |
| `call.after.3` | A confirmation call | مكالمة تأكيد |
| `call.after.4` | 2 hours before: an SMS | قبلها بساعتين: رسالة نصية |
| `call.after.5` | The meeting | الموعد |
| `call.lands.*` | (stop 8, the appointment card) | see `EXAMPLE-CALL.md`, "Stop 8" |
| `call.guide` | Your caller's facts come from your call guide in Mahara OS. Check it, and fill in anything marked 'To give us'. | معلومات فريق الاتصال تجي من دليل مكالماتكم في Mahara OS. راجعوه، وكمّلوا أي شي عليه نحتاجه منكم. |
| `call.guide.unchecked` | Send us anything marked 'To give us' in the group, and we'll add it to your call guide. | أرسلوا لنا بالقروب أي شي عليه نحتاجه منكم، ونضيفه لدليل مكالماتكم. |

The stage names follow the sales deck's `stages` (المقدمة، تحديد الهدف) where they fit. "What sets you apart" matches the call's own `[اللي يميزكم]` slot; ليش أنتم read as a challenge ("why you, of all people?").

**DWY**

| Key | English | Arabic |
|---|---|---|
| `call.title.dwy` | How your team should call | كيف يتصل فريقكم |
| `call.label.dwy` | The customer in it is made up. The full script is in the playbook we give you. | العميل في هالمكالمة مو حقيقي، والسكربت كامل بالدليل اللي نعطيكم إياه. |
| `call.card.dwy` | Calling for {Company} | اتصال باسم {Company} |
| `call.tag.dwy` | Our script, for your team | سكربتنا، لفريقكم |
| `call.after.line.dwy` | Book on the right calendar, and the confirmation goes out by itself. | احجزوا على التقويم الصح، والتأكيد يطلع للعميل تلقائياً. |
| `call.after.heading.dwy` | Before the meeting | قبل الموعد |
| `call.after.1.dwy` | Booked: a confirmation | عند الحجز: تأكيد |
| `call.after.2.dwy` | Reminders before the meeting | تذكيرات قبل الموعد |
| `call.after.3.dwy` | Provisional bookings: your team calls 48 and 24 hours before | الحجوزات المبدئية: فريقكم يتصل قبلها بيومين، وقبلها بيوم |
| `call.after.4.dwy` | The meeting | الموعد |
| `call.lands.notes.dwy` | Your caller's notes | ملاحظات فريق الاتصال عندكم |
| `call.lands.caption.dwy` | It lands in your CRM. | الموعد ينزل في الـCRM عندكم. |

**Spoken lines (Arabic)**
- هذا السكربت اللي نستخدمه، ومعلوماتكم داخله. فريق الاتصال يتكلم باسمكم، كقسم المواعيد عندكم.
- الكلمات الملونة من ملفاتكم. واللي عليه نحتاجه منكم، تقدرون تعطونا إياه الحين.
- إذا تبون فريق الاتصال يذكر سعر يبدي منه، ضيفوه بالدليل. السكربت ما يذكر سعر ما عندنا.
- (Stop 7) وهذا اللي نسويه قبل الموعد.
- (Stop 8) كل اللي عرفه فريق الاتصال يوصلكم، فتدخلون الموعد وأنتم عارفين المشروع.
- مكالماتكم الحقيقية بتسمعونها في Mahara OS، وبوريكم إياها الحين.
- **Temp check:** هذي الطريقة اللي تبون نكلم فيها عملاءكم؟ وفيه شي ما نقوله أبد؟
- (DWY) هذي الطريقة اللي نبي فريقكم يتصل فيها: نفس المراحل الست، ونفس السكربت، ومعلوماتكم داخله.

## L7 · `portal`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `portal.eyebrow` | You do this | هذا اللي تسوونه |
| `portal.title` | Mahara OS, your portal | Mahara OS، بوابتكم |
| `portal.tag` | Demo workspace | حساب تجريبي |
| `portal.1.name` | Where things stand | وين وصلنا |
| `portal.1.copy` | Your next appointments, and anything waiting on you. | مواعيدكم الجاية، وأي شي ينتظر ردكم. |
| `portal.2.name` | Your calls, recorded | مكالماتكم مسجلة |
| `portal.2.copy` | Listen back to the calls we make for you, in Mahara OS. | اسمعوا المكالمات اللي نسويها لكم في Mahara OS. |
| `portal.3.name` | On your phone | على جوالكم |
| `portal.3.copy` | Install it like an app. | نزّلوه مثل أي تطبيق. |
| `portal.links` (copied into the group) | Mahara OS: {url} · Install it on your phone: {url} | Mahara OS: {url} · نزّلوه على جوالكم مثل أي تطبيق: {url} |
| `portal.4.name` | Your number-one job: mark every meeting | أهم شغلة عليكم: سجلوا نتيجة كل موعد |
| `portal.4.copy` | Did they come? Did you quote? Did you win? A few taps, the same day. | حضر؟ عطيتوه عرض سعر؟ وقّع معكم؟ كم ضغطة، بنفس اليوم. |
| `portal.4.asks` | Did they come? · Did you quote? · Did you win? | حضر؟ · عطيتوه عرض سعر؟ · وقّع معكم؟ |
| `portal.4.taps` | A few taps, the same day. | كم ضغطة، بنفس اليوم. |
| `portal.4.footer` | What isn't marked can't be improved. | اللي ما ينسجل، ما نقدر نحسّنه. |

**DWY**

| Key | English | Arabic |
|---|---|---|
| `portal.title.dwy` | Your CRM | الـCRM عندكم |
| `portal.4.name.dwy` | Your number-one job: keep every stage true | أهم شغلة عليكم: كل مرحلة تكون صحيحة |
| `portal.4.copy.dwy` | Move each meeting to the right stage in the CRM the same day: didn't show, showed, quote sent, closed. | انقلوا كل موعد للمرحلة الصح في الـCRM بنفس اليوم: ما حضر، حضر، انرسل عرض السعر، وقّع. |

**Spoken lines (Arabic)**
- إذا ما سجلتوا دخول للحين، خلنا نسويها الحين.
- (Stop 4) هذي أكثر شغلة تنتسى، فخلونا نوقف عندها شوي.
- النتائج توضح لنا أي إعلانات تجيب مشاريع حقيقية، فنحط عليها أكثر.
- والبوابة تقدر تذكركم بعد كل موعد عشان تسجلون نتيجته.
- وإذا تستخدمون شيت التقارير، الاثنين يتحدثون مع بعض.

## L8 · `your-part`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `part.title` | Your part | دوركم |
| `part.line` | Your five jobs, in one place. | خمس شغلات عليكم، بمكان واحد. |

| # | English job | Arabic job | English why | Arabic why |
|---|---|---|---|---|
| 1 | Leave the ads running through the first weeks | خلوا الإعلانات شغالة أول الأسابيع | Ads need time before we can tell which ones work. | الإعلانات تحتاج وقت، قبل لا نعرف أي واحد فيها يشتغل. |
| 2 | Mark every meeting, the same day | سجلوا نتيجة كل موعد، بنفس اليوم | Your outcomes show which ads bring real projects. | نتائجكم توضح أي إعلانات تجيب مشاريع حقيقية. |
| 3 | Keep your Drive folder fed | خلوا مجلد الدرايف مليان | Fresh projects keep your ads from tiring. | المشاريع الجديدة تخلي إعلاناتكم ما تبهت. |
| 4 | Keep the offer steady while we test | ثبّتوا العرض وإحنا نختبر | Want to change it? Ask in the group first. A new offer mid-test starts the test again. If you ask first, we can plan it in. | تبون تغيرونه؟ قولوا لنا بالقروب أول. العرض الجديد بنص الاختبار يرجّعه من البداية. وإذا قلتوا لنا أول، نرتب له. |
| 5 | Block busy times and holidays in your calendar | سكروا أوقات انشغالكم وإجازاتكم بالتقويم | Our callers book into the times you leave free. | فريق الاتصال يحجز بالأوقات اللي تخلونها فاضية. |

The calendar day on row 5 names its blocked hour: Busy · مشغول.

**DWY**

| # | English job | Arabic job | English why | Arabic why |
|---|---|---|---|---|
| 2 | Call within 5 minutes, note every try, keep every stage true | اتصلوا خلال ٥ دقايق، وسجلوا كل محاولة، وخلوا كل مرحلة صحيحة | Interest fades, and a missing note means nobody knows what happened. | الحماس يبرد، والملاحظة الناقصة تخلي ماحد يعرف اللي صار. |
| 5 | (unchanged) | (unchanged) | Your team books into the times you leave free. | فريقكم يحجز بالأوقات اللي تخلونها فاضية. |

**Spoken lines (Arabic)**
- هذي خمس شغلات عليكم، بمكان واحد. وبأرسل لكم هالكرت بالقروب.
- تبون تغيرون العرض أو الخدمة؟ قولوا لنا بالقروب أول، ونرتبها بطريقة ما ترجّع التجربة من الصفر.
- أكثر أسئلة يسألها فريق الاتصال: موعد برا أوقات دوامكم، أو إجازة، أو تفصيلة عن خدمة.
- وما يحتاج تردون يوم الجمعة أو بالليل.
- **Temp check:** أي وحدة من هذي بتكون أصعب على فريقكم؟

## L9 · `first-90-days`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `days.title` | Your first 90 days | أول ٩٠ يوم |
| `days.goal` | Your 90-day goal, in your words: {form.goal90} | هدفكم خلال ٩٠ يوم، بكلامكم: {form.goal90} |
| `days.goal.foot` | A target, not a promise of results. | هدف، مو وعد بنتائج. |
| `days.1.when` | Weeks 1 and 2 · Finding what works | أول أسبوعين · نكتشف اللي يشتغل لكم |
| `days.1.open` | Can run longer | ممكن تطوّل |
| `days.2.when` | Your first check-in · a week or two in | أول مكالمة متابعة · بعد أسبوع أو أسبوعين |
| `days.2.date` | {next.checkin} | {next.checkin} |
| `days.3.when` | Then weekly or every two weeks | وبعدها كل أسبوع أو كل أسبوعين |
| `days.3.why` (its own line under the key, in ink-2, and in the notes) | Depending on your plan and how long you've been with us. | على حسب باقتكم، وكم صار لكم معنا. |
| `days.3.line` | 20 to 30 minutes on Zoom: what's working, and what we're changing. | من ٢٠ إلى ٣٠ دقيقة على زوم: اللي شغال، واللي بنغيره. |
| `days.4.line` | At 30, 60 and 90 days, that check-in looks back over the month. | عند ٣٠ و٦٠ و٩٠ يوم، مكالمة المتابعة تراجع الشهر كامل. |
| `days.ms.label` | In this order, not on a date: | بهالترتيب، مو بتاريخ: |
| `days.ms.1` | First booking | أول موعد |
| `days.ms.2` | First attended appointment | أول عميل حضر |
| `days.ms.3` | First won project | أول مشروع موقّع |
| `days.footer` | Dates depend on your market, your offer and your follow-up. We track them with you. | التواريخ تعتمد على سوقكم وعرضكم ومتابعتكم، ونتابعها معكم. |
| `days.day90` | Day 90 | يوم ٩٠ |
| `days.fallback.weeks` | Week 1 … Week 12, then Day 90 | الأسبوع ١ … الأسبوع ١٢، وبعدها يوم ٩٠ |

The three milestones are the sales deck's `MILESTONES` Arabic, unchanged.

**Spoken lines (Arabic)**
- فيه بدايات تكون زحمة، وفيه بدايات هادية. وبالحالتين، إحنا نكتشف اللي يتفاعل معه سوقكم.
- والتحديثات توصلكم بالقروب أول بأول.
- بعد أول مكالمة متابعة، تكون المكالمات كل أسبوع أو كل أسبوعين، على حسب باقتكم، وكم صار لكم معنا.
- مكالمات المتابعة: لابتوب ومكان هادي، مو وأنتم بالسيارة. واللي بعدها نحجزها بآخر كل مكالمة.
- **Temp check:** هالإيقاع يناسبكم؟
- (DWY) أول حجز بيكون من فريقكم.

## L10 · `green-light`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `green.title` | Before we go live | قبل لا ننطلق |
| `green.card.charges` | Meta's first charges on your card are small. That's normal. Tell your bank so it doesn't block them. | أول مبالغ تخصمها ميتا من بطاقتكم تكون صغيرة، وهذا طبيعي. بلّغوا البنك عشان ما يوقفها. |
| `green.card.comments` | Comments on your ads are yours to answer. Not sure what to say? Ask in the group. | التعليقات على إعلاناتكم، الرد عليها عليكم. ما تدرون كيف تردون؟ اسألونا بالقروب. |
| `green.card.hours` | We reply 10 to 6, Saturday to Thursday. | نرد من ١٠ صباحاً إلى ٦ مساءً، من السبت إلى الخميس. |
| `green.question` | Happy for us to go live? | على بركة الله، ننطلق؟ |
| `green.next` | Your first check-in · {next.checkin} | أول مكالمة متابعة · {next.checkin} |
| `green.rail` | Go-live · {go_live} | الإطلاق · {go_live} |

على بركة الله is how a Gulf owner gives a green light, in Kuwait and in Saudi Arabia alike.

**Spoken lines (Arabic)**
- قبل لا نكمل، عندكم أي سؤال؟
- على بركة الله، ننطلق؟
- خلنا نحجز أول مكالمة متابعة، بعد الإطلاق بأسبوع أو أسبوعين.
- (If they hesitate) فيه شي واحد لو انحل، ترتاحون أكثر؟ خلنا نحله الحين، أو نتفق متى ينحل.
- إذا أي شي شغل بالكم بأي وقت، قولوا لي. أنجح شركائنا هم اللي يقولون لنا الزين والشين.

---

# Appendix: canvas labels that live in DESIGN.md

`DESIGN.md` draws a few labels on the canvas that `CONTENT.md` does not list. They are given here so the Arabic is in one place. The decision table in `CONTENT.md` rules wherever the two files once disagreed, and `DESIGN.md` 16.2 rules on media. Notes-window and prep-view strings are cockpit UI, in English, and are not listed.

| Where (DESIGN) | English | Arabic |
|---|---|---|
| 5.4 tags | Preview · Your form · Example form · Example · Example wording · Example written from our script · Demo workspace · Starter, from our templates · Illustration | معاينة · نموذجكم · نموذج للتوضيح · مثال · صياغة للتوضيح · مثال مكتوب من سكربتنا · حساب تجريبي · إعلان بداية، من قوالبنا · توضيح |
| 6.5 queue card | New enquiry · {service} | استفسار جديد · {service} |
| 6.5 queue card | Try 2 of 4 · {service} · 5 pm | المحاولة ٢ من ٤ · {service} · ٥ مساءً |
| 6.5 queue card | Callback · {service} · 10 am | معاودة اتصال · {service} · ١٠ صباحاً |
| 6.5 queue card | Not reached after 4 tries · reason noted | ما ردّ بعد ٤ محاولات · السبب مكتوب |
| 6.5 queue card | Came in at night? Called from 10 the next working morning. | وصل بالليل؟ نتصل عليه من الساعة ١٠ صباح أول يوم دوام. |
| 6.8 queue chip, DWY | Your team | فريقكم |
| 6.5 calendar entry | {day} · 4 pm · Appointment · {place} | {day} · ٤ مساءً · موعد · {place} |
| 7.2 to 7.4 Meta chrome | See more · Like · Comment · Share | عرض المزيد · أعجبني · تعليق · مشاركة |
| 7.3 label | Reels and Stories | ريلز وستوري |
| 8.3 leaders | Your page and logo · Marked {word} · Your picture or video · Your words · The button: Learn more | صفحتكم وشعاركم · مكتوب عليه {word} · صورتكم أو الفيديو · كلامكم · الزر: معرفة المزيد |
| 8.3 leaders, {word} | The word as the phone shows it, in the phone's language: Sponsored, or مُموَّل | |
| 8.3 crop leader | Meta crops this to 4:5 in the feed | ميتا تقص هذا على مقاس ٤:٥ في الفيد |
| 8.3 phone fallback | Your ad goes here | إعلانكم هنا |
| 8.3 foot | Previews. Meta fits each ad to the screen it shows on. | معاينات. ميتا تضبط كل إعلان على الشاشة اللي يطلع فيها. |
| 8.5 list | The questions · Choice · Then: your thank-you screen | الأسئلة · اختيار · وبعدها: صفحة الشكر |
| 8.9 rows | Finding what works · Check-ins · Go-live | نكتشف اللي يشتغل · مكالمات المتابعة · الإطلاق |
| 9.3 group header | Your WhatsApp group | قروب الواتساب |
| 9.4 matrix | + Add a service · Your first campaign | + أضيفوا خدمة · أول حملة |
| 9.7 label | Next | الخطوة الجاية |
| 10.1 in-use chips | Feed · Reels · Facebook feed | فيد · ريلز · فيد فيسبوك |
| 12 a slide that could not be drawn | This slide could not be drawn. | ما قدرنا نعرض هالشريحة. |
| 12.1 chrome | Back to {client} · Notes · All slides · Full screen | رجوع إلى {client} · الملاحظات · كل الشرائح · ملء الشاشة |
| 12.1 closed screen | Deck closed | انتهى العرض |

The thank-you default and the example form speak to the customer, so they are singular.

---

# Points for the lead

1. **Meta's Arabic labels** (مُموَّل, the call-to-action buttons, the instant form's fields) are unverified. Read them from a live Arabic preview.
2. **The CSM's Arabic title** needs a gender or an Arabic title on the seat (decision 8).
3. **Prep needs Arabic boxes** for the service focus, the selling point, the project, the red lines and any goal edits, or the Arabic deck shows English inside Arabic sentences.
4. **The Academy's onboarding course** is named in Latin (Onboarding) because the sales deck's Arabic, الأونبوردنق, is agency jargon and كورس البداية is a different course. If the Academy has an Arabic title for it, use that.
5. **The live WhatsApp confirmation template** in Arabic, word for word, so stop 7 of the call can copy it.

---

# Composition pass (2026-10-20)

The Arabic follows `CONTENT.md`'s composition pass line for line. No new Arabic was written: every changed string is built from the approved Arabic's own sentences and clauses (cut, or put in a different order), in the same slide-level white Gulf register, so the voice stays as the voice pass left it.

- `goals.titleAsk` is gone (the question is the slide's one heading).
- `road.stop.5.line` is split into `road.stop.5.time` («من ٢٠ إلى ٣٠ دقيقة») and the line («نمر معكم على كل شي بينزل.»).
- `test.eyebrow` is gone. `test.page.copy` keeps its first two clauses and folds «معمولة لناس ما يعرفونكم للحين» into them; its last sentence becomes `test.page.foot`. `test.open.approve` keeps its first clause; `test.footer` drops «بالقروب», said once on the same foot line.
- `portal.4.tag` is gone. `portal.4.copy` is set as its parts: the three questions (`portal.4.asks`) and «كم ضغطة، بنفس اليوم.» (`portal.4.taps`).
- `part.why` is gone (no column head).

---

# CEO answers (2026-10-20)

The Arabic follows `CONTENT.md`'s copy rules 1, 5 and 6 as rewritten that day, line for line, under the voice skill in the slide-level white Gulf register (Saudi-safe, the client in the plural, the customer singular). Decision 11 records the word choices.

- `journey.3` and the new `journey.3.line.uae`: «نتصل على الاستفسارات الجديدة خلال ٥ دقايق في أوقات الدوام» opens the line; «الاستفسارات الجديدة تطلع أول القائمة» is gone (the queue card shows the list); the hours and the night sentence are the approved Arabic, unchanged.
- `journey.3.dwy`: «اتصلوا أول ما يوصل» becomes «اتصلوا خلال ٥ دقايق.», and the tries keep the chip's own words. L8's DWY tile 2 «اتصلوا بسرعة» becomes «اتصلوا خلال ٥ دقايق».
- `journey.6.deciding`: «عليكم. تابعوه، وبعدها سجلوا النتيجة.» becomes «علينا وعليكم. نتصل عليه ونتابع معه، وأنتم بعد تتابعونه، لأنكم تعرفونه أكثر. وبعدها سجلوا النتيجة.» The DWY line is unchanged.
- `form.thanks.default` and `form.whatsapp.next.3` add «خلال ٥ دقايق في أوقات الدوام». The thank-you's «بيتواصل معك» becomes «بيتصل عليك», so the Arabic promises a call, as the English does and as the WhatsApp step beside it says (يتصل عليه); the rest of each line is the approved Arabic.
- `days.3.when` is «وبعدها كل أسبوع أو كل أسبوعين», and the new `days.3.why` is «على حسب باقتكم، وكم صار لكم معنا.»
- Spoken lines: stop 3 now says the promise, the hours, the night rule and the tries in one line (it replaces the night answer), and a second line gives a UAE client's hours, as the slide's UAE line does; L5 gains the night line «واللي يوصل بالليل، نتصل عليه من الساعة ١٠ الصبح بأول يوم دوام.» in the journey's own words; the no-show line adds «ونتصل عليه ونحجز له من جديد»; the shared follow-up at stop 6 (فريق الاتصال عندنا, so it is clear whose callers) and the rhythm on the 90 days are new.
- The done-with-you queue chip «فريقكم: اتصلوا الحين» becomes «فريقكم»: it says who calls, and the stop's words beside it say how fast (اتصلوا خلال ٥ دقايق). The done-for-you chip «أول القائمة» was never drawn and is gone.
- Unchanged on purpose: the chip «لين ٤ محاولات خلال ٣ أيام دوام», the first check-in «أول مكالمة متابعة · بعد أسبوع أو أسبوعين», the no-show «علينا. نتصل عليه ونحجز له من جديد.», and every DWY fork line.
