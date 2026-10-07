# Follow-up agent, phases 0 and 1: what the desk built, and what the rest of the build must add

Desk lane, branch `lc-desk`, 3 October 2026. Revised the same day after the review pass (27 findings; section 8 lists each with what was done).

The desk side is built and tested. The sales-api side and the database side are not built. This file lists, for the integration stage, every action, setting, check, table and cron line those sides need, in the names the desk already uses. Nothing here was deployed, and nothing was written to production.

## 1. What the desk does now

### Phase 0 (`desk/followups.py`, `desk.py`)

**1. A reply is no longer missed when the conversation's last message is ours.**
- `pick` takes every lead who wrote in the last 48 hours as a reply candidate. A send from the cockpit after their message hides the reply only when it answers on a matching channel.
- `run` then reads the thread (`reply_answered`). Neither of these counts as an answer:
  - a HighLevel automation's message;
  - an email to a lead who wrote on WhatsApp.
- A reply candidate never takes the lead's one place. It carries the lead's next due kind with it (`then`: a no-show, a cancellation, a new lead's step, `after_call`). When the run finds a person already answered, that kind goes on, with every check it would have had. Before this, the other kind was lost for up to 48 hours after the lead's message.
- On the day off (Friday), only a `reply` or `confirm` is carried.
- `close_gone` no longer closes a WhatsApp reply draft because an email went out after it.

**2. The brief is fitted, never cut from its end.**
- `brief(ctx)` returns whole JSON of at most 24,000 characters.
- The newest 20 messages always stay in it.
- Older summaries, research and notes shrink first, then the words of older messages.

**3. `after_call` reads the B2B rule.**
- A demo counts as held when it was marked showed, or is still confirmed once it has started. A demo marked invalid never counts.
- A "Demo 2" call (`NDBNz6Og4yfpdpWmHrue`) counts as a demo even when its row has no `call_type`. `with_kinds` reads the `calendars` setting for this.
- A longer cadence in the settings widens the kind's window (`window_days`).

**4. A completed dial keeps a new lead out of the `new` kind for 24 hours only** (spec P3 §3.2). It used to keep them out for the whole eight days.

**5. The `--contact` test path.**
- Command: `desk.py followups --contact ID [--segment KIND]`.
- It drafts only for a contact tagged `cockpit-test`, and touches no other lead's rows.
- It never sends by itself and writes no status row.
- `--segment` drafts that kind's first message whether or not one is due.
- A test contact on do-not-disturb still gets its draft, and the draft says so. This is the refusal test: sales-api must refuse the send.

**6. The stop rule.** The agent never sets do-not-disturb.
- **Explicit unsubscribe** ("stop", "unsubscribe", "remove me", «احذف رقمي», «وقفوا الرسائل», «لا تراسلني»): the desk writes a `cockpit_sales_followup_stops` row with `state='asked'`. The agent stays silent for that lead until a rep answers.
- **Any other stop word** ("not interested", «لا تتصل», «مو مهتم»): the desk writes a row with `state='paused'` and `paused_until` = the lead's message time plus 30 days (`followups.stop_pause_days`).
- **The rep's own pause:** a row with `kind='manual'`, `state='paused'` and a future `paused_until` holds every kind.
- **What holds a lead** (`hold_of`). The desk reads every row of the lead, not only the newest:
  - a row in `asked` or `dnd` holds;
  - a row in `paused` holds until its `paused_until`;
  - only a rep's `resumed` lifts a row: any row said before the latest resume holds nothing;
  - **a later message from the lead lifts nothing** (spec P3 §4, D21). Before the review, a lead who wrote "stop" and then "ok" was messaged again.
- A stop the cockpit already keeps is decided by its row. A new stop word in the thread is recorded once (one row per lead message) and holds from then on.
- **If the stops table cannot be read,** the thread's words still decide. The run says so on its status row.

**7. `doctor --cron` (hourly).**
- The model is asked for one token (`model_probe`, a 30-second timeout). There is no model list and no stream test.
- `model_probe` never raises. A 200 with an HTML body, a timeout or any other error becomes a sentence.
- Nothing is rendered.
- Every check runs inside a guard, so a check that breaks becomes a row and never crashes the doctor.
- With `--quiet` and nothing wrong, it prints nothing.
- It writes two status rows:
  - `(sales-desk, doctor)`: "ready", or "blocked: …", followed by "; not known: …" for any required check that could not answer;
  - `(sales-desk, model)`, as below.
- **The model row.**
  - An outage (`NotNow`: the sign-in lapsed, the proxy gone, the plan's limit) writes `ok=false` and "Not answering since YYYY-MM-DD HH:MM UTC". That time is kept while the model stays down.
  - When no model client can be made at all (a key not set), the row is `ok=false` with that reason. It used to keep an old "opus answered".
  - **One miss** (a timeout, a body that is not JSON) keeps the row as it was and says "one miss is not an outage, so drafting goes on". The doctor shows it as not known, not as a blocker. **A second miss in a row** writes `ok=false`. So the watchdog's Slack line never blames a lapsed sign-in for one slow answer.
- It also checks the agent tables, the WhatsApp gate, the opener templates and the `reactivate` kind, and states each one plainly. None of these blocks the other jobs. The kind check writes nothing: an opener already in the database proves the kind is allowed, and none yet is "not known".

**8. An honest follow-ups row.**
- Every real run probes the model first, and writes the `(sales-desk, model)` row.
- When the probe finds an outage, the run still does its housekeeping and counts who is due. It asks no model.
- The status row is then `ok=false`, reading "No drafts can be written: <reason>. N leads are due and wait". It is never "0 drafts written" as if all were well.
- A probe that only missed is said on the model row, and drafting is still tried. Each draft has its own retries.

**9. The desk's own WhatsApp sends.**
- `autosend` of a `whatsapp` or `whatsapp_template` draft waits for a person while either of these holds:
  - `whatsapp_guard.connector_off` is not `true`;
  - `single_copy_ok_at` is not a time.
- A first message (touch 1, not reply or confirm) is not sent by itself outside 09:00 to 18:00 on the lead's clock (`followups.first_hours`).

**10. Races.** A draft refused by the one-open-draft index counts as `raced`, never as a failure.

**11. `reactivate`.**
- It is a kind: `SEGMENTS` and `GOAL` include it.
- Its openers never count toward `followups.per_day` or `per_run`.

### Phase 1 (`desk/waves.py`, `desk.py waves`)

**The switch.** While `followups.enabled` is false, the waves job enrols, drafts and sends nothing. Its row says "The follow-up agent is switched off (followups.enabled), so no wave drafts or sends; N waves wait", and is `ok=false` while any wave is running.

**Pools** (`pool_of`). Leads are contacts with a ROAS tag. Each lead falls into the first pool that fits:
1. `no_show_cancelled`: the latest call was missed or cancelled.
2. `unclosed_demo`: the latest call held under the B2B rule was a demo **on a demo calendar** (`jQqXS1YuFnmGZKLkrE62`, `NDBNz6Og4yfpdpWmHrue`, or one the `calendars` setting marks as a demo), at least 24 hours ago, and there is no deal.
3. `good_intro`: the latest held call was an intro **at least 24 hours ago**, with no demo after it ("no demo 24 h later", spec P3 §3.2).
4. `never_booked`: no intro or demo was ever booked.

Nobody is in a pool if any of these holds:
- a kept call is still to come;
- there is a deal;
- the contact is tagged client or is a customer;
- the opportunity is won;
- the latest call was marked invalid;
- the latest held call started less than 24 hours ago.

A lost opportunity stays in its pool, because reactivation exists for those leads. Untagged and not-ready contacts are never in a pool.

**Holdout.**
- A lead is held back when the first 32 bits of `sha256('waves:'||contact_id)`, as a fraction, fall below `holdout_share` (0.1).
- The salt comes from `followups.waves.salt`.
- A held-back member's 14 days start when its place in the newest-first order comes up. When the desk drafts a batch, the held-back members of that wave whose `event_at` is at or after the oldest lead drafted get `due_at = now`. When the wave finishes, any held-back member still without `due_at` gets it then. So both arms are measured over the same days.

**Enrolment** (`enroll`).
- A running wave is enrolled, chunk by chunk, until it carries `enrolled_at`. A run that dies after one chunk is finished by the next (a member already in is left as it is: `on_conflict` with `ignore-duplicates`).
- Every lead in the pool becomes a member: either `arm='wave'` with `state='waiting'`, or `arm='holdout'` with `state='held_out'`.
- `event_at` records when the lead entered the pool, for newest-first ordering.
- A lead is skipped when it is open (`waiting`, `drafted`, `held_out`) in **any** other wave, whatever that wave's state, or was sent an opener (`sent_at`) or measured in a holdout (`due_at`) in the last 30 days.
- Only a 409 or 23505 falls back to one insert per lead. Any other error stops the job, and the row says "The waves job stopped: …". It is never counted as a busy lead.
- A wave nobody can join ends at once (`state='done'`) with a `done_reason` the row repeats: "Nobody to message: nobody is in this pool now", or "Nobody to message: every lead in this pool is already in another wave or had an opener in the last 30 days". It is never tried again every five minutes.

**The day's batch** (`draft_day`). It runs on working days from 09:00 Kuwait time. Nothing is written while any of these holds:
- the gate is shut (the row is `ok=false`);
- an earlier day's wave openers wait for **anyone to decide on them** (no `send_after` and not held). An opener a rep held, or one approved and waiting for the lead's hours, does not block. The row is `ok=false`: "N of an earlier day's openers still wait for approval, so no new batch is written. Approve, hold or skip them on the Follow-ups page.";
- the opener templates are not set up (`ok=false`);
- the database refuses the `reactivate` kind because migration `20261003b` has not landed (`ok=false`, and the member goes back to waiting).

Otherwise:
- at most `waves.per_day` (40) openers are written across running waves, counted from the openers created since midnight;
- waves are served in the pool order above, newest first, each wave capped by its own `per_day`;
- each wave is read page by page until its room is filled or nobody is ready.

Each opener is a `reactivate` draft:
- channel `whatsapp_template`, with `template_key` set to `opener_ar` or `opener_en` by the lead's language;
- `body` is the rendered opener; no model is asked. The name is the first word of HighLevel's first name, as `sendTemplate` fills `{{1}}`, so "Abdul-Rahman" stays whole;
- it has a `followup_meta` row carrying `wave_id`;
- `why` reads "Backlog wave, …: the CEO's opener, no AI text. …".
- **The draft's id is made on the desk** (a UUID). The member is marked `drafted` with that id first, then the draft is inserted. A run that dies between the two leaves a member pointing at no draft, which the next `sync` puts back to waiting. A draft no member points at cannot exist, so no lead gets a second opener. The desk also adopts any opener of the same wave for the lead (`draft`, `sending`, `sent` or `skipped`) before writing one.

Leads are left out of the batch, or looked at again later:

| Reason | Effect |
|---|---|
| WhatsApp do-not-disturb, no phone in HighLevel, no first name, a kept stop (`asked`, `dnd`, a stop-word pause), a new stop word, no longer in a pool | Excluded, with `excluded_reason` |
| Wrote to us in the last 14 days, or since the wave began | Excluded: "They wrote to us lately …: a person answers them, not an opener." |
| The template for their language is not set up | `next_try_at` + 1 day. Checked from the lead copy before HighLevel is read |
| Another draft is open, or another run wrote one | `next_try_at` + 6 hours |
| A HighLevel automation or a rep wrote lately | `next_try_at` = that message + the gap (20 hours) |
| A rep's own pause | `next_try_at` + 1 day |
| HighLevel unreadable | `next_try_at` + 1 hour |

A member with a future `next_try_at` is not read again until then, so the newest leads that wait never hide the older ones, and HighLevel is not read for them every five minutes. `later_reason` says why.

**Members follow their drafts** (`sync`).

| Draft becomes | Member becomes |
|---|---|
| sent | `sent`, with `sent_at` = the draft's `decided_at` |
| skipped | `excluded` ("A rep skipped the opener.") |
| failed, the first time | `waiting` again, `fail_count` 1, `next_try_at` + 20 hours ("the next run may draft again", spec P3 §4) |
| failed twice, or for a reason that will not change (not on WhatsApp, do-not-disturb, opted out) | `excluded`, with the error |
| expired, or missing | `waiting` again, so no lead leaves the wave without a message |

**What the opener did** (`outcomes`), the same for both arms, from `sent_at` (wave) or `due_at` (holdout):
- `booked`: an intro or demo booked after it, within 14 days (final);
- `replied`: the lead wrote after it (still watched for a booking). The inbox copy keeps a conversation's latest message, so `replied_at` is their latest message after the send, not always their first;
- `closed`: 14 days after it with no booking (final), keeping `replied_at` when they wrote.

The wave's effect (spec P3 §9) is the booking rate of every `arm='wave'` member minus that of every `arm='holdout'` member, both by intention to treat (excluded members included), with its range.

**A wave a manager stops** (`state='done'`, from `followup.wave op=stop`) is wound down by the desk within five minutes (`wind_down`):
- its open openers are taken back (`expired`, "The wave was stopped, so this opener was taken back."), so nobody sends them by mistake;
- its `waiting` members, and `drafted` ones whose opener was taken back, are `excluded`;
- held-back members whose turn never came are `excluded` ("not measured");
- members whose opener went, and held-back members whose turn came, are watched to their 14 days;
- this happens before any new wave is enrolled, so a pool started again finds its leads free.

**A wave with nobody left to write to** (no `waiting` or `drafted` member) is set `done` by the desk ("Every lead in the wave has had its opener or left the wave."). A done wave with no member left to let go of or watch gets `settled_at` and is not read again.

**Pacing** (`send_due`). The desk sends an approved batch through sales-api `followup.send_due`, one draft at a time.
- **It reads the open drafts first, then their meta rows.** Meta rows of drafts long since sent never stand in front of today's batch. Before the review, 200 finished rows (five working days) starved every new batch.
- It sends only for a wave that is `running`, read again just before each send. A paused or stopped wave's approved openers are counted as "approved for a wave that is paused or stopped, so not sent".
- It keeps at least `batch_gap_s` (45 seconds) from the desk's last send. The last send is read again after each wait, so a second run (a manual one outside `flock`) cannot close the gap.
- A first message keeps to 09:00 to 18:00 on the lead's clock; a later step or reply keeps to 09:00 to 21:00 (`followups.quiet`). Never on their day off.
- It never sends a draft that is held, or one that stopped being a draft meanwhile.
- It never sends on WhatsApp while the gate is shut.
- It never sends a template once the month's budget is spent (finding 27, below).
- It never sends once the desk has sent 20 messages in 10 minutes. The ceiling is 30, and 10 slots are left for the demo chat's tick.

**How each answer from sales-api is read** (`judge`):

| Answer | Read as | The run |
|---|---|---|
| 200, the follow-up sent | sent | goes on |
| `hold_all`, 429, 503, or words for the day's templates, the switch, a WhatsApp pause, the wallet, funds, the budget, the 30-message ceiling, the single-copy test | hold_all | stops; row red |
| 502, 504, or "HighLevel did not send it" | outage | stops; row red |
| 400, 401, 403, 404, 405, any other 5xx | error (sales-api itself) | stops; row red |
| outside the lead's hours on sales-api's clock | hours | that draft's `send_after` moves an hour on; it stays in the queue |
| a 200 whose follow-up or message failed (HighLevel took it, Meta failed it) | failed | counted as failed, never as sent; counts toward three in a row |
| anything else (do-not-disturb, the conversation moved on, someone else dealt with it) | one lead | the draft is set aside for a person (`meta.send_after = null`, `held_by = 'sales-desk'`, `hold_reason`) and never blocks the batch behind it; counts toward three in a row |

Three refusals or failures in a row (three different drafts) stop the run, and the row turns red. The run also stops when its time budget (270 seconds) runs out, which is no fault.

**Status row:** `(sales-desk, waves)`, one plain line. It is `ok=false` when:
- the switch is off with a wave running;
- a running wave cannot move for a setup reason (the gate, the templates, the HighLevel key, the `reactivate` kind);
- an earlier batch waits for a person;
- sending stopped on a fault (refusals, `hold_all`, an outage, a sales-api error, no answer, the budget);
- approved openers were due and none went, with nothing to explain it.

`desk.py waves --pools` counts each pool and its holdout and writes nothing.

## 2. Database: migration `20261003c_sales_followup_agent.sql`

Copy `20261002e_sales_client_forms.sql`:
- RLS on, with seat read through `cockpit_sales_seat()`;
- revoke from public, anon and authenticated;
- grant select to authenticated and all to service_role;
- `notify pgrst` at the end.

The desk reads and writes these exact names.

**`cockpit_sales_followup_waves`** (spec P3 §6, plus the columns the desk reads and writes)

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
| `enrolled_at` | timestamptz: set by the desk once every chunk of the pool is in |
| `done_reason` | text, check length ≤ 300: why the wave ended (the desk, or "Stopped by a manager." from sales-api) |
| `settled_at` | timestamptz: set by the desk once a done wave has no member left to let go of or watch |
| `created_at` | timestamptz default now() |

- One running wave per pool: a unique index on `(pool) where state in ('running','paused')`.
- Index: `(state, settled_at)`.

**`cockpit_sales_followup_wave_members`**

| Column | Definition |
|---|---|
| `wave_id` | uuid references waves on delete cascade |
| `contact_id` | text |
| `arm` | text check in (`wave`, `holdout`) |
| `state` | text not null default `'waiting'`, check in (`waiting`, `held_out`, `drafted`, `sent`, `replied`, `booked`, `closed`, `excluded`) |
| `followup_id` | uuid null |
| `event_at` | timestamptz |
| `added_at` | timestamptz default now() |
| `drafted_at` | timestamptz |
| `next_try_at` | timestamptz: a waiting member is not looked at before it |
| `later_reason` | text, check length ≤ 300 |
| `fail_count` | int not null default 0 |
| `last_error` | text, check length ≤ 300 |
| `sent_at` | timestamptz: wave arm, when the opener went |
| `due_at` | timestamptz: holdout arm, when their 14 days start |
| `replied_at`, `booked_at`, `closed_at` | timestamptz |
| `excluded_reason` | text, check length ≤ 300 |

- Primary key: `(wave_id, contact_id)`.
- **"One open membership per lead"**: a unique index `cockpit_sales_followup_wave_members_one_open` on `(contact_id) where state in ('waiting','held_out','drafted')`. It covers every wave whatever its state; the desk winds stopped waves down so their members leave these states. The desk falls back to one insert per lead only when a chunk hits this index (409 / 23505).
- Indexes:
  - `(wave_id, state, event_at desc)`;
  - `(wave_id, state, next_try_at)`;
  - `(sent_at)` and `(due_at)` (the 30-day rule);
  - `(state, drafted_at)`.

**`cockpit_sales_followup_meta`** (spec P3 §6)

| Column | Definition |
|---|---|
| `followup_id` | uuid pk references `cockpit_sales_followups(id)` on delete cascade |
| `kind_key` | text |
| `wave_id` | uuid null |
| `send_after` | timestamptz null |
| `held_by` | text (`sales-desk` when the desk set a draft aside after a refusal) |
| `held_at` | timestamptz |
| `hold_reason` | text, check length ≤ 300: the refusal that set it aside |
| `approved_by` | text |
| `created_at` | timestamptz default now() |

- Add the spec's other columns as well: `level_at_draft`, `intent`, `edit_ratio`, `live_id`, `room_id`, `crm_note_id`, and the outcome times.
- The desk reads meta by `followup_id` (the primary key), starting from the open drafts, so no `send_after` index is needed for it.

**`cockpit_sales_followups`** (exists): the desk now supplies `id` on a wave opener's insert (a UUID it made first). The column's default stays for every other insert.

**`cockpit_sales_followup_stops`** (new, and not in the specs; the stop rule needs a home; see section 5)

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
| `decided_at` | timestamptz (a resume lifts every row said before it) |

- Primary key: `(contact_id, said_at)`.
- Index: `(contact_id, said_at desc)`.
- Seat read can be the owner's or the manager's, as with followups.

**Check constraints.** These belong to the hooks migration `20261003b`:
- `cockpit_sales_followups_segment_check` gains `reactivate`, and `good_intro` for phase 2. **Until it lands, the database refuses every opener**; the waves row then says "The database refuses the reactivate kind: migration 20261003b … has not landed" in red, and no member is lost.

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

`followups.enabled` is the agent's kill switch for waves too.

**`whatsapp_guard`.** Add:
- `connector_off: false`
- `single_copy_ok_at: null`
- `dup_window_s: 60`
- `template_budget_usd_month: 100`
- `template_rate_usd: 0.0792` (optional; the estimate's rate per template, Meta's marketing rate in Kuwait, D18)

**Fix needed in sales-api (finding 17; this lane does not own `index.ts`).** Both saves rebuild their setting from a fixed list of keys, so one manager save drops every new key:
- `whatsappGuardSave` (near `index.ts:1470`) keeps three keys. One save drops `connector_off` and `single_copy_ok_at`, and the gate shuts every WhatsApp send from the desk. The waves row then says the gate sentence in red, so it is not silent, but it is wrong.
- `followupSettings` (near `index.ts:2050`) drops `waves`, `first_hours`, `stop_pause_days`, `graduation`, `reply_alerts` and `untagged_every_days`.

Each must:
- spread `...before` into the saved value, so keys it does not edit are kept;
- validate the new keys with the desk's bounds: `waves.per_day` 0..200, `holdout_share` 0..0.5, `batch_gap_s` 30..3600, `first_hours` two hours 0..24 in order, `stop_pause_days` 1..90, `template_budget_usd_month` ≥ 0;
- keep `autosend.reactivate` false (openers go only by batch);
- come with a test that a save keeps every key it does not edit.

Only a manager action may set `connector_off`. It goes through the existing `whatsapp.guard` save (no new action), with an audit row. `single_copy_ok_at` is set by the single-copy test. The desk treats anything other than `connector_off === true` together with a parseable `single_copy_ok_at` as shut.

## 4. sales-api actions phase 1 needs

Every write leaves an `audit` row. Seat actions go through the seat gate; manager actions call `needManager`. The names below are folded into the glossary's (finding 16): no `followup.unhold`, `followup.pause_lead`, `followup.resume_lead` or `whatsapp.connector`.

| Action | Door | Does | Refuses |
|---|---|---|---|
| `followup.wave {request_id, op: start\|pause\|resume\|stop, pool?, per_day?, wave_id?}` | `ACTIONS`, manager | `start` inserts a wave (`state='running'`, `started_at=now`); `pause`/`resume` flip `running` and `paused`; `stop` sets `done` with `done_reason='Stopped by a manager.'`. The desk enrols, and winds a stopped wave down, on its next run, within 5 minutes; until then it already sends nothing for a wave that is not running. | `start` while the gate is shut, with the gate sentence. A second running wave on the same pool. An unknown pool. |
| `followup.batch {request_id, wave_id \| ids[]}` | `ACTIONS`, owner of every draft, or manager | For each open `reactivate` draft in the batch (status `draft`), sets `meta.send_after = now + i × batch_gap_s` and `approved_by`. Returns `{count, first_at, last_at}` for "Approved. One goes every 45 seconds, finishing at 09:20." | Gate shut. Drafts that are not open. More than 40. |
| `followup.hold {id, on: boolean}` | `ACTIONS`, owner or manager | `on: true` sets `meta.held_by` and `held_at`; `on: false` clears them and `hold_reason`. A draft the desk set aside has no `send_after` then, so it goes again only when a person approves it again (`followup.batch` with its id). The desk re-reads the hold just before each send. | |
| `followup.send_due {id}` | `DESK_ACTIONS` (service key; `who` is `sales-desk`) | Loads the draft and its meta. Requires `send_after <= now`, `held_by` null, status `draft`, and for a wave opener a `running` wave. Then calls `sendFollowup(who, f, {}, auto=false)` with `decided_by` set to `meta.approved_by`. Returns `{followup, message}`. A per-lead refusal sets `meta.send_after = null`, `held_by = 'sales-desk'`, `hold_reason` (the desk does it too). | **With `hold_all: true`:** `followups.enabled` false; WhatsApp while the gate is shut; the messaging switch off; `templates_per_day` reached; the `whatsappHealth` pause; the sender ceiling (429); a HighLevel wallet or "funds" error, **including a 200 whose message failed for funds**; the month's template budget spent. **Without it:** outside `first_hours` (touch 1) or 09:00 to 21:00 (later steps) on the lead's clock, or a Friday (a 409 the desk reads as "hours"); per-lead refusals (409). A HighLevel failure answers 502 "HighLevel did not send it: …". |
| `followup.stop_task {contact_id, said_at?, answer: dnd\|pause\|resume}` | `ACTIONS`, owner or manager | With `said_at` (the stop task): `dnd` writes HighLevel do-not-disturb for WhatsApp only (`PUT /contacts/{id}` with `dndSettings.WhatsApp.status=active`) and sets that row `state='dnd'`; `pause` sets `state='paused'` and `paused_until = now + stop_pause_days`; `resume` sets `state='resumed'`. **Without `said_at`** (the lead page's "Pause the agent for this lead"): `pause` inserts a row `kind='manual'`, `state='paused'`, `said_at=now`, `paused_until` (default `stop_pause_days`); `resume` sets every row of the contact still holding (`asked`, `paused`) to `resumed`. All set `decided_by` and `decided_at`. A resume lifts every row said before it. | |

The desk calls `send_due` with `{"action": "followup.send_due", "id": ...}` and reads every answer as in section 1 ("How each answer from sales-api is read").

## 5. Checks to add to code that already exists

**1. Hooks (shared files).**
- `lib.ts:657` `FOLLOWUP_SEGMENTS` gains `reactivate`, and `good_intro` in phase 2.
- `FollowupsPage.tsx:119` `SEGMENT` gains the label "Backlog opener".
- `DESK_ACTIONS` (`index.ts:5076`) gains `followup.send_due`.

**2. `sendFollowup`.**
- **First-message hours.** Add the rule for touch 1 when the segment is not reply or confirm: the lead's hour must fall within `first_hours` [9, 18), otherwise "A first message goes between 9 and 6, their time." Only 9 to 21 is checked today.
- **One clock** (finding 23). `leadHour` treats Abu Dhabi and Sharjah as UTC+3; the desk treats every UAE and Oman place as UTC+4 (`PLUS_FOUR`, `followups.py`). Adopt the desk's list in `leadHour`, so the two never disagree near 09:00 or 18:00.
- **Fixed openers.** For `reactivate`, the opener cannot be edited: ignore `b.body`, or refuse a changed one. The body is the rendered opener for display, and `templateLine` keeps it on one line. `sendTemplate` fills `{{1}}` with the first whitespace word of HighLevel's first name; the desk's displayed body uses the same rule.
- **The "conversation moved on" check** counts any newer inbox message. An automation's email sent after a WhatsApp reply draft therefore expires the draft. Align it with the desk:
  - ignore outbound emails when the draft is for WhatsApp;
  - ignore HighLevel `workflow` messages that are not the cockpit's own.

**3. `followupAutosend`.** Refuse WhatsApp while the gate is shut, as the desk already does, so both doors agree.

**4. Per-source health (H5).** `cockpit_sales_messages.source` stays `followup` for waves (spec P3). To pause waves without pausing confirmations, health for waves must be counted over messages whose `followup_id` has a meta row with a `wave_id`, or over the `reactivate` segment.

**5. The template budget** (finding 27, D18). The desk already holds every template from its own sends once this month's estimate reaches `whatsapp_guard.template_budget_usd_month`: messages sent through a workflow and not failed (`via='workflow'`, `state<>'failed'`, as `sendTemplate` counts its daily ceiling at `index.ts:1173`) since the first of the month, Kuwait time, at `template_rate_usd` each. sales-api must apply the same rule in `followup.send_due` and every other template send, as a `hold_all` refusal, and show the spend by source ("WhatsApp templates this month: about $23 of $100 (estimate)").

**6. Watchdog** (`cockpit_sales_watchdog()`, consistency doc §1.7). Add:

| Status row | Alert |
|---|---|
| `(sales-desk, waves)` | after 15 minutes stale during working hours (cron every 5 minutes) |
| `(sales-desk, model)` | when `ok=false`, using the row's "Not answering since … UTC" time in the Slack line. One miss keeps the row `ok=true`, so the line never blames a lapsed sign-in for one slow answer |
| `(sales-desk, doctor)` | after 75 minutes (hourly cron) |

The followups row now reads `ok=false` with "No drafts can be written: …" while the model is down.

**7. Glossary additions** (finding 16; for the consistency doc's 1.1, 1.5 and 1.7 and the hooks commit):
- table `cockpit_sales_followup_stops`;
- action `followup.send_due` in `DESK_ACTIONS`; `followup.hold {id, on}`; `followup.stop_task {contact_id, said_at?, answer}` covering the lead-page pause;
- status rows `(sales-desk, waves)` (15 minutes) and `(sales-desk, model)` (on `ok=false`);
- wave member states as in section 2 (`replied`, `booked` and the 14-day close now match spec P3 §4).

## 6. VPS cron lines and runbook rows

The integration lane added these lines to `README.md` "Cron" (with the `followups` line at :07 and :37 and the room worker's lines), and the runbook rows below to the top-level `RUNBOOK.md`, "Follow-up agent and backlog waves" (3 October 2026).

```
5 * * * *    flock -n $HOME/.sales-desk/doctor.lock bash -c "cd $HOME/mahara-cockpits/hermes/sales-desk && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; . $HOME/.sales-desk/env; set +a; python3 desk.py --quiet doctor --cron" >> $HOME/.sales-desk.log 2>&1
*/5 * * * *  flock -n $HOME/.sales-desk/waves.lock bash -c "cd $HOME/mahara-cockpits/hermes/sales-desk && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; . $HOME/.sales-desk/env; set +a; python3 desk.py --quiet waves" >> $HOME/.sales-desk.log 2>&1
```

`followups` stays at :07 and :37. A wave run is bounded to 270 seconds, so `flock -n` never stacks runs. **A manual run uses the same lock**: `flock -n $HOME/.sales-desk/waves.lock python3 desk.py waves`. Two runs at once never send a draft twice, and the desk keeps the 45-second gap across them, but each would also write the day's batch.

**Runbook rows** for `RUNBOOK.md` "sales desk":

| Symptom | Fix | Owner |
|---|---|---|
| "No drafts can be written: The Claude sign-in on the VPS has lapsed" | SSH to the VPS as the CEO, run `claude`, then `/login`. Drafting resumes at the next :07 or :37. | The CEO |
| Waves row says "WhatsApp sends from the desk are off until the WA Connector is off and the single-copy test passes." | Uninstall the WA Connector. Send one template to the second test contact and see exactly one message. A manager then marks both in the cockpit. | The CEO |
| Waves row says the opener templates are not set up | Create `opener_ar` and `opener_en` in HighLevel, each with a one-step workflow with "Allow re-entry". A manager saves the routes under Follow-ups, WhatsApp library. | The CEO, then a manager |
| Waves row says "The database refuses the reactivate kind" | Apply migration `20261003b` (the follow-ups segment check). | The build lead |
| Waves row says an earlier day's openers still wait for approval | Approve, hold or skip them on the Follow-ups page. | The setter or the closer |
| Waves row says the template budget is spent | A manager raises `whatsapp_guard.template_budget_usd_month`, after checking the wallet. | The CEO |
| Waves row says sending stopped: HighLevel did not send it, or sales-api answered 5xx | Check HighLevel's status and the sales-api logs. The run tries again in 5 minutes, one send at a time. | The build lead |
| Waves row says "The follow-up agent is switched off" | Intended while `followups.enabled` is false. Turn it on under Follow-ups settings, or pause the running waves. | A manager |
| Openers set aside for a person | Follow-ups page: the draft shows the refusal. Fix it, release the hold, or skip it. | The setter or the closer |
| A stop word left a lead waiting | Follow-ups page, stop task: "Yes, stop WhatsApp" or "No, pause the agent for 30 days". | The setter or the closer |
| Testing the agent | `desk.py followups --contact <cockpit-test id> --segment no_show`. The draft says when do-not-disturb is on. Approving it must be refused. | The build lead |

## 7. What was verified, and what was not

**Verified:**
- Desk tests: `python3 -m unittest` from `hermes/sales-desk`. All pass, the 285 that existed before the lane included.
- `cockpit_sales_messages.via` is `workflow` for every template send (`20260926h_sales_whatsapp_followups.sql`, `index.ts:1201`), so the budget estimate counts what the daily ceiling counts.
- The test fake now keeps the database's own rules the desk leans on: one open draft per lead (`cockpit_sales_followups_one_open`), the segment check, and one open membership per lead across every wave. Races meet the real refusal, not a scripted one. Two send runs truly interleaved never send a draft twice and keep the 45-second gap.
- **Pool logic against real data.** On 3 October, read-only, the desk's own `pool_of` ran on the live mirror: contact ids, tags, statuses and call times only, deleted after use. Results for the 1,429 ROAS-tagged leads, **before the review's two pool rules**:

| Pool | Desk count | Spec count | Held back by the desk |
|---|---|---|---|
| No-shows | 438 | 438 | 61 (11.6%), with cancellations |
| Cancellations | 87 | 87 | (included above) |
| Never booked | 365 | 364 | 42 |
| Unclosed demos | 227 | 220 | 26 |
| Good intros | 179 | 161 | 26 |

  - The no-show and cancellation counts are an exact match.
  - The review added two rules from spec P3 §3.2: a held call counts only a day on, and an unclosed demo must be on a demo calendar. They lower the good-intro and unclosed-demo counts. **They were not recounted** (this pass read nothing from production). Run `desk.py waves --pools` read-only before any wave copy shows a number, and compare it with the spec's query.
  - The holdout share was 11.96% overall (155 of 1,296), against an expected 129.6 ± 10.8 (2.35 standard deviations; consistent with chance given the hash).

**Not verified (no network, nothing deployed):**
- The real `followup.send_due` contract. The desk was tested against a fake that follows section 4.
- The HighLevel `PUT` for WhatsApp-only do-not-disturb.
- That PostgREST accepts `order=event_at.desc.nullslast`, `context->>wave_id=not.is.null`, `wave_id=neq.…` and the quoted `or=(next_try_at.is.null,next_try_at.lte."…")`. All are standard PostgREST syntax.
- The opener template text and its Meta category.

## 8. The review pass (2026-10-03): each finding and what was done

Tests for every fix are in `tests/test_waves_breakit.py` (class names keep the finding numbers), plus `tests/test_followups_phase0.py` (stops) and `tests/test_doctor.py` (the model row).

| # | Finding | Done |
|---|---|---|
| 1 | Approved openers starve behind 200 finished meta rows | Fixed: `send_due` starts from the open drafts |
| 2 | A stopped wave keeps sending | Fixed: send only for a running wave, read again before each send; `wind_down` takes back its openers and lets go of its leads |
| 3 | Three refused drafts block the batch | Fixed: a per-lead refusal sets the draft aside for a person; hours refusals stay queued an hour on; three in a row turns the row red |
| 4 | The kill switch does not stop waves | Fixed in the desk; sales-api `send_due` must refuse with `hold_all` too (section 4) |
| 5 | A Meta failure behind a 200 counts as sent | Fixed: read as failed, or `hold_all` for funds |
| 6 | A HighLevel outage burns three per run; a failed opener is never retried | Fixed: an outage stops the run; a failed member is drafted again once |
| 7 | Partial enrolment is never finished | Fixed: `enrolled_at` |
| 8 | Stopped-wave members block later waves; all-busy waves retry forever | Fixed: wind-down, the any-wave busy rule, done with a reason, done when nobody is left |
| 9 | One open opener stops every wave | Fixed: only undecided openers block, and say so in red |
| 10 | Stop rows hide each other | Fixed: every row is read (`hold_of`) |
| 11 | A later message lifts an unsubscribe or a rep's answer | Fixed: only a rep's resume lifts a kept stop |
| 12 | Openers mid-conversation; no replied, booked or 14-day states | Fixed: 14-day exclusion; `outcomes`; holdout `due_at` |
| 13 | A reply candidate swallows the lead's other kinds | Fixed: `then` |
| 14 | The waves row is green while nothing goes | Fixed: the red cases in section 1 |
| 15 | A crash between draft and member makes a second opener | Fixed: desk-made id, member marked first, any prior opener adopted |
| 16 | Names outside the glossary | Settled in sections 4 and 5.7 for the integration stage |
| 17 | sales-api settings saves drop new keys | Not fixable in this lane (`index.ts` is shared); the fix and its test are spelled out in section 3 |
| 18 | "Later" leads starve the wave and are re-read every run | Fixed: route first, `next_try_at`, paging |
| 19 | A dial excludes a new lead for 8 days, not 24 hours | Fixed |
| 20 | The model row is stale or blames a timeout | Fixed |
| 21 | The doctor's probe is not guarded | Fixed |
| 22 | Pool rules differ from the spec | Fixed (24-hour wait, demo calendars); recount left for a read-only run |
| 23 | The draft's name and the two clocks disagree | Name fixed in the desk; the clock fix is sales-api's (section 5.2) |
| 24 | The fake enforces nothing | Fixed; interleaved two-run test added; manual runs use the lock |
| 25 | Cron lines, runbook rows, the segment check | The integration lane adds the lines and rows (section 6); the desk says the refused kind plainly, and the doctor checks it |
| 26 | Enrolment calls an outage "busy" | Fixed |
| 27 | Nobody enforces the template budget | Fixed in the desk; sales-api must enforce it too (section 5.5) |
