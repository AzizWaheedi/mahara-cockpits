# Follow-up agent, phases 0 and 1: what the desk built, and what the rest of the build must add

Desk lane, branch `lc-desk`, 3 October 2026.

The desk side is built and tested. The sales-api side and the database side are not built. This file lists, for the integration stage, every action, setting, check, table and cron line those sides need, in the names the desk already uses. Nothing here was deployed, and nothing was written to production.

## 1. What the desk does now

### Phase 0 (`desk/followups.py`, `desk.py`)

**1. A reply is no longer missed when the conversation's last message is ours.**
- `pick` takes every lead who wrote in the last 48 hours as a reply candidate. A send from the cockpit after their message hides the reply only when it answers on a matching channel.
- `run` then reads the thread (`reply_answered`). Neither of these counts as an answer:
  - a HighLevel automation's message;
  - an email to a lead who wrote on WhatsApp.
- `close_gone` no longer closes a WhatsApp reply draft because an email went out after it.

**2. The brief is fitted, never cut from its end.**
- `brief(ctx)` returns whole JSON of at most 24,000 characters.
- The newest 20 messages always stay in it.
- Older summaries, research and notes shrink first, then the words of older messages.

**3. `after_call` reads the B2B rule.**
- A demo counts as held when it was marked showed, or is still confirmed once it has started. A demo marked invalid never counts.
- A "Demo 2" call (`NDBNz6Og4yfpdpWmHrue`) counts as a demo even when its row has no `call_type`. `with_kinds` reads the `calendars` setting for this.
- A longer cadence in the settings widens the kind's window (`window_days`).

**4. The `--contact` test path.**
- Command: `desk.py followups --contact ID [--segment KIND]`.
- It drafts only for a contact tagged `cockpit-test`, and touches no other lead's rows.
- It never sends by itself and writes no status row.
- `--segment` drafts that kind's first message whether or not one is due.
- A test contact on do-not-disturb still gets its draft, and the draft says so. This is the refusal test: sales-api must refuse the send.

**5. The stop rule.** The agent never sets do-not-disturb.
- **Explicit unsubscribe** ("stop", "unsubscribe", "remove me", «احذف رقمي», «وقفوا الرسائل», «لا تراسلني»):
  - the desk writes a `cockpit_sales_followup_stops` row with `state='asked'`;
  - the agent stays silent for that lead until a rep answers.
- **Any other stop word** ("not interested", «لا تتصل», «مو مهتم»):
  - the desk writes a row with `state='paused'`;
  - `paused_until` is the lead's message time plus 30 days (`followups.stop_pause_days`).
- **Lifting it:** a later message from the lead without a stop word lifts either one. So does a rep's `resumed`.
- **The rep's own pause:** a row with `kind='manual'`, `state='paused'` and a future `paused_until` holds every kind.
- **If the stops table cannot be read,** the thread's words still decide. The run says so on its status row.

**6. `doctor --cron` (hourly).**
- The model is asked for one token (`model_probe`, a 30-second timeout). There is no model list and no stream test.
- Nothing is rendered.
- Every check runs inside a guard, so a check that breaks becomes a row and never crashes the doctor.
- With `--quiet` and nothing wrong, it prints nothing.
- It writes two status rows:
  - `(sales-desk, doctor)`: "ready", or "blocked: …", followed by "; not known: …" for any required check that could not answer;
  - `(sales-desk, model)`: "opus answered", or the reason followed by "Not answering since YYYY-MM-DD HH:MM UTC". That time is kept while the model stays down.
- It also checks the agent tables, the WhatsApp gate and the opener templates, and states each one plainly. None of these blocks the other jobs.

**7. An honest follow-ups row.**
- Every real run probes the model first.
- When the probe fails, the run still does its housekeeping and counts who is due. It asks no model.
- The status row is then `ok=false`, reading "No drafts can be written: <reason>. N leads are due and wait". It is never "0 drafts written" as if all were well.

**8. The desk's own WhatsApp sends.**
- `autosend` of a `whatsapp` or `whatsapp_template` draft waits for a person while either of these holds:
  - `whatsapp_guard.connector_off` is not `true`;
  - `single_copy_ok_at` is not a time.
- A first message (touch 1, not reply or confirm) is not sent by itself outside 09:00 to 18:00 on the lead's clock (`followups.first_hours`).

**9. Races.** A draft refused by the one-open-draft index counts as `raced`, never as a failure.

**10. `reactivate`.**
- It is a kind: `SEGMENTS` and `GOAL` include it.
- Its openers never count toward `followups.per_day` or `per_run`.

