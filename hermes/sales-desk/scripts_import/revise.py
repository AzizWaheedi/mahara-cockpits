"""Revisions made to the call scripts in the cockpit, applied on top of the
Google Docs' text on every import, so a re-import never undoes them.

Each revision edits blocks it finds by their words. When a doc has changed
under an edit, the import stops and names the words it could not find,
rather than loading a script that is half revised.

2026-09-27, numbers (Aziz): the demo walks the prospect's funnel top to
bottom (ad spend, inquiries, meetings booked and held, projects signed, who
sells, the average project); Quantify The Gap tells them, in their own
numbers, the one step that leaks the most next to the numbers we hold
clients to and what fixing only that step is worth (Temple Naylor's "one
thing" frame, https://youtu.be/KKr8Ehqf-cs); the pain questions ask "how
does that put you in a tough position", open, instead of "does that"; the
guarantee leaves the close and stays an objection handle; the intro asks two
light numbers (ad spend and the inquiries it brings) for the closer.
Arabic lines are written in Aziz's Kuwaiti voice (mahara-context
skills/aziz-kuwaiti-voice). The cockpit fills every [NUMBER] placeholder
from the call's notes (apps/sales-cockpit/src/lib/funnel.ts).
"""
from __future__ import annotations

import copy

NUMBERS = "2026-09-27-numbers"


class Drift(Exception):
    """The doc no longer has the words a revision edits."""


def _b(kind: str, text: str, branch: str | None = None, when: str | None = None) -> dict:
    b: dict = {"type": kind, "text": text}
    if branch:
        b["branch"] = branch
    if when:
        b["when"] = when
    return b


def say(t, branch=None, when=None):
    return _b("say", t, branch, when)


def adapt(t, branch=None, when=None):
    return _b("adapt", t, branch, when)


def note(t, branch=None, when=None):
    return _b("note", t, branch, when)


def step(t):
    return _b("step", t)


def _stage(doc: dict, no: int) -> dict:
    for s in doc["stages"]:
        if s.get("no") == no:
            return s
    raise Drift(f"stage {no} is not in the {doc.get('key')}.{doc.get('lang')} script")


def _find(blocks: list, starts: str, where: str, after: int = -1) -> int:
    for i, b in enumerate(blocks):
        if i > after and (b.get("text") or "").strip().startswith(starts):
            return i
    raise Drift(f"{where}: no line starting {starts!r}")


def _replace(stage: dict, first: str, last: str | None, new: list, where: str) -> None:
    """Swap the blocks from the line starting `first` through the one starting `last`."""
    blocks = stage["blocks"]
    i = _find(blocks, first, where)
    j = _find(blocks, last, where, after=i - 1) if last else i
    stage["blocks"] = blocks[:i] + new + blocks[j + 1:]


def _edit(stage: dict, starts: str, old: str, new: str, where: str) -> None:
    """Change words inside one line."""
    blocks = stage["blocks"]
    i = _find(blocks, starts, where)
    text = blocks[i]["text"]
    if old not in text:
        raise Drift(f"{where}: {old!r} is not in the line starting {starts!r}")
    blocks[i]["text"] = text.replace(old, new)


def _entry(doc: dict, part: str, title_starts: str) -> dict:
    for e in doc.get(part, []):
        if e.get("title", "").startswith(title_starts):
            return e
    raise Drift(f"{doc.get('key')}.{doc.get('lang')} {part}: no entry titled {title_starts!r}")


def _add_checks(stage: dict, items: list[str]) -> None:
    have = stage.setdefault("checklist", [])
    for it in items:
        if it not in have:
            have.append(it)


# --------------------------------------------------------------- the demo

STAGE1_NOTE = (
    "Before you start, read what the setter found. Every answer from the intro call is "
    "already in your notes on the right, marked \"from the intro\", and the lines fill in "
    "with it. Don't re-ask what the setter covered: confirm it in one line and go deeper."
)

FUNNEL_NOTE = (
    "Walk the funnel from the top, one number at a time, and type each one into the notes "
    "on the right as they say it. A rough number beats no number: \"roughly, in a normal "
    "month?\" If the setter already has a number, confirm it instead of asking. If they "
    "don't run ads, skip the first two questions."
)
FUNNEL_AFTER = (
    "The notes panel works out their rates and costs as you type and puts every step "
    "next to ours. You'll use it in the next two stages."
)

