# Waves 1 and 2 build contract: safe card writes, checked money, the churn confirm, and the CSM's money acts

Written 2026-11-01 for branch `forms-w12` (worktree `/Users/abdulazizwaheedi/mahara-worktrees/forms-w12`),
cut from origin/main `658c5a97`. It builds waves 1 and 2 of
`docs/forms/CSM-CLIENT-FORMS-PLAN.md` (called "the plan" below: E1 to E20, sections 3 to 8,
section 6 waves 1 and 2). The plan's section 7 defaults are approved, Q1 to Q23 included. It is
modelled on `docs/forms/STAGE2B-CONTRACT.md` ("2b") and keeps 2b's habits: every claim about live
state carries the query that produced it (section 11.2, read only, 2026-11-01), every replaced
function is guarded against drift, every new writer is behind a switch that is off at deploy.

**The CEO's words** (quote, do not reinterpret), 2026-11-01: "now the rest of the plan and forms,
make them amazing and get them fully done". So this contract decides every builder question with
the safest default and records it (section 11.1, decisions W1 onward). Builders never ask; they
follow this file, and where code and this file disagree they stop and leave a note in their
slice's report.

**Hard rules for every builder.** No push, no deploy, no migration applied, no write to the live
database, ClickUp, Make, Typeform, Slack or the VPS. Read the live database only with SELECT.
Never touch the shared checkout `/Users/abdulazizwaheedi/mahara-cockpits`. Never print a secret.
Repo `CLAUDE.md` rules hold: Supabase first; every new table with row security and its grant in
the same migration; every action gated on the server with an audit row; external calls through
the existing helpers; missing is never zero; numbers checked against a second source with a note.
Before any screen: load `mahara-context/skills/frontend-design/SKILL.md` and Hallmark
(`~/.cache/mahara-ship/skills/hallmark/SKILL.md`), write the design plan (section 5 gives it), then
code. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## 0. The shape in fifteen lines

1. **Six migrations, `20261101l` to `20261101q`**, one per slice that needs SQL, applied in that order; the plan's "20261101b onward" was already taken by `b` to `k` on main and live (section 2.1).
2. **B0, the billing rails** (`m`): a billing-only switch by kind and by card, so card writes for money go live one kind at a time and the general `CLICKUP_WRITEBACK_APPLY` never opens them; new card fields Resume On, Churn Date, Churn Reason, Churn Type, MRR, LTV and the "will not continue" checkbox; source `system`; kinds `mrr`, `ltv`, `late`; a stored ClickUp field map read daily; a canary door that writes only test card `86eywg1cq`.
3. **CK, checked money** (`n`): every hand-logged payment is `logged` until finance or the CEO checks it; CEO cash, the lock-in total, LTV and pay count `checked` only and show logged money on its own line; the 8 rows already in the ledger are marked checked "logged before the check rule" (Q20).
4. **F0a, the forms base for stage 3** (`l`): registry rows for `exit_survey`, `pause_request` and the five staff forms; `forms-door` takes two more Typeform forms; one legacy record path; the registry's checkin-only limit lifted for named keys; six new notice kinds; the two new Slack channel rows; `cockpit_form_doors()` so each new door hides itself until its migration is live.
5. **C4a-2, termination answers stored**: the termination Typeform posts signed to `forms-door/typeform/exit_survey`; each answer becomes a `legacy` response, a "Notice in" row for the CSM and a `termination.notice` post in #csm-general mentioning the CSM seat (never "old link" wording while the Typeform is the live form); no card field changes (D11). The client pause Typeform is captured the same way before Make 9805613 goes off (W18).
6. **L0, the churn confirm** (`o`): "Client is leaving" on the client page and "Confirm churn" on the churn tracker call one gated, audited function that writes the register's new columns and one billing event `churn`, which writes Churn Date, Stopped, Churn Reason and Churn Type on the card and reads them back.
7. **The 6-row backfill** is a deploy step after the canary: 5 of the 6 cards already read Stopped with the register's date and type (set by hand on 11-01), and the backfill takes the type from the card's own value, so it mostly reads back "unchanged"; Atlantis's stray Paused On is cleared (Q6), Alkhalil's held pause is voided (Q3).
8. **Honest client-page buttons** (5.11): booked, touchpoint, report and service reach the card through `cockpit-csm-api`, which already writes them; Last report sent is found by id.
9. **Extension native** (`p`): "Give more time" on the client page and Extend on the billing sheet are one write with the new fields; a daily system step clears the card's extension the day after a grant ends; `cockpit_extensions_v` is the one record, and five readers move to it; the $50 text goes (Q7).
10. **Staff pause and the ladder** (`p`): pause and resume carry kind, dates, reason and call, write Resume On (the fix); one editable ladder (pause review day 4, cancel review day 15) produces review rows, never card changes; late payments become `late` events and `cockpit_late_payments_v`.
11. **Set MRR** (`p`): one writer of the card's MRR, a suggestion beside it, and a rail-cash check (computed by the CEO money refresh, which alone can read Whop) that flags cards whose MRR and money in differ by more than 10%.
12. **FormSheet**: one shared sheet (byte-identical in both apps) renders every staff form, shows where each prefill came from, and ends in the after-send trail: saved, queued, card confirmed, notice posted, ticket.
13. **The system never opens a ClickUp ticket; one press does** (W5): notices in, checks waiting, ladder reviews and pause prompts are derived rows on Today, each with a button that opens the prefilled request form for its ticket type (`client_notice`, `payment_receipt_check`, `client_pause`, `client_offboarding`), so the ticket reaches task alerts and Your tasks.
14. **Seven build slices** with disjoint files (section 7): four start at once, two follow, one last.
15. **Deploy** (section 9) goes migration by migration through Composio, each with a read-back and a rollback; the apps ship only after every migration they call is live; card writes open kind by kind on the test card first, and each opening reviews that kind's held edits one by one; Make and Typeform switch-offs happen in the same hour as the kind that replaces them, each read back.

---

## 1. Scope

### 1.1 In waves 1 and 2

| Piece | Plan ref | Slice | Live at deploy |
|---|---|---|---|
| B0 billing switch, fields, `system` source, kinds, field map, canary door, read-back tests | 4.2 B0 | billing-rails | switch off: every billing item stays `dry_run` |
| CK checked-money state, the check RPC, Q20 backfill, readers count `checked` | 4.2 CK, 5.3 | checked-money | live (a reader change and a data mark) |
| F0a registry rows, legacy record path, `forms-door` second and third forms, notice kinds, S0 rows, registry limit lifted, `cockpit_form_doors()` | 4.2 F0, S0 | forms-foundation | records only; the new notice kinds seeded as section 3.4 says |
| C4a-2 receiver (`forms-door/typeform/exit_survey`), 4-response backfill script | 5.8 | forms-foundation | the webhook is registered at deploy (section 9) |
| Pause request capture (`forms-door/typeform/pause_request`, Typeform `CTUjv6l3`), so nothing is lost when Make 9805613 goes off (W18) | 5.2 | forms-foundation | registered at D-C2, before 9805613 goes off |
| L0 churn confirm, register columns, `cockpit_client_lifecycle_v`, churn tracker Confirm, client page "Client is leaving" | 4.2 L0, 5.8 | churn-confirm (SQL, tracker), formsheet-client-page (client page) | the function is live; its card write waits for kind `churn` |
| 5.11 client-page acts (booked, touchpoint, report, service), report field by id, commitment refs | 5.11 | formsheet-client-page | live on ship |
| Reactivate links removed (both apps and `csm_assistant.py`) | 5.18 | formsheet-client-page | live on ship |
| Extension native, `cockpit_extensions_v`, clear-on-end, $50 text removed | 5.1 | money-acts (SQL, sheet), formsheet-client-page (client page, links) | card writes wait for C1 |
| Readers repointed to `cockpit_extensions_v` (cadence, CEO API, ceo-refresh, metric registry, SOURCES, goals, lock-in) | 5.1 | readers-guardian | live on the next refresh |
| Staff pause and resume, the ladder (LD), late-payment records | 5.2, 4.2 LD, 3.1 | money-acts | card writes wait for C2-staff |
| Set MRR, the suggestion, the rail-cash check | 5.5 | money-acts (SQL, sheet), checked-money (money refresh) | card writes wait for kind `mrr` |
| FormSheet (FS) | 4.2 FS | formsheet-client-page | live on ship |
| Guardian checks, runbook rows | 8 | readers-guardian | report-only |

### 1.2 Not in waves 1 and 2

