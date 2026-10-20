# The example call (launch deck L6)

A written booking call, played as an animated transcript on the launch deck's slide 6. It is never a recording: no consent exists to play a real customer's call, and a real call would expose another client's brand and a real person's project and budget.

- **Built from** the dialer's booking script, `config/call-script.json` ("Call Center Script", Google Doc 1rZETe8O…, verified 2026-09-09), sections 01 to 06, with one question from `public/framework.js` (02) and the "How much does it cost?" and "I don't have a budget yet" answers from section 07. Nothing comes from any client's own call guide or from the AEA partner script.
- **The people.** The customer, أبو فهد, is fictional. The caller is never named: she opens as قسم المواعيد في [اسم الشركة], "the appointments team at {Company}" (CONTENT decision table). The lines are written for a woman; the swaps for a man are at the end.
- **Two full variants:** Kuwaiti (the script's own dialect, for Kuwait, Qatar, the UAE and Bahrain) and Saudi (for Saudi Arabia). Both are warm and professional: the caller speaks as the client's appointments team. Kuwaiti swaps are light (شنو، شلون، جم، جذي، ماكو), as the voice skill asks; the Saudi variant uses وش، ودّي، إيه، أبشر، قد.
- **Times and English subtitles** are CONTENT Appendix A's. The clock runs 0:00 to 4:51, paced on the median booked call (291 seconds, 39 calls). The pacing is never printed.
- **Long lines are split.** Any caller line over about 20 English words is two bubbles, split at the sentence break, each with its own time (DESIGN 11.2).
- **Speaker** is `agent` (the caller) or `lead` (the customer). These are data names only; on the canvas the tags are فريقنا and العميل.
- **Stage** is 1 to 6: 1 المقدمة · 2 تحديد الهدف · 3 التفاصيل · 4 اللي يميزكم · 5 الحجز · 6 تثبيت الموعد.
- **Pain variant.** The customer's bad experience comes in three versions, picked in prep (`prep.pain`) so it matches the client's selling point: delays (the default), design, or cost. The tables below are the delays version; the other two change four lines.

## Slots

The Arabic lines use the dialer's own bracket tokens, the way `fillScript` does. A filled slot shows in teal; a missing one shows the "نحتاجه منكم" chip with the text below.

| Arabic token | CONTENT slot | Source | Value forms | When missing |
|---|---|---|---|---|
| `[اسم الشركة]` | `{Company}` | `client.name`; Arabic name from `ghl_clients.client_name` in the Arabic deck | As stored | Never missing |
| `[اسم الخدمة]` | `{service}` | `prep.service_focus`, then `kickoff.advertised`, then `form.number_one` (Arabic prep value in the Arabic deck) | The service's name, e.g. التصميم الداخلي | Chip: نحتاجه منكم: الخدمة اللي نعلن عنها |
| `[المشروع]` | `{project}` | `prep.project`, then the family table below | See the table | مشروعك |
| `[اسم المهندس]` | `{engineer}` | The consultant in the client's call guide, then `form.engineers` | Title and name together: المهندس خالد، المهندسة ريم، المصمم فيصل | مهندسنا, plus the chip: نحتاجه منكم: مين يسوي الاستشارة؟ |
| `[نوع الاستشارة]` | `{free}` | `form.free_consult` | yes: استشارة مجانية · no: استشارة | استشارة, plus the chip: نحتاجه منكم: أول استشارة مجانية؟ |
| `[المكان]` | `{place}` | `form.consult_types`, first match | Kuwaiti: بمكتبنا · عندك بالبيت · أونلاين. Saudi: في مكتبنا · عندك في البيت · أونلاين | Chip: نحتاجه منكم: وين تسوون الاستشارات؟ |
| `[اللي يميزكم]` | `{selling point}` | `prep.selling_point`, typed in Arabic from their Brand DNA, offer or call guide | One clause in the client's voice, first person plural, in the call's dialect, starting with a verb or عندنا: عندنا [ميزة من دليلكم] | Chip: نحتاجه منكم: اللي يميزكم، بسطر واحد |
| `[حساب إنستقرام]` | `{instagram}` | `form.instagram`, handle only, isolated | @handle | The 4:35 bubble is dropped, and 4:29 ends the stage |
| `[اليوم]` | `{day}` | The first working day two days ahead, inside `form.hours` | The day's name: الأحد، الاثنين… | Two days ahead, Sunday to Thursday |
| `[الوقت]` | `{time}` | 4 pm, moved to the client's last afternoon hour when they close earlier | ٤ العصر (١ أو ٢ الظهر، ٣ إلى ٥ العصر); English "4 pm" | ٤ العصر · 4 pm |
| `[الميزانية]` | `{band}` | `prep.budget_band`, else the budget table below | The three options as one phrase | The script's figures, no currency |
| `[جواب الميزانية]` | `{band.answer}` | The middle band of the same row | بين خمسين ومية. | |

**Why the lines never use a pronoun for the consultant.** The consultant can be a man or a woman, an engineer or a designer. Every line that mentions them repeats the slot or makes the customer the subject (عشان تمرون على [المشروع] بالتفصيل), so any value fits. The slot carries its own title (المهندس، المهندسة، المصمم).

**The selling point** is the only place a claim about the client is spoken, and it comes from the client's own material. If the client's guide holds no claim, the chip shows. Never fill it with the script's own section 04 lines. Prep shows it beside the pain variant, so a client whose strength is design is not paired with a story about delays.

| Pain variant | The customer's story | Selling points that answer it |
|---|---|---|
| delays (default) | Finished four months late, no news from the site | Updates through the project, a site supervisor, a fixed programme |
| design | What was built didn't match the drawings | 3D designs before work starts, design and build in one team |
| cost | The final bill came in far above the quote | A clear written quote, no hidden extras |

### `[المشروع]`, by service family

Written in the caller's voice (your project), and every value starts with a masculine singular noun, so the verbs around it agree: "تبي [المشروع] يطلع صح".

| Family (CONTENT data map) | English (CONTENT) | Arabic, both dialects |
|---|---|---|
| interior design | the interior of your new villa | التصميم الداخلي لفيلتك الجديدة |
| construction | building your villa | بناء فيلتك |
| fit-out and renovation | renovating your ground floor | تجديد الدور الأرضي عندك |
| architecture | the design of your new villa | تصميم فيلتك الجديدة |
| engineering consultancy | the drawings and permits for your villa | تجهيز مخططات فيلتك وتراخيصها |
| landscaping | your garden and outdoor area | تنسيق حديقتك والجلسة الخارجية |
| kitchens | your new kitchen | مطبخك الجديد |
| anything else | your project | مشروعك |

### `[الميزانية]`, by country and scale

The fictional customer's band, in the client's currency. Construction uses the build scale; every other family uses the works scale (CONTENT data map). The CSM can edit any band in prep. Spoken numbers are words; the stop 8 note uses digits.

| Country | Scale | `{band}` (English) | `{band.answer}` | `[الميزانية]` (dialect of that country) | `[جواب الميزانية]` | `{band.note}` · Arabic note |
|---|---|---|---|---|---|---|
| Saudi Arabia | works | under 50 thousand riyals, between 50 and 100, or more | Between 50 and 100. | أقل من خمسين ألف ريال، ولا بين خمسين ومية، ولا أكثر | بين خمسين ومية. | 50 to 100 thousand riyals · من ٥٠ إلى ١٠٠ ألف ريال |
| Saudi Arabia | build | under half a million riyals, between half a million and a million, or more | Between half a million and a million. | أقل من نص مليون ريال، ولا بين نص مليون ومليون، ولا أكثر | بين نص مليون ومليون. | half a million to a million riyals · من نص مليون إلى مليون ريال |
| Kuwait, Bahrain | works | under 5 thousand dinars, between 5 and 10, or more | Between 5 and 10. | أقل من خمسة آلاف دينار، ولا بين خمسة وعشرة، ولا أكثر | بين خمسة وعشرة. | 5 to 10 thousand dinars · من ٥ إلى ١٠ آلاف دينار |
| Kuwait, Bahrain | build | under 50 thousand dinars, between 50 and 100, or more | Between 50 and 100. | أقل من خمسين ألف دينار، ولا بين خمسين ومية، ولا أكثر | بين خمسين ومية. | 50 to 100 thousand dinars · من ٥٠ إلى ١٠٠ ألف دينار |
| Qatar | works | under 50 thousand riyals, between 50 and 100, or more | Between 50 and 100. | أقل من خمسين ألف ريال، ولا بين خمسين ومية، ولا أكثر | بين خمسين ومية. | 50 to 100 thousand riyals · من ٥٠ إلى ١٠٠ ألف ريال |
| UAE | works | under 50 thousand dirhams, between 50 and 100, or more | Between 50 and 100. | أقل من خمسين ألف درهم، ولا بين خمسين ومية، ولا أكثر | بين خمسين ومية. | 50 to 100 thousand dirhams · من ٥٠ إلى ١٠٠ ألف درهم |
| Qatar, UAE | build | under half a million {currency}, between half a million and a million, or more | Between half a million and a million. | أقل من نص مليون {ريال أو درهم}، ولا بين نص مليون ومليون، ولا أكثر | بين نص مليون ومليون. | half a million to a million {currency} · من نص مليون إلى مليون {ريال أو درهم} |
| Unknown | either | under 50 thousand, between 50 and 100, or more | Between 50 and 100. | أقل من خمسين ألف، ولا بين خمسين ومية، ولا أكثر | بين خمسين ومية. | 50 to 100 thousand · من ٥٠ إلى ١٠٠ ألف |

---

## Variant 1: Kuwaiti (pain variant: delays)

| Time | Speaker | Stage | Arabic | English subtitle | Script source |
|---|---|---|---|---|---|
| 0:00 | agent | 1 | السلام عليكم، معاي أبو فهد؟ | Assalamu alaikum. Am I speaking with Abu Fahad? | §01 |
| 0:04 | lead | 1 | وعليكم السلام، إي نعم، أنا أبو فهد. | Yes, speaking. | new |
| 0:08 | agent | 1 | ياهلا والله. معاك قسم المواعيد في [اسم الشركة]، شلونك اليوم؟ | Hello, this is the appointments team at {Company}. How are you today? | §01, with the coordinator line folded in |
| 0:13 | lead | 1 | الحمد لله، بخير. | Good, thank God. | new |
| 0:17 | agent | 1 | شفت استفسارك اللي عبّيته بخصوص [اسم الخدمة]. | I saw the enquiry you sent us about {service}. | §01 |
| 0:24 | agent | 1 | وكنت حابة أعطيك فكرة سريعة.. مناسب معاك الحين؟ | I wanted to give you a quick idea. Is now a good time? | §01 |
| 0:30 | lead | 1 | إي، تفضلي. | Yes, go ahead. | new |
| 0:34 | agent | 2 | ممتاز. عشان أقدر أساعدك بأفضل طريقة، ودي أفهم شنو ببالك. | So I can help you properly, I'd like to understand what you have in mind. | §02 |
| 0:41 | agent | 2 | شنو أهم شي تتطلع تحققه في [المشروع]؟ | What matters most to you in {project}? | §02 |
| 0:49 | lead | 2 | إن الشغل هالمرة يطلع صح.. وإنه يكون على ذوقنا. | That it's done right this time, and that it's to our taste. | new |
| 1:00 | agent | 2 | وشنو الشي اللي بيخليك تقول إن المشروع نجح؟ | And what would make you say the project was a success? | FW 02 |
| 1:09 | lead | 2 | إنه يخلص بوقته، وما تطلع لنا مفاجآت بالتكلفة. | Finished on time, with no surprises on the cost. | new |
| 1:21 | agent | 3 | كلامك منطقي. ومن متى وانت تخطط لهالمشروع؟ | That makes sense. How long have you been planning it? | §03 |
| 1:27 | lead | 3 | تقريباً ست شهور.. ونبي نبدي قريب. | About six months. We'd like to start soon. | new |
| 1:37 | agent | 3 | واشتغلت مع شركة تصميم أو تنفيذ قبل، ولا هذي أول مرة؟ | Have you worked with a design or build company before, or is this the first time? | §03 |
| 1:46 | lead | 3 | مرة وحدة، قبل سنتين. وتأخروا علينا أربع شهور. | Once, two years ago. They finished four months late. | new |
| 1:57 | agent | 3 | ووين كانت المشكلة بالضبط؟ بالتصميم، ولا بالتنفيذ، ولا بعد التسليم؟ | Where did it go wrong: the design, the work itself, or after handover? | §03 |
| 2:05 | lead | 3 | بالتنفيذ. ما كنا نعرف شنو قاعد يصير بالموقع. | During the work. We never knew what was happening on site. | new |
| 2:17 | agent | 3 | يعني هالمرة تبي تكون عارف وين وصل الشغل، خطوة بخطوة. | So this time you want to know where things stand, step by step. | §03, the communication question as a summary |
| 2:24 | lead | 3 | بالضبط. | Exactly. | new |
| 2:30 | agent | 3 | وبخصوص الميزانية، عندك فكرة تقريبية عن المبلغ؟ | And on budget, do you have a rough figure in mind? | §03 |
| 2:37 | lead | 3 | بصراحة.. ودي أعرف جم بيكلف أول. | Honestly, I'd like to know what it costs first. | new |
| 2:44 | agent | 3 | سؤالك في محله. السعر يعتمد على التفاصيل والمواد والمساحة. | Fair question. The price depends on the details, the materials and the space. | §07, "How much does it cost?" |
| 2:51 | agent | 3 | وعشان جذي تجلس مع [اسم المهندس]، وتاخذ عرض سعر دقيق، مو تخمين بالتلفون. | That's why you sit with {engineer}: you get an accurate quote, not a guess over the phone. | §07 |
| 2:59 | agent | 3 | بس تقريباً، الميزانية [الميزانية]؟ | Roughly, are you thinking {band}? | §07, "I don't have a budget yet" |
| 3:08 | lead | 3 | [جواب الميزانية] | {band.answer} | new |
| 3:16 | agent | 4 | وصلت الصورة كاملة. تبي [المشروع] يطلع صح، وبوقته، وتكون عارف وين وصل الشغل أول بأول. | I have the full picture. You want {project} done right, on time, and to know where things stand. | §04 opening |
| 3:25 | agent | 4 | وإحنا في [اسم الشركة]، [اللي يميزكم]. | At {Company}, {selling point}. | FW 04, one point from the client's own material |
| 3:35 | lead | 4 | هذا بالضبط اللي أبيه. | That's exactly what I need. | new |
| 3:41 | agent | 5 | ودي أعرفك على [اسم المهندس]، عشان تمرون على [المشروع] بالتفصيل. شرايك نحجز لك [نوع الاستشارة]؟ | I'd like you to meet {engineer}, to go through {project} in detail. Shall we book you {free}? | §05 |
| 3:54 | lead | 5 | إي، خلنا نحجز. | Yes, let's do it. | new |
| 3:57 | agent | 5 | ممتاز. عندنا مجال يوم [اليوم]، الصبح أو العصر.. أي وقت أنسب لك؟ | We have {day}, morning or afternoon. Which suits you? | §05 |
| 4:04 | lead | 5 | العصر أحسن. | Afternoon. | new |
| 4:07 | agent | 5 | خلاص، تم: يوم [اليوم] الساعة [الوقت]، [المكان]. وبس للتأكيد، متأكد إنك تقدر تحضر؟ ماكو شي ممكن يمنعك؟ | Done: {day} at {time}, {place}. Just to be sure, can you definitely make it? Nothing that might stop you? | §05, the booking and the double tie-down |
| 4:23 | lead | 5 | لا، إن شاء الله بكون موجود. | No, I'll be there. | new |
| 4:29 | agent | 6 | تمام، موعدك تأكد يوم [اليوم] الساعة [الوقت]، وبتوصلك رسالة على الواتساب فيها كل التفاصيل. | Your appointment is confirmed for {day} at {time}. You'll get a WhatsApp with all the details. | §06, and §05's confirmation message |
| 4:35 | agent | 6 | وقبل الموعد، تقدر تاخذ فكرة عن مشاريعنا على حسابنا بإنستقرام: [حساب إنستقرام]. | Before then, have a look at our projects on Instagram: {instagram}. | §06 |
| 4:40 | lead | 6 | أكيد، بشوفه. مشكورة. | I will. Thank you. | new |
| 4:46 | agent | 6 | مشكور أبو فهد، وننتظرك إن شاء الله. | Thank you, Abu Fahad. We look forward to seeing you. | §06 |
| 4:51 | | | انتهت المكالمة | Call ends | |

## Variant 2: Saudi (pain variant: delays)

| Time | Speaker | Stage | Arabic | English subtitle | Script source |
|---|---|---|---|---|---|
| 0:00 | agent | 1 | السلام عليكم، معي أبو فهد؟ | Assalamu alaikum. Am I speaking with Abu Fahad? | §01 |
| 0:04 | lead | 1 | وعليكم السلام، إيه نعم، أبو فهد معك. | Yes, speaking. | new |
| 0:08 | agent | 1 | هلا والله. معك قسم المواعيد في [اسم الشركة]، كيف حالك اليوم؟ | Hello, this is the appointments team at {Company}. How are you today? | §01, with the coordinator line folded in |
| 0:13 | lead | 1 | الحمد لله، بخير. | Good, thank God. | new |
| 0:17 | agent | 1 | شفت استفسارك اللي عبّيته بخصوص [اسم الخدمة]. | I saw the enquiry you sent us about {service}. | §01 |
| 0:24 | agent | 1 | وحبيت أعطيك فكرة سريعة، يناسبك الوقت الحين؟ | I wanted to give you a quick idea. Is now a good time? | §01 |
| 0:30 | lead | 1 | إيه، تفضلي. | Yes, go ahead. | new |
| 0:34 | agent | 2 | ممتاز. عشان أقدر أخدمك بأفضل طريقة، ودّي أفهم وش في بالك. | So I can help you properly, I'd like to understand what you have in mind. | §02 |
| 0:41 | agent | 2 | وش أهم شي تبي توصل له في [المشروع]؟ | What matters most to you in {project}? | §02 |
| 0:49 | lead | 2 | إن الشغل هالمرة يطلع صح، وإنه يكون على ذوقنا. | That it's done right this time, and that it's to our taste. | new |
| 1:00 | agent | 2 | ووش الشي اللي يخليك تقول إن المشروع نجح؟ | And what would make you say the project was a success? | FW 02 |
| 1:09 | lead | 2 | إنه يخلص في وقته، وما تطلع لنا مفاجآت في التكلفة. | Finished on time, with no surprises on the cost. | new |
| 1:21 | agent | 3 | كلامك منطقي. ومن متى وأنت تخطط للمشروع؟ | That makes sense. How long have you been planning it? | §03 |
| 1:27 | lead | 3 | تقريباً ست شهور، وودّنا نبدي قريب. | About six months. We'd like to start soon. | new |
| 1:37 | agent | 3 | وقد تعاملت مع شركة تصميم أو تنفيذ قبل، ولا هذي أول مرة؟ | Have you worked with a design or build company before, or is this the first time? | §03 |
| 1:46 | lead | 3 | مرة وحدة، قبل سنتين، وتأخروا علينا أربعة شهور. | Once, two years ago. They finished four months late. | new |
| 1:57 | agent | 3 | ووين كانت المشكلة بالضبط؟ في التصميم، ولا التنفيذ، ولا بعد التسليم؟ | Where did it go wrong: the design, the work itself, or after handover? | §03 |
| 2:05 | lead | 3 | في التنفيذ. ما كنا ندري وش اللي يصير في الموقع. | During the work. We never knew what was happening on site. | new |
| 2:17 | agent | 3 | يعني هالمرة تبي تكون عارف وين وصل الشغل، خطوة بخطوة. | So this time you want to know where things stand, step by step. | §03, the communication question as a summary |
| 2:24 | lead | 3 | بالضبط. | Exactly. | new |
| 2:30 | agent | 3 | وبالنسبة للميزانية، عندك فكرة تقريبية عن المبلغ؟ | And on budget, do you have a rough figure in mind? | §03 |
| 2:37 | lead | 3 | بصراحة، ودّي أعرف كم بيكلف أول. | Honestly, I'd like to know what it costs first. | new |
| 2:44 | agent | 3 | سؤال في محله. السعر يعتمد على التفاصيل والمواد والمساحة. | Fair question. The price depends on the details, the materials and the space. | §07, "How much does it cost?" |
| 2:51 | agent | 3 | وعشان كذا تجلس مع [اسم المهندس]، وتاخذ عرض سعر دقيق بدل ما يكون تخمين على الجوال. | That's why you sit with {engineer}: you get an accurate quote, not a guess over the phone. | §07 |
| 2:59 | agent | 3 | بس تقريباً، الميزانية [الميزانية]؟ | Roughly, are you thinking {band}? | §07, "I don't have a budget yet" |
| 3:08 | lead | 3 | [جواب الميزانية] | {band.answer} | new |
| 3:16 | agent | 4 | وصلت الصورة كاملة. تبي [المشروع] يطلع صح وفي وقته، وتكون عارف وين وصل الشغل أول بأول. | I have the full picture. You want {project} done right, on time, and to know where things stand. | §04 opening |
| 3:25 | agent | 4 | وإحنا في [اسم الشركة]، [اللي يميزكم]. | At {Company}, {selling point}. | FW 04, one point from the client's own material |
| 3:35 | lead | 4 | هذا بالضبط اللي أبيه. | That's exactly what I need. | new |
| 3:41 | agent | 5 | ودّي أعرّفك على [اسم المهندس]، عشان تمرون على [المشروع] بالتفصيل. وش رأيك نحجز لك [نوع الاستشارة]؟ | I'd like you to meet {engineer}, to go through {project} in detail. Shall we book you {free}? | §05 |
| 3:54 | lead | 5 | إيه، خلنا نحجز. | Yes, let's do it. | new |
| 3:57 | agent | 5 | أبشر. عندنا مجال يوم [اليوم]، الصبح أو العصر، أي وقت يناسبك أكثر؟ | We have {day}, morning or afternoon. Which suits you? | §05 |
| 4:04 | lead | 5 | العصر أفضل. | Afternoon. | new |
| 4:07 | agent | 5 | تم: يوم [اليوم] الساعة [الوقت]، [المكان]. وبس للتأكيد، متأكد إنك تقدر تحضر؟ ما فيه شي ممكن يمنعك؟ | Done: {day} at {time}, {place}. Just to be sure, can you definitely make it? Nothing that might stop you? | §05, the booking and the double tie-down |
| 4:23 | lead | 5 | لا، إن شاء الله بكون موجود. | No, I'll be there. | new |
| 4:29 | agent | 6 | تمام، موعدك تأكد يوم [اليوم] الساعة [الوقت]، وبتوصلك رسالة على الواتساب فيها كل التفاصيل. | Your appointment is confirmed for {day} at {time}. You'll get a WhatsApp with all the details. | §06, and §05's confirmation message |
| 4:35 | agent | 6 | وقبل الموعد، تقدر تشوف شي من مشاريعنا على حسابنا في إنستقرام: [حساب إنستقرام]. | Before then, have a look at our projects on Instagram: {instagram}. | §06 |
| 4:40 | lead | 6 | أكيد، بشوفه. يعطيك العافية. | I will. Thank you. | new |
| 4:46 | agent | 6 | الله يعافيك يا أبو فهد، وحياك الله، ننتظرك. | Thank you, Abu Fahad. We look forward to seeing you. | §06 |
| 4:51 | | | انتهت المكالمة | Call ends | |

## The pain variants

Only these four lines change; the times, stages and everything else stay as above. Stop 8's note changes with them.

**Design** (what was built didn't match the drawings)

| Time | Kuwaiti | Saudi | English subtitle |
|---|---|---|---|
| 1:46 | مرة وحدة، قبل سنتين. واللي نفذوه ما كان نفس المخططات. | مرة وحدة، قبل سنتين، واللي نفذوه ما كان نفس المخططات. | Once, two years ago. What they built didn't look like the drawings. |
| 2:05 | بالتصميم. وافقنا على شي، وطلع لنا شي ثاني. | في التصميم. وافقنا على شي، وطلع لنا شي ثاني. | In the design. We approved one thing and got another. |
| 2:17 | يعني هالمرة تبي اللي توافق عليه بالمخطط، هو نفسه اللي يتنفذ. | يعني هالمرة تبي اللي توافق عليه في المخطط، هو نفسه اللي يتنفذ. | So this time you want what you approve on paper to be what gets built. |
| 3:16 | وصلت الصورة كاملة. تبي [المشروع] يطلع صح، ونفس اللي وافقت عليه. | وصلت الصورة كاملة. تبي [المشروع] يطلع صح، ونفس اللي وافقت عليه. | I have the full picture. You want {project} done right, and built the way you approved it. |

**Cost** (the final bill came in far above the quote)

| Time | Kuwaiti | Saudi | English subtitle |
|---|---|---|---|
| 1:46 | مرة وحدة، قبل سنتين. والفاتورة بالأخير طلعت أكثر بوايد من عرض السعر. | مرة وحدة، قبل سنتين، والفاتورة في الأخير طلعت أكثر بكثير من عرض السعر. | Once, two years ago. The final bill came in far above the quote. |
| 2:05 | بالتنفيذ. كل أسبوع تطلع لنا تكلفة زيادة. | في التنفيذ. كل أسبوع تطلع لنا تكلفة زيادة. | During the work. Every week there was a new extra cost. |
| 2:17 | يعني هالمرة تبي سعر واضح من البداية، وبدون مفاجآت. | يعني هالمرة تبي سعر واضح من البداية، وبدون مفاجآت. | So this time you want a clear price before you start, and no surprises. |
| 3:16 | وصلت الصورة كاملة. تبي [المشروع] يطلع صح، بسعر واضح وبدون مفاجآت. | وصلت الصورة كاملة. تبي [المشروع] يطلع صح، بسعر واضح وبدون مفاجآت. | I have the full picture. You want {project} done right, with a clear price and no surprises. |

---

## After the call

### Stop 7: the WhatsApp confirmation

One text for both dialects: it is a written message from the client's own WhatsApp number, so it stays in plain written Gulf Arabic. It follows the live Booking Router template's structure, as a live message shows it: an opening line, then the date, the time and the location on their own lines, then a closing line. The date and time keep the template's Latin digits (an exception like the call clock, DESIGN 7.6). Labelled صياغة للتوضيح ("Example wording") until the template's own text replaces it word for word (CONTENT open question 7).

| Line | Arabic | English |
|---|---|---|
| From | [اسم الشركة] | {Company} |
| Opening | تم تأكيد موعدك مع [اسم الشركة]. | Your appointment with {Company} is confirmed. |
| Date | التاريخ: [تاريخ الرسالة] | Date: {date} |
| Time | الوقت: [وقت الرسالة] | Time: {time} |
| Location | الموقع: [مكان الرسالة] | Location: {place} |
| Closing | نشوفك على خير. | See you then. |
| Label | صياغة للتوضيح | Example wording |

`[تاريخ الرسالة]` and `[وقت الرسالة]` print as the template prints them, in both decks: `{day}`'s date as "October 26, 2026" and `{time}` as "4:00 PM". `[مكان الرسالة]` is the written form of the place. For the office it is drawn as link-styled text, موقع مكتبنا على الخريطة / "Our office on the map", with no real address or link. For a home visit: في بيتك / "At your home". Online: أونلاين / "Online". A missing place drops the location line rather than showing a chip inside a customer's message.

### Stop 7: the reminder timeline

This is the one place the reminders are explained (CONTENT decision table).

| # | Arabic | English (CONTENT) |
|---|---|---|
| heading | اللي نسويه قبل الموعد | What we do before the meeting |
| 1 | عند الحجز: تأكيد على الواتساب | Booked: a WhatsApp confirmation |
| 2 | قبلها بيوم: تذكير | The day before: a reminder |
| 3 | مكالمة تأكيد | A confirmation call |
| 4 | قبلها بساعتين: رسالة نصية | 2 hours before: an SMS |
| 5 | الموعد | The meeting |

Said as what we do, never كل or دايماً: the reminder buttons and the confirmation calls do not run on every account yet. If a fuller label is wanted for step 3, the dialer's own rule is مساء اليوم اللي قبله أو صباح نفس اليوم: مكالمة تأكيد (the evening before for a morning meeting, that morning for an afternoon one).

### Stop 8: what lands with you

The appointment as it reaches the client, drawn in deck tokens (not a WhatsApp or Slack frame) and tagged مثال / "Example". Slide text, so white Gulf Arabic and Arabic-Indic digits. What the client's own alert carries is not yet confirmed (CONTENT open question 21), so the call's answers are shown as the caller's notes.

| Part | Arabic | English |
|---|---|---|
| Heading | موعد جديد | New appointment |
| Customer | أبو فهد | Abu Fahad |
| When | [اليوم]، ٤ مساءً | {day}, {time} |
| Where | في مكتبكم · في بيت العميل · أونلاين | At your office · At the customer's home · Online |
| Service | [اسم الخدمة] | {service} |
| Notes heading | ملاحظات فريق الاتصال | Our caller's notes |
| Note 1 | له ٦ شهور يخطط للمشروع، ويبي يبدي قريب. | Planning it for six months, wants to start soon. |
| Note 2 | الميزانية: [ملاحظة الميزانية]. | Budget: {band.note}. |
| Note 3, delays | الشركة اللي قبل تأخرت عليه ٤ شهور. | Their last company finished four months late. |
| Note 3, design | المرة اللي فاتت، التنفيذ ما طلع نفس المخططات. | Last time, what was built didn't match the drawings. |
| Note 3, cost | المرة اللي فاتت، الفاتورة طلعت أكثر بكثير من عرض السعر. | Last time, the final bill came in far above the quote. |
| Lead, over the cards (the fixer's round, 2026-10-20: the caption under the card repeated the notes' label) | كل اللي عرفه فريق الاتصال يوصلكم. | Everything our caller learned lands with you. |
| Tag | مثال | Example |

---

## Done with you (DWY)

The transcript and the stage rail stay exactly as above: the caller already speaks as the client's own appointments team, which is now literally true. Only the frame changes.

| | Arabic | English |
|---|---|---|
| Title | كيف يتصل فريقكم | How your team should call |
| Label | العميل في هالمكالمة مو حقيقي، والسكربت كامل بالدليل اللي نعطيكم إياه. | The customer in it is made up. The full script is in the playbook we give you. |
| Call card | اتصال باسم [الشركة] | Calling for {Company} |
| Notes heading | ملاحظات فريق الاتصال عندكم | Your caller's notes |
| Stop 7 line | احجزوا على التقويم الصح، والتأكيد يطلع للعميل تلقائياً. | Book on the right calendar, and the confirmation goes out by itself. |
| Timeline heading | قبل الموعد | Before the meeting ("What we do" would be false here) |
| Timeline 1 | عند الحجز · تأكيد | Booked · a confirmation |
| Timeline 2 (led by its when, the fixer's round) | قبل الموعد · تذكيرات | Before the meeting · reminders |
| Timeline 3 | الحجوزات المبدئية: فريقكم يتصل قبلها بيومين، وقبلها بيوم | Provisional bookings: your team calls 48 and 24 hours before |
| Timeline 4 | الموعد | The meeting |
| Stop 8 lead | الموعد ينزل في الـCRM عندكم. | It lands in your CRM. |

**The DWY framing line** (the CSM says it as the call starts):

> هذي الطريقة اللي نبي فريقكم يتصل فيها: نفس المراحل الست، ونفس السكربت، ومعلوماتكم داخله.
>
> This is how we'd like your team to call: the same six stages, the same script, with your details in it.

---

## A male caller

The lines are written for a woman. For a man, change only these words:

| Time | Kuwaiti | Saudi |
|---|---|---|
| 0:24 | حابة ← حاب | (no change) |
| 0:30 | تفضلي ← تفضل | تفضلي ← تفضل |
| 4:40 | مشكورة ← مشكور | (no change) |

---

## Left out of the script on purpose

- §01's own caller name (معاك [اسمك]). The caller is never named, so no client takes a name for their assigned caller.
- §04's «نضمن لك السعر، الوقت، وجودة التنفيذ», «نضمن لك أن التصميم … هو نفس الي بتستلمه», «ساعدنا مئات العائلات» and the years of experience. These are claims made on the client's behalf; they come in only through `[اللي يميزكم]`, from the client's own guide.
- §04's «أنا متأكد إن شغلنا بيعجبك» and §05's «العقل المدبر ورا كل مشاريعنا الناجحة», «أنا متأكد إنه بيقدر يرسم لك خريطة طريق» and any line that promises what the consultation will give the customer (the old 3:41 «عشان تطلع من الجلسة بخطة واضحة» is gone for the same reason). Promises about the client's quality, made by our caller.
- §05's deposit lines. Mahara does not take deposits, and the client's policy decides.
- §05's «اللي ما يحضرون أو يكنسلون، ما تطلع حلو عليّ». Kept as the plain double tie-down.
- §05's read-back of the customer's name and phone number. No phone number is ever drawn on the deck.
- §03's «المقاول أو المهندس». Never مقاول in Mahara's Arabic.

## Checks before shipping

1. The live Booking Router confirmation, word for word, so stop 7 copies it (CONTENT open question 7).
2. What the client's own booking alert and the Mahara OS appointment show, before stop 8 is drawn as anything more than "our caller's notes" (CONTENT open question 21).
3. The budget bands, with the CSM for each market, before their first use.
4. CEO approval of the final Arabic, as the example-call scout recommended.