STAGE4_CHECKS = [
    "You have their funnel a month: inquiries, meetings booked, meetings held, projects signed",
    "You have their average project, and their ad spend if they run ads",
]

STAGE6_GOAL = (
    "Show them the gap in their own numbers: the one step in their funnel that leaks the "
    "most, next to the number we hold our clients to, and what fixing only that step is "
    "worth a year. You tell them the gap; they react to it."
)
STAGE6_NOTE = (
    "The notes panel has done the math: their rate at every step next to ours, the step "
    "that leaks the most, and what fixing only that step is worth. The lines below fill in "
    "by themselves and the branch that matches their numbers opens on its own. A dashed "
    "blank in a line is a number you still need: ask for it before you say the line."
)
STAGE6_STRENGTHS_NOTE = "Say the next line only if the notes show a step at or above ours."
STAGE6_AFTER = (
    "Whichever branch you used, the gap is saved with the call's notes. It comes back in "
    "the pain questions, the Cost of Inaction and at the close."
)
STAGE6_CHECKS = [
    "You told them the one step that leaks the most, in their own numbers",
    "They reacted to the gap in their own words",
]

STAGE7_NOTES = [
    "Use 2-3 of these. Pick the ones that match what they told you. The structure is always "
    "the same: \"Given that [their number], how does that put you in a tough position with "
    "[outcome they care about]?\"",
    "It's open on purpose: they can't answer yes or no, so they say the pain in their own "
    "words. If the answer is thin, follow with \"How so, specifically?\"",
]

GUARANTEE_NOTE = (
    "The guarantee is not part of the close. Keep it for when they ask for certainty "
    "(\"How do I know this will work?\", \"Can you guarantee results?\"); it's in the "
    "objections."
)

ADS = "If the leak is the cost of each inquiry"
BOOKING = "If the leak is booking (inquiries that never become a meeting)"
SHOW = "If the leak is show-up (booked meetings that don't happen)"
CLOSE = "If the leak is closing (meetings that don't sign)"
VOLUME = "If every step is already at our numbers"
REFERRALS = "If they can't give funnel numbers (referrals only, nothing tracked)"


