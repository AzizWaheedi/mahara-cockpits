# CSM decks: Arabic content

The Arabic for every on-screen string in `CONTENT.md`, slide by slide with the same ids, then the presenter lines the client success manager says out loud when the call is in Arabic. The example call itself is in `EXAMPLE-CALL.md`.

Written 2026-10-19 under `mahara-context/skills/aziz-kuwaiti-voice`, in the warm-professional client register for engineering, construction, fit-out and design firms, Saudi-safe. The register follows the client-facing Arabic Mahara already sends (`client-comms/csm-templates.md`, `onboarding-to-launch-csm.md`) and the Onboarding Map's own stop names. Revised the same day with `CONTENT.md` after the critique, again on 2026-10-20 with the CEO's answers to its open questions 1 to 3 (see its Revision notes and [the section at the end](#ceo-answers-2026-10-20)), and again on 2026-10-20 for the Gamma pass: two new launch slides (L7 partnership, L8 training), the good-to-know slide (L12), the changed portal, Your part, 90 days and green light, and the onboarding deck's reply time ([Gamma pass](#gamma-pass-2026-10-20) at the end). The launch deck has thirteen slides now; sections dated before that pass use the ten-slide numbers. Revised once more on 2026-10-20 with `CONTENT.md` for the CEO's creative flexibility (L3 in five stops, O7's line) and the video slots ([the section at the end](#creative-flexibility-and-video-slots-2026-10-20)), and again the same day with its spec review ([the last section](#spec-review-of-creative-flexibility-and-the-video-slots-2026-10-20)). Revised once more on 2026-10-20 for the CEO's visual pass ([The visual pass](#the-visual-pass-ceo-2026-10-20)): the call's checklist, the onboarding slides' new labels, the example ads and their alt text, L3's source lines and its `dos_donts_ar`, L7's two names, L8's line without Latin, and the Drive link's words.

## Decisions for the Arabic (made once, for both decks)

1. **We address the firm in the plural.** أنتم، عندكم، فريقكم، عملاؤكم. It reads as respect in Kuwait and in Saudi Arabia, and it covers a call with more than one partner on it. The journey's three lanes are عميلكم · فريقنا · أنتم. The customer (the client's buyer) is singular and generic: عميلكم، يشوف، نتصل عليه.
2. **Slide text is a white Gulf Arabic a Saudi engineering office reads as serious.** No ج/ي spelling swaps on slides. No Kuwaiti-only words (شنو، شلون، ماكو، وايد، عيل، هني، جذي، باجر، مال as a possessive). No Saudi-only words (وش، أبشر، إيش). Questions use كيف، ليش، متى، وين، أي. The example call is the only place that speaks a dialect, on purpose.
3. **Voice-skill rules kept:** تمام never طيب; بصراحة; نبدي and تبدي, not نبدأ; plain spoken verbs, never bookish ones (يحاكي، يجسد، يعكس); never مقاول for the client; loanwords in Arabic script where people say them (سكربت، كورس، لابتوب، زوم، فيد، ريلز، ستوري).
4. **Form:** no guillemets and no quote marks around Arabic words, no em dashes, no exclamation marks. ".." only inside spoken lines.
5. **Times:** on slides, ١٠ صباحاً and ٦ مساءً (how Gulf businesses write their hours). In spoken lines and in the call, الصبح، العصر، المسا.
6. **Numbers:** Arabic-Indic digits through `Fig`, never ٬, never a lone ٠, never a digit glued to بـ or لـ (write إلى ٦, not لـ٦). Small numbers inside speech are words (ست شهور، سنتين). The running call clock, the WhatsApp confirmation's date and time, and the Drive box's clock in {time} (أمس الساعة 09:05; a date before it keeps Arabic-Indic digits, يوم ١٦ أكتوبر) stay in Latin digits (DESIGN 13.4, 7.6, DRIVE-IMPORT 8); once the call ends, its length takes Arabic-Indic digits, ٤:٥١ (the fixer's round).
7. **Slots keep CONTENT's ids** in braces. Client and page names, handles and English words sit in `<bdi dir=auto>` (DESIGN 13.2). In the Arabic deck `{client.name}` is the Arabic name from `ghl_clients.client_name` when there is one.
8. **The presenting CSM's title is gendered in Arabic.** Store `csm.title_ar` on the seat, or a gender: مدير نجاح العملاء for a man, مديرة نجاح العملاء for a woman. With no name and no gender, the line reads فريق نجاح العملاء. Inside the O3 group, where the CSM is a role, the row reads نجاح العملاء.
9. **Meta's own Arabic labels** (مُموَّل and the button labels) are my best reading of Meta's Arabic interface. Check each against a live Arabic preview before shipping (DESIGN 17.2).
10. **The test is الاختبار on slides.** فترة التجربة reads as a trial or probation period, too close to the service itself being on trial, and نتعلم can sound like learning on the client's money. Slides say الاختبار، نختبر، نكتشف اللي يشتغل. نجرب stays in spoken lines only.
11. **The CEO's answers, 2026-10-20 (`CONTENT.md` copy rules 1, 5 and 6).** The call is خلال ٥ دقايق, always beside في أوقات الدوام with the hours, and the night line stays. دقايق is spelled as the sales deck spells it, so the client reads the same promise in both decks; it is the spoken Gulf spelling slides already use in رسايل, not a ج/ي swap. The check-in rhythm is كل أسبوع أو كل أسبوعين, never one of the two alone, with the reason على حسب باقتكم، وكم صار لكم معنا. باقة names our plan, because العرض on these decks is the client's own offer. The customer who came and is thinking it over is علينا وعليكم done for you, beside the no-show's علينا; done with you is unchanged.
12. **The Gamma pass, 2026-10-20.** The pie keeps the fork's words for ours and yours: its title ends وتوقيع المشروع عليكم. "Close" is توقيع المشروع (and التوقيع for the course's last part), as in the milestones' أول مشروع موقّع, never الإقفال. "The proposal" is عرض السعر, because العرض is the client's offer (decision 11). A referral is عميل جاكم بتوصية. "Within 2 working hours" is خلال ساعتين دوام. "Your agreement" is عقدكم, and its dates are التواريخ, never المواعيد (a موعد is a meeting). "Usually slower" is عادةً أهدأ, since the start is quiet, not late.
13. **Creative flexibility and the video slots, 2026-10-20.** "The next round" of ads is الإعلانات الجاية, never الدفعة (a دفعة is a payment, L12's دفعاتكم). "Bring in business" is تجيب لكم شغل, the way a firm owner says it, with no number in it. "Your input comes first" is نسمع منكم أول: warm, and active on our side. "A quick check" is مراجعة سريعة; "a style change" is تعديل على الشكل; "claims" stays الوعود, as the approved fixed-column copy said كل وعد نقوله عنكم. "Watch" is شوفوا, the spoken plural imperative the slides already use (قولوا، خلوا، سكروا). A video's length is said in words, دقيقة، دقيقتين، ٣ دقايق، ١١ دقيقة, never ٣:٠٥: a ٠ beside a colon reads as a dot (DESIGN 4.3), and دقايق is decision 11's spelling. Decision 10 still holds: نجرب stays in spoken lines, so a tile "tries" nothing on the slide; it has شي مختلف in it. Since the spec review the same day: "a new price" is سعر جديد; "how we test your ads", the recap's line, is كيف نختبر إعلاناتكم; the tag on the Academy's screenshots is لقطة من الأكاديمية; the held-back goal is هدفكم لأول ٩٠ يوم, said without the goal itself.

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
| Project Closing Mastery | إتقان توقيع المشاريع | the sales deck's name for the course |
| the close, to close (a project) | توقيع المشروع، يوقّع | never الإقفال (decision 12) |
| the proposal, a quote | عرض السعر | never العرض alone (decision 12) |
| a referral | عميل جاكم بتوصية | |
| within 2 working hours | خلال ساعتين دوام | decision 12 |
| your agreement | عقدكم | its dates: التواريخ (decision 12) |
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
| the next round (of ads) | الإعلانات الجاية | never الدفعة (decision 13) |
| a quick check | مراجعة سريعة | |
| a style change | تعديل على الشكل | |
| bring in business | تجيب لكم شغل | |
| Watch: (the video control) | شوفوا: | decision 13 |
| a video's length | دقيقة · دقيقتين · ٣ دقايق · ١١ دقيقة | words, never m:ss (decision 13) |
| Missed something on the call? | فاتكم شي بالمكالمة؟ | the recap's videos line |
| a new price | سعر جديد | decision 13 |
| How we test your ads | كيف نختبر إعلاناتكم | the recap's testing line (decision 13) |
| Academy screenshot | لقطة من الأكاديمية | tag (decision 13) |
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
| `welcome.eyebrow` | Onboarding call · {onboarding.date} | مكالمة التعريف، {onboarding.date} |
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
| `team.line` (one line, the fixer's round, 2026-10-20; the same in both service models) | Everyone who works on your account is in this one group. | كل اللي يشتغلون على حسابكم معكم في هالقروب. |
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
| `team.foot` | We reply within 2 working hours, 10 to 6, Saturday to Thursday. If something worries you, we call you. | نرد خلال ساعتين دوام، من ١٠ صباحاً إلى ٦ مساءً، من السبت إلى الخميس. وإذا فيه شي شاغل بالكم، نتصل عليكم. |
| `team.foot.uae` | We reply within 2 working hours, 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday. If something worries you, we call you. | نرد خلال ساعتين دوام، من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات)، من السبت إلى الخميس. وإذا فيه شي شاغل بالكم، نتصل عليكم. |

**DWY**

| Key | English | Arabic |
|---|---|---|
| `team.alerts.name.dwy` | New-enquiry alerts | تنبيهات الاستفسارات الجديدة |
| `team.alerts.line.dwy` | New enquiries arrive here too, for your callers. | الاستفسارات الجديدة توصل هنا بعد، لفريق الاتصال عندكم. |

**Spoken lines (Arabic)**
- كل واحد بالقروب يكلمكم عن شي واحد. وأنا نقطة تواصلكم معنا، لأي شي ثاني.
- الجمعة إجازة، والرسايل اللي توصل بعد الساعة ٦ نرد عليها بأول يوم دوام بعدها.
- والساعتين تنحسب من ساعات دوامنا بس: الرسالة اللي توصل الساعة خمس ونص، ممكن نرد عليها الصبح.
- خلنا نتأكد إن اللي يرتب مواعيدكم، واللي يقابل العملاء، موجودين بالقروب الحين.

## O4 · `one-service`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `one.title` | One service per campaign | خدمة وحدة لكل حملة |
| `one.line` | We launch with one service, so the ads, the form questions and the calls are all written for one kind of customer. | نبدي بخدمة وحدة، عشان الإعلانات والأسئلة والمكالمات كلها تكلم نوع واحد من العملاء. |
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
| `road.stop.4` | Brand Blueprint call | بناء الهوية والعرض |
| `road.stop.5` | Launch call | مكالمة الإطلاق |
| `road.stop.5.time` | About 45 minutes | تقريباً ٤٥ دقيقة |
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
| `week.3.line` | Before your Blueprint call: photos and videos in your Drive folder. Finished projects, work in progress, your team on site. Don't filter. We will. | قبل مكالمة بناء الهوية: صور وفيديوهات بمجلد الدرايف. مشاريع خلصت، وشغل قيد التنفيذ، وفريقكم بالموقع. لا تفلترون، إحنا نفلتر. (a no-break space between لا and تفلترون, so the negation never ends a line; final score round 1) |
| `week.3.link` | (link to {links.drive}) | مجلد الدرايف |
| `week.4.name` | Past enquiries | الاستفسارات القديمة |
| `week.4.line` | Have a list of old enquiries? Send it, and we'll agree whether to call them. | عندكم قائمة باستفسارات قديمة؟ أرسلوها، ونتفق إذا ينتصل عليهم. |
| `week.5.name` | The Academy | الأكاديمية |
| `week.5.line` | Courses for you and your team: your offer, closing your projects, your team and operations. Join, and start with the introduction. | كورسات لكم ولفريقكم: العرض، وتوقيع المشاريع، والفريق والتشغيل. انضموا، وابدوا بكورس البداية. |
| `week.links` (copied into the group) | Meta access (one link): {url} · Your Drive folder: {url} · The Academy: {url} · Mahara OS: {url} · Install Mahara OS on your phone: {url} | صلاحيات ميتا (رابط واحد): {url} · مجلد الدرايف: {url} · الأكاديمية: {url} · Mahara OS: {url} · نزّلوا Mahara OS على جوالكم مثل أي تطبيق: {url} |
| `week.links.testing` (new, score round 2: after the links, until the `testing` video is recorded) | Your ads are there to bring in business. We test many ads, fast, and small style changes go into the next round. Send your red lines in the group. | إعلاناتكم هدفها تجيب لكم شغل. نختبر إعلانات كثيرة وبسرعة، والتعديلات الصغيرة على الشكل تروح للإعلانات الجاية. وأرسلوا خطوطكم الحمراء بالقروب. |
| `week.status.todo` | To do | باقي |
| `week.status.done` | Done | تم |
| `week.status.unknown` | Not checked yet | ما تأكدنا للحين |

Since the spec review of 2026-10-20, O6 starts them on the introduction, the course the Academy marks START HERE, and «كورس البداية» is that course: L8 lists it as البداية. Course 2 is التعريف in L8's list, the deck's own word for onboarding (مكالمة التعريف), since the visual review of 2026-10-20.

**DWY**

| Key | English | Arabic |
|---|---|---|
| `week.2.name.dwy` | Your CRM | الـCRM عندكم |
| `week.2.line.dwy` | Sign in, and connect your calendar, so bookings land in your real calendar. | سجلوا دخول، واربطوا تقويمكم، عشان المواعيد تنزل بتقويمكم الحقيقي. |
| `week.2.ticks.dwy` | Signed in · Calendar | تسجيل الدخول · التقويم |
| `week.6.name.dwy` | Callers' phones | جوالات فريق الاتصال |
| `week.6.line.dwy` | Install the LeadConnector app, sign in and turn on alerts. | نزّلوا تطبيق LeadConnector، وسجلوا دخول، وفعّلوا التنبيهات. |

**Spoken lines (Arabic)**
- خلنا نخلص صلاحيات ميتا ومنصة Mahara OS الحين، مع بعض.
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
| `next.ads.approval` (changed by the spec review, 2026-10-20) | They go live only once you've approved the facts, prices and claims in them. | ما تنزل أي وحدة منها إلا بعد ما توافقون على المعلومات والأسعار والوعود اللي فيها. |
| `next.test.name` | The first weeks are a test | أول الأسابيع نختبر فيها الإعلانات |
| `next.test.line` (changed twice on 2026-10-20; the ads' job first since the fixer's round; three lines since score round 2, the same words) | Your ads are there to bring in business, not to look like your page. | إعلاناتكم هدفها تجيب لكم شغل، مو إنها تشبه صفحتكم. |
| `next.test.volume` (small, ink-2) | We test many ads, fast. Small style changes go into the next round, so your launch keeps moving. | نختبر إعلانات كثيرة، وبسرعة. والتعديلات الصغيرة على الشكل تروح للإعلانات الجاية، عشان إطلاقكم يمشي. |
| `next.test.ask` (small, ink, over the red lines) | Your red lines stay fixed: tell us now what we must never say or show. | وخطوطكم الحمراء ثابتة: قولوا لنا الحين اللي ما نقوله ولا نوريه أبد. |
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
- (The testing, in one breath, 2026-10-20) نسوي إعلانات كثيرة ونوقف أغلبها، عشان نلقى اللي يشتغل. وخطوطكم الحمراء هي الشي الوحيد اللي ما يتغير.
- (Before we make anything, the spec review) قبل لا نسوي أي إعلان: أفكاركم، وعرضكم، والمعلومات مثل الأسعار والخدمات والمناطق، قولوها بمكالمة بناء الهوية والعرض، أو أرسلوها بالقروب قبلها.
- خلنا نحجز مكالمة بناء الهوية والعرض الحين.
- **Temp check:** فيه شي مو واضح لكم قبل لا نحجز مكالمة بناء الهوية؟

---

# Launch deck

Order (since the fixer's round, 2026-10-20: creative freedom before the ads): L1 cover, L2 journey, L3 creative freedom, L4 ads, L5 form, L6 call, L7 partnership, L8 training, L9 portal, L10 your part, L11 first 90 days, L12 good to know, L13 green light.

## L1 · `cover`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `cover.eyebrow` | Launch call · {today} | مكالمة الإطلاق، {today} |
| `cover.title` | {client.name} goes live | انطلاقة {client.name} |
| `cover.title.live` | {client.name} is live | انطلقنا مع {client.name} |
| `cover.date` | {go_live} | {go_live} |
| `cover.line` | Everything your customers will see, before they see it. | كل شي بيشوفه عملاؤكم، تشوفونه قبلهم. |
| `cover.line.live` | Everything your customers see, and what happens next. | كل شي يشوفه عملاؤكم، واللي يصير بعدها. |
| `cover.road` | Launch call · Today | مكالمة الإطلاق، اليوم |
| `cover.footer` | {csm.first} · Your client success manager | {csm.first} · مدير نجاح العملاء (or مديرة نجاح العملاء) |

Both Arabic titles put the verb before the name, so a company name never forces a gender on the verb. On the cover the teal word is انطلاقة (or انطلقنا).

**Spoken lines (Arabic)**
- تقريباً ٤٥ دقيقة، ومعها وقت لأسئلتكم. بنمر على اللي بينزل، وعلى اللي يصير لما أحد يستفسر، وعلى مين يسوي كل خطوة، وعلى اللي نحتاجه منكم. وقفوني بأي وقت.
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
| 5 | `journey.5` | Lands with you | يوصلكم | Once it's confirmed, it lands in your calendar and in Mahara OS. WhatsApp alerts tell you about new bookings, cancellations and changes. | لما يتأكد الموعد، ينزل بتقويمكم وفي Mahara OS. وتوصلكم تنبيهات على الواتساب بالمواعيد الجديدة، وبأي إلغاء أو تغيير. |
| 5 | `journey.5.nocal` | | | Connect Google Calendar in Mahara OS so bookings land there. | اربطوا تقويم قوقل في Mahara OS عشان المواعيد تنزل فيه. |
| 6 | `journey.6` | You meet | تقابلونه | You hold the meeting: {form.consult_types}. | تقابلونه: {form.consult_types}. |
| 6 | `journey.6.noshow` | | | Didn't show? Ours. We call to rebook. | ما حضر؟ علينا. نتصل عليه ونحجز له من جديد. |
| 6 | `journey.6.deciding` | | | Came, still thinking it over? Both of us. We call to follow up, and so do you: you know them best. Then mark it. | حضر وقاعد يفكر؟ علينا وعليكم. نتصل عليه ونتابع معه، وأنتم بعد تتابعونه، لأنكم تعرفونه أكثر. وبعدها سجلوا النتيجة. |
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
| 6 | `journey.6.deciding.dwy` | | | Came, still thinking it over? Follow up, then move it to the right stage. | حضر وقاعد يفكر؟ تابعوه، وبعدها انقلوه للمرحلة الصح. |
| 7 | `journey.7.dwy` | You mark it | تسجلون النتيجة | Your team moves it to the right stage in the CRM, the same day. | فريقكم ينقله للمرحلة الصح في الـCRM، بنفس اليوم. |

**Spoken lines (Arabic)**
- (Stop 3) نتصل على الاستفسارات الجديدة خلال ٥ دقايق في أوقات الدوام، من ١٠ الصبح إلى ٦ المسا، من السبت إلى الخميس. واللي يوصل بالليل، نتصل عليه من الساعة ١٠ الصبح بأول يوم دوام. ونحاول معه لين ٤ مرات، خلال ٣ أيام دوام.
- (Stop 3, a UAE client, the hours) من ١٠ الصبح إلى ٦ المسا بتوقيت السعودية، يعني من ١١ الصبح إلى ٧ المسا بتوقيت الإمارات.
- (Stop 6) شوفوا هالخط: اللي ما يحضر، يرجع لنا، ونتصل عليه ونحجز له من جديد.
- (Stop 6, came and thinking it over) واللي حضر وقاعد يفكر، نتابعه إحنا وأنتم: فريق الاتصال عندنا يتصل عليه ويتابع معه، وأنتم بعد تتابعونه، لأنكم قابلتوه وتعرفونه أكثر. وبعدها سجلوا النتيجة.
- **Temp check:** فيه خطوة هنا تبونها تمشي بطريقة ثانية؟

## L3 · `creative-freedom` (creative flexibility, reworked 2026-10-20)

Five stops, as `CONTENT.md` L3 sets them. The keys after `test.title` are new or changed on 2026-10-20 unless marked "approved".

**On screen**

| Key | English | Arabic |
|---|---|---|
| `test.title` (approved) | Your red lines are fixed. The rest, we test. | خطوطكم الحمراء ثابتة، والباقي نختبره. |
| `test.job.name` (stop 1) | Your ads have one job | إعلاناتكم لها مهمة وحدة |
| `test.job.copy` | Your page shows your brand. Your ads are there to bring in business: enquiries from people who don't know you yet. | صفحتكم تعرض هويتكم. وإعلاناتكم موجودة عشان تجيب لكم شغل: استفسارات من ناس ما يعرفونكم للحين. |
| `test.job.small` (no absolute, the fixer's round: a promoted page post does show on the Page) | They show in people's feeds, marked Sponsored, not as posts on your page. | تطلع بالفيد ومكتوب عليها مُموَّل، وما تنزل كمنشور على صفحتكم. |
| `test.page.leader` (approved) | Marked {word} | مكتوب عليه {word} |
| `test.volume.name` (stop 2) | We test a lot, fast | نختبر كثير، وبسرعة |
| `test.volume.copy` | We make many versions and switch most of them off. That's how we find the few that work. | نسوي نسخ كثيرة، ونوقف أغلبها. وبهالطريقة نلقى النسخ القليلة اللي تشتغل. |
| `test.volume.small` | Each one tries something different: the hook, the angle, the format or who's on camera. | كل وحدة فيها شي مختلف: البداية اللي تشد، أو الزاوية، أو طريقة العرض، أو مين يطلع بالفيديو. |
| `test.open.pick` (approved) | Your pick runs too, beside the ones you'd skip. The numbers tell us which work. | اختياركم ينزل بعد، جنب اللي يمكن ما تختارونها. والأرقام هي اللي توضح لنا أي واحد يشتغل. |
| `test.open.pick.none` (approved) | The ones you'd pick run too, beside the ones you'd skip. The numbers tell us which work. | اللي تختارونها تنزل بعد، جنب اللي يمكن ما تختارونها. والأرقام هي اللي توضح لنا أي واحد يشتغل. |
| `test.field.tag` (approved as `test.proof.tag`) | Illustration | توضيح |
| `test.input.name` (stop 3) | Your input comes first | نسمع منكم أول |
| `test.fixed.name` (approved) | Fixed: your red lines | الثابت: خطوطكم الحمراء |
| `test.fixed.never` · `test.fixed.always` (the panel's two heads since score round 2; they read "Never …" · "Always …", أبداً ما … · دايماً …, as leads; أبداً since score round 4, where أبد alone read as a cut-off word) | Never · Always | أبداً · دايماً |
| `test.fixed.told` (since score round 2, small after a line typed on O7, not a head; it read "You told us: {red line}.") | you told us | قلتوا لنا |
| `test.fixed.card` (new, score round 2: heads the card's lines written in the other script, quoted as they are) | From your card | من ملفكم |
| `test.fixed.copy` (cut to its first sentence) | We never cross these. | وهذي ما نتعداها أبد. |
| `test.fixed.fallback` (approved) | No red lines written yet. Tell us now and we'll add them to your card. | ما عندنا خطوط حمراء مكتوبة للحين. قولوها لنا الحين، ونضيفها لملفكم. |
| `test.input.copy` (a new price added by the spec review) | Ideas, a new offer, a new price, something to change? Send it in the group before we make the next round. | عندكم فكرة، أو عرض جديد، أو سعر جديد، أو شي تبون تغيرونه؟ أرسلوه بالقروب قبل لا نسوي الإعلانات الجاية. |
| `test.input.offer` | Keep your offer steady while a test runs. A new offer starts the test again. | خلوا عرضكم ثابت وقت الاختبار. العرض الجديد يرجّع الاختبار من البداية. |
| `test.round` (the field's label, stops 3 to 5) | Next round | الإعلانات الجاية |
| `test.check.name` (stop 4) | Then a quick check, not a redesign | بعدها مراجعة سريعة، مو تصميم من جديد |
| `test.check.words` (one line, since the spec review) | Facts · Prices · Claims | المعلومات · الأسعار · الوعود |
| `test.check.line` (the two small lines merged, the fixer's round) | You check these in the group before an ad goes live. | تراجعونها بالقروب قبل لا ينزل الإعلان. |
| `test.check.style` | Small style changes go into the next round, so your launch doesn't wait. | والتعديلات الصغيرة على الشكل تروح للإعلانات الجاية، عشان إطلاقكم ما يتأخر. |
| `test.check.change` (the leader in the field) | Your style change | تعديلكم على الشكل |
| `test.content.name` (stop 5) | Keep the content coming | خلوا المحتوى يوصلنا أول بأول |
| `test.content.copy` | Send new photos and videos of your projects whenever you can. More content means more ads to test. | أرسلوا صور وفيديوهات جديدة لمشاريعكم كل ما قدرتوا. كل ما زاد المحتوى، زادت الإعلانات اللي نختبرها. |
| `test.content.small` (approved as `driveMissing`) | Your folder link is pinned in your WhatsApp group. | رابط المجلد مثبت فوق في قروب الواتساب. |
| `test.stamp` (approved) | Agreed to test this way · {date} | اتفقنا نختبر بهالطريقة، {date} |
| `test.video` (the slot's title, see Video slots) | Why we test so many ads | ليش نختبر إعلانات كثيرة |

Gone from the slide on 2026-10-20 (their Arabic stays in this file's history): `test.page.name`, `test.page.copy`, `test.page.foot` (now said, stop 1), `test.open.name` and `test.open.chips` (stop 2's small line names four of them), the second and third sentences of `test.fixed.copy` (stop 4 and its spoken line), `test.footer` (stop 4's style line says it with the reason), `test.proof.name` and `test.proof.caption` (stop 2, with no count).

The red lines are the client's own Do's and Don'ts as written on their card, and anything typed on O7, shown as written. When a red line is in English, it stays in English inside the Arabic panel.

**Spoken lines (Arabic)**
- (Stop 1, the spec review) هويتكم مهمة، وصفحتكم هي المكان اللي تبان فيه، وتبقى مرتبة مثل ما تبون. أما الإعلانات فهدفها غير: تجيب دخل لشركتكم، مو إنها تشبه صفحتكم. وهي لناس ما يعرفونكم للحين.
- (Stop 2) أغلب الإعلانات اللي نختبرها نوقفها، وهذا طبيعي، مو معناها إن فيه شي غلط. هذي الطريقة اللي نلقى فيها اللي يشتغل.
- (Stop 3) فيه شي ثاني ما تبونا نقوله أو نوريه أبد؟
- (Stop 3) أي فكرة أو عرض جديد أو سعر جديد أو تغيير، أرسلوه بالقروب قبل لا نسوي الإعلانات الجاية، عشان يكون فيها من البداية، وإحنا نرد عليكم بالسبب.
- (Stop 3, the offer) تبون تغيرون العرض؟ قولوا لنا بالقروب أول. العرض الجديد بنص الاختبار يرجّعه من البداية، وإذا قلتوا لنا أول، نرتب له.
- (Stop 3, if they point at the pictures) هذي أمثلة توضح كيف نختبر، وإعلاناتكم تكون من مشاريعكم.
- (Stop 4, before they see the ads) بالشريحة الجاية بتشوفون إعلاناتكم، وأكيد بتبون تغيرون أشياء صغيرة. هذي نخليها للإعلانات الجاية، عشان إطلاقكم ما يتأخر.
- (Stop 4, a wrong fact) أي معلومة أو سعر أو وعد غلط، نصلحه قبل لا ينزل الإعلان. ونصلح بعد أي شي يتعدى خطوطكم الحمراء، أو يغلط في اسمكم أو شعاركم أو ألوانكم. وأي شي يرجع للذوق، صغير ولا كبير، يروح للإعلانات الجاية.
- (Stop 4, why it stays small) ليش نخليها مراجعة سريعة؟ الإعلان اللي ينتظر تعديل صغير، إعلان ما نختبره. ونلقى اللي يشتغل لما نختبر أكثر.
- (If they push back, 1: both agreements) خلونا نرجع للي اتفقنا عليه: خطوطكم الحمراء من مكالمة التعريف، والمراجعة السريعة من مكالمة الإطلاق. خلوني أطلّعه لكم.
- (2: warmly) آخر شي نبيه إن إطلاقكم يتأخر عشان تعديل صغير.
- (3a: the goal shown) قلتوا لنا إن هدفكم: {goal}. أيهم أهم لكم: هالتعديل، ولا إن الإعلانات تنزل عشان نوصل له؟
- (3b: a goal on file, held back) قلتوا لنا هدفكم لأول ٩٠ يوم. أيهم أهم لكم: هالتعديل، ولا إن الإعلانات تنزل عشان نشتغل عليه؟
- (3c: no goal at all) أيهم أهم لكم: هالتعديل، ولا إن الإعلانات تنزل؟
- (4: after their answer) تمام، خلونا ننزلها. وتعديلكم بنحطه بالإعلانات الجاية.
- (5: the change still matters more, and it is taste) إذا كذا، نسوي نسختكم بعد، وننزلها جنب الباقي بالإعلانات الجاية. والأرقام هي اللي توضح لنا أي وحدة تشتغل.
- (If they want to wait for a perfect ad) الإعلان اللي ينتظر النسخة المثالية، ما يجيب شي وهو ينتظر.
- أنتم جيتونا عشان الأداء، وإحنا نفضّل نحمي الأداء على إننا نحمي شكل معين.
- (Stop 5) كل ما أرسلتوا محتوى أكثر، قدرنا نسوي نسخ أكثر.
- (Done with you) فريقكم هو اللي يتصل، بس الإعلانات تمشي بنفس الطريقة: خطوطكم الحمراء، والمراجعة السريعة، والإعلانات الجاية.
- **Temp check:** متفقين نختبر بهالطريقة؟

**The "Copy reply" for pushback in the group** (the notes window on this slide, and prep's slide 3 panel), picked like the pushback line:

| Variant | English | Arabic |
|---|---|---|
| (a) the goal shown | Thanks, noted. You told us your goal is "{goal}", so we'd rather not hold your ads for a small style change: it goes into the next round. If a fact, price or claim is wrong, tell us and we'll fix it before the ad goes live. | شكراً، وصلتنا. قلتوا لنا إن هدفكم: {goal}. وما نبي إعلاناتكم تتأخر عشان تعديل صغير على الشكل، فبنحطه بالإعلانات الجاية. وأي معلومة أو سعر أو وعد غلط، قولوا لنا ونصلحه قبل لا ينزل الإعلان. |
| (b) a goal on file, held back | Thanks, noted. You told us what you want from your first 90 days, so we'd rather not hold your ads for a small style change: it goes into the next round. If a fact, price or claim is wrong, tell us and we'll fix it before the ad goes live. | شكراً، وصلتنا. قلتوا لنا هدفكم لأول ٩٠ يوم، وما نبي إعلاناتكم تتأخر عشان تعديل صغير على الشكل، فبنحطه بالإعلانات الجاية. وأي معلومة أو سعر أو وعد غلط، قولوا لنا ونصلحه قبل لا ينزل الإعلان. |
| (c) no goal | Thanks, noted. We'd rather not hold your ads for a small style change: it goes into the next round. If a fact, price or claim is wrong, tell us and we'll fix it before the ad goes live. | شكراً، وصلتنا. ما نبي إعلاناتكم تتأخر عشان تعديل صغير على الشكل، فبنحطه بالإعلانات الجاية. وأي معلومة أو سعر أو وعد غلط، قولوا لنا ونصلحه قبل لا ينزل الإعلان. |

The reply goes into WhatsApp, so `{goal}` is filled without isolates, as the recap's links are.

The pushback lines keep the CEO's warmth: the change is never refused (no «ما راح نسويه»), it waits for the next ads, and a client who still wants their version gets it in the next round. {goal} is the client's own 90-day goal as they wrote it. It follows a colon and ends its own sentence, never spliced into ours, so a goal written in the first person (نبي…) still reads; no quote marks, by decision 4. On the notes window it sits on its own line in `<bdi dir=auto>`, under "Their goal, in their words:", between the question's two halves; it stays in English when they wrote it in English. The held-back goal (3b) is named, never read out.

## L4 · `ads`

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
- (Before you show them; the fixer's round moved the agreement before this slide) مثل ما اتفقنا قبل شوي: أي معلومة أو سعر أو وعد غلط نصلحه قبل لا ينزل الإعلان، والباقي يروح للإعلانات الجاية. قولوها لي وإحنا نمر عليها.
- أي واحد فيها بيوقفكم وأنتم تقلّبون جوالكم؟
- خلوني أحط هذا مكانه الحين، وشوفوا كيف يطلع بالفيد.
- (A wrong fact) خلوني أكتبها، ونصلحها قبل لا ينزل الإعلان.
- (A preference) بكتبها للإعلانات الجاية، مثل ما اتفقنا.
- هذي معاينة بس، مو موافقة.

## L5 · `form`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `form.eyebrow` | Your customer sees this | هذا اللي يشوفه عميلكم |
| `form.title` | Your form | نموذج إعلانكم |
| `form.titleWhatsApp` (score round 2: the ad opens WhatsApp, so there is no form) | Your WhatsApp chat | محادثة الواتساب |
| `tag.exampleWordingStarter` (score round 2 of the five services: the chat under a starter template's picture) | Example wording, starter ad | صياغة للتوضيح، إعلان بداية |
| `form.line` | What they answer before we call. Questions marked 'Filters' screen out people who aren't a fit. | اللي يجاوب عليه العميل قبل لا نتصل. والأسئلة اللي عليها فلتر تطلّع اللي ما يناسبونكم. |
| `form.line.dwy` | What they answer before your team calls. Questions marked 'Filters' screen out people who aren't a fit. | اللي يجاوب عليه العميل قبل لا يتصل فريقكم. والأسئلة اللي عليها فلتر تطلّع اللي ما يناسبونكم. |
| `form.tag.gate` | Filters | فلتر |
| `form.label.page` | Your page | صفحتكم |
| `form.stop.1` | Opening | البداية |
| `form.stop.2` | The questions | الأسئلة |
| `form.stop.3` | The thank-you screen | صفحة الشكر |
| `form.stop.3.line` | Then your thank-you screen, and a welcome message. | وبعدها صفحة الشكر، ورسالة ترحيب. |
| `form.stop.3.video` | Then your thank-you screen, and a welcome message with a short video about you. | وبعدها صفحة الشكر، ورسالة ترحيب فيها فيديو قصير يعرّف عنكم. |
| `form.stop.3.call` (new, the visual review, done for you only: after the line above, as one paragraph; the same words as `form.whatsapp.next.3`) | Our team calls them within 5 minutes during working hours. | وفريقنا يتصل عليه خلال ٥ دقايق في أوقات الدوام. |
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
| `form.app.today` · `form.app.message` (WhatsApp's own words on the chat, in the phone's language; check against a live Arabic WhatsApp, as decision 9 asks for Meta's) | Today · Message | اليوم · رسالة |

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
| `call.clock.end` (changed by the visual review: a length, not a time beside "Wednesday, 4 pm") | Call length | مدة المكالمة |
| `call.speaker.agent` | Our caller | فريقنا |
| `call.speaker.lead` | Customer | العميل |
| `call.legend` | Words in teal came from your files. | الكلمات الملونة من ملفاتكم. |
| `call.chip.missing` | To give us | نحتاجه منكم |
| `call.after.label` | Example wording | صياغة للتوضيح |
| `call.after.heading` | What we do before the meeting | اللي نسويه قبل الموعد |
| `call.after.line` (new, done for you only) | Before the meeting, the messages come from us, so your customer hears one voice. | قبل الموعد، الرسايل تطلع منا، عشان عميلكم يسمع صوت واحد. |
| `call.after.1` | Booked · a WhatsApp confirmation | عند الحجز · تأكيد على الواتساب |
| `call.after.2` | The day before · a reminder | قبلها بيوم · تذكير |
| `call.after.3` (led by its when, the fixer's round) | Before the meeting · a call to confirm | قبل الموعد · مكالمة تأكيد |
| `call.after.4` | 2 hours before · an SMS | قبلها بساعتين · رسالة نصية |
| `call.after.5` (bold, the list's end) | The meeting | الموعد |
| `call.lands.caption` (the stop's lead, over the cards, since the fixer's round) | Everything our caller learned lands with you. | كل اللي عرفه فريق الاتصال يوصلكم. |
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
| `call.after.2.dwy` (led by its when, the fixer's round) | Before the meeting · reminders | قبل الموعد · تذكيرات |
| `call.after.3.dwy` | Provisional bookings: your team calls 48 and 24 hours before | الحجوزات المبدئية: فريقكم يتصل قبلها بيومين، وقبلها بيوم |
| `call.after.4.dwy` | The meeting | الموعد |
| `call.lands.notes.dwy` | Your caller's notes | ملاحظات فريق الاتصال عندكم |
| `call.lands.caption.dwy` | It lands in your CRM. | الموعد ينزل في الـCRM عندكم. |

**Spoken lines (Arabic)**
- هذا السكربت اللي نستخدمه، ومعلوماتكم داخله. فريق الاتصال يتكلم باسمكم، كقسم المواعيد عندكم.
- الكلمات الملونة من ملفاتكم. واللي عليه نحتاجه منكم، تقدرون تعطونا إياه الحين.
- إذا تبون فريق الاتصال يذكر سعر يبدي منه، ضيفوه بالدليل. السكربت ما يذكر سعر ما عندنا.
- (Stop 7) وهذا اللي نسويه قبل الموعد.
- (Stop 7, the one-voice line) قبل الموعد، ياليت ما تراسلون العميل من واتسابكم. صوتين يلخبطون العميل، فخلوا الرسايل علينا.
- (Stop 8) كل اللي عرفه فريق الاتصال يوصلكم، فتدخلون الموعد وأنتم عارفين المشروع.
- مكالماتكم الحقيقية بتسمعونها في Mahara OS. (Since 2026-10-20 the portal is three slides on, so the line no longer says وبوريكم إياها الحين.)
- **Temp check:** هذي الطريقة اللي تبون نكلم فيها عملاءكم؟ وفيه شي ما نقوله أبد؟
- (DWY) هذي الطريقة اللي نبي فريقكم يتصل فيها: نفس المراحل الست، ونفس السكربت، ومعلوماتكم داخله.

## L7 · `partnership` (new, 2026-10-20)

**On screen**

| Key | English | Arabic |
|---|---|---|
| `partner.title` (the overview's title) | We bring them to your door. You win the project. | نوصّلهم لين بابكم. وتوقيع المشروع عليكم. |
| `partner.title.1` (stop 1, teal) | We bring them to your door. | نوصّلهم لين بابكم. |
| `partner.title.2` (stop 2, ink) | You win the project. | وتوقيع المشروع عليكم. |
| `partner.owner.us` | Our team | فريقنا |
| `partner.owner.you` | You | أنتم |
| `partner.piece.ads` | Ads and enquiries | الإعلانات والاستفسارات |
| `partner.piece.calls` | Calls and bookings | الاتصال والحجز |
| `partner.piece.reminders` | Reminders and rebooking | التذكير وإعادة الحجز |
| `partner.piece.close` | The meeting and the close | الموعد وتوقيع المشروع |
| `partner.road.ad` | An enquiry from your ad | استفسار من إعلانكم |
| `partner.road.bends` (on the ad road's bends, the fixer's round) | Meeting you for the first time · Comparing you with others | أول مرة يتعرف عليكم · يقارنكم بغيركم |
| `partner.road.ref` | A referral | عميل جاكم بتوصية |
| `partner.road.ref.line` | Already trusts you. | يثق فيكم من قبل. |
| `partner.road.meeting` | Your meeting | موعدكم معه |
| `partner.road.signed` | Signed project | مشروع موقّع |
| `partner.road.caption` | The enquiries we bring take the longer road. | والاستفسارات اللي نجيبها لكم تمشي الطريق الأطول. |
| `partner.line` (stop 4) | We can't close for you. We can help you get better at it. | ما نقدر نوقّع المشروع عنكم، بس نقدر نساعدكم تصيرون أشطر فيه. |

The title's two sentences carry the deck's own split: علينا and عليكم are how the journey's fork already says ours and yours (علينا. نتصل عليه ونحجز له من جديد), so the pie's line ends on عليكم. "The close" is توقيع المشروع, as in the milestones (أول مشروع موقّع), never الإقفال, which is sales jargon.

Since the spec review of 2026-10-20: `partner.road.ad.length` (طريق أطول) and `partner.road.ref.length` (طريق أقصر) are gone, because the drawing and the caption say the length; `partner.line.1` (التسويق بدون بيع ما يكبّر شغلكم.) is said at stop 4, not shown.

**DWY**

| Key | English | Arabic |
|---|---|---|
| `partner.title.1.dwy` | We bring you the enquiries. | نوصّل لكم الاستفسارات. |
| `partner.title.2.dwy` | Your team books them and wins the project. | والحجز وتوقيع المشروع على فريقكم. |
| `partner.owner.you.dwy` | Your team | فريقكم |
| `partner.piece.auto.dwy` | Confirmations and reminders | التأكيد والتذكير |

Done with you the pie splits by owner in halves: ours holds الإعلانات والاستفسارات and التأكيد والتذكير, theirs الاتصال والحجز and الموعد وتوقيع المشروع.

**Spoken lines (Arabic)**
- (Stop 1) هالقطعة علينا: الإعلانات والاستفسارات، والاتصال والحجز، والتذكير، وإعادة الحجز لأي أحد ما حضر.
- (Stop 2) وهالقطعة عليكم، وهي اللي يجي منها الدخل: الموعد وتوقيع المشروع.
- (Stop 3) اللي يجيكم بتوصية يثق فيكم من قبل. واللي يجيكم من إعلان، أول مرة يتعرف عليكم، ويقارنكم بغيركم. فتوقعوا أسئلة أكثر، ومتابعة أكثر، وطريق أطول لين التوقيع.
- (Stop 4) التسويق بدون بيع ما يكبّر شغلكم. إحنا نوصّلهم لين بابكم، بس التوقيع ما نقدر نسويه عنكم. وهنا نقدر نساعدكم.
- **Temp check:** فيه شي هنا كنتوا تحسبونه علينا؟
- (DWY) فريقكم عليه نص الشغل: الاتصال والحجز، والموعد وتوقيع المشروع. والإعلانات والاستفسارات، والرسايل اللي تطلع تلقائياً، علينا.

## L8 · `training` (new, 2026-10-20)

**On screen**

| Key | English | Arabic |
|---|---|---|
| `training.title` | Your sales training | تدريبكم على المبيعات |
| `training.lead` (why it matters, the fixer's round) | Enquiries from ads are meeting you for the first time. This course shows you how to win them. | اللي يجونكم من الإعلانات أول مرة يقابلونكم، وهالكورس يعلمكم كيف تكسبونهم. |
| `training.academy` (over the course list) | Premium Projects Academy | أكاديمية المشاريع المميزة |
| `training.course.1` | Introduction | البداية |
| `training.course.2` | Onboarding | التعريف |
| `training.course.3` | Google optimization | تحسين قوقل |
| `training.course.4` | Offer creation | صناعة العرض |
| `training.course.5` | Project Closing Mastery | إتقان توقيع المشاريع |
| `training.course.5.latin` (new, the visual review, the lit row only, ink-2 at 24 px) | (none) | Project Closing Mastery |
| `training.course.6` | Team and operations | الفريق والتشغيل |
| `training.teaches` (new, the label over the four) | What it teaches | اللي بتتعلمونه |
| `training.part.1` | The consultation | الاستشارة |
| `training.part.2` | The proposal | عرض السعر |
| `training.part.3` | The objections | الاعتراضات |
| `training.part.4` | The close | التوقيع |
| `training.when.name` | Before your first meetings | قبل أول مواعيدكم |
| `training.when.line` | Everyone who meets your customers or sends the quotes watches it, starting with the sales crash course. | كل اللي يقابل عملاءكم أو يرسل عروض الأسعار يشوفه، ويبدي بقسم Sales crash course. |
| `training.deals.name` | Your real deals | صفقاتكم الحقيقية |
| `training.deals.line` | At your check-ins, we go through your meetings with you: what closed, and what to change. | بمكالمات المتابعة، نمر معكم على مواعيدكم: اللي توقّع، واللي يحتاج يتغير. |
| `training.foot` | The link is in your WhatsApp group. | الرابط في قروب الواتساب. |
| `training.shot.tag` (new, stops 1 and 2) | Academy screenshot | لقطة من الأكاديمية |
| `training.shot.classroom` (alt text) | The Academy's six courses | الكورسات الستة في الأكاديمية |
| `training.shot.lesson` (alt text) | A lesson inside Project Closing Mastery | درس من كورس إتقان توقيع المشاريع |

The course names are the sales deck's Arabic (`CLOSING_TOUR`), with two changes: Onboarding stays in Latin (البداية is course 1, the introduction), and "the proposal" is عرض السعر, because العرض on these decks is the client's own offer (decision 11). The numbers are the Academy's own order, written ١ to ٦ (never ٠١). The sales crash course keeps the Academy's own Latin name, isolated, until the Academy gives it an Arabic one (point 6 below).

Since the spec review of 2026-10-20: `training.who.name` and `training.who.line` are gone (who and when are one statement now), and the old `training.when.line` (شوفوه، وابدوا بالاستشارة.) pointed at a section the course doesn't have.

The two screenshots are the Academy's own, in English, masked as `CONTENT.md` copy rule 11 says; the Arabic deck shows the same pictures, with the Arabic tag.

**Spoken lines (Arabic)**
- (Stop 1, the classroom) هذي الأكاديمية مثل ما بتشوفونها. والكورس اللي يخص مواعيدكم هو الخامس: إتقان توقيع المشاريع.
- (Stop 2, the lesson) ومن داخله، يبدي بقسم Sales crash course. ابدوا منه.
- اللي يجيكم بتوصية يثق فيكم من قبل. بس عميل الإعلان يبي استشارة مرتبة، وعرض سعر واضح يقدر يقارنه.
- مين عندكم يقابل العملاء؟ ومين يرسل عروض الأسعار؟ هم اللي يشوفون الكورس.
- بحط رابط الأكاديمية بالقروب الحين.
- (Its follow-ups section) قسم المتابعة يخص اللي قاعدين يفكرون، واللي صرنا نتابعهم إحنا وأنتم.
- (If they say they already sell well) ممتاز. هذا لعملاء الإعلانات، اللي ما يعرفونكم للحين. وأغلب الشركات متعودة على التوصيات.
- **Temp check:** مين من فريقكم بيشوفه أول؟

## L9 · `portal`

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
| `portal.4.came.line` (new) | Running late isn't a no-show. | اللي متأخر شوي مو غايب. |
| `portal.4.quote.line` (new) | Sent it later? Update it then. | أرسلتوا عرض السعر بعدين؟ حدّثوا الجواب وقتها. |
| `portal.4.won.line` (new) | Add the value, or a line on why. | أضيفوا قيمة المشروع، أو سطر عن السبب. |
| `portal.4.moved` (one line, the fixer's round) | Cancelled or moved with you directly? Tell us in the group: we change the reminders or call to rebook. | لغى أو غيّر موعده معكم مباشرة؟ قولوا لنا بالقروب، ونعدّل التذكيرات أو نتصل عليه ونحجز له من جديد. |
| `portal.4.footer` | What isn't marked can't be improved. | اللي ما ينسجل، ما نقدر نحسّنه. |

**DWY**

| Key | English | Arabic |
|---|---|---|
| `portal.title.dwy` | Your CRM | الـCRM عندكم |
| `portal.4.name.dwy` | Your number-one job: keep every stage true | أهم شغلة عليكم: كل مرحلة تكون صحيحة |
| `portal.4.copy.dwy` | Move each meeting to the right stage in the CRM the same day: didn't show, showed, quote sent, closed. | انقلوا كل موعد للمرحلة الصح في الـCRM بنفس اليوم: ما حضر، حضر، انرسل عرض السعر، وقّع. |
| `portal.4.late.dwy` (new) | Not there? Check they're not just running late before you move it. | ما وصل؟ تأكدوا إنه مو بس متأخر قبل لا تنقلونه. |

**Spoken lines (Arabic)**
- إذا ما سجلتوا دخول للحين، خلنا نسويها الحين.
- مين اللي يقابل العملاء ويسجل نتائج المواعيد؟ إذا مو هو اللي مسجل دخول، خلنا نضيفه الحين: من الإعدادات، وبعدها Your team & access.
- (Stop 4) هذي أكثر شغلة تنتسى، فخلونا نوقف عندها شوي.
- (A no-show) اللي متأخر شوي مو غايب، فتأكدوا أول. ولما تسجلونه ما حضر، نتصل عليه ونحجز له من جديد.
- (Did you win) وإذا ما وقّع، سطر واحد صريح عن السبب يفيدنا أكثر من كلمة يفكر.
- (Cancelled or moved) لو أحد لغى أو غيّر موعده معكم مباشرة، ما نعرف إلا إذا قلتوا لنا، والتذكيرات بتروح له على الوقت القديم. إذا غيّره، نعدّل التذكيرات على الوقت الجديد. وإذا لغاه، نتصل عليه ونحجز له من جديد.
- والبوابة تقدر تذكركم بعد كل موعد عشان تسجلون نتيجته.
- وإذا تستخدمون شيت التقارير، الاثنين يتحدثون مع بعض.

## L10 · `your-part`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `part.title` (one line, the slide's only heading) | Your six jobs, in one place | ست شغلات عليكم، بمكان واحد |
| `part.head.before` | Before your meetings | قبل مواعيدكم |
| `part.head.after` | After each meeting | بعد كل موعد |
| `part.head.weeks` | Week to week | أسبوع بأسبوع |

| Head | English job | Arabic job | English why | Arabic why |
|---|---|---|---|---|
| Before | Keep at least 10 open slots, at different times | خلوا ١٠ مواعيد فاضية على الأقل، بأوقات مختلفة | Our callers book into them. (Notes and recap: On a day off, block each hour, not one all-day event.) | فريق الاتصال يحجز فيها. (الملاحظات والملخص: ويوم إجازتكم، سكروا الساعات ساعة ساعة، مو حدث على اليوم كامل.) |
| Before | Add each booking to your own system | ضيفوا كل موعد لنظامكم | If your team plans in other software, the booking goes there too, so nobody books over it. | إذا فريقكم يخطط على برنامج ثاني، الموعد ينضاف فيه بعد، عشان ماحد يحجز فوقه. |
| After | Mark every meeting the same day, with the value when you win | سجلوا نتيجة كل موعد بنفس اليوم، ومعها قيمة المشروع إذا وقّع | Your outcomes show which ads bring real projects. | نتائجكم توضح أي إعلانات تجيب مشاريع حقيقية. |
| After | Follow up the ones thinking it over, and book the second meeting | تابعوا اللي قاعدين يفكرون، واحجزوا الموعد الثاني | You send the quote and set the second meeting. Our caller checks in too. (Done for you; done with you, the first sentence alone.) | أنتم ترسلون عرض السعر وتحددون الموعد الثاني. وفريق الاتصال يتابع معهم بعد. (لما نتصل نحن؛ لما يتصل فريقهم، الجملة الأولى بس.) |
| Weeks | Leave the ads running through the first weeks | خلوا الإعلانات شغالة أول الأسابيع | Pausing early ends the test before it tells us anything. | لو وقفتوها بدري، ينتهي الاختبار قبل لا يعطينا جواب. |
| Weeks | Keep your Drive folder fed | خلوا مجلد الدرايف مليان | Fresh projects keep your ads from tiring. | المشاريع الجديدة تخلي إعلاناتكم ما تبهت. |

The calendar week names its marks: Blocked · مسكّر (once, in the key under the week, since the fixer's round; it was Busy · مشغول on one cell), Day off · إجازة, and its six days, Saturday to Thursday: Sat · Sun · Mon · Tue · Wed · Thu, سبت · أحد · اثنين · ثلاثاء · أربعاء · خميس. Its open slots carry no label: the job above them says what they are.

Left this slide on 2026-10-20: «ثبّتوا العرض وإحنا نختبر» (said on L3 now) and «سكروا أوقات انشغالكم وإجازاتكم بالتقويم» (folded into the open-slots job). Since the spec review the same day: `part.line` is gone (the title is the line), the head «طول أول الأسابيع» is «أسبوع بأسبوع», and the open-slots why lost «التقويم أحياناً ما يحسب إغلاق اليوم كامل، فنحجز فيه بالغلط» (said, not shown).

**DWY** (regrouped by the spec review, 2026-10-20)

| Head | English | Arabic |
|---|---|---|
| Before, open slots, why | Your team books into them. (Notes and recap: On a day off, block each hour, not one all-day event.) | فريقكم يحجز فيها. (الملاحظات والملخص: ويوم إجازتكم، سكروا الساعات ساعة ساعة، مو حدث على اليوم كامل.) |
| Before, in place of the booking job | Call new enquiries within 5 minutes, and note every try · Interest fades, and a missing note means nobody knows what happened. | اتصلوا على الاستفسارات الجديدة خلال ٥ دقايق، وسجلوا كل محاولة · الحماس يبرد، والملاحظة الناقصة تخلي ماحد يعرف اللي صار. |
| After, the marking job | Move each meeting to the right stage the same day · Your stages show which ads bring real projects. | انقلوا كل موعد للمرحلة الصح بنفس اليوم · مراحلكم توضح أي إعلانات تجيب مشاريع حقيقية. |
| After, follow-up, why | You send the quote and set the second meeting. | أنتم ترسلون عرض السعر وتحددون الموعد الثاني. |

اتصلوا على, not اتصلوا بـ: the journey already says نتصل على الاستفسارات الجديدة, so the client reads one verb for the same act.

**The group recap** (from the notes window, on this slide, on L13 and once the deck closes). After its title, until the `start-to-finish`, `call-team` and `winning` videos are all recorded and shown (score round 2):
- Who does what: we bring the enquiries, call them within 5 minutes during working hours, book and remind them, and rebook anyone who doesn't show. You hold the meeting and win the project. · مين يسوي إيش: نجيب لكم الاستفسارات، ونتصل عليهم خلال ٥ دقايق في أوقات الدوام، ونحجز لهم ونذكّرهم قبل الموعد، واللي ما يحضر نتصل عليه ونحجز له من جديد. وأنتم تقابلونهم، وتوقيع المشروع عليكم.
- Done with you: Who does what: we bring the enquiries. Your team calls them within 5 minutes and books them on the right calendar, and the confirmation goes out by itself. You hold the meeting and win the project. · مين يسوي إيش: نجيب لكم الاستفسارات، وفريقكم يتصل عليهم خلال ٥ دقايق ويحجز لهم على التقويم الصح، والتأكيد يطلع للعميل تلقائياً. وأنتم تقابلونهم، وتوقيع المشروع عليكم.

نتصل عليهم (the people behind the enquiries, as نحجز لهم and ونذكّرهم after it); ونحجز له من جديد and وتوقيع المشروع عليكم are the fork's and the pie's own words, so the recap says nothing the slides did not.

Then, after the six jobs:
- The testing line (new, the spec review; the style-change rule and the content ask added by the fixer's round): How we test your ads: your red lines stay fixed, your ideas go in the group before the next round, you check the facts, prices and claims before an ad goes live, and small style changes go into the next round so your launch doesn't wait. New photos and videos help: send them whenever you can. · كيف نختبر إعلاناتكم: خطوطكم الحمراء ثابتة، وأفكاركم ترسلونها بالقروب قبل الإعلانات الجاية، وتراجعون المعلومات والأسعار والوعود قبل لا ينزل الإعلان، والتعديلات الصغيرة على الشكل تروح للإعلانات الجاية عشان إطلاقكم ما يتأخر. وأي صور أو فيديوهات جديدة، أرسلوها كل ما قدرتوا.
- The money line (the fixer's round, every time): Keep your ad card funded. Your payments to us are on the dates in your agreement. · خلوا بطاقة الإعلانات فيها رصيد. ودفعاتكم لنا بالتواريخ المكتوبة في عقدكم.
- The first-weeks line (the fixer's round, every time): The first weeks are usually slower while the ads find your audience. Leave them running. · أول الأسابيع عادةً تكون أهدأ، لين تتعرف الإعلانات على جمهوركم. خلوها شغالة.
- The course line: Before your first meetings: Project Closing Mastery in the Academy: {url} · قبل أول مواعيدكم: كورس إتقان توقيع المشاريع في الأكاديمية: {url}
- Then the videos (Video slots, below).

**Spoken lines (Arabic)**
- ثلاث من هذي جديدة عليكم اليوم: المواعيد الفاضية، ويوم الإجازة اللي تسكرونه بالساعات، ونظامكم. والباقي سمعتوه قبل.
- وبأرسل لكم هالكرت بالقروب، ومعاه رابط كورس إتقان توقيع المشاريع.
- كل ما خليتوا أوقات فاضية أكثر من ساعات دوامكم، لقى العميل وقت يناسبه أسرع.
- يوم الإجازة، سكروا ساعات الدوام وحطوها مشغول، مو حدث على اليوم كامل، لأن التقويم أحياناً ما ينتبه لليوم المسكّر كامل، فنحجز فيه بالغلط.
- (Done for you) وبعد الموعد، المتابعة علينا وعليكم: أنتم ترسلون عرض السعر وتحددون الموعد الثاني، وفريق الاتصال عندنا يتابع مع العميل بعد.
- أكثر أسئلة يسألها فريق الاتصال: موعد برا أوقات دوامكم، أو إجازة، أو تفصيلة عن خدمة.
- وما يحتاج تردون يوم الجمعة أو بالليل.
- **Temp check:** أي وحدة من هذي بتكون أصعب على فريقكم؟

## L11 · `first-90-days`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `days.title` | Your first 90 days | أول ٩٠ يوم |
| `days.goal` | Your 90-day goal, in your words: {form.goal90} | هدفكم خلال ٩٠ يوم، بكلامكم: {form.goal90} |
| `days.goal.foot` | A target, not a promise of results. | هدف، مو وعد بنتائج. |
| `days.1.when` | Weeks 1 and 2 · Finding what works | أول أسبوعين · نكتشف اللي يشتغل لكم |
| `days.1.slow` (new, under the bar's label) | Usually slower, while the ads find your audience. | عادةً تكون أهدأ، لين تتعرف الإعلانات على جمهوركم. |
| `days.1.open` | Can run longer | ممكن تطوّل |
| `days.2.when` | Your first check-in · a week or two in | أول مكالمة متابعة، بعد أسبوع أو أسبوعين |
| `days.2.date` | {next.checkin} | {next.checkin} |
| `days.3.when` | Then weekly or every two weeks | وبعدها كل أسبوع أو كل أسبوعين |
| `days.3.why` (its own line under the key, in ink-2, and in the notes) | Depending on your plan and how long you've been with us. | على حسب باقتكم، وكم صار لكم معنا. |
| `days.3.line` | 20 to 30 minutes on Zoom: what's working, and what we're changing. | من ٢٠ إلى ٣٠ دقيقة على زوم: اللي شغال، واللي بنغيره. |
| `days.4.line` | Around 30, 60 and 90 days, that check-in looks back over the month. | تقريباً عند ٣٠ و٦٠ و٩٠ يوم، مكالمة المتابعة تراجع الشهر كامل. |
| `days.ms.label` | In this order, not on a date: | بهالترتيب، مو بتاريخ: |
| `days.ms.1` | First booking | أول موعد |
| `days.ms.2` | First attended appointment | أول عميل حضر |
| `days.ms.3` | First won project | أول مشروع موقّع |
| `days.footer` | Dates depend on your market, your offer and your follow-up. We track them with you. | التواريخ تعتمد على سوقكم وعرضكم ومتابعتكم، ونتابعها معكم. |
| `days.day90` | Day 90 | يوم ٩٠ |
| `days.fallback.weeks` | Week 1 … Week 12, then Day 90 | الأسبوع ١ … الأسبوع ١٢، وبعدها يوم ٩٠ |

The three milestones are the sales deck's `MILESTONES` Arabic, unchanged. أهدأ, not أبطأ: "slower" here is about how many come in, and the spoken lines already call a quiet start هادية.

**Spoken lines (Arabic)**
- أول أسبوعين عادةً أهدأ، لين تتعرف الإعلانات على جمهوركم. وفيه بدايات تكون زحمة. وبالحالتين، إحنا نكتشف اللي يتفاعل معه سوقكم.
- والتحديثات توصلكم بالقروب أول بأول.
- بعد أول مكالمة متابعة، تكون المكالمات كل أسبوع أو كل أسبوعين، على حسب باقتكم، وكم صار لكم معنا.
- وصفقاتكم بعد نمر عليها بمكالمات المتابعة.
- مكالمات المتابعة: لابتوب ومكان هادي، مو وأنتم بالسيارة. واللي بعدها نحجزها بآخر كل مكالمة.
- **Temp check:** هالإيقاع يناسبكم؟
- (DWY) أول حجز بيكون من فريقكم.

## L12 · `good-to-know` (new, 2026-10-20)

**On screen**

| Key | English | Arabic |
|---|---|---|
| `know.title` (the fixer's round: the comments and replies run on after go-live) | Good to know | أشياء تهمكم |
| `know.groups` (two small heads over the rows) | Money · Messages | الفلوس · الرسايل |
| `know.charges.name` | Meta's first charges | أول مبالغ تخصمها ميتا |
| `know.charges.line` | Small at first, and that's normal. Tell your bank so it doesn't block them. | تكون صغيرة بالبداية، وهذا طبيعي. بلّغوا البنك عشان ما يوقفها. |
| `know.card.name` | Keep your ad card funded | خلوا بطاقة الإعلانات فيها رصيد |
| `know.card.line` | A failed payment stops your ads. Repeated ones can get the account restricted and reset what the ads have learned. Running low? Tell us first, and we'll pause the ads safely. | إذا فشل الدفع، تتوقف إعلاناتكم. وإذا تكرر، ممكن ميتا تقيّد الحساب، ويروح اللي تعلمته الإعلانات. الرصيد قرب يخلص؟ قولوا لنا قبلها، ونوقف الإعلانات بطريقة آمنة. |
| `know.pay.name` | Your payments to us | دفعاتكم لنا |
| `know.act` (since score round 2, each money row's do-this, set in ink inside its line) | Tell your bank · Tell us first · On the dates in your agreement. | بلّغوا البنك · قولوا لنا قبلها · بالتواريخ المكتوبة في عقدكم. |
| `know.pay.line` | On the dates in your agreement. If one fails, the ads, our calls and Mahara OS pause until it's sorted. | بالتواريخ المكتوبة في عقدكم. وإذا فشلت دفعة، تتوقف الإعلانات ومكالماتنا ومنصة Mahara OS لين تنحل. |
| `know.pay.line.dwy` | On the dates in your agreement. If one fails, the ads and the systems we run for you pause until it's sorted. | بالتواريخ المكتوبة في عقدكم. وإذا فشلت دفعة، تتوقف الإعلانات والأنظمة اللي نشغلها لكم لين تنحل. |
| `know.comments.name` | Comments on your ads | التعليقات على إعلاناتكم |
| `know.comments.line` | Yours to answer. Not sure what to say? Ask in the group. | الرد عليها عليكم. ما تدرون كيف تردون؟ اسألونا بالقروب. |
| `know.replies.name` (only without the onboarding deck) | Our replies | ردودنا |
| `know.replies.line` | In the group within 2 working hours, 10 to 6, Saturday to Thursday. | بالقروب خلال ساعتين دوام، من ١٠ صباحاً إلى ٦ مساءً، من السبت إلى الخميس. |
| `know.replies.line.uae` | In the group within 2 working hours, 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday. | بالقروب خلال ساعتين دوام، من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات)، من السبت إلى الخميس. |

عقدكم, not اتفاقيتكم: the client signed a contract and calls it that. بالتواريخ, not بالمواعيد: on these decks موعد is a meeting. ساعتين دوام says working hours in two words, the way an office says it.

**Spoken lines (Arabic)**
- هذي أشياء بسيطة عن الفلوس والرسايل، بس مهم تعرفونها قبل لا ننطلق.
- بطاقة الإعلانات: خلوا فيها مصروف الإعلانات للشهر كامل. وإذا قرب يخلص، قولوا لنا بالقروب، ونوقف الحملة قبل لا يفشل الدفع.
- دفعاتكم لنا بالتواريخ اللي في عقدكم.
- (If the replies row shows) الجمعة إجازة، والساعتين تنحسب من ساعات دوامنا بس.
- **Temp check:** فيه شي عن الفلوس أو الرسايل تبون تتأكدون منه قبل لا ننطلق؟

## L13 · `green-light`

**On screen**

| Key | English | Arabic |
|---|---|---|
| `green.question` (the slide's title and its one heading) | Happy for us to go live? | على بركة الله، ننطلق؟ |
| `green.question.live` (the fixer's round: when the cover says the starter ads are already running) | Happy for us to carry on? | على بركة الله، نكمل؟ |
| `green.next` | Your first check-in · {next.checkin} | أول مكالمة متابعة، {next.checkin} |
| `green.rail` | Go-live · {go_live} | الإطلاق، {go_live} |

على بركة الله is how a Gulf owner gives a green light, in Kuwait and in Saudi Arabia alike. The housekeeping cards that were this slide's first stop (`green.card.charges`, `green.card.comments`, `green.card.hours`) are L12's rows now.

**Spoken lines (Arabic)**
- قبل لا نكمل، عندكم أي سؤال؟
- على بركة الله، ننطلق؟
- (Already live) على بركة الله، نكمل؟
- خلنا نحجز أول مكالمة متابعة، بعد الإطلاق بأسبوع أو أسبوعين.
- (If they hesitate) فيه شي واحد لو انحل، ترتاحون أكثر؟ خلنا نحله الحين، أو نتفق متى ينحل.
- إذا أي شي شغل بالكم بأي وقت، قولوا لي. أنجح شركائنا هم اللي يقولون لنا الزين والشين.

---

# Video slots (CEO, 2026-10-20)

The registry, the rules and the recap are in `CONTENT.md` ([Video slots](CONTENT.md#video-slots-ceo-2026-10-20)). The Arabic for what the client sees and receives is here. Notes-window and prep lines are cockpit UI, in English ("Not recorded yet." and the rest).

**Slot titles**

| Deck · slot | English | Arabic |
|---|---|---|
| onboarding · `welcome` | Welcome to Mahara | حياكم الله في مهارة |
| onboarding · `meta-access` | Meta access | صلاحيات ميتا |
| onboarding · `whatsapp-calendar` | WhatsApp and calendar | الواتساب والتقويم |
| onboarding · `testing` (new, the spec review) | Why we test so many ads | ليش نختبر إعلانات كثيرة |
| launch · `start-to-finish` | How it works, start to finish | كيف يمشي كل شي، من البداية للنهاية |
| launch · `testing` | Why we test so many ads | ليش نختبر إعلانات كثيرة |
| launch · `call-team` | How our call team works | كيف يشتغل فريق الاتصال |
| launch · `winning` | Your part in winning the project | دوركم في توقيع المشروع |
| launch · `portal-guide` | The Mahara OS guide | دليل Mahara OS |
| launch · `calendar-hours` | Blocking hours in your calendar | كيف تسكرون الساعات بالتقويم |
| launch · `first-90-days` (new, the spec review) | Your first 90 days | أول ٩٠ يوم |
| launch · `payments` | How payments work | كيف تمشي الدفعات |

The company name is مهارة in Arabic, as the cockpit's first WhatsApp to a new client already spells it (معك فريق مهارة, `csmTemplates.ts`) and as the sales deck does (قناة مهارة على يوتيوب), so the client reads one name. Mahara OS stays in Latin, isolated, because it is the product's name. A title typed in prep shows as typed, in its own direction.

**On the canvas**

| Piece | English | Arabic |
|---|---|---|
| The control | Watch: {title} · {m:ss} | شوفوا: {title} · {length} |
| {length}, under 30 seconds | (m:ss) | أقل من دقيقة |
| {length}, rounded to the minute | (m:ss) | دقيقة · دقيقتين · ٣ إلى ١٠ دقايق · ١١ دقيقة فما فوق |
| No length on file | Watch: {title} | شوفوا: {title} |
| The overlay's close | Close | إغلاق |
| The overlay, loading | Loading the video | نحمّل الفيديو |
| The overlay, didn't load | The video didn't load. We'll send you the link in the group. | ما اشتغل الفيديو. بنرسل لكم الرابط بالقروب. |
| The overlay, can't play here (only on the provider's own error, DESIGN 21.3) | This video can't play here. We'll send you the link in the group. | هالفيديو ما يشتغل هنا. بنرسل لكم الرابط بالقروب. |

The length rounds to the nearest minute (2:40 is ٣ دقايق). The day-one lengths read: the welcome video دقيقتين (2:28), Meta access دقيقتين (1:34), WhatsApp and calendar ٤ دقايق (3:51), the Mahara OS guide ٥ دقايق (4:37 and 4:45), and the calendar video أقل من دقيقة (0:11). With two videos on one slide (O6), «شوفوا:» is said once, before both. The control shows only while the presenter's chrome is awake (DESIGN 21.2), in both languages.

**The recap** (after the course line on the launch deck, at the end of O6's links on the onboarding deck; filled without isolates, so each link stays one clickable run):

```text
فاتكم شي بالمكالمة؟ شوفوا:
- {title}: {url}
```

Done with you, and in the other language, a slot is left out exactly as `CONTENT.md` says; the block is left out when nothing is left.

---

# The visual pass (CEO, 2026-10-20)

The Arabic for every new or changed string in `CONTENT.md`, [The visual pass](CONTENT.md#the-visual-pass-ceo-2026-10-20), with the same keys, written under `mahara-context/skills/aziz-kuwaiti-voice` in the client register this file set (decisions 1 to 13): the firm in the plural, a white Gulf Arabic a Saudi office reads as serious, no ج/ي swaps on slides, دقايق as decision 11 spells it, digits through `Fig`. The prep and notes lines are cockpit UI, shown in English today; their Arabic is here because the lead asked for the Drive box in both languages, ready for an Arabic prep. They address one CSM, so they use the singular imperative (الصق، ارفع).

**Decision 14, the visual pass.** "Example ad" is إعلان للتوضيح, plural إعلانات للتوضيح, short مثال, never قالب (a template is something that goes live) and never تجريبي (the test is الاختبار, decision 10). "Today", over the call's checklist, is اليوم. The tray, in the CSM's lines, is التصاميم, as the deck's tray head (`ads.tray.title`) calls it. A size in megabytes is ميقا, as the Gulf says it. A file's state is said from our side (نجيبه، وصل).

## The call's checklist (onboarding)

| Key | English | Arabic |
|---|---|---|
| `today.label` | Today | اليوم |
| `today.1.short` | Launch service | خدمة الإطلاق |
| `today.2.short` | Your access | الصلاحيات |
| `today.3.short` | Blueprint call | مكالمة بناء الهوية |

The long names are O1's agenda, unchanged (نختار خدمة الإطلاق · نجهّز الصلاحيات · نحجز مكالمة بناء الهوية والعرض). The numbers in the rings are written from `"١٢٣"`.

**Spoken lines (Arabic)**
- (O1) هذي الثلاث بنخلصها قبل لا نسكر المكالمة.
- (O6) لما نخلص بطاقات الصلاحيات، تنحط علامة صح على الصلاحيات تحت. وهذي أكثر خطوة تأخر الإطلاق عادةً.
- (O7, the last stop) خلونا نمر على اللي خلصناه اليوم. وإذا باقي شي، نتفق مين يخلصه ومتى.

## O2 · `goals`

No new words: stop 1 is the goal alone, stop 2 the other answers. `goals.input` is بكلامكم (score round 2 of the five services: the question and the track already say ٩٠ يوم); هدفكم خلال ٩٠ يوم، بكلامكم stays as the field's name for a screen reader (`goals.inputLabel`).

**Spoken lines (Arabic)**
- (Stop 1) خلوني أقرا لكم هدفكم مثل ما كتبتوه.

## O3 · `team`

| Key | English | Arabic |
|---|---|---|
| `team.reply` | We reply within 2 working hours. | نرد خلال ساعتين دوام. |
| `team.hours` | 10 to 6, Saturday to Thursday. If something worries you, we call you. | من ١٠ صباحاً إلى ٦ مساءً، من السبت إلى الخميس. وإذا فيه شي شاغل بالكم، نتصل عليكم. |
| `team.hours.uae` | 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday. If something worries you, we call you. | من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات)، من السبت إلى الخميس. وإذا فيه شي شاغل بالكم، نتصل عليكم. |

`team.foot` and `team.foot.uae` retire; their words are these. The hours line keeps score round 2's rule: من never ends a line (the 560 px measure).

**Spoken lines (Arabic)**
- (Stop 1, once the group has filled; the English note reads "The group fills as the slide opens. Then go down the five roles.") هذا قروبكم، والفريق كله فيه. خلوني أعرفكم عليهم واحد واحد.
- (Stop 2) ونرد خلال ساعتين دوام.

The Friday line keeps its own note (الجمعة إجازة، والرسايل اللي توصل بعد الساعة ٦…), so stop 2 says the promise alone.

"Your WhatsApp group" is now a small label beside the WhatsApp mark (قروب الواتساب, the appendix's 9.3 row), and `team.reply` is the stop's heading.

## O4 · `one-service`

| Key | English | Arabic |
|---|---|---|
| `one.first` (unchanged) | Your first campaign | أول حملة |
| `one.pending` | We'll pick it together | نختارها مع بعض |
| `one.chosen` | Chosen | اخترناها |
| `example.tag` | Example ad | إعلان للتوضيح |

**Spoken lines (Arabic)**
- هذا مثال لإعلان عن {prep.service_focus} باسمكم. إعلاناتكم الخاصة نسويها من محتواكم.

The English note names the logo too; the Arabic leaves شعاركم out, since a client with no logo sees their first letter (the fixer's round).

The service is named by `service_focus_ar`; a service on file only in Latin letters is left out of the spoken line, as O7 leaves it out (score round 2's rule).

## O6 · `this-week`

| Key | English | Arabic |
|---|---|---|
| `week.now` | Now, on this call | الحين، على المكالمة |
| `week.later` | This week, from you | هالأسبوع، منكم |
| `week.guide` | Video guide · {m:ss} | فيديو شرح، {length in words} |

The length is said in words through the deck's existing `lengthText` (decision 13, rounded to the minute): فيديو شرح، دقيقتين for 1:34, فيديو شرح، ٤ دقايق for 3:51.

`week.line` (وأغلبه بنسويه مع بعض، الحين.) leaves the slide: "Now, on this call" (الحين، على المكالمة) says it a line below. It is said instead.

**Spoken lines (Arabic)**
- (As the slide opens) وأغلب هذا بنسويه مع بعض، على المكالمة نفسها.
- خلنا نخلص صلاحيات ميتا ومنصة Mahara OS الحين.

## O7 · `next`

| Key | English | Arabic |
|---|---|---|
| `next.title.expect` | What to expect | اللي تتوقعونه |
| `next.band.title` | Next: your Brand Blueprint call | الخطوة الجاية: مكالمة بناء الهوية والعرض |
| `next.band.line` | 45 minutes with our creative director: your brand, your offer, your first ad scripts. | ٤٥ دقيقة مع المدير الإبداعي: هويتكم، وعرضكم، وسكربتات أول إعلاناتكم. |

`next.title` (the overview's title) stays اللي تتوقعونه، والخطوة الجاية. The two band strings are `next.band` split at its middot, word for word. Stop 1's strip of example tiles carries `example.tags` (إعلانات للتوضيح).

**Spoken lines (Arabic)**
- (Stop 1, the strip) هالصور الصغيرة أمثلة لإعلانات، مو إعلاناتكم: أغلبها نوقفه، وكم واحد يكمل. وهذا هو الاختبار.

## Example ads

| Key | English | Arabic |
|---|---|---|
| `example.tag` | Example ad | إعلان للتوضيح |
| `example.tags` | Example ads | إعلانات للتوضيح |
| `example.short` | Example | مثال (also the chip on L5's form cover when it is the example's picture) |
| `ads.lineExample` (new) | Where your ads will show on your customers' phones. | هذي الأماكن اللي بتطلع فيها إعلاناتكم على جوالات عملائكم. |
| `ads.foot.example` | Meta fits each ad to the screen it shows on. | ميتا تضبط الإعلان على مقاس الشاشة اللي يطلع فيها. |

`ads.empty` is unchanged (نشتغل على أول إعلاناتكم الحين): the title's tag and the thumbnail's chip already say the phones show an example. `ads.lineEmpty` (بهالشكل بتطلع إعلاناتكم…) stays for the starter case only: beside an example it would call the example their look.

**The pictures' alt text** (إعلان للتوضيح: {scene}):

| Theme | English scene | Arabic scene |
|---|---|---|
| kitchen | a finished kitchen with an oak and quartz island | مطبخ جديد بجزيرة كوارتز وخشب بلوط |
| living | a new villa living room | صالة جديدة في فيلا |
| majlis | a contemporary majlis with carved wood and brass lanterns | مجلس عصري بخشب محفور وفوانيس نحاس |
| villa | a new two-storey villa at golden hour | فيلا جديدة من دورين وقت الغروب |
| construction | a villa's concrete frame on a tidy site | هيكل خرساني لفيلا في موقع مرتب |
| bathroom | a marble bathroom with a stone bathtub | حمام رخام فيه بانيو حجر |
| pool | a villa pool at dusk | مسبح فيلا وقت المغرب |
| landscape | a landscaped villa garden with a pergola | حديقة فيلا منسقة فيها برجولة |
| bedroom | a calm master bedroom | غرفة نوم رئيسية هادية |
| office | a fitted-out office with a glass meeting room | مكتب مجهّز فيه غرفة اجتماعات زجاج |
| facade | a renovated villa facade in stone | واجهة فيلا مجددة بالحجر |
| stairs | an entrance hall with a floating marble staircase | مدخل فيه درج رخام معلّق |

**Inside an example phone** the Arabic deck's caption is `selling_point_ar`, else `service_focus_ar`, else nothing; the button is معرفة المزيد (Meta's label, decision 9).

**Spoken lines (Arabic)**
- (L2 stop 1, when its phone shows the example) هذا إعلان للتوضيح، ومكتوب عليه كذا. ولما تجهز إعلاناتكم، تطلع مكانه.
- (L4, when the phones show the example) هذي إعلانات للتوضيح، ومكتوب عليها كذا. ولما تجهز إعلاناتكم، تطلع مكانها.
- (L3 stop 1) هالمربعات أمثلة لإعلانات، مو إعلاناتكم. الفكرة إنكم تشوفون كم إعلان نختبر.

## L3 · `creative-freedom`, stop 3

| Key | English | Arabic |
|---|---|---|
| `test.field.tag` (changed: it read توضيح) | Example ads | إعلانات للتوضيح |
| `test.field.tag.pick` (new: when their pick is on the field) | Example ads, and your pick | إعلانات للتوضيح، واختياركم |
| `test.fixed.source.both` | From your card, and what you told us on the onboarding call. | من ملفكم، ومن اللي قلتوه لنا بمكالمة التعريف. |
| `test.fixed.source.card` | From your card. | من ملفكم. |
| `test.fixed.source.told` | What you told us on the onboarding call. | اللي قلتوه لنا بمكالمة التعريف. |
| `test.fixed.card` (renamed: it read من ملفكم, which the source line now says) | On your card, in English | بملفكم، بالإنجليزي |

Off the canvas: `test.fixed.name` (الثابت: خطوطكم الحمراء), `test.fixed.copy` (وهذي ما نتعداها أبد.), `test.fixed.told` (قلتوا لنا).

**The heads say it once.** Under أبداً a line drops a leading أبد or أبداً; under دايماً a leading دايماً or دائماً. A line's own ما or لا stays, so أبداً over ما نعرض الأسعار reads as one sentence, the way the heads were meant (score round 2).

**The card's lines in Arabic (`dos_donts_ar`).** Each card line gets its Arabic in prep, typed by the CSM in this register and without أبد or دايماً (the head says it): "Never show prices in an ad" → ما نعرض الأسعار بالإعلان; "Show our real projects, never stock photos" → نعرض مشاريعكم الحقيقية، مو صور جاهزة. A line with its Arabic sits in its group like any other; a line without one stays in English, quoted as written, and prep counts it. The panel keeps the English deck's two columns, أبداً and دايماً (score round 2 of the five services: it had stacked its groups, then the English block under a third head with run-in heads): each column lists its Arabic lines first, then that column's English card lines as one left-to-right block at the column's start, its marks on its own left. The first such block carries the small tag بملفكم، بالإنجليزي in ink-3, said once on the panel.

**Spoken lines (Arabic), stop 3, changed:** the input line first, unchanged (أي فكرة أو عرض جديد أو سعر جديد أو تغيير، أرسلوه بالقروب قبل لا نسوي الإعلانات الجاية، عشان يكون فيها من البداية، وإحنا نرد عليكم بالسبب.), then the red lines: وبعدها خلوني أقرا لكم خطوطكم الحمراء.. فيه شي ثاني ما تبونا نقوله أو نوريه أبد؟

## L7 · `partnership`

| Key | English | Arabic |
|---|---|---|
| `partner.piece.meeting` (new) | The meeting | الموعد |
| `partner.piece.close` (changed: it read الموعد وتوقيع المشروع) | The close | توقيع المشروع |

Done with you is unchanged. The spoken lines keep الموعد وتوقيع المشروع as one phrase.

## L8 · `training`

| Key | English | Arabic |
|---|---|---|
| `training.when.line` (changed) | Everyone who meets your customers or sends the quotes watches it, starting with the sales crash course. | كل اللي يقابل عملاءكم أو يرسل عروض الأسعار يشوفه، ويبدي بأول قسم فيه، أساسيات البيع. |

The Latin "Sales crash course" left the middle of the sentence (the score round's finding): the screenshot beside it shows the section's own English name, and the line says what it is. Point 6 of "Points for the lead" is settled this way. The spoken line changes with it: (The lesson) وأول قسم فيه، أساسيات البيع. ابدوا منه.

## The Drive link (prep's ads panel and the notes window; cockpit UI)

| English | Arabic |
|---|---|
| Bring in from Drive | جيب من الدرايف |
| Paste a Drive link | الصق رابط من الدرايف |
| A folder, or one video or picture. The first files arrive in the tray in about a minute. | مجلد، أو فيديو أو صورة وحدة. أول الملفات توصل للتصاميم خلال دقيقة تقريباً. |
| Bring in · Checking… · Started | جيب · نتأكد من الرابط… · بدينا |
| {link}: {its sentence} (one line per refused link) | {link}: {its sentence} |
| Skipped | تركناه |
| Only the first 10 links were sent. Paste the rest once these finish. | أرسلنا أول ١٠ روابط بس. الصق الباقي لما تخلص هذي. |
| Bringing in {n} links from Drive… | نجيب {n} روابط من الدرايف… (٢: رابطين · ٣ إلى ١٠: {n} روابط) |
| Bringing in {n} of {total} links from Drive… | نجيب {n} من {total} روابط من الدرايف… (the noun follows {total}: ٣ إلى ١٠ روابط، ١١ وفوق رابط) |
| Waiting to start. It usually starts within a minute. | ينتظر دوره. عادةً يبدي خلال دقيقة. |
| Opening the Drive link… | نفتح رابط الدرايف… |
| Bringing in {n} files from Drive… | نجيب {n} ملفات من الدرايف… (١: ملف واحد · ٢: ملفين · ٣ إلى ١٠: {n} ملفات · ١١ إلى ٢٠: {n} ملف) |
| Waiting · Bringing in · In the tray · Already in the tray | ينتظر · نجيبه · وصل للتصاميم · موجود من قبل |
| Brought in {n} files from Drive. | جبنا {n} ملفات من الدرايف. (the same number forms) |
| Brought in {landed} of {n} files. Each one that didn't come in says why below. | جبنا {landed} من {n}. واللي ما وصل، مكتوب تحته السبب. |
| Everything in this link is already in the tray. | كل اللي في هالرابط موجود بالتصاميم من قبل. |
| Only the newest 20 came in. Paste a subfolder's link for the rest. | وصل أحدث ٢٠ ملف بس. وللباقي، الصق رابط مجلد من داخله. |
| Nothing has picked this up yet. The Drive importer last ran {time}. Upload the files here for now. | ما بدينا فيه للحين. آخر مرة اشتغلت أداة الدرايف {time}. ارفع الملفات هنا لين ترجع تشتغل. |
| This stopped part-way. The Drive importer last ran {time}. It carries on when it runs again; upload the files here if you need them now. | الاستيراد وقف بالنص. آخر مرة اشتغلت أداة الدرايف {time}. بيكمل من مكانه أول ما ترجع تشتغل، وإذا تحتاج الملفات الحين، ارفعها هنا. |
| The Drive importer hasn't run yet. Upload the files here for now. | أداة الدرايف ما اشتغلت للحين. ارفع الملفات هنا لين تشتغل. |
| Couldn't check the import: {reason}. Trying again. | ما قدرنا نتأكد من الاستيراد: {reason}. نحاول مرة ثانية. |
| Show the list ({n}) · Hide the list | اعرض القائمة ({n}) · سكّر القائمة |
| Clear the link | امسح الرابط |
| Bringing in from Drive isn't live yet. Upload the files here for now. | الاستيراد من الدرايف ما صار جاهز للحين. ارفع الملفات هنا لين يجهز. |

**The server's sentences** (`DRIVE-IMPORT.md` 6, by code):

| Code | English | Arabic |
|---|---|---|
| `link_empty` | Paste a Drive link: a folder, or one video or picture. | الصق رابط من الدرايف: مجلد، أو فيديو أو صورة وحدة. |
| `link_docs` | That's a Google Docs link. Paste a Drive folder, or one video or picture. | هذا رابط مستند من Google Docs. الصق رابط مجلد بالدرايف، أو فيديو أو صورة وحدة. |
| `link_page` | This link opens a Drive page, not a folder. Open the folder and copy its link. | هذا الرابط يفتح صفحة بالدرايف، مو مجلد. افتح المجلد وانسخ رابطه. |
| `link_bad` | This isn't a Drive folder or file link. | هذا مو رابط مجلد أو ملف بالدرايف. |
| `too_many_open` | Ten imports are already running for this client. Wait for one to finish, then paste the link again. | فيه ١٠ عمليات استيراد شغالة لهالعميل. انتظر وحدة تخلص، وبعدها الصق الرابط مرة ثانية. |
| `too_many_links` | Too many Drive links in the last hour. Wait a few minutes, then paste it again. | وصلتنا روابط درايف كثيرة خلال آخر ساعة. انتظر كم دقيقة، وبعدها الصق الرابط مرة ثانية. |
| `not_found` (a folder) | We can't open this folder. Ask the client to share it as anyone with the link, or move it into their Drive folder. | ما نقدر نفتح هالمجلد. اطلب من العميل يشاركه مع أي شخص لديه الرابط، أو ينقله داخل مجلدهم بالدرايف. |
| `not_found` (a file) | We can't open this file. Ask the client to share it as anyone with the link, or move it into their Drive folder. | ما نقدر نفتح هالملف. اطلب من العميل يشاركه مع أي شخص لديه الرابط، أو ينقله داخل مجلدهم بالدرايف. |
| `not_found` (an open?id= link) | We can't open this link. Ask the client to share it as anyone with the link, or move it into their Drive folder. | ما نقدر نفتح هالرابط. اطلب من العميل يشاركه مع أي شخص لديه الرابط، أو ينقل الملف داخل مجلدهم بالدرايف. |
| `not_media` | That file isn't a picture or a video. Paste a folder, or one video or picture. | هالملف مو صورة ولا فيديو. الصق رابط مجلد، أو فيديو أو صورة وحدة. |
| `nothing_found` | There are no pictures or videos in this folder, or in the folders inside it. | ما فيه صور ولا فيديوهات في هالمجلد، ولا في المجلدات اللي داخله. |
| `drive_down` | Drive can't be reached from our side right now. Upload the files here instead. | ما نقدر نوصل للدرايف من عندنا الحين. ارفع الملفات هنا بدال الرابط. |
| `access_revoked` | This import stopped: whoever started it can no longer open this client. | توقف الاستيراد: اللي بداه ما عاد يقدر يفتح هالعميل. |
| `stopped` | This import stopped three times without bringing anything in. Paste the link again, or upload the files here. | توقف الاستيراد ثلاث مرات وما جاب شي. الصق الرابط مرة ثانية، أو ارفع الملفات هنا. |
| `not_started` | This import couldn't start. Paste the link again, or upload the files here. | ما قدرنا نبدي بالاستيراد. الصق الرابط مرة ثانية، أو ارفع الملفات هنا. |
| `too_big` (a video) | {name} is too long or too large to bring in. Upload a cut under 5 minutes, or send it in the group. | {name} طويل أو حجمه كبير، وما نقدر نجيبه. ارفع نسخة أقل من ٥ دقايق، أو أرسله بالقروب. |
| `too_big` (a picture) | {name} is over 150 MB. Export a smaller copy and upload it here. | {name} أكبر من ١٥٠ ميقا. صدّر نسخة أصغر وارفعها هنا. |
| `wrong_type` | {name} isn't a picture or a video we can show. Pictures: JPG, PNG, WebP. Videos: MP4, MOV, WebM. | {name} مو صورة أو فيديو نقدر نعرضه. الصور: JPG وPNG وWebP. الفيديوهات: MP4 وMOV وWebM. |
| `heic` | {name} is an iPhone photo (HEIC) we couldn't convert. Export it as JPG and upload it here. | {name} صورة آيفون (HEIC) ما قدرنا نحولها. صدّرها JPG وارفعها هنا. |
| `unplayable` | {name} couldn't be converted to play in a browser. Export it as MP4 and upload it here. | {name} ما قدرنا نحوله عشان يشتغل بالمتصفح. صدّره MP4 وارفعه هنا. |
| `download` | {name} didn't come through from Drive. Paste the link again; files already in the tray are skipped. | {name} ما وصل من الدرايف. الصق الرابط مرة ثانية، واللي بالتصاميم ما يتكرر. |
| `storage` | {name} didn't save. Paste the link again; files already in the tray are skipped. | {name} ما انحفظ. الصق الرابط مرة ثانية، واللي بالتصاميم ما يتكرر. |
| `unfinished` | {name} didn't finish. Paste the link again; files already in the tray are skipped. | {name} ما كمل. الصق الرابط مرة ثانية، واللي بالتصاميم ما يتكرر. |
| `full` | This client has 200 files already. Remove some, then paste the link again. | عند هالعميل ٢٠٠ ملف. شيل بعضها، وبعدها الصق الرابط مرة ثانية. |
| `converted` (a note on a file that landed, not a failure; it replaces the `hevc` note: HEVC is now converted) | {name} was converted to MP4 so it plays in every browser. | {name} حوّلناه MP4 عشان يشتغل على كل المتصفحات. |

`{name}` is the file's Drive name, in `<bdi dir=auto>`, as any name is (DESIGN 13.2). Latin product names (Google Docs, JPG, HEIC, Safari) stay in Latin and are isolated.

---

# Appendix: canvas labels that live in DESIGN.md

`DESIGN.md` draws a few labels on the canvas that `CONTENT.md` does not list. They are given here so the Arabic is in one place. The decision table in `CONTENT.md` rules wherever the two files once disagreed, and `DESIGN.md` 16.2 rules on media. Notes-window and prep-view strings are cockpit UI, in English, and are not listed.

| Where (DESIGN) | English | Arabic |
|---|---|---|
| 5.4 tags | Preview · Your form · Example form · Example · Example wording · Example written from our script · Demo workspace · Starter, from our templates · Illustration · Academy screenshot | معاينة · نموذجكم · نموذج للتوضيح · مثال · صياغة للتوضيح · مثال مكتوب من سكربتنا · حساب تجريبي · إعلان بداية، من قوالبنا · توضيح · لقطة من الأكاديمية |
| 6.5 queue card | New enquiry · {service} | استفسار جديد، {service} |
| 6.5 queue card | Try 2 of 4 · {service} · 5 pm | المحاولة ٢ من ٤، {service}، ٥ مساءً |
| 6.5 queue card | Callback · {service} · 10 am | معاودة اتصال، {service}، ١٠ صباحاً |
| 6.5 queue card | Not reached after 4 tries · reason noted | ما ردّ بعد ٤ محاولات، السبب مكتوب |
| 6.5 queue card | Came in at night? Called from 10 the next working morning. | وصل بالليل؟ نتصل عليه من الساعة ١٠ صباح أول يوم دوام. |
| 6.8 queue chip, DWY | Your team | فريقكم |
| 6.5 calendar entry | {day} · 4 pm · Appointment · {place} | {day} · ٤ مساءً · موعد، {place} |
| 7.2 to 7.4 Meta chrome | See more · Like · Comment · Share | عرض المزيد · أعجبني · تعليق · مشاركة |
| 7.3 label | Reels and Stories | ريلز وستوري |
| 8.3 leaders ({word} is the phone's Sponsored named in the deck's language, مُموَّل in the Arabic deck, Sponsored in the English one, since score round 1; the button stays as the phone shows it, isolated after the colon) | Your page and logo · Marked {word} · Your picture or video · Your words · The button: Learn more | صفحتكم وشعاركم · مكتوب عليه {word} · صورتكم أو الفيديو · كلامكم · الزر: معرفة المزيد |
| 8.3 leaders, {word} | The phone's Sponsored named in the deck's language, whatever the phone's: Sponsored | مُموَّل |
| 8.3 crop leader | Meta crops this to 4:5 in the feed | ميتا تقص هذا على مقاس ٤:٥ في الفيد |
| 8.3 phone fallback | Your ad goes here | إعلانكم هنا |
| 8.3 foot | Previews. Meta fits each ad to the screen it shows on. | معاينات. ميتا تضبط كل إعلان على الشاشة اللي يطلع فيها. |
| 8.5 list | The questions · Choice · Then: your thank-you screen | الأسئلة · اختيار · وبعدها: صفحة الشكر |
| 8.9 rows | Finding what works · Check-ins · Go-live | نكتشف اللي يشتغل · مكالمات المتابعة · الإطلاق |
| 9.3 group header | Your WhatsApp group | قروب الواتساب |
| 9.4 matrix | + Add a service · Your first campaign | + أضيفوا خدمة · أول حملة |
| 9.7 label | Next | الخطوة الجاية |
| 10.1 in-use chips | Feed · Reels · Facebook feed | فيد · ريلز · فيد فيسبوك |
| 20.3 the pie's owners | Our team · You · Your team (done with you) | فريقنا · أنتم · فريقكم |
| 20.4 the roads' nodes | Your meeting · Signed project | موعدكم معه · مشروع موقّع |
| 20.5 the label over the four | What it teaches | اللي بتتعلمونه |
| 20.7 the calendar week | Blocked (the key) · Day off | مسكّر · إجازة |
| 20.7 the calendar week's days | Sat · Sun · Mon · Tue · Wed · Thu | سبت · أحد · اثنين · ثلاثاء · أربعاء · خميس |
| 12 a slide that could not be drawn | This slide could not be drawn. | ما قدرنا نعرض هالشريحة. |
| 12.1 chrome | Back to {client} · Notes · All slides · Full screen | رجوع إلى {client} · الملاحظات · كل الشرائح · ملء الشاشة |
| 12.1 closed screen | Deck closed | انتهى العرض |
| 21.1 the field's labels | Next round · Your style change | الإعلانات الجاية · تعديلكم على الشكل |
| 21.2 the video control | Watch: | شوفوا: |
| 21.3 the overlay | Close · Loading the video | إغلاق · نحمّل الفيديو |

The thank-you default and the example form speak to the customer, so they are singular.

---

# Points for the lead

1. **Meta's Arabic labels** (مُموَّل, the call-to-action buttons, the instant form's fields) are unverified. Read them from a live Arabic preview.
2. **The CSM's Arabic title** needs a gender or an Arabic title on the seat (decision 8).
3. **Prep needs Arabic boxes** for the service focus, the selling point, the project, the red lines and any goal edits, or the Arabic deck shows English inside Arabic sentences.
4. **The Academy's onboarding course** (course 2) is التعريف on L8 since the visual review of 2026-10-20, the deck's own word for onboarding; the sales deck's الأونبوردنق is agency jargon. O6 no longer names it: since the spec review it starts them on course 1, كورس البداية. If the Academy has an Arabic title for either, use it.
5. **The live WhatsApp confirmation template** in Arabic, word for word, so stop 7 of the call can copy it.
6. **The Academy's course names in Arabic** (L8) are the sales deck's, except Onboarding (التعريف), and Project Closing Mastery's first section stays in Latin (Sales crash course). The lit course carries its Latin name under the Arabic one, so the client finds it on the Academy. If the Academy has its own Arabic titles, use them, so the client finds the course by the name on the slide.
7. **ميتا تقيّد الحساب** (L12) says what Meta does to an account after repeated failed payments in plain words. Check it against the wording Meta shows an Arabic advertiser.
8. **Mahara's name in Arabic** (2026-10-20, closed the same day). The welcome slot's title is حياكم الله في مهارة: the company is مهارة in Arabic, as the cockpit's own client messages and the sales deck spell it. Mahara OS stays Latin, the product's name.
9. **The seeded videos' language** (`CONTENT.md` open question 30). Four are seeded for any language (the welcome video, the two Loom guides and, since the CEO's request of 2026-10-20, the calendar Loom). If one speaks only English, its row becomes English, and the Arabic deck stops showing it on the canvas and in the recap. The Mahara OS guide is the only one with an Arabic recording, titled in Arabic on Wistia.
10. **Drive's Arabic name for "Anyone with the link"** (the Drive box's three `not_found` sentences, spec review of the visual pass). The sentences say أي شخص لديه الرابط, and the CSM asks the client to do both (يشاركه، أو ينقله). If Drive's Arabic sharing menu names the setting differently, use its words, so the client finds the setting by the name the CSM says.

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
- Unchanged on purpose: the chip «لين ٤ محاولات خلال ٣ أيام دوام», the first check-in «أول مكالمة متابعة، بعد أسبوع أو أسبوعين», the no-show «علينا. نتصل عليه ونحجز له من جديد.», and every DWY fork line.

---

# Gamma pass (2026-10-20)

The Arabic follows `CONTENT.md`'s Gamma pass slide for slide, under `mahara-context/skills/aziz-kuwaiti-voice`, in the slide-level white Gulf register (Saudi-safe, the firm in the plural, the customer singular, no ج/ي swaps on slides, no Kuwaiti-only or Saudi-only words). Decision 12 records the word choices.

- **New:** L7 `partnership` (the pie, the two roads, the partnership line), L8 `training` (the Academy's six courses, Project Closing Mastery's four parts, the three statements), L12 `good-to-know` (the money rows and the housekeeping, under قبل لا ننطلق). Their spoken lines are new, written for the CSM to say, in the same register as the slides around them.
- **Changed:** `journey.5` names the alerts (بالمواعيد الجديدة، وبأي إلغاء أو تغيير). L9 stop 4 gains its "tell us" set (`portal.4.came.line`, `portal.4.quote.line`, `portal.4.won.line`, `portal.4.moved`, and `portal.4.late.dwy`). L10 has six jobs under three heads; the two jobs it lost are said on L3 (the offer) or folded into the open-slots job (the calendar). L11 gains `days.1.slow`. L13 keeps only the question. `team.foot` (and its UAE line) says خلال ساعتين دوام. `road.stop.5.time` is تقريباً ٤٥ دقيقة. L1's spoken frame says ٤٥ دقيقة and adds ومين يسوي كل خطوة.
- **Reused as they were:** the green light's charges and comments lines, now L12's first and fourth rows with their heads (`know.charges.line` keeps «وهذا طبيعي. بلّغوا البنك عشان ما يوقفها.»; `know.comments.line` keeps «ما تدرون كيف تردون؟ اسألونا بالقروب.»), the old "Your part" jobs and reasons that stay, and the old tile 4's Arabic, now L3's spoken line about the offer.

---

# Spec review (2026-10-20)

The Arabic follows `CONTENT.md`'s spec review line for line, under the voice skill, in the same slide-level white Gulf register. The new lines are the review's own Arabic where it gave one; the rest is cut from the approved Arabic.

- L6: `call.after.line` (done for you) is new, with its spoken line.
- L7: the length labels are gone, `partner.line.1` is spoken, and `partner.line` (stop 4) is the one line on the canvas. The spoken stop 1 says هالقطعة علينا (one piece), not ثلاث قطع من الأربع.
- L8: `training.lead` names the course once; `training.teaches` (اللي يعلّمه) is new; who and when are one line, ending on the sales crash course; a spoken line for the follow-ups section.
- L9: the three captions are one line each; `portal.4.moved` splits moved (نعدّل التذكيرات) from cancelled (نتصل عليه ونحجز له من جديد); the spoken "why it matters" line is gone (its one home is L10), and a line adds whoever meets the customers to Mahara OS.
- L10: the title is the one line; «أسبوع بأسبوع» heads the third column; the open-slots why is two sentences; the ads and follow-up whys are new; done with you, the calling job sits before the meetings and the marking job is the stage move.
- O6: «انضموا، وابدوا بكورس البداية.»

---

# Creative flexibility and video slots (2026-10-20)

The Arabic follows `CONTENT.md`'s pass of the same name line for line, under `mahara-context/skills/aziz-kuwaiti-voice`, in the slide-level white Gulf register (Saudi-safe, the firm in the plural, the customer singular, no ج/ي swaps on slides, no Kuwaiti-only or Saudi-only words). Decision 13 records the word choices.

- **L3** is five stops. New: `test.job.*`, `test.volume.*`, `test.input.*`, `test.round`, `test.check.*`, `test.content.*`, and the spoken lines for each stop, the handle included. Approved Arabic reused as it was: the title, the red lines' panel and fallback, the pick lines, the leader, the approval line (now on stop 4), the Drive line (now stop 5's small line, from `driveMissing`), the stamp, the offer's spoken line (its first two sentences now also stop 3's `test.input.offer`, cut to «خلوا عرضكم ثابت وقت الاختبار. العرض الجديد يرجّع الاختبار من البداية.»), the perfect-ad line and the close. `test.fixed.copy` keeps only its first sentence.
- **The handle** keeps Mahara's warmth: «لما تشوفون إعلاناتكم، أكيد بتبون تغيرون أشياء صغيرة. هذي نخليها للإعلانات الجاية، عشان إطلاقكم ما يتأخر.» The pushback asks with أيهم أهم لكم, not وش (decision 2 keeps Saudi-only words out of the slides, and the spoken lines follow it).
- **O7:** `next.test.line` plants the volume and the moving launch before the red lines, and one spoken line says the testing in one breath.
- **Video slots:** the titles, the control, its lengths in words, the overlay's three lines and the recap's heading, all new. The overlay's failure lines speak to the client (we'll send the link); what the CSM should do is in the notes window, in English.


---

# Spec review of creative flexibility and the video slots (2026-10-20)

The Arabic follows `CONTENT.md`'s revision of the same name line for line, under `mahara-context/skills/aziz-kuwaiti-voice`, in the slide-level white Gulf register (Saudi-safe, the firm in the plural, the customer singular, no ج/ي swaps on slides, no Kuwaiti-only or Saudi-only words). Where the review gave its own Arabic, it is used as given; the rest is new and noted here. Decision 13 records the new words.

- **O7:** `next.ads.approval` names what they approve (المعلومات والأسعار والوعود اللي فيها); `next.test.line` plants the small check before any ad exists (والتعديلات الصغيرة على الشكل تروح للإعلانات الجاية); a spoken line sends ideas, the offer and the facts to the Blueprint call or the group before it.
- **L4:** a spoken line sets the guard rail before the phones; the wrong-fact and preference lines say where each one goes.
- **L3:** `test.input.copy` adds أو سعر جديد. The spoken lines: stop 1 says the CEO's contrast (هويتكم مهمة … أما الإعلانات فهدفها غير); stop 4 says what counts as more than taste and why the check stays small; the pushback goes back to both agreements, opens warmly, asks with one of three goal lines (3b, new: قلتوا لنا هدفكم لأول ٩٠ يوم), closes, and offers their version in the next round. The "Copy reply" has three variants; (b) and (c) are new, cut from (a)'s own clauses.
- **L8:** the tag لقطة من الأكاديمية and two alt texts (new); two spoken lines for the screenshot stops (new). The screenshots stay in English: they are the Academy's own screens.
- **L10:** the recap's testing line, كيف نختبر إعلاناتكم, as the review gave it.
- **Video slots:** two new titles, `onboarding:testing` (the launch deck's title, the same recording) and `first-90-days` (أول ٩٠ يوم); the day-one lengths in words; the "can't play here" line shows only on the provider's own error.


---

# Language and visual review of creative flexibility and the video slots (2026-10-20)

The reviewers' Arabic was used exactly where they gave it; the rest was written under `mahara-context/skills/aziz-kuwaiti-voice` in the same register. What changed and why:

- **يوقف means switched off on L3,** so "held back" in the why-it-stays-small line is ينتظر (the perfect-ad line's own verb): الإعلان اللي ينتظر تعديل صغير، إعلان ما نختبره. ونلقى اللي يشتغل لما نختبر أكثر.
- **The next slide** is الشريحة اللي بعد هذي, never اللي بعدها (its nearest antecedent was الإعلانات الجاية). وإحنا نشوف became وإحنا نمر عليها, which commits.
- **Agreement and meaning:** النسخ القليلة اللي تشتغل; خلوا المحتوى يوصلنا أول بأول (the deck's own phrase); the switched-off line keeps its reassurance (مو معناها إن فيه شي غلط); input first keeps its reason (عشان يكون فيها من البداية); the held goal works towards it (عشان نشتغل عليه); a referral يثق فيكم من قبل, as L7 says it; قسم المتابعة يخص اللي قاعدين يفكرون.
- **Register:** ياليت ما تراسلون العميل (a request, not an order); مصروف الإعلانات للشهر كامل on the card (مصروف الشهر alone is a household allowance); ممتاز as the affirming reply; أشطر for "better at it"; the spoken day-off line in spoken words (وحطوها مشغول، مو حدث على اليوم كامل); ونصلح بعد for the written وكذلك; وعلى مين يسوي كل خطوة keeps the list parallel; ومن داخله.
- **Names:** حياكم الله في مهارة (decision: the company is مهارة in Arabic, as the cockpit's client messages and the sales deck; Mahara OS stays Latin); أول ٩٠ يوم for the slot, as L11's title; تدريبكم على المبيعات; اللي بتتعلمونه; L8's course 2 is التعريف, and the lit course carries Project Closing Mastery in Latin under its Arabic name.
- **The goal in the pushback** follows a colon and ends its own sentence: قلتوا لنا إن هدفكم: {goal}. أيهم أهم لكم … (no quote marks, decision 4), so a goal written as نبي… still reads.
- **New lines:** the day-off why on the slide, ويوم إجازتكم، سكروا الساعات ساعة ساعة، مو حدث على اليوم كامل. (it matches the drawn week); O7's approval line without its head, ما تنزل أي وحدة منها إلا بعد ما توافقون على المعلومات والأسعار والوعود اللي فيها.; the thank-you stop's call, وفريقنا يتصل عليه خلال ٥ دقايق في أوقات الدوام. (L5's WhatsApp step, word for word); مدة المكالمة on L6's ended clock; تقريباً عند ٣٠ و٦٠ و٩٠ يوم on L11; حدّثوا الجواب وقتها on L9.
- **The spoken cues for L3 name their stop** ("(Stop 2, most get switched off)"), so the notes window can follow the stop in Arabic too. The cue is English, for the CSM, and the copy test reads the Arabic after it.

---

# The fixer's round, score round 1 (2026-10-20)

The reviewers' Arabic was used where they gave it; the rest under `mahara-context/skills/aziz-kuwaiti-voice`, in the deck's warm client register.

- **O3:** كل اللي يشتغلون على حسابكم معكم في هالقروب. (one line; the rows under it name the roles).
- **O7:** إعلاناتكم هدفها تجيب لكم شغل، مو إنها تشبه صفحتكم. opens the testing line. The service is named in Arabic only (`service_focus_ar`); a Latin-only name is left unnamed, so لخدمة Kitchens never shows.
- **L2:** قبل الموعد · مكالمة تأكيد leads its row like the others; الموعد ends the list in bold.
- **L3:** تطلع بالفيد ومكتوب عليها مُموَّل، وما تنزل كمنشور على صفحتكم. (no absolute); تراجعونها بالقروب قبل لا ينزل الإعلان. (the two small lines merged); stop 4's spoken line now says the ads are on the next slide: بالشريحة الجاية بتشوفون إعلاناتكم.
- **L4 (the ads):** the spoken guard rail points back, مثل ما اتفقنا قبل شوي.
- **L6 stop 8:** كل اللي عرفه فريق الاتصال يوصلكم. leads the cards; the call length is ٤:٥١.
- **L7:** the ad road's bends say أول مرة يتعرف عليكم and يقارنكم بغيركم.
- **L8:** اللي يجونكم من الإعلانات أول مرة يقابلونكم، وهالكورس يعلمكم كيف تكسبونهم. and the label أكاديمية المشاريع المميزة.
- **L9:** لغى أو غيّر موعده معكم مباشرة؟ قولوا لنا بالقروب، ونعدّل التذكيرات أو نتصل عليه ونحجز له من جديد.
- **L10:** the key reads مسكّر, the word the notes already use for a blocked day (اليوم المسكّر).
- **L12:** أشياء تهمكم, with الفلوس and الرسايل.
- **The recap:** the testing line adds والتعديلات الصغيرة على الشكل تروح للإعلانات الجاية عشان إطلاقكم ما يتأخر and the content ask; the money and first-weeks lines are new.
- **Still English in the Arabic panel:** a card Do's & Don'ts line written in English stays English on L3 until prep can hold an Arabic version of it (a server prep key, the backend's).

---

# The fixer's round, score round 2 (2026-10-20)

In the deck's warm client register, under `mahara-context/skills/aziz-kuwaiti-voice`; every new line reuses the slides' own words.

- **L2:** the queue card names each row's own service in Arabic (`prep.services_ar`), and a row past the list leaves its service out. Since score round 1 of the five services (2026-10-21) its rows are the launch service, then the client's words for that same service only: never a sub-trade (المطابخ، الحمامات، الخزائن) and never another service's words (تشطيب فيلا كاملة in an interior design queue). The harness reads استفسار جديد، تصميم داخلي · المحاولة ٢ من ٤، تصميم داخلي للفلل · معاودة اتصال، تصميم المجالس. «٥ دقايق» is underlined in teal on stop 3, as on L5's band.
- **L3:** the panel's heads are أبد and دايماً; a line typed on O7 carries a small قلتوا لنا after it; the card's English lines sit under من ملفكم, quoted as written, so they never read as our own copy left untranslated. ملفكم, not بطاقتكم: the fallback already says ونضيفها لملفكم for the same card.
- **L8:** the Arabic lead already said يعلمكم كيف تكسبونهم; the English now says the same ("shows you how to win them").
- **L9:** the Arabic overview's row ends at ملاحظاتك, as the English ends at "Your feedback"; جودة العميل and كيف سار الموعد are masked.
- **L12:** بلّغوا البنك، قولوا لنا قبلها and بالتواريخ المكتوبة في عقدكم. are set in ink inside their lines.
- **O3:** the reply hours run on a 560 px line, so «من ١٠ صباحاً إلى ٦ مساءً» stays together and من never ends a line.
- **O7:** the testing line is three lines, the same words: the ads' job; نختبر إعلانات كثيرة، وبسرعة … small; and the ask over the red lines, وخطوطكم الحمراء ثابتة …, its و kept, since it reads on from the line above.
- **The recaps:** مين يسوي إيش: … in the launch recap until its three videos are recorded (both service models); O6's links carry إعلاناتكم هدفها تجيب لكم شغل. نختبر إعلانات كثيرة وبسرعة … وأرسلوا خطوطكم الحمراء بالقروب. until the `testing` video is.
- **Still English in the Arabic panel, now quoted:** a typed Arabic line per card item (`dos_donts_ar`) waits on the server key, which is the backend agent's migration.

---

# Spec review of the visual pass (2026-10-20)

In the deck's warm client register for the slides and the singular imperative for the CSM's box, under `mahara-context/skills/aziz-kuwaiti-voice`, Saudi-safe; every new line reuses words this file already set. `DESIGN.md` 22.10 is the change log.

- **L4:** `ads.lineExample`, هذي الأماكن اللي بتطلع فيها إعلاناتكم على جوالات عملائكم.: the line names where the ads show, never how theirs look, beside an example. `ads.empty` stays as it was.
- **L3:** إعلانات للتوضيح، واختياركم when their pick is on the field, so their own ad is never called an example.
- **O3, O6, O7:** three spoken lines; O6's `week.line` is said, not shown.
- **The alt text:** صالة جديدة في فيلا, with no city: a generated room is no real place's.
- **The Drive box:** أول الملفات توصل للتصاميم خلال دقيقة تقريباً (the first files, not all of them); the over-ten line and the plural نجيب {n} روابط; ١٠ open imports; the restricted-link sentences name the fix in the client's terms (يشاركه مع أي شخص لديه الرابط, the wording Drive's own Arabic sharing menu uses for "Anyone with the link", to be checked against it, point 10 of "Points for the lead"); الاستيراد ما بدا is said from our side, ما قدرنا نبدي بالاستيراد (decision 14); a converted video's note replaces the HEVC note; the too-big video sentence gives the 5-minute cut, ٥ دقايق as decision 11 spells it.

## The fixer's round, score round 1 (2026-10-21)

Written under `aziz-kuwaiti-voice`, the client register (warm, professional, Saudi-safe). `DESIGN.md` 22.12 has the why.

| Key | English | Arabic |
|---|---|---|
| `cover.roadLive` | Live since {date} · Launch call today | منطلقين من {date}، ومكالمة الإطلاق اليوم (score round 4: و ties the two facts; a bare comma read as a list) |
| `portal.installLabel` | Open this on your phone | افتحوا هالرابط من جوالكم |
| `next.cardName` | Brand Blueprint call | مكالمة بناء الهوية والعرض |
| `next.cardWith` | 45 minutes · Our creative director | ٤٥ دقيقة مع المدير الإبداعي (score round 4: the attendee needs مع, as the band line says) |
| `next.cardOpen` | We book it before we hang up | نحجزها قبل لا نسكر المكالمة |

`road.stop.4` keeps بناء الهوية والعرض (the English now reads "Brand Blueprint call"; the Arabic already named the same call). `team.line` (كل اللي يشتغلون على حسابكم معكم في هالقروب.) is said, not shown: the Arabic notes' stop 1 line (هذا قروبكم، والفريق كله فيه) already says it. `example.tag` was إعلان مثال here (decision 14): the score round read it as a calque and suggested نموذج, but نموذج is the decks' word for a form, so "نموذج إعلان" would read as an ad form. Score round 4 settled it as إعلان للتوضيح, the deck's own pattern for the same idea (نموذج للتوضيح، صياغة للتوضيح), which avoids نموذج, قالب and تجريبي.

## The fixer's round, score round 2 (2026-10-21)

Written under `aziz-kuwaiti-voice`, the client register (warm, professional, Saudi-safe). `DESIGN.md` 22.13 has the why. No new words on the canvas: O5's example confirmation reuses the live template's Arabic (تم تأكيد موعدك مع [اسم الشركة]. / التاريخ: {date} / الوقت: {time} / نشوفك على خير.) under صياغة للتوضيح, its date and time in the template's Latin digits as on L6; O7's empty day reuses `next.cardName` and `next.cardOpen`.

| Key | English | Arabic |
|---|---|---|
| L3 notes, stop 3 (new) | Stop 3, if they point at the pictures: "These are examples, to show how testing works. Your ads use your projects." | هذي أمثلة توضح كيف نختبر، وإعلاناتكم تكون من مشاريعكم. |


## The five main services (CEO, 2026-10-21)

Written under `aziz-kuwaiti-voice`, the client register (warm, professional, Saudi-safe). `CONTENT.md` [The five main services](CONTENT.md#the-five-main-services-ceo-2026-10-21) has the English and the rules; `DESIGN.md` 22.14 has the why.

**Decision 15, the five main services.** The service is one of the kickoff form's five, said as a label on the canvas and with ال inside a sentence; never a sub-trade (مطابخ، حمامات) as the service. The lead's draft named construction مقاولات وبناء; the decks say بناء وإنشاءات, because decision 3 keeps مقاول out of Mahara's Arabic (the voice skill's rule for the buyer, and EXAMPLE-CALL's «Never مقاول in Mahara's Arabic»), and إنشاءات is how a building firm names its own work. "Other" is خدمة أخرى as the row's name, and the client's own words everywhere else. The separator inside an Arabic line is «، », never a middle dot: beside Arabic-Indic digits a dot reads as ٠ (score round 3); every Arabic line in `content.ts` already uses it.

| Key | English label | Arabic label | Arabic inside a sentence |
|---|---|---|---|
| `design-build` | Design and build | تصميم وتنفيذ | التصميم والتنفيذ |
| `interior` | Interior design | تصميم داخلي | التصميم الداخلي |
| `architecture` | Architectural design | تصميم معماري | التصميم المعماري |
| `fitout` | Fit-out and renovation | تشطيب وترميم | التشطيب والترميم |
| `construction` | Construction | بناء وإنشاءات | البناء والإنشاءات |
| `other` | Other | خدمة أخرى | the client's own words |

In a sentence: لخدمة التصميم الداخلي (O7's starter line), إعلان عن التشطيب والترميم (O4's spoken line), مرتاحين نبدي بخدمة البناء والإنشاءات؟ (the temp check), بخصوص التصميم المعماري (the example call), أبي أعرف أكثر عن التصميم والتنفيذ (the WhatsApp message). On the queue card the label: استفسار جديد، تصميم داخلي.

**Slide 4's rows.** The client's own words under a row stay as they wrote them, in their own direction (`<bdi>`); more than fit on the line are counted after them as +٢, set left to right so it never reads ٢+ in front of a Latin line.

**Spoken line, O4 (replacing the first one)**
- هذي الخدمات الخمس الأساسية اللي نسوي لها حملات. أي وحدة فيها الأسهل بالبيع؟ وأي وحدة تجيب لكم أكثر ربح؟ وأي وحدة الأريح لكم بالتنفيذ؟

Not خدماتنا: the five are the client's kind of work, not services Mahara sells.

**The six new example scenes' alt text** (إعلان للتوضيح: {scene}):

| Scene | English scene | Arabic scene |
|---|---|---|
| construction2 | a residential tower's concrete frame under a crane at dusk | هيكل خرساني لبرج سكني وفوقه رافعة وقت المغرب |
| construction3 | a two-storey villa's concrete frame with scaffolding | هيكل خرساني لفيلا من دورين وحوله سقالات |
| fitout2 | a fitted-out boutique with stone counters and lit shelves | محل مجهّز بكاونترات حجر ورفوف فيها إضاءة |
| fitout3 | a fitted-out restaurant with timber booths and brass lights | مطعم مجهّز بجلسات خشب وإضاءة نحاس |
| designbuild | a new villa's glass living room over its pool at dusk | صالة زجاج في فيلا جديدة تطل على المسبح وقت المغرب |
| architecture2 | a modern villa with a timber-screened upper floor | فيلا حديثة دورها العلوي عليه سواتر خشب |

**Inside an example phone** the Arabic caption is `selling_point_ar` only, else nothing (no longer `service_focus_ar`); the Facebook headline is the service's Arabic label. The service is never written into a caption as if it were the client's copy.

**O6, the Mahara OS card without its video:** the demo workspace's phone, tagged حساب تجريبي (the portal slide's own tag).

**Harness only, the starter client's two starter templates** (fit-out and renovation, Kuwait; never on a client's deck, written in the same register so the preview reads as a real fit-out firm's ads, where they said نجدد مطبخكم):

| Phone | Arabic |
|---|---|
| Feed | نشطّب ونرمّم المحلات والمطاعم والمكاتب، من المخطط لين التسليم. |
| Reels | من أول معاينة للموقع لين آخر لمسة. |

**Score round 4 (2026-10-21), the Arabic.** Reviewed under `aziz-kuwaiti-voice` (warm-professional client register, Saudi-safe):
- "Example ad" is إعلان للتوضيح, plural إعلانات للتوضيح (decision 14, changed): إعلان مثال read as a word-for-word "Example ad"; the short tag stays مثال.
- The red lines' Never head is أبداً (أبد alone read as a cut-off word), beside دايماً; the quoted English block keeps its own أبداً and دايماً when it holds both.
- `next.cardWith` is ٤٥ دقيقة مع المدير الإبداعي; `cover.roadLive` is منطلقين من {date}، ومكالمة الإطلاق اليوم.
- Scenes: fitout2 محل مجهّز بكاونترات حجر ورفوف فيها إضاءة (a counter is كاونتر, not طاولة); designbuild تطل على المسبح; architecture2 عليه سواتر خشب; construction2 وفوقه رافعة; construction without its comma.
- Spoken: الفكرة إنكم تشوفون كم إعلان نختبر (L3 stop 1); تنحط علامة صح (O6).
- The Drive box: {time} is said with الساعة (الساعة 13:02، أمس الساعة 09:05); nobody's line is ما بدينا فيه للحين … لين ترجع تشتغل; the stalled line names its subject (الاستيراد وقف بالنص) with a comma before ارفعها; `notLive` is الاستيراد من الدرايف, never الجلب; `too_many_links` is said from our side (وصلتنا روابط درايف كثيرة … الصق الرابط مرة ثانية); `wrong_type` says الفيديوهات beside الصور.
- The notes window's Arabic temp check is filled from the Arabic slots; with no Arabic name for the service it reads (اسم الخدمة), a cue for the CSM, never a Latin name or الخدمة twice. A kickoff answer of أخرى, خدمة أخرى or غيرها is "Other" with nothing typed, never the client's words.
- Every single-string row above that still showed a middle dot now shows «، » (decision 15).

