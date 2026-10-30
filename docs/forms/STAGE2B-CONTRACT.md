# Stage 2b build contract: the cut-over machinery for the 1-1 notes, built and deployed dark

Written 2026-10-29 for branch `stage2b-1029` (worktree `forms-1025`), first cut
from origin/main `0889803b`, which holds Stage 2a: `93bbd2d4` and the ticketing
round `404413c1`. **Rebased 2026-10-30 on origin/main `ca8fe4bf`, the base from
here on (Z79).** Main now also holds the sales session's migrations through
`20261029m`, `20261029170000_client_asks`, and the ClickUp Business work
(`224a43f0`, `docs/requests/CLICKUP-DOWNGRADE.md`, live, its migrations
`20261029p` and `20261029q` applied). Of the 139 files
`git diff --name-only 0889803b ca8fe4bf` lists, 11 are in section 7's table
(section 16).

**How to read this.** This contract is binding for every 2b builder. It is
modelled on `docs/forms/STAGE2-CONTRACT.md` (called "2a" below) and builds on
it: 2a's sections 2 to 11 describe what is live, its Amendments A1 to A8 still
hold, and its decisions Y1 to Y60 still hold except where section 15 below
(decisions Z1 onward) says otherwise. Where this contract and 2a section 13
differ, this contract wins; the list of those differences is section 15's
"Supersedes" table. Every claim about code carries `file:line` as read at
`0889803b`, the first base, and the rebase moved some of them; every live number
carries the query that produced it (read only, 2026-10-29, section 16's rebase
row 2026-10-30). Anchors move: find them by content, never by the old line alone.

**The CEO's words** (quote, do not reinterpret), 2026-10-29: "just run it stop
asking make it amazing". So this contract decides every builder question with
the safest default and records it (section 15). Only these stay his, by nature:
B1 and B2 at the cut-over hour, B5 only if G5 fails, B6's answer, and
R4-privacy-4 (2a A7 item 18). Gates that only people can satisfy (G3's five
real shadow runs, G9's three CSM runs, G2's approval of the DEFCON and
priority text, G6's 7 days, G7, G10's A1) are never faked or skipped: 2b is
built and deployed dark, every new writer behind its switch and off, and the
cut-over waits for those gates.

---

## 0. The shape in fifteen lines