def _demo_en(doc: dict) -> None:
    w = "demo.en"
    s1 = _stage(doc, 1)
    _replace(s1, "Before you start", None, [note(STAGE1_NOTE)], w)

    s4 = _stage(doc, 4)
    _replace(s4, "Pipeline & Closing", "Write these numbers down", [
        step("Their funnel, top to bottom"),
        note(FUNNEL_NOTE),
        adapt("Now I want to walk your funnel from the top, so we can see exactly where your "
              "projects come from and where they slip away. Are you running ads right now? "
              "Roughly how much a month?"),
        adapt("And how many inquiries do the ads bring in a month?"),
        adapt("And all in, referrals included, how many inquiries come in a month? People "
              "actually reaching out about a project."),
        adapt("Out of those, how many turn into a booked meeting or a site visit?"),
        adapt("And of the meetings you book, how many actually happen?"),
        adapt("And out of the people you meet, how many sign?"),
        adapt("Who's doing the selling in those meetings: is that you, or someone on your team?"),
        adapt("And the ones that don't sign, what usually happens? Do they go with a "
              "competitor, disappear, say the budget's too high?"),
        note(FUNNEL_AFTER),
    ], w)
    _add_checks(s4, STAGE4_CHECKS)

    s5 = _stage(doc, 5)
    _edit(s5, "So over the last [YEARS IN BUSINESS] years",
          "[YEARS IN BUSINESS] years", "[YEARS IN BUSINESS]", w)

    s6 = _stage(doc, 6)
    s6["goal"] = STAGE6_GOAL
    s6["blocks"] = [
        note(STAGE6_NOTE),
        say("Can I share what I'm seeing in your numbers?"),
        adapt("Just so you know where this comes from: we've worked with over 70 construction "
              "and design companies across the Gulf. What that gives us is data. We know what "
              "every step of the funnel should look like for a company like yours, and we hold "
              "every client's funnel to those numbers."),
        note(STAGE6_STRENGTHS_NOTE),
        adapt("And honestly, a lot of your numbers are in good shape: [STRONG STEPS]."),
        say("Where I see the leak is what each inquiry costs you. You're putting [AD SPEND] a "
            "month into ads for [AD LEADS] inquiries, so each one costs you about [CPL]. The "
            "number we hold our clients to is [OUR CPL].", ADS, "leak:ads"),
        say("So the same budget, spent the way we spend it, would bring you about [LEADS AT "
            "OUR CPL] a month instead of [AD LEADS]. At your own rates after that, that's "
            "about [EXTRA PROJECTS A YEAR] a year. At your average of [PROJECT VALUE], that's "
            "[GAP YEAR] a year you're leaving on the table, without spending a dollar more.",
            ADS, "leak:ads"),
        say("What are your thoughts on that?", ADS, "leak:ads"),
        say("Where I see the leak is between the inquiry and the meeting. Out of [LEADS] "
            "inquiries a month, [BOOKED] turn into a meeting. That's [BOOKING RATE]. The number "
            "we hold our clients to is [OUR BOOKING RATE].", BOOKING, "leak:booking"),
        say("So without spending a dollar more on ads, from the inquiries you already get, if "
            "we only fixed that one step you'd have [EXTRA MEETINGS] a month. At your own "
            "show-up and closing rates, that's about [EXTRA PROJECTS A YEAR] a year. At your "
            "average of [PROJECT VALUE], that's [GAP YEAR] a year you're leaving on the table "
            "right now.", BOOKING, "leak:booking"),
        say("What are your thoughts on that?", BOOKING, "leak:booking"),
        say("Where I see the leak is show-up. You book [BOOKED] meetings a month and [SHOWED] "
            "of them actually happen. That's [SHOW RATE]. The number we hold our clients to is "
            "[OUR SHOW RATE].", SHOW, "leak:show"),
        say("So without one more inquiry, if we only fixed that one step you'd have [EXTRA "
            "MEETINGS] a month that actually happen. At your own closing rate, that's about [EXTRA "
            "PROJECTS A YEAR] a year. At your average of [PROJECT VALUE], that's [GAP YEAR] a "
            "year you're leaving on the table right now.", SHOW, "leak:show"),
        say("What are your thoughts on that?", SHOW, "leak:show"),
        say("Where I see the leak is closing. You meet [SHOWED] people a month and sign "
            "[CLOSED]. That's [CLOSE RATE]. The number we hold our clients to is [OUR CLOSE "
            "RATE].", CLOSE, "leak:close"),
        say("So without one more inquiry or one more meeting, if we only fixed that one step "
            "you'd sign about [EXTRA PROJECTS A YEAR] a year. At your average of [PROJECT "
            "VALUE], that's [GAP YEAR] a year you're leaving on the table right now.",
            CLOSE, "leak:close"),
        say("What are your thoughts on that?", CLOSE, "leak:close"),
        say("Honestly, your funnel is in good shape: every step is at or above the numbers we "
            "hold our clients to. So the only thing between you and [desired state] is volume: "
            "more of the right people coming in at the top.", VOLUME, "leak:volume"),
        say("If we only doubled the inquiries you get, at your own rates, that's about [EXTRA "
            "PROJECTS A YEAR] a year, [GAP YEAR] at your average of [PROJECT VALUE].",
            VOLUME, "leak:volume"),
        say("What are your thoughts on that?", VOLUME, "leak:volume"),
        adapt("No stress, let's keep it simple then. In a good month, how many projects do you "
              "sign? And in a slow month?", REFERRALS, "leak:referrals"),
        adapt("And over the last 12 months, how many of those were slow months?",
              REFERRALS, "leak:referrals"),
        say("So every slow month is about [PROJECTS LOST A SLOW MONTH] you didn't sign, because "
            "nothing was bringing work in when the referrals went quiet. Over [SLOW MONTHS], "
            "that's about [LOST PROJECTS A YEAR] a year. At your average of [PROJECT VALUE], "
            "that's [GAP YEAR] a year you're leaving to chance.", REFERRALS, "leak:referrals"),
        say("What are your thoughts on that?", REFERRALS, "leak:referrals"),
        note(STAGE6_AFTER),
    ]
    s6["checklist"] = list(STAGE6_CHECKS)

    s7 = _stage(doc, 7)
    _replace(s7, "Use 2-3 of these", "Given that you've been in business", [
        note(STAGE7_NOTES[0]),
        note(STAGE7_NOTES[1]),
        say("Given that you sign [CLOSE RATE] of the people you meet, and you said the ones who "
            "don't sign usually go to whoever gets there first, how does that put you in a tough "
            "position with planning your revenue?"),
        say("Given that your pipeline depends on referrals, and you said you had [SLOW MONTHS] "
            "last year, how does that put you in a tough position with hiring, investing in "
            "equipment, or taking on bigger projects?"),
        say("Given that you're spending [HOURS A WEEK] a week chasing leads, following up and "
            "doing site visits for people who were never going to sign, how does that put you "
            "in a tough position with actually running and growing the business?"),
        say("Given that about [LOST PROJECTS A YEAR] a year slip away at [WEAK STEP], most of "
            "them to competitors, how does that put you in a tough position with where your "
            "company will be in 2-3 years compared to them?"),
        say("Given that you've been in the market [YEARS IN BUSINESS] and you're still depending "
            "on word of mouth, with no system to control your pipeline, how does that put you "
            "in a tough position with growing past where you are now?"),
    ], w)

    s8 = _stage(doc, 8)
    _replace(s8, "Can I share some thoughts on what I'm seeing here?",
             "What are your thoughts on that?", [
        say("Let me bring this back to your numbers for a second, because I think it's "
            "important."),
        adapt("You told me you did [REVENUE] over the last 12 months. And we worked out that, "
              "from [WEAK STEP] alone, you lose about [LOST PROJECTS A YEAR] a year."),
        adapt("Every month that goes by without fixing it, that's another [GAP MONTH] going to "
              "whoever picks up the phone first. That's not my opinion; that's what your own "
              "numbers say."),
        adapt("Over the next 12 months, if nothing changes, that's [GAP YEAR] in projects that "
              "could have been yours."),
        adapt("And that's one step. We work on the whole funnel, but if only that one thing got "
              "fixed, [PAYBACK]. The real risk isn't spending money to grow. It's leaving [GAP "
              "YEAR] on the table because you didn't."),
        adapt("What are your thoughts on that?"),
    ], w)
    s8["blocks"] += [
        adapt("The \"Given That\" stack (use 2-3 of these, fitted to their situation, in any "
              "angle):"),
        say("Given that you sign [CLOSE RATE] of the people you meet, and the ones who don't "
            "sign go to competitors, how does that put you in a tough position with [GOAL]?"),
        say("Given that your pipeline depends on referrals, and you said you had [SLOW MONTHS] "
            "last year, how does that put you in a tough position with planning?"),
        say("Given that about [LOST PROJECTS A YEAR] slipped away last year at [WEAK STEP], where "
            "will your business be 12 months from now if we don't fix it?"),
        say("Given that you're spending [HOURS A WEEK] a week chasing leads and following up "
            "instead of delivering projects, how does that put you in a tough position with "
            "growing the business?"),
    ]

    s11 = _stage(doc, 11)
    _replace(s11, "You told me you're closing about", "Does that make sense — how that one", [
        adapt("You told me you sign about [CLOSE RATE] of the people you meet. Even if we only "
              "moved that to [CLOSE RATE PLUS 10], at your average of [PROJECT VALUE], that's "
              "[PLUS 10 A YEAR] more a year, without spending a dollar more on marketing."),
        adapt("How would that one change show up in your numbers?"),
    ], w)

    s13 = _stage(doc, 13)
    _replace(s13, "You said you're leaving roughly", "Our guarantee is 30 qualified", [
        adapt("You're leaving about [GAP YEAR] a year on the table at [WEAK STEP] alone. And we "
              "said that even fixing only that one step means about [EXTRA PROJECTS A YEAR] a "
              "year at your average of [PROJECT VALUE]."),
        adapt("And of our clients who complete the program, the average ROI is [X]:1."),
        note(GUARANTEE_NOTE),
    ], w)
    _edit(s13, "Here's what happens next.", "the program details, the guarantee, and the payment link",
          "the program details, your numbers, and the payment link", w)

    small = _entry(doc, "objections", '"I want to start small')
    _edit(small, '"Here\'s what I\'d suggest instead',
          "And remember, if we don't deliver 30 appointments in 90 days, we keep working for free.",
          "And on top of that, we guarantee 30 qualified appointments in 90 days, or we keep "
          "working for free until we get there.", w)
    dep = _entry(doc, "objections", '"$500 deposit?')
    _edit(dep, '"Let me ask you this', "the results, the guarantee, the system",
          "the results, the system", w)
    contract = _entry(doc, "objections", '"Send me the contract" / "Send me the recording"')
    _edit(contract, '"Tell you what', "the program, the guarantee, and your projection",
          "the program, your numbers, and your projection", w)


