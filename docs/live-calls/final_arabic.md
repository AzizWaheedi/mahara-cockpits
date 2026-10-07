# Arabic for every message a lead sees: draft for the CEO's review

**Source and status.** I read the voice guide in full: `/private/tmp/claude-501/-Users-abdulazizwaheedi-mahara-cockpits/1742ac47-cfcd-4db7-b565-33e64c239220/scratchpad/mctx2/skills/aziz-kuwaiti-voice/SKILL.md`. Its rule is that the CEO approves any Arabic line, so every line below is a draft.

## Rules applied to every line

- **House style.** The lines follow the Arabic snippets and template already in the code: `supabase/migrations/20260926h_sales_whatsapp_followups.sql:109-181` and `apps/sales-cockpit/src/components/WhatsAppLibrary.tsx:58-59`. They open with هلا, call the company مهارة ميديا, and use the `{day} الساعة {time}` form.
- **Days and times.** Arabic days and times come from `callWords` (`apps/sales-cockpit/src/lib/whatsapp.ts:121`). It gives values like باجر, يوم الأحد and ٤ العصر.
- **Phonetic swaps are light, for Gulf-wide reading.**
  - Used: أنطر, ليلحين, الياية, يديد, جم, ييبون, ولا (meaning "or"), شنو.
  - Kept as standard: دقيقة, قبل, قاعد, الوقت.
  - Left out: سيده and وايد, because Saudi readers may not know them.
- **Punctuation.** No em dashes and no guillemets. ".." marks a pause.
- **Digits.** Arabic text uses Arabic-Indic digits. Codes, URLs and "iOS 17" stay in Latin characters.
- **Gender.**
  - The lead is addressed in the masculine (معاك, تبي), as in the existing snippets.
  - A rep speaking about themselves uses verbs only (بنطرك, بكون, دخلت), so the line fits a rep of either gender.
  - Lines about a rep in the third person are built as مكالمتك مع {rep} … جاهزة or بتكون مع {rep}, so no word has to agree with the rep's gender.
- **Rep names.** In Arabic, {rep}, {setter} and {closer} are the first word of the seat's `name_ar`. When it is empty, the fallback is فريق المبيعات (`supabase/functions/sales-api/index.ts:1128`). Most lines still read correctly with the fallback; the exceptions are noted in the tables.
- **Meta template rules, VERIFIED** at https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review:
  - A template "cannot start or end with a parameter".
  - Meta refuses a template with "too many variable parameters relative to the message length".
- **Meta length limits, VERIFIED** at https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components: a button label has at most 25 characters, and a body at most 1,024. Every template below opens and closes on fixed text, and every button label is 25 characters or fewer.
- **Line breaks.** `<br>` means a line break in free text, in an email, or in a template's own fixed text. It never goes inside a variable's value.
  - Source of that rule: a code comment says Meta refuses line breaks inside a template (`whatsapp.ts:170`). The Meta page I opened does not say so, so this is UNVERIFIED.

## Foundation (F)

