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

2026-10-02, the guarantee (Aziz): "we legally can't give them a result
guarantee because everybody's different". Nothing promises results any
more: not the 30 appointments in 90 days, not working for free. The offer
carries a 7-day satisfaction guarantee instead: unhappy with the process in
any way in the first 7 days, we refund them. It is said only to answer the
guarantee objection, never in the pitch or the close. The handle opens on
"Legally, we can't give you a guarantee on results" and then follows Cole
Gordon's "Is there a guarantee?" (Sales Team Accelerator, uncertainty-based
objections): ask why they ask, what serious thing was ever 100%
guaranteed, what is on our side and what is on theirs, "are those two
things you're willing to do?", "what other question do you have?". The 7
days come last, as his risk mitigator for someone who wants in but is
still skeptical ("the best thing for you isn't jumping in if this isn't
right, and it isn't doing nothing either").
"""
from __future__ import annotations

import copy

NUMBERS = "2026-09-27-numbers"
GUARANTEE = "2026-10-02-guarantee"


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


def _after(stage: dict, starts: str, new: list, where: str) -> None:
    """Put blocks right after the line starting `starts`."""
    blocks = stage["blocks"]
    i = _find(blocks, starts, where)
    stage["blocks"] = blocks[: i + 1] + new + blocks[i + 1:]


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


# ---------------------------------------------------------- the guarantee

NO_RESULTS_NOTE = (
    "We never guarantee results: legally we can't, because every business is different. Open "
    "on that, then Cole Gordon's handle: find out why they ask, and move the question from what "
    "we promise to what they'll do. The 7-day satisfaction guarantee comes last, and only if "
    "they still need certainty."
)
ASK_WHY_NOTE = (
    "Let them answer. If an agency burned them before, that's the real objection: go to "
    "\"I've tried marketing before and it didn't work\"."
)
HONEST_NOTE = "Let them answer. Most say nothing was."
SEVEN_DAYS = "If they want it but still need certainty"
SEVEN_DAYS_NOTE = (
    "Only for someone who wants this but is still skeptical, and only here: never in the pitch "
    "or the close. It's a satisfaction guarantee on the process, not on results: never say \"if "
    "you don't get results\". It's on the deck's investment slide too (press G)."
)
CLOSE_NOTE = (
    "We never promise results, and the 7-day satisfaction guarantee is not part of the close. "
    "Keep it for when they ask for certainty (\"How do I know this will work?\", \"Can you "
    "guarantee results?\"); the handle is in the objections."
)
PAY_AFTER_NOTE = (
    "If they come back with \"what if it doesn't work?\", that's the guarantee objection: "
    "\"How do I know this will work?\" / \"Can you guarantee results?\"."
)
FAQ_NOTE = (
    "Then ask why they ask and run the rest of the handle in the objection \"How do I know this "
    "will work?\" / \"Can you guarantee results?\". Only if they want it but still need "
    "certainty, the 7-day satisfaction guarantee:"
)
SETTER_NOTE = (
    "Never promise results, numbers or a refund, and don't mention the 7-day satisfaction "
    "guarantee: the closer uses it only when a prospect asks for certainty, as the answer to "
    "that objection."
)
QUICK = '"Can you guarantee results?" | '
QUICK_ANSWER = '"Fair question. Legally, we can\'t guarantee results. Just curious, are you asking for a reason?"'
TRIED_STEP = "Step 4 — What's different now:"

# The guarantee revision's words by language: lines found by their first
# words, and (first words, old words, new words) for changes inside a line.
# What the closer says keeps the doc's quotation marks, like the rest of the
# objections.
GUARANTEE_WORDS = {
    "en": {
        "handle_last": '"You\'ve made bigger bets',
        "handle": [
            step("Handle"),
            note(NO_RESULTS_NOTE),
            adapt("Step 1 — Be straight with them, then ask why:"),
            say("\"Fair question, and I'll be straight with you: legally, we can't give you a "
                "guarantee on results. Any agency that promises you results before they've even "
                "started isn't being straight with you.\""),
            say("\"Just curious though, are you asking for a reason?\""),
            note(ASK_WHY_NOTE),
            say("\"Got it. I hear you, and I appreciate you asking.\""),
            adapt("Step 2 — Why nobody can promise it:"),
            say("\"Can I ask you an honest question? What big things in your business, the ones "
                "actually worth doing, came with a 100% guarantee?\""),
            note(HONEST_NOTE),
            say("\"Exactly. When you took on your first big project or hired your first engineer, "
                "nobody could promise you how it would turn out. Every business is different: your "
                "market, your prices, your offer, how your team follows up. So it wouldn't be "
                "honest of me to sit here and predict your results.\""),
            adapt("Step 3 — Our side and their side:"),
            say("\"What I can tell you is what's on our side. We've worked with over 70 "
                "construction and design companies across the Gulf, and from day one a whole team "
                "works on your funnel every day: media buyers, the call center, creative and "
                "consulting, with every number on your live dashboard.\""),
            say("\"What nobody can promise you is your side of it: that you show up to every "
                "meeting we book, follow up, and close.\""),
            adapt("Step 4 — The real question:"),
            say("\"So the real question is on your side. Will you show up to every meeting we book "
                "and follow up? And when something isn't working, will you tell us straight away "
                "instead of going quiet?\""),
            say("\"Because the companies that get the most out of this are the ones that do "
                "exactly those two things. Are those two things you're willing to do?\""),
            say("\"Good. What other question do you have?\""),
            step(SEVEN_DAYS),
            note(SEVEN_DAYS_NOTE),
            say("\"Look, the best thing for you definitely isn't jumping in if this isn't the "
                "right thing. But the best thing for you also isn't doing nothing about "
                "[WEAK STEP] and leaving [GAP YEAR] a year on the table.\""),
            say("\"So here's what I'd do if I were you. Draw a line in the sand and decide: no "
                "more losing [GAP MONTH] a month at [WEAK STEP]. Then step over that line and "
                "start.\""),
            say("\"And if in your first 7 days you're unhappy with the process in any way, you tell "
                "us and we refund you. No hard feelings.\""),
            say("\"So if that's something we're willing to do, is that something you're willing "
                "to move forward with today?\""),
        ],
        "expensive": [
            ('"And let me ask you something',
             "you're investing in a system with a guarantee behind it.",
             "you're investing in a system we've run for over 70 construction and design "
             "companies across the Gulf."),
            ('"Exactly. And the reason is simple',
             "That's why we have the guarantee: 30 qualified appointments in 90 days or we keep "
             "working for free until we deliver. You're not paying and hoping. You're paying and "
             "we're guaranteeing the result.",
             "That's why it's paid upfront, the same way you take a deposit before you start a "
             "project. You're not paying and hoping: you're paying for a team that's on your "
             "account every day, and you see every number on your live dashboard."),
        ],
        "pay_after": '"Exactly. And the reason is simple',
        "agency": [
            ('"So you\'re paying',
             "In 90 days with us, the guarantee is 30 qualified appointments. If your current "
             "agency was delivering that, would you even be looking?",
             "With us, our call center calls every inquiry, qualifies it, and books the right ones "
             "straight onto your calendar. If your current agency was doing that for you, would "
             "you even be looking?"),
            ('"I totally get that.',
             " Do they guarantee 30 appointments or they work for free?",
             " Do they hold themselves to a number at every step of your funnel?"),
        ],
        "small": [
            ('"Here\'s what I\'d suggest instead',
             "And on top of that, we guarantee 30 qualified appointments in 90 days, or we keep "
             "working for free until we get there. So the risk is on us, not on you.",
             "And you see every number on your live dashboard the whole way, so you never have to "
             "take our word for it."),
            ('"Does that feel fair', "hold us to the guarantee?", "hold us to the numbers?"),
        ],
        "tried": ('"And here\'s the difference: your last agency',
                  "\"And here's what's different this time: you're not trusting a promise. You see "
                  "every number on your live dashboard, and you hold us to the number at every step "
                  "of your funnel. So the real risk isn't trying again. It's not doing it, and "
                  "losing more projects to competitors who do.\""),
        "outside": ('"Our specialty is', "at the level we guarantee.",
                    "at the level we hold ourselves to."),
        "faq_old": '"30 qualified appointments in 90 days.',
        "faq": [
            say("\"Legally, we can't guarantee results, and any agency that does isn't being "
                "straight with you. Every business is different: your market, your prices, your "
                "offer, how your team follows up.\""),
            note(FAQ_NOTE),
            say("\"If in your first 7 days you're unhappy with the process in any way, you tell us "
                "and we refund you.\""),
        ],
    },
    "ar": {
        "handle_last": '"أخذت قرارات أكبر',
        "handle": [
            step("Handle"),
            note(NO_RESULTS_NOTE),
            adapt("Step 1 — Be straight with them, then ask why:"),
            say("\"سؤال عدل، وخلني أكون واضح معاك: قانونياً ما نقدر نعطيك ضمان على النتائج. وأي "
                "وكالة تضمن لك نتائج قبل لا تشتغل معاك.. مو صادقة معاك.\""),
            say("\"بس من باب الفضول.. تسأل لسبب معين؟\""),
            note(ASK_WHY_NOTE),
            say("\"تمام، فاهم عليك. وأقدّر إنك سألت.\""),
            adapt("Step 2 — Why nobody can promise it:"),
            say("\"أقدر أسألك سؤال بصراحة؟ شنو الأشياء الكبيرة بشغلك، اللي فعلاً تستاهل، كانت "
                "مضمونة امية بالمية؟\""),
            note(HONEST_NOTE),
            say("\"بالضبط. لمن أخذت أول مشروع كبير، أو وظفت أول مهندس.. ماحد قدر يضمن لك شلون "
                "بتطلع. وكل بزنس غير: سوقك، أسعارك، عرضك، وشلون فريقك يتابع. فمو أمانة مني إني "
                "أقعد جدامك وأتوقع لك النتائج.\""),
            adapt("Step 3 — Our side and their side:"),
            say("\"اللي أقدر أقوله لك هو اللي علينا. اشتغلنا مع أكثر من ٧٠ شركة بالخليج، ومن أول "
                "يوم يشتغل على الفانل مالك فريق كامل كل يوم: ميديا بايرز، كول سنتر، تصميم "
                "واستشارات.. وكل رقم تشوفه جدامك على الداشبورد.\""),
            say("\"واللي ماحد يقدر يضمنه لك هو اللي عليك: إنك تحضر كل موعد نحجزه لك، وتتابع "
                "وتبيع صح.\""),
            adapt("Step 4 — The real question:"),
            say("\"فالسؤال الصج عندك انت. بتحضر كل موعد نحجزه وتتابع؟ وإذا شي مو ماشي.. بتقولنا "
                "سيده بدال ما تختفي؟\""),
            say("\"لأن الشركات اللي تطلع بأكثر شي من هالبرنامج هي اللي تسوي هالشيئين بالضبط. "
                "هالشيئين مستعد تسويهم؟\""),
            say("\"حلو. وشنو الأسئلة الثانية اللي عندك؟\""),
            step(SEVEN_DAYS),
            note(SEVEN_DAYS_NOTE),
            say("\"شوف.. أكيد أحسن شي لك مو إنك تدخل إذا هالشي مو مناسب لك. بس بعد أحسن شي لك مو "
                "إنك تقعد ما تسوي شي عن [WEAK STEP]، وتترك [GAP YEAR] بالسنة على الطاولة.\""),
            say("\"فلو أنا مكانك.. بقول خلاص: ما عاد أخسر [GAP MONTH] بالشهر عند [WEAK STEP]. "
                "وأبدي.\""),
            say("\"وإذا بأول ٧ أيام مو راضي عن طريقة الشغل بأي شكل، تقولنا ونرجع لك فلوسك. بدون "
                "أي زعل.\""),
            say("\"فإذا احنا مستعدين نسوي هالشي.. انت مستعد نبدي اليوم؟\""),
        ],
        "expensive": [
            ('"وخلني أسألك', "إنت تستثمر بنظام وراه ضمان.",
             "إنت تستثمر بنظام شغّلناه لأكثر من ٧٠ شركة بالخليج."),
            ('"بالضبط. والسبب بسيط',
             "عشان جذي عندنا الضمان: ٣٠ موعد مؤهل بـ ٩٠ يوم ولا نستمر نشتغل مجاناً لين نوصّل. "
             "إنت مو تدفع وتتمنى. إنت تدفع وإحنا نضمنلك النتيجة.",
             "عشان جذي الدفع من البداية، مثل ما إنت تاخذ عربون قبل لا تبدي أي مشروع. إنت مو "
             "تدفع وتتمنى.. إنت تدفع لفريق شغال على حسابك كل يوم، وتشوف كل رقم على الداشبورد."),
        ],
        "pay_after": '"بالضبط. والسبب بسيط',
        "agency": [
            ('"يعني إنت تدفع',
             "بـ ٩٠ يوم معنا، الضمان ٣٠ موعد مؤهل. لو وكالتك الحالية كانت توصّل هالنتائج، كنت "
             "بتدور أصلاً؟",
             "معنا، الكول سنتر مالنا يتصل بكل استفسار، يتأكد إنه جدّي، ويحجز الصح منهم على "
             "جدولك سيده. لو وكالتك الحالية تسوي لك هالشي، كنت بتدور أصلاً؟"),
            ('"أفهمك تمام.', " يضمنون ٣٠ موعد ولا يشتغلون مجاناً؟",
             " يحاسبون نفسهم على رقم بكل خطوة بالفانل مالك؟"),
        ],
        "small": [
            ('"اللي أقترحه بدال',
             "وفوق هذا، نضمن لك ٣٠ موعد مؤهل بـ ٩٠ يوم، ولا نكمل نشتغل ببلاش لين نوصلها. يعني "
             "المخاطرة علينا مو عليك.",
             "وطول الوقت تشوف كل رقم على الداشبورد.. يعني ما تحتاج تاخذ كلامنا وبس."),
            ('"تحس هالشي عدل', "وتحاسبنا على الضمان؟", "وتحاسبنا على الأرقام؟"),
        ],
        "tried": ('"وهذا الفرق: وكالتك السابقة',
                  "\"وهذا الفرق هالمرة: انت مو معتمد على وعد. تشوف كل رقم على الداشبورد، وتحاسبنا "
                  "على الرقم بكل خطوة بالفانل مالك. يعني المخاطرة الصج مو إنك تجرب مرة ثانية. "
                  "المخاطرة إنك ما تسويها، وتستمر تخسر مشاريع لمنافسين يسوونها.\""),
        "outside": ('"تخصصنا شركات', "بالمستوى اللي نضمنه.", "بالمستوى اللي نحاسب نفسنا عليه."),
        "faq_old": '"٣٠ موعد مؤهل بـ ٩٠ يوم.',
        "faq": [
            say("\"قانونياً ما نقدر نضمن نتائج.. وأي وكالة تضمنها لك مو صادقة معاك. كل بزنس غير: "
                "سوقك، أسعارك، عرضك، وشلون فريقك يتابع.\""),
            note(FAQ_NOTE),
            say("\"وإذا بأول ٧ أيام مو راضي عن طريقة الشغل بأي شكل، تقولنا ونرجع لك فلوسك.\""),
        ],
    },
}

SETTER_WORDS = {
    "en": ("Yes, we do have guarantees",
           "Legally, nobody can guarantee you results, because every business is different: your "
           "market, your prices, how your team follows up. What [CLOSER NAME] will do on the call "
           "is walk you through exactly how we work and what to expect, with your numbers in front "
           "of you."),
    "ar": ("إي، عندنا ضمانات",
           "قانونياً ماحد يقدر يضمن لك نتائج، لأن كل بزنس غير: سوقك، أسعارك، وشلون فريقك يتابع. "
           "اللي بيسويه [CLOSER NAME] بالمكالمة إنه يمشي معاك على شلون نشتغل بالضبط وشنو تتوقع، "
           "وأرقامك جدامك."),
}


def _guarantee_demo(doc: dict, lang: str) -> None:
    w = f"demo.{lang}"
    g = GUARANTEE_WORDS[lang]
    _replace(_stage(doc, 13), "The guarantee is not part of the close", None, [note(CLOSE_NOTE)], w)

    handle = _entry(doc, "objections", '"How do I know this will work?"')
    _replace(handle, "Handle", g["handle_last"], g["handle"], w)

    pricey = _entry(doc, "objections", '"It\'s too expensive"')
    for starts, old, new in g["expensive"]:
        _edit(pricey, starts, old, new, w)
    _after(pricey, g["pay_after"], [note(PAY_AFTER_NOTE)], w)

    agency = _entry(doc, "objections", '"Already with another agency"')
    for starts, old, new in g["agency"]:
        _edit(agency, starts, old, new, w)

    small = _entry(doc, "objections", '"I want to start small')
    for starts, old, new in g["small"]:
        _edit(small, starts, old, new, w)

    tried = _entry(doc, "objections", '"I\'ve tried marketing before')
    _replace(tried, "Step 4 — Risk reversal:", None, [adapt(TRIED_STEP)], w)
    _replace(tried, g["tried"][0], None, [say(g["tried"][1])], w)

    outside = _entry(doc, "faqs", '"Do you work with companies outside the Gulf?"')
    _edit(outside, *g["outside"], w)

    faq = _entry(doc, "faqs", '"What\'s the guarantee exactly?"')
    _replace(faq, g["faq_old"], None, g["faq"], w)

    quick = _entry(doc, "faqs", '"Do people actually fill in a form?')
    _replace(quick, QUICK, None, [say(QUICK + QUICK_ANSWER)], w)


def _guarantee_intro(doc: dict, lang: str) -> None:
    w = f"intro.{lang}"
    faq = _entry(doc, "faqs", '"Do you have guarantees?"')
    old, new = SETTER_WORDS[lang]
    _replace(faq, old, None, [say(new)], w)
    _replace(faq, "Do NOT state the guarantee", None, [adapt(SETTER_NOTE)], w)


SCRIPTS = (("demo", "en"), ("demo", "ar"), ("intro", "en"), ("intro", "ar"))


def apply(doc: dict) -> dict:
    """The doc with every revision applied once, in order; the input is left as it is."""
    out = copy.deepcopy(doc)
    done = out.setdefault("revisions", [])
    key, lang = out.get("key"), out.get("lang")
    if (key, lang) not in SCRIPTS:
        raise Drift(f"no revision for {key}.{lang}")
    if NUMBERS not in done:
        if key == "demo":
            (_demo_en if lang == "en" else _demo_ar)(out)
        else:
            _intro(out, lang)
        done.append(NUMBERS)
    if GUARANTEE not in done:
        if key == "demo":
            _guarantee_demo(out, lang)
        else:
            _guarantee_intro(out, lang)
        done.append(GUARANTEE)
    return out