def _demo_ar(doc: dict) -> None:
    w = "demo.ar"
    s1 = _stage(doc, 1)
    _replace(s1, "Before you start", None, [note(STAGE1_NOTE)], w)

    s4 = _stage(doc, 4)
    _replace(s4, "Pipeline & Closing", "سجّل هالأرقام", [
        step("Their funnel, top to bottom"),
        note(FUNNEL_NOTE),
        adapt("الحين أبي أمشي معاك على الفانل مالك من فوق.. عشان نشوف بالضبط من وين تييك "
              "المشاريع ووين تطيح. تشغّل إعلانات الحين؟ تقريباً جم بالشهر؟"),
        adapt("وجم استفسار ييك من الإعلانات بالشهر؟"),
        adapt("وكله على بعض، مع التوصيات.. جم استفسار ييك بالشهر؟ ناس فعلاً يتواصلون عشان مشروع."),
        adapt("ومنهم، جم واحد يصير له موعد أو زيارة موقع؟"),
        adapt("والمواعيد اللي تنحجز.. جم منها تصير فعلاً؟"),
        adapt("واللي تقابلهم.. جم واحد منهم يوقّع؟"),
        adapt("ومنو اللي يبيع بهالاجتماعات؟ انت ولا أحد من فريقك؟"),
        adapt("واللي ما يوقعون.. شنو يصير فيهم عادةً؟ يروحون لمنافس، يختفون، ولا يقولون "
              "الميزانية عالية؟"),
        note(FUNNEL_AFTER),
    ], w)
    _add_checks(s4, STAGE4_CHECKS)

    s5 = _stage(doc, 5)
    _replace(s5, "يعني خلال آخر [عدد السنوات]", None, [
        adapt("يعني آخر [YEARS IN BUSINESS] ما سويت أي تسويق أبداً؟"),
    ], w)

    s6 = _stage(doc, 6)
    s6["goal"] = STAGE6_GOAL
    s6["blocks"] = [
        note(STAGE6_NOTE),
        say("أقدر أقولك شنو أشوف بأرقامك؟"),
        adapt("بس عشان تعرف من وين ياي هالكلام.. اشتغلنا مع أكثر من ٧٠ شركة بالمقاولات والتصميم "
              "بالخليج. واللي عطانا اياه هذا كله هو الداتا. نعرف كل خطوة بالفانل شلون لازم تكون "
              "لشركة مثل شركتك، ونحاسب نفسنا مع كل عميل على هالأرقام."),
        note(STAGE6_STRENGTHS_NOTE),
        adapt("والصج.. وايد من أرقامك زينة: [STRONG STEPS]."),
        say("اللي أشوفه إن التسريب بتكلفة الاستفسار. انت تحط [AD SPEND] بالشهر على الإعلانات "
            "وييك منها [AD LEADS] استفسار.. يعني كل استفسار يكلفك تقريباً [CPL]. والرقم اللي "
            "نحاسب نفسنا عليه مع عملائنا [OUR CPL].", ADS, "leak:ads"),
        say("يعني نفس الميزانية، لو تنصرف بطريقتنا، بتييك تقريباً [LEADS AT OUR CPL] بالشهر بدال "
            "[AD LEADS]. وبنفس نسبك انت بعدها، هذا تقريباً [EXTRA PROJECTS A YEAR] بالسنة. "
            "وبمتوسطك [PROJECT VALUE] للمشروع.. هذي [GAP YEAR] بالسنة تاركها على الطاولة، بدون "
            "ما تصرف ولا فلس زيادة.", ADS, "leak:ads"),
        say("شنو رايك بهالكلام؟", ADS, "leak:ads"),
        say("اللي أشوفه إن التسريب بين الاستفسار والموعد. من [LEADS] استفسار بالشهر، [BOOKED] بس "
            "يصير لهم موعد.. يعني [BOOKING RATE]. والرقم اللي نحاسب نفسنا عليه مع عملائنا "
            "[OUR BOOKING RATE].", BOOKING, "leak:booking"),
        say("يعني بدون ما تصرف ولا فلس زيادة على الإعلانات.. من نفس الاستفسارات اللي تييك الحين، "
            "لو بس صلحنا هالخطوة وحدها، بيصير عندك [EXTRA MEETINGS] بالشهر. وبنفس نسبك انت بالحضور "
            "والإقفال، هذا تقريباً [EXTRA PROJECTS A YEAR] بالسنة. وبمتوسطك [PROJECT VALUE] "
            "للمشروع.. هذي [GAP YEAR] بالسنة تاركها على الطاولة الحين.", BOOKING, "leak:booking"),
        say("شنو رايك بهالكلام؟", BOOKING, "leak:booking"),
        say("اللي أشوفه إن التسريب بالحضور. تحجز [BOOKED] موعد بالشهر، واللي يصير منها فعلاً "
            "[SHOWED].. يعني [SHOW RATE]. والرقم اللي نحاسب نفسنا عليه مع عملائنا [OUR SHOW "
            "RATE].", SHOW, "leak:show"),
        say("يعني بدون ولا استفسار زيادة.. لو بس صلحنا هالخطوة وحدها، بيصير عندك [EXTRA MEETINGS] "
            "بالشهر تصير فعلاً. وبنفس نسبة الإقفال مالتك، هذا تقريباً [EXTRA PROJECTS A YEAR] بالسنة. "
            "وبمتوسطك [PROJECT VALUE] للمشروع.. هذي [GAP YEAR] بالسنة تاركها على الطاولة الحين.",
            SHOW, "leak:show"),
        say("شنو رايك بهالكلام؟", SHOW, "leak:show"),
        say("اللي أشوفه إن التسريب بالإقفال. تقابل [SHOWED] بالشهر وتوقّع مع [CLOSED].. يعني "
            "[CLOSE RATE]. والرقم اللي نحاسب نفسنا عليه مع عملائنا [OUR CLOSE RATE].",
            CLOSE, "leak:close"),
        say("يعني بدون ولا استفسار زيادة ولا موعد زيادة.. لو بس صلحنا هالخطوة وحدها، بتوقّع "
            "تقريباً [EXTRA PROJECTS A YEAR] بالسنة. وبمتوسطك [PROJECT VALUE] للمشروع.. هذي "
            "[GAP YEAR] بالسنة تاركها على الطاولة الحين.", CLOSE, "leak:close"),
        say("شنو رايك بهالكلام؟", CLOSE, "leak:close"),
        say("بصراحة.. الفانل مالك زين. كل خطوة عندك نفس الرقم اللي نحاسب نفسنا عليه أو أحسن. "
            "يعني الشي الوحيد اللي بينك وبين [وضعهم المطلوب] هو الكمية.. ناس صح أكثر يدخلون من "
            "فوق.", VOLUME, "leak:volume"),
        say("لو بس ضاعفنا الاستفسارات اللي تييك، وبنفس نسبك انت، هذا تقريباً [EXTRA PROJECTS A "
            "YEAR] بالسنة.. يعني [GAP YEAR] بمتوسطك [PROJECT VALUE] للمشروع.", VOLUME, "leak:volume"),
        say("شنو رايك بهالكلام؟", VOLUME, "leak:volume"),
        adapt("ولا يهمك، خلنا نسويها بسيطة. بالشهر الزين.. جم مشروع توقّع؟ وبالشهر البطيء؟",
              REFERRALS, "leak:referrals"),
        adapt("وآخر ١٢ شهر.. جم شهر منها كان بطيء؟", REFERRALS, "leak:referrals"),
        say("يعني كل شهر بطيء هو تقريباً [PROJECTS LOST A SLOW MONTH] ما وقعتها، لأن ماكو شي ييب "
            "لك شغل لمن التوصيات تهدى. وبـ[SLOW MONTHS]، هذا تقريباً [LOST PROJECTS A YEAR] "
            "بالسنة. وبمتوسطك [PROJECT VALUE] للمشروع.. هذي [GAP YEAR] بالسنة تاركها للحظ.",
            REFERRALS, "leak:referrals"),
        say("شنو رايك بهالكلام؟", REFERRALS, "leak:referrals"),
        note(STAGE6_AFTER),
    ]
    s6["checklist"] = list(STAGE6_CHECKS)

    s7 = _stage(doc, 7)
    _replace(s7, "Use 2-3 of these", "بما إنك بالسوق من", [
        note(STAGE7_NOTES[0]),
        note(STAGE7_NOTES[1]),
        say("بما إنك توقّع مع [CLOSE RATE] من اللي تقابلهم، وقلت اللي ما يوقعون عادةً يروحون لأول "
            "واحد يوصل لهم.. شلون هذا يحطك بموقف صعب بتخطيط دخلك؟"),
        say("بما إن شغلك كله يعتمد على التوصيات، وقلت كان عندك [SLOW MONTHS] السنة اللي طافت.. "
            "شلون هذا يحطك بموقف صعب إنك توظف، أو تستثمر بمعدات، أو تاخذ مشاريع أكبر؟"),
        say("بما إنك تقضي [HOURS A WEEK] بالأسبوع تلحق ليدز، تتابع، وتسوي زيارات موقع لناس أصلاً "
            "ما كانوا بيوقعون.. شلون هذا يحطك بموقف صعب إنك فعلاً تدير الشركة وتكبرها؟"),
        say("بما إن تقريباً [LOST PROJECTS A YEAR] بالسنة تطيح عند [WEAK STEP]، وأغلبها تروح "
            "للمنافسين.. شلون هذا يحطك بموقف صعب بمكان شركتك بعد سنتين ثلاث مقارنة فيهم؟"),
        say("بما إنك بالسوق من [YEARS IN BUSINESS] وليلحين تعتمد على الكلام والتوصيات، بدون نظام "
            "تتحكم فيه بالبايبلاين.. شلون هذا يحطك بموقف صعب إنك تكبر أكثر من وضعك الحين؟"),
    ], w)

    s8 = _stage(doc, 8)
    _replace(s8, "أقدر أشاركك ملاحظاتي", "وش رأيك بهالشي؟", [
        say("خلني أرجع لأرقامك شوي.. لأني أحسه مهم."),
        adapt("قلت لي سويت [REVENUE] آخر ١٢ شهر. وحسبنا إن [WEAK STEP] بروحها قاعدة تضيع عليك "
              "تقريباً [LOST PROJECTS A YEAR] بالسنة."),
        adapt("وكل شهر يعدي بدون ما تنصلح، هذي [GAP MONTH] ثانية تروح لأول واحد يرد على التلفون. "
              "وهذا مو رايي.. هذا اللي أرقامك تقوله."),
        adapt("والـ١٢ شهر الياية، إذا ما تغير شي، هذي مشاريع بـ[GAP YEAR] كان ممكن تكون لك."),
        adapt("وهذي خطوة وحدة بس. احنا نشتغل على الفانل كله، بس لو هالشي الواحد بروحه انصلح.. "
              "[PAYBACK]. المخاطرة الصج مو إنك تصرف عشان تكبر. المخاطرة إنك تترك [GAP YEAR] على "
              "الطاولة لأنك ما سويت شي."),
        adapt("شنو رايك بهالكلام؟"),
    ], w)
    _replace(s8, "بما إنك تحوّل بس", "بما إنك تقضي [X ساعات بالأسبوع] تلاحق عملاء وتتابع", [
        say("بما إنك توقّع مع [CLOSE RATE] من اللي تقابلهم، واللي ما يوقعون يروحون للمنافسين.. "
            "شلون هذا يحطك بموقف صعب مع [هدفهم]؟"),
        say("بما إن شغلك كله يعتمد على التوصيات، وقلت كان عندك [SLOW MONTHS] السنة اللي طافت.. "
            "شلون هذا يحطك بموقف صعب بالتخطيط؟"),
        say("بما إن تقريباً [LOST PROJECTS A YEAR] راحت عليك السنة اللي طافت عند [WEAK STEP].. وين "
            "بيكون وضعك بعد ١٢ شهر إذا ما صلحناها؟"),
        say("بما إنك تقضي [HOURS A WEEK] بالأسبوع تلحق ليدز وتتابع بدال ما تركز على تنفيذ "
            "المشاريع.. شلون هذا يحطك بموقف صعب بنمو الشغل؟"),
    ], w)

    s11 = _stage(doc, 11)
    _replace(s11, "قلت لي تقفل تقريباً [X]%", "واضح — كيف هالتحسين الواحد", [
        adapt("قلت لي إنك توقّع مع تقريباً [CLOSE RATE] من اللي تقابلهم. حتى لو بس رفعناها لـ"
              "[CLOSE RATE PLUS 10]، وبمتوسطك [PROJECT VALUE] للمشروع، هذي [PLUS 10 A YEAR] زيادة "
              "بالسنة.. بدون ما تصرف ولا فلس زيادة على التسويق."),
        adapt("شلون تشوف هالتغيير الواحد بيبين بأرقامك؟"),
    ], w)

    s13 = _stage(doc, 13)
    _replace(s13, "قلت لي تترك تقريباً", "ضمانتنا ٣٠ موعد مؤهل", [
        adapt("انت تارك تقريباً [GAP YEAR] بالسنة على الطاولة عند [WEAK STEP] بروحها. "
              "وقلنا حتى لو بس صلحنا هالخطوة وحدها، هذا تقريباً [EXTRA PROJECTS A YEAR] بالسنة "
              "بمتوسطك [PROJECT VALUE]."),
        adapt("وعملائنا اللي يكملون البرنامج، متوسط العائد [X]:١."),
        note(GUARANTEE_NOTE),
    ], w)
    _replace(s13, "الحين وش بيصير. بأرسل لك كتيّب", None, [
        adapt("الحين شنو بيصير.. بأرسل لك كتيّب فيه كل شي تكلمنا عنه: تفاصيل البرنامج، أرقامك، "
              "ورابط الدفع. بيكون جدامك.", "Once the calculator confirms the ROI"),
    ], w)

    small = _entry(doc, "objections", '"I want to start small')
    _edit(small, '"اللي أقترحه بدال',
          "وتذكر، لو ما وصّلنا ٣٠ موعد بـ ٩٠ يوم، نستمر نشتغل مجاناً.",
          "وفوق هذا، نضمن لك ٣٠ موعد مؤهل بـ ٩٠ يوم، ولا نكمل نشتغل ببلاش لين نوصلها.", w)
    dep = _entry(doc, "objections", '"$500 deposit?')
    _edit(dep, '"خلني أسألك', "النتائج، الضمان، النظام", "النتائج والنظام", w)
    contract = _entry(doc, "objections", '"Send me the contract" / "Send me the recording"')
    _edit(contract, '"تعرف شنو', "البرنامج، الضمان، وتوقعاتك", "البرنامج، أرقامك، وتوقعاتك", w)


