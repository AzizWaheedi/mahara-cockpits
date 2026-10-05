---
name: proposal-draft
description: Turn one recorded closing call into the deal JSON a Mahara proposal is built from.
---

# Drafting a proposal from a closing call

You are given one closing call and you return **one JSON object**. Nothing else:
no commentary, no explanation, no markdown fence. Code takes what you return,
validates it, builds the document and hands it to the closer. If you narrate
instead of returning JSON, the run fails.

You never contact a client. You never decide whether the proposal is sent.

## What you are given

- `transcript_text`: the call, flattened to `speaker: text`, mostly Arabic.
  **This is the only evidence.** Every figure you write is checked back against
  it automatically.
- `client_name`, `client_company`, `client_email`, `client_country`: from the
  CRM, often missing.
- `closer`, `recorded_at`: context.

## The rule that matters most

**A number that was not said on the call does not go in the document.**

Write `FILL` and let the closer supply it. An unfinished proposal is obvious on
sight and costs a follow-up question. An invented one loses the deal and the
trust behind it. `validate.py` checks every figure of 100 or more against the
transcript and fails the draft if it is not there or derivable from figures that
are, so an invented number never reaches a client, it just wastes the run.

`FILL` is for a figure that was never said, never for a thing that was said
without one. A goal given in words is still a goal: "a pipeline that does not
depend on who you know" is a real answer to what he wants, and writing `FILL`
over it throws away evidence the call did give. Ask of every blank you are about
to write: was this genuinely absent, or only absent as a number?