### Phase 1 (`desk/waves.py`, `desk.py waves`)

**Pools** (`pool_of`). Leads are contacts with a ROAS tag. Each lead falls into the first pool that fits:
1. `no_show_cancelled`: the latest call was missed or cancelled.
2. `unclosed_demo`: the latest call held under the B2B rule was a demo, and there is no deal.
3. `good_intro`: the latest held call was an intro, with no demo after it.
4. `never_booked`: no intro or demo was ever booked.

Nobody is in a pool if any of these holds:
- a kept call is still to come;
- there is a deal;
- the contact is tagged client or is a customer;
- the opportunity is won;
- the latest call was marked invalid.

A lost opportunity stays in its pool, because reactivation exists for those leads. Untagged and not-ready contacts are never in a pool.

**Holdout.**
- A lead is held back when the first 32 bits of `sha256('waves:'||contact_id)`, as a fraction, fall below `holdout_share` (0.1).
- The salt comes from `followups.waves.salt`.
- A lead held back by a running wave is never taken by another wave.

**Enrolment.**
- A running wave's pool is enrolled once.
- Every lead in it becomes a member: either `arm='wave'` with `state='waiting'`, or `arm='holdout'` with `state='held_out'`.
- `event_at` records when the lead entered the pool, for newest-first ordering.
- A lead open in another running or paused wave is skipped, and so is a lead sent an opener in the last 30 days.
- An empty pool sets the wave to `done`.

**The day's batch** (`draft_day`). It runs on working days from 09:00 Kuwait time. Nothing is written while any of these holds:
- the gate is shut;
- an earlier day's wave openers still wait for approval;
- the opener templates are not set up.

Otherwise:
- at most `waves.per_day` (40) openers are written across running waves;
- waves are served in the pool order above, newest first, each wave capped by its own `per_day`.

Each opener is a `reactivate` draft:
- channel `whatsapp_template`, with `template_key` set to `opener_ar` or `opener_en` by the lead's language;
- `body` is the rendered opener; no model is asked;
- it has a `followup_meta` row carrying `wave_id`;
- `why` reads "Backlog wave, …: the CEO's opener, no AI text. …".

Leads are left out of the batch for these reasons:

| Reason | Effect |
|---|---|
| WhatsApp do-not-disturb, no phone in HighLevel, no first name, a stop word, wrote in the last day, no longer in a pool | Excluded, with `excluded_reason` |
| A HighLevel automation or a rep wrote lately, another draft is open, HighLevel unreadable | Waits for another day |

A run that stopped after writing a draft adopts that draft on its next run.

**Members follow their drafts** (`sync`).

| Draft becomes | Member becomes |
|---|---|
| sent | `sent` |
| skipped | `excluded` ("A rep skipped the opener.") |
| failed | `failed` |
| expired | `waiting` again, so no lead leaves the wave without a message |

**Pacing** (`send_due`). The desk sends an approved batch through sales-api `followup.send_due`, one draft at a time:
- at least `batch_gap_s` (45 seconds) apart, measured from the desk's own last send, including across runs;
- only between 09:00 and 18:00 on the lead's clock, and never on their day off;
- never while the draft is held;
- never on WhatsApp while the gate is shut;
- never once the desk has sent 20 messages in 10 minutes. The ceiling is 30, and 10 slots are left for the demo chat's tick.