| Name | Used where | English source | Arabic | Variables | Category |
|---|---|---|---|---|---|
| Room link, free text | Message service channel 1, inside the 24-hour window. Every room purpose | Hi {first_name}, your call with {rep_first_name} from Mahara is ready now. Join here: https://call.maharamedia.com/K7Q2MX | هلا {first_name}، مكالمتك مع {rep_first_name} من مهارة ميديا جاهزة الحين. ادخل من هني:<br>https://call.maharamedia.com/K7Q2MX | {first_name}: the lead's first name. {rep_first_name}: the host's `name_ar`, or فريق المبيعات (reads correctly). The link: the room's short link | Free text |
| `call_link_ar` (recommended single body; wording from P1; used by F, P1, P2 and P4) | Message service channel 2, outside the window | Hi {{1}}, your call with {{2}} from Mahara Media is ready now. Tap the button below to join. Button "Join the call" → https://call.maharamedia.com/{{1}} | Body: هلا {{1}}، مكالمتك مع {{2}} من مهارة ميديا جاهزة الحين. اضغط الزر اللي تحت عشان تدخل.<br>URL button label: ادخل المكالمة (13 characters)<br>URL: https://call.maharamedia.com/{{1}} | Body {{1}}: first name (Meta sample أحمد). Body {{2}}: `cockpit_rep_name` in Arabic (sample سارة). Button {{1}}: `cockpit_join_code` (sample K7Q2MX). The code has no special characters, so it needs no percent-encoding | Utility (Meta decides at review) |
| `call_link_ar`, F and P4 wording with no variables (use only if the build keeps F's body) | Same | Your call with Mahara Media is ready now. Tap the button to join. | مكالمتك مع مهارة ميديا جاهزة الحين. اضغط الزر اللي تحت عشان تدخل.<br>Button: ادخل المكالمة | Button {{1}}: `cockpit_join_code` | Utility |
| Room link, email subject | Message service channel 3 | Your Mahara call is ready | مكالمتك مع مهارة ميديا جاهزة | None | Email |
| Room link, email body | Same | Hi {first_name}, your call with {rep_first_name} is ready now. Join here: {link}. If it does not open, reply to this email and we will call you. | هلا {first_name}، مكالمتك مع {rep_first_name} جاهزة الحين. ادخل من هني:<br>{link}<br>إذا ما فتح معاك، رد على هالإيميل ونتصل عليك. | As in the free-text row. {link} stands on its own line | Email |
| Short page, opening line | `sites/call-link`, while the page opens the room | Opening your call with {rep_first_name}... | لحظة.. قاعدين نفتح لك مكالمتك مع {rep_first_name} | {rep_first_name}: the host's `name_ar` | Web page |
| Short page, Zoom hint | Same, Zoom rooms | No Zoom app? Tap Join from your browser. | ما عندك تطبيق زووم؟ اضغط Join from your browser وتدخل من المتصفح. | None. Zoom's own label is kept in English (its Arabic label is UNVERIFIED) | Web page |
| Short page, Meet hint | Same, Meet rooms | Meet needs iOS 17 or the Meet app. | قوقل ميت يحتاج iOS 17 وفوق، أو تطبيق قوقل ميت. | None | Web page |
| Ended page | Short link after the room is final | This call has ended. Reply to our last message and we will find a new time. | هالمكالمة خلصت. رد على آخر رسالة منا ونرتب لك وقت ثاني. | None | Web page |
| Read-out line (spoken by the rep) | Panel shows "Not sent: … Read it out" | Read it out: call.maharamedia.com/K7Q2MX | افتح المتصفح واكتب هالرابط: call.maharamedia.com/K7Q2MX | The code. The short link should also accept lower-case codes; that is not in the spec | Spoken |

## Project 1: video link when a call fails

| Name | Used where | English source | Arabic | Variables | Category |
|---|---|---|---|---|---|
| Missed booked intro, free text | After a call that did not connect, booked intro, inside the window | Hi {first name}, it's {setter} from Mahara Media. I just tried to call you for your intro call and couldn't get through. We can do it on video now instead: {link} I'll wait for you for the next 10 minutes. On a phone it opens in the {Meet / Zoom} app or your browser. | هلا {first_name}، معاك {setter} من مهارة ميديا. توني اتصلت عليك عشان مكالمتنا وما لحقت عليك.. نقدر نسويها فيديو الحين بدال التلفون:<br>{link}<br>بنطرك فيها ١٠ دقايق. على التلفون يفتح اللينك بتطبيق {app} أو من المتصفح. | {setter}: the setter's `name_ar`. {link}: the short link. {app}: قوقل ميت or زووم | Free text |
| Missed call, no booking, free text | Same flow, no booking (phase 3) | Hi {first name}, it's {setter} from Mahara Media. I tried to call you just now and couldn't get through. If you have 15 minutes, we can talk on video now: {link} I'll be there for the next 10 minutes. | هلا {first_name}، معاك {setter} من مهارة ميديا. توني حاولت أتصل عليك وما لحقت عليك. إذا عندك ١٥ دقيقة، نقدر نتكلم فيديو الحين:<br>{link}<br>بنطرك فيها ١٠ دقايق. | As above | Free text |
| Template | Outside the window | F's `call_link` | Use F's `call_link_ar` | See F | Utility |
| `call_link_ar` backup body (if a workflow cannot fill the URL button from a contact field; day-1 test) | Outside the window | Hi {{1}}, your call with {{2}} from Mahara Media is ready. Join here: {{3}} The room is open for 10 minutes. | هلا {{1}}، مكالمتك مع {{2}} من مهارة ميديا جاهزة. ادخل من هني: {{3}} بننطرك ١٠ دقايق. | {{1}}: first name. {{2}}: rep's Arabic first name. {{3}}: the full short link on one line (sample https://call.maharamedia.com/K7Q2MX). The body ends on fixed text | Utility |
| Email subject | Channel 3 | I tried to call you: join on video now | اتصلت عليك وما لحقت عليك.. نتكلم فيديو الحين؟ | None | Email |
| Email body | Same | The WhatsApp text, the link on its own line, "{setter}, Mahara Media" | The matching free-text row above (booked or not booked), with {link} on its own line, then:<br>{setter}، مهارة ميديا | {setter}: `name_ar` | Email |
| Ended page, with button | Short link after close | This call has ended. Reply to our last message, or message us on WhatsApp, and we will find a new time. [Message us on WhatsApp] | هالمكالمة خلصت. رد على آخر رسالة منا، أو راسلنا على الواتساب، ونرتب لك وقت ثاني.<br>Button: راسلنا على الواتساب | The button opens the official number (open decision) | Web page |
| Unknown code page | Short link with a bad code | This link is not valid. Reply to our message and we will send a new one. | هاللينك مو شغال. رد على رسالتنا ونرسل لك لينك يديد. | None | Web page |

## Project 2: live handover

| Name | Used where | English source | Arabic | Variables | Category |
|---|---|---|---|---|---|
| Handover link, Zoom, free text | `room_ready`, inside the window | Hi {first name}, {rep} from Mahara is ready for you now: {link} It opens in Zoom or your browser. They will let you in within a minute. | هلا {first_name}، مكالمتك مع {rep} من مهارة ميديا جاهزة الحين:<br>{link}<br>يفتح بزووم أو من المتصفح، وبندخلك خلال دقيقة. | {rep}: the taker's `name_ar` | Free text |
| Handover link, Meet, free text | Same, Meet | Hi {first name}, {rep} from Mahara is ready for you now: {link} Press 'Ask to join' and they will let you in. | هلا {first_name}، مكالمتك مع {rep} من مهارة ميديا جاهزة الحين:<br>{link}<br>اضغط Ask to join (طلب الانضمام) وبندخلك على طول. | As above. That طلب الانضمام is Meet's Arabic label is UNVERIFIED | Free text |
| After a reply, free text | "Offer a call now" from the Conversation | Thanks {first name}. Are you free for a quick video call now? {rep} is ready: {link} | شكراً {first_name}. يناسبك مكالمة فيديو سريعة الحين؟ ادخل من هني وبتلقى {rep} بالمكالمة:<br>{link} | As above | Free text |
| Email subject | Channel 3 | Your call with {rep} is ready | مكالمتك مع {rep} جاهزة | {rep} | Email |
| Email body | Same | WhatsApp text plus "If now is not good, reply and we will find a time." | The Zoom or Meet free text above, then:<br>إذا الحين ما يناسبك، رد علينا ونرتب وقت ثاني. | As above | Email |
| Setter says: searching | Spoken on the Maqsam call | I'm bringing in one of our closers now. It takes a minute or two. While we wait, how many projects are you running this quarter? | بدخّل معانا الحين واحد من فريقنا. ياخذ دقيقة دقيقتين.. وإحنا ننطر، جم مشروع عندكم شغال هالفترة؟ | None | Spoken |
| Setter says: ready | Same | I've just sent you a link. Tap it and you'll be with our closer straight away. | توني أرسلت لك لينك على {channel}. اضغط عليه وتدخل المكالمة على طول. | {channel}: الواتساب or الإيميل | Spoken |
| Setter says: nobody free | Same | Our closers are all on calls right now. What works better, today at {slot 1} or tomorrow at {slot 2}? | فريقنا كله على مكالمات الحين. شنو يناسبك أكثر.. اليوم الساعة {slot_1} ولا باجر الساعة {slot_2}؟ | Slots in `callWords` form (٤ العصر) | Spoken |
| Setter says: window closed | Same (the strip asks the setter to ask) | Ask them to send 'hi' to our WhatsApp and the link goes as soon as they do. | ارسل لنا كلمة هلا على واتساب مهارة ميديا، وأول ما توصلنا أرسل لك اللينك. | None | Spoken |
| Setter says: Meet read-out | Same, when nothing can be sent | Read this out: meet.google.com/abc-defg-hij | افتح قوقل ميت واكتب هالكود: abc-defg-hij | The Meet code | Spoken |
| Template (phase 5) | Outside the window | F's `call_link` | Use F's `call_link_ar` | See F | Utility |

## Project 3: follow-up agent

| Name | Used where | English source | Arabic | Variables | Category |
|---|---|---|---|---|---|
| `opener_ar`, the CEO's own words (verbatim, guillemets removed) | Reactivation waves, window closed, no model text | Hi {{1}}, it's {{2}} from Mahara Media. How are you? | السلام عليكم {{1}}، معاك {{2}}. كيف حالك؟ | {{1}}: first name (sample أحمد). {{2}}: rep's Arabic first name (sample سارة) | Marketing |
| `opener_ar`, suggested variant (CEO's choice) | Same | Same | السلام عليكم {{1}}، معاك {{2}} من مهارة ميديا. كيف حالك؟ | Same | Marketing |
| `line_ar` (already in the code, unchanged, as `cockpit_line_ar`) | Any follow-up step when the window is closed | Hi {{1}}, it's {{2}} from Mahara Media.<br>{{3}}<br>Just reply here if you'd like to continue. | هلا {{1}}، معاك {{2}} من مهارة ميديا.<br>{{3}}<br>إذا حاب نكمل، رد علي هني. | {{3}}: one line written by the model. It has no line breaks (`snippetLine`, `whatsapp.ts:172`), no em dash, no guillemets, and Arabic-Indic digits | Marketing (as in the code) |
| Call offer, free text | Approved `call_now` draft, sent once the rep is in the room | Yes, {rep first name} can talk now. Join here: https://call.maharamedia.com/{code} They will let you in within a minute. | إي أكيد، مكالمتك مع {rep} جاهزة الحين. ادخل من هني:<br>https://call.maharamedia.com/{code}<br>بندخلك خلال دقيقة. | {rep}: `name_ar`. {code}: the room code | Free text |
| Nurture email subject (example of model output) | Contextual email nurture | {first name}, a quick question | {first_name}، سؤال سريع | {first_name} | Email |
| Nurture email body (example of model output) | Same | Hi {first name}, when we last spoke you were looking for more design projects in Riyadh. Is that still the plan for next quarter? If it helps, I can show you how other studios in Saudi Arabia fill their pipeline. Reply here and I'll set a time. {rep}, Mahara Media | هلا {first_name}، آخر مرة تكلمنا كنت تدور على مشاريع تصميم أكثر بالرياض. ليلحين هذي خطتكم للفترة الياية؟ إذا يفيدك، أقدر أوريك شلون مكاتب تصميم ثانية بالسعودية ييبون مشاريعهم بشكل مستمر. رد علي هني وأرتب لك وقت.<br>{rep}، مهارة ميديا | City, field and country come from the lead's own answers | Email |
| Stop line (last line of every nurture email) | Same | If you'd rather not hear from us, reply 'stop' and we won't email again. | إذا ما تبي توصلك رسايلنا، رد بكلمتين: وقف الرسايل، وما بنرسل لك إيميل بعدها. | None. The phrase وقف الرسايل matches `OPT_OUT` (`hermes/sales-desk/desk/followups.py:115`); a bare وقف would not | Email |
| Form consent line | Lead forms | By sending this form you agree that Mahara Media may contact you about your enquiry by WhatsApp, phone and email. | بإرسالك هالفورم، توافق إن مهارة ميديا تتواصل معاك بخصوص طلبك على الواتساب والتلفون والإيميل. | None. Kept plainer on purpose, because it is consent text | Form |
| Form checkbox | Same | Send me updates and offers by WhatsApp and email. | أبي توصلني تحديثات وعروض من مهارة ميديا على الواتساب والإيميل. | None | Form |

## Project 4: demo chat (route C now, route A later)

Every free-text message and email in this table ends with the signature row's line.

| Name | Used where | English source | Arabic | Variables | Category |
|---|---|---|---|---|---|
| Signature line | Added by `thread.send` to each message | {Closer}, Mahara Media | {closer}، مهارة ميديا | {closer}: host's `name_ar`, or فريق المبيعات | Appended |
| Intro, free text | Intro step, window open | Hi {first name}, this is {closer} from Mahara Media. {setter} passed me your details, and I'll host your demo on {day} at {time} ({country} time). It's a 45-minute Zoom call, and I'll send the link here 15 minutes before. If the time stops working, reply here and I'll move it. | هلا {first_name}، معاك {closer} من مهارة ميديا. {setter} عطاني تفاصيلك، وأنا اللي بكون معاك بمكالمتك {day} الساعة {time} بتوقيت {country}. المكالمة على زووم ومدتها ٤٥ دقيقة، وبرسل لك اللينك هني قبلها بربع ساعة. إذا الوقت ما عاد يناسبك، رد علي وأغيره لك. | {day} and {time} from `callWords`. {country}: السعودية, الإمارات, الكويت, قطر, البحرين or عُمان (with the damma, so it is not read as Amman). If the demo moves to Meet (decision 1), زووم becomes قوقل ميت | Free text |
| `demo_host_ar` | Intro step, window closed | Hi {{1}}, this is {{2}} from Mahara Media. I'll host your demo on {{3}}. I'll send the Zoom link here 15 minutes before. Can you still make it? Quick replies: "Yes, I'll be there", "I need another time" | Body: هلا {{1}}، معاك {{2}} من مهارة ميديا. بكون معاك بمكالمتك {{3}}، وبرسل لك لينك زووم هني قبلها بربع ساعة. ليلحين الوقت يناسبك؟<br>Quick replies: أكيد، بحضر (10 characters), أبي وقت ثاني (12 characters) | {{1}}: first name. {{2}}: `cockpit_rep_name`, the closer in Arabic. {{3}}: `cockpit_demo_time` on one line, an absolute date with no relative words. Sample: يوم الأحد ٥ أكتوبر الساعة ٤ العصر (بتوقيت السعودية) | Utility |
| Check, free text | 18:00 lead time, the evening before | Hi {first name}, a quick check for tomorrow: our demo is at {time} ({country} time). Does that still work? | هلا {first_name}، تأكيد سريع عن باجر: مكالمتنا الساعة {time} بتوقيت {country}. ليلحين الوقت يناسبك؟ | {time}, {country} | Free text |
| Link, free text | 15 minutes before | Hi {first name}, I'm getting ready for our call at {time}. Here is the link: {link} See you in 15 minutes. | هلا {first_name}، قاعد أجهز لمكالمتنا الساعة {time}. هذا اللينك:<br>{link}<br>أشوفك بعد ربع ساعة. | {link}: the wrapped room's short link, or the raw `address` before F ships | Free text |
| Link template | 2 minutes before, window closed | F's `call_link_en` | Use F's `call_link_ar` | See F | Utility |
| Late, free text | 5 minutes after the start | Hi {first name}, I'm in the call now and holding it for you: {link} If now is not a good time, reply with a time that suits you. | هلا {first_name}، دخلت المكالمة وأنطرك فيها:<br>{link}<br>إذا الحين ما يناسبك، رد علي بوقت يناسبك. | {link} | Free text |
| Moved, free text | Reschedule, window open | Hi {first name}, done: your demo is now on {day} at {time} ({country} time). I'll send the link here 15 minutes before. | هلا {first_name}، خلاص غيرنا الموعد: مكالمتك صارت {day} الساعة {time} بتوقيت {country}. برسل لك اللينك هني قبلها بربع ساعة. | {day}, {time}, {country} | Free text |
| Host change, free text | Host changes, window open | Hi {first name}, a small change: {new closer} will host your demo on {day} at {time}. Same time, same link. | هلا {first_name}، تغيير بسيط: مكالمتك {day} الساعة {time} بتكون مع {new_closer}. نفس الوقت ونفس اللينك. | {new_closer}: the new host's `name_ar` | Free text |
| Email intro subject | Intro by email (no phone, or WhatsApp do-not-disturb) | Your demo on {day}: meet {closer} | مكالمتك {day} مع {closer} من مهارة ميديا | {day}, {closer} | Email |
| Email intro body | Same | The intro text | The intro free text above, then the signature line | As in the intro row | Email |
| Route A group name | Group creation, after the OBA | {Company} and Mahara Media | {company} ومهارة ميديا | {company}: company name on file | Group subject |
| Route A closing line | Before `DELETE /<GROUP_ID>` | This group closes today. For anything else, message us here on Mahara Media's WhatsApp. Thank you. | هالقروب بيتسكر اليوم. لأي شي ثاني، راسلنا على واتساب مهارة ميديا. شكراً لك. | None | Free text (group) |
| Route A invite | Group invite | Meta library template "Group invite upon request" | Meta fixes this wording. Whether the library has an Arabic version is UNVERIFIED | Invite link | Utility (Meta library) |

## Checks and open points for the build

1. **The `call_link` body differs between specs.** F, P1 and P4 each quote a different text, but Meta approves one body per template name and language. I recommend P1's wording with {{1}} and {{2}} for all four projects. The no-variable version is in the F table if the CEO prefers it.
2. **`opener_ar` may be refused for too many variables.** It has 2 variables in about 5 words, and Meta refuses templates with "too many variable parameters relative to the message length" (VERIFIED rule). Whether this template is refused is UNVERIFIED. The variant with من مهارة ميديا lowers the risk and matches the English opener. The CEO chooses.
3. **Two messages break when a rep has no Arabic name.** With the فريق المبيعات fallback, `demo_host_ar` and the P4 intro say "I" next to "the sales team".
   - Fill `name_ar` on the setter's and the closer's seats before any Arabic send.
   - Alternatively, skip the `demo_host_ar` template when the host has no Arabic name.
4. **The quick-reply logic must know the Arabic buttons.** `result=confirmed` and "need another time" must also recognise أكيد، بحضر and أبي وقت ثاني, not only the English labels.
5. **`cockpit_demo_time` ({{3}} in `demo_host_ar`) needs an absolute Arabic date.** Use the form يوم الأحد ٥ أكتوبر الساعة ٤ العصر (بتوقيت السعودية), with Gulf month names (أكتوبر). `callWords` gives only relative days and no date.
6. **The nurture word count may be too high for Arabic.** Arabic needs fewer words than English for the same message, so P3's floor of 60 words may push the model to pad Arabic emails. A range of about 45 to 100 words for Arabic is my suggestion, not tested.
7. **Things I could not verify:**
   - The Arabic labels in Zoom's and Meet's own screens (Join from your browser, and طلب الانضمام for Ask to join).
   - Meta refusing line breaks inside variable values (stated only in the code comment at `whatsapp.ts:170`).
   - Meta approving `call_link_ar` and `demo_host_ar` as Utility.
   - An Arabic version of Meta's group invite template.
8. **Female leads.** The lead is addressed in the masculine throughout. A feminine set (معاج, تبين) would need a gender field, which does not exist today.