# Diagnosing constraints

A launched campaign is the start of the job. This is how to read it afterwards
and decide what to change, drawn from Mahara's own SOP and the mentor material
behind it.

## Macro before micro

The single most expensive mistake in media buying is fixing a small leak while
the whole system is broken.

| | Macro constraint | Micro constraint |
|---|---|---|
| Broken | the entire system | one step in it |
| Shows up in | ROAS, CPA, cost per booking | CPL, lead to booking, show rate, CTR |
| Caused by | bad offer, wrong messaging | a specific process failing |
| Fixed by | changing the offer or the positioning | a tactical change |

**Only optimise a micro constraint when the macro numbers are healthy.**

If every metric is bad at once, that is not five problems. That is one problem
wearing five costumes, and it is almost always the offer or the messaging
attracting the wrong people. Rewriting ad copy while the offer is wrong is
rearranging deck chairs.

When several things are genuinely broken, pick by **highest impact and most
immediate effect**, not by what is furthest from target.

## The four steps and their benchmarks

Mahara's KPIs, not generic ones:

| Step | Metric | Target |
|---|---|---|
| Generate leads | Cost per lead | under $15 |
| Leads to bookings | Lead to booking rate | 25% or more |
| | Cost per booking | under $60 |
| | Pickup rate | 35% or more |
| Bookings to shows | Show rate on confirmed | 75% or more |
| Shows to closes | Close rate | 20% to 30% |

Find the first step that is below target. That is where the leak is. Do not
start at the end.

## CPL above $15

Work down this list in order. The cheap fixes are first on purpose.

**The offer itself.** Run it through the value equation: dream outcome times
perceived likelihood, divided by time delay times effort. If the offer scores
badly no creative fixes it. Talk to the client about raising perceived value or
lowering friction.

**Creative volume.** Four to eight diverse videos a month, client films raw,
Mahara edits. If talking heads are flat, test B-roll. If B-roll is flat, test AI
video. Stale creative is the most common cause of a CPL that was fine last month.

**Creative diagnostics.** Check the ad for scarcity, a clear CTA, appropriate
length, and correct dialect for the audience. Dialect is the one people miss: a
Najdi ad running in Jeddah reads as foreign.

**Script congruence.** Does the ad say plainly what the client actually sells?
Full renovation and design only are different services, and a prospect who
cannot tell which one is on offer does not tap.

**Performance metrics.** Low stop rate means the hook fails or the audience is
saturated, so change the first three seconds. High CPC means test new creative.
Low CTR means the angle is not landing.

**The lead form.** If CPL is high, remove one or two qualification questions.
Add a greeting card if there is not one. This is the fastest lever available and
it costs nothing.

**Spend.** At least $30 a day or the campaign never exits the learning phase.
Check for account level spending caps Meta may have imposed quietly.

## Leads are cheap but nobody books

CPL under $15 and lead to booking under 25%.

**Check the CRM sync first.** Lead count in GHL must equal lead count in Meta
exactly. If it does not, the integration is broken and everything downstream is
noise. Submit a test lead and watch it arrive.

**Pickup rate under 35%** usually means the outbound number is flagged as spam
or is in the wrong area code. Get a new number for the client.

**Speed to lead.** People are far more likely to answer in the first five
minutes than after thirty. If the call centre is slow, nothing else on this list
matters.

**Follow-up volume.** Contacts should be called through day three, at least four
attempts total.

**Read the disqualified pipeline.** The notes tell you which problem you have.

| Pattern in the notes | Fix |
|---|---|
| Too far away | narrow the radius, or add a location question to the form |
| Wanted a service the client does not offer | the ad is not explicit enough about what is sold |
| Cheap leads, high disqualification | add qualifying questions, or switch the form to higher intent |

That last row is the moment `is_optimized_for_quality` becomes the right lever.
Not before.

## Booking but not showing

Show rate under 75%.

Booking window is the big one. **48 to 72 hours.** Past 72 hours show rates fall
off a cliff. Confirm every appointment, use the provisional calendar for
unverified leads, send a pre-appointment video, and include an accurate Google
Maps pin.