A run stops in any of these cases:
- a refusal that holds every send (`hold_all`, a 429 or 503, the day's templates, a WhatsApp pause, the wallet);
- three refusals in a row;
- sales-api does not answer;
- its time budget (270 seconds) runs out.

**Status row:** `(sales-desk, waves)`, one plain line. `ok=false` when a running wave cannot move for a setup reason: the gate, the templates, or the HighLevel key.

`desk.py waves --pools` counts each pool and its holdout and writes nothing.

## 2. Database: migration `20261003c_sales_followup_agent.sql`

Copy `20261002e_sales_client_forms.sql`:
- RLS on, with seat read through `cockpit_sales_seat()`;
- revoke from public, anon and authenticated;
- grant select to authenticated and all to service_role;
- `notify pgrst` at the end.

The desk reads and writes these exact names.

**`cockpit_sales_followup_waves`** (spec P3 §6, plus the states the desk reads)

| Column | Definition |
|---|---|
| `id` | uuid pk default gen_random_uuid() |
| `pool` | text not null, check in (`no_show_cancelled`, `good_intro`, `unclosed_demo`, `never_booked`) |
| `segment` | text not null default `'reactivate'` |
| `per_day` | int not null default 40, check 0..200 |
| `holdout_share` | numeric not null default 0.1, check 0..0.5 |
| `state` | text not null default `'draft'`, check in (`draft`, `running`, `paused`, `done`) |
| `created_by` | text |
| `started_at` | timestamptz |
| `created_at` | timestamptz default now() |

One running wave per pool: a unique index on `(pool) where state in ('running','paused')`.

**`cockpit_sales_followup_wave_members`**

| Column | Definition |
|---|---|
| `wave_id` | uuid references waves on delete cascade |
| `contact_id` | text |
| `arm` | text check in (`wave`, `holdout`) |
| `state` | text not null default `'waiting'`, check in (`waiting`, `held_out`, `drafted`, `sent`, `excluded`, `failed`) |
| `followup_id` | uuid null |
| `event_at` | timestamptz |
| `added_at` | timestamptz default now() |
| `drafted_at` | timestamptz |
| `excluded_reason` | text, check length ≤ 300 |

- Primary key: `(wave_id, contact_id)`.
- "One running wave per contact": a unique index on `(contact_id) where state in ('waiting','held_out','drafted')`. The desk falls back to inserting one by one when a chunk hits this index.
- Indexes:
  - `(wave_id, state, event_at desc)`;
  - `(wave_id, drafted_at)`;
  - `(state, drafted_at)`.

**`cockpit_sales_followup_meta`** (spec P3 §6)

| Column | Definition |
|---|---|
| `followup_id` | uuid pk references `cockpit_sales_followups(id)` on delete cascade |
| `kind_key` | text |
| `wave_id` | uuid null |
| `send_after` | timestamptz null |
| `held_by` | text |
| `held_at` | timestamptz |
| `approved_by` | text |
| `created_at` | timestamptz default now() |

- Add the spec's other columns as well: `level_at_draft`, `intent`, `edit_ratio`, `live_id`, `room_id`, `crm_note_id`, and the outcome times.
- Index: `(send_after) where held_by is null and send_after is not null`.

**`cockpit_sales_followup_stops`** (new, and not in the specs; the stop rule needs a home)

| Column | Definition |
|---|---|
| `contact_id` | text |
| `said_at` | timestamptz: the lead's message time, or the time a rep paused |
| `kind` | text check in (`unsubscribe`, `pause`, `manual`) |
| `said` | text, check length ≤ 200 |
| `state` | text check in (`asked`, `paused`, `dnd`, `resumed`) |
| `paused_until` | timestamptz |
| `created_by` | text default `'sales-desk'` |
| `created_at` | timestamptz default now() |
| `decided_by` | text |
| `decided_at` | timestamptz |

- Primary key: `(contact_id, said_at)`.
- Index: `(contact_id, said_at desc)`.
- Seat read can be the owner's or the manager's, as with followups.

**Check constraints.** These belong to the hooks migration `20261003b`:
- `cockpit_sales_followups_segment_check` gains `reactivate`, and `good_intro` for phase 2.

**Template rows.** Insert `cockpit_sales_wa_templates` rows `opener_ar` and `opener_en`, inactive with no workflow until the CEO's templates are approved:
- `opener_ar` preview: `السلام عليكم {{1}}، معاك {{2}}. كيف حالك؟`
- `opener_en` preview: `Hi {{1}}, it's {{2}} from Mahara Media. How are you?`
- variables `{first_name, rep_name}`, segments `{reactivate}`.

The desk refuses an opener route that asks for a `line`.

## 3. Settings

**`followups`.** Add these keys; the desk reads them with safe defaults:
- `waves {"per_day": 40, "holdout_share": 0.1, "batch_gap_s": 45, "salt": "waves"}`
- `first_hours [9, 18]`
- `stop_pause_days 30`

**Fix needed:** `followupSettings` (`index.ts`, near 2050) rebuilds the setting from a fixed list of keys. One manager save would drop `waves`, `first_hours`, `stop_pause_days` and every other new key. It must:
- keep the keys it does not edit (`...before`);
- validate `waves` with the desk's bounds: `per_day` 0..200, `holdout_share` 0..0.5, `batch_gap_s` 30..3600.

**`whatsapp_guard`.** Add:
- `connector_off: false`
- `single_copy_ok_at: null`
- `dup_window_s: 60`
- `template_budget_usd_month: 100`

**Same fix needed:** `whatsappGuardSave` (near 1470) also rebuilds from three keys and would drop all four.

Only a manager action may set `connector_off`, for example `whatsapp.connector {off: true}`, with an audit row. `single_copy_ok_at` is set by the single-copy test. The desk treats anything other than `connector_off === true` together with a parseable `single_copy_ok_at` as shut.

## 4. sales-api actions phase 1 needs

Every write leaves an `audit` row. Seat actions go through the seat gate; manager actions call `needManager`.

| Action | Door | Does | Refuses |
|---|---|---|---|
| `followup.wave {request_id, op: start\|pause\|resume\|stop, pool?, per_day?, wave_id?}` | `ACTIONS`, manager | `start` inserts a wave (`state='running'`, `started_at=now`); `pause`/`resume` flip `running` and `paused`; `stop` sets `done`. The desk enrols on its next run, within 5 minutes. | `start` while the gate is shut, with the gate sentence. A second running wave on the same pool. An unknown pool. |
| `followup.batch {request_id, wave_id \| ids[]}` | `ACTIONS`, owner of every draft, or manager | For each open `reactivate` draft in the batch (status `draft`), sets `meta.send_after = now + i × batch_gap_s` and `approved_by`. Returns `{count, first_at, last_at}` for "Approved. One goes every 45 seconds, finishing at 09:20." | Gate shut. Drafts that are not open. More than 40. |
| `followup.hold {id}` / `followup.unhold {id}` | `ACTIONS`, owner or manager | Sets or clears `meta.held_by` and `held_at`. The desk re-reads the hold just before each send. | |
| `followup.send_due {id}` | `DESK_ACTIONS` (service key; `who` is `sales-desk`) | Loads the draft and its meta. Requires `send_after <= now`, `held_by` null and status `draft`. Then calls `sendFollowup(who, f, {}, auto=false)` with `decided_by` set to `meta.approved_by`, the person who approved the batch. Returns `{followup, message}`. | (1) WhatsApp while the gate is shut: `{error, hold_all: true}`. (2) Outside `first_hours` on the lead's clock, or a Friday: a 409 without `hold_all`. (3) The paths `sendTemplate` and `sendFollowup` already refuse, where every global one must carry `hold_all: true`: the messaging switch off, `templates_per_day` reached, the `whatsappHealth` pause, the sender ceiling (429), and a HighLevel wallet or "funds" error. |
| `followup.stop_task {contact_id, said_at, answer: dnd\|pause\|resume}` | `ACTIONS`, owner or manager | `dnd` writes HighLevel do-not-disturb for WhatsApp only (`PUT /contacts/{id}` with `dndSettings.WhatsApp.status=active`) and sets `state='dnd'`. `pause` sets `state='paused'` and `paused_until = now + stop_pause_days`. `resume` sets `state='resumed'`. All of these set `decided_by` and `decided_at`. | |
| `followup.pause_lead {contact_id, until?}` / `followup.resume_lead {contact_id}` | `ACTIONS` | The lead-page switch "Pause the agent for this lead": inserts a stops row with `kind='manual'`, `state='paused'`, `said_at=now` and `paused_until`. The desk honours it for every kind. | |

The desk calls `send_due` with `{"action": "followup.send_due", "id": ...}`. It treats these as stopping every send:
- `hold_all: true`;
- HTTP 429 or 503;
- an error naming the day's templates, the switch, a pause, the wallet, funds, the 30-message ceiling, or the single-copy test.

Anything else is a refusal for that lead only.

## 5. Checks to add to code that already exists

**1. Hooks (shared files).**
- `lib.ts:657` `FOLLOWUP_SEGMENTS` gains `reactivate`, and `good_intro` in phase 2.
- `FollowupsPage.tsx:119` `SEGMENT` gains the label "Backlog opener".
- `followupSettings` must keep `autosend.reactivate` false. Openers go only by batch.

**2. `sendFollowup`.**
- **First-message hours.** Add the rule for touch 1 when the segment is not reply or confirm: the lead's hour must fall within `first_hours` [9, 18), otherwise "A first message goes between 9 and 6, their time." Only 9 to 21 is checked today.
- **Fixed openers.** For `reactivate`, the opener cannot be edited: ignore `b.body`, or refuse a changed one. The body is the rendered opener for display, and `templateLine` keeps it on one line.
- **The "conversation moved on" check** counts any newer inbox message. An automation's email sent after a WhatsApp reply draft therefore expires the draft. Align it with the desk:
  - ignore outbound emails when the draft is for WhatsApp;
  - ignore HighLevel `workflow` messages that are not the cockpit's own.

**3. `followupAutosend`.** Refuse WhatsApp while the gate is shut, as the desk already does, so both doors agree.

**4. Per-source health (H5).** `cockpit_sales_messages.source` stays `followup` for waves (spec P3). To pause waves without pausing confirmations, health for waves must be counted over messages whose `followup_id` has a meta row with a `wave_id`, or over the `reactivate` segment.

**5. Watchdog** (`cockpit_sales_watchdog()`, consistency doc §1.7). Add:

| Status row | Alert |
|---|---|
| `(sales-desk, waves)` | after 15 minutes during working hours (cron every 5 minutes) |
| `(sales-desk, model)` | when `ok=false`, using the row's "Not answering since … UTC" time in the Slack line |
| `(sales-desk, doctor)` | after 75 minutes (hourly cron) |

The followups row now reads `ok=false` with "No drafts can be written: …" while the model is down.

## 6. VPS cron lines and runbook rows

These lines are not added to the README, which is a shared file with a hand-off window. The format follows `README.md` "Cron".

```
5 * * * *    flock -n $HOME/.sales-desk/doctor.lock bash -c "cd $HOME/mahara-cockpits/hermes/sales-desk && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; . $HOME/.sales-desk/env; set +a; python3 desk.py --quiet doctor --cron" >> $HOME/.sales-desk.log 2>&1
*/5 * * * *  flock -n $HOME/.sales-desk/waves.lock bash -c "cd $HOME/mahara-cockpits/hermes/sales-desk && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; . $HOME/.sales-desk/env; set +a; python3 desk.py --quiet waves" >> $HOME/.sales-desk.log 2>&1
```

`followups` stays at :07 and :37. A wave run is bounded to 270 seconds, so `flock -n` never stacks runs.

**Runbook rows** for `RUNBOOK.md` "sales desk":

| Symptom | Fix | Owner |
|---|---|---|
| "No drafts can be written: The Claude sign-in on the VPS has lapsed" | SSH to the VPS as the CEO, run `claude`, then `/login`. Drafting resumes at the next :07 or :37. | The CEO |
| Waves row says "WhatsApp sends from the desk are off until the WA Connector is off and the single-copy test passes." | Uninstall the WA Connector. Send one template to the second test contact and see exactly one message. A manager then marks both in the cockpit. | The CEO |
| Waves row says the opener templates are not set up | Create `opener_ar` and `opener_en` in HighLevel, each with a one-step workflow with "Allow re-entry". A manager saves the routes under Follow-ups, WhatsApp library. | The CEO, then a manager |
| A stop word left a lead waiting | Follow-ups page, stop task: "Yes, stop WhatsApp" or "No, pause the agent for 30 days". | The setter or the closer |
| Testing the agent | `desk.py followups --contact <cockpit-test id> --segment no_show`. The draft says when do-not-disturb is on. Approving it must be refused. | The build lead |

## 7. What was verified, and what was not

**Verified:**
- Desk tests: `python3 -m unittest` from `hermes/sales-desk`. All tests pass, the 285 that existed before included.
- **Pool logic against real data.** On 3 October, read-only, the desk's own `pool_of` ran on the live mirror: contact ids, tags, statuses and call times only, deleted after use. Results for the 1,429 ROAS-tagged leads:

| Pool | Desk count | Spec count | Held back by the desk |
|---|---|---|---|
| No-shows | 438 | 438 | 61 (11.6%), with cancellations |
| Cancellations | 87 | 87 | (included above) |
| Never booked | 365 | 364 | 42 |
| Unclosed demos | 227 | 220 | 26 |
| Good intros | 179 | 161 | 26 |

  The no-show and cancellation counts are an exact match.
  - Of the good intros, 62 rest on a still-confirmed intro under the B2B rule.
  - Of the unclosed demos, 127 rest on a still-confirmed demo.
  - Why good intros and unclosed demos differ from the spec is UNVERIFIED. The spec's counting date or filter may differ.
  - The holdout share is 11.96% overall (155 of 1,296), against an expected 129.6 ± 10.8.
  - The remaining 133 leads are out for these reasons: 83 have an invalid latest call, 15 have a deal, 5 are tagged client, and 30 are other cases (for example, a past call never marked or confirmed).

**Not verified (no network, nothing deployed):**
- The real `followup.send_due` contract. The desk was tested against a fake that follows section 4.
- The HighLevel `PUT` for WhatsApp-only do-not-disturb.
- That PostgREST accepts `order=event_at.desc.nullslast` and `context->>wave_id=not.is.null` on these tables. Both are standard PostgREST syntax.
- The opener template text and its Meta category.