**Never reshape a person's name.** Write `client_contact` exactly as the CRM
or the call gives it, or write FILL. Do not shorten it, do not strip what looks
like a title, and do not turn a transcript speaker label into a surname. An
Arabic kunya is a whole name and not a prefix: Umm Faisal and Abu Khalid are
how those people are addressed, and Faisal and Khalid are their children. A
cover page is the first thing the client reads, so a name that has been tidied
is worse than a FILL the closer fills in ten seconds. Capitals are the one
exception, and they are not yours to change: a name copied from a speaker label
is put in title case by code after you write it, and so is one copied from the
CRM, which keeps names in lower case ("fahad al-harbi" becomes Fahad Al-Harbi;
bin, ibn and de stay lower case, Arabic script as written, and a name the
closer typed keeps the closer's spelling), so copy the spelling as it stands.

Figures you take from the call are checked against the transcript as exact
substrings, so copy them out of it rather than rounding or retyping them. The
same rule that governed quotes still governs every number: what the document
asserts, the transcript has to support. A figure written as words is checked
like one in digits: "six projects" and "ستة مشاريع" are both the figure 6.
Write the proposal in English unless you are asked for `lang: "ar"`.

**A figure said only in passing is never a headline.** A number the client
mentioned as an aside, one inside a stretch of the transcript too garbled to
read with confidence, or one you worked out from what was said around it, is
`FILL` or left out. It never becomes the headline, a gap tile or the goal. The
figures a page is built on are the ones the client stated plainly, about the
thing the page says they are about. Do not add a detail the figure did not
have: ten days from the start is not ten days from launch.

**One count per thing.** When two pages count the same thing (projects signed,
meetings, enquiries, leads), they carry the same number. A gap tile saying six
signed and a tree saying two signed means one of them is wrong, and
`validate.py` warns, naming both fields. A count over a different period is a
different count: name the period ("in eight months", "last year") each time.

**Our own figures are the one exception**, and they come from two places only:
the offer below, and the proof, which is copied from PATTERNS.md and never from
the call (see "The proof is the record").

## Which of the three templates

Three documents come out of this skill, and the call decides which:

- **The specific one.** Its middle pages are built from the client's own
  figures, and it is the one that closes.
- **The general one**, marked `"variant": "general"`. For calls that never
  produced those figures.
- **The blind one**, marked `"variant": "blind"`. For a call that gave no
  figures at all. Four or five sheets, never seven.

Code picks the variant before you are called, and the reference at the end of
these instructions is the shape of the one you are writing.

The gate is mechanical, and it is not a verdict on how good the call was:

> **No call at all, or a call the triage could not read → the blind one. A call
> giving an average project value but no net margin → the general one, which is
> the ordinary case. A call giving both → the specific one, which is rare.**

A call that could not be read used to fall through to the general variant, on
the reasoning that general is the safe direction to be wrong in. It is not.
General was then the one variant required to carry `quotes`, so an unread
call did not produce a cautious document: it produced a document quoting
sentences nobody had read. The quotes block is gone entirely now, and that
requirement is exactly why it had to go.

Rare is measured, not guessed. Sixty-seven recorded calls were read on
2026-08-23: forty gave an average project value, thirteen mentioned a margin at
all, and three of those were genuinely net. Clients answer the first question
readily and dodge the second, so the engine is built around having the first
alone. Do not treat a general proposal as a degraded one; it is the normal one.

When the project value is known and the margin is not, the arithmetic page uses
`mode: "margin"`. It states their project value, the whole engagement, and the
share of one project the engagement costs, and stops there. The reader
compares that share against a figure he never had to say out loud, which is the
only honest way to use a number nobody will give you. `roi.margin_pct` stays 0
and `validate.py` fails the draft if it does not.

Watch the share it produces. Above a fifth of one project the check warns, and
above a third it fails: no contractor accepts that a third of a job goes on
marketing, and a page that says so is arguing against itself.

The blind variant (`"variant": "blind"`) is for a company nobody has spoken to,
where the only things known are the name and the discipline. It may not assert
one fact about the reader: `gap_points`, `funnel` and `cost` are all
forbidden in its deal file and `validate.py` fails the draft if any appear. In
their place, `pattern` carries the five recurring problems from PATTERNS.md,
stated as a pattern about the category and never as a finding, with
`pattern_note` naming the source and asking the reader to say which of them are
his. Label every assumption on the page as one ("the goal we would set", not
"your goal"), and make the missing conversation the call to action rather than
an apology. A blind proposal runs to five sheets: cover, the pattern, the tree,
what we install, what it costs and the next step. A cold document is shorter
than one written after a call because it has three fewer pages of the client in
it, and `validate.py` derives the sheet count from the data rather than
expecting seven.

Do not reach for the general template because a call felt thin, and do not force
the specific one by assuming a margin. A specific proposal resting on one
invented number is worth less than a general proposal resting on none: it fails
the fee band in `validate.py`, and if it ever got past that it would fail in
front of a finance manager instead, which is the expensive place to fail.

## What changes per client: the only six things

Everything else in the template is the same pitch every time. Hunt for these:

1. **Who they are**: company, contact, market, the kind of project they want more of.
2. **Where the work comes from today**, and what that costs them in consistency.
3. **Their funnel numbers**: enquiries, meetings, quotations, signed. Per month.
4. **Their average project value.**
5. **Their net margin**, at the bottom of whatever range they quote.
6. **Their goal**, in their own words and their own currency.

Numbers 4 and 5 drive the entire return page. Put them in `roi` and the
break-even maths writes itself.

**The margin is the one that gets missed.** It was absent from two of the first
three calls drafted. If no net margin was stated, `roi.margin_pct` stays 0 and
`margin_note` says plainly that it was not given. Do not quietly assume 20%.

**A gross margin is still a figure they gave.** Many contractors give a gross
margin, a markup or an overhead instead of what is left after everything. That
is not a net margin: it never goes in `roi.margin_pct` and it never makes a
proposal specific. But the page must use it, not talk around it. When the call
gives one, put it in `arithmetic.gross_margin` (percent, the bottom of their
range) and the page counts the projects at it and labels the count gross: as
an extra line in `margin` and `volume` mode, and in the grid as its one column
when `margins` is left out. The verdict and the close use that same count,
beside the word gross ("counted at the 25 percent gross margin you gave, the
engagement is 0.35 of one project"). It is still one project the page divides
by, so the page keeps one denominator. Leave the key out when the call gave no gross
margin. Never write as if the margin were not there ("before you count a cent
of margin"): a reader who told you his margin and sees it ignored stops
trusting the page, and `validate.py` warns. If the count at his gross margin
needs more projects than the term targets, the verdict says so plainly; that
is a finding for the closer.

Quote a range as the client gave it, and say which end the page counts: "a
gross margin of 20 to 30 percent, counted at 20", never "a 20 percent margin"
for a client who said 20 to 30. A project value given as a range is quoted
the same way.

When the project value is not an average (a minimum ticket, a typical job),
name it in `arithmetic.project_label` ("Your minimum ticket") so the page does
not call it your average.

Counts and shares under ten take two decimals (0.35, never 0.3; 1.05 percent,
never 1.1), and from ten up one decimal, as the page prints them.

## The offer

The closer sets the offer for each proposal. The one for this proposal is
below, worked out from `offer.json` and the closer's choice. It binds: print
these figures exactly, with the words in the document's language.

{{offer.block}}

- **Use exactly the payment structure the closer chose, and never invent one
  the closer did not choose.** Paid in full is paid in full: a split or a
  monthly schedule printed unprompted quotes a price nobody offered, and
  softening the number is not the drafter's call. When the closer chose a
  plan, print every instalment with its amount and when it falls due, and
  nothing else; the instalments add up to the price. `validate.py` fails a
  draft whose schedule is not the one chosen.
- **The guarantee appears only when the closer chose it**, in the words given,
  once: the 7-day satisfaction guarantee, a refund if they are unhappy with
  the process in the first 7 days. When there is none, the document promises
  nothing beyond the target: no refund, no free work. **Results are never
  promised**, chosen guarantee or not: no "or we work for free until we
  deliver", no meetings, leads or projects guaranteed; legally we can't.
  `validate.py` fails a draft that promises results, or a refund nobody chose.
- **The advertising budget is always its own line**, paid by the client to the
  platforms, never folded into the fee.
- **Never discount.** The price is the one given. The payment structure is the
  only thing that moves, and only by the closer's choice.
- Targets are stated as meetings booked and attended. **Never** revenue, never a
  close rate we do not control.
- **A target is called a target.** "Thirty qualified meetings across the three
  months is the target the program works to." Never "built to deliver",
  "designed to deliver", "built to add", "the program delivers", "we will
  bring", "you will get" or "expect" in front of a number of meetings,
  projects or leads, and never "is what the program is built to deliver"
  after one: that is a promise in other words, in either language, and
  `validate.py` fails it unless the same sentence calls the figure a target.
  `roi.target_projects_month` prints under "The plan's target", in large
  type: a short range in the plan's words, always with its period ("2 to 4 a
  month", "1 to 3 over three months"), since the label names none.
- **No outcome is certain.** The program filters and lowers; it cannot
  promise none or all. Where the document says what we install and what it
  changes, write "fewer" or "filtered out", never "never": "so fewer small
  jobs arrive", not "so small jobs never arrive". "Every lead is qualified",
  "only serious buyers reach you", "no more wasted meetings" and "a calendar
  that is always full" are the same promise, in either language, on the cover
  as anywhere else, and `validate.py` fails them. Saying what we do ("every
  enquiry called in minutes", "we never book without a budget check") is not
  an outcome and is fine.
- **The timeline comes from PATTERNS.md, worded as the aim:** launch on day 7,
  first meetings aimed for between days 10 and 15 from signature. A day said
  on the call does not move it. A date for a result is a promise in other
  words: never "land within ten days", "you will have meetings by day 10" or
  "تصل أول الاجتماعات خلال عشرة أيام". `validate.py` fails one unless the same
  sentence calls it the aim or the target. The days to the first meeting are
  one figure: the target tile in `solution_targets` and the steps to start in
  `start_steps` (the step's window and its words) give the same last day, and
  `validate.py` fails a draft where any two places differ.
- **No payment ever waits on a result.** Whatever the closer chose, no
  instalment falls due on a first contract, project, deal, client or sale. A
  call recorded before 3 October 2026 may still quote that split; it is
  retired, and the call does not bring it back. `validate.py` fails a price-page
  line, in either language, that ties a payment to one.
- **The total is what is paid to us at the start.** `investment.total_amount`
  is the payment at the start (the first of the two when split) and
  `total_label` says so: "Paid to us at the start".
  Advertising is never added into it; it is paid to the platforms, on its own
  line. The payment-structure row says how the price is paid, not the price
  again: its amount reads "In full at the start" when paid in full, or "Two
  payments" with each instalment and its due date in the detail. Printing the
  price twice above a total invites the reader to add them up. `validate.py`
  fails a total that is not the first payment.

## The two pages built from the call

**The driver tree.** Their goal at the top, two branches, two sub-drivers each.
The branches must not overlap and together must account for the whole goal. Where
enquiries already arrive: *get more of them into a meeting* and *sign more of the
meetings you already hold*. Where there is no channel: *create enquiries where
there are none* and *turn them into contracts*. Two branches is the design, so
leave `tree.note` empty when there is no third branch to explain: a line saying
there is no third branch is filler under the exhibit, and `validate.py` warns on
it. Use the note only for a finding the branches do not show.

**The cost of the gap**, three layers, in their currency, per month:

1. Cash already going out for nothing: ad spend on enquiries that never convert.
2. The contract the same funnel could have signed: one more project a month, at
   their average value and the bottom of their own margin range. **One, not three.**
3. The load on the people: named, and left unpriced.

The engagement should land between **10 and 30 percent** of the annual figure.
Outside that band the diagnosis is not finished. If a company's gap is so large
that the fee lands far below 10 percent, say so in `cost.close` rather than
inflating the fee. That is a real finding about the deal, not an error.

Where projects are large and signed quarterly rather than monthly, price "one
more project a quarter" and divide. The cost page is monthly; the business is not.

## What changes in the general variant

Two pages. The offer the closer chose, the five steps, the proof and the terms
are identical, and so is everything on the cover.

**There is no quotes block. Do not write one.** `quotes` was the general
variant's first page until 7 September 2026 and no longer renders: the
template has no "In their words" section, and `validate.py` fails a deal file
that carries the key. Nothing you write there will reach the page.

It was removed because it kept being filled with speech-recognition wreckage
presented as the reader's own words. Three drafts running: mangled Arabic that
was not words, sentence fragments, then the same again. The instruction to quote
only what survives verbatim was already here and was followed each time by a
model that had a slot to fill and filled it. A slot that cannot be filled badly
is the only version of that instruction that holds.

**The gap page is carried by figures, a funnel, or the pattern.** `gap_points`
when the call gave three figures worth printing large, the `funnel` when it gave
counts, `pattern` and `pattern_note` when there was no call. One of them, not two.

`tree_title` is the heading above the page and `tree.title` is the label on the
exhibit inside it. They are two different lines and filling both with the same
sentence prints it twice. If the exhibit needs no label of its own, leave
`tree.title` out.

Keep the `funnel` if the call gave any counts at all. A general proposal is
not obliged to throw away the numbers it does have. Where nothing was counted,
the funnel falls back to a labelled list on its own, and "not counted" across
four rows is itself one of the findings.

**One denominator per page, and no new totals.** Whatever the table divides
into, the `verdict` and the `close` divide into the same thing. If the table
sets one project against the whole engagement, the verdict does not then set it
against the fee alone because that number reads better. Saying it both ways
does not make the case twice, it tells the reader the page will pick whichever
comparison flatters us, and he then rereads the first one looking for the trick.
`validate.py` fails the page's words when they set our fee alone where the
table has the whole engagement (5 October 2026: "the USD 6,000 engagement"
beside a table of 10,500, and "if you keep a fifth" beside a table needing 35.0
percent).

Say it as a share or a ratio, never as a product. "Nine tenths of one project",
"less than one project", "half the engagement" are all safe, because every
quantity in them is already on the page. Multiplying is not: three projects at
USD 12,000 is USD 36,000, and the moment you write 36,000 you have put a figure
in front of the client that nobody said on the call. The arithmetic being right
does not make the number theirs. `validate.py` fails the document for it, and
it is correct to.

**Which arithmetic mode.** `margin` asks what share of one project the
engagement costs. That is the right question only where one project is large
next to the fee. Where the call gave a signing rate as well as a project value,
and the engagement comes to more than a third of a single project, use
`mode: "volume"` instead: the reader is not deciding whether one job pays for
us, he is deciding whether the rate we add pays for us.

`volume` needs `project_value_low`, `project_value_high` when they gave a range,
`target_additional_low` and `target_additional_high` for the projects the term
is meant to add, and two strings copied from what they said: `rate_display`
("1 to 2 a month") and `target_display` ("2 to 4 over three months"). It asserts
nothing the call did not give. `rate_display` is the rate the client signs at
today, as he said it ("3 since January"), never the target: it prints as "You
sign" directly above the target, so the target written there reads as the same
line twice, and `validate.py` fails it. When the call gave no signing rate,
write FILL. When the plan really aims to add as many as the client signs
today, say so in the target: "2 more a month" under "You sign 2 a month". The verdict and the close call the target what the table calls
it, additional projects: never "qualified projects", since qualified is a word
for meetings. Do not reach for it to make a bad number look
better: if even the whole target does not cover the engagement, the validator
says so and the deal needs a human.

**The cost page becomes the arithmetic page.** `arithmetic` replaces `cost`.
There is no gap to price the fee against, so the page divides our own fee
instead:

```json
"arithmetic": {
  "currency": "SAR",
  "project_values": [200000, 500000, 1000000, 2000000],
  "margins": [10, 20]
}
```

`currency` is the one the client named, in a word or a symbol. When the call
never named one, write `FILL` there and let the closer settle it in one
question: never assume dollars, or the currency of his country. A project value
read in the wrong currency puts every figure on the page out by a factor of two
or more.

Every cell is computed: the whole engagement divided by the net profit on one
project at the margin in that column. The page asserts nothing about the client,
and the reader finds his own row, which persuades better than being told which
row is his.

A grid page carries its own `total_label` ("The whole engagement, three
months") and a `close` sentence that says what the table shows, like any other
arithmetic page; copying a margin-mode page's words onto a grid loses both.

Choose `project_values` to straddle the reader's likely size, and **include one
row that needs more than a single project.** A table where every answer flatters
us reads as rigged, and `validate.py` warns when there is no such row. Choose
`margins` as a plausible low and high for the discipline, never as a claim about
theirs.

`roi.avg_project_value` and `roi.margin_pct` are **0** in a general deal file.
Anything else fails validation by design: the reason this variant exists is that
those two numbers were never said.

Leave `roi_breakeven` out. The arithmetic page already is the break-even
argument, and repeating it on the investment page says the same thing twice.

## Writing the general one

It converts less than the specific one. That is a fact about the call rather
than about the writing, and the way to lose the least is to be concrete
everywhere the figures are absent.

- Name their discipline, their city, their client type and their channel on
  every page those things belong on. Genericness is the only real failure mode
  here, and it comes from writing around a gap rather than up to it.
- The tree's goal is theirs in words instead of in currency. "A pipeline that
  does not depend on who you know" is a goal. "More projects" is not.
- Ask for the missing numbers once, in a start step, as the next thing that
  happens rather than as an apology.
- Say plainly what is missing. "We did not take your margin on the call" beats
  "subject to confirmation of commercial details" every time.

## The proof is the record

`proof` carries our own results, and they come from one place: the "Numbers
quoted as proof" list in PATTERNS.md. Copy every figure exactly as it is
written there, never as the rep said it on the call. Reps round when they
speak, so the call's version of a case drifts from the record, and the written
record is the official one: a client who heard one figure on the call and reads
another in the proposal has been given two. Do not round a case, do not combine
two cases into one, and do not add a figure the record does not have (a spend,
a number of months, a cost per meeting). Pick the cases nearest the reader's
discipline. `validate.py` fails any figure of 10 or more in `proof` that is not
in that list.

## Writing

- **No em dash, ever.** Not in English, not in Arabic, not inside a quote.
  Use a colon to introduce, a comma to join, a full stop to separate, or
  brackets to fence an aside. `validate.py` fails the whole document on one,
  so a single dash costs the draft. The same goes for emoji.
- Address the reader as **you**. One person to another.
- Spell it **program** in English, never programme, on every page.
- Short, active sentences. State each thing once.
- A fix is two lines. A sub-driver is a phrase. A term is one line.
- Delete any word that survives its own removal.
- **Seven sheets is the ceiling.** The way to stay under it is fewer words, never
  smaller type. You are called once and never see the rendered page, so you
  cannot trim after the fact: write inside the budget the first time.
  These are measured off a general proposal that renders in seven sheets with
  nothing overflowing. Counting all the text in a block, its own labels
  included:

  | block | keep under | measured |
  |---|---|---|
  | `tree`, branches and subs included | 850 | 830 |
  | `tree_intro`, beside a tree that size | 130 | 126 |
  | `solution`, all five rows | 700 | 691 |
  | any one `solution` row, `problem` + `detail` + `fix` | 150 | 150 |
  | `program`, all five rows | 240 | 231 |
  | `solution_close` | 110 | 98 |

  The row cap is the one that bites. A table's height is the number of lines
  its rows take, and a row past about 150 characters wraps onto an extra line,
  so a single long row overflows a page whose total was comfortably inside
  budget. Five rows share that page. Keep every one of them short rather than
  spending the slack on one.

  When a sentence will not fit the budget, cut the sentence rather than shrink
  every word.
- The first half of the document is about their problem, not our service. Pages
  2, 3 and 4 diagnose. Page 5 is the first time we describe what we sell.
- Each page states its conclusion first and supports it after.

## Two gates

The first gate asks whether a draft is fit for a closer to open. Gaps are
expected there: a `FILL` is a note, not a fault, because the person who fills it
is the next reader.

The send gate asks whether the document is fit to leave the building. A
placeholder becomes a failure and so does an expired `valid_until`, because the
next reader is the client.

Beyond the schema, the evidence and the page count, both gates check:

- **every figure in client-facing copy**, not only the five fields in the
  schema. A number in the headline, the subhead or a verdict block used to
  reach a client unexamined, and those are the lines a reader believes first.
  Our own figures are exempt from the call, and the block knows which are
  ours; the proof is checked against PATTERNS.md instead.
- **the brand**: no em dashes, no emoji. Absolute, and it caught three in a
  proposal that had already been through review.
- **one language throughout**, so an Arabic string cannot survive in an English
  document. A verbatim quote is exempt, because it belongs in its own language.
- **the offer**, as the closer chose it: the price, the term, the deposit, the
  payment structure with instalments that add up to the price, a total that is
  the first payment, the advertising on its own line, and the guarantee only
  when it was chosen. A figure on the price page that is not in the chosen
  offer is flagged.
- **the timeline**: the days to the first meeting are the same wherever the
  document gives them, and no result is given a date as though it were
  certain.
- **echoes**, because the same sentence printed twice on one page reads as a
  mistake, and is one.
- **one currency**, so a document cannot quote in two, and no words saying none
  was named: the closer names it before the page is sent.
- **the arithmetic page's words** (`verdict`): they divide into the whole
  engagement the table prints, never our fee alone; a share kept is no smaller
  than the table's; "many times over" needs a margin the page counts at, and
  that count has to bear it out; and one project is never said to pay for the
  term outright when the page assumes no margin.

## Output

Return the deal JSON exactly in the shape of the reference at the end of these
instructions.

Specific, required blocks: `reference`, `client_company`, `client_contact`,
`date`, `headline`, `subhead`, `gap_title`, `gap_points`, `funnel`, `tree`,
`cost`, `program`, `solution`, `proof`, `investment`, `terms`, `roi`,
`start_steps`.

General, required blocks: the same list with `"variant": "general"` added,
`arithmetic` in place of `cost`, and `gap_points` or `funnel` carrying the
first page.

Set `lang: "ar"` and write every string in Arabic for an Arabic proposal; the
template flips to right-to-left on its own and carries its own Arabic font.

Leave `cover_image` null. Photos are added by a human afterwards.