# -------------------------------------------------------------- the intro

INTRO_ADS = "If they're running ads now"
INTRO_ADS_NOTE = (
    "Two numbers, no more, and don't comment on them. The cockpit works out their cost per "
    "inquiry for the closer."
)
INTRO_STAGE4_CHECKS = [
    "If they run ads: roughly what they spend a month and the inquiries it brings",
]
GUARANTEE_FAQ_NOTE = (
    "Do NOT state the guarantee (30 appointments in 90 days). The closer uses it only when a "
    "prospect needs certainty, as an answer to an objection."
)


def _intro(doc: dict, lang: str) -> None:
    w = f"intro.{lang}"
    s3 = _stage(doc, 3)
    if lang == "en":
        _replace(s3, "So your conversion rate is", None, [
            say("So you're winning about [QUOTE WIN RATE] of your quotes."),
        ], w)
    else:
        _replace(s3, "يعني نسبة التحويل عندك", None, [
            say("يعني تكسب تقريباً [QUOTE WIN RATE] من عروضك."),
        ], w)

    s4 = _stage(doc, 4)
    blocks = s4["blocks"]
    yes = next((i for i, b in enumerate(blocks)
                if (b.get("branch") or "").startswith("If YES")), None)
    if yes is None:
        raise Drift(f"{w}: no \"If YES\" branch in stage 4")
    end = yes
    while end + 1 < len(blocks) and blocks[end + 1].get("branch") == blocks[yes].get("branch"):
        end += 1
    ask = ("And roughly how much are you putting into ads a month? And how many inquiries does "
           "that bring in?") if lang == "en" else "وتقريباً جم تحط على الإعلانات بالشهر؟ وجم استفسار ييك منها؟"
    s4["blocks"] = blocks[: end + 1] + [
        say(ask, INTRO_ADS),
        note(INTRO_ADS_NOTE, INTRO_ADS),
    ] + blocks[end + 1:]
    _add_checks(s4, INTRO_STAGE4_CHECKS)

    faq = _entry(doc, "faqs", '"Do you have guarantees?"')
    _replace(faq, "Do NOT state the guarantee", None, [
        {"type": "adapt", "text": GUARANTEE_FAQ_NOTE},
    ], w)


def apply(doc: dict) -> dict:
    """The doc with every revision applied once; the input is left as it is."""
    out = copy.deepcopy(doc)
    done = out.setdefault("revisions", [])
    if NUMBERS in done:
        return out
    key, lang = out.get("key"), out.get("lang")
    if key == "demo" and lang == "en":
        _demo_en(out)
    elif key == "demo" and lang == "ar":
        _demo_ar(out)
    elif key == "intro" and lang in ("en", "ar"):
        _intro(out, lang)
    else:
        raise Drift(f"no revision for {key}.{lang}")
    done.append(NUMBERS)
    return out
