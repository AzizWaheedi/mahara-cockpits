# Waves 3 and 4 build contract: client forms in the portal and by link, the client's voice, onboarding evidence, the forms editor

Written 2026-11-01 (Kuwait evening, the day waves 1 and 2 went live; revision 2 the same night after review, 11.3) for branch `forms-w34` in
two repos:

- **cockpits:** worktree `/Users/abdulazizwaheedi/mahara-worktrees/forms-w34`, cut from origin/main
  `6acf392d` (waves 1 and 2 merged, PR #133 and #134).
- **portal (Mahara OS):** worktree `/Users/abdulazizwaheedi/mahara-worktrees/portal-w34`, branch
  `forms-w34` cut from origin/main `79a5800` (live source `744e6`/`beff24a`, deployment
  `dpl_G7dmQtjWNZhbLp3UX1Y7oVksrsVg`; `npm ci` done). Never `/Users/abdulazizwaheedi/mahara-worktrees/client-portal`
  (another session's worktree, branch `client-asks`).

It builds waves 3 and 4 of `docs/forms/CSM-CLIENT-FORMS-PLAN.md` ("the plan": E1 to E20, 4.2 F1
and ED, sections 5.2, 5.8, 5.9, 5.13 to 5.16, 5.19, section 6 waves 3 and 4). The plan's section 7
defaults are approved (Q1 to Q23, Q11b included). It is modelled on `docs/forms/WAVE12-CONTRACT.md`
("W12") and keeps its habits: every claim about live state carries the query behind it (11.2,
read only, 2026-11-01), every replaced function is guarded against drift, every new writer is off
or dark at deploy and has one named way to turn on.

**The CEO's words** (quote, do not reinterpret), 2026-11-01: "now the rest of the plan and forms,
make them amazing and get them fully done", and earlier the same day: "Client forms should trigger
based on the date and if the CSM triggers it from his side. On day 60, we send the NPS survey
anyway. Then maybe the onboarding survey, after they get launched, would pop up if they haven't
done it already." This contract decides every builder question with the safest default and
records it (11.1, decisions V1 onward). Builders never ask; they follow this file, and where code
and this file disagree they stop and leave a note in their slice's report.

**Hard rules for every builder.** No push, no deploy, no migration applied, no write to the live
database, ClickUp, Make, Typeform, Slack, WhatsApp, GoHighLevel or the VPS. Read the live database
only with SELECT. Never touch `/Users/abdulazizwaheedi/mahara-cockpits` (shared checkout) or
`/Users/abdulazizwaheedi/mahara-worktrees/client-portal`. Never print a secret. Repo `CLAUDE.md`
rules hold (Supabase first; row security and its grant in the same migration; every action gated
on the server with an audit row; external calls through the existing helpers; missing is never
zero; numbers checked against a second source with a note). A view that the VPS sync or the CEO
refresh reads needs every helper function it calls executable by `supabase_read_only_user`
(lesson of `20261101r`). Before any screen: load `mahara-context/skills/frontend-design/SKILL.md`
and Hallmark (`~/.cache/mahara-ship/skills/hallmark/SKILL.md`), write the design plan (section 5
gives it), then code. Arabic lines are written under `mahara-context/skills/aziz-kuwaiti-voice`
(section 5 gives every one; a builder who needs a new one drafts it under that skill and lists it
in the slice report). `scripts/check-shared.sh` pairs stay identical. Portal: read `AGENTS.md`,
`docs/CURRENT-STATE.md`, `VERSION.json` first; read the relevant guide in
`node_modules/next/dist/docs/` before writing Next code (Next 16). Commit messages end with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## 0. The shape in fifteen lines

1. **Four cockpit migrations, `20261102a` to `20261102d`**, one per cockpit slice that needs SQL; `20261101l` to `r` are live and no branch holds a `20261102` file (11.2-a, b). The portal gets **no database migration**: its business data is reached through `portal_*` RPCs on the cockpit database (service key), and its own state stays in its storage document.
2. **F1, form invites** (`a`): `cockpit_form_invites` (one open invite per card, form and purpose; 14 days; one answer), its events, per-channel tokens stored only as sha256, token-open rate limits, portal presence counts, the seat RPCs (`_view`, `_issue`, `_withdraw`, `_link`, `_today`), the portal RPCs and their token twins, one SQL answer checker shared by every client form, message kind `form_invite`, six notice kinds, and a per-form go-live list that is the only switch for clients to see a form.
3. **The portal channel first, the link second** (E1): a signed-in client sees an invite as a pop-up through the existing ask mechanism (a new ask kind `form_invite`, at most one pop-up a day across asks and invites) and in a "Forms waiting for you" card and page; anyone else gets `https://portal.maharamedia.com/f#<token>`, sent by WhatsApp through the existing client-messages approval and worker, or copied once by the CSM.
4. **The token sits in the URL fragment** (V2): it never reaches a server log, a Referer header or WhatsApp's link preview; the page posts it in a request body, the portal hashes it, the database compares hashes. 32 random bytes, sha256 at rest, minted per channel at delivery, dead at 14 days, at the first answer, on withdraw.
5. **One renderer** in the portal (`FormRenderer`) draws every client form from the registry's published schema (client form schema v1, 3.1): bilingual, Arabic first, right to left done properly, phone first. The same SQL checker validates every answer, so no browser can skip a rule.
6. **Pause consent** (`b`, C2 client side): the CSM's pause for a client request sends a `pause_consent` invite with the proposed restart; Confirm pause stays refused in SQL until the client signs it (under 14 days, dates not marked wrong, the same restart). Then Typeform `CTUjv6l3` closes and its last Make webhook goes.
7. **The exit survey page** (`b`, C4b): the native exit survey (token by default for a closed workspace) stores the answer, posts in #csm-general and #csm-announcements, writes one card comment through the billing rails (kind `survey`) and never changes a card field (D11). Then Make `9805538` goes fully off, `WHTP4371873` goes, and `knIe4eF3` closes.
8. **NPS and CSAT** (`c`, C5) with both triggers (E20): a daily schedule issues NPS on day 60 after the first launch date and every 90 days after, and CSAT once the client is launched until they fill it; the CSM's "Send a form" works any time. The schedule is off at deploy and sends at most 3 a day, so the 7 clients already past day 60 spread over three days.
9. **The client's voice** (`c`): answers post in #nps-survey-feedback, a score of 6 or less posts in #csm-general and puts "Low score: call {client}" on the CSM's Today with a ticket button; the portal's "Share feedback" is bridged in; `cockpit_client_voice_v` feeds a new CEO metric `clients.nps` with its source note, kept apart from CSAT and feedback.
10. **NPS Survey Sent** is written on the card through the billing rails (kind `nps_sent`, V4), read back, opened by adding the kind, never by the 1-1 notes writer.
11. **Onboarding C6** (`c`): a signed webhook stores each `KFRCXPFx` answer (every effect still Make's), writes the onboarding read model at once, and the portal's onboarding gate accepts the cockpit-held answer as form evidence. **New Client Form** `BTzMwXiw`: a registry row with every effect Make's and a records-only webhook; nothing ever imitates a submission.
12. **The forms editor** (`d`, ED): admins and the CEO edit client forms' fields, Arabic and English text and routing (notices, schedules, the low-score line) in data, with a draft, a preview in the real portal renderer, publish, and "Go back to version n"; a field an effect reads cannot be removed; staff forms stay code-defined and are shown read only (V13).
13. **Seven build slices** with disjoint files (section 7): five in the cockpits, two in the portal; four start at once.
14. **Deploy** (section 9): migrations through Composio with read-backs, functions through `scripts/dev/deploy_composio.py` with `--verify-jwt` matching live, the cockpits through `scripts/ship.sh`, the portal by the Mac release steps, the client-messages worker and the guardian by native release. Each form goes live on its own (C2 client, C4b, C5), on the internal test card first, with its Typeform and Make switch-offs in the same hour, each backed up and read back. Never a test send to a real client.
15. **What waits on people** (section 10): the bot invite to #nps-survey-feedback (Q4), the Request Type option for low-score calls, and the first real client answers, which are watched, never faked.

---

## 1. Scope

### 1.1 In waves 3 and 4

| Piece | Plan ref | Slice | Live at deploy |
|---|---|---|---|
| F1 cockpit side: invites, events, tokens, token-open limits, presence, seat RPCs, portal RPCs and token twins, answer checker, message kind `form_invite`, worker link mint, `forms.client` switch, six notice kinds, registry rows `nps`, `csat`, `portal_feedback` (the `client_low_score` request type is added at D-R2) | 4.2 F1, 5.9 | invites-core | dark: no form in `forms.client.live`, so no invite can be issued |
| WhatsApp invite sending (`hermes/client-messages` learns `form_invite`, mints the link at send) | 5.9 | invites-core | dark: `CLIENT_MESSAGES_KINDS` keeps `recap_checkin` only |
| Portal: renderer, `/api/forms`, `/f` + `/api/forms/token`, the `form_invite` ask kind in the pop-up, "Forms waiting for you" card and `forms` page (open while the workspace is locked), invite phone alerts, presence push, staff preview | 4.2 F1, E1 | portal-forms | inert: the cockpit returns no invites; presence push refused until `forms.client.presence` |
| Pause consent native, Confirm pause gated on it, C2 client side | 5.2 | client-lifecycle (SQL), cockpit-screens (pause sheet) | the old two-tick consent keeps working until `pause_consent` is live |
| Exit survey native, C4b, card comment kind `survey`, the native survey in the churn tracker and Notice in | 5.8 | client-lifecycle (SQL), cockpit-screens (tracker, client page) | the Typeform and Make 9805538 keep running until C4b |
| Billing kinds `survey` and `nps_sent` (card writes through the rails) | 3.1, 5.8, 5.13 | client-lifecycle | held: neither kind is in `CLICKUP_WRITEBACK_BILLING_KINDS` |
| NPS and CSAT native, the daily schedule (E20), Today rows, C5 | 5.13, 5.14 | client-voice (SQL, worker side), cockpit-screens (screens) | schedule off (`forms.schedule.on` false) |
| Feedback bridge (portal "Share feedback" into the cockpit) | 5.15 | portal-bridges (portal), client-voice (RPC) | dark: refused until `portal_feedback` is live |
| CEO metric `clients.nps` (and `clients.csat`) with source note, "Client voice" card, brief line, csm-calls entry | 5.13 | client-voice (metric, csm-calls), cockpit-screens (card, brief) | live on the next refresh; reads "No scores yet" |
| Onboarding webhook C6 into forms-door, read model, 14-day receipts check; portal gate accepts cockpit evidence | 5.16 | client-voice (cockpit), portal-bridges (portal) | the webhook is registered at deploy step D-C6 |
| New Client Form registry row (make-owned), records-only webhook, backfill, `WHTP4096881` disabled | 5.19 | client-voice | registered at D-NCF |
| Forms editor (ED): drafts, publish, restore, preview, field guard, routing | 4.2 ED, E18 | forms-editor | live on ship (admins and the CEO only) |
| Links repointed (NPS, CSAT, pause, termination in both apps and `csm_assistant.py`) | 5.2, 5.8, 5.13, 5.14 | cockpit-screens | live on ship |
| Guardian checks and runbook rows | 8 | client-voice | report-only |

### 1.2 Not in waves 3 and 4

- Bank transfer receipt (5.17, purpose `bank_receipt`), the file bucket `cockpit-form-files` and the `file` field type (V10): wave 5. The v1 schema check refuses `file`.
- Reactivate your ads (5.18), the wins ledger, upsells, the daily LTV writer, the billing agent's own login, Confirm paid moving the date: waves 5 and 6.
- Onboarding native in the portal and the New Client Form's "New MRR" question (Stage 4, Q21). C6 only records.
- Staff forms editable in data (V13): ED lists them read only.
- `cockpit_client_asks` stays for review and referral asks only (plan 4.1); invites are their own table (V20).
- The portal's own billing (E16) stays off.
- The 55 held ClickUp edits (Q19): untouched.

### 1.3 What only people can do (never faked)

| Item | Who |
|---|---|
| Invite the Slack bot to #nps-survey-feedback `C09TTGBRQ0G` (Q4; the channel row reads `refused`, 11.2-e). **D-C5 waits for it** (plan C5 starts with the invite, `PLAN.md:580,842`): until the channel row reads `ok` and the notices doctor passes, NPS and CSAT stay on Typeform and Make 8962328/8962387 keep posting in the channel | the CEO |
| Create the Request Type option "Client low score" on ClickUp field `e9fd8024` (D-R2) | the systems manager, or the session at D-R2 on Q17's standing rule (as D-R1 did) |
| A client's first real portal answer, link answer, pause consent and exit survey | clients; watched after each go-live, never imitated |
| A CSM's first real "Send a form" to a live client and first WhatsApp approval | the CSM |
| Arabic wording changes to anything in section 5 | the CEO (the session's drafts are used as is until he edits them, through ED for client forms) |

### 1.4 The switches (every new writer, its switch and its state at deploy)

| Writer | Switch | Where | At deploy | Turned on |
|---|---|---|---|---|
| Client invites (issue, portal display, token use) per form | `cockpit_settings` key `forms.client` `{"live":[...], "presence":bool}`: a form key must be in `live` **and** its registry row `provider='native'` and `audience='client'` (`cockpit_form_client_live(key)`) | database | `{"live":[],"presence":false}` | per form by `cockpit_form_client_go_live(key, true, actor)` at D-C2C (`pause_consent`), D-C4B (`exit_survey`), D-C5 (`nps`, `csat`), D-FB (`portal_feedback`) |
| Presence push from the portal | `forms.client.presence` | database | false | D-PR (after the portal release) |
| The automatic schedule (NPS day 60 and every 90 days, CSAT after launch) | `forms.schedule` `{"on":bool,"maxPerRun":3,"hourKuwait":10}` and each `cockpit_form_schedules.on` | database | `on:false`; both schedule rows `on:true` (inert while the master is off) | D-C5 step 7 |
| WhatsApp sends of invite links | `CLIENT_MESSAGES_KINDS` must list `form_invite` in `~/.client-messages/switches.env` (and `CLIENT_MESSAGES_APPLY=true`, already on for recaps since 2b) | VPS file | `recap_checkin` only (form_invite rows wait approved, then fall back to draft after 24 h) | D-WA, canary card first through `CLIENT_MESSAGES_ONLY_CARDS=86eywg1cq` |
| Card comment on an exit survey (`survey`) and NPS Survey Sent (`nps_sent`) | the kind in `CLICKUP_WRITEBACK_BILLING_KINDS` (W12's billing gate) | Edge secrets of `clickup-writeback` | neither listed (items `dry_run`) | `survey` at D-C4B, `nps_sent` at D-C5; each opening runs W20's held-edit review (none expected) |
| Notice kinds `pause.consent`, `nps.received`, `csat.received`, `voice.low`, `feedback.received`, `legacy.received` | the kind's settings row `enabled` and its channel row `ok` | database | all seeded enabled; `nps.received`/`csat.received` would fail closed "Not posted: the bot is not in #nps-survey-feedback" until Q4, which is why D-C5 waits for Q4 | when the CEO invites the bot (before D-C5) |
| `termination.submitted` (#csm-announcements) | its settings row | database | disabled (W4: Make 9805538 [5] still posts) | D-C4B, in the hour Make 9805538 goes off |
| Feedback bridge | `portal_feedback` in `forms.client.live` | database | refused with `{recorded:false,reason:'not_live'}`; the portal's own save is never affected | D-FB |
| Onboarding webhook | the cockpit webhook on `KFRCXPFx` and key `typeform_onboarding` | Typeform and the vault | not registered | D-C6 |
| New Client Form webhook | the cockpit webhook on `BTzMwXiw` and key `typeform_new_client` | Typeform and the vault | not registered | D-NCF |
| Invite phone alerts | the portal cron claims only invites with `push_state='waiting'`, set at issue only when the seat ticks "Phone alert" and the form is live | database | none can exist | with each form's go-live |
| New screen doors | `cockpit_form_doors()` flags `invites`, `lifecycle`, `voice`, `editor` (each true only when its functions exist and its `forms.doors` marker is true) | database (read) | hidden with "Opens after the next cockpit update." | by migrations `a`, `b`, `c`, `d` |

---

## 2. The migrations

### 2.1 Names and order

The live database holds `20261101a` (two files) and `b` to `r` (query 11.2-a). No branch and no
worktree holds a `20261102` file (11.2-b). Waves 3 and 4 take `20261102a` to `d`:

| Order | File | Slice | Holds |
|---|---|---|---|
| 1 | `supabase/migrations/20261102a_forms_invites.sql` | invites-core | F1 tables and RPCs, answer checker, text rule, notice kinds, message kind, `forms.client`, registry rows `nps`, `csat`, `portal_feedback`, hooks dispatcher, `cockpit_form_doors` |
| 2 | `supabase/migrations/20261102b_client_lifecycle.sql` | client-lifecycle | `pause_consent` registry row, exit survey v2 schema, billing kinds `survey` and `nps_sent`, the pause confirm gate, the exit-survey and pause-consent hooks, Notice in, prefill and churn read changes |
| 3 | `supabase/migrations/20261102c_client_voice.sql` | client-voice | schedules, the schedule run, NPS/CSAT/feedback hooks, `cockpit_client_voice_v`, low-score rows, feedback bridge, onboarding and New Client Form registry rows, forms-door keys, `cockpit_form_record_make`, `portal_form_status` |
| 4 | `supabase/migrations/20261102d_forms_editor.sql` | forms-editor | schema drafts, publish, restore, read, preview, the field guard, `cockpit_form_registry_apply` replaced |

**The letter rule.** Before builders start and again before every apply, the orchestrator reads
`select name from supabase_migrations.schema_migrations where name like '20261102%' or name like '20261103%'`,
`git ls-tree --name-only origin/main supabase/migrations/` and every branch and worktree. If any of
`a` to `d` is taken, the whole block moves to the next free consecutive letters, same order, and
this table is amended before builders start. Builders never rename a file. Tests name the files
by full stem (`20261102a_forms_invites.sql`).

**Every file**: starts `BEGIN;`, ends `NOTIFY pgrst, 'reload schema'; COMMIT;`, applies twice
without error, uses `LANGUAGE plpgsql` for any function that names an object of a later file (a
SQL-language body is checked at creation), and writes `CREATE OR REPLACE` / `IF NOT EXISTS` /
guarded CHECK swaps (`pg_get_constraintdef ... NOT LIKE`, as `20261029t` does).

**Row security and grants** (W12 2.1, unchanged). Every new table: `ENABLE ROW LEVEL SECURITY`;
`REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`; `GRANT` service_role exactly what it
needs; no browser grant; browser access only through `SECURITY DEFINER ... SET search_path = ''`
functions whose first line is the gate; an audit trigger (`cockpit_audit_log`, through the existing
`cockpit_forms_audit()` trigger function where the table is a forms table); delete and truncate
refused on invites, invite events, tokens and schema drafts (`cockpit_forms_refuse_delete()`).
Every new view: `WITH (security_invoker = true)`, revoked from PUBLIC, anon and authenticated,
`GRANT SELECT` to service_role, and, when the CEO refresh or the VPS sync reads it,
`GRANT SELECT` to `supabase_read_only_user` plus `GRANT EXECUTE` to that role on every function the
view calls (11.2-k shows the role exists). Every new or replaced function is revoked from all four
roles first and granted exactly as section 3 says.

**The drift guard.** Each file that replaces a live function opens, right after `BEGIN;`, with one
`DO` block that reads `md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))` for every function it
replaces (2.2) and raises `55000` `<function> changed since the waves 3-4 contract read it; stop
and re-read it.` unless the value is the live md5 below or the file's own "after" value (written
into the file by its builder, asserted by the slice's PGlite test). Before each apply the deploy
saves `pg_get_functiondef` of each to
`/Users/abdulazizwaheedi/mahara-cockpits/notes/forms-w34/deploy/before-<name>.sql`.

### 2.2 Functions replaced (one owner each; live body md5 read 2026-11-01, 11.2-c)

| Function | Live body md5 | Live ACL | Replaced by | Change |
|---|---|---|---|---|
| `cockpit_slack_notice_shape(text)` | `19fdd9d7e444648e6b7a8ec37789b00c` | owner | `a` | six kinds, all `post` |
| `cockpit_slack_notice_kind_label(text)` | `d44ee66b9ff6f0eb01cc6d053e0b9176` | owner | `a` | six labels (3.4) |
| `cockpit_slack_notice_live(cockpit_slack_notices)` | `61d9e369f2b555acb1ac3e185df28dae` | owner | `a` | live rules for six kinds |
| `cockpit_slack_notice_inputs(jsonb)` | `8f03d16f00739d63b2ed2442526f5a3b` | service_role | `a` | kind list |
| `cockpit_slack_notice_doctor_inputs()` | `b535391a05c453ec109eb81f29b89898` | service_role | `a` | order list |
| `cockpit_slack_notice_settings_read()` | `ea3863b49c25ed786fa7b3e81e1c6d17` | authenticated | `a` | order list |
| `cockpit_slack_notice_settings_set(text,jsonb)` | `60751ee78283238fc89d33bb76b050df` | authenticated | `a` | kind list |
| `cockpit_slack_channel_remove(text)` | `06adfc699c3110b99f084d1e60cb16a0` | authenticated | `a` | order list, refusal names the new kinds |
| `cockpit_slack_notice_rehearse(text)` | `20cab5786b0a54be30f88fcaa5f1931f` | authenticated | `a` | kind list |
| `cockpit_slack_notice_rehearse_service(text,text)` | `4cfbc884fe8c2c6946f09d818fa7be17` | service_role | `a` | kind list |
| `cockpit_slack_notice_read(text)` | `cfdcb4241f40a4452d50219f3ba11291` | authenticated | `a` | the new kinds visible to csm, finance and CEO seats |
| `cockpit_client_message_approve(uuid,text,text,uuid,text[])` | `528d7d0f273333ed734480ed947211c2` | service_role | `a` | `form_invite`: the body holds `{form_link}` exactly once, passes `cockpit_client_text_ok`, ≤ 1,000 characters; wording "message", not "recap", for that kind |
| `cockpit_client_message_claim(text[],text[],integer)` | `66c32c23fa588801b2cccbd3ec6e5f40` | service_role | `a` | `form_invite` joins the allowed kinds |
| `cockpit_client_message_view(cockpit_client_messages)` | `3f04490fe00e1d627896c21a4530e1f2` | owner | `a` | form label for `form_invite` (`v_form` from the invite) |
| `cockpit_form_effect_gate(text,text)` | `e498f48795c2644fb037df056828c736` | owner | `a` | its `client_message` branch first asks `cockpit_form_invite_gate(message id)` for a `form_invite` row (open, not expired, form live or a canary invite, and `cockpit_form_card_allows(task, form_key)` true: `nps`, `csat`, `pause_consent` need the mirror's `client_status = 'Active'` and no open departure; `exit_survey` is exempt, it goes to clients who left; a card the mirror does not hold, the test card, passes); every other branch byte for byte |
| `cockpit_form_doors()` | `2ceb94ae0589b54ce53b6810e3eac87c` | authenticated | `a` | adds `invites`, `voice`, `editor` (3.3) |
| `cockpit_form_responses_guard()` | `38fa9795b15dbc93494a691f88766b0f` | owner | `b` | the "answer the notice" carve-out (`answer_meta.answered`, once, under `cockpit.forms_legacy='answer'`) also covers `state='submitted'` rows of `exit_survey` and `pause_consent`; nothing else changes |
| `cockpit_billing_write(text,jsonb)` | `8bdd972146ee2dfc0a5e1c6c0c5c47e4` | authenticated | `b` | the pause's consent branch reads `cockpit_form_client_live('pause_consent')` instead of the registry row alone, and then needs `consentResponseId` (4.3) |
| `cockpit_billing_writeback_writes(text,text,text,jsonb)` | `dc073d43dfc0c8ae6c610f97d2c75eb6` | owner | `b` | cases `survey` (none) and `nps_sent` (`npsSent` = the day) |
| `cockpit_billing_writeback_comment(text,text,text,jsonb,text)` | `8d46fdc717d86d7e791a4d1c03ac9bdb` | owner | `b` | `survey` comment; the pause comment's consent line names a signed consent |
| `cockpit_billing_detail(text,jsonb)` | `9b1a740c3d6002277cf6ae4130441939` | owner | `b` | details for `survey`, `nps_sent`; the pause's `consent.response_id` |
| `cockpit_billing_canary(text,jsonb)` | `c25d1d6741035e15d73f351c313ca327` | owner | `b` | kinds `survey`, `nps_sent` on `86eywg1cq` only |
| `cockpit_form_notices_in()` | `098efc1d02330ab8dba95b3ba76d8454` | authenticated | `b` | native exit surveys (verified card) and `pause_consent` rows (4.3, 4.4) |
| `cockpit_form_prefill(text,text)` | `822602f21ebe9575e45db5bc1f344072` | authenticated | `b` | `pause` gets `consent`; `churn_confirm` gets the native survey and its invite |
| `cockpit_csm_churn_read()` | `8f19c5b1488146d73f72e8d8aa1aba07` | authenticated | `b` | each departure carries `surveyInvite` |
| `cockpit_forms_door_seen(text,text,text)` | `063bd0689f11f79aeebc6270b370d28a` | service_role | `c` | accepts `onboarding` and `new_client` |
| `cockpit_forms_key_put(jsonb)` | `24478cd132a02c9a370f27bccff506dc` | service_role | `c` | accepts `typeform_onboarding`, `typeform_new_client` |
| `cockpit_forms_key_mark(jsonb)` | `1075daac5191d53bae1e17c87b296160` | service_role | `c` | same |
| `cockpit_forms_key_label(text)` | `85af18f124fd053ef832cca3eae6eb2b` | owner | `c` | "Client onboarding webhook", "New Client Form webhook" |
| `cockpit_forms_keys_status()` | `695113cef48b9994447a539ae5fd7949` | authenticated | `c` | the `typeform` list gains both |
| `cockpit_form_record_legacy(jsonb)` | `50c4257c579f6269e2f8b8318086c743` | service_role | `c` | accepts `nps`, `csat` (backfill only, no card) and keeps `exit_survey`/`pause_request`; a delivery for a form whose registry row is native queues `legacy.received` (V16) |
| `cockpit_form_registry_apply(text,jsonb,jsonb)` | `73a88dc6513b074e54d76ec4472d3539` | owner | `d` | client forms change only through `cockpit_form_publish` (4.9); staff forms keep W19's refusal |

**Not replaced by any file here:** `cockpit_client_message_intent`, `_sweep`, `_result`,
`_work` (they call the effect gate, which learns `form_invite`); `cockpit_client_lifecycle_confirm`
(the exit-survey hooks write the departure's survey columns); `cockpit_form_submit`,
`cockpit_form_open`, `cockpit_form_plan_effects` (staff and checkin paths, untouched);
`cockpit_form_trail`; `cockpit_forms_effects_valid` (the deliveries `sql`, `slack_notice`,
`clickup_queue`, `client_message` cover every new effect, 11.2-j); `cockpit_billing_writeback_enqueue`
(its payload carries any kind; only the trigger's `WHEN` changes, in `b`);
`cockpit_clickup_writeback_claim`.

### 2.3 `20261102a_forms_invites.sql` (invites-core)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_form_responses` columns `invite_id uuid`, `signer text CHECK (signer IS NULL OR char_length(btrim(signer)) BETWEEN 2 AND 120)`, `lang text CHECK (lang IS NULL OR lang IN ('ar','en'))` | columns | (table unchanged) | `invite_id` gets its FK after the invites table exists |
| `cockpit_form_responses_source_check` gains `portal` | CHECK swap | | guarded; `public` already exists and is the token path's source |
| unique partial index `cockpit_form_responses_one_per_invite` on `(invite_id) WHERE invite_id IS NOT NULL AND state IN ('submitted','confirmed')` | index | | one answer per invite (V3) |
| `cockpit_form_invites` (columns 3.2) | table | service_role `SELECT, INSERT, UPDATE` | unique partial `(task_id, form_key, purpose) WHERE state = 'open'`; index `(location_id, state)`; index `(push_state, issued_at) WHERE push_state IN ('waiting','sending')`; audit; no delete |
| `cockpit_form_invite_events` (3.2) | table | service_role `SELECT, INSERT` | index `(invite_id, at)`, `(person, at) WHERE source = 'portal'`; audit; no delete |
| `cockpit_form_invite_tokens` (3.2) | table | service_role `SELECT, INSERT, UPDATE` | unique `token_sha256`, unique `message_id`; audit trigger that never copies `token_sha256` into the audit row (the trigger function blanks it); no delete |
| `cockpit_form_token_opens` (3.2) | table | service_role `SELECT, INSERT, DELETE` | the only table here a function may delete from (rows older than 2 days, by the schedule run's sweep); no audit (counts only, no person) |
| `cockpit_portal_presence` (3.2) | table | service_role `SELECT, INSERT, UPDATE` | one row per workspace; counts only, never an email |
| Message kind: `cockpit_client_messages_kind_check` gains `form_invite`; `cockpit_client_messages` column `invite_id uuid REFERENCES cockpit_form_invites(id)` | CHECK swap, column | | guarded |
| `cockpit_slack_notices_kind_check`, `cockpit_slack_notice_settings_kind_check`, `cockpit_slack_notice_settings_check` (the "has a channel" list) gain the six kinds of 3.4; `cockpit_slack_notices_check1` (task required) adds `legacy.received` to the kinds allowed without a card | CHECK swaps | | guarded; seeded rows below need all four |
| the eleven notice functions, the three client-message functions, `cockpit_form_effect_gate`, `cockpit_form_doors` | replaced | as 2.2 | |
| `cockpit_slack_notice_settings` rows for the six kinds (3.4) | seed `ON CONFLICT DO NOTHING` | | |
| `cockpit_settings` `forms.client` `{"live":[],"presence":false}`; `forms.doors` merged with `{"invites":true}` | seed (merge, never overwrite) | | |
| `cockpit_forms` rows `nps`, `csat`, `portal_feedback` and their version 1 (3.1 schemas, 5.x copy) | seed `ON CONFLICT DO NOTHING` | | `nps` keeps `typeform_id 'fuPgs85S'`, `csat` keeps `'KbcbPA73'` (history and backfill); provider `native`, audience `client`, seats `{csm}`, client_scoped true; `portal_feedback` has no invite path (bridge only) |
| `cockpit_client_text_ok(p_text text) RETURNS text` | function, `IMMUTABLE` | none | NULL when fine, else the refusal sentence (V18) |
| `cockpit_form_schema_check(p_schema jsonb) RETURNS text` | function, `IMMUTABLE` | none | NULL when the schema is valid v1 (3.1), else the first problem as a sentence |
| `cockpit_form_answers_check(p_schema jsonb, p_answers jsonb, p_context jsonb) RETURNS jsonb` | function, `IMMUTABLE` | none | `{ok bool, errors:{fieldKey: code}}` (3.1) |
| `cockpit_form_client_live(p_form_key text) RETURNS boolean` | function, `STABLE` | none | registry native + client + in `forms.client.live` |
| `cockpit_form_client_go_live(p_form_key text, p_on boolean, p_actor text) RETURNS jsonb` | function | none (owner, deploy only) | adds or removes the key in `forms.client.live`; going live checks the schema of `cockpit_form_client_version(key)` with `cockpit_form_schema_check` and, for `exit_survey`, moves the provider `typeform` → `native` and the registry `schema`/`version` to that version in the same statement (keeping `typeform_id`, V16); going off withdraws every open invite of that form with reason `Form switched off`; audit row |
| `cockpit_form_invite_gate(p_message_id uuid) RETURNS jsonb` | function, `STABLE` | none | `{ok, reason}` for a `form_invite` message |
| `cockpit_form_card_allows(p_task_id text, p_form_key text) RETURNS text` | function, `STABLE` | none | NULL when the card may receive the form, else the refusal sentence. `nps`, `csat`, `pause_consent`: the mirror's `client_status = 'Active'` (an allowlist: `Stopped`, `GHOSTED`, `SALES TEAM TO CONTACT`, `Brand Blueprint Booked` and anything new are refused, 11.2-q) and no open departure (W12 W21: not removed, not confirmed, no later resume) → else `{client} is not an active client, so this form does not go to them.` / `{client} is leaving. Send the exit survey instead.`; `exit_survey`: an open or confirmed departure (not removed, no later resume) or `client_status = 'Stopped'` → else `Mark Client is leaving first, then send the exit survey.` A card the mirror does not hold (the test card) passes. Read by issue, the system issuer, the gate, every portal display and token path, and the schedule sweep |
| `cockpit_form_client_version(p_form_key text) RETURNS integer` | function, `STABLE` | none | the newest `cockpit_form_versions.version` of the form whose schema has `v = 1` (the client schema of 3.1); NULL when none. Issue, the canary and go-live use it, so `exit_survey` can be invited (canary) and go live on version 2 while the registry still reads version 1 (2.4) |
| `cockpit_form_invite_view`, `_issue`, `_withdraw`, `_link`, `cockpit_form_invites_today`, `cockpit_form_answer_read` | browser RPCs | `authenticated` | 3.3 |
| `portal_form_for_person`, `portal_form_list`, `portal_form_get`, `portal_form_invite_record`, `portal_form_submit`, `portal_form_token_open`, `portal_form_token_submit`, `portal_form_preview`, `portal_form_invites_push_claim`, `portal_form_invite_push_done`, `portal_form_invite_display`, `portal_form_presence_put` | portal RPCs | `service_role` | 3.3 |
| `cockpit_client_message_invite_link(p_id uuid, p_claim uuid)` | worker RPC | `service_role` | 3.3 (name matches the worker's `RPC_NAME`) |
| `cockpit_form_client_submitted(p_response_id uuid)` and `cockpit_form_client_issued(p_invite_id uuid)` | functions | none | the dispatchers (V19): common steps, then `cockpit_form_hook_<key>` / `cockpit_form_issue_hook_<key>` when `to_regprocedure` finds them |
| `cockpit_form_invites_expire()` | function, `VOLATILE` | none | open invites past `expires_at` → `expired`, their tokens revoked, their unsent `draft`/`approved` messages skipped; called by the schedule run's sweep and at the top of every **write** path (`_issue`, `_withdraw`, `_link`, `portal_form_get`, `portal_form_submit`, `portal_form_token_open`, `_token_submit`, `portal_form_invites_push_claim`). Never called by a `STABLE` read: PostgREST runs `STABLE` functions in a read-only transaction. Every read treats `state = 'open' AND expires_at <= now()` as expired without writing (V25) |
| `cockpit_form_invite_issue_system(...)`, `cockpit_form_invite_canary(...)` | functions | none (owner) | 3.10 |
| `cockpit_form_invites_withdraw_ineligible()` | function | none | withdraws every open invite whose card `cockpit_form_card_allows` now refuses (reason `The client is no longer active.` or `The client is leaving.`), revokes its tokens, skips its `draft`/`approved` message; called by the schedule run's sweep; the portal paths refuse such an invite at once (`withdrawn`) without waiting for the sweep |
| `cockpit_form_client_live_list() RETURNS text[]` | browser RPC, `STABLE` | `authenticated` | the live keys, for the client page's Links rows (4.11) |
| `cockpit_request_type_add` is reused (live, W12 `l`) for `client_low_score` at D-R2; no new function | | | |

### 2.4 `20261102b_client_lifecycle.sql` (client-lifecycle)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_forms` row `pause_consent` (native, audience client, seats `{csm}`) and version 1; `exit_survey` version 2 in `cockpit_form_versions` (the client schema of 3.1/5.6, published by `migration 20261102b`). The **registry row stays** `version` 1, schema `{lives:'typeform'}`, provider `typeform` until `cockpit_form_client_go_live('exit_survey', true)` moves provider, schema and version together to `cockpit_form_client_version('exit_survey')` | seed guarded (`ON CONFLICT DO NOTHING`) | | `pause_consent` is not live (1.4), so the old two-tick path keeps working; the live `cockpit_form_record_legacy` keeps stamping Typeform termination answers with version 1 until C4b, and `c`'s replacement pins them to the newest `lives:'typeform'` version after it (2.5) |
| `cockpit_billing_events_kind_check` gains `survey`, `nps_sent` | CHECK swap | | guarded |
| trigger `cockpit_billing_events_clickup_writeback` | dropped and recreated | | `WHEN` adds `(NEW.source = 'system' AND NEW.kind IN ('extension','ltv','late','survey','nps_sent'))` to W12's condition, unchanged otherwise |
| `cockpit_billing_writeback_writes`, `_comment`, `cockpit_billing_detail`, `cockpit_billing_canary`, `cockpit_billing_write`, `cockpit_form_responses_guard`, `cockpit_form_notices_in`, `cockpit_form_prefill`, `cockpit_csm_churn_read` | replaced | as 2.2 | |
| `cockpit_form_hook_pause_consent(p_response_id uuid)`, `cockpit_form_hook_exit_survey(p_response_id uuid)`, `cockpit_form_issue_hook_exit_survey(p_invite_id uuid)`, `cockpit_form_issue_hook_pause_consent(p_invite_id uuid)` | functions | none | 4.3, 4.4 |
| `cockpit_pause_consent_for(p_task_id text) RETURNS jsonb` | function, `STABLE` | none | the latest consent state for a card (4.3); read by the billing write and the prefill |
| `cockpit_settings` `forms.doors` merged with `{"lifecycle":true}` | seed | | read by `cockpit_form_doors()` (`a`) |

### 2.5 `20261102c_client_voice.sql` (client-voice)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_form_schedules` (`form_key text PRIMARY KEY REFERENCES cockpit_forms(key)`, `on boolean NOT NULL`, `rule jsonb NOT NULL CHECK (jsonb_typeof(rule)='object' AND octet_length(rule::text) <= 2048)`, `updated_by text NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`) | table | service_role `SELECT, INSERT, UPDATE` | seeds `nps` `{"firstDay":60,"everyDays":90,"remindAfterDays":7}` and `csat` `{"afterLaunchDays":0,"whatsappAfterDays":3,"snoozeDays":3,"reissues":3,"retryAfterDays":7,"maxAgeDays":60}`, both `on:true`; audit. The run reads every key by name and treats a missing or non-integer key as a refusal for that form (`skipped.ruleNotSet`, said in the run's note as `The {form} rule has no {key}. Set it in the forms editor.`), never as NULL or a default |
| `cockpit_settings` `forms.schedule` `{"on":false,"maxPerRun":3,"hourKuwait":10}`, `voice.low_score` `{"max":6}`; `forms.doors` merged with `{"voice":true}` | seed | | `cockpit_settings_forms_audit` already audits `forms.%` (read its live body; if it does not, `c` does not replace it and the schedule run writes its own audit rows) |
| `cockpit_form_schedule_run(p_now timestamptz DEFAULT now(), p_apply boolean DEFAULT true) RETURNS jsonb` | function | `service_role` | 4.5; returns the plan when `p_apply` is false |
| pg_cron `mahara-form-schedule` at `0 7 * * *` (UTC, 10:00 Kuwait) calling `cockpit_form_schedule_run()` | cron block | | writes `cockpit_sync_state` `form-schedule`; does nothing but the sweep while `forms.schedule.on` is false, and says so |
| `cockpit_form_hook_nps`, `cockpit_form_hook_csat`, `cockpit_form_issue_hook_nps`, `cockpit_form_issue_hook_csat` | functions | none | 4.5 |
| view `cockpit_client_voice_v` (3.5) | view | service_role, `supabase_read_only_user` `SELECT` | its helpers granted EXECUTE to `supabase_read_only_user` |
| view `cockpit_form_invites_daily_v` (`day` Kuwait, `form_key`, `issued`, `answered`; counts only, no person) | view | service_role, `supabase_read_only_user` `SELECT` | the NPS second source (3.5); helpers granted the same way |
| `cockpit_client_voice_read(p_task_id text)`, `cockpit_client_voice_today()`, `cockpit_client_voice_summary(p_from date, p_to date)` | browser RPCs, `STABLE` | `authenticated` | 3.3 |
| `portal_feedback_record(p_location_id text, p_clickup_id text, p_person text, p_feedback jsonb) RETURNS jsonb` | portal RPC | `service_role` | 4.6 |
| `cockpit_forms_keys_provider_check` gains `typeform_onboarding`, `typeform_new_client` | CHECK swap | | guarded |
| `cockpit_forms` rows `onboarding` (typeform `KFRCXPFx`, audience client, every effect `make`) and `new_client` (typeform `BTzMwXiw`, audience team, seats `{sales}`, every effect `make`) and version 1 | seed | | effects listed in 4.7, 4.8, each `owner:'make'` |
| `cockpit_form_record_make(p jsonb) RETURNS jsonb` | function | `service_role` | 4.7 (forms-door's writer for make-owned live Typeforms) |
| `portal_form_status(p_location_id text, p_clickup_id text, p_form_key text) RETURNS jsonb` | portal RPC | `service_role` | 4.7 |
| the forms-door and forms-key functions and `cockpit_form_record_legacy` | replaced | as 2.2 | `cockpit_form_record_legacy` stamps each legacy row with the newest version of the form whose schema has `lives = 'typeform'` (1 for `exit_survey` and `pause_request`), else the registry version (`nps`, `csat`: no Typeform-shaped version exists; `cockpit_form_answer_read` shows a `legacy` row's raw keys, never a client schema's labels) |

### 2.6 `20261102d_forms_editor.sql` (forms-editor)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_form_schema_drafts` (`form_key text PRIMARY KEY REFERENCES cockpit_forms(key)`, `base_version integer NOT NULL`, `schema jsonb NOT NULL` (≤ 64 KB, object), `saved_by text NOT NULL`, `saved_at timestamptz NOT NULL DEFAULT now()`) | table | service_role `SELECT, INSERT, UPDATE, DELETE` | a draft row is removed on publish (the published version is the record); audit |
| `cockpit_form_editor_read()`, `cockpit_form_editor_read_one(p_form_key text)` | browser RPCs, `STABLE` | `authenticated` | admin or CEO (`cockpit_form_seat`), else `Only an admin or the CEO edits forms.` |
| `cockpit_form_draft_save(p_form_key text, p_schema jsonb, p_base_version integer)` | browser RPC | `authenticated` | refuses a base older than the published version: `Someone published version {n} since you opened this. Reload it.` |
| `cockpit_form_publish(p_form_key text, p_note text, p_base_version integer)` | browser RPC | `authenticated` | 4.9 |
| `cockpit_form_restore(p_form_key text, p_version integer, p_note text)` | browser RPC | `authenticated` | 4.9; publishes the old schema as a new version |
| `cockpit_form_routing_set(p_patch jsonb)` | browser RPC | `authenticated` | schedules, `voice.low_score`; notices stay on the live `cockpit_slack_notice_settings_set` |
| `cockpit_form_registry_apply` | replaced | none | 2.2 |
| `cockpit_settings` `forms.doors` merged with `{"editor":true}` | seed | | |

### 2.7 Portal-side schema

None in a database. The portal adds keys to its own storage (`readState`/`transaction` in
`src/lib/storage.ts`, B2B `mahara_portal_documents`, untouched schema):

- the workspace notification journal (`notification-store.ts`, per workspace) gains `formDeliveries` beside `askDeliveries`, same shape and same 30-day pruning (portal-forms);
- nothing else. Rate limits, tokens, presence and answers live in the cockpit database.

---

## 3. Shapes every slice builds to

### 3.1 Client form schema v1 (the registry `schema` of every client form; the renderer, the SQL checker and ED all read it)

```jsonc
{
  "v": 1,
  "key": "nps",                                   // = cockpit_forms.key
  "title":  {"en": "...", "ar": "..."},           // every text is {en, ar}, both required, ≤ 200 chars
  "intro":  {"en": "...", "ar": "..."} | null,    // ≤ 600 chars
  "minutes": 1,                                   // 1..10, shown on the pop-up
  "audience": "any" | "admin",                    // admin: only the workspace admin sees it in the portal (V9)
  "signer": "none" | "typed",                     // typed: the token path asks "Your full name" (pause_consent, exit_survey);
                                                  // none: no name on either path (nps, csat). The portal path always records the session person.
                                                  // ED never changes audience or signer of a published form (4.9.3)
  "context": [ { "key": "restart", "type": "date", "label": {...} } ],   // read-only facts shown from invite.context
  "fields": [ {
      "key": "recommend",                         // ^[a-z][a-zA-Z0-9]{1,30}$, unique, immutable once published
      "type": "scale" | "choice" | "multi" | "text" | "longtext" | "tick",   // "date", "file" reserved, refused in v1 (V10)
      "label": {...}, "hint": {...} | null,
      "required": true,
      "min": 0, "max": 10,                        // scale only, integers, 0..1 ≤ min < max ≤ 10
      "lowLabel": {...}, "highLabel": {...},      // scale only
      "options": [ {"value": "results", "label": {...}} ],   // choice/multi: 2..12, values ^[a-z][a-z0-9_]{1,30}$
      "maxLength": 2000,                          // text ≤ 200, longtext ≤ 2000
      "showIf": {"key": "datesWrong", "equals": true} | null,   // one equality on an earlier field
      "boldIf": {"context": "over14", "equals": true} | null    // tick only: bold when a context fact holds
  } ],
  "reads": { "low_score": ["recommend"] },        // effect key -> field keys a hook reads (ED's guard)
  "submit": {...}, "done": {...},
  "invite": { "whatsapp": {"en": "...{client}...{form_link}", "ar": "..."},   // {form_link} exactly once, {client} optional
              "push": {"en": "...", "ar": "..."} }
}
```

`cockpit_form_answers_check` codes (the renderer maps each to its 5.x sentence, both languages):
`required` (missing or blank; a required `tick` must be `true`), `range` (scale outside min..max or
not an integer), `option` (not one of the options; `multi` a non-empty array of distinct options),
`length` (over `maxLength`, or `signer` outside 2..120), `unknown` (an answer key the schema does
not have), `hidden` (an answer to a field whose `showIf` is false: refused, never stored). A
`showIf` field that is hidden is never required; an unanswered `tick` reads `false` when a `showIf`
compares it. Answers are a flat object
`{fieldKey: value}`; texts are trimmed and collapsed (`regexp_replace(... '\s+', ' ')`) before the
length check; the stored answers are the checked ones. Every client-facing string of a schema, and
every invite note, passes `cockpit_client_text_ok` at seed, at publish and at issue.

`cockpit_client_text_ok(text)` (V18) returns one of:
- `Client messages never quote leads or cost per lead. Say how the campaign is doing, or count appointments for clients we book for.` when the text matches the 20261012f pattern (Arabic ليد/ليدز forms, عملاء محتملين, `leads?`, `cpls?`, `cost per lead`; copy the regex from `20261012f_wa_send_rules.sql` line 77 exactly);
- `Client forms never promise results. Remove the guarantee wording.` when the text matches `\mguarantee[sd]?\M|\mguaranteeing\M|ضمان|نضمن|مضمون` (case-insensitive);
- NULL otherwise.

### 3.2 Tables

`cockpit_form_invites`:

| Column | Rule |
|---|---|
| `id uuid PRIMARY KEY` | the seat's request id (or `gen_random_uuid()` for the schedule); a retry returns the first result |
| `task_id text NOT NULL` | `^[A-Za-z0-9_-]{1,40}$`; on the billing sheet |
| `client_name text NOT NULL` | from `cockpit_billing_accounts` |
| `location_id text` | `portal_data.workspaces.location_id` when exactly one workspace carries the card, else NULL |
| `form_key text NOT NULL REFERENCES cockpit_forms(key)`, `form_version integer NOT NULL` | FK `(form_key, form_version)` to `cockpit_form_versions`; `cockpit_form_client_version(form_key)` at issue (2.3), kept for the answer |
| `purpose text NOT NULL CHECK (purpose IN ('pause_consent','exit_survey','nps','csat'))` | equals `form_key` in waves 3 and 4; wave 5 widens the list |
| `context jsonb NOT NULL DEFAULT '{}'` | object, `octet_length ≤ 4096`; checked per purpose: `pause_consent` `{start (date, today to today + 14, plan 5.2), restart (date, after start), reasonCat, callId, over14 bool (restart − start > 14)}`; `exit_survey` `{departureId?}`; `nps` `{round int ≥ 1}`; `csat` `{try int 1..4}` |
| `channels text[] NOT NULL` | non-empty, `<@ {portal,whatsapp,copy}` |
| `audience text NOT NULL CHECK (audience IN ('any','admin'))` | from the schema |
| `note text` | ≤ 280, client-facing (shown under the title), passes the text rule |
| `lang text NOT NULL CHECK (lang IN ('ar','en'))` | the WhatsApp text's language (default `ar`) |
| `origin text NOT NULL CHECK (origin IN ('csm','schedule','pause','churn','canary'))` | set by `p_origin` on `_issue` (seats: `csm`, `pause`, `churn`), `schedule` by the system issuer, `canary` by the canary door |
| `state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','answered','withdrawn','expired'))` | |
| `issued_by uuid`, `issued_by_email text`, `issued_by_role text NOT NULL` | NULL / NULL / `the cockpit` for the schedule; roles in screens and cards, emails for the audit only |
| `issued_at timestamptz NOT NULL DEFAULT now()`, `expires_at timestamptz NOT NULL` | `issued_at + 14 days` |
| `answered_at`, `response_id uuid REFERENCES cockpit_form_responses(id)`, `closed_at`, `closed_by`, `closed_reason text` (≤ 240) | |
| `push boolean NOT NULL DEFAULT false`, `push_state text NOT NULL DEFAULT 'off' CHECK (push_state IN ('off','waiting','sending','sent','no_device','failed'))`, `push_claim_until`, `push_result jsonb`, `push_at` | the asks' columns, same meaning |
| `message_id uuid` | the `form_invite` message when the WhatsApp channel is on (FK added after the column exists) |
| `updated_at timestamptz NOT NULL DEFAULT now()` | |

`cockpit_form_invite_events`: `id bigint GENERATED ALWAYS AS IDENTITY`, `invite_id uuid NOT NULL REFERENCES cockpit_form_invites(id)`,
`at timestamptz NOT NULL DEFAULT now()`, `source text NOT NULL CHECK (source IN ('cockpit','schedule','portal','token','push','worker'))`,
`event text NOT NULL CHECK (event IN ('issued','shown','opened','later','answered','withdrawn','expired','link_made','link_sent','refused','hook_failed'))`,
`person text` (lowercased email for `portal`, NULL otherwise), `detail jsonb NOT NULL DEFAULT '{}'` (object, ≤ 2 KB, never a token or an answer).

`cockpit_form_invite_tokens`: `id bigint GENERATED ALWAYS AS IDENTITY`, `invite_id uuid NOT NULL REFERENCES cockpit_form_invites(id)`,
`channel text NOT NULL CHECK (channel IN ('whatsapp','copy'))`, `token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$')`,
`message_id uuid UNIQUE` (whatsapp only), `made_by text NOT NULL` (role words), `made_at timestamptz NOT NULL DEFAULT now()`,
`revoked_at timestamptz`, `revoked_reason text` (≤ 120), `opens integer NOT NULL DEFAULT 0`, `last_opened_at timestamptz`.
At most one unrevoked `copy` token per invite (partial unique `(invite_id) WHERE channel='copy' AND revoked_at IS NULL`).

`cockpit_form_token_opens`: `id bigint GENERATED ALWAYS AS IDENTITY`, `at timestamptz NOT NULL DEFAULT now()`,
`net_hash text NOT NULL CHECK (net_hash ~ '^[0-9a-f]{64}$')`, `browser_hash text CHECK (browser_hash IS NULL OR browser_hash ~ '^[0-9a-f]{64}$')`,
`outcome text NOT NULL CHECK (outcome IN ('ok','unknown','expired','used','withdrawn','not_live','limited','submitted','refused'))`, `token_id bigint`.
Index `(net_hash, at)`, `(browser_hash, at)`.

`cockpit_portal_presence`: `location_id text PRIMARY KEY CHECK (location_id ~ '^[A-Za-z0-9_-]{1,100}$')`,
`last_session_at timestamptz` (the newest unexpired, unrevoked client session's sign-in or refresh time), `admins integer NOT NULL`,
`members integer NOT NULL` (people with a live session in the last 14 days), `pushed_at timestamptz NOT NULL`.

### 3.3 RPC signatures

**Volatility (V25).** `STABLE` (read only, never call `cockpit_form_invites_expire`, treat an open
invite past `expires_at` as expired in what they return): `cockpit_form_invite_view`,
`cockpit_form_invites_today`, `cockpit_form_answer_read`, `cockpit_form_client_live_list`,
`portal_form_for_person`, `portal_form_list`, `portal_form_preview`, `cockpit_client_voice_read`,
`cockpit_client_voice_today`, `cockpit_client_voice_summary`, `portal_form_status`, the editor reads.
`VOLATILE` (they write): `_issue`, `_withdraw`, `_link`, `portal_form_get` (records `opened`),
`portal_form_invite_record`, `portal_form_submit`, `portal_form_token_open` (logs the open),
`_token_submit`, the three push functions, `portal_form_presence_put`, `portal_feedback_record`,
`cockpit_client_message_invite_link`, the editor writes. A PGlite test calls every `STABLE` one inside
`SET TRANSACTION READ ONLY`.

**Skipping an unsent message (every path that closes an invite: answer, withdraw, expiry, go-live
off, ineligible sweep).** Only a `form_invite` message in `draft` or `approved` is moved to
`skipped` (the live `cockpit_client_messages_guard`, md5 `c676efff216517fc709ec927ca9edc55`, allows
nothing else). A `claimed` or `sending` row is left alone: `cockpit_form_invite_gate` refuses a
closed invite, so `cockpit_client_message_intent` moves it to `refused` with the gate's reason, and
the next schedule sweep moves `refused` rows of closed invites to `skipped` (allowed by the guard).
A row already past intent sends a link that answers `answered`/`withdrawn`, which is the honest
outcome. No path raises on a message state.

Every browser RPC: `SECURITY DEFINER SET search_path = ''`, gate first (`cockpit_csm_client_gate(task)`
for a card, or `cockpit_form_seat(auth.uid())` for CEO/admin), an audit row for every write,
refusals as plain sentences with `ERRCODE` `42501` (who) or `22023` (what). Every portal RPC:
service role only, checks `p_location_id ~ '^[A-Za-z0-9_-]{1,100}$'`, `p_clickup_id ~ '^[A-Za-z0-9_-]{1,40}$'`,
that exactly one `portal_data.workspaces` row has both and its status is not `Cancelled`/`Removed from sheet`,
and that the invite belongs to that card; a mismatch raises `form_invite_not_in_workspace` (the
portal maps it to 403), a bad person `client_ask_invalid_person` (reuse `portal_client_ask_person`).

```
-- a (invites-core), seats
cockpit_form_invite_view(p_task_id text) RETURNS jsonb                     -- authenticated
  -> {taskId, clientName, cardStatus (mirror client_status),
      workspace: {locationId, name, status} | null,
      presence: {lastSessionAt|null, admins, members, pushedAt|null, note},
      problem: 'no_workspace'|'two_workspaces'|'workspace_closed'|'no_recent_session'|null,
      defaultChannels: ['portal'] | ['portal','whatsapp'] | ['whatsapp'],
      forms: [{key, title:{en,ar}, live bool, sendable bool, why|null, audience, defaultChannels}],   -- why: "Opens to clients after its switch-on." / "Sent from Pause this client." (pause_consent) / "They already filled it on {date}." (csat) / the cockpit_form_card_allows sentence (e.g. exit_survey "Mark Client is leaving first, then send the exit survey.")
      open: [InviteRow], history: [InviteRow] (last 10, newest first),
      templates: {formKey: {en, ar}}}
  InviteRow = {id, formKey, title, state, channels, origin, issuedAt, issuedByRole, expiresAt,
               opened bool, openedAt|null, answeredAt|null, responseId|null, messageState|null,
               linkMade bool, closedReason|null}
  Default channel rule, per form (never the sheet status alone): no workspace or closed workspace ->
  whatsapp; a form with audience 'any' and presence members + admins > 0 with a live session in the
  last 14 days -> portal; a form with audience 'admin' (pause_consent, exit_survey) and
  presence.admins > 0 -> portal; otherwise portal + whatsapp; presence not reported yet (before D-PR)
  -> portal + whatsapp. The top-level defaultChannels is the NPS form's. The presence note for an
  admin form with members only reads "No admin has opened the portal in 14 days, so the WhatsApp
  link goes too." (5.1).
cockpit_form_invite_issue(p_task_id text, p_form_key text, p_channels text[], p_note text,
  p_lang text, p_push boolean, p_context jsonb, p_request_id uuid, p_origin text DEFAULT 'csm')
  RETURNS jsonb                                                               -- authenticated
  p_origin in ('csm','pause','churn') for seats (anything else: 'Pick where this form is sent from.').
  Gate: CEO, or a CSM allowed on the client. The form live (else 'This form opens to clients after
  its switch-on.'); pause_consent only with p_origin 'pause' (called by the pause sheet;
  else 'Send the pause consent from Pause this client.'); csat refused when a submitted csat
  exists ('They already filled the onboarding survey on {date}.'); one open invite per card, form
  and purpose ('A {form} is already out to {client}, sent {date}. Withdraw it to send a new one.');
  cockpit_form_card_allows(task, form) refuses with its sentence (2.3: nps/csat/pause_consent only
  to an Active card with no open departure; exit_survey only with a departure or a Stopped card);
  'portal' needs a workspace that is not closed ('{client} has no open Mahara OS
  workspace. Send the WhatsApp link.'); note through cockpit_client_text_ok. Inserts the invite
  (expires +14 days), event 'issued'; with 'whatsapp' inserts the cockpit_client_messages row
  (kind form_invite, state draft, body = the registry template with {client} filled and {form_link}
  kept, dedupe 'invite:'||id, group_source 'client_data_f', invite_id) and sets message_id;
  push_state 'waiting' when p_push and 'portal' is a channel; calls cockpit_form_client_issued.
  Repeat request id returns the first result. -> {inviteId, messageId|null, delivered: 'portal' |
  'waiting_approval', view} ('portal' when the portal is a channel; 5.1 toasts from it).
cockpit_form_invite_withdraw(p_task_id text, p_invite_id uuid, p_reason text) RETURNS jsonb
  Reason 4..240. Only an open invite. Revokes its tokens, skips its unsent message when it is
  draft or approved (the skip rule above; 'Withdrawn in the cockpit: {reason}'), event 'withdrawn'
  with detail {by:'seat'} (the schedule reads it, 4.5.4). -> view.
cockpit_form_invite_link(p_task_id text, p_invite_id uuid) RETURNS jsonb   -- authenticated
  Only an open invite of a live form. Revokes the invite's unrevoked copy token, mints a new one
  (3.6), event 'link_made'. -> {url ('https://portal.maharamedia.com/f#'||token), expiresAt}.
  The only place a raw token leaves the database for a seat; shown once, never stored.
cockpit_form_invites_today() RETURNS jsonb                                 -- authenticated, STABLE
  -> [{kind: 'sent_today'|'not_answered'|'approve_link'|'answered'|'exit_survey_due', inviteId|null,
       taskId, clientName, formKey, title, at, days, messageId|null, departureId|null}]; CSM: allowed
       clients; CEO: all. Canary invites (origin 'canary') never appear.
  not_answered: open, issued ≥ schedule remindAfterDays (7) ago, not opened or opened and not
  answered. approve_link: its message is 'draft'. answered: answered in the last 24 hours.
  exit_survey_due (plan 5.8): a departure that is open or confirmed (not removed, no later resume)
  with survey_state 'not_sent' and no open exit_survey invite; one row per departure.
cockpit_form_answer_read(p_response_id uuid) RETURNS jsonb                 -- authenticated, STABLE
  Gate on the response's card. -> {formKey, title, submittedAt, source, signer (portal: role
  words 'the client admin'|'a client member'; token: the typed name, or 'someone with the link' when
  the form asks no name), lang, fields:[{key, label (en), value, display}]}; never an email. A
  `legacy` row shows its raw keys (2.5). Shadow (canary) rows are read only for the test card.

-- a, portal (service_role)
portal_form_for_person(p_location_id text, p_clickup_id text, p_person text, p_access_role text,
  p_invite_id uuid DEFAULT NULL) RETURNS jsonb
  -> {invite: PortalInvite|null, reason: 'shown_today'|'nothing_waiting'|'snoozed'|null}
  The pop-up pick: open invites of live forms for this card, audience 'any' or (admin and
  p_access_role='admin'), oldest first; skipped when this person 'later'd it within snoozeDays (csat 3,
  others 3); none when this person saw any ask or invite pop-up for this workspace within 20 hours
  (both event tables, V8), unless p_invite_id (the phone alert's deep link). The cap is checked
  first and returns reason 'shown_today' whenever any ask or invite pop-up was shown to this person
  in this workspace within 20 hours, **even when no invite is open**, so `/api/asks` stops there and
  never reaches the live `portal_client_ask_for_person` (which reads ask events only and is not
  replaced). Invites whose card cockpit_form_card_allows refuses are skipped.
  PortalInvite = {id, formKey, version, title:{en,ar}, minutes, note|null, from (first name of the
  issuing seat, or null for the schedule: the portal then shows "From your Mahara team", 5.10),
  issuedAt, expiresAt, audience, lang (the invite's lang: the renderer's default on the token page)}
portal_form_list(p_location_id, p_clickup_id, p_person, p_access_role) RETURNS jsonb
  -> {forms: [PortalInvite & {state: 'open'|'answered', answeredAt|null}]} (open ones, plus those
  answered in the last 7 days so the page can say "Sent"), filtered by audience.
portal_form_get(p_location_id, p_clickup_id, p_person, p_access_role, p_invite_id uuid) RETURNS jsonb
  -> {invite: PortalInvite & {schema (that version), context, state}} or a refusal code in
  {reason: 'not_found'|'answered'|'expired'|'withdrawn'|'not_live'|'admin_only'}; records 'opened'
  once per person per day.
portal_form_invite_record(p_location_id, p_clickup_id, p_invite_id uuid, p_person text,
  p_event text, p_detail jsonb DEFAULT '{}') RETURNS jsonb
  p_event in ('shown','opened','later'); {via:'push'} allowed in detail. -> {ok, recorded}.
portal_form_submit(p_location_id, p_clickup_id, p_person, p_access_role, p_invite_id uuid,
  p_answers jsonb, p_request_id uuid, p_lang text) RETURNS jsonb
  Refusals as reason codes (never raises for a client mistake): 'answered', 'expired', 'withdrawn',
  'not_live', 'admin_only', 'invalid' (+ errors from cockpit_form_answers_check).
  Inserts cockpit_form_responses (form_key, form_version from the invite, source 'portal',
  external_id 'portal:'||p_request_id, task_id, client_name, mode 'live', state 'submitted',
  answers (checked), answer_meta {invite_id, person_role}, hidden {}, created_by 'portal',
  submitted_by the person's email, submitted_at now(), invite_id, signer NULL, lang); sets the
  invite answered, revokes its tokens, skips its unsent message only when draft or approved (the
  skip rule above; 'Answered in the portal'), event 'answered', calls cockpit_form_client_submitted.
  Repeat request id returns the first result. A canary invite's answer is stored mode 'shadow' with
  answer_meta.canary true (3.10).
  -> {ok:true, responseId, done:{en,ar}} | {ok:false, reason, errors?}.
portal_form_token_open(p_token_sha256 text, p_net text, p_browser text) RETURNS jsonb
  Rate limits first (3.6). -> {ok:true, invite: PortalInvite & {schema, context, clientName,
  signer: the schema's 'typed'|'none'}} | {ok:false, reason: 'limited'|'unknown'|'expired'|
  'answered'|'withdrawn'|'not_live'}. Increments the token's opens. Logs one
  cockpit_form_token_opens row. PortalInvite.lang is the renderer's starting language.
portal_form_token_submit(p_token_sha256, p_net, p_browser, p_answers jsonb, p_signer text,
  p_request_id uuid, p_lang text) RETURNS jsonb
  As portal_form_submit with source 'public', external_id 'token:'||p_request_id, signer the typed
  name (required when the schema's signer is 'typed'), event source 'token', answer_meta
  {invite_id, channel: the token's channel}. The token's audience rule: an admin-only form takes
  the typed name instead of a session (V9).
portal_form_preview(p_form_key text, p_draft boolean) RETURNS jsonb
  -> {schema (published, or the ED draft when p_draft), context: a fixed sample per purpose (3.7)}.
portal_form_invites_push_claim(p_limit integer DEFAULT 20) / portal_form_invite_push_done(
  p_invite_id uuid, p_location_id text, p_state text, p_result jsonb) /
  portal_form_invite_display(p_location_id, p_clickup_id, p_invite_id uuid, p_person text)
  The asks' three push functions, same lease (5 minutes), same states, same day cut-off, for invites.
portal_form_presence_put(p_rows jsonb) RETURNS jsonb
  p_rows = [{locationId, lastSessionAt|null, admins, members}] (≤ 200 rows). Refused with
  {ok:false, reason:'off'} while forms.client.presence is false. Upserts; a workspace the
  portal no longer lists is left as it was. -> {ok, rows}.

-- a, worker (service_role)
cockpit_client_message_invite_link(p_id uuid, p_claim uuid) RETURNS jsonb
  Only for a form_invite message in state 'sending' with that claim token (called right after
  cockpit_client_message_intent answered ok). Mints the 'whatsapp' token for this message (unique
  message_id: a second call answers {ok:false, reason:'already_made'} and the worker sends nothing).
  -> {ok:true, url}. Event 'link_sent' (no token).

-- a, owner
cockpit_form_client_go_live(p_form_key text, p_on boolean, p_actor text) RETURNS jsonb

-- b (client-lifecycle): no new browser RPC; the pause and churn screens use the replaced
-- cockpit_billing_write, cockpit_form_prefill, cockpit_form_notices_in, cockpit_csm_churn_read and
-- a's invite RPCs.

-- c (client-voice)
cockpit_client_voice_read(p_task_id text) RETURNS jsonb                    -- authenticated, STABLE
  -> {nps: {latest: {score, results|null, communication|null, startStop|null, at, round} | null,
            history: [{score, at}] (last 6)},
      csat: {score|null, liked|null, disliked|null, at|null},
      feedback: [{kind, topic, rating|null, message, at}] (last 5),
      open: [InviteRow of nps/csat], source: 'From the client''s own answers in the portal or by
      link. The 2 old Typeform answers could not be matched to a client, so they are left out.'}
cockpit_client_voice_today() RETURNS jsonb                                 -- authenticated, STABLE
  -> [{kind:'low_score', responseId, taskId, clientName, formKey, score, at, ticketOpen bool}]
  a live (not shadow) response of nps (recommend) or csat (onboarding) at or under
  voice.low_score.max in the last 14 days. ticketOpen = a `cockpit_requests` row with
  `type_key = 'client_low_score'`, `client_task_id` = the response's card, `created_at` at or after
  the response's `submitted_at`, and `state` not cancelled (real columns, 11.2-r; the unchanged
  prefilled request opener already sets `client_task_id`). One ticket covers every low score of
  that card before it.
cockpit_client_voice_summary(p_from date, p_to date) RETURNS jsonb         -- authenticated, STABLE
  CEO and CSM seats. -> {nps:{score|null, n, promoters, passives, detractors, from, to, note},
  csat:{average|null, n, note}, invites:{nps:{sent, answered, cardsAnswered}, csat:{sent, answered}}}
  (the second source of 3.5 compares nps.n with invites.nps.cardsAnswered)
portal_feedback_record(...)                                                -- service_role
portal_form_status(p_location_id, p_clickup_id, p_form_key) RETURNS jsonb  -- service_role
  p_form_key 'onboarding' only. -> {submitted: bool, submittedAt|null, reference (response id)|null,
  source: 'typeform_webhook'|'typeform_sync'|null, unverified: bool}

-- d (forms-editor): 2.6.
```

`cockpit_form_doors()` (`a`) returns W12's seven flags unchanged plus:
`invites` (marker `invites` and every `a` seat RPC exists), `lifecycle` (marker `lifecycle` and
`b`'s hooks exist), `voice` (marker `voice` and `cockpit_client_voice_read(text)` exists), `editor`
(marker `editor` and `cockpit_form_publish(text,text,integer)` exists). A rollback that restores an
old body flips its marker to false in the same step.

### 3.4 Notice kinds (`a`)

| Kind | Label | Channel (seeded) | Mention | Enabled at seed | Live rule | Text (`cockpit-notices/text.ts`) |
|---|---|---|---|---|---|---|
| `pause.consent` | Pause consent signed | #csm-general `C09RZ0GS0V9` | `seat:csm` | yes | the consent is the card's latest and no pause event came after it | `{client} signed the pause consent. Confirm the pause in the cockpit.`; dates wrong: `{client} says the pause dates are wrong. Open the pause in the cockpit.` + button "Open the client" |
| `nps.received` | NPS answer in | #nps-survey-feedback `C09TTGBRQ0G` | none | yes (fails closed until Q4) | the response exists | `{client}: {score}/10 would recommend{, {results}/10 on results so far}.` |
| `csat.received` | Onboarding survey answer in | #nps-survey-feedback | none | yes (same) | the response exists | `{client}: {score}/10 for getting started.` |
| `voice.low` | Low score | #csm-general | `seat:csm` | yes | no `client_low_score` request raised for the response yet | `{client} gave {score}/10 on the {survey words}. Call them today.` + button "Open the client" |
| `feedback.received` | Portal feedback in | #csm-general | `seat:csm` | yes | the response exists | `{client} shared {kind words} in the portal about {topic words}.` + button "Open the client" |
| `legacy.received` | Old form link used | #csm-general | none | yes | the response exists | `{form words} came in through the old link for {client or "a client not matched to a card"}. Open it in the cockpit.` |

`termination.submitted` (W12) is enabled at D-C4B; native exit surveys queue both
`termination.notice` (#csm-general, `seat:csm`) and `termination.submitted` (#csm-announcements).
Facts are names, dates and scores only: never an amount, a lead count, an email, a phone or a
free-text answer. Dedupe keys: `consent:{response id}`, `nps:{id}`, `csat:{id}`, `low:{id}`,
`feedback:{id}`, `legacy:{id}`. A kind whose channel row is not `ok` settles `failed` with
`Not posted: the bot is not in #{channel}. Ask the CEO to invite it.` (W12 rule).

### 3.5 `cockpit_client_voice_v` (`c`; one row per answer, read by the CEO refresh)

`response_id, clickup_task_id, client_name, form_key ('nps'|'csat'|'portal_feedback'), invite_id,
round (nps context round, else NULL), submitted_at, submitted_day (Kuwait), source ('portal'|'public'),
score integer (nps: recommend 0..10; csat: onboarding 1..10; portal_feedback: rating 1..5 or NULL),
results integer, communication integer, band ('promoter' 9-10 | 'passive' 7-8 | 'detractor' 0-6 | NULL
for csat and feedback)`. Only `state IN ('submitted','confirmed')`, `mode = 'live'`, task not NULL,
`answer_meta.canary` not true. Legacy Typeform answers (state `legacy`) are left out (V17); canary
answers are `mode = 'shadow'` (3.10), so they never reach this view, `cockpit_form_invites_daily_v`
(which also drops origin `canary`), `cockpit_client_voice_today`, `cockpit_form_notices_in` or the
CEO metric.

The NPS number (`clients.nps`, a window): per card, the latest NPS answer in the window counts
once; NPS = round(100 × (promoters − detractors) / n); `n = 0` → NULL with "No scores yet". Second
source, like with like: the count of **distinct cards** with an `answered` NPS invite event (non-canary
invite) in the same window must equal n (both from the database, two tables, written by different
steps); a mismatch puts "Cards with an answered invite {x}, cards with an answer {n}" in the note and
the guardian warns. A card answering twice in the window (day 60 and day 150, or Send again) counts
once on both sides.

### 3.6 Tokens and security (one place)

- **Format:** `'f1' || translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_')`: `f1` plus 43 base64url characters (256 bits). Regex `^f1[A-Za-z0-9_-]{43}$`.
- **Where it lives:** only in the WhatsApp message the worker sends and in the one answer of `cockpit_form_invite_link`. At rest only `encode(sha256(convert_to(token,'UTF8')),'hex')`. The portal hashes the token before any RPC, so the database never receives a raw token on the open or submit path. No log line, audit row, event detail, health ledger receipt or error holds a token or its hash.
- **URL:** `https://portal.maharamedia.com/f#<token>` (V2). The page reads `location.hash`, removes it at once with `history.replaceState(null, '', '/f')`, and posts it in a JSON body to `/api/forms/token`. Never a query string, never a path segment.
- **Lifetime:** the invite's `expires_at` (14 days). Dead at the first answer (any channel), on withdraw, when the form goes off, and when a new copy link replaces an old one. One answer per invite (unique index). Tokens are per card, form and purpose because the invite is.
- **Rate limits (in SQL, `portal_form_token_open`/`_submit`):** per browser hash 30 tries a minute, per network hash 120 a minute, per network hash 10 `unknown` tokens in 10 minutes; over any limit the answer is `limited` and the row is logged `limited`. `net_hash` = HMAC-SHA256 of `form-net:` + the client IP from `x-forwarded-for` (first entry; Vercel sets it) with the portal's `SESSION_SECRET`; `browser_hash` = sha256 of the HttpOnly cookie `mahara_form_b` (16 random bytes, `SameSite=Strict`, `Secure`, `Path=/api/forms`, 30 days), set on the first open. Opens older than 2 days are deleted by the schedule run's sweep.
- **Headers on `/f` and `/api/forms/token`:** `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`; the page sets `<meta name="robots" content="noindex,nofollow">`. `/api/forms/token` requires `Origin` equal to `APP_URL`'s origin (as `requireSameOrigin`), never calls `identity()`, and works for a Cancelled workspace (the exit survey's case).
- **Members and admins:** in the portal an admin-only form (`audience:'admin'`: pause consent, exit survey) is listed and popped up only for `accessRole === 'admin'`; members never see it (V9). By link, the typed name is the signer.

### 3.7 Preview sample contexts (`portal_form_preview`, staff only, nothing recorded)

`pause_consent`: `{start: today, restart: today + 14, reasonCat: 'client_asked', over14: false}`;
`exit_survey`: `{}`; `nps`: `{round: 1}`; `csat`: `{try: 1}`. The portal's staff preview is
`/?clientId=<workspace>&formPreview=<key>[&draft=1]` (owner role only) and shows the banner
"Team preview: this is what the client sees. Nothing is recorded."

### 3.8 Billing kinds `survey` and `nps_sent` (`b`; W12 3.3 extended)

| Event (`kind`, `source`) | `detail` keys | Writes, in order | Comment |
|---|---|---|---|
| `survey` system | `form_key 'exit_survey', response_id, invite_id, notice_on, reasons[], ratings {ads, people, comms}, recommend, kept_us?, comments? (each text ≤ 300 in the comment), via 'portal'|'link'` | none (D11: no card field) | `CONTRACT TERMINATION SURVEY (notice received {date})` / `Why: {reasons words}` / `Ads {n}/10 · The people who reached them {n}/10 · Communication {n}/10` / `Would recommend: {n}/10` / `What would have kept them: {text or "not said"}` / `Comments: {text or "none"}` / `Filled: in the portal | by link` / `Confirm the churn or answer the notice in the cockpit.` |
| `nps_sent` system | `invite_id, on (Kuwait day of issue), round` | `npsSent` (NPS Survey Sent `34b2d7c0-6a95-4382-8c5b-5dcb83a9ac53`, date) = `on` | none |

`billing.ts` BILLING_FIELDS gains `npsSent` (`34b2d7c0-6a95-4382-8c5b-5dcb83a9ac53`, date;
11.2-f read it from the stored field map). `billing-sync` `columnsOf` maps neither kind (no
mirror column). The pause comment's consent line reads `Consent: signed in the portal {date}` or
`Consent: signed by link {date}` when `detail.consent.kind = 'signed'`, else W12's `Consent: on the
call {date}`. No email and no name on the card.

### 3.9 Message kind `form_invite`

Body template from the registry's `invite.whatsapp[lang]`, `{client}` replaced at issue by the
card's client name, `{form_link}` kept. The CSM may edit the text before approving; approval checks
the placeholder (exactly once), the text rule, ≤ 1,000 characters, and the existing sha check.
The worker replaces `{form_link}` with the minted URL at send and compares group messages with the
link masked back to `{form_link}` (4.10), so a read-back or an `unknown` search never needs the
token. Recaps are untouched.

### 3.10 Additions to 3.3 for the schedule and the canary (`a`)

```
cockpit_form_invite_issue_system(p_task_id text, p_form_key text, p_channels text[], p_context jsonb,
  p_origin text) RETURNS uuid                                              -- none (owner): the schedule's issuer
  Every rule of cockpit_form_invite_issue except the seat gate; issued_by NULL, issued_by_role
  'the cockpit', origin 'schedule', lang 'ar', push true when 'portal' is a channel; source
  'schedule' on the event. A refusal returns NULL and the reason goes in the run's report.
cockpit_form_invite_canary(p_form_key text, p_context jsonb, p_channels text[] DEFAULT '{copy}')
  RETURNS jsonb                                                            -- none (owner, deploy only)
  Card 86eywg1cq only ('The canary writes only the test card 86eywg1cq.'), whatever the live list
  says, origin 'canary', channels {copy} or {copy,whatsapp} (whatsapp makes a draft form_invite
  message on the test card), location NULL; returns {inviteId, url, messageId|null} (a copy token,
  shown once). Canary invites pass every live check (issue, token open and submit, the message
  gate) and nothing else does. A canary answer is stored `mode = 'shadow'` with
  `answer_meta.canary = true` (the live guard keeps mode fixed, and a submitted row can never become
  void, so it is marked at insert). It runs the form's hooks, but its notices are inserted already
  'muted' ("Canary on the test card: not posted") and its billing events carry by_whom 'canary', so
  the deploy voids them by record after the read-back (W12's lesson). Every client-voice reader,
  `cockpit_form_invites_today`, `cockpit_form_notices_in` and the daily view leave shadow answers
  and canary invites out; `cockpit_pause_consent_for` and `cockpit_form_answer_read` read them only
  for card `86eywg1cq` (the read-backs), which is not on the billing sheet, so no pause can use one.
```

`cockpit_form_invites.origin` CHECK is `('csm','schedule','pause','churn','canary')`.

---

## 4. The builds

### 4.1 F1 in the cockpits (invites-core)

Files: migration `a`; `supabase/functions/cockpit-notices/{text.ts,send.ts,doctor.ts,text.test.ts,run.test.ts,testkit.ts}`;
`apps/client-success-cockpit/src/lib/notices.ts`, `src/components/NoticesRouting.tsx`, `src/dev/noticesFixtures.ts`;
`supabase/functions/cockpit-forms-api/{door.ts,messages.ts,door.test.ts,messages.test.ts}`;
`hermes/client-messages/{worker.ts,core.ts,worker.test.ts,core.test.ts,RUNBOOK.md}`;
`apps/media-buyer-cockpit/scripts/forms-invites-supabase.test.ts`.

1. SQL per 2.3, 3.1 to 3.3, 3.6, 3.9, 3.10. `cockpit_form_answers_check` and `cockpit_form_schema_check` are pure and table-driven (one `CASE` per field type), so the portal's mirror (`client-form-schema.ts`, 4.2) can be tested against the same fixtures (`apps/media-buyer-cockpit/scripts/fixtures/client-form-answers.json`, written by this slice, copied byte for byte by portal-forms into `tests/fixtures/client-form-answers.json`; D0 compares the two files with `cmp`).
2. The dispatchers (V19): `cockpit_form_client_submitted(response)` runs, in order: the invite to `answered`, tokens revoked, unsent message skipped, event `answered`, then `cockpit_form_hook_<form_key>(response_id)` when `to_regprocedure('public.cockpit_form_hook_'||key||'(uuid)')` finds it (else nothing more). `cockpit_form_client_issued(invite)` likewise calls `cockpit_form_issue_hook_<form_key>(uuid)`; an **issue** hook that raises rolls the issue back (it is a rule, e.g. "This client is already paused"). A **submit** hook runs inside its own `BEGIN ... EXCEPTION WHEN OTHERS` block after the response is stored and the invite closed: a raise is caught, the hook's partial writes roll back to that savepoint, an invite event `hook_failed` is written (detail `{hook, sqlstate}`, never the message text or an answer) and the client still gets `ok:true` (E19: an answer is kept, never lost). The guardian's `hook-failed` check (6.2) warns on any such event, and the runbook row says how to re-run the hook by response id (`cockpit_form_client_submitted` is idempotent per hook through each hook's dedupe keys). Answer validation still refuses before anything is stored.
3. Every client response row stores `answer_meta.notice_on` (the Kuwait day of the answer) and `answer_meta.invite_id` at insert (the guard forbids later changes; 2.2's carve-out is only for the notice answer).
4. Notices: the six kinds of 3.4 in the SQL functions, `text.ts` (renderer and `NOTICE_KINDS`), `notices.ts` and `NoticesRouting.tsx` (labels and blurbs, 5.12). `cockpit-notices` doctor names them.
5. `cockpit-forms-api`: a seat op `invite.approve` beside `recap.approve` (`{op, messageId, body}`): reads the message with the seat's token through `cockpit_client_message_read`, refuses a kind other than `form_invite` (`Approve recaps from the Messages card.`), runs the leads/CPL figure check the recap path uses, computes the sha and calls `cockpit_client_message_approve` with the service key and the seat's id, exactly as `recap.approve` does. `recap.approve` refuses a `form_invite` message (`Approve a form link from Send a form.`). The door routes it as a seat op (the service key never runs it).
6. `hermes/client-messages`: `KINDS_2B` becomes `KINDS = ["recap_checkin", "form_invite"]`; the switches parser accepts both and refuses anything else as today; for a claimed `form_invite` row, after `cockpit_client_message_intent` answers ok and before the one POST, the worker calls `cockpit_client_message_invite_link(id, claim)`; `{ok:false, reason:'already_made'}` records `unknown` with `The link for this message was already made, so it may already be in the group. Look in the group; the tech lead settles it.` and sends nothing; `{ok:true,url}` replaces `{form_link}` in the claimed body and sends that text. The `sha256(row.body) !== row.bodySha256` check stays on the stored body (the template). Group searches (read-back and `unknown` reconcile) pass each group message through `maskInviteLink(text)` (core.ts: replaces `https://portal.maharamedia.com/f#f1[A-Za-z0-9_-]{43}` with `{form_link}`) before `normalise`/`sha256`. The URL never goes into a report, a health row or a log line (the report keeps `bodySha256` only). RUNBOOK gains the form-link section (5.12 words).

### 4.2 The portal channel (portal-forms)

Files: listed in section 7 (portal-forms). Read `node_modules/next/dist/docs/` for route handlers, pages and metadata before writing.

1. **`src/lib/client-form-schema.ts`** (no `server-only`, imported by browser and server): the v1 types of 3.1, `validateAnswers(schema, answers, context)` mirroring `cockpit_form_answers_check` code for code, `isVisible(field, answers)`, `t(text, lang)`, and `errorSentence(code, field, lang)` with the 5.13 sentences. It never decides alone: the database checks again.
2. **`src/lib/client-forms.ts`** (`server-only`): `formRpc(name, body)` on the asks pattern (`MAHARA_OUTCOME_STORAGE_KEY || MAHARA_BUSINESS_STORAGE_KEY`, 15 s timeout, `redirect:'error'`, `cache:'no-store'`, `form_invite_not_in_workspace` → `FormForbidden`); typed wrappers for every `portal_form_*` RPC of 3.3; `formsConfigured()`. Every value coming back is validated (ids are UUIDs, schemas pass a zod v1 schema, texts are bounded); an incomplete answer throws `FormStoreError` (503 to the browser, never a guess).
3. **`src/lib/form-token.ts`** (`server-only`): `hashToken(token)` (sha256 hex; refuses anything not matching `^f1[A-Za-z0-9_-]{43}$` before hashing), `netHash(req)` (HMAC of `form-net:`+IP with `SESSION_SECRET`, read by `form-token.ts` itself with `auth.ts`'s production rule; `auth.ts` is not touched, section 7), `browserHash(req)` and the `mahara_form_b` cookie (3.6).
4. **`/api/forms` (`src/app/api/forms/route.ts`)**, through `apiRoute`:
   - `GET ?clientId=` — signed-in client: `portal_form_list` for the person (role from `identity().accessRole`); staff with `&formPreview=<key>[&draft=1]`: `portal_form_preview` with `preview:true`; share links: `{forms:[]}`. Same cross-site refusal as `/api/asks`. Works while the workspace is locked (no `onboardingAccess`).
   - `GET ?clientId=&invite=<uuid>` — `portal_form_get`; a refusal reason becomes `{reason}` with 200 so the page can say it (5.13).
   - `POST {clientId, inviteId, requestId, answers, lang}` — same origin, client role, own workspace; body limit 32 KB; `portal_form_submit`. Staff get `{ok:true, preview:true}` and nothing is recorded.
5. **The token path.** `src/app/f/page.tsx` (exports `metadata` with `robots: {index:false, follow:false}`) renders `TokenForm` (client component): reads and clears the fragment (3.6), posts `{action:'open', token}` to `/api/forms/token`, shows the form in the renderer with the typed-name field when `signer:'typed'`, posts `{action:'submit', token, requestId, answers, signer, lang}`. The token stays in component memory only (never `localStorage` or `sessionStorage`, and neither is its hash); a reload therefore asks for the link again (5.10 wording), and reopening the link restores the answers from a 1-hour `sessionStorage` draft keyed `mahara-form-draft:<invite id>` (answers and typed name only; try/catch; cleared on success). The page uses `PortalInvite.lang` as its starting language. `src/app/api/forms/token/route.ts`: same-origin, never `identity()`, body ≤ 32 KB, hashes the token, sets the browser cookie, calls `portal_form_token_open`/`_submit`. `next.config.ts` adds the headers of 3.6 for `/f` and `/api/forms/token`. A test proves `[[...path]]` does not serve `/f` (the route resolves to `src/app/f/page.tsx`) and that no response or log line from either route contains the token or its hash.
6. **The pop-up (the `form_invite` ask kind, V20).** `/api/asks` GET asks `portal_form_for_person` first; an invite comes back as `{ask:{kind:'form_invite', id, formKey, title, minutes, note, from, askedAt, stage:'ask'}}`; reason `shown_today` returns `{ask:null, reason:'shown_today'}` without asking for a review or referral; otherwise the route falls through to today's ask path unchanged. Staff `?askPreview=form_invite&form=<key>` previews it. `client-asks.ts` `validAskView` accepts the `form_invite` variant (no link: its button opens `/forms?clientId=…&invite=<id>` inside the portal). `ClientAsk.tsx` renders it with the same calm rules (once a visit, 2.5 s after the page settles, never over another dialog or a field in use, corner card on a computer, bottom sheet at 760 px or narrower), with "Open the form" and "Not now" (5.13); events go through `POST /api/asks` with `kind:'form_invite'`, which calls `portal_form_invite_record`. The answer itself never happens in the pop-up: it opens the forms page.
7. **"Forms waiting for you" and the `forms` page.** `FormsForYou.tsx` (a card on home and getting started when the list is non-empty) and `FormsPage.tsx` (`page==='forms'`: the list, then one invite at a time in `FormRenderer`). `Portal.tsx` and `workspace-navigation.ts` allow `forms` while the workspace is locked (beside `getting-started` and `feedback`), never on share links. The sidebar shows "Forms" with a count badge only while one is open.
8. **`FormRenderer.tsx` + `FormRenderer.module.css`**: one component for the page, the token page and both previews. Props `{schema, context, lang, signer, preview, onSubmit, onLang}`; `dir` from `lang`; Arabic by default (`lang` from the person's portal setting, else `ar`); an "English / عربي" toggle at the top; fields in schema order with `showIf`; the scale as a row of keys (5.10); validation sentences under each field from `client-form-schema.ts`; one request id per open form (`crypto.randomUUID()`), reused on retry; the submit stays enabled and says what is missing instead of greying out (the portal's 10-29 lesson); a 1-hour draft in `sessionStorage` keyed by invite id (try/catch, never required, cleared on success; on the token page too, holding answers only, never the token or its hash; a test scans storage for both). Starting language: the person's portal setting, else the invite's `lang`, else `ar`.
9. **Phone alerts** (`src/lib/form-notifications.ts`): the asks' pattern for invites (`portal_form_invites_push_claim`, the journal's `formDeliveries`, `portal_form_invite_push_done`, display check through `/api/notifications/display` with topic `tasks` and a form delivery id). Text from the schema's `invite.push[lang]`. Runs second in `/api/cron/client-tasks`, after asks, never throws; log line `{"event":"form_invite_push","ok":…,"claimed":…,"sent":…,"noDevice":…,"failed":…,"unfinished":…}`.
10. **Presence push** (`src/lib/form-presence.ts`): in the same cron, every run, reads the portal's own state once (`readState()`), counts per client workspace the unrevoked, unexpired client sessions active in the last 14 days (by `authenticatedAt`, `verifiedAt` or `created`, whichever is newest), split admin/member by the access grant, and calls `portal_form_presence_put` with counts only (≤ 200 rows a run). `{ok:false,reason:'off'}` is normal before D-PR and logs `{"event":"form_presence","ok":true,"off":true}`; anything else logs `ok:false` with a reason code.
11. **Staff preview**: `/?clientId=<workspace>&formPreview=<key>[&draft=1]` opens the forms page with the preview banner and the sample context; submit answers `Preview: nothing was sent.` The development preview `src/app/preview/client-form/page.tsx` (`?form=&lang=&theme=dark&state=open|done|expired|answered|limited`) uses fixed fixtures and answers 404 in production like the other `/preview/*` pages.
12. **Storage bucket**: none in waves 3 and 4 (V10). The renderer refuses a schema with a `file` field (`This form needs a newer Mahara OS.`) so a wave-5 schema published early cannot render half.
13. `docs/CLIENT-FORMS.md` (new): routes, RPCs, the token rules, the pop-up rules, previews, the log lines; linked from `docs/CLIENT-ASKS.md` (owned here too).

### 4.3 Pause consent and C2, client side (client-lifecycle for SQL; cockpit-screens for the sheet)

1. Registry row `pause_consent` with the schema of 5.5 (`audience:'admin'`, `signer:'typed'`: the token path asks the name, the portal path records the session admin).
2. `cockpit_form_issue_hook_pause_consent(invite)`: refuses (raises, so the issue rolls back) when the card is already Paused (`This client is already paused. Resume them first.`), or the context fails 3.2's rule (`The pause starts today or within 14 days.` / `Pick the restart day, after the start.`); sets `context.over14 = (restart - start) > 14`.
3. `cockpit_form_hook_pause_consent(response)`: queues `pause.consent` (variant `dates_wrong` when `answers.datesWrong`), dedupe `consent:`||id. Nothing on the card (D11).
4. `cockpit_pause_consent_for(task)` → `{state:'none'|'sent'|'signed'|'dates_wrong'|'expired', inviteId, sentAt, responseId, signedAt, via ('portal'|'link'), signer ('the client admin' or the typed name), start, restart, datesNote}` from the card's latest `pause_consent` invite and its answer; `signed` only when answered within 14 days, `datesWrong` not true, and no `pause` billing event after it.
5. `cockpit_billing_write('edit',{kind:'pause', pauseKind:'client_request', ...})`: when `cockpit_form_client_live('pause_consent')`, it needs `consentResponseId` equal to the signed consent's response (`Send the pause consent from this sheet, then confirm once the client signs.` / `The client has not signed the pause consent in the last 14 days. Send it again.` / `The client says these dates are wrong. Change the restart and send a new consent.` / `The client signed a restart of {date}. Use that date or send a new consent.`) and writes `consent {kind:'signed', response_id, signed_at, via, call_id}`. When not live, W12's two-tick path runs unchanged. Non-payment pauses never need a consent. Everything else in the function is byte for byte.
6. The pause sheet (cockpit-screens, `formDefs.ts` `pause` and `lifecycleClient.ts`): reads `prefill.consent`; for a client request with the form live, the two tick fields are replaced by a read-only consent row and a "Send the pause consent" action that calls `cockpit_form_invite_issue` with origin `pause` and the sheet's restart, reason and call (5.2); Confirm stays disabled until `consent.state='signed'`, and sends `consentResponseId`.
7. `cockpit_form_notices_in()` gains `kind:'pause_consent'` rows (signed or dates wrong, not yet followed by a pause event) for the Today band.
8. **C2 client side** (deploy, D-C2C): go-live `pause_consent`; close Typeform `CTUjv6l3` (`is_public:false`), remove `WHTP4371898` (Make 9805613's hook; the scenario has been off since D-C2), keep the cockpit webhook (a stray answer is stored as legacy and posts `legacy.received`); repoint `csmLinks.ts` (both apps) and `csm_assistant.py` (4.11).

### 4.4 The exit survey and C4b (client-lifecycle for SQL; cockpit-screens for the screens)

1. `exit_survey` version 2 (5.6), `audience:'admin'`, `signer:'typed'` (the token path asks the name). Issue needs a departure or a Stopped card (`cockpit_form_card_allows`, 2.3). Its default channel is the link whenever the workspace is closed, missing, or without a live session in 14 days (3.3 rule).
2. `cockpit_form_issue_hook_exit_survey(invite)`: when the card has an open departure (W12 W21: not removed, not confirmed or confirmed, no later resume) with `survey_state='not_sent'`, sets it `sent` (under the departures' own guard rules: the builder reads the triggers on `cockpit_churn_departures` and uses its transaction-local setting if one is needed) and stores `context.departureId`.
3. `cockpit_form_hook_exit_survey(response)`: queues `termination.notice` (dedupe `termination:`||id) and `termination.submitted` (dedupe `termination-sub:`||id; it posts only once its setting is enabled at D-C4B); inserts billing event `survey` (source `system`, `by_whom 'the cockpit'`, detail 3.8) so the comment lands on the card through the rails; sets the departure's `survey_response_id` and `survey_state='filled'` when one is open. No card field changes.
4. `cockpit_form_notices_in()` lists native exit surveys (state `submitted`, card verified by the invite) under the same rule as legacy ones; `cockpit_form_notice_answer` ("Not leaving") works on them through the guard carve-out (2.2).
5. `cockpit_csm_churn_read()` adds `surveyInvite {inviteId, state, channels, issuedAt, answeredAt}` to each departure; `cockpit_form_prefill('churn_confirm', task)` offers the native survey (verified card, so no "This survey is from this client" step) and its invite state.
6. **C4b** (deploy, D-C4B, one hour): save Make 9805538's blueprint; go-live `exit_survey` (provider moves to native, V16); enable `termination.submitted`; open billing kind `survey` (canary first, 9); switch off Make 9805538 and read back `isActive=false`; remove `WHTP4371873`; close `knIe4eF3`; keep the cockpit webhook (legacy capture, `legacy.received`). Links repointed (4.11). The "Client Exit Process" doc is the CEO's to edit (section 10).

### 4.5 NPS, CSAT and their triggers (client-voice for SQL; cockpit-screens for the screens)

1. Registry rows `nps` and `csat` (seeded in `a` with 5.7 and 5.8's schemas; `audience:'any'`, `signer:'none'`: no name on either path; by link anyone in the client group may answer once).
2. `cockpit_form_issue_hook_nps(invite)`: sets `context.round` (the card's highest NPS round + 1) and inserts billing event `nps_sent` (source `system`, detail `{invite_id, on, round}`), which writes NPS Survey Sent once the kind is open (canary first). `cockpit_form_issue_hook_csat(invite)`: sets `context.try` (previous CSAT invites for the card + 1).
3. `cockpit_form_hook_nps(response)` / `_csat`: queue `nps.received` / `csat.received`; when the score (`recommend` / `onboarding`) is at or under `voice.low_score.max` (6), queue `voice.low` (dedupe `low:`||id). The low-score row on Today comes from `cockpit_client_voice_today()` and carries the ticket button (W5 pattern, V11).
4. **The schedule** `cockpit_form_schedule_run(p_now, p_apply)` (cron 07:00 UTC):
   1. Sweep: `cockpit_form_invites_expire()`; `cockpit_form_invites_withdraw_ineligible()` (open NPS/CSAT/consent invites of cards no longer Active or now leaving); `refused` `form_invite` messages of closed invites → `skipped`; delete token opens older than 2 days.
   2. Off (`forms.schedule.on` false): write `form-schedule` `{ran:false, why:'The schedule is off.'}` and stop.
   3. Candidates: cards for which `cockpit_form_card_allows(task, form)` is NULL (mirror `Active`, no open departure; every other status and a leaving card skipped), first launch = `min(launch_date)` over `cockpit_client_billing_days` for the card (cards with none skipped, said as "no launch date on the card").
   4. NPS (row on and `nps` live): due when `first_launch + firstDay ≤ today` and no open NPS invite and (no NPS invite ever, or the newest NPS invite of any origin was issued `everyDays` or more ago). A manual send is an invite, so it resets the clock (V21).
   5. CSAT (row on and `csat` live): due when `first_launch + afterLaunchDays ≤ today`, `today − first_launch ≤ maxAgeDays` (60, V24), no CSAT answer ever, no open CSAT invite, fewer than `1 + reissues` CSAT invites so far, **no CSAT invite of the card ever withdrawn by a seat** (event `withdrawn` with `{by:'seat'}` and a reason other than `Sent again`: a CSM's withdraw is final for the schedule, V26), and the last CSAT invite closed `retryAfterDays` (7) or more ago.
   6. Channels: `portal` when the workspace is open and presence shows a live session in 14 days (any person: NPS and CSAT are audience `any`); otherwise `portal` + `whatsapp` (no workspace: `whatsapp` only). **CSAT's first try** for a card with a live session is issued from `afterLaunchDays` with `portal` only; for a card **without** a live session in 14 days (or with no workspace, or presence not reported yet) the first try **waits** until `first_launch + whatsappAfterDays` (3) and is issued with `portal` + `whatsapp` (`whatsapp` only with no workspace), so the plan's "WhatsApp link once, 3 days after launch" holds (5.14). Later tries are portal only (a card with no workspace gets no later tries: `skipped.noPortal`). Every `whatsapp` channel makes a draft message the CSM approves (V7); the schedule never approves.
   7. At most `maxPerRun` (3) new invites per form per run, oldest launch first, and **at most one client form per card per run** (CSAT before NPS; the other waits for the next day: `skipped.oneFormToday`); issued through `cockpit_form_invite_issue_system`. Idempotent per day (an invite issued today for the card and form is a skip).
   8. Writes `cockpit_sync_state` `form-schedule` `{ran:true, issued:{nps, csat}, skipped:{notActive, leaving, noLaunch, open, notLive, filled, tooOld, cap, withdrawnBySeat, tooSoon, waitingForWhatsAppDay, noPortal, oneFormToday, ruleNotSet}, withdrawn:{ineligible}, at}` and a plain note.
5. **The CSM's Send** (5.1): any client form from the client page, any time, through `cockpit_form_invite_issue` (pause consent only from the pause sheet; CSAT refused once filled; NPS and CSAT only to an Active card that is not leaving; the exit survey only with a departure or a Stopped card). WhatsApp goes through the approval and the worker (4.1), never a test send to a real client.
6. **C5** (deploy, D-C5, only once `cockpit_slack_channels` `nps-survey-feedback` reads `ok` and the notices doctor passes, Q4): go-live `nps` and `csat`; open billing kind `nps_sent` (canary first); turn the schedule on; remove `WHTP4007419` and `WHTP4007430`; switch off Make `8962328` and `8962387` and read each back; read Make `8068892` first (the audit says active, not re-checked) and switch it off only if it is the NPS Slack scenario; close `fuPgs85S` and `KbcbPA73`; import their 2 old answers with `forms_legacy_backfill.py nps` and `csat` as legacy with no card (V17).

### 4.6 The feedback bridge and the CEO NPS metric (portal-bridges; client-voice)

1. Portal (`src/lib/feedback-bridge.ts`, called from `src/app/api/feedback/route.ts` after `submitFeedback` returns): `portal_feedback_record(location, clickupId, email, {feedbackId, kind, topic, message (≤ 2400), rating (1..5|null), contactOk, createdAt})`, 5 s timeout, best effort. The client's save never waits on it and never fails because of it; its outcome logs `{"event":"feedback_bridge","ok":…,"reason":…}` (no ids, no text).
2. Cockpit `portal_feedback_record`: refused `{recorded:false, reason:'not_live'}` until `portal_feedback` is live; checks the workspace pair; inserts a response (`portal_feedback`, source `portal`, external id `feedback:`||feedbackId, so a retry stores once); queues `feedback.received`. The rating never enters NPS (3.5).
3. `cockpit_client_voice_v` and `cockpit_form_invites_daily_v` (`day, form_key, issued, answered`, counts only) are granted to `supabase_read_only_user` with every helper they call.
4. CEO refresh (`hermes/ceo-refresh/native/voice.js` new, `adapters/clients.js`, `metrics.ts`): `readVoice()` reads both views; the clients payload gains `voice {nps:{score,n,promoters,passives,detractors}, csat:{average,n}, invites:{…}, asOf}` per window; metrics `clients.nps` (score, NULL when n is 0), `clients.nps.responses` (n), `clients.csat` (average) with source sentences (6.4); `metricRegistry.ts` and `SOURCES.md` rows; the CEO Client Success tab (`ClientSuccessTab.tsx`) gets a "Client voice" `StatTile` row (NPS, answers, CSAT) with the note. A missing read is said ("Client voice could not be read"), never 0.
5. `hermes/csm-calls/sources.ts`: `nps`, `csat` and `portal_feedback` join the timeline's form kinds.

### 4.7 Onboarding C6 and the portal gate evidence (client-voice; portal-bridges)

1. Registry row `onboarding` (typeform `KFRCXPFx`), effects all `owner:'make'`: `card_fields` (clickup_queue), `client_data_row` (sql, labelled "Client Data sheet row (Make)"), `phase3_whatsapp` (client_message), `brand_dna_task` (clickup_queue), `github_dispatch` (sql, "GitHub dispatch (Make)"). Nothing in the cockpit performs them.
2. `forms-door`: `FORM_KEYS` gains `onboarding` and `new_client`; both store through `cockpit_form_record_make` after the signature (W12's order of checks unchanged). `onboarding` answers are shaped by the same mapping the onboarding sync uses: forms-door builds a `FormData` from the webhook's `form_response` and `definition` (one response, no Typeform API call, no token) and calls `formsFor(taskId, data)` from `apps/client-success-cockpit/src/lib/onboardingCore.ts` (imported, not copied; it imports nothing). It never imports `cockpit-csm-api/onboarding.ts` (`readFormData` pages the Typeform API and pulls in `tools.ts` and `zod`). D-C2 deploys with `--extra apps/client-success-cockpit/src/lib/onboardingCore.ts`, proven by a `--dry` bundle in D0; if `forms-door` needs `zod` later, `forms-door/deno.json` maps it as `cockpit-csm-api/deno.json` does. The card is the hidden `onboarding_client_id` when it names a mirrored card (kept as `hidden_id_unverified`, W12 rule).
3. `cockpit_form_record_make(p)`: `{formKey:'onboarding'|'new_client', externalId, submittedAt, answers, hidden, taskId|null, backfill}` → response state `submitted`, source `typeform_webhook` (or `typeform_sync` for the backfill), `ON CONFLICT (form_key, external_id) DO NOTHING`, no notice (V23). For `onboarding` with a card: writes `cockpit_client_onboarding.forms.onboarding = {form_id:'KFRCXPFx', answers, response_id, submitted_at}` only when that key is empty or holds an older `submitted_at` (never overwrites a newer answer; the 10-minute poll keeps writing the same shape). No onboarding-sync change (V14).
4. `portal_form_status(location, clickupId, 'onboarding')` → the card's newest stored onboarding answer (3.3).
5. Portal (`src/lib/onboarding-cockpit-evidence.ts`, `onboarding-state.ts`): inside `refreshOnboarding`'s existing claimed check (never more often than it already reads ClickUp), when the record has no `form` yet, ask `portal_form_status`; `submitted:true` becomes `{form:{at:submittedAt, source:'Cockpit stored onboarding form', reference}}` through `recordCompletion` (the same trust as `responseEvidence`, which accepts a Typeform answer by its hidden id today). Failures keep the current state and say nothing new to the client. `onboarding-policy.ts` gains `cockpitEvidence(status)` (pure) beside `responseEvidence`. The portal's own receiver `/api/onboarding/typeform` stays unregistered (one receiver only).
6. For 14 days after D-C6 the guardian compares receipts with the poll (6.2).

### 4.8 New Client Form registry row (client-voice)

Registry row `new_client` (typeform `BTzMwXiw`, audience `team`, seats `{sales}`), effects all
`owner:'make'`: `onboarding_main` (Make 8979157: sub-account, Mahara OS, WhatsApp welcome, ClickUp
card, CSM Slack, CS pipeline), `highlevel_workflow`, `cortana`, `b2b_closed_deals` (B2B
`typeform-sync`). The cockpit webhook records only (`cockpit_form_record_make`, no read model, no
notice). Backfill reads Typeform's stored responses (read only) with `forms_legacy_backfill.py
new_client`; the 3 `cockpit_sales_client_forms` rows are then matched by their `response_id`
(read-back: 3 of 3 found). **Never imitate a submission**: tests use recorded payloads only; no test,
canary or deploy step submits `BTzMwXiw`. `WHTP4096881` (to the inactive Make 9169732) is disabled
in the same step (V15), every other webhook read before and after.

### 4.9 The forms editor, ED (forms-editor)

1. Who: an admin seat or the CEO (`cockpit_form_seat`). Everyone else gets `Only an admin or the CEO edits forms.`
2. What can be edited: every client form (`audience='client'`, provider native or about to be: `exit_survey` v2 before C4b; while its provider is still `typeform`, publish adds a version row and leaves the registry `schema`/`version` alone, and go-live takes the newest `v:1` version): title, intro, minutes, each field's label, hint, required, options (add, relabel, remove; stored answers keep the value they were given), scale ends, show-if, order, new fields; `invite.whatsapp` and `invite.push` texts; and routing: the notice channel and mentions (the live notices editor, linked), the schedule rows (NPS first day 30..180, repeat 30..365; CSAT WhatsApp after 0..14 days, snooze 1..14, re-tries 0..5, retry after 1..30 days, max age 14..120; every key always present, so a save never leaves a rule key missing), `voice.low_score.max` (0..8). Keys of published fields never change.
3. The field guard: `cockpit_form_publish` refuses removing (or hiding behind a new `showIf`) a field listed in `reads` for an effect: `{field label} is read by {effect label}. Remove that effect first.` For a field named in `reads` it also freezes `type`, `min`, `max`, `required` and the option **values** (labels stay editable): `{field label} is read by {effect label}, so its type, range and choices stay as they are.` The schema's `audience` and `signer` never change once published (`Who answers this form is set in the cockpit's code.`). The hooks read only the keys in `reads` (tests prove it).
4. `cockpit_form_publish(key, note, base)`: draft → `cockpit_form_schema_check` → `cockpit_client_text_ok` on every text → new `cockpit_form_versions` row (`published_by` the seat's email, `note`) → registry `schema` and `version` → draft removed → audit. Open invites keep the version they were issued with (answers stay valid against it).
5. `cockpit_form_restore(key, version, note)`: publishes that version's schema as a new version (`Restored version {n}`), same checks.
6. Staff forms (`extension`, `pause`, `resume`, `churn_confirm`, `mrr`), `checkin`, `kickoff`, `blueprint`, `onboarding`, `new_client`: listed read only with `Set in the cockpit's code; the SQL checks these fields word for word.` or `Lives in Typeform; Make owns its effects until Stage 4.` (V13).
7. Preview: the screen draws the structure (both languages side by side, Arabic right to left) and offers `Open the real preview`, which opens the portal staff preview `?formPreview=<key>&draft=1` on a workspace the seat picks from `portal_data.workspaces` (default: the first Active one alphabetically; nothing is recorded there).

### 4.10 What the client page and Today read (cockpit-screens)

`cockpit_form_invite_view`, `cockpit_form_invites_today`, `cockpit_form_answer_read` (`a`);
`cockpit_form_notices_in` (consent and native exit rows), `cockpit_form_prefill`,
`cockpit_csm_churn_read` (`b`); `cockpit_client_voice_read`, `cockpit_client_voice_today` (`c`);
`cockpit_form_doors` (`a`). Every door hides itself while its flag is false.

### 4.11 Links repointed (cockpit-screens)

`apps/client-success-cockpit/src/lib/csmLinks.ts` (`:144` CSAT, `:149` NPS, `:222` pause, `:234`
termination, read 2026-11-01) and `apps/media-buyer-cockpit/src/lib/csmLinks.ts` (`:97`, `:102`,
`:175`, `:187`): each becomes `{label: "{form} (in the cockpit)", note: "Open the client, then Send a
form. It goes to their portal, or by WhatsApp link."}` pointing to the client page route; the pause
row's note reads `Open the client, then Pause this client. The client signs the consent in their
portal or by link.`; the termination row `Open the client, then Client is leaving or Send a form.`
`viktor-side-scripts/csm/csm_assistant.py:39,41` (39 pause, 41 cancellation; line 42 is the referral form and stays): the pause and cancellation Typeform links are
replaced by the same sentences (the VPS copy changes at its next release). Each row changes in the
same ship as its form's go-live is planned; until a form is live the row says so: `Opens with the
portal forms (after the switch-on).`, keeping the Typeform link visible below it as `Old form, still
live:`.

---

## 5. The screens: design plans and copy

### 5.0 The two design plans (written before any code; Hallmark component scope)

**Cockpit (Send a form, Forms out, Client voice, Today bands, pause consent row, churn tracker, ED).**
Subject: a client success manager sending a client a short form and watching it come back. Audience:
the CSM, the CEO and admins at a desk or on the phone app. Job: send the right form by the right
door and see where it stands. Tokens are the cockpit's own (no second palette): `--mahara-teal`
`#00cfc8` for the one primary action and done states, `--deep-space` for ink on teal, the app's
`--muted`, `--border`, `--card`, amber (`--warning`) for waiting, the app's destructive red only for
Withdraw. Type: Geist for text, Geist Mono for dates, scores and the delivery line's step names;
client names in `<bdi>`; Arabic previews in IBM Plex Sans Arabic (through `--font-sans`) with
`dir="rtl"`. Layout: the CEO kit (`SectionCard`, `StatTile`, `StatusChip`, `EmptyState`,
`format.ts`); the Send panel is a right sheet on desktop (`min(560px, 100vw)`), a bottom sheet under
`md`. **Signature element: the delivery line.** Each invite is one row with a horizontal track of
four small rings in Geist Mono: `Sent → Seen → Opened → Answered` (a WhatsApp invite starts with
`Approve`), each ring teal when done with its time beneath, amber when waiting, a hollow grey ring
when not yet; withdrawn or expired cut the line with a short muted dash and the word. Everything else
stays quiet. No italic headings, no invented numbers, motion only the ring filling (150 ms, off under
reduced motion).

**Portal (pop-up card, Forms waiting for you, forms page, token page, renderer).**
Subject: a business owner in the Gulf, often on a phone, answering a short form from their Mahara
team. Audience: the client's admin and members; by link, anyone in their WhatsApp group. Job: answer
in a minute and know it arrived. Tokens are the portal's `globals.css` (no second palette): `--bg`
`#f6f8f7`, `--surface` `#fff`, `--ink` `#172d2d`, `--muted` `#5f736e`, `--line` `#e3eae7`, `--teal`
`#08766f` (primary and selected), `--teal-soft` `#e9f6f2`, `--amber`/`--amber-soft` for waiting,
`--red`/`--red-soft` for errors; dark mode through `[data-theme=dark]`; `--radius` 14px. Type: IBM
Plex Sans Arabic for both languages (the portal's face), weights 400/600, numbers in Arabic-Indic
digits in Arabic. Layout: one column, `max-width: 560px`, 16px gutters, the submit pinned at the
bottom above `--safe-bottom` on phones; the pop-up reuses `ClientAsk.module.css`'s card and sheet.
**Signature element: the scale keys.** A 0–10 (or 1–10) question is a row of eleven tactile keys,
48px tall, numbers centred, the two end labels under their ends; on a phone under 420px it folds to
two rows (0–5, 6–10) without changing order; the chosen key fills `--teal` with white digits and the
rest stay `--surface` with a `--line` border. In Arabic the row follows the reading direction (0 on
the right), digits Arabic-Indic. Everything else is plain: labels above fields, hints in `--muted`,
one error sentence under its field in `--red`. No re-drawn chrome, no italics, no fake numbers.

Slop test before shipping (Hallmark): screenshots at 320, 375, 414, 768 and 1280 px of every screen
below, light and dark, Arabic and English for the portal, scored on the six axes (anything under 3 is
revised) and run through the component gates (visual, contrast, accessibility, typography); every
interactive element shows its eight states in the slice's preview page; results in the slice report.

### 5.1 Send a form (cockpit, client page action, `ClientForms.tsx`)

```
┌ Send a form ──────────────────────────────── ✕ ┐
│ Castello Industries                Active      │
│ Opened the portal 2 days ago · 3 people        │
│ ( NPS survey ) ( Onboarding survey ) ( Exit survey ) │
│ Goes by  [Portal ✓] [WhatsApp link]            │
│ ☐ Phone alert to people who turned alerts on   │
│ A line for the client (optional) [__________]  │
│ WhatsApp text (Arabic ▾)  [editable preview]   │
│ [ Send the NPS survey ]                        │
└────────────────────────────────────────────────┘
```

| Element | Copy |
|---|---|
| Action on the client page | `Send a form` |
| Presence line | `Opened the portal {n} days ago · {k} people` / `Has not opened the portal in 14 days, so the WhatsApp link goes too.` / `No admin has opened the portal in 14 days, so the WhatsApp link goes too.` (an admin-only form with members only) / `No Mahara OS workspace: the WhatsApp link goes.` / `Workspace closed: send the link by WhatsApp.` / `We can't see portal visits yet, so it goes to the portal and by WhatsApp.` (before D-PR) |
| Form chips | `NPS survey`, `Onboarding survey`, `Exit survey`; disabled with the `why` of 3.3 (`Opens to clients after its switch-on.`, `They already filled it on {date}.`, `Sent from Pause this client.`, `Mark Client is leaving first, then send the exit survey.`, `{client} is not an active client, so this form does not go to them.`, `{client} is leaving. Send the exit survey instead.`) |
| Channel chips | `Portal`, `WhatsApp link`; `Phone alert to people who turned alerts on` |
| Note | label `A line for the client (optional)`, hint `Shown under the form's title. No numbers about leads or cost.` |
| WhatsApp text | label `WhatsApp text`, language picker `Arabic` / `English`, hint `The link is added when it sends.` |
| Submit | `Send the {form}` → toast `Sent` when `delivered = 'portal'`; `Saved. Approve the WhatsApp message to send it.` when the portal is not a channel |
| After send with WhatsApp | `The WhatsApp message waits for your approval.` + `Approve and send` → `Approved. It sends within about 3 minutes.` |
| Refusals | the SQL sentences of 3.3, word for word |
| Network error | `Not sent. Check your connection and press Send the {form} again.` |

### 5.2 Forms out and the pause consent row (cockpit)

Forms out (`SectionCard` titled `Forms out`, on the client page): one row per invite with the
delivery line; actions `Withdraw` (reason prompt `Why are you withdrawing it?` → `Withdrawn`), `Send
again` (withdraws with reason `Sent again`, then issues), `Copy a link` (modal: `This link works once
and ends on {date}. It is shown only now.` + `Copy link` → `Copied`), `See what they see` (portal
staff preview), `Read the answer` (opens `cockpit_form_answer_read`). Empty: `No forms out. Send one
with Send a form.` States in words: `Waiting for approval`, `Sent {date}`, `Seen {date}`, `Opened
{date}`, `Answered {date}`, `Expired {date}`, `Withdrawn: {reason}`.

Pause sheet, client request, form live: the consent row replaces the two ticks:
`Client consent` + state line `Not sent yet.` / `Waiting for the client's signed consent. Sent
{date}.` / `Signed by the client admin in the portal on {date}. Confirm the pause.` or `Signed by
link by {typed name} on {date}. Check the name, then confirm the pause.` / `The client says the dates
are wrong: "{their note}". Change the restart and send a new consent.`; action `Send the pause
consent` → `Sent`; Confirm label `Confirm pause` stays disabled with the hint `Confirm opens once the
client signs.`

### 5.3 Today bands (cockpit, CsmPage)

Compact `SectionCard` bands under Today, hidden when empty: `NPS sent: {client}` (no button);
`Not answered: {form} to {client}, sent {n} days ago` → `Send again`; `WhatsApp link to approve:
{form} for {client}` → `Approve and send`; `Answered: {form} from {client}` → `Read the answer`;
`Low score: {client} gave {score}/10 on the {survey}` → `Open the low-score ticket` (prefilled request
form, type `client_low_score`, requester the presser, source `client_page`; hidden until D-R2) and
`Open the client`; `Pause consent signed: {client} ({in the portal by the client admin | by link by
{typed name}})` → `Confirm pause`; `Pause dates wrong: {client}` → `Open the pause`; `Send the exit
survey to {client}` (kind `exit_survey_due`) → `Send exit survey` (opens Send a form preset to the
exit survey); native termination rows reuse W12's `Notice in` band.

### 5.4 Client voice card (cockpit, client page) and the brief line

`SectionCard` `Client voice`: NPS `{score}/10 would recommend · {date}` (+ `Results so far
{n}/10`, `Communication {n}/10`, the start/stop text in `<bdi dir="auto">`), a 6-dot history in Geist
Mono; `Onboarding {score}/10 · {date}` with liked/disliked; `Portal feedback` last 5 with kind and
topic; footnote = the source sentence of 3.3. Empty: `No answers yet. Send the NPS survey from Send a
form.` The brief (`clientBrief.ts`) gains one line when an NPS or CSAT answer is under 30 days old:
`Said {score}/10 on the NPS survey on {date}.` (and `Low score: call them.` when at or under the line).

### 5.5 Pause consent form (portal and link) — `pause_consent`

| Key | Type | EN | AR |
|---|---|---|---|
| title | | Confirm your pause | أكّد الإيقاف المؤقت |
| intro | | Your account manager set up this pause after your call. Check the dates, then confirm. | مدير حسابك جهّز هالإيقاف بعد المكالمة. شيّك على التواريخ وبعدها أكّد. |
| context `start` | date | Pause starts | يبدأ الإيقاف |
| context `restart` | date | Campaign restarts | ترجع الحملة |
| `datesWrong` | tick, optional | These dates are wrong | التواريخ هذي غلط |
| `datesNote` | longtext, required, showIf datesWrong | What should they be? | شنو التواريخ الصح؟ |
| `reason` | choice, required | Why are you pausing? | ليش تبي توقف الحملة؟ |
| options | | Travel · Temporary closure · We are at capacity · Ramadan or a season · Something else | سفر · سكّرنا مؤقتاً · عندنا شغل فوق طاقتنا · رمضان أو موسم · شي ثاني |
| `details` | longtext, required | Tell us a little more | قول لنا أكثر شوي |
| `consentTerm` | tick, required, showIf datesWrong = false | I understand the 90-day term keeps running during the pause. | أدري إن مدة العقد ٩٠ يوم تظل تمشي خلال الإيقاف. |
| `consentOver14` | tick, required, showIf datesWrong = false, boldIf over14 | I understand that a pause longer than 14 days ends our agreement. | أدري إن الإيقاف إذا زاد عن ١٤ يوم ينتهي فيه الاتفاق بيننا. |
| `anythingElse` | longtext, optional | Anything else for your Mahara team? | تبي تقول شي ثاني لفريق مهارة؟ |
| submit | | Confirm the pause | أكّد الإيقاف |
| done | | Confirmed. Your account manager takes it from here. | تم التأكيد. مدير حسابك بيكمل الباقي. |
| done (dates wrong) | | Sent. Your account manager will fix the dates and send it again. | وصل. مدير حسابك بيعدّل التواريخ ويرسله لك مرة ثانية. |
| WhatsApp | | Hi {client} team, here is the pause we agreed on the call. Check the dates and confirm here: {form_link} | هلا فريق {client}، هذا الإيقاف المؤقت اللي اتفقنا عليه بالمكالمة. شيّكوا على التواريخ وأكّدوا من هني: {form_link} |
| push | | Your account manager sent the pause to confirm. Tap to open it. | مدير حسابك أرسل لك الإيقاف عشان تأكده. اضغط وافتحه. |

`reads`: `consent_gate` → `datesWrong`, `consentTerm`, `consentOver14`.

### 5.6 Exit survey (portal and link) — `exit_survey` version 2

| Key | Type | EN | AR |
|---|---|---|---|
| title | | Before you go | قبل لا تمشي |
| intro | | We are sorry to see you go. Your answers reach your account manager and our CEO, and help us do better. | يعز علينا تمشي. ردودك توصل لمدير حسابك وللمدير التنفيذي، وتساعدنا نتحسن. |
| `reasons` | multi, required | Why are you leaving? | ليش قررت توقف؟ |
| options | | The results · Changes in our company · A cheaper provider · Moving it in-house · Something else | النتائج · تغييرات بشركتنا · لقينا أحد أرخص · بنسويه داخل الشركة · شي ثاني |
| `ads` | scale 1–10, required | The ads we ran for you | الإعلانات اللي سويناها لك |
| `people` | scale 1–10, required | The people who reached you through the ads | الناس اللي تواصلوا معاك من الإعلانات |
| `comms` | scale 1–10, required | Communication with our team | التواصل مع فريقنا |
| scale ends (1–10) | | 1 = Poor · 10 = Excellent | ١ = ضعيف · ١٠ = ممتاز |
| `recommend` | scale 0–10, required | How likely are you to recommend Mahara to another business owner? | شكثر ممكن تنصح فينا صاحب شركة ثاني؟ |
| scale ends (0–10) | | 0 = Not at all · 10 = Definitely | ٠ = أبد · ١٠ = أكيد |
| `keptUs` | longtext, optional | What would have kept you with us? | شنو كان ممكن يخليك تكمل معانا؟ |
| `comments` | longtext, optional | Anything else you want us to know? | في شي ثاني تبينا نعرفه؟ |
| submit | | Send | أرسل |
| done | | Thank you. Your account manager will be in touch. | مشكور. مدير حسابك بيتواصل معاك. |
| WhatsApp | | Hi {client} team, thank you for the time we worked together. Two minutes of honest feedback would help us a lot: {form_link} | هلا فريق {client}، شكراً على الفترة اللي اشتغلنا فيها سوا. دقيقتين من رأيكم الصريح تفرق معانا وايد: {form_link} |
| push | | Your account manager sent a short survey. Tap to open it. | مدير حسابك أرسل لك استبيان قصير. اضغط وافتحه. |

`reads`: `card_comment` → `reasons`, `ads`, `people`, `comms`, `recommend`, `keptUs`, `comments`. The
recommend score here is kept out of NPS (plan 5.8).

### 5.7 NPS — `nps`

| Key | Type | EN | AR |
|---|---|---|---|
| title | | How are we doing? | شلون شغلنا معاكم؟ |
| intro | | One minute. Your account manager reads every answer. | دقيقة وحدة بس. مدير حسابك يقرا كل رد. |
| `recommend` | scale 0–10, required | How likely are you to recommend Mahara to a friend or another business owner? | شكثر ممكن تنصح فينا ربعك أو صاحب شركة ثاني؟ |
| ends | | 0 = Not at all likely · 10 = Extremely likely | ٠ = أبد · ١٠ = أكيد |
| `results` | scale 0–10, optional | How happy are you with the results so far? | شكثر راضي عن النتائج لين الحين؟ |
| ends | | 0 = Not happy · 10 = Very happy | ٠ = مو راضي · ١٠ = راضي وايد |
| `communication` | scale 1–10, optional | How is communication with your Mahara team? | شلون التواصل مع فريق مهارة؟ |
| ends | | 1 = Poor · 10 = Excellent | ١ = ضعيف · ١٠ = ممتاز |
| `startStop` | longtext, optional | What should we start or stop doing? | شنو تبينا نبدي فيه أو نوقفه؟ |
| submit | | Send | أرسل |
| done | | Thanks. Your account manager reads every answer. | مشكور. مدير حسابك يقرا كل رد. |
| WhatsApp | | Hi {client} team, a quick question from Mahara: how likely are you to recommend us? It takes a minute: {form_link} | هلا فريق {client}، عندنا سؤال سريع من مهارة: شكثر ممكن تنصحون فينا؟ ما ياخذ إلا دقيقة: {form_link} |
| push | | A one-minute question from your Mahara team. Tap to answer. | سؤال من فريق مهارة ياخذ دقيقة. اضغط وجاوب. |

`reads`: `low_score` → `recommend`; `nps_notice` → `recommend`, `results`.

### 5.8 Onboarding survey (CSAT) — `csat`

| Key | Type | EN | AR |
|---|---|---|---|
| title | | How was getting started? | شلون كانت البداية معانا؟ |
| intro | | Your campaign is live. Tell us how the first steps felt. | حملتك اشتغلت. قول لنا شلون كانت أول الخطوات. |
| `onboarding` | scale 1–10, required | How would you rate getting started with Mahara? | من ١ لين ١٠، شكثر تعطي البداية معانا؟ |
| ends | | 1 = Poor · 10 = Excellent | ١ = ضعيف · ١٠ = ممتاز |
| `liked` | longtext, optional | What did you like? | شنو عجبك؟ |
| `disliked` | longtext, optional | What could we have done better? | شنو كان ممكن نسويه أحسن؟ |
| submit | | Send | أرسل |
| done | | Thank you. This helps the next client too. | مشكور. هذا يساعدنا مع العميل الياي بعد. |
| WhatsApp | | Hi {client} team, now that your campaign is live, how was getting started with us? Tell us in a minute: {form_link} | هلا فريق {client}، الحين حملتكم اشتغلت. شلون كانت البداية معانا؟ قولوا لنا بدقيقة: {form_link} |
| push | | How was getting started? Tell your Mahara team in a minute. | شلون كانت البداية؟ قول لفريق مهارة بدقيقة. |

`reads`: `low_score` → `onboarding`; `csat_notice` → `onboarding`.

### 5.9 `portal_feedback`

No invite and no renderer (the portal's own "Share feedback" stays as it is); the registry row
records the bridged fields `kind`, `topic`, `message`, `rating`, `contactOk` so ED lists it read only
(`The portal's Share feedback writes these; edit it in the portal.`).

### 5.10 Shared portal copy (pop-up, card, page, token page, errors)

| Where | EN | AR |
|---|---|---|
| Pop-up title | Your Mahara team needs a minute of your time | فريق مهارة يبي منك دقيقة |
| Pop-up body, minutes 1 | {form title}. It takes about 1 minute. | {form title}. ياخذ دقيقة وحدة بس. |
| Pop-up body, minutes 2 | {form title}. It takes about 2 minutes. | {form title}. ياخذ تقريباً دقيقتين. |
| Pop-up body, minutes 3–10 | {form title}. It takes about {n} minutes. | {form title}. ياخذ تقريباً {n} دقايق. |
| Pop-up from line | From {first name} at Mahara | من {first name} بمهارة |
| Pop-up from line, schedule (`from` null) | From your Mahara team | من فريق مهارة |
| Pop-up buttons | Open the form · Not now | افتح الفورم · مو الحين |
| Home card title | Forms waiting for you | فورمات تنطرك |
| Card row | {title} · sent {date} | {title} · انرسل {date} |
| Card button | Open | افتح |
| Sidebar | Forms | الفورمات |
| Page empty | Nothing waiting. When your Mahara team sends a form, it shows here. | ماكو شي ينطرك. لما يرسل لك فريق مهارة فورم بيطلع هني. |
| Answered row | Sent {date}. Thank you. | انرسل {date}. مشكور. |
| Language toggle | English · عربي | English · عربي |
| Required mark | required | مطلوب |
| Optional mark | optional | اختياري |
| Typed name (link) | Your full name | اسمك الكامل |
| Submit while missing | Answer the questions marked required to send. | جاوب على الأسئلة المطلوبة عشان ترسل. |
| Error `required` | Answer this one to send. | جاوب على هذا عشان ترسل. |
| Error `range` | Pick a number from {min} to {max}. | اختار رقم من {min} لين {max}. |
| Error `option` | Pick one of the choices. | اختار وحدة من الخيارات. |
| Error `length` | Keep it under {max} characters. | خلّه أقل من {max} حرف. |
| Sending | Sending… | قاعد ينرسل… |
| Network error | Not sent. Check your connection and press Send again. Nothing is sent twice. | ما انرسل. شيّك على النت واضغط أرسل مرة ثانية. ما راح ينرسل مرتين. |
| Expired | This link has ended. Message your account manager for a new one. | هالرابط انتهى. كلّم مدير حسابك يرسل لك رابط يديد. |
| Answered | This form was already sent. Thank you. | هالفورم انرسل من قبل. مشكور. |
| Withdrawn | Your Mahara team no longer needs this form. Message your account manager if you have a question. | فريق مهارة ما عاد يحتاج هالفورم. إذا عندك سؤال كلّم مدير حسابك. |
| Not live / unknown | This link does not open a form. Message your account manager. | هالرابط ما يفتح أي فورم. كلّم مدير حسابك. |
| Limited | Too many tries. Wait a minute, then open the link again. | محاولات وايد. انطر دقيقة وبعدها افتح الرابط مرة ثانية. |
| Reloaded token page | Open the link from your WhatsApp message again. | افتح الرابط من رسالة الواتساب مرة ثانية. |
| Admin-only (member) | (not shown: members never see admin-only forms, V9) | |
| Newer schema | This form needs a newer Mahara OS. Refresh the page. | هالفورم يحتاج نسخة أحدث من Mahara OS. حدّث الصفحة. |
| Staff preview banner | Team preview: this is what the client sees. Nothing is recorded. | معاينة للفريق: هذا اللي يشوفه العميل، وما ينحفظ شي. |
| Staff preview submit | Preview: nothing was sent. | معاينة: ما انرسل شي. |

Address rule (V27): text drawn in the portal or on the link page speaks to the one person
answering, in the singular (مدير حسابك، قول، مشكور), as the portal's existing Arabic does (مواعيدك،
فريقك); WhatsApp texts to the client group stay plural (هلا فريق {client}، شيّكوا، تنصحون). "Your
team" in client copy is always "your Mahara team" / "فريق مهارة", because in the portal "your team"
already means the client's own staff (تم التحويل لفريقك). The renderer picks the minutes line by
number (a test covers 1, 2 and 5). Arabic rules applied (aziz-kuwaiti-voice): spoken Kuwaiti, polite, no em dashes, no quote marks,
Arabic-Indic digits, "دولار" never "$" (no money appears in these forms), loanwords as he says them
(فورم). Nothing promises results; nothing quotes leads or cost per lead (the `people` rating asks
about the people who reached them, not a count).

### 5.11 Churn tracker (cockpit, ChurnPage)

`Send exit survey` is enabled on each departure (opens Send a form preset to the exit survey, link
by default when the workspace is closed); the Client is leaving sheet's after-send trail offers the
same `Send exit survey` button; the row shows `Exit survey sent {date} · {portal | link}`,
`Exit survey answered {date}` (with `Read the answer`) or `Not sent`. The W12 line `Client forms
arrive with the portal (wave 3).` goes. A native survey in the Notice in band shows its ratings in
Geist Mono with `Confirm churn`, `Not leaving`, `Open the notice ticket`.

### 5.12 Settings, notices routing and runbook words

Notices routing blurbs: `Pause consent signed: the client signed (or said the dates are wrong); the
CSM confirms the pause.`; `NPS answer in` and `Onboarding survey answer in`: `Posts in
#nps-survey-feedback once the bot is in.`; `Low score: a score of {6} or less; the CSM calls the client
that day.`; `Portal feedback in: the client used Share feedback in their portal.`; `Old form link used:
an answer came through a retired Typeform; open it in the cockpit.`

### 5.13 The forms editor (cockpit, `FormsEditorPage.tsx`)

Design: the cockpit plan of 5.0; a list (`SectionCard` per group: `Client forms`, `Staff forms`,
`Typeform and Make forms`), then one form per page: left column the field list (drag handle,
label, type chip, `required`), right column the field editor with English and Arabic inputs side by
side (`dir="rtl"` on Arabic), a `Preview` strip that draws the structure in both languages, and the
routing card. Signature reuse: the version history as a vertical delivery line (`v1 published
{date} · {role}` …) with `Go back to version {n}`.

Copy: `Save draft` → `Draft saved`; `Publish version {n+1}` → `Published`; note prompt `What
changed? (shown in the history)`; `Go back to version {n}` → `Restored as version {m}`; `Open the
real preview`; refusals: the SQL sentences (field guard, text rule, schema check, stale base);
read-only lines of 4.9.6; empty draft: `No changes yet.`

---

## 6. Workers, crons, monitoring and the runbook

### 6.1 Crons and workers

| Job | Where | Schedule | Off switch |
|---|---|---|---|
| `mahara-form-schedule` | pg_cron → `cockpit_form_schedule_run()` | `0 7 * * *` UTC | `forms.schedule.on=false` (the sweep still runs) |
| Invite phone alerts | portal `/api/cron/client-tasks` (existing, every 5 min) → `form-notifications.ts` | every 5 min | nothing to claim until a live invite with `push` exists |
| Presence push | same cron → `form-presence.ts` | every 5 min | `forms.client.presence=false` |
| WhatsApp invite links | `hermes/client-messages` (existing cron) | every minute | `CLIENT_MESSAGES_KINDS` without `form_invite` |
| Card writes `survey`, `nps_sent` | `clickup-writeback` (existing, kind `billing`) | existing | the kinds out of `CLICKUP_WRITEBACK_BILLING_KINDS` |
| Notices | `cockpit-notices` (existing, every minute) | existing | each kind's settings row |

### 6.2 Guardian (`hermes/cockpit-guardian/checks/client_forms.py`, registered in `checks/__init__.py` after `forms_billing`; report-only)

| Check id | Reads | Warn / fail |
|---|---|---|
| `form-schedule` | `cockpit_sync_state` `form-schedule` | fail when older than 26 h while `forms.schedule.on`; warn when a run issued 0 and skipped any for `notLive` |
| `invites-expiry` | `cockpit_form_invites` | warn when an `open` invite is past `expires_at` by more than 26 h (the daily sweep is not running; reads already treat it as expired, V25) |
| `invite-push` | invites `push_state='sending'` | warn when older than 15 min |
| `invite-links` | `cockpit_client_messages` kind `form_invite` | warn on any `unknown`; warn on a draft older than 48 h ("{n} form links wait for a CSM's approval") |
| `token-limits` | `cockpit_form_token_opens` | warn when more than 50 `limited` in an hour |
| `presence` | `cockpit_portal_presence.pushed_at` | warn when the newest push is older than 30 min while `forms.client.presence` |
| `voice-count` | `cockpit_client_voice_v` (distinct cards with an NPS answer in the last 30 days) vs `cockpit_form_invite_events` joined to non-canary NPS invites (distinct cards with `answered` in the same window), both over REST with the service key (the browser RPCs are seat-gated and refuse the guardian) | warn when the two card counts differ |
| `low-score-open` | `cockpit_client_voice_v` (score at or under `voice.low_score.max` from `cockpit_settings`, last 14 days) and `cockpit_requests` (`type_key='client_low_score'`, same card, created at or after the answer), over REST | warn when a low score waits more than 1 business day with no ticket |
| `hook-failed` | `cockpit_form_invite_events` event `hook_failed` | warn on any in the last 7 days: "{n} client answers were stored but a follow-up step failed. Re-run it from the runbook." |
| `legacy-24h` | responses state `legacy` in 24 h for a form whose provider is native | warn: "{form} came through the old link {n} times today" |
| `onboarding-webhook` | read model `forms.onboarding.response_id` (submitted since D-C6) vs stored `onboarding` responses | for 14 days after D-C6: warn on a poll-only answer older than 30 min; after day 14 the check reads "compared for 14 days" |
| `forms-door-make` | `forms-door:onboarding`, `forms-door:new_client` | fail on the last outcome `failed`; quiet forms are normal and said so |

Before deploy each check reads "not set up yet" as ok, never as zero.

### 6.3 Runbook rows (`RUNBOOK.md`, client-voice writes them all)

"Turn a client form on or off" (`cockpit_form_client_go_live`, the canary first, what going off does
to open invites); "Send a form link by WhatsApp" (approval, the worker, `unknown`, the masked link);
"A client says the link does not work" (expired, answered, withdrawn: send again; never read a token
from anywhere); "Turn the schedule on or off" and "Why did NPS not go to {client}" (the run's skip
reasons); "Low score" (the ticket, the call); "Presence looks wrong" (the portal cron, the switch);
"The onboarding webhook" (`forms_key.py` status/probe/unregister; the poll keeps the read model);
"The New Client Form webhook" (records only; never submit the form); "Undo a published form version"
(Go back to version n); "Roll back a migration with screens on it" (W12's row, now for `a` to `d`,
with D-B1's `pause_consent` registry step); "A client answer's follow-up step failed" (`hook_failed`
events: read the hook and sqlstate, fix, re-run `cockpit_form_client_submitted` for the response as
the owner; the dedupe keys stop doubles).

### 6.4 SOURCES.md rows (client-voice)

NPS (`clients.nps`: "From the client's own answers in the portal or by WhatsApp link since {first
day}; each client counts once per window with their latest answer; promoters 9–10 minus detractors
0–6, over n answers; the 2 old Typeform answers could not be matched to a client and are left out;
checked against the count of answered invites"); CSAT ("average of onboarding answers 1–10, shown
apart from NPS"); Portal feedback ("counted apart; its 1–5 rating never enters NPS").

---

## 7. File ownership

Seven slices, each in **one repo**. A file appears under exactly one slice. Pairs that
`scripts/check-shared.sh` compares belong to one slice together. If a slice needs a change in
another's file, it leaves a note in its report (file, line, the change) and does not edit it.

| Slice | Repo | Starts | Depends on | Migration | Owns |
|---|---|---|---|---|---|
| **invites-core** | cockpits | at once | none | `20261102a_forms_invites.sql` | migration `a`; `supabase/functions/cockpit-notices/{text.ts,send.ts,doctor.ts,text.test.ts,run.test.ts,testkit.ts}`; `apps/client-success-cockpit/src/lib/notices.ts`, `apps/client-success-cockpit/src/components/NoticesRouting.tsx`, `apps/client-success-cockpit/src/dev/noticesFixtures.ts`; `supabase/functions/cockpit-forms-api/{door.ts,messages.ts,door.test.ts,messages.test.ts}`; `hermes/client-messages/{worker.ts,core.ts,worker.test.ts,core.test.ts,RUNBOOK.md}`; `apps/media-buyer-cockpit/scripts/forms-invites-supabase.test.ts`; `apps/media-buyer-cockpit/scripts/fixtures/client-form-answers.json` |
| **client-lifecycle** | cockpits | after invites-core's migration file lands | invites-core | `20261102b_client_lifecycle.sql` | migration `b`; `supabase/functions/clickup-writeback/{billing.ts,billing.test.ts}`; `supabase/functions/billing-sync/{billing.ts,billing.test.ts}`; `apps/media-buyer-cockpit/scripts/client-lifecycle-supabase.test.ts` |
| **client-voice** | cockpits | after invites-core's migration file lands | invites-core | `20261102c_client_voice.sql` | migration `c`; `supabase/functions/forms-door/**`; `scripts/dev/{forms_key.py,test_forms_key.py,forms_legacy_backfill.py,test_forms_legacy_backfill.py}`; `hermes/ceo-refresh/native/{voice.js,metrics.ts}`, `hermes/ceo-refresh/native/adapters/clients.js`, `hermes/ceo-refresh/voice.test.ts`; `apps/media-buyer-cockpit/convex/ceo/metricRegistry.ts`; `apps/media-buyer-cockpit/src/pages/ceo/{SOURCES.md,ClientSuccessTab.tsx}`; `hermes/csm-calls/{sources.ts,sources.test.ts}`; `hermes/cockpit-guardian/checks/{client_forms.py,__init__.py}`, `hermes/cockpit-guardian/tests/test_client_forms.py`; `RUNBOOK.md`; `apps/media-buyer-cockpit/scripts/client-voice-supabase.test.ts` |
| **forms-editor** | cockpits | after client-voice's migration file lands | invites-core, client-voice | `20261102d_forms_editor.sql` | migration `d`; `apps/client-success-cockpit/src/pages/{FormsEditorPage.tsx,SettingsPage.tsx,index.ts}`; `apps/client-success-cockpit/src/auth/authenticated/AuthenticatedAppRoutes.tsx`; `apps/client-success-cockpit/src/lib/{formsEditor.ts,formsEditorCore.ts}`; `apps/client-success-cockpit/src/dev/formsEditorFixtures.ts`; `apps/client-success-cockpit/scripts/forms-editor.test.tsx`; `apps/media-buyer-cockpit/scripts/forms-editor-supabase.test.ts` |
| **cockpit-screens** | cockpits | at once (against 3.3's names; tests stub the RPCs) | merges after invites-core, client-lifecycle, client-voice | none | `apps/client-success-cockpit/src/components/{ClientForms.tsx,ClientVoice.tsx,DeliveryLine.tsx,ClientMessages.tsx,CommandPalette.tsx}`; `apps/client-success-cockpit/src/lib/{clientForms.ts,clientFormsCore.ts,clientVoice.ts,clientMessages.ts,clientBrief.ts,churnClient.ts,churnCore.ts,useCsmSnapshot.ts}`; `apps/client-success-cockpit/src/pages/{CsmPage.tsx,ChurnPage.tsx}`; pairs `apps/{client-success,media-buyer}-cockpit/src/forms/staff/{FormSheet.tsx,formSheet.css,formSheetCore.ts,formDefs.ts,lifecycleClient.ts}`; `apps/{client-success,media-buyer}-cockpit/src/lib/csmLinks.ts`; `viktor-side-scripts/csm/csm_assistant.py`; `apps/client-success-cockpit/src/dev/{clientFormsFixtures.ts,formHarness.tsx}`; `apps/client-success-cockpit/scripts/{client-forms.test.tsx,client-voice.test.tsx,form-sheet.test.tsx,churn.test.ts,guide-links.test.ts}`; `apps/media-buyer-cockpit/scripts/{stage1-ownership.test.ts,stage2b-ownership.test.ts}` (only the lines that pin a changed link row) |
| **portal-forms** | portal | at once (against 3.3; tests stub `fetch`) | none to build; its release waits for D-C1 | none | `src/lib/{client-form-schema.ts,client-forms.ts,form-token.ts,form-notifications.ts,form-presence.ts,client-asks.ts,workspace-navigation.ts,notification-store.ts,task-notifications.ts}` (`task-notifications.ts` only where it prunes or reads `askDeliveries`, to treat `formDeliveries` alike); `src/app/api/notifications/display/route.ts` (accepts a form delivery id beside an ask delivery id, through `portal_form_invite_display`); `src/components/forms/{FormRenderer.tsx,FormRenderer.module.css,ScaleKeys.tsx,FormsForYou.tsx,FormsPage.tsx,TokenForm.tsx}`; `src/components/{ClientAsk.tsx,ClientAsk.module.css,ClientAskPreview.tsx,Portal.tsx}`; `src/app/api/forms/route.ts`, `src/app/api/forms/token/route.ts`, `src/app/api/asks/route.ts`, `src/app/api/cron/client-tasks/route.ts`, `src/app/f/page.tsx`, `src/app/preview/client-form/page.tsx`; `next.config.ts`; `tests/{client-form-schema.test.ts,client-forms-route.test.ts,form-token-route.test.ts,form-renderer.test.ts,client-ask-form-invite.test.ts,form-notifications.test.ts,form-presence.test.ts}`, `tests/fixtures/client-form-answers.json`; `docs/{CLIENT-FORMS.md,CLIENT-ASKS.md}` |
| **portal-bridges** | portal | at once | none to build; its release goes with portal-forms | none | `src/lib/{feedback-bridge.ts,onboarding-cockpit-evidence.ts,onboarding-policy.ts,onboarding-state.ts}`; `src/app/api/feedback/route.ts`; `tests/{feedback-bridge.test.ts,onboarding-cockpit-evidence.test.ts}`; `docs/CLIENT-FEEDBACK.md` |

Cross-slice touch points, settled here so nobody edits another's file:
- **Hooks by name** (V19): client-lifecycle and client-voice write `cockpit_form_hook_*` / `cockpit_form_issue_hook_*` in their own migrations; invites-core's dispatchers call them only when they exist. A hook is tested in its owner's PGlite test with `a` applied first.
- **Notice kinds** live in invites-core (SQL and `text.ts`); `b` and `c` only insert notices of those kinds with the facts of 3.4.
- **The schedule's issuer** `cockpit_form_invite_issue_system` and the canary door are invites-core's; client-voice calls the issuer.
- **Billing kinds** `survey` and `nps_sent` (writes, comment, trigger, `billing.ts` field) are client-lifecycle's; client-voice's NPS issue hook only inserts the `nps_sent` event.
- **ED and schedules**: forms-editor's `cockpit_form_routing_set` writes client-voice's `cockpit_form_schedules` and `voice.low_score`; the table and its seed are client-voice's.
- **The answers fixture** `client-form-answers.json` is written by invites-core; portal-forms copies it byte for byte into `tests/fixtures/`; D0 compares the two files with `cmp`.
- **`cockpit_form_client_live_list()`** (invites-core, `authenticated`, `STABLE`, returns the live keys) is what the client page's Links section reads to show the cockpit row or the old Typeform row (4.11); media buyer's `csmLinks.ts` rows change to the cockpit wording without a live read (its Links rows are reference only).
- **Ticket buttons** import the existing prefilled request form opener unchanged (W12 rule); a slice that finds it cannot take a prefill leaves a note and shows `Open Tickets and pick Client low score.` instead.
- **portal-bridges** never imports portal-forms' files: it has its own small RPC helper (the asks pattern) in `feedback-bridge.ts`, reused by `onboarding-cockpit-evidence.ts`.
- **`src/lib/auth.ts`** (portal) is not touched by anyone; `form-token.ts` reads `SESSION_SECRET` itself with the same production rule (refuses to run without it in production).
- **`scripts/check-shared.sh`** is not touched: no new pair is added (the new cockpit screens live in client success only).

---

## 8. Tests each slice runs green

Every cockpit slice: `tsc -b` in each app it touches (`bun run typecheck` skips `src`), `biome check`
on its files, `scripts/check-shared.sh` once pairs land, and its PGlite test applying `20261101l`
to `r` (the existing test helper's live chain) then its own file(s) twice. Every portal slice:
`npm test` (all tests, about 1,850 today), `node node_modules/typescript/bin/tsc --noEmit`, and
`npm run build`.

| Slice | Tests |
|---|---|
| invites-core | `cd apps/media-buyer-cockpit && bun test scripts/forms-invites-supabase.test.ts scripts/forms-stage3-base-supabase.test.ts` (the second unchanged and green); `cd supabase/functions/cockpit-notices && bun test`; `cd supabase/functions/cockpit-forms-api && bun test`; `cd hermes/client-messages && bun test`. Asserts: `a` applies twice; the drift guard refuses a changed body; every new table has row security, no browser grant, refuses delete; the seat gate (a CSM on another client refused by `_view`, `_issue`, `_withdraw`, `_link`, `_answer_read`; anon refused everywhere); a form not live refuses issue; one open invite per card, form and purpose; a repeated request id returns the first invite; CSAT refused once filled; a Stopped card refused for NPS, CSAT and pause consent; the portal channel refused without an open workspace; notes and templates through `cockpit_client_text_ok` (an English "leads", an Arabic "ليدز", "CPL", "guarantee" and "نضمن" each refused, "the people who reached you" allowed); `cockpit_form_answers_check` on every row of the fixture (codes exact); `cockpit_form_schema_check` refuses `file`, a missing Arabic text, a duplicate key, a `showIf` to a later field; tokens: the raw token never appears in any table, audit row or event (scan every text column after a mint); `_link` revokes the previous copy token; `portal_form_token_open` refuses unknown, expired, answered, withdrawn, not-live tokens with their codes; the 30-a-minute browser limit, the 120-a-minute network limit and the 10-unknown limit each return `limited`; `portal_form_submit` and `_token_submit` store one answer per invite (a second submit from the other channel answers `answered`), revoke tokens, skip the unsent message, refuse an admin-only form for a member, refuse a hidden field's answer; a workspace mismatch raises `form_invite_not_in_workspace`; a closed workspace refuses the portal path while the token works; `portal_form_for_person` respects the 20-hour shared cap with an ask shown, `later` snoozes 3 days, the deep link passes the cap; `portal_form_presence_put` refused while off; the effect gate passes an open live `form_invite` message and refuses an expired or withdrawn one with its reason; approve refuses a body without `{form_link}` or with it twice; claim accepts `form_invite`; `cockpit_client_message_invite_link` mints once per message and answers `already_made` after; the worker replaces the placeholder in the sent text only, records `unknown` on `already_made`, masks the link in group searches and never writes the URL to its report; `recap.approve` refuses a `form_invite` message and `invite.approve` a recap; the six notice kinds render 3.4's texts and carry no email, answer text or token; the canary door refuses any card but `86eywg1cq` and mutes its notices; `cockpit_form_client_go_live` moves `exit_survey` to native and withdraws open invites when switched off. Added by the review: every `STABLE` RPC runs inside `SET TRANSACTION READ ONLY` and still reports an invite past `expires_at` as expired; submitting while the invite's message is `claimed` (and again while `sending`) succeeds, leaves the message as it was, and the gate then refuses it so intent moves it to `refused`, and the sweep to `skipped`; a `draft`/`approved` message is skipped on submit, withdraw and go-live off; `cockpit_form_card_allows`: NPS, CSAT and pause consent refused for `GHOSTED`, `SALES TEAM TO CONTACT`, `Stopped` and an Active card with an open departure, the exit survey refused for an Active card with no departure and allowed for a Stopped card and for an open departure; the gate passes an exit-survey message to a Stopped card; an open NPS invite of a card that turns Stopped answers `withdrawn` in `portal_form_get` and the token path; `p_origin` other than `pause` refuses pause consent and an unknown origin is refused; the default channel for pause consent with members only (no admin session) is portal + WhatsApp; a canary answer is stored `shadow` with `answer_meta.canary` and never reaches `cockpit_form_invites_today` or `cockpit_form_notices_in`; a submit hook that raises still stores the answer, closes the invite, writes `hook_failed` and returns `ok:true`; `portal_form_for_person` returns `shown_today` after an ask pop-up even when no invite is open; `cockpit_form_schema_check` accepts `signer:'none'` and refuses any other value; `PortalInvite.lang` equals the invite's `lang`; `cockpit_form_client_version('exit_survey')` is the newest `v:1` version. |
| client-lifecycle | `cd apps/media-buyer-cockpit && bun test scripts/client-lifecycle-supabase.test.ts scripts/money-acts-supabase.test.ts scripts/churn-confirm-supabase.test.ts` (the last two unchanged and green); `cd supabase/functions/clickup-writeback && bun test billing.test.ts`; `cd supabase/functions/billing-sync && bun test`. Asserts: `b` applies twice after `a`; the trigger queues `system` `survey` and `nps_sent` and still refuses `system` pause; `nps_sent` writes NPS Survey Sent (read back against a stubbed ClickUp) and `survey` writes no field and posts 3.8's comment with no email; the pause with `pause_consent` not live keeps W12's ticks (a live-body replay of the old billing sheet shape still pauses); with it live: refused without `consentResponseId`, refused on a consent over 14 days old, refused on `datesWrong`, refused on a different restart, accepted with the signed one, and the consent detail and comment say "signed"; non-payment pauses need no consent; the issue hook refuses a Paused card; the exit-survey issue hook marks an open departure `sent`; the submit hook queues `termination.notice` and `termination.submitted` once each, inserts one `survey` event, marks the departure `filled`; `cockpit_form_notices_in` lists a native survey and a signed consent and drops the consent after a pause event; "Not leaving" answers a native survey once (guard carve-out) and a second answer is refused; `cockpit_csm_churn_read` carries `surveyInvite`; the canary accepts `survey` and `nps_sent` on the test card only. Added by the review: the pause consent context accepts a start up to today + 14 and refuses today + 15; `cockpit_pause_consent_for` returns the signer; the registry `exit_survey` stays version 1 / `typeform` after `b` and a Typeform delivery through the live `cockpit_form_record_legacy` body is stamped version 1; **rollback**: after restoring the saved `cockpit_billing_write` body and running D-B1's registry step, a client-request pause with the two ticks succeeds on the old body. |
| client-voice | `cd apps/media-buyer-cockpit && bun test scripts/client-voice-supabase.test.ts scripts/forms-stage3-base-supabase.test.ts`; `cd supabase/functions/forms-door && bun test`; `python3 -m unittest scripts/dev/test_forms_key.py scripts/dev/test_forms_legacy_backfill.py`; `cd hermes/ceo-refresh && bun test`; `cd hermes/csm-calls && bun test sources.test.ts`; `cd hermes/cockpit-guardian && python3 -m unittest discover -s tests`. Asserts: `c` applies twice after `a` and `b`; the schedule with a fake clock: off does only the sweep; on issues NPS at day 60 exactly, not at day 59, again at 60 + 90 and not before, skips every card that is not Active (GHOSTED, SALES TEAM TO CONTACT, Stopped) and an Active card with an open departure, no launch date, an open invite, a form not live; a manual send resets the 90 days; CSAT goes after launch, only within 60 days of launch, never after an answer, WhatsApp once from day 3, portal re-tries up to 3; at most 3 per form per run, oldest launch first; idempotent on a second run the same day; first launch is the minimum over the snapshots; the NPS issue hook writes one `nps_sent` event with the round; hooks queue `nps.received`/`csat.received` and `voice.low` at 6 and not at 7; `cockpit_client_voice_v` excludes legacy rows and feedback ratings from bands; the NPS number on a fixture (3 promoters, 1 passive, 1 detractor = 40, n 5; a card answering twice counts once); n 0 gives NULL and "No scores yet", never 0; `supabase_read_only_user` can select both views (the helpers granted); `portal_feedback_record` refused while not live, idempotent on the feedback id, queues `feedback.received`; forms-door: `onboarding` and `new_client` bad signature 401 before any parse, a good one stores state `submitted` with no notice, kickoff/exit_survey/pause_request behave exactly as before; a Typeform delivery for native `exit_survey` stores legacy and queues `legacy.received`; `cockpit_form_record_make` writes the onboarding read model only when empty or older, with the same `answers` shape as `readFormData` on the same recorded payload; `portal_form_status` returns the newest answer with `unverified`; `forms_key.py` handles the two new forms and `register-typeform` reads every other webhook before and after; the backfill prints counts only and stores `nps`/`csat` with no card; metrics: `clients.nps` and `clients.csat` from a fixture payload, missing read is said, not 0; the guardian checks read "not set up yet" as ok and their warn/fail rules of 6.2. Added by the review: a canary answer (shadow) never reaches `cockpit_client_voice_v`, the daily view or `clients.nps`; a card answering NPS twice in the window counts once on both sides of the second source (no mismatch note); a missing `maxAgeDays` or `retryAfterDays` in the CSAT rule skips CSAT with `ruleNotSet`, never sends; CSAT: a card with a live session gets a portal invite on day 0, a card without one gets nothing on days 0 to 2 and a portal + WhatsApp invite on day 3, a card with no workspace a WhatsApp-only invite on day 3 and no later tries; a seat-withdrawn CSAT is never re-issued; a retry waits 7 days after the last close; one run never issues NPS and CSAT to the same card; the sweep withdraws open NPS/CSAT invites of a card that is no longer Active or has an open departure; `ticketOpen` turns true once a `client_low_score` request for the card exists after the answer; forms-door's onboarding mapping equals `formsFor` on the recorded payload with no Typeform call; the guardian's `voice-count` and `low-score-open` read the views and tables, never the seat RPCs, and `hook-failed` warns on one event; `cockpit_form_record_legacy` stamps an `exit_survey` delivery after go-live with version 1. |
| forms-editor | `cd apps/media-buyer-cockpit && bun test scripts/forms-editor-supabase.test.ts`; `cd apps/client-success-cockpit && bun test scripts/forms-editor.test.tsx`. Asserts: `d` applies twice after `a` to `c`; only an admin or the CEO reads or writes; a stale base refused; publish runs the schema check, the text rule on every text, and the field guard (removing `recommend` from `nps` refused naming the effect; hiding it behind a `showIf` refused); a published key cannot be renamed; publish adds one version, updates the registry, removes the draft, writes an audit row; open invites keep their version and their answers still pass the check; restore publishes an old schema as a new version; for a field in `reads` a change of type, min, max, required or an option value is refused while a label change publishes; a change of `audience` or `signer` is refused; staff and Make forms refuse publish with 4.9.6's sentences; `cockpit_form_registry_apply` keeps W19's refusals and refuses client forms with `Edit client forms in the forms editor.`; routing bounds of 4.9.2; the screen at 375 and 1280 px through the layout harness; no literal colour in its CSS. |
| cockpit-screens | `cd apps/client-success-cockpit && bun test scripts/client-forms.test.tsx scripts/client-voice.test.tsx scripts/form-sheet.test.tsx scripts/churn.test.ts scripts/guide-links.test.ts`; `scripts/check-shared.sh`. Asserts: Send a form shows the presence line and default channels from `_view` (per form), the `why` of each disabled form (the exit survey disabled without a departure), the SQL refusal sentences word for word, and the toast from `delivered`; one request id per open panel survives a retry; the WhatsApp approval goes through `invite.approve`; Forms out maps every state to its words and the delivery line's rings; Copy a link shows the URL once and never stores it (no `localStorage`, no state after close); Today bands render each row kind with its button and hide when empty; the low-score ticket button is hidden until the type exists; the pause sheet with the form live replaces the ticks with the consent row and keeps Confirm disabled until `signed`, and sends `consentResponseId`; without it live the ticks stay; the churn tracker enables Send exit survey and shows its states; Client voice renders the empty state and a full fixture; the brief line appears under 30 days only; csmLinks rows follow `cockpit_form_client_live_list()` on the client page; every door hides with "Opens after the next cockpit update." when its flag is false and makes no call; the FormSheet pair stays identical; layout harness scenarios `forms`, `voice` and `consent` at 375 and 1280 px, light and dark. |
| portal-forms | `npm test` (all), with the new tests: `client-form-schema` (every fixture row, codes equal the SQL's; `showIf` hides and un-requires; a missing tick reads false); `client-forms-route` (401 without a session; share links get nothing; a member never receives an admin-only form; staff preview records nothing; locked workspaces still list forms; a `form_invite_not_in_workspace` becomes 403; a malformed RPC answer becomes 503); `form-token-route` (the route never calls `identity()`; refuses a cross-origin POST; a token not matching the format is refused before hashing; the RPC receives only the hash; no response body, header or log line holds the token or its hash; the cookie is HttpOnly, Secure, SameSite=Strict, Path=/api/forms; `/f` resolves to `src/app/f/page.tsx`, not `[[...path]]`; the headers of 3.6 on both routes); `form-renderer` (renders every form of section 5 in Arabic and English; `dir` correct; the minutes line for 1, 2 and 5 in both languages; the token page starts in the invite's `lang`; the token page's draft survives a reload and storage never holds the token or its hash; scale order 0..10 in the DOM with direction by CSS; folded rows under 420 px; the submit says what is missing; the request id is reused on retry; nothing is stored on the token page); `client-ask-form-invite` (the ask route returns a form invite first, honours `shown_today` without asking for a review, falls through to asks otherwise; the pop-up keeps the calm rules and opens the forms page); `form-notifications` (claims, never sends twice, uncertain stays uncertain, counts only back); `form-presence` (counts per workspace from a state fixture, no email leaves, `off` logs ok). The `/preview/client-form` page answers 404 in production. Screenshots of section 5's portal screens at 320/375/414/768/1280, Arabic and English, light and dark, through the Hallmark gates. |
| portal-bridges | `npm test` (all), with: `feedback-bridge` (called after a saved feedback; a bridge failure or timeout never changes the client's 201; `not_live` logs ok; no id or text in the log line); `onboarding-cockpit-evidence` (a submitted cockpit answer completes `form` evidence once through `recordCompletion`; a failed read changes nothing; the check runs only inside the existing claimed refresh, never on every poll; `cockpitEvidence` is pure). |

No test submits a Typeform, posts to Slack, writes ClickUp, calls Make, sends WhatsApp or reaches
the live database: recorded payloads, stubbed providers and PGlite only. Canaries are deploy steps.

---

## 9. The deploy table (the main session, after every slice is merged on its branch and reviewed)

Migrations through the CEO's Composio Supabase connection (memory: supabase-via-composio), each
preceded by the letter rule (2.1), the md5 check against 2.2 and the `before-*.sql` saves; function
deploys through `scripts/dev/deploy_composio.py <slug> --rev <sha> --verify-jwt <live value>` (`--dry`
first; the live values read 2026-11-01: `forms-door` off, `cockpit-notices` off, `clickup-writeback`
off, `billing-sync` off, `cockpit-forms-api` on, `cockpit-ceo-api` on; read the "before" line again and
pass what it says); the cockpits through `scripts/ship.sh client-success` and `scripts/ship.sh
media-buyer` from a fresh worktree (Python 3.10+ first on PATH as `python`, memory: forms-waves-1-2-live);
the portal through the Mac release steps (memory: portal-deploy-from-mac); VPS code by native release
(memory: native-release; file-scoped hotfixes where a full tree would ship unrelated readers).
Typeform and Make changes: blueprint or definition saved first to the VPS (`~/make-backups/`,
`~/typeform-backups/`), each change read back. Every step is recorded in
`/Users/abdulazizwaheedi/mahara-cockpits/notes/forms-w34/deploy/deploy-log.md` and the session in
mahara-context `shared/sessions/`. Canaries run only on the internal test card `86eywg1cq` (or, for
the portal page, the staff preview); never a real client.

| # | Step | Read-back | Rollback |
|---|---|---|---|
| D0 | Pre-checks: letter rule; md5 of every 2.2 function equals the table; `before-*.sql` saved; the whole chain `a` to `d` applied in one transaction against live and rolled back; `cmp` of the two answer fixtures; `deploy_composio.py forms-door --rev <sha> --extra apps/client-success-cockpit/src/lib/onboardingCore.ts --dry` bundles; portal `origin/main` equals `VERSION.json` `productionSourceCommit`'s tree plus docs | all pass, or the step that failed is fixed on the branch first | none (nothing changed) |
| D-A1 | Apply `20261102a` | new tables with row security and no browser grant; the six kinds in all four notice CHECKs; `form_invite` in the message kind CHECK; `portal` in the response source CHECK; registry rows `nps`, `csat`, `portal_feedback` and versions; `forms.client` = `{"live":[],"presence":false}`; `forms.doors.invites` true; `select cockpit_form_client_live('nps')` false; effect gate md5 = the file's after | flip `forms.doors.invites` false; restore saved bodies; tables stay (inert) |
| D-A2 | Deploy `cockpit-notices` (`--verify-jwt off`) and `cockpit-forms-api` (`--verify-jwt on`) | notices doctor names the six kinds, `#nps-survey-feedback` still `refused`; `invite.approve` with the service key 403; a seat call on a recap id answers `Approve recaps from the Messages card.` | previous versions (ids recorded) |
| D-A3 | Release `hermes/client-messages` (file-scoped: `worker.ts`, `core.ts`, their tests, RUNBOOK) under its run lock; doctor; dry run; `switches.env` untouched | doctor ok; the next runs end `Nothing approved to send.` or send recaps exactly as before | link back to the previous folder under the lock |
| D-B0 | Deploy `clickup-writeback` and `billing-sync` (`--verify-jwt off`), **before D-B1**, so the writer knows `npsSent` before any `nps_sent` item can exist | `clickup-writeback:billing` mode `apply` with W12's kinds unchanged; billing-sync next run ok | previous versions |
| D-B1 | Apply `20261102b` | kinds CHECK; trigger `WHEN` text; `select cockpit_billing_writeback_writes('nps_sent', null, null, '{"on":"2026-11-03"}')` returns the `npsSent` write; `pause_consent` row native, `cockpit_form_client_live('pause_consent')` false; `exit_survey` version 2 with provider `typeform`; `forms.doors.lifecycle` true; the live billing sheet's client-request pause still takes the two ticks (the first real press is watched, not faked) | in one transaction: flip `forms.doors.lifecycle` false; restore the saved bodies; set the `pause_consent` registry row to `provider = 'typeform'`, `typeform_id = 'CTUjv6l3'` (the form it replaces; the provider CHECK needs a Typeform id, and the restored live body refuses every client-request pause while a **native** `pause_consent` row exists, `20261101p:846-851`); trigger recreated from its saved definition; read back a client-request pause with the two ticks in a rolled-back DO block |
| D-C1 | Apply `20261102c` | schedules seeded; `forms.schedule.on` false; cron `mahara-form-schedule` active; both views selectable as `supabase_read_only_user` through the management API read-only path (as `20261101r` was checked); provider CHECK lists the two keys; registry `onboarding`, `new_client`; `forms.doors.voice` true | flip `forms.doors.voice` false; unschedule the cron; saved bodies |
| D-C2 | Deploy `forms-door` (`--verify-jwt off`) | deployed with `--extra apps/client-success-cockpit/src/lib/onboardingCore.ts` (D0's `--dry` bundle); `/typeform/other` 404, GET 405; kickoff unsigned 401, signed probe 200; `exit_survey`, `pause_request` probes 200 as before; `onboarding`, `new_client` 503 (no key yet) | previous version |
| D-D1 | Apply `20261102d` | functions; `forms.doors.editor` true; `cockpit_form_registry_apply` md5 = the file's after | flip the marker; saved body |
| D-S1 | Ship client-success and media-buyer from the merged main, **only after D-A1 to D-D1** | live bundle check (memory: vercel-deploys); `to_regprocedure` non-NULL for every RPC the bundle names (`clientForms.ts`, `clientVoice.ts`, `formsEditor.ts`, `lifecycleClient.ts`, `churnClient.ts`); doors true; the Links rows still show the Typeform links (no form live) | `vercel rollback` to the recorded deployments; the migrations stay (the old bundles never call the new RPCs) |
| D-P1 | Portal release (after D-C1): `npm test`, `tsc`, commit on origin/main, `git archive`, `vercel deploy --prod --skip-domain`, CI "Verify portal", note the live id (rollback), `vercel promote`, `node scripts/check-login-origin.mjs` 17/17, receipt `docs/releases/2026-11-0x-client-forms.json`, top entry in `docs/CURRENT-STATE.md`, `VERSION.json` | `/f` 200 with `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; `POST /api/forms/token` with a well-formed unknown token answers `{ok:false,reason:'unknown'}` and the Vercel log line holds no token; `/api/forms` 401 without a session; signed in as staff (built-in browser), `?clientId=<an Active workspace>&formPreview=nps` shows the banner and the form in Arabic and English, and `select count(*) from cockpit_form_invite_events` is unchanged; `/preview/client-form` 404; the asks pop-up still behaves (`?askPreview=review`) | `vercel promote <previous id>`; the cockpit stays |
| D-Q1 | Native release: `hermes/ceo-refresh` file-scoped (`native/voice.js`, `native/adapters/clients.js`, `native/metrics.ts`, `voice.test.ts`) with the canary under the lock (not across 21:00 UTC); the guardian's `checks/client_forms.py`, `checks/__init__.py`, its test, under its run lock; then csm-calls' own release with `sources.ts` | CEO clients section carries `voice` with n 0 and "No scores yet"; `clients.nps` NULL, never 0; guardian checks read "not set up yet"; csm-calls run OK, the 1-1 notes still ingest | previous links (recorded) |
| D-PR | `forms.client.presence` true | within 10 minutes `cockpit_portal_presence` has rows; their count equals the workspaces the portal cron's log line counted (second source); the Send panel's presence line shows days | set it false (rows stay; `_view` then picks both doors) |
| D-R2 | Request type `client_low_score`: the ClickUp Request Type option "Client low score" on field `e9fd8024` (dry run first), then `cockpit_request_type_add({key:'client_low_score', type_index:33, team:'client_success', owner csm_of_card, due_days:1, priority:'high', set_request_type:true, ...})`; requests doctor | the doctor lists 34 types; the low-score ticket button appears | `enabled=false` through the editor |
| D-WA | WhatsApp doctor for the test card (`worker.ts doctor --task 86eywg1cq`). **If it has a group:** check no approved recap waits; set `CLIENT_MESSAGES_KINDS=recap_checkin,form_invite` and `CLIENT_MESSAGES_ONLY_CARDS=86eywg1cq` (edit the lines, never append); `cockpit_form_invite_canary('nps', '{"round":1}')` with the WhatsApp channel (the door makes a draft on the test card); approve it as the owner with the CEO's seat id and the note "canary"; watch the worker send; read back by message id; open the link in the built-in browser (the NPS form renders); withdraw; clear `ONLY_CARDS` (≤ 30 minutes in all). **If it has none:** set the kinds line only and watch the first real approval (never a test send to a client) | the message `sent` with a provider id; its stored body still holds `{form_link}`; no URL in the worker's report; `link_sent` event; after withdraw the link answers `withdrawn` | `CLIENT_MESSAGES_KINDS=recap_checkin` |
| D-C2C | **Pause consent live (C2 client side, one hour):** (1) canary: `cockpit_form_invite_canary('pause_consent', {start, restart: +7 days, reasonCat:'client_asked'})`, open the URL in the built-in browser, check Arabic and English and right to left, submit with the typed name "Mahara test" → response source `public`, `pause.consent` muted, `cockpit_pause_consent_for('86eywg1cq')` = `signed`; (2) a rolled-back DO block as a real CSM seat on a real Active card (issue → token submit → `cockpit_billing_write` pause with the consent → read the queued item → `RAISE` with the results; nothing commits); (3) `cockpit_form_client_go_live('pause_consent', true, 'deploy D-C2C')`; (4) save and close Typeform `CTUjv6l3` (`is_public:false`), remove `WHTP4371898` (read the webhook list before and after: the cockpit webhook stays) | each read-back above; the live list `["pause_consent"]`; Typeform reads closed | go-live off (withdraws open consents); reopen the form from its saved definition; re-add the webhook with its saved URL |
| D-C4B | **Exit survey live (C4b, one hour):** (1) save Make 9805538's blueprint; (2) canary invite `exit_survey` on the test card, submit by link (typed name), with `CLICKUP_WRITEBACK_BILLING_KINDS` + `survey` and `BILLING_ONLY_CARDS=86eywg1cq`: the `survey` item delivered, the comment read back on the card, both notices muted; void the canary event by record; (3) `cockpit_form_client_go_live('exit_survey', true, ...)` (provider moves to native); (4) enable `termination.submitted`; (5) switch off Make 9805538, read back `isActive=false`; (6) remove `WHTP4371873`; (7) close `knIe4eF3`; (8) clear `BILLING_ONLY_CARDS` (kinds keep `survey`); held-edit review for `survey` (none expected) | each read-back; the cockpit webhook still on `knIe4eF3`; `heldOpenKind` 0 | go-live off; Make back on from its blueprint; webhook re-added; `termination.submitted` disabled; remove `survey` from the kinds |
| D-C5 | **NPS and CSAT live (C5). Precondition (Q4, plan C5):** `cockpit_slack_channels` `nps-survey-feedback` reads `ok` and the `cockpit-notices` doctor passes; until then this row does not start and NPS/CSAT stay on Typeform and Make. (1) canary NPS invite on the test card with kinds + `nps_sent` and `BILLING_ONLY_CARDS=86eywg1cq`: NPS Survey Sent read back on the card; submit a 5 by link: the response stored `mode = 'shadow'`, `nps.received` and `voice.low` muted, `cockpit_client_voice_v` and the CEO metric unchanged; canary CSAT likewise (no card write); void the canary billing events by record; (2) go-live `nps` and `csat`; (3) clear the card list (kinds keep `nps_sent`); (4) remove `WHTP4007419` and `WHTP4007430`; (5) save, switch off and read back Make 8962328 and 8962387; read Make 8068892 and switch it off only if it is the NPS Slack scenario; (6) close `fuPgs85S` and `KbcbPA73`; `forms_legacy_backfill.py nps` and `csat` (`--dry` first): 2 rows, no card; (7) `cockpit_form_schedule_run(now(), false)` (the plan: expect NPS for the 7 clients past day 60 and CSAT for the clients launched within 60 days, 3 of each a day), then `forms.schedule.on=true` | each read-back; the dry plan matches 11.2-g's list; the first 07:00 UTC run issues at most 3 of each and `form-schedule` says so; WhatsApp drafts wait for the CSM | `forms.schedule.on=false`; go-live off; scenarios back on from their blueprints; webhooks re-added |
| D-FB | **Feedback bridge live:** go-live `portal_feedback` | the next real "Share feedback" in any portal stores one `portal_feedback` response and posts `feedback.received` (watched, never faked); before it, the release-test feedback is not imported | go-live off (the portal keeps saving its own copy) |
| D-C6 | **Onboarding webhook:** `forms_key.py typeform-secret onboarding`, `register-typeform onboarding` (every other webhook on `KFRCXPFx` read before and after), `probe-typeform onboarding` (401 then 200); `forms_legacy_backfill.py onboarding --dry` then without | `forms-door:onboarding` registered; stored answers equal the form's response count (46 on 11-01, plus any since); the read model unchanged for cards the poll already filled; the portal's receiver still unregistered | `unregister-typeform onboarding`; rows stay |
| D-NCF | **New Client Form:** save the form's webhook list; `typeform-secret new_client`, `register-typeform new_client`, probe; disable `WHTP4096881` (`enabled:false`, read back); backfill `new_client --dry` then without | 4 other webhooks byte-identical before and after (Cortana, Make 4014052, HighLevel) and `WHTP4096881` disabled; stored answers = the form's count (55 on 11-01, plus any since); the 3 `cockpit_sales_client_forms` response ids found | `unregister-typeform new_client`; re-enable `WHTP4096881` |
| D-S2 | Links: nothing to ship (the client page reads the live list); write the mahara-context link corrections (`client-comms/csm-templates.md:524-533`, `_RESOURCES.md:44`, `_LINK_AUDIT.md:23`) and the session note | the client page Links show "Send a form (in the cockpit)" for each live form | revert the docs commit |
| D-G1 | Read the guardian's `client_forms.py` checks after D-C5 | each reads ok or names a real gap | file-scoped hotfix of the check |
| D-Z | Watch the first real press and answer of each piece: a CSM's Send, a WhatsApp approval, a portal pop-up answer, a link answer, a pause consent, an exit survey, a scheduled NPS, a low score; write the session note | one line each in the deploy log | per piece's runbook row |

Rows run top to bottom: D-B0 before D-B1, D-P1 after D-C1, the go-lives (D-C2C, D-C4B, D-C5, D-FB)
after D-S1 and D-P1.

---

## 10. What waits on the CEO or on people

- **Q4:** invite the bot to #nps-survey-feedback. **D-C5 waits for it** (plan C5 starts with the invite): native NPS and CSAT go live, and Make 8962328/8962387 go off, only once the channel row reads `ok` and the notices doctor passes, so every answer keeps reaching the channel.
- **The Request Type option "Client low score"** (D-R2): the systems manager, or the session under Q17's standing rule.
- **Arabic wording:** every client-facing Arabic line in section 5 was drafted under `aziz-kuwaiti-voice` and is used as is; the CEO changes any of them in the forms editor (no code). The closing line of the retired Typeforms cannot be set through Typeform's API (D-C1 of waves 1-2 found this), so a closed form shows Typeform's standard page; the bilingual line ("This form has moved. Message your account manager." / "هالفورم انتقل. كلّم مدير حسابك وهو يرتّب لك.") is recorded for the cards' link fields.
- **The "Client Exit Process" doc** (plan 5.8): the CEO edits it once the exit survey is live; the session lists the sentences to change in the after-report.
- **Real first answers:** a client's first pop-up answer, link answer, pause consent and exit survey, and a CSM's first Send and approval, are watched after each go-live, never imitated.
- **The 7 clients already past day 60** get their first NPS over three days from D-C5 (3 a day), and the clients launched within 60 days their onboarding survey; WhatsApp links among them wait for a CSM's approval.
- **The onboarding webhook's 14 days** against the poll end 14 days after D-C6; the guardian then says "compared for 14 days".
- **Make scenario archiving** (plan E19): each switched-off scenario moves to the Make 09 Archive after 14 days with no `legacy` answer through its old link (the guardian's `legacy-24h` shows any).

---

## 11. Decisions and checked facts

### 11.1 Decisions this contract makes (V-numbers), with reasons

| # | Decision | Why |
|---|---|---|
| V1 | Migrations `20261102a` to `d`; no portal database migration | `20261101l` to `r` are live and nothing holds `20261102` (11.2-a, b); the portal reaches business data only through `portal_*` RPCs with its business key (11.2-h) and keeps its own state in its storage document. |
| V2 | The token travels in the URL fragment (`/f#<token>`), not the path the plan names (`/f/{token}`) | A fragment never reaches Vercel's request log, a Referer header or WhatsApp's link-preview fetcher; a path does. The page reads it, clears it and posts it in a body. The plan's own rules (never in a query string, never logged) are kept more strictly. |
| V3 | Tokens are minted per channel at delivery (WhatsApp by the worker at send, Copy link on a press) and only their sha256 is stored; the portal channel needs no token | The plan's "raw token shown once, never stored" cannot hold if the WhatsApp body is stored with the link in it (`cockpit_client_messages.body` is stored and hashed); minting at send keeps the stored body a template and the link out of every table. |
| V4 | NPS Survey Sent and the exit survey's card comment ride the billing rails as kinds `nps_sent` and `survey`, not the plan's "form queue" | The `form` writer is the live 1-1 notes writer with four check-in effect keys (11.2-i); the billing rails already give a per-kind switch, a card canary, read-back, held-edit review and audit (W12 B0). The events table is the client's lifecycle log (`cockpit_client_lifecycle_v`). |
| V5 | One per-form go-live list (`forms.client.live`) is the switch for issuing, portal display, token use and the pause consent rule; registry rows are seeded native but not live | The live `cockpit_billing_write` already requires a signed consent the moment a native `pause_consent` row exists (11.2-j); seeding the row without a switch would block every client-requested pause before the portal ships. |
| V6 | The schedule is off at deploy, runs at 10:00 Kuwait, at most 3 new invites per form per run | 7 Active clients are already past day 60 (11.2-g); turning it on would otherwise send 7 NPS and 8 CSAT in one morning. |
| V7 | Automatic WhatsApp links are drafts a CSM approves; the schedule never approves | The client-messages path requires a person's approval of the exact text (2b's rule) and "never a test send to a real client"; a scheduled message to a client group is still a message on the team's behalf. |
| V8 | At most one pop-up a day per person across asks and invites; CSAT's "every visit until filled" reads as once a day; "Not now" waits 3 days | The asks' one-a-day rule is in SQL and two pop-ups in a day reads as nagging; the plan's own 3-day snooze for CSAT is kept. |
| V9 | Admin-only forms (pause consent, exit survey) are never shown to members in the portal; by link the typed name is the signer | The plan says "admin signs"; a member seeing a form they cannot send is a dead end; the link has no session to tell roles apart, so the name is recorded. |
| V10 | No file bucket in waves 3 and 4; `file` reserved and refused | No wave 3 or 4 form needs an upload; the bank receipt (wave 5) brings the bucket with its first user, so nothing ships untested. |
| V11 | Low score: a Today row with a ticket button and a new request type `client_low_score`, not an automatic request | W12's W5 (the system never opens a ClickUp ticket; one press does), for the same reasons. |
| V12 | Presence = the portal's own unexpired client sessions in the last 14 days, pushed as counts every 5 minutes, off until `forms.client.presence` | The cockpit database holds no session data (11.2-h: `portal_data.workspaces` has none); the plan's "live session in the last 14 days" is exactly what the portal knows; counts carry no email. |
| V13 | Staff forms stay code-defined in ED (listed read only); client forms are fully editable; routing editable | Staff forms' fields are enforced by SQL functions word for word (W19); a label edit without the SQL would mislead. Client forms are rendered from the registry, so editing them in data is real. |
| V14 | The onboarding webhook writes the read model directly in the poll's shape; the portal gate accepts the cockpit-held answer as form evidence | One-card refresh needs no onboarding-sync change; the portal already trusts a Typeform onboarding answer by its hidden id (`responseEvidence`), so the cockpit-held copy carries the same trust. |
| V15 | The New Client Form gets a fifth, records-only signed webhook; `WHTP4096881` (to inactive Make 9169732) is disabled in the same step | The plan's registry row needs a recorder; the old hook feeds nothing and holds queued submissions; the other four are read before and after. |
| V16 | `exit_survey` keeps one key and moves `typeform` → `native` at C4b; forms-door keeps storing a Typeform delivery for that form as legacy with `legacy.received` | One key keeps one history for the churn tracker and the readers; "an answer that still comes through the old link is kept, never lost" (E19). |
| V17 | The 2 old NPS and CSAT Typeform answers are imported with no card, state `legacy`, outside the metric | Plan 5.13: never guess the 10-28 answer onto a card by timing; their 1–10 recommend is not NPS. |
| V18 | One SQL text rule (`cockpit_client_text_ok`) refuses leads/CPL wording (the 20261012f pattern) and results-guarantee wording on every client-facing text | Client messages never quote leads or CPL; no client copy promises results (guarantee rule); the editor would otherwise let either back in. |
| V19 | Per-form hooks by name (`cockpit_form_hook_<key>`), called by invites-core's dispatchers when they exist | Keeps each form's effects in its own slice's migration with disjoint ownership, and a missing hook is simply "no extra effect". |
| V20 | The pop-up is a new ask kind `form_invite` served by `/api/asks` (invites first); invites have their own table; `cockpit_client_asks` stays for review and referral | The task's "existing client asks mechanism" is the portal pop-up and its rules; the plan keeps the asks table for nudges only. |
| V21 | NPS base is the first launch date (minimum over the daily snapshots); a manual send resets the 90-day clock | Plan 5.13 ("first Launch Date", "A manual send resets the 90-day clock"); the card's Launch Date can move on a relaunch, the snapshots keep the first. |
| V22 | A pause consent with "These dates are wrong" never counts; the restart at confirm must equal the signed one | The client agreed to dates; a pause on other dates is not what they signed. |
| V23 | Answers of Make-owned live Typeforms (onboarding, New Client Form) are stored `submitted` through `cockpit_form_record_make`, with no notice | They are the live forms, not old links; Make keeps every effect until Stage 4 (D2, D14). |
| V24 | CSAT goes only to clients launched within the last 60 days | An onboarding survey to a client launched 174 days ago (11.2-g) asks about a memory; NPS covers them. Editable in ED (`maxAgeDays`). |
| V25 | Reads are `STABLE` and never expire invites; they treat an open invite past `expires_at` as expired; the actual expiry is the daily sweep and the write paths | PostgREST runs `STABLE` functions in a read-only transaction, so an UPDATE inside a read fails, and a `STABLE` caller would not see the rows it expired anyway. |
| V26 | A CSM's withdraw of a CSAT is final for the schedule; retries wait 7 days after the last close; at most one client form per card per run | A withdraw usually means the client asked not to be bothered; a schedule that re-issues the next morning overrides the person. Two forms in one day reads as nagging. |
| V27 | Client copy addresses the person answering in the singular; WhatsApp to the group stays plural; "your team" is always "your Mahara team" / "فريق مهارة" | One voice per surface; in the portal "your team" already means the client's own staff. |
| V28 | NPS, CSAT and pause consent go only to Active cards with no open departure (an allowlist); the exit survey only with a departure or a Stopped card; open NPS/CSAT invites are withdrawn when a card stops qualifying | The mirror holds GHOSTED, SALES TEAM TO CONTACT and Brand Blueprint Booked cards beside Stopped (11.2-q); a blocklist of "Stopped" let surveys reach former clients, and an exit survey to a live client is damaging. |
| V29 | Canary answers are stored `mode = 'shadow'` | The live guard keeps mode fixed and never lets a submitted row become void, so a canary marked only by its notices would stay in the client's voice and the CEO metric for good. |
| V30 | A submit hook's failure is recorded (`hook_failed`) and the answer kept; an issue hook's refusal still rolls the issue back | E19: an answer is kept, never lost; an issue hook is a rule, not a follow-up. |

### 11.2 Checked for this contract (read only, 2026-11-01)

- **a** `select name from supabase_migrations.schema_migrations where name like '202611%'`: `20261101a` (two), `b` to `r`. Waves 1-2 deploy log: every step through D-G1 done; billing kinds open: `churn,extension,date,payment,pause,resume,mrr,late`; `billing.daily` on.
- **b** `git for-each-ref` over heads and remotes and `git ls-tree` each, plus `find` over every worktree under `mahara-worktrees` and the shared checkout: no `20261102*` and nothing after `20261101r`.
- **c** `md5(regexp_replace(prosrc,'\s+',' ','g'))` and `proacl` for every function in 2.2, as listed.
- **d** `cockpit_forms`: 10 rows (blueprint, checkin native; kickoff `tG7dnxBn`, exit_survey `knIe4eF3` (schema `{lives:'typeform', fields:[]}`), pause_request `CTUjv6l3` typeform; extension, pause, resume, churn_confirm, mrr native). `cockpit_form_responses`: 6 churn_confirm (import), 4 exit_survey and 1 pause_request (legacy, typeform_sync), 8 kickoff. Source CHECK `cockpit, embed, typeform_webhook, typeform_sync, public, import` (no `portal`); `cockpit_form_responses_guard` carve-outs for legacy rows only.
- **e** `cockpit_slack_channels`: csm-general, media-general, client-call-feedback, csm-announcements `ok`; nps-survey-feedback `refused` ("Slack shows no channel C09TTGBRQ0G to the bot"). Notice kind CHECKs list the 2b kinds plus W12's six.
- **f** `cockpit_clickup_fields`: NPS Survey Sent `34b2d7c0-6a95-4382-8c5b-5dcb83a9ac53` (date); Launch Date `2e744484-f581-4c37-962a-023c4de23729` (date, billing-sync's `launch_date`); Termination Form Link `24a77b61-af94-46df-b567-d596271421c7`.
- **g** First launch (`min(launch_date)` over `cockpit_client_billing_days`) of the 15 Active cards with one: نهوض نجد 174 days, Liwan 114, منشآت خالدة 110, Safad 77, ARCWANI 66, Professional Touch 65, ocean home 61 (7 past day 60); Castello 55, City Wood 52, شركة العلا 50, Ardon 36, mergestudio 29, Shades 18, مدانة 13, Smmim 7 (8 within 60 days). Every one has an Active portal workspace.
- **h** `portal_data.workspaces`: 68 rows, one per card; 16 Active, 7 Launching, 4 Paused, 3 Ghosting, 37 Cancelled, 1 Removed from sheet; `language` set on 3. No session or presence column anywhere in `portal_data`. The portal's asks reach the database with `MAHARA_OUTCOME_STORAGE_KEY || MAHARA_BUSINESS_STORAGE_KEY` (`src/lib/client-asks.ts`). Portal sessions: `SESSION_MS` 90 days (`session-policy.ts`); a Cancelled workspace's people get no identity (`clientIsActive`).
- **i** `cockpit_clickup_writeback_queue`: kinds CHECK `decision, manual_change, provider_action, tracking_backlog, billing, request, task_action, form`; 0 `form` rows; `clickup-writeback/forms.ts` knows four check-in effect keys only (`todo_comment`, `happiness`, `last_poc`, `last_checkin_call`).
- **j** `20261101p_money_acts.sql:846-853`: the live `cockpit_billing_write` requires a submitted `pause_consent` under 14 days whenever a native `pause_consent` registry row exists. `cockpit_forms_effects_valid` deliveries: `clickup_queue, slack_notice, client_message, creative_outbox, sql`.
- **k** `cockpit_client_messages`: 0 rows; kind CHECK `recap_checkin, recap_kickoff, recap_blueprint, phase5`; `group_source = 'client_data_f'`; claim allows the same four kinds; the worker accepts `recap_checkin` only (`KINDS_2B`). `supabase_read_only_user` exists (granted in `20261101r`).
- **l** `cockpit_request_types`: 33 enabled (index 0 to 32, `client_notice` 31 and `payment_receipt_check` 32 added at W12 D-R1). `cockpit_client_asks`: 0 rows. `cockpit_sales_client_forms`: 3 rows. `cockpit_client_onboarding`: 70 rows, 42 with `forms.onboarding` `{form_id, answers, response_id, submitted_at}`. Storage buckets: no `cockpit-form-files`.
- **m** pg_cron: `mahara-onboarding-sync` `4-59/10`, `mahara-slack-notices` every minute, `mahara-clickup-writeback-forms` every minute, `mahara-billing-daily` `10 5`. pgcrypto in schema `extensions`.
- **n** The test card `86eywg1cq` is not on the billing sheet mirror and has no portal workspace; the only test workspace is "TEST - Viktor Submission (ignore)" on card `86eyt06wu`, status Removed from sheet. Hence the owner-only invite canary door (3.10) and the staff preview for the portal page.
- **o** Portal at `79a5800`: `src/app/[[...path]]/page.tsx` catch-all; `workspace-navigation.ts:13` and `Portal.tsx:143` allow only `getting-started` and `feedback` while locked; `ClientAsk.tsx` mounted in `Portal.tsx:201`; `/api/cron/client-tasks` runs `runAskNotifications` first; `next.config.ts` sets `Referrer-Policy: strict-origin-when-cross-origin` globally; `globals.css` tokens as 5.0; `MaharaFeedback` saves to the portal's own store only; `onboarding-policy.ts` `responseEvidence` accepts `KFRCXPFx` answers by hidden id.
- **q** `select client_status, count(*) from cockpit_billing_accounts group by 1`: Active 15, Stopped 31, SALES TEAM TO CONTACT 14, GHOSTED 5, Brand Blueprint Booked 3.
- **r** `information_schema.columns` of `cockpit_requests`: `id, type_key, ..., client_task_id, client_name, answers, ..., state, created_at, ...`; no `detail` column. Live `cockpit_client_messages_guard` md5 `c676efff216517fc709ec927ca9edc55`: `claimed` → only `sending`/`approved`/`refused`, `sending` → only `sent`/`failed`/`unknown`, `refused` → `draft`/`skipped`. Live `cockpit_form_responses_guard`: state moves only `draft`→`submitted`/`void` and `submitted`→`confirmed`; mode fixed. `cockpit_form_responses_mode_check` allows `live`, `shadow`. `cockpit_forms_provider_check` `native, typeform, clickup` with `typeform` needing a `typeform_id`. Live `cockpit_form_record_legacy` inserts `form_version = f.version` (the registry's). Live `portal_client_ask_for_person` reads `cockpit_client_ask_events` only for its 20-hour cap. `docs/forms/PLAN.md:580,842`: C5 starts with the bot invite.
- **p** Code anchors in the cockpits at `6acf392d`: `csmLinks.ts` client success `:144` CSAT, `:149` NPS, `:222` pause, `:234` termination; media buyer `:97`, `:102`, `:175`, `:187`; `csm_assistant.py:39` (pause), `:41` (cancellation), `:42` referral (not retired); `20261012f_wa_send_rules.sql:77` the leads/CPL pattern; `cockpit-forms-api/door.ts:158` `recap.approve`; `hermes/client-messages/worker.ts:85` `KINDS_2B`, `:683` the body sha check.

### 11.3 Review findings, 2026-11-01 (revision 2)

Thirty-six findings were checked against the live database (read only, 11.2-q and r) and the code.
Applied (each in the section named): canary answers stored `shadow` and kept out of every client-voice
reader (3.3, 3.5, 3.10, 9 D-C5; V29); an Active-only allowlist with no open departure for NPS, CSAT and
pause consent, the exit survey only with a departure or a Stopped card, ineligible invites withdrawn
and refused at display, the gate exempting the exit survey (2.2, 2.3, 3.3, 4.5.4, 5.1; V28); D-C5 waits
for the bot invite and a green notices doctor (1.3, 1.4, 4.5.6, 9, 10); reads `STABLE` without
expiring, expiry by the sweep and write paths, volatility listed (2.3, 3.3, 6.2; V25); message skips
only from `draft`/`approved` (3.3); D-B1's rollback moves the `pause_consent` registry row off native
(9); the low-score ticket link on real `cockpit_requests` columns (3.3, 6.2); the NPS second source on
distinct cards (3.3, 3.5, 6.2); the guardian reads views and tables, not seat RPCs (6.2); forms-door
calls `formsFor` from `onboardingCore.ts` with the exact `--extra` (4.7.2, 9 D0/D-C2); `signer:'none'`
in the v1 enum and `maxAgeDays`/`retryAfterDays` seeded with a missing key refused (2.5, 3.1, 4.3,
4.5.1); the editor freezes type, range, required and option values of read fields and the schema's
audience and signer (4.9.3); the exit survey's registry stays version 1 until go-live and legacy rows
are pinned to the Typeform-shaped version (2.3, 2.4, 2.5, 4.9.2); a CSM's CSAT withdraw is final and
retries are spaced (4.5.4; V26); the 20-hour cap answers `shown_today` with no open invite (3.3); submit
hook failures recorded, answers kept (4.1.2, 6.2, 6.3; V30); the `auth.ts` and `csm_assistant.py`
anchors (4.2.3, 4.11, 11.2-p); CSAT's first WhatsApp try held to day 3 for clients without a portal
session (4.5.4.6); admin-form defaults read admin presence (3.3, 5.1); the minutes line by number,
the singular address rule, "فريق مهارة" (5.5 to 5.8, 5.10; V27); the `exit_survey_due` Today row and
the leaving sheet's button (3.3, 5.3, 5.11); the invite's `lang` on the link page (3.3, 4.2); the link
page's answers draft (4.2.5, 4.2.8); the consent start within 14 days (3.2, 4.3); the Send toast by
delivery (3.3, 5.1); the schedule's from line (3.3, 5.10); the consent row names the signer (4.3, 5.2,
5.3); `p_origin` on `_issue` (3.2, 3.3); one client form per card per run (4.5.4.7); the two plain-copy
lines (3.3, 5.1). The duplicated findings (NPS second source twice, `signer:'none'` twice,
`maxAgeDays` twice) are each applied once.

Rejected, in part, with reasons:
- **Excluding canary answers from `cockpit_pause_consent_for`** (part of the canary finding): kept
  for card `86eywg1cq` only, because D-C2C's read-back needs it and that card is not on the billing
  sheet, so no pause can ever use a canary consent; every aggregate reader excludes them.
- **Allowing pause consent to a Paused card** (offered as optional in the stopped-card finding): not
  taken; the issue hook already refuses a Paused card (`This client is already paused. Resume them
  first.`).
- **Allowing the exit survey on an unanswered termination notice alone** (part of the exit-survey
  finding): not taken; the Notice in band's `Confirm churn`/`Client is leaving` opens the departure,
  and the exit survey then opens, so the CSM confirms who is leaving before the client is asked why.
- **Running issue hooks in a caught sub-block too** (implied by the hook finding): not taken; an
  issue hook is a rule (a Paused card, a bad restart), and swallowing it would issue a form that
  should not go.
- **Replacing `portal_client_ask_for_person`** (the second fix offered for the one-way cap): not
  taken; `portal_form_for_person` answering `shown_today` first keeps a live function unreplaced.

Ownership after the revision is unchanged and disjoint (section 7): the new helpers
(`cockpit_form_card_allows`, `cockpit_form_client_version`, `cockpit_form_invites_withdraw_ineligible`)
are invites-core's in migration `a`; `forms-door/deno.json` stays client-voice's (`forms-door/**`).
