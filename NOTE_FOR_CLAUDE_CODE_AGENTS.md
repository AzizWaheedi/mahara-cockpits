# Build request: three cockpit agents, ClickUp write, and faster pickup

From Faris, the Hermes agent on Aziz's VPS. 2026-09-13.
Companion to NOTE_FOR_CLAUDE_CODE.md, which covers the media buyer playbook.

Aziz wants each cockpit to have its own specialist agent, and he wants the chat
to answer in seconds rather than minutes. Three pieces of work, in the order
they matter.

---

## 1. The speed problem, which is the one he actually complained about

Right now a cockpit question is queued and drained by a cron every five minutes.
Worst case he waits five minutes for an answer that takes twenty seconds to
write. No amount of context fixes that, because the delay is structural.

Two ways to fix it, in preference order:

**Fire on insert.** When a row lands in the chat or ask queue, trigger the
relay immediately rather than waiting for the next drain. In Convex that is a
scheduled function kicked from the mutation that writes the message, with the
existing cron left in place as a safety net for anything the trigger misses.

**Or drop the interval to one minute.** Crude, five times the idle runs, but it
is a one-line change and it takes the worst case from five minutes to sixty
seconds.

The first is the right fix. The second is worth doing today if the first is not
quick.

---

## 2. ClickUp write from inside the cockpits

The media buyer agent currently tells people it cannot edit ClickUp. That is
correct today: `.env.example` documents `CLICKUP_API_TOKEN  # ClickUp
reads/writes`, but there is **no ClickUp code in any of the three Convex
backends**. The sync lives in `viktor-side-scripts/sync_cockpit.py`, outside the
apps.

Aziz has now set the key in the Convex env for all three deployments. What is
missing is the module that uses it.

What it needs to cover, at minimum:

- read a task by id, and list tasks in a list
- update a task name and description
- read and write custom fields
- move a task between statuses
- add a comment

The client list is `901816559981` ("Clients - Mahara", 75 tasks). The board is
the source of truth for client offers, which the creative agent depends on.

**One guard rail worth building in.** Do not let the chat agent rename or move
tasks silently. Either require a confirmation step in the UI, or write changes
as comments and let a human apply them. A chat agent quietly editing the board
is how a naming convention becomes unrecoverable, and Aziz has already lived
through ClickUp fields that could not be deleted through the API.

---

## 3. The three agent skills

All three now live in the repo under `hermes/`:

| Skill | Cockpit | What it knows |
|---|---|---|
| `client-launch-campaign` | media buyer | CBO launch structure, Mahara KPIs, diagnostic ladder, lead form construction, Arabic question library, evidence ledger |
| `cockpit-client-success` | client success | 188 approved templates, triage by channel, churn rules, the message checker, the never-invent rules |
| `cockpit-creative-director` | creative | client scripts and VSLs built from the ClickUp offer plus Fathom transcripts, direct response structure, dialect rules |

They share one diagnostic ladder on purpose, because it is one funnel. The
media buyer sees it as CPL and cost per booking, the CSM sees it as speed to
lead and show rate, and they are steps in the same sequence.

Each skill names its own boundaries. The creative agent is explicitly **not**
for Aziz's personal brand, because that uses a different voice and a different
archive, and mixing them produces a Saudi contractor ad that sounds like a
Kuwaiti founder.

Wire each cockpit to load its own skill. They should not load each other's.

---

## 4. What is blocked on credentials, not on code

**GHL returns 403 on every endpoint** with both keys currently stored
(`GHL_API_KEY` and `GHL_B2B_API_KEY`, both 40 chars). Agency and sub-account
endpoints alike. The client success agent is supposed to scan the CRM, and it
cannot until that is fixed.

This matters more than it looks. Speed to lead, follow-up counts and the
disqualified-lead reasons all live in GHL, and those are three of the four
things the CSM diagnostic ladder asks about. Without GHL the client success
agent can advise but cannot check.

Likely causes, in order: the key is a v1 key on an account that has moved to v2
OAuth, or it is scoped to a sub-account that no longer exists. Worth having Aziz
regenerate from the correct location rather than guessing.

**No Convex deploy key on the Hermes box**, so I cannot set env vars, push
functions, or verify what landed. If Aziz provides one I can do the env side
directly and stop handing this back and forth.

---

## 5. Still missing context, flagged so nobody assumes it is there

The **client success bootcamp** on Skool is behind an AWS WAF bot challenge.
Hermes credentials are valid to 2027 but the container is headless, so the
challenge cannot be cleared. Aziz is sending the modules another way. Until
then the client success agent runs on the 188 templates and the SOPs, which is
substantial but is not the bootcamp.

The **offer creation cheat sheet** is on ClickUp, and the creative agent points
at the board for it. Once ClickUp write lands, confirm the agent is reading the
right field rather than the task description.
