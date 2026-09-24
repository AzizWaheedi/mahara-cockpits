# Sales cockpit: plan

For Mahara's own B2B setters and closers. Written 2026-09-24 from Aziz's brief
and nine research reports (scripts, dialer, Scout and the AI proposal, CRM and
data, platform, calls, forms and assets, lead context, and a gap check). The
reports are in the session scratchpad; the facts below were read from the live
systems unless marked **unverified**.

Aziz: *"I want this to be absolutely perfect ... a really solid backend ...
feed into the rest of our data for the rest of the cockpits, the CEO cockpit."*
Sales is being turned back on and the team is being hired.

---

## 1. What the cockpit is

One place a setter or closer works from, all day:

1. **Today**: the next call, today's appointments with a brief for each, the
   appointments still to mark, hot leads due, follow-ups waiting for approval,
   and today's numbers against the goal.
2. **The dialer**: a power queue over the sales sub-account, one lead at a
   time, call through Maqsam, save the outcome, next lead.
3. **The call**: the guided script (setter intro or closer demo), word for word
   or bullets, English or Gulf Arabic, with the notes captured step by step.
4. **The lead**: everything known about one person: the ad they came from
   (preview), the funnel and their form answers, every call, WhatsApp and email,
   the notes, the AI brief, their objections, the assets and references to send,
   the proposal, the next step.
5. **Follow-up**: AI-drafted WhatsApp and email the rep approves and sends; a
   pipeline board; a hot list with next dates and the last objection.
6. **Numbers, goals, pay**: each rep's scorecard, weekly and monthly goals with
   projection, and their commission statement.
7. **EOD**: pre-filled from the day, written to the same sheet and Slack channel.
8. **Coaching**: a review of any call on request, and a weekly and 30-day read
   of what prospects ask, object to, feel and expect (which marketing reads too).
9. **Key links**: pitch deck, calculator, New Client Form, proof pages, asset
   library, client references by situation.
10. **Proposals**: the AI proposal drafted from the demo call, in our system.

The CEO cockpit reads all of it: dispositions, rep scorecards, goals against
actuals, commissions, call quality and objection trends.

## 2. What already exists, and what we do with it