1. **2b builds and deploys everything dark; one registry flip at the cut-over hour turns the 1-1 notes live.** The checkin registry stays `typeform` with 8 `shadow` effects until then, and nothing from 2b's new writers reaches a client, a client's ClickUp card, `#client-call-feedback` or a WhatsApp group before it. The one named exception is build 5 (Z19): a live fix to the existing Log a call writer in `cockpit-csm-api`, which from D11 writes the CSM's own Last POC, Last Check-in Call, Next POC and Last report sent as date-only noon Kuwait values (D11 reads the first act back; it has its own rollback).
2. **Eight migrations, `20261029s` to `20261029z`**, in that order: registry and owner gate (`s`, db), ClickUp `form` kind (`t`, writers), check-in notices (`u`, notices), client messages (`v`, notices), effect dispatch (`w`, db), late Typeform check-ins (`x`, db), kickoff and Blueprint records (`y`, db), moving a recording (`z`, db). No new table; every new function is revoked from all four roles and granted exactly as section 2 lists; every file that replaces a live function first proves the live body is the one this contract read (2.1, the drift guard).
3. **One owner gate** (`cockpit_form_effect_gate`, in `s`) is called by every claim, by the WhatsApp sender's intent and by the recap approval: a delivery proceeds only while its effect is queued, owned by `cockpit`, the registry still says `cockpit`, and the response is live and was sent since the registry went native (Z70); otherwise `Make owns this again.`
4. **Nothing becomes `cockpit`-owned before its delivery path exists** (`cockpit_form_delivery_ready`, in `s`); the cut-over function refuses with a sentence that names what is missing.
5. **Effect dispatch** (`w`) turns a live check-in's `cockpit` effects into delivery rows at submit, when a grade or recap draft turns ready, and every minute from the notices kick; three settle triggers move each effect from its outbox's state; kickoff and Blueprint effects are never dispatched (Y49).
6. **The ClickUp writer** gains job `forms` with its own claim, lane per card, kick and cron, behind `CLICKUP_WRITEBACK_APPLY_FORMS` (unset) and the canary `CLICKUP_WRITEBACK_FORMS_ONLY_CARDS`, at 10 calls a minute unless set and one run at a time, inside the shared token's budget of 80 (Z80); it writes the to-do comment, Client Happiness and the two dates forward only by Kuwait day, and reads every write back.
7. **Notices** gain `checkin.grade` (the stored grade, private channel only, tags nobody) and `checkin.recap_late` (#csm-general, 24 hours after the call); both are switched by the registry owner.
8. **`hermes/client-messages`** is the only WhatsApp sender: approve in the cockpit (the text the reviewer saw, checked by `recapRules.ts`), claim, 30 to 120 s wait, the owner gate again at intent, one POST with no retry (its own `sendText`, never the guard's `send`, so no reference line), read back by message id, never resend an `unknown`; behind the registry owner and `CLIENT_MESSAGES_APPLY=false`, read only from `~/.client-messages/switches.env` on the VPS.
9. **The native feed reads the 1-1 notes from the store** (release N4, build 4) first and on its own, with Typeform kept as a live comparator, so G6's 7 days start at once.
10. **`cockpit-csm-api` dates** are fixed live (build 5: `value_options.time false`, read back by Kuwait day); the unknown Last POC writer is found and kept (build 6: the Hermes agent's Next POC sync).
11. **Kickoff and Blueprint responses enter the forms tables** (build 8): `forms-door` (one Typeform route, the kickoff form only, signed) plus a 15-minute sweep in `hermes/csm-calls`; their `cockpit` effects are recorded from the Stage 1 row's outcome, never delivered again.
12. **Late Typeform check-ins** become `checkin_late` by a database trigger, whoever writes, with a `legacy` response and a guardian warning (build 9); impromptu calls without notes show on Today and in a new guardian check (build 10); an admin or the CEO can move a recording to another client by an explicit confirmed gesture behind `forms.move_recording` (build 11).
13. **Parity work:** the brief keeps short to-dos on their side (build 12, G11); They owe recovers client-owed items from Fathom without inventing any (the G3 fix); a read-only gate report (`scripts/dev/forms_gates.py`).
14. **Screens:** a Messages card and Today recap rows, the window's recap step approving once the cockpit owns the recap, impromptu rows on Today, Move it here, two Notices rows, the O1 focus, link and motion fixes, and the window copy that changes at the cut-over, each with a design plan (section 5).
15. **The cut-over hour** (section 11) runs only when G1 to G13 are green and on the CEO's yes for B1 and B2: B1, drain, B2, the store read back, the canary switches set limited, shadow drafts closed and the registry flipped in one owner-run function, the CEO's canary submit, then open to all. Every deploy step and every hour step has a written rollback (section 9, 11.3).

---

## 1. Scope

### 1.1 In 2b (build now, deploy dark)

| Part | Build | Owner | Live effect at deploy |
|---|---|---|---|
| Registry RPC, owner gate, delivery readiness, cut-over time, shadow close, cut-over function | 7 | db (`s`) | none (changes no row) |
| ClickUp `form` kind, job `forms`, claim, release, kick, cron, doctor | 1 | writers (`t`, `clickup-writeback`) | job reports `dry_run`, claims nothing |
| `checkin.grade`, `checkin.recap_late`, the `C09SVG6FHGU` settings row | 2 | notices (`u`, `cockpit-notices`), screens (Notices rows) | nothing can queue while the owner is `shadow` |
| Client messages RPCs and guard, approval op, `hermes/client-messages`, Messages card, Today rows, G5 | 3 | notices (`v`, worker), writers (op), screens | worker in dry mode; no message row can exist |
| Native feed reads the store (N4) | 4 | worker | reader only; cadence equal 19 of 19 today |
| `cockpit-csm-api` date fix | 5 | writers | live (a fix to an existing writer, Z19) |
| The unknown Last POC writer | 6 | writers (docs) | none |
| Effect dispatch, settle triggers, effects sweep and kick, forms-api `effects.sweep` | 0 | db (`w`), writers (op) | sweep finds nothing |
| Kickoff and Blueprint records, `forms-door`, the record sweep, B3 | 8 | db (`y`), worker | records only, no delivery |
| Late Typeform check-ins | 9 | db (`x`), worker | trigger inert while the provider is `typeform` |
| Impromptu calls without notes | 10 | screens, worker (guardian) | rows dark until the flip |
| Move a recording | 11 | db (`z`), writers (door), screens | switch `forms.move_recording` off |
| The brief's short to-dos | 12 | parity | live on ship (a reader fix) |
| They owe from Fathom (G3 fix) | G3 | parity (`todos.ts`, replay), writers (`TODOS_VERSION`) | drafts only; no live draft exists |
| O1 design follow-ups | O1 | screens | visual only |
| Window copy at the cut-over | copy | screens | keyed on the registry and the response mode |
| Gate report `scripts/dev/forms_gates.py`, fit and ownership tests, ship block, readiness list | all | parity | none |

### 1.2 Not in 2b

- The cut-over hour itself (section 11) and every CEO switch (B1, B2, and B5 if needed).
- Cut-over step "links" (2a section 13 step 8): removing the Typeform links is built and shipped in a short follow-up session after the hour, from the exact file list in section 11.4 (Z39).
- The D17 form editor screen; Stage 3 forms; kickoff and Blueprint recaps and the phase 5 tap (they stay `shadow` and are recorded `skipped` by build 8).
- Changing A7.14 rule 1 (R4-privacy-4 stays the CEO's; section 12).
- Any change to `hermes/ad-billing-guard/*` (read and imported only), `viktor-side-scripts/*`, or the Hermes agent's jobs on the VPS.

### 1.3 What only people can do (never faked)

| Gate | What a person does | Who |
|---|---|---|
| G2 | Approve the DEFCON and priority definitions of `checkin.defcon_priority.v1`; three shadow runs with ready drafts | the CSM or the CEO |
| G3 | Five real shadow runs on calls the CSM also noted in Typeform | admins or the CEO |
| G6 | Seven clean days of N4 | time |
| G7 | One real kickoff notice and one real Blueprint notice posted | real client events |
| G8 | Answer B6 | the CEO |
| G9 | Three shadow runs on real calls; the CEO reads them | the CSM, then the CEO |
| G10 | The first native Blueprint close settles `done`, then A1 (already approved 2026-10-26, HANDOVER.md section 4) | a real client event, then the session |

### 1.4 The switches (every new writer, its switch and its state at deploy)

| Writer | Switch | Where | At deploy | Turned on |
|---|---|---|---|---|
| All check-in deliveries (dispatch, grade, recap, ClickUp form rows) | `cockpit_forms` `checkin`: `provider` and each effect's `owner` | database row | `typeform`, all 8 `shadow` | cut-over step 7, by `cockpit_form_checkin_cutover()` (owner-run, Z33) |
| ClickUp writer job `forms` | `CLICKUP_WRITEBACK_APPLY_FORMS` exactly `true`; canary `CLICKUP_WRITEBACK_FORMS_ONLY_CARDS` | function secrets | unset (mode `dry_run`) | step 6 limited to `86eywg1cq`, step 9 open (Z32) |
| WhatsApp sender | `CLIENT_MESSAGES_APPLY` exactly `true`; `CLIENT_MESSAGES_ONLY_CARDS`; `CLIENT_MESSAGES_KINDS` | `~/.client-messages/switches.env` on the VPS, and only there (never from a shared env file, Z60) | `false`, empty, `recap_checkin` | step 6 limited, step 9 open |
| Call grade post | the registry owner of `grade_notice`, and the owner gate passes nothing unless the provider is `native` (Z70); Settings > Notices and routing > Call grade is the kill switch | database | owner `shadow`; the row seeded enabled (Z25) | step 7 |
| Recap reminder | the registry owner of `recap` | database | `shadow` | step 7 |
| Move it here | `cockpit_settings` key `forms.move_recording` `{"on":false}`; every change of a `forms.%` key writes an audit row by trigger (`z`, Z62) | database row | off | step 9 (Z34) |
| Moving to native at all | `cockpit_form_registry_apply` moves the checkin provider to `native` only with `via = 'cutover'` (Z54) | database function | no seat can | step 7b only |
| Impromptu rows, the window's approval step, no-Typeform nudges | follow the registry (`entry.native`, the effect's `owner`) | code | dark | step 7 |
| Kickoff and Blueprint records (build 8) | none: internal records, never a delivery | | live | |
| N4 (build 4), build 5, build 12 | none: a reader, a fix, a reader | | live | |

---

## 2. The migrations

### 2.1 Names and order

The live database holds `20261029a` to `20261029j`, `20261029l` and `20261029m`
(sales), `20261029170000_client_asks`, `20261029p` and `20261029q` (the ClickUp
Business work, applied `20261029201711` and `20261029201716`) and 2a's
`20261027f/g/h` (applied `20261029135744` to `20261029135753`); origin/main
`ca8fe4bf` holds the same files, and no other local or remote branch holds a
name from `20261029r` on (query and sweep in section 16, re-read 2026-10-30).
2b takes the block `s` to `z` on `20261029` (Z1):

| Order | File | Owner | Holds |
|---|---|---|---|
| 1 | `supabase/migrations/20261029s_forms_registry.sql` | db | build 7, the owner gate, delivery readiness, `provider_since`, shadow close, the cut-over function |
| 2 | `supabase/migrations/20261029t_forms_clickup_writeback.sql` | writers | build 1's SQL |
| 3 | `supabase/migrations/20261029u_forms_checkin_notices.sql` | notices | build 2's SQL, and the one replacement of `cockpit_slack_notices_kick` |
| 4 | `supabase/migrations/20261029v_forms_client_messages.sql` | notices | build 3a's SQL |
| 5 | `supabase/migrations/20261029w_forms_dispatch.sql` | db | build 0 |
| 6 | `supabase/migrations/20261029x_forms_late_typeform.sql` | db | build 9's SQL |
| 7 | `supabase/migrations/20261029y_forms_records.sql` | db | build 8's SQL |
| 8 | `supabase/migrations/20261029z_forms_move_recording.sql` | db | build 11's SQL |

**The letter rule.** Before any builder starts and again before every apply,
the orchestrator reads `select name from supabase_migrations.schema_migrations
where name like '20261029%' or name like '20261030%'`, `git ls-tree --name-only
origin/main supabase/migrations/` and every branch (`git for-each-ref` then
`git ls-tree <ref> supabase/migrations/`). If any of `s` to `z` is taken, the
whole block moves to the next free consecutive letters on the next free date,
same order, and this table is amended before builders start; builders never
rename a migration. Every file starts `BEGIN;`, ends `NOTIFY pgrst, 'reload
schema'; COMMIT;`, applies twice without error, and is `LANGUAGE plpgsql` for
any function that names an object of a later file (2a section 2, "Function
language across files").

**Names in tests.** A single letter in prose (`s`, `t`, ...) means the 2b file
of that letter. In every test file, test list, fit test and ship command the
2b files are written by their full stem (`20261029s_forms_registry.sql`, or
`20261029s` at least), never by the bare letter, because the 2a base list
holds `20261026s` and `20261026t` (E14 of the critique notes).

**The drift guard** (Z61). Each of `t`, `u`, `v`, `w` and `y` opens, right
after `BEGIN;`, with one `DO` block that, for every function of section 2.2 it
replaces, reads `md5(regexp_replace(p.prosrc, '\s+', ' ', 'g'))` and raises
`55000` `<function> changed since the 2b contract read it; stop and re-read it.`
unless the value equals that function's "live body md5" (2.2) or its "after"
value (the same md5 of the body this file installs, written into the file by
its builder and asserted by the fit test). `prosrc` is the literal body text,
so the check runs the same in PGlite and in production, and a second apply
passes on the "after" value. The deploy's own md5 check (section 9) stays as
the human-readable second source.

**Row security and grants.** 2b creates no table. It adds one column
(`cockpit_forms.provider_since`, a table with row security on and no browser
grant, 2a 2.1), widens CHECKs, adds functions, triggers, indexes, one pg_cron
job and seed rows. Every new or replaced function is first revoked from
`PUBLIC, anon, authenticated, service_role`, then granted exactly as the
tables below say; "none" means only the owner (`postgres`) runs it. Every
service function calls `public.cockpit_hours_require_service()` first; every
browser function runs its gate first.

### 2.2 Functions 2b replaces (one owner each; save `pg_get_functiondef` first)

The deploy saves each body to `/Users/abdulazizwaheedi/mahara-cockpits/notes/stage2/deploy/before-2b-<name>.sql`
and stops if the live `md5(pg_get_functiondef(oid))` differs from this table
(read 2026-10-29, re-read the same evening with no change, query in section
16). "Live body md5" is `md5(regexp_replace(prosrc, '\s+', ' ', 'g'))`, the
value the drift guard (2.1) checks inside each file. Every function below is
`SECURITY DEFINER`, and its replacement keeps exactly the ACL shown (`auth` =
`{postgres=X/postgres,authenticated=X/postgres}`, `svc` =
`{postgres=X/postgres,service_role=X/postgres}`, `owner` =
`{postgres=X/postgres}`), asserted by the owning PGlite suite, the fit test and
the D4 to D9 read-backs. No other 2b file may replace these.

| Function | Live md5 (`pg_get_functiondef`) | Live body md5 (`prosrc`) | ACL | Replaced by | Change |
|---|---|---|---|---|---|
| `cockpit_form_submit(uuid,integer)` | `d41c703b0291e7085eb890e0a18e4b8f` | `fb609612258ad0d547b8fdfa4c0c91c7` | auth | `w` | one line (build 0) |
| `cockpit_form_effects_guard()` | `73a0e95547061981695783ef38bec975` | `c981fe2cbc92a24ee393b974952de98f` | owner | `w` | two moves (build 0, build 8) |
| `cockpit_slack_notices_kick()` | `32c11d4b2d79cfea8495e5755df692ba` | `49fd012b2325fbaeae9d28b7ea268dd1` | owner | `u` | two guarded calls at the top |
| `cockpit_slack_notice_claim(integer,uuid)` | `ecb3f3b1109ee9f57f144a14175387f6` | `b415014351f4aa144aa845cbabf6cec0` | svc | `u` | step 1b's coalesce, steps 1c, 1d |
| `cockpit_slack_notice_live(cockpit_slack_notices)` | `a1681f472113a0db80f7761fea28232b` | `3644e7cd5eb63c7719fd5ff3666a8d84` | owner | `u` | two kinds |
| `cockpit_slack_notice_shape(text)` | `3bc6a6adc1616342fd97e822fd7ff55a` | `4c02edfc21ceaa750e57f5cea8c9e547` | owner | `u` | two kinds |
| `cockpit_slack_notice_kind_label(text)` | `acc4ccf887595cc1b527934da36a0dda` | `499725dbaac9baf12f000161438c63d7` | owner | `u` | two labels |
| `cockpit_slack_notice_inputs(jsonb)` | `561cf1d600ab9103810679f6ae72839b` | `b4c826e37e783201fb3d777e5309b902` | svc | `u` | kind list |
| `cockpit_slack_notice_doctor_inputs()` | `edbd1e0e3d83f125e037d9e1327b9455` | `0a5c57a07e31ab08c7259dcb8f3d18f4` | svc | `u` | order list |
| `cockpit_slack_notice_settings_read()` | `3db9cc0a0353a1de9ebb84c9afd05d4e` | `a6cf20c2d9129b5716de6cda89f4192d` | auth | `u` | order list |
| `cockpit_slack_notice_settings_set(text,jsonb)` | `440def548ae02e6dc032cdbad91d006b` | `80e2a814b671a43e0e78fe95788db934` | auth | `u` | Call grade rules |
| `cockpit_slack_channel_remove(text)` | `b136427306fd9d711a400333433a0e0a` | `1b21f1b259844b485b132f0a331bb97d` | auth | `u` | order list, refusal |
| `cockpit_slack_notice_rehearse(text)` | `59b7cbb3351c9dd6155f9bb339bb4df9` | `b8264c6a7f918e76a56bf750ab46ecec` | auth | `u` | kind list |
| `cockpit_slack_notice_rehearse_service(text,text)` | `99f3cc3631f2fd62b99d23bc89716b1c` | `036e4ea0b8088ff3b259b229ef79a0ec` | svc | `u` | kind list |
| `cockpit_slack_notice_read(text)` | `5dbd5f56294200a05d7291bcffeaeeee` | `4ae835e5809a599d0e4af167b8153dc0` | auth | `u` | check-in kinds hidden from creative-only seats |
| `cockpit_clickup_writeback_claim(uuid,integer)` | `c03cf07abeb599f886a1000d5fa9acdc` | `39c142839f9d669354e9b0d0b6079842` | svc | `t` | excludes `form` |
| `cockpit_clickup_writeback_release(uuid,uuid,jsonb,text,timestamptz)` | `d0698ae1bd3efa11d1099610b00ffe2d` | `7329848a1ef67391a962c68b5ef67fd3` | svc | `t` | accepts `form` |
| `cockpit_clickup_writeback_begin(text,text,boolean)` | `30b42c7217b158dd34b8c043b4fbb562` | `29906b33362f9cbcacd591e70071c0fa` | svc | `t` | job `forms` |
| `cockpit_clickup_writeback_idle(text,boolean,text)` | `aa46a8dddf472bac1a155ceac54b60e1` | `e67840b5b981fe6fc5eca237a351c55c` | svc | `t` | job `forms` |
| `cockpit_client_messages_guard()` | `af9348650bd7be4bb5e3ed1276974d78` | `6a0fe60fee0be51c3d22ddcd28986bdb` | owner | `v` | four moves, the fingerprint rule |
| `cockpit_forms_key_put(jsonb)` | `3be1b3a3d4ca0c20b3caaee9df1c6c44` | `68763f4ab3de37be2fe538bc80155a43` | svc | `y` | the `typeform_kickoff` key |
| `cockpit_forms_key_mark(jsonb)` | `d3e53fa6ea28fc3705a71da3b3bc1fed` | `db3c2859624bdbb75b43bf7de85f2672` | svc | `y` | accepts `typeform_kickoff` (its live list refuses it, `20261027g_fathom_intake.sql:510-511`) |
| `cockpit_forms_key_label(text)` | `c599e7b107364ff7becd9201ec42e17c` | `5f01adc978c71ba5b7834b6083ea0b93` | owner | `y` | its label |
| `cockpit_forms_keys_status()` | `b499b0546d7cc667f97cb88a8f66dcac` | `5ecbb4ae9493c0ef1c6f14cc78c84e12` | auth | `y` | a separate top-level `typeform` list; `keys` unchanged (Z57) |

**Body-diff rule.** Each owning PGlite suite proves, per replaced function,
that the installed body equals the canonical migration's body (the file cited
for it in 2.2's sections and in build text) with exactly the edits this
contract states, each written in the test as a literal before/after pair of
lines; whitespace is normalised as the drift guard does. "Expected body" in the
fit test (section 8) means the function's text in its owning 2b file.

**Not replaced by any 2b file:** `cockpit_form_checkin_value`,
`cockpit_csm_attach_recording` and `cockpit_form_apply_sql_effects` (build 11
is a separate RPC, Z16), `cockpit_form_open`, the planner (`20261027h`).

### 2.3 `20261029s_forms_registry.sql` (db)

| Object | Kind | Grant | Notes |
|---|---|---|---|
| `cockpit_forms.provider_since timestamptz` | column, `ADD COLUMN IF NOT EXISTS`, no backfill | (table: row security on, no browser grant, unchanged) | a backfill UPDATE would fire the 2a audit trigger three times; NULL reads as "since the seed" |
| `cockpit_forms_provider_since()` + trigger `cockpit_forms_provider_since` `BEFORE UPDATE OF provider ON cockpit_forms FOR EACH ROW WHEN (OLD.provider IS DISTINCT FROM NEW.provider)` | trigger function | none | `NEW.provider_since := now()`; the same statement's 2a audit row is its second source (Z13) |
| `cockpit_form_registry_view(cockpit_forms)` | function | none | `{key, title, provider, typeformId, version, effects[{key, owner, delivery, label}], updatedAt, nativeSince}`; no address (no `updatedBy`) |
| `cockpit_form_registry_set(p_form_key text, p_patch jsonb)` | browser RPC | `authenticated` | build 7 |
| `cockpit_form_registry_apply(p_form_key text, p_patch jsonb, p_actor jsonb)` | function | none | build 7 |
| `cockpit_form_effect_owner(p_form_key text, p_effect_key text)` | function, `STABLE` | none | the registry's current owner, or NULL |
| `cockpit_form_effect_gate(p_delivery text, p_ref text)` | function, `STABLE` | none | section 3.1 |
| `cockpit_form_delivery_ready(p_form_key text, p_effect_key text)` | function, `STABLE` | none | section 3.2 |
| `cockpit_form_native_since(p_form_key text)` | function, `STABLE` | none | `CASE WHEN provider = 'native' THEN coalesce(provider_since, updated_at) END` |
| `cockpit_form_shadow_close(p_form_key text)` | function | none | voids every `form_key = p AND state = 'draft' AND mode = 'shadow'` row with `cockpit.forms_action = 'forms.shadow_closed'` (the guard allows draft to void, `20261027f_forms_core.sql:426-430`); credited to `cut-over` / `cutover` when the caller named no actor or source (Z81); returns the count |
| `cockpit_form_checkin_cutover()` | function | none | cut-over step 7b: closes the shadow drafts again and flips the registry, in one transaction (section 11) |

### 2.4 `20261029t_forms_clickup_writeback.sql` (writers)

| Object | Kind | Grant |
|---|---|---|
| `cockpit_clickup_writeback_queue_kind_check` gains `'form'` (guarded by `pg_get_constraintdef NOT LIKE '%''form''%'`, as `20261026r_requests.sql:247-256`) | CHECK | (table unchanged) |
| `cockpit_clickup_writeback_runs_job_check` gains `'forms'` | CHECK | |
| `cockpit_clickup_writeback_claim(uuid,integer)` replaced: `AND q.kind NOT IN ('request','task_action','form')`, otherwise the live body | function | `service_role` |
| `cockpit_clickup_writeback_release(...)` replaced: also `form` rows (queued, or retry when `progress.steps` holds anything), attempts minus one; the refusal text for other kinds word for word (asserted at `requests-supabase.test.ts:4485`) | function | `service_role` |
| `cockpit_clickup_writeback_begin`, `_idle` replaced: `forms` in their job lists | function | `service_role` |
| `cockpit_clickup_forms_mode()` | function (copy of `cockpit_clickup_requests_mode`, `20261026r:1132-1150`, key `clickup-writeback:forms`; `unknown` after 15 minutes) | none |
| `cockpit_clickup_forms_state(p_ok boolean, p_note text, p_mode text, p_only_cards text[], p_counts jsonb)` | function; 22023 on a mode other than `dry_run`, `apply_limited`, `apply` | `service_role` |
| `cockpit_clickup_writeback_claim_forms(p_token uuid, p_limit integer DEFAULT 8)` (max 12) | function | `service_role` |
| `cockpit_clickup_forms_doctor_inputs()` | function | `service_role` |
| `cockpit_clickup_forms_kick()` | function (copy of `requests_kick`, `20261026r:1247-1282`; posts `{"job":"forms"}` with `x-cron-secret` from vault `cockpit_sync_secret`) | none |
| index `cockpit_clickup_writeback_form_lane ON cockpit_clickup_writeback_queue (task_id, created_at) WHERE kind = 'form' AND state IN ('queued','sending','retry','unknown')` | index | |
| pg_cron `mahara-clickup-writeback-forms` `* * * * *` `SELECT public.cockpit_clickup_forms_kick()`, unscheduled then scheduled, only where `cron.job` exists | cron job | |

### 2.5 `20261029u_forms_checkin_notices.sql` (notices)

| Object | Kind | Grant |
|---|---|---|
| `cockpit_slack_notice_settings_kind_check` and `cockpit_slack_notices_kind_check` gain `checkin.grade`, `checkin.recap_late` | CHECK | |
| `cockpit_slack_notice_settings_check` becomes `CHECK ((kind IN ('kickoff','blueprint.close','blueprint.media','checkin.grade','checkin.recap_late')) = (channel IS NOT NULL))` (live text at `20261025n_slack_notices.sql:67`) | CHECK | |
| `INSERT INTO cockpit_slack_channels (id, name, private, state, note, added_by) VALUES ('C09SVG6FHGU','client-call-feedback',true,'checking','Checking that mahara-club-bot is in it.','migration') ON CONFLICT (id) DO NOTHING` | seed (a no-op live, where the row is `ok` and private) | |
| settings rows `('checkin.grade', true, 'C09SVG6FHGU', '{}', 'migration')` and `('checkin.recap_late', true, 'C09RZ0GS0V9', '{}', 'migration') ON CONFLICT (kind) DO NOTHING`, each insert that happened followed by one `cockpit_audit_log` row `notices.setting_seeded` (entity `cockpit_slack_notice_settings` / kind, after `{kind, enabled, channel}`, actor `migration`), found by `INSERT ... RETURNING` inside a `DO` block, so a second apply writes none | seed | |
| the thirteen notice functions of section 2.2 replaced (build 2) | functions | each keeps its live ACL (2.2) |
| `cockpit_slack_notice_sweep_checkin()` | function | none |

### 2.6 `20261029v_forms_client_messages.sql` (notices)

| Object | Kind | Grant |
|---|---|---|
| `cockpit_client_messages_guard()` replaced (build 3a) | trigger function | none |
| indexes `cockpit_client_messages_open (state, updated_at) WHERE state IN ('draft','approved','claimed','sending','unknown','refused')`, `cockpit_client_messages_task (task_id, created_at DESC)`, `cockpit_client_messages_response (response_id)` | indexes | |
| `cockpit_client_message_view(cockpit_client_messages)` | function | none |
| `cockpit_client_messages_read(p_task_id text)`, `cockpit_client_messages_waiting()`, `cockpit_client_message_read(p_id uuid)`, `cockpit_client_message_skip(p_id uuid, p_reason text)`, `cockpit_client_message_reopen(p_id uuid)` | browser RPCs | `authenticated` |
| `cockpit_client_message_approve(p_id uuid, p_body text, p_body_sha256 text, p_actor uuid, p_warnings text[]) RETURNS jsonb` (the stored row's `cockpit_client_message_view`, 3.7), `cockpit_client_message_claim(p_kinds text[], p_only_cards text[] DEFAULT NULL, p_limit integer DEFAULT 1)`, `cockpit_client_message_intent(p_id uuid, p_claim uuid)`, `cockpit_client_message_result(p_id uuid, p_claim uuid, p_outcome text, p_provider_id text, p_reason text, p_read_back jsonb)`, `cockpit_client_message_sweep()`, `cockpit_client_message_work(p_limit integer)`, `cockpit_client_message_fix(p_id uuid, p_what text, p_note text)`, `cockpit_client_message_team_today(p_task_id text)` | service RPCs | `service_role` |

### 2.7 `20261029w_forms_dispatch.sql` (db)

| Object | Kind | Grant |
|---|---|---|
| `cockpit_form_dispatch(p_response_id uuid)` | function | none |
| `cockpit_form_submit(uuid,integer)` replaced: the live body plus `PERFORM public.cockpit_form_dispatch(r.id);` after the adoption loop and before step 12 (`20261027f_forms_core.sql:1690-1710`) | function | keeps `authenticated` |
| `cockpit_form_effects_settle(p_delivery text, p_ref text, p_target text, p_reason text, p_receipt jsonb, p_fix boolean)` | function, never raises | none |
| triggers `cockpit_form_effects_from_queue` (on `cockpit_clickup_writeback_queue`, `AFTER UPDATE OF state ... WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.kind = 'form')`), `cockpit_form_effects_from_notices` (on `cockpit_slack_notices`, `... AND NEW.kind = 'checkin.grade'`), `cockpit_form_effects_from_messages` (on `cockpit_client_messages`, `... AND NEW.kind = 'recap_checkin'`) and their three trigger functions | triggers | none |
| `cockpit_form_effects_guard()` replaced | trigger function | none |
| trigger `cockpit_form_drafts_dispatch` `AFTER UPDATE OF state ON cockpit_form_drafts ... WHEN (OLD.state = 'drafting' AND NEW.state IS DISTINCT FROM 'drafting' AND NEW.kind IN ('grade','recap'))` | trigger | none |
| `cockpit_form_effects_sweep()` | function | none |
| `cockpit_form_effects_kick()` | function | none |
| `cockpit_form_effects_waiting_rows()` | function, `STABLE`; 4.0 item 8's read, with the registry's owner (Z71) | none |
| `cockpit_form_effects_waiting()` | service RPC | `service_role` |
| `cockpit_form_drafts_service(p_response_id uuid)` | service RPC: `cockpit_hours_require_service()`, then exactly `cockpit_form_drafts_read`'s answer `{recordingId, drafts, now}` with no seat gate (`cockpit_form_drafts_for(r)`, `20261027f_forms_core.sql:1296`); the effects sweep's drafts reader (Z56) | `service_role` |
| `cockpit_form_effect_note(p_id uuid, p_reason text)` | function: sets `reason` only when it differs, and then writes one `cockpit_audit_log` row `forms.effect_reason` (before/after `{reason}`, metadata `{effectId, responseId, state}`), because the 2a effects audit fires only on `UPDATE OF state` (`20261027f_forms_core.sql:561-562`) (Z53) | none |
| index `cockpit_form_effects_delivery_ref ON cockpit_form_effects (delivery, delivery_ref) WHERE delivery_ref IS NOT NULL` | index | |

### 2.8 `20261029x_forms_late_typeform.sql` (db)

| Object | Kind | Grant |
|---|---|---|
| `cockpit_csm_call_forms_form_kind_check` re-added with `ARRAY['checkin','onboarding','kickoff','kickoff_old','blueprint','checkin_late']`, guarded by `pg_get_constraintdef NOT LIKE '%checkin_late%'` | CHECK | |
| `cockpit_csm_call_forms_late()` + trigger `BEFORE INSERT OR UPDATE OF form_kind, submitted_at, form_id, linked_call_id ON cockpit_csm_call_forms` | trigger | none |
| `cockpit_csm_call_forms_legacy()` + trigger `AFTER INSERT OR UPDATE OF task_id, form_kind ON cockpit_csm_call_forms FOR EACH ROW WHEN (NEW.form_kind = 'checkin_late' AND NEW.task_id IS NOT NULL)` | trigger | none |

### 2.9 `20261029y_forms_records.sql` (db)

| Object | Kind | Grant |
|---|---|---|
| `cockpit_forms_keys` provider CHECK also accepts the one literal `'typeform_kickoff'` (live list `fathom|fathom_webhook|anthropic|deepseek`, `20261027g_fathom_intake.sql:233`); no pattern, so no other form's key can be saved in 2b (Z58) | CHECK | (table unchanged, no grant) |
| `cockpit_forms_key_put`, `cockpit_forms_key_mark`, `cockpit_forms_key_label`, `cockpit_forms_keys_status` replaced (build 8) | functions | keep their live ACLs (2.2) |
| `cockpit_form_record_typeform(p jsonb)` | service RPC; `formKey` must be `kickoff` | `service_role` |
| `cockpit_form_record_sweep(p_apply boolean DEFAULT true)` | service RPC | `service_role` |
| `cockpit_forms_door_seen(p_form_key text, p_outcome text, p_reason text)` | service RPC; `p_form_key` must be `kickoff`; `p_outcome IN ('recorded','repeat','ignored','probe','unsigned','failed')`, else 22023 | `service_role` |

### 2.10 `20261029z_forms_move_recording.sql` (db)

| Object | Kind | Grant |
|---|---|---|
| `cockpit_settings_forms_audit()` + trigger `cockpit_settings_forms_audit AFTER INSERT OR UPDATE OR DELETE ON cockpit_settings FOR EACH ROW` (created before the seed): returns at once unless `coalesce(NEW.key, OLD.key) LIKE 'forms.%'`; else one `cockpit_audit_log` row, action `forms.switch_seeded` (insert), `forms.switch_set` (update) or `forms.switch_removed` (delete), entity `cockpit_settings` / key, before/after `value`, actor `coalesce(current_setting('cockpit.audit_actor', true), NEW.updated_by, current_user)`, source `supabase`. Live, `cockpit_settings` grants `service_role` full write (`arwdDxtm`) and has no trigger, so without this a switch could be turned on through REST with no row (Z62) | trigger | none |
| `INSERT INTO cockpit_settings (key, value, updated_by) VALUES ('forms.move_recording', '{"on":false}', 'migration') ON CONFLICT (key) DO NOTHING`; the trigger writes `forms.switch_seeded` only when the insert happened | seed (table `20260921a_cockpit_settings.sql:15-25`, row security on, no browser grant) | |
| `cockpit_forms_switch(p_key text)` | service RPC, `STABLE`: `coalesce((value->>'on')::boolean, false)` for key `'forms.' || p_key`; a missing row reads false | `service_role` |
| `cockpit_csm_move_recording(p_recording_id text, p_task_id text)` | browser RPC | `authenticated` |

---

## 3. Shapes every role builds to

Build to these shapes, never to another builder's code. Every sentence in
backticks is word for word.

### 3.1 The owner gate: `cockpit_form_effect_gate(p_delivery text, p_ref text) RETURNS jsonb` (db, `s`)

Answer: `{ok boolean, effectId uuid|null, responseId uuid|null, formKey text|null, effectKey text|null, effectState text|null, reason text|null}`.

It reads every `cockpit_form_effects` row with `delivery = p_delivery AND
delivery_ref = p_ref` (index of `w`; before `w` a sequential read of an empty
table). An effect **passes** when `state IN ('queued','unknown')`,
`owner = 'cockpit'`, `cockpit_form_effect_owner(form_key, effect_key) =
'cockpit'`, its response's `mode = 'live'`, and its response's `submitted_at` is
at or after `cockpit_form_native_since(form_key)` (Z70). A NULL `since` never
passes: `cockpit_form_native_since` is NULL unless the provider is `native`, so
nothing passes while the provider is `typeform`, whatever an effect's owner says.
In order:

| Case | ok | reason |
|---|---|---|
| no effect points at it | false | `No 1-1 notes effect points at this write, so nothing was written.` |
| one passes (a `queued` one before an `unknown` one, then the oldest) | true | null |
| every one is `delivered`, `skipped`, `failed` or `dry_run` | false | `This write was settled in the cockpit, so nothing was written.` |
| otherwise (owner, registry, mode or send time) | false | `Make owns this again.` |

Callers and what they do on `ok = false` (the settle triggers of 3.6 then move
the effect; a caller never updates `cockpit_form_effects` itself):

| Caller | Delivery row on refusal |
|---|---|
| `cockpit_clickup_writeback_claim_forms` (`t`) | `skipped` with the reason; but `failed` with `Make owns this again. An earlier try may have reached the card, so check it in ClickUp.` when the reason is `Make owns this again.` and either `effectState = 'unknown'` or `progress.steps` holds a started or done step (Z74). It settles every open row the gate refuses, in every mode, before its mode check (4.1) |
| `cockpit_slack_notice_claim` for `checkin.grade` (`u`) | `skipped` with the reason |
| `cockpit_client_message_approve` (`v`) | nothing written; raises 22023. For `Make owns this again.`: `This recap is from before the latest switch-over, so it is not sent from here. Press Skip.` while the registry is native and the response predates `cockpit_form_native_since` (Z72), else `Make still sends 1-1 recaps until the switch-over, so this one is not sent from here.` For any other reason: the reason |
| `cockpit_client_message_claim` (`v`) | `skipped` with the reason |
| `cockpit_client_message_intent` (`v`), again just before the POST (Z66) | `claimed` back to `approved` (allowed, `20261027f_forms_core.sql:531`); nothing is posted; the next claim's gate settles it `skipped` with the reason |

### 3.2 Delivery readiness: `cockpit_form_delivery_ready(p_form_key text, p_effect_key text) RETURNS text` (db, `s`)

NULL means ready; otherwise the missing piece as a clause that completes
`{label} cannot move to the cockpit yet: {clause}.` By the effect's delivery:

| Delivery | Ready when (all) | Clause when not |
|---|---|---|
| `sql` | always | |
| any other | `to_regprocedure('public.cockpit_form_dispatch(uuid)') IS NOT NULL` | `the effect dispatch is not installed` |
| `clickup_queue` | `'form'` in `pg_get_constraintdef` of `cockpit_clickup_writeback_queue_kind_check`; `to_regprocedure('public.cockpit_clickup_writeback_claim_forms(uuid,integer)') IS NOT NULL` | `the ClickUp writer has no 1-1 notes lane` |
| `slack_notice` | `'checkin.grade'` in `cockpit_slack_notices_kind_check`; a `cockpit_slack_notice_settings` row `checkin.grade` with `enabled` and a channel whose `cockpit_slack_channels` row is `state = 'ok' AND private` | `the Call grade notice has no ready private channel` |
| `client_message` | `to_regprocedure('public.cockpit_client_message_approve(uuid,text,text,uuid,text[])')` and `to_regprocedure('public.cockpit_client_message_claim(text[],text[],integer)')` are not NULL | `the recap approval is not installed` |

### 3.3 The ClickUp queue row a check-in effect becomes (db writes it in `w`; writers read it in `t` and the function)

```text
dedupe_key   = effect.dedupe_key                     -- '{response_id}:{effect_key}', no prefix
kind         = 'form'
source_table = 'cockpit_form_effects'
source_id    = effect.id::text
task_id      = response.task_id
payload      = {formKey: 'checkin', responseId, effectId, effectKey, taskId, clientName}
               || (effect.plan - 'lines' - 'comment_text')
               || {commentChars, commentSha256}      -- only when the plan has comment_text
```

The payload never carries the comment text (Z6): `cockpit_clickup_writeback_audit`
copies every payload into `cockpit_audit_log` and strips text only for
`task_action` (`20261026t_task_alerts.sql:678-695`). The writer reads the text
from `effect.plan` through `claim_forms` (it returns `{effect: {id, state, plan:
plan - 'lines'}}`), checks `sha256(plan.comment_text) = payload.commentSha256`,
and freezes the text in the queue row's `steps` column before its first write.
The text lives only in `steps` (which the queue audit strips with `planned`,
`20261026t_task_alerts.sql:681-683`); `progress.steps` holds each step's state
and ids, never text, because the audit copies `progress` whole. Effect order on a card:
`todo_comment`, `happiness`, `last_poc`, `last_checkin_call` (Make's order, the
comment as Make [17] before the fields as [21]). Live dedupe keys all carry a
word prefix (`action:`, `billing:`, `decision:`, `manual:`, `request:`, `task:`,
`tracking-backlog:`, `verify:`; `select split_part(dedupe_key,':',1), kind,
count(*) from cockpit_clickup_writeback_queue group by 1,2`, 2026-10-29), so a
uuid-led key cannot collide.

### 3.4 The grade notice row (db writes it in `w`; notices read it in `u` and `cockpit-notices`)

```text
public.cockpit_slack_notice_queue('checkin.grade', 'grade:' || recordingId, taskId, clientName,
  facts := {responseId, recordingId, draftId, taskId, effectId, client, submittedAt},
  NULL, 'queued', NULL)
```

`submittedAt` is the response's `submitted_at` (the claim's 48-hour rule reads
it, `20261025n_slack_notices.sql:1239-1253`). `draftId` is the ready grade
draft. Facts carry ids and times only: the sender's claim reads the grade
itself through `cockpit_slack_notice_live` by `facts.draftId` (3.12, build 2).
When the queue returns NULL (the dedupe key exists, `20261025n:439-451`), the
effect's `delivery_ref` is that existing row's id, found by its dedupe key, and
the effect settles at once if that row is already final.

### 3.5 The client message row (db writes it in `w`; notices read it in `v` and the worker; screens show it)

```text
dedupe_key   = effect.dedupe_key            -- '{response_id}:recap'
task_id, client_name                       -- the response's
kind         = 'recap_checkin'
response_id  = response.id
draft_id     = the newest ready recap draft WHERE response_id = response.id
body         = that draft's text, byte for byte
body_sha256  = encode(pg_catalog.sha256(convert_to(body, 'UTF8')), 'hex')
state        = 'draft', expires_at NULL
```

A draft text that is NULL, empty or over 4,096 characters fails the effect
(`planned` to `failed`) with `The recap draft is empty or over 4,096
characters. Draft it again.`; it is never cut.

### 3.6 Settling an effect from its outbox (db, `w`)

`cockpit_form_effects_settle` updates every effect with `delivery = p_delivery
AND delivery_ref = p_ref` whose move is legal; it never raises: an illegal move
writes one `cockpit_audit_log` row `forms.settle_refused` (before/after the two
states, metadata `{delivery, ref}`) and leaves the effect as it was. The reason
is the outbox's error or reason, cut to 240 characters; the receipt is
`{table, id, state, at}` plus, for a posted grade, `{channel, ts}` and for a
delivered ClickUp row `{step: progress.steps[effectKey]}`. It runs with
`cockpit.forms_action = 'forms.effect_settled'` and `cockpit.audit_source` set
to the outbox's writer (`clickup-writeback`, `cockpit-notices`,
`client-messages`).

| Outbox move | Effect move | Reason |
|---|---|---|
| queue to `delivered` | `delivered` | |
| queue to `failed` / `skipped` | `failed` / `skipped` | the queue's `error` |
| queue to `unknown` | `unknown` (from `queued`) | the queue's `error` |
| queue to `dry_run` (never expected: the forms job never writes it) | `failed` | `The ClickUp writer ran this as a dry run; nothing was written.` |
| queue to `queued`, `sending`, `retry` | no change | |
| notice to `posted` (also `unknown` to `posted`) | `delivered` (also `unknown` to `delivered`) | |
| notice to `failed` / `unknown` / `skipped` | `failed` / `unknown` / `skipped` | the notice's `error` |
| notice to `muted` | `skipped` | `The call grade notice is off in Notices and routing.` |
| notice `failed` to `queued` (`cockpit_slack_notice_fix`) | `failed` to `queued` under `cockpit.forms_fix = 'on'` (set and cleared inside the trigger) | |
| message to `sent` (also `unknown` to `sent`) | `delivered` | |
| message to `failed` / `unknown` / `skipped` | `failed` / `unknown` / `skipped` | the message's `reason` |
| message `failed` to `draft` (reopen) | `failed` to `queued` under `cockpit.forms_fix` | |
| message `refused` to `skipped` (a person pressed Skip, Z55) | `queued` to `skipped` | the message's `reason` |
| message `failed` to `skipped` (Z55) | no change: the effect stays `failed` (the 2a guard has no `failed` to `skipped`, and WhatsApp did refuse it); the skip is in the message's own audit row | |
| message to `approved`, `claimed`, `sending`, `refused`, `draft` (other) | no change: the effect stays `queued` (a refused message waits on a person, Z9) | |

**The effects guard** (`cockpit_form_effects_guard`, replaced in `w`) is
2a's body (`20261027f_forms_core.sql:438-470`) plus exactly two moves:
(1) `unknown` to `skipped` (a read-back proved nothing was written, or a kept
date); (2) an `INSERT` in state `delivered` only while
`current_setting('cockpit.forms_record', true) = 'on'`, `owner = 'cockpit'`,
`delivery_ref IS NOT NULL` and `form_key IN ('kickoff','blueprint')` (build 8).

### 3.7 `MessageView` (notices, `v`; screens read it)

`{id, kind, state, taskId, clientName, responseId, body, reason, callAt,
approvedBy, approvedAt, expiresAt, sentAt, readBack: {by, at} | null, owner,
effectState}`. `callAt` is the response's `answers.call.endsAt`, else
`startsAt`; `approvedBy` is `cockpit_slack_notice_role_of(approved_by)` (a role,
never an address); `owner` is the registry's current owner of the recap effect;
`effectState` is the effect's state. It never returns `claim_token` or
`provider_id`.

### 3.8 `CallView.movable` (writers, `calls.ts`; screens read it)

2a's `CallView` (`supabase/functions/cockpit-forms-api/calls.ts:57-87`) gains
`movable: boolean`. True only when the actor is an admin or the CEO,
`cockpit_forms_switch('move_recording')` read true (one service read per
`checkin.calls`), the view's only refusal is "on another client" (class
`client` or `candidate`, not gone, not a tie refusal) and it has no
`notesAlready`. Then `blocked` reads `onOtherMovable(other, client)` =
`On {other}. If this is {client}'s call, move it here.` (a function exported by
`fathom.ts` beside today's sentence builder); every other view keeps today's
sentence (`fathom.ts:226-228`).
The window parses it as `z.boolean().default(false)`, so an older door answer
still parses.

### 3.9 The record shapes (db, `y`; worker calls them)

- `cockpit_forms_door_seen(p_form_key, p_outcome, p_reason)`: `p_outcome` is one of `recorded` (a new response stored), `repeat` (a token already stored), `ignored` (signed, but not a `form_response` for the registry's form), `probe` (a signed probe), `unsigned` (a bad or missing signature) or `failed` (no key, or the store refused); the doctor and the guardian read `detail.outcome` with these values only.
- `cockpit_form_record_typeform(p jsonb)`: `p = {formKey ('kickoff' only in 2b), token (^[A-Za-z0-9]{8,64}$), submittedAt, hidden, answers: [{ref, type, title, value}], recordingUrl, via: 'typeform_webhook'|'typeform_sync'}`; answer `{ok, id, inserted, taskId, state}`.
- `cockpit_form_record_sweep(p_apply boolean)`: answer `{apply, kickoff: {recorded, already}, blueprint: {recorded}, effects: {delivered, skipped, waiting}}`.
- A recorded Typeform response holds `answers = {source: 'typeform', formId, token}` (a pointer) and `hidden = {onboarding_client_id}` only: kickoff hidden fields carry the client's email and phone (`apps/client-success-cockpit/src/forms/prefill.ts`, used by `kickoff.ts:21-30`), and the responses audit trigger copies `hidden` (`20261027f_forms_core.sql:333-403`).

### 3.10 The published notes parity (worker, N4)

Every `cockpit_csm_sources` `clients` row gains `notesFrom: 'store'` and
`notesParity: {state: 'same'|'explained'|'differs'|'none'|'off', why?:
'fresh'|'manual'|'native'|'late', fields?: ('lastNoteOn'|'defcon'|'priority'|'notes')[],
at, cleanSince}` (build 4).

### 3.11 Health rows (`cockpit_sync_state`) 2b adds

| Key | Writer | ok note examples |
|---|---|---|
| `forms-effects-kick` | `w` | `Nothing waiting.`; `Asked the drafts for 2 1-1 notes.`; not ok: `The vault has no cockpit_notices_cron_secret, so the 1-1 notes sweep did not run. Add it to the vault.` |
| `clickup-writeback:forms` | `clickup-writeback` job `forms` | detail `{mode, onlyCards, counts}`; `Nothing to write.` only when no form row is open, else one of 4.1's waiting sentences (Z74) |
| `clickup-writeback:forms-kick`, `clickup-writeback:forms-doctor` | `t`, the function | `Ready` |
| `client-messages` | `hermes/client-messages` | `Nothing approved to send. Sending is off until the switch-over.` (dry); detail `{mode, kinds, onlyCards, approved, sent, refused, failed, unknown, unread, held, receiptsMissing, envFrom}` with `mode` exactly `dry` or `apply` (a run is limited when `onlyCards` is non-empty); a `receiptsMissing` above 0 adds `RECEIPTS_LOST(n)` to the note (4.3, Z76); the guardian counts staleness from the first `client-messages` row it ever sees (none yet means the cron is not installed, which reads ok before D14) |
| `client-messages-g5` | `g5.ts` | `same number`; detail the printed answer plus `receiptsMissing`, and the note stays the verdict alone (Z76) |
| `csm-forms-record` | `hermes/csm-calls` | `Forms tables: 8 kickoffs and 0 Brand Blueprint presses recorded, 0 Stage 1 deliveries linked, 0 waiting for Stage 1.` |
| `forms-door:kickoff` | `forms-door`, `forms_key.py` | detail `{registered, lastDelivery, outcome}` |

### 3.12 The sentences of the dispatch and the registry (db)

| Where | Sentence |
|---|---|
| grade effect waiting | `Waiting for the grade.` |
| recap effect waiting | `Waiting for the recap draft.` |
| grade draft ended `off`, `failed` or `skipped` | `No grade: {the draft's reason}` (cut to 240) |
| recap draft ended `off`, `failed` or `skipped` | `No recap: {the draft's reason}` |
| 30 minutes after `submitted_at`, grade | `No grade: the grader did not answer.` |
| 30 minutes, recap | `No recap: the drafter did not answer.` |
| registry, the editor gate refused (42501 re-raised, Z54) | `Only the CEO, an admin or someone they add can change where the 1-1 notes go.` |
| registry, another form | `Only the 1-1 notes change here in 2b. Kickoff and Brand Blueprint keep the Stage 1 path.` |
| registry, provider by a non-CEO seat | `Only the CEO switches where the 1-1 notes are filled: it goes with closing the Typeform and turning Make off.` |
| registry, `native` asked by any seat, the CEO included (Z54) | `The 1-1 notes open in the cockpit only through the switch-over function at the cut-over hour.` |
| registry, native without the two SQL effects | `Move the notes row and the recording match to the cockpit with the switch, or the notes reach no client brief.` |
| registry, a path missing | `{label} cannot move to the cockpit yet: {clause}.` |
| registry, a bad patch | `Change only provider and owners, with make, shadow or cockpit for effects this form has.` |
| cut-over, newest Typeform unplaced | `Put the newest Typeform notes on their client from the queue first.` |
| cut-over, already native | `The 1-1 notes already open in the cockpit.` |
| dispatch, the whole call failed (Z53; `forms-effects-kick`, not ok) | `The 1-1 notes dispatch failed: {error, cut to 200}. The notes are saved; the sweep tries again every minute.` |
| WhatsApp intent, the owner gate refused (Z66) | the gate's reason (3.1), e.g. `Make owns this again.`, written when the next claim settles the row `skipped` |
| WhatsApp intent, a fourth attempt (Z66) | `WhatsApp refused this recap three times. Send it by hand in the group if it is still needed, then skip it here.` |

---

## 4. The builds

### 4.0 Build 0: effect dispatch (db, `w`; writers for the forms-api op)

**State now.** Nothing turns a `cockpit` effect into a delivery. Submit step 10
inserts one effect per plan (`cockpit` to `planned`, `make` to `skipped`,
`shadow` to `dry_run`; `20261027f_forms_core.sql:1665-1690`); step 11 runs only
`cockpit_form_apply_sql_effects` (`:1694`, body `:1130-1209`); steps 11b and 12
adopt drafts and return (`:1695-1711`). The planner gives `grade_notice` a plan
`{kind 'checkin.grade', target C09SVG6FHGU, dedupe 'grade:'||rec, recordingId,
facts}` and `recap` a plan `{kind recap_checkin, draftId NULL}`, and skips both
with no recording (`20261027h_checkin_plans.sql:311-338`). The notices kick
(`20261025n_slack_notices.sql:2066-2125`, cron `mahara-slack-notices` every
minute) returns early when nothing is due.

**The change** (all in `w`):

1. **`cockpit_form_dispatch(p_response_id uuid) RETURNS jsonb`.** It acts only when the response is `form_key = 'checkin' AND mode = 'live'` (Y49: kickoff and Blueprint are never dispatched). It takes the response's effects `WHERE owner = 'cockpit' AND delivery IN ('clickup_queue','slack_notice','client_message') AND state IN ('planned')`, plus a `failed` recap effect with `delivery_ref IS NULL` whose response was submitted under 24 hours ago (Z28), `FOR UPDATE SKIP LOCKED`. For each, first `cockpit_form_effect_owner(...)`: not `cockpit` moves it `planned` to `skipped` with `Make owns this again.` Then, each in its own `BEGIN ... EXCEPTION` block:
   - `clickup_queue`: `INSERT` the row of 3.3 `ON CONFLICT (dedupe_key) DO NOTHING`, read its id back by `dedupe_key`, move the effect to `queued` with `delivery_ref` = that id and `receipt = {queueId}`.
   - `slack_notice`: the grade draft of the recording (`cockpit_form_drafts` `kind = 'grade'`, by `recording_id` alone, newest). `ready`: queue 3.4, move `queued` with `delivery_ref` = the notice id (settle at once if that notice is final). `off`, `failed` or `skipped`: `failed` with `No grade: {reason}`. None or `drafting`: stays `planned`; the reason `Waiting for the grade.` is written through `cockpit_form_effect_note` only while the effect's `reason IS NULL`, so whichever entry point sees it first writes it once and nothing rewrites it (Z53).
   - `client_message`: the newest recap draft `WHERE response_id = r.id`. `ready`: insert 3.5 `ON CONFLICT (dedupe_key) DO NOTHING`, read its id back by `dedupe_key`, move the effect to `queued` with `delivery_ref` = that message id and `receipt = {messageId}` (a `failed` recap moves `failed` to `queued` under `cockpit.forms_fix`); 3.1's gate, 3.6's settle and `sweep_checkin` all join on that `delivery_ref`. `off`, `failed`, `skipped`: `failed` with `No recap: {reason}`. None or `drafting`: stays `planned`; `Waiting for the recap draft.` written once, as for the grade (Z53).
   - On any exception the effect keeps its state; its reason becomes the error, cut to 240, through `cockpit_form_effect_note` (written, with its audit row, only when it differs from the reason it has); the notes are never rolled back (Z5).
   - The whole body sits inside one outer `BEGIN ... EXCEPTION WHEN OTHERS` block: an error outside the per-effect blocks (the response read, the lock) upserts `forms-effects-kick` not ok with 3.12's dispatch sentence and returns `{error}`; it never raises, so a dispatch fault can never roll back a submit, shadow runs included (G2, G3, G9 need them) (Z53).
   Answer: `{queued, waiting, failed, skipped}` counts, or `{error}`.
2. **`cockpit_form_submit` replaced**: the live body plus one line, `PERFORM public.cockpit_form_dispatch(r.id);`, after the adoption loop and before step 12. The test compares `pg_get_functiondef` with 2a's body plus exactly that line.
3. **Settle** (3.6): `cockpit_form_effects_settle` and the three triggers.
4. **The guard** (3.6): two added moves.
5. **`cockpit_form_drafts_dispatch`** (trigger, section 2.7): when a `grade` draft leaves `drafting`, it dispatches the `planned` `grade_notice` effects whose `plan->>'recordingId' = NEW.recording_id`; when a `recap` draft leaves `drafting`, it dispatches the recap effect of `NEW.response_id`. Inside `BEGIN ... EXCEPTION`, so it never fails `cockpit_form_draft_finish` (`20261027f_forms_core.sql:1931`).
6. **`cockpit_form_effects_sweep() RETURNS jsonb`**: re-dispatches every `planned` `cockpit` effect of a live check-in response; at `submitted_at + 30 minutes` it moves a still-`planned` grade effect to `failed` with `No grade: the grader did not answer.` and a recap effect with `No recap: the drafter did not answer.`; a `clickup_queue` effect still `planned` then (its insert kept failing) moves to `failed` with its last reason. It changes a reason only through `cockpit_form_effect_note` (Z53), so an unchanged reason is never rewritten and every changed one leaves an audit row.
7. **`cockpit_form_effects_kick()`**: calls the sweep. When a `planned` grade or recap effect younger than 30 minutes has no `drafting` or `ready` draft, it posts `{"op":"effects.sweep"}` to `https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-forms-api` at most once every 2 minutes (the last post time in `cockpit_sync_state` `forms-effects-kick`.detail), with headers `x-cron-secret` = vault `cockpit_notices_cron_secret` and `Authorization: Bearer` vault `cockpit_anon_key`, guarded as the notices kick is (`to_regclass('vault.decrypted_secrets')`, `net.http_post` present, `20261025n:2096-2112`). It writes `forms-effects-kick` with a 3.11 sentence. It is called from the notices kick (build 2 owns that replacement; Z10), so 2b adds no cron for it.
8. **`cockpit_form_effects_waiting()`** (service): `[{effectId, responseId, kind: 'grade'|'recap', taskId, recordingId, since, draftState, actorId, response}]` where `response` is `cockpit_form_response_view(r)` and `actorId` is `r.created_by_id`, for planned grade and recap effects younger than 30 minutes with no `drafting` or `ready` draft, whose owner is `cockpit` both in the effect row and in the registry (`cockpit_form_effect_owner('checkin', effect_key)`, Z71). It reads through the internal `cockpit_form_effects_waiting_rows()`, which the kick reads too.
9. **Index** `cockpit_form_effects_delivery_ref`.

**forms-api op `effects.sweep`** (writers). `door.ts`, before the service-key
branch (`supabase/functions/cockpit-forms-api/door.ts:108-111`): a request whose
`x-cron-secret` equals env `NOTICES_CRON_SECRET` (compared in constant time;
function secrets are project-wide, so no new secret, Z11) may run only
`effects.sweep` (any other op: 403 `The cron secret runs the 1-1 notes sweep
only.`); a wrong secret answers 401 `Not allowed.`. New `effects.ts`
`sweepEffects(deps)`: reads `cockpit_form_effects_waiting()`, at most 4 rows a
run inside a 100 s budget; for each, `cockpit_forms_actor(p_actor := actorId)`
(`20261027f_forms_core.sql:1773`; a refused seat skips the row with a log line
and no draft); then `draftsForResponse({deps, actor}, response, [kind],
readDrafts)`. `drafts.ts` gains that export, extracted from `checkinDrafts`
after its response read (`drafts.ts:378`, `op.userRpc("cockpit_form_responses_read")`),
with this exact signature:

```ts
export type DraftsReader = (responseId: string) => Promise<{ recordingId: string | null; drafts: DraftView[] }>;
export async function draftsForResponse(
  op: { deps: Deps; actor: Actor }, response: Record<string, any>, kinds: Kind[], readDrafts: DraftsReader,
): Promise<DraftsAnswer>;
```

Both draft reads of today's body (`drafts.ts:445`, when a key is missing, and
`:502`, always; both `readDrafts(op, ...)` through `op.userRpc("cockpit_form_drafts_read")`,
`:353-356`) go through the `readDrafts` parameter. `checkinDrafts` passes
`id => readDrafts(op, id)` (today's seat reader), so the window's behaviour is
unchanged and `drafts.test.ts` stays green; `sweepEffects` passes a reader over
the service RPC `cockpit_form_drafts_service` (2.7, `op.deps.rpc`), because
`cockpit_form_drafts_read` is granted to `authenticated` only and gates on
`auth.uid()` (live ACL `{postgres=X/postgres,authenticated=X/postgres}`,
`20261027f_forms_core.sql:1755-1767`), which a cron request does not have
(Z42, Z56). The drafts' own guards keep one grade per recording and one recap
per response. Answer `{ok, begun, skipped}` (no drafts view). `doctor.ts`
reports `NOTICES_CRON_SECRET` as a boolean.

**Guardian** (worker writes it): two rows over `cockpit_form_effects` in
`checks/queues.py` (section 6), never an RPC (the guardian's REST door reads
tables and `cockpit_guardian_probe` only, `hermes/cockpit-guardian/guard/db.py:1-14, 252-345`).

**Tests** (section 8): `apps/media-buyer-cockpit/scripts/forms-dispatch-supabase.test.ts`
proves (1) a live check-in submit with the registry flipped through
`cockpit_form_registry_apply` with `via = 'cutover'` (in a rolled-back transaction) writes one queue
row per ClickUp effect with 3.3's shape and no `comment_text` in the payload,
each effect `queued` with `delivery_ref`; (2) the grade waits with `Waiting for
the grade.` and the recap with `Waiting for the recap draft.`; finishing a ready
grade through `cockpit_form_draft_finish` queues `grade:{rec}` with facts of ids
and times only; a ready recap makes one message whose body is byte-equal to the
draft text with the right sha256; a recap over 4,096 characters fails with the
sentence; (3) every row of 3.6, `unknown` to `skipped` included, and an illegal
move commits the outbox change and writes `forms.settle_refused`; (4) a shadow
submit and a `make` effect insert no delivery row; (5) a live kickoff or
Blueprint response with `cockpit` effects is never dispatched by the submit, the
sweep or the drafts trigger (Y49); (6) the 30-minute sentences and the
`No grade: {reason}` path for an `off` draft; (7) idempotence: the sweep twice,
the trigger plus the sweep, a repeated submit add nothing; (8) a queue insert
refused by a stand-in CHECK keeps the effect `planned` with its reason and the
notes commit; (9) the owner flipped back moves a planned effect to `skipped`
`Make owns this again.`; (10) `pg_get_functiondef(cockpit_form_submit)` equals
2a's plus exactly the dispatch line; (11) a `failed` recap with no message is
requeued by a later ready recap within 24 hours and not after; (12) exact
grants; (13) a dispatch whose response read is forced to raise leaves the
submit committed, `forms-effects-kick` not ok with the sentence, and the
effects `planned`; (14) the waiting reason is written once (one
`forms.effect_reason` audit row) across submit, trigger and three sweeps, and a
changed error reason writes one more; (15) `cockpit_form_drafts_service` is
`service_role` only and answers like `cockpit_form_drafts_read`.
`supabase/functions/cockpit-forms-api/effects.test.ts` (writers): the cron
secret runs only `effects.sweep`; a wrong secret is 401; the service key still
runs the doctor only; 4 rows at most; a refused actor begins nothing;
`draftsForResponse` is called with the response from the service read; on the
cron path no `userRpc` is ever called (a stub that throws), a missing key reads
the drafts through `cockpit_form_drafts_service` and begins no second `off`
row on a second run.

### 4.1 Build 1: the ClickUp `form` kind (writers, `t` and `clickup-writeback`)

**State now.** Jobs `kpi, log, dosdonts, doctor, requests, requests_doctor`
(`supabase/functions/clickup-writeback/run.ts:78`, dispatch `index.ts:96-103`);
each switch live only when exactly `"true"` (`index.ts:16-26`, `run.ts:85-115`,
`requests.ts:202-217`). The live log claim excludes only `request` and
`task_action` (`20261026r_requests.sql:319`); for an unknown kind it returns
`source_exists` true and `buildSteps` settles the row `skipped` "A question or a
request, not a change…" (`queue.ts:160-162`), so a `form` row inserted today
would be skipped, never written. The requests pattern (own claim with one lane
per task and a mode gate, `20261026r:2502-2554`; release without counting a try,
`:2565-2595`; mode mirror `:1132-1150`, `:2637-2650`; kick `:1247-1282`; cron
`:2975-2980`; `runRequests` holds rows and never writes `dry_run`, 100 s budget,
`run.ts:518-697`, its helpers above it at `:469-517`) is the one to copy. Reusable exports: `findComment` pages past
25 (`requests.ts:154-167`), `fieldMatches` (`:170-180`), `kuwaitDay`,
`noonKuwait` (`:118-124`), `StepBook`, `errorKind`, `outcomeOf` (`:377-456`).

**The SQL** (`t`, section 2.4). `claim_forms(p_token, p_limit)`:
- first, in every mode and before its mode check: every open `form` row (`queued`, `retry` or `unknown`, or `sending` older than 10 minutes; no due time, no lane, no canary) goes through `cockpit_form_effect_gate('clickup_queue', q.id::text)`, and each row the gate refuses is settled in this call (3.1's rule; `claim_token` and `claimed_at` cleared), so a rollback's open rows close with the writer off (Z74);
- then returns `[]` unless `cockpit_clickup_forms_mode()` is `apply` or `apply_limited`; in `apply_limited` only rows whose `task_id` is in the mirror's `onlyCards`;
- due rows: `queued`, `retry` or `unknown` with `next_attempt_at <= now()`, or `sending` older than 10 minutes;
- one lane per card among `form` rows: a row waits while another `form` row on the same `task_id` is freshly `sending`, or is open (`queued`, `sending`, `retry`, `unknown`), older and from another response (`payload->>'responseId'`); one response's rows go together;
- order `created_at`, then `array_position(ARRAY['todo_comment','happiness','last_poc','last_checkin_call'], payload->>'effectKey')`, then `id`; `FOR UPDATE SKIP LOCKED`; `attempts + 1`;
- then for each claimed row the gate again: `g := cockpit_form_effect_gate('clickup_queue', q.id::text)`; `ok = false` settles the queue row in the same call (3.1's rule; `claim_token` and `claimed_at` cleared);
- answer: the kept rows plus `{effect: {id, state, plan: plan - 'lines'}}`.

`cockpit_clickup_forms_doctor_inputs()`: form rows by state, the oldest due and
stuck `sending`; the six Client Happiness option ids (from
`cockpit_form_happiness_option`, equal to `20261027h_checkin_plans.sql:40-50`)
and the three field ids; the registry owners of the four `clickup_queue`
effects; the mode. The kick posts only when the claim could take a row: a `form`
row due now while the mode is live, by the claim's own canary, due time and
one-lane-per-card rule; or any open row the owner gate refuses, in any mode,
because the claim settles those in dry run too (Z74); or when the last forms
report is older than 10 minutes. It posts nothing while a forms run younger than
4 minutes is open (one run at a time, Z80). It writes
`clickup-writeback:forms-kick` every minute (`Nothing due. The 1-1 notes writer
last reported at {HH:MM} Kuwait.`; `A 1-1 notes run that started at {HH:MM}
Kuwait is still writing, so no second run was posted.`; the vault note when
`cockpit_sync_secret` is missing).

**The function** (writers):
- New `forms.ts`: `formsGate(env)` reads only `CLICKUP_WRITEBACK_APPLY_FORMS === "true"` and the canary `CLICKUP_WRITEBACK_FORMS_ONLY_CARDS` (never `APPLY`, `APPLY_REQUESTS` or `APPLY_CSM_TICKETS`); `FORM_FIELDS`, `HAPPINESS_OPTIONS`; `formsDb(rpc)`; `formMarker(responseId) = 'Cockpit ref F-' + the first 10 hex of the response id`; `formStep(item)` checks, for every effect, `payload.taskId = item.task_id = plan.taskId`; for `todo_comment` only, `sha256(plan.comment_text) = payload.commentSha256`; for `last_poc` and `last_checkin_call` only, `plan.value = noonKuwait(plan.day)` (the happiness plan carries `field`, `label` and `value`, an option id, and the comment plan `comment_text`; neither has a `day`, `20261027h_checkin_plans.sql:275-291`); a mismatch is `failed` with no call; `executeForm(item, step, provider, save, now)` books its one `StepBook` step under the key `payload.effectKey` (`requests.ts:377-389` keys `progress.steps` by the string it is given), which 3.6's receipt reads:
  - every field step first `GET task/{id}`; a card off the Clients - Mahara list `901816559981`, or a 404, is `failed` with `This card is not on the Clients - Mahara list, so nothing was written.`;
  - comment: text = `plan.comment_text` + a blank line + the marker, saved in the `steps` column (never in `progress`) before the first POST, `notify_all false`; on resume `findComment` from `startedAt - 60 s` (up to 10 pages); after the POST a read-back by id and marker; not found is `unknown`;
  - Happiness: delivered unchanged when the card shows the option (by id or `orderindex`); else POST `{value: optionId}` and read back with `fieldMatches('select')`; an option missing on the field is `failed`;
  - dates, forward only by Kuwait day: card newer is `skipped` with `Last POC stays {D Mon}: it is newer than this call.` or `Last check-in call stays {D Mon}: it is newer than this call.` (`apps/client-success-cockpit/src/dev/checkinFixtures.ts:701`); the same day is delivered unchanged with no write; else POST `{value: noonKuwait(day), value_options: {time: false}}` and read back by Kuwait day (equal: done; newer: kept, `skipped`; older or empty: `unknown`).
- `run.ts`: `JOBS` adds `forms` and `forms_doctor` (`run.test.ts:478-479` uses `forms` as its unknown-job example and changes in this build); `runForms(deps, limit = 8)`: nothing claimed reports `Nothing to write.` only when no form row is `queued`, `retry` or `unknown` (read through the doctor inputs), else one of three waiting sentences: `Nothing written: {n} writes wait in the queue while the 1-1 notes writer is off.`; `Nothing to write now: {n} writes wait for a later try, the next at {HH:MM} Kuwait.`; `Nothing to write now: {n} writes wait behind an older call on their card, or for the next run.` (in `apply_limited`, `on the other cards, behind an older call on their card, or for the next run`); and when the queue cannot be read, `Nothing to write now. The 1-1 notes queue could not be counted, so it is not reported as empty.` (missing is never zero, Z74). Else `begin` a `forms` run, exclusively (another run open: `Another 1-1 notes run is still sending, so this one handed back the {n} writes it claimed; the next run takes them.`, their tries untouched, Z80); a row the gate refuses is released with `Held: the 1-1 notes writer is off until the switch-over.` (dry run) or `Held: the 1-1 notes writer is open only for the test card.` (apply_limited, another card), never `dry_run`; a live row has its steps frozen, is executed and settled by the requests ladder (5 tries); 100 s budget; then `finish` and `forms_state` with the mode, `onlyCards` and counts. `runFormsDoctor`: secrets by name, `GET list/901816559981/field` (the six option ids, both date fields of type `date`), the canary card on the list; written to `clickup-writeback:forms-doctor`. `runDoctor`'s note names the forms switch from env only.
- `index.ts`: the header, the dispatch, and the pace `CLICKUP_FORMS_CALLS_PER_MINUTE` (default 10, at most 60, set as a function secret) for both forms jobs. One forms run sends at a time, so this pace is the whole job's. About 11 calls write one response's four rows, so the default writes a response in a little over a minute. A 429 stops the run with `ClickUp asked the cockpit to slow down (429), so the rest waits for the next run.` The job counts inside the one token's budget of 80 calls a minute (`docs/requests/CLICKUP-DOWNGRADE.md` section 1; Z80).

**Tests**: `supabase/functions/clickup-writeback/forms.test.ts` (the gate; the
comment step with the 27-comment page-2 resume; Happiness; the date bodies and
read-backs at 03:00Z and 04:00Z; off-list and 404 cards; the step booked under
`payload.effectKey`; `formStep` checks per effect key (a happiness row with no
`day` passes); no `progress` value ever saved holds the comment text; every RPC named is in
`t`, revoked from `PUBLIC, anon, authenticated` and granted to `service_role`
only), `run.test.ts` (jobs list; dry run claims nothing; a held row is released
and no save ever carries `dry_run`; the budget), and the PGlite
`apps/media-buyer-cockpit/scripts/forms-writeback-supabase.test.ts` (CHECKs;
the replaced log claim never returns a `form` row and otherwise equals the live
body; `claim_forms` modes, canary, order, lanes, stale `sending`, disjoint
concurrent claims; the gate refusals with `20261029s` and `20261029w` applied; release, mode and kick; a refused row settled by a dry-run claim, each of 3.1's two settlements; the kick counting a refused row as due in any mode and holding a row behind another response on its card; the idle sentences; the body-diff rule for the claim, release, begin and idle; the ACLs of 2.2; the drift guard;
twice-safe).

### 4.2 Build 2: the check-in notices (notices, `u` and `cockpit-notices`; screens for the two rows)

**State now.** The sender knows six kinds (`supabase/functions/cockpit-notices/text.ts:16, 28`;
variants `:31-38`; only named fact keys are read, `:6-13`); `readClaimed`
returns null for an unknown kind (`send.ts:117-118`), so an older sender would
leave a new kind `sending` until the sweep marks it `unknown`
(`20261025n:1033-1037`); `send.ts:430-440` merges `row.live` into the facts the
text reads. The live channel rule names three kinds (`20261025n:67`). The 2a
grade output holds 12 criteria in a fixed order, notes of at most 200
characters, an overall of at most 1,500, the score as the mean to one decimal
and the model's colour (`supabase/functions/cockpit-forms-api/prompts/grade.ts:13-30, 112-128`).

**The SQL** (`u`, section 2.5):
- `shape`: both kinds `post`. `kind_label`: `Call grade`, `Recap not sent`.
- `live`: for `checkin.grade` it returns `{grade, takenByRole, callAt, shareUrl, recordingShown}`, where `grade` is `{criteria, overall, color, score, draftId}` from the draft `facts.draftId` when that draft is `ready` (else the key is absent); `takenByRole` is `cockpit_slack_notice_role_of(cockpit_fathom_meetings.recorded_by_email)`, else the role of the response's `submitted_by` (a role, never a name); `callAt` is the meeting's `starts_at`; `shareUrl` its `share_url`; `recordingShown` is `class IN ('client','candidate') AND gone_at IS NULL` and the call row not gone. For `checkin.recap_late` it returns `{recap: {effectState, messageState}}`.
- the kind lists of `inputs`, `rehearse`, `rehearse_service`; the `array_position` lists of `doctor_inputs` (`20261025n:1641-1642`), `settings_read` (`:1765-1766`) and `channel_remove` (`:2000`), both kinds appended; `channel_remove` of the Call grade's channel refuses with `The Call grade notice posts there. Choose another channel for it first.`
- `settings_set`: for `checkin.grade`, a non-empty mention rule or people is refused with `The call grade tags nobody.`; a channel whose `private` is not true with `The call grade posts only in a private channel. Choose one the cockpit has checked as private.`
- `cockpit_slack_notice_read`: kinds `LIKE 'checkin.%'` listed only for the CEO, an admin or a seat that passes `cockpit_csm_client_gate` (a creative-only seat never sees them).
- `claim` changes: in the existing step 1b ("Too old to be true now", `20261025n_slack_notices.sql:1239-1253`), `public.cockpit_slack_notice_ts(r.facts->>'dueAt')` joins the coalesce just before `r.created_at`, so a `checkin.recap_late` row's event time is its due time (a `checkin.grade` row already carries `submittedAt`); a new step 1c, for `checkin.grade`: (i) `cockpit_form_effect_gate('slack_notice', r.id::text)`, refused: `skipped` with the reason (`queued` to `skipped`, allowed); (ii) `live.recordingShown` false: `skipped` with `That recording is no longer a client call, so its grade was not posted.`; (iii) no `live.grade`: `sending` then `failed` with `The call's grade is not in the cockpit, so nothing was posted. Tell the tech lead.`; (iv) the target channel not private: `sending` then `failed` with `The call grade posts only in a private channel. Choose one in Settings, Notices and routing.` (the notice guard allows `queued` only to `sending`, `skipped` or `muted`, `20261025n_slack_notices.sql:725`, so a direct `queued` to `failed` would raise 55000 and stall every notice's claim; the live claim goes `sending` then `failed` the same way, `:1308-1311`, `:1337-1342`); step 1d, for `checkin.recap_late`: the recap since `sent` or `skipped` makes it `skipped` (`The recap was sent before this reminder went out.` or `The recap was skipped, so no reminder was posted.`), and the recap's owner no longer `cockpit` makes it `skipped` with `Make owns this again.`
- `cockpit_slack_notice_sweep_checkin()`: per row inside `BEGIN ... EXCEPTION` (an error calls `cockpit_slack_notice_queue_failed`, `20261025n:886`): every check-in `recap` effect with owner `cockpit`, in the effect row and in the registry (`cockpit_form_effect_owner('checkin', 'recap')`, Z71), while `cockpit_form_native_since('checkin')` is not NULL, with a live response, in `planned` or `queued` (or `failed` with its message `failed`), whose message (by `delivery_ref`) is NULL or `draft`, `approved`, `refused` or `failed`, with `due = greatest(answers.call.endsAt, else startsAt, submitted_at) + 24 hours` and `due <= now() < due + 24 hours`: `cockpit_slack_notice_queue('checkin.recap_late', 'recap_late:' || response_id, task, client, {taskId, client, responseId, callAt, dueAt}, NULL, 'queued', NULL)`.
- `cockpit_slack_notices_kick` replaced (its only 2b owner): the live body (`20261025n:2066-2125`) with, at the top, `BEGIN PERFORM public.cockpit_slack_notice_sweep_checkin(); EXCEPTION WHEN OTHERS THEN PERFORM public.cockpit_slack_notice_queue_failed('The recap reminder sweep failed: ' || SQLERRM); END;` then `BEGIN IF to_regprocedure('public.cockpit_form_effects_kick()') IS NOT NULL THEN PERFORM public.cockpit_form_effects_kick(); END IF; EXCEPTION WHEN OTHERS THEN PERFORM public.cockpit_slack_notice_queue_failed('The 1-1 notes sweep failed: ' || SQLERRM); END;`. Nothing else changes; the Stage 1 notices behave as today.

**The sender** (`cockpit-notices`): `text.ts` `NoticeKind` and `NOTICE_KINDS`
gain both kinds, `Variant` gains `grade`, `VARIANTS` gains `{'checkin.grade':
['grade'], 'checkin.recap_late': ['late']}`; the docstring names the one
exception: the grade's words come from the claim's live read of
`cockpit_form_drafts`, for a private channel only, never from facts.
`grade(f)`: section 1 `*Call grade: {client}*`, `Taken by {takenByRole} on
{kuwaitWhen(callAt)}. Score {score.toFixed(1)}/10, {color}.` and
`<{shareUrl}|Watch the recording>` (or `No recording link was stored.`);
section 2 the twelve `*{name}* {score}/10. {note}` lines in `CRITERIA` order;
section 3 `*Overall*` then the overall feedback; each section escaped, then cut
at a word to 2,900 characters with `…`, so the post is always one message; the
context line `Client success · Graded once per call · Ref CN-…`; `text` =
`Call grade: {client}, {score}/10, {color}. Ref CN-…`; it tags nobody whatever
mentions are passed. `recapLate(f)`: `*Recap not sent: {client}*`, `The recap
for the call on {kuwaitDay(callAt)} is still waiting in the cockpit.`, the
tags, and `Open in the cockpit` to
`https://cockpit.maharamedia.com/client-success/clients/{id}?tab=overview#messages`;
`text` = `Recap not sent: {client}, call {kuwaitDay(callAt)}. Open in the cockpit. Ref CN-…`.
`sampleFacts` gains invented samples. `send.ts`: `pickVariant` and
`rehearsalVariant` handle both kinds; wanted tags for `checkin.grade` are `[]`.
`run.ts`: a dry run takes its tags from `send.ts`'s `wantedMentions`, so a preview
of the recap reminder tags the people the real post tags (Z78).
`door.ts`: the refusal reads `one of the notices`. `README.md`: the kinds table.

**Screens** (`NoticesRouting.tsx`, `src/lib/notices.ts`): section 5.4.

**Tests**: `apps/media-buyer-cockpit/scripts/checkin-notices-supabase.test.ts`
(PGlite: `20261025n`, `20261027f/g/h`, `20261029s`, `20261029t`, then
`20261029u`, and `20261029v` and `20261029w` for the integration cases): the
CHECKs and seeds, with one `notices.setting_seeded` row per seed on the first
apply and none on the second; 10 kinds in order; the `channel_remove` refusal;
the `settings_set` rules; each claim refusal, (iii) and (iv) each passing
through `sending`; a good row claimed with `live.grade` and facts unchanged; a
48-hour-old grade notice skipped and a `recap_late` row skipped 48 hours after
its `dueAt`; `sweep_checkin` queues once, never for shadow, sent, skipped or
unknown, and not after its message is skipped; the creative-only read; audit
rows hold no text or blocks; the body-diff rule (2.2) for all thirteen
functions, the kick as Stage 1's body plus exactly the two blocks; the ACLs of
2.2; the drift guard refuses a stand-in body; twice-safe.
`supabase/functions/cockpit-notices/text.test.ts`, `run.test.ts`,
`door.test.ts` per the shapes above. **E5 used the fallback proof** (Z75):
`apps/media-buyer-cockpit/scripts/slack-notices-supabase.test.ts` cannot load the
2a base (it builds only what `20261025n` reads), so it stays as it is, every
existing case green, and the per-function body-diff of
`checkin-notices-supabase.test.ts` is the proof that `20261029u` leaves Stage 1
as it was. Run: `cd apps/media-buyer-cockpit && bun test scripts/slack-notices-supabase.test.ts`.

### 4.3 Build 3: client messages (notices for 3a and 3b, writers for the op, screens for 3c)

**State now.** `cockpit_client_messages` exists with its CHECKs, row security,
`SELECT` to `service_role` only, the guard and the audit (`20261027f_forms_core.sql:216-262, 508-581`);
no RPC writes it (Y22) and it holds 0 rows. Recap drafts begin only after the
send, from the sent They owe (`drafts.ts:439-453`); `checkRecap`
(`recapRules.ts:53-86`) takes `text`, `stored` and `teamToday`; the booking
block is `recapRules.ts:9-13`. The guard's transport appends its reference line
(`hermes/ad-billing-guard/transport.ts:272-274`; live release `b6dd57c1`,
`worker.mjs:410`), posts to `gate.whapi.cloud/messages/text` and succeeds only
on `sent === true` with a string `message.id` (`:321-333`).

**3a. SQL** (`v`):
- **The guard**: 2a's rules (`20261027f_forms_core.sql:528-535`) plus four moves: `refused` to `draft` and `failed` to `draft` (reopen), `refused` to `skipped` and `failed` to `skipped` (a person's Skip, Z55); never from `unknown` or `sent`; on insert, and on any update that changes `body`, `body_sha256` must equal `encode(pg_catalog.sha256(convert_to(body,'UTF8')),'hex')`, else `The text and its fingerprint differ.`
- **Browser RPCs**, each gated first (the CEO, an admin, or `cockpit_csm_client_gate(task_id)`): `cockpit_client_messages_read(p_task_id)` (newest 20); `cockpit_client_messages_waiting()` (Today: `draft`, `refused` and `failed` rows of the seat's clients, plus `unknown` rows for the CEO or an admin); `cockpit_client_message_read(p_id)`; `cockpit_client_message_skip(p_id, p_reason)` (`draft`, `approved`, `refused` or `failed` to `skipped`, reason `Skipped by {role}.` or the given one, cut to 240); `cockpit_client_message_reopen(p_id)` (`approved`, `refused` or `failed` to `draft`, clearing claim, intent, approval and expiry; for `failed` under `cockpit.forms_fix`).
- **Service RPCs**:
  - `approve(p_id, p_body, p_body_sha256, p_actor, p_warnings)`: the seat of `p_actor` through `cockpit_form_seat` (`20261027f_forms_core.sql:287`), then the CEO, an admin or `cockpit_csm_client_gate_for_actor(p_actor, task_id)`; state `draft`; `cockpit_form_effect_gate('client_message', p_id::text)` (3.1); a hash that does not match `p_body` raises 22023 `The text changed after it was checked. Approve it again.`; stores body, hash, `approved_by` (the seat's email), `approved_at`, `expires_at = approved_at + 24 hours`, with `cockpit.forms_action = 'forms.message_approved'` and `cockpit.audit_actor` the seat; returns `cockpit_client_message_view` of the stored row (3.7).
  - `claim(p_kinds, p_only_cards, p_limit)`: an advisory transaction lock (busy answers `{busy: true}`); approved rows of those kinds and cards, oldest approval first, `FOR UPDATE SKIP LOCKED`, at most 3; per row: an expired approval goes back to `draft` with `The approval ran out after 24 hours. Approve it again.`; the gate refused makes it `skipped` with the reason; an approver who is no longer an active seat with this client sends it to `draft` with `The person who approved it no longer has this client. Approve it again.`; else `claimed` with a new `claim_token`. Answer `{id, claimToken, taskId, clientName, kind, body, bodySha256, approvedAt, claimedAt}`.
  - `intent(p_id, p_claim)`: on a `claimed` row with that token, in order: (a) `cockpit_form_effect_gate('client_message', p_id::text)` again, because 30 to 120 s have passed since the claim and a rollback may have happened (Z66): refused moves `claimed` back to `approved` (allowed, `20261027f_forms_core.sql:531`), clearing the claim, and answers `{ok: false, reason}`; the next claim's own gate then settles it `skipped` with that reason (3.1), so nothing waits on a person; (b) `attempts` already 3 (the table's CHECK allows 0 to 3, `20261027f_forms_core.sql:242`): `claimed` to `refused` with `WhatsApp refused this recap three times. Send it by hand in the group if it is still needed, then skip it here.` and `{ok: false, reason}`, so the sweep never loops it back to `approved` (Z66); (c) else `sending`, `intent_at`, `attempts + 1`, `{ok: true}`. The worker posts only on `ok: true`.
  - `result(p_id, p_claim, p_outcome, p_provider_id, p_reason, p_read_back)`: `refused` (claimed to refused, reason required); `release` (claimed to approved); `sent` (sending to sent, `provider_id` required, `sent_at`); `failed`; `unknown`; `reconciled` (unknown to sent, with `provider_id` and `read_back.by = 'body_sha256'`); `read_back` (on a sent row with none yet: `{by: 'message_id'|'body_sha256', providerId, at}`, never a body; for `message_id` the `providerId` must equal `provider_id`).
  - `sweep()`: `sending` over 10 minutes to `unknown` with `The sender stopped while sending. Look in the group before anything else.`; `claimed` over 10 minutes with no intent back to `approved`; expired approvals to `draft`.
  - `work(p_limit)`: read only, `{unknowns, unread, approved}` with the body for hash matching.
  - `fix(p_id, 'not_sent', p_note)`: `unknown` to `failed` under `forms_fix` with `Checked by a person: not in the group. {note}`.
  - `team_today(p_task_id)`: true or false from `wa_messages` joined to `wa_threads` (`client_task_id` = the card, `is_group`) for the Kuwait day where `speaker ILIKE '%| MaharaMedia%' OR direction = 'outbound'`; NULL when no group thread is linked.

**The approval op** (writers, `cockpit-forms-api`): new `messages.ts`
`approveRecap(op, body)` for op `recap.approve` `{messageId, body,
acceptWarnings?}`: (1) read the row through `userRpc('cockpit_client_message_read')`
(the seat's gate applies), state `draft`; (2) `[message, block] =
splitRecap(body)`, where `message` is `body` minus its final `\n\n` +
`BOOKING_BLOCK` (`recapRules.ts:9`, `:44`) and a body that does not end with
exactly one block is refused in step 4; (3) `checkRecap(message, {text: body,
stored: body, teamToday: rpc('cockpit_client_message_team_today')})` (the
stored draft text is the full text with the block, `prompts/recap.ts:96`, and
`checkRecap` needs `text` to end with it, `recapRules.ts:81`); (4) a refusal
throws 400 with recapRules' sentence, its `Draft again.` tail replaced by
`Edit the text, then approve again.`; (5) warnings without `acceptWarnings`
answer `{needsConfirm: true, warnings}` and approve nothing; (6) `sha256` of
the exact UTF-8 bytes of `body` (`drafts.ts:231-234`); (7)
`rpc('cockpit_client_message_approve', {p_id, p_body: body, p_body_sha256,
p_actor: actor.actorId, p_warnings})`, where `p_body` is `body`, the full text
with the block; answer `{message: MessageView, warnings}` (the RPC's return,
3.7) or `{needsConfirm: true, warnings}`. `door.ts` routes it as a seat op (the
service key is still refused); `recapRules.ts` exports `splitRecap(body)`.

**3b. `hermes/client-messages`** (notices, a new folder run by the native bun
like `hermes/csm-calls`; it never edits `hermes/ad-billing-guard`):
- `whapi.ts` imports `Transport` from `../ad-billing-guard/transport.ts` and uses only `json()`, `sheet()` and `task()` with a ledger fetch; its own `sendText(group, body)` checks `/^\d+(?:-\d+)?@g\.us$/` before any call and posts exactly `{to: group, body}` (the stored body byte for byte, no reference line) to `https://gate.whapi.cloud/messages/text` with Bearer `AD_BILLING_WHAPI_TOKEN`, through exactly one fetch: `json('Whapi', url, init, false)` (`read` false; with `read` true `Transport.json` loops up to 3 times on 429, 5xx and timeouts, `hermes/ad-billing-guard/transport.ts:55-70`, `:86`, which would post a second WhatsApp to a client group) (Z59). Sent only when the answer is 2xx with `sent === true` and a string `message.id` (as `transport.ts:332-333`); a 5xx, 408, 429, timeout, network error, unreadable answer, or any 2xx without both is `unknown`; another 4xx is `failed` with its status (the area map limits `failed` to "4xx other than 408 and 429", `notes/stage2/maps/drafts-and-messages.md:539`); `listMessages(group, sinceEpoch)` (`GET messages/list/{group}?count=100`, offset paging to 500; reads may use `read` true); `health()` (`GET /health?wakeup=false`).
- `ledger.ts`: before a request it awaits an intent receipt into `cockpit_csm_provider_health` (provider by host: `whapi`, `google`, `clickup`, `typeform`, `make`; ids collapsed in the resource; `run_key 'client-messages:{message id}'`); no receipt, no request; then the response or unknown receipt. It refuses any method but GET, except exactly two POSTs: `https://gate.whapi.cloud/messages/text` (the send) and `https://oauth2.googleapis.com/token` (the read-only Sheets credential that `Transport.sheet()` POSTs for first, `transport.ts:204-213`, recorded under provider `google` like any call). A receipt that cannot be written after its call has left is counted, never repeated: the run's health row carries the count as `detail.receiptsMissing` and its note adds `RECEIPTS_LOST(n)`: `The health ledger is missing the answer to {n} provider call(s) that had already left. Check that the database takes provider receipts (RUNBOOK, Client messages).` The doctor prints it and fails on it; G5's row carries it in its detail (Z76).
- `core.ts` (pure): `groupOf(values, taskId)` by the header names `clickup id` and `wa group id`, exactly one row and a valid JID, no other column read and no row logged; `sheetShape(values)` (is `wa group id` column F); `cardGroup(task)` reads custom field `b1d54dfb-19e9-4c0f-88a3-4f6145f53265`; `groupVerdict(sheet, card)` (empty or same passes, different refused); `normalise`, `sha256`, `jitterMs()` uniform in 30,000 to 120,000.
- `oldSenders.ts`: Typeform `GET /forms/fRokTITH/webhooks` (any enabled webhook to a make.com host is on) and Make `GET {MAKE_ZONE}/api/v2/scenarios/9209179` and `/9523861` (`isActive`); a read that fails is `unread`, which holds like on; cached 10 minutes in `~/.client-messages/old-senders.json`; read only when approved rows exist, and by the doctor.
- `db.ts`: REST with the service key; RPC names must match `/^cockpit_client_messages?_[a-z_]+$/`; upserts `cockpit_sync_state`.
- `worker.ts` commands `doctor [--task <card>]`, `run [--report f]`, `g5`; `readEnv` first-wins over `CLIENT_MESSAGES_ENV_FILES` for keys only (names: `AD_BILLING_WHAPI_TOKEN`, `CLICKUP_API_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TYPEFORM_TOKEN`, `MAKE_API_KEY`, `MAKE_ZONE`). The doctor fails unless `SUPABASE_URL` is exactly `https://bldgtotkfmhoxmlzowdx.supabase.co` (the VPS's `/opt/data/bibi/api-keys.env` names another project, read 2026-10-29, host only), prints for each key and switch the file it came from (never a value), and with `--task <card>` prints that card's Client Data group (`none` or `present, last 4`) and its card field verdict (`groupVerdict`), read only.
- Switches only in `~/.client-messages/switches.env`, read by their own reader and never from `CLIENT_MESSAGES_ENV_FILES` (Z60): `CLIENT_MESSAGES_APPLY` (default `false`), `CLIENT_MESSAGES_KINDS` (default `recap_checkin`; any other kind refused at start in 2b), `CLIENT_MESSAGES_ONLY_CARDS` (default empty); a missing or unreadable file reads as the defaults (off). `AD_BILLING_APPLY` is never read. A switch the worker cannot read for certain is an error, and any switch error turns apply off whatever `CLIENT_MESSAGES_APPLY` says: a switch on two lines (`SWITCH_TWICE(keys)`: `{keys} is written more than once in switches.env, so nothing is sent. Keep one line for each switch and edit that line; never add another below it.`), a kind 2b does not send, or a card list with anything but card ids (`NOT_A_CARD`: `CLIENT_MESSAGES_ONLY_CARDS names something that is not a card id. Write card ids separated by commas, nothing else.`). A run stopped by a switch error still runs the database sweep first, then ends not ok with that sentence (Z76).
- Time budget (the cron's `timeout 300`): the run claims only while at least 200 s of it remain; steps (2) and (3) together stop after 90 s (Z59).
- A run in apply mode, at most one message: (1) `sweep`; (2) up to 5 unknowns: our messages since `claimed_at - 60 s`, a normalised-hash match gives `reconciled`, no match leaves it `unknown` (never sent again); (3) up to 5 sent rows with no read-back: by message id, else hash; retried for 24 hours; (4) approved rows of the allowed kinds and cards, none ends with `Nothing approved to send.`; (5) old senders on or unread hold the run with a sentence such as `Make's recap sender is still on (scenario 9523861). The cockpit sends 1-1 recaps only after the switch-over.`; (6) the column F shape, else hold with `Client Data's WA GROUP ID column moved. The tech lead checks the sheet before any recap goes.`; (7) claim one; (8) `groupOf`, none: `refused` with `No WhatsApp group on Client Data for this card. Add it to Client Data column F, then try again.`; (9) `task()` then `cardGroup`, different: `refused` with `The WhatsApp group on the card differs from Client Data. Fix the group on Client Data or on the card, then try again.`; a ClickUp read failure: `release` (never sent unchecked); (10) wait `jitterMs()`; (11) `intent` (its gate refused or a fourth attempt answers `ok: false`: nothing is posted and the run ends with that reason); (12) `sendText`; (13) `result`; (14) wait 10 s, read back; (15) the health row `client-messages` with detail `{mode, kinds, onlyCards, approved, sent, refused, failed, unknown, unread, held, receiptsMissing}`.
- Dry mode runs step (1) `cockpit_client_message_sweep()` (a database-only move of crashed `sending` rows to `unknown`, stale claims and expired approvals; it sends nothing) and otherwise writes nothing but the health row, with a plan per approved row (group last 4, card field same, empty or differs, old senders, would send and why). So after `CLIENT_MESSAGES_APPLY=false` a crashed row still reaches `unknown` and the CEO's Today row (Z67).
- `run.sh`, word for word on `hermes/csm-calls/run.sh`'s pattern:

```bash
#!/usr/bin/env bash
# Keys from the guard's and the current native release's private runtime files; switches only
# from ~/.client-messages/switches.env (read by worker.ts itself). Never print a file or a value.
set -euo pipefail
cd /home/hermes/client-messages-current
native="$(readlink -f /home/hermes/cockpit-native-current)"
release="$(basename "$native")"
env_files="/home/hermes/.ad-billing-guard/runtime.json:/home/hermes/.cockpit-native-state/runtime-${release}.json"
if [[ -r /opt/data/bibi/api-keys.env ]]; then
  env_files="${env_files}:/opt/data/bibi/api-keys.env"
fi
export CLIENT_MESSAGES_ENV_FILES="$env_files"
exec "$native/tools/bun" hermes/client-messages/worker.ts "$@"
```

  The order matters (first wins): the guard's file gives the proven `AD_BILLING_WHAPI_TOKEN`, `CLICKUP_API_TOKEN` and `GOOGLE_APPLICATION_CREDENTIALS` and has no `SUPABASE_URL`; the native file gives `SUPABASE_URL` (this project) and the service key; `api-keys.env` last gives only `MAKE_API_KEY` and `MAKE_ZONE` (its `SUPABASE_URL` never wins). Key names read over ssh 2026-10-29, no values. Cron `* * * * * flock -n $HOME/.client-messages/worker.lock timeout 300 $HOME/client-messages-current/hermes/client-messages/run.sh run >> $HOME/.client-messages/cron.log 2>&1`.
- `RUNBOOK.md` (folder): doctor, dry run, reading an unknown (look in the group, then `fix not_sent`, then reopen), the switches, the release.

**3c. Screens**: the Messages card, Today's recap rows and the window's recap
step (section 5.1).

**G5** (notices, `g5.ts`): section 4.16.

**Tests**: `apps/media-buyer-cockpit/scripts/client-messages-supabase.test.ts`
(PGlite: `20261027f/g/h`, `20261029s`, then `20261029v`, `20261029w` for the
trigger cases): the full move matrix (the four new moves allowed, `unknown` to
`draft`, `unknown` to `skipped` and `sent` to `draft` refused), the fingerprint
rule, approve (hash, gate, state, owner, `+24 h`, audit without body, returns
the view), skip from `draft`, `approved`, `refused` and `failed` (a refused
message's effect goes `queued` to `skipped`; a failed one's stays `failed` with
no `forms.settle_refused` row), claim (expiry, gate, approver lost, kinds,
cards, busy), intent (its gate refused after a registry flip back: `approved`,
then the next claim `skipped`; `attempts` 3: `refused` with the sentence and no
loop through the sweep; token), result (transitions, read-back once without a
body key), sweep, fix, `team_today` (true, false, NULL), gated reads, the ACLs
of 2.2 and 2.6, the drift guard, twice-safe. `supabase/functions/cockpit-forms-api/messages.test.ts`
(writers): a money figure blocks; an edited or doubled booking block is
refused; over 4,096 refused; warnings answer `needsConfirm` with no RPC;
`sha256` on exact bytes; `p_actor` is the verified actor, never a browser id.
`door.test.ts` and `recapRules.test.ts` per the op. `hermes/client-messages/*.test.ts`
(notices): `core`, `whapi` (exact body, no `مرجع المتابعة` or `Reference`; a pin
that `Transport.send` still appends its marker and the worker never calls it; a
502, a 429 and a timeout each make exactly one fetch and end `unknown`; a 2xx
without `sent === true` or without a string `message.id` is `unknown`; a 400 is
`failed`), `ledger` (a POST other than the two named is refused before any
fetch; `sheet()` succeeds through the ledger fetch with its token POST receipted
under `google`), `oldSenders`, `worker` (order of a run, a crash after intent
leaves `sending`, a ClickUp failure releases, refusals, never a resend of
`unknown`, `AD_BILLING_APPLY=true` does not switch sending on, a
`CLIENT_MESSAGES_APPLY=true` in a shared env file does not switch sending on, a
missing `switches.env` reads off, dry mode runs the sweep and posts nothing, no
claim with under 200 s left, an intent answering `ok: false` posts nothing, the
doctor fails on another project's `SUPABASE_URL`, `doctor --task` prints no
full group id, one message a run), `g5`.

### 4.4 Build 4: the native feed reads the 1-1 notes from the store (worker, release N4)

**State now.** `hermes/cockpit-sync/csmProviders.ts:16-40` `cadenceInputs(cards)`
reads Typeform `fRokTITH` and `gqBcyK6g` through `pd_typeform_proxy_get`
(`:19-20`); per `fRokTITH` item it builds `CallNote {taskId (checkinTaskId,
:8-12), submitted (Kuwait day, :35), notes (up to 4 commitments of 20+
characters from refs 82a6b434 and 5d071906, :33-34), defcon, priority (:35)}`;
`csmProducer.ts:291` then `buildSnapshot` (`:296`); `csmCadence.ts:406-417` uses
the newest note per card for `lastNoteOn`, `noteMissing`, `defcon`,
`callPriority` and `commitments`. The native feed runs from
`/home/hermes/cockpit-native-current` (live `ca8fhot1` on 2026-10-30, whose
`csmProviders.ts`, `csmProducer.ts`, `transport.ts`, `runtime.ts` and
`csmCadence.ts` equal main `ca8fe4bf` byte for byte; it replaced `86eebpf1` and
changed only `csmCadence.ts`) every 15 minutes under
`flock -n native-source-ceo.lock`. Its transport allows Typeform `fRokTITH` and
`gqBcyK6g` only (`transport.ts:215-228`) and a read-only SQL tool that treats
any `limit N` as a coverage cap (`:179-185`); `runtime.ts:19` `supabaseQuery`
is already used by `calculator.ts:3466`. Any read failure aborts the publish
unless retained (`worker.ts:82-83`).

**The change.**
- `csmProviders.ts`: `storeNotes()` through `supabaseQuery`, with no `limit` word in the text: the newest check-in per card (`select distinct on (f.task_id) f.task_id, f.token, f.form_id, f.matched_by, f.submitted_at, f.answers from public.cockpit_csm_call_forms f where f.form_kind = 'checkin' and f.task_id is not null order by f.task_id, f.submitted_at desc`); the marks (`select f.token, f.task_id, f.form_kind, f.matched_by from public.cockpit_csm_call_forms f where f.form_id = 'fRokTITH' and (f.matched_by = 'manual' or f.form_kind = 'checkin_late')`); the registry (`select provider from public.cockpit_forms where key = 'checkin'`). Answers are read by ref, so Typeform rows and the native write-through rows (same refs, `20261027h_checkin_plans.sql:62-104`, `form_id cockpit-checkin`) read alike. One shared `noteOf` and `commitmentsOf` rule for both reads; a native row's commitments are its `Mahara: ` lines of Additional Notes, label removed, each whole, at most 4 (Z49). `cadenceInputs(cards, now)` returns `{notes, exts, parity}`: notes from the store; extensions from `gqBcyK6g` as today; while `checkin.provider` is not `native` it still reads `fRokTITH` (a failure still aborts the cycle; `transport.ts` unchanged) and runs pure `notesParity(storeNewest, typeformNewest, marks, now)`: equal tokens and fields `same`; Typeform newest under 30 minutes and not stored `explained/fresh`; a `manual` store row `explained/manual`; a `cockpit-checkin` store row `explained/native`; a `checkin_late` row `explained/late`; anything else `differs` with its fields. When the registry says `native` it skips the `fRokTITH` read and every state is `off`.
- `csmProducer.ts` (after `buildSnapshot`, `:296`): every client row gets 3.10's `notesFrom` and `notesParity`; `cleanSince` carried from the previous published rows (`state.csm.clients`). It moves at most twice per `differs` episode: to the cycle time when a client first reads `differs`, and again on the first clean cycle after it, the true start of the clean run; the first cycle sets it. While clients differ, G6 is held by its `differs = 0` clause, so the carried value never counts toward the 7 days (Z77).
- Guardian (worker): check `csm-notes-parity` (area workers, severity medium, confirm 3, owner the tech lead, report-only, reads `cockpit_csm_sources` clients): no `notesFrom` row: ok `The native feed still reads the 1-1 notes from Typeform: release N4 is not live.`; any `differs`: warn `For {n} clients the 1-1 notes read from the store differ from Typeform: {names} ({fields}).` with the action `Compare the client's newest fRokTITH response with cockpit_csm_call_forms; rerun the typeform source (hermes/csm-calls/RUNBOOK.md); roll release N4 back if the store is wrong.`; all `off`: ok `The 1-1 notes are native; the Typeform comparison is off.`; else ok `Day {k} of 7: the 1-1 notes read from the store match Typeform for {n} clients ({m} explained by timing or a hand match).` Those four readings are all it has: no feed-staleness warning and no `PARITY_FEED_MAX_MIN`. A stopped feed belongs to `native-source-producer` (fails after 90 minutes), and the publish time is evidence only (Z77).
- Docs: `hermes/cockpit-sync/RUNBOOK.md` section `1-1 notes from the store (release N4)`; the root `SOURCES.md:32` row rewritten.

**Ships first, alone** (Z18, Z63): N4 needs no migration and starts G6's clock.
- **The N4 file set** (exact): `hermes/cockpit-sync/csmProviders.ts`, `hermes/cockpit-sync/csmProducer.ts`, `hermes/cockpit-sync/csm-checkin-task.test.ts`, `hermes/cockpit-sync/csmProducer.test.ts`, `scripts/native-feed.test.ts`, `hermes/cockpit-sync/RUNBOOK.md`, `SOURCES.md`, and the `csm-notes-parity` parts only of `hermes/cockpit-guardian/checks/csm_calls.py`, `hermes/cockpit-guardian/tests/test_csm_calls.py` and `hermes/cockpit-guardian/README.md`.
- **The rule.** The worker builds N4 first, runs section 8's N4 commands green, reports, and stops touching every file of that set until the orchestrator says N4 is committed. Until then it makes no build 9 or build 10 edit to `csm_calls.py`, `test_csm_calls.py` or the guardian README, so each file in the set holds N4's change and nothing else.
- **The mechanism.** The orchestrator commits the set alone on `stage2b-1029` with a path-limited commit (`git commit -m ... -- <the paths>`; never `add -p`, which is interactive). The main session, in its own checkout (never this worktree), cuts a branch from origin/main, cherry-picks that commit, opens a PR and merges it after `scripts/ship.sh`'s checks; then releases it (section 9, D1). `stage2b-1029` keeps the same patch, so a later rebase onto origin/main drops it as already applied, and the ownership test still owns those paths.
- **Done on the branch, 2026-10-30.** N4 is its own commit, `1a0fa201` on the rebased `stage2b-1029` (a rebase moves the sha, never the content), holding exactly the ten paths above. The worker is free on those files again; later edits to them are not N4 and stay out of that commit. Not yet on main or live: the cherry-pick and D1 are still the main session's.

**Tests**: `hermes/cockpit-sync/csm-checkin-task.test.ts` (notes from the
store; each parity state; registry native: no `fRokTITH` call and every state
`off`; extensions unchanged; a failing store select throws; every query starts
`select` with no `limit <n>`; one commitments rule gives identical notes for a
Typeform item and its stored row, Arabic included; a native row's We owe whole),
`hermes/cockpit-sync/csmProducer.test.ts` (fields attached; `cleanSince`
carried, and moved on a first `differs` and on the first clean cycle), `scripts/native-feed.test.ts` (the fixture's
`mcp_supabase_execute_sql` handler answers the three selects; the publish
accepts the new fields), `hermes/cockpit-guardian/tests/test_csm_calls.py`
(`csm-notes-parity`).

### 4.5 Build 5: `cockpit-csm-api` dates (writers; live, no switch, Z19)

**State now.** `supabase/functions/cockpit-csm-api/core.ts:16` `day(d)` returns
`Date.parse(d + 'T09:00:00+03:00')` (06:00Z); the act pushes Last POC
`e183f2ce…` and, for a call, Last Check-in Call `032203ad…` with it
(`:26-27`), `booked` writes Next POC `c48c1323…` (`:28`), `report` writes Last
report sent (`:31`); `executeCsm` POSTs `{value}` with no `value_options`
(`:45`) and compares `String(field.value)` exactly (`:41, :46`), so a stored
03:00Z or 04:00Z value fails the read-back and the act ends `reconcile`
(`index.ts:88`). `projections.ts:32, :40-44, :151-152` has the same defect;
`checkins.ts:75-76` books through it (`check-in.test.ts:437` asserts 06:00Z).
Live: every `call` act ever ended `reconcile` (2 of 2, 2026-10-14 and
2026-10-17) while ClickUp stored the dates (query in section 16).

**The change.** `core.ts`: `fieldDay(d)` validates through `day(d)` and returns
`Date.parse(d + 'T09:00:00Z')` (noon Kuwait, the `billing.ts:130` and
`requests.ts:124` form); date updates carry `{field, value: fieldDay(x), day: x}`
for Last POC, Last Check-in Call, Next POC and Last report sent; `executeCsm`
POSTs `{value, value_options: {time: false}}` when `day` is set;
`fieldMatches(task, field, expected, day?)` with `day` passes when the Kuwait
day of `Number(f.value)` equals it. `day()` stays for task due dates (the
plan's tasks, `:22`, and the ticket, `:36`). `cockpit-board-api` bundles
`core.ts` but calls it only with `kind: "ticket"` (`supabase/functions/cockpit-board-api/lever.ts:18`,
`:148`), so it needs no redeploy; its tests and `csm-read-model.test.ts`
(which runs `executeCsm` on a call act, `apps/client-success-cockpit/scripts/csm-read-model.test.ts:5`)
stay green (section 8). What Log a call writes is unchanged (both fields, the CSM's Kuwait
today). `projections.ts`: noon Kuwait, `value_options`, the Kuwait-day
read-back. No migration, no switch.

**Tests**: `apps/client-success-cockpit/scripts/csm-act-route.test.ts` (exact
bodies; the read-back passes on 03:00Z and 04:00Z re-timing and still rejects
another day; touchpoint, booked, report; due dates unchanged; `logCall`,
`csmCalls.ts:406`, sends kind `call` with no `notes` key),
`apps/client-success-cockpit/scripts/check-in.test.ts` (`:437` expectation),
`supabase/functions/cockpit-csm-api/projections.test.ts`. Screens add to
`csm-page.test.tsx`: on the Log a call panel, `Write 1-1 notes` calls only
`entry.open` and `Log the call without notes` calls the act.

### 4.6 Build 6: the unknown Last POC writer is found and kept (writers, docs only)

**Found.** The Hermes agent's scheduled job `Next POC sync (GHL calendars ->
ClickUp)` (job `c4d2cc339448`, cron `*/15`, enabled, last run
2026-10-29T13:31Z) runs `/docker/hermes-agent-ff5p/data/scripts/alert-next_poc_sync.py`
(an 8-line wrapper: `job_alert.main('next_poc_sync')` from `/opt/data/portal-monitor`),
which runs `/docker/hermes-agent-ff5p/data/scripts/next_poc_sync.sh` (`cd
/opt/data/bibi/workspace/next-poc-sync && exec python3 next_poc_sync.py --apply
--quiet`; both read over ssh, read only, 2026-10-29).
It sets Next POC to the earliest upcoming live booking (clearing only its own),
Last Check-in Call to the latest past `confirmed` or `showed` check-in on
calendar `SHjlq0UjeR11maltYNyh`, forward only, and Last POC to the latest past
`confirmed` or `showed` call on any client calendar or a passed Next POC day,
forward only; it skips `Stopped` and `CANCELLED ONBOARDING`; POSTs `{value: 12:00
UTC of the Kuwait day}` with no `value_options` and reads back by Kuwait day;
posts no comment; writes no cockpit ledger. Its `sync.log` SET lines (City Wood
10-26; Ardon and Khalda 10-27; ocean home and Ghazzawi.sa 10-28) equal the
mirror's `lastPoc`/`lastCall` days, the second source (section 16). The named
candidates do not run: `viktor-side-scripts/csm/csm_app_bridge.py:224-226` and
`csm_daily.py:414-417` are archived (`viktor-side-scripts/ARCHIVED.md:1-3`) and
on no cron or agent job; the eod submit scripts have no job.

**Kept** (Z20): it is forward only by Kuwait day like Y14, so the form effect,
the Log a call act and this sync converge on the latest day; it posts no
comment; it is the only writer keeping Next POC and Last Check-in Call in step
with GoHighLevel; stopping it needs a VPS write no 2b role may make.

**The change.** `RUNBOOK.md` row `Outside writers of the client card's dates`
(the job, schedule, script, log and state paths, its rules, the read-only
checks, and the warning that scheduling `csm_evening.sh` or `csm_end_of_day.sh`
would add a third Last POC writer with a comment). Build 1's forward-only rule
and its `stays` sentence are the coexistence. B6's apply sentence (G8) adds:
`With auto-confirm on, every booked check-in becomes confirmed, and the Next POC
sync counts a passed confirmed check-in as held, so Last Check-in Call and Last
POC move for a no-show unless it is marked in GoHighLevel.` The read-backs are
re-run at cut-over step 5 (section 11).

### 4.7 Build 7: the registry RPC and the cut-over function (db, `s`)

**State now.** No RPC writes `cockpit_forms`. Its CHECKs allow provider
`native|typeform|clickup`, keep a `typeform_id` when provider is `typeform` (so
checkin may keep `fRokTITH` when native, Y42) and validate effects through
`cockpit_forms_effects_valid` (`20261027f_forms_core.sql:39-84`). The 2a audit
trigger writes one row per change with before/after `{key, version, provider,
effects}` and `action = coalesce(cockpit.forms_action, 'forms.cockpit_forms.update')`
(`:333-403, :551-553`); only delete and truncate are refused (`:584-596`). Mode
follows provider in `cockpit_form_access`, `_entry` and `_open` (`:604-622,
:1330-1348, :1356-1432`). The editor gate admits the CEO, an admin, a
`forms_editor` role or a `cockpit_forms_editors` row and returns `who`
(`20261025n_slack_notices.sql:657-682`). Tests flip the registry by direct
UPDATE at `checkin-plans-supabase.test.ts:1310, :1500`,
`forms-core-supabase.test.ts:1147, :1430, :5368, :5856` and
`fathom-intake-supabase.test.ts:3595`, so 2b adds no guard trigger on
`cockpit_forms` (Z12).

**The change** (`s`, section 2.3):
- `cockpit_form_registry_set(p_form_key, p_patch)`: `g := cockpit_forms_editor_gate()` first, inside `BEGIN ... EXCEPTION WHEN insufficient_privilege` that re-raises 42501 with 3.12's registry sentence `Only the CEO, an admin or someone they add can change where the 1-1 notes go.` (the gate's own sentence names notices and routing, `20261025n_slack_notices.sql:666, :677`); then `cockpit_form_registry_apply(p_form_key, p_patch, {email: g.email, who: g.who, via: 'cockpit'})`.
- `cockpit_form_registry_apply(p_form_key, p_patch, p_actor)`: `SELECT ... FOR UPDATE`; the patch is an object with only `provider` and `owners`; `owners` is a string (every effect) or an object keyed by existing effect keys; values `make|shadow|cockpit`; else the bad-patch sentence (3.12). Only `checkin` may change. A provider change needs `p_actor.who = 'ceo'` or `p_actor.via IN ('cutover','cutover-rollback')`, the provider value must be `typeform` or `native` (anything else is a bad patch), and provider `native` is allowed only with `p_actor.via = 'cutover'`: the CEO seat may move the provider only back to `typeform`; every seat asking `native`, the CEO included, gets 3.12's `The 1-1 notes open in the cockpit only through the switch-over function at the cut-over hour.` (Z54). Provider `native` requires `call_form` and `call_match` to be `cockpit`. Every effect becoming `cockpit` must pass `cockpit_form_delivery_ready`. `typeform_id` is never written. A no-op returns the view and writes nothing. Otherwise it sets `cockpit.forms_action = 'forms.registry_set'` (and `cockpit.audit_actor`, `cockpit.audit_source` from `p_actor` on the owner path), updates `provider`, the effects' `owner` only (key, delivery, label kept), `updated_by`, `updated_at`; the 2a trigger writes the audit row and `cockpit_forms_provider_since` sets `provider_since`. When provider becomes `native` it calls `cockpit_form_shadow_close` in the same transaction. Answer: `cockpit_form_registry_view`.
- `cockpit_form_checkin_cutover()`: pre-flight refusals, each a 3.12 sentence and nothing written: the newest `fRokTITH` row in `cockpit_csm_call_forms` has no `task_id`; `cockpit_form_delivery_ready` fails for any check-in effect; provider already `native` (which is what "the switch-over already ran" means). There is no refusal on existing live check-in responses (Z65): after a rollback past step 8 the canary's live responses, any native notes and build 9's `legacy` rows stay as records (responses are never deleted, `20261027f_forms_core.sql:584-596`), and a second hour must still be able to run this function with all its checks. These three are all its refusals: a fourth on open `form` rows in the ClickUp queue was proposed and rejected (Z73). Then `cockpit_form_shadow_close('checkin')` and `cockpit_form_registry_apply('checkin', '{"provider":"native","owners":"cockpit"}', '{"via":"cutover","email":"cut-over"}')`. Answer `{voided, registry, nativeSince, auditId, newestTypeform: {token, submittedAt, taskId}, unlinked14d: [tokens with neither recording_url nor linked_call_id in 14 days]}`.
- The rollback is the same core: `select public.cockpit_form_registry_apply('checkin', '{"provider":"typeform","owners":"shadow"}', '{"via":"cutover-rollback","email":"cut-over"}')`, which restores the seeded row's `provider`, `typeform_id`, `version` and `effects` exactly (the test proves those four; `provider_since`, `updated_by` and `updated_at` change, as they must).

**Tests**: `apps/media-buyer-cockpit/scripts/forms-registry-supabase.test.ts`
(the gate's seats: CSM-only, switched off and no seat get 42501 with the
registry sentence; admin, CEO and an editor row change owners; a provider
change refused for the admin and the editor; `native` refused for every seat,
the CEO included, and allowed only with `via = 'cutover'`; the CEO and
`cutover-rollback` may move it back to `typeform`; each refused patch;
`typeform_id` stays `fRokTITH`; each readiness clause, then passing with
stand-ins; one audit row per change and none for a no-op; native voids every
shadow draft (`forms.shadow_closed`) and `cockpit_form_open` then mints a live
draft; `provider_since` set only when the provider changes and equal to the
audit row's `created_at`; `cockpit_form_native_since`; the rollback patch
restores the seed's `provider`, `typeform_id`, `version` and `effects`; the
gate's answers per 3.1, Z70 included (a response sent before
`cockpit_form_native_since`, and any response while the provider is `typeform`,
read `Make owns this again.`); the cut-over function's three refusals and its
success; flip, a live canary submit, roll back, flip again succeeds through
`cockpit_form_checkin_cutover()` with its checks; exact grants).

### 4.8 Build 8: kickoff and Blueprint in the forms tables (db, `y`; worker)

**State now.** No `forms-door` exists. The registry rows (`20261027f_forms_core.sql:2052-2074`,
live identical): kickoff `typeform tG7dnxBn` with `handoff_comment,
onboarding_tasks, card_fields, map_phase4, phase4_whatsapp` `make`,
`kickoff_notice` `cockpit`, `recap` `shadow`; blueprint `native` with
`launch_task, close_card, offer_card, close_notice, media_notice` `cockpit`,
`phase5_whatsapp, recap` `shadow`. Stage 1 delivers the kickoff notice under
`'kickoff:' || response_id` (`20261025n:912-930`), a Blueprint press inserts its
outbox row in `cockpit_blueprint_part_done` (`20261025o_blueprint_close_drain.sql:561-660`)
and the close and media notices are queued when that row leaves `sending`
(`20261025n:947-990`). `hermes/csm-calls` stores every `tG7dnxBn` response
with full answers every 15 minutes (`sources.ts:54-60, :330-336, :443`).
Live: 8 `tG7dnxBn` rows stored, 30 Stage 1 kickoff notices all `skipped`, 0
Blueprint presses (section 16).

**The SQL** (`y`, section 2.9):
- Keys: one provider, `typeform_kickoff` (Z58); `cockpit_forms_key_put` validates its secret (32 to 128 url-safe characters) and, like `fathom_webhook`, writes registration detail to `cockpit_sync_state` `forms-door:kickoff`; `cockpit_forms_key_mark` also accepts `typeform_kickoff` (connected or refused, as `forms_key.py` marks it, `scripts/dev/forms_key.py:467`, `:493`) and on a mark writes `forms-door:kickoff` `detail.registered`; label `Typeform kickoff signing key`; `cockpit_forms_keys_status` keeps `keys` to its four providers exactly as today and adds a separate top-level `typeform: [{form: 'kickoff', connected, last4, registered, lastDelivery}]` (Z57), because the deployed CEO card parses `keys[].provider` as `z.enum(["fathom","fathom_webhook","deepseek","anthropic"])` and turns any parse failure into an error (`apps/media-buyer-cockpit/src/lib/formsKeysClient.ts:19-20`, `:84-86`), while zod drops an unknown top-level key, so the card still parses.
- `cockpit_form_record_typeform(p)` (3.9): for `via = 'typeform_webhook'` it first inserts the `cockpit_csm_call_forms` row the worker would write (`form_id` = the registry's `typeform_id`, `form_kind` from the fixed map `kickoff -> kickoff`, `task_id` = hidden `onboarding_client_id` when it is a card in `cockpit_csm_sources` clients, else NULL with the typed client, `matched_by 'hidden_field'`, full hidden and answers) `ON CONFLICT (token) DO NOTHING`; then the response (`source` = via, `external_id` = token, `task_id` from the stored row, client name from the roster, `mode 'live'`, `state 'submitted'`, `created_by 'typeform'`, `submitted_at`, 3.9's `hidden` and `answers`) `ON CONFLICT (form_key, external_id) DO NOTHING`; then one effect per registry effect owned `make` or `shadow`, `skipped` with `Make owns this.` or `No cockpit plan for this yet.` Refusals 22023 in plain sentences.
- `cockpit_form_record_sweep(p_apply)`: an advisory transaction lock, at most 200 inserts a call, nothing written when `p_apply` is false: (a) every `tG7dnxBn` row with no kickoff response is recorded (`via typeform_sync`); (b) every `blueprintLaunch`, `blueprintClose` or `blueprintOffer` outbox row with no response becomes one (id = the outbox id, `source 'cockpit'` with `created_by_id` = the outbox actor, or `source 'import'` and `created_by 'import'` when the row names no actor; `state 'submitted'`, `answers {part, press, outboxId}`), with that part's `shadow` effects `skipped`; (c) each `cockpit`-owned kickoff or Blueprint effect is recorded from its Stage 1 row, under `cockpit.forms_record = 'on'`: Stage 1 sent it (notice `posted`; outbox `done` or `reconcile`): `INSERT` `delivered` with `delivery_ref` = that row's id and `plan {recorded: true, stage1: {table, id, dedupeKey, state}, lines: []}`; it ended unsent (notice `skipped`, `muted` or `failed`; outbox `failed`): `skipped` with `Stage 1 did not send it: {reason}` or `The press did not run: {error}`; in flight: nothing yet; a notice of that key made for another press: `skipped` `Posted for an earlier press.`; no Stage 1 row 48 hours after the response: `skipped` `No Stage 1 notice was made for this kickoff.` (or `... for this press.`). Never a delivery row, never `planned`, never through submit step 10 (Z21).
- `cockpit_forms_door_seen(p_form_key, p_outcome, p_reason)`: `cockpit_sync_state` `forms-door:kickoff` last delivery and outcome (3.9's outcomes only).

**The worker** (worker):
- `supabase/functions/forms-door` (new, `verify_jwt` off): routes only `POST /forms-door/typeform/{formKey}`; other paths 404 `{"ok":false}`, other methods 405; body over 1.5 MB 413; `formKey` must be exactly `kickoff` (Z58: the checkin row also has a `typeform_id` and provider `typeform`, so a check against the registry alone would admit it, and a checkin webhook registered by mistake would store `mode 'live'` responses), and that registry row must still have a `typeform_id` and provider `typeform`, else 404; secret `cockpit_forms_key_get('typeform_kickoff')`, cached 5 minutes (30 s when missing); no secret 503 `{"ok":false}` and `seen('failed', 'No signing key saved')`; the signature checked with `signedByTypeform` from `../team-onboarding-intake/signature.ts` (`:14-25`) before anything is parsed, else 401; `event_type` must be `form_response` and `form_response.form_id` the registry's id, else 202 `{"ignored":true}`; a signed request with `x-forms-door-probe: 1` answers 200 `{"ok":true,"probe":true}` and stores nothing; else `formAnswers(item, fieldTitles(definition))` and `recordingIn(answers)` from `../../../hermes/csm-calls/match.ts`, then `record(...)` through `restRpc` (`cockpit-hours-sync/db.ts:23`); a store failure 500 (Typeform retries); a repeat 200 with `inserted false`. No body, answer or hidden value is ever logged.
- `hermes/csm-calls/lib.ts` `makeDb` gains `rpc(name, args)` (POST `/rest/v1/rpc/{name}`, name `^cockpit_[a-z0-9_]+$`); `sources.ts` export `formsRecord(ctx)` calls `cockpit_form_record_sweep` with `p_apply = ctx.apply` and writes `csm-forms-record` (3.11); `worker.ts`'s default `--only` list (`:140`) adds `forms`, run after `eods`; the doctor probes it with `p_apply false`.
- `scripts/dev/forms_key.py` accepts `<form>` = `kickoff` only (any other form exits 2 with `Only the kickoff form has a cockpit webhook in 2b.`); its `status` prints the `typeform` list of `cockpit_forms_keys_status` (last 4 only); it gains `typeform-secret <form>` (32 random bytes, base64url, saved by `cockpit_forms_key_put` as server, never printed), `register-typeform <form>` (`GET /forms/{id}/webhooks`, `PUT /forms/{id}/webhooks/cockpit {url: https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/forms-door/typeform/{form}, enabled: true, secret, verify_ssl: true, event_types: {form_response: true}}`, `GET` read-back, mark connected), `probe-typeform <form>` (unsigned POST must get 401, signed probe 200) and `unregister-typeform <form>`; every Typeform call writes intent and response or unknown receipts into `cockpit_csm_provider_health` (Y55).
- B3 is run by the main session at deploy D17 (Z22); refused, it waits for a later session and nothing depends on it.

**Tests**: `supabase/functions/forms-door/handler.test.ts` (every route and
refusal above; `checkin` and any form but `kickoff` answer 404; the handler's
`formAnswers` and `recordingIn` mapping of a signed Typeform body; the record
call carries 3.9's pointer `answers` and `hidden` only; each `seen` outcome of
3.9; no body, answer or hidden value in any log line);
`apps/media-buyer-cockpit/scripts/forms-record-supabase.test.ts` (db: one
response whatever writes first; the stored row inserted only when absent and a
manual match never overwritten; `make` effects skipped; `kickoff_notice`
waiting, delivered, skipped and the 48-hour sentence; presses and the earlier
press; the counts of `cockpit_slack_notices`, `cockpit_creative_outbox` and the
writeback queue never change; the guard refuses `INSERT delivered` without the
flag, for owner `make`, with `delivery_ref` NULL and for `checkin`; `p_apply
false` writes nothing; a second sweep writes nothing; audit rows hold no hidden
email or phone; the keys CHECK takes `typeform_kickoff` and refuses
`typeform_checkin`; `cockpit_forms_key_mark` marks `typeform_kickoff`
connected, then refused, and still refuses an unknown provider;
`record_typeform` and `door_seen` refuse `checkin`; after a `typeform_kickoff`
put, `cockpit_forms_keys_status().keys[].provider` stays within the four and
the key appears only in `typeform`; the body-diff rule for the four key
functions; the ACLs of 2.2; grants); `hermes/csm-calls/lib.test.ts`,
`sources.test.ts`; `scripts/dev/test_forms_key.py` (a form other than
`kickoff` exits 2).

### 4.9 Build 9: late Typeform check-ins (db, `x`; worker)

**State now.** `readTypeforms` writes every `fRokTITH` response as `form_kind
'checkin'` (`hermes/csm-calls/sources.ts:54-55, :347-359`) and fills
`ctx.shareToTask` from every one (`:361-366`); `storedFormLinks` reads
`form_id=eq.fRokTITH` with no kind filter (`:572-577`); `csm-checkin-form` is
always `ok: true` (`:463-470`); `--only` is `worker.ts:140` (2a cited `:122`).
SQL readers filter `form_kind = 'checkin'` (`20261027f:724-729, :1020-1024`,
and `20261027g:370, :766, :1169`; `20261027f:1189-1197` is the native
write-through's `INSERT`, `form_id 'cockpit-checkin'`, which the late trigger
never touches), but the timeline's call form
join has no kind filter (`20261011f_csm_eod_mentions.sql:56-57`) and the brief
falls back to it (`clientBrief.ts:1555`). Live: the `form_kind` CHECK has no
`checkin_late` (query in section 16).

**The SQL** (`x`, section 2.8):
- the CHECK widened;
- `cockpit_csm_call_forms_late()` (BEFORE, `SECURITY DEFINER`, `search_path ''`): when `NEW.form_id = 'fRokTITH'` and either the old row is already `checkin_late` (on UPDATE; sticky) or `cockpit_form_native_since('checkin') IS NOT NULL AND NEW.submitted_at >= cockpit_form_native_since('checkin')`, it sets `NEW.form_kind := 'checkin_late'` and `NEW.linked_call_id := NULL` (a link would let the timeline join and the brief read it); on a first classification it inserts one `cockpit_audit_log` row `csm.checkin_late` (entity `cockpit_csm_call_forms` / token, before `{formKind: 'checkin'}`, after `{formKind: 'checkin_late'}`, metadata `{submittedAt, nativeSince, taskId}`; no answers);
- `cockpit_csm_call_forms_legacy()` (AFTER): sets `cockpit.forms_action = 'forms.late_typeform'` and `cockpit.audit_actor = 'typeform'`, then inserts the `cockpit_form_responses` row (`form_key 'checkin'`, `form_version` = the registry version, `source 'typeform_sync'`, `external_id` = token, `task_id`, `client_name` from the roster, `mode 'live'`, `state 'legacy'`, `answers '{}'`, `hidden {typeformToken, formId: 'fRokTITH', submittedAt}`, `created_by 'typeform'`, `submitted_at`) `ON CONFLICT (form_key, external_id) DO NOTHING`; no effects; inside `BEGIN ... EXCEPTION`, a failure writes `forms.late_typeform_failed` and never blocks the store write (Z14).

**The worker** (worker): `readTypeforms` reads `cockpit_forms?select=provider,provider_since&key=eq.checkin`
once (`checkinCutover(db)`), `priorForms` also selects `form_kind`; a
`fRokTITH` item is late when the registry is native and `submitted_at >=
provider_since`, or its prior row is `checkin_late`; a late row is written
`checkin_late`, never enters `shareToTask`, and `counts.fRokTITH` gains `late
{sinceCutover, last14d, newest}`; `ctx.plan.cutover` records the time.
`linkTypeforms` skips late rows (no `linked_call_id` patch, no own call row, no
retire); a late row with no card is queued with `1-1 notes sent in Typeform
after the switch-over, with no client on the board.`; `csm-checkin-form`'s note
appends `{n} 1-1 notes arrived in Typeform after the switch-over (newest
{day}).` with `detail.late`, and **stays `ok: true`** (Z15). `storedFormLinks`
adds `&form_kind=eq.checkin`. The guardian's `run_checkin_form` also reads
`checkin_late` rows of the last 14 days after the cut-over and warns `{n} 1-1
notes arrived in Typeform after the switch-over, newest {Kuwait time}:
{clients}. Re-enter them in the 1-1 notes in the cockpit and check that fRokTITH
is closed.`; its freshness keeps reading `checkin` only.

**Tests**: `apps/media-buyer-cockpit/scripts/late-typeform-supabase.test.ts`
(db: the CHECK; nothing reclassified while `typeform`; after a flip through the
core, a row after `provider_since` becomes late on INSERT and on an upsert that
re-sends `checkin`, and loses its `linked_call_id` even when an old worker
patches it; one before stays; sticky after a flip back; one `csm.checkin_late`
row per form; one legacy response per late row with a card, inserted when a
later update sets `task_id`; the legacy row and the late form are invisible to
`cockpit_form_call_noted_at`, `cockpit_form_recording_tied` rule 3,
`cockpit_fathom_match_inputs`, `cockpit_form_draft_inputs`,
`cockpit_csm_calls_summary` and `cockpit_csm_client_timeline`'s call form; it
never trips the one-live-recording index nor blocks a native submit; a forced
legacy failure still commits the store row), `hermes/csm-calls/sources.test.ts`,
`hermes/cockpit-guardian/tests/test_csm_calls.py`.

### 4.10 Build 10: impromptu calls without notes (screens; worker for the guardian)

**State now.** `afterCallRows` lists only clients with `noteMissing && lastCall`
(`apps/client-success-cockpit/src/components/AfterCalls.tsx:58-71`), so a call
on no client (a candidate) never shows; `AfterCalls` mounts at
`CsmPage.tsx:3041`. The queue that places a candidate (`UnmatchedQueue`,
`ClientCalls.tsx:471-640`) mounts only on a client's overview; its read is
`readUnmatched` (`csmCalls.ts:335-344`) over `cockpit_csm_unmatched_list`
(`20261027g:1285-1306`: id, kind, title, at, reason, hint, host, candidate; a
CSM sees only her own host rows); the writers `matchUnmatched`
(`csmCalls.ts:345`) and `settleCandidate` (`:370`) are gated and audited. The
guardian's `csm-calls-unmatched` leaves candidates out and has confirm 3
(`hermes/cockpit-guardian/checks/csm_calls.py:270-276`). Live: 3 open
candidates, all older than 24 hours, all recorded by the CSM-only seat, none
named by a response (section 16).

**The change.**
- Screens: new `src/components/ImpromptuCalls.tsx` (`useImpromptuCalls(enabled)` reads `readUnmatched` only when `entry.native`, on mount and when `snap.at` changes; keeps items with `kind === 'call' && candidate && lower(host) === lower(auth.email)`), the row and the Place sheet of section 5.2. `AfterCalls.tsx` takes `onPlaced?: () => void`, merges the impromptu rows into one list sorted newest first, counts both kinds, hides the card only when there is nothing and both reads worked. `CsmPage.tsx:3041` becomes `<AfterCalls snap={snap} onPlaced={() => void sb.refetch()} />`. No SQL, no new writer: both actions use the existing gated, audited RPCs (Z17).
- Guardian (worker): helper `_cutover(ctx)` reads `cockpit_forms` `provider, provider_since` for checkin (native only); `_candidates_without_notes(ctx, cutover)` reads `cockpit_csm_calls` alone (`source eq fathom`, `candidate eq True`, `starts_at gte cutover`, `starts_at lt now minus 24 h`; plain columns `id, source_id, starts_at, status, settled_reason`) and keeps `status != 'gone'` and no `settled_reason` in Python. It never reads `cockpit_form_responses`: the guardian's REST door selects plain column names only (`hermes/cockpit-guardian/guard/db.py:28`, `:123-131`), so reading `answers.call.recordingId` would mean pulling whole `answers` objects (the CSM's notes); and it need not, because a native send whose recording was a candidate delivers `call_match`, whose attach sets `candidate = false` (`20261027f_forms_core.sql:1103-1105`), so a candidate still standing after 24 hours has no notes; `run_unmatched`'s evidence gains `candidates_without_notes_24h` (null before the cut-over); new check `csm-impromptu-notes` (area workers, name `Impromptu calls get a client`, means `Every impromptu call the CSM records gets a client and 1-1 notes, or is set aside as not a 1-1 call.`, severity medium, confirm 2, owner the CSM lead, report-only): before the cut-over ok `Counted from the switch-over to 1-1 notes in the cockpit; not switched yet.`; 0 ok `{n} impromptu calls since the switch-over all have 1-1 notes or a client.`; above 0 warn `{n} impromptu calls older than a day have no client and no 1-1 notes: {Kuwait days}. Put each on its client and write its notes, or mark it Not a 1-1 call.` with items = recording ids, evidence `{cutoverAt, candidates_without_notes_24h, oldestDay, recordingIds (10 at most)}` and the action `Open Today: each impromptu call has Place it and Not a 1-1 call.`

**Tests**: `apps/client-success-cockpit/scripts/after-calls.test.tsx` (provider
`typeform`: no `cockpit_csm_unmatched_list` call; native: the row's words, clock
and hint, sorted and counted; another host's candidate, a non-candidate and a
form item never show; Place it opens `Whose call was this?` with focus in
`Find a client`, Arabic search, a pick calls `cockpit_csm_manual_match`, toasts
`Saved on City Wood.`, removes the row, calls `onPlaced` once and moves focus;
each Not a 1-1 call reason calls `cockpit_csm_candidate_settle`; a refusal keeps
the row; a failed read keeps the card with its sentence; every button named with
its day and time), `csm-page.test.tsx` (`onPlaced` refetches), and
`hermes/cockpit-guardian/tests/test_csm_calls.py` (each counted and uncounted
case, confirm 2, evidence without host email, title or answer text).

### 4.11 Build 11: moving a recording to another client (db, `z`; writers; screens)

**State now.** The save refuses a recording on another card for every seat
(`20261027f_forms_core.sql:839`, `cockpit_form_checkin_value`), the tie rule
ties nothing on another card (`:673`), and the attach refuses another client
with `That recording is on %. If that is wrong, ask an admin to move it.`
(`:1080-1083`). The door builds that sentence (`fathom.ts:226, :228`);
`CallView` has no move flag (`calls.ts:57-87`); the window renders a blocked row
as a disabled button (`CheckinCall.tsx:519-591`, `:554`) and sets seat `admin`
for admins and the CEO (`CheckinWindow.tsx:125`). Today a wrong worker match is
fixed only by an admin through SQL.

**The change** (Z16: its own RPC; `cockpit_csm_attach_recording` unchanged and
still refusing another client's recording, so a send can never move one):
- `z`: the switch seed and `cockpit_forms_switch` (section 2.10). `cockpit_csm_move_recording(p_recording_id, p_task_id)`, `SECURITY DEFINER`, `search_path ''`, in order: (1) `cockpit_form_actor()` (`20261027f:304`) must be admin or CEO, else 42501 `Only an admin or the CEO can move a recording to another client.`; (2) the switch off: 22023 `Moving a recording is not switched on yet.`; (3) both ids validated as the attach does; (4) `cockpit_csm_client_gate_for_actor` for the target; (5) the Fathom call row `FOR UPDATE`; (6) none, or `task_id` NULL: `That recording is not on another client. Pick it from the list.`; `task_id = p_task_id`: `That recording is already on this client.`; (7) the store row's class not `client`/`candidate`, or gone: the attach's sentences; (8) notes guard: a `cockpit_csm_call_forms` row linked to the row or to its linked booking, or a live `submitted`/`confirmed` check-in response naming the recording: 22023 `That recording has 1-1 notes on {client}. If those notes are on the wrong client too, tell the tech lead.` (only the client name the seat may see); (9) `v_link := cockpit_csm_booking_for(p_task_id, room, starts_at)`; (10) UPDATE `task_id`, `client_name` (roster), `match_method 'manual'`, `match_confidence 1`, `candidate false`, `settled_reason NULL`, `hints '[]'`, `linked_call_id v_link`, `kind = coalesce(the booking's kind, CASE WHEN the old linked_call_id IS NOT NULL THEN 'other' ELSE kind END)`; (11) resolve any open queue row; (12) one `cockpit_csm_match_audit` row; (13) one `cockpit_audit_log` row `csm.recording_moved` with before/after `{taskId, clientName, matchMethod, matchConfidence, linkedCallId, kind}` and metadata `{recordingId, callId}`; answer `{ok: true, callId, fromTaskId, taskId}`. The worker keeps `manual` rows (`keepManual`, `hermes/csm-calls/sources.ts:129, :193, :419`), so it never re-places a moved recording.
- Writers: `calls.ts` gives 3.8's `movable`; `fathom.ts` exports 3.8's `onOtherMovable(other, client)`; `testkit.ts` answers `cockpit_forms_switch`.
- Screens: section 5.3.

**Tests**: `apps/media-buyer-cockpit/scripts/forms-move-supabase.test.ts` (each
refusal and its sentence with nothing written; admin and CEO moves with the
switch on: every column, the booking re-link or NULL, the inherited kind
dropped, one match-audit and one `csm.recording_moved` row; after a move
`cockpit_form_recording_tied(rec, new task, CSM seat)` is true and the old
card's false, and `cockpit_form_checkin_value` accepts the pick for the CSM;
grants: `authenticated` only for the move, `service_role` only for the switch);
`supabase/functions/cockpit-forms-api/calls.test.ts` (`movable` per 3.8; the
CSM's A7.3 sentence unchanged at `:370, :1172`; switch off or unreadable:
never movable); `apps/client-success-cockpit/scripts/checkin-window.test.tsx`
(section 5.3).

### 4.12 Build 12: the brief's short to-dos (parity; G11)

**State now.** `noteLines` (`apps/client-success-cockpit/src/lib/clientBrief.ts:1177-1198`)
joins any part under four words to the next (`:1186-1193`) and a last short part
to the one before (`:1194-1196`), whatever its `OWNER_OURS` / `OWNER_THEIRS`
label (`:425-427`); the call at `:1746-1749` parses Client Notes and Additional
Notes as one text. The 11 `test.failing` cases at
`apps/media-buyer-cockpit/scripts/checkin-plans-supabase.test.ts:1108-1237`
record it (bun counts a failing `test.failing` as a pass).

**The change** (the only change to `clientBrief.ts`): `const labelled = (t:
string) => OWNER_OURS.test(t) || OWNER_THEIRS.test(t)` on the cleaned part; a
labelled part is never joined (a pending short unlabelled carry is first
appended to the last out line when that line is unlabelled, else pushed alone;
then the labelled part is pushed whole); an unlabelled part keeps today's rule,
but its carry never joins into a labelled line; a leftover carry joins the last
out line only when it is unlabelled. The call at `:1746-1749` becomes two
`noteLines` calls, Client Notes then Additional Notes. No migration.

**Tests**: the 11 cases drop `.failing` and pass, and the two header comments
at `:11-16` and `:1090-1107` are rewritten to say so (the `:14` line holds the
literal `test.failing` today, so it must go or the grep below prints 1); `grep -c 'test.failing'
apps/media-buyer-cockpit/scripts/checkin-plans-supabase.test.ts` prints 0;
`client-brief.test.ts` keeps its fragment-joining case and adds three (a
Typeform `Client: Pay` stays whole on theirs; a two-word unlabelled fragment
before `Mahara: Send the invoice` joins the line before; `Very happy.` alone
stays the recap and Additional Notes' first line stays a promise);
`csm-page.test.tsx` and `checkin-form.test.ts` stay green.

### 4.13 G3's They owe fix (parity; writers bump one constant)

**State now.** One rule (Y56) at `supabase/functions/cockpit-forms-api/todos.ts:42-49`:
a maharamedia.com email or any Fathom team is ours; another email is theirs; no
email: the transcript's speaker side when known, else ours with `unsure: true`.
The replay strips assignee names (`checkin-replay.ts:533-541`) and passes no
`sideOfName` (`:890-892, :936-939`), so every name-only item lands in We owe.
The 2026-10-29 replay had They owe empty on 8 of 10 forms. Live: the 10 replayed
recordings hold 53 action items, 40 to the recorder, 6 to a client email, 7 to
a name with no email or team, none matching a staff first name (section 16).

**The change** (nothing invented, nothing dropped; one Fathom item stays one
line in Fathom's words, only its side moves):
- `todos.ts`, the no-email-no-team branch with a name: (i) the transcript's side when `sideOfName` knows the name (unchanged); (ii) else a name on the staff list (`sameName` from `./transcript.ts` against `ctx.staff[].name`) is `we`, `unsure: false`; (iii) else `they`, `unsure: true`. No name at all: `we`, unsure (unchanged). Emails and teams unchanged (Z24). This amends Y56's "import-free but a type": `todos.ts` imports `sameName` from `./transcript.ts`.
- Writers: `drafts.ts:46` `TODOS_VERSION = "checkin.todos.v2"` (no stored draft exists, so nothing redrafts).
- Replay (`checkin-replay.ts`): the live select emits, per action item, `assignee.name` as the matching active `cockpit_people` name when its first word equals a staff first name, else `'Contact ' || left(md5(lower(btrim(name))), 8)` (no contact name leaves the database); per response `todos.assignees {recorder, staff, clientEmail, nameOnly, none}` counts; the check `ours + theirs = the stored action items not completed`; the `todo_comment` verdict keeps `differs` but carries `explained: true` and either `They owe is empty: Fathom assigned all {n} action items to the recorder; none names the client side.` or `Make's comment is GPT's list from the whole transcript and the Additional Notes ([3]); the plan is Fathom's {n} action items, which the CSM edits before she sends.`; the report adds `every to-do comment difference explained: 10 of 10`.
- Expected re-run (read only): They owe non-empty on 7 of 10; item counts unchanged; the 3 still empty explained by all items assigned to the recorder.

**Tests**: `supabase/functions/cockpit-forms-api/drafts.test.ts` (parity: two
existing cases change. The case at `:563-575` becomes `['we', false, null]` for
the team item and `['they', true, null]` for a name-only non-staff contact. The
case at `:552-560` changes too: `Check the spend plan` (assignee `Someone
Else`, no email or team, fixture `:69`, not a transcript speaker) moves from
`we`, unsure, to `they`, unsure, and since `todosOutput` returns `[...we,
...they]` in input order (`drafts.ts:266-273`), the expected array becomes
`Send the new designs` (`we`, `the creative director`, 62, unsure false),
`Send the logo files` (`they`, 150, false), `Book the next shoot day` (`they`,
12, false), `Check the spend plan` (`they`, owner null, 40, unsure true), each
with today's `href`; new cases for a staff
full name, `Speaker 2`, no name, the transcript winning; `TODOS_VERSION` v2),
`apps/media-buyer-cockpit/scripts/checkin-replay.test.ts`, and the live re-run
`cd apps/media-buyer-cockpit && bun scripts/checkin-replay.ts --live --fixture
/Users/abdulazizwaheedi/mahara-cockpits/notes/stage2/fixtures/replay-10.json --out
/Users/abdulazizwaheedi/mahara-cockpits/notes/stage2/replay` (the replay half of
G3; the five real shadow runs stay a human gate).

### 4.14 O1: the CEO's design follow-ups (screens)

- **O1a focus ring.** `src/index.css`: `:root` `--ring: var(--primary-ink)` and `--sidebar-ring: var(--primary-ink)` (light; `.dark` unchanged, its `--primary-ink` is teal); the base `outline-ring/50` becomes `outline-ring`; a zero-specificity base rule `:where(a[href], button, summary, [role="button"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])):focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`. `src/components/ui/button.tsx:8`: `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background` (was `ring-1`). Measured: teal on the light page 1.87:1 (fails 3:1); ink `#00807B` 4.60 on the page, 4.80 on a card, 4.18 at the lowest (accent); teal on dark 9.33.
- **O1b ExtLink contrast.** `src/components/kit.tsx` exports `LINK_INK = 'text-[color:color-mix(in_oklab,var(--primary-ink)_90%,var(--foreground))]'`; `ExtLink` (`kit.tsx:249-272`) defaults to it with `rounded-sm`; `CheckinFields.tsx:56-57` `PANEL_INK` becomes `export const PANEL_INK = LINK_INK` (same string, so `checkin-window.test.tsx:684-693` holds). Measured at or above 4.5:1 on page, card, muted, muted/40 and accent in both themes (4.85 at the lowest).
- **O1c reduced motion.** `motion-reduce:animate-none!` on `PopoverContent` (`ui/popover.tsx:31`), `SheetOverlay` and the sheet base (`ui/sheet.tsx:24, :34`, plus `motion-reduce:transition-none`), `DropdownMenuContent` and `SubContent`, `TooltipContent` (`ui/tooltip.tsx:21`); `tw-animate-css` ships no reduced-motion rule.
- **O1d `docs/DESIGN.md`**, three bullets after the Controls rule (`:75-80`), word for word: (1) `Required radio pills in a form (the 1-1 notes window's DEFCON and Priority) depart from the filter pill on purpose: the chosen pill carries a Check icon, semibold text and a 2px inset --primary-ink ring on bg-primary/15 (4.6:1 on the light page); an unchosen one a 1px inset --border ring; focus is a separate 2px ring set 2px outside the pill, so a focused pill never reads as chosen. Filters and tabs keep the rule above.` (2) `Focus: every control shows a 2px --ring ring set 2px off it on the page colour. --ring is the ink teal #00807B on the light page and Mahara Teal on dark, 3:1 or more on every surface; never a 1px teal ring. Client success follows this now; the other cockpits move to it on their next pass.` (3) `External links (ExtLink) are the ink teal mixed 90% with the text colour, 4.5:1 or more on cards, panels and hover in both themes. Overlays (popover, sheet, menus, tooltips) do not animate under reduced motion.`
- **Tests**: new `apps/client-success-cockpit/scripts/design-tokens.test.ts` (tokens; the base rule; `buttonVariants()` classes; a contrast helper (oklch to sRGB, WCAG luminance) computing the ring at 3:1 or more and `LINK_INK` at 4.5:1 or more on every named surface in both themes; the motion classes); `checkin-window.test.tsx:2550, :2719`, `form-contract.test.ts:209-224`, `csm-page.test.tsx:1508-1517` and `form-panel.test.tsx` stay green.

### 4.15 The window copy that changes at the cut-over (screens)

Already keyed to the registry and the response mode in 2a (no change): the Seal
(`CheckinWindow.tsx:249-263`), the shadow banners (`:635-668`), the send label
`Send the notes` / `Sending the notes…` / `Notes sent.` (`:781-783, :862-871`),
FormsButton (`FormsButton.tsx:55-59, :112-116`), the Log a call line
(`CsmPage.tsx:2352-2354`), the Typeform arrow (`AfterCalls.tsx:51-55`), the
trail (`checkinTrail.ts:53-88, :293-296`), and booking only in a live response.
Wrong after the flip, so changed:
1. `CheckinRecap.tsx` takes `live: boolean` from `CheckinWindow` (`m.sent.response.mode === 'live'`). Live, the header (today `:186-189`, `Make still sends 1-1 recaps until the switch-over, so this one is not sent from here.`) reads `Approve the recap here or on the client's Messages card. The client gets it only after someone approves it.` and, once the recap effect's owner is `cockpit` and its message row exists, the step renders the shared `RecapApproval` (section 5.1); between the draft turning ready and the row appearing it reads `Getting the recap ready to approve…`. Shadow keeps today's lines.
2. `formsRegistry.ts:440-473` `useCheckinNudges` reads `useCheckinEntry()`: when `entry.native` it asks Typeform nothing (`[]` to `useTypeformSent`, no marker) and returns `{kind: 'button'}` for each item, so every nudge opens the window.
3. **Not built in 2b:** after cut-over step 10's links follow-up only (11.4, Z31), the entry fallback for provider NULL opens the window (`formsRegistry.ts:43` `ENTRY_FAILED` becomes `The cockpit could not read where 1-1 notes go, so this opens the cockpit's notes.`, `:166-168`), and the window's "Not live yet" state drops `Open the 1-1 form` and reads `The cockpit's 1-1 notes could not open. Try again in a minute.`
4. `checkinTrail.ts`: a `clickup_queue` effect still `queued` 15 minutes after `EffectView.at` reads `Still waiting for the card writer. The tech lead is told after 15 minutes.` (client side; no SQL change, Z47).

**Tests**: `checkin-window.test.tsx` (a live sent response shows the live
header and no `Make still sends`; shadow unchanged; one `role=status` line),
`after-calls.test.tsx` (native: no `checkin.typeformSent` call, a stored marker
ignored, every row opens the window), `forms-button.test.tsx`,
`checkin-trail.test.ts` (the 15-minute line).

### 4.16 G5: the WhatsApp phone check (notices; run by the main session)

`hermes/client-messages/g5.ts`, command `run.sh g5 --task <card> --at <iso>
[--task ... --at ...]`, read only, receipts under `run_key 'client-messages:g5'`:
for each pair, the group from Client Data by `groupOf`; `GET
https://gate.whapi.cloud/messages/list/{group}?count=100&time_from={at-180}&time_to={at+180}`
with the guard token (offset paging to 500 if the time filter is ignored; keep
only messages within 3 minutes); the message whose `text.body` holds both
`SHjlq0UjeR11maltYNyh` and `إذا ما حجزت مكالمة المتابعة` (Make [23]'s block).
Verdict: `from_me === true` (the field `transport.ts:390` relies on) is `same
number`; `false` is `different number` (it then reads `GET /health?wakeup=false`
and records both numbers as last 4 only, for B5's sentence); an unreadable group
or no such message in any pair is `not proven`, which counts as failed (Z29).
It prints `{verdict, checked: [{task, at, found, fromMe, fromLast4}],
channelLast4}` and upserts `client-messages-g5` with `ok = (verdict = 'same
number')` and that answer plus `receiptsMissing` in its detail; the note stays
the verdict alone (Z76). No full number is printed or stored. Inputs (read only, section 16):
3 Make 07 recaps in 2 groups where the guard also posted (2026-10-13 17:55:12,
2026-10-11 18:04:06 and 18:03:48, +03).

---

## 5. The screens (screens): design plans and copy

Every new or reshaped screen below was planned with
`mahara-context/skills/frontend-design/SKILL.md` (subject and job, a compact
token set, type roles, layout, one signature element, a critique pass) inside
the cockpit's own system: Geist, `--mahara-teal` as the one primary,
`--primary-ink` for teal text in light mode, the client-success kit
(`apps/client-success-cockpit/src/components/kit.tsx`: `SectionCard` `:54`,
`StatTile` `:104`, `Dot` `:155`, `Chip` `:168`, `ExtLink` `:249`, `Kicker`
`:279`, `Fold` `:305`) and `format.ts`. This app's kit has no `StatusChip` or
`EmptyState` (those live in the media-buyer CEO kit and the sales kit): here a
state chip is `Chip` with its `Dot`, and an empty state is one plain line inside
the `SectionCard`, as 5.1's table shows; no builder adds either component. No new palette; Arabic
inside `<bdi dir="auto">` in IBM Plex Sans Arabic; no new Arabic copy (the
recap text is the 2a draft's, the booking block Make's verbatim). Quality
floor everywhere: visible keyboard focus (O1a's ring, the window's `FOCUS`,
`CheckinFields.tsx:44-45`), reduced motion respected, no horizontal scroll at
390px with a 16px gutter. Builders screenshot each harness state at 390, 820
and 1440 in light and dark (A4: delete screenshots after). The states are named
and live here: in `apps/client-success-cockpit/src/dev/checkinHarness.tsx`
(`STATES`), `messages-empty`, `messages-read-failed`, `messages-draft`,
`messages-warnings`, `messages-refused-check`, `messages-approved`,
`messages-sending`, `messages-sent`, `messages-unknown`, `messages-not-sent`,
`messages-skipped`, `today-recap-rows`, `window-recap-approval` (5.1),
`today-impromptu`, `today-impromptu-failed`, `today-place-sheet` (5.2) and
`sheet-admin-move` (5.3); in `apps/client-success-cockpit/src/dev/formHarness.tsx`,
which mounts `NoticesRouting` (`:27`, `:454`), the Notices and routing card with
the two new rows (5.4), fed by `apps/client-success-cockpit/src/dev/noticesFixtures.ts`.

The shared token set (all existing):

| Name | Value | Role |
|---|---|---|
| Mahara Teal | `#00CFC8` | the one primary action per surface; focus ring on dark |
| Ink teal | `#00807B` | teal text, rules and the focus ring on light (4.6:1 on the page) |
| Night | `#091333` | dark page |
| Navy | `#0F1B45` | dark card |
| Orange | `#F97316` (`--warning`, orange-500) | a question waiting for a person |
| Page (light) | `oklch(0.985 0.003 250)` | light page; cards are white |

Type roles: Geist 600 at 15/1.4 is the display role, used with restraint
(card titles and row leads only); Geist 400 at 14/1.5 for body and state
lines; Geist Mono 11, tabular, for clock times; IBM Plex Sans Arabic at 15/1.7
right to left for any client-facing message (the window's `NOTES_FONT`,
`CheckinFields.tsx:95-97`).

### 5.1 The Messages card, Today's recap rows and the window's recap step (build 3c)

- **Subject, audience, job.** The one WhatsApp message a client's group reads after a 1-1. For the CSM (admins and the CEO too). Its single job: say yes to that exact text, or skip it.
- **Layout.** A `SectionCard` titled `Messages`, `id="messages"`, on the client page's overview tab (tabs `CLIENT_TABS`, `CsmPage.tsx:1190-1196`, overview content `:2661`), kicker `To the client's WhatsApp group`; rows newest first:

```text
┌ Messages ──────────────────────── To the client's WhatsApp group ┐
│ 1-1 recap · call Sun 25 Oct                   (●) Waiting for you │
│ ┌──────────────────────────────────────────────────────────────┐▌│
│ │                    the message, right to left, exactly as sent│▌│
│ └──────────────────────────────────────────────────────────────┘ │
│ This is exactly what the group gets. Edit it if you need to.     │
│                                       [Skip]  [Approve and send] │
├──────────────────────────────────────────────────────────────────┤
│ 1-1 recap · call Thu 22 Oct                                 Sent │
│ Sent at 14:12. Read back from WhatsApp at 14:13.                  │
└──────────────────────────────────────────────────────────────────┘
```

  At 390px the two buttons stack under the surface at full width, primary last.
- **Signature.** The exact-bytes surface: the message rendered the way WhatsApp renders it (single `*` bold), right to left, `dir="rtl" lang="ar"`, with a 2px `--primary-ink` rule on its inline-start edge (the right, where an Arabic line begins). Its edit mode is the same surface turned into a textarea in place, so what is previewed and what is approved can never diverge. One shared component, `src/forms/RecapApproval.tsx`, serves the card and the window.
- **Critique.** The first idea, a WhatsApp-style green bubble with ticks, imitated another product's chrome and would have brought a second palette: dropped. A side-by-side "draft against edit" view was dropped: the CSM approves one text, not a diff. What stays is the plain surface with the teal rule, one primary button under the full message (so the text is read before the press), Skip beside it.
- **Today rows** (from `cockpit_client_messages_waiting`, in the Today section of `CsmPage.tsx`, each linking to `?tab=overview#messages`): `Recap waiting: {client}. Read it, then approve or skip it.`; `Recap not sent: {client}. {reason}`; for the CEO or an admin only: `Recap not confirmed: {client}. Look in the group before anything else.`
- **The window's step** (4.15 item 1): `CheckinRecap.tsx` renders `RecapApproval` once the recap effect's `owner` is `cockpit` (`EffectView.owner`, `20261027f_forms_core.sql:1214-1227`) and the row exists (`cockpit_client_messages_read` by task, picked by `responseId`), with the link `Open the Messages card` (`ChevronRight`) to `/clients/{taskId}?tab=overview#messages`.
- **Files**: new `src/lib/clientMessages.ts` (zod `MessageView`, the RPC calls), new `src/forms/RecapApproval.tsx`, new `src/components/ClientMessages.tsx`; `checkinClient.ts` gains `approveRecap(messageId, body, acceptWarnings)` (POST op `recap.approve`); `CsmPage.tsx` mounts the card and the Today rows.

| State | Chip | Line | Actions, then toast |
|---|---|---|---|
| no rows | | `No messages for this client yet. A recap appears here after you send 1-1 notes for a recorded call.` | |
| read failed | | `The messages could not be read, so a recap may be missing here. Reload the page; if it stays, tell the tech lead.` | |
| `draft` | `Waiting for you` (orange dot) | `This is exactly what the group gets. Edit it if you need to.` | `Approve and send` then `Approved. It sends within about 3 minutes.`; `Skip` then `Skipped. Nothing was sent.` |
| warnings returned | | the warnings, inline under the surface | `Approve anyway`, `Edit` |
| refused by the check | | the server's sentence, ending `Edit the text, then approve again.` (the edit is kept) | |
| `draft` after expiry | `Waiting for you` | `The approval ran out after 24 hours. Approve it again.` | as `draft` |
| `approved` | `Approved` | `Sends within about 3 minutes.` | `Edit again` (reopen) |
| `claimed`, `sending` | `Sending` | `Sending now.` | |
| `sent` | `Sent` | `Sent at {HH:MM}.` then `Read back from WhatsApp at {HH:MM}.` or `Checking it arrived…` | |
| `unknown` | `Not confirmed` | `Not confirmed: WhatsApp did not answer. The cockpit never sends it twice. Look in the group; the tech lead settles it.` | |
| `refused`, `failed` | `Not sent` | `{reason}` | `Try again` (reopen) then `Reopened. Edit it, then approve it.`; `Skip` then `Skipped. Nothing was sent.` (Z55) |
| `skipped` | `Skipped` | `Skipped. Nothing was sent.` | |

Focus after an action moves to that row's status line; one live region per
card announces the state change.

### 5.2 Impromptu calls on Today (build 10)

- **Subject, job.** The CSM's Today. Every call she records ends with 1-1 notes or a reason.
- **Layout.** Inside the existing flush `SectionCard` `After your calls`: one list, newest call first, the count covering both kinds; actions on the right, wrapping under the row at 390px:

```text
(●) Impromptu call on Sun 25 Oct, no client yet       [Place it] [Not a 1-1 call ▾]
    10:34 · 4 min before City Wood's booked call
    City Wood · check-in call on Sun 25 Oct · no 1-1 notes            [Write 1-1 notes]
```

- **Signature.** The orange question lamp: the window's "Is this the call?" moved to Today, where she can answer it; once answered, the row becomes an ordinary client row. No teal on the row, so the window keeps the one teal button.
- **Place sheet** (`components/ui/sheet`, the Change sheet's pattern): title `Whose call was this?`; description `Pick the client. The call goes on their page, then you can write the 1-1 notes.`; when the queue has a hint, `Fathom's hint: {hint}` (never preselected); a search field `Find a client` over the snapshot's client names, each in `<bdi dir="auto">`; no match `No client matches "{q}".`; a pick calls `matchUnmatched(id, taskId)`, toasts `Saved on {client}.`, closes, calls `onPlaced()` and moves focus to the next row (else the card heading); a refusal shows the server's sentence under the list with `role="alert"`. `Not a 1-1 call` is the existing menu (`NOT_A_CHECKIN`, `ClientCalls.tsx:463`) calling `settleCandidate`, toast `Set aside: not a 1-1 call.` A failed queue read shows `The calls with no client could not be read, so an impromptu call may be missing here.` and keeps the card (missing is never zero). Each button is named with its day and time (`Place the impromptu call on Sun 25 Oct, 10:34`).
- **Critique.** A second card `Calls with no client` was dropped (DESIGN.md says a thing once); a link to some client's queue was dropped (she would have to guess which client). The row places the call in place.

### 5.3 Move it here (build 11)

- **Job.** An admin or the CEO fixes a recording the worker put on the wrong client, from where they find it: the window's Change sheet. The signature stays 2a's This call card: after a move it turns teal with `On City Wood in the call store.`
- **Layout.** Inside the disabled row's `<li>`: the disabled row button keeps its role and sentence, and a sibling `Move it here` (outline, size sm, the window's `FOCUS`) sits right-aligned under it (a disabled button cannot hold a button). Shown only when `v.movable && m.seat === 'admin' && !m.rehearse && m.send.kind !== 'sending'`.

```text
Impromptu Google Meet   10:34-11:08 · 34 min
By the account manager · On Atlantis Contracting. If this is City Wood's call, move it here.
                                                                     [Move it here]
```

- **Confirm** (`components/ui/alert-dialog`): title `Move this recording to City Wood?`; body `It leaves Atlantis Contracting's Calls card and goes on City Wood's. The move is recorded with your name.`; actions `Move it here` and `Keep it on Atlantis Contracting`; busy `Moving…` (`aria-disabled`, still focusable); success toast `Moved to City Wood.`, then the window re-reads `checkin.calls` and picks the moved view (`useCheckin.moveHere`); a refusal shows the server's sentence under the row with `role="alert"` and focus stays; a `could not find the function` error reads `Moving a recording is not live yet.`
- **Files**: `checkinClient.ts` (`movable` in the zod `callView`; `moveRecording(client, {recordingId, taskId})`), `CheckinWindow.tsx` (`checkinIO.move`, `:93`), `useCheckin.ts` (`moveHere`, `move: {busy, error}`), `CheckinCall.tsx` (`Row`), fixtures and harness state `sheet-admin-move`.
- **Critique.** An inline "Move" link inside the row sentence was dropped: it would sit inside a disabled button and could not take focus.

### 5.4 Notices and routing: Call grade and Recap not sent (build 2)

`src/lib/notices.ts` `NOTICE_KINDS` (`:114-124`) and `NoticesRouting.tsx`
`NOTICE_ROWS` (`:76-111`) gain `checkin.grade` (label `Call grade`, hint `The
grade of each recorded 1-1 call, posted once per call. Tags nobody.`) and
`checkin.recap_late` (label `Recap not sent`, hint `A client recap still not
sent 24 hours after the call.`). The Call grade row replaces the tag editor
with the line `Tags nobody. A grade is about a person's call.`, and its channel
picker lists only channels checked as private. The rows reuse the existing row
layout; no new element (the signature of the page is unchanged).
`apps/client-success-cockpit/src/dev/noticesFixtures.ts` (whose settings read
hard-codes the eight Stage 1 rows, `:124-175`) gains, add only, the two
settings rows and one private and one public channel, so
`notices-routing.test.tsx` (which imports `settingsReadFixture` and
`fakeNoticesIO` from it, `:80-81`) can prove the Call grade line, the
private-only picker and the Recap not sent row, and `formHarness.tsx` shows them.

### 5.5 O1 as a design plan

One change of token, not per component: `--ring` on the light page becomes the
ink teal (4.6:1) and the ring grows to 2px set 2px off the control; external
links use one measured mix (`LINK_INK`); overlays stop animating under reduced
motion. Critique: plain `text-primary-ink` for links was rejected because it
measures 4.28 on muted and 4.18 on accent, where three links sit.

---

## 6. Workers, monitoring and docs

**Guardian** (worker owns `hermes/cockpit-guardian` alone; every row is
report-only):

| Where | Row | Reads | Threshold | Owner |
|---|---|---|---|---|
| `checks/queues.py` | `queue-clickup-forms`: `Queue("queue-clickup-forms", "cockpit_clickup_writeback_queue", "1-1 notes write bound for ClickUp", ("queued","sending","retry","unknown"), "created_at", 15, "the tech lead", "Run the forms doctor (clickup-writeback job forms_doctor); an unknown needs a person to look in ClickUp for its Cockpit ref F- (RUNBOOK, 1-1 notes writer).", status_col="state", kind_col="kind", kinds=("form",), failed_col="updated_at", held_unless=("clickup-writeback:forms","mode","apply"), held_label="until the 1-1 notes writer opens", limited=("apply_limited","onlyCards","task_id"))`. `Queue` gains two optional fields: `held_label: str = "until requests open"` (today's sentence is hard-coded, `checks/queues.py:170`, so the requests row reads as before) and `limited: Optional[tuple[str, str, str]] = None` = (the detail value that means limited, the detail field holding the cards, the row column holding the card). With `limited` set and the mode equal to its first value, `queue_check` also selects that column and counts a queued row as live when its card is in the detail's list (the canary card's rows are watched at step 8) and as held otherwise; today a queued row counts only when the mode is exactly the `held_unless` value (`:148-152`) | the queue | 15 min; failed in 24 h | the tech lead |
| `checks/queues.py` | `queue-form-effects` over `cockpit_form_effects`, states `planned, queued, unknown`, `created_at`, 30, `kind_col="delivery"`, `kinds=("clickup_queue","slack_notice","sql")`, `status_col="state"`, `failed_col="updated_at"`, action `Read the effect's reason in the 1-1 notes trail; the dispatch sweep runs every minute (RUNBOOK, 1-1 notes dispatch).` | effects | 30 min | the tech lead |
| `checks/queues.py` | `queue-form-recap` over `cockpit_form_effects`, states `planned, unknown` only, `kinds=("client_message",)`, 30 (a `queued` recap waits on a person by design, Z36) | effects | 30 min | the tech lead |
| `checks/queues.py` | `queue-client-messages` over `cockpit_client_messages`, `approved, claimed, sending`, `updated_at`, 15, `failed_col="updated_at"`, action `Run the client-messages doctor on the VPS (RUNBOOK, Client messages).` | messages | 15 min; failed in 24 h | the tech lead |
| `checks/queues.py` | `queue-client-messages-unknown`, `unknown`, limit 0, action `Look in the client's WhatsApp group for the message; the cockpit never sends it twice (RUNBOOK, Client messages).` | messages | any | the tech lead |
| `checks/pg_cron.py`, `checks/sections.py` | `EXPECTED_JOBS` gains `mahara-clickup-writeback-forms` (`tests/test_hiring_sync.py`'s job count goes to 28); `run_jobs`' freshness keys gain `clickup-writeback:forms` 15 (an idle writer reports every 10 minutes), `forms-effects-kick` 10, `csm-forms-record` 45 (Z78) | cron, sync state | | the tech lead |
| `checks/queues.py` | `NOTICE_KINDS` (`:66`) gains `checkin.grade`, `checkin.recap_late`; `ERROR_COLUMN = {'cockpit_client_messages': 'reason', 'cockpit_form_effects': 'reason'}` read by `queue_check` | | | |
| `checks/client_messages.py` (new, registered in `checks/__init__.py`) | `client-messages` freshness: no row yet reads ok `Not installed yet: the client messages cron starts at deploy D14.`; once a row exists, stale after 10 minutes (3.11); `detail.mode = 'dry'` reads ok `Dry: sending is off until the switch-over.`, `apply` with a non-empty `onlyCards` reads ok `Sending is open only for the test card.`; a sent row with no read-back after 60 minutes; a run whose `detail.receiptsMissing` is above 0, in either mode, warns `1 provider call left without its answer saved in the health ledger.` or `{n} provider calls left without their answers saved in the health ledger.` with the action `Check that the database takes provider receipts, then run the client-messages doctor (hermes/client-messages/RUNBOOK.md).` (after a hold or a failed run, before the mode readings; Z76); `client-messages-g5` warns until it reads `same number` | sync state, messages | | the tech lead |
| `checks/csm_calls.py` | `csm-notes-parity` (4.4); `csm-impromptu-notes` (4.10); `csm-checkin-form`'s late reading (4.9); `csm-calls-unmatched` evidence key (4.10); `CSM_KEYS` (`:18`) gains `'csm-forms-record': (45, 'kickoff and Blueprint records in the forms tables')`; low-severity `forms-kickoff-webhook` (confirm 2): not registered: ok `Not registered yet: kickoffs arrive by the 15-minute read.`; registered and a kickoff response of the last 24 h with source `typeform_sync` older than 30 minutes: warn `Typeform's webhook missed {n} kickoffs in 24 h; the 15-minute read stored them.` | | | the CSM lead / the tech lead |
| `checks/edge_functions.py` | `EXPECTED` (`:16`) gains `'forms-door': False` | | | |

**RUNBOOK.md rows** (root `RUNBOOK.md`; add-only; each role adds only its
rows, at the anchor given, never editing a line it did not add; Edit only,
never Write, and re-read the file right before each edit, because five roles
add to it in one worktree):

| Heading (new `##` unless said) | Anchor | Role |
|---|---|---|
| rows for Call grade and Recap not sent (private-only rule, never regraded, kill switches) | inside the existing `## Slack notices (kickoff and Brand Blueprint)` section (`RUNBOOK.md:408`), at its end | notices |
| `1-1 notes dispatch and the registry` (the sweep, the kick, the gate, the cut-over function, the rollback SQL) | first section directly after `## 1-1 notes in the cockpit (Stage 2a)` (`RUNBOOK.md:664`) and its body | db |
| `1-1 notes writer (clickup-writeback job forms)`; `Outside writers of the client card's dates`; `Moving a recording` | after db's section | writers |
| `Client messages (hermes/client-messages)` | after writers' sections | notices |
| `Kickoff and Blueprint records (forms-door, csm-forms-record)`; `Late Typeform 1-1 notes`; `Impromptu calls on Today` | after notices' section | worker |
| `The 1-1 notes cut-over hour` (pointer to section 11 here) and the interim R4-privacy-4 line `Never give a recorder outside Customer Success the csm role (A7.14 rule 1; the CEO's decision is open).` | after worker's sections | parity |

A role whose predecessor has not added its section yet inserts directly after
the last 2b section present (or after the 2a section's body), keeping the role
order db, writers, notices, worker, parity.

**Workers' discipline**: `hermes/client-messages` reads keys by name (its
switches only from its own `switches.env`, Z60), has a doctor that names each
key's source file, tests, cron under `flock -n` with `timeout 300` and a
claim budget inside it (Z59), a runbook, guardian
rows, a health row, and a plain sentence in the cockpit (Messages card, Today
rows) when something is missing; every external call writes an intent receipt
first (`ledger.ts`). `hermes/csm-calls` keeps 2a's discipline; its doctor gains
the `forms record` probe and the `provider_since` column read.

---

## 7. File ownership

Every file has exactly one owner; a file not listed is not changed. Shared
files: `scripts/ship.sh` and `scripts/verify-cutover-readiness.py` belong to
parity (others hand their commands through section 8); `RUNBOOK.md` is
add-only (section 6); `hermes/cockpit-guardian/*` belongs to worker.

Every path below is repo-relative and exact (the ownership test reads them as
written). `SOURCES.md` and `RUNBOOK.md` with no folder mean the files at the
repo root.

| File | Owner |
|---|---|
| `supabase/migrations/20261029s_forms_registry.sql`, `supabase/migrations/20261029w_forms_dispatch.sql`, `supabase/migrations/20261029x_forms_late_typeform.sql`, `supabase/migrations/20261029y_forms_records.sql`, `supabase/migrations/20261029z_forms_move_recording.sql` (new) | db |
| `apps/media-buyer-cockpit/scripts/forms-registry-supabase.test.ts`, `apps/media-buyer-cockpit/scripts/forms-dispatch-supabase.test.ts`, `apps/media-buyer-cockpit/scripts/late-typeform-supabase.test.ts`, `apps/media-buyer-cockpit/scripts/forms-record-supabase.test.ts`, `apps/media-buyer-cockpit/scripts/forms-move-supabase.test.ts` (new) | db |
| `supabase/migrations/20261029t_forms_clickup_writeback.sql`, `apps/media-buyer-cockpit/scripts/forms-writeback-supabase.test.ts` (new) | writers |
| `supabase/functions/clickup-writeback/forms.ts`, `supabase/functions/clickup-writeback/forms.test.ts` (new); `supabase/functions/clickup-writeback/run.ts`, `supabase/functions/clickup-writeback/run.test.ts`, `supabase/functions/clickup-writeback/index.ts` | writers |
| `supabase/functions/cockpit-csm-api/core.ts`, `supabase/functions/cockpit-csm-api/projections.ts`, `supabase/functions/cockpit-csm-api/projections.test.ts`; `apps/client-success-cockpit/scripts/csm-act-route.test.ts`, `apps/client-success-cockpit/scripts/check-in.test.ts` | writers |
| `docs/requests/CLICKUP-DOWNGRADE.md` (one row in its 1.2 table: the forms job's pace, dark until the cut-over; nothing else, Z78) | writers |
| `supabase/functions/cockpit-forms-api/effects.ts`, `supabase/functions/cockpit-forms-api/effects.test.ts`, `supabase/functions/cockpit-forms-api/messages.ts`, `supabase/functions/cockpit-forms-api/messages.test.ts` (new); `supabase/functions/cockpit-forms-api/door.ts`, `supabase/functions/cockpit-forms-api/door.test.ts`, `supabase/functions/cockpit-forms-api/index.ts`, `supabase/functions/cockpit-forms-api/drafts.ts`, `supabase/functions/cockpit-forms-api/recapRules.ts`, `supabase/functions/cockpit-forms-api/recapRules.test.ts`, `supabase/functions/cockpit-forms-api/calls.ts`, `supabase/functions/cockpit-forms-api/calls.test.ts`, `supabase/functions/cockpit-forms-api/fathom.ts`, `supabase/functions/cockpit-forms-api/testkit.ts`, `supabase/functions/cockpit-forms-api/doctor.ts`, `supabase/functions/cockpit-forms-api/doctor.test.ts`, `supabase/functions/cockpit-forms-api/README.md` | writers |
| `supabase/migrations/20261029u_forms_checkin_notices.sql`, `supabase/migrations/20261029v_forms_client_messages.sql`; `apps/media-buyer-cockpit/scripts/checkin-notices-supabase.test.ts`, `apps/media-buyer-cockpit/scripts/client-messages-supabase.test.ts` (new) | notices |
| `supabase/functions/cockpit-notices/run.ts` (the dry run's tags, Z78), `supabase/functions/cockpit-notices/text.ts`, `supabase/functions/cockpit-notices/send.ts`, `supabase/functions/cockpit-notices/door.ts`, `supabase/functions/cockpit-notices/README.md`, `supabase/functions/cockpit-notices/text.test.ts`, `supabase/functions/cockpit-notices/run.test.ts`, `supabase/functions/cockpit-notices/door.test.ts` | notices |
| `hermes/client-messages/worker.ts`, `hermes/client-messages/core.ts`, `hermes/client-messages/whapi.ts`, `hermes/client-messages/ledger.ts`, `hermes/client-messages/db.ts`, `hermes/client-messages/oldSenders.ts`, `hermes/client-messages/g5.ts`, `hermes/client-messages/run.sh`, `hermes/client-messages/RUNBOOK.md`, `hermes/client-messages/core.test.ts`, `hermes/client-messages/whapi.test.ts`, `hermes/client-messages/ledger.test.ts`, `hermes/client-messages/oldSenders.test.ts`, `hermes/client-messages/worker.test.ts`, `hermes/client-messages/g5.test.ts` (new folder) | notices |
| **N4 (4.4, committed first and alone, Z63):** `hermes/cockpit-sync/csmProviders.ts`, `hermes/cockpit-sync/csmProducer.ts`, `hermes/cockpit-sync/csm-checkin-task.test.ts`, `hermes/cockpit-sync/csmProducer.test.ts`, `hermes/cockpit-sync/RUNBOOK.md`, `scripts/native-feed.test.ts`, `SOURCES.md` | worker |
| `hermes/csm-calls/sources.ts`, `hermes/csm-calls/sources.test.ts`, `hermes/csm-calls/lib.ts`, `hermes/csm-calls/lib.test.ts`, `hermes/csm-calls/worker.ts`, `hermes/csm-calls/RUNBOOK.md` | worker |
| `supabase/functions/forms-door/index.ts`, `supabase/functions/forms-door/handler.ts`, `supabase/functions/forms-door/handler.test.ts`, `supabase/functions/forms-door/deno.json`, `supabase/functions/forms-door/README.md` (new) | worker |
| `scripts/dev/forms_key.py`, `scripts/dev/test_forms_key.py` | worker |
| `hermes/cockpit-guardian/checks/csm_calls.py`, `hermes/cockpit-guardian/tests/test_csm_calls.py`, `hermes/cockpit-guardian/README.md` (their `csm-notes-parity` parts go with N4 and nothing else until N4 is committed, 4.4); `hermes/cockpit-guardian/checks/queues.py`, `hermes/cockpit-guardian/checks/edge_functions.py`, `hermes/cockpit-guardian/checks/client_messages.py` (new), `hermes/cockpit-guardian/checks/__init__.py`, `hermes/cockpit-guardian/tests/test_checks_data.py`, `hermes/cockpit-guardian/checks/pg_cron.py`, `hermes/cockpit-guardian/checks/sections.py`, `hermes/cockpit-guardian/tests/test_hiring_sync.py` (section 6, Z78) | worker |
| `apps/client-success-cockpit/src/components/ImpromptuCalls.tsx`, `apps/client-success-cockpit/src/components/ClientMessages.tsx`, `apps/client-success-cockpit/src/lib/clientMessages.ts`, `apps/client-success-cockpit/src/forms/RecapApproval.tsx`, `apps/client-success-cockpit/scripts/client-messages.test.tsx`, `apps/client-success-cockpit/scripts/design-tokens.test.ts` (new) | screens |
| `apps/client-success-cockpit/src/components/AfterCalls.tsx`, `apps/client-success-cockpit/src/components/NoticesRouting.tsx`, `apps/client-success-cockpit/src/components/kit.tsx`, `apps/client-success-cockpit/src/components/ui/button.tsx`, `apps/client-success-cockpit/src/components/ui/popover.tsx`, `apps/client-success-cockpit/src/components/ui/sheet.tsx`, `apps/client-success-cockpit/src/components/ui/dropdown-menu.tsx`, `apps/client-success-cockpit/src/components/ui/tooltip.tsx`, `apps/client-success-cockpit/src/index.css`, `apps/client-success-cockpit/src/lib/notices.ts`, `apps/client-success-cockpit/src/lib/formsRegistry.ts` | screens |
| `apps/client-success-cockpit/src/forms/CheckinRecap.tsx`, `apps/client-success-cockpit/src/forms/CheckinWindow.tsx`, `apps/client-success-cockpit/src/forms/CheckinCall.tsx`, `apps/client-success-cockpit/src/forms/CheckinFields.tsx` (the `PANEL_INK` import only), `apps/client-success-cockpit/src/forms/checkinClient.ts`, `apps/client-success-cockpit/src/forms/useCheckin.ts`, `apps/client-success-cockpit/src/forms/checkinTrail.ts`, `apps/client-success-cockpit/src/pages/CsmPage.tsx` | screens |
| `apps/client-success-cockpit/src/dev/checkinFixtures.ts`, `apps/client-success-cockpit/src/dev/checkinHarness.tsx`; `apps/client-success-cockpit/src/dev/noticesFixtures.ts`, `apps/client-success-cockpit/src/dev/formHarness.tsx` (add only: 5.4's rows and channels, and the harness states of section 5) | screens |
| `apps/media-buyer-cockpit/scripts/stage1-fit-supabase.test.ts` (the one assertion that lists the notice kinds: that file applies Stage 1 only, so 2b's two kinds are left out of it; nothing else, Z78) | screens |
| `apps/client-success-cockpit/scripts/after-calls.test.tsx`, `apps/client-success-cockpit/scripts/checkin-window.test.tsx`, `apps/client-success-cockpit/scripts/csm-page.test.tsx`, `apps/client-success-cockpit/scripts/notices-routing.test.tsx`, `apps/client-success-cockpit/scripts/forms-button.test.tsx`, `apps/client-success-cockpit/scripts/checkin-trail.test.ts`; `docs/DESIGN.md` (the three bullets) | screens |
| `apps/client-success-cockpit/src/lib/clientBrief.ts` (build 12 only), `apps/client-success-cockpit/scripts/client-brief.test.ts` | parity |
| `apps/media-buyer-cockpit/scripts/checkin-plans-supabase.test.ts` (drop `.failing` from the 11 cases and rewrite the two header comments at `:11-16` and `:1090-1107`, nothing else) | parity |
| `supabase/functions/cockpit-forms-api/todos.ts`, `supabase/functions/cockpit-forms-api/drafts.test.ts` | parity |
| `apps/media-buyer-cockpit/scripts/checkin-replay.ts`, `apps/media-buyer-cockpit/scripts/checkin-replay.test.ts` | parity |
| `apps/media-buyer-cockpit/scripts/stage2b-fit-supabase.test.ts`, `apps/media-buyer-cockpit/scripts/stage2b-ownership.test.ts` (new) | parity |
| `scripts/ship.sh` (one new 2b block), `scripts/verify-cutover-readiness.py` (`RELEVANT_TEST_FILES` only), `scripts/dev/forms_gates.py`, `scripts/dev/test_forms_gates.py` (new) | parity |
| `RUNBOOK.md` | add-only, by the roles of section 6, at their anchors |
| `docs/forms/STAGE2B-CONTRACT.md` | the orchestrator (no builder edits it) |

**File counts:** db 10; writers 30; notices 27; worker 31 (N4's 7 among
them); screens 37; parity 13 (plus `RUNBOOK.md`, add-only).

**Not touched by anyone:** every earlier migration; `hermes/ad-billing-guard/*`
(imported read only); `hermes/csm-calls/callMatch.ts`, `match.ts`,
`fathomRules.ts`, `eods.ts`, `rollback/*`; `supabase/functions/fathom-webhook/*`;
`supabase/functions/cockpit-forms-api/transcript.ts`, `prompts/*`,
`typeform.ts`, `keys.ts`; `supabase/functions/cockpit-notices/` files not
listed; `apps/client-success-cockpit/src/lib/onboardingCore.ts`, `csmLinks.ts`,
`csmTemplates.ts`, `csmCalls.ts`, `src/components/ClientCalls.tsx` (until the
links follow-up, 11.4); `apps/media-buyer-cockpit/src/**` (Z57 keeps the CEO
card's keys parse valid without touching it); `supabase/functions/cockpit-board-api/*`
and `apps/client-success-cockpit/scripts/csm-read-model.test.ts` (run green by
writers, never edited); `apps/media-buyer-cockpit/scripts/slack-notices-supabase.test.ts`
(run green by notices, never edited: E5's fallback, Z75); `viktor-side-scripts/*`; every file pinned by
`scripts/check-shared.sh`.

**Hand-offs** (build to this contract, not to each other's code):

| Producer | Consumer | Interface |
|---|---|---|
| db (`s`) | writers, notices, db (`w`) | 3.1 gate, 3.2 readiness, `cockpit_form_effect_owner`, `cockpit_form_native_since`, `provider_since` |
| writers (`t`) | db (`w`, readiness) | the `form` kind, `claim_forms(uuid,integer)` |
| notices (`u`, `v`) | db (`w`, readiness) | the `checkin.grade` kind and settings row; `approve(uuid,text,text,uuid,text[])`, `claim(text[],text[],integer)`; the kick's guarded call to `cockpit_form_effects_kick()` |
| db (`w`) | writers, notices, screens | 3.3, 3.4, 3.5, 3.6; `cockpit_form_effects_waiting`; `cockpit_form_drafts_service` (the sweep's drafts reader) |
| notices (`v`) | writers (op), screens | `MessageView`, the browser and approve RPCs |
| db (`y`) | worker | 3.9; the `typeform_kickoff` key through `cockpit_forms_key_put` and `cockpit_forms_key_mark`; the `typeform` list of `cockpit_forms_keys_status` (Z57) |
| db (`z`) | writers, screens | `cockpit_forms_switch`, `cockpit_csm_move_recording` |
| writers | screens | `CallView.movable`, op `recap.approve` |
| parity (`todos.ts`) | writers (`TODOS_VERSION`), parity (replay) | the rule of 4.13 |
| worker | screens | none new (the snapshot's new fields are ignored by screens) |

**Build order.** All six start together; each delivers first what others read:

| Wave | Who | Delivers first |
|---|---|---|
| 1 | db | `s` |
| 1 | worker | N4's file set (4.4), then stop on those files until the orchestrator reports N4 committed; meanwhile `hermes/csm-calls`, `forms-door`, `forms_key.py` and the guardian files outside the set |
| 1 | parity | `todos.ts` |
| 2 | writers, notices | `t`; `u` and `v` (they may stand in for `s`'s gate until db reports it) |
| 3 | db | `w` (stand-ins for `t`, `u`, `v` CHECKs until reported), then `x`, `y`, `z` |
| 4 | everyone | the rest; screens' RPC calls after `v` and `z` are reported; parity's fit test after every file is reported |

---

## 8. Tests each builder runs green

Run from the worktree root unless a `cd` is shown; every file is named; no
installs, no full app builds, delete scratch files (A4). The PGlite suites
follow `apps/media-buyer-cockpit/scripts/slack-notices-supabase.test.ts`
(`cockpitTestDb({supabaseDefaultPrivileges: true})`, real definitions cut from
their canonical migrations, invented people and clients, a vault stand-in),
apply the 2a base in order (`20261025n`, `20261025o`, `20261026r`,
`20261026s`, `20261026t`, `20261027f`, `20261027g`, `20261027h`) and then the
2b files they need in letter order, each 2b file twice, each named by its full
stem (`20261029s` ..., never a bare letter, 2.1). No 2b test file holds a
`test.failing` case. Python here is 3.9.6 as `python3`; the guardian needs 3.11
or later (`hermes/cockpit-guardian/README.md:60`), so its tests run with
`python3.11` (at `~/.local/bin/python3.11`).

- **db**: `cd apps/media-buyer-cockpit && bun test scripts/forms-registry-supabase.test.ts scripts/forms-dispatch-supabase.test.ts scripts/late-typeform-supabase.test.ts scripts/forms-record-supabase.test.ts scripts/forms-move-supabase.test.ts`; stays green: `cd apps/media-buyer-cockpit && bun test scripts/forms-core-supabase.test.ts scripts/fathom-intake-supabase.test.ts scripts/stage2a-writers.test.ts`.
- **writers**: `cd apps/media-buyer-cockpit && bun test scripts/forms-writeback-supabase.test.ts scripts/requests-supabase.test.ts`; `bun test supabase/functions/clickup-writeback`; `bun test supabase/functions/cockpit-forms-api/door.test.ts supabase/functions/cockpit-forms-api/effects.test.ts supabase/functions/cockpit-forms-api/messages.test.ts supabase/functions/cockpit-forms-api/recapRules.test.ts supabase/functions/cockpit-forms-api/calls.test.ts supabase/functions/cockpit-forms-api/doctor.test.ts supabase/functions/cockpit-forms-api/prompts.test.ts supabase/functions/cockpit-forms-api/transcript.test.ts supabase/functions/cockpit-forms-api/typeform.test.ts`; `bun test supabase/functions/cockpit-csm-api/projections.test.ts`; `cd apps/client-success-cockpit && bun test scripts/csm-act-route.test.ts scripts/check-in.test.ts scripts/csm-read-model.test.ts`; `bun test supabase/functions/cockpit-board-api` (it imports `prepareCsm`/`executeCsm`, `lever.ts:18`; stays green, no redeploy); `bun test supabase/functions/cockpit-forms-api/drafts.test.ts` stays green after the `draftsForResponse` extraction (parity's file, run once parity reports the rule change); and `python3 scripts/dev/fn_extras.py . clickup-writeback`, `python3 scripts/dev/fn_extras.py . cockpit-forms-api` and `python3 scripts/dev/fn_extras.py . cockpit-csm-api` each list only files that exist (every relative import carries its `.ts` extension).
- **notices**: `cd apps/media-buyer-cockpit && bun test scripts/checkin-notices-supabase.test.ts scripts/client-messages-supabase.test.ts scripts/slack-notices-supabase.test.ts`; `bun test supabase/functions/cockpit-notices`; `bun test hermes/client-messages`.
- **worker**: `bun test hermes/cockpit-sync/csm-checkin-task.test.ts hermes/cockpit-sync/csmProducer.test.ts scripts/native-feed.test.ts` (N4 first); `bun test hermes/csm-calls/sources.test.ts hermes/csm-calls/lib.test.ts hermes/csm-calls/match.test.ts hermes/csm-calls/callMatch.test.ts hermes/csm-calls/fathomRules.test.ts hermes/csm-calls/eods.test.ts hermes/csm-calls/rollback.test.ts`; `bun test supabase/functions/forms-door`; `cd scripts/dev && python3 -m unittest test_forms_key`; `cd hermes/cockpit-guardian && python3.11 -m unittest tests.test_csm_calls tests.test_checks_data tests.test_coverage tests.test_ai_report tests.test_hiring_sync` (`tests/test_checks_data.py` covers `checks/client_messages.py`, the five queue rows and `held_label`/`limited`); `python3 scripts/dev/fn_extras.py . forms-door` lists exactly six files: `hermes/csm-calls/callMatch.ts`, `hermes/csm-calls/match.ts`, `supabase/functions/_shared/clickupRetry.ts`, `supabase/functions/cockpit-ceo-api/tools.ts`, `supabase/functions/cockpit-hours-sync/db.ts`, `supabase/functions/team-onboarding-intake/signature.ts` (`cockpit-hours-sync/db.ts:6` imports `../cockpit-ceo-api/tools.ts` as a type, which `fn_extras.py` follows; `python3 scripts/dev/fn_extras.py . cockpit-hours-sync` prints it, 2026-10-29).
- **screens**: `cd apps/client-success-cockpit && bun test scripts/after-calls.test.tsx scripts/client-messages.test.tsx scripts/checkin-window.test.tsx scripts/csm-page.test.tsx scripts/notices-routing.test.tsx scripts/forms-button.test.tsx scripts/design-tokens.test.ts scripts/checkin-trail.test.ts scripts/form-panel.test.tsx scripts/form-contract.test.ts scripts/checkin-form.test.ts`; `cd apps/media-buyer-cockpit && bun test scripts/stage1-fit-supabase.test.ts` (the one assertion; `scripts/ship.sh` already runs this file in its Stage 1 block).
- **parity**: `cd apps/client-success-cockpit && bun test scripts/client-brief.test.ts`; `cd apps/media-buyer-cockpit && bun test scripts/checkin-plans-supabase.test.ts scripts/checkin-replay.test.ts scripts/stage2b-fit-supabase.test.ts scripts/stage2b-ownership.test.ts`; `grep -c 'test.failing' apps/media-buyer-cockpit/scripts/checkin-plans-supabase.test.ts` prints `0`; `bun test supabase/functions/cockpit-forms-api/drafts.test.ts`; `cd scripts/dev && python3 -m unittest test_forms_gates`; `bash -n scripts/ship.sh`; the live replay re-run of 4.13 (read only).

**The fit test** (`stage2b-fit-supabase.test.ts`, parity) applies the 2a base
and `20261029s` to `20261029z` twice in order; asserts, for every 2.2
function, that its whitespace-normalised `prosrc` md5 equals the "after" value
written in its owning file's drift guard and that its body is the text in that
owning 2b file (the "expected body"), and that its ACL is 2.2's; flips the registry through
`cockpit_form_checkin_cutover()` with every delivery path of 3.2 installed;
sends one live check-in through the window's own calls (`checkinClient.ts`
shapes) and proves `call_form` and `call_match` delivered, four queue rows
queued, the grade waiting then queued on a ready grade, a recap message created
on a ready recap, each settle row of 3.6 end to end, the rollback restoring the
seed and a queued effect then refused by the gate; and that no file in the 2b
set holds `test.failing`, with the needle built as `"test." + "failing"` and
the fit and ownership tests themselves left out of the scan. **The ownership test** (`stage2b-ownership.test.ts`)
checks every changed file against section 7 and skips once the branch is on
main, as 2a's does.

**The ship block** (parity, `scripts/ship.sh`, after the 2a block at
`:120-129`): one 2b block that runs every command above except the live
replay, the guardian tests, the Python unit tests and
`stage2b-ownership.test.ts` (as 2a left its ownership test out of the ship
script; the second run of the Slack notices suite is gone from the notices line
above and from this block too, Z75), guarded by `if [ -f
apps/media-buyer-cockpit/scripts/forms-dispatch-supabase.test.ts ]`, each
failure printing its command. `RELEVANT_TEST_FILES`
(`scripts/verify-cutover-readiness.py:42`) gains exactly these paths, each of
which passes as `bun test <path>` from the repo root (or, for the `.py`, through
the readiness script's `unittest discover` path, `:747`), under one comment
line naming this contract:
`apps/media-buyer-cockpit/scripts/forms-registry-supabase.test.ts`,
`apps/media-buyer-cockpit/scripts/forms-dispatch-supabase.test.ts`,
`apps/media-buyer-cockpit/scripts/late-typeform-supabase.test.ts`,
`apps/media-buyer-cockpit/scripts/forms-record-supabase.test.ts`,
`apps/media-buyer-cockpit/scripts/forms-move-supabase.test.ts`,
`apps/media-buyer-cockpit/scripts/forms-writeback-supabase.test.ts`,
`apps/media-buyer-cockpit/scripts/checkin-notices-supabase.test.ts`,
`apps/media-buyer-cockpit/scripts/client-messages-supabase.test.ts`,
`apps/media-buyer-cockpit/scripts/stage2b-fit-supabase.test.ts`,
`apps/media-buyer-cockpit/scripts/stage2b-ownership.test.ts` (it skips once on
main, as 2a's listed one does),
`supabase/functions/clickup-writeback/forms.test.ts`,
`supabase/functions/cockpit-forms-api/effects.test.ts`,
`supabase/functions/cockpit-forms-api/messages.test.ts`,
`hermes/client-messages/core.test.ts`, `hermes/client-messages/whapi.test.ts`,
`hermes/client-messages/ledger.test.ts`, `hermes/client-messages/oldSenders.test.ts`,
`hermes/client-messages/worker.test.ts`, `hermes/client-messages/g5.test.ts`,
`supabase/functions/forms-door/handler.test.ts`,
`apps/client-success-cockpit/scripts/client-messages.test.tsx`,
`apps/client-success-cockpit/scripts/design-tokens.test.ts`,
`scripts/dev/test_forms_gates.py`. The guardian's Python tests stay out (they
import `tests.fakes` and run only from `hermes/cockpit-guardian`,
`scripts/verify-cutover-readiness.py:129-131`). If any listed file does not
pass from the root, parity reports it and leaves it out with a comment saying
why, never a weakened test.

**The gate report** (parity): `scripts/dev/forms_gates.py` reads the live
database through the Management API with `read_only: true` (the `Reader` of
`scripts/check-cockpit-auth-config.py`, `--env-file`), runs each gate query of
section 10, and prints one line per gate: `G6 waiting: day 3 of 7`,
`G1 green`, or `G9 waiting on people: 0 of 3 CSM shadow runs`. It never writes
and never prints an address or a secret; `test_forms_gates.py` runs it on canned
rows.

---

## 9. The dark deploy (the main session), with read-backs

Every step reads back before the next; a failed read-back stops and rolls that
step back. Migrations are applied as in 2a: a dry run through Composio
`SUPABASE_BETA_RUN_SQL_QUERY` (`read_only: false`) of `BEGIN; <file> <file>
ROLLBACK;` with the file's own `BEGIN`/`COMMIT` stripped, then
`SUPABASE_APPLY_A_MIGRATION {ref: bldgtotkfmhoxmlzowdx, name: <stem>, query}`,
the file's sha256 recorded. Read-backs use `cd ~ &&
~/.cache/mahara-ship/pybin/python ~/.cache/mahara-ship/sq.py "<select>" <
/dev/null`. Before any replacement, the 2.2 body is saved and its md5 checked;
because each apply is a separate Composio call and other sessions apply
migrations the same day (the sales session applied ten on 2026-10-29), each
file's own drift guard (2.1) re-checks the bodies inside the apply's
transaction. Every apply step also reads back the ACL of every function it
created or replaced against 2.2 to 2.10 (`select p.oid::regprocedure, p.proacl
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
(...)`).
**Nothing from a new writer turns on**: after D18 the registry is still
`typeform` with 8 `shadow` effects, `CLICKUP_WRITEBACK_APPLY_FORMS` is unset,
`CLIENT_MESSAGES_APPLY=false`, `forms.move_recording` is off (D18 reads all of
it back). The one live change to client cards is build 5 at D11 (Z19), a fix to
the existing Log a call writer, with its own read-back and rollback.

| Step | What | Read-back |
|---|---|---|
| D0 | Pre-flight (orchestrator, read only): the letter rule (2.1); every 2.2 md5 and ACL; `select key, provider, version from cockpit_forms` (3 rows, checkin `typeform`); responses, effects, drafts, messages 0; `20261029p` and `20261029q` in `schema_migrations`; `git diff --name-only $(git merge-base stage2b-1029 origin/main) origin/main` touches none of section 7's files (the base is `ca8fe4bf` since the rebase, Z79; if main has moved onto one of them, rebase and run section 8 again before any step here); record the pre-2b origin/main sha and each function's current deployed version (`clickup-writeback`, `cockpit-notices`, `cockpit-forms-api` `v1` from `93bbd2d4`, `cockpit-csm-api`) and the client-success production sha, as rollback targets | all equal; else stop and amend |
| D1 | **N4** (build 4), its own commit on main first (4.4's mechanism): re-read `readlink -f ~/cockpit-native-current` and the sha256 of the live `csmProviders.ts` and `csmProducer.ts` (must equal main's pre-N4 files; live `ca8fhot1` on 2026-10-30, sha256 `12ac99a5537a27ad…`, `2d2636e723fd48d2…`, the same two values as `86eebpf1` before it); upload the two files and `SUMS` to `~/.cockpit-native-state/upload-<ID>/` (8 characters); write `release-<ID>.sh` from the newest release script (`release-ca8fhot1.sh` on 2026-10-30) with `BASE` the live release and those `FILES` and `BASES`, whose dry-run plan check fails unless every `plan.csm.clients` row has `notesFrom 'store'`, none `differs`, the count with `lastNoteOn` equals the latest live cycle's and no table drops to zero; run it (stage, doctors, dry run under `flock -w 1500`, `ceo_safe`, canary). Then the guardian copy of that main commit (its `csm-notes-parity`) | `activation-<ID>-canary.json` `activated: true`; `select data->>'notesFrom', data->'notesParity'->>'state', count(*) from public.cockpit_csm_sources where table_name='clients' group by 1,2` all `store`, no `differs`; the guardian reads `Day 0 of 7`. Rollback: the link back to the base under the lock (before the cut-over only) |
| D2 | Deploy `clickup-writeback` from the 2b commit, `APPLY_FORMS` and `FORMS_ONLY_CARDS` unset: `X=$(python3 scripts/dev/fn_extras.py . clickup-writeback \| tail -1); python3 scripts/dev/deploy_composio.py clickup-writeback --rev <sha> --extra ${=X} --verify-jwt off --dry`, then without `--dry` (the function deploys before its migration, 2a 13 build 1) | version +1, `verify_jwt` false; the next `clickup-writeback:log` note normal; `clickup-writeback:requests` still `apply` and ok; a doctor post names the forms switch as dry run. Rollback: redeploy the previous commit |
| D3 | Deploy `cockpit-notices` (`verify_jwt` false) from the 2b commit | `{"job":"doctor"}` with `x-cron-secret` answers ok and lists `#client-call-feedback` ok and private |
| D4 | Apply `s` | the `schema_migrations` row; `has_function_privilege('authenticated','public.cockpit_form_registry_set(text,jsonb)','EXECUTE')` true, anon and service_role false; `proacl` `{postgres=X/postgres}` on every internal `s` function; `provider_since` exists and is NULL on 3 rows; registry rows unchanged; still 3 `cockpit_forms` audit rows |
| D5 | Apply `t` (bodies saved: claim, release, begin, idle) | the two CHECKs; the claim body holds `NOT IN ('request','task_action','form')` and otherwise equals the saved one; grants per 2.4; `select jobname, schedule, active from cron.job where jobname = 'mahara-clickup-writeback-forms'` active `* * * * *`; within 11 minutes `clickup-writeback:forms` `detail.mode = 'dry_run'`, `Nothing to write.`, and `clickup-writeback:forms-kick` ok; 0 `form` rows; a hand post of job `forms_doctor` makes `clickup-writeback:forms-doctor` read `Ready` |
| D6 | Apply `u` (thirteen bodies saved) | the three CHECKs name both kinds; `select kind, enabled, channel from cockpit_slack_notice_settings where kind like 'checkin.%'` 2 rows and 2 `notices.setting_seeded` audit rows; changed md5s; 0 check-in notices; within 2 minutes `slack-notices-kick` ok `Nothing to send`; the next kickoff or Blueprint notice (if any) behaves as Stage 1; ACLs per 2.2 |
| D7 | Apply `v` (guard saved) | grants per 2.6; the guard md5 changed; 0 rows; the 3 indexes |
| D8 | Apply `w` (submit and effects guard saved) | the submit body holds `cockpit_form_dispatch`; `select tgname, tgenabled from pg_trigger where tgname like 'cockpit_form_effects_from_%' or tgname = 'cockpit_form_drafts_dispatch'` 4 rows `O`; grants; within 2 minutes `forms-effects-kick` ok `Nothing waiting.` and `slack-notices-kick` ok; counts 0; `clickup-writeback:log` and `:requests` notes unchanged |
| D9 | Apply `x`, then `y` (key functions saved), then `z` | `x`: the CHECK holds `checkin_late`, both triggers enabled, 0 late rows, the next worker run keeps `csm-checkin-form` ok (`36 of 36 1-1 forms stored…` or the new count); `y`: the keys CHECK, three service RPCs; `z`: `select value from cockpit_settings where key = 'forms.move_recording'` `{"on":false}`, the trigger `cockpit_settings_forms_audit` enabled and one `forms.switch_seeded` audit row, grants, `cockpit_csm_attach_recording` md5 unchanged (`279eca8c…`) |
| D10 | The PR merges to main (every RPC that code names is live: Y41, the missing-RPC check at `scripts/check-cockpit-auth-config.py:200-202`) | `scripts/ship.sh` passes its checks |
| D11 | From an origin/main tree: deploy `cockpit-forms-api` (`verify_jwt` on), `cockpit-csm-api` (`verify_jwt` as its `before` line prints; shared with Offer Studio, so only from main; this is build 5, live, Z19), `forms-door` (`verify_jwt` off; `fn_extras` lists the five extras of section 8) | forms-api: the doctor 200 for the service key with `NOTICES_CRON_SECRET: true`; `recap.approve` with the service key 403; a wrong `x-cron-secret` 401. csm-api: version +1; the next real act reads `confirmed` with the two field POSTs and the task GET in `cockpit_csm_provider_health`, and its field bodies read back as date-only noon Kuwait (`value_options.time false`; the card's Last POC and Last Check-in Call show the CSM's Kuwait day, read by a ClickUp GET through the VPS route); a `reconcile` act or a moved day rolls csm-api back at once. forms-door: unsigned POST 503 `{"ok":false}`, GET 405, `/forms-door/x` 404, the guardian's edge-functions check sees it active |
| D12 | `scripts/ship.sh client-success-cockpit` | production: a CSM page load makes no `cockpit_csm_unmatched_list` request (provider `typeform`); the Messages card's empty state; Notices and routing lists Call grade and Recap not sent; Tab shows the ink ring in light |
| D13 | The `hermes/csm-calls` release, 2a's 4.7 and A8 pattern: record failing `csm-*` keys; `git archive <sha> hermes/csm-calls`, check sha256, unpack to `/home/hermes/.csm-calls-releases-hermes/<sha8>`; doctor and dry run with the native bun directly; the `flock -o` holder; swap while it holds; release; the first run detached with its `.rc` | doctor ok with `forms record` ok; dry report: `plan.cutover` null, `fRokTITH.late` 0, `csm-forms-record` counting 8 kickoffs to record; first run: `csm-checkin-form` and `csm-forms-record` ok; `select source, state, count(*) from cockpit_form_responses where form_key = 'kickoff' group by 1,2` `typeform_sync submitted 8`; `cockpit_slack_notices` 31 and `cockpit_creative_outbox` 0 unchanged. Rollback target `93bbd2d4` (kept; safe because the late trigger keeps late rows late and unlinked) |
| D14 | The `hermes/client-messages` release, dry: `git archive <sha> hermes/client-messages hermes/ad-billing-guard/transport.ts hermes/ad-billing-guard/core.ts`, sha256, unpack to `/home/hermes/.client-messages-releases/<sha8>`; `~/.client-messages` mode 700 with `switches.env` (`CLIENT_MESSAGES_APPLY=false`, `CLIENT_MESSAGES_KINDS=recap_checkin`; no secret); doctor; dry run; link `~/client-messages-current`; the cron line | doctor ok, every key true and its source file the expected one (keys from the guard and native runtime files, `MAKE_*` from `api-keys.env`, the three switches from `switches.env`), `SUPABASE_URL` this project, column F ok (the Google token POST and the Sheets GET both receipted under `google`), Typeform, Make and WHAPI reads good (channel as last 4); dry report approved 0; after 2 minutes `select ok, note, detail->>'mode' from cockpit_sync_state where key = 'client-messages'` true, `Nothing approved to send. Sending is off until the switch-over.`, `dry` |
| D15 | The guardian copy: first `rsync -a` the current copy to `/home/hermes/.guardian-before-2b/` (the rollback target); `git archive <sha> hermes/cockpit-guardian` into a scratch folder, `test -w`, `rsync -a --exclude __pycache__`, the unit tests there with `python3.11` (after D13, so `csm-forms-record` has run) | next scan: `csm-calls-sync` ok but for the recorded Meta key; `csm-notes-parity`, `csm-impromptu-notes` (`not switched yet`), `forms-kickoff-webhook`, `csm-checkin-form`, the five new queue rows and `client-messages` ok |
| D16 | G5 (4.16): the input query of section 16, then `ssh -o BatchMode=yes hermes@187.77.156.166 '~/client-messages-current/hermes/client-messages/run.sh g5 --task <t1> --at <iso1> --task <t2> --at <iso2>'` | `select ok, note from cockpit_sync_state where key = 'client-messages-g5'` ok `same number`; else B5 goes to the CEO at the hour with both last 4 values |
| D17 | B3 (Z22): `forms_key.py typeform-secret kickoff`, `register-typeform kickoff`, `probe-typeform kickoff` through 2a's ssh pattern (4.5) | `forms_key.py status` shows `typeform_kickoff` connected (last 4 only); `GET /forms/tG7dnxBn/webhooks` lists `cockpit` enabled beside `WHTP3992232` unchanged; unsigned 401, signed probe 200; `forms-door:kickoff` `detail.registered` true; receipts in the ledger. Refused: recorded; nothing depends on it. Rollback: `unregister-typeform kickoff` |
| D18 | Build 6's read-backs (section 11 step 5's list); the post-deploy md5 and ACL of every 2.2 function recorded; the end state read back; `python3 scripts/dev/forms_gates.py`; the session record in mahara-context `shared/sessions/` | `select provider, (select string_agg(e->>'owner', ',') from jsonb_array_elements(effects) e) from cockpit_forms where key = 'checkin'` = `typeform` and 8 `shadow`; `select key, detail->>'mode' from cockpit_sync_state where key in ('clickup-writeback:forms','client-messages')` = `dry_run`, `dry`; `select value from cockpit_settings where key = 'forms.move_recording'` = `{"on":false}`; `select (select count(*) from cockpit_form_effects e join cockpit_form_responses r on r.id = e.response_id where r.form_key = 'checkin' and e.owner = 'cockpit'), (select count(*) from cockpit_clickup_writeback_queue where kind = 'form'), (select count(*) from cockpit_client_messages), (select count(*) from cockpit_slack_notices where kind like 'checkin.%')` = 0, 0, 0, 0; the gate report saved with the session note |

**Rollbacks** (Z64). A failed read-back rolls back that step, and, when a later
step depends on it, every later step first, in reverse order. A migration
rollback is one transaction through the same Composio SQL path, its own
`BEGIN`/`COMMIT`, then read back; it never deletes a row and never drops a
column or a CHECK (the widened CHECKs, `provider_since`, the seed rows and any
new function left without a caller are inert: nothing can write a new kind or
call a 2b path once the triggers and the replaced bodies are back). The saved
bodies are `/Users/abdulazizwaheedi/mahara-cockpits/notes/stage2/deploy/before-2b-<name>.sql`;
each re-run is followed by its 2.2 ACL (`REVOKE ALL ... FROM PUBLIC, anon,
authenticated, service_role; GRANT EXECUTE ... TO <role>`), and the read-back
is the 2.2 live md5 again.

| Step | Rollback | Read-back |
|---|---|---|
| D1 | the native link back to the base under the lock (before the cut-over only) | the previous release's canary file; `notesFrom` absent |
| D2 | redeploy `clickup-writeback` at the D0 version's commit | version +1; `clickup-writeback:log` and `:requests` notes normal |
| D3 | redeploy `cockpit-notices` from the pre-2b origin/main sha (D0) | the doctor ok |
| D4 (`s`) | `DROP TRIGGER IF EXISTS cockpit_forms_provider_since ON public.cockpit_forms; REVOKE EXECUTE ON FUNCTION public.cockpit_form_registry_set(text,jsonb) FROM authenticated;` | registry rows unchanged; `has_function_privilege('authenticated', ...)` false |
| D5 (`t`) | re-run the four saved bodies (claim, release, begin, idle) with their `svc` ACL; `SELECT cron.unschedule('mahara-clickup-writeback-forms');` | the four md5s equal 2.2; no `mahara-clickup-writeback-forms` in `cron.job`; the next `clickup-writeback:log` note normal |
| D6 (`u`) | re-run the thirteen saved bodies, the kick first, each with its 2.2 ACL | the thirteen md5s equal 2.2; `slack-notices-kick` ok within 2 minutes |
| D7 (`v`) | re-run the saved `cockpit_client_messages_guard` (`owner`) | its md5 equals 2.2; 0 message rows |
| D8 (`w`) | re-run the saved `cockpit_form_submit` (`auth`) and `cockpit_form_effects_guard` (`owner`); `DROP TRIGGER IF EXISTS cockpit_form_effects_from_queue ON public.cockpit_clickup_writeback_queue; DROP TRIGGER IF EXISTS cockpit_form_effects_from_notices ON public.cockpit_slack_notices; DROP TRIGGER IF EXISTS cockpit_form_effects_from_messages ON public.cockpit_client_messages; DROP TRIGGER IF EXISTS cockpit_form_drafts_dispatch ON public.cockpit_form_drafts;` (the kick's guarded call then finds a sweep with nothing to do) | both md5s equal 2.2; 0 rows from the `pg_trigger` query of D8; `forms-effects-kick` and `slack-notices-kick` ok |
| D9 (`x`, `y`, `z`, reversed) | `z`: `DROP TRIGGER IF EXISTS cockpit_settings_forms_audit ON public.cockpit_settings; REVOKE EXECUTE ON FUNCTION public.cockpit_csm_move_recording(text,text) FROM authenticated;` (the switch row stays off). `y`: re-run the saved `cockpit_forms_key_put`, `cockpit_forms_key_mark`, `cockpit_forms_key_label`, `cockpit_forms_keys_status` with their ACLs (a saved `typeform_kickoff` row, if any, is then invisible: the old status lists a fixed four). `x`: `DROP TRIGGER` both late triggers (reclassified rows: none before the flip) | the md5s equal 2.2; the triggers gone; `csm-checkin-form` ok |
| D10 | revert the merge with a revert PR (never a force push) | `scripts/ship.sh` checks pass on the revert |
| D11 | redeploy `cockpit-forms-api` from `93bbd2d4` (its v1), `cockpit-csm-api` from the pre-2b origin/main sha (D0); `forms-door` stays deployed and answers 503 with no key, or is left unregistered (nothing calls it before D17) | the doctor 200; the next csm act's field bodies as before 2b |
| D12 | `scripts/ship.sh client-success-cockpit` from the D0 client-success sha | production loads the previous bundle |
| D13 | swap `csm-calls-current` back to `93bbd2d4` under the `flock -o` holder (2a's pattern) | the next run's `csm-*` keys as recorded at D13 |
| D14 | remove the client-messages cron line, then the `~/client-messages-current` link (the release folder and `~/.client-messages` stay) | no new `client-messages` row after 2 minutes |
| D15 | rsync the previous guardian copy (saved by D15 before its rsync to `/home/hermes/.guardian-before-2b/`) | the next scan as before D15 |
| D16 | nothing to undo (read only) | |
| D17 | `forms_key.py unregister-typeform kickoff` | `GET /forms/tG7dnxBn/webhooks` without `cockpit`; `WHTP3992232` unchanged |
| D18 | nothing to undo (read only) | |

---

## 10. The gates (G1 to G13), state on 2026-10-29

| Gate | State | Passes when | Check | Waits on |
|---|---|---|---|---|
| G1 | **done** | B0 done; `C09SVG6FHGU` listed, `ok`, private | `select id, private, state from cockpit_slack_channels where id = 'C09SVG6FHGU'` (true, `ok`, checked 2026-10-29 16:12 +03) | |
| G2 | B4 **done** (Anthropic `connected`); the rest waiting | the CSM or the CEO approves the DEFCON and priority definitions of `checkin.defcon_priority.v1` (a changed text ships as v2); three shadow runs have grade, DEFCON and priority, and recap drafts `ready`, and the recap checks pass | `select provider, state from cockpit_forms_keys where provider = 'anthropic'`; shadow submitted check-in responses with all three kinds ready (`cockpit_form_drafts`, the grade and DEFCON by recording, the recap by response): 0 of 3 today (0 responses) | people (approval, runs) |
| G3 | waiting | the replay re-run explains every `todo_comment` difference (4.13), and five real shadow runs by admins or the CEO, on calls the CSM also noted in Typeform, compare with Make's writes through `checkin-replay.ts --shadow <response ids>` with no unexplained difference | the two reports in `/Users/abdulazizwaheedi/mahara-cockpits/notes/stage2/replay/` | parity (re-run), then people (five runs) |
| G4 | waiting | builds 0 to 12, the G3 fix, O1 and the copy merged, deployed (D1 to D16 read back; D17 read back or recorded refused, Z22) and section 8 green | section 9's read-backs; `scripts/ship.sh` | 2b |
| G5 | waiting | the guard token's channel reads Make 07's own recap as `from_me` | `client-messages-g5` ok `same number` (D16) | D16; B5 if it fails |
| G6 | waiting | N4 live, every client `store`, no `differs`, for 7 days | `select min((data->'notesParity'->>'cleanSince')::timestamptz) <= now() - interval '7 days', count(*) filter (where data->'notesParity'->>'state' = 'differs') = 0 from public.cockpit_csm_sources where table_name = 'clients'`, and `select count(*) from public.cockpit_guardian_incidents where check_id = 'csm-notes-parity' and last_seen_at > now() - interval '7 days'` = 0 | 7 days after D1 |
| G7 | waiting | one real kickoff notice and one real Blueprint notice posted | `select kind, count(*) from public.cockpit_slack_notices where state = 'posted' and kind in ('kickoff','blueprint.close','blueprint.media') group by 1` (today none: 30 kickoff `skipped`, 1 rehearsal `posted`) | real client events |
| G8 | waiting | B6 answered; a yes applied as its own change with a read-back, its sentence carrying build 6's line | the session note | the CEO |
| G9 | waiting | the CSM made at least 3 shadow runs on real calls and the CEO read them | `select count(*) from public.cockpit_form_responses r join public.cockpit_members m on m.auth_user_id = r.created_by_id where r.form_key = 'checkin' and r.mode = 'shadow' and r.state = 'submitted' and m.active and 'csm' = any(m.roles) and not 'admin' = any(m.roles) and not 'ceo' = any(m.roles)` ≥ 3 (0 today), and the CEO's word in the session note | the CSM, then the CEO |
| G10 | waiting | A1 done and read back (`oYZKtogO` webhooks off, Make `9748311` off), after the first native Blueprint close settles `done` | `select count(*) from public.cockpit_creative_outbox where kind = 'blueprintClose' and state = 'done'` ≥ 1 (0 today), then the two GET read-backs | a real Blueprint close; then the session (A1 has the CEO's yes of 2026-10-26) |
| G11 | waiting | build 12 shipped and the 11 cases pass with `.failing` removed | `grep -c 'test.failing' apps/media-buyer-cockpit/scripts/checkin-plans-supabase.test.ts` = 0 on the shipped commit (12 lines today: 11 cases and a header line) | 2b |
| G12 | **done** (2a A7.17) | rule 2 as decided in round 3 | `stage2a-writers.test.ts` ordinary case green | |
| G13 | **done** (2a A7.18) | `OUTSIDE_CS_LIKELY` | `stage2a-writers.test.ts` ordinary case green | |

---

## 11. The cut-over hour

### 11.1 When

Only when `python3 scripts/dev/forms_gates.py` prints G1 to G13 green and the
human confirmations (G2's approval, G3's five runs, G8, G9's reading) are in
the session note; only on the CEO's yes for B1 and B2 in the session's chat for
this hour; only in an hour with no CSM call booked (the check-in calendar's
bookings through the VPS GET route, and `cockpit_csm_calls_summary`'s next
calls). The main session runs every step; each read-back must hold before the
next; a failed read-back stops the hour and goes to 11.3.

### 11.2 The steps

0. **Pre-flight** (read only): `select key, provider, provider_since, (select count(*) from jsonb_array_elements(effects) e where e->>'owner' = 'shadow') from cockpit_forms where key = 'checkin'` (typeform, NULL, 8); `select count(*) from cockpit_form_responses where form_key = 'checkin' and mode = 'live'` (0 on the first hour; after a rollback, the count the rollback's session note recorded, Z65); `select key, detail->>'mode', note from cockpit_sync_state where key in ('clickup-writeback:forms','client-messages')` (`dry_run`, `dry`); every 2.2 function's md5 equals D18's record.
1. **B1** (the CEO's yes): `fRokTITH` webhook `WHTP4114295` off and the form closed with "Write 1-1 notes in the cockpit"; read back the form closed and the webhook off (Typeform GET).
2. **Drain**: Make hook `4114295` `queueCount` 0 and no `9209179` execution running (`GET /hooks/4114295`, `GET /scenarios/9209179/logs`); both scenarios' 30-day logs show no source but `fRokTITH` (G10 holds).
3. **B2** (the CEO's yes): first read Make hook `4258649` (the recap approval hook of `9523861`) `GET /hooks/4258649` `queueCount` and write it in the session note; Make `9209179` and `9523861` off; read back `isActive` false and `queueCount` of hooks `4258649` and `4114295` again (Z68). The 20 pending drafts in data store 171744 are not sent, and the B2 sentence tells the CEO and the CSM: `The old Send links in #csm-general must not be clicked: while Make is off they queue, and they would send to the client if Make were turned back on.` Make 07 sends to the client's group on a `send` for a record still pending (`docs/forms/maps/make-inventory.md:328-337`), and those links stay in #csm-general (`make-inventory.md:162`).
4. **The store holds the last Typeform notes**: `ssh -o BatchMode=yes hermes@187.77.156.166 'flock -w 600 ~/.csm-calls/run.lock ~/csm-calls-current/hermes/csm-calls/run.sh run --only typeform --apply' < /dev/null` (`worker.ts:140`). Read back that the newest `fRokTITH` response (Typeform `GET /forms/fRokTITH/responses?page_size=1` through the VPS GET route) is in `cockpit_csm_call_forms` with a `task_id` (else stop: put it on its client from the queue first); list by token every `fRokTITH` row of the last 14 days with neither `recording_url` nor `linked_call_id` (none on 2026-10-29) for the CSM to check before she notes those clients.
5. **Outside writers and the test card** (read only): build 6's read-backs: (a) `ssh ... python3` read of `/docker/hermes-agent-ff5p/data/cron/jobs.json` filtered by `csm|eod|clickup|e183f2ce|032203ad` (expect `c4d2cc339448` enabled, `74251b60d775`, no job running `csm_evening.sh` or `csm_end_of_day.sh`); (b) `grep 'SET ' /opt/data/bibi/workspace/next-poc-sync/sync.log | tail` matches the mirror's newest `lastPoc`/`lastCall`; (c) the ledger across `cockpit_*_provider_health` for `resource ~ 'e183f2ce|032203ad'` shows only `cockpit-csm-api` act rows; (d) any card whose `lastPoc` moved with no act, no Make run and no sync line stops the hour. Then the test card `86eywg1cq`'s Client Happiness, Last POC and Last Check-in Call are read (a ClickUp GET through the VPS route) and written in the session note (Z52), and `run.sh doctor --task 86eywg1cq` reads its Client Data group and WA Group ID field (`b1d54dfb…`) today (the "no Client Data row" fact is from 2026-10-26, HANDOVER.md:97): `none` is expected; `present` means the CEO will press Skip on the canary's recap instead of approving it (Z69).
6. **Canary switches, limited** (Z35): function secrets `CLICKUP_WRITEBACK_APPLY_FORMS=true` and `CLICKUP_WRITEBACK_FORMS_ONLY_CARDS=86eywg1cq` through Composio `SUPABASE_CREATE_BULK_SECRETS` (refused: the CEO sets the two names in the Supabase dashboard, Z32); `select public.cockpit_clickup_forms_kick()`; read back `select detail->>'mode', detail->'onlyCards' from cockpit_sync_state where key = 'clickup-writeback:forms'` = `apply_limited`, `["86eywg1cq"]` (wait up to 10 minutes: secrets reach the isolates with lag). On the VPS, `switches.env` gets `CLIENT_MESSAGES_APPLY=true` and `CLIENT_MESSAGES_ONLY_CARDS=86eywg1cq`; read back `client-messages` `detail.mode = 'apply'` with that card. Nothing is `cockpit`-owned yet, so nothing moves.
7. **Shadow drafts closed, registry flipped** (Z33):
   - 7a. `select public.cockpit_form_shadow_close('checkin');` then `select count(*) from cockpit_form_responses where form_key = 'checkin' and state = 'draft' and mode = 'shadow'` = 0. This cannot be undone: a `void` response is final (`20261027f_forms_core.sql:426-430`), so an open shadow note stays readable as a record but can never be sent; anyone with an open shadow note is told before this step.
   - 7b. `select public.cockpit_form_checkin_cutover();` (Composio SQL as the owner; if the classifier refuses it, the CEO runs the same SELECT in the Supabase SQL editor and the session reads back). Read-backs: `select provider, provider_since, effects from cockpit_forms where key = 'checkin'` (native, a time, 8 `cockpit`); `select action, before->>'provider', after->>'provider', created_at from cockpit_audit_log where entity_type = 'cockpit_forms' and entity_id = 'checkin' order by created_at desc limit 1` (`forms.registry_set`, typeform to native, `created_at` equal to `provider_since`: the second source); shadow drafts 0; `forms-effects-kick` and `slack-notices-kick` ok within 2 minutes; the function's own answer quoted in the session note (`newestTypeform`, `unlinked14d`).
8. **The canary** (Z51, Z69): before 7b, tell the CSM not to send 1-1 notes until step 9. From 7b to step 9 the canary switches hold ClickUp and the recap to the test card, but the Call grade has no canary (1.4): it follows the registry on every card, so a send on any other card posts its grade in `#client-call-feedback` (found by break-it, 2026-10-30). If she has to send, turn Call grade off in Settings > Notices and routing, only after 7b, because `cockpit_form_checkin_cutover()` refuses with `the Call grade notice has no ready private channel` while it is off (`cockpit_form_delivery_ready`, `20261029s_forms_registry.sql`). While it is off every grade is muted and never posts later (`cockpit_slack_notice_fix` requeues only `failed`), the CEO's below too: read its effect `skipped` in place of this step's `posted`, turn Call grade back on before step 9, and read the first `posted` at step 10. Then the CEO opens the 1-1 notes on `86eywg1cq` and sends with the call the window offers (a recording when one is offerable; else `No recording`), and leaves Next check-in unbooked (a live window mounts booking, which would make a real GoHighLevel appointment with its notifications, 2a Y34). Within 5 minutes: `select effect_key, state, reason from cockpit_form_effects where response_id = '<id>' order by effect_key` shows `call_form` delivered; `call_match` delivered, or `skipped` with one of its two planner sentences (`No recording to put on this client.` or `The recording is already on this client.`, `20261027h_checkin_plans.sql:259`, `:262`); and the four ClickUp effects delivered (a kept date `skipped` with its `stays` sentence passes). `select state, error, steps, progress->'steps' from cockpit_clickup_writeback_queue where kind = 'form'` shows the comment text in `steps` with the recording line first and `Cockpit ref F-` last, and in `progress->'steps'` states and ids only, no text. With a recording: the grade notice `posted` in `#client-call-feedback`; the recap message appears on the Messages card; if step 5 read no group, the CEO approves it and within 3 minutes it reads `refused` with `No WhatsApp group on Client Data for this card…`; if step 5 read a group, the CEO does not approve; either way the CEO then presses Skip (allowed from `draft` and from `refused`, Z55); the recap effect reads `skipped` and no reminder follows. A second CEO send with `No recording` plans no grade and no recap (both `skipped` with their reasons).
9. **Open to all**, only when every token in 7b's `unlinked14d` answer is marked checked by the CSM in the session note (a Typeform form with neither `recording_url` nor `linked_call_id` is invisible to `cockpit_form_call_noted_at`, `20261027f_forms_core.sql:1020-1024`, so a native send for that call would write a second comment, Happiness, grade and recap; the CSM confirms she will not note those calls again): remove `CLICKUP_WRITEBACK_FORMS_ONLY_CARDS` (kick; read back `apply`) and `CLIENT_MESSAGES_ONLY_CARDS` (read back); switch on Move it here: `select set_config('cockpit.audit_actor', 'cut-over', true); update public.cockpit_settings set value = '{"on":true}', updated_by = 'cut-over', updated_at = now() where key = 'forms.move_recording';` in one transaction (the `z` trigger writes the `forms.switch_set` audit row, Z62); read back the value and that one audit row. The CSM is told the 1-1 notes are in the cockpit.
10. **Watch, then follow up**: the CSM's first native send delivers within minutes; her first approved recap reaches `sent` with `read_back_at` (`select state, provider_id is not null, read_back_at, read_back->>'by' from cockpit_client_messages order by created_at desc limit 1`). The links follow-up (11.4) ships once B1 is read back. The session is recorded in mahara-context `shared/sessions/`.

Between steps 1 and 7 the entries still open the closed Typeform for a few
minutes: notes wait, nothing fires twice. A second live record of one call is
refused by submit step 8 under its lock and the two unique indexes
(`20261027f_forms_core.sql:141-146, :1618-1663`), and the grade posts once per
recording.

### 11.3 Rollback and kill switches

| When | Do |
|---|---|
| before step 6 | before B2 is reversed: read Make hooks `4258649` and `4114295` (`GET /hooks/{id}` `queueCount`); if either is not empty, the CEO reviews or deletes those queued items in Make first (Z68), because turning `9523861` back on would run a queued `send` to a client's group; then the CEO reverses B2, then B1 |
| after step 6, before 7b | unset the two secrets; `CLIENT_MESSAGES_APPLY=false`; then as above (the two hook reads first) |
| after 7b (on the CEO's yes) | `select public.cockpit_form_registry_apply('checkin', '{"provider":"typeform","owners":"shadow"}', '{"via":"cutover-rollback","email":"cut-over"}');` queued deliveries are skipped at claim (`Make owns this again.`), and open ClickUp rows settle within a minute through the dry-run claim, in any mode, because the kick counts a refused row as due (Z74); a WhatsApp recap already claimed is stopped at intent (Z66), planned ones by the next sweep, open live drafts voided on open; unset `CLICKUP_WRITEBACK_APPLY_FORMS`; `CLIENT_MESSAGES_APPLY=false`; `forms.move_recording` off; record the live check-in response count in the session note (step 0 of a later hour reads it); then the two hook reads and, only with both queues empty or reviewed, the CEO reverses B2 and B1. Late rows stay late; native notes already sent stay as records; the shadow notes voided at 7a stay readable but can never be sent; `cockpit_form_checkin_cutover()` can run again at a later hour with all its checks (Z65); anything still open at that later hour is refused by the gate there, because it was sent before that hour's `cockpit_form_native_since`, and nothing passes at all while the provider is `typeform` (Z70) |
| one path only, after the hour | ClickUp: unset `CLICKUP_WRITEBACK_APPLY_FORMS` (rows wait `queued`); grade: Settings > Notices and routing > Call grade off (queued grades `muted`, the effect `skipped`); recap: `CLIENT_MESSAGES_APPLY=false` (approved rows wait, then expire to draft; the dry runs still sweep a crashed `sending` row to `unknown`, Z67); Move it here: `forms.move_recording` off (the trigger records it) |

### 11.4 The links follow-up (a short session after B1 is read back, Z39)

Remove the `1-1 call summary form` row of `apps/client-success-cockpit/src/lib/csmLinks.ts:72-81`;
delete `LINKS.callSummaryForm` (`csmTemplates.ts:37`) and the media buyer copies
(`apps/media-buyer-cockpit/src/lib/csmLinks.ts`, `csmTemplates.ts`); repoint
`viktor-side-scripts/csm/csm_assistant.py:37`; remove `checkinFormLink`
(`onboardingCore.ts:105`) and its tests; ship 4.15 item 3; update the ClickUp
doc "Important Forms" (a provider write: the session on the CEO's standing
instruction, else the CEO). Owner for that session: screens (cockpit files)
and parity (docs).

### 11.5 Stage 2 done (PLAN 2.9), each with its check

| # | Criterion | Check |
|---|---|---|
| 1 | Every CSM 1-1 call in a week has native notes with a matched call | 2a's SQL per Kuwait week from `provider_since`, plus `csm-impromptu-notes` at 0 and no impromptu row on Today; a `legacy` response never counts (Z48) |
| 2 | The worker keeps impromptu client calls | 2a's check (unchanged) |
| 3 | The recaps went through `hermes/client-messages` with a read-back | every `sent` row has `provider_id` and `read_back_at` |
| 4 | No Typeform check-in after the cut-over | `select count(*) from cockpit_csm_call_forms where form_kind = 'checkin_late' and submitted_at >= (select provider_since from cockpit_forms where key = 'checkin')` = 0 and no `legacy` check-in response since |
| 5 | Kickoff and Blueprint in the forms tables | rows in `cockpit_form_responses` and `cockpit_form_effects` for both (build 8) |

---

## 12. CEO items

| Id | When | Item | State |
|---|---|---|---|
| B0 | | Invite mahara-club-bot to `#client-call-feedback` | **done** (G1) |
| B1 | the cut-over hour | `fRokTITH`: webhook `WHTP4114295` off, form closed | **his yes** |
| B2 | the same hour, after A1 (G10) | Make `9209179` and `9523861` off; the sentence names everything they stop (the 1-1 to-do comments, Happiness, grades and recaps, and any other source step 2 finds) and says the old Send links in #csm-general must not be clicked (11.2 step 3) | **his yes** |
| B3 | deploy D17 | the signed cockpit webhook on `tG7dnxBn`, store only | decided here (Z22): not his by nature |
| B4 | | the Anthropic key | **done** |
| B5 | only if G5 fails | which WhatsApp number the cockpit sends from | **his**, with both last 4 values |
| B6 | open (G8) | check-in calendar auto-confirm | **his answer**; its apply sentence adds build 6's line |
| B7 | | the Fathom and DeepSeek keys and the Fathom webhook | **done** in 2a (`fathom`, `deepseek`, `fathom_webhook` connected) |
| R4-privacy-4 | any time | rule 1's `csmEmails` clause (2a A7 item 18): narrow it, or keep the runbook line | **his**; the interim RUNBOOK line changes no code (Z40) |
| step 6 fallback | the hour, only if the Composio secret write is refused | set the two function secret names in the Supabase dashboard | an action while he is present, not a decision |

---

## 13. Risks

| Risk | Guard |
|---|---|
| A replaced live function drifts from its source (submit, effects guard, the notices kick and claim, the writeback claim and release, the messages guard, the key functions) | one owner each (2.2); the md5 check before every apply; body-diff tests; the Stage 1 and requests suites stay green |
| A broken notices kick stops every Stage 1 notice | the two added calls each sit in `BEGIN ... EXCEPTION` and log through `queue_failed`; D6 and D8 read back `slack-notices-kick` advancing ok within 2 minutes |
| A settle trigger that raised would block `clickup-writeback`, `cockpit-notices` or the WhatsApp sender | every settle path is exception-safe; an illegal move writes `forms.settle_refused`; the test forces one |
| A failing delivery insert loses the CSM's notes | it never rolls back the submit: the effect stays `planned` with the error, the sweep retries every minute, and it fails with a sentence after 30 minutes (Z5) |
| A form row reaches the log job before its exclusion and is skipped | `t` (the exclusion) applies before `w`; no `form` row can exist before the registry flip |
| Two writers of one ClickUp date in the same minute (the form and the Next POC sync) move Last POC back | both are forward only by Kuwait day; rare (one card, one minute, an older booking); a day-later comparison of the effect receipt with the mirror shows it |
| A response stuck `unknown` on a card holds later notes on that card for up to the ladder (about 5 hours) | the lane is per response; `queue-clickup-forms` warns at 15 minutes |
| Happiness keeps Make's rule (write unless equal), so a late retry can override a hand change made after the send | the ladder is short and the guardian warns at 15 minutes |
| The grade is AI text about a staff member's call | private channel only (claim and settings refuse a public one), tags nobody, the text read at claim from the stored draft, never stored in facts; the view never returns text or blocks (`20261025n:590-654`) |
| A sender older than `u` leaves a check-in notice `sending` | `cockpit-notices` deploys before `u` (D3); nothing queues a check-in notice before the flip |
| A recap reaches the wrong group | the group from Client Data column F by header with the shape checked; a set and different card field refuses; a ClickUp read failure releases; one message a run; never a resend of `unknown` |
| Make's double send (City Wood) repeats | one row per response (dedupe), an advisory lock with `SKIP LOCKED`, the intent before the POST, never a resend of `unknown` |
| The guard's transport retries a POST and a client group gets the recap twice | `sendText` calls `Transport.json` with `read` false (one fetch); a 429, 5xx or timeout is `unknown`, never retried; tests count fetches (Z59) |
| A rollback's open row fires at a second hour, or a grade posts while the provider is `typeform` (Slack has no second switch) | the gate passes only a response sent at or after `cockpit_form_native_since`, and a NULL never passes (Z70) |
| One effect is moved to `make` and back to `cockpit` inside one native window; the gate's cut-off time does not reset, so a row left open passes again | accepted: no such move is planned, and closing it needs a per-effect owner-change time, a contract change |
| The forms job adds to the one ClickUp token: with every ceiling aligned the sum in `docs/requests/CLICKUP-DOWNGRADE.md` 1.3 reads 107 (its 97 plus 10), not expected use | a low default, one run at a time, a 429 stops the run; `clickup-rate-budget` warns over 80, then lower `CLICKUP_FORMS_CALLS_PER_MINUTE` (Z80) |
| `CLICKUP_API_TOKEN` goes missing: `runForms` stops before it claims, so refused rows stay open and the kick posts an empty run every minute (no ClickUp call) until it is back | `clickup-writeback:forms` reads not ok with the no-token sentence; the rows settle on the first run after the token is back |
| A recap claimed just before a rollback still sends | `intent` re-runs the owner gate after the wait and posts nothing on a refusal (Z66) |
| Turning B2 back on replays queued Make sends to clients | the hook queues are read before and after B2 and before any reversal; non-empty queues are reviewed first; the old Send links are named as not to be clicked (Z68) |
| A dispatch fault rolls back a submit, shadow runs included | the dispatch body sits in one outer exception block and never raises (Z53); test (13) |
| A switch is turned on through REST with no trace | `z`'s trigger audits every `forms.%` change of `cockpit_settings` (Z62) |
| The CEO seat moves the 1-1 notes to native without B1, B2 or the checks | `native` only through `via = 'cutover'` (Z54) |
| A replaced function moved between the md5 check and the apply | each file's drift guard re-checks inside the apply's transaction (Z61) |
| WhatsApp drops or rewrites text, so the hash read-back finds nothing | the message id is the primary read-back; no match never means resend; the guardian warns on a sent row with no read-back after 60 minutes |
| The worker couples to the guard's transport and runtime file | the release packs both guard files at the same sha; a pin test fails if `Transport.send` changes; the token is read by name and never printed |
| The classifier refuses the owner-run flip or the secret writes (A3) | the CEO runs the same SELECT in the SQL editor, or sets the two secret names in the dashboard, while present for B1 and B2 |
| The canary card has no offerable recording | the canary runs with `No recording`; the grade and recap paths are watched on the CSM's first real send, with the 30-minute timeouts and the guardian rows as the net (Z51) |
| The cadence notes freeze if `hermes/csm-calls` stops after N4 | `csm-calls-sync` fails high after 45 minutes; new Typeform responses read `differs` after 30 |
| A rollback of N4 after the cut-over loses native notes from the cadence | every later native release is based on N4 (the release script's base md5 check) |
| A late Typeform form is a lost effect (Make off, native unused) | the guardian's `csm-checkin-form` warning names the client; the notes are re-entered in the window |
| The `93bbd2d4` rollback writes a late form back as `checkin` or links it | the database trigger keeps it late and unlinked whoever writes; a cosmetic own call row for a late form is recorded in the RUNBOOK |
| A Typeform webhook replay | idempotent by token; Typeform signs no timestamp |
| Build 8's guard insert path is misused | limited to the `forms_record` flag, owner `cockpit`, a `delivery_ref` and kickoff or Blueprint; tested |
| An admin moves a recording that carries the old client's notes | refused server side (notes guard); `FOR UPDATE` against two admins; audited; reversible by another move |
| A CSM places an impromptu call on the wrong client | the existing manual match is audited; an admin can move it (build 11) |
| The focus token change draws an outline plus a ring on some components | cosmetic, never invisible; the design test lists such class strings |
| The sales session keeps adding `20261029` letters and reaches `s` | the letter rule (2.1) reads before builders start and before every apply |
| `CsmPage.tsx` is edited by builds 3c, 10 and 5's test | one owner (screens); anchors by content |
| N4's guardian files collect build 9 or 10 edits before N4 is committed | the worker stops on N4's file set until the orchestrator reports the commit; a path-limited commit (Z63) |
| bun counts a failing `test.failing` as a pass | G11 reads the file; the fit test asserts no `test.failing` in any 2b file |

---

## 14. Not verified

- That `pg_catalog.sha256` behaves identically in PGlite and production for every UTF-8 body (the tests prove PGlite; production holds `sha256` since PG 11, query in section 16).
- That a Supabase function secret change reaches every Edge isolate within 10 minutes (step 6 waits and reads back the mode).
- That the window's gate lets the CEO open notes on `86eywg1cq`, whose mirror stage is `Stopped`; the CEO opens a shadow run on it before the hour (G3 or G9 practice).
- That a recording is offerable on the test card for the canary (Z51).
- WHAPI's `/health` and the list's `time_from`/`time_to` filters (unverified shapes; G5 rests only on `from_me` and `text.body`, which the guard proves, and anything unreadable is `not proven`).
- That the guard channel's WHAPI history reaches back to 2026-10-13 17:55 (the guard was installed about 2026-10-11 22:31); the two 2026-10-11 18:0x recaps may be absent.
- The ClickUp 03:00Z versus 04:00Z storage of date-only values (inferred; every read-back compares Kuwait days).
- Whether the VPS `TYPEFORM_TOKEN` has webhooks write scope (B3; refused means B3 waits).
- That the Hermes agent's Next POC sync keeps its rules (it lives outside the repo; step 5 re-reads it).
- That the forms job's 10 calls a minute and its 100 s run budget sit inside the token's budget of 80 in practice (about 11 calls a response by the code; never run live, the job is dark). `clickup-rate-budget` is the check after the cut-over.
- Whether the CEO has already moved to ClickUp Business (not read here; the limit is 1,000 a minute until he does, so the budget of 80 holds either way).
- A second cut-over hour against the live database (Z70, Z74): proved in PGlite only.
- The 2026-09-30 14:20:57 stray comment on `86eymcqdq` (it fits the eod submit scripts' shape; not attributed).
- How long Make hook `4114295` takes to drain after B1 (step 2 waits for `queueCount` 0).
- That Make keeps a hook's deliveries queued while its scenario is off and runs them when it is turned back on (assumed for hooks `4114295` and `4258649`; provider calls were out of bounds for this contract; the hook reads of 11.2 step 3 and 11.3 guard either way, Z68).
- That a field read of a NULL `NEW` in a `DELETE` row trigger returns NULL in PGlite and production alike (`z`'s settings audit trigger; its test proves PGlite).
- That `forms-door` receives Typeform's signature header exactly as `team-onboarding-intake` does (its handler test uses the same helper).

---

## 15. Decisions this contract makes, with reasons

### 15.1 Supersedes (where 2a section 13 is changed)

| 2a section 13 said | 2b does | Why |
|---|---|---|
| Build 0 (1): every delivery row in the submit's transaction | in the same transaction on success; a failing insert keeps the effect `planned` and never rolls back the notes | Z5 |
| Build 0 (4): one guardian row over planned, queued or unknown effects | two rows; a `queued` recap (waiting on a person) is left out | Z36 |
| Owner re-check: "settles both the delivery and the effect skipped" | the claim settles its delivery row, the settle trigger moves the effect; an `unknown` ClickUp effect settles `failed` with the check-the-card sentence | Z3, Z9 |
| Build 3: approve RPC `(p_id, p_body, p_body_sha256)` | `(p_id, p_body, p_body_sha256, p_actor, p_warnings)`, service only, through `recap.approve` | Z27 |
| Build 7: registry RPC behind the editor gate | owners by the editor gate; provider back to `typeform` by the CEO seat; `native` only by the owner-run cut-over function | Z12, Z54 |
| Build 8: `skipped` `Sent by the Stage 1 path.` when the Stage 1 row does not exist yet | waits while Stage 1 is in flight; `delivered` when Stage 1 sent; `skipped` with Stage 1's own reason, or the 48-hour sentence | Z21 |
| Build 9: the cut-over time from the audit row; the legacy row "through a service RPC"; `csm-checkin-form` `ok: false` | `cockpit_forms.provider_since` (the audit row its second source); the legacy row from an AFTER trigger; `ok: true` with the late sentence | Z13, Z14, Z15 |
| Build 10: AfterCalls rows "link to the queue"; `csm-calls-unmatched` warns for 2 runs | the rows place the call in place; a new check `csm-impromptu-notes` (confirm 2) warns, and `csm-calls-unmatched` (confirm 3) carries the count | Z17 |
| Build 11: `cockpit_csm_attach_recording` may move | a separate RPC behind `forms.move_recording`; the attach unchanged | Z16 |
| The cut-over hour, 8 steps; step 4 cites `worker.ts:122` | 10 steps (11.2): the canary switches limited before the flip, shadow close and flip in one owner-run function, the links in a follow-up; `worker.ts:140` | Z33, Z35, Z39 |
| Y17 (2a): no new pg_cron job | 2b adds exactly one, `mahara-clickup-writeback-forms` | Z10 |
| Y56: `todos.ts` import-free but a type | `todos.ts` imports `sameName` from `./transcript.ts` | Z24 |
| 2a section 15: who writes Last POC without a comment, not verified | found and kept (build 6) | Z20 |

### 15.2 Decisions

| # | Decision | Why |
|---|---|---|
| Z1 | The 2b migrations are `20261029s` to `20261029z`, shifted together by the letter rule if any is taken | `20261029a` to `j` are sales (live and on main `64807762`), and the sales session added ten letters in one day; the date closes today, leaving `k` to `r` for it; `20261030` is where other sessions start tomorrow |
| Z2 | One owner per replaced function across 2b (2.2); no 2b file replaces `cockpit_form_checkin_value`, `cockpit_csm_attach_recording` or `cockpit_form_apply_sql_effects` | two copies of one body drift; the fewer 2a bodies replaced, the less 2a behaviour can move |
| Z3 | One owner gate, `cockpit_form_effect_gate(p_delivery, p_ref) RETURNS jsonb`, in `s`, called by every claim and the approval; its reasons word for word | three outboxes with three copies of PLAN 4.3's rule would drift; `s` applies first, so `t`, `u`, `v` can call it from the start |
| Z4 | Nothing becomes `cockpit`-owned before its delivery path exists (`cockpit_form_delivery_ready`), checked in the database | a flip before a path is installed would plan effects nothing can deliver; the refusal names the missing piece |
| Z5 | One dispatch function, three entry points (submit, drafts-ready trigger, minute sweep); a failing delivery insert never rolls back the notes; a waiting reason is written once, and every reason change goes through `cockpit_form_effect_note` with its audit row (Z53) | losing a send costs more than a delayed write; one path means one behaviour; every later write is audited |
| Z6 | The queue payload carries no comment text (only `commentChars` and `commentSha256`); the writer reads the text from the effect plan through its claim and freezes it | the queue's audit trigger copies payloads into `cockpit_audit_log` and strips text only for `task_action` (`20261026t_task_alerts.sql:678-695`); the CSM's notes stay in one place |
| Z7 | The grade notice dedupes `grade:{recordingId}`; facts carry ids and times; the claim reads the grade by `facts.draftId` | one post per call (Y33); no AI text in an outbox row; the exact draft, not "the newest" |
| Z8 | The recap message is the ready draft's text byte for byte with its sha256; over 4,096 fails the effect with a sentence, never cut | what is approved must be what was drafted; a cut message reads wrong to a client |
| Z9 | The settle mapping of 3.6; a refused message leaves the effect `queued`; a reopen and a notice fix requeue the effect under `forms_fix`; the guard gains `unknown` to `skipped` | a refusal waits on a person, who can reopen; a kept date or an empty read-back proves nothing was written, so an `unknown` may close as `skipped` |
| Z10 | The effects sweep and the recap reminder ride the notices kick (`u` owns it; `w`'s kick is called through `to_regprocedure`); the one new cron is the ClickUp forms kick, which posts only when work exists or the report is stale | one owner for the kick; the forms job keeps its faults apart from requests and the log, without 1,440 idle posts a day |
| Z11 | No new secret: the sweep op uses `NOTICES_CRON_SECRET` (function secrets are project-wide) and the forms kick `cockpit_sync_secret` | A3 refuses secret writes from the session |
| Z12 | The registry patch holds only `provider` and `owners` (a string or per effect); only `checkin` changes; a provider change needs the CEO seat or the owner-run path, and `native` only the cut-over path (Z54); native needs `call_form` and `call_match` owned by `cockpit`; `typeform_id` untouched; the flip voids shadow drafts atomically; no guard trigger on `cockpit_forms` | PLAN 4.3 needs one effect switched back alone; Y49 keeps kickoff and Blueprint on Stage 1; a provider flip without B1 and B2 makes two live writers; Y42 needs `fRokTITH`; Y32; seven test fixtures update the table directly and the 2a trigger already audits every change |
| Z13 | The cut-over time is `cockpit_forms.provider_since`, set by a trigger in the same statement as the 2a audit row, which is its second source | the worker (REST) and the guardian (plain columns only, `guard/db.py:13-14, 27-29`) read a column; SQL reads it too |
| Z14 | Lateness is decided by a BEFORE trigger on `cockpit_csm_call_forms`, sticky, and drops `linked_call_id`; the legacy response comes from an AFTER trigger in an exception block | one rule for every writer and release, the `93bbd2d4` rollback included; the timeline's call form join has no kind filter (`20261011f:56-57`) |
| Z15 | `csm-checkin-form` stays `ok: true` with the late sentence; the guardian warns | `ok: false` stops `last_ok_at`, so `csm-calls-sync` would fail high and every run exit 1 printing FAILED, masking real failures (A8.2's lesson) |
| Z16 | Build 11 is its own browser RPC behind `cockpit_settings` `forms.move_recording` (off); the attach keeps refusing another client's recording | a send can never move a recording; only an explicit, confirmed gesture by an admin or the CEO does; no 2a body is replaced; a database switch can be flipped by SQL where a function secret cannot (A3) |
| Z17 | Impromptu rows list only the seat's own candidates, only once the registry is native, and place the call in place with the existing RPCs; the alert is a new check with confirm 2 | AfterCalls is "your calls" and names no other recorder; no new writer; the contract's "2 runs" cannot hold inside a confirm-3 check without changing the share warning |
| Z18 | N4 ships first, alone, with the store authoritative from its first cycle and Typeform kept as a comparator until the flip; the 7-day clock lives in `notesParity.cleanSince` plus the guardian's incidents | G6 asks for 7 days of equality, which can start only once N4 runs; 19 of 19 clients already equal; a shadow-then-flip pair would put a second canary into the cut-over hour |
| Z19 | Build 5 ships live with no switch, named as the one exception to "nothing reaches a card before the flip" (section 0 item 1, section 9), with D11's field-body read-back and its own rollback | it fixes the format and the false failure of an existing writer the CEO already uses (both live acts ended `reconcile`); the dark rule is for new writers |
| Z20 | The Next POC sync is kept and recorded, not retired | forward only, comment-free, the CEO's own 2026-10-22 rule, the only writer in step with GoHighLevel bookings; stopping it needs a VPS write |
| Z21 | Build 8: `forms-door` has the Typeform route only; content lives once in `cockpit_csm_call_forms` and a response holds a pointer; Stage 1 effects are recorded from the Stage 1 row's outcome; the sweep runs inside `hermes/csm-calls` | Y49; kickoff hidden fields carry email and phone, which the responses audit would copy; `skipped` is final and would be written before Stage 1 had its turn; no new cron |
| Z22 | B3 is run by the session at D17; refused, it waits for a later session; no paste fallback in 2b | B3 is not the CEO's by nature and he said to run it; the 15-minute read records every kickoff, so nothing depends on it |
| Z23 | The guardian belongs to worker alone, and every new row reads tables | its REST door has no generic RPC call (`guard/db.py:252-345`) |
| Z24 | They owe: a name-only assignee not on staff is `they`, unsure; a staff name is `we`; `TODOS_VERSION` v2; the replay masks contact names in SQL | nothing invented or dropped; "not on our list" is not certainty, so the window's "Who owes this?" still asks; 0 of 39 name-only assignees in 120 days match a staff first name |
| Z25 | The two notice settings rows are seeded enabled; the registry owner is the switch; private-only and no tags are enforced in code | a separate off toggle forgotten at the hour would mute real grades; the exception is named for privacy, not for one channel id |
| Z26 | WhatsApp: two switches must both be on (the registry owner and `CLIENT_MESSAGES_APPLY`); the token `AD_BILLING_WHAPI_TOKEN` read by name from the guard's runtime file; only `Transport.json` (one fetch for the send, Z59), `sheet` and `task` reused, with an own `sendText` without the reference line | one channel, one copy of the proven write semantics, no copied secret; G5 measures exactly this token |
| Z27 | Approval goes through `recap.approve` to a service-only RPC with the verified actor; warnings need `Approve anyway`; an approval expires after 24 hours; the approver's access is re-checked at claim | a browser can never skip the TypeScript checks; Make's parity lets the reviewer edit; stale approvals do not send |
| Z28 | A recap with no ready draft is not sent by the cockpit (the CSM sends it by hand); an `off`, `failed` or `skipped` draft fails the effect at once with its reason; a later ready draft requeues a failed recap within 24 hours of the send | the fewest client-facing paths; a plain sentence sooner than a 30-minute wait; a CSM who presses Draft again still gets her recap to approve |
| Z29 | G5 is the guard token reading Make 07's own recap as `from_me`; `not proven` counts as failed | display names prove nothing about the phone; no client send rests on a guess |
| Z30 | O1 changes the client-success cockpit only; DESIGN.md says so | A7.17's O1 names its files; the other apps move on their next pass |
| Z31 | The entry fallback opens the window only after the links follow-up | until B1 is read back the Typeform is still the record (8.4: the record never blocks) |
| Z32 | The ClickUp switch stays a function secret (`CLICKUP_WRITEBACK_APPLY_FORMS`), set by the session through Composio at the hour, else by the CEO in the dashboard; the claim's gate is the registry brake | the same pattern as `APPLY_REQUESTS`; effects-parity 5.3 |
| Z33 | Steps 7a and 7b are one owner-run internal function through Composio SQL; refused, the CEO runs the same SELECT | the session cannot act as a seat (A3); the flip is his switch either way |
| Z34 | Move it here turns on at step 9 by the session, with an audit row | internal, admins and the CEO only, audited, reversible by another move |
| Z35 | The canary switches go on, limited to the test card, before the flip | no window exists in which live effects queue against an unlimited writer, and the held window shrinks to minutes |
| Z36 | The guardian leaves `queued` recap effects out of its effects rows | they wait on a person; `queue-client-messages` and `checkin.recap_late` cover them |
| Z37 | SQL is split by domain: db writes `s`, `w`, `x`, `y`, `z`; writers `t`; notices `u` and `v`, each with its PGlite suite | the role that builds the writer knows its outbox; all files follow one set of rules (2.1) |
| Z38 | `cockpit-forms-api` belongs to writers except `todos.ts` and `drafts.test.ts` (parity); writers bump `TODOS_VERSION` | every file one owner; the rule and its replay land together (Y56) |
| Z39 | The links of 2a's step 8 are removed in a short follow-up session after the hour | nothing waits on a branch; a link removed before B1 would strand the CSM |
| Z40 | R4-privacy-4 is left unchanged; an interim RUNBOOK line | the code choice is the CEO's; the line changes nothing and matches today (no csm-only recorder outside Customer Success) |
| Z41 | The fit and ownership tests and the gate report belong to parity | parity is the integration role; every file needs one owner |
| Z42 | The sweep op begins drafts as the response's own seat through a `draftsForResponse` export extracted from `checkinDrafts`, which takes its drafts reader as a parameter (Z56) | `checkinDrafts` reads the response (`drafts.ts:378`) and its drafts (`:445`, `:502`, through `:353-356`) with the seat's client, which a cron cannot use; one code path keeps the window unchanged |
| Z43 | The recap reminder fires 24 hours after the later of the call's end and the send, links to `?tab=overview#messages`, tags nobody by default | a late note-taker is not reminded early; one target |
| Z44 | Y49 holds at every dispatch entry point (submit, sweep, drafts trigger) | a second kickoff or close notice was the September harm |
| Z45 | The Messages card is on the overview tab with `id="messages"` | one anchor for the reminder, the Today rows and the window's link |
| Z46 | The window switches from preview to approval by the effect's owner and the row's presence, not by a flag of its own | the registry flip is the single switch |
| Z47 | The trail's 15-minute waiting line is computed in the browser from `EffectView.at` | missing is never zero, with no 2a view replaced |
| Z48 | A `legacy` response never counts as notes (build 10, done criterion 1) | it holds no answers and fired no effect |
| Z49 | A native row's commitments are its We owe items, whole; Typeform rows keep today's rule | A7.15's labelled lines stay whole; G6 compares like with like |
| Z50 | The deploy order of section 9 (N4; the two functions that precede their migrations; `s` to `z`; merge; the other functions; the ship; the worker releases; the guardian; G5; B3) | Y41; each read-back depends on the step before |
| Z51 | The canary may run with `No recording`; the grade and recap paths are then first watched on the CSM's first real send | the CEO's recordings are in Sales and may not be offered on the test card; the recap is human-approved anyway |
| Z52 | The test card's values are read before the canary and not restored | an internal card in `Stopped`; the dates are forward only, so restoring would need a backward write |
| Z53 | Effect reasons: the waiting reason is written only while `reason IS NULL`; every reason change without a state move goes through `cockpit_form_effect_note` (only when it differs, one `forms.effect_reason` audit row); the dispatch's whole body sits in one outer exception block that notes `forms-effects-kick` and never raises | `cockpit_form_dispatch` cannot know its caller, so "written only in the submit" was not buildable; the 2a effects audit fires only on `UPDATE OF state`, so a bare reason write left no row; a preamble error would otherwise roll back every submit, shadow runs included |
| Z54 | `native` only through `via = 'cutover'`; the CEO seat may move the provider only back to `typeform`; the registry RPC re-raises the editor gate's refusal with its own sentence | the cut-over function is the only path with the newest-Typeform and readiness checks and with B1 and B2 done before it; the gate's own sentence names notices and routing |
| Z55 | A `refused` or `failed` message can be skipped by a person; a refused message's effect then settles `skipped`, a failed one's stays `failed` | a refusal waits on a person, who must be able to close it without a send (the canary's step 8 needs it); the 2a effects guard has no `failed` to `skipped`, and adding one for a cosmetic state is not worth a third guard move |
| Z56 | The cron path reads drafts through a service RPC, `cockpit_form_drafts_service`, passed to `draftsForResponse` as its reader | `cockpit_form_drafts_read` is `authenticated` only and gates on `auth.uid()`; skipping the reads would let a missing key write a second `off` row each run |
| Z57 | `cockpit_forms_keys_status` keeps `keys` to its four providers and lists the Typeform key in a separate `typeform` array | the deployed CEO card's zod enum would refuse a fifth provider and show an error; an unknown top-level key is dropped by zod, so no media-buyer file changes |
| Z58 | In 2b only the kickoff form has a cockpit Typeform webhook: the keys CHECK names `typeform_kickoff`, `forms-door`, the record RPC, `door_seen` and `forms_key.py` accept `kickoff` only | the checkin row also has a `typeform_id` and provider `typeform`; a checkin webhook registered by mistake would store live responses that block nothing now but muddy the cut-over's records |
| Z59 | The WhatsApp send is one fetch (`read` false), never retried; a 429 is `unknown`; any 2xx without `sent === true` and a string id is `unknown`; a run claims only with 200 s of its 300 s left | a retried POST is a second message in a client's group; an `unknown` is settled by a person reading the group; a send cut by the cron's timeout turns a good send into `unknown` |
| Z60 | The three WhatsApp switches are read only from `~/.client-messages/switches.env`; keys come first-wins from the guard's runtime file, the native release's runtime file, then `api-keys.env`; the doctor checks `SUPABASE_URL` and prints each source | `readEnv` is first-wins across files shared with other jobs, so a missing line would let another file switch sending on; `api-keys.env` names another Supabase project |
| Z61 | Each replacing migration carries a drift guard on the normalised `prosrc` md5 (before or after) inside its own transaction; the deploy's `pg_get_functiondef` md5 check stays as the second source | each apply is a separate call and other sessions apply migrations the same day; `prosrc` is identical in PGlite and production, so the file stays safe to apply twice and testable |
| Z62 | `cockpit_settings` gets an audit trigger for `forms.%` keys; the seed and step 9's switch rely on it | `service_role` has full write on the table and no trigger existed, so a switch could change with no row |
| Z63 | N4's file set is committed alone by a path-limited commit, cherry-picked to main from the main session's own checkout; the worker stops on those files until told | non-interactive git cannot stage part of a file, and three of those files are also edited by builds 9 and 10 |
| Z64 | Every deploy step has a written rollback (section 9); migrations roll back in reverse letter order in one transaction each, re-running the saved bodies with their ACLs, dropping the new triggers and the new cron job, never deleting a row | "rolls that step back" needs a how; D5, D6 and D8 replace live heartbeats of Stage 1 and the writeback |
| Z65 | The cut-over function does not refuse on existing live check-in responses; "already native" is the re-run guard | after a rollback past step 8 the canary's responses stay, so the function could never run again and a second hour would hand-call the core without its checks |
| Z66 | `intent` re-runs the owner gate after the 30 to 120 s wait (refused: back to `approved`, then the next claim skips it) and refuses a fourth attempt with a sentence | a claim made just before a rollback must not send; a row at three attempts would loop claim, release, claim every 10 minutes with a Sheets and a ClickUp read each time |
| Z67 | Dry mode runs the message sweep | after `CLIENT_MESSAGES_APPLY=false` a crashed `sending` row must still reach `unknown` and the CEO's Today row (missing is never zero) |
| Z68 | B2 and every reversal of it read Make hooks `4258649` and `4114295` first; non-empty queues are reviewed in Make before Make 07 is turned back on; the B2 sentence names the old Send links | Make 07 sends to a client's group on a `send` for a pending record, and 20 pending drafts keep their links in #csm-general |
| Z69 | The canary books no next check-in, and the test card's Client Data group is re-read at step 5; a group present means Skip, never approve | a live window's booking makes a real GoHighLevel appointment; the "no Client Data row" fact was three days old |
| Z70 | The gate passes a response only if its `submitted_at` is at or after `cockpit_form_native_since(form_key)`; a NULL since never passes, so nothing passes while the provider is `typeform` (3.1, 11.3). This replaces db's first wording, `coalesce(native_since, provider_since, '-infinity')`, which set no bound while the provider had never moved | Slack is the one outbox with no second switch: ClickUp has its apply secret and WhatsApp its switches file, but a queued grade notice posts on this gate alone, and an admin may move owners while the provider stays `typeform` (Z12). A forged live response plus that allowed flip posted one message to `C09SVG6FHGU` in the break-it run. It also refuses, at a later hour, whatever a rolled-back hour left open |
| Z71 | The readers check the registry's owner as well as the effect row's: `cockpit_form_effects_waiting_rows` and `cockpit_slack_notice_sweep_checkin` (which also needs a non-NULL `cockpit_form_native_since`) | an effect row keeps the owner it was planned with, so after a rollback a reader that trusts the row asks for drafts or queues a reminder for something Make owns |
| Z72 | Approving a recap the gate refuses says `This recap is from before the latest switch-over, so it is not sent from here. Press Skip.` while the registry is native and the response predates `cockpit_form_native_since`; `Make still sends...` otherwise (3.1) | after a second cut-over the old sentence is false, Make is off, and the person needs the next step |
| Z73 | The second brake in `cockpit_form_checkin_cutover()` (a fourth refusal while any `form` row is queued, sending, retry or unknown) is rejected | Z70 already refuses every such row at the next hour and the claim then settles it (Z74); the brake would block Z65's re-run whenever the forms job cannot settle, for example with `CLICKUP_API_TOKEN` missing; it would add a sentence to 3.12 and a fourth refusal to 4.7 for no case Z70 leaves open |
| Z74 | `claim_forms` settles every open form row the gate refuses, in every mode, before its mode check; a started or done step in `progress.steps` settles `failed` with the check-the-card sentence, as an `unknown` effect does; the kick uses the claim's own lane rule and counts refused rows as due in any mode; `Nothing to write.` is said only when no form row is `queued`, `retry` or `unknown`, with three waiting sentences and a could-not-be-counted sentence otherwise (4.1) | a rollback unsets the apply secret, so a settle that needed apply mode would leave rows open until a later hour; a `skipped` over a write that may have reached the card tells the trail nothing was written; a kick that ignored lanes would post runs that take nothing; missing is never zero |
| Z75 | E5 used the fallback proof: the per-function body-diff of `checkin-notices-supabase.test.ts`. The `SLACK_NOTICES_WITH=u` branch was not built and its command is gone from 4.2, section 8 and `scripts/ship.sh` | that suite builds only what `20261025n` reads, so it cannot load the 2a base; nothing read the variable, so the second run was the plain suite again and proved nothing |
| Z76 | Client messages: a new detail key `receiptsMissing` on the `client-messages` and `client-messages-g5` rows, read by the guardian; new sentences `NOT_A_CARD`, `SWITCH_TWICE(keys)` and `RECEIPTS_LOST(n)`; any switch error turns apply off; a run stopped by a switch error still runs the database sweep first (3.11, 4.3, section 6) | a call that left without its answer saved must not read as ok; a kill switch appended below an old `true` must never leave sending on, and first-wins would; a bad card list must never widen to every client; a stopped send must still reach `unknown` (Z67) |
| Z77 | `cleanSince` moves at most twice per `differs` episode (set when `differs` first appears, set again on the first clean cycle), stricter than this contract's first "reset on any differs cycle"; `csm-notes-parity` has no feed-staleness warning and no `PARITY_FEED_MAX_MIN` (4.4) | a reset every cycle changes every client row every 15 minutes and writes audit rows for nothing, while G6 is already held by `differs = 0`; an incident of this check restarts G6, and a stopped feed belongs to `native-source-producer`, so it must not restart the 7 days |
| Z78 | Section 7 gains: `supabase/functions/cockpit-notices/run.ts` to notices (`run.test.ts` was already theirs); the one assertion in `stage1-fit-supabase.test.ts` to screens; `checks/pg_cron.py`, `checks/sections.py`, `tests/test_hiring_sync.py` to worker; the one row in `docs/requests/CLICKUP-DOWNGRADE.md` to writers, whose job it describes. `slack-notices-supabase.test.ts` leaves the table (Z75) | every file one owner; the dry-run preview must tag as the post does; `notices.ts`'s kind list is screens', and the Stage 1 suite reads it; the guardian's new cron and health keys need their watch; the ownership test keeps the orchestrator's row to the contract alone |
| Z79 | The base is origin/main `ca8fe4bf` (after the ClickUp Business work). D0's precondition is now the merge-base of `stage2b-1029` and origin/main against origin/main, not a fixed sha. N4 stays its own commit on the rebased branch (4.4, D1). The 2.2 md5s and ACLs did not move | `20261029p` and `q` touch none of the functions 2.2 lists; a fixed `0889803b` would now list 139 files, 11 of them in section 7, all already rebased onto; `ca8fhot1` changed only `csmCadence.ts`, so D1's two file hashes hold |
| Z80 | The forms job's pace: `CLICKUP_FORMS_CALLS_PER_MINUTE`, default 10, at most 60, tunable; one forms run at a time, by the kick and by an exclusive `begin`; inside the one token's budget of 80 (`docs/requests/CLICKUP-DOWNGRADE.md` section 1), dark until the cut-over | one token serves every Supabase function and VPS worker, at 100 a minute on Business; the first default of 120 was over that alone; the pacer belongs to one Edge call, so two runs side by side would send twice the pace; a CSM's notes can wait a minute, nothing is waiting on a screen |
| Z81 | `cockpit_form_shadow_close` credits its audit rows to `cut-over` / `cutover` when the caller named no actor or source (2.3) | only the cut-over closes shadow drafts, and step 7a's own SELECT names nobody; a blank actor on a final state is no trail |

---

## 16. Checked for this contract (read only, 2026-10-29; the rebase row 2026-10-30)

| Check | Result and query |
|---|---|
| Git | branch base `0889803b`; origin/main `64807762` (re-read in the evening; it was `9a4a95b3` in the morning), whose changes since the base are `20261029c` to `20261029j` and sales code only, 38 files (`git diff --name-only 0889803b origin/main`); every branch holds nothing past `20261029j` (`git for-each-ref` then `git ls-tree <ref> supabase/migrations/`) |
| Rebase (2026-10-30) | origin/main `ca8fe4bf` (`git ls-remote origin main`) and the merge-base of `stage2b-1029` with it; `git diff --name-only 0889803b ca8fe4bf` 139 files, 11 in section 7's table: `RUNBOOK.md`, `CsmPage.tsx`, the guardian's `README.md` and `checks/__init__.py`, `csmProducer.test.ts`, `scripts/ship.sh`, `scripts/verify-cutover-readiness.py`, `clickup-writeback`'s `index.ts`, `run.ts` and `run.test.ts`, `cockpit-csm-api/projections.ts`. Live: `20261029p` at `20261029201711`, `20261029q` at `20261029201716`, nothing at `20261029r` or later (`select version, name from supabase_migrations.schema_migrations where name like '20261029%' or name like '20261030%' or version >= '20261029' order by version desc`); no other branch holds a name from `20261029r` on (the sweep of 2.1); the 24 rows of 2.2 equal live, md5, body md5 and ACL (the query of "Replaced bodies" below, compared by script); `cockpit_forms` checkin `typeform`, responses, effects, drafts, messages 0; crons `-kpi` `23 3-18 * * *`, `-dosdonts` `35 3-18 * * *`, `-log` `*/2`, `-requests` and `mahara-slack-notices` `* * * * *`, no `mahara-clickup-writeback-forms`; `clickup-writeback:requests` `apply`, ok. VPS (ssh, read only): `~/cockpit-native-current` is `ca8fhot1`, `activated` true, `release-ca8fhot1.sh` `FILES` only `csmCadence.ts`, `BASE` `86eebpf1`; its `csmProviders.ts`, `csmProducer.ts`, `csmCadence.ts`, `transport.ts`, `runtime.ts` sha256 equal `ca8fe4bf` |
| Migrations | live `20261029a` to `20261029j` (sales; `j` at `20261029174158`, `select max(version) from supabase_migrations.schema_migrations`) and `20261027f/g/h` at `20261029135744`-`753`; `s` to `z` free: `select version, name from supabase_migrations.schema_migrations where name like '20261029%' or name like '20261030%' or version >= '20261029' order by version desc` |
| Forms tables | responses 0, effects 0, drafts 0, messages 0; `fRokTITH` 36 stored, newest 2026-10-27 15:40:20 +03: `select (select count(*) from cockpit_form_responses), (select count(*) from cockpit_form_effects), (select count(*) from cockpit_form_drafts), (select count(*) from cockpit_client_messages), (select count(*) from cockpit_csm_call_forms where form_id='fRokTITH'), (select max(submitted_at) from cockpit_csm_call_forms where form_id='fRokTITH')` |
| Registry | checkin `typeform fRokTITH` v1, 8 `shadow`; kickoff `typeform tG7dnxBn` (5 `make`, `kickoff_notice` `cockpit`, `recap` `shadow`); blueprint `native` (5 `cockpit`, 2 `shadow`): `select key, provider, typeform_id, version, (select string_agg((e->>'key')||':'||(e->>'owner'), ',') from jsonb_array_elements(effects) e) from cockpit_forms order by key` |
| Notices | 30 kickoff `skipped`, 1 rehearsal `posted`: `select kind, state, count(*) from cockpit_slack_notices group by 1,2`; channels `C09RZ0GS0V9`, `C09SVG6FHGU`, `C0AE8G5MT7Y` all private and `ok`: `select id, name, private, state from cockpit_slack_channels` |
| Keys | `anthropic`, `deepseek`, `fathom`, `fathom_webhook` connected: `select provider, state from cockpit_forms_keys` |
| Blueprint presses | 0 outbox rows: `select count(*) filter (where state='done'), count(*) from cockpit_creative_outbox` |
| Replaced bodies | the 2.2 md5s, ACLs and body md5s (re-read in the evening, all unchanged; `cockpit_forms_key_mark` added): `select p.oid::regprocedure::text, p.prosecdef, p.proacl::text, md5(pg_get_functiondef(p.oid)), md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (...)` |
| Settings and registry tables | `cockpit_settings` relacl `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`, row security on, no trigger; no `forms.%` key yet; `cockpit_forms` relacl `{postgres=arwdDxtm/postgres,service_role=r/postgres}`: `select relname, relacl::text, relrowsecurity from pg_class where oid in ('public.cockpit_settings'::regclass, 'public.cockpit_forms'::regclass)`; `select tgname from pg_trigger where tgrelid = 'public.cockpit_settings'::regclass and not tgisinternal` (none) |
| Crons | `mahara-clickup-writeback-log` `*/2`, `-requests` `* * * * *`, `-kpi`, `-dosdonts`, `mahara-slack-notices` `* * * * *`, all active; no `mahara-clickup-writeback-forms`: `select jobname, schedule, active from cron.job where jobname like 'mahara-clickup%' or jobname like 'mahara-slack%'` |
| VPS key files (names only, never values) | `/home/hermes/.ad-billing-guard/runtime.json`: `AD_BILLING_APPLY`, `AD_BILLING_WHAPI_TOKEN`, `CLICKUP_API_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, no `SUPABASE_URL`; `runtime-86eebpf1.json`: `SUPABASE_URL` (host `bldgtotkfmhoxmlzowdx.supabase.co`), `SUPABASE_SERVICE_ROLE_KEY`, `TYPEFORM_TOKEN` and others; `/opt/data/bibi/api-keys.env`: `MAKE_API_KEY`, `MAKE_ZONE`, and a `SUPABASE_URL` of another project (host `rzokwi…`); read by a read-only ssh Python that printed key names and the host only |
| Next POC sync wrappers | `alert-next_poc_sync.py` (8 lines, `job_alert.main`) and `next_poc_sync.sh` (`cd /opt/data/bibi/workspace/next-poc-sync && exec python3 next_poc_sync.py --apply --quiet`), read over ssh with secret-looking lines filtered |
| From the area maps (read only, same day) | the writeback, notices, settings and runs CHECKs (`select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint where conrelid in (...) and contype='c'`); queue by kind and state, no `form` row, every dedupe key word-prefixed (`select dedupe_key ~ '^[0-9a-f-]{36}:', kind, count(*) from cockpit_clickup_writeback_queue group by 1,2`); the `form_kind` CHECK without `checkin_late`; `csm-checkin-form` ok `36 of 36…`; 3 open candidates, all older than 24 hours, all by the CSM-only seat, none named by a response; 33 Fathom call rows on a card by method; seats: 0 editor rows, 3 active admins, 1 active CSM-only seat; `cockpit_audit_log` about 400,000 rows (400,088 on 2026-10-29 evening, `select count(*) from cockpit_audit_log`; it grows about 18,000 a day) with `idx_cockpit_audit_log_entity`; `pg_catalog.sha256` exists; the canary card `86eywg1cq` `Stopped` in the mirror with no Client Data row and no WhatsApp thread; 5 Make 07 recaps in 4 groups, the guard's posts in 14, 3 recaps in the 2 groups both used; `wa_threads.provider_id` is not a WhatsApp group id; both 2026-10 `call` acts ended `reconcile` while ClickUp stored the dates (mirror second source); the Next POC sync job, script and `sync.log` (ssh, read only) with the mirror as second source; the native release `86eebpf1` equal to the branch; store against published cadence: 19 both, 0 differs; the 10 replayed recordings' 53 action items by assignee kind; 13 check-in rows with Additional Notes, 3 with a short line. Each map's query is quoted with its number in that map |
| Code read | the files cited in sections 2 to 6, at `0889803b`; `docs/forms/STAGE2-CONTRACT.md` (Amendments, sections 0, 1, 2, 10, 11, 13 to 17); `docs/forms/PLAN.md` 4.2 to 4.7; `docs/forms/HANDOVER.md` section 4; `hermes/cockpit-guardian/guard/db.py`, `checks/queues.py`, `checks/__init__.py`; `20261026t_task_alerts.sql:678-695`; `20261009f_clickup_writeback_native.sql:43-66`; the frontend-design skill |

---

## 17. Critique notes (2026-10-29)

Three critics (safety S1 to S23, executability E1 to E32, facts F1 to F18)
reviewed the first draft. Every item was checked against the branch, the live
database (read only) or the VPS (read only) before deciding. "Fixed" names
where; "kept" gives the proof. Items that overlap are answered once.

**Kept (the draft was right):**

- **F, trivial drift "the keys CHECK is at `20261027g:232`".** Kept at `:233`: `grep -n "provider IN" supabase/migrations/20261027g_fathom_intake.sql` prints `233:  provider   text PRIMARY KEY CHECK (provider IN ('fathom','fathom_webhook','anthropic','deepseek')),`.

**Fixed differently from the critic's suggestion (the defect is closed; the reason for the other route):**

- **E1 / F3** (cron path reads drafts through the seat): fixed with F3's route, a service reader `cockpit_form_drafts_service` passed into `draftsForResponse` (4.0, 2.7, Z56), not E1's "skip both reads": skipping the `:445` read would let a missing key begin a second `off` row on every sweep.
- **S7** (owner gate only at claim): `intent` re-runs the gate, but a refusal moves `claimed` back to `approved` (allowed, `20261027f_forms_core.sql:531`) so the next claim's gate settles it `skipped` with no person needed, rather than `refused` (4.3, 3.1, Z66).
- **S2** (Skip on a refused recap): the guard gains `refused` to `skipped` and `failed` to `skipped`; a refused message's effect settles `skipped`, but a failed one's effect stays `failed`, because the 2a effects guard has no `failed` to `skipped` (`20261027f_forms_core.sql:456-461`) and a third added guard move for a cosmetic state is not worth it (3.6, Z55).
- **E21 / F16** (held sentence and `apply_limited`): `held_label` added as asked; for `apply_limited`, a queued row counts as live only when its card is in `onlyCards` (a new `limited` field), not every queued row, because rows of other cards are held by design while the canary runs (section 6).
- **E22** (guardian reading `answers`): took the critic's second option, `cockpit_csm_calls` alone, proved by the attach setting `candidate = false` (`20261027f_forms_core.sql:1103-1105`) (4.10).
- **E5** (notices body proof): both routes: the `SLACK_NOTICES_WITH=u` branch in `slack-notices-supabase.test.ts` and the per-function body-diff in `checkin-notices-supabase.test.ts`, with the latter standing alone if that suite cannot load the 2a base (4.2, 2.2 "Body-diff rule"). 2026-10-30: it could not, so the latter stands alone (Z75).

**Fixed as raised:**

| Item | Where |
|---|---|
| S1 cut-over cannot re-run after a rollback | 4.7 (refusal dropped), 3.12, 11.2 step 0, 11.3, Z65 |
| S2 Skip on refused | 4.3 guard and skip, 3.6, 5.1, 11.2 step 8, Z55 |
| S3 no rollbacks | section 9 "Rollbacks" table, D0 records targets, D15 saves the guardian copy, Z64 |
| S4 WhatsApp retry | 4.3 `whapi.ts` (`read` false, one fetch), tests, Z59 |
| S5 B2 replays queued sends | 11.2 step 3, 11.3, B2 row, 14, Z68 |
| S6 build 5 not named as the exception | section 0 item 1, section 9 intro, D11 read-back and rollback, Z19 |
| S7 gate only at claim | 4.3 `intent`, 3.1, 3.12, Z66 |
| S8 fourth attempt loops | 4.3 `intent`, 3.12, test, Z66 |
| S9 429 as failed | 4.3 `whapi.ts`, Z59 |
| S10 dry mode never sweeps | 4.3 dry mode, test, 11.3, Z67 |
| S11 no time budget | 4.3 time budget, test, Z59 |
| S12 switches from shared files | 4.3 switches and `run.sh`, 1.4, Z60 |
| S13 md5 not atomic | 2.1 drift guard, 2.2 body md5 column, section 9 intro, Z61 |
| S14 ACLs not listed | 2.2 ACL column (live values read 2026-10-29), section 9 intro, fit test |
| S15 writes without audit | 2.7 `cockpit_form_effect_note`, 4.0 (Z53); 2.5 seed audit rows; 2.10 settings trigger, 11.2 step 9 (Z62) |
| S16 dispatch can fail a submit | 4.0 outer exception block, test (13), Z53 |
| S17 CEO seat as a second way to native | 4.7, 1.4, 3.12, 15.1, Z12, Z54 |
| S18 `checkin` accepted by the door | 2.9, 3.9, 4.8 (door, keys CHECK, `forms_key.py`, tests), Z58 |
| S19 canary rests on an old fact, allows booking | 11.2 steps 5 and 8, `doctor --task`, Z69 |
| S20 unlinked Typeform forms | 11.2 step 9 |
| S21 G4 against D17 | section 10 G4 |
| S22 no final switch read-back | D18 |
| S23 7a cannot be undone | 11.2 step 7a, 11.3 |
| E2 `cockpit_forms_key_mark` refuses Typeform keys | 2.2 row (live md5 `d3e53fa6…`, ACL svc), 2.9, 4.8, test |
| E3 keys status breaks the CEO card | 2.2, 4.8, hand-offs, test, Z57 |
| E4 N4 commit mechanism | 4.4, section 7, build order, risks, Z63 |
| E6 notices fixtures and harness unowned | section 5 harness states, 5.4, section 7 |
| E7 / F5 five `fn_extras` files | section 8 worker, D11 |
| E8 / Z5 caller-blind waiting reason | 4.0, Z5, Z53 |
| E9 `formStep` checks per effect | 4.1 |
| E10 `StepBook` key | 4.1, test |
| E11 approve's return | 2.6, 4.3 |
| E12 `splitRecap` and `p_body` | 4.3 approval op |
| E13 / F7 kit components | section 5 |
| E14 letters collide with `20261026s/t` | 2.1 "Names in tests", 4.1, 4.2, 4.3, section 8 |
| E15 ambiguous paths | section 7 rewritten with full paths |
| E16 fit-test needle | section 8 |
| E17 readiness list | section 8 ship block and list |
| E18 board-api and read-model consumers | 4.5, section 7 "Not touched", section 8 writers |
| E19 second `drafts.test.ts` case | 4.13 |
| E20 Python 3.11 for the guardian | section 8, D15 |
| E21 held sentence | section 6 |
| E23 `client-messages` modes and staleness | 3.11, section 6 |
| E24 `door_seen` outcomes | 2.9, 3.9 |
| E25 rollback test wording | 4.7 |
| E26 step 1b exists | 4.2, 2.2 |
| E27 `answers.test.ts` | folded into `handler.test.ts` (4.8, section 7) |
| E28 header lines of the plans test | 4.12, section 7 |
| E29 4.15 item 3 | 4.15 "Not built in 2b" |
| E30 RUNBOOK placement | section 6 anchors |
| E31 `TODOS_VERSION` line | 4.13 (`drafts.ts:46`) |
| E32 `onOtherMovable` undefined | 3.8, 4.11 |
| F1 `sheet()` POSTs a token | 4.3 `ledger.ts`, tests, D14 |
| F2 `run.sh` wrong runtime file | 4.3 `run.sh` word for word, doctor URL check, D14 |
| F4 notice `queued` to `failed` raises | 4.2 claim 1c(iv), test |
| F6 sha256 versus md5 | D1 |
| F8 `core.ts` anchors | 4.5 |
| F9 `verify:` prefix | 3.3 |
| F10 auth-config anchor | D10 (`:200-202`) |
| F11 `runRequests` anchor | 4.1 (`run.ts:518-697`) |
| F12 writer listed as a reader | 4.9 |
| F13 `client_message` `delivery_ref` | 4.0 |
| F14 `call_match` skip sentences | 11.2 step 8 |
| F15 comment text in `progress` | 3.3, 4.1, 11.2 step 8 |
| F17 registry gate sentence | 4.7, 3.12, test |
| F18 audit log size | section 16 (400,088) |
| trivial: `CsmPage.tsx` tabs `:1190-1196`; build 6's `next_poc_sync.sh` | 5.1; 4.6 (wrapper read over ssh) |

**Facts re-checked for these notes (read only, 2026-10-29 evening):** the
2.2 md5s unchanged and `cockpit_forms_key_mark` added (query in section 16);
live migrations through `20261029j`, `s` to `z` free; origin/main `64807762`,
sales files only since the base; `cockpit_settings` with no trigger;
`cockpit_audit_log` 400,088; queue prefixes include `verify`; the VPS key file
names (no values); `hermes/ad-billing-guard/transport.ts:55-70`, `:204-213`;
`20261025n_slack_notices.sql:725`, `:666`, `:677`, `:1239-1253`;
`20261027f_forms_core.sql:242`, `:528-535`, `:561-562`, `:1103-1105`,
`:1755-1767`; `20261027g_fathom_intake.sql:510-511`;
`supabase/functions/cockpit-forms-api/drafts.ts:46`, `:353-356`, `:378`,
`:445`, `:502`; `apps/media-buyer-cockpit/src/lib/formsKeysClient.ts:19-20`;
`hermes/cockpit-guardian/checks/queues.py:148-152`, `:170`;
`python3 scripts/dev/fn_extras.py . fathom-webhook` and `. cockpit-hours-sync`.