Some causes sit outside the campaign: bad Google reviews, no website, no Google
My Business listing, an office nobody can find. Raise them with the client
rather than absorbing them as a media buying failure.

## Showing but not closing

Close rate under 20%.

This is rarely a traffic problem, but check lead quality scoring before
accepting that. If the client scores leads poorly and consistently, targeting or
qualification needs work.

Everything else here is the client's sales process: same-day quoting, pricing
structure, financing options, presentation quality, objection handling. The
common objections are smokescreens, not reasons, and the client needs training
rather than the campaign needing changes.

## Cadence

**Weekly.** Every Monday, pull the last seven days, compare to target, assign one
action item with an owner and a date. Speed matters more than depth here.

**Monthly.** A full audit: macro metrics, month over month trends, call reviews.
This is where offer level decisions get made.

The most common failure is not checking often enough. A constraint found in week
one costs a fraction of the same constraint found in week four.

## The evidence ledger

Everything above is what Mahara believed when it was written. The ledger is what
actually happened. When the two disagree, the ledger wins.

`scripts/learn.py` keeps it, one JSON line per change, at
`/opt/data/bibi/workspace/mediabuyer/evidence.jsonl`.

### Before you recommend anything

```bash
python3 scripts/learn.py ask "should I cut questions to lower CPL?"
```

If the ledger has scored changes on that lever, lead with them. A real number
from a real client beats a rule every time:

> Cutting the form from six questions to four dropped Monshaat Khaldaa's CPL
> from $34 to $19.50 in seven days. Same lever, same shape of client.

If the ledger is empty on that lever, **say so**. Answer from the playbook and
be clear it is a rule rather than a result. Never dress an untested rule up as
evidence.

### After you change anything

```bash
python3 scripts/learn.py record change.json
```

```json
{
  "client": "Monshaat Khaldaa",
  "lever": "form_questions",
  "change": "cut lead form from six questions to four, removed budget and style",
  "why": "CPL at $34, SOP says remove one or two questions first",
  "metric": "CPL",
  "before": 34.0
}
```

One lever per entry. Two changes at once teaches nothing, because you cannot
tell which one moved the number. If you must change two things, record two
entries and accept that both are unreliable.

Levers, kept to a fixed list so like is compared with like:

```
offer · creative · copy · form_questions · form_greeting · form_quality
radius · budget · cta · targeting · placement · landing
```

### Seven days later

```bash
python3 scripts/learn.py due                        # what needs scoring
python3 scripts/learn.py outcome <id> 19.5          # what happened
```

The verdict is computed, not chosen. Under 5% movement is `noise`, not a win.
Anything else is `worked` or `backfired` depending on direction, and cost
metrics correctly treat down as good.

**An unscored change teaches nothing.** Run `due` weekly, in the same Monday
pulse check as everything else.

### What the ledger proves

```bash
python3 scripts/learn.py report
```

Two thresholds decide when the playbook changes:

**Worked on three or more clients with no failures.** Promote it into the
playbook as a default. It has earned the right to be the standing advice.

**Backfires more often than it works.** The playbook is wrong on that lever.
Correct the text, do not quietly keep recommending it.

That second case is the whole point. A playbook nobody corrects becomes a list
of things that used to be true.

### Recording a backfire

Backfires are the most valuable entries in the ledger, so record them with the
same care as the wins. Then reverse the change and record the reversal as its
own entry, since reverting is itself a change and it also needs scoring.

Nobody logs their mistakes unless the system makes it normal. Make it normal.

## What to tell the client

Report the constraint, not the metric. "Cost per lead is $34" is a number.
"Leads are costing more than they should because the offer asks for a
commitment before it proves anything, so here is what I want to change" is a
diagnosis.

Never present five problems at once. Present the one that matters most, what you
are doing about it, and when you will know if it worked.

Where the ledger has a result, use it. "We cut the form to four questions for
another client and their cost per lead dropped 40% in a week" is worth more than
any amount of reasoning, because it happened.