| System | What it is | Decision |
|---|---|---|
| **Power dialer** (dialer.maharamedia.com, v0.7.22, 550 tests, Codex) | The call centre's queue, Maqsam calling, booking, ad preview, call-gap metrics | **Port its tested logic** (queue tiers, phone rules, claims and locks, Maqsam client, booking readback, call gap) into the sales cockpit as TypeScript with its tests. It cannot run the sales sub-account as is: its pipelines, calendars, login and Sheets registry are built for clients, and its login role locked four people out of the cockpits on 19 Sep. The client dialer stays untouched. |
| **B2B database** (Muhammed's, synced from HighLevel every 15 min) | leads, calls, closed_deals, maqsam_calls, sales_reps, `b2b_window_metrics`, `b2b_rep_scorecard`, `b2b_action_queue`, the 203-asset library | **The numbers source.** Read only; no second definition of any rate. Calls and dispositions match HighLevel exactly (1,465 of 1,465 checked). |
| **HighLevel** sub-account 7NI8yyJtwsh2OOWA5Icr | Contacts, the 2-Call pipeline (18 stages), 4 intro/demo calendars plus Follow Up and Callback, conversations | **The CRM of record.** The cockpit writes appointment status, stages, notes, bookings and messages to it through server actions with an audit row. |
| **Maqsam** | Setters' phone calls, 1,259 with transcripts and summaries | Calls placed from the cockpit (the dialer's client); history and transcripts from B2B `maqsam_calls` and the API. |
| **Fathom** (Aziz's key) | Closers' demo recordings: 1,145 visible, transcripts, summaries | Read directly by the worker (the B2B sync has been refused since 12 Sep). |
| **AI proposal** (Mahara-B2B `proposals/`, run by Scout under Muhammed) | Call → two model calls → validated deal JSON → A4 HTML/PDF | **Brought into this repo and run under our account** (Aziz, 24 Sep). Same rules and validator. |
| **Scout** (Muhammed's Hermes agent) | 08:00 demo board in #sales-ai-notes, per-closer Docs, the closer-audit rubric | Its 16-section brief becomes the lead page's AI brief; the board can retire once reps use the cockpit. |
| **Vince** (Aziz's coaching agent, `/opt/data/bibi/agents/vince`) | 197 transcripts, 121 reviews, 98 objection records, intro /100 and demo /150 rubrics | **The training agent's knowledge.** |
| **Scripts** (two Google Docs, EN and Gulf AR tabs) | Intro framework (6 stages) and sales framework (13 stages), objection playbooks, FAQs | Imported once into versioned tables; the intro doc parses from its highlighting. |
| **Forms and EOD** (Typeform, Make, EOD sheet `1EhPp7x0…`, #eods-salesreps) | New Client Form drives onboarding; EODs to the sheet and Slack | Onboarding chain kept; EOD written by the cockpit into the same sheet and Slack format. |
| **Cockpit platform** | Portal sign-in, the editor's Supabase session swap, CEO kit, commission rules, payment attribution, goals, ad previews | Reused: the new app is built like the editor cockpit. |
| **Obsidian** | Aziz's VPS already syncs calls into his vault | Not part of this build (Aziz, 24 Sep). |

## 3. Architecture

```
  cockpit.maharamedia.com/sales/  (React, CEO kit, installable on phones)
        │  signed in through the portal (a pass swapped for a Supabase session)
        ▼
  Creative Triage (Supabase)                       B2B (Supabase, read only)
  ├ cockpit_sales_* tables, row security  ◄──────  leads, calls, deals, maqsam,
  │  per seat and per rep                          scorecard and window functions,
  ├ Realtime: the queue and alerts                 asset library
  └ Edge Functions: every write
        │  disposition, stage, note, booking, send, claim, dial
        ▼
  HighLevel (CRM of record) ── webhooks ──► Edge Function: new lead, reply,
  Maqsam (calls)                             booking, status change
        ▲
  VPS worker hermes/sales-desk (cron under flock, doctor, tests, status table)
  ├ transcripts in: Fathom (every rep) and Maqsam
  ├ after each call: notes filled from the transcript (the rep confirms),
  │  objections, the setter-to-closer brief, the review score
  ├ proposals (the engine, brought over), follow-up drafts, lead research
  ├ weekly and 30-day "what prospects say" digests
  └ EOD fan-out (the existing eod-out), disposition reminders
```

**Why this shape.**
- **Supabase, not Convex.** The standing rule is Supabase-first, and a dialer
  queue re-read every few seconds is exactly the load that shut Convex down
  twice in September. Realtime pushes changes instead of polling.
- **HighLevel stays the record** for contacts, appointments and stages, so the
  B2B sync, the CEO cockpit and Muhammed's dashboard move together. The cockpit
  keeps who did what and why (audit, script notes, claims).
- **Every write is a server action** checking the seat and the rep's ownership
  of the lead (every HighLevel user is an admin, so HighLevel cannot enforce it).
- **Two-minute speed to lead needs events, not hourly copies.** One HighLevel
  workflow step posting to our Edge Function (a webhook; the API cannot create
  workflows, so it is added once in the HighLevel builder), with a one-minute
  reconciliation read behind it.
- **AI and slow work run on the VPS**, as the editor desk and radar do. It is
  never in the browser, and it never sits between a click and its result.

**Tables** (Creative Triage, prefix `cockpit_sales_`, row security and grants in
the same migration, every write audited in `cockpit_audit_log`):
`people` (seat, role setter/closer/both, GHL user, Maqsam agent, Fathom email,
Slack id), `attempts` and `claims` (one open attempt per lead and per rep),
`dispositions`, `notes` (script captures, versioned), `briefs`, `hotlist`,
`followups` (draft, approved, sent, delivery status), `goals`, `eods`,
`proposals` (versions, validation, FILLs, PDF, sent), `reviews`, `insights`
(objections, pains, questions per call), `research`, `references`,
`asset_sends`, `scripts` with `script_steps`, `script_lines`, `script_branches`,
`script_fields`, `events` (webhook intake), `requests` (the worker's queue),
`worker_status`.

## 4. The screens

**Today.** Next call, today's appointments (each with its brief), the red list
of past appointments not yet marked, hot leads due, follow-ups to approve, and
today's numbers against goal.

**Dialer** (setters first; closers can use it for follow-ups):

| Tier | Setter | Closer |
|---|---|---|
| 0 | New lead or reply in the last 10 minutes; callback due; missed call | Reply from one of their demo leads; unconfirmed demo within 2 hours |
| 1 | New Lead, Hot Leads, Intro Call REQUESTED | Showed, didn't close; follow-up booked |
| 2 | Intro no-show; cancelled intro to rebook | Demo no-show; demo cancelled |
| 3 | Short Term Nurture | Long Term Nurture |

Past appointments not marked block the queue until they are marked. The retry
ladder (e.g. twice on day 1, then day 2 and 3 at 09:00, then unreachable)
lives in cockpit tables, not new HighLevel stages. The playbook's rules are the
defaults: call new leads twice at once, confirm 2.5 hours and 60 minutes
before, book the demo within the hour. Click to call with auto-advance, as the
dialer does today.

**The call.** Three panels: the lead on the left, the guided script in the
middle, controls and outcome on the right. The script shows the stage, its
goal and a timer against its time budget, then the line with the lead's details
filled in, word for word or bullets. Answer chips choose the branch, capture
fields sit beside the question that produces them, and each stage's exit
checklist gates Next. Objection handles, FAQs, proof for this lead and the
calculator open on the side. Price, guarantee and contract lines never reach the
setter's screen. What the setter captured pre-fills the closer's script, so the
demo never re-asks it.

**The lead.** Header (name, company, country, stage, owner, temperature), the
exact ad with its preview even if the ad is gone, the funnel and form answers,
one timeline (calls with recordings and summaries, WhatsApp, email, bookings,
notes), the structured notes, the AI brief, objections, recommended assets and
references, research, proposals and the next step.

**Calendar and dispositions.** My intro and demo appointments. Each past one
must be marked showed, no-show, cancelled, rescheduled or invalid (disqualified,
the existing rule). The mark goes to HighLevel with an audit row, then a banner,
then a Slack DM after a set time. Today 14 of 129 intros and 24 of 40 demos of
the last 30 days are unmarked, and an unmarked past call counts as shown, so
this screen is what makes the show and close rates honest.

**Pipeline and hot list.** The 2-Call board, my cards, drag to move (writes the
stage). The hot list holds leads with a next follow-up date, the last
objection and a temperature, and today's items come first.

**Follow-up.** For a lead, the worker drafts the next message from its context,
templates and the objection. The rep edits and approves; the Edge Function
sends through HighLevel and records delivery. Guard rails: one WhatsApp rail
per lead, a template outside the 24-hour window, do-not-disturb and
unsubscribes respected, Gulf quiet hours, per-lead and per-rep caps, one send
per draft, the lead taken out of automated nurture when a rep takes over, and
Arabic drafted on the frontier model in Aziz's voice.

**Numbers** (from B2B, the same functions as the CEO cockpit):

| Number | Definition | Source |
|---|---|---|
| Booked, due, shown, show rate | Show rate = shown ÷ due; shown = showed, or confirmed or invalid once past | `b2b_rep_scorecard` |
| Qualified rate | (shown − invalid) ÷ shown | calls status |
| Close rate / qualified close rate | Signed ÷ demos shown / ÷ demos qualified | closed_deals, calls |
| Cash per call / per show | Deposits ÷ demos due / ÷ demos shown | closed_deals |
| Speed to lead | Lead created → the rep's first Maqsam call; median, within 5 min, never called; unbooked leads apart | leads, maqsam_calls |
| Dials, connects, talk time, call gap | Maqsam calls per rep, gap in working minutes | maqsam_calls, working hours |
| Disposition compliance | Past calls still unmarked ÷ due | b2b_action_queue |

**Goals and pay.** Weekly and monthly goals in units (booked, shown, closes) and
cash, pace and projection with an on-track chip (the CEO goals engine). The
commission statement uses the person's rule in Team & Payroll and the tested
payment attribution: deposit to the closer, cash confirmed by Whop or the bank,
pending against earned.

**EOD.** Counts pre-filled from the day (dials, conversations, shows, closes,
cash); the rep writes the rest. Written to the same sheet tabs and posted to
#eods-salesreps in the format the EOD Radar reads.

**Coaching.** Send any call for review: a score on the intro /100 or demo /150
rubric (Vince's), what went well, what to fix, with quotes and timestamps. Each
week and each 30 days: the most frequent questions, objections (one vocabulary
shared by scripts, tags and assets), problems and expectations, weighted to the
recent 30 days. The digest also goes to the CEO and creative cockpits.

**Proposals.** On a shown demo, the closer clicks Draft proposal (Arabic or
English). The worker runs the engine on the Fathom transcript, stores the deal
data, validation and FILLs. The closer finishes the FILLs in the document's own
editor, and each save is re-validated. The PDF is made when the gate passes.
Mark sent starts the follow-up. Drafts take about 7 to 11 minutes.

**Key links and references.** Pitch deck, calculator, New Client Form (with the
lead, closer and setter filled in), proof pages, the asset library, and client
references matched by trade, country and project size, with consent recorded.

## 5. Phases

Each phase ships to the live cockpit, gets used, and is checked against a second
source before the next starts.

1. **Foundation.**
   - The app, portal sign-in, seats and the people table (joining GHL, Maqsam,
     Fathom and Slack ids).
   - The B2B read layer.
   - The lead page (ad, funnel, answers, timeline, notes).
   - Calendar and dispositions written to HighLevel, with reminders.
   - Numbers (read only), key links.
   - Reps can sign in, see their leads and mark every appointment.
2. **Calling and scripts.**
   - The queue with claims and locks, Maqsam click to call, outcomes, auto-advance.
   - The HighLevel webhook for new leads and replies.
   - Dials, call gap, speed to lead.
   - The guided scripts (intro and demo, EN/AR, word for word and bullets) with
     capture.
3. **The AI layer.**
   - The sales-desk worker: transcripts in for every rep.
   - Notes filled after each call for the rep to confirm, objection tags, the
     setter-to-closer brief, call reviews.
   - Proposals.
   - Weekly and 30-day digests.
4. **Follow-up and pipeline.**
   - The board, the hot list.
   - Drafted and approved WhatsApp and email.
   - Assets and references per lead, sends logged.
   - Lead research.
5. **Goals, pay, EOD, CEO.**
   - Goals and projections, commission statements.
   - The EOD.
   - The CEO cockpit sections, SOURCES.md rows, the metric registry.
   - The runbook, the health checks.

### Where it stands (2026-09-24)

| Phase | State |
|---|---|
| 1. Foundation | Shipped: the app at /sales, portal sign-in and seats from the Admin page, the B2B copy every three minutes, the lead page, the calendar with marking written to HighLevel, numbers, links. |
| 2. Calling and scripts | Shipped: the dialer (queue, Maqsam click to call by country, outcomes, retry ladder, locks) and the guided intro and demo scripts in English and Arabic with captured answers. Booking from the cockpit is next; reps book in HighLevel meanwhile. |
| 3. The AI layer | Shipped: proposals (hermes/sales-desk, gpt-5 on the VPS key) and the per-rep Fathom index. Next: notes after each call, the setter-to-closer brief, call reviews, the weekly and 30-day digests. |
| 4. Follow-up and pipeline | Replies waiting and callbacks are in; the drafted and approved WhatsApp and email sends, the board, assets per lead and lead research are next. |
| 5. Goals, pay, EOD, CEO | Goals, pace and the pay estimate are in Numbers; the EOD in the cockpit and the CEO cockpit's sales feed are next. |

## 6. Fixes found on the way (outside the build, some for Muhammed)

- **Fathom → B2B sync refused (403) since 12 Sep.** The scheduler still reports
  success. Our worker reads Fathom directly; my webinar objection tagger also
  needs to ask per rep, which I will fix.
- **Intro calendar labels swapped in B2B.** `/booking-intro` embeds
  `dsqmJ393Dwl9fDSbIVOI` and `/booking-intro-uq` embeds `cFeDl0FY8iaXll61lus8`;
  B2B `calendar_call_type_map` says the opposite.
- **Two voided deals are counted again** (Aziz's, 29 Aug, $1,500 deposits,
  $8,000 contracted), re-inserted by the 19 Sep upsert.
- **Rosters.**
  - `sales_reps` still lists people who left.
  - The New Client Form's closer list is out of date.
  - The EOD Radar strikes the paused sales team nightly and misses sales EODs.
- **CEO cockpit reads a deleted EOD sheet** (`eodSheet.ts` uses `1K10In9…`; the
  live one is `1EhPp7x0…`). I will fix.
- **Security.**
  - This session's research printed the Google service-account private key into
    the local session transcript; rotate that key.
  - Two HighLevel tokens are committed in `context/csm_daily_workflow.md`;
    rotate them and I will remove them.
  - The Drive "Sales Calls" folder and its 327 transcripts are open to anyone
    with the link.
  - The sales sub-account token pasted in chat is now in the session transcript;
    rotate it once the build has its own.
- **WhatsApp double sends.** Two unofficial bridges mirror most workflow sends,
  a ban risk.

## 7. Decisions (Aziz, 2026-09-24)

| # | Question | Answer | What it means in the build |
|---|---|---|---|
| 1 | Who gets a seat | "Just let me add them like the main cockpit easily" | A Sales seat on the portal's Admin page, with Setter / Closer / Both / Manager chosen in the same form. Pushed to `cockpit_sales_people`. |
| 2 | Marking a call writes HighLevel | Yes | Today's marks write `appointmentStatus` and run HighLevel's usual automations. Appointments older than 7 days are marked in the cockpit only. |
| 3 | Which AI key pays | The VPS | The worker uses the OpenAI key on the VPS; Anthropic or OpenRouter can be switched in. No lead data to DeepSeek. |
| 4 | The offer | Yes, but flexible: guarantee or not, payment plans | `offer.json` holds the program, a guarantee option and payment plans; the closer picks them per proposal and the validator checks the chosen one. |
| 5 | WhatsApp line | The official line | Follow-ups go out from +965 9005 4963 only. |
| 6 | Maqsam | One seat per rep | Each rep's Maqsam email on their seat; caller ID by the lead's country. |
| 7 | What reps see | Yes | Own numbers plus a team board of rates; nobody sees another's pay. |
| 8 | Pay | Closers: 10% of cash collected on the contract, paid as it is collected, plus a $250 paid-in-full bonus; flexible. Setters differ. | A pay rule per person (`pay` on the seat): cash rate, paid-in-full bonus, per-show amounts. Setters show "no rule set" until one is entered. |
| 9 | Fathom | Yes | Closers share recordings to the team; the worker indexes them per rep. |
| 10 | Forms | Add the hidden fields; EOD in the cockpit | Hidden `contact_id`, `closer`, `setter` on the New Client Form; the EOD is filed in the cockpit and lands in the same sheet and Slack channel. |