- The client channel (F1): invites, the portal renderer, `/f/{token}`, the file bucket, `pause_consent` and the exit-survey page (wave 3). Until then a client-requested pause is confirmed with the call as consent plus the CSM's two required ticks (W8).
- System-raised ClickUp tickets (W5). The request types `client_notice` and `payment_receipt_check` are added at deploy (D-R1: new options on ClickUp's Request Type field, then `cockpit_request_type_add`, section 3.1) and are raised by a person's press on a derived row, never by the system.
- `legacy.received` ("an old Typeform link was used"): wave 3, after C4b retires the Typeforms. While a Typeform is the live form, its answers notify in plain words (`termination.notice`, the "Pause request in" row), never as an "old link".
- Editing the five staff forms without code: they are code-defined (`formDefs.ts`) until the editor (ED, wave 4); their registry rows hold the same keys as a record and refuse changes until then (W19).
- The daily LTV writer (E10, wave 5): B0 adds the field, the kind and the write case only; nothing inserts an `ltv` event yet.
- The billing agent's own login (AG), Confirm paid moving the date (5.4), refunds as a route (5.3), upsells and wins (WL), NPS, CSAT, the feedback bridge, onboarding, the editor screen (ED): waves 3 to 6.
- F0's kind tables (notice and message kinds as tables with foreign keys) and `cockpit_form_publish` / `_restore`: wave 3. Waves 1 and 2 widen the CHECKs once (W3).
- The portal's BillingPreview and the billing agent's SOP reading the ladder: other repo and the VPS skill; they read `cockpit_billing_ladder_read()` when their own release lands (section 10).
- The 55 other held ClickUp edits (Q19): untouched. Nothing here uses the general switch.
- PV (prove step 1) and C4a-1 are wave 0 and run before this deploy (section 9, D0).

### 1.3 What only people can do (never faked)

| Item | Who |
|---|---|
| Invite the Slack bot to #csm-announcements `C09SNG5BP53` and #nps-survey-feedback `C09TTGBRQ0G` (Q4) | the CEO |
| Create the two Request Type options in ClickUp (`client_notice`, `payment_receipt_check`) | the systems manager, or the session at deploy step D-R1 on the CEO's standing rule (Q17) |
| A real CSM's first "Give more time", first pause, first churn confirm on a live client | the CSM |
| Monthly client-income bank statement upload (Q12), before any new transfer can be checked against a statement line | the CEO |
| Withdrawal of Liwan's extension, if it was withdrawn (Q2) | the CEO or the CSM |

### 1.4 The switches (every new writer, its switch and its state at deploy)

| Writer | Switch | Where | At deploy | Turned on |
|---|---|---|---|---|
| Billing card writes (kind `billing` queue items) | `CLICKUP_WRITEBACK_APPLY_BILLING` exactly `true`, **and** the event kind in `CLICKUP_WRITEBACK_BILLING_KINDS` (comma list, empty means none), **and** the card in `CLICKUP_WRITEBACK_BILLING_ONLY_CARDS` when that is set | Edge Function secrets of `clickup-writeback` | unset (every billing item `dry_run`) | D-B3 canary `86eywg1cq`; wave 1 kinds `churn`; wave 2 kinds per section 9. `dry_run` is terminal for the claim, so opening a kind sends nothing already held: each opening runs the held-edit review (W20, `cockpit_billing_held_release`) |
| The general log switch | `CLICKUP_WRITEBACK_APPLY` no longer opens kind `billing` (W2) | code | unchanged | never for billing |
| Billing field map read (`billing_doctor` job) | none: a read | pg_cron `mahara-clickup-writeback-billing-doctor` | runs daily | |
| Daily billing step (clear-on-end, late open and close) | `cockpit_settings` key `billing.daily` `{"on":false}` | database row | off | D-P3 (wave 2) |
| Staff form notices (`extension.granted`, `pause.agreed`, `client.resumed`, `churn.confirmed`) | the kind's `cockpit_slack_notice_settings.enabled`, and the channel row `ok` | database rows | enabled, channel #csm-announcements in state `checking`: each posts "Not posted: the bot is not in #csm-announcements" until Q4 | when the CEO invites the bot |
| `termination.submitted` | settings row | database | **disabled** (Make 9805538 [5] still posts in #csm-announcements until C4b; W4) | wave 3, C4b |
| `termination.notice` | settings row | database | enabled, #csm-general `C09RZ0GS0V9` (state `ok`), mention `seat:csm` | at deploy |
| The termination webhook into `forms-door` | the cockpit webhook on Typeform `knIe4eF3` and the key `typeform_exit_survey` | Typeform and the vault | not registered | D-F4 |
| The pause-request webhook into `forms-door` | the cockpit webhook on Typeform `CTUjv6l3` and the key `typeform_pause_request` | Typeform and the vault | not registered | D-C2, before Make 9805613 goes off |
| The new screen doors (churn confirm, the three money forms, Reviews due, Checks waiting) | `cockpit_form_doors()` reports which of their functions exist | database (read) | each door hidden with a plain line until its migration is live | by the migrations themselves |
| Checked money | none: a reader change; the Q20 mark is in `n` | | live | |

---

## 2. The migrations

### 2.1 Names and order

The live database holds `20261101a` (two files), `b` to `k` (query 11.2-a), and main holds the
same files. No branch holds `20261101l` or later (`git for-each-ref` sweep, 11.2-b). Waves 1 and 2
take the block `l` to `q`:

| Order | File | Slice | Holds |
|---|---|---|---|
| 1 | `supabase/migrations/20261101l_forms_stage3_base.sql` | forms-foundation | F0a, C4a-2's SQL, the pause-request capture, notice kinds, S0 rows, `cockpit_form_trail`, `cockpit_form_staff_record`, `cockpit_form_doors` |
| 2 | `supabase/migrations/20261101m_billing_rails.sql` | billing-rails | B0, the event voids and the held-edit release |
| 3 | `supabase/migrations/20261101n_checked_money.sql` | checked-money | CK, Q20 |
| 4 | `supabase/migrations/20261101o_churn_confirm.sql` | churn-confirm | L0, `cockpit_client_lifecycle_v`, the backfill door |
| 5 | `supabase/migrations/20261101p_money_acts.sql` | money-acts | extension, pause, ladder, late, MRR, the daily step, `cockpit_extensions_v`, `cockpit_late_payments_v`, `cockpit_form_prefill` |
| 6 | `supabase/migrations/20261101q_readers.sql` | readers-guardian | the goal sheet and lock-in reads, the November `actual_source` rows |

**The letter rule.** Before builders start and again before every apply, the orchestrator reads
`select name from supabase_migrations.schema_migrations where name like '20261101%' or name like '20261102%'`,
`git ls-tree --name-only origin/main supabase/migrations/` and every branch. If any of `l` to `q`
is taken, the whole block moves to the next free consecutive letters (or to `20261102a` onward),
same order, and this table is amended before builders start. Builders never rename a file.

**Every file**: starts `BEGIN;`, ends `NOTIFY pgrst, 'reload schema'; COMMIT;`, applies twice without
error, uses `LANGUAGE plpgsql` for any function that names an object of a later file, and writes
`CREATE OR REPLACE` / `IF NOT EXISTS` / guarded CHECK swaps (`pg_get_constraintdef ... NOT LIKE`,
as `20261029t` does).

**Row security and grants.** Every new table: `ENABLE ROW LEVEL SECURITY`; `REVOKE ALL ... FROM
PUBLIC, anon, authenticated, service_role`; then `GRANT` service_role exactly what it needs; no
browser grant; browser access only through `SECURITY DEFINER ... SET search_path = ''` functions
whose first line is the gate; an audit trigger (`cockpit_audit_log`); delete and truncate refused
where the table is a record (voids, field map history). Every new view: `WITH (security_invoker =
true)`, revoked from PUBLIC, anon and authenticated, `GRANT SELECT` to service_role only; browser
reads go through a gated read function. Every new or replaced function is revoked from all four
roles first and granted exactly as section 3 says ("none" means only the owner runs it).

**The drift guard.** Each file that replaces a live function opens, right after `BEGIN;`, with one
`DO` block that reads `md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))` for every function it
replaces (section 2.2) and raises `55000` `<function> changed since the waves 1-2 contract read it;
stop and re-read it.` unless the value is the "live body md5" below or the file's own "after" value
(written into the file by its builder, asserted by the slice's PGlite test). Before each apply the
deploy saves `pg_get_functiondef` of each to
`/Users/abdulazizwaheedi/mahara-cockpits/notes/forms-w12/deploy/before-<name>.sql`.

**Names in tests.** Tests name these files by full stem (`20261101m_billing_rails.sql`), never by
the bare letter.

### 2.2 Functions replaced (one owner each; live body md5 read 2026-11-01, 11.2-c)

| Function | Live body md5 | ACL | Replaced by | Change |
|---|---|---|---|---|
| `cockpit_slack_notice_shape(text)` | `a22c7f71b3a8398c96b0dcb5336b7f0d` | owner | `l` | six kinds, all `post` |
| `cockpit_slack_notice_kind_label(text)` | `fea0b1c735a76ecfdd5d6880615f9f3d` | owner | `l` | six labels (3.4) |
| `cockpit_slack_notice_live(cockpit_slack_notices)` | `236e6af483f41c3514d7dc41e6a81086` | owner | `l` | live rules for six kinds (3.4) |
| `cockpit_slack_notice_inputs(jsonb)` | `2d980b72862995467fdca66da74945c7` | svc | `l` | kind list |
| `cockpit_slack_notice_doctor_inputs()` | `a17ee0591518eb3f5eb0fae0cc2b9a02` | svc | `l` | order list |
| `cockpit_slack_notice_settings_read()` | `57b78a275b1378ef49b9d092c70f86a0` | auth | `l` | order list |
| `cockpit_slack_notice_settings_set(text,jsonb)` | `37cfe1700eaae4a1d23b6000ed3429a9` | auth | `l` | kind list |
| `cockpit_slack_channel_remove(text)` | `36a18b31cd6ffefb87ebe234264db782` | auth | `l` | order list, refusal names the new kinds |
| `cockpit_slack_notice_rehearse(text)` | `62fb92a21b367ab6b98eabdeb07a071c` | auth | `l` | kind list |
| `cockpit_slack_notice_rehearse_service(text,text)` | `bc273014f46cf04a06c95b61d46a1ba2` | svc | `l` | kind list |
| `cockpit_slack_notice_read(text)` | `8937626f99eaf17aed97080144a9a05c` | auth | `l` | the new kinds visible to csm, finance and CEO seats |
| `cockpit_forms_key_put(jsonb)` | `6bc3394855a1120060c8105d93399f52` | svc | `l` | accepts `typeform_exit_survey` |
| `cockpit_forms_key_mark(jsonb)` | `da921eebe001f597840e8e930bc0b69e` | svc | `l` | accepts `typeform_exit_survey` |
| `cockpit_forms_key_label(text)` | `a4a69845be8fcc978842aa024ce298e4` | owner | `l` | its label "Termination survey webhook" |
| `cockpit_forms_keys_status()` | `f37568dfb69e44327ca8c5552c1d04f2` | auth | `l` | the `typeform` list gains `exit_survey` and `pause_request` |
| `cockpit_forms_door_seen(...)` (read its full signature with `pg_get_function_identity_arguments`) | `f300e9a2184fba75d8b4f5693cb20e83` | read live | `l` | accepts every key of forms-door's `FORM_KEYS` (`kickoff`, `exit_survey`, `pause_request`) instead of raising "Only the kickoff form has a cockpit webhook in 2b."; the health key stays `forms-door:{form}`, the forms-key provider `'typeform_'||form`, the note wording per form; kickoff's behaviour unchanged |
| `cockpit_form_registry_apply(text,jsonb,jsonb)` | `af5e541b7f489b9871e4ad49a6c32460` | owner | `l` | the checkin-only refusal becomes an allow-list (4.3) |
| `cockpit_billing_writeback_writes(text,text,text,jsonb)` | `957894a2a6ce3ae8f5a9c9c9acc1eaab` | owner | `m` | new cases (3.3) |
| `cockpit_billing_writeback_enqueue()` | `ce6cff4631816e5352852b3726dc832d` | owner | `m` | `comment` payload key; `seatRole` |
| `cockpit_manual_payment_protect()` | `19483bd59d40ab35dc3d6b1fb21ab78c` | owner | `n` | the check columns may move once, `logged` to `checked` or `rejected` |
| `cockpit_billing_ingest_inbox(boolean,integer)` | `a27d47d94049c1c9919d02885935ce50` | svc | `n` | writes `check_state='logged'` |
| `cockpit_ceo_manual_payment_add(jsonb,uuid)` | `272114d96de1b84e7c53f7eee8a1a1fb` | auth | `n` | `checked` with a named reference, else `logged` |
| `cockpit_finish_finance_refresh(uuid,jsonb,text)` | `49223dfc3d24eb5cdc0bd11f8c7fb13b` | read live | `n` | carries `checked` into `cockpit_client_payments` |
| `cockpit_billing_deal_rails_held(text,text)` | `745278bd6a3bf712b9b7eeee2084babf` | read live | `n` | returns `checked` |
| `cockpit_billing_balances_read()` | `411d7ff4533e3d827743e30b2995501d` | read live | `n` | passes `checked` through (only if it names columns; the builder reads the live body first) |
| `cockpit_billing_deal_assignments()` | `eb1a61f0aca100e728815a2aad81456e` | read live | `n` | counts `checked` rows only |
| `cockpit_csm_projection_facts(jsonb)` | `587087c9805f7b307cbda006f0a839a5` | read live | `n` | counts `checked` rows only |
| `cockpit_csm_projection_refresh_billing()` | `9e77236725e5f3e65e082fac970dab70` | read live | `n` | counts `checked` rows only |
| `cockpit_csm_projection_read(...)` (signature read live) | `d1d31a5b449215156b8145820c75d52f` | read live | `n` | its payments feed (`cockpit_client_payments WHERE p.active`) sends `checked` rows as collected and `logged` rows on their own line ("Receipt in, not checked"), never summed into collected |
| `cockpit_csm_churn_read()` | `b008dbe49a35e451bd8979424b5fcdb3` | auth | `o` | departures carry the new columns; `notices` and `unmatched` lists (4.5) |
| `cockpit_billing_write(text,jsonb)` | `8d499d5faa361ea51b86905e3ff0998c` | auth | `p` | extension, pause, resume fields; kind `mrr`; `requestId`; responses; notices |
| `cockpit_settings_forms_audit()` | `ae654764bf7e86bd914d9df4cbbd089c` | owner | `p` | also audits `billing.%` keys |

"read live" ACL: the builder copies the live `proacl` into the file's grant lines and the PGlite
test asserts it. **Not replaced by any file here:** `cockpit_csm_churn_edit` (`5a6ac322...`; the
confirm is a new function, W6), `cockpit_form_submit`, `cockpit_form_open`,
`cockpit_form_plan_effects`, `cockpit_form_record_typeform`, `cockpit_request_submit`,
`cockpit_csm_form_sent` (it stays kickoff-only on purpose: no other form is noted as sent from
the cockpit in waves 1 and 2), `cockpit_clickup_writeback_claim` (held billing items are released
by the explicit review of W20, not by widening the claim),
`cockpit_ceo_refresh_finance_snapshot` (it already returns `to_jsonb(p)` of every manual payment,
so the new columns reach the money refresh with no change).

### 2.3 `20261101l_forms_stage3_base.sql` (forms-foundation)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_slack_notices_kind_check` gains `termination.submitted`, `termination.notice`, `churn.confirmed`, `extension.granted`, `pause.agreed`, `client.resumed` | CHECK swap | | guarded |
| `cockpit_slack_notice_settings_kind_check` gains the same six kinds | CHECK swap | | guarded; without it the seed below fails and `l` rolls back |
| `cockpit_slack_notice_settings_check` (the "has a channel" list, `(kind IN (...)) = (channel IS NOT NULL)`) gains the same six kinds (all six are seeded with a channel, `termination.submitted` included though disabled) | CHECK swap | | guarded; `cockpit_slack_notice_settings_check1` (kickoff.late/second always enabled) is untouched |
| `cockpit_forms_keys_provider_check` gains `typeform_exit_survey` and `typeform_pause_request` | CHECK swap | | guarded; without it D-F4's `forms_key.py typeform-secret exit_survey` fails even with `cockpit_forms_key_put` widened |
| the eleven notice functions of 2.2, the four `cockpit_forms_key_*` functions and `cockpit_forms_door_seen` | replaced | as 2.2 | |
| `cockpit_slack_notice_settings` rows for the six kinds | seed `ON CONFLICT DO NOTHING` | | 3.4 |
| `cockpit_slack_channels` rows `C09SNG5BP53` (`csm-announcements`) and `C09TTGBRQ0G` (`nps-survey-feedback`), `private false`, state `checking`, `added_by 'migration 20261101l (S0)'`, note `"The CEO invites the bot (Q4); until then notices here read Not posted."` | seed `ON CONFLICT (id) DO NOTHING` | | the notices doctor turns `checking` to `ok` or `refused` |
| `cockpit_forms` rows `exit_survey` (provider `typeform`, `typeform_id 'knIe4eF3'`, audience `client`, seats `{csm}`, client_scoped true), `pause_request` (provider `typeform`, `typeform_id 'CTUjv6l3'`, audience `client`, seats `{csm}`, client_scoped true) and `extension`, `pause`, `resume`, `churn_confirm`, `mrr` (provider `native`, audience `team`, seats `{csm}`, client_scoped true), each staff row with `schema` = the keys of `formDefs.ts` (3.7; a record of the code-defined form, W19) and `effects` of 3.7; `cockpit_form_versions` version 1 of each | seed `ON CONFLICT DO NOTHING` | (tables unchanged: row security on, no browser grant) | `updated_by 'migration 20261101l'` |
| `cockpit_form_registry_apply` | replaced | none | 4.3 |
| `cockpit_form_record_legacy(p jsonb)` | function | `service_role` | 3.1; forms-door's writer |
| `cockpit_form_legacy_match(p_response_id uuid, p_task_id text)` | browser RPC | `authenticated` | 3.1; a CSM allowed on the picked card's client, or the CEO |
| `cockpit_form_staff_record(p_form_key text, p_task_id text, p_answers jsonb, p_request_id uuid, p_source text DEFAULT 'cockpit')` | function | none | 3.1; called inside the money and churn functions |
| `cockpit_form_trail(p_ref jsonb)` | browser RPC, `STABLE` | `authenticated` | 3.1; FormSheet's after-send trail |
| `cockpit_form_notices_in()` | browser RPC, `STABLE` | `authenticated` | 3.1; the derived "Notice in" and "Pause request in" rows |
| `cockpit_form_doors()` | browser RPC, `STABLE` | `authenticated` | 3.1; which new doors may show |
| index `cockpit_form_responses_exit_task` on `(task_id, submitted_at DESC) WHERE form_key IN ('exit_survey','pause_request')` | index | | |
| `cockpit_request_type_add(p_row jsonb)` | function | none (owner, deploy step D-R1 only) | 3.1 |

### 2.4 `20261101m_billing_rails.sql` (billing-rails)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_billing_events_kind_check` gains `mrr`, `ltv`, `late` | CHECK swap | | `churn` is already there (11.2-d) |
| `cockpit_billing_events_source_check` gains `system` | CHECK swap | | |
| `cockpit_billing_writeback_writes`, `cockpit_billing_writeback_enqueue` | replaced | none | 3.3 |
| trigger `cockpit_billing_events_clickup_writeback` | dropped and recreated | | `WHEN ((NEW.source IN ('ceo','csm') AND NEW.kind IN ('method','plan','amount','date','extension','pause','resume','payment','note','churn','mrr')) OR (NEW.source = 'system' AND NEW.kind IN ('extension','ltv','late')))` |
| `cockpit_billing_writeback_comment(p_kind text, p_from text, p_to text, p_detail jsonb, p_client text)` | function, `IMMUTABLE` | none | the comment texts of 3.3 |
| `cockpit_clickup_fields` (`list_id text, field_id text PRIMARY KEY, name text NOT NULL, type text NOT NULL, options jsonb NOT NULL DEFAULT '[]'` (each `{id, name, orderindex}`), `read_at timestamptz NOT NULL, read_by text NOT NULL`) | table | service_role `SELECT, INSERT, UPDATE` | the field map (W7); audit trigger |
| `cockpit_clickup_fields_put(p_list text, p_fields jsonb)` | function | `service_role` | upserts one list's field read; refuses an empty read |
| `cockpit_clickup_field(p_prefix text)` | function, `STABLE` | none | the one field whose id starts with the prefix on `901816559981`, else NULL |
| `cockpit_clickup_option_ok(p_prefix text, p_name text)` | function, `STABLE` | none | true when the stored field has that option name |
| `cockpit_billing_mode()` | function, `STABLE` | none | `unknown` until `clickup-writeback:billing` has reported, else its `detail.mode` (`dry_run`, `apply_limited`, `apply`) and `detail.kinds` |
| `cockpit_billing_canary(p_kind text, p_args jsonb)` | function | none (owner, run through Composio at deploy) | inserts one billing event on `86eywg1cq` only (3.1) |
| `cockpit_billing_detail(p_kind text, p_args jsonb)` | function, `STABLE` | none | the one detail builder (3.1, 3.3) |
| `cockpit_churn_reason_card(p_reason text)` | function, `STABLE` | none | built from the stored field map, not a copy of the name: register `Completed term` → card option `Completed term, did not renew`; `Other` → NULL; every other register reason → the option of the same name when the stored Churn Reason field has it, else NULL (the step is skipped with the 3.3 sentence). Lives in `m` because the writes function calls it |
| `cockpit_billing_event_voids` (`event_id bigint PRIMARY KEY REFERENCES cockpit_billing_events(id)`, `reason text NOT NULL CHECK (char_length(reason) BETWEEN 4 AND 300)`, `voided_by text NOT NULL`, `voided_at timestamptz NOT NULL DEFAULT now()`) | table | service_role `SELECT, INSERT` | audit trigger; delete and truncate refused. In `m` (not `p`) so D-B5 can run in wave 1 |
| `cockpit_billing_event_void(p_event_id bigint, p_reason text)` | browser RPC | `authenticated` | CEO or finance; closes the event's unsent queue item (`dry_run`, `queued` or `retry` → `skipped`, error `Voided in the cockpit: {reason}`); refuses an event whose item was delivered: `The card already shows this change; make a new edit instead.` |
| `cockpit_billing_event_void_owner(p_event_id bigint, p_reason text, p_actor text)` | function | none (owner, deploy only) | the same, credited to `p_actor` |
| `cockpit_billing_held_release(p_event_id bigint, p_how text, p_reason text, p_actor text)` | function | none (owner, deploy only) | the held-edit review of W20, for one `dry_run` billing item whose kind is open: `replan` (state `queued`, `steps=null`, `progress='{}'`; only when the card was read unchanged since the event), `fresh` (voids the event and inserts a copy with `at=now()`, `detail.replaces_event_id`, the same kind and values; its trigger queues a new item; used when the card changed since, so the stale verdict does not skip it), `close` (state `skipped`, error `Closed at the kind opening: {reason}`; the event stays a record, so an ended extension grant still counts in `cockpit_extensions_v`), `void` (as the void function). Refuses any item not `dry_run`, not kind `billing`, or whose event kind is not in the reported `cockpit_billing_mode().kinds`; audit row each. Never touches the general log edits |
| pg_cron `mahara-clickup-writeback-billing-doctor` at `41 3 * * *` (UTC), posting `{"job":"billing_doctor"}` like the forms doctor | cron, between `-- cron:begin` and `-- cron:end` | | the PGlite test strips the block |

### 2.5 `20261101n_checked_money.sql` (checked-money)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_manual_payments` columns `check_state text NOT NULL DEFAULT 'logged' CHECK (check_state IN ('logged','checked','rejected'))`, `checked_by text`, `checked_at timestamptz`, `checked_ref text CHECK (checked_ref IS NULL OR char_length(checked_ref) BETWEEN 3 AND 200)`, `statement_line_id text` | columns | (table unchanged) | added with `DEFAULT 'logged'` (adding columns fires no UPDATE trigger), so every row, the 8 included, starts `logged` and nothing ingested before the apply is counted as checked by a default |
| `cockpit_manual_payment_protect` replaced **before** the mark below | replaced | as 2.2 | allows the one move `logged` → `checked`/`rejected` of the five check columns only under the transaction-local `cockpit.payment_check` setting (4.2) |
| Q20 mark, one statement under `set_config('cockpit.payment_check','q20',true)`: `UPDATE cockpit_manual_payments SET check_state='checked', checked_by='migration 20261101n (Q20)', checked_at=now(), checked_ref='logged before the check rule, 2026-11-01' WHERE check_state='logged' AND id IN (the 8 ids of 11.2-i)` | data | | a `DO` block first asserts that those 8 ids exist, are not deleted and sum to $21,239.16, else raises `55000` "The Q20 rows changed since the contract read them; stop and re-read." A row added after 11.2-i stays `logged`. Second apply touches nothing |
| `CHECK ((check_state = 'logged') = (checked_at IS NULL))` on `cockpit_manual_payments` | CHECK, added **last** | | guarded add; it holds because the 8 rows now carry `checked_at` and every other row is `logged` with NULL |
| `cockpit_billing_inbox.check_state` same CHECK list, `DEFAULT 'logged'`; then one statement: rows 2, 3 and 5 (status `ingested`, the ledger's rows) `checked`; row 4 (status `rejected`, the Tap row) `rejected` | column, data | | asserted by id and status first; carried into the ledger by ingest |
| `cockpit_client_payments.checked boolean NOT NULL DEFAULT false` | column | | computed in SQL by the finance refresh (4.2.4), never trusted from the refresh output |
| `cockpit_billing_ingest_inbox`, `cockpit_ceo_manual_payment_add`, `cockpit_finish_finance_refresh`, `cockpit_billing_deal_rails_held`, `cockpit_billing_balances_read`, `cockpit_billing_deal_assignments`, `cockpit_csm_projection_facts`, `cockpit_csm_projection_refresh_billing`, `cockpit_csm_projection_read` | replaced | as 2.2 | 4.2 |
| `cockpit_manual_payment_check(p_id text, p_verdict text, p_ref text, p_statement_line_id text)` | browser RPC | `authenticated` | 3.1; finance or CEO |
| `cockpit_manual_payments_to_check()` | browser RPC, `STABLE` | `authenticated` | 3.1 |
| `cockpit_manual_payment_state` revision bump on every check | in the RPC | | so a running refresh fails its write and reruns (MONEY-ATTRIBUTION) |
| `cockpit_settings` `forms.doors` merged with `{"checks":true}` (insert the key when absent; `jsonb` merge, never overwrite) | seed | | read by `cockpit_form_doors()` (3.1) |

### 2.6 `20261101o_churn_confirm.sql` (churn-confirm)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_churn_departures` columns `notice_on date`, `exit_call_id text`, `survey_response_id uuid REFERENCES cockpit_form_responses(id)`, `survey_state text NOT NULL DEFAULT 'not_sent' CHECK (survey_state IN ('not_sent','sent','filled','declined'))`, `why_detail text CHECK (why_detail IS NULL OR char_length(why_detail) <= 2000)`, `how_to_stop text` (same), `churn_type text CHECK (churn_type IS NULL OR churn_type IN ('mid_programme','completed'))`, `confirmed_by text`, `confirmed_at timestamptz`, `billing_event_id bigint REFERENCES cockpit_billing_events(id)` | columns | (table unchanged) | the 6 rows keep NULLs until the backfill |
| no new unique index: the live `cockpit_churn_departures_card_day` on `(clickup_task_id, left_on)` stays the rule, so a client who resumes and later leaves again gets a second departure and past months keep theirs (W21) | | | |
| `cockpit_churn_type_card(p_type text)` | function, `IMMUTABLE` | none | `mid_programme` → `Mid-programme loss (counts as churn)`; `completed` → `Completed term (does NOT count as churn)`; and the reverse `cockpit_churn_type_from_card(p_option text)` for the backfill |
| `cockpit_churn_type_default(p_task text, p_left_on date)` | function, `STABLE` | none | the day-90 rule (3.5) |
| `cockpit_form_notice_answer(p_response_id uuid, p_answer text, p_note text)` | browser RPC | `authenticated` | 3.1; "Not leaving" |
| `cockpit_client_lifecycle_confirm(p_kind text, p_args jsonb)` | browser RPC | `authenticated` | 3.1; `p_kind = 'churn'` only in wave 1 |
| `cockpit_churn_backfill_confirm(p_departure_id bigint)` | function | none (owner, deploy only) | 3.1; the 6-row backfill |
| `cockpit_csm_churn_read()` | replaced | `authenticated` | 4.5 |
| view `cockpit_client_lifecycle_v` | view | service_role `SELECT` | 3.2 |
| `cockpit_client_lifecycle_read(p_task_id text)` | browser RPC, `STABLE` | `authenticated` | 3.1 |
| `cockpit_settings` `forms.doors` merged with `{"churn":true}` | seed | | 3.1 |

### 2.7 `20261101p_money_acts.sql` (money-acts)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| unique partial index `cockpit_billing_events_request` on `((detail->>'request_id'))` where not null | index | | a repeated `requestId` returns the first result |
| `cockpit_billing_write` | replaced | `authenticated` | 4.7, 4.8, 4.9 |
| `cockpit_form_prefill(p_form_key text, p_task_id text)` | browser RPC, `STABLE` | `authenticated` | 3.1; CSM allowed on the client, finance or CEO; every prefill value with its source sentence |
| `cockpit_settings` seeds `billing.ladder` `{"pauseReviewDay":4,"cancelReviewDay":15}`, `billing.mrr_tolerance` `{"pct":10}`, `billing.daily` `{"on":false}`; `forms.doors` merged with `{"money":true}` | seed `ON CONFLICT DO NOTHING` (the merge as in `n`) | | |
| `cockpit_settings_forms_audit` | replaced | none | audits `billing.%` too |
| `cockpit_billing_ladder_read()`, `cockpit_billing_ladder_set(p jsonb)` | browser RPCs | `authenticated` | read: any billing seat; set: CEO or admin, `1 <= pauseReviewDay < cancelReviewDay <= 60` |
| `cockpit_billing_ladder_due()` | browser RPC, `STABLE` | `authenticated` | 3.1; the derived review rows |
| view `cockpit_extensions_v` | view | service_role `SELECT` | 3.2 |
| view `cockpit_late_payments_v` | view | service_role `SELECT` | 3.2 |
| `cockpit_extensions_read(p_from date, p_to date)`, `cockpit_late_payments_read(p_from date, p_to date)` | browser RPCs, `STABLE` | `authenticated` | CEO, finance, or a CSM for allowed clients |
| `cockpit_mrr_read()` | browser RPC, `STABLE` | `authenticated` | 3.1; card MRR, suggestion, the money refresh's rail check |
| `cockpit_billing_daily()` | function | `service_role` | 4.10 |
| pg_cron `mahara-billing-daily` at `10 5 * * *` (UTC, 08:10 Kuwait) calling `cockpit_billing_daily()` | cron block | | does nothing while `billing.daily.on` is false, and says so in `cockpit_sync_state` `billing-daily` |

### 2.8 `20261101q_readers.sql` (readers-guardian)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_ceo_goal_sheet_context(text)` | replaced (read its live md5 first; add it to the drift guard) | as live | adds `lifecycle: {extensions[], latePayments[], departures[]}` for the month from the three reads, each row with its source sentence |
| `UPDATE cockpit_goal_targets SET actual_source = ... WHERE plan_id = (the plan whose period_from = '2026-11-01') AND metric_key IN (...)` | data | | `extensionsGiven` → `clients.extensions.granted`; `clientsChurned` → `clients.churn.confirmed`; `churnRate` → `clients.churn.rate`; idempotent |

---

## 3. Shapes every slice builds to

### 3.1 RPC signatures

Every browser RPC: `SECURITY DEFINER SET search_path = ''`, gate first, an audit row for every
write, refusals as plain sentences with `ERRCODE` `42501` (who) or `22023` (what).

```
-- l (forms-foundation)
cockpit_form_record_legacy(p jsonb) RETURNS jsonb                       -- service_role
  p = {formKey:'exit_survey'|'pause_request', externalId text (Typeform token),
       submittedAt timestamptz, answers jsonb (<= 64 KB), hidden jsonb, taskId text|null,
       clientName text|null, backfill bool (default false)}
  -> inserts cockpit_form_responses(form_key, form_version 1, source 'typeform_webhook' (or
     'typeform_sync' when backfill), external_id, task_id, client_name, mode 'live',
     state 'legacy', answers, hidden, answer_meta {notice_on: Kuwait day of submittedAt},
     created_by 'forms-door', submitted_at);
     ON CONFLICT (form_key, external_id) DO NOTHING; then, only when inserted and not backfill:
     for exit_survey queues notice termination.notice (dedupe 'termination:'||id); pause_request
     queues no Slack notice (its "Pause request in" row on Today is the signal). When an
     exit_survey's taskId matches an unconfirmed, not removed departure, sets survey_response_id
     and survey_state 'filled' (plpgsql, guarded on the column: an information_schema.columns /
     pg_attribute check for cockpit_churn_departures.survey_response_id, never to_regclass,
     because the table already exists before o). Returns {inserted bool, responseId uuid,
     matched bool, noticeQueued bool}.
cockpit_form_legacy_match(p_response_id uuid, p_task_id text) RETURNS jsonb   -- authenticated
  CEO, or a CSM allowed on the picked card's client (so a CSM can match an unmatched survey only
  to one of their own clients). Only a legacy exit_survey or pause_request row with task_id NULL.
  Sets task_id and client_name from cockpit_billing_accounts; audit 'forms.legacy_match'.
cockpit_form_staff_record(p_form_key text, p_task_id text, p_answers jsonb, p_request_id uuid,
  p_source text DEFAULT 'cockpit') RETURNS uuid                          -- none (owner)
  form_key IN ('extension','pause','resume','churn_confirm','mrr'); state 'confirmed',
  external_id 'req:'||p_request_id (a repeat returns the first id). p_source 'cockpit':
  created_by_id auth.uid() (refuses when NULL, matching cockpit_form_responses_check1),
  created_by/confirmed_by the caller's email. p_source 'import': only when auth.uid() IS NULL
  (the owner path through Composio), created_by_id NULL, created_by/confirmed_by
  'the CEO''s word (Q5), 2026-11-01'; any other source is refused.
cockpit_form_trail(p_ref jsonb) RETURNS jsonb                            -- authenticated, STABLE
  p_ref = {eventId? bigint, responseId? uuid, departureId? bigint}
  -> {stored:{state:'done'|'none', at}, card:{state:'none'|'held'|'queued'|'sending'|'retry'|
      'delivered'|'skipped'|'failed', mode, error, at}, notice:{kind, state:'none'|'queued'|
      'posted'|'failed'|'skipped'|'muted', channelName, error, permalink}}
  Gate: CEO, finance, or a CSM allowed on the event's client. card.state 'held' when the
  queue row is dry_run. Never returns a token, an email or a request body.
cockpit_form_notices_in() RETURNS jsonb                                  -- authenticated, STABLE
  -> [{kind 'termination'|'pause_request', responseId, taskId|null, clientName, noticeOn,
       submittedAt, matched bool, departureId|null}]
  every live/legacy exit_survey response with no confirmed departure for its card and no
  answer_meta.answered, and every pause_request response with no pause event recorded for its
  card after it and no answer_meta.answered. Matched rows: CSM sees allowed clients only, CEO
  all. Unmatched rows (task_id NULL): every CSM seat and the CEO, client name from the form's
  hidden field, labelled "Not matched to a card" with "Pick the card" (W12, W22).
cockpit_form_doors() RETURNS jsonb                                       -- authenticated, STABLE
  -> {churnConfirm, extension, pause, mrr, reviews, checks, prefill: bool} each true only when
  every function that door calls exists (to_regprocedure on the names of this section) and the
  door's marker in `cockpit_settings` key `forms.doors` is true: `o` merges `{"churn":true}`,
  `p` merges `{"money":true}`, `n` merges `{"checks":true}` (`jsonb` merge, never overwrite).
  A rollback that restores an old body flips its marker to false in the same step, because a
  restored old function still exists and would otherwise pass the check.
  Any signed-in seat. A door whose flag is false hides itself and its place reads
  "Opens after the next cockpit update." (5.2); the apps never call an RPC the flag says is
  missing.

-- m (billing-rails)
cockpit_clickup_fields_put(p_list text, p_fields jsonb) RETURNS integer  -- service_role
cockpit_billing_canary(p_kind text, p_args jsonb) RETURNS bigint         -- owner only
  Refuses any card but 86eywg1cq: 'The canary writes only the test card 86eywg1cq.'
  p_kind IN ('churn','extension','pause','resume','mrr','late','date'); builds the event exactly
  as the real function would (same detail keys, 3.3, through cockpit_billing_detail), source
  'ceo' (or 'system' when p_args.system is true, for an extension clear or a late event),
  by_whom 'canary'. Returns the event id. Never used by a screen.
cockpit_billing_event_void(p_event_id bigint, p_reason text) RETURNS jsonb   -- authenticated
cockpit_billing_event_void_owner(p_event_id bigint, p_reason text, p_actor text) RETURNS jsonb -- owner
cockpit_billing_held_release(p_event_id bigint, p_how text, p_reason text, p_actor text)
  RETURNS jsonb                                                          -- owner only (2.4)
  -> {itemId, how, newEventId|null, state}.
cockpit_billing_detail(p_kind text, p_args jsonb) RETURNS jsonb          -- none (owner)
  the one builder of an event's detail for every kind of 3.3; cockpit_billing_write (p),
  cockpit_client_lifecycle_confirm (o) and the canary all call it.

-- n (checked-money)
cockpit_manual_payment_check(p_id text, p_verdict text, p_ref text, p_statement_line_id text)
  RETURNS jsonb                                                          -- authenticated
  Finance or CEO. Only a 'logged' row. verdict 'checked' needs p_statement_line_id, or p_ref of
  3 to 200 characters naming the bank reference; 'rejected' needs p_ref as the reason. Sets
  check_state, checked_by, checked_at, checked_ref, statement_line_id; bumps
  cockpit_manual_payment_state.revision; audit 'billing.payment_check'.
  Refusals: 'Only finance or the CEO checks a payment against the bank.' /
  'This payment was already checked on {day}.' / 'Name the bank reference or pick the
  statement line, so the check reads back.'
cockpit_manual_payments_to_check() RETURNS jsonb                        -- authenticated, STABLE
  -> [{id, day, clientName, taskId, amount, currency, amountUsd, rail, reference, evidenceUrl,
       addedBy (role, not email), addedAt, daysWaiting}] for check_state 'logged';
  CEO and finance: all; CSM: own clients (read only).

-- o (churn-confirm)
cockpit_client_lifecycle_confirm(p_kind text, p_args jsonb) RETURNS jsonb  -- authenticated
  p_kind 'churn'. p_args = {taskId, requestId uuid, leftOn date (<= today), noticeOn date|null,
  reason (one of the 8 register reasons), churnType 'mid_programme'|'completed',
  whyDetail (>= 10 chars), howToStop (>= 10 chars), mrrLostUsd number|null, exitCallId|null,
  surveyState 'not_sent'|'sent'|'filled'|'declined', surveyResponseId uuid|null}
  Gate: CEO, or a CSM allowed on the client (cockpit_client_allowed). Card must be on the
  billing sheet. Updates the card's latest departure only when it is not removed, not
  confirmed, and has no `resume` billing event after its left_on (an "open" departure, W21);
  otherwise inserts a new departure (left_on as given; the (task, left_on) index refuses a
  second row for the same day with "This client already has a departure on {date}; confirm
  that one."). Writes the new columns, confirmed_by/at; records the response
  (cockpit_form_staff_record 'churn_confirm');
  inserts billing event kind 'churn' (source 'ceo'|'csm', 3.3 detail), links billing_event_id;
  queues notice churn.confirmed (dedupe 'churn:'||departure id); writes a cockpit_churn_log row
  and an audit row. Repeat requestId returns the first result.
  -> {departureId, eventId, responseId, cardState}.
  Refusals: 'Pick the day they left, today or before.' / 'Say why they left in detail, so the
  lock-in reads back.' / 'Say how we stop this next time.' / '{client} is not one of your
  clients. Ask its CSM or the CEO to confirm the churn.'
cockpit_churn_backfill_confirm(p_departure_id bigint) RETURNS bigint     -- owner only
  Builds the confirm from the register row (reason, left_on, why_detail = the row's note,
  how_to_stop 'Recorded before the confirm existed (Q5).'). The type comes from the card's
  current Churn Type (the latest cockpit_client_billing_days snapshot's churn_type, mapped by
  cockpit_churn_type_from_card), which is the CEO's hand mark of 11-01; the day-90 default is
  used only when the card's field is empty. Event source 'ceo', by_whom 'the CEO''s word (Q5),
  2026-11-01', clear_paused true when the mirror shows a Paused On. The response is recorded
  with p_source 'import' (it runs with no auth.uid()). Refuses a row already confirmed.
cockpit_client_lifecycle_read(p_task_id text) RETURNS jsonb             -- authenticated, STABLE
  the view's row for one allowed card, plus the latest 5 billing events (kind, at, seat role).
cockpit_form_notice_answer(p_response_id uuid, p_answer text, p_note text) RETURNS jsonb
                                                                         -- authenticated
  "Not leaving". p_answer 'staying' (exit_survey) or 'handled' (pause_request); p_note >= 4 characters ('Say what the client said, so
  the answer reads back.'). Gate: CEO, or the CSM allowed on the response's card (an unmatched
  response is matched first). Writes a cockpit_churn_log row "Answered the notice: staying" with
  the note, an audit row 'forms.notice_answer', and answer_meta.answered = {answer, note, by
  (role), at} on the response (the one change a legacy row allows; cockpit_form_notices_in then
  leaves it out). A second answer is refused: 'This notice was answered on {day}.' The builder
  reads the triggers on cockpit_form_responses first; if one refuses an answer_meta change on a
  legacy row, `o` adds a carve-out for that one key under a transaction-local setting, as 4.2.2
  does for the check columns. The same function answers a "Pause request in" row with
  p_answer 'handled' (the CSM paused, or agreed otherwise; the note says which).

-- p (money-acts)
cockpit_billing_write(p_action text, p_args jsonb)  -- unchanged signature; 4.7 to 4.9
cockpit_form_prefill(p_form_key text, p_task_id text) RETURNS jsonb      -- authenticated, STABLE
  Gate: a CSM allowed on the client, finance or the CEO.
  -> {values: Prefill[] ({key, value, source}; value NULL with a source sentence such as
      "Nobody holds this yet" when nothing does, never 0),
      calls: [{id, at, kind, source}] for the card's last 30 days from cockpit_csm_calls and the
      1-1 responses (cockpit_form_responses form_key 'checkin'),
      hints: [{text, source}] (an extension hint when the latest 1-1 response in 30 days mentions
      "extension"),
      card: {status, nextDate, nextAmountUsd, plan, mrrUsd, pausedOn, extensionWeeks} from the
      mirror, each with source "the ClickUp card",
      grant: the live cockpit_extensions_v row or NULL,
      survey: the latest exit_survey response for the card or NULL,
      churnTypeDefault (churn_confirm only, from cockpit_churn_type_default)}.
  One read per sheet open; FormSheet shows each value as "{value} · from {source}".
cockpit_billing_ladder_read() / cockpit_billing_ladder_set(p jsonb) RETURNS jsonb
cockpit_billing_ladder_due() RETURNS jsonb                               -- authenticated, STABLE
  -> [{taskId, clientName, step 'pause_review'|'cancel_review'|'pause_day14', dueOn,
       daysLate, amountUsd, extendedUntil|null, pausedOn|null}]; CSM: allowed clients.
cockpit_extensions_read(p_from date, p_to date) / cockpit_late_payments_read(p_from, p_to)
cockpit_mrr_read() RETURNS jsonb                                         -- authenticated, STABLE
  -> {asOf (money section updated_at)|null, tolerancePct, rows:[{taskId, clientName,
      mrrUsd|null, suggestedUsd|null, suggestionWhy, railMonthlyUsd|null, railNote,
      flag 'missing'|'differs_suggestion'|'differs_rail'|'ok'|'not_recurring'}],
      totals:{onBooks, suggested, differ},
      downgrades:[{taskId, clientName, fromUsd, toUsd, effective, reason, seatRole}] for mrr
      events this Kuwait month whose to < from (Q13; the CEO Billing tab's "Downgrades this
      month")}
  railMonthlyUsd comes from cockpit_sections key 'money' payload.mrrCheck (3.6); when that
  section is older than 36 hours, railMonthlyUsd is NULL and railNote says
  'The money refresh is older than a day and a half, so rail cash is not compared.'
cockpit_billing_daily() RETURNS jsonb                                    -- service_role

-- deploy only (added in l, used at D-R1)
cockpit_request_type_add(p_row jsonb) RETURNS text                       -- owner only
  inserts one cockpit_request_types row (key, type_index, label, clickup_option_name,
  request_type_option_id, team, targets checked by cockpit_request_targets_checked, fields,
  due_days, priority, set_request_type, enabled); refuses an existing key; audit row.
```

### 3.2 View columns

`cockpit_extensions_v` (billing events only; W9):

| Column | Rule |
|---|---|
| `grant_id bigint` | the `extension` event id, `source IN ('ceo','csm','maher')`, `detail->>'weeks'` 1, 2 or 4 |
| `clickup_task_id`, `client_name` | from the event |
| `granted_at timestamptz`, `granted_on date` | `at`, and its Kuwait day |
| `weeks integer` | `detail->>'weeks'` |
| `from_date date` | `detail->>'from'`, else `coalesce(from_value::date, granted_on)` |
| `until date` | `detail->>'new_date'`, else `to_value::date` when `detail->'movedDate' = true`, else `granted_on + weeks * 7` |
| `ours boolean`, `at_risk boolean` | `detail->>'ours'`, `detail->>'at_risk'` (NULL on the two 10-19 grants: "not asked then") |
| `reason`, `limitations text[]`, `call_id`, `no_call_reason`, `prevent`, `response_id uuid` | from `detail` / `reason` |
| `seat_role text`, `by_whom text` | `detail->>'seat_role'`; email kept for the audit only, screens show the role |
| `replaces_grant_id bigint`, `replaced_by bigint` | `detail->>'replaces_grant_id'` of this grant, and the id of the grant that replaced it (W23) |
| `state text` | `replaced` when `replaced_by` is set; else `live` when `until >= today (Kuwait)`; else `ended` |
| `cleared_at timestamptz` | the first `system` extension event with `detail->>'grant_id' = grant_id` |

Voided events (`cockpit_billing_event_voids`) are left out; a `fresh` re-record (W20) carries
`detail.replaces_event_id` and stands in for the voided original. Shadow assertion (8): on
today's data the view returns exactly Liwan `86ewvnqj5` and Marble `86eymcqdq`, both 10-19,
until 2026-11-02; after D-B5 voids Marble (Q3), Liwan alone (asserted at D-P1, when the view
exists).

`cockpit_client_lifecycle_v` (one row per mirrored card):
`clickup_task_id, client_name, client_status, paused_on, pause_event_id, pause_kind
('client_request'|'non_payment'|NULL), pause_restart date (Resume On, from the latest live pause
event's detail.restart), pause_days integer, extension_until date (a live grant), departure_id,
left_on, churn_confirmed_at, survey_state, days_late integer (the open late spell), ladder_step
('none'|'pause_review'|'cancel_review'|'pause_day14')`.

`cockpit_late_payments_v` (over `cockpit_client_billing_days`; W10):

| Column | Rule |
|---|---|
| `clickup_task_id`, `client_name` | |
| `due_on date` | the `next_payment_date` of a spell: a maximal run, over the ordered snapshot days **present** (not calendar days), of days with stage Active and `day > next_payment_date`. A missing snapshot day (2026-10-08 is missing, 11.2-n) continues the spell when the stage and the date are unchanged on both sides of the gap; it never splits one spell in two |
| `amount_usd numeric` | `next_payment_usd` on the spell's first day; NULL stays NULL ("amount missing") |
| `ended_on date` | the first snapshot day after the run where the date moved past `due_on` or the stage left Active; NULL while open |
| `closed_how text` | `open`, `extended` (an extension event moved the date within 1 day of `ended_on`), `stopped` (the stage left Active), `date_moved` (anything else: a payment or a hand edit) |
| `paid_on date` | the earliest rail payment (`cockpit_client_payments`, `checked`) for the card from `due_on - 3` to `coalesce(ended_on, today)`; NULL when none, said as "no payment on the rails" |
| `days_late integer` | `coalesce(paid_on, ended_on, today) - due_on` |
| `late_event_id bigint` | the `late` open event of this spell, when the daily step opened one |

### 3.3 What each billing event writes on the card (`m`; the only place these shapes live)

Field keys (BILLING_FIELDS in `clickup-writeback/billing.ts`; `extension` relabelled):

| Key | Field | Id | Format |
|---|---|---|---|
| `status` | Client Status | `9368ca9e-3549-4320-84ff-9abd0a2901cb` | dropdown |
| `nextDate` | Next Payment Date | `669ae046-bf82-4b59-80d5-bf25d6b57ef3` | date |
| `pausedOn` | Paused On | `930c49eb-9374-410c-801f-9aa81fff4944` | date |
| `extension` | Current extension (weeks) | `8cb9d308-5df5-4ea1-b83d-32b5b7eea778` | number |
| `resumeOn` | Resume On | `d3c46259-3017-4429-a52a-c609a40f348b` | date |
| `churnDate` | Churn Date | `42429a6e-5cba-4a3b-964d-2b493315421b` | date |
| `churnReason` | Churn Reason | `796f25e7-7e63-4d08-9ec4-41c58a5b57ca` | dropdown |
| `churnType` | Churn Type | `a121f39a-f8a4-41f5-905e-a735ee729071` | dropdown |
| `mrr` | MRR | `48eb6023-8944-4404-9e30-b01fc8a38256` | number (a currency field takes a number) |
| `ltv` | LTV | `11d70e58-20e7-4ff0-85c6-51de42f044d2` | number |
| `willNotContinue` | Will not continue if billed on schedule | prefix `9cfdb353`, resolved per run from the Clients - Mahara field read (W7) | checkbox (new Format) |

The checkbox writes `POST {value: true|false}`; `cardValue` reads `true`/`"true"` as `"true"` and
anything else set as `"false"`. A prefix that matches no field, or more than one, or a field that
is not a checkbox, skips that step with "The will-not-continue checkbox (9cfdb353) is not on
Clients - Mahara, so it was not written." and the rest of the item still runs.

| Event (`kind`, `source`) | `detail` keys the writer sets | Writes, in order | Comment (`payload.comment`, posted silently) |
|---|---|---|---|
| `extension` ceo/csm | `weeks, ours, movedDate, new_date, from, reason_cat?, limitations[], at_risk, call_id?, no_call_reason?, prevent?, response_id, request_id, seat_role` | `extension`=weeks; `nextDate`=to (when movedDate); `willNotContinue`=at_risk (when the key is present) | `CLIENT EXTENSION: {n} weeks, to {date}` / `Why: {reason}` / `Ours to control: yes|no` / `Client limits: {list}` / `Will not continue if billed on schedule: yes|no` / `Call: {date}` or `No call: {reason}` / `By: {seat role}` |
| `extension` system | `weeks: 0, reason: 'grant ended', grant_id` | `extension`=0 | none |
| `pause` ceo/csm | `pause_kind, on, restart?, reason_cat, call_id?, consent {kind, call_id?, evidence_url?}, response_id, request_id, seat_role` | `status`=Paused (old=from); `pausedOn`=on; `resumeOn`=restart (when present) | `PAUSE AGREED {on} to {restart or "no restart date"}` / `Kind: client request|non-payment` / `Why: ...` / `Consent: on the call {date}` / `By: {seat role}` |
| `resume` ceo/csm | `on, nextDate?, response_id, request_id, seat_role` | `status`=Active; `pausedOn` clear; `resumeOn` clear; `nextDate` (when given) | `RESUMED {on}` / `Next payment: {date}` / `By: {seat role}` |
| `churn` ceo/csm | `left_on, card_reason (from cockpit_churn_reason_card; NULL for Other or a missing option), card_type, clear_paused bool, departure_id, response_id, request_id, seat_role, why_detail` | `churnDate`=left_on **first** (a ClickUp automation appears to date cards when Client Status changes, 20261101g; so the date goes first, and `register-vs-card` compares the card's Churn Date with `left_on`, which catches an automation overwrite after the read-back passed); `status`=Stopped (old=from); `churnReason`=card_reason (skipped when NULL); `churnType`=card_type; `pausedOn` clear (when clear_paused) | `CHURN CONFIRMED: left {date}` / `Reason: {register reason}` (and `Not on the card's list, so the field is left empty.` when skipped) / `Type: {type}` / `Why: {detail}` / `Notice on: {date}` / `Exit survey: {state}` / `By: {seat role}` |
| `mrr` ceo/csm | `from, to, reason_cat, effective, win_id?, request_id, response_id, seat_role` | `mrr`=to (old=from) | `MRR {from or "none"} → {to} from {effective}` / `Why: {reason}` / `By: {seat role}` |
| `ltv` system | `sum, rows, as_of` | `ltv`=to | none |
| `late` system | open: `due, spell_day, amount_usd`; close: `closes (event id), days_late, paid_on?, closed_how` | none | close only: `LATE {n} days: due {due}, {closed_how words}` (`paid {date}`, `extension moved the date`, `client stopped`, `the date moved on the card`) |
| `method`, `plan`, `amount`, `date`, `payment`, `note` | unchanged | unchanged | unchanged (`note` keeps "Billing note (...)") |

`seat_role` words in comments: `the CSM`, `finance`, `the CEO`, `the cockpit` (system). No email
and no name on the card (roles, not names). Every comment ends with `refLine(item.id)` as today.

### 3.4 Notice kinds (`l`)

| Kind | Label | Shape | Channel (seeded) | Mention | Enabled at seed | Live rule (`cockpit_slack_notice_live`) | Text (`cockpit-notices/text.ts`) |
|---|---|---|---|---|---|---|---|
| `termination.notice` | Termination notice in | post | #csm-general `C09RZ0GS0V9` | `seat:csm` | yes | the response has no confirmed departure and no `answer_meta.answered` | matched: `{client} sent the termination survey. Confirm churn or answer the notice in the cockpit.` + button "Open the client"; unmatched: `{client name from the form} sent the termination survey. It is not matched to a card yet: pick the card in the cockpit.` + button "Open the churn tracker" |
| `termination.submitted` | Termination survey sent | post | #csm-announcements `C09SNG5BP53` | none | **no** (W4) | the response exists | `{client} sent the termination survey.` |
| `churn.confirmed` | Client has left | post | #csm-announcements | none | yes | the departure is not removed | `{client} has left: {reason}.` |
| `extension.granted` | Extension given | post | #csm-announcements | none | yes | the event is not voided | `{client}: {n}-week extension to {date}.` |
| `pause.agreed` | Pause agreed | post | #csm-announcements | none | yes | not voided | `{client}: paused from {on}{, restarts {restart}}.` |
| `client.resumed` | Client resumed | post | #csm-announcements | none | yes | not voided | `{client}: resumed {on}.` |

`termination.notice` and `termination.submitted` post in different channels, so the "one post
per event per channel" rule holds while Make 9805538 [5] still posts in #csm-announcements.
`legacy.received` is not a kind in waves 1 and 2 (1.2). The backfill (`p.backfill`) queues no
notice at all, so no month-old survey is posted.

Facts are names and dates only: never an amount, a lead count, an email or a phone. A kind whose
channel row is not `ok` settles `failed` with `Not posted: the bot is not in #{channel}. Ask the
CEO to invite it.` (the existing fail-closed rule; the doctor refuses a save to such a channel).

### 3.5 Rules the SQL enforces

- **Day-90 rule** (`cockpit_churn_type_default`): the inputs are `cockpit_churn_departures.launched_on` (else the latest snapshot's `launch_date` from `cockpit_client_billing_days`) and that snapshot's `next_renewal_date` (`cockpit_billing_accounts` holds neither). `completed` only when `left_on >= launched_on + 90` **and** a `next_renewal_date` is known and on or before `left_on` (the term finished); otherwise `mid_programme`, which counts as churn (the safe side: today all six departures have a NULL renewal date, 11.2-e). The CSM may change it with a reason in `whyDetail`. The backfill takes the card's own type (3.1).
- **One open grant per card, extended by replacement** (W23): while a grant is `live`, a new grant must carry `replacesGrantId` = the live grant's id; the new date moves from the later of the card's date (already moved by the live grant) and today, the old grant reads `replaced`, and only the newest grant is cleared on end. Without it: `An extension already runs to {date}. Open Give more time again to add weeks to it.` (the client page and the billing sheet send it themselves, 4.7).
- **A pause for a client request** needs `restart > start`, a `call_id`, and consent: `{kind:'call', term_runs:true, over_14_ends:true}` (the CSM's two required ticks: "On the call the client agreed the 90-day term keeps running." and "On the call the client agreed that a pause over 14 days ends the engagement.", the second shown bold when restart is more than 14 days away; both checked in SQL: `Tick both consents the client gave on the call.`) until a `pause_consent` registry row exists with provider `native` (wave 3), then a submitted `pause_consent` response under 14 days old (W8). Start is today (W11).
- **MRR 0** needs a reason; a lower MRR from a CSM is allowed with a reason (Q13) and listed under "Downgrades this month" on the CEO Billing tab.
- **Missing is never zero**: every read returns NULL with a sentence, never 0, for a value nobody holds.

### 3.6 Payload keys between slices

- `cockpit_sections` key `money`, `payload.mrrCheck` (written by checked-money's `money.js`, read by money-acts' `cockpit_mrr_read`): `{asOf, rows:[{taskId, railMonthlyUsd, months: 2, rails: ['whop','tap','ecom','manual'], note}]}`; `railMonthlyUsd` = tied recurring rail cash over the last two full months divided by 2, `checked` manual rows only; a card with no tie is left out (never 0).
- `payload.rails.manualLogged` (money.js → CEO Money tab): `{count, usd, oldestDay}` of `logged` rows; the cash total excludes them.
- Each `transactions[]` row from money.js gains `checked: boolean` (manual rows only; rails are always true).

### 3.7 The staff forms (`formDefs.ts` is the definition; the registry `schema` is a record of the same keys, W19)

| Form key | Title | Fields (key: type, rule) | Submit / done | Effects (registry) |
|---|---|---|---|---|
| `extension` | Give more time (with a live grant: "Add to the extension", line "An extension runs to {date}; these weeks add from that date.", and `replacesGrantId` sent from the prefill's `grant`) | `weeks`: choice 1/2/4 required; `reason`: text >= 4 required; `ours`: yes/no required ("In or out of our control"); `limitations`: multi, 8 options optional; `atRisk`: yes/no required ("Will they stop if billed on schedule?"); `callId`: call pick (from the prefill's `calls`), or `noCall` tick with `noCallReason` >= 4; `prevent`: text optional | "Give {n} weeks" / "Given" | `record` sql cockpit; `card` clickup_queue cockpit; `notice` slack_notice cockpit |
| `pause` | Pause this client | `pauseKind`: client request / non-payment required; `restart`: date, required for client request, after today; `reasonCat`: 5 choices (Client asked, Not paying, Client's own launch slipped, Seasonal, Other) required; `reason`: text >= 4; `callId`: required for client request (call pick); `consentTerm`, `consentOver14`: two required ticks for a client request (3.5 wording) | "Pause this client" / "Paused" | same three |
| `resume` | Resume this client | `on`: date, default today; `nextDate`: date optional, suggested = old date + pause length | "Resume this client" / "Resumed" | same three |
| `churn_confirm` | Client is leaving | `leftOn` date; `noticeOn` date optional (prefilled from a survey); `reason` 8 register reasons; `churnType` (prefilled by the day-90 rule); `whyDetail` >= 10; `howToStop` >= 10; `mrrLostUsd` (prefilled from the card); `exitCallId` optional; `surveyState` 4 choices | "Confirm churn" / "Churn confirmed" | `record`, `card`, `notice` |
| `mrr` | Set MRR | `mrrUsd`: number >= 0; `reasonCat`: price change / plan change / upsell / downgrade / correction; `reason`: text >= 4 (required when 0 or lower); `effective`: date, default today | "Set MRR to {usd}" / "MRR set" | `record`, `card` |

The eight extension limitations are the cockpit's own list (W17), in this order: `No limitations`,
`Budget`, `Launch slipped on their side`, `Ad account or page issue`, `Content not ready`, `Team or
owner change`, `Season or holiday`, `Other`. `No limitations` cannot be picked with another.

The sheet header carries the full client name in `<bdi>`; no submit label cuts a "first name"
(clients are companies, some named in Arabic).

---

## 4. The builds

### 4.1 B0: billing switch, fields, field map, canary (billing-rails)

Files: `supabase/functions/clickup-writeback/{billing.ts, billing.test.ts, queue.ts, queue.test.ts, run.ts, run.test.ts, index.ts}`, `supabase/functions/billing-sync/{billing.ts, billing.test.ts}`, migration `m`, `apps/media-buyer-cockpit/scripts/billing-rails-supabase.test.ts`.

1. `run.ts`: a new `billingGate(env)` → `{apply, kinds:Set, only:Set, mode, live(item)}`; `live` is `apply && kinds.has(payload.kind) && (only.size === 0 || only.has(taskId))`. In `runLog`, a `billing` item is live **only** by `billingGate`; `gate().apply` no longer opens it (W2). The header comment lists the three secrets with the other five. The run note adds `billing: {mode} ({kinds or "no kinds"})` and `cockpit_sync_state` `clickup-writeback:billing` gets `{mode, kinds, onlyCards, delivered, held, failed}` each run.
2. A new job `billing_doctor` in `JOBS` (index.ts, run.ts): reads the Clients - Mahara list fields once (through the existing paced provider, so every call lands in the health ledger), calls `cockpit_clickup_fields_put('901816559981', fields)`, then checks: Client Status has Paused, Active and Stopped; Churn Type has both options of 3.5; Churn Reason's option names are listed in the note, and each register reason but Other must map through `cockpit_churn_reason_card` (Completed term → "Completed term, did not renew"; missing ones listed, never fatal); exactly one field starts `9cfdb353` and it is a checkbox; Resume On, Churn Date are dates; MRR and LTV are numbers or currency. It writes `clickup-writeback:billing-doctor` with one sentence per gap.
3. `billing.ts`: the fields of 3.3; `Format` gains `"checkbox"`; `billingSteps` takes `payload.comment` (raw, no prefix) beside `payload.note`; the `willNotContinue` step resolves its id from the run's list read (`listFieldsLoader`) by prefix; `billingRequest` writes the checkbox.
4. `queue.ts`: the `billing_field` step's format union gains `"checkbox"`; read-back compares through `cardValue` for every format.
5. `billing-sync/billing.ts` `columnsOf`: `churn` → `client_status`, `churn_date`; `mrr` → `mrr_usd`; `system` joins `HUMAN` for kind `extension` only (so a clear is held on the mirror until delivered).
6. Migration `m` per 2.4 and 3.3. `cockpit_billing_canary` builds the detail with the same helper the real functions use (a shared plpgsql `cockpit_billing_detail(kind, args)` in `m` that `p` and `o` call too, so the canary and the real path cannot differ).
7. **Held billing edits (W20).** `dry_run` stays terminal for the claim (`cockpit_clickup_writeback_claim` is not touched). Each kind opening (D-B8, D-C1, D-C2, D-P3) runs the held-edit review: list that kind's `dry_run` billing items, read each card, then call `cockpit_billing_held_release` per item with `replan`, `fresh`, `close` or `void`, a person deciding each. The run note and `clickup-writeback:billing` add `heldOpenKind` (the count of `dry_run` billing items whose kind is open) so the guardian can warn. The other held log edits (Q19) are never touched.

### 4.2 CK: checked money (checked-money)

Files: migration `n`; `hermes/ceo-refresh/native/adapters/{money.js, clients.js, growth.js}` and a new `hermes/ceo-refresh/checked-money.test.ts`; `apps/media-buyer-cockpit/src/pages/ceo/{MoneyTab.tsx, moneyManual.tsx, TransactionsTab.tsx}`; the pairs `apps/{client-success,media-buyer}-cockpit/src/components/billing/{PendingPayments.tsx, ChecksWaiting.tsx}`, `.../src/lib/{billingBalances.ts, paymentChecks.ts}`; `apps/media-buyer-cockpit/scripts/checked-money-supabase.test.ts`, `apps/media-buyer-cockpit/scripts/billing-pending-screen.test.tsx`.

1. Ingest: every inbox row lands `check_state = 'logged'` (CSM, agent, other). `cockpit_ceo_manual_payment_add`: `checked` when `request_data.reference` (or the new `p.checkedRef`) names a bank reference of 3+ characters, with `checked_by` the CEO's email and `checked_ref` that reference; otherwise `logged`.
2. The protect trigger allows exactly one move of the five check columns, from `logged` to `checked` or `rejected`, and only inside `cockpit_manual_payment_check` or the Q20 statement (a transaction-local `cockpit.payment_check` setting the two set and the trigger reads; anyone else gets the existing refusal).
3. `money.js`: `normalizeManual` reads `check_state`; cash totals, `money.book.collected`, attribution totals and the deal payments written for pay use `checked` rows only; `rails.manualLogged` and `transactions[].checked` per 3.6; `mrrCheck` per 3.6 from the same tied rail rows. `clients.js` (LTV and last paid): `checked` only, with "{n} logged payment(s) wait on a check" in its note. `growth.js` ledger: logged rows shown with `rail 'manual'` and `checked:false`, not summed into cash.
4. `cockpit_finish_finance_refresh` computes `checked` in SQL, never from the refresh output: a rail row (whop, tap, ecom) is always true; a manual row is true only when its `cockpit_manual_payments.check_state = 'checked'` (joined by id); a manual row with no match is false. So an old adapter (between D-N1 and D-N2, or after a D-N2 rollback) cannot land a logged row as checked. The deal ledger keeps only checked rows. `cockpit_billing_deal_rails_held` returns `checked`; Pending payments shows a part paid by a logged row as "Receipt in, not checked" (amber), never "Paid". The three CSM projection functions count `checked` only, and `cockpit_csm_projection_read` shows logged rows on their own line, never as collected.
5. Screens: CEO Money tab cash tile adds the line; `moneyManual.tsx` adds the state chip and Check / Reject; `TransactionsTab.tsx` a "Not checked" chip; `ChecksWaiting` (both apps) lists `cockpit_manual_payments_to_check()` with the two actions for finance and the CEO (5.7), and on each row the button `Open the receipt check` (the prefilled request form, type `payment_receipt_check`, requester the person who presses, source `client_page`; hidden until D-R1 has added the type, read from the requests catalogue the request form already loads). It mounts only when `cockpit_form_doors().checks` is true.

### 4.3 F0a: the forms base (forms-foundation)

Files: migration `l`; `supabase/functions/cockpit-notices/{text.ts, send.ts, doctor.ts, text.test.ts, run.test.ts, testkit.ts}`; `apps/client-success-cockpit/src/lib/notices.ts`, `src/components/NoticesRouting.tsx`, `src/dev/noticesFixtures.ts`; `apps/media-buyer-cockpit/scripts/forms-stage3-base-supabase.test.ts`.

1. `cockpit_form_registry_apply`: the line `IF f.key <> 'checkin' THEN RAISE ...` becomes: `checkin` keeps every 2b rule; keys in `('exit_survey','pause_request','kickoff','blueprint')` accept owner changes from the CEO seat (`via 'cockpit'`, `who 'ceo'`) and, for `exit_survey` and `pause_request` only, a provider move `typeform` → `native` by the CEO; the five staff forms are refused with `This form is set in the cockpit's code until the form editor ships.` (W19); every other key: `That form changes only by migration until its editor ships.` Kickoff and Blueprint stay as they are (no patch is sent to them by anything here).
2. The notice functions per 3.4; the text renderer and `NOTICE_KINDS` in `text.ts` and the screens' `notices.ts`/`NoticesRouting.tsx` gain the six kinds with their labels and one-line blurbs (5.9).
3. `cockpit_form_staff_record`, `cockpit_form_trail`, `cockpit_form_notices_in`, `cockpit_form_doors`, `cockpit_request_type_add` per 3.1; the CHECK swaps of 2.3 (notices kind, settings kind, settings channel, forms-keys provider) and `cockpit_forms_door_seen` per 2.2. The PGlite test seeds the six settings rows (so a missed swap fails the test, not D-L1), saves a key for each new provider, and calls `cockpit_forms_door_seen` for `exit_survey` and `pause_request`.

### 4.4 C4a-2: the termination receiver (forms-foundation)

Files: `supabase/functions/forms-door/{handler.ts, handler.test.ts, index.ts, README.md}`; `scripts/dev/{forms_key.py, test_forms_key.py, forms_legacy_backfill.py, test_forms_legacy_backfill.py}`.

1. `FORM_KEYS = ["kickoff", "exit_survey", "pause_request"]`; the provider key is `typeform_${formKey}`; the registry cache and the secret cache become per form (`Map`); the unsigned-seen limiter per form. Kickoff's path is unchanged byte for byte in behaviour (its tests stay green unedited except the `FORM_KEYS` assertion).
2. For `exit_survey`, after the signature: `formAnswers`/`fieldTitles` (the existing helpers) turn the `form_response` into `answers {fields:[{ref, title, type, value}]}`; the card is the hidden field `onboarding_client_id` (the form's own hidden id, set by the card's Termination Form Link `24a77b61`; `docs/forms/maps/typeform-inventory.md`), when its value is a card id present in `cockpit_billing_accounts`, else NULL; `hidden.client_name` is stored but never used to match (shown unmatched; never a name guess, W12); then `cockpit_form_record_legacy`. `pause_request` (Typeform `CTUjv6l3`) takes the same path; its card hidden field is read from the form's own definition in `docs/forms/maps/typeform-inventory.md` (the builder notes it in the README; no card id, no match). The log line stays `forms-door {form} {outcome}`; every delivery calls `cockpit_forms_door_seen(form, ...)`.
3. `forms_key.py`: `TYPEFORM_FORMS` gains `"exit_survey": "typeform_exit_survey"` and `"pause_request": "typeform_pause_request"`; the help text names all three forms; `register-typeform {form}` touches only the cockpit webhook and reads every other webhook before and after (as for kickoff).
4. `forms_legacy_backfill.py {exit_survey|pause_request}` (runs on the VPS like `forms_key.py`): reads the form's responses through the Typeform API with `TYPEFORM_TOKEN` by name (provider-health receipts as `forms_key.py` writes them), posts each to `cockpit_form_record_legacy` with `backfill: true` and the service key by name, prints counts only (`read 4, stored 4, already there 0, unmatched 1`). `--dry` reads and prints counts without writing. A backfilled row queues no notice.

### 4.5 L0: the churn confirm (churn-confirm)

Files: migration `o`; `apps/client-success-cockpit/src/pages/ChurnPage.tsx`, `src/lib/{churnClient.ts, churnCore.ts, churnSchema.ts}`; `apps/media-buyer-cockpit/src/pages/ceo/churnRegister.ts`; `apps/media-buyer-cockpit/scripts/churn-confirm-supabase.test.ts`, `apps/client-success-cockpit/scripts/churn.test.ts`.

1. SQL per 2.6 and 3.1. `cockpit_csm_churn_read()` returns the new columns on each departure, a `notices` list (from `cockpit_form_notices_in()`, termination rows), `unmatched` legacy surveys for every CSM seat and the CEO (W22), and `stoppedNotInRegister`: mirrored cards whose Client Status is Stopped with no departure in the register (22 today with no churn date, 11.2-g), each `{taskId, clientName, churnDate|null, stoppedSince|null}` (Q5 default: a review list, never a bulk write). Migration `o` also merges `{"churn":true}` into `cockpit_settings` `forms.doors`.
2. The churn tracker: each register row without `confirmed_at` gets "Confirm churn" (opens FormSheet `churn_confirm`, prefilled through `cockpit_form_prefill`); each confirmed row shows its card state from `cockpit_form_trail({departureId})`; a "Notice in" band above the register lists `notices` with "Confirm churn", "Not leaving" (opens a one-line note, then `cockpit_form_notice_answer(id, 'staying', note)`; nothing on the card; the row stays hidden on reload) and `Open the notice ticket` (prefilled request form, type `client_notice`, requester the presser, source `client_page`); "Termination surveys not matched to a card" (every CSM seat and the CEO) with "Pick the card" (`cockpit_form_legacy_match`; a CSM's pick is limited to their own clients by the gate); a band "Stopped on the card, not in the register" lists `stoppedNotInRegister` with "Confirm churn" (opens the form for that card). "Send exit survey" is shown disabled with the line "Client forms arrive with the portal (wave 3)." (no dead link). Every door here shows only when `cockpit_form_doors().churnConfirm` is true; until then the tracker reads as today plus the line "Confirm churn opens after the next cockpit update."
3. `churnRegister.ts` (CEO) reads the new columns and states "Confirmed {date} by {role}" or "Logged, not confirmed".

### 4.6 5.11: the honest client-page buttons, and the client-page doors (formsheet-client-page)

Files: `apps/client-success-cockpit/src/lib/useCsmSnapshot.ts`, `src/pages/CsmPage.tsx`; `supabase/functions/cockpit-csm-api/core.ts` and a new `supabase/functions/cockpit-csm-api/reportField.test.ts`; `apps/client-success-cockpit/scripts/client-page-acts.test.ts`.

1. `CLICKUP_ACT_KINDS = new Set(["stage", "happiness", "booked", "touchpoint", "report", "service"])`. The server already writes all four (`core.ts:31-38`, read 2026-11-01). Labels: "They booked, save it to ClickUp" → "Save the booking", toast "Booking saved to the card"; "Sent it, log the touchpoint" → toast "Touchpoint saved to the card"; report → "Report date saved to the card"; service → "Service saved to the card". A failed write shows the server's sentence and "Nothing changed on the card."
2. `core.ts`: Last report sent is found by id prefix `a7f4ecf5` in `defs.fields` (one match, a date field), not by name; zero or two matches refuse with "The Last report sent field (a7f4ecf5) is missing from Clients - Mahara."
3. Commitment handled stores `{responseId, commitmentIndex}` in the act's detail from the stored check-in (the commitment rows already carry them in `c.commitments`), and the toast offers "Close the task" when the commitment has a linked task, through the requests `task_action` writer the page already uses (plan 5.11).
4. The client page's actions gain "Give more time", "Pause this client" / "Resume" and "Client is leaving", each opening FormSheet with its def, `cockpit_form_prefill` (3.1, 3.7, 5.2) and the `lifecycleClient.ts` submit. "Give more time" shows a "Due in {n} days" or "{n} days late" hint when the card's date is within 7 days or past; it is always available, and while a grant is live it reads "Extension to {date} running · Add weeks" and opens the form as "Add to the extension" (W23). Today gains four derived bands: "Notice in" and "Pause request in" (`cockpit_form_notices_in`), "Reviews due" (`cockpit_billing_ladder_due`), "Checks waiting" (CEO and finance only, `cockpit_manual_payments_to_check`), each row with its buttons including the ticket button of W5 (5.4, 5.8). Each door and band reads `cockpit_form_doors()` once per page load and hides itself, with the line "Opens after the next cockpit update.", when its flag is false; nothing calls an RPC the flag reports missing.
5. Settled already: the 2 "Log a call" acts in `reconcile` named by the plan are 0 today (11.2-f); no step.

### 4.7 Extension native (money-acts)

1. `cockpit_billing_write('edit', {kind:'extension', weeks, reason, ours, limitations, atRisk, callId|noCall+noCallReason, prevent, replacesGrantId?, requestId})`. The new function moves the date for every extension from the new form, whatever `moveDate` says (the plan: "the new date moves from the later of the card's date and today"); the old Extend tab's tick goes (W13). One open grant per card, extended by replacement (3.5, W23). It records the response (`extension`), inserts the event (3.3 detail, plus `replaces_grant_id`), updates the mirror, queues `extension.granted`, audits. Returns `{eventId, responseId, newDate, cardState}`. Migration `p` merges `{"money":true}` into `cockpit_settings` `forms.doors`, so no screen sends the new keys to the old function (which would record an extension and leave the date behind).
2. The billing sheet's Extend tab renders `FormBody` with def `extension` (no second form).
3. The daily step clears ended grants (4.10).
4. `csmLinks.ts` (formsheet-client-page): "Client extension form" becomes `{label: "Give more time (in the cockpit)", note: "Open the client, then Give more time. The ClickUp card updates itself."}` pointing to the client page route; the "$50" note is gone in both apps (Q7).

### 4.8 Staff pause, resume, the ladder and late records (money-acts)

1. `cockpit_billing_write('edit', {kind:'pause', pauseKind, restart, reasonCat, reason, callId, consent:{kind:'call', term_runs, over_14_ends}, requestId})` and `{kind:'resume', on, nextDate, requestId}` per 3.3 and 3.5. Notices `pause.agreed` / `client.resumed`. The sheet's Pause tab renders `FormBody` `pause` / `resume`; its copy "The SOP pauses on the third day late" becomes the ladder sentence (5.3).
2. The ladder: `cockpit_billing_ladder_due()` lists cards with an open late spell at `pauseReviewDay` or more and no live extension and not Paused (`pause_review`), at `cancelReviewDay` or more (`cancel_review`), and Paused cards on pause day 14 or more (`pause_day14`, "Restart or confirm churn"). No step changes the card and no step opens a ticket by itself; each row's `Open the review ticket` button opens the prefilled request form (`client_pause` for a pause review, `client_offboarding` for a cancel review and pause day 14; requester the presser, source `client_page`). The CEO Billing tab gets a small "Overdue steps" editor (two numbers, Save → Saved) and the list "Downgrades this month" from `cockpit_mrr_read().downgrades` (Q13).
3. Late records: the daily step (4.10) opens a `late` event on a spell's day `pauseReviewDay` and closes it when the spell ends. `cockpit_late_payments_v` is the read; the lock-in, goals and the CSM client page read it through `cockpit_late_payments_read`.
4. The four held items: `cockpit_billing_event_void_owner` (in `m`) voids Marble's extension and Alkhalil's pause at D-B5 (Q3); Liwan's and Ardon's items go through the held-edit review in the C1 window (W20, section 9): Liwan's grant ended 2026-11-02, so its item is `close`d (the grant stays a record); Ardon's date is re-recorded `fresh` after reading the card, or `close`d when the card already shows a later date.

### 4.9 Set MRR (money-acts; the rail sums in checked-money)

1. `cockpit_billing_write('edit', {kind:'mrr', value, reasonCat, reason, effective, requestId})`: CEO, finance, or a CSM on own clients; `mirror.mrr_usd` updated; event per 3.3.
2. The billing sheet gains a "Set MRR" tab (FormBody `mrr`) and, above the list, a tile row "MRR on the books", "Suggested", "Cards that differ" from `cockpit_mrr_read()`; each row shows "MRR missing" or "Card {x}, suggested {y}" or "Card {x}, money in {y}" chips. The suggestion = Next Payment Amount when the plan reads monthly, else NULL ("not a monthly plan"); recurring wins join in wave 5.
3. The guardian raises an incident when `totals.differ > 0` for 2 days (6.2). The sum check (projected MRR = sum of card MRR over active monthly cards, $11,333 over 7 today, 11.2-g) stays an integrity assertion in the readers test, not a second source.

### 4.10 The daily billing step (money-acts)

`cockpit_billing_daily()`: returns at once with `{"ran":false,"why":"billing.daily is off"}` and
writes `billing-daily` ok while the setting is off. When on, in one transaction, idempotent for the
day: (1) for each grant in `cockpit_extensions_v` with `until < today` and `cleared_at IS NULL` and
the mirror's `extension_weeks > 0`: insert `extension` source `system` `detail {weeks:0, reason:'grant ended', grant_id}`, `by_whom 'the cockpit'`; (2) open a `late` event for each spell that reached `pauseReviewDay` with none open; close each open one whose spell ended; (3) write `cockpit_sync_state` `billing-daily` `{cleared, lateOpened, lateClosed, at}` with a plain note. It never inserts `pause`, `churn` or `date`.

### 4.11 Readers repointed (readers-guardian)

Files: `hermes/cockpit-sync/{csmProviders.ts, csmCadence.ts}` and their tests; `supabase/functions/cockpit-ceo-api/{extensions.ts, extensions.test.ts, endpoints.test.ts}`; `supabase/functions/ceo-extensions-sync/*`; `hermes/ceo-refresh/native/{extensions.js, metrics.ts}`; `apps/media-buyer-cockpit/convex/ceo/metricRegistry.ts`; `apps/media-buyer-cockpit/src/pages/ceo/{SOURCES.md, goalsSheetModel.ts, goalsLockIn.tsx, ClientSuccessTab.tsx}`; `hermes/csm-calls/{sources.ts, sources.test.ts}`; migration `q`; `apps/media-buyer-cockpit/scripts/readers-supabase.test.ts`.

1. Cadence (`csmProviders.ts:150-170`, `csmCadence.ts:82-195`): extensions come from `supabaseQuery` over `cockpit_extensions_v` (`state='live'`), keyed by card id, not by typed name; the Typeform `gqBcyK6g` read is removed (the `fRokTITH` comparator read stays as 2b left it); PAUSE REQUIRED reads `cockpit_client_lifecycle_v.ladder_step` and the ladder's day, so its text says "{n} days past due, pause review" from the setting, not "3+".
2. `churnValues()` reads the register (`cockpit_churn_departures`, not removed) instead of the old sheet's tab 01, in the same `string[][]` shape its callers expect (a header row then one row per departure), so nothing downstream changes.
3. `cockpit-ceo-api/extensions.ts` and `ceo-refresh/native/extensions.js`: grants from `cockpit_extensions_v`; the field write ("Write to ClickUp now") is removed, because the billing queue is the one writer of `8cb9d308` (the button in `ClientSuccessTab.tsx` goes with it, replaced by the line "The billing sheet writes the extension to the card."). `ceo-extensions-sync` stays deployed and is unscheduled at C1 (section 9); its function returns "Retired: the billing sheet writes the extension field." if called.
4. `metrics.ts`: `clients.extension_weeks` reads the view; new `clients.extensions.granted` (grants in the window), `clients.churn.confirmed` (confirmed departures in the window), `clients.churn.rate`, `clients.late_payments` (spells opened in the window, with days late), each with its source sentence. `metricRegistry.ts` and `SOURCES.md` rows per 6.4. `money.logged_unchecked` (from `rails.manualLogged`) is registered here too.
5. `goalsSheetModel.ts`: `extensionsGiven` measured from `clients.extensions.granted`, its note "From the billing sheet and the client page; typed days add to it."; `goalsLockIn.tsx`: the churned, extensions and late sections show `lifecycle` rows from the goal context as the measured default (status `measured`) beside any typed answer; a typed answer always wins and is never overwritten; "Total new cash" gains the line `Logged, not checked: {usd} ({n})` from `rails.manualLogged` (plan 5.3).
5a. Pay (`apps/media-buyer-cockpit/src/pages/ceo/pay/{PayMonthCard.tsx,payCopy.ts}`): a commission line whose deal cash includes a logged row waits with the chip `Cash not checked yet` (amber) and is not approvable until the row is checked; the count comes from `rails.manualLogged` and the deal ledger's checked flag (plan 5.3).
6. `csm-calls/sources.ts`: `exit_survey` joins the form kinds read for a client's timeline.

### 4.12 FormSheet (formsheet-client-page)

Files (identical pairs, master in client success): `apps/{client-success,media-buyer}-cockpit/src/forms/staff/{FormSheet.tsx, formSheet.css, formSheetCore.ts, formDefs.ts, lifecycleClient.ts}`; `scripts/check-shared.sh`; `apps/client-success-cockpit/scripts/form-sheet.test.tsx`; `apps/client-success-cockpit/src/dev/formSheetFixtures.ts`.

```ts
// formSheetCore.ts — imports nothing.
export type FieldDef = { key: string; label: string; type: "choice"|"multi"|"text"|"longtext"|"date"|"number"|"yesno"|"call"|"readonly";
  options?: { value: string; label: string }[]; required?: boolean | ((a: Answers) => boolean);
  min?: number; hint?: string; showIf?: (a: Answers) => boolean };
export type FormDef = { key: "extension"|"pause"|"resume"|"churn_confirm"|"mrr"; version: 1; title: string;
  fields: FieldDef[]; submitLabel: (a: Answers) => string; doneLabel: string };
export type Answers = Record<string, unknown>;
export type Prefill = { key: string; value: unknown; source: string };   // source shown as "from {source}"
export type TrailStep = { key: "stored"|"card"|"notice"|"ticket"; state: "done"|"waiting"|"held"|"failed"|"skipped"|"none";
  label: string; detail?: string; action?: { label: string; href: string } };
export function validate(def: FormDef, a: Answers): Record<string, string>;   // field key -> sentence
export function trailFrom(t: FormTrailRow): TrailStep[];                      // cockpit_form_trail -> steps (5.1 copy)
export function draftKey(def: FormDef, taskId: string): string;               // localStorage key
export function kuwaitDay(d: string | Date): string;   // pure, output identical to the app's format.ts date helper
export function usd(n: number | null): string;          // pure, identical to format.ts; NULL -> "missing", never "$0"
export function kwdWithUsd(kwd: number | null, usdValue: number | null): string;
// FormSheet.tsx — imports react, lucide-react, "@/components/ui/sheet", ./formSheetCore, ./formSheet.css only.
export function FormSheet(p: { open: boolean; onOpenChange(o: boolean): void; def: FormDef;
  client: { taskId: string; name: string }; prefill: Prefill[];
  submit(a: Answers, requestId: string): Promise<{ message: string; ref: { eventId?: number; responseId?: string; departureId?: number } }>;
  trail(ref: object): Promise<FormTrailRow> }): JSX.Element;
export function FormBody(p: Omit<Parameters<typeof FormSheet>[0], "open"|"onOpenChange">): JSX.Element;   // inline, for the billing sheet's tabs
// lifecycleClient.ts — imports only the SupabaseClient type.
export const giveMoreTime, pauseClient, resumeClient, confirmChurn, setMrr: (c: SupabaseClient, taskId: string, a: Answers, requestId: string) => Promise<...>;
export const formTrail: (c: SupabaseClient, ref: object) => Promise<FormTrailRow>;
export const formPrefill: (c: SupabaseClient, formKey: FormDef["key"], taskId: string) => Promise<{ prefill: Prefill[]; calls: CallPick[]; hints: Prefill[]; grant: object | null }>;
export const formDoors: (c: SupabaseClient) => Promise<Record<"churnConfirm"|"extension"|"pause"|"mrr"|"reviews"|"checks"|"prefill", boolean>>;  // all false on any error
export const answerNotice: (c: SupabaseClient, responseId: string, answer: "staying"|"handled", note: string) => Promise<void>;
```

**Styling.** `formSheet.css` uses only variables the two apps already define (`--mahara-teal`,
`--deep-space`, `--muted`, `--border`, `--card`, `--warning`, `--destructive`, `--font-sans`,
`--font-mono`): no literal colour (the form-sheet test greps the file for `#hex`, `rgb(` and
`hsl(` and fails on any). The trail's rings copy the StatusChip tones by class name (the same
tone names as the kit's `StatusChip`), so a step and a chip read alike. Dates and amounts go
through `formSheetCore`'s pure formatters, whose outputs the test compares with each app's
`format.ts` on a fixed table of inputs (identical strings), so the import ban never means ad hoc
formatting.

Behaviour: the request id is one `crypto.randomUUID()` per open sheet, reused on retry, so a
double press or a retry never writes twice; drafts save to `localStorage` (try/catch, never
required) and clear on success; the trail polls `formTrail` every 5 s for 2 minutes after a
submit, then once a minute while the sheet is open; Escape closes; focus returns to the opener.
`check-shared.sh` gains the FormSheet set (`cmp`, imports included, like the tasks set) and the
pairs `src/components/billing/ChecksWaiting.tsx` and `src/lib/paymentChecks.ts`.

### 4.13 Reactivate links (formsheet-client-page)

Remove the "Card declined, reactivate their ads" row in `apps/client-success-cockpit/src/lib/csmLinks.ts` (now `:230-234`) and `apps/media-buyer-cockpit/src/lib/csmLinks.ts` (`:183-187`), and the `"reactivate ads after a failed payment"` line in `viktor-side-scripts/csm/csm_assistant.py:41` (the VPS copy changes at the next VPS release). A submit of `ecJQ5Z5C` does nothing today (no webhook), so nothing is lost.

---

## 5. The screens: design plans and copy

**The shared plan, before any screen.** Subject: a client success manager deciding something that
changes a client's money or status, with the card on ClickUp as the copy. Audience: the CSM, finance
and the CEO, at a desk or on the phone app. Job: decide, say why, and see the decision land.
Tokens are the cockpit's own (no second palette): `--mahara-teal` `#00cfc8` for the one primary
action and done states; `--deep-space` for ink on teal; the app's `--muted`, `--border` and
`--card`; amber (`--warning`) for held and waiting; the app's destructive red only for Pause and
Confirm churn. Type: Geist for text, Geist Mono for dates, amounts and the trail's step names;
client names in `<bdi>` (IBM Plex Sans Arabic falls back through `--font-sans`). Layout: a right
sheet on desktop (`min(560px, 100vw)`), a bottom sheet under `md`, one column of fields, the
primary action pinned at the bottom with `pb-safe`. Motion: none but the trail's steps filling in
order (150 ms each, off under reduced motion). No italic headings, no invented numbers, no fake
chrome; every number on screen comes from a read with its source.

**The signature element: the after-send trail.** After a submit, the form folds to one line ("Given:
2 weeks to 16 Nov") and below it a vertical rail of four steps in Geist Mono, each a small ring that
fills teal when done, amber when held or waiting, red when failed, with its sentence beside it.
It is the one memorable thing: the CSM watches the decision travel to the card. Everything else is
quiet.

Slop test before shipping (Hallmark): screenshots at 375 and 1280 px of every screen below, light
and dark, scored on the six axes (anything under 3 is revised), and passed through Hallmark's
component-scope slop gates (visual, contrast, accessibility, typography) with each gate's result
written in the slice report; a failed gate is fixed before the slice is marked done.

### 5.1 FormSheet (all five forms)

```
┌ Give more time ─────────────────────── ✕ ┐
│ Liwan Limited …            Active · due 2 Nov │
│ ┌ from the ClickUp card ┐ ┌ from Fathom, 28 Oct ┐ │
│ Weeks   (1 week)(2 weeks)(4 weeks)            │
│ Why     [________________________]            │
│ ...                                            │
│ [ Give 2 weeks ]                 Draft saved   │
└────────────────────────────────────────────────┘
after:  Given: 2 weeks to 16 Nov
        ● Saved in the cockpit                 10:42
        ◐ Held: card writes for extensions are off. The CEO turns them on.
        ● Posted in #csm-announcements
        ○ No ticket for an extension
```

Copy: prefill chip `{value} · from {source}` (sources come only from `cockpit_form_prefill`:
"the ClickUp card", "Fathom, {date}", "the last call", "the 1-1 notes, {date}", "the churn
register", "the termination survey, {date}"; a NULL value shows its sentence, never a number).
Trail: stored `Saved in the cockpit`; card `Queued for the ClickUp card` / `Card shows it` /
`Held: card writes for {kind words} are off. When the CEO turns them on, this edit is reviewed
and sent or closed.` / `Waiting for ClickUp to confirm` / `ClickUp refused it:
{error}. It stays in the cockpit; tell the systems manager.` / `ClickUp already showed this, so
nothing was written.`; notice `Posted in #{channel}` / `Not posted: the bot is not in #{channel}.
Ask the CEO to invite it.` / `Posting…`; ticket `Open the pause tickets` (button, prefilled
request form, `client_pause`) / `Open the relaunch ticket` / `Open the offboarding ticket` / `No
ticket for {form}`. Network error: `Not saved. Check your connection and press {submit label} again.`
Validation sentences come from `validate` and match the SQL refusals word for word.

### 5.2 Client page doors (CsmPage)

Design: the three new actions join the existing action row in the cockpit's chip style; "Client is
leaving" sits last, in the muted destructive tone, separated by a hairline. Copy: buttons `Give
more time` (with a live grant: `Extension to {date} running · Add weeks`), `Pause this client` /
`Resume this client`, `Client is leaving`. Hints: `Due in {n} days` / `{n} days late`. Toasts
mirror the done labels: `Given`, `Paused`, `Resumed`, `Churn confirmed`. A door whose migration
is not live yet: hidden, with one muted line `Opens after the next cockpit update.`

### 5.3 Billing sheet tabs (Extend, Pause/Resume, Set MRR) and the MRR tiles

Design: the tabs keep their chip strip; Extend, Pause and the new Set MRR render `FormBody` in the
left column; the right column keeps the card facts. The tile row (`StatTile` style of the app's
kit) sits above the list: `MRR on the books` `$11,333` (from the cards), `Suggested` (sum of
suggestions, "n cards have no suggestion"), `Cards that differ` (count; tap filters the list).
Copy: pause tab sentence `The ladder: a pause review on day {4} and a cancel review on day {15}.
Neither changes the card by itself.`; MRR chips `MRR missing` / `Card {x}, suggested {y}` / `Card
{x}, money in {y}` / `Not a monthly plan`; rail note when stale (3.1). "Overdue steps" editor (CEO):
`Pause review on day [4]`, `Cancel review on day [15]`, `Save` → `Saved`; refusal `The cancel review
comes after the pause review.` "Downgrades this month" (CEO Billing tab, a `SectionCard` list):
`{client}: {from} → {to} from {date}, {reason} · {role}`; empty: `No MRR went down this month.`

### 5.4 Today bands (CsmPage)

Design: three compact bands under the existing Today header, each a `SectionCard` with rows of
client, one fact in Geist Mono and one button; empty bands are hidden (not an empty state), except
"Checks waiting" which says `Nothing waiting on a check.` for finance and the CEO. Copy: `Notice in:
{client} sent the termination survey on {date}` → `Confirm churn` / `Not leaving` / `Open the
notice ticket`; unmatched: `Not matched to a card: {name from the form} sent the termination
survey on {date}` → `Pick the card`; `Pause request in: {client} asked to pause on {date}` →
`Pause this client` / `Handled` / `Open the pause tickets`; `Pause review: {client} is {n} days
late` → `Pause this client` / `Give more time` / `Open the review ticket`; `Cancel review:
{client} is {n} days late` → `Client is leaving` / `Open the review ticket`; `Paused {n} days:
restart or confirm churn for {client}` → `Resume this client` / `Client is leaving` / `Open the
review ticket`; `Receipt to check: {client}, {amount} on {date}` → `Check` / `Reject` / `Open the
receipt check`. Every ticket button opens the prefilled request form (W5); the ticket then
reaches task alerts and Your tasks like any other.

### 5.5 Churn tracker (ChurnPage)

Design: the register keeps its table; a status column shows `Confirmed {date} · {role}` (teal ring)
or `Logged, not confirmed` (amber) with the card state from the trail; the "Notice in" band sits
above the register with the termination survey's ratings in Geist Mono; the "Stopped on the
card, not in the register" band sits below the register, collapsed to its count by default.
Copy: `Confirm churn`, `Not leaving` (note prompt `What did the client say?`, then `Saved`),
`Open the notice ticket`, `Pick the card`, `Send exit survey` (disabled) with `Client forms
arrive with the portal (wave 3).`, unmatched header `Termination surveys not matched to a card`,
band header `Stopped on the card, not in the register ({n})` with the line `Confirm each one, or
leave it if it was stopped by mistake.`

### 5.6 CEO Money tab line, manual list, Transactions chip

Copy: under the cash total `Logged, not checked: {usd} ({n})`, and the standing line `Bank
transfers since 2 Oct are not checked against a statement` until a client-income statement is
uploaded. Manual list chips `Checked {date}` / `Logged, not checked` / `Rejected`. Transactions
chip `Not checked`.

### 5.7 ChecksWaiting (both apps)

Design: a `SectionCard` list; each row client, amount (Geist Mono, KWD with its USD), day, method,
reference, receipt link, "waiting {n} days"; finance and the CEO get `Check` (opens a two-field
inline form: bank reference, or statement line) and `Reject` (reason). Copy: `Check` → `Checked`;
`Reject` → `Rejected`; refusal sentences from 3.1.

### 5.8 Pending payments

Copy: a part covered by a logged row reads `Receipt in, not checked` (amber); after the check it
reads as today.

### 5.9 Notices and routing (Settings)

The six kinds appear with their labels (3.4) and blurbs: `Termination notice in: a client sent
the termination survey; the CSM confirms churn or answers the notice in the cockpit.`;
`Termination survey sent: off while the old Make
post runs (wave 3 turns it on).`; `Client has left`, `Extension given`, `Pause agreed`, `Client
resumed`: `Posts in #csm-announcements once the bot is in.`

---

## 6. Workers, crons, monitoring and the runbook

### 6.1 Crons

| Job | Where | Schedule | Off switch |
|---|---|---|---|
| `mahara-clickup-writeback-billing-doctor` | pg_cron → `clickup-writeback` `{"job":"billing_doctor"}` | `41 3 * * *` UTC | unschedule |
| `mahara-billing-daily` | pg_cron → `cockpit_billing_daily()` | `10 5 * * *` UTC | `billing.daily.on=false` |
| LTV daily | not in waves 1 and 2 | | |
| `mahara-ceo-extensions-auto` | existing | `47 * * * *` | **unscheduled in the C1 window** (D-C1.5) |

### 6.2 Guardian (`hermes/cockpit-guardian/checks/forms_billing.py`, registered in `checks/__init__.py` after `task_assignments`; report-only)

| Check id | Reads | Warn / fail |
|---|---|---|
| `billing-writeback` | `cockpit_sync_state` `clickup-writeback:billing` (`heldOpenKind`) | fail when a `retry`/`unknown`/`failed` billing item is older than 30 min; warn on any `dry_run` billing item whose kind is open ("{n} held edit(s) of an open kind wait for the review: release or close each one", W20) |
| `billing-doctor` | `clickup-writeback:billing-doctor` | warn on any gap sentence; fail when older than 26 h |
| `billing-daily` | `billing-daily` | fail when older than 26 h while `billing.daily.on` |
| `forms-door-exit` | `forms-door:exit_survey` and `forms-door:pause_request` | warn when registered and no delivery in 21 days (a quiet form is normal; the reading says so), fail on the last outcome `failed` |
| `notice-unmatched` | `cockpit_form_responses` `exit_survey`/`pause_request`, state `legacy`, `task_id` NULL, not answered | warn when one stays unmatched for 2 days: "A {form words} from {name from the form} is not matched to a card: a CSM picks the card on the churn tracker." (`legacy-24h` is wave 3, with `legacy.received`; it will exclude `exit_survey` and `pause_request` while their Typeforms are live) |
| `register-vs-card` | confirmed departures vs `cockpit_billing_accounts` | warn when a confirmed churn's card is not Stopped, or its Churn Date differs from `left_on`, 2 h after its event was delivered |
| `extension-vs-card` | live grants vs mirror `extension_weeks` | warn on a mismatch older than a day |
| `mrr-differs` | `cockpit_mrr_read` totals via service SQL | warn when `differ > 0` two days running |
| `checks-waiting` | logged rows | warn when a row waits more than 7 days |

Before deploy each check reads "not set up yet" as ok, never as zero.

### 6.3 Runbook rows (`RUNBOOK.md`, readers-guardian)

One row each: "Turn a billing kind on" (secrets, test card first, read-back, then the held-edit
review: list the kind's `dry_run` billing items, read each card, `cockpit_billing_held_release`
with `replan` when the card is unchanged since the event, `fresh` when it changed, `close` or
`void` when the edit no longer applies; then clear the card list);
"A billing write failed" (read the queue row's error, read the card, re-queue only after reading
back); "Undo a churn confirm" (CEO removes the departure; a `resume` returns the card to Active;
the churn fields stay as history); "Void a held billing edit" (`cockpit_billing_event_void`);
"Check a hand-logged payment"; "The exit-survey and pause-request webhooks" (`forms_key.py`
status/probe/unregister); "Change the overdue steps"; "Turn the daily billing step off"; "Roll
back a migration with screens on it" (restore the saved bodies, flip its `forms.doors` marker to
false, and roll the two apps back to the recorded deployment in the same step).

### 6.4 SOURCES.md rows (readers-guardian writes all of them)

Extensions (the view, no Typeform; "the two 09-14 Typeform tests are not grants"); Late payments
(the view: spells from daily snapshots, "a spell that started before 2026-10-07 has no earlier
snapshot"); Churn confirmed (the register's confirmed rows; "a departure logged but not confirmed
counts in churned clients and shows as not confirmed"); Cash (checked only; "logged money shown on
its own line"); MRR check ("rail cash over two full months; clients paying a deposit and a later
lump sum differ by design").

---

## 7. File ownership

Seven slices. A file appears under exactly one slice. Pairs that `check-shared.sh` compares belong
to one slice together. If a slice needs a change in another's file, it leaves a note in its report
(file, line, the change) and does not edit it.

| Slice | Starts | Depends on | Migration | Owns |
|---|---|---|---|---|
| **forms-foundation** | at once | none | `20261101l_forms_stage3_base.sql` | migration `l`; `supabase/functions/forms-door/**`; `supabase/functions/cockpit-notices/{text.ts,send.ts,doctor.ts,text.test.ts,run.test.ts,testkit.ts}`; `apps/client-success-cockpit/src/lib/notices.ts`, `src/components/NoticesRouting.tsx`, `src/dev/noticesFixtures.ts`; `scripts/dev/{forms_key.py,test_forms_key.py,forms_legacy_backfill.py,test_forms_legacy_backfill.py}`; `apps/media-buyer-cockpit/scripts/forms-stage3-base-supabase.test.ts` |
| **billing-rails** | at once | none | `20261101m_billing_rails.sql` | migration `m`; `supabase/functions/clickup-writeback/{billing.ts,billing.test.ts,queue.ts,queue.test.ts,run.ts,run.test.ts,index.ts}`; `supabase/functions/billing-sync/{billing.ts,billing.test.ts}`; `apps/media-buyer-cockpit/scripts/billing-rails-supabase.test.ts` |
| **checked-money** | at once | none | `20261101n_checked_money.sql` | migration `n`; `hermes/ceo-refresh/native/adapters/{money.js,clients.js,growth.js}`; `hermes/ceo-refresh/checked-money.test.ts`; `apps/media-buyer-cockpit/src/pages/ceo/{MoneyTab.tsx,moneyManual.tsx,TransactionsTab.tsx}`; pairs `apps/{client-success,media-buyer}-cockpit/src/components/billing/{PendingPayments.tsx,ChecksWaiting.tsx}` and `.../src/lib/{billingBalances.ts,paymentChecks.ts}`; `apps/media-buyer-cockpit/scripts/{checked-money-supabase.test.ts,billing-pending-screen.test.tsx}` |
| **formsheet-client-page** | at once | none | none | pairs `apps/{client-success,media-buyer}-cockpit/src/forms/staff/{FormSheet.tsx,formSheet.css,formSheetCore.ts,formDefs.ts,lifecycleClient.ts}`; `apps/client-success-cockpit/src/pages/CsmPage.tsx`, `src/lib/useCsmSnapshot.ts`, `src/dev/formSheetFixtures.ts`; `apps/{client-success,media-buyer}-cockpit/src/lib/csmLinks.ts`; `viktor-side-scripts/csm/csm_assistant.py`; `supabase/functions/cockpit-csm-api/{core.ts,reportField.test.ts}`; `scripts/check-shared.sh`; `apps/client-success-cockpit/scripts/{form-sheet.test.tsx,client-page-acts.test.ts}` |
| **churn-confirm** | after forms-foundation, billing-rails, formsheet-client-page | those three | `20261101o_churn_confirm.sql` | migration `o`; `apps/client-success-cockpit/src/pages/ChurnPage.tsx`, `src/lib/{churnClient.ts,churnCore.ts,churnSchema.ts}`; `apps/media-buyer-cockpit/src/pages/ceo/churnRegister.ts`; `apps/media-buyer-cockpit/scripts/churn-confirm-supabase.test.ts`; `apps/client-success-cockpit/scripts/churn.test.ts` |
| **money-acts** | after forms-foundation, billing-rails, checked-money, formsheet-client-page | those four | `20261101p_money_acts.sql` | migration `p`; pairs `apps/{client-success,media-buyer}-cockpit/src/components/billing/BillingSheet.tsx` and `.../src/lib/billingCore.ts`; `apps/{client-success,media-buyer}-cockpit/src/lib/billing.ts`; `apps/media-buyer-cockpit/src/pages/ceo/BillingTab.tsx`; `apps/client-success-cockpit/src/pages/BillingPage.tsx`; `apps/media-buyer-cockpit/src/dev/billingFixture.ts`; `apps/media-buyer-cockpit/scripts/{money-acts-supabase.test.ts,billing.test.ts}` |
| **readers-guardian** | after churn-confirm and money-acts | those two | `20261101q_readers.sql` | migration `q`; `hermes/cockpit-sync/{csmProviders.ts,csmCadence.ts}` and the cockpit-sync tests that pin extensions or churn values; `supabase/functions/cockpit-ceo-api/{extensions.ts,extensions.test.ts,endpoints.test.ts}`; `supabase/functions/ceo-extensions-sync/**`; `hermes/ceo-refresh/native/{extensions.js,metrics.ts}`; `apps/media-buyer-cockpit/convex/ceo/metricRegistry.ts`; `apps/media-buyer-cockpit/src/pages/ceo/{SOURCES.md,goalsSheetModel.ts,goalsLockIn.tsx,ClientSuccessTab.tsx}`; `hermes/csm-calls/{sources.ts,sources.test.ts}`; `hermes/cockpit-guardian/checks/{forms_billing.py,__init__.py}`, `hermes/cockpit-guardian/tests/test_forms_billing.py`; `RUNBOOK.md`; `apps/media-buyer-cockpit/src/pages/ceo/pay/{PayMonthCard.tsx,payCopy.ts}`; `apps/media-buyer-cockpit/scripts/readers-supabase.test.ts` |

Cross-slice touch points, settled here so nobody edits another's file:
- money-acts mounts `ChecksWaiting` (checked-money's pair) in `BillingPage.tsx` and `BillingTab.tsx`; checked-money mounts it in `moneyManual.tsx`.
- FormSheet defs and `lifecycleClient.ts` (formsheet-client-page) call the RPCs of `o` and `p` by the exact names and argument keys of 3.1 and 3.7; money-acts and churn-confirm import them, never copy them.
- `check-shared.sh` (formsheet-client-page) lists checked-money's two new pairs.
- `lifecycleClient.ts` (formsheet-client-page) holds every browser call of the new doors (`formPrefill`, `formDoors`, `answerNotice`, the five submits, `formTrail`); ChurnPage (churn-confirm), BillingSheet and BillingTab (money-acts) import it. Whoever adds a call the file lacks leaves a note; formsheet-client-page writes all of 3.1's browser calls up front.
- Ticket buttons (W5) import the app's existing prefilled request form opener unchanged; a slice that finds it cannot take a prefill leaves a note and shows the button disabled with "Open Tickets and pick {type}." rather than editing the requests files (no slice owns them).
- The test that the seeded staff-form `schema` keys equal `formDefs.ts` (W19) lives in readers-guardian's `readers-supabase.test.ts`, which runs after both `l` (forms-foundation) and `formDefs.ts` (formsheet-client-page) have merged.
- SOURCES.md and metricRegistry.ts rows for checked money are written by readers-guardian from 6.4.
- `apps/*/convex/billingCore.ts` is not touched by anyone (Convex is retired; the shared check keeps the two copies equal as they are).

---

## 8. Tests each slice runs green

Every slice: `bun run typecheck` is not enough (it skips `src`); run `tsc -b` in each app it touches,
`biome check` on its files, and `scripts/check-shared.sh` once the pairs land.

| Slice | Tests |
|---|---|
| forms-foundation | `cd apps/media-buyer-cockpit && bun test scripts/forms-stage3-base-supabase.test.ts scripts/forms-registry-supabase.test.ts scripts/forms-record-supabase.test.ts` (the second and third unchanged and green); `cd supabase/functions/forms-door && bun test`; `cd supabase/functions/cockpit-notices && bun test`; `python3 -m unittest scripts/dev/test_forms_key.py scripts/dev/test_forms_legacy_backfill.py`. Asserts: the migration applies twice; the drift guard refuses a changed body; registry_apply still refuses provider native for checkin outside the cut-over and now refuses a key outside the allow-list; `cockpit_form_record_legacy` is idempotent on `external_id`, sets `notice_on` in Kuwait time, queues `termination.notice` once for a live exit_survey and nothing for a backfilled row or a pause_request, and its departure update is guarded on the column (run before `o` it stores the row and skips the match); the six settings rows seed (both settings CHECKs widened); a `typeform_exit_survey` key saves (provider CHECK widened); `cockpit_forms_door_seen` takes `exit_survey` and `pause_request`; `cockpit_form_staff_record` refuses source `cockpit` with no `auth.uid()` and takes `import` only then; `cockpit_form_doors` flags follow function existence and the `forms.doors` markers; registry_apply refuses the five staff forms with the W19 sentence; a CSM on another client is refused by `_legacy_match` and `_trail` and sees no matched row of that client in `_notices_in`, while every CSM sees unmatched rows; an answered response is left out of `_notices_in`; anon refused everywhere; forms-door: an `exit_survey` delivery with a bad signature is 401 before any parse, a good one stores, kickoff behaves exactly as before; no log line holds a body, a hidden value or a secret; the six kinds render the 3.4 texts. |
| billing-rails | `cd supabase/functions/clickup-writeback && bun test billing.test.ts queue.test.ts run.test.ts`; `cd supabase/functions/billing-sync && bun test`; `cd apps/media-buyer-cockpit && bun test scripts/billing-rails-supabase.test.ts scripts/billing-native-sync-supabase.test.ts`. Asserts: a read-back test per new field against a stubbed ClickUp (Resume On, Churn Date, Churn Reason, Churn Type, MRR, LTV, the checkbox both ways); a churn reason missing from the field map skips only that step with the 3.3 sentence; `CLICKUP_WRITEBACK_APPLY=true` alone leaves billing items `dry_run`; `APPLY_BILLING=true` with `KINDS=churn` delivers a churn item and holds an extension item; `BILLING_ONLY_CARDS` holds a churn item on another card; the trigger queues `system` extension/ltv/late and refuses to queue `system` pause; the canary refuses any card but `86eywg1cq`; each comment of 3.3 matches its text and carries no email; the churn writes put Churn Date before Client Status; `cockpit_churn_reason_card('Completed term')` returns `Completed term, did not renew` from a stored field map and NULL when the option is missing; the void functions close a `dry_run` item and refuse a delivered one; `cockpit_billing_held_release` with each of `replan`, `fresh` (new event `at` now, `replaces_event_id`, old one voided), `close` (event kept) and `void`, and its refusals for an item not `dry_run`, not billing, or of a closed kind. |
| checked-money | `cd apps/media-buyer-cockpit && bun test scripts/checked-money-supabase.test.ts scripts/billing-pending-screen.test.tsx`; `cd hermes/ceo-refresh && bun test checked-money.test.ts finance-publication.test.ts finance-failure.test.ts`. Asserts: after `n` exactly the 8 ids of 11.2-i are `checked` with the Q20 reference and today's cash total is unchanged (fixture of the 8 rows: $21,239.16); a ninth row added before the apply stays `logged`; a changed Q20 set makes the `DO` block raise; the CHECK is added last and holds; inbox rows 2, 3, 5 `checked` and 4 `rejected`; `cockpit_finish_finance_refresh` marks a manual row checked only from its `check_state`, whatever the refresh output says; `cockpit_csm_projection_read` shows a logged row apart and never as collected; a new CSM inbox row lands `logged`, changes no CEO cash, no LTV, no deal payment and no CSM projection until checked; a CEO add with a reference is `checked`; the check RPC refuses a CSM, a second check, a check with neither reference nor line; the protect trigger refuses any other column change; `rails.manualLogged` and `transactions[].checked` shapes; `mrrCheck` leaves out an untied card and never emits 0 for missing. |
| formsheet-client-page | `cd apps/client-success-cockpit && bun test scripts/form-sheet.test.tsx scripts/client-page-acts.test.ts`; `cd supabase/functions/cockpit-csm-api && bun test reportField.test.ts`; `scripts/check-shared.sh`. Asserts: `formDefs.ts` keys equal 3.7's table (hard-coded in the test); `formSheet.css` holds no literal colour; `kuwaitDay`/`usd`/`kwdWithUsd` equal each app's `format.ts` on a fixed table and `usd(null)` is never `$0`; a door whose `formDoors` flag is false renders the "Opens after the next cockpit update." line and makes no call; the submit labels carry no first-name cut; `validate` sentences equal the SQL refusals listed in 3.1; one request id per open sheet survives a retry; the trail maps every `cockpit_form_trail` state to the 5.1 sentence; booked/touchpoint/report/service go through `executeCsmAction`; the report field is found by `a7f4ecf5` and refused with the sentence when absent; the reactivate row is gone from both `csmLinks.ts` and the `$50` text from both; the layout harness renders FormSheet at 375 and 1280 px. |
| churn-confirm | `cd apps/media-buyer-cockpit && bun test scripts/churn-confirm-supabase.test.ts`; `cd apps/client-success-cockpit && bun test scripts/churn.test.ts`. Asserts: gate (CSM on another client refused, anon refused, CEO allowed); `whyDetail`/`howToStop` minimums; a repeat `requestId` returns the first result and writes one event; the event's writes (through `m`'s function) are Stopped, date, reason, type, and Paused On clear when asked; "Other" writes no reason; the day-90 default; the backfill door refuses a confirmed row, builds Atlantis with `clear_paused`, runs with no `auth.uid()` (response source `import`), and keeps Joe and Sera (184 days, card type Mid-programme loss) `mid_programme`; the day-90 default is `mid_programme` when no renewal date is known; a client who resumes and leaves again gets a second departure and the first one's left_on, reason and confirmation are unchanged; `cockpit_form_notice_answer` gate, note minimum, one answer only, and the row staying hidden; `stoppedNotInRegister` lists a Stopped card with no departure; `cockpit_client_lifecycle_v` rows for a paused, an extended, a late and a churned card. |
| money-acts | `cd apps/media-buyer-cockpit && bun test scripts/money-acts-supabase.test.ts scripts/billing.test.ts scripts/billing-native-sync-supabase.test.ts`. Asserts: extension fields, the one-open-grant refusal without `replacesGrantId` and the replacement path (old grant `replaced`, date moved from the live grant's date, only the newest cleared on end); `moveDate` absent still moves the date; the new date from the later of the card's date and today; the response row and event detail share `request_id`; `cockpit_extensions_v` on a fixture of the live 10-19 events returns exactly Liwan and Marble, and after a void, Liwan only; clear-on-end with a fake clock writes one `system` event, then nothing on a second run; pause for a client request without a call, or without both consent ticks, is refused; Resume On in the writes; resume clears both dates; ladder with a fake clock: a review row on day 4, one on day 15, no billing event of kind pause/churn/date ever inserted by the daily step; late spell open/close and `cockpit_late_payments_v` columns, including a fixture with a missing snapshot day that stays one spell; `cockpit_form_prefill` gate, sources, NULL-with-sentence values and the 30-day call list; `cockpit_mrr_read().downgrades`; MRR 0 without a reason refused; `cockpit_mrr_read` stale-section sentence; `billing.%` settings audited. |
| readers-guardian | `cd hermes/cockpit-sync && bun test`; `cd supabase/functions/cockpit-ceo-api && bun test extensions.test.ts endpoints.test.ts`; `cd hermes/ceo-refresh && bun test`; `cd hermes/csm-calls && bun test sources.test.ts`; `cd apps/media-buyer-cockpit && bun test scripts/readers-supabase.test.ts`; `cd hermes/cockpit-guardian && python3 -m unittest discover -s tests`. Asserts: cadence reads extensions by card id from the view and no Typeform `gqBcyK6g` call remains; `churnValues()` keeps its shape from the register; projected MRR equals the card sum over active monthly cards (integrity); goal context `lifecycle` arrays; the November `actual_source` update is idempotent; the seeded staff-form `schema` keys equal `formDefs.ts` (W19); the lock-in "Logged, not checked" line and the pay chip "Cash not checked yet"; each guardian check reads "not set up yet" as ok and its warn/fail rules of 6.2. |

No test submits a Typeform, posts to Slack, writes ClickUp or calls Make: recorded payloads,
stubbed providers and PGlite only. The canary on `86eywg1cq` is a deploy step, not a test.

---

## 9. The deploy table (the main session, after every slice is merged on a branch and reviewed)

Migrations through the CEO's Composio Supabase connection (memory: supabase-via-composio), each
preceded by the letter rule (2.1), the md5 check against 2.2 and the `before-*.sql` saves; function
deploys through `scripts/dev/deploy_composio.py <slug> --rev <sha>` (`--dry` first); apps through
`scripts/ship.sh client-success` and `scripts/ship.sh media-buyer` from a fresh worktree; VPS
releases through the native release procedure (memory: native-release). Every step is recorded in
`/Users/abdulazizwaheedi/mahara-cockpits/notes/forms-w12/deploy/` and the session in mahara-context
`shared/sessions/`.

| # | Step | Read-back | Rollback |
|---|---|---|---|
| D0 | Wave 0 done first: C4a-1 (Make 9805538's card-edit module blocked, blueprint saved) and PV recorded | the blueprint shows module [7] unreachable; PV result in the plan's §9 | restore the saved blueprint |
| D-L1 | Apply `20261101l` | the six kinds in `cockpit_slack_notices_kind_check`, `cockpit_slack_notice_settings_kind_check` and the settings channel CHECK; `cockpit_forms_keys_provider_check` lists `typeform_exit_survey` and `typeform_pause_request`; 6 settings rows; 2 channel rows `checking`; 7 registry rows and versions; `cockpit_form_registry_apply` and `cockpit_forms_door_seen` body md5 = the files' "after"; `cockpit_form_doors()` reads all false | re-apply the saved bodies; delete nothing (rows are inert) |
| D-L2 | Deploy `forms-door` (`--dry`, then live) | `GET` probe 404 for `/forms-door/typeform/other`; `probe-typeform kickoff` 401 then 200 | redeploy the previous version (its id recorded) |
| D-L3 | Deploy `cockpit-notices` | its doctor note names the six kinds; `#csm-announcements` reads `refused` or `checking` until Q4 | previous version |
| D-M1 | Apply `20261101m` | CHECKs; trigger `WHEN` text; `cockpit_billing_writeback_writes('churn',...)` returns the 3.3 writes in a `SELECT`, Churn Date first; `cockpit_billing_event_voids` with row security, no browser grant | saved bodies; trigger recreated from the saved definition |
| D-M2 | Deploy `clickup-writeback` and `billing-sync` (secrets unset) | `clickup-writeback:billing` mode `dry_run`; the 4 held items still `dry_run`; run `billing_doctor` once: `clickup-writeback:billing-doctor` lists the Churn Reason option names and no gap, or names each | previous versions |
| D-B5 | Q3 voids (now possible in wave 1: the voids live in `m`): `cockpit_billing_event_void_owner(<event id>, 'Churned; voided on the CEO''s default (Q3)', 'the CEO''s default (Q3)')` through Composio for Marble's extension and Alkhalil's pause (the event ids are the queue items' `source_id`) | both queue items `skipped` "Voided in the cockpit: churned"; after the next billing-sync run the two mirrors follow their cards (Marble's extension weeks and Alkhalil's status read the card's own values). The view check moves to D-P1 | the void row is a record; a mistaken void is answered by a new edit |
| D-N1 | Apply `20261101n` | `select count(*), sum(amount_usd) from cockpit_manual_payments where check_state='checked'` = 8, 21239.16, and the ids are the 8 of 11.2-i; any row added since reads `logged`; the `(check_state='logged') = (checked_at IS NULL)` CHECK present; inbox rows 2, 3, 5 `checked`, row 4 `rejected`; `forms.doors.checks` true | flip `forms.doors.checks` to false; the columns stay; restore the saved function bodies; a wrong mark is fixed by a dated corrective `UPDATE` in a new migration, never by delete |
| D-N2 | Release ceo-refresh (VPS) with checked-money's adapters | the next money section: cash total unchanged vs before (second source: the finance snapshot's checked sum), `rails.manualLogged.count` 0 | previous release (native release rollback); the finance refresh computes `checked` in SQL, so the old adapter cannot mark a logged row checked |
| D-B3 | Billing canary (wave 1): secrets `APPLY_BILLING=true`, `BILLING_KINDS=churn,resume` (resume is in the window so the rollback can run), `BILLING_ONLY_CARDS=86eywg1cq`; `select cockpit_billing_canary('churn', {...})` | the item `delivered`; the card reads Churn Date, Stopped, Churn Type, and Churn Reason (or the skip sentence); the card read again 10 minutes later still shows the canary's Churn Date (a ClickUp automation overwrite shows here; if it does, the person who owns ClickUp automations turns that automation off before D-B6); the trail RPC shows `delivered` | `cockpit_billing_canary('resume', ...)` (live, since `resume` is in the kinds) returns the test card to Active; churn fields stay as test history; then `BILLING_KINDS=churn` |
| D-O1 | Apply `20261101o` | columns; functions; `cockpit_client_lifecycle_v` returns 68 rows; `forms.doors.churn` true; no new unique index on departures | flip `forms.doors.churn` to false (and, after D-S1, roll the apps back in the same step); saved bodies; columns stay |
| D-B6 | Churn backfill (Q5), after D-B3 passed: `BILLING_ONLY_CARDS=86eyjkdc8` (Atlantis) first: `cockpit_churn_backfill_confirm(20)` | the response stored with source `import`; Paused On cleared, the four churn fields read back "unchanged" or written (type from the card: "Mid-programme loss"); the comment posted | none needed for "unchanged"; a wrong write is corrected by a CEO edit on the card and a note |
| D-B7 | The other five rows: card list `86exdvumc,86eymcqdq,86eypmbp3,86eyqx2f6,86ewvnqjb`, one call each (ids 22, 17, 18, 19, 21) | each item `delivered` or "unchanged"; Joe and Sera stays "Mid-programme loss"; Alkhalil (its pause voided at D-B5) reads Stopped; `register-vs-card` clean | as D-B6 |
| D-B8 | Wave 1 open: `BILLING_ONLY_CARDS` cleared, `BILLING_KINDS=churn`; the held-edit review for kind `churn` (W20): list `dry_run` billing items of kind churn (none expected) and release or close each | `clickup-writeback:billing` mode `apply`, kinds `churn`, `heldOpenKind` 0 | set `APPLY_BILLING` unset (every item holds again) |
| D-F4 | Termination receiver: `forms_key.py typeform-secret exit_survey`, `register-typeform exit_survey`, `probe-typeform exit_survey`; then `forms_legacy_backfill.py exit_survey --dry`, then without `--dry` | 401 then 200; `forms-door:exit_survey` registered; 4 `legacy` rows (Atlantis's matched to `86eyjkdc8` if its hidden id holds); **0** notices for the 4 backfilled rows | `unregister-typeform exit_survey`; legacy rows stay (records) |
| D-F5 | Remove `WHTP4007438` (feeds the inactive Make 8962418) | the form's webhook list read before and after: only that one gone | re-add it with the saved URL |
| D-R1 | Request types: create the Request Type options "Client notice" and "Payment receipt check" on the ClickUp field; then `cockpit_request_type_add` twice (team `client_success`, owner rule `csm_of_card` and the finance seat respectively); run the requests doctor | the doctor lists 33 types; the two types appear in the request form the ticket buttons open | `enabled=false` through the editor |
| D-P1 | Apply `20261101p` | `cockpit_extensions_v` = Liwan only (Marble voided at D-B5); `billing.ladder` row; `forms.doors.money` true; cron `mahara-billing-daily` scheduled, `billing-daily` "off" | flip `forms.doors.money` to false; saved bodies; unschedule the cron; after D-S1, also roll the two apps back to the recorded deployment in the same step (runbook "Roll back a migration with screens on it") |
| D-S1 | Ship client-success and media-buyer (FormSheet, client page, 5.11, links, churn tracker, billing sheet, money screens), **only after D-N1, D-O1 and D-P1** | live bundle check (memory: vercel-deploys); `select to_regprocedure(...)` for every RPC name the bundle calls (the list from `lifecycleClient.ts`, `paymentChecks.ts`, `billing.ts`, `churnClient.ts`) is non-NULL; `cockpit_form_doors()` reads all true; the client page shows the three new actions; booking saved on a CSM's real press is watched, not faked | `vercel rollback` to the recorded deployment |
| D-Q1 | Apply `20261101q`; release cockpit-sync and ceo-refresh (readers); deploy `cockpit-ceo-api` | cadence for Liwan reads the grant from the view; CEO `clients.extensions.granted` shows 1 for 2026-10; goal context `lifecycle` arrays | previous releases; saved body |
| D-C1 | **The C1 window (wave 2, one hour):** (1) switch off Make 9805665, 9000763, 8069181 and 9585358, reading each back off; (2) remove `log_payment.py --next` from the billing agent (VPS skill) and read the file back; (3) remove webhooks `WHTP4022911`, `WHTP4371922`; (4) close Typeform `gqBcyK6g` with the bilingual line (the Arabic drafted by the session under aziz-kuwaiti-voice, used as is, and listed in the after-report for the CEO to change; it does not wait on an approval); (5) unschedule `mahara-ceo-extensions-auto`; (6) `BILLING_ONLY_CARDS=86eywg1cq`, kinds `churn,extension,date,payment`, `cockpit_billing_canary('extension', {weeks:1, atRisk:false, ...})`, read back Current extension, Next Payment Date and the checkbox, then reverse with `cockpit_billing_canary('extension', {system:true, weeks:0})` and a `date` canary back to the old date; (7) the held-edit review for kinds `extension,date,payment` (W20): read Liwan's card `86ewvnqj5` and Ardon's `86eyurepc`; Liwan's grant ended 2026-11-02, so `cockpit_billing_held_release(<Liwan event>, 'close', 'grant ended before its kind opened', ...)`; Ardon: `fresh` when the card still lacks 2026-11-27, `close` when it already shows that date or a later one; any other held item of these kinds is decided the same way; (8) clear the card list | each Make scenario `isActive=false`; Liwan's item `skipped` "Closed at the kind opening" and Liwan still in `cockpit_extensions_v` as `ended`; Ardon's new item `delivered` or "unchanged" (a "stale" outcome is valid and decided by hand, never re-sent blindly); `heldOpenKind` 0 | turn the Make scenarios back on from their saved state; unset `APPLY_BILLING` |
| D-C2 | **C2-staff (wave 2):** (1) `forms_key.py typeform-secret pause_request`, `register-typeform pause_request`, `probe-typeform pause_request` (W18); (2) only then switch off Make 9805613 and read it back; (3) kinds add `pause,resume`; the held-edit review for those kinds; canary pause then resume on `86eywg1cq` | 401 then 200 on the probe; `forms-door:pause_request` registered; Paused, Paused On, Resume On, then Active with both cleared; `heldOpenKind` 0 | Make back on; remove the kinds; `unregister-typeform pause_request` |
| D-P3 | Kinds add `mrr,late`; the held-edit review for those kinds; canary `mrr` on the test card; `billing.daily.on=true` | MRR reads back; `billing-daily` reports a run (Liwan gets one clear event only if its card, which the mirror now follows, still shows extension weeks) | remove the kinds; `billing.daily.on=false` |
| D-G1 | Release the guardian with `forms_billing.py` | each new check reads ok or names a real gap | previous release |
| D-Z | Watch the first real CSM press of each act; write the session note | one line per act in the deploy note | per act's runbook row |

---

## 10. What waits on the CEO or on people

- **Q4:** invite the bot to #csm-announcements and #nps-survey-feedback. Until then the four staff notices read "Not posted" and nothing else is blocked.
- **Q2 (default applies):** Liwan's extension is recorded as given unless the CEO or the CSM says it was withdrawn before D-C1.
- **The Arabic closing line** for the extension Typeform (default, not a blocker): the session drafts it under `aziz-kuwaiti-voice`, uses it at D-C1 and lists it in the after-report; only a CEO edit changes it (the English line: "This form has moved. Message your account manager.").
- **The client-income statement** each month by the 3rd (Q12): until it arrives, new transfers wait as "logged, not checked", and the Money tab says so.
- **The two Request Type options** in ClickUp (D-R1): the systems manager, or the session under Q17's standing rule.
- **The billing agent's SOP and the portal's BillingPreview** read the ladder when their own releases land (VPS skill, portal repo); until then the SOP says day 3 and the cockpit says day 4, and the guardian names it.
- **The 21 Stopped cards without a churn date** go to a CSM review list (the churn tracker shows them as "Stopped on the card, not in the register"), never a bulk write.
- **Real first presses** of each act by the CSM, watched after D-S1.
- **A ClickUp automation that dates cards on a status change** (20261101g): if D-B3's second read shows it overwrote the Churn Date, the person who owns ClickUp automations turns it off; the cockpit never edits automations.

---

## 11. Decisions and checked facts

### 11.1 Decisions this contract makes (W-numbers), with reasons

| # | Decision | Why |
|---|---|---|
| W1 | Migrations `20261101l` to `q`, not "`b` onward" | `b` to `k` are taken on main and live (11.2-a). |
| W2 | The general `CLICKUP_WRITEBACK_APPLY` stops opening billing items | E5: turning on billing must release nothing else, and the general switch must not release billing. Today billing rides it (20261009j header). |
| W3 | Notice kinds are a CHECK widened once, not kind tables | F0's kind tables are a wave 3 refactor across a dozen functions; six kinds now, one owner, one file. |
| W4 | `termination.submitted` seeded disabled until C4b | Make 9805538's Slack module [5] still posts the same line in #csm-announcements; one channel post per event (plan §8, per channel as per field). |
| W5 | The system never opens a ticket; one press does. Each derived Today row (notice in, pause request in, pause review, cancel review, paused day 14, receipt to check) carries a button that opens the prefilled request form for its type (`client_notice`, `client_pause`, `client_offboarding`, `payment_receipt_check`), requester the presser, source `client_page`, so the ticket reaches task alerts and Your tasks. **This departs from plan 4.2 CK ("every logged row raises a payment_receipt_check request") and 5.8 ("a request client_notice ... due in 2 business days")**: the ticket is one press away instead of automatic | `cockpit_requests` needs a requester member and a source of `requests_page`, `client_page` or `import`, and its writer is live (5 delivered requests); a system door is a new ClickUp task writer the plan did not size. "Tasks never automatic" (E7) reads cleanest as rows a person acts on, and the button keeps the CEO's 10-26 ask (tasks in task alerts and Your tasks) whole. |
| W6 | The churn confirm is a new function, not a change to `cockpit_csm_churn_edit` | The edit function is live and audited as the register's editor; the confirm also writes a billing event and a response, and needs its own idempotency. |
| W7 | Field ids and options from a stored daily field read; the checkbox and Last report sent resolved by id prefix | The full ids of `9cfdb353` and `a7f4ecf5` are not in the repo; a prefix match on the live list, exactly one, of the right type, is safer than a guessed id and safer than a name. |
| W8 | A client-requested pause takes the call as consent, with the CSM's two required ticks for the plan's two consents (the term keeps running; over 14 days ends the engagement), checked in SQL, until `pause_consent` exists (wave 3) | Without it, no client-requested pause could be confirmed in wave 2; the ticks keep plan 5.2's two consents explicit; the SQL switches to requiring the signed consent the moment the registry row goes native. |
| W9 | `cockpit_extensions_v` reads billing events only | The plan's own rule: the two Typeform responses are 09-14 tests. |
| W10 | Late payments are spells over daily snapshots, with `closed_how` named | The snapshots are the only per-day history of Next Payment Date; a date that moved is not always a payment, so the view says which. |
| W11 | Pause start is today only in wave 2 | A future start would need the daily step to flip status on the day, a card write the ladder rule keeps out of system hands. |
| W12 | An exit survey with no card id in its hidden fields stays unmatched until a person picks the card | Never guess a client by name or timing (the plan's NPS rule, applied here). |
| W22 | Unmatched surveys show to every CSM seat (and the CEO), each CSM's pick limited to their own clients | Churn is the CSM's decision (D11); sending unmatched ones only to the CEO turns it into a CEO chore (stop-asking), and plan 5.8 says the per-card link is missing on 6 cards made after 09-12, so it will happen. |
| W13 | Extend always moves the date from the later of the card's date and today | The plan's 5.1; the old "Move their payment" tick let an extension leave the date behind, which is how readers drifted. |
| W14 | The canary is an owner-only SQL door on `86eywg1cq` | The test card is an internal card that billing-sync does not mirror (`isInternal`), so `cockpit_billing_write` refuses it; the door proves the writer path, PGlite proves the gate. |
| W15 | The MRR rail check is computed by the CEO money refresh | Whop lives in the read-only B2B project, which only the refresh reads; the billing sheet reads the result with its age. |
| W16 | C2-staff (Make 9805613 off, kinds `pause,resume` on) happens in wave 2; the pause Typeform closes in wave 3 | The rule is per card field: once 9805613 is off, the client's Typeform submit changes no card field (D11), and the staff pause can own Paused, Paused On and Resume On. W18 makes sure the submit is still seen. |
| W18 | The client pause Typeform `CTUjv6l3` is captured by `forms-door/typeform/pause_request` (a legacy record and a "Pause request in" row with its ticket button) before Make 9805613 goes off | "Nothing is lost": without it a client's pause request in waves 1 and 2 would go unseen once 9805613 is off. Same receiver, same signature rule as `exit_survey`; no Slack kind is added (the Today row is the signal). |
| W19 | The five staff forms are code-defined (`formDefs.ts`) until the editor ships (ED, wave 4); their registry rows are a record of the same keys and refuse changes | Two live copies would drift and a registry edit would change nothing on screen (a false promise of E18); a test keeps the record equal to the code. |
| W20 | A held billing item (`dry_run`) is never released by a switch; each kind opening runs a person's review through `cockpit_billing_held_release` (`replan`, `fresh`, `close`, `void`) | `dry_run` is terminal for the claim (11.2-o), so without a review every edit held before its kind opened would stay off the card for good while billing-sync keeps the mirror on the cockpit value. A `fresh` re-record carries today's time, so the stale verdict (`billingVerdict` compares the card's `date_updated` with `step.at`) does not skip an edit only because the card changed since. Option (b) of the review, a non-terminal "held" state, was not taken: it widens the shared claim and the queue state CHECK for every kind. |
| W21 | Departures keep the live `(task, left_on)` uniqueness; "open" means not removed, not confirmed and no later resume | A one-open-per-card index would let a second churn overwrite the first one's month, rewriting past churn counts and the lock-in. |
| W23 | A second extension while one is live replaces it (`replacesGrantId`), adding weeks from the live grant's date | The refusal alone named an action that did not exist; one defined write keeps one record per decision and one clear-on-end. |
| W17 | The extension's limitations are the cockpit's own eight choices | The Typeform's eight choices are not recorded in the repo (only "8 choices incl. NO LIMITATIONS", the inventory), its only two responses are tests, and it closes at C1, so no history needs mapping. |

### 11.2 Checked for this contract (read only, 2026-11-01)

- **a** `select name from supabase_migrations.schema_migrations where name like '202611%'`: `20261101a` (two), `b` to `k` applied 12:52 to 18:02 Kuwait.
- **b** `git for-each-ref` over heads and remotes, `git ls-tree` each: no `20261101l` or later on any branch.
- **c** `md5(regexp_replace(prosrc,'\s+',' ','g'))` for every function in 2.2, as listed.
- **d** `pg_get_constraintdef` on `cockpit_billing_events`: kinds `amount, assign, chase, churn, confirm, date, exclude, extension, invoice, link, method, note, pause, payment, plan, resume, unconfirm, unexclude, unlink`; sources `ceo, csm, maher, clickup`. Trigger `WHEN (source IN ('ceo','csm') AND kind IN ('method','plan','amount','date','extension','pause','resume','payment','note'))`.
- **e** `cockpit_churn_departures` (not removed): 6 rows, ids 17 to 22, one per card; joined to the mirror and the 11-01 billing day: Marble, Arcturus, Joe and Sera, Atlantis, حول العمران read Stopped with the register's date and "Mid-programme loss"; Alkhalil's mirror reads Paused (its held cockpit pause keeps the mirror, so the card value is read back at D-B7); Atlantis's mirror Paused On 2026-10-31; حول العمران's card has no Churn Reason (register "Other"). `20261101g` records the hand marks of 11-01.
- **f** `cockpit_csm_actions`: 4 rows, all `confirmed`, none in `reconcile`.
- **g** `cockpit_billing_accounts`: 68 cards (synced 18:07), 15 Active, 1 Active without MRR, 30 Stopped of which 22 have no churn date, 26 with MRR, 7 Active monthly summing $11,333; extension weeks 2 on Liwan and Marble (both held cockpit edits on the mirror).
- **h** `cockpit_clickup_writeback_queue` kind `billing`: 4 `dry_run` items: Marble extension `1782597f`, Liwan extension `f321bdeb` (both 10-19, to 2026-11-02), Ardon date `915fb3f0` (10-27 → 11-27), Alkhalil pause `289445c3` (10-27).
- **i** `cockpit_manual_payments`: 8 live rows (7 transfers, 1 cheque), $21,239.16, 2026-04-02 to 10-28, max `added_at` 2026-10-30. The Q20 ids: `sx7fc98m8am8fgyjfqtjnwy4718ey703`, `sx764zvpnc7gt1sb9yepq7vn4h8ftjds`, `sx7bhrq78qtqa1mn5yvagcz0198fvqsn`, `54be0e69-fd63-4dec-95d2-adc32b5a8bd1`, `cef7fc83-5eee-45bc-83c9-234d5330ec6a`, `768e486a-6bef-47ae-9d2e-781ccdbf93a5`, `1ccf2cb8-3478-48fa-b4ff-2c44b7009978`, `bdf92a9d-9d6e-4e7f-8617-90088e35b5e7`. `cockpit_billing_inbox`: 4 rows, ids 2, 3, 5 `ingested` and 4 `rejected` (the Tap row). `cockpit_manual_payment_protect` refuses any change outside the `deleted_*` columns.
- **j** `cockpit_forms`: kickoff (typeform, `tG7dnxBn`), blueprint (native), checkin (native since 2026-11-01 15:31). `cockpit_form_responses`: 8 kickoff rows only. `cockpit_slack_channels`: client-call-feedback, csm-general, media-general, all `ok`.
- **k** pg_cron: `mahara-ceo-extensions-auto` `47 * * * *` active (its last note: no Typeform response matches a card); `mahara-clickup-writeback-log` every 2 minutes ("queue is empty"; dry_run items are not counted as queued).
- **l** `cockpit_request_types`: 31 rows, `request_type_option_id` NOT NULL and unique; `cockpit_requests.source` CHECK `requests_page, client_page, import`; requester member required unless imported.
- **m** Code anchors read at `658c5a97`: `clickup-writeback/billing.ts` (7 fields, Format dropdown/date/number), `run.ts:103-121` (one general gate opens billing), `forms-door/handler.ts:45` (`FORM_KEYS = ["kickoff"]`, one registry cache), `20261029s:281` (checkin-only refusal), `cockpit-csm-api/core.ts:31-38` (booked, touchpoint, report, service already written; report found by name), `useCsmSnapshot.ts:378` (`CLICKUP_ACT_KINDS` stage and happiness), `csmLinks.ts` reactivate rows at CS `:230-234`, MB `:183-187`, `$50` at CS `:228`, MB `:181`; `billing-sync/billing.ts:83-94` (internal cards not mirrored).
- **n** `cockpit_client_billing_days`: 25 distinct days from 2026-10-07 to 2026-11-01; 2026-10-08 is missing. `cockpit_billing_accounts` has no launch, renewal or term column; the snapshots carry `launch_date`, `next_renewal_date`, `churn_type`, `churn_reason`. `cockpit_churn_departures.launched_on`: Joe and Sera 2026-04-28 → 2026-10-29 (184 days); the other five 30 to 56 days.
- **o** Live constraints and bodies read for the review of 2026-11-01: `cockpit_slack_notice_settings_kind_check` and `cockpit_slack_notice_settings_check` (the "has a channel" list) name only the 2b kinds; `cockpit_forms_keys_provider_check` = `fathom, fathom_webhook, anthropic, deepseek, typeform_kickoff`; `cockpit_forms_door_seen` raises for any form but kickoff (md5 `f300e9a2...`); `cockpit_csm_form_sent` likewise (left kickoff-only); `cockpit_form_responses_check1` = `source <> 'cockpit' OR created_by_id IS NOT NULL`; `cockpit_clickup_writeback_claim` picks `queued`, `retry`, `unknown` (and `sending` older than 10 minutes) only, so `dry_run` is terminal; `cockpit_slack_notice_claim` skips a notice whose event is over 48 hours old; `cockpit_csm_projection_read` reads `cockpit_client_payments` (md5 `d1d31a5b...`); the live `cockpit_billing_write` moves the date on an extension only when `moveDate` is true; `cockpit_churn_departures_card_day` is unique on `(clickup_task_id, left_on)` for live rows.

### 11.3 Review of 2026-11-01: findings applied and not applied

Thirty-one review findings were checked against the live database (11.2-n, 11.2-o) and the code
at `a5aaaf75`. Every one held and is applied above. Where a finding offered a choice, this
contract took one and says why; the options not taken are recorded here so nobody re-opens them:

| Finding | Option not taken | Why |
|---|---|---|
| Held billing items (1.4, 9) | (b) a non-terminal `held` state released by `billingGate` | It changes the shared claim and the queue state CHECK for every kind; the per-opening review (W20) touches only billing items and leaves a person's decision on each. |
| D-B5 ordering | moving D-B5 after D-P1 | The voids moved into `m` instead, so the Q3 voids happen in wave 1 and D-B7's Alkhalil read-back holds. |
| D-S1 before `o`/`p` (two findings, merged) | splitting the ship into three app releases | One ship after D-P1 plus the `cockpit_form_doors()` guard covers both the gap and a rollback, with fewer production releases. |
| One open grant (two findings, merged) | refusing up front with "it can be extended again after it ends" | That leaves a CSM with a client who needs more time and no way to give it; the replacement write (W23) is one defined path. |
| Legacy notice wording (two findings, merged) | keeping `legacy.received` with exit-survey wording | A kind labelled "Old form link used" would still read wrong in Settings; `termination.notice` says what happened and `legacy.received` waits for wave 3. |
| Pause consent and C2 | keeping D-C2 in wave 3 | Staff pauses would stay off the card for weeks; capturing the Typeform (W18) plus the two consent ticks keeps "nothing is lost" and the plan's consents in wave 2. |
| formDefs vs registry | FormSheet reading `cockpit_forms.schema` live | The editor that makes a live schema safe is wave 4; a code definition with a record and a test is honest now (W19). |
| ClickUp automation dating cards (plausible) | finding the automation through the API before D-B3 | ClickUp's API does not list automations; the date-first write, the second read at D-B3 and the date compare in `register-vs-card` catch it, and turning it off is a person's step (section 10). |

Not applied: none.


### 11.4 Review of the integrated branch, 2026-11-01: what changed

Twenty-five findings on the integrated `forms-w12` (after `a6e96dba`) were checked against the
live database and the code. Each held, and each is applied; where a finding offered a choice, the
one taken is named here.

- **Late spells follow the billing log** (`p` 5). A person's grant from three days before the due
  day to the spell's end closes the spell as `extended` and stops the days late at the grant; a
  run paid (checked) or extended on or before its due day is left out unless the daily step already
  opened a late record for it. Read against live data on 1 Nov (the new rule as a `SELECT`): Marble
  and Ardon are gone, Liwan reads extended after 4 days; October-due spells are Arcturus, نهوض نجد,
  Castello, Safad (all on the CEO's 20261101h list), Atlantis's 12 Oct run (stopped), شركة العلا (paid
  20 Oct, 7 days late) and Liwan. The three extras differ from the lock-in by definition (the lock-in
  counts what was unpaid on 1 Nov), so its "measured" lines show them; re-read at D-P1.
- **One ladder rule** (`o` and `p` 5b): the client page's step uses `cockpit_billing_ladder_due`'s
  predicate (open run, Active card, date not moved, no live grant, counted from the due day).
- **Seat words**: `q`'s source sentence and the billing sheet's log read both the code and the
  words. The detail builder's claim is corrected; the chain test compares canary and real card
  writes for an extension and a churn instead.
- **One churn rule** in the goal sheet, the CSM KPI and ceo-refresh: the confirm's `churn_type`
  decides; with none, a finished-term reason is completed.
- **Checked money**: projections show "Receipt in, not checked" beside Paid so far and in the cash
  note, never summed; `cockpit_billing_deal_rails` counts only checked money (the confirm cap and
  proof), `cockpit_billing_deal_rails_shown` keeps the logged rows for the pending screen; the CEO's
  bank reference on the billing sheet marks the entry checked, as on the Money tab.
- **Churn reason**: with no stored field map the reason goes on as named and clickup-writeback's
  live list decides; "Other" and a reason off the list say the card's field is left as it is.
- **A fresh release keeps its grant day** (`detail.granted_at`, read by `cockpit_extensions_v`).
- **Billing log row security** (`o` 10b): a restrictive select policy holds a direct read to the
  CEO, finance, or a CSM on their own client.
- **Unsigned hidden ids** (`l`): a survey's card from the link's hidden id is kept as
  `hidden_id_unverified` and never attached to a departure by the door; a person attaches it. The
  HMAC-signed link (option not taken now) needs the Termination Form Link reissued on every card.
- **Screens**: the sheet's status comes from the card read; call cards are grid (no empty line);
  the ticket step says where it stands and its action once, or "from the client page" when the
  billing sheet cannot open it; Today mounts the shared Checks waiting; "(optional)" follows
  conditional requirements; the exit call is never preselected ("No exit call"); the header after a
  send reads "Where it has reached"; copy fixes; the layout harness gains `state=staff`, `bands`
  and `checks` (`src/dev/formHarness.tsx`). The billing sheet and churn tracker have no harness
  scenario yet.
